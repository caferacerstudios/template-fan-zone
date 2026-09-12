# Provider Event Match Review

Generated deterministically from committed fixtures.

## Matched events

- sea:fixture-game-home → fictional-provider:PROVIDER-GAME-1 (high, teams-venue-time)
- sea:fixture-game-override → fictional-provider:PROVIDER-MANUAL-1 (high, manual)

## Rejected candidates

- fictional-provider:PROVIDER-PARKING-1 for sea:fixture-game-home: parking-event
- fictional-provider:PROVIDER-RAMS-TBD for sea:fixture-game-home: both-teams-not-confirmed, date-conflict
- fictional-provider:PROVIDER-MANUAL-1 for sea:fixture-game-home: non-nfl-event-type
- fictional-provider:PROVIDER-BAD-SHELL for sea:fixture-game-home: manual-block
- fictional-provider:PROVIDER-GAME-1 for sea:fixture-game-tbd: both-teams-not-confirmed, venue-conflict, date-conflict
- fictional-provider:PROVIDER-PARKING-1 for sea:fixture-game-tbd: parking-event
- fictional-provider:PROVIDER-MANUAL-1 for sea:fixture-game-tbd: non-nfl-event-type
- fictional-provider:PROVIDER-BAD-SHELL for sea:fixture-game-tbd: speculative-shell
- fictional-provider:PROVIDER-GAME-1 for sea:fixture-game-override: both-teams-not-confirmed, date-conflict
- fictional-provider:PROVIDER-PARKING-1 for sea:fixture-game-override: parking-event
- fictional-provider:PROVIDER-RAMS-TBD for sea:fixture-game-override: both-teams-not-confirmed, venue-conflict, date-conflict
- fictional-provider:PROVIDER-BAD-SHELL for sea:fixture-game-override: speculative-shell

## Unresolved games

- sea:fixture-game-tbd: review-required
