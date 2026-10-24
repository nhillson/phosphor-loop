// Mount Ribbit, the tenth 3D world: a frog king the size of a mountain, sitting on a lily pad above the clouds,
// with a tiny hiker who can walk on every part of him. Gravity always pulls towards the nearest surface, so the hiker
// walks up the belly, over the eyes, onto the crown and upside down under the pad.
//
// Unlike the other worlds (one shader each), the frog is a real mesh drawn with its own small WebGL renderer on a
// canvas of its own; app.js copies that picture into the loop like any other 3D world's. The frog is described as a
// distance field (how far any point is from his skin). The page uses it to keep the hiker's feet on the surface, and
// a background worker uses it once to build the mesh, so building never makes the picture stutter.
(() => {
'use strict';

/* ================= the frog: shared by the page and the background builder ================= */
// Everything here must stand on its own: its source is also handed to a Worker.
function ribbitCore() {
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sstep = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  function smin(a, b, k) { const h = k - Math.abs(a - b); if (h <= 0) return a < b ? a : b; const q = h / k; return (a < b ? a : b) - q * q * k * 0.25; }
  function smax(a, b, k) { return -smin(-a, -b, k); }
  class V3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new V3(this.x, this.y, this.z); }
    subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    crossVectors(a, b) { const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; this.x = x; this.y = y; this.z = z; return this; }
    lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    length() { return Math.sqrt(this.lengthSq()); }
    normalize() { const l = this.length(); if (l > 1e-12) { this.x /= l; this.y /= l; this.z /= l; } return this; }
    lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
    distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
    distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  }
  // Shapes, as distances
  function sphere(cx, cy, cz, r) { return (x, y, z) => { const dx = x - cx, dy = y - cy, dz = z - cz; return Math.sqrt(dx * dx + dy * dy + dz * dz) - r; }; }
  function ellipsoid(cx, cy, cz, rx, ry, rz) {
    const irx = 1 / rx, iry = 1 / ry, irz = 1 / rz, irx2 = irx * irx, iry2 = iry * iry, irz2 = irz * irz, mr = Math.min(rx, ry, rz);
    return (x, y, z) => {
      const px = x - cx, py = y - cy, pz = z - cz, ax = px * irx, ay = py * iry, az = pz * irz, k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      const bx = px * irx2, by = py * iry2, bz = pz * irz2, k1 = Math.sqrt(bx * bx + by * by + bz * bz);
      return k1 < 1e-9 ? -mr : k0 * (k0 - 1) / k1;
    };
  }
  function roundCone(ax, ay, az, bx, by, bz, r1, r2) {
    const bax = bx - ax, bay = by - ay, baz = bz - az, l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2, srr = Math.sign(rr) * rr * rr;
    return (x, y, z) => {
      const pax = x - ax, pay = y - ay, paz = z - az, yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
      const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy, x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2, z2 = zz * zz * l2, k = srr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    };
  }
  function roundDisc(cx, cy, cz, R, h, rb) {
    return (x, y, z) => {
      const dx = x - cx, dz = z - cz, qx = Math.sqrt(dx * dx + dz * dz) - (R - rb), qy = Math.abs(y - cy) - (h - rb);
      const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0;
      return Math.min(Math.max(qx, qy), 0) + Math.sqrt(mx * mx + my * my) - rb;
    };
  }
  // The frog king (facing +z), his crown, and the lily pad with its notch, dewdrops and stem
  const FROG = [], CROWN = [], EYES = [];
  const F = (name, tag, k, fn, s) => FROG.push({ name, tag, k, fn, s: s || 0 });
  const C = (name, tag, k, fn) => CROWN.push({ name, tag, k, fn });
  F('Hips', 'torso', 0, ellipsoid(0, 10.5, -2, 14, 9.6, 13.5));
  F('Chest', 'torso', 5, ellipsoid(0, 19.5, 3, 12.5, 11, 11));
  F('Throat', 'throat', 3, ellipsoid(0, 24, 12, 10, 4.5, 7));
  F('Head', 'head', 4, ellipsoid(0, 29, 8, 14, 7.5, 11.5));
  F('Snout', 'head', 3, ellipsoid(0, 28.2, 13.5, 10.5, 5.8, 6.5));
  for (const s of [1, -1]) {
    const side = s > 0 ? 'Left' : 'Right';
    F(side + ' eye', 'eye', 2.2, sphere(s * 7.6, 35.2, 9.5, 4.5), s);
    { const f = new V3(s * 0.3, 0.06, 1).normalize(), r = new V3(f.z, 0, -f.x).normalize(), u = new V3().crossVectors(f, r); EYES.push({ s, c: new V3(s * 7.6, 35.2, 9.5), f, r, u }); }
    F(side + ' arm', 'arm', 2.5, roundCone(s * 10, 21, 8, s * 13.5, 11, 15, 3.2, 2.4), s);
    F(side + ' arm', 'arm', 1.0, roundCone(s * 13.5, 11, 15, s * 12, 2.8, 19.5, 2.4, 1.8), s);
    F(side + ' hand', 'hand', 1.0, ellipsoid(s * 12, 2.1, 20.5, 3.2, 1.2, 2.8), s);
    for (const a of [-35, -10, 15, 42]) {
      const r = a * Math.PI / 180, dx = s * Math.sin(r), dz = Math.cos(r), ex = s * 12 + dx * 4.8, ez = 20.5 + dz * 4.8;
      F(side + ' fingers', 'finger', 0.6, roundCone(s * 12, 2.0, 20.5, ex, 1.9, ez, 0.85, 0.6), s);
      F(side + ' fingers', 'tip', 0.4, sphere(ex + dx * 0.3, 1.95, ez + dz * 0.3, 0.95), s);
    }
    F(side + ' thigh', 'leg', 3, ellipsoid(s * 13, 8.5, -4, 6, 7, 10.5), s);
    F(side + ' leg', 'leg', 1.5, roundCone(s * 15.5, 6.5, 6, s * 17.5, 3.2, -7.5, 3.6, 2.5), s);
    F(side + ' foot', 'foot', 1.2, roundCone(s * 17.5, 2.6, -7.5, s * 21, 2.0, 3, 2.3, 1.4), s);
    for (const a of [-20, 5, 30, 55]) {
      const r = a * Math.PI / 180, dx = s * Math.sin(r), dz = Math.cos(r), ex = s * 21 + dx * 6.5, ez = 3 + dz * 6.5;
      F(side + ' toes', 'toe', 0.5, roundCone(s * 21, 1.9, 3, ex, 1.85, ez, 0.8, 0.55), s);
      F(side + ' toes', 'tip', 0.4, sphere(ex + dx * 0.35, 1.9, ez + dz * 0.35, 1.05), s);
    }
  }
  C('The crown', 'crown', 0, roundDisc(0, 37.0, 3.5, 3.3, 1.5, 0.45));
  for (let i = 0; i < 5; i++) {
    const t = Math.PI / 2 + i * 2 * Math.PI / 5, c = Math.cos(t), s = Math.sin(t);
    C('Crown spike', 'spike', 0.35, roundCone(3.0 * c, 38.0, 3.5 + 3.0 * s, 3.25 * c, 41.3, 3.5 + 3.25 * s, 0.8, 0.45));
    C('Crown spike', 'pearl', 0.2, sphere(3.25 * c, 41.7, 3.5 + 3.25 * s, 0.62));
  }
  for (const t of [Math.PI / 2, Math.PI / 2 + 0.95, Math.PI / 2 - 0.95, -Math.PI / 2]) C('Crown jewel', 'gem', 0.15, sphere(3.38 * Math.cos(t), 37.0, 3.5 + 3.38 * Math.sin(t), 0.62));
  const NF = FROG.length, NCR = CROWN.length;
  for (const p of FROG) p.tb = p.tag === 'torso' || p.tag === 'throat' || p.tag === 'head';
  const PAD_DISC = roundDisc(0, 0, 0, 46, 1.0, 0.9);
  const NOTCH_A = 11 * Math.PI / 180, NOTCH_C = Math.cos(NOTCH_A), NOTCH_S = Math.sin(NOTCH_A), NOTCH_Z = -24;
  const DROPS = [[36, -14, 2.2], [30, 24, 1.4], [-34, -6, 1.7], [-18, 33, 1.2], [16, -34, 1.5], [-26, -28, 1.3]].map(([x, z, r]) => ({ fn: sphere(x, 1 + r * 0.25, z, r) }));
  const STEM1 = roundCone(0, -0.6, -3, 2.5, -17, -5, 2.4, 1.7), STEM2 = roundCone(2.5, -17, -5, -0.5, -33, -2.5, 1.7, 1.15);
  function padCore(x, y, z) { const d = PAD_DISC(x, y, z), u = x < 0 ? -x : x, v = -(z - NOTCH_Z); return smax(d, -(u * NOTCH_C - v * NOTCH_S), 1.2); }
  function dropsD(x, y, z) { let m = 1e9; for (let i = 0; i < DROPS.length; i++) { const v = DROPS[i].fn(x, y, z); if (v < m) m = v; } return m; }
  function stemD(x, y, z) { return smin(STEM1(x, y, z), STEM2(x, y, z), 1.0); }
  function padD(x, y, z) { return smin(smin(padCore(x, y, z), dropsD(x, y, z), 0.7), stemD(x, y, z), 2.5); }
  function frogD(x, y, z) { let d = FROG[0].fn(x, y, z); for (let i = 1; i < NF; i++) { const p = FROG[i]; d = smin(d, p.fn(x, y, z), p.k); } return d; }
  function crownD(x, y, z) { let d = CROWN[0].fn(x, y, z); for (let i = 1; i < NCR; i++) { const p = CROWN[i]; d = smin(d, p.fn(x, y, z), p.k); } return d; }
  // How far a point is from the nearest surface (negative inside). Bounding spheres skip the frog far from him.
  function sdf(x, y, z) {
    let d = padD(x, y, z);
    const fy = y - 21, fz = z - 3;
    if (Math.sqrt(x * x + fy * fy + fz * fz) - 37 < d + 1.0) {
      let f = frogD(x, y, z);
      const cy = y - 38.6, cz = z - 3.5;
      if (Math.sqrt(x * x + cy * cy + cz * cz) - 6.2 < f + 0.8) f = smin(f, crownD(x, y, z), 0.8);
      d = smin(f, d, 1.0);
    }
    return d;
  }
  const _g = new V3();
  function gradAt(x, y, z, out) {
    const e = 0.05, a = sdf(x + e, y - e, z - e), b = sdf(x - e, y - e, z + e), c = sdf(x - e, y + e, z - e), d = sdf(x + e, y + e, z + e);
    out.set(a - b - c + d, -a - b + c + d, -a + b - c + d);
    const l = out.length();
    if (l > 1e-9) out.multiplyScalar(1 / l); else out.set(0, 1, 0);
    return out;
  }
  function project(p, iters) {
    for (let i = 0; i < iters; i++) {
      const d = sdf(p.x, p.y, p.z);
      if (Math.abs(d) < 2e-4) break;
      gradAt(p.x, p.y, p.z, _g);
      p.addScaledVector(_g, -clamp(d, -3, 3));
    }
    return p;
  }
  // Which part of the scene a point is nearest, for painting
  const INF = { dF: 0, fp: 0, dC: 0, cp: 0, dP: 0, dD: 0, dS: 0, dTH: 0, dOT: 0 };
  function info(x, y, z) {
    let d = FROG[0].fn(x, y, z), mn = d, fp = 0, dTH = d, dOT = 1e9;
    for (let i = 1; i < NF; i++) {
      const p = FROG[i], r = p.fn(x, y, z);
      if (r < mn) { mn = r; fp = i; }
      d = smin(d, r, p.k);
      if (p.tb) { if (r < dTH) dTH = r; } else if (r < dOT) dOT = r;
    }
    INF.dF = d; INF.fp = fp; INF.dTH = dTH; INF.dOT = dOT;
    let c = CROWN[0].fn(x, y, z), cm = c, cp = 0;
    for (let i = 1; i < NCR; i++) { const p = CROWN[i], r = p.fn(x, y, z); if (r < cm) { cm = r; cp = i; } c = smin(c, r, p.k); }
    INF.dC = c; INF.cp = cp; INF.dP = padCore(x, y, z); INF.dD = dropsD(x, y, z); INF.dS = stemD(x, y, z);
  }
  // Paint. Broad colours go in the mesh; crisp details (mouth line, eyes, spots, leaf veins) are drawn per pixel by
  // the shader, and the mesh only says where each is allowed (EX: mouth, eye, spots, veins).
  const hx = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const COL = { skin: hx('#7fb33a'), belly: hx('#ece3a2'), mouth: hx('#2a3f17'), blush: hx('#ef9b88'), tip: hx('#b6d862'),
    gold: hx('#ecb63b'), goldDark: hx('#a5721f'), gem: hx('#c4243e'), pearl: hx('#f5efe0'),
    pad: hx('#3c8d5a'), padRim: hx('#7ab95e'), under: hx('#9a4560'), stem: hx('#7c8c3a'), stemDark: hx('#5a6a29'), dew: hx('#c9e6f0') };
  const setc = (o, c) => { o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; };
  const mixc = (o, c, t) => { if (t <= 0) return; o[0] += (c[0] - o[0]) * t; o[1] += (c[1] - o[1]) * t; o[2] += (c[2] - o[2]) * t; };
  function hash3(i, j, k) { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const a = hash3(xi, yi, zi), b = hash3(xi + 1, yi, zi), c = hash3(xi, yi + 1, zi), d = hash3(xi + 1, yi + 1, zi);
    const e = hash3(xi, yi, zi + 1), f = hash3(xi + 1, yi, zi + 1), g = hash3(xi, yi + 1, zi + 1), h = hash3(xi + 1, yi + 1, zi + 1);
    const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (h - g) * u, y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
    return y1 + (y2 - y1) * w;
  }
  const mouthY = (x) => 26.4 + 0.0125 * x * x;
  const DECALS = [];
  for (const s of [1, -1]) {
    DECALS.push({ p: project(new V3(s * 10.6, 28.6, 15), 60), r: 2.3, col: COL.blush, a: 0.75 });
    DECALS.push({ p: project(new V3(s * 2.3, 33.6, 20.5), 60), r: 0.75, col: COL.mouth, a: 1 });
  }
  function frogColor(x, y, z, nx, ny, nz, P, o, ex) {
    setc(o, COL.skin);
    const sh = 0.9 + 0.2 * noise3(x * 0.13 + 3.1, y * 0.13 + 7.7, z * 0.13 + 1.3);
    o[0] *= sh; o[1] *= sh; o[2] *= sh;
    let spots = 1;
    const tag = P.tag;
    ex[0] = 0; ex[1] = 0; ex[3] = 0;
    if (tag === 'tip') { mixc(o, COL.tip, 0.85); spots = 0.2; }
    const wT = sstep(-1.0, 1.0, INF.dOT - INF.dTH);
    if (wT > 0) {
      const ym = mouthY(x), below = sstep(ym + 0.35, ym - 1.0, y);
      let facing = Math.max(sstep(0.05, 0.45, nz), sstep(-0.05, -0.5, ny));
      if (tag === 'throat') facing = Math.max(facing, sstep(0.3, -0.1, ny));
      const bel = below * facing * wT;
      mixc(o, COL.belly, bel);
      spots *= 1 - sstep(0.2, 0.6, bel);
      if (tag === 'head' || tag === 'throat') ex[0] = sstep(-0.55, -0.2, nz) * sstep(1.5, 3.5, z);
      if (tag === 'head') for (const D of DECALS) { const dd = Math.sqrt((x - D.p.x) ** 2 + (y - D.p.y) ** 2 + (z - D.p.z) ** 2); mixc(o, D.col, sstep(D.r, D.r * 0.55, dd) * D.a); }
    }
    if (tag === 'eye') { const onBall = sstep(0.9, 0.2, P.fn(x, y, z)); ex[1] = onBall; spots *= 1 - onBall; }
    ex[2] = spots;
    return 1;
  }
  function crownColor(y, P, o) {
    if (P.tag === 'gem') { setc(o, COL.gem); return 2; }
    if (P.tag === 'pearl') { setc(o, COL.pearl); return 2; }
    setc(o, COL.gold);
    if (P.tag === 'crown') mixc(o, COL.goldDark, 1 - sstep(0.18, 0.42, Math.min(Math.abs(y - 35.95), Math.abs(y - 38.1))));
    return 3;
  }
  function padColor(x, y, z, o, ex) {
    const r = Math.sqrt(x * x + z * z), top = COL.pad.slice(), sh = 0.9 + 0.18 * noise3(x * 0.08, 0.5, z * 0.08);
    top[0] *= sh; top[1] *= sh; top[2] *= sh;
    mixc(top, COL.padRim, sstep(43.6, 45.2, r) * 0.9);
    setc(o, COL.under); mixc(o, top, sstep(-0.55, 0.45, y));
    let veins = 1;
    const ts = sstep(-0.9, 0.9, INF.dP - INF.dS);
    if (ts > 0) { const sc = COL.stem.slice(); mixc(sc, COL.stemDark, (0.5 + 0.5 * Math.sin(Math.atan2(z + 4, x - 1) * 7)) * 0.6); mixc(o, sc, ts); veins *= 1 - ts; }
    const td = sstep(-0.35, 0.35, INF.dP - INF.dD);
    if (td > 0) { mixc(o, COL.dew, td); veins *= 1 - td; }
    ex[0] = 0; ex[1] = 0; ex[2] = 0; ex[3] = veins;
    return td > 0.5 ? 2 : 0;
  }
  const TA = [0, 0, 0], TB = [0, 0, 0], EA = [0, 0, 0, 0], EB = [0, 0, 0, 0];
  function surfaceColor(x, y, z, nx, ny, nz, o, ex) {
    info(x, y, z);
    const dFC = Math.min(INF.dF, INF.dC), dPad = Math.min(INF.dP, INF.dD, INF.dS);
    if (INF.dC < INF.dF && dFC < dPad) { ex[0] = ex[1] = ex[2] = ex[3] = 0; return crownColor(y, CROWN[INF.cp], o); }
    const t = sstep(-0.7, 0.7, dPad - dFC);
    let cf = 1, cp = 0;
    if (t > 0) cf = frogColor(x, y, z, nx, ny, nz, FROG[INF.fp], TA, EA); else { TA[0] = TA[1] = TA[2] = 0; EA.fill(0); }
    if (t < 1) cp = padColor(x, y, z, TB, EB); else { TB[0] = TB[1] = TB[2] = 0; EB.fill(0); }
    for (let i = 0; i < 3; i++) o[i] = TB[i] + (TA[i] - TB[i]) * t;
    for (let i = 0; i < 4; i++) ex[i] = EB[i] + (EA[i] - EB[i]) * t;
    return t >= 0.5 ? cf : cp;
  }
  // The field turned into a mesh (surface nets on a half-unit grid), with colours and the walking graph
  function buildMesh() {
    const H = 0.5, X0 = -48, Y0 = -36, Z0 = -48, NX = 192, NY = 160, NZ = 192, B = 4;
    const PX = NX + 1, PY = NY + 1, PXY = PX * PY;
    const vals = new Float32Array(PX * PY * (NZ + 1)).fill(100);
    const BX = NX / B, BY = NY / B, BZ = NZ / B, thr = 1.6 * (B * H * Math.sqrt(3) / 2) + 0.4;
    const near = [];
    for (let bz = 0; bz < BZ; bz++) for (let by = 0; by < BY; by++) for (let bx = 0; bx < BX; bx++) {
      const d = sdf(X0 + (bx * B + B / 2) * H, Y0 + (by * B + B / 2) * H, Z0 + (bz * B + B / 2) * H);
      if (Math.abs(d) <= thr) near.push(bx, by, bz);
      else if (d < 0) for (let k = bz * B; k <= bz * B + B; k++) for (let j = by * B; j <= by * B + B; j++) { const ix = bx * B + PX * (j + PY * k); for (let i = 0; i <= B; i++) vals[ix + i] = d; }
    }
    const nb = near.length / 3;
    for (let b = 0; b < nb; b++) {
      const i0 = near[3 * b] * B, j0 = near[3 * b + 1] * B, k0 = near[3 * b + 2] * B;
      for (let k = k0; k <= k0 + B; k++) { const z = Z0 + k * H; for (let j = j0; j <= j0 + B; j++) { const y = Y0 + j * H; let ix = i0 + PX * (j + PY * k); for (let i = i0; i <= i0 + B; i++, ix++) vals[ix] = sdf(X0 + i * H, y, z); } }
    }
    const cellV = new Int32Array(NX * NY * NZ).fill(-1);
    const pos = [], nor = [], cells = [];
    let nv = 0;
    const cr = new Float32Array(8), G = new V3();
    const E = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
    for (let b = 0; b < nb; b++) {
      const i0 = near[3 * b] * B, j0 = near[3 * b + 1] * B, k0 = near[3 * b + 2] * B;
      for (let k = k0; k < k0 + B; k++) for (let j = j0; j < j0 + B; j++) for (let i = i0; i < i0 + B; i++) {
        const base = i + PX * (j + PY * k);
        cr[0] = vals[base]; cr[1] = vals[base + 1]; cr[2] = vals[base + PX]; cr[3] = vals[base + PX + 1];
        cr[4] = vals[base + PXY]; cr[5] = vals[base + PXY + 1]; cr[6] = vals[base + PXY + PX]; cr[7] = vals[base + PXY + PX + 1];
        let mask = 0;
        for (let c = 0; c < 8; c++) if (cr[c] < 0) mask |= 1 << c;
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (let e = 0; e < 24; e += 2) {
          const a = E[e], bb = E[e + 1], va = cr[a], vb = cr[bb];
          if ((va < 0) !== (vb < 0)) { const t = va / (va - vb), ax = a & 1, ay = a >> 1 & 1, az = a >> 2 & 1; sx += ax + ((bb & 1) - ax) * t; sy += ay + ((bb >> 1 & 1) - ay) * t; sz += az + ((bb >> 2 & 1) - az) * t; cnt++; }
        }
        let x = X0 + (i + sx / cnt) * H, y = Y0 + (j + sy / cnt) * H, z = Z0 + (k + sz / cnt) * H;
        const d = sdf(x, y, z);
        gradAt(x, y, z, G);
        const mv = clamp(-d, -H * 0.8, H * 0.8);
        x += G.x * mv; y += G.y * mv; z += G.z * mv;
        gradAt(x, y, z, G);
        pos.push(x, y, z); nor.push(G.x, G.y, G.z); cells.push(i, j, k);
        cellV[i + NX * (j + NY * k)] = nv++;
      }
    }
    const P = pos, tris = [[], [], [], []], ea = [];
    const vcls = new Uint8Array(nv), col = new Float32Array(nv * 4), ext = new Float32Array(nv * 4), out = [0, 0, 0], EX = [0, 0, 0, 0];
    for (let v = 0; v < nv; v++) {
      const c = surfaceColor(P[3 * v], P[3 * v + 1], P[3 * v + 2], nor[3 * v], nor[3 * v + 1], nor[3 * v + 2], out, EX);
      ext.set(EX, 4 * v);
      vcls[v] = c;
      col[4 * v] = Math.pow(out[0], 2.2); col[4 * v + 1] = Math.pow(out[1], 2.2); col[4 * v + 2] = Math.pow(out[2], 2.2); col[4 * v + 3] = c / 3;
    }
    const cv = (i, j, k) => cellV[i + NX * (j + NY * k)];
    function quad(a, b, c, d, axis, sgn) {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      const ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2], bx = P[3 * b], by = P[3 * b + 1], bz = P[3 * b + 2];
      const cx = P[3 * c], cy = P[3 * c + 1], cz = P[3 * c + 2], dx = P[3 * d], dy = P[3 * d + 1], dz = P[3 * d + 2];
      const e1x = cx - ax, e1y = cy - ay, e1z = cz - az, e2x = dx - bx, e2y = dy - by, e2z = dz - bz;
      const n = [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x];
      if (n[axis] * sgn < 0) { const t = b; b = d; d = t; }
      const l1 = e1x * e1x + e1y * e1y + e1z * e1z, l2 = e2x * e2x + e2y * e2y + e2z * e2z;
      const pushT = (p, q, r) => { const cc = vcls[p] === vcls[q] || vcls[p] === vcls[r] ? vcls[p] : vcls[q] === vcls[r] ? vcls[q] : vcls[p]; tris[cc].push(p, q, r); };
      if (l1 < l2) { pushT(a, b, c); pushT(a, c, d); } else { pushT(a, b, d); pushT(b, c, d); }
      ea.push(a, b, b, c, c, d, d, a, a, c, b, d);
    }
    const nc = cells.length / 3;
    for (let q = 0; q < nc; q++) {
      const i = cells[3 * q], j = cells[3 * q + 1], k = cells[3 * q + 2];
      const base = i + PX * (j + PY * k), in0 = vals[base] < 0, sg = in0 ? 1 : -1;
      if (j > 0 && k > 0 && (vals[base + 1] < 0) !== in0) quad(cv(i, j, k), cv(i, j - 1, k), cv(i, j - 1, k - 1), cv(i, j, k - 1), 0, sg);
      if (i > 0 && k > 0 && (vals[base + PX] < 0) !== in0) quad(cv(i, j, k), cv(i, j, k - 1), cv(i - 1, j, k - 1), cv(i - 1, j, k), 1, sg);
      if (i > 0 && j > 0 && (vals[base + PXY] < 0) !== in0) quad(cv(i, j, k), cv(i - 1, j, k), cv(i - 1, j - 1, k), cv(i, j - 1, k), 2, sg);
    }
    const total = tris[0].length + tris[1].length + tris[2].length + tris[3].length;
    const idx = new Uint32Array(total);
    let off = 0;
    for (const t of tris) { idx.set(t, off); off += t.length; }
    const deg = new Int32Array(nv + 1);
    for (let e = 0; e < ea.length; e += 2) { deg[ea[e]]++; deg[ea[e + 1]]++; }
    const start = new Int32Array(nv + 1);
    for (let v = 0; v < nv; v++) start[v + 1] = start[v] + deg[v];
    const fillp = start.slice(0, nv), adj = new Int32Array(start[nv]);
    for (let e = 0; e < ea.length; e += 2) { const a = ea[e], b = ea[e + 1]; adj[fillp[a]++] = b; adj[fillp[b]++] = a; }
    return { pos: new Float32Array(pos), nor: new Float32Array(nor), col, ext, idx, nv, start, adj };
  }
  // The 14 flags the hiker tours, in order
  const LM_DEF = [
    ['The front edge', [-28, 4, 34]], ['Right toes', [-24.5, 5, 9]], ['Right hand', [-12, 6, 21.5]], ['His belly', [0, 14, 22]],
    ['His nose', [0, 36, 22]], ['Right eye', [-9.5, 41, 13]], ['The crown', [0, 41, 3.5]], ['Left eye', [9.5, 41, 13]],
    ['His back', [0, 32, -14]], ['Left thigh', [20, 13, -5]], ['The big dewdrop', [36, 6, -14]], ['The notch', [-6, 3, -36]],
    ['Under the lily pad', [14, -5, 14]], ['Tip of the stem', [-0.5, -40, -2.5]]];
  function workerMain() {
    const m = buildMesh();
    self.postMessage(m, [m.pos.buffer, m.nor.buffer, m.col.buffer, m.ext.buffer, m.idx.buffer, m.start.buffer, m.adj.buffer]);
  }
  return { V3, clamp, sdf, gradAt, project, buildMesh, workerMain, LM_DEF, EYES, hx };
}

