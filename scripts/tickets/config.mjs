import { resolve, sep } from "node:path";
import { PROVIDER_MODES, providerRegistry } from "./providers.mjs";

const integer = (value, fallback, name, minimum = 0) => {
  const result = value == null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new Error(`${name} must be an integer of at least ${minimum}.`);
  return result;
};

function providerSettings(raw, fixture) {
  if (raw == null || raw === "") return fixture ? { "fixture-market": { enabled: true, mode: "listing-level" } } : {};
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error("TICKETS_PROVIDERS_JSON must be valid JSON."); }
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("TICKETS_PROVIDERS_JSON must be an object.");
  return value;
}

const ticketmasterDiscoveryMode = (env) => {
  const mode = env.TICKETMASTER_DISCOVERY_MODE || "single-event";
  if (!["single-event", "season"].includes(mode)) throw new Error("TICKETMASTER_DISCOVERY_MODE must be single-event or season.");
  return mode;
};

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const environment = env.TICKETS_ENV || "development";
  if (!["development", "production"].includes(environment)) throw new Error("TICKETS_ENV must be development or production.");
  const fixture = env.TICKETS_FIXTURE === "true";
  const outputValue = env[`TICKETS_OUTPUT_DIR_${environment.toUpperCase()}`] || env.TICKETS_OUTPUT_DIR || "runtime/tickets/current";
  const outputDir = resolve(cwd, outputValue);
  const forbidden = [resolve(cwd, "src", "data"), resolve(cwd, "dist")];
  if (forbidden.some((root) => outputDir === root || outputDir.startsWith(`${root}${sep}`))) throw new Error("Ticket output cannot be inside src/data or dist.");
  if (environment === "production" && !env.TICKETS_OUTPUT_DIR_PRODUCTION && !env.TICKETS_OUTPUT_DIR) throw new Error("Production requires an explicit ticket output directory.");
  const rawProviders = providerSettings(env.TICKETS_PROVIDERS_JSON, fixture);
  const registry = providerRegistry();
  const providers = {};
  for (const [id, raw] of Object.entries(rawProviders)) {
    if (!registry[id]) throw new Error(`Unknown ticket provider ${id}.`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Provider ${id} configuration must be an object.`);
    const enabled = raw.enabled === true;
    const mode = raw.mode || "pending";
    if (!PROVIDER_MODES.includes(mode)) throw new Error(`Provider ${id} has an invalid mode.`);
    if (enabled && registry[id].approvalStatus === "pending") throw new Error(`Provider ${id} cannot be enabled until its operator-reviewed rights summary is complete.`);
    if (enabled && mode === "pending") throw new Error(`Provider ${id} cannot be enabled while pending.`);
    if (enabled && registry[id].credentialEnv && !env[registry[id].credentialEnv]) throw new Error(`Provider ${id} requires ${registry[id].credentialEnv}.`);
    providers[id] = {
      enabled, mode,
      minRefreshMs: integer(raw.minRefreshMs, id === "ticketmaster" ? 600_000 : 300_000, `${id}.minRefreshMs`, 1_000),
      freshnessMs: integer(raw.freshnessMs, id === "ticketmaster" ? 1_800_000 : 900_000, `${id}.freshnessMs`, 1_000),
      retentionMs: integer(raw.retentionMs, 3_600_000, `${id}.retentionMs`, 0),
      timeoutMs: integer(raw.timeoutMs, 8_000, `${id}.timeoutMs`, 100),
      maxRetries: integer(raw.maxRetries, 2, `${id}.maxRetries`, 0),
      rateLimitMs: integer(raw.rateLimitMs, 250, `${id}.rateLimitMs`, 0),
      pageSize: integer(raw.pageSize, 50, `${id}.pageSize`, 1),
      maxPages: integer(raw.maxPages, 5, `${id}.maxPages`, 1),
      maxRequests: integer(raw.maxRequests, 5, `${id}.maxRequests`, 1),
      apiKey: registry[id].credentialEnv ? env[registry[id].credentialEnv] : null,
      discoveryMode: id === "ticketmaster" ? ticketmasterDiscoveryMode(env) : null,
      attractionId: id === "ticketmaster" ? (env.TICKETMASTER_ATTRACTION_ID?.trim() || null) : null,
      eventName: id === "ticketmaster" ? (env.TICKETMASTER_EVENT_NAME || "Seattle {Team} vs. New England Patriots") : null,
      eventDate: id === "ticketmaster" ? (env.TICKETMASTER_EVENT_DATE || "2026-09-09") : null,
      legacyEventId: id === "ticketmaster" ? (env.TICKETMASTER_LEGACY_EVENT_ID || "0F006482E67E7496") : null,
    };
    if (id === "ticketmaster" && providers[id].pageSize > 200) throw new Error("ticketmaster.pageSize must not exceed 200.");
    if (id === "ticketmaster" && providers[id].maxPages > 20) throw new Error("ticketmaster.maxPages must not exceed 20.");
    if (id === "ticketmaster" && providers[id].maxRequests > 20) throw new Error("ticketmaster.maxRequests must not exceed 20.");
    if (enabled && id === "ticketmaster" && providers[id].discoveryMode === "season" && (!providers[id].attractionId || /^REPLACE_|PLACEHOLDER$/i.test(providers[id].attractionId))) throw new Error("Ticketmaster season mode requires operator-verified TICKETMASTER_ATTRACTION_ID.");
  }
  for (const [id, provider] of Object.entries(providers)) if (provider.minRefreshMs > provider.freshnessMs || provider.freshnessMs > provider.retentionMs) throw new Error(`${id} requires minRefreshMs <= freshnessMs <= retentionMs.`);
  for (const id of Object.keys(registry)) if (!providers[id]) providers[id] = { enabled: false, mode: "pending", minRefreshMs: 300_000, freshnessMs: 900_000, retentionMs: 0, timeoutMs: 8_000, maxRetries: 2, rateLimitMs: 250, pageSize: 50, maxPages: 5, maxRequests: 5, apiKey: null, discoveryMode: null, attractionId: null, eventName: null, eventDate: null, legacyEventId: null };
  const lockStaleMs = integer(env.TICKETS_LOCK_STALE_MS, 1_800_000, "TICKETS_LOCK_STALE_MS", 1);
  const lockHeartbeatMs = integer(env.TICKETS_LOCK_HEARTBEAT_MS, 60_000, "TICKETS_LOCK_HEARTBEAT_MS", 1);
  const lockStaleArtifactLimit = integer(env.TICKETS_LOCK_STALE_ARTIFACT_LIMIT, 3, "TICKETS_LOCK_STALE_ARTIFACT_LIMIT", 1);
  if (lockHeartbeatMs * 3 >= lockStaleMs) throw new Error("TICKETS_LOCK_HEARTBEAT_MS must be safely shorter than TICKETS_LOCK_STALE_MS (less than one third).");
  return {
    environment, fixture, outputDir,
    eventSpyHistoryRoot: resolve(cwd, env.EVENTSPY_HISTORY_ROOT || env.EVENTSPY_HISTORY_DIR || "runtime/eventspy"),
    gamesFile: resolve(cwd, env.TICKETS_GAMES_FILE || "src/data/nfl/{team}.json"),
    overridesFile: resolve(cwd, env.TICKETS_OVERRIDES_FILE || "src/data/tickets/match-overrides.json"),
    fixtureFile: resolve(cwd, env.TICKETS_FIXTURE_FILE || "scripts/tickets/fixtures/provider.json"),
    lockStaleMs, lockHeartbeatMs, lockStaleArtifactLimit,
    providers,
  };
}
