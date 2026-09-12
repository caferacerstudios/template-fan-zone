import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadBuildSettings } from './build-settings.mjs';

test('each checkout supplies its own public settings without exporting collection credentials', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fanzone-build-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, '.env'), [
    'export ADS_ENABLED=true', 'ADS_TXT_RECORD="google.com, pub-123, DIRECT, f08c47fec0942fa0"',
    "PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN='fixture-public-token' # website setting",
    'OPENAI_API_KEY=fixture-secret', 'BALLDONTLIE_API_KEY=fixture-secret',
    'TEAM=broncos', 'FANZONE_STAGE_ONLY=0', 'HOMEPAGE_FEED_NOW=1900-01-01', 'FAN_ZONE_GUIDES_ENABLED=1',
  ].join('\n'));
  const environment = { ADS_ENABLED: 'false' };
  await loadBuildSettings(root, environment);
  assert.deepEqual(environment, { ADS_ENABLED: 'false',
    ADS_TXT_RECORD: 'google.com, pub-123, DIRECT, f08c47fec0942fa0',
    PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN: 'fixture-public-token', FAN_ZONE_GUIDES_ENABLED: '1' });
});

test('a checkout without local settings retains its existing defaults', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fanzone-build-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environment = { TEAM: 'seahawks' };
  await loadBuildSettings(root, environment);
  assert.deepEqual(environment, { TEAM: 'seahawks' });
});
