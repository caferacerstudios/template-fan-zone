import { formatKickoff, normalizeSchedule } from "./schedule.mjs";

const TEAM = "SEA";
const text = (value) => String(value ?? "").trim();
const abbr = (team) => text(team?.abbreviation ?? team?.abbr ?? team?.team_abbreviation ?? team?.teamAbbreviation).toUpperCase();
const numeric = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const gameTime = (game) => new Date(game?.startsAt ?? game?.date ?? 0).getTime();
const isScored = (game) => game?.state === "completed" && numeric(game?.home_team_score) !== null && numeric(game?.visitor_team_score) !== null;
const opponent = (game) => game?.isHome ? game?.awayTeam ?? game?.visitor_team : game?.homeTeam ?? game?.home_team;
const gameHref = (game) => `/games/${encodeURIComponent(String(game.id))}`;
const playerId = (row) => row?.player?.id ?? row?.player_id;
const playerName = (row) => row?.player?.full_name || `${row?.player?.first_name ?? ""} ${row?.player?.last_name ?? ""}`.trim();

function score(game, {team}) {
  const value = {team} === game.isHome ? game?.home_team_score : game?.visitor_team_score;
  return numeric(value);
}

function outcome(game) {
  const sea = score(game, true), other = score(game, false);
  return sea === other ? "T" : sea > other ? "W" : "L";
}

function record(games) {
  const result = { wins: 0, losses: 0, ties: 0 };
  for (const game of games.filter(isScored)) {
    const value = outcome(game);
    if (value === "W") result.wins++;
    if (value === "L") result.losses++;
    if (value === "T") result.ties++;
  }
  return `${result.wins}-${result.losses}${result.ties ? `-${result.ties}` : ""}`;
}

function rows(value) {
  for (const candidate of [value?.data, value?.teams, value?.standings, value?.rows]) if (Array.isArray(candidate)) return candidate;
  return Array.isArray(value) ? value : [];
}

