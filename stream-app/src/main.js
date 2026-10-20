'use strict';
// Phosphor Stream: one window with Phosphor Loop on the left and the streaming controls on the right.
const { app, BrowserWindow, WebContentsView, ipcMain, session, desktopCapturer, safeStorage, shell, dialog,
  powerSaveBlocker } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { Streamer, buildUrl, VARIANTS, TIERS } = require('./stream.js');
const { Tuner, candidates, pick } = require('./tune.js');
const capturePageSource = require('./capture-page.js');

const TEST = process.env.PHOSPHOR_TEST === '1';
const SITE = process.env.PHOSPHOR_SITE || 'https://nhillson.github.io/phosphor-loop/';
const PANEL_W = 360, PANEL_COLLAPSED_W = 48;

// Upload speed per platform: Twitch takes up to 6 Mbps; Kick (Amazon IVS) takes up to 8.5 Mbps at 1080p60 and hangs
// up when a stream goes over, so Kick gets 7.5 to leave room for sound and the odd busy moment.
// When both are on, one stream goes to both, so it uses the lower of the two.
const QUALITY = {
  good: { width: 1280, height: 720, fps: 30, bitrate: { twitch: 4500000, kick: 4500000 } },
  better: { width: 1920, height: 1080, fps: 30, bitrate: { twitch: 6000000, kick: 7500000 } },
  best: { width: 1920, height: 1080, fps: 60, bitrate: { twitch: 6000000, kick: 7500000 } },
};
// The picture is first recorded inside Phosphor Loop, then squeezed for the platforms. That first recording is
// kept nearly lossless (very high quality, it never leaves the computer), so the picture is only really
// squeezed once.
const recordBitrate = (q) => (q.height >= 1080 ? 60000000 : 35000000) * (q.fps > 30 ? 1.5 : 1);
const streamQuality = (q, dests) => ({ ...q, bitrate: Math.min(...dests.map((d) => q.bitrate[d.id] || q.bitrate.twitch)) });

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
  quality: 'better', startWithWindows: false, goLiveOnOpen: false, autopilotOnLive: false, collapsed: false,
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
  settings = { ...DEFAULTS, ...s, twitch: { ...DEFAULTS.twitch, ...s.twitch }, kick: { ...DEFAULTS.kick, ...s.kick } };
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
    quality: settings.quality, startWithWindows: settings.startWithWindows, goLiveOnOpen: settings.goLiveOnOpen,
    autopilotOnLive: settings.autopilotOnLive, collapsed: settings.collapsed,
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
  return { ...streamer.status(), notice, starting: !!startingLive, setting: v ? v.label : '', tuned: !!(streamer.encoder && streamer.encoder.tier === 'tuned') };
}
function sendStatus() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('status', fullStatus());
}
streamer.on('status', sendStatus);
function tell(text, kind = 'info') {
  notice = text ? { text, kind, at: Date.now() } : null;
  if (win && !win.isDestroyed()) win.webContents.send('notice', notice);
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
    return list;
  }
  const t = settings.twitch, k = settings.kick;
  if (t.enabled && t.key) { const key = unlock(t.key); list.push({ id: 'twitch', name: 'Twitch', url: buildUrl('twitch', { key }), secret: key }); }
  if (k.enabled && k.key && k.server) { const key = unlock(k.key); list.push({ id: 'kick', name: 'Kick', url: buildUrl('kick', { server: k.server, key }), secret: key }); }
  return list.filter((d) => d.url && d.secret);
}

