import test from "node:test";
import assert from "node:assert/strict";
import { ticketCtaLabel, ticketFeatureState } from "../src/lib/tickets/feature-state.mjs";

test("ticket modes centralize visibility, runtime, robots, canonical, and sitemap semantics", () => {
  assert.equal(ticketFeatureState("disabled", "enabled").enabled, false);
  assert.equal(ticketFeatureState("preview", "enabled").indexable, false);
  assert.equal(ticketFeatureState("beta", "enabled").runtime, true);
  assert.equal(ticketFeatureState("beta", "enabled").indexable, false);
  assert.equal(ticketFeatureState("live", "disabled").runtime, true);
  assert.equal(ticketFeatureState("live", "disabled").indexable, false);
  assert.equal(ticketFeatureState("live", "enabled").indexable, true);
  assert.equal(ticketFeatureState("invalid", "invalid").mode, "preview");
});

test("CTA claims follow validated provider capability", () => {
  assert.equal(ticketCtaLabel("event-summary"), "Check ticket availability");
  assert.equal(ticketCtaLabel("listing-comparison"), "Compare tickets");
});
