const PHASES = new Set(["preseason", "regular", "postseason"]);

export function getWatchGuideEntry(game, watchGuide) {
  const season = Number(game?.season);
  const phase = String(game?.phase ?? "").toLowerCase();
  const week = Number(game?.week);
  if (!Number.isInteger(season) || !PHASES.has(phase) || !Number.isInteger(week)) return null;
  if (Number(watchGuide?.season) !== season || !Array.isArray(watchGuide?.games)) return null;
  return watchGuide.games.find((entry) =>
    String(entry?.phase ?? "").toLowerCase() === phase && Number(entry?.week) === week &&
    (entry?.gameId === undefined || String(entry.gameId) === String(game?.id ?? game?.game_id))
  ) ?? null;
}

export function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const shortLocalName = (name) => String(name).replace(/ Seattle$/, "");
const nationalNames = (national) => {
  const value = String(national ?? "");
  if (/^ABC and ESPN\b/i.test(value)) return ["ABC", "ESPN"];
  const match = value.match(/^(FOX|CBS|NBC)\b/i);
  return match ? [match[1].toUpperCase()] : [];
};

export function watchGuideScheduleLines(entry) {
  if (!entry) return [];
  if (entry.status === "tbd") return ["TBD"];
  if (entry.status === "completed" && entry.originalBroadcast) {
    return [entry.originalBroadcast, ...(entry.replay ?? []).map((provider) => `${provider.name} replay`)];
  }
  const local = (entry.localTv ?? []).map((station) =>
    `${shortLocalName(station.name)}${station.note === "Special local simulcast" ? " simulcast" : ""}`
  ).join(" · ");
  const streamNames = (entry.streams ?? [])
    .map((provider) => provider?.name)
    .filter((name) => name && name !== "NFL Sunday Ticket" && name !== "NFL {Team} ways to watch");
  const national = [...new Set([...nationalNames(entry.national), ...streamNames])].join(" · ");
  return [local, national].filter(Boolean);
}
