import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../scripts/tickets/config.mjs";
import { acquireLock, heartbeatLock, releaseLock, runTicketSync } from "../scripts/tickets/pipeline.mjs";
import { matchTicketmasterEvent, normalizeTicketmasterEvent, providerRegistry, ticketmasterSeasonWindow } from "../scripts/tickets/providers.mjs";
import { evaluateProviderEvent, normalizeNflTeam, sfzEventKey } from "../src/lib/tickets/match.mjs";
import { providerEventPricesFromRanges, validateProviderEventPrice } from "../src/lib/tickets/provider-event-price.mjs";
import { games as realSchedule, legitimateEvents, providerEvents, rejectedEvents } from "./fixtures/ticketmaster-discovery.mjs";

test("Ticketmaster is approved only as a credentialed event-summary source", () => {
  const adapter = providerRegistry().ticketmaster;
  assert.equal(adapter.approvalStatus, "approved");
  assert.equal(adapter.credentialEnv, "TICKETMASTER_API_KEY");
  assert.deepEqual(adapter.capabilities, { supportsSeatListings: false, supportsResaleListings: false, supportsPriceRange: true, accessTier: "discovery" });
  assert.throws(() => loadConfig({ TICKETS_PROVIDERS_JSON: JSON.stringify({ ticketmaster: { enabled: true, mode: "event-summary" } }) }, root), /requires TICKETMASTER_API_KEY/);
});

test("Ticketmaster normalization preserves genuine summary capability without listings", () => {
  const event = normalizeTicketmasterEvent({ id: "tm-1", name: "Seattle {Team} vs. New England Patriots", url: "https://www.ticketmaster.com/event/tm-1", dates: { start: { dateTime: "2026-09-01T00:00:00Z", localDate: "2026-08-31", localTime: "17:00:00" }, timezone: "America/Los_Angeles", status: { code: "onsale" } }, _embedded: { attractions: [{ id: "K8vZ9171oU7", name: "Seattle {Team}" }], venues: [{ name: "Lumen Field", city: { name: "Seattle" }, state: { stateCode: "WA" } }] }, classifications: [{ segment: { name: "Sports" }, genre: { name: "Football" } }] });
  assert.equal(event.id, "tm-1"); assert.deepEqual(event.priceRanges, []); assert.equal(event.currency, null);
  assert.equal(event.inventoryDetailLevel, "price_range");
  assert.equal(Object.hasOwn(event, "listings"), false);
  assert.deepEqual(event.attractions, [{ id: "K8vZ9171oU7", name: "Seattle {Team}" }]);
});

const discoveryEvent = (overrides = {}) => ({
  id: "vvG1HZkABC123", name: "Seattle {Team} vs. New England Patriots",
  url: "https://www.ticketmaster.com/event/0F006482E67E7496",
  dates: { start: { dateTime: "2026-09-10T00:20:00Z", localDate: "2026-09-09", localTime: "17:20:00" }, timezone: "America/Los_Angeles", status: { code: "onsale" } },
  priceRanges: [{ currency: "USD", min: 85.5, max: 640 }],
  _embedded: { venues: [{ name: "Lumen Field", city: { name: "Seattle" }, state: { stateCode: "WA" } }] },
  ...overrides,
});

test("Ticketmaster matches name and date, verifies the legacy URL ID, and saves the universal ID", async () => {
  const adapter = providerRegistry().ticketmaster;
  let requested;
  const result = await adapter.sync({ apiKey: "test-key", eventName: "Seattle {Team} vs. New England Patriots", eventDate: "2026-09-09", legacyEventId: "0F006482E67E7496", timeoutMs: 100, fetch: async (url) => { requested = url; return { ok: true, json: async () => ({ _embedded: { events: [discoveryEvent()] } }) }; } });
  assert.equal(requested.pathname, "/discovery/v2/events.json");
  assert.equal(requested.searchParams.get("keyword"), "Seattle {Team} vs. New England Patriots");
  assert.match(requested.searchParams.get("localStartDateTime"), /^2026-09-09/);
  assert.equal(result.events[0].id, "vvG1HZkABC123");
  assert.equal(result.events[0].canonicalUrl, "https://www.ticketmaster.com/event/0F006482E67E7496");
  assert.equal(JSON.stringify(result).includes("test-key"), false);
});

