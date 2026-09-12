import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { renderText, teamSettings } from './render.mjs';
import { guideSnapshotDirectory, guidesEnabled, importGuideSnapshot, prepareGuides } from './guides.mjs';

const root = path.resolve(import.meta.dirname, '..');
const write = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fanzone-guide-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const projectRoot = path.join(temporary, 'project'), directory = path.join(projectRoot, 'src/data/nfl');
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'src/lib'), { recursive: true });
  for (const filename of ['schedule.mjs', 'schedule-guide.mjs', 'watch-guide.mjs']) fs.writeFileSync(path.join(projectRoot, 'src/lib', filename), renderText(fs.readFileSync(path.join(root, 'src/lib', filename), 'utf8'), teamSettings('seahawks')));
  const game = { id: '1392244', season: 2026, phase: 'regular', week: 2, datetime: '2026-09-20T20:25:00Z', status: 'Scheduled', venue: 'State Farm Stadium',
    home_team: { abbreviation: 'ARI', full_name: 'Arizona Cardinals' }, visitor_team: { abbreviation: 'SEA', full_name: 'Seattle Seahawks' } };
  const schedule = { season: 2026, team: { id: 31, abbreviation: 'SEA' }, games: [game] };
  write(path.join(directory, 'seahawks.json'), schedule);
  write(path.join(directory, 'game-day-guides.json'), { schemaVersion: 1, games: { maintained: { summary: 'Maintained guide retained.' } } });
  write(path.join(directory, 'watch-guide-2026.json'), { season: 2026, updatedAt: '2026-09-02', notes: {}, games: [
    { phase: 'preseason', week: 1, status: 'completed', originalBroadcast: 'KING 5' },
    { phase: 'regular', week: 3, national: 'Maintained later broadcast' },
    { phase: 'regular', week: 2, national: 'Old broadcast' },
  ] });
  const identity = { opponent: 'Arizona Cardinals', date: '2026-09-20', homeAway: 'away', venue: 'State Farm Stadium', startsAt: '2026-09-20T20:25:00.000Z', timeConfirmed: true };
  const common = { gameId: '1392244', team: 'seahawks', season: 2026, phase: 'regular', week: 2, lastUpdated: '2026-09-11T19:00:00Z' };
  const source = { name: 'Official game guide', url: 'https://www.seahawks.com/game-day/' };
  const guides = { schemaVersion: 1, team: 'seahawks', season: 2026, games: { '1392244': { ...common, schemaVersion: 1, game: identity, summary: 'Sourced advice for this game.',
    alerts: [], transportation: [], parking: [], timeline: [{ time: '1:25 PM PT', event: 'Kickoff', details: 'Verified kickoff.', sourceUrl: source.url }], tailgates: [], watchParties: [], stadiumTips: [], weather: null, sources: [source] } } };
  const watch = { schemaVersion: 1, team: 'seahawks', season: 2026, timezone: 'America/Los_Angeles', updatedAt: '2026-09-12', notes: {}, games: [{ ...common, ...identity,
    dateLabel: 'Incorrect generated label', kickoffLabel: 'Wrong time', matchup: 'Wrong matchup', status: 'scheduled', national: 'FOX, regional coverage', officialGameUrl: source.url,
    localTv: [{ name: 'FOX 13 Seattle', url: 'https://www.fox13seattle.com/' }], streams: [], sources: [source] }] };
  const snapshotRoot = path.join(temporary, 'seahawks-guides'), release = path.join(snapshotRoot, 'releases/one'), snapshotDir = path.join(snapshotRoot, 'current');
  fs.mkdirSync(release, { recursive: true });
  fs.symlinkSync('releases/one', snapshotDir);
  const manifest = { schema_version: 1, pipeline: 'guides', team: 'seahawks', season: 2026, runId: 'fixture-run', updatedAt: '2026-09-12T20:00:00Z', files: {} };
  const save = () => {
    for (const [name, data] of [['game-day-guides.json', guides], ['watch-guide.json', watch]]) {
      write(path.join(release, name), data);
      manifest.files[name] = createHash('sha256').update(fs.readFileSync(path.join(release, name))).digest('hex');
    }
    write(path.join(release, 'manifest.json'), manifest);
  };
  save();
  return { projectRoot, directory, schedule, manifest, guides, watch, release, snapshotDir, save,
    options: { projectRoot, snapshotDir, expectedTeam: 'seahawks', expectedAbbreviation: 'SEA', now: Date.parse('2026-09-12T21:00:00Z') } };
}

test('guides remain disabled without explicit opt-in, with no filesystem access', async () => {
  assert.equal(guidesEnabled({}), false);
  assert.equal(guidesEnabled({ FAN_ZONE_GUIDES_ENABLED: '0' }), false);
  assert.equal(guidesEnabled({ FAN_ZONE_GUIDES_ENABLED: '1' }), true);
  assert.throws(() => guidesEnabled({ FAN_ZONE_GUIDES_ENABLED: 'true' }), /0 or 1/);
  assert.deepEqual(await prepareGuides('/does-not-exist', {}, {}), { status: 'disabled' });
  assert.equal(guideSnapshotDirectory({ slug: 'broncos', news_snapshot_dir: '/var/lib/boncosfz-news/current' }), '/var/lib/boncosfz-guides/current');
});

