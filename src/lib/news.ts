// SFZ_DAILY_NEWS_V1
import generatedNews from "../data/news/generated-articles.json" with { type: "json" };
import { mergePublishedArticles, validateGeneratedCollection } from "./news-artifacts.mjs";
export const NEWS_CATEGORIES = ["News", "Analysis", "Contract Strategy", "Roster", "Injuries", "Game Week", "Hard Knocks", "NFC West"] as const;

export type NewsCategory = typeof NEWS_CATEGORIES[number];
export type PublicationStatus = "draft" | "published" | "archived";

export interface NewsSource {
  label: string;
  url: string;
}

export interface HeroAsset {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
}

export interface NewsArticle {
  slug: string;
  headline: string;
  dek: string;
  publishedAt: string;
  updatedAt: string;
  author: string;
  category: NewsCategory;
  tags: string[];
  season: number | null;
  opponent: string | null;
  body: ArticleBodyBlock[];
  sources: NewsSource[];
  hero: HeroAsset;
  featured: boolean;
  status: PublicationStatus;
  contentKind?: "coverage" | "publication-info";
  generation?: { kind: "ai"; publicationDay: string; model: string; promptVersion?: string };
}

export type ArticleBodyBlock = string
  | { type: "heading"; heading: string }
  | { type: "paragraph"; html: string }
  | { type: "table"; caption: string; note: string; columns: string[]; rows: { cells: string[] }[] }
  | { type: "timeline" | "watchlist"; items: { label: string; html: string }[] }
  | { type: "factbox"; heading: string; known: string[]; unknown: string[]; milestone: string };

const sharedHero: HeroAsset = {
  src: "/images/news/newsroom-field.svg",
  alt: "Abstract football field lines in {Team} Fan Zone colors",
  width: 1200,
  height: 675,
};

