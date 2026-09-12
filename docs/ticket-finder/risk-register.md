# Ticket Finder Risk Register

> **Historical planning record:** ratings and repository observations below were recorded before the current implementation. Use [`README.md`](README.md), [`data-contract.md`](data-contract.md), and [`../ticket-sync-deployment.md`](../ticket-sync-deployment.md) for current behavior.

Ratings are proposed planning values, not measured production results. Owners, thresholds, and acceptance decisions are **operator decisions required**.

| Risk | Likelihood | Impact | Controls and detection | Launch/response rule |
|---|---|---|---|---|
| Misleading base-price comparison | High | High | Preserve fee completeness, currency, unit, quantity basis, provider definition, and exclusions. Compare only like-for-like rows; separate event “starting at” from listings. | No “lowest,” “best,” or all-in claim for `partial`, `base_only`, or `unknown`. Block launch until display language is approved. |
| Stale inventory | High | High | Provider/listing/snapshot timestamps and expiry; independent refresh; last-success monitoring; omit expired rows. | After expiry, show unavailable status instead of price. Operator selects freshness SLA. |
| Duplicated syndicated inventory | Medium | High | Provider-scoped IDs; approved fingerprints using event, location, quantity, price and fulfillment; label providers; avoid claiming unique ticket counts. | Do not collapse records across providers unless rights and identity are certain; suppress suspicious comparisons for review. |
| Bad event matching | Medium | High | Crosswalk first; require both teams, venue and time window; confidence levels; manual audit; reschedule tests. | Only high-confidence/approved manual matches publish. Kill affected event/provider on conflict. |
| Leaked credentials | Low | Critical | Secret store; no `PUBLIC_` provider variables; server-side sync only; log redaction; bundle/snapshot scanning; scoped rotation. | Stop publication, disable/rotate credential, invalidate artifacts, investigate. Never put provider APIs in the browser. |
| Provider rate limits | High | High | Contracted limits in matrix; rate-aware scheduler; backoff/jitter; request budgets; cache within approved limits; per-provider isolation. | Never bypass limits. Degrade/disable provider while retaining only unexpired approved data. |
| Provider contract changes | Medium | Critical | Dated approval sources; review cadence; provider kill switches; schema/field allowlists; change owner. | Disable affected provider whenever permissions or terms are uncertain; reapprove before resuming. |
| Trademarks and seat-map rights | Medium | High | Matrix separates logo/trademark, images and attribution rights; use text names by default; do not copy marketplace/venue seat maps. | No logos, branded assets, ticket images, or seat maps without explicit rights. |
| Thin affiliate content | Medium | High | Add original event context, comparison methodology, meaningful filters, fee/freshness explanations and user value; keep ads subordinate; sitemap only when substantive. | Do not index or launch a page that is primarily undifferentiated affiliate links. Editorial/SEO review required. |
| Provider outages | High | Medium/High | Per-provider status and isolation; candidate validation; last-known-good; minimum-coverage gate; unavailable state; alerts. | Outage cannot block unrelated site deployment. Publish only unexpired data; disable provider or page below chosen coverage. |
| Flexed or rescheduled NFL games | High in flex windows | High | Reconcile every sync against schedule ID, teams, venue and kickoff; flag material changes; expire old matches; visible TBD/postponed state. | Freeze links/prices for affected event until rematch passes; do not treat kickoff time as stable identity. |

## Additional current-architecture risks

- The tracked checkout lacks generated `src/data/nfl/`, while schedule/game routes import it directly. Clean offline Astro builds therefore require a fixture or prior data refresh.
- `npm run build` always contacts NFL and generative services through `prebuild`; this makes unrelated builds non-reproducible and credential/network dependent. Ticket sync must not extend that coupling.
- There is no package-level test/check/validation command even though tests and standalone validation scripts exist.
- Generic outbound analytics exists, but consent event/state names differ between `BaseLayout` (`sfz:privacy-consent`, `sfzPrivacy`) and `analytics.ts` (`sfz:consent-change`, `sfzConsent`). Ticket measurement must not rely on this until behavior is verified and reconciled.
- Nginx applies seven-day caching to `.json` via neither its asset regex nor a dedicated rule; the selected snapshot delivery architecture needs explicit cache semantics if JSON is served separately. Static HTML otherwise changes only on rebuild/deploy.
- The sitemap is explicit rather than automatic. `/tickets` could be omitted accidentally, or added prematurely while thin/unavailable.
- The current disclosure is generic and does not explain ticket-provider compensation, ranking, fee differences, inventory freshness, or marketplace responsibility.
- The legacy `/games-for-sale` route is off-brand and eBay-backed. Reusing or redirecting it would confuse users and search engines.

## Residual-risk decisions

Before launch, the operator must set and document: accepted stale-data duration; minimum healthy-provider count; acceptable fee completeness; comparison quantity; duplicate-handling policy; reschedule review time; retention duration; incident contacts; trademark posture; indexing threshold; and which residual risks receive legal/product acceptance.