const CORE = ribbitCore();
const { V3, clamp, sdf, gradAt, project, EYES, hx } = CORE;
const _g = new V3();

/* ================= the renderer (its own canvas and WebGL) ================= */
const SKYFN = `
uniform vec3 uSun;
vec3 skySRGB(vec3 d){
  d=normalize(d);float h=d.y;
  vec3 top=vec3(0.173,0.416,0.651),mid=vec3(0.525,0.725,0.855),hor=vec3(1.0,0.839,0.639),bel=vec3(0.953,0.753,0.667),deep=vec3(0.80,0.58,0.68);
  vec3 c;
  if(h>=0.0){c=mix(hor,mid,smoothstep(0.0,0.22,h));c=mix(c,top,smoothstep(0.22,0.85,h));}
  else{c=mix(hor,bel,smoothstep(0.0,-0.12,h));c=mix(c,deep,smoothstep(-0.12,-0.8,h));}
  float s=max(dot(d,uSun),0.0);
  c+=vec3(1.0,0.85,0.6)*(pow(s,900.0)*2.0+pow(s,40.0)*0.22+pow(s,6.0)*0.08);
  return c;
}`;
const LIT_VS = `#version 300 es
layout(location=0) in vec3 aPos;layout(location=1) in vec3 aNor;layout(location=2) in vec4 aCol;layout(location=5) in vec4 aExt;
uniform mat4 uModel,uVP,uLightVP;
out vec3 vPos;out vec3 vNor;out vec4 vCol;out vec4 vLP;out vec4 vExt;
void main(){vec4 wp=uModel*vec4(aPos,1.0);vec3 wn=normalize(mat3(uModel)*aNor);vPos=wp.xyz;vNor=wn;vCol=aCol;vExt=aExt;vLP=uLightVP*vec4(wp.xyz+wn*0.08,1.0);gl_Position=uVP*wp;}`;
const LIT_FS = `#version 300 es
precision highp float;precision highp sampler2DShadow;
in vec3 vPos;in vec3 vNor;in vec4 vCol;in vec4 vLP;in vec4 vExt;
uniform vec3 uEyeC[2],uEyeF[2],uEyeR[2],uEyeU[2];
uniform vec3 uCam,uSunCol,uSkyAmb,uGroundAmb;uniform vec2 uFog;uniform sampler2DShadow uShadow;uniform float uShadowOn,uTwoSided,uTexel;
out vec4 o;
${SKYFN}
float shadowAt(){
  vec3 p=vLP.xyz/vLP.w*0.5+0.5;
  float edge=max(abs(p.x-0.5),abs(p.y-0.5))*2.0;
  if(edge>1.0||p.z>1.0)return 1.0;
  float s=0.0;
  for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++)s+=texture(uShadow,vec3(p.xy+vec2(float(i),float(j))*uTexel,p.z-0.0006));
  s/=9.0;return mix(s,1.0,smoothstep(0.8,1.0,edge));
}
float hash(vec3 p){p=fract(p*0.3183099+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vnoise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float band(float d,float w){float aa=fwidth(d)*0.75+0.004;return 1.0-smoothstep(w-aa,w+aa,d);}
float gEye=0.0;
vec3 details(vec3 base){
  vec3 p=vPos;
  if(vExt.z>0.01){
    float sp=vnoise(p*0.16+vec3(11.2,-2.3,-4.1))*0.72+vnoise(p*0.42)*0.28;
    float aa=fwidth(sp)*0.8+0.003;
    base=mix(base,base*vec3(0.38,0.5,0.55),smoothstep(0.585-aa,0.585+aa,sp)*vExt.z*0.9);
  }
  if(vExt.x>0.01){
    float m=p.y-(26.4+0.0125*p.x*p.x);
    base=mix(base,vec3(0.022,0.05,0.009),band(abs(m),0.2)*vExt.x);
  }
  int ei=p.x>0.0?0:1;
  float dE=length(p-uEyeC[ei])-4.5;
  if(dE<0.6&&vCol.a>0.2&&vCol.a<0.5){
    float em=1.0-smoothstep(0.12,0.42,dE);
    vec3 v=normalize(p-uEyeC[ei]);
    float c=dot(v,uEyeF[ei]),a=dot(v,uEyeR[ei]),b=dot(v,uEyeU[ei]);
    float sc=smoothstep(0.08,0.14,c)*(1.0-smoothstep(0.72,0.77,v.y));
    vec3 ec=vec3(0.96,0.93,0.83);
    float rr=length(vec2(a,b));
    if(c>0.0){
      ec=mix(ec,vec3(0.2,0.08,0.006),band(rr,0.68));
      ec=mix(ec,vec3(0.78,0.37,0.03),band(rr,0.63));
      ec=mix(ec,vec3(0.006,0.007,0.005),band(sqrt((a/0.44)*(a/0.44)+(b/0.24)*(b/0.24)),1.0));
      ec=mix(ec,vec3(1.0),band(length(vec2(a+0.2,b-0.24)),0.09));
    }
    base=mix(base,ec,sc*em);gEye=sc*em;
  }
  if(vExt.w>0.01){
    float r=length(p.xz),th=atan(p.z,p.x);
    float N=22.0,ang=th/6.2831853*N,f=abs(ang-floor(ang+0.5)),arc=f*(6.2831853/N)*r,w=0.16+r*0.0035;
    float vein=band(arc,w)*smoothstep(3.0,8.0,r);
    float ang2=th/6.2831853*N*2.0+0.5,f2=abs(ang2-floor(ang2+0.5)),arc2=f2*(6.2831853/(N*2.0))*r;
    vein=max(vein,band(arc2,w*0.6)*smoothstep(24.0,30.0,r)*0.75);
    base=mix(base,base*vec3(0.55,0.62,0.6),vein*vExt.w);
  }
  return base;
}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
void main(){
  vec3 n=normalize(vNor);
  if(uTwoSided>0.5&&!gl_FrontFacing)n=-n;
  gEye=0.0;vec3 base=details(vCol.rgb);float cls=vCol.a*3.0;
  vec3 v=normalize(uCam-vPos);
  float ndl=max(dot(n,uSun),0.0);
  float sh=uShadowOn>0.5?shadowAt():1.0;
  vec3 hemi=mix(uGroundAmb,uSkyAmb,n.y*0.5+0.5);
  float wrap=max(dot(n,uSun)*0.5+0.5,0.0);
  float bounce=max(dot(n,vec3(-0.18,-0.97,0.16)),0.0);
  vec3 col=base*(hemi*0.62+uSunCol*ndl*sh+uSunCol*0.06*wrap+vec3(0.40,0.27,0.26)*bounce);
  vec3 hh=normalize(uSun+v);float nh=max(dot(n,hh),0.0);
  float wSkin=clamp(cls,0.0,1.0),wGloss=max(clamp(cls-1.0,0.0,1.0)-clamp(cls-2.0,0.0,1.0),gEye),wMetal=clamp(cls-2.0,0.0,1.0);
  float shin=mix(mix(mix(12.0,36.0,wSkin),220.0,wGloss),80.0,wMetal);
  float ks=mix(mix(mix(0.03,0.16,wSkin),1.2,wGloss),0.9,wMetal);
  vec3 sc=mix(vec3(1.0),base*1.6+0.1,wMetal);
  col+=sc*ks*pow(nh,shin)*ndl*sh*uSunCol;
  vec3 r=reflect(-v,n);float fres=pow(1.0-max(dot(n,v),0.0),4.0);
  vec3 env=pow(skySRGB(r),vec3(2.2));
  col=mix(col,base*env*1.5,0.5*wMetal);
  col+=env*(mix(0.10*fres*wSkin,0.05+0.45*fres,wGloss))*(1.0-wMetal);
  vec3 srgb=pow(aces(col*1.05),vec3(1.0/2.2));
  float f=smoothstep(uFog.x,uFog.y,length(uCam-vPos));
  o=vec4(mix(srgb,min(skySRGB(vPos-uCam),vec3(1.0)),f),1.0);
}`;
const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos;uniform mat4 uModel,uLightVP;void main(){gl_Position=uLightVP*uModel*vec4(aPos,1.0);}`;
const DEPTH_FS = `#version 300 es
precision mediump float;void main(){}`;
const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos;uniform mat4 uInvVP;uniform vec3 uCam;out vec3 vDir;
void main(){gl_Position=vec4(aPos,0.99999,1.0);vec4 w=uInvVP*vec4(aPos,1.0,1.0);vDir=w.xyz/w.w-uCam;}`;
const SKY_FS = `#version 300 es
precision highp float;in vec3 vDir;out vec4 o;${SKYFN}
void main(){o=vec4(min(skySRGB(vDir),vec3(1.0)),1.0);}`;
const CLOUD_VS = `#version 300 es
layout(location=0) in vec2 aCorner;layout(location=3) in vec4 aInst;layout(location=4) in vec2 aMeta;
uniform mat4 uVP;uniform vec3 uRight,uUp;out vec2 vUV;out float vA;out vec3 vW;
void main(){vec3 w=aInst.xyz+(uRight*aCorner.x+uUp*aCorner.y*0.62)*aInst.w;vW=w;vUV=vec2((aCorner.x*0.5+0.5)*0.5+aMeta.y*0.5,aCorner.y*0.5+0.5);vA=aMeta.x;gl_Position=uVP*vec4(w,1.0);}`;
const CLOUD_FS = `#version 300 es
precision highp float;in vec2 vUV;in float vA;in vec3 vW;uniform sampler2D uTex;uniform vec3 uCam;out vec4 o;${SKYFN}
void main(){vec4 t=texture(uTex,vUV);vec3 c=mix(vec3(0.98,0.84,0.80),vec3(1.0,0.98,0.95),t.r);
  float f=smoothstep(140.0,480.0,length(vW-uCam));c=mix(c,min(skySRGB(vW-uCam),vec3(1.0)),f*0.85);
  float a=t.a*vA;o=vec4(c*a,a);}`;
