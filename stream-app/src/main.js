'use strict';
// Phosphor Stream: one window with Phosphor Loop on the left and the streaming controls on the right.
const { app, BrowserWindow, WebContentsView, ipcMain, session, desktopCapturer, safeStorage, shell, dialog,
  powerSaveBlocker } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { Streamer, buildUrl, VARIANTS } = require('./stream.js');
const { Tuner, candidates, pick } = require('./tune.js');
const capturePageSource = require('./capture-page.js');
const { REC_SIZES, REC_QUALITY, REC_DEFAULTS, recPlan, finish, outputName } = require('./record.js');

const TEST = process.env.PHOSPHOR_TEST === '1';
const SITE = process.env.PHOSPHOR_SITE || 'https://nhillson.github.io/phosphor-loop/';
const PANEL_W = 360, PANEL_COLLAPSED_W = 48;

// Upload speed per platform. Twitch takes up to 6 Mbps; Kick (Amazon IVS) takes up to 8.5 Mbps at 1080p and hangs up
// when a stream goes over, so Kick gets 7.5 to leave room for sound and the odd busy moment. Both take at most 1080p,
// so at 1440p and 4K they get a sharp 1080p copy.
// YouTube takes far more: these are YouTube's own recommended rates (its live encoder settings page, 2026), and it
// takes 1440p and 4K. Every platform gets its own squeeze at its own rate, so YouTube's big stream never holds
// Kick back and Kick's limit never holds YouTube back.
const QUALITY = {
  good: { width: 1280, height: 720, fps: 30, bitrate: { twitch: 4500000, kick: 4500000, youtube: 8000000 } },
  better: { width: 1920, height: 1080, fps: 30, bitrate: { twitch: 6000000, kick: 7500000, youtube: 14000000 } },
  best: { width: 1920, height: 1080, fps: 60, bitrate: { twitch: 6000000, kick: 7500000, youtube: 17000000 } },
  ultra: { width: 2560, height: 1440, fps: 30, bitrate: { twitch: 6000000, kick: 7500000, youtube: 21000000 } },
  max: { width: 3840, height: 2160, fps: 30, bitrate: { twitch: 6000000, kick: 7500000, youtube: 42000000 } },
};
const MAX_HEIGHT = { twitch: 1080, kick: 1080, youtube: 2160 };
// The picture is first recorded inside Phosphor Loop, then squeezed for the platforms. That first recording is
// kept nearly lossless (very high quality, it never leaves the computer), so the picture is only really
// squeezed once.
const recordBitrate = (q) => ({ 720: 35000000, 1080: 60000000, 1440: 90000000, 2160: 140000000 }[q.height] || 60000000) * (q.fps > 30 ? 1.5 : 1);
const streamQuality = (q, dests) => ({ ...q, bitrate: Math.min(...dests.map((d) => q.bitrate[d.id] || q.bitrate.twitch)) });
const PLATFORMS = ['twitch', 'kick', 'youtube'];

// Software drawing for the test computer, which has no graphics card
if (TEST) app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// Keep drawing and streaming even when the window is covered or minimized
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!TEST && !app.requestSingleInstanceLock()) app.quit();

/* ---------- settings (stream keys are locked with Windows' own protection) ---------- */
const dataDir = () => app.getPath('userData');
const settingsFile = () => path.join(dataDir(), 'settings.json');
const DEFAULTS = {
  twitch: { enabled: true, key: '' },
  kick: { enabled: false, server: '', key: '' },
  youtube: { enabled: false, key: '', hevc: true }, // hevc: send YouTube the sharper HEVC format when the card can make it
  quality: 'better', startWithWindows: false, goLiveOnOpen: false, autopilotOnLive: false, collapsed: false,
  streamFriendly: false, // Stream-friendly: calmer picture and gentler Autopilot while streaming (never while only recording)
  record: { ...REC_DEFAULTS }, // Record a video: size (2160, 1440 or 1080 lines), quality (youtube, clean, perfect), fps (30 or 60)
  tuned: null, // what the sharpness test picked: { variant, label, at, quality, detail, usual, usualDetail, gpu }
};
function lock(text) {
  if (!text) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64');
  return 'raw:' + Buffer.from(text).toString('base64');
}
function unlock(stored) {
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    if (stored.startsWith('raw:')) return Buffer.from(stored.slice(4), 'base64').toString();
  } catch (_) {}
  return '';
}
let settings;
function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (_) {}
  settings = { ...DEFAULTS, ...s, twitch: { ...DEFAULTS.twitch, ...s.twitch }, kick: { ...DEFAULTS.kick, ...s.kick },
    youtube: { ...DEFAULTS.youtube, ...s.youtube }, record: { ...DEFAULTS.record, ...s.record } };
  if (!QUALITY[settings.quality]) settings.quality = 'good';
}
function saveSettings() {
  try { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); }
  catch (e) { log('Could not save settings: ' + e.message); }
}
function publicSettings() {
  return {
    twitch: { enabled: settings.twitch.enabled, hasKey: !!settings.twitch.key },
    kick: { enabled: settings.kick.enabled, server: settings.kick.server, hasKey: !!settings.kick.key },
    youtube: { enabled: settings.youtube.enabled, hasKey: !!settings.youtube.key, hevc: settings.youtube.hevc },
    quality: settings.quality, startWithWindows: settings.startWithWindows, goLiveOnOpen: settings.goLiveOnOpen,
    autopilotOnLive: settings.autopilotOnLive, collapsed: settings.collapsed, record: settings.record,
    streamFriendly: settings.streamFriendly,
  };
}
function publicTune() {
  const t = settings.tuned;
  return { ...tune, last: t ? { label: t.label, at: t.at, detail: t.detail, usualDetail: t.usualDetail, gain: t.gain, results: t.results || [] } : null };
}

/* ---------- log ---------- */
let logPath;
function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  if (TEST) process.stdout.write(text);
  try {
    logPath = logPath || path.join(dataDir(), 'log.txt');
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2e6) fs.renameSync(logPath, logPath + '.old');
    fs.appendFileSync(logPath, text);
  } catch (_) {}
}

/* ---------- streaming engine ---------- */
function ffmpegPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'ffmpeg.exe');
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const local = path.join(__dirname, '..', 'vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return fs.existsSync(local) ? local : 'ffmpeg';
}
const streamer = new Streamer({ ffmpeg: ffmpegPath(), log });
let win, site, sleepBlock = null, notice = null, captureInfo = null, probing = null;

