# Ticket Finder

This is the canonical overview of the implemented Ticket Finder. The feature is a static Astro page backed by independently refreshed, validated JSON. Browser code never calls a provider, and provider failure does not block a site build or web request.

## Documentation map

- [`../ticket-sync.md`](../ticket-sync.md): one-shot command and environment-variable reference.
- [`../ticket-sync-deployment.md`](../ticket-sync-deployment.md): operator deployment, validation, monitoring, timer, and rollback runbook.
- [`data-contract.md`](data-contract.md): authoritative published `index.json`, `status.json`, and event-file schema.
- [`event-matching.md`](event-matching.md): schedule identity, matching, and override rules.
- [`provider-matrix.md`](provider-matrix.md), [`provider-rights/Ticketmaster.md`](provider-rights/Ticketmaster.md), [`provider-rights/EventSpy.md`](provider-rights/EventSpy.md), and [`provider-rights/StubHub.md`](provider-rights/StubHub.md): provider approval status and rights records. EventSpy has one narrow, disabled-by-default URL authorization; StubHub remains pending.

Implementation plans, audits, and generated match reviews are supporting historical evidence, not the current source of truth.

## Feature and indexing states

`SFZ_TICKET_DATA_MODE` is a non-secret Astro build setting:

| State | Page behavior | Data source | Search behavior |
| --- | --- | --- | --- |
| `disabled` | Direct route shows unavailable; navigation and game CTAs are hidden | None | `noindex, nofollow`; no canonical or sitemap entry |
| `preview` | Feature UI is visible | Current client attempts validated non-fixture runtime JSON; unavailable state appears when it is absent | `noindex, nofollow`; no canonical or sitemap entry |
| `beta` | Feature UI is visible | Validated non-fixture runtime snapshot | `noindex, nofollow`; no canonical or sitemap entry |
| `live` | Feature UI is visible | Validated non-fixture runtime snapshot | Indexable only when the independent gate is enabled |

An absent or invalid mode safely becomes `preview`. `SFZ_TICKET_INDEXING_STATE` is a separate `disabled`/`enabled` gate and safely defaults to `disabled`. Only `live` plus `enabled` emits `index, follow`, a canonical URL, and the `/tickets` sitemap entry. Runtime JSON cannot change build-time metadata.

The feature-state helper labels only `beta` and `live` as runtime modes, but the current page client is not conditional on that helper: `preview` also requests `/data/tickets/status.json` and `/data/tickets/index.json`, whose validator prohibits provider or schedule fixtures. The committed development fixture supports contract tests; it is not currently rendered by the preview page.

Navigation, schedule CTAs, and eligible game-detail CTAs follow the feature state. Completed and canceled games do not receive Ticket Finder CTAs.

## Current provider behavior

Ticketmaster Discovery is the only approved real adapter, and it is event-summary only. It supports two modes:

- `single-event` (default) searches the configured event name and local date, then verifies the legacy event ID in the returned public URL. The checked-in defaults are a migration fallback for one 2026 game.
- `season` makes a bounded, paginated attraction query across the earliest through latest dated games in the canonical schedule, deduplicates provider event IDs, and runs normal matching. It requires an operator-verified Seattle {Team} `TICKETMASTER_ATTRACTION_ID`; placeholders and guessed or checked-in private identifiers are rejected. The repository intentionally contains no verified attraction ID.

Ticketmaster `priceRanges` are normalized into separate typed `eventPrices`. Missing ranges leave the verified provider CTA available and display “Ticketmaster did not supply an event range”; malformed individual ranges are discarded without discarding an otherwise valid event. Each retained range keeps its currency and provider range type, uses an unknown price basis, and is rendered as a “Ticketmaster-reported event range.”

An event-summary range is not an individual available ticket. It has no listing ID, section, row, seat, quantity, quantity-specific total, or verified fee-complete meaning, and it may not enter listing arrays, cheapest sorting, or comparison claims. Listing-level inventory requires a separately approved listing API and rights record. Ticketmaster Inventory Status is not approved or used.

StubHub is pending. It stays disabled until contractual access, API/feed scope, affiliate and attribution rules, approved display fields, price/fee semantics, storage, caching, retention, trademark, link, and takedown rights are reviewed and recorded. The complete blocking checklist in [`provider-rights/StubHub.md`](provider-rights/StubHub.md) must not be weakened or treated as approval.

