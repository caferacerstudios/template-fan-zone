import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedSlug = "daily-{team}-2026-09-10-week-1-showed-the-{team}-biggest-early-season-question-can-their-secondary-depth-hold-up";
const expectedHref = `/news/${expectedSlug}/`;
const fixtureHero = "/images/news/newsroom-field.svg";
const sources = [
  { label: "Fixture {Team} source", url: "https://www.{team}.com/news/fixture" },
  { label: "Fixture NFL source", url: "https://www.nfl.com/news/fixture" },
];

function generatedArticle(day, { slug, featured = false, updatedAt } = {}) {
  const publicationDay = `2026-09-${day}`;
  const publishedAt = `${publicationDay}T${day === "11" ? "02" : "15"}:00:00Z`;
  return {
    slug: slug ?? `daily-{team}-${publicationDay}-fixture-story`,
    headline: day === "10" ? "Week 1 showed the {Team}’ biggest early-season question: Can their secondary depth hold up?" : `Fixture story for September ${Number(day)}`,
    dek: "An isolated fixture used to verify the rendered homepage news ordering.",
    publishedAt, updatedAt: updatedAt ?? publishedAt,
    author: "{Team} Fan Zone", category: "Analysis", tags: ["Testing"], season: 2026, opponent: null,
    body: [{ type: "paragraph", html: `Fixture citations <a href="${sources[0].url}">[1]</a> and <a href="${sources[1].url}">[2]</a>.` }],
    sources, hero: { src: fixtureHero, alt: "Abstract football field", width: 1200, height: 675, caption: "Fixture illustration." },
    featured, status: "published", generation: { kind: "ai", publicationDay, model: "fixture" },
  };
}

function isolatedProject(t) {
  const workspaces = path.join(root, ".test-workspaces");
  mkdirSync(workspaces, { recursive: true });
  const project = mkdtempSync(path.join(workspaces, "news-route-"));
  t.after(() => {
    rmSync(project, { recursive: true, force: true });
    try { rmSync(workspaces); } catch (error) { if (error?.code !== "ENOTEMPTY") throw error; }
  });
  cpSync(root, project, {
    recursive: true,
    filter: (source) => ![".git", "dist", "node_modules", ".test-workspaces"].includes(path.basename(source)),
  });
  symlinkSync(path.join(root, "node_modules"), path.join(project, "node_modules"), "dir");
  return project;
}

function build(project, articles) {
  writeFileSync(path.join(project, "src/data/news/generated-articles.json"), JSON.stringify({ schema_version: 1, articles }));
  execFileSync("npm", ["run", "build:offline"], {
    cwd: project,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", HOMEPAGE_FEED_NOW: "2026-09-11T17:00:00Z" },
    stdio: "inherit",
  });
}

function renderedHomepage(project) {
  return readFileSync(path.join(project, "dist/index.html"), "utf8");
}

function leadDetails(html) {
  const lead = html.match(/<article class="lead-story">([\s\S]*?)<\/article>/)?.[1] ?? "";
  return {
    href: lead.match(/<h3><a href="([^"]+)"/)?.[1],
    image: lead.match(/<img src="([^"]+)"/)?.[1],
  };
}

function secondaryHrefs(html) {
  const secondary = html.match(/<div class="secondary-stories">([\s\S]*?)<\/div><a class="more-news"/)?.[1] ?? "";
  return [...secondary.matchAll(/<h3><a href="(\/news\/[^"]+\/)"/g)].map((match) => match[1]);
}

test("the homepage and news route render the newest article first and the next six originals", { timeout: 240_000 }, (t) => {
  const routeEntries = ["src/pages/news.astro", "src/pages/news/index.astro"]
    .filter((entry) => {
      try {
        readFileSync(path.join(root, entry));
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    });

  assert.deepEqual(routeEntries, ["src/pages/news/index.astro"], "/news should have one canonical page entry");

  const project = isolatedProject(t);
  const articles = ["03", "04", "05", "06", "07", "08", "09", "10"].map((day) => generatedArticle(day, {
    slug: day === "10" ? expectedSlug : undefined,
    featured: day === "03",
    updatedAt: day === "03" ? "2026-09-11T16:00:00Z" : undefined,
  }));
  build(project, articles);

  const newsroomHtml = readFileSync(path.join(project, "dist/news/index.html"), "utf8");
  const homepageHtml = renderedHomepage(project);
  assert.match(newsroomHtml, /<h1[^>]*>Seattle {Team} News and Analysis<\/h1>/i);
  assert.doesNotMatch(newsroomHtml, /Trending Now/i);
  for (const introductorySlug of ["welcome-to-the-{team}-fan-zone-newsroom", "how-we-add-context-to-{team}-roster-moves", "a-better-way-to-read-{team}-game-week"]) {
    assert.doesNotMatch(newsroomHtml, new RegExp(`news/${introductorySlug}/`), "publication information must not appear in newsroom recommendations");
    assert.doesNotMatch(homepageHtml, new RegExp(`news/${introductorySlug}/`), "publication information must not appear in homepage recommendations");
  }
  const newsLeadHref = newsroomHtml.match(/aria-labelledby="lead-story"[\s\S]*?href="(\/news\/[^"#?]+\/?)"/)?.[1];
  const homepageLead = leadDetails(homepageHtml);
  assert.equal(newsLeadHref, expectedHref, "the /news lead should be the expected September 10 article");
  assert.equal(homepageLead.href, expectedHref, "the homepage lead should be the expected September 10 article");
  assert.equal(homepageLead.image, fixtureHero, "the homepage lead should use that article's hero image");
  const secondary = secondaryHrefs(homepageHtml);
  assert.equal(secondary.length, 6, "the homepage should render six secondary stories");
  assert.equal(new Set(secondary).size, 6, "homepage secondary stories should be distinct");
  assert.ok(!secondary.includes(expectedHref), "the homepage lead should not be duplicated below itself");
  assert.doesNotMatch(homepageHtml, /class="secondary-story external"/, "external curated links should not enter the homepage story cards");

  const newer = generatedArticle("11");
  build(project, [...articles, newer]);
  const updatedHomepage = renderedHomepage(project);
  assert.equal(leadDetails(updatedHomepage).href, `/news/${newer.slug}/`, "a newer publication should automatically become the lead");
  assert.equal(secondaryHrefs(updatedHomepage)[0], expectedHref, "the previous lead should move to the top of the latest list");
});
