#!/usr/bin/env node
// Import one immutable Airflow recap snapshot without making API requests.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { atomicWriteJson, isCompleteRecap, validateGeneratedRecap } from "../src/lib/recap-artifacts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const read = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));

function validateManifest(manifest, now) {
  if (!object(manifest) || manifest.schema_version !== 1 || !Number.isInteger(manifest.season)
      || !nonempty(manifest.runId) || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)
      || !nonempty(manifest.nflSourceRunId) || !Number.isFinite(Date.parse(manifest.nflSourceUpdatedAt))
      || manifest.model !== "gpt-4o-mini"
      || ![manifest.generatedCount, manifest.requestCount, manifest.openaiRequestCount].every((n) => Number.isInteger(n) && n >= 0)
      || !Array.isArray(manifest.generatedGameIds) || manifest.generatedCount !== manifest.generatedGameIds.length
      || manifest.generatedGameIds.some((id) => typeof id !== "string" || !/^\d+$/.test(id))
      || new Set(manifest.generatedGameIds).size !== manifest.generatedGameIds.length
      || !object(manifest.files) || Object.keys(manifest.files).length !== 1 || !Object.hasOwn(manifest.files, "gameRecaps.json")) {
    throw new Error("Invalid recap snapshot manifest");
  }
  const refreshedAt = Date.parse(manifest.updatedAt);
  if (!Number.isFinite(refreshedAt) || refreshedAt > now + 300000) throw new Error("Recap snapshot has an invalid/future updatedAt");
  if (now - refreshedAt > 24 * 3600000) console.warn(`Recap snapshot is over 24 hours old; retaining its timestamp ${manifest.updatedAt}`);
}

export function importRecapSnapshot({
  projectRoot = root,
  snapshotDir = process.env.RECAP_SNAPSHOT_DIR || "/var/lib/sfz-recaps/current",
  now = Date.now(),
  checkOnly = false,
  ifAvailable = false,
} = {}) {
  if (ifAvailable && !fs.existsSync(path.dirname(snapshotDir))) {
    const existing = read(path.join(projectRoot, "src/data/nfl/gameRecaps.json"));
    if (!object(existing) || !object(existing.recaps)) throw new Error("Current gameRecaps.json has an invalid recap map");
    console.warn(`Recap snapshot is unavailable at ${snapshotDir}; retaining validated repository data.`);
    return { status: "unavailable", snapshotDir, checkOnly };
  }
  const selected = fs.realpathSync(snapshotDir);
  const manifestPath = path.join(selected, "manifest.json");
  if (!fs.lstatSync(manifestPath).isFile()) throw new Error("Recap manifest must be a regular file");
  const manifest = read(manifestPath);
  validateManifest(manifest, now);
  const filename = path.join(selected, "gameRecaps.json");
  if (!fs.lstatSync(filename).isFile()) throw new Error("Recap snapshot must contain a regular gameRecaps.json file");
  const bytes = fs.readFileSync(filename);
  const checksum = manifest.files["gameRecaps.json"];
  if (typeof checksum !== "string" || !/^[a-f0-9]{64}$/.test(checksum) || createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("Recap snapshot checksum mismatch: gameRecaps.json");
  const incoming = JSON.parse(bytes.toString("utf8"));
  if (!object(incoming) || !object(incoming.recaps) || incoming.season !== manifest.season || incoming.updatedAt !== manifest.updatedAt) throw new Error("Recap snapshot season/timestamp mismatch or invalid recap map");
  for (const [id, recap] of Object.entries(incoming.recaps)) {
    if (!object(recap) || (recap.gameId != null && String(recap.gameId) !== id) || (recap.game != null && String(recap.game.id ?? recap.game.game_id) !== id)) throw new Error(`Invalid recap identity: ${id}`);
  }
  for (const id of manifest.generatedGameIds) {
    const recap = incoming.recaps[id];
    validateGeneratedRecap(recap);
    if (recap.gameId !== id || recap.season !== manifest.season || !object(recap.game)) throw new Error(`Invalid generated recap identity: ${id}`);
  }
  const target = path.join(projectRoot, "src/data/nfl/gameRecaps.json");
  const existing = fs.existsSync(target) ? read(target) : { recaps: {} };
  if (!object(existing) || !object(existing.recaps)) throw new Error("Current gameRecaps.json has an invalid recap map");
  const recaps = { ...existing.recaps };
  for (const [id, recap] of Object.entries(incoming.recaps)) {
    const local = recaps[id];
    if (local != null && !object(local)) throw new Error(`Invalid existing recap: ${id}`);
    if (isCompleteRecap(local)) {
      // Preserve local edits, while adding any previously absent metadata.
      recaps[id] = { ...recap, ...local };
    } else if (isCompleteRecap(recap) || local == null) {
      recaps[id] = { ...local, ...recap };
    }
  }
  const result = { status: "success", snapshotDir: selected, updatedAt: manifest.updatedAt, season: manifest.season, generatedCount: manifest.generatedCount, checkOnly };
  if (!checkOnly) {
    atomicWriteJson(target, { ...existing, season: incoming.season, updatedAt: incoming.updatedAt, recaps });
    console.log(`Imported recap snapshot ${manifest.updatedAt} from ${selected}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !["--check-only", "--if-available"].includes(arg))) throw new Error("Usage: node scripts/import-recap-snapshot.mjs [--check-only] [--if-available]");
    console.log(JSON.stringify(importRecapSnapshot({ checkOnly: args.includes("--check-only"), ifAvailable: args.includes("--if-available") })));
  } catch (error) {
    console.error(`Recap snapshot import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
