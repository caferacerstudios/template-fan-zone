#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlayerRouteRegistry, latestMaterialDate, playerIndexability } from "../src/lib/indexability.mjs";
import { readPlayerProfiles } from "../src/lib/player-profiles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const idOf = (row) => String(row?.id ?? row?.player_id ?? row?.player?.id ?? "");
const nameOf = (row) => String(row?.name ?? row?.full_name ?? row?.player?.full_name ?? `${row?.first_name ?? row?.player?.first_name ?? ""} ${row?.last_name ?? row?.player?.last_name ?? ""}`).trim();
const bioOf = (profile) => typeof profile?.bio === "string" ? profile.bio : [profile?.biography?.overview, profile?.biography?.careerContext, profile?.biography?.{team}Context].filter(Boolean).join("\n\n");

export function validatePlayerProfiles({ production=false, checkDist=false, writeReport=true } = {}) {
  const rosterStore=read("src/data/team/roster.json"), nfl=read("src/data/nfl/{team}.json"), players=read("src/data/nfl/players.json"), career=read("src/data/team/player-career-facts.json");
  const { profiles, inputPath, artifactPath, usedFixture } = readPlayerProfiles({ allowFixture:!production });
  if (production && usedFixture) throw new Error("Production player-profile validation refused the repository fixture.");
  const stats=Array.isArray(nfl.playerSeasonStats)?nfl.playerSeasonStats:[], directory=Array.isArray(players.data)?players.data:Array.isArray(players.players)?players.players:[];
  const profileRecords=Object.entries(profiles).map(([id,profile])=>({id,name:profile?.name??profile?.full_name}));
  const all=[...(rosterStore.players||[]),...directory,...stats,...profileRecords], registry=buildPlayerRouteRegistry(all), results=[];
  for (const route of registry.routes.values()) {
    if (route.alias) continue;
    const profile=route.dataIds.map((id)=>profiles[id]).find(Boolean), record=all.find((row)=>route.dataIds.includes(idOf(row))&&nameOf(row));
    const current=(rosterStore.players||[]).find((row)=>route.dataIds.includes(String(row.id))), facts=route.dataIds.map((id)=>career?.players?.[id]).find(Boolean);
    const hasStats=stats.some((row)=>route.dataIds.includes(idOf(row))), identity=nameOf(record)||profile?.name||"";
    const materialUpdatedAt=latestMaterialDate([profile?.materialUpdatedAt,profile?.generation?.generatedAt,(facts?.sourceFacts||[]).map((fact)=>fact.reviewedAt)]);
    const title=`${identity} Seattle {Team} Profile`, canonicalPath=`/players/${encodeURIComponent(route.canonicalId)}`;
    const decision=playerIndexability({routeId:route.canonicalId,canonicalId:route.canonicalId,identity,profileIdentity:profile?.name,biography:bioOf(profile),rosterStatus:current?.status,historicallyLabeled:Boolean(hasStats||facts?.recentSeasons?.length),usefulSections:[profile?.careerHighlights?.length,profile?.seasonOverview,facts?.careerTimeline?.length,facts?.recentSeasons?.length,hasStats],generatorError:profile?.error??profile?.generation?.error,title,h1:title,canonicalPath,materialUpdatedAt,roleContext:Boolean(profile?.careerHighlights?.length||profile?.seasonOverview||facts?.careerTimeline?.length||hasStats),statisticsLabelValid:true,verifiedResolved:Boolean(record||profile)});
    results.push({playerId:route.canonicalId,name:identity,state:decision.state,indexable:decision.indexable,reasons:decision.reasons,materialUpdatedAt:materialUpdatedAt??null,declaredIndexable:profile?.qualityExpectation==="indexable"||profile?.indexable===true});
  }
  const canonicalCounts=new Map();
  for(const result of results.filter((row)=>row.indexable))canonicalCounts.set(result.playerId,(canonicalCounts.get(result.playerId)||0)+1);
  const duplicateCanonicalFailures=[...canonicalCounts].filter(([,count])=>count>1).map(([canonicalId,count])=>({canonicalId,count})), rejected=results.filter((row)=>row.declaredIndexable&&!row.indexable);
  const criticalFailures=results.filter((row)=>row.reasons.some((reason)=>/does not match|placeholder prose|generator-error|mislabeled|title or H1/.test(reason)));
  const report={generatedAt:new Date().toISOString(),profileArtifact:path.relative(root,inputPath),indexableProfiles:results.filter((row)=>row.indexable),noindexProfiles:results.filter((row)=>!row.indexable),aliases:registry.aliases.map((row)=>({...row,target:`/players/${row.target}`})),emptyOrRejectedProfiles:results.filter((row)=>row.reasons.some((reason)=>/biography|placeholder|generator|identity/.test(reason))),duplicateCanonicalFailures};
  if(writeReport){const reportPath=path.join(path.dirname(artifactPath),"profile-quality-report.json");fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,`${JSON.stringify(report,null,2)}\n`);console.log(`Player profile quality report: ${path.relative(root,reportPath)}`);}
  console.log(`Player profile quality: ${report.indexableProfiles.length} indexable; ${report.noindexProfiles.length} noindex; ${report.aliases.length} aliases; ${report.emptyOrRejectedProfiles.length} empty/rejected; ${duplicateCanonicalFailures.length} duplicate canonical failures.`);
  if(rejected.length||criticalFailures.length||duplicateCanonicalFailures.length)throw new Error(`Player profile quality gate failed: ${rejected.length} declared-indexable rejection(s), ${criticalFailures.length} critical content failure(s), ${duplicateCanonicalFailures.length} duplicate canonical(s).`);
  if(checkDist){const playersRoot=path.join(root,"dist/players");if(!fs.existsSync(playersRoot))throw new Error(`Player output directory is missing: ${playersRoot}`);}
  return report;
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){try{validatePlayerProfiles({production:process.argv.includes("--production"),checkDist:process.argv.includes("--dist")});}catch(error){console.error(error?.message||String(error));process.exitCode=1;}}
