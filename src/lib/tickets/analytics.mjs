const ALLOWED_PLACEMENTS = new Set(["result", "event-summary", "deep-link"]);
const ALLOWED_SORTS = new Set(["lowest_total", "lowest_per_ticket", "best_zone_within_budget", "official_first", "most_recent"]);

export function quantityBucket(quantity) {
  return quantity === 1 ? "1" : quantity === 2 ? "2" : quantity <= 4 ? "3-4" : "5-8";
}

export function ticketClickEvent(consent, input, now = new Date()) {
  if (consent?.ready !== true || consent?.analytics !== true) return null;
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) return null;
  const event = {
    event: "ticket_provider_click",
    selected_game: String(input.selectedGame ?? "").slice(0, 80),
    provider: String(input.provider ?? "").slice(0, 40),
    source_kind: String(input.sourceKind ?? "").slice(0, 40),
    link_placement: ALLOWED_PLACEMENTS.has(input.linkPlacement) ? input.linkPlacement : "result",
    click_timestamp: timestamp,
  };
  if (ALLOWED_SORTS.has(input.sortMode)) event.sort_mode = input.sortMode;
  if (Number.isSafeInteger(input.quantity) && input.quantity >= 1 && input.quantity <= 8) event.quantity_bucket = quantityBucket(input.quantity);
  return event;
}
