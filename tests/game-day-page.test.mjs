import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EVENTSPY_COVERAGE } from "../src/lib/tickets/eventspy-coverage.mjs";
import { gameDayPageModel } from "../src/lib/game-details.mjs";
import { currentProviderQuotes, quoteAtSevenDayLow, relativeObservationAge } from "../src/lib/tickets/provider-quotes.mjs";

const schedule = JSON.parse(await readFile(new URL("../src/data/nfl/{team}.json", import.meta.url), "utf8"));
const component = await readFile(new URL("../src/components/GameDayPage.astro", import.meta.url), "utf8");
const guideComponent = await readFile(new URL("../src/components/game/GameDayGuide.astro", import.meta.url), "utf8");
const sourceLinkComponent = await readFile(new URL("../src/components/game/GuideSourceLink.astro", import.meta.url), "utf8");
const gameDayGuides = JSON.parse(await readFile(new URL("../src/data/nfl/game-day-guides.json", import.meta.url), "utf8"));
const gameRoute = await readFile(new URL("../src/pages/games/[gameId].astro", import.meta.url), "utf8");
const ticketRoute = await readFile(new URL("../src/pages/tickets.astro", import.meta.url), "utf8");

test("both URLs resolve game 1392216 through the same shared page model", () => {
  const fromGameUrl = gameDayPageModel(schedule, "1392216", EVENTSPY_COVERAGE);
  const fromTicketUrl = gameDayPageModel(schedule, new URL("https://example.test/tickets/?game=1392216").searchParams.get("game"), EVENTSPY_COVERAGE);
  for (const model of [fromGameUrl, fromTicketUrl]) {
    assert.equal(model.id, "1392216");
    assert.equal(model.opponentName, "New England Patriots");
    assert.equal(model.venue, "Lumen Field");
    assert.equal(model.game.date, fromGameUrl.game.date);
    assert.equal(model.ticketSnapshot, EVENTSPY_COVERAGE[0]);
    assert.match(model.{team}Logo, /SEA\.png/);
    assert.match(model.opponentLogo, /NE\.png/);
  }
  assert.match(gameRoute, /GameDayPage/);
  assert.match(gameRoute, /routeStyle="games"/);
  assert.match(ticketRoute, /GameDayPage/);
});

test("ticket UI prefers canonical schedule dates and uses the shared Pacific formatter", () => {
  assert.match(component, /canonical\?canonical\.startsAt\?\?canonical\.date:row\.localDate/);
  assert.match(component, /dateValue=g\.game\?\.startsAt\?\?g\.game\?\.date/);
  assert.doesNotMatch(component, /g\.game\?\.date\?\?event\?\.localDate|localTimeLabel/);
  assert.match(component, /formatPacificCalendarDate/);
});

test("provider quotes remain price sorted with unavailable providers last", () => {
  const quotes = currentProviderQuotes([{ observedAt: "2026-09-01T22:15:00Z", ticketmasterCents: 12000, stubhubCents: null, vividseatsCents: 9500, seatgeekCents: 11000 }]);
  assert.deepEqual(quotes.map(({ provider }) => provider), ["vividseats", "seatgeek", "ticketmaster", "stubhub"]);
  assert.equal(quotes[0].isLowest, true);
});

test("current-lowest rendering shares the provider quote result instead of the summary", () => {
  const history = [
    { observedAt: "2026-09-01T10:00:00Z", ticketmasterCents: 15000, stubhubCents: 14000, vividseatsCents: 13000, seatgeekCents: 12000 },
    { observedAt: "2026-09-02T10:00:00Z", ticketmasterCents: 11000, stubhubCents: null, vividseatsCents: null, seatgeekCents: null },
  ];
  const quotes = currentProviderQuotes(history);
  const winner = quotes.find(quote => quote.isLowest);
  assert.deepEqual([winner.provider, winner.priceCents, winner.observedAt], ["ticketmaster", 11000, "2026-09-02T10:00:00Z"]);
  assert.match(component, /quotes=currentProviderQuotes\(v\.history\),winner=quotes\.find/);
  assert.match(component, /providerCards\(v,quotes\)/);
  assert.match(component, /data-current-lowest="\$\{currentLowest\?\?"unavailable"\}"/);
  assert.match(component, /currentLowestCents:currentLowest/);
  assert.doesNotMatch(component, /money\(v\.summary\.currentLowestCents\)|v\.summary\.currentLowestAgeLabel|v\.summary\.atSevenDayLow/);
});

