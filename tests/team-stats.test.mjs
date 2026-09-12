import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamStats } from "../src/lib/team-stats.mjs";

const SEA = { id: 1, abbreviation: "SEA" };
const SF = { id: 2, abbreviation: "SF" };
const final = (id, extra = {}) => ({ id, season: 2026, season_type: "regular", status: "Final", home_team: SEA, visitor_team: SF, home_team_score: 24, visitor_team_score: 17, ...extra });
const payload = (extra = {}) => ({ season: 2026, team: SEA, gamesRegular: [final("one")], playerSeasonStats: [], ...extra });

test("derives record and points only from direct final-score fields", () => {
  const result = buildTeamStats(payload({ gamesRegular: [final("one"), { ...final("future"), status: "Scheduled", scores: { homeScore: 99, awayScore: 0 } }] }));
  assert.deepEqual({ games: result.gamesPlayed, record: result.record, scored: result.pointsScored, allowed: result.pointsAllowed }, { games: 1, record: "1-0", scored: 24, allowed: 17 });
});

test("duplicate player rows and mixed team or season rows cannot contaminate team totals", () => {
  const playerSeasonStats = [
    { player_id: 7, team_id: 1, season: 2026, passing_yards: 1000 },
    { player_id: 7, team_id: 1, season: 2026, passing_yards: 1000 },
    { player_id: 8, team_id: 2, season: 2026, rushing_yards: 900 },
    { player_id: 9, team_id: 1, season: 2025, rushing_yards: 800 },
  ];
  assert.equal(buildTeamStats(payload({ playerSeasonStats })).teamTotals, null);
});

test("accepts only an explicit {Team} regular-season total matching season and games", () => {
  const teamSeasonStats = { team_id: 1, team_abbreviation: "SEA", season: 2026, season_type: "regular", games_played: 1, passing_yards: 250, rushing_yards: 125, total_offensive_yards: 375 };
  assert.deepEqual(buildTeamStats(payload({ teamSeasonStats })).teamTotals, { gamesPlayed: 1, passingYards: 250, rushingYards: 125, totalOffensiveYards: 375 });
  assert.equal(buildTeamStats(payload({ teamSeasonStats: { ...teamSeasonStats, season: 2025 } })).teamTotals, null);
  assert.equal(buildTeamStats(payload({ teamSeasonStats: { ...teamSeasonStats, team_id: 2, team_abbreviation: "SF" } })).teamTotals, null);
  assert.equal(buildTeamStats(payload({ teamSeasonStats: { ...teamSeasonStats, games_played: 2 } })).teamTotals, null);
  assert.equal(buildTeamStats(payload({ teamSeasonStats: { ...teamSeasonStats, total_offensive_yards: 999 } })).teamTotals.totalOffensiveYards, null);
});

test("duplicate game representations are counted once", () => {
  const result = buildTeamStats(payload({ gamesRegular: [final("one"), { ...final("one") }] }));
  assert.equal(result.gamesPlayed, 1);
  assert.equal(result.pointsScored, 24);
});

test("mixed-season and non-regular games cannot contaminate scoring", () => {
  const result = buildTeamStats(payload({ gamesRegular: [final("one"), final("old", { season: 2025 }), final("post", { season_type: "postseason" })] }));
  assert.equal(result.gamesPlayed, 1);
  assert.equal(result.pointsScored, 24);
});

test("canonical schedule phase and state produce the reviewed opener result without offense totals", () => {
  const opener = {
    id: 1392216, season: 2026, phase: "regular", state: "completed",
    homeTeam: { id: 2, abbreviation: "NE" }, awayTeam: SEA,
    home_team_score: 10, visitor_team_score: 13,
  };
  const result = buildTeamStats({ season: 2026, team: SEA, games: [opener] });
  assert.deepEqual(result, { season: 2026, gamesPlayed: 1, record: "1-0", pointsScored: 13, pointsAllowed: 10, pointsPerGame: 13, teamTotals: null });
});

test("conflicting duplicates are rejected and wrong-season canonical games stay excluded", () => {
  const base = { id: "same", season: 2026, phase: "regular", state: "completed", homeTeam: SEA, awayTeam: SF, home_team_score: 20, visitor_team_score: 10 };
  const result = buildTeamStats({ season: 2026, team: SEA, games: [base, {...base, home_team_score: 21}, {...base, id:"old", season:2025}] });
  assert.deepEqual({ games:result.gamesPlayed, record:result.record, scored:result.pointsScored, allowed:result.pointsAllowed }, { games:0, record:null, scored:null, allowed:null });
});
