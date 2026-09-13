import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderText, renderProject, teamSettings } from './render.mjs';
import { renderThemeCss, renderThemeStyles } from './themes.mjs';

test('one team value preserves display, slug and uppercase spelling', () => {
  assert.equal(renderText('{Team} Fan Zone /{team}/ {TEAM} {team}Score', teamSettings('broncos')), 'Broncos Fan Zone /broncos/ BRONCOS broncosScore');
  assert.equal(renderText('{Team} {team}', teamSettings(' PATRIOTS ')), 'Patriots patriots');
  for (const input of ['', undefined, '../broncos', 'broncos;id', 'new england', '${x}', 'a'.repeat(31)]) assert.throws(() => teamSettings(input));
});

test('team location follows the selected slug in new and existing name templates', () => {
  for (const [slug, location, name] of [
    ['broncos', 'Denver', 'Broncos'],
    ['patriots', 'New England', 'Patriots'],
    ['seahawks', 'Seattle', 'Seahawks'],
  ]) {
    const team = teamSettings(slug);
    assert.equal(renderText('{Location} {Team}', team), `${location} ${name}`);
    assert.equal(renderText('Seattle {Team}', team), `${location} ${name}`);
    assert.equal(renderText('Seattle\n  {Team}', team), `${location}\n  ${name}`);
    assert.equal(renderText('SEATTLE {TEAM}', team), `${location} ${name}`.toUpperCase());
    assert.equal(renderText('seattle {team}', team), `${location} ${name}`.toLowerCase());
    assert.equal(renderText('{LOCATION} football', team), `${location.toUpperCase()} football`);
  }
  assert.throws(() => teamSettings('unknownteam'), /Add it to template-tools\/locations.mjs/);
  assert.throws(() => teamSettings('constructor'), /No location configured/);
});

test('location substitution preserves actual places, URLs and code identifiers', () => {
  const text = 'Seattle hosted the game at Lumen Field. Pacific Northwest. seattleScore .seattle SEA America/Los_Angeles https://example.com/seattle-{team}';
  assert.equal(renderText(text, teamSettings('patriots')), text.replace('{team}', 'patriots'));
});

test('division taxonomy tokens follow each selected team while literal opponents stay intact', () => {
  for (const [slug, division, conference, members] of [
    ['seahawks', 'NFC West', 'NFC', ['ARI', 'LAR', 'SEA', 'SF']],
    ['broncos', 'AFC West', 'AFC', ['DEN', 'KC', 'LAC', 'LV']],
    ['packers', 'NFC North', 'NFC', ['CHI', 'DET', 'GB', 'MIN']],
    ['vikings', 'NFC North', 'NFC', ['CHI', 'DET', 'GB', 'MIN']],
    ['chiefs', 'AFC West', 'AFC', ['DEN', 'KC', 'LAC', 'LV']],
    ['patriots', 'AFC East', 'AFC', ['BUF', 'MIA', 'NE', 'NYJ']],
  ]) {
    const selected = teamSettings(slug);
    assert.equal(renderText('{DivisionSlug}|{Division}|{Conference}|{DivisionTeams}', selected),
      `${division.toLowerCase().replaceAll(' ', '-')}|${division}|${conference}|${JSON.stringify(members)}`);
    assert.equal(renderText('Seattle Seahawks at New England Patriots', selected), 'Seattle Seahawks at New England Patriots');
  }
});

test('themes preserve Seahawks styles and switch Broncos branding without recoloring statuses or data', () => {
  const original = ':root { --action-green:#70c934; --success:#25733c; --loss:#a43838; --warning:#9a6500; } .link{color:#2f660b} .card{background:#69be2818; border-color:rgba(112,201,52,.08)}';
  assert.equal(renderThemeCss(original, teamSettings('seahawks').theme), original);
  const broncos = teamSettings('broncos');
  const css = renderThemeCss(original, broncos.theme);
  assert.match(css, /--action-green:#fb4f14/);
  assert.match(css, /color:#a6310a/);
  assert.match(css, /background:#fb4f1418/);
  assert.match(css, /rgba\(251,79,20,.08\)/);
  assert.match(css, /--success:#25733c; --loss:#a43838; --warning:#9a6500/);
  const component = '<script>const stored = "#70c934"; const style = "color:#70c934";</script><style>.brand { color:#70c934 }</style>';
  const rendered = renderThemeStyles(component, 'src/pages/index.astro', broncos.theme);
  assert.match(rendered, /const stored = "#70c934"/);
  assert.match(rendered, /color:#fb4f14/);
  assert.match(rendered, /const style = "color:#70c934"/);
  assert.equal(renderThemeStyles(original, 'src/data/example.json', broncos.theme), original);
  assert.equal(renderThemeStyles(original, 'public/styles/themes/broncos.css', broncos.theme), original);
  assert.equal(renderText('{BrandMark} {HeroMark} {ThemeStylesheet}', broncos), 'BFZ DEN /styles/themes/broncos.css');
  assert.equal(renderText('{BrandMark} {HeroMark} {ThemeStylesheet}', teamSettings('seahawks')), 'SFZ 12 ');
});

test('rendering resolves file imports, preserves binary assets, and leaves sources unchanged', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'fanzone-template-'));
  const root = path.join(temp, 'source');
  try {
    await mkdir(path.join(root, 'template-tools'), { recursive: true });
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/{team}.json'), '{"name":"{Team}","fullName":"Seattle {Team}","id":31}');
    await writeFile(path.join(root, 'src/app.mjs'), 'import team from "./{team}.json";');
    const binary = Buffer.from([137, 80, 78, 71, 0, 255, 123, 116, 101, 97, 109, 125]);
    await writeFile(path.join(root, 'src/logo.png'), binary);
    await writeFile(path.join(root, '.env'), 'SECRET=do-not-copy');
    await writeFile(path.join(root, 'template-tools/files.json'), '[]');
    await writeFile(path.join(root, 'template-tools/upstream-package.json'), '{"name":"{team}fanzone","scripts":{"build":"astro build"}}');
    for (const slug of ['broncos', 'patriots']) {
      const target = path.join(temp, slug);
      await renderProject(root, target, teamSettings(slug), { linkDependencies: false });
      const data = JSON.parse(await readFile(path.join(target, `src/${slug}.json`)));
      assert.equal(data.name, teamSettings(slug).name);
      assert.equal(data.fullName, `${teamSettings(slug).location} ${teamSettings(slug).name}`);
      assert.equal(data.id, 31);
      assert.equal(await readFile(path.join(target, 'src/app.mjs'), 'utf8'), `import team from "./${slug}.json";`);
      assert.deepEqual(await readFile(path.join(target, 'src/logo.png')), binary);
      await assert.rejects(readFile(path.join(target, '.env')));
    }
    assert.equal(await readFile(path.join(root, 'src/{team}.json'), 'utf8'), '{"name":"{Team}","fullName":"Seattle {Team}","id":31}');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
