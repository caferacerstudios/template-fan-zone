import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function rosterSnapshotDirectory(site) {
  const news = site.news_snapshot_dir;
  if (typeof news !== 'string' || !path.isAbsolute(news) || path.normalize(news) !== news || !news.endsWith('-news/current')) throw new Error(`${site.slug}.news_snapshot_dir must end in -news/current to select its roster snapshot.`);
  return news.replace(/-news\/current$/, '-roster/current');
}

export async function prepareRoster(destination, site) {
  const snapshotDir = process.env.ROSTER_SNAPSHOT_DIR || rosterSnapshotDirectory(site);
  if (!fs.existsSync(snapshotDir)) {
    if (fs.lstatSync(snapshotDir, { throwIfNoEntry: false })) throw new Error(`Roster snapshot link is broken at ${snapshotDir}; restore its immutable collection before building.`);
    if (site.slug !== 'seahawks') {
      const directory = path.join(destination, 'src/data/team');
      const roster = JSON.parse(fs.readFileSync(path.join(directory, 'roster.json'), 'utf8'));
      for (const [name, schema, rows] of [['roster', 1, 'players'], ['injuries', 2, 'records'], ['transactions', 1, 'records']]) {
        fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ schemaVersion: schema, team: site.slug, season: roster.season, asOf: null, sourceUrl: null, sourcePublisher: null,
          sourceNote: `No ${site.city} ${site.name} ${name} snapshot has been published yet.`, [rows]: [] }, null, 2) + '\n');
      }
      for (const name of [`${site.slug}.json`, 'players.json']) {
        const file = path.join(destination, 'src/data/nfl', name);
        if (!fs.existsSync(file)) continue;
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, JSON.stringify({ ...data, currentRoster: [], currentRosterAvailable: false, rosterUpdatedAt: null, rosterSourceNote: 'No official roster snapshot has been published yet.' }, null, 2) + '\n');
      }
    }
    console.log(`Roster (${site.slug}): no snapshot yet at ${snapshotDir}; ${site.slug === 'seahawks' ? 'existing Seattle roster and updates retained' : 'roster and update sections remain empty'}.`);
    return { status: 'unavailable', snapshotDir };
  }
  const { importRosterSnapshot } = await import(pathToFileURL(path.join(destination, 'scripts/import-roster-snapshot.mjs')).href);
  return importRosterSnapshot({ projectRoot: destination, snapshotDir, expectedTeam: site.slug, expectedAbbreviation: site.abbreviation });
}
