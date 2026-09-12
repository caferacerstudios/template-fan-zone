import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getWatchGuideEntry, isHttpUrl, watchGuideScheduleLines } from "../src/lib/watch-guide.mjs";

const watchGuide = JSON.parse(await readFile(new URL("../src/data/nfl/watch-guide-2026.json", import.meta.url), "utf8"));
const component = await readFile(new URL("../src/components/GameDayPage.astro", import.meta.url), "utf8");

test("watch guide entries match season, normalized phase, and week without mutating the game", () => {
  const game = Object.freeze({ id: "unrelated-id", season: 2026, phase: "regular", week: 17 });
  const entry = getWatchGuideEntry(game, watchGuide);
  assert.equal(entry.kickoffLabel, "10:00 a.m. PST");
  assert.equal(entry.localTv[0].name, "FOX 13 Seattle");
  assert.deepEqual(entry.streams.map(({ name }) => name), ["FOX One", "NFL Sunday Ticket"]);
  assert.equal(entry.officialGameUrl, "https://www.{team}.com/game-day/2026/reg-week17/{team}-at-panthers/");
  assert.deepEqual(game, { id: "unrelated-id", season: 2026, phase: "regular", week: 17 });
  assert.equal(getWatchGuideEntry({ season: 2026, phase: "postseason", week: 1 }, watchGuide), null);
});

test("schedule summaries use the static guide's concise provider labels", () => {
  const entry = (week) => getWatchGuideEntry({ season: 2026, phase: "regular", week }, watchGuide);
  assert.deepEqual(watchGuideScheduleLines(entry(1)), ["KING 5", "NBC · Peacock"]);
  assert.deepEqual(watchGuideScheduleLines(entry(6)), ["FOX 13 simulcast", "Prime Video"]);
  assert.deepEqual(watchGuideScheduleLines(entry(13)), ["KOMO 4", "ABC · ESPN"]);
  assert.deepEqual(watchGuideScheduleLines(entry(18)), ["TBD"]);
  assert.equal(entry(18).dateLabel, "Date TBD");
  assert.equal(entry(18).kickoffLabel, "Time TBD");
  assert.equal(entry(18).national, "Date, time, network, and stream TBD");
});

test("server component covers replay, bye, fallback, TBD, and safe external links", () => {
  const preseason = getWatchGuideEntry({ season: 2026, phase: "preseason", week: 1 }, watchGuide);
  assert.equal(preseason.status, "completed");
  assert.equal(preseason.replay[0].name, "NFL+");
  assert.match(component, /Broadcast and Replay/);
  assert.match(component, /Replay on \{provider\.name\}/);
  assert.match(component, /!isBye/);
  assert.match(component, /Viewing information coming soon\./);
  assert.match(component, /watchEntry\.status === "tbd"/);
  assert.match(component, /target="_blank" rel="noopener noreferrer"/);
  assert.equal(isHttpUrl("https://example.com/watch"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.doesNotMatch(component, /1392467/);
});