const articles: NewsArticle[] = [
  {
    slug: "what-made-2025-{team}-champions-repeatable-2026",
    headline: "What made the 2025 {Team} champions, and which strengths can carry into 2026",
    dek: "Seattle's title rested on a defense that won ordinary downs, an efficient passing game and real field-position help. Here is what looks durable, and what is likelier to move back toward the pack.",
    publishedAt: "2026-08-28",
    updatedAt: "2026-08-28",
    author: "{Team} Fan Zone Editorial Team",
    category: "Analysis",
    tags: ["2025 season", "Super Bowl LX", "Data analysis", "2026 outlook", "Mike Macdonald", "Jaxon Smith-Njigba"],
    season: 2025,
    opponent: null,
    body: [
      { type: "paragraph", html: "The <a href=\"/history\">franchise timeline</a> records the headline: Seattle finished 14–3, earned the NFC's top seed and beat New England 29–13 in Super Bowl LX for its second championship. The more useful question for 2026 is how it happened. The evidence points to a broad base, not one hot playoff month. Seattle finished first in regular-season point differential, first in points allowed and third in points scored. Its defense suppressed rushing efficiency and ended drives on third down; its offense created high-value passing yards despite a middling red-zone rate; its specialists added hidden and direct points. Some of those inputs remain. Others, especially perfect postseason ball security and return touchdowns, should be treated as benefits rather than baselines. The site's <a href=\"/team\">team statistics</a>, <a href=\"/players\">roster and historical player statistics</a> and <a href=\"/standings\">standings</a> provide the live 2026 comparison points." },

      { type: "heading", heading: "The season in six numbers" },
      { type: "table", caption: "Six numbers that explain Seattle's 2025 regular season", columns: ["Measure", "Seattle", "NFL context", "Plain-football meaning"], rows: [
        { cells: ["Point differential", "+191", "1st", "Seattle outscored opponents by 11.2 points per game, evidence of strength beyond a 14–3 record."] },
        { cells: ["Offensive yards per play", "5.9", "8th", "The offense produced above-average distance each snap without requiring league-leading volume."] },
        { cells: ["Offensive points per drive", "2.32", "11th", "Good, not extraordinary, drive finishing. Defense and special teams widened the scoreboard advantage."] },
        { cells: ["Defensive points per drive", "1.48", "1st", "An opponent possession was worth 0.84 fewer points than a Seattle possession on average."] },
        { cells: ["Opponent yards per rush", "3.7", "1st", "Strong run defense kept the full defensive call sheet available on later downs."] },
        { cells: ["Opponent third-down rate", "32.1%", "1st", "Seattle ended nearly seven of every ten third-down attempts without allowing a conversion."] }
      ], note: "Data period: 2025 regular season, 17 games. Source: Pro Football Reference team totals and drive table; rankings are its published NFL ranks. Point differential is 483 points scored minus 292 allowed. The drive comparison uses 183 Seattle drives and 188 opponent drives. Alt text: Table comparing six Seattle efficiency measures with 2025 NFL rank and a plain-language interpretation." },

      { type: "heading", heading: "The offense created value between the 20s" },
      { type: "paragraph", html: "Seattle's offense was productive without being equally strong everywhere. It gained 5,973 yards on 1,015 plays, or 5.88 yards per play before rounding, and scored 483 points. The passing game did more of the efficiency work: team net yards per pass attempt were 7.6, second in the NFL, while the running game averaged 4.1 yards per carry, 25th. <a href=\"/players/sam-darnold\">Sam Darnold</a> completed 67.7% of his passes for 4,048 yards, 25 touchdowns and 14 interceptions. Seattle allowed 27 sacks, a 5.3% sack rate. That combination says the line and quarterback generally preserved passing plays, even though giveaways remained a weakness." },
      { type: "paragraph", html: "The offense converted 39.8% of third downs, 16th, and scored touchdowns on 32 of 59 red-zone trips, 54.2%, 21st. Those are important boundaries on the argument. Seattle did not score because every long possession ended perfectly. It created field position and chunk yardage, then received enough support from defense, returns and Jason Myers to turn an above-average offense into the league's third-highest point total. Reliable play-by-play data was not available for this analysis, so early-down and whole-team explosive-play rates were excluded." },
      { type: "paragraph", html: "The clearest concentration risk was <a href=\"/players/jaxon-smith-njigba\">Jaxon Smith-Njigba</a>. His 1,793 receiving yards represented 44.1% of Seattle's 4,063 gross team passing yards, and his 119 catches were 36.6% of the team's 325 completions. Those are original calculations, not target share. He also generated 27 catches of at least 20 yards, according to his official {Team} profile. A player capable of carrying that load is a repeatable advantage. Needing him to carry it is a vulnerability if coverage changes or availability does." },

      { type: "heading", heading: "The defense won before it needed a takeaway" },
      { type: "paragraph", html: "The defense's case is stronger because it does not depend on turnovers. Seattle allowed 4.6 yards per play, second in the NFL, 3.7 per rush, first, and 1.48 points per drive, first. Opponents converted only 75 of 234 third downs. They scored touchdowns on 26 of 52 red-zone possessions, a 50.0% rate that ranked fifth. Those measures describe repeatable down-to-down resistance: short gains created longer third downs, and longer third downs expanded Mike Macdonald's pressure and coverage menu." },
      { type: "paragraph", html: "Pressure mattered, but the verified public totals support a careful description rather than a proprietary pressure grade. Seattle recorded 47 sacks, tied for seventh in the league, while allowing only 20 passing touchdowns and intercepting 18 passes. The front could rush without selling out against the run, and the secondary could change responsibilities after the snap. <a href=\"/players/devon-witherspoon\">Devon Witherspoon</a> supplied outside and nickel flexibility, while <a href=\"/players/leonard-williams\">Leonard Williams</a>, Byron Murphy II and the edge rotation supplied different entry points to the quarterback." },
      { type: "paragraph", html: "The postseason was three games, so it belongs in a separate sample. Seattle allowed 46 total points, or 15.3 per game, against San Francisco, the Rams and New England. The Super Bowl defense produced six sacks, two interceptions and 11 quarterback hits, but that single game should confirm the regular-season profile, not define it. The 17-game evidence is the better reason to expect the structure to travel." },

      { type: "heading", heading: "Special teams changed possessions and scoreboards" },
      { type: "paragraph", html: "Special teams were not background detail. Michael Dickson averaged 42.2 net yards on 52 regular-season punts and put 20 inside the 20. Rashid Shaheed averaged 29.9 yards on 14 kick returns and 16.2 on 13 punt returns after arriving in Seattle; Tory Horton averaged 14.9 on 16 punt returns. The {Team}' season review credits special teams with five touchdowns including the playoffs. Those scores mattered, but return touchdowns are sparse events. Dickson's net average and the return units' consistent yardage are the sounder 2026 baseline." },

      { type: "heading", heading: "Three strengths that can reasonably repeat" },
      { type: "table", caption: "Repeatability audit for Seattle's 2025 strengths", columns: ["Strength", "2025 evidence", "Personnel or scheme", "2026 input check", "Outlook"], rows: [
        { cells: ["Run defense across flexible fronts", "3.7 opponent yards per rush, 1st; nine rush TD allowed, 2nd", "Macdonald's fronts, Williams and Murphy inside, Witherspoon's movable role", "Macdonald, defensive coordinator Aden Durde and the named core are on the Aug. 28 roster", "Reasonably repeatable; matching No. 1 exactly is not required"] },
        { cells: ["Efficient primary passing connection", "7.6 team net yards per attempt, 2nd; Smith-Njigba had 1,793 yards", "Darnold's accuracy plus Smith-Njigba's route and catch production", "Both are on the Aug. 28 roster; Smith-Njigba is extended through 2031", "Repeatable foundation, with concentration risk"] },
        { cells: ["Field-position specialists", "Dickson: 42.2 net, 20 punts inside 20; Shaheed: 29.9 kick-return average", "Directional punting, coverage and return speed", "Dickson, Shaheed, Horton, Myers and coordinator Jay Harbaugh remain on the Aug. 28 roster/staff", "Yardage edge is more repeatable than touchdowns"] }
      ], note: "Data period: 2025 regular season unless noted. Sources: NFL and {Team} team statistics; {Team} 2026 roster and coaching staff. ‘Reasonably repeatable’ is a projection, not a guarantee. Alt text: Table connecting three 2025 strengths to their statistical evidence, underlying personnel and 2026 continuity." },
      { type: "paragraph", html: "Continuity is strongest on defense. Macdonald still directs the system, Durde remains defensive coordinator, and Seattle's Aug. 28 roster retains Witherspoon, Williams, Murphy, Ernest Jones IV, DeMarcus Lawrence and multiple rotational rushers. Offensively, the two central players return, but the designer changes. Brian Fleury replaced Klint Kubiak after Kubiak became Las Vegas' head coach. Fleury comes from a related outside-zone and play-action family, which may reduce transition cost, but continuity of terminology is not proof of continuity in sequencing or results." },

      { type: "heading", heading: "Three regression risks" },
      { type: "paragraph", html: "<strong>1. Turnover timing.</strong> Seattle's regular-season margin was only minus-three: 25 takeaways against 28 giveaways. Then it became the first champion to complete an entire postseason without a turnover. Three clean games are valuable performance, especially against playoff opponents, but they are still three games. If the offense again approaches 28 regular-season giveaways, the defense may not always erase them." },
      { type: "paragraph", html: "<strong>2. Health and concentrated responsibility.</strong> Witherspoon missed five regular-season games, yet the defense maintained its standard. That depth was tested successfully, not promised forever. Smith-Njigba supplied 44.1% of gross passing yards, while Darnold started all 17 games. Losing either would change far more than one lineup spot. Injury forecasting is unreliable, so the risk is exposure, not a prediction that someone will be hurt." },
      { type: "paragraph", html: "<strong>3. Close-game and situational variance.</strong> Seattle went 6–3 in regular-season games decided by eight points or fewer, calculated from the official 17-game results. That is good without being the foundation of the record: the {Team} were 8–0 in games decided by nine or more and owned a plus-191 differential. Still, a one-point comeback such as the 38–37 win over the Rams cannot be budgeted as routine. The coordinator change adds another source of variation because offensive red-zone and third-down decisions now belong to Fleury." },

      { type: "heading", heading: "What Seattle does not need to repeat exactly" },
      { type: "paragraph", html: "Seattle does not need another league-low 1.48 defensive points per drive, five special-teams touchdowns across the full season and playoffs, or three turnover-free playoff games to remain a championship-level team. A defense can slide from first to fifth if the offense improves its 54.2% red-zone touchdown rate or reduces its 28 giveaways. Return touchdowns can disappear while better average starting field position still creates value. Smith-Njigba can fall short of 1,793 yards if a healthier distribution to Shaheed, Cooper Kupp, AJ Barner and the backs keeps team passing efficiency high. Sustainable teams replace lost outlier value rather than demanding the same outlier twice." },

      { type: "heading", heading: "Four indicators for the first month of 2026" },
      { type: "watchlist", items: [
        { label: "Net yards per pass attempt", html: "Track whether Seattle remains above <strong>7.0</strong>, close to the 2025 strength of 7.6, under Fleury's play calling." },
        { label: "Opponent yards per rush", html: "Use <strong>4.0</strong> as the early checkpoint. A small four-game sample cannot settle the run defense, but repeated efficient runs would change the down-and-distance advantage." },
        { label: "Giveaways per game", html: "Watch for <strong>1.0 or fewer</strong>. Seattle averaged 1.65 in the 2025 regular season before giving the ball away zero times in the postseason." },
        { label: "Non-JSN receiving share", html: "Calculate gross team passing yards minus Smith-Njigba's yards, divided by gross team passing yards. A share above <strong>60%</strong> would show broader production without requiring his efficiency to fall." }
      ] },

      { type: "heading", heading: "Methodology and limitations" },
      { type: "paragraph", html: "Reliable 2025 play-by-play data was not available for this analysis, so early-down, pressure-rate, drive-start and whole-team explosive-play statistics were not calculated. Official {Team} and NFL pages verify records, scores and basic totals. Pro Football Reference supplies transparent team drive totals and published league ranks. Original calculations use unrounded inputs where available: point differential = 483 − 292; yards per play = 5,973 ÷ 1,015; Smith-Njigba receiving-yard share = 1,793 ÷ 4,063; catch share = 119 ÷ 325; close-game record counts final margins of eight or fewer. Kneel-downs, spikes and garbage time were not excluded because the available aggregate totals do not identify them. Regular season is 17 games; postseason is three. The monitoring thresholds are editorial checkpoints, not forecasts or league averages. This historical analysis remains fixed after kickoff; only the four-item monitoring section should be updated with 2026 results." }
    ],
    sources: [
      { label: "Seattle {Team}: 2025 regular-season team and player statistics", url: "https://www.{team}.com/team/stats/2025/reg" },
      { label: "Seattle {Team}: 2025 schedule and official results", url: "https://www.{team}.com/schedule/2025/" },
      { label: "Seattle {Team}: 2025 season numbers", url: "https://www.{team}.com/news/12-numbers-of-note-from-the-{team}-super-bowl-winning-2025-season" },
      { label: "Seattle {Team}: finalized 2026 coaching staff", url: "https://www.{team}.com/news/seattle-{team}-finalize-2026-coaching-staff" },
      { label: "Seattle {Team}: current 2026 roster", url: "https://www.{team}.com/team/players-roster/" },
      { label: "NFL: 2025 team statistics", url: "https://www.nfl.com/stats/team-stats/" },
      { label: "Pro Football Reference: 2025 {Team} team, drive and league-rank tables", url: "https://www.pro-football-reference.com/teams/sea/2025.htm" }
    ],
    hero: {
      src: "/images/news/2025-championship-analysis.png",
      alt: "Illustrated football beside a transparent strategy board on a rainy field, with a Seattle-inspired skyline and six glowing data points",
      width: 1672,
      height: 941
    },
    featured: true,
    status: "published"
  },
  {
    slug: "price-of-keeping-a-champion-{team}-contract-strategy",
    headline: "The price of keeping a champion: How Seattle is building around its core",
    dek: "Four extensions reveal a deliberate split: buy the prime years of drafted stars early, then pay selectively to keep the veteran who makes the defensive structure work.",
    publishedAt: "2026-08-28",
    updatedAt: "2026-09-11T03:45:42Z",
    author: "{Team} Fan Zone Editorial Team",
    category: "Contract Strategy",
    tags: ["Contracts", "Roster building", "Salary cap", "Jaxon Smith-Njigba", "Devon Witherspoon", "Derick Hall", "Leonard Williams"],
    season: 2026,
    opponent: null,
    body: [
      { type: "paragraph", html: "Seattle has committed to four players who explain its post-championship plan better together than separately. <a href=\"/players/jaxon-smith-njigba\">Jaxon Smith-Njigba</a>, <a href=\"/players/derick-hall\">Derick Hall</a> and <a href=\"/players/devon-witherspoon\">Devon Witherspoon</a> came from the 2023 draft and received extensions in the first offseason NFL rules allowed them to negotiate one. <a href=\"/players/leonard-williams\">Leonard Williams</a>, 32, is the exception that clarifies the rule: Seattle is buying prime seasons from its young stars while paying to keep the veteran interior defender around whom Mike Macdonald can organize the front. The central question is whether that blend can preserve the champion’s hardest-to-replace strengths without squeezing out the next wave of the roster." },
      { type: "paragraph", html: "The four reported extensions contain <strong>$432.6 million in new-money base value</strong>: $168.6 million for Smith-Njigba, $42 million for Hall, $132 million for Witherspoon and $90 million for Williams. That addition is useful for scale, but it is not Seattle’s immediate bill and it is not guaranteed cash. Three deals were added to seasons already under contract, and the cap recognizes signing bonuses over time. The comparison therefore starts with what each number actually describes." },
      { type: "table", caption: "Seattle {Team} core extensions signed in 2026", columns: ["Player", "Pos.", "Age at 2026 season start", "Extension date", "New contract years", "Total contract duration", "Reported value", "Reported guarantees", "Through", "2025 production or role", "Primary source"], rows: [
        { cells: ["<a href=\"/players/jaxon-smith-njigba\">Jaxon Smith-Njigba</a>", "WR", "24", "Mar. 25, 2026", "4", "6 seasons, 2026-31", "$168.6M new money", "$120.068M total; $69.13M fully at signing", "2031", "119 catches, NFL-leading 1,793 receiving yards, 10 TD; AP Offensive Player of the Year", "<a href=\"https://www.{team}.com/news/{team}-sign-jaxon-smith-njigba-to-multi-year-extension\">{Team}</a>"] },
        { cells: ["<a href=\"/players/derick-hall\">Derick Hall</a>", "OLB / edge", "25", "June 3, 2026", "3", "4 seasons, 2026-29", "$42M new money; up to $46.5M with incentives", "$21M injury guarantee; $15.27M fully at signing", "2029", "Rotational edge: 37.2% of defensive snaps, 2 sacks, 13 QB hits; 2 sacks and a forced fumble in Super Bowl LX", "<a href=\"https://www.{team}.com/news/{team}-sign-outside-linebacker-derick-hall-to-three-year-extension\">{Team}</a>"] },
        { cells: ["<a href=\"/players/devon-witherspoon\">Devon Witherspoon</a>", "CB", "25", "Aug. 17, 2026", "4", "6 seasons, 2026-31", "$132M new money", "$101M total; $59.006M fully at signing", "2031", "12 starts; 72 tackles, 7 passes defensed, 1 INT; second-team All-Pro; outside and nickel roles", "<a href=\"https://www.{team}.com/news/{team}-cb-devon-witherspoon-signs-contract-extension\">{Team}</a>"] },
        { cells: ["<a href=\"/players/leonard-williams\">Leonard Williams</a>", "DL", "32", "Aug. 27, 2026", "3", "4 seasons, 2026-29", "$90M new money", "$56M reported guaranteed; full-guarantee split not yet published", "2029", "Second-team All-Pro and Pro Bowl; team-high 17 Pro Football Reference approximate value", "<a href=\"https://www.{team}.com/news/{team}-sign-foundational-player-leonard-williams-to-multi-year-contract-extension\">{Team}</a>"] }
      ], note: "Ages are as of Sept. 9, 2026, when Seattle opens the regular season against New England. ‘Total contract duration’ includes years already under contract when the extension was signed. Performance is 2025 regular season unless the postseason is identified. Contract detail: Over the Cap; Williams value and guarantee: NFL Network and ESPN reporting carried by NFL.com. Values are rounded to the nearest $1,000 where shown." },

      { type: "heading", heading: "Six contract terms that answer different questions" },
      { type: "paragraph", html: "<strong>Total contract value</strong> is the maximum scheduled value of the contract as described, but reports often use that phrase for the extension alone. <strong>New money</strong> is compensation added beyond the player’s old deal. Smith-Njigba’s four-year, $168.6 million extension produces a $42.15 million <strong>average annual value</strong>, calculated as $168.6 million divided by four new years. Across all six contracted seasons, however, Spotrac reported roughly $195.1 million, or about $32.52 million per season. Both calculations are valid, but they answer different questions." },
      { type: "paragraph", html: "<strong>Guaranteed money</strong> also needs a qualifier. Money fully guaranteed at signing is stronger protection than an injury guarantee or salary that becomes guaranteed on a later roster date. For Hall, Over the Cap lists $21 million guaranteed for injury but $15.27 million fully guaranteed at signing. <strong>Cash flow</strong> measures when dollars are actually paid. It can be front-loaded even when the cap accounting is spread out. <strong>Salary-cap charge</strong> is the amount assigned to one league year under cap rules, not that year’s cash payment or the contract’s AAV." },
      { type: "paragraph", html: "The difference is visible in 2026. Over the Cap lists cap charges of $10.371 million for Smith-Njigba, $6.247 million for Hall and $15.338 million for Witherspoon. Against the $314.1 million league cap reflected in OTC’s percentages, those equal 3.30%, 1.99% and 4.88%. Together they are $31.956 million, or 10.17% of the cap. Their combined new-money AAV is $89.15 million. Comparing the two totals as if they were interchangeable would overstate the present burden by $57.194 million. Williams’ pre-extension 2026 charge was listed at $29.636 million, but a reliable post-extension year-by-year structure was not available at publication, so it is excluded from this calculation." },

      { type: "heading", heading: "The four commitments, and the risk in each" },
      { type: "paragraph", html: "<strong>Smith-Njigba buys the offense a passing-game center.</strong> His 119 receptions and league-leading 1,793 receiving yards in the 2025 regular season demonstrate both volume and efficiency of role, while 10 touchdowns show that the production extended into scoring plays. Those totals do not prove every aspect of receiver play, but the AP Offensive Player of the Year award and first-team All-Pro selection add independent recognition. Brian Fleury, named Seattle’s offensive coordinator in February 2026, can build route combinations around a receiver who wins from multiple alignments rather than searching annually for a true first option. Elite receivers are expensive to acquire and uncertain to draft. Seattle bought ages 26 through 29 as new years, after two lower-cost seasons. The risk is concentration: injury, coverage adaptation or quarterback instability would leave a large future allocation attached to one target. <a href=\"https://www.{team}.com/news/seattle-{team}-finalize-2026-coaching-staff\">Seattle’s 2026 coaching-staff announcement</a> confirms Fleury’s current role." },
      { type: "paragraph", html: "<strong>Hall is a bet on role value before sack totals catch up.</strong> He played 37.2% of defensive snaps in 14 regular-season games, recording two sacks and 13 quarterback hits. The contract is not justified by two sacks alone. Hall sets an edge in the run structure, can rotate with veteran rushers and produced two sacks plus a forced fumble in the Super Bowl. Macdonald’s fronts depend on fresh, interchangeable rushers who can threaten different gaps without announcing the pressure. The deal buys Hall’s age-26 through age-28 seasons at a $14 million new-money AAV, far below the top edge market. The clearest risk is projection: Seattle paid for a larger future role after a season in which Hall’s snap share and headline production fell. Incentives that can lift the value to $46.5 million appropriately separate some upside from the base amount." },
      { type: "paragraph", html: "<strong>Witherspoon preserves the defense’s disguise.</strong> Seattle used nickel or dime personnel at the NFL’s highest rate in 2025 while allowing a league-low 3.7 yards per rush, according to the team’s season review. Witherspoon’s ability to play outside, cover the slot, pressure and tackle lets Macdonald change the call without changing the people. He started all 12 games he played, made second-team All-Pro and added a sack and three quarterback hits in Super Bowl LX. Tackles and interceptions cannot capture coverage responsibility, which is why role and recognition matter alongside his 72 tackles, seven passes defensed and one interception. The extension buys prime ages and keeps him through 31. The risk is durability and physical style: he missed five regular-season games in 2025, and a versatile corner who plays near the line absorbs contact that a boundary-only player can avoid." },
      { type: "paragraph", html: "<strong>Williams is the bridge, not the template.</strong> Interior defenders who can defeat a guard, hold up against the run and create pressure without a blitz are scarce. Williams’ second straight Pro Bowl and 2025 second-team All-Pro selection support the decision better than one box-score total. Seattle’s official account says his 2025 Pro Football Reference approximate value was 17, tied for the team lead, and that he has 22 sacks and 61 quarterback hits in two and a half Seattle seasons. Keeping him also preserves the front that helped Hall and Byron Murphy II operate. Unlike the other deals, this extension covers late-career seasons, ages 33 through 35. The standard is therefore not future growth. It is whether elite current play lasts. Age-related decline and injury are the clearest risks, particularly before the full guarantee schedule and exit points are public." },

      { type: "heading", heading: "What the contracts say about Seattle’s priorities" },
      { type: "paragraph", html: "<strong>1. Pay scarce roles.</strong> A primary receiver, a hybrid cover corner, an edge defender and a disruptive interior lineman influence passing downs. Seattle did not spread the same price across every position. It concentrated resources where replacement in free agency is usually expensive and where Macdonald’s schemes require players to win isolated matchups." },
      { type: "paragraph", html: "<strong>2. Reward drafted players at the first legal opportunity.</strong> NFL rookies cannot renegotiate until after their third season. Seattle extended all three eligible members of its 2023 class in this group rather than using the extra control of first-round fifth-year options as a reason to wait on Smith-Njigba or Witherspoon. Early deals give players security and the club six-season planning windows through 2031. They also bring injury risk forward and set prices before another year of evidence." },
      { type: "paragraph", html: "<strong>3. Maintain defensive continuity around movable pieces.</strong> Witherspoon changes the coverage picture, Williams changes protection rules and Hall supports the rotation. Their value is connected. Keeping all three allows Macdonald to retain the multiplicity that helped Seattle pair light defensive personnel with strong run results in 2025." },
      { type: "paragraph", html: "<strong>4. Protect the championship window without making every deal the same length.</strong> The young stars run through 2031; Hall and Williams run through 2029. That stagger matters. Seattle can keep the current group together for four seasons while avoiding one synchronized decision point. The <a href=\"/team/transactions\">transactions tracker</a> shows the timing, while the <a href=\"/team\">team statistics</a> and <a href=\"/players\">roster and historical player statistics</a> provide the performance baseline. New ownership, described in our <a href=\"/news/nfl-approves-{team}-sale-khosla-family-what-changes/\">ownership transition analysis</a>, may shape future cash budgets, but no reviewed evidence shows it changed these football evaluations." },

      { type: "heading", heading: "How much flexibility remains?" },
      { type: "paragraph", html: "The honest answer is that the extensions preserve short-term room more clearly than they define long-term room. Smith-Njigba and Witherspoon still had 2026 rookie salaries and 2027 fifth-year options available, so Seattle could pay cash now and spread cap recognition into later seasons. Hall’s 2026 cap charge is also well below his $14 million new-money AAV. That layering protects the 2026 roster, but it creates larger scheduled charges when the young deals overlap from 2028 onward." },
      { type: "paragraph", html: "A current cap-space number would be false precision one day after Williams signed. His $90 million value and $56 million reported guarantee do not reveal bonus proration, option dates, incentives or annual salaries. Nor does nominal cap room equal spendable room: Seattle must account for the regular-season roster, practice squad, injury replacements and in-season moves. The defensible conclusion is narrower. The first three structures defer a substantial share of cost beyond 2026; Williams’ structure will determine how much of the existing $29.636 million charge can move and what future years absorb it." },

      { type: "heading", heading: "What this does not tell us" },
      { type: "paragraph", html: "Future league cap growth may make today’s AAVs a smaller percentage of later caps, but the size and timing of that growth are unknown. Seattle can restructure contracts by converting salary to bonus, yet that shifts charges rather than erasing them. Incentives may never be earned, later guarantees may depend on roster dates, and reported guarantee totals can combine full, injury and conditional protection. Injury outcomes and performance aging cannot be priced with certainty. Williams’ detailed structure was not public when this analysis closed, and contract databases can update after agents, clubs or league filings clarify terms." },
      { type: "paragraph", html: "The four deals also say nothing definitive about players whose negotiations have not occurred. A contract through a given season is control, not a promise that the player will remain through it. Release, trade and restructure options depend on the exact year and remaining bonus. This analysis therefore treats contracted-through dates as the current plan, not an irreversible roster." },

      { type: "heading", heading: "Analysis: the next tests" },
      { type: "paragraph", html: "These are roster-planning questions, not reports of active negotiations. <strong>Byron Murphy II</strong> becomes extension-eligible after the 2026 season. His seven regular-season sacks in 2025 and two more in the Super Bowl place another young interior defender directly beside Williams’ late-career deal. Paying Murphy would show whether Seattle intends to sustain premium spending across the whole front or expects the younger player eventually to replace veteran cost." },
      { type: "paragraph", html: "<strong>Nick Emmanwori</strong> and <strong>Grey Zabel</strong> cannot negotiate rookie extensions until after the 2027 season. Emmanwori’s hybrid safety role could test the same versatility premium Seattle paid Witherspoon, while Zabel could test whether the club extends this early-reward approach to the offensive line. Before then, Seattle must decide how much veteran money to carry around its young core, especially at quarterback and along the defensive front. Those choices will reveal whether the four extensions are a repeatable system or a carefully selected response to one championship roster." }
    ],
    sources: [
      { label: "Seattle {Team}: Jaxon Smith-Njigba signs extension (Mar. 25, 2026)", url: "https://www.{team}.com/news/{team}-sign-jaxon-smith-njigba-to-multi-year-extension" },
      { label: "Seattle {Team}: Derick Hall signs three-year extension (June 3, 2026)", url: "https://www.{team}.com/news/{team}-sign-outside-linebacker-derick-hall-to-three-year-extension" },
      { label: "Seattle {Team}: Devon Witherspoon signs four-year extension (Aug. 17, 2026)", url: "https://www.{team}.com/news/{team}-cb-devon-witherspoon-signs-contract-extension" },
      { label: "Seattle {Team}: Leonard Williams signs extension (Aug. 27, 2026)", url: "https://www.{team}.com/news/{team}-sign-foundational-player-leonard-williams-to-multi-year-contract-extension" },
      { label: "NFL.com: Williams reported at three years, $90 million with $56 million guaranteed", url: "https://www.nfl.com/news/{team}-dt-leonard-williams-three-year-90-million-extension" },
      { label: "Over the Cap: Smith-Njigba contract details", url: "https://overthecap.com/player/jaxon-smith-njigba/10844" },
      { label: "Over the Cap: Hall contract details", url: "https://overthecap.com/player/derick-hall/10861" },
      { label: "Over the Cap: Witherspoon contract details", url: "https://overthecap.com/player/devon-witherspoon/10829" },
      { label: "Seattle {Team}: 2025 season honors and personnel context", url: "https://www.{team}.com/news/{team}-2025-season-honors" },
      { label: "Seattle {Team}: 2026 coaching staff", url: "https://www.{team}.com/news/seattle-{team}-finalize-2026-coaching-staff" },
      { label: "{Team} Fan Zone methodology", url: "/methodology" }
    ],
    hero: sharedHero,
    featured: false,
    status: "published"
  },
  {
    slug: "nfl-approves-{team}-sale-khosla-family-what-changes",
    headline: "{Team} sale to Khosla family closes: What changes now and what remains unknown",
    dek: "The Khosla family officially became the {Team}’ controlling ownership group on September 3. Here are the announced roles, commitments and decisions that matter next.",
    publishedAt: "2026-08-28",
    updatedAt: "2026-09-03",
    author: "{Team} Fan Zone Editorial Team",
    category: "Analysis",
    tags: ["Ownership", "Khosla family", "Paul Allen", "Lumen Field", "Analysis"],
    season: 2026,
    opponent: null,
    body: [
      { type: "paragraph", html: "<strong>Material update — September 3, 2026:</strong> The {Team} announced that the transaction officially closed. The Khosla family is now the team’s controlling ownership group. This article retains its original August 28 analysis of the approval stage while updating all present-tense ownership and leadership information." },
      { type: "paragraph", html: "That distinction matters because approval answers who the league will permit to buy the club, while closing transfers the club. It also keeps the immediate football picture in perspective. Seattle is entering a season as the defending champion with an established president of football operations/general manager, John Schneider, and head coach, Mike Macdonald. No public announcement has replaced either executive or reassigned roster authority." },

      { type: "heading", heading: "How Seattle reached this point" },
      { type: "timeline", items: [
        { label: "1997", html: "Paul Allen bought the {Team} from Ken Behring for $194 million after obtaining an option on a franchise Behring had attempted to move. Washington voters approved Referendum 48, enabling the publicly owned stadium project and clearing the way for Allen’s purchase. The result kept the team in the Pacific Northwest and tied its future to the site now called Lumen Field." },
        { label: "2018", html: "Allen died in October. His sister, Jody Allen, became chair of the {Team} and trustee of the Paul G. Allen Trust. The estate continued owning the club rather than beginning an immediate sale." },
        { label: "February 18, 2026", html: "The estate opened a formal sale process, naming Allen & Company and Latham & Watkins as advisers. It said a sale fulfilled Paul Allen’s direction to sell his sports holdings eventually and direct estate proceeds to philanthropy." },
        { label: "July 11, 2026", html: "The estate announced a binding sale agreement with a Khosla family-led group. The parties did not disclose terms. The Associated Press, citing a person familiar with the deal, reported a $9.612 billion price. That number is credible reporting, not an officially confirmed term." },
        { label: "August 26, 2026", html: "NFL owners voted unanimously to approve the purchase. League approval also required the Khoslas to give up their minority interest in the San Francisco 49ers, according to AP reporting." },
        { label: "September 3, 2026", html: "The {Team} announced that the sale officially closed, transferring control from the Paul G. Allen Estate to the Khosla family-led ownership group." }
      ] },

      { type: "heading", heading: "Who will control the team?" },
      { type: "paragraph", html: "The {Team}’ September 3 closing announcement identifies the Khosla family as the controlling ownership group and names Neeru Khosla as Controlling Owner and President of the {Team} Charitable Foundation. That designation makes her the family group’s principal representative under league governance." },
      { type: "paragraph", html: "Vinod Khosla holds the title of Chair. His stated approach has been long-term, centered on learning from existing management and sustaining success. Those statements of intent are not a promise of a particular level of spending or a change to football reporting lines." },
      { type: "paragraph", html: "Neal Khosla holds the title of Vice Chair. The closing announcement does not define his day-to-day portfolio or specific decision rights. Their daughter Nina Khosla attended the league meeting, but no reviewed official source assigned her an ownership, control or operating title. Attendance should not be converted into authority." },

      { type: "heading", heading: "What changes immediately?" },
      { type: "paragraph", html: "With the September 3 closing, ultimate authority over the franchise changed. Ownership can set budgets, appoint senior business and football executives, approve major capital projects and establish the organization’s tolerance for risk. League rules still constrain the club: the salary cap limits player payroll, roster and contract rules govern acquisitions, and many ownership actions require league approval." },
      { type: "paragraph", html: "Ownership is not the same job as choosing the game-day roster. Schneider and Macdonald run football operations within the authority and resources ownership gives them. An owner can change that structure, but there is no evidence the Khoslas have done so. Vinod Khosla’s comment that the family would learn from management points toward continuity at the start. It is not a binding commitment to retain every executive." },
      { type: "paragraph", html: "<strong>Analysis:</strong> Immediate owner influence is usually clearest in areas fans do not see on Sundays: reporting lines, hiring authority, facilities, analytics and medical resources, business staffing, and the willingness to guarantee cash in contracts. The cap prevents a wealthy owner from simply purchasing an unlimited roster. That is why personal-wealth estimates say little about future football spending. The revealing evidence will be organizational decisions, not a valuation headline or a celebratory news conference." },

      { type: "heading", heading: "Lumen Field: a commitment to the brand, not yet a stadium plan" },
      { type: "paragraph", html: "Lumen Field is publicly owned by the Washington State Public Stadium Authority and operated under a master-lease structure involving First & Goal. The {Team}’ lease runs through 2032 and includes three 10-year extension options, according to the NFL and AP. Those options create a possible long runway in the current building, but an option is not the same as a decision to exercise it." },
      { type: "paragraph", html: "After the approval vote, Vinod Khosla called Lumen Field <a href=\"https://www.nfl.com/news/nfl-owners-approve-sale-seattle-{team}-khosla-family\">“iconic and very much a part of the {Team}’ brand”</a>. He also said the group needed to learn and would work with management and the Seattle community. That is meaningful evidence against treating relocation or replacement as an announced plan. It is still symbolic language rather than a commitment to extend the lease, renovate the stadium or fund a replacement." },
      { type: "paragraph", html: "There is already a public maintenance framework. In 2026 the stadium authority considered a 2026-2030 major maintenance and modernization plan under the existing lease. Routine modernization should not be confused with a new Khosla ownership initiative. No reviewed source identifies an approved Khosla renovation package, replacement site, financing request or lease extension. Any major stadium project would involve the public owner, lease negotiations, financing, permits and community scrutiny. The first concrete signals will be formal studies, capital commitments or negotiations, not broad praise for the venue." },

      { type: "heading", heading: "Paul Allen’s legacy and the sale proceeds" },
      { type: "paragraph", html: "Allen’s ownership cannot be reduced to the appreciation from $194 million to a reported $9.612 billion. His 1997 intervention stopped a relocation attempt, and the stadium campaign anchored the franchise in Seattle. During the Allen years, the {Team} reached four Super Bowls and won two, while the organization developed the stadium, training complex and a durable football operation. Jody Allen and the trust then held the club for nearly eight years after his death, including the 2025 championship season." },
      { type: "paragraph", html: "The estate says Paul Allen directed that his sports holdings eventually be sold and that all estate proceeds go to philanthropy. That establishes the destination in broad terms, not the timing, recipient organizations or allocation of the {Team} proceeds. The official announcement did not publish those details, and the reported sale price should not be treated as the net charitable amount. Transaction costs, obligations and the estate’s process can affect what is ultimately distributed." },

      { type: "factbox", heading: "The transaction at a glance", known: [
        "NFL owners unanimously approved the purchase on August 26, and the {Team} announced the transaction closed on September 3.",
        "The Khosla family is the controlling ownership group. Vinod Khosla is Chair, Neeru Khosla is Controlling Owner and President of the {Team} Charitable Foundation, and Neal Khosla is Vice Chair.",
        "The official parties did not disclose the price. AP and ESPN reported $9.612 billion.",
        "The existing Lumen Field lease runs through 2032 with three 10-year options."
      ], unknown: [
        "Final ownership percentages for the Khosla family and the announced co-owners.",
        "Neal Khosla’s day-to-day operating responsibilities, and any formal role for Nina Khosla.",
        "Whether the group will exercise a lease option, pursue major renovations or study another stadium plan.",
        "Which philanthropic recipients will receive proceeds, in what amounts and on what schedule."
      ], milestone: "The next measurable milestones are the ownership group’s announced decisions on executive structure, stadium planning, community investment and the fan experience." },

      { type: "heading", heading: "What to watch during the first year" },
      { type: "watchlist", items: [
        { label: "1. Executive structure", html: "Look for filed or announced changes to the president, general manager, head coach or senior business leadership, plus details of Vice Chair Neal Khosla’s operating portfolio. No change is itself measurable evidence of continuity." },
        { label: "2. Football operations", html: "Track reporting lines, contract extensions for decision-makers and investments in scouting, analytics, sports science and facilities. These reveal owner priorities more clearly than public predictions about play-calling or personnel." },
        { label: "3. Stadium action", html: "Watch for an exercised lease option, a commissioned study, a capital plan agreed with the Public Stadium Authority or a public financing proposal. Each is more concrete than general comments about preserving Lumen Field." },
        { label: "4. Community commitments", html: "Measure new or renewed programs by published funding, duration, geographic reach and accountable partners. “Engagement” becomes operational only when the club attaches resources and goals." },
        { label: "5. Fan economics and experience", html: "Compare season-ticket and concession pricing, service policies, stadium technology and game-day changes with the prior season. Do not assume a record purchase price automatically produces higher prices or immediate upgrades." }
      ] },
      { type: "paragraph", html: "<strong>Analysis:</strong> The first year will test a simple divide. Stewardship language describes how the family wants to be understood. Choices about people, authority, facilities, community money and the fan experience will show how it intends to own the {Team}. Until those choices arrive, continuity is the most supportable expectation, not a guarantee." }
    ],
    sources: [
      { label: "Seattle {Team}: Sale to the Khosla family is complete (Sept. 3, 2026)", url: "https://www.{team}.com/news/seattle-{team}-sale-to-the-khosla-family-is-complete" },
      { label: "Seattle {Team}: NFL owners approve sale (Aug. 26, 2026)", url: "https://www.{team}.com/news/nfl-owners-approve-sale-of-{team}-to-khosla-family" },
      { label: "Seattle {Team}: Estate reaches sale agreement (July 11, 2026)", url: "https://www.{team}.com/news/estate-of-paul-g-allen-reaches-agreement-to-sell-seattle-{team}" },
      { label: "Seattle {Team}: Estate begins sale process (Feb. 18, 2026)", url: "https://www.{team}.com/news/estate-of-paul-g-allen-begins-sale-process-for-seattle-{team}" },
      { label: "NFL.com: Owners approve sale to Khosla family", url: "https://www.nfl.com/news/nfl-owners-approve-sale-seattle-{team}-khosla-family" },
      { label: "Associated Press: Khosla family agrees to purchase {Team}", url: "https://apnews.com/article/{team}-sold-0f721adeec4cc06b0093b552b858785d" },
      { label: "Associated Press: Allen estate begins {Team} sale", url: "https://apnews.com/article/seattle-{team}-sale-de44677992a36b2bb4d8d354342a8f6b" },
      { label: "NBC Sports: NFL memo identifies Khosla ownership roles", url: "https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/vinod-khoslas-wife-neeru-will-be-controlling-owner-of-{team}" },
      { label: "Axios Seattle: Approval leaves formal closing ahead", url: "https://www.axios.com/local/seattle/2026/08/27/{team}-sale-khosla-family-9-billion-allen-ownership" },
      { label: "Washington State Public Stadium Authority", url: "https://stadium.org/" },
      { label: "Lumen Field lease summary", url: "https://law.marquette.edu/assets/sports-law/pdf/Seattle%20{Team}%20Lease%20Summary.pdf" },
      { label: "{Team} Fan Zone history", url: "/history" },
      { label: "About {Team} Fan Zone", url: "/about" },
      { label: "{Team} Fan Zone methodology", url: "/methodology" }
    ],
    hero: {
      src: "/images/news/ownership-transition.svg",
      alt: "Abstract illustration of a football changing hands above the Seattle skyline and stadium arches",
      width: 1200,
      height: 675
    },
    featured: false,
    status: "published"
  },
  {
    slug: "welcome-to-the-{team}-fan-zone-newsroom",
    headline: "Welcome to the {Team} Fan Zone newsroom",
    dek: "A new home for original {Team} reporting, roster context, game-week analysis and accountable sourcing.",
    publishedAt: "2026-08-28",
    updatedAt: "2026-08-28",
    author: "{Team} Fan Zone Editorial Team",
    category: "News",
    tags: ["Newsroom", "Editorial standards", "The 12s"],
    season: 2026,
    opponent: null,
    body: [
      "{Team} Fan Zone is expanding beyond schedules and stat tables. This newsroom is built to connect the news of the day to the questions Seattle fans ask next: what a move means for the depth chart, where a performance fits statistically and how a result changes the road ahead.",
      "Every story here will be dated, attributed and written in original language. When reporting begins with information from another outlet or an official announcement, the story will link to that source and clearly separate reported facts from our analysis.",
      "The goal is useful context, not volume for its own sake. Roster stories should explain role and competition. Game-week coverage should connect opponent tendencies to Seattle's personnel. Analysis should show its work and avoid presenting a hunch as a fact.",
      "Readers can browse published work by category, search the archive or subscribe to the RSS feed. Category pages without published coverage are excluded from search indexing until they contain a substantive story.",
    ],
    sources: [
      { label: "{Team} Fan Zone methodology", url: "/methodology" },
      { label: "Corrections and feedback", url: "/contact#corrections" },
    ],
    hero: sharedHero,
    featured: true,
    contentKind: "publication-info",
    status: "published",
  },
  {
    slug: "how-we-add-context-to-{team}-roster-moves",
    headline: "How we will evaluate {Team} roster moves",
    dek: "The transaction is only the beginning: role, replacement value, cap timing and schedule fit turn a move into a useful story.",
    publishedAt: "2026-08-28",
    updatedAt: "2026-08-28",
    author: "{Team} Fan Zone Editorial Team",
    category: "Roster",
    tags: ["Roster", "Depth chart", "Analysis"],
    season: 2026,
    opponent: null,
    body: [
      "A name entering or leaving the roster is a fact. Its football meaning depends on much more: the snaps available at that position, the skills already represented in the room and the alternatives Seattle can use on game day.",
      "Our roster coverage will start with the player's likely role. We will look at recent participation and production when reliable data is available, while noting that raw totals can reflect opportunity as much as performance. A reserve who plays special teams may affect the active roster differently from a specialist signed for a narrow package.",
      "Timing matters, too. A preseason move can be about evaluation or injury coverage; an in-season move can answer an immediate matchup problem. We will connect those decisions to the schedule without claiming certainty about plans the team has not announced.",
      "That approach also means being comfortable with an incomplete answer. If contract terms, injury details or a corresponding move are not public, the story will say so and update only when new information materially changes the picture.",
    ],
    sources: [
      { label: "{Team} Fan Zone roster", url: "/players" },
      { label: "{Team} Fan Zone methodology", url: "/methodology" },
    ],
    hero: sharedHero,
    featured: false,
    contentKind: "publication-info",
    status: "published",
  },
  {
    slug: "a-better-way-to-read-{team}-game-week",
    headline: "A better way to read {Team} game week",
    dek: "Opponent, availability, recent form and schedule pressure belong in the same preview—not in isolated boxes.",
    publishedAt: "2026-08-28",
    updatedAt: "2026-08-28",
    author: "{Team} Fan Zone Editorial Team",
    category: "Game Week",
    tags: ["Game Week", "Schedule", "Matchups"],
    season: 2026,
    opponent: null,
    body: [
      "Game-week coverage works best when it narrows a full week of information into a few questions that can decide Sunday. That requires more than repeating records or listing injury designations.",
      "Our previews will identify the matchup behind the matchup. That may be protection against a pressure front, tackling against yards after contact or Seattle's ability to create favorable down-and-distance situations. The specific question will change with the opponent and available personnel.",
      "We will use recent statistics as context rather than prediction. A small sample can describe what happened without proving what will happen next. When personnel, opponent strength or game state changes the meaning of a number, the preview should explain that limitation.",
      "Finally, each preview will place the game on the schedule. Travel, rest and the NFC West race can change the stakes, but they do not predetermine the result. The aim is to help the 12s watch with a sharper lens and return afterward to see which questions actually mattered.",
    ],
    sources: [
      { label: "{Team} Fan Zone schedule", url: "/schedule" },
      { label: "{Team} Fan Zone standings", url: "/standings" },
    ],
    hero: sharedHero,
    featured: false,
    contentKind: "publication-info",
    status: "published",
  },
];

