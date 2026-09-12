# Ticket Finder published runtime data contract

This is the authoritative reference for the JSON written by `scripts/tickets/pipeline.mjs`, validated before publication by `scripts/tickets/snapshot.mjs`, and consumed by `src/lib/tickets/runtime-view.mjs`. The published schema version is `1.0.0`.

All three file kinds are JSON objects with `schemaVersion: "1.0.0"` and the same ISO UTC `generatedAt`. The browser rejects incompatible generations, timestamps more than 60 seconds in the future, and snapshots older than two hours. Raw provider payloads, credentials, raw errors, and seller identity are never part of this contract.

An event file may include `marketObservations: MarketObservation[]`. Each `1.0.0` item has exact `source`, `sourceUrl`, `gameId`, `collectedAt`, and USD currency fields; a separate summary contains current/seven-day values and source timestamps; `seriesPoint` contains an `observedAt` plus exactly one nullable entry for Ticketmaster, StubHub, VividSeats, and SeatGeek. Optional section labels are plain text bounded to 80 characters. Summary and series values need only agree when their source timestamps agree.

Every item must pass strict identity, timestamp, price, uniqueness, field allowlist, and secret-bearing-content validation. Missing values are `null`, never zero. The object is neither a provider reference/listing nor a Ticketmaster `ProviderEventPrice`; it cannot enter listing ranking. History is deterministically sorted, deduplicated, retained 45 days, never backfilled or interpolated, and a null collection cannot replace a valid value at the same source timestamp.

## `index.json`

The index contains lightweight event routing data and never listing arrays:

```ts
interface TicketIndex {
  schemaVersion: "1.0.0";
  generatedAt: string;
  outcome: "success" | "degraded";
  events: Array<{
    eventKey: string;               // sea:<schedule game ID>
    gameId: string;
    startsAt: string | null;
    date: string | null;
    opponent: { abbreviation: string; name: string };
    homeAway: "home" | "away";
    counts: { admission: number; parking: number; other: number };
    eventFile: string;              // events/sea_<safe ID>.json
  }>;
}
```

An event path must be exactly the safe filename derived from its `eventKey`. Runtime selection accepts only schedule game IDs embedded in the built page and loads only the selected event file.

## `status.json`

```ts
interface TicketStatus {
  schemaVersion: "1.0.0";
  generatedAt: string;
  outcome: "success" | "degraded";
  environment: "development" | "production";
  fixture: boolean;
  scheduleFixture: boolean;
  durationMs: number;
  totals: Counts;
  providers: ProviderStatus[];
}

interface Counts {
  fresh: number;
  stale: number;
  rejected: number;
  unmatched: number;
}

interface ProviderStatus {
  provider: string;
  mode: "listing-level" | "event-summary" | "deep-link-only" | "pending";
  state: "success" | "stale" | "error" | "disabled" | "pending";
  errorCode: string | null;
  lastSuccess: string | null;
  lastAttempt: string | null;
  nextEligibleAttempt: string | null;
  matchedEventSummaries: number;
  counts: Counts;
  rejectedEvents?: unknown[];
  unmatchedEvents?: unknown[];
}
```

Provider IDs must be lowercase safe IDs. Error codes are bounded uppercase public-safe codes, not provider messages. Provider timestamps, counts, and optional matched-summary count are runtime-validated. Beta/live additionally requires both `fixture === false` and `scheduleFixture === false`; missing provenance fails closed.

Every eligible event file is published and may carry `marketObservations` plus sanitized `eventSpyState`: `current`, `stale`, `not_collected`, `source_unavailable`, or `last_collection_failed`. Its mapping must match the canonical coverage row. The private ledger and raw errors are never published. `collectedAt` is SFZ collection time; `sourcePointAt`/`seriesPoint.observedAt` is visible-tooltip time. Four nullable cents values are retained marketplace lowest-price observations; null is a gap. A selected-window low–high is across retained lows, not provider inventory.

## Event files

Each index row points to one event file:

```ts
interface TicketEventFile {
  schemaVersion: "1.0.0";
  generatedAt: string;
  event: {
    eventKey: string;
    gameId: string;
    season: number;
    phase: string;
    week: number | null;
    startsAt: string | null;
    date: string | null;
    homeAway: "home" | "away";
    opponent: { abbreviation: string; name: string };
    venue: unknown;
  };
  providerReferences: ProviderReference[];
  listings: {
    admission: TicketListing[];
    parking: TicketListing[];
    other: TicketListing[];
  };
}
```

