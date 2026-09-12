export const NFL_TEAM_ABBREVIATIONS = Object.freeze([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]);

const NFL_TEAM_ALIASES = Object.freeze({
  JAC: "JAX",
  LA: "LAR",
  LVR: "LV",
  WSH: "WAS",
});

// Public logo filenames are stable, so changing their contents (or adding a
// formerly missing file) must also change this value to bypass cached misses.
export const NFL_TEAM_LOGO_VERSION = "20260828-1";

export function normalizeNflTeamAbbreviation(value) {
  const abbreviation = String(value ?? "").trim().toUpperCase();
  return NFL_TEAM_ALIASES[abbreviation] ?? abbreviation;
}

export function nflTeamLogoUrl(value) {
  const abbreviation = normalizeNflTeamAbbreviation(value);
  if (!NFL_TEAM_ABBREVIATIONS.includes(abbreviation)) return undefined;
  return `/images/nfl/teams/${abbreviation}.png?v=${NFL_TEAM_LOGO_VERSION}`;
}
