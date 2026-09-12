import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  identityKey,
  parseOfficialRoster,
  reconcileRoster,
  refreshRoster,
  validateRosterRefresh,
} from "../src/lib/roster-refresh.mjs";
import { rosterFreshness } from "../src/lib/roster.mjs";
import { currentInjuryStatuses, latestPlayerUpdates } from "../src/lib/team-updates-core.mjs";
import { parseOfficialTransactions, reconcileTransactions } from "../src/lib/transaction-refresh.mjs";
import { parseOfficialInjuryReport, reconcileInjuryReports } from "../src/lib/injury-refresh.mjs";

const previous = {
  schemaVersion: 1,
  season: 2026,
  asOf: "2026-09-01T00:00:00.000Z",
  players: [
    { id: "kenny-mcintosh", name: "Kenny McIntosh", position: "RB", number: 25, status: "Active" },
    { id: "john-smith-jr", name: "John Smith Jr.", position: "WR", number: 10, status: "Active" },
    { id: "old-player", name: "Old Player", position: "T", number: 70, status: "Active" },
  ],
};

function source(players) {
  return JSON.stringify({ roster: { players } });
}

test("successful refresh normalizes practice squad and preserves stable IDs", () => {
  const fetched = parseOfficialRoster(source([
    { fullName: "Kenny McIntosh", position: "RB", jerseyNumber: "25", status: "Active" },
    { fullName: "John Smith, Jr.", position: "WR", jerseyNumber: 10, status: "Practice-Squad" },
  ]), "application/json");
  const next = reconcileRoster(previous, fetched, { now: new Date("2026-09-02T12:00:00Z") });
  assert.equal(next.asOf, "2026-09-02T12:00:00.000Z");
  assert.deepEqual(next.players.slice(0, 2).map(({ id, status }) => ({ id, status })), [
    { id: "kenny-mcintosh", status: "Active" },
    { id: "john-smith-jr", status: "Practice Squad" },
  ]);
  assert.equal(next.players.find((player) => player.id === "old-player").status, "Historical");
  assert.equal(identityKey("John Smith, Jr."), identityKey("John Smith Jr"));
});

test("grouped official payloads retain every supported roster section", () => {
  const fetched = parseOfficialRoster(JSON.stringify({ roster: {
    active: [{ name: "Active Player", position: "QB", number: 1 }],
    practiceSquad: [{ name: "Squad Player", position: "WR", number: 2, status: "practice squad" }],
    "reserve/injured": [{ name: "Reserve Player", position: "T", number: 3 }],
  } }), "application/json");
  assert.deepEqual(fetched.map((player) => player.status).sort(), ["Active", "Practice Squad", "Reserve/Injured"].sort());
});

test("server-rendered official roster tables are accepted when JSON is absent", () => {
  const html = `<div class="nfl-o-roster"><h4><span class="nfl-o-roster__title-status">Practice Squad</span></h4><table><tbody><tr><td><a href="/team/players-roster/bobby-hart/">Bobby Hart</a></td><td>68</td><td>T</td></tr></tbody></table></div>`;
  assert.deepEqual(parseOfficialRoster(html), [{ name: "Bobby Hart", position: "T", number: 68, status: "Practice Squad", sourceId: "bobby-hart" }]);
});

test("official transaction tables append dated practice-squad moves without overwriting history", () => {
  const html = `<div class="nfl-c-transactions-report"><table><thead><tr><th class="nfl-c-transactions-report__month">September</th></tr></thead><tbody><tr><td class="nfl-c-transactions-report__date">09/05</td><td><p>Released LB Marvin Jones Jr. from the practice squad. Signed S D'Anthony Bell to the practice squad.</p></td></tr></tbody></table></div>`;
  const fetched = parseOfficialTransactions(html, 2026);
  assert.deepEqual(fetched.map((row) => [row.playerId, row.newStatus]), [["marvin-jones-jr", "Released"], ["danthony-bell", "Practice Squad"]]);
  const prior = { schemaVersion: 1, records: [fetched[0]] };
  const next = reconcileTransactions(prior, fetched, { now: new Date("2026-09-06T00:00:00Z") });
  assert.equal(next.records.length, 2);
  assert.equal(next.asOf, "2026-09-06T00:00:00.000Z");
});

