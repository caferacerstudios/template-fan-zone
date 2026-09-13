import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SLOT_ENV = {
  'article-inline': 'PUBLIC_ADSENSE_ARTICLE_INLINE_SLOT',
  'article-end': 'PUBLIC_ADSENSE_ARTICLE_END_SLOT',
  'feed-break': 'PUBLIC_ADSENSE_FEED_BREAK_SLOT',
  'desktop-rail': 'PUBLIC_ADSENSE_DESKTOP_RAIL_SLOT',
  'stats-break': 'PUBLIC_ADSENSE_STATS_BREAK_SLOT',
};
const FIELDS = ['phase', 'publisherId', 'productionHosts', 'cmpScriptUrl', 'slots'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(`Monetization: ${message}`); };

function requireFields(value, allowed, label) {
  if (!isObject(value)) fail(`${label} must be an object.`);
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${label} contains an unsupported field.`);
}

function emptySettings() {
  return {
    ADS_ENABLED: 'false',
    ADS_TXT_RECORD: '',
    PUBLIC_ADSENSE_PHASE: 'off',
    PUBLIC_ADSENSE_PUBLISHER_ID: '',
    PUBLIC_ADSENSE_PRODUCTION_HOSTS: '[]',
    PUBLIC_CMP_SCRIPT_URL: '',
    PUBLIC_ADSENSE_AUTO_ADS: 'false',
    PUBLIC_ADSENSE_ANCHOR_ADS: 'false',
    PUBLIC_ADSENSE_VIGNETTE_ADS: 'false',
    ...Object.fromEntries(Object.values(SLOT_ENV).map(key => [key, ''])),
    PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN: '',
    PUBLIC_ANALYTICS_ENDPOINT: '',
    PUBLIC_ANALYTICS_EXCLUDE_HOSTS: '',
  };
}

/** Select only public settings for this team; unknown teams have advertising off. */
export function selectMonetizationSettings(config, team) {
  requireFields(config, ['schemaVersion', 'teams'], 'config');
  if (config.schemaVersion !== 1 || !isObject(config.teams)) fail('config requires schemaVersion 1 and a teams object.');
  if (!/^[a-z]{2,30}$/.test(team)) fail('team must be a lowercase team slug.');
  const settings = emptySettings();
  if (!Object.hasOwn(config.teams, team)) return settings;
  const selected = config.teams[team];
  requireFields(selected, FIELDS, `teams.${team}`);
  const { phase, publisherId = '', productionHosts = [], cmpScriptUrl = '', slots = {} } = selected;
  if (!['off', 'review', 'live'].includes(phase)) fail(`${team}.phase must be off, review, or live.`);
  if (typeof publisherId !== 'string' || (publisherId && !/^ca-pub-\d{16}$/.test(publisherId))) {
    fail(`${team}.publisherId must be empty or ca-pub- followed by exactly 16 digits.`);
  }
  if (!Array.isArray(productionHosts) || productionHosts.some(host => typeof host !== 'string'
    || host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    || /(?:^|\.)(?:localhost|local|test|invalid|example)$/.test(host))) {
    fail(`${team}.productionHosts must contain lowercase public hostnames without paths, protocols, or ports.`);
  }
  if (new Set(productionHosts).size !== productionHosts.length) fail(`${team}.productionHosts contains duplicates.`);
  if (typeof cmpScriptUrl !== 'string') fail(`${team}.cmpScriptUrl must be a string.`);
  if (cmpScriptUrl) {
    let url;
    try { url = new URL(cmpScriptUrl); } catch { fail(`${team}.cmpScriptUrl is not a valid URL.`); }
    const publisher = publisherId.replace(/^ca-/, '');
    if (!publisherId || url.protocol !== 'https:' || url.hostname !== 'fundingchoicesmessages.google.com'
      || url.username || url.password || url.port || url.hash || ![`/i/${publisher}`, `/i/${publisherId}`].includes(url.pathname)
      || [...url.searchParams].some(([key, value]) => key !== 'ers' || value !== '1')) {
      fail(`${team}.cmpScriptUrl must be Google's Funding Choices /i/ URL for this publisher (optional ?ers=1).`);
    }
  }
  requireFields(slots, Object.keys(SLOT_ENV), `${team}.slots`);
  for (const value of Object.values(slots)) {
    if (typeof value !== 'string' || (value && !/^\d{1,20}$/.test(value))) fail(`${team}.slots values must be empty or numeric ad-unit ID strings.`);
  }
  if (phase !== 'off' && (!publisherId || !productionHosts.length)) fail(`${team}: review/live requires a publisher ID and productionHosts.`);
  if (phase === 'live' && (!cmpScriptUrl || !Object.values(slots).some(Boolean))) {
    fail(`${team}: live requires the matching Google consent script and at least one ad slot.`);
  }
  if (phase === 'off') return settings;
  settings.PUBLIC_ADSENSE_PHASE = phase;
  settings.PUBLIC_ADSENSE_PUBLISHER_ID = publisherId;
  settings.PUBLIC_ADSENSE_PRODUCTION_HOSTS = JSON.stringify(productionHosts);
  settings.ADS_TXT_RECORD = `google.com, ${publisherId.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0`;
  if (phase === 'live') {
    settings.ADS_ENABLED = 'true';
    settings.PUBLIC_CMP_SCRIPT_URL = cmpScriptUrl;
    for (const [placement, variable] of Object.entries(SLOT_ENV)) settings[variable] = slots[placement] || '';
  }
  return settings;
}

/** Override legacy global ad/analytics variables after loading checkout settings. */
export async function applyMonetizationSettings(root, team, environment = process.env) {
  let config;
  try { config = JSON.parse(await readFile(path.join(root, 'config/monetization.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') fail('missing config/monetization.json; install the team settings before building.');
    if (error instanceof SyntaxError) fail('config/monetization.json must be valid JSON.');
    throw error;
  }
  const selected = selectMonetizationSettings(config, team);
  for (const key of Object.keys(environment)) {
    if (/^(?:ADS_|PUBLIC_ADSENSE_|PUBLIC_CMP_|PUBLIC_ANALYTICS_|PUBLIC_CLOUDFLARE_ANALYTICS_)/.test(key)) delete environment[key];
  }
  Object.assign(environment, selected);
  return selected;
}

/** Replace the template record so an earlier team's ads.txt cannot survive. */
export async function writeMonetizationAdsTxt(target, settings) {
  await mkdir(path.join(target, 'public'), { recursive: true });
  await writeFile(path.join(target, 'public/ads.txt'), settings.ADS_TXT_RECORD
    ? `${settings.ADS_TXT_RECORD}\n`
    : '# Advertising is disabled for this team.\n');
}
