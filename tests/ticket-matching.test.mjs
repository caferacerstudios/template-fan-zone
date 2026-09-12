import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMatchReviewReport, evaluateProviderEvent, matchProviderEvents, normalizeNflTeam, sfzEventKey, validateMatchOverrides } from "../src/lib/tickets/match.mjs";

const fixture = JSON.parse(await readFile(new URL("../src/data/tickets/fixtures/matching.json", import.meta.url), "utf8"));
const overrides = JSON.parse(await readFile(new URL("../src/data/tickets/match-overrides.json", import.meta.url), "utf8"));
const [home, tbd, overridden] = fixture.games;
const [admission, parking, tbdEvent, manual, blocked] = fixture.providerEvents;

test("stable SFZ keys use the schedule ID and survive flex scheduling", () => {
  assert.equal(sfzEventKey(home), "sea:fixture-game-home");
  assert.equal(sfzEventKey({ ...home, startsAt: "2026-09-14T00:20:00Z" }), sfzEventKey(home));
  assert.throws(() => sfzEventKey({ week: 1 }), /stable schedule/);
  assert.throws(() => sfzEventKey({ id: "2026-regular-1-upcoming", season: 2026, phase: "regular", week: 1, state: "upcoming" }), /synthesized/);
});

test("normalizes {Team} and opponent naming variations", () => {
  assert.equal(normalizeNflTeam("Seattle {Team}"), "SEA");
  assert.equal(normalizeNflTeam("SFO"), "SF");
  assert.equal(normalizeNflTeam("LA Rams"), "LAR");
});

test("matches admission using provider-local time and publishes only high confidence", () => {
  const result = evaluateProviderEvent(home, admission);
  assert.deepEqual([result.outcome, result.confidence, result.publishable, result.matchMethod], ["matched", "high", true, "teams-venue-time"]);
  assert.equal(result.evidence.timeDifferenceHours, 0);
});

test("provider attraction IDs can supply team identity", () => {
  const event = { ...admission, id: "ATTRACTIONS", homeTeam: undefined, awayTeam: undefined, teams: [{ id: "team-sea" }, { id: "team-sf" }] };
  const result = evaluateProviderEvent(home, event, { attractionIds: { "team-sea": "SEA", "team-sf": "SF" } });
  assert.equal(result.matchMethod, "provider-crosswalk");
  assert.equal(result.evidence.teams, true);
});

test("rejects parking and regular-season preseason products", () => {
  const parkingResult = evaluateProviderEvent(home, parking);
  assert.ok(parkingResult.reasons.includes("parking-event"));
  assert.equal(parkingResult.publishable, false);
  assert.equal(parkingResult.outcome, "rejected");
  const preseason = evaluateProviderEvent(home, { ...admission, id: "PRE", title: "{Team} preseason exhibition" });
  assert.ok(preseason.reasons.includes("preseason-for-regular-game"));
  assert.equal(preseason.publishable, false);
});

test("rejects Ticketmaster promotional, travel, and signup products", () => {
  for (const [name, reason] of [
    ["HALF PRICE: Denver Broncos v Seattle {Team}", "promotional-event-shell"],
    ["Las Vegas Raiders vs. Seattle {Team} | Official Hotel Packages", "travel-package"],
    ["Seattle {Team} Season Ticket Notification List", "season-ticket-interest-list"],
  ]) assert.ok(evaluateProviderEvent(home, { ...admission, id: name, name }).reasons.includes(reason));
});

test("rejects similarly named non-NFL events and reversed home/away games", () => {
  const concert = evaluateProviderEvent(home, { ...admission, id: "CONCERT", eventType: "concert" });
  const reversed = evaluateProviderEvent(home, { ...admission, id: "REVERSED", homeTeam: "SF", awayTeam: "SEA" });
  assert.ok(concert.reasons.includes("non-nfl-event-type"));
  assert.ok(reversed.reasons.includes("home-away-conflict"));
  assert.equal(reversed.publishable, false);
});

test("venue changes are held for review instead of silently published", () => {
  const result = evaluateProviderEvent(home, { ...admission, id: "VENUE-CHANGE", venueName: "Temporary NFL Stadium" });
  assert.deepEqual([result.outcome, result.confidence, result.publishable], ["review", "medium", false]);
  assert.ok(result.reasons.includes("venue-conflict"));
});

test("requires review for a Week 18 game with a TBD kickoff", () => {
  const result = evaluateProviderEvent(tbd, tbdEvent);
  assert.deepEqual([result.outcome, result.confidence, result.publishable, result.reviewRequired], ["review", "medium", false, true]);
  assert.ok(result.reasons.includes("kickoff-time-unconfirmed"));
});

test("flexed or postponed candidates remain reviewable without changing identity", () => {
  const flexed = { ...admission, id: "FLEXED", startTimeUtc: "2026-09-14T07:25:00Z", localStart: undefined, timeZone: undefined };
  const result = evaluateProviderEvent(home, flexed);
  assert.equal(result.eventKey, "sea:fixture-game-home");
  assert.equal(result.publishable, false);
  assert.equal(result.reviewRequired, true);
  assert.ok(result.reasons.includes("possible-reschedule"));
});

test("manual mappings publish and manual blocks reject with audit records", () => {
  assert.equal(validateMatchOverrides(overrides), overrides);
  const mapped = evaluateProviderEvent(overridden, manual, { overrides });
  const denied = evaluateProviderEvent(home, blocked, { overrides });
  assert.deepEqual([mapped.matchMethod, mapped.confidence, mapped.publishable], ["manual", "high", true]);
  assert.equal(mapped.override.reason.length > 0, true);
  assert.deepEqual([denied.outcome, denied.reasons[0]], ["rejected", "manual-block"]);
});

test("multiple otherwise strong events are ambiguous and never publish", () => {
  const duplicate = { ...admission, id: "PROVIDER-GAME-1-B" };
  const report = matchProviderEvents([home], [admission, duplicate]);
  assert.equal(report.matches.length, 0);
  assert.equal(report.unresolvedGames[0].reason, "ambiguous-candidates");
  assert.ok(report.candidates.every((candidate) => !candidate.publishable));
});

test("fixture review report includes matches, rejection reasons, confidence, and unresolved games", () => {
  const report = createMatchReviewReport(fixture.games, fixture.providerEvents, { overrides });
  assert.match(report.markdown, /PROVIDER-GAME-1 \(high, teams-venue-time\)/);
  assert.match(report.markdown, /parking-event/);
  assert.match(report.markdown, /sea:fixture-game-tbd: review-required/);
});