test("official injury tables preserve dates and distinguish participation from game status", () => {
  const html = `<table><caption>Table - Injury report</caption><thead><tr><th>Player</th><th>Position</th><th>Injury</th><th>Sun</th><th>Mon</th><th>Tue</th><th>Game Status</th></tr></thead><tbody><tr><td><a href="/team/players-roster/ty-okada/">Ty Okada</a></td><td>S</td><td>Hamstring</td><td>DNP</td><td>LP</td><td>FP</td><td>OUT</td></tr></tbody></table>`;
  const fetched = parseOfficialInjuryReport(html, { now: new Date("2026-09-08T20:00:00Z") });
  assert.deepEqual(fetched.map((row) => [row.date.slice(0, 10), row.reportType, row.status]), [["2026-09-06", "Practice Participation", "DNP"], ["2026-09-07", "Practice Participation", "Limited"], ["2026-09-08", "Practice Participation", "Full"], ["2026-09-08", "Game Status", "Out"]]);
  assert.equal(reconcileInjuryReports({ records: [fetched[0]] }, fetched, { now: new Date("2026-09-08T21:00:00Z") }).records.length, 4);
});

test("injury designations omit blank and dash placeholders while preserving official values", () => {
  const rows = ["", "-", "(-)", "(—)", "OUT", "QUESTIONABLE"].map((status, index) => `<tr><td><a href="/team/players-roster/player-${index}/">Player ${index}</a></td><td>S</td><td>Knee</td><td>LP</td><td>${status}</td></tr>`).join("");
  const html = `<table><caption>Table - Injury report</caption><thead><tr><th>Player</th><th>Position</th><th>Injury</th><th>Tue</th><th>Game Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  const fetched = parseOfficialInjuryReport(html, { now: new Date("2026-09-08T20:00:00Z") });
  assert.deepEqual(fetched.filter((row) => row.reportType === "Game Status").map((row) => row.status), ["Out", "Questionable"]);
});

test("injury reconciliation removes invalid stored designations and is idempotent per report", () => {
  const valid = { date:"2026-09-08T12:00:00Z", playerId:"player", playerName:"Player", reportType:"Game Status", status:"Out", sourceUrl:"https://www.{team}.com/team/injury-report/" };
  const stored = { records:[{ ...valid, status:"(-)" }, valid, { ...valid }] };
  const once = reconcileInjuryReports(stored, [valid]);
  const twice = reconcileInjuryReports(once, [valid]);
  assert.deepEqual(twice.records, [valid]);
  assert.equal(currentInjuryStatuses([{ ...valid, status:"(-)" }, valid, { ...valid }], [], { players:[] }).length, 1);
});

test("latest applicable player update is stable when record order is shuffled", () => {
  const practice = { date:"2026-09-07T12:00:00Z", playerId:"player", reportType:"Practice Participation", status:"Full" };
  const game = { date:"2026-09-08T12:00:00Z", playerId:"player", reportType:"Game Status", status:"Out" };
  const placeholder = { ...game, date:"2026-09-09T12:00:00Z", status:"(-)" };
  assert.equal(latestPlayerUpdates([practice, placeholder, game]).get("player"), game);
  assert.equal(latestPlayerUpdates([game, practice, placeholder]).get("player"), game);
});

test("newer canonical roster status suppresses an older conflicting transaction", () => {
  const practice = { timestamp:"2026-08-31T14:01:04-07:00", playerId:"aj-finley", transactionType:"Practice Squad", newStatus:"Practice Squad" };
  const roster = { asOf:"2026-09-09T18:00:00-07:00", players:[{ id:"aj-finley", name:"AJ Finley", status:"Active" }] };
  assert.equal(latestPlayerUpdates([practice], roster).has("aj-finley"), false);
  assert.equal(latestPlayerUpdates([practice], { ...roster, asOf:"2026-08-30T00:00:00Z" }).get("aj-finley"), practice);
});

test("plain and encoded apostrophes resolve to one roster identity", () => {
  assert.equal(identityKey("D'Anthony Bell"), identityKey("D&#39;Anthony Bell"));
  assert.equal(identityKey("D'Anthony Bell"), identityKey("D&#x27;Anthony Bell"));
  const html = `<div class="nfl-o-roster"><span class="nfl-o-roster__title-status">Practice Squad</span><table><tr><td><a href="/team/players-roster/d-anthony-bell/">D&#x27;Anthony Bell</a></td><td>23</td><td>S</td></tr></table></div>`;
  assert.equal(parseOfficialRoster(html)[0].name, "D'Anthony Bell");
});

