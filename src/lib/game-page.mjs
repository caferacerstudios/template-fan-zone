import { formatKickoff, formatPacificCalendarDate } from "./schedule.mjs";

const TEAM_NAME = "{Location} {Team}";
const PACIFIC = "America/Los_Angeles";
const text = (value) => String(value ?? "").trim();

export function gameMatchup(game) {
  if (!game) return "{Location} {Team} game";
  return game.home ? `${game.opponentName} at ${TEAM_NAME}` : `${TEAM_NAME} at ${game.opponentName}`;
}

export function gamePageMetadata(game) {
  if (!game) return {
    title: "{Location} {Team} Game Guide | {Team} Fan Zone",
    h1: "{Location} {Team} Game Guide",
    description: "{Location} {Team} game information, viewing details, schedule context, and matchup coverage.",
    summary: "Review the available {Location} {Team} game details and schedule context.",
  };
  const matchup = gameMatchup(game);
  const season = Number(game.game?.season) || new Date(game.game?.startsAt ?? game.game?.date ?? Date.now()).getFullYear();
  const dateValue = game.game?.startsAt ?? game.game?.date ?? null;
  const date = dateValue ? formatPacificCalendarDate(dateValue, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : null;
  const kickoff = game.game?.timeConfirmed && game.game?.startsAt ? formatKickoff(game.game, "time") : null;
  const timing = date ? ` on ${date}${kickoff ? ` at ${kickoff}` : ""}` : "";
  const venue = game.venue;
  const place = venue ? ` at ${venue}` : "";
  const status = game.completed && game.seaScore != null && game.opponentScore != null
    ? `{Location} ${game.seaScore}, ${game.opponentName} ${game.opponentScore}`
    : text(game.game?.state ?? game.game?.status) || "Scheduled";
  return {
    matchup, season,
    title: `${matchup}: ${game.weekLabel} Guide (${season}) | {Team} Fan Zone`,
    h1: `${matchup}: ${game.weekLabel} Game Guide (${season})`,
    description: `${matchup} ${game.weekLabel} guide for the ${season} season${timing}${place}. See game status, viewing information, game-day details, and matchup context.`,
    summary: `${matchup} is {Location}'s ${game.home ? "home" : "away"} game for ${game.weekLabel} of the ${season} season${timing}${place}. Current status: ${status}. This page keeps the confirmed game facts and any maintained preview or recap together at the same URL.`,
  };
}

export function sportsEventData(game, metadata, url) {
  if (!game?.game?.startsAt) return null;
  const homeTeam = game.home ? TEAM_NAME : game.opponentName;
  const awayTeam = game.home ? game.opponentName : TEAM_NAME;
  const statuses = {
    completed: "https://schema.org/EventCompleted",
    in_progress: "https://schema.org/EventInProgress",
    postponed: "https://schema.org/EventPostponed",
    canceled: "https://schema.org/EventCancelled",
    upcoming: "https://schema.org/EventScheduled",
    tbd: "https://schema.org/EventScheduled",
  };
  const locationName = game.venue;
  const locationText = game.editorial?.location;
  return {
    "@context": "https://schema.org", "@type": "SportsEvent",
    name: metadata.matchup,
    startDate: game.game.startsAt,
    eventStatus: statuses[game.game.state] ?? "https://schema.org/EventScheduled",
    homeTeam: { "@type": "SportsTeam", name: homeTeam },
    awayTeam: { "@type": "SportsTeam", name: awayTeam },
    location: locationName ? { "@type": "Place", name: locationName, ...(locationText ? { address: locationText } : {}) } : undefined,
    url,
  };
}

export function formatPacificTimestamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}
