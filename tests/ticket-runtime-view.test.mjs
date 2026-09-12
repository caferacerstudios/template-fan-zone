import test from "node:test";
import assert from "node:assert/strict";
import { eventSpyObservationModel, loadRuntimeTicketData, providerEventSummaryModel, runtimeEventUrl, runtimeProviderCoverage, runtimeTicketView, selectRuntimeEvent, ticketmasterSummaryModel, validateRuntimeEvent, validateRuntimeStatus } from "../src/lib/tickets/runtime-view.mjs";
import { eventSummaryAdapterPayload, listingAdapterPayload } from "../scripts/tickets/listing-adapter.mjs";

const future = "2030-01-01T00:00:00Z";
const past = "2020-01-01T00:00:00Z";

test("event-summary price ranges never become listing inventory", () => {
  const view = runtimeTicketView({
    providerReferences: [{ provider: "ticketmaster", mode: "event-summary", canonicalUrl: "https://www.ticketmaster.com/event/one", expiresAt: future, summary: { priceRanges: [{ min: 10, max: 100, currency: "USD" }] } }],
    listings: { admission: [], parking: [], other: [] },
  }, Date.parse("2029-01-01T00:00:00Z"));
  assert.equal(view.listings.length, 0);
  assert.equal(view.summaries.length, 1);
});

test("zero-listing state keeps matched event summaries separate", () => {
  const view = runtimeTicketView({ providerReferences: [{ provider: "ticketmaster", mode: "event-summary", canonicalUrl: "https://www.ticketmaster.com/event/one", expiresAt: future }], listings: {} }, Date.parse("2029-01-01T00:00:00Z"));
  assert.deepEqual(view.listings, []);
  assert.equal(view.summaries.length, 1);
});

test("a listing-level fixture reaches the comparison view", () => {
  const listing = { provider: "fictional-market-a", canonicalUrl: "https://fictional-market-a.example.invalid/one", providerListingId: "one", stale: false, rankEligible: true, expiresAt: future };
  const view = runtimeTicketView({ providerReferences: [], listings: { admission: [listing], parking: [], other: [] } }, Date.parse("2029-01-01T00:00:00Z"));
  assert.deepEqual(view.listings, [listing]);
});

test("stale, expired, and rank-ineligible provider data is not rendered", () => {
  const base = { provider: "fictional-market-a", canonicalUrl: "https://fictional-market-a.example.invalid/one", stale: false, rankEligible: true, expiresAt: future };
  const view = runtimeTicketView({ providerReferences: [], listings: { admission: [
    { ...base, providerListingId: "fresh" },
    { ...base, providerListingId: "stale", stale: true, rankEligible: false },
    { ...base, providerListingId: "expired", expiresAt: past },
  ], parking: [], other: [] } }, Date.parse("2029-01-01T00:00:00Z"));
  assert.deepEqual(view.listings.map(({ providerListingId }) => providerListingId), ["fresh"]);
});

test("browser runtime paths accept only the published event contract", () => {
  assert.equal(runtimeEventUrl({ eventFile: "events/sea_2026-regular-1.json" }), "/data/tickets/events/sea_2026-regular-1.json");
  assert.throws(() => runtimeEventUrl({ eventFile: "../status.json" }), /Invalid runtime ticket event path/);
  assert.throws(() => runtimeEventUrl({ eventFile: "events/not-{team}.json" }), /Invalid runtime ticket event path/);
});

test("listing adapter boundary fails closed when listings are absent", () => {
  assert.equal(listingAdapterPayload({ events: [{ id: "event", listings: [] }] }).events.length, 1);
  assert.throws(() => listingAdapterPayload({ events: [{ id: "event" }] }), { code: "INVALID_RESPONSE" });
  assert.equal(eventSummaryAdapterPayload({ events: [{ id: "event", priceRanges: [] }] }).events.length, 1);
});

const now = Date.parse("2029-01-01T00:00:00Z");
const status = { schemaVersion: "1.0.0", generatedAt: "2029-01-01T00:00:00Z", outcome: "success", fixture: false, scheduleFixture: false, providers: [{ provider: "ticketmaster", mode: "event-summary", state: "success", lastSuccess: "2029-01-01T00:00:00Z", counts: { fresh: 0, stale: 0, rejected: 2, unmatched: 1 } }] };
const index = { schemaVersion: "1.0.0", generatedAt: status.generatedAt, outcome: "success", events: [
  { eventKey: "sea:game-1", gameId: "game-1", eventFile: "events/sea_game-1.json" },
  { eventKey: "sea:game-2", gameId: "game-2", eventFile: "events/sea_game-2.json" },
] };
const capabilities = { supportsSeatListings: false, supportsResaleListings: false, supportsPriceRange: true, accessTier: "discovery" };
const event = { schemaVersion: "1.0.0", generatedAt: status.generatedAt, event: { eventKey: "sea:game-2", gameId: "game-2" }, providerReferences: [{ provider: "ticketmaster", providerEventId: "real", mode: "event-summary", state: "fresh", canonicalUrl: "https://www.ticketmaster.com/event/real", fetchedAt: status.generatedAt, expiresAt: future, capabilities, eventPrices: [], summary: { eventStatus: "onsale", inventoryDetailLevel: "price_range" } }], listings: { admission: [], parking: [], other: [] } };

