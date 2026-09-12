// Player pages and the sitemap must judge the data that can actually render.
import { verifiedRosterStatRows } from "./roster-provider.mjs";

export function getRoster(playersData) {
  if (Array.isArray(playersData?.playerSeasonStats)) return playersData.playerSeasonStats;
  if (Array.isArray(playersData?.data)) return playersData.data;
  if (Array.isArray(playersData?.players)) return playersData.players;
  if (Array.isArray(playersData)) return playersData;
  // if dict/map keyed by id
  if (playersData && typeof playersData === "object") return Object.values(playersData);
  return [];
}

export function pid(p) {
  return p?.id ?? p?.player_id ?? p?.player?.id ?? null;
}

export function playerNameFromAny(obj) {
  const p = obj?.player ?? obj;
  if (!p) return "Unknown";
  const full =
    p?.full_name || p?.name ||
    `${p?.first_name || ""} ${p?.last_name || ""}`.trim();
  return full || "Unknown";
}

function getProfileFor(root, id) {
  const key = String(id);

  // map-style wrappers
  const map1 = root?.profiles && typeof root.profiles === "object" ? root.profiles : null;
  const map2 = root?.byId && typeof root.byId === "object" ? root.byId : null;
  if (map1 && map1[key]) return map1[key];
  if (map2 && map2[key]) return map2[key];

  // data object keyed by id
  if (root?.data && typeof root.data === "object" && !Array.isArray(root.data) && root.data[key]) {
    return root.data[key];
  }

  // data array
  if (Array.isArray(root?.data)) {
    const hit = root.data.find((x) => String(x?.player_id ?? x?.id ?? x?.player?.id ?? "") === key);
    if (hit) return hit;
  }

  // bare map at root
  if (root && typeof root === "object" && root[key]) return root[key];

  return null;
}

function normalizeProfile(p) {
  if (!p || typeof p !== "object") return { bio:null, seasonOverview:null, careerHighlights:[], name:null };

  // Current reader-first schema.
  if (typeof p.bio === "string" && Array.isArray(p.careerHighlights)) return {
    name:p?.name ?? p?.full_name ?? null,
    bio:p.bio,
    careerHighlights:p.careerHighlights.map((x)=>typeof x === "string"?x:x?.text).filter(Boolean),
    seasonOverview:typeof p.seasonOverview === "string" ? p.seasonOverview : null,
  };

  // Previous v3 schema retained for existing last-known-good artifacts.
  if (p?.biography && typeof p.biography === "object") return {
    name:p?.name ?? p?.full_name ?? null,
    bio:[p.biography.overview,p.biography.careerContext,p.biography.{team}Context].filter((x)=>typeof x === "string"&&x.trim()).join("\n\n"),
    careerHighlights:Array.isArray(p.careerHighlights)?p.careerHighlights.map((x)=>typeof x === "string"?x:x?.text).filter(Boolean):[],
    seasonOverview:p.seasonOverview&&typeof p.seasonOverview === "object"?p.seasonOverview.paragraph:null,
  };

  // already normalized
  if (typeof p?.bio === "string" && p?.recap && typeof p.recap === "object") {
    return {
      name: p?.name ?? p?.full_name ?? null,
      bio:p.bio,
      careerHighlights:[],
      seasonOverview:typeof p.recap?.paragraph === "string" ? p.recap.paragraph : null,
    };
  }

  // flattened recap fields
  const paragraph =
    p?.recap_paragraph ??
    p?.paragraph ??
    p?.gameplay_paragraph ??
    null;

  return {
    name: p?.name ?? p?.full_name ?? null,
    bio:typeof p?.bio === "string" ? p.bio : null,
    careerHighlights:[],
    seasonOverview:paragraph ? String(paragraph) : null,
  };
}

