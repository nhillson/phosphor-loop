'use strict';
// The control panel: address bar, Start here / End here, the grabbed list, the trimmer and the library.
// Everything that touches files, the web page or ffmpeg happens in main (main.js); this side shows and asks.
const api = window.clips;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const MIN_LEN = 0.2;

const S = {
  tab: 'get', web: {}, video: {}, jobs: [], lib: null, vision: {}, settings: { keepSound: false, maxHeight: 1080 },
  ed: null, libCat: 'all', libQuery: '', modals: 0, opened: new Set(),
};

/* ---------- small helpers ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function fmt(t) {
  if (!Number.isFinite(t)) return '—';
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  if (m >= 60) return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
  return m + ':' + s.toFixed(1).padStart(4, '0');
}
function fmtLong(t) {
  if (!Number.isFinite(t) || t <= 0) return '';
  t = Math.round(t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
const fmtLen = (t) => (t < 60 ? t.toFixed(1) + ' s' : fmtLong(t));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const catName = (id) => { const c = S.lib && S.lib.cats.find((x) => x.id === id); return c ? c.n : ''; };

function toast(text, kind = '', ms = 4500) {
  if (!text) return;
  const t = el('div', 'toast ' + kind, text);
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}
async function call(channel, ...args) {
  const r = await api.call(channel, ...args);
  if (r && r.ok === false && r.message) toast(r.message, 'bad');
  return r;
}

/* ---------- where the web page is drawn ---------- */
let webOn = null, lastBounds = '';
const webShouldShow = () => S.tab === 'get' && !S.ed && S.modals === 0;
function syncWeb() {
  const on = webShouldShow();
  if (on !== webOn) { webOn = on; api.call('web:show', on); }
  sendBounds();
}
function sendBounds() {
  const r = $('#webhost').getBoundingClientRect();
  const key = [r.x, r.y, r.width, r.height].map(Math.round).join(',');
  if (key === lastBounds) return;
  lastBounds = key;
  api.call('web:bounds', { x: r.x, y: r.y, width: r.width, height: r.height });
}
new ResizeObserver(sendBounds).observe($('#webhost'));
window.addEventListener('resize', sendBounds);

/* ---------- tabs ---------- */
function setTab(tab) {
  S.tab = tab;
  $('#viewGet').hidden = tab !== 'get';
  $('#viewLib').hidden = tab !== 'lib';
  $('#tabGet').setAttribute('aria-selected', String(tab === 'get'));
  $('#tabLib').setAttribute('aria-selected', String(tab === 'lib'));
  if (tab !== 'lib') stopHoverVideos();
  if (tab === 'lib') renderLibrary();
  if (S.ed) { const v = $('#edVideo'); if (tab !== 'get') v.pause(); }
  syncWeb();
}
$$('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

/* ---------- address bar ---------- */
$('#addrForm').addEventListener('submit', (e) => { e.preventDefault(); call('web:go', $('#addr').value); $('#addr').blur(); });
$('#navBack').addEventListener('click', () => api.call('web:nav', 'back'));
$('#navFwd').addEventListener('click', () => api.call('web:nav', 'forward'));
$('#navReload').addEventListener('click', () => api.call('web:nav', S.web.loading ? 'stop' : 'reload'));
$('#navHome').addEventListener('click', () => api.call('web:nav', 'home'));
$('#addr').addEventListener('focus', () => $('#addr').select());
function renderWeb() {
  const w = S.web;
  if (document.activeElement !== $('#addr')) $('#addr').value = w.url || '';
  $('#navBack').disabled = !w.back;
  $('#navFwd').disabled = !w.forward;
  $('#loading').hidden = !w.loading;
  renderVideo();
}

/* ---------- the video on the page, Start here / End here ---------- */
function renderVideo() {
  const v = S.video || {};
  const now = $('#now');
  now.classList.toggle('playing', !!v.has && !v.paused);
  now.classList.toggle('paused', !!v.has && v.paused);
  let text;
  if (S.web.home) text = 'Pick a site on the start page, search above, or paste a link below.';
  else if (!v.has) text = 'No video on this page yet. Start one playing.';
  else text = (v.paused ? 'Video paused at ' : 'Video playing: ') + '<b>' + fmt(v.t) + '</b>' + (v.d ? ' of ' + fmtLong(v.d) : '');
  $('#nowText').innerHTML = text;
  const hasStart = v.start != null, hasEnd = v.end != null;
  $('#markStartVal').textContent = hasStart ? fmt(v.start) : '—';
  $('#markEndVal').textContent = hasEnd ? fmt(v.end) : '—';
  $('#markStart').classList.toggle('set', hasStart);
  $('#markEnd').classList.toggle('set', hasEnd);
  $('#markStart').disabled = !v.has;
  $('#markEnd').disabled = !v.has;
  $('#markClear').hidden = !hasStart && !hasEnd;
  $('#grabPage').textContent = hasStart ? (hasEnd ? 'Grab the marked part' : 'Grab from the start mark') : 'Grab this video';
  $('#grabPage').disabled = !!S.web.home;
}
async function doMark(which) {
  const r = await call('web:mark', which);
  if (r && r.ok && r.message) toast(r.message);
}
$('#markStart').addEventListener('click', () => doMark('start'));
$('#markEnd').addEventListener('click', () => doMark('end'));
$('#markClear').addEventListener('click', () => doMark('clear'));
$('#grabPage').addEventListener('click', async () => {
  const r = await call('web:grab');
  if (r && r.ok) toast('Grabbing it. It opens for trimming when it’s ready.');
});
$('#linkForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await call('grab:url', $('#link').value);
  if (r && r.ok) { $('#link').value = ''; toast('Grabbing it. It opens for trimming when it’s ready.'); }
});