const PT_VS = `#version 300 es
layout(location=0) in vec3 aPos;uniform mat4 uVP;uniform float uSize,uScale;
void main(){vec4 c=uVP*vec4(aPos,1.0);gl_Position=c;gl_PointSize=clamp(uSize*uScale/max(c.w,0.1),1.5,48.0);}`;
const PT_FS = `#version 300 es
precision mediump float;uniform vec3 uColor;uniform float uAlpha,uOpaque;out vec4 o;
void main(){float d=length(gl_PointCoord-0.5)*2.0;float a=(1.0-smoothstep(0.45,1.0,d))*uAlpha;o=vec4(uColor*a,a*uOpaque);}`;
const UL_VS = `#version 300 es
layout(location=0) in vec3 aPos;uniform mat4 uModel,uVP;out float vY;void main(){vY=aPos.y;gl_Position=uVP*uModel*vec4(aPos,1.0);}`;
const UL_FS = `#version 300 es
precision mediump float;in float vY;uniform vec3 uColor;uniform float uAlpha,uFadeH,uOpaque;out vec4 o;
void main(){float a=uAlpha*(uFadeH>0.0?clamp(1.0-vY/uFadeH,0.0,1.0):1.0);o=vec4(uColor*a,a*uOpaque);}`;

const M4 = {
  create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul(o, a, b) { const r = new Float32Array(16); for (let c = 0; c < 4; c++) for (let w = 0; w < 4; w++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + w] * b[c * 4 + k]; r[c * 4 + w] = s; } o.set(r); return o; },
  persp(o, fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); o.fill(0); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; },
  ortho(o, l, r, b, t, n, f) { o.fill(0); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o; },
  lookAt(o, e, t, up) {
    let fx = t.x - e.x, fy = t.y - e.y, fz = t.z - e.z, l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    let sx = fy * up.z - fz * up.y, sy = fz * up.x - fx * up.z, sz = fx * up.y - fy * up.x; l = Math.hypot(sx, sy, sz);
    if (l < 1e-6) { sx = 1; sy = 0; sz = 0; l = 1; }
    sx /= l; sy /= l; sz /= l;
    const ux = sy * fz - sz * fy, uy = sz * fx - sx * fz, uz = sx * fy - sy * fx;
    o[0] = sx; o[4] = sy; o[8] = sz; o[12] = -(sx * e.x + sy * e.y + sz * e.z);
    o[1] = ux; o[5] = uy; o[9] = uz; o[13] = -(ux * e.x + uy * e.y + uz * e.z);
    o[2] = -fx; o[6] = -fy; o[10] = -fz; o[14] = fx * e.x + fy * e.y + fz * e.z;
    o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1; return o;
  },
  basis(o, x, y, z, p) { o[0] = x.x; o[1] = x.y; o[2] = x.z; o[3] = 0; o[4] = y.x; o[5] = y.y; o[6] = y.z; o[7] = 0; o[8] = z.x; o[9] = z.y; o[10] = z.z; o[11] = 0; o[12] = p.x; o[13] = p.y; o[14] = p.z; o[15] = 1; return o; },
  trans(o, x, y, z) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; o[12] = x; o[13] = y; o[14] = z; return o; },
  rotX(o, a) { const c = Math.cos(a), s = Math.sin(a); o.fill(0); o[0] = 1; o[5] = c; o[6] = s; o[9] = -s; o[10] = c; o[15] = 1; return o; },
  rotY(o, a) { const c = Math.cos(a), s = Math.sin(a); o.fill(0); o[0] = c; o[2] = -s; o[5] = 1; o[8] = s; o[10] = c; o[15] = 1; return o; },
  scale(o, s) { o.fill(0); o[0] = o[5] = o[10] = s; o[15] = 1; return o; },
  invert(o, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7], a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return o;
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det; o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det; o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det; o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det; o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  }
};
const lc = (h, cls) => { const c = hx(h); return [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2), (cls || 0) / 3]; };
const Geo = () => ({ p: [], n: [], c: [], i: [] });
function gSphere(g, cx, cy, cz, r, col, seg, rings, hemi) {
  seg = seg || 16; rings = rings || 10;
  const base = g.p.length / 3;
  for (let a = 0; a <= rings; a++) {
    const th = hemi ? a / rings * Math.PI / 2 : a / rings * Math.PI, st = Math.sin(th), ct = Math.cos(th);
    for (let b = 0; b <= seg; b++) { const ph = b / seg * Math.PI * 2, nx = st * Math.cos(ph), ny = ct, nz = st * Math.sin(ph); g.p.push(cx + nx * r, cy + ny * r, cz + nz * r); g.n.push(nx, ny, nz); g.c.push(...col); }
  }
  for (let a = 0; a < rings; a++) for (let b = 0; b < seg; b++) { const i0 = base + a * (seg + 1) + b, i1 = i0 + seg + 1; g.i.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1); }
}
function gCyl(g, cx, y0, cz, r0, r1, h, col, seg) {
  seg = seg || 14;
  const base = g.p.length / 3, sl = (r0 - r1) / h, nl = Math.hypot(1, sl);
  for (let a = 0; a <= 1; a++) { const y = y0 + a * h, r = a ? r1 : r0; for (let b = 0; b <= seg; b++) { const ph = b / seg * Math.PI * 2, c = Math.cos(ph), s = Math.sin(ph); g.p.push(cx + c * r, y, cz + s * r); g.n.push(c / nl, sl / nl, s / nl); g.c.push(...col); } }
  for (let b = 0; b < seg; b++) { const i0 = base + b, i1 = base + seg + 1 + b; g.i.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1); }
  for (const [y, r, ny] of [[y0, r0, -1], [y0 + h, r1, 1]]) {
    const c0 = g.p.length / 3;
    g.p.push(cx, y, cz); g.n.push(0, ny, 0); g.c.push(...col);
    for (let b = 0; b <= seg; b++) { const ph = b / seg * Math.PI * 2; g.p.push(cx + Math.cos(ph) * r, y, cz + Math.sin(ph) * r); g.n.push(0, ny, 0); g.c.push(...col); }
    for (let b = 0; b < seg; b++) g.i.push(c0, c0 + 1 + b, c0 + 2 + b);
  }
}
function gBox(g, cx, cy, cz, w, h, d, col) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  for (const [nx, ny, nz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const base = g.p.length / 3, u = nx ? [0, 1, 0] : [1, 0, 0], v = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      g.p.push(cx + nx * hw + (u[0] * su + v[0] * sv) * hw, cy + ny * hh + (u[1] * su + v[1] * sv) * hh, cz + nz * hd + (u[2] * su + v[2] * sv) * hd);
      g.n.push(nx, ny, nz); g.c.push(...col);
    }
    g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
const gDone = (g) => ({ pos: new Float32Array(g.p), nor: new Float32Array(g.n), col: new Float32Array(g.c), idx: new Uint16Array(g.i) });

const SUN = new V3(0.45, 0.42, 0.78).normalize();
const SUN_COL = [1.55, 1.30, 1.02], SKY_AMB = [0.50, 0.66, 0.92], GROUND_AMB = [0.80, 0.56, 0.50];
const SHADOW_SIZE = 2048, SHADOW_EXT = 30, POLLEN_N = 220;

// Everything that needs the frog's own WebGL, made the first time the frog is drawn
let R = null;
function makeRenderer() {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 2;
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('no WebGL 2 for Mount Ribbit');
  const mkShader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const mkProg = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, mkShader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mkShader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const cache = {};
    return { p, u: (n) => (n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n))) };
  };
  const PR = { lit: mkProg(LIT_VS, LIT_FS), depth: mkProg(DEPTH_VS, DEPTH_FS), sky: mkProg(SKY_VS, SKY_FS), cloud: mkProg(CLOUD_VS, CLOUD_FS), pt: mkProg(PT_VS, PT_FS), ul: mkProg(UL_VS, UL_FS) };
  const attrib = (loc, data, size, usage) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); return b; };
  const makeMesh = (g) => {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    attrib(0, g.pos, 3); if (g.nor) attrib(1, g.nor, 3); if (g.col) attrib(2, g.col, 4); if (g.ext) attrib(5, g.ext, 4);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: g.idx.length, type: g.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  };
  gl.vertexAttrib4f(5, 0, 0, 0, 0);
  // The hiker: a body and one leg and one arm, each drawn twice
  const H = {};
  {
    const jacket = lc('#e2572b'), pants = lc('#2c3e66'), skin = lc('#e9b791', 1), hat = lc('#f2c14e'), pack = lc('#2f8f8a'), boot = lc('#4a3324'), dark = lc('#1d1d1d', 2), strap = lc('#1f5f5c');
    let g = Geo();
    gCyl(g, 0, 0.46, 0, 0.165, 0.15, 0.36, jacket); gSphere(g, 0, 0.82, 0, 0.15, jacket, 14, 8, true); gSphere(g, 0, 0.47, 0, 0.16, pants, 14, 8);
    gSphere(g, 0, 0.98, 0, 0.13, skin); gSphere(g, 0, 1.0, 0, 0.138, hat, 16, 8, true); gSphere(g, 0, 1.15, 0, 0.045, lc('#f6f1dc'));
    gSphere(g, 0.045, 0.99, 0.118, 0.018, dark, 8, 6); gSphere(g, -0.045, 0.99, 0.118, 0.018, dark, 8, 6);
    gBox(g, 0, 0.68, -0.2, 0.25, 0.32, 0.13, pack); gBox(g, 0, 0.86, -0.2, 0.2, 0.05, 0.12, strap);
    H.body = makeMesh(gDone(g));
    g = Geo(); gCyl(g, 0, -0.4, 0, 0.06, 0.072, 0.4, pants, 10); gBox(g, 0, -0.43, 0.03, 0.11, 0.07, 0.19, boot); H.leg = makeMesh(gDone(g));
    g = Geo(); gCyl(g, 0, -0.33, 0, 0.042, 0.055, 0.33, jacket, 10); gSphere(g, 0, -0.36, 0, 0.045, skin, 10, 6); H.arm = makeMesh(gDone(g));
  }
  let flag;
  {
    const g = Geo(), c = lc('#f2c14e');
    gCyl(g, 0, 0, 0, 0.045, 0.035, 1.9, lc('#6b4f33'), 8); gSphere(g, 0, 1.92, 0, 0.07, lc('#f2c14e', 3), 10, 6);
    const base = g.p.length / 3;
    g.p.push(0.04, 1.82, 0, 0.04, 1.36, 0, 0.78, 1.6, 0); g.n.push(0, 0, 1, 0, 0, 1, 0, 0, 1); g.c.push(...c, ...c, ...c); g.i.push(base, base + 1, base + 2);
    flag = makeMesh(gDone(g));
  }
  const ulMesh = (pos, idx) => makeMesh({ pos: new Float32Array(pos), idx: new Uint16Array(idx) });
  const RING = (() => {
    const p = [], ix = [], S = 48, T = 8, Rr = 1.3, r = 0.09;
    for (let a = 0; a <= S; a++) for (let b = 0; b <= T; b++) { const u = a / S * Math.PI * 2, v = b / T * Math.PI * 2; p.push((Rr + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (Rr + r * Math.cos(v)) * Math.sin(u)); }
    for (let a = 0; a < S; a++) for (let b = 0; b < T; b++) { const i0 = a * (T + 1) + b, i1 = i0 + T + 1; ix.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1); }
    return ulMesh(p, ix);
  })();
  const BEAM = (() => {
    const p = [], ix = [], S = 20;
    for (let a = 0; a <= S; a++) { const u = a / S * Math.PI * 2; p.push(Math.cos(u), 0, Math.sin(u), Math.cos(u), 1, Math.sin(u)); }
    for (let a = 0; a < S; a++) { const i = a * 2; ix.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    return ulMesh(p, ix);
  })();
  const QUAD = gl.createVertexArray(); gl.bindVertexArray(QUAD); attrib(0, new Float32Array([-1, -1, 3, -1, -1, 3]), 2); gl.bindVertexArray(null);
  // Clouds: puffy sprites, a sea of them below and a few far off
  const cloudTex = (() => {
    const W = 256, Hh = 128, data = new Uint8Array(W * Hh * 4);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ss = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
    for (let v = 0; v < 2; v++) {
      const blobs = [];
      for (let i = 0; i < 10; i++) blobs.push([0.5 + (rnd() - 0.5) * 0.52, 0.55 + (rnd() - 0.5) * 0.3 - (i < 4 ? 0.08 : 0), 0.13 + rnd() * 0.13]);
      for (let y = 0; y < Hh; y++) for (let x = 0; x < 128; x++) {
        const u = x / 128, w = y / Hh;
        let a = 0;
        for (const [bx, by, br] of blobs) a += Math.exp(-((u - bx) ** 2 + (w - by) ** 2) / (br * br) * 1.6);
        const al = ss(0.35, 1.1, a) * ss(0, 0.12, Math.min(u, 1 - u, w, 1 - w)), i = (y * W + x + v * 128) * 4;
        data[i] = Math.round(255 * clamp(0.35 + 0.75 * w, 0, 1)); data[i + 3] = Math.round(255 * al);
      }
    }
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, Hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  })();
  const CLOUDS = [];
  {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 80; i++) { const a = rnd() * Math.PI * 2, r = 34 + Math.sqrt(rnd()) * 300; CLOUDS.push({ x: Math.cos(a) * r, y: -52 + rnd() * 10, z: Math.sin(a) * r, s: (40 + rnd() * 60) * (0.7 + r / 400), a: 0.92, v: rnd() < 0.5 ? 0 : 1 }); }
    for (let i = 0; i < 34; i++) { const a = rnd() * Math.PI * 2, r = 170 + rnd() * 230; CLOUDS.push({ x: Math.cos(a) * r, y: -20 + rnd() * 90, z: Math.sin(a) * r, s: 50 + rnd() * 70, a: 0.85, v: rnd() < 0.5 ? 0 : 1 }); }
  }
  const cloudInst = new Float32Array(CLOUDS.length * 4), cloudMeta = new Float32Array(CLOUDS.length * 2);
  const CLOUD_VAO = gl.createVertexArray();
  gl.bindVertexArray(CLOUD_VAO);
  attrib(0, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), 2);
  const cloudInstBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cloudInstBuf); gl.bufferData(gl.ARRAY_BUFFER, cloudInst.byteLength, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(3, 1);
  const cloudMetaBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cloudMetaBuf); gl.bufferData(gl.ARRAY_BUFFER, cloudMeta.byteLength, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(4, 1);
  gl.bindVertexArray(null);
  const dynPoints = (n) => { const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, n * 12, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null); return { vao, b, n: 0 }; };
  const pollenBase = new Float32Array(POLLEN_N * 4), pollenPos = new Float32Array(POLLEN_N * 3);
  { let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; for (let i = 0; i < POLLEN_N; i++) { const a = rnd() * Math.PI * 2, r = 8 + rnd() * 52; pollenBase.set([Math.cos(a) * r, -8 + rnd() * 58, Math.sin(a) * r, rnd() * 100], i * 4); } }
  const POLLEN = dynPoints(POLLEN_N);
  // The shadow map follows whichever hiker is being drawn
  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const shadowFB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
  const shadowOK = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const EYE_U = {
    c: new Float32Array(EYES.flatMap((e) => [e.c.x, e.c.y, e.c.z])), f: new Float32Array(EYES.flatMap((e) => [e.f.x, e.f.y, e.f.z])),
    r: new Float32Array(EYES.flatMap((e) => [e.r.x, e.r.y, e.r.z])), u: new Float32Array(EYES.flatMap((e) => [e.u.x, e.u.y, e.u.z]))
  };
  return { canvas, gl, PR, makeMesh, H, flag, RING, BEAM, QUAD, cloudTex, CLOUDS, cloudInst, cloudMeta, CLOUD_VAO, cloudInstBuf, cloudMetaBuf,
           dynPoints, pollenBase, pollenPos, POLLEN, shadowTex, shadowFB, shadowOK, EYE_U, terrain: null, trails: { A: null, B: null } };
}

