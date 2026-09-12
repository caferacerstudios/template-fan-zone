import { schedulePhase, scheduleState } from "./schedule.mjs";
const SEA = "SEA";

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function abbreviation(team) {
  return String(team?.abbreviation ?? "").toUpperCase();
}

function isFinal(game) {
  return scheduleState(game) === "completed";
}

function regularSeasonGames(data, season) {
  const rows = Array.isArray(data?.gamesRegular)
    ? data.gamesRegular
    : Array.isArray(data?.games)
      ? data.games
      : [];
  return rows.filter((game) => {
    return Number(game?.season) === season && schedulePhase(game) === "regular";
  });
}

function scoredGame(game) {
  if (!isFinal(game)) return null;
  const home = abbreviation(game?.home_team ?? game?.homeTeam);
  const away = abbreviation(game?.visitor_team ?? game?.away_team ?? game?.awayTeam);
  if ((home === SEA) === (away === SEA)) return null;
  const homeScore = number(game?.home_team_score);
  const awayScore = number(game?.visitor_team_score);
  if (homeScore === null || awayScore === null) return null;
  return home === SEA
    ? { scored: homeScore, allowed: awayScore }
    : { scored: awayScore, allowed: homeScore };
}

function verifiedScores(data, season) {
  const byId = new Map();
  const conflicts = new Set();
  for (const game of regularSeasonGames(data, season)) {
    const id = game?.id ?? game?.game_id;
    if (id === null || id === undefined || id === "") continue;
    const result = scoredGame(game);
    if (!result) continue;
    const key = String(id);
    if (conflicts.has(key)) continue;
    const prior = byId.get(key);
    if (prior && (prior.scored !== result.scored || prior.allowed !== result.allowed)) {
      byId.delete(key);
      conflicts.add(key);
      continue;
    }
    if (!prior) byId.set(key, result);
  }
  return [...byId.values()];
}

function canonicalTeamStats(data, season, gamesPlayed) {
  const row = data?.teamSeasonStats;
  if (!row || Array.isArray(row) || typeof row !== "object") return null;
  const teamId = integer(data?.team?.id);
  const rowTeamId = integer(row.team_id);
  const rowAbbr = String(row.team_abbreviation ?? "").toUpperCase();
  const teamMatches = teamId !== null && rowTeamId === teamId && rowAbbr === SEA;
  const phase = String(row.season_type ?? "").toLowerCase().replaceAll("_", " ");
  const declaredGames = integer(row.games_played);
  if (!teamMatches || Number(row.season) !== season || !["regular", "regular season"].includes(phase) || declaredGames !== gamesPlayed) return null;

  const passingYards = number(row.passing_yards);
  const rushingYards = number(row.rushing_yards);
  const reportedOffense = number(row.total_offensive_yards);
  const compatibleOffense = passingYards !== null && rushingYards !== null && reportedOffense === passingYards + rushingYards;
  return {
    gamesPlayed: declaredGames,
    passingYards,
    rushingYards,
    totalOffensiveYards: compatibleOffense ? reportedOffense : null,
  };
}

export function buildTeamStats(data) {
  const season = integer(data?.season);
  if (season === null) return null;
  const scores = verifiedScores(data, season);
  const gamesPlayed = scores.length;
  const pointsScored = gamesPlayed ? scores.reduce((sum, game) => sum + game.scored, 0) : null;
  const pointsAllowed = gamesPlayed ? scores.reduce((sum, game) => sum + game.allowed, 0) : null;
  const wins = scores.filter((game) => game.scored > game.allowed).length;
  const losses = scores.filter((game) => game.scored < game.allowed).length;
  const ties = scores.filter((game) => game.scored === game.allowed).length;

  return {
    season,
    gamesPlayed,
    record: gamesPlayed ? `${wins}-${losses}${ties ? `-${ties}` : ""}` : null,
    pointsScored,
    pointsAllowed,
    pointsPerGame: gamesPlayed ? pointsScored / gamesPlayed : null,
    teamTotals: canonicalTeamStats(data, season, gamesPlayed),
  };
}