function fullStatus() {
  const v = streamer.encoder && VARIANTS[streamer.encoder.variant];
  return { ...streamer.status(), rec: recStatus(), notice, starting: !!startingLive, setting: v ? v.label : '', tuned: !!(streamer.encoder && streamer.encoder.tier === 'tuned') };
}
function sendStatus() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('status', fullStatus());
}
streamer.on('status', sendStatus);
streamer.on('slow-encode', () => tell('This computer can’t squeeze the picture fast enough at this quality, so the stream stutters. Pick a smaller picture quality (for example 1440p instead of 4K), or switch off a platform.', 'warn'));
streamer.on('slow-upload', (d) => tell(`Your internet upload can’t keep up with ${d.name} at this quality, so ${d.name} keeps reconnecting. Pick a lower picture quality, or switch off one of the platforms.`, 'warn'));
function tell(text, kind = 'info') {
  notice = text ? { text, kind, at: Date.now() } : null;
  if (win && !win.isDestroyed()) win.webContents.send('notice', notice);
}

// The Stream-friendly switch
function setStreamFriendly(v) {
  if (!!v === settings.streamFriendly) return;
  settings.streamFriendly = !!v;
  log('Stream-friendly ' + (settings.streamFriendly ? 'on' : 'off'));
  // The calmer picture comes and goes at once. The squeezer's light smoothing is set when Stream is switched on
  // (restarting the squeezer mid-stream to add it cost the test stream minutes of picture), so it joins next time.
  applyCalm();
}
// Stream-friendly is on only while streaming: recording by itself, or nothing at all, keeps the full picture
function applyCalm() {
  const on = !!settings.streamFriendly && streamer.live;
  siteCall('calm', { on }).then((ok) => { if (!ok && on) log('Stream-friendly: this Phosphor Loop has no calm mode yet'); }).catch(() => {});
}
function siteCall(cmd, opts) {
  return site.webContents.executeJavaScript(`window.phosphorStreamCapture(${JSON.stringify(cmd)}, ${JSON.stringify(opts || {})})`, true);
}
async function waitForSite() {
  // Waits for the page to be ready to hand over its picture; the ceiling is only for a page that never loads
  for (let i = 0; i < 200; i++) {
    try { if (await siteCall('ready')) return true; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
// Wait until the page has drawn this many more frames (never a fixed time). The ceiling is for a stalled page.
async function waitFrames(n, ceilingMs = 120000) {
  const start = await siteCall('frames').catch(() => 0);
  const until = Date.now() + ceilingMs;
  while (Date.now() < until) {
    const now = await siteCall('frames').catch(() => start);
    if (now - start >= n) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

streamer.on('capture', async (gen) => {
  const q = QUALITY[settings.quality];
  try {
    captureInfo = await siteCall('start', { gen, fps: q.fps, recordBitrate: recordBitrate(q), sound: true });
    log(`Capture ${gen}: ${captureInfo.mimeType}, sound ${captureInfo.sound ? 'on' : 'off ' + captureInfo.soundErr}`);
    if (!captureInfo.sound) tell('Couldn’t hear this computer’s sound, so the stream is silent for now. Check that a speaker or headphones are set up in Windows.', 'warn');
  } catch (e) {
    log('Capture could not start: ' + e.message);
    setTimeout(() => { if (streamer.live && streamer.gen === gen) streamer.restartEncoder(); }, 2000);
  }
});
ipcMain.on('chunk', (_e, gen, buf) => streamer.write(gen, buf));
ipcMain.on('capture-problem', (_e, text) => { log('Recorder: ' + text); if (streamer.live) streamer.restartEncoder(); });

function destinations() {
  const list = [];
  if (TEST && process.env.PHOSPHOR_TEST_RTMP) {
    list.push({ id: 'twitch', name: 'Test server', url: process.env.PHOSPHOR_TEST_RTMP, secret: 'test-key-secret' });
    if (process.env.PHOSPHOR_TEST_RTMP2) list.push({ id: 'youtube', name: 'Test YouTube', url: process.env.PHOSPHOR_TEST_RTMP2, secret: 'test-key-secret2' });
    return list;
  }
  const t = settings.twitch, k = settings.kick;
  if (t.enabled && t.key) { const key = unlock(t.key); list.push({ id: 'twitch', name: 'Twitch', url: buildUrl('twitch', { key }), secret: key }); }
  if (k.enabled && k.key && k.server) { const key = unlock(k.key); list.push({ id: 'kick', name: 'Kick', url: buildUrl('kick', { server: k.server, key }), secret: key }); }
  const y = settings.youtube;
  if (y.enabled && y.key) { const key = unlock(y.key); list.push({ id: 'youtube', name: 'YouTube', url: buildUrl('youtube', { key }), secret: key }); }
  return list.filter((d) => d.url && d.secret);
}

// Who gets what: each platform gets the picture at the biggest size it takes (Kick and Twitch: 1080p at most), at its
// own rate, in H.264, except YouTube, which gets HEVC when this graphics card can make it at that size. Platforms
// that would get exactly the same stream share one squeeze.
async function makePlan(dests) {
  const q = QUALITY[settings.quality];
  const encodes = [], routed = [];
  const checked = new Map();
  const works = async (variant, size) => {
    const k = `${variant}@${size.width}x${size.height}`;
    if (!checked.has(k)) checked.set(k, size.height <= 1080 || VARIANTS[variant].cpu ? '' : await streamer.tryVariant(variant, { ...size, bitrate: 20000000 }));
    return checked.get(k);
  };
  for (const d of dests) {
    let height = Math.min(q.height, MAX_HEIGHT[d.id] || 1080);
    let width = Math.round(height * 16 / 9 / 2) * 2;
    let variant = streamer.encoder.variant;
    if (d.id === 'youtube' && settings.youtube.hevc) {
      const k = `hevc@${width}x${height}`;
      if (!checked.has(k)) checked.set(k, await streamer.probeHevc({ width, height }));
      if (checked.get(k)) variant = checked.get(k);
      else log(`YouTube: this computer can't make HEVC at ${height}p, so YouTube gets H.264`);
    }
    const problem = await works(variant, { width, height });
    if (problem) {
      log(`${d.name}: ${height}p not possible with ${variant} (${problem.slice(0, 160)}); sending 1080p instead`);
      tell(`This graphics card can’t make a ${height}p stream for ${d.name}, so ${d.name} gets 1080p.`, 'warn');
      height = 1080; width = 1920; variant = streamer.encoder.variant;
    }
    const bitrate = (height === q.height ? q.bitrate : (QUALITY.better.fps === q.fps ? QUALITY.better : QUALITY.best).bitrate)[d.id] || q.bitrate.twitch;
    const key = `${width}x${height}|${variant}|${bitrate}`;
    let i = encodes.findIndex((e) => e.key === key);
    if (i < 0) { encodes.push({ key, width, height, bitrate, variant }); i = encodes.length - 1; }
    routed.push({ ...d, stream: i });
  }
  return { plan: { fps: q.fps, input: { width: q.width, height: q.height }, encodes, calm: settings.streamFriendly }, dests: routed };
}

let startingLive = false;
async function goLive() {
  if (streamer.live || startingLive) return { ok: true };
  if (tune.running) { tell('The sharpness test is still running. Switch Stream on once it finishes (a minute or two).', 'warn'); return { ok: false }; }
  const dests = destinations();
  if (!dests.length) {
    const msg = !PLATFORMS.some((p) => settings[p].enabled) ? 'Switch on Twitch, Kick or YouTube first.'
      : 'Add your stream key first (and the server address for Kick).';
    tell(msg, 'warn');
    return { ok: false, message: msg };
  }
  startingLive = true; tell(''); sendStatus();
  try {
    // The picture is now needed at the stream's size (or a recording's, if that's bigger): let it settle first
    await resizeSite();
    sendStatus();
    await waitFrames(30);
    if (probing) await probing;
    if (!(await waitForSite())) { tell('Phosphor Loop didn’t finish loading. Check the internet connection, then try again.', 'warn'); return { ok: false }; }
    const { plan, dests: routed } = await makePlan(dests);
    // The picture may be bigger than the stream (a 4K recording running): each platform gets its sharp smaller copy
    plan.input = drawnSize();
    streamer.start(routed, plan);
    if (settings.autopilotOnLive) siteCall('autopilot').catch(() => {});
    applyCalm();
    if (sleepBlock === null) sleepBlock = powerSaveBlocker.start('prevent-display-sleep');
    log(`Going live at ${settings.quality} (${plan.input.height}p${plan.fps}): ` + routed.map((d) => {
      const e = plan.encodes[d.stream];
      return `${d.name} ${e.height}p ${VARIANTS[e.variant] && VARIANTS[e.variant].hevc ? 'HEVC' : 'H.264'} ${(e.bitrate / 1e6).toFixed(1)} Mbps (${e.variant})`;
    }).join(', '));
    return { ok: true };
  } finally { startingLive = false; sendStatus(); }
}
async function stopLive() {
  if (!streamer.live) return;
  log('Stopping');
  try { await siteCall('stop'); } catch (_) {}
  streamer.stop();
  applyCalm();
  // The picture goes back to a recording's size, or the screen's own
  resizeSite();
  if (sleepBlock !== null) { powerSaveBlocker.stop(sleepBlock); sleepBlock = null; }
  tell('');
}

/* ---------- window ---------- */
function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const pw = settings.collapsed ? PANEL_COLLAPSED_W : PANEL_W;
  site.setBounds({ x: 0, y: 0, width: Math.max(100, w - pw), height: h });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 900, minWidth: 900, minHeight: 560, backgroundColor: '#0b090e', title: 'Phosphor Stream',
    autoHideMenuBar: true, show: !TEST || !!process.env.PHOSPHOR_TEST_SHOW,
    webPreferences: { preload: path.join(__dirname, 'preload-panel.js'), contextIsolation: true, sandbox: true },
  });
  if (TEST) win.showInactive();
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'panel', 'panel.html'));

  site = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-site.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  site.setBackgroundColor('#000000');
  win.contentView.addChildView(site);
  layout();
  win.on('resize', layout);

  const wc = site.webContents;
  wc.setBackgroundThrottling(false);
  wc.on('dom-ready', () => wc.executeJavaScript(capturePageSource()).catch((e) => log('Inject failed: ' + e.message)));
  wc.on('did-finish-load', async () => {
    if (rec.state === 'recording') { log('Page reloaded while recording; saving what was recorded'); recordStop(true); }
    if (!streamer.live) return;
    // The page reloaded while live: pick the picture up again
    log('Page reloaded while live; reconnecting the picture');
    if (await waitForSite()) { applyCalm(); streamer.restartEncoder(); }
  });
  wc.on('render-process-gone', (_e, d) => {
    log('Page stopped: ' + d.reason);
    if (rec.state === 'recording') recordStop(true);
    setTimeout(() => wc.reload(), 1500);
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain) return;
    log(`Page failed to load: ${desc}`);
    tell('Couldn’t load Phosphor Loop. Trying again…', 'warn');
    setTimeout(() => wc.loadURL(SITE), 5000);
  });
  // Phosphor Loop's own Output window opens as a normal window; other links open in the web browser
  wc.setWindowOpenHandler(({ url }) => {
    if (!url || url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#000000', title: 'Phosphor Loop output' } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.loadURL(SITE);

  win.on('close', (e) => {
    if (TEST) return;
    if (rec.state !== 'idle') {
      const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Close anyway', 'Keep the app open'], defaultId: 1, cancelId: 1,
        title: 'Recording', message: rec.state === 'saving' ? 'Your video is still being saved. Close anyway? It won’t be finished.'
          : 'You’re recording. Close anyway? The video won’t be finished.' });
      if (r === 1) { e.preventDefault(); return; }
    }
    if (!streamer.live) return;
    const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Stop and close', 'Keep streaming'], defaultId: 1, cancelId: 1,
      title: 'You’re live', message: 'You’re live right now. Stop the stream and close?' });
    if (r === 1) e.preventDefault();
  });
  win.on('closed', () => { win = null; });
}

