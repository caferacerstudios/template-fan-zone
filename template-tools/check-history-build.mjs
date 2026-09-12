#!/usr/bin/env node
// Usage: node template-tools/check-history-build.mjs /path/to/dist broncos
// Checks completed Astro output; does not build, fetch, or change files.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [directory, slug] = process.argv.slice(2);
assert.ok(directory && /^[a-z]+$/.test(slug ?? ''), 'Usage: node template-tools/check-history-build.mjs /path/to/dist <team>');
const historyDirectory = path.join(project, 'src/data/history');
const history = JSON.parse(await readFile(path.join(historyDirectory, `${slug}.json`), 'utf8'));
const html = await readFile(path.join(directory, 'history/index.html'), 'utf8');

function decode(text) {
  return text.replace(/&#x([\da-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
const normalize = text => decode(text).replace(/\s+/g, ' ').trim();
const textOf = markup => normalize(markup.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '').replace(/<[^>]*>/g, ' '));
function elementById(tag, id) {
  const result = html.match(new RegExp(`<${tag}\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  assert.ok(result, `Missing ${id}`);
  return textOf(result[1]);
}
function section(id) {
  const result = html.match(new RegExp(`<section\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?<\\/section>`, 'i'));
  assert.ok(result, `Missing ${id} section`);
  return result[0];
}
assert.equal(elementById('h1', 'history-title'), `${history.fullName} History ${history.heroSubtitle}`);
assert.equal(elementById('h2', 'timeline-title'), `The ${history.city} timeline`);
assert.ok(textOf(html).includes(normalize(history.heroKicker)), 'Hero kicker is missing');
assert.ok(decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').includes(history.metaTitle), 'Wrong SEO title');
const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
assert.ok(metadata.some(tag => /\bname=["']description["']/i.test(tag) && decode(tag).includes(history.metaDescription)), 'Wrong SEO description');

for (const [id, rows, contentKeys] of [
  ['timeline', history.timeline, ['year', 'category', 'title', 'description', 'sourceName']],
  ['eras', history.eras, ['title', 'description', 'sourceName']],
  ['numbers', history.numbers, ['value', 'label']],
]) {
  const markup = section(id);
  const text = textOf(markup);
  const sourceMarkup = decode(markup);
  for (const row of rows) {
    for (const key of contentKeys) assert.ok(text.includes(normalize(row[key])), `${slug}: ${id} missing ${key}: ${row[key]}`);
    assert.ok(sourceMarkup.includes(`href="${row.sourceUrl}"`) || sourceMarkup.includes(`href='${row.sourceUrl}'`), `${slug}: missing literal citation ${row.sourceUrl}`);
  }
}
const timelineMarkup = section('timeline');
assert.equal((timelineMarkup.match(/<li\b/gi) ?? []).length, history.timeline.length, 'Unexpected timeline row count');
const playerText = textOf(section('players'));
for (const player of history.players) {
  assert.ok(playerText.includes(normalize(player.name)), `Missing player ${player.name}`);
  assert.ok(playerText.includes(normalize(player.label)), `Missing player label ${player.label}`);
}
assert.ok(decode(section('players')).includes(history.playerSource.url), 'Wrong franchise-player citation');
assert.ok(textOf(section('sources')).includes(normalize(history.methodology)), 'Wrong source methodology');

// Opponents can be mentioned in authentic history. Reject alternate complete
// entries or citations instead of incorrectly banning another team's name.
const historyHtml = html.slice(html.indexOf('class="history-hero"'));
const selectedContent = JSON.stringify(history);
const renderedText = textOf(historyHtml);
const otherHistories = [];
for (const filename of await readdir(historyDirectory)) {
  if (!filename.endsWith('.json') || filename === `${slug}.json`) continue;
  const other = JSON.parse(await readFile(path.join(historyDirectory, filename), 'utf8'));
  otherHistories.push(other);
  for (const row of other.timeline) {
    if (!selectedContent.includes(row.title)) assert.ok(!renderedText.includes(normalize(row.title)), `Leaked ${other.team} timeline title: ${row.title}`);
    if (!selectedContent.includes(row.sourceUrl)) assert.ok(!decode(historyHtml).includes(row.sourceUrl), `Leaked ${other.team} citation: ${row.sourceUrl}`);
  }
}
assert.doesNotMatch(historyHtml, /\{(?:Team|team|Location|LOCATION)\}/, 'Unrendered team token in built history');
assert.ok(metadata.some(tag => /property="og:title"/.test(tag) && decode(tag).includes(history.metaTitle)), 'Wrong Open Graph title');
assert.ok(metadata.some(tag => /name="twitter:title"/.test(tag) && decode(tag).includes(history.metaTitle)), 'Wrong social title');
assert.ok(html.includes(`href="https://${slug}fanzone.com/history"`), 'Wrong history canonical URL');

// Inspect the actual files a static server can expose, including script bundles
// and source maps. Other datasets must not merely be hidden in the visible DOM.
async function checkPublishedFiles(folder, relative = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      assert.ok(!/^history\/(?:seahawks|broncos|packers|vikings|chiefs)(?:\/|$)/.test(name), `Alternate history route: ${name}`);
      await checkPublishedFiles(path.join(folder, entry.name), name);
    } else {
      assert.ok(!/(?:^|\/)history\/.*\.json$/.test(name) && !/(?:^|\/)history-timeline\.json$/.test(name), `Raw history data was published: ${name}`);
      if (!/\.(?:html|js|json|map|xml)$/.test(name)) continue;
      const contents = decode(await readFile(path.join(folder, entry.name), 'utf8'));
      for (const other of otherHistories) {
        assert.ok(!contents.includes(other.metaTitle), `Alternate history metadata in ${name}: ${other.team}`);
        for (const row of other.timeline) {
          if (!selectedContent.includes(row.description)) {
            assert.ok(!contents.includes(row.description), `Alternate history data in ${name}: ${other.team}`);
          }
        }
        assert.ok(!contents.includes(`/history/${other.team}`), `Alternate history URL in ${name}`);
      }
    }
  }
}
await checkPublishedFiles(directory);
console.log(`${slug}: built history verified (${history.timeline.length} milestones, ${history.eras.length} eras, ${history.numbers.length} numbers, ${history.players.length} players).`);
