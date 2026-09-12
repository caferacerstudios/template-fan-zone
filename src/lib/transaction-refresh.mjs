import fs from "node:fs";
import { identityKey } from "./roster-refresh.mjs";

export const DEFAULT_TRANSACTION_SOURCE = "https://www.{team}.com/team/transactions/2026";
const MONTHS = new Map([
  ["January", "01"], ["February", "02"], ["March", "03"], ["April", "04"],
  ["May", "05"], ["June", "06"], ["July", "07"], ["August", "08"],
  ["September", "09"], ["October", "10"], ["November", "11"], ["December", "12"],
]);
const clean = (value) => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
const slug = (name) => clean(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parseOfficialTransactions(body, season) {
  const records = [];
  for (const table of String(body ?? "").matchAll(/<div[^>]+nfl-c-transactions-report[^>]*>([\s\S]*?)<\/table>/gi)) {
    const block = table[1];
    const month = MONTHS.get(clean(block.match(/nfl-c-transactions-report__month[^>]*>([\s\S]*?)<\/th>/i)?.[1]));
    if (!month) continue;
    for (const row of block.matchAll(/nfl-c-transactions-report__date[^>]*>(\d{2})\/(\d{2})<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
      const [, sourceMonth, day, copy] = row;
      if (sourceMonth !== month) continue;
      const statements = clean(copy).split(/\.\s+/).map((item) => item.replace(/\.$/, "").trim()).filter(Boolean);
      statements.forEach((statement, index) => {
        const match = statement.match(/^(Signed|Released)\s+(?:[A-Z][A-Z/]*\s+)?(.+?)\s+(to|from) the practice squad$/i);
        if (!match) return;
        const signed = match[1].toLowerCase() === "signed", playerName = clean(match[2]);
        records.push({
          timestamp: `${season}-${month}-${day}T20:00:${String(index).padStart(2, "0")}Z`,
          playerId: slug(playerName), playerName,
          transactionType: signed ? "Practice Squad" : "Released",
          previousStatus: signed ? "Released" : "Practice Squad",
          newStatus: signed ? "Practice Squad" : "Released",
          description: `Seattle ${signed ? "signed" : "released"} ${playerName} ${signed ? "to" : "from"} the practice squad.`,
          sourcePublisher: "Seattle {Team}", sourceUrl: DEFAULT_TRANSACTION_SOURCE, updateStatus: "Official",
        });
      });
    }
  }
  return records;
}

export function reconcileTransactions(store, fetched, { now = new Date(), sourceUrl = DEFAULT_TRANSACTION_SOURCE } = {}) {
  const records = [...(store?.records ?? [])];
  const identities = new Set(records.map((row) => `${row.timestamp.slice(0,10)}:${identityKey(row.playerName)}:${row.newStatus}`));
  for (const row of fetched) {
    const key = `${row.timestamp.slice(0,10)}:${identityKey(row.playerName)}:${row.newStatus}`;
    if (!identities.has(key)) { records.push({ ...row, sourceUrl }); identities.add(key); }
  }
  const latestDate = fetched.map((row) => row.timestamp.slice(0,10)).sort().at(-1);
  return { ...store, records, asOf: now.toISOString(), sourcePublisher: "Seattle {Team}", sourceUrl,
    sourceNote: `Official {Team} transaction log verified${latestDate ? ` through ${latestDate}` : ""}; records are event-based and may include multiple moves for one player.` };
}

export async function refreshTransactions({ file, fetchImpl = globalThis.fetch, now = new Date(), sourceUrl = DEFAULT_TRANSACTION_SOURCE, warn = console.warn, log = console.log } = {}) {
  const previous = JSON.parse(fs.readFileSync(file, "utf8"));
  try {
    const response = await fetchImpl(sourceUrl, { headers: { Accept: "text/html", "User-Agent": "{Team}FanZone transaction refresh" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`official transaction request failed with HTTP ${response.status}`);
    const fetched = parseOfficialTransactions(await response.text(), Number(previous?.season ?? now.getUTCFullYear()));
    if (!fetched.length) throw new Error("official transaction response contained no supported records");
    const next = reconcileTransactions(previous, fetched, { now, sourceUrl });
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`); fs.renameSync(temporary, file);
    log(`Transactions verified through ${next.sourceNote.match(/through ([\d-]+)/)?.[1] ?? "official source"}.`);
    return { updated: true, store: next };
  } catch (error) {
    warn(`WARNING: transaction refresh failed; preserving last known valid artifact. ${error.message}`);
    return { updated: false, store: previous, error };
  }
}