function permissions() {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read', 'midi', 'midiSysex',
    'pointerLock', 'window-management', 'notifications', 'keyboardLock', 'speaker-selection']);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  // "Share this computer's sound" never shows a picker here: the app hands over Windows' sound directly
  ses.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (!sources.length) return cb({});
      cb(process.platform === 'win32' ? { video: sources[0], audio: 'loopback' } : { video: sources[0] });
    }).catch(() => cb({}));
  });
}

/* ---------- the computer (for the log) ---------- */
let gpuName = '';
function logMachine() {
  // 'basic' (the full report makes Windows gather DirectX diagnostics, which can slow the page while it runs)
  app.getGPUInfo('basic').then((info) => {
    const list = (info.gpuDevice || []).map((d) => `${d.deviceString || ''} [${(d.vendorId || 0).toString(16)}:${(d.deviceId || 0).toString(16)}]${d.active ? ' active' : ''} driver ${d.driverVersion || '?'}`);
    log('Graphics: ' + (list.join('; ') || 'unknown'));
  }).catch(() => {});
  execFile('nvidia-smi', ['--query-gpu=name,driver_version,memory.total,encoder.stats.sessionCount', '--format=csv,noheader'], { timeout: 8000, windowsHide: true }, (err, out) => {
    if (!err && out) { gpuName = String(out).split(',')[0].trim(); log('NVIDIA card: ' + String(out).trim()); }
  });
  execFile(ffmpegPath(), ['-hide_banner', '-version'], { timeout: 8000, windowsHide: true }, (err, out) => { if (!err) log(String(out).split('\n')[0]); });
  log(`Processor: ${require('node:os').cpus()[0]?.model || '?'} x${require('node:os').cpus().length}; memory ${Math.round(require('node:os').totalmem() / 1e9)} GB`);
}

