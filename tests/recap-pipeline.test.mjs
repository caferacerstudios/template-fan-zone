import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateGameRecaps } from "../scripts/generate-game-recaps.mjs";
import { importRecapSnapshot } from "../scripts/import-recap-snapshot.mjs";

const timestamp = "2026-09-10T08:00:00.000Z";
const now = Date.parse(timestamp);
const game = { id: 1392216, season: 2026, season_type: "regular", status: "Final", week: 1,
  home_team: { abbreviation: "SEA" }, visitor_team: { abbreviation: "NE" }, home_team_score: 13, visitor_team_score: 10 };
const text = (v) => ({ t: "text", v, id: null, name: null });
const prose = { segments: [text("Seattle won 13–10.")], bullets: ["Seattle scored 13 points.", "New England scored 10 points.", "Seattle won its opener."] };
const read = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
function write(filename, data) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, `${JSON.stringify(data)}\n`); }
function workspace(t, { games = [game], recaps = {}, ...schedule } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sfz-recaps-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "src/data/nfl/gameRecaps.json");
  write(path.join(root, "src/data/nfl/{team}.json"), { season: 2026, games, gamesRegular: [], gamesPostseason: [], ...schedule });
  write(target, { season: 2026, updatedAt: "2026-09-09T08:00:00.000Z", recaps });
  return { root, target };
}
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const modelResponse = (value = prose) => response({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const options = (root, fetchImpl) => ({ projectRoot: root, env: { BALLDONTLIE_API_KEY: "test-bdl", OPENAI_API_KEY: "test-openai" }, now: () => now, sleep: async () => {}, fetchImpl });

test("missing final recap is generated, historical prose retained, and report matches output", async (t) => {
  const old = { gameId: "123", season: 2025, ...prose };
  const { root, target } = workspace(t, { recaps: { 123: old } });
  const calls = [];
  const config = options(root, async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("openai.com")) {
      assert.equal(JSON.parse(init.body).model, "gpt-4o-mini");
      return modelResponse();
    }
    return response({ data: [], meta: { next_cursor: null } });
  });
  config.env.RECAP_GENERATION_REPORT = path.join(root, "report.json");
  const report = await generateGameRecaps(config);
  assert.deepEqual(report.generatedGameIds, ["1392216"]);
  assert.equal(report.requestCount, 2);
  assert.equal(report.openaiRequestCount, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(read(config.env.RECAP_GENERATION_REPORT), report);
  const result = read(target);
  assert.equal(result.updatedAt, report.updatedAt);
  assert.deepEqual(result.recaps[123], old);
  assert.deepEqual(result.recaps[1392216].segments, prose.segments);
});

test("complete recaps and non-final/preseason/non-{Team} games make zero API requests", async (t) => {
  const complete = { ...prose, segments: [text("Laura's edited recap.")] };
  const { root, target } = workspace(t, { recaps: { 1392216: complete }, games: [
    game,
    { ...game, id: 2, status: "Scheduled" },
    { ...game, id: 3, status: "In Progress" },
    { ...game, id: 4, season_type: "preseason" },
    { ...game, id: 5, home_team: { abbreviation: "SF" } },
  ] });
  const report = await generateGameRecaps({ ...options(root, () => { throw new Error("Unexpected API request"); }), env: {} });
  assert.equal(report.generatedCount, 0);
  assert.equal(report.requestCount, 0);
  assert.equal(report.openaiRequestCount, 0);
  assert.deepEqual(read(target).recaps[1392216].segments, complete.segments);
});

test("paginated stats and plays share pacing; a plays 401 falls back to stats", async (t) => {
  const { root } = workspace(t);
  let clock = now;
  const requestTimes = [];
  const config = options(root, async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.openai.com") {
      const prompt = JSON.parse(JSON.parse(init.body).input[1].content);
      assert.equal(prompt.stat_rows_sample.length, 2);
      assert.deepEqual(prompt.key_plays, []);
      return modelResponse();
    }
    requestTimes.push(clock);
    assert.equal(url.searchParams.get("per_page"), "100");
    if (url.pathname.endsWith("/plays")) return response({}, 401);
    assert.equal(url.searchParams.get("game_ids[]"), "1392216");
    return response({ data: [{ player: { id: url.searchParams.has("cursor") ? 2 : 1 } }], meta: { next_cursor: url.searchParams.has("cursor") ? null : 100 } });
  });
  config.now = () => clock;
  config.sleep = async (delay) => { clock += delay; };
  const report = await generateGameRecaps(config);
  assert.equal(report.requestCount, 3);
  assert.deepEqual(requestTimes, [now, now + 15000, now + 30000]);
});

