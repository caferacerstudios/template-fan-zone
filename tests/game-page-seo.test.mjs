import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EVENTSPY_COVERAGE } from "../src/lib/tickets/eventspy-coverage.mjs";
import { gameCollection, gameDayPageModel } from "../src/lib/game-details.mjs";
import { gamePageMetadata, sportsEventData } from "../src/lib/game-page.mjs";

const schedule = JSON.parse(await readFile(new URL("../src/data/nfl/{team}.json", import.meta.url), "utf8"));

test("home and away games use the correct readable matchup relationship", () => {
  const home = gameDayPageModel(schedule, "1392216", EVENTSPY_COVERAGE);
  const away = gameDayPageModel(schedule, "1392244", EVENTSPY_COVERAGE);
  assert.equal(gamePageMetadata(home).title, "New England Patriots at Seattle {Team}: Week 1 Guide (2026) | {Team} Fan Zone");
  assert.equal(gamePageMetadata(home).h1, "New England Patriots at Seattle {Team}: Week 1 Game Guide (2026)");
  assert.equal(gamePageMetadata(away).title, "Seattle {Team} at Arizona Cardinals: Week 2 Guide (2026) | {Team} Fan Zone");
  assert.equal(gamePageMetadata(away).h1, "Seattle {Team} at Arizona Cardinals: Week 2 Game Guide (2026)");
});

test("all generated games have unique titles and descriptions, including repeat opponents", () => {
  const metadata = gameCollection(schedule, EVENTSPY_COVERAGE).map((game) => gamePageMetadata(gameDayPageModel(schedule, game.id, EVENTSPY_COVERAGE)));
  assert.equal(new Set(metadata.map((item) => item.title)).size, metadata.length);
  assert.equal(new Set(metadata.map((item) => item.description)).size, metadata.length);
});

test("future and completed games transition at the same canonical URL", () => {
  const base = {
    id: "future-final", home: false, opponentName: "Arizona Cardinals", opponentAbbr: "ARI", venue: "State Farm Stadium", weekLabel: "Week 2",
    game: { id: "future-final", season: 2026, week: 2, state: "upcoming", startsAt: "2026-09-21T00:20:00.000Z", timeConfirmed: true },
  };
  const future = gamePageMetadata(base);
  const completedGame = { ...base, completed: true, seaScore: 24, opponentScore: 17, game: { ...base.game, state: "completed" } };
  const completed = gamePageMetadata(completedGame);
  assert.equal(future.title, completed.title);
  assert.match(completed.summary, /Seattle 24, Arizona Cardinals 17/);
  const structured = sportsEventData(completedGame, completed, "https://{team}fanzone.com/games/future-final");
  assert.equal(structured.eventStatus, "https://schema.org/EventCompleted");
  assert.equal(structured.url, "https://{team}fanzone.com/games/future-final");
  assert.equal(structured.homeTeam.name, "Arizona Cardinals");
  assert.equal(structured.awayTeam.name, "Seattle {Team}");
  assert.equal(structured.offers, undefined);
  const withIgnoredTicketData = sportsEventData(completedGame, completed, "https://{team}fanzone.com/games/future-final", { summary: { currentLowestCents: 12500, currentLowestMarketplace: "ticketmaster" }, providerLinks: { ticketmaster: "https://www.ticketmaster.com/event/test" } });
  assert.equal(withIgnoredTicketData.offers, undefined);
});

test("missing viewing data gets an explicit placeholder without invented values", async () => {
  const component = await readFile(new URL("../src/components/GameDayPage.astro", import.meta.url), "utf8");
  assert.match(component, /Viewing information coming soon\./);
  assert.match(component, /Game Day Guide coming soon\./);
  assert.doesNotMatch(component, /serverTicketObservation/);
  assert.doesNotMatch(gamePageMetadata(gameDayPageModel(schedule, "1392216", EVENTSPY_COVERAGE)).description, /ticket/i);
});
