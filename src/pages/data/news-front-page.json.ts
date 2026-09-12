import { coverageArticles } from '../../lib/news';
export const prerender = true;
export function GET() {
  const data = coverageArticles.slice(0, 7).map(({team, slug, headline, publishedAt, status, hero}) => ({team, slug, headline, publishedAt, status, hero}));
  return new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json; charset=utf-8'}});
}
