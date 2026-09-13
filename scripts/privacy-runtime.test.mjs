import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../public/privacy-runtime.js', import.meta.url), 'utf8');
const publisherId = 'ca-pub-1234567890123456';
const base = { phase: 'live', publisherId, productionHosts: ['seahawksfanzone.com', 'www.seahawksfanzone.com'], cmpScriptUrl: 'https://fundingchoicesmessages.google.com/i/pub-1234567890123456?ers=1', monetizationEligible: true };
const euConsent = () => ({ gdprApplies: true, cmpStatus: 'loaded', eventStatus: 'tcloaded', tcString: 'provider-managed-consent', purpose: { consents: { 1: true }, legitimateInterests: { 2: true, 7: true, 9: true, 10: true } }, vendor: { consents: { 755: true }, legitimateInterests: { 755: true } } });
const outside = { gdprApplies: false, cmpStatus: 'loaded', eventStatus: 'tcloaded' };
function fixture({ config = {}, hostname = 'seahawksfanzone.com', protocol = 'https:', port = '', gpc = false, withGpp = true } = {}) {
  const scripts = [], events = [], windowEvents = {}, documentEvents = {};
  let tcfCallback, gppCallback, reloaded = 0, assigned, euOpened = 0, usCompletion;
  const readyKeys = new Set();
  const queue = [];
  const originalPush = queue.push.bind(queue);
  queue.push = (entry) => { originalPush(entry); for (const [key, callback] of Object.entries(entry)) if (readyKeys.has(key)) callback(); };
  const node = { hidden: true };
  const classes = new Set();
  const unit = { dataset: { adClient: publisherId, adSlot: '12345' }, classList: { add: (value) => classes.add(value) }, closest: () => node, getClientRects: () => [{}], getBoundingClientRect: () => ({ width: 300 }), remove() { this.removed = true; } };
  const document = {
    getElementById: () => ({ textContent: JSON.stringify({ ...base, ...config }) }),
    querySelectorAll: (selector) => selector === '[data-sfz-ad-container]' ? [node] : [unit].filter((value) => !value.removed),
    createElement: () => ({ dataset: {}, setAttribute(name, value) { this[name] = value; } }),
    head: { append: (script) => { scripts.push(script); if (script.dataset.sfzAds) { assert.equal(window.adsbygoogle.requestNonPersonalizedAds, 1); assert.equal(script['data-privacy-treatments'], 'disablePersonalization'); } } },
    addEventListener: (name, fn) => { documentEvents[name] = fn; }, visibilityState: 'visible',
  };
  const window = {
    navigator: { globalPrivacyControl: gpc },
    location: { hostname, protocol, port, reload: () => { reloaded++; }, assign: (value) => { assigned = value; } },
    addEventListener: (name, fn) => { windowEvents[name] = fn; }, dispatchEvent: (event) => { events.push(event); },
    googlefc: { callbackQueue: queue, showRevocationMessage: () => { euOpened++; }, usstatesoptout: { InitialUsStatesOptOutStatusEnum: { UNKNOWN: 0, DOES_NOT_APPLY: 1, NOT_OPTED_OUT: 2, OPTED_OUT: 3 }, getInitialUsStatesOptOutStatus: () => window.usStatus, openConfirmationDialog: (callback) => { usCompletion = callback; } } },
    __tcfapi: (command, version, callback) => { assert.equal(command, 'addEventListener'); assert.equal(version, 0); tcfCallback = callback; },
    ...(withGpp ? { __gpp: (command, callback) => { assert.equal(command, 'addEventListener'); gppCallback = callback; } } : {}),
  };
  vm.runInNewContext(source, { window, document, URL, CustomEvent: class { constructor(name, options) { this.type = name; this.detail = options.detail; } } });
  const fire = (key) => { readyKeys.add(key); for (const entry of [...queue]) entry[key]?.(); };
  return { window, document, node, unit, scripts, classes, events, windowEvents, documentEvents,
    api: () => fire('CONSENT_API_READY'), tcf: (data, success = true) => tcfCallback(data, success),
    us: (status) => { window.usStatus = status; fire('INITIAL_US_STATES_OPT_OUT_DATA_READY'); },
    gpp: (overrides = {}, eventName = 'listenerRegistered', success = true) => gppCallback({ eventName, pingData: { cmpStatus: 'loaded', signalStatus: 'ready', gppString: 'initial-provider-string', applicableSections: [7], ...overrides } }, success),
    loadAdScript: () => scripts.find((script) => script.dataset.sfzAds)?.onload(),
    get ads() { return scripts.filter((script) => script.dataset.sfzAds); }, get reloaded() { return reloaded; }, get assigned() { return assigned; }, get euOpened() { return euOpened; }, get usCompletion() { return usCompletion; },
  };
}

