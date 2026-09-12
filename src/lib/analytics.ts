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

const EVENT_NAMES = new Set<AnalyticsEventName>([
  "next_game_click", "game_center_click", "article_open", "related_story_click",
  "player_open", "schedule_filter", "standings_open", "newsletter_submit",
  "poll_vote", "external_source_click", "share_action", "search_submit", "page_view",
  "web_vital", "ad_slot_requested", "ad_slot_rendered",
]);
const SAFE_PARAMETERS = new Set([
  "page_type", "season", "opponent", "article_category", "device_class", "link_domain",
  "share_method", "filter_type", "filter_value", "poll_id", "poll_choice", "slot_location",
  "metric_name", "metric_value", "metric_rating", "metric_id", "navigation_type", "result_count",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "page_path",
]);
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
const endpoint = import.meta.env.PUBLIC_ANALYTICS_ENDPOINT || "";
const excludedHosts = String(import.meta.env.PUBLIC_ANALYTICS_EXCLUDE_HOSTS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
let lastPageview = "";
let consentOverride: boolean | undefined;

function developmentTraffic() {
  const host = location.hostname.toLowerCase();
  return import.meta.env.DEV || host === "localhost" || host === "127.0.0.1" || host === "::1" || excludedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function hasConsent() {
  if (consentOverride !== undefined) return consentOverride;
  if (window.sfzConsent?.analytics === true) return true;
  try {
    const stored = localStorage.getItem("sfz-consent") ?? localStorage.getItem("sfz_consent");
    if (!stored) return false;
    const parsed = JSON.parse(stored);
    return parsed === true || parsed?.analytics === true;
  } catch { return false; }
}

function deviceClass() {
  if (matchMedia("(max-width: 767px)").matches) return "mobile";
  if (matchMedia("(max-width: 1023px)").matches) return "tablet";
  return "desktop";
}

function clean(value: unknown): AnalyticsValue | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const result = value.trim().slice(0, 100);
  // Reject common accidental identifiers; dimensions should be categorical IDs only.
  if (/@|\b(?:\d[ -]*?){12,19}\b/.test(result)) return undefined;
  return result || undefined;
}

function pageType(pathname = location.pathname) {
  if (pathname === "/") return "home";
  if (/^\/games\//.test(pathname)) return "game_center";
  if (/^\/players\//.test(pathname)) return "player";
  if (/^\/guides\//.test(pathname) || pathname === "/weekly-recap") return "article";
  return pathname.split("/").filter(Boolean)[0]?.replace(/[^a-z0-9_]/gi, "_") || "unknown";
}

function attribution() {
  try {
    const incoming: Record<string, string> = {};
    const query = new URLSearchParams(location.search);
    UTM_KEYS.forEach((key) => { const value = clean(query.get(key)); if (typeof value === "string") incoming[key] = value; });
    if (Object.keys(incoming).length) sessionStorage.setItem("sfz-attribution", JSON.stringify(incoming));
    return JSON.parse(sessionStorage.getItem("sfz-attribution") || "{}");
  } catch { return {}; }
}

function context(parameters: AnalyticsParameters = {}) {
  const body = document.body.dataset;
  const merged: AnalyticsParameters = {
    page_type: body.pageType || pageType(), season: body.season, opponent: body.opponent,
    article_category: body.articleCategory, device_class: deviceClass(), ...attribution(), ...parameters,
  };
  return Object.fromEntries(Object.entries(merged).filter(([key]) => SAFE_PARAMETERS.has(key)).map(([key, value]) => [key, clean(value)]).filter(([, value]) => value !== undefined));
}

export function track(name: AnalyticsEventName, parameters: AnalyticsParameters = {}) {
  if (!EVENT_NAMES.has(name) || developmentTraffic() || !hasConsent()) return false;
  const detail = { event: name, ...context(parameters) };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(detail);
  window.dispatchEvent(new CustomEvent("sfz:analytics", { detail }));
  if (endpoint) {
    const body = JSON.stringify(detail);
    if (navigator.sendBeacon) navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
    else void fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "omit" });
  }
  return true;
}

export function pageview() {
  // Query strings can contain user-entered data. Campaign fields are handled separately.
  const path = `${location.pathname}${location.hash}`;
  if (path === lastPageview) return false;
  if (!track("page_view", { page_path: path })) return false;
  lastPageview = path;
  return true;
}

function rateMetric(name: string, value: number) {
  const good = name === "LCP" ? value <= 2500 : name === "INP" ? value <= 200 : value <= 0.1;
  const poor = name === "LCP" ? value > 4000 : name === "INP" ? value > 500 : value > 0.25;
  return good ? "good" : poor ? "poor" : "needs_improvement";
}

function observeWebVitals() {
  if (!("PerformanceObserver" in window)) return;
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const report = (name: "LCP" | "INP" | "CLS", value: number, id: string) => track("web_vital", { metric_name: name, metric_value: Math.round(value * (name === "CLS" ? 1000 : 1)) / (name === "CLS" ? 1000 : 1), metric_rating: rateMetric(name, value), metric_id: id, navigation_type: navigation?.type || "navigate" });
  let lcp: PerformanceEntry | undefined; let cls = 0; let inp = 0; let inpId = "";
  try { new PerformanceObserver((list) => { lcp = list.getEntries().at(-1); }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
  try { new PerformanceObserver((list) => list.getEntries().forEach((entry: any) => { if (!entry.hadRecentInput) cls += entry.value; })).observe({ type: "layout-shift", buffered: true }); } catch {}
  try { new PerformanceObserver((list) => list.getEntries().forEach((entry: any) => { if (entry.duration > inp) { inp = entry.duration; inpId = String(entry.interactionId || "interaction"); } })).observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit); } catch {}
  const flush = () => { if (document.visibilityState !== "hidden") return; if (lcp) report("LCP", lcp.startTime, String((lcp as any).id || "lcp")); report("CLS", cls, "cls"); if (inp) report("INP", inp, inpId); };
  document.addEventListener("visibilitychange", flush, { once: true });
}

function bindDeclarativeEvents() {
  document.addEventListener("click", (event) => {
    const clicked = (event.target as Element | null);
    const target = clicked?.closest<HTMLElement>("[data-analytics-event]");
    const anchor = clicked?.closest<HTMLAnchorElement>("a[href]");
    let name = target?.dataset.analyticsEvent as AnalyticsEventName | undefined;
    if (!name && anchor) {
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin && /^https?:$/.test(url.protocol)) name = "external_source_click";
      else if (/^\/games\//.test(url.pathname)) name = "game_center_click";
      else if (/^\/players\/[^/]+/.test(url.pathname)) name = "player_open";
      else if (url.pathname === "/standings") name = "standings_open";
    }
    if (!name) return;
    const parameters: AnalyticsParameters = {};
    for (const [key, value] of Object.entries(target?.dataset ?? {})) if (key !== "analyticsEvent" && key.startsWith("analytics")) parameters[key.slice(9).replace(/[A-Z]/g, (x) => `_${x.toLowerCase()}`).replace(/^_/, "")] = value;
    if (name === "external_source_click" && anchor) parameters.link_domain = new URL(anchor.href, location.href).hostname;
    track(name, parameters);
  });
  document.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    const name = form?.dataset.analyticsEvent as AnalyticsEventName;
    if (name) track(name, { result_count: form.dataset.analyticsResultCount });
  });
  document.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const name = input?.dataset.analyticsEvent as AnalyticsEventName;
    if (name) track(name, { filter_type: input.dataset.analyticsFilterType, filter_value: input.value });
  });
}

function observeAdSlots() {
  const seen = new WeakSet<Element>();
  const scan = () => document.querySelectorAll("[data-ad-slot]").forEach((slot) => {
    if (seen.has(slot)) return; seen.add(slot);
    const location = (slot as HTMLElement).dataset.adSlot || "unspecified";
    if (!track("ad_slot_requested", { slot_location: location })) { seen.delete(slot); return; }
    const rendered = () => slot.querySelector("iframe") || slot.getAttribute("data-ad-status") === "filled";
    if (rendered()) { track("ad_slot_rendered", { slot_location: location }); return; }
    new MutationObserver((_, observer) => { if (rendered()) { track("ad_slot_rendered", { slot_location: location }); observer.disconnect(); } }).observe(slot, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-ad-status"] });
  });
  scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); window.addEventListener("sfz:consent-change", scan);
}

function start() { bindDeclarativeEvents(); observeWebVitals(); observeAdSlots(); pageview(); }
window.sfzAnalytics = { track, pageview };
document.addEventListener("astro:page-load", pageview);
window.addEventListener("sfz:consent-change", (event: Event) => { const value = (event as CustomEvent).detail?.analytics; if (typeof value === "boolean") consentOverride = value; pageview(); });
start();
