import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderProject, teamSettings } from './render.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'eventspy-missing-links-'));
const now = Date.parse('2026-09-12T16:00:00Z');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

async function setup(slug) {
  const directory = path.join(temporary, slug);
  await renderProject(root, directory, teamSettings(slug), { linkDependencies: false });
  if (slug === 'chiefs') {
    // The failing game ID is from the operator's task receipt. Other IDs are
    // temporary test bindings; never alter the reviewed production coverage.
    const rows = read(path.join(root, 'config/eventspy/chiefs.json')).map((row, index) => ({
      ...row, gameId: row.sourceEventId === '374562' ? '1392253' : row.gameId ?? `test-${index}`,
    }));
    fs.writeFileSync(path.join(directory, 'src/lib/tickets/eventspy-coverage-data.mjs'),
      `export const EVENTSPY_COVERAGE=${JSON.stringify(rows)};\n`);
  }
  const load = filename => import(pathToFileURL(path.join(directory, filename)).href);
  const coverage = await load('src/lib/tickets/eventspy-coverage.mjs');
  const schema = await load('src/lib/tickets/eventspy-mirror-schema.mjs');
  const collector = await load('scripts/tickets/eventspy-mirror.mjs');
  const quotes = await load('src/lib/tickets/provider-quotes.mjs');
  const chart = await load('src/lib/tickets/chart-path.mjs');
  const schedule = await load('src/lib/schedule.mjs');
  const row = coverage.EVENTSPY_COVERAGE.find(row => row.sourceEventId === '374562') ?? coverage.EVENTSPY_COVERAGE[0];
  const baseline = read(path.join(directory, 'tests/fixtures/eventspy-mirror-page.json'));
  const snapshot = {
    ...baseline, gameId: row.gameId, sourceEventId: row.sourceEventId,
    sourceUrl: row.sourceUrl, trackingUrl: row.sourceUrl,
    event: { ...baseline.event, title: `${coverage.EVENTSPY_TEAM_NAME} vs. ${row.opponent}`, localDate: row.localDate },
  };
  return { directory, coverage, schema, collector, quotes, chart, schedule, row, snapshot };
}
const seahawks = await setup('seahawks');
const chiefs = await setup('chiefs');

function responses({ snapshot }) {
  const { event, summary, providerLinks, history } = snapshot;
  return [{ id: snapshot.sourceEventId, ...event, providerLinks: { ...providerLinks },
    ...summary, currentLowestPrice: summary.currentLowestCents / 100,
    sevenDayLowestPrice: summary.sevenDayLowestCents / 100 },
  Object.fromEntries(['ticketmaster', 'stubhub', 'vividseats', 'seatgeek'].map(market => [market,
    history.filter(point => point[`${market}Cents`] !== null).map(point => ({ seenAt: point.observedAt, price: point[`${market}Cents`] / 100 })),
  ]))];
}

