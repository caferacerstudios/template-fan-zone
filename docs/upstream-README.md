# {Team} Fan Zone

Astro site for independent Seattle football coverage. These controls do not imply or guarantee AdSense account approval.

## Commands

- `npm run dev` starts Astro locally.
- `npm run build` imports the latest validated Airflow NFL snapshot and builds the site. Roster refresh and recap/profile generation remain in the build and may contact their configured upstream services.
- NFL snapshots default to `/var/lib/sfz-nfl/current`. Build containers need the parent `/var/lib/sfz-nfl` mounted read-only. See [the NFL Airflow rollout](docs/nfl-airflow-migration.md) for installation, validation, and rollback.
- `npx astro build` builds from repository data without running the refresh scripts.
- `npm run refresh-team-roster` refreshes the canonical roster from the official {Team} roster page. Failed or suspicious responses preserve the checked-in last-known-good roster and print a warning; use `-- --allow-large-change` only after verifying a legitimate cutdown or expansion.

## Player-profile generation

Player profiles use the OpenAI Responses API with strict v3 structured output. The default model is `gpt-5.4-mini`, with low reasoning and low text verbosity. Editorial tiers are maintained in `src/data/team/player-profile-tiers.json`; unknown configured tiers safely use `contributor`, while players without overrides default to `contributor` when meaningful professional statistics exist and `developmental` otherwise. The generator has a local default budget of $20 per UTC month and $1 per run. Its atomic ledger and 30-minute stale lock live beside the selected profile artifact and account only for this generator. The `runtime/player-profiles/` default is for local development only and must not be committed; the generator warns because that location is disposable during deployment.

The dev deployment operator must create a host-owned writable directory and bind-mount it into the build container. Environment variables alone do not make a host path persistent or visible inside an isolated container. The `sfz-dev` wrapper is outside this repository, so an operator must apply the following host-side setup (the stock `node:22-bookworm` user is UID/GID 1000):

```sh
sudo mkdir -p /var/lib/sfz-player-profiles/dev
sudo chown 1000:1000 /var/lib/sfz-player-profiles/dev
sudo chmod 0750 /var/lib/sfz-player-profiles/dev
```

Add these exact entries to the dev wrapper's `build.env`:

```text
PLAYER_PROFILES_ARTIFACT=/var/lib/sfz-player-profiles/dev/playerProfiles.json
PLAYER_CAREER_FACTS_ARTIFACT=/var/lib/sfz-player-profiles/dev/player-career-facts.json
```

Add this argument to the wrapper's `docker run` for the `node:22-bookworm` build container:

```sh
--mount type=bind,src=/var/lib/sfz-player-profiles/dev,dst=/var/lib/sfz-player-profiles/dev,rw
```

Before a credentialed build, verify the mount from the same image and as its normal container user:

```sh
docker run --rm --user 1000:1000 \
  --mount type=bind,src=/var/lib/sfz-player-profiles/dev,dst=/var/lib/sfz-player-profiles/dev,rw \
  node:22-bookworm sh -eu -c 'test -d /var/lib/sfz-player-profiles/dev; test -w /var/lib/sfz-player-profiles/dev; touch /var/lib/sfz-player-profiles/dev/.write-test; rm /var/lib/sfz-player-profiles/dev/.write-test'
```

If the wrapper uses Compose instead, this is the equivalent mapping and environment:

```yaml
services:
  build:
    environment:
      PLAYER_PROFILES_ARTIFACT: /var/lib/sfz-player-profiles/dev/playerProfiles.json
      PLAYER_CAREER_FACTS_ARTIFACT: /var/lib/sfz-player-profiles/dev/player-career-facts.json
    volumes:
      - /var/lib/sfz-player-profiles/dev:/var/lib/sfz-player-profiles/dev:rw
```

The mounted directory consequently contains `playerProfiles.json`, `player-career-facts.json`, `usage-ledger.json`, and `generation.lock`. Startup prints both resolved paths so deployment logs can confirm the mount before a credentialed build.

To migrate existing runtime files, first validate each JSON file and then copy it without overwriting any persistent artifact already created. Run these commands from the old checkout before it is cleaned:

```sh
node -e 'JSON.parse(require("node:fs").readFileSync("runtime/player-profiles/playerProfiles.json","utf8"))'
sudo -u '#1000' cp -n runtime/player-profiles/playerProfiles.json /var/lib/sfz-player-profiles/dev/playerProfiles.json
node -e 'JSON.parse(require("node:fs").readFileSync("runtime/player-profiles/player-career-facts.json","utf8"))'
sudo -u '#1000' cp -n runtime/player-profiles/player-career-facts.json /var/lib/sfz-player-profiles/dev/player-career-facts.json
```

Skip a source file if it does not exist or fails JSON validation. Migrate `usage-ledger.json` the same way if it exists and validates; do not migrate a stale `generation.lock`.

For targeted acceptance, load `build.env` in the environment that can access the mounted directory and run only these players, one at a time:

```sh
PLAYER_PROFILE_ID=sam-darnold PLAYER_PROFILE_REFRESH_MODE=all npm run generate-player-profiles
PLAYER_PROFILE_ID=nick-emmanwori PLAYER_PROFILE_REFRESH_MODE=all npm run generate-player-profiles
PLAYER_PROFILE_ID=brock-lampe PLAYER_PROFILE_REFRESH_MODE=all npm run generate-player-profiles
```

