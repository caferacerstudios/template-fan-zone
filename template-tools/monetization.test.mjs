import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyMonetizationSettings, selectMonetizationSettings, writeMonetizationAdsTxt } from './monetization.mjs';

const publisherId = 'ca-pub-1234567890123456';
const liveSite = () => ({
  phase: 'live', publisherId,
  productionHosts: ['seahawksfanzone.com', 'www.seahawksfanzone.com'],
  cmpScriptUrl: 'https://fundingchoicesmessages.google.com/i/pub-1234567890123456?ers=1',
  slots: { 'feed-break': '1234567890' },
});
const configFor = site => ({ schemaVersion: 1, teams: { seahawks: site, broncos: { phase: 'off' } } });

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fanzone-monetization-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'config'));
  return root;
}

test('review publishes verification settings without requesting ads or consent scripts', () => {
  const settings = selectMonetizationSettings(configFor({ ...liveSite(), phase: 'review' }), 'seahawks');
  assert.equal(settings.PUBLIC_ADSENSE_PHASE, 'review');
  assert.equal(settings.PUBLIC_ADSENSE_PUBLISHER_ID, publisherId);
  assert.equal(settings.ADS_TXT_RECORD, 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0');
  assert.deepEqual(JSON.parse(settings.PUBLIC_ADSENSE_PRODUCTION_HOSTS), liveSite().productionHosts);
  assert.equal(settings.ADS_ENABLED, 'false');
  assert.equal(settings.PUBLIC_CMP_SCRIPT_URL, '');
  assert.equal(settings.PUBLIC_ADSENSE_FEED_BREAK_SLOT, '');
});

test('live exports only the selected manual ad slots and disables automatic overlays', () => {
  const settings = selectMonetizationSettings(configFor(liveSite()), 'seahawks');
  assert.equal(settings.ADS_ENABLED, 'true');
  assert.equal(settings.PUBLIC_CMP_SCRIPT_URL, liveSite().cmpScriptUrl);
  assert.equal(settings.PUBLIC_ADSENSE_FEED_BREAK_SLOT, '1234567890');
  assert.equal(settings.PUBLIC_ADSENSE_ARTICLE_INLINE_SLOT, '');
  for (const key of ['PUBLIC_ADSENSE_AUTO_ADS', 'PUBLIC_ADSENSE_ANCHOR_ADS', 'PUBLIC_ADSENSE_VIGNETTE_ADS']) assert.equal(settings[key], 'false');
  const alternate = selectMonetizationSettings(configFor({ ...liveSite(), cmpScriptUrl: `https://fundingchoicesmessages.google.com/i/${publisherId}?ers=1` }), 'seahawks');
  assert.equal(alternate.ADS_ENABLED, 'true');
});

test('switching teams clears inherited globals and the previous team, including analytics', async t => {
  const root = await temporaryRoot(t);
  await writeFile(path.join(root, 'config/monetization.json'), JSON.stringify(configFor(liveSite())));
  const environment = {
    ADS_ENABLED: 'true', PUBLIC_ADSENSE_PUBLISHER_ID: 'ca-pub-9999999999999999',
    PUBLIC_ADSENSE_NEW_LEGACY_SLOT: '777', PUBLIC_CMP_OLD_SETTING: 'legacy',
    PUBLIC_ANALYTICS_ENDPOINT: 'https://old.invalid/collect', PUBLIC_ANALYTICS_OLD_TOKEN: 'legacy',
    PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN: 'old-token',
    FAN_ZONE_GUIDES_ENABLED: '1',
  };
  await applyMonetizationSettings(root, 'seahawks', environment);
  assert.equal(environment.PUBLIC_ADSENSE_PUBLISHER_ID, publisherId);
  assert.equal(environment.PUBLIC_ANALYTICS_ENDPOINT, '');
  assert.equal(environment.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN, '');
  assert.equal(environment.PUBLIC_ADSENSE_NEW_LEGACY_SLOT, undefined);
  assert.equal(environment.PUBLIC_CMP_OLD_SETTING, undefined);
  assert.equal(environment.PUBLIC_ANALYTICS_OLD_TOKEN, undefined);
  await applyMonetizationSettings(root, 'broncos', environment);
  assert.equal(environment.ADS_ENABLED, 'false');
  assert.equal(environment.ADS_TXT_RECORD, '');
  assert.equal(environment.PUBLIC_ADSENSE_PHASE, 'off');
  assert.equal(environment.PUBLIC_ADSENSE_PUBLISHER_ID, '');
  assert.equal(environment.PUBLIC_CMP_SCRIPT_URL, '');
  assert.equal(environment.PUBLIC_ADSENSE_FEED_BREAK_SLOT, '');
  assert.deepEqual(JSON.parse(environment.PUBLIC_ADSENSE_PRODUCTION_HOSTS), []);
  assert.equal(environment.FAN_ZONE_GUIDES_ENABLED, '1');
});

test('explicit off settings and teams without an entry are off', () => {
  const config = configFor({ phase: 'off' });
  for (const team of [...Object.keys(config.teams), 'bills']) {
    const settings = selectMonetizationSettings(config, team);
    assert.equal(settings.ADS_ENABLED, 'false');
    assert.equal(settings.PUBLIC_ADSENSE_PHASE, 'off');
    assert.equal(settings.PUBLIC_ADSENSE_PUBLISHER_ID, '');
    assert.equal(settings.ADS_TXT_RECORD, '');
  }
});

test('bad active settings fail before a build can run', () => {
  const cases = [
    { phase: 'enabled' },
    { publisherId: 'ca-pub-123' },
    { publisherId: 'pub-1234567890123456' },
    { publisherId: '' },
    { productionHosts: [] },
    { productionHosts: ['https://seahawksfanzone.com/'] },
    { productionHosts: ['192.168.88.3'] },
    { productionHosts: ['localhost'] },
    { productionHosts: ['seahawksfanzone.com', 'seahawksfanzone.com'] },
    { cmpScriptUrl: '' },
    { cmpScriptUrl: 'https://fundingchoicesmessages.google.com.evil.test/i/pub-1234567890123456' },
    { cmpScriptUrl: 'http://fundingchoicesmessages.google.com/i/pub-1234567890123456' },
    { cmpScriptUrl: 'https://fundingchoicesmessages.google.com/i/pub-9999999999999999?ers=1' },
    { cmpScriptUrl: 'https://fundingchoicesmessages.google.com/i/pub-1234567890123456?secret=fixture' },
    { slots: {} },
    { slots: { 'feed-break': 1234567890 } },
    { slots: { 'feed-break': '<script>' } },
    { slots: { 'feed-brek': '1234567890' } },
    { phase: 'review', publisherId: '' },
  ];
  for (const replacement of cases) {
    assert.throws(() => selectMonetizationSettings(configFor({ ...liveSite(), ...replacement }), 'seahawks'), /^Error: Monetization:/);
  }
});

test('unsupported secret fields cannot be exported or repeated in validation errors', () => {
  const secret = 'fixture-private-value';
  for (const config of [
    { ...configFor(liveSite()), OPENAI_API_KEY: secret },
    configFor({ ...liveSite(), API_KEY: secret }),
    configFor({ ...liveSite(), cmpScriptUrl: secret }),
  ]) {
    assert.throws(() => selectMonetizationSettings(config, 'seahawks'), error => {
      assert.ok(!error.message.includes(secret));
      return /Monetization:/.test(error.message);
    });
  }
  assert.ok(!Object.keys(selectMonetizationSettings(configFor(liveSite()), 'seahawks')).some(key => /API_KEY|SECRET/.test(key)));
});

test('missing and invalid JSON config stop safely without printing its contents', async t => {
  const root = await temporaryRoot(t);
  await assert.rejects(applyMonetizationSettings(root, 'seahawks', {}), /missing config\/monetization.json/);
  await writeFile(path.join(root, 'config/monetization.json'), 'fixture-private-value');
  await assert.rejects(applyMonetizationSettings(root, 'seahawks', {}), error => {
    assert.ok(!error.message.includes('fixture-private-value'));
    return /must be valid JSON/.test(error.message);
  });
});

test('ads.txt is overwritten when changing from an active team to an off team', async t => {
  const root = await temporaryRoot(t);
  const config = configFor(liveSite());
  await writeMonetizationAdsTxt(root, selectMonetizationSettings(config, 'seahawks'));
  assert.equal(await readFile(path.join(root, 'public/ads.txt'), 'utf8'), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  await writeMonetizationAdsTxt(root, selectMonetizationSettings(config, 'broncos'));
  assert.equal(await readFile(path.join(root, 'public/ads.txt'), 'utf8'), '# Advertising is disabled for this team.\n');
});