/* ---------- files and links dropped on the window ---------- */
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const files = [...(e.dataTransfer.files || [])];
  let started = 0;
  for (const f of files) {
    const p = api.pathOf(f);
    if (p) { const r = await call('grab:file', p); if (r && r.ok) started++; }
  }
  if (!files.length) {
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split(/\r?\n/).find((l) => /^https?:/i.test(l.trim()));
    if (url) { const r = await call('grab:url', url.trim()); if (r && r.ok) started++; }
  }
  if (started) { setTab('get'); toast(started > 1 ? `Opening ${started} files…` : 'Opening it…'); }
});

/* ---------- the grabbed list ---------- */
let jobsKey = '';
function renderJobs() {
  const key = JSON.stringify(S.jobs.map((j) => [j.id, j.status, j.text, Math.round(j.pct), j.title, j.strip[0], j.saved]));
  if (key !== jobsKey) {
    jobsKey = key;
    const ul = $('#jobs');
    ul.textContent = '';
    for (const j of S.jobs) ul.appendChild(jobItem(j));
    $('#jobsEmpty').hidden = S.jobs.length > 0;
    const waiting = S.jobs.filter((j) => j.status === 'ready').length;
    $('#jobsSub').textContent = waiting ? waiting + ' ready to save' : '';
  }
  // The trimmer follows its job
  if (S.ed) {
    const j = S.jobs.find((x) => x.id === S.ed.id);
    if (!j) { closeEditor(); return; }
    renderEdStatus(j);
    if (j.suggestion !== S.ed.suggestion || j.looking !== S.ed.looking) applySuggestion(j);
  }
  // A video that has just become ready opens by itself if nothing else is open
  if (!S.ed) {
    const next = S.jobs.find((j) => j.status === 'ready' && !S.opened.has(j.id));
    if (next && S.modals === 0) openEditor(next.id);
  }
}
function jobItem(j) {
  const li = el('li', 'job ' + j.status);
  const pic = el('div', 'pic');
  if (j.strip[0]) pic.style.backgroundImage = `url("${j.strip[Math.min(j.strip.length - 1, 3)]}")`;
  else if (j.status === 'working' || j.status === 'saving') pic.appendChild(el('div', 'spin'));
  li.appendChild(pic);
  const body = el('div');
  body.appendChild(el('div', 't', j.title));
  body.lastChild.title = j.url || j.title;
  body.appendChild(el('div', 's', j.text));
  if (j.status === 'working' || j.status === 'saving') {
    const bar = el('div', 'bar' + (j.pct < 0 ? ' unknown' : ''));
    const i = el('i');
    i.style.width = (j.pct < 0 ? 35 : clamp(j.pct, 2, 100)) + '%';
    bar.appendChild(i);
    body.appendChild(bar);
  }
  const acts = el('div', 'acts');
  const btn = (text, cls, fn) => { const b = el('button', cls, text); b.addEventListener('click', fn); acts.appendChild(b); };
  if (j.status === 'ready' && !(S.ed && S.ed.id === j.id)) btn('Trim & save', 'go', () => openEditor(j.id));
  if (j.status === 'working') btn('Stop', '', () => api.call('job:stop', j.id));
  if (j.status === 'error') { btn('Try again', 'go', () => api.call('job:retry', j.id)); btn('Remove', '', () => api.call('job:dismiss', j.id)); }
  if (j.status === 'ready' && !(S.ed && S.ed.id === j.id)) btn('Throw away', '', () => api.call('job:stop', j.id));
  if (j.status === 'done') btn('OK', '', () => api.call('job:dismiss', j.id));
  if (acts.children.length) body.appendChild(acts);
  li.appendChild(body);
  return li;
}

