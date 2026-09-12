import { readFile } from "node:fs/promises";
import { createProviderHttp } from "./http.mjs";

const TICKETMASTER_API = "https://app.ticketmaster.com/discovery/v2/events.json";
const TICKETMASTER_API_HOSTS = Object.freeze(["app.ticketmaster.com"]);
const TICKETMASTER_HOSTS = Object.freeze(["www.ticketmaster.com", "ticketmaster.com"]);
const TICKETMASTER_CAPABILITIES = Object.freeze({
  supportsSeatListings: false,
  supportsResaleListings: false,
  supportsPriceRange: true,
  accessTier: "discovery",
});

const comparableName = (value) => String(value ?? "").normalize("NFKD").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();

export function matchTicketmasterEvent(events, { eventName, eventDate, legacyEventId }) {
  const candidates = events.filter((event) => comparableName(event?.name) === comparableName(eventName) && event?.dates?.start?.localDate === eventDate);
  const matched = candidates.find((event) => {
    try { return new URL(event?.url).pathname.split("/").filter(Boolean).at(-1) === legacyEventId; } catch { return false; }
  });
  if (!matched) throw Object.assign(new Error("Ticketmaster event could not be verified."), { code: "EVENT_NOT_FOUND" });
  return matched;
}

function ticketmasterStatus(event) {
  return { eventStatus: event?.dates?.status?.code ?? null };
}

export function normalizeTicketmasterEvent(event) {
  const venue = event?._embedded?.venues?.[0];
  const prices = Array.isArray(event?.priceRanges) ? event.priceRanges.map((range) => ({
    currency: range?.currency, min: range?.min ?? null, max: range?.max ?? null,
    marketType: range?.type ?? "unknown", maxIsCapped: range?.maxIsCapped === true,
  })) : [];
  return {
    id: String(event.id), name: String(event.name), canonicalUrl: event.url ?? null,
    venue: venue ? { name: venue.name ?? null, city: venue.city?.name ?? null, state: venue.state?.stateCode ?? venue.state?.name ?? null } : null,
    startTimeUtc: event?.dates?.start?.dateTime ?? null, localDate: event?.dates?.start?.localDate ?? null,
    localTime: event?.dates?.start?.localTime ?? null, timeZone: event?.dates?.timezone ?? null,
    ...ticketmasterStatus(event), priceRanges: prices,
    attractions: Array.isArray(event?._embedded?.attractions) ? event._embedded.attractions.map(({ id, name }) => ({ id: String(id ?? ""), name: String(name ?? "") })) : [],
    classifications: Array.isArray(event?.classifications) ? event.classifications.map((item) => ({ segment: item?.segment?.name ?? null, genre: item?.genre?.name ?? null, subGenre: item?.subGenre?.name ?? null, type: item?.type?.name ?? null, subType: item?.subType?.name ?? null })) : [],
    currency: prices[0]?.currency ?? null,
    inventoryDetailLevel: "price_range",
  };
}

export function ticketmasterSeasonWindow(games) {
  const dates = games.map((game) => game?.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  if (!dates.length) throw Object.assign(new Error("Ticketmaster season window requires dated schedule games."), { code: "INVALID_SCHEDULE" });
  return { startDate: dates[0], endDate: dates.at(-1) };
}

const ticketmasterEvents = (body, expectedPage) => {
  const events = body?._embedded?.events ?? [];
  const invalidPage = body?.page != null && (
    !Number.isSafeInteger(body.page.number) || body.page.number < 0 || body.page.number !== expectedPage ||
    !Number.isSafeInteger(body.page.totalPages) || body.page.totalPages < 0
  );
  const invalidEvents = !Array.isArray(events) || events.some((event) =>
    !event || typeof event !== "object" || Array.isArray(event) ||
    typeof event.id !== "string" || !event.id.trim() || typeof event.name !== "string" || !event.name.trim()
  );
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      (body._embedded != null && (!body._embedded || typeof body._embedded !== "object" || Array.isArray(body._embedded))) ||
      invalidPage || invalidEvents) {
    throw Object.assign(new Error("Ticketmaster Discovery returned a malformed response."), { code: "INVALID_RESPONSE" });
  }
  return events;
};

async function syncTicketmaster(context) {
  const maxRetries = context.maxRetries ?? 2; const rateLimitMs = context.rateLimitMs ?? 250;
  const maxPages = context.maxPages ?? 5; const maxRequests = context.maxRequests ?? 5; const pageSize = context.pageSize ?? 50;
  const request = createProviderHttp({ provider: "ticketmaster", allowedHosts: TICKETMASTER_API_HOSTS, timeoutMs: context.timeoutMs, maxRetries, rateLimitMs, maxRequests }, { fetch: context.fetch, sleep: context.sleep, random: context.random });
  const season = context.discoveryMode === "season";
  const window = season ? ticketmasterSeasonWindow(context.games ?? []) : { startDate: context.eventDate, endDate: context.eventDate };
  const collected = []; let page = 0; let requests = 0;
  do {
    const url = new URL(TICKETMASTER_API);
    url.searchParams.set("apikey", context.apiKey);
    if (season) url.searchParams.set("attractionId", context.attractionId);
    else url.searchParams.set("keyword", context.eventName);
    url.searchParams.set("localStartDateTime", `${window.startDate}T00:00:00,${window.endDate}T23:59:59`);
    url.searchParams.set("size", String(season ? pageSize : 20));
    url.searchParams.set("page", String(page));
    const response = await request(url); requests += 1;
    let body;
    try { body = await response.json(); } catch { throw Object.assign(new Error("Ticketmaster Discovery returned invalid JSON."), { code: "INVALID_RESPONSE" }); }
    collected.push(...ticketmasterEvents(body, page));
    const totalPages = body.page?.totalPages ?? 1;
    page += 1;
    if (!season || page >= totalPages || page >= maxPages || requests >= maxRequests) break;
  } while (true);
  if (!season) return { events: [normalizeTicketmasterEvent(matchTicketmasterEvent(collected, context))] };
  const unique = new Map();
  for (const event of collected) if (!unique.has(event.id)) unique.set(event.id, event);
  return { events: [...unique.values()].map(normalizeTicketmasterEvent) };
}

export const PROVIDER_MODES = Object.freeze(["listing-level", "event-summary", "deep-link-only", "pending"]);

const shells = Object.freeze({
  ticketmaster: Object.freeze({
    id: "ticketmaster", approvalStatus: "approved", credentialEnv: "TICKETMASTER_API_KEY",
    capabilities: TICKETMASTER_CAPABILITIES,
    allowedHosts: TICKETMASTER_HOSTS, async sync(context) { return syncTicketmaster(context); },
  }),
  stubhub: Object.freeze({
    id: "stubhub",
    approvalStatus: "pending",
    credentialEnv: null,
    allowedHosts: [],
    async sync() { throw Object.assign(new Error("StubHub rights approval is incomplete."), { code: "RIGHTS_APPROVAL_REQUIRED" }); },
  }),
  "fixture-market": Object.freeze({
    id: "fixture-market",
    credentialEnv: null,
    allowedHosts: ["fixture-market.example.invalid"],
    async sync(context) {
      if (!context.fixture) throw Object.assign(new Error("Fixture adapter is fixture-only."), { code: "ADAPTER_PENDING" });
      return JSON.parse(await readFile(context.fixtureFile, "utf8"));
    },
  }),
});

export function providerRegistry() { return shells; }

export function configuredProviders(config) {
  return Object.entries(config.providers).map(([id, settings]) => ({ adapter: shells[id], ...settings, id }));
}
