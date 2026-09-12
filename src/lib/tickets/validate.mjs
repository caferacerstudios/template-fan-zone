import { safeProviderUrl } from "./outbound-links.mjs";

const SOURCE_KINDS = ["official-primary", "verified-resale", "resale-marketplace", "event-summary", "deep-link", "other-approved"];
const LISTING_SOURCE_KINDS = ["official-primary", "verified-resale", "resale-marketplace", "other-approved"];
const PROVIDER_STATUSES = ["connected-listings", "event-summary", "deep-link-only", "pending", "disabled", "stale", "error"];
const FEE_COMPLETENESS = ["all_in", "provider_reported_all_in", "estimated", "unknown"];
const PRODUCT_TYPES = ["admission", "parking", "hospitality", "tailgate"];
const SAFE_ERROR_CODES = /^[A-Z][A-Z0-9_]{1,63}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const PROVIDER_ID = /^[a-z][a-z0-9-]{1,39}$/;
const FORBIDDEN_KEYS = /^(seller|sellerName|sellerEmail|sellerPhone|sellerAddress|commission|providerCommission|rawError|errorMessage|token|accessToken)$/i;
const UNSAFE_TEXT = /[\u0000-\u001F\u007F]|<[^>]*>|(?:javascript|data|file)\s*:/i;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (path, message) => { throw new TypeError(`${path}: ${message}`); };
const object = (value, path) => { if (!isObject(value)) fail(path, "must be an object"); return value; };
const array = (value, path) => { if (!Array.isArray(value)) fail(path, "must be an array"); return value; };
const string = (value, path, { nullable = false } = {}) => {
  if (nullable && value === null) return value;
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  return value;
};
const publicText = (value, path, options = {}) => {
  string(value, path, options);
  if (value !== null && (value.length > 500 || UNSAFE_TEXT.test(value))) fail(path, "must be bounded plain text without markup, controls, or URL schemes");
  return value;
};
const oneOf = (value, values, path) => { if (!values.includes(value)) fail(path, `must be one of ${values.join(", ")}`); return value; };
const exactKeys = (value, allowed, path) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, "unknown field");
  for (const key of allowed) if (!(key in value)) fail(`${path}.${key}`, "is required");
};
const timestamp = (value, path, { nullable = false } = {}) => {
  if (nullable && value === null) return value;
  string(value, path);
  if (!ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) fail(path, "must be an ISO 8601 UTC timestamp");
  return value;
};
const cents = (value, path, { nullable = false } = {}) => {
  if (nullable && value === null) return value;
  if (!Number.isSafeInteger(value) || value < 0) fail(path, "must be a non-negative safe integer number of cents");
  return value;
};
const url = (value, path, { nullable = false, fixture = false, provider: providerId } = {}) => {
  if (nullable && value === null) return value;
  string(value, path);
  let parsed;
  try { parsed = new URL(value); } catch { fail(path, "must be a valid URL"); }
  if (parsed.protocol !== "https:") fail(path, "must use HTTPS");
  if (parsed.username || parsed.password) fail(path, "must not contain credentials");
  if (fixture && !parsed.hostname.endsWith(".example.invalid") && parsed.hostname !== "example.invalid") fail(path, "fixture URLs must use example.invalid");
  for (const key of parsed.searchParams.keys()) if (/token|key|secret|signature|auth/i.test(key)) fail(path, "must not contain secret-like query parameters");
  if (providerId && safeProviderUrl(providerId, value) === null) fail(path, "host is not allowlisted for this provider");
  return value;
};
const provider = (value, path) => { string(value, path); if (!PROVIDER_ID.test(value)) fail(path, "must be a provider-neutral slug"); };
const safeError = (value, path) => { if (value !== null && (typeof value !== "string" || !SAFE_ERROR_CODES.test(value))) fail(path, "must be a bounded public-safe code or null"); };

function rejectForbiddenFields(value, path = "fixture") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectForbiddenFields(item, `${path}[${index}]`));
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) fail(`${path}.${key}`, "prohibited secret, seller PII, raw error, or commission field");
    rejectForbiddenFields(child, `${path}.${key}`);
  }
}

