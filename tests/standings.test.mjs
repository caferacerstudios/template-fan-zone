import test from "node:test";
import assert from "node:assert/strict";
import { activeStandingsPhase, aggregateStandings, buildPhasedStandings, formatWinningPercentage, reconcileStandings, validateStandings } from "../src/lib/standings.mjs";
import { formatKickoff, normalizeSchedule } from "../src/lib/schedule.mjs";

const teams = [
  { id: 1, abbreviation: "SEA", full_name: "Seattle {Team}", conference: "NFC" },
  { id: 2, abbreviation: "ARI", full_name: "Arizona Cardinals", conference: "NFC" },
  { id: 3, abbreviation: "LAR", full_name: "Los Angeles Rams", conference: "NFC" },
  { id: 4, abbreviation: "SF", full_name: "San Francisco 49ers", conference: "NFC" },
];
const game = (id, phase, date, home, away, extra = {}) => ({ id, season: 2026, week: 1, season_type: phase, date, status: "Scheduled", home_team: home, visitor_team: away, ...extra });

test("phase aggregation never mixes preseason, regular season, and postseason", () => {
  const games = [
    game("pre-1", "preseason", "2026-08-15", teams[1], teams[0], { status: "Final", home_team_score: 20, visitor_team_score: 10 }),
    game("pre-2", "preseason", "2026-08-22", teams[0], teams[2], { status: "Final", home_team_score: 13, visitor_team_score: 16 }),
    game("reg-1", "regular", "2026-09-13", teams[0], teams[3]),
    game("post-1", "postseason", "2027-01-17", teams[0], teams[1]),
  ];
  const payload = buildPhasedStandings({ season: 2026, updatedAt: "2026-08-23T12:00:00Z", games, teams });
  const preseason = payload.phases.preseason.rows.find((row) => row.abbreviation === "SEA");
  const regular = payload.phases.regular.rows.find((row) => row.abbreviation === "SEA");
  assert.deepEqual({ record: [preseason.wins, preseason.losses, preseason.ties], pf: preseason.pointsFor, pa: preseason.pointsAgainst, pct: preseason.percentage }, { record: [0, 2, 0], pf: 23, pa: 36, pct: ".000" });
  assert.equal(regular, undefined);
  assert.equal(preseason.rank, null, "an incomplete division sample must not receive a rank");
  assert.equal(activeStandingsPhase(games), "preseason");
  assert.equal(validateStandings(payload), true);
  assert.equal(reconcileStandings(payload, games), true);
});

test("missing team results are omitted rather than normalized to genuine 0-0 records", () => {
  const payload = buildPhasedStandings({ season: 2026, updatedAt: "2026-08-23T12:00:00Z", games: [
    game("sea-only", "preseason", "2026-08-15", teams[1], teams[0], { status: "Final", home_team_score: 20, visitor_team_score: 10 }),
  ], teams });
  assert.deepEqual(payload.phases.preseason.rows.map((row) => row.abbreviation).sort(), ["ARI", "SEA"]);
  assert.ok(payload.phases.preseason.rows.every((row) => row.gamesPlayed === 1 && row.rank === null));
  assert.equal(payload.phases.regular.rows.length, 0);
});

test("an explicitly sourced official 0-0 record remains distinguishable from a missing row", () => {
  const payload = buildPhasedStandings({ season: 2026, updatedAt: "2026-09-01T12:00:00Z", games: [], teams });
  payload.phases.regular = { phase: "regular", officialRank: false, recordAuthority: "official", rows: [{ abbreviation: "SEA", name: "Seattle {Team}", wins: 0, losses: 0, ties: 0, gamesPlayed: 0, percentage: ".000", pointsFor: 0, pointsAgainst: 0, differential: 0 }] };
  assert.equal(validateStandings(payload), true);
});

test("winning percentage includes ties and has NFL formatting", () => {
  assert.equal(formatWinningPercentage(0, 2, 0), ".000");
  assert.equal(formatWinningPercentage(0, 0, 1), ".500");
  assert.equal(formatWinningPercentage(1, 0, 0), "1.000");
});

