import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bindCoverageToSchedule } from "./eventspy-schedule.mjs";

const fixtureUrl = new URL("./fixtures/seattle-2026-recorded-identity.json", import.meta.url);
const fixtureBytes = await readFile(fixtureUrl);
const recorded = JSON.parse(fixtureBytes);
const site = { slug: "seahawks", city: "Seattle", name: "Seahawks", abbreviation: "SEA" };
const coverage = JSON.parse(await readFile(new URL("../config/eventspy/seahawks.json", import.meta.url)));
const recordedIds = [
  "1392216", "1392244", "1392256", "1392277", "1392292", "1392295",
  "1392321", "1392336", "1392349", "1392361", "1392392", "1392408",
  "1392421", "1392425", "1392443", "1392467", "1392478",
];

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test("recorded Seattle snapshot binds all 17 actual game IDs, ignores the bye, and preserves input", async () => {
  const schedule = freeze(structuredClone(recorded));
  const rows = freeze(structuredClone(coverage));
  const beforeSchedule = JSON.stringify(schedule), beforeRows = JSON.stringify(rows);
  assert.equal(schedule.gamesRegular.length, 18);
  assert.equal(schedule.gamesRegular.filter(game => game.bye === true).length, 1);
  assert.equal(schedule.gamesRegular.find(game => game.week === 3).homeTeam.abbreviation, "WSH");
  assert.equal(rows.find(row => row.week === 3).homeTeamAbbreviation, "WAS");
  const bindings = bindCoverageToSchedule(site, rows, schedule);
  assert.equal(bindings.length, 17);
  assert.deepEqual(bindings.map(binding => binding.reason), Array(17).fill(null));
  assert.deepEqual(bindings.map(binding => binding.row.gameId), recordedIds);
  assert.deepEqual(bindings.map(binding => String(binding.game.id)), recordedIds);
  assert.equal(JSON.stringify(schedule), beforeSchedule);
  assert.equal(JSON.stringify(rows), beforeRows);
  assert.deepEqual(await readFile(fixtureUrl), fixtureBytes);
});

test("Washington aliases bind in either coverage/schedule direction without changing abbreviations", () => {
  for (const [expected, actual] of [["WAS", "WSH"], ["WSH", "WAS"]]) {
    const row = structuredClone(coverage.find(entry => entry.week === 3));
    row.homeTeamAbbreviation = expected;
    row.opponentAbbreviation = expected;
    const game = structuredClone(recorded.gamesRegular.find(entry => entry.week === 3));
    game.homeTeam.abbreviation = actual;
    game.home_team.abbreviation = actual;
    const schedule = { ...recorded, gamesRegular: [game] };
    const binding = bindCoverageToSchedule(site, freeze([row]), freeze(schedule))[0];
    assert.equal(binding.reason, null, `${expected} coverage / ${actual} schedule`);
    assert.equal(binding.row.gameId, "1392256");
    assert.equal(binding.row.homeTeamAbbreviation, expected);
    assert.equal(binding.game.homeTeam.abbreviation, actual);
  }
});

test("Washington alias acceptance still rejects wrong game ID, week, season, and teams", () => {
  const changes = [
    game => { game.id = "1392257"; },
    game => { game.week = 4; },
    game => { game.season = 2025; },
    game => { game.homeTeam.abbreviation = "DEN"; game.home_team.abbreviation = "DEN"; },
    game => { game.awayTeam.abbreviation = "DEN"; game.visitor_team.abbreviation = "DEN"; },
  ];
  for (const change of changes) {
    const schedule = structuredClone(recorded);
    change(schedule.gamesRegular.find(game => game.week === 3));
    const bindings = bindCoverageToSchedule(site, coverage, schedule);
    assert.equal(bindings.filter(binding => binding.reason === null).length, 16);
    assert.equal(bindings.find(binding => binding.row.week === 3).reason, "SCHEDULE_GAME_MISSING");
    assert.equal(bindings.find(binding => binding.row.week === 3).game, null);
  }
});
