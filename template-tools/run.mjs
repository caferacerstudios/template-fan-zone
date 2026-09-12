import { mkdir, rm, cp, readFile, access, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, teamSettings } from './render.mjs';
import { loadEventSpySite, prepareEventSpy } from './eventspy.mjs';
import { loadNflSite, selectNflSnapshot, prepareNflSnapshot, prepareRecaps } from './nfl.mjs';
import { loadNewsSite, retainNews, restoreNews, prepareNews } from './news.mjs';
import { prepareRoster } from './roster.mjs';
import { loadBuildSettings } from './build-settings.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const command = args.shift();
const renderOnly = command === '--render-only';
const isBuild = ['build', 'build:offline', 'build:production-offline', 'test'].includes(command);
const workRoot = path.join(root, '.team-build');

try {
  await loadBuildSettings(root);
  const team = teamSettings(process.env.TEAM);
  const newsSite = loadNewsSite(root, team.slug);
  const ticketSite = loadEventSpySite(root, team.slug);
  const nflSite = loadNflSite(root, team.slug);
  team.division = nflSite.division;
  team.abbreviation = ticketSite.abbreviation;
  team.name = newsSite.name;
  team.upper = newsSite.name.toUpperCase();
  team.location = newsSite.city;
  const upstream = JSON.parse(await readFile(path.join(root, 'template-tools/upstream-package.json'), 'utf8'));
  if (!renderOnly && !Object.hasOwn(upstream.scripts, command)) throw new Error(`Unknown upstream command: ${command}`);
  await mkdir(workRoot, { recursive: true });
  const target = path.join(workRoot, team.slug);
  // Every build starts from the template so neither old team content nor stale
  // Astro output survives. Sources outside .team-build are never rewritten.
  if (command === 'preview') {
    try { await access(path.join(target, 'dist/index.html')); }
    catch { throw new Error(`Build ${team.name} first with TEAM=${team.slug} npm run build.`); }
  } else if (isBuild || renderOnly || command === 'dev' || !existsSync(path.join(target, '.template-team.json'))) {
    const retained = retainNews(target, newsSite);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    const count = await renderProject(root, target, team, { newsSite });
    restoreNews(target, retained);
    console.log(`Rendered ${count} template files for ${team.name}: ${path.relative(root, target)}`);
  }
  if (isBuild || renderOnly || command === 'dev') {
    const selected = await selectNflSnapshot(target, nflSite);
    await prepareEventSpy(root, target, ticketSite, selected?.schedule);
    await prepareNflSnapshot(target, nflSite, selected);
    await prepareRecaps(target, nflSite);
    // EventSpy clears legacy ancillary files; NFL imports historical statistics.
    // Apply authoritative current membership and sourced updates after both.
    await prepareRoster(target, nflSite);
  }
  if (isBuild || command === 'dev') prepareNews(target, newsSite);
  console.log(`Theme: ${team.theme.key}. News, NFL data, recaps and tickets are selected by team.`);

  if (!renderOnly) {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', command, ...(args.length ? ['--', ...args] : [])], {
      cwd: target, env: { ...process.env, NFL_SNAPSHOT_DIR: process.env.NFL_SNAPSHOT_DIR || nflSite.nfl_snapshot_dir, RECAP_SNAPSHOT_DIR: process.env.RECAP_SNAPSHOT_DIR || nflSite.recap_snapshot_dir, ASTRO_TELEMETRY_DISABLED: '1' }, stdio: ['inherit', 'pipe', 'pipe'],
    });
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    const signals = ['SIGINT', 'SIGTERM'];
    const handlers = signals.map((signal) => { const handler = () => child.kill(signal); process.on(signal, handler); return handler; });
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (status, signal) => resolve(status ?? (signal === 'SIGINT' ? 130 : 143)));
      });
    } finally { signals.forEach((signal, index) => process.off(signal, handlers[index])); }
    if (code !== 0) throw new Error(`${command} failed with exit code ${code}; no build was published to dist.`);
    if (isBuild && process.env.FANZONE_STAGE_ONLY === '1') {
      await access(path.join(target, 'dist/index.html'));
      writeFileSync(path.join(workRoot, 'staged-build.json'), JSON.stringify({ team: team.slug, command, builtAt: new Date().toISOString(), output: path.relative(root, path.join(target, 'dist')) }, null, 2) + '\n');
      console.log(`Staged build complete: ${path.relative(root, path.join(target, 'dist'))}; dist/ was not replaced.`);
    } else if (isBuild) {
      const published = path.join(root, 'dist');
      const staging = path.join(workRoot, `.publish-${randomUUID()}`);
      const previous = path.join(workRoot, `.previous-${randomUUID()}`);
      let movedPrevious = false;
      try {
        await cp(path.join(target, 'dist'), staging, { recursive: true });
        await access(path.join(staging, 'index.html'));
        if (existsSync(published)) { await rename(published, previous); movedPrevious = true; }
        try { await rename(staging, published); }
        catch (error) { if (movedPrevious) await rename(previous, published); throw error; }
      } finally { await rm(staging, { recursive: true, force: true }); }
      await rm(previous, { recursive: true, force: true }).catch(error => console.warn(`Build published; previous output retained at ${previous}: ${error.message}`));
      writeFileSync(path.join(workRoot, 'last-build.json'), JSON.stringify({ team: team.slug, command, builtAt: new Date().toISOString() }, null, 2) + '\n');
      console.log(`Build complete: dist/ (${team.name})`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
