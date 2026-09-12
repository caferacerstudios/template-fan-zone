import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const write = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n');
const directoryKeys = ['nfl_snapshot_dir', 'recap_snapshot_dir'];

export function loadNflSite(root, slug, filename = process.env.ACTIVE_SITES_FILE || path.join(root, 'config/active-sites.json')) {
  const document = read(filename);
  const value = document.fan_zone_active_sites ?? document;
  const sites = typeof value === 'string' ? JSON.parse(value) : value;
  const selected = sites[slug];
  if (!selected || !/^[A-Z]{2,3}$/.test(selected.abbreviation ?? '')) throw new Error(`Missing NFL site identity for ${slug}.`);
  for (const key of directoryKeys) {
    const directory = selected[key];
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory || path.basename(directory) !== 'current') throw new Error(`${slug}.${key} must be an absolute current snapshot directory.`);
    for (const [otherSlug, other] of Object.entries(sites)) {
      if (otherSlug !== slug && other?.[key] === directory) throw new Error(`${slug} and ${otherSlug} must not share ${key}.`);
    }
  }
  return { ...selected, slug };
}

function importer(destination, name) {
  return import(pathToFileURL(path.join(destination, 'scripts', name)).href);
}

export async function selectNflSnapshot(destination, site) {
  // A rendered template can contain legacy Seattle seed recaps. They are never
  // merged into another team's collection, even when a game ID is shared.
  const recapFile = path.join(destination, 'src/data/nfl/gameRecaps.json');
  if (site.slug !== 'seahawks' && fs.existsSync(recapFile)) {
    const existing = read(recapFile);
    if (existing.team !== site.slug) write(recapFile, { team: site.slug, recaps: {} });
  }
  const snapshotDir = process.env.NFL_SNAPSHOT_DIR || site.nfl_snapshot_dir;
  if (!fs.existsSync(snapshotDir)) {
    if (site.slug === 'seahawks' && !fs.existsSync(path.dirname(snapshotDir))) {
      console.warn(`NFL (${site.slug}): snapshot mount unavailable; using the existing Seattle schedule.`);
      return null;
    }
    throw new Error(`Missing ${site.city} ${site.name} NFL snapshot at ${snapshotDir}. Run refresh_nfl_snapshot_${site.slug} in sfz_nfl_refresh, then build again with this team's NFL directory mounted read-only.`);
  }
  const { importNflSnapshot } = await importer(destination, 'import-nfl-snapshot.mjs');
  const selected = importNflSnapshot({ projectRoot: destination, snapshotDir, expectedTeam: site.slug, expectedAbbreviation: site.abbreviation, expectedTeamId: site.balldontlie_team_id ?? null, checkOnly: true });
  // Pin the immutable collection used during validation, not the mutable symlink.
  return { ...selected, schedule: read(path.join(selected.snapshotDir, `${site.slug}.json`)) };
}

export async function prepareNflSnapshot(destination, site, selected) {
  if (!selected) return null;
  const { importNflSnapshot } = await importer(destination, 'import-nfl-snapshot.mjs');
  const result = importNflSnapshot({ projectRoot: destination, snapshotDir: selected.snapshotDir, expectedTeam: site.slug, expectedAbbreviation: site.abbreviation, expectedTeamId: site.balldontlie_team_id ?? null });
  const schedule = read(path.join(destination, `src/data/nfl/${site.slug}.json`));
  // Preserve the separately maintained official Seattle roster. For new teams,
  // consume only currentRoster, never players from a prior statistics season.
  if (site.slug !== 'seahawks') {
    const players = (Array.isArray(schedule.currentRoster) ? schedule.currentRoster : []).map(row => ({ ...row, id: String(row.id ?? row.player?.id ?? ''), name: row.name ?? row.full_name ?? row.player?.full_name ?? '', position: row.position ?? row.position_abbreviation ?? row.player?.position_abbreviation ?? '', number: row.number ?? row.jersey_number ?? '—', status: row.status ?? 'Unconfirmed' })).filter(row => row.id && row.name);
    write(path.join(destination, 'src/data/team/roster.json'), { schemaVersion: 1, team: site.slug, season: schedule.season, asOf: schedule.rosterUpdatedAt ?? schedule.updatedAt, sourceUrl: schedule.rosterSourceUrl ?? 'https://nfl.balldontlie.io/', sourcePublisher: schedule.rosterSourcePublisher ?? 'balldontlie', sourceNote: players.length ? 'Current roster entries supplied with the team NFL snapshot; historical statistics are separate.' : 'Current roster data is not available in this team snapshot yet.', players });
  }
  console.log(`NFL (${site.slug}): schedule, player statistics and standings imported for ${result.season}.`);
  return result;
}

export async function prepareRecaps(destination, site) {
  const snapshotDir = process.env.RECAP_SNAPSHOT_DIR || site.recap_snapshot_dir;
  if (!fs.existsSync(snapshotDir)) {
    if (fs.lstatSync(snapshotDir, { throwIfNoEntry: false })) throw new Error(`Recap snapshot link is broken at ${snapshotDir}; restore its immutable collection before building.`);
    // New teams have no recap snapshot until their first recap task. Preserve
    // legacy Seattle articles; new teams start with an explicitly empty map.
    if (site.slug !== 'seahawks') write(path.join(destination, 'src/data/nfl/gameRecaps.json'), { team: site.slug, recaps: {} });
    console.log(`Recaps (${site.slug}): no snapshot yet at ${snapshotDir}; ${site.slug === 'seahawks' ? 'existing Seattle recaps retained' : 'no recaps published'}.`);
    return { status: 'unavailable' };
  }
  const { importRecapSnapshot } = await importer(destination, 'import-recap-snapshot.mjs');
  return importRecapSnapshot({ projectRoot: destination, snapshotDir, expectedTeam: site.slug, expectedAbbreviation: site.abbreviation });
}
