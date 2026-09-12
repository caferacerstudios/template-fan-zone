export const ROSTER_STATUSES = ["Active", "Practice Squad", "Reserve/Injured", "PUP", "Commissioner Exempt", "Released", "Waived", "Historical"];
const HISTORICAL_STATUSES = new Set(["released", "waived", "retired", "historical", "former"]);

const id = (player) => String(player?.id ?? player?.playerId ?? "").trim();

export function isCurrentRosterPlayer(player) {
  if (!player || !id(player)) return false;
  const status = String(player.status || "").trim().toLowerCase();
  return status.length > 0 && !HISTORICAL_STATUSES.has(status);
}

export function currentRosterPlayers(store) {
  const rows = Array.isArray(store?.players) ? store.players : [];
  return rows.filter((player) => player.status === "Active");
}

export function practiceSquadPlayers(store) {
  return filterRosterByStatus(store, "Practice Squad");
}

export function reserveRosterPlayers(store) {
  const rows = Array.isArray(store?.players) ? store.players : [];
  return rows.filter((player) => ["Reserve/Injured", "PUP", "Commissioner Exempt"].includes(player.status));
}

export function currentRosterDirectoryPlayers(store) {
  const rows = Array.isArray(store?.players) ? store.players : [];
  return rows.filter(isCurrentRosterPlayer);
}

export function currentRosterDirectoryCount(store) {
  return new Set(currentRosterDirectoryPlayers(store).map(id).filter(Boolean)).size;
}

export function rosterCount(store) {
  return new Set(currentRosterPlayers(store).map(id).filter(Boolean)).size;
}

export function duplicateCurrentPlayerIds(store) {
  const seen = new Set();
  const duplicates = new Set();
  for (const player of currentRosterPlayers(store)) {
    const key = id(player);
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

export function filterRosterByStatus(store, statuses) {
  const allowed = new Set(Array.isArray(statuses) ? statuses : [statuses]);
  return (Array.isArray(store?.players) ? store.players : []).filter((player) => allowed.has(player.status));
}

export function rosterFreshness(store, now = new Date()) {
  const checkedAt = now instanceof Date ? now : new Date(now);
  const asOf = new Date(store?.asOf);
  if (!Number.isFinite(checkedAt.getTime()) || !Number.isFinite(asOf.getTime())) {
    return { stale: true, ageDays: null, maxAgeDays: 0, message: "Roster freshness is unknown because asOf is missing or invalid." };
  }

  const month = checkedAt.getUTCMonth() + 1;
  const activeSeason = month >= 8 || month <= 2;
  const maxAgeDays = activeSeason ? 3 : 30;
  const ageDays = Math.max(0, (checkedAt.getTime() - asOf.getTime()) / 86_400_000);
  const stale = ageDays > maxAgeDays;
  return {
    stale,
    ageDays,
    maxAgeDays,
    message: stale
      ? `Roster data is ${Math.floor(ageDays)} days old (maximum ${maxAgeDays} during ${activeSeason ? "the active season" : "the offseason"}); using the last known valid roster.`
      : `Roster data is current as of ${asOf.toISOString()}.`,
  };
}
