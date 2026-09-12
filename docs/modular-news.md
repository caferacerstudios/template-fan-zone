# Team news and photo folders

The website changes are implemented. The private Airflow repository and live
server were not accessible, so its DAG, SSH hook, host runner, and photo selector
have **not** been changed. This document defines their configuration handoff.

## Shared configuration

`config/active-sites.json` is the JSON value for the Airflow Variable
`fan_zone_active_sites`. Each entry contains identity, source domains, prompt
instructions, and explicit snapshot/photo paths:

| Team | Accepted snapshot | Drop photos here |
| --- | --- | --- |
| Seahawks | `/var/lib/sfz-news/current` | `/var/lib/sfz-news/photos/` |
| Broncos | `/var/lib/boncosfz-news/current` | `/var/lib/boncosfz-news/photos/` |

`boncosfz` is intentional: it matches the requested server directory. The team
slug remains `broncos`. Future entries can use
`/var/lib/<team-slug>fz-news/current` and `/var/lib/<team-slug>fz-news/photos`.
Always configure the paths explicitly. Do not move the working Seahawks files.

`enabled` is intended for Airflow scheduling. A manual `TEAM=broncos` build still
works when it is false. Denver is initially disabled and its BALLDONTLIE ID is
`null` pending verification; do not guess an ID or enable its data tasks yet.

The website reads the local JSON, not the Airflow API. After changing the Variable
in the UI, export/copy its value into this file before building. A single-variable
Airflow export wrapped in `fan_zone_active_sites` is also accepted. Alternatively
point `ACTIVE_SITES_FILE` at that exported file. The repository file is the
reviewable configuration; UI edits do not automatically commit themselves.

## Create the Denver photo bucket

On wkr, run as laurawkr:

```bash
sudo install -d -o laurawkr -g "$(id -gn)" -m 0755 /var/lib/boncosfz-news/photos
```

From your computer, copy photos to:

```text
laurawkr@192.168.88.3:/var/lib/boncosfz-news/photos/
```

The existing Seahawks destination stays:

```text
laurawkr@192.168.88.3:/var/lib/sfz-news/photos/
```

These are ordinary server folders, not cloud buckets. Keep the current JPEG,
PNG, WebP and optional `metadata.json` conventions. Provide subject/caption/credit
metadata for each file just as with Seahawks. Use eight or more distinct images
to support the current seven-story exclusion rule; insufficient pools should
keep the existing neutral illustration behavior. Selected photos remain attached
to their articles even when the input photo is later removed.

Do not manually create or copy a `current` snapshot. The producer publishes that
pointer only after validating a complete release.

## Build on wkr

Extract the updated source directly into `/home/laurawkr/templatefanzone`.
Keep `.git`, `template-preview.conf`, dependencies, and `.team-build` in place.
Install dependencies once with `npm ci` if they are not already installed.

```bash
cd /home/laurawkr/templatefanzone
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app \
  --mount type=bind,src=/var/lib/boncosfz-news,dst=/var/lib/boncosfz-news,readonly \
  -e TEAM=broncos -e NPM_CONFIG_CACHE=/tmp/npm-cache \
  node:22-bookworm npm run build
```

For Seahawks, use `TEAM=seahawks` and replace both mount paths with
`/var/lib/sfz-news`. Mount the complete news parent: `current` can be a symlink
into `releases`, and mounting just that symlink or `photos` is insufficient.

The build renders the selected theme, imports that team's validated articles and
retained images, then runs offline Astro. It does not generate articles or make
paid/API calls. The existing preview container serves `dist`; refresh the browser
after success. No Docker Compose command is needed for that preview.

`NEWS_SNAPSHOT_DIR` can override the source path for a test or relocated snapshot.
The team checks still apply. Source templates, server snapshots and input photos
are never rewritten by the build. If a snapshot is missing, the build retains
previous tagged news for that team; a new team starts with no articles. Corrupt,
mixed-team, or incomplete snapshots fail while the previous `dist` remains served.

## Airflow integration to apply to the real runner

Keep the existing shared DAGs and map their tasks over enabled site entries read
once at task runtime. Pass each team's validated config through the existing
restricted SSH hook/runner; preserve its command restrictions. Do not build an
arbitrary shell command from the Variable or assume the current hook accepts new
arguments before it has been updated.

For each news task:

1. Use the parent of `news_snapshot_dir` as that team's news runtime root. Keep
   days, request caches, usage, accepted articles, retained assets, releases and
   any locks under that root. Deduplicate by team and publication day.
2. Select photos only from `news_photos_dir`. Keep the existing content-hash,
   no-repeat and caption/credit behavior, using that team's accepted history and
   its own front-page catalog. Never mix another site's exclusion list.
3. Use configured name/city, allowed source domains and `prompts.article` with the
   existing shared research/writing requirements. Stamp identity from config,
   not model-generated prose. Recaps use `prompts.recap` separately.
4. Publish to exactly `news_snapshot_dir` after validating the release. Leave the
   last accepted release unchanged on failure. A Broncos task must never write
   to `/var/lib/sfz-news`.

The existing `/data/news-front-page.json` endpoint keeps its array shape and now
includes each article's `team`. `scripts/export-news-catalog.mjs` similarly keeps
its authored/visible lists and includes team identity. When wiring the producer,
use the selected site's catalog, including its currently displayed photos.

## Snapshot additions

Preserve the current version-1 structure and checksum rules. Add the same field
to the manifest, `articles.json` collection, and each generated article:

```json
"team": "broncos"
```

Example collection shape (an empty accepted collection):

```json
{"schema_version": 1, "team": "broncos", "articles": []}
```

Generated slugs remain `daily-<team>-YYYY-MM-DD-<story>`. Include the team slug in the
article's existing `tags` array, for example `"tags": ["Analysis", "broncos"]`.
The importer also ensures that tag exists in the website copy. Preserve the
existing article fields, citations, dates, disclosure and image metadata.

Recalculate checksums after writing tagged JSON. Include every historical
article and referenced hashed image in each complete snapshot; the importer
rejects a release that would erase accepted local history. New teams require
explicit identity at all three levels. Legacy untagged Seattle releases alone
remain compatible and gain tags in the imported website copy.

The website never assigns random input photos on a rebuild. It copies the
already-selected `images/<hash>.<extension>` bytes from the accepted snapshot
to `public/images/news/generated/`, verifying their hashes before exposing the
new article collection.

## Validation

`npm run test:template` covers configured paths, official source domains, team
identity rejection, legacy Seattle compatibility, per-team publication days,
raw article preservation, and retained image/history behavior. The normal build
also validates all imported articles. Other NFL datasets and their API IDs are
still from the original template; this change connects news only.
