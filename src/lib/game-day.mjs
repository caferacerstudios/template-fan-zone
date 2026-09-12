import { scheduleResult } from "./schedule-display.mjs";
import { formatKickoff } from "./schedule.mjs";

const PACIFIC = "America/Los_Angeles";
const text = (value) => String(value ?? "").trim();
const abbreviation = (team) => text(team?.abbreviation ?? team?.abbr).toUpperCase();
const teamName = (team, fallback = "Team TBD") => text(team?.full_name ?? team?.fullName ?? team?.name) || fallback;

function pacificDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function phaseLabel(phase) {
  return ({ preseason: "Preseason", regular: "Regular Season", postseason: "Postseason" })[phase] ?? "Season";
}

function matchingRecord(game, side) {
  const source = game?.records?.[side] ?? game?.[`${side}Record`] ?? game?.[`${side}_record`];
  if (!source) return null;
  if (typeof source === "string") return null;
  const phase = text(source.phase ?? source.season_type ?? source.seasonType).toLowerCase();
  if (phase !== game.phase) return null;
  const value = text(source.record ?? source.value);
  return value || null;
}

export function gameDayView(game, now = new Date()) {
  if (!game) return null;
  const sea = abbreviation(game.homeTeam) === "{Abbreviation}" ? game.homeTeam : abbreviation(game.awayTeam) === "{Abbreviation}" ? game.awayTeam : null;
  const opponent = game.opponent;
  const opponentAbbr = abbreviation(opponent);
  const opponentName = teamName(opponent, game.opponentConfirmed === false ? "Opponent TBD" : opponentAbbr || "Opponent TBD");
  const result = scheduleResult(game);
  const homeScore = Number(game.home_team_score);
  const awayScore = Number(game.visitor_team_score);
  const liveScore = game.state === "in_progress" && game.home_team_score != null && game.visitor_team_score != null && Number.isFinite(homeScore) && Number.isFinite(awayScore)
    ? { {team}: game.isHome ? homeScore : awayScore, opponent: game.isHome ? awayScore : homeScore }
    : null;
  const start = game.startsAt ? new Date(game.startsAt) : null;
  const validStart = start && Number.isFinite(start.getTime());
  const today = validStart && pacificDay(start) === pacificDay(now);
  const status = game.state === "in_progress" ? "Live"
    : game.state === "completed" ? "Final"
    : game.state === "postponed" ? "Postponed"
    : game.state === "tbd" ? "Details TBD"
    : today ? "Today" : "Next game";
  const date = formatKickoff(game, "date");
  const kickoff = formatKickoff(game, "time");
  const detailHref = game.canonicalUrl || `/games/${encodeURIComponent(String(game.id))}`;
  const substantive = game.opponentConfirmed !== false && Boolean(game.date || game.venue || game.network || game.radio);
  return {
    status, phaseWeek: `${phaseLabel(game.phase)}${game.week ? ` Week ${game.week}` : ""}`,
    sea, seaAbbr: abbreviation(sea) || "{Abbreviation}", seaName: teamName(sea, "Seattle {Team}"), opponent, opponentAbbr, opponentName, result, liveScore, date, kickoff, detailHref,
    location: game.isHome ? "Home vs." : game.isHome === false ? "Away at" : "Location TBD",
    network: game.network || null, radio: game.radio || null, venue: game.venue || null, venueUrl: game.venueUrl || null,
    division: new Set(["ARI", "LAR", "SF"]).has(opponentAbbr),
    primeTime: Boolean(game.prime_time ?? game.primeTime ?? game.is_primetime),
    seaRecord: matchingRecord(game, "{team}"), opponentRecord: matchingRecord(game, "opponent"),
    primaryLabel: game.state === "completed" ? "Game recap" : game.state === "in_progress" ? "Game center" : substantive ? "Game preview" : null,
    quarter: text(game.quarter ?? game.period) || null,
    clock: text(game.clock ?? game.time_remaining ?? game.timeRemaining) || null,
  };
}

const icsEscape = (value) => text(value).replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
const utcStamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fold = (line) => {
  const chunks = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let end = 74;
    while (Buffer.byteLength(rest.slice(0, end), "utf8") > 74) end -= 1;
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  chunks.push(rest);
  return chunks.join("\r\n ");
};

