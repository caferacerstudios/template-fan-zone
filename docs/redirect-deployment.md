# Canonical redirects during deployment

The public canonical origin is `https://{team}fanzone.com`. Root remains `/`;
all other page paths omit the trailing slash. Astro generates that shape and
Nginx is the single runtime layer coordinating HTTPS, `www`, and trailing-slash
normalization. Do not add a second redirect implementation at the CDN or app
layer.

Production deployment must recreate the `web` service after updating the
checkout. `nginx/default.conf` is a read-only bind mount, and a pull by itself
does not prove that the running Nginx process loaded the new configuration.
The production script force-recreates `web`, runs `nginx -t` in that container,
then runs `node scripts/check-redirect-chains.mjs` against the local published
port. The checker preserves the logical public Host and forwarded scheme,
follows at most eight redirects, rejects repeated URLs and slash/no-slash
cycles, requires a final canonical HTTPS 200, and verifies query preservation.

When a release reverses a previously deployed permanent redirect, purge the
matching Cloudflare redirect/cache entries as part of the release. Browsers may
also retain an old 301; affected clients must clear that cached redirect (or
site data). A new origin response cannot override a permanent redirect that a
browser applies without contacting the origin. Complete this purge before
accepting the release, or an old `/route` to `/route/` response can conflict
with the current `/route/` to `/route` policy.
