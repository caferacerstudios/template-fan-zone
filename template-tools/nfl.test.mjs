import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderProject, teamSettings } from './render.mjs';
import { selectNflSnapshot, prepareNflSnapshot, prepareRecaps, loadNflSite } from './nfl.mjs';
import { prepareEventSpy } from './eventspy.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data) + '\n'); };
const now = new Date().toISOString();
const definitions = [['seahawks', 'SEA', 'Seattle', 'NFC West'], ['broncos', 'DEN', 'Denver', 'AFC West'], ['packers', 'GB', 'Green Bay', 'NFC North'], ['vikings', 'MIN', 'Minnesota', 'NFC North'], ['chiefs', 'KC', 'Kansas City', 'AFC West']];

async function workspace(t, slug = 'broncos') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fanzone-nfl-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const [, abbreviation, city, division] = definitions.find(row => row[0] === slug);
  const site = { slug, name: slug[0].toUpperCase() + slug.slice(1), city, abbreviation, division, balldontlie_team_id: 999,
    nfl_snapshot_dir: path.join(directory, 'nfl/current'), recap_snapshot_dir: path.join(directory, 'recaps/current') };
  const target = path.join(directory, 'rendered');
  await renderProject(root, target, { ...teamSettings(slug), abbreviation, division });
  const data = { season: 2026, sourceSeason: 2026, updatedAt: now, team: { id: 999, abbreviation, full_name: `${city} ${site.name}` }, playerStatsSeason: 2025, playerSeasonStats: [{ player: { id: 99901, full_name: 'Unit Test Player' }, passing_yards: 100 }], currentRoster: [], games: [{ id: 999001, season: 2026, week: 1, season_type: 'regular', status: 'Scheduled', date: '2026-10-01', home_team: { abbreviation, full_name: `${city} ${site.name}` }, visitor_team: { abbreviation: slug === 'seahawks' ? 'DEN' : 'SEA', full_name: slug === 'seahawks' ? 'Denver Broncos' : 'Seattle Seahawks' } }] };
  const snapshot = path.join(directory, 'nfl/snapshots/one');
  const payloads = { [`${slug}.json`]: data, 'players.json': data, 'standings.json': { season: 2026, updatedAt: now, phases: Object.fromEntries(['preseason', 'regular', 'postseason'].map(phase => [phase, { phase, rows: [] }])) } };
  const manifest = { schema_version: 1, team: slug, season: 2026, updatedAt: now, files: {} };
  for (const [name, value] of Object.entries(payloads)) { write(path.join(snapshot, name), value); manifest.files[name] = createHash('sha256').update(fs.readFileSync(path.join(snapshot, name))).digest('hex'); }
  write(path.join(snapshot, 'manifest.json'), manifest);
  fs.symlinkSync('snapshots/one', site.nfl_snapshot_dir);
  return { directory, site, target, data, snapshot, manifest };
}

for (const [slug] of definitions) test(`${slug}: selected NFL data is literal; missing recaps never borrow Seattle articles`, async t => {
  const { site, target } = await workspace(t, slug);
  const selected = await selectNflSnapshot(target, site);
  await prepareNflSnapshot(target, site, selected);
  const imported = read(path.join(target, `src/data/nfl/${slug}.json`));
  assert.equal(imported.team.abbreviation, site.abbreviation);
  assert.equal(imported.games[0].visitor_team.full_name, slug === 'seahawks' ? 'Denver Broncos' : 'Seattle Seahawks');
  await prepareRecaps(target, site);
  if (slug !== 'seahawks') {
    assert.deepEqual(read(path.join(target, 'src/data/nfl/gameRecaps.json')), { team: slug, recaps: {} });
    assert.deepEqual(read(path.join(target, 'src/data/team/roster.json')).players, []);
  }
});

test('missing or another-team NFL snapshot fails before importing', async t => {
  const { site, target, snapshot, manifest } = await workspace(t);
  fs.unlinkSync(site.nfl_snapshot_dir);
  await assert.rejects(selectNflSnapshot(target, site), /Missing Denver Broncos NFL snapshot/);
  fs.symlinkSync('snapshots/one', site.nfl_snapshot_dir);
  write(path.join(snapshot, 'manifest.json'), { ...manifest, team: 'seahawks' });
  await assert.rejects(selectNflSnapshot(target, site), /different team/);
});

test('snapshot symlink change cannot mix collections after validation', async t => {
  const { directory, site, target, snapshot } = await workspace(t);
  const selected = await selectNflSnapshot(target, site);
  const other = path.join(directory, 'nfl/snapshots/two');
  fs.cpSync(snapshot, other, { recursive: true });
  write(path.join(other, 'broncos.json'), { team: { abbreviation: 'SEA' } });
  fs.unlinkSync(site.nfl_snapshot_dir); fs.symlinkSync('snapshots/two', site.nfl_snapshot_dir);
  await prepareNflSnapshot(target, site, selected);
  assert.equal(read(path.join(target, 'src/data/nfl/broncos.json')).team.abbreviation, 'DEN');
});

