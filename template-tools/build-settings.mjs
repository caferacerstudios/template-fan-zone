import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

// The rendered project deliberately excludes .env. Carry only the website
// settings its build reads; collection credentials stay out of the build env.
const keys = [
  'ADS_ENABLED', 'ADS_TXT_RECORD', 'PUBLIC_ADSENSE_PUBLISHER_ID', 'PUBLIC_CMP_SCRIPT_URL',
  'PUBLIC_ADSENSE_AUTO_ADS', 'PUBLIC_ADSENSE_ANCHOR_ADS', 'PUBLIC_ADSENSE_VIGNETTE_ADS',
  'PUBLIC_ADSENSE_ARTICLE_INLINE_SLOT', 'PUBLIC_ADSENSE_ARTICLE_END_SLOT',
  'PUBLIC_ADSENSE_FEED_BREAK_SLOT', 'PUBLIC_ADSENSE_DESKTOP_RAIL_SLOT', 'PUBLIC_ADSENSE_STATS_BREAK_SLOT',
  'PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN', 'PUBLIC_ANALYTICS_ENDPOINT', 'PUBLIC_ANALYTICS_EXCLUDE_HOSTS',
  'SFZ_TICKET_DATA_MODE', 'SFZ_TICKET_INDEXING_STATE', 'HOMEPAGE_STORY_FRESHNESS_DAYS',
  'FAN_ZONE_GUIDES_ENABLED',
];

export async function loadBuildSettings(root, environment = process.env) {
  let values;
  try { values = parseEnv(await readFile(path.join(root, '.env'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const key of keys) {
    if (environment[key] === undefined && values[key] !== undefined) environment[key] = values[key];
  }
}