function standingTeam(row) { return row?.team ?? row?.team_info ?? row; }
function standingValue(row, keys) { for (const key of keys) if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") return row[key]; return null; }
function ordinal(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return null;
  const suffix = number % 100 >= 11 && number % 100 <= 13 ? "th" : number % 10 === 1 ? "st" : number % 10 === 2 ? "nd" : number % 10 === 3 ? "rd" : "th";
  return `${number}${suffix}`;
}

function activePhase(games, now) {
  const live = games.find((game) => game.state === "in_progress");
  if (live) return live.phase;
  const postseason = games.filter((game) => game.phase === "postseason");
  if (postseason.some((game) => game.state === "completed" || gameTime(game) <= now.getTime())) return "postseason";
  const regular = games.filter((game) => game.phase === "regular");
  if (regular.some((game) => game.state === "completed" || gameTime(game) <= now.getTime())) return "regular";
  const preseason = games.filter((game) => game.phase === "preseason");
  if (preseason.length && (preseason.some((game) => game.state !== "completed") || preseason.some(isScored))) return "preseason";
  return "regular";
}

function firstRegularDate(games) {
  return games.filter((game) => game.phase === "regular" && game.date).sort((a, b) => gameTime(a) - gameTime(b))[0] ?? null;
}

function leadersFor(nfl) {
  const season = Number(nfl?.season);
  const statsSeason = Number(nfl?.playerStatsSeason ?? nfl?.season);
  const stats = Array.isArray(nfl?.playerSeasonStats) ? nfl.playerSeasonStats : [];
  const definitions = [
    ["Passing", ["passing_yards", "passingYards"], "pass yds"],
    ["Rushing", ["rushing_yards", "rushingYards"], "rush yds"],
    ["Receiving", ["receiving_yards", "receivingYards"], "rec yds"],
  ];
  const leaders = definitions.map(([label, keys, unit]) => {
    const candidates = stats.map((row) => ({ row, value: keys.map((key) => numeric(row?.[key])).find((value) => value !== null) }))
      .filter(({ row, value }) => value !== undefined && value > 0 && playerId(row) != null && playerName(row))
      .sort((a, b) => b.value - a.value);
    const lead = candidates[0];
    return lead ? { label, name: playerName(lead.row), value: lead.value, unit, href: `/players/${encodeURIComponent(String(playerId(lead.row)))}` } : null;
  }).filter(Boolean);
  return leaders.length === 3 ? { label: statsSeason === season ? `${season} leaders` : `${statsSeason} leaders`, season: statsSeason, items: leaders } : null;
}

function rosterCount(nfl) {
  const roster = Array.isArray(nfl?.currentRoster) ? nfl.currentRoster : Array.isArray(nfl?.roster) ? nfl.roster : null;
  if (!roster) return null;
  return new Set(roster.map((row) => row?.id ?? row?.player_id ?? row?.player?.id).filter((id) => id !== null && id !== undefined)).size || null;
}

export function buildHomepageGlance({ nfl, standings, transactions = [], injuries = [], now = new Date() }) {
  if (!nfl?.season) return null;
  const schedule = normalizeSchedule(nfl, nfl.season);
  const games = schedule.games;
  const phase = activePhase(games, now);
  const phaseGames = games.filter((game) => game.phase === phase);
  const finals = phaseGames.filter(isScored);
  const regularFinals = games.filter((game) => game.phase === "regular" && isScored(game));
  const labels = { preseason: "Preseason", regular: "Regular Season", postseason: "Postseason" };
  const latest = games.filter(isScored).sort((a, b) => gameTime(a) - gameTime(b)).at(-1) ?? null;
  const firstRegular = firstRegularDate(games);
  const seaStanding = rows(standings).find((row) => abbr(standingTeam(row)) === TEAM);
  const standingsSeason = Number(standings?.season ?? standings?.sourceSeason);
  const rank = standingsSeason === Number(nfl.season) && regularFinals.length > 0
    ? ordinal(standingValue(seaStanding, ["division_rank", "divisionRank", "rank", "position"])) : null;
  const recentOutcomes = finals.map(outcome);
  const lastOutcome = recentOutcomes.at(-1);
  let streak = 0;
  for (let index = recentOutcomes.length - 1; index >= 0 && recentOutcomes[index] === lastOutcome; index--) streak++;
  const diff = finals.length ? finals.reduce((total, game) => total + score(game, true) - score(game, false), 0) : null;
  const upcoming = games.filter((game) => !["completed", "canceled", "bye", "in_progress"].includes(game.state) && gameTime(game) >= now.getTime()).slice(0, 3);
  const count = rosterCount(nfl);
  const latestTransaction = transactions[0] ?? null;
  const hasRosterPulse = count !== null || latestTransaction || injuries.length > 0;
  return {
    season: Number(nfl.season),
    dataThrough: nfl.updatedAt ?? standings?.updatedAt ?? null,
    seasonStatus: {
      label: labels[phase], record: finals.length ? record(phaseGames) : null, href: phase === "regular" && rank ? "/standings" : "/schedule",
      rank: phase === "regular" ? rank : null,
      detail: phase === "regular" && regularFinals.length === 0 && firstRegular ? `Regular season begins ${formatKickoff(firstRegular, "date")}` : null,
      streak: finals.length && streak ? `${lastOutcome}${streak}` : null,
      pointDifferential: diff,
    },
    lastResult: latest ? {
      phase: labels[latest.phase], opponent: text(opponent(latest)?.full_name ?? opponent(latest)?.name ?? abbr(opponent(latest))) || "Opponent",
      location: latest.isHome ? "vs." : "at", outcome: outcome(latest), {team}Score: score(latest, true), opponentScore: score(latest, false),
      date: formatKickoff(latest, "date"), href: gameHref(latest),
    } : null,
    leaders: leadersFor(nfl),
    rosterPulse: hasRosterPulse ? {
      count,
      latestTransaction: latestTransaction ? { date: latestTransaction.timestamp, playerName: latestTransaction.playerName, action: latestTransaction.transactionType } : null,
      injuryCount: injuries.length || null,
    } : null,
    nextGames: upcoming.map((game) => ({ opponent: text(opponent(game)?.full_name ?? opponent(game)?.name ?? abbr(opponent(game))) || "Opponent TBD", location: game.isHome ? "vs." : "at", date: formatKickoff(game, "date"), href: gameHref(game) })),
  };
}