test("beta runtime rejects fixtures, stale snapshots, and malformed responses", () => {
  assert.throws(() => validateRuntimeStatus({ ...status, fixture: true }, now), /prohibited/);
  assert.throws(() => validateRuntimeStatus({ ...status, scheduleFixture: true }, now), /schedule/);
  const missing = { ...status }; delete missing.scheduleFixture;
  assert.throws(() => validateRuntimeStatus(missing, now), /schedule/);
  assert.throws(() => validateRuntimeStatus({ ...status, generatedAt: past }, now), /stale/);
  assert.throws(() => validateRuntimeStatus({ ...status, schemaVersion: "2.0.0" }, now), /incompatible/);
});

test("beta loads only the selected event JSON and accepts zero listings", async () => {
  const requested = [];
  const values = new Map([["/data/tickets/status.json", status], ["/data/tickets/index.json", index], ["/data/tickets/events/sea_game-2.json", event]]);
  const loaded = await loadRuntimeTicketData(async (url) => { requested.push(url); return structuredClone(values.get(url)); }, "game-2", ["game-1", "game-2"], now);
  assert.deepEqual(requested.sort(), ["/data/tickets/events/sea_game-2.json", "/data/tickets/index.json", "/data/tickets/status.json"].sort());
  const view = runtimeTicketView(loaded.event, now);
  assert.equal(view.listings.length, 0);
  assert.equal(view.summaries.length, 1);
  assert.equal(runtimeProviderCoverage(loaded.status, loaded.event)[0].freshListings, 0);
});

test("Week 1 and Week 7 selections resolve independently", () => {
  const weeks = { ...index, events: [
    { eventKey: "sea:week-1", gameId: "week-1", eventFile: "events/sea_week-1.json" },
    { eventKey: "sea:week-7", gameId: "week-7", eventFile: "events/sea_week-7.json" },
  ] };
  assert.equal(selectRuntimeEvent(weeks, "week-1", ["week-1", "week-7"]).row.gameId, "week-1");
  assert.equal(selectRuntimeEvent(weeks, "week-7", ["week-1", "week-7"]).row.gameId, "week-7");
  assert.equal(selectRuntimeEvent({ ...weeks, events: weeks.events.slice(0, 1) }, "week-7", ["week-1", "week-7"]).row, null);
});

test("missing or malformed beta runtime data fails closed", async () => {
  await assert.rejects(loadRuntimeTicketData(async (url) => {
    if (url === "/data/tickets/status.json") throw new Error("missing");
    return index;
  }, "game-1", ["game-1"], now), /missing/);
  await assert.rejects(loadRuntimeTicketData(async (url) => url === "/data/tickets/status.json" ? status : { malformed: true }, "game-1", ["game-1"], now), /incompatible/);
});

test("Ticketmaster summary is official, allowlisted, and never converted to a listing", () => {
  const summary = ticketmasterSummaryModel(event.providerReferences[0]);
  assert.equal(summary.status, "On sale");
  assert.equal(summary.priceCopy, "Ticketmaster did not supply an event range");
  assert.match(summary.disclosure, /not an individual offer/);
  assert.equal(new URL(summary.href).hostname, "www.ticketmaster.com");
  assert.equal(runtimeTicketView(event, now).listings.length, 0);
  const unsafe = structuredClone(event); unsafe.providerReferences[0].canonicalUrl = "https://evil.example/event";
  assert.throws(() => validateRuntimeEvent(unsafe, index.events[1], now), /allowlisted/);
});

test("Ticketmaster range copy is explicit and does not imply a live seat listing", () => {
  const ranged = structuredClone(event.providerReferences[0]);
  ranged.eventPrices = [{ provider: "ticketmaster", marketType: "standard", minCents: 8550, maxCents: 64000, currency: "USD", priceBasis: "unknown", capturedAt: status.generatedAt, sourceIdentifier: "real", maxIsCapped: false }];
  const summary = ticketmasterSummaryModel(ranged);
  assert.equal(summary.priceCopy, "Ticketmaster-reported event range: $85.50–$640");
  assert.equal(summary.prices[0].marketType, "standard");
  assert.match(summary.disclosure, /Fee basis may vary/);
  assert.equal(Object.hasOwn(summary, "listings"), false);
});

