import { schedulePhase, scheduleState } from "./schedule.mjs";

export const STANDINGS_PHASES = ["preseason", "regular", "postseason"];
const WEST = new Set(["ARI", "LAR", "SF", "SEA"]);
const NAMES = {
  ARI: "Arizona Cardinals", LAR: "Los Angeles Rams", SF: "San Francisco 49ers", SEA: "Seattle {Team}",
};

const text = (value) => String(value ?? "").trim();
const abbr = (team) => text(team?.abbreviation ?? team?.abbr).toUpperCase().replaceAll(".", "").replace(/^SFO$/, "SF").replace(/^LA$/, "LAR");
const score = (game, side) => {
  const value = side === "home" ? game?.home_team_score ?? game?.homeTeamScore : game?.visitor_team_score ?? game?.away_team_score ?? game?.visitorTeamScore;
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
};

export function winningPercentage(wins, losses, ties) {
  const total = wins + losses + ties;
  return total ? (wins + 0.5 * ties) / total : 0;
}

export function formatWinningPercentage(wins, losses, ties) {
  return winningPercentage(wins, losses, ties).toFixed(3).replace(/^0/, "");
}

export function aggregateStandings(games, teams, phase) {
  if (!STANDINGS_PHASES.includes(phase)) throw new Error(`Invalid standings phase: ${phase}`);
  const emptyRow = (team) => {
    const code = abbr(team);
    return { abbreviation: code, name: team?.full_name ?? team?.fullName ?? team?.name ?? NAMES[code] ?? code, conference: team?.conference ?? null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, divisionWins: 0, divisionLosses: 0, divisionTies: 0, conferenceWins: 0, conferenceLosses: 0, conferenceTies: 0, streak: "—" };
  };
  const rows = new Map((teams ?? []).map((team) => {
    const code = abbr(team);
    return [code, emptyRow(team)];
  }));

  const observed = new Set();
  for (const game of [...(games ?? [])].sort((a, b) => text(a?.startsAt ?? a?.datetime ?? a?.date).localeCompare(text(b?.startsAt ?? b?.datetime ?? b?.date)))) {
    if (schedulePhase(game) !== phase || scheduleState(game) !== "completed") continue;
    const home = abbr(game?.home_team ?? game?.homeTeam), away = abbr(game?.visitor_team ?? game?.away_team ?? game?.awayTeam);
    const homeScore = score(game, "home"), awayScore = score(game, "away");
    if (home && !rows.has(home)) rows.set(home, emptyRow(game?.home_team ?? game?.homeTeam));
    if (away && !rows.has(away)) rows.set(away, emptyRow(game?.visitor_team ?? game?.away_team ?? game?.awayTeam));
    if (!rows.has(home) || !rows.has(away) || homeScore === null || awayScore === null) continue;
    observed.add(home); observed.add(away);
    for (const [code, own, other, ownScore, otherScore] of [[home, rows.get(home), away, homeScore, awayScore], [away, rows.get(away), home, awayScore, homeScore]]) {
      own.pointsFor += ownScore; own.pointsAgainst += otherScore;
      const outcome = ownScore === otherScore ? "ties" : ownScore > otherScore ? "wins" : "losses";
      own[outcome] += 1;
      if (WEST.has(code) && WEST.has(other)) own[`division${outcome[0].toUpperCase()}${outcome.slice(1)}`] += 1;
      // The current page only consumes NFC West data, whose opponents are all NFC.
      // Conference splits require conference metadata and are populated below when present.
      const opponent = rows.get(other);
      if (own.conference && opponent?.conference && own.conference === opponent.conference) own[`conference${outcome[0].toUpperCase()}${outcome.slice(1)}`] += 1;
      const letter = outcome === "wins" ? "W" : outcome === "losses" ? "L" : "T";
      own.streak = own.streak.startsWith(letter) ? `${letter}${Number(own.streak.slice(1)) + 1}` : `${letter}1`;
    }
  }

  const result = [...rows.values()].filter((row) => WEST.has(row.abbreviation) && observed.has(row.abbreviation));
  for (const row of result) {
    row.percentage = formatWinningPercentage(row.wins, row.losses, row.ties);
    row.differential = row.pointsFor - row.pointsAgainst;
    row.division = `${row.divisionWins}-${row.divisionLosses}${row.divisionTies ? `-${row.divisionTies}` : ""}`;
    row.conference = `${row.conferenceWins}-${row.conferenceLosses}${row.conferenceTies ? `-${row.conferenceTies}` : ""}`;
    row.gamesPlayed = row.wins + row.losses + row.ties;
  }
  result.sort((a, b) => winningPercentage(b.wins, b.losses, b.ties) - winningPercentage(a.wins, a.losses, a.ties) || b.differential - a.differential || a.name.localeCompare(b.name));
  const completeDivision = result.length === WEST.size;
  result.forEach((row, index) => { row.rank = completeDivision ? String(index + 1) : null; });
  return result;
}

