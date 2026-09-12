import fs from "node:fs";
import path from "node:path";

export const CAREER_STAT_FIELDS = ["games","games_played","games_started","starts","completions","passing_attempts","attempts","passing_yards","passing_touchdowns","interceptions","sacks","rushing_attempts","rushing_yards","rushing_touchdowns"];

const number = (row, ...keys) => { for (const key of keys) if (Number.isFinite(row?.[key])) return Number(row[key]); return null; };
const sum = (rows, ...keys) => rows.reduce((total,row)=>total+(number(row,...keys)||0),0);

export function normalizeCareerSeason(row, postseason = false) {
  const attempts=number(row,"passing_attempts","attempts"), completions=number(row,"completions"), yards=number(row,"passing_yards");
  return {season:Number(row.season),team:row.team?.full_name||row.team?.abbreviation||row.team_abbreviation||null,postseason,games:number(row,"games","games_played"),starts:number(row,"games_started","starts"),completions,attempts,completionPercentage:attempts?Number((completions*100/attempts).toFixed(1)):null,passingYards:yards,yardsPerAttempt:attempts?Number((yards/attempts).toFixed(1)):null,passingTouchdowns:number(row,"passing_touchdowns"),interceptions:number(row,"interceptions"),passerRating:number(row,"passer_rating","rating"),sacks:number(row,"sacks"),rushingAttempts:number(row,"rushing_attempts"),rushingYards:number(row,"rushing_yards"),rushingTouchdowns:number(row,"rushing_touchdowns")};
}

export function calculateCareerTotals(seasons) {
  const regular=seasons.filter((x)=>!x.postseason);
  return {games:sum(regular,"games"),starts:sum(regular,"starts"),completions:sum(regular,"completions"),attempts:sum(regular,"attempts"),passingYards:sum(regular,"passingYards"),passingTouchdowns:sum(regular,"passingTouchdowns"),interceptions:sum(regular,"interceptions"),rushingYards:sum(regular,"rushingYards"),rushingTouchdowns:sum(regular,"rushingTouchdowns")};
}

export function careerHighs(seasons) {
  const regular=seasons.filter((x)=>!x.postseason), keys=["passingYards","passingTouchdowns","completionPercentage","rushingYards"], out={};
  for(const key of keys){const rows=regular.filter((x)=>Number.isFinite(x[key]));if(rows.length){const best=rows.sort((a,b)=>b[key]-a[key])[0];out[key]={value:best[key],season:best.season};}}
  return out;
}

export function mergeCareerPlayer(oldPlayer, {canonicalRosterId,providerPlayerId,seasons}, now) {
  const byKey=new Map([...(oldPlayer?.seasons||[]),...seasons].map((row)=>[`${row.season}:${row.postseason}:${row.team||""}`,row]));
  const all=[...byKey.values()].sort((a,b)=>a.season-b.season||Number(a.postseason)-Number(b.postseason));
  return {...oldPlayer,canonicalRosterId,providerPlayerId:String(providerPlayerId),seasons:all,careerTotals:calculateCareerTotals(all),recentSeasons:all.filter((x)=>!x.postseason&&Object.values(x).some((v)=>typeof v==="number"&&v>0)).slice(-3).reverse(),postseasonSeasons:all.filter((x)=>x.postseason),careerHighs:careerHighs(all),updatedAt:now.toISOString()};
}

export function atomicWriteJson(file, value) { fs.mkdirSync(path.dirname(file),{recursive:true}); const temp=`${file}.tmp-${process.pid}-${Date.now()}`; fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`); fs.renameSync(temp,file); }
