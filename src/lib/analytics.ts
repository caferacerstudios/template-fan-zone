type AnalyticsValue = string | number | boolean;
type AnalyticsParameters = Record<string, AnalyticsValue | null | undefined>;

export type AnalyticsEventName =
  | "next_game_click" | "game_center_click" | "article_open" | "related_story_click"
  | "player_open" | "schedule_filter" | "standings_open" | "newsletter_submit"
  | "poll_vote" | "external_source_click" | "share_action" | "search_submit"
  | "page_view" | "web_vital" | "ad_slot_requested" | "ad_slot_rendered";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    sfzAnalytics?: { track: (name: AnalyticsEventName, parameters?: AnalyticsParameters) => boolean; pageview: () => boolean };
    sfzConsent?: { analytics?: boolean };
  }
}

// Custom visitor analytics are disabled. Traffic statistics stay with Cloudflare.
// Keep the public API for existing UI callers without storage, listeners, or requests.
export function track(_name: AnalyticsEventName, _parameters: AnalyticsParameters = {}) { return false; }
export function pageview() { return false; }
if (typeof window !== "undefined") window.sfzAnalytics = { track, pageview };
