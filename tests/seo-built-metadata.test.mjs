import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const artifact = new URL("./artifacts/seo-duplicate-metadata-report.json", import.meta.url);
const hubs = new Set(["/", "/news", "/schedule", "/players", "/tickets", "/history", "/team/injuries", "/team/transactions", "/standings", "/team"]);

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? htmlFiles(join(directory, entry.name)) : entry.name.endsWith(".html") ? [join(directory, entry.name)] : []));
  return nested.flat();
}

function decode(value = "") {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
}

function content(html, name) {
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  const tag = tags.find((candidate) => new RegExp(`(?:name|property)=["']${name}["']`, "i").test(candidate));
  return decode(tag?.match(/content=["']([^"']*)["']/i)?.[1]);
}

function pathFor(file) {
  const path = relative(new URL(dist).pathname, file).replaceAll("\\", "/");
  if (path === "index.html") return "/";
  return `/${path.replace(/\/index\.html$/, "").replace(/\.html$/, "")}`;
}

function duplicates(pages, field) {
  const groups = new Map();
  for (const page of pages.filter((item) => !item.noindex)) {
    if (!page[field]) continue;
    groups.set(page[field], [...(groups.get(page[field]) ?? []), page.path]);
  }
  return [...groups.entries()].filter(([, paths]) => paths.length > 1).map(([value, paths]) => ({ value, paths })).sort((a, b) => a.value.localeCompare(b.value));
}

test("built pages have distinct metadata and complete hub SEO", async () => {
  const files = await htmlFiles(new URL(dist));
  const pages = await Promise.all(files.map(async (file) => {
    const html = await readFile(file, "utf8");
    const path = pathFor(file);
    const title = decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
    const description = content(html, "description");
    const robots = content(html, "robots");
    const canonical = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? "";
    const h1Count = (html.match(/<h1(?:\s|>)/gi) ?? []).length;
    return { path, title, description, canonical, robots, noindex: /\bnoindex\b/i.test(robots), h1Count };
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    scope: "All built, indexable HTML pages",
    pageCount: pages.length,
    indexablePageCount: pages.filter((page) => !page.noindex).length,
    duplicateTitles: duplicates(pages, "title"),
    duplicateDescriptions: duplicates(pages, "description"),
  };
  await mkdir(new URL("./artifacts/", import.meta.url), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);

  assert.deepEqual(report.duplicateTitles, []);
  assert.deepEqual(report.duplicateDescriptions, []);
  for (const path of hubs) {
    const page = pages.find((item) => item.path === path);
    assert.ok(page, `missing built hub ${path}`);
    assert.equal(page.h1Count, 1, `${path} must contain one H1`);
    assert.ok(page.title, `${path} must have a title`);
    assert.ok(page.description, `${path} must have a meta description`);
    assert.equal(new URL(page.canonical).pathname.replace(/\/$/, "") || "/", path, `${path} must self-canonicalize`);
  }
  assert.equal(pages.find((page) => page.path === "/")?.title, "Seattle {Team} News, Schedule, Roster and Analysis");
});
