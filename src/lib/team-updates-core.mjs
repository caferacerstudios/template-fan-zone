export function newestFirst(rows, dateOf) {
  return rows.slice().sort((a, b) => Date.parse(dateOf(b)) - Date.parse(dateOf(a)));
}

const PLACEHOLDER_GAME_STATUS = /^(?:\(?\s*[-–—]+\s*\)?|(?:not\s+)?(?:specified|listed)|n\/?a)$/i;
const updateDate = (row) => row.timestamp ?? row.date;
const updateTypeRank = (row) => row.reportType === "Game Status" ? 3 : row.timestamp ? 2 : row.reportType === "Practice Participation" ? 1 : 0;

export function isApplicablePlayerUpdate(row) {
  return Boolean(row && Number.isFinite(Date.parse(updateDate(row)))
    && !(row.reportType === "Game Status" && (!String(row.status ?? "").trim() || PLACEHOLDER_GAME_STATUS.test(String(row.status).trim()))));
}

export function latestPlayerUpdates(rows = [], rosterStore = null) {
  const rosterAsOf = Date.parse(rosterStore?.asOf);
  const roster = new Map((rosterStore?.players || []).map((player) => [String(player.id), player]));
  const latest = new Map();
  for (const row of rows.filter(isApplicablePlayerUpdate)) {
    const key = String(row.playerId ?? "");
    if (!key) continue;
    const player = roster.get(key);
    const updateTime = Date.parse(updateDate(row));
    if (row.timestamp && player && Number.isFinite(rosterAsOf) && rosterAsOf > updateTime
      && row.newStatus && row.newStatus !== player.status) continue;
    const previous = latest.get(key);
    const timeDifference = previous ? updateTime - Date.parse(updateDate(previous)) : 1;
    const typeDifference = previous ? updateTypeRank(row) - updateTypeRank(previous) : 1;
    const tieBreaker = previous ? `${row.status ?? row.transactionType ?? ""}:${row.sourceUrl ?? ""}`.localeCompare(`${previous.status ?? previous.transactionType ?? ""}:${previous.sourceUrl ?? ""}`) : 1;
    if (!previous || timeDifference > 0 || (timeDifference === 0 && (typeDifference > 0 || (typeDifference === 0 && tieBreaker > 0)))) latest.set(key, row);
  }
  return latest;
}

const EXPECTED_ROSTER_STATUS = new Map([
  ["Signed", "Active"], ["Claimed", "Active"], ["Practice Squad", "Practice Squad"],
  ["Injured Reserve", "Reserve/Injured"], ["PUP", "PUP"],
  ["Waived", "Waived"], ["Released", "Released"],
]);
const ROSTER_STATUS_VALUES = new Set(["Active", "Practice Squad", "Reserve/Injured", "PUP", "Commissioner Exempt", "Released", "Waived", "Historical"]);
const INJURY_ROSTER_STATUSES = new Set(["Reserve/Injured", "PUP"]);

export function currentInjuryStatuses(injuries, transactions, rosterStore) {
  const current = new Map((rosterStore?.players || [])
    .filter((player) => INJURY_ROSTER_STATUSES.has(player.status))
    .map((player) => [String(player.id), player]));
  const result = [];
  const covered = new Set();
  const reports = new Set();

  for (const row of newestFirst(injuries || [], (entry) => entry.date).filter(isApplicablePlayerUpdate)) {
    if (["Practice Participation", "Game Status"].includes(row.reportType)) {
      const report = `${String(row.date).slice(0, 10)}:${row.playerId}:${row.reportType}`;
      if (reports.has(report)) continue;
      reports.add(report);
      result.push(row);
      continue;
    }
    const player = current.get(String(row.playerId));
    if (!player || row.status !== player.status) continue;
    const identity = `${row.playerId}:${row.status}`;
    if (covered.has(identity)) continue;
    covered.add(identity);
    result.push(row);
  }

  for (const row of newestFirst(transactions || [], (entry) => entry.timestamp)) {
    const player = current.get(String(row.playerId));
    if (!player || row.newStatus !== player.status) continue;
    const identity = `${row.playerId}:${row.newStatus}`;
    if (covered.has(identity)) continue;
    covered.add(identity);
    result.push({
      date: row.timestamp, playerId: row.playerId, playerName: row.playerName ?? player.name,
      status: row.newStatus, description: row.description, sourcePublisher: row.sourcePublisher,
      sourceUrl: row.sourceUrl, updateStatus: row.updateStatus,
    });
  }
  return newestFirst(result, (entry) => entry.date);
}

export function transactionFreshness(store, now = new Date()) {
  const checkedAt = now instanceof Date ? now : new Date(now);
  const asOf = new Date(store?.asOf);
  if (!Number.isFinite(checkedAt.getTime()) || !Number.isFinite(asOf.getTime())) {
    return { stale: true, ageDays: null, maxAgeDays: 0, message: "Transaction freshness is unknown because asOf is missing or invalid." };
  }
  const month = checkedAt.getUTCMonth() + 1;
  const maxAgeDays = month >= 8 || month <= 2 ? 3 : 30;
  const ageDays = Math.max(0, (checkedAt.getTime() - asOf.getTime()) / 86_400_000);
  return {
    stale: ageDays > maxAgeDays,
    ageDays,
    maxAgeDays,
    message: ageDays > maxAgeDays
      ? `Transaction data is ${Math.floor(ageDays)} days old; this is the last successfully verified update, not a complete current record.`
      : `Transactions verified through ${asOf.toISOString()}.`,
  };
}

export function transactionRosterMismatches(transactionStore, rosterStore) {
  const latest = new Map();
  for (const row of newestFirst(transactionStore?.records || [], (record) => record.timestamp)) {
    const key = String(row.playerId ?? "");
    if (key && !latest.has(key)) latest.set(key, row);
  }
  const roster = new Map((rosterStore?.players || []).map((player) => [String(player.id), player]));
  const mismatches = [];
  for (const [playerId, row] of latest) {
    const expected = (ROSTER_STATUS_VALUES.has(row.newStatus) ? row.newStatus : null) || EXPECTED_ROSTER_STATUS.get(row.transactionType)
      || (["Trade", "Elevated"].includes(row.transactionType) ? row.newStatus : null);
    if (!expected) continue;
    const actual = roster.get(playerId)?.status || "Absent";
    if (actual !== expected) mismatches.push({ playerId, playerName: row.playerName, expected, actual, transactionType: row.transactionType });
  }
  return mismatches;
}