test("play-by-play pagination reaches the prompt", async (t) => {
  const { root } = workspace(t);
  const report = await generateGameRecaps(options(root, async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.openai.com") {
      const prompt = JSON.parse(JSON.parse(init.body).input[1].content);
      assert.equal(prompt.key_plays.length, 2);
      return modelResponse();
    }
    if (url.pathname.endsWith("/stats")) return response({ data: [] });
    const second = url.searchParams.has("cursor");
    return response({ data: [{ id: second ? 2 : 1, text: "A recorded play." }], meta: { next_cursor: second ? null : 100 } });
  }));
  assert.equal(report.requestCount, 3);
});

for (const [name, output] of [
  ["empty structured content", { status: "completed", output_text: JSON.stringify({ segments: [], bullets: [] }) }],
  ["incomplete response", { status: "incomplete", output_text: JSON.stringify(prose) }],
  ["refusal", { status: "completed", output: [{ content: [{ type: "refusal", refusal: "No" }] }] }],
]) {
  test(`invalid model output (${name}) preserves the previous file and writes no success report`, async (t) => {
    const { root, target } = workspace(t, { recaps: { historical: { ...prose, season: 2025 } } });
    const before = fs.readFileSync(target);
    const config = options(root, async (url) => String(url).includes("openai.com") ? response(output) : response({ data: [] }));
    config.env.RECAP_GENERATION_REPORT = path.join(root, "report.json");
    await assert.rejects(generateGameRecaps(config));
    assert.deepEqual(fs.readFileSync(target), before);
    assert.equal(fs.existsSync(config.env.RECAP_GENERATION_REPORT), false);
  });
}

function snapshot(root, recaps = { 1392216: { ...prose, gameId: "1392216", game, season: 2026 } }) {
  const directory = path.join(root, "snapshots/one");
  write(path.join(directory, "gameRecaps.json"), { season: 2026, updatedAt: timestamp, recaps });
  const manifest = { schema_version: 1, runId: "manual__recap", updatedAt: timestamp, season: 2026,
    sourceCommit: "a".repeat(40), nflSourceRunId: "manual__nfl", nflSourceUpdatedAt: "2026-09-10T07:47:08.367Z",
    generatedCount: 1, generatedGameIds: ["1392216"], requestCount: 2, openaiRequestCount: 1, model: "gpt-4o-mini",
    files: { "gameRecaps.json": createHash("sha256").update(fs.readFileSync(path.join(directory, "gameRecaps.json"))).digest("hex") } };
  write(path.join(directory, "manifest.json"), manifest);
  const current = path.join(root, "snapshots/current");
  fs.symlinkSync(directory, current);
  return { directory, current, manifest };
}

test("importer verifies checksums and check-only leaves existing prose untouched", (t) => {
  const { root, target } = workspace(t);
  const { current, directory } = snapshot(root);
  const before = fs.readFileSync(target);
  const result = importRecapSnapshot({ projectRoot: root, snapshotDir: current, now, checkOnly: true });
  assert.equal(result.snapshotDir, directory);
  assert.deepEqual(fs.readFileSync(target), before);
  fs.appendFileSync(path.join(directory, "gameRecaps.json"), " ");
  assert.throws(() => importRecapSnapshot({ projectRoot: root, snapshotDir: current, now }), /checksum mismatch/);
  assert.deepEqual(fs.readFileSync(target), before);
});

test("an unavailable optional recap snapshot retains validated repository data", (t) => {
  const { root, target } = workspace(t);
  const before = fs.readFileSync(target);
  const result = importRecapSnapshot({ projectRoot: root, snapshotDir: path.join(root, "missing/current"), ifAvailable: true });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(fs.readFileSync(target), before);
  assert.throws(() => importRecapSnapshot({ projectRoot: root, snapshotDir: path.join(root, "src/missing"), ifAvailable: true }), /ENOENT/);
});

test("importer keeps local edited recaps and historical seasons while adding generated content", (t) => {
  const local = { ...prose, segments: [text("Laura's edited version.")] };
  const history = { body: "Legacy 2025 article", season: 2025 };
  const { root, target } = workspace(t, { recaps: { 1392216: local, historical: history } });
  const { current } = snapshot(root, {
    1392216: { ...prose, gameId: "1392216", game, season: 2026 },
    99: { ...prose, gameId: "99", game: { ...game, id: 99 }, season: 2026 },
  });
  importRecapSnapshot({ projectRoot: root, snapshotDir: current, now });
  const result = read(target);
  assert.deepEqual(result.recaps[1392216].segments, local.segments);
  assert.deepEqual(result.recaps[1392216].game, game);
  assert.deepEqual(result.recaps.historical, history);
  assert.deepEqual(result.recaps[99].segments, prose.segments);
  assert.equal(result.updatedAt, timestamp);
});

test("importer rejects generated identity mismatches before publishing", (t) => {
  const { root, target } = workspace(t);
  const before = fs.readFileSync(target);
  const { current } = snapshot(root, { 1392216: { ...prose, gameId: "wrong", game, season: 2026 } });
  assert.throws(() => importRecapSnapshot({ projectRoot: root, snapshotDir: current, now }), /identity/);
  assert.deepEqual(fs.readFileSync(target), before);
});
