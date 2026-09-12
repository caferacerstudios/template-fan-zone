import type { APIRoute } from "astro";
import { absoluteUrl, PUBLIC_PAGES } from "../lib/seo";
import { categorySlug, populatedNewsCategories, publishedArticles } from "../lib/news";
import { TICKET_FEATURE } from "../lib/tickets/config";
import { EVENTSPY_COVERAGE } from "../lib/tickets/eventspy-coverage.mjs";
import { gameCollection, gameDayPageModel } from "../lib/game-details.mjs";
import { buildPlayerRouteRegistry, gameIndexability, hasMeaningfulGameGuide, hasMeaningfulViewingInformation, latestMaterialDate, playerIndexability, preferredPlayerId } from "../lib/indexability.mjs";
import { readPlayerProfiles } from "../lib/player-profiles.mjs";
import { getRoster, playerStatGroups, resolvePlayerProfile } from "../lib/player-profile-view.mjs";
import { getSeasonContext } from "../lib/season-context";
import { injuryStatuses, transactions } from "../lib/team-updates";
import watchGuide from "../data/nfl/watch-guide-2026.json";
import gameDayGuides from "../data/nfl/game-day-guides.json";
import { getWatchGuideEntry } from "../lib/watch-guide.mjs";
import { reconcileOfficialSchedule } from "../lib/schedule-guide.mjs";

const escapeXml = (value: unknown) => String(value).replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]!);
const validDate = (value: unknown) => value && Number.isFinite(new Date(String(value)).getTime()) ? new Date(String(value)).toISOString() : undefined;