test("generic event-price display supports min-only, capped, multi-currency, and absent ranges", () => {
  const reference = structuredClone(event.providerReferences[0]);
  reference.eventPrices = [
    { provider: "ticketmaster", marketType: "standard", minCents: 5000, maxCents: null, currency: "USD", priceBasis: "unknown", capturedAt: status.generatedAt, sourceIdentifier: "real", maxIsCapped: false },
    { provider: "ticketmaster", marketType: "resale", minCents: 10000, maxCents: 90000, currency: "CAD", priceBasis: "unknown", capturedAt: status.generatedAt, sourceIdentifier: "real", maxIsCapped: true },
  ];
  const model = providerEventSummaryModel(reference);
  assert.equal(model.prices[0].copy, "From $50");
  assert.match(model.prices[1].copy, /CA\$100.*CA\$900/);
  assert.equal(model.prices[1].maxIsCapped, true);
  assert.ok(model.href, "verified CTA remains available");
  const stubhub = structuredClone(reference);
  stubhub.provider = "stubhub"; stubhub.providerEventId = "stub-1"; stubhub.canonicalUrl = null;
  stubhub.eventPrices = [{ ...reference.eventPrices[0], provider: "stubhub", sourceIdentifier: "stub-1", minCents: 4200, maxCents: null }];
  assert.equal(providerEventSummaryModel(stubhub).priceCopy, "From $42");
  reference.eventPrices = [];
  assert.equal(providerEventSummaryModel(reference).priceCopy, "Ticketmaster did not supply an event range");
  assert.ok(providerEventSummaryModel(reference).href, "CTA remains when range is absent");
});

test("stored EventSpy samples produce truthful latest and rolling-low models", () => {
  const sample = (observedAt, prices, sevenDayLowestPriceCents = null) => ({ schemaVersion:"1.0.0", source:"eventspy", sourceUrl:"https://www.event-spy.com/event/seattle-{team}-seattle-sep-09-2026/374440", gameId:"1392216", collectedAt:observedAt, currency:"USD", summary:{ currentLowestPriceCents:prices[0], currentLowestSeenAt:observedAt, currentLowestMarketplace:"ticketmaster", sevenDayLowestPriceCents, sevenDayLowestSeenAt:observedAt }, seriesPoint:{ observedAt, marketplaces:["ticketmaster","stubhub","vividseats","seatgeek"].map((marketplace,index)=>({marketplace,lowestPriceCents:prices[index]})) } });
  const marketObservations = [
    sample("2029-01-01T00:00:00Z", [14225,15000,16000,17000], 13100),
    sample("2029-01-02T00:00:00Z", [13900,14900,15900,16900]),
  ];
  const model = eventSpyObservationModel({ marketObservations }, Date.parse("2029-01-02T06:00:00Z"));
  assert.equal(model.latest.summary.currentLowestPriceCents, 13900);
  assert.equal(model.sevenDayLowCents, 13900);
  assert.equal(model.stale, false);
  assert.deepEqual(eventSpyObservationModel({}, now).observations, []);
});

test("malformed event prices fail runtime validation and event prices never become rank candidates", () => {
  const malformed = structuredClone(event);
  malformed.providerReferences[0].eventPrices = [{ provider: "ticketmaster", marketType: "standard", minCents: 200, maxCents: 100, currency: "USD", priceBasis: "unknown", capturedAt: status.generatedAt, sourceIdentifier: "real", maxIsCapped: false }];
  assert.throws(() => validateRuntimeEvent(malformed, index.events[1], now), /minimum/);
  const ranged = structuredClone(event);
  ranged.providerReferences[0].eventPrices = [{ provider: "ticketmaster", marketType: "standard", minCents: 100, maxCents: 200, currency: "USD", priceBasis: "unknown", capturedAt: status.generatedAt, sourceIdentifier: "real", maxIsCapped: false }];
  assert.deepEqual(runtimeTicketView(ranged, now).listings, []);
  assert.equal(Object.hasOwn(ranged.providerReferences[0].eventPrices[0], "rankEligible"), false);
});

test("stale Ticketmaster summaries are clearly marked until their freshness limit", () => {
  const stale = structuredClone(event); stale.providerReferences[0].state = "stale";
  stale.providerReferences[0].eventPrices = [{ provider: "ticketmaster", marketType: "standard", minCents: 5000, maxCents: null, currency: "USD", priceBasis: "unknown", capturedAt: past, sourceIdentifier: "real", maxIsCapped: false }];
  assert.equal(validateRuntimeEvent(stale, index.events[1], now), stale);
  const summary = ticketmasterSummaryModel(runtimeTicketView(stale, now).summaries[0]);
  assert.equal(summary.stale, true);
  assert.equal(summary.priceCopy, "From $50");
  stale.providerReferences[0].expiresAt = past;
  assert.throws(() => validateRuntimeEvent(stale, index.events[1], now), /freshness limit/);
});

test("consumer coverage excludes disabled and pending providers", () => {
  const mixed = structuredClone(status);
  mixed.providers.push(
    { provider: "disabled-market", mode: "event-summary", state: "disabled", lastSuccess: null, counts: { fresh: 0, stale: 0, rejected: 0, unmatched: 0 } },
    { provider: "pending-market", mode: "event-summary", state: "pending", lastSuccess: null, counts: { fresh: 0, stale: 0, rejected: 0, unmatched: 0 } },
    { provider: "failed-market", mode: "event-summary", state: "error", lastSuccess: null, counts: { fresh: 0, stale: 0, rejected: 0, unmatched: 0 } },
  );
  assert.deepEqual(runtimeProviderCoverage(mixed, event).map(({ provider }) => provider), ["Ticketmaster", "failed-market"]);
});