export function resolvePlayerProfile({ routeId, resolvedPlayerIds = [], fallbackName = null, currentRoster = {}, players = {}, season = {}, profiles = {}, careerFactsStore = {} }) {
  const dataPlayerIds = [...new Set([String(routeId), ...resolvedPlayerIds.map(String)])];
  function findRosterPlayer(id) {
    const current = (currentRoster?.players || []).find((p) => String(p?.id) === String(id));
    if (current) return current;
    const roster = getRoster(players);
    const key = String(id);
    return roster.find((p) => String(pid(p)) === key) || null;
  }

  function bestStatRowForPlayer(id) {
    const allRows = Array.isArray(season?.playerSeasonStats) ? season.playerSeasonStats : [];
    const verifiedRows = verifiedRosterStatRows(currentRoster, dataPlayerIds, allRows);
    const rows = verifiedRows ?? allRows;
    const key = String(id);

    function n(v) {
      return typeof v === "number" ? v : 0;
    }
    function totalYards(r) {
      return n(r.passing_yards) + n(r.rushing_yards) + n(r.receiving_yards);
    }

    let best = null;
    const currentName = (currentRoster?.players || []).find((player) => String(player?.id) === key)?.name?.toLowerCase();
    for (const r of rows) {
      const rid = r?.player?.id ?? r?.player_id ?? null;
      if (rid === null || rid === undefined) continue;
      if (verifiedRows === null && String(rid) !== key && (!currentName || playerNameFromAny(r).toLowerCase() !== currentName)) continue;
      if (!best || totalYards(r) > totalYards(best)) best = r;
    }
    return best;
  }

  const rosterPlayer = dataPlayerIds.map(findRosterPlayer).find(Boolean) || null;
  const careerFacts=dataPlayerIds.map((id)=>careerFactsStore?.players?.[id]).find(Boolean)||null;
  const recentCareerSeason=careerFacts?.recentSeasons?.[0]||null;
  const liveStatRow = dataPlayerIds.map(bestStatRowForPlayer).find(Boolean) || null;
  const statRow = liveStatRow || (recentCareerSeason ? {
    games_played:recentCareerSeason.games,games_started:recentCareerSeason.starts,completions:recentCareerSeason.completions,passing_attempts:recentCareerSeason.attempts,completion_percentage:recentCareerSeason.completionPercentage,passing_yards:recentCareerSeason.passingYards,yards_per_attempt:recentCareerSeason.yardsPerAttempt,passing_touchdowns:recentCareerSeason.passingTouchdowns,interceptions:recentCareerSeason.interceptions,passer_rating:recentCareerSeason.passerRating,sacks:recentCareerSeason.sacks,rushing_attempts:recentCareerSeason.rushingAttempts,rushing_yards:recentCareerSeason.rushingYards,rushing_touchdowns:recentCareerSeason.rushingTouchdowns
  } : null);

  const rawProfile = dataPlayerIds.map((id) => getProfileFor(profiles, id)).find(Boolean) || null;
  const profile = normalizeProfile(rawProfile);

  // display fields (safe across shapes)
  const displayName =
    playerNameFromAny(rosterPlayer) !== "Unknown"
      ? playerNameFromAny(rosterPlayer)
      : (playerNameFromAny(statRow?.player) !== "Unknown"
          ? playerNameFromAny(statRow?.player)
          : (profile?.name || fallbackName || "Player"));

  const position =
    (rosterPlayer?.position_abbreviation ||
      rosterPlayer?.position ||
      rosterPlayer?.player?.position_abbreviation ||
      rosterPlayer?.player?.position ||
      statRow?.player?.position_abbreviation ||
      "—");

  return { dataPlayerIds, rosterPlayer, careerFacts, recentCareerSeason, liveStatRow, statRow, rawProfile, profile, displayName, position };
}

const allStatDefinitions = [
  ["Passing", [["Games",["games_played"]],["Starts",["games_started","starts"]],["Completions",["completions"]],["Attempts",["passing_attempts","attempts"]],["Completion %",["completion_percentage"]],["Passing yards",["passing_yards"]],["Yards / attempt",["yards_per_attempt"]],["Passing TD",["passing_touchdowns"]],["Interceptions",["interceptions"]],["Passer rating",["passer_rating"]],["Sacks",["sacks"]]]],
  ["Rushing", [["Carries",["rushing_attempts","carries"]],["Rushing yards",["rushing_yards"]],["Rushing TD",["rushing_touchdowns"]]]],
  ["Receiving", [["Receptions",["receptions"]],["Receiving yards",["receiving_yards"]],["Receiving TD",["receiving_touchdowns"]]]],
  ["Defense", [["Total tackles",["total_tackles","tackles"]],["Sacks",["sacks"]],["Defensive INT",["defensive_interceptions","interceptions"]],["Passes defended",["passes_defended","passes_defensed"]],["Forced fumbles",["forced_fumbles"]]]],
  ["Kicking", [["Field goals made",["field_goals_made"]],["Field goals attempted",["field_goals_attempted"]],["Extra points made",["extra_points_made"]],["Punts",["punts"]],["Punt average",["punt_average","punting_average"]]]],
];
const positionGroups = {QB:["Passing","Rushing"],RB:["Rushing","Receiving"],FB:["Rushing","Receiving"],WR:["Receiving","Rushing"],TE:["Receiving"],K:["Kicking"],P:["Kicking"],OL:[],C:[],G:[],T:[],OT:[]};
function firstNumber(row, keys) {
  for (const key of keys) if (typeof row?.[key] === "number" && Number.isFinite(row[key])) return row[key];
  return null;
}
export function playerStatGroups(statRow, position) {
  const allowedStatGroups=positionGroups[String(position).toUpperCase()]||["Defense"];
  const statDefinitions=allStatDefinitions.filter(([label])=>allowedStatGroups.includes(label));
  return statDefinitions.map(([label, definitions]) => ({ label, items:definitions.map(([itemLabel,keys]) => ({ label:itemLabel, value:firstNumber(statRow,keys) })).filter((item) => item.value !== null && item.value !== 0) })).filter((group) => group.items.length);
}
