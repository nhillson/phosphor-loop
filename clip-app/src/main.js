'use strict';
// Phosphor Clips: one window with a web browser on the left and the grabbing controls on the right. Watch a video,
// mark the part you want, grab it, trim it, pick its category (the app suggests one), and it's saved into the clip
// library (Videos\Phosphor Clips, a folder per category) as an MP4 Phosphor Loop can play.
const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, dialog, Menu, clipboard, utilityProcess, Tray, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const E = require('./engine.js');
const { Library } = require('./library.js');
const { Vision, combine } = require('./vision.js');
const { startServer } = require('./server.js');

const TEST = process.env.CLIPS_TEST === '1';
const START_PAGE = pathToFileURL(path.join(__dirname, 'start', 'index.html')).href;
const WEB_PARTITION = 'persist:web';
// Links like phosphor-clips://open?d=... start Phosphor Clips from Chrome's Send to Phosphor Clips button when the app
// isn't running (when it is, the button talks to it through the library-sharing server instead)
const PROTOCOL = 'phosphor-clips';
// Started by Windows at sign-in: sit by the clock sharing the library, without opening the window
let startHidden = process.argv.includes('--hidden');
let quitting = false;

if (TEST) app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.CLIPS_DATA) app.setPath('userData', process.env.CLIPS_DATA);
if (!TEST && !app.requestSingleInstanceLock()) app.exit(0);

/* ---------- log (the app data folder's log.txt: the first place to look when something goes wrong) ---------- */
const dataDir = () => app.getPath('userData');
let logStream = null;
function log(text) {
  const line = new Date().toISOString().replace('T', ' ').slice(0, 19) + '  ' + text;
  if (!app.isPackaged || TEST) console.log(line);
  try {
    if (!logStream) {
      fs.mkdirSync(dataDir(), { recursive: true });
      const f = path.join(dataDir(), 'log.txt');
      try { if (fs.statSync(f).size > 2e6) fs.renameSync(f, f + '.old'); } catch (_) { /* new log */ }
      logStream = fs.createWriteStream(f, { flags: 'a' });
    }
    logStream.write(line + '\n');
  } catch (_) { /* never let logging stop the app */ }
}

/* ---------- settings ---------- */
const settingsFile = () => path.join(dataDir(), 'settings.json');
let settings = {};
function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (_) { /* first run */ }
  settings = { libraryDir: '', keepSound: false, maxHeight: 1080, ytdlpChecked: 0, startWithWindows: null, toldTray: false, chromeSeen: '', ...s };
  if (process.env.CLIPS_LIBRARY) settings.libraryDir = process.env.CLIPS_LIBRARY;
  if (!settings.libraryDir) settings.libraryDir = path.join(app.getPath('videos'), 'Phosphor Clips');
  if (![720, 1080, 1440, 2160].includes(+settings.maxHeight)) settings.maxHeight = 1080;
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) { log('settings not saved: ' + e.message); }
}

/* ---------- the helper programs ---------- */
let tools = {};
function findTools() {
  tools = E.findTools([path.join(dataDir(), 'bin'), path.join(process.resourcesPath || '', 'bin'), path.join(__dirname, '..', 'vendor')]);
  log('tools: ' + JSON.stringify(tools));
}
// Sites change all the time and yt-dlp keeps up, so the app keeps its own copy of yt-dlp up to date (once a day)
async function keepYtdlpFresh() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const bundled = path.join(process.resourcesPath, 'bin', 'yt-dlp.exe');
  const mine = path.join(dataDir(), 'bin', 'yt-dlp.exe');
  const version = (exe) => new Promise((r) => execFile(exe, ['--version'], { windowsHide: true, timeout: 60000 }, (e, out) => r(e ? '' : String(out).trim())));
  try {
    if (!fs.existsSync(bundled)) return;
    if (!fs.existsSync(mine) || (await version(bundled)) > (await version(mine))) {
      await fsp.mkdir(path.dirname(mine), { recursive: true });
      await fsp.copyFile(bundled, mine);
      findTools();
    }
    if (Date.now() - (settings.ytdlpChecked || 0) < 24 * 3600 * 1000) return;
    settings.ytdlpChecked = Date.now();
    saveSettings();
    execFile(mine, ['-U'], { windowsHide: true, timeout: 5 * 60 * 1000 }, (e, out, err) => log('yt-dlp update: ' + String(out || err || (e && e.message) || '').trim().split(/\r?\n/).pop()));
  } catch (e) { log('yt-dlp update skipped: ' + e.message); }
}

/* ---------- the clip library ---------- */
let library = null;
async function openLibrary() {
  library = new Library(settings.libraryDir, {
    probe: (f) => E.probe(tools, f),
    thumb: (v, out, t) => E.frameAt(tools, v, t, out, { width: 480 }),
    trash: (f) => shell.trashItem(f).catch(() => fsp.rm(f, { force: true })),
    log,
  });
  await library.open();
  log('library: ' + library.dir + ' (' + library.data.clips.length + ' clips)');
  sendLibrary();
}
const fileUrl = (p, bust) => (p ? pathToFileURL(p).href + (bust ? '?v=' + bust : '') : '');
function clipForPanel(c) {
  let t = 0;
  try { t = c.t ? Math.round(fs.statSync(library.thumbAbs(c)).mtimeMs) : 0; } catch (_) { /* no thumbnail yet */ }
  return { ...c, url: fileUrl(library.abs(c)), thumb: t ? fileUrl(library.thumbAbs(c), t) : '' };
}
function libraryForPanel() {
  if (!library) return null;
  const d = library.data;
  return {
    dir: library.dir,
    cats: d.cats.map((c) => ({ id: c.id, n: c.n, count: d.clips.filter((x) => x.c === c.id).length })),
    clips: d.clips.slice().sort((a, b) => String(b.added || '').localeCompare(String(a.added || ''))).map(clipForPanel),
  };
}
const catName = (id) => { const c = library && library.cat(id); return c ? c.n : id; };

