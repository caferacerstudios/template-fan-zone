import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatScheduleDate,
  formatKickoff,
  formatPacificCalendarDate,
  featuredScheduleEvent,
  nextScheduleEvent,
  normalizeSchedule,
  selectScheduleSeason,
  selectFeaturedGame,
  validateSchedule,
} from "../src/lib/schedule.mjs";
import { groupScheduleMonths, normalizeScheduleFilters, scheduleGameMatches, scheduleRow } from "../src/lib/schedule-display.mjs";
import { gameCalendar, gameDayView, seasonCalendar } from "../src/lib/game-day.mjs";
import { reconcileOfficialSchedule } from "../src/lib/schedule-guide.mjs";

const SEA = { abbreviation: "SEA", full_name: "Seattle {Team}" };
const SF = { abbreviation: "SF", full_name: "San Francisco 49ers" };
const game = (id, week, date, extra = {}) => ({ id, season: 2026, week, date, status: "Scheduled", season_type: "regular", home_team: SEA, visitor_team: SF, ...extra });

test("normalizes preseason and selects it as the next same-day event", () => {
  const schedule = normalizeSchedule({ season: 2026, games: [
    game("pre-1", 1, "2026-08-28T19:00:00Z", { season_type: "Preseason" }),
    game("reg-1", 1, "2026-09-13T20:00:00Z", { season_type: "Regular Season" }),
  ] });
  assert.equal(schedule.gamesPreseason.length, 1);
  assert.equal(nextScheduleEvent(schedule.games, new Date("2026-08-28T12:00:00Z")).id, "pre-1");
});

test("classifies provider games when postseason is the only season-type field", () => {
  const schedule = normalizeSchedule({ season: 2026, games: [
    game("provider-pre", 3, "2026-08-28T19:00:00Z", { season_type: undefined, postseason: false }),
    game("provider-regular", 1, "2026-09-13T20:00:00Z", { season_type: undefined, postseason: false }),
    game("provider-post", 1, "2027-01-17T20:00:00Z", { season_type: undefined, postseason: true }),
  ] });
  assert.deepEqual(schedule.games.map(({ id, phase }) => [id, phase]), [
    ["provider-pre", "preseason"],
    ["provider-regular", "regular"],
    ["provider-post", "postseason"],
  ]);
});

test("represents the missing week in a 17-game slate as a bye", () => {
  const games = Array.from({ length: 18 }, (_, index) => index + 1)
    .filter((week) => week !== 11)
    .map((week) => game(`reg-${week}`, week, `2026-${week < 5 ? "09" : week < 9 ? "10" : week < 14 ? "11" : "12"}-${String((week % 27) + 1).padStart(2, "0")}T20:00:00Z`, { season_type: "regular" }));
  const schedule = normalizeSchedule({ season: 2026, games });
  const bye = schedule.gamesRegular.find((entry) => entry.state === "bye");
  assert.deepEqual({ week: bye.week, state: bye.state, phase: bye.phase }, { week: 11, state: "bye", phase: "regular" });
});

test("does not manufacture a Week 18 kickoff time from midnight", () => {
  const schedule = normalizeSchedule({ season: 2026, games: [game("week-18", 18, "2027-01-10T00:00:00Z")] });
  const week18 = schedule.games[0];
  assert.equal(week18.timeConfirmed, false);
  assert.match(formatScheduleDate(week18), /Time TBD$/);
});

test("accepts a confirmed Pacific kickoff that falls at midnight UTC", () => {
  const schedule = normalizeSchedule({ season: 2026, games: [game("pacific-five", 1, "2026-08-15", {
    season_type: "preseason",
    kickoff_time: "5:00 p.m. PDT",
    time_confirmed: true,
  })] });
  assert.equal(schedule.games[0].startsAt, "2026-08-16T00:00:00.000Z");
  assert.equal(validateSchedule(schedule), true);
});

