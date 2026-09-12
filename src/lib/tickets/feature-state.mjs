export const TICKET_DATA_MODES = Object.freeze(["disabled", "preview", "beta", "live"]);
export const TICKET_INDEXING_STATES = Object.freeze(["disabled", "enabled"]);

export function ticketFeatureState(modeValue, indexingValue) {
  const mode = TICKET_DATA_MODES.includes(modeValue) ? modeValue : "preview";
  const indexingState = TICKET_INDEXING_STATES.includes(indexingValue) ? indexingValue : "disabled";
  const runtime = mode === "beta" || mode === "live";
  const indexable = mode === "live" && indexingState === "enabled";
  return Object.freeze({ mode, indexingState, enabled: mode !== "disabled", runtime, indexable, robots: indexable ? "index, follow" : "noindex, follow", includeInSitemap: indexable, canonical: indexable });
}

export function ticketCtaLabel(capability = "event-summary") {
  return capability === "listing-comparison" ? "Compare tickets" : "Check ticket availability";
}
