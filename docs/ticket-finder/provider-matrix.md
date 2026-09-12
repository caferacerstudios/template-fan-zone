# Ticket Provider Approval Matrix

This matrix summarizes the provider-rights records retained in this repository. Ticketmaster Discovery has the narrow event-summary approval recorded below; all unrecorded capabilities default to **PENDING**. The repository contains no credentials, listing-level real-provider adapter, or provider-specific affiliate utility. A public website is not evidence of API, feed, affiliate, caching, trademark, or display permission.

`PENDING` means “not verified and must not be implemented or represented as approved.” It does not mean denied or unavailable.

| Provider | Access status | Data granularity | Affiliate status | Approved fields | All-in fee definition | Rate limit | Refresh limit | Cache limit | Historical-retention limit | Logo/trademark rights | Required attribution | Approval/document source | Implementation status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ticketmaster | APPROVED: Discovery API only; Inventory Status API not approved | Event summary only | Not established | Event ID/name/URL, venue, date/time/timezone, event status, currency, genuine typed Discovery price ranges | Unknown; never assumed fee-complete | Account quota | 10-minute cache | 60-minute last-good window | No raw response/history | Not established | Plain-text provider name | Operator approval; `provider-rights/Ticketmaster.md` | ENABLED only by operator env; event ranges displayed separately from listings |
| EventSpy | APPROVED 2026-08-31: accountless retrieval of 16 exact reviewed event URLs; Week 18 unavailable | Displayed marketplace-low observations; not direct inventory | Not established | Exact mapping identity, collection/source-point times, four nullable USD cents lows | Source-defined; no cross-provider fee-equivalence claim | Two attempts per game/Pacific day | 08:00 and 20:00 Pacific | 45 days/100 samples per game | Normalized only; no backfill/raw content | Not approved | Dynamic plain-text name and selected exact source link | Operator evidence plus `provider-rights/EventSpy.md` | IMPLEMENTED, DISABLED BY DEFAULT — isolated all-games collector and per-game history |
| StubHub | PENDING; public technical review is not approval | Catalog event summary is technically plausible; buyer-visible listings unconfirmed | PENDING | Catalog documents event metadata and `min_ticket_price`; display rights unapproved | Unknown; never assumed fee-complete | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | 2026-08-31 technical-feasibility/go-no-go record: `provider-rights/StubHub.md` (not approval evidence) | DISABLED — fail-closed rights gate remains |

EventSpy observations do not constitute StubHub permission, StubHub API data, or a direct StubHub connection. A marketplace name observed on EventSpy does not change that marketplace's approval status.

## StubHub technical feasibility — 2026-08-31

The official public sources listed in [`provider-rights/StubHub.md`](provider-rights/StubHub.md) were reviewed on 2026-08-31. Catalog documents an event-level `min_ticket_price` but no event-level maximum. A future event-summary mapping is technically plausible only as `minCents` plus `maxCents: null`, displayed as “From $X,” with `priceBasis: "unknown"` until StubHub confirms its fee basis. Seller-listing scope covers the authenticated user's listings and cannot be treated as marketplace min/max. No maximum may be inferred from result limits, partial pagination, samples, website HTML, or seller constraints; scraping is prohibited.

Application-only OAuth is publicly documented for public data, but the exact production endpoints and scopes for buyer-visible marketplace listings are not established for this application. Affiliate enrollment, links, attribution/disclosures, quotas and pagination bounds, caching/retention, hosts, trademarks, takedown, and provider-disable duties also remain unapproved. Consequently the operational decision remains **NO-GO**, the approval status remains `PENDING`, and the adapter's empty credential/host configuration and `RIGHTS_APPROVAL_REQUIRED` gate must not change until the exact evidence enumerated in the StubHub record is retained and reviewed.

## Evidence required to leave `PENDING`

For each provider, the operator must retain a dated, authoritative approval or contract source that identifies the approved account/application and environment. It must explicitly settle:

- authorized API/feed and whether it supplies event aggregates, individual listings, or both;
- affiliate participation, allowed link construction, permitted channels, and disclosure text;
- each displayable field, price/fee meaning, currency, seat/location data, images, and deep-link rules;
- request rate, permitted refresh cadence, cache lifetime, and raw/normalized/historical retention;
- logo, word-mark, ticket image, and seat-map rights;
- attribution, freshness, sorting, parity, and takedown requirements;
- sandbox versus production access and any territory restrictions.

The approval/document source should be an operator-controlled contract record, provider portal grant, or direct written approval—not a public marketing or documentation page alone. Legal/operator review is a launch gate. The repository's Impact verification meta tag does not prove any provider relationship.

## Operator decisions

- Name the owner who verifies and dates each row.
- Choose the minimum approved provider coverage required for launch.
- Decide whether providers with only event-level “starting at” data may appear; if so, they must not be mixed with comparable listing rows without a clear presentation boundary.
- Establish a contract-change review cadence and an immediate disable mechanism per provider.
