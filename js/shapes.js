'use strict';
// Shapes: 2D and 3D shapes laid over everything on the canvas, each with a pull like a black hole's. Their light
// bending and their accretion disks are drawn over the finished picture (FS_SHAPES, see drawShapes in js/app.js);
// what they swallow is dragged into every loop's trails (SWALLOW, used by FS_FEEDBACK in js/shaders.js). This file
// also moves them: wandering, flung by the mouse, bouncing off the edges, pulling on each other and merging.
window.PhosphorShapes = (() => {
const MAX = 8;
// The order is the number the shader knows each by
const KINDS = [
  { id: 'circle', label: 'Circle', flat: true }, { id: 'triangle', label: 'Triangle', flat: true },
  { id: 'square', label: 'Square', flat: true }, { id: 'star', label: 'Star', flat: true },
  { id: 'hexagon', label: 'Hexagon', flat: true },
  { id: 'sphere', label: 'Sphere' }, { id: 'cube', label: 'Cube' }, { id: 'pyramid', label: 'Pyramid' },
  { id: 'diamond', label: 'Diamond' }, { id: 'donut', label: 'Donut' }, { id: 'planet', label: 'Ringed planet' },
];
const KIND_NUM = Object.fromEntries(KINDS.map((k, i) => [k.id, i]));

// What a new shape starts with (the sliders' values, 0 to 100, except tilt in degrees)
const DEFAULTS = { kind: 'sphere', wire: false, color: '#202024', size: 45, gravity: 50, swallow: 40, disk: 50, tilt: 75, wander: true };
const radiusOf = (size) => 0.03 + 0.12 * size / 100;               // in screen heights
const diskOf = (disk) => (disk < 1 ? 0 : 1.9 + 4.1 * disk / 100);  // the disk's outer edge, in shape radii

// ---------- the shaders that draw them over the picture ----------
// Each shape is drawn first into a square of its own (a "tile", at most TMAX pixels across, so a shape costs
// the same however sharp the picture is), by a shader made just for its kind. Then one pass over the whole
// picture lays the tiles over it, bending the picture behind them.
const TMAX = 320;
const SHARED = `
const float TAU = 6.28318531;
const float D = 6.0;       // how far behind each shape the picture is, in shape radii: sets how wide the lens is
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 pic(vec2 p) {
  vec2 uv = p / vec2(uSim.x / uSim.y, 1.0) + 0.5;
  vec2 m = mod(uv, 2.0);
  return texture(uPic, mix(m, 2.0 - m, step(1.0, m))).rgb;
}
// How far out (in shape radii) a shape's tile reaches, for a disk this wide
float extent(float dsz) { return max(dsz, 1.8) + 1.0; }
// Far out, the bend is worked out directly: a point lens, with a soft edge so it doesn't reach the whole screen
vec2 farLens(vec2 q, float g, float lens) {
  float rq = length(q), thE2 = 2.0 * g * D, far = 4.0 * sqrt(thE2) + 4.0;
  return mix(q, q - q * thE2 / max(rq * rq, 0.5) * smoothstep(far, far * 0.35, rq), lens);
}
`;
// Where a tile's offsets go when the picture can't hold numbers below 0 (see FROM_K)
const FROM_K = 32.0;
const tileFS = (kind, wire, float) => `#version 300 es
precision highp float;
#define KIND ${kind}
#define WIRE ${wire ? 'true' : 'false'}
uniform sampler2D uPic;
uniform vec2 uSim;
uniform vec4 uA;   // where (x, y, in screen heights from the middle), radius, gravity (0 to 1)
uniform vec4 uB;   // kind, wireframe (0 or 1), the disk's tilt (radians), how much it bends the view (0 to 1)
uniform vec4 uC;   // the shape's colour, the disk's outer edge (in shape radii; 0 for no disk)
uniform vec4 uE;   // which way the disk turns (1 or -1), its own clock, how brightly it shows it's picked, tile size
uniform mat3 uR;   // how the shape is turned
uniform vec2 uOrigin;   // the tile's corner, in pixels
layout(location = 0) out vec4 oCol;    // the shape's light and how much it covers
layout(location = 1) out vec4 oFrom;   // where the light that gets past comes from (shape radii, from here)
${SHARED}
// ----- the flat shapes (Inigo Quilez's distance functions), stood up as thin slabs -----
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float sdBox2(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdStar(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994, -0.587785252);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdHex(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float flat2(vec2 p, int kind) {
  if (kind == 0) return length(p) - 1.0;
  if (kind == 1) return sdTri(p, 0.95);
  if (kind == 2) return sdBox2(p, vec2(0.78));
  if (kind == 3) return sdStar(p, 1.05, 0.45);
  return sdHex(p, 0.9);
}
float slab(float d2, float z, float h) {
  vec2 w = vec2(d2, abs(z) - h);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
}
// ----- the solid shapes -----
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdBoxFrame(vec3 p, vec3 b, float e) {
  p = abs(p) - b;
  vec3 q = abs(p + e) - e;
  return min(min(
    length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
    length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
    length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}
float sdSeg(vec3 p, vec3 a, vec3 b) {
  vec3 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
float sdPyramid(vec3 p) {
  // A square base 1.4 across at y = -0.55, its point at y = 0.85
  const float h = 1.0;
  p.y += 0.55; p /= 1.4;
  float m2 = h * h + 0.25;
  p.xz = abs(p.xz);
  p.xz = (p.z > p.x) ? p.zx : p.xz;
  p.xz -= 0.5;
  vec3 q = vec3(p.z, h * p.y - 0.5 * p.x, h * p.x + 0.5 * p.y);
  float s = max(-q.x, 0.0);
  float t = clamp((q.y - 0.5 * p.z) / (m2 + 0.25), 0.0, 1.0);
  float a = m2 * (q.x + s) * (q.x + s) + q.y * q.y;
  float b = m2 * (q.x + 0.5 * t) * (q.x + 0.5 * t) + (q.y - m2 * t) * (q.y - m2 * t);
  float d2 = min(q.y, -q.x * m2 - q.y * 0.5) > 0.0 ? 0.0 : min(a, b);
  return sqrt((d2 + q.z * q.z) / m2) * sign(max(q.z, -p.y)) * 1.4;
}
float sdTorus(vec3 p, vec2 t) { return length(vec2(length(p.xz) - t.x, p.y)) - t.y; }
float ringXZ(vec3 p, float r, float y, float e) { return length(vec2(length(p.xz) - r, p.y - y)) - e; }
const float WT = 0.035;   // how thick the wires are
float wireSphere(vec3 p, float r) {
  float d = ringXZ(p, r, 0.0, WT);
  d = min(d, ringXZ(p, r * 0.8, r * 0.6, WT));
  d = min(d, ringXZ(p, r * 0.8, -r * 0.6, WT));
  d = min(d, ringXZ(p.yxz, r, 0.0, WT));
  d = min(d, ringXZ(p.xzy, r, 0.0, WT));
  return d;
}
// The body: how far this point is from it, and what it's made of (1 the body, 2 a planet's ring)
float body(vec3 p, out float mat) {
  const int kind = KIND;
  const bool wire = WIRE;
  mat = 1.0;
  if (kind <= 4) {
    float d2 = flat2(p.xy, kind);
    if (wire) d2 = abs(d2) - 0.05;
    return slab(d2, p.z, wire ? 0.05 : 0.12);
  }
  if (kind == 5) return wire ? wireSphere(p, 1.0) : length(p) - 1.0;
  if (kind == 6) return wire ? sdBoxFrame(p, vec3(0.62), WT) : sdBox(p, vec3(0.58)) - 0.04;
  if (kind == 7) {
    if (!wire) return sdPyramid(p);
    vec3 q = vec3(abs(p.x), p.y, abs(p.z));
    vec3 apex = vec3(0.0, 0.85, 0.0), c = vec3(0.7, -0.55, 0.7);
    float d = sdSeg(q, apex, c);
    d = min(d, sdSeg(q, c, vec3(0.7, -0.55, 0.0)));
    d = min(d, sdSeg(q, c, vec3(0.0, -0.55, 0.7)));
    return d - WT;
  }
  if (kind == 8) {
    if (!wire) return (abs(p.x) + abs(p.y) * 0.8 + abs(p.z) - 0.95) * 0.57735;
    vec3 q = abs(p);
    vec3 a = vec3(0.95, 0.0, 0.0), b = vec3(0.0, 1.19, 0.0), c = vec3(0.0, 0.0, 0.95);
    return min(sdSeg(q, a, b), min(sdSeg(q, b, c), sdSeg(q, c, a))) - WT;
  }
  if (kind == 9) {
    if (!wire) return sdTorus(p, vec2(0.7, 0.3));
    float d = min(ringXZ(p, 1.0, 0.0, WT), ringXZ(p, 0.4, 0.0, WT));
    d = min(d, min(ringXZ(p, 0.7, 0.3, WT), ringXZ(p, 0.7, -0.3, WT)));
    // eight small rings round the tube
    float a = atan(p.z, p.x), seg = TAU / 8.0;
    float ac = (floor(a / seg) + 0.5) * seg;
    vec2 rr = vec2(cos(ac), sin(ac));
    float rad = dot(p.xz, rr), tan_ = dot(p.xz, vec2(-rr.y, rr.x));
    d = min(d, length(vec2(length(vec2(rad - 0.7, p.y)) - 0.3, tan_)) - WT);
    return d;
  }
  // The ringed planet
  float ball = wire ? wireSphere(p, 0.72) : length(p) - 0.72;
  float rr = length(p.xz);
  float ring = wire ? min(ringXZ(p, 1.05, 0.0, WT * 0.8), ringXZ(p, 1.5, 0.0, WT * 0.8))
                    : max(abs(rr - 1.27) - 0.23, abs(p.y) - 0.012);
  if (ring < ball) { mat = 2.0; return ring; }
  return ball;
}
// The picture's own pixels, falling in: each spot of the disk shows what was a little further out and a little way
// back round, so whatever is around the shape is wound into a glowing whirl
vec3 dsample(vec2 c, float R, float r, float sa, float turn, out float streak) {
  streak = (0.55 + 0.45 * sin(sa * 7.0 + r * 9.0 + 1.5 * sin(r * 3.7 + sa * 3.0))) * (0.75 + 0.25 * sin(sa * 3.0 - r * 17.0));
  vec2 dA = vec2(cos(sa), sin(sa)), dB = vec2(cos(sa - 0.35 * turn), sin(sa - 0.35 * turn));
  return 0.5 * (pic(c + R * r * 1.3 * dA) + pic(c + R * r * 1.45 * dB));
}
vec4 disk(vec3 hp, vec3 e1, vec3 e2, vec2 c, float R, float dsz, float g, float turn, float clock, vec3 dir) {
  vec2 d = vec2(dot(hp, e1), dot(hp, e2));
  float r = length(d);
  float rin = 1.45;
  if (r < rin * 0.9 || r > dsz) return vec4(0.0);
  float a = atan(d.y, d.x);
  // The inside turns faster than the outside. So that the whirl never winds up into fine noise, it is wound from
  // two starting points half a turn of its cycle apart, fading from one to the other as each gets old.
  const float CYC = 5.0;
  float om = 1.4 * pow(2.0 / r, 1.5), base = clock * 0.3;
  float t1 = fract(clock / CYC), t2 = fract(clock / CYC + 0.5);
  float w1 = 1.0 - abs(2.0 * t1 - 1.0);
  float s1, s2;
  vec3 p1 = dsample(c, R, r, a - turn * (base + om * t1 * CYC), turn, s1);
  vec3 p2 = dsample(c, R, r, a - turn * (base + om * t2 * CYC), turn, s2);
  vec3 px = mix(p2, p1, w1);
  float streak = mix(s2, s1, w1);
  float T = pow(rin / r, 0.9);   // hotter further in
  vec3 col = px * (0.7 + 1.6 * T) * (0.55 + 0.6 * streak) + px * px * T * 1.2;
  // The side coming towards you shines brighter
  vec3 v = turn * normalize(-d.y * e1 + d.x * e2);
  col *= pow(1.0 + 0.5 * dot(v, -dir), 2.0);
  float edge = smoothstep(rin * 0.9, rin * 1.3, r) * smoothstep(dsz, mix(rin, dsz, 0.55), r);
  float amt = smoothstep(0.0, 0.25, g);
  float al = edge * amt * clamp(0.3 + 2.5 * luma(px), 0.0, 0.95) * (0.65 + 0.35 * streak);
  return vec4(col * edge * amt, al);
}
// One shape: follows the light back from the eye past it. Its pull bends the light, so the disk's far side shows
// over the top and underneath, and the picture behind smears round it. Gives the shape's light and cover, and
// where in the picture (in shape radii from its middle) the light that gets past it comes from.
vec4 shape(vec2 p, out vec2 from) {
  vec2 c = uA.xy; float R = uA.z, g = uA.w;
  const bool wire = WIRE;
  float tilt = uB.z, lens = uB.w, dsz = uC.w;
  vec2 q = (p - c) / R;
  float rq = length(q);
  vec2 lensQ = farLens(q, g, lens);
  float rb = extent(dsz) - 0.4;
  if (rq > rb + 0.4) { from = lensQ; return vec4(0.0); }

  mat3 M = uR;
  vec3 n = vec3(0.0, sin(tilt), -cos(tilt));
  vec3 e1 = vec3(1.0, 0.0, 0.0), e2 = cross(e1, n);
  // The light starts where it first comes within reach of the shape
  float h2 = dot(q, q);
  vec3 pos = vec3(q, -sqrt(max((rb + 0.4) * (rb + 0.4) - h2, 0.0))), dir = vec3(0.0, 0.0, 1.0);
  float G = 1.5 * g;
  vec3 col = vec3(0.0); float al = 0.0, glow = 0.0, minR = 1e5;
  bool hit = false, gone = false;
  vec3 cl = uC.rgb;
  for (int s = 0; s < 90; s++) {
    float r = length(pos);
    minR = min(minR, r);
    float dt = clamp(0.11 * r * r / (r + 1.5), 0.035, 0.7);
    if (r < 1.75) {
      float m, dd = body(M * pos, m);
      if (wire) glow += exp(-max(dd, 0.0) * 22.0) * dt * 1.2;
      if (dd < 0.003) {
        // Lit from the upper left, with the picture round it shining on its edges
        const float e = 0.004;
        vec3 bp = M * pos;
        float m2;
        vec3 nb = normalize(vec3(
          body(bp + vec3(e, 0, 0), m2) - body(bp - vec3(e, 0, 0), m2),
          body(bp + vec3(0, e, 0), m2) - body(bp - vec3(0, e, 0), m2),
          body(bp + vec3(0, 0, e), m2) - body(bp - vec3(0, 0, e), m2)));
        vec3 N = transpose(M) * nb, V = -dir;
        vec3 L = normalize(vec3(-0.5, 0.65, -0.6));
        vec3 base = m > 1.5 ? mix(cl, vec3(0.85, 0.8, 0.7), 0.45) : cl;
        float dif = max(dot(N, L), 0.0);
        float spec = pow(max(dot(reflect(-L, N), V), 0.0), 28.0);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 env = pic(c + R * (pos.xy + N.xy * 1.2));
        vec3 sh = wire ? cl * 1.3 + vec3(0.25) * dif
                       : base * (0.1 + 0.9 * dif) + vec3(0.55) * spec + env * rim * 1.1 + base * env * 0.25;
        col += (1.0 - al) * sh;
        al = 1.0; hit = true;
        break;
      }
      dt = min(dt, max(dd * 0.9, 0.003));
    }
    // Light that gets this close never comes out again (closer in than any shape's face, so none shows a hole)
    if (r < 0.08 * sqrt(g)) { gone = true; break; }
    vec3 acc = -G * h2 * pos / (r * r * r * r * r);
    vec3 np = pos + dir * dt;
    dir = normalize(dir + acc * dt);
    float a0 = dot(pos, n), a1 = dot(np, n);
    if (dsz > 0.0 && a0 * a1 < 0.0) {
      vec3 hp = mix(pos, np, a0 / (a0 - a1));
      vec4 dk = disk(hp, e1, e2, c, R, dsz, g, uE.x, uE.y, dir);
      col += (1.0 - al) * dk.rgb;
      al += (1.0 - al) * dk.a;
      if (al > 0.98) break;
    }
    pos = np;
    if (r > rb + 0.5 && dot(pos, dir) > 0.0) break;
  }
  if (wire) { col += (1.0 - al) * cl * min(glow, 1.5) * 0.6; al = max(al, min(glow * 0.3, 0.6)); }
  if (gone || hit) { from = q; return vec4(col, 1.0); }
  // A thin ring of light hugging the edge of the shadow
  if (g > 0.05) col += (1.0 - al) * mix(cl, vec3(1.0), 0.6) * 0.22 * g * exp(-max(minR - 1.1, 0.0) * 6.0);
  float t = max(D - pos.z, 0.0) / max(dir.z, 0.15);
  vec2 marched = mix(q, pos.xy + dir.xy * t, lens);
  from = mix(marched, lensQ, smoothstep(rb - 0.3, rb + 0.4, rq));
  return vec4(col, al);
}
void main() {
  float E = extent(uC.w);
  vec2 f = (gl_FragCoord.xy - uOrigin) / uE.w;
  vec2 q = (f * 2.0 - 1.0) * E;
  vec2 from;
  oCol = shape(uA.xy + q * uA.z, from);
  vec2 d = from - q;
  oFrom = ${float ? 'vec4(d, 0.0, 1.0)' : 'vec4(clamp(d / FROM_K + 0.5, 0.0, 1.0), 0.0, 1.0)'};
}`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uPic, uTileCol, uTileFrom;
uniform vec2 uSim;
uniform float uTime, uFloat;
uniform int uN;
uniform vec4 uA[${MAX}];   // as in the tiles
uniform vec4 uB[${MAX}];
uniform vec4 uC[${MAX}];
uniform vec4 uE[${MAX}];
out vec4 o;
${SHARED}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  const vec2 ATLAS = vec2(${TMAX * MAX}.0, ${TMAX}.0);
  vec2 off = vec2(0.0);
  vec3 C = vec3(0.0); float A = 0.0;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uN) break;
    float R = uA[i].z, E = extent(uC[i].w), T = uE[i].w;
    vec2 q = (p - uA[i].xy) / R;
    vec4 L = vec4(0.0);
    vec2 d;
    if (length(q) < E - 0.05) {
      vec2 f = clamp(q / (2.0 * E) + 0.5, 0.5 / T, 1.0 - 0.5 / T);
      vec2 uv = (vec2(float(i * ${TMAX}), 0.0) + f * T) / ATLAS;
      L = texture(uTileCol, uv);
      vec2 raw = texture(uTileFrom, uv).xy;
      d = uFloat > 0.5 ? raw : (raw - 0.5) * ${FROM_K.toFixed(1)};
    } else {
      d = farLens(q, uA[i].w, uB[i].w) - q;
    }
    off += d * R;
    C += (1.0 - A) * L.rgb; A += (1.0 - A) * L.a;
    // The picked shape shows a dashed ring for a moment
    if (uE[i].z > 0.0) {
      float dd = abs(length(q) - 1.35) * R * uSim.y;
      float dash = step(0.5, fract(atan(q.y, q.x) / TAU * 24.0 + uTime * 0.5));
      C += vec3(0.9, 0.95, 1.0) * smoothstep(1.6, 0.4, dd) * dash * uE[i].z;
    }
  }
  vec3 bg = pic(p + off);
  o = vec4(C + (1.0 - A) * bg, 1.0);
}`;

// ---------- what each loop's feedback pass adds, so a shape swallows the trails ----------
// Each spot takes its colour from a little further out and a little round, so the picture is pulled in and wound
// round the shape, and what reaches the shape itself is gone.
const SWALLOW = `
uniform int uSwN;
uniform vec4 uSw[${MAX}];   // where (x, y), radius, how far it pulls this frame (its sign the way it turns)
vec2 swallow(vec2 p, inout float eaten) {
  vec2 off = vec2(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uSwN) break;
    vec4 s = uSw[i];
    vec2 d = p - s.xy;
    float r = max(length(d), 1e-4), R = s.z;
    float k = min(abs(s.w) * R * R / (r * r + 0.3 * R * R), r * 0.25);
    vec2 u = d / r;
    off += u * k + vec2(-u.y, u.x) * sign(s.w) * k * 1.6;
    eaten *= mix(1.0, smoothstep(R * 0.5, R * 1.05, r), min(abs(s.w) * 200.0, 1.0));
  }
  return off;
}`;

// ---------- the shapes themselves, and how they move ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let nextId = 1;
function eulerMat(ax, ay, az, out, o) {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  // Rz * Ry * Rx, written column by column (as WebGL wants it); it turns a point on screen into the shape's own frame
  const m = [cb * cc, cb * sc, -sb,
             sa * sb * cc - ca * sc, sa * sb * sc + ca * cc, sa * cb,
             ca * sb * cc + sa * sc, ca * sb * sc - sa * cc, ca * cb];
  for (let i = 0; i < 9; i++) out[o + i] = m[i];
}
function hexRGB(h) {
  const n = parseInt(String(h).replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

class World {
  constructor() { this.list = []; this.held = null; this.aspect = 16 / 9; }
  get count() { return this.list.filter((s) => !s.dying).length; }
  byId(id) { return this.list.find((s) => s.id === id) || null; }
  add(opts = {}, x, y) {
    if (this.count >= MAX) return null;
    const o = { ...DEFAULTS, ...opts };
    const a = this.aspect;
    const s = {
      id: nextId++, kind: KIND_NUM[o.kind] != null ? o.kind : 'sphere', wire: !!o.wire, color: o.color,
      size: o.size, gravity: o.gravity, swallow: o.swallow, disk: o.disk, tilt: o.tilt, wander: !!o.wander,
      x: x ?? (Math.random() - 0.5) * a * 0.7, y: y ?? (Math.random() - 0.5) * 0.7, vx: 0, vy: 0,
      head: Math.random() * Math.PI * 2, turn: 0, ax: Math.random() * 6, ay: Math.random() * 6, az: Math.random() * 6,
      wx: 0.15 + Math.random() * 0.25, wy: 0.2 + Math.random() * 0.3, wz: (Math.random() - 0.5) * 0.4,
      dir: Math.random() < 0.5 ? 1 : -1, clock: Math.random() * 100, life: 0, dying: false, byAp: !!o.byAp, born: performance.now(),
    };
    this.list.push(s);
    this.fit(s);
    return s;
  }
  remove(id) { const s = this.byId(id); if (s) s.dying = true; if (this.held && this.held.s === s) this.held = null; }
  clear() { for (const s of this.list) s.dying = true; this.held = null; }
  radius(s) { return radiusOf(s.size) * s.life; }
  // The shape under this spot (the one in front, if they overlap)
  hit(x, y) {
    for (const s of this.list) {
      if (s.dying) continue;
      const R = radiusOf(s.size);
      if (Math.hypot(x - s.x, y - s.y) < Math.max(R * 1.25, 0.035)) return s;
    }
    return null;
  }
  grab(s, x, y, t) { this.held = { s, dx: s.x - x, dy: s.y - y, trail: [[t, x, y]] }; s.vx = s.vy = 0; }
  drag(x, y, t) {
    const h = this.held;
    if (!h) return;
    h.s.x = x + h.dx; h.s.y = y + h.dy; this.fit(h.s, true);
    h.trail.push([t, x, y]);
    while (h.trail.length > 3 && t - h.trail[0][0] > 300) h.trail.shift();
  }
  // Let go: it flies off as fast as the mouse was moving
  release(t) {
    const h = this.held;
    if (!h) return;
    this.held = null;
    // Over the last tenth of a second or so (longer when the picture draws slowly, as the mouse is only heard once
    // a frame); held still before letting go, it stays put
    const tr = h.trail, b = tr[tr.length - 1];
    const gap = tr.length > 1 ? b[0] - tr[tr.length - 2][0] : 0;   // how often the mouse is heard
    const a = tr.find((p) => b[0] - p[0] <= Math.max(250, 1.5 * gap) && p !== b) || null;
    if (a && t - b[0] < Math.max(200, 2 * gap)) {
      const span = Math.max(16, b[0] - a[0]) / 1000;
      let vx = (b[1] - a[1]) / span, vy = (b[2] - a[2]) / span;
      const sp = Math.hypot(vx, vy);
      if (sp > 4) { vx *= 4 / sp; vy *= 4 / sp; }
      h.s.vx = vx; h.s.vy = vy;
      if (sp > 0.05) h.s.head = Math.atan2(vy, vx);
    }
  }
  // Keeps a shape inside the screen, bouncing it back off an edge
  fit(s, still) {
    const R = radiusOf(s.size), hx = this.aspect / 2 - R, hy = 0.5 - R, k = still ? 0 : -0.85;
    let hit = false;
    if (s.x < -hx) { s.x = -hx; if (s.vx < 0) { s.vx *= k; hit = true; } }
    if (s.x > hx) { s.x = hx; if (s.vx > 0) { s.vx *= k; hit = true; } }
    if (s.y < -hy) { s.y = -hy; if (s.vy < 0) { s.vy *= k; hit = true; } }
    if (s.y > hy) { s.y = hy; if (s.vy > 0) { s.vy *= k; hit = true; } }
    // A wandering shape heads off the way it bounced
    if (hit && s.wander && !still) s.head = Math.atan2(s.vy, s.vx);
  }
  mass(s) { const R = radiusOf(s.size) / 0.084; return (s.gravity / 100) * R * R * R; }
  step(dt, aspect) {
    this.aspect = aspect;
    const L = this.list, held = this.held && this.held.s;
    for (const s of L) {
      s.life = s.dying ? s.life - dt / 0.8 : Math.min(1, s.life + dt / 0.8);
      s.clock += dt * (0.4 + 1.2 * s.gravity / 100);
      s.ax += s.wx * dt; s.ay += s.wy * dt; s.az += s.wz * dt;
    }
    for (let i = L.length - 1; i >= 0; i--) if (L[i].dying && L[i].life <= 0) L.splice(i, 1);
    for (const s of L) {
      if (s === held || s.dying) continue;
      // The others' pull (a shape left where it was put stays put, but still pulls)
      if (s.wander) {
        let ax = 0, ay = 0;
        for (const o of L) {
          if (o === s || o.dying) continue;
          const dx = o.x - s.x, dy = o.y - s.y, d2 = dx * dx + dy * dy + 0.002, d = Math.sqrt(d2);
          const a = 0.006 * this.mass(o) / d2;
          ax += a * dx / d; ay += a * dy / d;
        }
        s.vx += ax * dt; s.vy += ay * dt;
        // Wandering: a gentle drift whose heading turns now and then; a fling slows back to it over a few seconds
        s.turn += (Math.random() - 0.5) * dt * 4; s.turn *= Math.exp(-dt * 0.7); s.head += s.turn * dt;
        const W = 0.05, e = 1 - Math.exp(-dt * 0.5);
        s.vx += (Math.cos(s.head) * W - s.vx) * e; s.vy += (Math.sin(s.head) * W - s.vy) * e;
      } else {
        const e = Math.exp(-dt * 0.9);
        s.vx *= e; s.vy *= e;
      }
      s.x += s.vx * dt; s.y += s.vy * dt;
      this.fit(s);
    }
    // Two that touch merge into one bigger shape with both their pulls, looking like the bigger one
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      if (a.dying || b.dying || a.life < 1 || b.life < 1) continue;
      const Ra = radiusOf(a.size), Rb = radiusOf(b.size);
      if (Math.hypot(a.x - b.x, a.y - b.y) > (Ra + Rb) * 0.7) continue;
      const [big, small] = Ra >= Rb ? [a, b] : [b, a];
      const mb = Math.pow(radiusOf(big.size), 3), ms = Math.pow(radiusOf(small.size), 3);
      const R = Math.min(0.15, Math.cbrt(mb + ms));
      const w = ms / (mb + ms);
      big.x += (small.x - big.x) * w; big.y += (small.y - big.y) * w;
      big.vx += (small.vx - big.vx) * w; big.vy += (small.vy - big.vy) * w;
      big.size = clamp((R - 0.03) / 0.12 * 100, 0, 100);
      big.gravity = Math.min(100, big.gravity + small.gravity);
      big.disk = Math.max(big.disk, small.disk);
      big.wander = big.wander && small.wander;
      big.byAp = big.byAp && small.byAp;
      if (this.held && this.held.s === small) this.held.s = big;
      small.dying = true; small.life = 0;
      this.merged = { from: small.id, into: big.id };
    }
  }
  // The shader's numbers, front to back (the newest in front)
  pack(sel, selGlow, simH) {
    const L = this.list.filter((s) => s.life > 0).slice(-MAX).reverse();
    const A = new Float32Array(MAX * 4), B = new Float32Array(MAX * 4), C = new Float32Array(MAX * 4);
    const E = new Float32Array(MAX * 4), R = new Float32Array(MAX * 9), kinds = [];
    L.forEach((s, i) => {
      const k = KIND_NUM[s.kind], flat = KINDS[k].flat;
      const e = s.life * s.life * (3 - 2 * s.life), r = Math.max(1e-4, radiusOf(s.size) * e), dsz = diskOf(s.disk);
      // The tile: as many pixels across as the shape's reach covers on screen, up to TMAX
      const T = clamp(Math.ceil(2 * (Math.max(dsz, 1.8) + 1) * r * simH), 16, TMAX);
      A.set([s.x, s.y, r, (s.gravity / 100) * e], i * 4);
      B.set([k, s.wire ? 1 : 0, s.tilt * Math.PI / 180, 1 - s.swallow / 100], i * 4);
      C.set([...hexRGB(s.color), dsz], i * 4);
      E.set([s.dir, s.clock, s.id === sel ? selGlow : 0, T], i * 4);
      kinds.push([k, s.wire]);
      // Flat shapes face you, turning slowly round and rocking a little; solid ones tumble
      if (flat) eulerMat(0.25 * Math.sin(s.ax), 0.35 * Math.sin(s.ay), s.az, R, i * 9);
      else eulerMat(s.ax, s.ay, s.az, R, i * 9);
    });
    return { n: L.length, A, B, C, E, R, kinds };
  }
  // How hard each swallows the trails this frame (f: frames of 1/60 s)
  packSwallow(f) {
    const L = this.list.filter((s) => s.life > 0 && s.swallow > 0 && s.gravity > 0).slice(-MAX);
    const S = new Float32Array(MAX * 4);
    L.forEach((s, i) => {
      const e = s.life * s.life * (3 - 2 * s.life);
      S.set([s.x, s.y, radiusOf(s.size) * e, s.dir * 0.016 * (s.gravity / 100) * (s.swallow / 100) * f * e], i * 4);
    });
    return { n: L.length, S };
  }
}

return { MAX, TMAX, KINDS, KIND_NUM, DEFAULTS, FS, tileFS, SWALLOW, World, radiusOf, diskOf };
})();
