import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bindCoverageToSchedule, scheduleLocalDate } from './eventspy-schedule.mjs';
import { renderText, teamSettings } from './render.mjs';

const read = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
const write = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n');

export function loadEventSpySite(root, slug, filename = process.env.ACTIVE_SITES_FILE || path.join(root, 'config/active-sites.json')) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(slug)) throw new Error("Invalid team slug.");
  const document = read(filename);
  const value = document.fan_zone_active_sites ?? document;
  const sites = typeof value === 'string' ? JSON.parse(value) : value;
  const selected = sites[slug];
  if (!selected || !/^[A-Z]{2,3}$/.test(selected.abbreviation ?? '')) throw new Error(`Missing team abbreviation for ${slug}.`);
  const eventspy = selected.eventspy;
  if (!eventspy || !new RegExp(`^${slug}(?:-20[0-9]{2})?\\.json$`).test(eventspy.coverage_file ?? '') || !path.isAbsolute(eventspy.output_dir ?? '') || !path.isAbsolute(eventspy.schedule_file ?? '')) {
    throw new Error(`Add eventspy.output_dir, coverage_file and schedule_file to the ${slug} active-site configuration.`);
  }
  for (const [otherSlug, other] of Object.entries(sites)) {
    if (otherSlug !== slug && other?.eventspy?.output_dir === eventspy.output_dir) throw new Error(`EventSpy output directories must differ for ${slug} and ${otherSlug}.`);
  }
  return { ...selected, slug, eventspy };
}

export function readSelectedSchedule(root, site) {
  let filename = site.eventspy.schedule_file;
  if (!fs.existsSync(filename)) {
    // The Seattle template already contains its real game IDs. A different
    // team must have its own authenticated schedule, never a renamed copy.
    const local = path.join(root, 'src/data/nfl', `${site.slug}.json`);
    if (fs.existsSync(local)) filename = local;
    else if (site.slug === 'seahawks') filename = path.join(root, 'src/data/nfl/{team}.json');
    else throw new Error(`Missing ${site.city} ${site.name} schedule at ${filename}. Run the EventSpy installer schedule refresh and mount /var/lib/fanzone-eventspy/schedules read-only for this build.`);
  }
  let schedule = read(filename);
  if (site.slug === 'seahawks' && filename.endsWith('/{team}.json')) {
    schedule = JSON.parse(renderText(JSON.stringify(schedule), { ...teamSettings('seahawks'), abbreviation: 'SEA' }));
  }
  if (schedule.fixture === true || schedule.team?.abbreviation !== site.abbreviation) throw new Error(`Refusing to use another team's schedule for ${site.slug}.`);
  return schedule;
}

function clearForeignAncillaryData(root, destination, site, season) {
  if (site.slug === 'seahawks') return;
  const files = {
    'src/data/nfl/gameRecaps.json': { recaps: {} },
    'src/data/nfl/gameEditorial.json': { games: {} },
    'src/data/nfl/game-day-guides.json': { games: {} },
    'src/data/nfl/game-status.json': { games: {} },
    'src/data/nfl/playerProfiles.json': { profiles: {} },
    'src/data/nfl/players.json': { data: [], players: [], playerSeasonStats: [], currentRoster: [] },
    [`src/data/nfl/watch-guide-${season}.json`]: { games: [], notes: {}, updatedAt: null },
    'src/data/team/roster.json': { players: [], asOf: null, sourceUrl: null, sourceNote: 'Team roster data is not configured yet.' },
    'src/data/team/transactions.json': { records: [], asOf: null, sourcePublisher: null, sourceUrl: null, sourceNote: 'Team transactions are not configured yet.' },
    'src/data/team/injuries.json': { records: [], asOf: null, sourcePublisher: null, sourceUrl: null, sourceNote: 'Team injury reports are not configured yet.' },
    'src/data/team/player-career-facts.json': { players: {}, updatedAt: null },
    'src/data/team/player-profile-tiers.json': { players: {} },
    'src/data/team/player-profile-editorial-facts.json': { facts: {} },
  };
  for (const [relative, empty] of Object.entries(files)) {
    const source = path.join(root, relative), target = path.join(destination, relative);
    if (!fs.existsSync(source)) continue;
    const original = read(source);
    const identity = typeof original.team === 'string' ? original.team : original.team?.abbreviation;
    if (identity === site.slug || identity === site.abbreviation) write(target, original);
    else write(target, { ...original, ...empty, team: site.slug });
  }
  // Standings describe the whole league; keep original team names as content.
  const standings = path.join(root, 'src/data/nfl/standings.json');
  if (fs.existsSync(standings)) fs.writeFileSync(path.join(destination, 'src/data/nfl/standings.json'), renderText(fs.readFileSync(standings, 'utf8'), { ...teamSettings('seahawks'), abbreviation: 'SEA' }));
}

export async function prepareEventSpy(root, destination, site) {
  const schedule = readSelectedSchedule(root, site);
  const reviewed = read(path.join(root, 'config/eventspy', site.eventspy.coverage_file));
  const { normalizeSchedule } = await import(pathToFileURL(path.join(destination, 'src/lib/schedule.mjs')).href);
  const normalized = normalizeSchedule(schedule, schedule.season);
  const bindings = bindCoverageToSchedule(site, reviewed, normalized);
  const unresolved = bindings.filter(binding => binding.reason || !binding.row.gameId);
  if (unresolved.length) throw new Error(`Missing or ambiguous ${site.slug} schedule game IDs for weeks ${unresolved.map(binding => binding.row.week).join(', ')}. Refresh the authenticated schedule before building.`);
  for (const binding of bindings) {
    if (binding.row.state === 'authorized' && !/final|finished|completed?|closed/i.test(String(binding.game?.state ?? binding.game?.status ?? '')) && scheduleLocalDate(binding.game, binding.row) !== binding.row.localDate) {
      throw new Error(`EventSpy date changed for ${site.slug} week ${binding.row.week}; review its source URL before building.`);
    }
  }
  const coverage = bindings.map(binding => binding.row);
  // Preserve true opponent identities and source game IDs, never template them.
  write(path.join(destination, 'src/data/nfl', `${site.slug}.json`), normalized);
  const generated = `// Bound from reviewed EventSpy URLs and the selected team's real schedule.\nexport const EVENTSPY_COVERAGE = Object.freeze(${JSON.stringify(coverage, null, 2)}.map(Object.freeze));\n`;
  fs.writeFileSync(path.join(destination, 'src/lib/tickets/eventspy-coverage-data.mjs'), generated);
  clearForeignAncillaryData(root, destination, site, schedule.season);
  if (site.slug !== 'seahawks') {
    const filename = path.join(destination, 'package.json');
    const pkg = read(filename);
    // Other team data pipelines are a later migration. Do not run Seattle's
    // NFL/recap import or its roster/profile generators for another team.
    pkg.scripts.prebuild = 'node scripts/import-news-snapshot.mjs --if-available';
    write(filename, pkg);
  }
  console.log(`Tickets (${site.slug}): ${coverage.filter(row => row.state === 'authorized').length} reviewed EventSpy pages; ${coverage.filter(row => row.state === 'unavailable').length} unavailable.`);
  return { schedule: normalized, coverage };
}
