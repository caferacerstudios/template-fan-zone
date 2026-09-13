/* Google owns the consent UI and records. This adapter never stores visitor data.
 * API: https://developers.google.com/funding-choices/fc-api-docs
 * NPA: https://support.google.com/adsense/answer/9804260
 * Tag controls: https://support.google.com/adsense/answer/7670312
 * GPP: IAB Global-Privacy-Platform/Core/CMP API Specification.md
 */
(() => {
  'use strict';
  let config;
  try { config = JSON.parse(document.getElementById('sfz-privacy-config').textContent); }
  catch { return; }
  if (window.sfzPrivacy) return;
  const state = { ready: false, advertising: false, analytics: false };
  const listeners = new Set();
  let apiReady = false, tcfData, usStatus;
  let gppReady = false, gppSeenReady = false, gppChanging = false;
  let gppFingerprint = '', adsLoaded = false, suspended = false, reloading = false;
  let managing = false, frameworkError = false;
  const requested = new WeakSet();
  const hasGpc = () => window.navigator.globalPrivacyControl === true;
  const emit = (ready, advertising) => {
    state.ready = ready;
    state.advertising = advertising;
    listeners.forEach((listener) => listener({ ...state }));
    window.dispatchEvent(new CustomEvent('sfz:privacy-consent', { detail: { ...state } }));
  };
  const pause = () => {
    emit(false, false);
    if (!adsLoaded) return;
    suspended = true;
    window.adsbygoogle.pauseAdRequests = 1;
    document.querySelectorAll('[data-sfz-ad-container]').forEach((node) => { node.hidden = true; });
    // Manual placements plus Google's auto-generated ad frames, if enabled externally.
    document.querySelectorAll('ins[data-sfz-ad], ins.adsbygoogle, iframe[id^="google_ads_iframe"], iframe[id^="aswift_"]').forEach((node) => node.remove());
  };
  const reload = () => {
    if (reloading) return;
    pause();
    reloading = true;
    window.location.reload();
  };
  const fallback = () => window.location.assign('/privacy-policy#privacy-choices');
  let liveHost = false;
  try {
    const cmp = new URL(config.cmpScriptUrl);
    liveHost = config.phase === 'live' && /^ca-pub-\d{16}$/.test(config.publisherId)
      && window.location.protocol === 'https:' && !window.location.port
      && Array.isArray(config.productionHosts) && config.productionHosts.includes(window.location.hostname)
      && cmp.protocol === 'https:' && cmp.hostname === 'fundingchoicesmessages.google.com'
      && !cmp.username && !cmp.password && !cmp.port;
  } catch {}

  // Reject-all never falls through to Google's limited-ad serving mode.
  const tcfAllowsNpa = (data) => {
    if (data?.gdprApplies !== true || data.cmpStatus !== 'loaded'
      || !['tcloaded', 'useractioncomplete'].includes(data.eventStatus)
      || typeof data.tcString !== 'string' || !data.tcString
      || data.purpose?.consents?.[1] !== true || data.vendor?.consents?.[755] !== true) return false;
    return [2, 7, 9, 10].every((purpose) => {
      const restriction = data.publisher?.restrictions?.[purpose]?.[755];
      if (restriction !== undefined && ![0, 1, 2].includes(restriction)) return false;
      if (restriction === 0) return false;
      const consent = data.purpose?.consents?.[purpose] === true && data.vendor?.consents?.[755] === true;
      const legitimateInterest = data.purpose?.legitimateInterests?.[purpose] === true && data.vendor?.legitimateInterests?.[755] === true;
      if (restriction === 1) return consent;
      if (restriction === 2) return legitimateInterest;
      // Google defaults these flexible purposes to legitimate interest.
      return legitimateInterest;
    });
  };
  const usAllowsNpa = () => {
    const values = window.googlefc?.usstatesoptout?.InitialUsStatesOptOutStatusEnum;
    if (!values || typeof usStatus !== 'number' || gppChanging) return false;
    if (usStatus === values.DOES_NOT_APPLY) return true;
    return usStatus === values.NOT_OPTED_OUT && gppReady;
  };
  const canRequest = () => liveHost && config.monetizationEligible === true && !hasGpc()
    && !managing && !reloading && !suspended && state.advertising;
  const requestAds = () => {
    if (!adsLoaded || !canRequest()) return;
    document.querySelectorAll('ins[data-sfz-ad]').forEach((unit) => {
      if (requested.has(unit) || unit.dataset.adClient !== config.publisherId || !/^\d+$/.test(unit.dataset.adSlot || '')) return;
      const container = unit.closest('[data-sfz-ad-container]');
      if (!container) return;
      container.hidden = false;
      if (!unit.getClientRects().length || unit.getBoundingClientRect().width <= 0) return;
      requested.add(unit);
      // Only eligible visible units enter Google's queue, including on mobile.
      unit.classList.add('adsbygoogle');
      try { window.adsbygoogle.push({}); }
      catch { container.hidden = true; }
    });
  };
  const loadAds = () => {
    if (adsLoaded || !canRequest()) return;
    adsLoaded = true;
    const ads = window.adsbygoogle = window.adsbygoogle || [];
    // Both documented NPA controls are set before the Google ad script executes.
    ads.requestNonPersonalizedAds = 1;
    ads.pauseAdRequests = 0;
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.sfzAds = 'true';
    script.setAttribute('data-privacy-treatments', 'disablePersonalization');
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.publisherId)}`;
    script.onload = requestAds;
    script.onerror = pause;
    document.head.append(script);
  };
  const evaluate = () => {
    const tcfKnown = tcfData?.cmpStatus === 'loaded'
      && (tcfData?.gdprApplies === true || tcfData?.gdprApplies === false);
    const ready = apiReady && tcfKnown && (tcfData.gdprApplies === true || usStatus !== undefined);
    const permitted = ready && !frameworkError && !hasGpc() && !managing && !reloading && !suspended
      && (tcfData.gdprApplies === true ? tcfAllowsNpa(tcfData) : usAllowsNpa());
    if (adsLoaded && !permitted) pause();
    emit(ready, permitted && liveHost && config.monetizationEligible === true);
    if (state.advertising) loadAds();
  };
  const manage = () => {
    if (!liveHost || !apiReady || managing || reloading) return false;
    const fc = window.googlefc;
    const values = fc?.usstatesoptout?.InitialUsStatesOptOutStatusEnum;
    const eu = tcfData?.gdprApplies === true && typeof fc.showRevocationMessage === 'function';
    const us = !!values && (usStatus === values.NOT_OPTED_OUT || usStatus === values.OPTED_OUT)
      && typeof fc.usstatesoptout.openConfirmationDialog === 'function';
    if (!eu && !us) return false;
    managing = true;
    pause();
    fc.callbackQueue.push({ CONSENT_API_READY: () => {
      try {
        if (eu) fc.showRevocationMessage();
        else fc.usstatesoptout.openConfirmationDialog(() => reload());
      } catch { fallback(); }
    } });
    return true;
  };
  window.sfzPrivacy = {
    getState: () => ({ ...state }),
    subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); },
    manage,
    requestAds,
  };
  if (!liveHost) return;

  window.googlefc = window.googlefc || {};
  const fc = window.googlefc;
  fc.callbackQueue = fc.callbackQueue || [];
  fc.usstatesoptout = fc.usstatesoptout || {};
  // The footer provides an explicit Do Not Sell or Share entrypoint.
  fc.usstatesoptout.overrideDnsLink = true;
  fc.callbackQueue.push({ CONSENT_API_READY: () => {
    apiReady = true;
    if (typeof window.__tcfapi === 'function') {
      window.__tcfapi('addEventListener', 0, (data, success) => {
        if (!success || !data || data.cmpStatus === 'error') { frameworkError = true; tcfData = undefined; pause(); return; }
        tcfData = data;
        if (data.gdprApplies === true && data.eventStatus === 'cmpuishown') { pause(); return; }
        if (data.gdprApplies === true && ['tcloaded', 'useractioncomplete'].includes(data.eventStatus)
          && ((adsLoaded && !managing && (suspended || !tcfAllowsNpa(data)))
            || (managing && data.eventStatus === 'useractioncomplete'))) { reload(); return; }
        evaluate();
      });
    }
    if (typeof window.__gpp === 'function') {
      window.__gpp('addEventListener', (event, success) => {
        if (!success || !event?.pingData || event.eventName === 'error') { frameworkError = true; gppReady = false; pause(); return; }
        const ping = event.pingData;
        gppReady = ping.cmpStatus === 'loaded' && ping.signalStatus === 'ready';
        if (gppSeenReady && (!gppReady || event.eventName === 'sectionChange')) gppChanging = true;
        const fingerprint = JSON.stringify([ping.gppString, ping.applicableSections]);
        if (gppSeenReady && fingerprint !== gppFingerprint) gppChanging = true;
        if (gppChanging && tcfData?.gdprApplies === false) {
          pause();
          // The initial-status getter is deliberately not reused after a change.
          // Reload reads Google's new stored decision and unloads active ad code.
          if (gppReady) reload();
          return;
        }
        if (gppReady) { gppSeenReady = true; gppFingerprint = fingerprint; }
        evaluate();
      });
    }
  } });
  fc.callbackQueue.push({ INITIAL_US_STATES_OPT_OUT_DATA_READY: () => {
    try { usStatus = fc.usstatesoptout.getInitialUsStatesOptOutStatus(); }
    catch { usStatus = undefined; }
    evaluate();
  } });
  window.addEventListener('resize', requestAds);
  window.addEventListener('pageshow', (event) => { if (event.persisted) reload(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && hasGpc()) { pause(); if (adsLoaded) reload(); }
  });
  const cmp = document.createElement('script');
  cmp.async = true;
  cmp.src = config.cmpScriptUrl;
  cmp.dataset.sfzCmp = 'true';
  cmp.onerror = pause;
  document.head.append(cmp);
})();