test("Ticketmaster preserves valid range market types and does not manufacture ticket rows", () => {
  const normalized = normalizeTicketmasterEvent(discoveryEvent());
  assert.deepEqual(normalized.priceRanges, [{ currency: "USD", min: 85.5, max: 640, marketType: "unknown", maxIsCapped: false }]);
  assert.equal(normalized.currency, "USD");
  assert.equal(Object.hasOwn(normalized, "listings"), false);
  assert.equal(Object.hasOwn(normalized, "section"), false);
});

test("provider event-price publishing validates cents while dropping only malformed ranges", () => {
  const capturedAt = "2026-08-29T12:00:00.000Z";
  const prices = providerEventPricesFromRanges([
    { type: "standard", currency: "USD", min: 85.5, max: 640 },
    { type: "resale", currency: "CAD", min: 100, max: 900, maxIsCapped: true },
    { type: "broken", currency: "USD", min: 20, max: 10 },
    { type: "unsafe", currency: "USD", min: 1.001, max: 2 },
    { type: "unsupported", currency: "EUR", min: 1, max: 2 },
  ], { provider: "ticketmaster", sourceIdentifier: "event-1", capturedAt });
  assert.deepEqual(prices.map(({ marketType, currency, minCents, maxCents, maxIsCapped, priceBasis }) => ({ marketType, currency, minCents, maxCents, maxIsCapped, priceBasis })), [
    { marketType: "standard", currency: "USD", minCents: 8550, maxCents: 64000, maxIsCapped: false, priceBasis: "unknown" },
    { marketType: "resale", currency: "CAD", minCents: 10000, maxCents: 90000, maxIsCapped: true, priceBasis: "unknown" },
  ]);
  assert.equal(prices.every((price) => price.capturedAt === capturedAt && price.sourceIdentifier === "event-1"), true);
  assert.doesNotThrow(() => validateProviderEventPrice({ ...prices[0], minCents: null }));
  assert.doesNotThrow(() => validateProviderEventPrice({ ...prices[0], maxCents: null }));
  assert.throws(() => validateProviderEventPrice({ ...prices[0], capturedAt: "stale-ish" }), /timestamp/);
  assert.throws(() => validateProviderEventPrice({ ...prices[0], maxCents: 100_000_001 }), /bounded/);
});

test("Ticketmaster preserves a genuinely missing priceRanges value as no range", () => {
  const normalized = normalizeTicketmasterEvent(discoveryEvent({ priceRanges: undefined }));
  assert.deepEqual(normalized.priceRanges, []);
  assert.equal(normalized.currency, null);
});

test("Ticketmaster reports authentication and rate-limit failures with bounded codes", async () => {
  const adapter = providerRegistry().ticketmaster;
  const context = { apiKey: "test-key", eventName: "Seattle {Team} vs. New England Patriots", eventDate: "2026-09-09", legacyEventId: "0F006482E67E7496", timeoutMs: 100, maxRetries: 0, rateLimitMs: 0 };
  await assert.rejects(adapter.sync({ ...context, fetch: async () => ({ ok: false, status: 401 }) }), { code: "HTTP_401" });
  await assert.rejects(adapter.sync({ ...context, fetch: async () => ({ ok: false, status: 429 }) }), { code: "HTTP_429" });
});

const discoveryShape = (event) => ({
  id: event.id, name: event.name, url: event.canonicalUrl,
  dates: { start: { dateTime: event.startTimeUtc, localDate: event.localDate, localTime: event.localTime }, timezone: event.timeZone, status: { code: event.eventStatus } },
  _embedded: { attractions: event.attractions, venues: [{ name: event.venue.name }] },
  classifications: [{ segment: { name: "Sports" }, genre: { name: "Football" }, subGenre: { name: "NFL" } }],
});

