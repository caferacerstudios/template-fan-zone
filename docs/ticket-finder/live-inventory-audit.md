# Live inventory focused audit

> **Historical audit:** this point-in-time report is retained as evidence, not current implementation guidance. See [`README.md`](README.md) for the current feature and documentation map.

Audit date: 2026-08-29. The repository is authoritative; its Git history is a
single squashed `Baseline from GitHub dev` commit, so no separate task 8.b
commit or external approval artifact can be attributed.

## End-to-end finding

`scripts/tickets/sync.mjs` loads fail-closed configuration and calls the
provider registry. `pipeline.mjs` matches provider events to the normalized
schedule, validates provider URLs against adapter-owned allowlists, converts
only listing-level records into the public listing contract, retains permitted
prior records as non-rankable stale data, validates a staged snapshot, and
atomically publishes `index.json`, `status.json`, and per-event JSON. Nginx
serves only `current/` below `/data/tickets/`.

In beta, the browser reads `/data/tickets/index.json`, validates each relative
event filename, and reads `/data/tickets/events/sea_*.json`. Fresh listing-level
records render in the comparison card area. Fresh matched event summaries
render separately as “View tickets at provider” paths. Event-summary price
ranges are neither copied nor ranked as listings. If there are no fresh
listing-level records, the page says live comparison inventory is unavailable
even when a useful matched provider event link exists.

## Provider classes and current evidence

| Class | Meaning | Repository state |
| --- | --- | --- |
| Event-summary | Matched event metadata and provider event URL; never an individual offer | Ticketmaster is approved/enabled by operator configuration and its Discovery adapter emits no `listings` field |
| Listing-level | Individual authorized offers with price, quantity, location, freshness, and outbound URL | No real provider is approved or implemented; `fixture-market` exercises this contract only in explicit fixture mode |
| Deep-link-only | Provider/event navigation without price inventory | The data/UI contracts support it; no live deep-link provider is enabled |
| Fixture/test | Deterministic synthetic inventory for offline acceptance | `fixture-market` exercises publication and the committed legacy-contract fixture exercises validation; neither is live data |
| Planned provider | No rights, credentials, hosts, or usable adapter | StubHub remains in the registry and fails closed behind its rights gate |

## Deployment boundary

Repository-owned oneshot and timer templates live in `deployment/systemd/`.
The service uses a non-blocking host `flock`, a separate internal atomic-publish
lock, a 15-minute timeout, journald stdout/stderr, and hardening directives.
An overlap or sync error exits nonzero. `docs/ticket-sync-deployment.md`
documents separate dev/prod data and environment paths. These are reviewable
assets only; installing or enabling them remains an operator action.

## Remaining external gate

Real comparisons require a marketplace/provider to supply explicit written
listing-feed/API rights, documented public/partner endpoints and response
schema, credentials, exact API and outbound-link hostnames, affiliate/link
rules, refresh/rate limits, and permitted retention. An operator must record
that approval in the provider-rights file. Only then can a provider-specific
adapter map the documented response into `events[].listings`, set its private
credential environment name and allowlists, and enable it as `listing-level`
in `TICKETS_PROVIDERS_JSON`.
