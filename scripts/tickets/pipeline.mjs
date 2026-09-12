import { mkdir, readFile, readdir, rename, rm, stat, writeFile, lstat, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { normalizeSchedule } from "../../src/lib/schedule.mjs";
import { evaluateProviderEvent, sfzEventKey, validateMatchOverrides } from "../../src/lib/tickets/match.mjs";
import { configuredProviders } from "./providers.mjs";
import { eventSummaryAdapterPayload, listingAdapterPayload } from "./listing-adapter.mjs";
import { safeEventFilename, snapshotSchemaVersion, validateSnapshotFile } from "./snapshot.mjs";
import { providerEventPricesFromRanges } from "../../src/lib/tickets/provider-event-price.mjs";
import { readEventSpyHistoryForGame } from "./eventspy-history.mjs";
import { eventSpyCoverageForGame } from "../../src/lib/tickets/eventspy-coverage.mjs";

const safeCode = (error) => /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code) ? error.code : "PROVIDER_FAILED";
const iso = (ms) => new Date(ms).toISOString();
const log = (sink, level, event, fields = {}) => sink(JSON.stringify({ level, event, ...fields }));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
// Published snapshots are public HTTP data. Keep them owner-writable but
// readable by the unrelated Nginx container UID; credentials never enter this
// validated contract or output tree.
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });

const lockSchemaVersion = 1;
const lockFields = ["heartbeatAt", "hostname", "pid", "runToken", "schemaVersion", "startedAt"];
const lockTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const lockError = (message, code) => Object.assign(new Error(message), { code });

function validateLockOwner(value, nowMs) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== lockSchemaVersion ||
      Object.keys(value).sort().join(",") !== lockFields.join(",") ||
      typeof value.runToken !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.runToken) ||
      !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.hostname !== "string" || !value.hostname.trim() || value.hostname.length > 255 ||
      typeof value.startedAt !== "string" || !lockTimestamp.test(value.startedAt) || typeof value.heartbeatAt !== "string" || !lockTimestamp.test(value.heartbeatAt)) {
    throw lockError("Ticket sync lock ownership cannot be verified.", "SYNC_LOCK_UNKNOWN");
  }
  const startedAt = Date.parse(value.startedAt); const heartbeatAt = Date.parse(value.heartbeatAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(heartbeatAt) || startedAt > heartbeatAt || heartbeatAt > nowMs) {
    throw lockError("Ticket sync lock lease timestamps cannot be verified.", "SYNC_LOCK_UNKNOWN");
  }
  return { ...value, startedAtMs: startedAt, heartbeatAtMs: heartbeatAt };
}

const lockOwner = (runToken, nowMs, diagnostics = {}) => ({
  schemaVersion: lockSchemaVersion, runToken, startedAt: iso(nowMs), heartbeatAt: iso(nowMs),
  pid: diagnostics.pid ?? process.pid, hostname: diagnostics.hostname ?? hostname(),
});

async function readLockOwner(path, nowMs) {
  try { return validateLockOwner(await json(path), nowMs); }
  catch (error) { if (error.code === "SYNC_LOCK_UNKNOWN") throw error; throw lockError("Ticket sync lock metadata is missing, unreadable, or malformed.", "SYNC_LOCK_UNKNOWN"); }
}

async function cleanupStaleLockArtifacts(lockDir, limit) {
  const parent = dirname(lockDir); const prefix = `${basename(lockDir)}.stale-`;
  const entries = (await readdir(parent, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix)).sort((a, b) => b.name.localeCompare(a.name));
  for (const entry of entries.slice(limit)) await rm(join(parent, entry.name), { recursive: true, force: true });
}

