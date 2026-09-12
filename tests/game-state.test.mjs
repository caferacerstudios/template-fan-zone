import assert from "node:assert/strict";
import test from "node:test";
import { gamePresentation } from "../src/lib/game-state.mjs";

const model = (state = "upcoming", startsAt = "2026-09-13T20:00:00Z") => ({
  id: "12345", seaScore: null, opponentScore: null,
  game: { state, startsAt, timeConfirmed: true },
});

test("uses the source status when no manual override exists", () => {
  assert.equal(gamePresentation(model("completed"), {}, new Date("2026-09-13T19:00:00Z")).state, "completed");
});

test("hides tickets after confirmed kickoff without marking the game final", () => {
  assert.equal(gamePresentation(model(), {}, new Date("2026-09-13T20:01:00Z")).state, "in_progress");
});

test("manual state, scores, clock, and newest-first updates are applied", () => {
  const result = gamePresentation(model(), { games: { "12345": {
    status: "completed", {team}Score: 24, opponentScore: 20, quarter: "Final", updates: [
      { timestamp: "2026-09-13T20:01:00Z", text: "Older" },
      { timestamp: "2026-09-13T20:02:00Z", text: "Newer" },
    ],
  } } }, new Date("2026-09-13T19:00:00Z"));
  assert.equal(result.state, "completed");
  assert.equal(result.{team}Score, 24);
  assert.equal(result.opponentScore, 20);
  assert.deepEqual(result.updates.map((update) => update.text), ["Newer", "Older"]);
});

test("an upcoming override cannot expose tickets after confirmed kickoff", () => {
  const result = gamePresentation(model(), { games: { "12345": { status: "upcoming" } } }, new Date("2026-09-13T20:01:00Z"));
  assert.equal(result.state, "in_progress");
});