test("official guide reconciliation restores missing preseason finals without duplicating provider games", () => {
  const guide = { season: 2026, games: [{ phase: "preseason", week: 1, dateLabel: "Aug. 15, 2026", matchup: "Dallas Cowboys at Seattle {Team}", result: "Cowboys 17, {Team} 7", status: "completed" }] };
  const provider = [game("reg-1", 1, "2026-09-13T20:00:00Z")];
  const schedule = normalizeSchedule({ season: 2026, games: reconcileOfficialSchedule(provider, guide) });
  assert.equal(schedule.gamesPreseason.length, 1);
  assert.deepEqual({ state: schedule.gamesPreseason[0].state, away: schedule.gamesPreseason[0].visitor_team_score, home: schedule.gamesPreseason[0].home_team_score }, { state: "completed", away: 17, home: 7 });
  assert.equal(schedule.gamesPreseason[0].{team}RecordAfter, undefined);
  assert.equal(schedule.gamesRegular.length, 1);
  assert.deepEqual(reconcileOfficialSchedule(provider, guide)[0], provider[0]);
  assert.equal(reconcileOfficialSchedule([...provider, schedule.gamesPreseason[0]], guide).length, 2);
});

test("official guide restores missing kickoff and venue on completed provider games", () => {
  const guide = { season: 2026, games: [{ phase: "preseason", week: 1, dateLabel: "Aug. 15, 2026", kickoffLabel: "5:00 p.m. PDT", matchup: "Dallas Cowboys at Seattle {Team}", venue: "Lumen Field", result: "Cowboys 17, {Team} 7", status: "completed" }] };
  const provider = [{ ...game("pre-1", 1, "2026-08-15", { season_type: "preseason", status: "Final", home_team: SEA, visitor_team: { abbreviation: "DAL", full_name: "Dallas Cowboys" }, home_team_score: 7, visitor_team_score: 17 }), time_confirmed: false, venue: null }];
  const restored = normalizeSchedule({ season: 2026, games: reconcileOfficialSchedule(provider, guide) }).games[0];
  assert.equal(restored.venue, "Lumen Field");
  assert.equal(restored.timeConfirmed, true);
  assert.match(formatKickoff(restored), /5:00 PM PT$/);
});

test("shifted provider preseason weeks reconcile by game identity without duplication", () => {
  const provider = JSON.parse(readFileSync(new URL("fixtures/shifted-preseason-provider.json", import.meta.url), "utf8"));
  const guide = JSON.parse(readFileSync(new URL("../src/data/nfl/watch-guide-2026.json", import.meta.url), "utf8"));
  const schedule = normalizeSchedule({ season: 2026, games: reconcileOfficialSchedule(provider, guide) });
  assert.equal(schedule.gamesPreseason.length, 3);
  assert.deepEqual(schedule.gamesPreseason.map((row) => [row.id, row.week, row.opponent.abbreviation, row.date, row.timeConfirmed]), [
    ["provider-dallas", 1, "DAL", "2026-08-15", true],
    ["provider-tennessee", 2, "TEN", "2026-08-23", true],
    ["provider-kansas-city", 3, "KC", "2026-08-28", true],
  ]);
  assert.deepEqual(schedule.gamesPreseason.map((row) => [row.visitor_team_score, row.home_team_score]), [[17, 7], [16, 19], [9, 9]]);
});

test("Pacific local parsing accepts dotted and plain meridiems with ordinary variations", () => {
  for (const [kickoff_time, expected] of [
    ["5:20 p.m. PDT", "5:20 PM PT"],
    ["10:00 A.M. PT", "10:00 AM PT"],
    [" 5:15 pm pst ", "5:15 PM PT"],
    ["5:00\tP. M. pdt", "5:00 PM PT"],
  ]) {
    const normalized = normalizeSchedule({ season: 2026, games: [game(kickoff_time, 1, "2026-09-09", { kickoff_time })] }).games[0];
    assert.equal(formatKickoff(normalized, "time"), expected, kickoff_time);
    assert.equal(normalized.timeConfirmed, true, kickoff_time);
  }
});

