# AdSense readiness review — September 11, 2026

This review does not enable ads or claim that AdSense approval will follow. `ADS_ENABLED` remains false unless an owner changes deployment configuration.

## Finding status before changes

| Finding | Fresh review status | Evidence |
| --- | --- | --- |
| Newest article selection | Resolved; preserve | Production homepage showed the September 10 daily story and repository selectors sort by `publishedAt`. |
| Game 1392216 raw player objects | Resolved; preserve | Production rendered linked player names and a completed-game recap. |
| Daily citation markers | Reproducible | Production rendered literal `[S1][S2][S3]` immediately before valid numbered links. |
| Daily story accuracy | Reproducible | Production conflated “questionable” with final inactive status, called September 9–20 a short runway, and inferred game performance from pregame availability reporting. |
| Contract coordinator | Reproducible | Production called Klint Kubiak the current coordinator; the official 2026 staff announcement names Brian Fleury. |
| Introductory recommendations | Reproducible | Production homepage promoted the game-week and roster-introduction posts. |
| Team statistics | Reproducible | Production Team Stats said no games had been played while the homepage showed Seattle 1–0 and 13–10. |
| Regular standings | Reproducible, payload inspection requires production access | Production showed only Seattle. The tracked snapshot is older than the opener and has no regular-season rows. |
| JSN profile repetition/label | Reproducible | Production repeated the opener line in the biography and showed “Historical season totals” for active 2026 data. |
| Cloudflare/privacy state | Production setting requires owner verification | HTML contained the application’s conditional Cloudflare loader with an empty token. A static response did not prove whether a dashboard/edge setting can inject analytics for real visitors. |
| Getty metadata | Producer/runtime access required | Website documentation defines photo metadata; the related Airflow producer and private photo metadata are not in this checkout. |

Commands and pages inspected: `git status --short --branch`, `git log -8 --oneline --decorate`, targeted `rg`, `sed`, `jq`, and `curl -LfsS` against the homepage, `/news`, both named articles, game 1392216, `/team`, `/standings`, JSN’s profile, and `/privacy-policy`. Official {Team} pages for the inactive report, 2026 staff, and JSN extension were also reviewed.

## Correction and validation ownership

The accepted daily article is `/var/lib/sfz-news/days/2026-09-10/article.json` in the news runtime. The repository correction overlay is a guard that survives snapshot imports; it is not a replacement for correcting that authoritative record. Laura owns the runtime edit and republish steps documented in `docs/daily-news-airflow.md`.

The related `homelab-airflow/deployment/news/` producer should emit only numbered citation anchors or apply the same strict rule as `normalizeGeneratedCitations`: an `[S<number>]` marker is supported only when the paragraph includes a numbered anchor for that exact source-list URL. Unknown or mismatched IDs must fail before acceptance, leaving the last accepted release in place. Do not strip arbitrary bracketed text.

For production NFL investigation, collect a sanitized copy containing these exact fields:

- root: `season`, `sourceSeason`, `updatedAt`, `team.id`, `team.abbreviation`;
- every 2026 game: `id`, `season`, `phase`, `state`, `season_type`, `seasonType`, `status`, `postseason`, `home_team`, `visitor_team`, `homeTeam`, `awayTeam`, `home_team_score`, `visitor_team_score`;
- `teamSeasonStats` if present;
- the imported standings root metadata and all `phases.regular.rows`, plus the upstream BALLDONTLIE record rows before filtering.

Laura should attach that sanitized sample to the existing review task. Do not include API keys, request headers, or private runtime configuration. This distinguishes a provider response with only Seattle from a pipeline filter that dropped Arizona, Los Angeles, or San Francisco.

## Owner actions before monetization

1. Laura reviews the September 10 corrected body against its three linked sources, records actual human review in the existing editorial metadata/task, edits the authoritative accepted record without changing slug, `publishedAt`, or publication day, sets the real update time, republishes, and runs the import/build cycle.
2. In `homelab-airflow`, add producer-side citation validation and preserve the 08:00 America/Los_Angeles schedule and current random photo-folder selection.
3. Run focused JSN generation only: `PLAYER_PROFILE_ID=jaxon-smith-njigba npm run generate-player-profiles`. Confirm the authoritative runtime artifact changed, other profile hashes did not, and the build/import cycle retains it. This requires the runtime artifact and configured model access unavailable here.
4. Review game 1392216’s authoritative recap and change the sentence to separate JSN’s offensive contribution from the defense (for example: Seattle received 122 receiving yards and a touchdown from JSN, while the defense held New England to 10 points). Add only evidence available in the game payload/source, then republish through the recap workflow.
5. In Cloudflare: open the production zone, go to **Analytics & Logs → Web Analytics**, and verify whether automatic setup/injection is enabled for `{team}fanzone.com`. Record the setting and beacon site token privately. If analytics is intended, configure the application token/CMP path consistently; if not, disable automatic injection. Verify in a private browser with DevTools Network filtered for `beacon.min.js` and `cloudflareinsights.com`, both before and after consent where applicable.
6. Before enabling ads, supply the real AdSense publisher ID, publish the publisher-provided `ads.txt` line, configure a Google-certified CMP for applicable regions, verify Privacy Choices opens it, and review the policy text. Never use a dummy ID. Keep `ADS_ENABLED=false` until these checks and Laura’s content review are complete.
7. For every Getty file considered by the producer, populate runtime metadata from the licensed asset record: real photographer (when supplied), provider `Getty Images`, useful caption/alt, and whether it is illustrative. Keep license/reference IDs private. Confirm the public figcaption carries the supplied credit and never invents one.

## Local validation commands

Run when Node/npm are available:

```sh
node --test tests/news-snapshot.test.mjs tests/team-stats.test.mjs tests/news-route.test.mjs tests/standings.test.mjs tests/recap-player-links.test.mjs
npm run build:offline
NEWS_SNAPSHOT_DIR=/path/to/sanitized/current node scripts/import-news-snapshot.mjs --check-only
npm run build:offline
```

Then inspect desktop and mobile output for `/`, `/news`, the two corrected articles, `/games/1392216`, `/team`, `/standings`, `/players/jaxon-smith-njigba`, `/about`, and `/privacy-policy`. Check player links, all citation destinations, published/updated labels, image captions/credits, partial-data language, footer privacy links, and the Privacy Choices fallback.
