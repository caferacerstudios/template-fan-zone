#!/usr/bin/env node
// Import one immutable roster collection. No web requests or statistics refresh.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROSTER_STATUSES, isCurrentRosterPlayer } from '../src/lib/roster.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['roster.json', 'injuries.json', 'transactions.json'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const validDate = value => text(value) && Number.isFinite(Date.parse(value));
const validUrl = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
const id = value => (typeof value === 'string' && value.trim()) || (Number.isInteger(value) && value > 0);

function validateCollection(payloads, manifest, expectedTeam) {
  for (const [name, schema] of [['roster.json', 1], ['injuries.json', 2], ['transactions.json', 1]]) {
    const data = payloads[name];
    if (!object(data) || data.team !== expectedTeam || data.schemaVersion !== schema) throw new Error(`Invalid roster collection identity/schema: ${name}`);
    if (data.asOf !== null && !validDate(data.asOf)) throw new Error(`Invalid roster collection asOf: ${name}`);
    if (validDate(data.asOf) && Date.parse(data.asOf) > Date.parse(manifest.updatedAt) + 300000) throw new Error(`Future roster source timestamp: ${name}`);
    const rows = name === 'roster.json' ? data.players : data.records;
    if (!Array.isArray(rows)) throw new Error(`Invalid roster collection rows: ${name}`);
    if (rows.length && (!validDate(data.asOf) || !validUrl(data.sourceUrl) || !text(data.sourcePublisher))) throw new Error(`Missing roster collection provenance: ${name}`);
  }
  const roster = payloads['roster.json'];
  if (!Number.isInteger(roster.season) || !roster.players.some(isCurrentRosterPlayer)) throw new Error('Roster snapshot has no current players or season');
  const ids = new Set(), providerIds = new Set();
  for (const player of roster.players) {
    if (!id(player.id) || !text(player.name) || !ROSTER_STATUSES.includes(player.status) || ids.has(String(player.id))) throw new Error('Invalid or duplicate roster player identity/status');
    ids.add(String(player.id));
    if (player.balldontlieId != null) {
      if (!Number.isInteger(player.balldontlieId) || player.balldontlieId < 1 || providerIds.has(player.balldontlieId)) throw new Error('Invalid or duplicate verified balldontlie roster identity');
      providerIds.add(player.balldontlieId);
    }
    if (player.legacyIds != null && (!Array.isArray(player.legacyIds) || player.legacyIds.some(value => !id(value)))) throw new Error('Invalid roster legacy identities');
  }
  for (const [name, dateField] of [['injuries.json', 'date'], ['transactions.json', 'timestamp']]) {
    for (const row of payloads[name].records) {
      if (!id(row.playerId) || !validDate(row[dateField]) || !text(row.description) || !text(row.sourcePublisher) || !validUrl(row.sourceUrl) || !['Official', 'Reported'].includes(row.updateStatus)) throw new Error(`Invalid sourced roster update: ${name}`);
      if (row.team != null && row.team !== expectedTeam) throw new Error(`Foreign team roster update: ${name}`);
      if (name === 'injuries.json' && (!text(row.status) || (row.reportType != null && !['Roster Status', 'Practice Participation', 'Game Status'].includes(row.reportType)))) throw new Error('Invalid injury status observation');
      if (name === 'transactions.json' && (!['Signed', 'Waived', 'Released', 'Claimed', 'Injured Reserve', 'PUP', 'Practice Squad', 'Elevated', 'Trade', 'Extension', 'Other'].includes(row.transactionType) || ![row.previousStatus, row.newStatus].every(value => value === null || typeof value === 'string'))) throw new Error('Invalid transaction observation');
      if (row.entityType === 'transaction' && !String(row.playerId).startsWith('transaction-')) throw new Error('Invalid team transaction identity');
    }
  }
  const injuries = payloads['injuries.json'];
  if (!['available', 'unavailable'].includes(injuries.availability) || !validDate(injuries.sourceCheckedAt) || !Array.isArray(injuries.currentReportKeys)) throw new Error('Missing injury report availability/current observation keys');
  const observationKeys = new Set(injuries.records.filter(row => ['Practice Participation', 'Game Status'].includes(row.reportType)).map(row => `${row.date.slice(0, 10)}:${row.playerId}:${row.reportType}`));
  if (injuries.currentReportKeys.some(key => !text(key) || !observationKeys.has(key)) || (injuries.availability === 'unavailable' && injuries.currentReportKeys.length)) throw new Error('Injury current-report keys do not identify verified observations');
}

