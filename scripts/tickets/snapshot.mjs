import { validateProviderEventPrice } from "../../src/lib/tickets/provider-event-price.mjs";
import { validateMarketObservation } from "../../src/lib/tickets/market-observation.mjs";
import { eventSpyCoverageForGame } from "../../src/lib/tickets/eventspy-coverage.mjs";

const VERSION = "1.0.0";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const object = (value, path) => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object.`); return value; };
const timestamp = (value, path) => { if (typeof value !== "string" || !ISO.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError(`${path} must be an ISO UTC timestamp.`); };

export function safeEventFilename(eventKey) {
  if (!/^sea:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(eventKey)) throw new TypeError("Invalid event key.");
  return `${eventKey.replaceAll(":", "_")}.json`;
}

export function validateSnapshotFile(value, kind, allowedHosts = {}) {
  object(value, kind);
  if (value.schemaVersion !== VERSION) throw new TypeError(`${kind}.schemaVersion must be ${VERSION}.`);
  timestamp(value.generatedAt, `${kind}.generatedAt`);
  if (kind === "index") {
    if (!Array.isArray(value.events)) throw new TypeError("index.events must be an array.");
    for (const event of value.events) {
      object(event, "index.events[]");
      if (Object.hasOwn(event, "listings")) throw new TypeError("Listing arrays cannot appear in index.json.");
      if (event.eventFile !== `events/${safeEventFilename(event.eventKey)}`) throw new TypeError("Invalid index event path.");
    }
  } else if (kind === "status") {
    if (typeof value.fixture !== "boolean" || typeof value.scheduleFixture !== "boolean") throw new TypeError("Status fixture provenance must be explicit booleans.");
    if (!Array.isArray(value.providers) || !["success", "degraded"].includes(value.outcome)) throw new TypeError("Invalid status contract.");
    for (const status of value.providers) {
      if (!/^[a-z][a-z0-9-]{1,39}$/.test(status.provider)) throw new TypeError("Invalid provider id.");
      if (status.errorCode !== null && !SAFE_CODE.test(status.errorCode)) throw new TypeError("Unsafe provider error code.");
      for (const field of ["lastSuccess", "lastAttempt", "nextEligibleAttempt"]) if (status[field] !== null) timestamp(status[field], `status.${status.provider}.${field}`);
    }
  } else if (kind === "event") {
    object(value.event, "event.event");
    if (!Array.isArray(value.providerReferences) || !object(value.listings, "event.listings")) throw new TypeError("Invalid event contract.");
    for (const bucket of ["admission", "parking", "other"]) if (!Array.isArray(value.listings[bucket])) throw new TypeError(`event.listings.${bucket} must be an array.`);
    if (value.marketObservations !== undefined) {
      if (!Array.isArray(value.marketObservations)) throw new TypeError("event.marketObservations must be an array.");
      for (const observation of value.marketObservations) {
        validateMarketObservation(observation, { now: Date.parse(value.generatedAt) + 60_000 });
        if (String(observation.gameId) !== String(value.event.gameId)) throw new TypeError("Market observation game identity does not match its event.");
      }
    }
    if (value.eventSpyState !== undefined) {
      object(value.eventSpyState, "event.eventSpyState");
      const coverage = eventSpyCoverageForGame(value.event.gameId);
      if (!["current", "stale", "not_collected", "source_unavailable", "last_collection_failed"].includes(value.eventSpyState.state)) {
        throw new TypeError("Invalid public EventSpy state.");
      }
      if (value.eventSpyState.sourceUrl !== null && value.eventSpyState.sourceUrl !== coverage?.sourceUrl) {
        throw new TypeError("Invalid public EventSpy state.");
      }
    }
    for (const reference of value.providerReferences) {
      for (const field of ["canonicalUrl"]) {
        if (reference[field] === null) continue;
        const url = new URL(reference[field]);
        if (url.protocol !== "https:" || !allowedHosts[reference.provider]?.includes(url.hostname) || url.username || url.password) throw new TypeError("Provider event URL host is not allowlisted.");
        for (const key of url.searchParams.keys()) if (/token|key|secret|signature|auth/i.test(key)) throw new TypeError("Provider event URL contains a secret-like query parameter.");
      }
      if (reference.mode === "event-summary") {
        object(reference.summary, "event.providerReferences[].summary");
        object(reference.capabilities, "event.providerReferences[].capabilities");
        if (reference.capabilities.supportsSeatListings !== false || reference.capabilities.supportsResaleListings !== false || reference.capabilities.supportsPriceRange !== true || reference.capabilities.accessTier !== "discovery") throw new TypeError("Invalid Discovery provider capabilities.");
        if (reference.summary.inventoryDetailLevel !== "price_range") throw new TypeError("Event summary inventory detail must be price_range.");
        if (!Array.isArray(reference.eventPrices)) throw new TypeError("Event summary eventPrices must be an array.");
        for (const price of reference.eventPrices) {
          validateProviderEventPrice(price);
          if (price.provider !== reference.provider || price.sourceIdentifier !== reference.providerEventId) throw new TypeError("Event price source does not match its provider reference.");
        }
        timestamp(reference.fetchedAt, "event.providerReferences[].fetchedAt"); timestamp(reference.expiresAt, "event.providerReferences[].expiresAt");
      }
    }
    for (const listing of Object.values(value.listings).flat()) {
      if (!Number.isSafeInteger(listing.priceCents) || listing.priceCents < 0) throw new TypeError("Listing price must be non-negative integer cents.");
      if (listing.currency !== "USD") throw new TypeError("Unsupported listing currency.");
      if (listing.rankEligible !== !listing.stale) throw new TypeError("Stale listing ranking state is invalid.");
      if (!Array.isArray(listing.sanitizedNotes) || listing.sanitizedNotes.some((note) => /@|\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/.test(note))) throw new TypeError("Seller notes contain possible PII.");
      for (const field of ["canonicalUrl", "affiliateUrl"]) {
        if (listing[field] === null) continue;
        const url = new URL(listing[field]);
        if (url.protocol !== "https:" || !allowedHosts[listing.provider]?.includes(url.hostname) || url.username || url.password) throw new TypeError("Listing URL host is not allowlisted.");
        for (const key of url.searchParams.keys()) if (/token|key|secret|signature|auth/i.test(key)) throw new TypeError("Listing URL contains a secret-like query parameter.");
      }
      for (const forbidden of ["seller", "sellerName", "sellerEmail", "sellerPhone", "raw", "rawResponse"]) if (Object.hasOwn(listing, forbidden)) throw new TypeError(`Listing contains prohibited field ${forbidden}.`);
    }
  } else throw new TypeError(`Unknown snapshot file kind ${kind}.`);
  return value;
}

export const snapshotSchemaVersion = VERSION;
