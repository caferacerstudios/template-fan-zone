import type { APIRoute } from "astro";
import { absoluteUrl, PUBLIC_PAGES } from "../lib/seo";
import { categorySlug, populatedNewsCategories, publishedArticles } from "../lib/news";
import { TICKET_FEATURE } from "../lib/tickets/config";
import { EVENTSPY_COVERAGE } from "../lib/tickets/eventspy-coverage.mjs";
import { gameCollection, gameDayPageModel } from "../lib/game-details.mjs";
import { buildPlayerRouteRegistry, gameIndexability, hasMeaningfulGameGuide, hasMeaningfulViewingInformation, latestMaterialDate, playerIndexability } from "../lib/indexability.mjs";
import { readPlayerProfiles } from "../lib/player-profiles.mjs";
import watchGuide from "../data/nfl/watch-guide-2026.json";
import gameDayGuides from "../data/nfl/game-day-guides.json";
import { getWatchGuideEntry } from "../lib/watch-guide.mjs";
import { reconcileOfficialSchedule } from "../lib/schedule-guide.mjs";

const escapeXml = (value: unknown) => String(value).replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]!);
const validDate = (value: unknown) => value && Number.isFinite(new Date(String(value)).getTime()) ? new Date(String(value)).toISOString() : undefined;
const playerId = (player: any) => player?.id ?? player?.player_id ?? player?.player?.id;
const playerName = (player: any) => player?.name ?? player?.full_name ?? player?.player?.full_name ?? `${player?.first_name ?? player?.player?.first_name ?? ""} ${player?.last_name ?? player?.player?.last_name ?? ""}`.trim();
const profileFor = (root: any, id: string) => root?.profiles?.[id] ?? root?.byId?.[id] ?? (Array.isArray(root?.data) ? root.data.find((item: any) => String(playerId(item)) === id) : root?.data?.[id]) ?? root?.[id] ?? null;
const profileBio = (profile: any) => typeof profile?.bio === "string" ? profile.bio : profile?.biography && typeof profile.biography === "object" ? [profile.biography.overview, profile.biography.careerContext, profile.biography.{team}Context].filter(Boolean).join("\n\n") : "";
const positionFor = (player: any) => String(player?.position_abbreviation ?? player?.position ?? player?.player?.position_abbreviation ?? player?.player?.position ?? "").toUpperCase();
const hasRenderableStats = (player: any, hasStats: boolean) => hasStats && !["OL", "C", "G", "T", "OT"].includes(positionFor(player));

