import { formatKickoff } from "./schedule.mjs";

const TEAM_NAMES = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
  CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
  LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", LV: "Las Vegas Raiders", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers",
  TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders",
};

const DIVISION = new Set(["ARI", "LAR", "SF"]);
const PACIFIC = "America/Los_Angeles";
const abbreviation = (team) => String(team?.abbreviation ?? team?.abbr ?? "").toUpperCase();

export function scheduleResult(game) {
  if (game?.state !== "completed") return null;
  if (game?.home_team_score == null || game?.visitor_team_score == null) return null;
  const home = Number(game?.home_team_score);
  const away = Number(game?.visitor_team_score);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const {team} = game?.isHome ? home : away;
  const opponent = game?.isHome ? away : home;
  return { outcome: {team} === opponent ? "T" : {team} > opponent ? "W" : "L", {team}, opponent };
}

function pacificDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function scheduleRow(game, { nextGameId = null, index = 0, now = new Date() } = {}) {
  if (game?.state === "bye") return {
    kind: "bye", state: "bye", week: game?.week ? `Week ${game.week}` : "Season break",
    status: "Bye", detail: "No game scheduled", id: String(game?.id ?? `bye-${index}`),
  };

  const opponentAbbr = abbreviation(game?.opponent);
  const opponentName = game?.opponent?.full_name ?? game?.opponent?.fullName ?? game?.opponent?.name
    ?? TEAM_NAMES[opponentAbbr] ?? (opponentAbbr || "Opponent TBD");
  const result = scheduleResult(game);
  const isNext = String(game?.id) === String(nextGameId);
  const explicitState = game?.state ?? "upcoming";
  const state = ["postponed", "in_progress", "tbd", "canceled", "completed"].includes(explicitState) ? explicitState : isNext ? "next" : explicitState;
  const stateLabel = result ? "Final" : ({
    canceled: "Canceled", postponed: "Postponed", in_progress: "In progress",
    completed: "Final", tbd: "Details TBD", next: "Up next", upcoming: "Upcoming",
  })[state] ?? "Upcoming";
  const startsAt = game?.startsAt ? new Date(game.startsAt) : null;
  const validStart = startsAt && Number.isFinite(startsAt.getTime());
  const gameDay = validStart && pacificDay(startsAt) === pacificDay(now);
  const action = game?.state === "completed" ? "Recap"
    : game?.state === "postponed" ? "Updated details"
    : game?.state === "in_progress" || gameDay ? "Game center"
    : game?.previewAvailable ? "Preview"
    : "Game details";
  const date = formatKickoff(game, "date");
  const kickoff = formatKickoff(game, "time");

  return {
    kind: "game", id: String(game?.id ?? game?.game_id ?? index), state, stateLabel, result,
    resultLabel: result ? `{Abbreviation} ${result.{team}}, ${opponentAbbr || "OPP"} ${result.opponent}` : null,
    week: game?.week ? `Week ${game.week}` : "Game", date, kickoff,
    homeAway: game?.isHome ? "vs" : "at", homeAwayLabel: game?.isHome ? "Home" : "Away",
    opponentAbbr, opponentName, network: game?.network || null, venue: game?.venue || null,
    division: DIVISION.has(opponentAbbr), primeTime: Boolean(game?.prime_time ?? game?.primeTime ?? game?.is_primetime),
    record: game?.{team}RecordAfter || null,
    action, href: game?.canonicalUrl || `/games/${encodeURIComponent(String(game?.id ?? game?.game_id ?? index))}`,
    venueUrl: game?.venueUrl || null, watchUrl: game?.watchUrl || null,
  };
}

export function groupScheduleMonths(games) {
  const groups = [];
  let currentLabel = "Schedule";
  for (const game of games) {
    if (game?.state !== "bye") {
      const value = game?.startsAt ?? game?.date;
      const date = value ? new Date(game?.startsAt ?? `${game.date}T12:00:00Z`) : null;
      currentLabel = date && Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: PACIFIC }).format(date)
        : "Date to be announced";
    }
    const last = groups.at(-1);
    if (last?.label === currentLabel) last.games.push(game);
    else groups.push({ label: currentLabel, games: [game] });
  }
  return groups;
}

export const SCHEDULE_FILTERS = new Set(["home", "away", "division", "prime-time", "preseason", "regular", "postseason"]);

export function normalizeScheduleFilters(values = []) {
  return [...new Set(values.map((value) => String(value).toLowerCase()).filter((value) => SCHEDULE_FILTERS.has(value)))];
}

export function scheduleGameMatches(game, { status = "all", filters = [] } = {}) {
  const selected = new Set(normalizeScheduleFilters(filters));
  const state = String(game?.state ?? "upcoming").toLowerCase();
  if (status === "completed" && state !== "completed") return false;
  if (status === "upcoming" && (state === "completed" || state === "bye" || state === "canceled")) return false;

  const locations = ["home", "away"].filter((value) => selected.has(value));
  if (locations.length && !locations.includes(game?.isHome ? "home" : "away")) return false;

  const phases = ["preseason", "regular", "postseason"].filter((value) => selected.has(value));
  if (phases.length && !phases.includes(String(game?.phase ?? "regular").toLowerCase())) return false;

  const opponentAbbr = abbreviation(game?.opponent);
  if (selected.has("division") && !DIVISION.has(opponentAbbr)) return false;
  if (selected.has("prime-time") && !Boolean(game?.prime_time ?? game?.primeTime ?? game?.is_primetime)) return false;
  return true;
}
