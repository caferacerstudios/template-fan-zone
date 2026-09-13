import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, renderText, teamSettings } from './render.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const identities = {
  seahawks: ['Seattle', 'Seattle Seahawks'],
  broncos: ['Denver', 'Denver Broncos'],
  packers: ['Green Bay', 'Green Bay Packers'],
  vikings: ['Minnesota', 'Minnesota Vikings'],
  chiefs: ['Kansas City', 'Kansas City Chiefs'],
  patriots: ['New England', 'New England Patriots'],
};
const slugs = Object.keys(identities);
const historyPath = slug => path.join(root, 'src/data/history', `${slug}.json`);

async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'fanzone-history-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  for (const directory of ['template-tools', 'src/data/history', 'src/pages']) {
    await mkdir(path.join(source, directory), { recursive: true });
  }
  await writeFile(path.join(source, 'template-tools/files.json'), '[]');
  await writeFile(path.join(source, 'template-tools/upstream-package.json'), '{"name":"{team}fanzone"}');
  await copyFile(path.join(root, 'src/pages/history.astro'), path.join(source, 'src/pages/history.astro'));
  await copyFile(path.join(root, 'src/data/history-timeline.json'), path.join(source, 'src/data/history-timeline.json'));
  for (const slug of slugs) await copyFile(historyPath(slug), path.join(source, 'src/data/history', `${slug}.json`));
  return { source, temp };
}

test('every configured history has the intended franchise identity and explicit source labels', async () => {
  const trusted = new Set(['www.profootballhof.com', 'www.seahawks.com', 'www.historylink.org', 'www.lumenfield.com',
    'www.denverbroncos.com', 'www.packers.com', 'www.vikings.com', 'www.chiefs.com', 'www.nfl.com', 'www.patriots.com', 'www.patriotshalloffame.com']);
  for (const [slug, [city, fullName]] of Object.entries(identities)) {
    const history = JSON.parse(await readFile(historyPath(slug), 'utf8'));
    assert.equal(history.team, slug);
    assert.equal(history.city, city);
    assert.equal(history.fullName, fullName);
    assert.ok(history.metaTitle.includes(fullName), `${slug}: SEO title must identify its team`);
    assert.ok(history.metaDescription.includes(fullName), `${slug}: SEO description must identify its team`);
    assert.ok(history.heroKicker.includes(city), `${slug}: hero must identify its city or region`);
    assert.ok(history.timeline.length >= 8, `${slug}: history needs its own timeline`);
    assert.ok(history.eras.length > 0 && history.numbers.length > 0 && history.players.length > 0);
    for (const entry of [...history.timeline, ...history.eras, ...history.numbers]) {
      const url = new URL(entry.sourceUrl);
      assert.equal(url.protocol, 'https:', `${slug}: source must use HTTPS`);
      assert.ok(trusted.has(url.hostname), `${slug}: unexpected source ${url.hostname}`);
      assert.ok(entry.sourceName?.trim(), `${slug}: each citation needs an explicit label`);
    }
    assert.equal(new URL(history.playerSource.url).protocol, 'https:');
    assert.doesNotMatch(JSON.stringify(history), /\{(?:team|Team|TEAM|Location|LOCATION)\}/, `${slug}: historical data is authored literally`);
  }
});

test('Seattle migration preserves every existing timeline fact and citation', async () => {
  const baseline = JSON.parse(renderText(await readFile(path.join(root, 'src/data/history-timeline.json'), 'utf8'), teamSettings('seahawks')));
  const seattle = JSON.parse(await readFile(historyPath('seahawks'), 'utf8'));
  assert.deepEqual(seattle.timeline.map(({ sourceName, ...entry }) => entry), baseline);
  assert.equal(seattle.heroArtwork, 'seattle');
});

test('all configured rendered projects contain only their selected literal history and resolve the shared page import', async t => {
  const { source, temp } = await fixture(t);
  for (const slug of slugs) {
    const target = path.join(temp, slug);
    await renderProject(source, target, teamSettings(slug), { linkDependencies: false });
    assert.deepEqual(await readdir(path.join(target, 'src/data/history')), [`${slug}.json`]);
    assert.deepEqual(await readFile(path.join(target, 'src/data/history', `${slug}.json`)), await readFile(historyPath(slug)), `${slug}: content and source URLs must not be rewritten`);
    const page = await readFile(path.join(target, 'src/pages/history.astro'), 'utf8');
    assert.ok(page.includes(`import history from "../data/history/${slug}.json"`));
    await assert.rejects(readFile(path.join(target, 'src/data/history-timeline.json')), { code: 'ENOENT' });
  }
});

test('history text is not a replacement template, including literal tokens and original source URLs', async t => {
  const { source, temp } = await fixture(t);
  const filename = path.join(source, 'src/data/history/broncos.json');
  const data = JSON.parse(await readFile(filename, 'utf8'));
  data.timeline[0].description = 'Editorial fixture: Seattle {Team}, {team}, {Location}, and #70c934 remain literal.';
  data.timeline[0].sourceUrl = 'https://www.seahawks.com/news/literal-{team}-reference';
  data.timeline[0].sourceName = 'Seattle Seahawks';
  const original = JSON.stringify(data, null, 2) + '\n';
  await writeFile(filename, original);
  const target = path.join(temp, 'broncos');
  await renderProject(source, target, teamSettings('broncos'), { linkDependencies: false });
  assert.equal(await readFile(path.join(target, 'src/data/history/broncos.json'), 'utf8'), original);
  assert.equal(await readFile(filename, 'utf8'), original);
});

test('missing or mismatched team history fails before any project is rendered', async t => {
  const { source, temp } = await fixture(t);
  const missingTarget = path.join(temp, 'bills');
  await assert.rejects(renderProject(source, missingTarget, teamSettings('bills'), { linkDependencies: false }), /Add sourced history for TEAM=bills/);
  await assert.rejects(readdir(missingTarget), { code: 'ENOENT' });
  const filename = path.join(source, 'src/data/history/packers.json');
  const data = JSON.parse(await readFile(filename, 'utf8'));
  data.team = 'seahawks';
  await writeFile(filename, JSON.stringify(data));
  const mismatchTarget = path.join(temp, 'packers');
  await assert.rejects(renderProject(source, mismatchTarget, teamSettings('packers'), { linkDependencies: false }), /History team does not match TEAM=packers/);
  await assert.rejects(readdir(mismatchTarget), { code: 'ENOENT' });
});