function validateReference(value, path, fixture) {
  object(value, path);
  exactKeys(value, ["provider", "providerEventId", "canonicalUrl", "affiliateUrl", "sourceKind", "matchMethod", "matchConfidence", "lastFetchedAt", "expiresAt", "status", "errorCode"], path);
  provider(value.provider, `${path}.provider`);
  string(value.providerEventId, `${path}.providerEventId`);
  url(value.canonicalUrl, `${path}.canonicalUrl`, { nullable: true, fixture, provider: value.provider });
  url(value.affiliateUrl, `${path}.affiliateUrl`, { nullable: true, fixture, provider: value.provider });
  oneOf(value.sourceKind, SOURCE_KINDS, `${path}.sourceKind`);
  oneOf(value.matchMethod, ["provider-crosswalk", "teams-venue-time", "manual", "unmatched"], `${path}.matchMethod`);
  oneOf(value.matchConfidence, ["high", "medium", "low", "none"], `${path}.matchConfidence`);
  timestamp(value.lastFetchedAt, `${path}.lastFetchedAt`);
  timestamp(value.expiresAt, `${path}.expiresAt`);
  oneOf(value.status, PROVIDER_STATUSES, `${path}.status`);
  safeError(value.errorCode, `${path}.errorCode`);
  if (Date.parse(value.expiresAt) <= Date.parse(value.lastFetchedAt)) fail(`${path}.expiresAt`, "must be after lastFetchedAt");
  if (value.matchMethod === "unmatched" && value.matchConfidence !== "none") fail(`${path}.matchConfidence`, "must be none for an unmatched event");
  if (value.status === "error" && value.errorCode === null) fail(`${path}.errorCode`, "is required for error status");
}

function validateListing(value, path, event, fixture) {
  object(value, path);
  exactKeys(value, ["provider", "providerListingId", "sfzGameId", "sourceKind", "sectionRaw", "sectionNormalized", "rowRaw", "seatRange", "allowedQuantities", "currency", "basePriceCents", "mandatoryFeesCents", "allInPerTicketCents", "allInGroupTotalCents", "feeCompleteness", "deliveryType", "accessibleStatus", "obstructedView", "limitedView", "productType", "sanitizedNotes", "canonicalUrl", "affiliateUrl", "fetchedAt", "expiresAt"], path);
  provider(value.provider, `${path}.provider`);
  string(value.providerListingId, `${path}.providerListingId`);
  if (value.sfzGameId !== event.sfzGameId) fail(`${path}.sfzGameId`, "must match its event");
  oneOf(value.sourceKind, LISTING_SOURCE_KINDS, `${path}.sourceKind`);
  publicText(value.sectionRaw, `${path}.sectionRaw`, { nullable: true });
  publicText(value.sectionNormalized, `${path}.sectionNormalized`, { nullable: true });
  publicText(value.rowRaw, `${path}.rowRaw`, { nullable: true });
  if (value.sectionNormalized !== null && value.sectionRaw === null) fail(`${path}.sectionRaw`, "must be preserved when a normalized section exists");
  if (value.seatRange !== null) {
    object(value.seatRange, `${path}.seatRange`); exactKeys(value.seatRange, ["from", "to"], `${path}.seatRange`);
    publicText(value.seatRange.from, `${path}.seatRange.from`); publicText(value.seatRange.to, `${path}.seatRange.to`);
  }
  array(value.allowedQuantities, `${path}.allowedQuantities`);
  if (value.allowedQuantities.length === 0 || new Set(value.allowedQuantities).size !== value.allowedQuantities.length || value.allowedQuantities.some((quantity) => !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20)) fail(`${path}.allowedQuantities`, "must contain unique integers from 1 through 20");
  if (value.allowedQuantities.some((quantity, index, all) => index > 0 && quantity <= all[index - 1])) fail(`${path}.allowedQuantities`, "must be sorted ascending");
  string(value.currency, `${path}.currency`); if (!CURRENCY.test(value.currency)) fail(`${path}.currency`, "must be a three-letter uppercase currency code");
  cents(value.basePriceCents, `${path}.basePriceCents`);
  cents(value.mandatoryFeesCents, `${path}.mandatoryFeesCents`, { nullable: true });
  cents(value.allInPerTicketCents, `${path}.allInPerTicketCents`, { nullable: true });
  cents(value.allInGroupTotalCents, `${path}.allInGroupTotalCents`, { nullable: true });
  oneOf(value.feeCompleteness, FEE_COMPLETENESS, `${path}.feeCompleteness`);
  if (value.feeCompleteness === "unknown" && (value.mandatoryFeesCents !== null || value.allInPerTicketCents !== null || value.allInGroupTotalCents !== null)) fail(`${path}.feeCompleteness`, "unknown fees cannot have all-in or mandatory-fee amounts");
  if (value.feeCompleteness === "all_in" && value.mandatoryFeesCents !== null && value.allInPerTicketCents !== value.basePriceCents + value.mandatoryFeesCents) fail(`${path}.allInPerTicketCents`, "must equal base plus mandatory fees");
  if (value.feeCompleteness === "all_in" && value.allInPerTicketCents === null) fail(`${path}.allInPerTicketCents`, "is required for all_in");
  if (value.feeCompleteness === "provider_reported_all_in" && value.allInPerTicketCents === null) fail(`${path}.allInPerTicketCents`, "is required for provider_reported_all_in");
  if (value.allInGroupTotalCents !== null && value.allInPerTicketCents !== null && value.allowedQuantities.length === 1 && value.allInGroupTotalCents !== value.allInPerTicketCents * value.allowedQuantities[0]) fail(`${path}.allInGroupTotalCents`, "must equal the safely calculable single allowed quantity total");
  oneOf(value.deliveryType, ["mobile", "electronic", "will-call", "physical", "unknown"], `${path}.deliveryType`);
  oneOf(value.accessibleStatus, ["accessible", "not-accessible", "unknown"], `${path}.accessibleStatus`);
  for (const key of ["obstructedView", "limitedView"]) if (value[key] !== null && typeof value[key] !== "boolean") fail(`${path}.${key}`, "must be boolean or null");
  oneOf(value.productType, PRODUCT_TYPES, `${path}.productType`);
  array(value.sanitizedNotes, `${path}.sanitizedNotes`); value.sanitizedNotes.forEach((note, index) => publicText(note, `${path}.sanitizedNotes[${index}]`));
  url(value.canonicalUrl, `${path}.canonicalUrl`, { fixture, provider: value.provider });
  url(value.affiliateUrl, `${path}.affiliateUrl`, { nullable: true, fixture, provider: value.provider });
  timestamp(value.fetchedAt, `${path}.fetchedAt`); timestamp(value.expiresAt, `${path}.expiresAt`);
  if (Date.parse(value.expiresAt) <= Date.parse(value.fetchedAt)) fail(`${path}.expiresAt`, "must be after fetchedAt");
}

