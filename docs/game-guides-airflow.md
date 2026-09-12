# Game-day and viewing snapshots

The new guide producer publishes two JSON files in an independent team snapshot:
`game-day-guides.json` and `watch-guide.json`. The template imports these only when
this checkout explicitly enables `FAN_ZONE_GUIDES_ENABLED=1`. The default is off.
Creating a snapshot does not rebuild a website or change the served HTML.

Existing source JSON, news/NFL/recap/roster/ticket snapshots, nginx configuration,
and deployment commands remain independent of guide collection. The importer
writes only to the selected `.team-build/<team>/src/data/nfl` workspace, after the
existing EventSpy and NFL importers have selected the correct team.

## Preview the first collection

Wait for the team's guide task and receipt to succeed. In a checkout containing
this reviewed branch, build a staged preview with the feature enabled:

```bash
cd /home/laurawkr/templatefanzone
FAN_ZONE_GUIDES_ENABLED=1 bash template-tools/build-team.sh seahawks --stage-only
```

`--stage-only` keeps the currently served `dist/` intact. Inspect the staged
`.team-build/seahawks/dist/games/<gameId>/index.html` before using the normal
preview build command. Do not run this test from the production checkout.

An exported value overrides `.env`. To persist opt-in in the preview checkout,
set `FAN_ZONE_GUIDES_ENABLED=1` in that checkout's `.env`. The helper reads only
this flag and mounts the selected guide snapshot parent read-only. It forwards
an explicit `0` when disabled, so local settings cannot reverse an exported
override. No provider API key is needed by the website build.

The guide directory is derived from `news_snapshot_dir`: replace `-news/current`
with `-guides/current`. No new fields are added to `fan_zone_active_sites`.

| Team | Snapshot |
| --- | --- |
| Seahawks | `/var/lib/sfz-guides/current` |
| Broncos | `/var/lib/boncosfz-guides/current` |
| Packers | `/var/lib/packersfz-guides/current` |
| Vikings | `/var/lib/vikingsfz-guides/current` |
| Chiefs | `/var/lib/chiefsfz-guides/current` |

Production adoption remains a separate reviewed code promotion and explicit
opt-in using the existing production deployment process. The guide DAG and
importer do not deploy anything. To stop importing guides, set the flag to `0`
for the next build; this does not itself change already served HTML.

## Producer contract

The `current` symlink resolves inside its team snapshot root. Each immutable
collection contains a regular `manifest.json` and exactly these hashed artifacts:

```json
{
  "schema_version": 1,
  "pipeline": "guides",
  "team": "seahawks",
  "season": 2026,
  "runId": "airflow-run-id",
  "updatedAt": "2026-09-12T20:00:00Z",
  "files": {
    "game-day-guides.json": "<SHA-256 of exact file bytes>",
    "watch-guide.json": "<SHA-256 of exact file bytes>"
  }
}
```

Both artifacts have `schemaVersion: 1`, `team`, and `season`. The game-day file
retains the existing `games` map keyed by game ID. Its entries retain the current
rendered fields: summary, alerts, transportation, parking, timeline, tailgates,
watchParties, stadiumTips, weather, and sources. Section entries link to one of
their record's source URLs. `stadiumTips` uses `details`; watch-party `specials`
is a string array. Unknown event prices and weather may be null.

Every record additionally identifies `gameId`, `team`, `season`, `phase` (`regular`),
`week`, and its own ISO `lastUpdated`. Game-day `game` contains `opponent`, `date`,
`homeAway`, `venue`, `startsAt`, and `timeConfirmed`. Viewing records contain these identity fields directly.
They must match the current selected NFL snapshot; an unknown date or venue uses
null, never an invented placeholder.

The watch file has `games` as an array, `timezone`, `updatedAt` as `YYYY-MM-DD`, and
`notes` as an object. It retains `national`, `localTv`, `streams`, optional `replay`,
`officialGameUrl`, and status (`scheduled`, `tbd`, or `completed`). Providers use
`name`, `url`, and optional `note`; sources use `name` and `url`. Both artifacts
cover exactly the same game IDs. A collection may cover a researched subset of
regular-season games; untouched maintained entries are retained. Preseason and
bye records are never created by this pipeline.

## Validation and failure behavior

The importer resolves `current` once, validates both files and checksums before
writing either, and rejects another team's data, wrong seasons, duplicate IDs or
weeks, unsafe source links, missing provenance, and mismatched schedule metadata.
A present invalid snapshot, broken link, or an enabled feature without a snapshot
stops the build. The existing build wrapper retains the previously published
`dist/` on failure. This validation establishes structural consistency and source
attribution; it does not prove that every reported fact is correct.

Displayed dates, kickoff labels, and matchup names come from the selected NFL
schedule. Imported viewing records carry `scheduleAuthority: "nfl-snapshot"`, so
the legacy official-guide reconciler cannot use generated text to change game
dates, times, venues, or status. Watch lookup also checks `gameId` when present.
Maintained legacy records preserve their existing reconciliation behavior.

Each viewing record displays its own source date. Refreshing one game does not
renew another game's timestamp. Collections older than 72 hours warn; original
record dates remain visible. Game-day guides retain their own `lastUpdated`.
The importer writes the watch artifact to the existing `watch-guide-2026.json`
compatibility filename used throughout the UI. The verified payload's `season`
controls matching; no unused season-named file is silently published.
