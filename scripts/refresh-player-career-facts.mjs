#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchRosterPlayer } from "../src/lib/player-profile-generation.mjs";
import { atomicWriteJson, mergeCareerPlayer, normalizeCareerSeason } from "../src/lib/player-career-facts.mjs";
import { isDisposablePlayerProfilePath, playerCareerFactsArtifactPath } from "../src/lib/player-profiles.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=(file,fallback={})=>{try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;}};
const outputPath=playerCareerFactsArtifactPath();
console.log(`Player career-facts artifact: ${outputPath}`);
if(isDisposablePlayerProfilePath(outputPath,root))console.warn("WARNING: career facts are inside the disposable Git checkout. Set PLAYER_CAREER_FACTS_ARTIFACT to a writable persistent mount path.");
const fixture=read(path.join(root,"src/data/team/player-career-facts.json"),{schemaVersion:1,players:{}}), existing=read(outputPath,fixture);
const roster=read(path.join(root,"src/data/team/roster.json"),{players:[]}), nfl=read(path.join(root,"src/data/nfl/{team}.json"),{}), directory=read(path.join(root,"src/data/nfl/players.json"),{}).playerDirectory||nfl.playerDirectory||[];
const key=process.env.BALLDONTLIE_API_KEY; if(!key) throw new Error("Missing BALLDONTLIE_API_KEY; last-known-good career facts were not changed.");
const target=process.env.PLAYER_PROFILE_ID, from=Number(process.env.PLAYER_CAREER_FROM_SEASON||2018), through=Number(process.env.PLAYER_CAREER_THROUGH_SEASON||nfl.playerStatsSeason||new Date().getUTCFullYear());
const selected=(roster.players||[]).filter((p)=>!target||p.id===target).map((p)=>({roster:p,match:matchRosterPlayer(p,directory,nfl.playerSeasonStats||[])})).filter((x)=>x.match?.providerPlayerId);
if(target&&!selected.length) throw new Error(`No exact provider match for ${target}; last-known-good career facts were not changed.`);
const api=async(params)=>{const url=new URL("https://api.balldontlie.io/nfl/v1/season_stats");for(const [k,values] of Object.entries(params))for(const value of [].concat(values))url.searchParams.append(k,String(value));const res=await fetch(url,{headers:{Authorization:key}});if(!res.ok)throw new Error(`BALLDONTLIE career refresh failed with HTTP ${res.status}`);return res.json();};
const seasons=Array.from({length:through-from+1},(_,i)=>from+i), ids=selected.map((x)=>x.match.providerPlayerId), rows=[];
for(let i=0;i<seasons.length;i+=4){const batch=seasons.slice(i,i+4);for(const postseason of [false,true]){let cursor=null;do{const json=await api({"seasons[]":batch,"player_ids[]":ids,postseason,cursor:cursor?[cursor]:[]});rows.push(...(json.data||[]).map((row)=>({...row,_postseason:postseason})));cursor=json.meta?.next_cursor||null;}while(cursor);}}
const players={...(existing.players||{})}; let updatedSeasons=0; for(const item of selected){const playerRows=rows.filter((row)=>String(row.player_id??row.player?.id)===String(item.match.providerPlayerId));updatedSeasons+=playerRows.length;players[item.roster.id]=mergeCareerPlayer(players[item.roster.id],{canonicalRosterId:item.roster.id,providerPlayerId:item.match.providerPlayerId,seasons:playerRows.map((row)=>normalizeCareerSeason(row,row._postseason))},new Date());}
atomicWriteJson(outputPath,{schemaVersion:1,updatedAt:new Date().toISOString(),players});console.log(`Career facts refreshed: ${selected.length} player records, ${updatedSeasons} season records.`);console.log(`Artifact: ${path.relative(root,outputPath)}`);
