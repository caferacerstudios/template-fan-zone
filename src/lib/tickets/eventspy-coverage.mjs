export const EVENTSPY_COVERAGE_SCHEMA_VERSION = "1.0.0";
export const EVENTSPY_UNAVAILABLE_REASON = "SOURCE_PAGE_NOT_AVAILABLE";

import { EVENTSPY_COVERAGE } from "./eventspy-coverage-data.mjs";
export { EVENTSPY_COVERAGE };
export const EVENTSPY_TEAM_NAME = "{Location} {Team}";
export const EVENTSPY_FEED_ROOT = "/data/eventspy-mirror/{team}";
export const eventSpyMirrorUrl = (gameId) => {
  if (!isSafeEventSpyGameId(gameId) || !eventSpyCoverageForGame(gameId)) throw new TypeError("Game is not in this team’s EventSpy coverage.");
  return `${EVENTSPY_FEED_ROOT}/${gameId}.json`;
};

const forbidden = /(?:performer|search|account|login|notification|parking|tailgate|season[- ]?ticket)/i;
const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const fail = (message) => { throw new TypeError(message); };

export function validateEventSpyCoverage(rows = EVENTSPY_COVERAGE, schedule = null) {
  if (!Array.isArray(rows) || rows.length !== 17) fail("EventSpy coverage must contain exactly 17 eligible games.");
  const games = new Set(), urls = new Set(), events = new Set();
  for (const row of rows) {
    if (!row || !safeId.test(row.gameId) || games.has(row.gameId)) fail("Duplicate or unsafe EventSpy game ID.");
    games.add(row.gameId);
    if (!["authorized","unavailable"].includes(row.state) || !["home","away"].includes(row.homeAway) || !row.opponent) fail("Invalid EventSpy coverage identity.");
    if (row.state === "unavailable") {
      if ((row.localDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(row.localDate)) || row.sourceEventId !== null || row.sourceUrl !== null || row.reasonCode !== EVENTSPY_UNAVAILABLE_REASON) fail("Invalid unavailable EventSpy coverage row.");
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.localDate) || !/^\d{6}$/.test(row.sourceEventId) || events.has(row.sourceEventId)) fail("Duplicate or invalid EventSpy event ID.");
    let url; try { url = new URL(row.sourceUrl); } catch { fail("Invalid EventSpy source URL."); }
    if (url.protocol !== "https:" || url.hostname !== "www.event-spy.com" || url.username || url.password || url.port || url.search || url.hash || forbidden.test(url.pathname) ||
        url.pathname !== `/event/${url.pathname.split("/")[2]}/${row.sourceEventId}` || !/^\/event\/[a-z0-9-]+\/\d{6}$/.test(url.pathname) || urls.has(url.href)) fail("Unsafe or duplicate EventSpy source URL.");
    urls.add(url.href); events.add(row.sourceEventId);
  }
  if (schedule) {
    const scheduleRows = Array.isArray(schedule) ? schedule : schedule.games;
    if (!Array.isArray(scheduleRows) || scheduleRows.length !== rows.length) fail("Schedule coverage gap.");
    for (const row of rows) {
      const game = scheduleRows.find((item) => String(item.gameId ?? item.id) === row.gameId);
      if (!game) fail("Schedule coverage gap.");
      const opponent = game.opponent?.name ?? game.opponent?.full_name ?? game.opponent;
      const homeAway = game.homeAway ?? (game.isHome === true ? "home" : game.isHome === false ? "away" : null);
      const localDate = game.localDate ?? game.date ?? null;
      if (opponent !== row.opponent || homeAway !== row.homeAway || localDate !== row.localDate) fail("Schedule identity does not match reviewed EventSpy coverage.");
    }
  }
  return rows;
}

export const eventSpyCoverageForGame = (gameId) => EVENTSPY_COVERAGE.find((row) => row.gameId === String(gameId)) ?? null;
export const eventSpyCoverageForUrl = (url) => EVENTSPY_COVERAGE.find((row) => row.sourceUrl === url) ?? null;
export const isSafeEventSpyGameId = (gameId) => safeId.test(String(gameId));
validateEventSpyCoverage();
