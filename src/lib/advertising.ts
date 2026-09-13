const configuredClientId = String(import.meta.env.PUBLIC_ADSENSE_PUBLISHER_ID ?? "").trim();
const configuredCmpUrl = String(import.meta.env.PUBLIC_CMP_SCRIPT_URL ?? "").trim();

export const AD_CLIENT_ID = /^ca-pub-\d{16}$/.test(configuredClientId) ? configuredClientId : "";
export const AD_PHASE = String(import.meta.env.PUBLIC_ADSENSE_PHASE ?? "off");
export const AD_VERIFICATION_CONFIGURED = ["review", "live"].includes(AD_PHASE) && Boolean(AD_CLIENT_ID);
export const CMP_SCRIPT_URL = (() => {
  try {
    const url = new URL(configuredCmpUrl);
    return url.protocol === "https:" && url.hostname === "fundingchoicesmessages.google.com"
      && !url.username && !url.password && !url.port ? url.href : "";
  } catch { return ""; }
})();
export const AD_PRODUCTION_HOSTS: string[] = (() => {
  try {
    const hosts = JSON.parse(String(import.meta.env.PUBLIC_ADSENSE_PRODUCTION_HOSTS ?? "[]"));
    return Array.isArray(hosts) && hosts.every((host) => typeof host === "string" && /^[a-z0-9.-]+$/.test(host)) ? hosts : [];
  } catch { return []; }
})();
export const ADVERTISING_CONFIGURED = AD_PHASE === "live" && import.meta.env.ADS_ENABLED === "true"
  && Boolean(AD_CLIENT_ID && CMP_SCRIPT_URL && AD_PRODUCTION_HOSTS.length);

export const AD_PLACEMENTS = ["article-inline", "article-end", "feed-break", "desktop-rail", "stats-break"] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];
export type AdPageType = "homepage" | "news-archive" | "news-article" | "schedule" | "stats" | "roster" | "thin";

type PagePolicy = {
  maxManual: number;
  mobileMax: number;
  allowed: readonly AdPlacement[];
  minContentUnits: Partial<Record<AdPlacement, number>>;
};

/** {Team} Fan Zone house rules, not Google requirements. */
export const AD_PAGE_POLICIES: Record<AdPageType, PagePolicy> = {
  homepage: { maxManual: 2, mobileMax: 1, allowed: ["feed-break"], minContentUnits: { "feed-break": 4 } },
  "news-archive": { maxManual: 1, mobileMax: 1, allowed: ["feed-break"], minContentUnits: { "feed-break": 5 } },
  "news-article": { maxManual: 2, mobileMax: 1, allowed: ["article-inline", "article-end", "desktop-rail"], minContentUnits: { "article-inline": 3, "article-end": 8, "desktop-rail": 5 } },
  schedule: { maxManual: 2, mobileMax: 1, allowed: ["stats-break", "desktop-rail"], minContentUnits: { "stats-break": 4, "desktop-rail": 6 } },
  stats: { maxManual: 2, mobileMax: 1, allowed: ["stats-break", "desktop-rail"], minContentUnits: { "stats-break": 3, "desktop-rail": 6 } },
  roster: { maxManual: 2, mobileMax: 1, allowed: ["stats-break", "desktop-rail"], minContentUnits: { "stats-break": 8, "desktop-rail": 12 } },
  thin: { maxManual: 0, mobileMax: 0, allowed: [], minContentUnits: {} },
};

export const AUTO_ADS = {
  enabled: import.meta.env.PUBLIC_ADSENSE_AUTO_ADS === "true",
  overlays: {
    anchor: import.meta.env.PUBLIC_ADSENSE_ANCHOR_ADS === "true",
    vignette: import.meta.env.PUBLIC_ADSENSE_VIGNETTE_ADS === "true",
  },
} as const;

export const AD_SLOT_IDS: Partial<Record<AdPlacement, string>> = {
  "article-inline": import.meta.env.PUBLIC_ADSENSE_ARTICLE_INLINE_SLOT,
  "article-end": import.meta.env.PUBLIC_ADSENSE_ARTICLE_END_SLOT,
  "feed-break": import.meta.env.PUBLIC_ADSENSE_FEED_BREAK_SLOT,
  "desktop-rail": import.meta.env.PUBLIC_ADSENSE_DESKTOP_RAIL_SLOT,
  "stats-break": import.meta.env.PUBLIC_ADSENSE_STATS_BREAK_SLOT,
};

export function mayRenderAd({ pageType, placement, ordinal = 1, contentUnits = 0, thinContent = false, sensitiveArea = false }: {
  pageType: AdPageType;
  placement: AdPlacement;
  ordinal?: number;
  contentUnits?: number;
  thinContent?: boolean;
  sensitiveArea?: boolean;
}) {
  if (!ADVERTISING_CONFIGURED) return false;
  const policy = AD_PAGE_POLICIES[pageType];
  if (thinContent || sensitiveArea || pageType === "thin") return false;
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > policy.maxManual) return false;
  if (!policy.allowed.includes(placement)) return false;
  return contentUnits >= (policy.minContentUnits[placement] ?? 0);
}

export function mayRenderAdOnMobile(pageType: AdPageType, ordinal = 1) {
  return Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= AD_PAGE_POLICIES[pageType].mobileMax;
}