test('rendered legacy EventSpy tests still pass with full provider coverage', () => {
  const run = spawnSync(process.execPath, ['--test', 'tests/eventspy-mirror.test.mjs', 'tests/tickets-eventspy-mirror-season.test.mjs'],
    { cwd: seahawks.directory, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('full snapshots retain schema 1.0.0 and all existing values', () => {
  for (const fixture of [seahawks, chiefs]) {
    const { schema, collector, row, snapshot } = fixture;
    assert.equal(schema.validateEventSpyMirror(snapshot, { now }), snapshot);
    const normalized = collector.normalizeEventSpyResponses(row, ...responses(fixture), { now });
    assert.equal(normalized.schemaVersion, '1.0.0');
    assert.deepEqual(normalized.providerLinks, snapshot.providerLinks);
    assert.deepEqual(normalized.history, snapshot.history);
    assert.deepEqual(normalized.summary, snapshot.summary);
    assert.equal(schema.eventSpyMirrorCounts(normalized).providerLinks, 4);
  }
});

test('empty, null and omitted SeatGeek destinations normalize to 1.1.0 without losing prices', () => {
  for (const missing of ['', null, undefined]) {
    const { schema, collector, row, snapshot } = chiefs;
    const [event, history] = responses(chiefs);
    event.providerLinks.seatgeek = missing;
    if (missing === undefined) delete event.providerLinks.seatgeek;
    const normalized = collector.normalizeEventSpyResponses(row, event, history, { now });
    assert.equal(normalized.schemaVersion, '1.1.0');
    assert.equal(normalized.providerLinks.seatgeek, null);
    assert.equal(schema.eventSpyMirrorCounts(normalized).providerLinks, 3);
    assert.equal(normalized.summary.currentLowestMarketplace, 'seatgeek');
    assert.deepEqual(normalized.summary, snapshot.summary);
    assert.deepEqual(normalized.history, snapshot.history);
  }
});

test('provider URL aliases preserve a missing source destination without substitution', () => {
  const [event, history] = responses(chiefs);
  for (const [market, url] of Object.entries(event.providerLinks)) event[`${market}Url`] = url;
  delete event.providerLinks;
  event.seatgeekUrl = '';
  const normalized = chiefs.collector.normalizeEventSpyResponses(chiefs.row, event, history, { now });
  assert.equal(normalized.providerLinks.seatgeek, null);
  assert.equal(normalized.providerLinks.ticketmaster, event.ticketmasterUrl);
});

test('nullable snapshots still require at least one destination and strict known fields', () => {
  const { schema, snapshot } = chiefs;
  const nullable = { ...snapshot, schemaVersion: '1.1.0', providerLinks: { ...snapshot.providerLinks, seatgeek: null } };
  assert.equal(schema.validateEventSpyMirror(nullable, { now }), nullable);
  assert.throws(() => schema.validateEventSpyMirror({ ...nullable, schemaVersion: '1.0.0' }, { now }), /URL/);
  assert.throws(() => schema.validateEventSpyMirror({ ...nullable, schemaVersion: '1.2.0' }, { now }), /identity/);
  assert.throws(() => schema.validateEventSpyMirror({ ...nullable, providerLinks: { ...nullable.providerLinks, seatgeek: '' } }, { now }), /URL/);
  const missingKey = structuredClone(nullable);
  delete missingKey.providerLinks.seatgeek;
  assert.throws(() => schema.validateEventSpyMirror(missingKey, { now }), /fields/);
  const [event, history] = responses(chiefs);
  event.providerLinks = Object.fromEntries(Object.keys(event.providerLinks).map(market => [market, null]));
  assert.throws(() => chiefs.collector.normalizeEventSpyResponses(chiefs.row, event, history, { now }), /At least one provider URL/);
});

test('malformed and unsafe nonempty destinations still reject the entire snapshot', () => {
  for (const unsafe of ['https://', 'javascript:alert(1)', 'http://seatgeek.com/x', 'https://user:pass@seatgeek.com/x',
    'https://seatgeek.com:8443/x', 'https://127.0.0.1/x', 'https://seatgeek.com/x?api_key=secret', '   ', 42, {}, ['https://seatgeek.com/x']]) {
    const [event, history] = responses(chiefs);
    event.providerLinks.seatgeek = unsafe;
    assert.throws(() => chiefs.collector.normalizeEventSpyResponses(chiefs.row, event, history, { now }), /Unsafe seatgeek URL/);
    assert.throws(() => chiefs.schema.validateEventSpyMirror({ ...chiefs.snapshot, schemaVersion: '1.1.0',
      providerLinks: { ...chiefs.snapshot.providerLinks, seatgeek: unsafe } }, { now }), /Invalid seatgeek URL/);
  }
});

function browserScript(fixture) {
  const table = { innerHTML: '' };
  const element = () => ({ dataset: {}, style: {}, setAttribute() {}, append() {}, replaceChildren() {}, after() {} });
  const domRoot = { dataset: { routeStyle: 'tickets' }, querySelectorAll: () => [],
    querySelector: selector => selector === '[data-game-selector]' ? null : selector === 'tbody' ? table : element() };
  const page = fs.readFileSync(path.join(fixture.directory, 'src/components/GameDayPage.astro'), 'utf8');
  const script = page.split('<script>')[1].split('</script>')[0].replace(/^import .*;$/gm, '')
    .replace('if(root){addEventListener("popstate",()=>load());load()}', '');
  const context = vm.createContext({ ...fixture.coverage, ...fixture.schema, ...fixture.quotes, ...fixture.chart,
    ...fixture.schedule, URLSearchParams, URL, Intl, Date, location: { search: '' },
    document: { querySelector: selector => selector === '#ticket-price-explorer' ? domRoot : { textContent: '{}' },
      createElement: element, createElementNS: element },
  });
  vm.runInContext(script, context);
  return { context, domRoot, table };
}

test('actual rendered ticket script hides linkless cheapest card without promoting another provider', () => {
  const snapshot = structuredClone(chiefs.snapshot);
  snapshot.schemaVersion = '1.1.0';
  snapshot.providerLinks.seatgeek = null;
  chiefs.schema.validateEventSpyMirror(snapshot, { now });
  const { context, domRoot, table } = browserScript(chiefs);
  context.fixture = snapshot;
  const html = vm.runInContext('content(fixture)', context);
  assert.equal((html.match(/class="provider-card"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /data-provider="seatgeek"|href="(?:null|undefined|)"/);
  assert.match(html, /data-current-lowest="26775"/);
  assert.doesNotMatch(html, /data-lowest-price="true"/);
  assert.match(html, /Their recorded prices remain in the comparison and history/);
  assert.match(html, /<option value="seatgeek">SeatGeek<\/option>/);
  vm.runInContext('activate(fixture)', context);
  assert.equal(domRoot.dataset.providerLinks, '3');
  assert.equal(domRoot.dataset.historyPoints, String(snapshot.history.length));
  assert.match(table.innerHTML, /\$267\.75/);
});

test('actual rendered ticket script retains all four legacy cards and lowest badge', () => {
  const { context, domRoot } = browserScript(chiefs);
  context.fixture = chiefs.snapshot;
  const html = vm.runInContext('content(fixture)', context);
  assert.equal((html.match(/class="provider-card"/g) ?? []).length, 4);
  assert.match(html, /data-provider="seatgeek"[^>]+data-lowest-price="true"/);
  assert.doesNotMatch(html, /Some marketplace links are unavailable/);
  vm.runInContext('activate(fixture)', context);
  assert.equal(domRoot.dataset.providerLinks, '4');
});
