#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDisposablePlayerProfilePath, playerCareerFactsArtifactPath, playerProfilesArtifactPath, readPlayerProfiles } from "../src/lib/player-profiles.mjs";
import { runPlayerProfileGeneration } from "../src/lib/player-profile-generation.mjs";
import { validatePlayerProfiles } from "./validate-player-profiles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const readCareer = () => {
  const runtime = playerCareerFactsArtifactPath();
  return fs.existsSync(runtime) ? JSON.parse(fs.readFileSync(runtime, "utf8")) : read("src/data/team/player-career-facts.json");
};

async function main() {
  const nflData = read("src/data/nfl/{team}.json");
  const playersData = read("src/data/nfl/players.json");
  const artifactPath = playerProfilesArtifactPath();
  console.log(`Player-profile artifact: ${artifactPath}`);
  console.log(`Player career-facts artifact: ${playerCareerFactsArtifactPath()}`);
  if (isDisposablePlayerProfilePath(artifactPath, root)) console.warn("WARNING: player-profile artifacts are inside the disposable Git checkout and may be erased by git clean/reset. Set PLAYER_PROFILES_ARTIFACT and PLAYER_CAREER_FACTS_ARTIFACT to writable persistent mount paths.");
  const summary = await runPlayerProfileGeneration({
    rosterStore: read("src/data/team/roster.json"),
    nflData,
    playerDirectory: playersData.playerDirectory || nflData.playerDirectory || [],
    tierStore: read("src/data/team/player-profile-tiers.json"),
    careerStore: readCareer(),
    editorialStore: read("src/data/team/player-profile-editorial-facts.json"),
    existingArtifact: readPlayerProfiles({ allowFixture: true }).data,
    artifactPath,
    ledgerPath: path.join(path.dirname(artifactPath), "usage-ledger.json"),
    lockPath: path.join(path.dirname(artifactPath), "generation.lock"),
  });
  console.log("Player-profile generator summary (this ledger covers only this generator):");
  console.log(`Roster records considered: ${summary.considered}`);
  console.log(`Profiles already current: ${summary.current}`);
  console.log(`Profiles generated: ${summary.generated}`);
  console.log(`Profiles skipped because data was insufficient: ${summary.insufficient}`);
  console.log(`Profiles preserved after errors or limits: ${summary.preserved}`);
  console.log(`Requests made: ${summary.requests}`);
  console.log(`Input tokens: ${summary.inputTokens}; output tokens: ${summary.outputTokens}`);
  console.log(`Estimated run cost: $${summary.estimatedRunCostUsd.toFixed(4)}`);
  console.log(`Estimated profile-generator monthly cost: $${summary.monthlyCostUsd.toFixed(4)}`);
  console.log(`Remaining configured monthly budget: $${summary.remainingMonthlyBudgetUsd.toFixed(4)}`);
  validatePlayerProfiles({ production:false, writeReport:true });
}

main().catch((error) => { console.error(error?.message || String(error)); process.exitCode = 1; });
