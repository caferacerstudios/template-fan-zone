#!/usr/bin/env node
// Run with node --experimental-strip-types. Reads only; makes no source/API calls.
import { authoredArticles, publishedArticles } from '../src/lib/news.ts';
const summary = ({slug, headline, publishedAt, status, hero}) => ({slug, headline, publishedAt, status, hero});
console.log(JSON.stringify({authored: authoredArticles.map(summary), visible: publishedArticles.slice(0, 7).map(summary)}));
