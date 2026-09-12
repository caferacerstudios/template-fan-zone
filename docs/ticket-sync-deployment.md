# Ticket synchronization deployment

This is an operator-reviewed deployment proposal. Applying it is deliberately
manual. This repository task does not modify a host, start or restart a
container, enable a timer, expose a port, deploy production, or contact a
provider.

The repository supplies one `eventspy-collector` Compose profile and one twice-daily systemd timer template. They are proposals, not installed state. Preserve the operator-owned `/home/laurawkr/{team}fanzone-dev/docker-compose.yml`; neither overlay defines `web` or ports. Select an immutable service image built from the reviewed source SHA with `EVENTSPY_COLLECTOR_IMAGE`.

## EventSpy collector operations

Build the API collector image from `deployment/eventspy-collector/Dockerfile`. The exact one-shot command is `node scripts/tickets/eventspy-mirror.mjs --output-root /var/lib/sfz-eventspy-mirror/dev`. It performs one season collection, writes `/var/lib/sfz-eventspy-mirror/dev/{gameId}.json`, preserves each last-good file on failure, and exits 2 for a partial season. The timer targets 08:00 and 20:00 America/Los_Angeles with a small randomized delay. Install the repository service and timer templates only after reviewing paths and image identity; this repository does not install or start them.

## Runtime model

Astro remains a static build and Nginx remains the only HTTP service. The
profile-only `ticket-sync` container runs `scripts/tickets/sync.mjs` once and
exits. It does not listen on a port and is not a dependency of `web`. Provider
APIs are therefore never called during an HTTP request, and a sync failure
cannot stop or restart the static site.

The container has a read-only root filesystem, runs as the upstream Node
image's non-root `node` user, drops all capabilities, and receives a small
`noexec` temporary filesystem. Only `/srv/ticket-data` is writable. It has no
Docker socket. Its image contains the synchronizer, schedule, matching code,
and overrides, but no `.env`, credentials, dependencies, site build, or runtime
snapshot. `Dockerfile.dockerignore` limits the build context accordingly.

The pipeline writes owner-writable, public-readable mode `0644` JSON into a
sibling staging directory, validates every file, promotes it to an immutable
version directory, and atomically switches a `current` symlink in the same
stable parent. A killed publisher leaves the prior pointer intact and no
unvalidated version is linked. The runtime mount must expose that stable parent,
not the symlink target. Three local versions are retained at most. An existing
`current` directory is migrated into the version store before installing the
pointer. Locking has two layers. The systemd unit's host-level non-blocking
`flock` prevents overlapping scheduled containers; overlap is a visible failed
unit. Independently, the application protects persistent runtime state with a
versioned lease containing a cryptographically unique run token, start time,
and refreshed heartbeat. PID and hostname are retained only as diagnostics:
PID 1 and changing hostnames in one-shot containers are never liveness or
ownership evidence. A preparation failure leaves `current` untouched. A
provider failure can publish a validated degraded snapshot only within that
provider's configured retention; expired listings are omitted.

Nginx mounts the instance data root read-only and serves only
`current/` at `/data/tickets/`. JSON is sent as `application/json`, with
`nosniff`, gzip, no directory index, and a 60-second revalidating cache. The
cache duration is intentionally a plainly reviewable Nginx directive. No
`stale-if-error` directive is enabled because provider retention rights differ
and remain pending; retention stays under synchronizer control. Missing paths
return a small JSON 404 with `no-store`. Malformed candidates never promote,
so Nginx continues serving the last validated snapshot.

`SFZ_TICKET_DATA_MODE` has four states. `disabled` hides navigation and game
CTAs while direct visits show an unavailable noindex/nofollow page. `preview`
remains noindex/nofollow; the current page client still attempts the same
validated non-fixture runtime JSON as `beta` and `live`, and shows unavailable
when it is absent. The committed fixture is contract-test input, not preview
page data. The independent
`SFZ_TICKET_INDEXING_STATE` defaults to `disabled`; only `live` plus `enabled`
permits index/follow, canonical publication, and sitemap inclusion. Client data
never controls static metadata.

In `beta` or `live` state, `/tickets` reads the runtime index and only the selected
event file(s). Fresh listing-level records populate the retained comparison
card area. Matched event-summary records appear separately as clearly labeled
provider links. Genuine Ticketmaster Discovery ranges are displayed as
provider-reported event summaries with unknown fee basis; they are neither
offers nor cheapest-price evidence and never enter listing ranking. Missing or
malformed ranges leave the verified, allowlisted provider CTA intact. This does
not enable or imply access to the separately gated Ticketmaster Inventory
Status API. Preview
state continues to use the explicitly labeled build-time development fixture.