function validateEvent(value, path, fixture) {
  object(value, path);
  exactKeys(value, ["eventKey", "sfzGameId", "season", "phase", "week", "homeAway", "opponent", "startTimeUtc", "venueLocalStart", "pacificTimeDisplay", "venue", "providerEventReferences", "providerCoverage", "listings", "rescheduledFromUtc", "updatedAt"], path);
  string(value.eventKey, `${path}.eventKey`); string(value.sfzGameId, `${path}.sfzGameId`);
  if (!Number.isSafeInteger(value.season) || value.season < 2000 || value.season > 2200) fail(`${path}.season`, "must be a plausible season integer");
  oneOf(value.phase, ["preseason", "regular", "postseason"], `${path}.phase`);
  if (value.week !== null && (!Number.isSafeInteger(value.week) || value.week < 1 || value.week > 22)) fail(`${path}.week`, "must be null or an integer from 1 through 22");
  oneOf(value.homeAway, ["home", "away"], `${path}.homeAway`);
  object(value.opponent, `${path}.opponent`); exactKeys(value.opponent, ["abbreviation", "name"], `${path}.opponent`); string(value.opponent.abbreviation, `${path}.opponent.abbreviation`); string(value.opponent.name, `${path}.opponent.name`);
  timestamp(value.startTimeUtc, `${path}.startTimeUtc`);
  object(value.venueLocalStart, `${path}.venueLocalStart`); exactKeys(value.venueLocalStart, ["value", "timeZone"], `${path}.venueLocalStart`); string(value.venueLocalStart.value, `${path}.venueLocalStart.value`); if (!LOCAL_DATE_TIME.test(value.venueLocalStart.value)) fail(`${path}.venueLocalStart.value`, "must be an offset-free local date-time"); string(value.venueLocalStart.timeZone, `${path}.venueLocalStart.timeZone`);
  string(value.pacificTimeDisplay, `${path}.pacificTimeDisplay`);
  object(value.venue, `${path}.venue`); exactKeys(value.venue, ["name", "city", "region", "country"], `${path}.venue`); for (const key of ["name", "city", "region", "country"]) string(value.venue[key], `${path}.venue.${key}`);
  const references = array(value.providerEventReferences, `${path}.providerEventReferences`); references.forEach((reference, index) => validateReference(reference, `${path}.providerEventReferences[${index}]`, fixture));
  const coverage = array(value.providerCoverage, `${path}.providerCoverage`); coverage.forEach((entry, index) => provider(entry, `${path}.providerCoverage[${index}]`));
  if (new Set(coverage).size !== coverage.length) fail(`${path}.providerCoverage`, "must be unique");
  const referenceProviders = new Set(references.map((reference) => reference.provider));
  if (coverage.some((entry) => !referenceProviders.has(entry))) fail(`${path}.providerCoverage`, "must only name referenced providers");
  const listings = array(value.listings, `${path}.listings`); listings.forEach((listing, index) => validateListing(listing, `${path}.listings[${index}]`, value, fixture));
  for (const listing of listings) {
    const reference = references.find((candidate) => candidate.provider === listing.provider);
    if (!reference) fail(`${path}.listings`, `provider ${listing.provider} has no event reference`);
    if (reference.status !== "connected-listings") fail(`${path}.listings`, `provider ${listing.provider} is not connected for listings`);
  }
  timestamp(value.rescheduledFromUtc, `${path}.rescheduledFromUtc`, { nullable: true }); timestamp(value.updatedAt, `${path}.updatedAt`);
}

