'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let S = null, status = { live: false, destinations: {} }, quality = {};

const PLATFORMS = ['twitch', 'kick', 'youtube'];
const NAMES = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube' };
const MAX_H = { twitch: 1080, kick: 1080, youtube: 2160 };
const QHINT = {
  good: '720p at 30 frames a second. Works on most home internet.',
  better: '1080p at 30 frames a second. Recommended for Kick and Twitch: keeps the most fine detail.',
  best: '1080p at 60 frames a second. Smoothest motion, but on Kick and Twitch fine detail suffers (each frame gets half the data).',
  ultra: '1440p at 30 frames a second. YouTube gets the full 1440p; Kick and Twitch get a sharp 1080p copy. Needs a strong graphics card.',
  max: '4K at 30 frames a second. YouTube gets full 4K; Kick and Twitch get a sharp 1080p copy. Needs a very strong graphics card and fast internet.',
};
// What each switched-on platform gets at this quality, and the upload that needs (with 20% to spare)
function uploadLine() {
  const q = quality[S.quality];
  if (!q) return '';
  const on = PLATFORMS.filter((p) => S[p].enabled);
  if (!on.length) return '';
  let total = 0;
  const parts = on.map((p) => {
    const h = Math.min(q.height, MAX_H[p]);
    const table = h === q.height ? q : (q.fps > 30 ? quality.best : quality.better);
    const mbps = (table.bitrate[p] || table.bitrate.twitch) / 1e6;
    total += mbps + 0.16;
    return `${NAMES[p]} ${h === 2160 ? '4K' : h + 'p'} at ${mbps.toFixed(1)} Mbps`;
  });
  return `${parts.join(', ')}. Upload needed: about ${Math.ceil(total * 1.2)} Mbps.`;
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

function renderSettings() {
  for (const p of PLATFORMS) {
    const d = S[p];
    $(`#on-${p}`).checked = d.enabled;
    $(`#dest-${p}`).classList.toggle('disabled', !d.enabled);
    const editing = $(`#fields-${p}`).dataset.editing === '1';
    $(`#saved-${p}`).hidden = !d.hasKey || editing;
    $(`#fields-${p}`).hidden = d.hasKey && !editing;
  }
  if (S.kick.server && !$('#server-kick').value) $('#server-kick').value = S.kick.server;
  for (const k of ['startWithWindows', 'goLiveOnOpen', 'autopilotOnLive']) $(`#opt-${k}`).checked = S[k];
  $('#opt-calm').checked = !!S.streamFriendly;
  renderRec();
  $('#opt-yt-hevc').checked = !!S.youtube.hevc;
  $$('[data-q]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.q === S.quality)));
  $('#qualityHint').innerHTML = '';
  $('#qualityHint').append(QHINT[S.quality] + (status.live ? ' Stop the stream to change this.' : ''));
  const need = uploadLine();
  if (need) { const el = document.createElement('span'); el.className = 'need'; el.textContent = need; $('#qualityHint').append(el); }
  $('#panel').hidden = S.collapsed; $('#strip').hidden = !S.collapsed;
}

/* ---- recording a video ---- */
// Its own size, quality and speed, whether or not streaming is on: with both on, the picture is drawn at the bigger
// of the two sizes and the stream gets a sharp smaller copy
const REC_MBPS = { youtube: { 2160: 45, 1440: 24, 1080: 12 }, clean: { 2160: 100, 1440: 50, 1080: 30 }, perfect: { 2160: 250, 1440: 130, 1080: 70 } };
const REC_Q_NAME = { youtube: 'Standard', clean: 'Very clean', perfect: 'Near-perfect' };
function recSizeText(h) { return h >= 2160 ? '4K' : h + 'p'; }
let discardArmed = false, discardTimer = 0;
function renderRec() {
  if (!S) return;
  const r = S.record || { size: 2160, quality: 'clean', fps: 30 };
  const R = status.rec || { state: 'idle' };
  const busy = R.state !== 'idle';
  $$('[data-rsize]').forEach((b) => { b.setAttribute('aria-checked', String(+b.dataset.rsize === r.size)); b.disabled = busy; });
  $$('[data-rq]').forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.rq === r.quality)); b.disabled = busy; });
  $$('[data-rfps]').forEach((b) => { b.setAttribute('aria-checked', String(+b.dataset.rfps === r.fps)); b.disabled = busy; });
  const mbps = REC_MBPS[r.quality][r.size] * (r.fps > 30 ? 1.5 : 1);
  const gb5 = (mbps + 0.384) * 300 / 8 / 1000;
  const size5 = gb5 < 1 ? Math.round(gb5 * 1000) + ' MB' : gb5.toFixed(1) + ' GB';
  $('#recHint').textContent = `${recSizeText(r.size)} at ${r.fps} fps, ${mbps} Mbps: about ${size5} for 5 minutes, with sound. Saved to Videos › Phosphor Loop. Works the same with or without streaming.`;
  // The Record switch at the top
  const row = $('#recRow'), sw = $('#recSw');
  row.dataset.state = R.state;
  sw.checked = R.state === 'recording' || R.state === 'starting';
  sw.disabled = R.state === 'starting' || R.state === 'saving' || R.state === 'discarding' || !!tune.running;
  const secs = R.since ? Math.max(0, Math.floor((Date.now() - R.since) / 1000)) : 0;
  $('#recTitle').textContent = R.state === 'recording' ? `· ${fmtTime(secs * 1000).replace(/^00:/, '')}`
    : R.state === 'starting' ? '· getting ready…' : R.state === 'saving' ? '· saving…' : R.state === 'discarding' ? '· discarding…' : 'Off';
  $('#recSub').textContent = R.state === 'recording'
    ? `${recSizeText(R.height)} · ${R.fps} fps · ${((R.bytes || 0) / 1e9).toFixed(2)} GB so far${R.slow ? ` · only ${R.slow} fps!` : ''}. Switch off to save.`
    : `${recSizeText(r.size)}, ${REC_Q_NAME[r.quality]}, ${r.fps} fps (change under Record a video).`;
  $('#recSaving').hidden = R.state !== 'saving';
  if (R.state === 'saving') {
    $('#recBar').style.width = Math.round(4 + 96 * (R.progress || 0)) + '%';
    $('#recStep').textContent = `Saving your video: ${Math.round(100 * (R.progress || 0))}%. Keep the app open until it’s done.`;
  }
  const disc = $('#recDiscard');
  disc.hidden = R.state !== 'recording';
  if (R.state !== 'recording') discardArmed = false;
  disc.textContent = discardArmed ? 'Click again to throw it away' : 'Discard this recording';
  disc.classList.toggle('armed', discardArmed);
  $('#recFolder').textContent = R.last ? 'Show the last video in its folder' : 'Open the recordings folder';
}