## Proposed paths

| Purpose | Development | Production |
| --- | --- | --- |
| Runtime data root | `/var/lib/sfz-ticket-finder/dev` | `/var/lib/sfz-ticket-finder/prod` |
| Published snapshot | `.../dev/current` | `.../prod/current` |
| Secret/config file | `/etc/sfz-ticket-finder/dev.env` | `/etc/sfz-ticket-finder/prod.env` |
| Host overlap lock | `/run/lock/sfz-ticket-sync-dev.lock` | `/run/lock/sfz-ticket-sync-prod.lock` |
| Unit | `sfz-ticket-sync@dev` | `sfz-ticket-sync@prod` |

The examples assume the immutable release symlink is
`/opt/{team}-fan-zone/current`. The repository contains no host layout or
release installer that confirms this path. Before installation, the operator
must replace `WorkingDirectory` and `Documentation` in the copied unit (or add
a reviewed drop-in) with the actual stable `current` symlink. Never point the
unit at a versioned release that will be removed.

Development and production must not share data directories, env files,
Compose project names, unit instances, status, or locks. The systemd journal
and unit state are naturally instance-specific. Do not mount either env file
into Nginx.

## Environment files and credentials

Start from `deployment/ticket-sync/example.env`. The installed files must be
owned by root and mode `0600`; their parent directory should be root-owned mode
`0700`. Use `TICKETS_ENV=development` and the dev paths for dev. Use
`TICKETS_ENV=production`, the prod paths, and an explicit approved provider
configuration for production. Production adapters and retention values remain
disabled until the provider-rights documentation is approved.

Never use a `PUBLIC_` credential name, put a secret on a command line, commit
an installed env file, copy one into an image, or print one during installation
or troubleshooting. Run only key-name checks against secrets; do not `cat`,
`docker inspect`, `systemctl show-environment`, or run Compose with verbose
environment output. The synchronizer emits bounded error codes rather than
credential values.

The exact runtime variables are:

- `TICKETS_ENV=development` with
  `TICKETS_OUTPUT_DIR_DEVELOPMENT=/var/lib/sfz-ticket-finder/dev/current`, or
  `TICKETS_ENV=production` with
  `TICKETS_OUTPUT_DIR_PRODUCTION=/var/lib/sfz-ticket-finder/prod/current` when
  invoking Node directly. Compose maps the corresponding `TICKET_DATA_ROOT`
  to `/srv/ticket-data` and sets `TICKETS_OUTPUT_DIR` inside the container.
- `TICKETS_FIXTURE=false` for every page described as live.
- `TICKETS_PROVIDERS_JSON` containing only reviewed provider IDs and modes.
  `minRefreshMs` controls request eligibility, `freshnessMs` controls display
  freshness, and `retentionMs` is only the rights-permitted stale ceiling;
  validation requires `minRefreshMs <= freshnessMs <= retentionMs`. The dev
  values `600000`, `1800000`, and `3600000` keep a 15-minute timer plus
  two-minute jitter inside freshness. Retained records are explicitly stale
  with their observation time, cannot rank or make current-price claims, and
  disappear after retention.
- Provider fixture and schedule fixture provenance are independent. A
  non-fixture sync requires the schedule itself to contain exactly
  `fixture:false`; status publishes both `fixture` and `scheduleFixture`, and
  beta/live reject either missing or true field.
- `TICKETS_LOCK_STALE_MS` (default 30 minutes) sets lease expiry,
  `TICKETS_LOCK_HEARTBEAT_MS` (default 60 seconds) refreshes an owned lease and
  must be less than one third of the stale duration, and
  `TICKETS_LOCK_STALE_ARTIFACT_LIMIT` (default 3) bounds quarantined stale-lock
  directories. For Ticketmaster event summaries, also configure
  `TICKETMASTER_API_KEY` plus optional `TICKETMASTER_EVENT_NAME`,
  `TICKETMASTER_EVENT_DATE`, and `TICKETMASTER_LEGACY_EVENT_ID`.

A future listing provider cannot be configured generically without its actual
contract. After approval, repository work must record its credential variable,
exact API and outbound host allowlists, documented response-to-adapter mapping,
and rights-approved retention in the provider registry/rights summary. Only
then may its ID be enabled as `mode: "listing-level"` in
`TICKETS_PROVIDERS_JSON`. StubHub is the planned next provider, but no current
variable can make it live because its registry entry deliberately has no
credential variable or allowed hosts and remains behind the rights gate.

