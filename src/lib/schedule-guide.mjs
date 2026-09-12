import { normalizeGame, schedulePhase } from "./schedule.mjs";

const TEAM_ABBR = new Map([
  ["Arizona Cardinals", "ARI"], ["Carolina Panthers", "CAR"], ["Chicago Bears", "CHI"],
  ["Dallas Cowboys", "DAL"], ["Denver Broncos", "DEN"], ["Kansas City Chiefs", "KC"],
  ["Las Vegas Raiders", "LV"], ["Los Angeles Chargers", "LAC"], ["Los Angeles Rams", "LAR"],
  ["New England Patriots", "NE"], ["New York Giants", "NYG"], ["Philadelphia Eagles", "PHI"],
  ["San Francisco 49ers", "SF"], ["Tennessee Titans", "TEN"], ["Washington Commanders", "WAS"],
]);

const {TEAM} = { abbreviation: "SEA", full_name: "Seattle {Team}" };
const text = (value) => String(value ?? "").trim();
const abbreviation = (team) => text(team?.abbreviation ?? team?.abbr).toUpperCase();
const phase = (row) => schedulePhase(row) ?? text(row?.phase ?? row?.season_type ?? row?.seasonType).toLowerCase();
const key = (row) => `${phase(row)}:${Number(row?.week)}`;

function localCalendarDate(row, fallback) {
  const explicit = text(row?.localDate ?? row?.local_date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const raw = text(row?.startsAt ?? row?.datetime ?? row?.start_time ?? row?.kickoff ?? row?.date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const instant = new Date(raw);
  if (!Number.isFinite(instant.getTime())) return fallback;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone:"America/Los_Angeles", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function preseasonIdentity(row, season) {
  try {
    const normalized = normalizeGame(row, season);
    const localDate = localCalendarDate(row, normalized.date);
    if (normalized.phase !== "preseason" || !localDate || normalized.isHome == null) return null;
    const opponent = abbreviation(normalized.opponent);
    return opponent ? `${opponent}:${normalized.isHome ? "home" : "away"}:${localDate}` : null;
  } catch { return null; }
}

function hasUsableKickoff(game, season) {
  try {
    const normalized = normalizeGame(game, season);
    return Boolean(normalized.dateConfirmed && normalized.timeConfirmed && normalized.startsAt);
  } catch { return false; }
}

function guideDate(label, season) {
  if (!label || /\bor\b|tbd/i.test(label)) return null;
  const cleaned = text(label).replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.?[,]?\s*/i, "");
  const match = cleaned.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (!match) return null;
  const months = new Map([["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6], ["jul", 7], ["aug", 8], ["sep", 9], ["sept", 9], ["oct", 10], ["nov", 11], ["dec", 12]]);
  const month = months.get(match[1].toLowerCase()), day = Number(match[2]), year = Number(match[3] ?? season);
  if (!month || day < 1 || day > 31 || !Number.isInteger(year)) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function teams(matchup) {
  const [awayName, homeName] = text(matchup).split(" at ");
  if (!awayName || !homeName) return null;
  const team = (name) => name === "Seattle {Team}" ? {TEAM} : { abbreviation: TEAM_ABBR.get(name) ?? "", full_name: name };
  return { visitor_team: team(awayName), home_team: team(homeName) };
}

function scores(result, matchupTeams) {
  if (!result || !matchupTeams) return {};
  const entries = [...text(result).matchAll(/(?:^|,\s*)(.+?)\s+(\d+)(?=,|$)/g)];
  if (entries.length !== 2) return {};
  const byName = new Map(entries.map(([, name, score]) => [name.replace(/^Seattle {Team}$/, "{Team}"), Number(score)]));
  const value = (team) => byName.get(team.abbreviation === "SEA" ? "{Team}" : team.full_name.replace(/^(?:Arizona|Carolina|Chicago|Dallas|Denver|Kansas City|Las Vegas|Los Angeles|New England|New York|Philadelphia|San Francisco|Tennessee|Washington) /, ""));
  const away = value(matchupTeams.visitor_team), home = value(matchupTeams.home_team);
  return Number.isFinite(away) && Number.isFinite(home) ? { visitor_team_score: away, home_team_score: home } : {};
}

function guideGame(entry, season) {
  const matchupTeams = teams(entry.matchup);
  if (!matchupTeams || !matchupTeams.home_team.abbreviation || !matchupTeams.visitor_team.abbreviation) return null;
  const date = guideDate(entry.dateLabel, season);
  return {
    id: `${season}-${phase(entry)}-${Number(entry.week)}`,
    season, season_type: phase(entry), week: Number(entry.week),
    date, date_confirmed: Boolean(date), kickoff_time: entry.kickoffLabel ?? null,
    time_confirmed: Boolean(date && entry.kickoffLabel),
    status: entry.status === "completed" ? "Final" : entry.status === "tbd" ? "TBD" : "Scheduled",
    ...matchupTeams, ...scores(entry.result, matchupTeams), venue: entry.venue ?? null,
    canonical_url: entry.officialGameUrl ?? null, schedule_authority: "official-team-guide",
  };
}

/** Reconcile the provider schedule with the maintained official team guide. */
export function reconcileOfficialSchedule(games, guide) {
  const rows = Array.isArray(games) ? games.map((game) => ({ ...game })) : [];
  if (!Array.isArray(guide?.games) || !Number.isInteger(Number(guide?.season))) return rows;
  const season = Number(guide.season);
  const byKey = new Map(rows.map((game, index) => [key(game), index]));
  const preseasonByIdentity = new Map(rows.map((game, index) => [preseasonIdentity(game, season), index]).filter(([identity]) => identity));
  for (const entry of guide.games) {
    const entryKey = key(entry);
    const source = guideGame(entry, season);
    const identity = source && phase(entry) === "preseason" ? preseasonIdentity(source, season) : null;
    // Provider preseason week labels are not {Team}-facing game identity.
    // Match the actual opponent/site/date first, then display the guide's week.
    const index = identity ? preseasonByIdentity.get(identity) : byKey.get(entryKey);
    if (index !== undefined) {
      const providerConfirmed = (rows[index].date_confirmed === true || rows[index].dateConfirmed === true)
        && (rows[index].time_confirmed === true || rows[index].timeConfirmed === true);
      if (entry.status === "tbd" && !providerConfirmed) rows[index] = {
        ...rows[index], date_tbd: true, time_tbd: true, date_confirmed: false, time_confirmed: false,
        network_confirmed: false, schedule_authority: "official-team-guide-tbd",
      };
      else {
        const providerHasKickoff = hasUsableKickoff(rows[index], season);
        const guideHasKickoff = source && hasUsableKickoff(source, season);
        if (source) rows[index] = {
          ...rows[index],
          ...(identity ? { week: source.week } : {}),
          ...(!rows[index].venue && source.venue ? { venue: source.venue, venue_confirmed: true } : {}),
          ...(!providerHasKickoff && guideHasKickoff
            ? { date: source.date, kickoff_time: source.kickoff_time, date_confirmed: true, time_confirmed: true } : {}),
          schedule_authority: rows[index].schedule_authority ?? source.schedule_authority,
        };
      }
      continue;
    }
    if (phase(entry) !== "preseason" || entry.status !== "completed") continue;
    const game = source;
    if (game) {
      byKey.set(entryKey, rows.length);
      const gameIdentity = preseasonIdentity(game, season);
      if (gameIdentity) preseasonByIdentity.set(gameIdentity, rows.length);
      rows.push(game);
    }
  }
  return rows;
}
