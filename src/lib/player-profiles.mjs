import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const fixturePath = path.join(projectRoot, "src", "data", "nfl", "playerProfiles.json");

export function playerProfilesArtifactPath(env = process.env) {
  return path.resolve(projectRoot, env.PLAYER_PROFILES_ARTIFACT || "runtime/player-profiles/playerProfiles.json");
}

export function playerCareerFactsArtifactPath(env = process.env) {
  if (env.PLAYER_CAREER_FACTS_ARTIFACT) return path.resolve(projectRoot, env.PLAYER_CAREER_FACTS_ARTIFACT);
  return path.join(path.dirname(playerProfilesArtifactPath(env)), "player-career-facts.json");
}

export function isDisposablePlayerProfilePath(artifactPath, root = projectRoot) {
  const relative = path.relative(path.resolve(root), path.resolve(artifactPath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function readPlayerProfiles({ env = process.env, allowFixture = true } = {}) {
  const artifactPath = playerProfilesArtifactPath(env);
  const inputPath = fs.existsSync(artifactPath) ? artifactPath : allowFixture ? fixturePath : artifactPath;
  if (!fs.existsSync(inputPath)) throw new Error(`Player profile artifact is missing: ${artifactPath}`);
  const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const profiles = data?.profiles && typeof data.profiles === "object" ? data.profiles : {};
  return { data, profiles, inputPath, artifactPath, usedFixture: inputPath === fixturePath };
}

export function writePlayerProfilesArtifact(data, env = process.env) {
  const artifactPath = playerProfilesArtifactPath(env);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const temporaryPath = `${artifactPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporaryPath, artifactPath);
  return artifactPath;
}
