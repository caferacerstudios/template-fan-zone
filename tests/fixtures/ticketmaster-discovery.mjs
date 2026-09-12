const SEA = { abbreviation: "SEA", name: "Seattle {Team}" };

const rows = [
  ["vvG1HZ_F5JLE3p", "Seattle {Team} vs. New England Patriots", "NE", "New England Patriots", "2026-09-09", "2026-09-10T00:20:00Z", "Lumen Field"],
  ["tm-ari-away", "Arizona Cardinals V Seattle {Team}", "ARI", "Arizona Cardinals", "2026-09-20", "2026-09-20T20:05:00Z", "State Farm Stadium", false],
  ["tm-was-away", "Washington Commanders vs. Seattle {Team}", "WAS", "Washington Commanders", "2026-09-27", "2026-09-27T17:00:00Z", "Northwest Stadium", false],
  ["tm-lac-home", "Seattle {Team} vs. Los Angeles Chargers", "LAC", "Los Angeles Chargers", "2026-10-04", "2026-10-04T20:05:00Z", "Lumen Field"],
  ["tm-sf-home", "Seattle {Team} vs. San Francisco 49ers", "SF", "San Francisco 49ers", "2026-10-11", "2026-10-11T20:25:00Z", "Lumen Field"],
  ["tm-den-away", "Denver Broncos vs. Seattle {Team}", "DEN", "Denver Broncos", "2026-10-15", "2026-10-16T00:15:00Z", "Empower Field At Mile High", false],
  ["tm-kc-home", "Seattle {Team} vs. Kansas City Chiefs", "KC", "Kansas City Chiefs", "2026-10-25", "2026-10-26T00:20:00Z", "Lumen Field"],
  ["tm-chi-home", "Seattle {Team} vs. Chicago Bears", "CHI", "Chicago Bears", "2026-11-02", "2026-11-03T01:15:00Z", "Lumen Field"],
  ["tm-ari-home", "Seattle {Team} vs. Arizona Cardinals", "ARI", "Arizona Cardinals", "2026-11-08", "2026-11-08T21:25:00Z", "Lumen Field"],
  ["tm-lv-away", "Las Vegas Raiders vs. Seattle {Team}", "LV", "Las Vegas Raiders", "2026-11-15", "2026-11-15T21:05:00Z", "Allegiant Stadium", false],
  ["tm-sf-away", "San Francisco 49ers vs. Seattle {Team}", "SF", "San Francisco 49ers", "2026-11-29", "2026-11-29T21:25:00Z", "Levi's Stadium", false],
  ["tm-dal-home", "Seattle {Team} vs. Dallas Cowboys", "DAL", "Dallas Cowboys", "2026-12-07", "2026-12-08T01:15:00Z", "Lumen Field"],
  ["tm-nyg-home", "Seattle {Team} vs. New York Giants", "NYG", "New York Giants", "2026-12-13", "2026-12-13T21:25:00Z", "Lumen Field"],
  ["tm-phi-away", "Philadelphia Eagles vs. Seattle {Team}", "PHI", "Philadelphia Eagles", "2026-12-19", "2026-12-20T01:15:00Z", "Lincoln Financial Field", false],
  ["tm-lar-home", "Seattle {Team} vs. Los Angeles Rams", "LAR", "Los Angeles Rams", "2026-12-25", "2026-12-26T01:15:00Z", "Lumen Field"],
  ["tm-car-away", "Carolina Panthers v Seattle {Team}", "CAR", "Carolina Panthers", "2027-01-03", "2027-01-03T18:00:00Z", "Bank of America Stadium", false],
];

const team = (abbreviation, name) => ({ abbreviation, name });
const venueZones = new Map([
  ["State Farm Stadium", "America/Phoenix"], ["Northwest Stadium", "America/New_York"],
  ["Empower Field At Mile High", "America/Denver"], ["Allegiant Stadium", "America/Los_Angeles"],
  ["Levi's Stadium", "America/Los_Angeles"], ["Lincoln Financial Field", "America/New_York"],
  ["Bank of America Stadium", "America/New_York"],
]);

export const games = [
  ...rows.map(([, , abbreviation, name, date, startTimeUtc, venue, home = true], index) => ({
    id: `2026-regular-${index + 1}-${home ? "home" : "away"}-${abbreviation.toLowerCase()}`,
    season: 2026, phase: "regular", week: index + 1, state: "upcoming",
    homeTeam: home ? SEA : team(abbreviation, name), awayTeam: home ? team(abbreviation, name) : SEA,
    opponent: team(abbreviation, name), isHome: home, venue, date, startsAt: startTimeUtc,
    dateConfirmed: true, timeConfirmed: true, opponentConfirmed: true,
  })),
  // The supplied Discovery response omitted the second Rams matchup.
  { id: "2026-regular-17-away-lar", season: 2026, phase: "regular", week: 17, state: "upcoming", homeTeam: team("LAR", "Los Angeles Rams"), awayTeam: SEA, opponent: team("LAR", "Los Angeles Rams"), isHome: false, venue: "SoFi Stadium", date: "2027-01-10", startsAt: "2027-01-10T21:25:00Z", dateConfirmed: true, timeConfirmed: true, opponentConfirmed: true },
];

const normalized = ([id, name, abbreviation, opponent, localDate, startTimeUtc, venue, home = true]) => {
  const timeZone = venueZones.get(venue) ?? "America/Los_Angeles";
  const local = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(startTimeUtc)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const participants = home ? [{ id: "tm-sea", name: SEA.name }, { id: `tm-${abbreviation.toLowerCase()}`, name: opponent }] : [{ id: `tm-${abbreviation.toLowerCase()}`, name: opponent }, { id: "tm-sea", name: SEA.name }];
  return {
    id, name, canonicalUrl: `https://www.ticketmaster.com/event/${id}`,
    attractions: participants, teams: structuredClone(participants), venue: { name: venue }, startTimeUtc, localDate,
    localTime: `${local.hour}:${local.minute}:${local.second}`, timeZone,
    classifications: [{ segment: "Sports", genre: "Football", subGenre: "NFL", type: null, subType: null }],
    classification: "Sports Football NFL", eventType: "NFL football", eventStatus: "onsale",
    salesStatus: null, priceRanges: [], allInclusivePricing: null, provider: "ticketmaster",
  };
};

export const legitimateEvents = rows.map(normalized);
const denver = normalized(rows[5]);
const vegas = normalized(rows[9]);
export const rejectedEvents = [
  { ...denver, id: "tm-half-price", name: "HALF PRICE: Denver Broncos v Seattle {Team}" },
  { ...vegas, id: "tm-hotel", name: "Las Vegas Raiders vs. Seattle {Team} | Official Hotel Packages" },
  { ...normalized(rows[0]), id: "tm-notification", name: "Seattle {Team} Season Ticket Notification List", attractions: [{ id: "tm-sea", name: SEA.name }], teams: [{ id: "tm-sea", name: SEA.name }] },
];

export const providerEvents = [...legitimateEvents, ...rejectedEvents];