test("checked-in guide reconciles into stable displayed kickoffs and preseason finals", () => {
  const source = JSON.parse(readFileSync(new URL("../src/data/nfl/{team}.json", import.meta.url), "utf8"));
  const guide = JSON.parse(readFileSync(new URL("../src/data/nfl/watch-guide-2026.json", import.meta.url), "utf8"));
  const once = reconcileOfficialSchedule(source.games, guide);
  const twice = reconcileOfficialSchedule(once, guide);
  assert.deepEqual(twice, once);

  const schedule = normalizeSchedule({ ...source, games: twice });
  const regularGames = schedule.gamesRegular.filter((game) => game.state !== "bye");
  assert.equal(regularGames.length, 17);
  assert.equal(regularGames.filter((game) => game.timeConfirmed).length, 16);
  assert.equal(schedule.gamesRegular.filter((game) => game.state === "bye").length, 1);
  assert.equal(schedule.gamesPreseason.length, 3);

  const expectedRegular = new Map([
    [1, ["Sep 9", "5:20 PM PT", "New England Patriots"]],
    [2, ["Sep 20", "1:25 PM PT", "Arizona Cardinals"]],
    [3, ["Sep 27", "10:00 AM PT", "Washington Commanders"]],
    [8, ["Nov 2", "5:15 PM PT", "Chicago Bears"]],
    [17, ["Jan 3", "10:00 AM PT", "Carolina Panthers"]],
  ]);
  for (const [week, [date, kickoff, opponent]] of expectedRegular) {
    const row = scheduleRow(schedule.gamesRegular.find((game) => game.week === week));
    assert.match(row.date, new RegExp(date));
    assert.equal(row.kickoff, kickoff);
    assert.equal(row.opponentName, opponent);
  }
  const week18 = schedule.gamesRegular.find((game) => game.week === 18);
  assert.deepEqual({ date: week18.date, startsAt: week18.startsAt, time: scheduleRow(week18).kickoff }, { date: null, startsAt: null, time: "Time TBD" });

  const expectedPreseason = [
    [1, "2026-08-15", true, "Lumen Field", 17, 7, "L", "5:00 PM PT"],
    [2, "2026-08-23", false, "Nissan Stadium", 16, 19, "L", "5:00 PM PT"],
    [3, "2026-08-28", false, "GEHA Field at Arrowhead Stadium", 9, 9, "T", "5:00 PM PT"],
  ];
  for (const [week, date, isHome, venue, away, home, outcome, kickoff] of expectedPreseason) {
    const game = schedule.gamesPreseason.find((item) => item.week === week);
    const row = scheduleRow(game);
    assert.deepEqual(
      { id: game.id, date: game.date, isHome: game.isHome, venue: game.venue, state: game.state, away: game.visitor_team_score, home: game.home_team_score, outcome: row.result.outcome, kickoff: row.kickoff },
      { id: `2026-preseason-${week}`, date, isHome, venue, state: "completed", away, home, outcome, kickoff },
    );
  }
  const calendar = seasonCalendar(schedule, "https://{team}fanzone.com");
  assert.equal(calendar.eventCount, 19);
  assert.match(calendar.content, /DTSTART:20261103T011500Z/);
  assert.match(calendar.content, /DTSTART:20260816T000000Z/);
});

test("reconciliation preserves usable ISO kickoffs and rejects invalid guide clocks", () => {
  const valid = game("provider-id", 1, "2026-09-10T00:20:00Z");
  const validGuide = { season: 2026, games: [{ phase: "regular", week: 1, dateLabel: "Sep. 9", kickoffLabel: "7:45 p.m. PDT", matchup: "New England Patriots at Seattle {Team}" }] };
  assert.equal(reconcileOfficialSchedule([valid], validGuide)[0].date, valid.date);

  const placeholder = { ...valid, date: "2026-09-09T00:00:00Z" };
  const replaced = normalizeSchedule({ season: 2026, games: reconcileOfficialSchedule([placeholder], validGuide) }).games[0];
  assert.equal(replaced.id, "provider-id");
  assert.equal(formatKickoff(replaced, "time"), "7:45 PM PT");

  for (const kickoffLabel of ["0:30 p.m. PT", "13:00 PM PST", "5:60 p.m. PDT", "Time TBD"]) {
    const unknown = { ...valid, date: "2026-09-09", time_confirmed: false };
    const guide = { season: 2026, games: [{ ...validGuide.games[0], kickoffLabel }] };
    const normalized = normalizeSchedule({ season: 2026, games: reconcileOfficialSchedule([unknown], guide) }).games[0];
    assert.equal(normalized.startsAt, null, kickoffLabel);
    assert.equal(normalized.timeConfirmed, false, kickoffLabel);
  }
});

