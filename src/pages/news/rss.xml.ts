import type { APIRoute } from "astro";
import { publishedArticles } from "../../lib/news";
import { absoluteUrl, SITE_NAME } from "../../lib/seo";

const xml = (value: unknown) => String(value).replace(/[<>&'\"]/g, (character) => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;", "'":"&apos;", '"':"&quot;" })[character]!);

export const GET: APIRoute = () => {
  const items = publishedArticles.map((article) => `<item><title>${xml(article.headline)}</title><link>${xml(absoluteUrl(`/news/${article.slug}`))}</link><guid isPermaLink="true">${xml(absoluteUrl(`/news/${article.slug}`))}</guid><pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate><author>${xml(article.author)}</author><category>${xml(article.category)}</category><description>${xml(article.dek)}</description></item>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(SITE_NAME)} Newsroom</title><link>${xml(absoluteUrl("/news"))}</link><description>Original Seattle {Team} news, analysis and context.</description><language>en-us</language><lastBuildDate>${new Date(publishedArticles[0]?.updatedAt ?? Date.now()).toUTCString()}</lastBuildDate>${items}</channel></rss>`, { headers: { "Content-Type":"application/rss+xml; charset=utf-8", "Cache-Control":"public, max-age=900" } });
};
