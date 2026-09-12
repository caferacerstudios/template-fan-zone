import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { currentRosterDirectoryCount, currentRosterPlayers, duplicateCurrentPlayerIds, filterRosterByStatus, practiceSquadPlayers, reserveRosterPlayers, rosterCount } from "../src/lib/roster.mjs";
import { currentInjuryStatuses, newestFirst, transactionFreshness, transactionRosterMismatches } from "../src/lib/team-updates-core.mjs";

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));
const roster = read("../src/data/team/roster.json");
const transactions = read("../src/data/team/transactions.json");
const injuries = read("../src/data/team/injuries.json");

test("official roster snapshot count excludes reserve and historical records", () => {
  assert.equal(rosterCount(roster), 54);
  assert.equal(currentRosterPlayers(roster).length, 54);
  assert.equal(practiceSquadPlayers(roster).length, 16);
  assert.equal(filterRosterByStatus(roster, "Reserve/Injured").length, 9);
  assert.equal(reserveRosterPlayers(roster).length, 11);
  assert.equal(currentRosterDirectoryCount(roster), 81);
});

test("injury tracker keeps dated game-week reports separate from current reserve statuses", () => {
  const statuses = currentInjuryStatuses(injuries.records, transactions.records, roster);
  assert.ok(statuses.some((row) => row.playerId === "zach-charbonnet" && row.status === "PUP"));
  assert.ok(statuses.some((row) => row.playerId === "irv-charles" && row.status === "Reserve/Injured"));
  assert.ok(!statuses.some((row) => row.playerId === "terrion-arnold"));
  assert.equal(statuses.filter((row) => row.playerId === "bud-clark").length, 1);
  assert.ok(statuses.some((row) => row.playerId === "ty-okada" && row.reportType === "Game Status" && row.status === "Out"));
  assert.ok(statuses.some((row) => row.playerId === "nick-emmanwori" && row.reportType === "Game Status" && row.status === "Questionable"));
  assert.deepEqual(new Set(statuses.filter((row) => row.reportType === "Practice Participation").map((row) => row.status)), new Set(["DNP", "Limited", "Full"]));
});

test("current roster has no duplicate player identities", () => {
  assert.deepEqual(duplicateCurrentPlayerIds(roster), []);
});

test("status filtering does not treat historical records as current", () => {
  const fixture = { players: [...roster.players, { id: "old", status: "Historical" }] };
  assert.equal(rosterCount(fixture), 54);
  assert.equal(filterRosterByStatus(fixture, "Historical").length, 1);
});

test("transactions sort newest first without mutating imported order", () => {
  const original = transactions.records.map((row) => row.timestamp);
  const sorted = newestFirst(transactions.records, (row) => row.timestamp);
  assert.deepEqual(transactions.records.map((row) => row.timestamp), original);
  for (let index = 1; index < sorted.length; index++) {
    assert.ok(Date.parse(sorted[index - 1].timestamp) >= Date.parse(sorted[index].timestamp));
  }
});

test("transaction ledger preserves its original prefix and appends later player events", () => {
  assert.equal(createHash("sha256").update(JSON.stringify(transactions.records.slice(0, 4))).digest("hex"), "67853b3a9b180ccb24307061cfdea798d23c0ea86a7cc229de58e726379c60c5");
  assert.deepEqual(transactions.records.slice(0, 4).map(({ timestamp, playerId, transactionType }) => ({ timestamp, playerId, transactionType })), [
    { timestamp: "2026-08-27T19:59:00Z", playerId: "leonard-williams", transactionType: "Extension" },
    { timestamp: "2026-08-17T19:44:00Z", playerId: "devon-witherspoon", transactionType: "Extension" },
    { timestamp: "2026-06-03T16:29:00Z", playerId: "derick-hall", transactionType: "Extension" },
    { timestamp: "2026-03-25T19:09:00Z", playerId: "jaxon-smith-njigba", transactionType: "Extension" },
  ]);
  assert.deepEqual(transactions.records.filter((row) => row.playerId === "trevon-diggs").map((row) => row.transactionType), ["Released", "Practice Squad"]);
});

test("transactions use supported types, official/reporting labels, and source URLs", () => {
  const validTypes = new Set(["Signed", "Waived", "Released", "Claimed", "Injured Reserve", "PUP", "Practice Squad", "Elevated", "Trade", "Extension", "Other"]);
  for (const row of transactions.records) {
    assert.ok(validTypes.has(row.transactionType), `invalid type for ${row.playerName}`);
    assert.ok(["Official", "Reported"].includes(row.updateStatus), `invalid update status for ${row.playerName}`);
    assert.match(row.sourceUrl, /^https?:\/\//, `missing source URL for ${row.playerName}`);
  }
});

test("latest meaningful transactions reconcile with current roster statuses", () => {
  assert.deepEqual(transactionRosterMismatches(transactions, roster), []);
  const latest = new Map(newestFirst(transactions.records, (row) => row.timestamp).map((row) => [row.playerId, row]));
  assert.equal(roster.players.find((row) => row.id === "avery-smith").status, "Active");
  assert.equal(roster.players.find((row) => row.id === "trevon-diggs").status, "Practice Squad");
  assert.equal(roster.players.find((row) => row.id === "kellen-diesch").status, "Released");
  assert.equal(latest.get("irv-charles").newStatus, "Reserve/Injured");
  assert.equal(latest.get("bobby-hart").newStatus, "Practice Squad");
  assert.equal(latest.get("danthony-bell").newStatus, "Practice Squad");
  assert.equal(latest.get("aj-finley").newStatus, "Active");
  assert.equal(latest.get("uso-seumalo").newStatus, "Released");
  assert.equal(latest.get("marvin-jones-jr").newStatus, "Released");
});

test("transaction freshness becomes explicit when the verified snapshot ages", () => {
  assert.equal(transactionFreshness(transactions, new Date("2026-09-03T12:00:00-07:00")).stale, false);
  const stale = transactionFreshness(transactions, new Date("2026-09-13T12:00:00-07:00"));
  assert.equal(stale.stale, true);
  assert.match(stale.message, /not a complete current record/);
});
