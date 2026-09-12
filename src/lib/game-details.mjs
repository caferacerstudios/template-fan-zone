import { normalizeGame } from "./schedule.mjs";
import { nflTeamLogoUrl } from "./team-logos.mjs";

const TEAM_ABBR = new Map([
  ["Arizona Cardinals", "ARI"], ["Carolina Panthers", "CAR"], ["Chicago Bears", "CHI"],
  ["Dallas Cowboys", "DAL"], ["Denver Broncos", "DEN"], ["Kansas City Chiefs", "KC"],
  ["Las Vegas Raiders", "LV"], ["Los Angeles Chargers", "LAC"], ["Los Angeles Rams", "LAR"],
  ["New England Patriots", "NE"], ["New York Giants", "NYG"], ["Philadelphia Eagles", "PHI"],
  ["San Francisco 49ers", "SF"], ["Washington Commanders", "WAS"],
]);

export const gameId = (game, index = 0) => String(game?.id ?? game?.game_id ?? game?.gameId ?? index);
export const teamAbbr = (team, fallback = "") => String(team?.abbreviation ?? fallback).toUpperCase();
export const {team}AreHome = (game) => teamAbbr(game?.home_team) === "{Abbreviation}";
export const opponentAbbreviation = (game) => teamAbbr({team}AreHome(game) ? game?.visitor_team : game?.home_team);
export const opponentTeam = (game) => {team}AreHome(game) ? game?.visitor_team : game?.home_team;
export const venueName = (game) => game?.venue?.name ?? game?.venue ?? game?.stadium?.name ?? game?.stadium ?? null;

export function scheduleGames(archive) {
  const seasons = Array.isArray(archive?.seasons) ? archive.seasons : [archive];
  return seasons.flatMap((season) => (Array.isArray(season?.games)
    ? season.games
    : [...(season?.gamesPreseason ?? []), ...(season?.gamesRegular ?? []), ...(season?.gamesPostseason ?? [])])
    .map((game) => normalizeGame(game, season?.season ?? game?.season)))
    .filter((game) => game?.state !== "bye" && game?.bye !== true);
}

export function coverageGame(row, season = 2026, week = null) {
  const opponent = { abbreviation: TEAM_ABBR.get(row.opponent) ?? "", full_name: row.opponent };
  const seattle = { abbreviation: "{Abbreviation}", full_name: "Seattle {Team}" };
  return normalizeGame({
    id: String(row.gameId), season, week, phase: "regular", date: row.localDate,
    status: "Scheduled", home_team: row.homeAway === "home" ? seattle : opponent,
    visitor_team: row.homeAway === "home" ? opponent : seattle, venue: row.venue ?? null,
  }, season);
}

export function gameCollection(archive, coverage = []) {
  const scheduled = scheduleGames(archive);
  const known = new Set(scheduled.map((game, index) => gameId(game, index)));
  return [...scheduled, ...coverage.filter((row) => !known.has(String(row.gameId))).map((row) => {
    const coverageIndex = coverage.indexOf(row);
    const inferredWeek = row.week ?? (coverageIndex < 10 ? coverageIndex + 1 : coverageIndex + 2);
    return coverageGame(row, Number(archive?.season) || 2026, inferredWeek);
  })];
}

export function gameDetails(archive, requestedId, { coverage = [] } = {}) {
  const games = gameCollection(archive, coverage);
  const game = games.find((row, index) => gameId(row, index) === String(requestedId)) ?? null;
  if (!game) return null;
  const ordered = games.filter((row) => Number(row?.season) === Number(game?.season)).sort((a, b) => {
    const dateDifference = Date.parse(a?.date ?? "") - Date.parse(b?.date ?? "");
    return Number.isFinite(dateDifference) && dateDifference !== 0 ? dateDifference : Number(a?.week ?? 0) - Number(b?.week ?? 0);
  });
  const index = ordered.findIndex((row) => gameId(row) === gameId(game));
  const opponent = opponentTeam(game);
  const home = {team}AreHome(game);
  const completed = /final|completed/i.test(String(game?.status ?? game?.state ?? ""));
  const seaRaw = home ? game?.home_team_score : game?.visitor_team_score;
  const opponentRaw = home ? game?.visitor_team_score : game?.home_team_score;
  const seaScore = Number.isFinite(Number(seaRaw)) && seaRaw != null ? Number(seaRaw) : null;
  const opponentScore = Number.isFinite(Number(opponentRaw)) && opponentRaw != null ? Number(opponentRaw) : null;
  return {
    id: gameId(game), game, ordered, index, previous: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null,
    home, completed, opponent, opponentAbbr: teamAbbr(opponent),
    opponentName: opponent?.full_name ?? opponent?.fullName ?? opponent?.name ?? teamAbbr(opponent),
    venue: venueName(game), seaScore, opponentScore,
    outcome: completed && seaScore != null && opponentScore != null ? (seaScore === opponentScore ? "T" : seaScore > opponentScore ? "W" : "L") : null,
    weekLabel: game?.phase === "postseason" || game?.postseason
      ? ({ 1: "Wild Card Round", 2: "Divisional Round", 3: "Conference Championship", 4: "Super Bowl" })[Number(game?.week)] ?? "Postseason"
      : Number.isFinite(Number(game?.week)) && game?.week != null ? `Week ${game.week}` : `${game?.season ?? 2026} season`,
  };
}

export function ticketGameModels(archive, coverage = [], recaps = null) {
  return Object.fromEntries(coverage.map((row, index) => {
    const detail = gameDetails(archive, row.gameId, { coverage });
    const recap = recaps?.recaps?.[String(row.gameId)] ?? null;
    return [row.gameId, detail && {
      id: detail.id, game: detail.game, home: detail.home, completed: detail.completed,
      opponentAbbr: detail.opponentAbbr, opponentName: detail.opponentName, venue: detail.venue,
      {team}Logo: nflTeamLogoUrl("{Abbreviation}"), opponentLogo: nflTeamLogoUrl(detail.opponentAbbr),
      seaScore: detail.seaScore, opponentScore: detail.opponentScore, outcome: detail.outcome,
      weekLabel: detail.weekLabel, previousId: coverage[index - 1]?.gameId ?? null,
      nextId: coverage[index + 1]?.gameId ?? null,
      recap: recap ? { text: recap.text ?? null, bullets: Array.isArray(recap.bullets) ? recap.bullets : [] } : null,
    }];
  }));
}

export function gameDayPageModel(archive, requestedId, coverage = [], { editorial = null, recaps = null } = {}) {
  const details = gameDetails(archive, requestedId, { coverage });
  if (!details) return null;
  return {
    ...details,
    {team}Logo: nflTeamLogoUrl("{Abbreviation}"),
    opponentLogo: nflTeamLogoUrl(details.opponentAbbr),
    previousId: details.previous ? gameId(details.previous) : null,
    nextId: details.next ? gameId(details.next) : null,
    ticketSnapshot: coverage.find((row) => String(row.gameId) === details.id) ?? null,
    editorial: editorial?.games?.[details.id] ?? null,
    recap: recaps?.recaps?.[details.id] ?? null,
  };
}
