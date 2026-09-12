import { mkdir, rm, cp, readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, teamSettings } from './render.mjs';
import { loadNewsSite, retainNews, restoreNews, prepareNews } from './news.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const command = args.shift();
const renderOnly = command === '--render-only';
const isBuild = ['build', 'build:offline', 'build:production-offline', 'test'].includes(command);
const workRoot = path.join(root, '.team-build');

try {
  const team = teamSettings(process.env.TEAM);
  const newsSite = loadNewsSite(root, team.slug);
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
  if (isBuild || command === 'dev') prepareNews(target, newsSite);
  console.log(`Theme: ${team.theme.key}. News is selected by team. Other NFL data still comes from the original copy.`);

  if (!renderOnly) {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', command, ...(args.length ? ['--', ...args] : [])], {
      cwd: target, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' }, stdio: ['inherit', 'pipe', 'pipe'],
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
    if (isBuild) {
      await rm(path.join(root, 'dist'), { recursive: true, force: true });
      await cp(path.join(target, 'dist'), path.join(root, 'dist'), { recursive: true });
      writeFileSync(path.join(workRoot, 'last-build.json'), JSON.stringify({ team: team.slug, command, builtAt: new Date().toISOString() }, null, 2) + '\n');
      console.log(`Build complete: dist/ (${team.name})`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
