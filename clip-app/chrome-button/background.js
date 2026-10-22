'use strict';
// Send to Phosphor Clips: the button and right-click menu that hand what you're watching in Chrome to Phosphor Clips
// on the same computer.
//   The button:              a small menu (popup.html): Start here / End here while the video plays, then Grab, so
//                            only the marked part downloads; or open the page in Phosphor Clips' browser, its video
//                            picking up where you were
//   Right-click a video:     "Send this video to Phosphor Clips" (opens the page, picking the video up there)
//   Right-click a GIF:       "Grab this GIF with Phosphor Clips" (straight to the trimmer)
//   Right-click a link:      "Open link in Phosphor Clips"
// It talks to Phosphor Clips' sharing server (http://127.0.0.1:47811, or 47812/47813). When Phosphor Clips isn't
// running, it opens a page with a button that starts it through a phosphor-clips:// link carrying the same request.
// All the talking happens here in the background: Chrome lets an extension's own pages reach programs on this
// computer without asking, but not scripts inside web pages.

const PORTS = [47811, 47812, 47813];
const VERSION = chrome.runtime.getManifest().version;
let port = 0;   // the port Phosphor Clips answered on last

// Is version a newer than b? ('1.10.0' > '1.9.2')
function newer(a, b) {
  const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
// Phosphor Clips keeps this button's files up to date in the folder Chrome loads them from. When it says its files are
// newer than the ones running, the button reloads itself to pick them up (once per version, in case it was loaded
// from somewhere else and reloading changes nothing).
let reloading = false;
// Whether the button's menu is open (reloading would close it under the mouse)
async function menuOpen() {
  try { return (await chrome.runtime.getContexts({})).some((c) => /\/popup\.html/.test(c.documentUrl || '')); }
  catch (_) { return false; }
}
async function updateIfNewer(theirs) {
  if (!theirs || !newer(theirs, VERSION) || reloading) return;
  reloading = true;
  try {
    const { reloadFor } = await chrome.storage.local.get('reloadFor');
    if (reloadFor === theirs) { reloading = false; return; }
    // Wait for the menu to close (each check also keeps this background awake; if Chrome stops it anyway, nothing
    // is noted and the next ping tries again)
    for (let i = 0; i < 900 && (await menuOpen()); i++) await new Promise((r) => setTimeout(r, 1000));
    await chrome.storage.local.set({ reloadFor: theirs });   // once per version, so it can never loop
    setTimeout(() => chrome.runtime.reload(), 300);
  } catch (_) { reloading = false; /* fine: next time */ }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(p, path, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeout || 2500);
  try {
    return await fetch(`http://127.0.0.1:${p}${path}`, { ...opts, signal: ac.signal, cache: 'no-store' });
  } finally { clearTimeout(t); }
}
// The port Phosphor Clips is on, or 0 if it isn't running
async function findApp() {
  const order = port ? [port, ...PORTS.filter((p) => p !== port)] : PORTS;
  for (const p of order) {
    try {
      const r = await call(p, '/ping', { timeout: 1200 });
      const j = r.ok ? await r.json() : {};
      if (j.app === 'Phosphor Clips') { port = p; updateIfNewer(j.button); return p; }
    } catch (_) { /* not there */ }
  }
  port = 0;
  return 0;
}

// Sends a request to open; resolves { ok, message } or { ok: false, notRunning: true }
async function sendToApp(req) {
  const p = await findApp();
  if (!p) return { ok: false, notRunning: true };
  try {
    const r = await call(p, '/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...req, v: VERSION }), timeout: 5000 });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, message: j.message || 'Sent' } : { ok: false, message: j.message || `Phosphor Clips said no (${r.status}).` };
  } catch (e) {
    return { ok: false, notRunning: true };
  }
}

// A phosphor-clips:// link with the request in it, for starting Phosphor Clips when it isn't running
function appLink(req) {
  const bytes = new TextEncoder().encode(JSON.stringify(req));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'phosphor-clips://open?d=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------- feedback on the button ---------- */
async function flash(tabId, ok, title) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: ok ? '#2e9e6b' : '#d93a3f' });
    await chrome.action.setBadgeText({ tabId, text: ok ? '✓' : '!' });
    await chrome.action.setTitle({ tabId, title: title || 'Send to Phosphor Clips' });
  } catch (_) { /* the tab went away */ }
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    chrome.action.setTitle({ tabId, title: 'Send to Phosphor Clips' }).catch(() => {});
  }, 4000);
}
// The page that explains what happened, beside the tab: Phosphor Clips not running (with a Start button), or a page
// that can't be sent
function explain(tab, why, req, message) {
  const q = new URLSearchParams({ why });
  if (req) q.set('link', appLink(req));
  if (message) q.set('m', message);
  const at = tab && typeof tab.index === 'number' ? { index: tab.index + 1, openerTabId: tab.id } : {};
  return chrome.tabs.create({ url: chrome.runtime.getURL('explain.html') + '?' + q, ...at });
}