test("sparse and tied quotes preserve latest valid observations and canonical tie order", () => {
  const quotes = currentProviderQuotes([
    { observedAt: "2026-09-01T10:00:00Z", ticketmasterCents: 10000, stubhubCents: 10000, vividseatsCents: 12000, seatgeekCents: 10000 },
    { observedAt: "2026-09-02T10:00:00Z", ticketmasterCents: null, stubhubCents: null, vividseatsCents: null, seatgeekCents: null },
  ]);
  assert.deepEqual(quotes.filter(quote => quote.isLowest).map(quote => [quote.provider, quote.priceCents, quote.isTiedLowest]), [
    ["ticketmaster", 10000, true], ["stubhub", 10000, true], ["seatgeek", 10000, true],
  ]);
});

test("no valid provider quote produces no winner or lowest badge", () => {
  const quotes = currentProviderQuotes([{ observedAt: "2026-09-02T10:00:00Z", ticketmasterCents: null, stubhubCents: 0, vividseatsCents: -1, seatgeekCents: null }]);
  assert.equal(quotes.find(quote => quote.isLowest), undefined);
  assert.ok(quotes.every(quote => quote.priceCents === null && quote.isLowest === false));
  assert.match(component, /currentPrice=currentLowest===null\?"Price unavailable"/);
});

test("headline age and seven-day badge use the selected provider observation", () => {
  const now = Date.parse("2026-09-03T12:00:00Z");
  const history = [
    { observedAt: "2026-09-01T12:00:00Z", ticketmasterCents: 9000, stubhubCents: 12000, vividseatsCents: null, seatgeekCents: null },
    { observedAt: "2026-09-03T10:00:00Z", ticketmasterCents: 10000, stubhubCents: 11000, vividseatsCents: null, seatgeekCents: null },
  ];
  const winner = currentProviderQuotes(history).find(quote => quote.isLowest);
  assert.equal(winner.observedAt, "2026-09-03T10:00:00Z");
  assert.equal(relativeObservationAge(winner.observedAt, now), "2 hours ago");
  assert.equal(quoteAtSevenDayLow(history, winner, now), false);
  assert.match(component, /relativeObservationAge\(winner\.observedAt,now\)/);
  assert.match(component, /quoteAtSevenDayLow\(v\.history,winner,now\)/);
  assert.match(component, /checkedTime\(v\.collectedAt\)/);
});

test("shared page omits diagnostic placeholders and restores stable upcoming-game guides", () => {
  for (const text of ["NFC West context unavailable", "Recent form unavailable", "Opponent leaders unavailable", "Official links not posted", "Record unavailable"]) {
    assert.doesNotMatch(component, new RegExp(text));
  }
  assert.match(component, /Where to Watch/);
  assert.match(component, /Viewing information coming soon\./);
  assert.match(component, /Game Day Guide/);
  assert.match(component, /Game Day Guide coming soon\./);
  assert.match(component, /Ticket tracking is not available for this game yet/);
  assert.match(component, /Historical ticket-market information for this completed game/);
});

