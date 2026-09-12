import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importRosterSnapshot } from '../scripts/import-roster-snapshot.mjs';
import { prepareRoster, rosterSnapshotDirectory } from './roster.mjs';
import { reserveRosterPlayers, currentRosterPlayers } from '../src/lib/roster.mjs';
import { updatePlayerPath, currentInjuryStatuses, transactionRosterMismatches } from '../src/lib/team-updates-core.mjs';
import { verifiedRosterStatRows } from '../src/lib/roster-provider.mjs';
import { renderText, teamSettings } from './render.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const now = Date.now();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data) + '\n'); };
const teams = [['seahawks', 'SEA', 'sfz'], ['broncos', 'DEN', 'boncosfz'], ['packers', 'GB', 'packersfz'], ['vikings', 'MIN', 'vikingsfz'], ['chiefs', 'KC', 'chiefsfz']];

function workspace(t, slug = 'broncos') {
  const [, abbreviation, prefix] = teams.find(team => team[0] === slug);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fanzone-roster-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const project = path.join(directory, 'rendered'), current = path.join(directory, `${prefix}-roster/current`), snapshot = path.join(directory, `${prefix}-roster/snapshots/one`);
  const site = { slug, abbreviation, name: slug, city: 'Unit', news_snapshot_dir: path.join(directory, `${prefix}-news/current`) };
  const source = { team: slug, asOf: new Date(now).toISOString(), sourcePublisher: `${slug} official`, sourceUrl: `https://www.${slug}.com/team/players-roster/` };
  const roster = { ...source, schemaVersion: 1, season: 2026, sourceNote: 'Official club roster.', players: [
    { id: 'same-name', legacyIds: ['old-route'], sourceId: 'club-same-name', name: 'Same Name', position: 'QB', status: 'Active', balldontlieId: 123 },
    { id: 'another-name', name: 'Another Name', position: 'QB', status: 'Practice Squad' },
    { id: 'suspended-player', name: 'Suspended Player', position: 'S', status: 'Suspended', sourceStatus: 'Reserve/Suspended' },
    { id: 'nfi-player', name: 'NFI Player', position: 'S', status: 'Reserve/Non-Football Injury' },
    { id: 'departed-player', name: 'Departed Player', status: 'Historical' },
  ] };
  const payloads = { 'roster.json': roster,
    'injuries.json': { ...source, schemaVersion: 2, asOf: null, availability: 'unavailable', availabilityReason: 'The selected official report cannot be dated.', sourceCheckedAt: source.asOf, currentReportKeys: [], records: [] },
    'transactions.json': { ...source, schemaVersion: 1, records: [{ timestamp: source.asOf, entityType: 'transaction', playerId: 'transaction-123', playerName: 'Team transaction', transactionType: 'Other', previousStatus: null, newStatus: null, description: 'Signed two players; Seattle appears here as a real former club.', sourcePublisher: source.sourcePublisher, sourceUrl: source.sourceUrl, updateStatus: 'Official' }] },
  };
  const manifest = { schema_version: 1, team: slug, runId: 'test-run', updatedAt: source.asOf, files: {} };
  function save() {
    for (const [name, data] of Object.entries(payloads)) { write(path.join(snapshot, name), data); manifest.files[name] = createHash('sha256').update(fs.readFileSync(path.join(snapshot, name))).digest('hex'); }
    write(path.join(snapshot, 'manifest.json'), manifest);
  }
  save(); fs.symlinkSync('snapshots/one', current);
  const stats = [{ player: { id: 123, full_name: 'Same Name' }, passing_yards: 100 }, { player: { id: 456, full_name: 'Same Name' }, passing_yards: 999 }, { player: { id: 777, full_name: 'Another Name' }, passing_yards: 666 }];
  const data = { team: { abbreviation, id: 99 }, season: 2026, playerStatsSeason: 2025, playerSeasonStats: stats, updatedAt: source.asOf, currentRoster: [{ id: 456, full_name: 'Old NFL membership' }] };
  for (const name of [slug, 'players']) write(path.join(project, `src/data/nfl/${name}.json`), data);
  for (const name of ['roster', 'injuries', 'transactions']) write(path.join(project, `src/data/team/${name}.json`), { team: 'seahawks', season: 2026, players: [{ id: 'seed', name: 'Legacy Seattle', status: 'Active' }], records: [{ playerName: 'Legacy Seattle' }] });
  for (const relative of ['scripts/import-roster-snapshot.mjs', 'src/lib/roster.mjs', 'src/lib/player-profile-generation.mjs']) {
    fs.mkdirSync(path.dirname(path.join(project, relative)), { recursive: true }); fs.writeFileSync(path.join(project, relative), renderText(fs.readFileSync(path.join(root, relative), 'utf8'), teamSettings(slug)));
  }
  return { project, site, current, snapshot, payloads, manifest, save, stats };
}