const STATE_WORDS = { connecting: 'Connecting…', live: 'Live', retrying: 'Reconnecting…' };
function renderStatus() {
  const dests = status.destinations || {};
  const states = Object.values(dests).map((d) => d.state);
  const anyLive = states.includes('live');
  let state = 'off';
  if (status.starting) state = 'starting';
  else if (status.live) state = anyLive ? 'live' : (states.includes('retrying') ? 'retrying' : 'starting');
  $('#onair').dataset.state = state;
  if (S) renderRec();
  $('#stripDot').classList.toggle('live', state === 'live');

  const title = { off: 'Off', starting: '· going live…', live: 'Live', retrying: '· reconnecting…' }[state];
  $('#airTitle').textContent = state === 'live' ? `· live ${fmtTime(Date.now() - status.since)}` : title;
  let sub = 'Switch on to go live.';
  if (state === 'starting') sub = 'Connecting to ' + (Object.keys(dests).map((k) => NAMES[k] || k).join(' and ') || 'the platforms') + '…';
  if (state === 'live') {
    sub = status.kbps ? `Sending · ${(status.kbps / 1000).toFixed(1)} Mbps` : 'Sending…';
    if (status.pictureFps) sub += ` · ${status.pictureFps} frames a second`;
  }
  if (state === 'retrying') sub = 'Lost the connection. Trying again by itself.';
  $('#airSub').textContent = sub;

  const sw = $('#streamSw');
  sw.checked = !!status.live || !!status.starting;
  sw.disabled = !!status.starting;
  $('#streamRow').classList.toggle('confirm', stopArmed);
  if (stopArmed) $('#airSub').textContent = 'Click the switch again to stop the stream.';

  for (const p of PLATFORMS) {
    const d = dests[p];
    const card = $(`#dest-${p}`);
    card.dataset.s = d ? d.state : (S && S[p].enabled ? 'idle' : 'off');
    $(`#state-${p}`).textContent = d ? (d.state === 'retrying' ? d.message : STATE_WORDS[d.state] || '') : '';
    $(`#on-${p}`).disabled = !!status.live;
  }
  if (status.encoder) $('#encoder').textContent = 'Using: ' + status.encoder + (status.setting ? ` · ${status.setting}` : '');
  $('#tuneRun').disabled = !!tune.running || !!status.live || !!status.starting;
  $$('[data-q]').forEach((b) => { b.disabled = !!status.live || !!tune.running; });
  // Phosphor Loop can't draw as fast as the stream asks: say so plainly and suggest the fix
  // Phosphor Loop can't draw as fast as the stream asks: say so plainly and suggest the fix
  const slow = state === 'live' && status.pictureFps && status.pictureFps < status.wantFps * 0.85 && Date.now() - status.since > 20000;
  const slowText = status.wantFps > 30
    ? `This computer is drawing about ${status.pictureFps} frames a second, short of the ${status.wantFps} that Best sends, so the stream repeats frames. Better (30 frames a second) will look smoother and sharper.`
    : `This computer is drawing about ${status.pictureFps} frames a second, short of ${status.wantFps}, so the stream repeats frames. A smaller picture quality (like 1080p instead of 4K) will look smoother.`;
  showNotice(status.notice || (slow ? { kind: 'warn', text: slowText } : null));
}

