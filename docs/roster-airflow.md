# Roster, injury reports and transactions from Airflow

The `sfz_roster_refresh` DAG publishes one collection per enabled team from the
existing `fan_zone_active_sites` Airflow Variable. Tasks are named
`refresh_roster_seahawks`, `refresh_roster_broncos`, `refresh_roster_packers`,
`refresh_roster_vikings`, and `refresh_roster_chiefs`. The schedule is 05:30 and
17:30 in `America/Los_Angeles`.

The collection contains the official club roster, dated injury observations,
and official transaction-log entries. Daily news and game recaps retain their
separate DAGs and output locations. NFL game statistics, season statistics and
standings remain in `sfz_nfl_refresh`.

## Paths and configuration

No new active-site JSON field is required. Derive the roster path by replacing
the existing `news_snapshot_dir` suffix `-news/current` with `-roster/current`.
This keeps the currently installed active-site validator compatible.

| Team | Roster collection |
| --- | --- |
| Seahawks | `/var/lib/sfz-roster/current` |
| Broncos | `/var/lib/boncosfz-roster/current` |
| Packers | `/var/lib/packersfz-roster/current` |
| Vikings | `/var/lib/vikingsfz-roster/current` |
| Chiefs | `/var/lib/chiefsfz-roster/current` |

The existing spelling `boncosfz` is intentional for compatibility with the
deployed paths. `current` selects an immutable snapshot containing
`roster.json`, `injuries.json`, `transactions.json`, and `manifest.json`.
The manifest identifies the team and run and checksums exactly those three
data files with SHA-256.

## Build and rendering

Use the existing helper; it now mounts the selected team's roster parent
directory read-only when it exists:

```bash
cd /home/laurawkr/templatefanzone
bash template-tools/build-team.sh seahawks
# Or select broncos, packers, vikings, or chiefs.
```

For each team, wait for `refresh_roster_<team>` to succeed before testing its new
roster. An existing NFL snapshot is still required by the normal build helper.
The roster refresh uses the selected team's NFL data for verified identities
and dated injury-report context; it does not refresh statistics itself.

The outer template build imports roster snapshots after the EventSpy and NFL
steps so ancillary-data clearing cannot overwrite the official roster. The
routine/offline build and `build:refresh` both use the selected roster collection.
The redundant legacy roster collector and NFL/recap reimports were removed from
the inner `prebuild` step; the outer build already imports these snapshots in
the required order. News and player-profile behavior otherwise remain as before.

Only the rendered `.team-build/<team>` checkout changes. The import does not
write into outer `src/data`, generate articles, collect tickets, or publish a
different production checkout. A successful build replaces the template's
`dist/` as before; a failed import keeps the previously published preview.

For a custom Docker command, mount the whole parent such as
`/var/lib/boncosfz-roster`, not only its `current` symlink. Set
`ROSTER_SNAPSHOT_DIR` only when deliberately selecting an alternate collection;
the importer still requires the selected team's identity and valid checksums.

## Data interpretation

Current club membership comes from the roster collection. The importer updates
the selected schedule/player files' `currentRoster` projections and provenance
without changing `playerSeasonStats`, `playerStatsSeason`, game data, or standings.
Canonical player slugs and legacy routes are retained. Provider statistics join
imported current players only through a verified numeric `balldontlieId`; a
similar or matching name alone does not attach statistics or biography inputs.
Missing statistics remain missing. This update does not recalculate season totals.

Active, practice-squad, reserve, PUP, exempt, suspended and non-football-injury
statuses retain their distinctions. Removed players can remain historical
records; they are not counted as active. Original official status wording is
retained in the source data.

Transaction rows that describe multiple moves retain the complete official
wording and source link. These are `entityType: "transaction"` entries with a
stable `transaction-...` identifier, not fabricated player pages. Existing
curated player-specific records remain supported.

Injury observations are retained as a dated archive. `currentReportKeys`
selects the verified current report; an empty or unavailable report does not
make old practice observations current. The page displays the last verified
report date and any unavailable-report reason. Absence of an injury entry never
asserts that a player is healthy.

## Missing, stale and invalid collections

- No roster snapshot yet: retain Seattle's existing checked-in roster and
  updates; other teams show empty roster/update sections rather than renamed
  Seattle content or historical-player membership.
- Valid but stale snapshot: preserve its timestamps and data; warn after 72
  hours. `ROSTER_SNAPSHOT_MAX_AGE_HOURS` can enforce a stricter build cutoff.
- A broken `current` link, wrong team, invalid schema, bad checksum or invalid
  sourced record stops the build. Present invalid data never falls back to seeds.
- An unavailable injury source can still publish a verified roster/transaction
  collection with explicit injury availability and the earlier dated archive.

The helper imports data; it does not deploy or change the separate Seattle
production checkout. That checkout needs its own importer placement and
read-only snapshot mount when its production cutover is installed.

## Focused verification

```bash
node --test template-tools/roster.test.mjs
python3 -m unittest discover -s template-tools -p test_build_team.py
```

Tests cover all five identities, provenance and hashes, current-vs-historical
membership, unchanged statistics, unavailable/archived injuries, missing and
stale snapshots, generic transaction links and read-only parent mounts.
