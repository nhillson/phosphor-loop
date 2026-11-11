'use strict';
// Patch: Auragen-style layer stack, the Patch input's picture (see "patch" in js/app.js).
// A patch is a list of layers read top to bottom. Each layer is one pass on the graphics card that works on the
// picture made by the layers above it:
//   Patterns  draw a grey pattern (white on black) and lay it over what's above, by their Blend and Opacity
//   Effects   move, fold, bend or soften everything above
//   Colors    recolor everything above (Gradient colors turns grey into a palette)
// Every fader (0 to 100) can be handed to a mover: a slow or fast wave, the music, the bass or the beat.
window.PhosphorPatch = (() => {

// What each layer is. p: its faders, in the order the shader reads them (uP[0..7]); a fader with `opts` is a
// choice (its index is passed). 'speed' faders aren't read by the shader: they set how fast the layer's own clock runs.
const PAT = 'pattern', FX = 'effect', COL = 'color';
const P = (k, label, def, extra) => ({ k, label, def, ...extra });
const SPEED = P('speed', 'Speed', 30);
const KINDS = {
  // Patterns
  noise:    { id: 0,   g: PAT, label: 'Noise',    p: [P('scale', 'Size', 45), P('detail', 'Detail', 50), P('contrast', 'Contrast', 50), SPEED] },
  stripes:  { id: 1,   g: PAT, label: 'Stripes',  p: [P('count', 'How many', 30), P('angle', 'Angle', 25), P('soft', 'Softness', 50), SPEED] },
  rings:    { id: 2,   g: PAT, label: 'Rings',    p: [P('count', 'How many', 35), P('soft', 'Softness', 50), P('wobble', 'Wobble', 20), SPEED] },
  checker:  { id: 3,   g: PAT, label: 'Checker',  p: [P('size', 'Size', 40), P('turn', 'Turn', 0), SPEED] },
  dots:     { id: 4,   g: PAT, label: 'Dots',     p: [P('count', 'How many', 40), P('size', 'Dot size', 50), P('soft', 'Softness', 30), SPEED] },
  shape:    { id: 5,   g: PAT, label: 'Shape',    p: [P('sides', 'Sides', 20), P('size', 'Size', 50), P('soft', 'Softness', 10), P('line', 'Outline', 0), P('speed', 'Spin', 20)] },
  gradient: { id: 6,   g: PAT, label: 'Gradient', p: [P('kind', 'Kind', 0, { opts: ['Straight', 'Round', 'Around'] }), P('angle', 'Angle', 0), P('repeat', 'Repeats', 15), SPEED] },
  cells:    { id: 7,   g: PAT, label: 'Cells',    p: [P('scale', 'Size', 40), P('walls', 'Walls', 70), SPEED] },
  marble:   { id: 8,   g: PAT, label: 'Marble',   p: [P('scale', 'Size', 50), P('veins', 'Veins', 50), SPEED] },
  ripples:  { id: 9,   g: PAT, label: 'Ripples',  p: [P('scale', 'Size', 50), P('count', 'Drops', 60), SPEED] },
  moire:    { id: 10,  g: PAT, label: 'Moiré',    p: [P('scale', 'Size', 50), P('fine', 'Fineness', 50), SPEED] },
  maze:     { id: 11,  g: PAT, label: 'Maze',     p: [P('scale', 'Size', 50), P('width', 'Line width', 40), SPEED] },
  silk:     { id: 12,  g: PAT, label: 'Silk',     p: [P('scale', 'Size', 50), P('bands', 'Bands', 50), SPEED] },
  hex:      { id: 13,  g: PAT, label: 'Hex',      p: [P('scale', 'Size', 50), P('pulse', 'Pulse', 60), SPEED] },
  spiral:   { id: 14,  g: PAT, label: 'Spiral',   p: [P('arms', 'Arms', 30), P('twist', 'Twist', 50), SPEED] },
  // Effects
  move:     { id: 100, g: FX, label: 'Zoom & turn', p: [P('zoom', 'Zoom', 50, { mid: true }), P('angle', 'Turn', 50, { mid: true }), P('speed', 'Spin', 0)] },
  kaleido:  { id: 101, g: FX, label: 'Kaleido',  p: [P('sides', 'Sides', 30), P('zoom', 'Zoom', 50, { mid: true }), P('speed', 'Spin', 20)] },
  mirror:   { id: 102, g: FX, label: 'Mirror',   p: [P('mode', 'Fold', 0, { opts: ['Left/right', 'Top/bottom', 'Both'] })] },
  tile:     { id: 103, g: FX, label: 'Tile',     p: [P('count', 'Tiles', 25), P('flip', 'Edges', 0, { opts: ['Mirrored', 'Repeated'] }), P('speed', 'Scroll', 0)] },
  warp:     { id: 104, g: FX, label: 'Warp',     p: [P('amount', 'Bend', 40), P('size', 'Size', 40), SPEED] },
  swirl:    { id: 105, g: FX, label: 'Swirl',    p: [P('amount', 'Twist', 70, { mid: true }), P('radius', 'Reach', 50)] },
  ripple:   { id: 106, g: FX, label: 'Ripple',   p: [P('amount', 'Wave height', 30), P('count', 'Waves', 40), SPEED] },
  polar:    { id: 107, g: FX, label: 'Wrap round', p: [P('amount', 'Strength', 100), P('repeat', 'Repeats', 10)] },
  pixel:    { id: 108, g: FX, label: 'Pixelate', p: [P('size', 'Block size', 25)] },
  blur:     { id: 109, g: FX, label: 'Blur',     p: [P('amount', 'Softness', 30)] },
  edges:    { id: 110, g: FX, label: 'Edges',    p: [P('amount', 'Strength', 60), P('keep', 'Keep picture', 0)] },
  // Colors
  colors:   { id: 200, g: COL, label: 'Gradient colors', p: [P('pal', 'Palette', 0, { opts: ['Rainbow', 'Sunset', 'Ocean', 'Neon', 'Fire', 'Ice', 'Purple haze', 'Gold'] }), P('shift', 'Shift', 0), P('spread', 'Spread', 50), P('speed', 'Cycle', 20)] },
  hue:      { id: 201, g: COL, label: 'Hue shift', p: [P('amount', 'Shift', 0), P('speed', 'Cycle', 20)] },
  tone:     { id: 202, g: COL, label: 'Brightness & contrast', p: [P('bright', 'Brightness', 50, { mid: true }), P('contrast', 'Contrast', 50, { mid: true }), P('sat', 'Saturation', 50, { mid: true })] },
  poster:   { id: 203, g: COL, label: 'Posterize', p: [P('steps', 'Steps', 30)] },
  invert:   { id: 204, g: COL, label: 'Invert',   p: [P('amount', 'Strength', 100)] },
};
const GROUPS = [[PAT, 'Patterns'], [FX, 'Effects'], [COL, 'Colors']];
const BLENDS = ['Add', 'Screen', 'Multiply', 'Difference', 'Lighten', 'Darken', 'Replace', 'Mask'];
const MOVERS = [['', 'Still'], ['slow', 'Slow wave'], ['fast', 'Fast wave'], ['music', 'Music'], ['bass', 'Bass'], ['beat', 'Beat hits']];
const MAX_LAYERS = 12;

let idN = 0;
const newId = () => 'l' + Date.now().toString(36) + (idN++).toString(36);
function newLayer(kind) {
  const K = KINDS[kind];
  if (!K) return null;
  const L = { id: newId(), kind, on: true, p: {}, mv: {} };
  for (const q of K.p) L.p[q.k] = q.def;
  if (K.g === PAT) { L.blend = 0; L.opacity = 100; }
  return L;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// A patch from anywhere (a preset, a file, an old version) made safe to use
function clean(pt) {
  if (!pt || typeof pt !== 'object' || !Array.isArray(pt.layers)) return null;
  const out = { name: String(pt.name || 'Patch').slice(0, 40), layers: [] };
  for (const l of pt.layers.slice(0, MAX_LAYERS)) {
    const K = l && KINDS[l.kind];
    if (!K) continue;
    const n = newLayer(l.kind);
    n.id = typeof l.id === 'string' ? l.id : n.id;
    n.on = l.on !== false;
    for (const q of K.p) {
      const v = l.p && Number(l.p[q.k]);
      if (Number.isFinite(v)) n.p[q.k] = q.opts ? clamp(Math.round(v), 0, q.opts.length - 1) : clamp(v, 0, 100);
      const m = l.mv && l.mv[q.k];
      if (m && MOVERS.some(([x]) => x && x === m.m) && !q.opts) n.mv[q.k] = { m: m.m, a: clamp(Number(m.a) || 0, 0, 100) };
    }
    if (K.g === PAT) { n.blend = clamp(Math.round(Number(l.blend) || 0), 0, BLENDS.length - 1); n.opacity = clamp(Number.isFinite(+l.opacity) ? +l.opacity : 100, 0, 100); }
    out.layers.push(n);
  }
  return out;
}
const copy = (pt) => JSON.parse(JSON.stringify(pt));

// Ready-made patches: some to start from, and for Autopilot
const S = (name, layers) => clean({ name, layers: layers.map(([kind, p, extra]) => ({ kind, p, ...(extra || {}) })) });
const mv = (o) => ({ mv: o });
const STARTERS = [
  S('Liquid marble', [['marble', { scale: 45, veins: 60, speed: 25 }], ['swirl', { amount: 62, radius: 60 }, mv({ amount: { m: 'slow', a: 15 } })], ['colors', { pal: 6, shift: 10, spread: 55, speed: 15 }]]),
  S('Neon tunnel', [['rings', { count: 45, soft: 25, wobble: 30, speed: 45 }, mv({ count: { m: 'bass', a: 30 } })], ['kaleido', { sides: 25, zoom: 50, speed: 15 }], ['colors', { pal: 3, spread: 70, speed: 35 }]]),
  S('Op-art stripes', [['stripes', { count: 45, angle: 20, soft: 15, speed: 25 }], ['stripes', { count: 40, angle: 70, soft: 15, speed: 20 }, { blend: 3 }], ['swirl', { amount: 75, radius: 55 }, mv({ amount: { m: 'slow', a: 25 } })], ['colors', { pal: 0, spread: 30, speed: 20 }]]),
  S('Cell bloom', [['cells', { scale: 45, walls: 80, speed: 35 }], ['blur', { amount: 15 }], ['kaleido', { sides: 40, zoom: 45, speed: 10 }], ['colors', { pal: 2, spread: 60, speed: 15 }]]),
  S('Moiré pulse', [['moire', { scale: 50, fine: 55, speed: 35 }, mv({ fine: { m: 'music', a: 25 } })], ['colors', { pal: 5, spread: 60, speed: 25 }]]),
  S('Cosmic hex', [['hex', { scale: 45, pulse: 70, speed: 40 }], ['noise', { scale: 35, detail: 60, contrast: 55, speed: 20 }, { blend: 2, opacity: 80 }], ['warp', { amount: 25, size: 35, speed: 25 }], ['colors', { pal: 7, spread: 45, speed: 20 }]]),
  S('Silk river', [['silk', { scale: 50, bands: 55, speed: 30 }], ['ripple', { amount: 20, count: 35, speed: 30 }, mv({ amount: { m: 'bass', a: 30 } })], ['colors', { pal: 1, spread: 50, speed: 15 }]]),
  S('Maze machine', [['maze', { scale: 45, width: 40, speed: 40 }], ['tile', { count: 15, flip: 0, speed: 10 }], ['edges', { amount: 50, keep: 70 }], ['colors', { pal: 4, spread: 40, speed: 25 }]]),
  S('Star gate', [['shape', { sides: 50, size: 45, soft: 5, line: 35, speed: 25 }], ['shape', { sides: 10, size: 70, soft: 5, line: 25, speed: 60 }], ['move', { zoom: 50, angle: 50, speed: 15 }], ['polar', { amount: 40, repeat: 15 }], ['colors', { pal: 3, spread: 60, speed: 30 }]]),
  S('Spiral dream', [['spiral', { arms: 35, twist: 55, speed: 35 }], ['noise', { scale: 30, detail: 40, contrast: 40, speed: 25 }, { blend: 2, opacity: 70 }], ['hue', { amount: 0, speed: 30 }], ['colors', { pal: 0, spread: 40, speed: 20 }]]),
];

// How far each fader is moved right now. env: the music (low, mid, high, beat, 0 to about 1, already scaled by
// React to sound's Amount); null when nothing is heard. Waves start at a different point for each fader.
function phaseOf(id, k) { let h = 7; for (const ch of id + k) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return (h % 1000) / 1000 * Math.PI * 2; }
function value(L, q, t, env) {
  const base = L.p[q.k];
  const m = L.mv[q.k];
  if (!m || !m.m || q.opts) return base;
  const a = m.a;
  let d = 0;
  if (m.m === 'slow') d = a * Math.sin(t * 0.35 + phaseOf(L.id, q.k));
  else if (m.m === 'fast') d = a * Math.sin(t * 2.2 + phaseOf(L.id, q.k));
  else if (env) {
    const lvl = m.m === 'music' ? (env.low + env.mid + env.high) / 3 * 1.6 : m.m === 'bass' ? env.low : env.beat;
    d = a * clamp(lvl, 0, 1.5);
  }
  return clamp(base + d, 0, 100);
}
const speedRate = (v) => Math.pow(v / 100, 1.4) * 2.5;   // Speed 0 holds still, 30 is about a quarter, 100 two and a half

const FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uSim;
uniform float uT;      // this layer's own clock (seconds, run faster or slower by its Speed)
uniform float uZoom;   // Input size: patterns are drawn this much bigger
uniform float uPxK;    // pixels in one standard-size pixel
uniform int uKind, uMode;
uniform float uOpac;
uniform float uP[8];   // the layer's faders, 0 to 1 (choices: their number)
out vec4 o;
const float TAU = 6.28318531;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash2(vec2 i) { return vec2(hash(i), hash(i + 17.31)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 q, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vnoise(q); n += a; q = R * q * 2.03 + 11.7; a *= 0.5; }
  return s / n;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
// A line's brightness d pixels from it: a sharp core and a soft glow
float aline(float d, float w) { return clamp(w - d + 0.5, 0.0, 1.0) + 0.35 * exp(-d / (3.0 * w)); }
float soft(float d, float s) { return 1.0 - smoothstep(-s, s, d); }

// ---- Patterns: white on black, 0 to 1. q: the screen's position, Input size applied; px: one pixel in q's units
float pattern(int k, vec2 q, float px, float t) {
  float a = uP[0], b = uP[1], c = uP[2], d = uP[3];
  if (k == 0) {          // Noise
    float sc = mix(0.6, 9.0, a * a);
    float v = fbm(q * sc + vec2(t * 0.3, -t * 0.21), 1 + int(b * 5.0));
    return clamp((v - 0.5) * mix(1.0, 5.0, c) + 0.5, 0.0, 1.0);
  }
  if (k == 1) {          // Stripes
    float n = mix(2.0, 60.0, a * a);
    vec2 r = rot(b * 3.14159) * q;
    float s = 0.5 + 0.5 * cos(TAU * (r.x * n - t));
    float e = mix(0.02, 0.5, c);
    return smoothstep(0.5 - e, 0.5 + e, s);
  }
  if (k == 2) {          // Rings
    float n = mix(2.0, 50.0, a * a);
    vec2 w = c * 0.25 * vec2(sin(t * 0.7), cos(t * 0.53));
    float r = length(q - w) + c * 0.05 * sin(atan(q.y - w.y, q.x - w.x) * 5.0 + t);
    float s = 0.5 + 0.5 * cos(TAU * (r * n - t));
    float e = mix(0.02, 0.5, b);
    return smoothstep(0.5 - e, 0.5 + e, s);
  }
  if (k == 3) {          // Checker
    float n = mix(2.0, 40.0, (1.0 - a) * (1.0 - a));
    vec2 r = rot(b * 1.5708 + t * 0.3) * q * n;
    vec2 f = abs(fract(r) - 0.5);
    float e = px * n * 0.7;
    vec2 g = smoothstep(0.25 - e, 0.25 + e, f);
    return abs(g.x - g.y);
  }
  if (k == 4) {          // Dots
    float n = mix(3.0, 40.0, a * a);
    vec2 r = q * n + vec2(t * 0.5, t * 0.2);
    vec2 f = fract(r) - 0.5;
    float rad = mix(0.05, 0.5, b);
    float e = max(px * n, mix(0.01, 0.3, c));
    return 1.0 - smoothstep(rad - e, rad + e, length(f));
  }
  if (k == 5) {          // Shape
    float N = floor(mix(3.0, 12.99, a));
    vec2 r = rot(t * 0.8) * q;
    float an = atan(r.y, r.x), h = TAU / N;
    float dd = cos(floor(0.5 + an / h) * h - an) * length(r);
    float R = mix(0.05, 0.7, b), e = max(px, mix(0.0, 0.2, c));
    float f = dd - R;
    if (d > 0.01) { float lw = mix(0.004, 0.08, d); return 1.0 - smoothstep(lw - e, lw + e, abs(f)); }
    return soft(f, e);
  }
  if (k == 6) {          // Gradient
    float x;
    if (a < 0.5) x = dot(rot(b * TAU) * q, vec2(1.0, 0.0)) + 0.5;
    else if (a < 1.5) x = length(q) * 1.4;
    else x = atan(q.y, q.x) / TAU + 0.5 + b;
    float n = 1.0 + floor(c * 12.0);
    float s = fract(x * n - t * 0.2);
    return n > 1.5 ? 1.0 - abs(s * 2.0 - 1.0) : clamp(x - t * 0.0, 0.0, 1.0);
  }
  if (k == 7) {          // Cells
    float sc = mix(2.0, 14.0, (1.0 - a) * (1.0 - a));
    vec2 g = q * sc, i = floor(g), f = fract(g);
    float d1 = 9.0, d2 = 9.0; vec2 id1 = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o2 = vec2(float(x), float(y)), h = hash2(i + o2);
      vec2 pt = o2 + 0.5 + 0.42 * sin(t * (0.6 + 0.5 * h) + TAU * h);
      float dl = length(pt - f);
      if (dl < d1) { d2 = d1; d1 = dl; id1 = i + o2; } else if (dl < d2) d2 = dl;
    }
    float wall = aline((d2 - d1) * 0.5 / (sc * px), 0.9 * uPxK);
    float fill = (1.0 - d1) * (0.3 + 0.7 * hash(id1));
    return mix(fill, clamp(wall, 0.0, 1.0), b);
  }
  if (k == 8) {          // Marble
    vec2 m = q * mix(0.5, 3.5, (1.0 - a));
    vec2 w1 = vec2(fbm(m + vec2(0.0, t * 0.15), 4), fbm(m + vec2(5.2, 1.3) - t * 0.12, 4));
    vec2 w2 = vec2(fbm(m + 2.4 * w1 + vec2(1.7, 9.2) + t * 0.09, 4), fbm(m + 2.4 * w1 + vec2(8.3, 2.8), 4));
    float f = fbm(m + 2.6 * w2, 4);
    float v = abs(fract(f * mix(2.0, 9.0, b) + w1.x) - 0.5) * 2.0;
    return clamp(0.1 + 0.3 * f * f + pow(1.0 - v, 9.0), 0.0, 1.0);
  }
  if (k == 9) {          // Ripples
    float s = 0.0, sc = mix(8.0, 50.0, (1.0 - a));
    int n = 1 + int(b * 5.0);
    for (int j = 0; j < 6; j++) {
      if (j >= n) break;
      float fj = float(j);
      vec2 cj = 0.55 * vec2(sin(t * (0.11 + 0.03 * fj) + fj * 1.7), cos(t * (0.09 + 0.02 * fj) + fj * 2.9));
      s += sin(length(q - cj) * sc - t * (1.6 + 0.2 * fj));
    }
    s /= float(n);
    return pow(0.5 + 0.5 * cos(s * 9.0), 4.0);
  }
  if (k == 10) {         // Moire
    float f = mix(40.0, 160.0, b) * mix(1.6, 0.6, a);
    vec2 c1 = 0.25 * vec2(sin(t * 0.07), cos(t * 0.05)), c2 = -c1;
    float g1 = 0.5 + 0.5 * cos(length(q - c1) * f);
    float g2 = 0.5 + 0.5 * cos(dot(rot(t * 0.04) * (q - c2), vec2(1.0, 0.0)) * f);
    float fine = smoothstep(1.2, 4.0, (TAU / f) / px);
    return clamp(mix(0.25, g1 * g2, fine) * 1.2, 0.0, 1.0);
  }
  if (k == 11) {         // Maze
    float sc = mix(2.0, 14.0, (1.0 - a) * (1.0 - a));
    vec2 g = q * sc + vec2(t * 0.08, t * 0.05), i = floor(g), f = fract(g) - 0.5;
    float flip = step(0.5, hash(i + floor(t * 0.12 + hash(i + 3.0)) * 7.13));
    if (flip > 0.5) f.x = -f.x;
    vec2 aa = f - 0.5, bb = f + 0.5;
    float da = abs(length(aa) - 0.5), db = abs(length(bb) - 0.5);
    vec2 n = da < db ? aa : bb;
    float dist = min(da, db) / (sc * px);
    float run = 0.5 + 0.5 * sin(atan(n.y, n.x) * 4.0 + (da < db ? 1.0 : -1.0) * (1.0 - 2.0 * flip) * t * 3.0 + hash(i) * TAU);
    return clamp(aline(dist, mix(0.8, 5.0, b) * uPxK) * (0.35 + 0.75 * run * run), 0.0, 1.0);
  }
  if (k == 12) {         // Silk
    vec2 m = q * mix(0.5, 3.0, 1.0 - a);
    float h = fbm(m + 0.6 * vec2(fbm(m * 0.7 + t * 0.03, 4), fbm(m * 0.7 + 4.1 - t * 0.025, 4)), 4);
    return pow(0.5 + 0.5 * cos(TAU * (h * mix(4.0, 30.0, b) - t * 0.12)), 4.0);
  }
  if (k == 13) {         // Hex
    vec2 g = q * mix(2.0, 14.0, (1.0 - a) * (1.0 - a));
    const vec2 r = vec2(1.0, 1.7320508);
    vec2 h1 = mod(g, r) - 0.5 * r, h2 = mod(g - 0.5 * r, r) - 0.5 * r;
    vec2 gv = dot(h1, h1) < dot(h2, h2) ? h1 : h2, id = g - gv;
    float hd = max(dot(abs(gv), vec2(0.5, 0.8660254)), abs(gv).x);
    float wave = 0.5 + 0.5 * sin(length(id) * 0.7 - t * 2.2 + hash(id) * 1.5);
    float size = mix(0.4, 0.12, b) + b * 0.34 * wave * wave;
    float sc = mix(2.0, 14.0, (1.0 - a) * (1.0 - a));
    return clamp(aline(abs(hd - size) / (sc * px), 0.9 * uPxK) * (0.35 + 0.65 * wave) + 0.2 * wave * step(hd, size), 0.0, 1.0);
  }
  if (k == 14) {         // Spiral
    float r = length(q), an = atan(q.y, q.x);
    float u = log(max(r, 1e-3)) * mix(0.5, 4.0, b) - t * 0.35;
    float arms = floor(mix(1.0, 12.0, a));
    float s1 = 0.5 + 0.5 * sin(u * 6.0 + an * arms);
    return pow(s1, 4.0) * smoothstep(0.0, 0.08, r);
  }
  return 0.0;
}
vec3 blendIn(vec3 bg, vec3 fg) {
  vec3 r;
  if (uMode == 0) r = bg + fg;
  else if (uMode == 1) r = 1.0 - (1.0 - bg) * (1.0 - fg);
  else if (uMode == 2) r = bg * fg;
  else if (uMode == 3) r = abs(bg - fg);
  else if (uMode == 4) r = max(bg, fg);
  else if (uMode == 5) r = min(bg, fg);
  else if (uMode == 6) r = fg;
  else r = bg * fg.r;
  return mix(bg, clamp(r, 0.0, 1.0), uOpac);
}
// ---- Effects: where in the picture above each spot reads from
vec2 fold2(vec2 uv) { return 1.0 - abs(mod(uv, 2.0) - 1.0); }
vec3 readAt(vec2 p, float asp) { return texture(uPrev, fold2(p / vec2(asp, 1.0) + 0.5)).rgb; }
vec3 effect(int k, vec2 p, vec2 uv, float asp, float t) {
  float a = uP[0], b = uP[1], c = uP[2];
  vec2 px = uPxK / uSim;
  if (k == 100) {        // Zoom & turn
    float z = exp((a - 0.5) * 3.0);
    return readAt(rot((b - 0.5) * TAU + t) * p / z, asp);
  }
  if (k == 101) {        // Kaleido
    float N = floor(mix(2.0, 16.0, a));
    float z = exp((b - 0.5) * 2.5);
    vec2 r = rot(t * 0.5) * p / z;
    float h = 3.14159265 / N, an = mod(atan(r.y, r.x), 2.0 * h) - h;
    return readAt(length(r) * vec2(cos(abs(an)), sin(abs(an))), asp);
  }
  if (k == 102) {        // Mirror
    vec2 r = p;
    if (a < 0.5 || a > 1.5) r.x = abs(r.x);
    if (a > 0.5) r.y = abs(r.y);
    return readAt(r, asp);
  }
  if (k == 103) {        // Tile
    float n = floor(mix(1.0, 12.0, a));
    vec2 st = uv * n + vec2(t * 0.25, t * 0.1);
    vec2 f = b < 0.5 ? fold2(st) : fract(st);
    return texture(uPrev, f).rgb;
  }
  if (k == 104) {        // Warp
    float sz = mix(0.8, 8.0, 1.0 - b);
    vec2 w = vec2(fbm(p * sz + vec2(t * 0.3, 0.0), 3), fbm(p * sz + vec2(4.7, -t * 0.27), 3)) - 0.5;
    return readAt(p + w * a * 0.5, asp);
  }
  if (k == 105) {        // Swirl
    float r = length(p), reach = mix(0.1, 1.2, b);
    float tw = (a - 0.5) * 12.0 * exp(-r * r / (reach * reach));
    return readAt(rot(tw) * p, asp);
  }
  if (k == 106) {        // Ripple
    float r = length(p);
    float n = mix(4.0, 60.0, b);
    vec2 dir = r > 1e-4 ? p / r : vec2(0.0);
    return readAt(p + dir * sin(r * n - t * 4.0) * a * 0.04, asp);
  }
  if (k == 107) {        // Wrap round: the picture's width wrapped round the middle, its height out from it
    float an = atan(p.y, p.x) / TAU + 0.5;
    float n = 1.0 + floor(b * 8.0);
    vec2 pol = vec2(fract(an * n), clamp(length(p) * 1.4, 0.0, 1.0));
    vec3 cp = texture(uPrev, pol).rgb;
    return mix(texture(uPrev, uv).rgb, cp, a);
  }
  if (k == 108) {        // Pixelate
    float s = mix(2.0, 60.0, a * a) * uPxK;
    vec2 cell = (floor(gl_FragCoord.xy / s) + 0.5) * s / uSim;
    return texture(uPrev, cell).rgb;
  }
  if (k == 109) {        // Blur
    float r = mix(0.0, 14.0, a);
    vec3 s = vec3(0.0); float n = 0.0;
    for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
      vec2 o2 = vec2(float(x), float(y));
      float w = exp(-dot(o2, o2) / 4.0);
      s += texture(uPrev, uv + o2 * r * 0.5 * px).rgb * w; n += w;
    }
    return s / n;
  }
  if (k == 110) {        // Edges
    float l[9];
    for (int i = 0; i < 9; i++) l[i] = luma(texture(uPrev, uv + vec2(float(i % 3) - 1.0, float(i / 3) - 1.0) * px).rgb);
    float gx = (l[2] + 2.0 * l[5] + l[8]) - (l[0] + 2.0 * l[3] + l[6]);
    float gy = (l[6] + 2.0 * l[7] + l[8]) - (l[0] + 2.0 * l[1] + l[2]);
    vec3 here = texture(uPrev, uv).rgb;
    float e = clamp(length(vec2(gx, gy)) * mix(0.5, 6.0, a), 0.0, 1.0);
    return clamp(here * b + vec3(e) * (here * 0.5 + 0.5 * max(luma(here), 0.6)), 0.0, 1.0);
  }
  return texture(uPrev, uv).rgb;
}
// ---- Colors
vec3 palette(int i, float x) {
  vec3 A = vec3(0.5), B = vec3(0.5), C = vec3(1.0), D;
  if (i == 0) D = vec3(0.0, 0.33, 0.67);
  else if (i == 1) { D = vec3(0.0, 0.1, 0.2); C = vec3(1.0, 1.0, 0.5); A = vec3(0.6, 0.4, 0.4); }
  else if (i == 2) { D = vec3(0.5, 0.6, 0.7); A = vec3(0.3, 0.5, 0.6); B = vec3(0.3, 0.4, 0.4); }
  else if (i == 3) { D = vec3(0.8, 0.9, 0.3); C = vec3(2.0, 1.0, 0.0); }
  else if (i == 4) { D = vec3(0.0, 0.15, 0.2); C = vec3(1.0, 0.7, 0.4); A = vec3(0.65, 0.35, 0.15); B = vec3(0.45, 0.35, 0.2); }
  else if (i == 5) { D = vec3(0.6, 0.55, 0.5); A = vec3(0.55, 0.7, 0.85); B = vec3(0.35, 0.3, 0.2); C = vec3(0.6); }
  else if (i == 6) { D = vec3(0.7, 0.85, 0.95); A = vec3(0.5, 0.3, 0.6); B = vec3(0.4, 0.3, 0.4); }
  else { D = vec3(0.1, 0.18, 0.35); A = vec3(0.7, 0.5, 0.25); B = vec3(0.35, 0.3, 0.2); C = vec3(0.8); }
  return clamp(A + B * cos(TAU * (C * x + D)), 0.0, 1.0);
}
vec3 hueTurn(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
vec3 colorOp(int k, vec3 c, float t) {
  float a = uP[0], b = uP[1], d = uP[2];
  if (k == 200) {        // Gradient colors: grey becomes a palette; black stays black
    float l = luma(c);
    vec3 pc = palette(int(a + 0.5), l * mix(0.2, 2.0, d) + b + t * 0.05);
    return pc * smoothstep(0.0, 0.3, l) * (0.75 + 0.35 * l);
  }
  if (k == 201) return max(hueTurn(c, a * TAU + t * 0.6), 0.0);
  if (k == 202) {
    c = (c - 0.5) * exp((b - 0.5) * 2.5) + 0.5 + (a - 0.5);
    float l = luma(c);
    return clamp(mix(vec3(l), c, d * 2.0), 0.0, 1.0);
  }
  if (k == 203) { float n = floor(mix(2.0, 12.0, 1.0 - a)); return floor(clamp(c, 0.0, 1.0) * n + 0.5) / n; }
  if (k == 204) return mix(c, 1.0 - c, a);
  return c;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSim;
  float asp = uSim.x / uSim.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  vec3 prev = texture(uPrev, uv).rgb;
  vec3 c;
  if (uKind < 100) {
    float px = uZoom / uSim.y;
    c = blendIn(prev, vec3(pattern(uKind, p * uZoom, px, uT)));
  } else if (uKind < 200) c = effect(uKind, p, uv, asp, uT);
  else c = colorOp(uKind, prev, uT);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

return { KINDS, GROUPS, BLENDS, MOVERS, MAX_LAYERS, STARTERS, FS, newLayer, clean, copy, value, speedRate };
})();