/* ---------- the picture recogniser ---------- */
let vision = null;
let visionState = { text: '', pct: 0, ready: false, error: '' };
function startVision() {
  vision = new Vision({
    cacheDir: path.join(dataDir(), 'models'),
    log,
    onStatus: (s) => { visionState = { ...visionState, ...s }; if (s.ready) visionState.text = ''; send('vision', visionState); },
    fork: (script) => {
      const child = utilityProcess.fork(script, [], { serviceName: 'Phosphor Clips picture recogniser', stdio: 'pipe' });
      const pipeLog = (s) => s && s.on('data', (d) => String(d).split(/\r?\n/).filter((l) => l.trim()).forEach((l) => log('vision: ' + l.slice(0, 300))));
      pipeLog(child.stdout);
      pipeLog(child.stderr);
      return child;
    },
  });
  if (process.env.CLIPS_NO_VISION !== '1') vision.warm();
}

/* ---------- window and the built-in browser ---------- */
let win = null, web = null, webShown = true;
let webBounds = { x: 0, y: 0, width: 0, height: 0 };
let panelReady = false;

function send(channel, data) {
  if (win && !win.isDestroyed() && panelReady) win.webContents.send(channel, data);
}

function chromeUA(ua) {
  return ua.replace(/\s(?:Electron|phosphor-clips|Phosphor Clips)\/[\d.]+/gi, '');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1060, minHeight: 680, backgroundColor: '#141216', title: 'Phosphor Clips',
    icon: path.join(__dirname, 'icon.png'), show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-panel.js'), contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  // A file dropped on the window is grabbed, never opened in place of the controls
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'panel', 'index.html'));

  web = new WebContentsView({ webPreferences: { partition: WEB_PARTITION, contextIsolation: true, sandbox: true } });
  web.setBackgroundColor('#ffffff');
  win.contentView.addChildView(web);
  web.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  setupWeb();

  win.once('ready-to-show', () => {
    if (startHidden && !TEST) { startHidden = false; return; }
    if (!TEST) win.maximize();
    win.show();
  });
  // Closing the window keeps Phosphor Clips running by the clock, so Phosphor Loop can still use the library
  win.on('close', (e) => {
    if (quitting || TEST || !tray) return;
    e.preventDefault();
    win.hide();
    pauseWebMedia();
    if (!settings.toldTray) {
      settings.toldTray = true;
      saveSettings();
      try { tray.displayBalloon({ title: 'Phosphor Clips is still running', content: 'It keeps sharing your clips with Phosphor Loop. Right-click its icon by the clock to quit.', iconType: 'info' }); } catch (_) { /* no balloons here */ }
    }
  });
  win.on('closed', () => { win = null; web = null; });
}

function webState() {
  if (!web || web.webContents.isDestroyed()) return {};
  const wc = web.webContents;
  const url = wc.getURL();
  return {
    url: url === START_PAGE || url.startsWith('file:') ? '' : url, title: wc.getTitle(), loading: wc.isLoading(),
    back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward(), home: url.startsWith('file:'),
  };
}
let webSendTimer = null;
function sendWeb() {
  if (webSendTimer) return;
  webSendTimer = setTimeout(() => { webSendTimer = null; send('web', webState()); }, 60);
}

function setupWeb() {
  const wc = web.webContents;
  const ses = wc.session;
  ses.setUserAgent(chromeUA(ses.getUserAgent()));
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission)));
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) wc.loadURL(url);
    return { action: 'deny' };
  });
  wc.on('did-navigate', (_e, url) => { onPageChange(url); sendWeb(); });
  wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) onPageChange(url); sendWeb(); });
  for (const ev of ['page-title-updated', 'did-start-loading', 'did-stop-loading']) wc.on(ev, sendWeb);
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain && code !== -3) log('page failed: ' + url + ' ' + desc); });
  wc.on('render-process-gone', (_e, d) => { log('page crashed: ' + d.reason); if (d.reason !== 'clean-exit') wc.reload(); });
  wc.on('context-menu', (_e, p) => webMenu(p));
  // A video or GIF the page itself downloads (a site's own Download button) is grabbed like any other
  ses.on('will-download', (_e, item) => onWebDownload(item));
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) { wc.reload(); e.preventDefault(); }
    if (input.alt && input.key === 'ArrowLeft' && wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); e.preventDefault(); }
    if (input.alt && input.key === 'ArrowRight' && wc.navigationHistory.canGoForward()) { wc.navigationHistory.goForward(); e.preventDefault(); }
  });
  wc.loadURL(START_PAGE);
}

