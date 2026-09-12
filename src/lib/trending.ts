export interface TrendingCandidate {
  title: string;
  href: string;
  category: string;
  publishedAt: string;
  pinnedAt?: string;
  pinExpiresAt?: string;
  firstPartyViews?: number;
}

export interface TrendingItem extends TrendingCandidate {
  reason: "editorial" | "first-party-views";
}

export const TRENDING_RULES = {
  maximumItems: 5,
  freshnessDays: 14,
  minimumFirstPartyViews: 100,
} as const;

const time = (value?: string) => value ? Date.parse(value) : Number.NaN;
const isInternalPage = (href: string) => href.startsWith("/") && !href.startsWith("//") && !href.includes("#");

/** Deterministic build-time selection. See docs/trending-now.md for the editorial contract. */
export function selectTrending(
  candidates: TrendingCandidate[],
  now = new Date(),
): TrendingItem[] {
  const nowTime = now.getTime();
  const freshnessStart = nowTime - TRENDING_RULES.freshnessDays * 24 * 60 * 60 * 1000;

  return candidates
    .filter((item) => item.title.trim() && item.category.trim() && isInternalPage(item.href) && Number.isFinite(time(item.publishedAt)))
    .flatMap((item): TrendingItem[] => {
      const pinned = Number.isFinite(time(item.pinnedAt)) && time(item.pinnedAt) <= nowTime;
      const unexpired = Number.isFinite(time(item.pinExpiresAt)) && time(item.pinExpiresAt) > nowTime;
      if (pinned && unexpired) return [{ ...item, reason: "editorial" }];

      const views = item.firstPartyViews;
      const fresh = time(item.publishedAt) >= freshnessStart && time(item.publishedAt) <= nowTime;
      if (fresh && Number.isInteger(views) && views! >= TRENDING_RULES.minimumFirstPartyViews) {
        return [{ ...item, reason: "first-party-views" }];
      }
      return [];
    })
    .sort((a, b) => {
      const aPinned = a.reason === "editorial" ? 1 : 0;
      const bPinned = b.reason === "editorial" ? 1 : 0;
      return bPinned - aPinned
        || (b.firstPartyViews ?? 0) - (a.firstPartyViews ?? 0)
        || time(b.publishedAt) - time(a.publishedAt)
        || a.title.localeCompare(b.title);
    })
    .slice(0, TRENDING_RULES.maximumItems);
}