const validDate = (value: string) => Number.isFinite(new Date(value).getTime());
const internalBodyLanguage = /\b(?:repository|checkout|source tree|generated (?:file|files)|artifacts?|runtime|(?:data )?ingestion|developer environment|development environment|provider tier|implementation state|build system|build pipeline)\b|src\/data\//i;
const bodyText = (block: ArticleBodyBlock) => {
  if (typeof block === "string") return block;
  if (block.type === "heading") return block.heading;
  if (block.type === "paragraph") return block.html;
  if (block.type === "table") return [block.caption, block.note, ...block.columns, ...block.rows.flatMap((row) => row.cells)].join(" ");
  if (block.type === "timeline" || block.type === "watchlist") return block.items.map((item) => `${item.label} ${item.html}`).join(" ");
  return [block.heading, ...block.known, ...block.unknown, block.milestone].join(" ");
};
const slugs = new Set<string>();
for (const article of articles) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug) || slugs.has(article.slug)) throw new Error(`Invalid or duplicate news slug: ${article.slug}`);
  if (!NEWS_CATEGORIES.includes(article.category) || !validDate(article.publishedAt) || !validDate(article.updatedAt)) throw new Error(`Invalid news metadata: ${article.slug}`);
  if (new Date(article.updatedAt) < new Date(article.publishedAt)) throw new Error(`updatedAt precedes publishedAt: ${article.slug}`);
  if (article.status === "published" && article.body.some((block) => internalBodyLanguage.test(bodyText(block)))) throw new Error(`Published article contains internal implementation language: ${article.slug}`);
  slugs.add(article.slug);
}

