'use strict';
// The built-in browser's ad blocker (Ghostery's engine, using the same filter lists as uBlock Origin): adverts,
// pop-ups and trackers never load, including the adverts some sites play before and during their videos, so
// Start here / End here mark the real video. The filter lists are kept in the app data folder (engine.bin) and
// fetched fresh once a day. Grabs never go through this: the downloader gets the real video by itself.
//
// Wired up by hand (not Ghostery's enableBlockingInSession) so it can be switched off, or off for one site, at once,
// and so it can count what it stopped on the page that's showing.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const DAY = 24 * 3600 * 1000;
const COSMETIC = '@ghostery/adblocker/inject-cosmetic-filters';
const MUTATION = '@ghostery/adblocker/is-mutation-observer-enabled';

function hostOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : ''; } catch (_) { return ''; }
}
// A site is allowed when its address ends with an allowed one (allowing youtube.com covers m.youtube.com)
function allowedIn(list, host) {
  return !!host && list.some((a) => host === a || host.endsWith('.' + a));
}

function createAdblock({ session, dataDir, fetch, log, pageUrl, isOn, allowList, onChange }) {
  let lib = null, engine = null, count = 0, changeTimer = null;
  const cache = path.join(dataDir, 'adblock-engine.bin');
  const changed = () => { if (!changeTimer) changeTimer = setTimeout(() => { changeTimer = null; onChange(); }, 250); };
  const pageHost = () => hostOf(pageUrl());
  // Blocking this page right now?
  const active = () => !!engine && isOn() && !allowedIn(allowList(), pageHost());


  async function fromCache() {
    try {
      const st = await fsp.stat(cache);
      const e = lib.ElectronBlocker.deserialize(new Uint8Array(await fsp.readFile(cache)));
      return { engine: e, age: Date.now() - st.mtimeMs };
    } catch (_) { return null; }   // no cache yet, or one from an older version of the engine
  }
  async function fresh() {
    const e = await lib.ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, { loadCosmeticFilters: true, loadNetworkFilters: true });
    try { await fsp.writeFile(cache, Buffer.from(e.serialize())); } catch (err) { log('adblock: lists not cached: ' + err.message); }
    return e;
  }

  function wire() {
    const { ipcMain } = require('electron');
    // Network: adverts and trackers are refused (or swapped for a harmless stand-in) before they load
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
      if (!active() || details.resourceType === 'mainFrame') { cb({}); return; }
      engine.onBeforeRequest(details, (r) => {
        if (r && (r.cancel || r.redirectURL)) { count++; changed(); }
        cb(r);
      });
    });
    session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, cb) => {
      if (!active()) { cb({}); return; }
      engine.onHeadersReceived(details, cb);
    });
    // On the page: hides advert boxes and runs the lists' small fixes (the ones that stop video adverts)
    session.registerPreloadScript({ type: 'frame', filePath: require.resolve('@ghostery/adblocker-electron-preload') });
    ipcMain.handle(COSMETIC, (event, url, msg) => (active() ? engine.onInjectCosmeticFilters(event, url, msg) : undefined));
    ipcMain.handle(MUTATION, (event) => (active() ? engine.onIsMutationObserverEnabled(event) : false));
  }

  const ready = (async () => {
    try {
      lib = require('@ghostery/adblocker-electron');
      const cached = await fromCache();
      if (cached) {
        engine = cached.engine;
        log('adblock: ready (lists from ' + Math.round(cached.age / 3600000) + ' h ago)');
      }
      wire();
      if (!cached) {
        engine = await fresh();
        log('adblock: ready (lists fetched)');
      } else if (cached.age > DAY) {
        // Fresh lists in the background; the old ones keep working until they arrive
        fresh().then((e) => { engine = e; log('adblock: lists updated'); }).catch((err) => log('adblock: lists not updated: ' + err.message));
      }
      changed();
      return true;
    } catch (err) {
      log('adblock: not running: ' + (err.stack || err.message));
      changed();
      return false;
    }
  })();

  return {
    ready,
    hostOf,
    // A new page: the count starts again
    newPage() { count = 0; changed(); },
    state() {
      const host = pageHost();
      return { ready: !!engine, on: !!isOn(), host, allowed: allowedIn(allowList(), host), active: active(), count };
    },
    // For the self-test: would this address be stopped on this page?
    wouldBlock(url, from) {
      if (!engine) return false;
      const req = lib.Request.fromRawDetails({ url, sourceUrl: from, type: 'script' });
      return !!engine.match(req).match;
    },
  };
}

module.exports = { createAdblock, hostOf, allowedIn };