## Review and disposable validation

Run these from a reviewed checkout. They create only disposable local data and
do not contact providers. The fixture command explicitly disables networking.
The sync image intentionally has no default base image: a build without
`NODE_BASE_IMAGE` must fail. During manual image promotion, the operator reviews
and records an immutable value shaped like
`node:22-alpine@sha256:<reviewed-digest>`; this repository does not invent or
pin that digest on the operator's behalf.

```sh
docker compose --env-file deployment/ticket-sync/dev.compose.env config
docker compose --env-file deployment/ticket-sync/prod.compose.env config

docker build --build-arg NODE_BASE_IMAGE='node:22-alpine@sha256:<reviewed-digest>' \
  -f deployment/ticket-sync/Dockerfile -t sfz-ticket-sync:test .
test_root="$(mktemp -d)"
install -d -m 0700 "$test_root/tickets"
chown 1000:1000 "$test_root/tickets"
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  --user "$(docker image inspect -f '{{.Config.User}}' sfz-ticket-sync:test)" \
  -e TICKETS_ENV=development -e TICKETS_FIXTURE=true \
  -e TICKETS_OUTPUT_DIR=/srv/ticket-data/current \
  --mount "type=bind,src=$test_root/tickets,dst=/srv/ticket-data" \
  sfz-ticket-sync:test
test "$(stat -c '%a' "$test_root/tickets/current/index.json")" = 644
test "$(stat -c '%a' "$test_root/tickets/current/status.json")" = 644
jq -e '.outcome == "success" or .outcome == "degraded"' \
  "$test_root/tickets/current/status.json"
```

Because a bind directory must be writable by container UID 1000, create the
real instance directories with owner `1000:1000` and mode `0755`. That UID owns
the mode `0644` published files, while the unrelated Nginx worker can traverse
and read the public snapshot through its read-only mount. No credentials or raw
provider responses may enter this tree. A host that requires tighter access
should use reviewed matching groups/ACLs in both containers. Verify the actual
image UID before installation.

Test Nginx without changing the installed site:

```sh
docker run --rm --network none \
  --mount "type=bind,src=$PWD/nginx/default.conf,dst=/etc/nginx/conf.d/default.conf,readonly" \
  --mount "type=bind,src=$PWD/dist,dst=/usr/share/nginx/html,readonly" \
  --mount "type=bind,src=$test_root/tickets,dst=/srv/ticket-data,readonly" \
  nginx:alpine nginx -t

docker network create sfz-ticket-validation
docker run -d --rm --name sfz-ticket-web-test --network sfz-ticket-validation \
  --mount "type=bind,src=$PWD/nginx/default.conf,dst=/etc/nginx/conf.d/default.conf,readonly" \
  --mount "type=bind,src=$PWD/dist,dst=/usr/share/nginx/html,readonly" \
  --mount "type=bind,src=$test_root/tickets,dst=/srv/ticket-data,readonly" \
  nginx:alpine
docker run --rm --network sfz-ticket-validation curlimages/curl:latest \
  -fsS http://sfz-ticket-web-test/data/tickets/index.json | jq -e '.schemaVersion'
docker run --rm --network sfz-ticket-validation curlimages/curl:latest \
  -sS -D - http://sfz-ticket-web-test/data/tickets/missing.json
docker stop sfz-ticket-web-test
docker network rm sfz-ticket-validation
rm -rf -- "$test_root"
```

The missing request must be `404`, `application/json`, and `no-store`. For a
malformed candidate test, run the existing fixture sync once, save the
published `index.json` hash, point `TICKETS_OVERRIDES_FILE` at malformed JSON in
a second disposable run, assert that run exits nonzero, and assert the hash is
unchanged. Do not corrupt `current`: it is intentionally the last-good target.

## Manual development integration

The tracked Compose file publishes port `4322`. The task description reports
an installed dev integrator serving port `4324`, but no generator, controller,
installed Compose file, or host release documentation is tracked here.
Consequently, updating this repository does **not** update that generated dev
workflow. Preserve its existing image, container name, networks, labels,
controller integration, and `4324` port.

After reviewing the disposable checks, an operator should:

1. Record the exact installed dev Compose/config paths and stable release
   symlink used by the agent controller and dev integrator. Back up each file
   that will change with a timestamp, ownership, and mode preserved.
2. Build `{team}fanzone-ticket-sync:local` from the reviewed dev release.
   Do not rebuild or restart the existing web container yet.
3. Verify the image runs as UID 1000. Create
   `/var/lib/sfz-ticket-finder/dev` owned by that UID with mode `0755`, and
   `/etc/sfz-ticket-finder` root-owned mode `0700`.
