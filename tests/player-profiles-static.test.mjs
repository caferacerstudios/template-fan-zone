import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = path.join(root, "tests/fixtures/playerProfiles.generated.json");
const fallback = "No verified biography is available in the current player data.";

test("offline rendering embeds generated profiles in final static HTML", { timeout: 120_000 }, () => {
  execFileSync("npm", ["run", "build:offline"], {
    cwd: root,
    env: { ...process.env, PLAYER_PROFILES_ARTIFACT: artifact },
    stdio: "inherit",
  });

  const numericHtml = fs.readFileSync(path.join(root, "dist/players/12345/index.html"), "utf8");
  const aliasHtml = fs.readFileSync(path.join(root, "dist/players/jaxon-smith-njigba/index.html"), "utf8");
  const missingHtml = fs.readFileSync(path.join(root, "dist/players/aj-barner/index.html"), "utf8");
  const darnoldHtml = fs.readFileSync(path.join(root, "dist/players/sam-darnold/index.html"), "utf8");

  assert.doesNotMatch(numericHtml, /SFZ PLAYER BIO ACCEPTANCE SENTINEL/);
  assert.match(numericHtml, /numeric-route-test-player/);
  assert.match(aliasHtml, /SFZ PLAYER BIO ACCEPTANCE SENTINEL/);
  assert.ok(!aliasHtml.includes(fallback));
  assert.match(aliasHtml, /season overview/i);
  assert.doesNotMatch(aliasHtml, /Gameplay recap/);
  assert.ok(missingHtml.includes(fallback));
  for (const heading of ["Biography","Career Highlights","Career at a Glance","Profile Sources","2025 Regular Season Overview"]) assert.ok(darnoldHtml.includes(heading),`missing ${heading}`);
  assert.ok(darnoldHtml.indexOf("Biography") < darnoldHtml.indexOf("Career Highlights"));
  assert.doesNotMatch(darnoldHtml,/Defense<\/h3>/);
  assert.doesNotMatch(darnoldHtml,/season season/i);
  assert.doesNotMatch(darnoldHtml,/darnold-draft-2018/);

  const sitemap = fs.readFileSync(path.join(root, "dist/sitemap.xml"), "utf8");
  const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]));
  const canonicals = [];
  for (const url of sitemapUrls) {
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "{team}fanzone.com");
    assert.equal(url.search, "");
    const relative = decodeURIComponent(url.pathname).replace(/^\//, "");
    const output = relative ? path.join(root, "dist", relative, "index.html") : path.join(root, "dist/index.html");
    assert.ok(fs.existsSync(output), `sitemap URL has no generated 200 page: ${url}`);
    const html = fs.readFileSync(output, "utf8");
    assert.doesNotMatch(html, /<meta name="robots" content="[^"]*noindex/i, `sitemap URL is noindex: ${url}`);
    const pageCanonicals = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(pageCanonicals, [url.toString()], `canonical mismatch: ${url}`);
    canonicals.push(...pageCanonicals);
  }
  assert.equal(new Set(canonicals).size, canonicals.length, "a canonical occurs more than once in sitemap output");
  assert.doesNotMatch(sitemap, /\/games\/fictional-game-home-001/);
  assert.match(sitemap, /\/games\/1392216/);
  assert.match(sitemap, /\/players\/sam-darnold/);
  assert.doesNotMatch(sitemap, /\/players\/(?:aj-barner|12345)/);
  assert.match(missingHtml, /<meta name="robots" content="noindex, follow"/);
  assert.match(aliasHtml, /<meta name="robots" content="noindex, follow"/);

  const newsSitemap = fs.readFileSync(path.join(root, "dist/news-sitemap.xml"), "utf8");
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  for (const match of newsSitemap.matchAll(/<news:publication_date>([^<]+)<\/news:publication_date>/g)) {
    assert.ok(Date.parse(match[1]) >= cutoff, `stale URL in news sitemap: ${match[1]}`);
  }
});