test("refreshing an encoded roster name preserves the canonical ID and transaction join", () => {
  const prior = { players:[{ id:"danthony-bell", name:"D'Anthony Bell", position:"S", number:23, status:"Practice Squad", profile:"existing" }] };
  const fetched = parseOfficialRoster(source([{ name:"D&#x27;Anthony Bell", position:"S", number:23, status:"Practice Squad" }]), "application/json");
  const next = reconcileRoster(prior, fetched);
  const bell = next.players[0];
  const transaction = { playerId:"danthony-bell", timestamp:"2026-09-05T12:00:00Z", transactionType:"Practice Squad" };
  assert.deepEqual({ id:bell.id, name:bell.name, status:bell.status, profile:bell.profile }, { id:"danthony-bell", name:"D'Anthony Bell", status:"Practice Squad", profile:"existing" });
  assert.equal(latestPlayerUpdates([transaction]).get(bell.id), transaction);
});

test("unambiguous legacy x27 roster IDs migrate and remain redirect aliases", () => {
  const prior = { players:[{ id:"d-x27-anthony-bell", name:"D'Anthony Bell", position:"S", number:23, status:"Practice Squad" }] };
  const fetched = parseOfficialRoster(source([{ name:"D&#x27;Anthony Bell", position:"S", number:23, status:"Practice Squad" }]), "application/json");
  const bell = reconcileRoster(prior, fetched).players[0];
  assert.deepEqual({ id:bell.id, legacyIds:bell.legacyIds }, { id:"danthony-bell", legacyIds:["d-x27-anthony-bell"] });
  assert.equal(reconcileRoster(prior, fetched).players.length, 1);
});

test("duplicate source identities cannot create duplicate current players", () => {
  const fetched = parseOfficialRoster(source([
    { name: "John Smith Jr.", position: "WR", status: "Active" },
    { name: "John Smith, Jr", position: "WR", status: "Active" },
  ]), "application/json");
  assert.equal(fetched.length, 1);
  assert.equal(reconcileRoster(previous, fetched).players.filter((player) => player.status === "Active").length, 1);
});

test("empty, unknown-status, oversized, and dramatic refreshes are rejected", () => {
  assert.throws(() => parseOfficialRoster(source([]), "application/json"), /no recognizable player/);
  assert.throws(() => validateRosterRefresh({ players: [{ id: "x", status: "Mystery" }] }), /zero current players.*unknown statuses/);
  assert.throws(() => validateRosterRefresh({ players: [{ id: "x", status: "Active" }, { id: "x", status: "Practice Squad" }] }), /duplicate current IDs/);
  assert.throws(() => validateRosterRefresh({ players: Array.from({ length: 91 }, (_, id) => ({ id: String(id), status: "Active" })) }), /implausibly large/);
  const old = { players: Array.from({ length: 60 }, (_, id) => ({ id: String(id), status: "Active" })) };
  const next = { players: Array.from({ length: 30 }, (_, id) => ({ id: String(id), status: "Active" })) };
  assert.throws(() => validateRosterRefresh(next, old), /dramatic roster-count change/);
});

test("source failure preserves the previous artifact byte-for-byte", async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".roster-refresh-test-"));
  const file = path.join(directory, "roster.json");
  const original = `${JSON.stringify(previous, null, 2)}\n`;
  fs.writeFileSync(file, original);
  const warnings = [];
  try {
    const result = await refreshRoster({ file, fetchImpl: async () => { throw new Error("offline"); }, warn: (message) => warnings.push(message) });
    assert.equal(result.updated, false);
    assert.equal(fs.readFileSync(file, "utf8"), original);
    assert.match(warnings[0], /preserving last known valid artifact.*offline/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test("successful refresh writes valid data atomically", async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".roster-refresh-test-"));
  const file = path.join(directory, "roster.json");
  fs.writeFileSync(file, JSON.stringify(previous));
  try {
    const responseBody = source([
      { name: "Kenny McIntosh", position: "RB", number: 25, status: "active" },
      { name: "John Smith Jr", position: "WR", number: 10, status: "practice squad" },
    ]);
    const result = await refreshRoster({
      file,
      now: new Date("2026-09-02T12:00:00Z"),
      allowLargeChange: true,
      fetchImpl: async () => ({ ok: true, headers: { get: () => "application/json" }, text: async () => responseBody }),
      log: () => {},
    });
    assert.equal(result.updated, true);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).asOf, "2026-09-02T12:00:00.000Z");
    assert.deepEqual(fs.readdirSync(directory), ["roster.json"]);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test("freshness reports active-season staleness without invalidating the roster", () => {
  assert.equal(rosterFreshness(previous, new Date("2026-09-03T00:00:00Z")).stale, false);
  const stale = rosterFreshness(previous, new Date("2026-09-08T00:00:00Z"));
  assert.equal(stale.stale, true);
  assert.match(stale.message, /last known valid roster/);
  assert.equal(rosterFreshness({ ...previous, asOf: "invalid" }).stale, true);
});