/* ================= the frog's mesh, built in the background ================= */
let state = 'idle', MESH = null;
let gS, came, closedA, heapK, heapV, heapN = 0;
function gotMesh(m) {
  MESH = m;
  gS = new Float64Array(m.nv); came = new Int32Array(m.nv); closedA = new Uint8Array(m.nv);
  heapK = new Float64Array(m.adj.length + 16); heapV = new Int32Array(m.adj.length + 16);
  state = 'ready';
}
function build() {
  if (state !== 'idle') return;
  state = 'building';
  const onMain = () => setTimeout(() => { try { gotMesh(CORE.buildMesh()); } catch (err) { console.error(err); state = 'failed'; } }, 0);
  try {
    const url = URL.createObjectURL(new Blob(['(' + ribbitCore.toString() + ')().workerMain();'], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = (e) => { URL.revokeObjectURL(url); w.terminate(); gotMesh(e.data); };
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); URL.revokeObjectURL(url); w.terminate(); onMain(); };
  } catch (_) { onMain(); }
}

/* ================= finding a way over the frog ================= */
function hpush(v, k) { let i = heapN++; while (i > 0) { const p = (i - 1) >> 1; if (heapK[p] <= k) break; heapK[i] = heapK[p]; heapV[i] = heapV[p]; i = p; } heapK[i] = k; heapV[i] = v; }
function hpop() {
  const top = heapV[0], n = --heapN;
  if (n > 0) {
    const k = heapK[n], v = heapV[n];
    let i = 0;
    for (;;) { const l = 2 * i + 1; if (l >= n) break; const r = l + 1, m = r < n && heapK[r] < heapK[l] ? r : l; if (heapK[m] >= k) break; heapK[i] = heapK[m]; heapV[i] = heapV[m]; i = m; }
    heapK[i] = k; heapV[i] = v;
  }
  return top;
}
function nearestVertex(p) { const P = MESH.pos; let best = -1, bd = 1e18; for (let v = 0; v < MESH.nv; v++) { const dx = P[3 * v] - p.x, dy = P[3 * v + 1] - p.y, dz = P[3 * v + 2] - p.z, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = v; } } return best; }
function astar(s, g) {
  const P = MESH.pos, S = MESH.start, A = MESH.adj;
  gS.fill(Infinity); came.fill(-1); closedA.fill(0); heapN = 0;
  const gx = P[3 * g], gy = P[3 * g + 1], gz = P[3 * g + 2];
  const h = (v) => { const dx = P[3 * v] - gx, dy = P[3 * v + 1] - gy, dz = P[3 * v + 2] - gz; return Math.sqrt(dx * dx + dy * dy + dz * dz); };
  gS[s] = 0; hpush(s, h(s));
  while (heapN > 0) {
    const u = hpop();
    if (u === g) break;
    if (closedA[u]) continue;
    closedA[u] = 1;
    const ux = P[3 * u], uy = P[3 * u + 1], uz = P[3 * u + 2], gu = gS[u];
    for (let e = S[u]; e < S[u + 1]; e++) {
      const v = A[e];
      if (closedA[v]) continue;
      const dx = P[3 * v] - ux, dy = P[3 * v + 1] - uy, dz = P[3 * v + 2] - uz, ng = gu + Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (ng < gS[v]) { gS[v] = ng; came[v] = u; hpush(v, ng + h(v)); }
    }
  }
  if (s !== g && came[g] < 0) return null;
  const path = [];
  for (let v = g; v !== -1; v = came[v]) { path.push(v); if (v === s) break; }
  return path.reverse();
}

