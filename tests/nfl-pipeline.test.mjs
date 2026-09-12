import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createNflApiClient } from "../scripts/nfl-api-client.mjs";
import { importNflSnapshot } from "../scripts/import-nfl-snapshot.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const team = { id: 31, abbreviation: "SEA", full_name: "Seattle {Team}" };
const game = { id: 1392216, season: 2026, season_type: "regular", week: 1, date: "2026-09-09T23:00:00Z", status: "Scheduled", home_team: team, visitor_team: { id: 23, abbreviation: "NE", full_name: "New England Patriots" } };
const stat = { player_id: 1, team_id: 31, season: 2026 };
const stamp = "2026-09-10T04:00:00.000Z";
const page = (data = [], next_cursor = null) => ({ data, meta: { next_cursor } });

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sfz-nfl-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(value));
}

function snapshot(t) {
  const directory = temporary(t);
  const projectRoot = path.join(directory, "project");
  const selected = path.join(directory, "snapshots/run-1");
  const target = path.join(projectRoot, "src/data/nfl");
  const current = path.join(directory, "current");
  const base = { season: 2026, updatedAt: stamp, playerStatsSeason: 2026, team, playerSeasonStats: [stat] };
  writeJson(path.join(selected, "{team}.json"), { ...base, games: [game] });
  writeJson(path.join(selected, "players.json"), base);
  writeJson(path.join(selected, "standings.json"), { season: 2026, updatedAt: stamp, phases: Object.fromEntries(["preseason", "regular", "postseason"].map((phase) => [phase, { phase, rows: [] }])) });
  writeJson(path.join(selected, "gameRecaps.json"), { recaps: { 1392216: { title: "OLD TITLE", body: "OLD COPY", game, season: 2026 }, removed: { body: "Deleted article" } } });
  writeJson(path.join(target, "{team}.json"), { ...base, games: [game] });
  writeJson(path.join(target, "players.json"), { previous: true });
  writeJson(path.join(target, "standings.json"), { previous: true });
  writeJson(path.join(target, "gameRecaps.json"), { editor: "Laura", recaps: { 1392216: { title: "Latest title", body: "Latest editorial copy" }, "new-article": { body: "New story", season: 2026 } } });
  const manifest = { schema_version: 1, updatedAt: stamp, season: 2026, files: {} };
  const rehash = () => {
    for (const name of ["{team}.json", "players.json", "standings.json", "gameRecaps.json"]) manifest.files[name] = createHash("sha256").update(fs.readFileSync(path.join(selected, name))).digest("hex");
    writeJson(path.join(selected, "manifest.json"), manifest);
  };
  rehash();
  fs.symlinkSync(selected, current);
  const options = { projectRoot, snapshotDir: current, now: Date.parse(stamp) + 3600000 };
  const before = () => Object.fromEntries(fs.readdirSync(target).map((name) => [name, fs.readFileSync(path.join(target, name), "utf8")]));
  return { target, selected, manifest, rehash, options, before };
}

test("API pacing covers endpoint changes, pages, and all bounded retries", async () => {
  let clock = 0;
  const calls = [];
  const responses = [new Response(JSON.stringify(page([1], 2))), new Response(JSON.stringify(page([2]))), new Response("sensitive body", { status: 429, headers: { "Retry-After": "120" } }), new Response(JSON.stringify(page([3])))];
  const client = createNflApiClient({ apiKey: "secret", now: () => clock, sleep: async (ms) => { clock += ms; }, fetchImpl: async (url, options) => { calls.push({ at: clock, url, options }); return responses.shift(); } });
  assert.deepEqual(await client.pagedGet("/teams"), [1, 2]);
  assert.deepEqual(await client.pagedGet("/players"), [3]);
  assert.deepEqual(calls.map((call) => call.at), [0, 15000, 30000, 150000]);
  assert.equal(client.requestCount, 4);
  assert.equal(calls[1].url.searchParams.get("cursor"), "2");
  assert.ok(calls.every((call) => call.options.signal instanceof AbortSignal));
});