/* ---------- sharpness test (tune.js) ---------- */
let tune = { running: false, step: '', i: 0, n: 0, results: [], summary: '' };
let tuner = null;
function sendTune() { if (win && !win.isDestroyed()) win.webContents.send('tune', publicTune()); }
ipcMain.on('sample', (_e, w, h, buf) => { if (tuner) tuner.addFrame(w, h, buf); });
ipcMain.on('sample-rec', (_e, buf, mime) => { if (tuner) tuner.saveRecording(buf, mime); });

async function sharpnessTest({ ids, frames, apply = true } = {}) {
  if (tune.running) return { ok: false };
  if (streamer.live || startingLive) { tell('Stop the stream first, then run the sharpness test.', 'warn'); return { ok: false }; }
  if (rec.state !== 'idle') { tell('Finish the recording first, then run the sharpness test.', 'warn'); return { ok: false }; }
  tune = { running: true, step: 'Getting ready…', i: 0, n: 0, results: [], summary: '' };
  sendTune(); sendStatus();
  // The test measures the picture at the stream's size
  await resizeSite();
  await waitFrames(30);
  tuner = tuner || new Tuner({ ffmpeg: ffmpegPath(), log, dir: path.join(app.getPath('temp'), 'Phosphor Stream sharpness test') });
  const q = QUALITY[settings.quality];
  const dests = destinations();
  const bitrate = dests.length ? streamQuality(q, dests).bitrate : q.bitrate.kick;
  let result = { ok: false };
  try {
    // Plain probing first, without the earlier pick, so "usual" is this computer's normal best setting
    if (probing) await probing;
    await streamer.probe();
    const codec = streamer.encoder.id;
    const usual = streamer.encoder.variant;
    if (!(await waitForSite())) throw new Error('Phosphor Loop didn’t finish loading');
    const size = await siteCall('size');
    if (!size) throw new Error('Phosphor Loop is still starting');
    const fpsBefore = await pageFps();
    const count = frames || Math.round(q.fps * 5);
    tune.step = `Recording ${Math.round(count / q.fps)} seconds of your picture…`; sendTune();
    log(`Sharpness test: recording ${count} frames at ${size.width}x${size.height}, ${q.fps} fps; testing at ${(bitrate / 1e6).toFixed(1)} Mbps`);
    tuner.startRecording({ width: size.width, height: size.height, fps: q.fps, frames: count });
    tuner.expectRecording();
    await siteCall('sample', { frames: count, fps: q.fps, recordBitrate: recordBitrate(q) });
    const info = await tuner.waitRecording();
    log(`Sharpness test: raw pictures arrived at ${info.arrivedFps} frames a second (${info.arrivedMBps} MB/s; asked for ${q.fps}; page was drawing ${fpsBefore} a second before)`);
    tune.step = 'Checking the first recording step…'; sendTune();
    const first = await tuner.measureFirstStage(info);
    tune.firstStage = first;
    log('Sharpness test: page recorder ' + (first.ok ? `(${first.mime}, ${first.sizeMB} MB): brightness ${first.psnrY} dB, colour ${first.psnrU}/${first.psnrV} dB; ` +
      `${first.matched} frames lined up, ${first.missing} missing, ${first.extra} extra (starts ${first.startOffset} early)` : 'check failed: ' + first.error));
    const sig = await tuner.detailEnergy(info);
    const list = (ids || candidates(codec)).filter((id) => VARIANTS[id]);
    // Extra settings to compare, measured only (never streamed with): sharpness-extra.json in the app's data folder,
    // {"variants": {"my-id": {"label": "…", "args": ["-c:v", "h264_nvenc", …, "{BITRATE}", …, "{GOP}"], "cpu": false}}}
    const extra = {};
    if (!ids) {
      try {
        const x = JSON.parse(fs.readFileSync(path.join(dataDir(), 'sharpness-extra.json'), 'utf8'));
        for (const [id, v] of Object.entries(x.variants || {})) {
          if (!Array.isArray(v.args)) continue;
          extra[id] = { label: String(v.label || id), cpu: !!v.cpu, auto: false, args: v.args.map((a) => String(a)
            .replace('{BITRATE}', String(bitrate)).replace('{GOP}', String(q.fps * 2)).replace('{FPS}', String(q.fps))) };
          list.push(id);
        }
        if (Object.keys(extra).length) log(`Sharpness test: ${Object.keys(extra).length} extra settings from sharpness-extra.json (measured only)`);
      } catch (e) { if (e.code !== 'ENOENT') log('sharpness-extra.json not usable: ' + e.message); }
    }
    tune.n = list.length;
    for (const [i, id] of list.entries()) {
      const label = extra[id] ? extra[id].label : VARIANTS[id].label;
      tune.i = i; tune.step = `Trying setting ${i + 1} of ${list.length}: ${label}`; sendTune();
      const r = await tuner.measure(id, info, bitrate, sig, extra[id]);
      r.usual = id === usual;
      tune.results.push(r); sendTune();
      log(`Sharpness test: ${id.padEnd(18)} ` + (r.ok ? `detail ${r.detail} dB, PSNR ${r.psnr}, SSIM ${r.ssim}, ${r.speed} fps, peak ${r.peakMbps} Mbps (start ${r.startMbps}), avg ${r.avgMbps}` : `not usable: ${r.error}`));
    }
    const best = pick(tune.results, { fps: q.fps, bitrate, usual });
    const base = tune.results.find((r) => r.id === usual && r.ok);
    for (const r of tune.results) r.chosen = !!best && r.id === best.id;
    const gain = best && base ? +(best.detail - base.detail).toFixed(2) : 0;
    if (best && apply) {
      settings.tuned = { variant: best.id, label: best.label, at: new Date().toISOString(), quality: settings.quality, detail: best.detail,
        usual, usualDetail: base ? base.detail : null, gain, gpu: gpuName, codec,
        results: tune.results.map(({ id, label, ok, detail, speed, chosen, usual: u, error }) => ({ id, label, ok, detail, speed, chosen, usual: u, error: error ? error.slice(0, 80) : undefined })) };
      saveSettings();
    }
    tune.summary = !best ? 'None of the settings could keep up on this computer, so nothing was changed.'
      : best.id === usual ? `Your current setting was already the sharpest this computer can do (${best.label}). Nothing changed.`
        : `Now using “${best.label}”: ${gain} dB sharper than before on this picture. It applies the next time you go live.`;
    log('Sharpness test: picked ' + (best ? `${best.id} (${best.detail} dB; usual ${usual} ${base ? base.detail : '?'} dB)` : 'nothing'));
    try {
      fs.writeFileSync(path.join(dataDir(), 'sharpness-test.json'), JSON.stringify({ at: new Date().toISOString(), info, bitrate, sigPsnr: sig,
        codec, usual, picked: best && best.id, gpu: gpuName, firstStage: tune.firstStage, results: tune.results }, null, 2));
    } catch (_) {}
    result = { ok: true, picked: best && best.id, results: tune.results };
  } catch (e) {
    log('Sharpness test failed: ' + e.message);
    tune.summary = 'The test couldn’t finish: ' + e.message;
    try { await siteCall('sample-stop'); } catch (_) {}
  } finally {
    // Back to the settings the stream should use (the test's pick, or the earlier one)
    probing = streamer.probe(settings.tuned && settings.tuned.variant).catch((e) => log('Probe failed: ' + e.message));
    await probing;
    tune.running = false; tune.step = '';
    resizeSite();
    sendTune(); sendStatus();
  }
  return result;
}
ipcMain.handle('sharpness-test', () => sharpnessTest());

