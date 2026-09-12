import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderProject, teamSettings } from './render.mjs';
import { loadNewsSite } from './news.mjs';
import { loadEventSpySite, prepareEventSpy, readSelectedSchedule } from './eventspy.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fanzone-eventspy-tests-'));
test.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

// Synthetic schedule IDs exist only in this temporary test directory. They are
// deliberately never checked into config/coverage or any production data file.
function testSchedule(site, coverage) {
  return { fixture: false, season: 2026, sourceSeason: 2026, updatedAt: '2026-09-12T00:00:00Z',
    team: { id: 999, abbreviation: site.abbreviation, full_name: `${site.city} ${site.name}` },
    playerSeasonStats: [], currentRoster: [], games: coverage.map((row, index) => ({
      id: row.gameId ?? String(900000 + index), season: 2026, week: row.week, season_type: 'regular',
      date: row.localDate, dateConfirmed: Boolean(row.localDate), timeConfirmed: false,
      status: row.localDate ? 'Scheduled' : 'TBD',
      home_team: { abbreviation: row.homeTeamAbbreviation, full_name: row.homeAway === 'home' ? `${site.city} ${site.name}` : row.opponent },
      visitor_team: { abbreviation: row.awayTeamAbbreviation, full_name: row.homeAway === 'away' ? `${site.city} ${site.name}` : row.opponent },
    })) };
}

async function rendered(slug, suffix = slug) {
  const site = loadEventSpySite(root, slug);
  const target = path.join(fixtureRoot, suffix);
  fs.mkdirSync(target, { recursive: true });
  await renderProject(root, target, { ...teamSettings(slug), abbreviation: site.abbreviation }, { newsSite: loadNewsSite(root, slug) });
  return { site, target };
}

test('Seahawks template preserves reviewed source identity and old completed history', async () => {
  const { site, target } = await rendered('seahawks');
  site.eventspy.schedule_file = '/does-not-exist/seahawks.json';
  const { coverage } = await prepareEventSpy(root, target, site);
  assert.equal(coverage.length, 17);
  assert.equal(coverage[0].gameId, '1392216');
  assert.equal(coverage[0].sourceUrl, 'https://www.event-spy.com/event/seattle-seahawks-seattle-sep-09-2026/374440');
  const runtime = await import(pathToFileURL(path.join(target, 'src/lib/tickets/eventspy-coverage.mjs')).href);
  assert.equal(runtime.eventSpyMirrorUrl('1392216'), '/data/eventspy-mirror/seahawks/1392216.json');
  const schema = await import(pathToFileURL(path.join(target, 'src/lib/tickets/eventspy-mirror-schema.mjs')).href);
  const original = read(path.join(target, 'tests/fixtures/eventspy-mirror-page.json'));
  assert.equal(schema.validateEventSpyMirror(original, { now: Date.parse('2026-09-12T12:00:00Z') }), original);
});