let webWasShown = true;
function placeWeb() {
  if (!web) return;
  web.setVisible(webShown);
  web.setBounds(webShown ? webBounds : { x: 0, y: 0, width: 0, height: 0 });
  // The page's video stops while it's out of sight (the trimmer or the library is showing), so its sound
  // doesn't play over the clip being trimmed
  if (webWasShown && !webShown) pauseWebMedia();
  webWasShown = webShown;
}
function pauseWebMedia() {
  try {
    for (const f of web.webContents.mainFrame.framesInSubtree) f.executeJavaScript('document.querySelectorAll("video, audio").forEach((m) => m.pause())').catch(() => {});
  } catch (_) { /* page gone */ }
}

function webMenu(p) {
  const wc = web.webContents;
  const items = [];
  const src = /^https?:/i.test(p.srcURL || '') ? p.srcURL : '';
  if (p.mediaType === 'video') {
    items.push({ label: 'Grab this video', click: () => grabFromPage({ direct: src }) });
  } else if (p.mediaType === 'image' && src && /\.(gifv?|webp)(?:[?#]|$)/i.test(src)) {
    items.push({ label: 'Grab this GIF', click: () => startJob({ url: src, referer: wc.getURL(), pageTitle: wc.getTitle() }) });
  }
  if (p.linkURL && /^https?:/i.test(p.linkURL)) {
    items.push({ label: 'Grab the video at this link', click: () => startJob({ url: p.linkURL, referer: wc.getURL() }) });
  }
  if (!items.length && /^https?:/.test(wc.getURL())) items.push({ label: 'Grab the video on this page', click: () => grabFromPage({}) });
  if (items.length) items.push({ type: 'separator' });
  if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' });
  else if (p.selectionText) items.push({ role: 'copy' }, { type: 'separator' });
  items.push(
    { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Reload', click: () => wc.reload() },
  );
  if (p.linkURL) items.push({ label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) });
  if (/^https?:/.test(wc.getURL())) items.push({ label: 'Copy page address', click: () => clipboard.writeText(wc.getURL()) });
  Menu.buildFromTemplate(items).popup({ window: win });
}

/* ---------- the video playing in the browser, and the marked part ---------- */
// Runs in each frame of the page: finds the main video (the biggest one on screen, a playing one first)
const PROBE_JS = `(() => {
  let best = null, top = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const score = (w * h + 1) * (v.paused ? 1 : 4) * (v.readyState > 0 ? 1 : 0.05);
    if (score > top) { top = score; best = v; }
  }
  if (!best) return null;
  const src = best.currentSrc || best.src || '';
  return { t: best.currentTime, d: isFinite(best.duration) ? best.duration : 0, paused: best.paused, score: top,
    src: /^https?:/.test(src) ? src : '', w: best.videoWidth, h: best.videoHeight };
})()`;

let video = null;
let marks = { page: '', start: null, end: null };
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

async function readVideo() {
  if (!web || web.webContents.isDestroyed()) return null;
  const wc = web.webContents;
  if (!/^https?:/.test(wc.getURL()) && !TEST) return null;
  let best = null;
  let frames = [];
  try { frames = wc.mainFrame.framesInSubtree; } catch (_) { return null; }
  await Promise.all(frames.map(async (f) => {
    try {
      const r = await withTimeout(f.executeJavaScript(PROBE_JS), 1500);
      if (r && (!best || r.score > best.score)) best = { ...r, frameUrl: f.url, sub: f !== wc.mainFrame, frame: f };
    } catch (_) { /* a frame that went away */ }
  }));
  return best;
}

function pageKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of ['t', 'start', 'time_continue', 'si', 'feature']) u.searchParams.delete(k);
    return u.href;
  } catch (_) { return url; }
}
function onPageChange(url) {
  const k = pageKey(url);
  // A page sent from Chrome: its address once loaded (after any redirect) is the one whose video is picked up; going
  // to another page after that forgets the pick-up
  if (pendingSeek) {
    if (!pendingSeek.page) pendingSeek.page = k;
    else if (pendingSeek.page !== k) pendingSeek = null;
  }
  if (k !== marks.page) { marks = { page: k, start: null, end: null }; sendVideo(); }
}
function videoState() {
  return {
    has: !!video, t: video ? video.t : 0, d: video ? video.d : 0, paused: video ? video.paused : true,
    w: video ? video.w : 0, h: video ? video.h : 0, start: marks.start, end: marks.end,
  };
}
const sendVideo = () => send('video', videoState());
let polling = false;
function pollVideo() {
  setInterval(async () => {
    if (polling || !webShown || !win || win.isMinimized() || !win.isVisible()) return;
    polling = true;
    try {
      video = await readVideo();
      if (pendingSeek) await applySeek(video);
      sendVideo();
    } finally { polling = false; }
  }, 400);
}

/* ---------- pages, videos and GIFs sent from Chrome (the Send to Phosphor Clips button, chrome-button/) ---------- */
// A page sent with the time its video was at: once that page's video can play, it jumps there and plays
let pendingSeek = null;
const SEEK_JS = (t) => `(() => {
  let best = null, top = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    const score = (Math.max(0, r.width) * Math.max(0, r.height) + 1) * (v.readyState > 0 ? 1 : 0.05);
    if (score > top) { top = score; best = v; }
  }
  if (!best || !(best.duration > ${t})) return false;
  best.currentTime = ${t};
  best.play().catch(() => {});
  return true;
})()`;
async function applySeek(v) {
  const ps = pendingSeek;
  if (!ps || !web) return;
  if (Date.now() > ps.until) { log('chrome: gave up picking the video up at ' + ps.t.toFixed(1) + ' s'); pendingSeek = null; return; }
  if (!ps.page || pageKey(web.webContents.getURL()) !== ps.page || !v || !v.frame || !(v.d > ps.t)) return;
  let done = false;
  try { done = await withTimeout(v.frame.executeJavaScript(SEEK_JS(ps.t)), 1500); } catch (_) { /* the frame went away */ }
  if (done && pendingSeek === ps) {
    pendingSeek = null;
    log('chrome: picked the video up at ' + ps.t.toFixed(1) + ' s');
  }
}

