'use strict';
// The Effect stack (see "effect stack" in js/app.js): each loop's effects in a list you put in order, in three zones:
//   in    Inside the loop: works on what the loop keeps, so it builds up frame after frame
//   out   On the way out: laid over the loop's picture once (what Final Pass used to be)
//   all   Whole picture: over every loop mixed together (shared by all loops)
// Most effects are the loop's own faders (zoom, melt and the rest, kept in the loop's settings as always), so
// Autopilot, presets, pins and the sequencer go on working with them; the stack adds their order, where they work,
// an on/off switch and movers. Patch's effects, colors and patterns can be added too, as many as you like.
window.PhosphorStack = (() => {
const PP = window.PhosphorPatch;
// Each of the loop's own effects: label, the faders it is made of (keys of the loop's settings), the control rows
// that go into its card (ids of a slider or element inside each row), where it may work, and the switch it had in
// Classic (fx: see FINAL_FX in js/app.js). first: needs the loop's own past frames, so it always comes first on the way out.
const L = (label, keys, zones, extra) => ({ label, keys, ctl: keys, zones, ...extra });
const IN = ['in'], IO = ['in', 'out'];
const LOOP_KINDS = {
  mirror:   L('Mirror', [], IO, { fx: 'mirror', ctl: ['mirror'], start: { mirror: 4 } }),
  zoom:     L('Zoom & spin', ['zoom', 'spin'], IN, { start: { zoom: 25 }, any: true }),
  julia:    L('Fractal fold', ['julia'], IN),
  crystal:  L('Crystal', ['crystal'], IN),
  flow:     L('Flow', ['flow'], IN),
  warp:     L('Warp', ['warp'], IO, { fx: 'warp' }),
  wind:     L('Wind', ['wind'], IN),
  melt:     L('Melt', ['melt'], IN),
  push:     L('Pushed by', ['push'], IN),
  lookup:   L('Look-up', ['lookup'], IN),
  split:    L('Split lines', ['split'], IO, { fx: 'split' }),
  offc:     L('Off-center', ['offc'], IN),
  chase:    L('Chase', ['chase'], IN),
  breathe:  L('Breathe', ['breathe'], IN),
  chroma:   L('Color chase', ['chroma'], IO, { fx: 'chroma' }),
  restless: L('Restless', ['restless'], IN),
  grow:     L('Grow', ['grow'], IN),
  dye:      L('Dyed by', ['dye'], IN),
  color:    L('Color shift', ['color'], IN, { start: { color: 30 } }),
  poster:   L('Posterize', ['poster'], ['out', 'in'], { fx: 'poster', start: { poster: 40 } }),
  halftone: L('Halftone', ['halftone'], ['out', 'in'], { fx: 'halftone', start: { halftone: 40 } }),
  aberr:    L('Chromatic aberration', ['aberr'], ['out', 'in'], { fx: 'aberr', start: { aberr: 35 } }),
  time:     L('Time warp', ['time'], ['out'], { first: true, start: { time: 50 } }),
  scan:     L('Photo finish', ['scan'], ['out'], { first: true, start: { scan: 70 } }),
  corr:     L('Corridor', ['corr'], ['out'], { first: true, start: { corr: 70 } }),
};
// Whole-picture effects: one setting shared by every loop (Color grading and Type art can also work inside chosen loops)
const WHOLE_KINDS = {
  grade:  { label: 'Color grading', zones: ['in', 'all'], group: 'gradeGroup' },
  relief: { label: '3D lighting', zones: ['all'], group: 'reliefGroup' },
  type:   { label: 'Type art', zones: ['in', 'all'], group: 'typeGroup' },
  cloud:  { label: 'Point cloud', zones: ['all'], group: 'cloudGroup' },
};
// The order the loop's own effects worked in before (Classic). New ones slot in by it.
const CLASSIC = Object.keys(LOOP_KINDS);
function labelOf(k) { return (LOOP_KINDS[k] || WHOLE_KINDS[k] || PATCH_KINDS[k] || { label: k }).label; }
// Patch's kinds that join them (Patch's own Mirror, Zoom & turn and Posterize are left out: the loop has its own).
// A few get names of their own here, so none reads the same as one of the loop's effects or inputs.
const PATCH_SKIP = new Set(['mirror', 'move', 'poster']);
const PATCH_NAME = { warp: 'Liquid warp', ripples: 'Raindrops', shape: 'Polygon', hue: 'Hue shift', tone: 'Brightness & contrast', dots: 'Dot grid' };
const PATCH_KINDS = {};
// Patch's patterns (Stripes, Moiré, Spiral...) are left out too: they only painted a made-up picture over yours.
for (const [k, K] of Object.entries(PP.KINDS)) if (!PATCH_SKIP.has(k) && K.g !== 'pattern') PATCH_KINDS['p:' + k] = { ...K, label: PATCH_NAME[k] || K.label };
// The add menu: everything together by what it does, A to Z. Patch's movements are under Movement; its softening,
// edges and colors under Color and texture.
const byName = (a, b) => labelOf(a).localeCompare(labelOf(b));
const MENU = [
  ['Movement', ['zoom', 'mirror', 'warp', 'flow', 'melt', 'wind', 'offc', 'split', 'julia', 'crystal', 'lookup', 'chase', 'breathe', 'push',
    'p:kaleido', 'p:tile', 'p:warp', 'p:swirl', 'p:ripple', 'p:polar'].sort(byName)],
  ['Color and texture', ['color', 'poster', 'halftone', 'aberr', 'chroma', 'restless', 'grow', 'dye', 'grade', 'relief',
    ...Object.keys(PATCH_KINDS).filter((k) => !['p:kaleido', 'p:tile', 'p:warp', 'p:swirl', 'p:ripple', 'p:polar'].includes(k))].sort(byName)],
  ['Time', ['time', 'scan', 'corr']],
  ['Whole picture', ['type', 'cloud']],
];
const ZONE_NAME = { in: 'Inside the loop', out: 'On the way out', all: 'Whole picture' };

const isLoopKind = (k) => k in LOOP_KINDS;
const isWhole = (k) => k in WHOLE_KINDS;
const isPatch = (k) => k in PATCH_KINDS;
const known = (k) => isLoopKind(k) || isWhole(k) || isPatch(k);
function zonesOf(kind) {
  if (isLoopKind(kind)) return LOOP_KINDS[kind].zones;
  if (isWhole(kind)) return WHOLE_KINDS[kind].zones;
  return ['in', 'out', 'all'];
}
let idN = 0;
const newId = () => 's' + Date.now().toString(36) + (idN++).toString(36);
function newItem(kind, zone, extra) {
  const it = { id: newId(), kind, on: true, zone: zone || zonesOf(kind)[0], mv: {} };
  if (isPatch(kind)) {
    const K = PATCH_KINDS[kind];
    it.p = {};
    for (const q of K.p) it.p[q.k] = q.def;
    if (K.g === 'pattern') { it.blend = 1; it.opacity = 60; }
    // How much of the effect is laid over: all of it on the way out, a part every frame inside the loop
    it.amt = it.zone === 'in' ? 30 : 100;
  }
  return Object.assign(it, extra || {});
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MOVERS = PP.MOVERS;
// A list from anywhere (a preset, an old version) made safe to use; null when there's nothing to go on
function cleanList(list, whole) {
  if (!Array.isArray(list)) return null;
  const out = [], seen = new Set();
  for (const r of list.slice(0, 40)) {
    if (!r || !known(r.kind)) continue;
    const zones = zonesOf(r.kind).filter((z) => (whole ? z === 'all' : z !== 'all'));
    if (!zones.length) continue;
    // The loop's own effects and the whole-picture ones come once in a list
    if (!isPatch(r.kind)) { if (seen.has(r.kind)) continue; seen.add(r.kind); }
    const it = newItem(r.kind, zones.includes(r.zone) ? r.zone : zones[0]);
    if (typeof r.id === 'string') it.id = r.id.slice(0, 40);
    it.on = r.on !== false;
    if (r.auto) it.auto = true;
    if (r.mv && typeof r.mv === 'object') for (const [k, m] of Object.entries(r.mv)) {
      if (m && MOVERS.some(([x]) => x && x === m.m)) it.mv[k] = { m: m.m, a: clamp(Number(m.a) || 0, 0, 100) };
    }
    if (isPatch(r.kind)) {
      const K = PATCH_KINDS[r.kind];
      for (const q of K.p) { const v = r.p && Number(r.p[q.k]); if (Number.isFinite(v)) it.p[q.k] = q.opts ? clamp(Math.round(v), 0, q.opts.length - 1) : clamp(v, 0, 100); }
      if (K.g === 'pattern') { it.blend = clamp(Math.round(Number(r.blend) || 0), 0, PP.BLENDS.length - 1); it.opacity = clamp(Number.isFinite(+r.opacity) ? +r.opacity : 60, 0, 100); }
      it.amt = clamp(Number.isFinite(+r.amt) ? +r.amt : it.amt, 0, 100);
    }
    out.push(it);
  }
  return out;
}
// The zone order inside a loop's list: everything inside, then on the way out (time effects first there)
function tidy(list) {
  const rank = (it) => (it.zone === 'in' ? 0 : isLoopKind(it.kind) && LOOP_KINDS[it.kind].first ? 1 : 2);
  return list.map((it, i) => [it, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}
// Where a new effect of the loop's own goes: among the others in its zone, by the old order
function insertAt(list, it) {
  const ci = CLASSIC.indexOf(it.kind), zr = (z) => (z === 'in' ? 0 : z === 'out' ? 1 : 2);
  let at = list.length;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (zr(o.zone) > zr(it.zone)) { at = i; break; }
    if (o.zone === it.zone && ci >= 0 && CLASSIC.indexOf(o.kind) > ci) { at = i; break; }
  }
  const out = list.slice();
  out.splice(at, 0, it);
  return tidy(out);
}
// How far a mover takes a fader from where it's set, just now (as Patch's movers: see value in js/patch.js)
function phaseOf(id, k) { let h = 7; for (const ch of id + k) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return (h % 1000) / 1000 * Math.PI * 2; }
function moverDelta(id, key, m, t, env) {
  if (!m || !m.m) return 0;
  const a = m.a;
  if (m.m === 'slow') return a * Math.sin(t * 0.35 + phaseOf(id, key));
  if (m.m === 'fast') return a * Math.sin(t * 2.2 + phaseOf(id, key));
  if (!env) return 0;
  const lvl = m.m === 'music' ? (env.low + env.mid + env.high) / 3 * 1.6 : m.m === 'bass' ? env.low : env.beat;
  return a * clamp(lvl, 0, 1.5);
}
return { LOOP_KINDS, WHOLE_KINDS, PATCH_KINDS, CLASSIC, MENU, ZONE_NAME, MOVERS, isLoopKind, isWhole, isPatch, known, labelOf,
  zonesOf, newItem, cleanList, tidy, insertAt, moverDelta };
})();
