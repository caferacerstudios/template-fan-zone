#!/usr/bin/env node
/**
 * Fetch {Team} season schedule + season stats, enrich stats with player names,
 * AND fetch league standings for the same season.
 *
 * Writes:
 * - src/data/nfl/{team}.json    (combined payload: schedule + enriched season stats)
 * - src/data/nfl/players.json     (enriched season stats only, for convenience)
 * - src/data/nfl/standings.json   (league standings for season)
 *
 * Requirements:
 * - env BALLDONTLIE_API_KEY must be set
 *
 * Optional:
 * - env NFL_TEAM_ABBR (default "SEA")
 * - env NFL_SEASON (default: current/upcoming NFL season)
 * - NFL_FETCH_STRICT=1 makes any failed refresh exit nonzero
 * - NFL_REQUEST_INTERVAL_MS (default 15000): spacing for every API request
 * - NFL_FETCH_REPORT: optional JSON receipt path (contains no API key)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNflApiClient } from "./nfl-api-client.mjs";
import { normalizeSchedule } from "../src/lib/schedule.mjs";
import { reconcileOfficialSchedule } from "../src/lib/schedule-guide.mjs";
import { buildPhasedStandings } from "../src/lib/standings.mjs";
import { isCurrentRosterPlayer } from "../src/lib/roster.mjs";
import { validateProductionSchedule } from "../src/lib/production-schedule-validation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEAM_ABBR = (process.env.NFL_TEAM_ABBR || "SEA").toUpperCase();

function defaultSeason(now = new Date()) {
  const year = now.getUTCFullYear();

  // The Super Bowl is played on the second Sunday in February. Keep showing
  // the season that just ended for one month, then move to the upcoming season.
  const februaryFirst = new Date(Date.UTC(year, 1, 1));
  const firstSunday = 1 + ((7 - februaryFirst.getUTCDay()) % 7);
  const superBowlSunday = new Date(Date.UTC(year, 1, firstSunday + 7));
  const upcomingSeasonStart = new Date(superBowlSunday);
  upcomingSeasonStart.setUTCMonth(upcomingSeasonStart.getUTCMonth() + 1);

  return now >= upcomingSeasonStart ? year : year - 1;
}

const SEASON = Number(process.env.NFL_SEASON) || defaultSeason();

const API_KEY = process.env.BALLDONTLIE_API_KEY;

const client = createNflApiClient({
  apiKey: API_KEY,
  intervalMs: Number(process.env.NFL_REQUEST_INTERVAL_MS ?? 15000),
});
const pagedGet = (...args) => client.pagedGet(...args);

function report(value) {
  if (process.env.NFL_FETCH_REPORT) safeWriteJson(path.resolve(process.env.NFL_FETCH_REPORT), {
    status: "failed", updatedAt: null, season: SEASON, playerStatsSeason: null,
    requestCount: client.requestCount, ...value,
  });
}

function safeWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, filePath);
}

function assertNonEmptyArray(name, arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error(`Refusing to write: ${name} is empty (fetch looks broken).`);
  }
}

// Recap copy is durable across season rollovers. Before replacing the schedule,
// attach the old game's sourced metadata to each existing recap so the archive
// can still render dates, opponents, and final scores without another request.
function preserveRecapGameSnapshots(existingSchedulePath, recapPath) {
  if (!fs.existsSync(existingSchedulePath) || !fs.existsSync(recapPath)) return;
  const existingSchedule = JSON.parse(fs.readFileSync(existingSchedulePath, "utf8"));
  const recapStore = JSON.parse(fs.readFileSync(recapPath, "utf8"));
  const games = Array.isArray(existingSchedule?.games)
    ? existingSchedule.games
    : [...(existingSchedule?.gamesPreseason || []), ...(existingSchedule?.gamesRegular || []), ...(existingSchedule?.gamesPostseason || [])];
  const gamesById = new Map(games.map((game, index) => [String(game?.id ?? game?.game_id ?? index), game]));
  let changed = false;
  for (const [id, recap] of Object.entries(recapStore?.recaps ?? {})) {
    if (recap?.game || !gamesById.has(id)) continue;
    recap.game = gamesById.get(id);
    recap.season ??= existingSchedule?.season ?? null;
    changed = true;
  }
  if (changed) safeWriteJson(recapPath, recapStore);
}

async function main() {
  if (!API_KEY) throw new Error("Missing BALLDONTLIE_API_KEY env var.");
  // 1) Find {Team} team id
  const teams = await pagedGet("/teams", { per_page: 100 });
  const team = teams.find((t) => (t.abbreviation || "").toUpperCase() === TEAM_ABBR);

  if (!team) {
    throw new Error(`Could not find team with abbreviation ${TEAM_ABBR}`);
  }

  console.log(`Using ${TEAM_ABBR} team id: ${team.id}`);
  console.log(`Using season year: ${SEASON}`);

  // 2) Fetch games for that season
  const fetchedLeagueGames = await pagedGet("/games", {
    "seasons[]": [SEASON],
    "season_types[]": [1, 2, 3],
  });
  const leagueGames = fetchedLeagueGames.filter((g) => Number(g.season) === Number(SEASON));
  const gamesFiltered = leagueGames.filter((g) => [g.home_team?.id, g.visitor_team?.id].includes(team.id));
  const watchGuidePath = path.resolve(__dirname, "..", "src", "data", "nfl", `watch-guide-${SEASON}.json`);
  const watchGuide = fs.existsSync(watchGuidePath) ? JSON.parse(fs.readFileSync(watchGuidePath, "utf8")) : null;
  const reconciledGames = reconcileOfficialSchedule(gamesFiltered, watchGuide);

  // Normalize once at the ingestion boundary. In particular, `postseason:
  // false` does not mean regular season: the API also uses it for preseason.
  const normalizedSchedule = normalizeSchedule({ season: SEASON, sourceSeason: SEASON, games: reconciledGames }, SEASON);
  const { games, gamesPreseason, gamesRegular, gamesPostseason, nextGameId } = normalizedSchedule;

  // 3) Fetch team player list (names/positions)
  // This endpoint is a player directory, not an authoritative current roster.
  // Keep it only for enriching statistical records.
  const players = await pagedGet("/players", { "team_ids[]": [team.id] });
  const playersById = new Map(players.map((p) => [String(p.id), p]));
  const rosterStore = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "src", "data", "team", "roster.json"), "utf8"));
  const currentRoster = (rosterStore.players || []).filter(isCurrentRosterPlayer);
  const playerDirectory = players.map((player) => ({
    id: player.id,
    first_name: player.first_name ?? null,
    last_name: player.last_name ?? null,
    full_name: player.full_name ?? null,
    position_abbreviation: player.position_abbreviation ?? null,
    position: player.position ?? null,
    jersey_number: player.jersey_number ?? player.jersey ?? null,
    height: player.height ?? null,
    weight: player.weight ?? null,
    college: player.college ?? null,
    experience: player.experience ?? player.years_pro ?? null,
  }));

  // 4) Fetch season stats for this team + season.
  // Before regular-season stats exist for an upcoming season,
  // temporarily fall back to the previous season's player stats.
  let playerStatsSeason = SEASON;

  let seasonStatsRegular = await pagedGet("/season_stats", {
    season: playerStatsSeason,
    team_id: team.id,
    "season_types[]": [2],
  });

  let seasonStatsPostseason = await pagedGet("/season_stats", {
    season: playerStatsSeason,
    team_id: team.id,
    "season_types[]": [3],
  });

  if (
    seasonStatsRegular.length === 0 &&
    seasonStatsPostseason.length === 0
  ) {
    playerStatsSeason = SEASON - 1;

    console.warn(
      `No player stats available for ${SEASON}; falling back to ${playerStatsSeason}.`
    );

    seasonStatsRegular = await pagedGet("/season_stats", {
      season: playerStatsSeason,
      team_id: team.id,
      "season_types[]": [2],
    });

    seasonStatsPostseason = await pagedGet("/season_stats", {
      season: playerStatsSeason,
      team_id: team.id,
      "season_types[]": [3],
    });
  }

  const seasonStatsAll = [
    ...seasonStatsRegular,
    ...seasonStatsPostseason,
  ];

  const enriched = seasonStatsAll.map((row) => {
    const playerId =
      row.player_id ?? row.player?.id ?? row.playerId ?? null;

    const player = playerId
      ? playersById.get(String(playerId))
      : (row.player || null);

    return {
      ...row,
      player: player || null,
      player_id: playerId || row.player_id || null,
      team_id: row.team_id ?? team.id,
      season: row.season ?? playerStatsSeason,
    };
  });
  const updatedAt = new Date().toISOString();
  const otherLeagueGames = leagueGames.filter((g) => ![g.home_team?.id, g.visitor_team?.id].includes(team.id));
  const phasedStandings = buildPhasedStandings({ season: SEASON, updatedAt, games: [...otherLeagueGames, ...reconciledGames], teams });
  phasedStandings.refreshedDuringBuild = process.env.NFL_FETCH_STRICT !== "1";

  const currentSeasonPayload = {
    fixture: false,
    team: {
      id: team.id,
      abbreviation: team.abbreviation,
      full_name: team.full_name,
      conference: team.conference,
      division: team.division,
    },
    season: SEASON,
    playerStatsSeason,
    updatedAt,
    sourceSeason: SEASON,
    games,
    gamesPreseason,
    gamesRegular,
    gamesPostseason,
    nextGameId,
    currentRoster,
    playerDirectory,
    // This API request returns player rows, not authoritative team totals.
    // Keep the team-season slot explicit so consumers never rediscover totals
    // by traversing or summing player data. Populate only from a future
    // authoritative, team-scoped endpoint after normalizing its identity fields.
    teamSeasonStats: null,
    playerSeasonStats: enriched,
  };

  const outDir = path.resolve(__dirname, "..", "src", "data", "nfl");
  const combinedPath = path.join(outDir, "{team}.json");
  const playersPath = path.join(outDir, "players.json");
  const standingsPath = path.join(outDir, "standings.json");
  const recapsPath = path.join(outDir, "gameRecaps.json");
  const previousSnapshot = fs.existsSync(combinedPath) ? JSON.parse(fs.readFileSync(combinedPath, "utf8")) : null;
  const previousSeasons = (Array.isArray(previousSnapshot?.seasons) ? previousSnapshot.seasons : previousSnapshot ? [previousSnapshot] : [])
    .filter((record) => Number(record?.season) !== Number(SEASON))
    .map(({ seasons, ...record }) => record);
  const outCombined = { ...currentSeasonPayload, fixture: false, seasons: [...previousSeasons, currentSeasonPayload] };

  // Safety checks: don't overwrite with obviously broken payloads
  assertNonEmptyArray("gamesRegular", gamesRegular);
  assertNonEmptyArray("playerSeasonStats", enriched);
  validateProductionSchedule(outCombined);

  preserveRecapGameSnapshots(combinedPath, recapsPath);
  safeWriteJson(combinedPath, outCombined);
  console.log(`wrote ${path.relative(process.cwd(), combinedPath)}`);

  safeWriteJson(playersPath, {
    season: SEASON,
    playerStatsSeason,
    updatedAt,
    team: outCombined.team,
    currentRoster,
    playerDirectory,
    playerSeasonStats: enriched,
  });
  console.log(`wrote ${path.relative(process.cwd(), playersPath)}`);

  safeWriteJson(standingsPath, phasedStandings);
  console.log(`wrote ${path.relative(process.cwd(), standingsPath)}`);
  report({ status: "success", updatedAt, playerStatsSeason });
  console.log(`NFL refresh succeeded: ${client.requestCount} API requests`);
}

main().catch((err) => {
  report({ error: String(err?.message || err).replaceAll(API_KEY || "__unset_api_key__", "[redacted]") });
  if (process.env.NFL_FETCH_STRICT === "1") {
    console.error(`NFL refresh failed; staged output will not be published. ${String(err?.message || err).replaceAll(API_KEY || "__unset_api_key__", "[redacted]")}`);
    process.exitCode = 1;
    return;
  }
  const existingPath = path.resolve(__dirname, "..", "src", "data", "nfl", "{team}.json");
  // A refresh must never replace good data with an empty/partial response. If
  // a previously validated snapshot exists, keep building with that snapshot;
  // the page will show its age through the freshness indicator.
  try {
    const existing = JSON.parse(fs.readFileSync(existingPath, "utf8"));
    normalizeSchedule(existing, existing.season);
    validateProductionSchedule(existing);
    console.warn(`Schedule refresh failed; retaining last known valid schedule.\n${err?.message || err}`);
  } catch {
    console.error(err?.stack || String(err));
    process.exitCode = 1;
  }
});
