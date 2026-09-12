import site from '../data/news-site.json' with { type: 'json' };

export const NEWS_SITE = site;

// Only the existing Seattle collection can omit the new identity field.
// Never infer a new team's identity from the build selection or its directory.
export function assertNewsTeam(value, expectedTeam, label = 'News data') {
  const actual = value?.team;
  if (actual === expectedTeam || (actual === undefined && expectedTeam === 'seahawks')) return;
  throw new Error(`${label} belongs to ${actual ?? 'an untagged team'}, expected ${expectedTeam}`);
}

export function tagNewsCollection(document, selected = NEWS_SITE) {
  assertNewsTeam(document, selected.team, 'News collection');
  return { ...document, team: selected.team, articles: document.articles.map(article => {
    assertNewsTeam(article, selected.team, `Article ${article.slug}`);
    return { ...article, team: selected.team, tags: [...new Set([...article.tags, selected.team])] };
  }) };
}
