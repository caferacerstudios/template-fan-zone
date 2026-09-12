import { readFile, writeFile } from "node:fs/promises";
import { createMatchReviewReport } from "../../src/lib/tickets/match.mjs";

const fixture = JSON.parse(await readFile(new URL("../../src/data/tickets/fixtures/matching.json", import.meta.url), "utf8"));
const overrides = JSON.parse(await readFile(new URL("../../src/data/tickets/match-overrides.json", import.meta.url), "utf8"));
const report = createMatchReviewReport(fixture.games, fixture.providerEvents, { overrides });
const destination = new URL("../../docs/ticket-finder/match-review.md", import.meta.url);
await writeFile(destination, report.markdown, "utf8");
console.log(`Wrote ${report.matches.length} matches, ${report.rejected.length} rejections, and ${report.unresolvedGames.length} unresolved games.`);