function showNotice(n) {
  const el = $('#notice');
  el.hidden = !n || !n.text;
  if (n && n.text) { el.textContent = n.text; el.className = 'notice ' + (n.kind || 'info'); }
}

/* ---- sharpness test ---- */
let tune = { running: false, results: [] };
function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderTune() {
  const running = !!tune.running;
  $('#tuneRun').disabled = running || !!status.live || !!status.starting;
  $('#tuneRun').textContent = running ? 'Testing…' : (tune.last ? 'Run the sharpness test again' : 'Run the sharpness test');
  $('#tuneRunning').hidden = !running;
  if (running) {
    const n = tune.n || 1, done = tune.results.length;
    $('#tuneBar').style.width = (tune.n ? 8 + 92 * done / n : 4) + '%';
    $('#tuneStep').textContent = tune.step || '';
  }
  // The bars: this run's results while it runs or right after it, otherwise the last saved run
  const rows = (tune.results && tune.results.length) ? tune.results : (tune.last && tune.last.results) || [];
  const ok = rows.filter((r) => r.ok);
  const lo = Math.min(...ok.map((r) => r.detail)), hi = Math.max(...ok.map((r) => r.detail));
  const width = (d) => (hi > lo ? 18 + 82 * (d - lo) / (hi - lo) : 100);
  const sorted = [...rows].sort((a, b) => (b.ok - a.ok) || ((b.detail || 0) - (a.detail || 0)));
  $('#tuneBars').innerHTML = sorted.map((r) => {
    const note = !r.ok ? 'not on this PC' : r.chosen ? 'picked' : r.usual ? 'before' : '';
    return `<li class="${r.ok ? '' : 'off'} ${r.chosen ? 'chosen' : ''} ${r.usual ? 'usual' : ''}" title="${esc(r.id)}${r.ok ? ` · ${r.speed} frames a second` : ' · ' + esc(r.error || '')}">` +
      `<span class="name">${esc(r.label)}${note ? `<em>${note}</em>` : ''}</span>` +
      `<span class="bar"><i style="width:${r.ok ? width(r.detail) : 100}%"></i></span>` +
      `<span class="val">${r.ok ? r.detail.toFixed(1) : '–'}</span></li>`;
  }).join('');
  let summary = tune.summary || '';
  if (!summary && tune.last) {
    const when = new Date(tune.last.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    summary = `Last test (${when}) picked “${tune.last.label}”.` + (tune.last.gain > 0 ? ` ${tune.last.gain} dB sharper than before.` : '');
  }
  if (rows.length && !running) summary += ' Longer bar = sharper (scores in dB; 1 dB is easy to see on fine detail).';
  $('#tuneSummary').textContent = summary;
}
$('#tuneRun').addEventListener('click', () => { if (!tune.running && !status.live) window.app.sharpnessTest(); });
window.app.onTune((t) => { tune = t; renderTune(); renderStatus(); });

async function save(patch) { S = await window.app.save(patch); renderSettings(); renderStatus(); }

/* ---- events ---- */
// The Stream switch: on goes live; off takes two clicks, so a stray click never ends a stream
let stopArmed = false, stopTimer = 0;
$('#streamSw').addEventListener('change', async (e) => {
  if (status.live) {
    e.target.checked = true;
    if (!stopArmed) {
      stopArmed = true;
      stopTimer = setTimeout(() => { stopArmed = false; renderStatus(); }, 3000);
      renderStatus();
      return;
    }
    clearTimeout(stopTimer); stopArmed = false;
    await window.app.stop();
    renderStatus();
    return;
  }
  await window.app.goLive();
  renderStatus();
});
// The Record switch: on starts recording, off stops and saves it. Discard (two clicks) throws it away instead.
$('#recSw').addEventListener('change', async (e) => {
  const R = status.rec || {};
  if (e.target.checked && (!R.state || R.state === 'idle')) await window.app.record(true);
  else if (!e.target.checked && R.state === 'recording') await window.app.record(false);
  renderRec();
});
$('#recDiscard').addEventListener('click', async () => {
  if (!discardArmed) {
    discardArmed = true;
    clearTimeout(discardTimer);
    discardTimer = setTimeout(() => { discardArmed = false; renderRec(); }, 3000);
    renderRec();
    return;
  }
  clearTimeout(discardTimer); discardArmed = false;
  await window.app.discard();
  renderRec();
});

for (const p of PLATFORMS) {
  $(`#on-${p}`).addEventListener('change', (e) => save({ [p]: { enabled: e.target.checked } }));
}
$('#opt-yt-hevc').addEventListener('change', (e) => save({ youtube: { hevc: e.target.checked } }));
$('#opt-calm').addEventListener('change', (e) => save({ streamFriendly: e.target.checked }));
$$('[data-save]').forEach((b) => b.addEventListener('click', async () => {
  const p = b.dataset.save;
  const key = $(`#key-${p}`).value.trim();
  const patch = { [p]: {} };
  if (p === 'kick') patch.kick.server = $('#server-kick').value.trim();
  if (key) patch[p].key = key;
  if (!key && !S[p].hasKey) { showNotice({ text: 'Paste your stream key into the box first.', kind: 'warn' }); return; }
  if (p === 'kick' && !patch.kick.server) { showNotice({ text: 'Paste Kick’s Stream URL into the server address box too.', kind: 'warn' }); return; }
  $(`#key-${p}`).value = '';
  $(`#fields-${p}`).dataset.editing = '0';
  $(`#how-${p}`).hidden = true;
  showNotice(null);
  await save(patch);
}));
$$('[data-change]').forEach((b) => b.addEventListener('click', () => {
  const p = b.dataset.change;
  $(`#fields-${p}`).dataset.editing = '1';
  renderSettings();
  $(`#key-${p}`).focus();
}));
$$('[data-help]').forEach((b) => b.addEventListener('click', () => {
  window.app.help(b.dataset.help);
  $(`#how-${b.dataset.help}`).hidden = false;
}));
$$('[data-show]').forEach((b) => b.addEventListener('click', () => {
  const input = $('#' + b.dataset.show);
  input.type = input.type === 'password' ? 'text' : 'password';
  b.textContent = input.type === 'password' ? 'Show' : 'Hide';
}));
$$('[data-q]').forEach((b) => b.addEventListener('click', () => { if (!status.live) save({ quality: b.dataset.q }); }));
$$('[data-rsize]').forEach((b) => b.addEventListener('click', () => save({ record: { size: +b.dataset.rsize } })));
$$('[data-rq]').forEach((b) => b.addEventListener('click', () => save({ record: { quality: b.dataset.rq } })));
$$('[data-rfps]').forEach((b) => b.addEventListener('click', () => save({ record: { fps: +b.dataset.rfps } })));
$('#recFolder').addEventListener('click', () => window.app.openRecordings());
for (const k of ['startWithWindows', 'goLiveOnOpen', 'autopilotOnLive']) {
  $(`#opt-${k}`).addEventListener('change', (e) => save({ [k]: e.target.checked }));
}
$('#collapse').addEventListener('click', () => { S.collapsed = true; window.app.collapse(true); renderSettings(); });
$('#expand').addEventListener('click', () => { S.collapsed = false; window.app.collapse(false); renderSettings(); });
$('#openLog').addEventListener('click', () => window.app.openLog());

window.app.onStatus((s) => { status = s; renderStatus(); });
window.app.onNotice((n) => { status.notice = n; showNotice(n); });
setInterval(() => { if (status.live || (status.rec && status.rec.state === 'recording')) renderStatus(); }, 1000);

(async () => {
  const st = await window.app.state();
  S = st.settings; status = st.status; quality = st.quality; tune = st.tune || tune;
  renderSettings(); renderStatus(); renderTune();
})();
