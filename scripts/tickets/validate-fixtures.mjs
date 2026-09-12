import { readFile } from "node:fs/promises";
import { validateTicketFixture } from "../../src/lib/tickets/validate.mjs";

const fixtureUrl = new URL("../../src/data/tickets/fixtures/development.snapshot.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
validateTicketFixture(fixture);
console.log(`Validated ticket fixture ${fixture.schemaVersion}: ${fixture.events.length} events, ${fixture.events.reduce((count, event) => count + event.listings.length, 0)} listings.`);