export function projectCurrentRoster(data, roster, { expectedTeam, expectedAbbreviation } = {}) {
  if (data.team?.abbreviation !== expectedAbbreviation) throw new Error(`Cannot attach ${expectedTeam} roster to another team's NFL data`);
  // Only membership and its provenance change. Season statistics and their
  // source season remain byte-for-byte equivalent as JSON values.
  return { ...data, currentRoster: roster.players.filter(isCurrentRosterPlayer).map(player => ({ ...player, full_name: player.name, team: data.team })),
    rosterUpdatedAt: roster.asOf, rosterSourceUrl: roster.sourceUrl, rosterSourcePublisher: roster.sourcePublisher,
    rosterSourceNote: roster.sourceNote, currentRosterAvailable: true, rosterIdentityPolicy: 'verified-provider-id' };
}

export function importRosterSnapshot({ projectRoot = root, snapshotDir = process.env.ROSTER_SNAPSHOT_DIR || '/var/lib/sfz-roster/current',
  expectedTeam = process.env.TEAM || '{team}', expectedAbbreviation = process.env.TEAM_ABBREVIATION || '{Abbreviation}', now = Date.now(), checkOnly = false,
  maxAgeHours = process.env.ROSTER_SNAPSHOT_MAX_AGE_HOURS === undefined ? null : Number(process.env.ROSTER_SNAPSHOT_MAX_AGE_HOURS), warn = console.warn } = {}) {
  if (!snapshotDir || !/^[a-z][a-z0-9-]{0,31}$/.test(expectedTeam ?? '')) throw new Error('Roster import requires an explicit team and snapshot directory');
  if (maxAgeHours !== null && (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0)) throw new Error('Invalid ROSTER_SNAPSHOT_MAX_AGE_HOURS');
  const selected = fs.realpathSync(snapshotDir);
  const manifestPath = path.join(selected, 'manifest.json');
  if (!fs.lstatSync(manifestPath).isFile()) throw new Error('Roster manifest must be a regular file');
  const manifest = read(manifestPath);
  if (manifest.schema_version !== 1 || manifest.team !== expectedTeam || !text(manifest.runId) || !object(manifest.files) || Object.keys(manifest.files).length !== files.length || files.some(name => !Object.hasOwn(manifest.files, name))) throw new Error('Invalid roster snapshot manifest or different team');
  const refreshedAt = Date.parse(manifest.updatedAt);
  if (!validDate(manifest.updatedAt) || refreshedAt > now + 300000) throw new Error('Roster snapshot has invalid/future updatedAt');
  if (maxAgeHours !== null && now - refreshedAt > maxAgeHours * 3600000) throw new Error('Roster snapshot is stale under the configured maximum age');
  if (now - refreshedAt > 72 * 3600000) warn(`Roster (${expectedTeam}): snapshot is over 72 hours old; preserving its source timestamps.`);
  const payloads = {};
  for (const name of files) {
    const filename = path.join(selected, name);
    if (!fs.lstatSync(filename).isFile()) throw new Error(`Roster snapshot requires regular files: ${name}`);
    const bytes = fs.readFileSync(filename), checksum = manifest.files[name];
    if (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum) || createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error(`Roster snapshot checksum mismatch: ${name}`);
    payloads[name] = JSON.parse(bytes);
  }
  validateCollection(payloads, manifest, expectedTeam);
  const result = { status: 'success', snapshotDir: selected, team: expectedTeam, updatedAt: manifest.updatedAt, runId: manifest.runId, sourceStatuses: manifest.sourceStatuses ?? null, checkOnly };
  if (checkOnly) return result;
  const roster = { ...payloads['roster.json'], identityPolicy: 'verified-provider-id' };
  const writes = files.map(name => [path.join(projectRoot, 'src/data/team', name), name === 'roster.json' ? roster : payloads[name]]);
  for (const name of [`${expectedTeam}.json`, 'players.json']) {
    const file = path.join(projectRoot, 'src/data/nfl', name);
    if (fs.existsSync(file)) writes.push([file, projectCurrentRoster(read(file), roster, { expectedTeam, expectedAbbreviation })]);
  }
  const staged = [];
  try {
    for (const [destination, data] of writes) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.import-${randomUUID()}`;
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
      staged.push([temporary, destination]);
    }
    for (const [temporary, destination] of staged) fs.renameSync(temporary, destination);
  } finally { for (const [temporary] of staged) fs.rmSync(temporary, { force: true }); }
  console.log(`Roster (${expectedTeam}): imported roster, injury observations and transactions from ${selected}.`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--check-only', '--if-available'].includes(arg))) throw new Error('Usage: node scripts/import-roster-snapshot.mjs [--check-only] [--if-available]');
    const snapshotDir = process.env.ROSTER_SNAPSHOT_DIR || '/var/lib/sfz-roster/current';
    if (args.includes('--if-available') && !fs.existsSync(snapshotDir) && !fs.lstatSync(snapshotDir, { throwIfNoEntry: false })) {
      console.warn(`Roster snapshot unavailable at ${snapshotDir}; existing roster and updates retained.`);
    } else console.log(JSON.stringify(importRosterSnapshot({ snapshotDir, checkOnly: args.includes('--check-only') })));
  } catch (error) {
    console.error(`Roster snapshot import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
