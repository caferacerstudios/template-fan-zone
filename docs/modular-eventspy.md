# Team ticket snapshots

`TEAM=seahawks` and `TEAM=broncos` select the team's real schedule, reviewed
EventSpy event IDs, browser snapshot validator, logos, and ticket feed path.
The template's local `config/active-sites.json` uses the same JSON document as
the Airflow Variable `fan_zone_active_sites`. `ACTIVE_SITES_FILE` can point to an
Airflow JSON variable export. Export changes from Airflow to this file before
building if you changed a team's identity or EventSpy paths.

| Team | Producer output directory | Template browser URL |
| --- | --- | --- |
| Seahawks | `/var/lib/sfz-eventspy-mirror/dev/public` | `/data/eventspy-mirror/seahawks/<gameId>.json` |
| Broncos | `/var/lib/boncosfz-eventspy-mirror/dev/public` | `/data/eventspy-mirror/broncos/<gameId>.json` |

The existing Seattle production site's legacy URL and JSON format remain
unchanged. The template web server maps each prefixed URL to its corresponding
read-only output directory. Ticket prices load at runtime, so price updates do
not need a new Astro build. Schedule/page changes do need a build.

EventSpy URLs live in `config/eventspy/seahawks.json` and `broncos.json`.
Broncos IDs are bound to the authenticated balldontlie schedule by actual team
pair, season, week and home/away status. Unknown IDs are never invented.
Unavailable EventSpy pages remain explicit unavailable coverage. A missing or
foreign team schedule fails the build without publishing a new `dist/`.

Completed games remain in the website coverage so existing ticket history is
readable. The Airflow collector separately skips requests for completed games.

## Broncos build on wkr

After the EventSpy installer has populated the team schedule cache:

```bash
cd /home/laurawkr/templatefanzone
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app \
  --mount type=bind,src=/var/lib/boncosfz-news,dst=/var/lib/boncosfz-news,readonly \
  --mount type=bind,src=/var/lib/fanzone-eventspy/schedules,dst=/var/lib/fanzone-eventspy/schedules,readonly \
  -e TEAM=broncos -e NPM_CONFIG_CACHE=/tmp/npm-cache \
  node:22-bookworm npm run build
```

For Seattle, select `TEAM=seahawks` and mount `/var/lib/sfz-news` in place of
`/var/lib/boncosfz-news`. Its existing NFL snapshot path and importer are
preserved. If mounted, `/var/lib/sfz-nfl` supplies the newest Seattle schedule;
otherwise the template retains its validated Seattle repository schedule.

Other team data pipelines are still separate future work. For non-Seattle
builds, untagged copied Seattle recaps, game-day guides, roster, player profiles,
injuries and transactions are omitted from the generated working copy. Existing
source files stay intact. Explicitly team-tagged replacements can be used when
those pipelines are connected. Seattle's online prebuild remains unchanged;
other teams import news and their preselected schedule without invoking the
old Seattle refresh/generation jobs.

## Checks

```bash
node --test template-tools/eventspy.test.mjs
```

The checks verify team schedule isolation, correct home/away and logos for the
shared Seahawks-at-Broncos game, snapshot identity rejection, preserved Seattle
history, and an offline Broncos page build. Synthetic test IDs exist only in a
temporary directory and are never production game data.