4. Install a root-owned mode `0600` `/etc/sfz-ticket-finder/dev.env`. Set the
   development instance values; keep real providers disabled unless separately
   approved. Do not display the file during validation.
5. Add only the read-only bind
   `/var/lib/sfz-ticket-finder/dev:/srv/ticket-data:ro` to the installed dev
   Nginx service. Copy the `/data/tickets/` location into its reviewed Nginx
   server if that config is also generated outside this repository. Do not add
   a port or service route.
6. Add the profile-only `ticket-sync` service to the installed dev Compose
   model without making `web` depend on it. Validate the final generated model
   with `docker compose ... config`; confirm the web port is still `4324` and
   the sync service has no `ports`, Docker socket, or web dependency.
7. Run the fixture sync with `--network none`, then run `nginx -t` in a
   disposable container against the exact installed configuration. Retrieve
   the fixture and missing path through a disposable internal Docker network.
8. Back up any existing same-name systemd files. Copy the templates, correcting
   the stable release path if needed. Run `systemd-analyze verify` on both
   units, then `systemctl daemon-reload`.
9. Start `sfz-ticket-sync@dev.service` manually. Check its exit status and the
   snapshot permissions. Only then validate/recreate the installed dev web
   service using the integrator's normal command. Confirm port `4324`, the
   static homepage, and `/data/tickets/index.json`; do not touch the agent
   controller.
10. Enable and start only `sfz-ticket-sync@dev.timer`. Inspect its next run.
    Production remains untouched.

The following is the concrete repository-managed portion of that sequence. It
must be run by an authorized operator from the actual stable dev release. It
does not attempt to overwrite the separately generated dev Compose/Nginx
files; `$installed_compose` and `$installed_nginx` are recorded and backed up
so the integrator owner can merge the reviewed snippets first.

```sh
release_current=/opt/{team}-fan-zone/current
installed_compose=/path/from-dev-integrator/docker-compose.yml
installed_nginx=/path/from-dev-integrator/default.conf
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"

test -L "$release_current"
test -f "$installed_compose"
test -f "$installed_nginx"
install -d -o root -g root -m 0700 /etc/sfz-ticket-finder
install -d -o 1000 -g 1000 -m 0755 /var/lib/sfz-ticket-finder/dev
install -o root -g root -m 0600 \
  "$release_current/deployment/ticket-sync/example.env" \
  /etc/sfz-ticket-finder/dev.env
# Edit /etc/sfz-ticket-finder/dev.env without echoing values or retaining an
# editor backup, then verify only ownership/mode and expected variable names.
test "$(stat -c '%U:%G:%a' /etc/sfz-ticket-finder/dev.env)" = root:root:600

cp -a -- "$installed_compose" "$installed_compose.before-ticket-sync.$backup_stamp"
cp -a -- "$installed_nginx" "$installed_nginx.before-ticket-sync.$backup_stamp"
# STOP: the dev-integrator owner now merges the web read-only mount, Nginx
# location, and profile-only sync service while preserving port 4324.

docker compose --file "$installed_compose" config >/dev/null
docker compose --file "$installed_compose" config | \
  sed -n '/^[[:space:]]*ports:/,/^[^[:space:]]/p'
docker build --build-arg NODE_BASE_IMAGE='node:22-alpine@sha256:<reviewed-digest>' \
  -f "$release_current/deployment/ticket-sync/Dockerfile" \
  -t {team}fanzone-ticket-sync:local "$release_current"

for unit in sfz-ticket-sync@.service sfz-ticket-sync@.timer; do
  if test -e "/etc/systemd/system/$unit"; then
    cp -a -- "/etc/systemd/system/$unit" \
      "/etc/systemd/system/$unit.before-ticket-sync.$backup_stamp"
  fi
  install -o root -g root -m 0644 \
    "$release_current/deployment/systemd/$unit" "/etc/systemd/system/$unit"
done
systemd-analyze verify /etc/systemd/system/sfz-ticket-sync@.service \
  /etc/systemd/system/sfz-ticket-sync@.timer
docker run --rm --network none \
  --mount "type=bind,src=$installed_nginx,dst=/etc/nginx/conf.d/default.conf,readonly" \
  --mount "type=bind,src=$release_current/dist,dst=/usr/share/nginx/html,readonly" \
  --mount type=bind,src=/var/lib/sfz-ticket-finder/dev,dst=/srv/ticket-data,readonly \
  nginx:alpine nginx -t

systemctl daemon-reload
systemctl start sfz-ticket-sync@dev.service
systemctl is-failed --quiet sfz-ticket-sync@dev.service && exit 1
test "$(stat -c '%a' /var/lib/sfz-ticket-finder/dev/current/index.json)" = 644
# Use the dev integrator's documented validate/recreate command here, then:
curl -fsS http://127.0.0.1:4324/ >/dev/null
curl -fsS http://127.0.0.1:4324/data/tickets/index.json | jq -e '.schemaVersion'
systemctl enable --now sfz-ticket-sync@dev.timer
systemctl list-timers sfz-ticket-sync@dev.timer --no-pager
```