export function buildPhasedStandings({ season, updatedAt, games, teams }) {
  const phases = Object.fromEntries(STANDINGS_PHASES.map((phase) => [phase, { phase, officialRank: false, rows: aggregateStandings(games, teams, phase) }]));
  const payload = { season: Number(season), sourceSeason: Number(season), updatedAt, refreshedDuringBuild: true, phases };
  validateStandings(payload);
  reconcileStandings(payload, games);
  return payload;
}

export function activeStandingsPhase(games) {
  const completed = new Set((games ?? []).filter((game) => scheduleState(game) === "completed").map(schedulePhase));
  if (completed.has("postseason")) return "postseason";
  if (completed.has("regular")) return "regular";
  if (completed.has("preseason")) return "preseason";
  return "regular";
}

export function validateStandings(payload) {
  const errors = [];
  for (const phase of STANDINGS_PHASES) {
    const bucket = payload?.phases?.[phase];
    if (!bucket || bucket.phase !== phase) { errors.push(`missing or mismatched ${phase} standings bucket`); continue; }
    for (const row of bucket.rows) {
      if (![row.wins, row.losses, row.ties].every((value) => Number.isInteger(value) && value >= 0)) errors.push(`${phase} ${row.abbreviation} record is missing or invalid`);
      if (row.gamesPlayed !== row.wins + row.losses + row.ties) errors.push(`${phase} ${row.abbreviation} games-played mismatch`);
      if (row.percentage !== formatWinningPercentage(row.wins, row.losses, row.ties)) errors.push(`${phase} ${row.abbreviation} percentage mismatch`);
      if (row.differential !== row.pointsFor - row.pointsAgainst) errors.push(`${phase} ${row.abbreviation} point differential mismatch`);
    }
  }
  if (errors.length) throw new Error(`Standings validation failed:\n- ${errors.join("\n- ")}`);
  return true;
}

export function reconcileStandings(payload, games = [], teams = null) {
  const errors = [];
  const ids = new Set();
  const teamFilter = teams == null ? null : new Set(teams.map((team) => abbr(typeof team === "string" ? { abbreviation: team } : team)));
  for (const game of games) {
    const phase = schedulePhase(game);
    if (!STANDINGS_PHASES.includes(phase)) errors.push(`invalid or missing season type: ${game?.id ?? "unknown game"}`);
    const id = text(game?.id ?? game?.game_id);
    if (id && ids.has(id)) errors.push(`duplicate game: ${id}`); else if (id) ids.add(id);
  }
  for (const phase of STANDINGS_PHASES) {
    const bucket = payload?.phases?.[phase];
    if (!bucket || bucket.phase !== phase) continue;
    const gameTeams = games.flatMap((game) => [game?.home_team ?? game?.homeTeam, game?.visitor_team ?? game?.away_team ?? game?.awayTeam]).filter(Boolean);
    const expected = aggregateStandings(games, [...gameTeams, ...bucket.rows.map((row) => ({ abbreviation: row.abbreviation, full_name: row.name, conference: row.conference }))], phase);
    for (const row of bucket.rows) {
      if (teamFilter && !teamFilter.has(abbr(row))) continue;
      const source = expected.find((item) => item.abbreviation === row.abbreviation);
      if (bucket.recordAuthority !== "official" && (!source || row.wins !== source.wins || row.losses !== source.losses || row.ties !== source.ties)) errors.push(`${phase} ${row.abbreviation} record does not match filtered games`);
    }
  }
  if (errors.length) throw new Error(`Standings reconciliation failed:\n- ${errors.join("\n- ")}`);
  return true;
}
