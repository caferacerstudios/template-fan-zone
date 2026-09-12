import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calculateCareerTotals, careerHighs, mergeCareerPlayer, normalizeCareerSeason } from "../src/lib/player-career-facts.mjs";

test("career seasons normalize provider rows and calculate totals in code",()=>{const rows=[normalizeCareerSeason({season:2024,team:{abbreviation:"MIN"},games:17,games_started:17,completions:10,passing_attempts:20,passing_yards:200,passing_touchdowns:2,interceptions:1}),normalizeCareerSeason({season:2025,team:{abbreviation:"SEA"},games:17,games_started:17,completions:20,passing_attempts:30,passing_yards:400,passing_touchdowns:3,interceptions:0})];assert.deepEqual(calculateCareerTotals(rows),{games:34,starts:34,completions:30,attempts:50,passingYards:600,passingTouchdowns:5,interceptions:1,rushingYards:0,rushingTouchdowns:0});assert.deepEqual(careerHighs(rows).passingYards,{value:400,season:2025});});
test("career artifact retains canonical slug while provider ID is metadata",()=>{const player=mergeCareerPlayer(null,{canonicalRosterId:"sam-darnold",providerPlayerId:42,seasons:[]},new Date("2026-01-01"));assert.equal(player.canonicalRosterId,"sam-darnold");assert.equal(player.providerPlayerId,"42");});
test("career refresh is a separate command and not part of prebuild",()=>{const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));assert.match(pkg.scripts["refresh-player-career-facts"],/refresh-player-career-facts/);assert.doesNotMatch(pkg.scripts.prebuild,/career/);});
test("refresh batches seasons and player IDs",()=>{const source=fs.readFileSync("scripts/refresh-player-career-facts.mjs","utf8");assert.match(source,/seasons\.slice\(i,i\+4\)/);assert.match(source,/"player_ids\[\]":ids/);});
