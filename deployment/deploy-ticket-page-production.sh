#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_RUNNER_SHA256="3678afd5ea86d87f643488585d216999983246023cdf400e092045c7851d3973"
readonly EXPECTED_IMAGE_ID="sha256:041d5d6b79e9e99faeabecaf8dbe72b342a450dc9dcb8328c55c479721daa019"
readonly COLLECTOR_RUNNER="/usr/local/sbin/sfz-eventspy-season-collect"
readonly COLLECTOR_IMAGE="{team}fanzone-eventspy-season:1"
readonly MIRROR_ROOT="/var/lib/sfz-eventspy-mirror/dev/public"
readonly TEST_GAME_ID="1392216"
readonly BROWSER_IMAGE="mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Error: production deployment must run from the main branch." >&2
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "Error: tracked files have uncommitted changes." >&2
  exit 1
fi

if [[ "$(grep -Ec ':\/srv/eventspy-mirror:ro([[:space:]]|$)' docker-compose.yml)" -ne 1 ]]; then
  echo "Error: docker-compose.yml must contain exactly one read-only /srv/eventspy-mirror mount." >&2
  exit 1
fi

if [[ ! -s "${MIRROR_ROOT}/${TEST_GAME_ID}.json" ]]; then
  echo "Error: ${MIRROR_ROOT}/${TEST_GAME_ID}.json is missing or empty." >&2
  exit 1
fi

actual_runner_sha256="$(sha256sum "${COLLECTOR_RUNNER}" | awk '{print $1}')"
if [[ "${actual_runner_sha256}" != "${EXPECTED_RUNNER_SHA256}" ]]; then
  echo "Error: collector runner SHA-256 does not match the reviewed version." >&2
  exit 1
fi

actual_image_id="$(docker image inspect --format '{{.Id}}' "${COLLECTOR_IMAGE}")"
if [[ "${actual_image_id}" != "${EXPECTED_IMAGE_ID}" ]]; then
  echo "Error: collector image ID does not match the reviewed image." >&2
  exit 1
fi

upsert_env_value() {
  local key="$1"
  local value="$2"
  local source_file="$3"
  local output_file="$4"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { found = 0 }
    $0 ~ "^[[:space:]]*" key "=" {
      if (!found) print key "=" value
      found = 1
      next
    }
    { print }
    END { if (!found) print key "=" value }
  ' "${source_file}" > "${output_file}"
}

env_file="${REPO_ROOT}/.env"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -e "${env_file}" ]]; then
  cp -p -- "${env_file}" "${env_file}.backup.${timestamp}"
else
  : > "${env_file}"
fi

first_env="$(mktemp "${REPO_ROOT}/.env.eventspy.XXXXXX")"
second_env="$(mktemp "${REPO_ROOT}/.env.browser.XXXXXX")"
cleanup() {
  rm -f -- "${first_env}" "${second_env}"
}
trap cleanup EXIT

upsert_env_value "EVENTSPY_MIRROR_ROOT" "${MIRROR_ROOT}" "${env_file}" "${first_env}"
upsert_env_value "BROWSER_BASE_IMAGE" "${BROWSER_IMAGE}" "${first_env}" "${second_env}"
chmod --reference="${env_file}" "${second_env}"
mv -- "${second_env}" "${env_file}"

npm ci --ignore-scripts --no-audit --no-fund
node scripts/validate-production-schedule.mjs --source
npm run build:production-offline
node scripts/validate-production-schedule.mjs --dist
docker compose config -q
# Force recreation so a changed read-only nginx/default.conf bind mount is
# loaded by the running web container; updating the checkout alone is not enough.
docker compose up -d --force-recreate web
docker exec {team}fanzone-web nginx -t

json_url="http://127.0.0.1:4322/data/eventspy-mirror/${TEST_GAME_ID}.json"
json_response="$(mktemp "${REPO_ROOT}/.eventspy-response.XXXXXX")"
trap 'rm -f -- "${first_env}" "${second_env}" "${json_response}"' EXIT
curl --fail --silent --show-error "${json_url}" --output "${json_response}"
node -e '
  const fs = require("node:fs");
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (Number(data.gameId) !== 1392216) throw new Error("unexpected gameId");
  if (typeof data.collectedAt !== "string" || Number.isNaN(Date.parse(data.collectedAt))) throw new Error("invalid collectedAt");
  if (typeof data.summary?.currentLowestCents !== "number" || data.summary.currentLowestCents <= 0) throw new Error("invalid currentLowestCents");
  if (!Array.isArray(data.history) || data.history.length < 1) throw new Error("history must contain at least one point");
' "${json_response}"

# Exercise the production Nginx configuration locally while retaining each
# logical request's public scheme and Host headers. This covers canonical 200s,
# aliases, slash normalization, query preservation, and redirect-loop limits.
node scripts/check-redirect-chains.mjs http://127.0.0.1:4322

systemctl is-enabled --quiet sfz-eventspy-season.timer
systemctl is-active --quiet sfz-eventspy-season.timer
echo "Next sfz-eventspy-season.timer activation:"
systemctl list-timers sfz-eventspy-season.timer --no-pager

echo "Production ticket page deployment completed successfully."
