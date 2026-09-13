import { readFile, writeFile, mkdir, copyFile, chmod, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { TEAM_LOCATIONS } from './locations.mjs';
import { themeSettings, renderThemeStyles } from './themes.mjs';

const DIVISION_TEAMS = {
  'NFC West': ['ARI', 'LAR', 'SEA', 'SF'], 'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
  'NFC East': ['DAL', 'NYG', 'PHI', 'WAS'], 'NFC South': ['ATL', 'CAR', 'NO', 'TB'],
  'AFC West': ['DEN', 'KC', 'LAC', 'LV'], 'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
  'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'], 'AFC South': ['HOU', 'IND', 'JAX', 'TEN'],
};
const IDENTITIES = {
  seahawks: ['SEA', 'NFC West'], broncos: ['DEN', 'AFC West'], packers: ['GB', 'NFC North'],
  vikings: ['MIN', 'NFC North'], chiefs: ['KC', 'AFC West'], patriots: ['NE', 'AFC East'],
};

export function teamSettings(value) {
  const slug = String(value ?? '').trim().toLowerCase();
  // These tokens can occur inside identifiers as well as names and URLs.
  if (!/^[a-z]{2,30}$/.test(slug)) {
    throw new Error('Supply TEAM as one lowercase team word, for example TEAM=broncos or TEAM=patriots (2–30 letters).');
  }
  if (!Object.hasOwn(TEAM_LOCATIONS, slug)) {
    throw new Error(`No location configured for TEAM=${slug}. Add it to template-tools/locations.mjs.`);
  }
  return { slug, name: slug[0].toUpperCase() + slug.slice(1), upper: slug.toUpperCase(), location: TEAM_LOCATIONS[slug],
    abbreviation: IDENTITIES[slug]?.[0], division: IDENTITIES[slug]?.[1], theme: themeSettings(slug) };
}

export function renderText(text, team) {
  // Keep existing full-name templates working, including line-wrapped names.
  // Standalone Seattle facts, code identifiers, and seattle-... URLs are retained.
  const withLocation = text.replace(/\b(?:Seattle|SEATTLE|seattle)(?=\s+\{(?:Team|TEAM|team)\})/g,
    (word) => word === 'SEATTLE' ? team.location.toUpperCase() : word === 'seattle' ? team.location.toLowerCase() : team.location);
  return withLocation.replace(/\{(?:team|Team|TEAM|Location|LOCATION|ThemeKey|ThemeStylesheet|ThemeFavicon|BrandMark|HeroMark|FanTagline|Abbreviation|Division|DivisionSlug|DivisionTeams|Conference)\}/g, (token) => ({
    '{team}': team.slug, '{Team}': team.name, '{TEAM}': team.upper,
    '{Abbreviation}': team.abbreviation ?? (team.slug === 'seahawks' ? 'SEA' : team.slug === 'broncos' ? 'DEN' : ''),
    '{Location}': team.location, '{LOCATION}': team.location.toUpperCase(),
    '{ThemeKey}': team.theme.key, '{ThemeStylesheet}': team.theme.stylesheet,
    '{ThemeFavicon}': team.theme.favicon, '{BrandMark}': team.theme.brandMark,
    '{HeroMark}': team.theme.heroMark, '{FanTagline}': team.theme.fanTagline,
    '{Division}': team.division ?? '', '{Conference}': team.division?.split(' ')[0] ?? '',
    '{DivisionSlug}': (team.division ?? '').toLowerCase().replaceAll(' ', '-'),
    '{DivisionTeams}': JSON.stringify(DIVISION_TEAMS[team.division] ?? []),
  })[token]);
}

