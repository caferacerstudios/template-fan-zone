# Trending Now editorial rules

The `Trending Now` list is selected at build time from `src/data/trending.json`. It contains no advertisements or external links and renders at most five substantive {Team} Fan Zone pages.

An item qualifies in exactly one of these ways:

1. **Editorial pin:** `pinnedAt` is at or before the build time and `pinExpiresAt` is after the build time. Both timestamps are required. When the expiry time is reached, the item is automatically excluded from the next build.
2. **First-party views:** `publishedAt` is no more than 14 days before the build time and `firstPartyViews` is an integer of at least 100. The field must come from {Team} Fan Zone's own analytics; omit it when no supported count exists. Never estimate or copy a social-media count.

All candidates also require a title, topic/category, valid publication timestamp, and a root-relative internal URL without a fragment. Editorial pins rank first, followed by qualifying first-party stories. Within those groups the sort is first-party views (highest first), publication time (newest first), then title for a stable tie-break. Only the first five render.

Editors must review pins before their expiration and either set a new, justified expiration or let them fall out. A missing or invalid expiration never produces an active pin. Publication timestamps describe when the linked coverage became available or received a substantive editorial update; changing a timestamp only to manufacture freshness is not permitted.
