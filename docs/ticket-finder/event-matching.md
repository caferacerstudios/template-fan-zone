# Provider event matching

`src/lib/tickets/match.mjs` consumes the existing normalized SFZ schedule plus provider event candidates. It does not fetch, generate, or maintain a {Team} schedule. All exported operations are deterministic and side-effect free except the separate fixture-report script.

## Identity and publication

`sfzEventKey(game)` returns `sea:<schedule game ID>`. Kickoff, venue, week, and opponent are deliberately absent so a flex, postponement, or venue change cannot change identity. Missing IDs, byes, and the schedule normalizer's synthesized display fallback are rejected.

Automatic publication requires one—and only one—high-confidence candidate. High confidence requires both NFL teams, correct home/away order, matching venue, and a kickoff within six hours. A same-date Week 18/TBD candidate is medium confidence and review-only. All medium and low confidence is review-only. Conflicting home/away, season phase, or dates beyond the 14-day reschedule window are rejected. A venue conflict or plausible reschedule is retained for review, not published.

Provider-local timestamps must supply an offset-free `localStart` and an IANA `timeZone`; UTC/offset timestamps may use `startTimeUtc`, `startsAt`, or `datetime`. Team/attraction crosswalks are injected as `attractionIds`, keeping provider-specific IDs outside the generic matcher.

Parking, tailgate, hospitality-only, watch-party, speculative, duplicate, wrong-phase, and explicitly non-NFL event candidates fail closed before scoring.

## Manual overrides

The registry is `src/data/tickets/match-overrides.json`. It follows the project's committed JSON-data convention and contains no credentials or provider documentation. Its schema is:

```json
{
  "schemaVersion": "1.0.0",
  "overrides": [{
    "action": "map | block",
    "sfzEventKey": "sea:<schedule game ID>",
    "provider": "provider slug",
    "providerEventId": "provider event ID",
    "note": "operator-safe context",
    "addedAt": "ISO 8601 timestamp",
    "reason": "why the override was required"
  }]
}
```

A block takes precedence over automatic evidence. A map is a reviewed, high-confidence manual match. `validateMatchOverrides` rejects incomplete, malformed, or duplicate registry entries.

## Fixture review

The ticket-sync operator owns the committed match-review artifact. Run `npm run tickets:match-report` to regenerate `docs/ticket-finder/match-review.md` from committed synthetic fixtures before reviewing match-rule or override changes. The command makes no network calls.