test("429 exhaustion stops after three attempts and never leaks provider bodies", async () => {
  const client = createNflApiClient({ apiKey: "do-not-log", sleep: async () => {}, fetchImpl: async () => new Response("do-not-log", { status: 429 }) });
  await assert.rejects(client.pagedGet("/teams"), (error) => /HTTP 429/.test(error.message) && !error.message.includes("do-not-log"));
  assert.equal(client.requestCount, 3);
});

test("429 long retry-after fails instead of retrying before the provider permits it", async () => {
  const client = createNflApiClient({ apiKey: "secret", sleep: async () => {}, fetchImpl: async () => new Response("", { status: 429, headers: { "Retry-After": "900" } }) });
  await assert.rejects(client.pagedGet("/teams"), /deferred/);
  assert.equal(client.requestCount, 1);
});

test("malformed pages and repeated cursors fail instead of accepting partial data", async () => {
  for (const response of [{ data: [], meta: [] }, { data: {}, meta: { next_cursor: null } }, page([], 2)]) {
    const client = createNflApiClient({ apiKey: "secret", sleep: async () => {}, fetchImpl: async () => new Response(JSON.stringify(response)) });
    await assert.rejects(client.pagedGet("/teams"), /invalid/i);
  }
  const client = createNflApiClient({ apiKey: "secret", sleep: async () => {}, fetchImpl: async () => new Response(JSON.stringify(page([1], 2))) });
  await assert.rejects(client.pagedGet("/teams"), /repeated/);
  assert.equal(client.requestCount, 2);
});

test("unpaginated teams and omitted terminal cursors are valid provider responses", async () => {
  for (const response of [{ data: [team] }, { data: [team], meta: {} }]) {
    const client = createNflApiClient({ apiKey: "secret", fetchImpl: async () => new Response(JSON.stringify(response)) });
    assert.deepEqual(await client.pagedGet("/teams"), [team]);
    assert.equal(client.requestCount, 1);
  }
});

test("snapshot check is read-only; import preserves current editorial copy and only adds metadata", (t) => {
  const setup = snapshot(t);
  const before = setup.before();
  const checked = importNflSnapshot({ ...setup.options, checkOnly: true });
  assert.equal(checked.snapshotDir, setup.selected);
  assert.deepEqual(setup.before(), before);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Importer must never access the network"); };
  try { importNflSnapshot(setup.options); } finally { globalThis.fetch = originalFetch; }
  const recaps = JSON.parse(fs.readFileSync(path.join(setup.target, "gameRecaps.json")));
  assert.equal(recaps.editor, "Laura");
  assert.equal(recaps.recaps[1392216].body, "Latest editorial copy");
  assert.equal(recaps.recaps[1392216].title, "Latest title");
  assert.equal(recaps.recaps[1392216].game.id, 1392216);
  assert.equal(recaps.recaps[1392216].season, 2026);
  assert.equal(recaps.recaps["new-article"].body, "New story");
  assert.equal(recaps.recaps.removed, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(setup.target, "players.json"))).updatedAt, stamp);
});

test("all snapshot failures occur before replacing any local data", (t) => {
  const setup = snapshot(t);
  const before = setup.before();
  fs.appendFileSync(path.join(setup.selected, "players.json"), " ");
  assert.throws(() => importNflSnapshot(setup.options), /checksum/);
  assert.deepEqual(setup.before(), before);
  setup.rehash();
  const players = JSON.parse(fs.readFileSync(path.join(setup.selected, "players.json")));
  players.updatedAt = "2026-09-10T03:00:00.000Z";
  writeJson(path.join(setup.selected, "players.json"), players);
  setup.rehash();
  assert.throws(() => importNflSnapshot(setup.options), /timestamp mismatch/);
  assert.deepEqual(setup.before(), before);
  assert.throws(() => importNflSnapshot({ ...setup.options, maxAgeHours: 24, now: Date.parse(stamp) + 25 * 3600000 }), /stale/);
  assert.deepEqual(setup.before(), before);
  assert.throws(() => importNflSnapshot({ ...setup.options, snapshotDir: path.join(setup.selected, "missing") }), /ENOENT/);
  assert.throws(() => importNflSnapshot({ ...setup.options, snapshotDir: path.join(setup.selected, "missing"), ifAvailable: true }), /ENOENT/);
  assert.deepEqual(setup.before(), before);
});

