'use strict';
window.PhosphorFractals = (() => {
/* ================= the fractal flights ================= */
// ---- The fractal flights' shapes, measured on this side too, so the camera knows where the walls are ----
// Each returns how far a point is from the fractal's surface (never more than the true distance). They are
// worked out exactly as the fractal's picture program works them out, so the camera never flies into
// something that is drawn there. Every fractal is about 2 across, centred on the middle.
const FR = (() => {
  const fract = (x) => x - Math.floor(x);
  const mod2 = (x) => x - 2 * Math.floor(x / 2);
  // Menger sponge: a cube with a cross-shaped hole through it, and the same hole through every smaller cube
  function sponge(x, y, z) {
    const bx = Math.abs(x) - 1, by = Math.abs(y) - 1, bz = Math.abs(z) - 1;
    let d = Math.min(Math.max(bx, by, bz), 0) + Math.hypot(Math.max(bx, 0), Math.max(by, 0), Math.max(bz, 0));
    let s = 1;
    for (let m = 0; m < 6; m++) {
      const ax = mod2(x * s) - 1, ay = mod2(y * s) - 1, az = mod2(z * s) - 1;
      s *= 3;
      const rx = Math.abs(1 - 3 * Math.abs(ax)), ry = Math.abs(1 - 3 * Math.abs(ay)), rz = Math.abs(1 - 3 * Math.abs(az));
      const c = (Math.min(Math.max(rx, ry), Math.max(ry, rz), Math.max(rz, rx)) - 1) / s;
      if (c > d) d = c;
    }
    return d;
  }
  // Mandelbulb: the Mandelbrot set's rule worked in 3D, to the 8th power
  function bulb(x, y, z) {
    let wx = x, wy = y, wz = z, m = x * x + y * y + z * z, dz = 1;
    for (let i = 0; i < 7; i++) {
      dz = 8 * Math.pow(m, 3.5) * dz + 1;
      const r = Math.sqrt(m);
      const b = 8 * Math.acos(Math.max(-1, Math.min(1, wy / Math.max(r, 1e-12)))), a = 8 * Math.atan2(wx, wz);
      const r8 = Math.pow(r, 8);
      wx = x + r8 * Math.sin(b) * Math.sin(a);
      wy = y + r8 * Math.cos(b);
      wz = z + r8 * Math.sin(b) * Math.cos(a);
      m = wx * wx + wy * wy + wz * wz;
      if (m > 256) break;
    }
    return 0.25 * Math.log(m) * Math.sqrt(m) / dz;
  }
  // Mandelbox: space folded inside a box and turned inside out through a ball, over and over
  const BOX_S = -1.77, BOX_K = 0.5;   // its scale, and how much it is shrunk to fit about 2 across
  function box(x, y, z) {
    x /= BOX_K; y /= BOX_K; z /= BOX_K;
    const cx = x, cy = y, cz = z;
    let dr = 1;
    for (let i = 0; i < 10; i++) {
      x = Math.max(-1, Math.min(1, x)) * 2 - x;
      y = Math.max(-1, Math.min(1, y)) * 2 - y;
      z = Math.max(-1, Math.min(1, z)) * 2 - z;
      const r2 = x * x + y * y + z * z;
      const k = r2 < 0.25 ? 4 : r2 < 1 ? 1 / r2 : 1;
      x *= k; y *= k; z *= k; dr *= k;
      x = BOX_S * x + cx; y = BOX_S * y + cy; z = BOX_S * z + cz;
      dr = dr * Math.abs(BOX_S) + 1;
    }
    return (Math.hypot(x, y, z) / Math.abs(dr)) * BOX_K;
  }
  // Sierpinski pyramid: a pyramid made of four half-size pyramids, each made of four, and so on
  function pyramid(x, y, z) {
    let s = 1;
    for (let i = 0; i < 9; i++) {
      let t;
      if (x + y < 0) { t = -y; y = -x; x = t; }
      if (x + z < 0) { t = -z; z = -x; x = t; }
      if (y + z < 0) { t = -z; z = -y; y = t; }
      x = 2 * x - 1; y = 2 * y - 1; z = 2 * z - 1;
      s *= 2;
    }
    const d = (Math.max(-x - y - z, x + y - z, -x + y + z, x - y + z) - 1) * 0.57735027;
    return d / s;
  }
  // Julia: a slice through a 4D Julia set
  const JC = [0.18, 0.88, 0.24, 0.16];
  const JK = 1.1;   // shrunk to fit about 2.5 across
  function julia(x, y, z) {
    let a = x * JK, b = y * JK, c = z * JK, e = 0;
    let md2 = 1, mz2 = a * a + b * b + c * c;
    for (let i = 0; i < 9; i++) {
      md2 *= 4 * mz2;
      const na = a * a - b * b - c * c - e * e + JC[0];
      const k = 2 * a;
      b = k * b + JC[1]; c = k * c + JC[2]; e = k * e + JC[3]; a = na;
      mz2 = a * a + b * b + c * c + e * e;
      if (mz2 > 16) break;
    }
    return 0.25 * Math.sqrt(mz2 / md2) * Math.log(mz2) / JK;
  }
  // Kaleidoscope: a shape mirrored eight ways, turned a little, shrunk and mirrored again: crystal shards
  const rot = (ax, ay, az, ang) => {
    const l = Math.hypot(ax, ay, az); ax /= l; ay /= l; az /= l;
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return [t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
            t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
            t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c];
  };
  const KR1 = rot(1, 1, 1, 0.3), KR2 = rot(0, 1, 0, 0.15);
  const KS = 2.0, KC = [1.0, 1.0, 1.0], KSAFE = 0.7;   // (its distance is only a rough one, so it is taken as less)
  function kaleido(x, y, z) {
    let s = 1, t;
    for (let i = 0; i < 4; i++) {
      let nx = KR1[0] * x + KR1[1] * y + KR1[2] * z, ny = KR1[3] * x + KR1[4] * y + KR1[5] * z, nz = KR1[6] * x + KR1[7] * y + KR1[8] * z;
      x = Math.abs(nx); y = Math.abs(ny); z = Math.abs(nz);
      if (x < y) { t = x; x = y; y = t; }
      if (x < z) { t = x; x = z; z = t; }
      if (y < z) { t = y; y = z; z = t; }
      nx = KR2[0] * x + KR2[1] * y + KR2[2] * z; ny = KR2[3] * x + KR2[4] * y + KR2[5] * z; nz = KR2[6] * x + KR2[7] * y + KR2[8] * z;
      x = KS * nx - KC[0] * (KS - 1); y = KS * ny - KC[1] * (KS - 1); z = KS * nz;
      if (z > 0.5 * KC[2] * (KS - 1)) z -= KC[2] * (KS - 1);
      s *= KS;
    }
    const bx = Math.abs(x) - 1, by = Math.abs(y) - 1, bz = Math.abs(z) - 1;
    return (Math.min(Math.max(bx, by, bz), 0) + Math.hypot(Math.max(bx, 0), Math.max(by, 0), Math.max(bz, 0))) / s * KSAFE;
  }
  // The middle of the sponge's nearest hole that is about the size the camera is diving to
  function spongeLure(p, want) {
    const n = Math.max(0, Math.min(5, Math.round(Math.log(2 / (6 * want * 1.5)) / Math.log(3))));
    const S = 2 / Math.pow(3, n);
    return p.map((v) => { const c = Math.max(-0.999, Math.min(0.999, v)); return (Math.floor((c + 1) / S) + 0.5) * S - 1; });
  }
  return { spongeLure, sponge, bulb, box, pyramid, julia, kaleido, BOX_S, BOX_K, JC, JK, KR1, KR2, KS, KC, KSAFE };
})();

// ---- The wandering camera ----
// A drone that explores a fractal on its own. It drifts and turns on a slow, never-repeating whim, keeps a
// chosen distance from the surface (closer and closer as it dives into the detail, then back out), steers away
// from anything ahead, banks into its turns and slowly rolls. Its speed is always a share of how far away the
// surface is, so the detail streams past at the same pace however deep it has gone: that is the zoom.
// Each loop has its own drone (seed), on its own route, half a dive apart.
function makeDrone(de, seed, o) {
  const rnd = (() => { let a = (seed * 2654435761) >>> 0 || 1; return () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; }; })();
  const ph = Array.from({ length: 12 }, () => rnd() * 6.2832);
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const nrm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const D = (p) => { const v = de(p[0], p[1], p[2]); return Number.isFinite(v) ? v : -1; };
  function grad(p, d) {
    const h = Math.max(Math.abs(d) * 0.05, 1e-7);
    return nrm([D([p[0] + h, p[1], p[2]]) - D([p[0] - h, p[1], p[2]]),
                D([p[0], p[1] + h, p[2]]) - D([p[0], p[1] - h, p[2]]),
                D([p[0], p[1], p[2] + h]) - D([p[0], p[1], p[2] - h])]);
  }
  // Start well outside, on a side of its own, heading roughly for the middle
  const a0 = rnd() * 6.2832, e0 = (rnd() - 0.5) * 1.2;
  const st = o.start * (0.9 + 0.2 * rnd());
  const s = {
    p: [st * Math.cos(e0) * Math.sin(a0), st * Math.sin(e0), st * Math.cos(e0) * Math.cos(a0)],
    phase: o.phase0, tau: 0, bank: 0, empty: 0, spin: rnd() < 0.5 ? -1 : 1,
  };
  s.f = nrm([-s.p[0] + (rnd() - 0.5), -s.p[1] + (rnd() - 0.5), -s.p[2] + (rnd() - 0.5)]);
  s.look = s.f.slice();
  { const dy = s.look[1]; s.up0 = nrm([-dy * s.look[0], 1 - dy * s.look[1], -dy * s.look[2]]); }
  s.d = D(s.p);
  s.scale = Math.max(s.d, o.near);
  s.up = s.up0.slice();
  // How deep the dive is (0 = far out, 1 = right in the finest detail), and whether it is on the way in
  const depthAt = (phase) => {
    const c = 0.5 - 0.5 * Math.cos(phase * 6.2832);
    return c * (0.78 + 0.22 * Math.sin(phase * 2.3 + ph[11]));
  };
  function step(dt) {
    s.tau += dt;
    s.phase += dt / o.dive;
    const depth = depthAt(s.phase);
    const diving = depthAt(s.phase + 0.01) > depth;
    const want = o.far * Math.pow(o.near / o.far, depth);   // the distance it wants to keep from the surface
    const p = s.p, t = s.tau;
    let d = D(p);
    const g = grad(p, d);
    // A slow whim: a direction that wanders all round over a minute or two
    const w = [Math.sin(t * 0.21 + ph[0]) + 0.6 * Math.sin(t * 0.53 + ph[1]) + 0.3 * Math.sin(t * 1.1 + ph[2]),
               0.8 * Math.sin(t * 0.17 + ph[3]) + 0.5 * Math.sin(t * 0.47 + ph[4]) + 0.3 * Math.sin(t * 0.97 + ph[5]),
               Math.sin(t * 0.19 + ph[6]) + 0.6 * Math.sin(t * 0.41 + ph[7]) + 0.3 * Math.sin(t * 1.3 + ph[8])];
    const wl = len(w) || 1;
    // Looks ahead in a spread of directions round where it is heading and leans towards open space (holes,
    // tunnels, gaps), towards its whim, and into the fractal on the way in (out again on the way back)
    const r = len(p), out = Math.max(0, r - o.roam) / o.roam;
    const inward = (diving ? 0.5 + 1.2 * depth : -0.5) + out * 4;
    // Where "in" is: the middle of the fractal, or for some, the middle of the nearest hole the size it is diving to
    const lp = o.lure ? o.lure(p, want) : [0, 0, 0];
    const toL = nrm([lp[0] - p[0], lp[1] - p[1], lp[2] - p[2]]);
    const fa = nrm(cross(s.f, Math.abs(s.f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), fb = cross(s.f, fa);
    const want3 = [0, 0, 0];
    let best = -1e9;
    const cands = [];
    for (let ring = 0; ring < 3; ring++) {
      const ang = [0, 0.55, 1.15][ring], n = [1, 8, 6][ring];
      for (let j = 0; j < n; j++) {
        const az = j / n * 6.2832 + t * 0.7 + ring;
        const ca = Math.cos(ang), sa = Math.sin(ang), cz = Math.cos(az), sz = Math.sin(az);
        const dir = [s.f[0] * ca + (fa[0] * cz + fb[0] * sz) * sa, s.f[1] * ca + (fa[1] * cz + fb[1] * sz) * sa, s.f[2] * ca + (fa[2] * cz + fb[2] * sz) * sa];
        const o1 = D([p[0] + dir[0] * d * 2.5, p[1] + dir[1] * d * 2.5, p[2] + dir[2] * d * 2.5]);
        const o2 = D([p[0] + dir[0] * d * 6, p[1] + dir[1] * d * 6, p[2] + dir[2] * d * 6]);
        const open = Math.min(o1, o2 * 0.7) / Math.max(Math.min(d, want * 1.5), 1e-9);
        const sc = 1.3 * Math.min(open, 1.5) + 0.5 * dot(dir, w) / wl + inward * dot(dir, toL) + 0.6 * ca;
        cands.push([sc, dir]);
        if (sc > best) best = sc;
      }
    }
    for (const [sc, dir] of cands) { const wt = Math.exp((sc - best) * 5); for (let i = 0; i < 3; i++) want3[i] += dir[i] * wt; }
    { const l = len(want3) || 1; for (let i = 0; i < 3; i++) want3[i] /= l; }
    // Keep the chosen distance from the surface: closer when it is far off, away when it is too close
    const err = Math.log(Math.max(d, 1e-9) / want);
    const k = err > 0 ? -Math.min(err * 0.3, 0.6) : Math.min(-err * 1.6, 3);
    for (let i = 0; i < 3; i++) want3[i] += g[i] * k;
    const wn = nrm(want3), kt = Math.min(1, 1.4 * dt);
    const fNew = nrm([s.f[0] + (wn[0] - s.f[0]) * kt, s.f[1] + (wn[1] - s.f[1]) * kt, s.f[2] + (wn[2] - s.f[2]) * kt]);
    // Banks into its turns
    const yaw = dot(cross(s.f, fNew), s.up0) / Math.max(dt, 1e-4);
    s.bank += (Math.max(-0.7, Math.min(0.7, -yaw * 1.6)) - s.bank) * Math.min(1, 1.5 * dt);
    s.f = fNew;
    // Moves a share of the distance to the surface, so it can never reach it
    let mv = Math.min(o.speed * d * dt, 0.4 * d);
    const np = [p[0] + s.f[0] * mv, p[1] + s.f[1] * mv, p[2] + s.f[2] * mv];
    const nd = D(np);
    if (nd > 0.25 * Math.min(d, want)) { s.p = np; d = nd; }
    else {
      // Too close: back straight away from the surface instead
      const back = Math.max(0.15 * d, 0);
      s.p = [p[0] + g[0] * back, p[1] + g[1] * back, p[2] + g[2] * back];
      d = D(s.p);
    }
    s.d = d;
    // The view looks where it is heading, leaning a little towards the nearest surface so the fractal stays in
    // view, and out in the open it turns to face the fractal (so pulling back out shows the whole thing)
    const rr = len(s.p), outside = Math.min(1, Math.max(0, (rr - o.size) / o.size)), gl = grad(s.p, d);
    // Is there anything straight ahead? (a quick look along the view, out to where the haze hides it)
    let tv = 0, seen = false;
    for (let i = 0; i < 24 && tv < d * 40; i++) {
      const dv = D([s.p[0] + s.look[0] * tv, s.p[1] + s.look[1] * tv, s.p[2] + s.look[2] * tv]);
      if (dv < d * 0.05) { seen = true; break; }
      tv += Math.max(dv, d * 0.05);
    }
    s.empty += ((seen ? 0 : 1) - s.empty) * Math.min(1, 1.2 * dt);
    const lean = 0.3 + 1.2 * s.empty;
    const lt = nrm([s.f[0] - lean * gl[0] - 2.5 * outside * s.p[0] / rr, s.f[1] - lean * gl[1] - 2.5 * outside * s.p[1] / rr, s.f[2] - lean * gl[2] - 2.5 * outside * s.p[2] / rr]);
    const kl = Math.min(1, 1.6 * dt);
    s.look = nrm([s.look[0] + (lt[0] - s.look[0]) * kl, s.look[1] + (lt[1] - s.look[1]) * kl, s.look[2] + (lt[2] - s.look[2]) * kl]);
    // Carry "up" along with the view, then roll it: a slow twist that sometimes goes all the way round, plus the bank
    const u = s.up0, du = dot(u, s.look);
    s.up0 = nrm([u[0] - du * s.look[0], u[1] - du * s.look[1], u[2] - du * s.look[2]]);
    const roll = s.spin * 0.05 * t + 1.1 * Math.sin(t * 0.083 + ph[9]) + 0.5 * Math.sin(t * 0.21 + ph[10]) + s.bank;
    const rt = cross(s.look, s.up0), c = Math.cos(roll), sn = Math.sin(roll);
    s.up = [s.up0[0] * c + rt[0] * sn, s.up0[1] * c + rt[1] * sn, s.up0[2] * c + rt[2] * sn];
    s.scale = Math.exp(Math.log(s.scale) + (Math.log(Math.max(d, o.near * 0.5)) - Math.log(s.scale)) * Math.min(1, 2 * dt));
  }
  // Long steps (a slow computer, or a big kick of the bass) are split into short ones
  s.fly = (dt) => { let left = dt; while (left > 1e-6) { const h = Math.min(left, 1 / 30); step(h); left -= h; } };
  return s;
}


return { FR, makeDrone };
})();