Do not use the sample block unchanged if the actual stable release path,
installed config paths, image UID, or service manager differs. The `sed`
command displays only the port stanza; verify it remains the existing `4324`
mapping before any recreate. Backups stay beside the changed host files and
retain their metadata.

Every host-changing command above requires the host's normal approved
privilege workflow; none is run by this repository task. Validate before every
restart. If any check fails, stop and use the rollback below.

## Production sequence

Production work requires a separate approval and provider-rights review. When
authorized, repeat the development rehearsal with the `prod` instance,
`/var/lib/sfz-ticket-finder/prod`, `/etc/sfz-ticket-finder/prod.env`, and the
production Compose model. Validate the generated model, exact existing web
ports, Nginx config, fixture/failure behavior, and a manual one-shot before
enabling `sfz-ticket-sync@prod.timer`. Never point production Nginx at dev data
or run production from the `dev` branch.

## Monitoring and troubleshooting

These commands show state without printing the environment file:

```sh
systemctl status sfz-ticket-sync@dev.service --no-pager
systemctl status sfz-ticket-sync@dev.timer --no-pager
systemctl list-timers 'sfz-ticket-sync@*'
journalctl -u sfz-ticket-sync@dev.service --since today --no-pager
find /var/lib/sfz-ticket-finder/dev/current -maxdepth 2 -type f \
  -printf '%M %u:%g %s %TY-%Tm-%TdT%TH:%TM:%TS %p\n'
jq '{generatedAt,outcome,totals,providers:[.providers[]|{provider,state,errorCode,lastSuccess,lastAttempt}]}' \
  /var/lib/sfz-ticket-finder/dev/current/status.json
curl -fsS -D - http://127.0.0.1:4324/data/tickets/status.json -o /dev/null
docker compose --project-name sfz-dev --file docker-compose.yml ps
```

`SYNC_LOCKED` means the application found a valid, unexpired lease; a failed
`flock` means another host-scheduled container holds the outer guard. In either
case, inspect the unit before retrying and do not delete the lock. A valid lease
that exceeds `TICKETS_LOCK_STALE_MS` is recovered by atomically renaming it to a
token-specific quarantine, rereading the claimed metadata, rechecking the run
token and expiry, and exclusively creating a replacement. Concurrent recovery
losers fail closed. `SYNC_LOCK_UNKNOWN` means ownership is missing, malformed,
unreadable, time-invalid, changed during recovery, or otherwise ambiguous; it
requires operator investigation rather than manual lock deletion. PID and
hostname differences alone never authorize recovery.
`SYNC_FAILED` means candidate publication failed and `current` should remain
unchanged. A degraded exit is successful publication with provider-level error
codes in `status.json`. A missing endpoint means either no successful initial
sync or a wrong read-only mount. A malformed served file indicates out-of-band
tampering because the publisher validates before promotion; remove access to
the writer and restore a reviewed last-good backup rather than editing JSON in
place.

## Rollback

1. Stop and disable only the affected timer. Let an active one-shot finish, or
   stop it only after confirming the provider operation can be interrupted.
2. Restore the timestamped installed Compose, Nginx, and systemd backups with
   their original ownership/modes. Run `docker compose ... config`, disposable
   `nginx -t`, and `systemd-analyze verify` before reload/recreate.
3. Reload systemd. Recreate only the affected web service through the existing
   integrator. Confirm its original port and static site. Removing the
   read-only ticket mount/location returns the previous static-only behavior.
4. Preserve the instance data and secret file for investigation; do not print
   or delete credentials. If snapshot rollback is required and retention
   permits it, atomically restore a separately retained, previously validated
   `current` directory. Never rerun sync merely to roll back.
5. After verification, remove the unused local sync image only under a separate
   reviewed cleanup. Do not change the other environment or production.

Because `web` does not depend on `ticket-sync`, disabling the timer, restoring
the old Nginx configuration, or losing all ticket data leaves the last-good
static Astro site available.