test("official Week 18 TBD suppresses a provider placeholder across public timing outputs", () => {
  const provider = [game("week-18", 18, "2027-01-10T05:00:00Z")];
  const guide = { season: 2026, games: [{ phase: "regular", week: 18, status: "tbd", dateLabel: "Jan. 9 or 10, 2027" }] };
  const schedule = normalizeSchedule({ season: 2026, games: reconcileOfficialSchedule(provider, guide) });
  const week18 = schedule.gamesRegular[0];
  assert.deepEqual({ date: week18.date, startsAt: week18.startsAt, dateConfirmed: week18.dateConfirmed, timeConfirmed: week18.timeConfirmed }, { date: null, startsAt: null, dateConfirmed: false, timeConfirmed: false });
  assert.equal(formatKickoff(week18, "date"), "Date TBD");
  assert.equal(formatKickoff(week18, "time"), "Time TBD");
  assert.equal(gameCalendar(week18, "https://{team}.example").enabled, false);
  assert.doesNotMatch(seasonCalendar(schedule, "https://{team}.example").content, /week-18/);
  assert.throws(() => validateSchedule({ ...schedule, games: [{ ...week18, date: "2027-01-09", dateConfirmed: true }] }), /official TBD game exposes/);
  const confirmed = reconcileOfficialSchedule([{ ...provider[0], date_confirmed: true, time_confirmed: true }], guide)[0];
  assert.equal(confirmed.date, provider[0].date);
});

test("chooses the earliest unfinished game after completed games", () => {
  const schedule = normalizeSchedule({ season: 2026, games: [
    game("final", 1, "2026-09-01T20:00:00Z", { status: "Final" }),
    game("next", 2, "2026-09-08T20:00:00Z"),
    game("later", 3, "2026-09-15T20:00:00Z"),
  ] });
  assert.equal(nextScheduleEvent(schedule.games, new Date("2026-09-02T00:00:00Z")).id, "next");
});

test("keeps an undetermined postseason opponent and fields explicit", () => {
  const schedule = normalizeSchedule({ season: 2026, games: [{
    id: "wild-card", season: 2026, week: 1, season_type: "postseason", status: "TBD",
    home_team: SEA, visitor_team: null, date_tbd: true, time_tbd: true,
    venue_confirmed: false, network_confirmed: false, opponent_confirmed: false,
  }] });
  const playoff = schedule.gamesPostseason[0];
  assert.equal(playoff.state, "tbd");
  assert.equal(playoff.opponent, null);
  assert.equal(playoff.opponentConfirmed, false);
  assert.equal(playoff.date, null);
  assert.equal(playoff.venue, null);
  assert.equal(playoff.network, null);
});

test("switches between complete season records without mixing them", () => {
  const data = { season: 2026, seasons: [
    { season: 2025, games: [{ ...game("2025-1", 1, "2025-09-07T20:00:00Z"), season: 2025 }] },
    { season: 2026, games: [game("2026-1", 1, "2026-09-13T20:00:00Z")] },
  ] };
  assert.equal(selectScheduleSeason(data, 2025).games[0].season, 2025);
  assert.equal(selectScheduleSeason(data, 2026).games[0].season, 2026);
});

test("publishing validation rejects duplicate IDs, season mismatch, and supplied missing byes", () => {
  const valid = normalizeSchedule({ season: 2026, games: [game("one", 1, "2026-09-13T20:00:00Z")] });
  assert.equal(validateSchedule(valid, 2026), true);
  assert.throws(() => validateSchedule({ ...valid, sourceSeason: 2025 }, 2026), /season mismatch/);
  assert.throws(() => validateSchedule({ ...valid, games: [...valid.games, { ...valid.games[0] }] }, 2026), /duplicate game ID/);
  assert.throws(() => validateSchedule({ ...valid, byeWeek: 11 }, 2026), /missing supplied bye week/);
  assert.throws(() => validateSchedule({ ...valid, nextGameId: "later" }, 2026), /published next game skips/);
});

test("schedule rows expose completed scores, outcome, location, badges, and recap action", () => {
  const completed = normalizeSchedule({ season: 2026, games: [game("final", 1, "2026-09-13T20:05:00Z", {
    status: "Final", home_team: SF, visitor_team: SEA, home_team_score: 17, visitor_team_score: 24,
    network: "FOX", venue: "Levi's Stadium", prime_time: true,
  })] }).games[0];
  const row = scheduleRow(completed);
  assert.deepEqual({ state: row.state, result: row.result, location: row.homeAway, division: row.division, primeTime: row.primeTime, action: row.action }, {
    state: "completed", result: { outcome: "W", {team}: 24, opponent: 17 }, location: "at", division: true, primeTime: true, action: "Recap",
  });
  assert.equal(row.resultLabel, "SEA 24, SF 17");
  assert.equal(row.href, "/games/final");
});