test('Broncos schedule, coverage, page identities and feed route agree', async () => {
  const { site, target } = await rendered('broncos');
  const reviewed = read(path.join(root, 'config/eventspy/broncos.json'));
  const scheduleFile = path.join(fixtureRoot, 'test-only-broncos-schedule.json');
  fs.writeFileSync(scheduleFile, JSON.stringify(testSchedule(site, reviewed)));
  site.eventspy.schedule_file = scheduleFile;
  const { coverage, schedule } = await prepareEventSpy(root, target, site);
  assert.equal(coverage.length, 17);
  assert.equal(coverage.filter(row => row.state === 'authorized').length, 15);
  assert.equal(coverage.find(row => row.week === 8).sourceEventId, '374756');
  assert.equal(coverage.find(row => row.week === 6).gameId, '1392295');
  assert.equal(coverage.find(row => row.week === 6).opponent, 'Seattle Seahawks');
  assert.equal(schedule.gamesRegular.find(game => game.id === '1392295').isHome, true);
  const runtime = await import(pathToFileURL(path.join(target, 'src/lib/tickets/eventspy-coverage.mjs')).href);
  assert.equal(runtime.eventSpyMirrorUrl('1392295'), '/data/eventspy-mirror/broncos/1392295.json');
  assert.throws(() => runtime.eventSpyMirrorUrl('1392216'), /not in this team/);
  const schema = await import(pathToFileURL(path.join(target, 'src/lib/tickets/eventspy-mirror-schema.mjs')).href);
  const original = read(path.join(target, 'tests/fixtures/eventspy-mirror-page.json'));
  assert.throws(() => schema.validateEventSpyMirror(original, { now: Date.parse('2026-09-12T12:00:00Z') }), /not in EventSpy coverage/);
  const shared = coverage.find(row => row.gameId === '1392295');
  const sharedSnapshot = { ...original, gameId: shared.gameId, sourceEventId: shared.sourceEventId,
    sourceUrl: shared.sourceUrl, trackingUrl: shared.sourceUrl,
    event: { ...original.event, title: 'Denver Broncos vs. Seattle Seahawks', localDate: shared.localDate } };
  assert.equal(schema.validateEventSpyMirror(sharedSnapshot, { now: Date.parse('2026-09-12T12:00:00Z') }), sharedSnapshot);
  assert.throws(() => schema.validateEventSpyMirror({ ...sharedSnapshot, event: { ...sharedSnapshot.event, title: 'Denver Broncos vs. Kansas City Chiefs' } }), /matchup/);
  const details = await import(pathToFileURL(path.join(target, 'src/lib/game-details.mjs')).href);
  const models = details.ticketGameModels(schedule, coverage);
  assert.equal(models['1392295'].opponentName, 'Seattle Seahawks');
  assert.match(models['1392295'].broncosLogo, /DEN/);
  assert.deepEqual(read(path.join(target, 'src/data/nfl/gameRecaps.json')).recaps, {});
  assert.deepEqual(read(path.join(target, 'src/data/team/roster.json')).players, []);
  assert.equal(read(path.join(target, 'package.json')).scripts.prebuild, 'node scripts/import-news-snapshot.mjs --if-available');
  const run = spawnSync('npm', ['run', 'build'], { cwd: target, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', NEWS_SNAPSHOT_DIR: path.join(fixtureRoot, 'no-news-snapshot/current') }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const gameHtml = fs.readFileSync(path.join(target, 'dist/games/1392295/index.html'), 'utf8');
  assert.match(gameHtml, /Seattle Seahawks at Denver Broncos/);
  assert.doesNotMatch(gameHtml, /Seattle Broncos/);
  assert.equal(fs.existsSync(path.join(target, 'dist/games/1392216/index.html')), false);
});

test('a Broncos build refuses a Seattle schedule rather than relabeling it', () => {
  const site = loadEventSpySite(root, 'broncos');
  site.eventspy.schedule_file = path.join(root, 'src/data/nfl/{team}.json');
  assert.throws(() => readSelectedSchedule(root, site), /another team's schedule/);
});

test('a changed matchup fails before replacing the selected schedule or coverage', async () => {
  const { site, target } = await rendered('broncos', 'broncos-changed');
  const rows = read(path.join(root, 'config/eventspy/broncos.json'));
  const schedule = testSchedule(site, rows);
  schedule.games[0].home_team.abbreviation = 'SEA';
  const filename = path.join(fixtureRoot, 'test-only-wrong-matchup.json');
  fs.writeFileSync(filename, JSON.stringify(schedule));
  site.eventspy.schedule_file = filename;
  await assert.rejects(() => prepareEventSpy(root, target, site), /home\/away|schedule game IDs/);
});


test('coverage config accepts a team-season filename and rejects another team', () => {
  const config = read(path.join(root, 'config/active-sites.json'));
  config.broncos.eventspy.coverage_file = 'broncos-2026.json';
  const filename = path.join(fixtureRoot, 'test-only-config.json');
  fs.writeFileSync(filename, JSON.stringify(config));
  assert.equal(loadEventSpySite(root, 'broncos', filename).eventspy.coverage_file, 'broncos-2026.json');
  config.broncos.eventspy.coverage_file = 'seahawks.json';
  fs.writeFileSync(filename, JSON.stringify(config));
  assert.throws(() => loadEventSpySite(root, 'broncos', filename), /coverage_file/);
});
