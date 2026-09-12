# Fan Zone modular template

An independent copy of `caferacerstudios/seahawks-fan-zone`, source commit
`4aaeeae` (the default branch downloaded for this change).

This template supports **build-time team names, locations, presentation themes, and team-specific news imports**. NFL statistics and other pipelines still need their multi-team migration. The original code, content, tests, assets, and operational examples
are retained, with the source team's word changed to template tokens.

## Build

Use Node 22 or newer and install the existing locked dependencies once:

```bash
npm ci
TEAM=broncos npm run build
TEAM=seahawks npm run build
```

The finished static site is in `dist/`. `TEAM` is required and accepts a configured
slug of 2–30 letters. It is normalized to lowercase. The build deliberately uses the
existing **offline** Astro build after importing the selected team's local news snapshot. It does not refresh APIs or spend money generating content. There is no automatic deployment.

| Source token | `TEAM=broncos` result | Use |
| --- | --- | --- |
| `{team}` | `broncos` | URLs, filenames, lower-case wording, identifiers |
| `{Team}` | `Broncos` | Titles, labels, name case |
| `{TEAM}` | `BRONCOS` | Uppercase wording and environment-variable names |
| `{Location}` | `Denver` | Team-name prefix and location labels |
| `{LOCATION}` | `DENVER` | Uppercase location labels |

`template-tools/locations.mjs` supplies the location from the same `TEAM` value:
Broncos use Denver, Patriots use New England, and Seahawks use Seattle. It includes
the 31 NFL team nicknames compatible with the existing letters-only slug format.
The numeric `49ers` slug still needs a separate identifier-handling change; it is
not enabled by this wording update. To add a custom letters-only team, add its
slug and location to that small mapping and add its entry to `config/active-sites.json`. An unknown slug fails before rendering. Configured `name` and `city` in that JSON supply the displayed names.

Existing `Seattle {Team}` text also receives the configured location, including
names split across lines. Standalone UI branding uses `{Location}` explicitly.
This fixes the homepage heading, coverage label, tagline, full team names and
related page metadata without globally replacing Seattle as a real place.

Tokens are rendered in template file contents **and filenames**, before Astro or Node
parses the files. Do not run Astro or the source scripts directly against the
unrendered template. Use the npm commands instead. The tokens in JavaScript,
TypeScript, and Astro files are intentionally template syntax.

Each build, dev start, or render creates a fresh `.team-build/<team>/` working copy, and builds copy
successful output to `dist/`. Rebuilding never modifies the template files. Binary
images are copied byte for byte. CSS colors, typography, and branding are
selected by the team theme. Existing photos and other image content are retained.
Text in SVG assets is templated. Run only one template command at
a time in a checkout because `dist/` is shared; use separate checkouts for parallel
sites. A failed import or build preserves the previous successful `dist/`. Tagged news and its referenced photos are retained separately in each team workspace across rebuilds.

## Team styling

The same `TEAM` value selects location and appearance:

| TEAM | Location | Appearance |
| --- | --- | --- |
| `seahawks` | Seattle | Existing navy/green styles, SFZ mark and 12 watermark. |
| `broncos` | Denver | Orange/navy/white, BFZ mark, DEN watermark, heavier type and a Broncos favicon. |
| Other configured slugs | From `locations.mjs` | Shared base palette with a generic fan-site mark until a theme is added. |

`template-tools/themes.mjs` holds the small theme registry and brand-color mapping.
Broncos-specific presentation is in `public/styles/themes/broncos.css`. To add a
theme, add a registry entry and its stylesheet; the build selects it automatically.
Use the existing Seahawks entry for a theme that preserves the base appearance.

The renderer changes legacy brand colors in CSS and component style blocks only.
It keeps semantic success, loss, warning and dedicated lowest-price colors.
The Seahawks palette is a pass-through; it receives no additional stylesheet.
No dependencies, API calls, client-side theme switcher or server configuration
are added. Team-owned logos in the data and existing article photos remain part
of the original snapshot; presentation themes do not update that data.

