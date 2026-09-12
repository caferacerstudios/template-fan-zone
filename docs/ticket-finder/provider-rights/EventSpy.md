# EventSpy market-observation rights record

Status: **APPROVED 2026-08-31 FOR ACCOUNTLESS RETRIEVAL OF THE 16 EXACT REVIEWED {TEAM} EVENT URLS, AT MOST TWICE PER GAME/PACIFIC DAY, WITH NORMALIZED 45-DAY RETENTION.** The repository collector and deployment templates remain disabled by default.

## Authorized scope

- Exact manifest: the schema-validated [`../../../src/lib/tickets/eventspy-coverage.mjs`](../../../src/lib/tickets/eventspy-coverage.mjs) is the sole authoritative copy of every reviewed URL, EventSpy ID, SFZ ID, date, opponent, and home/away identity. It has 16 authorized rows and one unavailable Week 18 Rams road row (`SOURCE_PAGE_NOT_AVAILABLE`), which causes zero navigation.
- Retrieval limit: no more than two top-level navigations for each game per America/Los_Angeles calendar day. Failed attempts count; games have independent quotas and no automatic retries.
- Access method: public and accountless. A bounded headless browser may load the exact page once and parse the visible latest Recharts tooltip when no stable same-origin structured response is available. No login, credential, retry, access-control bypass, or unrelated endpoint is permitted.
- Performer/search discovery, guessed URLs, notification/season shells, accounts, login, cookies, persistent profiles, undocumented APIs, bundle extraction, raw-page archives, screenshots, OCR, and marketplace-link following: **not approved**.

Permission evidence is maintained by the operator outside the public repository. This file records the implementation boundary, not the private evidence itself.

## Allowed normalization and meaning

The normalized `1.0.0` contract stores exact manifest identity, SFZ collection time, visible tooltip source-point time, stable ledger attempt/sample identity, USD currency, and nullable Ticketmaster, StubHub, VividSeats, and SeatGeek displayed-low observations. Section text is validation input only, not ticket inventory.

These values are aggregate lowest/get-in-price observations. They are not individual listings, offers, inventory, availability, or provider minimum/maximum ranges. They are not Ticketmaster Discovery `priceRanges`, Ticketmaster API data, or StubHub API data. There is no provider maximum field. If a future approved aggregation calculates a high across successive lowest-price observations, it must be called `rollingHighOfLowestObservedCents`, not `maxCents`, and requires its own retention approval before implementation.

Collection is limited to the reviewed EventSpy app event and history endpoints for the source event IDs in `eventspy-coverage.mjs`. Missing identity, malformed USD, future timestamps, unsafe provider URLs, or unmatched coverage fail closed. DOM, Recharts, tooltip, keyboard, mouse, SVG, canvas, HTML, and listing extraction are prohibited.

## Display, attribution, retention, and brand

- Attribution requirement: any future display must identify “EventSpy,” link to the exact authorized source URL, label the value as an aggregate lowest observed price, show the observation time and fee-basis qualification, and avoid inventory or marketplace-connection claims.
- Retention scope: normalized observations only, for 45 days and at most 100 samples per game, for SFZ’s own history chart. Distinct collections remain distinct when the source-point time is unchanged. No raw HTML, response body, screenshots, browser data, cookies, scripts, or historical backfill may be retained.
- Disable/takedown: set `EVENTSPY_ENABLED=false`, keep the timer disabled, publish without new collection, and follow the operator-held takedown record. Never delete the ledger to evade consumed attempts.
- Logo/trademark status: **not approved/unknown**. Use no EventSpy logo or stylized mark; future approved display is limited to the plain-text attribution above unless separate evidence is recorded.
- Takedown contact: **operator confirmation required**. The operator must keep the applicable contact with the external permission evidence before any public display or scheduled retrieval is enabled.

This narrow permission does not approve or enable StubHub, establish a relationship with any marketplace named by EventSpy, or authorize following marketplace links or collecting marketplace data.