EventSpy is a separate, disabled-by-default, accountless collector. The schema-validated canonical coverage manifest is [`../../src/lib/tickets/eventspy-coverage.mjs`](../../src/lib/tickets/eventspy-coverage.mjs): it is the sole mapping source for all 16 reviewed URLs and the explicit Week 18 unavailable row. Runtime discovery, performer/search crawling, arbitrary URL environment overrides, login, cookies, persistent profiles, retries, marketplace links, and raw artifacts are prohibited. Each game has an independent two-attempt maximum per America/Los_Angeles date; a reservation immediately before navigation counts even when extraction or publication fails.

The season collector uses EventSpy's app API for each authorized source event: one event metadata GET and one history POST. It merges the four provider arrays by `seenAt`, retains missing marketplace values as null, and atomically publishes one validated mirror snapshot per game. EventSpy observations are not listings or direct marketplace integrations and do not enable StubHub.

The ticket dashboard separates Ticketmaster event summaries from EventSpy observations. It shows days until kickoff when confirmed, EventSpy metrics only when present, source and age, a semantic history table, and period controls only when backed by stored samples. Stale observations are labeled “Last observed,” marketplace attribution uses “Lowest marketplace observed by EventSpy,” and fee-basis differences never enter a combined provider ranking.

## Data, provenance, and safety

The synchronizer reads the canonical schedule from `src/data/nfl/{team}.json` unless `TICKETS_GAMES_FILE` overrides it. A non-fixture sync requires that schedule payload to state `fixture: false`. Published status records both provider fixture provenance (`fixture`) and schedule provenance (`scheduleFixture`); beta/live runtime validation rejects either value unless it is explicitly `false`.

Provider fixture mode is enabled only by `TICKETS_FIXTURE=true` and uses the synthetic `scripts/tickets/fixtures/provider.json` by default. The separately committed legacy contract fixture is checked by `npm run validate:tickets`. Every candidate `index.json`, `status.json`, and event file is runtime-validated before publication, and the browser validates schema version, age, provenance, cross-file identity, event identity, freshness, URLs, and display-safe shapes again.

Provider configuration is an explicit ID allowlist. Adapters define separate HTTPS request and public outbound host allowlists. Credentials use adapter-specific server-only environment names, never `PUBLIC_` names; they must not enter provider JSON, fixtures, logs, raw responses, published snapshots, Astro build variables, or browser bundles. Ticketmaster's API requires its key as an `apikey` query parameter, but request URLs are never logged or published. Logs expose bounded error codes.

Development and production must use separate `TICKETS_ENV` values, env files, data roots, Compose projects, locks, services, status, and credentials. Fixture data is development-only. Repository env files and systemd units are templates; operator-installed `/etc`, `/var/lib`, `/run/lock`, Compose, Nginx, and systemd state are not created or changed by repository edits.

## Refresh and publication lifecycle

For each provider, `minRefreshMs` prevents requests before the next eligible attempt, `freshnessMs` sets fresh record expiry, and `retentionMs` is the rights-permitted last-good ceiling after a provider failure. Configuration requires `minRefreshMs <= freshnessMs <= retentionMs`. The example Ticketmaster values are 10 minutes, 30 minutes, and 60 minutes. Retained data is marked stale, excluded from ranking/current-price claims, and removed after retention. The browser additionally rejects snapshots older than two hours and expired event summaries.

The application lease is a versioned owner record with a cryptographically unique run token, start time, heartbeat, PID, and hostname. PID and hostname are diagnostics only. Heartbeats refresh ownership; an active lease blocks overlap. Stale recovery atomically quarantines the old lease, re-verifies its token and age, creates a new token-owned lease, and retains only the configured number of stale artifacts. Heartbeat loss fails the run, and release removes a lease only when its token still matches. The systemd template adds a separate non-blocking host `flock`.

Candidates are written and validated in a sibling staging directory. Publication renames the candidate to an immutable version directory, creates a temporary relative symlink, and atomically renames it over `current`. A legacy current directory is migrated before pointer installation. Failed preparation or switching preserves the prior current snapshot. At most three versions remain, also bounded by the maximum configured provider retention window.

## Operations

The sync is one-shot: `npm run tickets:sync`. The repository timer template runs every 15 minutes with up to two minutes of randomized delay, persistent catch-up, and a 15-minute service timeout. Operators monitor service/timer state and structured journal events, validate a disposable fixture run before installation, and inspect `status.json` for outcome, provider state, timestamps, error codes, provenance, and counts.

Rollback disables the timer, stops the one-shot service, restores reviewed Compose/Nginx templates or selects the prior validated runtime version as appropriate, validates configuration, recreates only the affected web integration, and rebuilds the site in `preview`. The exact one-shot validation, monitoring, installation, and rollback commands are maintained in [`../ticket-sync-deployment.md`](../ticket-sync-deployment.md).
