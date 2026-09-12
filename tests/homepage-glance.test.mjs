import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildHomepageGlance } from "../src/lib/homepage-glance.mjs";
import { currentRosterPlayers, rosterCount } from "../src/lib/roster.mjs";

const roster=JSON.parse(await readFile(new URL("../src/data/team/roster.json",import.meta.url),"utf8"));

const SEA = { abbreviation: "SEA", full_name: "Seattle {Team}" };
const SF = { abbreviation: "SF", full_name: "San Francisco 49ers" };
const LAR = { abbreviation: "LAR", full_name: "Los Angeles Rams" };
const game = (id, phase, date, extra = {}) => ({ id, season: 2026, week: 1, season_type: phase, date, status: "Scheduled", home_team: SEA, visitor_team: SF, ...extra });
const final = (id, phase, date, sea = 24, other = 17, extra = {}) => {
  const fixture = game(id, phase, date, { status: "Final", ...extra });
  const {team}AreHome = fixture.home_team.abbreviation === SEA.abbreviation;
  return { ...fixture, home_team_score: {team}AreHome ? sea : other, visitor_team_score: {team}AreHome ? other : sea };
};
const leaders = [
  { player_id: 1, player: { id: 1, first_name: "Pass", last_name: "Leader" }, passing_yards: 1000 },
  { player_id: 2, player: { id: 2, first_name: "Rush", last_name: "Leader" }, rushing_yards: 500 },
  { player_id: 3, player: { id: 3, first_name: "Catch", last_name: "Leader" }, receiving_yards: 600 },
];
const payload = (games, extra = {}) => ({ season: 2026, sourceSeason: 2026, updatedAt: "2026-08-28T12:00:00Z", games, ...extra });
const standings = { season: 2026, data: [{ team: SEA, division_rank: 2 }] };

test("preseason record is explicit and never produces an NFC West rank", () => {
  const model = buildHomepageGlance({ nfl: payload([
    final("pre-final", "preseason", "2026-08-20T17:00:00-07:00", 24, 17, { week: 1 }),
    game("pre-next", "preseason", "2026-08-30T17:00:00-07:00", { week: 2 }),
    game("opener", "regular", "2026-09-13T17:00:00-07:00", { week: 1 }),
  ]), standings, now: new Date("2026-08-28T12:00:00-07:00") });
  assert.deepEqual({ label: model.seasonStatus.label, record: model.seasonStatus.record, rank: model.seasonStatus.rank }, { label: "Preseason", record: "1-0", rank: null });
  assert.equal(model.lastResult.phase, "Preseason");
});

test("first regular-season week shows the opener state instead of a zero record", () => {
  const model = buildHomepageGlance({ nfl: payload([game("opener", "regular", "2026-09-13T17:00:00-07:00")]), standings, now: new Date("2026-09-13T12:00:00-07:00") });
  assert.equal(model.seasonStatus.label, "Regular Season");
  assert.equal(model.seasonStatus.record, null);
  assert.match(model.seasonStatus.detail, /^Regular season begins/);
  assert.equal(model.seasonStatus.rank, null);
});

test("midseason exposes regular standings and current-season leaders", () => {
  const model = buildHomepageGlance({ nfl: payload([
    final("week-1", "regular", "2026-09-13T17:00:00-07:00", 24, 17, { week: 1 }),
    final("week-2", "regular", "2026-09-20T17:00:00-07:00", 14, 21, { week: 2, home_team: LAR, visitor_team: SEA }),
  ], { playerStatsSeason: 2026, playerSeasonStats: leaders }), standings, now: new Date("2026-10-01T12:00:00-07:00") });
  assert.equal(model.seasonStatus.record, "1-1");
  assert.equal(model.seasonStatus.rank, "2nd");
  assert.equal(model.leaders.label, "2026 leaders");
});

test("lagging leader totals are labeled with their actual prior season", () => {
  const model = buildHomepageGlance({ nfl: payload([game("opener", "regular", "2026-09-13T17:00:00-07:00")], { playerStatsSeason: 2025, playerSeasonStats: leaders }), now: new Date("2026-08-01T12:00:00-07:00") });
  assert.equal(model.leaders.label, "2025 leaders");
});

test("live postseason and completed postseason use postseason records", () => {
  const live = game("wild-card", "postseason", "2027-01-10T17:00:00-08:00", { status: "In Progress" });
  const model = buildHomepageGlance({ nfl: payload([final("regular", "regular", "2026-09-13T17:00:00-07:00"), live]), now: new Date("2027-01-10T18:00:00-08:00") });
  assert.equal(model.seasonStatus.label, "Postseason");
  assert.equal(model.seasonStatus.record, null);
  live.status = "Final"; live.home_team_score = 27; live.visitor_team_score = 20;
  const complete = buildHomepageGlance({ nfl: payload([final("regular", "regular", "2026-09-13T17:00:00-07:00"), live]), now: new Date("2027-02-01T12:00:00-08:00") });
  assert.equal(complete.seasonStatus.record, "1-0");
});

test("unsupported cards and metrics are omitted without fake zeroes", () => {
  const missing = buildHomepageGlance({ nfl: payload([game("opener", "regular", "2026-09-13T17:00:00-07:00")]), standings: null, transactions: [], injuries: [], now: new Date("2026-08-01T12:00:00-07:00") });
  assert.equal(missing.seasonStatus.rank, null);
  assert.equal(missing.leaders, null);
  assert.equal(missing.rosterPulse, null);
  assert.equal(missing.lastResult, null);
  assert.equal(missing.seasonStatus.record, null);
});

test("roster pulse distinguishes unavailable injury data from sourced entries", () => {
  const nfl = payload([game("opener", "regular", "2026-09-13T17:00:00-07:00")], { currentRoster: [{ id: 1 }, { id: 2 }] });
  const empty = buildHomepageGlance({ nfl, transactions: [], injuries: [], now: new Date("2026-08-01T12:00:00-07:00") });
  assert.equal(empty.rosterPulse.count, 2);
  assert.equal(empty.rosterPulse.injuryCount, null);
  assert.equal(empty.rosterPulse.latestTransaction, null);
  const sourced = buildHomepageGlance({ nfl, transactions: [{ timestamp: "2026-07-01", transactionType: "Signed", playerName: "A Player" }], injuries: [{}, {}], now: new Date("2026-08-01T12:00:00-07:00") });
  assert.equal(sourced.rosterPulse.injuryCount, 2);
  assert.equal(sourced.rosterPulse.latestTransaction.action, "Signed");
});

test("homepage current-player total uses the same active-roster definition as the roster page", () => {
  const model=buildHomepageGlance({nfl:payload([game("opener","regular","2026-09-13T17:00:00-07:00")],{currentRoster:currentRosterPlayers(roster)}),now:new Date("2026-08-01T12:00:00-07:00")});
  assert.equal(model.rosterPulse.count,rosterCount(roster));
});
