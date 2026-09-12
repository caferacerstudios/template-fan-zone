import fs from "node:fs";

export const DEFAULT_INJURY_SOURCE = "https://www.{team}.com/team/injury-report/";
const clean = (value) => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
const slug = (name) => clean(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const PARTICIPATION = new Map([["DNP","DNP"],["LP","Limited"],["FP","Full"]]);
const ABSENT_DESIGNATION = /^(?:\(?\s*[-–—]+\s*\)?|(?:not\s+)?(?:specified|listed)|n\/?a)$/i;
const DAY = new Map([["Sun",0],["Mon",1],["Tue",2],["Wed",3],["Thu",4],["Fri",5],["Sat",6]]);
function reportDate(label, now) {
  const wanted = DAY.get(label); if (wanted === undefined) return null;
  const date = new Date(now); date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - wanted + 7) % 7));
  return date.toISOString().slice(0, 10);
}

export function parseOfficialInjuryReport(body, { now = new Date(), sourceUrl = DEFAULT_INJURY_SOURCE } = {}) {
  const table = String(body ?? "").match(/<table[^>]*>[\s\S]*?Table - Injury report[\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];
  const headings = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((item) => clean(item[1]));
  const practiceColumns = headings.map((label, index) => ({ label, index, date: reportDate(label, now) })).filter((item) => item.date);
  const records = [];
  for (const match of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((item) => clean(item[1]));
    const player = [...match[1].matchAll(/\/team\/players-roster\/([^"'/]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .find((candidate) => clean(candidate[2]));
    if (!player || cells.length < headings.length) continue;
    const playerName = clean(player[2]), playerId = player[1] || slug(playerName), injury = cells[2];
    for (const column of practiceColumns) {
      const status = PARTICIPATION.get(cells[column.index]); if (!status) continue;
      records.push({ date: `${column.date}T12:00:00Z`, playerId, playerName, reportType: "Practice Participation", status, injury,
        description: `Practice report: ${status === "DNP" ? "did not participate" : `${status.toLowerCase()} participation`} (${injury.toLowerCase()}).`, sourcePublisher: "Seattle {Team}", sourceUrl, updateStatus: "Official" });
    }
    const designation = clean(cells[headings.length - 1]);
    if (designation && !ABSENT_DESIGNATION.test(designation)) {
      const status = designation[0] + designation.slice(1).toLowerCase();
      const date = practiceColumns.map((column) => column.date).sort().at(-1) ?? now.toISOString().slice(0, 10);
      records.push({ date: `${date}T12:00:00Z`, playerId, playerName, reportType: "Game Status", status, injury,
        description: `Final game designation: ${status} (${injury.toLowerCase()}).`, sourcePublisher: "Seattle {Team}", sourceUrl, updateStatus: "Official" });
    }
  }
  return records;
}

export function reconcileInjuryReports(store, fetched, { now = new Date() } = {}) {
  const valid = (row) => row?.reportType !== "Game Status" || (clean(row.status) && !ABSENT_DESIGNATION.test(clean(row.status)));
  const records = [], observations = new Map();
  for (const row of [...(store?.records ?? []), ...fetched].filter(valid)) {
    const report = row.reportType ? `${String(row.date).slice(0, 10)}:${row.playerId}:${row.reportType}` : null;
    if (!report) { records.push(row); continue; }
    const existingIndex = observations.get(report);
    if (existingIndex === undefined) { observations.set(report, records.length); records.push(row); continue; }
    const existing = records[existingIndex];
    // Keep an already curated source for the same observation; otherwise the
    // newly fetched row replaces stale parser output without adding a duplicate.
    const existingIsGeneric = existing.sourceUrl === DEFAULT_INJURY_SOURCE;
    if (existingIsGeneric) records[existingIndex] = row;
  }
  return { ...store, schemaVersion: Math.max(2, Number(store?.schemaVersion) || 1), asOf: now.toISOString(), sourcePublisher: "Seattle {Team}", sourceUrl: DEFAULT_INJURY_SOURCE,
    sourceNote: "Official dated practice participation and final game-status reports retained as observations alongside reserve-list status.", records };
}

export async function refreshInjuryReports({ file, fetchImpl = globalThis.fetch, now = new Date(), sourceUrl = DEFAULT_INJURY_SOURCE, warn = console.warn, log = console.log } = {}) {
  const previous = JSON.parse(fs.readFileSync(file, "utf8"));
  try {
    const response = await fetchImpl(sourceUrl, { headers: { Accept: "text/html", "User-Agent": "{Team}FanZone injury report refresh" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`official injury report request failed with HTTP ${response.status}`);
    const fetched = parseOfficialInjuryReport(await response.text(), { now, sourceUrl });
    if (!fetched.length) throw new Error("official injury response contained no current report rows");
    const next = reconcileInjuryReports(previous, fetched, { now });
    const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`); fs.renameSync(temporary, file);
    log(`Injury report refreshed with ${fetched.length} dated observations.`); return { updated: true, store: next };
  } catch (error) { warn(`WARNING: injury report refresh failed; preserving last known valid artifact. ${error.message}`); return { updated: false, store: previous, error }; }
}