// YouTube honours a start time in the address (and starts there after any advert), so it gets one too
function withStartTime(url, t) {
  try {
    const u = new URL(url);
    if (t >= 1 && /(^|\.)youtube\.com$/i.test(u.hostname) && u.pathname === '/watch') u.searchParams.set('t', Math.floor(t) + 's');
    return u.href;
  } catch (_) { return url; }
}

// Brings the window up from the clock and in front of Chrome
function bringToFront() {
  if (!win) return;
  startHidden = false;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) { if (!TEST) win.maximize(); win.show(); }
  if (!TEST) { win.setAlwaysOnTop(true); win.moveTop(); }
  win.focus();
  if (!TEST) setTimeout(() => { if (win) win.setAlwaysOnTop(false); }, 300);
}

let pendingOpens = [];
// What the Chrome button sent: { kind: 'page' | 'video' | 'gif' | 'link', url, title, t, src, referer }
function openFromChrome(o, via) {
  const url = String(o.url || '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, message: 'Only web pages (http or https) can be opened.' };
  if (!win || !web || !library) { pendingOpens.push([o, via]); return { ok: true, message: 'Opening Phosphor Clips\u2026' }; }
  const kind = ['page', 'video', 'gif', 'link'].includes(o.kind) ? o.kind : 'page';
  const title = String(o.title || '').slice(0, 200);
  log('chrome: ' + kind + ' ' + url + (o.t ? ' at ' + (+o.t).toFixed(1) + ' s' : '') + ' (' + via + ')');
  if (via !== 'link' && settings.chromeSeen !== 'used') { settings.chromeSeen = 'used'; saveSettings(); send('chrome', { seen: 'used' }); }
  bringToFront();
  if (kind === 'gif') {
    // Straight to the trimmer, like right-clicking a GIF inside Phosphor Clips
    send('reveal', { text: 'Grabbing the GIF from Chrome\u2026' });
    startJob({ url, referer: /^https?:/i.test(o.referer || '') ? o.referer : '', pageTitle: title });
    return { ok: true, message: 'Grabbing the GIF' };
  }
  const t = kind === 'link' ? 0 : Math.max(0, +o.t || 0);
  send('reveal', { text: kind === 'link' ? 'Opened the link from Chrome.' : 'Opened from Chrome' + (t >= 1 ? ', picking the video up where you were.' : '.') });
  const go = withStartTime(url, t);
  pendingSeek = t >= 1 ? { page: '', t, until: Date.now() + 60000 } : null;
  web.webContents.loadURL(go);
  return { ok: true, message: 'Opened in Phosphor Clips' };
}
function flushPendingOpens() {
  const list = pendingOpens;
  pendingOpens = [];
  for (const [o, via] of list) openFromChrome(o, via);
}

// phosphor-clips://open?d=<the same request, as base64url JSON>, from the Chrome button when the app wasn't running
function openFromLink(arg) {
  try {
    const u = new URL(arg);
    if (u.protocol !== PROTOCOL + ':') return false;
    const d = u.searchParams.get('d');
    if (!d) { bringToFront(); return true; }
    const o = JSON.parse(Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    openFromChrome(o, 'link');
    return true;
  } catch (e) { log('chrome link not understood: ' + e.message); return false; }
}
const linkIn = (argv) => (argv || []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith(PROTOCOL + ':'));

/* ---------- the Chrome button's files: copied to a fixed folder Chrome loads them from ---------- */
const chromeDir = () => path.join(dataDir(), 'Chrome button');
function chromeSource() {
  for (const d of [path.join(process.resourcesPath || '', 'chrome-button'), path.join(__dirname, '..', 'chrome-button')]) {
    if (d && fs.existsSync(path.join(d, 'manifest.json'))) return d;
  }
  return '';
}
async function placeChromeButton() {
  const src = chromeSource();
  if (!src) { log('chrome button: files not found'); return; }
  const dest = chromeDir();
  const version = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')).version; } catch (_) { return ''; } };
  if (version(src) && version(src) === version(dest)) return;
  try {
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.cp(src, dest, { recursive: true });
    log('chrome button: files ' + version(src) + ' in ' + dest);
  } catch (e) { log('chrome button: ' + e.message); }
}

async function mark(which) {
  if (which === 'clear') { marks.start = null; marks.end = null; sendVideo(); return { ok: true }; }
  const v = await readVideo();
  video = v;
  if (!v) return { ok: false, message: 'There’s no video on this page yet. Start one playing, then mark it.' };
  marks.page = pageKey(web.webContents.getURL());
  let note = '';
  if (which === 'start') {
    marks.start = v.t;
    if (marks.end != null && marks.end <= v.t) marks.end = null;
  } else {
    if (marks.start == null) { marks.start = 0; note = 'The start is the beginning of the video.'; }
    if (v.t <= marks.start + 0.1) return { ok: false, message: 'The end has to come after the start.' };
    marks.end = v.t;
  }
  sendVideo();
  return { ok: true, message: note };
}

async function grabFromPage({ direct } = {}) {
  const wc = web.webContents;
  const pageUrl = wc.getURL();
  if (!/^https?:/.test(pageUrl) && !TEST) return { ok: false, message: 'Open a page with a video on it first.' };
  const v = await readVideo();
  let url = pageUrl;
  // A video in a frame from another site (a YouTube or Vimeo player inside a blog, say) is grabbed from that frame
  try { if (v && v.sub && /^https?:/.test(v.frameUrl) && new URL(v.frameUrl).origin !== new URL(pageUrl).origin) url = v.frameUrl; } catch (_) { /* keep the page */ }
  const m = marks.start != null ? { start: marks.start, end: marks.end != null ? marks.end : null } : null;
  startJob({ url, direct: direct || (v && v.src) || '', referer: pageUrl, pageTitle: wc.getTitle(), pageDuration: v ? v.d : 0, marks: m });
  marks.start = null; marks.end = null;
  sendVideo();
  return { ok: true };
}

/* ---------- grabbing jobs ---------- */
const jobs = new Map();
let jobSeq = 0;
const jobsDir = () => path.join(dataDir(), 'jobs');

function newJob(req) {
  const id = Date.now().toString(36) + '-' + ++jobSeq;
  const dir = path.join(jobsDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  let title = req.pageTitle || req.title || '';
  if (!title && req.url) title = E.titleFromUrl(req.url) || req.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60);
  const job = { id, req, dir, status: 'working', text: 'Starting…', pct: -1, part: 0, title: title || 'Video', ac: new AbortController(), looks: 0 };
  jobs.set(id, job);
  log('grab ' + id + ': ' + JSON.stringify({ ...req, cookies: undefined, cookieHeader: undefined }));
  sendJobs();
  return job;
}

function startJob(req) {
  const job = newJob(req);
  runJob(job);
  return job;
}

async function writeCookies() {
  const file = path.join(dataDir(), 'cookies.txt');
  try {
    const list = await session.fromPartition(WEB_PARTITION).cookies.get({});
    const lines = ['# Netscape HTTP Cookie File'];
    for (const c of list) {
      if (!c.domain || /[\t\n]/.test(c.value)) continue;
      lines.push([(c.httpOnly ? '#HttpOnly_' : '') + c.domain, c.domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/',
        c.secure ? 'TRUE' : 'FALSE', c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate), c.name, c.value].join('\t'));
    }
    await fsp.writeFile(file, lines.join('\n') + '\n');
    return file;
  } catch (e) { log('cookies: ' + e.message); return ''; }
}
async function cookieHeaderFor(url) {
  try { return (await session.fromPartition(WEB_PARTITION).cookies.get({ url })).map((c) => c.name + '=' + c.value).join('; '); } catch (_) { return ''; }
}

async function runJob(job) {
  const signal = job.ac.signal;
  try {
    const req = { ...job.req, maxHeight: +settings.maxHeight || 1080 };
    if (req.url && !req.file) {
      req.cookies = await writeCookies();
      req.cookieHeader = await cookieHeaderFor(req.direct || req.url);
    }
    const r = await E.fetchVideo(tools, req, job.dir, {
      signal, log,
      onStatus: (t) => { job.text = t; sendJobsSoon(); },
      onProgress: (p) => { job.pct = p.pct; job.part = p.part; sendJobsSoon(); },
    });
    job.result = r;
    if (r.info.title) job.title = r.info.title;
    job.text = 'Making the filmstrip…';
    job.pct = -1;
    sendJobs();
    job.strip = await E.frames(tools, r.playable, E.spread(0, r.probe.duration, 16), path.join(job.dir, 'strip'), 's', { width: 200, signal });
    job.range = firstRange(job);
    job.status = 'ready';
    job.text = 'Ready: trim it and pick a category';
    job.pct = 100;
    log('grab ' + job.id + ' ready: ' + r.probe.width + 'x' + r.probe.height + ' ' + r.probe.duration.toFixed(1) + ' s');
    sendJobs();
    suggest(job, job.range);
  } catch (e) {
    if (e.code === 'cancelled') { dropJob(job); return; }
    job.status = 'error';
    job.text = e.message;
    job.pct = -1;
    log('grab ' + job.id + ' failed: ' + e.message + (e.detail ? ' | ' + String(e.detail).replace(/\s+/g, ' ').slice(0, 400) : ''));
    sendJobs();
  }
}

// Where the trim handles start: the marked part, or the whole video
function firstRange(job) {
  const r = job.result;
  const d = r.probe.duration;
  if (r.marks && Number.isFinite(r.marks.start)) {
    const a = Math.min(Math.max(0, r.marks.start - r.offset), Math.max(0, d - 0.5));
    const endWas = Number.isFinite(r.marks.end) ? r.marks.end - r.offset : a + 10;
    return [round3(a), round3(Math.min(d, Math.max(a + 0.5, endWas)))];
  }
  return [0, round3(d)];
}
const round3 = (n) => Math.round(n * 1000) / 1000;

// The suggested category: words first (instant), then the picture recogniser's look at the chosen part
async function suggest(job, range, crop) {
  const r = job.result;
  if (!r) return;
  const info = { ...r.info, page: job.req.pageTitle, url: job.req.url };
  const cats = library.data.cats;
  if (!job.suggestion) job.suggestion = combine(null, info, cats);
  if (process.env.CLIPS_NO_VISION === '1' || (vision.broken && !vision.proc)) { sendJobs(); return; }
  const seq = ++job.looks;
  job.looking = true;
  sendJobs();
  try {
    const [a, b] = range || job.range || [0, r.probe.duration];
    // Only the part of the picture that's kept (a crop) is looked at
    const frames = await E.frames(tools, r.playable, E.spread(a, b, 4), path.join(job.dir, 'look'), 'l' + seq, { width: 336, crop: E.validCrop(crop) ? crop : null });
    const scores = await vision.classify(frames, cats);
    if (seq !== job.looks) return;
    job.suggestion = combine(scores, info, cats);
    log('grab ' + job.id + ' looks like ' + job.suggestion.id + ' (' + job.suggestion.sure + ', ' + job.suggestion.by + ')');
  } catch (e) {
    log('grab ' + job.id + ': no picture suggestion: ' + e.message);
  } finally {
    if (seq === job.looks) { job.looking = false; sendJobs(); }
  }
}

function jobForPanel(job) {
  const r = job.result;
  return {
    id: job.id, status: job.status, text: job.text, pct: job.pct, part: job.part, title: job.title,
    url: (r && r.info.url) || job.req.url || '', saved: job.saved || 0,
    video: r ? { url: fileUrl(r.playable), d: r.probe.duration, w: r.probe.width, h: r.probe.height, fps: r.probe.fps, sound: r.probe.hasAudio, offset: r.offset } : null,
    strip: (job.strip || []).map((f) => fileUrl(f)), range: job.range || null,
    suggestion: job.suggestion || null, looking: !!job.looking,
    info: r ? { by: r.info.by || '', lic: r.info.lic || '', site: r.info.site || '' } : {},
  };
}
let jobsTimer = null;
function sendJobs() {
  if (jobsTimer) { clearTimeout(jobsTimer); jobsTimer = null; }
  send('jobs', [...jobs.values()].map(jobForPanel));
}
function sendJobsSoon() { if (!jobsTimer) jobsTimer = setTimeout(sendJobs, 150); }
function sendLibrary() { send('library', libraryForPanel()); }

function dropJob(job) {
  jobs.delete(job.id);
  fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  sendJobs();
}

function onWebDownload(item) {
  const name = item.getFilename() || '';
  const mime = item.getMimeType() || '';
  const ext = (path.extname(name) || '').toLowerCase();
  const media = /^video\//.test(mime) || /image\/gif/.test(mime) || /^\.(mp4|m4v|webm|mov|mkv|gif)$/.test(ext);
  if (!media) return;   // anything else: Windows' usual Save dialog
  const wc = web.webContents;
  const job = newJob({ title: name.replace(/\.[^.]+$/, ''), pageTitle: wc.getTitle(), sourceUrl: wc.getURL(), url: item.getURL() });
  const file = path.join(job.dir, 'download' + (ext || (/gif/.test(mime) ? '.gif' : '.mp4')));
  item.setSavePath(file);
  job.text = 'Downloading…';
  job.cancel = () => item.cancel();
  item.on('updated', () => { const t = item.getTotalBytes(); job.pct = t ? (100 * item.getReceivedBytes()) / t : -1; sendJobsSoon(); });
  item.once('done', (_e, state) => {
    if (state !== 'completed') {
      if (state === 'cancelled' && job.ac.signal.aborted) { dropJob(job); return; }
      job.status = 'error'; job.text = 'The download stopped.'; sendJobs(); return;
    }
    job.req = { ...job.req, file, url: '' };
    runJob(job);
  });
  sendJobs();
}

/* ---------- the panel's requests ---------- */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return await fn(...args); } catch (e) {
      log(channel + ' failed: ' + (e.stack || e.message));
      return { ok: false, message: e.message || 'Something went wrong.' };
    }
  });
}

