export const EVENTSPY_COVERAGE_SCHEMA_VERSION = "1.0.0";
export const EVENTSPY_UNAVAILABLE_REASON = "SOURCE_PAGE_NOT_AVAILABLE";

export const EVENTSPY_COVERAGE = Object.freeze([
  ["1392216","authorized","New England Patriots","home","2026-09-09","374440","https://www.event-spy.com/event/seattle-{team}-seattle-sep-09-2026/374440"],
  ["1392244","authorized","Arizona Cardinals","away","2026-09-20","374512","https://www.event-spy.com/event/arizona-cardinals-glendale-sep-20-2026/374512"],
  ["1392256","authorized","Washington Commanders","away","2026-09-27","374572","https://www.event-spy.com/event/washington-commanders-landover-sep-27-2026/374572"],
  ["1392277","authorized","Los Angeles Chargers","home","2026-10-04","374598","https://www.event-spy.com/event/seattle-{team}-seattle-oct-04-2026/374598"],
  ["1392292","authorized","San Francisco 49ers","home","2026-10-11","374637","https://www.event-spy.com/event/seattle-{team}-seattle-oct-11-2026/374637"],
  ["1392295","authorized","Denver Broncos","away","2026-10-15","374655","https://www.event-spy.com/event/denver-broncos-denver-oct-15-2026/374655"],
  ["1392321","authorized","Kansas City Chiefs","home","2026-10-25","374731","https://www.event-spy.com/event/seattle-{team}-seattle-oct-25-2026/374731"],
  ["1392336","authorized","Chicago Bears","home","2026-11-02","374774","https://www.event-spy.com/event/seattle-{team}-seattle-nov-02-2026/374774"],
  ["1392349","authorized","Arizona Cardinals","home","2026-11-08","374817","https://www.event-spy.com/event/seattle-{team}-seattle-nov-08-2026/374817"],
  ["1392361","authorized","Las Vegas Raiders","away","2026-11-15","374870","https://www.event-spy.com/event/las-vegas-raiders-las-vegas-nov-15-2026/374870"],
  ["1392392","authorized","San Francisco 49ers","away","2026-11-29","374957","https://www.event-spy.com/event/san-francisco-49ers-santa-clara-nov-29-2026/374957"],
  ["1392408","authorized","Dallas Cowboys","home","2026-12-07","375020","https://www.event-spy.com/event/seattle-{team}-seattle-dec-07-2026/375020"],
  ["1392421","authorized","New York Giants","home","2026-12-13","375054","https://www.event-spy.com/event/seattle-{team}-seattle-dec-13-2026/375054"],
  ["1392425","authorized","Philadelphia Eagles","away","2026-12-19","375079","https://www.event-spy.com/event/philadelphia-eagles-philadelphia-dec-19-2026/375079"],
  ["1392443","authorized","Los Angeles Rams","home","2026-12-25","375121","https://www.event-spy.com/event/seattle-{team}-seattle-dec-25-2026/375121"],
  ["1392467","authorized","Carolina Panthers","away","2027-01-03","375156","https://www.event-spy.com/event/carolina-panthers-charlotte-jan-03-2027/375156"],
  ["1392478","unavailable","Los Angeles Rams","away",null,null,null],
].map(([gameId,state,opponent,homeAway,localDate,sourceEventId,sourceUrl]) => Object.freeze({
  gameId,state,opponent,homeAway,localDate,sourceEventId,sourceUrl,
  reasonCode: state === "unavailable" ? EVENTSPY_UNAVAILABLE_REASON : null,
})));

const forbidden = /(?:performer|search|account|login|notification|parking|season[- ]?ticket)/i;
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
      if (row.gameId !== "1392478" || row.localDate !== null || row.sourceEventId !== null || row.sourceUrl !== null || row.reasonCode !== EVENTSPY_UNAVAILABLE_REASON) fail("Invalid unavailable EventSpy coverage row.");
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