test("schedule rows distinguish next, later upcoming, TBD, and bye states", () => {
  const next = scheduleRow(normalizeSchedule({ season: 2026, games: [game("next", 2, "2026-09-20T20:05:00Z")] }).games[0], { nextGameId: "next" });
  const later = scheduleRow(normalizeSchedule({ season: 2026, games: [game("later", 3, "2026-09-27T20:05:00Z")] }).games[0]);
  const tbd = scheduleRow(normalizeSchedule({ season: 2026, games: [game("tbd", 4, "2026-10-04T00:00:00Z", { status: "TBD", time_tbd: true })] }).games[0]);
  const bye = scheduleRow({ id: "bye", state: "bye", week: 5 });
  assert.deepEqual([next.state, next.stateLabel, next.action], ["next", "Up next", "Game details"]);
  assert.deepEqual([later.state, later.stateLabel, later.action], ["upcoming", "Upcoming", "Game details"]);
  assert.deepEqual([tbd.state, tbd.stateLabel, tbd.kickoff], ["tbd", "Details TBD", "Time TBD"]);
  assert.deepEqual([bye.kind, bye.status, bye.detail], ["bye", "Bye", "No game scheduled"]);
});

test("schedule actions reflect preview, game-day, postponed, and missing metadata states", () => {
  const base = normalizeSchedule({ season: 2026, games: [game("states", 2, "2026-09-20T20:05:00Z")] }).games[0];
  assert.equal(scheduleRow({ ...base, previewAvailable: true }, { now: new Date("2026-09-19T20:00:00Z") }).action, "Preview");
  assert.equal(scheduleRow(base, { now: new Date("2026-09-20T12:00:00-07:00") }).action, "Game center");
  assert.equal(scheduleRow({ ...base, state: "postponed" }).action, "Updated details");
  const empty = scheduleRow({ ...base, network: null, venue: null });
  assert.equal(empty.network, null);
  assert.equal(empty.venue, null);
});

test("completed regular-season rows carry the {Team} record after that game", () => {
  const schedule = normalizeSchedule({ season: 2026, games: [
    game("win", 1, "2026-09-13T20:05:00Z", { status: "Final", home_team_score: 24, visitor_team_score: 17 }),
    game("loss", 2, "2026-09-20T20:05:00Z", { status: "Final", home_team_score: 14, visitor_team_score: 21 }),
  ] });
  assert.deepEqual(schedule.games.map((entry) => entry.{team}RecordAfter), ["1-0", "1-1"]);
});

test("bye rows stay within the surrounding chronological month group", () => {
  const september = normalizeSchedule({ season: 2026, games: [game("week-4", 4, "2026-09-27T20:05:00Z")] }).games[0];
  const october = normalizeSchedule({ season: 2026, games: [game("week-6", 6, "2026-10-11T20:05:00Z")] }).games[0];
  const groups = groupScheduleMonths([september, { id: "bye", state: "bye", week: 5 }, october]);
  assert.deepEqual(groups.map(({ label, games }) => [label, games.map(({ id }) => id)]), [
    ["September 2026", ["week-4", "bye"]], ["October 2026", ["week-6"]],
  ]);
});

test("schedule filters combine categories and OR choices within a category", () => {
  const homeDivision = normalizeSchedule({ season: 2026, games: [game("home-division", 1, "2026-09-13T20:05:00Z", { home_team: SEA, visitor_team: SF, season_type: "regular" })] }).games[0];
  const awayDivision = normalizeSchedule({ season: 2026, games: [game("away-division", 2, "2026-09-20T20:05:00Z", { home_team: SF, visitor_team: SEA, season_type: "regular" })] }).games[0];
  assert.equal(scheduleGameMatches(homeDivision, { filters: ["home", "division", "regular"] }), true);
  assert.equal(scheduleGameMatches(awayDivision, { filters: ["home", "division"] }), false);
  assert.equal(scheduleGameMatches(awayDivision, { filters: ["home", "away"] }), true);
  assert.equal(scheduleGameMatches(homeDivision, { status: "completed" }), false);
  assert.deepEqual(normalizeScheduleFilters(["HOME", "home", "invalid", "prime-time"]), ["home", "prime-time"]);
});

