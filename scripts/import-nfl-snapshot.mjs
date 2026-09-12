#!/usr/bin/env node
// This importer is deliberately network-free. Build consumers select one
// immutable collection before reading any files, even if current changes.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { normalizeSchedule } from "../src/lib/schedule.mjs";
import { validateProductionSchedule } from "../src/lib/production-schedule-validation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = ["{team}.json", "players.json", "standings.json"];
const allowedFiles = new Set([...requiredFiles, "gameRecaps.json"]);
const read = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function oldGameMetadata(schedule) {
  const games = new Map();
  for (const record of [schedule, ...(schedule?.seasons ?? [])]) {
    for (const game of record?.games ?? [...(record?.gamesPreseason ?? []), ...(record?.gamesRegular ?? []), ...(record?.gamesPostseason ?? [])]) {
      const id = String(game?.id ?? game?.game_id ?? "");
      if (id && !games.has(id)) games.set(id, { game, season: record.season });
    }
  }
  return games;
}

function preserveRecaps(target, snapshotRecaps) {
  const recapPath = path.join(target, "gameRecaps.json");
  if (!fs.existsSync(recapPath)) return null;
  const recaps = read(recapPath);
  if (!object(recaps.recaps)) throw new Error("Current gameRecaps.json has an invalid recap map");
  const oldSchedule = path.join(target, "{team}.json");
  const oldGames = oldGameMetadata(fs.existsSync(oldSchedule) ? read(oldSchedule) : null);
  let changed = false;
  for (const [id, recap] of Object.entries(recaps.recaps)) {
    if (!object(recap)) throw new Error(`Invalid existing recap: ${id}`);
    const old = oldGames.get(id);
    const incoming = snapshotRecaps?.recaps?.[id];
    const metadata = old ?? incoming;
    // Existing editorial content always wins. Only attach metadata to recaps
    // already present locally; never resurrect deleted articles from a snapshot.
    if (recap.game == null && metadata?.game) {
      if (String(metadata.game.id ?? metadata.game.game_id) !== id) throw new Error(`Mismatched recap game metadata: ${id}`);
      validateProductionSchedule({ games: [metadata.game] });
      recap.game = metadata.game;
      changed = true;
    }
    const season = recap.game?.season ?? metadata?.season;
    if (recap.season == null && season != null) {
      recap.season = season;
      changed = true;
    }
  }
  return changed ? JSON.stringify(recaps, null, 2) + "\n" : null;
}

