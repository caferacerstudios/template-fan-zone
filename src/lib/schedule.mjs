const TEAM = "{Abbreviation}";
const PACIFIC = "America/Los_Angeles";

export const SCHEDULE_PHASES = ["preseason", "regular", "postseason"];
export const SCHEDULE_STATES = ["bye", "canceled", "postponed", "completed", "in_progress", "upcoming", "tbd"];

const text = (value) => String(value ?? "").trim();
const abbr = (team) => text(team?.abbreviation ?? team?.abbr).toUpperCase();
const integer = (value) => Number.isInteger(Number(value)) ? Number(value) : null;
const optionalUrl = (value) => {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate, "https://example.invalid");
    return ["http:", "https:"].includes(url.protocol) ? candidate : null;
  } catch { return null; }
};
const ALLOWED_EXTERNAL_HOSTS = new Set([
  "{team}.com", "www.{team}.com", "lumenfield.com", "www.lumenfield.com",
  "nfl.com", "www.nfl.com", "espn.com", "www.espn.com",
]);
const allowlistedUrl = (value) => {
  const candidate = optionalUrl(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate, "https://example.invalid");
    return url.origin === "https://example.invalid" || (url.protocol === "https:" && ALLOWED_EXTERNAL_HOSTS.has(url.hostname)) ? candidate : null;
  } catch { return null; }
};

export function schedulePhase(game) {
  const value = text(game?.phase ?? game?.season_type ?? game?.seasonType ?? game?.type).toLowerCase();
  if (value.includes("pre")) return "preseason";
  if (value.includes("post") || value.includes("playoff") || game?.postseason === true || game?.is_postseason === true) return "postseason";
  if (value.includes("regular")) return "regular";
  if (!value && (game?.postseason === false || game?.is_postseason === false)) {
    const season = integer(game?.season);
    const kickoffValue = sourceDate(game);
    const kickoff = kickoffValue ? new Date(kickoffValue) : null;
    if (season && kickoff && Number.isFinite(kickoff.getTime())) {
      const septemberFirst = new Date(Date.UTC(season, 8, 1));
      const laborDay = 1 + ((8 - septemberFirst.getUTCDay()) % 7);
      const regularSeasonOpener = Date.UTC(season, 8, laborDay + 3);
      return kickoff.getTime() < regularSeasonOpener ? "preseason" : "regular";
    }
  }
  return null;
}

export function scheduleState(game) {
  if (game?.bye === true || text(game?.kind).toLowerCase() === "bye" || /\bbye\b/i.test(text(game?.status))) return "bye";
  const value = text(game?.state ?? game?.status).toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (value.includes("cancel")) return "canceled";
  if (value.includes("postpon")) return "postponed";
  if (/final|finished|complete|closed/.test(value)) return "completed";
  if (/in_progress|live|halftime|quarter|overtime/.test(value)) return "in_progress";
  if (/tbd|to_be_determined|unconfirmed/.test(value)) return "tbd";
  return "upcoming";
}

function sourceDate(game) {
  return game?.startsAt ?? game?.datetime ?? game?.start_time ?? game?.kickoff ?? game?.date ?? null;
}

export function calendarDate(value) {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const probe = new Date(`${year}-${month}-${day}T12:00:00Z`);
  return Number.isFinite(probe.getTime()) && probe.toISOString().slice(0, 10) === `${year}-${month}-${day}` ? `${year}-${month}-${day}` : null;
}

function pacificCalendarDay(value) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const fields = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

/** Format either a Pacific local calendar date or a real kickoff instant without conflating the two. */
export function formatPacificCalendarDate(value, options = {}) {
  const localDate = calendarDate(value);
  const date = localDate ? new Date(`${localDate}T12:00:00Z`) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: PACIFIC }).format(date);
}

function pacificLocalTimestamp(date, timeValue) {
  const match = text(timeValue).match(/(?:^|\b)(\d{1,2}):(\d{2})\s*([AP])\s*\.?\s*M\s*\.?(?:\s*(?:PT|PST|PDT))?(?:$|\b)/i);
  if (!match) return null;
  const clockHour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(clockHour) || clockHour < 1 || clockHour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  let hour = clockHour % 12;
  if (match[3].toUpperCase() === "P") hour += 12;
  const [year, month, day] = date.split("-").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const midday = new Date(Date.UTC(year, month - 1, day, 12));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(midday).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - midday.getTime();
  const result = new Date(localAsUtc - offset);
  return Number.isFinite(result.getTime()) ? result.toISOString() : null;
}

