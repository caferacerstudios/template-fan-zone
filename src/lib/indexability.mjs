const NON_INDEXABLE_STATUS = /\b(cancel(?:led|ed)?|invalid|void|abandon(?:ed)?|postponed)\b/i;
const ERROR_OUTPUT = /\b(generator error|generation failed|unable to generate|error generating|acceptance sentinel|fixture recap|repository|build artifact|placeholder prose|we(?:'|’)re excited|our new addition|the 12s)\b/i;
const UNRESOLVED_TITLE = /\b(unknown|player profile)\b/i;

export const INDEX_ROBOTS = "index, follow";
export const NOINDEX_ROBOTS = "noindex, follow";
export const PLAYER_QUALITY_STATES = Object.freeze({
  INDEXABLE:"indexable", INCOMPLETE:"noindex_incomplete", UNRESOLVED:"noindex_unresolved",
  HISTORICAL:"retired_or_historical", ALIAS:"redirect_alias",
});

export const NAMED_PLAYER_CANONICALS = Object.freeze(new Map([
  ["jaxon smith njigba", "jaxon-smith-njigba"],
  ["derick hall", "derick-hall"],
  ["devon witherspoon", "devon-witherspoon"],
  ["leonard williams", "leonard-williams"],
]));

const text = (value) => typeof value === "string" ? value.trim() : "";
const normalizedName = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const teamAbbr = (team) => text(team?.abbreviation ?? team?.abbr).toUpperCase();

export function preferredPlayerId(routeId, playerName) {
  const id = String(routeId);
  return NAMED_PLAYER_CANONICALS.get(normalizedName(playerName)) ?? (/^\d+$/.test(id) ? slugPlayerName(playerName) : id) ?? id;
}

export function slugPlayerName(value) {
  return normalizedName(value).replace(/\s+/g, "-") || null;
}

export function buildPlayerRouteRegistry(records = []) {
  const identities = new Map();
  for (const record of records) {
    const id = text(String(record?.id ?? record?.player_id ?? record?.player?.id ?? ""));
    const name = text(record?.name ?? record?.full_name ?? record?.player?.full_name ?? `${record?.first_name ?? record?.player?.first_name ?? ""} ${record?.last_name ?? record?.player?.last_name ?? ""}`);
    const key = normalizedName(name);
    if (!id || !key) continue;
    const entry = identities.get(key) ?? { name, ids:new Set(), legacyIds:new Set() };
    entry.ids.add(id);
    for (const legacyId of record?.legacyIds || []) if (text(String(legacyId))) entry.legacyIds.add(String(legacyId));
    identities.set(key, entry);
  }
  const routes = new Map(), aliases = [];
  for (const entry of identities.values()) {
    const ids = [...entry.ids], preferredSourceId = ids.find((id)=>!/^\d+$/.test(id)) ?? ids[0];
    const canonicalId = preferredPlayerId(preferredSourceId, entry.name);
    routes.set(canonicalId, { canonicalId, dataIds:[...entry.ids], name:entry.name, alias:false });
    for (const id of new Set([...entry.ids, ...entry.legacyIds])) if (id !== canonicalId) {
      routes.set(id, { canonicalId, dataIds:[...entry.ids], name:entry.name, alias:true });
      aliases.push({ alias:id, target:canonicalId, name:entry.name });
    }
  }
  return { routes, aliases };
}

export function gameIndexability({ game, id, opponentName, canonicalPath, hasRecap = false, hasGuide = false, hasViewingInformation = false } = {}) {
  const gameId = text(String(id ?? game?.id ?? game?.game_id ?? ""));
  const status = text(game?.status ?? game?.state);
  const home = teamAbbr(game?.home_team);
  const away = teamAbbr(game?.visitor_team);
  const opponent = text(opponentName);
  const date = text(game?.startsAt ?? game?.date);
  const reasons = [];
  if (!gameId || game?.bye === true || game?.state === "bye") reasons.push("invalid game identity");
  if (home !== "SEA" && away !== "SEA") reasons.push("not a {Team} game");
  if (!opponent || opponent.toUpperCase() === "SEA") reasons.push("unresolved opponent");
  if (!date || !Number.isFinite(Date.parse(date))) reasons.push("unresolved game date");
  if (NON_INDEXABLE_STATUS.test(status)) reasons.push("non-indexable game status");
  if (canonicalPath !== `/games/${encodeURIComponent(gameId)}`) reasons.push("non-canonical route");
  const completed = /final|finished|complete/i.test(status) || game?.state === "completed";
  if (completed && !hasRecap) reasons.push("completed game lacks an authored recap");
  if (!completed && (!hasGuide || !hasViewingInformation)) reasons.push("future game lacks a completed guide or viewing information");
  return { indexable: reasons.length === 0, reasons };
}

export function hasMeaningfulGameGuide(guide) {
  const summary = text(guide?.summary);
  const sections = ["alerts","transportation","parking","timeline","tailgates","watchParties","stadiumTips"]
    .flatMap((key) => Array.isArray(guide?.[key]) ? guide[key] : []);
  const sectionText = sections.map((section) => [section?.text,section?.details,section?.recommendation].map(text).join(" ")).join(" ");
  return summary.length >= 80 && sectionText.length >= 160;
}

export function hasMeaningfulViewingInformation(entry) {
  if (!entry || entry?.status === "tbd") return false;
  if (entry?.status === "completed") return Boolean(text(entry.originalBroadcast) || entry?.replay?.length);
  return !/tbd/i.test(text(entry.kickoffLabel)) && Boolean(entry?.localTv?.length || entry?.streams?.length || (text(entry?.national) && !/tbd/i.test(entry.national)));
}

export function playerIndexability({ routeId, canonicalId, identity, profileIdentity, biography, rosterStatus, historicallyLabeled = false, usefulSections = [], generatorError = null, title, h1, canonicalPath, materialUpdatedAt, roleContext = false, statisticsLabelValid = true, verifiedResolved = true } = {}) {
  const bio = text(biography);
  const reasons = [];
  const name = text(identity);
  if (String(routeId) !== String(canonicalId)) return { state:PLAYER_QUALITY_STATES.ALIAS, indexable:false, reasons:["alternate player alias"], redirectTarget:`/players/${encodeURIComponent(String(canonicalId))}` };
  if (!verifiedResolved || !name || /^(unknown|player)$/i.test(name)) reasons.push("unresolved player identity");
  if (text(profileIdentity) && normalizedName(profileIdentity) !== normalizedName(name)) reasons.push("displayed name does not match profile identity");
  if (!bio || bio.length < 80) reasons.push("missing meaningful biography or career context");
  if (ERROR_OUTPUT.test(bio)) reasons.push("generator or placeholder prose is visible");
  if (!roleContext) reasons.push("missing player-specific career or role context");
  if (!text(rosterStatus) && !historicallyLabeled) reasons.push("missing current or historical roster status");
  if (!usefulSections.some(Boolean)) reasons.push("missing player-specific data section");
  if (generatorError || ERROR_OUTPUT.test(bio)) reasons.push("generator-error output");
  if (!name || !text(title) || !text(h1) || !title.includes(name) || !h1.includes(name) || !/{team}/i.test(title) || !/{team}/i.test(h1) || UNRESOLVED_TITLE.test(title.replace(name,""))) reasons.push("title or H1 is unresolved or lacks player and {Team} context");
  if (canonicalPath !== `/players/${encodeURIComponent(String(canonicalId))}`) reasons.push("invalid canonical");
  if (!statisticsLabelValid) reasons.push("current and historical statistics are mislabeled");
  if (!text(materialUpdatedAt) || !Number.isFinite(Date.parse(materialUpdatedAt))) reasons.push("missing per-player materialUpdatedAt");
  const unresolved = reasons.some((reason) => /identity|canonical|unresolved/.test(reason));
  const indexable = reasons.length === 0;
  return { state:indexable ? (historicallyLabeled && !text(rosterStatus) ? PLAYER_QUALITY_STATES.HISTORICAL : PLAYER_QUALITY_STATES.INDEXABLE) : (unresolved ? PLAYER_QUALITY_STATES.UNRESOLVED : PLAYER_QUALITY_STATES.INCOMPLETE), indexable, reasons };
}

export function pageRobots(decision) {
  return decision?.indexable ? INDEX_ROBOTS : NOINDEX_ROBOTS;
}

export function latestMaterialDate(values) {
  const dates = values.flat().filter(Boolean).map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString() : undefined;
}
