const GAME_COLLECTION_KEYS = ["games", "gamesPreseason", "gamesRegular", "gamesPostseason"];
const FIXTURE_ID = /^(?:fictional|fixture)|(?:^|[-_.])(?:fictional|fixture)(?:[-_.]|$)/i;
const FIXTURE_TEAM_NAME = /^Fictional\b/i;
export const KNOWN_LEAKED_FIXTURE_ID = "fictional-game-home-001";
export const KNOWN_LEAKED_FIXTURE_TEAM = "Fictional San Francisco Football Club";

const text = (value) => String(value ?? "").trim();

function scheduleRecords(schedule) {
  return [schedule, ...(Array.isArray(schedule?.seasons) ? schedule.seasons : [])]
    .filter((record, index, records) => record && typeof record === "object" && records.indexOf(record) === index);
}

function scheduleGames(record) {
  return GAME_COLLECTION_KEYS.flatMap((key) => Array.isArray(record?.[key]) ? record[key] : []);
}

function teamNames(game) {
  const teams = [game?.home_team, game?.visitor_team, game?.away_team, game?.homeTeam, game?.awayTeam, game?.opponent];
  return teams.flatMap((team) => typeof team === "string"
    ? [team]
    : [team?.full_name, team?.fullName, team?.name]).map(text).filter(Boolean);
}

export function validateProductionSchedule(schedule) {
  const errors = [];
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw new Error("Production schedule validation failed:\n- canonical schedule must be a JSON object");
  }

  const records = scheduleRecords(schedule);
  if (records.some((record) => record.fixture === true)) errors.push("schedule is marked fixture=true");
  const games = records.flatMap(scheduleGames);
  if (games.length === 0) errors.push("schedule contains no games");

  for (const game of games) {
    const id = text(game?.id ?? game?.game_id ?? game?.gameId);
    const label = id || "<missing-id>";
    if (!id) errors.push("game is missing an ID");
    const explicitType = text(game?.dataType ?? game?.data_type ?? game?.recordType).toLowerCase();
    if (game?.fixture === true || game?.isFixture === true || game?.test === true || game?.testData === true || game?.isTest === true || ["fixture", "test", "test-data"].includes(explicitType)) {
      errors.push(`game ${label} is explicitly marked as fixture/test data`);
    }
    if (id === KNOWN_LEAKED_FIXTURE_ID || FIXTURE_ID.test(id)) errors.push(`fixture-like production game ID: ${label}`);
    for (const name of teamNames(game)) {
      if (name === KNOWN_LEAKED_FIXTURE_TEAM || FIXTURE_TEAM_NAME.test(name)) errors.push(`fictional production team name in game ${label}: ${name}`);
    }
  }

  if (errors.length) throw new Error(`Production schedule validation failed:\n- ${[...new Set(errors)].join("\n- ")}`);
  return true;
}

export function validateProductionOutputFile(pathname, content) {
  const leaks = [KNOWN_LEAKED_FIXTURE_ID, KNOWN_LEAKED_FIXTURE_TEAM].filter((value) => content.includes(value));
  if (leaks.length) throw new Error(`Production output validation failed: ${pathname} contains ${leaks.join(", ")}`);
  return true;
}