test("Ticketmaster season discovery derives one window, paginates within bounds, and deduplicates IDs", async () => {
  const adapter = providerRegistry().ticketmaster; const requests = [];
  const pages = [[...legitimateEvents.slice(0, 9), rejectedEvents[0]], [...legitimateEvents.slice(8), ...rejectedEvents.slice(1)]];
  const result = await adapter.sync({ apiKey: "not-logged", discoveryMode: "season", attractionId: "operator-verified-test-id", games: realSchedule, timeoutMs: 100, maxRetries: 0, rateLimitMs: 0, pageSize: 10, maxPages: 3, maxRequests: 3, fetch: async (url) => {
    requests.push(url); const number = Number(url.searchParams.get("page"));
    return { ok: true, json: async () => ({ _embedded: { events: pages[number].map(discoveryShape) }, page: { number, totalPages: 2 } }) };
  } });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get("attractionId"), "operator-verified-test-id");
  assert.equal(requests[0].searchParams.has("keyword"), false);
  assert.equal(requests[0].searchParams.get("localStartDateTime"), "2026-09-09T00:00:00,2027-01-10T23:59:59");
  assert.equal(result.events.length, providerEvents.length);
  assert.equal(new Set(result.events.map(({ id }) => id)).size, result.events.length);
});

test("Ticketmaster season discovery caps provider-declared pagination and request count", async () => {
  let calls = 0;
  const result = await providerRegistry().ticketmaster.sync({ apiKey: "test", discoveryMode: "season", attractionId: "verified", games: realSchedule, timeoutMs: 100, maxRetries: 0, rateLimitMs: 0, pageSize: 1, maxPages: 20, maxRequests: 2, fetch: async () => ({ ok: true, json: async () => ({ _embedded: { events: [discoveryShape(legitimateEvents[calls++])] }, page: { number: calls - 1, totalPages: 999 } }) }) });
  assert.equal(calls, 2); assert.equal(result.events.length, 2);
});

test("Ticketmaster season discovery rejects malformed pages and honors timeout/retry/spacing settings", async () => {
  const base = { apiKey: "test", discoveryMode: "season", attractionId: "verified", games: realSchedule, timeoutMs: 10, pageSize: 10, maxPages: 2, maxRequests: 2 };
  await assert.rejects(providerRegistry().ticketmaster.sync({ ...base, maxRetries: 0, rateLimitMs: 0, fetch: async () => ({ ok: true, json: async () => ({ _embedded: { events: {} } }) }) }), { code: "INVALID_RESPONSE" });
  for (const body of [
    { _embedded: { events: [{ name: "Missing provider ID" }] } },
    { _embedded: { events: [{ id: "missing-name" }] } },
    { _embedded: { events: [] }, page: { number: -1, totalPages: 1 } },
    { _embedded: { events: [] }, page: { number: 1, totalPages: 2 } },
    { _embedded: { events: [] }, page: { number: 0, totalPages: -1 } },
  ]) await assert.rejects(providerRegistry().ticketmaster.sync({ ...base, maxRetries: 0, rateLimitMs: 0, fetch: async () => ({ ok: true, json: async () => body }) }), { code: "INVALID_RESPONSE" });
  await assert.rejects(
    providerRegistry().ticketmaster.sync({
      ...base,
      maxRetries: 0,
      rateLimitMs: 0,
      fetch: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(
                Object.assign(new Error("aborted"), {
                  name: "AbortError",
                }),
              ),
            { once: true },
          );
        }),
    }),
    { code: "REQUEST_TIMEOUT" },
  );
  let calls = 0; const sleeps = [];
  await providerRegistry().ticketmaster.sync({ ...base, maxRetries: 1, rateLimitMs: 25, sleep: async (ms) => sleeps.push(ms), random: () => 0, fetch: async () => ++calls === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => ({ _embedded: { events: [] }, page: { number: 0, totalPages: 1 } }) } });
  assert.equal(calls, 2); assert.ok(sleeps.some((ms) => ms >= 25)); assert.ok(sleeps.some((ms) => ms >= 200));
});

