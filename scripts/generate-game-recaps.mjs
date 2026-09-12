#!/usr/bin/env node
/** Imports an Airflow-produced snapshot into the durable website recap store. */
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const outputPath = path.join(projectRoot, "src", "data", "nfl", "gameRecaps.json");
const snapshotPath = String(process.env.AIRFLOW_RECAP_SNAPSHOT ?? "").trim();
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const hasContent = (recap) => Boolean(
  String(recap?.text ?? recap?.summary ?? recap?.excerpt ?? "").trim()
  || (Array.isArray(recap?.segments) && recap.segments.some((part) => String(part?.v ?? part?.text ?? part ?? "").trim()))
  || (Array.isArray(recap?.bullets) && recap.bullets.some((item) => String(item?.text ?? item ?? "").trim()))
);

function normalizedRecaps(snapshot) {
  if (snapshot?.recaps && typeof snapshot.recaps === "object" && !Array.isArray(snapshot.recaps)) return snapshot.recaps;
  if (Array.isArray(snapshot?.recaps)) return Object.fromEntries(snapshot.recaps.filter((recap) => recap?.gameId != null).map((recap) => [String(recap.gameId), recap]));
  throw new TypeError("Airflow recap snapshot must contain a recaps object or array.");
}

if (!snapshotPath) {
  console.log("AIRFLOW_RECAP_SNAPSHOT is not set; retaining the current recap snapshot.");
} else {
  const resolvedSnapshot = path.resolve(projectRoot, snapshotPath);
  const incoming = readJson(resolvedSnapshot);
  const existing = fs.existsSync(outputPath) ? readJson(outputPath) : { recaps: {} };
  const merged = { ...(existing?.recaps ?? {}) };
  let imported = 0;
  for (const [rawId, recap] of Object.entries(normalizedRecaps(incoming))) {
    const id = String(recap?.gameId ?? rawId);
    if (!id.trim() || !hasContent(recap)) {
      console.warn(`Skipping invalid or empty recap for game ${id || "(missing id)"}; retaining existing content.`);
      continue;
    }
    merged[id] = { ...(merged[id] ?? {}), ...recap, gameId: id };
    imported++;
  }
  const output = { ...existing, season: incoming?.season ?? existing?.season ?? null, updatedAt: incoming?.updatedAt ?? new Date().toISOString(), recaps: merged };
  const temporaryPath = `${outputPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(output, null, 2)}\n`);
  fs.renameSync(temporaryPath, outputPath);
  console.log(`Imported ${imported} recap(s) from ${path.relative(projectRoot, resolvedSnapshot)}; preserved all other valid recaps.`);
}