/* ---------- recording a video file (see record.js) ---------- */
const rec = { state: 'idle', plan: null, temp: '', ws: null, startedAt: 0, bytes: 0, progress: 0, last: '', slow: 0,
  timer: null, doneWait: null, framesAt: 0, framesT: 0, lastSend: 0, awake: null };
const recDir = () => path.join(app.getPath('videos'), 'Phosphor Loop');
function recStatus() {
  const p = rec.plan;
  return { state: rec.state, since: rec.startedAt, bytes: rec.bytes, progress: rec.progress, last: rec.last ? path.basename(rec.last) : '',
    height: p ? p.height : 0, fps: p ? p.fps : 0, slow: rec.slow };
}
// A recording has its own size and speed whether or not the stream is on. The picture is drawn at the bigger of the
// two (see captureConfig), so a 4K recording stays 4K while the stream gets its own smaller copy.
async function recordStart() {
  if (rec.state !== 'idle') return { ok: false };
  if (startingLive) { tell('Wait until the stream has started, then switch Record on.', 'warn'); return { ok: false }; }
  if (tune.running) { tell('The sharpness test is still running. Record once it finishes.', 'warn'); return { ok: false }; }
  const plan = recPlan(settings.record);
  rec.state = 'starting'; rec.plan = plan; rec.bytes = 0; rec.progress = 0; rec.slow = 0; rec.warned = false;
  tell(''); sendStatus();
  try {
    fs.mkdirSync(recDir(), { recursive: true });
    if (!(await waitForSite())) throw new Error('Phosphor Loop isn’t ready yet');
    await redraw();
    await waitFrames(TEST ? 5 : 20);
    rec.temp = path.join(recDir(), `.recording ${Date.now()}.mkv`);
    rec.ws = fs.createWriteStream(rec.temp);
    rec.ws.on('error', (e) => { log('Recording: could not write: ' + e.message); tell('Couldn’t write the recording to the Videos folder (is the disk full?). Stopping.', 'warn'); recordStop(true); });
    const info = await siteCall('rec-start', { fps: plan.fps, bitrate: plan.firstBitrate });
    rec.state = 'recording';
    rec.startedAt = Date.now();
    if (rec.awake == null) rec.awake = powerSaveBlocker.start('prevent-display-sleep');
    const d = drawnSize();
    log(`Recording ${plan.width}x${plan.height} at ${plan.fps} fps, ${REC_QUALITY[plan.quality].label} (${(plan.bitrate / 1e6).toFixed(0)} Mbps)${streamer.live ? ', while live' : ''}; picture drawn at ${d.width}x${d.height}; working copy ${info.mimeType} at ${(plan.firstBitrate / 1e6).toFixed(0)} Mbps, sound ${info.sound ? 'on' : 'off ' + info.soundErr}`);
    if (!info.sound) tell('Couldn’t hear this computer’s sound, so the recording is silent. Check that a speaker or headphones are set up in Windows.', 'warn');
    rec.framesAt = await siteCall('frames').catch(() => 0); rec.framesT = Date.now();
    rec.timer = setInterval(recTick, 2000);
    sendStatus();
    return { ok: true };
  } catch (e) {
    log('Recording could not start: ' + e.message);
    try { if (rec.ws) rec.ws.destroy(); fs.rmSync(rec.temp, { force: true }); } catch (_) {}
    rec.ws = null; rec.state = 'idle'; rec.plan = null;
    redraw();
    tell('Couldn’t start recording: ' + e.message, 'warn');
    sendStatus();
    return { ok: false };
  }
}
// Every 2 seconds while recording: the time and size shown, and whether the page keeps up with the frame rate
async function recTick() {
  if (rec.state !== 'recording') return;
  const f = await siteCall('frames').catch(() => null), now = Date.now();
  if (f != null && now - rec.framesT >= 4000) {
    const fps = (f - rec.framesAt) / ((now - rec.framesT) / 1000);
    rec.framesAt = f; rec.framesT = now;
    const want = rec.plan.fps;
    if (fps < want * 0.85) {
      rec.slow = Math.round(fps);
      if (!rec.warned) {
        rec.warned = true;
        tell(`This computer is drawing about ${Math.round(fps)} frames a second, short of the ${want} this recording needs, so the video will repeat frames. A smaller size (1440p) or 30 fps will look smoother.`, 'warn');
      }
    } else rec.slow = 0;
  }
  sendStatus();
}
ipcMain.on('rec-chunk', (_e, buf) => { if (rec.ws) { rec.ws.write(Buffer.from(buf)); rec.bytes += buf.byteLength; } });
ipcMain.on('rec-done', () => { if (rec.doneWait) rec.doneWait(); });
// Stops the page's recorder, waits for its last pieces and closes the working file. Then the picture goes back to
// the size the stream (or the screen) wants. Returns the recording's plan and length.
async function recHalt(state, broken) {
  rec.state = state; rec.progress = 0; rec.warned = false;
  if (rec.awake != null) { powerSaveBlocker.stop(rec.awake); rec.awake = null; }
  clearInterval(rec.timer);
  sendStatus();
  const plan = rec.plan, seconds = (Date.now() - rec.startedAt) / 1000;
  // The page hands over its last pieces, then says it's done (the ceiling is for a page that has gone)
  const done = new Promise((r) => { rec.doneWait = r; setTimeout(r, broken ? 1000 : 15000); });
  let stopped = false;
  try { stopped = await siteCall('rec-stop'); } catch (_) {}
  if (stopped) await done;
  rec.doneWait = null;
  if (rec.ws) await new Promise((r) => rec.ws.end(r));
  rec.ws = null;
  rec.plan = null;
  redraw();
  return { plan, seconds };
}
async function recordStop(broken) {
  if (rec.state !== 'recording') return;
  const { plan, seconds } = await recHalt('saving', broken);
  const output = outputName(recDir());
  const family = streamer.encoder ? streamer.encoder.id : 'libx264';
  const progress = (p) => { rec.progress = p; if (Date.now() - rec.lastSend > 500) { rec.lastSend = Date.now(); sendStatus(); } };
  let problem = await finish({ ffmpeg: ffmpegPath(), input: rec.temp, output, plan, family, seconds, onProgress: progress, log });
  if (problem && family !== 'libx264') {
    log(`Recording: ${family} couldn’t finish it (${problem.slice(0, 200)}); using the processor instead`);
    rec.progress = 0;
    problem = await finish({ ffmpeg: ffmpegPath(), input: rec.temp, output, plan, family: 'libx264', seconds, onProgress: progress, log });
  }
  if (!problem) {
    try { fs.rmSync(rec.temp, { force: true }); } catch (_) {}
    rec.last = output;
    let gb = 0; try { gb = fs.statSync(output).size / 1e9; } catch (_) {}
    log(`Recording saved: ${output} (${gb.toFixed(2)} GB, ${seconds.toFixed(0)} s)`);
    tell(`Saved “${path.basename(output)}” (${gb < 1 ? Math.round(gb * 1000) + ' MB' : gb.toFixed(1) + ' GB'}) in Videos › Phosphor Loop.`, 'info');
  } else {
    // Keep what was recorded, under a name that can be found
    const keep = output.replace(/\.mp4$/, ' (unfinished).mkv');
    try { fs.renameSync(rec.temp, keep); } catch (_) {}
    log('Recording could not be finished: ' + problem);
    tell(`Couldn’t finish the video. What was recorded is kept in Videos › Phosphor Loop as “${path.basename(keep)}”.`, 'warn');
  }
  rec.state = 'idle'; rec.progress = 0;
  sendStatus();
  return { ok: !problem, output };
}
// Discard: stop and throw the recording away, without saving anything
async function recordDiscard() {
  if (rec.state !== 'recording') return { ok: false };
  const { seconds } = await recHalt('discarding', true);
  try { fs.rmSync(rec.temp, { force: true }); } catch (e) { log('Recording: could not remove the working file: ' + e.message); }
  log(`Recording discarded (${seconds.toFixed(0)} s)`);
  rec.state = 'idle';
  tell('Recording discarded. Nothing was saved.', 'info');
  sendStatus();
  return { ok: true };
}
ipcMain.handle('record', (_e, on) => (on ? recordStart() : recordStop()));
ipcMain.handle('record-discard', () => recordDiscard());
ipcMain.handle('open-recordings', () => {
  try { fs.mkdirSync(recDir(), { recursive: true }); } catch (_) {}
  if (rec.last && fs.existsSync(rec.last)) shell.showItemInFolder(rec.last); else shell.openPath(recDir());
});

