import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EVENTSPY_COVERAGE } from "../src/lib/tickets/eventspy-coverage.mjs";
import { coverageGame, gameDayPageModel, gameDetails, ticketGameModels } from "../src/lib/game-details.mjs";
import { formatPacificCalendarDate, normalizeSchedule } from "../src/lib/schedule.mjs";
import { scheduleRow } from "../src/lib/schedule-display.mjs";

const schedule = JSON.parse(await readFile(new URL("../src/data/nfl/{team}.json", import.meta.url), "utf8"));

test("ticket game 1392216 resolves through the authoritative game ID", () => {
  const details = gameDetails(schedule, "1392216", { coverage: EVENTSPY_COVERAGE });
  assert.equal(details.id, "1392216");
  assert.equal(details.opponentName, "New England Patriots");
  assert.equal(details.opponentAbbr, "NE");
  assert.equal(details.home, true);
});

test("ticket models preserve the shared game ID and ticket navigation", () => {
  const models = ticketGameModels(schedule, EVENTSPY_COVERAGE);
  assert.equal(models["1392216"].id, "1392216");
  assert.equal(models["1392216"].previousId, null);
  assert.equal(models["1392216"].nextId, "1392244");
  assert.equal(models["1392244"].previousId, "1392216");
  assert.equal(models["1392216"].weekLabel, "Week 1");
  assert.equal(models["1392244"].weekLabel, "Week 2");
});

test("game pages expose chronological previous and next routes", () => {
  const first = gameDayPageModel(schedule, "1392216", EVENTSPY_COVERAGE);
  const away = gameDayPageModel(schedule, "1392244", EVENTSPY_COVERAGE);
  assert.equal(first.previousId, null);
  assert.ok(first.nextId);
  assert.ok(away.previousId);
  assert.equal(away.nextId, "1392256");
});

test("missing optional football data stays nullable and invalid IDs fail cleanly", () => {
  const details = gameDetails(schedule, "1392216", { coverage: EVENTSPY_COVERAGE });
  assert.equal(details.seaScore, null);
  assert.equal(details.opponentScore, null);
  assert.equal(gameDetails(schedule, "not-a-game", { coverage: EVENTSPY_COVERAGE }), null);
});

test("schedule, game details, Ticket Finder, and ticket game models share the canonical date", () => {
  const canonical = {
    season: 2026,
    games: [{
      id: "shared-date", season: 2026, week: 1, season_type: "regular", status: "Scheduled",
      date: "2026-09-10T03:00:00Z",
      home_team: { abbreviation: "SEA", full_name: "Seattle {Team}" },
      visitor_team: { abbreviation: "SF", full_name: "San Francisco 49ers" },
    }],
  };
  const coverage = [{ gameId: "shared-date", opponent: "San Francisco 49ers", homeAway: "home", localDate: "2026-09-08" }];
  const normalized = normalizeSchedule(canonical).games[0];
  const details = gameDetails(canonical, "shared-date", { coverage });
  const gamePage = gameDayPageModel(canonical, "shared-date", coverage);
  const ticketModel = ticketGameModels(canonical, coverage)["shared-date"];

  assert.equal(normalized.date, "2026-09-09");
  assert.match(scheduleRow(normalized).date, /Sep 9/);
  for (const model of [details, gamePage, ticketModel]) assert.equal(model.game.date, normalized.date);
  assert.equal(formatPacificCalendarDate(ticketModel.game.date, { month: "long", day: "numeric", year: "numeric" }), "September 9, 2026");
});

test("fallback coverage games preserve local calendar-date semantics", () => {
  for (const localDate of ["2026-09-09", "2027-01-03"]) {
    const fallback = coverageGame({ gameId: `fallback-${localDate}`, opponent: "San Francisco 49ers", homeAway: "home", localDate }, 2026);
    assert.equal(fallback.date, localDate);
    assert.equal(fallback.startsAt, null);
    assert.equal(fallback.dateConfirmed, true);
    assert.equal(fallback.timeConfirmed, false);
    assert.equal(formatPacificCalendarDate(fallback.date, { year: "numeric", month: "2-digit", day: "2-digit" }), localDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1"));
  }
});
