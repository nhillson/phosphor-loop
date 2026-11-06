(() => {
'use strict';
const { FR, makeDrone } = window.PhosphorFractals;
const { VS, FS_LIFE, FS_COPY, FS_PROBE, FS_EYE, COMMON, FS_FEEDBACK, FS_COMPOSITE, FS_FINAL, FS_TIMEWARP, FS_SLIT, FS_SCAN, FS_DISPLAY, FS_CUBES, FS_HORIZON, FS_CAVERN, FS_BLACKHOLE, FS_AURORA, FS_MERCURY, FS_FRACTAL, FS_NEBULA, FS_CITY, FS_TERRAIN, FS_SPONGE, FS_BULB, FS_MANDELBOX, FS_SIERPINSKI, FS_JULIA, FS_KALEIDO } = window.PhosphorShaders;
const { clamp, rnd, pick, hsv, foldJS, stamp, randId, loadScript } = window.PhosphorHelpers;
const { addWebmDuration, standardMp4 } = window.PhosphorRecording;

/* ================= constants ================= */
// Standard sharpness: the loops are drawn 576 lines high, as Phosphor Loop always has been. Picture sharpness
// (under Screen) can draw more lines, up to the screen's own (see wantLines). Local streaming can request a
// fixed number of lines instead.
const SIM_H = 576;
// The stream app's capture mode: the size and speed it streams at. The app can switch it off ("Streaming?" Off),
// and then the page draws like an ordinary browser window, at the size Picture sharpness picks.
// A recording of the settings playing back, or a look being recorded (see "recorded moves"); set first, since the
// drawing size, Autopilot and presets check it
const MV = { play: null, applying: false, size: null };
// The size the picture is drawn at, when something other than the screen sets it: Phosphor Stream (its capture
// config), or a look being recorded with Save clip (MV.size, so the saved video is sharp, not the size of the
// preview on this page)
function capCfg() { const c = window.__phosphorCaptureConfig; return c && !c.off ? c : MV.size || null; }
let simW = 768, simH = capCfg()?.renderHeight || SIM_H, simAspect = simW / simH;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
// Not part of a Spread out column's copy of a loop's settings (see "a column per loop")
const notCopy = (el) => !el.closest('.loop-col');

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

const SRC_ID = { wave: 0, shape: 1, bars: 2, sparks: 3, picture: 4, genart: 4, video: 5, camera: 6, screen: 7, phone: 8, none: 9, loop: 10, ink: 11, patchwork: 12, cubes: 13, horizon: 14, cavern: 15,
                 blackhole: 16, aurora: 17, mercury: 18, fractal: 19, nebula: 21, spectro: 22, city: 23, text: 24,
                 sponge: 25, mandelbulb: 26, mandelbox: 27, sierpinski: 28, julia3d: 29, kaleido: 30, ribbit: 31, terrain: 32, topo: 33, life: 34, radar: 35, texture: 36 };
const SRC_LABEL = { wave: 'Wave', shape: 'Shape', bars: 'Bars', sparks: 'Sparks', ink: 'Ink', patchwork: 'Patchwork', text: 'Text', cubes: 'Cubes', horizon: 'Horizon', cavern: 'Cavern', spectro: 'Spectrograph', city: 'City',
                    blackhole: 'Black hole', aurora: 'Aurora', mercury: 'Mercury', fractal: 'Fractal', nebula: 'Nebula', ribbit: 'Mount Ribbit', terrain: 'Terrain', topo: 'Topo map', life: 'Life', radar: 'Doppler radar', texture: 'Textures',
                    sponge: 'Menger sponge', mandelbulb: 'Mandelbulb', mandelbox: 'Mandelbox', sierpinski: 'Sierpinski', julia3d: 'Julia', kaleido: 'Kaleidoscope', picture: 'Picture', genart: 'Generative art', video: 'Video', camera: 'Camera', screen: 'Screen', phone: 'Phone', none: 'Nothing', loop: 'Other loop' };
const LIVE = ['video', 'camera', 'screen', 'phone', 'loop'];   // inputs that can use Only movement
const SOFT_SRC = [...LIVE, 'genart', 'texture'];   // inputs Soft trails works on (moving pictures that would pile up into white)
const DEVICE = ['camera', 'screen', 'phone'];

function loopDefaults() {
  return { subject: 'off', in1: 'wave', in2: 'none', blend: 50, size: 100, motion: false, soft: true, form: 3, specRound: false, topoPic: false, lifeCells: 1, lifeSpeed: 1, lifeLoop: false, radarWind: false, texStyle: 0,
           zoom: 0, spin: 0, trails: 88, color: 10, poster: 0, posterIn: false, halftone: 0, halftoneFinal: true, mirrorFinal: false, warpFinal: false, splitFinal: false, chromaFinal: false, warp: 0, flow: 0, melt: 0, push: 0, dye: 0, split: 0, mirror: 0, mirrorFx: 'melt', mirrorSpin: false, blur: 0, edge: 0, shiftX: 0, shiftY: 0, gain: 1,
           grow: 0, growSize: 1, time: 0, timeShape: 0, cam: 'glide',
           lookup: 0, chase: 0, breathe: 0, chroma: 0, restless: 0, julia: 0, crystal: 0,
           offc: 0, wind: 0, windDir: 0, scan: 0, scanSpeed: 1, corr: 0, corrShape: 0 };
}
// Posterize: how many steps each color is snapped to, from 16 just past Off down to 2 at the top of the slider
const posterSteps = (v) => 16 * Math.pow(2 / 16, clamp(v, 0, 100) / 100);
// Halftone's slider: how far apart its dots are, in Standard-size pixels (3 to 24)
const halftoneCell = (v) => 3 + 21 * clamp(v, 0, 100) / 100;
// The sliders under Effects › Feeds on itself
// Time warp's ways across the picture (FS_TIMEWARP's uShape)
const TIME_SHAPES = 7;
const SELF = ['lookup', 'chase', 'breathe', 'chroma', 'restless', 'julia', 'crystal'];
// The sliders under Effects › Lopsided: Off-center and Wind, which break the picture's symmetry
const ASYM = ['offc', 'wind'];
// The sliders under Effects › Slit-scan: Photo finish and Corridor
const SLIT = ['scan', 'corr'];
const LOOP_SMOOTH = ['zoom', 'spin', 'trails', 'color', 'poster', 'halftone', 'warp', 'flow', 'melt', 'push', 'dye', 'split', 'grow', 'time', 'blur', 'shiftX', 'shiftY', 'gain', 'blend', 'size', ...SELF, ...ASYM, ...SLIT];
const LOOP_SLIDERS = ['zoom', 'spin', 'trails', 'color', 'poster', 'halftone', 'warp', 'blend', 'size', 'flow', 'melt', 'push', 'dye', 'split', 'grow', 'time', ...SELF, ...ASYM, ...SLIT];
// Up to four loops. A and B are always there; C, then D, are added under Loops › How many loops.
const KEYS = ['A', 'B', 'C', 'D'];
const LOOP_NUM = { A: 0, B: 1, C: 2, D: 3 };
// Cue mode's live previews: five small loops drawn out of sight, one for each ready look (see "cue mode")
const MINI = ['P0', 'P1', 'P2', 'P3', 'P4'];
MINI.forEach((m, i) => { LOOP_NUM[m] = 4 + i; });
// How far apart the loops' own clocks, colors and camera routes start, so no two loops move in step
const LOOP_OFF = { A: 0, B: 1, C: 0.62, D: 1.38, P0: 0.31, P1: 0.83, P2: 1.17, P3: 1.61, P4: 0.47 };
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
  { name: 'Terrain', A: { in1: 'terrain', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } },
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
           probe: null, chaseAt: [0, 0], chaseGoal: [0, 0], offAt: [0, 0], offKick: [0, 0], offPh: Math.random() * 100, offBeats: 0, windAng: Math.random() * 6.28, cells: crystalStart(), breath: { z: 0, s: 1 } };
}
const loops = { A: mkLoop(), B: mkLoop(), C: mkLoop(), D: mkLoop() };
for (const m of MINI) loops[m] = mkLoop();
// Mirror transitions: a new mirror (from its buttons, Autopilot, Surprise or a recipe) glides in over MIRROR_SECS
// in the loop's Transition style (Cut switches at once), and with Spin on the pattern turns once round as it goes.
// L.mx is the change under way: the mirror it's leaving, the one it's going to, and how far along it is (1 done).
// A preset and Neutral cut straight to their mirror (mirrorCut).
// Autopilot's mirror changes glide over its Fade time instead, alongside the rest of the new look (L.mxSecs, and
// mirrorGlideIn for a loop it swaps in), so a new mirror level comes in through the loop's Transition too.
const MIRROR_SECS = 3;
const MIRROR_FX = { cut: 0, melt: 1, iris: 2, ripple: 3 };
function mirrorCut(k) { const m = loops[k].tgt.mirror; loops[k].mx = { from: m, to: m, e: 1 }; }
// The mirror loop k shows most just now: partway through a change, whichever side it's nearer
function mirrorShown(k) {
  const t = loops[k].tgt, m = loops[k].mx;
  if (!m || m.e >= 1) return t.mirror;
  return m.e < 0.5 ? m.from : m.to;
}
// Autopilot swapping loop k in over a loop showing mirror `from`: k comes in wearing that mirror and changes to its
// own through its Transition while it fades in, over secs, rather than its new mirror just fading in over the old
function mirrorGlideIn(k, from, secs) {
  const t = loops[k].tgt;
  loops[k].mx = { from, to: t.mirror, e: from === t.mirror || t.mirrorFx === 'cut' ? 1 : 0, secs };
  loops[k].mxSecs = 0;
}
function mirrorStep(k, dt) {
  const L = loops[k], t = L.tgt, m = L.mx || (L.mx = { from: t.mirror, to: t.mirror, e: 1 });
  if (t.mirror !== m.to) {
    // Partway through a change: going back reverses it from where it is, anything else carries on from the
    // mirror that's showing most
    if (m.e < 1 && t.mirror === m.from) { m.from = m.to; m.e = 1 - m.e; }
    else { m.from = m.e < 0.5 ? m.from : m.to; m.e = 0; }
    m.to = t.mirror;
    // How long this change takes: Autopilot's Fade time when Autopilot made it, otherwise the usual few seconds
    m.secs = L.mxSecs || MIRROR_SECS;
    L.mxSecs = 0;
  }
  if (m.from === m.to || t.mirrorFx === 'cut') m.e = 1;
  if (m.e < 1) m.e = Math.min(1, m.e + dt / (m.secs || MIRROR_SECS));
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
// Stream-friendly (the stream app's switch, through __phosphorCapture.streamFriendly): calmer pictures that come
// through the live stream's small bitrate sharp. Fast zoom, spin, warp, melt, split and colour cycling are held
// to a gentle top speed, flashes and shakes on the beat are softer, Autopilot changes looks less often and more
// slowly and brings in Sparks (fine speckle) rarely. Only what's drawn changes: every slider keeps its own value,
// so switching it off brings the picture back exactly as set. calmK glides between 0 and 1 over a few seconds.
let streamCalm = false, calmK = 0;
const calmCap = (v, cap) => v + (clamp(v, -cap, cap) - v) * calmK;

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
  terrain:   { fs: FS_TERRAIN,   label: 'Terrain',    speed: 3.0,   period: 960,           offB: 480, res: 0.75 },
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
  terrain: 'A flight over endless land made of triangles, every edge drawn as a glowing wire: teal valleys, gold peaks, and a low sun under a starry nebula. It wanders between a winding canyon, rows of sharp ridges and open plains with flat-topped mesas. The land swells with the bass.',
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
// Topo map's small softened picture is read through uScene2: it's only bound there while Topo map traces an input, when
// the loop's pass has no second input to read from uScene2 (see topoPre). It can't have a picture slot of its own:
// on Windows a program may read at most 16 pictures, and the feedback pass already reads 16.
gl.useProgram(compProg.p);
set1i(compProg, 'uA', 0); set1i(compProg, 'uB', 1); set1i(compProg, 'uC', 2); set1i(compProg, 'uD', 3);
gl.useProgram(finalProg.p);
set1i(finalProg, 'uNow', 0); set1i(finalProg, 'uLast', 1);
gl.useProgram(dispProg.p);
set1i(dispProg, 'uTex', 0);
// Life works its board out in its own small program; a graphics card that can't run it shows nothing for Life
let lifeProg = null;
try {
  lifeProg = program(FS_LIFE);
  gl.useProgram(lifeProg.p);
  set1i(lifeProg, 'uLife', 0); set1i(lifeProg, 'uLoop', 1);
} catch (_) { lifeProg = null; }
// Time warp gets its own program, so a graphics card that can't draw it only loses Time warp
let twProg = null;
try {
  twProg = program(FS_TIMEWARP);
  gl.useProgram(twProg.p);
  set1i(twProg, 'uNow', 0); set1i(twProg, 'uHist', 1);
} catch (_) { twProg = null; }
// Slit-scan (Photo finish and Corridor) too: its two small programs
let slitProg = null, scanProg = null;
try {
  slitProg = program(FS_SLIT);
  scanProg = program(FS_SCAN);
  gl.useProgram(scanProg.p);
  set1i(scanProg, 'uNow', 0); set1i(scanProg, 'uBuf', 1);
} catch (_) { slitProg = scanProg = null; }
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
    this.sticker = stickerURLs.has(video.src);
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
    this.video = null; this.stream = null; this.frames = 0; this.sticker = false;
  }
  get on() { return !!this.video; }
  update(modes) {
    const v = this.video;
    if (this.hold || this.wait || !v || v.readyState < 2 || !v.videoWidth) return;
    const fresh = this.rvfc ? this.fresh : v.currentTime !== this.lastTime;
    if (!fresh) return;
    this.fresh = false;
    this.lastTime = v.currentTime;
    this.idx = 1 - this.idx;
    // A sticker's video holds its picture over its see-through map (see stickerUnpack): made whole again here
    this.sticker = stickerURLs.has(v.src);
    try { uploadTo(this.tex[this.idx], this.sticker ? stickerUnpack(v, this) : v); this.frames++; } catch (_) {}
    this.aspect = v.videoWidth / (this.sticker ? v.videoHeight / 2 : v.videoHeight);
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
// Stickers (GIFs with see-through parts, as GIPHY's stickers are). A browser can't make a video that keeps see-through
// parts, so a sticker's video is twice as tall: its picture on top (on black), and under it the see-through map
// (white where the sticker is solid, black where it's see-through). Each new frame is put back together here into
// one picture with real see-through parts, and the loop takes it as a cutout (uVidCut in js/shaders.js).
const stickerURLs = new Set();   // the addresses of sticker videos (made with videoURL)
// A sticker saved to the clip library (✂ Save clip) keeps its picture-over-map video and is tagged "sticker", which
// is how it's known again when it's played from the library (and lets you search the library for stickers)
const STICKER_TAG = 'sticker';
const clipIsSticker = (c) => !!c && Array.isArray(c.tags) && c.tags.some((t) => String(t).toLowerCase() === STICKER_TAG);
function videoURL(file) {
  const u = URL.createObjectURL(file);
  if (file && file.sticker) stickerURLs.add(u);
  return u;
}
function stickerUnpack(v, src) {
  const w = v.videoWidth, h = Math.floor(v.videoHeight / 2);
  const u = src.unpack ||= { cv: document.createElement('canvas') };
  if (u.cv.width !== w || u.cv.height !== h * 2) { u.cv.width = w; u.cv.height = h * 2; u.cx = u.cv.getContext('2d', { willReadFrequently: true }); u.out = null; }
  u.cx.drawImage(v, 0, 0, w, h * 2);
  const all = u.cx.getImageData(0, 0, w, h * 2).data;
  u.out ||= new ImageData(w, h);
  const o = u.out.data, half = w * h * 4;
  for (let i = 0; i < half; i += 4) {
    // The map's grey is how solid it is; a little blur from the video's squeezing is let go below a few steps
    let a = all[half + i + 1];
    a = a < 10 ? 0 : a > 245 ? 255 : a;
    o[i + 3] = a;
    if (!a) { o[i] = o[i + 1] = o[i + 2] = 0; continue; }
    // The picture was drawn over black, so its color is scaled back up by how solid it is
    const k = 255 / a;
    o[i] = Math.min(255, all[i] * k); o[i + 1] = Math.min(255, all[i + 1] * k); o[i + 2] = Math.min(255, all[i + 2] * k);
  }
  u.ocv ||= document.createElement('canvas');
  if (u.ocv.width !== w || u.ocv.height !== h) { u.ocv.width = w; u.ocv.height = h; u.ocx = u.ocv.getContext('2d'); }
  u.ocx.putImageData(u.out, 0, 0);
  return u.ocv;
}
// Each loop has a video player of its own, so loop A can play one video while loop B plays another. A loop whose
// own player is empty shows another loop's video (the first one in A, B, C, D order that has one), the way the one
// shared video always worked, so looks and Autopilot that pick Video always have a picture.
const vids = Object.fromEntries(KEYS.map((k) => [k, Object.assign(new LiveSource(false), {
  key: k, url: null, userPaused: false, loopA: null, loopB: null, rate: 1, media: null, handle: null,
  clip: '', own: false, ask: 0, credit: '', name: '', wait: false, loading: null, forBl: null, seqAsk: 0,
})]));
let vid = vids.A;   // the video player of the loop being edited: the Video controls work on this one
const anyVid = () => KEYS.some((k) => vids[k].on);
// The video loop k shows: its own, or else the first loop's that has one
function vidFor(k) {
  const own = vids[k];
  if (own && own.on) return own;
  for (const j of KEYS) if (vids[j].on) return vids[j];
  return own || vid;
}
const loopUsesVid = (k) => { const t = loops[k].tgt; return t.in1 === 'video' || t.in2 === 'video'; };
// Whether any loop on screen shows this player's video (its own loop, or one borrowing it)
const vidInUse = (s) => activeKeys().some((k) => loopUsesVid(k) && vidFor(k) === s);
// The video a recording or Save clip means: the edited loop's when it shows, or else the first one shown
function vidShown() {
  if (vidInUse(vid)) return vid;
  for (const k of activeKeys()) if (loopUsesVid(k)) return vidFor(k);
  return vid;
}
const cam = new LiveSource(true);
const scr = new LiveSource(false);
const pho = new LiveSource(false);
const LIVE_SRC = { get video() { return vid; }, camera: cam, screen: scr, phone: pho };
// The live source loop k reads for an input
const liveFor = (k, src) => (src === 'video' ? vidFor(k) : LIVE_SRC[src]);

function mkVideo() {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.autoplay = true;
  return v;
}

/* picture */
// Each loop has a picture of its own (the test card to start with), as each has a video player of its own: a
// picture dropped on loop B, or a nature picture picked while editing loop B, goes into loop B only. pic is the
// picture of the loop being edited, which the Picture controls show and change.
const CARD = { kind: 'card', name: 'the test card' };
const pics = Object.fromEntries(KEYS.map((k) => [k, {
  key: k, tex: makeSourceTex(), aspect: 4 / 3, media: { ...CARD }, handle: null, own: false, ask: 0, seqAsk: 0, cur: -1, credit: '',
}]));
let pic = pics.A;
// The Generative art input's moving piece: a looping video player per loop (at: which piece, f: its file name). It has
// no picture slot of its own in the drawing program (see UNITS): its frames are handed to the program in the Picture's
// slot, for loops that use Generative art and not Picture
const gens = Object.fromEntries(KEYS.map((k) => [k, Object.assign(new LiveSource(false), { key: k, aspect: 1, at: -1, f: '', ask: 0, want: '' })]));
const loopUsesGen = (t) => (t.in1 === 'genart' || t.in2 === 'genart') && t.in1 !== 'picture' && t.in2 !== 'picture';
const loopUsesPic = (k) => { const t = loops[k].tgt; return t.in1 === 'picture' || t.in2 === 'picture'; };
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
for (const k of KEYS) uploadTo(pics[k].tex, testCard);

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
function burst() { if (!reduceMotion && !streamCalm) staticAmt = 1; }
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
    // Raising a loop's Show while a sequence plays it: you take over
    if (/^show[A-D]$/.test(k)) seqTakeOver(k.slice(4));
    // Play over it: on a loop the sequence plays, the fader shifts the sequence's own value (see handSlider)
    if (!handSlider(k, isMix, +el.value)) (isMix ? mix.tgt : loops[edit].tgt)[k] = +el.value;
    showSlider(k);
    if (k in FEED_TO && +el.value > 0) showFedLoop(k);
    if (isMix || k === 'trails') syncVisibility();
  });
  el.addEventListener('dblclick', () => {
    // Play over it: double-clicking a fader you moved gives just that one back to the sequence
    if (handRelease(k, isMix)) { syncUI(); return; }
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
    case 'lookup': case 'chase': case 'breathe': case 'chroma': case 'restless': case 'julia': case 'crystal':
    case 'offc': case 'wind': case 'scan': case 'corr': return v === 0 ? 'OFF' : String(v);
    case 'poster': return v === 0 ? 'OFF' : `${Math.round(posterSteps(v))} STEPS`;
    case 'halftone': return v === 0 ? 'OFF' : `${Math.round(halftoneCell(v))} PX`;
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
  const opts = [['none', 'No second input'], ['wave', 'Wave'], ['shape', 'Shape'], ['bars', 'Bars'], ['sparks', 'Sparks'], ['ink', 'Ink drops'], ['patchwork', 'Patchwork'], ['topo', 'Topo map'], ['life', 'Life'], ['radar', 'Doppler radar'], ['texture', 'Textures'], ['text', 'Text (your words)'], ['spectro', 'Spectrograph (sound)'], ...Object.keys(SCENES).map((k) => [k, `${SCENES[k].label} (${sceneGroup(k) === 'fractal' ? 'fractal' : '3D world'})`]),
                ['picture', 'Picture'], ['genart', 'Generative art'], ['video', 'Video'], ['camera', 'Camera'], ['screen', 'Screen'], ['phone', 'Phone'], ['loop', 'The other loop']];
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
window.__plSubject = { get vid() { return vid; }, loops };   // for tests/subject_check.py
function syncSubjectStatus() {
  const el = $('#subjectStatus'), t = loops[edit].tgt;
  const msg = subjectOn(t) ? PhosphorSubject.status() : 'Off: the picture comes in as it is.';
  if (el.textContent !== msg) el.textContent = msg;
}
$$('#topoFrom button').forEach((b) => b.addEventListener('click', () => {
  takeOver('in1');
  loops[edit].tgt.topoPic = b.dataset.pic === '1';
  syncUI();
  showOSD('TOPO MAP', b.dataset.pic === '1' ? 'FROM THE PICTURE' : 'MADE-UP LAND');
}));
function syncTopoUI(t) {
  $$('#topoFrom button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.pic === '1') === !!t.topoPic)));
  const tr = topoTrace(t);
  $('#topoStatus').textContent = !t.topoPic ? 'Contour lines over land that slowly reshapes itself while the view drifts across it.'
    : tr === 'loop' ? `Tracing loop ${otherLoop(edit)}’s picture. Pick a Second input to trace that instead.`
    : `Tracing ${(SRC_LABEL[tr] || tr)}: bright parts are high ground. It isn’t shown as itself, only its contour lines.`;
}
// Life: how big its cells are, how fast the generations go, and where new life comes from
const LIFE_UI = { lifeCells: ['#lifeCells', ['BIG CELLS', 'MEDIUM CELLS', 'SMALL CELLS']], lifeSpeed: ['#lifeSpeed', ['SLOW', 'MEDIUM SPEED', 'FAST']] };
for (const [field, [sel, words]] of Object.entries(LIFE_UI)) $$(sel + ' button').forEach((b) => b.addEventListener('click', () => {
  takeOver('in1');
  loops[edit].tgt[field] = +b.dataset.v;
  syncUI();
  showOSD('LIFE', words[+b.dataset.v]);
}));
$$('#lifeFrom button').forEach((b) => b.addEventListener('click', () => {
  takeOver('in1');
  loops[edit].tgt.lifeLoop = b.dataset.v === '1';
  syncUI();
  showOSD('LIFE', b.dataset.v === '1' ? 'NEW LIFE FROM THE PICTURE' : 'NEW LIFE FROM SPRINKLES');
}));
function syncLifeUI(t) {
  $$('#lifeCells button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === (t.lifeCells ?? 1))));
  $$('#lifeSpeed button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === (t.lifeSpeed ?? 1))));
  $$('#lifeFrom button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.v === '1') === !!t.lifeLoop)));
}
// Doppler radar: the rain or the wind
$$('#radarShows button').forEach((b) => b.addEventListener('click', () => {
  takeOver('in1');
  loops[edit].tgt.radarWind = b.dataset.v === '1';
  syncUI();
  showOSD('DOPPLER RADAR', b.dataset.v === '1' ? 'WIND' : 'RAIN');
}));
// Textures: which of its eight patterns
const TEX_STYLES = ['Marble', 'Cells', 'Ripples', 'Moiré', 'Maze', 'Silk', 'Hex', 'Spiral'];
const texLook = () => Math.floor(Math.random() * TEX_STYLES.length);
$$('#texStyle button').forEach((b) => b.addEventListener('click', () => {
  takeOver('in1');
  loops[edit].tgt.texStyle = +b.dataset.v;
  syncUI();
  showOSD('TEXTURES', TEX_STYLES[+b.dataset.v].toUpperCase());
}));
// A random Life look for Surprise and Autopilot: mostly medium, now and then big or small cells, slow or fast
function lifeLook() {
  const r = () => { const x = Math.random(); return x < 0.2 ? 0 : x < 0.75 ? 1 : 2; };
  return { lifeCells: r(), lifeSpeed: r(), lifeLoop: Math.random() < 0.3 };
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
// Wind's directions: the way it blows, 0 to the right and on round anticlockwise in eighths, then 8 Turning
// (it slowly comes round). Picking one with Wind off turns it on.
const SCAN_SPEED_NAME = ['SLOW', 'MEDIUM', 'FAST'], CORR_SHAPE_NAME = ['TUNNEL', 'FLOOR AND CEILING', 'TWO WALLS'];
$$('.scan-speed button').forEach((b) => b.addEventListener('click', () => {
  const key = b.closest('.scan-speed').dataset.for;
  takeOver(key);
  const t = loops[edit].tgt;
  t.scanSpeed = +b.dataset.sspeed;
  if (!(t[key] > 0)) t[key] = 80;
  syncUI();
  showOSD(`${key === 'scan' ? 'PHOTO FINISH' : 'CORRIDOR'} ${edit}`, SCAN_SPEED_NAME[t.scanSpeed]);
}));
$$('#corrShape button').forEach((b) => b.addEventListener('click', () => {
  takeOver('corr');
  const t = loops[edit].tgt;
  t.corrShape = +b.dataset.cshape;
  if (!(t.corr > 0)) t.corr = 85;
  syncUI();
  showOSD(`CORRIDOR ${edit}`, CORR_SHAPE_NAME[t.corrShape]);
}));
const WIND_DIRS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘', 'TURNING'];
$$('#windDir button').forEach((b) => b.addEventListener('click', () => {
  takeOver('wind');
  const t = loops[edit].tgt;
  t.windDir = +b.dataset.wdir;
  if (!(t.wind > 0)) t.wind = 40;
  syncUI();
  showOSD(`WIND ${edit}`, WIND_DIRS[t.windDir]);
}));
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
  const t = loops[edit].tgt;
  t[key] = b.dataset.final === '1';
  // Picking where with Halftone off turns it on, so the button always shows something
  if (key === 'halftoneFinal' && !(t.halftone > 0)) t.halftone = 30;
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
const TIME_SHAPE_NAME = ['TOP TO BOTTOM', 'SIDE TO SIDE', 'FROM THE MIDDLE', 'DIAGONAL', 'RINGS', 'SWEEP', 'BY BRIGHTNESS'];
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
  seqTakeOver(edit);
  loops[edit].tgt[slot] = src;
  if (is3D(src)) lastWorld[sceneGroup(src)] = src;
  if (src === 'camera' && !cam.on) startCamera();
  if (src === 'screen' && !scr.on) startScreen(true);
  if (src === 'phone') startPhoneLink();
  // No video in yet: the clip library once it's been set up in this browser (its gallery also offers a file),
  // otherwise straight to choosing a file
  if (src === 'video' && !anyVid()) { if (clipsWanted()) openClips('video'); else $('#vidFile').click(); }
  if (src === 'spectro' && !snd.analyser && snd.src === 'off') toast('The spectrograph draws sound. Under the inputs, pick Computer sound or Microphone.');
  if (src === 'text' && txt.str === TEXT_DEFAULT) toast('Type your own words in the Your text box under the inputs.');
  if (src === 'genart') genEnsure(gens[edit]);
  if (src !== 'none' && src !== 'picture' && src !== 'genart' && src !== 'video') hideTip();
  settleDevices();
  syncUI();
  if (src !== 'none') showOSD(`INPUT ${edit}`, src === 'loop' ? `LOOP ${otherLoop(edit)}` : SRC_LABEL[src].toUpperCase());
}

// Turn off the camera and screen share when nothing uses them; pause an unused video.
function settleDevices() {
  if (!uses('camera') && cam.on) stopCamera();
  if (!uses('screen') && scr.on) stopScreen();
  vidsPlay();
}
// Each video plays while a loop on screen shows it, and is paused otherwise
function vidsPlay() {
  for (const s of Object.values(vids)) {
    if (!s.video) continue;
    const used = vidInUse(s);
    if (used && s.video.paused && !s.userPaused) s.video.play().catch(() => {});
    if (!used && !s.video.paused) s.video.pause();
  }
}

/* ================= UI: loop tabs ================= */
const editor = $('#editor');
for (const k of KEYS) $('#tab' + k).addEventListener('click', () => setEdit(k));
function setEdit(k) {
  if (!loopOn(k)) k = 'A';
  edit = k;
  vid = vids[k];
  pic = pics[k];
  vidPanelSync();
  picPanelSync();
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
// Topo map with Height from the picture: the input it traces. That's the loop's other input, or with none, the
// other loop's picture. null when Topo map draws its own land.
function topoTrace(t) {
  if (!t.topoPic || (t.in1 !== 'topo' && t.in2 !== 'topo')) return null;
  const o = t.in1 === 'topo' ? t.in2 : t.in1;
  return o === 'none' || o === 'topo' ? 'loop' : o;
}
function readsOther(k) {
  const L = loops[k];
  return [L.tgt.in1, L.tgt.in2].includes('loop') || topoTrace(L.tgt) === 'loop' || L.tgt.push > 0 || L.cur.push > 0.5 || L.tgt.dye > 0 || L.cur.dye > 0.5;
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
  for (const s of ['picture', 'genart', 'video', 'camera', 'screen', 'phone', 'loop', 'spectro', 'text', 'topo', 'life', 'radar', 'texture']) $('#row-' + s).hidden = !usesHere(s);
  if (usesHere('genart')) { genEnsure(gens[edit]); genPanelSync(); }
  syncTopoUI(t);
  syncLifeUI(t);
  $$('#radarShows button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.v === '1') === !!t.radarWind)));
  $$('#texStyle button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === (t.texStyle ?? 0))));
  syncTextUI();
  $$('#growSize button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.gsize === (t.growSize ?? 1))));
  $$('#windDir button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.wdir === (t.windDir ?? 0))));
  $$('.scan-speed button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.sspeed === (t.scanSpeed ?? 1))));
  $$('#corrShape button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.cshape === (t.corrShape ?? 0))));
  $$('#posterWhere button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.pin === '1') === !!t.posterIn)));
  // Only the real switches: each Spread out column's copy is brought up to date for its own loop (mirrorRefresh)
  $$('.where[data-where]').filter(notCopy).forEach((g) => g.querySelectorAll('button').forEach((b) =>
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
  $('#loopNeutral').textContent = `Neutral loop ${edit}`;
  $('#loopStatus').textContent = `Loop ${otherK}’s picture is feeding loop ${edit}.`;
  in2Sel.querySelector('option[value="loop"]').textContent = `Loop ${otherK}’s picture`;
  for (const id of ['#pushFrom', '#dyeFrom']) { const el = $(id); el.textContent = otherK; el.className = `mini ${otherK.toLowerCase()}`; }
  $('#pushHint').textContent = `Loop ${otherK}’s picture shoves this one around: its bright parts and outlines decide where this loop slides. Works even while loop ${otherK} is hidden.`;
  $('#dyeHint').textContent = `Loop ${otherK}’s picture soaks color into this one: wherever loop ${otherK} is bright, this loop’s colors keep turning, so loop ${otherK}’s shapes show up as rainbow bands.`;
  $('#motionCtl').hidden = !LIVE.some(usesHere);
  $('#motion').setAttribute('aria-pressed', String(!!t.motion));
  $('#softCtl').hidden = !SOFT_SRC.some(usesHere);
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
  if (src === 'video') return anyVid();
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
  // Posterize and Halftone stay through every new look (Autopilot, Surprise), and so does where each effect works
  // (Final Pass or Within Loops); a preset, recipe or Neutral sets them
  if (!force && !('poster' in p)) n.poster = L.tgt.poster || 0;
  if (!force && !('halftone' in p)) n.halftone = L.tgt.halftone || 0;
  if (!force) for (const w of Object.values(FINAL_FX)) if (!(w in p)) n[w] = !!L.tgt[w];
  // Soft trails stays through every new look too; a preset, recipe or Neutral sets it (on, unless saved off)
  if (!force && !('soft' in p)) n.soft = L.tgt.soft !== false;
  // The mirror's Transition and Spin are yours: they stay through every new look (loadPreset brings back a preset's)
  n.mirrorFx = L.tgt.mirrorFx in MIRROR_FX ? L.tgt.mirrorFx : 'melt';
  n.mirrorSpin = !!L.tgt.mirrorSpin;
  if (keep) { n.in1 = keep; n.specRound = p.specRound ?? L.tgt.specRound; n.topoPic = p.topoPic ?? L.tgt.topoPic;
    for (const q of ['lifeCells', 'lifeSpeed', 'lifeLoop', 'radarWind', 'texStyle']) n[q] = p[q] ?? L.tgt[q]; }
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
  const in1 = pick(['wave', 'shape', 'bars', 'sparks', 'ink', 'patchwork', 'topo', 'life', 'radar', 'texture', 'picture', 'genart', 'text', ...allScenes(),
                    ...(snd.analyser ? ['spectro'] : [])]);
  return {
    in1, size: in1 === 'bars' || in1 === 'picture' || in1 === 'genart' ? 50 : in1 === 'text' ? 85 : 100, specRound: Math.random() < 0.5, topoPic: Math.random() < 0.35, ...lifeLook(), radarWind: Math.random() < 0.3, texStyle: texLook(),
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
    time: Math.random() < 0.18 ? Math.round(rnd(35, 90)) : 0, timeShape: Math.floor(Math.random() * TIME_SHAPES),
    ...surpriseSelf(),
    offc: Math.random() < 0.15 ? Math.round(rnd(35, 80)) : 0,
    wind: Math.random() < 0.15 ? Math.round(rnd(25, 70)) : 0, windDir: Math.floor(Math.random() * 9),
    scan: Math.random() < 0.06 ? Math.round(rnd(60, 100)) : 0, corr: Math.random() < 0.08 ? Math.round(rnd(70, 100)) : 0,
    scanSpeed: Math.floor(Math.random() * 3), corrShape: Math.floor(Math.random() * 3),
    mirror: pick([0, 0, 2, 4, 6, 8]),
    blur: +rnd(-0.1, 0.35).toFixed(2),
    edge: zoom < 0 && Math.random() < 0.6 ? 1 : 0,
    shift: Math.random() < 0.3 ? [rnd(-0.003, 0.003), rnd(-0.003, 0.003)] : [0, 0],
  };
}
function surprise() {
  if (MV.play && !MV.applying) movesStop(true);
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
  // Hits, heard straight from the sound: how much the spectrum rose since last frame (low and everything), its
  // recent typical level and spread, the time of the last hit, and the hits a second lately (for the readout)
  hit: { finder: null },
  env: { low: 0, mid: 0, high: 0, beat: 0 },
  avg: { low: 0, mid: 0, high: 0 }, peak: { low: 0.1, mid: 0.1, high: 0.1 },
  beats: 0, shakeDir: [1, 0], amount: 60,
  map: { kick: true, size: true, spin: true, color: true, warp: true, flash: true, lines: true, asym: true },
  // Sound on lines: how much of the sound wave the lines show (0 Smooth, just the kick and bass; 100 Fuzzy, everything)
  detail: 30,
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
  $('#sndDetailRow').hidden = !snd.map.lines;
  $('#sndDetail').value = snd.detail;
  fillTrack($('#sndDetail'));
  $('#sndDetailOut').textContent = snd.detail < 34 ? 'Smooth' : snd.detail < 67 ? 'Medium' : 'Fuzzy';
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
    timeSize: 4096,   // Sound on lines reads a longer stretch of the raw sound than the analysis uses
    push(x) { for (let i = 0; i < x.length; i++) { ring[w] = x[i]; w = w + 1 === R ? 0 : w + 1; } },
    // The latest stretch of raw sound, as the browser's own analyser gives it
    getFloatTimeDomainData(out) { for (let i = 0, j = w - out.length + R; i < out.length; i++, j++) out[i] = ring[j % R]; },
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
// The tempo finder (js/audio/rhythm.js) guessed a BPM and pulsed on a grid, which drifted off the beat or settled on
// the wrong tempo. The beat now comes straight from the sound (see analyzeSound), so the finder no longer starts.
const USE_TEMPO_GRID = false;
function startRhythm(ctx, source) {
  if (!USE_TEMPO_GRID) return;
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
  $('#rhythmStatus').textContent = 'Share audio and the BEAT light follows its hits.';
  snd.hit.finder = null;
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
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } };
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
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 }, suppressLocalAudioPlayback: false },
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
$('#sndDetail').addEventListener('input', (e) => { snd.detail = +e.target.value; syncSoundUI(); });
$('#sndDetail').addEventListener('dblclick', () => { snd.detail = 30; syncSoundUI(); });
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
  // The beat, straight from the sound (js/audio/hits.js): a pulse on each hit as it's heard, no tempo guessed
  const H = snd.hit;
  if (!H.finder) H.finder = new window.PhosphorHits();
  H.finder.step(bins, hz, dt, now / 1000, raw.low + raw.mid + raw.high);
  if (H.finder.strong) {
    snd.beats++;
    const a = Math.random() * Math.PI * 2;
    snd.shakeDir = [Math.cos(a), Math.sin(a)];
  }
  snd.env.beat = H.finder.beat;
}
const mLow = $('#mLow'), mMid = $('#mMid'), mHigh = $('#mHigh'), mBeat = $('#mBeat');
let meterTick = 0;
function drawMeter() {
  if (!snd.analyser || (++meterTick & 1)) return;
  mLow.style.transform = `scaleY(${snd.env.low.toFixed(3)})`;
  mMid.style.transform = `scaleY(${snd.env.mid.toFixed(3)})`;
  mHigh.style.transform = `scaleY(${snd.env.high.toFixed(3)})`;
  mBeat.classList.toggle('on', snd.env.beat > 0.45);
  // How many hits a second lately, from the sound itself (not a tempo guess)
  const F = snd.hit.finder, times = F ? F.times : [], recent = times.length, rate = recent >= 2 ? (recent - 1) / Math.max(0.5, times[recent - 1] - times[0]) : 0;
  const quiet = snd.env.low + snd.env.mid + snd.env.high < 0.02 && (!F || performance.now() / 1000 - F.last > 2);
  const status = quiet ? 'Listening for hits. Play some music.' : recent ? `Hits straight from the sound · about ${rate.toFixed(1)} a second` : 'Listening for hits…';
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
const IMAGE_INPUTS = ['picture', 'genart', 'video', 'camera', 'screen', 'phone'];
function neutral() {
  if (MV.play && !MV.applying) movesStop(true);
  if (ap.on) setAutopilot(false, true);
  markPreset(null);
  for (const k of KEYS) { loopGrade[k] = null; seqRelief[k] = null; }
  if (frozen) toggleFreeze(false);
  let src = loops.A.tgt.in1;
  if (src === 'loop') src = loops.B.tgt.in1 === 'loop' ? 'wave' : loops.B.tgt.in1;
  const flat = {
    in1: src, in2: 'none', blend: 50, size: IMAGE_INPUTS.includes(src) ? 78 : src === 'spectro' || src === 'text' || src === 'patchwork' || src === 'topo' || src === 'life' || src === 'radar' || src === 'texture' ? 100 : 50, motion: false,
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
  setType({ ...typeArt, tAmt: 0 });
  [cam, scr, pho, ...Object.values(vids)].forEach((x) => { x.hold = false; });
  $$('.hold-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  clearTargets();
  setEdit('A');
  settleDevices();
  syncUI();
  showOSD('NEUTRAL', (SRC_LABEL[src] || 'Nothing').toUpperCase());
  toast('Neutral: just the input, with every effect off. Raise Trails to bring the feedback back, then try Zoom and Spin.');
}
$('#neutral').addEventListener('click', neutral);
// Neutral this loop (Inputs, for the loop being edited, and in each Spread out column): just that loop's input,
// every effect on it off and nothing fed into it. The other loops and the whole-picture settings stay as they are.
// A loop Autopilot runs is handed back to you (Autopilot stops if it was its only loop); a sequence playing it
// stops, as when you pick an input on it.
function neutralLoop(k) {
  if (!loopOn(k)) return;
  if (MV.play && !MV.applying) movesStop(true);
  seqTakeOver(k);
  let handed = '';
  if (ap.on && apRuns(k)) {
    if (apMine().length <= 1) setAutopilot(false, true);
    else {
      apSet.runs = apSet.runs.filter((x) => x !== k);
      loops[k].ramp = null;
      if (!apPair()) { ap.prep = null; if (ap.glide && !apRuns(ap.glide.k)) ap.glide = null; }
      ap.turnN = 0;
      saveAp();
      syncApUI();
      handed = ` Loop ${k} is yours now: Autopilot leaves it alone.`;
    }
  }
  markPreset(null);
  loopGrade[k] = null; seqRelief[k] = null;
  const L = loops[k], src = L.tgt.in1;
  patchLoop(k, {
    in1: src, in2: 'none', blend: 50, motion: false,
    size: IMAGE_INPUTS.includes(src) ? 78 : ['spectro', 'text', 'patchwork', 'topo', 'life', 'radar', 'texture', 'loop'].includes(src) ? 100 : 50,
    zoom: 0, spin: 0, trails: 0, color: 0, warp: 0, mirror: 0, blur: 0, edge: 0, shift: [0, 0], gain: 1,
    form: L.tgt.form, specRound: L.tgt.specRound, topoPic: L.tgt.topoPic,
  }, true);
  for (const q of LOOP_SMOOTH) L.cur[q] = L.tgt[q];
  mirrorCut(k);
  // Nothing fed into this loop from the others
  for (const [q, to] of Object.entries(FEED_TO)) if (to === k) { mix.tgt[q] = 0; mix.cur[q] = 0; }
  mix.base = { ...mix.tgt };
  // The input's own picture adjustments, unless another loop on screen uses the same input
  if (ADJ_SRC.includes(src) && !activeKeys().some((j) => j !== k && (loops[j].tgt.in1 === src || loops[j].tgt.in2 === src))) { adj[src] = adjDefaults(); syncAdjUI(); }
  // Its old trails go, so it starts clean
  gl.clearColor(0, 0, 0, 1);
  for (const t of L.rt) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clear(gl.COLOR_BUFFER_BIT); }
  twForget(L);
  settleDevices();
  syncUI();
  syncApLoops();
  showOSD(`NEUTRAL ${k}`, (SRC_LABEL[src] || 'Nothing').toUpperCase());
  toast(`Loop ${k} is neutral: just its input, with its effects off.${handed} Raise Trails to bring its feedback back.`);
}
$('#loopNeutral').addEventListener('click', () => neutralLoop(edit));
window.__plNeutralLoop = neutralLoop;   // for tests/neutral_loop_check.py

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
  in1: { name: 'Main input', fields: ['in1', 'form', 'specRound', 'topoPic', 'lifeCells', 'lifeSpeed', 'lifeLoop', 'radarWind', 'texStyle', 'motion'] },
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
  offc: { name: 'Off-center', fields: ['offc'] },
  wind: { name: 'Wind', fields: ['wind', 'windDir'] },
  scan: { name: 'Photo finish', fields: ['scan', 'scanSpeed'] },
  corr: { name: 'Corridor', fields: ['corr', 'corrShape', 'scanSpeed'] },
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
const LIM_LOOP = ['blend', 'size', 'zoom', 'spin', 'trails', 'color', 'warp', 'flow', 'melt', 'push', 'dye', 'grow', 'mirror', 'split', 'time', ...SELF, ...ASYM, ...SLIT];
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
const AP_INPUTS = [['wave', 'Wave'], ['shape', 'Shape'], ['bars', 'Bars'], ['sparks', 'Sparks'], ['ink', 'Ink'], ['patchwork', 'Patchwork'], ['topo', 'Topo map'], ['life', 'Life'], ['radar', 'Doppler radar'], ['texture', 'Textures'], ['text', 'Text'], ['spectro', 'Spectrograph'],
  ['world', '3D worlds'], ['fractal', 'Fractals'], ['picture', 'Picture'], ['genart', 'Generative art'], ['video', 'Video'], ['camera', 'Camera'], ['screen', 'Screen'], ['phone', 'Phone'], ['loop', 'Other loop']];
const AP_INPUT_KEYS = AP_INPUTS.map(([k]) => k);
const cleanOff = (v) => (Array.isArray(v) ? [...new Set(v.filter((k) => AP_INPUT_KEYS.includes(k)))].slice(0, AP_INPUT_KEYS.length - 1) : []);
const AP_DEFAULTS = { every: 44, fade: 63, wild: 50, mix: 50, taste: 50, beat: false, check: true, hints: true, fsKeep: false, touch: 'pin', off: [], type: false, cue: false, cuePreviews: true, cueLive: false, cueFade: false, cueFadeSecs: 2,
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
const apW = (k) => (apSet.weights[k] ?? 1) * (streamCalm && k === 'sparks' ? 0.25 : 1);
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
    apSet.type = s.type === true;
    apSet.cue = s.cue === true;
    apSet.cuePreviews = s.cuePreviews !== false;
    apSet.cueLive = s.cueLive === true;
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
const apEverySec = () => 10 * Math.pow(12, apSet.every / 100) * (streamCalm ? 1.5 : 1);   // 10 seconds to 2 minutes; 30 by default
// How long Autopilot's change of mirror takes: as long as the new look's fade (quicker for one cut in on the beat,
// which comes in over about 1.5 seconds), and never quicker than an ordinary mirror change
const apMirrorSecs = () => (ap.quick ? 1.5 : Math.max(MIRROR_SECS, apFadeSec()));
const apFadeSec = () => 1.5 * Math.pow(20, apSet.fade / 100) * (streamCalm ? 1.5 : 1);    // 1.5 to 30 seconds; 10 by default
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
// Posterize and Halftone are always yours: Autopilot never changes them
const apOwns = (key, k) => (key === 'poster' || key === 'halftone' ? false : key === 'view' || MIX_SLIDERS.includes(key) ? apOwnsMix(key) : apRuns(k));

/* ================= autopilot's eye ================= */
// While Autopilot runs it keeps an eye on the picture. Every few hundredths of a second a tiny 64 x 36 copy is
// made of the picture on screen, or of loop A or B on its own, and the graphics chip hands it over a frame or two
// later. Nothing ever stops to wait for it, so it can't make the picture stutter. (Making and collecting the
// copies is in eyeTick, next to frame.) Each copy is boiled down to a few numbers: how much of it is near white,
// how much is lit at all, how much detail it has, how colorful it is and how fast it's changing.
// Check each look and the white-out watch, below, decide what to do with them.
const EYE_W = 64, EYE_H = 36;
const eye = { tgt: null, prog: null, pbo: null, sync: null, failed: false, key: '', gen: { A: 0, B: 0, C: 0, comp: 0 }, askGen: 0, askLook: 0, wantUntil: 0,
  askT: 0, age: 0, turn: 0, buf: new Uint8Array(EYE_W * EYE_H * 4), last: {}, hist: { A: [], B: [], C: [], comp: [] } };
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
    // Passed and waiting its turn. If it starts going white (or fades to black) after all, it's thrown away and another tried.
    const S = eyeRecent(P.k, 1500, now);
    if (S.length < 3 || P.tries >= CHECK.tries) return;
    const v = lookVerdict(S);
    if (v.why !== 'white' && v.why !== 'dark') return;
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

/* ================= black-out watch ================= */
// The other way round: while Autopilot runs, the picture on screen is kept from fading away to black. When most of
// the screen has gone nearly black (or it's heading there fast), Autopilot turns its own sliders up a notch on the
// loop that's doing it, the way a person would: Trails first (so the picture is held instead of draining away),
// then the input's size and brightness, then a little of the other loop poured in if that one still has light.
// If one loop is dark and the other isn't, it shows the lit one. Still black after 4 seconds: on to the next look.
// It never turns anything up while the white-out watch is busy, nor past AP_TRAILS_MAX when the other loop's
// Trails are long already, so the two watches can't fight. Pinned sliders, fader limits and 3D build-ups are
// left alone, and when you steer by hand (Autopilot off) it does nothing at all.
const DARK = { lit: 0.1, mean: 0.045, fall: 0.18, clear: 0.16, step: 1.2, next: 4, trailsTop: 84 };
const dark = { hot: 0, cool: 0, stepT: 0, lifting: '', liftT: 0, skipped: false };
// Turns loop k's own settings up a notch. Says whether there was anything left to turn up.
function liftLoop(k, otherLit) {
  const t = loops[k].tgt;
  let did = false;
  const raise = (obj, key, v, pin) => {
    if (pin || ramping(key, k)) return;
    const r = limSpan(key);
    v = Math.round(r ? Math.min(v, r[1]) : v);
    if (v > obj[key]) { obj[key] = v; did = true; }
  };
  const other = otherLoop(k);
  const top = loops[other].tgt.trails > AP_TRAILS_MAX ? AP_TRAILS_MAX : DARK.trailsTop;
  if (t.trails < top) raise(t, 'trails', Math.min(top, t.trails + 6), isPinned('trails', k));
  if (t.size < 85) raise(t, 'size', Math.min(100, t.size + 10), isPinned('size', k));
  if ((t.gain ?? 1) < 1.4 && !ramping('gain', k)) { t.gain = Math.min(1.4, (t.gain ?? 1) * 1.15); did = true; }
  const feed = FEED_INTO[k];
  if (otherLit && mix.tgt[feed] < 30 && apOwnsMix(feed) && !rampingMix(feed)) raise(mix.tgt, feed, Math.max(12, mix.tgt[feed] + 8), ap.pins.has(feed));
  return did;
}
function darkWatch(now, dt, wA, wB) {
  // Never at the same time as the white-out watch
  if (watch.hot > 0) { dark.hot = 0; return; }
  let S = eyeRecent('comp', 1500, now);
  if (!S.length) S = eyeRecent('comp', 3000, now).slice(-1);
  if (!S.length) return;
  const lit = eyeAvg(S, 'lit'), mean = eyeAvg(S, 'mean');
  const first = S[0], last = S[S.length - 1], span = (last.t - first.t) / 1000;
  const fall = span > 0.3 ? (first.lit - last.lit) / span : 0;
  const lighter = span > 0.3 && last.lit > first.lit + 0.01;
  const hot = (lit < DARK.lit && mean < DARK.mean) || (last.lit < DARK.clear && fall > DARK.fall);
  if (dark.lifting && now - dark.liftT > 2500) dark.lifting = '';
  if (!hot) {
    if (last.lit > DARK.clear) dark.cool += dt;
    if (dark.cool > 1.5) { dark.hot = 0; dark.skipped = false; }
    return;
  }
  dark.cool = 0;
  dark.hot += dt;
  const shown = ['A', 'B'].filter((k) => (k === 'A' ? wA : wB) > 0.05 && apRuns(k));
  const own = (k) => { const R = eyeRecent(k, 3000, now); return R.length ? Math.min(eyeAvg(R, 'lit'), R[R.length - 1].lit) : null; };
  // A notch at a time, and none while it's already coming back (sliders glide, so a change takes a moment to show)
  if (now - dark.stepT >= DARK.step * 1000 && !lighter) {
    dark.stepT = now;
    const culprits = shown.filter((k) => { const l = own(k); return l == null || l < DARK.clear; });
    let did = false;
    // One loop dark, the other still lit: show the lit one
    if (shown.length === 2 && culprits.length === 1 && !ap.pins.has('view') && apPair()) {
      const keep = culprits[0] === 'A' ? 'B' : 'A';
      const to = limSpan('view') ? nearLim('view', keep === 'A' ? 0 : 100) : (keep === 'A' ? 0 : 100);
      if (to !== mix.tgt.view) { mix.tgt.view = to; did = true; }
    }
    const fix = culprits.length ? culprits : shown;
    for (const k of fix) { const o = own(otherLoop(k)); did = liftLoop(k, o != null && o > 0.3) || did; }
    if (did) {
      dark.lifting = fix.join(' and ');
      dark.liftT = now;
      syncUI();
      apStatus();
    }
  }
  // Still black: on to the next look, as soon as one is ready
  if (dark.hot > DARK.next && !dark.skipped) {
    dark.skipped = true;
    ap.rush = true;
    ap.next = Math.min(ap.next, now);
    ap.due = Math.min(ap.due, now);
  }
}

// Two Autopilot buttons: one at the top of Autopilot, and one in the row under the picture,
// which never folds away or hides, so it's always easy to find
const apBtns = [$('#autopilot'), $('#autopilotBar')].filter(Boolean);
function setAutopilot(on, quiet) {
  if (on && MV.play && !MV.applying) movesStop(false, 'Autopilot took over, so the recording stopped.');
  ap.on = on;
  ap.quick = 0;
  ap.beatWait = null;
  ap.prep = null;
  ap.glide = null;
  ap.glideRedo = 0;
  ap.rush = false;
  eyeReset();
  Object.assign(watch, { hot: 0, cool: 0, easing: '', skipped: false });
  Object.assign(dark, { hot: 0, cool: 0, lifting: '', skipped: false });
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
    cueSleep();
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
function pinsChanged() { syncPins(); saveAp(); apStatus(); if (!mirroring) mirrorRefreshSoon(); }
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
// Only the real pins are set here, for the loop being edited: each Spread out column's copies are brought up to date
// for that column's own loop (mirrorRefresh), so a pin lights only under the loop it holds
function syncPins() {
  $$('.pin').filter(notCopy).forEach((b) => {
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
  const pool = ['wave', 'shape', 'bars', 'sparks', 'ink', 'patchwork', 'topo', 'life', 'radar', 'texture', 'picture', 'genart', 'text', ...allScenes()];
  // Using the other loop as an input is one more way of mixing the loops, so Mix turned right up gives it an extra chance
  if (apSet.mix > 10) pool.push('loop');
  if (apSet.mix > 75) pool.push('loop');
  if (anyVid() || clipsReady()) pool.push('video');   // a clip from the clip library comes in when a look picks Video
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
  offc: (w) => rnd(30, 30 + 60 * w),
  wind: (w) => rnd(20, 20 + 60 * w),
  scan: (w) => rnd(50, 50 + 50 * w),
  corr: (w) => rnd(55, 55 + 45 * w),
};
function apFx(sc, w) {
  for (const [key, val] of Object.entries(AP_FX)) {
    if (sc[key] > 0) continue;
    sc[key] = Math.random() < apOdds(w) ? Math.round(val(w)) : 0;
  }
  if (sc.grow && sc.growSize == null) sc.growSize = Math.floor(Math.random() * 3);
  if (sc.time && sc.timeShape == null) sc.timeShape = Math.floor(Math.random() * TIME_SHAPES);
  if (sc.wind && sc.windDir == null) sc.windDir = Math.floor(Math.random() * WIND_DIRS.length);
  // Photo finish and Corridor take over the whole picture, so they come in less often than the rest
  for (const key of SLIT) if (sc[key] > 0 && Math.random() < 0.6) sc[key] = 0;
  if (sc.scan || sc.corr) { if (sc.scanSpeed == null) sc.scanSpeed = Math.floor(Math.random() * 3); if (sc.corr && sc.corrShape == null) sc.corrShape = Math.floor(Math.random() * 3); }
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
      growSize: Math.floor(Math.random() * 3), timeShape: Math.floor(Math.random() * TIME_SHAPES), windDir: Math.floor(Math.random() * 9),
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
    if ((sc.in1 === 'bars' || sc.in1 === 'picture' || sc.in1 === 'genart') && sc.size == null) sc.size = 50;
    if (sc.in1 === 'text') sc.size = Math.round(rnd(70, 100));
    if (sc.in1 === 'patchwork') sc.size = Math.round(rnd(55, 100));
    if (sc.in1 === 'topo') sc.size = Math.round(rnd(55, 100));
    if (sc.in1 === 'life') sc.size = Math.round(rnd(60, 100));
    if (sc.in1 === 'radar') sc.size = Math.round(rnd(75, 100));
    if (sc.in1 === 'texture') sc.size = Math.round(rnd(55, 100));
    if (['camera', 'screen', 'phone', 'video'].includes(sc.in1)) {
      sc.size = Math.round(rnd(60, 100));
      if (!isPinned('in1', k)) sc.motion = Math.random() < 0.35;
    }
    if ((sc.in1 === 'topo' || sc.in2 === 'topo') && !isPinned('in1', k)) sc.topoPic = Math.random() < 0.35;
    if ((sc.in1 === 'life' || sc.in2 === 'life') && !isPinned('in1', k)) Object.assign(sc, lifeLook());
    if ((sc.in1 === 'radar' || sc.in2 === 'radar') && !isPinned('in1', k)) sc.radarWind = Math.random() < 0.3;
    if ((sc.in1 === 'texture' || sc.in2 === 'texture') && !isPinned('in1', k)) sc.texStyle = texLook();
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
    for (const f of ['in1', 'in2', 'blend', 'size', 'motion', 'specRound', 'topoPic', 'lifeCells', 'lifeSpeed', 'lifeLoop', 'radarWind', 'texStyle', 'gain']) sc[f] = L.tgt[f];
    if (sc.in2 && sc.in2 !== 'none' && !apAllowed(sc.in2)) sc.in2 = 'none';
  }
  withPins(sc, k);
  const other = otherLoop(k);
  if (sc.in1 === 'loop' && [loops[other].tgt.in1, loops[other].tgt.in2].includes('loop') && !isPinned('in1', k)) sc.in1 = apRealInput();
  apLimit(sc, k);
  capTrails(sc, other, k);
  patchLoop(k, sc, true);
  // A new mirror level glides in through the loop's Transition over the same time as the rest of the look
  L.mxSecs = L.mx && L.tgt.mirror !== L.mx.to ? apMirrorSecs() : 0;
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
  flow: 0, melt: 0, push: 0, dye: 0, split: 0, grow: 0, time: 0, ...Object.fromEntries([...SELF, ...ASYM, ...SLIT].map((x) => [x, 0])) };
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
        // Its mirror comes in through the Transition, from the mirror on screen now to its own
        mirrorGlideIn(hidden, mirrorShown(shown), apMirrorSecs());
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
  vidsPlay();
  apPicture(came);
  apGenart(came);
  apClip(came);
  apTypeArt(came, now);
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
  const to = pics[k] || pic;   // the picture of the loop whose new look came in (each loop has its own)
  if (want && !to.own && apAllowed('picture') && tasteHow() && (came.tgt.in1 === 'picture' || came.tgt.in2 === 'picture')) {
    natList().then(() => {
      const i = nat.pics.findIndex((p) => p.f === want);
      if (i >= 0 && i !== to.cur) natPick(i, true, to);
    }).catch(() => {});
    ap.picIn = apPicGap();
    return;
  }
  if (ap.picIn > 1) { ap.picIn--; return; }
  ap.picIn = apPicGap();
  if (to.own || !apAllowed('picture')) return;
  natList().then(() => {
    const shown = natShown().filter((i) => i !== to.cur);
    if (!shown.length) return;
    if (!tasteHow()) { natPick(pick(shown), true, to); return; }
    const M = tasteModel(), few = shown.sort(() => Math.random() - 0.5).slice(0, 12);
    natPick(tastePickBy(few, (i) => Math.tanh(((M.pref['natf:' + nat.pics[i].f] || 0) * 1.5 + (M.pref['natc:' + nat.pics[i].c] || 0) * 1.2) / 2)), true, to);
  }).catch(() => { /* offline before the list was ever saved: keep the picture there is */ });
}
// Clips from the clip library (Phosphor Clips): when a look picks Video and no video is in yet, Autopilot brings in
// a clip from the categories ticked in the clip gallery, and every 1 to 3 new looks that use Video it puts in a
// different one, the way it does with nature pictures. A video file of your own stays put, and nothing changes
// when Video is switched off under Inputs Autopilot can use.
function apClip(k) {
  if (!clipsReady() || !apAllowed('video')) return;
  if (!anyVid()) {
    if (uses('video')) { ap.clipIn = apPicGap(); clipPick(pick(clipsAp()), true, vids.A); }
    return;
  }
  const came = k && loops[k];
  if (!came || !loopUsesVid(k)) return;
  // The new clip goes into the player that loop shows; a video of your own there stays put
  const to = vidFor(k);
  if (to.own) return;
  if (ap.clipIn > 1) { ap.clipIn--; return; }
  ap.clipIn = apPicGap();
  const others = clipsAp().filter((c) => c.id !== to.clip);
  if (others.length) clipPick(pick(others), true, to);
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
  // Cue mode: straight to the look waiting on the hidden loop
  if (was && cueActive()) { if (frozen) toggleFreeze(false); cueGo(); showOSD('CUE', 'NEXT LOOK'); return; }
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
/* ================= cue mode ================= */
// Cue mode (under Autopilot, for DJing live and making videos): Autopilot stops changing the picture by itself.
// Nothing on screen moves except with the music and your hands. Out of sight it keeps looking for new looks the
// whole time, on a spare loop (the "scout", loop C's place while only loops A and B are on). Each look is tried for
// a few seconds and judged the way Check each look judges, and the good ones go on a list of up to five ready looks,
// each with a little picture of itself (Show 5 previews puts them under the picture). The next look always waits on
// the hidden loop, already built up, so Next look (or L) cuts to it on the very frame you press: on the hit of the
// song. Click a preview to make it the next look instead (it builds up out of sight in about a second).
// The scout's looks never read the other loop (no Other loop input, no Pushed by or Dyed by, nothing fed in), so
// what's on screen can't be changed by what's being tried behind it. The white-out and black-out watches stay out
// of it too: every look was checked before it got on the list.
// It needs Autopilot running loops A and B, with loops C and D switched off and What you see not pinned or limited.
const CUE = { max: 5, settle: 1.5, judge: 3.5, built: 1.2, snapW: 160, clipW: 192, clipCols: 6, clipN: 30, clipFps: 15, clipFrom: 1.5, miniH: 180 };
const cue = { scout: false, trial: null, list: [], pick: null, deck: null, n: 0, savedC: null, hover: false, cut: 0, reads: [], mini: new Map(), live: null, liveTick: 0 };
const cueCan = () => ap.on && apPair() && loopCount === 2 && !ap.pins.has('view') && !limSpan('view') && !eye.failed;
const cueActive = () => apSet.cue && cueCan();
// Why Cue mode can't work just now (for the status line), or ''
function cueWhy() {
  if (!apSet.cue || !ap.on) return '';
  if (eye.failed) return 'This browser can’t look at the picture, so Cue mode can’t check looks here.';
  if (loopCount !== 2) return 'Cue mode needs loops C and D switched off (Loops › How many loops: 2).';
  if (!apPair()) return 'Cue mode needs Autopilot to run loops A and B (Loops Autopilot runs).';
  if (ap.pins.has('view') || limSpan('view')) return 'Cue mode needs What you see free: unpin it and take off its fader limit.';
  return '';
}
const cueShown = () => (mix.tgt.view >= 50 ? 'B' : 'A');
const cueHidden = () => (cueShown() === 'A' ? 'B' : 'A');
// A new look for the hidden loop k, as Autopilot would make it, that leaves the other loop alone
function cueScene(k) {
  const sc = apScene(k), shown = otherLoop(k);
  delete sc.favMix;
  if (sc.in1 === 'loop') sc.in1 = apRealInput();
  if (sc.in2 === 'loop') sc.in2 = 'none';
  if (sc.in1 === sc.in2) sc.in2 = 'none';
  sc.push = 0; sc.dye = 0;
  if (topoTrace({ ...loopDefaults(), ...sc }) === 'loop') sc.topoPic = false;
  apLimit(sc, k);
  capTrails(sc, shown, k);
  // 3D worlds and fractals need room to be seen: their effects are kept light, the way Autopilot's build-up peaks
  if (is3D(sc.in1) && !sc.asInput) {
    for (const [key, c] of Object.entries(RAMP_CLEAN)) {
      if (isPinned(key, k)) continue;
      const clean = nearLim(key, c), full = sc[key] ?? loopDefaults()[key];
      if (typeof full === 'number') sc[key] = Math.round((clean + (full - clean) * 0.35) * 100) / 100;
    }
  }
  return sc;
}
// Puts a look on loop k from a clean slate, its mirror and sliders where they're going straight away
function cueLoad(k, look) {
  const L = loops[k];
  patchLoop(k, look, true);
  L.favMix = null;
  L.ramp = null;
  for (const q of LOOP_SMOOTH) L.cur[q] = L.tgt[q];
  mirrorCut(k);
  clearLoop(k);
  eyeForget(k);
}
function cueStartScout() {
  if (cue.scout) return;
  ensureTargets('C');
  // Loop C's own look (if it was ever switched on) comes back when Cue mode stops
  cue.savedC = { tgt: { ...loops.C.tgt }, cur: { ...loops.C.cur } };
  cue.scout = true;
  cue.trial = null;
  if (!eye.gen.C) { eye.gen.C = 0; eye.hist.C = []; }
}
function cueStopScout() {
  if (!cue.scout) return;
  cue.scout = false;
  cue.trial = null;
  if (cue.savedC) { Object.assign(loops.C.tgt, cue.savedC.tgt); Object.assign(loops.C.cur, cue.savedC.cur); mirrorCut('C'); clearLoopTargets('C'); }
  cue.savedC = null;
}
// Ends Cue mode's work (Autopilot off, Cue mode off, or it can't run just now); the list is kept for next time
function cueSleep() {
  cueStopScout();
  if (cue.mini.size) miniDropAll();
  cue.live = null;
  cue.deck = null;
  cueStrip();
}
// A small picture of the scout's look, for the previews
let cueSnapTgt = null;
function cueSnap() {
  const w = CUE.snapW, h = Math.round(w * simH / simW);
  try {
    if (!cueSnapTgt || cueSnapTgt.w !== w || cueSnapTgt.h !== h) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      cueSnapTgt = { tex, fbo, w, h, buf: new Uint8Array(w * h * 4) };
    }
    const T = cueSnapTgt;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(eye.prog.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mixTex('C'));
    set2f(eye.prog, 'uOut', w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, T.buf);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d'), img = x.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(T.buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    x.putImageData(img, 0, 0);
    return c;
  } catch (_) { return null; }
}
// Loops drawn out of sight for Cue mode: the scout (loop C's place) and the live previews' small loops
const extraLoop = (k) => (k === 'C' && cue.scout) || [...cue.mini.values()].includes(k);
const extraKeys = () => [...activeKeys(), ...(cue.scout ? ['C'] : []), ...cue.mini.values()];
const extraUses = (name) => (cue.scout ? ['C', ...cue.mini.values()] : []).some((k) => loops[k].tgt.in1 === name || loops[k].tgt.in2 === name);
// The looks tried out of sight use the picture of the loop they'll go on
function picOf(k) { return extraLoop(k) ? pics[cue.deck ? cue.deck.k : cueHidden()] : pics[k]; }
const genTarget = (k) => (extraLoop(k) ? gens[cue.deck ? cue.deck.k : cueHidden()] : gens[k]);
function genOf(k) { const g = genTarget(k); genEnsure(g); return g; }
// A small copy of one picture into a box of a target (any box of it, unlike copyInto)
const tileProg = program(`#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec4 uBox;
out vec4 o;
void main() { o = vec4(clamp(texture(uSrc, (gl_FragCoord.xy - uBox.xy) / uBox.zw).rgb, 0.0, 1.0), 1.0); }`);
function tileInto(T, tex, x, y, w, h) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
  gl.viewport(x, y, w, h);
  gl.useProgram(tileProg.p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform4f(U(tileProg, 'uBox'), x, y, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function plainTarget(T, w, h) {
  if (T && T.w === w && T.h === h) return T;
  if (T) { gl.deleteTexture(T.tex); gl.deleteFramebuffer(T.fbo); }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo, w, h };
}
// Reads a target back without making the picture wait: the copy lands in a buffer and is picked up a few frames
// later, once the graphics card says it's there (cueReads). done(canvas) gets it the right way up.
function readLater(T, done) {
  const size = T.w * T.h * 4, pbo = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
  gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
  gl.readPixels(0, 0, T.w, T.h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  cue.reads.push({ pbo, sync, w: T.w, h: T.h, size, done, t: performance.now() });
}
function cueReads() {
  for (const r of cue.reads.slice()) {
    const st = gl.clientWaitSync(r.sync, 0, 0);
    if (st === gl.TIMEOUT_EXPIRED && performance.now() - r.t < 3000) continue;
    cue.reads.splice(cue.reads.indexOf(r), 1);
    gl.deleteSync(r.sync);
    if (st !== gl.TIMEOUT_EXPIRED && st !== gl.WAIT_FAILED) {
      const buf = new Uint8Array(r.size);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, r.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const c = document.createElement('canvas');
      c.width = r.w; c.height = r.h;
      const x = c.getContext('2d'), img = x.createImageData(r.w, r.h);
      for (let y = 0; y < r.h; y++) img.data.set(buf.subarray((r.h - 1 - y) * r.w * 4, (r.h - y) * r.w * 4), y * r.w * 4);
      x.putImageData(img, 0, 0);
      r.done(c);
    }
    gl.deleteBuffer(r.pbo);
  }
}
// Preview clips: while the scout tries a look, a small picture of it goes into a sheet 15 times a second (once it has
// had a moment to build up, for two seconds). If the look passes, the sheet is read back and its preview
// plays it on a loop. Looks that don't pass are never read back, so trying costs next to nothing.
let clipSheet = null;
function cueCapture(now) {
  const T = cue.trial;
  if (!T || !cue.scout || !loops.C.rt) return;
  const age = (now - T.since) / 1000;
  if (age < CUE.clipFrom || T.frames >= CUE.clipN || now < T.nextCap) return;
  T.nextCap = Math.max(now, T.nextCap || now) + 1000 / CUE.clipFps - 4;
  const tw = CUE.clipW, th = Math.round(tw / simAspect), cols = CUE.clipCols, rows = Math.ceil(CUE.clipN / cols);
  clipSheet = plainTarget(clipSheet, cols * tw, rows * th);
  if (!T.frames) T.sheet = { tw, th, cols, rows };
  else if (T.sheet.th !== th) return;
  const i = T.frames++;
  tileInto(clipSheet, mixTex('C'), (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
}
function clipRead(item, T) {
  if (!T.frames || !clipSheet || !T.sheet) return;
  const S = T.sheet, n = T.frames;
  readLater(clipSheet, (c) => { item.clip = { sheet: c, n, ...S }; cueStrip(); });
}
// Live previews (Show 5 previews › Live): each ready look also runs on a small loop of its own, out of sight,
// drawn about a quarter of the picture's height. Their pictures are gathered side by side, read back the same way
// (about 30 times a second) and shown in the previews, moving with the music.
const miniSize = () => { const h = CUE.miniH; return [Math.max(4, Math.round(h * simAspect)), h]; };
function withMini(fn) {
  const sw = simW, sh = simH, sa = simAspect;
  [simW, simH] = miniSize();
  simAspect = simW / simH;
  miniRun = true;
  try { fn(); } finally { simW = sw; simH = sh; simAspect = sa; miniRun = false; }
}
const cueLiveOn = () => apSet.cuePreviews && apSet.cueLive && cueActive();
function miniLoad(k, look) {
  withMini(() => {
    const L = loops[k];
    if (L.rt && (L.rt.w !== simW || L.rt.h !== simH)) { L.rt.forEach(dropTarget); L.rt = null; }
    if (!L.rt) { L.rt = [makeTarget(), makeTarget()]; L.rt.w = simW; L.rt.h = simH; L.front = 0; }
    cueLoad(k, look);
  });
}
function miniDropAll() {
  for (const k of cue.mini.values()) {
    const L = loops[k];
    if (L.rt) { L.rt.forEach(dropTarget); L.rt = null; }
    if (L.pz) { L.pz.rt.forEach(dropTarget); L.pz = null; }
    twDrop(L);
  }
  cue.mini.clear();
}
let liveSheet = null;
function cueMinis(dt, f) {
  if (!cueLiveOn() || !cue.list.length) { if (cue.mini.size) miniDropAll(); return; }
  const ids = new Set(cue.list.map((it) => it.id));
  for (const id of [...cue.mini.keys()]) if (!ids.has(id)) cue.mini.delete(id);
  for (const it of cue.list) {
    if (cue.mini.has(it.id)) continue;
    const used = new Set(cue.mini.values()), k = MINI.find((m) => !used.has(m));
    if (!k) break;
    cue.mini.set(it.id, k);
    miniLoad(k, it.look);
  }
  withMini(() => {
    for (const k of cue.mini.values()) {
      if (!loops[k].rt) continue;
      mirrorStep(k, dt);
      runLoop(k, 0, null, f);
      finalPass(k);
    }
  });
  // Side by side, in the list's order, read back every other frame (one read at a time)
  cue.liveTick = (cue.liveTick || 0) + 1;
  if (cue.liveTick % 2 || cue.reads.some((r) => r.live)) return;
  const [w, h] = miniSize(), order = cue.list.map((it) => it.id);
  liveSheet = plainTarget(liveSheet, w * CUE.max, h);
  order.forEach((id, i) => { const k = cue.mini.get(id); if (k && loops[k].rt) tileInto(liveSheet, mixTex(k), i * w, 0, w, h); });
  readLater(liveSheet, (c) => { cue.live = { sheet: c, w, h, order }; });
  cue.reads[cue.reads.length - 1].live = true;
}
// Draws the previews' moving pictures: the live ones when Live is on, otherwise each look's clip
function cuePlay(now) {
  cueReads();
  const el = $('#cueStrip');
  if (!el || el.hidden) return;
  const live = cueLiveOn() && cue.live;
  $$('#cueStrip .cue-pic').forEach((b, i) => {
    const it = cue.list[i];
    if (!it) return;
    const cv = b.querySelector('canvas');
    let src = null, sx = 0, sy = 0, sw = 0, sh = 0;
    const li = live ? live.order.indexOf(it.id) : -1;
    if (li >= 0) { src = live.sheet; sx = li * live.w; sw = live.w; sh = live.h; }
    else if (it.clip && !apSet.cueLive) {
      const C = it.clip, n = Math.floor((now / 1000) * CUE.clipFps) % C.n;
      src = C.sheet; sx = (n % C.cols) * C.tw; sy = (C.rows - 1 - Math.floor(n / C.cols)) * C.th; sw = C.tw; sh = C.th;   // read back upside down: the first row is at the bottom
    }
    if (!src) return;
    if (cv.width !== sw * 2 || cv.height !== sh * 2) { cv.width = sw * 2; cv.height = sh * 2; }
    cv.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    b.dataset.drawn = String(it.id);
  });
}
// A look on the list goes onto the hidden loop, ready for the next cut
function cueNextItem() {
  const d = cue.deck;
  return cue.list.find((it) => it.id === cue.pick) || (d && cue.list.find((it) => it.id === d.id)) ||
    cue.list.slice().sort((a, b) => b.v.score - a.v.score)[0] || null;
}
function cueDeck(now) {
  // While a fade is going both loops are on screen: the next look goes on the hidden loop once it's done
  if (cue.fade) return;
  const k = cueHidden(), want = cueNextItem(), d = cue.deck;
  // A look already waiting stays (unless you picked another), so the next cut is never one still building up
  if (d && d.k === k && (cue.pick ? d.id === cue.pick : !want || (d.id != null && cue.list.some((it) => it.id === d.id)))) return;
  if (!want) {
    // Nothing on the list yet: the hidden loop takes a new look of its own (not checked), so a cut still brings something new
    if (cue.deck && cue.deck.k === k) return;
    cueLoad(k, cueScene(k));
    cue.deck = { k, id: null, at: now };
  } else {
    cueLoad(k, want.look);
    cue.deck = { k, id: want.id, at: now };
  }
  cueStrip();
}
// Every frame while Cue mode works (from eyeTick): keeps the next look waiting, tries looks on the scout, judges them
function cueTick(now) {
  if (!cueActive()) { if (cue.scout || cue.deck) cueSleep(); return false; }
  ap.prep = null; ap.glide = null;
  for (const k of ['A', 'B']) loops[k].ramp = null;
  // One loop on screen at a time (the other one waits, hidden), except while fading from one look to the next
  if (cue.fade) cueFadeTick(now);
  else if (mix.tgt.view !== 0 && mix.tgt.view !== 100) mix.tgt.view = mix.tgt.view >= 50 ? 100 : 0;
  cueStartScout();
  cueDeck(now);
  // A full list stays as it is until you clear a look (its ✕, or Shift + its number) or cut to one: no trying meanwhile
  if (cue.list.length >= CUE.max) { cue.trial = null; return true; }
  const T = cue.trial, k = cueHidden();
  if (!T) {
    const sc = cueScene(k);
    cueLoad('C', sc);
    cue.trial = { look: JSON.parse(JSON.stringify(loops.C.tgt)), since: now, frames: 0, nextCap: 0 };
    return true;
  }
  const age = (now - T.since) / 1000;
  if (age < CUE.judge) return true;
  const S = eye.hist.C.filter((s) => s.t >= T.since + CUE.settle * 1000);
  if (S.length < 3 && age < 10) return true;
  cue.trial = null;
  if (!S.length) return true;
  const v = tasteJudge(lookVerdict(S), k, T.look, S);
  checkTally(v, true);
  if (!v.pass) return true;
  // Never replaces a ready look: only fills an empty place
  if (cue.list.length >= CUE.max) return true;
  const item = { id: ++cue.n, look: T.look, v, pic: cueSnap(), t: now };
  cue.list.push(item);
  clipRead(item, T);
  cueStrip();
  apStatus();
  return true;
}
// Fade between looks (Cue mode switch, apSet.cueFade): instead of cutting, What you see slides from the look on
// screen to the next one over apSet.cueFadeSecs, eased in and out, starting on the frame you press. Pressing again
// while a fade is going finishes it at once and starts the next one.
const CUE_FADES = [0.5, 1, 2, 4, 8];
function cueFadeTick(now) {
  const F = cue.fade;
  if (!F) return;
  const t = Math.min(1, (now - F.t0) / F.ms), e = t * t * (3 - 2 * t);
  mix.tgt.view = mix.cur.view = F.from + (F.to - F.from) * e;
  if (t >= 1) { cue.fade = null; cueDeck(now); cueStrip(); apStatus(); }
}
// Next look in Cue mode: cuts (or starts fading) to the hidden loop on this very frame
function cueGo() {
  const now = performance.now();
  if (cue.fade) { mix.tgt.view = mix.cur.view = cue.fade.to; cue.fade = null; }
  if (!cue.deck || cue.deck.k !== cueHidden()) cueDeck(now);
  const k = cue.deck.k, id = cue.deck.id, to = k === 'B' ? 100 : 0;
  if (apSet.cueFade) { cue.fade = { from: mix.cur.view, to, t0: now, ms: Math.max(100, apSet.cueFadeSecs * 1000) }; }
  else mix.tgt.view = mix.cur.view = to;
  for (const f of ['xab', 'xba']) if (!ap.pins.has(f) && apOwnsMix(f)) mix.tgt[f] = mix.cur[f] = 0;
  if (id != null) cue.list = cue.list.filter((it) => it.id !== id);
  if (cue.pick === id) cue.pick = null;
  cue.deck = null;
  cue.cut = now;
  ap.cameIn = { k, at: now, gen: loops[k].gen };
  lookOnScreen++;
  eyeForget('comp');
  cueDeck(now);
  syncUI();
  cueStrip();
  apStatus();
}
// The previews under the picture
function cueStrip() {
  const el = $('#cueStrip');
  if (!el) return;
  const show = apSet.cue && apSet.cuePreviews && ap.on && !cueWhy();
  el.hidden = !show;
  if (!show) return;
  const next = cueNextItem(), slots = $$('#cueStrip .cue-pic');
  slots.forEach((b, i) => {
    const it = cue.list[i];
    const cv = b.querySelector('canvas');
    b.disabled = !it;
    b.dataset.id = it ? String(it.id) : '';
    const x = b.parentElement && b.parentElement.querySelector('.cue-x');
    if (x) x.hidden = !it;
    b.classList.toggle('next', !!it && next === it);
    b.classList.toggle('picked', !!it && cue.pick === it.id);
    if (it && b.dataset.drawn !== String(it.id) && it.pic) {
      cv.width = it.pic.width; cv.height = it.pic.height;
      cv.getContext('2d').drawImage(it.pic, 0, 0);
      b.dataset.drawn = String(it.id);
    } else if (!it && b.dataset.drawn) {
      cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
      b.dataset.drawn = '';
    }
    const name = it ? SRC_LABEL[it.look.in1] || it.look.in1 : '';
    b.querySelector('.cue-name').textContent = it ? (next === it ? 'Next · ' : '') + name : 'Looking…';
    b.title = it ? `${i + 1}: ${name}${next === it ? ' — this is the next look. Press Space (or L, or ' + (i + 1) + ' again) to cut to it.' : ' — click or press ' + (i + 1) + ' to make this the next look, then Space to cut'}. The ✕ (or Shift+${i + 1}) clears it.` : 'Autopilot is still looking for a good one';
  });
}
// Preview i (0 to 4) becomes the next look, the same from a click or keys 1 to 5. Clicking the picked one again
// un-picks it; pressing its number key again (byKey) cuts to it, so 3 then 3 on the hit works one-handed.
// Returns false when there's no ready look in that place yet.
function cuePickSlot(i, byKey) {
  const it = cue.list[i];
  if (!it) return false;
  if (cue.pick === it.id) {
    if (byKey) { nextLook(); return true; }
    cue.pick = null;
  } else cue.pick = it.id;
  cue.deck = null;
  cueDeck(performance.now());
  cueStrip();
  return true;
}
$$('#cueStrip .cue-pic').forEach((b, i) => b.addEventListener('click', () => {
  cuePickSlot(i, false);
  // Leaves the keyboard free, so Space straight after the click cuts instead of pressing this preview again
  b.blur();
}));
// The ✕ on a preview (or Shift + its number) clears that look off the list; Autopilot finds another to fill its place.
// If it was the next look, the next best one takes its place on the hidden loop.
function cueDrop(i) {
  const it = cue.list[i];
  if (!it) return false;
  cue.list.splice(i, 1);
  if (cue.pick === it.id) cue.pick = null;
  if (cue.deck && cue.deck.id === it.id) { cue.deck = null; if (cueActive()) cueDeck(performance.now()); }
  cueStrip();
  apStatus();
  return true;
}
$$('#cueStrip .cue-x').forEach((x, i) => x.addEventListener('click', (e) => {
  e.stopPropagation();
  cueDrop(i);
  x.blur();
}));
// Keys 1 to 5 (top row or number pad, so a number pad or foot pedal works) pick that preview
function cueKey(e) {
  const m = /^(?:Digit|Numpad)([1-5])$/.exec(e.code || '');
  if (!m) return false;
  if (e.repeat) return true;
  if (!cueActive()) {
    toast(cueWhy() || 'Keys 1 to 5 pick the next look in Cue mode. Turn it on under Autopilot › Cue mode.');
    return true;
  }
  const i = +m[1] - 1;
  if (e.shiftKey) { showOSD('CUE', cueDrop(i) ? `LOOK ${i + 1} CLEARED` : `NO LOOK ${i + 1} TO CLEAR`); return true; }
  if (cuePickSlot(i, true)) { if (cue.pick) showOSD('CUE', `LOOK ${i + 1} IS NEXT`); }
  else showOSD('CUE', `LOOK ${i + 1} ISN’T READY YET`);
  return true;
}
$('#cueStrip')?.addEventListener('pointerenter', () => { cue.hover = true; });
$('#cueStrip')?.addEventListener('pointerleave', () => { cue.hover = false; });
$('#cueGo')?.addEventListener('click', () => nextLook());
function syncCueUI() {
  $('#apCue')?.setAttribute('aria-pressed', String(apSet.cue));
  $('#apCueFade')?.setAttribute('aria-pressed', String(apSet.cueFade));
  $('#cueFadeBar')?.setAttribute('aria-pressed', String(apSet.cueFade));
  const fl = $('#cueFadeBarLabel');
  if (fl) fl.textContent = apSet.cueFade ? `Fade ${apSet.cueFadeSecs < 1 ? '½' : apSet.cueFadeSecs} s` : 'Cut';
  $$('#apCueFadeSecs button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.s === apSet.cueFadeSecs)));
  const fs = $('#apCueFadeSecs');
  if (fs) fs.hidden = !apSet.cueFade;
  const fc = $('#apCueFadeCtl');
  if (fc) fc.hidden = !apSet.cue;
  $('#apCuePrev')?.setAttribute('aria-pressed', String(apSet.cuePreviews));
  $$('#apCueLive button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.live === 'on') === apSet.cueLive)));
  const lv = $('#apCueLiveCtl');
  if (lv) lv.hidden = !apSet.cue || !apSet.cuePreviews;
  const p = $('#apCuePrevCtl');
  if (p) p.hidden = !apSet.cue;
  cueStrip();
}
$('#apCue')?.addEventListener('click', () => {
  apSet.cue = !apSet.cue;
  saveAp();
  if (apSet.cue) {
    if (!ap.on) setAutopilot(true, true);
    const why = cueWhy();
    toast(why || 'Cue mode is on. Autopilot leaves the picture alone and gets new looks ready out of sight. Press Space (or L) to cut to the next one on the hit. Keys 1 to 5 pick a preview to be next.', 9000);
  } else {
    cueSleep();
    ap.next = performance.now() + Math.min(7000, apEverySec() * 1000);
    ap.due = ap.next; ap.span = ap.next - performance.now();
    toast('Cue mode is off. Autopilot changes looks by itself again.');
  }
  syncCueUI();
  apStatus();
});
// Fade between looks: the switch under Cue mode, and the same switch beside Cut under the picture (for flipping it mid-set)
function cueSetFade(on) {
  apSet.cueFade = on;
  saveAp();
  syncCueUI();
  showOSD('CUE', on ? `FADE ${apSet.cueFadeSecs < 1 ? '½' : apSet.cueFadeSecs} S` : 'CUT');
}
$('#apCueFade')?.addEventListener('click', () => cueSetFade(!apSet.cueFade));
$('#cueFadeBar')?.addEventListener('click', (e) => { cueSetFade(!apSet.cueFade); e.currentTarget.blur(); });
$$('#apCueFadeSecs button').forEach((b) => b.addEventListener('click', () => { apSet.cueFadeSecs = +b.dataset.s; saveAp(); syncCueUI(); }));
$$('#apCueLive button').forEach((b) => b.addEventListener('click', () => {
  apSet.cueLive = b.dataset.live === 'on';
  saveAp();
  syncCueUI();
}));
$('#apCuePrev')?.addEventListener('click', () => {
  apSet.cuePreviews = !apSet.cuePreviews;
  saveAp();
  syncCueUI();
});
window.__plCue = { cue, loops, cueLiveOn, cueActive, cueGo, cueWhy, cuePickSlot, cueDrop, cueSetFade, apSet };
// For tests/ap_loops_check.py: a way in to Autopilot's loops
window.__plAp = { loops, ap, apSet, apTurn, dark, mix, eye, step() { ap.quick = 0; apStep(performance.now(), false); } };

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
const TASTE_FX = ['flow', 'melt', 'push', 'dye', 'split', 'grow', 'time', ...SELF, ...ASYM, ...SLIT];
const TASTE_RANGE = { flow: [30, 80], melt: [20, 80], push: [25, 80], dye: [20, 80], split: [10, 60], grow: [35, 85], time: [30, 90], offc: [30, 90], wind: [20, 80], scan: [50, 100], corr: [55, 100], ...SELF_RANGE };
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
  if (b.fx.includes('wind')) f.push('winddir:' + (L.windDir ?? 0));
  if (b.fx.includes('corr')) f.push('corrshape:' + (L.corrShape ?? 0));
  if (L.motion && LIVE.includes(L.in1)) f.push('motion:on');
  if (b.zoom === 'out') f.push('edge:' + (L.edge ? 'fold' : 'dark'));
  if (L.in1 === 'spectro' || L.in2 === 'spectro') f.push('spec:' + (L.specRound ? 'round' : 'scroll'));
  if (L.in1 === 'topo' || L.in2 === 'topo') f.push('topo:' + (L.topoPic ? 'picture' : 'land'));
  if (L.in1 === 'life' || L.in2 === 'life') f.push('life:' + (L.lifeCells ?? 1) + (L.lifeSpeed ?? 1) + (L.lifeLoop ? 'p' : 'r'));
  if (L.in1 === 'radar' || L.in2 === 'radar') f.push('radar:' + (L.radarWind ? 'wind' : 'rain'));
  if (L.in1 === 'texture' || L.in2 === 'texture') f.push('tex:' + (L.texStyle ?? 0));
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
  const P = activeKeys().map((k) => pics[k]).find((x) => loopUsesPic(x.key) && !x.own && x.cur >= 0);
  const p = P && nat.pics && nat.pics[P.cur];
  if (p) sc.nat = { f: p.f, c: p.c };
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
  if (src === 'video') return anyVid() || clipsReady();
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
  $('#apType').setAttribute('aria-pressed', String(apSet.type));
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
$('#apType').addEventListener('click', () => {
  apSet.type = !apSet.type;
  saveAp();
  syncApUI();
  toast(apSet.type ? 'Autopilot will bring Type art in with some new looks, and take it out with others.' : 'Autopilot leaves Type art alone now.');
});
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
    : 'Check each look is off. You’ll see every look Autopilot makes. It still keeps the picture from turning white or going black.');
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
  else if (cueActive()) {
    const n = cue.list.length, d = cue.deck;
    html = '<span class="live"></span><b>Cue mode.</b> Autopilot leaves the picture alone. ' +
      (n >= CUE.max ? `${n} looks ready (full: clear one with its ✕ to look for another). ` : n ? `${n} new look${n === 1 ? '' : 's'} ready. ` : 'Looking for good new looks… ') +
      (d && d.id != null && performance.now() - d.at > CUE.built * 1000 ? 'Press <b>Space</b> (or L) to cut to the next one; 1 to 5 pick a preview.'
        : d && d.id != null ? 'The next look is building up…' : 'Space (or L) still cuts to a new look, not yet checked.');
    if (ap.pins.size) html += ` ${ap.pins.size} pinned.`;
  } else {
    const cw = cueWhy();
    const s = Math.max(0, Math.round((ap.next - performance.now()) / 1000));
    const P = ap.prep, holding = P && P.hold && !P.ok;
    html = (cw ? `<b>${cw}</b> Until then Autopilot changes looks by itself. ` : '') + '<span class="live"></span><b>Autopilot is on.</b> ' +
      (holding ? 'New look as soon as one passes its check.'
        : ap.beatWait ? 'New look on the next beat.' : s <= 1 ? 'New look coming now.' : `Next new look in about ${s < 60 ? s + ' seconds' : fmtDur(s).toLowerCase()}.`);
    if (watch.easing) html += ` Easing off loop ${watch.easing} so it doesn’t turn white.`;
    else if (dark.lifting) html += ` Bringing loop ${dark.lifting} back up so it doesn’t go black.`;
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
  else if (cueActive()) { const n = cue.list.length; text = say(n ? `Cue · <b>${n}</b> ready` : 'Cue · looking…', n ? `<b>${n}</b> ready` : 'Looking'); }
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
syncCueUI();

/* ================= transport ================= */
const freezeBtn = $('#freeze');
function toggleFreeze(force) {
  frozen = typeof force === 'boolean' ? force : !frozen;
  if (freezeBtn) freezeBtn.setAttribute('aria-pressed', String(frozen));
  if (frozen) showOSD('II', 'FROZEN');
}
// Freeze, Clear, Full screen, Next look and Save picture no longer have buttons under the picture: Freeze is the
// Space key, Clear the C key, Full screen the F key (and Exit in full screen), Next look the L key (and Next look under
// Autopilot). The code below copes with the buttons being gone.
if (freezeBtn) freezeBtn.addEventListener('click', () => toggleFreeze());
function clearScreen() { clearTargets(); burst(); }
window.__plClear = clearScreen;   // for the tests (Clear has no button any more: the C key)
$('#clear')?.addEventListener('click', clearScreen);

const fullBtn = $('#full');
const fsEnabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
if (!fsEnabled && fullBtn) fullBtn.hidden = true;
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
if (fullBtn) fullBtn.addEventListener('click', toggleFS);
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
  if (fullBtn) fullBtn.textContent = active ? 'Exit full screen' : 'Full screen';
  fsExit.hidden = !active;
  fsTasteShow();
  if (active) fsWake(4000);
  else { clearTimeout(fsIdleT); fsExit.classList.remove('away'); fsTaste.classList.remove('away'); stage.classList.remove('idle'); }
  fit();
}));

/* ================= picture & video files ================= */
// What's in the Picture and the Video input right now (shared by every loop), so a sequencer block can remember it:
// a nature picture by its file, the test card, a library clip by its id, or a picture or video of your own by its
// file name. No copy of your own file is ever kept: where the browser offers it (Chrome, Edge), a pointer to the file
// on disk is kept instead (picHandle, vidHandle; see filePointerDB), and the file is opened from there each time.
const inMedia = {};
// The picture side is the edited loop's own picture's (each loop has its own: see pics)
Object.defineProperty(inMedia, 'pic', { get: () => pic.media, set: (m) => { pic.media = m; }, enumerable: true });
Object.defineProperty(inMedia, 'picHandle', { get: () => pic.handle, set: (h) => { pic.handle = h; }, enumerable: true });
// The video side is the edited loop's own player's (each loop has its own: see vids)
Object.defineProperty(inMedia, 'vid', { get: () => vid.media, set: (m) => { vid.media = m; }, enumerable: true });
Object.defineProperty(inMedia, 'vidHandle', { get: () => vid.handle, set: (h) => { vid.handle = h; }, enumerable: true });
// Files of your own picked this visit, by name, so a block can find its file again where there's no pointer to it
const ownFiles = new Map();
const picFile = $('#picFile'), vidFile = $('#vidFile');
// Chrome and Edge's own file picker hands back a pointer to the file as well; other browsers use the plain one
async function pickOwn(kind, input) {
  if (!window.showOpenFilePicker) { input.click(); return; }
  try {
    const [h] = await window.showOpenFilePicker({ types: [{ description: kind === 'image' ? 'Pictures' : 'Videos and GIFs', accept: kind === 'image' ? { 'image/*': [] } : { 'video/*': [], 'image/gif': ['.gif'], 'image/webp': ['.webp'] } }] });
    loadFile(await h.getFile(), h);
  } catch (e) { if (e?.name !== 'AbortError') input.click(); }
}
$('#pickPic').addEventListener('click', () => pickOwn('image', picFile));
$('#pickVid').addEventListener('click', () => pickOwn('video', vidFile));
picFile.addEventListener('change', () => { if (picFile.files[0]) loadFile(picFile.files[0]); picFile.value = ''; });
vidFile.addEventListener('change', () => { if (vidFile.files[0]) loadFile(vidFile.files[0]); vidFile.value = ''; });
function picUseCard(to = pic) {
  uploadTo(to.tex, testCard);
  to.aspect = 4 / 3;
  to.media = { ...CARD }; to.handle = null;
  natNoCredit(to);
  to.own = false;
  to.ask++;   // nor the test card
  picPanelSync();
}
$('#useCard').addEventListener('click', () => picUseCard());
// The Picture controls show the edited loop's picture
function picPanelSync() {
  $('#picName').textContent = pic.media?.name || 'the test card';
  $('#useCard').hidden = !pic.media || pic.media.kind === 'card';
  const credit = $('#picCredit');
  credit.innerHTML = pic.credit || '';
  credit.hidden = !pic.credit;
  natMark();
}
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
const vidPlay = $('#vidPlay');
vidPlay.addEventListener('click', () => {
  if (!vid.video) return;
  if (vid.video.paused) { vid.userPaused = false; vid.video.play().catch(() => {}); }
  else { vid.userPaused = true; vid.video.pause(); }
  vidPlay.textContent = vid.video.paused ? 'Play' : 'Pause';
});
function feedInto(src, k = edit) {
  const t = loops[k].tgt;
  if (t.in1 !== src && t.in2 !== src) t.in1 = src;
  settleDevices();
  syncUI();
  showOSD(`INPUT ${k}`, SRC_LABEL[src].toUpperCase());
}
/* ---- moving pictures (GIFs, and moving WebP / PNG, as GIPHY and the like hand out) ----
   A picture is drawn once, so a GIF fed in as a Picture would sit still on its first frame. A moving one is turned
   into a short looping video here instead (decoded with the browser's ImageDecoder, encoded to VP8 with VideoEncoder,
   wrapped in a small WebM below) and goes into the Video input, where it plays, loops and has the speed buttons,
   Save clip and the sequencer like any video. Nothing leaves the computer. */
const MOVING = { minSecs: 6, maxSecs: 60, maxFrames: 3000, maxSide: 1920, stickerSide: 720 };
const movingMade = new WeakMap();   // file -> its video (Promise), so a GIF picked again isn't made twice
// What kind of picture the file really is, from its first bytes (a dragged picture's type can be missing or wrong)
async function pictureKind(file) {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const s = (a, n) => String.fromCharCode(...b.slice(a, a + n));
  if (s(0, 4) === 'GIF8') return 'image/gif';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
  if (s(4, 4) === 'ftyp' && /avi[fs]/.test(s(8, 4))) return 'image/avif';
  return (file.type || '').startsWith('image/') ? file.type : '';
}
// A WebM file holding VP8 pictures. frames: [{ data: Uint8Array, ms, key }]
function webmFile(frames, w, h, durMs) {
  const enc = new TextEncoder();
  const cat = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let at = 0; for (const p of parts) { o.set(p, at); at += p.length; } return o; };
  const idB = (id) => { const o = []; for (let v = id; v > 0; v = Math.floor(v / 256)) o.unshift(v & 255); return Uint8Array.from(o); };
  const sizeB = (n) => { const o = new Uint8Array(8); o[0] = 1; for (let i = 7, v = n; i > 0; i--, v = Math.floor(v / 256)) o[i] = v & 255; return o; };
  const el = (id, ...kids) => { const body = cat(kids); return cat([idB(id), sizeB(body.length), body]); };
  const uint = (id, v) => { const o = []; do { o.unshift(v & 255); v = Math.floor(v / 256); } while (v > 0); return el(id, Uint8Array.from(o)); };
  const str = (id, v) => el(id, enc.encode(v));
  const flt = (id, v) => { const o = new Uint8Array(8); new DataView(o.buffer).setFloat64(0, v); return el(id, o); };
  const head = el(0x1A45DFA3, uint(0x4286, 1), uint(0x42F7, 1), uint(0x42F2, 4), uint(0x42F3, 8), str(0x4282, 'webm'), uint(0x4287, 2), uint(0x4285, 2));
  const info = el(0x1549A966, uint(0x2AD7B1, 1000000), str(0x4D80, 'Phosphor Loop'), str(0x5741, 'Phosphor Loop'), flt(0x4489, durMs));
  const tracks = el(0x1654AE6B, el(0xAE, uint(0xD7, 1), uint(0x73C5, 1), uint(0x83, 1), str(0x86, 'V_VP8'), uint(0x9C, 0), el(0xE0, uint(0xB0, w), uint(0xBA, h))));
  // One cluster per key picture (one at least every second, see below), so jumping around in it is quick
  const clusters = [];
  let cur = null;
  for (const f of frames) {
    if (f.key || !cur || f.ms - cur.t > 30000) { cur = { t: f.ms, blocks: [] }; clusters.push(cur); }
    const blk = new Uint8Array(4 + f.data.length);
    const rel = f.ms - cur.t;
    blk[0] = 0x81; blk[1] = (rel >> 8) & 255; blk[2] = rel & 255; blk[3] = f.key ? 0x80 : 0;
    blk.set(f.data, 4);
    cur.blocks.push(el(0xA3, blk));
  }
  const seg = el(0x18538067, info, tracks, ...clusters.map((c) => el(0x1F43B675, uint(0xE7, c.t), ...c.blocks)));
  return cat([head, seg]);
}
// Resolves to a video File made from a moving picture, or null when the picture doesn't move (or this browser can't
// make videos: then it goes in as a still picture, as before)
function movingToVideo(file) {
  if (movingMade.has(file)) return movingMade.get(file);
  const job = (async () => {
    if (!window.ImageDecoder || !window.VideoEncoder) return null;
    const type = await pictureKind(file);
    if (!/^image\/(gif|webp|png|avif|apng)$/.test(type) || !(await ImageDecoder.isTypeSupported(type).catch(() => false))) return null;
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
    try {
      await dec.tracks.ready;
      const tr = dec.tracks.selectedTrack;
      if (!tr || !tr.animated) return null;
      await dec.completed.catch(() => {});
      const count = Math.min(tr.frameCount, MOVING.maxFrames);
      if (count < 2) return null;
      // Each picture and how long it shows (browsers show very short GIF frames for a tenth of a second, as here)
      const pics = [];
      let total = 0;
      for (let i = 0; i < count && total < MOVING.maxSecs * 1e6; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        let d = image.duration || 0;
        if (d <= 10000) d = 100000;
        pics.push({ bmp: await createImageBitmap(image), d });
        image.close();
        total += d;
      }
      const src = pics[0].bmp;
      // A sticker: see-through parts in any of its pictures (looked at small, a few of them)
      const probe = new OffscreenCanvas(48, 48).getContext('2d', { willReadFrequently: true });
      let sticker = false;
      for (let i = 0; i < pics.length && !sticker; i += Math.max(1, Math.floor(pics.length / 6))) {
        probe.clearRect(0, 0, 48, 48); probe.drawImage(pics[i].bmp, 0, 0, 48, 48);
        const d = probe.getImageData(0, 0, 48, 48).data;
        let clear = 0;
        for (let j = 3; j < d.length; j += 4) if (d[j] < 200) clear++;
        sticker = clear > 48 * 48 * 0.02;
      }
      // Stickers are kept smaller: each of their frames is put back together as it plays (see stickerUnpack)
      const side = sticker ? MOVING.stickerSide : MOVING.maxSide;
      const s = Math.min(1, side / Math.max(src.width, src.height));
      const W = Math.max(2, Math.round(src.width * s / 2) * 2), H = Math.max(2, Math.round(src.height * s / 2) * 2);
      const VH = sticker ? H * 2 : H;   // a sticker's video: its picture on top, its see-through map under it
      const cfg = { codec: 'vp8', width: W, height: VH, bitrate: Math.max(4e6, Math.min(40e6, W * VH * 30 * 0.4)), framerate: 30 };
      if (!(await VideoEncoder.isConfigSupported(cfg).catch(() => ({}))).supported) return null;
      const cv = new OffscreenCanvas(W, VH), cx = cv.getContext('2d');
      const mask = sticker ? new OffscreenCanvas(W, H) : null, mx = mask && mask.getContext('2d');
      const out = [];
      let failed = null;
      const venc = new VideoEncoder({
        output: (chunk) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); out.push({ data, ms: Math.round(chunk.timestamp / 1000), key: chunk.type === 'key' }); },
        error: (e) => { failed = e; },
      });
      venc.configure(cfg);
      // Short ones are played through a few times over, so the video is long enough to trim and loops less often
      const rounds = Math.max(1, Math.min(20, Math.ceil(MOVING.minSecs * 1e6 / total)));
      let t = 0, lastKey = -1e9;
      for (let r = 0; r < rounds && !failed; r++) {
        for (const p of pics) {
          cx.fillStyle = '#000'; cx.fillRect(0, 0, W, VH);   // see-through parts show as black
          cx.drawImage(p.bmp, 0, 0, W, H);
          if (sticker) {
            // The see-through map: the sticker's shape filled white, on black, under the picture
            mx.globalCompositeOperation = 'copy'; mx.drawImage(p.bmp, 0, 0, W, H);
            mx.globalCompositeOperation = 'source-in'; mx.fillStyle = '#fff'; mx.fillRect(0, 0, W, H);
            cx.drawImage(mask, 0, H);
          }
          const vf = new VideoFrame(cv, { timestamp: t, duration: p.d });
          const key = t - lastKey >= 1e6;
          if (key) lastKey = t;
          venc.encode(vf, { keyFrame: key });
          vf.close();
          t += p.d;
          if (venc.encodeQueueSize > 30) await new Promise((res) => venc.addEventListener('dequeue', res, { once: true }));
        }
      }
      await venc.flush();
      venc.close();
      pics.forEach((p) => p.bmp.close());
      if (failed || !out.length) return null;
      out.sort((a, b) => a.ms - b.ms);
      const name = file.name || 'Moving picture.gif';
      const made = new File([webmFile(out, W, VH, t / 1000)], name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.webm', { type: 'video/webm' });
      made.sticker = sticker;
      return made;
    } finally { dec.close(); }
  })().catch(() => null);
  movingMade.set(file, job);
  return job;
}
// A file as something the Video input can play: a video as it is, a moving picture made into one, else null
async function asVideoFile(file) {
  if (!file) return null;
  if ((file.type || '').startsWith('video/')) return file;
  return movingToVideo(file);
}

// k: the loop it goes into (a drop picks one; otherwise the loop being edited)
function loadFile(file, handle = null, k = edit) {
  if (!file) return;
  if (!loops[k]) k = edit;
  const type = file.type || '';
  // A moving picture (a GIF and the like) goes in as a video, so it moves; a still one carries on as a picture
  if ((type.startsWith('image/') || !type) && !file.picChecked) {
    const isGif = /gif/i.test(type) || /\.gif$/i.test(file.name || '');
    if (isGif) toast(`Getting ${file.name || 'the GIF'} ready…`, 3000);
    movingToVideo(file).then((v) => {
      if (v) { loadMovingVideo(v, file.name || v.name, handle, k); return; }
      if (isGif && !(window.ImageDecoder && window.VideoEncoder)) toast('This browser can only show GIFs still. Chrome or Edge plays them.', 6000);
      if (!type) { pictureKind(file).then((k) => { if (k) { const f = new File([file], file.name, { type: k }); f.picChecked = true; loadFile(f, handle, k); } else toast('That file isn’t a picture or video.'); }); return; }
      file.picChecked = true;
      loadFile(file, handle, k);
    });
    return;
  }
  // A taste profile someone sent (see Taste profiles)
  if (/\.json$/i.test(file.name || '') || type === 'application/json') { tasteFileOpen(file); return; }
  if (type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const to = pics[k] || pic;
    img.onload = () => {
      const small = downscale(img);
      uploadTo(to.tex, small);
      to.aspect = img.naturalWidth / img.naturalHeight;
      URL.revokeObjectURL(url);
      to.media = { kind: 'own', name: file.name }; to.handle = handle; ownFiles.set(file.name, file);
      natNoCredit(to);
      to.own = true;
      to.ask++;   // a nature picture still on its way doesn't replace this one
      picPanelSync();
      feedInto('picture', k);
      toast(`Feeding ${file.name} into loop ${k}.`);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That picture couldn’t be opened. Try a JPG or PNG.'); };
    img.src = url;
  } else if (type.startsWith('video/')) {
    loadMovingVideo(file, file.name, handle, k);
  } else {
    toast('That file isn’t a picture or video.');
  }
}
// A video of your own (or a moving picture made into one: file is then its video, name the picture's) into the Video input
function loadMovingVideo(file, name, handle = null, k = edit) {
  const to = vids[k] || vid;
  to.ask++;   // a library clip still on its way doesn't replace this one
  openVideo(videoURL(file), name, { to }).then((ok) => {
    if (!ok) { toast(`${name} couldn’t be played.`); return; }
    to.media = { kind: 'own', name }; to.handle = handle; ownFiles.set(name, file);
    // A video of your own: Autopilot leaves it in place instead of bringing in library clips
    to.own = true;
    clipNoCredit(to);
  });
}
// Puts a video (an object URL) in as the Video input. quiet: in place without switching any loop to it (Autopilot,
// or the page opening). Resolves true once its first frame is ready, false if it can't be played.
// spare: loaded into the loop's spare player instead, paused and out of sight, for vidUseSpare to swap in later
function openVideo(url, name, { quiet = false, to = vid, spare = false } = {}) {
  return new Promise((resolve) => {
    const v = mkVideo();
    v.loop = true;
    if (spare) { v.autoplay = false; v.preload = 'auto'; }
    v.src = url;
    v.addEventListener('loadeddata', () => {
      if (spare) { vidDropSpare(to); to.spare = { v, url, name }; resolve(true); return; }
      if (to.url) URL.revokeObjectURL(to.url);
      to.url = url;
      to.attach(v, null);
      to.userPaused = false;
      to.name = name;
      to.loopA = null; to.loopB = null;
      v.playbackRate = to.rate;
      if (to === vid) snipCloseForm();
      vidPanelSync();
      if (quiet) settleDevices();   // plays only while a loop uses it
      else { feedInto('video', to.key); toast(`Feeding ${name} into loop ${to.key}.`); }
      resolve(true);
    }, { once: true });
    v.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      if (!quiet) toast('That video couldn’t be played here. Try an MP4 or WebM file.');
      resolve(false);
    }, { once: true });
    if (!spare) v.play().catch(() => {});
  });
}
// A loop's spare player: in a sequence with two video blocks back to back on one track, the next block's video
// waits in it, paused at its start point, while the first still plays; when its block comes in it takes over at
// once (no black), and the player it replaces is let go. At most one spare per loop, and only while it's needed.
function vidDropSpare(to) {
  const sp = to.spare;
  if (!sp) return;
  to.spare = null;
  URL.revokeObjectURL(sp.url);
  sp.v.removeAttribute('src'); sp.v.load();
}
function vidUseSpare(to) {
  const sp = to.spare;
  if (!sp) return false;
  to.spare = null;
  const old = to.video;
  if (to.url) URL.revokeObjectURL(to.url);
  to.url = sp.url;
  sp.v.autoplay = true;
  to.attach(sp.v, null);
  if (old && old !== sp.v) { old.removeAttribute('src'); old.load(); }
  to.userPaused = false;
  to.name = sp.name;
  to.loopA = null; to.loopB = null;
  sp.v.playbackRate = to.rate;
  to.media = sp.media || null; to.handle = sp.handle || null;
  to.clip = sp.clip || ''; to.own = !!sp.own; to.credit = sp.credit || '';
  if (to === vid) snipCloseForm();
  vidPanelSync();
  settleDevices();
  return true;
}
// The Video controls show the edited loop's own video, or say whose video it's showing when it has none of its own
function vidPanelSync() {
  const st = $('#vidStatus');
  if (!st) return;
  if (vid.on) {
    const others = KEYS.some((k) => k !== vid.key && vids[k].on);
    say(st, `<span class="live"></span><b>${escapeHTML(vid.name)}</b>${others ? ` <span class="vid-whose">· loop ${vid.key}’s own video</span>` : ''}`);
    $('#vcr').hidden = false;
    vidPlay.textContent = vid.video.paused ? 'Play' : 'Pause';
    $('#vidDur').textContent = fmtT(vid.video.duration);
  } else {
    const other = vidFor(vid.key);
    say(st, other.on ? `Loop ${vid.key} is showing loop ${other.key}’s video, <b>${escapeHTML(other.name)}</b>. Pick a video here to give loop ${vid.key} its own.`
      : 'No video chosen yet.');
    $('#vcr').hidden = true;
  }
  $$('#vidSpeed button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.rate === vid.rate)));
  const credit = $('#clipCredit');
  credit.innerHTML = vid.credit; credit.hidden = !vid.credit;
  loopText();
  clipMark();
}
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ================= nature pictures ================= */
// About 500 photos from Wikimedia Commons' Featured Pictures live in the nature folder, listed in
// nature/pictures.json. The list loads the first time it's needed, the small thumbnails only when the
// gallery opens, and a full picture only when it's picked.
const nat = { pics: null, cats: [], cat: 'all', req: null, built: false };   // the nature picture list (which one each loop shows is in pics)
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
// Each loop's last nature picture is kept for next time (loop A's under the name it always had)
const natLastKey = (k) => (k === 'A' ? NAT_LAST_KEY : NAT_LAST_KEY + '-' + k);
function natNoCredit(to = pic) {
  to.cur = -1; to.credit = '';
  try { localStorage.removeItem(natLastKey(to.key)); } catch (_) { /* fine */ }
  if (to === pic) { $('#picCredit').hidden = true; natMark(); }
}
function natMark() {
  for (const t of natGrid.children) t.setAttribute('aria-current', String(+t.dataset.i === pic.cur));
}
// quiet: put the picture in place without switching any loop to it (used when the page opens). to: the loop's
// picture it goes into (the edited loop's unless said)
function natPick(i, quiet, to = pic) {
  const p = nat.pics && nat.pics[i];
  if (!p) return;
  const ask = ++to.ask;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (ask !== to.ask) return;   // a later pick overtook this one
    uploadTo(to.tex, downscale(img));
    to.aspect = img.naturalWidth / img.naturalHeight;
    to.media = { kind: 'nature', f: p.f, name: p.n }; to.handle = null;
    to.cur = i;
    to.own = false;
    to.credit = `Photo: ${escapeHTML(p.by)} · <a href="${escapeHTML(p.src)}" target="_blank" rel="noopener">${escapeHTML(p.lic)}</a>`;
    if (to === pic) picPanelSync();
    try { localStorage.setItem(natLastKey(to.key), p.f); } catch (_) { /* fine */ }
    if (quiet) return;
    const was = loopUsesPic(to.key);
    feedInto('picture', to.key);
    if (was) showOSD('PICTURE', p.n.toUpperCase());
  };
  img.onerror = () => { if (ask === to.ask && !quiet) toast('That picture couldn’t be loaded. It needs internet the first time.'); };
  img.src = `nature/${p.f}.jpg`;
}
function natStep(dir) {
  natList().then(() => {
    const shown = natShown();
    if (!shown.length) return;
    const at = shown.indexOf(pic.cur);
    const next = at < 0 ? (dir > 0 ? 0 : shown.length - 1) : (at + dir + shown.length) % shown.length;
    natPick(shown[next]);
  }).catch(natNoList);
}
function natShuffle() {
  natList().then(() => {
    const shown = natShown().filter((i) => i !== pic.cur);
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
    $('#natHint').textContent = `Tap a piece to feed it into loop ${edit}. ◀ ▶ and Shuffle beside Picture flip through this kind without opening the gallery.`;
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
  // (a loop with none of its own kept, as before this was per loop, starts from loop A's)
  for (const k of KEYS) {
    let last = null;
    try { last = localStorage.getItem(natLastKey(k)) || localStorage.getItem(NAT_LAST_KEY); } catch (_) { /* fine */ }
    const to = pics[k];
    if (last) natList().then((all) => { const i = all.findIndex((p) => p.f === last); if (i >= 0 && to.cur < 0 && !to.own) natPick(i, true, to); }).catch(() => {});
  }
})();

/* ================= generative art ================= */
// The Generative art input: moving pieces made with jdxyw/generativeart's genart tool (its animated generators:
// turning ribbons and solids, mandalas whose colours wheel round, flowing fields), each an 8-second seamless loop,
// 1024 square, as WebM (<f>.webm, a still <f>-t.jpg and a small moving preview <f>-p.webm for the gallery).
// Listed in genart/pictures.json, loaded like the nature pictures: the list when first needed, previews when the
// gallery opens, the full video when it's picked. Each loop plays its own (gens), kept for next time; a loop
// switched to Generative art with none yet gets its last one, or one at random.
const gen = { pics: null, cats: [], cat: 'all', req: null, built: false };
const GEN_TAB_KEY = 'phosphor-genart-tab', GEN_LAST_KEY = 'phosphor-genart-last-';
try { gen.cat = localStorage.getItem(GEN_TAB_KEY) || 'all'; } catch (_) { /* fine, start on All */ }
const genDlg = $('#gen'), genGrid = $('#genGrid'), genTabs = $('#genTabs');
function genList() {
  if (!gen.req) {
    gen.req = fetch('genart/pictures.json')
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => {
        gen.pics = d.pics || [];
        gen.cats = d.cats || [];
        if (gen.cat !== 'all' && !gen.cats.some((c) => c.id === gen.cat)) gen.cat = 'all';
        return gen.pics;
      })
      .catch((e) => { gen.req = null; throw e; });
  }
  return gen.req;
}
function genNoList() { toast('The generative art couldn’t be loaded. It needs internet.'); }
function genKind() {
  const all = gen.pics.map((_, i) => i);
  return gen.cat === 'all' ? all : all.filter((i) => gen.pics[i].c === gen.cat);
}
// A loop that shows Generative art with no picture yet gets its last one, or one at random from the kind chosen
function genEnsure(g) {
  if (g.at >= 0 || g.want) return;
  g.want = '…';
  genList().then(() => {
    if (g.at >= 0) return;
    let last = null;
    try { last = localStorage.getItem(GEN_LAST_KEY + g.key); } catch (_) { /* fine */ }
    const at = gen.pics.findIndex((p) => p.f === last);
    const shown = genKind();
    genPick(at >= 0 ? at : pick(shown.length ? shown : gen.pics.map((_, i) => i)), true, g);
  }).catch(() => { g.want = ''; });
}
function genMark() {
  const g = gens[edit];
  for (const t of genGrid.children) t.setAttribute('aria-current', String(+t.dataset.i === g.at));
}
function genPanelSync() {
  const g = gens[edit], p = gen.pics && gen.pics[g.at];
  $('#genName').textContent = p ? p.n : 'one is on its way';
  genMark();
}
// quiet: put the piece in place without switching the loop to it. to: the loop's own player (the edited loop's unless
// said). The new video takes over once its first frame is in, so the old one plays until then (never a black gap).
function genPick(i, quiet, to = gens[edit]) {
  const p = gen.pics && gen.pics[i];
  if (!p) return;
  const ask = ++to.ask;
  to.want = p.f;
  const v = mkVideo();
  v.loop = true;
  v.preload = 'auto';
  v.addEventListener('loadeddata', () => {
    if (ask !== to.ask) { v.removeAttribute('src'); v.load(); return; }   // a later pick overtook this one
    to.attach(v);
    to.aspect = v.videoWidth / v.videoHeight || 1;
    to.at = i; to.f = p.f;
    try { localStorage.setItem(GEN_LAST_KEY + to.key, p.f); } catch (_) { /* fine */ }
    if (to === gens[edit]) genPanelSync();
    genPlay();
    if (quiet) return;
    const t = loops[to.key].tgt, was = t.in1 === 'genart' || t.in2 === 'genart';
    feedInto('genart', to.key);
    if (was) showOSD('GENERATIVE ART', p.n.toUpperCase());
  }, { once: true });
  v.addEventListener('error', () => {
    if (ask !== to.ask) return;
    to.want = to.f;
    if (!quiet) toast('That piece couldn’t be loaded. It needs internet.');
  }, { once: true });
  v.src = `genart/${p.f}.webm`;
}
// A player plays only while a loop shows it (on screen, or Cue mode's scout and previews); the others wait paused
function genShown(g) { return extraKeys().some((k) => loopUsesGen(loops[k].tgt) && genTarget(k) === g); }
function genPlay() {
  for (const g of Object.values(gens)) {
    if (!g.video) continue;
    const used = genShown(g);
    if (used && g.video.paused) g.video.play().catch(() => {});
    if (!used && !g.video.paused) g.video.pause();
  }
}
function genTick() {
  genPlay();
  for (const g of Object.values(gens)) if (g.video && !g.video.paused) g.update();
}
// By name (the sequencer's blocks keep which one they had)
function genPickF(f, K) {
  const to = gens[K];
  if (!to || to.f === f) return;
  genList().then(() => { const i = gen.pics.findIndex((p) => p.f === f); if (i >= 0) genPick(i, true, to); }).catch(() => {});
}
function genStep(dir) {
  genList().then(() => {
    const shown = genKind();
    if (!shown.length) return;
    const at = shown.indexOf(gens[edit].at);
    const next = at < 0 ? (dir > 0 ? 0 : shown.length - 1) : (at + dir + shown.length) % shown.length;
    genPick(shown[next]);
  }).catch(genNoList);
}
function genShuffle() {
  genList().then(() => {
    const shown = genKind().filter((i) => i !== gens[edit].at);
    if (shown.length) genPick(pick(shown));
  }).catch(genNoList);
}
function genBuild() {
  if (gen.built) return;
  gen.built = true;
  const count = (id) => (id === 'all' ? gen.pics.length : gen.pics.filter((p) => p.c === id).length);
  for (const c of [{ id: 'all', n: 'All' }, ...gen.cats]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.cat = c.id;
    if (c.d) b.title = c.d;
    b.innerHTML = `${escapeHTML(c.n)} <b>${count(c.id)}</b>`;
    b.addEventListener('click', () => {
      gen.cat = c.id;
      try { localStorage.setItem(GEN_TAB_KEY, c.id); } catch (_) { /* fine */ }
      genFilter();
      genDlg.scrollTop = 0;
    });
    genTabs.appendChild(b);
  }
  const frag = document.createDocumentFragment();
  gen.pics.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'nat-tile';
    b.dataset.i = i;
    b.title = p.n;
    b.innerHTML = `<video muted loop playsinline preload="none" poster="genart/${escapeHTML(p.f)}-t.jpg" src="genart/${escapeHTML(p.f)}-p.webm"></video><span>${escapeHTML(p.n)}</span>`;
    frag.appendChild(b);
  });
  genGrid.appendChild(frag);
  genGrid.addEventListener('click', (e) => {
    const t = e.target.closest('.nat-tile');
    if (!t) return;
    genPick(+t.dataset.i);
    closeGen();
  });
}
function genFilter() {
  for (const b of genTabs.children) b.setAttribute('aria-pressed', String(b.dataset.cat === gen.cat));
  for (const t of genGrid.children) t.hidden = gen.cat !== 'all' && gen.pics[+t.dataset.i].c !== gen.cat;
  genTiles();
  $('#genCount').textContent = `${genKind().length} PIECES`;
}
// The gallery's small previews move while it's open (only the kind shown)
function genTiles() {
  for (const t of genGrid.children) {
    const v = t.querySelector('video');
    if (!v) continue;
    if (!genDlg.hidden && !t.hidden) v.play().catch(() => {}); else v.pause();
  }
}
let genReturn = null;
function openGen() {
  genList().then(() => {
    if (!genDlg.hidden) return;
    genBuild();
    genFilter();
    genMark();
    $('#genHint').textContent = `Tap a piece to feed it into loop ${edit}. ◀ ▶ and Shuffle beside Generative art flip through this kind without opening the gallery.`;
    genReturn = document.activeElement;
    genDlg.hidden = false;
    genTiles();
    document.documentElement.style.overflow = 'hidden';
    const cur = genGrid.querySelector('[aria-current="true"]:not([hidden])');
    if (cur) cur.scrollIntoView({ block: 'center' }); else genDlg.scrollTop = 0;
    (cur || $('#genClose')).focus({ preventScroll: true });
  }).catch(genNoList);
}
function closeGen() {
  if (genDlg.hidden) return;
  genDlg.hidden = true;
  genTiles();
  document.documentElement.style.overflow = '';
  if (genReturn && genReturn.focus) genReturn.focus();
}
$('#genOpen').addEventListener('click', openGen);
$('#genClose').addEventListener('click', closeGen);
$('#genShuffle').addEventListener('click', genShuffle);
$('#genShuffle2').addEventListener('click', () => { genShuffle(); closeGen(); });
$('#genPrev').addEventListener('click', () => genStep(-1));
$('#genNext').addEventListener('click', () => genStep(1));
genDlg.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); closeGen(); }
  else e.stopPropagation(); // keep the keys from firing while browsing
});
// For tests/genart_check.py
window.__plGen = () => ({ count: gen.pics ? gen.pics.length : 0, edit,
  loops: Object.fromEntries(KEYS.map((k) => [k, { f: gens[k].f, at: gens[k].at, frames: gens[k].frames, playing: !!gens[k].video && !gens[k].video.paused, t: gens[k].video ? gens[k].video.currentTime : null, aspect: gens[k].aspect, in1: loops[k].tgt.in1, in2: loops[k].tgt.in2 }])) });
// Autopilot: every 1 to 3 new looks that use Generative art, a different one (from the kind chosen in the gallery)
function apGenart(k) {
  const to = k && gens[k];
  if (!to || !apAllowed('genart')) return;
  const t = loops[k].tgt;
  if (t.in1 !== 'genart' && t.in2 !== 'genart') return;
  if (to.apIn > 1) { to.apIn--; return; }
  to.apIn = apPicGap();
  genList().then(() => {
    const shown = genKind().filter((i) => i !== to.at);
    if (shown.length) genPick(pick(shown), true, to);
  }).catch(() => { /* keep the one there is */ });
}

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
// clips.all: everything Phosphor Clips shares; clips.web: the clips grabbed from the web (Autopilot and the Video
// input's gallery use these); clips.list/cats/folders: what the explorer shows now (clipsSetView)
const clips = { base: '', list: null, cats: [], at: 0, req: null, cat: 'all', off: [], all: null, web: null, allCats: [], allFolders: [], view: 'clips' };
// Which clip is in, whether it's a video of your own, and the latest ask are each loop's own (the edited loop's here)
for (const [key, field] of [['cur', 'clip'], ['own', 'own'], ['ask', 'ask']]) {
  Object.defineProperty(clips, key, { get: () => vid[field], set: (v) => { vid[field] = v; }, enumerable: true });
}
// The Look library: Save clip's looks (recordings of the settings, and trims saved with their look), in Phosphor
// Clips' Looks folder (1.9 and later), kept apart from the web clips: its own button and window, never Autopilot's
const LOOKS = 'looks';
const hasLooks = () => clips.allCats.some((c) => c.id === LOOKS);
function clipsSetView(v) {
  clips.view = v;
  const inView = (cid) => v === 'all' || (v === 'looks' ? cid === LOOKS : cid !== LOOKS);
  clips.list = clips.all ? clips.all.filter((c) => inView(c.c)) : null;
  clips.cats = clips.allCats.filter((c) => inView(c.id));
  clips.folders = clips.allFolders.filter((f) => inView(f.c));
  if (clips.cat !== 'all' && !clips.cats.some((c) => c.id === clips.cat)) clips.cat = 'all';
  return clips.list;
}
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
        clips.all = Array.isArray(d.clips) ? d.clips : [];
        clips.web = clips.all.filter((c) => c.c !== LOOKS);
        clips.allCats = Array.isArray(d.cats) ? d.cats : [];
        // Subfolders inside the categories (Phosphor Clips 1.7 and later), empty ones too
        clips.allFolders = Array.isArray(d.folders) ? d.folders.filter((f) => f && typeof f.c === 'string' && typeof f.p === 'string') : [];
        clips.at = performance.now();
        clipsSetView(clips.view);
        if (clips.cat !== 'all' && !clips.list.some((c) => c.c === clips.cat)) clips.cat = 'all';
        return clips.list;
      } catch (e) { why = e; } finally { clearTimeout(t); }
    }
    // Asked again and no answer (busy for a moment, or closed): the clips it gave last time stay listed, so the explorer
    // and edits don't trip over an empty library; only a page that never heard from it has none
    if (!clips.list) clips.list = null;
    throw why || new Error('Phosphor Clips didn’t answer');
  })();
  clips.req.then(() => { clips.req = null; }, () => { clips.req = null; });
  return clips.req;
}
const clipCatName = (id) => { const c = clips.cats.find((x) => x.id === id); return c ? c.n : id; };
// The clips Autopilot may bring in: those in the ticked categories
const clipsAp = () => (clips.web || []).filter((c) => !clips.off.includes(c.c));
const clipsReady = () => !!clips.web && clipsAp().length > 0 && clipsWanted();
// The clips in the gallery's chosen category (or all of them)
const clipsShown = () => (clips.web || []).filter((c) => clips.cat === 'all' || c.c === clips.cat);
function clipNoCredit(to = vid) {
  to.clip = ''; to.credit = '';
  if (to.key === 'A') { try { localStorage.removeItem(CLIP_LAST_KEY); } catch (_) { /* fine */ } }
  if (to === vid) $('#clipCredit').hidden = true;
  clipMark();
}
function clipMark() {
  for (const t of clipsGrid.children) t.setAttribute('aria-current', String(t.dataset.id === clips.cur));
}
// Feeds a library clip in as the Video input. quiet: in place, without switching a loop to Video (Autopilot, or
// bringing back the last clip when the page opens). Resolves true once it's showing.
function clipPick(c, quiet, to = vid, spare = false) {
  if (!c || !clips.base) return Promise.resolve(false);
  // (a spare doesn't count as a new pick: a pick of yours meanwhile still wins over it)
  const ask = spare ? to.ask : ++to.ask;
  return fetch(`${clips.base}/clip/${encodeURIComponent(c.id)}`, clipFetchOpts())
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
    .then((blob) => {
      if (ask !== to.ask) return false;   // a later pick (or a video of your own) overtook this one
      const url = URL.createObjectURL(blob);
      if (clipIsSticker(c)) stickerURLs.add(url);
      return openVideo(url, c.n, { quiet, to, spare }).then((ok) => {
        if (!ok || ask !== to.ask) return ok;
        const from = c.src && /^https?:/.test(c.src)
          ? ` · <a href="${escapeHTML(c.src)}" target="_blank" rel="noopener">${escapeHTML(c.by || 'source')}</a>` : (c.by ? ` · ${escapeHTML(c.by)}` : '');
        const credit = `Clip library: ${escapeHTML(clipCatName(c.c))}${from}${c.lic ? ' · ' + escapeHTML(c.lic) : ''}`;
        if (spare) { if (to.spare) Object.assign(to.spare, { media: { kind: 'clip', id: c.id, name: c.n }, clip: c.id, own: false, credit }); return !!to.spare; }
        to.media = { kind: 'clip', id: c.id, name: c.n }; to.handle = null;
        to.clip = c.id;
        to.own = false;
        to.credit = credit;
        vidPanelSync();
        // The clip loop A had last time comes back with the page
        if (to.key === 'A') { try { localStorage.setItem(CLIP_LAST_KEY, c.id); } catch (_) { /* fine */ } }
        return true;
      });
    })
    .catch(() => {
      if (ask === to.ask && !quiet) toast('That clip couldn’t be loaded. Is Phosphor Clips still running?');
      return false;
    });
}
function clipShuffle() {
  clipList().then(() => {
    const shown = clipsShown().filter((c) => c.id !== clips.cur);
    if (shown.length) clipPick(pick(shown));
    else toast((clips.web || []).length ? 'There’s no other clip in this category.' : 'The clip library is empty. Save some clips with Phosphor Clips.');
  }).catch(() => openClips('video'));
}
function clipsSay(html) {
  $('#clipsMsg').hidden = !html;
  $('#clipsMsgText').innerHTML = html || '';
}
/* ---------- the clip explorer: search, tags, saved effects ---------- */
// The Clip library window is an explorer for a library of thousands: categories, a search over names and tags
// (every word has to match), tags to click, an order, and a grid drawn a page at a time as you scroll. Clicking a
// clip shows it at the side with its name, category, tags and saved effects, all changeable (saved in Phosphor Clips,
// in the clip's settings file, so they travel with it). Double-click, or the two buttons, uses it: with its effects
// (the whole picture saved with it, like a preset) or just the clip. Opened from the sequencer's + Add clip…, the
// buttons add it to the chosen track instead. Ctrl-click and Shift-click pick several, to tag them or copy them.
const CX_PAGE = 120;
const cx = { mode: 'video', q: '', sort: 'new', tags: [], sel: new Set(), anchor: '', shown: [], drawn: 0, obs: null,
  folder: lsGet('phosphor-clips-folder') || '', open: new Set() };
const cxClip = (id) => (clips.all || []).find((c) => c.id === id) || null;
const cxText = (c) => `${c.n} ${(c.tags || []).join(' ')} ${clipCatName(c.c)} ${c.p || ''} ${c.page || ''} ${c.by || ''}`.toLowerCase();
// In the folder picked in the tree: its category, and that subfolder or any folder inside it
const inFolder = (c, cat, sub) => (cat === 'all' || c.c === cat) && (!sub || c.p === sub || (c.p || '').startsWith(sub + '/'));
function cxFiltered() {
  const words = cx.q.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const list = (clips.list || []).filter((c) => inFolder(c, clips.cat, clips.cat === 'all' ? '' : cx.folder)
    && cx.tags.every((t) => (c.tags || []).includes(t))
    && (!words.length || (() => { const t = cxText(c); return words.every((w) => t.includes(w)); })()));
  const by = {
    new: (a, b) => String(b.added || '').localeCompare(String(a.added || '')),
    name: (a, b) => a.n.localeCompare(b.n, undefined, { numeric: true, sensitivity: 'base' }),
    long: (a, b) => (b.d || 0) - (a.d || 0),
    short: (a, b) => (a.d || 0) - (b.d || 0),
  }[cx.sort] || (() => 0);
  return list.sort(by);
}
// Every tag in the library with how many clips have it, most used first
function cxAllTags() {
  const n = new Map();
  for (const c of clips.list || []) for (const t of c.tags || []) n.set(t, (n.get(t) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function clipsBuild() {
  const list = clips.list || [];
  const count = (id) => (id === 'all' ? list.length : list.filter((c) => c.c === id).length);
  const cats = clips.cats.filter((c) => count(c.id) > 0);
  if (clips.cat !== 'all' && !clips.cats.some((c) => c.id === clips.cat)) clips.cat = 'all';
  if (clips.cat === 'all' || !cxFolders(clips.cat).includes(cx.folder)) cx.folder = '';
  cxTreeBuild();
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
  $('#clipsAp').hidden = !cats.length || cx.mode !== 'video';
  cxTagsBuild();
  // Picked clips that have gone from the library are unpicked
  for (const id of [...cx.sel]) if (!cxClip(id)) cx.sel.delete(id);
}
/* the folder tree: All clips, each category, and the subfolders inside it (as deep as they go) */
// Every subfolder of a category: the ones Phosphor Clips lists (empty ones too) and the ones its clips sit in, with
// every folder above them
function cxFolders(cat) {
  const set = new Set();
  const add = (p) => { const parts = String(p || '').split('/').filter(Boolean); for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/')); };
  for (const f of clips.folders || []) if (f.c === cat) add(f.p);
  for (const c of clips.list || []) if (c.c === cat && c.p) add(c.p);
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}
const cxKey = (cat, sub) => `${cat}|${sub}`;
function cxTreeBuild() {
  const box = clipsTabs, list = clips.list || [];
  box.textContent = '';
  // The folder picked stays visible: every folder above it is open
  if (clips.cat !== 'all') {
    cx.open.add(cxKey(clips.cat, ''));
    const parts = cx.folder.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) cx.open.add(cxKey(clips.cat, parts.slice(0, i).join('/')));
  }
  const node = (cat, sub, name, n, depth, kids) => {
    const row = document.createElement('div');
    row.className = 'cx-node';
    row.style.setProperty('--d', depth);
    row.setAttribute('role', 'treeitem');
    const key = cxKey(cat, sub), open = cx.open.has(key);
    if (kids) row.setAttribute('aria-expanded', String(open));
    const tw = document.createElement('button');
    tw.type = 'button'; tw.className = 'cx-tw'; tw.disabled = !kids;
    tw.textContent = open ? '▾' : '▸';
    tw.setAttribute('aria-label', open ? `Close ${name}` : `Open ${name}`);
    tw.addEventListener('click', () => { if (cx.open.has(key)) cx.open.delete(key); else cx.open.add(key); cxTreeBuild(); });
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cx-fold'; b.dataset.cat = cat; b.dataset.sub = sub;
    b.setAttribute('aria-current', String(clips.cat === cat && (cat === 'all' || cx.folder === sub)));
    b.innerHTML = `<span>${escapeHTML(name)}</span><b>${n}</b>`;
    b.addEventListener('click', () => cxGoFolder(cat, sub));
    row.append(tw, b);
    box.appendChild(row);
    return open;
  };
  node('all', '', clips.view === 'looks' ? 'All looks' : 'All clips', list.length, 0, false);
  for (const c of clips.cats) {
    const folders = cxFolders(c.id);
    const mine = list.filter((x) => x.c === c.id);
    const walk = (sub, depth) => {
      // depth: how many folders down this one is (0: the category itself)
      const kids = folders.filter((f) => f.split('/').length === depth + 1 && (!sub || f.startsWith(sub + '/')));
      const n = mine.filter((x) => inFolder(x, c.id, sub)).length;
      const open = node(c.id, sub, sub ? sub.split('/').pop() : c.n, n, depth, kids.length > 0);
      if (open) for (const k of kids) walk(k, depth + 1);
    };
    walk('', 0);
  }
}
function cxGoFolder(cat, sub) {
  clips.cat = cat;
  cx.folder = cat === 'all' ? '' : sub;
  try { localStorage.setItem(CLIP_TAB_KEY, cat); localStorage.setItem('phosphor-clips-folder', cx.folder); } catch (_) { /* fine */ }
  if (cat !== 'all') cx.open.add(cxKey(cat, sub));
  $('#cxNewForm').hidden = true;
  cxTreeBuild();
  clipsFilter();
  clipsDlg.scrollTop = 0;
}
// Folder pickers (a clip's folder, Move them to, the snip's folder): every category and every folder in it,
// as "cat|sub/folder"
function folderOptions(sel, value, first) {
  sel.textContent = '';
  if (first) { const o = document.createElement('option'); o.value = ''; o.textContent = first; sel.appendChild(o); }
  for (const c of clips.cats) {
    const o = document.createElement('option'); o.value = cxKey(c.id, ''); o.textContent = c.n; sel.appendChild(o);
    for (const f of cxFolders(c.id)) {
      const x = document.createElement('option');
      x.value = cxKey(c.id, f);
      x.textContent = `${'\u2003'.repeat(f.split('/').length)}${f.split('/').pop()}`;
      x.title = [c.n, ...f.split('/')].join(' › ');
      sel.appendChild(x);
    }
  }
  if (value != null) sel.value = value;
}
const splitKey = (v) => { const i = String(v).indexOf('|'); return i < 0 ? { c: String(v), p: '' } : { c: v.slice(0, i), p: v.slice(i + 1) }; };
// The tag chips: the 40 most used, plus any being filtered by; clicking one filters by it (several: all of them)
function cxTagsBuild() {
  const all = cxAllTags();
  cx.tags = cx.tags.filter((t) => all.some(([x]) => x === t));
  const box = $('#cxTags');
  box.textContent = '';
  const top = all.slice(0, 40).map(([t]) => t);
  for (const t of cx.tags) if (!top.includes(t)) top.push(t);
  for (const t of top) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.tag = t;
    b.innerHTML = `#${escapeHTML(t)} <b>${all.find(([x]) => x === t)?.[1] || 0}</b>`;
    b.setAttribute('aria-pressed', String(cx.tags.includes(t)));
    b.addEventListener('click', () => {
      cx.tags = cx.tags.includes(t) ? cx.tags.filter((x) => x !== t) : [...cx.tags, t];
      b.setAttribute('aria-pressed', String(cx.tags.includes(t)));
      clipsFilter();
    });
    box.appendChild(b);
  }
  const dl = $('#cxTagSuggest');
  dl.textContent = '';
  for (const [t] of all) { const o = document.createElement('option'); o.value = t; dl.appendChild(o); }
}
function cxTile(c) {
  const b = document.createElement('button');
  b.className = 'nat-tile';
  b.dataset.id = c.id;
  b.dataset.c = c.c;
  b.title = `${c.n} (${clipCatName(c.c)})${c.tags && c.tags.length ? ' · ' + c.tags.map((t) => '#' + t).join(' ') : ''}`;
  b.setAttribute('aria-selected', String(cx.sel.has(c.id)));
  b.setAttribute('aria-current', String(c.id === clips.cur));
  // (a sticker's thumbnail is its picture over its see-through map: only the top half, the picture, is shown)
  const thumb = c.thumb ? `<img loading="lazy" decoding="async" alt=""${clipIsSticker(c) ? ' class="sticker-thumb"' : ''} src="${escapeHTML(clips.base)}/thumb/${encodeURIComponent(c.id)}">` : '';
  b.innerHTML = `${thumb}<em class="clip-dur">${fmtT(c.d || 0)}</em>${c.mv ? '<i class="cx-fxb mv" title="Recorded settings: plays back live">REC</i>' : c.fx ? '<i class="cx-fxb" title="Effects saved with it">FX</i>' : ''}`
    + `${c.tags && c.tags.length ? `<span class="cx-tl">${escapeHTML(c.tags.map((t) => '#' + t).join(' '))}</span>` : ''}<span>${escapeHTML(c.n)}</span>`;
  return b;
}
// Draws the next page of tiles (more come as the bottom scrolls into view)
function cxDrawMore() {
  const frag = document.createDocumentFragment();
  const to = Math.min(cx.shown.length, cx.drawn + CX_PAGE);
  for (let i = cx.drawn; i < to; i++) frag.appendChild(cxTile(cx.shown[i]));
  cx.drawn = to;
  clipsGrid.appendChild(frag);
  $('#cxMore').hidden = cx.drawn >= cx.shown.length;
}
function clipsFilter() {
  for (const b of clipsTabs.querySelectorAll('.cx-fold')) b.setAttribute('aria-current', String(b.dataset.cat === clips.cat && (clips.cat === 'all' || b.dataset.sub === cx.folder)));
  cx.shown = cxFiltered();
  cx.drawn = 0;
  clipsGrid.textContent = '';
  cxDrawMore();
  const n = cx.shown.length, all = (clips.list || []).length;
  $('#clipsCount').textContent = clips.list ? (n === all ? `${n} CLIP${n === 1 ? '' : 'S'}` : `${n} OF ${all}`) : '';
  $('#cxNone').hidden = !clips.list || !!n || !all;
  cxCopyLabel();
  if (!cx.obs && 'IntersectionObserver' in window) {
    cx.obs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && cx.drawn < cx.shown.length) cxDrawMore(); }, { root: clipsDlg, rootMargin: '600px' });
    cx.obs.observe($('#cxMore'));
  }
}
function cxCopyLabel() {
  const n = cx.sel.size || cx.shown.length;
  $('#cxCopy').textContent = cx.sel.size ? `Copy ${n} picked to a drive…` : cx.shown.length < (clips.list || []).length ? `Copy these ${n} to a drive…` : 'Copy to a drive…';
  $('#cxCopy').disabled = !n;
}
function clipsApNote() {
  const hint = $('#clipsHint');
  hint.hidden = false;
  if (cx.mode === 'seq') {
    hint.textContent = `Pick a clip to add at the playhead: with its whole look (a block on every loop it used), with its loop’s look on track ${seq.selTrack + 1}, or just the clip. Double-click adds it with its whole look when it has one.`;
    return;
  }
  const none = clips.list && clips.list.length && !clipsAp().length;
  hint.textContent = none
    ? 'No category is ticked at the bottom, so Autopilot won’t bring in clips.'
    : 'Autopilot puts in a new clip from the categories ticked at the bottom every few looks; a video file of your own stays put.';
}
/* the picked clip(s), at the side */
const cxSay = (t) => { $('#cxSay').textContent = t || ''; };
function cxMarkSel() {
  for (const t of clipsGrid.children) t.setAttribute('aria-selected', String(cx.sel.has(t.dataset.id)));
  cxCopyLabel();
  cxSide();
}
function cxSide() {
  const side = $('#cxSide'), v = $('#cxVideo');
  const n = cx.sel.size;
  side.hidden = !n;
  if (!n) { v.pause(); v.removeAttribute('src'); v.load(); return; }
  $('#cxOne').hidden = n !== 1;
  $('#cxMany').hidden = n === 1;
  if (n > 1) {
    v.pause(); v.removeAttribute('src'); v.load(); v.hidden = true;
    $('#cxManyN').textContent = `${n} clips picked`;
    folderOptions($('#cxManyMove'), '', 'Pick a folder…');
    return;
  }
  const c = cxClip([...cx.sel][0]);
  if (!c) return;
  v.hidden = false;
  const src = `${clips.base}/clip/${encodeURIComponent(c.id)}`;
  if (v.dataset.id !== c.id) { v.dataset.id = c.id; v.src = src; v.play().catch(() => {}); }
  if (document.activeElement !== $('#cxName')) $('#cxName').value = c.n;
  folderOptions($('#cxCat'), cxKey(c.c, c.p || ''));
  const tl = $('#cxTagList');
  tl.textContent = '';
  for (const t of c.tags || []) {
    const chip = document.createElement('span');
    chip.className = 'cx-chip';
    chip.innerHTML = `#${escapeHTML(t)}<button type="button" aria-label="Take off the tag ${escapeHTML(t)}">×</button>`;
    chip.querySelector('button').addEventListener('click', () => cxEdit(c, { tags: (c.tags || []).filter((x) => x !== t) }));
    tl.appendChild(chip);
  }
  $('#cxFxState').innerHTML = c.fx ? '<b>Effects saved with it.</b> “Use with its effects” brings back the whole picture they were saved with.'
    : 'No effects saved with it yet.';
  $('#cxFxSave').textContent = c.fx ? 'Save the picture on screen instead' : 'Save the picture on screen as its effects';
  $('#cxFxOff').hidden = !c.fx;
  const seqMode = cx.mode === 'seq';
  $('#cxUseFx').textContent = seqMode ? `Add to track ${seq.selTrack + 1} with its effects` : 'Use with its effects';
  $('#cxUseClip').textContent = seqMode ? 'Add just the clip' : 'Just the clip';
  $('#cxUseFx').disabled = !c.fx;
  $('#cxUseAll').hidden = !seqMode;
  $('#cxUseAll').disabled = !c.fx;
  $('#cxUseFx').textContent = seqMode ? `Add to track ${seq.selTrack + 1} with its loop’s look` : 'Use with its effects';
  $('#cxUseFx').title = c.fx ? '' : 'This clip has no effects saved with it yet';
  // A recording of the settings (look.moves): found out from its effects, which are asked for once
  if (c.fx) cxLook(c).then((look) => {
    if (cx.sel.size !== 1 || !cx.sel.has(c.id) || !isMoves(look)) return;
    $('#cxFxState').innerHTML = `<b>Recorded settings, ${fmtT(look.moves.dur)} long.</b> They play back live: its inputs, effects and every change, rebuilt here. The video is just a preview.`;
    $('#cxFxSave').textContent = 'Save the picture on screen instead (the recording goes)';
    if (seqMode) { $('#cxUseAll').textContent = 'Add the recording'; $('#cxUseAll').title = 'Blocks on each loop’s track, with every change drawn as change lines'; }
    else $('#cxUseFx').textContent = 'Play the recording';
  }).catch(() => {});
  $('#cxUseAll').textContent = 'Add with its whole look';
  $('#cxFacts').textContent = [`${fmtT(c.d || 0)} long`, c.w && c.h ? `${c.w}×${c.h}` : '', c.sound ? 'with sound' : '',
    c.by ? `by ${c.by}` : '', c.lic || '', c.page ? `from ${c.page}` : ''].filter(Boolean).join(' · ');
}
// Changes a clip in Phosphor Clips (name, category, tags or effects) and shows the result
async function cxEdit(c, changes, quiet) {
  try {
    const r = await fetch(`${clips.base}/clip/${encodeURIComponent(c.id)}`, { method: 'POST', cache: 'no-store', targetAddressSpace: 'loopback',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
    let j = null;
    try { j = await r.json(); } catch (_) { /* no reason given */ }
    if (!r.ok || !j || !j.ok) {
      cxSay(j && j.message ? `Couldn’t change it: ${j.message}` : r.status === 404 || r.status === 405
        ? 'This Phosphor Clips is too old for tags and effects. Install the newest one (1.7 or later).' : 'Couldn’t change it. Is Phosphor Clips still running?');
      return null;
    }
    for (const l of [clips.all, clips.web, clips.list]) { const i = (l || []).findIndex((x) => x.id === c.id); if (i >= 0) l[i] = j.clip; }
    if (changes.look !== undefined) cxLooks.delete(c.id);
    if (!quiet) {
      const tile = clipsGrid.querySelector(`.nat-tile[data-id="${CSS.escape(c.id)}"]`);
      if (tile) tile.replaceWith(cxTile(j.clip));
      if (changes.tags !== undefined) cxTagsBuild();
      // Moved to another folder: the tree's counts change, and it may leave the folder shown
      if (changes.c !== undefined || changes.p !== undefined) { clipsBuild(); clipsFilter(); }
      cxSide();
    }
    return j.clip;
  } catch (_) {
    cxSay('Couldn’t reach Phosphor Clips. Is it running on this computer?');
    return null;
  }
}
// The effects saved with a clip (asked of Phosphor Clips once, then remembered while the page is open)
const cxLooks = new Map();
async function cxLook(c) {
  if (cxLooks.has(c.id)) return cxLooks.get(c.id);
  const r = await fetch(`${clips.base}/look/${encodeURIComponent(c.id)}`, clipFetchOpts());
  const j = await r.json();
  const look = j && j.look && typeof j.look === 'object' ? j.look : null;
  cxLooks.set(c.id, look);
  return look;
}
// The whole picture on screen, as effects to save with a clip: a preset's snapshot, plus which loops play the Video
function clipLookNow() {
  return { ...snapshot(), vid: activeKeys().filter((k) => usesIn(loops[k].tgt, 'video')) };
}
const lookUsesVideo = (look) => ['A', 'B', 'C', 'D'].some((k) => usesIn(look && look[k], 'video'));
// Uses a clip: in the Video input (with its effects: the picture saved with it comes back, like loading a preset,
// then the clip plays in it), or as a block in the sequencer
async function cxUse(c, withFx) {
  let look = null;
  if (withFx) {
    try { look = await cxLook(c); } catch (_) { cxSay('Couldn’t read its effects. Is Phosphor Clips still running?'); return; }
    if (!look) { cxSay('This clip has no effects saved with it.'); return; }
  }
  if (cx.mode === 'seq') {
    closeClips();
    if (withFx === 'whole') { if (isMoves(look)) seqPlaceMoves(c, look); else seqPlaceWhole(c, look); } else seqPlaceClip(c, look);
    return;
  }
  closeClips();
  // A recording of the settings plays back live (its video is only a preview)
  if (isMoves(look)) { movesPlay(c, look); return; }
  if (look) {
    loadPreset({ id: '', name: c.n, data: look });
    // The clip goes into each loop the saved picture showed it in (each loop has its own video player)
    const ks = KEYS.filter((k) => loopOn(k) && usesIn(look[k], 'video'));
    if (!ks.length) await clipPick(c, false);
    else await Promise.all(ks.map((k) => clipPick(c, true, vids[k])));
  } else await clipPick(c);
}
function cxPick(id, e) {
  if (e && (e.ctrlKey || e.metaKey)) {
    if (cx.sel.has(id)) cx.sel.delete(id); else cx.sel.add(id);
    cx.anchor = id;
  } else if (e && e.shiftKey && cx.anchor) {
    const ids = cx.shown.map((c) => c.id), a = ids.indexOf(cx.anchor), b = ids.indexOf(id);
    if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) cx.sel.add(ids[i]);
  } else {
    cx.sel = new Set([id]);
    cx.anchor = id;
  }
  cxSay('');
  cxMarkSel();
}
clipsGrid.addEventListener('click', (e) => {
  const t = e.target.closest('.nat-tile');
  if (t) cxPick(t.dataset.id, e);
});
clipsGrid.addEventListener('dblclick', (e) => {
  const t = e.target.closest('.nat-tile');
  const c = t && cxClip(t.dataset.id);
  if (c) void cxUse(c, c.fx ? (cx.mode === 'seq' ? 'whole' : true) : false);
});
$('#cxSearch').addEventListener('input', () => { cx.q = $('#cxSearch').value; clipsFilter(); });
$('#cxSort').addEventListener('change', () => { cx.sort = $('#cxSort').value; clipsFilter(); });
$('#cxName').addEventListener('change', () => {
  const c = cxClip([...cx.sel][0]), n = $('#cxName').value.trim();
  if (c && n && n !== c.n) void cxEdit(c, { n });
});
$('#cxName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#cxName').blur(); });
$('#cxCat').addEventListener('change', () => { const c = cxClip([...cx.sel][0]); if (c) void cxEdit(c, splitKey($('#cxCat').value)); });
$('#cxManyMove').addEventListener('change', async () => {
  const to = $('#cxManyMove').value;
  if (!to) return;
  const ids = [...cx.sel];
  let n = 0;
  for (const id of ids) {
    const c = cxClip(id);
    if (!c) continue;
    cxSay(`Moving ${++n} of ${ids.length}…`);
    if (!(await cxEdit(c, splitKey(to), true))) return;
  }
  cxSay(`Moved ${ids.length} clips to ${$('#cxManyMove').selectedOptions[0]?.title || $('#cxManyMove').selectedOptions[0]?.textContent.trim()}.`);
  clipsBuild();
  clipsFilter();
  cxSide();
});
// + New folder: inside the folder picked in the tree
$('#cxNewFolder').addEventListener('click', () => {
  const f = $('#cxNewForm');
  if (!f.hidden) { f.hidden = true; return; }
  if (clips.cat === 'all') { cxSay(''); toast('Pick a category (or a folder in one) on the left first: the new folder goes inside it.'); return; }
  $('#cxNewWhere').textContent = `Inside ${[clipCatName(clips.cat), ...cx.folder.split('/').filter(Boolean)].join(' › ')}. Enter makes it.`;
  f.hidden = false;
  $('#cxNewName').value = '';
  $('#cxNewName').focus();
});
$('#cxNewName').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); $('#cxNewForm').hidden = true; } });
$('#cxNewForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#cxNewName').value.trim().replace(/[\\/]+/g, ' ');
  if (!name) return;
  const want = cx.folder ? `${cx.folder}/${name}` : name;
  try {
    const r = await fetch(`${clips.base}/folder`, { method: 'POST', cache: 'no-store', targetAddressSpace: 'loopback',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ c: clips.cat, p: want }) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) { toast(j && j.message ? j.message : r.status === 404 ? 'This Phosphor Clips is too old for folders. Install the newest one (1.7 or later).' : 'Couldn’t make the folder.'); return; }
    await clipList(true);
    $('#cxNewForm').hidden = true;
    clipsBuild();
    cxGoFolder(j.c, j.p);
  } catch (_) { toast('Couldn’t reach Phosphor Clips. Is it running on this computer?'); }
});
// Tags: Enter or a comma adds what's typed (several at once with commas between)
const splitTags = (s) => String(s || '').toLowerCase().split(',').map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
$('#cxTagIn').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();
  const c = cxClip([...cx.sel][0]), add = splitTags($('#cxTagIn').value);
  if (!c || !add.length) return;
  $('#cxTagIn').value = '';
  void cxEdit(c, { tags: [...(c.tags || []), ...add.filter((t) => !(c.tags || []).includes(t))] });
});
$('#cxManyTag').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const add = splitTags($('#cxManyTag').value);
  if (!add.length) return;
  $('#cxManyTag').value = '';
  const ids = [...cx.sel];
  let n = 0;
  for (const id of ids) {
    const c = cxClip(id);
    if (!c) continue;
    cxSay(`Tagging ${++n} of ${ids.length}…`);
    if (!(await cxEdit(c, { tags: [...(c.tags || []), ...add.filter((t) => !(c.tags || []).includes(t))] }, true))) return;
  }
  cxSay(`Added ${add.map((t) => '#' + t).join(' ')} to ${ids.length} clips.`);
  cxTagsBuild();
  clipsFilter();
});
$('#cxManyNone').addEventListener('click', () => { cx.sel.clear(); cxMarkSel(); });
$('#cxFxSave').addEventListener('click', async () => {
  const c = cxClip([...cx.sel][0]);
  if (!c) return;
  if (await cxEdit(c, { look: clipLookNow() })) cxSay(`Saved the picture on screen as “${c.n}”’s effects.`);
});
$('#cxFxOff').addEventListener('click', async () => {
  const c = cxClip([...cx.sel][0]);
  if (c && (await cxEdit(c, { look: null }))) cxSay('Its effects are off. The clip itself is still there.');
});
$('#cxUseFx').addEventListener('click', () => { const c = cxClip([...cx.sel][0]); if (c) void cxUse(c, true); });
$('#cxUseClip').addEventListener('click', () => { const c = cxClip([...cx.sel][0]); if (c) void cxUse(c, false); });
$('#cxUseAll').addEventListener('click', () => { const c = cxClip([...cx.sel][0]); if (c) void cxUse(c, 'whole'); });
// Copy to a drive…: the picked clips, or else all the ones shown. Phosphor Clips asks where (its window comes up).
$('#cxCopy').addEventListener('click', async () => {
  const ids = cx.sel.size ? [...cx.sel] : cx.shown.map((c) => c.id);
  if (!ids.length) return;
  $('#cxCopy').disabled = true;
  const say = (t) => { if (cx.sel.size) cxSay(t); else if (t) toast(t); };
  say('Phosphor Clips is asking where to copy them (look for its window)…');
  try {
    const r = await fetch(`${clips.base}/copy`, { method: 'POST', cache: 'no-store', targetAddressSpace: 'loopback',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    let j = null;
    try { j = await r.json(); } catch (_) { /* no reason */ }
    if (j && j.ok) say(`Copied ${j.copied} clip${j.copied === 1 ? '' : 's'} to ${j.folder}${j.skipped ? ` (${j.skipped} were there already)` : ''}. On the other computer, drop the category folders inside into its library folder.`);
    else if (j && j.canceled) say('');
    else say(j && j.message ? j.message : r.status === 404 ? 'This Phosphor Clips is too old to copy clips. Install the newest one (1.7 or later).' : 'Couldn’t copy them. Is Phosphor Clips still running?');
  } catch (_) { say('Couldn’t reach Phosphor Clips. Is it running on this computer?'); }
  cxCopyLabel();
});
let clipsReturn = null;
// mode: 'video' (the Video input's Clip library…) or 'seq' (the sequencer's + Add clip…)
function openClips(mode) {
  // video: the web clips, for the Video input; looks: the Look library (Save clip's looks); seq: both, for a track
  cx.mode = mode === 'seq' || mode === 'looks' ? mode : 'video';
  if (clips.view !== { video: 'clips', looks: 'looks', seq: 'all' }[cx.mode]) { clipsSetView({ video: 'clips', looks: 'looks', seq: 'all' }[cx.mode]); cx.sel.clear(); cx.folder = ''; clips.cat = 'all'; }
  $('#clipsTitle').textContent = cx.mode === 'seq' ? `Add a clip to track ${seq.selTrack + 1}` : cx.mode === 'looks' ? 'Look library' : 'Clip library';
  $('#clipsFile').hidden = cx.mode !== 'video';
  clipsDlg.classList.toggle('looks', cx.mode === 'looks');
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
    $('#clipShuffle').hidden = !(clips.web || []).length;
    $('#clipsShuffle').hidden = !list.length || cx.mode !== 'video';
    $('#clipsFoot').hidden = false;
    if (cx.mode === 'looks' && !hasLooks()) {
      clipsSay('This Phosphor Clips is too old for the Look library. Install Phosphor Clips 1.9 or later, then press <b>Try again</b>.');
      $('#clipsHint').hidden = true;
      return;
    }
    if (!list.length) {
      clipsSay(cx.mode === 'looks' ? 'No looks saved yet. Press <b>✂ Save clip…</b> under the picture to record one.'
        : 'Phosphor Clips is running, but its library is empty. Grab a video there and save it, then press <b>Try again</b>.');
      $('#clipsHint').hidden = true;
      return;
    }
    clipsSay('');
    clipsApNote();
    cxSide();
    if (cx.mode === 'video') clipsKeepOneReady();
    clipsDlg.scrollTop = 0;
    if (matchMedia('(pointer: fine)').matches) $('#cxSearch').focus({ preventScroll: true });
  }).catch(() => {
    if (clipsDlg.hidden) return;
    clipsGrid.textContent = '';
    clipsTabs.textContent = '';
    $('#cxTags').textContent = '';
    $('#cxSide').hidden = true;
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
  const v = $('#cxVideo');
  v.pause(); v.removeAttribute('src'); v.load(); delete v.dataset.id;
  clipsDlg.hidden = true;
  document.documentElement.style.overflow = '';
  if (clipsReturn && clipsReturn.focus) clipsReturn.focus();
}
if (APP) $('#clipOpen').hidden = true;   // Phosphor Clips is a Windows program; the phone has no library to reach
$('#clipOpen').addEventListener('click', () => openClips('video'));
$('#clipShuffle').addEventListener('click', clipShuffle);
$('#clipsClose').addEventListener('click', closeClips);
$('#clipsRetry').addEventListener('click', () => openClips(cx.mode));
$('#clipsShuffle').addEventListener('click', () => { clipShuffle(); closeClips(); });
$('#clipsFile').addEventListener('click', () => { closeClips(); $('#vidFile').click(); });
clipsDlg.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); if (cx.sel.size && !e.target.closest('input')) { cx.sel.clear(); cxMarkSel(); } else closeClips(); }
  else if (e.key === 'Enter' && e.target.closest('.nat-tile')) {
    e.stopPropagation();
    const c = cxClip(e.target.closest('.nat-tile').dataset.id);
    if (c) { e.preventDefault(); void cxUse(c, !!c.fx); }
  }
  else e.stopPropagation(); // keep the keys from firing while browsing
});
// Video loops that came back with the page but whose clip can't (Phosphor Clips isn't running): back to a pattern
function clipsDropVideo() {
  if (anyVid()) return;
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
  if (!anyVid() && !vids.A.own && clipsReady()) return clipPick(pick(clipsAp()), true, vids.A);
  return Promise.resolve(anyVid());
}
// When the page opens (after the last session is back): the clip in use last time comes back, and the library is
// asked again every minute so Autopilot knows about new clips
function clipsStart() {
  if (!clipsWanted()) return;
  const last = lsGet(CLIP_LAST_KEY);
  clipList().then(() => {
    const list = clips.web || [];
    $('#clipShuffle').hidden = !list.length;
    if (anyVid()) return true;
    const c = list.find((x) => x.id === last);
    return c ? clipPick(c, true, vids.A) : clipsKeepOneReady();
  }).then((ok) => { if (!ok) clipsDropVideo(); }, () => clipsDropVideo());
  setInterval(() => {
    if (document.hidden || !clipsWanted()) return;
    clipList(true).then(() => { $('#clipShuffle').hidden = !(clips.web || []).length; clipsKeepOneReady(); }).catch(() => { /* not running right now */ });
  }, 60000);
}

// For tests/clips_check.py, which can't see inside this file: the clip library's state and the bits of Autopilot it
// touches (as __phosphorCapture does for the stream app)
window.__plClips = {
  get list() { return clips.list; }, get cur() { return clips.cur; }, get own() { return clips.own; },
  get off() { return clips.off.slice(); }, set off(v) { clips.off = v.slice(); },
  get vidOn() { return anyVid(); }, get vidFrames() { return vidFor(edit).frames; }, get edit() { return edit; },
  wanted: () => clipsWanted(), ready: () => clipsReady(),
  input: (k, slot) => loops[k].tgt[slot], setInput: (k, slot, src) => { loops[k].tgt[slot] = src; settleDevices(); },
  detachVideo: () => { for (const o of Object.values(vids)) { o.detach(); o.clip = ''; o.media = null; o.credit = ''; } vidPanelSync(); },
  vids: () => Object.fromEntries(KEYS.map((k) => [k, { on: vids[k].on, name: vids[k].name, clip: vids[k].clip, frames: vids[k].frames, paused: vids[k].video ? vids[k].video.paused : null, t: vids[k].video ? vids[k].video.currentTime : null, dur: vids[k].video ? vids[k].video.duration : null, sticker: !!vids[k].sticker, aspect: vids[k].aspect, loops: vids[k].video ? vids[k].video.loop : null, shows: vidFor(k).key, wait: vids[k].wait, loading: !!vids[k].loading, spare: vids[k].spare ? vids[k].spare.name : null }])),
  pickInto: (k, id) => clipPick((clips.all || []).find((c) => c.id === id), true, vids[k]),
  apClip: (k, gap) => { if (gap != null) ap.clipIn = gap; apClip(k); },
  videoUsable: () => apPool().includes('video') && apUsable('video'),
  loadFile: (f) => loadFile(f), close: () => closeClips(),
  pics: () => Object.fromEntries(KEYS.map((k) => [k, pics[k].media ? pics[k].media.name : null])),
  // How much of a sticker's last frame is see-through, and how much solid (tests/gif_check.py)
  stickerAlpha: (k) => { const u = vids[k].unpack; if (!u || !u.out) return null; const d = u.out.data; let c = 0, o = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] < 20) c++; else if (d[i] > 235) o++; } return [c / (d.length / 4), o / (d.length / 4)]; },
};

// Dropping something on the picture: while it's dragged over, the picture splits into a target for each loop that's
// on, and what's dropped goes into the loop it lands on (with one loop, the whole picture is that loop's).
// The loop tabs take drops too.
const dropEl = $('#drop');
let dragDepth = 0;
function dropZones() {
  const ks = activeKeys();
  dropEl.classList.toggle('zones', ks.length > 1);
  dropEl.innerHTML = ks.map((k) => `<div class="drop-zone${k === edit ? ' cur' : ''}" data-k="${k}"><span class="tag">${k}</span>`
    + `<span>${ks.length > 1 ? `Drop into loop ${k}` : 'Drop to feed it into the loop'}</span></div>`).join('');
}
const dropLoopAt = (e) => {
  const z = e.target.closest?.('.drop-zone[data-k], [role=tab][id^=tab]');
  const k = z && (z.dataset.k || z.id.slice(3));
  return KEYS.includes(k) && activeKeys().includes(k) ? k : edit;
};
const dragHasMedia = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'text/uri-list' || t === 'text/html');
stage.addEventListener('dragenter', (e) => {
  if (!dragHasMedia(e)) return;
  e.preventDefault();
  if (!dragDepth++) dropZones();
  dropEl.hidden = false;
});
stage.addEventListener('dragover', (e) => {
  e.preventDefault();
  const k = dropLoopAt(e);
  dropEl.querySelectorAll('.drop-zone').forEach((z) => z.classList.toggle('over', z.dataset.k === k));
});
stage.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropEl.hidden = true; });
function dropTake(e, k) {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  // A dropped file's pointer has to be asked for during the drop itself
  const hp = e.dataTransfer?.items?.[0]?.getAsFileSystemHandle?.();
  if (f) {
    const own = () => Promise.resolve(hp).then((h) => loadFile(f, h?.kind === 'file' ? h : null, k), () => loadFile(f, null, k));
    // A clip dragged out of Phosphor Clips' library comes in as that library clip (a sticker stays a sticker)
    dropLibraryClip(f, k).then((done) => { if (!done) own(); }, own);
    return;
  }
  // A picture dragged out of a web page can come as its address only: fetched here (sites like GIPHY allow it)
  const dt = e.dataTransfer;
  const html = dt?.getData('text/html') || '';
  const fromImg = (html.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1];
  const url = [fromImg, ...(dt?.getData('text/uri-list') || '').split(/\r?\n/), dt?.getData('text/plain')]
    .map((u) => (u || '').trim().replace(/&amp;/g, '&')).find((u) => /^https?:\/\//i.test(u));
  if (url) dropFetch(url, k);
}
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  const k = dropLoopAt(e);
  dragDepth = 0; dropEl.hidden = true;
  dropTake(e, k);
});
// The loop tabs: a drop on Loop B's tab goes into loop B
KEYS.forEach((k) => {
  const tab = $('#tab' + k);
  if (!tab) return;
  tab.addEventListener('dragover', (e) => { if (!dragHasMedia(e)) return; e.preventDefault(); tab.classList.add('drop-over'); });
  tab.addEventListener('dragleave', () => tab.classList.remove('drop-over'));
  tab.addEventListener('drop', (e) => { e.preventDefault(); tab.classList.remove('drop-over'); dropTake(e, k); });
});
// Whether a dropped video is one of Phosphor Clips' library clips (its file, dragged out of Phosphor Clips): known by
// its name and length. Asked only when the clip library has been used on this computer, so a video of your own isn't
// held up looking for Phosphor Clips. Resolves true once the library clip is going into loop k.
async function dropLibraryClip(f, k) {
  if (APP || inArtifact || lsGet(CLIP_ON_KEY) !== '1') return false;
  if (!/^video\//.test(f.type || '') && !/\.(mp4|m4v|webm|mov)$/i.test(f.name || '')) return false;
  const base = String(f.name || '').replace(/\.[^.]+$/, '');
  const dur = await new Promise((res) => {
    const v = document.createElement('video'), u = URL.createObjectURL(f);
    const done = (d) => { URL.revokeObjectURL(u); v.removeAttribute('src'); res(d); };
    v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => done(v.duration);
    v.onerror = () => done(NaN);
    setTimeout(() => done(NaN), 4000);
    v.src = u;
  });
  try { await clipList(true); } catch (_) { return false; }
  const c = (clips.all || []).find((x) => x.n === base && (!Number.isFinite(dur) || !x.d || Math.abs(x.d - dur) < 0.25));
  if (!c) return false;
  return !!(await clipPick(c, false, vids[k] || vid));
}
async function dropFetch(url, k = edit) {
  toast('Fetching what you dropped…', 3000);
  try {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error(r.status);
    const blob = await r.blob();
    const type = (blob.type || '').split(';')[0];
    if (!/^(image|video)\//.test(type)) throw new Error('not media');
    let name = decodeURIComponent((new URL(url).pathname.split('/').pop() || '').replace(/\?.*$/, '')) || 'Dropped';
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += '.' + (type.split('/')[1] || 'gif').replace('quicktime', 'mov');
    loadFile(new File([blob], name, { type }), null, k);
  } catch (_) {
    toast('That site won’t hand the file over. Save it to your computer and drop the file, or grab it with Phosphor Clips.', 7000);
  }
}

/* ================= video deck ================= */
const vidPos = $('#vidPos'), vidTime = $('#vidTime');
let scrubbing = false, vidTxt = '';
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
$('#vidStart').addEventListener('click', () => seekTo(vid.loopA ?? 0));
$('#vidBack').addEventListener('click', () => seekBy(-5));
$('#vidFwd').addEventListener('click', () => seekBy(5));
$$('#vidSpeed button').forEach((b) => b.addEventListener('click', () => {
  vid.rate = +b.dataset.rate;
  if (vid.video) vid.video.playbackRate = vid.rate;
  $$('#vidSpeed button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));
$('#vidIn').addEventListener('click', () => {
  if (!vid.video) return;
  vid.loopA = vid.video.currentTime;
  if (vid.loopB != null && vid.loopB <= vid.loopA + 0.1) vid.loopB = null;
  loopText();
});
$('#vidOut').addEventListener('click', () => {
  if (!vid.video) return;
  const t = vid.video.currentTime;
  if (vid.loopA != null && t <= vid.loopA + 0.1) { toast('Mark the end somewhere after the start.'); return; }
  vid.loopB = t;
  seekTo(vid.loopA ?? 0);
  loopText();
});
$('#vidAll').addEventListener('click', () => { vid.loopA = null; vid.loopB = null; loopText(); });
function loopText() {
  const has = vid.loopA != null || vid.loopB != null;
  $('#vidAll').hidden = !has;
  $('#vidLoopText').textContent = has
    ? `Repeating ${fmtT(vid.loopA ?? 0)} to ${vid.loopB != null ? fmtT(vid.loopB) : 'the end'}.`
    : 'The whole video plays on repeat.';
  markBar();
  snipWhatText();
}
// The marked part as a bar under the position slider
let markSig = '';
function markBar() {
  const v = vid.video, el = $('#vidMark'), d = v && isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  const has = d && (vid.loopA != null || vid.loopB != null);
  const sig = has ? `${vid.loopA}|${vid.loopB}|${d}` : '';
  if (sig === markSig) return;
  markSig = sig;
  el.hidden = !has;
  if (!has) return;
  const a = clamp((vid.loopA ?? 0) / d, 0, 1), b = clamp((vid.loopB ?? d) / d, 0, 1);
  el.style.left = (a * 100) + '%';
  el.style.width = (Math.max(0.005, b - a) * 100) + '%';
}

/* ================= ✂ Save clip (under the picture): trim the video playing and save it to Phosphor Clips ================= */
// The button under the picture shows while a video is in. It opens the save panel there: a trim strip over the whole
// video (drag the two handles, or Start here / End here as it plays; Play the part repeats just the trimmed part),
// then a name, a folder, tags, and whether to save the whole look on screen with it. Phosphor Clips (on this
// computer) does the cutting (its /snip, see clip-app/src/snip.js on the clip-app branch): a library clip is sent by
// its id, a video of your own as the file itself (it stays on this computer: the app is at 127.0.0.1). The clip lands
// in the library, where the clip explorer, Autopilot and the sequencer's + Add clip… can use it.
const SNIP_CAT_KEY = 'phosphor-snip-cat';
// a, b: the trimmed part (seconds); play: the video repeats just that part while the panel is open
// autoName: the name follows the trim (video name, start–end) until you type one of your own
// v0, v1: the stretch of the video the strip shows now (zoomed in on a short trim), easing towards view (its target)
const snip = { stage: '', busy: false, open: false, a: 0, b: 0, play: true, drag: null, autoName: true, base: '', v0: 0, v1: 0, view: null, px: 0, lastTick: 0 };
const snipSay = (t) => { $('#snipStatus').textContent = t || ''; };
const vidDur = () => { const v = vid.video; return v && isFinite(v.duration) && v.duration > 0 ? v.duration : 0; };
const fmtT1 = (s) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
// The part to save: the trim handles
function snipRange() {
  const d = vidDur();
  const a = clamp(snip.a, 0, d), b = clamp(snip.b || d, 0, d);
  return { a, b, d, whole: a <= 0.05 && b >= d - 0.05 };
}
function snipWhatText() {
  if (snip.stage !== 'trim') return;
  const r = snipRange();
  $('#snipWhat').textContent = r.whole ? `The whole video, ${r.d.toFixed(1)} seconds. Drag the handles to trim it.`
    : `${fmtT1(r.a)} to ${fmtT1(r.b)}: ${Math.max(0, r.b - r.a).toFixed(1)} seconds.`;
}
// The stretch the strip should show: all of the video, or, when the trimmed part is much shorter (under 40% of it),
// that part with some room either side, so short trims can be set finely
function trimViewFor() {
  const d = vidDur(), r = snipRange(), span = r.b - r.a;
  if (!d || span >= 0.4 * d) return [0, d];
  const pad = Math.max(span * 0.35, 0.75);
  let lo = Math.max(0, r.a - pad), hi = Math.min(d, r.b + pad);
  const want = Math.min(d, Math.max(hi - lo, 2.5));
  if (hi - lo < want) { const c = (lo + hi) / 2; lo = c - want / 2; hi = c + want / 2; if (lo < 0) { hi -= lo; lo = 0; } if (hi > d) { lo -= hi - d; hi = d; } }
  return [Math.max(0, lo), Math.min(d, hi)];
}
const trimAt = (t) => ((t - snip.v0) / Math.max(1e-6, snip.v1 - snip.v0)) * 100;
// The trim strip: the kept part, the handles, where the video is; and above it the whole video
function trimDraw() {
  const d = vidDur();
  if (!d) return;
  if (!(snip.v1 > snip.v0)) { [snip.v0, snip.v1] = trimViewFor(); }
  if (!snip.drag) snip.view = trimViewFor();
  const r = snipRange(), pa = trimAt(r.a), pb = trimAt(r.b);
  const cl = (x) => clamp(x, -2, 102);
  $('#trimSel').style.left = cl(pa) + '%';
  $('#trimSel').style.width = Math.max(0, cl(pb) - cl(pa)) + '%';
  $('#trimA').style.left = cl(pa) + '%';
  $('#trimB').style.left = cl(pb) + '%';
  const whole = snip.v0 <= 0.01 && snip.v1 >= d - 0.01;
  $('#trimV0').textContent = whole ? '' : fmtT1(snip.v0);
  $('#trimV1').textContent = whole ? '' : fmtT1(snip.v1);
  $('#trimOver').dataset.whole = whole ? '1' : '0';
  $('#trimOverSel').style.left = (r.a / d) * 100 + '%';
  $('#trimOverSel').style.width = ((r.b - r.a) / d) * 100 + '%';
  $('#trimOverView').style.left = (snip.v0 / d) * 100 + '%';
  $('#trimOverView').style.width = ((snip.v1 - snip.v0) / d) * 100 + '%';
  $('#trimAT').textContent = fmtT1(r.a);
  $('#trimBT').textContent = fmtT1(r.b);
  snipWhatText();
  if (snip.autoName && snip.base) $('#snipName').value = `${snip.base} ${nameT(r.a)}–${nameT(r.b)}`.slice(0, 80);
}
function trimSet(which, t) {
  const d = vidDur();
  if (!d) return;
  if (which === 'a') snip.a = clamp(t, 0, Math.max(0, (snip.b || d) - 0.2));
  else snip.b = clamp(t, Math.min(d, snip.a + 0.2), d);
  trimDraw();
}
// Each frame while the panel is open: the strip's zoom (easing to fit the trim, or widening while a handle is pushed
// against an end), the playhead, and the video kept inside the trimmed part
function snipTick() {
  const v = vid.video, d = vidDur();
  if (!snip.open || snip.stage !== 'trim' || !v || !d) return;
  const now = performance.now(), dt = snip.lastTick ? Math.min(0.1, (now - snip.lastTick) / 1000) : 0.016;
  snip.lastTick = now;
  if (snip.drag) {
    // A handle pushed against an end of the strip: the strip widens that way (faster the further past it the
    // pointer is), and the handle follows to the new edge
    const box = $('#trimBar').getBoundingClientRect(), f = (snip.px - box.left) / box.width, w = snip.v1 - snip.v0;
    let grew = false;
    if (f > 0.97 && snip.v1 < d) { snip.v1 = Math.min(d, snip.v1 + w * dt * (1.2 + 3 * Math.max(0, f - 1))); grew = true; }
    if (f < 0.03 && snip.v0 > 0) { snip.v0 = Math.max(0, snip.v0 - w * dt * (1.2 + 3 * Math.max(0, -f))); grew = true; }
    if (grew) {
      snip.view = [snip.v0, snip.v1];
      trimSet(snip.drag, snip.v0 + clamp(f, 0, 1) * (snip.v1 - snip.v0));
      peekSeek(snip.drag === 'a' ? snip.a : Math.max(snip.a, snip.b - 0.04));
    }
  } else if (snip.view) {
    // Easing to the view that fits the trim
    const k = 1 - Math.exp(-dt * 9), [t0, t1] = snip.view;
    if (Math.abs(snip.v0 - t0) > 0.002 || Math.abs(snip.v1 - t1) > 0.002) {
      snip.v0 += (t0 - snip.v0) * k; snip.v1 += (t1 - snip.v1) * k;
      if (Math.abs(snip.v0 - t0) < 0.002 && Math.abs(snip.v1 - t1) < 0.002) { snip.v0 = t0; snip.v1 = t1; }
      trimDraw();
    }
  }
  if (peek.on && peek.hideAt && now >= peek.hideAt && !snip.drag) peekStop();
  const hp = trimAt(v.currentTime);
  $('#trimHead').style.left = hp + '%';
  $('#trimHead').hidden = hp < 0 || hp > 100;
  $('#trimOverHead').style.left = (v.currentTime / d) * 100 + '%';
  if (snip.play && !snip.drag && !peek.on && !v.seeking) {
    const r = snipRange();
    if (v.currentTime >= r.b - 0.03 || v.currentTime < r.a - 0.25) v.currentTime = r.a;
  }
}
/* The peek: while a handle is dragged (or nudged with the arrow keys), the video holds still at that handle and its
   plain frame (no effects) covers the picture, with the time and which end it is, so you can see exactly where the
   clip starts or ends. Let go and the picture comes back, playing the part from its start. */
const peek = { on: false, which: '', want: null, wasPaused: true, hideAt: 0, busy: false };
function peekDraw() {
  const v = vid.video;
  if (!peek.on || !v || !v.videoWidth) return;
  const c = $('#trimPeekPic');
  if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
  try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (_) { /* not ready */ }
  $('#trimPeekT').textContent = `${peek.which === 'a' ? 'Starts' : 'Ends'} ${fmtT1(v.currentTime)}`;
}
// Seeks to the latest asked-for time, one seek at a time (a fast drag asks far more often than a video can seek)
function peekSeek(t) {
  const v = vid.video;
  if (!v) return;
  peek.want = t;
  if (peek.busy) return;
  peek.busy = true;
  const go = () => {
    const want = peek.want;
    peek.want = null;
    v.currentTime = clamp(want, 0, Math.max(0, vidDur() - 0.04));
    // (if a seek never says it's done, the next one goes ahead anyway after a moment)
    let done = false;
    const next = () => { if (done) return; done = true; peekDraw(); if (peek.want != null) go(); else peek.busy = false; };
    v.addEventListener('seeked', next, { once: true });
    setTimeout(next, 700);
  };
  go();
}
function peekStart(which) {
  const v = vid.video;
  if (!v) return;
  if (!peek.on) { peek.wasPaused = v.paused; v.pause(); }
  peek.on = true;
  peek.which = which;
  peek.hideAt = 0;
  $('#trimPeek').hidden = false;
  peekSeek(which === 'a' ? snip.a : Math.max(snip.a, snip.b - 0.04));
}
function peekStop(soon) {
  if (!peek.on) return;
  // after an arrow-key nudge it stays up a moment, then goes
  if (soon) { peek.hideAt = performance.now() + 900; return; }
  peek.on = false;
  peek.hideAt = 0;
  $('#trimPeek').hidden = true;
  const v = vid.video;
  if (v) { v.currentTime = snip.a; if (!peek.wasPaused) v.play().catch(() => {}); }
}
const trimTimeAt = (e) => { const box = $('#trimBar').getBoundingClientRect(); return snip.v0 + clamp((e.clientX - box.left) / box.width, 0, 1) * (snip.v1 - snip.v0); };
for (const which of ['a', 'b']) {
  const h = $(which === 'a' ? '#trimA' : '#trimB');
  h.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); snip.drag = which; snip.px = e.clientX; peekStart(which); try { h.setPointerCapture(e.pointerId); } catch (_) { /* a pen or touch that's gone already */ } h.focus(); });
  h.addEventListener('pointermove', (e) => {
    if (snip.drag !== which) return;
    snip.px = e.clientX;
    const t = trimTimeAt(e);
    trimSet(which, t);
    peekSeek(which === 'a' ? snip.a : Math.max(snip.a, snip.b - 0.04));
  });
  // Let go: the strip zooms to fit the new trim
  const end = () => { if (snip.drag === which) { snip.drag = null; trimDraw(); peekStop(); } };
  h.addEventListener('pointerup', end);
  h.addEventListener('pointercancel', end);
  // Arrow keys nudge a handle a tenth of a second (a second with Shift)
  h.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
    trimSet(which, (which === 'a' ? snip.a : snip.b) + step);
    peekStart(which);
    peekStop(true);
  });
}
// Clicking the strip moves the video there (inside the trimmed part while Play the part is on)
$('#trimBar').addEventListener('pointerdown', (e) => {
  if (e.target.closest('.trim-h') || !vid.video) return;
  const t = trimTimeAt(e);
  vid.video.currentTime = snip.play ? clamp(t, snip.a, Math.max(snip.a, snip.b - 0.05)) : t;
});
// The overview: click to move through the whole video
$('#trimOver').addEventListener('pointerdown', (e) => {
  if (!vid.video) return;
  const box = $('#trimOver').getBoundingClientRect(), t = clamp((e.clientX - box.left) / box.width, 0, 1) * vidDur();
  vid.video.currentTime = snip.play ? clamp(t, snip.a, Math.max(snip.a, snip.b - 0.05)) : t;
});
$('#trimSetA').addEventListener('click', () => { if (vid.video) trimSet('a', vid.video.currentTime); });
$('#trimSetB').addEventListener('click', () => { if (vid.video) { trimSet('b', vid.video.currentTime); vid.video.currentTime = snip.a; } });
$('#trimAll').addEventListener('click', () => { snip.a = 0; snip.b = vidDur(); trimDraw(); });
$('#trimPlay').addEventListener('click', () => { snip.play = !snip.play; $('#trimPlay').setAttribute('aria-pressed', String(snip.play)); });
// The ✂ Save clip button: on a computer (Phosphor Clips is a Windows program) that can record the picture (the
// preview a recording of the settings is saved with), or with a video in to trim
let snipBtnShown = null;
const canMoves = () => typeof window.MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function';
// A video is in and some loop shows it: then there's a video to trim
const videoIn = () => !!vid.video && !!vid.media && vidInUse(vid);
function snipBtnSync() {
  const show = !APP && !inArtifact && (canMoves() || (!!vid.video && !!inMedia.vid));
  if (show !== snipBtnShown) {
    snipBtnShown = show;
    $('#snipOpen').hidden = !show;
    $('#looksOpen').hidden = APP || inArtifact;
    if (!show && snip.open) snipCloseForm();
  }
  // Trimming a video that no loop shows any more would save something that isn't on screen
  if (snip.open && snip.stage === 'trim' && !videoIn()) {
    snipCloseForm();
    snipSay('No loop shows the video now, so the trim closed. Press ✂ Save clip… again to record the settings instead.');
  }
}
// Where the video playing came from: a library clip (its id), or a file of your own (the file)
function snipSource() {
  const m = inMedia.vid;
  if (!vid.video || !m) return null;
  if (m.kind === 'clip') return { from: m.id, name: m.name };
  if (m.kind === 'own') return { file: ownFiles.get(m.name) || null, name: m.name };
  return null;
}
const baseName = (n) => String(n || 'Video').replace(/\.[a-z0-9]{2,4}$/i, '');
// A time for a file name (Windows won't take a colon): 7s, 2.5s, 1m05s, 1m05.5s (tenths only when there are any)
const nameT = (t) => {
  t = Math.max(0, Math.round(t * 10) / 10);
  const m = Math.floor(t / 60), x = Math.round((t - m * 60) * 10) / 10;
  const xs = Number.isInteger(x) ? String(x) : x.toFixed(1);
  return m ? `${m}m${xs.padStart(Number.isInteger(x) ? 2 : 4, '0')}s` : `${xs}s`;
};
async function snipOpenForm() {
  const form = $('#snipPanel');
  if (APP || inArtifact) { snipSay('Saving to the clip library works on a computer with Phosphor Clips, in Chrome or Edge.'); return; }
  try { localStorage.setItem(CLIP_ON_KEY, '1'); } catch (_) { /* fine */ }
  snipSay('Looking for Phosphor Clips on this computer…');
  try { await clipList(true); } catch (_) {
    snipSay('Phosphor Clips isn’t answering. Start it on this computer (it sits by the clock), then try again. If the browser asks whether this site may reach apps on this device, press Allow.');
    return;
  }
  // Everything Save clip saves goes in the Look library (Phosphor Clips' Looks folder), apart from the web clips
  if (!hasLooks()) {
    snipSay('This Phosphor Clips is too old for the Look library, where Save clip saves. Install Phosphor Clips 1.9 or later, then try again.');
    return;
  }
  const src = videoIn() ? snipSource() : null;
  // The folder: the last one in the Look library saved to, or its top
  let keep = lsGet(SNIP_CAT_KEY) || '';
  if (!keep.startsWith(LOOKS + '|')) keep = cxKey(LOOKS, '');
  const sel = $('#snipCat');
  const was = clips.view;
  clipsSetView('looks');
  folderOptions(sel, null);
  clipsSetView(was);
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : cxKey(LOOKS, '');
  cxTagsBuild();
  snipSay('');
  form.hidden = false;
  snip.open = true;
  $('#snipOpen').setAttribute('aria-pressed', 'true');
  // A video in: trim it, or record the settings (asked each time). Otherwise: record the settings.
  if (videoIn() && src) snipStage('choose');
  else if (!canMoves()) { snipCloseForm(); snipSay('This browser can’t record the picture. Use Chrome or Edge.'); return; }
  else snipStage('rec');
  form.scrollIntoView({ block: 'nearest' });
}
// What the panel shows: choose, trim, rec (ready to record), recording, recorded
function snipStage(stage) {
  snip.stage = stage;
  $('#snipPanel').dataset.stage = stage;
  const what = {
    choose: 'A video is in. What would you like to save?',
    rec: 'Records the settings, not a movie: each loop’s inputs, every effect and fader, mixing, Color grading and 3D lighting, and how they change as you (or Autopilot) go. It plays back live later, from the Look library.',
    recording: '',
    recorded: '',
  }[stage];
  if (what !== undefined) $('#snipWhat').textContent = what;
  if (stage === 'rec') {
    $('.snip-recsound').style.display = '';
    $('#snipRecLabel').textContent = 'Start recording';
    $('#snipRecGo').setAttribute('aria-pressed', 'false');
    $('#snipRecHint').textContent = snd.track && snd.track.readyState === 'live'
      ? 'A video is saved with it too, at the size picked here, with the sound React to sound hears.'
      : 'A video is saved with it too, at the size picked here. For sound in it, first pick Computer sound or Microphone under React to sound.';
  }
}
// Trim the video playing: the trim starts as the part Repeat a section marks, or the whole video
function snipTrimStart() {
  const src = snipSource();
  if (!src) { snipCloseForm(); snipSay('Put a video in first: Inputs › Video › Clip library… or Choose a video….'); return; }
  snipStage('trim');
  snip.base = baseName(src.name);
  snip.autoName = true;
  const d = vidDur();
  snip.a = vid.loopA ?? 0;
  snip.b = vid.loopB ?? d;
  snip.play = true;
  $('#trimPlay').setAttribute('aria-pressed', 'true');
  snip.v0 = 0; snip.v1 = 0; snip.drag = null;
  [snip.v0, snip.v1] = trimViewFor();
  trimDraw();
  // A snip of a tagged clip starts with its tags; the suggestions are every tag in the library
  const tg = ((src.from && cxClip(src.from)?.tags) || []).slice();
  if (vid.sticker && !tg.some((t) => String(t).toLowerCase() === STICKER_TAG)) tg.unshift(STICKER_TAG);
  $('#snipTags').value = tg.join(', ');
  if (vid.video) { vid.video.currentTime = snip.a; vid.video.play().catch(() => {}); }
}
function snipCloseForm() {
  peekStop();
  if (mvRec.on) mvRecStop(true);
  mvRecDrop();
  $('#snipPanel').hidden = true;
  $('#snipOpen').setAttribute('aria-pressed', 'false');
  snip.open = false;
  snip.stage = '';
  snip.drag = null;
}
async function snipSave() {
  if (snip.busy) return;
  if (snip.stage === 'recorded') return mvSave();
  if (snip.stage !== 'trim') return;
  const src = snipSource(), r = snipRange();
  if (!src) { snipSay('The video has gone. Play it again, then save.'); return; }
  if (!(r.b - r.a >= 0.2)) { snipSay('The trimmed part is too short. Drag the end handle further on.'); return; }
  const name = $('#snipName').value.trim(), where = $('#snipCat').value, { c: cat, p: folder } = splitKey(where);
  try { localStorage.setItem(SNIP_CAT_KEY, where); } catch (_) { /* fine */ }
  // A sticker always keeps its "sticker" tag, or it would play from the library as two pictures stacked
  const tags = splitTags($('#snipTags').value);
  if (vid.sticker && !tags.some((t) => t.toLowerCase() === STICKER_TAG)) tags.unshift(STICKER_TAG);
  const q = new URLSearchParams({ start: r.a.toFixed(3), name, cat, folder, sound: $('#snipSound').checked ? '1' : '0', tags: tags.join(',') });
  // The effects on screen now (taken before the cut, so a change while it's cutting doesn't creep in)
  const look = $('#snipFx').checked ? clipLookNow() : null;
  if (r.b < r.d - 0.05) q.set('end', r.b.toFixed(3));
  let body = null;
  if (src.from) q.set('from', src.from);
  else {
    q.set('src', src.name);
    body = src.file;
    // A file opened another way (by the sequencer, say): what the video is playing from
    if (!body) {
      try { body = await (await fetch(vid.video.currentSrc || vid.video.src)).blob(); } catch (_) {
        snipSay(`Pick “${src.name}” again with Choose a video…, then save.`);
        return;
      }
    }
  }
  snip.busy = true;
  $('#snipSave').disabled = true;
  snipSay(body ? 'Sending the video to Phosphor Clips and cutting the part out…' : 'Phosphor Clips is cutting the part out…');
  try {
    const res = await fetch(`${clips.base}/snip?${q}`, { method: 'POST', body, cache: 'no-store', targetAddressSpace: 'loopback',
      headers: body ? { 'Content-Type': body.type || 'application/octet-stream' } : {} });
    let j = null;
    try { j = await res.json(); } catch (_) { /* answered without a reason */ }
    if (!res.ok || !j || !j.ok) {
      snipSay(j && j.message ? `Couldn’t save it: ${j.message}` : res.status === 404 || res.status === 405
        ? 'This Phosphor Clips is too old to take snips. Install the newest one (1.6 or later), then try again.'
        : 'Couldn’t save it. Is Phosphor Clips still running?');
      return;
    }
    // The effects go to the new clip separately (they're too big to send in the snip's address)
    let fxNote = '';
    if (look) {
      try {
        const e = await fetch(`${clips.base}/clip/${encodeURIComponent(j.clip.id)}`, { method: 'POST', cache: 'no-store', targetAddressSpace: 'loopback',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ look }) });
        const ej = await e.json().catch(() => null);
        fxNote = e.ok && ej && ej.ok ? ', with the effects on screen' : ' (its effects couldn’t be saved: this Phosphor Clips is too old for them; install 1.7 or later)';
      } catch (_) { fxNote = ' (its effects couldn’t be saved)'; }
    }
    snipCloseForm();
    snipSay(`Saved “${j.clip.n}” to ${[j.cat || clipCatName(j.clip.c), ...String(j.clip.p || '').split('/').filter(Boolean)].join(' › ')}${fxNote}. It’s in Clip library… and the sequencer’s + Add clip….`);
    toast(`Saved “${j.clip.n}” to the clip library.`);
    await clipList(true).catch(() => {});
    if (!clipsDlg.hidden) { clipsBuild(); clipsFilter(); }
  } catch (_) {
    snipSay('Couldn’t reach Phosphor Clips. Is it running on this computer?');
  } finally {
    snip.busy = false;
    $('#snipSave').disabled = false;
  }
}
$('#snipOpen').addEventListener('click', () => { if (snip.open) snipCloseForm(); else void snipOpenForm(); });
$('#snipPickTrim').addEventListener('click', snipTrimStart);
$('#looksOpen').addEventListener('click', () => openClips('looks'));
// The size a look's video is recorded at (remembered in this browser)
try { const v = localStorage.getItem('phosphor-look-size'); if (['1080', '1440', '2160'].includes(v)) $('#snipRecSize').value = v; } catch (_) { /* fine */ }
$('#snipRecSize').addEventListener('change', () => { try { localStorage.setItem('phosphor-look-size', $('#snipRecSize').value); } catch (_) { /* fine */ } });
$('#snipPickMoves').addEventListener('click', () => snipStage('rec'));
$('#snipRecGo').addEventListener('click', () => { if (mvRec.on) mvRecStop(); else mvRecStart(); });
$('#snipRedo').addEventListener('click', () => { mvRecDrop(); snipStage('rec'); snipSay(''); });
$('#snipName').addEventListener('input', () => { snip.autoName = false; });
window.__plSnip = { time: () => (vid.video ? vid.video.currentTime : 0), get state() { return { ...snip }; }, get peek() { return { on: peek.on, which: peek.which }; } };   // for tests/snips_check.py
$('#snipCancel').addEventListener('click', () => { snipCloseForm(); snipSay(''); });
$('#snipPanel').addEventListener('submit', (e) => { e.preventDefault(); void snipSave(); });
// Keys typed in the panel stay there (not Phosphor Loop's shortcuts)
$('#snipPanel').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); snipCloseForm(); } e.stopPropagation(); });
$('#snipName').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); $('#snipCancel').click(); } });

/* ================= recorded moves: the settings over time, saved to the clip library and played back live ================= */
// ✂ Save clip… › Record the settings: while it records, the look (a preset's snapshot plus which loops play the
// Video, how many loops, and which picture or library clip is in) is noted up to 30 times a second (js/moves.js
// keeps only what changes, and thins smooth changes out), and the picture itself is recorded as a preview. Save sends
// the preview to Phosphor Clips like a video of your own (its /snip), then the start look plus the recording as
// the clip's effects (look.moves). In the clip library, Play the recording rebuilds the picture from them, live:
// the inputs really run here, sound reacts to whatever plays now, and the recording starts over at its end.
const MV_MAX = 600;   // a recording stops by itself after ten minutes
const MV_RATE = 1000 / 30;
const mvRec = { pending: null, sound: false, on: false, rec: null, start: null, t0: 0, last: 0, vr: null, chunks: [], blob: null, ext: 'webm', moves: null, drop: false, media: '' };
// Which picture and video are in (when a loop shows them), as text, so a change is one event
function mvMediaNow() {
  const m = {};
  // Each loop's own picture, for the loops that show one
  for (const k of activeKeys()) {
    if (!loopUsesPic(k) || !pics[k].media) continue;
    (m.pics ||= {})[k] = { ...pics[k].media };
    if (pics[k].media.kind === 'own') seqKeepPointer(pics[k].media.name, pics[k].handle);
  }
  const sv = vidShown();
  if (vidInUse(sv) && sv.media) { m.vid = { ...sv.media }; delete m.vid.at; }
  if (m.vid && m.vid.kind === 'own') seqKeepPointer(m.vid.name, sv.handle);
  return m.pics || m.vid ? JSON.stringify(m) : '';
}
const mvLookNow = () => ({ ...clipLookNow(), n: loopCount, media: mvMediaNow() });
function mvRecStart() {
  if (mvRec.on || mvRec.pending) return;
  mvRecDrop();
  // The picture is drawn at the size picked (1080p, 1440p or 4K, in its own shape) while it records, not at the size
  // of the preview on this page; it goes back when the recording stops
  if (!window.__phosphorCaptureConfig || window.__phosphorCaptureConfig.off) {
    const lines = +$('#snipRecSize').value || 1080, aspect = canvas.width / Math.max(1, canvas.height);
    const h = lines, w = Math.min(4096, Math.round((h * aspect) / 2) * 2);
    // (the loops drawn with as many lines; SIM_H / 576 is 1 here, smaller only in the tests' lowered page)
    MV.size = { width: w, height: h, renderHeight: Math.round((h * SIM_H) / 576) };
    fit();
  }
  mvRec.pending = { frames: 0 };
  snipStage('recording');
  $('#snipRecGo').setAttribute('aria-pressed', 'true');
  $('#snipRecLabel').textContent = 'Getting ready…';
  $('#snipWhat').textContent = '';
  snipSay('');
}
// The recording really starts once the picture is drawing at its new size (or after 90 frames, whatever happens)
function mvRecBegin() {
  mvRec.pending = null;
  let stream;
  try { stream = canvas.captureStream(60); } catch (_) { mvRecFail('This browser can’t record the picture. Use Chrome or Edge.'); return; }
  // Sound: what React to sound hears (a copy, so listening carries on), when Sound is ticked
  const heardRaw = $('#snipRecSound').checked && snd.track && snd.track.readyState === 'live' ? snd.track.clone() : null;
  mvRec.blend = heardRaw ? blendSounds([heardRaw], recSync) : null;
  const heard = mvRec.blend ? mvRec.blend.track : null;
  if (heard) stream.addTrack(heard);
  mvRec.sound = !!heard;
  // H.264 where the browser makes it (on the graphics card, so the picture keeps its speed), else WebM; Opus sound at
  // 320 kbps where it can (AAC at 192, the most Windows' AAC encoder makes, otherwise). Phosphor Clips keeps looks at
  // high quality, up to 4K, sound at 320 kbps.
  const types = heard
    ? ['video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']
    : ['video/mp4;codecs=avc1', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  // Plenty of bits: fine feedback detail is the hardest thing there is for a video encoder
  const px = canvas.width * canvas.height, vbps = Math.round(clamp(px * 60 * 0.3, 25e6, 160e6));
  const abps = /mp4a/.test(mime) ? 192000 : 320000;
  try { mvRec.vr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: vbps, audioBitsPerSecond: abps } : undefined); }
  catch (_) { stream.getTracks().forEach((t) => t.stop()); mvRecFail('This browser can’t record the picture. Use Chrome or Edge.'); return; }
  const vr = mvRec.vr;
  mvRec.chunks = [];
  mvRec.drop = false;
  vr.ondataavailable = (e) => { if (e.data && e.data.size) mvRec.chunks.push(e.data); };
  vr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    if (heardRaw) heardRaw.stop();
    if (mvRec.blend?.ctx) { try { mvRec.blend.ctx.close(); } catch (_) {} }
    mvRec.blend = null;
    const type = vr.mimeType || mime || 'video/webm', chunks = mvRec.chunks;
    mvRec.chunks = [];
    if (mvRec.drop || mvRec.vr !== vr) return;
    mvRec.vr = null;
    const ms = mvRec.moves ? mvRec.moves.dur * 1000 : 0, raw = new Blob(chunks, { type });
    mvRec.ext = type.includes('mp4') ? 'mp4' : 'webm';
    if (!raw.size || !mvRec.moves) { snipStage('rec'); snipSay('Nothing was recorded. Try again.'); return; }
    try { mvRec.blob = await (mvRec.ext === 'mp4' ? standardMp4(raw) : addWebmDuration(raw, ms)); } catch (_) { mvRec.blob = raw; }
    mvRecDone();
  };
  mvRec.start = mvLookNow();
  mvRec.media = mvRec.start.media;
  const sv = vidShown();
  mvRec.start.mediaAt = r1(sv.video && vidInUse(sv) ? sv.video.currentTime || 0 : 0);
  mvRec.rec = new PhosphorMoves.Recorder(mvRec.start);
  mvRec.moves = null;
  mvRec.on = true;
  mvRec.t0 = performance.now();
  mvRec.last = mvRec.t0;
  vr.start(500);
  $('#snipRecLabel').textContent = 'Stop 0:00';
  $('#snipRecHint').textContent = `Recording at ${canvas.width}×${canvas.height}${mvRec.sound ? ', with sound' : $('#snipRecSound').checked ? ', no sound (React to sound isn’t listening)' : ''}. Change inputs, move faders, or let Autopilot run. Press Stop when you’re done.`;
}
function mvRecFail(why) {
  mvSizeBack();
  snipStage('rec');
  snipSay(why);
}
// The picture goes back to the size of the preview here
function mvSizeBack() {
  if (!MV.size) return;
  MV.size = null;
  fit();
}
// Each frame while recording: the look, at most 30 times a second
function mvRecTick(now) {
  if (mvRec.pending) {
    const want = MV.size;
    if (!want || (canvas.width === want.width && canvas.height === want.height && simH === Math.min(want.renderHeight, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096)) || ++mvRec.pending.frames > 90) mvRecBegin();
    return;
  }
  if (!mvRec.on) return;
  if (now - mvRec.last < MV_RATE - 2) return;
  mvRec.last = now;
  const t = (now - mvRec.t0) / 1000;
  const look = mvLookNow();
  look.mediaAt = mvRec.start.mediaAt;
  mvRec.rec.sample(look, t);
  $('#snipRecLabel').textContent = `Stop ${fmt(t)}`;
  if (t >= MV_MAX) { mvRecStop(); snipSay('Recordings stop at ten minutes. This one is ready to save.'); }
}
function mvRecStop(drop) {
  if (mvRec.pending) { mvRec.pending = null; mvSizeBack(); if (!drop) snipStage('rec'); return; }
  if (!mvRec.on) return;
  mvRec.on = false;
  mvSizeBack();
  const t = (performance.now() - mvRec.t0) / 1000;
  mvRec.moves = mvRec.rec.finish(t);
  mvRec.rec = null;
  mvRec.drop = !!drop;
  $('#snipRecGo').setAttribute('aria-pressed', 'false');
  if (drop) { try { mvRec.vr && mvRec.vr.stop(); } catch (_) { /* gone */ } mvRec.vr = null; mvRec.moves = null; return; }
  if (t < 0.5) { mvRec.drop = true; try { mvRec.vr.stop(); } catch (_) {} mvRec.vr = null; mvRec.moves = null; snipStage('rec'); snipSay('That was too short. Record for a little longer.'); return; }
  $('#snipRecLabel').textContent = 'Finishing…';
  try { mvRec.vr.stop(); } catch (_) { mvRecDone(); }
}
// What's on show on screen at the start: the inputs' names (for the recording's own name)
function mvBaseName() {
  const shown = activeKeys().filter((k) => wOf(mix.tgt, k) > 0.05);
  const names = [...new Set(shown.flatMap((k) => [loops[k].tgt.in1, loops[k].tgt.in2]).filter((x) => x && x !== 'none' && x !== 'loop').map((x) => SRC_LABEL[x] || x))];
  return names.slice(0, 3).join(' + ') || 'Recording';
}
function mvRecDone() {
  snipStage('recorded');
  // Sound: Keep it when saving (only offered when there was some)
  $('.snip-recsound').style.display = mvRec.sound ? '' : 'none';
  const m = mvRec.moves, nCh = Object.keys(m.tr).length + new Set(m.ev.map((e) => e[1])).size;
  $('#snipWhat').textContent = `Recorded ${fmt(m.dur)}: ${nCh === 0 ? 'nothing changed (it plays back as a still look)' : `${nCh} setting${nCh === 1 ? '' : 's'} changed along the way`}.`;
  $('#snipRecHint').textContent = '';
  const when = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#snipName').value = `${mvBaseName()} ${when}`.slice(0, 80);
  $('#snipTags').value = '';
  $('#snipName').focus();
  $('#snipName').select();
}
function mvRecDrop() {
  if (mvRec.pending) { mvRec.pending = null; mvSizeBack(); }
  if (mvRec.vr) { mvRec.drop = true; try { mvRec.vr.stop(); } catch (_) {} mvRec.vr = null; }
  mvRec.on = false; mvRec.rec = null; mvRec.blob = null; mvRec.moves = null; mvRec.chunks = [];
}
async function mvSave() {
  if (!mvRec.blob || !mvRec.moves) { snipSay('Record something first.'); return; }
  const name = $('#snipName').value.trim() || mvBaseName(), where = $('#snipCat').value, { c: cat, p: folder } = splitKey(where);
  try { localStorage.setItem(SNIP_CAT_KEY, where); } catch (_) { /* fine */ }
  const look = { ...mvRec.start, moves: mvRec.moves };
  const size = JSON.stringify(look).length;
  // Phosphor Clips takes effects up to 4 MB
  if (size > 3.9e6) { snipSay('This recording is too long to save (too many changes). Record a shorter one.'); return; }
  const fileName = `${name.replace(/[\\/:*?"<>|]/g, ' ')}.${mvRec.ext}`;
  const q = new URLSearchParams({ start: '0', name, cat, folder, sound: mvRec.sound && $('#snipRecSound').checked ? '1' : '0', tags: splitTags($('#snipTags').value).join(','), src: fileName });
  snip.busy = true;
  $('#snipSave').disabled = true;
  snipSay('Sending the recording to Phosphor Clips…');
  try {
    const res = await fetch(`${clips.base}/snip?${q}`, { method: 'POST', body: mvRec.blob, cache: 'no-store', targetAddressSpace: 'loopback',
      headers: { 'Content-Type': mvRec.blob.type || 'application/octet-stream' } });
    let j = null;
    try { j = await res.json(); } catch (_) { /* answered without a reason */ }
    if (!res.ok || !j || !j.ok) {
      snipSay(j && j.message ? `Couldn’t save it: ${j.message}` : 'Couldn’t save it. Is Phosphor Clips still running (1.6 or later)?');
      return;
    }
    let ok = false;
    try {
      const e = await fetch(`${clips.base}/clip/${encodeURIComponent(j.clip.id)}`, { method: 'POST', cache: 'no-store', targetAddressSpace: 'loopback',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ look }) });
      const ej = await e.json().catch(() => null);
      ok = e.ok && ej && ej.ok;
    } catch (_) { ok = false; }
    const where = [j.cat || clipCatName(j.clip.c), ...String(j.clip.p || '').split('/').filter(Boolean)].join(' › ');
    mvRecDrop();
    snipCloseForm();
    if (ok) {
      snipSay(`Saved the recording “${j.clip.n}” to ${where}. To play it back, press Look library under the picture, pick it, then Play the recording.`);
      toast(`Saved the recording “${j.clip.n}” to the Look library.`);
    } else snipSay(`Saved the preview “${j.clip.n}” to ${where}, but not its settings: this Phosphor Clips is too old for them. Install 1.7 or later, then record again.`);
    cxLooks.delete(j.clip.id);
    await clipList(true).catch(() => {});
    if (!clipsDlg.hidden) { clipsBuild(); clipsFilter(); }
  } catch (_) {
    snipSay('Couldn’t reach Phosphor Clips. Is it running on this computer?');
  } finally {
    snip.busy = false;
    $('#snipSave').disabled = false;
  }
}

// Playing a recording back
const mvPlay = { p: null, t0: 0, dur: 0, name: '', ui: 0, dirty: new Set() };
const isMoves = (look) => !!look && PhosphorMoves.clean(look.moves);
function setPath(o, path, v) {
  const parts = path.split('.');
  for (let i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') return false; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = v;
  return true;
}
// Brings in the picture or library clip the recording had at that point (as the sequencer does for its blocks)
function mvMedia(sig, at) {
  let m = null;
  try { m = sig ? JSON.parse(sig) : null; } catch (_) { m = null; }
  if (!m) return;
  // (a recording from before each loop had its own picture has one picture for all of them)
  const want = m.pics || (m.pic ? Object.fromEntries(activeKeys().map((k) => [k, m.pic])) : {});
  for (const [k, pm] of Object.entries(want)) if (pics[k] && !sameMedia(pm, pics[k].media)) seqLoadPic(pm, k);
  if (m.vid && !sameMedia(m.vid, inMedia.vid)) seqLoadVid({ a: seq.t, media: { vid: { ...m.vid, at: at || 0 } } });
}
function movesPlay(c, look) {
  movesStop(true);
  const start = { ...look };
  delete start.moves;
  MV.applying = true;
  try {
    loadPreset({ id: '', name: c.n, data: start }, true);
    mvMedia(start.media, start.mediaAt);
  } finally { MV.applying = false; }
  mvPlay.p = new PhosphorMoves.Player(start, look.moves);
  mvPlay.dur = look.moves.dur;
  mvPlay.name = c.n;
  mvPlay.t0 = performance.now();
  mvPlay.ui = 0;
  MV.play = mvPlay;
  $('#movesBar').hidden = false;
  showOSD('RECORDING', c.n.toUpperCase().slice(0, 18));
  toast(`Playing the recording “${c.n}”. It starts over at its end; Stop (or touching a control) ends it.`, 6000);
}
function movesStop(quiet, why) {
  if (!MV.play) return;
  MV.play = null;
  mvPlay.p = null;
  $('#movesBar').hidden = true;
  // What's on screen now stays, and is kept as yours (as if you'd set it)
  setGrade({ ...grade }); setRelief({ ...relief }); setType({ ...typeArt }); saveText();
  syncUI();
  if (!quiet) toast(why || 'Stopped the recording. The picture stays as it was.');
}
// Each frame while a recording plays: the settings that changed since the last frame
function movesTick(now) {
  if (!MV.play) return;
  const p = mvPlay.p, t = ((now - mvPlay.t0) / 1000) % Math.max(0.05, mvPlay.dur);
  const diff = p.step(t), d = mvPlay.dirty;
  MV.applying = true;
  try {
    for (const [path, v] of diff) {
      const dot = path.indexOf('.'), g = dot < 0 ? path : path.slice(0, dot), rest = dot < 0 ? '' : path.slice(dot + 1);
      if (KEYS.includes(g)) {
        if (!rest || v === null) continue;
        setPath(loops[g].tgt, rest, v);
        d.add('loops');
        if (rest === 'in1' || rest === 'in2') d.add('devices');
      } else if (g === 'mix' && rest && Number.isFinite(v)) { mix.tgt[rest] = v; d.add('loops'); }
      else if (g === 'adj' && rest && v !== null) { if (setPath(adj, rest, v)) d.add('adj'); }
      else if (g === 'snd' && rest && v !== null) { if (rest === 'amount' || rest === 'detail' ? (snd[rest] = v, true) : /^(map|react)\./.test(rest) && setPath(snd, rest, v)) d.add('snd'); }
      else if (g === 'grade' && rest in GRADE_DEF && Number.isFinite(v)) { grade[rest] = v; d.add('grade'); }
      else if (g === 'relief' && rest in RELIEF_DEF && v !== null) { relief[rest] = v; d.add('relief'); }
      else if (g === 'type' && rest && v !== null && rest in typeArt) { typeArt[rest] = v; d.add('type'); }
      else if (g === 'text') {
        if (rest === 'str' && typeof v === 'string') txt.str = v.slice(0, 60);
        else if (rest === 'style' && v in TEXT_FONTS) txt.style = v;
        drawText();
      } else if (g === 'n' && (v === 2 || v === 3 || v === 4) && v !== loopCount) { setLoopCount(v, 'load'); d.add('loops'); d.add('devices'); }
      else if (g === 'media') mvMedia(v, 0);
    }
    if (d.has('devices')) {
      const used = activeKeys().flatMap((k) => [loops[k].tgt.in1, loops[k].tgt.in2]);
      if (used.includes('camera') && !cam.on) startCamera();
      if (used.includes('screen') && !scr.on) startScreen(true);
      if (used.includes('phone')) startPhoneLink();
      settleDevices();
      d.delete('devices');
    }
  } finally { MV.applying = false; }
  // The controls follow along a few times a second (not every frame)
  if (now - mvPlay.ui > 250) {
    mvPlay.ui = now;
    if (d.has('loops')) syncUI();
    if (d.has('adj')) syncAdjUI();
    if (d.has('snd')) syncSoundUI();
    if (d.has('grade')) syncGradeUI();
    if (d.has('relief')) syncReliefUI();
    if (d.has('type')) syncTypeUI();
    d.clear();
    $('#movesText').innerHTML = `<b>Playing “${escapeHTML(mvPlay.name)}”</b> · ${fmt(t)} of ${fmt(mvPlay.dur)} · starts over at the end`;
  }
}
$('#movesStop').addEventListener('click', () => movesStop());
// Touching a control while a recording plays: you take over, and the recording stops (it would undo you otherwise)
const mvTakeOver = (e) => {
  if (!MV.play || MV.applying || !e.isTrusted) return;
  const el = e.target;
  if (!el.closest || !el.closest('aside.panel, .loop-col') || el.closest('#clipsDlg, .preset-row, .seq')) return;
  if (e.type === 'input' && !el.matches('input[type="range"], select, input[type="checkbox"]')) return;
  if (e.type === 'click' && !el.closest('[data-src], .recipe, #inputs button')) return;
  movesStop(false, 'You took over, so the recording stopped. The picture stays as it was.');
};
document.addEventListener('input', mvTakeOver, true);
document.addEventListener('click', mvTakeOver, true);
window.__plMoves = { get rec() { return { on: mvRec.on, moves: mvRec.moves, blob: !!mvRec.blob, stage: snip.stage }; }, get play() { return MV.play ? { t: mvPlay.p.lastCs / 100, name: mvPlay.name } : null; },
  movesPlay, movesStop, tgt: (k) => ({ ...loops[k].tgt }), web: () => clips.web || [], drawn: () => ({ w: canvas.width, h: canvas.height, screen: !MV.size }), M: () => PhosphorMoves };   // for tests/moves_check.py
function vcrTick() {
  snipBtnSync();
  snipTick();
  for (const o of Object.values(vids)) {
    const ov = o.video;
    if (o === vid || !ov) continue;
    if (o.loopB != null && ov.currentTime >= o.loopB) ov.currentTime = o.loopA ?? 0;
    else if (o.loopA != null && ov.currentTime < o.loopA - 0.25 && !ov.seeking) ov.currentTime = o.loopA;
  }
  const v = vid.video;
  if (!v || scrubbing) return;
  if (vid.loopB != null && v.currentTime >= vid.loopB) v.currentTime = vid.loopA ?? 0;
  else if (vid.loopA != null && v.currentTime < vid.loopA - 0.25 && !v.seeking) v.currentTime = vid.loopA;
  markBar();
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
  { name: 'Leaning tunnel', after: 'Slide Off-center up and down, or turn on React to sound so the hits shove it around.',
    text: 'A tunnel whose vanishing point wanders off to one side and back, so it leans and swings instead of sitting dead centre.',
    how: 'SHAPE · OFF-CENTER 80 · ZOOM IN 22 · SPIN 10 · TRAILS 92',
    sw: 'repeating-radial-gradient(circle at 72% 38%,#120822 0 7px,#8b1ab8 7px 9px,#4fd1c5 9px 11px)',
    patch: { A: { in1: 'shape', form: 4, zoom: 22, spin: 10, trails: 92, color: 14, offc: 80 } } },
  { name: 'Light corridor', after: 'Try Floor & ceiling under Corridor, or another nature picture with ◀ ▶ under Picture.',
    text: 'The picture is scanned into streaks of light that rush toward you down a corridor, like the end of 2001: A Space Odyssey.',
    how: 'PICTURE · CORRIDOR 100 TUNNEL · TRAILS 60',
    sw: 'conic-gradient(from 0deg at 50% 50%,#ff3b8b,#3bd1ff,#ffd23b,#8b1ab8,#3bff9a,#ff3b8b)',
    patch: { A: { in1: 'picture', size: 100, zoom: 6, spin: 0, trails: 60, color: 8, corr: 100, corrShape: 0, scanSpeed: 1 } } },
  { name: 'Glow tunnel', after: 'Press ◀ ▶ or Shuffle under Generative art: every piece makes a different tunnel.',
    text: 'A moving piece of generative art pulled into an endless tunnel of light, turning slowly as it rushes towards you.',
    how: 'GENERATIVE ART · ZOOM IN 28 · SPIN 12 · TRAILS 90',
    sw: 'radial-gradient(circle,#fff6e0 0 4%,#ff5fc8 10%,#7a2cff 22%,#1b0b3a 40%,#05030c 70%)',
    patch: { A: { in1: 'genart', size: 50, zoom: 28, spin: 12, trails: 90, color: 8, blur: 0 } } },
  { name: 'Mandala bloom', after: 'Pick something from the Mandalas kind in the Generative art gallery, or try a 4-way or 8-way mirror.',
    text: 'A moving piece of generative art folded into a six-way kaleidoscope that blooms towards you and turns.',
    how: 'GENERATIVE ART · MIRROR 6 WAY · ZOOM IN 10 · SPIN 18 · TRAILS 86',
    sw: 'conic-gradient(from 0deg,#ffb347,#2ec4b6,#e71d73,#ffb347,#2ec4b6,#e71d73,#ffb347)',
    patch: { A: { in1: 'genart', size: 85, zoom: 10, spin: 18, trails: 86, color: 12, mirror: 6, blur: 0 } } },
  { name: 'Photo finish', after: 'Try it with the camera and wave your arms through the line.',
    text: 'One line of the picture is recorded over and over and spread out to the left, so anything moving through it is drawn out across the screen.',
    how: 'WAVE · PHOTO FINISH 100 · TRAILS 80',
    sw: 'linear-gradient(90deg,#3bd1ff 0 8%,#8b1ab8 8% 14%,#ffd23b 14% 18%,#3bd1ff 18% 30%,#ff3b8b 30% 38%,#8b1ab8 38% 66%,#0b0614 66%)',
    patch: { A: { in1: 'wave', form: 4, zoom: 8, spin: 15, trails: 80, color: 22, scan: 100, scanSpeed: 1 } } },
  { name: 'Smoke on the wind', after: 'Pick a different arrow under Wind, or the middle one to keep the wind turning.',
    text: 'The picture streams off to one side in gusts, curling like smoke in a breeze.',
    how: 'WAVE · WIND 65 TO THE RIGHT · TRAILS 93 · BLUR',
    sw: 'linear-gradient(90deg,#0b0614 0 20%,#4a2a6a 40%,#c7a3ff 55%,#2a1450 75%,#0b0614)',
    patch: { A: { in1: 'wave', form: 3, zoom: 0, spin: 0, trails: 93, color: 18, blur: 0.12, wind: 65, windDir: 0 } } },
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
  { name: 'Contour drift', after: 'Under Topo map, switch Height from to The picture to trace another input’s brightness instead.',
    text: 'A hiking map come to life: glowing contour lines over hills that rise, sink and slide past, leaving soft echoes behind.',
    how: 'TOPO MAP · TRAILS 80 · COLOR 4',
    sw: 'repeating-radial-gradient(circle at 40% 55%,#05070d 0 6px,#29b6ff 6px 7px,#05070d 7px 12px,#ffb840 12px 13px)',
    patch: { A: { in1: 'topo', topoPic: false, size: 100, zoom: 0, spin: 0, trails: 80, color: 4, blur: 0 } } },
  { name: 'Game of Life', after: 'Under Life, try Small cells and Fast, or New life from: The picture to let it feed on its own trails.',
    text: 'Conway’s Game of Life in glowing tiles: cells are born, live and die by a few simple rules, flashing white as they arrive and turning cyan, gold and purple as they age.',
    how: 'LIFE · TRAILS 70 · COLOR 3',
    sw: 'radial-gradient(circle at 30% 35%,#d9f3ff 0 9%,transparent 10%),radial-gradient(circle at 62% 58%,#ffb833 0 9%,transparent 10%),radial-gradient(circle at 45% 70%,#c238ff 0 8%,transparent 9%),#05040a',
    patch: { A: { in1: 'life', lifeCells: 1, lifeSpeed: 1, lifeLoop: false, size: 100, zoom: 0, spin: 0, trails: 70, color: 3, blur: 0 } } },
  { name: 'Storm watch', after: 'Under Doppler radar, switch Shows to Wind for the red and green view, where the spinning storm shows as a bright pair.',
    text: 'A weather radar screen: the beam sweeps round over drifting storms in green, yellow and red, a squall line and one strong storm, with county lines underneath.',
    how: 'DOPPLER RADAR · TRAILS 60',
    sw: 'conic-gradient(from 20deg,#06210f 0 70%,#3dff70 72%,#02060a 73%),radial-gradient(circle at 60% 40%,#fd0000 0 6%,#fdf802 7% 13%,#01c501 14% 24%,transparent 25%)',
    patch: { A: { in1: 'radar', radarWind: false, size: 100, zoom: 0, spin: 0, trails: 60, color: 0, blur: 0 } } },
  { name: 'Liquid marble', after: 'Under Textures, try the other seven styles: Cells, Ripples, Moiré, Maze, Silk, Hex and Spiral.',
    text: 'Veins of light running through slowly stirred marble, its colors turning, with soft echoes spinning out of it.',
    how: 'TEXTURES · MARBLE · ZOOM 12 · SPIN 8 · TRAILS 82',
    sw: 'radial-gradient(ellipse at 30% 40%,#c04dff 0 6%,transparent 18%),repeating-linear-gradient(115deg,#07040c 0 9px,#2fd0ff 9px 10px,#07040c 10px 17px,#ff9a3d 17px 18px)',
    patch: { A: { in1: 'texture', texStyle: 0, size: 100, zoom: 12, spin: 8, trails: 82, color: 2, blur: 0 } } },
  { name: 'Terrain flight', after: 'It wanders from canyon to ridges to plains about once a minute.',
    text: 'A flight over land made of triangles, every edge a glowing wire: teal valleys, gold peaks and a low sun under a starry nebula.',
    how: 'TERRAIN · EVERYTHING ELSE OFF',
    sw: 'linear-gradient(180deg,#070a1c 0 30%,#ffd27a 33%,#1d6f80 38%,#e0a040 60%,#0c3b4f)',
    patch: { A: { in1: 'terrain', size: 100, zoom: 0, spin: 0, trails: 0, color: 0, blur: 0 } } },
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
  if (MV.play && !MV.applying) movesStop(true);
  if (ap.on) setAutopilot(false, true);
  markPreset(null);
  const p = JSON.parse(JSON.stringify(r.patch));
  if (p.A.in1 === 'video' && !anyVid()) { if (clipsReady()) clipPick(pick(clipsAp()), true); else p.A.in1 = 'picture'; }
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
    if (r.soundDetail != null) snd.detail = r.soundDetail;
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
    snd: { amount: snd.amount, detail: snd.detail, map: clone(snd.map), react: clone(snd.react) },
    text: { str: txt.str, style: txt.style },
    grade: { ...grade },
    relief: { ...relief },
    type: { ...typeArt },
  };
}
// While Autopilot runs, a preset also keeps Autopilot's settings and pins, so loading it starts Autopilot again
function apSnapshot() {
  return { every: apSet.every, fade: apSet.fade, wild: apSet.wild, mix: apSet.mix, taste: apSet.taste, beat: apSet.beat, check: apSet.check,
    hints: apSet.hints, touch: apSet.touch, type: apSet.type,
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
  if (MV.play && !MV.applying) movesStop(true);
  for (const k of KEYS) { loopGrade[k] = null; seqRelief[k] = null; }
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
  if (d.snd) { if (d.snd.amount != null) snd.amount = d.snd.amount; if (d.snd.detail != null) snd.detail = d.snd.detail; if (d.snd.map) Object.assign(snd.map, d.snd.map); syncSoundUI(); }
  // Loops that react: as saved, or every loop for a preset saved before the switches existed
  snd.react = { A: true, B: true, C: true, D: true, ...((d.snd && d.snd.react) || {}) };
  syncSoundUI();
  // Presets saved before Color grading existed load with it at normal
  setGrade(d.grade);
  setRelief(d.relief);
  // Presets saved before Type art existed load with it off
  setType(d.type);
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
    apSet.type = a.type === true;
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
  if (used.includes('video') && !anyVid() && clipsReady()) clipPick(pick(clipsAp()), true);
  // (a session coming back with the page brings its library clip back by itself: see clipsStart)
  else if (used.includes('video') && !anyVid() && !(quiet && clipsWanted())) toast('This preset uses a video. Choose one under Video.');
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
  if (cueKey(e)) { e.preventDefault(); return; }
  // In Cue mode Space cuts to the next look, even straight after clicking a preview or moving a fader
  // (Shift+Space freezes instead). Holding it down cuts only once.
  if (e.key === ' ' && cueActive()) {
    e.preventDefault();
    const a = e.target && e.target.ownerDocument && e.target.ownerDocument.activeElement;
    if (a && a.blur && a !== a.ownerDocument.body) a.blur();
    if (e.repeat) return;
    if (e.shiftKey) toggleFreeze(); else nextLook();
    return;
  }
  if (e.key === ' ' && !onControl) { toggleFreeze(); e.preventDefault(); }
  else if (e.key === 'r' || e.key === 'R') surprise();
  else if (e.key === 'p' || e.key === 'P') setAutopilot(!ap.on);
  else if ((e.key === 'l' || e.key === 'L') && !(e.repeat && cueActive())) nextLook();
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
  if (snapBtn) snapBtn.hidden = mode === 'none';
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
if (snapBtn) snapBtn.addEventListener('click', () => { snapPending = true; });

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
// Stereo at 48 kHz, untouched: the browser's call-quality defaults (mono, noise and echo filters) spoil music
const noSoundFixes = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } };
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
  const audio = { ...noSoundFixes };
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
// Sound timing: in a recording the picture comes a little after its sound (it takes the graphics card a moment to
// draw and the recorder to take it), so the sound is held back by this much to match: what the music moves, and looks
// on their cues, line up with the music in the video. Set under Export video; used by Record and Save clip too.
const REC_SYNC_KEY = 'phosphor-rec-sync', REC_SYNCS = [0, 0.25, 0.5, 0.75, 1];
let recSync = 0.5;
{ const v = parseFloat(lsGet(REC_SYNC_KEY)); if (REC_SYNCS.includes(v)) recSync = v; }
// Two sounds (music and mic) are blended into one, since a video holds a single sound track; and held back by delay
// seconds (Sound timing)
function blendSounds(tracks, delay = 0) {
  if (!tracks.length) return { track: null, ctx: null };
  if (tracks.length < 2 && !(delay > 0)) return { track: tracks[0], ctx: null };
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx;
  try { ctx = new AC({ sampleRate: 48000 }); } catch (_) { ctx = new AC(); }
  const out = ctx.createMediaStreamDestination();
  let into = out;
  if (delay > 0) { const dl = ctx.createDelay(2); dl.delayTime.value = delay; dl.connect(out); into = dl; }
  tracks.forEach((t) => ctx.createMediaStreamSource(new MediaStream([t])).connect(into));
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
  const blend = blendSounds(sounds, recSync);
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
    // Sound at a music-quality rate instead of the browser's 128 kbps: AAC at 192 kbps (the most Windows' AAC
    // encoder makes) or Opus at 256 kbps, both stereo, both sounding the same as the original to the ear
    const audioBitsPerSecond = /mp4/.test(mime) ? 192000 : 256000;
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 10000000, audioBitsPerSecond } : undefined);
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
// 3D lighting from the sequencer's blocks, per track (null: that track doesn't set it). Like Color grading, it sits
// over your own 3D lighting settings without changing them, and holds when the sequence stops; Neutral and loading a
// preset put it back to yours.
const seqRelief = { A: null, B: null, C: null, D: null };
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
  set1f(dispProg, 'uGradeOn', gradeOn() && !grade.gInside && !seq.gradeOwned ? 1 : 0);
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
// The 3D lighting drawn now: yours, with whatever the sequencer's blocks set on top (a mix of the tracks that set
// it, each counted as much as its loop shows)
function reliefNow() {
  const out = { ...relief };
  for (const key of Object.keys(RELIEF_DEF)) {
    let sum = 0, wt = 0;
    for (const K of KEYS) {
      const r = seqRelief[K];
      if (!r || !(key in r) || !loopOn(K)) continue;
      const w = Math.max(0.001, clamp(mix.tgt[SHOW[K]], 0, 100) / 100);
      sum += r[key] * w; wt += w;
    }
    if (wt > 0) out[key] = sum / wt;
  }
  return out;
}
function setReliefUniforms(now) {
  const R = reliefNow();
  const dt = reliefLast ? Math.min((now - reliefLast) / 1000, 0.25) : 0;
  reliefLast = now;
  reliefTurn = (reliefTurn + dt * (R.rSpin / 100) ** 2 * Math.PI / 2) % (2 * Math.PI);
  const a = R.rLight * Math.PI / 180 + reliefTurn, e = 40 * Math.PI / 180;
  reliefL[0] = Math.cos(a) * Math.cos(e); reliefL[1] = Math.sin(a) * Math.cos(e); reliefL[2] = Math.sin(e);
  set3f(dispProg, 'uRelief', R.rDepth / 100, 0.004 + 0.046 * R.rSmooth / 100, R.rShine / 100);
  set3f(dispProg, 'uReliefL', reliefL[0], reliefL[1], reliefL[2]);
}
window.__plRelief = { relief, setRelief, adj };

/* ================= type art ================= */
// The picture typed out in characters (js/typeart.js): over the finished picture (Final Pass), or inside each loop,
// so the loops feed on the typed picture (Within Loops). Autopilot leaves it alone, presets keep it, Neutral turns
// it off (and keeps the rest of its settings).
const TA = window.PhosphorTypeArt;
const TYPE_KEY = 'phosphor-type-v1';
const TYPE_DEF = { ...TA.DEFAULTS };
const TYPE_NUM = ['tAmt', 'tSize', 'tLayers', 'tSpread', 'tInk', 'tContrast', 'tEdge', 'tShimmer', 'tHold', 'tBg'];
const TYPE_PICK = { tSet: TA.SETS, tSet2: { same: { label: 'Same as the first layer' }, ...TA.SETS }, tFont: TA.FONTS, tColor: TA.COLORS };
const typeArt = { ...TYPE_DEF };
const typeEls = {};
for (const k of TYPE_NUM) typeEls[k] = { el: $('#' + k), out: $('#' + k + 'Out') };
for (const [k, list] of Object.entries(TYPE_PICK)) {
  const sel = $('#' + k);
  for (const [v, o] of Object.entries(list)) { const op = document.createElement('option'); op.value = v; op.textContent = o.label; sel.append(op); }
}
function typeText(k, v) {
  switch (k) {
    case 'tAmt': return v === 0 ? 'OFF' : `${v}%`;
    case 'tLayers': return String(v);
    case 'tSpread': return v === 0 ? 'SAME' : String(v);
    case 'tInk': return v === 0 ? 'BALANCED' : `${v < 0 ? 'SPARSE' : 'HEAVY'} ${Math.abs(v)}`;
    case 'tContrast': return v === 100 ? 'NORMAL' : `${v}%`;
    case 'tEdge': return v === 0 ? 'OFF' : String(v);
    case 'tShimmer': return v === 0 ? 'EXACT' : String(v);
    case 'tHold': return v === 0 ? 'FREE' : String(v);
    case 'tBg': return v === 0 ? 'NONE' : String(v);
    default: return String(v);
  }
}
// Any saved or loaded Type art, made safe: missing or broken values are the defaults (off)
function cleanType(t) {
  const out = { ...TYPE_DEF };
  if (!t || typeof t !== 'object') return out;
  for (const k of TYPE_NUM) { const { el } = typeEls[k]; if (Number.isFinite(t[k])) out[k] = clamp(Math.round(t[k]), +el.min, +el.max); }
  for (const [k, list] of Object.entries(TYPE_PICK)) if (typeof t[k] === 'string' && t[k] in list) out[k] = t[k];
  if (typeof t.tCustom === 'string' && t.tCustom.trim()) out.tCustom = t.tCustom.slice(0, 80);
  out.tInside = !!t.tInside;
  out.tInvert = !!t.tInvert;
  return out;
}
function syncTypeUI() {
  for (const [k, { el, out }] of Object.entries(typeEls)) { el.value = typeArt[k]; fillTrack(el); out.textContent = typeText(k, typeArt[k]); }
  for (const k of Object.keys(TYPE_PICK)) $('#' + k).value = typeArt[k];
  $('#tCustom').value = typeArt.tCustom;
  $('#tCustomRow').hidden = typeArt.tSet !== 'custom' && typeArt.tSet2 !== 'custom';
  $('#tSet2').closest('.ctl').hidden = typeArt.tLayers < 2;
  $('#tSpread').closest('.ctl').hidden = typeArt.tLayers < 2;
  $$('#typeWhere button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.tin === '1') === typeArt.tInside)));
  $$('#typeInk button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.tinv === '1') === typeArt.tInvert)));
}
function saveType() { try { localStorage.setItem(TYPE_KEY, JSON.stringify(typeArt)); } catch (_) {} }
// Autopilot's Type art fade (see apTypeArt); anything that sets Type art outright stops it
const typeGlide = { on: false, from: 0, to: 0, t0: 0, dur: 1, ui: 0 };
function setType(t) { typeGlide.on = false; Object.assign(typeArt, cleanType(t)); syncTypeUI(); saveType(); }
for (const [k, { el, out }] of Object.entries(typeEls)) {
  el.addEventListener('input', () => {
    typeArt[k] = +el.value; fillTrack(el); out.textContent = typeText(k, typeArt[k]); saveType();
    if (k === 'tLayers') syncTypeUI();
  });
  el.addEventListener('dblclick', () => setType({ ...typeArt, [k]: TYPE_DEF[k] }));
}
for (const k of Object.keys(TYPE_PICK)) $('#' + k).addEventListener('change', (e) => setType({ ...typeArt, [k]: e.target.value }));
$('#tCustom').addEventListener('input', (e) => { if (e.target.value.trim()) { typeArt.tCustom = e.target.value.slice(0, 80); saveType(); } });
$('#typeReset').addEventListener('click', () => setType(TYPE_DEF));
$$('#typeInk button').forEach((b) => b.addEventListener('click', () => setType({ ...typeArt, tInvert: b.dataset.tinv === '1' })));
$$('#typeWhere button').forEach((b) => b.addEventListener('click', () => {
  setType({ ...typeArt, tInside: b.dataset.tin === '1' });
  showOSD('TYPE ART', typeArt.tInside ? 'WITHIN LOOPS' : 'FINAL PASS');
}));
{ let saved = null; try { saved = JSON.parse(localStorage.getItem(TYPE_KEY) || 'null'); } catch (_) {} setType(saved); }
// Autopilot's Type art (Use Type art, under Autopilot; off at first). With it on, about a third of new looks bring
// Type art in (more with How wild up, fewer with it down): a set of characters, a font, a color, a size and the rest
// picked at random, its amount fading up over the Fade time (or fast, on a beat); about half the time a look that
// keeps it on keeps its characters too and only changes how strong it is. The other new looks fade it back out.
// Moving any Type art control yourself stops the fade where it is. Off, Autopilot never touches Type art.
const typeRange = (k) => [Number(typeEls[k].el.min), Number(typeEls[k].el.max)];
function apTypeArt(came, now) {
  if (!apSet.type || !came || typeFailed) return;
  const wild = apSet.wild / 100, odds = 0.2 + 0.3 * wild;
  const isOn = typeArt.tAmt > 0;
  if (Math.random() >= odds) { if (isOn) typeFadeTo(0, now); return; }
  if (!isOn || Math.random() < 0.5) {
    const sets = Object.keys(TA.SETS).filter((k) => k !== 'custom' || (typeArt.tCustom || '').trim());
    const ri = (k, lo, hi) => { const [a, b] = typeRange(k); return Math.round(clamp(rnd(lo, hi), a, b)); };
    const layers = Math.random() < 0.55 ? 1 : Math.random() < 0.75 ? 2 : 3;
    Object.assign(typeArt, cleanType({
      ...typeArt, tAmt: typeArt.tAmt,
      tSet: pick(sets), tSet2: Math.random() < 0.6 ? 'same' : pick(sets), tFont: pick(Object.keys(TA.FONTS)), tColor: pick(Object.keys(TA.COLORS)),
      tSize: ri('tSize', 10, 75), tLayers: layers, tSpread: layers > 1 ? ri('tSpread', 0, 70) : 0, tInk: ri('tInk', -40, 50),
      tContrast: ri('tContrast', 80, 150), tEdge: Math.random() < 0.3 ? ri('tEdge', 10, 60) : 0, tShimmer: ri('tShimmer', 0, 45),
      tHold: ri('tHold', 20, 80), tBg: Math.random() < 0.25 ? ri('tBg', 10, 60) : 0,
      tInside: Math.random() < 0.2, tInvert: Math.random() < 0.15,
    }));
  }
  typeFadeTo(Math.round(rnd(40 + 20 * wild, 100)), now);
}
function typeFadeTo(to, now) {
  Object.assign(typeGlide, { on: true, from: typeArt.tAmt, to, t0: now, dur: (ap.quick ? 1.5 : apFadeSec()) * 1000 });
  syncTypeUI();
}
// Each frame while it fades (the controls follow a few times a second)
function typeTick(now) {
  if (!typeGlide.on) return;
  const u = clamp((now - typeGlide.t0) / typeGlide.dur, 0, 1), e = u * u * (3 - 2 * u);
  typeArt.tAmt = Math.round(typeGlide.from + (typeGlide.to - typeGlide.from) * e);
  if (u >= 1) { typeGlide.on = false; syncTypeUI(); saveType(); return; }
  if (now - typeGlide.ui > 250) { typeGlide.ui = now; const c = typeEls.tAmt; c.el.value = typeArt.tAmt; fillTrack(c.el); c.out.textContent = typeText('tAmt', typeArt.tAmt); }
}
// Your hand on any Type art control: the fade stops where it is
for (const ev of ['input', 'change']) $('#typeGroup').addEventListener(ev, (e) => { if (e.isTrusted) typeGlide.on = false; }, true);
for (const { el } of Object.values(typeEls)) el.addEventListener('pointerdown', () => { typeGlide.on = false; });
// The engine is made the first time Type art is turned up, so a graphics card that can't run it only loses Type art
let typeEng = null, typeFailed = false;
function typeEngine() {
  if (typeEng || typeFailed) return typeEng;
  try { typeEng = TA.create(gl); } catch (err) {
    console.warn('Type art could not start:', err);
    typeFailed = true;
    toast('Type art can’t run on this graphics card.');
  }
  return typeEng;
}
const typeFinalSt = { st: null };
const typeLoopSt = { A: null, B: null, C: null, D: null };
let typeScratch = null;
// Final Pass: the finished picture typed at the screen's own size. Gives back the picture to show.
function typeFinal(tex) {
  const on = typeArt.tAmt > 0 && !typeArt.tInside;
  if (!on) { if (typeFinalSt.st && typeEng) { typeEng.release(typeFinalSt.st); typeFinalSt.st = null; } return tex; }
  const eng = typeEngine();
  if (!eng) return tex;
  if (!typeFinalSt.st) typeFinalSt.st = eng.state();
  return eng.run(typeFinalSt.st, tex, canvas.width, canvas.height, typeArt, typeArt.tAmt / 100, null).tex;
}
// Within Loops: loop k's newest picture typed and put back, so next frame the loop feeds on it. Higher Amount
// types more of it each frame (all of it at the top), at the same pace at any frame rate (f: sixtieths this frame).
function typeInLoop(k, f) {
  const on = typeArt.tAmt > 0 && typeArt.tInside;
  if (!on) { if (typeLoopSt[k] && typeEng) { typeEng.release(typeLoopSt[k]); typeLoopSt[k] = null; } return; }
  const eng = typeEngine();
  const L = loops[k];
  if (!eng || !L.rt) return;
  if (!typeScratch || typeScratch.w !== simW || typeScratch.h !== simH) {
    if (typeScratch) dropTarget(typeScratch);
    typeScratch = { ...makeTarget(), w: simW, h: simH };
  }
  if (!typeLoopSt[k]) typeLoopSt[k] = eng.state();
  const a = Math.pow(typeArt.tAmt / 100, 1.5);
  eng.run(typeLoopSt[k], L.rt[L.front].tex, simW, simH, typeArt, 1 - Math.pow(1 - a, f), typeScratch);
  copyInto(L.rt[L.front], typeScratch.tex);
}
window.__plType = { typeArt, setType, ready: () => !!typeEng, failed: () => typeFailed, fadeTo: (v, secs) => { typeFadeTo(v, performance.now()); typeGlide.dur = secs * 1000; }, get gliding() { return typeGlide.on; } };
/* ================= color filters ================= */
// Posterize (each loop's own) and Color grading can each work on screen, over the finished picture, or inside the
// loop, on what the loop keeps, so it feeds on the filtered picture every frame. Inside, the grading goes about a
// tenth of the way each sixtieth of a second (f: how many sixtieths this frame is), so it builds up at the same
// pace at any frame rate instead of piling up at once.
function setLoopGradeUniforms(f) {
  const on = grade.gInside && gradeOn() && !seq.gradeOwned;
  set1f(fbProg, 'uGradeK', on ? 1 - Math.pow(0.9, f) : 0);
  if (!on) return;
  set4f(fbProg, 'uGradeTone', grade.gExposure / 10, grade.gContrast / 100, Math.max(0.05, grade.gGamma / 100), grade.gSat / 100);
  set2f(fbProg, 'uGradeColor', grade.gHue * Math.PI / 180, grade.gSepia / 100);
  set3f(fbProg, 'uGradeRGB', grade.gRed / 100, grade.gGreen / 100, grade.gBlue / 100);
}
// For tests/: the mirror change under way on a loop (see "mirror transitions")
window.__plMirror = { state: (k) => loops[k].mx };
window.__plGrade = { grade, setGrade, loop: () => JSON.parse(JSON.stringify(loopGrade)), owned: () => !!seq.gradeOwned, snapshot: () => snapshot(), loadPreset: (data) => loadPreset({ id: '', name: '', data }, true) };

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
  ksAttach(w, doc);
  bmAttach(w, doc);
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
  ksDetach();
  bmDetach();
  outBtn.textContent = 'Output window';
  outBtn.setAttribute('aria-pressed', 'false');
  $$('#shape button').forEach((b) => { b.disabled = false; });
  $('#shapeNote').hidden = true;
  syncWide();
}
outBtn.addEventListener('click', () => (outputOpen() ? closeOutput() : openOutput()));
/* ================= fix projector shape (keystone) ================= */
// A projector that isn't straight in front of the wall throws a picture wider at one end, or tilted. Fix projector
// shape (under the picture, while the Output window is open) puts four purple dots on the picture's corners: drag
// each one to where that corner should be on the wall, on the projector itself or on the little map here, with the
// test grid to judge it square. The Output window's picture is bent to fit with a CSS perspective transform
// (matrix3d, from the four corners), so nothing about drawing it changes and it costs the computer nothing. The
// corners are kept (phosphor-keystone) as parts of the window's width and height, so they hold in full screen and
// come back the next time the Output window opens. Corners go clockwise from the top left.
const KS_KEY = 'phosphor-keystone';
const KS_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];
const ks = { pts: null, editing: false, grid: true, sel: -1, doc: null, win: null, dots: [], gridEl: null };
function ksLoad() {
  try {
    const v = JSON.parse(lsGet(KS_KEY) || 'null');
    if (Array.isArray(v) && v.length === 4 && v.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return v;
  } catch (_) {}
  return KS_SQUARE.map((p) => p.slice());
}
ks.pts = ksLoad();
const ksIsSquare = () => ks.pts.every((p, i) => Math.abs(p[0] - KS_SQUARE[i][0]) < 1e-4 && Math.abs(p[1] - KS_SQUARE[i][1]) < 1e-4);
function ksSave() { if (ksIsSquare()) { try { localStorage.removeItem(KS_KEY); } catch (_) {} } else lsSet(KS_KEY, JSON.stringify(ks.pts)); }
// The four corners have to stay a shape with no dents or crossings, or the picture would turn inside out
function ksConvex(P) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = P[i], b = P[(i + 1) % 4], c = P[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-6) return false;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
}
// The CSS matrix3d that takes a W x H box onto the four corners (given as parts of W and H)
function ksMatrix(P, W, H) {
  const [x0, y0] = [P[0][0] * W, P[0][1] * H], [x1, y1] = [P[1][0] * W, P[1][1] * H];
  const [x2, y2] = [P[2][0] * W, P[2][1] * H], [x3, y3] = [P[3][0] * W, P[3][1] * H];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, d, e, g = 0, h = 0;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x2 - x1; d = y1 - y0; e = y2 - y1; }
  else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3;
  }
  const m = [a / W, d / W, 0, g / W, b / H, e / H, 0, h / H, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map((v) => +v.toFixed(9)).join(',')})`;
}
// Bends the Output window's picture (and the test grid) to the corners, and moves the dots there
function ksApply() {
  if (!outputOpen() || !ks.doc) return;
  const W = ks.win.innerWidth || 1, H = ks.win.innerHeight || 1;
  const t = ksIsSquare() ? '' : ksMatrix(ks.pts, W, H);
  outCanvas.style.transform = t;
  if (ks.gridEl) { ks.gridEl.style.transform = t; ks.gridEl.hidden = !(ks.editing && ks.grid); }
  ks.dots.forEach((el, i) => {
    el.hidden = !ks.editing;
    // Kept whole on the screen, so a dot in a corner can still be grabbed (a drag moves its corner by as much as the pointer moves)
    el.style.left = Math.min(W - 24, Math.max(24, ks.pts[i][0] * W)) + 'px';
    el.style.top = Math.min(H - 24, Math.max(24, ks.pts[i][1] * H)) + 'px';
    el.classList.toggle('on', ks.sel === i);
  });
  ksMap();
}
// Moves corner i to (x, y), parts of the window; refused if the shape would fold over
function ksMove(i, x, y) {
  const P = ks.pts.map((p) => p.slice());
  P[i] = [Math.min(1.25, Math.max(-0.25, x)), Math.min(1.25, Math.max(-0.25, y))];
  if (!ksConvex(P)) return false;
  ks.pts = P;
  ksApply();
  ksSave();
  return true;
}
// Dragging a dot: pos(e) gives the pointer as parts of the window (or of the map)
function ksDrag(el, i, pos) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    ks.sel = i;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    const start = pos(e), from = ks.pts[i].slice();
    const move = (ev) => { const p = pos(ev); ksMove(i, from[0] + p[0] - start[0], from[1] + p[1] - start[1]); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    ksApply();
  });
}
// The Output window's dots and test grid, made when it opens
function ksAttach(w, doc) {
  ks.win = w; ks.doc = doc; ks.dots = [];
  const st = doc.createElement('style');
  st.textContent = `canvas#out{transform-origin:0 0}
.ksgrid{position:fixed;left:0;top:0;width:100vw;height:100vh;transform-origin:0 0;pointer-events:none;box-sizing:border-box;border:4px solid #fff;
  background-image:radial-gradient(circle at 50% 50%,transparent 0 calc(min(100vw,100vh)*.2 - 2px),#fff calc(min(100vw,100vh)*.2 - 2px) calc(min(100vw,100vh)*.2 + 1px),transparent calc(min(100vw,100vh)*.2 + 1px)),
  linear-gradient(#fff,#fff),linear-gradient(#fff,#fff),
  linear-gradient(to right,rgba(255,255,255,.55) 2px,transparent 2px),linear-gradient(to bottom,rgba(255,255,255,.55) 2px,transparent 2px);
  background-size:100% 100%,2px 100%,100% 2px,12.5% 100%,100% 12.5%;background-position:0 0,50% 0,0 50%,0 0,0 0;background-repeat:no-repeat,no-repeat,no-repeat,repeat,repeat;background-color:rgba(139,26,184,.25)}
.ksgrid[hidden]{display:none}
.ksdot{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(139,26,184,.85);border:3px solid #fff;box-sizing:border-box;
  box-shadow:0 0 0 3px rgba(0,0,0,.5),0 0 18px rgba(176,108,255,.9);cursor:grab;touch-action:none;z-index:5}
.ksdot.on{background:#d39bff}
.ksdot[hidden]{display:none}`;
  doc.head.appendChild(st);
  ks.gridEl = doc.createElement('div');
  ks.gridEl.className = 'ksgrid';
  ks.gridEl.hidden = true;
  doc.body.appendChild(ks.gridEl);
  for (let i = 0; i < 4; i++) {
    const d = doc.createElement('div');
    d.className = 'ksdot';
    d.hidden = true;
    d.title = 'Drag this corner to where the picture’s corner should be';
    doc.body.appendChild(d);
    ksDrag(d, i, (e) => [e.clientX / (w.innerWidth || 1), e.clientY / (w.innerHeight || 1)]);
    ks.dots.push(d);
  }
  w.addEventListener('resize', ksApply);
  doc.addEventListener('fullscreenchange', () => setTimeout(ksApply, 80));
  $('#ksBtn').hidden = false;
  ksApply();
  if (!ksIsSquare()) toast('The projector shape you fixed last time is back on. Fix projector shape (under the picture) changes it.', 6000);
}
function ksDetach() {
  ks.doc = null; ks.win = null; ks.dots = []; ks.gridEl = null;
  ksEdit(false);
  $('#ksBtn').hidden = true;
}
// The little map under the picture: the window's frame, the bent picture with its grid, and the four dots
const ksMapEl = $('#ksMap');
function ksMapSize() {
  const W = ks.win ? ks.win.innerWidth : 16, H = ks.win ? ks.win.innerHeight : 9;
  const mw = 160, mh = Math.max(40, Math.min(160, Math.round(mw * H / Math.max(1, W))));
  return { mw, mh, pad: 14 };
}
function ksMap() {
  if (!ksMapEl || !ks.editing) return;
  const { mw, mh, pad } = ksMapSize();
  ksMapEl.setAttribute('viewBox', `${-pad} ${-pad} ${mw + pad * 2} ${mh + pad * 2}`);
  const P = ks.pts.map(([x, y]) => [x * mw, y * mh]);
  const at = (u, v) => { // a point inside the bent picture, by straight blending (close enough for a little map)
    const top = [P[0][0] + (P[1][0] - P[0][0]) * u, P[0][1] + (P[1][1] - P[0][1]) * u];
    const bot = [P[3][0] + (P[2][0] - P[3][0]) * u, P[3][1] + (P[2][1] - P[3][1]) * u];
    return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
  };
  let lines = '';
  for (let s = 1; s < 4; s++) {
    const a = at(s / 4, 0), b = at(s / 4, 1), c = at(0, s / 4), d = at(1, s / 4);
    lines += `M${a[0]},${a[1]}L${b[0]},${b[1]}M${c[0]},${c[1]}L${d[0]},${d[1]}`;
  }
  // Made once and then only moved, so a dot picked with the keyboard keeps its focus while it's nudged
  if (!ksMapEl.querySelector('.ks-quad')) {
    ksMapEl.innerHTML = '<rect class="ks-frame" x="0" y="0"/><polygon class="ks-quad"/><path class="ks-line"/>' +
      [0, 1, 2, 3].map((i) => `<circle class="ks-dot" data-i="${i}" tabindex="0" r="6"><title>Drag this corner (arrow keys nudge it)</title></circle>`).join('');
  }
  const fr = ksMapEl.querySelector('.ks-frame');
  fr.setAttribute('width', mw); fr.setAttribute('height', mh);
  ksMapEl.querySelector('.ks-quad').setAttribute('points', P.map((p) => p.join(',')).join(' '));
  ksMapEl.querySelector('.ks-line').setAttribute('d', lines);
  ksMapEl.querySelectorAll('.ks-dot').forEach((c, i) => {
    c.setAttribute('cx', P[i][0]); c.setAttribute('cy', P[i][1]);
    c.classList.toggle('on', ks.sel === i);
  });
}
// Map dots: dragged by the map's own measure (the map is redrawn while dragging, so the drag is caught on the map)
if (ksMapEl) {
  const mapPos = (e) => {
    const r = ksMapEl.getBoundingClientRect(), { mw, mh, pad } = ksMapSize();
    const sx = (mw + pad * 2) / r.width, sy = (mh + pad * 2) / r.height;
    return [((e.clientX - r.left) * sx - pad) / mw, ((e.clientY - r.top) * sy - pad) / mh];
  };
  let drag = null;
  ksMapEl.addEventListener('pointerdown', (e) => {
    const dot = e.target.closest && e.target.closest('.ks-dot');
    if (!dot) return;
    e.preventDefault();
    const i = +dot.dataset.i;
    ks.sel = i;
    drag = { i, start: mapPos(e), from: ks.pts[i].slice(), id: e.pointerId };
    try { ksMapEl.setPointerCapture(e.pointerId); } catch (_) {}
    ksApply();
    ksMapEl.querySelector(`.ks-dot[data-i="${i}"]`)?.focus({ preventScroll: true });
  });
  ksMapEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = mapPos(e);
    ksMove(drag.i, drag.from[0] + p[0] - drag.start[0], drag.from[1] + p[1] - drag.start[1]);
  });
  const end = () => { drag = null; };
  ksMapEl.addEventListener('pointerup', end);
  ksMapEl.addEventListener('pointercancel', end);
  // Arrow keys nudge the picked corner: one pixel of the projector at a time, ten with Shift
  ksMapEl.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || ks.sel < 0) return;
    e.preventDefault(); e.stopPropagation();
    const step = e.shiftKey ? 10 : 1, W = ks.win ? ks.win.innerWidth : 1600, H = ks.win ? ks.win.innerHeight : 900;
    const p = ks.pts[ks.sel];
    ksMove(ks.sel, p[0] + d[0] * step / W, p[1] + d[1] * step / H);
  });
  ksMapEl.addEventListener('focusin', (e) => { const dot = e.target.closest && e.target.closest('.ks-dot'); if (dot && ks.sel !== +dot.dataset.i) { ks.sel = +dot.dataset.i; ksApply(); } });
}
function ksEdit(on) {
  ks.editing = !!on && outputOpen();
  if (ks.editing && bm.editing) bmEdit(false);
  if (!ks.editing) ks.sel = -1;
  $('#ksPanel').hidden = !ks.editing;
  $('#ksBtn').setAttribute('aria-pressed', String(ks.editing));
  $('#ksGrid').setAttribute('aria-pressed', String(ks.grid));
  ksApply();
}
$('#ksBtn').addEventListener('click', () => ksEdit(!ks.editing));
$('#ksDone').addEventListener('click', () => ksEdit(false));
$('#ksGrid').addEventListener('click', () => { ks.grid = !ks.grid; $('#ksGrid').setAttribute('aria-pressed', String(ks.grid)); ksApply(); });
$('#ksReset').addEventListener('click', () => { ks.pts = KS_SQUARE.map((p) => p.slice()); ksSave(); ksApply(); });
window.__plKs = { ks, ksMove, ksMatrix, ksEdit, ksConvex };
/* ================= map my boxes (projection mapping onto a stack of boxes) ================= */
// For projecting onto white boxes stacked about: each side of a box the projector can see is a "face", four
// corners traced onto it (Add a face, then drag its dots on the projector or on the map under the picture). The
// Output window then lights only the faces: everything else is black, so nothing spills onto the wall behind, and
// one picture runs across the whole stack, each face showing the part of the picture behind it. It's an overlay
// on the Output window (an SVG with a mask), so the picture itself is drawn as always and costs nothing more; a
// bent picture from Fix projector shape sits under it. Depth shading darkens fronts a little and sides more, the
// way light falls on real boxes (tops stay full brightness). Corners are parts of the window's size, kept with the
// faces in phosphor-boxmap. A face starts with four corners and can have any number from three up (+ Corner, or
// double-click its edge; − Corner), so triangles, odd cut-outs and curved edges (many corners along the curve) work
// too. Its outline may bend in, but its edges mustn't cross each other (bmSimple).
const BM_KEY = 'phosphor-boxmap';
const BM_SHADE = { top: 0, front: 0.22, side: 0.45 };
const BM_SNAP_PX = 14;
const bm = { faces: [], on: true, shade: true, editing: false, sel: -1, dot: -1, n: 0, svg: null, dots: [] };
(function bmLoad() {
  try {
    const v = JSON.parse(lsGet(BM_KEY) || 'null');
    if (v && Array.isArray(v.faces)) {
      bm.faces = v.faces.filter((f) => f && Array.isArray(f.pts) && f.pts.length >= 3 && f.pts.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
        .map((f) => ({ id: ++bm.n, pts: f.pts, kind: BM_SHADE[f.kind] != null ? f.kind : 'front' }));
      bm.on = v.on !== false;
      bm.shade = v.shade !== false;
    }
  } catch (_) {}
})();
function bmSave() {
  if (!bm.faces.length) { try { localStorage.removeItem(BM_KEY); } catch (_) {} return; }
  lsSet(BM_KEY, JSON.stringify({ on: bm.on, shade: bm.shade, faces: bm.faces.map((f) => ({ pts: f.pts, kind: f.kind })) }));
}
const bmLive = () => bm.on && bm.faces.length > 0;
const bmWH = () => [ks.win ? ks.win.innerWidth || 1 : 1600, ks.win ? ks.win.innerHeight || 1 : 900];
const BM_MAX_DOTS = 64;
// An outline with no crossing edges and some size to it (in projector pixels, so it's judged the same at any shape)
function bmSimple(P) {
  const [W, H] = bmWH(), Q = P.map(([x, y]) => [x * W, y * H]), n = Q.length;
  if (n < 3) return false;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = Q[i], b = Q[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  if (Math.abs(area) / 2 < 30) return false;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hits = (a, b, c, d) => {
    const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 && d2 && d3 && d4;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (hits(Q[i], Q[(i + 1) % n], Q[j], Q[(j + 1) % n])) return false;
    }
    // Two corners on the same spot make a fold
    for (let j = i + 1; j < n; j++) if (Math.hypot(Q[i][0] - Q[j][0], Q[i][1] - Q[j][1]) < 2) return false;
  }
  return true;
}
// One more corner on the picked face: on edge e (after corner e) at t along it, or in the middle of the edge after
// the picked dot, else of the longest edge. Returns the new corner's place.
function bmAddDot(e, t = 0.5) {
  const f = bm.faces[bm.sel];
  if (!f || f.pts.length >= BM_MAX_DOTS) return -1;
  const [W, H] = bmWH(), n = f.pts.length;
  if (e == null) {
    if (bm.dot >= 0) e = bm.dot;
    else { let best = -1; e = 0; for (let i = 0; i < n; i++) { const a = f.pts[i], b = f.pts[(i + 1) % n], d = Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H); if (d > best) { best = d; e = i; } } }
  }
  const a = f.pts[e], b = f.pts[(e + 1) % n];
  f.pts.splice(e + 1, 0, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  bm.dot = e + 1;
  bmDraw(); bmSave(); bmSync();
  return e + 1;
}
// One corner fewer (the picked dot, else the last added); three is the least a face can have
function bmDelDot() {
  const f = bm.faces[bm.sel];
  if (!f || f.pts.length <= 3) return false;
  const i = bm.dot >= 0 ? bm.dot : f.pts.length - 1;
  const P = f.pts.filter((_, j) => j !== i);
  if (!bmSimple(P)) return false;
  f.pts = P;
  bm.dot = -1;
  bmDraw(); bmSave(); bmSync();
  return true;
}
// The edge of the picked face nearest a point (parts of the window), if it's within px projector pixels: [edge, t]
function bmEdgeAt(x, y, px) {
  const f = bm.faces[bm.sel];
  if (!f) return null;
  const [W, H] = bmWH(), n = f.pts.length, P = [x * W, y * H];
  let best = null, bd = px;
  for (let i = 0; i < n; i++) {
    const a = [f.pts[i][0] * W, f.pts[i][1] * H], b = [f.pts[(i + 1) % n][0] * W, f.pts[(i + 1) % n][1] * H];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / L));
    const d = Math.hypot(a[0] + dx * t - P[0], a[1] + dy * t - P[1]);
    if (d < bd && t > 0.02 && t < 0.98) { bd = d; best = [i, t]; }
  }
  return best;
}
// Corner i of face f to (x, y), snapped onto a nearby corner of another face so neighbouring faces meet with no gap
function bmMoveDot(f, i, x, y, snap = true) {
  const [W, H] = bmWH();
  let best = null, bd = BM_SNAP_PX;
  if (snap) for (const g of bm.faces) {
    if (g === f) continue;
    for (const p of g.pts) {
      const d = Math.hypot((p[0] - x) * W, (p[1] - y) * H);
      if (d < bd) { bd = d; best = p; }
    }
  }
  const P = f.pts.map((p) => p.slice());
  P[i] = best ? best.slice() : [Math.min(1.1, Math.max(-0.1, x)), Math.min(1.1, Math.max(-0.1, y))];
  if (!bmSimple(P)) return false;
  f.pts = P;
  bmDraw(); bmSave();
  return true;
}
function bmMoveFace(f, from, dx, dy) {
  f.pts = from.map(([x, y]) => [Math.min(1.1, Math.max(-0.1, x + dx)), Math.min(1.1, Math.max(-0.1, y + dy))]);
  bmDraw(); bmSave();
}
// A new face: a square in the middle (a little to the side of the last one), ready to drag onto a box
function bmAdd() {
  const [W, H] = bmWH(), s = 0.22 * Math.min(W, H), k = bm.faces.length % 6;
  const cx = 0.5 + (k % 3 - 1) * 0.18, cy = 0.5 + (k >= 3 ? 0.2 : 0) - 0.1;
  const hw = s / 2 / W, hh = s / 2 / H;
  const f = { id: ++bm.n, kind: 'front', pts: [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]] };
  bm.faces.push(f);
  bm.sel = bm.faces.length - 1; bm.dot = -1;
  if (!bm.on) bm.on = true;
  bmDraw(); bmSave(); bmSync();
}
function bmDel() {
  if (bm.sel < 0) return;
  bm.faces.splice(bm.sel, 1);
  bm.sel = bm.faces.length ? Math.min(bm.sel, bm.faces.length - 1) : -1;
  bm.dot = -1;
  bmDraw(); bmSave(); bmSync();
}
// Which face is under a point (parts of the window), the picked one first
function bmFaceAt(x, y) {
  const inside = (P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  if (bm.sel >= 0 && bm.faces[bm.sel] && inside(bm.faces[bm.sel].pts)) return bm.sel;
  for (let i = bm.faces.length - 1; i >= 0; i--) if (inside(bm.faces[i].pts)) return i;
  return -1;
}
// The Output window's overlay: black with the faces cut out, their shading, and while tracing, outlines and dots
function bmAttach(w, doc) {
  const NS = 'http://www.w3.org/2000/svg';
  const st = doc.createElement('style');
  st.textContent = `.bmsvg{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:4}
.bmsvg.edit .bmf{pointer-events:auto;cursor:move}
.bmdot{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;background:rgba(139,26,184,.85);border:3px solid #fff;box-sizing:border-box;
  box-shadow:0 0 0 3px rgba(0,0,0,.5),0 0 14px rgba(176,108,255,.9);cursor:grab;touch-action:none;z-index:6}
.bmdot.on{background:#d39bff}.bmdot[hidden]{display:none}
.bmdot.small{width:24px;height:24px;margin:-12px 0 0 -12px;border-width:2px}
.hint{z-index:5}.fsx{z-index:7}`;
  doc.head.appendChild(st);
  bm.svg = doc.createElementNS(NS, 'svg');
  bm.svg.setAttribute('class', 'bmsvg');
  doc.body.appendChild(bm.svg);
  bm.dots = [];
  const pos = (e) => [e.clientX / (w.innerWidth || 1), e.clientY / (w.innerHeight || 1)];
  // As many dots as the picked face has corners, made as they're needed (bmDraw)
  bm.mkDot = (i) => {
    const d = doc.createElement('div');
    d.className = 'bmdot'; d.hidden = true;
    d.title = 'Drag this corner onto the corner of the box face. Right-click it to remove it.';
    doc.body.appendChild(d);
    d.addEventListener('pointerdown', (e) => {
      const f = bm.faces[bm.sel];
      if (!f) return;
      e.preventDefault(); e.stopPropagation();
      bm.dot = i;
      try { d.setPointerCapture(e.pointerId); } catch (_) {}
      const start = pos(e), from = f.pts[i].slice();
      const move = (ev) => { const p = pos(ev); bmMoveDot(f, i, from[0] + p[0] - start[0], from[1] + p[1] - start[1], !ev.altKey); };
      const up = () => { d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up); };
      d.addEventListener('pointermove', move); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
      bmDraw();
    });
    d.addEventListener('contextmenu', (e) => { e.preventDefault(); bm.dot = i; bmDelDot(); });
    bm.dots.push(d);
  };
  // Double-click an edge of the picked face to put a new corner there
  bm.svg.addEventListener('dblclick', (e) => {
    if (!bm.editing) return;
    e.preventDefault(); e.stopPropagation();
    const p = pos(e), at = bmEdgeAt(p[0], p[1], 20);
    if (at) bmAddDot(at[0], at[1]);
  });
  // Clicking a face on the projector picks it; dragging it moves it whole
  bm.svg.addEventListener('pointerdown', (e) => {
    if (!bm.editing) return;
    const p = pos(e), i = bmFaceAt(p[0], p[1]);
    if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    bm.sel = i; bm.dot = -1;
    // Followed on the whole window: the face's shape is redrawn as it moves, so it can't hold on to the pointer itself
    const f = bm.faces[i], from = f.pts.map((q) => q.slice());
    const move = (ev) => { const q = pos(ev); bmMoveFace(f, from, q[0] - p[0], q[1] - p[1]); };
    const up = () => { w.removeEventListener('pointermove', move); w.removeEventListener('pointerup', up); w.removeEventListener('pointercancel', up); };
    w.addEventListener('pointermove', move); w.addEventListener('pointerup', up); w.addEventListener('pointercancel', up);
    bmDraw(); bmSync();
  });
  w.addEventListener('resize', bmDraw);
  doc.addEventListener('fullscreenchange', () => setTimeout(bmDraw, 80));
  $('#bmBtn').hidden = false;
  bmDraw();
  if (bmLive()) toast(`Your box mapping is on (${bm.faces.length} face${bm.faces.length === 1 ? '' : 's'}). Map my boxes, under the picture, changes it.`, 6000);
}
function bmDetach() {
  bm.svg = null; bm.dots = []; bm.mkDot = null;
  bmEdit(false);
  $('#bmBtn').hidden = true;
}
function bmDraw() {
  bmMap();
  if (!bm.svg || !ks.win) return;
  const [W, H] = bmWH();
  const pts = (f) => f.pts.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join(' ');
  let h = '';
  if (bm.editing) {
    // Tracing: black everywhere, every face lit up so you can see where it lands on the boxes
    h = `<rect width="${W}" height="${H}" fill="#000"/>` + bm.faces.map((f, i) =>
      `<polygon class="bmf" points="${pts(f)}" fill="${i === bm.sel ? 'rgba(176,108,255,.55)' : 'rgba(255,255,255,.45)'}" stroke="${i === bm.sel ? '#e9c8ff' : '#fff'}" stroke-width="${i === bm.sel ? 4 : 2}" stroke-linejoin="round"/>`).join('') +
      // A wide, see-through edge on the picked face, so a double-click near its edge lands on it
      (bm.faces[bm.sel] ? `<polygon class="bmf" points="${pts(bm.faces[bm.sel])}" fill="none" stroke="rgba(0,0,0,0)" stroke-width="28" style="pointer-events:stroke"/>` : '');
  } else if (bmLive()) {
    h = `<defs><mask id="bmm" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>` +
      bm.faces.map((f) => `<polygon points="${pts(f)}" fill="#000"/>`).join('') + `</mask></defs>` +
      `<rect width="${W}" height="${H}" fill="#000" mask="url(#bmm)"/>` +
      (bm.shade ? bm.faces.map((f) => BM_SHADE[f.kind] ? `<polygon points="${pts(f)}" fill="#000" fill-opacity="${BM_SHADE[f.kind]}"/>` : '').join('') : '');
  }
  bm.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  bm.svg.innerHTML = h;
  bm.svg.classList.toggle('edit', bm.editing);
  const f = bm.faces[bm.sel];
  if (f && bm.mkDot) while (bm.dots.length < f.pts.length) bm.mkDot(bm.dots.length);
  bm.dots.forEach((d, i) => {
    d.hidden = !(bm.editing && f && i < f.pts.length);
    if (d.hidden) return;
    d.classList.toggle('small', f.pts.length > 8);
    d.style.left = Math.min(W - 20, Math.max(20, f.pts[i][0] * W)) + 'px';
    d.style.top = Math.min(H - 20, Math.max(20, f.pts[i][1] * H)) + 'px';
    d.classList.toggle('on', bm.dot === i);
  });
}
// The map under the picture: every face, the picked one with its dots
const bmMapEl = $('#bmMap');
function bmMap() {
  if (!bmMapEl || !bm.editing) return;
  const [W, H] = bmWH(), mw = 160, mh = Math.max(40, Math.min(160, Math.round(mw * H / W))), pad = 12;
  bmMapEl.setAttribute('viewBox', `${-pad} ${-pad} ${mw + pad * 2} ${mh + pad * 2}`);
  if (!bmMapEl.querySelector('.ks-frame')) bmMapEl.innerHTML = '<rect class="ks-frame" x="0" y="0"/><g class="bm-faces"></g>';
  // One circle per corner of the picked face; the ones there already stay, so a dot picked with the keyboard keeps its focus
  const want = bm.faces[bm.sel] ? bm.faces[bm.sel].pts.length : 0;
  const have = bmMapEl.querySelectorAll('.ks-dot');
  for (let i = have.length; i < want; i++) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', 'ks-dot'); c.dataset.i = String(i); c.setAttribute('tabindex', '0'); c.setAttribute('r', '5');
    c.innerHTML = '<title>Drag this corner (arrow keys nudge it). Right-click to remove it.</title>';
    bmMapEl.appendChild(c);
  }
  for (let i = have.length - 1; i >= want; i--) have[i].remove();
  const fr = bmMapEl.querySelector('.ks-frame');
  fr.setAttribute('width', mw); fr.setAttribute('height', mh);
  bmMapEl.querySelector('.bm-faces').innerHTML = bm.faces.map((f, i) =>
    `<polygon class="bm-face${i === bm.sel ? ' on' : ''}" data-f="${i}" points="${f.pts.map(([x, y]) => `${x * mw},${y * mh}`).join(' ')}"/>`).join('');
  const f = bm.faces[bm.sel];
  const rad = f && f.pts.length > 8 ? 3.5 : 5;
  bmMapEl.querySelectorAll('.ks-dot').forEach((c, i) => {
    c.style.display = f ? '' : 'none';
    if (!f) return;
    c.setAttribute('cx', f.pts[i][0] * mw); c.setAttribute('cy', f.pts[i][1] * mh); c.setAttribute('r', rad);
    c.classList.toggle('on', bm.dot === i);
  });
  // The dots stay on top of the faces
  bmMapEl.querySelectorAll('.ks-dot').forEach((c) => bmMapEl.appendChild(c));
}
if (bmMapEl) {
  const mapPos = (e) => {
    const r = bmMapEl.getBoundingClientRect(), [W, H] = bmWH(), mw = 160, mh = Math.max(40, Math.min(160, Math.round(mw * H / W))), pad = 12;
    return [((e.clientX - r.left) * (mw + pad * 2) / r.width - pad) / mw, ((e.clientY - r.top) * (mh + pad * 2) / r.height - pad) / mh];
  };
  let drag = null;
  bmMapEl.addEventListener('pointerdown', (e) => {
    const p = mapPos(e), dot = e.target.closest && e.target.closest('.ks-dot');
    if (dot && bm.faces[bm.sel]) {
      const i = +dot.dataset.i, f = bm.faces[bm.sel];
      bm.dot = i;
      drag = { kind: 'dot', f, i, start: p, from: f.pts[i].slice(), id: e.pointerId };
    } else {
      const i = bmFaceAt(p[0], p[1]);
      if (i < 0) return;
      bm.sel = i; bm.dot = -1;
      const f = bm.faces[i];
      drag = { kind: 'face', f, start: p, from: f.pts.map((q) => q.slice()), id: e.pointerId };
      bmSync();
    }
    e.preventDefault();
    try { bmMapEl.setPointerCapture(e.pointerId); } catch (_) {}
    bmDraw();
    if (drag.kind === 'dot') bmMapEl.querySelector(`.ks-dot[data-i="${drag.i}"]`)?.focus({ preventScroll: true });
  });
  bmMapEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = mapPos(e), dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
    if (drag.kind === 'dot') bmMoveDot(drag.f, drag.i, drag.from[0] + dx, drag.from[1] + dy, !e.altKey);
    else bmMoveFace(drag.f, drag.from, dx, dy);
  });
  const end = () => { drag = null; };
  bmMapEl.addEventListener('pointerup', end);
  bmMapEl.addEventListener('pointercancel', end);
  // Double-click near an edge of the picked face: a new corner there. Right-click a dot: that corner goes.
  bmMapEl.addEventListener('dblclick', (e) => {
    const p = mapPos(e), [W] = bmWH(), at = bmEdgeAt(p[0], p[1], 5 * W / 160);
    if (at) { e.preventDefault(); bmAddDot(at[0], at[1]); }
  });
  bmMapEl.addEventListener('contextmenu', (e) => {
    const dot = e.target.closest && e.target.closest('.ks-dot');
    if (!dot) return;
    e.preventDefault();
    bm.dot = +dot.dataset.i;
    bmDelDot();
  });
  bmMapEl.addEventListener('focusin', (e) => { const dot = e.target.closest && e.target.closest('.ks-dot'); if (dot && bm.dot !== +dot.dataset.i) { bm.dot = +dot.dataset.i; bmDraw(); } });
  // Arrow keys nudge the picked corner one projector pixel (ten with Shift); with no corner picked, the whole face
  bmMapEl.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const f = bm.faces[bm.sel];
    if (!d || !f) return;
    e.preventDefault(); e.stopPropagation();
    const [W, H] = bmWH(), step = e.shiftKey ? 10 : 1, dx = d[0] * step / W, dy = d[1] * step / H;
    if (bm.dot >= 0) bmMoveDot(f, bm.dot, f.pts[bm.dot][0] + dx, f.pts[bm.dot][1] + dy, false);
    else bmMoveFace(f, f.pts.map((q) => q.slice()), dx, dy);
  });
}
// The panel's buttons, kept in step with the faces
function bmSync() {
  $('#bmBtn').setAttribute('aria-pressed', String(bm.editing));
  $('#bmShade').setAttribute('aria-pressed', String(bm.shade));
  $('#bmOn').setAttribute('aria-pressed', String(bm.on));
  $('#bmOn').lastChild.textContent = bm.on ? 'Mapping on' : 'Mapping off';
  const f = bm.faces[bm.sel];
  $('#bmDel').disabled = !f;
  $('#bmDotAdd').disabled = !f || f.pts.length >= BM_MAX_DOTS;
  $('#bmDotDel').disabled = !f || f.pts.length <= 3;
  $$('#bmPanel .bm-kind .btn').forEach((b) => { b.disabled = !f; b.setAttribute('aria-pressed', String(!!f && f.kind === b.dataset.kind)); });
  const n = bm.faces.length;
  $('#bmCount').textContent = n ? `${n} face${n === 1 ? '' : 's'} traced${f ? ` · face ${bm.sel + 1} picked, ${f.pts.length} corners` : ''}` : 'No faces yet. Press Add a face to start.';
}
function bmEdit(on) {
  bm.editing = !!on && outputOpen();
  if (bm.editing && ks.editing) ksEdit(false);
  if (bm.editing && bm.sel < 0 && bm.faces.length) bm.sel = 0;
  if (!bm.editing) bm.dot = -1;
  $('#bmPanel').hidden = !bm.editing;
  bmSync();
  bmDraw();
}
$('#bmBtn').addEventListener('click', () => bmEdit(!bm.editing));
$('#bmDone').addEventListener('click', () => {
  bmEdit(false);
  if (bmLive()) toast('Box mapping on: the picture lands only on your boxes. Mapping off (in Map my boxes) shows the whole picture again.', 6000);
});
$('#bmAdd').addEventListener('click', bmAdd);
$('#bmDel').addEventListener('click', bmDel);
$('#bmDotAdd').addEventListener('click', () => bmAddDot());
$('#bmDotDel').addEventListener('click', () => { if (!bmDelDot()) toast('That corner can’t go: a face needs at least three, and its edges can’t cross.'); });
$('#bmShade').addEventListener('click', () => { bm.shade = !bm.shade; bmSave(); bmSync(); bmDraw(); });
$('#bmOn').addEventListener('click', () => { bm.on = !bm.on; bmSave(); bmSync(); bmDraw(); });
$$('#bmPanel .bm-kind .btn').forEach((b) => b.addEventListener('click', () => {
  const f = bm.faces[bm.sel];
  if (!f) return;
  f.kind = b.dataset.kind;
  bmSave(); bmSync(); bmDraw();
}));
window.__plBm = { bm, bmAdd, bmDel, bmMoveDot, bmMoveFace, bmEdit, bmDraw, bmAddDot, bmDelDot, bmSimple, bmEdgeAt };
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

function resolveSrc(src, motion, k) {
  const live = liveFor(k, src);
  if (live && live.frames < (motion ? 2 : 1)) return SRC_ID.none;
  return SRC_ID[src] ?? SRC_ID.none;
}

let last = performance.now();
let simT = 0;

// The Wave input's curve, worked out on the CPU once per loop per frame instead of per pixel
const wavePts = new Float32Array(81 * 2), waveBoxes = new Float32Array(8 * 4);
function computeWave(t, form, reach = 0) {
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
    waveBoxes[c * 4 + 2] = Math.hypot(x1 - x0, y1 - y0) / 2 + reach;
  }
}

/* ================= sound on lines ================= */
// The music's own sound wave, laid along the lines of Wave, Shape, Bars and Topo map like an oscilloscope (React to
// sound › Sound on lines). Once a frame the latest stretch of raw sound is smoothed by Line detail, started at a point
// where it rises through the middle (so it holds still instead of sliding, as an oscilloscope's trigger does), evened
// out so quiet and loud songs both show, and squeezed into SND_N steps for the graphics card (uSnd). Each loop that
// reacts gets it at its own strength (uSndAmp, 0: plain lines).
const SND_N = 96;
const sndLine = new Float32Array(SND_N);
const LINE_INPUTS = ['wave', 'shape', 'bars', 'topo', 'texture'];
const usesLines = (t) => LINE_INPUTS.includes(t.in1) || LINE_INPUTS.includes(t.in2);
let sndTD = null, sndLP = null, sndAgc = 0.05, sndLineOn = false;
function sndLinesTick(dt) {
  const an = snd.analyser;
  if (frozen) return;
  sndLineOn = false;
  if (!an || !snd.map.lines || typeof an.getFloatTimeDomainData !== 'function' || !activeKeys().some((k) => reacts(k) && usesLines(loops[k].tgt))) return;
  const len = Math.min(4096, an.timeSize || an.fftSize || 2048);
  if (!sndTD || sndTD.length !== len) { sndTD = new Float32Array(len); sndLP = new Float32Array(len); }
  an.getFloatTimeDomainData(sndTD);
  // Smoothed twice over: Smooth keeps sound below about 150 Hz (kick and bass), Fuzzy up to about 9 kHz
  const fc = 150 * Math.pow(60, clamp(snd.detail, 0, 100) / 100), al = 1 - Math.exp(-2 * Math.PI * fc / (snd.rate || 48000));
  let y1 = sndTD[0], y2 = y1, mean = 0;
  for (let i = 0; i < len; i++) { y1 += al * (sndTD[i] - y1); y2 += al * (y1 - y2); sndLP[i] = y2; mean += y2; }
  mean /= len;
  // The latest place the sound rises through the middle, leaving room for the stretch that's shown after it
  const win = Math.floor(len * 0.6);
  let start = len - win;
  for (let i = len - win; i > 1; i--) if (sndLP[i - 1] < mean && sndLP[i] >= mean) { start = i; break; }
  const step = win / SND_N;
  let peak = 0;
  for (let n = 0; n < SND_N; n++) {
    const a = start + Math.floor(n * step), b = Math.max(a + 1, start + Math.floor((n + 1) * step));
    let sum = 0;
    for (let i = a; i < b; i++) sum += sndLP[i];
    const v = sum / (b - a) - mean;
    sndLine[n] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  // Evened out: catches up at once with a louder moment, sinks back over a couple of seconds
  sndAgc = peak > sndAgc ? peak : sndAgc + (peak - sndAgc) * (1 - Math.exp(-dt / 2));
  const k = 1 / Math.max(sndAgc, 0.02);
  for (let n = 0; n < SND_N; n++) sndLine[n] = clamp(sndLine[n] * k, -1.4, 1.4);
  sndLineOn = true;
}
// For tests/sound_lines_check.py: made-up music (a kick every half second, a bass line, off-beat hi-hats and a chord)
// fed in as raw sound, the way Computer sound arrives in Chrome
window.__plSnd = { snd, get line() { return Array.from(sndLine); }, get on() { return sndLineOn; }, amp: (k) => sndLineAmp(k),
  fake() {
    const R = 48000, fa = makeFastAnalyser(R);
    setAnalyser(fa, R);
    let n = 0, t0 = performance.now(), rnd = 1;
    const notes = [55, 55, 65.4, 49], buf = new Float32Array(R);
    const feed = () => {
      if (snd.analyser !== fa) return;
      const want = Math.min(R, Math.round((performance.now() - t0) / 1000 * R) - n);
      for (let i = 0; i < want; i++, n++) {
        const time = n / R, beat = time % 0.5, f0 = notes[Math.floor(time / 2) % 4];
        const kick = beat < 0.35 ? Math.sin(2 * Math.PI * (45 * beat + 80 * (1 - Math.exp(-beat * 30)) / 30)) * Math.exp(-beat * 9) : 0;
        rnd = (rnd * 16807) % 2147483647;
        const hat = (rnd / 1073741823 - 1) * Math.exp(-((time + 0.25) % 0.5) * 90) * 0.3;
        buf[i] = 0.5 * kick + 0.25 * Math.sin(2 * Math.PI * f0 * time) + hat + 0.05 * (Math.sin(2 * Math.PI * f0 * 4 * time) + Math.sin(2 * Math.PI * f0 * 5 * time));
      }
      if (want > 0) fa.push(buf.subarray(0, want));
      requestAnimationFrame(feed);
    };
    feed();
  } };
// How far the sound pushes loop k's lines (picture units at Input size 100), 0 when they stay plain
function sndLineAmp(k) {
  if (!sndLineOn || !reacts(k) || !usesLines(loops[k].tgt)) return 0;
  return 0.045 * sndPower() * (reduceMotion ? 0.5 : 1);
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
  set1f(twProg, 'uTime', simT + (11.0 * LOOP_OFF[k]));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  tw.wf = 1 - tw.wf;
  tw.live = true;
}
// What a loop shows (and what the other loop sees of it): its time-warped picture while Time warp is on
function warpedTex(k) { const L = loops[k]; return L.tw && L.tw.live ? L.tw.warp[L.tw.wf].tex : L.rt[L.front].tex; }
// ...and after slit-scan, when Photo finish or Corridor is on
function shownTex(k) { const L = loops[k]; return L.sc && L.sc.live ? L.sc.out[L.sc.of].tex : warpedTex(k); }
// What loop k gives the mix: its picture, or that picture after its final pass (see finalPass)
function mixTex(k) { const pz = loops[k].pz; return pz && pz.live ? pz.rt[pz.f].tex : shownTex(k); }
// The effects that can work in the final pass instead of within the loop, each with the switch that says so.
// Posterize and Halftone start in the final pass; the others start within the loop, where they've always been.
const FINAL_FX = { poster: 'posterIn', halftone: 'halftoneFinal', mirror: 'mirrorFinal', warp: 'warpFinal', split: 'splitFinal', chroma: 'chromaFinal' };
const isFinal = (t, fx) => (fx === 'poster' ? !t.posterIn : !!t[FINAL_FX[fx]]);
// Loop k's final pass (FS_FINAL): its picture with the effects set to Final Pass laid over it once, drawn into a
// pair of pictures of its own, taking turns, so Posterize can see the steps it drew last frame. Made when first
// needed, at the current sharpness, and let go when no effect is in the final pass.
function finalPass(k) {
  const L = loops[k], t = L.tgt, c = L.cur;
  const amt = (fx, v) => (isFinal(t, fx) ? v : 0);
  const steps = amt('poster', c.poster > 0.5 ? posterSteps(c.poster) : 0);
  const dots = amt('halftone', c.halftone > 0.5 ? halftoneCell(c.halftone) : 0);
  const mirror = t.mirrorFinal && mirrorAny(k);
  const split = amt('split', clamp(c.split, 0, 100) / 100 * 0.06);
  const warp = amt('warp', clamp(L.warpNow ?? c.warp, 0, 100) / 100 * 0.05);
  const chroma = amt('chroma', Math.pow(clamp(c.chroma, 0, 100) / 100, 1.2) * 0.035);
  const on = L.rt && (loopOn(k) || extraLoop(k)) && (steps > 0 || dots > 0 || mirror || split > 0.0005 || warp > 0.0005 || chroma > 0.0005);
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
  set1f(finalProg, 'uHalftone', dots);
  // Posterize has no steps of its own to remember on its first frame
  set1f(finalProg, 'uFresh', pz.stepped ? 0 : 1);
  pz.stepped = steps > 0;
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  pz.live = true;
}
function shownPrev(k) {
  const L = loops[k];
  if (L.sc && L.sc.live) return L.sc.out[1 - L.sc.of].tex;
  return L.tw && L.tw.live ? L.tw.warp[1 - L.tw.wf].tex : L.rt[1 - L.front].tex;
}

/* ================= slit-scan: Photo finish and Corridor ================= */
// While a loop uses either, a thin top-to-bottom line of its picture (the slit) is written each frame into the
// newest columns of a strip (SC_W columns, going round), SC_SPEED columns a second for Slow, Medium and Fast;
// FS_SCAN then redraws the loop from it (see FS_SLIT). Photo finish's slit stands still, two thirds of the way
// across, so things moving through it are drawn out to its left. Corridor's slit drifts slowly across the
// picture, so even a still picture keeps changing as it streams down the walls (when both are on, it drifts).
// Like Time warp, what you see and the other loop get the slit-scanned picture; the loop feeds back its own plain
// frames. The strip is let go a minute after both are turned off.
const SC_W = 720, SC_SPEED = [90, 200, 420];
const SC_SLIT = 0.66;
function scanStep(k, dt) {
  const L = loops[k], c = L.cur, t = L.tgt;
  const on = !!scanProg && (t.scan > 0 || c.scan > 0.3 || t.corr > 0 || c.corr > 0.3);
  if (L.sc && L.sc.sh !== simH) scanDrop(L);
  if (!on) {
    if (L.sc) { L.sc.live = false; L.sc.idle += dt; if (L.sc.idle > 60) scanDrop(L); }
    return;
  }
  if (!L.sc) {
    const buf = makeTarget(SC_W, simH);
    gl.clearColor(0, 0, 0, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, buf.fbo); gl.clear(gl.COLOR_BUFFER_BIT);
    L.sc = { buf, out: [makeTarget(), makeTarget()], of: 0, head: -1, filled: 0, acc: 1, idle: 0, sh: simH, sw: simW, ph: Math.random() * 10, live: false };
  }
  const S = L.sc;
  if (S.sw !== simW) { S.out.forEach(dropTarget); S.out = [makeTarget(), makeTarget()]; S.sw = simW; }
  S.idle = 0;
  const src = warpedTex(k);
  const corrOn = c.corr > 0.3 || t.corr > 0;
  S.ph += dt;
  const slitX = corrOn ? 0.5 + 0.42 * Math.sin(S.ph * 0.11) * Math.cos(S.ph * 0.037) : SC_SLIT;
  // How many new columns this frame
  S.acc += dt * SC_SPEED[t.scanSpeed ?? 1];
  let n = Math.min(SC_W >> 2, Math.floor(S.acc));
  S.acc -= n;
  if (n > 0) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.buf.fbo);
    gl.useProgram(slitProg.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    set1f(slitProg, 'uX', slitX);
    set1f(slitProg, 'uH', simH);
    gl.enable(gl.SCISSOR_TEST);
    // The new columns, in at most two runs (where they go round past the end)
    let start = (S.head + 1) % SC_W;
    while (n > 0) {
      const run = Math.min(n, SC_W - start);
      gl.viewport(start, 0, run, simH);
      gl.scissor(start, 0, run, simH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      S.head = (start + run - 1) % SC_W;
      S.filled = Math.min(SC_W, S.filled + run);
      n -= run; start = 0;
    }
    gl.disable(gl.SCISSOR_TEST);
  }
  const dst = S.out[1 - S.of];
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, simW, simH);
  gl.useProgram(scanProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, S.buf.tex);
  set2f(scanProg, 'uSim', simW, simH);
  set1f(scanProg, 'uW', SC_W);
  set1f(scanProg, 'uHead', S.head);
  set1f(scanProg, 'uFilled', S.filled);
  set1f(scanProg, 'uPhoto', clamp(c.scan, 0, 100) / 100);
  set1f(scanProg, 'uSlitX', SC_SLIT);
  set1f(scanProg, 'uCorr', clamp(c.corr, 0, 100) / 100);
  set1f(scanProg, 'uShape', t.corrShape ?? 0);
  set2f(scanProg, 'uVP', L.offAt[0] + L.offKick[0], L.offAt[1] + L.offKick[1]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  S.of = 1 - S.of;
  S.live = true;
}
function scanDrop(L) {
  const S = L.sc;
  if (!S) return;
  dropTarget(S.buf);
  S.out.forEach(dropTarget);
  L.sc = null;
}

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
const sceneRT = [null, null, null, null];
let miniRun = false;
let sceneGlow = 1;
function draw3D(k, name, slot, scale) {
  const sc = SCENES[name];
  if (sc.ext) return drawExt(k, sc, scale);
  if (!sceneReady(sc, true)) return null;
  const w = Math.max(2, Math.round(simW * (sc.res || 1))), h = Math.max(2, Math.round(simH * (sc.res || 1)));
  if (miniRun) slot += 2;   // the live previews' smaller pictures have targets of their own
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
// Topo map tracing an input: first that input is drawn as brightness into a small picture a quarter the size, which the
// loop's own pass then reads, softened a little more, to trace smooth contour lines from. Read softly from a small
// picture, a busy picture's fine grain blends away instead of breaking the lines into speckles. The same program
// draws it (stopping right after the input), as the input's drawing code is too big to have twice in one program.
function topoPre(L, dst, unit13, srcId) {
  const w = Math.max(8, Math.ceil(simW / 4)), h = Math.max(8, Math.ceil(simH / 4));
  let T = L.topoRT;
  gl.activeTexture(gl.TEXTURE0 + 13);
  if (!T || T.w !== w || T.h !== h) {
    if (T) { gl.deleteTexture(T.tex); gl.deleteFramebuffer(T.fbo); }
    T = L.topoRT = { ...makeTarget(w, h), w, h };
  }
  gl.bindTexture(gl.TEXTURE_2D, unit13);
  gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
  gl.viewport(0, 0, w, h);
  set2f(fbProg, 'uSim', w, h);
  set1i(fbProg, 'uTopoPre', 1);
  set1i(fbProg, 'uIn1', srcId);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  set1i(fbProg, 'uTopoPre', 0);
  set1i(fbProg, 'uIn1', SRC_ID.topo);
  set2f(fbProg, 'uSim', simW, simH);
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, simW, simH);
  gl.bindTexture(gl.TEXTURE_2D, T.tex);
}
// Life: Conway's Game of Life, a board for each loop worked out a generation at a time by FS_LIFE, with the
// generations at the pace Speed sets. A board starts a third full; from then on small splashes of new cells land
// now and then (and on the beat when the loop reacts to sound), so it never dies out. With New life from: The
// picture, a dead cell where the loop's own picture is bright comes alive now and then, so the board feeds on
// the trails it leaves. Returns the board for the loop's pass to read, or null when Life can't run here.
const LIFE_ROWS = [32, 54, 90], LIFE_GPS = [4, 8, 16];
function lifeTarget(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST);
  for (const q of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, q, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo };
}
function lifeTick(k, dt) {
  if (!lifeProg) return null;
  const L = loops[k], t = L.tgt;
  const h = LIFE_ROWS[t.lifeCells ?? 1] ?? LIFE_ROWS[1], w = Math.max(4, Math.round(h * simW / simH));
  let S = L.life;
  if (!S || S.w !== w || S.h !== h) {
    if (S) for (const r of S.rt) { gl.deleteTexture(r.tex); gl.deleteFramebuffer(r.fbo); }
    S = L.life = { rt: [lifeTarget(w, h), lifeTarget(w, h)], front: 0, w, h, acc: 0, wait: 0.5, beat: 0, drop: null, fresh: true };
  }
  gl.useProgram(lifeProg.p);
  gl.viewport(0, 0, w, h);
  gl.uniform2i(U(lifeProg, 'uGrid'), w, h);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, L.rt[L.front].tex);
  const pass = (step, drop, clear) => {
    const dst = S.rt[1 - S.front];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, S.rt[S.front].tex);
    set1f(lifeProg, 'uStep', step);
    set1f(lifeProg, 'uClear', clear ? 1 : 0);
    set4f(lifeProg, 'uDrop', ...(drop || [0, 0, 0, 0]));
    set1f(lifeProg, 'uFromLoop', step && t.lifeLoop ? 0.02 : 0);
    set1f(lifeProg, 'uSeed', Math.random() * 100);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    S.front = 1 - S.front;
  };
  const splash = (r, full) => [Math.random() * w, Math.random() * h, r, full];
  if (S.fresh) { pass(0, [w / 2, h / 2, w + h, 0.33], true); S.fresh = false; }
  // A splash now and then: every second or two, less often while the picture also brings new life
  S.wait -= dt;
  if (S.wait <= 0) {
    S.drop = splash(2.5 + Math.random() * 3.5 * (h / 54), 0.5);
    S.wait = (t.lifeLoop ? 2.5 : 1) + Math.random() * 1.5;
  }
  // On the beat, when this loop reacts to sound
  if (reacts(k) && snd.analyser) {
    const b = snd.env.beat;
    if (b > 0.6 && S.beat <= 0.6) S.drop = splash((2 + 4 * sndPower()) * (h / 54), 0.55);
    S.beat = b;
  }
  S.acc += dt * LIFE_GPS[t.lifeSpeed ?? 1];
  const steps = Math.min(2, Math.floor(S.acc));
  S.acc = Math.min(S.acc - steps, 0.999);
  for (let i = 0; i < steps; i++) { pass(1, S.drop); S.drop = null; }
  return S.rt[S.front].tex;
}
/* ================= lopsided effects: Off-center and Wind ================= */
const WIND_K = 0.0055;   // how far Wind at 100 carries the picture in one frame (screen heights)
// Once a frame for loop k: Off-center's turning point wanders along a slow uneven path, up to well over a third of
// the way to the edges (each loop its own way), and the input is drawn there too, so the whole tunnel sits off to
// one side. With React to sound, each hit of the music shoves the point somewhere new, from where it drifts back,
// and the bass pushes it further out. Wind's direction comes round to the one picked (or keeps turning). Only
// Off-center follows the music; Wind doesn't.
function asymTick(k, dt, hitK, newHit) {
  const L = loops[k], c = L.cur, t = L.tgt;
  const oc = clamp(c.offc, 0, 100) / 100;
  L.offPh += dt * (0.18 + 0.45 * oc);
  const ph = L.offPh, R = 0.85 * oc * (1 + hitK * snd.env.low * 0.6);
  const gx = R * simAspect * 0.5 * (0.7 * Math.sin(ph) + 0.3 * Math.sin(ph * 2.31 + 1)),
        gy = R * 0.5 * (0.7 * Math.sin(ph * 1.37 + 1.3) + 0.3 * Math.sin(ph * 2.9 + 4));
  const e = 1 - Math.exp(-dt * 2);
  L.offAt[0] += (gx - L.offAt[0]) * e;
  L.offAt[1] += (gy - L.offAt[1]) * e;
  if (newHit && hitK > 0 && oc > 0.005) {
    const a = Math.random() * Math.PI * 2, m = 0.6 * oc * (0.6 + 0.4 * Math.random()) * Math.min(1.5, hitK);
    L.offKick = [Math.cos(a) * m * simAspect * 0.5, Math.sin(a) * m * 0.5];
  }
  const kd = Math.exp(-dt * 2.2);
  L.offKick[0] *= kd; L.offKick[1] *= kd;
  const dir = t.windDir ?? 0;
  if (dir >= 8) L.windAng += dt * 0.15;
  else {
    let d = (dir * Math.PI / 4) - L.windAng;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    L.windAng += d * (1 - Math.exp(-dt * 3));
  }
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
    // With Sound on lines the lines already move with the bass, so they swell half as much
    if (m.lines && sndLineOn && usesLines(t)) sizeBoost *= 0.5;
  }
  // Lopsided effects (Off-center, Wind): the music's hits jolt them, with React to sound's switch
  const hitK = reacts(k) && snd.map.asym ? sndPower() : 0;
  const newHit = snd.beats !== L.offBeats;
  L.offBeats = snd.beats;
  const oc = clamp(c.offc, 0, 100) / 100;
  // Off-center needs Zoom or Spin to turn around its point, so with neither it pulls in gently by itself
  if (oc > 0.005 && Math.abs(z) < 4 && Math.abs(s) < 4) z += 12 * oc;
  asymTick(k, f / 60, hitK, newHit);
  const br = clamp(c.breathe, 0, 100) / 100;
  if (br > 0.005) { const B = breathe(k, br, f / 60); z += B.z; s *= B.s; }
  else { L.breath.z *= 0.95; L.breath.s += (1 - L.breath.s) * 0.05; }
  z = clamp(z, -100, 100); s = clamp(s, -100, 100); col = clamp(col, 0, 100); w = clamp(w, 0, 100);
  if (calmK > 0.001) { z = calmCap(z, 35); s = calmCap(s, 30); col = calmCap(col, 30); w = calmCap(w, 40); }
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
  // Life's board is read through the picture slot its input would use for a 3D world (it has no slot of its own:
  // see UNITS). Traced by Topo map, it's read from the first, as a traced 3D world is.
  const traced = topoTrace(t);
  const lifeIn1 = t.in1 === 'life' || traced === 'life', lifeIn2 = t.in2 === 'life' && traced !== 'life';
  const lifeTex = lifeIn1 || lifeIn2 ? lifeTick(k, f / 60) : null;
  const srcOf = (n) => (n === 'life' && !lifeTex ? SRC_ID.none : resolveSrc(n, t.motion, k));

  const src = L.rt[L.front], dst = L.rt[1 - L.front];
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, simW, simH);
  gl.useProgram(fbProg.p);
  const kVid = vidFor(k);
  const [V, C, S, P] = [kVid, cam, scr, pho].map((s) => s.texFor(t.subject));
  // The see-through surround only once every live input here has its outlines; until then the plain picture
  set1f(fbProg, 'uCutout', subjectOn(t) && [t.in1, t.in2].every((n) => !liveFor(k, n) || liveFor(k, n).texFor(t.subject) !== liveFor(k, n)) ? 1 : 0);
  const kGen = loopUsesGen(t), kPic = kGen ? genOf(k) : picOf(k);
  const texs = [src.tex, otherTex, kGen ? kPic.cur : kPic.tex, V.cur, V.prev, C.cur, C.prev, S.cur, S.prev, P.cur, P.prev, otherPrev,
                (lifeIn1 && lifeTex) || flyTex1 || src.tex, (lifeIn2 && lifeTex) || flyTex2 || src.tex, specTex, textTex];
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
  const sp = t.splitFinal ? 0 : calmCap(clamp(c.split, 0, 100), 30) / 100;
  set1f(fbProg, 'uSplit', Math.pow(sp, 1.5) * 0.007 * f);
  set1f(fbProg, 'uSplitOff', sp * 0.06);
  // Gentle low on the slider, wild at the top
  set1f(fbProg, 'uMelt', Math.pow(calmCap(clamp(c.melt, 0, 100), 50) / 100, 1.3) * MELT_K * f);
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
  const ox = L.offAt[0] + L.offKick[0], oy = L.offAt[1] + L.offKick[1];
  set2f(fbProg, 'uCenter', L.chaseAt[0] + ox, L.chaseAt[1] + oy);
  set2f(fbProg, 'uInOff', ox * 0.8, oy * 0.8);
  // Wind: how far it carries the picture this frame, in gusts with the bass and beats
  const wn = calmCap(clamp(c.wind, 0, 100), 50) / 100;
  const wk = wn > 0.005 ? Math.pow(wn, 1.2) * WIND_K * f : 0;
  set3f(fbProg, 'uWind', Math.cos(L.windAng), Math.sin(L.windAng), wk);
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
  set1f(fbProg, 'uHalftone', !t.halftoneFinal && c.halftone > 0.5 ? halftoneCell(c.halftone) : 0);
  setLoopGradeUniforms(f);
  set1f(fbProg, 'uAspText', textAspect);
  mirrorUniforms(fbProg, k, !t.mirrorFinal);
  set1f(fbProg, 'uBlur', clamp(c.blur, -0.3, 1));
  set1f(fbProg, 'uEdge', t.edge);
  set2f(fbProg, 'uShift', sx * f, sy * f);
  set1f(fbProg, 'uGain', c.gain * gainBoost);
  set1f(fbProg, 'uForm', t.form);
  const hum = sndLineAmp(k);
  set1f(fbProg, 'uSndAmp', hum);
  if (hum > 0) { const ls = U(fbProg, 'uSnd[0]'); if (ls) gl.uniform4fv(ls, sndLine); }
  if (t.in1 === 'wave' || t.in2 === 'wave') {
    computeWave(simT + (11.0 * LOOP_OFF[k]), t.form, hum * 1.4);
    const lw = U(fbProg, 'uWave[0]'), lb = U(fbProg, 'uWaveBox[0]');
    if (lw) gl.uniform2fv(lw, wavePts);
    if (lb) gl.uniform4fv(lb, waveBoxes);
  }
  set1f(fbProg, 'uFloor', useFloat ? 0 : 1.5 / 255);
  set1f(fbProg, 'uXfeed', xf);
  // A world that can't be drawn feeds in nothing (never the loop's own last frame)
  // Topo map tracing another input draws only its lines: the input it traces isn't shown as itself
  set1f(fbProg, 'uLifeT', lifeTex ? L.life.acc : 0);
  set1f(fbProg, 'uRadarWind', t.radarWind ? 1 : 0);
  set1i(fbProg, 'uTexStyle', (t.texStyle ?? 0) | 0);
  if (traced) {
    const slot = t.in1 === 'topo' ? 2 : 1, fly = slot === 1 ? flyTex1 : flyTex2;
    set1i(fbProg, 'uIn1', SRC_ID.topo);
    set1i(fbProg, 'uIn2', SRC_ID.none);
    set1i(fbProg, 'uTopoSrc', is3D(traced) && !fly ? SRC_ID.none : srcOf(traced));
    // A traced 3D world is read from the first 3D picture's slot, whichever input it is
    if (fly) { gl.activeTexture(gl.TEXTURE0 + 12); gl.bindTexture(gl.TEXTURE_2D, fly); }
  } else {
    set1i(fbProg, 'uTopoSrc', -1);
    set1i(fbProg, 'uIn1', is3D(t.in1) && !flyTex1 ? SRC_ID.none : srcOf(t.in1));
    set1i(fbProg, 'uIn2', t.in2 === 'none' || (is3D(t.in2) && !flyTex2) ? SRC_ID.none : srcOf(t.in2));
  }
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
  set1f(fbProg, 'uSoft', t.soft !== false && (SOFT_SRC.includes(t.in1) || SOFT_SRC.includes(t.in2)) ? 1 : 0);
  set1f(fbProg, 'uAspPic', kPic.aspect);
  set1f(fbProg, 'uAspVid', kVid.aspect);
  set1f(fbProg, 'uVidCut', kVid.sticker ? 1 : 0);
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
  if (traced) topoPre(L, dst, texs[13], is3D(traced) && !(t.in1 === 'topo' ? flyTex2 : flyTex1) ? SRC_ID.none : srcOf(traced));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  L.front = 1 - L.front;
  twStep(k, f / 60);
  scanStep(k, f / 60);
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
  if (ap.on && cueTick(now)) {
    // Cue mode does its own looking (see cueTick)
  } else if (ap.on) {
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
    darkWatch(now, dt, wA, wB);
  }
  if (looking && !eye.sync && now - eye.askT > 55) {
    const P = ap.prep, keys = cue.scout ? ['C', 'comp', 'C'] : P ? [P.k, 'comp', P.k] : ['comp'];
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
  ['Effects', [['zoom', 'Zoom'], ['spin', 'Spin'], ['trails', 'Trails'], ['color', 'Color shift'], ['poster', 'Posterize'], ['halftone', 'Halftone'], ['warp', 'Warp'], ['flow', 'Flow'],
    ['melt', 'Melt'], ['grow', 'Grow'], ['split', 'Split lines'], ['time', 'Time warp'], ['lookup', 'Look-up'], ['chase', 'Chase'],
    ['breathe', 'Breathe'], ['chroma', 'Color chase'], ['restless', 'Restless'], ['julia', 'Fractal fold'], ['crystal', 'Crystal'],
    ['offc', 'Off-center'], ['wind', 'Wind'], ['scan', 'Photo finish'], ['corr', 'Corridor'], ['mirror', 'Mirror']]],
  ['Color grading', [['gExposure', 'Exposure'], ['gContrast', 'Contrast'], ['gGamma', 'Midtones'], ['gSat', 'Saturation'], ['gHue', 'Hue'],
    ['gRed', 'Red'], ['gGreen', 'Green'], ['gBlue', 'Blue'], ['gSepia', 'Sepia']]],
  // 3D lighting is one for the whole picture: when blocks on several tracks set it, it's a mix of them, each counted
  // as much as its loop shows (see reliefNow)
  ['3D lighting', [['rDepth', '3D depth'], ['rSmooth', '3D smoothness'], ['rShine', 'Shine'], ['rLight', 'Light direction'], ['rSpin', 'Light spin']]],
  // Type art is one for the whole picture too: blocks on several tracks mix, each counted as much as its loop shows
  // (see seqTypeApply); its characters, font and color stay as set under Type art
  ['Type art', [['tAmt', 'Type art amount'], ['tSize', 'Character size'], ['tShimmer', 'Shimmer']]],
];
const SEQ_TYPE = ['tAmt', 'tSize', 'tShimmer'];
const SEQ_NAME = Object.fromEntries(SEQ_SLIDERS.flatMap(([, list]) => list));
const SEQ_LINES = ['#e9fbe9', '#ffd27a', '#8ff0ff', '#ffa3d1', '#b8f28a', '#c9a8ff', '#ff9e7a', '#7ab8ff'];
const seqLineColor = (ai) => SEQ_LINES[ai % SEQ_LINES.length];
// The change line being edited in a block (the one in front): the one picked last, else its newest
function seqLineAct(bl) {
  if (!bl || !bl.autos.length) return -1;
  const a = seq.lineAct && seq.lineAct.id === bl.id ? seq.lineAct.ai : -1;
  return a >= 0 && a < bl.autos.length ? a : bl.autos.length - 1;
}
function seqSetLineAct(bl, ai) {
  seq.lineAct = { id: bl.id, ai };
  if (seq.selPt && (seq.selPt.id !== bl.id || seq.selPt.ai !== ai)) seq.selPt = null;
  seq.dirty = true;
  seqInspector();
}
// A slider's range, from the control itself
// Mirror steps: Off, 2, 4, 6 and 8 sides. Its change line goes from Off (bottom) to 8 (top), in steps, and each
// step comes in through the Transition picked for the line (Cut, Melt, Iris or Ripple) over the time picked.
const MIRROR_STEPS = [0, 2, 4, 6, 8];
const mirrorSnap = (v) => MIRROR_STEPS.reduce((p, q) => (Math.abs(q - v) < Math.abs(p - v) ? q : p), 0);
const snapLine = (key, val) => (key === 'mirror' ? mirrorSnap(val * 8) / 8 : val);
// A Mirror line holds each mirror until its next point, then changes straight to that point's mirror (0 to 6 is one
// change, not three steps of two): each point is a change, at its own time. The value of a line at u, either way:
function lineValue(au, u) {
  if (au.key !== 'mirror') return TL.autoValue(au.pts, u);
  const p = mirrorPoint(au, u);
  return p ? p[1] : au.pts[0][1];
}
// The Mirror change in effect at u: the last point at or before it (null before the first change)
function mirrorPoint(au, u) {
  const pts = au.pts;
  let at = null;
  for (let i = 0; i < pts.length; i++) if (pts[i][0] <= u + 1e-6) at = pts[i];
  return at;
}
// A Mirror point's own transition and time, or the line's, or the usual
const ptFx = (au, p) => (p && p[2]) || au.fx || 'melt';
const ptSecs = (au, p) => (p && p[3]) || au.secs || MIRROR_SECS;
function seqRange(key) {
  if (key === 'mirror') return [0, 8];
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
const seqName = (bl) => {
  if (bl.rec) return 'Recording…';
  if (bl.label) return bl.label;
  const in1 = bl.look?.in1, m = bl.media;
  if (in1 === 'picture' && m?.pic) return m.pic.name;
  if (in1 === 'video' && m?.vid) return m.vid.name;
  return inputName(in1);
};

const seq = {
  typeL: { A: null, B: null, C: null, D: null }, typeBase: null, typeUi: 0,
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
// A key/value store in IndexedDB (each in a database of its own)
function idbStore(dbName) {
  let db = null;
  const open = () => db ||= new Promise((res, rej) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('s');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => { const tx = d.transaction('s', mode), q = fn(tx.objectStore('s')); tx.oncomplete = () => res(q?.result); tx.onerror = () => rej(tx.error); });
  };
  return { get: (k) => run('readonly', (s) => s.get(k)), put: (k, v) => run('readwrite', (s) => s.put(v, k)),
    entries: async () => { const [k, v] = await Promise.all([run('readonly', (s) => s.getAllKeys()), run('readonly', (s) => s.getAll())]); return k.map((key, i) => [key, v[i]]); } };
}
const seqSpecDB = idbStore('phosphor-song-spectrographs');
// Pointers to your own pictures and videos on disk that sequencer blocks use, by file name (never the files
// themselves). Chrome and Edge only; elsewhere a block finds its file by name once you've picked it this visit.
const filePointerDB = idbStore('phosphor-file-pointers');
const filePointers = new Map();
if (window.showOpenFilePicker) filePointerDB.entries().then((list) => { for (const [k, h] of list) if (!filePointers.has(k)) filePointers.set(k, h); }).catch(() => {});
// An earlier build kept copies of the files themselves; they're cleared away
try { indexedDB.deleteDatabase('phosphor-block-media'); } catch (_) { /* nothing to clear */ }
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
// Following a Spotify song, the playhead runs smoothly: Spotify is asked where it is about once a second, and each
// answer is a little early or late, so small differences (under a second and a half) are caught up by running the
// playhead a little faster or slower for a moment, never by stepping back; a bigger one is a skip (in Spotify, or a
// click on the timeline), and the playhead goes straight there.
const seqPh = { t: 0, at: 0, live: false };
function seqPos(now) {
  const s = spotify.snapshot;
  if (seq.song && s?.track && s.track.uri === seq.song.uri && now - s.receivedAt < 10000) {
    const want = spotify.position(now) / 1000, dt = seqPh.at ? Math.min(0.25, (now - seqPh.at) / 1000) : 0;
    const off = want - seqPh.t;
    if (!seqPh.live || Math.abs(off) > 1.5) {
      // A skip (or just started following): straight there, and every block is put on afresh
      if (seqPh.live) { seq.applied = [null, null, null, null]; seq.jumped = true; }
      seqPh.t = want;
    } else if (!s.playing) seqPh.t += off * (1 - Math.exp(-dt * 12));   // paused: settles on the spot it stopped at
    else seqPh.t += dt * (1 + clamp(off / 0.6, -0.6, 0.6));
    seqPh.at = now; seqPh.live = true;
    return { t: Math.max(0, seqPh.t), playing: !!s.playing, live: true };
  }
  seqPh.live = false; seqPh.at = 0;
  const L = seq.local;
  return { t: L.playing ? L.pos + (now - L.at) / 1000 : L.pos, playing: L.playing, live: false };
}
function seqLoadSong(key, song) {
  seqStopRec();
  seqSpecStore(true);
  if (seq.key !== key) seq.records.set(seq.key, seq.rec);
  if (seq.editing) seqEditEnd(false);
  seq.key = key; seq.song = song || null;
  seq.apBefore = null;
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
// While a sequence plays, each loop whose track has blocks is the sequence's: between its blocks it's hidden. A loop
// whose track has none is left to you. When it stops, every loop it hid comes back as it was before it started,
// and the color grading and 3D lighting it gave each loop go back to the ones you set.
function seqRun(on, message) {
  const was = seq.running;
  seq.running = on;
  $('#seqPlay').setAttribute('aria-pressed', String(on));
  seq.applied = [null, null, null, null];
  // What you played over the last run stays on screen as it is, but the sequence starts (or ends) with none of it held
  handForget();
  if (on) {
    if (ap.on) setAutopilot(false, true);
    seq.apMode = null;
    typeGlide.on = false;
    // Type art gets ready now (its first start takes a moment), not when the first block with it comes in
    if (seq.rec.blocks.some((b) => b.autos.some((au) => SEQ_TYPE.includes(au.key)))) typeEngine();
    // Back from Autopilot at the sequence's end (even after Stop): as it was when the sequence ended
    if (seq.apBefore) seqApBack();
    if (!was) seq.showsBefore = Object.fromEntries(KEYS.map((k) => [k, mix.tgt[SHOW[k]]]));
    if (loopCount < seqUsedLoops()) { setLoopCount(seqUsedLoops(), 'load'); syncUI(); }
  } else {
    if (seq.apMode) { seq.apMode = null; }
    seqStopRec();
    seq.ownsVideo = false;
    for (const to of Object.values(vids)) { seqVidRelease(to, true); vidDropSpare(to); }
    if (was) seqGiveBack();
  }
  if (message) seqNote(message);
}
// The tracks this song's sequence has blocks on
const seqTracksUsed = () => new Set(seq.rec.blocks.map((b) => b.track));
// Type art from the sequence: each of Amount, Character size and Shimmer that some block's line sets is the mix of
// them (each counted as much as its loop shows); the rest stay as you set them. What you'd set is kept (typeBase) and
// comes back when no block sets them any more, or the sequence stops.
function seqTypeApply(now) {
  let any = false;
  for (const key of SEQ_TYPE) {
    let sum = 0, wt = 0;
    for (const K of KEYS) {
      const t = seq.typeL[K];
      if (!t || !(key in t) || !loopOn(K)) continue;
      const w = Math.max(0.001, clamp(mix.tgt[SHOW[K]], 0, 100) / 100);
      sum += t[key] * w; wt += w;
    }
    if (!wt) continue;
    if (!seq.typeBase) seq.typeBase = Object.fromEntries(SEQ_TYPE.map((q) => [q, typeArt[q]]));
    // (an Amount glide Autopilot started would otherwise keep pulling it its way for its whole Fade time)
    typeGlide.on = false;
    typeArt[key] = Math.round(sum / wt);
    any = true;
  }
  if (seq.typeBase) for (const key of SEQ_TYPE) if (!KEYS.some((K) => seq.typeL[K] && key in seq.typeL[K] && loopOn(K))) typeArt[key] = seq.typeBase[key];
  if (!any && seq.typeBase) { seq.typeBase = null; syncTypeUI(); return; }
  if (any && now - seq.typeUi > 250) { seq.typeUi = now; for (const key of SEQ_TYPE) { const c = typeEls[key]; c.el.value = typeArt[key]; fillTrack(c.el); c.out.textContent = typeText(key, typeArt[key]); } }
}
// Autopilot at the end of a sequence: everything as it was when the sequence ended is kept, and comes back when the
// sequence plays again (a jump back, or Play), so nothing Autopilot brought in (another loop's input, a fader, a feed)
// stays behind the sequence's looks
function seqApSnap() {
  return { mix: { ...mix.tgt }, count: loopCount, loops: Object.fromEntries(KEYS.map((k) => [k, JSON.parse(JSON.stringify(loops[k].tgt))])) };
}
function seqApBack() {
  const b = seq.apBefore;
  seq.apBefore = null;
  if (!b) return;
  if (loopCount !== b.count) setLoopCount(b.count, 'load');
  Object.assign(mix.tgt, b.mix);
  const used = seqTracksUsed();
  KEYS.forEach((k, i) => {
    if (used.has(i)) return;   // the sequence's own loops take its looks again straight away
    const L = loops[k];
    L.ramp = null;
    Object.assign(L.tgt, b.loops[k]);
    L.base = { ...L.tgt };
  });
  seq.applied = [null, null, null, null];
  settleDevices();
  syncUI();
}
function seqGiveBack() {
  seq.gradeOwned = false;
  for (const K of KEYS) seq.typeL[K] = null;
  seqTypeApply(performance.now());
  const before = seq.showsBefore || {};
  for (const [i, k] of KEYS.entries()) {
    loopGrade[k] = null; seqRelief[k] = null;
    // A loop the sequence hid (and you hadn't) comes back
    if (mix.tgt[SHOW[k]] < 1 && (before[k] ?? 0) >= 1) mix.tgt[SHOW[k]] = before[k];
    else if (mix.tgt[SHOW[k]] < 1 && seq.rec.blocks.some((b) => b.track === i) && k !== 'B') mix.tgt[SHOW[k]] = 100;
  }
  seq.showsBefore = null;
  syncUI();
}
// Your hand on a loop the sequence is playing (picking its input, or its Show fader): you take over and the sequence
// stops, rather than it hiding or replacing what you just did
function seqTakeOver(k) {
  if (handPlays()) return;   // Play over it: your hand rides on top instead (see handBefore / handAfter)
  if (!seq.running || seq.apMode || !seqTracksUsed().has(KEYS.indexOf(k))) return;
  seqRun(false, 'You took over, so the sequence stopped. Press Play to go back to it.');
  toast('You took over, so the sequence stopped. Press Play in the sequencer to go back to it.');
}

/* ---- Play over it: your hand on top of a playing sequence, like a knob on a DJ mixer ----
   While it's on and the sequence plays, a fader you move on one of its loops keeps the sequence's own value (its
   block's look and change lines) and adds your amount to it: hand.loop[K][key] (and hand.mix[key] for Show and the
   feeds) hold { off: your amount, applied: what was really added this frame (after the fader's ends), rel: when you
   let go, from: your amount then }. Other things you pick on that loop (an input, a mirror level, a switch) are held
   as they are: hand.set[K][key], with the sequence's own value in hand.raw[K][key]. Each frame the sequence gets its
   own values back (handBefore), plays (seqApplyTrack), and yours go on top again (handAfter). Nothing goes into the
   sequence itself. Your changes stay until Let go (or a double-click on one fader), or, with "When I let go: Drifts
   back", a fader eases back to the sequence over that many seconds after you let go of it. */
const HAND_KEY = 'phosphor-seq-hand';
const hand = {
  on: true, secs: 0,
  loop: { A: {}, B: {}, C: {}, D: {} }, mix: {},
  set: { A: {}, B: {}, C: {}, D: {} }, raw: { A: {}, B: {}, C: {}, D: {} },
  after: { A: null, B: null, C: null, D: null },
  touchAt: -1e9, grab: null, ui: '',
};
try {
  const h = JSON.parse(localStorage.getItem(HAND_KEY) || 'null');
  if (h) { hand.on = h.on !== false; if ([0, 2, 4, 8].includes(h.secs)) hand.secs = h.secs; }
} catch (_) {}
function handKeep() { try { localStorage.setItem(HAND_KEY, JSON.stringify({ on: hand.on, secs: hand.secs })); } catch (_) {} }
// Export video plays the sequence by itself, so your hand isn't laid over it
const handPlays = () => hand.on && seq.running && !seq.apMode && !seq.editing && !EX.stage;
const handOwns = (K) => loopOn(K) && seqTracksUsed().has(LOOP_NUM[K]) && !(seq.recording && LOOP_NUM[K] === seq.selTrack);
// Show A-D belong to their loop; a feed belongs to the sequence when either loop of its pair is the sequence's
const handMixOwned = (key) => /^show/.test(key) ? handOwns(key.slice(4)) : handOwns(FEED_TO[key]) || handOwns(otherLoop(FEED_TO[key]));
const handHoldsInput = (K) => handPlays() && ('in1' in hand.set[K] || 'in2' in hand.set[K]);
const handRange = (key) => { const el = sliderEls[key]; return el ? [+el.min, +el.max] : [-1e9, 1e9]; };
// A fader moved while the sequence plays its loop: your amount on top of the sequence's (true), or not handled (false)
function handSlider(key, isMix, v) {
  if (!handPlays()) return false;
  if (isMix ? !handMixOwned(key) : !handOwns(edit)) return false;
  const store = isMix ? hand.mix : hand.loop[edit], T = isMix ? mix.tgt : loops[edit].tgt;
  const e = store[key] || (store[key] = { off: 0, applied: 0, rel: null, from: 0 });
  const raw = T[key] - e.applied;
  e.off = e.from = v - raw; e.applied = e.off;
  T[key] = v;
  // Dragged: drifts back from when it's let go. A Shift+wheel or arrow-key step: from now.
  const held = hand.grab && hand.grab.key === key;
  e.rel = held ? null : performance.now();
  handUI();
  return true;
}
// One fader given back to the sequence (double-click)
function handRelease(key, isMix) {
  if (!handPlays()) return false;
  const store = isMix ? hand.mix : hand.loop[edit], e = store[key];
  if (!e) return false;
  (isMix ? mix.tgt : loops[edit].tgt)[key] -= e.applied;
  delete store[key];
  handUI();
  seqNote('That fader is back with the sequence.');
  return true;
}
const handEase = (e, now) => {
  if (!hand.secs || e.rel === null) return true;
  const t = (now - e.rel) / (hand.secs * 1000);
  if (t >= 1) return false;
  const s = t * t * (3 - 2 * t);
  e.off = e.from * (1 - s);
  return true;
};
function handBefore(k, now) {
  const K = KEYS[k], T = loops[K].tgt, after = hand.after[K], set = hand.set[K], raw = hand.raw[K];
  if (!handPlays()) { hand.after[K] = null; return; }
  // Something else you picked on this loop since the last frame (an input, a mirror level, a switch): held as it is
  if (after && now - hand.touchAt < 1500) {
    for (const key of Object.keys(T)) {
      const v = T[key];
      if (LOOP_SLIDERS.includes(key) || (v !== null && typeof v === 'object') || v === after[key]) continue;
      if (!(key in set)) raw[key] = after[key];
      set[key] = v;
    }
  }
  // The sequence's own values back, so it plays as it would
  for (const [key, e] of Object.entries(hand.loop[K])) { T[key] -= e.applied; e.applied = 0; }
  for (const key of Object.keys(set)) T[key] = raw[key];
}
function handAfter(k, now, fresh) {
  const K = KEYS[k], L = loops[K], T = L.tgt, set = hand.set[K], raw = hand.raw[K];
  if (!handPlays()) return;
  for (const key of Object.keys(set)) { raw[key] = T[key]; T[key] = set[key]; }
  for (const [key, e] of Object.entries(hand.loop[K])) {
    if (!handEase(e, now)) { delete hand.loop[K][key]; continue; }
    const [lo, hi] = handRange(key), v = clamp(T[key] + e.off, lo, hi);
    e.applied = v - T[key];
    T[key] = v;
    // A block starting by itself is there from its first frame: with your amount in it, too
    if (fresh) L.cur[key] = v;
  }
  hand.after[K] = { ...T };
}
function handMixBefore() {
  for (const [key, e] of Object.entries(hand.mix)) { mix.tgt[key] -= e.applied; e.applied = 0; }
}
function handMixAfter(now) {
  if (!handPlays()) return;
  for (const [key, e] of Object.entries(hand.mix)) {
    if (!handEase(e, now)) { delete hand.mix[key]; continue; }
    const [lo, hi] = handRange(key), v = clamp(mix.tgt[key] + e.off, lo, hi);
    e.applied = v - mix.tgt[key];
    mix.tgt[key] = v;
  }
  handUI();
}
const handLoops = () => KEYS.filter((K) => Object.keys(hand.loop[K]).length || Object.keys(hand.set[K]).length || hand.mix[SHOW[K]]);
// Let go: everything you changed goes back to the sequence. Faders glide back; an input you picked comes back as the
// block's (with its picture or video)
function handLetGo() {
  for (const [i, K] of KEYS.entries()) {
    const T = loops[K].tgt;
    for (const e of Object.entries(hand.loop[K])) T[e[0]] -= e[1].applied;
    const set = hand.set[K];
    if ('in1' in set || 'in2' in set) seq.applied[i] = null;
    for (const key of Object.keys(set)) T[key] = hand.raw[K][key];
    hand.loop[K] = {}; hand.set[K] = {}; hand.raw[K] = {};
  }
  for (const [key, e] of Object.entries(hand.mix)) mix.tgt[key] -= e.applied;
  hand.mix = {};
  syncUI();
  handUI();
}
// The sequence starting or stopping: nothing held any more (what's on screen stays as it is)
function handForget() {
  for (const K of KEYS) { hand.loop[K] = {}; hand.set[K] = {}; hand.raw[K] = {}; hand.after[K] = null; }
  hand.mix = {};
  handUI();
}
function handUI() {
  const live = handPlays() ? handLoops() : [];
  const sig = `${hand.on}|${hand.secs}|${live.join('')}`;
  if (sig === hand.ui) return;
  hand.ui = sig;
  for (const K of KEYS) { const el = $('#hand' + K); if (el) el.hidden = !live.includes(K); }
  const go = $('#seqLetGo');
  go.disabled = !live.length;
  go.classList.toggle('live', !!live.length);
  go.textContent = live.length ? `Let go (loop${live.length > 1 ? 's' : ''} ${live.join(', ')})` : 'Let go';
  $('#seqHandOn').setAttribute('aria-pressed', String(hand.on));
  $('#seqHandDrift').value = String(hand.secs);
  $('#seqHandDrift').disabled = !hand.on;
}
// When you last touched a control (outside the sequencer): a change to a loop then is yours, not something else's
for (const type of ['pointerdown', 'click', 'keydown', 'wheel', 'input', 'change']) {
  document.addEventListener(type, (e) => { if (!(e.target && e.target.closest && e.target.closest('#seq'))) hand.touchAt = performance.now(); }, { capture: true, passive: true });
}
document.addEventListener('pointerdown', (e) => {
  const el = e.target;
  if (!el.matches || !el.matches('input[type="range"]')) return;
  const m = el.closest('.mirror'), key = m ? el.dataset.mid : el.id, K = m ? m.dataset.loop : edit;
  hand.grab = { key, K };
  // Grabbing a fader that's drifting back holds it where it is
  const e2 = MIX_SLIDERS.includes(key) ? hand.mix[key] : hand.loop[K] && hand.loop[K][key];
  if (e2) { e2.rel = null; e2.from = e2.off; }
}, true);
for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => {
  const g = hand.grab;
  hand.grab = null;
  if (!g) return;
  const e = MIX_SLIDERS.includes(g.key) ? hand.mix[g.key] : hand.loop[g.K] && hand.loop[g.K][g.key];
  if (e) { e.rel = performance.now(); e.from = e.off; }
}, true);
$('#seqHandOn').addEventListener('click', () => {
  if (hand.on) handLetGo();
  hand.on = !hand.on; handKeep(); handUI();
  seqNote(hand.on ? 'Play over it is on: move anything while the sequence plays and it rides on top. Let go gives it all back.'
    : 'Play over it is off: changing a loop’s input or Show while the sequence plays it stops the sequence.');
});
$('#seqHandDrift').addEventListener('change', (e) => {
  hand.secs = +e.target.value || 0; handKeep(); handUI();
  // Changes held now start drifting from here
  const now = performance.now();
  const g = hand.grab, grabbed = g && (MIX_SLIDERS.includes(g.key) ? hand.mix[g.key] : hand.loop[g.K]?.[g.key]);
  for (const e2 of [...Object.values(hand.mix), ...KEYS.flatMap((K) => Object.values(hand.loop[K]))]) if (e2 !== grabbed) { e2.rel = now; e2.from = e2.off; }
});
$('#seqLetGo').addEventListener('click', () => { handLetGo(); seqNote('Everything is back with the sequence.'); });
setTimeout(handUI, 0);   // (once everything it looks at is set up)
async function seqPlay() {
  if (seq.editing) { seqNote('Save to block or Cancel the look you’re editing first (the bar under the picture).'); return; }
  seqAskFiles();
  // Following a Spotify song: Play starts the song in Spotify too (on the device it was last playing on, or the
  // first one Spotify has open), and the looks run with it
  if (seq.song && spotify.snapshot?.track?.uri === seq.song.uri) {
    if (spotify.snapshot.playing) { seqRun(true, 'Following the song in Spotify.'); return; }
    seqRun(true, 'Starting the song in Spotify…');
    try { await spotify.play(); seqNote('Following the song in Spotify.'); }
    catch (err) { seqNote(`${err.message} The looks follow as soon as the song plays.`); toast(err.message, 8000); }
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
// From the start: the sequence from its very beginning, and its song from the top in Spotify
async function seqFromStart() {
  if (seq.editing) { seqNote('Save to block or Cancel the look you’re editing first (the bar under the picture).'); return; }
  seqAskFiles();
  if (seq.song && spotify.token) {
    seqRun(true, 'Starting the song from the top in Spotify…');
    try { await spotify.play(0, seq.song.uri); seqNote('Playing from the start, following the song in Spotify.'); }
    catch (err) { seqNote(`${err.message} The looks follow as soon as the song plays.`); toast(err.message, 8000); }
    return;
  }
  const L = seq.local;
  L.pos = 0; L.at = performance.now(); L.playing = true;
  seqRun(true, 'Playing the sequence from the start.');
  seq.jumped = true;
}
$('#seqTop').addEventListener('click', () => { void seqFromStart(); });
$('#seqStop').addEventListener('click', () => { void seqStop(); if (!seq.song) { seq.local.pos = 0; seq.dirty = true; } });
/* ---------- Edit this look ---------- */
// A block's look, changed with the ordinary controls: the sequence stops, the block's look (its picture or video, and
// its Color grading on the Color grading faders) goes onto its loop, and the loop is shown. Save to block keeps the look
// as it then is (its change-over-time lines stay as they are); Cancel leaves the block alone. Either way your own Color
// grading comes back, and Cancel puts the loop back as it was.
function seqEditStart(bl) {
  if (seq.editing) seqEditEnd(false);
  if (exOn()) { seqNote('Wait for the export to finish first.'); return; }
  const K = KEYS[bl.track];
  if (seq.running) void seqStop();
  if (ap.on) setAutopilot(false, true);
  if (!loopOn(K)) { setLoopCount(LOOP_NUM[K] + 1, 'load'); syncUI(); }
  const L = loops[K];
  seq.editing = { id: bl.id, K, tgt: JSON.parse(JSON.stringify(L.tgt)), show: mix.tgt[SHOW[K]], grade: { ...grade } };
  patchLoop(K, bl.look, true);
  for (const q of LOOP_SMOOTH) L.cur[q] = L.tgt[q];
  mirrorCut(K);
  loopGrade[K] = null;
  Object.assign(grade, GRADE_DEF, bl.grade || {});
  syncGradeUI();
  seqShowMedia(bl, K);
  mix.tgt[SHOW[K]] = 100;
  seq.selId = bl.id; seq.dirty = true;
  setEdit(K);
  settleDevices();
  syncUI();
  $('#seqEditText').innerHTML = `<b>Editing “${escapeHTML(seqName(bl))}”</b> on loop ${K} · change anything with the controls, then Save to block`;
  $('#seqEditBar').hidden = false;
  seqNote(`Editing “${seqName(bl)}”: its look is on loop ${K} now. Change anything, then press Save to block (under the picture).`);
}
function seqEditEnd(save) {
  const ed = seq.editing;
  if (!ed) return;
  seq.editing = null;
  $('#seqEditBar').hidden = true;
  const bl = seq.rec.blocks.find((b) => b.id === ed.id), K = ed.K, L = loops[K];
  if (save && bl) {
    seqChange(() => {
      bl.look = JSON.parse(JSON.stringify(L.tgt));
      const g = seqGradeNow();
      if (g) bl.grade = g; else delete bl.grade;
      const m = seqCaptureMedia(bl.look, K);
      if (m) bl.media = m; else delete bl.media;
    });
    seq.applied = [null, null, null, null];
    seqNote(`Saved: “${seqName(bl)}” has its new look.`);
  } else {
    Object.assign(L.tgt, ed.tgt);
    for (const q of LOOP_SMOOTH) L.cur[q] = L.tgt[q];
    mirrorCut(K);
    mix.tgt[SHOW[K]] = ed.show;
    seqNote(bl ? `Cancelled: “${seqName(bl)}” is as it was.` : 'Cancelled.');
  }
  // Your own Color grading comes back
  Object.assign(grade, ed.grade);
  syncGradeUI();
  saveGrade();
  seq.dirty = true;
  settleDevices();
  syncUI();
}
$('#seqEditSave').addEventListener('click', () => seqEditEnd(true));
$('#seqEditCancel').addEventListener('click', () => seqEditEnd(false));
/* ---------- export a sequence as a video ---------- */
// Export video… plays the sequence once from the top, by itself, while the picture is drawn at 4K (or 1440p / 1080p)
// and recorded with this computer's sound (the song, playing in Spotify on this computer), then saves an MP4. It
// runs in real time: the song can't be recorded any faster than it plays. Stages: 'size' (waiting for the picture to
// be drawn at its new size), 'lead' (recording the first look for a moment), 'start' (the song starting), 'play',
// 'tail' (a moment more after the end), then the file.
const EX = { stage: '', vr: null, chunks: [], sound: [], blend: null, end: 0, frames: 0, t0: 0, spotify: false, name: '',
  started: false, stop: '', mime: '', lock: null, hidden: false, h: 2160 };
const exOn = () => !!EX.stage;
// A sequence made for a Spotify song follows that song while it exports (with or without its sound in the video)
const exFollows = () => !!(seq.song && spotify.token);
const exSpotify = () => exFollows() && spotify.canSeek;
const exEnd = () => (seq.song ? seq.song.durationMs / 1000 : Math.max(TL.MIN_LEN, TL.lastEnd(seq.rec)));
const exSay = (t) => { $('#seqExSay').textContent = t || ''; };
function exOpen() {
  if (exOn()) return;
  if (seq.editing) { seqNote('Save to block or Cancel the look you’re editing first (the bar under the picture).'); return; }
  const f = $('#seqExportForm');
  if (!f.hidden) { f.hidden = true; return; }
  if (!seq.rec.blocks.length) { seqNote('Add some looks to the tracks first: there’s nothing to export yet.'); return; }
  if (mvRec.on || mvRec.pending || recorder) { seqNote('Finish the recording that’s going first.'); return; }
  f.hidden = false;
  exSay('');
  exHow();
}
// Export quality: the same three as Phosphor Stream's recordings (stream-app/src/record.js, REC_QUALITY), in
// Mbps at 30 frames a second for each size. The export records at up to 60 frames a second, so it gets half as much
// again, as Phosphor Stream does at 60, and never more than 300 Mbps.
const EX_QUALITY = {
  youtube: { label: 'YouTube standard', mbps: { 2160: 45, 1440: 24, 1080: 12 } },
  clean: { label: 'Very clean', mbps: { 2160: 100, 1440: 50, 1080: 30 } },
  perfect: { label: 'Near-perfect', mbps: { 2160: 250, 1440: 130, 1080: 70 } },
};
const EX_QUALITY_KEY = 'phosphor-ex-quality';
let exQuality = EX_QUALITY[lsGet(EX_QUALITY_KEY)] ? lsGet(EX_QUALITY_KEY) : 'clean';
const exBps = (h, q = exQuality) => Math.round(Math.min(300, EX_QUALITY[q].mbps[h] * 1.5) * 1e6);
function syncExQuality() { $$('#seqExQuality button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === exQuality))); }
function exHow() {
  const h = +($('#seqExSize [aria-pressed="true"]')?.dataset.h || 2160), wide = Math.round(h * 16 / 9);
  const sound = $('#seqExSound').checked, heard = exHeard();
  const steps = [`It plays the whole sequence once, from the start, in real time (${fmtT(exEnd())}), and saves it as an MP4 video, ${h === 2160 ? '4K' : h + 'p'} (${wide}×${h} for a wide picture).`];
  if (seq.song && !exSpotify()) steps.push('Spotify isn’t connected with permission to play, so the song won’t start by itself: reconnect it under Song sequencer, or untick the sound.');
  else if (seq.song) steps.push(`The song, ${escapeHTML(seq.song.name)}, starts in Spotify from the top by itself. Its sound is recorded from this computer, so play Spotify on this computer, not your phone, and keep its volume up.`);
  else if (sound) steps.push('This sequence has no song, so the video gets whatever sound this computer plays meanwhile.');
  if (sound) steps.push(heard ? 'The sound is what React to sound already hears from this computer.'
    : 'When you press Start export, Chrome asks what to share: pick <b>Entire screen</b>, switch on <b>Also share system audio</b>, then press <b>Share</b>. Only the sound is used.');
  const gb = ((exBps(h) + 320000) * exEnd()) / 8 / 1e9;
  steps.push(`Quality: <b>${EX_QUALITY[exQuality].label}</b>, ${Math.round(exBps(h) / 1e6)} Mbps, the same as Phosphor Stream’s recordings. This video will be about ${gb < 1 ? Math.max(0.1, Math.round(gb * 10) / 10) : Math.round(gb * 10) / 10} GB${gb > 6 ? ': make sure there’s room on the drive your Downloads go to' : ''}.`);
  steps.push(`Leave this window open and in front until it’s done; you can watch it. If the picture stutters at ${h === 2160 ? '4K' : h + 'p'}, Cancel and pick a smaller size.`);
  $('#seqExHow').innerHTML = steps.map((t) => `<li>${t}</li>`).join('');
}
// The computer's sound React to sound already hears (not a microphone), if it does
function exHeard() {
  const t = snd.track && snd.track.readyState === 'live' ? snd.track : null;
  return t && (snd.src === 'system' || snd.src === 'loopback') ? t : null;
}
async function exGo() {
  if (exOn()) return;
  if (mvRec.on || mvRec.pending || recorder) { exSay('Finish the recording that’s going first.'); return; }
  if (!window.MediaRecorder || !canvas.captureStream) { exSay('This browser can’t record video. Use Chrome or Edge.'); return; }
  const wantSound = $('#seqExSound').checked;
  EX.sound = [];
  if (wantSound) {
    const heard = exHeard();
    if (heard) EX.sound.push(heard.clone());
    else {
      exSay('Waiting for you to share this computer’s sound…');
      try { EX.sound.push(await openRecComputer()); }
      catch (err) {
        const n = err && err.name;
        exSay(n === 'NoSoundShared' ? 'No sound came with the share. Press Start export again and switch on Also share system audio under the screen you pick.'
          : n === 'NoLoopback' ? `${browserName} can’t record this computer’s sound. Use Chrome or Edge, or untick the sound.`
          : n === 'NotAllowedError' ? 'Sharing was cancelled, so nothing started. Press Start export to try again, or untick the sound.'
          : 'This computer’s sound couldn’t start. Try again, or untick the sound.');
        return;
      }
    }
  }
  EX.h = +($('#seqExSize [aria-pressed="true"]')?.dataset.h || 2160);
  EX.spotify = exFollows();
  EX.asked = false; EX.seekAsked = false;
  EX.end = exEnd();
  EX.name = `${(seq.song ? seq.song.name : seq.rec.title || 'Phosphor Loop sequence').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)} ${EX.h === 2160 ? '4K' : EX.h + 'p'}`;
  EX.started = false; EX.stop = ''; EX.hidden = false;
  $('#seqExportForm').hidden = true;
  exSay('');
  // The sequence waits at its first look; the song is paused until the recording runs
  if (seq.running) { const L = seq.local; L.playing = false; seqRun(false); }
  if (EX.spotify && spotify.snapshot?.playing) await spotify.pause();
  seq.local.pos = 0; seq.local.playing = false;
  seq.applied = [null, null, null, null]; seq.jumped = true;
  // The picture is drawn at the export's size while it runs, in its own shape (as Save clip's recordings are)
  // (a video's shape: wide, 16:9, unless the picture is set to the old TV shape)
  const aspect = shape === 'tv' ? 4 / 3 : 16 / 9, h = EX.h;
  MV.size = { width: Math.min(4096, Math.round((h * aspect) / 2) * 2), height: h, renderHeight: Math.round((h * SIM_H) / 576) };
  fit();
  EX.stage = 'size'; EX.frames = 0;
  // Keeps the screen awake (a sleeping screen would stop the picture)
  try { EX.lock = await navigator.wakeLock?.request('screen'); } catch (_) { EX.lock = null; }
  $('#expBar').hidden = false;
  $('#expText').innerHTML = '<b>Exporting</b> · getting ready…';
}
function exBegin() {
  let stream;
  try { stream = canvas.captureStream(60); } catch (_) { exFail('This browser can’t record the picture. Use Chrome or Edge.'); return; }
  EX.blend = blendSounds(EX.sound, recSync);
  if (EX.blend.track) stream.addTrack(EX.blend.track);
  const withSound = !!EX.blend.track;
  // H.264 with AAC sound plays everywhere (YouTube, Instagram, phones, video editors); WebM where the browser can't
  const types = withSound
    ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  EX.mime = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  // The quality picked in the export panel (the same rates as Phosphor Stream's recordings). Chrome keeps a long
  // recording on the disk as it goes, rather than all in memory.
  const vbps = exBps(EX.h);
  const abps = /mp4a/.test(EX.mime) ? 192000 : 320000;
  let vr;
  try { vr = new MediaRecorder(stream, EX.mime ? { mimeType: EX.mime, videoBitsPerSecond: vbps, audioBitsPerSecond: abps } : undefined); }
  catch (_) { stream.getTracks().forEach((t) => t.stop()); exFail('This browser can’t record the picture. Use Chrome or Edge.'); return; }
  EX.vr = vr; EX.chunks = [];
  vr.ondataavailable = (e) => { if (e.data && e.data.size) EX.chunks.push(e.data); };
  vr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const type = vr.mimeType || EX.mime || 'video/webm', chunks = EX.chunks, ms = (performance.now() - EX.t0);
    EX.chunks = [];
    const keep = EX.stop !== 'cancel';
    exCleanUp();
    if (!keep) { seqNote('Export cancelled.'); return; }
    const ext = type.includes('mp4') ? 'mp4' : 'webm', raw = new Blob(chunks, { type });
    if (!raw.size) { seqNote('Nothing was recorded. Try again.'); return; }
    seqNote('Export finished: name the video to save it.');
    let file = raw;
    try { file = await (ext === 'mp4' ? standardMp4(raw) : addWebmDuration(raw, ms)); } catch (_) { file = raw; }
    offerFile(`${EX.name}.${ext}`, file);
  };
  vr.start(1000);
  EX.t0 = performance.now();
  EX.stage = 'lead'; EX.frames = 0;
}
// Each frame while exporting (from the drawing loop)
function exTick(now) {
  if (!EX.stage) return;
  EX.frames++;
  if (document.hidden && !EX.hidden) { EX.hidden = true; toast('Keep Phosphor Loop in front while it exports: hidden, it stops drawing.', 8000); }
  if (EX.stage === 'size') {
    const want = MV.size;
    if (!want || (canvas.width === want.width && canvas.height === want.height) || EX.frames > 90) exBegin();
    return;
  }
  if (EX.stage === 'lead') {
    // The sequence's first look settles in for a moment (and the recording with it) before the song starts
    if (EX.frames === 1) { seqRun(true, 'Exporting: the sequence plays from the start.'); }
    if (EX.frames < 12) return;
    EX.stage = 'start'; EX.frames = 0;
    if (EX.spotify) {
      // The song goes back to its top and plays, the way Stop and Play would (asking Spotify for "this song from 0:00"
      // instead can leave the Spotify app blank, showing an error); if that can't be done, the export waits for you to
      // press Play in Spotify
      EX.askedAt = performance.now();
      if (spotify.canSeek) void (async () => {
        try {
          if (spotify.snapshot?.track?.uri === seq.song.uri) { await spotify.seek(0); await spotify.play(); }
          // Spotify's on another song, or none: it's started by hand (double-click it in Spotify); the export waits for it
          // and moves it back to 0:00 once it plays
          else EX.why = `Spotify isn’t on ${seq.song.name} right now.`;
        } catch (err) { EX.why = err.message; }
        EX.askedAt = performance.now();
      })();
      else EX.why = 'Spotify isn’t connected with permission to start the song.';
    } else {
      seq.local.pos = 0; seq.local.at = performance.now(); seq.local.playing = true;
    }
    return;
  }
  const t = seq.t;
  if (EX.stage === 'start') {
    // Under way once the song (or the sequence's own clock) plays from the top. Playing from further in (Spotify
    // started where it was), it's moved back to the top once.
    // With Spotify, only once Spotify itself says the song is playing (not just that it was asked to)
    const confirmed = !EX.spotify || (seqPh.live && spotify.snapshot?.playing && (spotify.polledAt || 0) > EX.askedAt);
    if (confirmed && seq.playing && t > 3 && !EX.seekAsked && spotify.canSeek) { EX.seekAsked = true; EX.seekAt = performance.now(); spotify.seek(0).catch(() => {}); }
    if (confirmed && seq.playing && (t < 3 || EX.seekAsked && performance.now() - EX.seekAt > 5000)) { EX.stage = 'play'; EX.frames = 0; EX.started = true; EX.from = t; return; }
    // Still waiting: what to do, plainly (it waits as long as it takes; Cancel stops it)
    const slow = performance.now() - EX.askedAt > 5000;
    $('#expText').innerHTML = !EX.spotify ? '<b>Exporting</b> · starting…'
      : EX.why ? `<b>Waiting for the song</b> · ${escapeHTML(EX.why)} Press Play on <b>${escapeHTML(seq.song.name)}</b> in Spotify, from the start, and the export goes on by itself.`
      : slow ? `<b>Waiting for the song</b> · Spotify hasn’t started it yet. Press Play on <b>${escapeHTML(seq.song.name)}</b> in Spotify on this computer and the export goes on by itself.`
      : '<b>Exporting</b> · starting the song in Spotify…';
    return;
  }
  if (EX.stage === 'play') {
    const paused = EX.spotify && spotify.snapshot && !spotify.snapshot.playing;
    $('#expText').innerHTML = paused ? `<b>Exporting</b> · ${fmtT(t)} of ${fmtT(EX.end)} · <b>the song is paused in Spotify</b>: press Play there to go on`
      : `<b>Exporting</b> · ${fmtT(t)} of ${fmtT(EX.end)} · ${canvas.width}×${canvas.height}${EX.blend?.track ? ', with sound' : ''}`;
    const songGone = EX.spotify && spotify.snapshot?.track && spotify.snapshot.track.uri !== seq.song?.uri;
    if (t >= EX.end - 0.25 || songGone || !seq.running) {
      // At the end the song is stopped before Spotify moves on to the next one
      if (EX.spotify) void spotify.pause();
      EX.stage = 'tail'; EX.frames = 0;
    }
    return;
  }
  if (EX.stage === 'tail') {
    // (a little longer at the end, so the held-back sound's last part is in)
    EX.tailAt ||= now;
    if (EX.frames >= 15 && now - EX.tailAt > recSync * 1000 + 300) { EX.tailAt = 0; exFinish('save'); }
  }
}
function exFinish(how) {
  if (!EX.stage) return;
  EX.stop = how;
  if (EX.vr && EX.vr.state !== 'inactive') { EX.stage = 'saving'; $('#expText').innerHTML = '<b>Exporting</b> · finishing the file…'; EX.vr.stop(); }
  else { exCleanUp(); if (how === 'cancel') seqNote('Export cancelled.'); }
  if (EX.spotify && spotify.snapshot?.playing) void spotify.pause();
}
function exFail(why) {
  EX.stop = 'cancel';
  if (EX.vr && EX.vr.state !== 'inactive') EX.vr.stop(); else exCleanUp();
  seqNote(why);
  toast(why, 9000);
}
function exCleanUp() {
  EX.sound.forEach((t) => t.stop()); EX.sound = [];
  if (EX.blend?.ctx) { try { EX.blend.ctx.close(); } catch (_) {} }
  EX.blend = null; EX.vr = null; EX.stage = '';
  try { EX.lock?.release(); } catch (_) {}
  EX.lock = null;
  $('#expBar').hidden = true;
  if (seq.running) { const L = seq.local; if (L.playing) { L.pos += (performance.now() - L.at) / 1000; L.playing = false; } seqRun(false); }
  mvSizeBack();
}
$('#seqExport').addEventListener('click', exOpen);
$('#seqExCancel').addEventListener('click', () => { $('#seqExportForm').hidden = true; });
$('#seqExGo').addEventListener('click', () => { void exGo(); });
$('#seqExSound').addEventListener('change', exHow);
function syncRecSync() { $$('#seqExSync button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.sync === recSync))); }
$$('#seqExSync button').forEach((b) => b.addEventListener('click', () => {
  recSync = +b.dataset.sync; lsSet(REC_SYNC_KEY, String(recSync)); syncRecSync();
}));
syncRecSync();
$$('#seqExQuality button').forEach((b) => b.addEventListener('click', () => {
  exQuality = b.dataset.q; lsSet(EX_QUALITY_KEY, exQuality); syncExQuality(); exHow();
}));
syncExQuality();
$$('#seqExSize button').forEach((b) => b.addEventListener('click', () => {
  $$('#seqExSize button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  exHow();
}));
$('#expStop').addEventListener('click', () => exFinish('save'));
$('#expCancel').addEventListener('click', () => exFinish('cancel'));
window.__plExport = { get sync() { return recSync; }, blend: (d) => { const AC = window.AudioContext || window.webkitAudioContext, c = new AC(), o = c.createOscillator(), m = c.createMediaStreamDestination(); o.connect(m); o.start(); const b = blendSounds([m.stream.getAudioTracks()[0]], d); return { delayed: !!b.ctx, track: !!b.track }; }, get stage() { return EX.stage; }, get from() { return EX.from; }, get end() { return EX.end; }, get size() { return { w: canvas.width, h: canvas.height }; }, get spotify() { return EX.spotify; } };   // for tests/seq_export_check.py
function seqSeek(t) {
  t = clamp(t, 0, seqDur());
  if (seq.song && spotify.snapshot?.track?.uri === seq.song.uri) {
    if (!spotify.canSeek) { seqNote('Reconnect Spotify (Song sequencer › Connect Spotify) to move the song from here.'); return; }
    spotify.seek(t * 1000).catch((err) => seqNote(err.message));
  } else { seq.local.pos = t; seq.local.at = performance.now(); }
  seq.applied = [null, null, null, null]; seq.dirty = true; seq.jumped = true;
}
$('#seqEnd').addEventListener('change', (e) => { seq.rec.end = e.target.value; seqSave(); });

/* ---------- playing the blocks onto the loops ---------- */
const SEQ_SKIP = new Set(['in1', 'in2', 'blend']);
/* ---------- a block's picture or video ---------- */
// A block that uses Picture or Video remembers which one: a nature picture by its file, the test card, a library clip
// by its id, or a picture or video of your own by its file name and a pointer to it (filePointerDB). The Picture and Video
// inputs are shared by every loop, so when two blocks on screen want different ones, the newer block's wins.
const usesIn = (look, src) => look?.in1 === src || look?.in2 === src;
const sameMedia = (a, b) => !!a && !!b && a.kind === b.kind && (a.f || a.id || a.name || '') === (b.f || b.id || b.name || '');
// Keeps the pointer to a file of your own (Chrome, Edge), so blocks using it can open it on a later visit
function seqKeepPointer(name, h) {
  if (!h || filePointers.get(name) === h) return;
  filePointers.set(name, h);
  filePointerDB.put(name, h).catch(() => {});
}
// What the Picture and Video inputs hold now, for a block with this look (and keeps copies of your own files)
function seqCaptureMedia(look, K = edit) {
  const sv = vidFor(K);
  const m = {};
  const kp = pics[K] || pic;
  if (usesIn(look, 'picture') && kp.media) {
    m.pic = { ...kp.media };
    if (m.pic.kind === 'own') seqKeepPointer(m.pic.name, kp.handle);
  }
  if (usesIn(look, 'video') && sv.media) {
    m.vid = { ...sv.media, at: r1(sv.video?.currentTime || 0) };
    if (m.vid.kind === 'own') seqKeepPointer(m.vid.name, sv.handle);
  }
  if (usesIn(look, 'genart') && gens[K]?.f) m.gen = { f: gens[K].f, name: gen.pics?.[gens[K].at]?.n || gens[K].f };
  return m.pic || m.vid || m.gen ? m : null;
}
const seqMediaSig = (look, K = edit) => JSON.stringify([usesIn(look, 'picture') ? (pics[K] || pic).media : null, usesIn(look, 'video') ? vidFor(K).media : null,
  ...(usesIn(look, 'genart') ? [gens[K]?.f || null] : [])]);
// Opens a file of your own for a block: through its pointer where there is one (and you've let the page open it this
// visit), or else the file of that name you picked this visit. Throws with what to do when neither works.
async function seqOwnFile(name, what) {
  const h = filePointers.get(name);
  if (h) {
    let ok = false;
    try { ok = (await h.queryPermission({ mode: 'read' })) === 'granted'; } catch (_) { /* treat as not allowed */ }
    if (ok) {
      try { const f = await h.getFile(); ownFiles.set(name, f); return { file: f, h }; }
      catch (_) { if (!ownFiles.has(name)) throw new Error(`The ${what} “${name}” isn’t where it was (moved, renamed or deleted). Pick it again under Inputs and the sequencer will use it from there.`); }
    } else if (!ownFiles.has(name)) throw new Error(`The browser needs your OK to open “${name}”. Press Stop, then Play, and allow it.`);
  }
  if (ownFiles.has(name)) return { file: ownFiles.get(name), h: null };
  throw new Error(`Pick the ${what} “${name}” under Inputs once and the sequencer will use it (this browser can’t keep a pointer to your files).`);
}
// Play is a click, so it can ask the browser for leave to open the files this song's blocks use (one OK per file;
// Chrome offers to remember it)
function seqAskFiles() {
  if (!window.showOpenFilePicker) return;
  const names = new Set(seq.rec.blocks.flatMap((b) => [b.media?.pic, b.media?.vid].filter((m) => m?.kind === 'own').map((m) => m.name)));
  for (const name of names) {
    const h = filePointers.get(name);
    if (!h) continue;
    h.queryPermission({ mode: 'read' }).then((p) => (p === 'granted' ? p : h.requestPermission({ mode: 'read' }))).catch(() => {});
  }
}
function seqBlobImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad picture')); };
    img.src = url;
  });
}
// Into loop K's own picture (the edited loop's unless said)
async function seqLoadPic(pm, K = edit) {
  const to = pics[K] || pic;
  const ask = ++to.seqAsk;
  try {
    if (pm.kind === 'nature') {
      await natList();
      const i = nat.pics.findIndex((p) => p.f === pm.f);
      if (i < 0) throw new Error();
      if (ask === to.seqAsk) natPick(i, true, to);
    } else if (pm.kind === 'card') {
      if (ask === to.seqAsk) picUseCard(to);
    } else {
      const { file, h } = await seqOwnFile(pm.name, 'picture');
      const img = await seqBlobImage(file);
      if (ask !== to.seqAsk) return;
      uploadTo(to.tex, downscale(img));
      to.aspect = img.naturalWidth / img.naturalHeight;
      natNoCredit(to); to.own = true; to.ask++;
      to.media = { ...pm }; to.handle = h;
      picPanelSync();
    }
  } catch (e) {
    if (ask === to.seqAsk) seqNote(e?.message || `The picture “${pm.name}” isn’t available any more. Pick it again under Inputs.`);
  }
}
// Puts a video player where the block wants it: its start point plus how far into the block the song is (a block
// still to come: its start point)
function seqVidTime(bl, to) {
  const v = to.video, at = (bl.media?.vid?.at || 0) + Math.max(0, seq.t - bl.a);
  if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
  const want = at % v.duration;
  if (Math.abs(v.currentTime - want) > 0.4) v.currentTime = want;
}
// While a block's video is on its way its loop shows nothing (black), never the video before it: the old video's
// last picture is wiped, and nothing new is drawn until the new one is in and at the block's spot
const blackCard = (() => { const c = document.createElement('canvas'); c.width = c.height = 2; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 2, 2); return c; })();
function seqVidWait(to) {
  if (to.wait) return;
  to.wait = true;
  for (const t of to.tex) { try { uploadTo(t, blackCard); } catch (_) { /* no picture yet */ } }
  // The silhouette pictures too, so a loop with Subject silhouette doesn't show the old video's outline
  for (const sub of Object.values(to.sub)) sub.frames = 0;
}
function seqVidRelease(to, now) {
  if (!to.wait) return;
  const v = to.video;
  const go = () => { to.wait = false; to.fresh = true; to.lastTime = -1; };
  if (now || !v || !v.seeking) { go(); return; }
  v.addEventListener('seeked', go, { once: true });
  // A jump that never finishes doesn't keep the picture black for good
  setTimeout(go, 3000);
}
// Loads a block's video into a loop's own player (to)
// spare: into the loop's spare player (its own player is showing the block before; see vidUseSpare)
async function seqLoadVid(bl, to = vid, spare = false) {
  const vm = bl.media.vid, ask = ++to.seqAsk;
  to.loading = vm;
  if (!spare) {
    to.forBl = bl;
    // Blacked out only when it's on screen now; a video loaded ahead (seqPreloadVid) isn't seen yet
    if (vidInUse(to)) seqVidWait(to);
  }
  try {
    if (vm.kind === 'clip') {
      // The library is asked again only for a clip it hasn't listed yet (one less wait before the video comes in)
      const known = () => (clips.all || []).find((x) => x.id === vm.id);
      if (!known() || !clips.base) await clipList(true);
      const c = known();
      if (!c || !(await clipPick(c, true, to, spare))) throw new Error(`The clip “${vm.name}” couldn’t be loaded. Is Phosphor Clips running?`);
    } else {
      const { file: own, h } = await seqOwnFile(vm.name, 'video');
      const file = await asVideoFile(own);   // a GIF of your own is made into its video again
      if (!file) throw new Error(`The video “${vm.name}” couldn’t be played.`);
      if (ask !== to.seqAsk) return;
      if (!spare) to.ask++;
      if (!(await openVideo(videoURL(file), vm.name, { quiet: true, to, spare }))) throw new Error(`The video “${vm.name}” couldn’t be played.`);
      const media = { ...vm };
      delete media.at;
      if (spare) { if (to.spare) Object.assign(to.spare, { media, handle: h, own: true, clip: '', credit: '' }); }
      else {
        to.own = true; clipNoCredit(to);
        to.media = media; to.handle = h;
        vidPanelSync();
      }
    }
    if (ask !== to.seqAsk) return;
    if (spare) {
      // Its block came in while it loaded (the loop is black, waiting for it): it takes over now
      if (to.forBl && sameMedia(to.forBl.media?.vid, vm)) { vidUseSpare(to); seqVidTime(to.forBl, to); }
      else if (to.spare) {
        // Waits at its start point
        const v = to.spare.v, at = vm.at || 0;
        if (Number.isFinite(v.duration) && v.duration > 0) v.currentTime = at % v.duration;
      }
    } else seqVidTime(to.forBl && sameMedia(to.forBl.media?.vid, vm) ? to.forBl : bl, to);
  } catch (e) { if (ask === to.seqAsk) seqNote(e.message); }
  finally {
    if (ask === to.seqAsk) { to.loading = null; seqVidRelease(to, false); }
  }
}
// A track's next block with a different video than its loop's player holds is loaded early, so it's ready (at its
// start point) the moment its block comes in: into the loop's own player while nothing on screen shows it, or else
// into its spare player (15 s ahead: a long clip in 4K can take a few seconds to come over from Phosphor Clips)
seq.preloadSecs = 15;
function seqPreloadVid(t) {
  if (!seq.playing) return;
  for (let k = 0, used = seqTracksUsed(); k < TL.TRACKS; k++) {
    const K = KEYS[k], to = vids[K];
    if (!used.has(k) || !loopOn(K) || to.loading) continue;
    let next = null;
    for (const b of seq.rec.blocks) {
      if (b.track !== k || !b.media?.vid || b.a <= t || b.a - t > seq.preloadSecs) continue;
      if (!next || b.a < next.a) next = b;
    }
    if (!next || sameMedia(next.media.vid, to.media) || (to.spare && sameMedia(next.media.vid, to.spare.media))) continue;
    seq.ownsVideo = true;
    seqLoadVid(next, to, vidInUse(to));
  }
}
function seqShowMedia(bl, K) {
  const m = bl?.media;
  if (!m) return;
  if (m.pic && !sameMedia(m.pic, pics[K].media)) seqLoadPic(m.pic, K);
  if (m.gen?.f) genPickF(m.gen.f, K);
  if (m.vid) {
    const to = vids[K];
    seq.ownsVideo = true;
    to.forBl = bl;
    if (sameMedia(m.vid, to.media) && to.on) seqVidTime(bl, to);
    // Waiting in the spare player: it takes over at once
    else if (to.spare && sameMedia(m.vid, to.spare.media) && !to.loading) { vidUseSpare(to); seqVidTime(bl, to); }
    // Already on its way (loaded ahead): the picture stays black until it's in, at this block's spot
    else if (sameMedia(m.vid, to.loading)) seqVidWait(to);
    else seqLoadVid(bl, to);
  }
}
function seqApplyTrack(k, x, now) {
  const K = KEYS[k], L = loops[K], T = L.tgt;
  if (!x) { mix.tgt[SHOW[K]] = 0; seq.applied[k] = null; seqGrade(K, null); seqRelief[K] = null; seq.typeL[K] = null; return; }
  const sig = x.other ? `${x.other.id}>${x.main.id}` : x.main.id;
  let fresh = false, startFresh = false;
  if (seq.applied[k] !== sig) {
    fresh = true;
    const wasCross = (seq.applied[k] || '').includes('>');
    patchLoop(K, x.other ? x.other.look : x.main.look, true);
    seq.xin[k] = false;
    // Over a crossfade the outgoing input fades into the incoming one through Blend
    if (x.other && x.main.look.in1 !== T.in1 && T.in2 === 'none') { T.in2 = x.main.look.in1; seq.xin[k] = true; }
    if (wasCross && !x.other) L.cur.blend = T.blend;
    seq.applied[k] = sig;
    // A block starting by itself (not out of a crossfade): see the end of this
    startFresh = !x.other && !wasCross;
    // The outgoing block's picture or video first, then the incoming one's, which wins where they share an input
    // (not while you hold this loop's input: Play over it)
    if (!handHoldsInput(K)) { seqShowMedia(x.other, K); seqShowMedia(x.main, K); }
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
  let mirrorLine = null;
  const take = (blk, u, wt) => {
    for (const au of blk.autos) {
      if (au.key === 'mirror' && (!mirrorLine || wt > mirrorLine.wt)) mirrorLine = { au, wt, u };
      const [lo, hi] = seqRange(au.key), v = lo + (hi - lo) * lineValue(au, u);
      if (!(au.key in vals)) vals[au.key] = { sum: 0, wt: 0 };
      vals[au.key].sum += v * wt; vals[au.key].wt += wt;
    }
  };
  take(x.main, x.u, x.other ? x.w : 1);
  if (x.other) take(x.other, x.uOther, 1 - x.w);
  const grade = {}, rel = {}, typ = {};
  for (const [key, { sum, wt }] of Object.entries(vals)) {
    if (wt <= 0) continue;
    const v = sum / wt;
    if (key === 'show') show = v;
    else if (key === 'feed') feed = v;
    else if (key in GRADE_DEF) grade[key] = v;
    else if (key in RELIEF_DEF) rel[key] = v;
    else if (SEQ_TYPE.includes(key)) typ[key] = v;
    else if (key === 'mirror') {
      // A new step comes in through the line's own Transition, over its own time (see mirrorStep)
      const step = mirrorSnap(v);
      // After a jump in the song the mirror is simply what the line says there (no change played out)
      if (fresh && seq.jumped) { T.mirror = step; mirrorCut(K); }
      else if (step !== T.mirror) {
        // Each change comes in the way its own point says (the point the line is heading for), or else the line's way
        if (mirrorLine) {
          const pt = mirrorPoint(mirrorLine.au, mirrorLine.u);
          T.mirrorFx = (pt && pt[2]) || mirrorLine.au.fx || 'melt';
          L.mxSecs = (pt && pt[3]) || mirrorLine.au.secs || MIRROR_SECS;
        }
        T.mirror = step;
        if (K === edit) syncUI();
      }
    }
    else if (key in T) T[key] = v;
  }
  // How the block's mirror comes in as it starts: Cut (unless picked otherwise in its details), or its Transition from
  // the mirror before, over its time
  // (after a jump in the song it's simply there)
  if (startFresh) {
    const [fx, secs] = x.main.mxIn || ['cut', 0];
    if (fx === 'cut' || seq.jumped) mirrorCut(K);
    else if (L.mx && L.mx.to !== T.mirror) { T.mirrorFx = fx; L.mxSecs = secs; }
    // Its settings (change lines included) are there from its first frame, not gliding in from what was before; its
    // fade in, when it has one, brings the look in as itself
    for (const q of LOOP_SMOOTH) L.cur[q] = T[q];
  }
  mix.tgt[SHOW[K]] = clamp(show, 0, 100) * x.show;
  // A block with no fade in is on screen from its first frame
  if (startFresh && !(x.main.fin > 0.05) && show * x.show > 1) mix.cur[SHOW[K]] = mix.tgt[SHOW[K]];
  if (feed !== null) mix.tgt[FEED_INTO[otherLoop(K)]] = feed;
  // The block's own grading (blended through a crossfade), with its Color grading lines over it
  const own = seqBlockGrade(x);
  seqGrade(K, own || Object.keys(grade).length ? { ...(own || {}), ...grade } : null);
  seq.typeL[K] = Object.keys(typ).length ? typ : null;
  seqRelief[K] = Object.keys(rel).length ? rel : null;
}
// Color grading inside the sequencer is each loop's own (see loopGrade); null puts that loop back to normal
function seqGrade(K, g) { loopGrade[K] = g; }
function seqBlockGrade(x) {
  const a = x.other && x.other.grade, b = x.main.grade;
  if (!x.other) return b || null;
  if (!a && !b) return null;
  const out = {}, w = x.w;
  for (const k of Object.keys(GRADE_DEF)) out[k] = (a?.[k] ?? GRADE_DEF[k]) + ((b?.[k] ?? GRADE_DEF[k]) - (a?.[k] ?? GRADE_DEF[k])) * w;
  return out;
}
// While a sequence with graded blocks plays, each loop is graded on its own: by its block's grading, or else by yours,
// and yours isn't laid over the whole picture as well (it would grade the blocks' grading twice)
const seqGradeOwns = () => seq.running && !seq.apMode && seq.rec.blocks.some((b) => b.grade);
function seqGradeRest() {
  const owns = seqGradeOwns();
  if (owns) for (const K of activeKeys()) { if (!loopGrade[K] && gradeOn()) loopGrade[K] = { ...grade }; }
  else if (seq.gradeOwned) for (const K of KEYS) loopGrade[K] = null;
  seq.gradeOwned = owns;
}


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
        if (seq.apMode !== 'end') { seq.apMode = 'end'; seq.apBefore = seqApSnap(); setAutopilot(true, true); seqNote('The sequence has ended, so Autopilot is running.'); }
      } else {
        if (seq.apMode === 'end') { seq.apMode = null; setAutopilot(false, true); seqApBack(); }
        if (!seq.apMode) {
          handMixBefore();
          for (let k = 0, used = seqTracksUsed(); k < TL.TRACKS; k++) {
            if (!loopOn(KEYS[k]) || !used.has(k)) continue;   // no blocks on this track: the loop is yours
            if (seq.recording && k === seq.selTrack) continue;   // you're playing this loop by hand
            const was = seq.applied[k];
            handBefore(k, now);
            seqApplyTrack(k, r.tracks[k], now);
            handAfter(k, now, seq.applied[k] !== was);
          }
          handMixAfter(now);
        }
        seq.jumped = false;
        seqGradeRest();
        seqTypeApply(now);
        seqPreloadVid(r.at ?? p.t);
      }
    }
  }
  // A block's video plays and pauses with the song
  if (seq.running && seq.ownsVideo) for (const to of Object.values(vids)) {
    if (!to.video || !vidInUse(to)) continue;
    if (!seq.playing || frozen) { if (!to.video.paused) to.video.pause(); }
    else if (to.video.paused && !to.userPaused) to.video.play().catch(() => {});
  }
  if (!$('#seq').hidden) seqDraw(now);
}

/* ---------- record look changes ---------- */
function seqRecTick(p) {
  const K = KEYS[seq.selTrack], L = loops[K];
  if (!seq.running || !p.playing) { seqStopRec(true); return; }
  const t = p.t;
  // A new look, or a different picture or video, starts the next block
  if (seq.recBlock && (L.gen !== seq.recGen || t < seq.recBlock.a || seqMediaSig(L.tgt, K) !== seq.recMedia)) seqStopRec(true);
  if (!seq.recBlock) {
    seq.recBefore ||= seqSnap();
    seq.recGen = L.gen; seq.recMedia = seqMediaSig(L.tgt, K);
    seq.recBlock = TL.cleanBlock({ track: seq.selTrack, a: t, b: t + TL.MIN_LEN, label: '', look: JSON.parse(JSON.stringify(L.tgt)), fin: 0, fout: 0, media: seqCaptureMedia(L.tgt, K), grade: seqGradeNow() });
    seq.recBlock.rec = true;
    seq.rec.blocks.push(seq.recBlock);
  }
  seq.recBlock.b = Math.max(seq.recBlock.a + TL.MIN_LEN, r1(t));
  // Slider moves during a look are kept: the block holds the look as it is when it ends
  if (L.gen === seq.recGen) { seq.recBlock.look = { ...L.tgt }; const g = seqGradeNow(); if (g) seq.recBlock.grade = g; else delete seq.recBlock.grade; }
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
  // The selected block's track grows taller while it has change lines, so they have room to edit
  const selBl = seq.rec.blocks.find((b) => b.id === seq.selId), tall = selBl && selBl.autos.length ? selBl.track : -1;
  seqLaneEls.forEach((l, i) => { l.classList.toggle('tall', i === tall); seqCards[i].classList.toggle('tall', i === tall); });
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
      // (a Mirror line is drawn as the steps it really takes)
      const linePts = (au) => {
        if (au.key !== 'mirror') return au.pts.map(([u, val]) => `${u * 100},${100 - val * 100}`).join(' ');
        // held flat, then straight up or down at each point
        const out = [], y = (v) => 100 - snapLine('mirror', v) * 100;
        au.pts.forEach(([u, v], i) => { if (i) out.push(`${u * 100},${y(au.pts[i - 1][1])}`); out.push(`${u * 100},${y(v)}`); });
        return out.join(' ');
      };
      // Many lines in one block: only one is in front (the one being edited: its points, clickable), the rest drawn
      // faintly behind it; in the selected block a faint line can be clicked to bring it to the front. The lines sit
      // a little inside the block, clear of its edges and handles, each with a wide invisible band along it to click.
      const sel = bl.id === seq.selId, act = seqLineAct(bl);
      const order = bl.autos.map((_, ai) => ai).sort((x, y) => (x === act) - (y === act));
      html += '<div class="lines"><svg class="auto" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + order.map((ai) => {
        const au = bl.autos[ai], front = sel && ai === act, pts = linePts(au);
        return `<polyline points="${pts}" fill="none" stroke="${seqLineColor(ai)}" stroke-width="${front ? 2 : 1.25}" stroke-opacity="${front ? 1 : sel ? 0.3 : 0.75}" vector-effect="non-scaling-stroke"/>` +
          (sel ? `<polyline class="hit" data-h="${front ? 'line' : 'lineact'}" data-a="${ai}" points="${pts}" fill="none" stroke="transparent" stroke-width="${front ? 14 : 8}" vector-effect="non-scaling-stroke"><title>${front ? '' : `Edit ${SEQ_NAME[au.key] || au.key}`}</title></polyline>` : '');
      }).join('') + '</svg>';
      if (sel && act >= 0) {
        const au = bl.autos[act], sp = seq.selPt && seq.selPt.id === bl.id && seq.selPt.ai === act ? seq.selPt.pi : -1;
        html += au.pts.map(([u, val], pi) => `<span class="dot${pi === sp ? ' sel' : ''}" data-h="pt" data-a="${act}" data-p="${pi}" title="${au.key === 'mirror' && pi > 0 ? `Mirror ${mirrorSnap(val * 8) || 'Off'} · ${ptFx(au, au.pts[pi])}${ptFx(au, au.pts[pi]) === 'cut' ? '' : ` over ${ptSecs(au, au.pts[pi])} s`} (click to change)` : SEQ_NAME[au.key] || au.key}" style="left:${u * 100}%;top:${100 - val * 100}%;background:${seqLineColor(act)}"></span>`).join('');
      }
      html += '</div>';
      if (w > 90 && !sel) html += `<span class="atag">${bl.autos.map((au) => SEQ_NAME[au.key] || au.key).join(' · ')}</span>`;
      if (w > 90 && sel && act >= 0) html += `<span class="atag">Editing <b style="color:${seqLineColor(act)}">${SEQ_NAME[bl.autos[act].key] || bl.autos[act].key}</b>${bl.autos.length > 1 ? ` · ${bl.autos.length - 1} more` : ''}</span>`;
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
  el.innerHTML = `<b>${escapeHTML(seqName(bl))}</b><button type="button" class="chip" data-editlook="1" title="Put this block's look on its loop to change it with the ordinary controls, then Save to block">Edit this look…</button><span>Track ${bl.track + 1} · loop ${KEYS[bl.track]} · ${escapeHTML(inputName(bl.look.in1))}</span><span>${fmtSeq(bl.a, true)} – ${fmtSeq(bl.b, true)} (${r1(bl.b - bl.a)} s)</span><span>Fade in ${r1(bl.fin)} s · fade out ${r1(bl.fout)} s</span>` +
    (bl.media ? `<span>${[bl.media.pic && `Picture: ${escapeHTML(bl.media.pic.name)}`, bl.media.vid && `Video: ${escapeHTML(bl.media.vid.name)}`, bl.media.gen && `Generative art: ${escapeHTML(bl.media.gen.name)}`].filter(Boolean).join(' · ')}</span>` : '') +
    (bl.autos.length ? `<span class="seq-lines">Editing ${bl.autos.map((au, i) => `<button type="button" class="chip" data-line="${i}" aria-pressed="${i === seqLineAct(bl)}" title="Bring ${SEQ_NAME[au.key] || au.key}’s line to the front to edit it"><span class="led" style="background:${seqLineColor(i)}"></span>${SEQ_NAME[au.key] || au.key}</button>`).join('')}</span>` : '<span>No changes over time · right-click to add one</span>');
  // Its Color grading
  {
    const g = bl.grade, parts = g ? Object.keys(GRADE_DEF).filter((k) => Number.isFinite(g[k]) && g[k] !== GRADE_DEF[k]).map((k) => `${SEQ_NAME[k]} ${gradeText(k, g[k])}`) : [];
    el.innerHTML += `<span class="seq-mfx">Color grading: ${parts.length ? escapeHTML(parts.join(' · ')) : 'none of its own (yours)'} ` +
      `<button type="button" class="chip" data-grade="now" title="This block keeps the Color grading you have on screen now">Use the grading on screen</button>` +
      (parts.length ? `<button type="button" class="chip" data-grade="none" title="This block has no grading of its own: it shows yours">None</button>` : '') + '</span>';
  }
  // How the block's mirror comes in when the block starts
  if ((+bl.look.mirror || 0) > 0 || bl.autos.some((au) => au.key === 'mirror')) {
    const [fx, secs] = bl.mxIn || ['cut', 3];
    el.innerHTML += `<span class="seq-mfx">At the start its mirror comes in with ` +
      ['cut', 'melt', 'iris', 'ripple'].map((f) => `<button type="button" class="chip" data-sfx="${f}" aria-pressed="${fx === f}" title="${f === 'cut' ? 'There straight away' : `A ${f} from the mirror before`}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('') +
      (fx === 'cut' ? '' : ' over ' + [1, 3, 6, 10].map((n) => `<button type="button" class="chip" data-ssecs="${n}" aria-pressed="${Math.abs(secs - n) < 0.01}">${n} s</button>`).join('')) + '</span>';
  }
  // The Mirror line in front: the change leading to the picked point, its own Transition and time
  const mi = seqLineAct(bl);
  if (mi >= 0 && bl.autos[mi].key === 'mirror') {
    const mau = bl.autos[mi], sp = seq.selPt && seq.selPt.id === bl.id && seq.selPt.ai === mi && seq.selPt.pi > 0 && seq.selPt.pi < mau.pts.length ? mau.pts[seq.selPt.pi] : null;
    if (!sp) el.innerHTML += '<span class="seq-mfx">Click a point on the Mirror line to pick how the change up to it comes in.</span>';
    else {
      const fx = ptFx(mau, sp), secs = ptSecs(mau, sp), at = fmtSeq(bl.a + sp[0] * (bl.b - bl.a), true);
      el.innerHTML += `<span class="seq-mfx">The change to Mirror ${mirrorSnap(sp[1] * 8) || 'Off'} (at ${at}) comes in with ` +
        ['cut', 'melt', 'iris', 'ripple'].map((f) => `<button type="button" class="chip" data-mfx="${f}" aria-pressed="${fx === f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('') +
        (fx === 'cut' ? '' : ' over ' + [1, 3, 6, 10].map((n) => `<button type="button" class="chip" data-msecs="${n}" aria-pressed="${Math.abs(secs - n) < 0.01}">${n} s</button>`).join('')) + '</span>';
    }
  }
}
// Which change line is in front (being edited), picked in the block's details
$('#seqInsp').addEventListener('click', (e) => {
  const b = e.target.closest('[data-line]'), bl = b && seq.rec.blocks.find((x) => x.id === seq.selId);
  if (!bl) return;
  seqSetLineAct(bl, +b.dataset.line);
  seqNote(`Editing ${SEQ_NAME[bl.autos[+b.dataset.line].key] || bl.autos[+b.dataset.line].key}: drag its points, double-click to add one.`);
});
// Edit this look…, from the block's details
$('#seqInsp').addEventListener('click', (e) => {
  const bl = e.target.closest('[data-editlook]') && seq.rec.blocks.find((x) => x.id === seq.selId);
  if (bl) seqEditStart(bl);
});
// The block's Color grading, from its details
$('#seqInsp').addEventListener('click', (e) => {
  const b = e.target.closest('[data-grade]'), bl = b && seq.rec.blocks.find((x) => x.id === seq.selId);
  if (!bl) return;
  const g = b.dataset.grade === 'now' ? seqGradeNow() : undefined;
  seqChange(() => { if (g) bl.grade = g; else delete bl.grade; });
  seq.applied = [null, null, null, null];
  seqInspector();
  seqNote(g ? 'This block keeps the Color grading on screen now.' : b.dataset.grade === 'now' ? 'There’s no Color grading on screen, so this block has none of its own.' : 'This block has no Color grading of its own now: it shows yours.');
});
// How the block's mirror comes in at its start, picked in its details
$('#seqInsp').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sfx], [data-ssecs]'), bl = b && seq.rec.blocks.find((x) => x.id === seq.selId);
  if (!bl) return;
  seqChange(() => {
    const [fx0, secs0] = bl.mxIn || ['cut', 3];
    const fx = b.dataset.sfx || fx0, secs = b.dataset.ssecs ? +b.dataset.ssecs : secs0;
    if (fx === 'cut') delete bl.mxIn; else bl.mxIn = [fx, secs];
  });
  seqInspector();
  seqNote(bl.mxIn ? `At its start, this block’s mirror comes in with ${bl.mxIn[0][0].toUpperCase() + bl.mxIn[0].slice(1)} over ${bl.mxIn[1]} s.` : 'At its start, this block’s mirror is there straight away.');
});
// The picked Mirror point's Transition and time, picked in the block's details
$('#seqInsp').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mfx], [data-msecs]'), P = seq.selPt;
  const bl = b && P && seq.rec.blocks.find((x) => x.id === P.id), au = bl && bl.autos[P.ai], pt = au && au.key === 'mirror' && au.pts[P.pi];
  if (!pt) return;
  seqChange(() => {
    const fx = b.dataset.mfx || ptFx(au, pt), secs = b.dataset.msecs ? +b.dataset.msecs : ptSecs(au, pt);
    au.pts[P.pi] = [pt[0], pt[1], fx, secs];
  });
  seqInspector();
  const np = au.pts[P.pi];
  seqNote(np[2] === 'cut' ? 'That mirror change cuts straight in.' : `That mirror change comes in with ${np[2][0].toUpperCase() + np[2].slice(1)} over ${np[3]} s.`);
});
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
const seqTrackAtY = (y) => {
  for (let i = 0; i < seqLaneEls.length; i++) if (y < seqLaneEls[i].getBoundingClientRect().bottom + 2) return i;
  return TL.TRACKS - 1;
};
const seqBlock = (id) => seq.rec.blocks.find((b) => b.id === id);
seqView.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  seqCloseCtx();
  const blkEl = e.target.closest('.seq-blk'), mkEl = e.target.closest('.seq-mk');
  if (mkEl && e.target.tagName === 'INPUT') return;
  const d = { x: e.clientX, y: e.clientY, start: seq.view.start, moved: false, before: seqSnap() };
  // A second press within half a second and a few pixels of the first, on the same block (not on a point): a double-click
  const now = performance.now(), last = seq.lastPress;
  seq.lastPress = { t: now, x: e.clientX, y: e.clientY, id: blkEl ? blkEl.dataset.id : '' };
  if (blkEl && last && last.id === blkEl.dataset.id && now - last.t < 500 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8 && e.target.dataset.h !== 'pt') {
    const bl = seqBlock(blkEl.dataset.id);
    seq.lastPress = null;
    if (bl && !bl.rec) { seqAddPointAt(bl, e.clientX, e.clientY); return; }
  }
  if (blkEl) {
    const bl = seqBlock(blkEl.dataset.id); if (!bl || bl.rec) return;
    d.kind = e.target.dataset.h || 'move'; d.bl = bl; d.orig = JSON.parse(JSON.stringify(bl));
    const lr = (blkEl.querySelector('.lines') || blkEl).getBoundingClientRect();
    if (d.kind === 'pt') { d.w = lr.width; d.h = lr.height; d.ai = +e.target.dataset.a; d.pi = +e.target.dataset.p; seq.selPt = { id: bl.id, ai: d.ai, pi: d.pi }; }
    else if (d.kind === 'lineact') { seqSetLineAct(bl, +e.target.dataset.a); d.kind = 'sel'; }
    else if (d.kind === 'line') {
      // A click on a line: on a Mirror line it picks the change there (the point the line is heading for)
      const ai = +e.target.dataset.a, au = bl.autos[ai], u = clamp((e.clientX - lr.left) / lr.width, 0, 1);
      if (au && au.key === 'mirror' && au.pts.length > 1) {
        let best = 1;
        for (let i = 1; i < au.pts.length; i++) if (Math.abs(au.pts[i][0] - u) < Math.abs(au.pts[best][0] - u)) best = i;
        seq.selPt = { id: bl.id, ai, pi: best };
      }
      d.kind = 'sel';
    }
    else if (!seq.selPt || seq.selPt.id !== bl.id) seq.selPt = null;
    seq.selId = bl.id; seqSelectTrack(bl.track); seq.dirty = true;
  } else if (mkEl) {
    d.kind = 'marker'; d.m = seq.rec.markers.find((m) => m.id === mkEl.dataset.id); d.orig = { t: d.m.t };
  } else d.kind = 'pan';
  seq.drag = d;
  seqView.setPointerCapture(e.pointerId);
});
// Snapping: a block's ends, dragged (moving the block or resizing it), snap to the ends of every other block, on any
// track, and to the playhead, markers and the song's start, within a few pixels; a dashed line shows where. Alt drags
// freely.
const SEQ_SNAP_PX = 10;
function seqSnapTo(edges, skip, e) {
  if (e.altKey) return null;
  const lim = SEQ_SNAP_PX / seq.view.pps, ts = [0, seq.t, ...seq.rec.markers.map((m) => m.t)];
  for (const b of seq.rec.blocks) if (b !== skip) ts.push(b.a, b.b);
  let best = null;
  for (const t of ts) edges.forEach((x, i) => { const by = t - x; if (Math.abs(by) <= lim && (!best || Math.abs(by) < Math.abs(best.by))) best = { by, at: t, i }; });
  return best;
}
function seqSnapLine(at) {
  const el = $('#seqSnapLine');
  el.hidden = at == null;
  if (at != null) el.style.left = seqX(at) + 'px';
}
seqView.addEventListener('pointermove', (e) => {
  const d = seq.drag; if (!d) return;
  const dx = e.clientX - d.x;
  if (!d.moved && Math.abs(dx) < 4 && Math.abs(e.clientY - d.y) < 4) return;
  d.moved = true;
  const pps = seq.view.pps, dt = dx / pps, o = d.orig, bl = d.bl, dur = seqDur();
  if (d.kind === 'pan') { seqView.classList.add('dragging'); seq.view.start = d.start - dt; }
  else if (d.kind === 'marker') d.m.t = r1(clamp(o.t + dt, 0, dur));
  else if (d.kind === 'move') {
    const len = o.b - o.a, a = clamp(o.a + dt, 0, Math.max(0, dur - len)), sn = seqSnapTo([a, a + len], bl, e);
    bl.a = sn ? clamp(sn.i === 0 ? sn.at : sn.at - len, 0, Math.max(0, dur - len)) : r1(a); bl.b = bl.a + len;
    // (it changes track only once the pointer has gone up or down a little: pressing it can change the lanes' heights)
    bl.track = Math.abs(e.clientY - d.y) < 16 ? o.track : seqTrackAtY(e.clientY);
    seqSnapLine(sn ? sn.at : null);
  } else if (d.kind === 'l') {
    const a = clamp(o.a + dt, 0, o.b - TL.MIN_LEN), sn = seqSnapTo([a], bl, e);
    bl.a = sn && sn.at <= o.b - TL.MIN_LEN ? sn.at : r1(a); seqSnapLine(sn && sn.at <= o.b - TL.MIN_LEN ? sn.at : null);
  } else if (d.kind === 'r') {
    const b = clamp(o.b + dt, o.a + TL.MIN_LEN, dur), sn = seqSnapTo([b], bl, e);
    bl.b = sn && sn.at >= o.a + TL.MIN_LEN ? sn.at : r1(b); seqSnapLine(sn && sn.at >= o.a + TL.MIN_LEN ? sn.at : null);
  }
  else if (d.kind === 'fin') bl.fin = r1(clamp(o.fin + dt, 0, bl.b - bl.a - bl.fout));
  else if (d.kind === 'fout') bl.fout = r1(clamp(o.fout - dt, 0, bl.b - bl.a - bl.fin));
  else if (d.kind === 'pt') {
    const pts = bl.autos[d.ai].pts, [u0, v0] = o.autos[d.ai].pts[d.pi], i = d.pi;
    const lo = i === 0 ? 0 : pts[i - 1][0], hi = i === pts.length - 1 ? 1 : pts[i + 1][0];
    const u = i === 0 ? 0 : i === pts.length - 1 ? 1 : clamp(u0 + dx / d.w, lo, hi);
    pts[i] = [u, snapLine(bl.autos[d.ai].key, clamp(v0 - (e.clientY - d.y) / d.h, 0, 1)), ...pts[i].slice(2)];
  }
  if (bl) { const len = bl.b - bl.a; bl.fin = Math.min(bl.fin, len); bl.fout = Math.min(bl.fout, len - bl.fin); }
  seq.dirty = true;
});
seqView.addEventListener('pointerup', (e) => {
  const d = seq.drag; if (!d) return;
  seq.drag = null; seqView.classList.remove('dragging');
  seqSnapLine(null);
  if (d.kind === 'pan' && !d.moved) {
    seq.selId = null; seq.dirty = true;
    seqSeek(seq.view.start + (e.clientX - seqView.getBoundingClientRect().left) / seq.view.pps);
  } else if (d.moved && d.kind !== 'pan') {
    if (d.bl) { seq.rec.blocks = seq.rec.blocks.map((b) => (b === d.bl ? TL.cleanBlock(b) : b)); seq.selId = d.bl.id; seqSelectTrack(d.bl.track); }
    seqCommit(d.before);
  }
});
seqView.addEventListener('pointercancel', () => { seqSnapLine(null); const d = seq.drag; if (d && d.kind !== 'pan') { seqRestore(d.before); seq.dirty = true; } seq.drag = null; });
// Double-click a block to add a point to its newest change line; a marker to rename it
// Double-clicking a marker renames it. Double-clicking a block adds a point there: that one is counted here, from two
// presses close together in time and place on the same block (see seqView's pointerdown), not left to the browser,
// which doesn't count a double-click when the block was redrawn between the two clicks, as it is on a fast computer.
seqView.addEventListener('dblclick', (e) => {
  const mkEl = (document.elementFromPoint(e.clientX, e.clientY) || e.target).closest('.seq-mk');
  if (mkEl) seqRenameMarker(mkEl);
});
// A point added on the line in front of block bl, where the pointer is (x, y on screen)
function seqAddPointAt(bl, x, y) {
  const el = seqLanes.querySelector(`.seq-blk[data-id="${CSS.escape(bl.id)}"]`);
  if (!el) return;
  if (!bl.autos.length) { seqNote('Right-click the block and pick Change over time first.'); return; }
  const r = (el.querySelector('.lines') || el).getBoundingClientRect(), u = clamp((x - r.left) / r.width, 0.01, 0.99), val = clamp(1 - (y - r.top) / r.height, 0, 1);
  const ai = seqLineAct(bl), au = bl.autos[ai];
  const np = [u, snapLine(au.key, val)];
  // A new Mirror change comes in the way the change before it did (or the line's way)
  if (au.key === 'mirror') { const was = mirrorPoint(au, u); np.push(ptFx(au, was), ptSecs(au, was)); }
  seqChange(() => { au.pts.push(np); au.pts.sort((p, q) => p[0] - q[0]); });
  seq.selPt = { id: bl.id, ai, pi: au.pts.indexOf(np) };
  seq.dirty = true;
  seqInspector();
  seqNote(au.key === 'mirror' ? `Added a Mirror change at ${fmtSeq(bl.a + u * (bl.b - bl.a), true)}. Drag it up or down for the mirror, left or right for when.`
    : `Added a point to ${SEQ_NAME[au.key] || au.key}. Drag it to set the value.`);
}
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
            const [lo, hi] = seqRange(key), cur = key === 'show' ? 100 : key === 'feed' ? 0 : key in GRADE_DEF ? GRADE_DEF[key] : key in RELIEF_DEF ? relief[key] : SEQ_TYPE.includes(key) ? (seq.typeBase ? seq.typeBase[key] : typeArt[key]) : bl.look[key] ?? loopDefaults()[key] ?? lo;
            const v = clamp((cur - lo) / ((hi - lo) || 1), 0, 1);
            bl.autos.push({ key, pts: [[0, v], [1, v]], ...(key === 'mirror' ? { fx: bl.look.mirrorFx in MIRROR_FX && bl.look.mirrorFx !== 'cut' ? bl.look.mirrorFx : 'melt', secs: MIRROR_SECS } : {}) });
            seq.lineAct = { id: bl.id, ai: bl.autos.length - 1 };
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
      { label: 'Edit this look…', run: () => seqEditStart(bl) },
      '-',
      { label: 'Copy', key: 'Ctrl+C', run: () => seqCopy(bl) },
      { label: 'Paste here', key: 'Ctrl+V', disabled: !seq.clip, run: () => seqPaste(bl.track, t) },
      '-',
      { label: 'Rename…', run: () => seqAsk(e.clientX, e.clientY, 'Name this block', bl.label || '', seqName(bl), (name) => {
        seqChange(() => { bl.label = name; }); seqNote(name ? `Renamed to “${name}”.` : 'Name cleared; the block shows what its loop shows.');
      }) },
      { label: 'Save to My presets…', run: () => seqAsk(e.clientX, e.clientY, 'Save this look as', bl.label || '', nextPresetName(), (name) => seqSaveLook(bl, name || nextPresetName())) },
      '-',
      { label: `Change over time…${bl.autos.length ? ` (${bl.autos.length})` : ''}`, run: () => seqPickSlider(bl, e.clientX, e.clientY) },
      ...(bl.autos.length ? [{ label: `Add a point here (${SEQ_NAME[bl.autos[seqLineAct(bl)].key] || bl.autos[seqLineAct(bl)].key})`, key: 'Double-click', run: () => seqAddPointAt(bl, e.clientX, e.clientY) }] : []),
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
  else if (!mod && !e.altKey && k === 'home') { e.preventDefault(); void seqFromStart(); }
});

/* ---------- adding looks, markers ---------- */
// withMedia: true keeps the picture or video the inputs hold now; an object is the block's own media. len: how long
// the block plays (16 seconds unless said)
// The Color grading a block keeps: the grading on screen (or a saved look's), when there is any
function seqGradeNow(g = grade) {
  const out = {};
  for (const k of Object.keys(GRADE_DEF)) if (Number.isFinite(g?.[k])) out[k] = g[k];
  return Object.keys(GRADE_DEF).some((k) => out[k] !== undefined && out[k] !== GRADE_DEF[k]) ? out : undefined;
}
// gradeFrom: whose Color grading the block keeps (a saved look's); the grading on screen unless said
function seqPlace(label, look, withMedia, len = 16, gradeFrom) {
  const dur = seqDur(), a = r1(clamp(seq.t, 0, dur)), b = r1(Math.min(dur, a + Math.max(TL.MIN_LEN, len)));
  if (b - a < TL.MIN_LEN) { seqNote('Move the playhead before the end of the song first.'); return; }
  const media = withMedia && typeof withMedia === 'object' ? withMedia : withMedia ? seqCaptureMedia(look, KEYS[seq.selTrack]) : null;
  const nb = TL.cleanBlock({ track: seq.selTrack, a, b, label, look: JSON.parse(JSON.stringify(look)), media, grade: seqGradeNow(gradeFrom || grade) });
  seqChange(() => seq.rec.blocks.push(nb)); seq.selId = nb.id;
  seqNote(`Added “${seqName(nb)}” to track ${seq.selTrack + 1} at ${fmtSeq(a, true)}. Drag its ends to change how long it plays.`);
}
$('#seqAddCurrent').addEventListener('click', () => {
  const K = KEYS[seq.selTrack];
  seqPlace('', loopOn(K) ? loops[K].tgt : loops[edit].tgt, true);
});
// + Add clip…: opens the clip explorer (search, tags) to pick a clip for the chosen track. The block plays that
// clip from its start as the Video input and lasts as long as the clip (at least 4 seconds). With its effects, the
// block's look is the loop that played the clip in the picture saved with it; just the clip, it's the track's loop
// as it looks now with Video as its main input (unless it already uses Video).
function seqPlaceClip(c, look) {
  const K = KEYS[seq.selTrack];
  let base;
  if (look) {
    const from = (Array.isArray(look.vid) && look.vid.find((k) => look[k])) || ['A', 'B', 'C', 'D'].find((k) => usesIn(look[k], 'video')) || 'A';
    base = JSON.parse(JSON.stringify(look[from] || {}));
  } else base = JSON.parse(JSON.stringify(loopOn(K) ? loops[K].tgt : loops[edit].tgt));
  if (!usesIn(base, 'video')) { base.in1 = 'video'; base.size = 100; delete base.asInput; }
  const len = Math.max(4, Math.round((c.d || 16) * 10) / 10);
  seqPlace(look ? `${c.n} (with its effects)`.slice(0, 80) : c.n, base, { vid: { kind: 'clip', id: c.id, name: c.n, at: 0 } }, len);
}
// Add with its whole look: the picture saved with the clip, spread over the tracks. Every loop the look used (shown,
// or feeding or feeding into one that is) gets a block on its own track at the playhead, all as long as the clip, each
// with that loop's saved look; the ones that played the Video play the clip. The look's Show and feed faders, its
// Color grading and its 3D lighting go into each block as steady automation.
function seqPlaceWhole(c, look) {
  const n = look.n === 3 || look.n === 4 ? look.n : 2;
  const keys = ['A', 'B', 'C', 'D'].slice(0, n).filter((k) => look[k]);
  const m = look.mix || {};
  const showOf = (k) => (Number.isFinite(m[SHOW[k]]) ? m[SHOW[k]] : k === 'B' ? 0 : 100);
  const feedOut = (k) => (Number.isFinite(m[FEED_INTO[otherLoop(k)]]) ? m[FEED_INTO[otherLoop(k)]] : 0);
  const readsOtherLoop = (k) => keys.some((j) => j !== k && otherLoop(j) === k && usesIn(look[j], 'loop') && showOf(j) > 0.5);
  const used = keys.filter((k) => showOf(k) > 0.5 || (feedOut(k) > 0.5 && showOf(otherLoop(k)) > 0.5) || readsOtherLoop(k));
  if (!used.length) { seqNote('That clip’s saved look shows nothing on screen, so there’s nothing to add.'); return; }
  const dur = seqDur(), a = r1(clamp(seq.t, 0, dur)), b = r1(Math.min(dur, a + Math.max(4, Math.round((c.d || 16) * 10) / 10)));
  if (b - a < TL.MIN_LEN) { seqNote('Move the playhead before the end of the song first.'); return; }
  const steady = (key, v) => { const [lo, hi] = seqRange(key); return { key, pts: [[0, clamp((v - lo) / ((hi - lo) || 1), 0, 1)], [1, clamp((v - lo) / ((hi - lo) || 1), 0, 1)]] }; };
  const g = look.grade || {};
  const gradeAutos = Object.keys(GRADE_DEF).filter((k) => Number.isFinite(g[k]) && g[k] !== GRADE_DEF[k]).map((k) => steady(k, g[k]));
  // Its 3D lighting too, when it had any (the depth is what turns it on)
  const rl = look.relief || {};
  if (Number.isFinite(rl.rDepth) && rl.rDepth > 0) gradeAutos.push(...Object.keys(RELIEF_DEF).filter((k) => Number.isFinite(rl[k])).map((k) => steady(k, rl[k])));
  const made = used.map((k) => TL.cleanBlock({
    track: KEYS.indexOf(k), a, b, label: `${c.n} (${k})`.slice(0, 80), look: JSON.parse(JSON.stringify(look[k])),
    media: usesIn(look[k], 'video') ? { vid: { kind: 'clip', id: c.id, name: c.n, at: 0 } } : null,
    autos: [steady('show', showOf(k)), steady('feed', feedOut(k)), ...gradeAutos],
  })).filter(Boolean);
  seqChange(() => seq.rec.blocks.push(...made));
  seq.selId = made[0] ? made[0].id : null;
  seqNote(`Added “${c.n}” with its whole look: ${made.length} block${made.length === 1 ? '' : 's'}, on ${used.map((k) => `track ${KEYS.indexOf(k) + 1}`).join(', ')} at ${fmtSeq(a, true)}.`);
}
// Add the recording: a recording of the settings (look.moves), laid out on the tracks from the playhead. Each loop gets
// blocks on its own track; a new block starts wherever the loop's inputs (or another switch) changed, and every
// fader that moved inside a block becomes one of its change lines, as do Show, feed, Color grading and 3D lighting.
// (A block holds up to 32 change lines of up to 64 points; past that the busiest ones are kept, smoothed.)
function seqPlaceMoves(c, look) {
  const M = PhosphorMoves, mv = look.moves, start = { ...look };
  delete start.moves;
  const P = new M.Player(start, mv);
  const dur = seqDur(), a0 = r1(clamp(seq.t, 0, dur)), len = Math.min(mv.dur, dur - a0);
  if (len < TL.MIN_LEN) { seqNote('Move the playhead before the end of the song first.'); return; }
  const at = (t) => P.lookAt(t), flat = new Map();
  const num = (path, t, dflt) => { if (!flat.has(t)) flat.set(t, M.flatten(at(t))); const v = flat.get(t)[path]; return Number.isFinite(v) ? v : dflt; };
  // The number a change line follows, for one loop: [path in the recording, change-line key]
  const linesFor = (k) => {
    const out = [[`mix.${SHOW[k]}`, 'show'], [`mix.${FEED_INTO[otherLoop(k)]}`, 'feed']];
    for (const key of Object.keys(SEQ_NAME)) if (key !== 'show' && key !== 'feed' && !(key in GRADE_DEF) && !(key in RELIEF_DEF)) out.push([`${k}.${key}`, key]);
    for (const key of Object.keys(GRADE_DEF)) out.push([`grade.${key}`, key]);
    for (const key of Object.keys(RELIEF_DEF)) out.push([`relief.${key}`, key]);
    for (const key of SEQ_TYPE) out.push([`type.${key}`, key]);
    return out;
  };
  const made = [];
  for (const k of KEYS) {
    // Where this loop's blocks start: the beginning, and each change to its switches (or the number of loops,
    // or the picture or clip in), at least half a second apart
    const cuts = [0];
    for (const [cs, path] of mv.ev) {
      const g = path.split('.')[0], t = cs / 100;
      if ((g === k || g === 'n' || g === 'media') && t < len - TL.MIN_LEN && t - cuts[cuts.length - 1] >= TL.MIN_LEN) cuts.push(t);
    }
    for (let i = 0; i < cuts.length; i++) {
      const s0 = cuts[i], e0 = i + 1 < cuts.length ? cuts[i + 1] : len;
      const L0 = at(s0 + 0.001), lk = L0[k];
      if (!lk || (L0.n || 2) < LOOP_NUM[k] + 1) continue;
      // Shown (or feeding one that is, or read by another loop) somewhere in the stretch, or it isn't worth a block
      const showAt = (t) => num(`mix.${SHOW[k]}`, t, k === 'B' ? 0 : 100);
      const samples = [s0, (s0 + e0) / 2, e0 - 0.01];
      const showMax = Math.max(...samples.map(showAt), ...(mv.tr[`mix.${SHOW[k]}`] || []).filter((_, j) => j % 2 === 1));
      const feedMax = Math.max(...samples.map((t) => num(`mix.${FEED_INTO[otherLoop(k)]}`, t, 0)));
      const readBy = KEYS.some((j) => j !== k && L0[j] && otherLoop(j) === k && usesIn(L0[j], 'loop'));
      if (showMax <= 0.5 && feedMax <= 0.5 && !readBy) continue;
      const autos = [];
      for (const [path, key] of linesFor(k)) {
        const [lo, hi] = seqRange(key), norm = (v) => clamp((v - lo) / ((hi - lo) || 1), 0, 1);
        const tr = mv.tr[path] || [], base = num(path, s0 + 0.001, undefined);
        if (base === undefined) continue;
        // The line: its value at the block's start and end, and the recording's own points in between
        const pts = [0, norm(base)];
        for (let j = 0; j < tr.length; j += 2) { const t = tr[j] / 100; if (t > s0 && t < e0) pts.push((t - s0) / (e0 - s0), norm(tr[j + 1])); }
        pts.push(1, norm(num(path, e0 - 0.001, base)));
        let lo2 = Infinity, hi2 = -Infinity;
        for (let j = 1; j < pts.length; j += 2) { lo2 = Math.min(lo2, pts[j]); hi2 = Math.max(hi2, pts[j]); }
        const moves = hi2 - lo2 > 0.002;
        // Steady lines only where the block needs them: its Show and feed, and grading or lighting away from normal
        const steadyNeeded = key === 'show' || key === 'feed' || (key in GRADE_DEF && base !== GRADE_DEF[key]) || (key in RELIEF_DEF && num('relief.rDepth', s0 + 0.001, 0) > 0) || (SEQ_TYPE.includes(key) && num('type.tAmt', s0 + 0.001, 0) > 0);
        if (!moves && !steadyNeeded) continue;
        let thin = moves ? M.simplify(pts) : [0, pts[1], 1, pts[1]];
        // At most 64 points: evenly picked from the thinned line
        if (thin.length > 128) { const n = thin.length / 2, out = []; for (let q = 0; q < 64; q++) { const j = Math.round(q * (n - 1) / 63); out.push(thin[j * 2], thin[j * 2 + 1]); } thin = out; }
        const line = [];
        for (let j = 0; j < thin.length; j += 2) line.push([thin[j], thin[j + 1]]);
        autos.push({ key, pts: line, spread: hi2 - lo2, keep: key === 'show' || key === 'feed' });
      }
      autos.sort((x, y) => (y.keep - x.keep) || (y.spread - x.spread));
      let media = null;
      try {
        const m = L0.media ? JSON.parse(L0.media) : null;
        if (m && m.vid && usesIn(lk, 'video')) media = { vid: { ...m.vid, at: m.vid.id === JSON.parse(start.media || '{}').vid?.id ? r1((start.mediaAt || 0) + s0) : 0 } };
        else if (m && m.pic && usesIn(lk, 'picture')) media = { pic: m.pic };
      } catch (_) { media = null; }
      const bl = TL.cleanBlock({ track: KEYS.indexOf(k), a: a0 + s0, b: a0 + e0, label: `${c.n} (${k})`.slice(0, 80), look: JSON.parse(JSON.stringify(lk)),
        fin: 0, fout: 0, media, autos: autos.slice(0, 32).map(({ key, pts }) => ({ key, pts })) });
      if (bl) made.push(bl);
    }
  }
  if (!made.length) { seqNote('That recording shows nothing on screen, so there’s nothing to add.'); return; }
  seqChange(() => seq.rec.blocks.push(...made));
  seq.selId = made[0].id;
  const tracks = [...new Set(made.map((b) => b.track + 1))];
  seqNote(`Added the recording “${c.n}”: ${made.length} block${made.length === 1 ? '' : 's'} with their changes over time, on track${tracks.length === 1 ? '' : 's'} ${tracks.join(', ')} from ${fmtSeq(a0, true)}.`);
}
$('#seqAddClip').addEventListener('click', () => { seqCloseMenus(); openClips('seq'); });
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
      any = true; seqMenuItem(menu, p.name, () => seqPlace(p.name, look, false, 16, p.data?.grade || GRADE_DEF));
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
window.__plSeq = { hand, handLetGo: () => handLetGo(), get rec() { return seq.rec; }, get editing() { return seq.editing ? seq.editing.id : null; }, edit: (id) => seqEditStart(seq.rec.blocks.find((b) => b.id === id)), set preloadSecs(v) { seq.preloadSecs = v; }, get t() { return seq.t; }, reliefNow: () => reliefNow(), get running() { return seq.running; },
  spotify, pos: (now) => seqPos(now), follow: (song) => { seq.song = song; }, seek: (t) => seqSeek(t),
  select: (id) => { seq.selId = id; seq.dirty = true; seqInspector(); }, redraw: () => seqDrawStatic() };   // for tests/snips_check.py
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
    seq.applied = [null, null, null, null]; seq.jumped = true;
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
  if (ap.on && !frozen && now >= ap.next && !cueActive()) apTick(now);
  followSliders();
  if (lookOnScreen !== ratedLook) syncRated();
  if (!frozen) simT += dt;
  staticAmt = Math.max(0, staticAmt - dt * 3);
  calmK += ((streamCalm ? 1 : 0) - calmK) * (1 - Math.exp(-dt * 0.8));

  for (const name of ['camera', 'screen', 'phone']) { const s = LIVE_SRC[name]; if (s.video && uses(name)) s.update(subjectModes(name)); }
  genTick();
  // Each video player that a loop on screen shows, with the Subject silhouette looks of the loops showing it
  for (const s of Object.values(vids)) {
    if (!s.video) continue;
    let shown = false;
    const modes = new Set();
    for (const k of activeKeys()) {
      if (!loopUsesVid(k) || vidFor(k) !== s) continue;
      shown = true;
      if (subjectOn(loops[k].tgt)) modes.add(loops[k].tgt.subject);
    }
    if (shown) s.update(modes);
  }
  syncSubjectStatus();
  mvRecTick(now);
  exTick(now);
  movesTick(now);
  typeTick(now);
  vcrTick();
  packAdj();
  analyzeSound(dt, now);
  sndLinesTick(dt);
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
      if (frozen || !(uses(name) || extraUses(name))) continue;
      const step = dt * sc.speed * pace * (1 + (sceneReacts(name) ? surge - 1 : 0) * (sc.kick ?? 1));
      sc.z = (sc.z + step) % sc.period;
      // A fractal's wandering cameras fly on, each loop's only while that loop shows it
      if (sc.fly) for (const k of extraKeys()) if (loops[k].tgt.in1 === name || loops[k].tgt.in2 === name) droneOf(sc, k).fly(step, { style: 'glide', drive: 0 });
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
    for (const key of act) if (need[key]) { runLoop(key, clamp(mix.cur[FEED_INTO[key]], 0, 100) / 100, W[key] > 0.01 ? brush : null, f); typeInLoop(key, f); }
    // Cue mode's scout: the spare loop where new looks are tried out of sight
    if (cue.scout && loops.C.rt) { mirrorStep('C', dt); runLoop('C', 0, null, f); cueCapture(performance.now()); }
    // ... and the live previews' small loops, and the previews' moving pictures
    if (cue.scout) cueMinis(dt, f);
    cuePlay(performance.now());
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
  // Type art set to Final Pass types the finished picture, shapes and all
  const finalTex = typeFinal(shown.tex);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(dispProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, finalTex);
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
  if (calmK > 0.001) { const q = 1 - 0.7 * calmK; flash *= q; hueKick *= q; shake *= q; punch *= 1 - 0.4 * calmK; }
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
  // The stream app's Stream-friendly switch (see streamCalm)
  streamFriendly(on) { streamCalm = !!on; return streamCalm; },
  get calm() { return { on: streamCalm, amount: calmK }; },
};
})();