test("featured game stays on an unfinished live or postponed event until final", () => {
  const schedule = normalizeSchedule({ season: 2026, games: [
    game("live", 1, "2026-09-13T20:05:00Z", { status: "In Progress", home_team_score: 10, visitor_team_score: 7 }),
    game("later", 2, "2026-09-20T20:05:00Z"),
  ] });
  assert.equal(featuredScheduleEvent(schedule.games).id, "live");
  schedule.games[0].state = "completed";
  assert.equal(featuredScheduleEvent(schedule.games).id, "later");
  schedule.games[1].state = "completed";
  assert.equal(featuredScheduleEvent(schedule.games).id, "later");
});

test("canonical featured selector covers live, upcoming preseason, final, and offseason", () => {
  const schedule = normalizeSchedule({ season: 2026, games: [
    game("pre", 2, "2026-08-28T19:20:00-07:00", { season_type: "preseason" }),
    game("opener", 1, "2026-09-13T17:20:00-07:00", { season_type: "regular" }),
  ] });
  const clock = new Date("2026-08-28T12:00:00-07:00");
  assert.deepEqual(selectFeaturedGame(schedule.games, { now: clock }), { state: "upcoming", game: schedule.gamesPreseason[0], offseason: null });

  schedule.gamesRegular[0].state = "in_progress";
  assert.equal(selectFeaturedGame(schedule.games, { now: clock }).game.id, "opener");
  assert.equal(selectFeaturedGame(schedule.games, { now: clock }).state, "live");

  schedule.gamesRegular[0].state = "completed";
  schedule.gamesPreseason[0].state = "completed";
  assert.equal(selectFeaturedGame(schedule.games, { now: new Date("2026-10-01T12:00:00-07:00") }).state, "final");
  assert.equal(selectFeaturedGame([], { now: clock }).state, "offseason");
  assert.equal(selectFeaturedGame(schedule.games, { now: new Date("2027-03-01T12:00:00-08:00") }).state, "offseason");
});

test("preseason, regular-season, and postseason labels remain distinct", () => {
  for (const [seasonType, label] of [["preseason", "Preseason"], ["regular", "Regular Season"], ["postseason", "Postseason"]]) {
    const normalized = normalizeSchedule({ season: 2026, games: [game(seasonType, 1, "2026-09-13T17:20:00-07:00", { season_type: seasonType })] }).games[0];
    assert.match(gameDayView(normalized).phaseWeek, new RegExp(`^${label}`));
  }
});

test("all game surfaces preserve an exact 5:20 PM Pacific kickoff", () => {
  const normalized = normalizeSchedule({ season: 2026, games: [game("prime", 1, "2026-09-13T17:20:00-07:00")] }).games[0];
  assert.equal(formatKickoff(normalized, "time"), "5:20 PM PT");
  assert.equal(scheduleRow(normalized).kickoff, "5:20 PM PT");
  assert.equal(gameDayView(normalized).kickoff, "5:20 PM PT");
  assert.match(formatScheduleDate(normalized), /5:20 PM PT$/);
});

test("Pacific calendar formatting distinguishes local dates from kickoff instants across DST", () => {
  const options = { month: "long", day: "numeric", year: "numeric" };
  assert.equal(formatPacificCalendarDate("2026-09-09", options), "September 9, 2026");
  assert.equal(formatPacificCalendarDate("2027-01-03", options), "January 3, 2027");
  assert.equal(formatPacificCalendarDate("2026-09-10T03:00:00Z", options), "September 9, 2026");
  assert.equal(formatPacificCalendarDate("2027-01-04T04:00:00Z", options), "January 3, 2027");

  const evening = normalizeSchedule({ season: 2026, games: [game("evening", 1, "2026-09-10T03:00:00Z")] }).games[0];
  assert.equal(evening.date, "2026-09-09");
  assert.match(formatKickoff(evening), /^Wednesday, September 9, 2026/);
  assert.match(scheduleRow(evening).date, /Sep 9/);
});