/* ---------- controls panel ---------- */
const HELP = {
  twitch: 'https://dashboard.twitch.tv/settings/stream',
  kick: 'https://kick.com/dashboard/settings/stream',
  youtube: 'https://www.youtube.com/live_dashboard',
};
ipcMain.handle('state', () => ({ settings: publicSettings(), status: fullStatus(), quality: QUALITY, tune: publicTune() }));
ipcMain.handle('save', async (_e, patch) => {
  const before = settings.quality;
  if (patch.record && rec.state === 'idle') {
    const r = patch.record, cur = settings.record;
    if (REC_SIZES[r.size]) cur.size = +r.size;
    if (REC_QUALITY[r.quality]) cur.quality = r.quality;
    if (r.fps === 30 || r.fps === 60) cur.fps = r.fps;
  }
  for (const p of PLATFORMS) {
    if (!patch[p]) continue;
    const cur = settings[p];
    if ('enabled' in patch[p]) cur.enabled = !!patch[p].enabled;
    if ('hevc' in patch[p] && p === 'youtube') cur.hevc = !!patch[p].hevc;
    if ('server' in patch[p]) cur.server = String(patch[p].server || '').trim();
    if ('key' in patch[p]) cur.key = lock(String(patch[p].key || '').trim());
  }
  for (const k of ['startWithWindows', 'goLiveOnOpen', 'autopilotOnLive']) if (k in patch) settings[k] = !!patch[k];
  if ('streamFriendly' in patch) setStreamFriendly(patch.streamFriendly);
  if (patch.quality && QUALITY[patch.quality] && !streamer.live && !tune.running) settings.quality = patch.quality;
  if ('startWithWindows' in patch && app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.startWithWindows });
  saveSettings();
  // A new size: tell Phosphor Loop to draw at it. It carries the current picture and every setting across, the
  // same way it does when its window is resized. Only if that isn't possible is the page reloaded.
  if (settings.quality !== before) { resizeSite(); sendStatus(); }
  return publicSettings();
});
function captureConfig() {
  // A recording made while off air draws at the recording's own size and speed
  // The build's test computer has no graphics card at all, so there the loops are drawn at a much lower detail (the
  // picture keeps its full size); otherwise it manages less than a frame a second and every step takes minutes
  const lines = (h) => (TEST ? Math.min(h, 216) : h);
  // What needs the picture: the stream (live, going live, or the sharpness test) and a recording. It's drawn at the
  // biggest size and fastest speed among them. With neither, it's drawn like an ordinary browser window, at the
  // screen's size, as Phosphor Loop's own Picture sharpness picks (up to 4K).
  const q = QUALITY[settings.quality];
  const want = [];
  if (streamer.live || startingLive || tune.running) want.push(q);
  if (rec.plan) want.push(rec.plan);
  if (!want.length) return { width: q.width, height: q.height, fps: q.fps, renderHeight: lines(q.height), off: true };
  const big = want.reduce((a, b) => (b.height > a.height ? b : a));
  return { width: big.width, height: big.height, fps: Math.max(...want.map((w) => w.fps)), renderHeight: lines(big.height), off: false };
}
const drawnSize = () => { const c = captureConfig(); return { width: c.width, height: c.height }; };
// After something changed what the picture is needed for: draw it at the new size, and if that changes the size the
// stream is made from, start its squeeze again from the new size (a second's hiccup for viewers)
async function redraw() {
  const was = streamer.live && streamer.plan ? { ...streamer.plan.input } : null;
  await resizeSite();
  if (!was) return;
  const now = drawnSize();
  if (now.width === was.width && now.height === was.height) return;
  streamer.plan.input = now;
  log(`Stream now made from a ${now.width}x${now.height} picture`);
  streamer.restartEncoder();
}
async function resizeSite() {
  const cfg = captureConfig();
  let ok = false;
  try {
    ok = await site.webContents.executeJavaScript(`(() => {
      const c = window.__phosphorCaptureConfig;
      if (!c) return false;
      try { Object.assign(c, ${JSON.stringify(cfg)}); } catch (_) { return false; }
      if (c.height !== ${cfg.height} || c.fps !== ${cfg.fps} || !!c.off !== ${!!cfg.off}) return false;
      window.dispatchEvent(new Event('resize'));
      return true;
    })()`, true);
  } catch (_) {}
  log(`Quality now ${settings.quality}: ${ok ? 'resized in place' : 'reloading the page'}`);
  if (!ok) site.webContents.reload();
}
ipcMain.handle('go-live', () => goLive());
ipcMain.handle('stop', () => stopLive());
ipcMain.handle('help', (_e, which) => { if (HELP[which]) shell.openExternal(HELP[which]); });
ipcMain.handle('collapse', (_e, on) => { settings.collapsed = !!on; saveSettings(); layout(); });
ipcMain.handle('open-log', () => { if (logPath) shell.showItemInFolder(logPath); });
ipcMain.on('capture-config', (e) => { e.returnValue = captureConfig(); });

