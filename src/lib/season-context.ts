export type SeasonType = "preseason" | "regular season" | "postseason" | "final";
export type SeasonStatus = "upcoming" | "active" | "complete";
export type GameState = "upcoming" | "completed";

export interface SeasonContext {
  seasonYear: number | null;
  seasonType: SeasonType;
  seasonStatus: SeasonStatus;
  updatedAt: string | null;
  sourceSeason: number | null;
  label: string;
  hasData: boolean;
  hasGames: boolean;
  hasStatistics: boolean;
}

const PACIFIC_TIME_ZONE = "America/Los_Angeles";

function year(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1920 && parsed <= 2200 ? parsed : null;
}

function type(value: unknown, fallback: SeasonType): SeasonType {
  const normalized = String(value ?? "").toLowerCase().replaceAll("_", " ");
  if (normalized.includes("pre")) return "preseason";
  if (normalized.includes("post") || normalized.includes("playoff")) return "postseason";
  if (normalized.includes("final") || normalized.includes("complete")) return "final";
  if (normalized.includes("regular")) return "regular season";
  return fallback;
}

export function isFinalGame(game: any): boolean {
  const status = String(game?.status ?? "").toLowerCase();
  return status.includes("final") || status.includes("finished") || status.includes("complete");
}

/**
 * Game pages intentionally expose only durable states. Repository data is
 * refreshed at build time, so an in-progress status must not become a live
 * score claim.
 */
export function getGameState(game: any): GameState {
  return isFinalGame(game) ? "completed" : "upcoming";
}

function gamesFor(data: any, seasonType: SeasonType): any[] {
  if (seasonType === "postseason") return Array.isArray(data?.gamesPostseason) ? data.gamesPostseason : [];
  if (seasonType === "preseason") return Array.isArray(data?.gamesPreseason) ? data.gamesPreseason : [];
  if (seasonType === "final") {
    return [...gamesFor(data, "regular season"), ...gamesFor(data, "postseason")];
  }
  if (Array.isArray(data?.gamesRegular)) return data.gamesRegular;
  if (!Array.isArray(data?.games)) return [];
  return data.games.filter((game: any) => !game?.postseason && !String(game?.season_type ?? game?.seasonType ?? "").toLowerCase().includes("pre"));
}

function statsFor(data: any, seasonType: SeasonType): any[] {
  if (seasonType === "postseason") return Array.isArray(data?.playerPostseasonStats) ? data.playerPostseasonStats : [];
  if (seasonType === "preseason") return Array.isArray(data?.playerPreseasonStats) ? data.playerPreseasonStats : [];
  return Array.isArray(data?.playerSeasonStats) ? data.playerSeasonStats : [];
}

function sourceYear(data: any, rows: any[]): number | null {
  // Player statistics may intentionally lag an upcoming schedule by one year;
  // prefer their explicit season so pages never relabel those totals.
  const declared = year(data?.seasonContext?.sourceSeason ?? data?.playerStatsSeason ?? data?.sourceSeason ?? data?.season);
  if (declared !== null) return declared;
  const rowYears = new Set(rows.map((row) => year(row?.season)).filter((value): value is number => value !== null));
  if (rowYears.size === 1) return [...rowYears][0];
  if (rowYears.size > 1) return null;
  return null;
}

export function getSeasonContext(data: any, requestedType: SeasonType = "regular season"): SeasonContext {
  const explicit = data?.seasonContext ?? {};
  const seasonType = type(explicit.seasonType, requestedType);
  const seasonYear = year(explicit.seasonYear ?? data?.season);
  const rows = statsFor(data, seasonType);
  const games = gamesFor(data, seasonType);
  const sourceSeason = sourceYear(data, rows.length ? rows : games);
  const sourceMatches = seasonYear !== null && sourceSeason === seasonYear;
  const hasGames = sourceMatches && games.length > 0;
  const hasStatistics = sourceMatches && (rows.length > 0 || Boolean(data?.teamSeasonStats) || (Array.isArray(data?.data) && data.data.length > 0));
  const hasData = hasGames || hasStatistics;

  let seasonStatus: SeasonStatus = "upcoming";
  if (hasData && games.some(isFinalGame)) seasonStatus = games.every(isFinalGame) ? "complete" : "active";
  if (hasData && games.length === 0 && rows.length > 0) seasonStatus = "active";
  if (["upcoming", "active", "complete"].includes(explicit.seasonStatus)) {
    seasonStatus = explicit.seasonStatus;
  }

  const labelType = seasonType.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    seasonYear,
    seasonType,
    seasonStatus,
    updatedAt: explicit.updatedAt ?? data?.updatedAt ?? null,
    sourceSeason,
    label: `${seasonYear ?? "Unknown"} ${labelType}`,
    hasData,
    hasGames,
    hasStatistics,
  };
}

export function getAvailableSeasonContexts(data: any, fallbackType: SeasonType = "regular season"): SeasonContext[] {
  const configured = Array.isArray(data?.seasonContexts)
    ? data.seasonContexts.filter((entry: any) => type(entry?.seasonType, fallbackType) === fallbackType)
    : [];
  if (!configured.length) return [getSeasonContext(data, fallbackType)];
  return configured.map((entry: any) => getSeasonContext({ ...data, seasonContext: entry }, type(entry?.seasonType, fallbackType)));
}

export function formatPacificTime(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "—";
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)} PT`;
}

export function unavailableMessage(context: SeasonContext): string {
  if (context.seasonType === "regular season" && context.seasonStatus === "upcoming") {
    return "Regular season has not started. Statistics will appear after games are played.";
  }
  return `No ${context.seasonType} data is available for ${context.seasonYear ?? "the selected season"}.`;
}