/* ---------- the trimmer ---------- */
const vid = $('#edVideo');
function openEditor(id) {
  const j = S.jobs.find((x) => x.id === id);
  if (!j || !j.video) return;
  S.opened.add(id);
  if (S.tab !== 'get') setTab('get');
  const d = j.video.d;
  const [a, b] = j.range || [0, d];
  S.ed = { id, d, fps: j.video.fps || 30, start: clamp(a, 0, d), end: clamp(b, 0, d), cat: '', catTouched: false, suggestion: undefined, looking: undefined, sugKey: '' };
  if (S.ed.end - S.ed.start < MIN_LEN) S.ed.end = Math.min(d, S.ed.start + Math.max(MIN_LEN, d));
  $('#edTitle').textContent = j.title;
  $('#edTitle').title = j.url || j.title;
  const meta = [j.video.w + '×' + j.video.h, fmtLong(d) || fmtLen(d)];
  if (j.info.site) meta.push(j.info.site);
  $('#edMeta').textContent = meta.join(' · ');
  const strip = $('#strip');
  strip.textContent = '';
  for (const src of j.strip) { const img = el('img'); img.src = src; img.alt = ''; strip.appendChild(img); }
  $('#edName').value = (j.title || 'clip').slice(0, 80);
  $('#keepSound').checked = !!S.settings.keepSound && j.video.sound;
  $('#keepSound').disabled = !j.video.sound;
  $('#keepSound').parentElement.title = j.video.sound ? '' : 'This video has no sound';
  $('#maxH').value = String(S.settings.maxHeight || 1080);
  showEdProgress(false);
  vid.src = j.video.url;
  vid.currentTime = S.ed.start;
  $('#editor').hidden = false;
  syncWeb();
  layoutTimeline();
  renderEdCats();
  applySuggestion(j);
  renderEdStatus(j);
  renderJobs();
  vid.play().catch(() => {});
}
function closeEditor() {
  vid.pause();
  vid.removeAttribute('src');
  vid.load();
  S.ed = null;
  $('#editor').hidden = true;
  jobsKey = '';
  renderJobs();
  syncWeb();
}
$('#edClose').addEventListener('click', closeEditor);
$('#edDiscard').addEventListener('click', () => { if (!S.ed) return; api.call('job:stop', S.ed.id); closeEditor(); });