for (const [slug, abbreviation, prefix] of teams) test(`${slug}: official roster replaces membership and keeps literal sources and historical stats`, async t => {
  const f = workspace(t, slug);
  assert.equal(rosterSnapshotDirectory({ news_snapshot_dir: `/var/lib/${prefix}-news/current` }), `/var/lib/${prefix}-roster/current`);
  await prepareRoster(f.project, f.site);
  const roster = read(path.join(f.project, 'src/data/team/roster.json'));
  assert.equal(roster.team, slug);
  assert.equal(roster.identityPolicy, 'verified-provider-id');
  assert.deepEqual(roster.players[0].legacyIds, ['old-route']);
  assert.equal(currentRosterPlayers(roster).length, 1);
  assert.equal(reserveRosterPlayers(roster).length, 2);
  for (const name of [slug, 'players']) {
    const data = read(path.join(f.project, `src/data/nfl/${name}.json`));
    assert.equal(data.team.abbreviation, abbreviation);
    assert.equal(data.playerStatsSeason, 2025);
    assert.deepEqual(data.playerSeasonStats, f.stats);
    assert.equal(data.currentRoster.length, 4);
    assert.equal(data.currentRoster[0].id, 'same-name');
  }
  const transactions = read(path.join(f.project, 'src/data/team/transactions.json'));
  assert.equal(transactions.records[0].description, f.payloads['transactions.json'].records[0].description);
  assert.equal(read(path.join(f.project, 'src/data/team/injuries.json')).availability, 'unavailable');
});

test('missing collection retains Seattle seed and clears new-team roster and updates honestly', async t => {
  for (const slug of ['seahawks', 'broncos']) {
    const f = workspace(t, slug); fs.unlinkSync(f.current);
    const before = fs.readFileSync(path.join(f.project, 'src/data/team/roster.json'), 'utf8');
    await prepareRoster(f.project, f.site);
    const after = fs.readFileSync(path.join(f.project, 'src/data/team/roster.json'), 'utf8');
    if (slug === 'seahawks') assert.equal(after, before);
    else {
      assert.deepEqual(JSON.parse(after).players, []);
      assert.equal(JSON.parse(after).asOf, null);
      assert.deepEqual(read(path.join(f.project, `src/data/nfl/${slug}.json`)).currentRoster, []);
      assert.deepEqual(read(path.join(f.project, `src/data/nfl/${slug}.json`)).playerSeasonStats, f.stats);
    }
  }
});

test('wrong team, checksum, broken symlink and bad identity fail before modifying rendered data', async t => {
  const f = workspace(t), before = fs.readFileSync(path.join(f.project, 'src/data/team/roster.json'), 'utf8');
  f.manifest.team = 'seahawks'; f.save();
  await assert.rejects(prepareRoster(f.project, f.site), /different team/);
  f.manifest.team = 'broncos'; f.save(); fs.appendFileSync(path.join(f.snapshot, 'transactions.json'), ' ');
  await assert.rejects(prepareRoster(f.project, f.site), /checksum mismatch/);
  f.payloads['roster.json'].players[1].balldontlieId = 123; f.save();
  await assert.rejects(prepareRoster(f.project, f.site), /duplicate verified/);
  fs.unlinkSync(f.current); fs.symlinkSync('missing', f.current);
  await assert.rejects(prepareRoster(f.project, f.site), /link is broken/);
  assert.equal(fs.readFileSync(path.join(f.project, 'src/data/team/roster.json'), 'utf8'), before);
});

test('stale collection keeps its timestamp, warns, and supports an explicit maximum age', t => {
  const f = workspace(t), warnings = [], options = { projectRoot: f.project, snapshotDir: f.current, expectedTeam: 'broncos', expectedAbbreviation: 'DEN', now: now + 4 * 86400000, warn: text => warnings.push(text), checkOnly: true };
  const result = importRosterSnapshot(options);
  assert.equal(result.updatedAt, f.manifest.updatedAt); assert.equal(warnings.length, 1);
  assert.throws(() => importRosterSnapshot({ ...options, maxAgeHours: 72 }), /stale/);
});

