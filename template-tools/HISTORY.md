# Team history

`TEAM` selects one authentic history file for the shared `/history` page:

| TEAM | Source |
| --- | --- |
| seahawks | `src/data/history/seahawks.json` |
| broncos | `src/data/history/broncos.json` |
| packers | `src/data/history/packers.json` |
| vikings | `src/data/history/vikings.json` |
| chiefs | `src/data/history/chiefs.json` |
| patriots | `src/data/history/patriots.json` |

The existing build command selects history automatically. No separate history
command or Airflow variable is needed. Adding history does not activate a site;
the normal active-site, news and schedule configuration still applies to full
website builds.

## What gets published

The renderer copies only the selected history JSON into `.team-build/<team>`.
Astro imports it at build time and produces one `/history` page with that team's
headings, timeline, eras, numbers, players, sources and metadata. There is no
browser team switcher, alternate-team route, hidden alternate history, or public
history JSON endpoint. A rebuild replaces `dist`, removing the previous build.

Serve only `dist`, as the existing preview does with nginx `root /site/dist`.
The source JSON files belong in `src/data/history`, never in `public`.
Real opponents can still be named in a team's own historical accounts.

## Editing or adding history

Copy the shape of an existing JSON file, set `team` to the exact build slug and
write that franchise's actual history. Keep names and source URLs literal;
history data never goes through team-name substitution. Each timeline entry,
era and number includes its own `sourceName` and `sourceUrl`.

`heroKicker`, `heroSubtitle`, `heroDescription`, `timelineKicker`, `metaTitle`
and `metaDescription` control the page copy. `heroArtwork` selects `seattle`
(the existing illustration), `mountains` (Denver) or `stadium` (neutral artwork).
Existing site theme selection continues to control the colors.

Use season years for playoff milestones and state calendar dates in the text
when useful. Championship counts must distinguish NFL/AFL titles from Super Bowl
wins. Verify new factual claims against the linked primary records.

Missing history or a mismatched `team` stops the build instead of displaying
another franchise's story. The old `src/data/history-timeline.json` is retained
in the repository for reference but is no longer rendered or used by the page.

## Checks

Run `node --test template-tools/history.test.mjs` for the content and renderer
checks, or `npm run test:template` for all template checks. The build verification
script also checks the generated page, metadata and assets for alternate history.

```bash
node template-tools/check-history-build.mjs dist seahawks
```