export const authoredArticles = articles;
const generatedArticles = validateGeneratedCollection(generatedNews).articles;
export const publishedArticles: NewsArticle[] = mergePublishedArticles(articles, generatedArticles);
export const coverageArticles = publishedArticles.filter((article) => article.contentKind !== "publication-info");
export const leadArticle = coverageArticles[0];

export const NEWS_PAGE_SIZE = 6;
export const populatedNewsCategories = NEWS_CATEGORIES.filter((category) => coverageArticles.some((article) => article.category === category));
export const categorySlug = (category: NewsCategory) => category.toLowerCase().replaceAll(" ", "-");
export const formatArticleDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
export const materiallyUpdated = (article: NewsArticle) => new Date(article.updatedAt).getTime() - new Date(article.publishedAt).getTime() >= 60 * 60 * 1000;
export const articleReadingMinutes = (article: NewsArticle) => {
  const text = article.body.map((block) => {
    if (typeof block === "string") return block;
    if (block.type === "heading") return block.heading;
    if (block.type === "paragraph") return block.html;
    if (block.type === "table") return [block.caption, block.note, ...block.rows.flatMap((row) => row.cells)].join(" ");
    if (block.type === "timeline" || block.type === "watchlist") return block.items.map((item) => `${item.label} ${item.html}`).join(" ");
    return [block.heading, ...block.known, ...block.unknown, block.milestone].join(" ");
  }).join(" ").replace(/<[^>]*>/g, " ").replace(/&[a-z0-9#]+;/gi, " ");
  return Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 225));
};
