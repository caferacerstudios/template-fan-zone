/**
 * Provider-neutral boundary for an operator-approved listing feed.
 *
 * Adapters return provider-shaped event records. This boundary only asserts the
 * small documented envelope the pipeline needs; provider-specific field mapping
 * belongs in the authorized adapter and the existing pipeline remains the sole
 * owner of matching, URL checks, listing normalization, staleness, and ranking
 * eligibility.
 */
export function listingAdapterPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.events)) {
    throw Object.assign(new Error("Invalid listing adapter payload."), { code: "INVALID_RESPONSE" });
  }
  for (const event of payload.events) {
    if (!event || typeof event !== "object" || Array.isArray(event) || !Array.isArray(event.listings)) {
      throw Object.assign(new Error("Listing adapters must return an events[].listings array."), { code: "INVALID_RESPONSE" });
    }
  }
  return payload;
}

export function eventSummaryAdapterPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.events)) {
    throw Object.assign(new Error("Invalid event-summary adapter payload."), { code: "INVALID_RESPONSE" });
  }
  return payload;
}