test("validation detects record, percentage, differential, phase, and duplicate corruption", () => {
  const games = [game("one", "regular", "2026-09-13", teams[0], teams[1], { status: "Final", home_team_score: 20, visitor_team_score: 10 })];
  const payload = buildPhasedStandings({ season: 2026, updatedAt: "2026-09-14T00:00:00Z", games, teams });
  const broken = structuredClone(payload);
  const sea = broken.phases.regular.rows.find((row) => row.abbreviation === "SEA");
  sea.wins = 0; sea.percentage = ".500"; sea.differential = 4;
  assert.throws(() => validateStandings(broken), /percentage mismatch|point differential mismatch/);
  assert.throws(() => reconcileStandings(broken, games), /record does not match/);
  assert.throws(() => buildPhasedStandings({ season: 2026, updatedAt: "", games: [{ ...games[0], season_type: "mystery" }], teams }), /invalid or missing season type/i);
  assert.throws(() => reconcileStandings(payload, [...games, games[0]]), /duplicate game/);
});

test("Seattle-only schedules reconcile Seattle without rejecting valid division records", () => {
  const phases = {
    preseason: [
      game("sea-pre", "preseason", "2026-08-15", teams[0], teams[1], { status: "Final", home_team_score: 20, visitor_team_score: 10 }),
      game("lar-pre", "preseason", "2026-08-16", teams[2], teams[3], { status: "Final", home_team_score: 24, visitor_team_score: 17 }),
    ],
    regular: [
      game("sea-reg", "regular", "2026-09-13", teams[1], teams[0], { status: "Final", home_team_score: 14, visitor_team_score: 21 }),
      game("sf-reg", "regular", "2026-09-14", teams[3], teams[2], { status: "Final", home_team_score: 27, visitor_team_score: 20 }),
    ],
  };
  const leagueGames = [...phases.preseason, ...phases.regular];
  const seattleGames = leagueGames.filter((item) => [item.home_team.abbreviation, item.visitor_team.abbreviation].includes("SEA"));
  const payload = buildPhasedStandings({ season: 2026, updatedAt: "2026-09-15T00:00:00Z", games: leagueGames, teams });

  assert.equal(validateStandings(payload), true);
  assert.equal(reconcileStandings(payload, seattleGames, ["SEA"]), true);

  for (const phase of ["preseason", "regular"]) {
    const broken = structuredClone(payload);
    const sea = broken.phases[phase].rows.find((row) => row.abbreviation === "SEA");
    sea.wins -= 1;
    sea.losses += 1;
    sea.percentage = formatWinningPercentage(sea.wins, sea.losses, sea.ties);
    assert.equal(validateStandings(broken), true);
    assert.throws(() => reconcileStandings(broken, seattleGames, ["SEA"]), new RegExp(`${phase} SEA record does not match`));
  }
});

test("date-only kickoffs preserve the Pacific calendar day and supplied kickoff time", () => {
  const cases = [
    ["2026-03-08", "1:25 PM", "Sunday, March 8, 2026 · 1:25 PM PT"],
    ["2026-09-20", "1:25 PM", "Sunday, September 20, 2026 · 1:25 PM PT"],
    ["2026-11-01", "1:25 PM", "Sunday, November 1, 2026 · 1:25 PM PT"],
    ["2027-01-10", "5:20 PM", "Sunday, January 10, 2027 · 5:20 PM PT"],
  ];
  for (const [date, status, expected] of cases) {
    const normalized = normalizeSchedule({ season: 2026, games: [game(date, "regular", date, teams[0], teams[1], { status })] }).games[0];
    assert.equal(formatKickoff(normalized), expected);
    assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(normalized.startsAt)), date);
  }
});

test("UTC timestamps render in PDT and PST without changing their source instant", () => {
  const summer = normalizeSchedule({ season: 2026, games: [game("pdt", "regular", "2026-09-20T20:25:00Z", teams[0], teams[1])] }).games[0];
  const winter = normalizeSchedule({ season: 2026, games: [game("pst", "postseason", "2027-01-10T21:25:00Z", teams[0], teams[1])] }).games[0];
  assert.match(formatKickoff(summer), /September 20, 2026 · 1:25 PM PT$/);
  assert.match(formatKickoff(winter), /January 10, 2027 · 1:25 PM PT$/);
});