function setupIpc() {
  handle('panel:ready', () => {
    panelReady = true;
    return {
      version: app.getVersion(), sharing: sharingState(), chrome: { seen: settings.chromeSeen || '' },
      settings: { keepSound: !!settings.keepSound, maxHeight: +settings.maxHeight, startWithWindows: !!settings.startWithWindows },
      library: libraryForPanel(), jobs: [...jobs.values()].map(jobForPanel), web: webState(), video: videoState(), vision: visionState,
    };
  });

  handle('web:bounds', (rect) => {
    webBounds = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) };
    placeWeb();
  });
  handle('web:show', (on) => { webShown = !!on; placeWeb(); });
  handle('web:go', (text) => {
    let t = String(text || '').trim();
    if (!t) return;
    let url;
    if (/^https?:\/\//i.test(t)) url = t;
    else if (/^[^\s]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(t)) url = 'https://' + t;
    else url = 'https://duckduckgo.com/?q=' + encodeURIComponent(t) + '&iax=videos&ia=videos';
    web.webContents.loadURL(url);
  });
  handle('web:nav', (what) => {
    const wc = web.webContents;
    if (what === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (what === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    if (what === 'reload') wc.reload();
    if (what === 'stop') wc.stop();
    if (what === 'home') wc.loadURL(START_PAGE);
  });
  handle('web:open', (url) => { if (/^https?:/i.test(url)) web.webContents.loadURL(url); });
  handle('web:mark', (which) => mark(which));
  handle('web:grab', () => grabFromPage({}));

  handle('grab:url', (url) => {
    const u = String(url || '').trim();
    if (!/^https?:\/\/\S+$/i.test(u)) return { ok: false, message: 'That doesn’t look like a web link. It should start with https://' };
    startJob({ url: u });
    return { ok: true };
  });
  handle('grab:file', (file) => {
    if (!file || !fs.existsSync(file)) return { ok: false, message: 'That file couldn’t be found.' };
    startJob({ file, title: path.basename(file).replace(/\.[^.]+$/, '') });
    return { ok: true };
  });

  handle('job:stop', (id) => {
    const job = jobs.get(id);
    if (!job) return;
    job.ac.abort();
    if (job.cancel) job.cancel();
    if (job.status !== 'working') dropJob(job);
  });
  handle('job:dismiss', (id) => { const job = jobs.get(id); if (job && job.status !== 'working' && job.status !== 'saving') dropJob(job); });
  handle('job:retry', (id) => {
    const job = jobs.get(id);
    if (!job || job.status !== 'error') return;
    dropJob(job);
    startJob(job.req);
  });
  handle('job:suggest', ({ id, start, end, crop }) => {
    const job = jobs.get(id);
    if (job && job.result) { job.range = [start, end]; suggest(job, [start, end], crop); }
  });
  handle('job:save', async (o) => {
    const job = jobs.get(o.id);
    if (!job || job.status !== 'ready') return { ok: false, message: 'That video isn’t ready.' };
    if (!library.cat(o.cat)) return { ok: false, message: 'Pick a category first.' };
    const r = job.result;
    const start = Math.max(0, +o.start || 0), end = Math.min(r.probe.duration, +o.end || r.probe.duration);
    if (end - start < 0.2) return { ok: false, message: 'The clip is too short.' };
    job.status = 'saving';
    job.text = 'Saving the clip…';
    job.pct = 0;
    job.range = [start, end];
    sendJobs();
    try {
      const out = path.join(job.dir, 'clip-' + Date.now() + '.mp4');
      const made = await E.cutClip(tools, r.playable, out, {
        start, end, keepSound: !!o.keepSound, maxHeight: +o.maxHeight || 1080, crop: E.validCrop(o.crop) ? o.crop : null, log,
        onProgress: (p) => { job.pct = p.pct; sendJobsSoon(); },
      });
      const clip = await library.addClip(made.file, {
        n: String(o.name || r.info.title || 'clip').trim(), c: o.cat,
        d: made.probe.duration, w: made.probe.width, h: made.probe.height, fps: made.probe.fps, sound: made.sound,
        src: r.info.url || job.req.url || job.req.sourceUrl || '', page: r.info.title || job.req.pageTitle || '', by: r.info.by || '',
        lic: r.info.lic || '', site: r.info.site || '', part: [round3(start + r.offset), round3(end + r.offset)],
        guess: job.suggestion && job.suggestion.id ? job.suggestion.id : undefined, thumbAt: made.probe.duration / 2,
        crop: made.crop ? ['x', 'y', 'w', 'h'].map((k) => Math.round(made.crop[k] * 10000) / 10000) : undefined,
      });
      log('saved ' + clip.f + ' (' + clip.w + 'x' + clip.h + ', ' + clip.d + ' s, ' + made.encoder + (made.crop ? ', cropped' : '') + ')');
      settings.keepSound = !!o.keepSound;
      settings.maxHeight = +o.maxHeight || 1080;
      saveSettings();
      sendLibrary();
      job.saved = (job.saved || 0) + 1;
      if (o.another) {
        job.status = 'ready';
        job.text = 'Saved “' + clip.n + '” to ' + catName(clip.c) + '. Pick another part.';
      } else {
        job.status = 'done';
        job.text = 'Saved “' + clip.n + '” to ' + catName(clip.c);
        fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
        setTimeout(() => { if (jobs.get(job.id) === job && job.status === 'done') { jobs.delete(job.id); sendJobs(); } }, 45000);
      }
      sendJobs();
      return { ok: true, clip: clipForPanel(clip), cat: catName(clip.c) };
    } catch (e) {
      job.status = 'ready';
      job.text = 'Couldn’t save it: ' + e.message;
      log('save failed: ' + e.message + ' ' + (e.detail || ''));
      sendJobs();
      return { ok: false, message: e.message };
    }
  });

  handle('lib:update', async ({ id, n, c }) => { const clip = await library.updateClip(id, { n, c }); sendLibrary(); return { ok: true, clip: clipForPanel(clip) }; });
  handle('lib:remove', async (id) => { await library.removeClip(id); sendLibrary(); return { ok: true }; });
  handle('lib:show', (id) => { const c = library.data.clips.find((x) => x.id === id); if (c) shell.showItemInFolder(library.abs(c)); });
  handle('lib:open', () => shell.openPath(library.dir));
  handle('lib:rescan', async () => { await library.scan(); sendLibrary(); return { ok: true }; });
  handle('lib:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Where should the clip library be?', defaultPath: library.dir, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    settings.libraryDir = r.filePaths[0];
    saveSettings();
    await openLibrary();
    return { ok: true };
  });
  handle('cat:add', async (name) => { const cat = await library.addCategory(name); sendLibrary(); return { ok: true, cat }; });
  handle('cat:rename', async ({ id, n }) => { await library.renameCategory(id, n); sendLibrary(); return { ok: true }; });
  handle('cat:remove', async (id) => { await library.removeCategory(id); sendLibrary(); return { ok: true }; });
  handle('settings:set', (o) => {
    if (o && 'keepSound' in o) settings.keepSound = !!o.keepSound;
    if (o && [720, 1080, 1440, 2160].includes(+o.maxHeight)) settings.maxHeight = +o.maxHeight;
    if (o && 'startWithWindows' in o) setStartWithWindows(!!o.startWithWindows);
    saveSettings();
  });
  handle('chrome:info', () => ({ folder: chromeDir(), seen: settings.chromeSeen || '' }));
  handle('chrome:copy', (what) => {
    clipboard.writeText(what === 'folder' ? chromeDir() : 'chrome://extensions');
    return { ok: true };
  });
  handle('chrome:show', () => shell.openPath(chromeDir()));
  handle('open:external', (url) => { if (/^https?:/i.test(url)) shell.openExternal(url); });
  handle('open:log', () => shell.openPath(path.join(dataDir(), 'log.txt')));
}

/* ---------- sharing the library with Phosphor Loop, the icon by the clock, starting with Windows ---------- */
let sharing = null, tray = null;
const sharingState = () => ({ on: !!sharing, port: sharing ? sharing.port : 0 });
async function startSharing() {
  const ports = process.env.CLIPS_PORT ? [+process.env.CLIPS_PORT] : undefined;
  sharing = await startServer({
    getLibrary: () => library, version: app.getVersion(), log, ports,
    onOpen: (o) => openFromChrome(o, 'button'),
    // The Chrome button says hello when it's added to Chrome, so the setup helper can say it worked
    onHello: () => {
      if (settings.chromeSeen) return;
      settings.chromeSeen = 'added';
      saveSettings();
      log('chrome: the button was added to Chrome');
      send('chrome', { seen: 'added' });
    },
  });
  send('sharing', sharingState());
  updateTray();
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) { win.maximize(); win.show(); }
  win.focus();
}