test("Ticketmaster season configuration is explicit and requires an operator-verified attraction ID", () => {
  const providers = JSON.stringify({ ticketmaster: { enabled: true, mode: "event-summary", pageSize: 50, maxPages: 4, maxRequests: 4 } });
  assert.throws(() => loadConfig({ TICKETS_PROVIDERS_JSON: providers, TICKETMASTER_API_KEY: "test", TICKETMASTER_DISCOVERY_MODE: "season" }, root), /operator-verified/);
  const config = loadConfig({ TICKETS_PROVIDERS_JSON: providers, TICKETMASTER_API_KEY: "test", TICKETMASTER_DISCOVERY_MODE: "season", TICKETMASTER_ATTRACTION_ID: "verified" }, root);
  assert.deepEqual([config.providers.ticketmaster.discoveryMode, config.providers.ticketmaster.attractionId, config.providers.ticketmaster.maxRequests], ["season", "verified", 4]);
  assert.deepEqual(ticketmasterSeasonWindow(realSchedule), { startDate: "2026-09-09", endDate: "2027-01-10" });
});

test("multiple similar {Team} events match only the verified legacy URL", () => {
  const similar = [
    discoveryEvent({ id: "wrong-date", dates: { start: { localDate: "2026-09-10" } } }),
    discoveryEvent({ id: "wrong-opponent", name: "Seattle {Team} vs. New York Patriots" }),
    discoveryEvent({ id: "wrong-url", url: "https://www.ticketmaster.com/event/WRONG" }),
    discoveryEvent(),
  ];
  assert.equal(matchTicketmasterEvent(similar, { eventName: "Seattle {Team} vs. New England Patriots", eventDate: "2026-09-09", legacyEventId: "0F006482E67E7496" }).id, "vvG1HZkABC123");
});

test("all canonical NFL aliases used by the schedule normalize deterministically", () => {
  const aliases = {
    SEA: "Seattle {Team}", ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens",
    BUF: "Buffalo Bills", CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals",
    CLE: "Cleveland Browns", DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions",
    GB: "Green Bay Packers", HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars",
    KC: "Kansas City Chiefs", LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams",
    MIA: "Miami Dolphins", MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints",
    NYG: "New York Giants", NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers",
    SF: "San Francisco 49ers", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders",
  };
  for (const [abbreviation, name] of Object.entries(aliases)) {
    assert.equal(normalizeNflTeam(abbreviation), abbreviation);
    assert.equal(normalizeNflTeam({ id: `tm-${abbreviation}`, name }), abbreviation);
  }
});

test("realistic normalized Ticketmaster Discovery events match the canonical schedule", (t) => {
  const matched = []; const rejected = []; const unmatched = [];
  for (const event of providerEvents) {
    const evaluations = realSchedule.map((game) => ({ game, result: evaluateProviderEvent(game, event) }));
    const publishable = evaluations.filter(({ result }) => result.publishable);
    if (publishable.length === 1) matched.push({ event, ...publishable[0] });
    else {
      const reasons = [...new Set(evaluations.flatMap(({ result }) => result.reasons))];
      if (rejectedEvents.includes(event)) rejected.push({ event, reasons });
      else unmatched.push({ event, reasons });
    }
  }

  assert.equal(matched.length, 16);
  assert.equal(rejected.length, 3);
  assert.equal(unmatched.length, 0);
  assert.deepEqual(realSchedule.filter((game) => !matched.some(({ game: found }) => found === game)).map(sfzEventKey), ["sea:2026-regular-17-away-lar"]);
  for (const { event, game, result } of matched) t.diagnostic(`${event.name} -> ${result.eventKey} -> ${game.opponent.abbreviation} -> ${game.isHome ? "home" : "away"} -> ${event.localDate} -> ${game.date} -> ${result.confidence}`);
  for (const { event, reasons } of rejected) t.diagnostic(`${event.name} -> rejected -> ${reasons.filter((reason) => ["promotional-event-shell", "travel-package", "season-ticket-interest-list"].includes(reason)).join(",")}`);
});

