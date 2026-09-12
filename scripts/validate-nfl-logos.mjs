import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  NFL_TEAM_ABBREVIATIONS,
  nflTeamLogoUrl,
  normalizeNflTeamAbbreviation,
} from "../src/lib/team-logos.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const abbreviation of NFL_TEAM_ABBREVIATIONS) {
  const path = `${root}public/images/nfl/teams/${abbreviation}.png`;
  const metadata = await stat(path);
  assert(metadata.isFile(), `${abbreviation} logo is not a file`);
  assert(metadata.size > pngSignature.length, `${abbreviation} logo is empty`);

  const contents = await readFile(path);
  assert(contents.subarray(0, pngSignature.length).equals(pngSignature), `${abbreviation} logo is not a PNG`);

  const url = nflTeamLogoUrl(abbreviation);
  assert(url, `${abbreviation} did not generate a logo URL`);
  assert.equal(new URL(url, "https://example.test").pathname, `/images/nfl/teams/${abbreviation}.png`);
}

for (const [alias, canonical] of Object.entries({ JAC: "JAX", LA: "LAR", LVR: "LV", WSH: "WAS" })) {
  assert.equal(normalizeNflTeamAbbreviation(` ${alias.toLowerCase()} `), canonical);
  assert.equal(nflTeamLogoUrl(alias), nflTeamLogoUrl(canonical));
}

assert.equal(nflTeamLogoUrl("unknown"), undefined);
console.log(`Validated ${NFL_TEAM_ABBREVIATIONS.length} NFL team logos and 4 aliases.`);