function setStartWithWindows(on) {
  settings.startWithWindows = on;
  if (process.platform === 'win32' && app.isPackaged && !TEST) {
    try { app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] }); } catch (e) { log('start with Windows: ' + e.message); }
  }
  log('start with Windows: ' + (on ? 'on' : 'off'));
  updateTray();
  send('settings', { startWithWindows: on });
}

function updateTray() {
  if (!tray) return;
  const shareText = sharing ? 'Sharing clips with Phosphor Loop' : 'Not sharing (another program has the port)';
  tray.setToolTip('Phosphor Clips \u2013 ' + shareText.toLowerCase());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Phosphor Clips', click: showWindow },
    { label: shareText, enabled: false },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: !!settings.startWithWindows, click: (mi) => { setStartWithWindows(mi.checked); saveSettings(); } },
    { type: 'separator' },
    { label: 'Quit Phosphor Clips', click: () => { quitting = true; app.quit(); } },
  ]));
}

function makeTray() {
  if (TEST) return;
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 32, height: 32 });
    tray = new Tray(img);
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    updateTray();
  } catch (e) { log('tray: ' + e.message); tray = null; }
}

/* ---------- start ---------- */
app.on('second-instance', (_e, argv) => {
  startHidden = false;
  const link = linkIn(argv);
  if (!link || !openFromLink(link)) bringToFront();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  if (sharing) sharing.close();
  for (const job of jobs.values()) { try { job.ac.abort(); if (job.cancel) job.cancel(); } catch (_) { /* closing */ } }
  if (vision) vision.stop();
});

