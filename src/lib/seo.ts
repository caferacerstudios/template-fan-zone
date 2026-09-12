export const SITE_NAME = "{Team} Fan Zone";
export const SITE_URL = "https://{team}fanzone.com";

export interface ArticleMetadata {
  headline: string;
  author: string;
  publishedTime: string;
  modifiedTime?: string;
  image: string;
  section?: string;
}

export interface SeoMetadata {
  title: string;
  description: string;
  canonicalPath: string;
  robots?: string;
  openGraphTitle?: string;
  openGraphDescription?: string;
  openGraphImage?: string;
  openGraphImageAlt?: string;
  article?: ArticleMetadata;
}

export interface SitemapPage extends SeoMetadata {
  lastModified?: string;
}

export const PUBLIC_PAGES: SitemapPage[] = [
  { canonicalPath: "/", title: "{Location} {Team} News, Schedule, Roster and Analysis", description: "Follow {Location} {Team} news and analysis, the next game, schedule, current roster, injury updates, results and essential franchise guides." },
  { canonicalPath: "/news", title: "{Location} {Team} News and Original Analysis", description: "Read original {Location} {Team} news and analysis covering roster decisions, injuries, games and the NFC West, with every published story in one archive." },
  { canonicalPath: "/schedule", title: "2026 {Location} {Team} Schedule, Times and Results", description: "See the 2026 {Location} {Team} schedule with opponents, dates, Pacific kickoff times, venues, game status and final scores as games are completed." },
  { canonicalPath: "/weekly-recap", title: "{Location} {Team} Game Recaps | {Team} Fan Zone", description: "Read original {Location} {Team} game recaps with final scores, turning points, and season context." },
  { canonicalPath: "/news/around-the-web", title: "{Team} Around the Web | Curated {Location} Reading", description: "A hand-curated {Team} reading digest with source attribution, original {Location}-focused commentary, and links to worthwhile reporting around the web.", lastModified: "2026-02-13" },
  { canonicalPath: "/standings", title: "2026 {Location} {Team} NFC West Standings", description: "Track {Location}'s 2026 NFC West position, record and division results once games begin, with preseason and regular-season records clearly separated." },
  { canonicalPath: "/team", title: "2026 {Location} {Team} Team Statistics", description: "Review verified 2026 {Location} {Team} record and scoring totals as regular-season games are completed, with unavailable statistics clearly identified." },
  { canonicalPath: "/players", title: "2026 {Location} {Team} Roster and Player Directory", description: "Browse the current 2026 {Location} {Team} active roster, practice squad and reserve lists, plus player profiles and clearly labeled historical statistics." },
  { canonicalPath: "/team/transactions", title: "{Location} {Team} Transactions and Roster Moves", description: "Track sourced {Location} {Team} signings, releases, waivers, trades, reserve-list changes and contract updates in chronological order." },
  { canonicalPath: "/team/injuries", title: "{Location} {Team} Injury and Player Status Updates", description: "Review sourced {Location} {Team} injury, reserve-list and participation-status updates, with no unsupported medical or recovery speculation." },
  { canonicalPath: "/history", title: "{Location} {Team} History, Eras and The 12s", description: "Explore a sourced guide to {Location} {Team} history, including franchise milestones, championship eras, notable players and the story of the 12s." },
  { canonicalPath: "/tickets", title: "{Location} {Team} Ticket Finder and Price Comparison", description: "Compare recent {Team} ticket price observations and provider options, understand fee and freshness limits, and review independent buying guidance." },
  { canonicalPath: "/about", title: "About {Team} Fan Zone", description: "Learn about {Team} Fan Zone, an independent source for {Location} football statistics, recaps, and historical context." },
  { canonicalPath: "/contact", title: "Contact and Corrections | {Team} Fan Zone", description: "Contact the {Team} Fan Zone site owner about general feedback, corrections, rights concerns, or business inquiries." },
  { canonicalPath: "/methodology", title: "Data Methodology | {Team} Fan Zone", description: "Learn how {Team} Fan Zone sources, checks, and updates schedule, team, player, and recap information." },
  { canonicalPath: "/sources", title: "Sources | {Team} Fan Zone", description: "Learn how {Team} Fan Zone selects, attributes, and verifies editorial and structured-data sources." },
  { canonicalPath: "/disclosure", title: "Advertising and Affiliate Disclosure | {Team} Fan Zone", description: "Read the advertising, affiliate-link, and editorial-independence disclosure for {Team} Fan Zone." },
];

export const PRIVATE_UTILITY_PAGES: SitemapPage[] = [
  { canonicalPath: "/privacy-policy", title: "Privacy Policy | {Team} Fan Zone", description: "Read how {Team} Fan Zone handles basic usage data, cookies, analytics, advertising, and privacy requests.", robots: "noindex, follow" },
];

export function pageMetadata(pathname: string): SeoMetadata | undefined {
  const path = normalizePath(pathname);
  return [...PUBLIC_PAGES, ...PRIVATE_UTILITY_PAGES].find((page) => page.canonicalPath === path);
}

export function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}

export function absoluteUrl(path: string): string {
  return new URL(normalizePath(path), `${SITE_URL}/`).toString();
}