/* ================= the hikers: one for each loop ================= */
const LM = CORE.LM_DEF.map(([name, s]) => { const p = project(new V3(...s), 80); return { name, p, n: gradAt(p.x, p.y, p.z, new V3()), vi: -1 }; });
const retangent = (f, n) => {
  f.addScaledVector(n, -f.dot(n));
  if (f.lengthSq() < 1e-8) { f.set(1, 0, 0).addScaledVector(n, -n.x); if (f.lengthSq() < 1e-6) f.set(0, 0, 1).addScaledVector(n, -n.z); }
  f.normalize();
};
const rotAround = (f, n, ang) => { const c = Math.cos(ang), s = Math.sin(ang), cx = n.y * f.z - n.z * f.y, cy = n.z * f.x - n.x * f.z, cz = n.x * f.y - n.y * f.x; f.set(f.x * c + cx * s, f.y * c + cy * s, f.z * c + cz * s); };
function makeHiker(start, face, firstStop) {
  const W = { p: project(new V3(...start), 40), f: new V3(...face), n: new V3(0, 1, 0), vn: new V3(0, 1, 0), vel: new V3(), air: false, airT: 0, speed: 0, phase: 0,
              cam: { pos: new V3(), look: new V3(), up: new V3(0, 1, 0), init: false },
              route: null, stop: firstStop, wait: 0, stuckT: 0, lastRem: 1e9, idle: 99, t: 0, camT: firstStop * 7, camYaw: 0, camDist: 8, camPitch: 0.36 };
  gradAt(W.p.x, W.p.y, W.p.z, W.n); W.vn.copy(W.n); retangent(W.f, W.n);
  return W;
}
const hikers = { A: makeHiker([0, 3, 36], [0, 0, -1], 3), B: makeHiker([30, 3, -26], [-1, 0, 0.6], 9),
                 C: makeHiker([-24, 3, 30], [1, 0, -0.3], 11), D: makeHiker([10, 3, -34], [0, 0, 1], 1) };

