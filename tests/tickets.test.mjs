import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateTicketFixture } from "../src/lib/tickets/validate.mjs";

const fixture = JSON.parse(await readFile(new URL("../src/data/tickets/fixtures/development.snapshot.json", import.meta.url), "utf8"));
const clone = () => structuredClone(fixture);

test("the deterministic development fixture covers ticket-provider edge cases", () => {
  assert.equal(validateTicketFixture(clone()).fixture, true);
  const [home, away] = fixture.events;
  assert.equal(home.venue.name, "Lumen Field");
  assert.equal(away.venueLocalStart.timeZone, "America/New_York");
  assert.ok(away.rescheduledFromUtc);
  assert.equal(fixture.unmatchedProviderEvents[0].matchConfidence, "none");
  assert.ok(fixture.providerStatuses.some(({ status }) => status === "stale"));
  assert.ok(fixture.providerStatuses.some(({ status }) => status === "error"));
  assert.ok(home.providerEventReferences.some(({ status }) => status === "event-summary"));
  assert.ok(home.providerEventReferences.some(({ status }) => status === "deep-link-only"));
  assert.equal(home.listings.find(({ productType }) => productType === "parking").productType, "parking");
  assert.deepEqual(home.listings.find(({ providerListingId }) => providerListingId === "FAKE-MARKET-A-303").allowedQuantities, [2, 4]);
});

test("money must be non-negative integer cents", () => {
  const data = clone(); data.events[0].listings[0].basePriceCents = 149.99;
  assert.throws(() => validateTicketFixture(data), /non-negative safe integer number of cents/);
});

test("unknown fees cannot be treated as all-in", () => {
  const data = clone(); data.events[0].listings[2].allInPerTicketCents = 12000;
  assert.throws(() => validateTicketFixture(data), /unknown fees cannot have all-in/);
});

test("raw section text is retained with a normalized section", () => {
  const data = clone(); data.events[0].listings[0].sectionRaw = null;
  assert.throws(() => validateTicketFixture(data), /must be preserved/);
});

test("seller PII and provider commission fields fail closed", () => {
  for (const [key, value] of [["sellerEmail", "person@example.com"], ["providerCommission", 1200]]) {
    const data = clone(); data.events[0].listings[0][key] = value;
    assert.throws(() => validateTicketFixture(data), /prohibited/);
  }
});

test("raw errors and secret-bearing URLs fail closed", () => {
  const rawError = clone(); rawError.providerStatuses[7].errorMessage = "Authorization: secret";
  assert.throws(() => validateTicketFixture(rawError), /prohibited/);
  const secretUrl = clone(); secretUrl.events[0].listings[0].canonicalUrl = "https://fictional-box-office.example.invalid/listing?access_token=secret";
  assert.throws(() => validateTicketFixture(secretUrl), /secret-like query/);
});

test("provider text and outbound hosts fail closed", () => {
  const markup = clone(); markup.events[0].listings[0].sectionRaw = '<img src=x onerror="alert(1)">';
  assert.throws(() => validateTicketFixture(markup), /bounded plain text/);
  const wrongHost = clone(); wrongHost.events[0].listings[0].canonicalUrl = "https://fictional-verified.example.invalid/listing";
  assert.throws(() => validateTicketFixture(wrongHost), /not allowlisted/);
});

test("listing identity and provider references remain consistent", () => {
  const wrongGame = clone(); wrongGame.events[0].listings[0].sfzGameId = "wrong-game";
  assert.throws(() => validateTicketFixture(wrongGame), /must match its event/);
  const duplicate = clone(); duplicate.events[1].listings.push({ ...duplicate.events[0].listings[2], sfzGameId: duplicate.events[1].sfzGameId });
  assert.throws(() => validateTicketFixture(duplicate), /duplicate provider listing/);
});

test("unmatched events cannot claim match confidence", () => {
  const data = clone(); data.unmatchedProviderEvents[0].matchConfidence = "low";
  assert.throws(() => validateTicketFixture(data), /must be none for an unmatched event/);
});
