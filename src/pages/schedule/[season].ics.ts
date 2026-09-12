import type { APIRoute, GetStaticPaths } from "astro";
import rawScheduleData from "../../data/nfl/{team}.json";
import { selectScheduleSeason } from "../../lib/schedule.mjs";
import { seasonCalendar } from "../../lib/game-day.mjs";

export const getStaticPaths: GetStaticPaths = () => {
  const root: any = rawScheduleData;
  const seasons = Array.isArray(root?.seasons) ? root.seasons : [root];
  return seasons.filter((entry) => entry?.season).map((entry) => ({ params: { season: String(entry.season) } }));
};

export const GET: APIRoute = ({ params, site, url }) => {
  const schedule = selectScheduleSeason(rawScheduleData, params.season);
  const calendar = seasonCalendar(schedule, site ?? url);
  return new Response(calendar.content, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${calendar.filename}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
};