app.whenReady().then(async () => {
  loadSettings();
  log('Phosphor Clips ' + app.getVersion() + ' starting (Electron ' + process.versions.electron + ')');
  findTools();
  await fsp.rm(jobsDir(), { recursive: true, force: true }).catch(() => {});
  setupIpc();
  startVision();
  try { await openLibrary(); } catch (e) {
    log('library failed at ' + settings.libraryDir + ': ' + e.message);
    settings.libraryDir = path.join(app.getPath('videos'), 'Phosphor Clips');
    await openLibrary();
  }
  await startSharing();
  makeTray();
  if (process.platform === 'win32' && app.isPackaged && !TEST) {
    try { app.setAsDefaultProtocolClient(PROTOCOL); } catch (e) { log('link handler: ' + e.message); }
  }
  placeChromeButton();
  const link = linkIn(process.argv);
  if (link) startHidden = false;
  // The first time, Phosphor Clips is set to start with Windows (out of sight, by the clock), so Phosphor Loop on
  // this computer always has the library. It can be switched off from the icon by the clock or the Library page.
  if (settings.startWithWindows === null) { setStartWithWindows(true); saveSettings(); }
  else setStartWithWindows(!!settings.startWithWindows);
  createWindow();
  if (link) openFromLink(link);
  win.webContents.once('did-finish-load', flushPendingOpens);
  pollVideo();
  keepYtdlpFresh();
  if (!tools.ffmpeg || !tools.ytdlp) log('MISSING TOOLS: ' + JSON.stringify(tools));
  // (a self-test that can't even load ends the app, so a test run never hangs)
  if (TEST && process.env.CLIPS_TEST_URL) (() => { try { return require('./selftest.js'); } catch (e) { log('selftest: FAIL could not load: ' + e.message); app.exit(1); return () => {}; } })()({ app, win: () => win, web: () => web, jobs, library: () => library, sharing: () => sharing, log, mark, grabFromPage, startJob, readVideo, openFromLink, chromeDir, tools: () => tools, run: E.run });
});
