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
  renderStreaming();
  $('#opt-yt-hevc').checked = !!S.youtube.hevc;
  $$('[data-q]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.q === S.quality)));
  $('#qualityHint').innerHTML = '';
  $('#qualityHint').append(QHINT[S.quality] + (status.live ? ' Stop the stream to change this.' : ''));
  const need = uploadLine();
  if (need) { const el = document.createElement('span'); el.className = 'need'; el.textContent = need; $('#qualityHint').append(el); }
  $('#panel').hidden = S.collapsed; $('#strip').hidden = !S.collapsed;
}

// Streaming? On: Phosphor Loop draws at the stream's size. Off: at this screen's own size, as Phosphor Loop's
// Picture sharpness (under Screen) picks, up to 4K.
function renderStreaming() {
  const on = status.streaming ?? S.streaming;
  $('#opt-streaming').checked = !!on;
  $('#streamingHint').textContent = on
    ? 'On: the picture is drawn at the stream’s size (Picture quality, below).'
    : 'Off: the picture is drawn at this screen’s size, up to 4K. Set it in Phosphor Loop under Screen › Picture sharpness (Full is sharpest). Go live switches this on.';
  $('#panel').classList.toggle('not-streaming', !on);
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
  if (S) renderStreaming();
  $('#stripDot').classList.toggle('live', state === 'live');

  const title = { off: 'Off air', starting: 'Going live…', live: 'Live', retrying: 'Reconnecting…' }[state];
  $('#airTitle').textContent = state === 'live' ? `Live · ${fmtTime(Date.now() - status.since)}` : title;
  let sub = 'Ready when you are.';
  if (state === 'starting') sub = 'Connecting to ' + (Object.keys(dests).map((k) => NAMES[k] || k).join(' and ') || 'the platforms') + '…';
  if (state === 'live') {
    sub = status.kbps ? `Sending · ${(status.kbps / 1000).toFixed(1)} Mbps` : 'Sending…';
    if (status.pictureFps) sub += ` · ${status.pictureFps} frames a second`;
  }
  if (state === 'retrying') sub = 'Lost the connection. Trying again by itself.';
  $('#airSub').textContent = sub;

  const btn = $('#golive');
  if (!btn.classList.contains('confirm')) btn.textContent = status.live ? 'Stop stream' : (status.starting ? 'Going live…' : 'Go live');
  btn.disabled = !!status.starting;

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
let confirmTimer;
$('#golive').addEventListener('click', async () => {
  const btn = $('#golive');
  if (status.live) {
    // Stopping takes two clicks, so a stray click never ends a stream
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm'); btn.textContent = 'Click again to stop';
      confirmTimer = setTimeout(() => { btn.classList.remove('confirm'); renderStatus(); }, 3000);
      return;
    }
    clearTimeout(confirmTimer); btn.classList.remove('confirm');
    await window.app.stop();
    return;
  }
  await window.app.goLive();
});

for (const p of PLATFORMS) {
  $(`#on-${p}`).addEventListener('change', (e) => save({ [p]: { enabled: e.target.checked } }));
}
$('#opt-yt-hevc').addEventListener('change', (e) => save({ youtube: { hevc: e.target.checked } }));
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
$('#opt-streaming').addEventListener('change', (e) => save({ streaming: e.target.checked }));
for (const k of ['startWithWindows', 'goLiveOnOpen', 'autopilotOnLive']) {
  $(`#opt-${k}`).addEventListener('change', (e) => save({ [k]: e.target.checked }));
}
$('#collapse').addEventListener('click', () => { S.collapsed = true; window.app.collapse(true); renderSettings(); });
$('#expand').addEventListener('click', () => { S.collapsed = false; window.app.collapse(false); renderSettings(); });
$('#openLog').addEventListener('click', () => window.app.openLog());

window.app.onStatus((s) => { status = s; renderStatus(); });
window.app.onNotice((n) => { status.notice = n; showNotice(n); });
setInterval(() => { if (status.live) renderStatus(); }, 1000);

(async () => {
  const st = await window.app.state();
  S = st.settings; status = st.status; quality = st.quality; tune = st.tune || tune;
  renderSettings(); renderStatus(); renderTune();
})();
