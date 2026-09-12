import { NEWS_SITE } from "../lib/news-team.mjs";
export type CuratedTopic = "Championship follow-up" | "Franchise context" | "Seattle football culture";

export interface CuratedLink {
  title: string;
  publisher: string;
  url: string;
  publicationDate: string;
  dateAdded: string;
  topic: CuratedTopic;
  whyItMatters: string;
  paywall?: boolean;
  editor: string;
  relatedStories?: Array<{ title: string; url: string }>;
}

export interface CuratedEdition {
  title: string;
  publishedDate: string;
  introduction: string;
  entries: CuratedLink[];
}

// Hand-selected source links and SFZ annotations only. Article text is never imported or stored.
const seattleEdition: CuratedEdition = {
  title: "The view after Seattle’s second title",
  publishedDate: "2026-02-13",
  introduction:
    "Seattle’s second championship is the center of this edition, but the useful reading goes beyond the celebration. These picks connect the official account of the win to the franchise arc that preceded it and to the fan traditions that make a Seahawks title feel distinctly Pacific Northwest.",
  entries: [
    {
      title: "The Seahawks are Super Bowl LX champions",
      publisher: "Seattle Seahawks",
      url: "https://www.seahawks.com/news/2025-the-seahawks-are-super-bowl-lx-champions",
      publicationDate: "2026-02-08",
      dateAdded: "2026-02-09",
      topic: "Championship follow-up",
      whyItMatters:
        "Start with the team’s primary account of the night Seattle secured its second Lombardi Trophy. It establishes the result and championship context before the conversation moves to interpretation and legacy.",
      editor: "SFZ Editorial Desk",
      relatedStories: [
        { title: "Explore the latest SFZ game recap", url: "/weekly-recap" },
        { title: "See Seattle’s season schedule and results", url: "/schedule" },
      ],
    },
    {
      title: "Seattle Seahawks team facts",
      publisher: "Pro Football Hall of Fame",
      url: "https://www.profootballhof.com/teams/seattle-seahawks/team-facts",
      publicationDate: "2026-02-09",
      dateAdded: "2026-02-10",
      topic: "Championship follow-up",
      whyItMatters:
        "The updated franchise ledger puts another Seattle championship in one compact historical frame. It is a useful reference point when weighing where this team belongs alongside the Seahawks’ other conference champions and title winner.",
      editor: "SFZ Editorial Desk",
      relatedStories: [{ title: "Walk through the SFZ franchise timeline", url: "/history#timeline" }],
    },
    {
      title: "Seattle Seahawks team history",
      publisher: "Pro Football Hall of Fame",
      url: "https://www.profootballhof.com/teams/seattle-seahawks/team-history",
      publicationDate: "2026-02-09",
      dateAdded: "2026-02-11",
      topic: "Franchise context",
      whyItMatters:
        "A second championship lands differently when viewed against five decades of expansion growing pains, breakthrough playoff runs and the first NFC crown. This overview supplies the long arc behind a moment that can otherwise feel isolated.",
      editor: "SFZ Editorial Desk",
      relatedStories: [{ title: "Read SFZ’s History & The 12s guide", url: "/history" }],
    },
    {
      title: "Seattle Seahawks team profile and Hall of Famers",
      publisher: "Pro Football Hall of Fame",
      url: "https://www.profootballhof.com/teams/seattle-seahawks/",
      publicationDate: "2026-02-09",
      dateAdded: "2026-02-11",
      topic: "Franchise context",
      whyItMatters:
        "Championships prompt legacy debates, and Seattle’s standard-setters provide the right baseline. The Hall’s team profile is a clean starting point for comparing this era’s leading players with the franchise figures already enshrined in Canton.",
      editor: "SFZ Editorial Desk",
      relatedStories: [{ title: "Browse the current Seahawks roster", url: "/players" }],
    },
    {
      title: "The history of the 12s",
      publisher: "Seattle Seahawks",
      url: "https://www.seahawks.com/news/the-history-of-the-12s",
      publicationDate: "2024-12-15",
      dateAdded: "2026-02-12",
      topic: "Seattle football culture",
      whyItMatters:
        "The retired number, the Kingdome noise and the rituals around the 12 Flag explain why Seattle supporters see themselves inside the team’s story. After a title, this is a worthwhile reminder that local football culture was built over generations, not in one postseason.",
      editor: "SFZ Editorial Desk",
      relatedStories: [{ title: "Explore the 12s in the SFZ timeline", url: "/history#timeline" }],
    },
    {
      title: "Lumen Field stadium history and facts",
      publisher: "Lumen Field",
      url: "https://www.lumenfield.com/venue-info/stadium-history-facts",
      publicationDate: "2025-09-01",
      dateAdded: "2026-02-12",
      topic: "Seattle football culture",
      whyItMatters:
        "Seattle’s open-air home is part of the competitive and emotional identity surrounding every Seahawks run. The venue history connects the current celebration to the stadium era that began in 2002 and became synonymous with the 12s.",
      editor: "SFZ Editorial Desk",
      relatedStories: [{ title: "Find upcoming home dates on the SFZ schedule", url: "/schedule" }],
    },
  ],
};

export const MIN_MEANINGFUL_ENTRIES = 4;

export const currentEdition: CuratedEdition = { ...seattleEdition, entries: NEWS_SITE.team === "seahawks" ? seattleEdition.entries : [] };