async function acquireLock(lockDir, nowMs, staleMs, options = {}) {
  const ownerFile = join(lockDir, "owner.json");
  const runToken = options.runToken ?? randomUUID();
  const owner = lockOwner(runToken, nowMs, options.diagnostics);
  let created = false;
  try { await mkdir(lockDir); created = true; } catch (error) { if (error.code !== "EEXIST") throw error; }
  if (created) {
    try { await writeFile(ownerFile, `${JSON.stringify(owner, null, 2)}\n`, { flag: "wx", mode: 0o600 }); return { lockDir, runToken }; }
    catch (error) { await rm(lockDir, { recursive: true, force: true }).catch(() => {}); throw error; }
  }
  const existing = await readLockOwner(ownerFile, nowMs);
  if (nowMs - existing.heartbeatAtMs <= staleMs) throw lockError("Another ticket sync is active.", "SYNC_LOCKED");
  const claim = `${lockDir}.stale-${String(nowMs).padStart(16, "0")}-${runToken}`;
  try { await rename(lockDir, claim); } catch (error) {
    if (["ENOENT", "EEXIST", "ENOTEMPTY"].includes(error.code)) throw lockError("Ticket sync stale-lock recovery lost a race.", "SYNC_LOCK_UNKNOWN");
    throw error;
  }
  let claimed;
  try { claimed = await readLockOwner(join(claim, "owner.json"), nowMs); }
  catch (error) { await rename(claim, lockDir).catch(() => {}); throw error; }
  if (claimed.runToken !== existing.runToken || nowMs - claimed.heartbeatAtMs <= staleMs) {
    await rename(claim, lockDir).catch(() => {});
    throw lockError("Ticket sync stale-lock recovery evidence changed.", "SYNC_LOCK_UNKNOWN");
  }
  try { await mkdir(lockDir); }
  catch (error) { if (error.code === "EEXIST") throw lockError("Ticket sync stale-lock recovery lost a race.", "SYNC_LOCK_UNKNOWN"); throw error; }
  try { await writeFile(ownerFile, `${JSON.stringify(owner, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
  catch (error) { await rm(lockDir, { recursive: true, force: true }).catch(() => {}); throw error; }
  try { await cleanupStaleLockArtifacts(lockDir, options.artifactLimit ?? 3); }
  catch (error) { await releaseLock({ lockDir, runToken }, nowMs).catch(() => {}); throw error; }
  return { lockDir, runToken };
}

async function heartbeatLock(lease, nowMs) {
  const ownerFile = join(lease.lockDir, "owner.json"); const existing = await readLockOwner(ownerFile, nowMs);
  if (existing.runToken !== lease.runToken) return false;
  const next = { schemaVersion: lockSchemaVersion, runToken: lease.runToken, startedAt: existing.startedAt, heartbeatAt: iso(nowMs), pid: existing.pid, hostname: existing.hostname };
  const temporary = join(lease.lockDir, `.owner-${lease.runToken}.tmp`);
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  try {
    const current = await readLockOwner(ownerFile, nowMs);
    if (current.runToken !== lease.runToken) return false;
    await rename(temporary, ownerFile); return true;
  } finally { await rm(temporary, { force: true }); }
}

async function releaseLock(lease, nowMs = Date.now()) {
  let existing;
  try { existing = await readLockOwner(join(lease.lockDir, "owner.json"), nowMs); }
  catch (error) { if (error.code === "SYNC_LOCK_UNKNOWN") return false; throw error; }
  if (existing.runToken !== lease.runToken) return false;
  const claim = `${lease.lockDir}.release-${lease.runToken}`;
  try { await rename(lease.lockDir, claim); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  let claimed;
  try { claimed = await readLockOwner(join(claim, "owner.json"), nowMs); }
  catch { await rename(claim, lease.lockDir).catch(() => {}); return false; }
  if (claimed.runToken !== lease.runToken) { await rename(claim, lease.lockDir).catch(() => {}); return false; }
  await rm(claim, { recursive: true, force: true });
  return true;
}

function startLockHeartbeat(lease, intervalMs, options = {}) {
  const clock = options.clock ?? Date.now; const setTimer = options.setInterval ?? setInterval; const clearTimer = options.clearInterval ?? clearInterval;
  let stopped = false; let failure = null; let pending = Promise.resolve();
  const beat = () => { pending = pending.then(async () => {
    if (stopped) return;
    if (!await heartbeatLock(lease, clock())) throw lockError("Ticket sync lease ownership was lost.", "SYNC_LOCK_UNKNOWN");
  }).catch((error) => { failure = error; }); };
  const timer = setTimer(beat, intervalMs); timer?.unref?.();
  return {
    check() { if (failure) throw failure; },
    async stop() { stopped = true; clearTimer(timer); await pending; if (failure) throw failure; },
  };
}

async function publishSnapshot(outputDir, stage, versionId, inject = async () => {}, retentionMs = 0, nowMs = Date.now()) {
  const parent = dirname(outputDir); const name = basename(outputDir);
  const versions = join(parent, `.${name}.versions`); const version = join(versions, versionId);
  await mkdir(versions, { recursive: true });
  await inject("before-version-rename");
  await rename(stage, version);
  await inject("after-version-rename");
  const pointer = join(parent, `.${name}.pointer-${process.pid}-${versionId}`);
  await symlink(join(`.${name}.versions`, versionId), pointer);
  await inject("after-pointer-create");
  try {
    const info = await lstat(outputDir);
    if (!info.isSymbolicLink()) {
      const legacy = join(versions, `legacy-${versionId}`);
      await rename(outputDir, legacy);
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await rename(pointer, outputDir);
  await inject("after-pointer-switch");
  const entries = (await readdir(versions, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => b.name.localeCompare(a.name));
  for (const [index, entry] of entries.entries()) {
    const path = join(versions, entry.name); const info = await stat(path);
    if (index >= 3 || (retentionMs >= 0 && nowMs - info.mtimeMs > retentionMs)) await rm(path, { recursive: true });
  }
}

function sanitizeNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes.map((note) => String(note).replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted]").replace(/\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, "[redacted]").replace(/[\r\n\t]+/g, " ").trim().slice(0, 240)).filter(Boolean).slice(0, 4);
}

function listing(raw, provider, event, now) {
  if (!String(raw.id || "").trim()) throw new TypeError("Listing id is required.");
  if (!Number.isSafeInteger(raw.priceCents) || raw.priceCents < 0) throw new TypeError("Invalid price.");
  if (raw.currency !== "USD") throw new TypeError("Unsupported currency.");
  for (const field of ["canonicalUrl", "affiliateUrl"]) {
    if (raw[field] == null && field === "affiliateUrl") continue;
    const url = new URL(raw[field]);
    if (url.protocol !== "https:" || !provider.adapter.allowedHosts.includes(url.hostname) || url.username || url.password) throw new TypeError("Invalid listing URL.");
    for (const key of url.searchParams.keys()) if (/token|key|secret|signature|auth/i.test(key)) throw new TypeError("Secret-like listing URL.");
  }
  const type = raw.productType === "parking" ? "parking" : raw.productType === "admission" ? "admission" : "other";
  return {
    provider: provider.id, providerListingId: String(raw.id || ""), productType: type,
    section: raw.section == null ? null : String(raw.section).slice(0, 80),
    row: raw.row == null ? null : String(raw.row).slice(0, 40),
    allowedQuantities: Array.isArray(raw.allowedQuantities) ? [...new Set(raw.allowedQuantities.filter((n) => Number.isSafeInteger(n) && n > 0 && n <= 20))].sort((a, b) => a - b) : [],
    currency: raw.currency, priceCents: raw.priceCents, feeStatus: ["all-in", "estimated", "unknown"].includes(raw.feeStatus) ? raw.feeStatus : "unknown",
    sanitizedNotes: sanitizeNotes(raw.notes), canonicalUrl: raw.canonicalUrl, affiliateUrl: raw.affiliateUrl ?? null,
    fetchedAt: now, expiresAt: iso(Date.parse(now) + provider.freshnessMs), stale: false, rankEligible: true,
  };
}

async function previousSnapshot(outputDir) {
  try {
    const status = await json(join(outputDir, "status.json"));
    const events = {};
    for (const name of await readdir(join(outputDir, "events"))) if (name.endsWith(".json")) { const value = await json(join(outputDir, "events", name)); events[value.event.eventKey] = value; }
    return { status, events };
  } catch { return { status: null, events: {} }; }
}

function priorProviderData(previous, providerId, nowMs, retentionMs, stale) {
  const status = previous.status?.providers?.find((item) => item.provider === providerId);
  if (!status?.lastSuccess || nowMs - Date.parse(status.lastSuccess) > retentionMs) return { status, events: [] };
  const events = Object.values(previous.events).map((event) => ({
    eventKey: event.event.eventKey,
    reference: event.providerReferences.find((ref) => ref.provider === providerId),
    listings: Object.values(event.listings).flat().filter((item) => item.provider === providerId).map((item) => ({ ...item, stale, rankEligible: !stale })),
  })).filter((event) => event.reference || event.listings.length);
  return { status, events };
}

export async function runTicketSync(config, options = {}) {
  const started = options.now?.getTime?.() ?? Date.now();
  const now = iso(started); const sink = options.log ?? console.log;
  const parent = dirname(config.outputDir); const name = basename(config.outputDir);
  const lockDir = join(parent, `.${name}.lock`); const stage = join(parent, `.${name}.tmp-${process.pid}-${started}`);
  await mkdir(parent, { recursive: true });
  const lease = await acquireLock(lockDir, started, config.lockStaleMs, { artifactLimit: config.lockStaleArtifactLimit, runToken: options.runToken, diagnostics: options.lockDiagnostics });
  const heartbeat = startLockHeartbeat(lease, config.lockHeartbeatMs, { clock: options.clock, setInterval: options.setInterval, clearInterval: options.clearInterval });
  let pipelineFailure = null;
  try {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name);
      if (entry.isDirectory() && entry.name.startsWith(`.${name}.tmp-`) && path !== stage) {
        const info = await stat(path); if (started - info.mtimeMs > config.lockStaleMs) await rm(path, { recursive: true });
      } else if (entry.isSymbolicLink() && entry.name.startsWith(`.${name}.pointer-`)) {
        const info = await lstat(path); if (started - info.mtimeMs > config.lockStaleMs) await rm(path);
      }
    }
    const [rawGames, overrides, previous] = await Promise.all([json(config.gamesFile), json(config.overridesFile).then(validateMatchOverrides), previousSnapshot(config.outputDir)]);
    if (!config.fixture && rawGames.fixture !== false) throw Object.assign(new Error("Non-fixture sync requires a schedule explicitly marked fixture:false."), { code: "SCHEDULE_FIXTURE" });
    const games = normalizeSchedule(rawGames).games.filter((game) => ["upcoming", "tbd", "postponed"].includes(game.state) && !game.bye && game.opponentConfirmed);
    const eventMap = new Map(games.map((game) => [sfzEventKey(game), { game, references: [], listings: [] }]));
    const providerStatuses = []; const allowedHosts = {}; let degraded = false;
    for (const provider of configuredProviders(config)) {
      allowedHosts[provider.id] = provider.adapter.allowedHosts;
      if (!provider.enabled) { const disabled = { provider: provider.id, mode: provider.mode, state: "disabled", errorCode: null, lastSuccess: null, lastAttempt: null, nextEligibleAttempt: null, matchedEventSummaries: 0, counts: { fresh: 0, stale: 0, rejected: 0, unmatched: 0 } }; providerStatuses.push(disabled); log(sink, "info", "provider_complete", { provider: provider.id, state: disabled.state, counts: disabled.counts }); continue; }
      const prior = previous.status?.providers?.find((item) => item.provider === provider.id);
      const eligibleAt = prior?.lastAttempt ? Date.parse(prior.lastAttempt) + provider.minRefreshMs : 0;
      if (eligibleAt > started) {
        const cached = priorProviderData(previous, provider.id, started, provider.retentionMs, false);
        for (const item of cached.events) { const target = eventMap.get(item.eventKey); if (target) { if (item.reference) target.references.push({ ...item.reference, state: "cached" }); target.listings.push(...item.listings); } }
        providerStatuses.push({ ...prior, state: "cached", nextEligibleAttempt: iso(eligibleAt), matchedEventSummaries: prior.matchedEventSummaries ?? cached.events.filter(({ reference }) => reference?.mode === "event-summary").length }); log(sink, "info", "provider_complete", { provider: provider.id, state: "cached", counts: prior.counts }); continue;
      }
      const counts = { fresh: 0, stale: 0, rejected: 0, unmatched: 0 }; const rejectedEvents = []; const unmatchedEvents = [];
      try {
        const rawPayload = await provider.adapter.sync({ fixture: config.fixture, fixtureFile: config.fixtureFile, apiKey: provider.apiKey, discoveryMode: provider.discoveryMode, attractionId: provider.attractionId, eventName: provider.eventName, eventDate: provider.eventDate, legacyEventId: provider.legacyEventId, games, timeoutMs: provider.timeoutMs, maxRetries: provider.maxRetries, rateLimitMs: provider.rateLimitMs, pageSize: provider.pageSize, maxPages: provider.maxPages, maxRequests: provider.maxRequests, fetch: options.fetch, sleep: options.sleep, random: options.random });
        const payload = provider.mode === "listing-level" ? listingAdapterPayload(rawPayload) : eventSummaryAdapterPayload(rawPayload);
        const additions = [];
        for (const rawEvent of payload.events.slice(0, 100)) {
          const evaluated = games.map((game) => ({ game, result: evaluateProviderEvent(game, { ...rawEvent, provider: provider.id }, { provider: provider.id, overrides }) }));
          const candidates = evaluated.filter(({ result }) => result.publishable);
          if (candidates.length !== 1) {
            const reasons = [...new Set(evaluated.flatMap(({ result }) => result.reasons))];
            if (reasons.some((reason) => ["promotional-event-shell", "travel-package", "season-ticket-interest-list", "parking-event", "tailgate-package", "hospitality-only", "watch-party", "deposit-product"].includes(reason))) { counts.rejected += 1; rejectedEvents.push({ providerEventId: String(rawEvent.id ?? ""), name: String(rawEvent.name ?? "").slice(0, 160), reasons }); }
            else { counts.unmatched += 1; unmatchedEvents.push({ providerEventId: String(rawEvent.id ?? ""), name: String(rawEvent.name ?? "").slice(0, 160), reasons }); }
            continue;
          }
          const { game, result } = candidates[0];
          if (rawEvent.canonicalUrl != null) {
            const eventUrl = new URL(rawEvent.canonicalUrl);
            if (eventUrl.protocol !== "https:" || !provider.adapter.allowedHosts.includes(eventUrl.hostname) || eventUrl.username || eventUrl.password) throw Object.assign(new Error("Invalid provider event URL."), { code: "INVALID_RESPONSE" });
            for (const key of eventUrl.searchParams.keys()) if (/token|key|secret|signature|auth/i.test(key)) throw Object.assign(new Error("Secret-like provider event URL."), { code: "INVALID_RESPONSE" });
          }
          const providerEventId = String(rawEvent.id);
          const addition = { eventKey: result.eventKey, reference: { provider: provider.id, providerEventId, mode: provider.mode, matchConfidence: result.confidence, canonicalUrl: rawEvent.canonicalUrl ?? null, state: "fresh", fetchedAt: now, expiresAt: iso(started + provider.freshnessMs), capabilities: provider.adapter.capabilities ?? null, eventPrices: provider.mode === "event-summary" ? providerEventPricesFromRanges(rawEvent.priceRanges, { provider: provider.id, sourceIdentifier: providerEventId, capturedAt: now, priceBasis: "unknown" }) : [], summary: provider.mode === "event-summary" ? { name: rawEvent.name, venue: rawEvent.venue, startTimeUtc: rawEvent.startTimeUtc, localDate: rawEvent.localDate, localTime: rawEvent.localTime, timeZone: rawEvent.timeZone, eventStatus: rawEvent.eventStatus, inventoryDetailLevel: rawEvent.inventoryDetailLevel } : null }, listings: [] };
          if (provider.mode === "listing-level") for (const rawListing of (rawEvent.listings || []).slice(0, 2_000)) {
            try { addition.listings.push(listing(rawListing, provider, game, now)); counts.fresh += 1; } catch { counts.rejected += 1; }
          }
          additions.push(addition);
        }
        const ambiguousKeys = new Set(additions.map(({ eventKey }) => eventKey).filter((key, index, all) => all.indexOf(key) !== index));
        for (const addition of additions) {
          if (ambiguousKeys.has(addition.eventKey)) { counts.rejected += 1; rejectedEvents.push({ providerEventId: addition.reference.providerEventId, name: addition.reference.summary?.name ?? "", reasons: ["multiple-high-confidence-candidates"] }); continue; }
          const target = eventMap.get(addition.eventKey); target.references.push(addition.reference); target.listings.push(...addition.listings);
        }
        providerStatuses.push({ provider: provider.id, mode: provider.mode, state: "success", errorCode: null, lastSuccess: now, lastAttempt: now, nextEligibleAttempt: iso(started + provider.minRefreshMs), matchedEventSummaries: additions.filter((addition) => !ambiguousKeys.has(addition.eventKey) && addition.reference.mode === "event-summary").length, counts, rejectedEvents, unmatchedEvents });
        log(sink, "info", "provider_complete", { provider: provider.id, state: "success", counts });
      } catch (error) {
        degraded = true; const retained = priorProviderData(previous, provider.id, started, provider.retentionMs, true);
        for (const item of retained.events) { const target = eventMap.get(item.eventKey); if (target) { if (item.reference) target.references.push({ ...item.reference, state: "stale", expiresAt: iso(Date.parse(retained.status.lastSuccess) + provider.retentionMs) }); target.listings.push(...item.listings); counts.stale += item.listings.length; } }
        const hasRetained = retained.events.length > 0;
        providerStatuses.push({ provider: provider.id, mode: provider.mode, state: hasRetained ? "stale" : "error", errorCode: safeCode(error), lastSuccess: retained.status?.lastSuccess ?? null, lastAttempt: now, nextEligibleAttempt: iso(started + provider.minRefreshMs), matchedEventSummaries: retained.events.filter(({ reference }) => reference?.mode === "event-summary").length, counts });
        log(sink, "warn", "provider_complete", { provider: provider.id, state: hasRetained ? "stale" : "error", errorCode: safeCode(error), counts });
      }
    }
    await mkdir(join(stage, "events"), { recursive: true });
    const indexEvents = [];
    for (const [eventKey, data] of eventMap) {
      const game = data.game; const grouped = { admission: [], parking: [], other: [] };
      for (const item of data.listings) grouped[item.productType].push(item);
      const mapping=eventSpyCoverageForGame(game.id),priorObservations=previous.events[eventKey]?.marketObservations,priorState=previous.events[eventKey]?.eventSpyState;
      let marketObservations=[],eventSpyState={state:"not_collected",sourceUrl:mapping?.sourceUrl??null,sourceEventId:mapping?.sourceEventId??null,reasonCode:null,lastObservedAt:null};
      if(mapping?.state==="unavailable")eventSpyState={...eventSpyState,state:"source_unavailable",reasonCode:mapping.reasonCode};
      else if(mapping?.state==="authorized")try{const history=await readEventSpyHistoryForGame(config.eventSpyHistoryRoot,mapping,{now:started});marketObservations=history.observations;eventSpyState={...eventSpyState,state:marketObservations.length?"current":"not_collected",lastObservedAt:marketObservations.at(-1)?.sourcePointAt??marketObservations.at(-1)?.seriesPoint.observedAt??null}}catch{if(Array.isArray(priorObservations)&&priorObservations.length){marketObservations=priorObservations;eventSpyState={...eventSpyState,state:"last_collection_failed",lastObservedAt:priorState?.lastObservedAt??priorObservations.at(-1).seriesPoint.observedAt}}}
      const eventFile = { schemaVersion: snapshotSchemaVersion, generatedAt: now, event: { eventKey, gameId: game.id, season: game.season, phase: game.phase, week: game.week, startsAt: game.startsAt, date: game.date, homeAway: game.isHome ? "home" : "away", opponent: { abbreviation: game.opponent.abbreviation, name: game.opponent.full_name ?? game.opponent.name }, venue: game.venue }, providerReferences: data.references, eventSpyState, marketObservations, listings: grouped };
      validateSnapshotFile(eventFile, "event", allowedHosts); const filename = safeEventFilename(eventKey); await writeJson(join(stage, "events", filename), eventFile);
      indexEvents.push({ eventKey, gameId: game.id, startsAt: game.startsAt, date: game.date, opponent: eventFile.event.opponent, homeAway: eventFile.event.homeAway, counts: { admission: grouped.admission.length, parking: grouped.parking.length, other: grouped.other.length }, eventFile: `events/${filename}` });
      log(sink, "info", "event_complete", { eventKey, admission: grouped.admission.length, parking: grouped.parking.length, other: grouped.other.length });
    }
    const durationMs = Math.max(0, (options.finishedAt?.getTime?.() ?? Date.now()) - started);
    const totals = providerStatuses.reduce((all, item) => { for (const key of Object.keys(all)) all[key] += item.counts[key]; return all; }, { fresh: 0, stale: 0, rejected: 0, unmatched: 0 });
    const outcome = degraded ? "degraded" : "success";
    const index = { schemaVersion: snapshotSchemaVersion, generatedAt: now, outcome, events: indexEvents };
    const status = { schemaVersion: snapshotSchemaVersion, generatedAt: now, outcome, environment: config.environment, fixture: config.fixture, scheduleFixture: rawGames.fixture === true, durationMs, totals, providers: providerStatuses };
    validateSnapshotFile(index, "index"); validateSnapshotFile(status, "status"); await writeJson(join(stage, "index.json"), index); await writeJson(join(stage, "status.json"), status);
    validateSnapshotFile(await json(join(stage, "index.json")), "index"); validateSnapshotFile(await json(join(stage, "status.json")), "status");
    for (const filename of await readdir(join(stage, "events"))) validateSnapshotFile(await json(join(stage, "events", filename)), "event", allowedHosts);
    await (options.injectFailure?.("after-validation") ?? Promise.resolve()); heartbeat.check();
    const maximumRetentionMs = Math.max(0, ...Object.values(config.providers).map((provider) => provider.retentionMs));
    await publishSnapshot(config.outputDir, stage, `${started}-${process.pid}`, options.injectFailure, maximumRetentionMs, started);
    log(sink, "info", "sync_complete", { outcome, events: indexEvents.length, durationMs, ...totals });
    return status;
  } catch (error) { pipelineFailure = error; throw error; }
  finally {
    let cleanupFailure = null;
    try { await heartbeat.stop(); } catch (error) { cleanupFailure = error; }
    try { await rm(stage, { recursive: true, force: true }); } catch (error) { cleanupFailure ??= error; }
    try { await releaseLock(lease, options.clock?.() ?? Date.now()); } catch (error) { cleanupFailure ??= error; }
    if (!pipelineFailure && cleanupFailure) throw cleanupFailure;
  }
}

export { acquireLock, heartbeatLock, releaseLock, startLockHeartbeat, publishSnapshot };