/* ---------- reading the page's video ---------- */
// Runs in each frame of the page: the main video there (the biggest on screen, a playing one first), and its time.
// src: when given, the video playing that address (the one right-clicked) wins.
function probeVideo(src) {
  let best = null, top = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    let score = (w * h + 1) * (v.paused ? 1 : 4) * (v.readyState > 0 ? 1 : 0.05);
    if (src && (v.currentSrc === src || v.src === src)) score *= 1e6;
    if (score > top) { top = score; best = v; }
  }
  if (!best) return null;
  const s = best.currentSrc || best.src || '';
  return { t: best.currentTime || 0, d: isFinite(best.duration) ? best.duration : 0, paused: best.paused, score: top,
    src: /^https?:/.test(s) ? s : '' };
}
// Pauses the page's videos and sounds once it's been handed over, so they don't play twice
function pauseAll() { document.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); } catch (_) { /* fine */ } }); }

async function videoTime(tabId, frameId, src) {
  try {
    const target = frameId != null ? { tabId, frameIds: [frameId] } : { tabId, allFrames: true };
    const res = await chrome.scripting.executeScript({ target, func: probeVideo, args: [src || ''] });
    let best = null;
    for (const r of res || []) if (r && r.result && (!best || r.result.score > best.score)) best = r.result;
    return best;
  } catch (_) { return null; }   // a page Chrome doesn't let extensions read (the Web Store, say)
}
async function pausePage(tabId) {
  try { await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: pauseAll }); } catch (_) { /* fine */ }
}

const isWeb = (u) => /^https?:\/\//i.test(u || '');

/* ---------- what the button and the menu do ---------- */
async function handOver(tab, req, { pause = true } = {}) {
  const r = await sendToApp(req);
  if (r.ok) {
    flash(tab.id, true, 'Sent to Phosphor Clips');
    if (pause) pausePage(tab.id);
  } else if (r.notRunning) {
    flash(tab.id, false, 'Phosphor Clips isn’t running');
    explain(tab, 'notRunning', req);
  } else {
    flash(tab.id, false, r.message);
    explain(tab, 'refused', null, r.message);
  }
  return r;
}

async function sendPage(tab) {
  if (!tab || !isWeb(tab.url)) {
    flash(tab && tab.id, false, 'Only web pages can be sent');
    explain(tab, 'notWeb');
    return { ok: false, message: 'Only web pages can be sent' };
  }
  const v = await videoTime(tab.id);
  const req = { kind: 'page', url: tab.url, title: tab.title || '', t: v ? Math.round(v.t * 10) / 10 : 0 };
  return handOver(tab, req, { pause: !!v });
}

async function onMenu(info, tab) {
  const page = info.pageUrl || (tab && tab.url) || '';
  if (info.menuItemId === 'video') {
    const src = isWeb(info.srcUrl) ? info.srcUrl : '';
    const v = tab ? await videoTime(tab.id, info.frameId, info.srcUrl) : null;
    const url = isWeb(page) ? page : src;
    if (!url) return { ok: false };
    return handOver(tab, { kind: 'video', url, title: (tab && tab.title) || '', t: v ? Math.round(v.t * 10) / 10 : 0, src });
  }
  if (info.menuItemId === 'gif' && isWeb(info.srcUrl)) {
    return handOver(tab, { kind: 'gif', url: info.srcUrl, referer: isWeb(page) ? page : '', title: (tab && tab.title) || '' }, { pause: false });
  }
  if (info.menuItemId === 'link' && isWeb(info.linkUrl)) {
    return handOver(tab, { kind: 'link', url: info.linkUrl, title: info.selectionText || '' }, { pause: false });
  }
  return { ok: false };
}

function makeMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'video', title: 'Send this video to Phosphor Clips', contexts: ['video'] });
    chrome.contextMenus.create({
      id: 'gif', title: 'Grab this GIF with Phosphor Clips', contexts: ['image'],
      targetUrlPatterns: ['*://*/*.gif', '*://*/*.gif?*', '*://*/*.GIF', '*://*/*.gifv', '*://*/*.gifv?*'],
    });
    chrome.contextMenus.create({ id: 'link', title: 'Open link in Phosphor Clips', contexts: ['link'] });
  });
}

// Says hello, so Phosphor Clips' setup helper can show that the button is in
async function hello() {
  for (let i = 0; i < 3; i++) {
    const p = await findApp();
    if (p) { try { await call(p, '/hello', { method: 'POST', body: JSON.stringify({ v: VERSION }) }); } catch (_) { /* fine */ } return; }
    await wait(1500);
  }
}
chrome.runtime.onInstalled.addListener(() => { makeMenus(); hello(); });
chrome.runtime.onStartup.addListener(() => { makeMenus(); hello(); });
chrome.contextMenus.onClicked.addListener((info, tab) => { onMenu(info, tab); });
// The marks of a closed tab are forgotten
chrome.tabs.onRemoved.addListener((tabId) => { chrome.storage.session.remove('marks:' + tabId).catch(() => {}); });

/* ---------- the menu (popup.js) asks the background to do the talking ---------- */
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  (async () => {
    if (m.type === 'status') return { running: !!(await findApp()), version: VERSION };
    const tab = await chrome.tabs.get(m.tabId).catch(() => null);
    if (!tab) return { ok: false, message: 'That tab is gone.' };
    if (m.type === 'page') return sendPage(tab);
    if (m.type === 'grab') return handOver(tab, m.req, { pause: true });
    return { ok: false };
  })().then(reply, (e) => reply({ ok: false, message: e.message }));
  return true;   // the answer comes later
});

// For the tests (test/chrome_test.py), which can't click Chrome's own toolbar or menus
self.__clips = { sendPage, onMenu, findApp, appLink, sendToApp, newer, updateIfNewer, VERSION };