test("provider team arrays accept names and normalized attraction objects without weakening order", () => {
  const event = legitimateEvents[0]; const game = realSchedule[0];
  assert.equal(evaluateProviderEvent(game, { ...event, teams: event.teams.map(({ name }) => name), attractions: [] }).publishable, true);
  assert.equal(evaluateProviderEvent(game, event).evidence.homeAway, true);
  assert.equal(evaluateProviderEvent({ ...game, homeTeam: game.awayTeam, awayTeam: game.homeTeam }, event).publishable, false);
});

test("non-admission product shells remain rejected even with exact game metadata", () => {
  const event = legitimateEvents[0]; const game = realSchedule[0];
  for (const [suffix, reason] of [
    ["Parking Only", "parking-event"], ["Official Tailgate", "tailgate-package"],
    ["Travel Package", "travel-package"], ["Hospitality Only", "hospitality-only"],
    ["Deposit", "deposit-product"], ["Watch Party", "watch-party"],
  ]) assert.ok(evaluateProviderEvent(game, { ...event, id: `shell-${reason}`, name: `${event.name} | ${suffix}` }).reasons.includes(reason));
});

test("Ticketmaster UTC rollovers use the provider local game date", () => {
  const ids = ["vvG1HZ_F5JLE3p", "tm-den-away", "tm-kc-home", "tm-chi-home", "tm-dal-home", "tm-lar-home"];
  for (const id of ids) {
    const event = legitimateEvents.find((item) => item.id === id);
    const game = realSchedule.find((item) => item.date === event.localDate && [item.homeTeam, item.awayTeam].some((team) => normalizeNflTeam(team) === normalizeNflTeam(event.teams.find((team) => normalizeNflTeam(team) !== "SEA"))));
    const result = evaluateProviderEvent(game, event);
    assert.notEqual(event.startTimeUtc.slice(0, 10), event.localDate);
    assert.equal(result.evidence.date, true);
    assert.equal(result.publishable, true);
  }
});

const root = new URL("..", import.meta.url).pathname;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("StubHub remains fail-closed while its rights summary is pending", async () => {
  const adapter = providerRegistry().stubhub;
  assert.equal(adapter.approvalStatus, "pending");
  assert.equal(adapter.credentialEnv, null);
  assert.deepEqual(adapter.allowedHosts, []);
  assert.throws(
    () => loadConfig({ TICKETS_PROVIDERS_JSON: JSON.stringify({ stubhub: { enabled: true, mode: "listing-level" } }) }, root),
    /cannot be enabled until its operator-reviewed rights summary is complete/,
  );
  await assert.rejects(adapter.sync({}), { code: "RIGHTS_APPROVAL_REQUIRED" });
});

