# Shared Fan Zone production and preview builds

Updated 2026-09-12 for the existing `wkr` deployment.

Both checkouts use `caferacerstudios/template-fan-zone`, branch `main`:

| Purpose | Checkout | Container | Host port |
| --- | --- | --- | --- |
| Seahawks production | `/home/laurawkr/seahawksfanzone` | `seahawksfanzone-web` | 4322 |
| Selected-team preview | `/home/laurawkr/templatefanzone` | `templatefanzone-web` | 4326 |

## One-time production migration

The former production container mounted `dist/` directly at
`/usr/share/nginx/html`. Modular builds replace the `dist` directory. A direct
bind can keep serving the old directory inode, so production must first use a
parent checkout mount, as the preview already does.

Run as `laurawkr`, without sudo:

```bash
cd /home/laurawkr/seahawksfanzone
python3 template-tools/deploy-production.py --check
python3 template-tools/deploy-production.py --apply
```

The check inspects the running container and its active nginx configuration.
The apply command captures the currently served pages and configuration, builds
and validates Seahawks in `.team-build/seahawks/dist`, and tests nginx before
cutover. It retains the exact running nginx image, network, port bindings,
restart policy and read-only data mounts. The replacement mounts the checkout
at `/site`, with nginx serving only `/site/dist`.

Existing Seattle tickets remain at `/var/lib/sfz-eventspy-mirror/dev/public`.
Both `/data/eventspy-mirror/<game-id>.json` and
`/data/eventspy-mirror/seahawks/<game-id>.json` are verified against that data.

The script compares the origin homepage with the staged output. A cutover or
verification failure attempts to restore the captured serving pages and config.
Backups and a deployment receipt are retained in the printed
`.sites-runtime/production-deploy-...` directory. A replaced original container
is retained stopped with its restart policy disabled to avoid a port conflict.

There is a short interruption while nginx is replaced. No remote/CDN cache
purge is performed. Live Docker verification occurs on `wkr`; local regression
tests use fixtures.

## Ordinary builds after migration

The same command works in either checkout:

```bash
bash template-tools/build-team.sh seahawks
```

For preview, use `broncos`, `packers`, `vikings`, or `chiefs` instead. Production
should remain a Seahawks build. A successful build replaces that checkout's
`dist/`; nginx sees the new output without container recreation. A failed build
retains the previous `dist/`. Run one build or migration at a time per checkout.

To validate without publishing:

```bash
bash template-tools/build-team.sh seahawks --stage-only
```

The helper mounts the selected team's existing NFL, recap, news and roster
snapshot parents plus EventSpy schedules read-only. It does not run Airflow,
generate stories, or collect data. Seed missing NFL snapshots with the existing
team task before building. Daily articles and game recaps remain separate.

The root `docker-compose.yml` and `nginx/default.conf` contain template tokens.
They are not a production restart recipe. The migration records a concrete
`compose.json` alongside the deployment receipt using the live configuration.
Ordinary site rebuilds require no `docker compose up` command.

## Local settings and readiness

The build reads only the allowlisted website settings in
`template-tools/build-settings.mjs` from the checkout's existing `.env`.
Explicit process settings take precedence. Ads and analytics configuration can
remain local; the file and collection API credentials are not copied into the
rendered project. Runtime files and publication backups are excluded from
rendering and Git.

Player-page sitemap eligibility uses the same profile and statistic inputs as
the rendered player page. Incomplete profiles remain `noindex` and are omitted
from the sitemap. The AdSense readiness gate is retained.

## Photo credits

Daily-article photo captions come from the news snapshot's `hero.caption` and
are displayed by the shared article page. Airflow owns photo selection and the
`fan_zone_photo_credits` Variable. See
`homelab-airflow/deployment/news/PHOTO_CREDITS.md` for CSV conversion and the
existing-article metadata repair. Rebuild each checkout after repairing a
snapshot to show the corrected captions there.