export function gameCalendar(game, canonicalBase) {
  if (["bye", "canceled", "postponed"].includes(game?.state)) return { enabled: false, label: "Calendar unavailable", reason: "This event does not currently have a confirmed active kickoff." };
  if (!game?.dateConfirmed || !game?.date || !game?.timeConfirmed || !game?.startsAt) return { enabled: false, label: "Calendar unavailable — kickoff not confirmed", reason: "Add to calendar becomes available when the date and kickoff time are confirmed." };
  const opponentName = teamName(game.opponent, "Opponent TBD");
  const sea = abbreviation(game.homeTeam) === "{Abbreviation}" ? game.homeTeam : abbreviation(game.awayTeam) === "{Abbreviation}" ? game.awayTeam : null;
  const seaName = teamName(sea, "Seattle {Team}");
  const location = game.isHome ? `Home vs. ${opponentName}` : `Away at ${opponentName}`;
  const detailPath = game.canonicalUrl || `/games/${encodeURIComponent(String(game.id))}`;
  const canonicalUrl = new URL(detailPath, canonicalBase).toString();
  const start = new Date(game.startsAt);
  const end = game.endsAt && Number.isFinite(new Date(game.endsAt).getTime()) ? new Date(game.endsAt) : new Date(start.getTime() + 3.5 * 60 * 60 * 1000);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//{Team} Fan Zone//Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-TIMEZONE:${PACIFIC}`, "BEGIN:VEVENT",
    `UID:${icsEscape(`${game.id}@{team}fanzone`)}`, `DTSTAMP:${utcStamp(new Date(0))}`, `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`,
    `SUMMARY:${icsEscape(`${seaName} ${game.isHome ? "vs." : "at"} ${opponentName}`)}`,
    ...(game.venue ? [`LOCATION:${icsEscape(game.venue)}`] : []),
    `DESCRIPTION:${icsEscape(`${location}. NFL dates and times may change. Game details: ${canonicalUrl}`)}`, `URL:${icsEscape(canonicalUrl)}`, "END:VEVENT", "END:VCALENDAR"];
  const content = `${lines.map(fold).join("\r\n")}\r\n`;
  return { enabled: true, label: "Add to calendar", filename: `{team}-${game.id}.ics`, content, href: `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}` };
}

export function seasonCalendar(schedule, canonicalBase) {
  const events = (schedule?.games ?? []).filter((game) => game.state !== "bye" && game.state !== "canceled" && game.dateConfirmed && game.date);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//{Team} Fan Zone//Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:Seattle {Team} ${schedule.season} schedule`, `X-WR-TIMEZONE:${PACIFIC}`];
  for (const game of events) {
    const opponentName = teamName(game.opponent, "Opponent TBD");
    const detailPath = game.canonicalUrl || `/games/${encodeURIComponent(String(game.id))}`;
    const canonicalUrl = new URL(detailPath, canonicalBase).toString();
    const result = scheduleResult(game);
    const status = result ? `Final: {Team} ${result.{team}}, ${opponentName} ${result.opponent}` : game.state === "completed" ? "Final" : game.state === "postponed" ? "Postponed" : game.state === "in_progress" ? "In progress" : "Scheduled";
    const start = game.startsAt ? new Date(game.startsAt) : null;
    const timed = game.timeConfirmed && start && Number.isFinite(start.getTime());
    const end = timed ? (game.endsAt && Number.isFinite(new Date(game.endsAt).getTime()) ? new Date(game.endsAt) : new Date(start.getTime() + 3.5 * 60 * 60 * 1000)) : null;
    lines.push("BEGIN:VEVENT", `UID:${icsEscape(`${schedule.season}-${game.id}@{team}fanzone`)}`, `DTSTAMP:${utcStamp(new Date(0))}`);
    if (timed) lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
    else {
      const date = game.date.replaceAll("-", "");
      const next = new Date(`${game.date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replaceAll("-", "")}`);
    }
    lines.push(`SUMMARY:${icsEscape(`Seattle {Team} ${game.isHome ? "vs." : "at"} ${opponentName}${timed ? "" : " (time TBD)"}`)}`,
      ...(game.venue ? [`LOCATION:${icsEscape(game.venue)}`] : []),
      `DESCRIPTION:${icsEscape(`${status}. NFL dates and times may change. Game details: ${canonicalUrl}`)}`, `URL:${icsEscape(canonicalUrl)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return { filename: `{team}-${schedule.season}-schedule.ics`, content: `${lines.map(fold).join("\r\n")}\r\n`, eventCount: events.length };
}
