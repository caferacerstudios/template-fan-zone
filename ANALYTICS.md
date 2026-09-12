# Analytics and performance telemetry

The site uses the lightweight helper in `src/lib/analytics.ts`. Components must not call a vendor API directly. Use `window.sfzAnalytics.track(name, parameters)` or, preferably, declarative HTML:

```html
<a data-analytics-event="related_story_click" data-analytics-article-category="recap" href="/story">Story</a>
```

Events are lower-case `snake_case`. Unknown events and parameters are discarded. Values are trimmed and limited to 100 characters. Never provide email addresses, names, search text, free-form user text, precise location, full external URLs, or other personal data.

## Consent and delivery

Nothing is emitted unless the Task 11 consent model exposes `window.sfzConsent.analytics === true` or stores JSON in `localStorage` under `sfz-consent` (legacy `sfz_consent` is also recognized) with `analytics: true`. When consent changes, dispatch `sfz:consent-change` on `window`. The existing Cloudflare beacon follows the same contract.

Every accepted event is pushed to `window.dataLayer` and dispatched locally as `sfz:analytics`. Set `PUBLIC_ANALYTICS_ENDPOINT` at build time to additionally POST JSON to a first-party collector. No endpoint is contacted when it is unset. Development builds, localhost, loopback, and comma-separated hostnames in `PUBLIC_ANALYTICS_EXCLUDE_HOSTS` are excluded.

The first UTM values (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`) are retained in session storage and included on consented events. Arbitrary query parameters are never included in `page_path`.

## Event reference

| Event | When | Optional parameters |
| --- | --- | --- |
| `page_view` | Initial load or client navigation; deduplicated by path | `page_path` |
| `next_game_click` | Next-game navigation | `opponent` |
| `game_center_click` | Game center/recap link | `season`, `opponent` |
| `article_open` | Article opened from a listing | `article_category` |
| `related_story_click` | Related-story selection | `article_category` |
| `player_open` | Player profile link | `season` |
| `schedule_filter` | Schedule/season filter changed | `filter_type`, `filter_value`, `season` |
| `standings_open` | Standings link | `season` |
| `newsletter_submit` | Newsletter form submission | no entered form values |
| `poll_vote` | Poll selection | `poll_id`, `poll_choice` (stable IDs, not free text) |
| `external_source_click` | HTTP(S) link leaving the site | `link_domain` only |
| `share_action` | Native share or copy-link action | `share_method` |
| `search_submit` | Search form submission | `result_count` only; never the query |
| `web_vital` | Real-user Core Web Vital on page hide | `metric_name`, `metric_value`, `metric_rating`, `metric_id`, `navigation_type` |
| `ad_slot_requested` | Element with `data-ad-slot="location"` appears | `slot_location` |
| `ad_slot_rendered` | That slot gains an iframe or `data-ad-status="filled"` | `slot_location` |

All events also receive available `page_type`, `season`, `opponent`, `article_category`, `device_class`, and session UTM attribution. External links, game-center links, player links, and standings links are classified centrally. No listener exists for ad clicks.

## Web Vitals

LCP, INP, and CLS are collected with native `PerformanceObserver`; no package is required. Ratings use Google's 75th-percentile targets: LCP at or below 2,500 ms, INP at or below 200 ms, and CLS at or below 0.1 are `good`. Aggregate production events by page/device and evaluate the 75th percentile; the browser event itself is a single real-user observation.

Publisher ad markup should identify location without user or campaign data, for example `<ins data-ad-slot="article_mid"></ins>`. Render detection is best-effort because ad providers control iframe behavior. Ad clicks must never be instrumented.
