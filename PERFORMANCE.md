# Performance policy

The release targets are the Core Web Vitals “good” thresholds at the 75th percentile:

- LCP: no more than 2.5 seconds
- INP: no more than 200 milliseconds
- CLS: no more than 0.1

Use field data segmented by page type and mobile/desktop whenever enough visits exist. Lab results are a release diagnostic, not a substitute for field data.

## Current audit

- Rendering: Astro emits article lists, schedules, standings, statistics, related links, and game pages as static HTML. The pages remain readable when JavaScript is delayed or disabled.
- JavaScript: client code is limited to navigation, roster filtering/sorting, countdown, carousel, and share controls. No client framework is shipped.
- CSS: one 19 KiB public stylesheet plus page-scoped Astro CSS. The shared stylesheet is render-blocking by design to avoid unstyled layout shifts.
- Fonts: the design uses system font stacks. There are no font downloads, extra families, or unused weights.
- Images: five 1024×1536 player PNG originals account for roughly 12.8 MB. Logos and editorial carousel images also use public assets. `ResponsiveImage.astro` is the required path for new editorial images: provide AVIF/WebP sources and width-based `srcset` values, retain a fallback, and set intrinsic dimensions.
- Embeds: no iframe or video embeds exist. Future noncritical embeds should use a click-to-load placeholder with the same aspect ratio as the final player.
- Analytics: Cloudflare Insights is loaded after `load` during idle time so it can provide real-user data without competing with critical rendering.
- Advertising: AdSense is not loaded unless advertising, a valid publisher ID, a CMP URL, and an eligible slot are configured. Active slots reserve dimensions before requesting an ad, preventing the placement itself from causing layout shift.
- Third parties: initial HTML has no third-party script request. Analytics is delayed; advertising is conditional. External marketplace images remain lazy-loaded.
- Caching: Astro’s fingerprinted `/_astro/` assets are immutable for one year. Stable-name public assets use a seven-day cache and remain revalidatable.

## Image rules

For a likely hero/LCP image, set `priority` on `ResponsiveImage`; never lazy-load it. Give it an accurate `sizes` value and include its dimensions. Below-the-fold images must retain the default lazy loading. Do not mark multiple images as high priority.

Convert photographic originals to AVIF and WebP at useful content widths before adding them. Keep the original only as a fallback when necessary. The player-image lookup prefers AVIF, then WebP, JPEG, and PNG when equivalent basenames exist.

## Regression checks

Every Astro production build runs `scripts/performance-budget.mjs` after output is complete. It fails for more than 150 KiB of emitted JavaScript, 14 MiB of total images, a single image over 3 MiB, or more than two third-party origins referenced by initial HTML. Tighten the image limits after the current player PNGs have optimized variants; do not raise a limit without recording the reason in the release review.

Before and after a major release, export the same 28-day field-data window and compare the 75th-percentile LCP, INP, and CLS by device and page type. Record sample size, traffic mix, release SHA, and deployment time. Investigate any threshold failure or deterioration of at least 10%, even when the metric remains “good.”
