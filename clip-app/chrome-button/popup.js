'use strict';
// The button's menu: watch the video's clock, press Start here and End here, then Grab, so only the marked part
// downloads into Phosphor Clips (straight to the trimmer). The marks are kept for the tab and page (the menu closes
// when you click on the page; open it again and they're still there). "Open this page in Phosphor Clips instead"
// does what the button used to: the page opens there with its video picking up where you were.
const $ = (id) => document.getElementById(id);
const PAD = 3;   // seconds either side that Phosphor Clips also downloads, so the trimmer has room
const q = new URLSearchParams(location.search);
let tab = null, video = null, marks = { page: '', start: null, end: null }, busy = false;

const isWeb = (u) => /^https?:\/\//i.test(u || '');
function pageKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of ['t', 'start', 'time_continue', 'si', 'feature']) u.searchParams.delete(k);
    return u.href;
  } catch (_) { return url || ''; }
}
function fmt(t, tenths = true) {
  if (!Number.isFinite(t)) return '—';
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t - h * 3600 - m * 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + ss;
}
const key = () => 'marks:' + tab.id;
const saveMarks = () => chrome.storage.session.set({ [key()]: marks }).catch(() => {});

// The page's main video, in whichever frame (the same choice the background and Phosphor Clips make)
function probeVideo() {
  let best = null, top = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const score = (w * h + 1) * (v.paused ? 1 : 4) * (v.readyState > 0 ? 1 : 0.05);
    if (score > top) { top = score; best = v; }
  }
  if (!best) return null;
  const s = best.currentSrc || best.src || '';
  return { t: best.currentTime || 0, d: isFinite(best.duration) ? best.duration : 0, paused: best.paused, score: top, src: /^https?:/.test(s) ? s : '' };
}
async function readVideo() {
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: probeVideo });
    let best = null;
    for (const r of res || []) if (r && r.result && (!best || r.result.score > best.score)) best = r.result;
    return best;
  } catch (_) { return null; }
}

function render() {
  const has = !!video;
  const now = $('now');
  now.className = 'now' + (has ? (video.paused ? ' paused' : ' playing') : '');
  $('nowText').innerHTML = has
    ? (video.paused ? 'Video paused at ' : 'Video playing: ') + `<b>${fmt(video.t)}</b>` + (video.d ? ` of ${fmt(video.d, false)}` : '')
    : 'No video on this page yet. Start it playing.';
  const s = marks.start, e = marks.end;
  $('startVal').textContent = s != null ? fmt(s) : '—';
  $('endVal').textContent = e != null ? fmt(e) : '—';
  $('start').classList.toggle('set', s != null);
  $('end').classList.toggle('set', e != null);
  $('start').disabled = $('end').disabled = !has || busy;
  $('clear').hidden = s == null && e == null;
  const grab = $('grab');
  grab.disabled = !has || busy;
  grab.textContent = s != null ? (e != null ? 'Grab the marked part' : 'Grab from the start mark') : 'Grab this video';
  if (!$('note').classList.contains('bad')) {
    let html = '';
    if (s != null) {
      const a = Math.max(0, s - PAD);
      const b = e != null ? e + PAD : s + 60 + PAD;
      const end = video && video.d ? Math.min(video.d, b) : b;
      html = `Only <b>${fmt(a, false)} to ${fmt(end, false)}</b> downloads (the part plus 3 s either side). Phosphor Clips opens it in the trimmer.`;
      if (e == null) html = `The minute after your start mark downloads (<b>${fmt(a, false)} to ${fmt(end, false)}</b>). Press <b>End here</b> to choose where it ends.`;
    } else if (has) html = 'While it plays, press <b>Start here</b> when the good part begins and <b>End here</b> when it ends. Unmarked, the whole video downloads.';
    $('note').innerHTML = html;
  }
  $('openPage').disabled = busy;
}
function say(text, bad) {
  const n = $('note');
  n.classList.toggle('bad', !!bad);
  n.textContent = text;
  if (bad) setTimeout(() => { n.classList.remove('bad'); render(); }, 3500);
}

async function tick() {
  const v = await readVideo();
  video = v;
  render();
}

function markStart() {
  if (!video) return;
  marks.start = video.t;
  if (marks.end != null && marks.end <= video.t) marks.end = null;
  saveMarks();
  render();
}
function markEnd() {
  if (!video) return;
  if (marks.start == null) { marks.start = 0; }
  if (video.t <= marks.start + 0.1) { say('The end has to come after the start.', true); return; }
  marks.end = video.t;
  saveMarks();
  render();
}
function clearMarks() { marks.start = null; marks.end = null; saveMarks(); render(); }

function finished(title, text) {
  $('main').hidden = true;
  $('done').hidden = false;
  $('doneTitle').textContent = title;
  $('doneText').textContent = text;
  setTimeout(() => window.close(), 1600);
}

async function grab() {
  if (!video || busy) return;
  busy = true;
  render();
  const m = marks.start != null ? { start: marks.start, end: marks.end } : null;
  const req = { kind: 'grab', url: tab.url, title: tab.title || '', d: video.d || 0, t: video.t, src: video.src || '', marks: m };
  const r = await chrome.runtime.sendMessage({ type: 'grab', tabId: tab.id, req }).catch((e) => ({ ok: false, message: e.message }));
  busy = false;
  if (r && r.ok) {
    marks = { page: marks.page, start: null, end: null };
    saveMarks();
    finished('Sent to Phosphor Clips', m ? 'It’s grabbing just the part you marked.' : 'It’s grabbing the video.');
  } else if (r && r.notRunning) {
    window.close();   // the background opened a page with a Start Phosphor Clips button (it carries this grab)
  } else {
    say((r && r.message) || 'That didn’t work.', true);
    render();
  }
}
async function openPage() {
  if (busy) return;
  busy = true;
  render();
  const r = await chrome.runtime.sendMessage({ type: 'page', tabId: tab.id }).catch(() => ({ ok: false }));
  busy = false;
  if (r && r.ok) finished('Opened in Phosphor Clips', 'The video picks up where you were.');
  else window.close();
}

(async () => {
  // The tab to work on: the one the menu was opened over (or ?tab=<id>, for the tests)
  if (q.get('tab')) tab = await chrome.tabs.get(+q.get('tab')).catch(() => null);
  else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isWeb(tab.url)) {
    $('nowText').textContent = 'Open a web page with a video first.';
    for (const id of ['start', 'end', 'grab', 'openPage']) $(id).disabled = true;
    $('note').textContent = 'Chrome’s own pages (like a new tab or settings) can’t be sent.';
    return;
  }
  const saved = (await chrome.storage.session.get(key()).catch(() => ({})))[key()];
  if (saved && saved.page === pageKey(tab.url)) marks = saved;
  else marks = { page: pageKey(tab.url), start: null, end: null };
  $('start').addEventListener('click', markStart);
  $('end').addEventListener('click', markEnd);
  $('clear').addEventListener('click', clearMarks);
  $('grab').addEventListener('click', grab);
  $('openPage').addEventListener('click', openPage);
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 's') markStart();
    else if (k === 'e') markEnd();
    else if (k === 'enter' && !$('grab').disabled) grab();
  });
  await tick();
  setInterval(tick, 250);
  // Whether Phosphor Clips is open (Grab still works when it isn't: it offers to start it)
  const st = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => ({}));
  $('app').classList.toggle('on', !!(st && st.running));
  $('appText').textContent = st && st.running ? 'Clips open' : 'Clips closed';
  $('app').title = st && st.running ? 'Phosphor Clips is running' : 'Phosphor Clips isn’t running. Grab offers to start it.';
})();