export function validateTicketFixture(value) {
  object(value, "fixture"); rejectForbiddenFields(value);
  exactKeys(value, ["schemaVersion", "fixture", "generatedAt", "providerStatuses", "events", "unmatchedProviderEvents"], "fixture");
  if (value.schemaVersion !== "1.0.0") fail("fixture.schemaVersion", "must be 1.0.0");
  if (value.fixture !== true) fail("fixture.fixture", "must be true for deterministic development data");
  timestamp(value.generatedAt, "fixture.generatedAt");
  const statuses = array(value.providerStatuses, "fixture.providerStatuses");
  const statusProviders = new Set();
  statuses.forEach((status, index) => {
    const path = `fixture.providerStatuses[${index}]`; object(status, path); exactKeys(status, ["provider", "status", "lastFetchedAt", "expiresAt", "errorCode"], path);
    provider(status.provider, `${path}.provider`); if (statusProviders.has(status.provider)) fail(`${path}.provider`, "must be unique"); statusProviders.add(status.provider);
    oneOf(status.status, PROVIDER_STATUSES, `${path}.status`); timestamp(status.lastFetchedAt, `${path}.lastFetchedAt`, { nullable: true }); timestamp(status.expiresAt, `${path}.expiresAt`, { nullable: true }); safeError(status.errorCode, `${path}.errorCode`);
    if (status.status === "error" && status.errorCode === null) fail(`${path}.errorCode`, "is required for error status");
  });
  const eventKeys = new Set(); const gameIds = new Set(); const listingIds = new Set();
  array(value.events, "fixture.events").forEach((event, index) => {
    validateEvent(event, `fixture.events[${index}]`, true);
    if (eventKeys.has(event.eventKey)) fail(`fixture.events[${index}].eventKey`, "must be unique"); eventKeys.add(event.eventKey);
    if (gameIds.has(event.sfzGameId)) fail(`fixture.events[${index}].sfzGameId`, "must be unique"); gameIds.add(event.sfzGameId);
    for (const listing of event.listings) { const id = `${listing.provider}:${listing.providerListingId}`; if (listingIds.has(id)) fail(`fixture.events[${index}].listings`, `duplicate provider listing ${id}`); listingIds.add(id); }
  });
  array(value.unmatchedProviderEvents, "fixture.unmatchedProviderEvents").forEach((reference, index) => {
    validateReference(reference, `fixture.unmatchedProviderEvents[${index}]`, true);
    if (reference.matchMethod !== "unmatched") fail(`fixture.unmatchedProviderEvents[${index}].matchMethod`, "must be unmatched");
  });
  return value;
}

export const ticketSchemaValues = Object.freeze({ sourceKinds: SOURCE_KINDS, listingSourceKinds: LISTING_SOURCE_KINDS, providerStatuses: PROVIDER_STATUSES, feeCompleteness: FEE_COMPLETENESS, productTypes: PRODUCT_TYPES });
