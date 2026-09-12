import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const visibleText = (html) => html
  .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes:true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? htmlFiles(join(directory,entry.name)) : entry.name.endsWith(".html") ? [join(directory,entry.name)] : []))).flat();
}

const routeFor = (root,file) => {
  const name = relative(root,file).replaceAll("\\","/");
  return name === "index.html" ? "/" : `/${name.replace(/\/index\.html$/,"").replace(/\.html$/,"")}`;
};

export async function validateAdsenseReadiness(outputUrl) {
  const root = outputUrl instanceof URL ? outputUrl.pathname : String(outputUrl);
  const sitemap = await readFile(join(root,"sitemap.xml"),"utf8");
  const sitemapPaths = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname.replace(/\/$/,"") || "/"));
  const errors = [];
  const pages = await Promise.all((await htmlFiles(root)).map(async (file) => ({ file,route:routeFor(root,file),html:await readFile(file,"utf8") })));
  for (const page of pages) {
    const indexable = /<meta name="robots" content="[^"']*\bindex\b/i.test(page.html) && !/<meta name="robots" content="[^"']*\bnoindex\b/i.test(page.html);
    const text = visibleText(page.html);
    if (indexable && /\bcoming soon\b/i.test(text)) errors.push(`${page.route}: indexable page exposes coming-soon content`);
    if (indexable && page.route.startsWith("/players/") && (!/\bBiography\b/i.test(text) || text.length < 700)) errors.push(`${page.route}: indexable player profile lacks meaningful player-specific content`);
    if (!indexable && sitemapPaths.has(page.route)) errors.push(`${page.route}: incomplete/noindex page is included in sitemap`);
    if (!indexable && (/<ins\b[^>]*\badsbygoogle\b/i.test(page.html) || /data-monetization-eligible="true"/i.test(page.html))) errors.push(`${page.route}: incomplete/noindex page receives an ad slot`);
  }
  const home = pages.find((page) => page.route === "/")?.html ?? "";
  const roster = pages.find((page) => page.route === "/players")?.html ?? "";
  const homeCount = home.match(/class="dominant">(\d+)<\/strong><b>Current players/i)?.[1];
  const rosterCount = roster.match(/(\d+) active players/i)?.[1];
  if (homeCount && rosterCount && homeCount !== rosterCount) errors.push(`roster total conflict: homepage ${homeCount}, roster ${rosterCount}`);
  if (errors.length) throw new Error(`AdSense readiness validation failed:\n- ${errors.join("\n- ")}`);
  return true;
}