/* ---------- start-up ---------- */
app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  // "Phosphor Stream.exe --sharpness-test" while the app is open runs the test in the open app
  if (argv.includes('--sharpness-test')) sharpnessTest();
});
app.on('window-all-closed', async () => { await stopLive(); setTimeout(() => app.quit(), 4000); });
app.on('before-quit', () => { if (streamer.live) streamer.stop(); });

app.whenReady().then(async () => {
  loadSettings();
  log(`Phosphor Stream ${app.getVersion()} starting; FFmpeg at ${ffmpegPath()}`);
  permissions();
  probing = streamer.probe(settings.tuned && settings.tuned.variant).then(() => sendStatus()).catch((e) => log('Probe failed: ' + e.message));
  logMachine();
  createWindow();
  if (TEST) return runTest();
  if (process.argv.includes('--sharpness-test')) { if (await waitForSite()) { await waitFrames(120); sharpnessTest(); } return; }
  if (settings.goLiveOnOpen) {
    // Give Phosphor Loop a moment to build its picture (counted in frames), then go live
    if (await waitForSite()) { await waitFrames(120); goLive(); }
  }
});

// How fast the page is drawing: the time it takes to draw a set number of frames
async function pageFps(n = 30) {
  const t0 = Date.now();
  if (!(await waitFrames(n, 60000))) return 0;
  return +(n / ((Date.now() - t0) / 1000)).toFixed(1);
}

