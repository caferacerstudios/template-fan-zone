# StubHub go/no-go record — operator decision required

EventSpy's narrow exact-URL market-observation permission is independent of this record. EventSpy observations—including a winning-marketplace label—are not StubHub API data, do not prove a direct connection, and do not approve or enable StubHub. StubHub remains pending behind every gate below.

**Approval status:** `PENDING`

**Technical-feasibility review date:** 2026-08-31

**Decision:** **NO-GO** for implementation or enablement

This record separates publicly documented technical behavior from approval for this application. Public documentation, an affiliate signup page, or public website behavior is not a contract, production access grant, or permission to display, cache, retain, link to, or brand StubHub data. No operator-reviewed approval is recorded in this repository.

## Sources reviewed

Reviewed on 2026-08-31 without making an API request:

- [Catalog API](https://developer.stubhub.com/api-reference/catalog/)
- [Authentication: basic steps](https://developer.stubhub.com/docs/authentication/basic-steps/)
- [Application-only authentication flow](https://developer.stubhub.com/docs/authentication/application-only-authentication-flow/)
- [Published scopes](https://developer.stubhub.com/docs/authentication/scopes)
- [API access instructions](https://developer.stubhub.com/blog/)
- [StubHub affiliate program](https://www.stubhub.com/affiliates)

These sources support only the technical observations below. They do not show that a production application, scope, endpoint, affiliate account, or usage right has been granted to this operator.

## Dated technical-feasibility findings

As of 2026-08-31, Catalog's event resource exposes `min_ticket_price`; no event-level maximum-price field is documented. A future event summary must represent it as `minCents` with `maxCents: null` and display **“From $X”** (using normal currency formatting). It is not a marketplace range or listing quote.

No maximum may be manufactured from a request/result limit, incomplete pagination, a sample of returned records, website HTML, or seller constraints. Scraping is not an acceptable fallback.

The published `read:sellerlistings` scope is access to the user's listings. Fields from that authenticated seller inventory describe the authenticated seller's own inventory, are not marketplace aggregates, and must never supply marketplace minimum or maximum prices.

StubHub documents application-only OAuth/client credentials for public, non-user-specific data; its basic steps include events and listings as examples. The published scope list includes `read:events`, but no distinct buyer-listings scope. The exact production scopes and endpoints granted to this application for buyer-visible marketplace listings must be confirmed. A public example is not a production grant.

Catalog documents pagination inputs such as `page` and `page_size`, and event type `Main` or `Parking`. This makes a bounded event-summary integration technically plausible but establishes neither approved bounds, completeness, rate limits, nor sufficient classification rules. The fee basis of `min_ticket_price` is not documented in the reviewed sources and remains `unknown` until StubHub confirms its fees, taxes, quantity, and currency meaning.

The API-access post directs affiliates and buyer-finding applications to StubHub's affiliate channel. The affiliate page describes joining through Partnerize and says API keys are available on request after joining. These are instructions for seeking access, not evidence that this operator is accepted or has API, linking, or display rights.

## Go/no-go table

“GO after evidence” means technically plausible but prohibited until application-specific evidence is recorded and reviewed. `NO-GO` means the public material is insufficient.

| Decision area | Public technical evidence (2026-08-31) | Current decision and operator gate |
|---|---|---|
| Catalog event access | Catalog documents event endpoints; application-only OAuth is documented for public data. | **GO after evidence:** production approval, exact endpoints, `read:events` grant, environment, territory, and fields. Until then **NO-GO**. |
| Minimum price display | Event resource documents `min_ticket_price`; fee basis is undocumented. | **GO after evidence:** only `{ minCents, maxCents: null, priceBasis: "unknown" }`, rendered “From $X”; confirm currency and display rights. |
| Maximum price display | No event-level maximum is documented; seller inventory is user-specific. | **NO-GO:** never infer one from limits, pages, samples, HTML, seller data, or constraints. Keep `maxCents: null`. |
| Buyer-visible listings | Basic guidance calls listings public data, but published scopes do not name a buyer-listings scope; `read:sellerlistings` is for the user's listings. | **NO-GO:** require exact production scope/feed, schema, fields, territory, and explicit marketplace-display rights. Seller listings cannot substitute. |
| Fee semantics | Catalog names `min_ticket_price` but does not define fee/tax/quantity basis. | **NO-GO** for all-in, comparison, or ranking claims. Require written treatment of per-ticket/order fees, taxes, delivery, quantity, currency, and rounding. |
| Event and parking classification | Catalog documents `Main`/`Parking`; some searches expose `exclude_parking_passes`. | **GO after evidence:** require complete classification/filter rules; parking remains outside admission and unknown types are rejected or quarantined. |
| Deep/affiliate links | Catalog documents webpage link relations; affiliate page describes Partnerize enrollment. | **NO-GO:** require accepted account, URL templates, parameters, channels, territory, redirects, encoding, and exact hosts. Construct no links first. |
| Attribution and disclosure | Public pages establish no application-specific wording or placement. | **NO-GO:** require exact attribution, affiliate disclosure, price/freshness qualification, placement, and proximity rules. |
| Rate limits and pagination | Catalog documents `page`/`page_size`; no application quota, ceiling, completeness guarantee, or cadence is established. | **NO-GO:** require quotas, headers, retry/backoff, page semantics, bounded requests, termination, and refresh interval. Partial traversal cannot define a maximum. |
| Cache, stale retention, and historical retention | Not settled by reviewed sources. | **NO-GO:** require cache TTL, stale/last-good permission, raw/normalized/history retention and deletion, and purge timing. |
| Allowed hosts | Public examples are not an application-specific allowlist. | **NO-GO:** require approved API, OAuth, canonical, affiliate, and redirect hosts. Repository allowlists stay empty; guess no hostname. |
| OAuth secret handling | Application-only flow documents client credentials and Basic authentication for token acquisition. | **GO after evidence:** approve flow, token audience/scope/endpoint, secret owner and rotation. Secrets never enter source, logs, browser output, URLs, fixtures, or snapshots. |
| Trademark/logo use | Public display of StubHub branding grants no reuse right. | **NO-GO:** require written asset/word-mark permission and guidelines, or an explicit text-only decision. |
| Takedown and provider-disable requirements | Not settled by reviewed sources. | **NO-GO:** require removal behavior, takedown contact/SLA, purge obligations, revocation response, and tested immediate disable procedure. |

## Exact operator evidence still required

Before changing `PENDING`, record a dated, non-confidential approval package containing:

1. Approval owner/reviewer/date; StubHub/Partnerize account and application identifiers; environment; use case; channels; territories; term/expiry.
2. StubHub portal grant, contract excerpt, or direct written approval for this application. Public documentation alone is insufficient.
3. Exact production Catalog endpoints, requested/granted OAuth scopes, token endpoint/audience, and confirmation that application-only access covers each endpoint.
4. For buyer-visible listings: exact marketplace endpoint/feed and scope, response schema/version, permitted fields, pagination/completeness contract, and confirmation that it is buyer-visible marketplace inventory—not authenticated-seller inventory.
5. StubHub's definition of `min_ticket_price`: currency, quantity basis, included/excluded per-ticket and order fees, taxes, delivery, rounding, and permitted “from” wording.
6. Event/admission/parking/other classification fields and exclusion rules, including missing/unknown types.
7. Canonical/affiliate link templates, Partnerize campaign approval, parameters, redirects, encoding, channels/territories, disclosure, and every allowed public host.
8. Attribution, affiliate disclosure, price/freshness wording and placement, sorting/parity restrictions, and text-only or logo permission.
9. Rate quota/headers, retry/backoff, page-size/page/request bounds, termination/completeness behavior, and refresh interval.
10. Cache TTL; stale/last-good permission; raw, normalized, and historical retention/deletion; purge timing.
11. Credential custodian, approved server-side secret names/store, least privilege, rotation/revocation, and redaction—without secret values.
12. Cancellation/removal behavior, takedown contact/SLA, provider purge, contract revocation, and immediate-disable requirements.
13. Legal/operator sign-off on the normalized fields and UX, followed by a reviewed change to this record and the matrix that deliberately moves the status from `PENDING`.

## Proposed future adapter contract (not approved)

```ts
interface ProposedStubHubApproval {
  reviewedAt: string;
  applicationId: string;             // non-secret operator record
  environment: "production";
  territories: string[];
  grantedScopes: string[];
  catalogEndpoints: string[];
  buyerListingEndpoints: string[];   // empty unless separately approved
  apiHosts: string[];
  publicHosts: string[];
  minPriceBasis: "unknown" | "base" | "all-in";
  pagination: { pageSize: number; maxPages: number; maxRequests: number };
  timing: { minRefreshMs: number; freshnessMs: number; retentionMs: number };
  approvalEvidenceId: string;
  reviewedBy: string;
}

interface ProposedStubHubEventPrice {
  provider: "stubhub";
  marketType: "marketplace";
  minCents: number | null;
  maxCents: null;                     // Catalog documents no event maximum
  currency: "USD" | "CAD";
  priceBasis: "unknown" | "base" | "all-in";
  capturedAt: string;
  sourceIdentifier: string;
  maxIsCapped: false;
}
```

The first approved version should be event-summary-only unless evidence separately authorizes buyer-visible marketplace listings. It must accept only the Catalog minimum, render “From $X,” preserve `maxCents: null`, reject seller inventory as marketplace prices, keep parking separate, bound pagination, and enforce separately approved API/public hosts. Missing or ambiguous evidence fails closed.

## Enforced repository gate

The adapter remains impossible to enable while this record is `PENDING`: its registry entry has `approvalStatus: "pending"`, no credential environment variable, and empty allowed hosts; configuration rejects enabling it; and direct synchronization throws `RIGHTS_APPROVAL_REQUIRED`. No StubHub fixture, request, mapping, link constructor, hostname, or credential was added. Implementing it requires the evidence above to be recorded and reviewed first, then a separate approved change to the registry gate and contract tests. Scraping must never be introduced as a fallback.