const pct = (t) => (100 * t) / (S.ed.d || 1) + '%';
function layoutTimeline() {
  if (!S.ed) return;
  const { start, end, d } = S.ed;
  $('#hStart').style.left = pct(start);
  $('#hEnd').style.left = pct(end);
  $('#sel').style.left = pct(start);
  $('#sel').style.width = (100 * (end - start)) / d + '%';
  $('#shadeL').style.width = pct(start);
  $('#shadeR').style.width = (100 * (d - end)) / d + '%';
  $('#tStart').textContent = fmt(start);
  $('#tEnd').textContent = fmt(end);
  $('#tLen').textContent = fmtLen(end - start);
}
function setStart(t, show = true) { S.ed.start = clamp(t, 0, S.ed.end - MIN_LEN); layoutTimeline(); if (show) seek(S.ed.start); }
function setEnd(t, show = true) { S.ed.end = clamp(t, S.ed.start + MIN_LEN, S.ed.d); layoutTimeline(); if (show) seek(Math.max(S.ed.start, S.ed.end - 0.05)); }
function seek(t) { vid.currentTime = clamp(t, 0, S.ed.d); movePlayhead(); }
function movePlayhead() { if (S.ed) $('#ph').style.left = pct(vid.currentTime || 0); }
function playChosen() {
  if (!S.ed) return;
  if (vid.currentTime < S.ed.start - 0.05 || vid.currentTime >= S.ed.end - 0.05) vid.currentTime = S.ed.start;
  vid.play().catch(() => {});
}
function togglePlay() { if (vid.paused) playChosen(); else vid.pause(); }
// Keep the chosen part looping, frame by frame
function onVideoFrame() {
  if (S.ed) {
    movePlayhead();
    if ($('#loopSel').checked && !vid.paused && vid.currentTime >= S.ed.end - 0.5 / (S.ed.fps || 30)) vid.currentTime = S.ed.start;
  }
  vid.requestVideoFrameCallback(onVideoFrame);
}
vid.requestVideoFrameCallback(onVideoFrame);
vid.addEventListener('timeupdate', movePlayhead);
vid.addEventListener('ended', () => { if (S.ed && $('#loopSel').checked) playChosen(); });
const setPlayIcon = () => {
  $('#ppIcon').innerHTML = vid.paused ? '<path d="M8 5v14l11-7z"/>' : '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
  $('#edPlay').hidden = !vid.paused;
};
vid.addEventListener('play', setPlayIcon);
vid.addEventListener('pause', setPlayIcon);
vid.addEventListener('click', togglePlay);
$('#edPlay').addEventListener('click', playChosen);
$('#edPP').addEventListener('click', togglePlay);

