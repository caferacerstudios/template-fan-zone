import { coverageArticles } from '../../lib/news';
export const prerender = true;
export function GET() {
  const data = coverageArticles.slice(0, 7).map(({slug, headline, publishedAt, status, hero}) => ({slug, headline, publishedAt, status, hero}));
  return new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json; charset=utf-8'}});
}