/* ---------- self-test used by the build (never runs for Nick) ---------- */
async function runTest() {
  const out = process.env.PHOSPHOR_TEST_OUT;
  const frames = +(process.env.PHOSPHOR_TEST_FRAMES || 450);
  const result = { ok: false };
  // The test computer has no graphics card and draws only a frame or two a second, so the whole run gets a long ceiling
  const ceiling = setTimeout(() => { result.error = 'ceiling reached'; finish(); }, 1800000);
  async function finish() {
    clearTimeout(ceiling);
    try { if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2)); } catch (_) {}
    app.exit(result.ok ? 0 : 1);
  }
  try {
    if (!(await waitForSite())) throw new Error('site never became ready');
    await waitFrames(60);
    result.pageFpsStart = await pageFps();
    log(`Self-test: page drawing ${result.pageFpsStart} frames a second at the start`);
    // Every size change below must keep the page (and so the look) instead of reloading it
    await site.webContents.executeJavaScript('window.__keepMarker = 42', true);
    const sizeNow = () => site.webContents.executeJavaScript('[window.__phosphorCapture.canvas.width, window.__phosphorCapture.canvas.height, window.__keepMarker || 0]', true);
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    const expect = async (what, want, label) => {
      const now = await sizeNow();
      result.sizes = { ...(result.sizes || {}), [label]: now };
      if (now[2] !== 42) throw new Error(`${what}: the page reloaded`);
      if (!want(now)) throw new Error(`${what}: picture is ${now[0]}x${now[1]}`);
      return now;
    };
    // Neither streaming nor recording: drawn at the window's own size, not the stream's
    settings.quality = 'good';
    await resizeSite(); await waitFrames(10);
    const free = await expect('nothing on', (n) => !(n[0] === 1280 && n[1] === 720), 'idle');
    // Stream on (with Stream-friendly): the stream's size
    setStreamFriendly(true);
    const calmIdle = await site.webContents.executeJavaScript('window.__phosphorCapture.calm || null', true);
    if (!calmIdle || calmIdle.on) throw new Error('Stream-friendly came on before streaming started: ' + JSON.stringify(calmIdle));
    const r = await goLive();
    if (!r.ok) throw new Error('go live failed: ' + (r.message || ''));
    await expect('streaming', (n) => n[1] === 720, 'live');
    // Stream-friendly (switched on before going live): the page is calmed and the stream has its smoothing
    await waitFrames(5);
    const calm = await site.webContents.executeJavaScript('window.__phosphorCapture.calm || null', true);
    result.calm = calm;
    if (!calm || !calm.on) throw new Error('Stream-friendly did not reach the page: ' + JSON.stringify(calm));
    if (!streamer.plan.calm) throw new Error('the stream has no Stream-friendly smoothing');
    await waitFrames(Math.round(frames / 2));
    // Record on while streaming, bigger than the stream: drawn at the recording's size, the stream gets a copy
    settings.record = { size: 1080, quality: 'youtube', fps: 30 };
    const rs = await recordStart();
    if (!rs.ok) throw new Error('recording did not start');
    await expect('recording 1080p while streaming 720p', (n) => n[1] === 1080, 'liveAndRecording');
    if (!streamer.live) throw new Error('the stream stopped when recording started');
    if (streamer.plan.input.height !== 1080) throw new Error('the stream is not made from the bigger picture');
    await waitFrames(20, 30000);
    const saved = await recordStop();
    result.recording = { ok: !!(saved && saved.ok), file: saved && saved.output };
    if (!result.recording.ok) throw new Error('the recording could not be saved');
    const info = await new Promise((res) => execFile(ffmpegPath(), ['-hide_banner', '-i', saved.output], (_e, _o, se) => res(String(se))));
    result.recording.info = info.split('\n').filter((l) => /Stream|Duration/.test(l)).map((l) => l.trim()).join(' | ');
    if (!/Video: h264.*\(tv, bt709[,)].*1920x1080/.test(info) || !/Audio: aac/.test(info)) throw new Error('the recording is not 1080p H.264 labelled BT.709 with AAC sound: ' + result.recording.info);
    await waitFrames(10);
    await expect('recording off, still streaming', (n) => n[1] === 720, 'liveAgain');
    const drawn = await waitFrames(Math.round(frames / 2));
    result.framesWaited = drawn ? frames : 'ceiling';
    const dir = process.env.PHOSPHOR_TEST_SHOTS;
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'panel-live.png'), (await win.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(dir, 'site.png'), (await site.webContents.capturePage()).toPNG());
    }
    result.status = streamer.status();
    result.capture = captureInfo;
    result.chunks = streamer.chunksIn;
    await stopLive();
    await new Promise((res) => setTimeout(res, 6000)); // let the last pieces reach the test server (shutdown, not a picture wait)
    if (dir) fs.writeFileSync(path.join(dir, 'panel-off.png'), (await win.webContents.capturePage()).toPNG());
    await waitFrames(10);
    await expect('stream off', (n) => same(n, free), 'idleAgain');
    // Stream-friendly is for streaming only: off air, the page has its full picture back
    const calmOff = await site.webContents.executeJavaScript('window.__phosphorCapture.calm || null', true);
    if (!calmOff || calmOff.on) throw new Error('Stream-friendly stayed on after the stream stopped: ' + JSON.stringify(calmOff));
    setStreamFriendly(false);
    // Record on its own, then Discard: nothing is saved, and the picture goes back to the window's size
    const before = fs.readdirSync(recDir()).length;
    if (!(await recordStart()).ok) throw new Error('recording on its own did not start');
    await expect('recording on its own', (n) => n[1] === 1080, 'recordingAlone');
    await waitFrames(5, 30000);
    if (!(await recordDiscard()).ok) throw new Error('discard did not work');
    const after = fs.readdirSync(recDir()).length;
    result.discard = { before, after };
    if (after !== before) throw new Error('discard left a file behind');
    await waitFrames(10);
    await expect('after discarding', (n) => same(n, free), 'idleAfterDiscard');
    result.pageFpsBefore = await pageFps();
    // The sharpness test on the real page (this computer has no graphics card, so the NVIDIA setting must fail politely)
    const t = await sharpnessTest({ ids: ['x264-veryfast', 'nv-p7-full'], frames: 30 });
    result.sharpness = { ok: t.ok, picked: t.picked, results: t.results, summary: tune.summary, firstStage: tune.firstStage };
    if (!t.ok) throw new Error('sharpness test failed: ' + tune.summary);
    if (!t.results.some((r) => r.ok && Number.isFinite(r.detail))) throw new Error('sharpness test scored nothing');
    if (!tune.firstStage || !tune.firstStage.ok) throw new Error('page recorder check failed: ' + JSON.stringify(tune.firstStage));
    if (await site.webContents.executeJavaScript('window.__keepMarker || 0', true) !== 42) throw new Error('the sharpness test reloaded the page');
    if (process.env.PHOSPHOR_TEST_SHOTS) {
      fs.mkdirSync(process.env.PHOSPHOR_TEST_SHOTS, { recursive: true });
      await win.webContents.executeJavaScript("new Promise((r) => { document.getElementById('tune').scrollIntoView({ block: 'start' }); requestAnimationFrame(() => requestAnimationFrame(r)); })", true);
      fs.writeFileSync(path.join(process.env.PHOSPHOR_TEST_SHOTS, 'panel-sharpness.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript("document.getElementById('onair').scrollIntoView()", true);
    }
    result.pageFpsAfter = await pageFps();
    log(`Self-test: page drew ${result.pageFpsBefore} frames a second before the sharpness test, ${result.pageFpsAfter} after`);
    result.ok = result.chunks > 0;
  } catch (e) { result.error = e.message; }
  finish();
}
