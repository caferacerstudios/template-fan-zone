# Ticket Finder Implementation Plan

> **Historical:** this pre-implementation plan is retained for decision history. It is not the current feature or operations source of truth; see [`README.md`](README.md).

No implementation should begin for a provider until its relevant matrix row is verified. Tasks are ordered; bracketed items are dependencies.

## 1. Resolve approvals and product decisions

1. Assign product, engineering, privacy/legal, and operations owners.
2. Obtain authoritative access/affiliate agreements for each desired provider; complete every applicable `provider-matrix.md` field.
3. Decide launch providers, event-level versus listing-level presentation, price quantity basis, all-in definition/tax treatment, freshness SLA, territory behavior, and minimum coverage.
4. Decide synchronization platform, secret store, artifact storage, alerts, retention, and promotion authority.

**Gate A — authorization:** at least the operator-defined minimum provider set has written production access, field/display/cache/retention rights, affiliate terms, attribution, and trademark decisions. Privacy and disclosure changes are approved. All other providers remain disabled.

## 2. Build the contract and offline test system `[Gate A for real fields]`

1. Implement canonical types plus runtime schema validation in `src/lib/tickets/`.
2. Add synthetic development fixtures and malformed/edge-case fixtures.
3. Test amounts, fee categories, URL allowlists, timestamps/expiry, duplicate IDs, cross-references, cancellation, reschedule, and redaction.
4. Add explicit npm scripts for ticket validation and the existing repository tests; decide whether to add Astro type checking. Dependency changes require separate approval.

**Gate B — contract:** fixtures validate offline, prohibited fields fail closed, and operator decisions are encoded and documented.

## 3. Implement schedule matching `[Gate B]`

1. Use upstream schedule `game.id`/`game_id` as `scheduleGameId`; create an alias strategy for source-ID changes.
2. Implement crosswalk-first matching and team/venue/time fallback.
3. Add review workflow for ambiguity, flexes, postponements, venue changes, and cancellations.
4. Test wrong-team, neutral-site, duplicate-event, flexed-time, and rescheduled-game cases.

**Gate C — identity:** no low-confidence or unmatched event can publish; manual decisions are auditable.

## 4. Implement the independent synchronization pipeline `[Gates A-C]`

1. Create one adapter per approved provider; unapproved adapters remain absent/disabled.
2. Add provider-specific rate limiting, retry/backoff, refresh windows, cache/retention enforcement, and bounded error codes.
3. Normalize only approved fields; never persist provider payloads longer than approved.
4. Validate versioned candidates and atomically promote a last-known-good snapshot.
5. Add provider kill switches, dry-run mode, metrics, alerts, and rollback without resynchronizing.
6. Schedule the job independently from `npm prebuild`; grant it only provider secrets and artifact-write access.

**Gate D — operations:** staging demonstrates partial outage, rate-limit, invalid payload, expired data, rollback, credential rotation, and zero-data behavior without breaking site builds.

## 5. Build `/tickets/` `[Gates B-D]`

1. Add `src/pages/tickets.astro` using `{Team}Layout`, reusable ticket components, and the promoted snapshot.
2. Render event selection, like-for-like provider/listing comparison, timestamp, coverage, fee labels/exclusions, provider attribution, affiliate disclosure, stale/unavailable states, and accessible controls.
3. Keep rendering static; do not call provider APIs from the browser.
4. Add ticket-specific analytics only after consent semantics and event taxonomy are reconciled. Never send listing IDs, seat labels, full outbound URLs, or prices unless privacy review explicitly approves them.
5. Add `/tickets` metadata to `PUBLIC_PAGES`/sitemap only when substantive production content is ready; add appropriate JSON-LD only after search/legal review.
6. Add navigation at launch, not while the route is thin or unavailable.

**Gate E — content/UI:** accessibility, mobile, empty/stale/error states, disclosure proximity, fee truthfulness, outbound rel attributes, canonical, robots, sitemap, structured data, and provider attribution pass review.

## 6. Validate and launch `[Gates A-E]`

1. Run unit/schema tests, repository tests, Astro checking if adopted, static build from a promoted snapshot, and existing performance/logo checks where applicable.
2. Inspect generated `/tickets/index.html`, sitemap, canonical, robots, JSON-LD, and client bundle for secrets/provider payload leakage.
3. Rehearse disable, expiry, last-known-good, rollback, and flex/reschedule response.
4. Update `/disclosure`, `/privacy-policy`, `/methodology`, and `/sources` with approved ticket-specific language and actual data behavior.
5. Launch behind an operator-controlled server/build flag if chosen; monitor freshness, matching, provider health, click behavior, and complaints.

**Gate F — launch:** approvals remain current, production credentials are server-side, fresh validated data meets minimum coverage, rollback is proven, and named owners sign off.

- [ ] Operator and qualified legal/privacy review approve the disclosure, marketplace terms, provider rights, privacy statements, consent behavior, SEO/indexing state, and launch configuration. Repository controls support review but do not constitute legal advice or compliance certification.

## 7. Post-launch operations

1. Review contracts and matrix entries on an operator-selected cadence and on provider notice.
2. Audit event matches around NFL flex windows and reschedules.
3. Monitor thin-content quality, comparison fairness, stale inventory, duplicate syndication, and disclosure accuracy.
4. Disable a provider immediately if permissions, fee meaning, or data integrity becomes uncertain.

## Deferred route decision

Review `/games-for-sale` separately. Keep it unchanged and do not redirect it to `/tickets/`. Any removal or redirect requires a distinct content/SEO decision and is not part of Ticket Finder implementation.