test('recap team, game identity and checksum are checked separately from daily news', async t => {
  const { site, target, data } = await workspace(t);
  const directory = site.recap_snapshot_dir;
  const game = { ...data.games[0], status: 'Final', home_team_score: 21, visitor_team_score: 14 };
  const incoming = { team: 'broncos', season: 2026, updatedAt: now, recaps: { 999001: { team: 'broncos', gameId: '999001', game, segments: [{ t: 'text', v: 'Denver won the test game.', id: null, name: null }], bullets: ['First.', 'Second.', 'Third.'] } } };
  write(path.join(directory, 'gameRecaps.json'), incoming);
  const manifest = { schema_version: 1, team: 'broncos', season: 2026, updatedAt: now, runId: 'unit-recap', sourceCommit: 'a'.repeat(40), nflSourceRunId: 'unit-nfl', nflSourceUpdatedAt: now, model: 'gpt-4o-mini', generatedCount: 0, generatedGameIds: [], requestCount: 0, openaiRequestCount: 0, files: { 'gameRecaps.json': createHash('sha256').update(fs.readFileSync(path.join(directory, 'gameRecaps.json'))).digest('hex') } };
  write(path.join(directory, 'manifest.json'), manifest);
  await selectNflSnapshot(target, site);
  await prepareRecaps(target, site);
  assert.equal(read(path.join(target, 'src/data/nfl/gameRecaps.json')).recaps[999001].team, 'broncos');
  write(path.join(directory, 'manifest.json'), { ...manifest, team: 'seahawks' });
  await assert.rejects(prepareRecaps(target, site), /different team/);
  write(path.join(directory, 'manifest.json'), manifest);
  fs.appendFileSync(path.join(directory, 'gameRecaps.json'), ' ');
  await assert.rejects(prepareRecaps(target, site), /checksum/);
});

test('broken existing recap symlink is an error, not an empty new team', async t => {
  const { site, target } = await workspace(t);
  fs.mkdirSync(path.dirname(site.recap_snapshot_dir), { recursive: true });
  fs.symlinkSync('missing-run', site.recap_snapshot_dir);
  await assert.rejects(prepareRecaps(target, site), /link is broken/);
});

test('active teams cannot share NFL or recap output directories', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fanzone-nfl-config-'));
  try {
    const config = path.join(directory, 'sites.json');
    write(config, { broncos: { abbreviation: 'DEN', nfl_snapshot_dir: '/tmp/nfl/current', recap_snapshot_dir: '/tmp/recaps/current' }, chiefs: { nfl_snapshot_dir: '/tmp/nfl/current' } });
    assert.throws(() => loadNflSite(root, 'broncos', config), /must not share nfl_snapshot_dir/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('selected division standings keep real opponents and highlight the configured team', async t => {
  const { target, data } = await workspace(t, 'chiefs');
  const { aggregateStandings } = await import(new URL(`file://${path.join(target, 'src/lib/standings.mjs')}`).href);
  const game = { ...data.games[0], home_team: { abbreviation: 'KC', full_name: 'Kansas City Chiefs', conference: 'AFC' }, visitor_team: { abbreviation: 'DEN', full_name: 'Denver Broncos', conference: 'AFC' }, status: 'Final', home_team_score: 21, visitor_team_score: 14 };
  const rows = aggregateStandings([game], [game.home_team, game.visitor_team], 'regular');
  assert.equal(rows.find(row => row.abbreviation === 'KC').wins, 1);
  assert.equal(rows.find(row => row.abbreviation === 'KC').divisionWins, 1);
  assert.equal(rows.find(row => row.abbreviation === 'DEN').name, 'Denver Broncos');
  const page = fs.readFileSync(path.join(target, 'src/pages/standings.astro'), 'utf8');
  assert.match(page, /Kansas City Chiefs AFC West Standings/);
  assert.match(page, /row.abbreviation === "KC"/);
  assert.doesNotMatch(page, /Seattle Chiefs/);
});

test('fresh NFL schedule takes precedence over the standalone ticket schedule and survives ancillary clearing', async t => {
  const { directory, site, target, data, snapshot, manifest } = await workspace(t);
  site.eventspy = { coverage_file: 'broncos.json', schedule_file: path.join(directory, 'stale-ticket-schedule.json') };
  write(site.eventspy.schedule_file, { team: { abbreviation: 'SEA' } });
  const coverage = read(path.join(root, 'config/eventspy/broncos.json'));
  const schedule = { ...data, fixture: false, games: coverage.map((row, index) => ({ id: row.gameId ?? 990000 + index, season: 2026, week: row.week, season_type: 'regular', status: index === 0 ? 'Final' : row.localDate ? 'Scheduled' : 'TBD', date: row.localDate, timeConfirmed: false, home_team_score: index === 0 ? 14 : null, visitor_team_score: index === 0 ? 21 : null, home_team: { abbreviation: row.homeTeamAbbreviation, full_name: row.homeAway === 'home' ? 'Denver Broncos' : row.opponent }, visitor_team: { abbreviation: row.awayTeamAbbreviation, full_name: row.homeAway === 'away' ? 'Denver Broncos' : row.opponent } })) };
  write(path.join(snapshot, 'broncos.json'), schedule);
  manifest.files['broncos.json'] = createHash('sha256').update(fs.readFileSync(path.join(snapshot, 'broncos.json'))).digest('hex');
  write(path.join(snapshot, 'manifest.json'), manifest);
  const selected = await selectNflSnapshot(target, site);
  await prepareEventSpy(root, target, site, selected.schedule);
  await prepareNflSnapshot(target, site, selected);
  assert.equal(read(path.join(target, 'src/data/nfl/broncos.json')).games[0].status, 'Final');
  assert.equal(read(path.join(target, 'src/data/nfl/players.json')).playerSeasonStats[0].passing_yards, 100);
  assert.deepEqual(read(path.join(target, 'src/data/team/player-profile-editorial-facts.json')).facts, []);
});
