import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { importNewsSnapshot } from '../scripts/import-news-snapshot.mjs';
import { GENERATED_IMAGE, validateGeneratedCollection } from '../src/lib/news-artifacts.mjs';

export function loadNewsSite(root, slug, filename = process.env.ACTIVE_SITES_FILE || path.join(root, 'config/active-sites.json')) {
  const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Active sites must be a JSON object');
  // Accept the plain value and Airflow's single-variable JSON export envelope.
  const value = document.fan_zone_active_sites ?? document;
  const sites = typeof value === 'string' ? JSON.parse(value) : value;
  if (!sites || typeof sites !== 'object' || Array.isArray(sites)) throw new Error('Active sites must be a JSON object');
  if (!Object.hasOwn(sites, slug)) throw new Error(`Add ${slug} to ${filename} before building its news.`);
  const selected = sites[slug];
  if (!selected || typeof selected.enabled !== 'boolean' ||
      !['name', 'city'].every(key => typeof selected[key] === 'string' && selected[key].trim()) ||
      !Array.isArray(selected.source_domains) || !selected.source_domains.length ||
      selected.source_domains.some(domain => typeof domain !== 'string' || !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(domain))) {
    throw new Error(`Invalid news configuration for ${slug}`);
  }
  for (const key of ['news_snapshot_dir', 'news_photos_dir']) {
    if (typeof selected[key] !== 'string' || !path.isAbsolute(selected[key]) || path.normalize(selected[key]) !== selected[key]) {
      throw new Error(`${slug}.${key} must be an absolute directory path`);
    }
  }
  if (path.basename(selected.news_snapshot_dir) !== 'current' || path.basename(selected.news_photos_dir) !== 'photos' ||
      path.dirname(selected.news_snapshot_dir) !== path.dirname(selected.news_photos_dir)) {
    throw new Error(`${slug} news paths must be current/ and photos/ under the same team news directory`);
  }
  for (const [otherSlug, other] of Object.entries(sites)) {
    if (otherSlug !== slug && (other?.news_snapshot_dir === selected.news_snapshot_dir || other?.news_photos_dir === selected.news_photos_dir)) {
      throw new Error(`${slug} and ${otherSlug} must not share news or photo directories`);
    }
  }
  // enabled controls Airflow scheduling, not explicit local TEAM=... builds.
  return { team: slug, name: selected.name, city: selected.city, source_domains: selected.source_domains,
    news_snapshot_dir: selected.news_snapshot_dir };
}

export function retainNews(target, site) {
  const filename = path.join(target, 'src/data/news/generated-articles.json');
  if (!fs.existsSync(filename)) return null;
  const stored = JSON.parse(fs.readFileSync(filename, 'utf8'));
  // Pre-migration non-Seattle previews contained renamed Seattle fixtures.
  // Keep legitimate legacy Seattle history; only untagged other-team demos
  // must be discarded. Explicitly conflicting identity fails validation.
  if (stored.team === undefined && site.team !== 'seahawks') return null;
  const document = validateGeneratedCollection(stored, { site });
  const images = new Map();
  for (const article of document.articles) {
    const match = GENERATED_IMAGE.exec(article.hero.src);
    if (!match) continue;
    const bytes = fs.readFileSync(path.join(target, 'public/images/news/generated', match[1]));
    if (createHash('sha256').update(bytes).digest('hex') !== match[1].split('.')[0]) throw new Error('Retained news image checksum mismatch');
    images.set(match[1], bytes);
  }
  return { document, images };
}

export function restoreNews(target, retained) {
  if (!retained) return;
  const directory = path.join(target, 'public/images/news/generated');
  fs.mkdirSync(directory, { recursive: true });
  for (const [filename, bytes] of retained.images) fs.writeFileSync(path.join(directory, filename), bytes);
  fs.writeFileSync(path.join(target, 'src/data/news/generated-articles.json'), JSON.stringify(retained.document, null, 2) + '\n');
}

export function prepareNews(target, site) {
  const result = importNewsSnapshot({ projectRoot: target, site,
    snapshotDir: process.env.NEWS_SNAPSHOT_DIR || site.news_snapshot_dir, ifAvailable: true });
  console.log(`News (${site.team}): ${result.articleCount} generated articles; ${result.status}.`);
  return result;
}