export function importNflSnapshot({
  projectRoot = root,
  expectedTeam = "{team}",
  expectedAbbreviation = "{Abbreviation}",
  expectedTeamId = null,
  snapshotDir = process.env.NFL_SNAPSHOT_DIR || "/var/lib/sfz-nfl/current",
  maxAgeHours = process.env.NFL_SNAPSHOT_MAX_AGE_HOURS === undefined ? null : Number(process.env.NFL_SNAPSHOT_MAX_AGE_HOURS),
  now = Date.now(),
  checkOnly = false,
  ifAvailable = false,
} = {}) {
  if (maxAgeHours !== null && (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0)) throw new Error("Invalid NFL_SNAPSHOT_MAX_AGE_HOURS");
  if (ifAvailable && !fs.existsSync(path.dirname(snapshotDir))) {
    const schedule = read(path.join(projectRoot, "src/data/nfl/{team}.json"));
    validateProductionSchedule(schedule);
    console.warn(`NFL snapshot is unavailable at ${snapshotDir}; retaining validated repository data.`);
    return { status: "unavailable", snapshotDir, checkOnly };
  }
  const selected = fs.realpathSync(snapshotDir);
  const manifest = read(path.join(selected, "manifest.json"));
  if (manifest.schema_version !== 1 || !object(manifest.files) || !Number.isInteger(manifest.season)) throw new Error("Invalid NFL snapshot manifest");
  if ((manifest.team != null && manifest.team !== expectedTeam) || (manifest.team == null && expectedTeam !== "seahawks")) throw new Error(`NFL snapshot belongs to a different team: expected ${expectedTeam}`);
  const refreshedAt = Date.parse(manifest.updatedAt);
  if (!Number.isFinite(refreshedAt) || refreshedAt > now + 300000) throw new Error("NFL snapshot has an invalid/future updatedAt");
  if (maxAgeHours !== null && now - refreshedAt > maxAgeHours * 3600000) throw new Error("NFL snapshot is stale under the configured maximum age");
  if (now - refreshedAt > 24 * 3600000) console.warn(`NFL snapshot is over 24 hours old; retaining its original timestamp ${manifest.updatedAt}`);
  for (const name of Object.keys(manifest.files)) if (!allowedFiles.has(name)) throw new Error("Unexpected filename in NFL snapshot manifest");
  for (const name of requiredFiles) if (!Object.hasOwn(manifest.files, name)) throw new Error(`NFL snapshot manifest is missing ${name}`);
  if (fs.existsSync(path.join(selected, "gameRecaps.json")) && !Object.hasOwn(manifest.files, "gameRecaps.json")) throw new Error("Snapshot recap metadata has no manifest checksum");
  const contents = {};
  const payloads = {};
  for (const [name, expected] of Object.entries(manifest.files)) {
    const filename = path.join(selected, name);
    if (!fs.lstatSync(filename).isFile()) throw new Error(`NFL snapshot must contain regular files: ${name}`);
    const bytes = fs.readFileSync(filename);
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected) || createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error(`NFL snapshot checksum mismatch: ${name}`);
    contents[name] = bytes;
    payloads[name] = JSON.parse(bytes.toString("utf8"));
    if (!object(payloads[name])) throw new Error(`Invalid NFL snapshot object: ${name}`);
  }
  for (const name of requiredFiles) {
    const data = payloads[name];
    if (data.updatedAt !== manifest.updatedAt || data.season !== manifest.season) throw new Error(`NFL snapshot season/timestamp mismatch: ${name}`);
  }
  const schedule = payloads["{team}.json"];
  const players = payloads["players.json"];
  const standings = payloads["standings.json"];
  if (schedule.team?.abbreviation !== expectedAbbreviation || players.team?.abbreviation !== expectedAbbreviation || (expectedTeamId != null && schedule.team?.id !== expectedTeamId)) throw new Error(`NFL snapshot team does not match ${expectedTeam}`);
  validateProductionSchedule(schedule);
  const normalized = normalizeSchedule(schedule, manifest.season);
  if (!normalized.gamesRegular.length || !Array.isArray(schedule.playerSeasonStats) || !schedule.playerSeasonStats.length || !Array.isArray(players.playerSeasonStats) || !players.playerSeasonStats.length) throw new Error("NFL snapshot has empty schedule or player statistics");
  if (!schedule.team?.id || schedule.team.id !== players.team?.id || schedule.playerStatsSeason !== players.playerStatsSeason) throw new Error("NFL snapshot player/team identity mismatch");
  for (const phase of ["preseason", "regular", "postseason"]) {
    const bucket = standings.phases?.[phase];
    if (!bucket || bucket.phase !== phase || !Array.isArray(bucket.rows)) throw new Error(`Invalid NFL standings phase: ${phase}`);
    for (const row of bucket.rows) {
      if (![row.wins, row.losses, row.ties].every((n) => Number.isInteger(n) && n >= 0) || row.gamesPlayed !== row.wins + row.losses + row.ties) throw new Error(`Invalid NFL standings record: ${phase}`);
    }
  }
  if (payloads["gameRecaps.json"] && !object(payloads["gameRecaps.json"].recaps)) throw new Error("Invalid snapshot recap metadata");
  const target = path.join(projectRoot, "src/data/nfl");
  const recapText = preserveRecaps(target, payloads["gameRecaps.json"]);
  const result = { status: "success", snapshotDir: selected, updatedAt: manifest.updatedAt, season: manifest.season, checkOnly };
  if (checkOnly) return result;
  fs.mkdirSync(target, { recursive: true });
  const staged = [];
  try {
    // Prepare every file only after all validation and recap merging succeeds.
    const writes = [...(recapText === null ? [] : [["gameRecaps.json", recapText]]), ...requiredFiles.map((name) => [name, contents[name]])];
    for (const [name, content] of writes) {
      const destination = path.join(target, name);
      const temporary = `${destination}.import-${randomUUID()}`;
      fs.writeFileSync(temporary, content, { flag: "wx", mode: 0o644 });
      staged.push([temporary, destination]);
    }
    for (const [temporary, destination] of staged) fs.renameSync(temporary, destination);
  } finally {
    for (const [temporary] of staged) fs.rmSync(temporary, { force: true });
  }
  console.log(`Imported NFL snapshot ${manifest.updatedAt} from ${selected}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = process.argv.slice(2);
    if (options.some((value) => !["--check-only", "--if-available"].includes(value))) throw new Error("Usage: node scripts/import-nfl-snapshot.mjs [--check-only] [--if-available]");
    console.log(JSON.stringify(importNflSnapshot({ checkOnly: options.includes("--check-only"), ifAvailable: options.includes("--if-available") })));
  } catch (error) {
    console.error(`NFL snapshot import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