let startingLive = false;
async function goLive() {
  if (streamer.live || startingLive) return { ok: true };
  if (tune.running) { tell('The sharpness test is still running. Go live once it finishes (a minute or two).', 'warn'); return { ok: false }; }
  const dests = destinations();
  if (!dests.length) {
    const t = settings.twitch, k = settings.kick;
    const msg = !t.enabled && !k.enabled ? 'Switch on Twitch or Kick first.'
      : 'Add your stream key first (and the server address for Kick).';
    tell(msg, 'warn');
    return { ok: false, message: msg };
  }
  startingLive = true; tell(''); sendStatus();
  try {
    if (probing) await probing;
    if (!(await waitForSite())) { tell('Phosphor Loop didn’t finish loading. Check the internet connection, then try again.', 'warn'); return { ok: false }; }
    const sq = streamQuality(QUALITY[settings.quality], dests);
    streamer.start(dests, sq);
    if (settings.autopilotOnLive) siteCall('autopilot').catch(() => {});
    if (sleepBlock === null) sleepBlock = powerSaveBlocker.start('prevent-display-sleep');
    log(`Going live to ${dests.map((d) => d.name).join(' + ')} at ${settings.quality} (${sq.height}p${sq.fps}, ${(sq.bitrate / 1e6).toFixed(1)} Mbps)`);
    return { ok: true };
  } finally { startingLive = false; sendStatus(); }
}
async function stopLive() {
  if (!streamer.live) return;
  log('Stopping');
  try { await siteCall('stop'); } catch (_) {}
  streamer.stop();
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
    if (!streamer.live) return;
    // The page reloaded while live: pick the picture up again
    log('Page reloaded while live; reconnecting the picture');
    if (await waitForSite()) streamer.restartEncoder();
  });
  wc.on('render-process-gone', (_e, d) => { log('Page stopped: ' + d.reason); setTimeout(() => wc.reload(), 1500); });
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
    if (!streamer.live || TEST) return;
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
  app.getGPUInfo('complete').then((info) => {
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
  tune = { running: true, step: 'Getting ready…', i: 0, n: 0, results: [], summary: '' };
  sendTune(); sendStatus();
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
    sendTune(); sendStatus();
  }
  return result;
}
ipcMain.handle('sharpness-test', () => sharpnessTest());

/* ---------- controls panel ---------- */
const HELP = {
  twitch: 'https://dashboard.twitch.tv/settings/stream',
  kick: 'https://kick.com/dashboard/settings/stream',
};
ipcMain.handle('state', () => ({ settings: publicSettings(), status: fullStatus(), quality: QUALITY, tune: publicTune() }));
ipcMain.handle('save', (_e, patch) => {
  const before = settings.quality;
  for (const p of ['twitch', 'kick']) {
    if (!patch[p]) continue;
    const cur = settings[p];
    if ('enabled' in patch[p]) cur.enabled = !!patch[p].enabled;
    if ('server' in patch[p]) cur.server = String(patch[p].server || '').trim();
    if ('key' in patch[p]) cur.key = lock(String(patch[p].key || '').trim());
  }
  for (const k of ['startWithWindows', 'goLiveOnOpen', 'autopilotOnLive']) if (k in patch) settings[k] = !!patch[k];
  if (patch.quality && QUALITY[patch.quality] && !streamer.live && !tune.running) settings.quality = patch.quality;
  if ('startWithWindows' in patch && app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.startWithWindows });
  saveSettings();
  // A new size: tell Phosphor Loop to draw at it. It carries the current picture and every setting across, the
  // same way it does when its window is resized. Only if that isn't possible is the page reloaded.
  if (settings.quality !== before) resizeSite();
  return publicSettings();
});
function captureConfig() {
  const q = QUALITY[settings.quality];
  return { width: q.width, height: q.height, fps: q.fps, renderHeight: q.height };
}
async function resizeSite() {
  const cfg = captureConfig();
  let ok = false;
  try {
    ok = await site.webContents.executeJavaScript(`(() => {
      const c = window.__phosphorCaptureConfig;
      if (!c) return false;
      try { Object.assign(c, ${JSON.stringify(cfg)}); } catch (_) { return false; }
      if (c.height !== ${cfg.height} || c.fps !== ${cfg.fps}) return false;
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
  const ceiling = setTimeout(() => { result.error = 'ceiling reached'; finish(); }, 900000);
  async function finish() {
    clearTimeout(ceiling);
    try { if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2)); } catch (_) {}
    app.exit(result.ok ? 0 : 1);
  }
  try {
    if (!(await waitForSite())) throw new Error('site never became ready');
    await waitFrames(60);
    // Changing quality must keep the page (and so the look) instead of reloading it
    await site.webContents.executeJavaScript('window.__keepMarker = 42', true);
    const sizeNow = () => site.webContents.executeJavaScript('[window.__phosphorCapture.canvas.width, window.__phosphorCapture.canvas.height, window.__keepMarker || 0]', true);
    settings.quality = 'better'; await resizeSite(); await waitFrames(30);
    const big = await sizeNow();
    settings.quality = 'good'; await resizeSite(); await waitFrames(30);
    const small = await sizeNow();
    result.qualitySwitch = { better: big, good: small };
    if (big[2] !== 42 || small[2] !== 42) throw new Error('changing quality reloaded the page');
    if (big[1] !== 1080 || small[1] !== 720) throw new Error('changing quality did not change the picture size: ' + JSON.stringify(result.qualitySwitch));
    const r = await goLive();
    if (!r.ok) throw new Error('go live failed: ' + (r.message || ''));
    const drawn = await waitFrames(frames);
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