export const GET: APIRoute = async () => {
  let nfl: any = null, recaps: any = null, profiles: any = null, players: any = null, standings: any = null, currentRoster: any = null, careerFacts: any = null;
  try { nfl = (await import("../data/nfl/{team}.json")).default; } catch {}
  try { recaps = (await import("../data/nfl/gameRecaps.json")).default; } catch {}
  try { profiles = readPlayerProfiles().data; } catch {}
  try { players = (await import("../data/nfl/players.json")).default; } catch {}
  try { standings = (await import("../data/nfl/standings.json")).default; } catch {}
  try { currentRoster = (await import("../data/team/roster.json")).default; } catch {}
  try { careerFacts = (await import("../data/team/player-career-facts.json")).default; } catch {}

  const roster = getRoster(players);
  const current = Array.isArray(currentRoster?.players) ? currentRoster.players : [];
  const stats = Array.isArray(nfl?.playerSeasonStats) ? nfl.playerSeasonStats : [];
  const allPlayers = [...current, ...roster, ...stats];
  const recapText = (recap: any) => String(recap?.summary ?? recap?.excerpt ?? recap?.text ?? (Array.isArray(recap?.segments) ? recap.segments.map((part: any) => part?.name ?? part?.v ?? "").join("") : "")).trim();
  const hasStandingsSource = Boolean((Array.isArray(standings?.data) && standings.data.length) || (Array.isArray(standings?.teams) && standings.teams.length));
  const rawGames = Array.isArray(nfl?.games) ? nfl.games : [...(nfl?.gamesPreseason ?? []),...(nfl?.gamesRegular ?? []),...(nfl?.gamesPostseason ?? [])];
  const completeSchedule = { ...nfl, games:reconcileOfficialSchedule(rawGames,watchGuide) };
  const phasedStandings = ["preseason", "regular", "postseason"].every(phase => standings?.phases?.[phase]?.phase === phase);
  const divisionTeams = new Set({DivisionTeams});
  const hasStandings = phasedStandings ? Object.values(standings.phases).some((bucket: any) => (bucket.rows ?? []).some((row: any) => divisionTeams.has(row.abbreviation) && row.gamesPlayed > 0)) : hasStandingsSource || completeSchedule.games.some((game: any) => /final|finished|complete/i.test(String(game?.status ?? game?.state)));
  const hasRecaps = Object.entries(recaps?.recaps ?? {}).some(([id, recap]: any) => { const game = completeSchedule.games.find((row: any) => String(row.id ?? row.game_id) === id) ?? recap?.game; return game && /final|finished|complete/i.test(String(game.status ?? game.state)) && Boolean(recapText(recap)); });
  const games = gameCollection(completeSchedule, EVENTSPY_COVERAGE).map((game: any) => gameDayPageModel(completeSchedule, String(game.id ?? game.game_id), EVENTSPY_COVERAGE, { recaps })).filter(Boolean);
  const eligibleGames = games.filter((model: any) => gameIndexability({
    game:model.game, id:model.id, opponentName:model.opponentName, canonicalPath:`/games/${encodeURIComponent(model.id)}`,
    hasRecap:Boolean(recapText(recaps?.recaps?.[model.id])),
    hasGuide:hasMeaningfulGameGuide(gameDayGuides?.games?.[model.id]),
    hasViewingInformation:hasMeaningfulViewingInformation(getWatchGuideEntry(model.game,watchGuide)),
  }).indexable);
  const includeStatic = (path: string) => path === "/tickets" ? TICKET_FEATURE.includeInSitemap : path === "/weekly-recap" ? hasRecaps : path === "/schedule" ? eligibleGames.length > 0 : path === "/players" ? allPlayers.length > 0 : path === "/team" ? Boolean(nfl?.teamSeasonStats) : path === "/standings" ? hasStandings : true;

  const profileRecords = Object.entries(profiles?.profiles ?? {}).map(([id, profile]: any) => ({ id, name:profile?.name ?? profile?.full_name }));
  const registry = buildPlayerRouteRegistry([...allPlayers, ...profileRecords]);
  const seasonContext = getSeasonContext(nfl, "regular season");
  const eligiblePlayers = [...registry.routes.values()].filter((route: any) => !route.alias).map((route: any) => {
    const routeId = route.canonicalId;
    const { dataPlayerIds, rosterPlayer, careerFacts: facts, recentCareerSeason, liveStatRow, statRow, rawProfile, profile, displayName, position } = resolvePlayerProfile({
      routeId, resolvedPlayerIds: route.dataIds, fallbackName: route.name,
      currentRoster, players, season: nfl, profiles, careerFactsStore: careerFacts,
    });
    const canonicalId = preferredPlayerId(routeId, displayName);
    const currentRecord = current.find((item: any) => String(item.id) === String(canonicalId) || String(item.id) === String(routeId));
    const statGroups = playerStatGroups(statRow, position);
    const injuryMatches = injuryStatuses.filter((row) => dataPlayerIds.includes(String(row.playerId)));
    const rosterMoves = transactions.filter((row) => dataPlayerIds.includes(String(row.playerId)));
    const materialUpdatedAt = latestMaterialDate([
      rawProfile?.materialUpdatedAt, rawProfile?.generation?.generatedAt,
      (facts?.sourceFacts ?? []).map((fact: any) => fact.reviewedAt),
      injuryMatches.map((row) => row.date), rosterMoves.map((row) => row.timestamp),
    ]);
    const statisticsSeason = Number(liveStatRow ? (nfl?.playerStatsSeason ?? seasonContext.sourceSeason ?? seasonContext.seasonYear) : (recentCareerSeason?.season ?? nfl?.playerStatsSeason ?? seasonContext.sourceSeason ?? seasonContext.seasonYear));
    const title = `${displayName} Seattle {Team} Profile`;
    const canonicalPath = `/players/${encodeURIComponent(canonicalId)}`;
    const decision = playerIndexability({
      routeId, canonicalId, identity: displayName, profileIdentity: profile?.name,
      biography: profile?.bio, rosterStatus: currentRecord?.status,
      historicallyLabeled: Boolean(statRow || facts?.recentSeasons?.length),
      usefulSections: [profile?.careerHighlights?.length, profile?.seasonOverview, facts?.careerTimeline?.length, statGroups.length, injuryMatches.length, rosterMoves.length],
      generatorError: rawProfile?.error ?? rawProfile?.generation?.error,
      title, h1: title, canonicalPath, materialUpdatedAt,
      roleContext: Boolean(profile?.careerHighlights?.length || profile?.seasonOverview || facts?.careerTimeline?.length || statGroups.length),
      statisticsLabelValid: Boolean(!statRow || Number.isFinite(statisticsSeason)), verifiedResolved: Boolean(rosterPlayer || statRow || rawProfile),
    });
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