Your server project root is `/home/laurawkr/templatefanzone`. Extract repository
updates directly there. Keep its `.git`, `template-preview.conf` and installed
dependencies in place. The archive has source files at its root, with no nested
`template-fan-zone/` directory and no Git metadata or environment files.

```bash
TEAM=broncos npm run dev
TEAM=broncos npm run render       # inspect rendered sources and nginx examples
npm run test:template            # validate the renderer
TEAM=broncos npm test            # original tests against the rendered project
```

Edit the root template files, not `.team-build/`. New files under the root source
directories are automatically included. `.env` files are not copied: supply any
needed settings through the environment. The copied upstream npm commands remain
available through the wrapper; their effects and generated files stay inside the
rendered working copy. Other utility commands reuse an existing rendered copy,
including its built files. A later build/render/dev start resets that copy while retaining tagged news and its images; other changes
made by standalone fetch/generation utilities are temporary. Run the composite
`build:refresh` when testing the original refresh-and-build sequence. `preview` keeps and serves an existing rendered build; use
`TEAM=broncos npm run preview` after a Broncos build.

## Team articles and photo folders

See [docs/modular-news.md](docs/modular-news.md) for the server build command,
photo folders, Airflow handoff, and the team-tagged snapshot contract.
`config/active-sites.json` contains the JSON value intended for the Airflow
Variable `fan_zone_active_sites`. The website reads this local file; it does not
connect to the Airflow UI. `ACTIVE_SITES_FILE` selects an exported config file.
Airflow's `enabled` flag controls scheduling, not explicit `TEAM=...` builds.

| Team | Article snapshot | Photo input folder |
| --- | --- | --- |
| Seahawks | `/var/lib/sfz-news/current` | `/var/lib/sfz-news/photos` |
| Broncos | `/var/lib/boncosfz-news/current` | `/var/lib/boncosfz-news/photos` |

The Broncos path intentionally preserves the requested `boncosfz` spelling.
The producer chooses and retains a photo when it accepts an article. The build
imports those exact bytes from the snapshot; it never chooses from `photos/`.
New-team snapshots must carry the matching `team` in the manifest, collection,
and every article. Legacy untagged Seattle snapshots are accepted as Seattle
only. A missing snapshot retains that team's previously validated articles; a
new team with no articles displays an empty news page, never copied Seattle news.
A malformed or wrong-team snapshot fails the build.

Authored Seattle articles, their citations, and correction overlays now remain
literal original content. They are excluded from other teams, not renamed.
Adding a manually authored story for another team requires an explicit `team`
field on that story. All news collections and the front-page photo catalog are
filtered by the build's team.

## Remaining scope

**A Broncos or Patriots build is a template demonstration, not publishable team
coverage yet.** Outside the news pipeline, it still substitutes the original team's word in template JSON, URL strings, validators, and identifiers. It
does not research or rewrite the surrounding facts. In particular:

- Standalone Seattle references in factual content, `SEA`, numeric API/team IDs, NFC West, stadium names, player identities,
  schedules, scores, historical claims, and the local timezone are still from the
  original copy. Team-specific article imports do not correct the other data.
- External citations and official-team URL paths containing the token also change;
  links outside the news pipeline still need real per-team source configuration before publishing.
- The source domain is templated to `<team>fanzone.com`; actual domains and email
  addresses must be configured before deployment. No domains are registered here.
- Team/player logos, photos, and existing editorial artwork remain the original assets. Any text
  baked into bitmap images cannot be changed by word substitution.
- This does not migrate Airflow, ticket snapshots, credentials, Docker mounts,
  services, timers, ports, or anything from the server filesystem.

The source content is deliberately retained because this step is a copy, not a
content deletion or a data-pipeline migration. Before a real second team is
published, connect that team's IDs and feeds, supply its news snapshot and replace its history/assets,
and check its external links and hosting settings.

The original online build is available as `TEAM=<word> npm run build:refresh` for
the later pipeline setup. It invokes the original refresh/import/generation
commands **inside the rendered copy**. Do not use it as a working multi-team feed
until those team IDs and source settings have been configured.

Original project instructions are in [docs/upstream-README.md](docs/upstream-README.md).
They now contain placeholders; server-copy and deployment steps will be handled
separately after this repository is created.