test('invalid source records and unexpected manifest files cannot enter a collection', t => {
  const f = workspace(t), options = { projectRoot: f.project, snapshotDir: f.current, expectedTeam: 'broncos', expectedAbbreviation: 'DEN' };
  f.payloads['transactions.json'].records[0].sourceUrl = 'javascript:alert(1)'; f.save();
  assert.throws(() => importRosterSnapshot(options), /Invalid sourced/);
  f.payloads['transactions.json'].records[0].sourceUrl = 'https://www.denverbroncos.com/team/transactions/2026';
  f.manifest.files['../foreign.json'] = 'a'.repeat(64); f.save();
  assert.throws(() => importRosterSnapshot(options), /manifest/);
});

test('unverified same-name identities cannot acquire another player statistics or generated biography facts', async t => {
  const f = workspace(t), store = { ...f.payloads['roster.json'], identityPolicy: 'verified-provider-id' };
  const { enrichRoster } = await import(pathToFileURL(path.join(f.project, 'src/lib/player-profile-generation.mjs')).href);
  assert.deepEqual(verifiedRosterStatRows(store, ['same-name', '456'], f.stats), [f.stats[0]]);
  assert.deepEqual(verifiedRosterStatRows(store, ['old-route'], f.stats), [f.stats[0]]);
  assert.deepEqual(verifiedRosterStatRows(store, ['another-name', '777'], f.stats), []);
  const enriched = enrichRoster(store, { playerSeasonStats: f.stats, playerStatsSeason: 2025 }, [], () => {});
  assert.equal(enriched[0].statistics.passing_yards, 100);
  assert.deepEqual(enriched[1].statistics, {});
});

test('generic transaction entries and unresolved names never produce a fake player link', () => {
  const ids = new Set(['same-name', 'transaction-123']);
  assert.equal(updatePlayerPath({ playerId: 'same-name' }, ids), '/players/same-name');
  assert.equal(updatePlayerPath({ entityType: 'transaction', playerId: 'transaction-123' }, ids), null);
  assert.equal(updatePlayerPath({ playerId: 'unresolved' }, ids), null);
  const move = { timestamp: '2026-09-12T12:00:00Z', playerId: 'transaction-123', entityType: 'transaction', transactionType: 'Signed', previousStatus: null, newStatus: null };
  assert.deepEqual(transactionRosterMismatches({ records: [move] }, { players: [] }), []);
});

test('archived injury observations are not current after an empty or unavailable official report', () => {
  const roster = { players: [{ id: 'same-name', name: 'Same Name', status: 'Active' }] };
  const report = { date: '2026-09-08T12:00:00Z', playerId: 'same-name', reportType: 'Game Status', status: 'Out' };
  assert.deepEqual(currentInjuryStatuses([report], [], roster, { currentReportKeys: [] }), []);
  assert.deepEqual(currentInjuryStatuses([report], [], roster, { currentReportKeys: ['2026-09-08:same-name:Game Status'] }), [report]);
  assert.deepEqual(currentInjuryStatuses([report], [], roster), [report]); // Legacy Seattle fallback.
});

test('current reserve membership has a sourced roster observation without an inferred injury or placement date', () => {
  const roster = { asOf: '2026-09-12T17:00:00Z', sourceUrl: 'https://www.denverbroncos.com/team/players-roster/', sourcePublisher: 'Denver Broncos', players: [
    { id: 'reserve-player', name: 'Reserve Player', status: 'Reserve/Injured', sourceStatus: 'Reserve/Injured' },
    { id: 'nfi-player', name: 'NFI Player', status: 'Reserve/Non-Football Injury' },
    { id: 'suspended-player', name: 'Suspended Player', status: 'Suspended' },
  ] };
  const observations = currentInjuryStatuses([], [], roster, { currentReportKeys: [] });
  assert.equal(observations.length, 2);
  for (const row of observations) {
    assert.equal(row.reportType, 'Roster Status');
    assert.equal(row.date, roster.asOf);
    assert.equal(row.sourceUrl, roster.sourceUrl);
    assert.match(row.description, /^Official roster lists /);
    assert.match(row.description, / as of 2026-09-12\.$/);
    assert.doesNotMatch(row.description, /placed|diagnos|recover|return/i);
  }
  assert.equal(currentInjuryStatuses([observations[0]], [], roster, { currentReportKeys: [] }).length, 2);
});