export const GET: APIRoute = async () => {
  let nfl: any = null, recaps: any = null, profiles: any = null, players: any = null, standings: any = null, currentRoster: any = null, careerFacts: any = null;
  try { nfl = (await import("../data/nfl/{team}.json")).default; } catch {}
  try { recaps = (await import("../data/nfl/gameRecaps.json")).default; } catch {}
  try { profiles = readPlayerProfiles().data; } catch {}
  try { players = (await import("../data/nfl/players.json")).default; } catch {}
  try { standings = (await import("../data/nfl/standings.json")).default; } catch {}
  try { currentRoster = (await import("../data/team/roster.json")).default; } catch {}
  try { careerFacts = (await import("../data/team/player-career-facts.json")).default; } catch {}

  const roster = Array.isArray(players?.data) ? players.data : Array.isArray(players?.players) ? players.players : Array.isArray(players) ? players : [];
  const current = Array.isArray(currentRoster?.players) ? currentRoster.players : [];
  const stats = Array.isArray(nfl?.playerSeasonStats) ? nfl.playerSeasonStats : [];
  const allPlayers = [...current, ...roster, ...stats];
  const hasRecaps = Object.values(recaps?.recaps ?? {}).some((recap: any) => String(recap?.summary ?? recap?.excerpt ?? recap?.text ?? "").trim());
  const hasStandingsSource = Boolean((Array.isArray(standings?.data) && standings.data.length) || (Array.isArray(standings?.teams) && standings.teams.length));
  const rawGames = Array.isArray(nfl?.games) ? nfl.games : [...(nfl?.gamesPreseason ?? []),...(nfl?.gamesRegular ?? []),...(nfl?.gamesPostseason ?? [])];
  const completeSchedule = { ...nfl, games:reconcileOfficialSchedule(rawGames,watchGuide) };
  const hasStandings = hasStandingsSource || completeSchedule.games.some((game: any) => /final|finished|complete/i.test(String(game?.status ?? game?.state)));
  const games = gameCollection(completeSchedule, EVENTSPY_COVERAGE).map((game: any) => gameDayPageModel(completeSchedule, String(game.id ?? game.game_id), EVENTSPY_COVERAGE, { recaps })).filter(Boolean);
  const eligibleGames = games.filter((model: any) => gameIndexability({
    game:model.game, id:model.id, opponentName:model.opponentName, canonicalPath:`/games/${encodeURIComponent(model.id)}`,
    hasRecap:Boolean(recaps?.recaps?.[model.id]?.text ?? recaps?.recaps?.[model.id]?.summary),
    hasGuide:hasMeaningfulGameGuide(gameDayGuides?.games?.[model.id]),
    hasViewingInformation:hasMeaningfulViewingInformation(getWatchGuideEntry(model.game,watchGuide)),
  }).indexable);
  const includeStatic = (path: string) => path === "/tickets" ? TICKET_FEATURE.includeInSitemap : path === "/weekly-recap" ? hasRecaps : path === "/schedule" ? eligibleGames.length > 0 : path === "/players" ? allPlayers.length > 0 : path === "/team" ? Boolean(nfl?.teamSeasonStats) : path === "/standings" ? hasStandings : true;

  const profileRecords = Object.entries(profiles?.profiles ?? {}).map(([id, profile]: any) => ({ id, name:profile?.name ?? profile?.full_name }));
  const registry = buildPlayerRouteRegistry([...allPlayers, ...profileRecords]);
  const eligiblePlayers = [...registry.routes.values()].filter((route: any) => !route.alias).map((route: any) => {
    const routeId = route.canonicalId;
    const record = allPlayers.find((item) => route.dataIds.includes(String(playerId(item))));
    const profile = route.dataIds.map((id: string) => profileFor(profiles, id)).find(Boolean);
    const identity = playerName(record) || profile?.name || profile?.full_name || "";
    const canonicalId = routeId;
    const currentRecord = current.find((item: any) => route.dataIds.includes(String(item.id)));
    const facts = route.dataIds.map((id: string) => careerFacts?.players?.[id]).find(Boolean);
    const hasStats = stats.some((item: any) => route.dataIds.includes(String(playerId(item))));
    const rendersStats = hasRenderableStats(record, hasStats);
    const usefulSections = [profile?.careerHighlights?.length, profile?.seasonOverview, profile?.recap?.paragraph, facts?.careerTimeline?.length, facts?.recentSeasons?.length, rendersStats];
    const materialUpdatedAt = latestMaterialDate([profile?.materialUpdatedAt, profile?.generation?.generatedAt, (facts?.sourceFacts ?? []).map((fact: any)=>fact.reviewedAt)]);
    const title = `${identity} Seattle {Team} Profile`;
    const canonicalPath = `/players/${encodeURIComponent(canonicalId)}`;
    const decision = playerIndexability({ routeId, canonicalId, identity, profileIdentity:profile?.name, biography: profileBio(profile), rosterStatus: currentRecord?.status, historicallyLabeled: Boolean(facts?.recentSeasons?.length || hasStats), usefulSections, generatorError: profile?.error ?? profile?.generation?.error, title, h1:title, canonicalPath, materialUpdatedAt, roleContext:Boolean(profile?.careerHighlights?.length || profile?.seasonOverview || facts?.careerTimeline?.length || rendersStats), statisticsLabelValid:true, verifiedResolved:Boolean(record || profile) });
    const factDates = [...(facts?.sourceFacts ?? []).map((fact: any) => fact.reviewedAt), ...(facts?.recentSeasons ?? []).map((season: any) => season.updatedAt)];
    return { canonicalId, decision, lastmod: latestMaterialDate([materialUpdatedAt, factDates]) };
  }).filter((entry) => entry.decision.indexable);

  const pages = [
    ...PUBLIC_PAGES.filter((page) => includeStatic(page.canonicalPath)).map((page) => ({ loc: page.canonicalPath, lastmod: validDate(page.lastModified) })),
    ...publishedArticles.map((article) => ({ loc: `/news/${article.slug}`, lastmod: validDate(article.updatedAt) })),
    ...populatedNewsCategories.map((category) => ({ loc: `/news/category/${categorySlug(category)}`, lastmod: latestMaterialDate(publishedArticles.filter((article) => article.category === category).map((article) => article.updatedAt)) })),
    ...eligibleGames.map((model: any) => ({ loc: `/games/${encodeURIComponent(model.id)}`, lastmod: validDate(recaps?.recaps?.[model.id]?.updatedAt ?? model.game?.updatedAt) })),
    ...eligiblePlayers.map(({ canonicalId, lastmod }) => ({ loc: `/players/${encodeURIComponent(canonicalId)}`, lastmod })),
  ];
  const uniquePages = pages.filter((page, index) => pages.findIndex((other) => other.loc === page.loc) === index);
  const urls = uniquePages.map(({ loc, lastmod }) => `<url><loc>${escapeXml(absoluteUrl(loc))}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ""}</url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
