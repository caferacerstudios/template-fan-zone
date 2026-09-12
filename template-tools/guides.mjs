import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const files = ['game-day-guides.json', 'watch-guide.json'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const timestamp = value => text(value) && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const url = value => { try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { return false; } };
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const fullName = team => team?.full_name ?? team?.fullName ?? team?.name;

export function guidesEnabled(environment = process.env) {
  const value = environment.FAN_ZONE_GUIDES_ENABLED;
  if (value === undefined || value === '' || value === '0') return false;
  if (value !== '1') throw new Error('FAN_ZONE_GUIDES_ENABLED must be 0 or 1.');
  return true;
}

export function guideSnapshotDirectory(site) {
  const news = site.news_snapshot_dir;
  if (typeof news !== 'string' || !path.isAbsolute(news) || path.normalize(news) !== news || !news.endsWith('-news/current')) throw new Error(`${site.slug}.news_snapshot_dir must end in -news/current to select its guide snapshot.`);
  return news.replace(/-news\/current$/, '-guides/current');
}

function sources(value, label) {
  if (!Array.isArray(value) || !value.length || value.some(source => !object(source) || !text(source.name) || !url(source.url))) throw new Error(`Missing or invalid guide sources: ${label}`);
  return new Set(value.map(source => source.url));
}

function validateGuide(entry, id, expectedTeam, season, games, refreshedAt) {
  if (!object(entry) || entry.gameId !== id || entry.team !== expectedTeam || entry.season !== season || entry.phase !== 'regular' || !Number.isInteger(entry.week)) throw new Error(`Invalid guide game identity: ${id}`);
  if (!timestamp(entry.lastUpdated) || Date.parse(entry.lastUpdated) > refreshedAt + 300000) throw new Error(`Invalid guide source timestamp: ${id}`);
  const game = games.get(id), identity = entry.game ?? entry;
  if (!game || game.phase !== 'regular' || ['bye', 'canceled'].includes(game.state) || game.isHome === null || game.week !== entry.week || game.season !== season ||
      identity.opponent !== fullName(game.opponent) || identity.homeAway !== (game.isHome ? 'home' : 'away') || identity.date !== game.date || identity.venue !== game.venue) {
    throw new Error(`Guide does not match the current NFL schedule: ${id}; refresh the guides before building.`);
  }
  const sameKickoff = identity.startsAt === null && game.startsAt === null || timestamp(identity.startsAt) && timestamp(game.startsAt) && Date.parse(identity.startsAt) === Date.parse(game.startsAt);
  if (identity.timeConfirmed !== game.timeConfirmed || !sameKickoff) throw new Error(`Guide kickoff changed in the current NFL schedule: ${id}; refresh the guides before building.`);
  if (identity.date !== null && !day(identity.date)) throw new Error(`Invalid guide calendar date: ${id}`);
  return game;
}

function validateGameDay(entry, id) {
  if (entry.schemaVersion !== 1 || !text(entry.summary)) throw new Error(`Invalid game-day guide: ${id}`);
  const knownSources = sources(entry.sources, id);
  for (const [field, required] of Object.entries({ alerts: ['title', 'text'], transportation: ['name', 'details'], parking: ['name', 'details'], timeline: ['time', 'event'], tailgates: ['name', 'description'], watchParties: ['name', 'description'], stadiumTips: ['title', 'details'] })) {
    if (!Array.isArray(entry[field]) || entry[field].some(item => !object(item) || required.some(key => !text(item[key])) || !knownSources.has(item.sourceUrl))) throw new Error(`Invalid or unsourced game-day ${field}: ${id}`);
  }
  if (entry.alerts.some(item => !['info', 'warning', 'critical'].includes(item.severity))) throw new Error(`Invalid guide alert severity: ${id}`);
  if (entry.tailgates.some(item => item.price !== null && (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0))) throw new Error(`Invalid guide event price: ${id}`);
  if (entry.watchParties.some(item => !Array.isArray(item.specials) || item.specials.some(value => !text(value)))) throw new Error(`Invalid watch-party specials: ${id}`);
  if (entry.weather !== null && (!object(entry.weather) || !knownSources.has(entry.weather.sourceUrl))) throw new Error(`Invalid or unsourced guide forecast: ${id}`);
}

function validateWatch(entry, id) {
  const knownSources = sources(entry.sources, id);
  if (!['scheduled', 'tbd', 'completed'].includes(entry.status) || typeof entry.national !== 'string' || (entry.officialGameUrl !== null && !knownSources.has(entry.officialGameUrl))) throw new Error(`Invalid viewing information: ${id}`);
  for (const field of ['localTv', 'streams', 'replay']) {
    if (field === 'replay' && entry[field] === undefined) continue;
    if (!Array.isArray(entry[field]) || entry[field].some(item => !object(item) || !text(item.name) || !url(item.url) || (item.note != null && typeof item.note !== 'string'))) throw new Error(`Invalid viewing providers: ${id}`);
  }
}

/** Validate the complete collection before changing the isolated build workspace. */
export async function importGuideSnapshot({ projectRoot, snapshotDir, expectedTeam, expectedAbbreviation, now = Date.now(), checkOnly = false, warn = console.warn }) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(expectedTeam ?? '') || !/^[A-Z]{2,3}$/.test(expectedAbbreviation ?? '')) throw new Error('Guide import requires an explicit team and abbreviation.');
  const selected = fs.realpathSync(snapshotDir); // Pin current once for both artifacts.
  const relative = path.relative(path.dirname(path.resolve(snapshotDir)), selected);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Guide current must resolve within its own snapshot root.');
  const manifestPath = path.join(selected, 'manifest.json');
  if (!fs.lstatSync(manifestPath).isFile()) throw new Error('Guide manifest must be a regular file.');
  const manifest = read(manifestPath);
  if (manifest.schema_version !== 1 || manifest.pipeline !== 'guides' || manifest.team !== expectedTeam || !Number.isInteger(manifest.season) || !text(manifest.runId) || !object(manifest.files) || Object.keys(manifest.files).length !== files.length || files.some(name => !Object.hasOwn(manifest.files, name))) throw new Error('Invalid guide manifest identity/schema/files.');
  if (!timestamp(manifest.updatedAt) || Date.parse(manifest.updatedAt) > now + 300000) throw new Error('Invalid or future guide manifest timestamp.');
  const refreshedAt = Date.parse(manifest.updatedAt), payloads = {};
  for (const name of files) {
    const filename = path.join(selected, name), stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error(`Guide artifact must be a bounded regular file: ${name}`);
    const bytes = fs.readFileSync(filename), checksum = manifest.files[name];
    if (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum) || createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error(`Guide checksum mismatch: ${name}`);
    payloads[name] = JSON.parse(bytes);
    const data = payloads[name];
    if (!object(data) || data.schemaVersion !== 1 || data.team !== expectedTeam || data.season !== manifest.season) throw new Error(`Guide artifact identity/season mismatch: ${name}`);
  }
  const schedule = read(path.join(projectRoot, 'src/data/nfl', `${expectedTeam}.json`));
  if (schedule.team?.abbreviation !== expectedAbbreviation || schedule.season !== manifest.season) throw new Error('Guide season/team does not match the selected NFL snapshot.');
  const { normalizeSchedule, formatKickoff } = await import(pathToFileURL(path.join(projectRoot, 'src/lib/schedule.mjs')).href);
  const normalized = normalizeSchedule(schedule, schedule.season);
  const games = new Map(normalized.games.map(game => [String(game.id), game]));
  const guides = payloads['game-day-guides.json'], watch = payloads['watch-guide.json'];
  if (!object(guides.games) || !Array.isArray(watch.games) || !object(watch.notes) || !day(watch.updatedAt)) throw new Error('Invalid guide collections.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: watch.timezone }).format(); } catch { throw new Error('Invalid watch guide timezone.'); }
  if (!text(watch.timezone)) throw new Error('Missing watch guide timezone.');
  const watchIds = new Set(), weeks = new Set(), watchRows = [];
  for (const [id, entry] of Object.entries(guides.games)) {
    validateGuide(entry, id, expectedTeam, manifest.season, games, refreshedAt);
    validateGameDay(entry, id);
  }
  for (const entry of watch.games) {
    const id = entry?.gameId;
    const game = validateGuide(entry, id, expectedTeam, manifest.season, games, refreshedAt);
    if (watchIds.has(id) || weeks.has(entry.week)) throw new Error(`Duplicate watch guide identity/week: ${id}`);
    watchIds.add(id); weeks.add(entry.week);
    validateWatch(entry, id);
    watchRows.push({ ...entry, updatedAt: entry.lastUpdated.slice(0, 10), scheduleAuthority: 'nfl-snapshot',
      dateLabel: formatKickoff(game, 'date'), kickoffLabel: formatKickoff(game, 'time'),
      matchup: `${fullName(game.awayTeam)} at ${fullName(game.homeTeam)}` });
  }
  if (Object.keys(guides.games).length !== watchIds.size || Object.keys(guides.games).some(id => !watchIds.has(id))) throw new Error('Game-day and watch artifacts must cover the same game IDs.');
  if (now - refreshedAt > 72 * 3600000) warn(`Guides (${expectedTeam}): collection is over 72 hours old; original record timestamps are retained.`);
  const result = { status: 'success', snapshotDir: selected, team: expectedTeam, season: manifest.season, runId: manifest.runId, gameCount: watchIds.size, checkOnly };
  if (checkOnly) return result;
  const directory = path.join(projectRoot, 'src/data/nfl');
  // Existing Astro imports use this compatibility filename. Payload season is
  // authoritative; never successfully write an unused season-named artifact.
  const guideTarget = path.join(directory, 'game-day-guides.json'), watchTarget = path.join(directory, 'watch-guide-2026.json');
  const previousGuides = fs.existsSync(guideTarget) ? read(guideTarget) : { games: {} };
  const previousWatch = fs.existsSync(watchTarget) ? read(watchTarget) : { games: [], notes: {} };
  const owned = value => value.team === expectedTeam || (expectedTeam === 'seahawks' && value.team === undefined);
  const oldGuideGames = owned(previousGuides) ? previousGuides.games ?? {} : {};
  const oldWatchGames = owned(previousWatch) && previousWatch.season === manifest.season ? previousWatch.games ?? [] : [];
  const writes = [[guideTarget, { ...guides, games: { ...oldGuideGames, ...guides.games } }],
    [watchTarget, { ...watch, notes: { ...(owned(previousWatch) ? previousWatch.notes : {}), ...watch.notes }, games: [...oldWatchGames.filter(entry => !weeks.has(entry.week) || entry.phase !== 'regular').map(entry => ({ ...entry, updatedAt: entry.updatedAt ?? previousWatch.updatedAt })), ...watchRows] }]];
  const staged = [];
  try {
    for (const [destination, data] of writes) {
      const temporary = `${destination}.import-${randomUUID()}`;
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
      staged.push([temporary, destination]);
    }
    for (const [temporary, destination] of staged) fs.renameSync(temporary, destination);
  } finally { for (const [temporary] of staged) fs.rmSync(temporary, { force: true }); }
  console.log(`Guides (${expectedTeam}): imported ${watchIds.size} game-day and viewing records from ${selected}.`);
  return result;
}

export async function prepareGuides(destination, site, environment = process.env) {
  if (!guidesEnabled(environment)) return { status: 'disabled' };
  const snapshotDir = guideSnapshotDirectory(site);
  if (!fs.existsSync(snapshotDir)) throw new Error(`Guide snapshot missing or broken at ${snapshotDir}. Run the guide DAG successfully before opting this build in.`);
  return importGuideSnapshot({ projectRoot: destination, snapshotDir, expectedTeam: site.slug, expectedAbbreviation: site.abbreviation });
}
