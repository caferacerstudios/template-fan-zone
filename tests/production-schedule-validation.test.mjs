import test from "node:test";
import assert from "node:assert/strict";
import { validateProductionOutputFile, validateProductionSchedule } from "../src/lib/production-schedule-validation.mjs";

const SEA = { abbreviation: "SEA", full_name: "Seattle {Team}" };
const NE = { abbreviation: "NE", full_name: "New England Patriots" };
const realGame = { id: "1392216", season: 2026, week: 1, season_type: "regular", date: "2026-09-10T00:20:00Z", home_team: SEA, visitor_team: NE };
const schedule = (game = realGame, extra = {}) => ({ fixture: false, season: 2026, games: [game], ...extra });

test("valid real-looking {Team} schedule passes production validation", () => {
  assert.equal(validateProductionSchedule(schedule()), true);
});

test("top-level fixture=true fails production validation", () => {
  assert.throws(() => validateProductionSchedule(schedule(realGame, { fixture: true })), /fixture=true/);
});

test("known fictional ID fails even when fixture=false", () => {
  assert.throws(() => validateProductionSchedule(schedule({ ...realGame, id: "fictional-game-home-001", fixture: false })), /fixture-like production game ID/);
});

test("fictional opponent fails even when the game ID looks real", () => {
  assert.throws(() => validateProductionSchedule(schedule({ ...realGame, visitor_team: { abbreviation: "SF", full_name: "Fictional San Francisco Football Club" } })), /fictional production team name/);
});

test("fixture games in phase-specific arrays are caught", () => {
  assert.throws(() => validateProductionSchedule({ fixture: false, season: 2026, gamesRegular: [{ ...realGame, fixture: true }] }), /explicitly marked/);
});

test("empty and malformed production schedules fail closed", () => {
  assert.throws(() => validateProductionSchedule({ season: 2026, games: [] }), /contains no games/);
  assert.throws(() => validateProductionSchedule(null), /must be a JSON object/);
});

test("generated public files containing either known leak fail validation", () => {
  assert.throws(() => validateProductionOutputFile("dist/index.html", "fictional-game-home-001"), /fictional-game-home-001/);
  assert.throws(() => validateProductionOutputFile("dist/sitemap.xml", "Fictional San Francisco Football Club"), /Fictional San Francisco Football Club/);
});

test("generic documentation and ticket-test fiction is outside schedule validation scope", () => {
  assert.equal(validateProductionOutputFile("docs/provider.md", "fictional-provider.example.invalid"), true);
  assert.equal(validateProductionSchedule(schedule()), true);
});