const tl = $('#tl');
function timeAt(ev) { const r = tl.getBoundingClientRect(); return clamp((ev.clientX - r.left) / r.width, 0, 1) * S.ed.d; }
function drag(ev, what) {
  if (!S.ed || ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  const target = ev.currentTarget;
  target.setPointerCapture(ev.pointerId);
  const playing = !vid.paused;
  vid.pause();
  const t0 = timeAt(ev), s0 = S.ed.start, e0 = S.ed.end;
  const move = (e) => {
    const t = timeAt(e);
    if (what === 'start') setStart(t);
    else if (what === 'end') setEnd(t);
    else if (what === 'move') {
      const len = e0 - s0;
      const ns = clamp(s0 + (t - t0), 0, S.ed.d - len);
      S.ed.start = ns; S.ed.end = ns + len;
      layoutTimeline();
      seek(ns);
    } else seek(t);
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    if (what === 'seek') { if (playing) vid.play().catch(() => {}); return; }
    if (what === 'end') vid.currentTime = Math.max(S.ed.start, S.ed.end - 1.5);
    vid.play().catch(() => {});
    rangeChanged();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  if (what === 'seek') move(ev);
}
$('#hStart').addEventListener('pointerdown', (e) => drag(e, 'start'));
$('#hEnd').addEventListener('pointerdown', (e) => drag(e, 'end'));
$('#sel').addEventListener('pointerdown', (e) => drag(e, 'move'));
tl.addEventListener('pointerdown', (e) => drag(e, 'seek'));

$$('[data-nudge]').forEach((b) => b.addEventListener('click', () => {
  if (!S.ed) return;
  const [which, by] = b.dataset.nudge.split(',');
  if (which === 'start') setStart(S.ed.start + +by); else setEnd(S.ed.end + +by);
  rangeChanged();
}));
$('#setStart').addEventListener('click', () => { if (S.ed) { setStart(vid.currentTime, false); rangeChanged(); } });
$('#setEnd').addEventListener('click', () => { if (S.ed) { setEnd(vid.currentTime, false); rangeChanged(); } });

// After trimming, the suggestion looks again at the part that's left (unless a category was already picked)
let lookTimer = null;
function rangeChanged() {
  if (!S.ed || S.ed.catTouched) return;
  clearTimeout(lookTimer);
  const { id, start, end } = S.ed;
  lookTimer = setTimeout(() => { if (S.ed && S.ed.id === id && !S.ed.catTouched) api.call('job:suggest', { id, start, end }); }, 900);
}

document.addEventListener('keydown', (e) => {
  if (!S.ed || S.tab !== 'get' || S.modals) return;
  if (e.target.closest('input, select, textarea')) { if (e.key === 'Enter' && e.target.id === 'edName') save(false); return; }
  const k = e.key.toLowerCase();
  const step = (dir) => { vid.pause(); seek(vid.currentTime + dir * (e.shiftKey ? 1 : 1 / (S.ed.fps || 30))); };
  if (k === ' ') { togglePlay(); e.preventDefault(); }
  else if (k === 'i' || k === '[') { setStart(vid.currentTime, false); rangeChanged(); }
  else if (k === 'o' || k === ']') { setEnd(vid.currentTime, false); rangeChanged(); }
  else if (k === 'arrowleft') { step(-1); e.preventDefault(); }
  else if (k === 'arrowright') { step(1); e.preventDefault(); }
  else if (k === 'enter') save(false);
  else if (k === 'escape') closeEditor();
});

/* category chips in the trimmer */
function renderEdCats() {
  if (!S.ed || !S.lib) return;
  const box = $('#edCats');
  box.textContent = '';
  const sug = S.ed.suggestion && S.ed.suggestion.id;
  for (const c of S.lib.cats) {
    const b = el('button', 'chip' + (S.ed.cat === c.id ? ' on' : '') + (sug === c.id ? ' guess' : ''), c.n);
    b.type = 'button';
    b.dataset.cat = c.id;
    b.addEventListener('click', () => { S.ed.cat = c.id; S.ed.catTouched = true; renderEdCats(); updateSaveButtons(); });
    box.appendChild(b);
  }
  const add = el('button', 'chip add', '+ New');
  add.type = 'button';
  add.addEventListener('click', () => {
    add.textContent = '';
    const input = el('input');
    input.placeholder = 'Category name';
    input.maxLength = 40;
    add.appendChild(input);
    input.focus();
    const done = async (keep) => {
      const name = input.value.trim();
      input.remove();
      if (keep && name) {
        const r = await call('cat:add', name);
        if (r && r.ok && S.ed) { S.ed.cat = r.cat.id; S.ed.catTouched = true; }
      }
      renderEdCats();
      updateSaveButtons();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); e.stopPropagation(); });
    input.addEventListener('blur', () => done(true), { once: true });
  }, { once: true });
  box.appendChild(add);
}
function applySuggestion(j) {
  S.ed.suggestion = j.suggestion;
  S.ed.looking = j.looking;
  const s = j.suggestion;
  if (s && s.id && !S.ed.catTouched) S.ed.cat = s.id;
  const label = $('#suggest');
  label.classList.toggle('looking', !!j.looking && !(s && s.id));
  if (s && s.id) {
    const how = s.by === 'words' ? 'going by the title' : s.by === 'both' ? 'from the picture and the title' : 'from the picture';
    label.textContent = 'Looks like ' + catName(s.id) + ' (' + how + ')' + (j.looking ? ' … still looking' : '');
  } else label.textContent = j.looking ? 'Looking at the picture…' : 'Pick one';
  renderEdCats();
  updateSaveButtons();
}
function updateSaveButtons() {
  if (!S.ed) return;
  const can = !!S.ed.cat;
  $('#edSave').disabled = !can;
  $('#edSaveMore').disabled = !can;
  $('#edSave').textContent = can ? 'Save to ' + catName(S.ed.cat) : 'Pick a category';
}
function renderEdStatus(j) {
  if (j.status === 'saving') {
    showEdProgress(true);
    $('#edBar').style.width = clamp(j.pct, 2, 100) + '%';
    $('#edProgText').textContent = 'Saving… ' + Math.round(clamp(j.pct, 0, 100)) + '%';
  }
}
function showEdProgress(on) {
  $('#edProgress').hidden = !on;
  $('#edButtons').hidden = on;
}
async function save(another) {
  if (!S.ed) return;
  if (!S.ed.cat) { toast('Pick a category first.', 'bad'); return; }
  const id = S.ed.id;
  const o = {
    id, start: S.ed.start, end: S.ed.end, cat: S.ed.cat, name: $('#edName').value.trim(),
    keepSound: $('#keepSound').checked, maxHeight: +$('#maxH').value, another,
  };
  S.settings.keepSound = o.keepSound;
  S.settings.maxHeight = o.maxHeight;
  showEdProgress(true);
  $('#edBar').style.width = '2%';
  $('#edProgText').textContent = 'Saving…';
  const r = await call('job:save', o);
  if (!S.ed || S.ed.id !== id) return;
  showEdProgress(false);
  if (!r || !r.ok) return;
  toast(`Saved “${r.clip.n}” to ${r.cat}.`, 'ok');
  if (another) {
    // Ready for the next part: it starts where this one ended
    const len = S.ed.end - S.ed.start;
    if (S.ed.end < S.ed.d - MIN_LEN) { S.ed.start = S.ed.end; S.ed.end = Math.min(S.ed.d, S.ed.start + len); }
    layoutTimeline();
    seek(S.ed.start);
    vid.play().catch(() => {});
    const base = $('#edName').value.replace(/\s+\d+$/, '');
    const n = (+(/\s(\d+)$/.exec($('#edName').value) || [0, 1])[1]) + 1;
    $('#edName').value = base + ' ' + n;
  } else closeEditor();
}
$('#edSave').addEventListener('click', () => save(false));
$('#edSaveMore').addEventListener('click', () => save(true));
$('#keepSound').addEventListener('change', () => api.call('settings:set', { keepSound: $('#keepSound').checked }));
$('#maxH').addEventListener('change', () => api.call('settings:set', { maxHeight: +$('#maxH').value }));