function dateParts(game) {
  const raw = sourceDate(game);
  if (!raw) return { startsAt: null, date: null, dateConfirmed: false, timeConfirmed: false };
  const dateOnly = calendarDate(raw);
  if (dateOnly) {
    const explicitDateTbd = game?.date_tbd === true || game?.dateTbd === true || game?.date_confirmed === false || game?.dateConfirmed === false;
    const startsAt = explicitDateTbd ? null : pacificLocalTimestamp(dateOnly, game?.kickoff_time ?? game?.kickoffTime ?? game?.status);
    return { startsAt, date: explicitDateTbd ? null : dateOnly, dateConfirmed: !explicitDateTbd, timeConfirmed: Boolean(startsAt) && game?.time_tbd !== true && game?.timeTbd !== true && game?.time_confirmed !== false && game?.timeConfirmed !== false };
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return { startsAt: null, date: null, dateConfirmed: false, timeConfirmed: false };
  const explicitDateTbd = game?.date_tbd === true || game?.dateTbd === true || game?.date_confirmed === false || game?.dateConfirmed === false;
  const explicitTimeTbd = game?.time_tbd === true || game?.timeTbd === true || game?.time_confirmed === false || game?.timeConfirmed === false;
  const placeholderMidnight = parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0 && parsed.getUTCSeconds() === 0;
  const placeholderDate = explicitTimeTbd && placeholderMidnight ? calendarDate(text(raw).slice(0, 10)) : null;
  const dateConfirmed = !explicitDateTbd;
  const timeConfirmed = dateConfirmed && !explicitTimeTbd && (game?.timeConfirmed === true || !placeholderMidnight);
  return {
    startsAt: timeConfirmed ? parsed.toISOString() : null,
    date: dateConfirmed ? placeholderDate ?? pacificCalendarDay(parsed) : null,
    dateConfirmed,
    timeConfirmed,
  };
}

export function normalizeGame(game, season) {
  const phase = schedulePhase(game);
  if (!SCHEDULE_PHASES.includes(phase)) throw new Error(`Game ${game?.id ?? game?.game_id ?? "unknown"} has an invalid or missing season type.`);
  const state = scheduleState(game);
  const dates = state === "bye" ? { startsAt: null, date: null, dateConfirmed: false, timeConfirmed: false } : dateParts(game);
  const home = game?.home_team ?? game?.homeTeam ?? null;
  const away = game?.visitor_team ?? game?.away_team ?? game?.awayTeam ?? null;
  const suppliedOpponent = game?.opponent ?? null;
  const opponent = suppliedOpponent ?? (abbr(home) === TEAM ? away : abbr(away) === TEAM ? home : null);
  const venueValue = game?.venue?.name ?? game?.venue ?? game?.stadium?.name ?? game?.stadium ?? null;
  const networkValue = game?.network ?? game?.tv_network ?? game?.tvNetwork ?? game?.broadcast ?? null;
  const radioValue = game?.radio?.name ?? (typeof game?.radio === "string" ? game.radio : null) ?? game?.radio_network ?? game?.radioNetwork ?? null;
  const id = text(game?.id ?? game?.game_id) || `${season}-${phase}-${integer(game?.week) ?? "tbd"}-${state}`;
  return {
    ...game,
    id,
    season: integer(game?.season ?? season),
    phase,
    state,
    week: integer(game?.week),
    bye: state === "bye",
    homeTeam: home,
    awayTeam: away,
    opponent,
    isHome: state === "bye" ? null : abbr(home) === TEAM ? true : abbr(away) === TEAM ? false : null,
    ...dates,
    venue: game?.venue_confirmed === false || game?.venueConfirmed === false ? null : venueValue || null,
    network: game?.network_confirmed === false || game?.networkConfirmed === false ? null : networkValue || null,
    radio: game?.radio_confirmed === false || game?.radioConfirmed === false ? null : radioValue || null,
    venueUrl: allowlistedUrl(game?.venue_url ?? game?.venueUrl ?? game?.venue?.url ?? game?.directions_url ?? game?.directionsUrl),
    watchUrl: allowlistedUrl(game?.watch_url ?? game?.watchUrl ?? game?.broadcast_url ?? game?.broadcastUrl),
    canonicalUrl: allowlistedUrl(game?.canonical_url ?? game?.canonicalUrl ?? game?.detail_url ?? game?.detailUrl),
    previewAvailable: game?.preview_available === true || game?.previewAvailable === true || Boolean(text(game?.preview?.summary ?? game?.preview?.text).length >= 120),
    opponentConfirmed: state === "bye" ? false : Boolean(opponent) && game?.opponent_confirmed !== false && game?.opponentConfirmed !== false,
  };
}

function addBye(games, season) {
  const regular = games.filter((game) => game.phase === "regular" && game.state !== "canceled");
  if (regular.some((game) => game.state === "bye")) return games;
  const weeks = new Set(regular.map((game) => game.week).filter((week) => week >= 1 && week <= 18));
  if (regular.length !== 17 || weeks.size !== 17) return games;
  const missing = Array.from({ length: 18 }, (_, index) => index + 1).filter((week) => !weeks.has(week));
  if (missing.length !== 1) return games;
  return [...games, normalizeGame({ id: `${season}-regular-${missing[0]}-bye`, season, season_type: "regular", week: missing[0], status: "bye", bye: true }, season)];
}

function eventTime(game) {
  if (game.startsAt) return new Date(game.startsAt).getTime();
  if (game.date) return new Date(`${game.date}T23:59:59-07:00`).getTime();
  return Number.MAX_SAFE_INTEGER;
}

export function sortSchedule(games) {
  const phaseOrder = new Map(SCHEDULE_PHASES.map((phase, index) => [phase, index]));
  return [...games].sort((a, b) =>
    (phaseOrder.get(a.phase) ?? 9) - (phaseOrder.get(b.phase) ?? 9)
    || (a.week ?? 99) - (b.week ?? 99)
    || eventTime(a) - eventTime(b));
}

export function normalizeSchedule(raw, expectedSeason = raw?.season) {
  const season = integer(expectedSeason);
  if (!season) throw new Error("Schedule season is missing or invalid.");
  const source = Array.isArray(raw?.games)
    ? raw.games
    : [...(raw?.gamesPreseason ?? []), ...(raw?.gamesRegular ?? []), ...(raw?.gamesPostseason ?? [])];
  const games = sortSchedule(addBye(source.map((game) => normalizeGame(game, season)), season));
  const record = { wins: 0, losses: 0, ties: 0 };
  for (const game of games) {
    if (game.phase !== "regular" || game.state !== "completed") continue;
    if (game.home_team_score == null || game.visitor_team_score == null) continue;
    const homeScore = Number(game.home_team_score);
    const awayScore = Number(game.visitor_team_score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
    const {team}Score = game.isHome ? homeScore : awayScore;
    const opponentScore = game.isHome ? awayScore : homeScore;
    if ({team}Score === opponentScore) record.ties += 1;
    else if ({team}Score > opponentScore) record.wins += 1;
    else record.losses += 1;
    game.{team}RecordAfter = `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
  }
  const normalized = {
    ...raw,
    season,
    sourceSeason: integer(raw?.sourceSeason ?? raw?.season),
    games,
    gamesPreseason: games.filter((game) => game.phase === "preseason"),
    gamesRegular: games.filter((game) => game.phase === "regular"),
    gamesPostseason: games.filter((game) => game.phase === "postseason"),
    nextGameId: nextScheduleEvent(games)?.id ?? null,
  };
  validateSchedule(normalized, season);
  return normalized;
}

export function nextScheduleEvent(games, now = new Date()) {
  const selected = selectFeaturedGame(games, { now });
  return ["live", "upcoming"].includes(selected.state) ? selected.game : null;
}

export function featuredScheduleEvent(games, now = new Date()) {
  return selectFeaturedGame(games, { now }).game;
}

function chronologicalTime(game, fallback = Number.MAX_SAFE_INTEGER) {
  if (game?.startsAt) {
    const value = new Date(game.startsAt).getTime();
    if (Number.isFinite(value)) return value;
  }
  if (game?.date) {
    const value = new Date(`${game.date}T23:59:59-07:00`).getTime();
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

/** Canonical featured-game selector used by every above-the-fold game surface. */
export function selectFeaturedGame(games, { now = new Date(), offseason = null, finalMaxAgeDays = 45 } = {}) {
  const rows = Array.isArray(games) ? games : [];
  const nowTime = now.getTime();
  const live = rows
    .filter((game) => game.state === "in_progress")
    .sort((a, b) => chronologicalTime(a) - chronologicalTime(b))[0];
  if (live) return { state: "live", game: live, offseason: null };

  const future = rows
    .filter((game) => !["bye", "canceled", "completed", "in_progress"].includes(game.state))
    .filter((game) => chronologicalTime(game) >= nowTime)
    .sort((a, b) => chronologicalTime(a) - chronologicalTime(b))[0];
  if (future) return { state: "upcoming", game: future, offseason: null };

  const completed = rows
    .filter((game) => game.state === "completed")
    .sort((a, b) => chronologicalTime(a, Number.MIN_SAFE_INTEGER) - chronologicalTime(b, Number.MIN_SAFE_INTEGER))
    .at(-1);
  const completedAge = completed ? nowTime - chronologicalTime(completed, Number.MIN_SAFE_INTEGER) : Number.POSITIVE_INFINITY;
  if (completed && (completedAge < 0 || completedAge <= finalMaxAgeDays * 86_400_000)) return { state: "final", game: completed, offseason: null };

  return {
    state: "offseason",
    game: null,
    offseason: offseason && typeof offseason === "object" ? offseason : { label: "Season overview", detail: "The next {Team} game will appear when the schedule is available.", href: "/schedule" },
  };
}

export function validateSchedule(schedule, displaySeason = schedule?.season) {
  const errors = [];
  const games = Array.isArray(schedule?.games) ? schedule.games : [];
  const sourceSeason = integer(schedule?.sourceSeason ?? schedule?.season);
  if (integer(displaySeason) !== sourceSeason) errors.push(`season mismatch: page ${displaySeason}, source ${sourceSeason}`);
  const ids = new Set();
  const weeks = new Set();
  for (const game of games) {
    if (ids.has(game.id)) errors.push(`duplicate game ID: ${game.id}`); else ids.add(game.id);
    const weekKey = game.week == null ? null : `${game.phase}:${game.week}`;
    if (weekKey && weeks.has(weekKey)) errors.push(`duplicate week: ${weekKey}`); else if (weekKey) weeks.add(weekKey);
    if (game.state !== "bye" && game.isHome === null) errors.push(`impossible home/away assignment: ${game.id}`);
    if (game.timeConfirmed && !game.startsAt) errors.push(`placeholder timestamp marked confirmed: ${game.id}`);
    if (game.schedule_authority === "official-team-guide-tbd" && (game.date || game.startsAt || game.dateConfirmed || game.timeConfirmed)) errors.push(`official TBD game exposes a synthetic kickoff: ${game.id}`);
    if (game.dateConfirmed && !calendarDate(game.date)) errors.push(`invalid kickoff date: ${game.id}`);
    if (game.startsAt && !Number.isFinite(new Date(game.startsAt).getTime())) errors.push(`invalid kickoff timestamp: ${game.id}`);
    if (game.date && game.startsAt) {
      const renderedDay = pacificCalendarDay(new Date(game.startsAt));
      if (renderedDay !== game.date) errors.push(`kickoff formatting moves calendar date: ${game.id} (${game.date} to ${renderedDay})`);
    }
  }
  if (schedule?.byeWeek != null && !games.some((game) => game.state === "bye" && game.week === integer(schedule.byeWeek))) errors.push(`missing supplied bye week: ${schedule.byeWeek}`);
  const next = nextScheduleEvent(games);
  if (schedule?.nextGameId != null && String(schedule.nextGameId) !== String(next?.id ?? "")) errors.push(`published next game skips earlier unfinished event: ${next?.id ?? "none"}`);
  if (errors.length) throw new Error(`Schedule validation failed:\n- ${errors.join("\n- ")}`);
  return true;
}

export function selectScheduleSeason(data, requestedSeason) {
  const collections = Array.isArray(data?.seasons) ? data.seasons : [data];
  const wanted = integer(requestedSeason ?? data?.season);
  const selected = collections.find((item) => integer(item?.season) === wanted);
  if (!selected) throw new Error(`Schedule season ${wanted} is unavailable.`);
  return normalizeSchedule(selected, wanted);
}

export function formatScheduleDate(game) {
  return formatKickoff(game, "short");
}

export function formatKickoff(game, style = "full") {
  if (!game?.dateConfirmed || !game?.date) return style === "time" ? "Time TBD" : "Date TBD";
  const value = game.startsAt ?? game.date;
  const date = new Date(game.startsAt ?? `${game.date}T12:00:00Z`);
  const dateText = formatPacificCalendarDate(value, {
    weekday: style === "full" ? "long" : "short", month: style === "full" ? "long" : "short", day: "numeric", year: style === "full" ? "numeric" : undefined,
  });
  if (!game.timeConfirmed || !game.startsAt) return style === "time" ? "Time TBD" : `${dateText} · Time TBD`;
  const timeText = `${new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, hour: "numeric", minute: "2-digit" }).format(date)} PT`;
  if (style === "date") return dateText;
  if (style === "time") return timeText;
  return `${dateText} · ${timeText}`;
}

export function scheduleFreshness(updatedAt, now = new Date()) {
  const updated = new Date(updatedAt);
  if (!Number.isFinite(updated.getTime())) return { label: "Schedule update time unavailable", stale: true };
  const label = `Schedule updated ${new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(updated)} PT`;
  return { label, stale: now.getTime() - updated.getTime() > 72 * 60 * 60 * 1000 };
}
