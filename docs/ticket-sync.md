# Ticket snapshot synchronization

Ticket synchronization is a server-side, one-shot process. It is not called by Astro rendering, `prebuild`, `build`, the NFL refresh, or OpenAI generation. No browser route invokes provider adapters.

## Configuration

All adapters are disabled unless explicitly enabled. Configuration is validated before provider work starts.

- `TICKETS_ENV`: `development` (default) or `production`.
- `TICKETS_OUTPUT_DIR`: snapshot publication directory. Defaults to `runtime/tickets/current` in development. Production must set this or `TICKETS_OUTPUT_DIR_PRODUCTION` explicitly. `TICKETS_OUTPUT_DIR_DEVELOPMENT` and `TICKETS_OUTPUT_DIR_PRODUCTION` support separate destinations.
- `TICKETS_GAMES_FILE`: canonical schedule input; defaults to `src/data/nfl/{team}.json`.
- `TICKETS_OVERRIDES_FILE`: provider match overrides; defaults to `src/data/tickets/match-overrides.json`.
- `TICKETS_PROVIDERS_JSON`: JSON object keyed by adapter id. Each entry has `enabled`, `mode` (`listing-level`, `event-summary`, `deep-link-only`, or `pending`), and optional `minRefreshMs`, `freshnessMs`, `retentionMs`, `timeoutMs`, `maxRetries`, `rateLimitMs`, `pageSize`, `maxPages`, and `maxRequests`. Validation requires `minRefreshMs <= freshnessMs <= retentionMs`. Ticketmaster caps these at 200 results per page and 20 pages/requests; recommended values are 50 and 5/5.
- `TICKETS_FIXTURE`: exactly `true` enables local fixture mode.
- `TICKETS_FIXTURE_FILE`: optional local provider fixture path.
- `TICKETS_LOCK_STALE_MS`: lease expiry and abandoned staging-artifact age; defaults to 30 minutes.
- `TICKETS_LOCK_HEARTBEAT_MS`: owned-lease heartbeat interval; defaults to 60 seconds and must be less than one third of the stale interval.
- `TICKETS_LOCK_STALE_ARTIFACT_LIMIT`: maximum quarantined stale-lock directories retained; defaults to 3.
- `TICKETMASTER_API_KEY`: server-side Ticketmaster Discovery API consumer key.
- `TICKETMASTER_DISCOVERY_MODE`: `season` enables bounded attraction discovery; `single-event` is the default temporary migration fallback.
- `TICKETMASTER_ATTRACTION_ID`: required in season mode. An operator must supply the verified {Team} attraction ID in the private environment; the repository deliberately does not guess or hard-code it.
- `TICKETMASTER_EVENT_NAME`, `TICKETMASTER_EVENT_DATE`, and `TICKETMASTER_LEGACY_EVENT_ID`: retained for `single-event`; their defaults identify the September 9, 2026 Patriots game at Lumen Field.

Credential values belong only in the server process environment. Provider configuration names the credential environment variable, never its value. Do not place credentials in JSON, fixture files, command-line URLs, logs, or public environment variables. The sync emits only bounded safe error codes.

## Usage

Run a no-network complete synchronization with:

```sh
TICKETS_FIXTURE=true TICKETS_OUTPUT_DIR=/var/tmp/sfz-tickets npm run tickets:sync
```

Normal one-shot invocation is `npm run tickets:sync`. Ticketmaster uses only the documented Discovery API v2 event search and is an event-summary provider. Season mode sends one attraction query over the earliest-to-latest upcoming canonical schedule dates, follows pages only within both configured caps, and deduplicates event IDs before matching; it does not query once per game. Fixture mode activates only `fixture-market` using `scripts/tickets/fixtures/provider.json` and needs no credentials or network.

The `stubhub` registry entry is also unconditionally pending and disabled. It has no credential variable or hostname allowlist, and configuration rejects attempts to enable it until the operator-reviewed checklist in `docs/ticket-finder/provider-rights/StubHub.md` is complete and the approval matrix is updated.

The EventSpy mirror collector is one season-wide API-backed one-shot. Run `node scripts/tickets/eventspy-mirror.mjs --output-root <public-data-directory>`. It reads the reviewed `EVENTSPY_COVERAGE`, performs one event GET and one history POST for each of the 16 authorized rows, and writes `<public-data-directory>/<gameId>.json` atomically. Week 18 publishes an explicit unavailable snapshot without a network request. One game failure does not stop later games and does not replace that game's last-good file. A complete season exits 0; a partial season exits 2. It uses no browser, DOM, chart, tooltip, listing inventory, or provider adapter.

## Snapshot contract and lifecycle

The configured directory contains:

- `index.json`: schema version, generation time, overall outcome, and lightweight event summaries and relative event-file paths. It never contains listing arrays.
- `status.json`: schema version, generation time, duration, environment, fixture flag, aggregate counts, and each provider's mode, state, safe error code, last success, last attempt, next eligible attempt, and counts.
- `events/<event-key>.json`: schema version, generation time, canonical game metadata, matched provider references with a separate provider-neutral `eventPrices` summary array, and separate `admission`, `parking`, and `other` listing arrays.

Every generated file is validated in a sibling temporary directory. Published JSON is mode `0644` because it is public HTTP data read by an unrelated Nginx container UID; credentials and raw provider responses are prohibited from this tree. Publication occurs only after all files pass. A sibling lock prevents concurrent publishers. The prior snapshot is moved aside immediately before the staged directory is renamed into place; it is restored if that rename fails. Failed preparation leaves the prior snapshot untouched. Old abandoned staging directories are removed only when their names match this output and they exceed the configured stale age.

Provider failures degrade only that provider. Within its configured retention period, its last-good listings remain marked `stale: true` and `rankEligible: false`; after retention they are dropped. Refresh eligibility honors each provider's minimum interval. HTTP adapters use allowlisted HTTPS hosts, explicit timeouts, bounded retries, exponential backoff with jitter, request spacing, bounded pagination and request counts, and an identifying User-Agent. Ticketmaster requires its key in the `apikey` query parameter, but request URLs and raw responses are never logged or published. Browser automation and undocumented endpoints are prohibited.

For backward-compatible migration, leave `TICKETMASTER_DISCOVERY_MODE=single-event` (or omit it) and retain the three legacy variables. An operator must independently verify the attraction ID, add it only to the root-owned private env file, add the pagination/request settings shown in `deployment/ticket-sync/example.env`, and then switch to `season`. This repository change performs no deployment or live-provider verification.

Input normalization rejects low-confidence event matches. Event-range normalization drops malformed individual ranges while retaining an otherwise valid event and verified CTA; the published contract validates nullable bounds, bounded nonnegative safe integer cents, supported currencies, minimum/maximum order, timestamps, source identifiers, and cap state. Ticketmaster Discovery ranges retain their market type and use an unknown price basis. They never enter listing arrays or ranking. Listing output validation separately rejects negative or non-integer prices, non-USD currencies, credentials in URLs, non-allowlisted hosts, seller PII fields, and unsafe notes. Raw provider responses and errors are never published. Ticketmaster Inventory Status is a separate, unapproved integration and is not used.
