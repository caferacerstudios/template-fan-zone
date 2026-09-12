import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertCanonicalResult,
  followRedirectChain,
  redirectCases,
  REPRESENTATIVE_PATHS,
} from "../scripts/check-redirect-chains.mjs";

const nginx = await readFile(new URL("../nginx/default.conf", import.meta.url), "utf8");
const astro = await readFile(new URL("../astro.config.mjs", import.meta.url), "utf8");
const deployment = await readFile(new URL("../deployment/deploy-ticket-page-production.sh", import.meta.url), "utf8");

function configuredResponse(url) {
  const canonicalPath = url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "");
  if (url.protocol !== "https:" || url.hostname === "www.{team}fanzone.com") {
    return { status: 301, location: `https://{team}fanzone.com${url.pathname}${url.search}` };
  }
  if (url.pathname !== canonicalPath) {
    return { status: 301, location: `https://{team}fanzone.com${canonicalPath}${url.search}` };
  }
  return { status: 200 };
}

test("Astro and the one Nginx canonicalization layer use the no-trailing-slash policy", () => {
  assert.match(astro, /site:\s*["']https:\/\/{team}fanzone\.com["']/);
  assert.match(astro, /trailingSlash:\s*["']never["']/);
  assert.match(nginx, /return 301 https:\/\/{team}fanzone\.com\$request_uri;/);
  assert.match(nginx, /location ~ \^\(\.\+\)\/\$[\s\S]*?return 301 https:\/\/{team}fanzone\.com\$1\$is_args\$args;/);
  assert.match(nginx, /try_files \$uri \$uri\/index\.html =404;/);
  assert.doesNotMatch(nginx, /try_files \$uri \$uri\/ =404;/);
});

test("production deploy recreates Nginx and runs the redirect acceptance checker", () => {
  assert.match(deployment, /docker compose up -d --force-recreate web/);
  assert.match(deployment, /docker exec {team}fanzone-web nginx -t/);
  assert.match(deployment, /node scripts\/check-redirect-chains\.mjs http:\/\/127\.0\.0\.1:4322/);
  assert.doesNotMatch(deployment, /127\.0\.0\.1:4322\/tickets\//);
});

test("all representative URL variants terminate once at a canonical 200", async () => {
  assert.deepEqual(REPRESENTATIVE_PATHS, ["/", "/news", "/schedule", "/players", "/tickets", "/games/1392216"]);
  for (const [name, initialUrl] of redirectCases()) {
    const chain = await followRedirectChain(initialUrl, async (url) => configuredResponse(url));
    assert.doesNotThrow(() => assertCanonicalResult(initialUrl, chain), name);
    assert.ok(chain.length <= 3, `${name} should use no more than two redirects`);
  }
});

test("chain checker rejects repeated URLs and slash cycles", async () => {
  await assert.rejects(
    followRedirectChain("https://{team}fanzone.com/tickets", async (url) => ({
      status: 301,
      location: url.pathname.endsWith("/") ? "/tickets" : "/tickets/",
    })),
    /slash\/no-slash cycle|repeated URL/,
  );
  await assert.rejects(
    followRedirectChain("https://{team}fanzone.com/news", async () => ({ status: 301, location: "/news" })),
    /repeated URL/,
  );
  await assert.rejects(
    followRedirectChain("http://www.{team}fanzone.com/news", async (url) => ({
      status: 301,
      location: `https://redirect-${Number(url.hostname.match(/\d+/)?.[0] ?? 0) + 1}.example/news`,
    })),
    /more than 8 redirects/,
  );
});