test("featured view cleanly omits unavailable broadcast and venue", () => {
  const normalized = normalizeSchedule({ season: 2026, games: [game("minimal", 1, "2026-09-13T17:20:00-07:00")] }).games[0];
  const view = gameDayView(normalized);
  assert.equal(view.network, null);
  assert.equal(view.venue, null);
});

test("game-day view handles today, live, final scores, phase labels, and optional metadata", () => {
  const normalized = normalizeSchedule({ season: 2026, games: [game("today", 3, "2026-08-28T20:05:00Z", {
    season_type: "Preseason", network: "KING 5", radio: "Seattle Sports 710 AM", venue: "Lumen Field",
    records: { {team}: { phase: "preseason", record: "2-0" }, opponent: { phase: "regular", record: "10-7" } },
  })] }).games[0];
  const view = gameDayView(normalized, new Date("2026-08-28T12:00:00-07:00"));
  assert.equal(view.status, "Today");
  assert.equal(view.phaseWeek, "Preseason Week 3");
  assert.equal(view.radio, "Seattle Sports 710 AM");
  assert.equal(view.seaRecord, "2-0");
  assert.equal(view.opponentRecord, null);
  assert.equal(view.primaryLabel, "Game preview");

  normalized.state = "in_progress";
  normalized.home_team_score = 10;
  normalized.visitor_team_score = 7;
  assert.equal(gameDayView(normalized).status, "Live");
  assert.deepEqual(gameDayView(normalized).liveScore, { {team}: 10, opponent: 7 });
  normalized.state = "completed";
  normalized.home_team_score = 24;
  normalized.visitor_team_score = 17;
  assert.deepEqual(gameDayView(normalized).result, { outcome: "W", {team}: 24, opponent: 17 });
  assert.equal(gameDayView(normalized).primaryLabel, "Game recap");
});

test("calendar output is a complete CRLF ICS event and disables unconfirmed kickoffs", () => {
  const confirmed = normalizeSchedule({ season: 2026, games: [game("calendar-1", 1, "2026-09-13T20:05:00Z", {
    venue: "Lumen Field, Seattle", home_team: SEA, visitor_team: SF,
  })] }).games[0];
  const calendar = gameCalendar(confirmed, "https://{team}.example/schedule/");
  assert.equal(calendar.enabled, true);
  assert.match(calendar.content, /^BEGIN:VCALENDAR\r\n/);
  assert.match(calendar.content, /X-WR-TIMEZONE:America\/Los_Angeles\r\n/);
  assert.match(calendar.content, /DTSTART:20260913T200500Z\r\n/);
  assert.match(calendar.content, /LOCATION:Lumen Field\\, Seattle\r\n/);
  assert.match(calendar.content, /URL:https:\/\/{team}\.example\/games\/calendar-1\r\n/);
  assert.match(calendar.content, /NFL dates and times may change/);
  assert.match(calendar.content, /END:VCALENDAR\r\n$/);

  const unconfirmed = { ...confirmed, timeConfirmed: false, startsAt: null };
  assert.deepEqual(gameCalendar(unconfirmed, "https://{team}.example").enabled, false);
});

test("season calendar has stable UIDs, all phases, date-only TBD events, and no bye event", () => {
  const schedule = normalizeSchedule({ season: 2026, games: [
    game("pre", 1, "2026-08-20T20:05:00Z", { season_type: "preseason" }),
    game("regular", 1, "2026-09-13T20:05:00Z", { season_type: "regular" }),
    { ...game("playoff", 1, "2027-01-16T00:00:00Z", { season_type: "postseason", time_tbd: true }) },
    { id: "bye", season: 2026, season_type: "regular", week: 8, status: "bye", bye: true },
  ] });
  const first = seasonCalendar(schedule, "https://{team}.example");
  const second = seasonCalendar(schedule, "https://{team}.example");
  assert.equal(first.eventCount, 3);
  assert.equal(first.content, second.content);
  assert.match(first.content, /UID:2026-pre@{team}fanzone/);
  assert.match(first.content, /DTSTART;VALUE=DATE:20270116/);
  assert.doesNotMatch(first.content, /UID:2026-bye@/);
  assert.match(first.content, /URL:https:\/\/{team}\.example\/games\/regular/);
});
