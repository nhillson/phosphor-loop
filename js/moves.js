'use strict';
// Recorded moves: the picture's settings as they change over time (which inputs each loop uses, every slider,
// mixing, Color grading, 3D lighting, Type art...), so a recording plays back live, rebuilt from its settings,
// rather than as a movie. Saved inside a library clip's effects (look.moves); see "recorded moves" in app.js.
//
//   { v: 1, dur: seconds,
//     tr: { 'A.zoom': [t, v, t, v, ...], ... }   numbers that change, t in hundredths of a second, thinned out
//     ev: [[t, 'A.in1', value], ...] }            everything else (inputs, switches, words), in time order
// Paths are the look's own ('A.zoom', 'mix.showB', 'grade.gHue', 'adj.video.size'); before a number's first
// point it is as it was at the start.
window.PhosphorMoves = (() => {
  const DEPTH = 4;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const same = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
  const copy = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

  // { A: { zoom: 3 } } -> { 'A.zoom': 3 }; lists stay whole
  function flatten(o, pre = '', out = {}, depth = 0) {
    for (const [k, v] of Object.entries(o || {})) {
      const p = pre ? pre + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && depth < DEPTH) flatten(v, p, out, depth + 1);
      else if (v !== undefined && typeof v !== 'function') out[p] = v;
    }
    return out;
  }

  class Recorder {
    constructor(first) { this.last = flatten(first); this.tr = {}; this.ev = []; this.lastCs = 0; }
    // look: the settings now; t: seconds since the recording started
    sample(look, t) {
      const cs = Math.max(this.lastCs, Math.round(t * 100));
      const now = flatten(look);
      for (const [p, v] of Object.entries(now)) {
        const was = this.last[p];
        if (isNum(v) && (was === undefined || isNum(was))) {
          if (was !== undefined && Math.abs(v - was) < 1e-6) continue;
          const tr = this.tr[p] || (this.tr[p] = []);
          // Still until the last look, moving now: a point there keeps the still part still
          if (was !== undefined && (!tr.length || tr[tr.length - 2] < this.lastCs)) tr.push(this.lastCs, was);
          tr.push(cs, v);
        } else if (!same(v, was)) this.ev.push([cs, p, copy(v)]);
      }
      for (const p of Object.keys(this.last)) if (!(p in now)) this.ev.push([cs, p, null]);
      this.last = now;
      this.lastCs = cs;
    }
    // The recording, its numbers thinned out (points a straight line between neighbours already gives are dropped)
    finish(t) {
      const tr = {};
      for (const [p, pts] of Object.entries(this.tr)) {
        const thin = simplify(pts);
        if (thin.length >= 2) tr[p] = thin;
      }
      return { v: 1, dur: Math.round(Math.max(t, this.lastCs / 100) * 100) / 100, tr, ev: this.ev };
    }
    get changes() { return Object.keys(this.tr).length + new Set(this.ev.map((e) => e[1])).size; }
  }

  // Ramer–Douglas–Peucker on [t, v, t, v...]: keeps a point when leaving it out would move the line by more than
  // a 400th of the track's own range
  function simplify(pts) {
    const n = pts.length / 2;
    if (n <= 2) return pts.map((x) => Math.round(x * 1000) / 1000);
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < pts.length; i += 2) { lo = Math.min(lo, pts[i]); hi = Math.max(hi, pts[i]); }
    const eps = Math.max(1e-4, (hi - lo) / 400);
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const ta = pts[a * 2], va = pts[a * 2 + 1], tb = pts[b * 2], vb = pts[b * 2 + 1];
      let worst = -1, at = -1;
      for (let i = a + 1; i < b; i++) {
        const t = pts[i * 2], line = tb === ta ? va : va + (vb - va) * (t - ta) / (tb - ta);
        const d = Math.abs(pts[i * 2 + 1] - line);
        if (d > worst) { worst = d; at = i; }
      }
      if (worst > eps) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], Math.round(pts[i * 2 + 1] * 1000) / 1000);
    return out;
  }

  // A number's value at cs (hundredths): undefined before its first point
  function valueAt(pts, cs) {
    if (!pts.length || cs < pts[0]) return undefined;
    const n = pts.length / 2;
    if (cs >= pts[(n - 1) * 2]) return pts[n * 2 - 1];
    let a = 0, b = n - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (pts[m * 2] <= cs) a = m; else b = m; }
    const ta = pts[a * 2], tb = pts[b * 2], va = pts[a * 2 + 1], vb = pts[b * 2 + 1];
    return tb === ta ? vb : va + (vb - va) * (cs - ta) / (tb - ta);
  }

  // Plays a recording: step(t) gives the paths that changed since the last step, as [path, value]. Going back in
  // time (the recording starting over) begins again from the start look.
  class Player {
    constructor(start, moves) {
      this.base = flatten(start);
      this.m = moves;
      this.tracks = Object.entries(moves.tr || {});
      this.reset();
    }
    reset() { this.cur = { ...this.base }; this.ei = 0; this.lastCs = -1; }
    step(t) {
      const cs = Math.round(t * 100), out = [];
      if (cs < this.lastCs) {
        const was = this.cur;
        this.reset();
        for (const [p, v] of Object.entries(this.cur)) if (!same(was[p], v)) out.push([p, v]);
        for (const p of Object.keys(was)) if (!(p in this.cur)) out.push([p, null]);
      }
      this.lastCs = cs;
      const ev = this.m.ev || [];
      while (this.ei < ev.length && ev[this.ei][0] <= cs) {
        const [, p, v] = ev[this.ei++];
        if (!same(this.cur[p], v)) { this.cur[p] = v; out.push([p, v]); }
      }
      for (const [p, pts] of this.tracks) {
        const v = valueAt(pts, cs);
        if (v !== undefined && this.cur[p] !== v) { this.cur[p] = v; out.push([p, v]); }
      }
      return out;
    }
    // Everything at time t, as a look object (for the sequencer)
    lookAt(t) {
      const p = new Player({}, this.m);
      p.base = this.base; p.reset();
      p.step(t);
      return unflatten(p.cur);
    }
  }

  function unflatten(flat) {
    const o = {};
    for (const [p, v] of Object.entries(flat)) {
      const parts = p.split('.');
      let at = o;
      for (let i = 0; i < parts.length - 1; i++) at = at[parts[i]] && typeof at[parts[i]] === 'object' ? at[parts[i]] : (at[parts[i]] = {});
      at[parts[parts.length - 1]] = copy(v);
    }
    return o;
  }

  const clean = (m) => !!m && typeof m === 'object' && m.v === 1 && isNum(m.dur) && m.dur > 0 && m.tr && typeof m.tr === 'object' && Array.isArray(m.ev);
  return { flatten, unflatten, Recorder, Player, valueAt, simplify, clean };
})();
