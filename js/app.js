(() => {
'use strict';
const { FR, makeDrone } = window.PhosphorFractals;
const { VS, FS_COPY, FS_PROBE, FS_EYE, COMMON, FS_FEEDBACK, FS_COMPOSITE, FS_FINAL, FS_TIMEWARP, FS_DISPLAY, FS_CUBES, FS_HORIZON, FS_CAVERN, FS_BLACKHOLE, FS_AURORA, FS_MERCURY, FS_FRACTAL, FS_NEBULA, FS_CITY, FS_SPONGE, FS_BULB, FS_MANDELBOX, FS_SIERPINSKI, FS_JULIA, FS_KALEIDO } = window.PhosphorShaders;
const { clamp, rnd, pick, hsv, foldJS, stamp, randId, loadScript } = window.PhosphorHelpers;
const { addWebmDuration, standardMp4 } = window.PhosphorRecording;

/* ================= constants ================= */
// Standard sharpness: the loops are drawn 576 lines high, as Phosphor Loop always has been. Picture sharpness
// (under Screen) can draw more lines, up to the screen's own (see wantLines). Local streaming can request a
// fixed number of lines instead.
const SIM_H = 576;
// The stream app's capture mode: the size and speed it streams at. The app can switch it off ("Streaming?" Off),
// and then the page draws like an ordinary browser window, at the size Picture sharpness picks.
function capCfg() { const c = window.__phosphorCaptureConfig; return c && !c.off ? c : null; }
let simW = 768, simH = capCfg()?.renderHeight || SIM_H, simAspect = simW / simH;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ================= hints as hover tooltips ================= */
// The small grey descriptions under the controls are tucked away and shown as a tooltip when the mouse rests on the
// name of the control they describe (its label, not the fader itself), after a little over a second. Lines that
// report what's happening right now (what's pinned, what Check each look has judged, a loop that isn't on screen,
// a preset note...) stay on show. A description whose words change later (Pushed by's, say, which names the other
// loop) keeps its tooltip up to date.
const HINT_KEEP = ['feedNote', 'hiddenHint', 'vidLoopText', 'limSum', 'apCheckStat', 'apPinList', 'sharpNote', 'shapeNote',
  'sharedHint', 'adminMsg', 'presetEmpty', 'presetApNote', 'tasteSum', 'micTip', 'loopbackHint', 'tasteAdminNote', 'spotifySetup'];
// Where a description that isn't inside a control's own box goes
const HINT_TARGET = { loopsHint: '#h-mix', dropHint: '#in1Lbl' };
// The rows that open under an input (3D world, Text...) put their description on that input's button
const ROW_INPUT = { 'row-3d': 'world', 'row-fractal': 'fractal', 'row-spectro': 'spectro', 'row-text': 'text', 'row-picture': 'picture',
  'row-video': 'video', 'row-camera': 'camera', 'row-screen': 'screen', 'row-phone': 'phone', 'row-loop': 'loop' };
const TIP_DELAY = 1200;
// The name to hover for a control's box: its label, else the box's first label-like line, else the box itself
function tipLabel(box) {
  if (!box.matches('.ctl, .dev')) return box;
  if (box.id in ROW_INPUT) { const b = $(`#inputs [data-src="${ROW_INPUT[box.id]}"]`); if (b) return b; }
  return box.querySelector(':scope > .ctl-head label, :scope > .ctl-head .lbl, :scope > .lbl, :scope > label, :scope > .dev-status')
    || box.querySelector(':scope > .btn, :scope > .chips, :scope > .seg') || box;
}
function hintsToTips() {
  const tips = new Map();
  for (const h of $$('.panel .hint')) {
    if (HINT_KEEP.includes(h.id) || h.getAttribute('role') === 'status' || h.querySelector('button, a, input, select')) continue;
    let t = HINT_TARGET[h.id] ? $(HINT_TARGET[h.id]) : h.closest('.ctl, .dev');
    if (!t) {
      t = h.previousElementSibling;
      while (t && (t.classList.contains('hint') || t.hasAttribute('hidden') || t.getAttribute('role') === 'status')) t = t.previousElementSibling;
      t = t || h.closest('.group, section');
    }
    t = tipLabel(t);
    // A native tooltip on the same name joins the new one, so only one ever shows
    if (!tips.has(t)) { tips.set(t, { own: t.getAttribute('title') || '', hints: [] }); t.removeAttribute('title'); }
    tips.get(t).hints.push(h);
    h.classList.add('as-tip');
  }
  const write = (t) => {
    const T = tips.get(t);
    const words = T.hints.filter((h) => h.classList.contains('as-tip')).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const text = [T.own, ...words].filter(Boolean).join('\n\n');
    if (text) t.dataset.tip = text; else delete t.dataset.tip;
  };
  for (const t of tips.keys()) write(t);
  // Descriptions whose words change, or that are shown again, update their tooltip
  const mo = new MutationObserver((recs) => {
    const seen = new Set();
    for (const r of recs) { const h = r.target.nodeType === 1 ? r.target.closest('.hint') : r.target.parentElement && r.target.parentElement.closest('.hint'); if (h) seen.add(h); }
    for (const [t, T] of tips) if (T.hints.some((h) => seen.has(h))) write(t);
  });
  for (const T of tips.values()) for (const h of T.hints) mo.observe(h, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}
hintsToTips();
// The tooltip itself: one box, shown under (or over) the name the mouse rests on
const tipPop = document.createElement('div');
tipPop.className = 'tip-pop';
tipPop.setAttribute('role', 'tooltip');
tipPop.hidden = true;
document.body.appendChild(tipPop);
let tipFor = null, tipTimer = 0;
function tipHide() { clearTimeout(tipTimer); tipTimer = 0; tipFor = null; tipPop.hidden = true; }
function tipShow(el) {
  if (!document.contains(el) || !el.dataset.tip) return;
  tipPop.textContent = el.dataset.tip;
  tipPop.hidden = false;
  const r = el.getBoundingClientRect(), w = tipPop.offsetWidth, h = tipPop.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  tipPop.style.left = `${Math.round(Math.min(Math.max(8, r.left), innerWidth - w - 8))}px`;
  tipPop.style.top = `${Math.round(top)}px`;
}
document.addEventListener('pointerover', (e) => {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  const el = e.target.closest ? e.target.closest('[data-tip]') : null;
  if (el === tipFor) return;
  tipHide();
  if (!el) return;
  tipFor = el;
  tipTimer = setTimeout(() => tipShow(el), TIP_DELAY);
});
document.addEventListener('pointerout', (e) => { if (tipFor && !(e.relatedTarget && tipFor.contains(e.relatedTarget))) tipHide(); });
for (const type of ['pointerdown', 'wheel', 'keydown']) document.addEventListener(type, tipHide, { capture: true, passive: true });
document.addEventListener('scroll', tipHide, { capture: true, passive: true });

/* ================= scroll wheel on faders ================= */
// Holding Shift and rolling the mouse wheel over any fader moves it: one notch is 2 on a 0 to 100 fader. Without
// Shift the wheel scrolls the controls as usual. It works as if the fader had been dragged, so everything that
// listens to the fader follows.
let wheelAcc = 0, wheelEl = null;
document.addEventListener('wheel', (e) => {
  const el = e.target;
  if (!e.shiftKey || !(el instanceof HTMLInputElement) || el.type !== 'range' || el.disabled) return;
  e.preventDefault();
  if (el !== wheelEl) { wheelEl = el; wheelAcc = 0; }
  // A mouse notch is about 100 pixels (or 3 lines); a trackpad sends many small amounts, which add up to notches
  // With Shift held, Windows and some browsers turn the wheel sideways, so whichever way it rolled counts
  const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  const d = e.deltaMode === 1 ? raw * 33 : e.deltaMode === 2 ? raw * 300 : raw;
  wheelAcc += d;
  const notches = Math.trunc(wheelAcc / 100) || (Math.abs(d) >= 50 ? Math.sign(d) : 0);
  if (!notches) return;
  wheelAcc = Math.abs(d) >= 50 ? 0 : wheelAcc - notches * 100;
  const min = +el.min || 0, max = el.max === '' ? 100 : +el.max, step = el.step === 'any' ? (max - min) / 100 : +el.step || 1;
  const per = Math.max(step, Math.round((max - min) / 50 / step) * step);
  const v = Math.min(max, Math.max(min, +el.value - notches * per));
  if (v === +el.value) return;
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, { passive: false });
// Inside a Claude artifact the camera, screen sharing and network links are refused, so those inputs hide there.
const inArtifact = !!(window.claude && typeof window.claude.use === 'function');
// The Android app (android/ folder) opens this page with a helper called PhosphorApp. It adds what a phone
// browser can't do: the picture on a plugged-in projector or TV, reacting to music playing on the phone,
// and saving photos and videos to the phone's gallery. In a normal browser APP is null and nothing changes.
const APP = (!inArtifact && window.PhosphorApp && typeof window.PhosphorApp.info === 'function') ? window.PhosphorApp : null;
let appInfo = {};
if (APP) {
  try { appInfo = JSON.parse(APP.info()) || {}; } catch (_) { appInfo = {}; }
  document.documentElement.classList.add('in-app');
}
function onApp(type, fn) {
  if (APP) window.addEventListener('phosphorapp', (e) => { if (e.detail && e.detail.type === type) fn(e.detail); });
}
let params;
try { params = new URLSearchParams(location.search); } catch (_) { params = new URLSearchParams(); }
// Keep a copy in the browser so Phosphor Loop opens without internet after one visit (see sw.js)
const swOK = !inArtifact && 'serviceWorker' in navigator &&
  (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
if (swOK) navigator.serviceWorker.register('sw.js').catch(() => {});

const SRC_ID = { wave: 0, shape: 1, bars: 2, sparks: 3, picture: 4, video: 5, camera: 6, screen: 7, phone: 8, none: 9, loop: 10, ink: 11, patchwork: 12, cubes: 13, horizon: 14, cavern: 15,
                 blackhole: 16, aurora: 17, mercury: 18, fractal: 19, nebula: 21, spectro: 22, city: 23, text: 24,
                 sponge: 25, mandelbulb: 26, mandelbox: 27, sierpinski: 28, julia3d: 29, kaleido: 30, ribbit: 31 };
const SRC_LABEL = { wave: 'Wave', shape: 'Shape', bars: 'Bars', sparks: 'Sparks', ink: 'Ink', patchwork: 'Patchwork', text: 'Text', cubes: 'Cubes', horizon: 'Horizon', cavern: 'Cavern', spectro: 'Spectrograph', city: 'City',
                    blackhole: 'Black hole', aurora: 'Aurora', mercury: 'Mercury', fractal: 'Fractal', nebula: 'Nebula', ribbit: 'Mount Ribbit',
                    sponge: 'Menger sponge', mandelbulb: 'Mandelbulb', mandelbox: 'Mandelbox', sierpinski: 'Sierpinski', julia3d: 'Julia', kaleido: 'Kaleidoscope', picture: 'Picture', video: 'Video', camera: 'Camera', screen: 'Screen', phone: 'Phone', none: 'Nothing', loop: 'Other loop' };
const LIVE = ['video', 'camera', 'screen', 'phone', 'loop'];   // inputs that can use Only movement
const DEVICE = ['camera', 'screen', 'phone'];

function loopDefaults() {
  return { subject: 'off', in1: 'wave', in2: 'none', blend: 50, size: 100, motion: false, soft: true, form: 3, specRound: false,
           zoom: 0, spin: 0, trails: 88, color: 10, poster: 0, posterIn: false, mirrorFinal: false, warpFinal: false, splitFinal: false, chromaFinal: false, warp: 0, flow: 0, melt: 0, push: 0, dye: 0, split: 0, mirror: 0, mirrorFx: 'melt', mirrorSpin: false, blur: 0, edge: 0, shiftX: 0, shiftY: 0, gain: 1,
           grow: 0, growSize: 1, time: 0, timeShape: 0, cam: 'glide',
           lookup: 0, chase: 0, breathe: 0, chroma: 0, restless: 0, julia: 0, crystal: 0 };
}
// Posterize: how many steps each color is snapped to, from 16 just past Off down to 2 at the top of the slider
const posterSteps = (v) => 16 * Math.pow(2 / 16, clamp(v, 0, 100) / 100);
// The sliders under Effects › Feeds on itself
const SELF = ['lookup', 'chase', 'breathe', 'chroma', 'restless', 'julia', 'crystal'];
const LOOP_SMOOTH = ['zoom', 'spin', 'trails', 'color', 'poster', 'warp', 'flow', 'melt', 'push', 'dye', 'split', 'grow', 'time', 'blur', 'shiftX', 'shiftY', 'gain', 'blend', 'size', ...SELF];
const LOOP_SLIDERS = ['zoom', 'spin', 'trails', 'color', 'poster', 'warp', 'blend', 'size', 'flow', 'melt', 'push', 'dye', 'split', 'grow', 'time', ...SELF];
// Up to four loops. A and B are always there; C, then D, are added under Loops › How many loops.
const KEYS = ['A', 'B', 'C', 'D'];
const LOOP_NUM = { A: 0, B: 1, C: 2, D: 3 };
// How far apart the loops' own clocks, colors and camera routes start, so no two loops move in step
const LOOP_OFF = { A: 0, B: 1, C: 0.62, D: 1.38 };
let loopCount = 2;
const loopOn = (k) => LOOP_NUM[k] < loopCount;
const activeKeys = () => KEYS.slice(0, loopCount);
// Each loop has one other loop it can take as an input, be pushed or dyed by, and be fed from: A and B pair up,
// and so do C and D. With three loops, C pairs with A.
function otherLoop(k) {
  if (k === 'A') return 'B';
  if (k === 'B') return 'A';
  if (k === 'C') return loopCount >= 4 ? 'D' : 'A';
  return 'C';
}
// The feed slider that pours into loop k (from its other loop). xab is Feed A into B, so it pours into B.
const FEED_INTO = { A: 'xba', B: 'xab', C: 'xc', D: 'xd' };
const FEED_TO = { xba: 'A', xab: 'B', xc: 'C', xd: 'D' };
const SHOW = { A: 'showA', B: 'showB', C: 'showC', D: 'showD' };
const MIX_SLIDERS = ['showA', 'showB', 'showC', 'showD', 'xab', 'xba', 'xc', 'xd'];
// Autopilot pins and limits what used to be one fader between A and B ("view"), so the A and B faders share that pin
const pinKeyOf = (p) => (p === 'showA' || p === 'showB' ? 'view' : p);
// What loop B holds when a look only uses loop A, so sliding over to B always shows something.
const B_PARTNER = { in1: 'shape', form: 5, zoom: -22, spin: -16, trails: 90, color: 24, warp: 8, mirror: 4, edge: 1, blur: 0.1 };
// What loops C and D start with when they're switched on
const C_START = { in1: 'bars', size: 50, zoom: 28, spin: 40, trails: 88, color: 16, warp: 18, mirror: 2, blur: 0.1 };
const D_START = { in1: 'sparks', zoom: -30, spin: -24, trails: 90, color: 20, warp: 12, mirror: 6, edge: 1, blur: 0.15 };

// Looks Autopilot can start from and vary (the first one opens the page)
const STARTERS = [
  { name: 'Tunnel', A: { in1: 'shape', form: 3, zoom: 45, spin: 14, trails: 86, color: 22, blur: -0.12 } },
  { name: 'Bloom', A: { in1: 'wave', form: 3, zoom: 18, trails: 90, color: 34, warp: 10, mirror: 6, blur: 0.2 } },
  { name: 'Vortex', A: { in1: 'bars', size: 50, zoom: 28, spin: 60, trails: 88, color: 14, warp: 18, blur: 0.1 } },
  { name: 'Lattice', A: { in1: 'shape', form: 2, zoom: -30, spin: 9, trails: 90, color: 18, mirror: 4, edge: 1 } },
  { name: 'Embers', A: { in1: 'sparks', zoom: 55, spin: -22, trails: 84, color: 9, warp: 28, blur: 0.15, shift: [0, 0.0025] } },
  { name: 'Calm', A: { in1: 'wave', size: 50, form: 2, zoom: 7, spin: 4, trails: 95, color: 5, warp: 14, mirror: 2, blur: 0.35 } },
  { name: 'Twins',
    A: { in1: 'shape', form: 3, zoom: 35, spin: 20, trails: 88, color: 12 },
    B: { in1: 'wave', form: 3, zoom: -25, spin: -18, trails: 90, color: 26, mirror: 4, edge: 1, blur: 0.1 },
    xab: 40, xba: 40, view: 50 },
  { name: 'Weave',
    A: { in1: 'bars', in2: 'wave', blend: 45, zoom: 20, spin: 30, trails: 90, color: 10, mirror: 2 },
    B: { in1: 'sparks', zoom: 50, spin: -40, trails: 86, color: 18, warp: 30 },
    xab: 70, xba: 45, view: 35 },
  { name: 'Ink', A: { in1: 'ink', size: 70, zoom: 0, spin: 0, trails: 100, color: 3, flow: 75, blur: 0.03 } },
  { name: 'Patchwork', A: { in1: 'patchwork', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Cubes', A: { in1: 'cubes', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Horizon', A: { in1: 'horizon', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Cavern', A: { in1: 'cavern', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Black hole', A: { in1: 'blackhole', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Aurora', A: { in1: 'aurora', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Mercury', A: { in1: 'mercury', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Fractal', A: { in1: 'fractal', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Nebula', A: { in1: 'nebula', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'City', A: { in1: 'city', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Mount Ribbit', A: { in1: 'ribbit', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Sponge', A: { in1: 'sponge', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
  { name: 'Coral', A: { in1: 'wave', form: 3, zoom: 14, trails: 92, color: 24, warp: 6, mirror: 6, blur: 0.1, grow: 60, growSize: 1 } },
  { name: 'Ribbons', A: { in1: 'bars', size: 50, zoom: 28, spin: 60, trails: 88, color: 14, warp: 18, blur: 0.1, time: 85, timeShape: 2 } }
];

/* ================= state ================= */
// Crystal's ten pieces start spread over the screen
function crystalStart() {
  const a = new Float32Array(20);
  for (let i = 0; i < 10; i++) { a[i * 2] = ((i % 5) / 4 - 0.5) * 1.1; a[i * 2 + 1] = i < 5 ? 0.2 : -0.2; }
  return a;
}
function mkLoop() {
  const d = loopDefaults();
  return { tgt: { ...d }, cur: { ...d }, base: { ...d }, rt: null, front: 0, tw: null,
           probe: null, chaseAt: [0, 0], chaseGoal: [0, 0], cells: crystalStart(), breath: { z: 0, s: 1 } };
}
const loops = { A: mkLoop(), B: mkLoop(), C: mkLoop(), D: mkLoop() };
// Mirror transitions: a new mirror (from its buttons, Autopilot, Surprise or a recipe) glides in over MIRROR_SECS
// in the loop's Transition style (Cut switches at once), and with Spin on the pattern turns once round as it goes.
// L.mx is the change under way: the mirror it's leaving, the one it's going to, and how far along it is (1 done).
// A preset and Neutral cut straight to their mirror (mirrorCut).
const MIRROR_SECS = 3;
const MIRROR_FX = { cut: 0, melt: 1, iris: 2, ripple: 3 };
function mirrorCut(k) { const m = loops[k].tgt.mirror; loops[k].mx = { from: m, to: m, e: 1 }; }
function mirrorStep(k, dt) {
  const t = loops[k].tgt, m = loops[k].mx || (loops[k].mx = { from: t.mirror, to: t.mirror, e: 1 });
  if (t.mirror !== m.to) {
    // Partway through a change: going back reverses it from where it is, anything else carries on from the
    // mirror that's showing most
    if (m.e < 1 && t.mirror === m.from) { m.from = m.to; m.e = 1 - m.e; }
    else { m.from = m.e < 0.5 ? m.from : m.to; m.e = 0; }
    m.to = t.mirror;
  }
  if (m.from === m.to || t.mirrorFx === 'cut') m.e = 1;
  if (m.e < 1) m.e = Math.min(1, m.e + dt / MIRROR_SECS);
}
// The shader's view of loop k's mirror change (see mirrorFold in js/shaders.js)
// Loop k's mirror for a program: the loop's own (fbProg) or its final pass (finalProg); on is false where the
// mirror isn't (Mirror set to the other one of Final Pass and Within Loops)
function mirrorUniforms(prog, k, on) {
  const t = loops[k].tgt, m = loops[k].mx || { from: t.mirror, e: 1 };
  if (!on) { set1f(prog, 'uMirror', 0); set1f(prog, 'uMirrorT', 1); return; }
  const e = m.e * m.e * (3 - 2 * m.e);
  // Iris can't grow sides out of no mirror at all, so to and from Off it melts
  let style = MIRROR_FX[t.mirrorFx] ?? 1;
  if (style === 2 && (m.from === 0 || t.mirror === 0)) style = 1;
  set1f(prog, 'uMirror', t.mirror);
  set1f(prog, 'uMirrorFrom', m.from);
  set1f(prog, 'uMirrorT', m.e >= 1 ? 1 : e);
  set1f(prog, 'uMirrorStyle', style);
  set1f(prog, 'uMirrorTurn', t.mirrorSpin && m.e < 1 ? 6.2831853 * e : 0);
}
// Whether loop k is mirrored at all just now, counting a change of mirror still gliding in from or out to Off
const mirrorAny = (k) => { const t = loops[k].tgt, m = loops[k].mx; return t.mirror > 0 || !!(m && m.e < 1 && m.from > 0); };
const mixDefaults = { showA: 100, showB: 0, showC: 100, showD: 100, xab: 0, xba: 0, xc: 0, xd: 0 };
// "view" is the old single fader between loops A and B (0 A only, 50 both, 100 B only). Autopilot, taste profiles
// and old presets still think in it, so it reads and writes the A and B Show faders: setting view 25 shows A fully
// and B at half, and the Show faders read back as the nearest view.
function viewOf(a, b) {
  a = clamp(+a || 0, 0, 100); b = clamp(+b || 0, 0, 100);
  if (a <= 0 && b <= 0) return 0;
  return a >= b ? 50 * b / a : 100 - 50 * a / b;
}
function withView(o) {
  Object.defineProperty(o, 'view', {
    enumerable: false, configurable: true,
    get() { return viewOf(this.showA, this.showB); },
    set(v) { const [a, b] = weights(clamp(+v || 0, 0, 100)); this.showA = a * 100; this.showB = b * 100; },
  });
  return o;
}
const mix = { tgt: withView({ ...mixDefaults }), cur: withView({ ...mixDefaults }), base: { ...mixDefaults } };
// How strongly loop k is on screen (0 to 1), from these Show faders (mix.tgt or mix.cur)
const wOf = (m, k) => (loopOn(k) ? clamp(m[SHOW[k]], 0, 100) / 100 : 0);
// Which look is on screen: goes up by one whenever a new look comes on screen (one Autopilot brings in, or a whole
// new look on a loop that's showing), but not when Autopilot tries out its next look out of sight, nudges a slider
// or builds a 3D world up. A rating stands for the look on screen until this changes, and the rating buttons stay lit.
let lookOnScreen = 0;
let edit = 'A';
// Mount Ribbit's walking keys held down, a jump asked for, and Walk by itself (see ribKey)
const rib = { held: new Set(), jump: false, auto: lsGet('phosphor-ribbit-walk') !== '0' };
let activePresetId = null;
let frozen = false;
let staticAmt = 0;

/* ================= DOM ================= */
const canvas = $('#screen');
const stage = $('#stage');
const bezel = $('#bezel');
// Sizes set by hand (see "sizing the picture and the controls by hand"): the controls' width (side), the picture
// column's width with Spread out controls on (mon), and the picture's own width and height (cw, ch), in CSS pixels
const LAYOUT_KEY = 'phosphor-layout-v1';
const layout = (() => { try { const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } })();
const screenWrap = $('#screenWrap');
const osd = $('#osd');
const tip = $('#tip');
const toastEl = $('#toast');
const msg = $('#msg');

/* ================= WebGL ================= */
const gl = canvas.getContext('webgl2', {
  antialias: false, alpha: false, depth: false, stencil: false,
  premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'
});
function fail(text) { msg.textContent = text; msg.hidden = false; tip.hidden = true; }
if (!gl) {
  fail('This screen needs WebGL 2, and your browser has it turned off or doesn’t support it. Try a current version of Chrome, Edge, Firefox or Safari.');
  return;
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    console.error(log);
    throw new Error(log);
  }
  return s;
}
function program(fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); throw new Error(gl.getProgramInfoLog(p)); }
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

let fbProg, compProg, dispProg, finalProg;
try {
  fbProg = program(FS_FEEDBACK);
  compProg = program(FS_COMPOSITE);
  dispProg = program(FS_DISPLAY);
  finalProg = program(FS_FINAL);
} catch (err) {
  fail('The screen couldn’t start on this graphics card. Try another browser, or update your graphics drivers.');
  return;
}
// The 3D worlds: what the picker calls each, how fast it moves (in its own units a second: along the
// flight, or round the circle for Black hole and Mercury), after how far it repeats exactly, where loop B
// starts in it, and for soft ones, how finely it is drawn (smaller is quicker, smoothed back up to size).
const SCENES = {
  cubes:     { fs: FS_CUBES,     label: 'Cubes',      speed: 0.9,   period: 2048,          offB: 1000 },
  horizon:   { fs: FS_HORIZON,   label: 'Horizon',    speed: 6.5,   period: 512,           offB: 256 },
  cavern:    { fs: FS_CAVERN,    label: 'Cavern',     speed: 1.6,   period: 80 * Math.PI,  offB: 40 },
  blackhole: { fs: FS_BLACKHOLE, label: 'Black hole', speed: 0.055, period: 2 * Math.PI,   offB: Math.PI },
  aurora:    { fs: FS_AURORA,    label: 'Aurora',     speed: 2.5,   period: 55,            offB: 20 },
  mercury:   { fs: FS_MERCURY,   label: 'Mercury',    speed: 0.12,  period: 2 * Math.PI,   offB: 2 },
  fractal:   { fs: FS_FRACTAL,   label: 'Fractal',    speed: 0.09,  period: 2,             offB: 0.7 },
  nebula:    { fs: FS_NEBULA,    label: 'Nebula',     speed: 2.0,   period: 400,           offB: 150, res: 0.5 },
  // A calm drift, so the kick only nudges it along a little
  city:      { fs: FS_CITY,      label: 'City',       speed: 2.2,   period: 3072,          offB: 1536, kick: 0.35 },
  // Walking, not flying: drawn by its own renderer (js/ribbit.js) with a hiker for each loop; see drawExt
  ribbit:    { ext: window.PhosphorRibbit || null, label: 'Mount Ribbit', speed: 1, period: 1e9, offB: 0, kick: 0.5 },
  // The fractal flights (under their own Fractals button): no set path, a wandering camera for each loop
  // instead (see makeDrone). Their speed is the camera's pace; how close it may dive (near) suits each one's detail.
  sponge:     { fs: FS_SPONGE,     label: 'Menger sponge', group: 'fractal', speed: 1, period: 1e9, offB: 0, fly: { de: FR.sponge, lure: FR.spongeLure, near: 0.0025 } },
  mandelbulb: { fs: FS_BULB,       label: 'Mandelbulb',    group: 'fractal', speed: 1, period: 1e9, offB: 0, fly: { de: FR.bulb, near: 0.004 } },
  mandelbox:  { fs: FS_MANDELBOX,  label: 'Mandelbox',     group: 'fractal', speed: 1, period: 1e9, offB: 0, fly: { de: FR.box, near: 0.003 } },
  sierpinski: { fs: FS_SIERPINSKI, label: 'Sierpinski',    group: 'fractal', speed: 1, period: 1e9, offB: 0, fly: { de: FR.pyramid, near: 0.003 } },
  julia3d:    { fs: FS_JULIA,      label: 'Julia',         group: 'fractal', speed: 1, period: 1e9, offB: 0, fly: { de: FR.julia, near: 0.004 } },
  kaleido:    { fs: FS_KALEIDO,    label: 'Kaleidoscope',  group: 'fractal', speed: 1, period: 1e9, offB: 0, fly: { de: FR.kaleido, near: 0.008 } },
};
if (!SCENES.ribbit.ext) delete SCENES.ribbit;
// Which button a 3D input sits under: "3D world" or "Fractals"
const sceneGroup = (src) => (SCENES[src] ? SCENES[src].group || 'world' : null);
// Each loop's wandering camera in a fractal, made when that loop first flies there (and again after a break,
// so picking a fractal always starts with the camera sweeping in from outside)
function droneOf(sc, k) {
  const f = sc.fly;
  if (!f.drone) f.drone = {};
  let dr = f.drone[k];
  if (!dr || simT - dr.used > 3) {
    dr = f.drone[k] = makeDrone(f.de, LOOP_NUM[k] + 1, { start: 3.2, roam: 2.2, size: 1.2, far: 0.45, near: f.near, dive: 70, speed: 0.55,
                                                           phase0: LOOP_OFF[k] * 0.35, lure: f.lure });
  }
  dr.used = simT;
  return dr;
}
const HINT_3D = {
  cubes: 'A 3D flight through floating cubes towards a glowing light.',
  horizon: 'A 3D flight low over a wet valley floor towards a striped sunset, with glowing mountains on both sides. The mountains swell with the bass.',
  cavern: 'A 3D flight down a winding cave with coral-like walls, light pulsing along glowing veins and spores drifting past.',
  blackhole: 'Circling a black hole: its pull bends the light, so the glowing disk of gas round it shows over the top and underneath.',
  aurora: 'A slow glide over a frozen lake under curtains of northern lights, mirrored in the ice.',
  mercury: 'Circling drops of liquid metal that drift, merge and split, mirroring a neon-lit room. They swell with the bass.',
  fractal: 'A flight down a hall folded out of spheres, where bubbles grow on bubbles, smaller without end.',
  nebula: 'A flight through glowing clouds of gas and dark dust, lit by a nearby star.',
  city: 'A slow drift sideways along a wet street at night, past shops, lamps and cars, with the skyline behind. The windows and lamps glow brighter with the music.',
  ribbit: 'A hike on Mount Ribbit, a frog king the size of a mountain sitting on a lily pad above the clouds. Gravity pulls towards whatever the hiker stands on, so he walks up the belly, over the eyes, onto the crown and upside down under the pad. W A S D walk, Shift runs, J jumps. With Walk by itself on, he tours the 14 flags on his own, and carries on 10 seconds after you let go of the keys. He hurries along with the bass.',
  sponge: 'A cube with a cross-shaped hole through it, and the same hole through every smaller cube, without end. The camera threads the holes and tunnels.',
  mandelbulb: 'The Mandelbrot set worked out in 3D: a glowing coral-like bulb with buds on buds on buds.',
  mandelbox: 'Space folded inside a box over and over: a carved block full of arches, ribs and pits, with glowing seams.',
  sierpinski: 'A golden pyramid made of four smaller pyramids, each made of four more, all the way down.',
  julia3d: 'A slice of a 4D Julia set, the Mandelbrot set’s cousin: swirling rainbow tubes and ribbons.',
  kaleido: 'A shape mirrored and turned over and over into faceted crystal that catches every colour.',
};
// Compile expensive worlds only when selected. The opening 2D look needs none of them.
const parallelBuild = gl.getExtension('KHR_parallel_shader_compile');
for (const sc of Object.values(SCENES)) {
  sc.z = 0;
  sc.prog = null;
  sc.state = 'idle';
}
function buildScene(sc) {
  const shaders = [];
  let pr;
  try {
    pr = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, sc.fs]]) {
      const sh = gl.createShader(type);
      shaders.push(sh);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      gl.attachShader(pr, sh);
    }
    gl.linkProgram(pr);
    sc.building = pr;
    sc.state = 'building';
  } catch (_) {
    if (pr) gl.deleteProgram(pr);
    sc.state = 'failed';
  } finally {
    // Attached shaders remain alive until the linked program no longer needs them.
    shaders.forEach((sh) => gl.deleteShader(sh));
  }
}
function sceneReady(sc, wait) {
  if (sc.state === 'idle') buildScene(sc);
  if (sc.state !== 'building') return sc.state === 'ready';
  if (!wait && parallelBuild && !gl.getProgramParameter(sc.building, parallelBuild.COMPLETION_STATUS_KHR)) return false;
  const pr = sc.building;
  sc.building = null;
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(pr));
    gl.deleteProgram(pr);
    sc.state = 'failed';
    hideFailedWorlds();
    return false;
  }
  const u = {};
  const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(pr, i); u[info.name] = gl.getUniformLocation(pr, info.name); }
  sc.prog = { p: pr, u };
  sc.state = 'ready';
  return true;
}
const is3D = (src) => !!SCENES[src];
const worldOK = (name) => !!SCENES[name] && SCENES[name].state !== 'failed';
const worldsOK = () => Object.keys(SCENES).filter(worldOK);
// For Surprise and Autopilot: every 3D world and every fractal this graphics card can draw, each one its own
// input with the same chance of coming up as Wave, Shape or any other
const allScenes = () => worldsOK();

const U = (prog, name) => prog.u[name] || null;
function set1f(prog, name, v) { const l = U(prog, name); if (l) gl.uniform1f(l, v); }
function set2f(prog, name, a, b) { const l = U(prog, name); if (l) gl.uniform2f(l, a, b); }
function set3f(prog, name, a, b, c) { const l = U(prog, name); if (l) gl.uniform3f(l, a, b, c); }
function set4f(prog, name, a, b, c, d) { const l = U(prog, name); if (l) gl.uniform4f(l, a, b, c, d); }
function set1i(prog, name, v) { const l = U(prog, name); if (l) gl.uniform1i(l, v); }

// Texture units for the feedback pass never change, so set them once
const UNITS = ['uPrev', 'uOther', 'uPic', 'uVid0', 'uVid1', 'uCam0', 'uCam1', 'uScr0', 'uScr1', 'uPho0', 'uPho1', 'uOtherPrev', 'uScene1', 'uScene2', 'uSpec', 'uText'];
gl.useProgram(fbProg.p);
UNITS.forEach((name, i) => set1i(fbProg, name, i));
gl.useProgram(compProg.p);
set1i(compProg, 'uA', 0); set1i(compProg, 'uB', 1); set1i(compProg, 'uC', 2); set1i(compProg, 'uD', 3);
gl.useProgram(finalProg.p);
set1i(finalProg, 'uNow', 0); set1i(finalProg, 'uLast', 1);
gl.useProgram(dispProg.p);
set1i(dispProg, 'uTex', 0);
// Time warp gets its own program, so a graphics card that can't draw it only loses Time warp
let twProg = null;
try {
  twProg = program(FS_TIMEWARP);
  gl.useProgram(twProg.p);
  set1i(twProg, 'uNow', 0); set1i(twProg, 'uHist', 1);
} catch (_) { twProg = null; }
// Time warp keeps TW_RATE frames a second. Phones and small computers keep fewer, smaller ones.
const TW_RATE = 30;
const twLowMem = !!APP || (navigator.deviceMemory > 0 && navigator.deviceMemory <= 4);
const TW_LAYERS = twLowMem ? 36 : 48;
const TW_SCALE = twLowMem ? 0.5 : 0.75;
const TW_MAX_SEC = (TW_LAYERS - 1) / TW_RATE;   // how far back the slider's top reaches: 1.6 seconds (1.2 on phones)
const twSpan = (v) => TW_MAX_SEC * Math.pow(clamp(v, 0, 100) / 100, 1.3);

let useFloat = !!gl.getExtension('EXT_color_buffer_float');
function makeTarget(w = simW, h = simH) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (useFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  return { tex, fbo, ok };
}
// Loops C and D get their pictures only once they're first switched on
function makeAllTargets() {
  loops.A.rt = [makeTarget(), makeTarget()];
  loops.B.rt = [makeTarget(), makeTarget()];
  for (const k of ['C', 'D']) loops[k].rt = loops[k].rt || loopOn(k) ? [makeTarget(), makeTarget()] : null;
  return makeTarget();
}
let comp = makeAllTargets();
if (useFloat && ![...loops.A.rt, ...loops.B.rt, comp].every((t) => t.ok)) {
  useFloat = false;
  comp = makeAllTargets();
}
const allRT = () => KEYS.flatMap((k) => loops[k].rt || []);
function clearLoopTargets(k) {
  gl.clearColor(0, 0, 0, 1);
  for (const t of loops[k].rt || []) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  twForget(loops[k]);
}
function clearTargets() {
  gl.clearColor(0, 0, 0, 1);
  for (const t of [...allRT(), comp]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  for (const k of KEYS) twForget(loops[k]);
}
function ensureTargets(k) {
  if (loops[k].rt) return;
  loops[k].rt = [makeTarget(), makeTarget()];
  loops[k].front = 0;
  clearLoopTargets(k);
}
clearTargets();

function makeSourceTex() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
const texSize = new WeakMap();
function uploadTo(tex, src) {
  const w = src.videoWidth || src.naturalWidth || src.width || 0;
  const h = src.videoHeight || src.naturalHeight || src.height || 0;
  const prev = texSize.get(tex);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  // A new frame of the same size is copied into the existing texture, which is much cheaper
  if (prev && prev[0] === w && prev[1] === h) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
  else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); texSize.set(tex, [w, h]); }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

/* ================= sources ================= */
// A live source keeps two textures so "Only movement" can compare this frame with the one before.
class LiveSource {
  constructor(flip) {
    this.tex = [makeSourceTex(), makeSourceTex()];
    this.idx = 0; this.frames = 0; this.video = null; this.stream = null;
    this.aspect = 16 / 9; this.flip = flip; this.fresh = false; this.rvfc = false; this.lastTime = -1;
    this.cutter = null; this.sub = {};   // Subject silhouette: a pair of textures for each look a loop wants
  }
  attach(video, stream) {
    this.detach();
    this.video = video; this.stream = stream || null;
    this.frames = 0; this.lastTime = -1; this.fresh = true;
    for (const s of Object.values(this.sub)) s.frames = 0;
    this.rvfc = 'requestVideoFrameCallback' in video;
    if (this.rvfc) {
      const cb = () => { if (this.video !== video) return; this.fresh = true; video.requestVideoFrameCallback(cb); };
      video.requestVideoFrameCallback(cb);
    }
  }
  detach() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) { try { this.video.pause(); } catch (_) {} if (this.stream) this.video.srcObject = null; }
    this.video = null; this.stream = null; this.frames = 0;
  }
  get on() { return !!this.video; }
  update(modes) {
    const v = this.video;
    if (this.hold || !v || v.readyState < 2 || !v.videoWidth) return;
    const fresh = this.rvfc ? this.fresh : v.currentTime !== this.lastTime;
    if (!fresh) return;
    this.fresh = false;
    this.lastTime = v.currentTime;
    this.idx = 1 - this.idx;
    try { uploadTo(this.tex[this.idx], v); this.frames++; } catch (_) {}
    this.aspect = v.videoWidth / v.videoHeight;
    if (!modes || !modes.size) return;
    this.cutter ||= new PhosphorSubject.Cutter();
    if (!this.cutter.segment(v)) return;
    for (const mode of modes) {
      const s = this.sub[mode] ||= { tex: [makeSourceTex(), makeSourceTex()], frames: 0 };
      try { uploadTo(s.tex[this.idx], this.cutter.render(mode, v)); s.frames++; } catch (_) {}
    }
  }
  get cur() { return this.tex[this.idx]; }
  get prev() { return this.tex[1 - this.idx]; }
  // The textures a loop with this Subject silhouette look reads: the plain picture until the first outlines are in
  texFor(mode) {
    const s = this.sub[mode];
    return s && s.frames >= 2 ? { cur: s.tex[this.idx], prev: s.tex[1 - this.idx] } : this;
  }
}
const vid = new LiveSource(false);
const cam = new LiveSource(true);
const scr = new LiveSource(false);
const pho = new LiveSource(false);
const LIVE_SRC = { video: vid, camera: cam, screen: scr, phone: pho };

function mkVideo() {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.autoplay = true;
  return v;
}

/* picture */
const picTex = makeSourceTex();
let picAspect = 4 / 3;
function makeTestCard() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 480;
  const g = c.getContext('2d');
  const bw = 640 / 7;
  const top = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  const mid = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
  top.forEach((col, i) => { g.fillStyle = col; g.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, 320); });
  mid.forEach((col, i) => { g.fillStyle = col; g.fillRect(Math.floor(i * bw), 320, Math.ceil(bw) + 1, 40); });
  const bot = [['#00214c', 1.25], ['#ffffff', 1.25], ['#32006a', 1.25], ['#131313', 1.25],
               ['#090909', 1 / 3], ['#131313', 1 / 3], ['#1d1d1d', 1 / 3], ['#131313', 1]];
  let x = 0;
  for (const [col, w] of bot) { g.fillStyle = col; g.fillRect(Math.floor(x), 360, Math.ceil(w * bw) + 1, 120); x += w * bw; }
  g.strokeStyle = 'rgba(255,255,255,.92)';
  g.lineWidth = 4;
  g.beginPath(); g.arc(320, 240, 170, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(320, 40); g.lineTo(320, 440); g.moveTo(90, 240); g.lineTo(550, 240); g.stroke();
  g.fillStyle = '#000'; g.fillRect(196, 216, 248, 48);
  g.fillStyle = '#fff'; g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('PHOSPHOR LOOP', 320, 241);
  return c;
}
const testCard = makeTestCard();
uploadTo(picTex, testCard);

/* text */
// The Text input: the words typed under Text, drawn white with a soft glow into a picture of their own, which
// the feedback pass tints with slowly turning colors (seedText). The words stay in this browser, and presets
// that use Text keep them too.
const TEXT_KEY = 'phosphor-text-v1';
const TEXT_DEFAULT = 'PHOSPHOR LOOP';
const TEXT_FONTS = {
  bold: (px) => `900 ${px}px "Arial Black", "Helvetica Neue", Arial, sans-serif`,
  outline: (px) => `900 ${px}px "Arial Black", "Helvetica Neue", Arial, sans-serif`,
  serif: (px) => `italic 700 ${px}px Georgia, "Times New Roman", serif`,
  mono: (px) => `700 ${px}px "Courier New", Courier, monospace`,
};
const TEXT_STYLE_NAME = { bold: 'BOLD', outline: 'OUTLINE', serif: 'CLASSIC', mono: 'TYPEWRITER' };
const txt = { str: TEXT_DEFAULT, style: 'bold' };
try {
  const t = JSON.parse(localStorage.getItem(TEXT_KEY) || 'null');
  if (t && typeof t.str === 'string') txt.str = t.str.slice(0, 60);
  if (t && t.style in TEXT_FONTS) txt.style = t.style;
} catch (_) {}
function saveText() { try { localStorage.setItem(TEXT_KEY, JSON.stringify(txt)); } catch (_) {} }
const textTex = makeSourceTex();
const textCanvas = document.createElement('canvas');
textCanvas.width = 1536; textCanvas.height = 768;
const textAspect = textCanvas.width / textCanvas.height;
// The words split over one to three lines, whichever lets them be biggest. Each way of splitting is
// tried and the widest line of each decides how big the letters can be.
function textLayout(g, words) {
  const W = textCanvas.width * 0.9, H = textCanvas.height * 0.8, LINE = 1.12;
  const width = (ws) => g.measureText(ws.join(' ')).width;
  let best = null;
  const consider = (lines) => {
    const wMax = Math.max(1, ...lines.map(width));
    const px = Math.min(100 * W / wMax, H / (lines.length * LINE));
    // More lines only when that makes the letters clearly bigger
    if (!best || px > best.px * 1.2) best = { px, lines: lines.map((l) => l.join(' ')) };
  };
  const n = words.length;
  consider([words]);
  for (let i = 1; i < n; i++) consider([words.slice(0, i), words.slice(i)]);
  if (n <= 24) for (let i = 1; i < n; i++) for (let j = i + 1; j < n; j++) consider([words.slice(0, i), words.slice(i, j), words.slice(j)]);
  return best;
}
function drawText() {
  const W = textCanvas.width, H = textCanvas.height, g = textCanvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.shadowBlur = 0;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const words = txt.str.trim().split(/\s+/).filter(Boolean);
  if (words.length) {
    const font = TEXT_FONTS[txt.style] || TEXT_FONTS.bold;
    g.font = font(100);
    const { px, lines } = textLayout(g, words);
    const size = Math.max(8, Math.floor(px));
    g.font = font(size);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lineH = size * 1.12, top = H / 2 - (lines.length - 1) * lineH / 2;
    const outline = txt.style === 'outline';
    g.lineWidth = Math.max(2, size * 0.045);
    g.lineJoin = 'round';
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    // A soft glow first, then the crisp letters on top
    for (const glow of [true, false]) {
      g.shadowColor = 'rgba(255,255,255,.85)';
      g.shadowBlur = glow ? size * 0.22 : 0;
      lines.forEach((line, i) => {
        if (outline) g.strokeText(line, W / 2, top + i * lineH);
        else g.fillText(line, W / 2, top + i * lineH);
      });
    }
    g.shadowBlur = 0;
  }
  uploadTo(textTex, textCanvas);
  // Smaller copies too, so small words stay smooth instead of sparkling
  gl.bindTexture(gl.TEXTURE_2D, textTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
}
drawText();

/* ================= helpers ================= */
let toastTimer;
function toast(text, ms = 4500) {
  toastEl.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.textContent = ''; }, ms);
}
let osdTimer;
function showOSD(a, b) {
  osd.querySelector('.osd-a').textContent = a;
  osd.querySelector('.osd-b').textContent = b;
  osd.classList.add('on');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => osd.classList.remove('on'), 2200);
}
function burst() { if (!reduceMotion) staticAmt = 1; }
let tipGone = false;
function hideTip() {
  if (tipGone) return;
  tipGone = true;
  tip.classList.add('gone');
  setTimeout(() => { tip.hidden = true; }, 700);
}
setTimeout(hideTip, 25000);
function say(el, html, warn) {
  el.innerHTML = html;
  el.classList.toggle('warn', !!warn);
}

/* ================= UI: sliders ================= */
const sliderEls = {}, outputs = {};
[...LOOP_SLIDERS, ...MIX_SLIDERS].forEach((k) => {
  const el = $('#' + k);
  sliderEls[k] = el;
  outputs[k] = $('#' + k + 'Out');
  const isMix = MIX_SLIDERS.includes(k);
  el.addEventListener('input', () => {
    markHand(k);
    takeOver(k);
    (isMix ? mix.tgt : loops[edit].tgt)[k] = +el.value;
    showSlider(k);
    if (k in FEED_TO && +el.value > 0) showFedLoop(k);
    if (isMix || k === 'trails') syncVisibility();
  });
  el.addEventListener('dblclick', () => {
    markHand(k);
    takeOver(k);
    const v = (isMix ? mix.base : loops[edit].base)[k];
    (isMix ? mix.tgt : loops[edit].tgt)[k] = v;
    el.value = v;
    showSlider(k);
    syncVisibility();
  });
});
function sliderText(k, v) {
  v = Math.round(v);
  switch (k) {
    case 'zoom': return v > 0 ? `IN ${v}` : v < 0 ? `OUT ${-v}` : 'HOLD';
    case 'spin': return v > 0 ? `RIGHT ${v}` : v < 0 ? `LEFT ${-v}` : 'HOLD';
    case 'showA': case 'showB': case 'showC': case 'showD': return v === 0 ? 'HIDDEN' : String(v);
    case 'blend': return v === 50 ? 'EVEN' : v < 50 ? `MAIN ${100 - v}` : `2ND ${v}`;
    case 'color': case 'warp': case 'flow': case 'melt': case 'push': case 'dye': case 'split': case 'grow': case 'xab': case 'xba': case 'xc': case 'xd': case 'trails':
    case 'lookup': case 'chase': case 'breathe': case 'chroma': case 'restless': case 'julia': case 'crystal': return v === 0 ? 'OFF' : String(v);
    case 'poster': return v === 0 ? 'OFF' : `${Math.round(posterSteps(v))} STEPS`;
    // How far back the far edge reaches
    case 'time': return v === 0 ? 'OFF' : `${twSpan(v).toFixed(1)} SEC`;
    default: return String(v);
  }
}
function fillTrack(el) {
  const min = +el.min, max = +el.max, v = +el.value;
  const pct = (v - min) / (max - min) * 100;
  if (el.classList.contains('bipolar')) {
    el.style.setProperty('--a', Math.min(50, pct) + '%');
    el.style.setProperty('--b', Math.max(50, pct) + '%');
  } else {
    el.style.setProperty('--a', '0%');
    el.style.setProperty('--b', pct + '%');
  }
}
function showSlider(k) {
  const el = sliderEls[k];
  fillTrack(el);
  outputs[k].textContent = sliderText(k, +el.value);
}
// While Autopilot runs, the sliders it's changing show where the picture is right now, so they glide with each new
// look and rise and fall with a 3D world's build-up. A slider being dragged, or moved by hand since this look came
// in, shows where it was put.
const handMark = {};
let heldSlider = null;
const lookGen = () => KEYS.reduce((n, k) => n + (loops[k].gen || 0), 0);
function markHand(key) {
  if (!ap.on) return;
  if (MIX_SLIDERS.includes(key)) handMark['mix:' + key] = lookGen();
  else handMark[edit + ':' + key] = loops[edit].gen;
}
function sliderShows(key, k) {
  const isMix = MIX_SLIDERS.includes(key);
  const t = isMix ? mix.tgt : loops[k].tgt, c = isMix ? mix.cur : loops[k].cur;
  if (!ap.on || !(isMix ? apOwnsMix(key) : apRuns(k)) || !Number.isFinite(c[key])) return t[key];
  if (isMix ? handMark['mix:' + key] === lookGen() : handMark[k + ':' + key] === loops[k].gen) return t[key];
  return c[key];
}
document.addEventListener('pointerdown', (e) => {
  const el = e.target;
  if (!el.matches || !el.matches('input[type="range"]')) return;
  const m = el.closest('.mirror');
  heldSlider = { key: m ? el.dataset.mid : el.id, k: m ? m.dataset.loop : edit };
}, true);
for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => { heldSlider = null; }, true);
// Every frame: sliders (and each loop's column) brought to what they show. When Autopilot stops, they go back to
// showing the settings themselves.
let apFollowing = false;
function followSliders() {
  // The sliders follow whatever is moving them by itself: Autopilot, or the sequencer while it plays
  if (!ap.on && !seq.running) { if (apFollowing) { apFollowing = false; syncUI(); } return; }
  apFollowing = true;
  const isHeld = (key, k) => heldSlider && heldSlider.key === key && (heldSlider.k === k || MIX_SLIDERS.includes(key));
  for (const key of [...LOOP_SLIDERS, ...MIX_SLIDERS]) {
    if (isHeld(key, edit)) continue;
    const el = sliderEls[key], v = String(Math.round(sliderShows(key, edit)));
    if (el.value !== v) { el.value = v; showSlider(key); }
  }
  if (!wideCols || mirroring) return;
  for (const k of activeKeys()) {
    const m = wideCols.mirrors[k];
    if (!m) continue;
    for (const key of [...LOOP_SLIDERS, ...MIX_SLIDERS]) {
      if (isHeld(key, k)) continue;
      const el = m.querySelector(`input[data-mid="${key}"]`);
      if (!el) continue;
      const v = String(Math.round(sliderShows(key, k)));
      if (el.value === v) continue;
      el.value = v;
      fillTrack(el);
      const out = m.querySelector(`[data-mid="${key}Out"]`);
      if (out) out.textContent = sliderText(key, +v);
    }
  }
}

/* ================= UI: inputs ================= */
const in2Sel = $('#in2');
function buildIn2() {
  in2Sel.innerHTML = '';
  const opts = [['none', 'No second input'], ['wave', 'Wave'], ['shape', 'Shape'], ['bars', 'Bars'], ['sparks', 'Sparks'], ['ink', 'Ink drops'], ['patchwork', 'Patchwork'], ['text', 'Text (your words)'], ['spectro', 'Spectrograph (sound)'], ...Object.keys(SCENES).map((k) => [k, `${SCENES[k].label} (${sceneGroup(k) === 'fractal' ? 'fractal' : '3D world'})`]),
                ['picture', 'Picture'], ['video', 'Video'], ['camera', 'Camera'], ['screen', 'Screen'], ['phone', 'Phone'], ['loop', 'The other loop']];
  for (const [v, label] of opts) {
    if ((inArtifact && (DEVICE.includes(v) || v === 'spectro')) || (APP && v === 'screen') || (is3D(v) && !worldOK(v))) continue;
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    in2Sel.appendChild(o);
  }
}
buildIn2();
if (inArtifact) $$('#inputs [data-device]').forEach((b) => { b.hidden = true; });
// Phones can't share their screen with a page, so the app leaves Screen out
if (APP) $$('#inputs [data-src="screen"]').forEach((b) => { b.hidden = true; });
// The 3D world and Fractals pickers: one button per world or fractal. Each changes whichever input of this
// loop is one of its own kind.
const lastWorld = { world: 'cubes', fractal: 'sponge' };
const PICKER = { world: '#worlds', fractal: '#fractals' };
for (const [name, sc] of Object.entries(SCENES)) {
  const b = document.createElement('button');
  const g = sceneGroup(name);
  b.type = 'button';
  b.dataset.world = name;
  b.setAttribute('aria-pressed', 'false');
  b.textContent = sc.label;
  b.addEventListener('click', () => {
    const t = loops[edit].tgt;
    chooseSource(sceneGroup(t.in2) === g && sceneGroup(t.in1) !== g ? 'in2' : 'in1', name);
  });
  $(PICKER[g]).appendChild(b);
}
// Mount Ribbit's Walk by itself switch (kept in this browser)
$('#ribbitAuto').addEventListener('click', () => { rib.auto = !rib.auto; lsSet('phosphor-ribbit-walk', rib.auto ? '1' : '0'); syncUI(); });
// Mount Ribbit builds its frog in the background a little after the page opens, so it is ready the moment it's
// picked (Autopilot's Check each look would otherwise see only sky while it builds)
if (SCENES.ribbit) setTimeout(() => { if (SCENES.ribbit.ext.state === 'idle') SCENES.ribbit.ext.build(); }, 5000);
// A world that fails its first compilation is removed from the pickers.
function hideFailedWorlds() {
  $$('#worlds button, #fractals button').forEach((b) => { b.hidden = !worldOK(b.dataset.world); });
  for (const g of ['world', 'fractal'])
    if (!worldsOK().some((n) => sceneGroup(n) === g)) $$(`#inputs [data-src="${g}"]`).forEach((b) => { b.hidden = true; });
}
// The other loop's button fills whatever room the last row of input buttons leaves
{
  const n = $$('#inputs button').filter((b) => !b.hidden && b.dataset.src !== 'loop').length;
  const left = 5 - (n % 5);
  $('#loopSrcBtn').style.gridColumn = left === 5 ? '1 / -1' : `span ${left}`;
}

$$('#inputs button').forEach((b) => b.addEventListener('click', () => {
  const t = loops[edit].tgt;
  const g = b.dataset.src;
  chooseSource('in1', g === 'world' || g === 'fractal' ? (sceneGroup(t.in1) === g ? t.in1 : lastWorld[g]) : g);
}));
in2Sel.addEventListener('change', () => chooseSource('in2', in2Sel.value));
$$('#mirror button').forEach((b) => b.addEventListener('click', () => { takeOver('mirror'); loops[edit].tgt.mirror = +b.dataset.mirror; syncUI(); }));
$$('#mirrorFx button').forEach((b) => b.addEventListener('click', () => { loops[edit].tgt.mirrorFx = b.dataset.mfx; syncUI(); }));
$('#mirrorSpin').addEventListener('click', () => { const t = loops[edit].tgt; t.mirrorSpin = !t.mirrorSpin; syncUI(); });
$('#motion').addEventListener('click', () => { takeOver('in1'); const t = loops[edit].tgt; t.motion = !t.motion; syncUI(); });
$('#soft').addEventListener('click', () => { const t = loops[edit].tgt; t.soft = t.soft === false; syncUI(); });
// Subject silhouette: the person in a video, camera, screen or phone picture, found by MediaPipe (js/subject.js)
const SUBJECT_SRC = ['video', 'camera', 'screen', 'phone'];
const subjectOn = (t) => PhosphorSubject.MODES.includes(t.subject);
$$('#subject button').forEach((b) => b.addEventListener('click', () => {
  takeOver('in1'); loops[edit].tgt.subject = b.dataset.subject;
  if (subjectOn(loops[edit].tgt)) PhosphorSubject.load();
  syncUI();
}));
function subjectModes(src) {
  const modes = new Set();
  for (const k of activeKeys()) { const t = loops[k].tgt; if ((t.in1 === src || t.in2 === src) && subjectOn(t)) modes.add(t.subject); }
  return modes;
}
window.__plSubject = { vid, loops };   // for tests/subject_check.py
function syncSubjectStatus() {
  const el = $('#subjectStatus'), t = loops[edit].tgt;
  const msg = subjectOn(t) ? PhosphorSubject.status() : 'Off: the picture comes in as it is.';
  if (el.textContent !== msg) el.textContent = msg;
}
$$('#specShape button').forEach((b) => b.addEventListener('click', () => {
  takeOver('in1');
  loops[edit].tgt.specRound = b.dataset.round === '1';
  syncUI();
  showOSD('SPECTROGRAPH', b.dataset.round === '1' ? 'ROUND' : 'SCROLLING');
}));
// Text: what you type shows straight away. The words aren't part of a loop's settings (both loops share them),
// so typing never pins anything or stops Autopilot.
const textIn = $('#textIn');
textIn.value = txt.str;
let textSaveT = null;
textIn.addEventListener('input', () => {
  txt.str = textIn.value.slice(0, 60);
  drawText();
  clearTimeout(textSaveT);
  textSaveT = setTimeout(saveText, 400);
});
textIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') textIn.blur(); });
function setTextStyle(style) {
  if (!(style in TEXT_FONTS)) return;
  txt.style = style;
  drawText();
  saveText();
  syncTextUI();
  showOSD('TEXT', TEXT_STYLE_NAME[style]);
}
$$('#textStyle button').forEach((b) => b.addEventListener('click', () => setTextStyle(b.dataset.tstyle)));
function syncTextUI() {
  if (document.activeElement !== textIn && textIn.value !== txt.str) textIn.value = txt.str;
  $$('#textStyle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tstyle === txt.style)));
}
const GROW_SIZE_NAME = ['FINE', 'MEDIUM', 'BIG'];
$$('#growSize button').forEach((b) => b.addEventListener('click', () => {
  takeOver('grow');
  const t = loops[edit].tgt;
  t.growSize = +b.dataset.gsize;
  // Picking a size with Grow off turns it on, so the button always shows something
  if (!(t.grow > 0)) t.grow = 60;
  syncUI();
  showOSD(`GROW ${edit}`, GROW_SIZE_NAME[t.growSize]);
}));
// Mirror, Warp, Split lines and Color chase work within the loop (feeding back every frame) or in the final pass
// (laid over the finished picture once; see finalPass)
$$('.where[data-where]').forEach((g) => g.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  const key = g.dataset.where;
  loops[edit].tgt[key] = b.dataset.final === '1';
  syncUI();
  showOSD(`${g.getAttribute('aria-label').replace(/^Where | works$/g, '').toUpperCase()} ${edit}`, b.dataset.final === '1' ? 'FINAL PASS' : 'WITHIN LOOPS');
})));
// Posterize works in the final pass (the loop keeps its smooth picture) or within the loop (it feeds on the stepped one)
$$('#posterWhere button').forEach((b) => b.addEventListener('click', () => {
  const t = loops[edit].tgt;
  t.posterIn = b.dataset.pin === '1';
  // Picking where with Posterize off turns it on, so the button always shows something
  if (!(t.poster > 0)) t.poster = 50;
  syncUI();
  showOSD(`POSTERIZE ${edit}`, t.posterIn ? 'WITHIN LOOPS' : 'FINAL PASS');
}));
// A fractal's camera always glides: it wanders and rolls through (Runner, Crawler and Mix it up were removed;
// looks saved with them glide too)
const TIME_SHAPE_NAME = ['TOP TO BOTTOM', 'SIDE TO SIDE', 'FROM THE MIDDLE'];
$$('#timeShape button').forEach((b) => b.addEventListener('click', () => {
  takeOver('time');
  const t = loops[edit].tgt;
  t.timeShape = +b.dataset.tshape;
  if (!(t.time > 0)) t.time = 60;
  syncUI();
  showOSD(`TIME WARP ${edit}`, TIME_SHAPE_NAME[t.timeShape]);
}));
if (!twProg) $('#timeCtl').hidden = true;

function uses(src) { return activeKeys().some((k) => loops[k].tgt.in1 === src || loops[k].tgt.in2 === src); }

// Pick an input for the loop being edited. Devices start right here, inside the click, so the
// browser treats the camera or screen request as something the person asked for.
function chooseSource(slot, src) {
  takeOver(slot);
  loops[edit].tgt[slot] = src;
  if (is3D(src)) lastWorld[sceneGroup(src)] = src;
  if (src === 'camera' && !cam.on) startCamera();
  if (src === 'screen' && !scr.on) startScreen(true);
  if (src === 'phone') startPhoneLink();
  // No video in yet: the clip library once it's been set up in this browser (its gallery also offers a file),
  // otherwise straight to choosing a file
  if (src === 'video' && !vid.on) { if (clipsWanted()) openClips(); else $('#vidFile').click(); }
  if (src === 'spectro' && !snd.analyser && snd.src === 'off') toast('The spectrograph draws sound. Under the inputs, pick Computer sound or Microphone.');
  if (src === 'text' && txt.str === TEXT_DEFAULT) toast('Type your own words in the Your text box under the inputs.');
  if (src !== 'none' && src !== 'picture' && src !== 'video') hideTip();
  settleDevices();
  syncUI();
  if (src !== 'none') showOSD(`INPUT ${edit}`, src === 'loop' ? `LOOP ${otherLoop(edit)}` : SRC_LABEL[src].toUpperCase());
}

// Turn off the camera and screen share when nothing uses them; pause an unused video.
function settleDevices() {
  if (!uses('camera') && cam.on) stopCamera();
  if (!uses('screen') && scr.on) stopScreen();
  if (vid.video) {
    if (uses('video') && vid.video.paused && !vidUserPaused) vid.video.play().catch(() => {});
    if (!uses('video') && !vid.video.paused) vid.video.pause();
  }
}

/* ================= UI: loop tabs ================= */
const editor = $('#editor');
for (const k of KEYS) $('#tab' + k).addEventListener('click', () => setEdit(k));
function setEdit(k) {
  if (!loopOn(k)) k = 'A';
  edit = k;
  editor.dataset.loop = k;
  for (const j of KEYS) $('#tab' + j).setAttribute('aria-selected', String(k === j));
  syncUI();
  syncPins();
}
$('#showLoop').addEventListener('click', () => {
  takeOver(SHOW[edit]);
  mix.tgt[SHOW[edit]] = 100;
  syncUI();
});
// How many loops: 2, 3 or 4. A loop switched on starts from a fresh look of its own, fully on screen; one switched
// off keeps its settings (hidden and not drawn) for when it comes back.
function setLoopCount(n, how) {
  n = clamp(Math.round(+n || 2), 2, 4);
  const was = loopCount;
  loopCount = n;
  for (const k of activeKeys()) ensureTargets(k);
  if (how !== 'load') {
    for (const k of ['C', 'D']) {
      if (LOOP_NUM[k] < was || !loopOn(k) || loops[k].started) continue;
      loops[k].started = true;
      patchLoop(k, k === 'C' ? C_START : D_START);
      Object.assign(loops[k].cur, loops[k].tgt);
      mirrorCut(k);
      clearLoopTargets(k);
      mix.tgt[SHOW[k]] = mix.cur[SHOW[k]] = 100;
      mix.tgt[FEED_INTO[k]] = mix.cur[FEED_INTO[k]] = 0;
    }
  }
  if (!loopOn(edit)) edit = 'A';
  $('#tabs').dataset.n = String(n);
  for (const k of KEYS) $('#tab' + k).hidden = !loopOn(k);
  $$('#loopCount button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.n === n)));
  $$('[data-loop-row]').forEach((el) => { el.hidden = !loopOn(el.dataset.loopRow); });
  if (typeof syncApLoops === 'function') syncApLoops();
  settleDevices();
  setEdit(edit);
  if (how === 'click' && n > was) { setEdit(KEYS[n - 1]); toast(`Loop ${KEYS[n - 1]} is on, laid over the others. Its Show fader is under Loops.`); }
  wideLayout();
}
$$('#loopCount button').forEach((b) => b.addEventListener('click', () => setLoopCount(+b.dataset.n, 'click')));
function weights(v) { return [Math.min(1, 2 * (1 - v / 100)), Math.min(1, 2 * v / 100)]; }
// Whether loop k looks at the other loop's picture: as an input, or to be pushed or dyed by it.
// The other loop then keeps running even when it isn't on screen.
function readsOther(k) {
  const L = loops[k];
  return [L.tgt.in1, L.tgt.in2].includes('loop') || L.tgt.push > 0 || L.cur.push > 0.5 || L.tgt.dye > 0 || L.cur.dye > 0.5;
}
// A feed pours into the other loop, so if that loop isn't on screen, raising the slider slides
// What you see to Both. (Only for the slider itself.)
function showFedLoop(k) {
  const to = FEED_TO[k], from = otherLoop(to);
  if (wOf(mix.tgt, to) > 0) return;
  mix.tgt[SHOW[to]] = 100;
  sliderEls[SHOW[to]].value = 100;
  showSlider(SHOW[to]);
  toast(`Showing loop ${to}, so you can see loop ${from} pouring into it.`);
}
// Says why a raised Feed slider shows nothing, with a button that fixes it
const feedNote = $('#feedNote');
function syncFeedNote() {
  const notes = [];
  for (const to of activeKeys()) {
    const key = FEED_INTO[to], from = otherLoop(to);
    if (!(mix.tgt[key] > 0)) continue;
    if (wOf(mix.tgt, to) === 0) {
      notes.push([`Loop ${to} isn’t on screen, so you can’t see what loop ${from} pours into it.`, `Show loop ${to}`,
        () => { mix.tgt[SHOW[to]] = 100; }, SHOW[to]]);
    } else if (loops[to].tgt.trails < 10) {
      notes.push([`Loop ${to} has no trails, so what loop ${from} pours in disappears straight away.`, `Give loop ${to} trails`,
        () => { loops[to].tgt.trails = 60; }, 'trails', to]);
    }
  }
  feedNote.textContent = '';
  for (const [text, label, fix, key, loopKey] of notes) {
    const line = document.createElement('span');
    line.textContent = text;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'linkish';
    b.textContent = label;
    b.addEventListener('click', () => { takeOver(key, loopKey); fix(); syncUI(); });
    feedNote.append(line, b);
  }
  feedNote.hidden = notes.length === 0;
}
function syncVisibility() {
  for (const k of KEYS) {
    const el = $('#vis' + k), w = wOf(mix.tgt, k);
    el.classList.toggle('on', w > 0);
    el.title = w > 0 ? 'On screen' : 'Not on screen';
    el.setAttribute('aria-label', el.title);
  }
  const hidden = wOf(mix.tgt, edit) === 0;
  $('#hiddenHint').hidden = !hidden;
  // The loops this one feeds or is read by
  const fed = activeKeys().filter((j) => j !== edit && otherLoop(j) === edit && (mix.tgt[FEED_INTO[j]] > 0 || readsOther(j)));
  $('#hiddenText').textContent = fed.length
    ? `Loop ${edit} isn’t on screen, but it still feeds loop ${fed.join(' and ')}.`
    : `Loop ${edit} isn’t on screen right now.`;
  syncFeedNote();
}

function syncUI() {
  const t = loops[edit].tgt;
  LOOP_SLIDERS.forEach((k) => { sliderEls[k].value = Math.round(sliderShows(k, edit)); showSlider(k); });
  MIX_SLIDERS.forEach((k) => { sliderEls[k].value = Math.round(sliderShows(k, edit)); showSlider(k); });
  $$('#inputs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.src === t.in1 || b.dataset.src === sceneGroup(t.in1))));
  in2Sel.value = t.in2;
  $('#blendCtl').hidden = t.in2 === 'none';
  $$('#mirror button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.mirror === t.mirror)));
  $('#mirrorOut').textContent = t.mirror === 0 ? 'OFF' : `${t.mirror} WAY`;
  $$('#mirrorFx button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mfx === t.mirrorFx)));
  $('#mirrorSpin').setAttribute('aria-pressed', String(!!t.mirrorSpin));
  const usesHere = (s) => t.in1 === s || t.in2 === s;
  for (const s of ['picture', 'video', 'camera', 'screen', 'phone', 'loop', 'spectro', 'text']) $('#row-' + s).hidden = !usesHere(s);
  syncTextUI();
  $$('#growSize button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.gsize === (t.growSize ?? 1))));
  $$('#posterWhere button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.pin === '1') === !!t.posterIn)));
  $$('.where[data-where]').forEach((g) => g.querySelectorAll('button').forEach((b) =>
    b.setAttribute('aria-pressed', String((b.dataset.final === '1') === !!t[g.dataset.where]))));
  $$('#timeShape button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.tshape === (t.timeShape ?? 0))));
  $$('#specShape button').forEach((b) => b.setAttribute('aria-pressed', String((+b.dataset.round === 1) === !!t.specRound)));
  const fly = [t.in1, t.in2].find((s) => sceneGroup(s) === 'world');
  $('#row-3d').hidden = !fly;
  if (fly) $('#hint3d').textContent = HINT_3D[fly];
  $$('#worlds button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.world === fly)));
  $('#ribbitRow').hidden = fly !== 'ribbit';
  $('#ribbitAuto').setAttribute('aria-pressed', String(rib.auto));
  const frac = [t.in1, t.in2].find((s) => sceneGroup(s) === 'fractal');
  $('#row-fractal').hidden = !frac;
  if (frac) $('#hintFractal').textContent = HINT_3D[frac];
  $$('#fractals button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.world === frac)));
  const otherK = otherLoop(edit);
  $('#xcFrom').textContent = otherLoop('C');
  $('#xcFrom').className = `mini ${otherLoop('C').toLowerCase()}`;
  $('#loopSrcBtn').textContent = `Loop ${otherK}’s picture`;
  $('#loopStatus').textContent = `Loop ${otherK}’s picture is feeding loop ${edit}.`;
  in2Sel.querySelector('option[value="loop"]').textContent = `Loop ${otherK}’s picture`;
  for (const id of ['#pushFrom', '#dyeFrom']) { const el = $(id); el.textContent = otherK; el.className = `mini ${otherK.toLowerCase()}`; }
  $('#pushHint').textContent = `Loop ${otherK}’s picture shoves this one around: its bright parts and outlines decide where this loop slides. Works even while loop ${otherK} is hidden.`;
  $('#dyeHint').textContent = `Loop ${otherK}’s picture soaks color into this one: wherever loop ${otherK} is bright, this loop’s colors keep turning, so loop ${otherK}’s shapes show up as rainbow bands.`;
  $('#motionCtl').hidden = !LIVE.some(usesHere);
  $('#motion').setAttribute('aria-pressed', String(!!t.motion));
  $('#soft').setAttribute('aria-pressed', String(t.soft !== false));
  $('#subjectCtl').hidden = !SUBJECT_SRC.some(usesHere);
  $$('#subject button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.subject === (t.subject || 'off'))));
  syncSubjectStatus();
  syncVisibility();
  if (!mirroring) mirrorRefreshSoon();
}

/* ================= looks & surprise ================= */
function liveActive(src) {
  if (src === 'phone') return pho.on;
  if (src === 'spectro') return !!snd.analyser;   // a spectrograph that's hearing something stays, like a running camera
  const s = LIVE_SRC[src];
  return !!(s && s.on);
}
function patchLoop(k, p, force) {
  const L = loops[k];
  // On a new look a running camera, phone, screen, video or spectrograph stays put, unless the look is a
  // 3D world; recipes and presets set everything
  const keep = !force && liveActive(L.tgt.in1) && !is3D(p.in1) ? L.tgt.in1 : null;
  const n = { ...loopDefaults(), ...p };
  if (p.shift) { n.shiftX = p.shift[0]; n.shiftY = p.shift[1]; }
  delete n.shift;
  // A fractal Autopilot brought in as an ordinary input gets no showcase (see rampStart)
  L.asInput = !!p.asInput;
  delete n.asInput;
  n.motion = p.motion ?? (force ? false : L.tgt.motion);
  n.subject = p.subject ?? (force ? 'off' : L.tgt.subject);
  // Looks saved before Color grading took Recolor's place still carry it; it's left behind
  delete n.recolor;
  // Posterize stays through every new look (Autopilot, Surprise), and so does where each effect works (Final Pass
  // or Within Loops); a preset, recipe or Neutral sets them
  if (!force && !('poster' in p)) n.poster = L.tgt.poster || 0;
  if (!force) for (const w of Object.values(FINAL_FX)) if (!(w in p)) n[w] = !!L.tgt[w];
  // Soft trails stays through every new look too; a preset, recipe or Neutral sets it (on, unless saved off)
  if (!force && !('soft' in p)) n.soft = L.tgt.soft !== false;
  // The mirror's Transition and Spin are yours: they stay through every new look (loadPreset brings back a preset's)
  n.mirrorFx = L.tgt.mirrorFx in MIRROR_FX ? L.tgt.mirrorFx : 'melt';
  n.mirrorSpin = !!L.tgt.mirrorSpin;
  if (keep) { n.in1 = keep; n.specRound = p.specRound ?? L.tgt.specRound; }
  // A look saved with an input that no longer exists falls back to Wave (or no second input)
  if (!(n.in1 in SRC_ID)) n.in1 = 'wave';
  if (!(n.in2 in SRC_ID)) n.in2 = 'none';
  Object.assign(L.tgt, n);
  L.base = { ...L.tgt };
  // Each whole new look gets a number, so More like this and Not this know when it's the same look rated twice
  L.gen = (L.gen || 0) + 1;
  if (wOf(mix.tgt, k) > 0.05) lookOnScreen++;
}
function applyPatch(c) {
  patchLoop('A', c.A);
  patchLoop('B', c.B || B_PARTNER);
  mix.tgt.view = c.view ?? 0;
  mix.tgt.xab = c.xab ?? 0;
  mix.tgt.xba = c.xba ?? 0;
  mix.base = { ...mix.tgt };
  settleDevices();
}
// Surprise me: about half the time one of the feeds-on-itself effects, now and then two
function surpriseSelf() {
  const sc = {};
  for (const key of SELF) sc[key] = 0;
  let n = Math.random() < 0.525 ? (Math.random() < 0.15 ? 2 : 1) : 0;
  while (n-- > 0) {
    const key = pick(SELF), [lo, hi] = SELF_RANGE[key];
    sc[key] = Math.round(rnd(lo, lo + (hi - lo) * 0.7));
  }
  return sc;
}
function randomLoop() {
  const zoom = Math.round(Math.random() < 0.25 ? rnd(-45, -10) : rnd(5, 65));
  // One chance each, so every 3D world and fractal comes up as often as Wave or Shape
  const in1 = pick(['wave', 'shape', 'bars', 'sparks', 'ink', 'patchwork', 'picture', 'text', ...allScenes(),
                    ...(snd.analyser ? ['spectro'] : [])]);
  return {
    in1, size: in1 === 'bars' || in1 === 'picture' ? 50 : in1 === 'text' ? 85 : 100, specRound: Math.random() < 0.5,
    form: 2 + Math.floor(Math.random() * 4),
    zoom,
    spin: Math.round(rnd(-60, 60)),
    trails: Math.round(rnd(80, 96)),
    color: Math.round(Math.pow(Math.random(), 1.4) * 45),
    warp: Math.round(Math.random() < 0.5 ? rnd(0, 15) : rnd(15, 60)),
    flow: in1 === 'ink' || Math.random() < 0.25 ? Math.round(rnd(30, 85)) : 0,
    melt: Math.random() < 0.25 ? Math.round(rnd(25, 75)) : 0,
    push: Math.random() < 0.2 ? Math.round(rnd(30, 75)) : 0,
    dye: Math.random() < 0.2 ? Math.round(rnd(25, 70)) : 0,
    grow: Math.random() < 0.18 ? Math.round(rnd(40, 85)) : 0, growSize: Math.floor(Math.random() * 3),
    time: Math.random() < 0.18 ? Math.round(rnd(35, 90)) : 0, timeShape: Math.floor(Math.random() * 3),
    ...surpriseSelf(),
    mirror: pick([0, 0, 2, 4, 6, 8]),
    blur: +rnd(-0.1, 0.35).toFixed(2),
    edge: zoom < 0 && Math.random() < 0.6 ? 1 : 0,
    shift: Math.random() < 0.3 ? [rnd(-0.003, 0.003), rnd(-0.003, 0.003)] : [0, 0],
  };
}
function surprise() {
  takeOver();
  markPreset(null);
  const both = Math.random() < 0.5;
  applyPatch({ A: randomLoop(), B: randomLoop(), view: both ? Math.round(rnd(30, 70)) : 0, xab: both ? Math.round(rnd(0, 70)) : 0, xba: both ? Math.round(rnd(0, 70)) : 0 });
  // Loops C and D get a surprise of their own too, while they're on
  for (const k of ['C', 'D']) if (loopOn(k)) {
    patchLoop(k, randomLoop());
    mix.tgt[FEED_INTO[k]] = Math.random() < 0.5 ? Math.round(rnd(0, 70)) : 0;
    mix.base = { ...mix.tgt };
  }
  syncUI();
  burst();
  showOSD('SURPRISE', 'NEW LOOK');
}
$('#surprise').addEventListener('click', surprise);

/* ================= react to sound ================= */
// Listens to the computer's sound through screen sharing or a loopback adapter,
// or to the microphone, splits it into low, mid and high bands plus beats,
// and nudges both loops with them. Nothing is played back, so there is no echo.
const snd = {
  src: 'off', ctx: null, analyser: null, source: null, stream: null, track: null, bins: null,
  rate: 48000, tap: null, appFeed: null, rhythm: null, rhythmSample: null, rhythmGrid: null, analysisError: '',
  env: { low: 0, mid: 0, high: 0, beat: 0 },
  avg: { low: 0, mid: 0, high: 0 }, peak: { low: 0.1, mid: 0.1, high: 0.1 },
  beats: 0, shakeDir: [1, 0], amount: 60,
  map: { kick: true, size: true, spin: true, color: true, warp: true, flash: true },
  // Which loops move with the sound (Loops that react, at the top of React to sound)
  react: { A: true, B: true, C: true, D: true },
};
// Whether loop k moves with the sound right now
const reacts = (k) => !!snd.analyser && snd.react[k] !== false;
// How hard the picture reacts. The old full strength now sits near 50, and Wild goes well past it.
const sndPower = () => Math.pow(clamp(snd.amount, 0, 100) / 100, 0.85) * 2.4;
const sndStatus = $('#sndStatus'), sndRetry = $('#sndRetry'), sndAmt = $('#sndAmt'), micSel = $('#micSel');
let micDeviceId = '', loopbackDeviceId = '', soundRequest = 0;
// Firefox and Safari share screens without sound, so Computer sound only works in Chrome and Edge
const UA = navigator.userAgent || '';
const noScreenAudio = /Firefox\//.test(UA) || (/Safari\//.test(UA) && !/(Chrome|Chromium|Edg)\//.test(UA));
const browserName = /Firefox\//.test(UA) ? 'Firefox' : 'Safari';
if (noScreenAudio) {
  $('#sndHint').classList.remove('as-tip');
  $('#sndHint').innerHTML = `Computer sound sharing needs Chrome or Edge. In ${browserName}, use <b>Loopback adapter</b> with BlackHole or Stereo Mix to hear this computer, or <b>Microphone</b> to hear the room.`;
}
// Inputs that carry the computer's own sound rather than a room microphone
const LOOPBACK = /blackhole|soundflower|stereo mix|what u hear|wave out|cable output|loopback|voicemeeter|monitor of/i;
if (APP) {
  $$('[data-snd="loopback"]').forEach((b) => { b.hidden = true; });
  $('#soundSrc').classList.replace('seg-2', 'seg-3');
  $('#specListen').classList.replace('seg-3', 'seg-2');
}
if (inArtifact) $('#soundGroup').hidden = true;
// The Spectrograph input's own row repeats what the sound is doing, so nobody has to scroll up to React to sound
const specStatus = $('#specStatus');
const SPEC_IDLE = 'The spectrograph needs something to listen to. Pick one:';
function sndSay(html, warn, offerMic) {
  say(sndStatus, html, warn); sndRetry.hidden = !warn; $('#sndUseMic').hidden = !offerMic;
  say(specStatus, snd.src === 'off' ? SPEC_IDLE : html, warn && snd.src !== 'off');
}

// Android app: "Phone sound" hears whatever the phone plays (Spotify, YouTube, games). Android asks first,
// then the app streams the sound here in small pieces. Each piece goes straight to the picture, and a copy
// becomes an ordinary audio track so a recording can keep the sound.
const appSnd = { ctx: null, dest: null, node: null, push: null, on: false, session: 0, heard: 0, quiet: null };
// The recording's copy waits in a short queue (about 40-60 ms) so it stays in step with the picture
const FEED_WORKLET = `class PLFeed extends AudioWorkletProcessor {
  constructor() {
    super(); this.q = []; this.off = 0; this.len = 0; this.go = false;
    this.port.onmessage = (e) => {
      this.q.push(e.data); this.len += e.data.length;
      if (this.len - this.off > sampleRate * 0.15) {
        while (this.len - this.off > sampleRate * 0.06 && this.q.length > 1) { this.len -= this.q.shift().length; this.off = 0; }
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    if (!this.go && this.len - this.off >= sampleRate * 0.04) this.go = true;
    let i = 0;
    while (this.go && i < out.length && this.q.length) {
      const h = this.q[0], n = Math.min(out.length - i, h.length - this.off);
      out.set(h.subarray(this.off, this.off + n), i); i += n; this.off += n;
      if (this.off >= h.length) { this.q.shift(); this.len -= h.length; this.off = 0; }
    }
    if (i < out.length) { out.fill(0, i); this.go = false; }
    return true;
  }
}
registerProcessor('pl-feed', PLFeed);`;
if (APP) {
  $$('[data-snd="system"]').forEach((b) => { b.textContent = 'Phone sound'; });
  $('#sndHint').innerHTML = 'Play music in Spotify, YouTube or any app on this phone and choose <b>Phone sound</b>, or let the <b>Microphone</b> hear the room. Record keeps the sound too.';
  window.addEventListener('message', (e) => {
    if (e.data !== 'phosphor-sound-port' || !e.ports || !e.ports[0]) return;
    e.ports[0].onmessage = (m) => appSoundChunk(m.data);
  });
}
function appSoundClose() {
  if (appSnd.ctx || appSnd.on) { try { APP.stopSound(); } catch (_) {} }
  clearTimeout(appSnd.quiet);
  if (appSnd.node) { try { appSnd.node.disconnect(); } catch (_) {} }
  if (appSnd.ctx) { try { appSnd.ctx.close(); } catch (_) {} }
  Object.assign(appSnd, { ctx: null, dest: null, node: null, push: null, on: false });
}
// Built during the tap, so the phone lets the sound run
function appSoundPrepare() {
  appSoundClose();
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx;
  try { ctx = new AC({ sampleRate: 48000 }); } catch (_) { ctx = new AC(); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const dest = ctx.createMediaStreamDestination();
  const sink = ctx.createGain();   // silent, but keeps the phone's audio engine pulling samples through
  sink.gain.value = 0;
  sink.connect(ctx.destination);
  Object.assign(appSnd, { ctx, dest, session: appSnd.session + 1, heard: 0 });
  const attach = (node, push) => {
    if (appSnd.ctx !== ctx) { try { node.disconnect(); } catch (_) {} return; }
    node.connect(dest); node.connect(sink);
    appSnd.node = node; appSnd.push = push;
    startRhythm(ctx, node);
  };
  (async () => {
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      try {
        const url = URL.createObjectURL(new Blob([FEED_WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(ctx, 'pl-feed', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
        attach(node, (f) => node.port.postMessage(f, [f.buffer]));
        return;
      } catch (_) {}
    }
    // Older phones: fill the sound from the page itself
    const q = [];
    let off = 0;
    const node = ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      let i = 0;
      while (i < out.length && q.length) {
        const h = q[0], n = Math.min(out.length - i, h.length - off);
        out.set(h.subarray(off, off + n), i); i += n; off += n;
        if (off >= h.length) { q.shift(); off = 0; }
      }
      if (i < out.length) out.fill(0, i);
      while (q.length > 7) { q.shift(); off = 0; }
    };
    attach(node, (f) => q.push(f));
  })();
}
function appSoundChunk(data) {
  if (!appSnd.on || typeof data !== 'string') return;
  let bin;
  try { bin = atob(data); } catch (_) { return; }
  const n = bin.length >> 1, f = new Float32Array(n);
  let peak = 0;
  for (let i = 0, j = 0; i < n; i++, j += 2) {
    let v = bin.charCodeAt(j) | (bin.charCodeAt(j + 1) << 8);
    if (v > 32767) v -= 65536;
    f[i] = v / 32768;
    if (v > peak) peak = v; else if (-v > peak) peak = -v;
  }
  if (peak > 64) appSnd.heard = performance.now();
  // Straight to the picture first; the copy handed on below only feeds a recording's sound track
  if (snd.appFeed) snd.appFeed.push(f);
  if (appSnd.push) appSnd.push(f);
}
function appSound() {
  if (!appInfo.sound) { sndSay('This phone can’t share its own sound with apps (that needs Android 10 or newer). Use the <b>Microphone</b> instead.', false, true); return; }
  appSoundPrepare();
  sndSay('Android asks whether Phosphor Loop may record or cast your screen. Tap <b>Start</b> (or <b>Start now</b>). Only the sound is used, and nothing is saved or sent anywhere.');
  try { APP.startSound(Math.round(appSnd.ctx.sampleRate), appSnd.session); }
  catch (_) { appSoundClose(); sndSay('The phone’s sound couldn’t start. Press Try again, or use the Microphone.', true, true); }
}
onApp('sound', (d) => {
  if (d.session !== appSnd.session) return;
  if (d.state === 'started') {
    if (snd.src !== 'system' || !appSnd.dest) { appSoundClose(); return; }
    appSnd.on = true;
    listen(new MediaStream(appSnd.dest.stream.getAudioTracks()), d.rate || appSnd.ctx.sampleRate);
    sndSay('<span class="live"></span><b>Listening to this phone’s sound.</b> Play music in any app. Android shows that Phosphor Loop is sharing; only the sound is used.');
    clearTimeout(appSnd.quiet);
    appSnd.quiet = setTimeout(() => {
      if (appSnd.on && snd.src === 'system' && !appSnd.heard) {
        sndSay('Listening, but nothing has come through yet. Start some music. If the bars still don’t move, that app keeps its sound to itself, so use the <b>Microphone</b> instead.', false, true);
      }
    }, 15000);
  } else if (d.state === 'stopped') {
    if (!appSnd.on || snd.src !== 'system') return;
    stopSound();
    snd.src = 'off';
    syncSoundUI();
    toast('The phone’s sound stopped. Choose Phone sound or Microphone to listen again.');
  } else {
    if (snd.src !== 'system') return;
    appSoundClose();
    if (d.state === 'denied') sndSay('Android didn’t start sharing. Press Try again and tap <b>Start</b>.', true);
    else if (d.state === 'mic-denied') sndSay('Android files the phone’s sound under the <b>Microphone</b> permission. Press Try again and choose <b>Allow</b>.', true);
    else sndSay('The phone’s sound couldn’t start. Press Try again, or use the Microphone.', true, true);
  }
});
function syncSoundUI() {
  $$('#soundSrc button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.snd === snd.src)));
  $$('#specListen button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.snd === snd.src)));
  if (snd.src === 'off') say(specStatus, SPEC_IDLE);
  $('#soundRow').hidden = snd.src === 'off';
  $('#micPick').hidden = snd.src === 'loopback' ? micSel.options.length === 0 : snd.src !== 'mic' || micSel.options.length < 2;
  $('#loopbackHint').hidden = snd.src !== 'loopback';
  $$('#sndMap button').forEach((b) => b.setAttribute('aria-pressed', String(!!snd.map[b.dataset.map])));
  $$('#sndLoops button').forEach((b) => b.setAttribute('aria-pressed', String(snd.react[b.dataset.react] !== false)));
  sndAmt.value = snd.amount;
  fillTrack(sndAmt);
  $('#sndAmtOut').textContent = snd.amount === 0 ? 'OFF' : String(snd.amount);
}
// Does the same sums as the browser's own sound analyser (Blackman window, FFT, smoothing, 0-255 levels,
// checked to match it bin for bin), but is handed the raw sound the moment it arrives. The browser's audio
// engine holds sound in its own buffers first, and on the phone app the sound also queued for playback,
// which is what made the picture react late.
function makeFastAnalyser(rate) {
  const N = 2048, H = N >> 1, R = N * 8;
  const ring = new Float32Array(R), win = new Float32Array(N), re = new Float64Array(N), im = new Float64Array(N);
  const mag = new Float64Array(H), rev = new Uint16Array(N), tc = new Float64Array(H), ts = new Float64Array(H);
  for (let i = 0; i < N; i++) win[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < 11; b++) r |= ((i >> b) & 1) << (10 - b); rev[i] = r; }
  for (let k = 0; k < H; k++) { tc[k] = Math.cos(2 * Math.PI * k / N); ts[k] = -Math.sin(2 * Math.PI * k / N); }
  let w = 0;
  return {
    fftSize: N, frequencyBinCount: H, rate,
    push(x) { for (let i = 0; i < x.length; i++) { ring[w] = x[i]; w = w + 1 === R ? 0 : w + 1; } },
    getByteFrequencyData(out) {
      for (let i = 0, j = w - N + R; i < N; i++, j++) { const k = rev[i]; re[k] = ring[j % R] * win[i]; im[k] = 0; }
      for (let size = 2; size <= N; size <<= 1) {
        const half = size >> 1, step = N / size;
        for (let s = 0; s < N; s += size) {
          for (let k = 0, t = 0; k < half; k++, t += step) {
            const a = s + k, b = a + half;
            const xr = re[b] * tc[t] - im[b] * ts[t], xi = re[b] * ts[t] + im[b] * tc[t];
            re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          }
        }
      }
      // Same settings as before: light smoothing, and -90 to -20 dB spread over 0-255
      for (let k = 0; k < H; k++) {
        const m = Math.sqrt(re[k] * re[k] + (k ? im[k] * im[k] : 0)) / N;
        mag[k] = 0.2 * mag[k] + 0.8 * m;
        const v = (20 * Math.log10(mag[k]) + 90) * (255 / 70);
        out[k] = v > 0 ? (v < 255 ? v : 255) : 0;
      }
    },
  };
}
// Chrome and Edge can hand a page the raw sound straight from the track; other browsers use the audio engine
const canTap = typeof window.MediaStreamTrackProcessor === 'function' && typeof window.AudioData === 'function';
let tapOne = new Float32Array(0), tapMix = new Float32Array(0);
function tapFeed(fa, ad) {
  const n = ad.numberOfFrames, ch = ad.numberOfChannels;
  if (tapOne.length < n) { tapOne = new Float32Array(n); tapMix = new Float32Array(n); }
  const one = tapOne.subarray(0, n), mix = tapMix.subarray(0, n);
  try {
    for (let c = 0; c < ch; c++) {
      ad.copyTo(one, { planeIndex: c, format: 'f32-planar' });
      if (c === 0) mix.set(one); else for (let i = 0; i < n; i++) mix[i] += one[i];
    }
  } catch (_) { return false; }
  if (ch > 1) for (let i = 0; i < n; i++) mix[i] /= ch;
  fa.rate = ad.sampleRate;
  fa.push(mix);
  return true;
}
function setAnalyser(analyser, rate) {
  Object.assign(snd, { analyser, rate, bins: new Uint8Array(analyser.frequencyBinCount) });
}
function dropTap() {
  const t = snd.tap;
  if (!t) return;
  snd.tap = null;
  clearTimeout(t.check);
  try { t.reader.cancel().catch(() => {}); } catch (_) {}
  try { t.copy.stop(); } catch (_) {}
}
// Tempo runs on the audio clock, independently of the raw-track spectrum and graphics.
function startRhythm(ctx, source) {
  if (location.protocol === 'file:') {
    snd.analysisError = 'BPM tracking needs localhost or HTTPS. Open the local preview.';
    return;
  }
  if (!ctx.audioWorklet || !window.PhosphorRhythm) {
    snd.analysisError = 'BPM tracking is unavailable in this browser.';
    return;
  }
  snd.rhythm?.stop();
  const rhythm = snd.rhythm = new window.PhosphorRhythm(ctx, source);
  rhythm.start().catch(() => {
    rhythm.stop();
    if (snd.rhythm === rhythm) {
      snd.rhythm = null;
      snd.analysisError = 'BPM tracking could not start. Reconnect audio to try again.';
    }
  });
}
function soundEngine(track) {
  if (snd.ctx && snd.source) return { ctx: snd.ctx, source: snd.source };
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  Object.assign(snd, { ctx, source });
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  startRhythm(ctx, source);
  return { ctx, source };
}
// The browser's audio engine: slower, but works everywhere
function useEngine(track) {
  const { ctx, source } = soundEngine(track);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.2;   // low, so a kick shows up the moment it lands
  analyser.minDecibels = -90;
  analyser.maxDecibels = -20;
  source.connect(analyser);
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  Object.assign(snd, { ctx, source });
  setAnalyser(analyser, ctx.sampleRate);
}
// Reads the raw sound as it arrives. If that fails, or nothing turns up within two seconds, it goes back to the audio engine.
function useTap(track) {
  let copy, reader;
  try {
    copy = track.clone();
    reader = new MediaStreamTrackProcessor({ track: copy }).readable.getReader();
  } catch (_) { try { copy.stop(); } catch (__) {} return false; }
  const fa = makeFastAnalyser(48000);
  const tap = { reader, copy, got: 0, check: 0 };
  const fallBack = () => {
    if (snd.tap !== tap) return;
    dropTap();
    if (snd.track === track && track.readyState === 'live') useEngine(track);
  };
  snd.tap = tap;
  setAnalyser(fa, fa.rate);
  (async () => {
    for (;;) {
      let r;
      try { r = await reader.read(); } catch (_) { r = { done: true }; }
      if (snd.tap !== tap) { if (r.value) r.value.close(); return; }
      if (r.done) { fallBack(); return; }
      const ok = tapFeed(fa, r.value);
      r.value.close();
      if (!ok) { fallBack(); return; }
      tap.got++;
      snd.rate = fa.rate;
    }
  })();
  tap.check = setTimeout(() => { if (!tap.got) fallBack(); }, 2000);
  return true;
}
function stopSound() {
  snd.rhythm?.stop();
  snd.rhythm = null; snd.rhythmSample = null; snd.rhythmGrid = null; snd.analysisError = '';
  $('#rhythmStatus').textContent = 'Share audio to find BPM.';
  $('#mBeat').classList.remove('on');
  if (APP) appSoundClose();
  dropTap();
  if (snd.stream) snd.stream.getTracks().forEach((t) => t.stop());
  if (snd.source) { try { snd.source.disconnect(); } catch (_) {} }
  if (snd.ctx) { try { snd.ctx.close().catch(() => {}); } catch (_) {} }
  snd.stream = null; snd.source = null; snd.analyser = null; snd.ctx = null; snd.track = null; snd.appFeed = null;
  for (const k in snd.env) snd.env[k] = 0;
}
// appRate: the phone app's own sound, which appSoundChunk hands straight to the analyser
function listen(stream, appRate) {
  const track = stream.getAudioTracks()[0];
  Object.assign(snd, { stream, track });
  if (appRate) { snd.appFeed = makeFastAnalyser(appRate); setAnalyser(snd.appFeed, appRate); }
  else {
    if (!(canTap && useTap(track))) useEngine(track);
    else soundEngine(track);
  }
  snd.avg = { low: 0, mid: 0, high: 0 };
  snd.peak = { low: 0.1, mid: 0.1, high: 0.1 };
  track.addEventListener('ended', () => {
    if (snd.track !== track) return;
    stopSound();
    snd.src = 'off';
    syncSoundUI();
    toast('The sound stopped. Choose Computer sound or Microphone to listen again.');
  });
}
async function setSound(src) {
  const request = ++soundRequest;
  stopSound();
  snd.src = src;
  syncSoundUI();
  if (src === 'off') { sndSay('Not listening.'); return; }
  if (src === 'mic' || src === 'loopback') {
    const loopback = src === 'loopback';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { sndSay('This browser can’t use a microphone on this page.', true); return; }
    sndSay(loopback ? 'Looking for a loopback adapter. Allow audio input access if your browser asks…' : 'Waiting for you to allow the microphone…');
    try {
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      if (loopback) {
        let ins = await listMics();
        if (request !== soundRequest) return;
        if (!ins.some((d) => d.label)) {
          // Device names are private until audio input access has been granted.
          const permission = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          permission.getTracks().forEach((t) => t.stop());
          if (request !== soundRequest) return;
          ins = await listMics();
          if (request !== soundRequest) return;
        }
        const adapters = ins.filter((d) => LOOPBACK.test(d.label));
        const device = adapters.find((d) => d.deviceId === loopbackDeviceId)
          || adapters.find((d) => /blackhole 2ch/i.test(d.label)) || adapters[0];
        if (!device) {
          sndSay('No loopback adapter was found. Install or enable BlackHole, Stereo Mix or another loopback input, then press Try again. No microphone is being used.', true);
          return;
        }
        loopbackDeviceId = device.deviceId;
        audio.deviceId = { exact: loopbackDeviceId };
        audio.channelCount = { ideal: 2 };
      } else if (micDeviceId) audio.deviceId = { exact: micDeviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      if (request !== soundRequest) { stream.getTracks().forEach((t) => t.stop()); return; }
      listen(stream);
      const settings = stream.getAudioTracks()[0].getSettings ? stream.getAudioTracks()[0].getSettings() : {};
      if (loopback) loopbackDeviceId = settings.deviceId || loopbackDeviceId;
      else micDeviceId = settings.deviceId || micDeviceId;
      const label = stream.getAudioTracks()[0].label || '';
      sndSay(LOOPBACK.test(label)
        ? `<span class="live"></span><b>Listening to this computer’s sound</b> through ${escapeHTML(label)}.`
        : '<span class="live"></span><b>Listening through the microphone.</b> Play music nearby, or clap.');
      listMics();
    } catch (err) {
      if (request !== soundRequest) return;
      const n = err && err.name;
      if (n === 'NotAllowedError' || n === 'SecurityError') {
        sndSay(APP ? 'Microphone access was blocked. Press Try again and choose <b>Allow</b>.'
          : 'Microphone access was blocked. Click the microphone icon in the address bar, choose <b>Allow</b>, then press Try again.', true);
      }
      else if (n === 'NotFoundError' || n === 'OverconstrainedError') {
        if (loopback) loopbackDeviceId = ''; else micDeviceId = '';
        sndSay('That input wasn’t found. Plug it in or pick another, then press Try again.', true);
      }
      else sndSay(loopback ? 'The loopback adapter couldn’t start. Press Try again.' : 'The microphone couldn’t start. Press Try again.', true);
    }
    return;
  }
  if (APP) { appSound(); return; }
  if (noScreenAudio || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    sndSay(`${noScreenAudio ? browserName : 'This browser'} can’t pass the computer’s sound to web pages, so Computer sound needs <b>Chrome</b> or <b>Edge</b>. ` +
      'Here you can use the microphone instead. On Windows, choose <b>Stereo Mix</b> when asked which microphone, and it hears the computer’s own sound.', false, true);
    return;
  }
  sndSay('In the box that opens, pick a screen on the <b>Entire Screen</b> tab (Screen 1 or Screen 2, either one gives the whole computer’s sound), switch on <b>Also share system audio</b>, then press <b>Share</b>.');
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor' },   // opens the box on the screens tab, where system audio lives
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'include',
    });
    stream.getVideoTracks().forEach((t) => t.stop());   // only the sound is used
    if (snd.src !== 'system') { stream.getTracks().forEach((t) => t.stop()); return; }
    if (!stream.getAudioTracks().length) {
      sndSay('No sound came through. Press Try again and switch on <b>Also share system audio</b> under the screen you pick. No switch there? Choose <b>Microphone</b> instead and pick <b>Stereo Mix</b> under Listen to (the Guide shows how to turn it on).', true);
      return;
    }
    listen(stream);
    sndSay('<span class="live"></span><b>Listening to this computer’s sound.</b> Chrome shows a sharing bar while it listens; only the sound is used.');
  } catch (err) {
    sndSay('Sharing was cancelled. Press Try again, pick <b>Screen 1</b> or <b>Screen 2</b>, and switch on <b>Also share system audio</b>.', true);
  }
}
async function listMics() {
  try {
    const ins = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const loopback = snd.src === 'loopback';
    const shown = loopback ? ins.filter((d) => LOOPBACK.test(d.label)) : ins;
    micSel.innerHTML = '';
    shown.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = (d.label || `Input ${i + 1}`) + (LOOPBACK.test(d.label) ? ' (this computer’s sound)' : '');
      micSel.appendChild(o);
    });
    const selected = loopback ? loopbackDeviceId : micDeviceId;
    if ([...micSel.options].some((o) => o.value === selected)) micSel.value = selected;
    const loop = ins.find((d) => LOOPBACK.test(d.label));
    const tip = $('#micTip');
    const onLoop = loop && loop.deviceId === micSel.value;
    tip.hidden = loopback || !loop || onLoop;
    if (loop && !onLoop) tip.textContent = `Pick “${loop.label}” to hear everything this computer plays, with no screen sharing.`;
    syncSoundUI();
    return ins;
  } catch (_) { return []; }
}
micSel.addEventListener('change', () => {
  if (snd.src === 'loopback') { loopbackDeviceId = micSel.value; setSound('loopback'); }
  else { micDeviceId = micSel.value; setSound('mic'); }
});
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', listMics);
$('#sndUseMic').addEventListener('click', () => setSound('mic'));
$$('#soundSrc button').forEach((b) => b.addEventListener('click', () => setSound(b.dataset.snd)));
// Already hearing it? Then the spectrograph's button leaves it alone rather than asking all over again
$$('#specListen button').forEach((b) => b.addEventListener('click', () => {
  if (snd.src === b.dataset.snd && snd.analyser) { toast('Already listening. Play something and watch it draw.'); return; }
  setSound(b.dataset.snd);
}));
sndRetry.addEventListener('click', () => setSound(snd.src === 'off' ? 'system' : snd.src));
sndAmt.addEventListener('input', () => { snd.amount = +sndAmt.value; syncSoundUI(); });
sndAmt.addEventListener('dblclick', () => { snd.amount = 60; syncSoundUI(); });
$$('#sndMap button').forEach((b) => b.addEventListener('click', () => { snd.map[b.dataset.map] = !snd.map[b.dataset.map]; syncSoundUI(); }));
$$('#sndLoops button').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.react;
  snd.react[k] = snd.react[k] === false;
  syncSoundUI();
  toast(snd.react[k] ? `Loop ${k} moves with the sound again.` : `Loop ${k} ignores the sound now; the other loops still react.`);
}));
syncSoundUI();

// Each band is judged against its own recent level, so quiet and loud songs both move the picture.
// The pulse follows the estimated BPM grid; band energy still responds immediately.
function analyzeSound(dt, now) {
  if (!snd.analyser) return;
  const bins = snd.bins;
  snd.analyser.getByteFrequencyData(bins);
  const hz = snd.rate / snd.analyser.fftSize;
  const span = (lo, hi) => [Math.max(1, Math.floor(lo / hz)), Math.min(bins.length - 1, Math.ceil(hi / hz))];
  // Squaring widens the gap between a hit and the sound around it
  const band = (lo, hi) => {
    const [a, b] = span(lo, hi);
    let sum = 0;
    for (let i = a; i <= b; i++) { const v = bins[i] / 255; sum += v * v; }
    return sum / (b - a + 1);
  };
  const raw = { low: band(35, 150), mid: band(250, 2000), high: band(3000, 12000) };
  for (const k of ['low', 'mid', 'high']) {
    const v = raw[k];
    snd.avg[k] += (v - snd.avg[k]) * (1 - Math.exp(-dt / 1.5));
    // The loudest recent moment sinks back over a couple of seconds, but never all the way to the average
    const top = snd.avg[k] * 1.35;
    snd.peak[k] = Math.max(v, snd.peak[k] + (top - snd.peak[k]) * (1 - Math.exp(-dt / 2)));
    const floor = snd.avg[k] * 0.9;
    const x = v < 0.004 ? 0 : clamp((v - floor) / Math.max(snd.peak[k] - floor, 0.01), 0, 1);
    const e = snd.env[k];
    snd.env[k] = e + (x - e) * (1 - Math.exp(-dt * (x > e ? 60 : k === 'mid' ? 7 : 10)));
  }
  const music = snd.rhythmSample = snd.rhythm?.read() || null;
  const grid = music?.gridBeat ?? null;
  // Reacquiring after silence starts a new baseline, rather than inventing missed beats.
  if (grid !== null && snd.rhythmGrid !== null && grid > snd.rhythmGrid) {
    snd.beats++;
    const a = Math.random() * Math.PI * 2;
    snd.shakeDir = [Math.cos(a), Math.sin(a)];
  }
  snd.rhythmGrid = grid;
  snd.env.beat = music?.bpmBeat || 0;
}
const mLow = $('#mLow'), mMid = $('#mMid'), mHigh = $('#mHigh'), mBeat = $('#mBeat');
let meterTick = 0;
function drawMeter() {
  if (!snd.analyser || (++meterTick & 1)) return;
  mLow.style.transform = `scaleY(${snd.env.low.toFixed(3)})`;
  mMid.style.transform = `scaleY(${snd.env.mid.toFixed(3)})`;
  mHigh.style.transform = `scaleY(${snd.env.high.toFixed(3)})`;
  mBeat.classList.toggle('on', snd.env.beat > 0.45);
  const music = snd.rhythmSample;
  const status = snd.analysisError || (music
    ? (music.bpm ? Math.round(music.bpm) + ' BPM · ' : '') + music.state
    : snd.rhythm?.error ? 'BPM tracking unavailable. Reconnect audio to try again.'
    : 'Finding BPM · allow about 12 seconds of music.');
  const label = $('#rhythmStatus');
  if (label.textContent !== status) label.textContent = status;
}

/* ================= spectrograph ================= */
// The Spectrograph input draws the sound itself: 60 moments a second, each a row of 256 pitches from
// 30 Hz (the deepest bass) to 14 kHz (the fizz of cymbals). It reuses what the sound analyser has
// already worked out this frame, so it costs next to nothing. The rows go round a ring in a small
// texture, and the feedback pass reads them back as a picture (see seedSpec).
const SPEC_W = 256, SPEC_H = 400, SPEC_RATE = 60;
const specTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, specTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SPEC_W, SPEC_H, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(SPEC_W * SPEC_H));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
const spec = {
  row: new Uint8Array(SPEC_W), raw: new Float32Array(SPEC_W), next: 0, acc: 0, top: 0, on: false, mapKey: '',
  at: new Float32Array(SPEC_W), lo: new Uint16Array(SPEC_W), hi: new Uint16Array(SPEC_W), tilt: new Float32Array(SPEC_W),
};
// Pitches are spaced the way we hear them (each octave about the same height), except in the deep bass,
// which is squeezed a little because the analyser can't tell those notes apart anyway
const specWarp = (f) => Math.log(1 + f / 120);
const specUnwarp = (s) => 120 * (Math.exp(s) - 1);
function specMap(hz, n) {
  const key = `${hz}/${n}`;
  if (spec.mapKey === key) return;
  spec.mapKey = key;
  const s0 = specWarp(30), s1 = specWarp(14000);
  for (let c = 0; c < SPEC_W; c++) {
    const f = (k) => specUnwarp(s0 + (s1 - s0) * k / SPEC_W);
    spec.at[c] = Math.min(f(c + 0.5) / hz, n - 1.001);
    spec.lo[c] = clamp(Math.round(f(c) / hz), 1, n - 1);
    spec.hi[c] = clamp(Math.round(f(c + 1) / hz), 1, n - 1);
    // Music gets quieter the higher it goes, so the high pitches get a lift (3 dB an octave above 1 kHz)
    // and the cymbals show up next to the bass
    spec.tilt[c] = Math.max(0, 3 * (255 / 70) * Math.log2(f(c + 0.5) / 1000));
  }
}
function specClear() {
  gl.activeTexture(gl.TEXTURE0 + 14);
  gl.bindTexture(gl.TEXTURE_2D, specTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPEC_W, SPEC_H, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(SPEC_W * SPEC_H));
  spec.top = 0;
}
function writeSpec(dt) {
  if (!uses('spectro')) { spec.on = false; return; }
  if (!spec.on) { spec.on = true; specClear(); }   // start from black, not from whatever it heard last time
  spec.acc += dt * SPEC_RATE;
  let rows = Math.floor(spec.acc);
  spec.acc -= rows;
  if (!rows) return;
  rows = Math.min(rows, 8);
  const out = spec.row;
  if (snd.analyser && snd.bins) {
    const bins = snd.bins;
    specMap(snd.rate / snd.analyser.fftSize, bins.length);
    let loud = 0;
    for (let c = 0; c < SPEC_W; c++) {
      const lo = spec.lo[c], hi = spec.hi[c];
      let v;
      if (hi - lo < 2) {
        // Fewer analyser bins than rows down in the bass: blend the two nearest, so it stays smooth
        const a = spec.at[c], i = Math.floor(a), f = a - i;
        v = bins[i] * (1 - f) + bins[i + 1] * f;
      } else {
        v = 0;
        for (let i = lo; i < hi; i++) if (bins[i] > v) v = bins[i];
      }
      if (v > 0) v += spec.tilt[c];
      spec.raw[c] = v;
      if (v > loud) loud = v;
    }
    // It sets its own brightness: the loudest recent sound is full brightness and it shows about 45 dB below
    // that, so a quiet microphone and loud music both fill the picture, while silence stays black
    spec.top = loud > spec.top ? loud : spec.top + (loud - spec.top) * (1 - Math.exp(-dt / 4));
    const top = Math.max(spec.top, 110), floor = Math.max(top - 165, 20);
    for (let c = 0; c < SPEC_W; c++) {
      const x = (spec.raw[c] - floor) / (top - floor);
      out[c] = x <= 0 ? 0 : x >= 1 ? 255 : Math.round(255 * Math.pow(x, 1.3));
    }
  } else out.fill(0);   // not listening: the picture slides away into black
  gl.activeTexture(gl.TEXTURE0 + 14);
  gl.bindTexture(gl.TEXTURE_2D, specTex);
  for (let i = 0; i < rows; i++) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, spec.next, SPEC_W, 1, gl.RED, gl.UNSIGNED_BYTE, out);
    spec.next = (spec.next + 1) % SPEC_H;
  }
}

/* ================= neutral ================= */
// Back to a plain monitor: loop A shows its current input filling the screen, with every effect off
const IMAGE_INPUTS = ['picture', 'video', 'camera', 'screen', 'phone'];
function neutral() {
  if (ap.on) setAutopilot(false, true);
  markPreset(null);
  for (const k of KEYS) loopGrade[k] = null;
  if (frozen) toggleFreeze(false);
  let src = loops.A.tgt.in1;
  if (src === 'loop') src = loops.B.tgt.in1 === 'loop' ? 'wave' : loops.B.tgt.in1;
  const flat = {
    in1: src, in2: 'none', blend: 50, size: IMAGE_INPUTS.includes(src) ? 78 : src === 'spectro' || src === 'text' || src === 'patchwork' ? 100 : 50, motion: false,
    zoom: 0, spin: 0, trails: 0, color: 0, warp: 0, mirror: 0, blur: 0, edge: 0, shift: [0, 0], gain: 1,
    form: loops.A.tgt.form, specRound: loops.A.tgt.specRound,
  };
  for (const k of activeKeys()) patchLoop(k, { ...flat }, true);
  for (const k of activeKeys()) { const L = loops[k]; for (const q of LOOP_SMOOTH) L.cur[q] = L.tgt[q]; mirrorCut(k); }
  // Just loop A on screen, and nothing fed anywhere
  for (const q of MIX_SLIDERS) { mix.tgt[q] = 0; mix.cur[q] = 0; }
  mix.tgt.showA = mix.cur.showA = 100;
  mix.base = { ...mix.tgt };
  ADJ_SRC.forEach((x) => { adj[x] = adjDefaults(); });
  syncAdjUI();
  setGrade(GRADE_DEF);
  setRelief(RELIEF_DEF);
  Object.values(LIVE_SRC).forEach((x) => { x.hold = false; });
  $$('.hold-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  clearTargets();
  setEdit('A');
  settleDevices();
  syncUI();
  showOSD('NEUTRAL', (SRC_LABEL[src] || 'Nothing').toUpperCase());
  toast('Neutral: just the input, with every effect off. Raise Trails to bring the feedback back, then try Zoom and Spin.');
}
$('#neutral').addEventListener('click', neutral);

/* ================= autopilot ================= */
// Every half minute or so (New look every, under Autopilot settings) the hidden loop gets a new look, then the
// view glides over to it, sometimes resting on both loops at once. The loop on screen keeps drifting in between.
// Pinned settings stay where they are while Autopilot changes everything else. A pin holds its setting on the
// loop being edited only; right-click it (or press and hold it on a touchscreen) to hold it on both loops at once.
// prep: the next look being tried out of sight (Check each look); glide: a look changed in place, waiting to be
// looked at; rush: bring the next look as soon as one is ready (Next look, or the white-out watch)
const ap = { due: 0, span: 1, on: false, next: 0, quick: 0, beatWait: null, pins: new Set(), pinVal: {}, picIn: 0, prep: null, glide: null, glideRedo: 0, rush: false };
// What each pin holds. Pinning the main input keeps its pattern and Only movement too; pinning Zoom keeps its edges.
const PINS = {
  in1: { name: 'Main input', fields: ['in1', 'form', 'specRound', 'motion'] },
  in2: { name: 'Second input', fields: ['in2'] },
  blend: { name: 'Blend', fields: ['blend'] },
  size: { name: 'Input size', fields: ['size'] },
  zoom: { name: 'Zoom', fields: ['zoom', 'edge'] },
  spin: { name: 'Spin', fields: ['spin'] },
  trails: { name: 'Trails', fields: ['trails'] },
  color: { name: 'Color shift', fields: ['color'] },
  warp: { name: 'Warp', fields: ['warp'] },
  flow: { name: 'Flow', fields: ['flow'] },
  melt: { name: 'Melt', fields: ['melt'] },
  push: { name: 'Pushed by the other loop', fields: ['push'] },
  dye: { name: 'Dyed by the other loop', fields: ['dye'] },
  mirror: { name: 'Mirror', fields: ['mirror'] },
  split: { name: 'Split lines', fields: ['split'] },
  grow: { name: 'Grow', fields: ['grow', 'growSize'] },
  time: { name: 'Time warp', fields: ['time', 'timeShape'] },
  lookup: { name: 'Look-up', fields: ['lookup'] },
  chase: { name: 'Chase', fields: ['chase'] },
  breathe: { name: 'Breathe', fields: ['breathe'] },
  chroma: { name: 'Color chase', fields: ['chroma'] },
  restless: { name: 'Restless', fields: ['restless'] },
  julia: { name: 'Fractal fold', fields: ['julia'] },
  crystal: { name: 'Crystal', fields: ['crystal'] },
  // The Show A and Show B faders together (one pin, on either fader, holds both)
  view: { name: 'Show A and B', fields: ['showA', 'showB'], mix: true },
  xab: { name: 'Feed A into B', fields: ['xab'], mix: true },
  xba: { name: 'Feed B into A', fields: ['xba'], mix: true },
  xc: { name: 'Feed into C', fields: ['xc'], mix: true },
  xd: { name: 'Feed into D', fields: ['xd'], mix: true },
};
// Fader limits (the Fader limits button under Autopilot settings): the lowest and highest Autopilot may put each
// slider at, the same on both loops. They are limits only. Autopilot never changes them, and never parks a slider
// on one: a value it picks inside the range stays as it is, and one outside gets a fresh value from somewhere
// inside it. Sliders moved by hand, and pinned ones, aren't limited. Kept as { trails: [40, 90], ... }, listing
// only the sliders whose range is narrowed.
const LIM_LOOP = ['blend', 'size', 'zoom', 'spin', 'trails', 'color', 'warp', 'flow', 'melt', 'push', 'dye', 'grow', 'mirror', 'split', 'time', ...SELF];
const LIM_MIX = ['view', 'xab', 'xba'];
const limScale = (k) => (k === 'zoom' || k === 'spin' ? [-100, 100] : k === 'mirror' ? [0, 8] : [0, 100]);
// Mirror has only five stops (Off, 2, 4, 6, 8), so its limits move two at a time, and both of its handles are
// stops Autopilot may use: lowest 2 and highest 6 means 2, 4 or 6
const limGrain = (k) => (k === 'mirror' ? 2 : 1);
const limSnap = (k, v) => { const g = limGrain(k); return Math.round(v / g) * g; };
function cleanLim(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const k of [...LIM_LOOP, ...LIM_MIX]) {
    const r = v[k];
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite)) continue;
    const [a, b] = limScale(k);
    let lo = clamp(limSnap(k, r[0]), a, b), hi = clamp(limSnap(k, r[1]), a, b);
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo > a || hi < b) out[k] = [lo, hi];
  }
  return out;
}
// The part of slider k's range Autopilot may actually use. A handle you've moved is a limit, so Autopilot stays
// just inside it rather than on it; a handle left at the slider's end (Off, say) can still be used.
function limSpan(k) {
  const r = apSet.lim[k];
  if (!r) return null;
  const [a, b] = limScale(k);
  let [lo, hi] = r;
  if (limGrain(k) === 1 && hi - lo >= 2) { if (lo > a) lo++; if (hi < b) hi--; }
  return [lo, hi];
}
// A value Autopilot wants for slider k, kept inside its limits: as it is when it fits, otherwise a fresh value
// from anywhere inside the range (so it doesn't pile up on the edge). Mirror gets one of its stops in the range,
// each as likely as the others.
function inLim(k, v) {
  const r = limSpan(k);
  if (!r || (v >= r[0] && v <= r[1])) return v;
  const g = limGrain(k);
  if (g > 1) return r[0] + g * Math.floor(Math.random() * ((r[1] - r[0]) / g + 1));
  return Math.round(rnd(r[0], r[1]));
}
// The gentle version, for when a range is narrowed (or Autopilot starts) with the picture already running:
// a value outside moves just inside the nearer edge, instead of jumping across the range (Mirror, with only its
// five stops, goes to the nearer one it's allowed)
function nearLim(k, v) {
  const r = limSpan(k);
  if (!r || (v >= r[0] && v <= r[1])) return v;
  if (limGrain(k) > 1) return v < r[0] ? r[0] : r[1];
  const step = rnd(0, 0.15) * (r[1] - r[0]);
  return Math.round(v < r[0] ? r[0] + step : r[1] - step);
}
// A small move that stays inside both the move's own bounds and the limits, bouncing off an edge rather than
// sticking to it. When the two don't overlap, the limits win.
function limStep(k, v, a, b) {
  const r = limSpan(k);
  if (!r) return Math.round(clamp(v, a, b));
  let lo = Math.max(a, r[0]), hi = Math.min(b, r[1]);
  if (lo > hi) [lo, hi] = r;
  if (v > hi) v = hi - (v - hi);
  if (v < lo) v = lo + (lo - v);
  return Math.round(clamp(v, lo, hi));
}
// Autopilot settings, kept in this browser. Sliders run 0-100; every and fade map to seconds below.
const AP_KEY = 'phosphor-autopilot-v1';
// Each kind of input Autopilot can bring in, and its toggle under Autopilot settings (all 3D worlds share one,
// and all the fractals another)
const AP_INPUTS = [['wave', 'Wave'], ['shape', 'Shape'], ['bars', 'Bars'], ['sparks', 'Sparks'], ['ink', 'Ink'], ['patchwork', 'Patchwork'], ['text', 'Text'], ['spectro', 'Spectrograph'],
  ['world', '3D worlds'], ['fractal', 'Fractals'], ['picture', 'Picture'], ['video', 'Video'], ['camera', 'Camera'], ['screen', 'Screen'], ['phone', 'Phone'], ['loop', 'Other loop']];
const AP_INPUT_KEYS = AP_INPUTS.map(([k]) => k);
const cleanOff = (v) => (Array.isArray(v) ? [...new Set(v.filter((k) => AP_INPUT_KEYS.includes(k)))].slice(0, AP_INPUT_KEYS.length - 1) : []);
const AP_DEFAULTS = { every: 44, fade: 63, wild: 50, mix: 50, taste: 50, beat: false, check: true, hints: true, fsKeep: false, touch: 'pin', off: [],
  runs: ['A', 'B', 'C', 'D'], turns: true };
// Loops Autopilot runs (under Autopilot, "Loops Autopilot runs"): at least one of A to D. The others are yours:
// Autopilot never changes them, and moving their controls neither pins anything nor stops it.
// Turns: with more than one loop to run, one gets a new look each time (taking turns) rather than all at once.
const cleanRuns = (v) => { const r = Array.isArray(v) ? KEYS.filter((k) => v.includes(k)) : []; return r.length ? r : [...AP_DEFAULTS.runs]; };
// When you move a control while Autopilot runs: pin it ('pin'), just play along without pinning ('play'), or stop
// Autopilot ('stop')
const cleanTouch = (v) => (v === 'stop' || v === 'play' ? v : 'pin');
const apSet = { ...AP_DEFAULTS, runs: [...AP_DEFAULTS.runs], lim: {}, weights: {} };
// How often Autopilot brings each input in, set by right-clicking its switch: Off, Rarely, Less, Normal, More or Lots
// (the pie on the switch shows which). 3D worlds and Fractals have one for the group, which is how often one of them
// comes up at all, and one for each world and fractal, which decides which one it is; a world or fractal can also be
// switched Off on its own (kept as "sc:" plus its name, since the world called Fractal shares its name with the
// Fractals group). Only the ones that aren't Normal are kept.
const AP_LEVELS = [
  { w: 0, name: 'Off', pie: 0, say: 'never' },
  { w: 0.25, name: 'Rarely', pie: 0.125, say: 'a quarter as often as normal' },
  { w: 0.5, name: 'Less', pie: 0.25, say: 'half as often as normal' },
  { w: 1, name: 'Normal', pie: 0.5, say: 'as often as the rest' },
  { w: 2, name: 'More', pie: 0.75, say: 'twice as often as normal' },
  { w: 4, name: 'Lots', pie: 1, say: 'four times as often as normal' }];
function cleanWeights(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, w] of Object.entries(v)) {
    const member = k.startsWith('sc:') && !!SCENES[k.slice(3)];
    if (!(member || AP_INPUT_KEYS.includes(k)) || !AP_LEVELS.some((l) => l.w === w) || w === 1 || (w === 0 && !member)) continue;
    out[k] = w;
  }
  return out;
}
const apW = (k) => apSet.weights[k] ?? 1;
// One world's or fractal's own weight
const mW = (name) => apW('sc:' + name);
// The How often menu (see openWeights) and what it calls each input and level
const wpop = $('#wpop');
let wpKey = null, wpAnchor = null, wpReturn = null;
const AP_LABEL = Object.fromEntries(AP_INPUTS);
const isMemberKey = (k) => typeof k === 'string' && k.startsWith('sc:');
const wName = (k) => (isMemberKey(k) ? SCENES[k.slice(3)].label : AP_LABEL[k] || k);
const GROUP_SAY = { world: '3D worlds', fractal: 'fractals' };
const levelOf = (w) => AP_LEVELS.find((l) => l.w === w) || AP_LEVELS[3];
try {
  const s = JSON.parse(localStorage.getItem(AP_KEY) || 'null');
  if (s && typeof s === 'object') {
    for (const k of ['every', 'fade', 'wild', 'mix', 'taste']) if (Number.isFinite(s[k])) apSet[k] = clamp(Math.round(s[k]), 0, 100);
    apSet.beat = s.beat === true;
    apSet.check = s.check !== false;
    apSet.hints = s.hints !== false;
    apSet.fsKeep = s.fsKeep === true;
    apSet.touch = cleanTouch(s.touch);
    apSet.runs = cleanRuns(s.runs);
    apSet.turns = s.turns !== false;
    apSet.off = cleanOff(s.off);
    apSet.lim = cleanLim(s.lim);
    apSet.weights = cleanWeights(s.weights);
    if (Array.isArray(s.pins)) s.pins.forEach(addSavedPin);
  }
} catch (_) {}
// Whether Autopilot may bring in this input (one switched off under Autopilot settings stays out)
const apAllowed = (src) => !apSet.off.includes(sceneGroup(src) || src) && !(is3D(src) && mW(src) === 0);
function saveAp() {
  try { localStorage.setItem(AP_KEY, JSON.stringify({ ...apSet, pins: [...ap.pins] })); } catch (_) {}
}
const apEverySec = () => 10 * Math.pow(12, apSet.every / 100);   // 10 seconds to 2 minutes; 30 by default
const apFadeSec = () => 1.5 * Math.pow(20, apSet.fade / 100);    // 1.5 to 30 seconds; 10 by default
// Each pin has a name: a setting under Mix the two loops is just its own ("view"); a loop's setting also says
// which loop it holds: "zoom@A", "zoom@B", or "zoom@both" for one pinned on both loops with a right-click.
function pinParse(id) {
  const [key, where] = String(id).split('@');
  return { key, where: where || null };
}
// Whether a setting is pinned on loop L, on its own or on both loops (the Mix settings belong to both anyway)
function isPinned(key, L) {
  const P = PINS[key];
  if (!P) return false;
  if (P.mix) return ap.pins.has(key);
  return ap.pins.has(`${key}@${L}`) || ((L === 'A' || L === 'B') && ap.pins.has(`${key}@both`));
}
function pinnedBoth(key) { return !!PINS[key] && !PINS[key].mix && ap.pins.has(`${key}@both`); }
// Pins saved before pins were per loop held their setting on both loops, so they still do
function addSavedPin(id) {
  const { key, where } = pinParse(id);
  const P = PINS[key];
  if (!P) return;
  if (P.mix) { if (!where) ap.pins.add(key); return; }
  if (!where || where === 'both') ap.pins.add(`${key}@both`);
  else if (KEYS.includes(where)) ap.pins.add(`${key}@${where}`);
}
function unpinKey(key, where) { const id = `${key}@${where}`; ap.pins.delete(id); delete ap.pinVal[id]; }
const pinned = (k, L) => ap.on && isPinned(k, L);
// Whether Autopilot runs loop k (it has to be switched on under Loops as well)
const apRuns = (k) => loopOn(k) && apSet.runs.includes(k);
const apMine = () => activeKeys().filter(apRuns);
// Autopilot swaps loops A and B (a new look out of sight, then fading over) only when it runs both of them
const apPair = () => apRuns('A') && apRuns('B');
// Whether a fader under Loops is Autopilot's: the A and B Show faders when it runs both A and B, a Feed when it
// runs the loop being fed. The C and D Show faders are always yours.
function apOwnsMix(p) {
  if (p === 'view' || p === 'showA' || p === 'showB') return apPair();
  if (p in FEED_TO) return apRuns(FEED_TO[p]);
  return false;
}
// Who a control belongs to while Autopilot runs: loop k's setting, or a fader under Loops
// Posterize is always yours: Autopilot never changes it
const apOwns = (key, k) => (key === 'poster' ? false : key === 'view' || MIX_SLIDERS.includes(key) ? apOwnsMix(key) : apRuns(k));

/* ================= autopilot's eye ================= */
// While Autopilot runs it keeps an eye on the picture. Every few hundredths of a second a tiny 64 x 36 copy is
// made of the picture on screen, or of loop A or B on its own, and the graphics chip hands it over a frame or two
// later. Nothing ever stops to wait for it, so it can't make the picture stutter. (Making and collecting the
// copies is in eyeTick, next to frame.) Each copy is boiled down to a few numbers: how much of it is near white,
// how much is lit at all, how much detail it has, how colorful it is and how fast it's changing.
// Check each look and the white-out watch, below, decide what to do with them.
const EYE_W = 64, EYE_H = 36;
const eye = { tgt: null, prog: null, pbo: null, sync: null, failed: false, key: '', gen: { A: 0, B: 0, comp: 0 }, askGen: 0, askLook: 0, wantUntil: 0,
  askT: 0, age: 0, turn: 0, buf: new Uint8Array(EYE_W * EYE_H * 4), last: {}, hist: { A: [], B: [], comp: [] } };
// A picture that has just been wiped or given a whole new look starts with a clean slate (a copy already on its
// way of what was there before is thrown away when it arrives)
function eyeForget(key) { delete eye.last[key]; eye.hist[key] = []; eye.gen[key]++; }
function eyeReset() { for (const key of ['A', 'B', 'comp']) eyeForget(key); }
const eyeAvg = (S, f) => S.reduce((a, s) => a + s[f], 0) / S.length;
const eyeRecent = (key, ms, now) => eye.hist[key].filter((s) => now - s.t <= ms);
// The numbers for one tiny copy: how much is near white, how much is lit, detail, edges, shades and color
function eyeMeasure(b) {
  const W = EYE_W, H = EYE_H, n = W * H;
  const lum = new Float32Array(n), hue = new Float32Array(12);
  let sum = 0, white = 0, lit = 0, colorful = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = b[i] / 255, g = b[i + 1] / 255, bl = b[i + 2] / 255;
    const l = 0.299 * r + 0.587 * g + 0.114 * bl;
    lum[p] = l;
    sum += l;
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
    if (mn > 0.8) white++;          // near white: every color turned right up
    if (mx > 0.08) lit++;
    if (mx > 0.15 && mx - mn > 0.3 * mx) {
      const d = mx - mn;
      const h = mx === r ? (g - bl) / d : mx === g ? 2 + (bl - r) / d : 4 + (r - g) / d;
      hue[Math.floor(((h / 6 + 1) % 1) * 12) % 12]++;
      colorful++;
    }
  }
  // Detail: how much neighbouring spots differ, side by side and a few spots apart; and how much of the picture
  // is busy with edges (a single thin outline on black has sharp edges, but only a few of them)
  let fine = 0, coarse = 0, nf = 0, nc = 0, busy = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      let g = 0;
      if (x + 1 < W) { const d = Math.abs(lum[p] - lum[p + 1]); fine += d; nf++; g += d; }
      if (y + 1 < H) { const d = Math.abs(lum[p] - lum[p + W]); fine += d; nf++; g += d; }
      if (x + 4 < W) { coarse += Math.abs(lum[p] - lum[p + 4]); nc++; }
      if (y + 4 < H) { coarse += Math.abs(lum[p] - lum[p + 4 * W]); nc++; }
      if (g > 0.06) busy++;
    }
  }
  // Shades: how evenly the picture spreads over sixteen steps from black to white (0 for one flat shade)
  const steps = new Float32Array(16);
  for (let p = 0; p < n; p++) steps[Math.min(15, Math.floor(lum[p] * 16))]++;
  let shades = 0;
  for (const c of steps) if (c > 0) { const q = c / n; shades -= q * Math.log(q); }
  shades /= Math.log(16);
  // Color: how much of it is colorful, and how evenly that spreads over twelve hues (1 for all of them alike)
  let ent = 0;
  for (const c of hue) if (c > 0) { const q = c / colorful; ent -= q * Math.log(q); }
  const variety = colorful ? ent / Math.log(12) : 0;
  return { lum, mean: sum / n, white: white / n, lit: lit / n, detail: (fine / nf + coarse / nc) / 2, busy: busy / n, shades,
    colorful: colorful / n, variety };
}
function eyeStats(key, b, t) {
  const m = eyeMeasure(b), lum = m.lum, n = EYE_W * EYE_H;
  // Movement: how much it has changed since the last copy of the same picture, per second
  const prev = eye.last[key];
  let motion = null;
  if (prev && t - prev.t > 15 && t - prev.t < 1500) {
    let d = 0;
    for (let p = 0; p < n; p++) d += Math.abs(lum[p] - prev.lum[p]);
    motion = d / n / ((t - prev.t) / 1000);
  }
  eye.last[key] = { lum, rgb: b.slice(0), t };
  const s = { t, mean: m.mean, white: m.white, lit: m.lit, detail: m.detail, busy: m.busy, shades: m.shades,
    colorful: m.colorful, variety: m.variety, motion };
  const h = eye.hist[key];
  h.push(s);
  while (h.length > 1 && t - h[0].t > 8000) h.shift();
  return s;
}

// What Check each look makes of a picture, from its copies over a few seconds. A picture fails if it's going
// white, nearly black all over, plain (a lone outline or a glow on black: few edges and few shades) or frozen.
// One that passes gets a score for how rich it is: edges all over, a full range of shades, fine detail,
// movement and plenty of color. (Tuned by trying hundreds of Autopilot's looks and picking out the dull ones.)
const LOOK = { white: 0.12, mean: 0.62, rise: 0.035, lit: 0.15, busy: 0.25, shades: 0.45, flat: 0.02, still: 0.01,
  busyRich: 0.6, shadesRich: 0.8, rich: 0.1, lively: 0.12 };
function lookVerdict(S) {
  const last = S[S.length - 1], first = S[0];
  const span = (last.t - first.t) / 1000;
  const rise = span > 0.6 ? (last.white - first.white) / span : 0;
  const white = Math.max(eyeAvg(S, 'white'), last.white), mean = Math.max(eyeAvg(S, 'mean'), last.mean);
  const moving = S.filter((s) => s.motion != null);
  const motion = moving.length ? eyeAvg(moving, 'motion') : null;
  const detail = eyeAvg(S, 'detail'), lit = eyeAvg(S, 'lit'), busy = eyeAvg(S, 'busy'), shades = eyeAvg(S, 'shades');
  const color = Math.min(1, eyeAvg(S, 'colorful') * 2.5) * (0.35 + 0.65 * eyeAvg(S, 'variety'));
  let why = '';
  if (white > LOOK.white || mean > LOOK.mean || (last.white > 0.03 && rise > LOOK.rise)) why = 'white';
  else if (lit < LOOK.lit) why = 'dark';
  else if (busy < LOOK.busy || shades < LOOK.shades || detail < LOOK.flat) why = 'plain';
  else if (motion != null && motion < LOOK.still) why = 'still';
  const score = 0.3 * Math.min(1, busy / LOOK.busyRich) + 0.2 * Math.min(1, shades / LOOK.shadesRich) +
    0.15 * Math.min(1, detail / LOOK.rich) + 0.15 * Math.min(1, (motion ?? LOOK.lively) / LOOK.lively) + 0.2 * color;
  return { pass: !why, why, score, white, mean, lit, detail, busy, shades, motion, color };
}
// Which of two tried looks to keep: one that passed beats one that didn't, anything beats going white,
// and otherwise the richer one
function betterLook(a, b) {
  if (!b) return true;
  if (!a) return false;
  if (a.pass !== b.pass) return a.pass;
  if (!a.pass && (a.why === 'white') !== (b.why === 'white')) return b.why === 'white';
  return a.score > b.score;
}

/* ================= check each look ================= */
// With Check each look on (under Autopilot settings), the next look is tried out on the hidden loop, out of
// sight, starting about 14 seconds before it's due. After about 3 seconds Autopilot looks at it. One that's
// going white, nearly black, plain or frozen is thrown away and another tried, up to six in all; one that passes
// but is a bit plain gets another try or two while there's time; and the richest one seen is kept. The view
// only fades over once a look has passed (or, if none of the six did, to the best of them). Next look rushes
// it: quicker tries, and the first look that passes goes on.
// It works whenever Autopilot swaps a hidden loop in. With What you see pinned or limited, the loops change in
// place instead, so each look is looked at once it's on screen and a poor one is followed by another soon after.
const CHECK = { tries: 6, settle: 1.5, judge: 3.5, rushSettle: 0.7, rushJudge: 2, lead: 14, hold: 8, great: 0.75 };
const checking = () => apSet.check && !eye.failed;
// A tally of how the checks have gone since this page opened: every look judged, how many passed, how many passed
// on the very first try, and why the others didn't
const checkStat = { n: 0, ok: 0, first: 0, firstOk: 0, why: { white: 0, dark: 0, plain: 0, still: 0 } };
function checkTally(v, firstTry) {
  checkStat.n++;
  if (v.pass) checkStat.ok++;
  else if (v.why in checkStat.why) checkStat.why[v.why]++;
  if (firstTry) { checkStat.first++; if (v.pass) checkStat.firstOk++; }
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–');
function checkStatText() {
  const c = checkStat;
  if (!c.n) return 'Nothing judged yet since this page opened. It counts while Autopilot runs with Check each look on.';
  const bad = Object.entries(c.why).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${n} ${w === 'white' ? 'turning white' : w === 'dark' ? 'nearly black' : w === 'plain' ? 'dull' : 'frozen'}`);
  return `Since this page opened: ${c.n} look${c.n === 1 ? '' : 's'} judged, ${c.ok} passed (${pct(c.ok, c.n)}). ${c.firstOk} of ${c.first} passed on the first try (${pct(c.firstOk, c.first)}).` + (bad.length ? ` Thrown away: ${bad.join(', ')}.` : '');
}
const canTryOut = () => !ap.pins.has('view') && !limSpan('view');
function prepBegin(k, now, rush) {
  ap.prep = { k, since: now, tries: 0, rush: !!rush, ok: false, best: null, look: null, v: null, hold: 0 };
  prepTry(now);
}
function prepTry(now) {
  const P = ap.prep;
  freshLook(P.k, otherLoop(P.k));
  P.look = JSON.parse(JSON.stringify(loops[P.k].tgt));
  P.favMix = loops[P.k].favMix;
  P.since = now;
  P.tries++;
  P.v = null;
  if (edit === P.k) syncUI();
  apStatus();
}
// Puts back a look tried earlier (the best one), from a clean slate
function prepRestore(look, now, favMix) {
  const P = ap.prep, L = loops[P.k];
  patchLoop(P.k, look, true);
  L.favMix = favMix || null;
  for (const q of LOOP_SMOOTH) L.cur[q] = L.tgt[q];
  clearLoop(P.k);
  eyeForget(P.k);
  P.look = look;
  P.since = now;
  if (edit === P.k) syncUI();
}
// A new copy of the look being tried out has arrived
function prepJudge(now) {
  const P = ap.prep;
  if (P.ok) {
    // Passed and waiting its turn. If it starts going white after all, it's thrown away and another tried.
    const S = eyeRecent(P.k, 1500, now);
    if (S.length < 3 || P.tries >= CHECK.tries) return;
    const v = lookVerdict(S);
    if (v.why !== 'white') return;
    if (P.best && P.best.look === P.look) P.best = { v, look: P.look };
    P.ok = false;
    prepTry(now);
    return;
  }
  const age = (now - P.since) / 1000;
  if (age < (P.rush ? CHECK.rushJudge : CHECK.judge)) return;
  const from = P.since + 1000 * (P.rush ? CHECK.rushSettle : CHECK.settle);
  const S = eye.hist[P.k].filter((s) => s.t >= from);
  if (S.length < 3 && age < 8) return;   // a few copies are needed to judge it
  if (!S.length) { P.ok = true; return; }   // nothing to go on (very slow graphics): don't hold Autopilot up
  const v = tasteJudge(lookVerdict(S), P.k, P.look, S);
  P.v = v;
  checkTally(v, P.tries === 1);
  if (betterLook(v, P.best && P.best.v)) P.best = { v, look: P.look, favMix: P.favMix };
  const left = (ap.next - now) / 1000;
  const great = v.pass && v.score >= CHECK.great;
  const more = !great && P.tries < CHECK.tries && (P.best.v.pass ? !P.rush && left > CHECK.judge + 0.5 : true);
  if (more) { prepTry(now); return; }
  if (P.best.look !== P.look) prepRestore(P.best.look, now, P.best.favMix);
  P.v = P.best.v;
  P.ok = true;
  apStatus();
}
// Autopilot wants to bring the hidden loop k in. Returns true once its look has been checked; until then the
// hidden loop keeps trying (starting now if it hadn't begun), for up to 8 seconds past when it was due (about 5
// when rushed), after which the best look seen so far goes on.
function prepReady(k, now, rush) {
  let P = ap.prep;
  if (!P || P.k !== k) { prepBegin(k, now, rush); P = ap.prep; }
  if (rush) P.rush = true;
  if (!P.hold) P.hold = now;
  if (!P.ok && now - P.hold > CHECK.hold * 1000 * (P.rush ? 0.6 : 1)) {
    if (P.best && P.best.look !== P.look && betterLook(P.best.v, P.v)) prepRestore(P.best.look, now, P.best.favMix);
    P.ok = true;
  }
  if (!P.ok) return false;
  ap.prep = null;
  return true;
}
// With What you see pinned or limited, a look changed in place is looked at once it has faded in; a poor one
// (going white, nearly black, plain or frozen) brings the next look in a second or so, up to three times running
function glideJudge(now) {
  const k = ap.glide.k;
  ap.glide = null;
  const S = eyeRecent(k, 2500, now);
  if (S.length < 2) return;
  const v = lookVerdict(S);
  checkTally(v, ap.glideRedo === 0);
  if (!v.pass && ap.glideRedo < 3) { ap.glideRedo++; ap.next = Math.min(ap.next, now + 1200); ap.due = Math.min(ap.due, ap.next); }
  else ap.glideRedo = 0;
}
// How much of the screen would be near white with both loops showing at once (on screen they add up, like two
// projectors on one wall), from the latest copies of each. 0 when there's no copy of one of them yet.
function overlayWhite(a, b) {
  const A = eye.last[a], B = eye.last[b];
  if (!A || !B) return 0;
  const x = A.rgb, y = B.rgb;
  let w = 0;
  for (let i = 0; i < x.length; i += 4) {
    let mn = 1;
    for (let c = 0; c < 3; c++) mn = Math.min(mn, 1 - (1 - x[i + c] / 255) * (1 - y[i + c] / 255));
    if (mn > 0.8) w++;
  }
  return w / (x.length / 4);
}

/* ================= white-out watch ================= */
// While Autopilot runs, the picture on screen is kept from washing out to white, whether or not Check each look
// is on. Nothing is dimmed or held back. When too much of the screen is near white (or it's heading there fast),
// Autopilot turns its own sliders down a notch on the loop that's doing it, the way a person would: Trails first,
// then the other loop pouring in, Grow, and a big picture's size; a notch at a time until it's clear. If both loops
// together are what's white, it shows just one of them. Still white after 4 seconds: on to the next look. Solid
// white after 8: that loop is wiped clean. Pinned sliders stay where they are, and nothing goes past its fader
// limits. When you steer by hand (Autopilot off) it does nothing at all.
const WATCH = { white: 0.16, mean: 0.68, rise: 0.08, step: 1.2, next: 4, wipe: 8 };
const watch = { hot: 0, cool: 0, stepT: 0, easing: '', easeT: 0, skipped: false };
// Turns loop k's own settings down a notch. Says whether there was anything left to turn down.
function coolLoop(k) {
  const t = loops[k].tgt, R = loops[k].ramp;
  let did = false;
  // Lowered, but never below a fader limit. A setting that's building up (3D worlds and fractals) has its peak
  // lowered to match, so the build-up doesn't put it back.
  const lower = (obj, key, v, pin) => {
    if (pin) return;
    const r = limSpan(key);
    v = Math.round(r ? Math.max(v, r[0]) : v);
    if (v < obj[key]) {
      const rk = R && (obj === t ? R.keys[key] : R.feed && R.feed.key === key ? R.feed : null);
      if (rk) rk.full = Math.max(rk.clean, Math.min(rk.full, rk.clean + (v - rk.clean) / Math.max(R.a, 0.25)));
      obj[key] = v;
      did = true;
    }
  };
  if (t.trails > 45) lower(t, 'trails', Math.max(45, t.trails - 6), isPinned('trails', k));
  const feed = FEED_INTO[k];
  if (mix.tgt[feed] > 4 && apOwnsMix(feed)) lower(mix.tgt, feed, mix.tgt[feed] * 0.6, ap.pins.has(feed));
  if (t.grow > 30) lower(t, 'grow', t.grow - 12, isPinned('grow', k));
  if (IMAGE_INPUTS.includes(t.in1) && t.size > 40) lower(t, 'size', Math.max(40, t.size - 8), isPinned('size', k));
  return did;
}
function whiteWatch(now, dt, wA, wB) {
  // The last second or so (or the last copy, on a slow computer)
  let S = eyeRecent('comp', 1000, now);
  if (!S.length) S = eyeRecent('comp', 3000, now).slice(-1);
  if (!S.length) return;
  const white = eyeAvg(S, 'white'), mean = eyeAvg(S, 'mean');
  const first = S[0], last = S[S.length - 1], span = (last.t - first.t) / 1000;
  const rise = span > 0.3 ? (last.white - first.white) / span : 0;
  const darker = span > 0.3 && rise < -0.005 && last.mean < first.mean;
  const hot = white > WATCH.white || mean > WATCH.mean || (last.white > 0.06 && rise > WATCH.rise);
  if (watch.easing && now - watch.easeT > 2500) watch.easing = '';
  if (!hot) {
    watch.cool += dt;
    if (watch.cool > 1.5) { watch.hot = 0; watch.skipped = false; }
    return;
  }
  watch.cool = 0;
  watch.hot += dt;
  // Only Autopilot's own loops are turned down; a loop that's yours is left as you set it
  const shown = ['A', 'B'].filter((k) => (k === 'A' ? wA : wB) > 0.05 && apRuns(k));
  const own = (k) => { const R = eyeRecent(k, 3000, now); return R.length ? Math.max(eyeAvg(R, 'white'), R[R.length - 1].white) : null; };
  // A notch at a time, and none while it's already getting darker (sliders glide, so a change takes a moment to show)
  if (now - watch.stepT >= WATCH.step * 1000 && !darker) {
    watch.stepT = now;
    // The loops that are white on their own; if neither is, it's the two of them added together
    const culprits = shown.filter((k) => { const w = own(k); return w == null || w > WATCH.white * 0.6; });
    let did = false;
    if (shown.length === 2 && !culprits.length && !ap.pins.has('view') && apPair()) {
      const keep = (own('A') ?? 0) <= (own('B') ?? 0) ? 'A' : 'B';
      const to = limSpan('view') ? nearLim('view', keep === 'A' ? 0 : 100) : (keep === 'A' ? 0 : 100);
      if (to !== mix.tgt.view) { mix.tgt.view = to; did = true; }
    }
    for (const k of culprits.length ? culprits : shown) did = coolLoop(k) || did;
    if (did) {
      watch.easing = (culprits.length ? culprits : shown).join(' and ');
      watch.easeT = now;
      syncUI();
      apStatus();
    }
  }
  // Still white: on to the next look, as soon as one is ready
  if (watch.hot > WATCH.next && !watch.skipped) {
    watch.skipped = true;
    ap.rush = true;
    ap.next = Math.min(ap.next, now);
    ap.due = Math.min(ap.due, now);
  }
  // Solid white even so: wipe the loops that are white and let them build up again
  if (watch.hot > WATCH.wipe && last.mean > 0.85 && last.white > 0.6) {
    for (const k of shown) if ((own(k) ?? 1) > 0.5) { clearLoop(k); eyeForget(k); }
    eyeForget('comp');
    burst();
    watch.hot = 0;
  }
}

// Two Autopilot buttons: one at the top of Autopilot, and one in the row under the picture,
// which never folds away or hides, so it's always easy to find
const apBtns = [$('#autopilot'), $('#autopilotBar')].filter(Boolean);
function setAutopilot(on, quiet) {
  ap.on = on;
  ap.quick = 0;
  ap.beatWait = null;
  ap.prep = null;
  ap.glide = null;
  ap.glideRedo = 0;
  ap.rush = false;
  eyeReset();
  Object.assign(watch, { hot: 0, cool: 0, easing: '', skipped: false });
  document.documentElement.classList.toggle('ap-on', on);
  apBtns.forEach((b) => b.setAttribute('aria-pressed', String(on)));
  ap.turnN = 0;
  syncApLoops();
  if (on) {
    ap.next = performance.now() + Math.min(7000, apEverySec() * 1000);
    ap.due = ap.next;
    ap.span = ap.next - performance.now();
    ap.picIn = apPicGap();
    // Pinned settings start from what the sliders show now (a pin on both loops from the loop being edited)
    for (const id of ap.pins) holdPin(id, edit);
    // and anything outside the fader limits eases just inside them
    apIntoLimits();
    settleDevices();
    syncUI();
    if (!quiet) {
      showOSD('AUTOPILOT', 'ON');
      toast(apSet.touch === 'pin'
        ? 'Autopilot is on. Move any slider to pin it where you want it; Autopilot keeps changing the rest.'
        : apSet.touch === 'play'
          ? 'Autopilot is on. Play with any slider; nothing gets pinned and Autopilot keeps going.'
          : 'Autopilot is on. It changes a little at a time. Touch any control to take over.');
    }
  } else {
    for (const k of KEYS) loops[k].ramp = null;
    settleDevices();
    if (!quiet) showOSD('AUTOPILOT', 'OFF');
  }
  apStatus();
}
// Someone moved a control. With "Pin it, keep going" that setting is pinned where they put it and Autopilot
// carries on; with "Play along" the move simply takes effect, nothing is pinned, and Autopilot carries on (it
// changes that setting again with its next look); otherwise Autopilot stops. Buttons that replace the whole look
// (Surprise me, no key) stop Autopilot whichever is chosen. The new value is read just after the control has
// finished handling the move, which is why holdPin waits for a microtask.
function takeOver(key, from) {
  if (!ap.on) return;
  // A control that's yours (a loop Autopilot doesn't run, or a fader under Loops it doesn't use) is simply yours:
  // nothing is pinned and Autopilot keeps going
  if (key && !apOwns(key, from || edit)) return;
  key = pinKeyOf(key);
  if (key && PINS[key] && apSet.touch === 'play') { rampLet(key, from || edit); return; }
  if (key && PINS[key] && apSet.touch === 'pin') {
    const P = PINS[key], loopKey = from || edit, ab = loopKey === 'A' || loopKey === 'B';
    const fresh = !isPinned(key, loopKey);
    // Only the loop being changed gets pinned, unless this setting is already pinned on both loops
    const id = P.mix ? key : ab && pinnedBoth(key) ? `${key}@both` : `${key}@${loopKey}`;
    ap.pins.add(id);
    queueMicrotask(() => holdPin(id, loopKey));
    if (fresh) {
      queueMicrotask(() => tasteHintPin(key, loopKey));
      syncPins();
      saveAp();
      apStatus();
      toast(P.mix ? `Pinned ${P.name}. Autopilot keeps changing the rest. Tap its pin to let it go.`
        : `Pinned ${P.name} on loop ${loopKey}. Tap its pin to let it go${ab ? ', or right-click the pin to hold it on both loops' : ''}.`);
    }
    return;
  }
  setAutopilot(false, true);
  toast('Autopilot off. You’re steering now.');
}
apBtns.forEach((b) => b.addEventListener('click', () => setAutopilot(!ap.on)));
// Brings every slider Autopilot is in charge of (not pinned) inside its fader limits, gliding there
function apIntoLimits() {
  for (const k of apMine()) {
    const t = loops[k].tgt;
    for (const key of LIM_LOOP) if (!isPinned(key, k)) t[key] = nearLim(key, t[key]);
  }
  for (const key of LIM_MIX) if (!ap.pins.has(key) && apOwnsMix(key)) mix.tgt[key] = nearLim(key, mix.tgt[key]);
}
// Puts a new look for loop k inside the fader limits (pinned settings stay as they are)
function apLimit(sc, k) {
  const def = loopDefaults();
  for (const key of LIM_LOOP) {
    if (!apSet.lim[key] || isPinned(key, k)) continue;
    const v = sc[key] ?? def[key];
    const w = inLim(key, v);
    if (w !== v) sc[key] = w;
  }
  return sc;
}

// Holds a pinned setting where it is. A pin on one loop holds that loop's setting. A pin on both loops takes the
// setting from loop `from` and, while Autopilot runs, puts it on the other loop too, so it stays put whichever
// loop is on screen.
function holdPin(id, from) {
  if (!ap.pins.has(id)) return;
  const { key, where } = pinParse(id);
  const P = PINS[key];
  if (!P) return;
  const L = KEYS.includes(where) ? where : where === 'both' && from !== 'A' && from !== 'B' ? 'A' : from;
  const src = P.mix ? mix.tgt : loops[L].tgt;
  const v = {};
  for (const f of P.fields) v[f] = src[f];
  ap.pinVal[id] = v;
  if (where !== 'both' || !ap.on) return;
  // "The other loop's picture" means something different on each loop, so that input stays on its own loop
  if (key === 'in1' && v.in1 === 'loop') return;
  Object.assign(loops[L === 'A' ? 'B' : 'A'].tgt, v);
  if (key === 'in1' || key === 'in2') settleDevices();
}
// Puts the values pinned on loop k (or on both loops) into a new look for loop k
function withPins(sc, k, only) {
  for (const id of ap.pins) {
    const { key, where } = pinParse(id);
    const P = PINS[key];
    if (!P || P.mix || (where !== k && where !== 'both') || (only && !only.includes(key)) || !ap.pinVal[id]) continue;
    Object.assign(sc, ap.pinVal[id]);
  }
  return sc;
}
function pinsChanged() { syncPins(); saveAp(); apStatus(); }
// Tapping a pin: pins or frees the setting on the loop being edited only
function togglePin(key) {
  const P = PINS[key], name = P.name;
  if (P.mix) {
    if (ap.pins.has(key)) {
      ap.pins.delete(key);
      delete ap.pinVal[key];
      toast(ap.on ? `${name} is free again. Autopilot changes it from its next look.` : `${name} is no longer pinned.`);
    } else {
      ap.pins.add(key);
      holdPin(key, edit);
      tasteHintPin(key, edit);
      toast(ap.on ? `Pinned ${name}. Autopilot keeps changing the rest.` : `Pinned ${name}. Autopilot will leave it where it is.`);
    }
    pinsChanged();
    return;
  }
  const L = edit, other = L === 'A' ? 'B' : 'A', ab = L === 'A' || L === 'B';
  if (isPinned(key, L)) {
    // Freed on this loop only: a pin on both loops stays on the other one
    if (ab && pinnedBoth(key)) {
      const v = ap.pinVal[`${key}@both`];
      unpinKey(key, 'both');
      ap.pins.add(`${key}@${other}`);
      if (v) ap.pinVal[`${key}@${other}`] = v; else holdPin(`${key}@${other}`, other);
    }
    unpinKey(key, L);
    toast(ap.on ? `${name} is free again on loop ${L}. Autopilot changes it there from its next look.` : `${name} is no longer pinned on loop ${L}.`);
  } else {
    ap.pins.add(`${key}@${L}`);
    holdPin(`${key}@${L}`, L);
    tasteHintPin(key, L);
    toast(`Pinned ${name} on loop ${L}.${ab ? ' Right-click the pin to hold it on both loops.' : ''}`);
  }
  pinsChanged();
}
// Right-clicking a pin (or pressing and holding it on a touchscreen): pins the setting on both loops, the same on
// each (taken from the loop being edited), or frees it on both if it's pinned on both already
function togglePinBoth(key) {
  const P = PINS[key], name = P.name;
  // Pins on both loops are for A and B; on loop C or D a right-click is the same as a tap
  if (P.mix || (edit !== 'A' && edit !== 'B')) { togglePin(key); return; }
  const wasBoth = pinnedBoth(key) || (isPinned(key, 'A') && isPinned(key, 'B'));
  for (const w of ['A', 'B', 'both']) unpinKey(key, w);
  if (wasBoth) {
    toast(ap.on ? `${name} is free again on both loops.` : `${name} is no longer pinned on either loop.`);
  } else {
    ap.pins.add(`${key}@both`);
    holdPin(`${key}@both`, edit);
    tasteHintPin(key, edit);
    toast(`Pinned ${name} on both loops, where loop ${edit} has it. Right-click the pin again to free both.`);
  }
  pinsChanged();
}
// A small pin beside each setting Autopilot can change. They show while Autopilot runs, and whenever one is pinned.
const PIN_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1h6v1.2L10 3v3.5L12.5 9v1.2H8.6V15H7.4v-4.8H3.5V9L6 6.5V3L5 2.2z" fill="currentColor"/></svg>';
for (const key of Object.keys(PINS)) for (const anchor of key === 'in1' ? [$('#in1Head')] : key === 'view' ? [$('#showA'), $('#showB')] : [$('#' + key)]) {
  const head = key === 'in1' ? anchor : anchor && anchor.closest('.ctl') && anchor.closest('.ctl').querySelector('.ctl-head');
  if (!head) continue;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pin';
  b.dataset.pin = key;
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-label', `Pin ${PINS[key].name}`);
  b.innerHTML = PIN_ICON + '<span class="pin-ab" aria-hidden="true">AB</span>';
  b.addEventListener('click', () => togglePin(key));
  // Right-click, or press and hold on a touchscreen: both loops
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); togglePinBoth(key); });
  head.insertBefore(b, head.querySelector('output'));
}
// The pins show the loop being edited: lit when the setting is pinned on it, and marked AB when it's pinned on both
function syncPins() {
  $$('.pin').forEach((b) => {
    const key = b.dataset.pin, P = PINS[key], name = P.name;
    const ab = edit === 'A' || edit === 'B';
    const on = isPinned(key, edit), both = !P.mix && ab && isPinned(key, 'A') && isPinned(key, 'B');
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('both', both);
    // A pin only shows on a setting Autopilot is in charge of (not on loops, or faders, that are yours)
    b.classList.toggle('not-ap', P.mix ? !apOwnsMix(key) : !apRuns(edit));
    b.setAttribute('aria-label', both ? `${name} is pinned on both loops` : `Pin ${name}${P.mix ? '' : ` on loop ${edit}`}`);
    b.title = P.mix
      ? (on ? `${name} is pinned: Autopilot leaves it alone. Tap to let Autopilot change it again.` : `Pin ${name}: Autopilot leaves it where it is`)
      : both ? `${name} is pinned on both loops. Tap to free it on loop ${edit} only; right-click to free it on both.`
      : on ? `${name} is pinned on loop ${edit}. Tap to let Autopilot change it again${ab ? '; right-click to pin it on both loops' : ''}.`
      : `Pin ${name} on loop ${edit}: Autopilot leaves it where it is.${ab ? ' Right-click to pin it on both loops.' : ''}`;
  });
  const names = [];
  for (const [key, P] of Object.entries(PINS)) {
    if (P.mix) { if (ap.pins.has(key)) names.push(P.name); continue; }
    const a = isPinned(key, 'A'), b = isPinned(key, 'B');
    if (a && b) names.push(`${P.name} (both loops)`);
    else if (a || b) names.push(`${P.name} (loop ${a ? 'A' : 'B'})`);
    for (const k of ['C', 'D']) if (isPinned(key, k)) names.push(`${P.name} (loop ${k})`);
  }
  $('#apPinList').textContent = names.length ? names.join(' · ')
    : `Nothing pinned. While Autopilot runs, a pin shows beside each setting. Tap it${apSet.touch === 'pin' ? ', or just move that slider,' : ''} to keep the setting where it is on the loop you’re changing. Right-click a pin to keep it on both loops.`;
  $('#apUnpin').hidden = !names.length;
}

// The inputs Autopilot can bring in right now, one chance each (apPick then makes the 3D worlds and fractals rarer)
function apPool() {
  const pool = ['wave', 'shape', 'bars', 'sparks', 'ink', 'patchwork', 'picture', 'text', ...allScenes()];
  // Using the other loop as an input is one more way of mixing the loops, so Mix turned right up gives it an extra chance
  if (apSet.mix > 10) pool.push('loop');
  if (apSet.mix > 75) pool.push('loop');
  if (vid.on || clipsReady()) pool.push('video');   // a clip from the clip library comes in when a look picks Video
  for (const src of ['camera', 'screen', 'phone']) if (liveActive(src)) pool.push(src);
  if (snd.analyser) pool.push('spectro');
  // Leave out the inputs switched off under Autopilot settings. If that leaves nothing it can use right now
  // (say only Camera is on, and no camera is running), it uses them all rather than stall.
  const ok = pool.filter(apAllowed);
  return ok.length ? ok : pool;
}
// Autopilot's pick of an input from a list. The 3D worlds and fractals as a showcase (clean, building up slowly, a
// longer stay: see rampStart) come up a tenth as often as they would with one chance each like the rest: with nine
// worlds and six fractals against eight other inputs, about 1 new look in 15 instead of 2 in 3. Fractals also come
// up as an ordinary input, all six together having the same chance as Wave or Shape, with effects and timing like
// any other look; then out.asInput is set, so the look gets no showcase.
// Each input's weight (right-click its switch) scales its chances: Rarely a quarter, Lots four times. For the 3D
// worlds and fractals, the group's weight scales how often one comes up at all (a group counts as many inputs as it
// has members, even with some switched off) and each member's weight decides which one it is.
const AP_WORLD_SHARE = 0.1;
function apOddsTable(list) {
  const rest = new Map(), members = { world: [], fractal: [] };
  for (const x of list) {
    if (is3D(x)) { const g = sceneGroup(x); if (mW(x) > 0 && !members[g].includes(x)) members[g].push(x); }
    else rest.set(x, (rest.get(x) || 0) + apW(x));
  }
  let R = 0;
  for (const w of rest.values()) R += w;
  if (members.fractal.length) rest.set('fractal-as-input', apW('fractal'));
  const show = {};
  let S3 = 0;
  for (const g of ['world', 'fractal']) {
    show[g] = members[g].length ? worldsOK().filter((n) => sceneGroup(n) === g).length * apW(g) : 0;
    S3 += show[g];
  }
  // The chance of a showcase: a tenth of what the 3D ones would get counted like the rest
  const p = S3 > 0 ? AP_WORLD_SHARE * S3 / (R + S3) : 0;
  return { rest: [...rest].filter(([, w]) => w > 0), members, show, S3, p };
}
function wpick(entries) {
  let tot = 0;
  for (const [, w] of entries) tot += w;
  if (!(tot > 0)) return entries.length ? pick(entries)[0] : null;
  let r = Math.random() * tot;
  for (const [k, w] of entries) { r -= w; if (r < 0) return k; }
  return entries[entries.length - 1][0];
}
const memberPick = (ms) => wpick(ms.map((x) => [x, mW(x)]));
function apPick(list, out) {
  const T = apOddsTable(list);
  if (T.S3 > 0 && (!T.rest.length || Math.random() < T.p)) return memberPick(T.members[wpick(Object.entries(T.show).filter(([, w]) => w > 0))]);
  if (!T.rest.length) return pick(list);
  let src = wpick(T.rest);
  if (src === 'fractal-as-input') {
    src = memberPick(T.members.fractal);
    if (out) out.asInput = true;
  }
  return src;
}
// Each input's share of Autopilot's picks right now (and each world's and fractal's), for the weights menu
function apShares() {
  const T = apOddsTable(apPool()), out = {};
  const p = T.rest.length ? T.p : (T.S3 > 0 ? 1 : 0);
  let RT = 0;
  for (const [, w] of T.rest) RT += w;
  const add = (k, v) => { out[k] = (out[k] || 0) + v; };
  const spread = (ms, q) => { let s = 0; for (const m of ms) s += mW(m); for (const m of ms) add('sc:' + m, q * mW(m) / s); };
  for (const [x, w] of T.rest) {
    const q = (1 - p) * w / RT;
    if (x === 'fractal-as-input') { add('fractal', q); spread(T.members.fractal, q); } else add(x, q);
  }
  for (const g of ['world', 'fractal']) if (T.show[g] > 0) { const q = p * T.show[g] / T.S3; add(g, q); spread(T.members[g], q); }
  return out;
}
// A real input (not the other loop's picture), for when both loops would only feed on each other
function apRealInput() {
  const p = apPool().filter((x) => x !== 'loop');
  return p.length ? apPick(p) : 'wave';
}
// A new look. How wild (w) stretches how far it zooms, spins and tints, and sets the odds of every setting changing
// (see apOdds and apSwitch).
// (k: the loop it's for, whose own pins it keeps)
// How wild sets Autopilot's odds, for every setting alike:
//  - apOdds: the chance each effect (Flow, Melt, Push, Dye, Split, Grow, Time warp, the seven feeds-on-itself
//    effects, and a second input) is on in a new look. 5% at 0, about half at the middle, 90% at the top. At the
//    middle each effect gets a new value in about 3 new looks in 4.
//  - apSwitch: the chance the input and the main sliders (Zoom, Spin, Trails, Color, Warp, mirror, softness,
//    pattern) get something new rather than staying as the loop on screen has them. 20% at 0, 80% at the middle,
//    every time from about 67 up.
const apOdds = (w) => Math.min(0.9, 0.05 + 0.85 * w);
const apSwitch = (w) => Math.min(1, 0.2 + 1.2 * w);
// Feeds on itself, for a new look: each of the seven on its own roll, somewhere in its own useful range
const SELF_RANGE = { lookup: [25, 80], chase: [35, 90], breathe: [35, 90], chroma: [25, 80], restless: [30, 85], julia: [35, 100], crystal: [30, 85] };
function apSelf(sc, w) {
  for (const key of SELF) {
    const [lo, hi] = SELF_RANGE[key];
    sc[key] = Math.random() < apOdds(w) ? Math.round(rnd(lo, lo + (hi - lo) * (0.4 + 0.6 * w))) : 0;
  }
}
// The other effects, each on its own roll, somewhere in its own useful range (How wild stretches how strong).
// One a starter look already has on stays as the starter has it.
const AP_FX = {
  flow: () => rnd(30, 80),
  melt: (w) => rnd(20, 20 + 80 * w),
  push: (w) => rnd(25, 25 + 60 * w),
  dye: (w) => rnd(20, 20 + 70 * w),
  split: (w) => rnd(10, 10 + 60 * w),
  grow: (w) => rnd(35, 35 + 55 * w),
  time: (w) => rnd(30, 30 + 70 * w),
};
function apFx(sc, w) {
  for (const [key, val] of Object.entries(AP_FX)) {
    if (sc[key] > 0) continue;
    sc[key] = Math.random() < apOdds(w) ? Math.round(val(w)) : 0;
  }
  if (sc.grow && sc.growSize == null) sc.growSize = Math.floor(Math.random() * 3);
  if (sc.time && sc.timeShape == null) sc.timeShape = Math.floor(Math.random() * 3);
}
// The look as Autopilot would make it without your taste (apScene, under Learn my taste, leans it your way)
const apMate = (k) => (k === 'A' ? 'B' : k === 'B' ? 'A' : k);
function apSceneRaw(k) {
  const pool = apPool(), w = apSet.wild / 100, sw = apSwitch(w);
  // The look it varies from, as Autopilot picked it: for A or B the loop on screen now (the new look goes on the
  // other one); loops C and D change in place, so they vary from their own look
  const mate = apMate(k), shown = rampLook(mate);
  // The input comes first: as How wild says, a new one (picked by apPick before anything else, so the starter looks
  // below can't tip it towards the inputs they happen to use) or the one on screen now
  const keepIn = Math.random() >= sw && shown.in1 !== 'loop' && pool.includes(shown.in1);
  const how = {};
  const in1 = keepIn ? shown.in1 : apPick(pool, how);
  const asInput = keepIn ? !!loops[mate].asInput : !!how.asInput;
  let sc;
  if (Math.random() < 0.45) {
    // Start from one of the starter looks and vary it: one made for this input when there is one
    const fits = STARTERS.flatMap((c) => [c.A, c.B]).filter((s) => s && s.in1 === in1);
    const c = pick(STARTERS), j = 2 * w;
    sc = { ...(fits.length ? pick(fits) : (c.B && Math.random() < 0.5) ? c.B : c.A) };
    sc.zoom = Math.round(clamp((sc.zoom ?? 0) + rnd(-12, 12) * j, -60, 80));
    sc.spin = Math.round(clamp((sc.spin ?? 0) + rnd(-15, 15) * j, -70, 70));
    sc.color = Math.round(clamp((sc.color ?? 10) + rnd(-6, 10) * j, 0, 30 + 30 * w));
    // A starter made for another input gives up its size too, so the new input gets one that suits it
    if (sc.in1 !== in1) { sc.in1 = in1; delete sc.size; }
    if (sc.in2 && !pool.includes(sc.in2)) sc.in2 = 'none';
  } else {
    const zoom = Math.round(Math.random() < 0.25 ? rnd(-(10 + 60 * w), -10) : Math.min(85, rnd(5, 15 + 90 * w)));
    sc = {
      in1, form: 2 + Math.floor(Math.random() * 4), zoom,
      spin: Math.round(rnd(-1, 1) * (10 + 70 * w)), trails: Math.round(rnd(84, 96)), color: Math.round(rnd(2, 8 + 48 * w)),
      warp: Math.round(Math.random() < 0.9 - 0.6 * w ? rnd(0, 5 + 20 * w) : rnd(15, 15 + 60 * w)),
      growSize: Math.floor(Math.random() * 3), timeShape: Math.floor(Math.random() * 3),
      mirror: pick([0, 0, 2, 4, 6, 8]), blur: +rnd(-0.05, 0.3).toFixed(2),
      edge: zoom < 0 && Math.random() < 0.6 ? 1 : 0,
    };
  }
  // Each effect, and a second input, on its own roll (see apOdds), on starter looks and new ones alike
  apFx(sc, w);
  if ((!sc.in2 || sc.in2 === 'none') && Math.random() < apOdds(w)) {
    const two = pool.filter((x) => x !== sc.in1);
    if (two.length) { sc.in2 = apPick(two); sc.blend = Math.round(rnd(30, 70)); }
  }
  apSelf(sc, w);
  // The main sliders: as How wild says, each one new or kept as the loop on screen has it
  for (const key of ['zoom', 'spin', 'trails', 'color', 'warp', 'mirror', 'blur', 'form']) {
    if (Math.random() >= sw && shown[key] != null) {
      sc[key] = shown[key];
      if (key === 'zoom') sc.edge = shown.edge;
    }
  }
  if (asInput) sc.asInput = true;
  return apFinish(sc, k);
}
// The last touches on a new look: pinned settings, and a size that suits its input. A look varied from one you
// liked (keep: its input) keeps its own size while the input is still the same one.
function apFinish(sc, k, keep) {
  // Pinned inputs go in first, so the size below suits the input really used
  withPins(sc, k, ['in1', 'in2']);
  if (sc.in2 && sc.in2 === sc.in1 && !isPinned('in2', k)) sc.in2 = 'none';
  if (!keep || keep !== sc.in1) {
    if (sc.in1 === 'loop') sc.size = Math.round(rnd(35, 60));
    if ((sc.in1 === 'bars' || sc.in1 === 'picture') && sc.size == null) sc.size = 50;
    if (sc.in1 === 'text') sc.size = Math.round(rnd(70, 100));
    if (sc.in1 === 'patchwork') sc.size = Math.round(rnd(55, 100));
    if (['camera', 'screen', 'phone', 'video'].includes(sc.in1)) {
      sc.size = Math.round(rnd(60, 100));
      if (!isPinned('in1', k)) sc.motion = Math.random() < 0.35;
    }
    if (sc.in1 === 'spectro' || sc.in2 === 'spectro') {
      if (!isPinned('in1', k)) sc.specRound = Math.random() < 0.5;
      if (sc.in1 === 'spectro') sc.size = Math.round(rnd(75, 100));
    }
  }
  withPins(sc, k);
  return sc;
}
function clearLoop(k) {
  gl.clearColor(0, 0, 0, 1);
  for (const t of loops[k].rt) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clear(gl.COLOR_BUFFER_BIT); }
  twForget(loops[k]);
}
function nudge(k) {
  const t = loops[k].tgt, j = 0.2 + 1.6 * apSet.wild / 100;
  // Each nudge stays inside the fader limits, bouncing off an edge rather than resting on it
  const move = (key, by, lo, hi) => { if (!isPinned(key, k)) t[key] = limStep(key, t[key] + rnd(-by, by) * j, lo, hi); };
  move('zoom', 15, -60, 80);
  move('spin', 15, -70, 70);
  move('color', 8, 0, 45);
  move('warp', 10, 0, 50);
}
// Two loops with long Trails at the same time pile up into white. So whenever the other loop's Trails are
// already above 75, a new look from Autopilot keeps this loop's Trails at 75 or below (unless Trails is pinned),
// still inside the Trails limits. A lowest Trails limit above 75 wins over this.
const AP_TRAILS_MAX = 75;
function capTrails(sc, other, self) {
  if (isPinned('trails', self || (other === 'A' ? 'B' : 'A'))) return;
  const lo = limSpan('trails') ? limSpan('trails')[0] : 0;
  if (lo > AP_TRAILS_MAX) return;
  if (loops[other].tgt.trails > AP_TRAILS_MAX && (sc.trails ?? loopDefaults().trails) > AP_TRAILS_MAX) sc.trails = Math.round(rnd(Math.max(lo, 62), AP_TRAILS_MAX));
}
// A hidden loop gets a whole new look at once, from a clean slate
function freshLook(k, shown) {
  const sc = apScene(k), favMix = sc.favMix;
  delete sc.favMix;
  // Two loops that only feed on each other fade to black, so one of them keeps a real input
  if (sc.in1 === 'loop' && [loops[shown].tgt.in1, loops[shown].tgt.in2].includes('loop')) {
    if (!isPinned('in1', k)) sc.in1 = apRealInput();
    else if (!isPinned('in2', k)) { sc.in2 = apRealInput(); sc.blend = 50; }
  }
  apLimit(sc, k);
  capTrails(sc, shown);
  patchLoop(k, sc, true);
  const L = loops[k];
  L.favMix = favMix || null;
  for (const q of LOOP_SMOOTH) L.cur[q] = L.tgt[q];
  clearLoop(k);
  eyeForget(k);
}
// With What you see pinned, a loop on screen changes in place instead, gliding into its new look.
// As often as How wild says, it keeps its input and mirror, so the picture changes shape rather than jumping.
function glideLook(k) {
  const L = loops[k], sc = apScene(k), favMix = sc.favMix, sw = apSwitch(apSet.wild / 100);
  delete sc.favMix;
  if (Math.random() >= sw) { sc.mirror = L.tgt.mirror; sc.edge = L.tgt.edge; sc.form = L.tgt.form; }
  // Keeping its inputs (as often as How wild says), unless one of them has been switched off under Autopilot settings
  if (Math.random() >= sw && apAllowed(L.tgt.in1)) {
    for (const f of ['in1', 'in2', 'blend', 'size', 'motion', 'specRound', 'gain']) sc[f] = L.tgt[f];
    if (sc.in2 && sc.in2 !== 'none' && !apAllowed(sc.in2)) sc.in2 = 'none';
  }
  withPins(sc, k);
  const other = otherLoop(k);
  if (sc.in1 === 'loop' && [loops[other].tgt.in1, loops[other].tgt.in2].includes('loop') && !isPinned('in1', k)) sc.in1 = apRealInput();
  apLimit(sc, k);
  capTrails(sc, other, k);
  patchLoop(k, sc, true);
  L.favMix = favMix || null;
}
// 3D worlds and Fractals need room to be seen. When Autopilot brings one in, that loop arrives clean (no Trails,
// Zoom, Spin, color shift, Warp, softness or effects, no second input, nothing fed in from the other loop),
// is shown on its own and stays about 1 2/3 times as long. Once it has faded in, the look Autopilot picked builds up
// slowly, peaks in the middle of its stay, and eases back to clean before the next look fades in over it. Check each
// look still judges the full look out of sight first. Pinned settings stay put, a setting with a fader limit above
// its clean value starts from that limit, a slider moved by hand with Play along is left where it's put, and the
// white-out watch lowers the peak as well as what's on screen.
const WORLD_STAY = 5 / 3;
const RAMP_CLEAN = { trails: 0, zoom: 0, spin: 0, color: 0, warp: 0, blur: 0, shiftX: 0, shiftY: 0, blend: 0,
  flow: 0, melt: 0, push: 0, dye: 0, split: 0, grow: 0, time: 0, ...Object.fromEntries(SELF.map((x) => [x, 0])) };
// Starts the build-up on loop k if its new look is a 3D world or fractal (snap: it came in out of sight, so it can
// jump straight to clean). Returns whether it did.
function rampStart(k, now, snap) {
  const L = loops[k];
  L.ramp = null;
  if (!is3D(L.tgt.in1) || L.asInput) return false;
  const keys = {};
  for (const [key, c] of Object.entries(RAMP_CLEAN)) {
    if (isPinned(key, k)) continue;
    const clean = nearLim(key, c), full = L.tgt[key];
    if (full === clean) continue;
    keys[key] = { clean, full };
    L.tgt[key] = clean;
    if (snap) L.cur[key] = clean;
  }
  const fk = FEED_INTO[k];
  let feed = null;
  if (!ap.pins.has(fk) && apOwnsMix(fk)) {
    const clean = nearLim(fk, 0);
    if (mix.tgt[fk] !== clean) { feed = { key: fk, clean, full: mix.tgt[fk] }; mix.tgt[fk] = clean; }
  }
  L.ramp = { t0: now, gen: L.gen, keys, feed, a: 0 };
  return true;
}
// Every frame: how far each building look has got. Clean while it fades in, up over the first 40% of the time
// between, at its peak for the middle 20%, down over the last 40%, and clean again half a second before the next
// look is due, staying clean while that look fades in over it.
function rampTick(now) {
  for (const k of KEYS) {
    const L = loops[k], R = L.ramp;
    if (!R) continue;
    if (R.gen !== L.gen) { L.ramp = null; continue; }   // another look has gone on this loop since
    let a = 0;
    if (ap.cameIn && ap.cameIn.k === k && ap.cameIn.gen === L.gen) {
      const start = R.t0 + 0.8 * apFadeSec() * 1000, end = ap.due - 500;
      if (end > start && now > start && now < end) {
        const x = (now - start) / (end - start);
        const u = x < 0.4 ? x / 0.4 : x > 0.6 ? (1 - x) / 0.4 : 1;
        a = u * u * (3 - 2 * u);
      }
    }
    R.a = a;
    for (const [key, v] of Object.entries(R.keys)) if (!isPinned(key, k)) L.tgt[key] = v.clean + (v.full - v.clean) * a;
    if (R.feed && !ap.pins.has(R.feed.key)) mix.tgt[R.feed.key] = R.feed.clean + (R.feed.full - R.feed.clean) * a;
  }
}
// Whether a slider is being moved by a build-up right now (it then follows closely, the build-up being smooth already)
const ramping = (p, k) => !!(loops[k].ramp && loops[k].ramp.keys[p]);
const rampingMix = (p) => KEYS.some((k) => loops[k].ramp && loops[k].ramp.feed && loops[k].ramp.feed.key === p);
// A slider moved by hand with Play along leaves the build-up and stays where it's put until the next look
function rampLet(key, k) {
  for (const L of KEYS.map((j) => loops[j])) if (L.ramp && L.ramp.feed && L.ramp.feed.key === key) L.ramp.feed = null;
  if (loops[k] && loops[k].ramp) delete loops[k].ramp.keys[key];
}
// Loop k's look as Autopilot picked it: a building look counts at its peak
function rampLook(k) {
  const L = loops[k], R = L.ramp, o = { ...L.tgt };
  if (R && R.gen === L.gen) for (const [key, v] of Object.entries(R.keys)) o[key] = v.full;
  return o;
}
// Time for a new look. With Change on the beat and music coming in, it waits (up to 4 seconds) for the next beat,
// unless Next look or the white-out watch asked for it straight away.
function apTick(now) {
  if (apSet.beat && snd.analyser && snd.amount > 0 && !ap.rush) {
    if (!ap.beatWait) ap.beatWait = { beats: snd.beats, until: now + 4000 };
    if (snd.beats === ap.beatWait.beats && now < ap.beatWait.until) return;
    const onBeat = snd.beats !== ap.beatWait.beats;
    ap.beatWait = null;
    apStep(now, onBeat);
  } else {
    ap.beatWait = null;
    apStep(now, false);
  }
}
// Which loops get a new look this time. Loops A and B count as one when Autopilot runs both (it swaps between
// them); any other loop it runs changes in place. Taking turns, one of them goes each time; all at once, every one.
function apTurn() {
  const mine = apMine(), slots = [];
  if (apPair()) slots.push('AB');
  for (const k of mine) if (!(apPair() && (k === 'A' || k === 'B'))) slots.push(k);
  if (!apSet.turns || slots.length < 2) return { go: slots, i: 0 };
  const i = (ap.turnN || 0) % slots.length;
  return { go: [slots[i]], i };
}
function apStep(now, onBeat) {
  const rush = ap.rush;
  ap.next = now + apEverySec() * 1000 * rnd(0.75, 1.25);
  ap.quick = onBeat || rush ? now + 1500 : 0;   // on a beat (or when rushed) the new look cuts in fast
  const m = apSet.mix / 100;
  const v = mix.tgt.view;
  // How much one loop is fed into the other, as Autopilot picks it (a pinned feed stays where it is), and how many
  // ways of showing and feeding the loops it weighs up against your taste (just one when it isn't following it)
  const feed = (key) => (ap.pins.has(key) ? mix.tgt[key] : inLim(key, Math.random() < m ? Math.round(rnd(10, Math.min(85, 15 + 80 * m))) : 0));
  const ways = 1 + Math.round(5 * tasteHow());
  let came = null, mixSet = false;
  const turn = apTurn(), changed = new Set();
  // A narrowed What you see limit means Autopilot can't hide a loop to swap it out, so it moves What you see
  // somewhere inside the limit and changes the loops in place, the same as when What you see is pinned
  const viewLim = limSpan('view');
  if (turn.go.includes('AB')) {
    if (!ap.pins.has('view') && !viewLim) {
      if (v <= 1 || v >= 99) {
        const hidden = v <= 1 ? 'B' : 'A', shown = hidden === 'A' ? 'B' : 'A';
        // Still fading away from the last change (a long Fade time): look again in a moment,
        // rather than swap out a loop that's still on screen
        const [cA, cB] = weights(mix.cur.view);
        if ((hidden === 'A' ? cA : cB) > 0.02) { ap.next = now + 1000; ap.quick = 0; return; }
        // Check each look: the hidden loop only comes in once its look has been tried out and passed
        if (checking()) {
          if (!prepReady(hidden, now, rush)) { ap.next = now + 250; ap.quick = 0; apStatus(); return; }
        } else freshLook(hidden, shown);
        changed.add(hidden);
        ap.cameIn = { k: hidden, at: now, gen: loops[hidden].gen };
        came = hidden;
        // Both loops at once or just the new one, and how they feed each other: picked as a whole picture
        const one = hidden === 'B' ? 100 : 0, opts = [];
        for (let i = ways; i > 0; i--) opts.push({ view: Math.random() < 0.8 * m ? 50 : one, xab: feed('xab'), xba: feed('xba') });
        const w = tasteMix(opts, hidden);
        // Two loops that would add up to white on screen are shown one at a time
        mix.tgt.view = w.view === 50 && overlayWhite(hidden, shown) > WATCH.white * 0.7 ? one : w.view;
        mix.tgt.xab = w.xab;
        mix.tgt.xba = w.xba;
        mixSet = true;
      } else {
        mix.tgt.view = Math.random() < 0.5 ? 0 : 100;
      }
    } else {
      if (!ap.pins.has('view')) mix.tgt.view = Math.round(rnd(viewLim[0], viewLim[1]));
      const [wA, wB] = weights(mix.tgt.view);
      const onScreen = ['A', 'B'].filter((k) => (k === 'A' ? wA : wB) > 0);
      const k = pick(onScreen.length ? onScreen : ['A']);
      glideLook(k);
      changed.add(k);
      ap.cameIn = { k, at: now, gen: loops[k].gen };
      came = k;
      // Check each look: once it has faded in, Autopilot looks at it (see glideJudge)
      ap.glide = checking() ? { k, at: now + (apFadeSec() + 2.5) * 1000 } : null;
    }
  }
  // Every other loop whose turn it is changes in place, gliding into its new look (and what pours into it with it)
  for (const k of turn.go) {
    if (k === 'AB') continue;
    glideLook(k);
    changed.add(k);
    if (FEED_INTO[k] && (k === 'C' || k === 'D') && !ap.pins.has(FEED_INTO[k])) mix.tgt[FEED_INTO[k]] = feed(FEED_INTO[k]);
    if (!came) {
      came = k;
      ap.cameIn = { k, at: now, gen: loops[k].gen };
      if ((k === 'A' || k === 'B') && checking()) ap.glide = { k, at: now + (apFadeSec() + 2.5) * 1000 };
    }
  }
  // The rest of Autopilot's loops drift a little meanwhile
  for (const k of apMine()) if (!changed.has(k)) nudge(k);
  ap.turnN = turn.i + 1;
  if (came) lookOnScreen++;
  ap.rush = false;
  // The countdown under the picture counts down to the next look from here
  ap.due = ap.next;
  ap.span = Math.max(1, ap.next - now);
  // Otherwise What you see is settled already, and only the feeds are picked (as a whole picture again), each one
  // only when Autopilot runs the loop it pours into
  if (!mixSet && (apRuns('A') || apRuns('B'))) {
    const opts = [];
    for (let i = ways; i > 0; i--) opts.push({ view: mix.tgt.view, fixedView: true, xab: feed('xab'), xba: feed('xba') });
    const w = tasteMix(opts, came === 'A' || came === 'B' ? came : null);
    if (apRuns('B')) mix.tgt.xab = w.xab;
    if (apRuns('A')) mix.tgt.xba = w.xba;
  }
  // A 3D world or fractal: clean to start with, building up slowly, a longer stay, and shown on its own
  if (came && rampStart(came, now, mixSet)) {
    ap.next = now + (ap.next - now) * WORLD_STAY;
    ap.due = ap.next;
    ap.span = Math.max(1, ap.next - now);
    if (mixSet && !ap.pins.has('view')) mix.tgt.view = came === 'B' ? 100 : 0;
  }
  if (vid.video && vid.video.paused && !vidUserPaused && uses('video')) vid.video.play().catch(() => {});
  apPicture(came);
  apClip(came);
  syncUI();
  apStatus();
}
// Every 1 to 3 new looks (picked at random each time), Autopilot also puts in a different nature picture,
// from the kind chosen in the gallery, the same way Shuffle does. It leaves a picture of your own in place,
// and leaves the picture alone when Picture is switched off under Inputs Autopilot can use.
function apPicGap() { return 1 + Math.floor(Math.random() * 3); }
// With a taste to follow, a look brought back from a picture you liked brings its nature picture back too, and
// otherwise the new picture is picked from a dozen at random by which pictures and kinds you've liked.
// (k: the loop whose new look just came in, if one did)
function apPicture(k) {
  const came = k && loops[k], want = came && came.favMix && came.favMix.nat;
  if (want && !nat.own && apAllowed('picture') && tasteHow() && (came.tgt.in1 === 'picture' || came.tgt.in2 === 'picture')) {
    natList().then(() => {
      const i = nat.pics.findIndex((p) => p.f === want);
      if (i >= 0 && i !== nat.cur) natPick(i, true);
    }).catch(() => {});
    ap.picIn = apPicGap();
    return;
  }
  if (ap.picIn > 1) { ap.picIn--; return; }
  ap.picIn = apPicGap();
  if (nat.own || !apAllowed('picture')) return;
  natList().then(() => {
    const shown = natShown().filter((i) => i !== nat.cur);
    if (!shown.length) return;
    if (!tasteHow()) { natPick(pick(shown), true); return; }
    const M = tasteModel(), few = shown.sort(() => Math.random() - 0.5).slice(0, 12);
    natPick(tastePickBy(few, (i) => Math.tanh(((M.pref['natf:' + nat.pics[i].f] || 0) * 1.5 + (M.pref['natc:' + nat.pics[i].c] || 0) * 1.2) / 2)), true);
  }).catch(() => { /* offline before the list was ever saved: keep the picture there is */ });
}
// Clips from the clip library (Phosphor Clips): when a look picks Video and no video is in yet, Autopilot brings in
// a clip from the categories ticked in the clip gallery, and every 1 to 3 new looks that use Video it puts in a
// different one, the way it does with nature pictures. A video file of your own stays put, and nothing changes
// when Video is switched off under Inputs Autopilot can use.
function apClip(k) {
  if (!clipsReady() || clips.own || !apAllowed('video')) return;
  if (!vid.on) {
    if (uses('video')) { ap.clipIn = apPicGap(); clipPick(pick(clipsAp()), true); }
    return;
  }
  const came = k && loops[k];
  if (!came || (came.tgt.in1 !== 'video' && came.tgt.in2 !== 'video')) return;
  if (ap.clipIn > 1) { ap.clipIn--; return; }
  ap.clipIn = apPicGap();
  const others = clipsAp().filter((c) => c.id !== clips.cur);
  if (others.length) clipPick(pick(others), true);
}
// Next look (beside the Autopilot buttons, or the L key): Autopilot's next new look straight away, cutting in
// fast the way a look does on a beat, and the countdown to the one after starts again. If Autopilot is off it
// starts with a new look. Any fade still going is finished first, and when both loops are showing, one of
// them cuts away so the hidden one can take the new look (unless What you see is pinned or limited, when the
// loops change in place as usual). With Check each look on, a look that's ready and checked goes on at once;
// otherwise the quickest look that passes does, usually within two or three seconds.
// how: who asked, when it wasn't Next look itself ('rated' for Not this, whose rating already counts; 'session'
// for a taste session starting). Only Next look itself counts as a quick skip.
function nextLook(how) {
  const was = ap.on;
  // Learn from hints: skipping a look that came in only a few seconds ago counts a little against it
  if (was && !how) tasteHintSkip(performance.now());
  if (frozen) toggleFreeze(false);
  if (!was) setAutopilot(true, true);
  ap.beatWait = null;
  if (apPair() && !ap.pins.has('view') && !limSpan('view')) {
    if (mix.tgt.view > 1 && mix.tgt.view < 99) mix.tgt.view = Math.random() < 0.5 ? 0 : 100;
    mix.cur.view = mix.tgt.view;
  }
  ap.rush = true;
  apStep(performance.now(), true);
  showOSD('AUTOPILOT', 'NEXT LOOK');
  if (!was) toast('Autopilot is on, starting with a new look. Press Next look any time to skip ahead.');
}
$$('.next-look').forEach((b) => b.addEventListener('click', () => nextLook()));
// For tests/ap_loops_check.py: a way in to Autopilot's loops
window.__plAp = { loops, ap, apSet, apTurn, step() { ap.quick = 0; apStep(performance.now(), false); } };

/* ================= learn my taste ================= */
// More like this and Not this (under the picture, keys Y and X) teach Autopilot what you like. A rating is for the
// whole picture on screen, never one loop on its own: it keeps both loops' looks and how they're shown and fed into
// each other (see sceneFeats for what's counted: the inputs and effects that meet, feeds, one loop being the
// other's input or pushing or dyeing it, zooming and turning alike or apart), and, once Autopilot's eye has seen
// it, how the screen looks: how much is lit, how busy it is, how many shades and how much detail it has, how much
// it moves and how colorful it is. With Learn from hints on, some smaller ratings come by themselves:
// skipping a new look in its first few seconds counts a little against it, and pinning a setting counts for that
// setting.
// Ratings are kept in named taste profiles (under Taste profiles), and Autopilot follows the lit one, or no taste at
// all when none is lit (tapping the lit one again puts it out). A taste session makes a new profile from scratch:
// its ratings go into the session, Autopilot learns from them as you go, and Finish names it and keeps it. Rating
// with no profile lit starts a session. Profiles can be saved as a file to send to someone, and opened from one; the admin can
// share them with everyone (they live in presets.json beside the shared presets). Rating while a shared profile
// is lit starts your own copy of it. Everything stays in this browser, the newest 400 ratings per profile.
// Autopilot uses the lit profile in four ways, as far as Follow my taste says (not at all at Off), always judging
// the picture a new look would make together with the other loop:
//   1. it makes several looks and keeps one that would make a picture like the ones you liked
//   2. some new looks bring back a picture you liked: one of its loops, varied, and how it was mixed
//   3. Check each look leans towards tries that look like your favourites, alone and blended with the other loop
//   4. how the loops are shown and fed into each other is picked the same way, as a whole picture
const TASTE_KEY = 'phosphor-taste-v2', TASTE_OLD_KEY = 'phosphor-taste-v1', TASTE_MAX = 400, TASTE_SKIP_MS = 8000;
const TASTE_FX = ['flow', 'melt', 'push', 'dye', 'split', 'grow', 'time', ...SELF];
const TASTE_RANGE = { flow: [30, 80], melt: [20, 80], push: [25, 80], dye: [20, 80], split: [10, 60], grow: [35, 85], time: [30, 90], ...SELF_RANGE };
const TASTE_DEF = loopDefaults();
const TASTE_LOOK = Object.keys(TASTE_DEF).filter((f) => f !== 'mirrorFx' && f !== 'mirrorSpin');
const TASTE_PIC = ['mean', 'lit', 'busy', 'shades', 'detail', 'motion', 'color'];
const TASTE_FILE_KIND = 'phosphor-loop-taste';
// profiles: your own ({ id, name, votes, thumb, saved }); sharedList: the admin's, from presets.json; active: the lit
// profile's id (null for none); session: a taste session under way ({ votes, started, into })
const taste = { profiles: [], sharedList: [], active: null, session: null, model: null, pending: [], sid: randId(6) };
const tasteVoteOK = (v) => !!v && typeof v === 'object' && Number.isFinite(v.w) &&
  ((v.scene && typeof v.scene === 'object' && v.scene.A && typeof v.scene.A === 'object') || (v.look && typeof v.look === 'object') ||
   (Array.isArray(v.feats) && v.feats.every((f) => typeof f === 'string')));
const tasteThumbOK = (t) => typeof t === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(t);
const tasteNew = () => 't' + Date.now().toString(36) + randId(4);
function cleanTasteProfile(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[a-z0-9]{1,40}$/i.test(p.id) || !Array.isArray(p.votes)) return null;
  return { id: p.id, name: String(p.name || 'Taste').slice(0, 40), votes: p.votes.filter(tasteVoteOK).slice(-TASTE_MAX),
    thumb: tasteThumbOK(p.thumb) ? p.thumb : '', saved: Number(p.saved) || 0 };
}
try {
  const t = JSON.parse(localStorage.getItem(TASTE_KEY) || 'null');
  if (t && Array.isArray(t.profiles)) {
    taste.profiles = t.profiles.map(cleanTasteProfile).filter(Boolean);
    if (typeof t.active === 'string' || t.active === null) taste.active = t.active;
    if (t.session && Array.isArray(t.session.votes)) taste.session = { votes: t.session.votes.filter(tasteVoteOK), started: t.session.started || Date.now(), into: typeof t.session.into === 'string' ? t.session.into : null };
  } else {
    // Ratings from before there were profiles become a profile of their own
    const old = JSON.parse(localStorage.getItem(TASTE_OLD_KEY) || 'null');
    if (old && Array.isArray(old.votes)) taste.profiles = [{ id: 'mine', name: 'My taste', votes: old.votes.filter(tasteVoteOK).slice(-TASTE_MAX), thumb: '', saved: Date.now() }];
  }
} catch (_) {}
// There used to be a My taste that was always there. Now it's an ordinary profile if it has ratings, and gone if not.
taste.profiles = taste.profiles.filter((p) => p.id !== 'mine' || p.votes.length);
if (taste.active === 'mine' && !taste.profiles.some((p) => p.id === 'mine')) taste.active = null;
function saveTaste() {
  for (const p of taste.profiles) if (p.votes.length > TASTE_MAX) p.votes = p.votes.slice(-TASTE_MAX);
  taste.model = null;
  try {
    localStorage.setItem(TASTE_KEY, JSON.stringify({ v: 2, active: taste.active, profiles: taste.profiles, session: taste.session }));
  } catch (_) { toast('This browser’s storage for the page is full, so the newest ratings couldn’t be kept. Delete a taste profile or a few presets.', 8000); }
  renderTaste();
}
// What Autopilot follows right now: the taste session if one is under way (a new profile's ratings, or a profile
// being trained again together with its new ratings), otherwise the lit profile, otherwise nothing (no profile lit,
// or a shared one that hasn't arrived yet). target: where new ratings go.
function tasteSource() {
  const S = taste.session;
  if (S) {
    const p = S.into && taste.profiles.find((x) => x.id === S.into);
    if (p) return { kind: 'session', training: p, name: p.name, votes: p.votes.concat(S.votes), target: S.votes };
    return { kind: 'session', name: 'this taste session', votes: S.votes, target: S.votes };
  }
  const own = taste.profiles.find((p) => p.id === taste.active);
  if (own) return { kind: 'own', p: own, name: own.name, votes: own.votes };
  const sh = taste.sharedList.find((p) => p.id === taste.active);
  if (sh) return { kind: 'shared', p: sh, name: sh.name, votes: sh.votes };
  return { kind: 'none', name: '', votes: [] };
}
// Where a new rating goes. With no profile lit, rating starts a taste session. A shared profile can't be changed,
// so rating while one is lit starts your own copy.
function tasteTarget() {
  const s = tasteSource();
  if (s.kind === 'none') {
    taste.session = { votes: [], started: Date.now(), into: null };
    return { votes: taste.session.votes, note: ' That started a taste session: rate some more, then Finish and name it under the picture.' };
  }
  if (s.kind !== 'shared') return { votes: s.target || s.votes, note: '' };
  const copy = { id: tasteNew(), name: tasteFreeName(`${s.name} (mine)`), votes: s.votes.map((v) => ({ ...v })), thumb: s.p.thumb || '', saved: Date.now() };
  taste.profiles.push(copy);
  taste.active = copy.id;
  return { votes: copy.votes, note: ` “${s.name}” is shared, so this starts your own copy, “${copy.name}”.` };
}
// A name no profile of yours has yet ("Chill", then "Chill 2" and so on)
function tasteFreeName(name, except) {
  name = String(name).trim().slice(0, 40) || 'Taste';
  const used = (n) => taste.profiles.some((p) => p.id !== except && p.name.toLowerCase() === n.toLowerCase());
  if (!used(name)) return name;
  let i = 2;
  while (used(`${name.slice(0, 36)} ${i}`)) i++;
  return `${name.slice(0, 36)} ${i}`;
}
const tasteCount = (votes) => votes.filter((v) => v.src === 'up' || v.src === 'down').length;

// What one loop's look is made of, in words Autopilot can count, in rough steps rather than exact numbers:
//  - the plain words: its inputs, which effects are on (and how strongly, and how many), its mirror, where Zoom,
//    Spin, Trails, Color shift and Warp sit, and the smaller settings (Input size, Blend, softness, the pattern of
//    Wave or Shape, Grow's size and Time warp's direction, Only movement, the edges when zoomed out, which way the
//    picture drifts, its brightness, the Spectrograph's style; and for the whole picture, which nature picture shows)
//  - the deep words, which tie settings to each other the way they appeared together: the input with each effect,
//    with its zoom, spin, mirror, trails and color ("Shape with Melt", "Shape zoomed in"), the effects that come
//    together, and the look as a whole (input, effects, mirror, zoom and spin all at once)
const tasteSrc = (s) => sceneGroup(s) || s;
function tasteBand(v, cuts, names) { let i = 0; while (i < cuts.length && v >= cuts[i]) i++; return names[i]; }
// The rough steps of one loop's main settings (L: a full look)
function loopBits(L) {
  return {
    src: L.in1, fx: TASTE_FX.filter((x) => (L[x] || 0) > 12).sort(), mirror: L.mirror || 0,
    zoom: tasteBand(L.zoom ?? 0, [-8, 8, 40], ['out', 'still', 'in', 'deep']),
    spin: tasteBand(Math.abs(L.spin ?? 0), [8, 35], ['calm', 'turn', 'fast']),
    trails: tasteBand(L.trails ?? 88, [60, 88], ['short', 'mid', 'long']),
    color: tasteBand(L.color ?? 10, [10, 30], ['low', 'mid', 'high']),
    warp: tasteBand(L.warp ?? 0, [10, 30], ['low', 'mid', 'high']),
  };
}
// A look as a whole, in one word: its input, effects, mirror, zoom and spin
const lookKey = (b) => `${b.src}|${b.fx.join(',') || '-'}|m${b.mirror}|z${b.zoom}|s${b.spin}`;
function tasteFeats(L) {
  L = { ...TASTE_DEF, ...L };
  const b = loopBits(L), src = tasteSrc(L.in1), f = ['in:' + src];
  if (is3D(L.in1)) f.push('world:' + L.in1);
  if (L.in2 && L.in2 !== 'none') {
    f.push('in2:' + tasteSrc(L.in2));
    f.push('blend:' + tasteBand(L.blend ?? 50, [35, 66], ['first', 'even', 'second']));
  }
  for (const x of b.fx) {
    const [lo, hi] = TASTE_RANGE[x];
    f.push('fx:' + x, `fxlvl:${x}:${(L[x] || 0) > (lo + hi) / 2 ? 'high' : 'low'}`);
  }
  f.push(b.fx.length ? 'fxn:' + Math.min(b.fx.length, 3) : 'fx:none');
  f.push('mirror:' + b.mirror, 'zoom:' + b.zoom, 'spin:' + b.spin, 'trails:' + b.trails, 'color:' + b.color, 'warp:' + b.warp);
  // The smaller settings
  if (!is3D(L.in1)) f.push('size:' + tasteBand(L.size ?? 100, [45, 85], ['small', 'mid', 'full']));
  f.push('blur:' + tasteBand(L.blur ?? 0, [-0.03, 0.15], ['sharp', 'soft', 'hazy']));
  if (L.in1 === 'wave' || L.in1 === 'shape') f.push(`form:${src}:${L.form}`);
  if (b.fx.includes('grow')) f.push('growsize:' + (L.growSize ?? 1));
  if (b.fx.includes('time')) f.push('timeshape:' + (L.timeShape ?? 0));
  if (L.motion && LIVE.includes(L.in1)) f.push('motion:on');
  if (b.zoom === 'out') f.push('edge:' + (L.edge ? 'fold' : 'dark'));
  if (L.in1 === 'spectro' || L.in2 === 'spectro') f.push('spec:' + (L.specRound ? 'round' : 'scroll'));
  const sx = L.shiftX || 0, sy = L.shiftY || 0;
  f.push('drift:' + (Math.hypot(sx, sy) < 0.0004 ? 'none' : Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'left' : 'right') : (sy > 0 ? 'down' : 'up')));
  f.push('bright:' + tasteBand(L.gain ?? 1, [0.85, 1.15], ['dim', 'normal', 'bright']));
  // The deep words: settings tied to the input they came with, effects that come together, and the whole look
  for (const x of b.fx) f.push(`lk:${src}&fx:${x}`);
  for (const k of ['zoom', 'spin', 'mirror', 'trails', 'color']) f.push(`lk:${src}&${k}:${b[k]}`);
  for (let i = 0; i < b.fx.length; i++) for (let j = i + 1; j < b.fx.length; j++) f.push(`lfx:${b.fx[i]}+${b.fx[j]}`);
  f.push('look:' + lookKey(b));
  return f;
}
// Loop k's look, keeping only what differs from the defaults (so ratings take little room and travel well)
function tasteLook(k) {
  const t = loops[k].tgt, o = {};
  for (const f of TASTE_LOOK) {
    const v = typeof t[f] === 'number' ? Math.round(t[f] * 100) / 100 : t[f];
    if (v !== TASTE_DEF[f]) o[f] = v;
  }
  return o;
}
// How a picture looks, from the eye's copies of it (all 0 to 1)
function tastePicOf(S) {
  if (!S || !S.length) return null;
  const moving = S.filter((s) => s.motion != null);
  const p = { mean: eyeAvg(S, 'mean'), lit: eyeAvg(S, 'lit'), busy: eyeAvg(S, 'busy'), shades: eyeAvg(S, 'shades'),
    detail: Math.min(1, eyeAvg(S, 'detail') / 0.15), motion: moving.length ? Math.min(1, eyeAvg(moving, 'motion') / 0.2) : null,
    color: Math.min(1, eyeAvg(S, 'colorful') * 2.5) * (0.35 + 0.65 * eyeAvg(S, 'variety')) };
  for (const d of TASTE_PIC) if (p[d] != null) p[d] = Math.round(p[d] * 1000) / 1000;
  return p;
}
// The whole picture on screen, from the eye's copies of the screen since `from` (the last second and a half if
// not said); at least `least` of them
function tasteScreenPic(now, from = now - 1500, least = 2) {
  const S = (eye.hist.comp || []).filter((s) => s.t >= from && now - s.t < 30000).slice(-8);
  return S.length >= least ? tastePicOf(S) : null;
}
// How two loops would look on screen together (they add up, like two projectors on one wall), from the newest copy
// of each; the movement is the two loops' own, averaged. Used for a look being tried out of sight.
function tasteBlendPic(a, b) {
  const A = eye.last[a], B = eye.last[b];
  if (!A || !B) return null;
  const x = A.rgb, y = B.rgb, buf = new Uint8Array(x.length);
  for (let i = 0; i < x.length; i++) buf[i] = 255 - ((255 - x[i]) * (255 - y[i])) / 255;
  const now = performance.now(), mot = (k) => { const R = eyeRecent(k, 2000, now).filter((s) => s.motion != null); return R.length ? eyeAvg(R, 'motion') : null; };
  const ma = mot(a), mb = mot(b);
  return tastePicOf([{ ...eyeMeasure(buf), motion: ma != null && mb != null ? (ma + mb) / 2 : (ma ?? mb) }]);
}
// The whole picture's settings: both loops' looks (kept short) and how they're shown and fed into each other
function tasteSceneNow() {
  const sc = { A: tasteLook('A'), B: tasteLook('B'), mix: { view: Math.round(mix.cur.view), xab: Math.round(mix.cur.xab), xba: Math.round(mix.cur.xba) } };
  // Which nature picture is showing, when a loop uses the picture (a picture of your own isn't kept)
  const p = !nat.own && nat.pics && nat.pics[nat.cur];
  if (p && uses('picture')) sc.nat = { f: p.f, c: p.c };
  return sc;
}
// Which looks are on the loops: a rating is "the same picture" only while neither loop has a new look
const tasteGens = () => `${loops.A.gen}.${loops.B.gen}`;
// Opens Autopilot's eye for a moment when it isn't running, to see a picture that's just been rated or is being saved
function tasteLookSoon() { eye.wantUntil = performance.now() + 2500; }
// A rating made before the eye had seen the screen gets the picture as soon as the eye has a few copies of it
function tasteFill(now) {
  if (!taste.pending.length) return;
  let changed = false;
  taste.pending = taste.pending.filter((q) => {
    if (lookOnScreen !== q.look) return false;   // a new look came before the eye saw this one
    // A few copies if they come in time (a slow computer gets 6 seconds), or else whatever there is by then
    const late = now - q.from > 6000, p = tasteScreenPic(now, q.from, late ? 1 : 3);
    if (!p) return !late;
    q.vote.pic = p;
    changed = true;
    return false;
  });
  if (changed) saveTaste();
}

// What a whole picture is made of, in words Autopilot can count, each with how much it counts. The looks of the
// loops you see (and, more faintly, a hidden loop that still reaches the screen through the other one), and how
// the two work together: which inputs and effects meet, whether both show at once, how much one feeds the other,
// whether one is the other's input or pushes or dyes it, and whether they zoom, turn and mirror alike or apart.
function sceneFeats(sc) {
  const L = { A: { ...TASTE_DEF, ...(sc.A || {}) }, B: sc.B ? { ...TASTE_DEF, ...sc.B } : null };
  const m = sc.mix || {};
  const [wA, wB] = weights(Number.isFinite(m.view) ? m.view : 0);
  const vis = { A: wA, B: L.B ? wB : 0 };
  const feedInto = { A: clamp(m.xba || 0, 0, 100) / 100, B: clamp(m.xab || 0, 0, 100) / 100 };   // xab is Feed A into B
  // How much loop s takes from the other one: fed in, used as an input, or pushed or dyed by it
  const takes = (s) => {
    const t = L[s];
    if (!t) return 0;
    let r = feedInto[s];
    if (t.in1 === 'loop' || t.in2 === 'loop') r = Math.max(r, 0.8);
    if ((t.push || 0) > 12 || (t.dye || 0) > 12) r = Math.max(r, 0.5);
    return Math.min(1, r);
  };
  const reach = { A: Math.max(vis.A, L.B ? vis.B * takes('B') : 0), B: L.B ? Math.max(vis.B, vis.A * takes('A')) : 0 };
  const out = [], add = (f, w) => { if (w > 0.05) out.push([f, w]); };
  for (const k of ['A', 'B']) {
    if (!L[k] || reach[k] <= 0.05) continue;
    const w = vis[k] > 0.25 ? Math.min(1, vis[k]) : 0.4 * reach[k];
    for (const f of tasteFeats(L[k])) add(f, w);
  }
  add(vis.A > 0.25 && vis.B > 0.25 ? 'view:both' : 'view:one', 1);
  // How the two loops meet, when both reach the screen
  if (L.B && reach.A > 0.25 && reach.B > 0.25) {
    const bA = loopBits(L.A), bB = loopBits(L.B), sA = tasteSrc(L.A.in1), sB = tasteSrc(L.B.in1);
    add('pair:' + [sA, sB].sort().join('+'), 1);
    const fxA = bA.fx, fxB = bB.fx;
    for (const a of fxA) for (const b of fxB) add('pfx:' + [a, b].sort().join('+'), 0.5);
    // The deep words: the two whole looks together, and each loop's settings with the other loop's input
    // ("Shape with Melt next to Wave", "Shape zoomed in next to Wave")
    add('pl:' + [lookKey(bA), lookKey(bB)].sort().join(' + '), 1);
    for (const [b, src, other] of [[bA, sA, sB], [bB, sB, sA]]) {
      for (const x of b.fx) add(`px:${src}&fx:${x}+${other}`, 0.6);
      for (const k of ['zoom', 'spin', 'mirror']) add(`px:${src}&${k}:${b[k]}+${other}`, 0.6);
    }
    // ...and each loop's settings with each of the other loop's settings, both inputs named
    const words = (b) => [...b.fx.map((x) => 'fx:' + x), 'zoom:' + b.zoom, 'spin:' + b.spin, 'mirror:' + b.mirror];
    for (const a of words(bA)) for (const b of words(bB)) add('pxx:' + [`${sA}&${a}`, `${sB}&${b}`].sort().join(' + '), 0.4);
    const dir = (v, cut) => (Math.abs(v) > cut ? Math.sign(v) : 0);
    const za = dir(L.A.zoom, 8), zb = dir(L.B.zoom, 8), sa = dir(L.A.spin, 8), sb = dir(L.B.spin, 8);
    add('rel:zoom:' + (za && zb ? (za === zb ? 'same' : 'opposed') : 'still'), 0.7);
    add('rel:spin:' + (sa && sb ? (sa === sb ? 'same' : 'counter') : 'calm'), 0.7);
    add('rel:mirror:' + (L.A.mirror === L.B.mirror ? 'same' : 'apart'), 0.5);
  }
  // Which nature picture, when a loop that reaches the screen uses it (its kind counts too: Ocean, Birds...)
  if (sc.nat && ['A', 'B'].some((k) => L[k] && reach[k] > 0.25 && (L[k].in1 === 'picture' || L[k].in2 === 'picture'))) {
    add('natc:' + sc.nat.c, 0.8);
    add('natf:' + sc.nat.f, 1);
  }
  // How they act on each other
  const fed = Math.max(vis.A > 0.25 ? feedInto.A : 0, vis.B > 0.25 ? feedInto.B : 0);
  add('feed:' + (fed > 0.4 ? 'strong' : fed > 0.08 ? 'some' : 'none'), 1);
  if (L.B && feedInto.A > 0.08 && feedInto.B > 0.08) add('feed:both-ways', 0.8);
  for (const s of ['A', 'B']) {
    const t = L[s];
    if (!t || vis[s] <= 0.25) continue;
    if (t.in1 === 'loop' || t.in2 === 'loop') add('inter:other-loop-in', 1);
    if ((t.push || 0) > 12) add('inter:pushed', 1);
    if ((t.dye || 0) > 12) add('inter:dyed', 1);
    // The deep words: which loop does it to which ("Wave feeds strongly into Shape", "Wave pushes Shape")
    const o = s === 'A' ? 'B' : 'A';
    if (!L[o]) continue;
    const me = tasteSrc(t.in1), them = tasteSrc(L[o].in1);
    if (feedInto[s] > 0.08) add(`pi:${them}>feeds:${feedInto[s] > 0.4 ? 'strong' : 'some'}>${me}`, 0.8);
    if (t.in1 === 'loop' || t.in2 === 'loop') add(`pi:${them}>input>${me}`, 0.8);
    if ((t.push || 0) > 12) add(`pi:${them}>pushes>${me}`, 0.8);
    if ((t.dye || 0) > 12) add(`pi:${them}>dyes>${me}`, 0.8);
  }
  return out;
}
// A rating's words: a whole picture, or (ratings from before) one loop's look, or a pinned setting
function voteFeats(v) {
  if (v.scene) return sceneFeats(v.scene);
  if (v.look) return [...tasteFeats(v.look).map((f) => [f, 1]), [v.both ? 'view:both' : 'view:one', 0.7]];
  return v.feats.map((f) => [f === 'mix:both' ? 'view:both' : f === 'mix:one' ? 'view:one' : f, 1]);
}
const voteScene = (v) => v.scene || { A: v.look, B: null, mix: { view: 0 } };

// Everything learned so far, worked out again whenever a rating or preset changes
function tasteModel() {
  if (taste.model) return taste.model;
  const feat = {}, favs = [], picUp = [], picDown = [];
  const src = tasteSource();
  const n = { up: 0, down: 0, evidence: 0 };
  const add = (f, w) => { const e = feat[f] || (feat[f] = { up: 0, down: 0 }); if (w > 0) e.up += w; else e.down -= w; };
  const take = (v, scale) => {
    const w = v.w * scale;
    if (!w) return;
    n.evidence += Math.abs(w);
    for (const [f, fw] of voteFeats(v)) add(f, w * fw);
    if (v.scene || v.look) {
      if (w > 0) favs.push({ scene: voteScene(v), w });
      if (v.pic) (w > 0 ? picUp : picDown).push({ p: v.pic, w: Math.abs(w) });
    }
  };
  for (const v of src.votes) {
    take(v, 1);
    if (v.src === 'up') n.up++;
    else if (v.src === 'down') n.down++;
  }
  const pref = {};
  for (const [f, e] of Object.entries(feat)) pref[f] = (e.up - e.down) / (e.up + e.down + 1.5);
  const centroid = (L) => {
    if (L.reduce((a, x) => a + x.w, 0) < 1.5) return null;
    const c = {};
    for (const d of TASTE_PIC) {
      let s = 0, m = 0;
      for (const { p, w } of L) if (p[d] != null) { s += p[d] * w; m += w; }
      c[d] = m ? s / m : null;
    }
    return c;
  };
  taste.model = { pref, favs, up: centroid(picUp), down: centroid(picDown), conf: Math.min(1, n.evidence / 15), n, src };
  return taste.model;
}
// How much each kind of word counts: a whole pair of looks most, then a whole look, inputs, effects and how the
// loops meet and act on each other
const TASTE_WEIGHT = { natf: 1.5, natc: 1.2, pl: 2.5, look: 2, pxx: 1.2, in: 1.6, world: 1.6, fx: 1.3, pair: 1.3, pfx: 1.3, inter: 1.3, feed: 1.3, pi: 1.2, px: 1.1, lk: 1.1 };
// How much a whole picture's settings match what you've liked, from -1 to 1. Inputs, effects, and how the loops
// meet and act on each other count most. It adds up (rather than averages), so a picture with both loops in it
// isn't marked down just for having more in it.
function tasteSettings(sc, M) {
  let s = 0;
  for (const [f, w0] of sceneFeats(sc)) {
    if (!(f in M.pref)) continue;
    s += M.pref[f] * w0 * (TASTE_WEIGHT[f.slice(0, f.indexOf(':'))] || 1);
  }
  return Math.tanh(s / 8);
}
// How close a picture is to the ones you liked (and far from the ones you didn't), from 0 to 1
function tastePicFit(p, M) {
  if (!p || !M.up) return null;
  const dist = (c) => {
    let s = 0, n = 0;
    for (const d of TASTE_PIC) if (p[d] != null && c[d] != null) { s += (p[d] - c[d]) ** 2; n++; }
    return n ? Math.sqrt(s / n) : null;
  };
  const du = dist(M.up), dd = M.down ? dist(M.down) : null;
  if (du == null) return null;
  return dd == null ? clamp(1 - 3 * du, 0, 1) : 0.5 + 0.5 * Math.tanh(6 * (dd - du));
}
// A settings score (-1 to 1) and a picture together, from 0 to 1
function tasteFit(score, pic, M) {
  const s = 0.5 + 0.5 * score, p = tastePicFit(pic, M);
  return p == null ? s : 0.5 * s + 0.5 * p;
}
// How strongly Autopilot follows your taste right now: the slider, times how much it has learned
const tasteHow = () => (apSet.taste / 100) * tasteModel().conf;
// How well a new look for loop k goes with the other loop as it is: shown alone (where the other can still reach
// it through feeds, as an input, pushing or dyeing) and both together, each counted by how often Autopilot shows
// the loops that way (Mix the two loops), so a pair you don't like together is marked down
function tasteWith(k, sc, M) {
  const o = otherLoop(k), both = apSet.mix > 0 ? clamp(0.8 * apSet.mix / 100, 0.15, 0.85) : 0;
  const scene = (view) => ({ [k]: sc, [o]: loops[o].tgt, mix: { view, xab: mix.tgt.xab, xba: mix.tgt.xba } });
  const alone = tasteSettings(scene(k === 'A' ? 0 : 100), M);
  return both ? (1 - both) * alone + both * tasteSettings(scene(50), M) : alone;
}
// Picks one of several choices by score, with some luck left in (less as Follow my taste goes up)
function tastePickBy(items, score) {
  const f = apSet.taste / 100, temp = 0.3 - 0.24 * f;
  const s = items.map(score), top = Math.max(...s);
  const p = s.map((x) => Math.exp((x - top) / temp));
  let r = Math.random() * p.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) if ((r -= p[i]) <= 0) return items[i];
  return items[0];
}

// 1 and 2: a new look for loop k, leaning towards pictures you've liked. Several new looks, often with a loop or two
// brought back from pictures you liked, and the one that would make the best picture with the other loop is kept.
function apScene(k) {
  // Your taste is learned from loops A and B together, so loops C and D get Autopilot's own picks
  if (k !== 'A' && k !== 'B') return apSceneRaw(k);
  const M = tasteModel(), f = apSet.taste / 100, c = f * M.conf;
  if (!c) return apSceneRaw(k);
  const cands = [];
  for (let i = 1 + Math.round(5 * c); i > 0; i--) cands.push(apSceneRaw(k));
  // The higher Follow my taste, the more of them are pictures you liked brought back (see tasteFavLooks)
  if (M.favs.length && Math.random() < Math.min(1, (0.3 + 0.9 * f) * M.conf)) {
    for (let i = Math.round(1 + 3 * f); i > 0; i--) cands.push(...tasteFavLooks(k, M));
  }
  return tastePickBy(cands, (sc) => tasteWith(k, sc, M));
}
// Whether Autopilot may bring this input in right now
function apUsable(src) {
  if (!src || src === 'none' || !(src in SRC_ID) || !apAllowed(src)) return false;
  if (is3D(src)) return worldOK(src);
  if (src === 'video') return vid.on || clipsReady();
  if (DEVICE.includes(src)) return liveActive(src);
  if (src === 'spectro') return !!snd.analyser;
  if (src === 'loop') return apSet.mix > 10;
  return true;
}
// A picture you liked (or a preset), brought back on loop k: each of its loops that showed, varied a little (more
// or less zoom, spin or color, now and then an effect in or out or a different mirror), each carrying how that
// picture showed and fed its loops (favMix) for Autopilot to use when the look comes in. apScene then keeps the one
// that goes best with the loop on screen. How wild sets how far they stray. An input it can't use now gives way.
function tasteFavLooks(k, M) {
  let r = Math.random() * M.favs.reduce((a, x) => a + x.w, 0), fav = M.favs[0];
  for (const x of M.favs) if ((r -= x.w) <= 0) { fav = x; break; }
  const fs = fav.scene;
  if (!fs || !fs.A) return [];
  const [vA, vB] = weights(fs.mix && Number.isFinite(fs.mix.view) ? fs.mix.view : 0);
  const fm = fs.mix || {}, into = { A: fm.xba || 0, B: fm.xab || 0 }, both = !!fs.B && vA > 0.25 && vB > 0.25;
  // How wild sets how far they stray, and Follow my taste keeps them closer as it goes up (at Stick to what I like,
  // a brought-back look is very nearly the one you rated, so you know roughly what will be on screen)
  const f = apSet.taste / 100, w = apSet.wild / 100, j = (0.5 + w) * (1.3 - f), out = [];
  for (const from of ['A', 'B']) {
    if (!fs[from] || (from === 'A' ? vA : vB) <= 0.25) continue;
    const sc = { ...loopDefaults(), ...JSON.parse(JSON.stringify(fs[from])) };
    const was = sc.in1;
    sc.zoom = Math.round(clamp(sc.zoom + rnd(-8, 8) * j, -60, 85));
    sc.spin = Math.round(clamp(sc.spin + rnd(-10, 10) * j, -70, 70));
    sc.color = Math.round(clamp(sc.color + rnd(-6, 6) * j, 0, 70));
    sc.warp = Math.round(clamp(sc.warp + rnd(-6, 6) * j, 0, 70));
    if (Math.random() < 0.3 * j) {
      const key = pick(TASTE_FX), [lo, hi] = TASTE_RANGE[key];
      sc[key] = sc[key] > 12 ? 0 : Math.round(rnd(lo, hi));
    }
    if (Math.random() < 0.2 * j) sc.mirror = pick([0, 0, 2, 4, 6, 8]);
    if (!apUsable(sc.in1) || Math.random() < 0.15 * (1 - f)) { sc.in1 = apPick(apPool()); delete sc.size; }
    if (sc.in2 && sc.in2 !== 'none' && (!apUsable(sc.in2) || sc.in2 === sc.in1)) sc.in2 = 'none';
    const look = apFinish(sc, k, was);
    look.favMix = { both, into: into[from], out: fs.B ? into[from === 'A' ? 'B' : 'A'] : 0, nat: fs.nat ? fs.nat.f : null };
    out.push(look);
  }
  return out;
}
// 3: Check each look's score for a look tried out of sight on loop k, leaning towards pictures you liked: how its
// settings go with the other loop, and how it looks alone and blended with the other loop on screen
function tasteJudge(v, k, look, S) {
  const M = tasteModel(), a = 0.6 * (apSet.taste / 100) * M.conf;
  if (!a) return v;
  const score = tasteWith(k, look, M);
  const blend = apSet.mix > 0 ? tasteBlendPic(k, otherLoop(k)) : null;
  v.taste = Math.max(tasteFit(score, tastePicOf(S), M), blend ? tasteFit(score, blend, M) : 0);
  v.raw = v.score;
  v.score = (1 - a) * v.score + a * v.taste;
  return v;
}
// How to show and feed the two loops when a look comes in: a few ways (as Autopilot always picks them), plus the
// way a liked picture did it if the look came from one, and the one that makes a picture you'd like best is kept
function tasteMix(opts, k) {
  const c = tasteHow();
  if (!c) return opts[0];
  const fm = k && loops[k].favMix;
  if (fm) {
    const one = k === 'B' ? 100 : 0, o = { view: opts[0].fixedView ? opts[0].view : (fm.both && apSet.mix > 0 ? 50 : one) };
    for (const [key, into] of [['xab', k === 'B'], ['xba', k === 'A']]) o[key] = ap.pins.has(key) ? mix.tgt[key] : inLim(key, Math.round(into ? fm.into : fm.out));
    opts.push(o);
  }
  const M = tasteModel();
  return tastePickBy(opts, (o) => tasteSettings({ A: loops.A.tgt, B: loops.B.tgt, mix: o }, M));
}

// More like this (dir 1) and Not this (dir -1), for the whole picture on screen: both loops and how they mix
const rateBtns = { 1: $('#rateUp'), [-1]: $('#rateDown') };
function rate(dir) {
  const now = performance.now(), gens = tasteGens(), look = lookOnScreen, scene = tasteSceneNow();
  const { votes, note } = tasteTarget();
  let added = 0;
  // The same look on screen rated again: the same way is noted already, the other way replaces it
  const old = votes.findIndex((v) => v.sid === taste.sid && v.look === look);
  if (!(old >= 0 && Math.sign(votes[old].w) === dir && votes[old].src !== 'skip')) {
    if (old >= 0) votes.splice(old, 1);
    const vote = { t: Date.now(), src: dir > 0 ? 'up' : 'down', w: dir, scene, sid: taste.sid, gens, look };
    const pic = tasteScreenPic(now);
    if (pic) vote.pic = pic;
    else { taste.pending.push({ vote, look, from: now }); tasteLookSoon(); }
    votes.push(vote);
    added = 1;
  }
  for (const b of $$(dir > 0 ? '.rate-up' : '.rate-down')) {
    b.classList.remove('flash');
    void b.offsetWidth;
    b.classList.add('flash');
  }
  showOSD('TASTE', dir > 0 ? 'MORE LIKE THIS' : 'NOT THIS');
  if (added || note) saveTaste();
  syncRated();
  const M = tasteModel(), count = M.n.up + M.n.down;
  const off = (apSet.taste === 0 ? ' Follow my taste is at Off under Taste profiles, so Autopilot isn’t using it yet.' : '') + note;
  const sc = taste.session && tasteCount(taste.session.votes);
  const sofar = taste.session ? `${sc} in this session.` : `${count} rating${count === 1 ? '' : 's'} in “${M.src.name}”.`;
  if (dir > 0) toast(added ? `Noted: more pictures like this. ${sofar}${off}` : 'Already noted: you like this picture.');
  else if (ap.on) {
    toast(added ? `Noted: fewer pictures like this. Skipping to the next look.${off}` : 'Already noted. Skipping to the next look.');
    nextLook('rated');
  } else toast(added ? `Noted: Autopilot will steer away from pictures like this. Press Next look for a new one.${off}`
    : 'Already noted: you don’t like this picture. Press Next look for a new one.');
}
// Which way the look on screen has been rated (1 more like this, -1 not this, 0 not yet): the same test rate() uses.
// It holds until a new look comes on screen, so the button stays lit until it can be pressed for a new look.
function ratedNow() {
  const s = tasteSource();
  if (s.kind === 'none') return 0;
  const m = s.votes.find((v) => v.sid === taste.sid && v.look === lookOnScreen && (v.src === 'up' || v.src === 'down'));
  return m ? Math.sign(m.w) : 0;
}
let ratedShown = null, ratedLook = -1;
// Checked four times a second, and on the very frame a new look comes on screen (see frame)
function syncRated() {
  ratedLook = lookOnScreen;
  const r = ratedNow();
  if (r === ratedShown) return;
  ratedShown = r;
  for (const b of $$('.rate-up')) b.classList.toggle('rated', r > 0);
  for (const b of $$('.rate-down')) b.classList.toggle('rated', r < 0);
}
setInterval(syncRated, 250);
rateBtns[1].addEventListener('click', () => rate(1));
rateBtns[-1].addEventListener('click', () => rate(-1));
// Learn from hints: a quick skip of a look that has just come in counts a little against the picture it made
function tasteHintSkip(now) {
  const c = ap.cameIn;
  if (!apSet.hints || !c || now - c.at > TASTE_SKIP_MS || loops[c.k].gen !== c.gen) return;
  ap.cameIn = null;
  if (['shared', 'none'].includes(tasteSource().kind)) return;   // a hint alone doesn't start a copy or a session
  const { votes } = tasteTarget(), gens = tasteGens(), look = lookOnScreen;
  if (votes.some((v) => v.sid === taste.sid && v.look === look)) return;
  const vote = { t: Date.now(), src: 'skip', w: -0.5, scene: tasteSceneNow(), sid: taste.sid, gens, look };
  const pic = tasteScreenPic(now);
  if (pic) vote.pic = pic;
  votes.push(vote);
  saveTaste();
}
// Learn from hints: pinning a setting counts for that setting (pinning an effect at nothing counts against it)
function tasteHintPin(key, L) {
  if (!apSet.hints || !PINS[key]) return;
  const feats = [];
  if (PINS[key].mix) {
    if (key === 'view') { const [a, b] = weights(mix.tgt.view); feats.push([a > 0.25 && b > 0.25 ? 'view:both' : 'view:one', 1]); }
    else { const v = mix.tgt[key] / 100; feats.push(['feed:' + (v > 0.4 ? 'strong' : v > 0.08 ? 'some' : 'none'), 1]); }
  } else {
    const t = loops[L].tgt;
    if (key === 'in1') feats.push(['in:' + tasteSrc(t.in1), 1]);
    else if (key === 'in2') { if (t.in2 && t.in2 !== 'none') feats.push(['in2:' + tasteSrc(t.in2), 1]); }
    else if (key === 'mirror') feats.push(['mirror:' + (t.mirror || 0), 1]);
    else if (['zoom', 'spin', 'trails', 'color', 'warp'].includes(key)) feats.push([tasteFeats(t).find((f) => f.startsWith(key + ':')), 1]);
    else if (TASTE_FX.includes(key)) feats.push(['fx:' + key, (t[key] || 0) > 12 ? 1 : -1]);
  }
  if (!feats.length || ['shared', 'none'].includes(tasteSource().kind)) return;
  const { votes } = tasteTarget();
  let added = 0;
  for (const [f, s] of feats) {
    if (!f || votes.some((v) => v.src === 'pin' && v.sid === taste.sid && v.feats[0] === f && Date.now() - v.t < 60000)) continue;
    votes.push({ t: Date.now(), src: 'pin', w: 0.5 * s, feats: [f], sid: taste.sid });
    added++;
  }
  if (added) saveTaste();
}

// The lines that say what Autopilot follows and what it has learned
function tasteSummary() {
  const el = $('#tasteSum');
  if (!el) return;
  let M;
  try { taste.model = null; M = tasteModel(); } catch (_) { return; }
  const { up, down } = M.n, src = M.src, rated = up + down;
  let text = rated ? `Learned from ${rated} rating${rated === 1 ? '' : 's'} (${up} more like this, ${down} not this).`
    : src.kind === 'session' ? 'Nothing rated in this session yet. Press More like this or Not this under the picture.'
    : src.kind === 'none' ? (taste.profiles.length || taste.sharedList.length ? 'Tap a profile for Autopilot to follow it, or start a taste session to make a new one.'
      : 'No taste profiles yet. Start a taste session (or just press More like this or Not this under the picture) to make one.')
    : 'This profile has no ratings yet.';
  if (rated && apSet.taste === 0) text += ' Follow my taste is Off, so Autopilot isn’t using it.';
  else if (rated && rated < 15) text += ' It gets better at guessing after about 15 ratings.';
  el.textContent = text;
  const st = $('#tasteState');
  st.innerHTML = src.training
    ? `<span class="live"></span><b>Training “${escapeHTML(src.name)}” again.</b> Autopilot follows it and your new ratings; they’re added to it when you finish.`
    : src.kind === 'session'
    ? '<span class="live"></span><b>Taste session under way.</b> Your ratings make a new profile; Autopilot learns from them as you go.'
    : src.kind === 'none' ? 'Autopilot isn’t following a taste profile.'
    : `Autopilot follows <b>${escapeHTML(src.name)}</b>${src.kind === 'shared' ? ' (shared by the admin)' : ''}. Tap it again to stop.`;
  // Train again: for the lit profile, when it's one of your own
  const tr = $('#sessionTrain'), lit = src.kind === 'own' ? src.p : null;
  tr.hidden = !!taste.session || !lit;
  if (lit) $('#sessionTrainLbl').textContent = `Train “${lit.name}” again`;
  // The bar under the picture during a session, and the rating buttons and timer in full screen
  $('#sessionBar').hidden = !taste.session;
  fsTasteShow();
  const sb = $('#sessionStart');
  sb.setAttribute('aria-pressed', String(!!taste.session));
  sb.lastChild.textContent = taste.session ? 'Taste session under way' : 'Start taste session';
  if (taste.session) {
    const v = taste.session.votes, u = v.filter((x) => x.src === 'up').length, d = v.filter((x) => x.src === 'down').length;
    const what = src.training ? `Training “${escapeHTML(src.name)}”` : 'Taste session';
    $('#sessionText').innerHTML = `<b>${what}</b> · ${u + d ? `${u + d} rated (${u} more like this, ${d} not this)` : 'nothing rated yet'}`;
    $('#sessionFinish').textContent = src.training ? 'Finish and add them' : 'Finish and name it';
  }
}
// In full screen, the timer and rating buttons show only while a taste session is under way
function fsTasteShow() {
  const el = $('#fsTaste');
  if (el) {
    el.hidden = !(taste.session && (document.fullscreenElement || document.webkitFullscreenElement));
    if (apSet.fsKeep && taste.session) el.classList.remove('away');
  }
}
const tasteIsAdmin = () => { try { return !!adminKey; } catch (_) { return false; } };
// The profile tiles: yours, then the shared ones
let tasteRen = null;
function renderTaste() {
  const list = $('#tasteList');
  if (!list) return;
  const admin = tasteIsAdmin(), lit = taste.session ? null : tasteSource().p;
  list.innerHTML = '';
  const tile = (p, isShared) => {
    const t = document.createElement('div');
    t.className = 'pre tp';
    t.dataset.id = p.id;
    const name = escapeHTML(p.name), n = tasteCount(p.votes);
    const sw = p.thumb ? `<span class="sw" style="background-image:url(${p.thumb})"></span>` : '<span class="sw blank"></span>';
    const ics = [];
    if (!isShared || admin) ics.push(`<button class="tp-ic ren" title="Rename" aria-label="Rename ${name}">✎</button>`);
    ics.push(`<button class="tp-ic file" title="Save as a file to send to someone" aria-label="Save ${name} as a file">⤓</button>`);
    if (!isShared && admin && n) ics.push(`<button class="tp-ic share" title="Share with everyone" aria-label="Share ${name} with everyone">⇪</button>`);
    if (!isShared || admin) ics.push(`<button class="tp-ic del" title="${isShared ? 'Take away from everyone' : 'Delete'}" aria-label="${isShared ? 'Take ' + name + ' away from everyone' : 'Delete ' + name}">×</button>`);
    const ask = isShared ? `Take “${name}” away from everyone?` : `Delete “${name}”?`;
    const yes = isShared ? 'Take away' : 'Delete';
    t.innerHTML =
      `<button class="tp-load" aria-pressed="${lit === p}" title="${lit === p ? 'Stop following' : 'Have Autopilot follow'} ${name}">${sw}` +
      `${isShared ? '<span class="pre-auto">SHARED</span>' : ''}<span class="nm">${name}</span>` +
      `<span class="ct">${n ? `${n} rating${n === 1 ? '' : 's'}` : 'no ratings'}</span></button>` +
      `<div class="tp-ics">${ics.join('')}</div>` +
      `<div class="pre-confirm" hidden><span>${ask}</span><div><button class="yes">${yes}</button><button class="no">Keep</button></div></div>`;
    t.querySelector('.tp-load').addEventListener('click', () => tasteUse(p));
    const on = (cls, fn) => { const b = t.querySelector('.tp-ic.' + cls); if (b) b.addEventListener('click', fn); };
    const confirmBox = t.querySelector('.pre-confirm');
    on('ren', () => tasteRenOpen(p, isShared));
    on('file', () => tasteFileSave(p));
    on('share', () => tasteShare(p));
    on('del', () => { confirmBox.hidden = false; confirmBox.querySelector('.no').focus(); });
    confirmBox.querySelector('.no').addEventListener('click', () => { confirmBox.hidden = true; });
    confirmBox.querySelector('.yes').addEventListener('click', () => { confirmBox.hidden = true; if (isShared) tasteUnshare(p); else tasteDelete(p); });
    return t;
  };
  for (const p of taste.profiles) list.appendChild(tile(p, false));
  for (const p of taste.sharedList) list.appendChild(tile(p, true));
  $('#tasteAdminNote').hidden = !admin;
  tasteSummary();
}
// Tapping a profile: Autopilot follows it; tapping the lit one puts it out (during a session, the session comes first)
function tasteUse(p) {
  if (taste.session) { toast('A taste session is under way. Finish or cancel it under the picture first.'); return; }
  if (taste.active === p.id) {
    taste.active = null;
    saveTaste();
    toast(`Autopilot no longer follows “${p.name}”. Tap it again to have it back.`);
    return;
  }
  taste.active = p.id;
  saveTaste();
  toast(`Autopilot follows “${p.name}” now.${apSet.taste === 0 ? ' (Follow my taste is at Off, so turn it up to hear it.)' : ''}`);
}
function tasteDelete(p) {
  taste.profiles = taste.profiles.filter((x) => x !== p);
  if (taste.active === p.id) taste.active = null;
  taste.pending = [];
  saveTaste();
  toast(`Deleted “${p.name}”.`);
}
// Renaming, in the little form under the tiles
function tasteRenOpen(p, isShared) {
  tasteRen = { id: p.id, shared: isShared };
  $('#tasteRenLbl').textContent = `New name for “${p.name}”`;
  $('#tasteRenName').value = p.name;
  $('#tasteRenForm').hidden = false;
  $('#tasteRenName').focus();
  $('#tasteRenName').select();
}
function tasteRenClose() { $('#tasteRenForm').hidden = true; tasteRen = null; }
$('#tasteRenCancel').addEventListener('click', tasteRenClose);
$('#tasteRenName').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); tasteRenClose(); } });
$('#tasteRenForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = tasteRen;
  tasteRenClose();
  if (!r) return;
  const name = $('#tasteRenName').value.trim().slice(0, 40);
  if (!name) return;
  if (r.shared) {
    toast('Renaming…', 15000);
    if (await changeShared((list) => list, `Rename shared taste profile to "${name}"`, (tl) => tl.map((p) => (p.id === r.id ? { ...p, name } : p)))) {
      toast(`Renamed to “${name}”. Everyone sees the new name in about a minute.`);
    }
    return;
  }
  const p = taste.profiles.find((x) => x.id === r.id);
  if (!p) return;
  p.name = tasteFreeName(name, p.id);
  saveTaste();
  toast(`Renamed to “${p.name}”.`);
});

// Taste sessions: a new profile from scratch, named when it's finished
// into: a profile of yours to train again (its ratings are added to when the session finishes); none for a new one
function sessionStart(into) {
  if (taste.session) { toast('A taste session is already under way. Rate looks, then press Finish under the picture.'); return; }
  const p = into && taste.profiles.find((x) => x.id === into);
  taste.session = { votes: [], started: Date.now(), into: p ? p.id : null };
  taste.pending = [];
  saveTaste();
  // Autopilot brings looks to rate, starting with a new one now
  nextLook('session');
  toast(p ? `Training “${p.name}” again. Autopilot follows it; rate what it brings, then press Finish and add them.`
    : 'Taste session started. Rate looks with More like this and Not this under the picture (or Y and X), then press Finish and name it.', 9000);
}
function sessionFinish() {
  const s = taste.session;
  if (!s) return;
  if (!tasteCount(s.votes)) { toast('Rate a few looks first with More like this and Not this, then finish.'); return; }
  // Training a profile again: the new ratings go straight into it
  const into = s.into && taste.profiles.find((x) => x.id === s.into);
  if (into) {
    const n = tasteCount(s.votes);
    into.votes = into.votes.concat(s.votes);
    into.saved = Date.now();
    taste.active = into.id;
    taste.session = null;
    taste.pending = [];
    saveTaste();
    toast(`Added ${n} rating${n === 1 ? '' : 's'} to “${into.name}” (${tasteCount(into.votes)} in all). Autopilot follows it.`, 7000);
    return;
  }
  $('#sessionForm').hidden = false;
  $('#sessionName').value = tasteFreeName(`Taste ${taste.profiles.length + 1}`);
  $('#sessionName').focus();
  $('#sessionName').select();
}
function sessionFormClose() { $('#sessionForm').hidden = true; }
let sessionCancelArmed = 0;
function sessionCancel() {
  const s = taste.session;
  if (!s) return;
  const n = tasteCount(s.votes), b = $('#sessionCancel');
  if (n && !sessionCancelArmed) {
    b.classList.add('armed');
    b.textContent = `Press again to throw away ${n} rating${n === 1 ? '' : 's'}`;
    sessionCancelArmed = setTimeout(() => { sessionCancelArmed = 0; b.classList.remove('armed'); b.textContent = 'Cancel'; }, 4000);
    return;
  }
  clearTimeout(sessionCancelArmed);
  sessionCancelArmed = 0;
  b.classList.remove('armed');
  b.textContent = 'Cancel';
  taste.session = null;
  taste.pending = [];
  sessionFormClose();
  saveTaste();
  const now = tasteSource();
  toast(`Taste session cancelled.${now.kind === 'none' ? '' : ` Autopilot follows “${now.name}” again.`}`);
}
$('#sessionStart').addEventListener('click', () => sessionStart());
$('#sessionTrain').addEventListener('click', () => { const s = tasteSource(); if (s.kind === 'own') sessionStart(s.p.id); });
$('#sessionFinish').addEventListener('click', sessionFinish);
$('#sessionCancel').addEventListener('click', sessionCancel);
$('#sessionBack').addEventListener('click', sessionFormClose);
$('#sessionName').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); sessionFormClose(); } });
$('#sessionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = taste.session;
  if (!s) { sessionFormClose(); return; }
  const name = tasteFreeName($('#sessionName').value.trim() || `Taste ${taste.profiles.length + 1}`);
  sessionFormClose();
  // A picture of the screen as it finishes, for the profile's tile
  let thumb = '';
  try { thumb = await Promise.race([new Promise((res) => { thumbReq = res; }), new Promise((res) => setTimeout(() => res(''), 3000))]); } catch (_) {}
  const p = { id: tasteNew(), name, votes: s.votes, thumb: tasteThumbOK(thumb) ? thumb : '', saved: Date.now() };
  taste.profiles.push(p);
  taste.active = p.id;
  taste.session = null;
  taste.pending = [];
  saveTaste();
  const n = tasteCount(p.votes);
  toast(`Saved the taste profile “${name}” (${n} rating${n === 1 ? '' : 's'}). Autopilot follows it now.`, 7000);
});

// Files: a profile saved as a small .json file that anyone can open in Phosphor Loop (Open a taste file…, or drop
// it on the page)
const tasteSlim = (votes) => votes.map(({ sid, k, gen, gens, look, ...v }) => v);
function tasteFileSave(p) {
  const data = { kind: TASTE_FILE_KIND, v: 1, name: p.name, saved: Date.now(), thumb: p.thumb || '', votes: tasteSlim(p.votes) };
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'taste';
  offerFile(`taste-${slug}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
}
async function tasteFileOpen(file) {
  let d = null;
  try { d = JSON.parse(await file.text()); } catch (_) {}
  if (!d || d.kind !== TASTE_FILE_KIND || !Array.isArray(d.votes)) { toast('That file isn’t a Phosphor Loop taste profile.'); return; }
  const p = cleanTasteProfile({ id: tasteNew(), name: tasteFreeName(d.name || file.name.replace(/\.json$/i, '')), votes: d.votes, thumb: d.thumb, saved: Date.now() });
  if (!p || !p.votes.length) { toast('That taste file has no ratings in it.'); return; }
  taste.profiles.push(p);
  if (!taste.session) taste.active = p.id;
  saveTaste();
  const n = tasteCount(p.votes);
  toast(`Added the taste profile “${p.name}” (${n} rating${n === 1 ? '' : 's'}).${taste.session ? ' Tap it after your session to follow it.' : ' Autopilot follows it now.'}`, 7000);
}
$('#tasteOpen').addEventListener('click', () => $('#tasteFile').click());
$('#tasteFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) tasteFileOpen(f); e.target.value = ''; });

// Admin: sharing a profile with everyone (the same name replaces the shared one), renaming or taking one away
async function tasteShare(p) {
  if (!tasteCount(p.votes)) { toast('Rate a few looks into this profile first.'); return; }
  toast('Sharing…', 15000);
  const entry = { name: p.name, votes: tasteSlim(p.votes).slice(-200), thumb: p.thumb || '', saved: Date.now() };
  if (await changeShared((list) => list, `Share taste profile "${p.name}"`, (tl) => {
    const same = tl.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    return same ? tl.map((x) => (x === same ? { ...x, ...entry } : x)) : [...tl, { id: 'x' + Date.now().toString(36) + randId(4), ...entry }];
  })) toast(`Shared “${p.name}” with everyone. They see it under Taste profiles in about a minute.`, 7000);
}
async function tasteUnshare(p) {
  toast(`Taking “${p.name}” away…`, 15000);
  if (await changeShared((list) => list, `Remove shared taste profile "${p.name}"`, (tl) => tl.filter((x) => x.id !== p.id))) {
    if (taste.active === p.id) { taste.active = null; saveTaste(); }
    toast(`“${p.name}” is gone for everyone in about a minute.`);
  }
}
// The shared profiles in presets.json (and the single shared taste from before there were profiles)
function cleanSharedTastes(list, old) {
  const out = Array.isArray(list) ? list.map(cleanTasteProfile).filter(Boolean) : [];
  if (!out.length && old && Array.isArray(old.votes)) {
    const p = cleanTasteProfile({ id: 'sharedtaste', name: 'Shared taste', votes: old.votes, saved: old.saved });
    if (p && p.votes.length) out.push(p);
  }
  return out.slice(0, 16);
}

$('#apFsKeep').addEventListener('click', () => {
  apSet.fsKeep = !apSet.fsKeep;
  saveAp();
  syncApUI();
  if (isFS()) fsWake();
  toast(apSet.fsKeep ? 'In full screen during a taste session, the timer and rating buttons now stay showing.' : 'In full screen, the timer and rating buttons fade away when the mouse is still.');
});
$('#apHints').addEventListener('click', () => {
  apSet.hints = !apSet.hints;
  saveAp();
  syncApUI();
  toast(apSet.hints ? 'Learn from hints is on: quick skips and pins count a little too.' : 'Learn from hints is off: only More like this and Not this count.');
});

/* ================= autopilot settings ================= */
function fmtDur(s) {
  if (s < 9.5) return `${s.toFixed(1)} SEC`;
  if (s < 59.5) return `${Math.round(s)} SEC`;
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')} MIN`;
}
const apCtl = {
  every: { text: () => fmtDur(apEverySec()) },
  fade: { text: () => fmtDur(apFadeSec()) },
  wild: { text: (v) => (v === 50 ? 'USUAL' : String(v)) },
  mix: { text: (v) => (v === 0 ? 'NEVER' : v === 50 ? 'USUAL' : String(v)) },
  taste: { text: (v) => (v === 0 ? 'OFF' : v === 50 ? 'USUAL' : String(v)) },
};
function showAp(k) {
  const c = apCtl[k];
  c.el.value = apSet[k];
  fillTrack(c.el);
  c.out.textContent = c.text(apSet[k]);
}
function syncApUI() {
  Object.keys(apCtl).forEach(showAp);
  $('#apBeat').setAttribute('aria-pressed', String(apSet.beat));
  $('#apCheck').setAttribute('aria-pressed', String(apSet.check));
  $('#apHints').setAttribute('aria-pressed', String(apSet.hints));
  $('#apFsKeep').setAttribute('aria-pressed', String(apSet.fsKeep));
  tasteSummary();
  $$('#apTouch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.touch === apSet.touch)));
  syncApLoops();
  $$('#apInputs button').forEach((b) => {
    const k = b.dataset.apsrc, on = !apSet.off.includes(k), lv = levelOf(apW(k));
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.wpie').innerHTML = pieSVG(on ? lv.pie : 0);
    b.setAttribute('aria-label', `${wName(k)}: ${on ? lv.name : 'Off'}`);
    b.title = 'Click to switch it off or on. Right-click (or press and hold) to set how often Autopilot brings it in.';
  });
  if (!wpop.hidden) renderWeights();
  syncLimUI();
  syncPins();
  apStatus();
}
for (const [k, c] of Object.entries(apCtl)) {
  const id = 'ap' + k[0].toUpperCase() + k.slice(1);
  c.el = $('#' + id);
  c.out = $('#' + id + 'Out');
  const set = (v) => {
    apSet[k] = v;
    showAp(k);
    saveAp();
    // A shorter wait takes effect straight away
    if (k === 'every' && ap.on) { ap.next = Math.min(ap.next, performance.now() + apEverySec() * 1000); ap.due = Math.min(ap.due, ap.next); }
    apStatus();
  };
  c.el.addEventListener('input', () => set(+c.el.value));
  c.el.addEventListener('dblclick', () => set(AP_DEFAULTS[k]));
}
$('#apBeat').addEventListener('click', () => {
  apSet.beat = !apSet.beat;
  saveAp();
  syncApUI();
  if (apSet.beat && !snd.analyser) toast('Change on the beat needs music: under React to sound, pick Computer sound or Microphone.');
});
$('#apCheck').addEventListener('click', () => {
  apSet.check = !apSet.check;
  // Switched off part way through trying looks: the hidden loop keeps the one it has, and changes as before
  if (!apSet.check) ap.prep = null;
  ap.glide = null;
  saveAp();
  syncApUI();
  toast(apSet.check ? 'Check each look is on. Autopilot tries each new look out of sight first and skips the poor ones.'
    : 'Check each look is off. You’ll see every look Autopilot makes. It still keeps the picture from turning white.');
});
// One toggle per kind of input. Lit means Autopilot may use it.
for (const [k, label] of AP_INPUTS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.apsrc = k;
  b.innerHTML = `<span class="led"></span>${label}<span class="wpie"></span>`;
  // Right-click (or press and hold on a touchscreen): how often Autopilot brings it in
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); openWeights(k, b); });
  // Inputs this device can't offer at all (Screen in the Android app, for one) get no toggle either
  const inBtn = $(`#inputs [data-src="${k}"]`);
  if (inBtn && inBtn.hidden) b.hidden = true;
  b.addEventListener('click', () => {
    const off = new Set(apSet.off);
    if (off.has(k)) off.delete(k);
    else if (off.size >= AP_INPUT_KEYS.length - 1) { toast('Leave at least one input on for Autopilot.'); return; }
    else off.add(k);
    apSet.off = [...off];
    saveAp();
    syncApUI();
    toast(off.has(k) ? `Autopilot won’t use ${label} from its next new look.` : `Autopilot can use ${label} again.`);
  });
  $('#apInputs').appendChild(b);
}
/* ----- How often: the menu a right-click on an input switch opens ----- */
// A pie that fills with the weight: empty for Off, half for Normal, whole for Lots
function pieSVG(frac) {
  let fill = '';
  if (frac >= 0.999) fill = '<circle cx="8" cy="8" r="6" class="pie-f"/>';
  else if (frac > 0) {
    const a = frac * 2 * Math.PI, x = 8 + 6 * Math.sin(a), y = 8 - 6 * Math.cos(a);
    fill = `<path class="pie-f" d="M8 8V2A6 6 0 ${frac > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z"/>`;
  }
  return `<svg class="pie" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.9" class="pie-r"/>${fill}</svg>`;
}
const sharePct = (q) => (q < 0.005 ? 'under 1%' : `${Math.round(q * 100)}%`);
const membersOf = (g) => worldsOK().filter((n) => sceneGroup(n) === g);
// Puts a weight on an input, or on one world or fractal (Off for an input switches it off, as a click on it does)
function setWeight(k, w) {
  const member = isMemberKey(k);
  if (member) {
    const name = k.slice(3);
    if (w === 0 && membersOf(sceneGroup(name)).every((n) => n === name || mW(n) === 0)) {
      toast(`Leave at least one on, or switch off ${wName(sceneGroup(name))} itself.`);
      return false;
    }
  } else if (w === 0) {
    if (!apSet.off.includes(k) && apSet.off.length >= AP_INPUT_KEYS.length - 1) { toast('Leave at least one input on for Autopilot.'); return false; }
    if (!apSet.off.includes(k)) apSet.off = [...apSet.off, k];
  } else apSet.off = apSet.off.filter((x) => x !== k);
  if (w !== 0 || member) { if (w === 1) delete apSet.weights[k]; else apSet.weights[k] = w; }
  saveAp();
  syncApUI();
  return true;
}
function renderWeights() {
  const k = wpKey, member = isMemberKey(k), g = member ? sceneGroup(k.slice(3)) : (k === 'world' || k === 'fractal' ? k : null);
  const lv = member ? levelOf(apW(k)) : apSet.off.includes(k) ? AP_LEVELS[0] : levelOf(apW(k));
  $('#wpopTitle').textContent = wName(k);
  const back = $('#wpopBack');
  back.hidden = !member;
  if (member) back.textContent = `‹ Back to ${wName(g)}`;
  $('#wpopQ').textContent = member ? `How often it’s the one picked among the ${GROUP_SAY[g]}` : 'How often Autopilot brings it in';
  const box = $('#wpopLevels');
  box.innerHTML = '';
  for (const L of AP_LEVELS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wlv';
    b.dataset.w = L.w;
    b.setAttribute('aria-pressed', String(L === lv));
    b.title = L.w === 0 ? 'Autopilot leaves it out' : `Autopilot uses it ${L.say}`;
    b.innerHTML = `${pieSVG(L.pie)}<span>${L.name}</span>`;
    b.addEventListener('click', () => { if (setWeight(k, L.w)) { const f = $(`#wpopLevels [data-w="${L.w}"]`); if (f) f.focus(); } });
    box.appendChild(b);
  }
  // Its share of the picks right now
  const sh = apShares(), q = sh[k] || 0, line = $('#wpopShare');
  if (lv.w === 0) line.textContent = member ? 'Switched off: Autopilot leaves it out.' : 'Switched off: Autopilot leaves it out from its next new look.';
  else if (!q) line.textContent = 'Autopilot can’t bring it in right now: it isn’t running. Once it is, this weight counts.';
  else line.textContent = member ? `About ${sharePct(q)} of all Autopilot’s input picks right now.` : `About ${sharePct(q)} of the inputs Autopilot picks right now.`;
  // A group lists its members, each with its own switch and weight
  const sub = $('#wpopSub');
  sub.hidden = !g || member;
  if (!sub.hidden) {
    $('#wpopSubQ').textContent = g === 'world' ? 'Which 3D world' : 'Which fractal';
    const list = $('#wpopMembers');
    list.innerHTML = '';
    for (const n of membersOf(g)) {
      const on = mW(n) > 0, L = levelOf(mW(n));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.member = n;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `${wName('sc:' + n)}: ${L.name}`);
      b.title = `${on ? `About ${sharePct(sh['sc:' + n] || 0)} of Autopilot’s picks. ` : ''}Click to switch it off or on. Right-click (or press and hold) to set how often.`;
      b.innerHTML = `<span class="led"></span>${wName('sc:' + n)}${pieSVG(L.pie)}`;
      b.addEventListener('click', () => { if (setWeight('sc:' + n, on ? 0 : 1)) { const f = $(`#wpopMembers [data-member="${n}"]`); if (f) f.focus(); } });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); wpKey = 'sc:' + n; renderWeights(); placeWeights(); const f = $('#wpopLevels [aria-pressed="true"]'); if (f) f.focus(); });
      list.appendChild(b);
    }
  }
}
// Next to the switch it belongs to on a wide screen; along the bottom on a narrow one (see the CSS)
function placeWeights() {
  if (wpop.hidden || !wpAnchor) return;
  if (matchMedia('(max-width: 600px)').matches) { wpop.style.left = wpop.style.top = ''; return; }
  const r = wpAnchor.getBoundingClientRect(), w = wpop.offsetWidth, h = wpop.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  wpop.style.left = `${Math.round(clamp(r.left, 8, innerWidth - w - 8))}px`;
  wpop.style.top = `${Math.round(top)}px`;
}
function openWeights(k, anchor) {
  if (wpop.hidden) wpReturn = document.activeElement;
  wpKey = k;
  wpAnchor = anchor;
  wpop.hidden = false;
  renderWeights();
  placeWeights();
  const f = $('#wpopLevels [aria-pressed="true"]');
  if (f) f.focus();
}
function closeWeights() {
  if (wpop.hidden) return;
  wpop.hidden = true;
  wpKey = null;
  if (wpReturn && wpReturn.focus && document.contains(wpReturn)) wpReturn.focus();
  wpReturn = null;
}
$('#wpopClose').addEventListener('click', closeWeights);
$('#wpopBack').addEventListener('click', () => {
  wpKey = sceneGroup(wpKey.slice(3));
  renderWeights();
  placeWeights();
  const f = $('#wpopLevels [aria-pressed="true"]');
  if (f) f.focus();
});
wpop.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeWeights(); }
  e.stopPropagation(); // keep the keys from firing while setting weights
});
document.addEventListener('pointerdown', (e) => { if (!wpop.hidden && !wpop.contains(e.target) && e.target !== wpAnchor && !(wpAnchor && wpAnchor.contains(e.target))) closeWeights(); }, true);
window.addEventListener('resize', placeWeights);
document.addEventListener('scroll', placeWeights, true);
// Loops Autopilot runs: one switch per loop (at least one stays on), and Take turns or All at once
function syncApLoops() {
  $$('#apLoops button').forEach((b) => b.setAttribute('aria-pressed', String(apSet.runs.includes(b.dataset.aploop))));
  $$('#apTurns button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.turns === '1') === apSet.turns)));
  // While Autopilot runs, each loop tab says whose loop it is
  for (const k of KEYS) {
    const el = $('#who' + k);
    if (!el) continue;
    const mine = apRuns(k);
    el.hidden = !ap.on;
    el.textContent = mine ? 'AUTO' : 'YOU';
    el.classList.toggle('auto', mine);
    el.title = mine ? `Autopilot runs loop ${k}` : `Loop ${k} is yours: Autopilot leaves it alone`;
  }
  syncPins();
}
$$('#apLoops button').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.aploop, on = apSet.runs.includes(k);
  if (on && apSet.runs.length === 1) { toast('Autopilot needs at least one loop. Switch another one on first, or stop Autopilot.'); return; }
  apSet.runs = on ? apSet.runs.filter((x) => x !== k) : KEYS.filter((x) => x === k || apSet.runs.includes(x));
  // A loop handed over to you stops building up, and nothing is tried out of sight unless Autopilot has A and B
  if (on) loops[k].ramp = null;
  if (!apPair()) { ap.prep = null; if (ap.glide && !apRuns(ap.glide.k)) ap.glide = null; }
  ap.turnN = 0;
  saveAp();
  syncApUI();
  if (ap.on && !on) apIntoLimits();
  const off = !loopOn(k) ? ` (it’s switched off under Loops right now)` : '';
  toast(on ? `Loop ${k} is yours now${off}. Autopilot leaves it alone.` : `Autopilot runs loop ${k} now${off}.`);
}));
$$('#apTurns button').forEach((b) => b.addEventListener('click', () => {
  apSet.turns = b.dataset.turns === '1';
  saveAp();
  syncApUI();
  toast(apSet.turns ? 'Take turns: one of Autopilot’s loops gets a new look each time.' : 'All at once: every one of Autopilot’s loops gets a new look together.');
}));
$$('#apTouch button').forEach((b) => b.addEventListener('click', () => {
  apSet.touch = b.dataset.touch;
  saveAp();
  syncApUI();
}));
$('#apUnpin').addEventListener('click', () => {
  ap.pins.clear();
  ap.pinVal = {};
  saveAp();
  syncApUI();
  toast(ap.on ? 'Nothing is pinned now. Autopilot changes everything from its next look.' : 'Nothing is pinned now.');
});
$('#apReset').addEventListener('click', () => {
  for (const k of ['every', 'fade', 'wild', 'mix', 'taste', 'beat', 'check', 'hints', 'touch', 'turns']) apSet[k] = AP_DEFAULTS[k];
  apSet.runs = [...AP_DEFAULTS.runs];
  apSet.off = [];
  apSet.lim = {};
  apSet.weights = {};
  saveAp();
  syncApUI();
  toast(ap.pins.size ? 'Autopilot settings and fader limits are back to normal. Your pins are still pinned.' : 'Autopilot settings and fader limits are back to normal.');
});
// The line at the top of Autopilot settings: on or off, when the next look comes, what's pinned, and what
// Check each look and the white-out watch are doing
function apStatus() {
  let html;
  if (!ap.on) html = 'Autopilot is off. Press <b>Autopilot</b> (at the top of Autopilot, under the picture, or the P key) to start it.';
  else {
    const s = Math.max(0, Math.round((ap.next - performance.now()) / 1000));
    const P = ap.prep, holding = P && P.hold && !P.ok;
    html = '<span class="live"></span><b>Autopilot is on.</b> ' +
      (holding ? 'New look as soon as one passes its check.'
        : ap.beatWait ? 'New look on the next beat.' : s <= 1 ? 'New look coming now.' : `Next new look in about ${s < 60 ? s + ' seconds' : fmtDur(s).toLowerCase()}.`);
    if (watch.easing) html += ` Easing off loop ${watch.easing} so it doesn’t turn white.`;
    else if (P && !P.ok) html += ` Trying out looks out of sight (${P.tries} of up to ${CHECK.tries}).`;
    else if (P && P.ok) html += ' The next one is checked and ready.';
    if (ap.pins.size) html += ` ${ap.pins.size} pinned.`;
  }
  if (html !== apStatus.shown) { apStatus.shown = html; $('#apState').innerHTML = html; }
  const cs = checkStatText();
  if (cs !== apStatus.cs) { apStatus.cs = cs; $('#apCheckStat').textContent = cs; }
}

/* ================= fader limits ================= */
// The Fader limits menu: one slider with two handles for each slider Autopilot moves, lowest on the left and
// highest on the right. It slides in over the controls, so the picture stays in view while you set them.
const limDlg = $('#lim'), limRows = {};
const limFull = (k) => !apSet.lim[k];
function limText(k, v) {
  if (k === 'view') return String(v);
  if (k === 'mirror') return v === 0 ? 'OFF' : `${v} WAY`;
  return sliderText(k, v);
}
function limReadout(k) {
  const r = apSet.lim[k];
  if (!r) return 'ANY';
  return r[0] === r[1] ? `ALWAYS ${limText(k, r[0])}` : `${limText(k, r[0])} – ${limText(k, r[1])}`;
}
function showLim(k) {
  const R = limRows[k];
  if (!R) return;
  const [a, b] = limScale(k);
  const [lo, hi] = apSet.lim[k] || [a, b];
  R.lo.value = lo;
  R.hi.value = hi;
  R.dual.style.setProperty('--fa', (lo - a) / (b - a));
  R.dual.style.setProperty('--fb', (hi - a) / (b - a));
  // When the two handles meet, the one that can still move goes on top
  const loTop = lo > (a + b) / 2;
  R.lo.style.zIndex = loTop ? 3 : 2;
  R.hi.style.zIndex = loTop ? 2 : 3;
  R.out.textContent = limReadout(k);
  R.out.classList.toggle('any', limFull(k));
  R.row.classList.toggle('set', !limFull(k));
}
// The line under the Fader limits button says which sliders have limits
function limSummary() {
  const set = [...LIM_LOOP, ...LIM_MIX].filter((k) => !limFull(k));
  $('#limSum').textContent = set.length
    ? `Limits on ${set.map((k) => PINS[k].name).join(', ')}.`
    : 'No limits yet: Autopilot can use the whole of every slider.';
  $('#limCount').textContent = set.length ? String(set.length) : '';
  $('#limCount').hidden = !set.length;
  $('#limReset').disabled = !set.length;
}
function syncLimUI() {
  Object.keys(limRows).forEach(showLim);
  limSummary();
}
function setLim(k, lo, hi) {
  const [a, b] = limScale(k);
  if (lo <= a && hi >= b) delete apSet.lim[k];
  else apSet.lim[k] = [lo, hi];
  showLim(k);
  limSummary();
  saveAp();
  // While Autopilot runs, anything now outside the limits eases just inside them straight away
  if (ap.on) { apIntoLimits(); syncUI(); }
}
function limRow(k, holder) {
  const main = $('#' + k);
  const [a, b] = limScale(k);
  const name = PINS[k].name, g = limGrain(k);
  const row = document.createElement('div');
  row.className = 'ctl lim-row';
  row.innerHTML =
    `<div class="ctl-head"><span class="lbl">${name}</span><output></output></div>` +
    `<div class="dual${a < 0 ? ' bipolar' : ''}"><i class="dual-track"></i>` +
    `<input type="range" class="lo" min="${a}" max="${b}" step="${g}" aria-label="${name}: lowest Autopilot may set">` +
    `<input type="range" class="hi" min="${a}" max="${b}" step="${g}" aria-label="${name}: highest Autopilot may set"></div>`;
  // Mirror is five buttons on the panel, so here its stops are named under the slider, each under its handle spot
  if (k === 'mirror') {
    const ticks = document.createElement('div');
    ticks.className = 'lim-ticks';
    ticks.setAttribute('aria-hidden', 'true');
    for (let v = a; v <= b; v += g) {
      const s = document.createElement('span');
      s.textContent = v === 0 ? 'Off' : String(v);
      s.style.setProperty('--p', (v - a) / (b - a));
      ticks.appendChild(s);
    }
    row.appendChild(ticks);
  }
  const ends = main && main.closest('.ctl') && main.closest('.ctl').querySelector('.ends');
  if (ends && k !== 'mirror') row.appendChild(ends.cloneNode(true));
  if (k === 'view') {
    const e = document.createElement('div');
    e.className = 'ends';
    e.innerHTML = '<span>A only</span><span>Both</span><span>B only</span>';
    row.appendChild(e);
  }
  if (k === 'trails') {
    const h = document.createElement('span');
    h.className = 'hint';
    h.textContent = 'Autopilot still keeps the two loops from both going over 75 at once, unless your lowest is 75 or higher.';
    row.appendChild(h);
  }
  holder.appendChild(row);
  const R = limRows[k] = { row, dual: row.querySelector('.dual'), lo: row.querySelector('.lo'), hi: row.querySelector('.hi'), out: row.querySelector('output') };
  // The handles can meet but never cross
  R.lo.addEventListener('input', () => { const hi = +R.hi.value, lo = Math.min(+R.lo.value, hi); setLim(k, lo, hi); });
  R.hi.addEventListener('input', () => { const lo = +R.lo.value, hi = Math.max(+R.hi.value, lo); setLim(k, lo, hi); });
  // Double-click opens it back up to the whole slider
  R.dual.addEventListener('dblclick', () => setLim(k, a, b));
  // Tapping the track moves the nearer handle there
  R.dual.addEventListener('pointerdown', (e) => {
    if (e.target !== R.dual && !e.target.classList.contains('dual-track')) return;
    const box = R.dual.getBoundingClientRect();
    const v = limSnap(k, a + clamp((e.clientX - box.left - 8) / Math.max(1, box.width - 16), 0, 1) * (b - a));
    const lo = +R.lo.value, hi = +R.hi.value;
    const useLo = v < lo || (v <= hi && v - lo <= hi - v);
    if (useLo) setLim(k, v, hi); else setLim(k, lo, v);
    (useLo ? R.lo : R.hi).focus();
  });
}
LIM_LOOP.forEach((k) => limRow(k, $('#limLoops')));
LIM_MIX.forEach((k) => limRow(k, $('#limMix')));
$('#limReset').addEventListener('click', () => {
  apSet.lim = {};
  saveAp();
  syncLimUI();
  toast('Every slider is back to its whole range for Autopilot.');
});

let limReturn = null;
const limWide = () => !matchMedia('(max-width: 900px)').matches;
function openLim() {
  if (!limDlg.hidden) return;
  limReturn = document.activeElement;
  syncLimUI();
  limDlg.hidden = false;
  $('#limBody').scrollTop = 0;
  $('#limOpen').setAttribute('aria-expanded', 'true');
  // Over the controls on a wide screen, so the picture stays in sight; the whole page on a narrow one
  if (!limWide()) document.documentElement.style.overflow = 'hidden';
  $('#limClose').focus();
}
function closeLim() {
  if (limDlg.hidden) return;
  limDlg.hidden = true;
  $('#limOpen').setAttribute('aria-expanded', 'false');
  document.documentElement.style.overflow = '';
  if (limReturn && limReturn.focus) limReturn.focus();
}
$('#limOpen').addEventListener('click', () => (limDlg.hidden ? openLim() : closeLim()));
$('#limClose').addEventListener('click', closeLim);
limDlg.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); closeLim(); }
  else e.stopPropagation(); // keep the keys from firing while setting limits
});

setInterval(apStatus, 500);
// The countdown beside More like this and Not this: seconds left on this look, with a ring that empties as they
// run out. Once the time is up it says what it's waiting for (a look passing its check, or the beat).
function lookClock() {
  const el = $('#lookClock');
  let text, p = 0, off = false;
  // Each said the long way and the short way (a phone, and the full-screen timer, show the short one)
  let short = '';
  const say = (long, sh) => { short = sh; return `<span class="lc-l">${long}</span><span class="lc-s">${sh}</span>`; };
  if (!ap.on) { text = say('Autopilot off', 'Off'); off = true; }
  else if (frozen) { text = say('Frozen', 'Frozen'); off = true; }
  else if (ap.beatWait) text = say('Next look on the beat', 'On beat');
  else {
    const left = (ap.due - performance.now()) / 1000;
    if (left > 0.5) {
      const s = Math.ceil(left), t = `<b>${s < 60 ? s + ' s' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</b>`;
      text = say(`Next look in ${t}`, t);
      p = clamp(left * 1000 / ap.span, 0, 1);
    } else text = ap.prep && ap.prep.hold && !ap.prep.ok ? say('Checking the next look…', 'Checking…') : say('Next look coming up', 'Coming up');
  }
  if (text !== lookClock.shown) { lookClock.shown = text; $('#lookClockText').innerHTML = text; el.classList.toggle('off', off); $('#fsClockText').innerHTML = short; }
  el.style.setProperty('--p', p.toFixed(3));
  if (!$('#fsTaste').hidden) $('#fsClock').style.setProperty('--p', p.toFixed(3));
}
setInterval(lookClock, 200);
syncApUI();

/* ================= transport ================= */
const freezeBtn = $('#freeze');
function toggleFreeze(force) {
  frozen = typeof force === 'boolean' ? force : !frozen;
  freezeBtn.setAttribute('aria-pressed', String(frozen));
  if (frozen) showOSD('II', 'FROZEN');
}
freezeBtn.addEventListener('click', () => toggleFreeze());
function clearScreen() { clearTargets(); burst(); }
$('#clear').addEventListener('click', clearScreen);

const fullBtn = $('#full');
const fsEnabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
if (!fsEnabled) fullBtn.hidden = true;
function toggleFS() {
  if (!fsEnabled) return;
  const active = document.fullscreenElement || document.webkitFullscreenElement;
  try {
    if (active) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const r = (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage);
      if (r && r.catch) r.catch(() => toast('Full screen isn’t available here.'));
    }
  } catch (e) { toast('Full screen isn’t available here.'); }
}
fullBtn.addEventListener('click', toggleFS);
// In full screen the Exit button shows whenever the mouse moves or the picture is tapped, and fades
// (with the mouse pointer) after a few still seconds, so it never sits on top of the picture for long
const fsExit = $('#fsExit');
let fsIdleT = null;
const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const fsTaste = $('#fsTaste');
function fsWake(ms = 3000) {
  if (!isFS()) return;
  fsExit.classList.remove('away');
  fsTaste.classList.remove('away');
  stage.classList.remove('idle');
  clearTimeout(fsIdleT);
  fsIdleT = setTimeout(() => {
    if (fsExit.matches(':hover') || fsTaste.matches(':hover')) { fsWake(); return; }
    fsExit.classList.add('away');
    if (!(apSet.fsKeep && taste.session)) fsTaste.classList.add('away');
    stage.classList.add('idle');
  }, ms);
}
$('#fsRateUp').addEventListener('click', (e) => { rate(1); e.currentTarget.blur(); fsWake(); });
$('#fsRateDown').addEventListener('click', (e) => { rate(-1); e.currentTarget.blur(); fsWake(); });
// A mouse shows it just by moving; a finger or pen by tapping. Drawing with the mouse button held leaves it away.
stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.buttons) fsWake(); }, { passive: true });
stage.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') fsWake(); }, { passive: true });
fsExit.addEventListener('click', () => { if (isFS()) toggleFS(); });
['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
  const active = isFS();
  fullBtn.textContent = active ? 'Exit full screen' : 'Full screen';
  fsExit.hidden = !active;
  fsTasteShow();
  if (active) fsWake(4000);
  else { clearTimeout(fsIdleT); fsExit.classList.remove('away'); fsTaste.classList.remove('away'); stage.classList.remove('idle'); }
  fit();
}));

/* ================= picture & video files ================= */
const picFile = $('#picFile'), vidFile = $('#vidFile');
$('#pickPic').addEventListener('click', () => picFile.click());
$('#pickVid').addEventListener('click', () => vidFile.click());
picFile.addEventListener('change', () => { if (picFile.files[0]) loadFile(picFile.files[0]); picFile.value = ''; });
vidFile.addEventListener('change', () => { if (vidFile.files[0]) loadFile(vidFile.files[0]); vidFile.value = ''; });
$('#useCard').addEventListener('click', () => {
  uploadTo(picTex, testCard);
  picAspect = 4 / 3;
  $('#picName').textContent = 'the test card';
  $('#useCard').hidden = true;
  natNoCredit();
  nat.own = false;
  nat.ask++;   // nor the test card
});
function downscale(img) {
  const max = 1024;
  const w = img.naturalWidth, h = img.naturalHeight;
  const s = Math.min(1, max / Math.max(w, h));
  if (s === 1) return img;
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
let vidURL = null, vidUserPaused = false;
const vidPlay = $('#vidPlay');
vidPlay.addEventListener('click', () => {
  if (!vid.video) return;
  if (vid.video.paused) { vidUserPaused = false; vid.video.play().catch(() => {}); }
  else { vidUserPaused = true; vid.video.pause(); }
  vidPlay.textContent = vid.video.paused ? 'Play' : 'Pause';
});
function feedInto(src) {
  const t = loops[edit].tgt;
  if (t.in1 !== src && t.in2 !== src) t.in1 = src;
  settleDevices();
  syncUI();
  showOSD(`INPUT ${edit}`, SRC_LABEL[src].toUpperCase());
}
function loadFile(file) {
  if (!file) return;
  const type = file.type || '';
  // A taste profile someone sent (see Taste profiles)
  if (/\.json$/i.test(file.name || '') || type === 'application/json') { tasteFileOpen(file); return; }
  if (type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      uploadTo(picTex, downscale(img));
      picAspect = img.naturalWidth / img.naturalHeight;
      URL.revokeObjectURL(url);
      $('#picName').textContent = file.name;
      $('#useCard').hidden = false;
      natNoCredit();
      nat.own = true;
      nat.ask++;   // a nature picture still on its way doesn't replace this one
      feedInto('picture');
      toast(`Feeding ${file.name} into loop ${edit}.`);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That picture couldn’t be opened. Try a JPG or PNG.'); };
    img.src = url;
  } else if (type.startsWith('video/')) {
    clips.ask++;   // a library clip still on its way doesn't replace this one
    openVideo(URL.createObjectURL(file), file.name).then((ok) => {
      if (!ok) return;
      // A video of your own: Autopilot leaves it in place instead of bringing in library clips
      clips.own = true;
      clipNoCredit();
    });
  } else {
    toast('That file isn’t a picture or video.');
  }
}
// Puts a video (an object URL) in as the Video input. quiet: in place without switching any loop to it (Autopilot,
// or the page opening). Resolves true once its first frame is ready, false if it can't be played.
function openVideo(url, name, { quiet = false } = {}) {
  return new Promise((resolve) => {
    const v = mkVideo();
    v.loop = true;
    v.src = url;
    v.addEventListener('loadeddata', () => {
      if (vidURL) URL.revokeObjectURL(vidURL);
      vidURL = url;
      vid.attach(v, null);
      vidUserPaused = false;
      say($('#vidStatus'), `<span class="live"></span><b>${escapeHTML(name)}</b>`);
      $('#vcr').hidden = false;
      vidPlay.textContent = 'Pause';
      vidLoopA = null; vidLoopB = null; loopText();
      v.playbackRate = vidRate;
      $('#vidDur').textContent = fmtT(v.duration);
      if (quiet) settleDevices();   // plays only while a loop uses it
      else { feedInto('video'); toast(`Feeding ${name} into loop ${edit}.`); }
      resolve(true);
    }, { once: true });
    v.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      if (!quiet) toast('That video couldn’t be played here. Try an MP4 or WebM file.');
      resolve(false);
    }, { once: true });
    v.play().catch(() => {});
  });
}
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ================= nature pictures ================= */
// About 500 photos from Wikimedia Commons' Featured Pictures live in the nature folder, listed in
// nature/pictures.json. The list loads the first time it's needed, the small thumbnails only when the
// gallery opens, and a full picture only when it's picked.
const nat = { pics: null, cats: [], cur: -1, cat: 'all', req: null, built: false, ask: 0, own: false };   // own: a picture of the person's own is in
const NAT_TAB_KEY = 'phosphor-nature-tab', NAT_LAST_KEY = 'phosphor-nature-last';
try { nat.cat = localStorage.getItem(NAT_TAB_KEY) || 'all'; } catch (_) { /* fine, start on All */ }
const natDlg = $('#nat'), natGrid = $('#natGrid'), natTabs = $('#natTabs');
function natList() {
  if (!nat.req) {
    nat.req = fetch('nature/pictures.json')
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => {
        nat.pics = d.pics || [];
        nat.cats = d.cats || [];
        if (nat.cat !== 'all' && !nat.cats.some((c) => c.id === nat.cat)) nat.cat = 'all';
        return nat.pics;
      })
      .catch((e) => { nat.req = null; throw e; });
  }
  return nat.req;
}
function natNoList() { toast('The nature pictures couldn’t be loaded. They need internet the first time.'); }
// The pictures in the chosen kind (or all of them), as positions in the full list
function natShown() {
  const all = nat.pics.map((_, i) => i);
  return nat.cat === 'all' ? all : all.filter((i) => nat.pics[i].c === nat.cat);
}
function natNoCredit() {
  nat.cur = -1;
  try { localStorage.removeItem(NAT_LAST_KEY); } catch (_) { /* fine */ }
  $('#picCredit').hidden = true;
  natMark();
}
function natMark() {
  for (const t of natGrid.children) t.setAttribute('aria-current', String(+t.dataset.i === nat.cur));
}
// quiet: put the picture in place without switching any loop to it (used when the page opens)
function natPick(i, quiet) {
  const p = nat.pics && nat.pics[i];
  if (!p) return;
  const ask = ++nat.ask;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (ask !== nat.ask) return;   // a later pick overtook this one
    uploadTo(picTex, downscale(img));
    picAspect = img.naturalWidth / img.naturalHeight;
    $('#picName').textContent = p.n;
    $('#useCard').hidden = false;
    nat.cur = i;
    nat.own = false;
    const credit = $('#picCredit');
    credit.innerHTML = `Photo: ${escapeHTML(p.by)} · <a href="${escapeHTML(p.src)}" target="_blank" rel="noopener">${escapeHTML(p.lic)}</a>`;
    credit.hidden = false;
    natMark();
    try { localStorage.setItem(NAT_LAST_KEY, p.f); } catch (_) { /* fine */ }
    if (quiet) return;
    const was = loops[edit].tgt.in1 === 'picture' || loops[edit].tgt.in2 === 'picture';
    feedInto('picture');
    if (was) showOSD('PICTURE', p.n.toUpperCase());
  };
  img.onerror = () => { if (ask === nat.ask && !quiet) toast('That picture couldn’t be loaded. It needs internet the first time.'); };
  img.src = `nature/${p.f}.jpg`;
}
function natStep(dir) {
  natList().then(() => {
    const shown = natShown();
    if (!shown.length) return;
    const at = shown.indexOf(nat.cur);
    const next = at < 0 ? (dir > 0 ? 0 : shown.length - 1) : (at + dir + shown.length) % shown.length;
    natPick(shown[next]);
  }).catch(natNoList);
}
function natShuffle() {
  natList().then(() => {
    const shown = natShown().filter((i) => i !== nat.cur);
    if (shown.length) natPick(pick(shown));
  }).catch(natNoList);
}
function natBuild() {
  if (nat.built) return;
  nat.built = true;
  const count = (id) => (id === 'all' ? nat.pics.length : nat.pics.filter((p) => p.c === id).length);
  for (const c of [{ id: 'all', n: 'All' }, ...nat.cats]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.cat = c.id;
    b.innerHTML = `${escapeHTML(c.n)} <b>${count(c.id)}</b>`;
    b.addEventListener('click', () => {
      nat.cat = c.id;
      try { localStorage.setItem(NAT_TAB_KEY, c.id); } catch (_) { /* fine */ }
      natFilter();
      natDlg.scrollTop = 0;
    });
    natTabs.appendChild(b);
  }
  const frag = document.createDocumentFragment();
  nat.pics.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'nat-tile';
    b.dataset.i = i;
    b.title = p.n;
    b.innerHTML = `<img loading="lazy" decoding="async" alt="" src="nature/${escapeHTML(p.f)}-t.jpg"><span>${escapeHTML(p.n)}</span>`;
    frag.appendChild(b);
  });
  natGrid.appendChild(frag);
  natGrid.addEventListener('click', (e) => {
    const t = e.target.closest('.nat-tile');
    if (!t) return;
    natPick(+t.dataset.i);
    closeNat();
  });
}
function natFilter() {
  for (const b of natTabs.children) b.setAttribute('aria-pressed', String(b.dataset.cat === nat.cat));
  for (const t of natGrid.children) t.hidden = nat.cat !== 'all' && nat.pics[+t.dataset.i].c !== nat.cat;
  $('#natCount').textContent = `${natShown().length} PICTURES`;
}
let natReturn = null;
function openNat() {
  natList().then(() => {
    if (!natDlg.hidden) return;
    natBuild();
    natFilter();
    natMark();
    $('#natHint').textContent = `Tap a picture to feed it into loop ${edit}. ◀ ▶ and Shuffle beside Picture flip through this kind without opening the gallery.`;
    natReturn = document.activeElement;
    natDlg.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    const cur = natGrid.querySelector('[aria-current="true"]:not([hidden])');
    if (cur) cur.scrollIntoView({ block: 'center' }); else natDlg.scrollTop = 0;
    (cur || $('#natClose')).focus({ preventScroll: true });
  }).catch(natNoList);
}
function closeNat() {
  if (natDlg.hidden) return;
  natDlg.hidden = true;
  document.documentElement.style.overflow = '';
  if (natReturn && natReturn.focus) natReturn.focus();
}
$('#natOpen').addEventListener('click', openNat);
$('#natClose').addEventListener('click', closeNat);
$('#natShuffle').addEventListener('click', natShuffle);
$('#natShuffle2').addEventListener('click', () => { natShuffle(); closeNat(); });
$('#natPrev').addEventListener('click', () => natStep(-1));
$('#natNext').addEventListener('click', () => natStep(1));
natDlg.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); closeNat(); }
  else e.stopPropagation(); // keep the keys from firing while browsing
});
// The nature picture in use last time comes back when the page opens, so a saved look picks up where it was
(() => {
  let last = null;
  try { last = localStorage.getItem(NAT_LAST_KEY); } catch (_) { /* fine */ }
  if (last) natList().then((pics) => { const i = pics.findIndex((p) => p.f === last); if (i >= 0 && nat.cur < 0 && !nat.own) natPick(i, true); }).catch(() => {});
})();

/* ================= clip library (Phosphor Clips) ================= */
// Phosphor Clips (the Windows app in clip-app/ on the clip-app branch) grabs videos and GIFs from the web, trims them
// and sorts them into categories. It shares that library with this page from the same computer, at
// http://127.0.0.1:47811 (the next port or two if that one is taken), answering only Phosphor Loop's own sites.
// The page only looks for it once the Clip library button has been used in this browser: browsers ask before a
// website talks to programs on the computer, and other visitors shouldn't be asked. Picking a clip feeds it in as
// the Video input; Autopilot brings in clips from the categories ticked in the gallery (see apClip).
const CLIP_PORTS = [47811, 47812, 47813];
const CLIP_ON_KEY = 'phosphor-clips-on', CLIP_TAB_KEY = 'phosphor-clips-tab', CLIP_OFF_KEY = 'phosphor-clips-ap-off', CLIP_LAST_KEY = 'phosphor-clips-last';
// list: the clips (null until Phosphor Clips answers); cur: the clip in use; own: a video file of your own is in
const clips = { base: '', list: null, cats: [], at: 0, req: null, cur: '', own: false, ask: 0, cat: 'all', off: [] };
try {
  clips.cat = localStorage.getItem(CLIP_TAB_KEY) || 'all';
  clips.off = JSON.parse(localStorage.getItem(CLIP_OFF_KEY) || '[]');
  if (!Array.isArray(clips.off)) clips.off = [];
} catch (_) { /* fine, all categories */ }
const clipsDlg = $('#clips'), clipsGrid = $('#clipsGrid'), clipsTabs = $('#clipsTabs');
const clipsWanted = () => !APP && !inArtifact && lsGet(CLIP_ON_KEY) === '1';
const clipFetchOpts = (signal) => ({ cache: 'no-store', signal, targetAddressSpace: 'loopback' });
// The library from Phosphor Clips (asked again after 20 s, or straight away when fresh)
function clipList(fresh) {
  if (clips.req) return clips.req;
  if (!fresh && clips.list && performance.now() - clips.at < 20000) return Promise.resolve(clips.list);
  clips.req = (async () => {
    const bases = CLIP_PORTS.map((p) => `http://127.0.0.1:${p}`);
    if (clips.base) bases.sort((a, b) => (b === clips.base) - (a === clips.base));
    let why = null;
    for (const base of bases) {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 2500);
      try {
        const r = await fetch(base + '/library.json', clipFetchOpts(ac.signal));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (!d || d.app !== 'Phosphor Clips') throw new Error('not Phosphor Clips');
        clips.base = base;
        clips.list = Array.isArray(d.clips) ? d.clips : [];
        clips.cats = Array.isArray(d.cats) ? d.cats : [];
        clips.at = performance.now();
        if (clips.cat !== 'all' && !clips.list.some((c) => c.c === clips.cat)) clips.cat = 'all';
        return clips.list;
      } catch (e) { why = e; } finally { clearTimeout(t); }
    }
    clips.list = null;
    throw why || new Error('Phosphor Clips didn’t answer');
  })();
  clips.req.then(() => { clips.req = null; }, () => { clips.req = null; });
  return clips.req;
}
const clipCatName = (id) => { const c = clips.cats.find((x) => x.id === id); return c ? c.n : id; };
// The clips Autopilot may bring in: those in the ticked categories
const clipsAp = () => (clips.list || []).filter((c) => !clips.off.includes(c.c));
const clipsReady = () => !!clips.list && clipsAp().length > 0 && clipsWanted();
// The clips in the gallery's chosen category (or all of them)
const clipsShown = () => (clips.list || []).filter((c) => clips.cat === 'all' || c.c === clips.cat);
function clipNoCredit() {
  clips.cur = '';
  try { localStorage.removeItem(CLIP_LAST_KEY); } catch (_) { /* fine */ }
  $('#clipCredit').hidden = true;
  clipMark();
}
function clipMark() {
  for (const t of clipsGrid.children) t.setAttribute('aria-current', String(t.dataset.id === clips.cur));
}
// Feeds a library clip in as the Video input. quiet: in place, without switching a loop to Video (Autopilot, or
// bringing back the last clip when the page opens). Resolves true once it's showing.
function clipPick(c, quiet) {
  if (!c || !clips.base) return Promise.resolve(false);
  const ask = ++clips.ask;
  return fetch(`${clips.base}/clip/${encodeURIComponent(c.id)}`, clipFetchOpts())
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
    .then((blob) => {
      if (ask !== clips.ask) return false;   // a later pick (or a video of your own) overtook this one
      return openVideo(URL.createObjectURL(blob), c.n, { quiet }).then((ok) => {
        if (!ok || ask !== clips.ask) return ok;
        clips.cur = c.id;
        clips.own = false;
        const from = c.src && /^https?:/.test(c.src)
          ? ` · <a href="${escapeHTML(c.src)}" target="_blank" rel="noopener">${escapeHTML(c.by || 'source')}</a>` : (c.by ? ` · ${escapeHTML(c.by)}` : '');
        const credit = $('#clipCredit');
        credit.innerHTML = `Clip library: ${escapeHTML(clipCatName(c.c))}${from}${c.lic ? ' · ' + escapeHTML(c.lic) : ''}`;
        credit.hidden = false;
        clipMark();
        try { localStorage.setItem(CLIP_LAST_KEY, c.id); } catch (_) { /* fine */ }
        return true;
      });
    })
    .catch(() => {
      if (ask === clips.ask && !quiet) toast('That clip couldn’t be loaded. Is Phosphor Clips still running?');
      return false;
    });
}
function clipShuffle() {
  clipList().then(() => {
    const shown = clipsShown().filter((c) => c.id !== clips.cur);
    if (shown.length) clipPick(pick(shown));
    else toast(clips.list.length ? 'There’s no other clip in this category.' : 'The clip library is empty. Save some clips with Phosphor Clips.');
  }).catch(() => openClips());
}
function clipsSay(html) {
  $('#clipsMsg').hidden = !html;
  $('#clipsMsgText').innerHTML = html || '';
}
function clipsBuild() {
  const list = clips.list || [];
  const count = (id) => (id === 'all' ? list.length : list.filter((c) => c.c === id).length);
  const cats = clips.cats.filter((c) => count(c.id) > 0);
  clipsTabs.textContent = '';
  for (const c of [{ id: 'all', n: 'All' }, ...cats]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.cat = c.id;
    b.innerHTML = `${escapeHTML(c.n)} <b>${count(c.id)}</b>`;
    b.addEventListener('click', () => {
      clips.cat = c.id;
      try { localStorage.setItem(CLIP_TAB_KEY, c.id); } catch (_) { /* fine */ }
      clipsFilter();
      clipsDlg.scrollTop = 0;
    });
    clipsTabs.appendChild(b);
  }
  // Which categories Autopilot brings clips in from
  const apBox = $('#clipsApCats');
  apBox.textContent = '';
  for (const c of cats) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<span class="led"></span>${escapeHTML(c.n)}`;
    b.setAttribute('aria-pressed', String(!clips.off.includes(c.id)));
    b.addEventListener('click', () => {
      const on = clips.off.includes(c.id);
      clips.off = on ? clips.off.filter((x) => x !== c.id) : [...clips.off, c.id];
      b.setAttribute('aria-pressed', String(on));
      try { localStorage.setItem(CLIP_OFF_KEY, JSON.stringify(clips.off)); } catch (_) { /* fine */ }
      clipsApNote();
    });
    apBox.appendChild(b);
  }
  $('#clipsAp').hidden = !cats.length;
  clipsGrid.textContent = '';
  const frag = document.createDocumentFragment();
  for (const c of list) {
    const b = document.createElement('button');
    b.className = 'nat-tile';
    b.dataset.id = c.id;
    b.dataset.c = c.c;
    b.title = `${c.n} (${clipCatName(c.c)})`;
    const thumb = c.thumb ? `<img loading="lazy" decoding="async" alt="" src="${escapeHTML(clips.base)}/thumb/${encodeURIComponent(c.id)}">` : '';
    b.innerHTML = `${thumb}<em class="clip-dur">${fmtT(c.d || 0)}</em><span>${escapeHTML(c.n)}</span>`;
    frag.appendChild(b);
  }
  clipsGrid.appendChild(frag);
}
function clipsApNote() {
  const hint = $('#clipsHint');
  hint.hidden = false;
  const none = clips.list && clips.list.length && !clipsAp().length;
  hint.textContent = none
    ? `Tap a clip to feed it into loop ${edit}. No category is ticked, so Autopilot won’t bring in clips.`
    : `Tap a clip to feed it into loop ${edit}. Autopilot puts in a new clip from the ticked categories every few looks; a video file of your own stays put.`;
}
function clipsFilter() {
  for (const b of clipsTabs.children) b.setAttribute('aria-pressed', String(b.dataset.cat === clips.cat));
  for (const t of clipsGrid.children) t.hidden = clips.cat !== 'all' && t.dataset.c !== clips.cat;
  const n = clipsShown().length;
  $('#clipsCount').textContent = clips.list ? `${n} CLIP${n === 1 ? '' : 'S'}` : '';
}
let clipsReturn = null;
function openClips() {
  try { localStorage.setItem(CLIP_ON_KEY, '1'); } catch (_) { /* fine */ }
  if (clipsDlg.hidden) {
    clipsReturn = document.activeElement;
    clipsDlg.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    $('#clipsClose').focus({ preventScroll: true });
  }
  clipsSay('Looking for Phosphor Clips on this computer…');
  $('#clipsShuffle').hidden = true;
  clipList(true).then((list) => {
    if (clipsDlg.hidden) return;
    clipsBuild();
    clipsFilter();
    clipMark();
    $('#clipShuffle').hidden = !list.length;
    $('#clipsShuffle').hidden = !list.length;
    $('#clipsFoot').hidden = false;
    if (!list.length) {
      clipsSay('Phosphor Clips is running, but its library is empty. Grab a video there and save it, then press <b>Try again</b>.');
      $('#clipsHint').hidden = true;
      return;
    }
    clipsSay('');
    clipsApNote();
    clipsKeepOneReady();
    const cur = clipsGrid.querySelector('[aria-current="true"]:not([hidden])');
    if (cur) cur.scrollIntoView({ block: 'center' }); else clipsDlg.scrollTop = 0;
  }).catch(() => {
    if (clipsDlg.hidden) return;
    clipsGrid.textContent = '';
    clipsTabs.textContent = '';
    $('#clipsAp').hidden = true;
    $('#clipsHint').hidden = true;
    $('#clipsFoot').hidden = true;
    $('#clipsCount').textContent = '';
    clipsSay('Phosphor Clips isn’t answering. Open <b>Phosphor Clips</b> on this computer (it shares your clips with Phosphor Loop, and can sit by the clock), then press <b>Try again</b>. ' +
      'If the browser asks whether this site may look for or connect to devices or programs on your computer, choose <b>Allow</b>.');
  });
}
function closeClips() {
  if (clipsDlg.hidden) return;
  clipsDlg.hidden = true;
  document.documentElement.style.overflow = '';
  if (clipsReturn && clipsReturn.focus) clipsReturn.focus();
}
if (APP) $('#clipOpen').hidden = true;   // Phosphor Clips is a Windows program; the phone has no library to reach
$('#clipOpen').addEventListener('click', openClips);
$('#clipShuffle').addEventListener('click', clipShuffle);
$('#clipsClose').addEventListener('click', closeClips);
$('#clipsRetry').addEventListener('click', openClips);
$('#clipsShuffle').addEventListener('click', () => { clipShuffle(); closeClips(); });
$('#clipsFile').addEventListener('click', () => { closeClips(); $('#vidFile').click(); });
clipsGrid.addEventListener('click', (e) => {
  const t = e.target.closest('.nat-tile');
  if (!t) return;
  const c = (clips.list || []).find((x) => x.id === t.dataset.id);
  if (c) clipPick(c);
  closeClips();
});
clipsDlg.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); closeClips(); }
  else e.stopPropagation(); // keep the keys from firing while browsing
});
// Video loops that came back with the page but whose clip can't (Phosphor Clips isn't running): back to a pattern
function clipsDropVideo() {
  if (vid.on) return;
  let dropped = false;
  for (const k of KEYS) {
    const t = loops[k].tgt;
    if (t.in1 === 'video') { t.in1 = k === 'B' ? 'shape' : 'wave'; dropped = true; }
    if (t.in2 === 'video') { t.in2 = 'none'; dropped = true; }
  }
  if (dropped) { settleDevices(); syncUI(); toast('Picked up where you left off. Open Phosphor Clips, then choose Video again to bring the clip back.'); }
}
// A clip is kept ready (paused until a loop uses it) whenever the library has clips for Autopilot, so a look that
// picks Video has a picture straight away, and Check each look sees the clip rather than an empty input
function clipsKeepOneReady() {
  if (!vid.on && !clips.own && clipsReady()) return clipPick(pick(clipsAp()), true);
  return Promise.resolve(vid.on);
}
// When the page opens (after the last session is back): the clip in use last time comes back, and the library is
// asked again every minute so Autopilot knows about new clips
function clipsStart() {
  if (!clipsWanted()) return;
  const last = lsGet(CLIP_LAST_KEY);
  clipList().then((list) => {
    $('#clipShuffle').hidden = !list.length;
    if (vid.on) return true;
    const c = list.find((x) => x.id === last);
    return c ? clipPick(c, true) : clipsKeepOneReady();
  }).then((ok) => { if (!ok) clipsDropVideo(); }, () => clipsDropVideo());
  setInterval(() => {
    if (document.hidden || !clipsWanted()) return;
    clipList(true).then(() => { $('#clipShuffle').hidden = !clips.list.length; clipsKeepOneReady(); }).catch(() => { /* not running right now */ });
  }, 60000);
}

// For tests/clips_check.py, which can't see inside this file: the clip library's state and the bits of Autopilot it
// touches (as __phosphorCapture does for the stream app)
window.__plClips = {
  get list() { return clips.list; }, get cur() { return clips.cur; }, get own() { return clips.own; },
  get off() { return clips.off.slice(); }, set off(v) { clips.off = v.slice(); },
  get vidOn() { return vid.on; }, get vidFrames() { return vid.frames; }, get edit() { return edit; },
  wanted: () => clipsWanted(), ready: () => clipsReady(),
  input: (k, slot) => loops[k].tgt[slot], setInput: (k, slot, src) => { loops[k].tgt[slot] = src; },
  detachVideo: () => { vid.detach(); clips.cur = ''; },
  apClip: (k, gap) => { if (gap != null) ap.clipIn = gap; apClip(k); },
  videoUsable: () => apPool().includes('video') && apUsable('video'),
  loadFile: (f) => loadFile(f), close: () => closeClips(),
};

const dropEl = $('#drop');
let dragDepth = 0;
stage.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; dropEl.hidden = false; });
stage.addEventListener('dragover', (e) => { e.preventDefault(); });
stage.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropEl.hidden = true; });
stage.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; dropEl.hidden = true;
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

/* ================= video deck ================= */
const vidPos = $('#vidPos'), vidTime = $('#vidTime');
let scrubbing = false, vidLoopA = null, vidLoopB = null, vidRate = 1, vidTxt = '';
function fmtT(s) {
  if (!isFinite(s)) s = 0;
  s = Math.max(0, s);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function seekTo(t) { const v = vid.video; if (v && isFinite(v.duration)) v.currentTime = clamp(t, 0, Math.max(0, v.duration - 0.05)); }
function seekBy(d) { const v = vid.video; if (v) seekTo(v.currentTime + d); }
vidPos.addEventListener('input', () => {
  const v = vid.video;
  if (!v || !isFinite(v.duration)) return;
  scrubbing = true;
  v.currentTime = (+vidPos.value / 1000) * v.duration;
  fillTrack(vidPos);
  vidTime.textContent = fmtT(v.currentTime);
});
vidPos.addEventListener('change', () => { scrubbing = false; });
$('#vidStart').addEventListener('click', () => seekTo(vidLoopA ?? 0));
$('#vidBack').addEventListener('click', () => seekBy(-5));
$('#vidFwd').addEventListener('click', () => seekBy(5));
$$('#vidSpeed button').forEach((b) => b.addEventListener('click', () => {
  vidRate = +b.dataset.rate;
  if (vid.video) vid.video.playbackRate = vidRate;
  $$('#vidSpeed button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));
$('#vidIn').addEventListener('click', () => {
  if (!vid.video) return;
  vidLoopA = vid.video.currentTime;
  if (vidLoopB != null && vidLoopB <= vidLoopA + 0.1) vidLoopB = null;
  loopText();
});
$('#vidOut').addEventListener('click', () => {
  if (!vid.video) return;
  const t = vid.video.currentTime;
  if (vidLoopA != null && t <= vidLoopA + 0.1) { toast('Mark the end somewhere after the start.'); return; }
  vidLoopB = t;
  seekTo(vidLoopA ?? 0);
  loopText();
});
$('#vidAll').addEventListener('click', () => { vidLoopA = null; vidLoopB = null; loopText(); });
function loopText() {
  const has = vidLoopA != null || vidLoopB != null;
  $('#vidAll').hidden = !has;
  $('#vidLoopText').textContent = has
    ? `Repeating ${fmtT(vidLoopA ?? 0)} to ${vidLoopB != null ? fmtT(vidLoopB) : 'the end'}.`
    : 'The whole video plays on repeat.';
}
function vcrTick() {
  const v = vid.video;
  if (!v || scrubbing) return;
  if (vidLoopB != null && v.currentTime >= vidLoopB) v.currentTime = vidLoopA ?? 0;
  else if (vidLoopA != null && v.currentTime < vidLoopA - 0.25 && !v.seeking) v.currentTime = vidLoopA;
  if (isFinite(v.duration) && v.duration > 0) {
    const pos = String(Math.round(v.currentTime / v.duration * 1000));
    if (vidPos.value !== pos) { vidPos.value = pos; fillTrack(vidPos); }
    const txt = fmtT(v.currentTime);
    if (txt !== vidTxt) { vidTxt = txt; vidTime.textContent = txt; }
  }
}
fillTrack(vidPos);

/* ================= picture adjustments ================= */
const ADJ_SRC = ['picture', 'video', 'camera', 'screen', 'phone', 'loop'];
const ADJ_DEF = [
  ['tracking', 'Tracking', 0, 100, 'Clean', 'Chewed tape', false],
  ['bright', 'Brightness', -100, 100, 'Darker', 'Brighter', true],
  ['contrast', 'Contrast', -100, 100, 'Flatter', 'Punchier', true],
  ['sat', 'Color', -100, 100, 'Gray', 'Vivid', true],
  ['key', 'Cut out dark parts', 0, 100, 'Off', 'Only the brightest', false],
  // 3D lighting on this input alone, lit from where the 3D lighting section says (see "3D lighting")
  ['rDepth', '3D depth', 0, 100, 'Flat', 'Deep bumps', false],
  ['rSmooth', '3D smoothness', 0, 100, 'Crisp carving', 'Soft jelly', false, '0'],
  ['rShine', '3D shine', 0, 100, 'Matte clay', 'Wet plastic', false, 'MATTE'],
];
function adjDefaults() { return { tracking: 0, bright: 0, contrast: 0, sat: 0, key: 0, rDepth: 0, rSmooth: 30, rShine: 60 }; }
const adj = {};
ADJ_SRC.forEach((src) => { adj[src] = adjDefaults(); });
const adjEls = [];
const adjA = new Float32Array(44), adjB = new Float32Array(44);
function packAdj() {
  for (const src of ADJ_SRC) {
    const i = SRC_ID[src] * 4, a = adj[src];
    adjA[i] = a.tracking / 100;
    adjA[i + 1] = a.bright / 100 * 0.5;
    adjA[i + 2] = a.contrast / 100;
    adjA[i + 3] = a.sat / 100;
    adjB[i] = a.key / 100 * 0.9;
    adjB[i + 1] = a.rDepth / 100;
    adjB[i + 2] = a.rSmooth / 100;
    adjB[i + 3] = a.rShine / 100;
  }
}
function buildAdjust(src) {
  const d = document.createElement('details');
  d.className = 'adj';
  d.innerHTML = '<summary>Adjust the picture</summary>';
  const body = document.createElement('div');
  body.className = 'adj-body';
  for (const [k, label, min, max, lo, hi, bip, zero = 'OFF'] of ADJ_DEF) {
    const def = adjDefaults()[k];
    const id = `adj-${src}-${k}`;
    const c = document.createElement('div');
    c.className = 'ctl';
    c.innerHTML = `<div class="ctl-head"><label for="${id}">${label}</label><output id="${id}-out" for="${id}"></output></div>` +
      `<input type="range" id="${id}"${bip ? ' class="bipolar"' : ''} min="${min}" max="${max}" step="1" value="${def}">` +
      `<div class="ends"><span>${lo}</span><span>${hi}</span></div>`;
    body.appendChild(c);
    const el = c.querySelector('input'), out = c.querySelector('output');
    const refresh = () => {
      fillTrack(el);
      const v = +el.value;
      out.textContent = v === 0 ? (bip ? '0' : zero) : (bip && v > 0 ? '+' + v : String(v));
    };
    el.addEventListener('input', () => { adj[src][k] = +el.value; refresh(); });
    el.addEventListener('dblclick', () => { el.value = def; adj[src][k] = def; refresh(); });
    adjEls.push({ src, k, el, refresh });
    refresh();
  }
  const actions = document.createElement('div');
  actions.className = 'dev-actions';
  if (src !== 'picture' && src !== 'loop') {
    const hold = document.createElement('button');
    hold.className = 'btn small hold-btn';
    hold.setAttribute('aria-pressed', 'false');
    hold.innerHTML = '<span class="led"></span>Hold this frame';
    hold.addEventListener('click', () => {
      const s = LIVE_SRC[src];
      s.hold = !s.hold;
      hold.setAttribute('aria-pressed', String(s.hold));
    });
    actions.appendChild(hold);
  }
  const reset = document.createElement('button');
  reset.className = 'btn small';
  reset.textContent = 'Reset';
  reset.addEventListener('click', () => { adj[src] = adjDefaults(); syncAdjUI(); });
  actions.appendChild(reset);
  body.appendChild(actions);
  d.appendChild(body);
  const row = $('#row-' + src);
  const hintEl = row.querySelector(':scope > .hint');
  row.insertBefore(d, hintEl || null);
}
function syncAdjUI() { adjEls.forEach(({ src, k, el, refresh }) => { el.value = adj[src][k]; refresh(); }); }
ADJ_SRC.forEach(buildAdjust);

/* ================= camera ================= */
const camStatus = $('#camStatus'), camRetry = $('#camRetry'), camSel = $('#camSel');
let camStarting = false, camDeviceId = '';
function camSay(html, warn) { say(camStatus, html, warn); camRetry.hidden = !warn; }
async function startCamera() {
  if (cam.on || camStarting) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    camSay('This browser won’t share a camera with this page. Open it in <b>Chrome</b> or <b>Edge</b>.', true);
    return;
  }
  camStarting = true;
  camSay('Waiting for you to allow the camera…');
  try {
    const video = camDeviceId
      ? { deviceId: { exact: camDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    if (!uses('camera')) { stream.getTracks().forEach((t) => t.stop()); camSay('Camera is off.'); return; }
    const v = mkVideo();
    v.srcObject = stream;
    await v.play();
    cam.attach(v, stream);
    const track = stream.getVideoTracks()[0];
    camDeviceId = (track.getSettings && track.getSettings().deviceId) || camDeviceId;
    // Like a mirror only for a camera that faces you; a phone's back camera shows the world the right way round
    cam.flip = !isBackCamera(track);
    track.addEventListener('ended', () => { cam.detach(); camSay('The camera stopped. Press Try again.', true); });
    camSay('<span class="live"></span><b>Camera is on.</b>');
    listCameras();
  } catch (err) {
    const n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      camSay(APP ? 'Camera access was blocked. Press Try again and choose <b>Allow</b>.'
        : 'Camera access was blocked. Click the camera icon in the address bar, choose <b>Allow</b>, then press Try again.', true);
    }
    else if (n === 'NotFoundError' || n === 'OverconstrainedError') { camDeviceId = ''; camSay('No camera was found. Plug one in, then press Try again.', true); }
    else if (n === 'NotReadableError' || n === 'AbortError') camSay('Another app is using the camera. Close it, then press Try again.', true);
    else camSay('The camera couldn’t start. Press Try again.', true);
  } finally {
    camStarting = false;
  }
}
function stopCamera() { cam.detach(); camSay('Camera is off.'); }
// Phones say which way a camera faces; computer webcams usually don't, and they face you
const BACK_CAM = /\b(back|rear|environment|world)\b/i;
function isBackCamera(track) {
  const f = track.getSettings ? track.getSettings().facingMode : '';
  if (f === 'environment') return true;
  if (f === 'user') return false;
  return BACK_CAM.test(track.label || '');
}
// Android names its cameras like "camera2 0, facing back"; show plain names instead
function cameraName(label, i, n) {
  if (/facing back/i.test(label)) return n.back++ ? `Back camera ${n.back}` : 'Back camera';
  if (/facing front/i.test(label)) return n.front++ ? `Front camera ${n.front}` : 'Front camera';
  return label || `Camera ${i + 1}`;
}
async function listCameras() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    camSel.innerHTML = '';
    const n = { back: 0, front: 0 };
    devs.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId; o.textContent = cameraName(d.label, i, n);
      camSel.appendChild(o);
    });
    camSel.value = camDeviceId;
    camSel.hidden = devs.length < 2;
  } catch (_) {}
}
camSel.addEventListener('change', () => { camDeviceId = camSel.value; cam.detach(); startCamera(); });
camRetry.addEventListener('click', () => { if (uses('camera')) startCamera(); });
// Android lets go of the camera while the app is in the background; take it back on return
onApp('resume', () => { if (uses('camera') && !cam.on) startCamera(); });
$('#camOff').addEventListener('click', () => dropSource('camera'));

// Swap a device out of every slot that uses it
function dropSource(src) {
  for (const k of KEYS) {
    const t = loops[k].tgt;
    if (t.in1 === src) t.in1 = k === 'B' ? 'shape' : 'wave';
    if (t.in2 === src) t.in2 = 'none';
  }
  settleDevices();
  syncUI();
}

/* ================= screen ================= */
const scrStatus = $('#scrStatus');
function scrSay(html, warn) { say(scrStatus, html, warn); $('#scrStop').hidden = !scr.on; }
async function startScreen(thisTab) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    scrSay('This browser can’t share its screen here. Use <b>Chrome</b> or <b>Edge</b> on a computer.', true);
    return;
  }
  scrSay(thisTab ? 'Press <b>Allow</b> (or <b>Share</b>) in the box your browser opened…' : 'Pick a window or screen in the box your browser opened…');
  const opts = { video: { frameRate: 30 }, audio: false, selfBrowserSurface: 'include', surfaceSwitching: 'include' };
  if (thisTab) opts.preferCurrentTab = true;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(opts);
    const track = stream.getVideoTracks()[0];
    // When this tab is shared, crop the capture to the monitor so the loop sees only its own screen
    let cropped = false;
    if (window.CropTarget && track.cropTo) {
      try { await track.cropTo(await CropTarget.fromElement(screenWrap)); cropped = true; } catch (_) {}
    }
    if (!uses('screen')) { stream.getTracks().forEach((t) => t.stop()); scrSay('Not sharing.'); return; }
    const v = mkVideo();
    v.srcObject = stream;
    await v.play();
    scr.attach(v, stream);
    track.addEventListener('ended', () => { scr.detach(); scrSay('Screen sharing stopped.'); });
    scrSay(cropped ? '<span class="live"></span><b>The screen is feeding itself.</b>' : '<span class="live"></span><b>Sharing your screen.</b>');
  } catch (err) {
    const n = err && err.name;
    if (n === 'NotAllowedError') scrSay('Screen sharing was cancelled. Pick one of the options below to try again.', true);
    else scrSay('Screen sharing couldn’t start. Pick one of the options below to try again.', true);
  }
}
function stopScreen() { scr.detach(); scrSay('Not sharing.'); }
$('#scrSelf').addEventListener('click', () => { scr.detach(); startScreen(true); });
$('#scrOther').addEventListener('click', () => { scr.detach(); startScreen(false); });
$('#scrStop').addEventListener('click', () => dropSource('screen'));

/* ================= phone link ================= */
// Uses the free PeerJS connection service only to introduce the phone and this page;
// the video itself travels phone-to-computer over WebRTC.
const SIGNAL_URL = params.get('signal') || 'wss://0.peerjs.com:443/peerjs';
const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
] };
const phoneOK = !inArtifact && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const phoStatus = $('#phoStatus'), phoRetry = $('#phoRetry'), phoOff = $('#phoOff');
function phoSay(html, warn) { say(phoStatus, html, warn); phoRetry.hidden = !warn; phoOff.hidden = !pho.on; }

class Signal {
  constructor(base, id, h) { this.base = base; this.id = id; this.h = h; this.ws = null; this.hb = null; this.closed = false; this.open = false; }
  connect() {
    const token = randId(12);
    let ws;
    try { ws = new WebSocket(`${this.base}?key=peerjs&id=${encodeURIComponent(this.id)}&token=${token}&version=1.5.5`); }
    catch (e) { setTimeout(() => this.h.lost && this.h.lost(false), 0); return; }
    this.ws = ws;
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.type === 'OPEN') { this.open = true; this.h.open && this.h.open(); }
      else if (m.type === 'ID-TAKEN') this.h.error && this.h.error('id-taken');
      else if (m.type === 'ERROR') this.h.error && this.h.error('server');
      else this.h.message && this.h.message(m);
    };
    ws.onclose = () => {
      clearInterval(this.hb);
      const was = this.open;
      this.open = false; this.ws = null;
      if (!this.closed && this.h.lost) this.h.lost(was);
    };
    this.hb = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'HEARTBEAT' })); }, 5000);
  }
  send(type, dst, payload) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type, dst, payload })); }
  close() { this.closed = true; clearInterval(this.hb); if (this.ws) { try { this.ws.close(); } catch (_) {} } }
}

let sig = null, deskId = null, sigFails = 0;
let phonePC = null, phonePeer = null, phoneConn = null, phoneCands = [];
let qrReady = false;

function phoneURL() {
  const u = new URL('phone.html', location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('id', deskId);
  if (params.get('signal')) u.searchParams.set('signal', params.get('signal'));
  return u.toString();
}
async function drawQR() {
  const url = phoneURL();
  $('#qrUrl').textContent = url;
  $('#qrWrap').hidden = false;
  try {
    if (!window.qrcode) await loadScript('qrcode.js');
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount(), quiet = 3, scale = Math.max(2, Math.floor(256 / (n + quiet * 2)));
    const c = $('#qr');
    c.width = c.height = (n + quiet * 2) * scale;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) if (qr.isDark(r, q)) g.fillRect((q + quiet) * scale, (r + quiet) * scale, scale, scale);
    qrReady = true;
  } catch (_) {
    $('#qr').hidden = true;
    say(phoStatus, 'The QR code couldn’t be drawn (qrcode.js is missing next to this page). Open the address above on your phone instead.', true);
  }
}
function startPhoneLink() {
  if (!phoneOK) {
    $('#qrWrap').hidden = true;
    phoSay(inArtifact
      ? 'Connecting a phone isn’t available in this preview. Open Phosphor Loop from its own web address.'
      : 'Connecting a phone works when Phosphor Loop is opened from its web address (https://…), not from a file on your computer.', false);
    phoRetry.hidden = true;
    return;
  }
  if (sig && !sig.closed) return;
  if (!deskId) deskId = 'phosphorloop-' + randId(10);
  if (!pho.on) phoSay('Getting a connection code…');
  sig = new Signal(SIGNAL_URL, deskId, {
    open() {
      sigFails = 0;
      if (!qrReady) drawQR();
      if (!pho.on) phoSay('Waiting for your phone…');
    },
    message: onPhoneSignal,
    error(kind) {
      sig.close(); sig = null;
      if (kind === 'id-taken') { deskId = null; qrReady = false; startPhoneLink(); }
      else phoSay('The connection service had a problem. Press Try again.', true);
    },
    lost() {
      sig = null;
      sigFails++;
      if (sigFails <= 3) { if (!pho.on) phoSay('Reconnecting to the connection service…'); setTimeout(startPhoneLink, 1500 * sigFails); }
      else if (!pho.on) phoSay('Couldn’t reach the connection service. Check your internet connection, then press Try again.', true);
    },
  });
  sig.connect();
}
function closePhonePC() {
  if (phonePC) { try { phonePC.close(); } catch (_) {} }
  phonePC = null; phoneCands = [];
}
function phoneGone(text) {
  closePhonePC();
  pho.detach();
  phoSay(text + (qrReady ? ' Scan the code to connect again.' : ''), false);
}
async function onPhoneSignal(m) {
  const p = m.payload || {};
  if (m.type === 'OFFER') {
    closePhonePC();
    phonePeer = m.src; phoneConn = p.connectionId;
    pho.flip = p.facing === 'user';
    const pc = new RTCPeerConnection(ICE);
    phonePC = pc;
    pc.ontrack = (e) => {
      const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      const v = mkVideo();
      v.srcObject = stream;
      v.play().catch(() => {});
      pho.attach(v, stream);
      phoSay('<span class="live"></span><b>Phone connected.</b> Point it at anything, even this screen.');
      showOSD('INPUT', 'PHONE');
      hideTip();
    };
    pc.ondatachannel = (e) => {
      e.channel.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (d.facing) pho.flip = d.facing === 'user'; } catch (_) {} };
    };
    pc.onicecandidate = (e) => { if (e.candidate && sig) sig.send('CANDIDATE', phonePeer, { candidate: e.candidate, type: 'media', connectionId: phoneConn }); };
    pc.onconnectionstatechange = () => {
      if (phonePC !== pc) return;
      const s = pc.connectionState;
      if (s === 'failed') phoneGone('The phone connection dropped.');
      else if (s === 'disconnected' && pho.on) phoSay('The phone connection is unsteady…');
      else if (s === 'connected' && pho.on) phoSay('<span class="live"></span><b>Phone connected.</b> Point it at anything, even this screen.');
    };
    try {
      await pc.setRemoteDescription(p.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (sig) sig.send('ANSWER', phonePeer, { sdp: pc.localDescription, type: 'media', connectionId: phoneConn });
      for (const c of phoneCands) await pc.addIceCandidate(c).catch(() => {});
      phoneCands = [];
      phoSay('Phone found. Starting the picture…');
    } catch (err) {
      phoneGone('The phone’s video couldn’t be set up.');
    }
  } else if (m.type === 'CANDIDATE') {
    if (m.src !== phonePeer || p.connectionId !== phoneConn) return;
    if (phonePC && phonePC.remoteDescription) phonePC.addIceCandidate(p.candidate).catch(() => {});
    else phoneCands.push(p.candidate);
  } else if (m.type === 'LEAVE') {
    if (m.src === phonePeer) phoneGone('Your phone disconnected.');
  }
}
phoRetry.addEventListener('click', () => { sigFails = 0; if (sig) { sig.close(); sig = null; } startPhoneLink(); });
phoOff.addEventListener('click', () => {
  if (sig && phonePeer) sig.send('LEAVE', phonePeer, {});
  phoneGone('Phone disconnected.');
});

/* ================= shapes ================= */
// Shapes laid over everything (js/shapes.js): made and changed under Shapes, dropped or flung on the picture.
// The controls change the shape last clicked, and set up the next one added.
const shapes = new PhosphorShapes.World();
let shapeProg = null, shapeRT = null, shapeRTSize = '', shapeSel = 0, shapeSelAt = -1e9, shapeSw = { n: 0 }, shapeSig = '';
const shapeTpl = { ...PhosphorShapes.DEFAULTS };
const SHAPE_SLIDERS = { speed: '#shapeSpeed', size: '#shapeSize', gravity: '#shapeGravity', swallow: '#shapeSwallow', disk: '#shapeDisk', tilt: '#shapeTilt' };
const shapeLabel = (s) => (s.wire ? 'Wireframe ' : '') + PhosphorShapes.KINDS.find((k) => k.id === s.kind).label.toLowerCase();
const shapeCur = () => { const s = shapes.byId(shapeSel); return s && !s.dying ? s : null; };
function shapeText(k, v) {
  v = Math.round(v);
  if (k === 'gravity') return v === 0 ? 'NONE' : String(v);
  if (k === 'swallow') return v === 0 ? 'LENS' : v === 100 ? 'SWALLOW' : String(v);
  if (k === 'disk') return v === 0 ? 'NONE' : String(v);
  if (k === 'tilt') return `${v}°`;
  if (k === 'speed') return v === 50 ? 'USUAL' : `${Math.pow(4, (v - 50) / 50).toFixed(v < 50 ? 2 : 1)}×`;
  return String(v);
}
function shapeSyncUI() {
  const s = shapeCur() || shapeTpl;
  $('#shapeKind').value = s.kind;
  $$('#shapeWire button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.wire === '1') === !!s.wire)));
  $$('#shapeMove button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.wander === '1') === !!s.wander)));
  $('#shapeColor').value = s.color;
  for (const [k, sel] of Object.entries(SHAPE_SLIDERS)) {
    const el = $(sel);
    el.value = Math.round(s[k]); fillTrack(el);
    $(sel + 'Out').textContent = shapeText(k, s[k]);
  }
  const n = shapes.count, cur = shapeCur();
  $('#shapeRemove').disabled = !cur;
  $('#shapeClear').disabled = !n;
  $('#shapeAdd').disabled = n >= PhosphorShapes.MAX;
  $('#shapeStatus').textContent = !n ? 'No shapes yet. Click Add shape, or drag it onto the picture.'
    : `${n} shape${n > 1 ? 's' : ''} on the picture${n >= PhosphorShapes.MAX ? ' (the most there can be)' : ''}. ` +
      (cur ? `The controls are changing the ${shapeLabel(cur)}.` : 'Click one on the picture to change it.');
  shapeSig = `${n}|${shapeSel}|${cur ? cur.size + '|' + cur.gravity : ''}`;
}
function pickShape(id) { shapeSel = id; shapeSelAt = performance.now(); shapeSyncUI(); }
function shapeSet(k, v) {
  shapeTpl[k] = v;
  const s = shapeCur();
  if (s) { s[k] = v; shapeSelAt = performance.now(); }
  shapeSyncUI();
}
function addShape(x, y, opts) {
  const s = shapes.add({ ...shapeTpl, ...opts }, x, y);
  if (!s) { toast('There can be eight shapes at most. Remove one first.'); return null; }
  if (!opts || !opts.byAp) pickShape(s.id); else shapeSyncUI();
  return s;
}
$('#shapeKind').addEventListener('change', (e) => shapeSet('kind', e.target.value));
$$('#shapeWire button').forEach((b) => b.addEventListener('click', () => shapeSet('wire', b.dataset.wire === '1')));
$$('#shapeMove button').forEach((b) => b.addEventListener('click', () => shapeSet('wander', b.dataset.wander === '1')));
$('#shapeColor').addEventListener('input', (e) => shapeSet('color', e.target.value));
for (const [k, sel] of Object.entries(SHAPE_SLIDERS)) $(sel).addEventListener('input', (e) => shapeSet(k, +e.target.value));
$('#shapeRemove').addEventListener('click', () => { if (shapeCur()) shapes.remove(shapeSel); shapeSel = 0; shapeSyncUI(); });
$('#shapeClear').addEventListener('click', () => { shapes.clear(); shapeSel = 0; shapeSyncUI(); });
// Add shape: a click puts it somewhere on the picture; dragged onto the picture, it lands where it's let go
{
  const btn = $('#shapeAdd');
  let down = null, ghost = null;
  const overCanvas = (e) => { const r = canvas.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
  btn.addEventListener('pointerdown', (e) => {
    if (btn.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    down = { x: e.clientX, y: e.clientY, moved: false };
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  btn.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
      down.moved = true;
      ghost = document.createElement('div'); ghost.className = 'shape-ghost'; document.body.appendChild(ghost);
    }
    if (ghost) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
  });
  const end = (e, cancel) => {
    if (!down) return;
    const d = down; down = null;
    if (ghost) { ghost.remove(); ghost = null; }
    if (cancel) return;
    if (!d.moved) addShape();
    else if (overCanvas(e)) { const p = pointerToP(e, canvas); addShape(p[0], p[1]); }
  };
  btn.addEventListener('pointerup', (e) => end(e, false));
  btn.addEventListener('pointercancel', (e) => end(e, true));
  // From the keyboard
  btn.addEventListener('click', (e) => { if (e.detail === 0) addShape(); });
}
// Autopilot may now and then add a shape of its own, fling one, or take away one it added (off until switched on)
const SHAPE_AP_KEY = 'phosphor-shapes-ap';
let shapeAp = false, shapeApNext = 0;
try { shapeAp = localStorage.getItem(SHAPE_AP_KEY) === '1'; } catch (_) {}
$('#shapeAp').setAttribute('aria-pressed', String(shapeAp));
$('#shapeAp').addEventListener('click', () => {
  shapeAp = !shapeAp;
  $('#shapeAp').setAttribute('aria-pressed', String(shapeAp));
  try { localStorage.setItem(SHAPE_AP_KEY, shapeAp ? '1' : '0'); } catch (_) {}
});
function shapeApTick(now) {
  if (!ap.on || !shapeAp || frozen) { shapeApNext = 0; return; }
  if (!shapeApNext) { shapeApNext = now + rnd(8000, 20000); return; }
  if (now < shapeApNext) return;
  shapeApNext = now + rnd(15000, 45000);
  const live = shapes.list.filter((s) => !s.dying), mine = live.filter((s) => s.byAp);
  const acts = [];
  if (mine.length < 2 && live.length < 6) acts.push(['add', mine.length ? 0.6 : 1.2]);
  if (live.length) acts.push(['fling', 1]);
  if (mine.length) acts.push(['remove', mine.length >= 2 ? 0.8 : 0.3]);
  const act = wpick(acts);
  if (act === 'add') {
    const c = hsv(Math.random(), rnd(0.4, 0.9), rnd(0.15, 0.9)).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    addShape(undefined, undefined, { byAp: true, wander: true, kind: pick(PhosphorShapes.KINDS).id, wire: Math.random() < 0.3, color: '#' + c,
      size: rnd(25, 65), gravity: rnd(30, 85), swallow: rnd(15, 85), disk: rnd(25, 80), tilt: rnd(55, 85) });
  } else if (act === 'fling') {
    const s = pick(live.filter((x) => !shapes.held || shapes.held.s !== x));
    if (s) { const a = Math.random() * Math.PI * 2, v = rnd(0.6, 1.6); s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v; s.head = a; }
  } else if (act === 'remove') {
    shapes.remove(mine.sort((a, b) => a.born - b.born)[0].id);
  }
}
// Each frame: they move on (unless the picture is frozen), and the controls catch up with merges and Autopilot
function shapesTick(now, dt) {
  if (!frozen) shapes.step(dt, simAspect);
  shapeApTick(now);
  if (shapes.merged) { if (shapes.merged.from === shapeSel) shapeSel = shapes.merged.into; shapes.merged = null; }
  const cur = shapeCur();
  if (shapeSel && !cur) shapeSel = 0;
  if (shapeSig !== `${shapes.count}|${shapeSel}|${cur ? cur.size + '|' + cur.gravity : ''}`) shapeSyncUI();
}
// Drawn over the finished picture, before the screen's own effects. Nothing is drawn while there are none.
// Each shape is drawn into its own tile by a shader made for its kind (made the first time one is shown), then
// one pass lays the tiles over the picture.
const shapeTileProgs = {};
let shapeAtlas = null, shapeFailed = false;
function shapeTileProg(kind, wire) {
  const key = kind + (wire ? 'w' : '');
  if (!(key in shapeTileProgs)) {
    try { shapeTileProgs[key] = program(PhosphorShapes.tileFS(kind, wire, useFloat)); }
    catch (err) { shapeTileProgs[key] = null; if (!shapeFailed) toast('Some shapes can’t be drawn on this graphics card.'); shapeFailed = true; }
  }
  return shapeTileProgs[key];
}
function makeShapeAtlas() {
  const W = PhosphorShapes.TMAX * PhosphorShapes.MAX, H = PhosphorShapes.TMAX;
  const col = makeTarget(W, H), from = makeTarget(W, H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, col.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, from.tex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.deleteFramebuffer(from.fbo);
  return { fbo: col.fbo, col: col.tex, from: from.tex, ok };
}
function drawShapes(now) {
  if (!shapes.list.length || shapeProg === false) return null;
  if (!shapeProg) {
    try { shapeProg = program(PhosphorShapes.FS); shapeAtlas = makeShapeAtlas(); if (!shapeAtlas.ok) throw new Error('shape tiles'); }
    catch (err) { shapeProg = false; toast('Shapes can’t be drawn on this graphics card.'); return null; }
  }
  const size = `${simW}x${simH}`;
  if (!shapeRT || shapeRTSize !== size) { if (shapeRT) dropTarget(shapeRT); shapeRT = makeTarget(); shapeRTSize = size; }
  const held = shapes.held && shapes.held.s.id === shapeSel;
  const glow = held ? 1 : clamp(1 - (now - shapeSelAt - 1500) / 800, 0, 1);
  const P = shapes.pack(shapeSel, glow, simH);
  const TM = PhosphorShapes.TMAX;
  gl.bindFramebuffer(gl.FRAMEBUFFER, shapeAtlas.fbo);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, comp.tex);
  for (let i = 0; i < P.n; i++) {
    const prog = shapeTileProg(P.kinds[i][0], P.kinds[i][1]), T = P.E[i * 4 + 3];
    gl.viewport(i * TM, 0, T, T);
    if (!prog) { gl.enable(gl.SCISSOR_TEST); gl.scissor(i * TM, 0, T, T); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST); continue; }
    gl.useProgram(prog.p);
    set1i(prog, 'uPic', 0);
    set2f(prog, 'uSim', simW, simH);
    set2f(prog, 'uOrigin', i * TM, 0);
    for (const [name, arr] of [['uA', P.A], ['uB', P.B], ['uC', P.C], ['uE', P.E]]) { const l = U(prog, name); if (l) gl.uniform4fv(l, arr.subarray(i * 4, i * 4 + 4)); }
    const lr = U(prog, 'uR'); if (lr) gl.uniformMatrix3fv(lr, false, P.R.subarray(i * 9, i * 9 + 9));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, shapeRT.fbo);
  gl.viewport(0, 0, simW, simH);
  gl.useProgram(shapeProg.p);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shapeAtlas.col);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, shapeAtlas.from);
  set1i(shapeProg, 'uPic', 0); set1i(shapeProg, 'uTileCol', 1); set1i(shapeProg, 'uTileFrom', 2);
  set2f(shapeProg, 'uSim', simW, simH);
  set1f(shapeProg, 'uTime', simT);
  set1f(shapeProg, 'uFloat', useFloat ? 1 : 0);
  set1i(shapeProg, 'uN', P.n);
  for (const [name, arr] of [['uA', P.A], ['uB', P.B], ['uC', P.C], ['uE', P.E]]) { const l = U(shapeProg, name + '[0]'); if (l) gl.uniform4fv(l, arr); }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.activeTexture(gl.TEXTURE0);
  return shapeRT;
}
// A shape under the mouse shows a hand
function shapeHover(e, el) {
  if (e.buttons) return;
  const p = pointerToP(e, el);
  el.style.cursor = shapes.hit(p[0], p[1]) ? 'grab' : '';
}
window.__plShapes = { shapes, addShape, pickShape, get sel() { return shapeSel; }, apSoon() { shapeApNext = 1; } };   // for tests/shapes_check.py
shapeSyncUI();

/* ================= drawing on the screen ================= */
let drawing = false, pCur = null, pPrev = null;
function pointerToP(e, el = canvas) {
  const r = el.getBoundingClientRect();
  const u = (e.clientX - r.left) / r.width;
  const v = 1 - (e.clientY - r.top) / r.height;
  return [(u - 0.5) * simAspect, v - 0.5];
}
function startDraw(e, el) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  const p = pointerToP(e, el);
  hideTip();
  if (frozen) toggleFreeze(false);
  e.preventDefault();
  // On a shape, it's picked up (and flung when let go) instead of drawn on
  const hit = shapes.hit(p[0], p[1]);
  if (hit) { shapes.grab(hit, p[0], p[1], performance.now()); pickShape(hit.id); el.style.cursor = 'grabbing'; return; }
  drawing = true;
  pCur = p; pPrev = pCur;
}
function moveDraw(e, el) {
  if (shapes.held) { const p = pointerToP(e, el); shapes.drag(p[0], p[1], performance.now()); }
  else if (drawing) pCur = pointerToP(e, el);
  else shapeHover(e, el);
}
function endDraw(e) {
  drawing = false;
  if (shapes.held) { shapes.release(performance.now()); if (e && e.target) e.target.style.cursor = ''; }
}
canvas.addEventListener('pointerdown', (e) => startDraw(e, canvas));
canvas.addEventListener('pointermove', (e) => moveDraw(e, canvas));
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => canvas.addEventListener(ev, endDraw));

/* ================= guide & recipes ================= */
const RECIPES = [
  { name: 'Infinite hallway', needs: 'screen',
    text: 'Share this tab and the screen films itself, like a camera pointed at a TV. Tiny changes to Zoom and Spin make big differences.',
    how: 'SCREEN · ZOOM IN 12 · SPIN 4 · TRAILS 72',
    sw: 'repeating-radial-gradient(circle at 50% 50%,#0d0c0b 0 6px,#ffae3b 6px 8px,#0d0c0b 8px 12px)',
    patch: { A: { in1: 'screen', size: 100, zoom: 12, spin: 4, trails: 72, color: 6 } } },
  { name: 'Kaleidoscope drawing', after: 'Now drag on the screen.',
    text: 'A blank loop with an eight-way mirror. Every stroke you draw is copied eight times and slowly drifts outward.',
    how: 'NOTHING · MIRROR 8 · TRAILS 97 · ZOOM IN 10',
    sw: 'conic-gradient(from 0deg,#ff4fa3,#ffcf6b,#3bff9a,#3b8bff,#c43bff,#ff4fa3)',
    patch: { A: { in1: 'none', mirror: 8, trails: 97, zoom: 10, spin: 6, color: 18, blur: 0.1 } } },
  { name: 'Marbled', after: 'Slide Melt up and down to watch the picture fold into itself.',
    text: 'The picture pushes itself around by its own bright and dark parts, so the echoes fold into each other like marbling.',
    how: 'SHAPE · ZOOM IN 45 · MELT 80 · TRAILS 86',
    sw: 'repeating-radial-gradient(ellipse at 35% 45%,#1b0f3d 0 5px,#c77dff 5px 8px,#ffe6ff 8px 9px,#1b0f3d 9px 14px)',
    patch: { A: { in1: 'shape', form: 3, zoom: 45, spin: 14, trails: 86, color: 22, blur: -0.12, melt: 80 } } },
  { name: 'Currents', after: 'Slide What you see to Both to see loop B, the one doing the pushing.',
    text: 'Loop B stays hidden, but its spinning shape sweeps loop A’s trails into currents and swirls around itself.',
    how: 'A WAVE · PUSHED BY B 75 · B SHAPE, HIDDEN',
    sw: 'radial-gradient(ellipse at 30% 40%,transparent 0 18%,#4fd1c5 19% 21%,transparent 22% 30%,#ffae3b 31% 33%,transparent 34%),repeating-linear-gradient(115deg,#0b1d28 0 7px,#1f5f7a 7px 9px)',
    patch: { A: { in1: 'wave', form: 3, zoom: 18, spin: 6, trails: 93, color: 14, blur: 0.05, push: 75 },
             B: { in1: 'shape', form: 4, zoom: -20, spin: -25, trails: 88, color: 20, mirror: 4, edge: 1, blur: 0.1 } } },
  { name: 'Rainbow ghost', after: 'Slide Dyed by B up and down to see how hard loop B soaks in. Drop in your own picture to dye that instead.',
    text: 'Loop B never shows itself. Instead its spinning star stains the picture in loop A, so B’s shape turns up as shifting rainbow colors.',
    how: 'A PICTURE · DYED BY B 75 · B WAVE, HIDDEN',
    sw: 'repeating-radial-gradient(circle at 50% 50%,#ff4fa3 0 4px,#ffcf6b 4px 8px,#3bff9a 8px 12px,#3b8bff 12px 16px,#c43bff 16px 20px)',
    patch: { A: { in1: 'picture', zoom: 30, spin: 8, trails: 88, color: 0, blur: -0.05, dye: 75 },
             B: { in1: 'wave', form: 3, mirror: 6, zoom: -20, spin: -12, trails: 92, color: 10, edge: 1, blur: 0.1 } } },
  { name: 'Fractal garden', after: 'Slide Fractal fold down to mix the fractal back into an ordinary tunnel.',
    text: 'The loop folds its picture through the Mandelbrot formula every frame, so a plain glowing square grows into fractal flowers and lace that slowly change shape.',
    how: 'SHAPE · FRACTAL FOLD 100 · TRAILS 90',
    sw: 'radial-gradient(circle at 30% 50%,#ffcf6b 0 6%,transparent 7%),radial-gradient(circle at 70% 50%,#ffcf6b 0 6%,transparent 7%),radial-gradient(ellipse 48% 22% at 50% 50%,#ff7ac6 0 40%,#6a2bd9 60%,transparent 72%),#0b0614',
    patch: { A: { in1: 'shape', form: 3, zoom: 8, spin: 6, trails: 90, color: 25, julia: 100 } } },
  { name: 'Shattered mirror', after: 'Raise Crystal for sharper turns, or add Spin.',
    text: 'The picture cracks into pieces around its brightest spots, and every piece turns and zooms its own way, like looking into a broken mirror.',
    how: 'SHAPE · CRYSTAL 80 · ZOOM IN 15 · TRAILS 90',
    sw: 'conic-gradient(from 30deg at 40% 55%,#1b0f3d 0 60deg,#c77dff 60deg 64deg,#2a1450 64deg 150deg,#ffcf6b 150deg 153deg,#1b0f3d 153deg 250deg,#4fd1c5 250deg 254deg,#1b0f3d 254deg)',
    patch: { A: { in1: 'shape', form: 3, zoom: 15, spin: 0, trails: 90, color: 15, crystal: 80 } } },
  { name: 'Prism', after: 'Try Color chase on your own picture or the camera.',
    text: 'Red, green and blue push each other around in a circle, so a white outline splits into rainbow fringes that braid and chase each other.',
    how: 'SHAPE · COLOR CHASE 80 · ZOOM IN 18 · TRAILS 92',
    sw: 'linear-gradient(100deg,#0b0614 0 30%,#ff3b3b 34%,#ffd23b 40%,#3bff9a 46%,#3b8bff 52%,#c43bff 58%,#0b0614 64%)',
    patch: { A: { in1: 'shape', form: 3, zoom: 18, spin: 8, trails: 92, color: 10, chroma: 80 } } },
  { name: 'Name in lights', after: 'Type your own words in the Your text box under Inputs.',
    text: 'Your band’s name, a title or the venue, flying down a tunnel of its own echoes. Type your own words and they change straight away.',
    how: 'TEXT · ZOOM IN 32 · TRAILS 88 · COLOR 16',
    sw: 'radial-gradient(ellipse 46% 20% at 50% 50%,#fff3b0 0 30%,transparent 32%),repeating-radial-gradient(ellipse at 50% 50%,#140a2a 0 6px,#ff7ac6 6px 8px,#6a2bd9 8px 10px)',
    patch: { A: { in1: 'text', size: 80, zoom: 32, spin: 0, trails: 88, color: 16, blur: 0.05 } } },
  { name: 'Sketchbook', after: 'Try a smaller Input size to make it a page in the middle, or turn Zoom in up for a tunnel of tiles.',
    text: 'A hand-inked sketchbook page of marker tiles (bars, triangles, bowties, circles, curls and weaves) that keep turning in ripples into new pinwheels, diamonds, paths and mazes.',
    how: 'PATCHWORK · INPUT SIZE 100 · EVERYTHING ELSE OFF',
    sw: 'repeating-linear-gradient(0deg,#2a2430 0 1px,transparent 1px 12px),repeating-linear-gradient(90deg,#2a2430 0 1px,transparent 1px 12px),repeating-linear-gradient(0deg,#cdc7bd 0 2px,#ee6b9e 2px 4px,#cdc7bd 4px 6px,#33a0cc 6px 8px)',
    patch: { A: { in1: 'patchwork', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } } },
  { name: 'Living picture', after: 'Try a few nature pictures with ◀ ▶ under Picture, or slide Grow up and down.',
    text: 'Patterns grow over the picture like the markings on a shell or a fish, starting from its outlines and slowly spreading.',
    how: 'PICTURE · GROW 45 FINE · TRAILS 93',
    sw: 'repeating-linear-gradient(60deg,#06120f 0 3px,#ffcf6b 3px 5px,#06120f 5px 7px),radial-gradient(circle,#3bffb0,#06120f)',
    patch: { A: { in1: 'picture', size: 78, zoom: 3, spin: 0, trails: 93, color: 6, blur: 0.02, grow: 45, growSize: 0 } } },
  { name: 'Rubber time', needs: 'camera', after: 'Stand in front of the camera and wave your arms, or turn your head slowly.',
    text: 'The top of the picture is now and the bottom is a second and a half ago, so when you move, your body bends and stretches like rubber.',
    how: 'CAMERA · TIME WARP TOP TO BOTTOM · NO TRAILS',
    sw: 'repeating-linear-gradient(180deg,#0b1d28 0 4px,#4fd1c5 4px 6px,#ffae3b 6px 7px),linear-gradient(90deg,#0b1d28,#1f5f7a)',
    patch: { A: { in1: 'camera', size: 100, trails: 0, zoom: 0, color: 0, time: 100, timeShape: 0 } } },
  { name: 'Ghost trails', needs: 'camera', after: 'Wave your hands in front of the camera.',
    text: 'Only moving things get in, so waving your hands leaves glowing smears while the still room disappears.',
    how: 'CAMERA · ONLY MOVEMENT · SIZE FULL · TRAILS 95',
    sw: 'radial-gradient(ellipse at 40% 60%,#7cf5ff 0 8%,#3b6bff 22%,#0b0f25 60%)',
    patch: { A: { in1: 'camera', motion: true, size: 100, trails: 95, zoom: 4, color: 14, blur: 0.2 } } },
  { name: 'Twin mandala',
    text: 'Two mirrored loops pour into each other through both feeds and keep trading shapes.',
    how: 'A SHAPE · B WAVE · BOTH FEEDS 60',
    sw: 'radial-gradient(circle,#ffae3b 0 12%,transparent 13% 22%,#4fd1c5 23% 30%,transparent 31% 40%,#ffae3b 41% 46%,#141210 47%)',
    patch: { A: { in1: 'shape', form: 4, mirror: 6, zoom: 22, spin: 10, trails: 90, color: 16 },
             B: { in1: 'wave', form: 3, mirror: 8, zoom: -18, spin: -12, trails: 92, color: 22, edge: 1 }, xab: 60, xba: 60, view: 50 } },
  { name: 'Chewed tape',
    text: 'Your video (or the test card) on a worn-out VCR. Tracking errors roll through while the picture melts downward.',
    how: 'VIDEO · TRACKING 70 · WARP 45 · TRAILS 94',
    sw: 'linear-gradient(180deg,#c0c0c0 0 20%,#c0c000 20% 35%,#fff 35% 38%,#00c0c0 38% 55%,#00a000 55% 72%,#a000a0 72%)',
    patch: { A: { in1: 'video', size: 85, warp: 45, trails: 94, zoom: 3, shift: [0, -0.003], blur: 0.25, color: 4 },
             adj: { video: { tracking: 70 }, picture: { tracking: 70 } } } },
  { name: 'Hyperspace',
    text: 'Sparks rushing past at full zoom. Push Spin either way for a wormhole.',
    how: 'SPARKS · ZOOM IN 85 · TRAILS 80',
    sw: 'radial-gradient(circle at 50% 50%,#fff 0 3%,#9fd6ff 6%,#1a2a6c 30%,#05060f 70%)',
    patch: { A: { in1: 'sparks', zoom: 85, spin: 0, trails: 80, color: 6, blur: 0.1 } } },
  { name: 'Phone at the monitor', needs: 'phone', after: 'Scan the code, then aim your phone at this screen.',
    text: 'Aim your phone at this screen for real camera-and-TV feedback. Tilt the phone to twist the spiral.',
    how: 'PHONE · SIZE FULL · TRAILS 70',
    sw: 'repeating-conic-gradient(from 0deg at 50% 50%,#1b0f3d 0 10deg,#ff7ac6 10deg 14deg)',
    patch: { A: { in1: 'phone', size: 100, trails: 70, color: 4 } } },
  { name: 'Slow drift',
    text: 'Calm and slow. Good for leaving on a second screen or a projector while music plays.',
    how: 'A WAVE · B SHAPE · BOTH FEEDS 30',
    sw: 'linear-gradient(90deg,#0d2238,#1f5f7a 40%,#6fb7b0 75%,#d8e8c8)',
    patch: { A: { in1: 'wave', size: 50, form: 2, zoom: 6, spin: 3, trails: 96, color: 5, warp: 12, mirror: 2, blur: 0.35 },
             B: { in1: 'shape', form: 5, zoom: -10, spin: -4, trails: 96, color: 8, mirror: 4, edge: 1, blur: 0.3 }, xab: 30, xba: 30, view: 50 } },
  { name: 'Hands-free show', autopilot: true, after: 'Autopilot is on. Leave it running, or move a slider to pin it where you want it.',
    text: 'Autopilot gives each loop a new look every half minute or so and fades slowly between them. Leave it on a TV or projector.',
    how: 'AUTOPILOT',
    sw: 'linear-gradient(90deg,#ffae3b,#ff4fa3 35%,#6a2bd9 65%,#4fd1c5)',
    patch: { A: { in1: 'wave', form: 3, zoom: 14, spin: 6, trails: 92, color: 14, mirror: 4, blur: 0.2 } } },
  { name: 'Music visualizer', needs: 'sound', sound: 'system', soundAmount: 70,
    soundMap: { kick: true, size: true, spin: false, color: true, warp: false, flash: true },
    after: 'Pick a screen, switch on “Also share system audio”, press Share, then play some music.',
    text: 'Play music on this computer and two mirrored loops pump on the bass, flash on the beats and shift color with the highs.',
    how: 'COMPUTER SOUND · ZOOM KICK · SIZE · COLOR · FLASH',
    sw: 'repeating-linear-gradient(90deg,#141210 0 4px,transparent 4px 10px),linear-gradient(0deg,#ffae3b,#ff4fa3 45%,#6a2bd9 80%,#1b0f3d)',
    patch: { A: { in1: 'shape', form: 3, zoom: 12, spin: 6, trails: 86, color: 10, mirror: 4, blur: 0.1 },
             B: { in1: 'wave', form: 4, zoom: -15, spin: -8, trails: 90, color: 20, mirror: 6, edge: 1 }, xab: 25, xba: 25, view: 50 } },
  { name: 'Sound tunnel', needs: 'sound', sound: 'system', anySound: true, soundAmount: 40,
    after: 'Pick a screen, switch on “Also share system audio”, press Share, then play some music. Or choose Microphone under the Spectrograph.',
    text: 'The music itself, drawn as rings that ripple out from the middle, then pulled into a tunnel. Bass sits at the bottom of each ring, cymbals at the top.',
    how: 'SPECTROGRAPH · ROUND · ZOOM IN 25 · TRAILS 86',
    sw: 'repeating-radial-gradient(circle at 50% 50%,#1b0f3d 0 5px,#7b3cff 5px 7px,#ff4fa3 7px 9px,#ffcf6b 9px 10px,#1b0f3d 10px 14px)',
    patch: { A: { in1: 'spectro', specRound: true, size: 100, zoom: 25, spin: 8, trails: 86, color: 8, blur: 0.1 } } },
  { name: 'One-way river', after: 'Loop A pours into loop B. Try Feed B into A too.',
    text: 'Loop A is fed straight into loop B as its input, so B spins A’s picture into a whirlpool while A stays calm.',
    how: 'B INPUT: LOOP A · B SPIN 35 · BOTH ON SCREEN',
    sw: 'linear-gradient(90deg,#ffae3b 0 40%,#4fd1c5)',
    patch: { A: { in1: 'bars', size: 50, zoom: 10, spin: 0, trails: 88, color: 8 },
             B: { in1: 'loop', size: 42, zoom: 30, spin: 35, trails: 93, color: 18, mirror: 2 }, view: 50 } },
  { name: 'Frog hike', after: 'W A S D walk the hiker, J jumps. Let go and he walks by himself.',
    text: 'Mount Ribbit with light trails: every step smears the frog king, his crown and the clouds into soft streaks of colour.',
    how: 'MOUNT RIBBIT · TRAILS 55 · COLOR 6',
    sw: 'radial-gradient(circle at 50% 42%,#9bd34a 0 26%,#3c8d5a 27% 52%,#f6c38c 53%)',
    patch: { A: { in1: 'ribbit', size: 100, zoom: 0, spin: 0, trails: 55, color: 6, blur: 0 } } },
];
function recipeBlocked(r) {
  if (!r.needs) return '';
  if (inArtifact) return 'Needs the downloaded copy or your web address. Camera, screen, phone and sound are turned off in this preview.';
  if (r.needs === 'phone' && !phoneOK) return 'Needs Phosphor Loop opened from its https:// web address.';
  if (APP && r.needs === 'screen') return 'Needs a computer: phones can’t share their screen with Phosphor Loop.';
  if (APP && r.needs === 'sound') return appInfo.sound || r.anySound ? '' : 'Needs Android 10 or newer to hear the phone’s sound.';
  if (r.anySound) return navigator.mediaDevices ? '' : 'This browser can’t hear sound on this page.';
  if ((r.needs === 'screen' || r.needs === 'sound') && !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) return 'This browser can’t share its screen or sound. Use Chrome or Edge on a computer.';
  return '';
}
const recipeWrap = $('#recipes');
RECIPES.forEach((r) => {
  const a = document.createElement('article');
  a.className = 'g-recipe';
  const blocked = recipeBlocked(r);
  a.innerHTML = `<div class="g-swatch" style="--sw:${r.sw}"></div><h3>${r.name}</h3><p>${r.text}</p><p class="g-how">${r.how}</p>` +
    `<div class="g-act">${blocked ? `<span class="hint">${blocked}</span>` : '<button class="btn small">Try it</button>'}</div>`;
  const btn = a.querySelector('button');
  if (btn) btn.addEventListener('click', () => applyRecipe(r));
  recipeWrap.appendChild(a);
});
function applyRecipe(r) {
  if (ap.on) setAutopilot(false, true);
  markPreset(null);
  const p = JSON.parse(JSON.stringify(r.patch));
  if (p.A.in1 === 'video' && !vid.on) { if (clipsReady()) clipPick(pick(clipsAp()), true); else p.A.in1 = 'picture'; }
  // A recipe is a look for two loops
  setLoopCount(2, 'load');
  patchLoop('A', p.A, true);
  patchLoop('B', p.B || B_PARTNER, true);
  mix.tgt.view = p.view ?? 0;
  mix.tgt.xab = p.xab ?? 0;
  mix.tgt.xba = p.xba ?? 0;
  mix.base = { ...mix.tgt };
  ADJ_SRC.forEach((src) => { adj[src] = { ...adjDefaults(), ...((p.adj && p.adj[src]) || {}) }; });
  syncAdjUI();
  closeGuide();
  setEdit('A');
  // Start any device right here, inside the click, so the browser lets it ask for permission
  const inp = p.A.in1;
  if (inp === 'camera' && !cam.on) startCamera();
  if (inp === 'screen' && !scr.on) startScreen(true);
  if (inp === 'phone') startPhoneLink();
  let after = r.after;
  if (r.sound) {
    if (r.soundMap) Object.assign(snd.map, r.soundMap);
    if (r.soundAmount != null) snd.amount = r.soundAmount;
    syncSoundUI();
    if (r.anySound) {
      // Any sound will do: keep whatever is already listening, and use the microphone where the computer's sound can't be shared
      const noSystem = APP ? !appInfo.sound : (noScreenAudio || !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia));
      if (snd.analyser) after = 'Listening already. Play some music and watch it draw.';
      else if (noSystem) { setSound('mic'); after = 'Allow the microphone, then play music nearby.'; }
      else setSound(r.sound);
    } else if (snd.src !== r.sound || !snd.analyser) setSound(r.sound);
  }
  settleDevices();
  syncUI();
  burst();
  showOSD('RECIPE', r.name.toUpperCase());
  toast(after || `Recipe loaded: ${r.name}.`);
  if (r.autopilot) setAutopilot(true);
}

const guide = $('#guide');
let guideReturn = null;
function openGuide() {
  if (!guide.hidden) return;
  guideReturn = document.activeElement;
  guide.hidden = false;
  guide.scrollTop = 0;
  document.documentElement.style.overflow = 'hidden';
  $('#guideClose').focus();
}
function closeGuide() {
  if (guide.hidden) return;
  guide.hidden = true;
  document.documentElement.style.overflow = '';
  if (guideReturn && guideReturn.focus) guideReturn.focus();
}
$('#guideBtn').addEventListener('click', openGuide);
$('#guideClose').addEventListener('click', closeGuide);
$('#guideDone').addEventListener('click', closeGuide);
guide.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); closeGuide(); }
  else e.stopPropagation(); // keep the keys from firing while reading
});
if (location.hash === '#guide') openGuide();

/* ================= my presets ================= */
// Saved in this browser's own storage: they survive closing the page, and stay on this device.
const PRESET_KEY = 'phosphor-presets-v1';
let thumbReq = null;
const storageOK = (() => { try { localStorage.setItem('__pl', '1'); localStorage.removeItem('__pl'); return true; } catch (_) { return false; } })();
function readPresets() {
  try { const v = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}
function writePresets() {
  if (!storageOK) return false;
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); return true; } catch (_) { return false; }
}
let presets = readPresets();
if (!storageOK) $('#presetNote').textContent = 'This browser isn’t letting the page keep anything (a private window, perhaps), so presets last only until you close the page.';
const presetList = $('#presetList'), presetForm = $('#presetForm'), presetName = $('#presetName'), presetSaveBtn = $('#presetSave');

function snapshot() {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  return {
    v: 1,
    A: clone(loops.A.tgt), B: clone(loops.B.tgt),
    // Loops C and D, and how many loops, only when there are more than two (older versions just read A and B)
    ...(loopCount > 2 ? { n: loopCount, C: clone(loops.C.tgt), ...(loopCount > 3 ? { D: clone(loops.D.tgt) } : {}) } : {}),
    mix: { view: mix.tgt.view, xab: mix.tgt.xab, xba: mix.tgt.xba, showA: mix.tgt.showA, showB: mix.tgt.showB,
           ...(loopCount > 2 ? { showC: mix.tgt.showC, xc: mix.tgt.xc } : {}), ...(loopCount > 3 ? { showD: mix.tgt.showD, xd: mix.tgt.xd } : {}) },
    adj: clone(adj),
    snd: { amount: snd.amount, map: clone(snd.map), react: clone(snd.react) },
    text: { str: txt.str, style: txt.style },
    grade: { ...grade },
    relief: { ...relief },
  };
}
// While Autopilot runs, a preset also keeps Autopilot's settings and pins, so loading it starts Autopilot again
function apSnapshot() {
  return { every: apSet.every, fade: apSet.fade, wild: apSet.wild, mix: apSet.mix, taste: apSet.taste, beat: apSet.beat, check: apSet.check,
    hints: apSet.hints, touch: apSet.touch,
    off: [...apSet.off], pins: [...ap.pins], lim: cleanLim(apSet.lim), weights: cleanWeights(apSet.weights) };
}
function markPreset(id) {
  activePresetId = id;
  $$('.pre-load').forEach((b) => b.setAttribute('aria-pressed', String(b.parentElement.dataset.id === id)));
}
function renderPresets() {
  presetList.innerHTML = '';
  $('#presetEmpty').hidden = presets.length > 0;
  presets.forEach((pr) => {
    const t = document.createElement('div');
    t.className = 'pre';
    t.dataset.id = pr.id;
    const name = escapeHTML(pr.name);
    const auto = !!(pr.data && pr.data.ap);
    const thumb = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(pr.thumb || '') ? `background-image:url(${pr.thumb})` : '';
    t.innerHTML =
      `<button class="pre-load" aria-pressed="${pr.id === activePresetId}" title="Load ${name}${auto ? ' and start Autopilot' : ''}"><span class="sw" style="${thumb}"></span>` +
      `${auto ? '<span class="pre-auto">AUTO</span>' : ''}<span class="nm">${name}</span></button>` +
      `<button class="pre-del" aria-label="Delete ${name}" title="Delete">×</button>` +
      `<div class="pre-confirm" hidden><span>Delete “${name}”?</span><div><button class="yes">Delete</button><button class="no">Keep</button></div></div>`;
    const confirmBox = t.querySelector('.pre-confirm');
    t.querySelector('.pre-load').addEventListener('click', () => loadPreset(pr));
    t.querySelector('.pre-del').addEventListener('click', () => { confirmBox.hidden = false; confirmBox.querySelector('.no').focus(); });
    confirmBox.querySelector('.no').addEventListener('click', () => { confirmBox.hidden = true; });
    confirmBox.querySelector('.yes').addEventListener('click', () => {
      presets = presets.filter((x) => x.id !== pr.id);
      writePresets();
      if (activePresetId === pr.id) activePresetId = null;
      renderPresets();
      toast(`Deleted “${pr.name}”.`);
    });
    presetList.appendChild(t);
  });
  // Presets count as likes for Learn my taste
  taste.model = null;
  tasteSummary();
}
function nextPresetName() {
  let n = presets.length + 1;
  while (presets.some((p) => p.name.toLowerCase() === `my look ${n}`)) n++;
  return `My look ${n}`;
}
presetSaveBtn.addEventListener('click', () => {
  presetForm.hidden = false;
  presetSaveBtn.hidden = true;
  presetName.value = activePresetId ? (presets.find((p) => p.id === activePresetId) || {}).name || nextPresetName() : nextPresetName();
  presetName.focus();
  presetName.select();
});
function closePresetForm() { presetForm.hidden = true; presetSaveBtn.hidden = false; }
$('#presetCancel').addEventListener('click', closePresetForm);
presetName.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closePresetForm(); } });
presetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = presetName.value.trim().slice(0, 40) || nextPresetName();
  const data = snapshot();
  if (ap.on) data.ap = apSnapshot();

  const thumb = await new Promise((res) => { thumbReq = res; });
  const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) { existing.data = data; existing.thumb = thumb; existing.saved = Date.now(); }
  else presets.push({ id: 'p' + Date.now().toString(36) + randId(4), name, thumb, data, saved: Date.now() });
  if (presets.length > 60) presets = presets.slice(-60);
  const ok = writePresets();
  closePresetForm();
  const id = (existing || presets[presets.length - 1]).id;
  activePresetId = id;
  renderPresets();
  if (!ok && storageOK) toast('Couldn’t save: this browser’s storage for the page is full. Delete a few presets and try again.');
  else {
    const withAp = data.ap ? ' with Autopilot' : '';
    toast(existing ? `Updated “${name}”${withAp}.` : `Saved “${name}”${withAp} in this browser.`);
  }
});

function loadPreset(pr, quiet) {
  for (const k of KEYS) loopGrade[k] = null;
  if (ap.on) setAutopilot(false, true);
  const d = pr.data || {};
  // A preset saved with three or four loops brings them back; any other is a look for two loops
  const n = d.n === 3 || d.n === 4 ? d.n : 2;
  setLoopCount(n, 'load');
  patchLoop('A', d.A || {}, true);
  patchLoop('B', d.B || B_PARTNER, true);
  if (n > 2) { patchLoop('C', d.C || C_START, true); loops.C.started = true; }
  if (n > 3) { patchLoop('D', d.D || D_START, true); loops.D.started = true; }
  // A preset saved with a mirror Transition brings it back (older ones keep yours), and its mirror is there at once
  for (const k of KEYS) {
    const s = d[k];
    if (s && s.mirrorFx in MIRROR_FX) loops[k].tgt.mirrorFx = s.mirrorFx;
    if (s && typeof s.mirrorSpin === 'boolean') loops[k].tgt.mirrorSpin = s.mirrorSpin;
    mirrorCut(k);
  }
  const m = d.mix || {};
  mix.tgt.view = m.view ?? 0; mix.tgt.xab = m.xab ?? 0; mix.tgt.xba = m.xba ?? 0;
  if (Number.isFinite(m.showA) && Number.isFinite(m.showB)) { mix.tgt.showA = m.showA; mix.tgt.showB = m.showB; }
  mix.tgt.showC = m.showC ?? 100; mix.tgt.xc = m.xc ?? 0;
  mix.tgt.showD = m.showD ?? 100; mix.tgt.xd = m.xd ?? 0;
  for (const k of ['C', 'D']) if (loopOn(k)) clearLoopTargets(k);
  mix.base = { ...mix.tgt };
  ADJ_SRC.forEach((src) => { adj[src] = { ...adjDefaults(), ...((d.adj && d.adj[src]) || {}) }; });
  syncAdjUI();
  if (d.snd) { if (d.snd.amount != null) snd.amount = d.snd.amount; if (d.snd.map) Object.assign(snd.map, d.snd.map); syncSoundUI(); }
  // Loops that react: as saved, or every loop for a preset saved before the switches existed
  snd.react = { A: true, B: true, C: true, D: true, ...((d.snd && d.snd.react) || {}) };
  syncSoundUI();
  // Presets saved before Color grading existed load with it at normal
  setGrade(d.grade);
  setRelief(d.relief);
  // Start any camera, screen or phone the preset uses, right here inside the click
  const used = activeKeys().flatMap((k) => [loops[k].tgt.in1, loops[k].tgt.in2]);
  // A preset that shows Text brings back the words it was saved with (others leave your words alone)
  if (used.includes('text') && d.text && typeof d.text.str === 'string') {
    txt.str = d.text.str.slice(0, 60);
    if (d.text.style in TEXT_FONTS) txt.style = d.text.style;
    drawText();
    saveText();
  }
  if (used.includes('camera') && !cam.on) startCamera();
  if (used.includes('screen') && !scr.on) startScreen(true);
  if (used.includes('phone')) startPhoneLink();
  settleDevices();
  setEdit('A');
  syncUI();
  // Saved while Autopilot was running: its settings and pins come back, and it carries on from this look
  const a = d.ap;
  if (a && typeof a === 'object') {
    for (const k of ['every', 'fade', 'wild', 'mix', 'taste']) if (Number.isFinite(a[k])) apSet[k] = clamp(Math.round(a[k]), 0, 100);
    apSet.beat = a.beat === true;
    // Presets saved before Check each look (or Learn from hints) existed have it on
    apSet.check = a.check !== false;
    apSet.hints = a.hints !== false;
    apSet.touch = cleanTouch(a.touch);
    apSet.off = cleanOff(a.off);
    // Presets saved before input weights existed have every input at Normal
    apSet.weights = cleanWeights(a.weights);
    // Presets saved before fader limits existed leave the limits as they are
    if (a.lim && typeof a.lim === 'object') apSet.lim = cleanLim(a.lim);
    ap.pins.clear();
    ap.pinVal = {};
    if (Array.isArray(a.pins)) a.pins.forEach(addSavedPin);
    saveAp();
    syncApUI();
    setAutopilot(true, true);
  }
  markPreset(pr.id);
  if (!quiet) {
    burst();
    showOSD('PRESET', pr.name.toUpperCase().slice(0, 18));
  }
  if (used.includes('video') && !vid.on && clipsReady()) clipPick(pick(clipsAp()), true);
  // (a session coming back with the page brings its library clip back by itself: see clipsStart)
  else if (used.includes('video') && !vid.on && !(quiet && clipsWanted())) toast('This preset uses a video. Choose one under Video.');
  else if (used.includes('spectro') && !snd.analyser && snd.src === 'off' && !quiet) toast('This look uses the Spectrograph. Under the inputs, pick Computer sound or Microphone.');
  else if (ap.on && !quiet) toast(`Autopilot is on with this preset’s settings${ap.pins.size ? ' and pins' : ''}.`);
}
renderPresets();

/* ================= shared presets ================= */
// Looks the admin picks out for everyone. They live in presets.json next to this page, so every visitor gets them.
// Only someone holding a GitHub key that can change this site's files can add, rename or remove them. The key is
// pasted once (open the page with #admin on the end of the address), kept in this browser only, and used to save
// presets.json straight to the repository. GitHub Pages then puts the new list on the site within a minute or so.
const SHARED_REPO = 'nhillson/phosphor-loop', SHARED_FILE = 'presets.json', SHARED_MAX = 48, ADMIN_KEY = 'phosphor-admin-v1';
const GH_API = `https://api.github.com/repos/${SHARED_REPO}`;
let shared = [], adminKey = lsGet(ADMIN_KEY) || '', adminAsk = location.hash === '#admin', sharedBusy = false, sharedMode = null;
const sharedGroup = $('#sharedGroup'), sharedList = $('#sharedList'), sharedForm = $('#sharedForm'), sharedName = $('#sharedName');
const sharedAdd = $('#sharedAdd'), adminLogin = $('#adminLogin'), adminMsg = $('#adminMsg');

function cleanShared(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((p) => p && typeof p.id === 'string' && /^[a-z0-9]{1,40}$/i.test(p.id) && typeof p.name === 'string' && p.data && typeof p.data === 'object')
    .map((p) => ({ id: p.id, name: p.name.slice(0, 40), thumb: typeof p.thumb === 'string' ? p.thumb : '', data: p.data, saved: p.saved || 0 }));
}
function renderShared() {
  const admin = !!adminKey;
  sharedGroup.hidden = !shared.length && !admin && !adminAsk;
  $('#adminBox').hidden = !admin;
  adminLogin.hidden = admin || !adminAsk;
  const hint = $('#sharedHint');
  hint.textContent = shared.length ? 'Looks picked out for everyone. Tap one to load it.'
    : admin ? 'Nothing shared yet. Set up a look you like, then press Share current look with everyone.' : '';
  hint.hidden = !hint.textContent;
  // Taste profiles: the admin's buttons on them
  taste.model = null;
  renderTaste();
  sharedList.innerHTML = '';
  shared.forEach((pr) => {
    const t = document.createElement('div');
    t.className = 'pre';
    t.dataset.id = pr.id;
    const name = escapeHTML(pr.name);
    const auto = !!pr.data.ap;
    const thumb = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(pr.thumb) ? `background-image:url(${pr.thumb})` : '';
    t.innerHTML =
      `<button class="pre-load" aria-pressed="${pr.id === activePresetId}" title="Load ${name}${auto ? ' and start Autopilot' : ''}"><span class="sw" style="${thumb}"></span>` +
      `${auto ? '<span class="pre-auto">AUTO</span>' : ''}<span class="nm">${name}</span></button>` +
      (admin ? `<button class="pre-ren" aria-label="Rename ${name}" title="Rename">✎</button>` +
        `<button class="pre-del" aria-label="Take ${name} away from everyone" title="Take away from everyone">×</button>` +
        `<div class="pre-confirm" hidden><span>Take “${name}” away from everyone?</span><div><button class="yes">Take away</button><button class="no">Keep</button></div></div>` : '');
    t.querySelector('.pre-load').addEventListener('click', () => loadPreset(pr));
    if (admin) {
      const confirmBox = t.querySelector('.pre-confirm');
      t.querySelector('.pre-ren').addEventListener('click', () => openSharedForm({ kind: 'rename', id: pr.id, old: pr.name }));
      t.querySelector('.pre-del').addEventListener('click', () => { confirmBox.hidden = false; confirmBox.querySelector('.no').focus(); });
      confirmBox.querySelector('.no').addEventListener('click', () => { confirmBox.hidden = true; });
      confirmBox.querySelector('.yes').addEventListener('click', async () => {
        confirmBox.hidden = true;
        toast(`Taking “${pr.name}” away…`, 15000);
        if (await changeShared((list) => list.filter((x) => x.id !== pr.id), `Remove shared preset "${pr.name}"`)) {
          if (activePresetId === pr.id) activePresetId = null;
          toast(`“${pr.name}” is gone for everyone in about a minute.`);
        }
      });
    }
    sharedList.appendChild(t);
  });
}

// Talking to GitHub with the admin key
function gh(path, opts = {}) {
  return fetch(GH_API + path, { ...opts, cache: 'no-store', headers: {
    Accept: 'application/vnd.github+json', Authorization: `Bearer ${adminKey}`, 'X-GitHub-Api-Version': '2022-11-28' } });
}
function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
// The newest list, straight from GitHub (the site itself takes a minute to catch up after a change)
async function readSharedGH() {
  const r = await gh(`/contents/${SHARED_FILE}?ref=main`);
  if (r.status === 404) return { sha: null, list: [] };
  if (!r.ok) throw r;
  const j = await r.json(), file = JSON.parse(b64dec(j.content || ''));
  return { sha: j.sha, list: cleanShared(file.presets), tastes: cleanSharedTastes(file.tastes, file.taste) };
}
function adminTrouble(e) {
  const st = e && e.status;
  if (st === 401) return 'GitHub didn’t accept the admin key. It may have run out: make a new one and unlock again.';
  if (st === 403 || st === 404) return 'The admin key can’t save to the site. On GitHub, give it phosphor-loop with Contents set to Read and write.';
  if (st === 409 || st === 422) return 'Something else changed the shared presets at the same moment. Try again.';
  return 'Couldn’t reach GitHub. Check the internet connection and try again.';
}
// Reads the newest list, makes one change and saves it, so nothing shared from elsewhere gets lost.
// changeTastes, when given, changes the shared taste profiles too; otherwise they stay as they are.
async function changeShared(change, message, changeTastes) {
  if (sharedBusy) { toast('Still saving the last change. Try again in a moment.'); return false; }
  sharedBusy = true;
  sharedAdd.disabled = true;
  try {
    const { sha, list, tastes } = await readSharedGH();
    const next = change(list).slice(-SHARED_MAX);
    const nextTastes = (changeTastes ? changeTastes(tastes) : tastes).slice(-16);
    const file = { v: 1, presets: next };
    if (nextTastes.length) file.tastes = nextTastes;
    const body = { message, branch: 'main', content: b64enc(JSON.stringify(file)) };
    if (sha) body.sha = sha;
    const w = await gh(`/contents/${SHARED_FILE}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!w.ok) throw w;
    shared = next;
    taste.sharedList = nextTastes;
    taste.model = null;
    renderShared();
    return true;
  } catch (e) {
    toast(adminTrouble(e), 9000);
    return false;
  } finally {
    sharedBusy = false;
    sharedAdd.disabled = false;
  }
}

// Share current look, or rename one: the same little form, asking for a name
function nextSharedName() {
  let n = shared.length + 1;
  while (shared.some((p) => p.name.toLowerCase() === `shared look ${n}`)) n++;
  return `Shared look ${n}`;
}
function openSharedForm(mode) {
  sharedMode = mode;
  const active = [...presets, ...shared].find((p) => p.id === activePresetId);
  $('#sharedFormLbl').textContent = mode.kind === 'rename' ? `New name for “${mode.old}”` : 'Name it for everyone';
  $('#sharedGo').textContent = mode.kind === 'rename' ? 'Rename' : 'Share';
  sharedName.value = mode.kind === 'rename' ? mode.old : (active ? active.name : nextSharedName());
  sharedForm.hidden = false;
  sharedAdd.hidden = true;
  sharedName.focus();
  sharedName.select();
}
function closeSharedForm() { sharedForm.hidden = true; sharedAdd.hidden = false; sharedMode = null; }
sharedAdd.addEventListener('click', () => openSharedForm({ kind: 'add' }));
$('#sharedCancel').addEventListener('click', closeSharedForm);
sharedName.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeSharedForm(); } });
sharedForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = sharedMode;
  if (!mode) return;
  const name = sharedName.value.trim().slice(0, 40) || (mode.kind === 'rename' ? mode.old : nextSharedName());
  closeSharedForm();
  if (mode.kind === 'rename') {
    toast('Renaming…', 15000);
    if (await changeShared((list) => list.map((p) => (p.id === mode.id ? { ...p, name } : p)), `Rename shared preset to "${name}"`)) {
      toast(`Renamed to “${name}”. Everyone sees the new name in about a minute.`);
    }
    return;
  }
  const data = snapshot();
  if (ap.on) data.ap = apSnapshot();
  const thumb = await new Promise((res) => { thumbReq = res; });
  toast('Sharing…', 15000);
  let id = '';
  const ok = await changeShared((list) => {
    // The same name again replaces that shared preset
    const same = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (same) { id = same.id; return list.map((p) => (p === same ? { ...p, name, thumb, data, saved: Date.now() } : p)); }
    id = 's' + Date.now().toString(36) + randId(4);
    return [...list, { id, name, thumb, data, saved: Date.now() }];
  }, `Share preset "${name}"`);
  if (ok) {
    markPreset(id);
    toast(`Shared “${name}”${data.ap ? ' with Autopilot' : ''}. Everyone gets it in about a minute.`, 7000);
  }
});

// Becoming the admin on this device: open the page with #admin, paste the key, press Unlock
adminLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('#adminKey').value.trim();
  if (!key) return;
  adminMsg.classList.remove('warn');
  adminMsg.textContent = 'Checking the key with GitHub…';
  $('#adminGo').disabled = true;
  let r = null;
  try {
    r = await fetch(GH_API, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${key}` } });
  } catch (_) {}
  $('#adminGo').disabled = false;
  if (!r || !r.ok) {
    adminMsg.classList.add('warn');
    adminMsg.textContent = !r ? 'Couldn’t reach GitHub. Check the internet connection and try again.'
      : r.status === 401 ? 'GitHub didn’t accept that key. Copy it again and paste the whole thing.'
      : 'That key can’t open phosphor-loop. On GitHub, make sure it has phosphor-loop with Contents set to Read and write.';
    return;
  }
  adminKey = key;
  lsSet(ADMIN_KEY, key);
  $('#adminKey').value = '';
  adminAsk = false;
  if (location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search);
  adminMsg.textContent = 'Paste the key you made on GitHub. It stays in this browser only.';
  renderShared();
  toast('You’re the admin on this device. Under Shared presets, press Share current look with everyone.', 7000);
  loadShared();
});
$('#adminOut').addEventListener('click', () => {
  adminKey = '';
  try { localStorage.removeItem(ADMIN_KEY); } catch (_) {}
  closeSharedForm();
  renderShared();
  toast('This device isn’t the admin any more. Open the page with #admin on the end to unlock again.');
});
window.addEventListener('hashchange', () => {
  if (location.hash !== '#admin') return;
  adminAsk = true;
  renderShared();
  sharedGroup.scrollIntoView({ block: 'start', behavior: 'smooth' });
});

// Everyone gets the list from the site; the admin reads it straight from GitHub so a change shows at once
async function loadShared() {
  try {
    const r = await fetch(SHARED_FILE, { cache: 'no-cache' });
    if (r.ok) { const j = await r.json(); shared = cleanShared(j.presets); taste.sharedList = cleanSharedTastes(j.tastes, j.taste); }
  } catch (_) {}
  if (adminKey) { try { const g = await readSharedGH(); shared = g.list; taste.sharedList = g.tastes; } catch (_) {} }
  taste.model = null;
  renderShared();
}
renderShared();
loadShared();
renderTaste();

/* ================= folding sections ================= */
// Every section heading folds its section away. What's folded is remembered in this browser.
// Presets and taste profiles sit folded at the bottom until opened (v2: the controls were rearranged, so everyone
// starts again from these defaults).
const FOLD_KEY = 'phosphor-folded-v2';
const FOLD_DEFAULT = ['h-shared', 'h-pre', 'h-taste'];
let folded = {};
try { folded = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (_) { folded = {}; }
const foldControls = [];
$$('.panel .group').forEach((group) => {
  const h2 = group.querySelector(':scope > h2');
  if (!h2) return;
  const key = h2.id || group.id;
  const body = document.createElement('div');
  body.className = 'group-body';
  body.id = 'fold-' + key;
  while (h2.nextSibling) body.appendChild(h2.nextSibling);
  group.appendChild(body);
  const label = document.createElement('span');
  label.textContent = h2.textContent;
  if (h2.id) { label.id = h2.id; h2.removeAttribute('id'); }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'group-toggle';
  btn.setAttribute('aria-controls', body.id);
  const rule = document.createElement('span'); rule.className = 'rule';
  const chev = document.createElement('span'); chev.className = 'chev'; chev.setAttribute('aria-hidden', 'true');
  btn.append(label, rule, chev);
  h2.textContent = '';
  h2.classList.add('fold');
  h2.appendChild(btn);
  const set = (open, save) => {
    btn.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    if (save) { folded[key] = !open; try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch (_) {} }
  };
  set(!(folded[key] ?? FOLD_DEFAULT.includes(key)), false);
  btn.addEventListener('click', () => set(body.hidden, true));
  foldControls.push(set);
});
$('#foldAll').addEventListener('click', () => foldControls.forEach((set) => set(false, true)));
$('#openAll').addEventListener('click', () => foldControls.forEach((set) => set(true, true)));

/* ================= keyboard ================= */
function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target && e.target.tagName;
  if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'range')) return;
  const onControl = tag === 'BUTTON' || tag === 'INPUT';
  if (ribKey(e, true)) return;
  if (e.key === ' ' && !onControl) { toggleFreeze(); e.preventDefault(); }
  else if (e.key === 'r' || e.key === 'R') surprise();
  else if (e.key === 'p' || e.key === 'P') setAutopilot(!ap.on);
  else if (e.key === 'l' || e.key === 'L') nextLook();
  else if ((e.key === 'y' || e.key === 'Y') && !e.repeat) rate(1);
  else if ((e.key === 'x' || e.key === 'X') && !e.repeat) rate(-1);
  else if (e.key === 'n' || e.key === 'N') neutral();
  else if (e.key === 'c' || e.key === 'C') clearScreen();
  else if (e.key === 'f' || e.key === 'F') toggleFS();
  else if ((e.key === 'v' || e.key === 'V') && !e.repeat) toggleRec();
  else if (e.key === 'g' || e.key === 'G' || e.key === '?') openGuide();
}
window.addEventListener('keydown', onKey);

/* ================= saving ================= */
const snapBtn = $('#snap');
const recBtn = $('#rec');
const recMicBtn = $('#recMic');
const canRecord = typeof canvas.captureStream === 'function' && typeof window.MediaRecorder !== 'undefined';
const canRecMic = !inArtifact && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
let downloadsNS = null;
let saveMode = 'none';
function setSaveUI(mode) {
  saveMode = mode;
  snapBtn.hidden = mode === 'none';
  recBtn.hidden = mode === 'none' || !canRecord;
  recMicBtn.hidden = recBtn.hidden || !canRecMic;
}
if (inArtifact) {
  window.claude.use('downloads').then((ns) => { downloadsNS = ns; setSaveUI(ns ? 'claude' : 'none'); }, () => setSaveUI('none'));
} else {
  setSaveUI('anchor');
}
// In the Android app, pictures and videos go to the phone's gallery. The file travels in slices,
// because a video is too big to hand over in one piece.
async function appSave(name, blob) {
  const mime = (blob.type || '').split(';')[0] || (name.endsWith('.png') ? 'image/png' : 'video/webm');
  const SLICE = 3 * 512 * 1024;
  let ok = false, where = '';
  try {
    if (!APP.saveBegin(name, mime)) throw new Error('begin');
    for (let i = 0; i < blob.size; i += SLICE) {
      const part = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob.slice(i, i + SLICE));
      });
      if (!APP.saveChunk(part)) throw new Error('chunk');
    }
    ok = true;
  } catch (_) {}
  try { where = APP.saveEnd(ok) || ''; } catch (_) { where = ''; }
  toast(ok && where ? `Saved to ${where}.` : 'That couldn’t be saved. Check the phone has free space, then try again.');
}
// In full screen the message line under the picture is hidden, so recording messages also show on the picture
const fsNote = $('#fsNote');
let fsNoteTimer = null;
function recNote(text, ms = 4500) {
  toast(text, ms);
  clearTimeout(fsNoteTimer);
  if (!(document.fullscreenElement || document.webkitFullscreenElement)) { fsNote.hidden = true; return; }
  fsNote.textContent = text;
  fsNote.hidden = false;
  fsNoteTimer = setTimeout(() => { fsNote.hidden = true; }, ms);
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) fsNote.hidden = true; });
// Before each save, a box on the picture offers the usual name, ready to type over. Enter keeps it.
// Don't save asks twice, so a long video isn't thrown away by one stray click.
const nameBox = $('#nameBox'), nameIn = $('#nameIn'), nameDrop = $('#nameDrop');
let nameQueue = Promise.resolve();
function cleanName(typed, ext, fallback) {
  let n = String(typed || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (n.toLowerCase().endsWith(ext.toLowerCase())) n = n.slice(0, -ext.length).trim();
  n = n.replace(/[. ]+$/, '');
  return n || fallback;
}
function showNameBox(base, ext) {
  return new Promise((resolve) => {
    const video = ext !== '.png' && ext !== '.json';
    $('#nameTitle').textContent = ext === '.json' ? 'Name this taste file' : video ? 'Name this video' : 'Name this picture';
    $('#nameExt').textContent = ext;
    nameDrop.textContent = 'Don’t save';
    let armed = false;
    nameIn.value = base;
    nameBox.hidden = false;
    nameIn.focus();
    nameIn.select();
    const done = (value) => {
      nameBox.hidden = true;
      nameBox.removeEventListener('submit', onSave);
      nameDrop.removeEventListener('click', onDrop);
      nameIn.blur();
      resolve(value);
    };
    const onSave = (e) => { e.preventDefault(); done(cleanName(nameIn.value, ext, base)); };
    const onDrop = () => {
      if (!armed) { armed = true; nameDrop.textContent = video ? 'Throw the video away?' : 'Throw it away?'; return; }
      done(null);
    };
    nameBox.addEventListener('submit', onSave);
    nameDrop.addEventListener('click', onDrop);
  });
}
function askName(name) {
  const dot = name.lastIndexOf('.');
  const run = nameQueue.then(() => showNameBox(name.slice(0, dot), name.slice(dot)));
  nameQueue = run.catch(() => {});
  return run.then((base) => (base === null ? null : base + name.slice(dot)));
}
async function offerFile(name, blob) {
  const named = await askName(name);
  if (named === null) { recNote(name.endsWith('.png') ? 'The picture wasn’t saved.' : name.endsWith('.json') ? 'The taste file wasn’t saved.' : 'The video wasn’t saved.'); return; }
  name = named;
  if (APP) { appSave(name, blob); return; }
  if (saveMode === 'claude' && downloadsNS) {
    try {
      const res = await downloadsNS.save({ filename: name, data: blob });
      if (res && res.status === 'saved') toast(`Saved ${name}`);
    } catch (err) {
      const code = err && err.code;
      if (code === 'declined') toast('Save cancelled.');
      else if (code === 'too_large') toast('That clip is too large to save here. Try a shorter recording.');
      else if (code === 'rate_limited') toast('A save is already waiting for your answer.');
      else { toast('Saving isn’t available here.'); setSaveUI('none'); }
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  recNote(`Saved ${name} to your Downloads folder.`);
}
let snapPending = false;
snapBtn.addEventListener('click', () => { snapPending = true; });

// A recording runs until Record is pressed again; there is no time limit.
let recorder = null, recChunks = [], recStart = 0, recStopAt = 0, recTick = null, recStarting = false;
const recInd = $('#recInd'), recTime = $('#recTime'), recLabel = $('#recLabel');
function fmt(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Video sound: which sound goes into videos. Each click steps on: Off, Mic, Computer, Both.
// (On the phone app, Computer is called Phone.) The choice is remembered in this browser.
const REC_SOUNDS = ['off', 'mic', 'computer', 'both'];
const REC_SOUND_NAMES = { off: 'Off', mic: 'Mic', computer: APP ? 'Phone' : 'Computer', both: 'Both' };
const compSound = APP ? 'this phone’s sound' : 'this computer’s sound';
const recSoundLabel = $('#recSoundLabel');
let recSound = 'both';
try {
  const saved = localStorage.getItem('phosphor-recsound');
  if (REC_SOUNDS.includes(saved)) recSound = saved;
  else if (localStorage.getItem('phosphor-recmic') === '0') recSound = 'computer';   // the old Include mic, switched off
} catch (_) {}
function setRecSound(mode) {
  recSound = mode;
  recMicBtn.setAttribute('aria-pressed', String(mode !== 'off'));
  recSoundLabel.textContent = `Video sound: ${REC_SOUND_NAMES[mode]}`;
  try { localStorage.setItem('phosphor-recsound', mode); } catch (_) {}
}
setRecSound(recSound);
recMicBtn.addEventListener('click', () => {
  if (recorder || recStarting) { toast('Stop the recording first, then change Video sound.'); return; }
  const next = REC_SOUNDS[(REC_SOUNDS.indexOf(recSound) + 1) % REC_SOUNDS.length];
  setRecSound(next);
  toast({
    off: 'Videos you record will be silent.',
    mic: 'Videos you record will have the microphone.',
    computer: `Videos you record will have ${compSound}: Spotify, YouTube, anything it plays.`,
    both: `Videos you record will have the microphone and ${compSound}, mixed together.`,
  }[next], 6000);
});
const isLoopback = (label) => LOOPBACK.test(label || '');
const noSoundFixes = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
function soundErr(name) { const e = new Error(name); e.name = name; return e; }
// This computer's sound for a video, when React to sound isn't already hearing it. Chrome and Edge get it by
// sharing a screen with its sound (the screen's picture is dropped at once). Firefox and Safari can't, so they
// use Stereo Mix or a similar input, if the computer has one.
async function openRecComputer() {
  if (!noScreenAudio && navigator.mediaDevices.getDisplayMedia) {
    // Chrome only opens the sharing box right after a click or key press in this window
    if (navigator.userActivation && !navigator.userActivation.isActive) throw soundErr('NeedPress');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor' },
      audio: { ...noSoundFixes, suppressLocalAudioPlayback: false },
      systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'include',
    });
    stream.getVideoTracks().forEach((t) => t.stop());
    const track = stream.getAudioTracks()[0];
    if (!track) throw soundErr('NoSoundShared');
    return track;
  }
  const inputs = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  let ins = await inputs();
  if (ins.length && ins.every((d) => !d.label)) {
    // The browser only shows the inputs' names once the microphone is allowed
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    s.getTracks().forEach((t) => t.stop());
    ins = await inputs();
  }
  const loop = ins.find((d) => isLoopback(d.label));
  if (!loop) throw soundErr('NoLoopback');
  const s = await navigator.mediaDevices.getUserMedia({ audio: { ...noSoundFixes, deviceId: { exact: loop.deviceId } }, video: false });
  return s.getAudioTracks()[0];
}
// A room microphone, never Stereo Mix and the like (those carry the computer's sound, not a voice)
async function openRecMic() {
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const picked = [...micSel.options].find((o) => o.value === micDeviceId);
  if (micDeviceId && picked && !isLoopback(picked.textContent)) audio.deviceId = { ideal: micDeviceId };
  let stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
  if (isLoopback(stream.getAudioTracks()[0].label)) {
    const ins = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications' && !isLoopback(d.label));
    if (ins.length) {
      stream.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: ins[0].deviceId } }, video: false });
    }
  }
  return stream.getAudioTracks()[0];
}
// Two sounds (music and mic) are blended into one, since a video holds a single sound track
function blendSounds(tracks) {
  if (tracks.length < 2) return { track: tracks[0] || null, ctx: null };
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const out = ctx.createMediaStreamDestination();
  tracks.forEach((t) => ctx.createMediaStreamSource(new MediaStream([t])).connect(out));
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return { track: out.stream.getAudioTracks()[0], ctx };
}

async function startRec() {
  if (recStarting || recorder) return;
  const sounds = [];
  // React to sound may already be hearing the mic or the computer. Then the video takes a copy of that
  // (so stopping the copy leaves listening alone) and nothing new is asked for.
  const heard = snd.track && snd.track.readyState === 'live' ? snd.track : null;
  const heardIsMic = !!heard && snd.src === 'mic' && !isLoopback(heard.label);
  if (recMicBtn.hidden) {
    // No Video sound button here (inside Claude, say): keep whatever React to sound hears, as before
    if (heard) sounds.push(heard.clone());
  } else {
    const wantMic = recSound === 'mic' || recSound === 'both';
    const wantComp = recSound === 'computer' || recSound === 'both';
    let gotMic = false, gotComp = false, asked = false;
    const notes = [];
    if (heard && wantMic && heardIsMic) { sounds.push(heard.clone()); gotMic = true; }
    if (heard && wantComp && !heardIsMic) { sounds.push(heard.clone()); gotComp = true; }
    // The phone's sound only comes through React to sound's Phone sound (Android has to ask for it there)
    if (wantComp && !gotComp && APP) notes.push('To put the phone’s sound in videos, first choose Phone sound under React to sound.');
    const needMic = wantMic && !gotMic && canRecMic;
    const needComp = wantComp && !gotComp && !APP;
    const tryMic = async () => {
      // If the browser stops to ask about the microphone, say what to press
      const asking = setTimeout(() => { asked = true; recNote('Your browser is asking to use the microphone. Choose Allow and recording starts.', 30000); }, 600);
      try { sounds.push(await openRecMic()); gotMic = true; }
      catch (err) {
        const n = err && err.name;
        if (n === 'NotAllowedError' || n === 'SecurityError') {
          setRecSound(recSound === 'both' ? 'computer' : 'off');
          notes.push(APP ? 'The microphone wasn’t allowed, so this video has no mic. To try again, set Video sound back to Mic or Both.'
            : 'The microphone is blocked, so this video has no mic. To fix it, click the microphone icon in the address bar, choose Allow, then set Video sound back to Mic or Both.');
        } else notes.push('No microphone was found, so this video has no mic.');
      }
      clearTimeout(asking);
    };
    const tryComp = async () => {
      if (!noScreenAudio) {
        asked = true;
        recNote('To record this computer’s sound: in the box that opens, pick a screen on the Entire Screen tab, switch on Also share system audio, then press Share. Recording starts after.', 60000);
      }
      try { sounds.push(await openRecComputer()); gotComp = true; }
      catch (err) {
        const n = err && err.name;
        if (n === 'NeedPress' || n === 'InvalidStateError') notes.push('This video has no computer sound: sharing it has to start from this window. Press Record or V here, or first choose Computer sound under React to sound, and then V works from the Output window too.');
        else if (n === 'NoLoopback') notes.push(`${browserName} can’t record this computer’s sound. Use Chrome or Edge, or turn on Stereo Mix (the Guide shows how).`);
        else if (n === 'NoSoundShared') notes.push('No sound came with the share, so this video has no computer sound. Next time, switch on Also share system audio under the screen you pick.');
        else if (n === 'NotAllowedError' && !noScreenAudio) notes.push('Sharing was cancelled, so this video has no computer sound.');
        else notes.push('This computer’s sound couldn’t start, so this video doesn’t have it.');
      }
    };
    if (needMic || needComp) {
      recStarting = true;
      recLabel.textContent = 'Starting…';
      // Chrome only opens its sharing box straight after a press of Record, so it asks for the computer first.
      // Firefox and Safari ask for the mic first, which also lets them see Stereo Mix by name.
      if (noScreenAudio) { if (needMic) await tryMic(); if (needComp) await tryComp(); }
      else { if (needComp) await tryComp(); if (needMic) await tryMic(); }
      recStarting = false;
      recLabel.textContent = 'Record';
    }
    const what = gotMic && gotComp ? `the microphone and ${compSound}` : gotMic ? 'the microphone' : gotComp ? compSound : '';
    if (notes.length) recNote(notes.join(' ') + (what ? ` Recording with ${what}.` : ''), 14000);
    else if (asked) recNote(`Recording with ${what}.`);
  }
  const stopSounds = () => sounds.forEach((t) => t.stop());
  let stream;
  try { stream = canvas.captureStream(30); } catch (e) { stopSounds(); recNote('Recording isn’t supported in this browser.'); return; }
  const blend = blendSounds(sounds);
  if (blend.track) stream.addTrack(blend.track);
  const withSound = !!blend.track;
  // MP4 with an H.264 picture and AAC sound plays almost anywhere (phones, Instagram, video editors), so it's
  // used whenever this browser can make it. Browsers that can't (Firefox, older Chrome) make WebM instead.
  const types = withSound
    ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  const cleanUp = () => {
    stream.getTracks().forEach((t) => t.stop());
    stopSounds();
    if (blend.ctx) { try { blend.ctx.close(); } catch (_) {} }
  };
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 10000000 } : undefined);
  } catch (e) { cleanUp(); recorder = null; recNote('Recording isn’t supported in this browser.'); return; }
  recChunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    const type = recorder.mimeType || mime || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(recChunks, { type });
    const ms = (recStopAt || performance.now()) - recStart;
    recChunks = [];
    cleanUp();
    recorder = null;
    clearInterval(recTick);
    recInd.hidden = true;
    recBtn.setAttribute('aria-pressed', 'false');
    recLabel.textContent = 'Record';
    if (blob.size) (ext === 'mp4' ? standardMp4(blob) : addWebmDuration(blob, ms)).then((file) => offerFile(`phosphor-loop-${stamp()}.${ext}`, file));
    else recNote('Nothing was recorded. Try again.');
  };
  recorder.start(250);
  recStart = performance.now();
  recStopAt = 0;
  recInd.hidden = false;
  recBtn.setAttribute('aria-pressed', 'true');
  recTime.textContent = '0:00';
  recLabel.textContent = 'Stop 0:00';
  recTick = setInterval(() => {
    const s = (performance.now() - recStart) / 1000;
    recTime.textContent = fmt(s);
    recLabel.textContent = `Stop ${fmt(s)}`;
  }, 250);
}
function stopRec() {
  if (recorder && recorder.state !== 'inactive') { recStopAt = performance.now(); recorder.stop(); }
}
function toggleRec() {
  if (recBtn.hidden) { toast('Recording isn’t available here.'); return; }
  recorder ? stopRec() : startRec();
}
recBtn.addEventListener('click', toggleRec);

/* ================= sizing ================= */
const narrowMQ = window.matchMedia('(max-width: 900px)');
const SHAPES = { fill: 0, tv: 4 / 3, wide: 16 / 9 };
let shape = 'fill';
try { const saved = localStorage.getItem('phosphor-shape'); if (saved && saved in SHAPES) shape = saved; } catch (_) {}

// Rebuild the loop buffers at a new width, stretching the old picture into them so nothing blinks.
const copyProg = program(FS_COPY);
gl.useProgram(copyProg.p);
set1i(copyProg, 'uSrc', 0);
function copyInto(dst, srcTex) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, simW, simH);
  gl.useProgram(copyProg.p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  set2f(copyProg, 'uSim', simW, simH);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function dropTarget(t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
// Picture sharpness: how many lines the loops are drawn with. Standard is the 576 lines Phosphor Loop has always
// used. High goes up to 1080 (like HD video), Full to the screen's own lines, so fine detail stays crisp on big
// screens and projectors. Auto starts where it last settled on this computer, steps up while the picture stays
// smooth and back down if frames drop (sharpTick). Effects keep their size whatever the lines: the loop shader
// measures its blur, Grow, Restless and Split lines in Standard-size steps (uPxK).
const SHARP_KEY = 'phosphor-sharp', SHARP_AUTO_KEY = 'phosphor-sharp-auto';
const SHARP_MODES = ['auto', 'standard', 'high', 'full'];
const SHARP_LEVELS = [SIM_H, 720, 900, 1080, 1440];
const SHARP_MAX_PX = 3.7e6;   // never more than about a 2560 x 1440 picture, so memory stays in hand
// ...except at Full, which goes up to 4K (3840 x 2160) on a computer with the memory for it
const FULL_MAX_PX = 8.3e6;
const maxPx = () => (sharp === 'full' && !sharpLowMem ? FULL_MAX_PX : SHARP_MAX_PX);
const sharpLowMem = !!APP || (navigator.deviceMemory > 0 && navigator.deviceMemory <= 4);
let sharp = 'auto';
try { const v = localStorage.getItem(SHARP_KEY); if (SHARP_MODES.includes(v)) sharp = v; } catch (_) {}
const sharpAuto = { level: 0, top: sharpLowMem ? 3 : SHARP_LEVELS.length - 1, ceiling: 0, ceilingAt: 0,
                    t0: 0, frames: 0, fast: 0, slow: 0, justUp: false, settle: 0 };
sharpAuto.ceiling = sharpAuto.top;
try { const v = +localStorage.getItem(SHARP_AUTO_KEY); if (v > 0 && v <= sharpAuto.top) sharpAuto.level = Math.round(v); } catch (_) {}
let fitLines = SIM_H, fitAspect = 4 / 3;
// How many lines to draw, for the setting and the size the picture is shown at (never fewer than Standard)
function wantLines() {
  const cap = capCfg();
  if (cap) return cap.renderHeight || SIM_H;
  const top = Math.max(SIM_H, fitLines);
  if (sharp === 'standard') return SIM_H;
  if (sharp === 'high') return Math.min(1080, top);
  if (sharp === 'full') return top;
  return Math.min(SHARP_LEVELS[sharpAuto.level], top);
}
function resim(aspect) {
  fitAspect = aspect;
  const cap = capCfg();
  // The stream app sets the lines itself (its build test asks for fewer than usual, on a computer with no graphics card)
  let h = cap ? Math.max(120, Math.round(wantLines())) : Math.max(SIM_H, Math.round(wantLines()));
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  let w = clamp(Math.round(h * aspect / 4) * 4, 256, Math.min(maxTex, cap ? 3840 : Math.round(1600 * h / SIM_H)));
  if (!cap && h > SIM_H && w * h > maxPx()) {
    const k = Math.sqrt(maxPx() / (w * h));
    h = Math.max(SIM_H, Math.round(h * k)); w = Math.max(256, Math.round(w * k / 4) * 4);
  }
  h = Math.min(h, maxTex);
  if (w === simW && h === simH) { sharpSay(); return; }
  const old = KEYS.filter((k) => loops[k].rt).map((k) => ({ k, rt: loops[k].rt, front: loops[k].rt[loops[k].front].tex }));
  const oldComp = comp;
  const sized = h !== simH;
  simW = w; simH = h; simAspect = simW / simH;
  // Time warp's memory belongs to the old size; it starts again at the new one
  if (sized) for (const k of KEYS) if (loops[k].tw) twDrop(loops[k]);
  sharpAuto.settle = 30;
  for (const o of old) {
    const L = loops[o.k];
    L.rt = [makeTarget(), makeTarget()];
    copyInto(L.rt[0], o.front);
    L.front = 0;
  }
  comp = makeTarget();
  for (const o of old) o.rt.forEach(dropTarget);
  dropTarget(oldComp);
  sharpSay();
}
// The Picture sharpness buttons, its note and the line count at the top of the page
function sharpSay() {
  $$('#sharp button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sharp === sharp)));
  const lines = $('#linesOut');
  if (lines) lines.textContent = `· ${simH} lines`;
  const note = $('#sharpNote');
  if (!note) return;
  note.textContent = sharp === 'auto' ? `Auto: ${simH} lines right now. It sharpens the picture while this computer keeps it smooth, and steps back if it starts to slow down.`
    : sharp === 'standard' ? `${SIM_H} lines, as Phosphor Loop has always drawn it. The lightest on the computer.`
    : sharp === 'high' ? `Up to 1080 lines, like HD video (${simH} at this size). Needs a capable computer, or the picture slows down.`
    : `As many lines as the screen shows, up to 4K (${simH} at this size). The sharpest, and the hardest on the computer.`;
}
$$('#sharp button').forEach((b) => b.addEventListener('click', () => {
  sharp = b.dataset.sharp;
  try { localStorage.setItem(SHARP_KEY, sharp); } catch (_) {}
  // Auto measures afresh from where it last settled
  Object.assign(sharpAuto, { ceiling: sharpAuto.top, t0: 0, fast: 0, slow: 0, justUp: false });
  clearTimeout(resimTimer);
  // Full may draw the screen itself bigger (up to 4K), so measure it again, straight away
  firstFit = true;
  fit();
  resim(fitAspect);
  showOSD('SHARPNESS', `${sharp.toUpperCase()} · ${simH} LINES`);
}));
// Auto: every 120 frames it looks at how smoothly they came. Two smooth stretches in a row (55 or more frames a
// second) step it up a level; two slow ones (under 45), or one right after a step up, step it back down, and it
// stays below that level for five minutes before trying again. A paused page (hidden panel, sleeping laptop)
// doesn't count. It never goes below Standard.
function sharpTick(now) {
  const A = sharpAuto;
  if (sharp !== 'auto' || capCfg() || document.hidden) { A.t0 = 0; return; }
  if (A.settle > 0) { A.settle--; A.t0 = 0; return; }
  if (!A.t0) { A.t0 = now; A.frames = 0; return; }
  if (++A.frames < 120) return;
  const sec = (now - A.t0) / 1000;
  A.t0 = 0;
  if (sec > 8) { A.fast = A.slow = 0; return; }
  const fps = A.frames / sec;
  if (A.ceiling < A.top && now - A.ceilingAt > 300000) A.ceiling = A.top;
  let to = A.level;
  if (fps >= 55) {
    A.slow = 0; A.justUp = false;
    if (++A.fast >= 2 && A.level < A.ceiling && SHARP_LEVELS[A.level] < Math.max(SIM_H, fitLines)) { to = A.level + 1; A.justUp = true; }
  } else if (fps < 45) {
    A.fast = 0;
    if ((A.justUp || ++A.slow >= 2) && A.level > 0) {
      to = A.level - 1;
      if (A.justUp) { A.ceiling = to; A.ceilingAt = now; }
    }
    A.justUp = false;
  } else { A.fast = A.slow = 0; A.justUp = false; }
  if (to === A.level) return;
  A.level = to; A.fast = A.slow = 0;
  try { localStorage.setItem(SHARP_AUTO_KEY, String(to)); } catch (_) {}
  resim(fitAspect);
}

let resimTimer = null, firstFit = true;
let outWin = null, outCanvas = null, outCtx = null;
function outputOpen() { return !!(outWin && !outWin.closed && outCanvas); }
function fit() {
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  const narrow = narrowMQ.matches && !fs;
  const sr = stage.getBoundingClientRect();
  const bz = getComputedStyle(bezel);
  const padX = parseFloat(bz.paddingLeft) + parseFloat(bz.paddingRight);
  const padY = parseFloat(bz.paddingTop) + parseFloat(bz.paddingBottom);
  // A size set by hand with the handles on the frame: while a handle is dragged it's the exact size; after that
  // it's the picture's shape, and the picture is as big as that shape can be in the space it has
  const own = !narrow && !fs && layout.cw && layout.ch;
  const sizing = own && rzDragging;
  // Spread out controls: the picture is as wide as its column and as tall as its shape makes it
  const spread = !narrow && !fs && !sizing && document.body.classList.contains('wide-ctl');
  const availW = Math.max(160, Math.floor(sizing ? Math.min(sr.width - padX, layout.cw) : sr.width - padX));
  const out = outputOpen();
  const want = out ? outWin.innerWidth / Math.max(1, outWin.innerHeight) : own && !sizing ? layout.cw / layout.ch
    : SHAPES[shape] || (spread ? 16 / 9 : 0);
  let availH = narrow
    ? Math.round(want ? Math.min(window.innerHeight * 0.62, availW / want) : window.innerHeight * 0.58)
    : sizing ? layout.ch
    : spread ? Math.floor(Math.min(availW / want, window.innerHeight * 0.8))
    : Math.max(120, Math.floor(sr.height - padY));
  let w = availW, h = availH;
  if (want) { w = Math.floor(Math.min(availW, availH * want)); h = Math.floor(w / want); }
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  if (spread) stage.style.height = (h + padY) + 'px'; else stage.style.removeProperty('height');
  let cw, ch, aspect;
  if (capCfg()) {
    cw = capCfg().width;
    ch = capCfg().height;
    aspect = cw / ch;
  } else if (out) {
    // Draw at the output window's own resolution; this screen shows a scaled preview of the same picture
    const ow = Math.max(1, outWin.innerWidth), oh = Math.max(1, outWin.innerHeight);
    const odpr = Math.min(outWin.devicePixelRatio || 1, 2, Math.sqrt(Math.max(6e6, maxPx()) / (ow * oh)));
    cw = Math.max(1, Math.round(ow * odpr)); ch = Math.max(1, Math.round(oh * odpr));
    if (outCanvas.width !== cw || outCanvas.height !== ch) { outCanvas.width = cw; outCanvas.height = ch; }
    aspect = ow / oh;
  } else {
    // Cap the drawing size so a big 4K full screen stays smooth
    const full = maxPx() > SHARP_MAX_PX;
    const dpr = Math.min(window.devicePixelRatio || 1, full ? 2 : 1.5, Math.sqrt((full ? FULL_MAX_PX : 4.5e6) / (w * h)));
    cw = Math.max(1, Math.round(w * dpr)); ch = Math.max(1, Math.round(h * dpr));
    aspect = w / h;
  }
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  fitLines = ch;
  clearTimeout(resimTimer);
  if (firstFit) { firstFit = false; resim(aspect); }
  else resimTimer = setTimeout(() => resim(aspect), 180);
}
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(stage);
window.addEventListener('resize', fit);
fit();

$$('#shape button').forEach((b) => b.addEventListener('click', () => {
  shape = b.dataset.shape;
  try { localStorage.setItem('phosphor-shape', shape); } catch (_) {}
  // A shape picked here takes over from one dragged with the handles on the frame
  if (layout.cw || layout.ch) { delete layout.cw; delete layout.ch; applyLayout(); saveLayout(); }
  syncShapeUI();
  fit();
}));
function syncShapeUI() { $$('#shape button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shape === shape))); }
syncShapeUI();

/* ================= sizing the picture and the controls by hand ================= */
// Drag the right edge, bottom edge or corner of the picture's frame to give it a shape (once let go, the picture
// fills all the room it has in that shape; see fit); drag the bar between the picture and the controls to make
// the controls wider or narrower. It's remembered in this browser. Double-click a handle to go back to the
// automatic size.
const deck = $('.deck'), deckSplit = $('#deckSplit');
var rzDragging = false;   // a handle on the picture's frame is being dragged (see fit)
function applyLayout() {
  for (const [key, v] of [['--side-w', layout.side], ['--mon-w', layout.mon]]) {
    if (v) deck.style.setProperty(key, v + 'px'); else deck.style.removeProperty(key);
  }
  stage.classList.toggle('sized', rzDragging && !narrowMQ.matches);
}
function saveLayout() { lsSet(LAYOUT_KEY, JSON.stringify(layout)); }
const wideOn = () => document.body.classList.contains('wide-ctl') && !narrowMQ.matches;
// Widths the controls can take: never so narrow they're unusable, never so wide the picture has no room
function setControlsWidth(px) {
  const W = deck.clientWidth;
  if (wideOn()) layout.mon = Math.round(clamp(W - px - 7, 220, Math.max(220, W - 420)));
  else layout.side = Math.round(clamp(px, 260, Math.max(260, W - 360)));
  applyLayout();
}
const controlsWidth = () => (wideOn() ? deck.clientWidth - (layout.mon || 320) - 7 : layout.side || 380);
function relayout() { fit(); window.dispatchEvent(new Event('resize')); }
let relayoutQueued = false;
function relayoutSoon() { if (!relayoutQueued) { relayoutQueued = true; requestAnimationFrame(() => { relayoutQueued = false; relayout(); }); } }
function dragWith(e, el, cursorClass, move, done) {
  e.preventDefault();
  el.setPointerCapture?.(e.pointerId);
  el.classList.add('dragging'); document.body.classList.add('resizing', cursorClass);
  const onMove = (ev) => { move(ev); relayoutSoon(); };
  const onUp = () => {
    el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
    el.classList.remove('dragging'); document.body.classList.remove('resizing', cursorClass);
    saveLayout(); relayout(); done?.();
  };
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
}
deckSplit.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const r = deck.getBoundingClientRect();
  // The controls are on the right in both layouts, so their width is from the bar to the right edge
  dragWith(e, deckSplit, 'cols', (ev) => setControlsWidth(r.right - ev.clientX - 3));
});
deckSplit.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  setControlsWidth(controlsWidth() + (e.key === 'ArrowLeft' ? 20 : -20)); saveLayout(); relayout();
});
deckSplit.addEventListener('dblclick', () => {
  if (wideOn()) delete layout.mon; else delete layout.side;
  applyLayout(); saveLayout(); relayout();
  toast('Controls back to their usual width.');
});
// The picture's own handles. Making it wider than there's room for takes the room from the controls.
for (const h of $$('.rz')) {
  const kind = h.dataset.rz;
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const c0 = canvas.getBoundingClientRect(), d0 = deck.getBoundingClientRect();
    const bz = getComputedStyle(bezel), padX = parseFloat(bz.paddingLeft) + parseFloat(bz.paddingRight);
    const mon = $('.monitor'), ms = getComputedStyle(mon), monPad = parseFloat(ms.paddingLeft) + parseFloat(ms.paddingRight);
    // A fixed shape (4:3 or 16:9) can't be stretched one way only, so sizing by hand fills the box you draw
    if (shape !== 'fill' && !outputOpen()) {
      shape = 'fill'; lsSet('phosphor-shape', shape); syncShapeUI();
      toast('The picture takes the shape you drag it to, then fills all the room it has in that shape.');
    }
    layout.cw = Math.round(c0.width); layout.ch = Math.round(c0.height);
    rzDragging = true; applyLayout();
    dragWith(e, h, `rz-${kind}-on`, (ev) => {
      if (kind.includes('r')) {
        const w = Math.max(160, Math.round(c0.width + ev.clientX - e.clientX));
        // Room the picture's column has for it at most, leaving the controls at least their narrowest
        const room = d0.width - 7 - (wideOn() ? 420 : 260) - monPad - padX;
        layout.cw = Math.min(w, Math.max(160, Math.round(room)));
        const need = layout.cw + padX + monPad;
        if (wideOn()) { if (need > (layout.mon || 320)) { layout.mon = Math.round(need); } }
        else if (d0.width - 7 - (layout.side || 380) < need) layout.side = Math.round(d0.width - 7 - need);
      }
      if (kind.includes('b')) layout.ch = Math.max(90, Math.round(c0.height + ev.clientY - e.clientY));
      applyLayout();
    }, () => { rzDragging = false; applyLayout(); relayout(); });
  });
  h.addEventListener('dblclick', () => {
    delete layout.cw; delete layout.ch; applyLayout(); saveLayout(); relayout();
    toast('The picture fills the space again.');
  });
}
applyLayout();
narrowMQ.addEventListener?.('change', () => { applyLayout(); fit(); });

/* ================= output window ================= */
// Opens the picture on its own for a projector or second screen. Each frame is copied into it
// at that window's resolution, so the controls can stay on this screen.
const outBtn = $('#outBtn');
// "Spread out controls": the picture here shrinks to a small preview and the controls get the rest of the
// screen. Works with or without the output window, and is remembered in this browser.
/* ================= color grading ================= */
// The finished picture, after every loop is mixed: tone (exposure, contrast, midtones) and color (saturation, hue,
// red/green/blue, sepia). It's drawn in the display pass only, so it never feeds back into the loops. Autopilot
// leaves it alone; presets keep it and Neutral puts it back to normal. Slider units: exposure in tenths of a stop,
// midtones (gamma) and the rest in hundredths, hue in degrees, sepia in percent.
const GRADE_KEY = 'phosphor-grade-v1';
const GRADE_DEF = { gExposure: 0, gContrast: 100, gGamma: 100, gSat: 100, gHue: 0, gRed: 100, gGreen: 100, gBlue: 100, gSepia: 0 };
const grade = { ...GRADE_DEF };
// Each loop's own grading while the sequencer plays (null: none), drawn when the loops are mixed (see FS_COMPOSITE)
const loopGrade = { A: null, B: null, C: null, D: null };
const gradeEls = {};
for (const k of Object.keys(GRADE_DEF)) gradeEls[k] = { el: $('#' + k), out: $('#' + k + 'Out') };
function gradeText(k, v) {
  switch (k) {
    case 'gExposure': return v === 0 ? 'NORMAL' : `${v > 0 ? '+' : '−'}${(Math.abs(v) / 10).toFixed(1)}`;
    case 'gGamma': return v === 100 ? 'NORMAL' : (v / 100).toFixed(2);
    case 'gHue': return v === 0 ? 'OFF' : `${v > 0 ? '+' : '−'}${Math.abs(v)}°`;
    case 'gSepia': return v === 0 ? 'OFF' : `${v}%`;
    default: return v === 100 ? 'NORMAL' : `${v}%`;
  }
}
// Any saved or loaded grading, made safe: missing or broken values are normal
function cleanGrade(g) {
  const out = { ...GRADE_DEF };
  if (!g || typeof g !== 'object') return out;
  for (const k of Object.keys(GRADE_DEF)) {
    const { el } = gradeEls[k];
    if (Number.isFinite(g[k])) out[k] = clamp(Math.round(g[k]), +el.min, +el.max);
  }
  out.gInside = !!g.gInside;
  return out;
}
function syncGradeUI() {
  for (const [k, { el, out }] of Object.entries(gradeEls)) { el.value = grade[k]; fillTrack(el); out.textContent = gradeText(k, grade[k]); }
  $$('#gradeWhere button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.gin === '1') === !!grade.gInside)));
}
function saveGrade() { try { localStorage.setItem(GRADE_KEY, JSON.stringify(grade)); } catch (_) {} }
function setGrade(g) { Object.assign(grade, cleanGrade(g)); syncGradeUI(); saveGrade(); }
for (const [k, { el, out }] of Object.entries(gradeEls)) {
  el.addEventListener('input', () => { grade[k] = +el.value; fillTrack(el); out.textContent = gradeText(k, grade[k]); saveGrade(); });
  el.addEventListener('dblclick', () => setGrade({ ...grade, [k]: GRADE_DEF[k] }));
}
$('#gradeReset').addEventListener('click', () => setGrade(GRADE_DEF));
$$('#gradeWhere button').forEach((b) => b.addEventListener('click', () => {
  setGrade({ ...grade, gInside: b.dataset.gin === '1' });
  showOSD('COLOR GRADING', grade.gInside ? 'WITHIN LOOPS' : 'FINAL PASS');
}));
{ let saved = null; try { saved = JSON.parse(localStorage.getItem(GRADE_KEY) || 'null'); } catch (_) {} setGrade(saved); }
const gradeOn = () => Object.keys(GRADE_DEF).some((k) => grade[k] !== GRADE_DEF[k]);
function setGradeUniforms() {
  set1f(dispProg, 'uGradeOn', gradeOn() && !grade.gInside ? 1 : 0);
  set4f(dispProg, 'uGradeTone', grade.gExposure / 10, grade.gContrast / 100, grade.gGamma / 100, grade.gSat / 100);
  set2f(dispProg, 'uGradeColor', grade.gHue * Math.PI / 180, grade.gSepia / 100);
  set3f(dispProg, 'uGradeRGB', grade.gRed / 100, grade.gGreen / 100, grade.gBlue / 100);
}
/* ================= 3D lighting ================= */
// The finished picture's brightness read as height and lit like glossy plastic (reliefShade in shaders.js), drawn
// in the display pass only. Each input can have its own under Adjust the picture (rDepth and the rest in adj),
// lit by the same light, whose direction is set here and can circle. Autopilot leaves it alone; presets keep it
// and Neutral turns it off.
const RELIEF_KEY = 'phosphor-relief-v1';
const RELIEF_DEF = { rDepth: 0, rSmooth: 30, rShine: 60, rLight: 135, rSpin: 0 };
const relief = { ...RELIEF_DEF };
const reliefEls = {};
for (const k of Object.keys(RELIEF_DEF)) reliefEls[k] = { el: $('#' + k), out: $('#' + k + 'Out') };
const LIGHT_SIDES = ['the right', 'top right', 'the top', 'top left', 'the left', 'bottom left', 'the bottom', 'bottom right'];
function reliefText(k, v) {
  switch (k) {
    case 'rDepth': return v === 0 ? 'OFF' : String(v);
    case 'rShine': return v === 0 ? 'MATTE' : String(v);
    case 'rLight': return LIGHT_SIDES[Math.round(v / 45) % 8].toUpperCase();
    case 'rSpin': return v === 0 ? 'STILL' : String(v);
    default: return String(v);
  }
}
function cleanRelief(r) {
  const out = { ...RELIEF_DEF };
  if (!r || typeof r !== 'object') return out;
  for (const k of Object.keys(RELIEF_DEF)) {
    const { el } = reliefEls[k];
    if (Number.isFinite(r[k])) out[k] = clamp(Math.round(r[k]), +el.min, +el.max);
  }
  return out;
}
function syncReliefUI() {
  for (const [k, { el, out }] of Object.entries(reliefEls)) { el.value = relief[k]; fillTrack(el); out.textContent = reliefText(k, relief[k]); }
}
function saveRelief() { try { localStorage.setItem(RELIEF_KEY, JSON.stringify(relief)); } catch (_) {} }
function setRelief(r) { Object.assign(relief, cleanRelief(r)); syncReliefUI(); saveRelief(); }
for (const [k, { el, out }] of Object.entries(reliefEls)) {
  el.addEventListener('input', () => { relief[k] = +el.value; fillTrack(el); out.textContent = reliefText(k, relief[k]); saveRelief(); });
  el.addEventListener('dblclick', () => setRelief({ ...relief, [k]: RELIEF_DEF[k] }));
}
$('#reliefReset').addEventListener('click', () => setRelief(RELIEF_DEF));
{ let saved = null; try { saved = JSON.parse(localStorage.getItem(RELIEF_KEY) || 'null'); } catch (_) {} setRelief(saved); }
// Which way the light comes from, 40° above the picture: worked out once per frame for the display pass and used
// by the next frame's loops too. Circling adds up a turn of its own, so changing its speed never makes it jump.
const reliefL = [0, 0, 1];
let reliefTurn = 0, reliefLast = 0;
function setReliefUniforms(now) {
  const dt = reliefLast ? Math.min((now - reliefLast) / 1000, 0.25) : 0;
  reliefLast = now;
  reliefTurn = (reliefTurn + dt * (relief.rSpin / 100) ** 2 * Math.PI / 2) % (2 * Math.PI);
  const a = relief.rLight * Math.PI / 180 + reliefTurn, e = 40 * Math.PI / 180;
  reliefL[0] = Math.cos(a) * Math.cos(e); reliefL[1] = Math.sin(a) * Math.cos(e); reliefL[2] = Math.sin(e);
  set3f(dispProg, 'uRelief', relief.rDepth / 100, 0.004 + 0.046 * relief.rSmooth / 100, relief.rShine / 100);
  set3f(dispProg, 'uReliefL', reliefL[0], reliefL[1], reliefL[2]);
}
window.__plRelief = { relief, setRelief, adj };
/* ================= color filters ================= */
// Posterize (each loop's own) and Color grading can each work on screen, over the finished picture, or inside the
// loop, on what the loop keeps, so it feeds on the filtered picture every frame. Inside, the grading goes about a
// tenth of the way each sixtieth of a second (f: how many sixtieths this frame is), so it builds up at the same
// pace at any frame rate instead of piling up at once.
function setLoopGradeUniforms(f) {
  const on = grade.gInside && gradeOn();
  set1f(fbProg, 'uGradeK', on ? 1 - Math.pow(0.9, f) : 0);
  if (!on) return;
  set4f(fbProg, 'uGradeTone', grade.gExposure / 10, grade.gContrast / 100, Math.max(0.05, grade.gGamma / 100), grade.gSat / 100);
  set2f(fbProg, 'uGradeColor', grade.gHue * Math.PI / 180, grade.gSepia / 100);
  set3f(fbProg, 'uGradeRGB', grade.gRed / 100, grade.gGreen / 100, grade.gBlue / 100);
}
// For tests/: the mirror change under way on a loop (see "mirror transitions")
window.__plMirror = { state: (k) => loops[k].mx };
window.__plGrade = { grade, setGrade, snapshot: () => snapshot(), loadPreset: (data) => loadPreset({ id: '', name: '', data }, true) };

const wideBtn = $('#wideBtn'), WIDE_KEY = 'phosphor-wide-controls';
let wideCtl = (() => { try { return localStorage.getItem(WIDE_KEY) === '1'; } catch (_) { return false; } })();
function syncWide() {
  const on = wideCtl;
  wideBtn.setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('wide-ctl', on);
  wideLayout();
  fit();
}
wideBtn.addEventListener('click', () => {
  wideCtl = !wideCtl;
  try { localStorage.setItem(WIDE_KEY, wideCtl ? '1' : '0'); } catch (_) {}
  syncWide();
  toast(wideCtl ? 'Controls spread out. Press Spread out controls again for the big picture.' : 'Back to the big picture.');
});

/* ================= Spread out controls: a column per loop ================= */
// With Spread out controls on, the first column holds Loops and, below it, React to sound and everything after it.
// Each loop then gets a column of its own with its Inputs and Effects, so all the loops can be set side by side. If
// the screen is too narrow for a column per loop, two loops share a column, one above the other.
// The loop settings with the tabs stay on the page, hidden: each loop's column is a copy of them, kept up to date
// for that loop, and anything done in a copy (a click, a slider, a typed word) is passed on to the real one with
// that column's loop chosen, so every control behaves exactly as it does in the sidebar.
var wideCols = null, wideReady = false, mirroring = false, mirrorTimer = 0;
const panelIn = $('.panel-in');
const panelOrder = [...panelIn.children];
const WIDE_COL_MIN = 330, WIDE_GAP = 28;
const MIRROR_SKIP = ['id', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby'];
function mirrorStrip(root) {
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el.id) { el.dataset.mid = el.id; el.removeAttribute('id'); }
    for (const a of MIRROR_SKIP) if (el.hasAttribute(a)) el.removeAttribute(a);
  }
  return root;
}
const mirrorClone = (el) => (el.nodeType === 1 ? mirrorStrip(el.cloneNode(true)) : el.cloneNode(true));
// Where an element sits under root (child numbers, top down), and the element at that spot under another root
function mirrorPath(root, el) {
  const path = [];
  while (el && el !== root) { const p = el.parentElement; if (!p) return null; path.push(Array.prototype.indexOf.call(p.children, el)); el = p; }
  return el === root ? path.reverse() : null;
}
function atPath(root, path) { let el = root; for (const i of path) { el = el && el.children[i]; } return el || null; }
function mirrorAttrs(r, m) {
  for (const { name, value } of r.attributes) {
    if (MIRROR_SKIP.includes(name)) continue;
    if (m.getAttribute(name) !== value) m.setAttribute(name, value);
  }
  for (const { name } of [...m.attributes]) {
    if (name === 'data-mid' || MIRROR_SKIP.includes(name)) continue;
    if (!r.hasAttribute(name)) m.removeAttribute(name);
  }
}
// Brings copy m in line with the real element r: what shows, what's pressed, the words and the slider positions.
// A part whose make-up has changed (new buttons, say) is copied afresh, unless it's being used right now.
function mirrorCopy(r, m) {
  const busy = m.contains(document.activeElement);
  if (r.children.length !== m.children.length || [...r.children].some((c, i) => c.tagName !== m.children[i].tagName)) {
    if (busy) return;
    m.replaceChildren(...[...r.childNodes].map(mirrorClone));
  } else if (r.children.length === 0) {
    if (m.textContent !== r.textContent) m.textContent = r.textContent;
  } else if (r.childNodes.length === m.childNodes.length) {
    r.childNodes.forEach((n, i) => { const o = m.childNodes[i]; if (n.nodeType === 3 && o.nodeType === 3 && o.data !== n.data) o.data = n.data; });
  }
  for (let i = 0; i < r.children.length; i++) {
    const rc = r.children[i], mc = m.children[i];
    mirrorAttrs(rc, mc);
    mirrorCopy(rc, mc);
  }
  if ((r.tagName === 'INPUT' || r.tagName === 'SELECT' || r.tagName === 'TEXTAREA') && m !== document.activeElement) {
    if (m.value !== r.value) m.value = r.value;
    if (r.type === 'checkbox' || r.type === 'radio') m.checked = r.checked;
  }
  if (r.tagName === 'DETAILS') m.open = r.open;
  if (r.tagName === 'CANVAS' && r.width > 0 && r.height > 0) {
    try { const g = m.getContext('2d'); g.clearRect(0, 0, m.width, m.height); g.drawImage(r, 0, 0, m.width, m.height); } catch (_) {}
  }
}
// Copies every loop's column from the real settings, each shown for its own loop in turn
function mirrorRefresh() {
  mirrorTimer = 0;
  if (!wideCols || mirroring) return;
  const keep = edit;
  mirroring = true;
  try {
    for (const k of activeKeys()) {
      const m = wideCols.mirrors[k];
      if (!m) continue;
      if (edit !== k) setEdit(k);
      mirrorCopy(editor, m);
      m.dataset.loop = k;
      m.parentElement.classList.toggle('editing', k === keep);
    }
  } finally {
    if (edit !== keep) setEdit(keep);
    mirroring = false;
  }
}
function mirrorRefreshSoon() {
  if (!wideCols || mirroring || mirrorTimer) return;
  mirrorTimer = requestAnimationFrame(mirrorRefresh);
}
// Something done in loop k's column: done to the real control instead, with loop k chosen
function mirrorForward(e) {
  const m = e.currentTarget, k = m.dataset.loop;
  if (!loopOn(k) || mirroring) return;
  const t = e.target;
  if (e.type === 'keydown') {
    if (t.matches && t.matches('input[type="text"]') && (e.key === 'Enter' || e.key === 'Escape')) t.blur();
    return;
  }
  // A label's click is only passed on through the control it belongs to
  if (e.type === 'click' && t.closest && t.closest('label') && !t.closest('button, input, select, a')) return;
  const path = mirrorPath(m, t);
  const real = path && atPath(editor, path);
  if (!real) { mirrorRefreshSoon(); return; }
  if (edit !== k) setEdit(k);
  if (e.type === 'input' || e.type === 'change') {
    if ('value' in t && real.value !== t.value) real.value = t.value;
    if (t.type === 'checkbox' || t.type === 'radio') real.checked = t.checked;
    real.dispatchEvent(new Event(e.type, { bubbles: true }));
  } else {
    if (e.type === 'contextmenu') e.preventDefault();
    real.dispatchEvent(new MouseEvent(e.type, { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
      button: e.button, buttons: e.buttons, detail: e.detail, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey }));
  }
  for (const w of Object.values(wideCols ? wideCols.mirrors : {})) w.parentElement.classList.toggle('editing', w.dataset.loop === edit);
  mirrorRefreshSoon();
}
function makeMirror(k) {
  const wrap = document.createElement('section');
  wrap.className = 'loop-col';
  wrap.setAttribute('aria-label', `Loop ${k} settings`);
  const head = document.createElement('div');
  head.className = 'loop-col-head';
  head.innerHTML = `<span class="tag t-${k.toLowerCase()}">${k}</span><span>Loop ${k}</span>`;
  const m = mirrorStrip(editor.cloneNode(true));
  m.classList.add('mirror');
  m.dataset.loop = k;
  for (const type of ['click', 'dblclick', 'contextmenu', 'input', 'change', 'keydown']) m.addEventListener(type, mirrorForward);
  wrap.append(head, m);
  return m;
}
function wideBuild() {
  const root = document.createElement('div');
  root.className = 'wide-cols';
  const first = document.createElement('div');
  first.className = 'wide-col first';
  for (const el of panelOrder) first.appendChild(el);
  root.appendChild(first);
  panelIn.appendChild(root);
  wideCols = { root, first, cols: [], mirrors: {} };
}
function wideTeardown() {
  if (mirrorTimer) cancelAnimationFrame(mirrorTimer);
  mirrorTimer = 0;
  for (const el of panelOrder) panelIn.appendChild(el);
  wideCols.root.remove();
  wideCols = null;
}
// A column per loop when they fit beside the first one, otherwise two loops to a column
function wideArrange() {
  const W = wideCols, n = loopCount;
  const width = panelIn.clientWidth;
  const fits = (c) => c * WIDE_COL_MIN + (c - 1) * WIDE_GAP <= width;
  const per = fits(1 + n) ? 1 : 2;
  const nCols = Math.ceil(n / per);
  for (const k of KEYS) if (!loopOn(k) && W.mirrors[k]) { W.mirrors[k].parentElement.remove(); delete W.mirrors[k]; }
  for (const k of activeKeys()) if (!W.mirrors[k]) W.mirrors[k] = makeMirror(k);
  while (W.cols.length > nCols) W.cols.pop().remove();
  while (W.cols.length < nCols) { const c = document.createElement('div'); c.className = 'wide-col loops'; W.root.appendChild(c); W.cols.push(c); }
  activeKeys().forEach((k, i) => { const c = W.cols[Math.floor(i / per)], wrap = W.mirrors[k].parentElement; if (wrap.parentElement !== c || c.children[i % per] !== wrap) c.appendChild(wrap); });
  W.root.style.gridTemplateColumns = `repeat(${1 + nCols}, minmax(0, 1fr))`;
  W.root.dataset.per = String(per);
}
function wideLayout() {
  if (!wideReady) return;
  const on = wideCtl && matchMedia('(min-width: 901px)').matches;
  if (!on) { if (wideCols) wideTeardown(); return; }
  if (!wideCols) wideBuild();
  wideArrange();
  mirrorRefresh();
}
window.addEventListener('resize', () => { if (wideCols || wideCtl) wideLayout(); });
// Autopilot and the music change settings without anyone touching the columns, so they're looked over now and then
setInterval(() => { if (wideCols && !document.hidden) mirrorRefreshSoon(); }, 700);
wideReady = true;
// Phones and tablets have no second screen, but a touchscreen computer with a projector does
// In the Android app the button shows while a projector or TV is plugged in (or cast to)
if (APP) outBtn.hidden = !appInfo.display;
else if (inArtifact || (window.matchMedia('(hover: none)').matches && !(window.screen && window.screen.isExtended))) outBtn.hidden = true;
const OUTPUT_HTML = window.PhosphorOutputHTML;
// Which screen "Fill my other screen" should use: one that isn't showing the controls. If the output window
// is already on such a screen, that's the one, so a window dragged to the projector fills the projector
// instead of jumping back over the controls.
function pictureScreen(sd, here) {
  const list = sd.screens || [];
  const holds = (s, x, y) => x >= s.left && x < s.left + s.width && y >= s.top && y < s.top + s.height;
  // Find the controls by the middle of this window, or failing that (say it's minimized) by its screen
  let ctl = list.filter((s) => holds(s, window.screenX + window.outerWidth / 2, window.screenY + window.outerHeight / 2));
  if (ctl.length !== 1 && window.screen && typeof window.screen.availLeft === 'number') {
    const sc = window.screen;
    ctl = list.filter((s) => holds(s, sc.availLeft + sc.availWidth / 2, sc.availTop + sc.availHeight / 2));
  }
  if (ctl.length === 1) {
    const free = list.filter((s) => s !== ctl[0]);
    if (free.includes(here)) return here;
    if (free.length) return free[0];
    return here;
  }
  return list.find((s) => s !== here) || here;
}
function openOutput() {
  let w = null;
  try { w = window.open('', 'phosphorOutput', 'popup,width=960,height=540'); } catch (_) {}
  if (!w) {
    toast(APP ? 'Plug in a projector or TV first (or cast the screen to it), then press Output window again.'
      : 'The browser blocked the new window. Allow pop-ups for this page, then press Output window again.');
    return;
  }
  let doc;
  try { doc = w.document; doc.open(); doc.write(OUTPUT_HTML); doc.close(); }
  catch (_) { try { w.close(); } catch (__) {} toast('This browser won’t let the page draw into a second window.'); return; }
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) { const l = doc.createElement('link'); l.rel = 'icon'; l.href = icon.href; doc.head.appendChild(l); }
  outWin = w;
  outCanvas = doc.getElementById('out');
  outCtx = outCanvas.getContext('2d', { alpha: false });
  const hint = doc.getElementById('hint');
  if (APP) hint.classList.add('gone');   // the app already put this window on the other screen
  const toggleOutFS = () => {
    try {
      if (doc.fullscreenElement) doc.exitFullscreen();
      else { const r = doc.documentElement.requestFullscreen(); if (r && r.catch) r.catch(() => {}); }
    } catch (_) {}
  };
  outCanvas.addEventListener('dblclick', toggleOutFS);
  w.addEventListener('keydown', (e) => {
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { toggleOutFS(); e.preventDefault(); }
    else onKey(e);
  });
  w.addEventListener('keyup', (e) => ribKey(e, false));
  doc.addEventListener('fullscreenchange', () => {
    hint.classList.toggle('gone', !!doc.fullscreenElement);
    doc.body.classList.toggle('fs', !!doc.fullscreenElement);
    setTimeout(fit, 60);
  });
  doc.getElementById('fsx').addEventListener('click', () => { if (doc.fullscreenElement) toggleOutFS(); });
  outCanvas.addEventListener('pointerdown', (e) => startDraw(e, outCanvas));
  outCanvas.addEventListener('pointermove', (e) => moveDraw(e, outCanvas));
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => outCanvas.addEventListener(ev, endDraw));
  // The help box, the Exit button and the pointer fade when the mouse rests and come back when it moves,
  // so the help box never sits on the picture in a window that isn't full screen
  let idle = null;
  const fsx = doc.getElementById('fsx');
  const wake = (ms) => {
    doc.body.classList.remove('idle');
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (fsx.matches(':hover') || hint.matches(':hover')) wake();
      else doc.body.classList.add('idle');
    }, typeof ms === 'number' ? ms : 3000);
  };
  doc.addEventListener('pointermove', () => wake());
  doc.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') wake(); });
  wake(8000);   // a longer first look, so the help box gets noticed
  // With two or more screens, Chrome can fill the other one directly
  const other = doc.getElementById('other');
  const canFill = !!(w.screen && w.screen.isExtended && 'getScreenDetails' in w);
  if (canFill) {
    other.hidden = false;
    other.addEventListener('click', async () => {
      try {
        const sd = await w.getScreenDetails();
        await doc.documentElement.requestFullscreen({ screen: pictureScreen(sd, sd.currentScreen) });
      } catch (_) {
        doc.getElementById('hintText').textContent = 'Allow the browser to use your other screens, then press the button again. Or drag this window over and double-click it.';
      }
    });
  }
  w.addEventListener('resize', fit);
  outBtn.textContent = 'Close output window';
  outBtn.setAttribute('aria-pressed', 'true');
  $$('#shape button').forEach((b) => { b.disabled = true; });
  $('#shapeNote').hidden = false;
  syncWide();
  if (APP) { toast('The picture is on your other screen. The controls stay here.'); return; }
  toast(canFill
    ? 'Output window open. Press Fill my other screen in it, or drag it to your projector and double-click it.'
    : 'Output window open. Drag it to your projector or second screen, then double-click it to fill that screen.');
}
function closeOutput(alreadyClosed) {
  if (outWin && !alreadyClosed) { try { outWin.close(); } catch (_) {} }
  outWin = null; outCanvas = null; outCtx = null;
  outBtn.textContent = 'Output window';
  outBtn.setAttribute('aria-pressed', 'false');
  $$('#shape button').forEach((b) => { b.disabled = false; });
  $('#shapeNote').hidden = true;
  syncWide();
}
outBtn.addEventListener('click', () => (outputOpen() ? closeOutput() : openOutput()));
// Android app: plugging in a projector or TV puts the picture there by itself; unplugging brings it back
onApp('display', (d) => {
  appInfo.display = !!d.connected;
  outBtn.hidden = !appInfo.display;
  if (!appInfo.display) { if (outWin) closeOutput(); return; }
  setTimeout(() => { if (appInfo.display && !outputOpen()) openOutput(); }, 800);
});
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  fail('The graphics card reset the screen. Reload the page to start it again.');
});
window.addEventListener('pagehide', () => {
  if (outWin) { try { outWin.close(); } catch (_) {} }
  stopSound();
  cam.detach(); scr.detach();
  if (sig && phonePeer) sig.send('LEAVE', phonePeer, {});
});

/* ================= keep the screen awake ================= */
function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } }
// While Phosphor Loop is open and showing, the screen never dims or goes to sleep. The browser lets go of
// this whenever the tab is hidden, so it is asked for again each time the page comes back.
let wakeLock = null;
async function keepAwake() {
  if (document.hidden || !('wakeLock' in navigator) || (wakeLock && !wakeLock.released)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
// Some browsers only allow it after the first click or tap on the page
['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, keepAwake, { passive: true }));
keepAwake();

function showStart() {
  if (inArtifact) return;
  // The Android app puts the picture on a plugged-in projector or TV straight away
  if (APP && appInfo.display) setTimeout(() => { if (appInfo.display && !outputOpen()) openOutput(); }, 1200);
  clipsStart();
  syncWide();
}

/* ================= loop ================= */
const tcEl = $('#tc');
let tcLast = -1;
const t0 = performance.now();
function updateTC(now) {
  const frames = Math.floor((now - t0) / 40); // 25 frames per second, PAL timecode
  if (frames === tcLast) return;
  tcLast = frames;
  const ff = frames % 25, s = Math.floor(frames / 25) % 60, m = Math.floor(frames / 1500) % 60, h = Math.floor(frames / 90000) % 24;
  tcEl.textContent = [h, m, s, ff].map((n) => String(n).padStart(2, '0')).join(':');
}

function resolveSrc(src, motion) {
  const live = LIVE_SRC[src];
  if (live && live.frames < (motion ? 2 : 1)) return SRC_ID.none;
  return SRC_ID[src] ?? SRC_ID.none;
}

let last = performance.now();
let simT = 0;

// The Wave input's curve, worked out on the CPU once per loop per frame instead of per pixel
const wavePts = new Float32Array(81 * 2), waveBoxes = new Float32Array(8 * 4);
function computeWave(t, form) {
  const A = Math.floor(form + 0.5), B = A - 1, R = 0.27, ph = t * 0.5, ph2 = t * 0.17;
  for (let i = 0; i <= 80; i++) {
    const u = i / 80 * Math.PI * 2;
    wavePts[i * 2] = Math.sin(A * u + ph) * 1.2 * R;
    wavePts[i * 2 + 1] = Math.sin(B * u + ph2) * R;
  }
  for (let c = 0; c < 8; c++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = c * 10; i <= c * 10 + 10; i++) {
      const x = wavePts[i * 2], y = wavePts[i * 2 + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    waveBoxes[c * 4] = (x0 + x1) / 2;
    waveBoxes[c * 4 + 1] = (y0 + y1) / 2;
    waveBoxes[c * 4 + 2] = Math.hypot(x1 - x0, y1 - y0) / 2;
  }
}
const FLOW_K = 0.0016;   // how far Flow at 100 carries the picture in one frame
const LOOK_K = 0.05;     // how far Look-up at 100 lets each spot read from where its color points, in one frame
const CHROMA_K = 0.005;  // how far Color chase at 100 pushes each color in one frame
const MELT_K = 0.02;     // how far Melt at 100 lets the picture push itself in one frame
const PUSH_K = 0.02;     // how far Pushed by the other loop at 100 moves this loop in one frame
const DYE_K = 0.16;      // how far Dyed by the other loop at 100 turns colors in one frame, where the other loop is brightest
const GROW_K = 0.06;     // how much brighter or darker Grow at 100 can make a spot in one frame
const GROW_R = [2.6, 5, 9];   // Grow's ring for Fine, Medium and Big patterns, in pixels of the 576-line picture

/* ================= time warp ================= */
// While a loop uses Time warp, its recent frames are kept on the graphics card in a stack (TW_RATE a second,
// at TW_SCALE of full size), and its picture is redrawn from them so each part shows a different moment
// (FS_TIMEWARP). What you see, the other loop, recordings and the output window all get the warped picture;
// the loop itself keeps feeding back its own plain frames, so its trails behave as always. On a phone the stack
// is let go a minute after Time warp is turned off, to save memory; a computer keeps it, so turning Time warp
// on again (or Autopilot bringing it in) never makes the picture hitch while the memory is found.
function twMake() {
  // At a sharper picture the stack is kept smaller than TW_SCALE, so it never needs more than 64 MB (32 on phones)
  const twK = Math.min(TW_SCALE, Math.sqrt((twLowMem ? 32 : 64) * 1048576 / (4 * TW_LAYERS * simW * simH)));
  const w = Math.max(16, Math.round(simW * twK)), h = Math.max(16, Math.round(simH * twK));
  for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) {}
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, TW_LAYERS);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (gl.getError() === gl.OUT_OF_MEMORY) { gl.deleteTexture(tex); return null; }
  const warp = [makeTarget(), makeTarget()];
  gl.clearColor(0, 0, 0, 1);
  for (const t of warp) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clear(gl.COLOR_BUFFER_BIT); }
  return { tex, fbo: gl.createFramebuffer(), w, h, sw: simW, sh: simH, head: -1, filled: 0, ago: 0, acc: 0, idle: 0, warp, wf: 0, live: false };
}
function twDrop(L) {
  const tw = L.tw;
  if (!tw) return;
  gl.deleteTexture(tw.tex);
  gl.deleteFramebuffer(tw.fbo);
  tw.warp.forEach(dropTarget);
  L.tw = null;
}
// Clear and fresh looks start the stack over, so nothing from before shows up in the warped parts
function twForget(L) { if (L.tw) { L.tw.filled = 0; L.tw.head = -1; } }
let twWarned = false;
function twStep(k, dt) {
  const L = loops[k];
  const on = !!twProg && (L.tgt.time > 0 || L.cur.time > 0.3);
  if (L.tw && (L.tw.sw !== simW || L.tw.sh !== simH)) twDrop(L);
  if (!on) {
    if (L.tw) { L.tw.live = false; L.tw.idle += dt; if (twLowMem && L.tw.idle > 60) twDrop(L); }
    return;
  }
  if (!L.tw) {
    L.tw = twMake();
    if (!L.tw) {
      if (!twWarned) { twWarned = true; toast('Time warp needs more graphics memory than this device has free right now.'); }
      return;
    }
  }
  const tw = L.tw, front = L.rt[L.front].tex;
  tw.idle = 0;
  tw.ago += dt;
  tw.acc += dt;
  // Keep this frame each time a thirtieth of a second has gone by. A computer drawing fewer than 30 frames a
  // second keeps some frames twice, so the far edge still reaches as far back as the slider says.
  let keep = tw.filled === 0 ? 1 : Math.min(4, Math.floor(tw.acc * TW_RATE));
  if (keep > 0) {
    tw.acc = tw.filled === 0 ? 0 : Math.min(tw.acc - keep / TW_RATE, 1 / TW_RATE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tw.fbo);
    gl.viewport(0, 0, tw.w, tw.h);
    gl.useProgram(copyProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, front);
    set2f(copyProg, 'uSim', tw.w, tw.h);
    for (; keep > 0; keep--) {
      tw.head = (tw.head + 1) % TW_LAYERS;
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tw.tex, 0, tw.head);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      tw.filled = Math.min(TW_LAYERS, tw.filled + 1);
    }
    tw.ago = 0;
  }
  const dst = tw.warp[1 - tw.wf];
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, simW, simH);
  gl.useProgram(twProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, front);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tw.tex);
  set2f(twProg, 'uSim', simW, simH);
  set1f(twProg, 'uHead', tw.head);
  set1f(twProg, 'uFilled', tw.filled);
  set1f(twProg, 'uLayers', TW_LAYERS);
  set1f(twProg, 'uSince', tw.ago);
  set1f(twProg, 'uRate', TW_RATE);
  set1f(twProg, 'uSpan', twSpan(L.cur.time));
  set1f(twProg, 'uShape', L.tgt.timeShape || 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  tw.wf = 1 - tw.wf;
  tw.live = true;
}
// What a loop shows (and what the other loop sees of it): its time-warped picture while Time warp is on
function shownTex(k) { const L = loops[k]; return L.tw && L.tw.live ? L.tw.warp[L.tw.wf].tex : L.rt[L.front].tex; }
// What loop k gives the mix: its picture, or that picture after its final pass (see finalPass)
function mixTex(k) { const pz = loops[k].pz; return pz && pz.live ? pz.rt[pz.f].tex : shownTex(k); }
// The effects that can work in the final pass instead of within the loop, each with the switch that says so.
// Posterize starts in the final pass; the others start within the loop, where they've always been.
const FINAL_FX = { poster: 'posterIn', mirror: 'mirrorFinal', warp: 'warpFinal', split: 'splitFinal', chroma: 'chromaFinal' };
const isFinal = (t, fx) => (fx === 'poster' ? !t.posterIn : !!t[FINAL_FX[fx]]);
// Loop k's final pass (FS_FINAL): its picture with the effects set to Final Pass laid over it once, drawn into a
// pair of pictures of its own, taking turns, so Posterize can see the steps it drew last frame. Made when first
// needed, at the current sharpness, and let go when no effect is in the final pass.
function finalPass(k) {
  const L = loops[k], t = L.tgt, c = L.cur;
  const amt = (fx, v) => (isFinal(t, fx) ? v : 0);
  const steps = amt('poster', c.poster > 0.5 ? posterSteps(c.poster) : 0);
  const mirror = t.mirrorFinal && mirrorAny(k);
  const split = amt('split', clamp(c.split, 0, 100) / 100 * 0.06);
  const warp = amt('warp', clamp(L.warpNow ?? c.warp, 0, 100) / 100 * 0.05);
  const chroma = amt('chroma', Math.pow(clamp(c.chroma, 0, 100) / 100, 1.2) * 0.035);
  const on = L.rt && loopOn(k) && (steps > 0 || mirror || split > 0.0005 || warp > 0.0005 || chroma > 0.0005);
  if (L.pz && (!on || L.pz.w !== simW || L.pz.h !== simH)) { L.pz.rt.forEach(dropTarget); L.pz = null; }
  if (!on) return;
  if (!L.pz) L.pz = { rt: [makeTarget(), makeTarget()], f: 0, w: simW, h: simH, stepped: false };
  const pz = L.pz, last = pz.rt[pz.f];
  pz.f = 1 - pz.f;
  gl.bindFramebuffer(gl.FRAMEBUFFER, pz.rt[pz.f].fbo);
  gl.viewport(0, 0, simW, simH);
  gl.useProgram(finalProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shownTex(k));
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, last.tex);
  set2f(finalProg, 'uSim', simW, simH);
  set1f(finalProg, 'uPxK', simH / SIM_H);
  set1f(finalProg, 'uTime', simT + (11.0 * LOOP_OFF[k]));
  mirrorUniforms(finalProg, k, mirror);
  set1f(finalProg, 'uSplit', split);
  set1f(finalProg, 'uWarp', warp);
  set1f(finalProg, 'uChroma', chroma);
  set1f(finalProg, 'uChromaTurn', simT * 0.4 + (1.0 * LOOP_OFF[k]));
  set1f(finalProg, 'uN', steps);
  // Posterize has no steps of its own to remember on its first frame
  set1f(finalProg, 'uFresh', pz.stepped ? 0 : 1);
  pz.stepped = steps > 0;
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  pz.live = true;
}
function shownPrev(k) { const L = loops[k]; return L.tw && L.tw.live ? L.tw.warp[1 - L.tw.wf].tex : L.rt[1 - L.front].tex; }

/* ================= ink drops ================= */
// Six droppers, each on its own uneven rhythm, land a drop of ink somewhere on screen about twice a second.
// While it bleeds, a drop drifts with the same currents Flow uses (flowAtJS mirrors flowAt in the shader).
const INK_N = 6;
const inkPos = new Float32Array(INK_N * 4), inkAmt = new Float32Array(INK_N * 4), inkCol = new Float32Array(INK_N * 3);
const fract = (x) => x - Math.floor(x);
function hashJS(x, y) {
  let px = fract(x * 123.34), py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d; py += d;
  return fract(px * py);
}
function noiseDJS(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), dux = 6 * fx * (1 - fx), duy = 6 * fy * (1 - fy);
  const a = hashJS(ix, iy), b = hashJS(ix + 1, iy), c = hashJS(ix, iy + 1), d = hashJS(ix + 1, iy + 1);
  const k = a - b - c + d;
  return [dux * (b - a + k * uy), duy * (c - a + k * ux)];
}
function flowAtJS(x, y, t) {
  let gx = 0, gy = 0;
  for (const [ang, fr, amp, ox, oy] of [[t * 0.031, 1.8, 1, t * 0.05, -t * 0.03],
                                        [1.7 - t * 0.047, 4.3, 0.42, 17 - t * 0.09, t * 0.05],
                                        [t * 0.071 + 0.6, 9.7, 0.13, t * 0.13, 31 + t * 0.11]]) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const [nx, ny] = noiseDJS((c * x + s * y) * fr + ox, (-s * x + c * y) * fr + oy);
    gx += (c * nx - s * ny) * fr * amp;
    gy += (s * nx + c * ny) * fr * amp;
  }
  return [gy, -gx];
}
const rand3 = (a, b, c) => fract(Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453);
function computeInk(t, scale, flowPerSec) {
  for (let i = 0; i < INK_N; i++) {
    const per = 2.6 + 0.37 * i, tt = t + i * 1.13, n = Math.floor(tt / per), lt = tt - n * per;
    let x = (rand3(n, i, 1) - 0.5) * simAspect * 0.85, y = (rand3(n, i, 2) - 0.5) * 0.85;
    if (flowPerSec > 0) {
      const [vx, vy] = flowAtJS(x, y, t * 0.6);
      x += vx * flowPerSec * lt; y += vy * flowPerSec * lt;
    }
    const full = (0.06 + 0.08 * rand3(n, i, 3)) * scale;
    const splash = Math.min(1, lt / 0.05) * Math.exp(-lt * 3.5);
    // Keeps bleeding color until just before this dropper's next drop lands
    const bleed = 0.3 * clamp((lt - 0.1) / 0.4, 0, 1) * clamp((per - lt) / 0.8, 0, 1);
    const push = lt < 1.6 ? 3 * Math.exp(-lt * 3) : 0;
    inkPos.set([x, y, full * (1 - Math.exp(-lt * 3)), rand3(n, i, 5) * 6.283], i * 4);
    inkAmt.set([splash, bleed, push, full], i * 4);
    // Mostly deep blues, violets and magentas, now and then teal or gold
    const h = rand3(n, i, 4);
    inkCol.set(hsv(h < 0.7 ? 0.58 + h * 0.43 : h < 0.86 ? 0.49 : 0.1, 0.97, 1), i * 3);
  }
}
// The 3D flights are drawn into one of two pictures: the loop's main input's flight into the first,
// its second input's into the other. How brightly they glow follows the music; see frame().
const sceneRT = [null, null];
let sceneGlow = 1;
function draw3D(k, name, slot, scale) {
  const sc = SCENES[name];
  if (sc.ext) return drawExt(k, sc, scale);
  if (!sceneReady(sc, true)) return null;
  const w = Math.max(2, Math.round(simW * (sc.res || 1))), h = Math.max(2, Math.round(simH * (sc.res || 1)));
  let rt = sceneRT[slot];
  if (!rt || rt.w !== w || rt.h !== h) {
    if (rt) dropTarget(rt);
    rt = sceneRT[slot] = makeTarget(w, h);
    rt.w = w;
    rt.h = h;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
  gl.viewport(0, 0, w, h);
  gl.useProgram(sc.prog.p);
  set2f(sc.prog, 'uSim', w, h);
  set1f(sc.prog, 'uTime', simT + (11.0 * LOOP_OFF[k]));
  set1f(sc.prog, 'uTravel', (sc.z + (sc.offB * LOOP_OFF[k])) % sc.period);
  // Input size is the lens: at 100 it sees about as much as your eye, lower sees wider
  set1f(sc.prog, 'uLens', 0.47 * Math.pow(2.5 / scale, 0.6));
  set1f(sc.prog, 'uGlow', sceneGlow);
  set1f(sc.prog, 'uSeed', 37 * LOOP_OFF[k]);
  if (sc.fly) {
    // The fractals: where this loop's wandering camera is, which way it looks and how it is rolled
    const dr = droneOf(sc, k);
    const cp = dr.view || dr.p;   // the camera, with its steps' bob (Camera style)
    set3f(sc.prog, 'uCam', cp[0], cp[1], cp[2]);
    set3f(sc.prog, 'uFwd', dr.look[0], dr.look[1], dr.look[2]);
    set3f(sc.prog, 'uUp', dr.up[0], dr.up[1], dr.up[2]);
    set1f(sc.prog, 'uScale', dr.scale);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return rt.tex;
}
// Mount Ribbit draws each loop's hiker's view on a canvas of its own, which is copied in here (one picture per loop)
const extTex = { A: null, B: null, C: null, D: null };
function drawExt(k, sc, scale) {
  const X = sc.ext;
  if (X.state === 'idle') X.build();
  const cv = X.state === 'failed' ? null : X.render(k, simW, simH, scale, sceneGlow);
  if (!cv) {
    if (X.state === 'failed' && sc.state !== 'failed') { sc.state = 'failed'; hideFailedWorlds(); }
    return null;
  }
  gl.activeTexture(gl.TEXTURE0);
  if (!extTex[k]) {
    extTex[k] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, extTex[k]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  gl.bindTexture(gl.TEXTURE_2D, extTex[k]);
  const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv); }
  catch (_) { gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip); return null; }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
  return extTex[k];
}
// The keys that walk Mount Ribbit's hiker (W A S D, Shift to run, J to jump). They steer the loop being edited if it
// shows Mount Ribbit, otherwise the other loop. Walk by itself (on unless switched off) takes over 10 seconds after.
const RIB_KEYS = { KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'run', ShiftRight: 'run' };
function ribKey(e, down) {
  if (!SCENES.ribbit) return false;
  const c = e.code;
  if (!down) { rib.held.delete(c); return false; }
  if (!(c in RIB_KEYS) && c !== 'KeyJ') return false;
  if (e.metaKey || e.ctrlKey || e.altKey || !uses('ribbit')) return false;
  if (c === 'KeyJ') { if (!e.repeat) rib.jump = true; } else rib.held.add(c);
  return c !== 'ShiftLeft' && c !== 'ShiftRight';
}
function ribDriven() {
  const has = (k) => loops[k].tgt.in1 === 'ribbit' || loops[k].tgt.in2 === 'ribbit';
  return has(edit) ? edit : activeKeys().find(has) || otherLoop(edit);
}
function ribControls() {
  const c = { fwd: false, back: false, left: false, right: false, run: false, jump: rib.jump };
  for (const code of rib.held) c[RIB_KEYS[code]] = true;
  rib.jump = false;
  return c;
}
window.addEventListener('keyup', (e) => ribKey(e, false));
window.addEventListener('blur', () => rib.held.clear());
/* ================= the loops' probes (Chase, Breathe, Crystal) ================= */
// Chase, Breathe and Crystal need to know what a loop's picture looks like: where it's brightest, how bright it
// is overall and how fast it's changing. So while one of them is on, a tiny 32 x 18 map of the loop's brightness is
// drawn every few hundredths of a second and handed over by the graphics chip a frame or two later, the same way
// Autopilot's eye works: nothing ever stops to wait for it, so it can't make the picture stutter.
const PROBE_W = 32, PROBE_H = 18;
let probeProg = null, probeFailed = false;
function probeMake() {
  if (!probeProg) {
    probeProg = program(FS_PROBE);
    gl.useProgram(probeProg.p);
    set1i(probeProg, 'uSrc', 0);
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PROBE_W, PROBE_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('probe target');
  const buf = new Uint8Array(PROBE_W * PROBE_H * 4);
  const pbo = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, buf.byteLength, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  return { tex, fbo, pbo, buf, sync: null, askT: 0, age: 0, lum: null, t: 0, mean: 0, motion: 0 };
}
// Once a frame for a loop using Chase, Breathe or Crystal: collects the last map if it has arrived, and asks for
// the next one. Row 0 of the map is the bottom of the picture.
function probeTick(k, now) {
  if (probeFailed) return;
  const L = loops[k];
  try {
    if (!L.probe) L.probe = probeMake();
    const P = L.probe;
    if (P.sync) {
      const st = gl.clientWaitSync(P.sync, 0, 0);   // a timeout of 0: only asks, never waits
      if (st === gl.TIMEOUT_EXPIRED && ++P.age < 60) return;
      gl.deleteSync(P.sync);
      P.sync = null;
      if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, P.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, P.buf);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const n = PROBE_W * PROBE_H, lum = new Float32Array(n);
        let sum = 0, diff = 0;
        for (let i = 0; i < n; i++) { lum[i] = P.buf[i * 4] / 255; sum += lum[i]; if (P.lum) diff += Math.abs(lum[i] - P.lum[i]); }
        const dt = (P.askT - P.t) / 1000;
        P.motion = P.lum && dt > 0.005 && dt < 1 ? diff / n / dt : P.motion;
        P.mean = sum / n;
        P.lum = lum;
        P.t = P.askT;
        probeUse(k);
      }
      return;
    }
    if (now - P.askT < 33) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, P.fbo);
    gl.viewport(0, 0, PROBE_W, PROBE_H);
    gl.useProgram(probeProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, L.rt[L.front].tex);
    set2f(probeProg, 'uOut', PROBE_W, PROBE_H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, P.pbo);
    gl.readPixels(0, 0, PROBE_W, PROBE_H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    P.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    P.askT = now;
    P.age = 0;
  } catch (err) {
    probeFailed = true;   // Chase, Breathe and Crystal then just stay still; nothing else is affected
    console.warn('Probe unavailable:', err);
  }
}
// The map, softened a little (each spot an average of it and its eight neighbours), and where each spot is on screen
function probeSoft(lum) {
  const W = PROBE_W, H = PROBE_H, out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      s += lum[yy * W + xx]; n++;
    }
    out[y * W + x] = s / n;
  }
  return out;
}
const probeX = (x) => ((x + 0.5) / PROBE_W - 0.5) * simAspect, probeY = (y) => (y + 0.5) / PROBE_H - 0.5;
// What each effect takes from a new map
function probeUse(k) {
  const L = loops[k], c = L.cur, P = L.probe, soft = probeSoft(P.lum);
  // Chase heads for the brightest part of the picture that isn't where it already is
  if (c.chase > 0.5) {
    const [cx, cy] = L.chaseAt;
    let best = 0.06, tx = null, ty = null;
    for (let y = 0; y < PROBE_H; y++) for (let x = 0; x < PROBE_W; x++) {
      const v = soft[y * PROBE_W + x], X = probeX(x), Y = probeY(y);
      if (v > best && Math.hypot(X - cx, Y - cy) > 0.14) { best = v; tx = X; ty = Y; }
    }
    if (tx !== null) L.chaseGoal = [clamp(tx, -0.3 * simAspect, 0.3 * simAspect), clamp(ty, -0.3, 0.3)];
  }
  // Crystal's pieces centre on the brightest spots, each piece easing towards the nearest one
  if (c.crystal > 0.5) {
    const peaks = [];
    for (let y = 0; y < PROBE_H; y++) for (let x = 0; x < PROBE_W; x++) {
      const v = soft[y * PROBE_W + x];
      if (v < 0.05) continue;
      let top = true;
      for (let dy = -1; dy <= 1 && top; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < PROBE_W && yy < PROBE_H && soft[yy * PROBE_W + xx] > v) { top = false; break; }
      }
      if (top) peaks.push([v, probeX(x), probeY(y)]);
    }
    peaks.sort((a, b) => b[0] - a[0]);
    const goals = [];
    for (const [, X, Y] of peaks) {
      if (goals.length >= 10) break;
      if (goals.every(([gx, gy]) => Math.hypot(gx - X, gy - Y) > 0.12)) goals.push([X, Y]);
    }
    // Not enough bright spots: the rest sit at steady places spread over the screen
    for (let i = 0; goals.length < 10; i++) goals.push([(fract(Math.sin(i * 7.31 + 1) * 4375.85) - 0.5) * simAspect * 0.9,
                                                        fract(Math.sin(i * 3.17 + 2) * 2791.13) - 0.55]);
    const cells = L.cells, used = new Set();
    for (const [gx, gy] of goals) {
      let bi = -1, bd = 1e9;
      for (let i = 0; i < 10; i++) {
        if (used.has(i)) continue;
        const d = Math.hypot(cells[i * 2] - gx, cells[i * 2 + 1] - gy);
        if (d < bd) { bd = d; bi = i; }
      }
      used.add(bi);
      cells[bi * 2] += (gx - cells[bi * 2]) * 0.35;
      cells[bi * 2 + 1] += (gy - cells[bi * 2 + 1]) * 0.35;
    }
  }
}
// Breathe: Zoom and Spin follow the picture itself. Brighter than about a fifth pulls back, darker pushes in, and
// lots of movement turns the spin up. Each loop finds its own rhythm, and backs off before it turns white.
function breathe(k, amt, dt) {
  const L = loops[k], P = L.probe, B = L.breath;
  if (!P || !P.lum) return B;
  const goalZ = clamp((0.2 - P.mean) * 1500, -90, 70) * amt;
  const goalS = 1 + amt * Math.min(P.motion * 3, 2);
  const e = 1 - Math.exp(-dt * 1.6);
  B.z += (goalZ - B.z) * e;
  B.s += (goalS - B.s) * e;
  return B;
}
function runLoop(k, xf, brush, f) {
  const L = loops[k], c = L.cur, t = L.tgt;
  const otherK = otherLoop(k);
  const otherTex = shownTex(otherK), otherPrev = shownPrev(otherK);
  let z = c.zoom, s = c.spin, col = c.color, w = c.warp, sx = c.shiftX, sy = c.shiftY;
  let sizeBoost = 0, gainBoost = 1;
  if (reacts(k)) {
    const a = sndPower(), E = snd.env, m = snd.map;
    if (m.kick) z += a * (E.low * 45 + E.beat * 45);
    if (m.spin) s += a * E.mid * 60 * (s < 0 ? -1 : 1);
    if (m.color) col += a * (E.high * 60 + E.beat * 15);
    if (m.warp) w += a * (E.beat * 50 + E.mid * 15);
    if (m.size) sizeBoost = a * (E.low * 30 + E.beat * 22);
    if (m.flash) gainBoost = 1 + a * E.beat * 0.8;
  }
  const br = clamp(c.breathe, 0, 100) / 100;
  if (br > 0.005) { const B = breathe(k, br, f / 60); z += B.z; s *= B.s; }
  else { L.breath.z *= 0.95; L.breath.s += (1 - L.breath.s) * 0.05; }
  z = clamp(z, -100, 100); s = clamp(s, -100, 100); col = clamp(col, 0, 100); w = clamp(w, 0, 100);
  L.warpNow = w;   // with the music's push, for Warp in the final pass
  // Effects set to Final Pass are left out of the loop (see finalPass)
  if (t.warpFinal) w = 0;
  const tr = clamp(c.trails, 0, 100) / 100;
  // Below 10 the trails fade away completely, so 0 shows the input with no feedback at all
  const ramp = tr >= 0.1 ? 1 : (tr / 0.1) * (tr / 0.1) * (3 - 2 * tr / 0.1);
  const decay60 = (1 - (0.2 - 0.194 * Math.pow(tr, 0.7))) * ramp;

  // The music can swell the input past the slider's top, so it still pulses when Size is already at 100
  const scale = Math.pow(2.5, (Math.min(clamp(c.size, 0, 100) + sizeBoost, 140) / 100 - 0.5) * 2);
  const fly1 = is3D(t.in1) ? t.in1 : null;
  const fly2 = t.in2 !== t.in1 && is3D(t.in2) ? t.in2 : null;
  const flyTex1 = fly1 ? draw3D(k, fly1, 0, scale) : null;
  const flyTex2 = fly2 ? draw3D(k, fly2, 1, scale) : flyTex1;

  const src = L.rt[L.front], dst = L.rt[1 - L.front];
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, simW, simH);
  gl.useProgram(fbProg.p);
  const [V, C, S, P] = [vid, cam, scr, pho].map((s) => s.texFor(t.subject));
  // The see-through surround only once every live input here has its outlines; until then the plain picture
  set1f(fbProg, 'uCutout', subjectOn(t) && [t.in1, t.in2].every((n) => !LIVE_SRC[n] || LIVE_SRC[n].texFor(t.subject) !== LIVE_SRC[n]) ? 1 : 0);
  const texs = [src.tex, otherTex, picTex, V.cur, V.prev, C.cur, C.prev, S.cur, S.prev, P.cur, P.prev, otherPrev,
                flyTex1 || src.tex, flyTex2 || src.tex, specTex, textTex];
  texs.forEach((tx, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tx); });
  if (t.in1 === 'spectro' || t.in2 === 'spectro') {
    set2f(fbProg, 'uSpecSize', SPEC_W, SPEC_H);
    set1f(fbProg, 'uSpecNew', (spec.next - 1 + SPEC_H) % SPEC_H);
    set1f(fbProg, 'uSpecAcc', spec.acc);
    set1f(fbProg, 'uSpecRound', t.specRound ? 1 : 0);
  }

  set2f(fbProg, 'uSim', simW, simH);
  set1f(fbProg, 'uPxK', simH / SIM_H);
  set1f(fbProg, 'uTime', simT + (11.0 * LOOP_OFF[k]));
  set1f(fbProg, 'uZoom', (z / 100) * 0.03 * f);
  set1f(fbProg, 'uSpin', -(s / 100) * 0.045 * f);
  set1f(fbProg, 'uDecay', Math.pow(decay60, f));
  // A 3D flight fills the whole screen, so rather than piling up into white as the trails build, each frame
  // only adds what the trails let fade: still parts keep their brightness and moving ones leave streaks
  set1f(fbProg, 'uSceneK', Math.max(0.03, 1 - Math.pow(decay60, f)));
  set1f(fbProg, 'uHue', Math.pow(col / 100, 1.5) * 0.08 * f);
  set1f(fbProg, 'uWarp', (w / 100) * 0.006 * f);
  const fl = (clamp(c.flow, 0, 100) / 100) * FLOW_K;
  set1f(fbProg, 'uFlow', fl * f);
  const sp = t.splitFinal ? 0 : clamp(c.split, 0, 100) / 100;
  set1f(fbProg, 'uSplit', Math.pow(sp, 1.5) * 0.007 * f);
  set1f(fbProg, 'uSplitOff', sp * 0.06);
  // Gentle low on the slider, wild at the top
  set1f(fbProg, 'uMelt', Math.pow(clamp(c.melt, 0, 100) / 100, 1.3) * MELT_K * f);
  set1f(fbProg, 'uMeltTurn', simT * 0.07 + (2.0 * LOOP_OFF[k]));
  set1f(fbProg, 'uPush', Math.pow(clamp(c.push, 0, 100) / 100, 1.3) * PUSH_K * f);
  set1f(fbProg, 'uPushTurn', simT * 0.05 + (3.0 * LOOP_OFF[k]));
  set1f(fbProg, 'uDye', Math.min(0.6, Math.pow(clamp(c.dye, 0, 100) / 100, 1.2) * DYE_K * f));
  set1f(fbProg, 'uDyeTurn', simT * 0.03 + (0.5 * LOOP_OFF[k]));
  // Feeds on itself
  set1f(fbProg, 'uLook', Math.min(0.2, Math.pow(clamp(c.lookup, 0, 100) / 100, 1.2) * LOOK_K * f));
  const ch = clamp(c.chase, 0, 100) / 100;
  // Chase: the turning point glides towards its goal (home to the middle when Chase is off)
  const goal = ch > 0.005 ? L.chaseGoal : [0, 0], ce = 1 - Math.exp(-(f / 60) * (ch > 0.005 ? 0.25 + 1.6 * ch : 1.5));
  L.chaseAt[0] += (goal[0] - L.chaseAt[0]) * ce;
  L.chaseAt[1] += (goal[1] - L.chaseAt[1]) * ce;
  set2f(fbProg, 'uCenter', L.chaseAt[0], L.chaseAt[1]);
  set1f(fbProg, 'uChroma', t.chromaFinal ? 0 : Math.pow(clamp(c.chroma, 0, 100) / 100, 1.2) * CHROMA_K * f);
  set1f(fbProg, 'uChromaTurn', simT * 0.4 + (1.0 * LOOP_OFF[k]));
  set1f(fbProg, 'uRestless', 1 - Math.pow(1 - 0.3 * clamp(c.restless, 0, 100) / 100, f));
  set1f(fbProg, 'uJulia', clamp(c.julia, 0, 100) / 100);
  const ja = 2.2 + 0.9 * Math.sin(simT * 0.021 + (2.0 * LOOP_OFF[k]));
  set2f(fbProg, 'uJuliaC', 0.7885 * Math.cos(ja), 0.7885 * Math.sin(ja));
  set1f(fbProg, 'uCrystal', Math.pow(clamp(c.crystal, 0, 100) / 100, 1.2) * f);
  const lc = U(fbProg, 'uCells[0]');
  if (lc) gl.uniform4fv(lc, L.cells);
  // Grow: faster towards the top of the slider. Its ring turns at random every frame (see growAt).
  set1f(fbProg, 'uGrow', Math.min(0.2, Math.pow(clamp(c.grow, 0, 100) / 100, 1.2) * GROW_K * f));
  set1f(fbProg, 'uGrowR', GROW_R[t.growSize] ?? GROW_R[1]);
  set1f(fbProg, 'uGrowTurn', Math.random() * 6.2831853);
  // Color filters set to work inside this loop (see "color filters")
  set1f(fbProg, 'uPoster', t.posterIn && c.poster > 0.5 ? posterSteps(c.poster) : 0);
  setLoopGradeUniforms(f);
  set1f(fbProg, 'uAspText', textAspect);
  mirrorUniforms(fbProg, k, !t.mirrorFinal);
  set1f(fbProg, 'uBlur', clamp(c.blur, -0.3, 1));
  set1f(fbProg, 'uEdge', t.edge);
  set2f(fbProg, 'uShift', sx * f, sy * f);
  set1f(fbProg, 'uGain', c.gain * gainBoost);
  set1f(fbProg, 'uForm', t.form);
  if (t.in1 === 'wave' || t.in2 === 'wave') {
    computeWave(simT + (11.0 * LOOP_OFF[k]), t.form);
    const lw = U(fbProg, 'uWave[0]'), lb = U(fbProg, 'uWaveBox[0]');
    if (lw) gl.uniform2fv(lw, wavePts);
    if (lb) gl.uniform4fv(lb, waveBoxes);
  }
  set1f(fbProg, 'uFloor', useFloat ? 0 : 1.5 / 255);
  set1f(fbProg, 'uXfeed', xf);
  // A world that can't be drawn feeds in nothing (never the loop's own last frame)
  set1i(fbProg, 'uIn1', is3D(t.in1) && !flyTex1 ? SRC_ID.none : resolveSrc(t.in1, t.motion));
  set1i(fbProg, 'uIn2', t.in2 === 'none' || (is3D(t.in2) && !flyTex2) ? SRC_ID.none : resolveSrc(t.in2, t.motion));
  set1f(fbProg, 'uBlend', clamp(c.blend, 0, 100) / 100);
  set1f(fbProg, 'uScale', scale);
  const inkOn = t.in1 === 'ink' || t.in2 === 'ink';
  set1f(fbProg, 'uInkDt', inkOn ? f / 60 : 0);
  if (inkOn) {
    computeInk(simT + (11.0 * LOOP_OFF[k]), scale, fl * 60);
    const li = U(fbProg, 'uInk[0]'), la = U(fbProg, 'uInkAmt[0]'), lc = U(fbProg, 'uInkCol[0]');
    if (li) gl.uniform4fv(li, inkPos);
    if (la) gl.uniform4fv(la, inkAmt);
    if (lc) gl.uniform3fv(lc, inkCol);
  }
  set1f(fbProg, 'uMotion', t.motion ? 1 : 0);
  set1f(fbProg, 'uSoft', t.soft !== false && (LIVE.includes(t.in1) || LIVE.includes(t.in2)) ? 1 : 0);
  set1f(fbProg, 'uAspPic', picAspect);
  set1f(fbProg, 'uAspVid', vid.aspect);
  set1f(fbProg, 'uAspCam', cam.aspect);
  set1f(fbProg, 'uAspScr', scr.aspect);
  set1f(fbProg, 'uAspPho', pho.aspect);
  set1f(fbProg, 'uFlipCam', cam.flip ? 1 : 0);
  set1f(fbProg, 'uFlipPho', pho.flip ? 1 : 0);
  const la = U(fbProg, 'uAdjA[0]'), lb = U(fbProg, 'uAdjB[0]');
  if (la) gl.uniform4fv(la, adjA);
  if (lb) gl.uniform4fv(lb, adjB);
  set3f(fbProg, 'uReliefL', reliefL[0], reliefL[1], reliefL[2]);
  let b = [0, 0, 0, 0], on = 0;
  if (brush) {
    let a = foldJS(brush[0][0], brush[0][1], t.mirror);
    const e = foldJS(brush[1][0], brush[1][1], t.mirror);
    if (Math.hypot(a[0] - e[0], a[1] - e[1]) > 0.2) a = e;
    b = [a[0], a[1], e[0], e[1]]; on = 1;
  }
  set4f(fbProg, 'uBrush', b[0], b[1], b[2], b[3]);
  set1f(fbProg, 'uBrushOn', on);
  set1i(fbProg, 'uSwN', shapeSw.n);
  if (shapeSw.n) { const l = U(fbProg, 'uSw[0]'); if (l) gl.uniform4fv(l, shapeSw.S); }
  const bc = hsv(((simT * 0.15) + (0.5 * LOOP_OFF[k])) % 1, 0.65, 1);
  set3f(fbProg, 'uBrushCol', bc[0], bc[1], bc[2]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  L.front = 1 - L.front;
  twStep(k, f / 60);
  if (c.chase > 0.5 || c.breathe > 0.5 || c.crystal > 0.5) probeTick(k, performance.now());
}

/* ================= autopilot's eye: the copies ================= */
// A tiny copy of one picture is drawn (each spot an average of four, so fine patterns aren't missed) and read
// into a buffer the graphics chip fills in its own time, with a marker that says when it's done. Each frame the
// marker is asked about, never waited on; the copy is read once it's there. (See eyeStats for what's noted.)
function eyeSetup() {
  try {
    eye.prog = program(FS_EYE);
    gl.useProgram(eye.prog.p);
    set1i(eye.prog, 'uSrc', 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, EYE_W, EYE_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('eye target');
    eye.tgt = { tex, fbo };
    eye.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, eye.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, eye.buf.byteLength, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  } catch (e) {
    // Without it Autopilot carries on as it always did
    eye.failed = true;
    ap.prep = null;
  }
}
function eyeAsk(key, tex, now) {
  if (!eye.tgt) { eyeSetup(); if (eye.failed) return; }
  gl.bindFramebuffer(gl.FRAMEBUFFER, eye.tgt.fbo);
  gl.viewport(0, 0, EYE_W, EYE_H);
  gl.useProgram(eye.prog.p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  set2f(eye.prog, 'uOut', EYE_W, EYE_H);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, eye.pbo);
  gl.readPixels(0, 0, EYE_W, EYE_H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  eye.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  eye.key = key;
  eye.askGen = eye.gen[key];
  eye.askLook = key === 'comp' ? 0 : loops[key].gen;
  eye.askT = now;
  eye.age = 0;
}
// The copy, if it has arrived: noted down, and which picture it was returned. A copy of a picture that has
// since been wiped or given a new look is thrown away.
function eyeCollect() {
  if (!eye.sync) return null;
  const st = gl.clientWaitSync(eye.sync, 0, 0);   // a timeout of 0: only asks, never waits
  if (st === gl.TIMEOUT_EXPIRED && ++eye.age < 60) return null;
  gl.deleteSync(eye.sync);
  eye.sync = null;
  if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) return null;
  if (eye.askGen !== eye.gen[eye.key]) return null;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, eye.pbo);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, eye.buf);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  eyeStats(eye.key, eye.buf, eye.askT).gen = eye.askLook;
  return eye.key;
}
// Once a frame while Autopilot runs: collects the last copy, starts trying out the next look when it's nearly
// due (Check each look), keeps the white-out watch going, and asks for the next copy. The look being tried out
// gets every other copy; the rest go round the picture on screen and the loops showing in it.
function eyeTick(now, dt, wA, wB) {
  if (eye.failed) return;
  // With Autopilot off the eye only opens for a moment, to see a look that has just been rated or is being saved
  // (and stays open while a rating is still waiting for its picture, a few seconds at most)
  const looking = ap.on || now <= eye.wantUntil || taste.pending.length > 0;
  if (!looking && !eye.sync) return;
  const got = eyeCollect();
  if (got) tasteFill(now);
  if (frozen) return;
  if (ap.on) {
    if (got && ap.prep && got === ap.prep.k) prepJudge(now);
    // Looks are only tried out of sight when Autopilot swaps loops A and B (it runs both)
    if (checking() && canTryOut() && apPair()) {
      const v = mix.tgt.view, P = ap.prep;
      const hidden = v <= 1 ? 'B' : v >= 99 ? 'A' : null;
      // The view moved (or a person moved it) while a look was being tried: try again for the next one
      if (P && P.k !== hidden) ap.prep = null;
      else if (!P && hidden && (hidden === 'A' ? wA : wB) <= 0.02 && now > ap.next - CHECK.lead * 1000) prepBegin(hidden, now, false);
    } else if (ap.prep) ap.prep = null;
    if (ap.glide && now >= ap.glide.at) glideJudge(now);
    whiteWatch(now, dt, wA, wB);
  }
  if (looking && !eye.sync && now - eye.askT > 55) {
    const P = ap.prep, keys = P ? [P.k, 'comp', P.k] : ['comp'];
    for (const k of ['A', 'B']) if ((k === 'A' ? wA : wB) > 0.02 && !(P && P.k === k)) keys.push(k);
    const key = keys[eye.turn++ % keys.length];
    eyeAsk(key, key === 'comp' ? comp.tex : shownTex(key), now);
  }
}

/* ================= planned beat sequence ================= */
const spotify = new PhosphorSpotify();

/* ================= sequencer under the picture ================= */
// Four tracks, one per loop (A to D). Blocks are placed by time along the song; each carries one loop's look, fades
// in and out, crossfades with a block it overlaps on its track, and can change sliders over its length. A track
// with nothing on it at that moment leaves its loop blank. Each Spotify song keeps its own sequence (and named
// versions of it) in localStorage, and its spectrograph, built up from what the app hears, in IndexedDB.
const TL = window.PhosphorTimeline;
const SEQ_KEY = 'phosphor-song-timelines-v2', SEQ_OLD_KEY = 'phosphor-song-sequences-v1';
const SEQ_OPEN_KEY = 'phosphor-sequencer-open';
const SEQ_TRACK = [
  { color: '#8b1ab8', fill: 'rgba(139,26,184,.38)', ink: '#fff' },
  { color: '#4fd1c5', fill: 'rgba(79,209,197,.22)' },
  { color: '#f0a030', fill: 'rgba(240,160,48,.22)' },
  { color: '#5b8cff', fill: 'rgba(91,140,255,.22)' },
];
// Every slider a block can change over its length. "show" and "feed" are the loop's own Show and Feed faders;
// the g… ones are its color grading, which in the sequencer belongs to each loop on its own.
const SEQ_SLIDERS = [
  ['Loop', [['show', 'Show'], ['feed', 'Feed into other loop'], ['blend', 'Blend'], ['size', 'Input size']]],
  ['Effects', [['zoom', 'Zoom'], ['spin', 'Spin'], ['trails', 'Trails'], ['color', 'Color shift'], ['poster', 'Posterize'], ['warp', 'Warp'], ['flow', 'Flow'],
    ['melt', 'Melt'], ['grow', 'Grow'], ['split', 'Split lines'], ['time', 'Time warp'], ['lookup', 'Look-up'], ['chase', 'Chase'],
    ['breathe', 'Breathe'], ['chroma', 'Color chase'], ['restless', 'Restless'], ['julia', 'Fractal fold'], ['crystal', 'Crystal']]],
  ['Color grading', [['gExposure', 'Exposure'], ['gContrast', 'Contrast'], ['gGamma', 'Midtones'], ['gSat', 'Saturation'], ['gHue', 'Hue'],
    ['gRed', 'Red'], ['gGreen', 'Green'], ['gBlue', 'Blue'], ['gSepia', 'Sepia']]],
];
const SEQ_NAME = Object.fromEntries(SEQ_SLIDERS.flatMap(([, list]) => list));
const SEQ_LINES = ['#e9fbe9', '#ffd27a', '#8ff0ff', '#ffa3d1'];
// A slider's range, from the control itself
function seqRange(key) {
  const el = key === 'show' ? $('#showA') : key === 'feed' ? $('#xab') : $('#' + key);
  return el ? [Number(el.min), Number(el.max)] : [0, 100];
}
const fmtSeq = (t, tenths) => {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0'));
};
const r1 = (v) => Math.round(v * 10) / 10;
const inputName = (k) => SRC_LABEL[k] || 'Nothing';
// A block's name: the one you gave it, or else what its loop shows
const seqName = (bl) => (bl.rec ? 'Recording…' : bl.label || inputName(bl.look?.in1));

const seq = {
  records: new Map(), key: 'standalone', rec: TL.newRecord(), song: null, accountId: null, lastPlayback: null,
  running: false, apMode: null, applied: [null, null, null, null], xin: [false, false, false, false],
  local: { pos: 0, at: 0, playing: false }, t: 0, playing: false, live: false,
  selTrack: 0, selId: null, clip: null, undo: [], redo: [],
  view: { start: 0, pps: 1, minPps: 1, maxPps: 240, vw: 600 }, dirty: true, specDirty: true, lastDraw: 0,
  spec: null, recording: false, recBlock: null, recBefore: null, recGen: 0, drag: null,
};
try {
  const saved = JSON.parse(localStorage.getItem(SEQ_KEY) || 'null');
  if (saved?.v === 2 && Array.isArray(saved.records)) {
    for (const [key, rec] of saved.records) if (typeof key === 'string') seq.records.set(key, TL.normalize(rec));
  } else {
    // Sequences from the beat-counted step list come across once, as blocks on track 1
    const old = JSON.parse(localStorage.getItem(SEQ_OLD_KEY) || 'null');
    if (old?.v === 1 && Array.isArray(old.records)) for (const [key, record] of old.records) {
      if (typeof key === 'string' && record?.steps?.length) seq.records.set(key, TL.fromSteps(record));
    }
  }
} catch (_) { /* storage is optional */ }
const seqNote = (msg) => { $('#seqNote').textContent = msg; };
function seqSave() {
  seq.records.set(seq.key, seq.rec);
  try {
    localStorage.setItem(SEQ_KEY, JSON.stringify({ v: 2, records: [...seq.records].filter(([, r]) => r.blocks.length || r.markers.length || r.versions.length) }));
  } catch (_) { seqNote('Browser storage is full; your latest sequence changes could not be saved.'); }
}
// How long the song is: Spotify's length, or (without a song) a little past the last block
function seqDur() {
  if (seq.song) return Math.max(1, seq.song.durationMs / 1000);
  return Math.max(240, Math.ceil((TL.lastEnd(seq.rec) + 30) / 10) * 10);
}

/* ---------- undo / redo (for this song, this visit) ---------- */
const seqSnap = () => JSON.stringify({ blocks: seq.rec.blocks, markers: seq.rec.markers });
function seqRestore(s) {
  const o = JSON.parse(s); seq.rec.blocks = o.blocks; seq.rec.markers = o.markers;
  if (!seq.rec.blocks.some((b) => b.id === seq.selId)) seq.selId = null;
}
function seqCommit(before) {
  if (before !== seqSnap()) { seq.undo.push(before); if (seq.undo.length > 200) seq.undo.shift(); seq.redo.length = 0; seqSave(); }
  seqUndoUI(); seq.dirty = true;
}
function seqChange(fn) { const before = seqSnap(); fn(); seqCommit(before); }
function seqUndoUI() { $('#seqUndo').disabled = !seq.undo.length; $('#seqRedo').disabled = !seq.redo.length; }
function seqUndo() { if (!seq.undo.length) return; seq.redo.push(seqSnap()); seqRestore(seq.undo.pop()); seqSave(); seqUndoUI(); seq.dirty = true; seqNote('Undone.'); }
function seqRedo() { if (!seq.redo.length) return; seq.undo.push(seqSnap()); seqRestore(seq.redo.pop()); seqSave(); seqUndoUI(); seq.dirty = true; seqNote('Redone.'); }
$('#seqUndo').addEventListener('click', seqUndo);
$('#seqRedo').addEventListener('click', seqRedo);

/* ---------- the song's spectrograph, built from what the app hears ---------- */
const SPEC_SEQ_RATE = 20, SPEC_SEQ_BANDS = 28;
const seqSpecDB = (() => {
  let db = null;
  const open = () => db ||= new Promise((res, rej) => {
    const r = indexedDB.open('phosphor-song-spectrographs', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('s');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => { const tx = d.transaction('s', mode), q = fn(tx.objectStore('s')); tx.oncomplete = () => res(q?.result); tx.onerror = () => rej(tx.error); });
  };
  return { get: (k) => run('readonly', (s) => s.get(k)), put: (k, v) => run('readwrite', (s) => s.put(v, k)) };
})();
function seqSpecFor(key, dur) {
  const n = Math.ceil(dur * SPEC_SEQ_RATE);
  const sp = { key, n, data: new Uint8Array(n * SPEC_SEQ_BANDS), heard: new Uint8Array(n), changed: false, savedAt: 0 };
  if (key !== 'standalone') seqSpecDB.get(key).then((v) => {
    if (seq.spec !== sp || !v?.data) return;
    const len = Math.min(n, v.heard.length);
    for (let i = 0; i < len; i++) if (v.heard[i] && !sp.heard[i]) {
      sp.heard[i] = 1; sp.data.set(v.data.subarray(i * SPEC_SEQ_BANDS, (i + 1) * SPEC_SEQ_BANDS), i * SPEC_SEQ_BANDS);
    }
    seq.specDirty = true;
  }).catch(() => {});
  return sp;
}
function seqSpecStore(force) {
  const sp = seq.spec;
  if (!sp || !sp.changed || sp.key === 'standalone' || (!force && performance.now() - sp.savedAt < 5000)) return;
  sp.changed = false; sp.savedAt = performance.now();
  seqSpecDB.put(sp.key, { data: sp.data, heard: sp.heard }).catch(() => {});
}
// Each twentieth of a second of song that plays with sound connected fills in a column (gaps fill on a later listen)
let seqSpecEdges = null, seqSpecLast = -1;
function seqSpecCapture(t) {
  const sp = seq.spec;
  if (!sp || !snd.analyser || !snd.bins || !seq.playing) { seqSpecLast = -1; return; }
  const i = Math.floor(t * SPEC_SEQ_RATE);
  if (i < 0 || i >= sp.n || i === seqSpecLast) return;
  const bins = snd.bins, hz = snd.rate / snd.analyser.fftSize;
  if (!seqSpecEdges || seqSpecEdges.hz !== hz) {
    const e = [];
    for (let b = 0; b <= SPEC_SEQ_BANDS; b++) e.push(clamp(Math.round(30 * Math.pow(16000 / 30, b / SPEC_SEQ_BANDS) / hz), 1, bins.length - 1));
    seqSpecEdges = { hz, e };
  }
  const e = seqSpecEdges.e, row = new Uint8Array(SPEC_SEQ_BANDS);
  for (let b = 0; b < SPEC_SEQ_BANDS; b++) {
    let v = 0;
    for (let j = e[b]; j <= Math.max(e[b], e[b + 1] - 1); j++) if (bins[j] > v) v = bins[j];
    row[b] = v;
  }
  // A short jump forward (a dropped frame) fills the columns in between; a seek doesn't
  const from = seqSpecLast >= 0 && i > seqSpecLast && i - seqSpecLast < 6 ? seqSpecLast + 1 : i;
  for (let k = from; k <= i; k++) { sp.data.set(row, k * SPEC_SEQ_BANDS); sp.heard[k] = 1; }
  seqSpecLast = i; sp.changed = true; seq.specDirty = true;
  seqSpecStore(false);
}

/* ---------- which song, and where in it ---------- */
function seqPos(now) {
  const s = spotify.snapshot;
  if (seq.song && s?.track && s.track.uri === seq.song.uri && now - s.receivedAt < 10000)
    return { t: spotify.position(now) / 1000, playing: !!s.playing, live: true };
  const L = seq.local;
  return { t: L.playing ? L.pos + (now - L.at) / 1000 : L.pos, playing: L.playing, live: false };
}
function seqLoadSong(key, song) {
  seqStopRec();
  seqSpecStore(true);
  if (seq.key !== key) seq.records.set(seq.key, seq.rec);
  seq.key = key; seq.song = song || null;
  seq.rec = seq.records.get(key) || TL.newRecord();
  seq.undo.length = 0; seq.redo.length = 0; seqUndoUI();
  seq.selId = null; seq.applied = [null, null, null, null];
  seq.spec = seqSpecFor(key, seqDur());
  $('#seqEnd').value = seq.rec.end;
  $('#seqSong').innerHTML = song
    ? `<b>${escapeHTML(song.name)}</b> <span>· ${escapeHTML(song.artists.join(', '))}</span>`
    : '<b>No song</b> <span>· its own clock (connect Spotify under Song sequencer to follow a song)</span>';
  const v = seq.view; v.start = 0; v.pps = v.minPps = v.vw / seqDur();
  seq.dirty = seq.specDirty = true;
}
function seqUsedLoops() { return seq.rec.blocks.reduce((m, b) => Math.max(m, b.track + 1), 2); }
function seqRun(on, message) {
  seq.running = on;
  $('#seqPlay').setAttribute('aria-pressed', String(on));
  seq.applied = [null, null, null, null];
  if (on) {
    if (ap.on) setAutopilot(false, true);
    seq.apMode = null;
    if (loopCount < seqUsedLoops()) { setLoopCount(seqUsedLoops(), 'load'); syncUI(); }
  } else {
    if (seq.apMode) { seq.apMode = null; }
    seqStopRec();
  }
  if (message) seqNote(message);
}
async function seqPlay() {
  if (seq.song && spotify.snapshot?.track?.uri === seq.song.uri) {
    seqRun(true, spotify.snapshot.playing ? 'Following the song in Spotify.' : 'Following the song. Press play in Spotify to start it.');
    if (!spotify.snapshot.playing && spotify.canSeek) {
      try { await spotify.api('/me/player/play', true, { method: 'PUT' }); } catch (_) { /* Spotify's own play button still works */ }
    }
    return;
  }
  const L = seq.local;
  if (L.pos >= seqDur()) L.pos = 0;
  L.at = performance.now(); L.playing = true;
  seqRun(true, seq.rec.blocks.length ? 'Playing the sequence on its own clock.' : 'Playing. Add a look to a track to see it come in.');
}
async function seqStop() {
  const L = seq.local;
  if (L.playing) { L.pos += (performance.now() - L.at) / 1000; L.playing = false; }
  seqRun(false, 'Stopped. The picture holds where it is.');
  if (seq.song && spotify.snapshot?.playing && spotify.canSeek) {
    try { await spotify.api('/me/player/pause', true, { method: 'PUT' }); } catch (_) { /* pause it in Spotify */ }
  }
}
$('#seqPlay').addEventListener('click', () => { if (seq.running) void seqStop(); else void seqPlay(); });
$('#seqStop').addEventListener('click', () => { void seqStop(); if (!seq.song) { seq.local.pos = 0; seq.dirty = true; } });
function seqSeek(t) {
  t = clamp(t, 0, seqDur());
  if (seq.song && spotify.snapshot?.track?.uri === seq.song.uri) {
    if (!spotify.canSeek) { seqNote('Reconnect Spotify (Song sequencer › Connect Spotify) to move the song from here.'); return; }
    spotify.seek(t * 1000).catch((err) => seqNote(err.message));
  } else { seq.local.pos = t; seq.local.at = performance.now(); }
  seq.applied = [null, null, null, null]; seq.dirty = true;
}
$('#seqEnd').addEventListener('change', (e) => { seq.rec.end = e.target.value; seqSave(); });

/* ---------- playing the blocks onto the loops ---------- */
const SEQ_SKIP = new Set(['in1', 'in2', 'blend']);
function seqApplyTrack(k, x, now) {
  const K = KEYS[k], L = loops[K], T = L.tgt;
  if (!x) { mix.tgt[SHOW[K]] = 0; seq.applied[k] = null; seqGrade(K, null); return; }
  const sig = x.other ? `${x.other.id}>${x.main.id}` : x.main.id;
  if (seq.applied[k] !== sig) {
    const wasCross = (seq.applied[k] || '').includes('>');
    patchLoop(K, x.other ? x.other.look : x.main.look, true);
    seq.xin[k] = false;
    // Over a crossfade the outgoing input fades into the incoming one through Blend
    if (x.other && x.main.look.in1 !== T.in1 && T.in2 === 'none') { T.in2 = x.main.look.in1; seq.xin[k] = true; }
    if (wasCross && !x.other) L.cur.blend = T.blend;
    seq.applied[k] = sig;
    const used = [T.in1, T.in2];
    if (used.includes('camera') && !cam.on) startCamera();
    if (used.includes('screen') && !scr.on) startScreen(true);
    settleDevices();
    if (K === edit) syncUI();
  }
  if (x.other) {
    const a = x.other.look, b = x.main.look, w = x.w, d = loopDefaults();
    for (const p of LOOP_SMOOTH) if (!SEQ_SKIP.has(p)) {
      const va = Number.isFinite(a[p]) ? a[p] : d[p], vb = Number.isFinite(b[p]) ? b[p] : d[p];
      T[p] = va + (vb - va) * w;
    }
    for (const p of Object.keys(b)) if (!LOOP_SMOOTH.includes(p) && !SEQ_SKIP.has(p) && typeof b[p] !== 'object') T[p] = w >= 0.5 ? b[p] : (a[p] ?? d[p]);
    if (seq.xin[k]) T.blend = w * 100;
    else if (Number.isFinite(a.blend) && Number.isFinite(b.blend)) T.blend = a.blend + (b.blend - a.blend) * w;
  }
  // Change lines: on the block coming in, and (during a crossfade) the one going out, weighted by the crossfade
  let show = 100, feed = null;
  const vals = {};
  const take = (blk, u, wt) => {
    for (const au of blk.autos) {
      const [lo, hi] = seqRange(au.key), v = lo + (hi - lo) * TL.autoValue(au.pts, u);
      if (!(au.key in vals)) vals[au.key] = { sum: 0, wt: 0 };
      vals[au.key].sum += v * wt; vals[au.key].wt += wt;
    }
  };
  take(x.main, x.u, x.other ? x.w : 1);
  if (x.other) take(x.other, x.uOther, 1 - x.w);
  const grade = {};
  for (const [key, { sum, wt }] of Object.entries(vals)) {
    if (wt <= 0) continue;
    const v = sum / wt;
    if (key === 'show') show = v;
    else if (key === 'feed') feed = v;
    else if (key in GRADE_DEF) grade[key] = v;
    else if (key in T) T[key] = v;
  }
  mix.tgt[SHOW[K]] = clamp(show, 0, 100) * x.show;
  if (feed !== null) mix.tgt[FEED_INTO[otherLoop(K)]] = feed;
  seqGrade(K, Object.keys(grade).length ? grade : null);
}
// Color grading inside the sequencer is each loop's own (see loopGrade); null puts that loop back to normal
function seqGrade(K, g) { loopGrade[K] = g; }

function seqTick(now) {
  const p = seqPos(now);
  seq.t = p.t; seq.playing = p.playing; seq.live = p.live;
  if (seq.local.playing && !p.live && p.t >= seqDur()) { seq.local.pos = seqDur(); seq.local.playing = false; seq.playing = false; }
  if (!frozen) seqSpecCapture(p.t);
  if (seq.recording) seqRecTick(p);
  if (seq.running && !frozen) {
    if (ap.on && !seq.apMode) seqRun(false, 'Autopilot took over, so the sequence stopped. Press Play to go back to it.');
    else {
      const r = TL.resolve(seq.rec, p.t);
      if (r.autopilot) {
        if (seq.apMode !== 'end') { seq.apMode = 'end'; setAutopilot(true, true); seqNote('The sequence has ended, so Autopilot is running.'); }
      } else {
        if (seq.apMode === 'end') { seq.apMode = null; setAutopilot(false, true); }
        if (!seq.apMode) for (let k = 0; k < TL.TRACKS; k++) {
          if (!loopOn(KEYS[k])) continue;
          if (seq.recording && k === seq.selTrack) continue;   // you're playing this loop by hand
          seqApplyTrack(k, r.tracks[k], now);
        }
      }
    }
  }
  if (!$('#seq').hidden) seqDraw(now);
}

/* ---------- record look changes ---------- */
function seqRecTick(p) {
  const K = KEYS[seq.selTrack], L = loops[K];
  if (!seq.running || !p.playing) { seqStopRec(true); return; }
  const t = p.t;
  if (seq.recBlock && (L.gen !== seq.recGen || t < seq.recBlock.a)) seqStopRec(true);
  if (!seq.recBlock) {
    seq.recBefore ||= seqSnap();
    seq.recGen = L.gen;
    seq.recBlock = TL.cleanBlock({ track: seq.selTrack, a: t, b: t + TL.MIN_LEN, label: '', look: JSON.parse(JSON.stringify(L.tgt)), fin: 0, fout: 0 });
    seq.recBlock.rec = true;
    seq.rec.blocks.push(seq.recBlock);
  }
  seq.recBlock.b = Math.max(seq.recBlock.a + TL.MIN_LEN, r1(t));
  // Slider moves during a look are kept: the block holds the look as it is when it ends
  if (L.gen === seq.recGen) seq.recBlock.look = { ...L.tgt };
  seq.dirty = true;
}
// Closes the block being recorded; keepGoing leaves recording on, ready for the next look
function seqStopRec(keepGoing) {
  const blk = seq.recBlock;
  if (blk) {
    delete blk.rec;
    seq.recBlock = null;
  }
  if (!keepGoing && seq.recBefore) {
    const before = seq.recBefore; seq.recBefore = null; seqCommit(before);
    if (seq.recording) seqNote('Recorded. Drag, trim or undo it like any other block.');
  }
  if (!keepGoing && seq.recording) { seq.recording = false; $('#seqRec').setAttribute('aria-pressed', 'false'); }
  seq.dirty = true;
}
$('#seqRec').addEventListener('click', () => {
  if (seq.recording) { seqStopRec(); return; }
  seq.recording = true; $('#seqRec').setAttribute('aria-pressed', 'true');
  seqNote(`Recording into track ${seq.selTrack + 1} (loop ${KEYS[seq.selTrack]}) while the sequence plays: change that loop’s look and each change becomes a new block.${seq.running ? '' : ' Press Play to start.'}`);
});

/* ---------- the track cards on the left ---------- */
const seqCards = [], seqLaneEls = [];
function seqSelectTrack(i) {
  seq.selTrack = i;
  seqCards.forEach((c, k) => c.setAttribute('aria-pressed', String(k === i)));
  $('#seqSelName').textContent = `track ${i + 1} · loop ${KEYS[i]}`;
}
for (let i = 0; i < TL.TRACKS; i++) {
  const tr = SEQ_TRACK[i], card = document.createElement('button');
  card.className = 'seq-card seq-h-lane'; card.type = 'button';
  card.innerHTML = `<span class="seq-num" style="background:${tr.color};${tr.ink ? 'color:' + tr.ink : ''}">${i + 1}</span><span class="seq-txt"><b>Loop ${KEYS[i]}</b><small></small></span>`;
  card.addEventListener('click', () => { seqSelectTrack(i); if (loopOn(KEYS[i])) setEdit(KEYS[i]); });
  seqCards.push(card); $('#seqHeads').appendChild(card);
  const lane = document.createElement('div'); lane.className = 'seq-lane seq-h-lane'; lane.dataset.track = i;
  seqLaneEls.push(lane); $('#seqLanes').appendChild(lane);
}
{ const sp = document.createElement('div'); sp.className = 'seq-h-ov'; $('#seqHeads').appendChild(sp); }
// A card says what its loop is showing now
function seqCardText() {
  seqCards.forEach((c, i) => {
    const K = KEYS[i], on = loopOn(K), small = c.querySelector('small');
    const txt = on ? `${inputName(loops[K].tgt.in1)}${seq.rec.blocks.some((b) => b.track === i) ? '' : ' · no blocks yet'}` : 'Off · a block here turns it on';
    if (small.textContent !== txt) small.textContent = txt;
    c.classList.toggle('off', !on); seqLaneEls[i].classList.toggle('off', !on);
  });
}

/* ---------- drawing the timeline ---------- */
const seqView = $('#seqView'), seqLanes = $('#seqLanes'), seqSpecCv = $('#seqSpec');
const SEQ_LUT = (() => {
  const stops = [[14, 13, 15], [67, 31, 81], [139, 26, 184], [213, 132, 245], [246, 236, 250]], lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const p = i / 255 * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(p)), u = p - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * u;
  }
  return lut;
})();
function seqFixView() {
  const v = seq.view, dur = seqDur(), fitted = Math.abs(v.pps - v.minPps) < 1e-9;
  v.minPps = v.vw / dur;
  if (fitted) v.pps = v.minPps;   // showing the whole song keeps showing all of it when its length changes v.maxPps = Math.max(v.minPps * 2, 240);
  v.pps = clamp(v.pps, v.minPps, v.maxPps); v.start = clamp(v.start, 0, Math.max(0, dur - v.vw / v.pps));
}
const seqX = (t) => (t - seq.view.start) * seq.view.pps;
function seqDrawStatic() {
  seqFixView();
  const v = seq.view, pps = v.pps, end = v.start + v.vw / pps, dur = seqDur();
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60], step = steps.find((s) => s * pps >= 64) || 60;
  const minor = step / (step >= 10 && step % 5 === 0 ? 5 : 2);
  let rh = ''; const gh = [];
  for (let t = Math.floor(v.start / minor) * minor; t <= Math.min(end, dur) + minor; t += minor) {
    const px = seqX(t); if (px < -60 || px > v.vw + 2) continue;
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    rh += `<span class="tk${major ? ' major' : ''}" style="left:${px}px"></span>`;
    if (major) { rh += `<span class="lb" style="left:${px}px">${fmtSeq(t, step < 1)}</span>`; gh.push(`<i style="left:${px}px"></i>`); }
  }
  $('#seqRuler').innerHTML = rh;
  // markers
  const marks = $('#seqMarks'); marks.textContent = '';
  for (const m of seq.rec.markers) {
    const x = seqX(m.t); if (x < -160 || x > v.vw) continue;
    const el = document.createElement('div'); el.className = 'seq-mk'; el.dataset.id = m.id;
    el.style.left = x + 'px'; el.textContent = m.name; el.title = `${m.name} · ${fmtSeq(m.t, true)} · drag to move, double-click to rename, right-click to delete`;
    marks.appendChild(el); gh.push(`<i class="m" style="left:${x}px"></i>`);
  }
  $('#seqGrid').innerHTML = gh.join('');
  // blocks
  seqLaneEls.forEach((l) => { l.textContent = ''; });
  for (const bl of seq.rec.blocks) {
    const tr = SEQ_TRACK[bl.track], w = (bl.b - bl.a) * pps, x = seqX(bl.a);
    if (x > v.vw + 4 || x + w < -4) continue;
    const el = document.createElement('div');
    el.className = 'seq-blk' + (bl.id === seq.selId ? ' sel' : '') + (bl.rec ? ' rec' : '');
    el.dataset.id = bl.id;
    el.style.left = x + 'px'; el.style.width = Math.max(3, w) + 'px';
    el.style.background = tr.fill; el.style.borderColor = tr.color;
    let html = '';
    if (bl.fin > 0) html += `<div class="fi" style="width:${bl.fin * pps}px"></div>`;
    if (bl.fout > 0) html += `<div class="fo" style="width:${bl.fout * pps}px"></div>`;
    if (bl.autos.length) {
      html += '<svg class="auto" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + bl.autos.map((au, ai) =>
        `<polyline points="${au.pts.map(([u, val]) => `${u * 100},${100 - val * 100}`).join(' ')}" fill="none" stroke="${SEQ_LINES[ai % 4]}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('') + '</svg>';
      if (bl.id === seq.selId || w > 120) bl.autos.forEach((au, ai) => {
        html += au.pts.map(([u, val], pi) => `<span class="dot" data-h="pt" data-a="${ai}" data-p="${pi}" title="${SEQ_NAME[au.key] || au.key}" style="left:${u * 100}%;top:${100 - val * 100}%;background:${SEQ_LINES[ai % 4]}"></span>`).join('');
      });
      if (w > 90) html += `<span class="atag">${bl.autos.map((au) => SEQ_NAME[au.key] || au.key).join(' · ')}</span>`;
    }
    if (w > 34) html += `<span class="t">${escapeHTML(seqName(bl))}<small>${fmtSeq(bl.a)}–${fmtSeq(bl.b)}</small></span>`;
    html += '<div class="eg l" data-h="l"></div><div class="eg r" data-h="r"></div>';
    if (w > 24) html += `<div class="fh" data-h="fin" style="left:${bl.fin * pps}px" title="Fade in ${r1(bl.fin)} s"></div><div class="fh" data-h="fout" style="left:${w - bl.fout * pps}px" title="Fade out ${r1(bl.fout)} s"></div>`;
    el.innerHTML = html;
    el.title = `${seqName(bl)} · ${fmtSeq(bl.a, true)}–${fmtSeq(bl.b, true)}`;
    seqLaneEls[bl.track].appendChild(el);
  }
  // crossfades where blocks on one track overlap
  for (let ti = 0; ti < TL.TRACKS; ti++) {
    const own = seq.rec.blocks.filter((b) => b.track === ti).sort((p, q) => p.a - q.a);
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length && own[j].a < own[i].b; j++) {
      const a = Math.max(own[i].a, own[j].a), b = Math.min(own[i].b, own[j].b);
      if (b - a <= 0.05) continue;
      const xf = document.createElement('div'); xf.className = 'seq-xf';
      xf.style.left = seqX(a) + 'px'; xf.style.width = (b - a) * pps + 'px';
      xf.title = `Crossfade ${r1(b - a)} s`;
      if ((b - a) * pps > 70) { const lb = document.createElement('span'); lb.textContent = `crossfade ${r1(b - a)} s`; xf.appendChild(lb); }
      seqLaneEls[ti].appendChild(xf);
    }
  }
  const z = pps / v.minPps;
  $('#seqZoom').textContent = `Zoom ${z < 10 ? z.toFixed(1).replace(/\.0$/, '') : Math.round(z)}× · ${fmtSeq(v.start)}–${fmtSeq(Math.min(dur, end))}`;
  $('#seqThumb').style.left = (v.start / dur * 100) + '%';
  $('#seqThumb').style.width = Math.min(100, (v.vw / pps) / dur * 100) + '%';
  seqInspector(); seqCardText();
}
function seqDrawSpec() {
  const v = seq.view, sp = seq.spec, dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(v.vw * dpr)), H = Math.max(1, Math.round(seqSpecCv.clientHeight * dpr));
  if (seqSpecCv.width !== W || seqSpecCv.height !== H) { seqSpecCv.width = W; seqSpecCv.height = H; }
  const ctx = seqSpecCv.getContext('2d'), img = ctx.createImageData(W, H), px = img.data, B = SPEC_SEQ_BANDS;
  let firstUnheard = -1;
  for (let cx = 0; cx < W; cx++) {
    const t = v.start + (cx / dpr) / v.pps, si = Math.floor(t * SPEC_SEQ_RATE), ok = sp && si >= 0 && si < sp.n, h = ok && sp.heard[si];
    if (ok && !h && firstUnheard < 0) firstUnheard = cx / dpr;
    for (let cy = 0; cy < H; cy++) {
      const o = (cy * W + cx) * 4;
      if (!h) { const s = ((cx + cy) / dpr | 0) % 8 < 1; px[o] = s ? 32 : 20; px[o + 1] = s ? 28 : 18; px[o + 2] = s ? 34 : 22; px[o + 3] = 255; continue; }
      const b = Math.min(B - 1, Math.floor((1 - cy / H) * B)), li = sp.data[si * B + b] * 3;
      px[o] = SEQ_LUT[li]; px[o + 1] = SEQ_LUT[li + 1]; px[o + 2] = SEQ_LUT[li + 2]; px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const un = $('#seqUnheard');
  un.hidden = firstUnheard < 0 || firstUnheard > v.vw - 160;
  un.style.left = Math.max(0, firstUnheard) + 'px';
}
function seqDraw(now) {
  const v = seq.view;
  // While playing, the view pages along with the playhead (unless you're dragging something)
  if (seq.playing && !seq.drag && (seq.t > v.start + v.vw / v.pps - 2 / v.pps || seq.t < v.start)) { v.start = seq.t - (v.vw / v.pps) * 0.1; seq.dirty = seq.specDirty = true; }
  if (seq.dirty) { seq.dirty = false; seqDrawStatic(); seq.specDirty = true; }
  if (seq.specDirty && now - seq.lastDraw > 250) { seq.specDirty = false; seq.lastDraw = now; seqDrawSpec(); }
  const dur = seqDur(), phx = seqX(Math.min(seq.t, dur)), ph = $('#seqPh');
  ph.style.display = phx < -2 || phx > v.vw + 2 ? 'none' : '';
  ph.style.left = phx + 'px';
  $('#seqOvMark').style.left = (Math.min(seq.t, dur) / dur * 100) + '%';
  const clock = `${fmtSeq(Math.min(seq.t, dur), true)} / ${fmtSeq(dur)}`;
  if ($('#seqClock').textContent !== clock) $('#seqClock').textContent = clock;
  if (now - (seq.cardAt || 0) > 500) { seq.cardAt = now; seqCardText(); }
}
function seqInspector() {
  const bl = seq.rec.blocks.find((b) => b.id === seq.selId), el = $('#seqInsp');
  if (!bl) { el.textContent = 'Click a block to select it. Right-click a block or an empty spot for copy, paste, change over time and delete.'; return; }
  el.innerHTML = `<b>${escapeHTML(seqName(bl))}</b><span>Track ${bl.track + 1} · loop ${KEYS[bl.track]} · ${escapeHTML(inputName(bl.look.in1))}</span><span>${fmtSeq(bl.a, true)} – ${fmtSeq(bl.b, true)} (${r1(bl.b - bl.a)} s)</span><span>Fade in ${r1(bl.fin)} s · fade out ${r1(bl.fout)} s</span>` +
    (bl.autos.length ? `<span>Changes over time: ${bl.autos.map((au, i) => `<b style="color:${SEQ_LINES[i % 4]}">${SEQ_NAME[au.key] || au.key}</b>`).join(', ')}</span>` : '<span>No changes over time · right-click to add one</span>');
}
function seqMeasure() {
  const v = seq.view, zoom = v.pps / (v.minPps || 1);
  v.vw = seqView.clientWidth || 600;
  v.minPps = v.vw / seqDur(); v.pps = v.minPps * zoom;
  seq.dirty = seq.specDirty = true; seq.lastDraw = 0;
}
new ResizeObserver(seqMeasure).observe(seqView);

/* ---------- scrolling and zooming ---------- */
seqView.addEventListener('wheel', (e) => {
  e.preventDefault();
  const v = seq.view, unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? v.vw : 1;
  const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
  if (e.shiftKey || e.ctrlKey) {
    const mx = e.clientX - seqView.getBoundingClientRect().left, at = v.start + mx / v.pps;
    v.pps = clamp(v.pps * Math.exp(-d * 0.002), v.minPps, v.maxPps); v.start = at - mx / v.pps;
  } else v.start += d / v.pps;
  seq.dirty = true;
}, { passive: false });
seqView.addEventListener('keydown', (e) => {
  const v = seq.view, k = e.key;
  if (k === 'ArrowLeft' || k === 'ArrowRight') v.start += (k === 'ArrowLeft' ? -1 : 1) * v.vw * 0.15 / v.pps;
  else if (k === '+' || k === '=' || k === '-') { const at = v.start + v.vw / 2 / v.pps; v.pps *= k === '-' ? 1 / 1.4 : 1.4; seqFixView(); v.start = at - v.vw / 2 / v.pps; }
  else return;
  e.preventDefault(); e.stopPropagation(); seq.dirty = true;
});
$('#seqFit').addEventListener('click', () => { seq.view.pps = seq.view.minPps; seq.view.start = 0; seq.dirty = true; });
{
  let ovDrag = null;
  const ov = $('#seqOv');
  ov.addEventListener('pointerdown', (e) => {
    const r = ov.getBoundingClientRect(), v = seq.view;
    if (e.target !== $('#seqThumb')) v.start = (e.clientX - r.left) / r.width * seqDur() - v.vw / v.pps / 2;
    ovDrag = { x: e.clientX, start: v.start, w: r.width }; ov.setPointerCapture(e.pointerId); seq.dirty = true;
  });
  ov.addEventListener('pointermove', (e) => { if (ovDrag) { seq.view.start = ovDrag.start + (e.clientX - ovDrag.x) / ovDrag.w * seqDur(); seq.dirty = true; } });
  ov.addEventListener('pointerup', () => { ovDrag = null; });
}

/* ---------- dragging: blocks (move, ends, fades, change-line points), markers, or the view itself ---------- */
const seqTrackAtY = (y) => clamp(Math.floor((y - seqLanes.getBoundingClientRect().top) / (seqLaneEls[0].offsetHeight + 4)), 0, TL.TRACKS - 1);
const seqBlock = (id) => seq.rec.blocks.find((b) => b.id === id);
seqView.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  seqCloseCtx();
  const blkEl = e.target.closest('.seq-blk'), mkEl = e.target.closest('.seq-mk');
  if (mkEl && e.target.tagName === 'INPUT') return;
  const d = { x: e.clientX, y: e.clientY, start: seq.view.start, moved: false, before: seqSnap() };
  if (blkEl) {
    const bl = seqBlock(blkEl.dataset.id); if (!bl || bl.rec) return;
    d.kind = e.target.dataset.h || 'move'; d.bl = bl; d.orig = JSON.parse(JSON.stringify(bl));
    if (d.kind === 'pt') { const r = blkEl.getBoundingClientRect(); d.w = r.width; d.h = r.height; d.ai = +e.target.dataset.a; d.pi = +e.target.dataset.p; }
    seq.selId = bl.id; seqSelectTrack(bl.track); seq.dirty = true;
  } else if (mkEl) {
    d.kind = 'marker'; d.m = seq.rec.markers.find((m) => m.id === mkEl.dataset.id); d.orig = { t: d.m.t };
  } else d.kind = 'pan';
  seq.drag = d;
  seqView.setPointerCapture(e.pointerId);
});
seqView.addEventListener('pointermove', (e) => {
  const d = seq.drag; if (!d) return;
  const dx = e.clientX - d.x;
  if (!d.moved && Math.abs(dx) < 4 && Math.abs(e.clientY - d.y) < 4) return;
  d.moved = true;
  const pps = seq.view.pps, dt = dx / pps, o = d.orig, bl = d.bl, dur = seqDur();
  if (d.kind === 'pan') { seqView.classList.add('dragging'); seq.view.start = d.start - dt; }
  else if (d.kind === 'marker') d.m.t = r1(clamp(o.t + dt, 0, dur));
  else if (d.kind === 'move') {
    const len = o.b - o.a; bl.a = r1(clamp(o.a + dt, 0, Math.max(0, dur - len))); bl.b = r1(bl.a + len); bl.track = seqTrackAtY(e.clientY);
  } else if (d.kind === 'l') bl.a = r1(clamp(o.a + dt, 0, o.b - TL.MIN_LEN));
  else if (d.kind === 'r') bl.b = r1(clamp(o.b + dt, o.a + TL.MIN_LEN, dur));
  else if (d.kind === 'fin') bl.fin = r1(clamp(o.fin + dt, 0, bl.b - bl.a - bl.fout));
  else if (d.kind === 'fout') bl.fout = r1(clamp(o.fout - dt, 0, bl.b - bl.a - bl.fin));
  else if (d.kind === 'pt') {
    const pts = bl.autos[d.ai].pts, [u0, v0] = o.autos[d.ai].pts[d.pi], i = d.pi;
    const lo = i === 0 ? 0 : pts[i - 1][0], hi = i === pts.length - 1 ? 1 : pts[i + 1][0];
    const u = i === 0 ? 0 : i === pts.length - 1 ? 1 : clamp(u0 + dx / d.w, lo, hi);
    pts[i] = [u, clamp(v0 - (e.clientY - d.y) / d.h, 0, 1)];
  }
  if (bl) { const len = bl.b - bl.a; bl.fin = Math.min(bl.fin, len); bl.fout = Math.min(bl.fout, len - bl.fin); }
  seq.dirty = true;
});
seqView.addEventListener('pointerup', (e) => {
  const d = seq.drag; if (!d) return;
  seq.drag = null; seqView.classList.remove('dragging');
  if (d.kind === 'pan' && !d.moved) {
    seq.selId = null; seq.dirty = true;
    seqSeek(seq.view.start + (e.clientX - seqView.getBoundingClientRect().left) / seq.view.pps);
  } else if (d.moved && d.kind !== 'pan') {
    if (d.bl) { seq.rec.blocks = seq.rec.blocks.map((b) => (b === d.bl ? TL.cleanBlock(b) : b)); seq.selId = d.bl.id; seqSelectTrack(d.bl.track); }
    seqCommit(d.before);
  }
});
seqView.addEventListener('pointercancel', () => { const d = seq.drag; if (d && d.kind !== 'pan') { seqRestore(d.before); seq.dirty = true; } seq.drag = null; });
// Double-click a block to add a point to its newest change line; a marker to rename it
seqView.addEventListener('dblclick', (e) => {
  const mkEl = e.target.closest('.seq-mk');
  if (mkEl) { seqRenameMarker(mkEl); return; }
  const el = e.target.closest('.seq-blk'); if (!el || e.target.dataset.h) return;
  const bl = seqBlock(el.dataset.id); if (!bl) return;
  if (!bl.autos.length) { seqNote('Right-click the block and pick Change over time first.'); return; }
  const r = el.getBoundingClientRect(), u = clamp((e.clientX - r.left) / r.width, 0.01, 0.99), val = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
  const au = bl.autos[bl.autos.length - 1];
  seqChange(() => { au.pts.push([u, val]); au.pts.sort((p, q) => p[0] - q[0]); });
  seqNote(`Added a point to ${SEQ_NAME[au.key] || au.key}. Drag it to set the value.`);
});
function seqRenameMarker(el) {
  const m = seq.rec.markers.find((x) => x.id === el.dataset.id); if (!m) return;
  const before = seqSnap(), inp = document.createElement('input');
  el.textContent = ''; inp.value = m.name; inp.maxLength = 40; inp.setAttribute('aria-label', 'Marker name');
  el.appendChild(inp); inp.focus(); inp.select();
  inp.addEventListener('keydown', (k) => { if (k.key === 'Enter') inp.blur(); if (k.key === 'Escape') { inp.value = m.name; inp.blur(); } k.stopPropagation(); });
  inp.addEventListener('blur', () => { if (inp.value.trim()) m.name = inp.value.trim().slice(0, 40); seqCommit(before); }, { once: true });
}

/* ---------- right-click menu ---------- */
const seqCtx = document.createElement('div');
seqCtx.className = 'seq-menu fixed'; seqCtx.setAttribute('role', 'menu'); seqCtx.hidden = true;
document.body.appendChild(seqCtx);
function seqCloseCtx() { seqCtx.hidden = true; }
function seqPlaceCtx(x, y) {
  seqCtx.hidden = false;
  const r = seqCtx.getBoundingClientRect();
  seqCtx.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  seqCtx.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  seqCtx.querySelector('button:not(:disabled)')?.focus();
}
function seqOpenCtx(x, y, items) {
  seqCtx.innerHTML = '';
  for (const it of items) {
    if (it === '-') { seqCtx.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.innerHTML = `<span>${escapeHTML(it.label)}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}`; b.disabled = !!it.disabled;
    b.addEventListener('click', () => { seqCloseCtx(); it.run(); });
    seqCtx.appendChild(b);
  }
  seqPlaceCtx(x, y);
}
// A small name box in the menu's place, for Rename and Save to My presets
function seqAsk(x, y, title, value, placeholder, done) {
  seqCtx.innerHTML = '';
  const form = document.createElement('form'); form.className = 'seq-ask';
  form.innerHTML = `<label class="mh" for="seqAskIn">${escapeHTML(title)}</label><input class="seq-in" id="seqAskIn" type="text" maxlength="40" autocomplete="off" spellcheck="false"><div class="seq-grp"><button class="btn small" type="submit">Save</button><button class="btn small" type="button">Cancel</button></div>`;
  const inp = form.querySelector('input'); inp.value = value; inp.placeholder = placeholder;
  form.addEventListener('submit', (ev) => { ev.preventDefault(); seqCloseCtx(); done(inp.value.trim().slice(0, 40)); });
  form.querySelector('button[type=button]').addEventListener('click', seqCloseCtx);
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); seqCloseCtx(); } ev.stopPropagation(); });
  seqCtx.appendChild(form); seqPlaceCtx(x, y); inp.focus(); inp.select();
}
// A block's look joins My presets, as a one-loop look (it loads onto loop A, like any preset made from one loop)
function seqSaveLook(bl, name) {
  const data = { v: 1, A: JSON.parse(JSON.stringify(bl.look)),
    mix: { view: 0, xab: 0, xba: 0, showA: 100, showB: 0 }, grade: { ...GRADE_DEF } };
  const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) { existing.data = data; existing.saved = Date.now(); }
  else presets.push({ id: 'p' + Date.now().toString(36) + randId(4), name, thumb: '', data, saved: Date.now() });
  if (presets.length > 60) presets = presets.slice(-60);
  const ok = writePresets();
  renderPresets();
  if (!bl.label) seqChange(() => { bl.label = name; });
  seqNote(!ok && storageOK ? 'Couldn’t save: this browser’s storage for the page is full. Delete a few presets and try again.'
    : existing ? `Updated “${name}” in My presets.` : `Saved “${name}” to My presets. Add saved look can place it on any track.`);
}
function seqCopy(bl) { seq.clip = JSON.parse(JSON.stringify(bl)); seqNote(`Copied “${seqName(bl)}”. Paste puts a copy at the playhead, or right-click a spot to paste there.`); }
function seqPaste(track, t) {
  if (!seq.clip) return;
  const len = seq.clip.b - seq.clip.a, dur = seqDur(), a = r1(clamp(t, 0, Math.max(0, dur - Math.min(len, dur))));
  const nb = TL.cleanBlock({ ...JSON.parse(JSON.stringify(seq.clip)), id: TL.id(), track, a, b: Math.min(dur, a + len) });
  seqChange(() => seq.rec.blocks.push(nb)); seq.selId = nb.id;
  seqNote(`Pasted “${seqName(nb)}” on track ${track + 1} at ${fmtSeq(a, true)}.`);
}
function seqDelete(bl) {
  seqChange(() => { seq.rec.blocks = seq.rec.blocks.filter((b) => b.id !== bl.id); });
  seq.selId = null; seqNote(`Deleted “${seqName(bl)}”. Undo brings it back.`);
}
function seqPickSlider(bl, x, y) {
  seqCtx.innerHTML = '';
  for (const [group, list] of SEQ_SLIDERS) {
    const h = document.createElement('div'); h.className = 'mh'; h.textContent = group; seqCtx.appendChild(h);
    for (const [key, name] of list) {
      const has = bl.autos.find((au) => au.key === key);
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitemcheckbox'); b.setAttribute('aria-checked', String(!!has)); b.textContent = name;
      b.addEventListener('click', () => {
        seqCloseCtx();
        seqChange(() => {
          if (has) bl.autos = bl.autos.filter((au) => au !== has);
          else {
            // The line starts at the block's own value for that slider
            const [lo, hi] = seqRange(key), cur = key === 'show' ? 100 : key === 'feed' ? 0 : key in GRADE_DEF ? GRADE_DEF[key] : bl.look[key] ?? loopDefaults()[key] ?? lo;
            const v = clamp((cur - lo) / ((hi - lo) || 1), 0, 1);
            bl.autos.push({ key, pts: [[0, v], [1, v]] });
          }
        });
        seqNote(has ? `${name} no longer changes in “${seqName(bl)}”.` : `${name} now changes over “${seqName(bl)}”. Drag the dots to shape it, double-click the block to add a point.`);
      });
      seqCtx.appendChild(b);
    }
  }
  seqPlaceCtx(x, y);
}
seqView.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const blkEl = e.target.closest('.seq-blk'), laneEl = e.target.closest('.seq-lane'), mkEl = e.target.closest('.seq-mk');
  const t = seq.view.start + (e.clientX - seqView.getBoundingClientRect().left) / seq.view.pps;
  if (mkEl) {
    const m = seq.rec.markers.find((x) => x.id === mkEl.dataset.id); if (!m) return;
    seqOpenCtx(e.clientX, e.clientY, [
      { label: 'Rename', run: () => seqRenameMarker(mkEl) },
      { label: 'Delete marker', run: () => seqChange(() => { seq.rec.markers = seq.rec.markers.filter((x) => x !== m); }) },
    ]);
  } else if (blkEl) {
    const bl = seqBlock(blkEl.dataset.id); if (!bl) return;
    seq.selId = bl.id; seqSelectTrack(bl.track); seq.dirty = true;
    seqOpenCtx(e.clientX, e.clientY, [
      { label: 'Copy', key: 'Ctrl+C', run: () => seqCopy(bl) },
      { label: 'Paste here', key: 'Ctrl+V', disabled: !seq.clip, run: () => seqPaste(bl.track, t) },
      '-',
      { label: 'Rename…', run: () => seqAsk(e.clientX, e.clientY, 'Name this block', bl.label || '', seqName(bl), (name) => {
        seqChange(() => { bl.label = name; }); seqNote(name ? `Renamed to “${name}”.` : 'Name cleared; the block shows what its loop shows.');
      }) },
      { label: 'Save to My presets…', run: () => seqAsk(e.clientX, e.clientY, 'Save this look as', bl.label || '', nextPresetName(), (name) => seqSaveLook(bl, name || nextPresetName())) },
      '-',
      { label: `Change over time…${bl.autos.length ? ` (${bl.autos.length})` : ''}`, run: () => seqPickSlider(bl, e.clientX, e.clientY) },
      '-',
      { label: 'Delete', key: 'Del', run: () => seqDelete(bl) },
    ]);
  } else if (laneEl) {
    const track = +laneEl.dataset.track; seqSelectTrack(track);
    seqOpenCtx(e.clientX, e.clientY, [{ label: seq.clip ? `Paste “${seqName(seq.clip)}” here` : 'Paste here (copy a block first)', key: 'Ctrl+V', disabled: !seq.clip, run: () => seqPaste(track, t) }]);
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!seqCtx.hidden && !seqCtx.contains(e.target)) seqCloseCtx();
  if (!e.target.closest('.seq-menuwrap')) seqCloseMenus();
});
seqCtx.addEventListener('keydown', (e) => { if (e.key === 'Escape') { seqCloseCtx(); seqView.focus(); } });

/* ---------- keys while the sequencer is open ---------- */
document.addEventListener('keydown', (e) => {
  if ($('#seq').hidden || e.target.closest?.('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), bl = seqBlock(seq.selId);
  if (k === 'escape') { seqCloseCtx(); seqCloseMenus(); return; }
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) seqRedo(); else seqUndo(); }
  else if (mod && k === 'y') { e.preventDefault(); seqRedo(); }
  else if (mod && k === 'c' && bl && !getSelection()?.toString()) { e.preventDefault(); seqCopy(bl); }
  else if (mod && k === 'v' && seq.clip) { e.preventDefault(); seqPaste(seq.selTrack, seq.t); }
  else if ((k === 'delete' || k === 'backspace') && bl) { e.preventDefault(); seqDelete(bl); }
  else if (!mod && !e.altKey && k === 'm') { e.preventDefault(); seqAddMarker(); }
});

/* ---------- adding looks, markers ---------- */
function seqPlace(label, look) {
  const dur = seqDur(), a = r1(clamp(seq.t, 0, dur)), b = r1(Math.min(dur, a + 16));
  if (b - a < TL.MIN_LEN) { seqNote('Move the playhead before the end of the song first.'); return; }
  const nb = TL.cleanBlock({ track: seq.selTrack, a, b, label, look: JSON.parse(JSON.stringify(look)) });
  seqChange(() => seq.rec.blocks.push(nb)); seq.selId = nb.id;
  seqNote(`Added “${seqName(nb)}” to track ${seq.selTrack + 1} at ${fmtSeq(a, true)}. Drag its ends to change how long it plays.`);
}
$('#seqAddCurrent').addEventListener('click', () => {
  const K = KEYS[seq.selTrack];
  seqPlace('', loopOn(K) ? loops[K].tgt : loops[edit].tgt);
});
function seqAddMarker() {
  const m = { id: TL.id(), t: r1(clamp(seq.t, 0, seqDur())), name: `Marker ${seq.rec.markers.length + 1}` };
  seqChange(() => seq.rec.markers.push(m)); seqNote(`Marker added at ${fmtSeq(m.t, true)}. Double-click it to rename.`);
}
$('#seqMarker').addEventListener('click', seqAddMarker);

// Drop-down menus: Add saved look, Load sequence
const seqMenus = [[$('#seqAddSaved'), $('#seqSavedMenu')], [$('#seqLoad'), $('#seqLoadMenu')]];
function seqCloseMenus() { seqMenus.forEach(([b, m]) => { m.hidden = true; b.setAttribute('aria-expanded', 'false'); }); }
function seqMenuItem(menu, label, run) {
  const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = label;
  b.addEventListener('click', () => { seqCloseMenus(); run(); });
  menu.appendChild(b);
}
function seqBuildSaved(menu) {
  menu.innerHTML = '';
  const K = KEYS[seq.selTrack];
  const lists = [['My presets', presets], ['Shared presets', shared]];
  let any = false;
  for (const [title, list] of lists) {
    if (!list?.length) continue;
    const h = document.createElement('div'); h.className = 'mh'; h.textContent = title; menu.appendChild(h);
    for (const p of list) {
      const look = p.data?.[K] || p.data?.A; if (!look) continue;
      any = true; seqMenuItem(menu, p.name, () => seqPlace(p.name, look));
    }
  }
  if (!any) { const h = document.createElement('div'); h.className = 'mh'; h.textContent = 'No saved looks yet. Save one under My presets.'; menu.appendChild(h); }
}
function seqBuildLoad(menu) {
  menu.innerHTML = '<div class="mh">Versions of this song</div>';
  if (!seq.rec.versions.length) { const h = document.createElement('div'); h.className = 'mh'; h.textContent = 'None yet. Save sequence keeps one.'; menu.appendChild(h); }
  for (const ver of seq.rec.versions) seqMenuItem(menu, ver.name, () => seqLoadVersion(ver));
  // Another song's sequence can be loaded too; it is cut off at this song's end
  const others = [...seq.records].filter(([k, r]) => k !== seq.key && r.blocks.length);
  if (others.length) {
    const h = document.createElement('div'); h.className = 'mh'; h.textContent = 'Other songs'; menu.appendChild(h);
    for (const [, r] of others.slice(0, 30)) seqMenuItem(menu, r.title || 'Another song', () => seqLoadVersion({ name: r.title || 'another song', blocks: r.blocks, markers: r.markers }));
  }
}
seqMenus.forEach(([btn, menu]) => {
  btn.addEventListener('click', () => {
    const open = menu.hidden; seqCloseMenus();
    if (!open) return;
    if (menu.id === 'seqLoadMenu') seqBuildLoad(menu); else seqBuildSaved(menu);
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); menu.querySelector('button')?.focus();
  });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { seqCloseMenus(); btn.focus(); } });
});

/* ---------- save / load versions of this song's sequence ---------- */
$('#seqSave').addEventListener('click', () => {
  $('#seqSaveForm').hidden = false;
  $('#seqSaveName').value = `Version ${seq.rec.versions.length + 1}`;
  $('#seqSaveName').focus(); $('#seqSaveName').select();
});
$('#seqSaveCancel').addEventListener('click', () => { $('#seqSaveForm').hidden = true; $('#seqSave').focus(); });
$('#seqSaveName').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); $('#seqSaveCancel').click(); } });
$('#seqSaveForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#seqSaveName').value.trim().slice(0, 60) || `Version ${seq.rec.versions.length + 1}`;
  const i = seq.rec.versions.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
  const entry = { name, saved: Date.now(), ...JSON.parse(seqSnap()) };
  if (i >= 0) seq.rec.versions[i] = entry;
  else { seq.rec.versions.unshift(entry); seq.rec.versions.length = Math.min(seq.rec.versions.length, TL.MAX_VERSIONS); }
  seqSave(); $('#seqSaveForm').hidden = true;
  seqNote(`Saved “${name}” as a version of this song.${i >= 0 ? ' It replaced the older one with that name.' : ' Load sequence brings it back.'}`);
});
function seqLoadVersion(ver) {
  const fresh = TL.cutToLength(TL.normalize({ blocks: ver.blocks, markers: ver.markers }), seqDur());
  seqChange(() => {
    seq.rec.blocks = fresh.blocks.map((b) => ({ ...b, id: TL.id() }));
    seq.rec.markers = fresh.markers.map((m) => ({ ...m, id: TL.id() }));
  });
  seq.selId = null; seq.applied = [null, null, null, null];
  seqNote(`Loaded “${ver.name}”.${fresh.cut ? ` ${fresh.cut} block${fresh.cut > 1 ? 's were' : ' was'} cut off at the end of the song.` : ''} Undo goes back to what you had.`);
}

/* ---------- show / hide ---------- */
function seqSetOpen(open, save) {
  $('#seq').hidden = !open;
  $('#seqBtn').setAttribute('aria-pressed', String(open));
  if (open) { seqMeasure(); seqDraw(performance.now()); } else { seqCloseCtx(); seqCloseMenus(); }
  if (save) lsSet(SEQ_OPEN_KEY, open ? '1' : '0');
  // The picture gives up some height for the panel
  window.dispatchEvent(new Event('resize'));
}
$('#seqBtn').addEventListener('click', () => seqSetOpen($('#seq').hidden, true));
$('#seqHide').addEventListener('click', () => { seqSetOpen(false, true); $('#seqBtn').focus(); });

/* ---------- Spotify: which song is playing ---------- */
function spotifySongChanged(snapshot) {
  const previous = seq.lastPlayback;
  seq.lastPlayback = snapshot;
  if (!snapshot.track) return;
  const key = JSON.stringify([snapshot.accountId, snapshot.track.uri]);
  if (seq.key !== key) {
    const wasRunning = seq.running || seq.apMode === 'empty';
    if (seq.apMode === 'empty') { seq.apMode = null; }
    seqLoadSong(key, snapshot.track);
    seq.rec.title = `${snapshot.track.name} — ${snapshot.track.artists.join(', ')}`;
    // A song with a sequence starts it by itself; a song with none runs Autopilot
    if (seq.rec.blocks.length) seqRun(true, 'This song has a sequence; it’s playing.');
    else if (wasRunning || ap.on || !previous) { seqRun(false); seq.apMode = 'empty'; setAutopilot(true, true); seqNote('No sequence for this song yet, so Autopilot is running. Add looks to start one.'); }
  } else if (previous?.track && Math.abs(snapshot.progressMs - (previous.progressMs + (previous.playing ? snapshot.receivedAt - previous.receivedAt : 0))) > 1200) {
    seq.applied = [null, null, null, null];
  }
}
$('#spotifyClientId').value = spotify.clientId;
$('#spotifyRedirect').textContent = location.protocol === 'file:' ? 'http://127.0.0.1:8000/' : PhosphorSpotify.redirectUri();
$('#spotifyConnect').addEventListener('click', async () => {
  try { await spotify.connect($('#spotifyClientId').value); }
  catch (error) { $('#spotifyStatus').textContent = error.message; }
});
$('#spotifyDisconnect').addEventListener('click', () => spotify.disconnect());
spotify.addEventListener('status', e => {
  $('#spotifyStatus').textContent = e.detail.message;
  $('#spotifyDisconnect').disabled = !e.detail.connected;
});
spotify.addEventListener('playback', e => {
  const snapshot = e.detail;
  $('#spotifyNow').textContent = snapshot.track ? `Now: ${snapshot.track.name} — ${snapshot.track.artists.join(', ')}` : 'Now: No active music track';
  spotifySongChanged(snapshot);
});
spotify.addEventListener('queue', e => {
  const queue = e.detail, list = $('#spotifyQueue'); list.textContent = '';
  $('#spotifyNext').textContent = queue.length ? `Next: ${queue[0].name} — ${queue[0].artists.join(', ')}` : 'Next: No queued track available';
  for (const track of queue.slice(1)) {
    const item = document.createElement('li'); item.textContent = `${track.name} — ${track.artists.join(', ')}`; list.appendChild(item);
  }
});
spotify.addEventListener('disconnect', () => {
  seqRun(false); seq.lastPlayback = null; if (seq.apMode === 'empty') seq.apMode = null;
  seqLoadSong('standalone', null); $('#spotifyNow').textContent = 'Now: —';
  seqNote('Spotify disconnected. The sequencer runs on its own clock now.');
});
async function initSpotify() {
  try { await spotify.finishLogin(); if (spotify.token) spotify.start(); }
  catch (error) { $('#spotifyStatus').textContent = error.message; }
}
addEventListener('pagehide', () => seqSpecStore(true));

seqLoadSong('standalone', null);
seqSelectTrack(0);
seqSetOpen(lsGet(SEQ_OPEN_KEY) === '1', false);
void initSpotify();


let captureNextAt = 0;
function frame() {
  const now = performance.now();   // this page's clock, even when the output window drives the frames
  const captureFps = capCfg()?.fps;
  if (captureFps) {
    if (now < captureNextAt - 1) { requestAnimationFrame(frame); return; }
    captureNextAt = Math.max(captureNextAt + 1000 / captureFps, now);
  }
  const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
  last = now;
  sharpTick(now);
  const k = 1 - Math.exp(-dt * 5);
  // Autopilot glides over its Fade time (about 10 seconds unless changed), or fast when a look cuts in on a beat.
  // Pinned settings answer their sliders straight away.
  const glide = now < ap.quick ? 4 : 3 / apFadeSec();
  const kLoop = ap.on ? 1 - Math.exp(-dt * glide) : k;
  const kMix = ap.on ? 1 - Math.exp(-dt * glide * 0.73) : k;
  if (ap.on && !frozen) rampTick(now);
  for (const key of activeKeys()) {
    const L = loops[key];
    // A loop that's yours always answers its sliders at the hand-moved pace
    const kl = apRuns(key) ? kLoop : k;
    for (const p of LOOP_SMOOTH) L.cur[p] += (L.tgt[p] - L.cur[p]) * (pinned(p, key) || ramping(p, key) ? k : kl);
  }
  for (const p of MIX_SLIDERS) {
    const own = !apOwnsMix(p);
    mix.cur[p] += (mix.tgt[p] - mix.cur[p]) * (own || pinned(pinKeyOf(p)) || rampingMix(p) ? k : kMix);
  }
  if (ap.on && !frozen && now >= ap.next) apTick(now);
  followSliders();
  if (lookOnScreen !== ratedLook) syncRated();
  if (!frozen) simT += dt;
  staticAmt = Math.max(0, staticAmt - dt * 3);

  for (const [name, s] of Object.entries(LIVE_SRC)) if (s.video && uses(name)) s.update(subjectModes(name));
  syncSubjectStatus();
  vcrTick();
  packAdj();
  analyzeSound(dt, now);
  drawMeter();
  seqTick(now);
  shapesTick(now, dt);
  if (!frozen) writeSpec(dt);
  // The 3D flights fly on, surging forward on the kick, and their lights flare on the beat
  if (Object.keys(SCENES).some(uses)) {
    const pace = reduceMotion ? 0.45 : 1;
    let surge = 1, glow = 1;
    // Only a scene shown by a loop that reacts surges with the music
    const sceneReacts = (name) => activeKeys().some((k) => reacts(k) && (loops[k].tgt.in1 === name || loops[k].tgt.in2 === name));
    if (snd.analyser && Object.keys(SCENES).some(sceneReacts)) {
      const a = sndPower(), E = snd.env, m = snd.map;
      if (m.kick) surge *= 1 + a * (E.low * 1.2 + E.beat * 2.5);
      if (m.flash) glow += a * (E.beat * 0.35 + E.low * 0.2);
    }
    for (const name of Object.keys(SCENES)) {
      const sc = SCENES[name];
      if (frozen || !uses(name)) continue;
      const step = dt * sc.speed * pace * (1 + (sceneReacts(name) ? surge - 1 : 0) * (sc.kick ?? 1));
      sc.z = (sc.z + step) % sc.period;
      // A fractal's wandering cameras fly on, each loop's only while that loop shows it
      if (sc.fly) for (const k of activeKeys()) if (loops[k].tgt.in1 === name || loops[k].tgt.in2 === name) droneOf(sc, k).fly(step, { style: 'glide', drive: 0 });
      // Mount Ribbit's hikers walk on, the same way
      if (sc.ext) {
        const drive = ribDriven(), ctl = ribControls();
        for (const k of activeKeys()) if (loops[k].tgt.in1 === name || loops[k].tgt.in2 === name) sc.ext.step(k, dt, dt > 0 ? step / dt : 1, k === drive ? ctl : null, rib.auto);
      }
    }
    sceneGlow = glow;
  }

  const W = {};
  for (const key of KEYS) W[key] = wOf(mix.cur, key);
  const wA = W.A, wB = W.B;
  const f = dt * 60;
  if (!frozen) {
    shapeSw = shapes.packSwallow(f);
    let brush = null;
    if (drawing && pCur) { brush = [pPrev, pCur]; pPrev = pCur; }
    // A hidden loop also runs while Check each look is trying a look out on it, and while a loop that's running
    // is fed from it or reads it (as an input, or to be pushed or dyed by it)
    const trying = ap.prep ? ap.prep.k : null;
    const act = activeKeys(), need = {};
    for (const key of act) need[key] = W[key] > 0.001 || trying === key;
    for (let pass = 0; pass < 2; pass++) for (const key of act) {
      if (!need[key]) continue;
      const o = otherLoop(key);
      if (loopOn(o) && (clamp(mix.cur[FEED_INTO[key]], 0, 100) > 0.1 || readsOther(key))) need[o] = true;
    }
    for (const key of act) mirrorStep(key, dt);
    for (const key of act) if (need[key]) runLoop(key, clamp(mix.cur[FEED_INTO[key]], 0, 100) / 100, W[key] > 0.01 ? brush : null, f);
  }

  for (const key of KEYS) finalPass(key);
  gl.bindFramebuffer(gl.FRAMEBUFFER, comp.fbo);
  gl.viewport(0, 0, simW, simH);
  gl.useProgram(compProg.p);
  for (const key of KEYS) {
    gl.activeTexture(gl.TEXTURE0 + LOOP_NUM[key]);
    gl.bindTexture(gl.TEXTURE_2D, loops[key].rt && loopOn(key) ? mixTex(key) : shownTex('A'));
  }
  set2f(compProg, 'uSim', simW, simH);
  set1f(compProg, 'uWA', wA);
  set1f(compProg, 'uWB', wB);
  set1f(compProg, 'uWC', W.C);
  set1f(compProg, 'uWD', W.D);
  for (const k of KEYS) {
    const g = loopGrade[k] ? { ...GRADE_DEF, ...loopGrade[k] } : null;
    set3f(compProg, 'uGC' + k, g ? g.gHue * Math.PI / 180 : 0, g ? g.gSepia / 100 : 0, g ? 1 : 0);
    if (!g) continue;
    set4f(compProg, 'uGT' + k, g.gExposure / 10, g.gContrast / 100, Math.max(0.05, g.gGamma / 100), g.gSat / 100);
    set3f(compProg, 'uGR' + k, g.gRed / 100, g.gGreen / 100, g.gBlue / 100);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  eyeTick(now, dt, wA, wB);
  const shown = drawShapes(now) || comp;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(dispProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shown.tex);
  set2f(dispProg, 'uRes', canvas.width, canvas.height);
  set1f(dispProg, 'uTime', (now - t0) / 1000);
  set1f(dispProg, 'uStatic', staticAmt);
  // Hits from the music that show at once, on top of what they do inside the loops
  let punch = 0, flash = 0, hueKick = 0, shake = 0;
  // As strong as the share of the picture on screen that comes from loops that react
  let wAll = 0, wReact = 0;
  for (const key of activeKeys()) { wAll += W[key]; if (reacts(key)) wReact += W[key]; }
  const share = wAll > 0 ? wReact / wAll : 0;
  if (snd.analyser && share > 0) {
    const a = sndPower() * share, E = snd.env, m = snd.map, calm = reduceMotion ? 0.4 : 1;
    if (m.kick) punch = a * (E.beat * 0.06 + E.low * 0.025) * calm;
    if (m.flash) flash = a * E.beat * 0.3;
    if (m.color) hueKick = a * (E.high * 0.35 + E.beat * 0.3) * (snd.beats % 2 ? 1 : -1);
    if (m.warp) shake = a * E.beat * calm;
  }
  set1f(dispProg, 'uPunch', punch);
  set1f(dispProg, 'uFlash', flash);
  set1f(dispProg, 'uHueKick', hueKick);
  set2f(dispProg, 'uShake', snd.shakeDir[0] * shake, snd.shakeDir[1] * shake);
  set1f(dispProg, 'uLines', clamp(Math.floor(canvas.height / 2.6), 120, 288));
  setGradeUniforms();
  setReliefUniforms(now);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (window.__phosphorCapture?.onFrame) window.__phosphorCapture.onFrame(now);
  if (snapPending) {
    snapPending = false;
    canvas.toBlob((blob) => { if (blob) offerFile(`phosphor-loop-${stamp()}.png`, blob); }, 'image/png');
  }
  if (thumbReq) {
    const done = thumbReq;
    thumbReq = null;
    try {
      const c = document.createElement('canvas');
      c.width = 160; c.height = Math.max(40, Math.round(160 / simAspect));
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
      done(c.toDataURL('image/jpeg', 0.72));
    } catch (_) { done(''); }
  }
  if (outCtx) {
    if (!outWin || outWin.closed) closeOutput(true);
    else { try { outCtx.drawImage(canvas, 0, 0, outCanvas.width, outCanvas.height); } catch (_) {} }
  }
  updateTC(now);
  // If this window is covered or minimized while the output window is showing, let that window keep the beat
  if (outputOpen() && document.hidden) outWin.requestAnimationFrame(frame);
  else requestAnimationFrame(frame);
}

/* ================= start ================= */
applyPatch(STARTERS[reduceMotion ? Math.max(0, STARTERS.findIndex((c) => c.name === 'Calm')) : 0]);
for (const key of KEYS) Object.assign(loops[key].cur, loops[key].tgt);
Object.assign(mix.cur, mix.tgt);
setEdit('A');
// Autopilot's eye is made now, with everything else, so starting Autopilot never waits for it
eyeSetup();
requestAnimationFrame(frame);
showStart();
// Available only in the isolated local capture session; ordinary site behavior is unchanged.
if (window.__phosphorCaptureConfig) window.__phosphorCapture = {
  canvas,
  get renderSize() { return {width:simW,height:simH}; },
  listen(stream) {
    ++soundRequest;
    stopSound();
    const track = stream.getAudioTracks()[0], settings = track.getSettings();
    snd.src = LOOPBACK.test(track.label) ? 'loopback' : 'mic';
    if (snd.src === 'loopback') loopbackDeviceId = settings.deviceId || '';
    else micDeviceId = settings.deviceId || '';
    listen(stream);
    syncSoundUI();
    sndSay(`<span class="live"></span><b>Listening for the stream</b> through ${escapeHTML(track.label)}.`);
    listMics();
  },
  stopSound,
  autopilot() { setAutopilot(true); },
};
})();