test("structured Game Day Guides are selected by the requested game ID", () => {
  assert.match(component, /game-day-guides\.json/);
  assert.match(component, /gameDayGuides\?\.games\?\.\[requestedGameId\] \?\? null/);
  assert.match(component, /<GameDayGuide guide=\{gameDayGuide\}/);
  assert.equal(gameDayGuides.schemaVersion, 1);
  const expectedGuideIds = ["1392216", "1392244", "1392256", "1392277", "1392292", "1392295", "1392321", "1392336", "1392349", "1392361", "1392392", "1392408", "1392421", "1392425", "1392443", "1392467", "1392478"];
  assert.deepEqual(Object.keys(gameDayGuides.games).sort(), expectedGuideIds);
  for (const gameId of expectedGuideIds) assert.equal(gameDayGuides.games[gameId].gameId, gameId);
  assert.doesNotMatch(guideComponent, /1392216|New England Patriots/);
  assert.match(guideComponent, /Game Day Guide coming soon\./);
});

test("Week 18 guide does not publish its former placeholder date", () => {
  const week18 = gameDayGuides.games["1392478"];
  assert.equal(week18.game.date, null);
  assert.match(week18.summary, /date and kickoff time as TBD/);
  assert.doesNotMatch(JSON.stringify(week18), /2027-01-10|January 10/);
});

test("Week 1 guide distinguishes the sold-out concert and current stadium entertainment", () => {
  const guide = gameDayGuides.games["1392216"];
  const text = JSON.stringify(guide);
  assert.match(text, /USAA Salute 250 Kickoff Concert/);
  assert.match(text, /sold out/i);
  assert.match(text, /game-ticket holders should not assume|game ticket alone does not provide concert access/i);
  assert.match(text, /Mike McCready/);
  assert.match(text, /Soundgarden/);
  assert.match(text, /Taylor Momsen/);
  assert.match(text, /Ticketmaster Tailgate/);
});

test("Game Day Guide safely renders contextual external links and optional content", () => {
  assert.match(sourceLinkComponent, /parsed\.protocol === "http:" \|\| parsed\.protocol === "https:"/);
  assert.match(sourceLinkComponent, /target="_blank" rel="noopener noreferrer"/);
  assert.match(guideComponent, /specials\.length > 0/);
  assert.match(guideComponent, /weather &&/);
  assert.match(guideComponent, /typeof item\.price === "number"/);
  assert.match(guideComponent, /item\.official === true/);
  assert.doesNotMatch(guideComponent, /guide\?\.sources/);
});

test("ticket history defaults to a real seven-day data window", () => {
  assert.match(component, /function renderChart\(v,days=7,/);
  assert.match(component, /Date\.parse\(p\.observedAt\)>=end-days\*864e5/);
  assert.match(component, /\[7,14,30\]\.includes\(requestedRange\)\?requestedRange:7/);
  assert.match(component, /renderChart\(v,days,selected\)/);
});

test("game and tickets routes share the complete ticket explorer", () => {
  const intro = component.indexOf('section="intro"');
  const guides = component.indexOf('class="game-guide-cards"');
  const explorer = component.indexOf('id="ticket-price-explorer"');
  const supporting = component.indexOf('section="supporting"');
  const gameSupport = component.indexOf('class="server-game-support"');
  assert.ok(intro >= 0 && intro < guides && guides < explorer && explorer < supporting && supporting < gameSupport);
  assert.match(component, /<section id="ticket-price-explorer"/);
  assert.match(component, /<TicketPublisherContent[^>]+section="supporting"/);
  assert.match(component, /<script type="application\/json" id="ticket-game-models"/);
  for (const text of ["Choose a {Team} game", "Days Until Kickoff", "Current Lowest", "Compare Ticket Providers", "Lowest Ticket Price History"]) {
    assert.match(component, new RegExp(text));
  }
  assert.doesNotMatch(component, /ServerTicketSummary/);
  assert.doesNotMatch(component, /serverTicketObservation/);
  for (const text of ["Current Ticket Observation", "Lowest observed price", "Ticket-data timestamp", "Provider coverage"]) {
    assert.doesNotMatch(component, new RegExp(text));
  }
});