test("StubHub is reported disabled by default and makes no adapter call", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sfz-ticket-stubhub-disabled-"));
  try {
    const config = loadConfig({ TICKETS_FIXTURE: "true", TICKETS_OUTPUT_DIR: join(temporary, "snapshot") }, root);
    const status = await runTicketSync(config, { now: new Date("2026-08-29T12:00:00Z"), log: () => {} });
    const stubhub = status.providers.find(({ provider }) => provider === "stubhub");
    assert.equal(stubhub.state, "disabled");
    assert.equal(stubhub.lastAttempt, null);
    assert.deepEqual(stubhub.counts, { fresh: 0, stale: 0, rejected: 0, unmatched: 0 });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("fixture mode publishes a complete lightweight snapshot without network", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sfz-ticket-sync-"));
  try {
    const outputDir = join(temporary, "snapshot");
    const config = loadConfig({ TICKETS_FIXTURE: "true", TICKETS_GAMES_FILE: "tests/fixtures/ticket-sync-schedule.json", TICKETS_OUTPUT_DIR: outputDir }, root);
    const logs = []; const status = await runTicketSync(config, { now: new Date("2026-08-29T12:00:00Z"), finishedAt: new Date("2026-08-29T12:00:01Z"), fetch: async () => { throw new Error("fixture sync attempted a network request"); }, log: (line) => logs.push(JSON.parse(line)) });
    assert.equal(status.outcome, "success"); assert.equal(status.totals.fresh, 2); assert.equal(status.totals.unmatched, 1);
    const index = await readJson(join(outputDir, "index.json")); const event = await readJson(join(outputDir, index.events[0].eventFile));
    assert.equal(Object.hasOwn(index.events[0], "listings"), false);
    assert.equal(event.listings.admission.length, 1); assert.equal(event.listings.parking.length, 1);
    assert.equal(logs.at(-1).event, "sync_complete");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("a failed run retains the prior last-good snapshot", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sfz-ticket-recovery-"));
  try {
    const outputDir = join(temporary, "snapshot"); const config = loadConfig({ TICKETS_FIXTURE: "true", TICKETS_OUTPUT_DIR: outputDir }, root);
    await runTicketSync(config, { now: new Date("2026-08-29T12:00:00Z"), log: () => {} });
    const original = await readFile(join(outputDir, "index.json"), "utf8");
    const invalidOverrides = join(temporary, "invalid-overrides.json"); await writeFile(invalidOverrides, "{not-json", "utf8");
    await assert.rejects(runTicketSync({ ...config, overridesFile: invalidOverrides }, { now: new Date("2026-08-29T12:10:00Z"), log: () => {} }));
    assert.equal(await readFile(join(outputDir, "index.json"), "utf8"), original);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("freshness is separate from throttling and bounded by retention", () => {
  const provider = { ticketmaster: { enabled: false, mode: "event-summary", minRefreshMs: 600000, freshnessMs: 1800000, retentionMs: 3600000 } };
  const config = loadConfig({ TICKETS_PROVIDERS_JSON: JSON.stringify(provider) }, root);
  assert.deepEqual([config.providers.ticketmaster.minRefreshMs, config.providers.ticketmaster.freshnessMs, config.providers.ticketmaster.retentionMs], [600000, 1800000, 3600000]);
  assert.ok(15 * 60_000 + 2 * 60_000 < config.providers.ticketmaster.freshnessMs);
  assert.throws(() => loadConfig({ TICKETS_PROVIDERS_JSON: JSON.stringify({ ticketmaster: { ...provider.ticketmaster, freshnessMs: 500000 } }) }, root), /minRefreshMs <= freshnessMs <= retentionMs/);
});

test("lease timing and stale-artifact configuration is positive and safely bounded", () => {
  const config = loadConfig({ TICKETS_LOCK_STALE_MS: "9000", TICKETS_LOCK_HEARTBEAT_MS: "2000", TICKETS_LOCK_STALE_ARTIFACT_LIMIT: "2" }, root);
  assert.deepEqual([config.lockStaleMs, config.lockHeartbeatMs, config.lockStaleArtifactLimit], [9000, 2000, 2]);
  assert.throws(() => loadConfig({ TICKETS_LOCK_STALE_MS: "9000", TICKETS_LOCK_HEARTBEAT_MS: "3000" }, root), /less than one third/);
  assert.throws(() => loadConfig({ TICKETS_LOCK_STALE_ARTIFACT_LIMIT: "0" }, root), /at least 1/);
  assert.throws(() => loadConfig({ TICKETS_LOCK_HEARTBEAT_MS: "Infinity" }, root), /integer/);
});

test("non-fixture sync rejects missing or fictional schedule provenance", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sfz-ticket-provenance-"));
  try {
    const fixtureSchedule = await readJson(join(root, "tests/fixtures/ticket-sync-schedule.json"));
    for (const [name, schedule] of [["fixture", fixtureSchedule], ["missing", Object.fromEntries(Object.entries(fixtureSchedule).filter(([key]) => key !== "fixture"))]]) {
      const gamesFile = join(temporary, `${name}.json`); await writeFile(gamesFile, `${JSON.stringify(schedule)}\n`, "utf8");
      const config = loadConfig({ TICKETS_GAMES_FILE: gamesFile, TICKETS_OUTPUT_DIR: join(temporary, name) }, root);
      await assert.rejects(runTicketSync(config, { now: new Date("2026-08-29T12:00:00Z"), log: () => {} }), { code: "SCHEDULE_FIXTURE" });
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

const token = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const leaseOwner = ({ runToken = token("1"), startedAt = "2026-08-29T11:59:00.000Z", heartbeatAt = startedAt, pid = 1, hostname = "old-container" } = {}) => ({ schemaVersion: 1, runToken, startedAt, heartbeatAt, pid, hostname });
const putLock = async (lock, owner) => { await mkdir(lock); await writeFile(join(lock, "owner.json"), `${JSON.stringify(owner)}\n`); };

test("lease acquisition is exclusive and ignores diagnostic PID and hostname for fresh ownership", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sfz-ticket-lock-fresh-")); const lock = join(temporary, ".current.lock"); const now = Date.parse("2026-08-29T12:00:00Z");
  try {
    const first = await acquireLock(lock, now, 60_000, { runToken: token("1"), diagnostics: { pid: 1, hostname: "container-a" } });
    await assert.rejects(acquireLock(lock, now, 60_000, { runToken: token("2"), diagnostics: { pid: 1, hostname: "container-b" } }), { code: "SYNC_LOCKED" });
    assert.equal(first.runToken, token("1"));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("expired leases recover across changed container hostname and reused PID 1", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sfz-ticket-lock-stale-")); const lock = join(temporary, ".current.lock"); const now = Date.parse("2026-08-29T12:00:00Z");
  try {
    await putLock(lock, leaseOwner({ startedAt: "2026-08-29T11:00:00.000Z", pid: 1, hostname: "gone-container" }));
    const lease = await acquireLock(lock, now, 60_000, { runToken: token("2"), diagnostics: { pid: 1, hostname: "new-container" } });
    assert.equal(lease.runToken, token("2"));
    assert.equal((await readJson(join(lock, "owner.json"))).hostname, "new-container");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("malformed, tokenless, and impossible lease metadata fail closed", async () => {
  const cases = ["not-json", JSON.stringify({ ...leaseOwner(), runToken: undefined }), JSON.stringify(leaseOwner({ startedAt: "2026-08-29T12:01:00.000Z", heartbeatAt: "2026-08-29T12:01:00.000Z" })), JSON.stringify(leaseOwner({ startedAt: "2026-08-29T12:00:00.000Z", heartbeatAt: "2026-08-29T11:59:00.000Z" }))];
  for (const [index, contents] of cases.entries()) {
    const temporary = await mkdtemp(join(tmpdir(), `sfz-ticket-lock-unknown-${index}-`)); const lock = join(temporary, ".current.lock");
    try { await mkdir(lock); await writeFile(join(lock, "owner.json"), contents); await assert.rejects(acquireLock(lock, Date.parse("2026-08-29T12:00:00Z"), 60_000), { code: "SYNC_LOCK_UNKNOWN" }); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
});

test("only one stale-recovery contender acquires the replacement lease", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sfz-ticket-lock-race-")); const lock = join(temporary, ".current.lock"); const now = Date.parse("2026-08-29T12:00:00Z");
  try {
    await putLock(lock, leaseOwner({ startedAt: "2026-08-29T11:00:00.000Z" }));
    const results = await Promise.allSettled([acquireLock(lock, now, 60_000, { runToken: token("2") }), acquireLock(lock, now, 60_000, { runToken: token("3") })]);
    assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("heartbeat refreshes only its owner and old-owner release cannot remove a replacement", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sfz-ticket-lock-owner-")); const lock = join(temporary, ".current.lock"); const initial = Date.parse("2026-08-29T12:00:00Z");
  try {
    const old = await acquireLock(lock, initial, 60_000, { runToken: token("1") });
    assert.equal(await heartbeatLock(old, initial + 40_000), true);
    await assert.rejects(acquireLock(lock, initial + 90_000, 60_000, { runToken: token("2") }), { code: "SYNC_LOCKED" });
    await rm(lock, { recursive: true }); await putLock(lock, leaseOwner({ runToken: token("2"), startedAt: "2026-08-29T12:01:00.000Z", heartbeatAt: "2026-08-29T12:01:00.000Z" }));
    assert.equal(await heartbeatLock(old, initial + 60_000), false);
    assert.equal(await releaseLock(old, initial + 60_000), false);
    assert.equal((await readJson(join(lock, "owner.json"))).runToken, token("2"));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("pipeline stops the heartbeat timer after success and failure", async () => {
  for (const fail of [false, true]) {
    const temporary = await mkdtemp(join(tmpdir(), `sfz-ticket-heartbeat-${fail}-`)); let timer; let cleared = false;
    try {
      const config = loadConfig({ TICKETS_FIXTURE: "true", TICKETS_OUTPUT_DIR: join(temporary, "snapshot") }, root);
      const options = { now: new Date("2026-08-29T12:00:00Z"), clock: () => Date.parse("2026-08-29T12:00:01Z"), log: () => {}, setInterval: (callback) => { timer = { callback }; return timer; }, clearInterval: (value) => { assert.equal(value, timer); cleared = true; } };
      if (fail) await assert.rejects(runTicketSync(config, { ...options, injectFailure: async (point) => { if (point === "after-validation") throw new Error("pipeline-failed"); } }), /pipeline-failed/);
      else await runTicketSync(config, options);
      assert.equal(cleared, true); timer.callback(); await Promise.resolve();
      assert.equal(cleared, true);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
});

test("publication failures before atomic switch preserve current", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sfz-ticket-publish-"));
  try {
    const outputDir = join(temporary, "current"); const config = loadConfig({ TICKETS_FIXTURE: "true", TICKETS_OUTPUT_DIR: outputDir }, root);
    await runTicketSync(config, { now: new Date("2026-08-29T12:00:00Z"), log: () => {} });
    const original = await readFile(join(outputDir, "index.json"), "utf8");
    for (const [index, boundary] of ["after-validation", "before-version-rename", "after-version-rename", "after-pointer-create"].entries()) {
      await assert.rejects(runTicketSync(config, { now: new Date(`2026-08-29T12:0${index + 1}:00Z`), log: () => {}, injectFailure: async (point) => { if (point === boundary) throw new Error(`injected-${point}`); } }), new RegExp(`injected-${boundary}`));
      assert.equal(await readFile(join(outputDir, "index.json"), "utf8"), original);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("successful publication points current at a complete immutable version", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sfz-ticket-publish-success-"));
  try {
    const outputDir = join(temporary, "current"); const config = loadConfig({ TICKETS_FIXTURE: "true", TICKETS_OUTPUT_DIR: outputDir }, root);
    await runTicketSync(config, { now: new Date("2026-08-29T12:00:00Z"), log: () => {} });
    assert.equal((await lstat(outputDir)).isSymbolicLink(), true);
    const target = await readlink(outputDir); assert.match(target, /^\.current\.versions\//);
    const version = join(temporary, target); const index = await readJson(join(version, "index.json")); const status = await readJson(join(version, "status.json"));
    assert.equal(index.schemaVersion, "1.0.0"); assert.equal(status.outcome, "success");
    for (const event of index.events) assert.equal((await readJson(join(version, event.eventFile))).event.eventKey, event.eventKey);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
