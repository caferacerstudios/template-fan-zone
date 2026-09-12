import type { APIRoute } from "astro";
import { absoluteUrl, SITE_NAME } from "../lib/seo";
import { publishedArticles } from "../lib/news";

const escapeXml = (value: unknown) => String(value).replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]!);

export const GET: APIRoute = async () => {
  let recaps: any = null;
  try { recaps = (await import("../data/nfl/gameRecaps.json")).default; } catch {}
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const articles = Object.entries(recaps?.recaps ?? {}).map(([id, article]: [string, any]) => ({ id, article, date: article?.publishedAt ?? article?.createdAt }))
    .filter(({ article, date }) => article?.isNews === true && article?.headline && date && new Date(date).getTime() >= cutoff);
  const recapUrls = articles.map(({ id, article, date }) => `<url><loc>${escapeXml(absoluteUrl(`/games/${encodeURIComponent(id)}`))}</loc><news:news><news:publication><news:name>${escapeXml(SITE_NAME)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${escapeXml(new Date(date).toISOString())}</news:publication_date><news:title>${escapeXml(article.headline)}</news:title></news:news></url>`).join("");
  const newsroomUrls = publishedArticles.filter((article) => new Date(article.publishedAt).getTime() >= cutoff).map((article) => `<url><loc>${escapeXml(absoluteUrl(`/news/${article.slug}`))}</loc><news:news><news:publication><news:name>${escapeXml(SITE_NAME)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${escapeXml(article.publishedAt)}</news:publication_date><news:title>${escapeXml(article.headline)}</news:title></news:news></url>`).join("");
  const urls = recapUrls + newsroomUrls;
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${urls}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
