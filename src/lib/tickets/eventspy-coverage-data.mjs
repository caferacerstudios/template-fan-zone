const EVENTSPY_UNAVAILABLE_REASON = "SOURCE_PAGE_NOT_AVAILABLE";
export const EVENTSPY_COVERAGE = Object.freeze([
  ["1392216","authorized","New England Patriots","home","2026-09-09","374440","https://www.event-spy.com/event/seattle-seahawks-seattle-sep-09-2026/374440"],
  ["1392244","authorized","Arizona Cardinals","away","2026-09-20","374512","https://www.event-spy.com/event/arizona-cardinals-glendale-sep-20-2026/374512"],
  ["1392256","authorized","Washington Commanders","away","2026-09-27","374572","https://www.event-spy.com/event/washington-commanders-landover-sep-27-2026/374572"],
  ["1392277","authorized","Los Angeles Chargers","home","2026-10-04","374598","https://www.event-spy.com/event/seattle-seahawks-seattle-oct-04-2026/374598"],
  ["1392292","authorized","San Francisco 49ers","home","2026-10-11","374637","https://www.event-spy.com/event/seattle-seahawks-seattle-oct-11-2026/374637"],
  ["1392295","authorized","Denver Broncos","away","2026-10-15","374655","https://www.event-spy.com/event/denver-broncos-denver-oct-15-2026/374655"],
  ["1392321","authorized","Kansas City Chiefs","home","2026-10-25","374731","https://www.event-spy.com/event/seattle-seahawks-seattle-oct-25-2026/374731"],
  ["1392336","authorized","Chicago Bears","home","2026-11-02","374774","https://www.event-spy.com/event/seattle-seahawks-seattle-nov-02-2026/374774"],
  ["1392349","authorized","Arizona Cardinals","home","2026-11-08","374817","https://www.event-spy.com/event/seattle-seahawks-seattle-nov-08-2026/374817"],
  ["1392361","authorized","Las Vegas Raiders","away","2026-11-15","374870","https://www.event-spy.com/event/las-vegas-raiders-las-vegas-nov-15-2026/374870"],
  ["1392392","authorized","San Francisco 49ers","away","2026-11-29","374957","https://www.event-spy.com/event/san-francisco-49ers-santa-clara-nov-29-2026/374957"],
  ["1392408","authorized","Dallas Cowboys","home","2026-12-07","375020","https://www.event-spy.com/event/seattle-seahawks-seattle-dec-07-2026/375020"],
  ["1392421","authorized","New York Giants","home","2026-12-13","375054","https://www.event-spy.com/event/seattle-seahawks-seattle-dec-13-2026/375054"],
  ["1392425","authorized","Philadelphia Eagles","away","2026-12-19","375079","https://www.event-spy.com/event/philadelphia-eagles-philadelphia-dec-19-2026/375079"],
  ["1392443","authorized","Los Angeles Rams","home","2026-12-25","375121","https://www.event-spy.com/event/seattle-seahawks-seattle-dec-25-2026/375121"],
  ["1392467","authorized","Carolina Panthers","away","2027-01-03","375156","https://www.event-spy.com/event/carolina-panthers-charlotte-jan-03-2027/375156"],
  ["1392478","unavailable","Los Angeles Rams","away",null,null,null],
].map(([gameId,state,opponent,homeAway,localDate,sourceEventId,sourceUrl]) => Object.freeze({
  gameId,state,opponent,homeAway,localDate,sourceEventId,sourceUrl,
  reasonCode: state === "unavailable" ? EVENTSPY_UNAVAILABLE_REASON : null,
})));