/* ---------- the library ---------- */
function renderLibrary() {
  const lib = S.lib;
  if (!lib) return;
  $('#libCount').textContent = lib.clips.length;
  $('#libDir').textContent = lib.dir;
  $('#libDir').title = lib.dir;
  if (S.libCat !== 'all' && !lib.cats.some((c) => c.id === S.libCat)) S.libCat = 'all';
  const chips = $('#libCats');
  chips.textContent = '';
  const chip = (id, name, n) => {
    const b = el('button', 'chip' + (S.libCat === id ? ' on' : ''), name);
    b.appendChild(el('span', 'n', String(n)));
    b.addEventListener('click', () => { S.libCat = id; renderLibrary(); });
    chips.appendChild(b);
  };
  chip('all', 'All', lib.clips.length);
  for (const c of lib.cats) chip(c.id, c.n, c.count);
  if (S.tab !== 'lib') return;
  stopHoverVideos();
  const q = S.libQuery.trim().toLowerCase();
  const shown = lib.clips.filter((c) => (S.libCat === 'all' || c.c === S.libCat) && (!q || (c.n + ' ' + (c.page || '') + ' ' + (c.by || '')).toLowerCase().includes(q)));
  const grid = $('#grid');
  grid.textContent = '';
  for (const c of shown) grid.appendChild(clipCard(c));
  $('#libEmpty').hidden = shown.length > 0;
}
function clipCard(c) {
  const card = el('div', 'clip');
  const pic = el('div', 'pic');
  if (c.thumb) pic.style.backgroundImage = `url("${c.thumb}")`;
  if (S.libCat === 'all') pic.appendChild(el('span', 'tag', catName(c.c)));
  pic.appendChild(el('span', 'dur', fmtLen(c.d || 0)));
  card.appendChild(pic);
  const meta = el('div', 'meta');
  meta.appendChild(el('b', '', c.n));
  meta.appendChild(el('span', '', [c.w && c.h ? c.w + '×' + c.h : '', c.sound ? 'with sound' : ''].filter(Boolean).join(' · ')));
  card.appendChild(meta);
  card.addEventListener('mouseenter', () => {
    if (pic.querySelector('video')) return;
    const v = el('video');
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.src = c.url;
    pic.insertBefore(v, pic.firstChild);
  });
  card.addEventListener('mouseleave', () => { const v = pic.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } });
  card.addEventListener('click', () => openClip(c.id));
  return card;
}
function stopHoverVideos() { $$('#grid video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); }); }
$('#libSearch').addEventListener('input', () => { S.libQuery = $('#libSearch').value; renderLibrary(); });
$('#libOpen').addEventListener('click', () => api.call('lib:open'));
$('#libChange').addEventListener('click', () => call('lib:choose'));
$('#libRescan').addEventListener('click', async () => { const r = await call('lib:rescan'); if (r && r.ok) toast('Library is up to date.', 'ok', 2500); });

/* modals: the web page is hidden while one is open, so it can't cover it */
function openModal(id) { $(id).hidden = false; S.modals++; syncWeb(); }
function closeModal(id) { if ($(id).hidden) return; $(id).hidden = true; S.modals = Math.max(0, S.modals - 1); syncWeb(); }
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S.modals) return;
  for (const id of ['#askModal', '#catModal', '#clipModal']) if (!$(id).hidden) { if (id === '#askModal') $('#askNo').click(); else if (id === '#clipModal') closeClip(); else closeModal(id); break; }
});
function ask(text, { input = null, yes = 'OK', no = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    $('#askText').textContent = text;
    const inp = $('#askInput');
    inp.hidden = input == null;
    inp.value = input || '';
    $('#askYes').textContent = yes;
    $('#askNo').textContent = no;
    $('#askYes').className = 'btn ' + (danger ? 'danger' : 'primary');
    openModal('#askModal');
    if (input != null) setTimeout(() => inp.focus(), 0);
    const finish = (v) => { closeModal('#askModal'); $('#askYes').onclick = null; $('#askNo').onclick = null; inp.onkeydown = null; resolve(v); };
    $('#askYes').onclick = () => finish(input == null ? true : inp.value.trim());
    $('#askNo').onclick = () => finish(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') $('#askYes').click(); };
  });
}

