import fs from "node:fs";
import path from "node:path";
import { ROSTER_STATUSES, isCurrentRosterPlayer } from "./roster.mjs";

export const DEFAULT_ROSTER_SOURCE = "https://www.{team}.com/team/players-roster/";

const STATUS_ALIASES = new Map([
  ["active", "Active"], ["roster", "Active"],
  ["practice squad", "Practice Squad"], ["practicesquad", "Practice Squad"], ["practice-squad", "Practice Squad"], ["practice_squad", "Practice Squad"],
  ["reserve/injured", "Reserve/Injured"], ["injured reserve", "Reserve/Injured"], ["reserve injured", "Reserve/Injured"], ["ir", "Reserve/Injured"],
  ["pup", "PUP"], ["reserve/pup", "PUP"], ["reserve/physically unable to perform", "PUP"], ["physically unable to perform", "PUP"],
  ["commissioner exempt", "Commissioner Exempt"], ["commissioner's exempt", "Commissioner Exempt"], ["exempt/commissioner permission", "Commissioner Exempt"],
  ["released", "Released"], ["waived", "Waived"], ["historical", "Historical"],
]);
const CURRENT = new Set(["Active", "Practice Squad", "Reserve/Injured", "PUP", "Commissioner Exempt"]);

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function field(row, ...keys) { for (const key of keys) if (row?.[key] != null && clean(row[key])) return row[key]; return null; }
function decodeText(value) {
  return String(value ?? "").replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (entity, hex, decimal) => {
    const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
    return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  }).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&apos;/gi, "'").replace(/&quot;/gi, '"');
}
function playerName(row) {
  return htmlText(field(row, "name", "fullName", "full_name", "displayName") ?? `${field(row, "firstName", "first_name") ?? ""} ${field(row, "lastName", "last_name") ?? ""}`);
}
export function identityKey(name) {
  return htmlText(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
}
function slug(name) {
  return htmlText(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
const resolvedLegacyApostropheId = (id) => String(id ?? "").includes("-x27-") ? String(id).replaceAll("-x27-", "") : null;
function htmlText(value) {
  return clean(decodeText(String(value ?? "").replace(/<[^>]*>/g, " ")));
}

export function normalizeRosterStatus(value) {
  const raw = clean(typeof value === "object" ? value?.name ?? value?.label ?? value?.title : value).toLowerCase();
  return STATUS_ALIASES.get(raw) ?? null;
}

function looksLikePlayer(row) {
  return row && typeof row === "object" && playerName(row) && field(row, "position", "positionAbbreviation", "position_abbreviation", "pos");
}
function collectCandidateArrays(value, inheritedStatus = null, found = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return found;
  seen.add(value);
  if (Array.isArray(value)) {
    const rows = value.filter(looksLikePlayer);
    if (rows.length) found.push(rows.map((row) => ({ ...row, __sectionStatus: inheritedStatus })));
    for (const item of value) collectCandidateArrays(item, inheritedStatus, found, seen);
    return found;
  }
  const sectionStatus = normalizeRosterStatus(field(value, "status", "title", "label", "name")) ?? inheritedStatus;
  for (const [key, child] of Object.entries(value)) collectCandidateArrays(child, normalizeRosterStatus(key) ?? sectionStatus, found, seen);
  return found;
}

export function parseOfficialRoster(body, contentType = "") {
  const text = String(body ?? "");
  const documents = [];
  if (contentType.includes("json") || /^[\s]*[{[]/.test(text)) {
    try { documents.push(JSON.parse(text)); } catch { /* validation below gives a useful error */ }
  }
  for (const match of text.matchAll(/<script\b[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { documents.push(JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"))); } catch { /* ignore unrelated scripts */ }
  }
  const arrays = documents.flatMap((document) => collectCandidateArrays(document));
  // The club roster currently ships as server-rendered tables rather than a
  // recognizable JSON document. Parse each labeled roster section at the same
  // ingestion boundary so a markup-mode change does not freeze the artifact.
  for (const section of text.matchAll(/<div[^>]+class=["'][^"']*\bnfl-o-roster(?:\s|["'])[^>]*>([\s\S]*?)(?=<div[^>]+class=["'][^"']*\bnfl-o-roster(?:\s|["'])|$)/gi)) {
    const block = section[1];
    const status = normalizeRosterStatus(htmlText(block.match(/nfl-o-roster__title-status[^>]*>([\s\S]*?)<\/span>/i)?.[1]
      ?? block.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i)?.[1]));
    if (!status) continue;
    const rows = [];
    for (const match of block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const row = match[1];
      const player = [...row.matchAll(/<a[^>]+href=["']\/team\/players-roster\/([^"'/]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .find((candidate) => htmlText(candidate[2]));
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => htmlText(cell[1]));
      if (!player || cells.length < 3) continue;
      rows.push({ name: htmlText(player[2]), slug: player[1], number: /^\d+$/.test(cells[1]) ? Number(cells[1]) : null, position: cells[2], status });
    }
    if (rows.length) arrays.push(rows);
  }
  if (!arrays.length) throw new Error("Official roster response contained no recognizable player records.");
  const uniqueRows = new Map();
  for (const row of arrays.flat()) {
    const key = clean(field(row, "id", "playerId", "player_id", "slug")) || identityKey(playerName(row));
    const existing = uniqueRows.get(key);
    const hasStatus = Boolean(normalizeRosterStatus(field(row, "status", "rosterStatus", "roster_status") ?? row.__sectionStatus));
    if (!existing || hasStatus) uniqueRows.set(key, row);
  }
  return [...uniqueRows.values()].map((row) => ({
    name: playerName(row),
    position: clean(field(row, "positionAbbreviation", "position_abbreviation", "position", "pos")),
    number: field(row, "jerseyNumber", "jersey_number", "number", "jersey") == null ? null : Number(field(row, "jerseyNumber", "jersey_number", "number", "jersey")),
    status: normalizeRosterStatus(field(row, "status", "rosterStatus", "roster_status") ?? row.__sectionStatus) ?? clean(field(row, "status", "rosterStatus", "roster_status") ?? row.__sectionStatus),
    sourceId: clean(field(row, "id", "playerId", "player_id", "slug")) || null,
  }));
}

export function reconcileRoster(previous, fetched, { now = new Date(), sourceUrl = DEFAULT_ROSTER_SOURCE } = {}) {
  const oldPlayers = Array.isArray(previous?.players) ? previous.players : [];
  const byIdentity = new Map(oldPlayers.map((player) => [identityKey(player.name), player]));
  const bySourceId = new Map(oldPlayers.filter((player) => player.sourceId).map((player) => [String(player.sourceId), player]));
  const usedIds = new Set();
  const incoming = fetched.map((row) => {
    const old = (row.sourceId && bySourceId.get(String(row.sourceId))) || byIdentity.get(identityKey(row.name));
    const canonicalSlug = slug(row.name);
    const resolvedLegacyId = resolvedLegacyApostropheId(old?.id);
    let id = resolvedLegacyId === canonicalSlug ? canonicalSlug : old?.id || canonicalSlug;
    if (usedIds.has(id)) throw new Error(`Duplicate current ID produced by source records: ${id}`);
    usedIds.add(id);
    const legacyIds = [...new Set([...(old?.legacyIds || []), ...(resolvedLegacyId === canonicalSlug ? [old.id] : [])])];
    return { ...(old || {}), id, ...(legacyIds.length ? { legacyIds } : {}), name: row.name, position: row.position, number: Number.isFinite(row.number) ? row.number : null, status: row.status, ...(row.sourceId ? { sourceId: row.sourceId } : {}) };
  });
  const present = new Set(incoming.map((player) => player.id));
  const presentIdentities = new Set(incoming.map((player) => identityKey(player.name)));
  const removed = oldPlayers.filter((player) => !present.has(player.id) && !presentIdentities.has(identityKey(player.name))).map((player) => isCurrentRosterPlayer(player) ? { ...player, status: "Historical" } : player);
  const season = now.getUTCMonth() <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return { ...previous, schemaVersion: previous?.schemaVersion ?? 1, season, asOf: now.toISOString(), sourceUrl, sourceNote: "Automatically refreshed from the official Seattle {Team} roster page.", players: [...incoming, ...removed] };
}

export function validateRosterRefresh(next, previous = null, { allowLargeChange = false } = {}) {
  const errors = [];
  const players = Array.isArray(next?.players) ? next.players : [];
  const current = players.filter((player) => CURRENT.has(player.status));
  if (!current.length) errors.push("zero current players");
  const ids = current.map((player) => clean(player.id));
  const duplicateIds = [...new Set(ids.filter((id, index) => id && ids.indexOf(id) !== index))];
  if (duplicateIds.length) errors.push(`duplicate current IDs: ${duplicateIds.join(", ")}`);
  if (current.filter((player) => player.status === "Active").length > 90) errors.push("implausibly large active roster");
  const unknown = [...new Set(players.map((player) => player.status).filter((status) => !ROSTER_STATUSES.includes(status)))];
  if (unknown.length) errors.push(`unknown statuses: ${unknown.join(", ")}`);
  const priorCount = Array.isArray(previous?.players) ? previous.players.filter((player) => CURRENT.has(player.status)).length : 0;
  if (!allowLargeChange && priorCount >= 20 && Math.abs(current.length - priorCount) > Math.max(8, Math.ceil(priorCount * 0.15))) {
    errors.push(`dramatic roster-count change (${priorCount} to ${current.length}); rerun with --allow-large-change after verification`);
  }
  if (errors.length) throw new Error(`Refusing suspicious roster refresh: ${errors.join("; ")}.`);
  return next;
}

export function atomicWriteRoster(file, store) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

export async function refreshRoster({ file, fetchImpl = globalThis.fetch, now = new Date(), sourceUrl = DEFAULT_ROSTER_SOURCE, allowLargeChange = false, warn = console.warn, log = console.log } = {}) {
  const previous = JSON.parse(fs.readFileSync(file, "utf8"));
  try {
    validateRosterRefresh(previous);
    const response = await fetchImpl(sourceUrl, { headers: { Accept: "text/html,application/json", "User-Agent": "{Team}FanZone roster refresh" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`official roster request failed with HTTP ${response.status}`);
    const fetched = parseOfficialRoster(await response.text(), response.headers?.get?.("content-type") || "");
    const next = reconcileRoster(previous, fetched, { now, sourceUrl });
    validateRosterRefresh(next, previous, { allowLargeChange });
    atomicWriteRoster(file, next);
    log(`Roster refreshed: ${next.players.filter((player) => CURRENT.has(player.status)).length} current players as of ${next.asOf}.`);
    return { updated: true, store: next };
  } catch (error) {
    warn(`WARNING: roster refresh failed; preserving last known valid artifact at ${path.relative(process.cwd(), file)}. ${error.message}`);
    return { updated: false, store: previous, error };
  }
}