test('valid collection imports only workspace guides with canonical kickoff and per-record freshness', async t => {
  const f = fixture(t), originalSchedule = fs.readFileSync(path.join(f.directory, 'seahawks.json'), 'utf8');
  const result = await importGuideSnapshot(f.options);
  assert.equal(result.snapshotDir, f.release);
  assert.equal(result.gameCount, 1);
  assert.equal(fs.readFileSync(path.join(f.directory, 'seahawks.json'), 'utf8'), originalSchedule);
  const guides = read(path.join(f.directory, 'game-day-guides.json'));
  assert.equal(guides.games.maintained.summary, 'Maintained guide retained.');
  assert.equal(guides.games['1392244'].lastUpdated, '2026-09-11T19:00:00Z');
  const watch = read(path.join(f.directory, 'watch-guide-2026.json'));
  const generated = watch.games.find(entry => entry.gameId === '1392244');
  assert.equal(generated.updatedAt, '2026-09-11');
  assert.equal(generated.scheduleAuthority, 'nfl-snapshot');
  assert.match(generated.kickoffLabel, /1:25/);
  assert.equal(generated.matchup, 'Seattle Seahawks at Arizona Cardinals');
  assert.equal(watch.games.find(entry => entry.week === 3).updatedAt, '2026-09-02');
  assert.equal(watch.games.find(entry => entry.phase === 'preseason').updatedAt, '2026-09-02');
  assert.equal(watch.games.filter(entry => entry.week === 2).length, 1);
  const { reconcileOfficialSchedule } = await import(pathToFileURL(path.join(f.projectRoot, 'src/lib/schedule-guide.mjs')).href);
  generated.status = 'tbd';
  const before = structuredClone(f.schedule.games);
  assert.deepEqual(reconcileOfficialSchedule(f.schedule.games, { season: 2026, games: [generated] }), before);
  const { getWatchGuideEntry } = await import(pathToFileURL(path.join(f.projectRoot, 'src/lib/watch-guide.mjs')).href);
  assert.equal(getWatchGuideEntry({ id: 'wrong-id', season: 2026, phase: 'regular', week: 2 }, watch), null);
  assert.equal(getWatchGuideEntry({ id: '1392244', season: 2026, phase: 'regular', week: 2 }, watch).gameId, '1392244');
});

test('invalid collections cannot change either destination', async t => {
  for (const [label, mutate, pattern] of [
    ['checksum', f => fs.appendFileSync(path.join(f.release, 'watch-guide.json'), ' '), /checksum/],
    ['foreign team', f => { f.watch.team = 'broncos'; f.save(); }, /identity/],
    ['wrong season', f => { f.manifest.season = 2027; f.save(); }, /identity\/season/],
    ['wrong opponent', f => { f.watch.games[0].opponent = 'Denver Broncos'; f.save(); }, /current NFL schedule/],
    ['duplicate week', f => { f.watch.games.push(structuredClone(f.watch.games[0])); f.save(); }, /Duplicate/],
    ['source link', f => { f.guides.games['1392244'].timeline[0].sourceUrl = 'https://unverified.example/'; f.save(); }, /unsourced/],
    ['kickoff flex', f => { f.schedule.games[0].datetime = '2026-09-20T23:25:00Z'; write(path.join(f.directory, 'seahawks.json'), f.schedule); }, /kickoff changed/],
    ['incomplete pair', f => { f.watch.games = []; f.save(); }, /same game IDs/],
  ]) await t.test(label, async subtest => {
    const f = fixture(subtest), destinations = ['game-day-guides.json', 'watch-guide-2026.json'];
    const before = destinations.map(name => fs.readFileSync(path.join(f.directory, name), 'utf8'));
    mutate(f);
    await assert.rejects(importGuideSnapshot(f.options), pattern);
    assert.deepEqual(destinations.map(name => fs.readFileSync(path.join(f.directory, name), 'utf8')), before);
  });
});

test('check-only validates without import; broken and external current links fail', async t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.directory, 'watch-guide-2026.json'), 'utf8');
  assert.equal((await importGuideSnapshot({ ...f.options, checkOnly: true })).checkOnly, true);
  assert.equal(fs.readFileSync(path.join(f.directory, 'watch-guide-2026.json'), 'utf8'), before);
  fs.unlinkSync(f.snapshotDir);
  fs.symlinkSync('releases/missing', f.snapshotDir);
  await assert.rejects(importGuideSnapshot(f.options), /ENOENT/);
  fs.unlinkSync(f.snapshotDir);
  fs.symlinkSync(f.projectRoot, f.snapshotDir);
  await assert.rejects(importGuideSnapshot(f.options), /own snapshot root/);
});