test("an unavailable optional snapshot retains validated repository data", (t) => {
  const setup = snapshot(t);
  const before = setup.before();
  const result = importNflSnapshot({ ...setup.options, snapshotDir: path.join(path.dirname(setup.selected), "missing-parent/current"), ifAvailable: true });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(setup.before(), before);
});

function collectorProject(t) {
  const directory = temporary(t);
  fs.mkdirSync(path.join(directory, "scripts"));
  fs.cpSync(path.join(repo, "src/lib"), path.join(directory, "src/lib"), { recursive: true });
  for (const name of ["fetch-nfl.mjs", "nfl-api-client.mjs"]) fs.copyFileSync(path.join(repo, "scripts", name), path.join(directory, "scripts", name));
  writeJson(path.join(directory, "src/data/nfl/{team}.json"), { season: 2026, games: [game] });
  writeJson(path.join(directory, "src/data/team/roster.json"), { players: [] });
  const reportPath = path.join(directory, "report.json");
  const env = { ...process.env, BALLDONTLIE_API_KEY: "local-test-key", NFL_SEASON: "2026", NFL_REQUEST_INTERVAL_MS: "0", NFL_FETCH_REPORT: reportPath, NFL_FETCH_STRICT: "1" };
  const run = (mock) => {
    fs.writeFileSync(path.join(directory, "mock.mjs"), mock);
    return spawnSync(process.execPath, ["--import", path.join(directory, "mock.mjs"), "scripts/fetch-nfl.mjs"], { cwd: directory, env, encoding: "utf8" });
  };
  return { directory, reportPath, env, run };
}

test("strict collection fails on a provider error even with a valid cached schedule", (t) => {
  const setup = collectorProject(t);
  const previous = fs.readFileSync(path.join(setup.directory, "src/data/nfl/{team}.json"), "utf8");
  const result = setup.run('globalThis.fetch = async () => new Response("local-test-key secret response", { status: 403 });');
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /local-test-key/);
  const report = JSON.parse(fs.readFileSync(setup.reportPath));
  assert.equal(report.status, "failed");
  assert.equal(report.requestCount, 1);
  assert.equal(fs.readFileSync(path.join(setup.directory, "src/data/nfl/{team}.json"), "utf8"), previous);
});

test("collector uses documented phase filters and reports one coherent fresh snapshot", (t) => {
  const setup = collectorProject(t);
  const result = setup.run(`
    const team = ${JSON.stringify(team)}, game = ${JSON.stringify(game)}, stat = ${JSON.stringify(stat)};
    globalThis.fetch = async (url) => {
      const name = url.pathname.split('/').at(-1);
      let data;
      if (name === 'teams') data = [team];
      else if (name === 'games') {
        if (url.searchParams.getAll('season_types[]').join(',') !== '1,2,3') throw new Error('missing game phases');
        data = [game];
      } else if (name === 'players') data = [{id:1, first_name:'Test',last_name:'Player'}];
      else if (name === 'season_stats') {
        if (url.searchParams.has('postseason')) throw new Error('unsupported postseason parameter');
        const phase = url.searchParams.get('season_types[]');
        if (!['2','3'].includes(phase)) throw new Error('missing stats phase');
        data = phase === '2' ? [stat] : [];
      } else throw new Error('unexpected API endpoint');
      return new Response(JSON.stringify({data,meta:{next_cursor:null}}));
    };
  `);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(setup.reportPath));
  assert.equal(report.status, "success");
  assert.equal(report.requestCount, 5);
  assert.equal(report.playerStatsSeason, 2026);
  for (const name of ["{team}.json", "players.json", "standings.json"]) {
    const payload = JSON.parse(fs.readFileSync(path.join(setup.directory, "src/data/nfl", name)));
    assert.equal(payload.updatedAt, report.updatedAt);
    assert.equal(payload.season, report.season);
  }
});