/* one clip */
let clipOpen = null;
function openClip(id) {
  const c = S.lib.clips.find((x) => x.id === id);
  if (!c) return;
  clipOpen = id;
  stopHoverVideos();
  const v = $('#cmVideo');
  v.src = c.url;
  $('#cmName').value = c.n;
  const sel = $('#cmCat');
  sel.textContent = '';
  for (const cat of S.lib.cats) { const o = el('option', '', cat.n); o.value = cat.id; sel.appendChild(o); }
  sel.value = c.c;
  const facts = $('#cmFacts');
  facts.textContent = '';
  const fact = (k, v) => { if (!v) return; facts.appendChild(el('dt', '', k)); facts.appendChild(el('dd', '', v)); };
  fact('Length', fmtLen(c.d || 0));
  fact('Size', c.w && c.h ? c.w + ' × ' + c.h + (c.fps ? ', ' + Math.round(c.fps) + ' frames a second' : '') : '');
  fact('Sound', c.sound ? 'Yes' : 'No');
  fact('From', [c.page, c.site].filter(Boolean).join(' · '));
  fact('By', c.by);
  fact('Licence', c.lic);
  if (c.part) fact('Part', fmt(c.part[0]) + ' to ' + fmt(c.part[1]) + ' of the original');
  fact('Added', c.added ? new Date(c.added).toLocaleString() : '');
  fact('File', c.f);
  $('#cmSource').hidden = !/^https?:/.test(c.src || '');
  openModal('#clipModal');
}
function closeClip() { const v = $('#cmVideo'); v.pause(); v.removeAttribute('src'); v.load(); clipOpen = null; closeModal('#clipModal'); }
$('#cmClose').addEventListener('click', closeClip);
$('#clipModal').addEventListener('click', (e) => { if (e.target.id === 'clipModal') closeClip(); });
async function renameClip() {
  const c = S.lib.clips.find((x) => x.id === clipOpen);
  const n = $('#cmName').value.trim();
  if (!c || !n || n === c.n) return;
  const r = await call('lib:update', { id: c.id, n });
  if (r && r.ok) $('#cmName').value = r.clip.n;
}
$('#cmName').addEventListener('change', renameClip);
$('#cmName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#cmName').blur(); });
$('#cmCat').addEventListener('change', async () => {
  const r = await call('lib:update', { id: clipOpen, c: $('#cmCat').value });
  if (r && r.ok) toast('Moved to ' + catName(r.clip.c) + '.', 'ok', 2500);
});
$('#cmShow').addEventListener('click', () => api.call('lib:show', clipOpen));
$('#cmSource').addEventListener('click', () => {
  const c = S.lib.clips.find((x) => x.id === clipOpen);
  if (!c) return;
  closeClip();
  setTab('get');
  api.call('web:open', c.src);
});
$('#cmDelete').addEventListener('click', async () => {
  const c = S.lib.clips.find((x) => x.id === clipOpen);
  if (!c) return;
  const ok = await ask(`Delete “${c.n}”? It goes to the Recycle Bin.`, { yes: 'Delete', danger: true });
  if (!ok) return;
  closeClip();
  await call('lib:remove', c.id);
});