function planTo(W, li) {
  const L = LM[li];
  if (L.vi < 0) L.vi = nearestVertex(L.p);
  const path = astar(nearestVertex(W.p), L.vi), P = MESH.pos, pts = [], cum = [0];
  if (path) for (const v of path) pts.push(new V3(P[3 * v], P[3 * v + 1], P[3 * v + 2]));
  pts.push(L.p.clone());
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  W.route = { pts, cum, n: pts.length, i: 0, target: li };
  W.stuckT = 0; W.lastRem = 1e9;
  // The gold dots along the way, a little above the surface
  const tp = [];
  let acc = 0.6;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], seg = a.distanceTo(b);
    while (acc < seg && tp.length < 9000) { const q = a.clone().lerp(b, acc / seg); gradAt(q.x, q.y, q.z, _g); tp.push(q.x + _g.x * 0.14, q.y + _g.y * 0.14, q.z + _g.z * 0.14); acc += 1.1; }
    acc -= seg;
  }
  W.trailPts = new Float32Array(tp);
  W.trailDirty = true;
}
const remaining = (W) => { const r = W.route; return r ? r.cum[r.n - 1] - r.cum[r.i] + W.p.distanceTo(r.pts[r.i]) : 0; };
const _d = new V3(), _c = new V3();
// Walking by itself: from flag to flag round the whole frog, stopping a moment at each
function autoSteer(W, dt, pace) {
  if (W.wait > 0) { W.wait -= dt; if (W.wait <= 0) { W.stop = (W.stop + 1) % LM.length; planTo(W, W.stop); } return [0, 0]; }
  if (!MESH) { W.t += dt; return [pace * 0.7, (Math.sin(W.t * 0.53) * 0.75 + Math.sin(W.t * 1.37 + 2) * 0.45) * dt]; }
  if (!W.route) planTo(W, W.stop);
  const r = W.route;
  let bi = r.i, bd = 1e18;
  for (let i = r.i; i < Math.min(r.n, r.i + 40); i++) { const d = W.p.distanceToSquared(r.pts[i]); if (d < bd) { bd = d; bi = i; } }
  r.i = bi;
  if (W.p.distanceTo(LM[r.target].p) < 2.3) { W.route = null; W.trailPts = null; W.trailDirty = true; W.wait = 1.4; return [0, 0]; }
  if (bd > 81) { planTo(W, r.target); return [pace * 0.3, 0]; }
  const tgt = r.pts[Math.min(r.n - 1, bi + 5)];
  _d.subVectors(tgt, W.p); _d.addScaledVector(W.n, -_d.dot(W.n));
  let ang = 0;
  if (_d.lengthSq() > 1e-6) { _c.crossVectors(W.f, _d); ang = Math.atan2(_c.dot(W.n), W.f.dot(_d)); }
  const mt = 2.8 * dt;
  W.stuckT += dt;
  if (W.stuckT > 2.5) { const rem = remaining(W); if (rem > W.lastRem - 0.8) planTo(W, r.target); else W.lastRem = rem; W.stuckT = 0; }
  return [pace * Math.max(0.22, Math.cos(Math.min(Math.abs(ang), Math.PI / 2))), clamp(ang, -mt, mt)];
}
// One step of a hiker. ctl: { fwd, back, left, right, run, jump } from the keys, or null; auto: walk by itself when
// nobody has touched the keys for 10 seconds; mult: the music's surge (and slow motion when asked for).
function step(k, dt, mult, ctl, auto) {
  const W = hikers[k];
  const keysOn = ctl && (ctl.fwd || ctl.back || ctl.left || ctl.right);
  if (keysOn || (ctl && ctl.jump)) W.idle = 0; else W.idle += dt;
  let target = 0, turn = 0;
  if (keysOn) {
    target = ((ctl.fwd ? 1 : 0) - (ctl.back ? 1 : 0)) * (ctl.run ? 9 : 4.2);
    if (ctl.back && !ctl.fwd) target *= 0.6;
    turn = ((ctl.left ? 1 : 0) - (ctl.right ? 1 : 0)) * 2.3 * dt;
    if (W.route) { W.route = null; W.trailPts = null; W.trailDirty = true; }
    W.wait = 0;
  } else if (auto && W.idle > 10) {
    [target, turn] = autoSteer(W, dt, 6 * mult);
  }
  if (ctl && ctl.jump && !W.air) { W.air = true; W.airT = 0; W.vel.copy(W.n).multiplyScalar(7.5).addScaledVector(W.f, W.speed); W.p.addScaledVector(W.n, 0.03); }
  W.speed += (target * (keysOn ? Math.min(mult, 1.6) : 1) - W.speed) * (1 - Math.exp(-dt * 7));
  if (target === 0 && Math.abs(W.speed) < 0.02) W.speed = 0;
  rotAround(W.f, W.n, turn);
  if (!W.air) {
    const dist = W.speed * dt, n = Math.max(1, Math.ceil(Math.abs(dist) / 0.12));
    for (let i = 0; i < n; i++) { W.p.addScaledVector(W.f, dist / n); project(W.p, 4); gradAt(W.p.x, W.p.y, W.p.z, W.n); retangent(W.f, W.n); }
    W.phase += dist * 3.3;
  } else {
    W.airT += dt;
    const steps = Math.max(1, Math.ceil(W.vel.length() * dt / 0.15)), h = dt / steps;
    for (let i = 0; i < steps && W.air; i++) {
      gradAt(W.p.x, W.p.y, W.p.z, _g); W.vel.addScaledVector(_g, -20 * h); W.p.addScaledVector(W.vel, h);
      gradAt(W.p.x, W.p.y, W.p.z, W.n); retangent(W.f, W.n);
      if ((sdf(W.p.x, W.p.y, W.p.z) <= 0 && W.vel.dot(W.n) < 0) || W.airT > 4) {
        project(W.p, 8); gradAt(W.p.x, W.p.y, W.p.z, W.n); retangent(W.f, W.n); W.air = false; W.vel.set(0, 0, 0);
      }
    }
  }
  W.vn.lerp(W.n, 1 - Math.exp(-dt * 14)).normalize();
  // The camera follows from behind and above, turning with the ground, never inside the frog. While the hiker walks
  // by himself it hangs back a little and swings slowly from side to side, so the frog keeps sweeping into view.
  // When something is in the way it climbs higher over the hiker rather than squeezing in close.
  const c = W.cam, head = new V3().copy(W.p).addScaledVector(W.vn, 1.05), self = !keysOn;
  W.camT += dt;
  const ease = c.init ? 1 - Math.exp(-dt * 1.5) : 1;
  W.camYaw += ((self ? 1.1 * Math.sin(W.camT * 0.09) : 0) - W.camYaw) * ease;
  W.camDist += ((self ? 8 : 6.5) - W.camDist) * ease;
  const back = new V3().copy(W.f).negate();
  rotAround(back, W.vn, W.camYaw);
  const at = (pt) => new V3().copy(back).multiplyScalar(Math.cos(pt)).addScaledVector(W.vn, Math.sin(pt)).multiplyScalar(W.camDist).addScaledVector(head, 1);
  let goal = 0.36, most = -1;
  for (const pt of [0.36, 0.62, 0.9, 1.2]) {
    const clear = clearance(head, at(pt));
    if (clear >= W.camDist - 0.2) { goal = pt; break; }
    if (clear > most) { most = clear; goal = pt; }
  }
  W.camPitch += (goal - W.camPitch) * (c.init ? 1 - Math.exp(-dt * 3) : 1);
  const des = at(W.camPitch);
  const look = new V3().copy(head).addScaledVector(W.f, 0.8);
  const a = c.init ? 1 - Math.exp(-dt * 5) : 1, au = c.init ? 1 - Math.exp(-dt * 3.5) : 1;
  c.pos.lerp(des, a); c.look.lerp(look, a);
  if (c.up.dot(W.vn) < -0.9) c.up.addScaledVector(W.f, 0.25);
  c.up.lerp(W.vn, au).normalize();
  c.init = true;
  collide(head, c.pos);
}
// How far the camera can be from the hiker's head towards a spot before it would touch the frog
function clearance(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-4) return 0;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  let t = 0.2;
  for (let i = 0; i < 48 && t < len; i++) {
    const d = sdf(from.x + ux * t, from.y + uy * t, from.z + uz * t);
    if (d < 0.3) return t;
    t += Math.max(d * 0.8, 0.06);
  }
  return len;
}
function collide(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-4) return;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  let t = 0.2;
  for (let i = 0; i < 60 && t < len; i++) {
    const d = sdf(from.x + ux * t, from.y + uy * t, from.z + uz * t);
    if (d < 0.3) { t = Math.max(0.25, t - 0.15); to.set(from.x + ux * t, from.y + uy * t, from.z + uz * t); return; }
    t += Math.max(d * 0.8, 0.06);
  }
}

