import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderText, teamSettings } from './render.mjs';
import { renderThemeCss, renderThemeStyles } from './themes.mjs';

const root = new URL('../', import.meta.url);
const teams = [
  ['packers', 'PFZ', 'GB', '#ffb612'],
  ['vikings', 'VFZ', 'MIN', '#ffc62f'],
  ['chiefs', 'CFZ', 'KC', '#ffb81c'],
  ['patriots', 'PFZ', 'NE', '#ff637b'],
];

for (const [slug, mark, heroMark, accent] of teams) {
  test(`${slug} selects its own scoped stylesheet, favicon and independent marks`, async () => {
    const team = teamSettings(slug);
    assert.equal(renderText('{ThemeKey} {BrandMark} {HeroMark}', team), `${slug} ${mark} ${heroMark}`);
    const css = await readFile(new URL(`public${team.theme.stylesheet}`, root), 'utf8');
    const favicon = await readFile(new URL(`public${team.theme.favicon}`, root), 'utf8');
    assert.match(css, new RegExp(`body\\[data-team="${slug}"\\]\\[data-theme="${slug}"\\]`));
    assert.match(favicon, /<svg\b/);
    // Dedicated team assets must remain literal even through another team's render.
    for (const other of ['seahawks', 'broncos', ...teams.map(item => item[0])]) {
      assert.equal(renderThemeStyles(css, `public${team.theme.stylesheet}`, teamSettings(other).theme), css);
    }
    assert.match(css, /\.result-w\s*\{\s*background: #70c934 !important; color: #071f34;/);
    const input = '.brand{color:#70c934;background:#69be2818}.status{color:#25733c;border-color:#a43838;background:#9a6500}';
    const output = renderThemeCss(input, team.theme);
    assert.ok(output.includes(`color:${accent};background:${accent}18`));
    assert.ok(output.includes('.status{color:#25733c;border-color:#a43838;background:#9a6500}'));
    const component = '<script>const fact = "#70c934";</script><style>.brand{color:#70c934}</style><p>#70c934</p>';
    const rendered = renderThemeStyles(component, 'src/pages/example.astro', team.theme);
    assert.ok(rendered.includes(`<style>.brand{color:${accent}}</style>`));
    assert.ok(rendered.includes('<script>const fact = "#70c934";</script>'));
    assert.ok(rendered.includes('<p>#70c934</p>'));
  });
}

function luminance(hex) {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('new team text palettes retain readable contrast on paper and dark surfaces', () => {
  for (const [slug] of teams) {
    const { palette } = teamSettings(slug).theme;
    assert.ok(contrast(palette['#397a12'], '#ffffff') >= 4.5, `${slug} links on paper`);
    assert.ok(contrast(palette['#071f34'], '#ffffff') >= 4.5, `${slug} heading / white text contrast`);
    assert.ok(contrast(palette['#70c934'], palette['#031525']) >= 4.5, `${slug} accent on dark surface`);
  }
});