test('no ad request or own storage before the CMP decision', () => {
  const f = fixture(); f.api();
  assert.equal(f.scripts.length, 1); assert.equal(f.ads.length, 0); assert.equal(f.node.hidden, true);
  assert.equal(f.window.sfzPrivacy.getState().advertising, false);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie\s*=/);
});
for (const settings of [{ config: { phase: 'review' } }, { config: { phase: 'off' } }, { hostname: '192.168.88.3' }, { hostname: 'preview.seahawksfanzone.com' }, { protocol: 'http:' }, { port: '4322' }, { config: { publisherId: 'ca-pub-123' } }, { config: { cmpScriptUrl: 'https://fundingchoicesmessages.google.com.evil.test/i/pub-1234567890123456' } }]) {
  test(`review/off/invalid/preview guard ${JSON.stringify(settings)}`, () => { const f = fixture(settings); assert.equal(f.scripts.length, 0); assert.equal(f.window.sfzPrivacy.manage(), false); });
}
test('TCF accept requests NPA once; optional personalization not needed', () => {
  const f = fixture(); f.api(); f.tcf(euConsent());
  assert.equal(f.ads.length, 1); f.loadAdScript(); f.window.sfzPrivacy.requestAds();
  assert.equal(f.window.adsbygoogle.length, 1); assert.equal(f.node.hidden, false); assert.ok(f.classes.has('adsbygoogle'));
});
for (const mutator of [data => { data.purpose.consents[1] = false; }, data => { data.vendor.consents[755] = false; }, data => { data.purpose.legitimateInterests[7] = false; }, data => { data.vendor.legitimateInterests[755] = false; }, data => { data.eventStatus = 'cmpuishown'; }, data => { data.cmpStatus = 'loading'; }, data => { data.publisher = { restrictions: { 2: { 755: 0 } } }; }]) {
  test(`TCF denial or unfinished data blocks script ${mutator}`, () => { const f = fixture(); f.api(); const data = euConsent(); mutator(data); f.tcf(data); assert.equal(f.ads.length, 0); });
}
test('outside TCF waits for US data, and covered US waits for GPP readiness', () => {
  const f = fixture(); f.api(); f.tcf(outside); assert.equal(f.ads.length, 0);
  f.us(2); assert.equal(f.ads.length, 0); f.gpp(); assert.equal(f.ads.length, 1);
  assert.equal(f.reloaded, 0); f.gpp({}, 'signalStatus'); assert.equal(f.reloaded, 0);
});
test('US DOES_NOT_APPLY from Google permits non-TCF region without a GPP API', () => {
  const f = fixture({ withGpp: false }); f.api(); f.tcf(outside); f.us(1); assert.equal(f.ads.length, 1);
});
for (const status of [0, 3, undefined, 99]) {
  test(`US opt-out/unknown blocks advertising: ${status}`, () => { const f = fixture(); f.api(); f.tcf(outside); f.gpp(); f.us(status); assert.equal(f.ads.length, 0); });
}
test('GPC blocks all ads even where provider permits', () => {
  for (const data of [euConsent(), outside]) { const f = fixture({ gpc: true }); f.api(); f.tcf(data); f.gpp(); f.us(1); assert.equal(f.ads.length, 0); }
});
test('policy page retains CMP controls but never ad script', () => {
  const f = fixture({ config: { monetizationEligible: false } }); f.api(); f.tcf(euConsent());
  assert.equal(f.ads.length, 0); assert.equal(f.scripts.length, 1); assert.equal(f.window.sfzPrivacy.manage(), true); assert.equal(f.euOpened, 1);
});
test('EU reopening pauses removes frames and waits for user action before reloading', () => {
  const f = fixture(); f.api(); f.tcf(euConsent()); f.loadAdScript(); assert.equal(f.window.sfzPrivacy.manage(), true);
  assert.equal(f.window.adsbygoogle.pauseAdRequests, 1); assert.equal(f.unit.removed, true); assert.equal(f.node.hidden, true);
  f.tcf(euConsent()); assert.equal(f.reloaded, 0);
  const rejected = euConsent(); rejected.eventStatus = 'useractioncomplete'; rejected.purpose.consents[1] = false; f.tcf(rejected);
  assert.equal(f.reloaded, 1); f.window.sfzPrivacy.requestAds(); assert.equal(f.window.adsbygoogle.length, 1);
});
test('direct EU consent withdrawal unloads active ad code by reload', () => {
  const f = fixture(); f.api(); f.tcf(euConsent()); const rejected = euConsent(); rejected.eventStatus = 'useractioncomplete'; rejected.purpose.consents[1] = false;
  f.tcf(rejected); assert.equal(f.reloaded, 1); assert.equal(f.window.adsbygoogle.pauseAdRequests, 1);
});
test('US settings calls supported dialog and reloads after choice', () => {
  const f = fixture(); f.api(); f.tcf(outside); f.gpp(); f.us(2); assert.equal(f.window.sfzPrivacy.manage(), true);
  assert.equal(typeof f.usCompletion, 'function'); f.usCompletion(true); assert.equal(f.reloaded, 1);
});
test('subsequent US GPP mutation pauses immediately then reloads once settled', () => {
  const f = fixture(); f.api(); f.tcf(outside); f.gpp(); f.us(2); f.loadAdScript();
  f.gpp({ signalStatus: 'not ready' }, 'signalStatus'); assert.equal(f.window.adsbygoogle.pauseAdRequests, 1); assert.equal(f.reloaded, 0);
  f.gpp({ gppString: 'new-optout-provider-string' }, 'signalStatus'); assert.equal(f.reloaded, 1);
});
test('unavailable provider manage API returns false for policy fallback', () => {
  const f = fixture(); f.api(); f.tcf(euConsent()); delete f.window.googlefc.showRevocationMessage; assert.equal(f.window.sfzPrivacy.manage(), false);
});
test('provider errors fail closed even if another callback arrives later', () => {
  const f = fixture(); f.api(); f.tcf(euConsent(), false); f.tcf(euConsent()); f.us(1); assert.equal(f.ads.length, 0);
});
test('hidden desktop unit and wrong team publisher never enter ad queue', () => {
  const f = fixture(); f.unit.getClientRects = () => []; f.api(); f.tcf(euConsent()); f.loadAdScript(); assert.equal(f.window.adsbygoogle.length, 0); assert.equal(f.classes.size, 0);
  f.unit.getClientRects = () => [{}]; f.unit.dataset.adClient = 'ca-pub-9999999999999999'; f.window.sfzPrivacy.requestAds(); assert.equal(f.window.adsbygoogle.length, 0);
});
