# Game page scores, updates, and recaps

## Manual game state

Edit `src/data/nfl/game-status.json`. Entries are keyed by the game ID already used in the schedule and game-page URL. For example:

```json
{
  "games": {
    "12345": {
      "status": "in_progress",
      "{team}Score": 17,
      "opponentScore": 14,
      "quarter": "3rd quarter",
      "clock": "08:42",
      "updates": [
        { "timestamp": "2026-09-13T22:15:00Z", "quarter": "3rd quarter", "clock": "08:42", "text": "Seattle takes the lead on a touchdown drive." }
      ]
    }
  }
}
```

Use `upcoming`, `in_progress`, or `completed` for `status`. Remove the game's entry to use the imported NFL status again. Updates are displayed newest first by ISO 8601 `timestamp`. After editing, run the normal build (`npm run build`) and publish the generated site through the existing release process.

Tickets are hidden once a confirmed kickoff has passed, even if no manual entry exists. That fallback treats the game as in progress; only an explicit `completed` status from this file or the NFL snapshot displays a final result.

## Airflow recap connection

The website does not generate recaps. Airflow must publish a JSON snapshot to a local path available to the build worker, and the normal build must set `AIRFLOW_RECAP_SNAPSHOT` to that path before the existing recap build step runs. No Airflow output location is configured in this repository yet.

The snapshot contains `season`, `updatedAt`, and `recaps`, keyed by game ID. `recaps` may instead be an array whose entries contain `gameId`. A recap may use structured `segments` and `bullets`, or the existing `text`, `summary`, or `excerpt` fields. Empty or invalid incoming entries are skipped, and recaps absent from a new snapshot remain in `src/data/nfl/gameRecaps.json` so previously valid content is preserved.