After acceptance, prove cache persistence with two ordinary deployments using `PLAYER_PROFILE_REFRESH_MODE=stale`. Record `sha256sum /var/lib/sfz-player-profiles/dev/playerProfiles.json` after the first deployment. The second deployment must log `Profiles generated: 0` and `Requests made: 0`, and the checksum must be unchanged. Do not use `PLAYER_PROFILE_REFRESH_MODE=all` for this cache proof.

Profiles are refreshed only when their verified semantic input, model, or prompt version changes. Fetch/build timestamps are excluded. `FORCE=1` remains supported as an alias for `PLAYER_PROFILE_REFRESH_MODE=all`; all refresh modes still enforce budgets and locking.

One-time stale-profile migration:

```sh
PLAYER_PROFILE_MODEL=gpt-5.4-mini \
PLAYER_PROFILE_REFRESH_MODE=stale \
npm run generate-player-profiles
```

Target one roster slug without refreshing the rest:

```sh
PLAYER_PROFILE_ID=jaxon-smith-njigba npm run generate-player-profiles
```

Refresh career facts separately after the ordinary NFL refresh has supplied exact provider matches. The command batches players and seasons, preserves the runtime last-known-good artifact on failure, and is intentionally absent from `prebuild`:

```sh
PLAYER_PROFILE_ID=sam-darnold npm run refresh-player-career-facts
```

Curated non-statistical facts and their source references are maintained in `src/data/team/player-profile-editorial-facts.json`. Do not paste source prose into that file. Output limits are tier-aware by default: featured 2,200, core 1,700, contributor 1,250, and developmental 900 tokens. Optional controls are `PLAYER_PROFILE_MONTHLY_BUDGET_USD` (default `20`), `PLAYER_PROFILE_RUN_BUDGET_USD` (default `1`), `PLAYER_PROFILE_MAX_GENERATIONS_PER_RUN` (default `125`), `PLAYER_PROFILE_MAX_OUTPUT_TOKENS` (explicit override), and `PLAYER_PROFILE_LOCK_STALE_MS` (default `1800000`). An unknown model requires explicit `PLAYER_PROFILE_INPUT_RATE_PER_MILLION_USD` and `PLAYER_PROFILE_OUTPUT_RATE_PER_MILLION_USD`; there is no automatic model fallback.

The homepage story feed treats stories published or materially updated within 14 days as current. Set `HOMEPAGE_STORY_FRESHNESS_DAYS` at build time to change that window; editors pin a current lead with the existing article `featured` field. `HOMEPAGE_FEED_NOW` is an optional ISO date override for deterministic previews of quiet-period fallback behavior.

## Advertising, analytics, and consent

Advertising defaults off. Production must explicitly set the applicable values:

```text
ADS_ENABLED=true
PUBLIC_ADSENSE_PUBLISHER_ID=ca-pub-<real numeric publisher ID>
PUBLIC_CMP_SCRIPT_URL=https://<Google Privacy & Messaging script URL>
ADS_TXT_RECORD=google.com, pub-<real numeric publisher ID>, DIRECT, f08c47fec0942fa0
PUBLIC_ADSENSE_ARTICLE_INLINE_SLOT=<real numeric slot ID>
PUBLIC_ADSENSE_ARTICLE_END_SLOT=<real numeric slot ID>
PUBLIC_ADSENSE_FEED_BREAK_SLOT=<real numeric slot ID>
PUBLIC_ADSENSE_DESKTOP_RAIL_SLOT=<real numeric slot ID, if used>
PUBLIC_ADSENSE_STATS_BREAK_SLOT=<real numeric slot ID, if used>
PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN=<real site token>
```

Do not commit production values. `ADS_ENABLED` must be exactly `true`; otherwise AdSense stays disabled. The publisher ID must be `ca-pub-` followed by digits, and each placement renders only when its real slot ID is also present. Analytics is independently disabled when its token is absent.

Configure Google Privacy & Messaging in the AdSense account. Copy its exact Google deployment URL into `PUBLIC_CMP_SCRIPT_URL`; do not implement or emulate TCF locally. Confirm that the message covers the EEA, UK, and Switzerland as required, presents fair choices, and supports withdrawal. The persistent **Manage Privacy Choices** footer link opens the Google Privacy & Messaging revocation UI. Test accept, reject, withdrawal, and non-GDPR regions before enabling ads.

At build completion, `ADS_TXT_RECORD` replaces the non-serving comments in the generated root `/ads.txt`. An invalid configured record fails the build. Confirm that the generated file uses the publisher ID assigned to the approved account and is reachable at the production domain root.

`BaseLayout` owns the centralized `window.sfzPrivacy` state and delays AdSense and optional Cloudflare browser analytics until the CMP reports an applicable choice. `{Team}Layout` accepts `monetizationEligible={false}` for page-level exclusion. Privacy, disclosure, and 404 pages are always excluded; use the same prop for empty, under-construction, error, or other thin-content pages. Future ad slots must also check this state and must not obscure navigation or outweigh primary content.

Before launch:

1. Complete AdSense account and site review; do not assume approval.
2. Publish and verify the certified CMP configuration and privacy-choice reopening flow.
3. Verify the privacy, disclosure, and footer links on production.
4. Verify `/ads.txt` exactly matches the AdSense publisher ID.
5. Keep `ADS_ENABLED=false` until these checks pass.
6. Review AdSense Policy Center and resolve warnings before expanding placements.

<!-- Previous Astro starter documentation retained below for basic project structure. -->

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