/* categories */
$('#catNew').addEventListener('click', async () => {
  const name = await ask('Name for the new category:', { input: '', yes: 'Add' });
  if (name) { const r = await call('cat:add', name); if (r && r.ok) { S.libCat = r.cat.id; renderLibrary(); } }
});
$('#catEdit').addEventListener('click', () => { renderCatList(); openModal('#catModal'); });
$('#catClose').addEventListener('click', () => closeModal('#catModal'));
$('#catModal').addEventListener('click', (e) => { if (e.target.id === 'catModal') closeModal('#catModal'); });
function renderCatList() {
  const ul = $('#catList');
  ul.textContent = '';
  for (const c of S.lib.cats) {
    const li = el('li');
    const inp = el('input');
    inp.value = c.n;
    inp.maxLength = 40;
    inp.disabled = c.id === 'other';
    inp.addEventListener('change', async () => { const n = inp.value.trim(); if (!n || n === c.n) { inp.value = c.n; return; } const r = await call('cat:rename', { id: c.id, n }); if (!r || !r.ok) inp.value = c.n; });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    li.appendChild(inp);
    li.appendChild(el('span', 'n', c.count === 1 ? '1 clip' : c.count + ' clips'));
    const del = el('button', 'ib');
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';
    del.title = c.id === 'other' ? 'Other always stays' : 'Delete this category';
    del.disabled = c.id === 'other';
    del.addEventListener('click', async () => {
      const ok = await ask(c.count ? `Delete ${c.n}? Its ${c.count === 1 ? 'clip moves' : c.count + ' clips move'} to Other.` : `Delete ${c.n}?`, { yes: 'Delete', danger: true });
      if (ok) await call('cat:remove', c.id);
    });
    li.appendChild(del);
    ul.appendChild(li);
  }
}
$('#catAddForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const n = $('#catAddName').value.trim();
  if (!n) return;
  const r = await call('cat:add', n);
  if (r && r.ok) $('#catAddName').value = '';
});

/* ---------- the picture recogniser's status ---------- */
function renderVision() {
  const v = S.vision || {};
  const box = $('#vision');
  box.classList.toggle('ready', !!v.ready);
  box.classList.toggle('off', !!v.error && !v.ready);
  if (v.ready) { box.hidden = false; $('#visionText').textContent = 'Category suggestions on'; box.title = 'The app looks at each clip and suggests a category.'; }
  else if (v.error) { box.hidden = false; $('#visionText').textContent = 'Suggestions from titles only'; box.title = 'The picture recogniser couldn’t start: ' + v.error; }
  else if (v.text) { box.hidden = false; $('#visionText').textContent = v.text + (v.pct >= 0 ? ' ' + Math.round(v.pct) + '%' : ''); box.title = 'A one-time download of about 150 MB, so the app can suggest categories by looking at clips.'; }
  else box.hidden = true;
}

/* ---------- what main tells us ---------- */
api.on('web', (w) => { S.web = w || {}; renderWeb(); });
api.on('video', (v) => { S.video = v || {}; renderVideo(); });
api.on('jobs', (list) => { S.jobs = list || []; renderJobs(); });
api.on('library', (lib) => {
  S.lib = lib;
  renderLibrary();
  if (!$('#catModal').hidden) renderCatList();
  if (S.ed) renderEdCats();
  updateSaveButtons();
});
api.on('vision', (v) => { S.vision = v || {}; renderVision(); });
api.on('toast', (t) => toast(t.text, t.kind));

(async () => {
  const st = await api.call('panel:ready');
  S.settings = st.settings || S.settings;
  S.lib = st.library;
  S.web = st.web || {};
  S.video = st.video || {};
  S.vision = st.vision || {};
  S.jobs = st.jobs || [];
  renderWeb();
  renderLibrary();
  renderVision();
  renderJobs();
  syncWeb();
  window.__clipsReady = true;
})();
