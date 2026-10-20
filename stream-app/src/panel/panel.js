'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let S = null, status = { live: false, destinations: {} }, quality = {};

const QHINT = {
  good: '720p at 30 frames a second. Works on most home internet (about 6 Mbps upload).',
  better: '1080p at 30 frames a second. The sharpest picture for video feedback (about 10 Mbps upload for Kick).',
  best: '1080p at 60 frames a second. Smoothest motion, but each frame gets half the detail (about 10 Mbps upload for Kick).',
};

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

function renderSettings() {
  for (const p of ['twitch', 'kick']) {
    const d = S[p];
    $(`#on-${p}`).checked = d.enabled;
    $(`#dest-${p}`).classList.toggle('disabled', !d.enabled);
    const editing = $(`#fields-${p}`).dataset.editing === '1';
    $(`#saved-${p}`).hidden = !d.hasKey || editing;
    $(`#fields-${p}`).hidden = d.hasKey && !editing;
  }
  if (S.kick.server && !$('#server-kick').value) $('#server-kick').value = S.kick.server;
  for (const k of ['startWithWindows', 'goLiveOnOpen', 'autopilotOnLive']) $(`#opt-${k}`).checked = S[k];
  $$('#quality button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.q === S.quality)));
  $('#qualityHint').textContent = QHINT[S.quality] + (status.live ? ' Stop the stream to change this.' : '');
  $('#panel').hidden = S.collapsed; $('#strip').hidden = !S.collapsed;
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
  $('#stripDot').classList.toggle('live', state === 'live');

  const title = { off: 'Off air', starting: 'Going live…', live: 'Live', retrying: 'Reconnecting…' }[state];
  $('#airTitle').textContent = state === 'live' ? `Live · ${fmtTime(Date.now() - status.since)}` : title;
  let sub = 'Ready when you are.';
  if (state === 'starting') sub = 'Connecting to ' + (Object.keys(dests).map((k) => k === 'kick' ? 'Kick' : 'Twitch').join(' and ') || 'the platforms') + '…';
  if (state === 'live') {
    sub = status.kbps ? `Sending · ${(status.kbps / 1000).toFixed(1)} Mbps` : 'Sending…';
    if (status.pictureFps) sub += ` · ${status.pictureFps} frames a second`;
  }
  if (state === 'retrying') sub = 'Lost the connection. Trying again by itself.';
  $('#airSub').textContent = sub;

  const btn = $('#golive');
  if (!btn.classList.contains('confirm')) btn.textContent = status.live ? 'Stop stream' : (status.starting ? 'Going live…' : 'Go live');
  btn.disabled = !!status.starting;

  for (const p of ['twitch', 'kick']) {
    const d = dests[p];
    const card = $(`#dest-${p}`);
    card.dataset.s = d ? d.state : (S && S[p].enabled ? 'idle' : 'off');
    $(`#state-${p}`).textContent = d ? (d.state === 'retrying' ? d.message : STATE_WORDS[d.state] || '') : '';
    $(`#on-${p}`).disabled = !!status.live;
  }
  $$('#quality button').forEach((b) => { b.disabled = !!status.live; });
  if (status.encoder) $('#encoder').textContent = 'Using: ' + status.encoder;
  // Phosphor Loop can't draw as fast as the stream asks: say so plainly and suggest the fix
  const slow = state === 'live' && status.wantFps > 30 && status.pictureFps && status.pictureFps < status.wantFps * 0.85;
  showNotice(status.notice || (slow ? { kind: 'warn', text: `This computer is drawing about ${status.pictureFps} frames a second, short of the ${status.wantFps} that Best sends, so the stream repeats frames. Better (30 frames a second) will look smoother and sharper.` } : null));
}

function showNotice(n) {
  const el = $('#notice');
  el.hidden = !n || !n.text;
  if (n && n.text) { el.textContent = n.text; el.className = 'notice ' + (n.kind || 'info'); }
}

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

for (const p of ['twitch', 'kick']) {
  $(`#on-${p}`).addEventListener('change', (e) => save({ [p]: { enabled: e.target.checked } }));
}
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
$$('#quality button').forEach((b) => b.addEventListener('click', () => { if (!status.live) save({ quality: b.dataset.q }); }));
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
  S = st.settings; status = st.status; quality = st.quality;
  renderSettings(); renderStatus();
})();