The runtime requires `event.gameId` and `event.eventKey` to match the selected index row. Admission, parking, and other are distinct buckets; parking is never admission.

## Provider event references and prices

All references include the provider ID, provider event ID, configured mode, match confidence, canonical HTTPS URL or `null`, state, fetch/expiry times, capabilities, event prices, and an event summary where applicable. For `event-summary`, the enforced shape is:

```ts
interface ProviderEventReference {
  provider: string;
  providerEventId: string;
  mode: "event-summary";
  matchConfidence: string;
  canonicalUrl: string | null;
  state: "fresh" | "stale";
  fetchedAt: string;
  expiresAt: string;
  capabilities: {
    supportsSeatListings: false;
    supportsResaleListings: false;
    supportsPriceRange: true;
    accessTier: "discovery";
  };
  eventPrices: ProviderEventPrice[];
  summary: {
    name: string;
    venue: unknown;
    startTimeUtc: string | null;
    localDate: string | null;
    localTime: string | null;
    timeZone: string | null;
    eventStatus: string | null;
    inventoryDetailLevel: "price_range";
  };
}

interface ProviderEventPrice {
  provider: string;
  marketType: string;
  minCents: number | null;
  maxCents: number | null;
  currency: "USD" | "CAD";
  priceBasis: "unknown" | "base" | "all-in";
  capturedAt: string;
  sourceIdentifier: string;
  maxIsCapped: boolean;
}
```

Price bounds are nonnegative safe integer cents no greater than 100,000,000; a present minimum cannot exceed a present maximum, and `maxIsCapped` cannot be true without a maximum. A price's provider and source identifier must match its reference. Ticketmaster Discovery publishes `priceBasis: "unknown"`.

These ranges are event summaries, not individual available tickets. They carry no listing ID, seat, section, row, quantity, quantity-specific total, or verified fee-complete meaning. They never enter listing buckets or ranking. Missing `priceRanges` produces an empty `eventPrices` array and the UI says “Ticketmaster did not supply an event range”; a malformed individual range is omitted without removing an otherwise valid event reference and CTA.

Aggregate lowest/get-in-price observations use the separate `MarketObservation` type. They have no provider minimum or maximum. Any future approved high calculated across successive lowest observations must be named `rollingHighOfLowestObservedCents`, not `maxCents`, and must remain distinct from Ticketmaster Discovery ranges.

## Listing records

The fixture adapter exercises the listing-level boundary. The pipeline publishes this normalized shape:

```ts
interface TicketListing {
  provider: string;
  providerListingId: string;
  productType: "admission" | "parking" | "other";
  section: string | null;
  row: string | null;
  allowedQuantities: number[];
  currency: "USD";
  priceCents: number;
  feeStatus: "all-in" | "estimated" | "unknown";
  sanitizedNotes: string[];
  canonicalUrl: string;
  affiliateUrl: string | null;
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
  rankEligible: boolean;
}
```

Sections are bounded to 80 characters, rows to 40, and quantities to unique sorted integers from 1 through 20. Notes are redacted, flattened, limited to 240 characters each, and capped at four.

Publication validation requires nonnegative integer cents, `USD`, HTTPS URLs on that provider's public-host allowlist, `rankEligible === !stale`, and notes without likely email addresses or phone numbers. It rejects seller fields, raw response fields, URL credentials, and secret-like URL query parameters. Runtime display further requires a safe provider URL, `rankEligible: true`, `stale: false`, and a future `expiresAt`.

No real listing-level provider is currently approved or enabled. Listing records in fixture output are synthetic and must not be described as live inventory.

## Validation and publication invariants

- Candidate files are written in a sibling staging directory and every file is validated before it can become current.
- Provider event and listing URLs must use HTTPS and the registry's provider-specific public host allowlist; request API hosts are separately allowlisted.
- A non-fixture sync requires the schedule source to declare `fixture: false`.
- Event matching must succeed before provider references or listings are attached; ambiguous candidates are rejected.
- Provider failures may retain prior data only through that provider's configured retention window. Retained references/listings are stale and ineligible for ranking; expired event summaries are rejected by the browser.
- Publication moves a validated candidate to an immutable version directory and atomically switches the relative `current` symlink. Cross-file generation checks prevent mixed versions.