/* ================= drawing one hiker's view ================= */
const VIEW = M4.create(), PROJ = M4.create(), VP = M4.create(), INVVP = M4.create(), LV = M4.create(), LP = M4.create(), LVP = M4.create(), ID = M4.create();
const MA = M4.create(), MB = M4.create(), MC = M4.create();
const _x = new V3(), _f = new V3();
let simT = 0;
function hikerParts(W, cb) {
  _f.copy(W.f); retangent(_f, W.vn); _x.crossVectors(W.vn, _f);
  const Hm = M4.basis(MA, _x, W.vn, _f, W.p);
  const mv = Math.min(1, Math.abs(W.speed) / 4), sw = Math.sin(W.phase) * 0.75 * mv, bob = Math.abs(Math.cos(W.phase)) * 0.035 * mv;
  M4.mul(MB, Hm, M4.trans(MC, 0, bob, 0)); cb(R.H.body, MB);
  const legA = W.air ? [-0.7, 0.35] : [sw, -sw], armA = W.air ? [-2.5, -2.5] : [-sw * 0.8, sw * 0.8];
  for (let i = 0; i < 2; i++) {
    const s = i ? -1 : 1;
    const L = M4.mul(M4.create(), Hm, M4.trans(MC, s * 0.085, 0.47 + bob, 0)); M4.mul(L, L, M4.rotX(MC, legA[i])); cb(R.H.leg, L);
    const A = M4.mul(M4.create(), Hm, M4.trans(MC, s * 0.205, 0.8 + bob, 0)); M4.mul(A, A, M4.rotX(MC, armA[i])); cb(R.H.arm, A);
  }
}
function render(k, w, h, scale, glow) {
  if (!R) R = makeRenderer();
  const gl = R.gl, W = hikers[k], cam = W.cam;
  if (state === 'ready' && !R.terrain) R.terrain = R.makeMesh({ pos: MESH.pos, nor: MESH.nor, col: MESH.col, ext: MESH.ext, idx: MESH.idx });
  if (R.canvas.width !== w || R.canvas.height !== h) { R.canvas.width = w; R.canvas.height = h; }
  if (!cam.init) step(k, 0.016, 1, null, false);
  // Input size is the lens: at 100 it sees about as much as your eye, lower sees wider
  const fov = clamp(62 * Math.pow(2.5 / scale, 0.6), 28, 115) * Math.PI / 180;
  M4.persp(PROJ, fov, w / h, 0.08, 1600);
  M4.lookAt(VIEW, cam.pos, cam.look, cam.up); M4.mul(VP, PROJ, VIEW); M4.invert(INVVP, VP);
  const sunCol = SUN_COL.map((v) => v * glow);
  const ready = !!R.terrain;
  if (ready && R.shadowOK) {
    const c = W.p, lz = SUN, lx = new V3().crossVectors(new V3(0, 1, 0), lz).normalize(), ly = new V3().crossVectors(lz, lx);
    const ts = 2 * SHADOW_EXT / SHADOW_SIZE, a = c.dot(lx), b = c.dot(ly);
    const cc = c.clone().addScaledVector(lx, Math.round(a / ts) * ts - a).addScaledVector(ly, Math.round(b / ts) * ts - b);
    M4.lookAt(LV, cc.clone().addScaledVector(SUN, 160), cc, ly); M4.ortho(LP, -SHADOW_EXT, SHADOW_EXT, -SHADOW_EXT, SHADOW_EXT, 1, 340); M4.mul(LVP, LP, LV);
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.shadowFB); gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
    const P = R.PR.depth; gl.useProgram(P.p); gl.uniformMatrix4fv(P.u('uLightVP'), false, LVP);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
    const draw = (m, M) => { gl.uniformMatrix4fv(P.u('uModel'), false, M); gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, m.type, 0); };
    draw(R.terrain, ID);
    hikerParts(W, draw);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0.17, 0.42, 0.65, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
  { const P = R.PR.sky; gl.useProgram(P.p); gl.uniformMatrix4fv(P.u('uInvVP'), false, INVVP); gl.uniform3f(P.u('uCam'), cam.pos.x, cam.pos.y, cam.pos.z); gl.uniform3f(P.u('uSun'), SUN.x, SUN.y, SUN.z); gl.bindVertexArray(R.QUAD); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  if (ready) {
    const P = R.PR.lit; gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u('uVP'), false, VP); gl.uniformMatrix4fv(P.u('uLightVP'), false, LVP);
    gl.uniform3f(P.u('uCam'), cam.pos.x, cam.pos.y, cam.pos.z); gl.uniform3f(P.u('uSun'), SUN.x, SUN.y, SUN.z);
    gl.uniform3fv(P.u('uSunCol'), sunCol); gl.uniform3fv(P.u('uSkyAmb'), SKY_AMB); gl.uniform3fv(P.u('uGroundAmb'), GROUND_AMB);
    gl.uniform2f(P.u('uFog'), 110, 560); gl.uniform1f(P.u('uShadowOn'), R.shadowOK ? 1 : 0); gl.uniform1f(P.u('uTexel'), 1 / SHADOW_SIZE);
    gl.uniform1i(P.u('uShadow'), 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.shadowTex);
    gl.uniform1f(P.u('uTwoSided'), 0);
    gl.uniform3fv(P.u('uEyeC'), R.EYE_U.c); gl.uniform3fv(P.u('uEyeF'), R.EYE_U.f); gl.uniform3fv(P.u('uEyeR'), R.EYE_U.r); gl.uniform3fv(P.u('uEyeU'), R.EYE_U.u);
    const draw = (m, M) => { gl.uniformMatrix4fv(P.u('uModel'), false, M); gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, m.type, 0); };
    draw(R.terrain, ID);
    gl.uniform1f(P.u('uTwoSided'), 1);
    for (const L of LM) {
      _f.set(0, 0, 1); retangent(_f, L.n); _x.crossVectors(L.n, _f); M4.basis(MA, _x, L.n, _f, L.p);
      M4.mul(MA, MA, M4.rotY(MC, 0.4 + Math.sin(simT * 1.3 + L.p.x) * 0.35));
      draw(R.flag, MA);
    }
    gl.uniform1f(P.u('uTwoSided'), 0);
    hikerParts(W, draw);
  }
  // The glowing bits: the beam over the next flag, the gold dots to it, and drifting pollen
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  if (ready && W.route) {
    const U = R.PR.ul, L = LM[W.route.target];
    gl.useProgram(U.p); gl.uniformMatrix4fv(U.u('uVP'), false, VP);
    _f.set(0, 0, 1); retangent(_f, L.n); _x.crossVectors(L.n, _f); M4.basis(MA, _x, L.n, _f, L.p);
    gl.uniform3f(U.u('uColor'), 1.0, 0.78, 0.3); gl.uniform1f(U.u('uOpaque'), 0); gl.uniform1f(U.u('uAlpha'), 0.32); gl.uniform1f(U.u('uFadeH'), 16);
    const Mb = M4.mul(M4.create(), MA, M4.create());
    for (const i of [0, 1, 2, 8, 9, 10]) Mb[i] *= 0.45;
    for (const i of [4, 5, 6]) Mb[i] *= 16;
    gl.uniformMatrix4fv(U.u('uModel'), false, Mb); gl.bindVertexArray(R.BEAM.vao); gl.drawElements(gl.TRIANGLES, R.BEAM.count, R.BEAM.type, 0);
    gl.uniform1f(U.u('uFadeH'), 0); gl.uniform1f(U.u('uAlpha'), 0.9); gl.uniform1f(U.u('uOpaque'), 1);
    const Mr = M4.mul(M4.create(), MA, M4.trans(MC, 0, 0.12, 0)); M4.mul(Mr, Mr, M4.scale(MC, 1 + 0.18 * Math.sin(simT * 4)));
    gl.uniformMatrix4fv(U.u('uModel'), false, Mr); gl.bindVertexArray(R.RING.vao); gl.drawElements(gl.TRIANGLES, R.RING.count, R.RING.type, 0);
  }
  {
    const T = R.PR.pt; gl.useProgram(T.p); gl.uniformMatrix4fv(T.u('uVP'), false, VP); gl.uniform1f(T.u('uScale'), h * PROJ[5] * 0.5);
    let tr = R.trails[k];
    if (W.trailDirty) {
      if (!tr) tr = R.trails[k] = R.dynPoints(3000);
      tr.n = W.trailPts ? Math.min(3000, W.trailPts.length / 3) : 0;
      if (tr.n) { gl.bindBuffer(gl.ARRAY_BUFFER, tr.b); gl.bufferSubData(gl.ARRAY_BUFFER, 0, W.trailPts.subarray(0, tr.n * 3)); }
      W.trailDirty = false;
    }
    if (ready && tr && tr.n > 0) { gl.uniform3f(T.u('uColor'), 1.0, 0.82, 0.36); gl.uniform1f(T.u('uAlpha'), 0.95); gl.uniform1f(T.u('uOpaque'), 1); gl.uniform1f(T.u('uSize'), 0.42); gl.bindVertexArray(tr.vao); gl.drawArrays(gl.POINTS, 0, tr.n); }
    const pb = R.pollenBase, pp = R.pollenPos;
    for (let i = 0; i < POLLEN_N; i++) { const b = i * 4, t = simT * 0.25 + pb[b + 3]; pp[i * 3] = pb[b] + Math.sin(t * 0.9) * 2.5; pp[i * 3 + 1] = pb[b + 1] + Math.sin(t * 0.6 + 1) * 1.8; pp[i * 3 + 2] = pb[b + 2] + Math.cos(t * 0.8) * 2.5; }
    gl.bindBuffer(gl.ARRAY_BUFFER, R.POLLEN.b); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pp);
    gl.uniform3f(T.u('uColor'), 1.0, 0.9, 0.6); gl.uniform1f(T.u('uAlpha'), 0.75); gl.uniform1f(T.u('uOpaque'), 0); gl.uniform1f(T.u('uSize'), 0.3);
    gl.bindVertexArray(R.POLLEN.vao); gl.drawArrays(gl.POINTS, 0, POLLEN_N);
  }
  {
    const CL = R.CLOUDS, order = CL.map((c, i) => [i, (c.x - cam.pos.x) ** 2 + (c.y - cam.pos.y) ** 2 + (c.z - cam.pos.z) ** 2]).sort((a, b) => b[1] - a[1]);
    order.forEach(([i], j) => { const c = CL[i]; R.cloudInst[j * 4] = c.x; R.cloudInst[j * 4 + 1] = c.y; R.cloudInst[j * 4 + 2] = c.z; R.cloudInst[j * 4 + 3] = c.s; R.cloudMeta[j * 2] = c.a; R.cloudMeta[j * 2 + 1] = c.v; });
    gl.bindBuffer(gl.ARRAY_BUFFER, R.cloudInstBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, R.cloudInst);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.cloudMetaBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, R.cloudMeta);
    const Cp = R.PR.cloud; gl.useProgram(Cp.p); gl.uniformMatrix4fv(Cp.u('uVP'), false, VP);
    gl.uniform3f(Cp.u('uRight'), VIEW[0], VIEW[4], VIEW[8]); gl.uniform3f(Cp.u('uUp'), VIEW[1], VIEW[5], VIEW[9]);
    gl.uniform3f(Cp.u('uCam'), cam.pos.x, cam.pos.y, cam.pos.z); gl.uniform3f(Cp.u('uSun'), SUN.x, SUN.y, SUN.z);
    gl.uniform1i(Cp.u('uTex'), 1); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.cloudTex);
    gl.bindVertexArray(R.CLOUD_VAO); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, CL.length); gl.activeTexture(gl.TEXTURE0);
  }
  gl.depthMask(true); gl.disable(gl.BLEND); gl.bindVertexArray(null);
  return R.canvas;
}

window.PhosphorRibbit = {
  get state() { return state; },
  build,
  // Steps a loop's hiker; see step()
  step(k, dt, mult, ctl, auto) { simT = performance.now() / 1000; step(k, dt, mult, ctl, auto); },
  // Draws a loop's hiker's view at w x h and returns the canvas holding it (null if it can't draw)
  render(k, w, h, scale, glow) {
    if (state === 'failed') return null;
    try { return render(k, w, h, scale, glow); } catch (err) { console.error('Mount Ribbit', err); state = 'failed'; return null; }
  },
  where(k) { const W = hikers[k]; return { p: [W.p.x, W.p.y, W.p.z], air: W.air, route: W.route ? LM[W.route.target].name : null, stop: LM[W.stop].name, cam: +W.cam.pos.distanceTo(W.p).toFixed(2), ready: state }; }
};
})();