async function walk(root, directory = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (!directory && ['.git', 'node_modules', 'dist', '.astro', '.team-build', '.sites-runtime', 'runtime', 'template-tools'].includes(entry.name)) continue;
    if (!directory && entry.name.startsWith('.sfz-publish')) continue;
    if (!directory && ['package.json', 'package-lock.json', 'README.md', '.gitignore'].includes(entry.name)) continue;
    if (entry.name === '.env' || entry.name.startsWith('.env.') || entry.name.endsWith('.log')) continue;
    const relative = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Template source must not contain symlinks: ${relative}`);
    if (entry.isDirectory()) files.push(...await walk(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

export async function renderProject(root, destination, team, { linkDependencies = true, newsSite } = {}) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const sources = await walk(root);
  const historyPrefix = 'src/data/history/';
  const selectedHistory = `${historyPrefix}${team.slug}.json`;
  if (sources.some(relative => relative.startsWith(historyPrefix))) {
    if (!sources.includes(selectedHistory)) {
      throw new Error(`Add sourced history for TEAM=${team.slug} at ${selectedHistory} before building. History is never borrowed from another team.`);
    }
    const history = JSON.parse(await readFile(path.join(root, selectedHistory), 'utf8'));
    if (history.team !== team.slug) throw new Error(`History team does not match TEAM=${team.slug}: ${selectedHistory}`);
  }
  const outputs = new Set();
  for (const relative of sources) {
    if (relative === 'config/active-sites.json' || relative === 'src/data/news-site.json') continue;
    // Only the selected history enters Astro. Facts and citations are literal data.
    if (relative === 'src/data/history-timeline.json') continue;
    if (relative.startsWith(historyPrefix) && relative !== selectedHistory) continue;
    if (relative.startsWith('public/styles/themes/') && relative !== `public${team.theme.stylesheet}`) continue;
    if (relative.startsWith('public/favicons/') && relative !== `public${team.theme.favicon}`) continue;
    if (team.slug !== 'seahawks' && relative.startsWith('public/images/news/generated/')) continue;
    const renderedPath = renderText(relative, team);
    if (outputs.has(renderedPath)) throw new Error(`Two template files render to ${renderedPath}`);
    outputs.add(renderedPath);
    const target = path.join(destination, renderedPath);
    await mkdir(path.dirname(target), { recursive: true });
    const source = path.join(root, relative);
    const buffer = await readFile(source);
    let content;
    try { content = decoder.decode(buffer); } catch { content = null; }
    if (relative === 'src/data/news/generated-articles.json') {
      const original = JSON.parse(content);
      // These records are content, not string-substitution templates.
      const articles = original.articles.filter(article => (article.team ?? 'seahawks') === team.slug)
        .map(article => ({ ...article, team: article.team ?? 'seahawks' }));
      await writeFile(target, JSON.stringify({ ...original, team: team.slug, articles }, null, 2) + '\n');
    } else if (relative.startsWith(historyPrefix) || relative === 'src/lib/news.ts' || relative === 'src/data/around-the-web.ts' || relative.startsWith('src/data/news/')) {
      await copyFile(source, target);
    } else if (content === null || buffer.includes(0)) await copyFile(source, target);
    else await writeFile(target, renderThemeStyles(renderText(content, team), relative, team.theme));
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'template-tools/files.json'), 'utf8'));
  for (const entry of manifest) {
    // Preserve executable scripts; new source files can be run with node/python/bash.
    if (outputs.has(renderText(entry.path, team))) await chmod(path.join(destination, renderText(entry.path, team)), Number(entry.mode));
  }
  const pkg = JSON.parse(renderText(await readFile(path.join(root, 'template-tools/upstream-package.json'), 'utf8'), team));
  if (newsSite) {
    await mkdir(path.join(destination, 'src/data'), { recursive: true });
    await writeFile(path.join(destination, 'src/data/news-site.json'), JSON.stringify(newsSite, null, 2) + '\n');
  }
  await writeFile(path.join(destination, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  if (linkDependencies) await symlink(path.join(root, 'node_modules'), path.join(destination, 'node_modules'), 'dir');
  await writeFile(path.join(destination, '.template-team.json'), JSON.stringify({ team: team.slug, theme: team.theme.key, kind: 'word-substitution-template' }, null, 2) + '\n');
  return sources.length;
}
