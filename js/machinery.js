'use strict';
// Machinery: an isometric machine built of blocks, after a set of generative pictures Nick liked (clusters of pink,
// mauve and slate cubes with nested squares on their faces). Nothing fades in or out: about seven big modules ride
// to new places, dock against each other and now and then roll over a quarter turn, big blocks push out from each
// other on rams, and on them pistons, telescoping rods, shuttles on rails, flaps and open cube cages work away.
//
// Nothing ever passes through anything else. Every part books the space it sits in, and the space it is about to
// travel through, on a 3D grid of quarter-unit cells (`grid`, 120 cells a side); a move only starts if the way is
// clear and stops short when something is in the way (`feasible`, `reserve`, `settle`). A module rolling over books
// the disc each of its layers sweeps (`tryTurn`), so it first backs out of the cluster to make room (`wantTurn`).
// tests/machinery_check.cjs runs machines with no picture and looks for any two parts overlapping.
//
// The app (see "machinery" in js/app.js) keeps a state per loop and reads the picture through the 3D world slot, as
// the Chaos game's is. It is drawn with a depth buffer of its own (smoothed, where the graphics card can).
(typeof window !== 'undefined' ? window : globalThis).PhosphorMachinery = (() => {
// A loop's settings (the app keeps them with the loop's look): which colors, how fast (0 still, 50 normal, 100 three
// times as fast), and which machine (any whole number builds a different one).
const DEFAULTS = { machColor: 0, machSpeed: 50, machSeed: 3 };
// The sets of colors: tops, the two sides, small highlights, outlines. The background is always black, so the
// machine lies over the loop's trails like the other drawn inputs.
const PALETTES = [
  { name: 'Orchid',    c: ['#d9a9cf', '#9c5a86', '#6c6796', '#f0cfe6', '#e9d3ea'] },
  { name: 'Phosphor',  c: ['#c77dff', '#8b1ab8', '#4a1570', '#f2d6ff', '#e7c4ff'] },
  { name: 'Brass',     c: ['#e8c170', '#a8662e', '#5c4632', '#fff1c2', '#f3deb0'] },
  { name: 'Ice',       c: ['#bfe9f5', '#4f9fc4', '#2f4f86', '#ffffff', '#d8f3fb'] },
  { name: 'Ember',     c: ['#ffb36b', '#d9482b', '#6e1f2e', '#ffe9a8', '#ffd2a6'] },
  { name: 'Moss',      c: ['#c9e08f', '#5f9a55', '#2f5d54', '#f4ffc9', '#dcefb5'] },
  { name: 'Neon',      c: ['#00f0ff', '#ff2bd6', '#6a2bff', '#fff94d', '#ffffff'] },
  { name: 'Blueprint', c: ['#2f6fd0', '#1c4fa3', '#123a7c', '#9fd0ff', '#eaf4ff'] },
  { name: 'Steel',     c: ['#e6e8ec', '#9aa1ab', '#565d68', '#ffffff', '#f4f6f8'] },
  { name: 'Sunset',    c: ['#ffd08a', '#f0668a', '#5b3fa0', '#fff3d6', '#ffe0c2'] },
  { name: 'Candy',     c: ['#ff9ad5', '#5fd4ff', '#b06bff', '#fff36b', '#ffffff'] },
  { name: 'Mono',      c: ['#ffffff', '#8a8a8a', '#3c3c3c', '#ffffff', '#ffffff'] },
];
const COLORS = PALETTES.map((P) => P.name);
// A set's colors as a CSS background, for its button
function preview(i) {
  const c = (PALETTES[i] || PALETTES[0]).c;
  return `linear-gradient(90deg,#000 0 8%,${c[2]} 8% 36%,${c[1]} 36% 64%,${c[0]} 64% 92%,${c[3]} 92%)`;
}
const num = (v, d, lo, hi) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
function clean(s) {
  s = s || {};
  return { machColor: Math.round(num(s.machColor, 0, 0, COLORS.length - 1)), machSpeed: num(s.machSpeed, DEFAULTS.machSpeed, 0, 100),
    machSeed: Math.round(num(s.machSeed, DEFAULTS.machSeed, 1, 99999)) };
}
// A new machine in new colors (New machine, Surprise and Autopilot); the speed stays where it is
function look() { return { machColor: Math.floor(Math.random() * COLORS.length), machSeed: 1 + Math.floor(Math.random() * 99998) }; }
// Speed fader to a multiple of normal speed
const speedOf = (v) => (v <= 50 ? v / 50 : 1 + (v - 50) / 25);

  function hex(h) {
    return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255];
  }

  // ---------- small deterministic helpers ----------
  function hash(a, b) {              // -> [0,1)
    var x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  function rng(seed) {               // mulberry32
    var s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function ease(x) {                 // smooth start and stop, like a servo
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return x * x * x * (x * (x * 6 - 15) + 10);
  }
  // rotation by angle about an axis, as 9 numbers (row-major)
  function rot3(axis, ang, out) {
    var c = Math.cos(ang), s = Math.sin(ang);
    if (axis === 0) { out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0; out[4] = c; out[5] = -s; out[6] = 0; out[7] = s; out[8] = c; }
    else if (axis === 1) { out[0] = c; out[1] = 0; out[2] = s; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = -s; out[7] = 0; out[8] = c; }
    else { out[0] = c; out[1] = -s; out[2] = 0; out[3] = s; out[4] = c; out[5] = 0; out[6] = 0; out[7] = 0; out[8] = 1; }
    return out;
  }
  function mul3(a, b, out) {
    for (var r = 0; r < 3; r++) for (var k = 0; k < 3; k++) {
      out[r * 3 + k] = a[r * 3] * b[k] + a[r * 3 + 1] * b[3 + k] + a[r * 3 + 2] * b[6 + k];
    }
  }

  // ---------- the machine: solid parts that never pass through each other ----------
  // Every part books the space it sits in (and the space it is about to travel
  // through) on a 3D grid of quarter-unit cells. A move only starts if the way
  // is clear, and stops short when something is in the way.
  var Q = 0.25, GN = 120, GH = GN / 2, BOUND = 4.5;

  function Sim(seed) {
    var R = rng(seed * 7919 + 13);
    var ri = function (a, b) { return a + Math.floor(R() * (b - a + 1)); };
    var rr = function (a, b) { return a + R() * (b - a); };
    var pick = function (arr) { return arr[Math.floor(R() * arr.length)]; };
    var grid = new Int16Array(GN * GN * GN);
    var parts = [null];                       // parts[id]
    var stamp = [0], stampNo = 0;
    var modules = [];
    var time = 0;
    var gidNo = 1;
    var stats = { move: 0, turn: 0, arm: 0, part: 0, blocked: 0 };

    // ----- values that glide from one stop to the next
    function drv(v) { return { cur: v, from: v, to: v, t0: 0, dur: 1, on: false }; }
    function vis(d, t) { return d.on ? d.from + (d.to - d.from) * ease((t - d.t0) / d.dur) : d.cur; }

    // ----- where a part is, in its module's own coordinates
    var GOt = [0, 0, 0];
    function groupOff(A, g, useVis, t, out) {
      out[0] = out[1] = out[2] = 0;
      while (g > 0) {
        var G = A.groups[g];
        out[G.axis] += G.dir * 0.5 * (useVis ? vis(G.drv, t) : G.drv.cur);
        g = G.parent;
      }
    }
    function localBox(p, useVis, t, c, h, hsrc) {
      groupOff(p.A, p.g, useVis, t, GOt);
      c[0] = p.c[0] + GOt[0]; c[1] = p.c[1] + GOt[1]; c[2] = p.c[2] + GOt[2];
      h[0] = hsrc[0]; h[1] = hsrc[1]; h[2] = hsrc[2];
      if (p.kind === 'slide') {
        c[p.axis] += p.dir * 0.5 * (useVis ? vis(p.drv, t) : p.drv.cur);
      } else if (p.kind === 'rod') {
        var ext = 0.5 * (useVis ? vis(p.drv, t) : p.drv.cur);
        h[p.axis] = ext * 0.5; c[p.axis] += p.dir * ext * 0.5;
      }
    }

    // ----- grid bookkeeping
    var tc = [0, 0, 0], th = [0, 0, 0];
    // which cells a part covers right now (resting position). false if none.
    function rangeOf(p, r) {
      var A = p.A, Rm = A.R, T = A.T;
      localBox(p, false, 0, tc, th, p.keep || p.hn);
      for (var i = 0; i < 3; i++) {
        var cw = T[i] + Rm[i * 3] * tc[0] + Rm[i * 3 + 1] * tc[1] + Rm[i * 3 + 2] * tc[2];
        var hw = Math.abs(Rm[i * 3]) * th[0] + Math.abs(Rm[i * 3 + 1]) * th[1] + Math.abs(Rm[i * 3 + 2]) * th[2];
        if (hw < 0.02) return false;
        r[i * 2] = Math.floor((cw - hw + 0.01) / Q) + GH;
        r[i * 2 + 1] = Math.floor((cw + hw - 0.01) / Q) + GH + 1;
      }
      return true;
    }
    function inGrid(r) { return r[0] >= 0 && r[2] >= 0 && r[4] >= 0 && r[1] <= GN && r[3] <= GN && r[5] <= GN; }
    function fill(r, id) {
      for (var x = r[0]; x < r[1]; x++) for (var y = r[2]; y < r[3]; y++) {
        var o = (x * GN + y) * GN;
        for (var z = r[4]; z < r[5]; z++) if (grid[o + z] === 0) grid[o + z] = id;
      }
    }
    function clear(r, id) {
      for (var x = r[0]; x < r[1]; x++) for (var y = r[2]; y < r[3]; y++) {
        var o = (x * GN + y) * GN;
        for (var z = r[4]; z < r[5]; z++) if (grid[o + z] === id) grid[o + z] = 0;
      }
    }
    // may part p be in cell range r? (cells of stamped parts, its own gadget
    // and the block it is mounted in don't count)
    function free(r, p, st) {
      if (!inGrid(r)) return false;
      for (var x = r[0]; x < r[1]; x++) for (var y = r[2]; y < r[3]; y++) {
        var o = (x * GN + y) * GN;
        for (var z = r[4]; z < r[5]; z++) {
          var w = grid[o + z];
          if (w === 0 || w === p.pass || stamp[w] === st) continue;
          if (parts[w].gid === p.gid) continue;
          return false;
        }
      }
      return true;
    }
    var lay = new Int32Array(6);
    // how many cells can these parts travel along a world axis before hitting something
    function feasible(movers, wa, sg, n, st) {
      for (var k = 1; k <= n; k++) {
        for (var i = 0; i < movers.length; i++) {
          var p = movers[i];
          if (!p.has) continue;
          var r = p.range;
          lay[0] = r[0]; lay[1] = r[1]; lay[2] = r[2]; lay[3] = r[3]; lay[4] = r[4]; lay[5] = r[5];
          if (sg > 0) { lay[wa * 2] = r[wa * 2 + 1] + k - 1; lay[wa * 2 + 1] = r[wa * 2 + 1] + k; }
          else { lay[wa * 2] = r[wa * 2] - k; lay[wa * 2 + 1] = r[wa * 2] - k + 1; }
          if (!free(lay, p, st)) return k - 1;
        }
      }
      return n;
    }
    function stampAll(list, list2) {
      stampNo++;
      for (var i = 0; i < list.length; i++) stamp[list[i].id] = stampNo;
      if (list2) for (var j = 0; j < list2.length; j++) stamp[list2[j].id] = stampNo;
      return stampNo;
    }
    var nr = new Int32Array(6);
    // after the logical positions changed: book old place + path + new place
    function reserve(list) {
      for (var i = 0; i < list.length; i++) {
        var p = list[i], hadOld = p.has, sw = p.sweep, r = p.range, k;
        var hasNew = rangeOf(p, nr);
        if (hadOld && hasNew) { for (k = 0; k < 3; k++) { sw[k * 2] = Math.min(r[k * 2], nr[k * 2]); sw[k * 2 + 1] = Math.max(r[k * 2 + 1], nr[k * 2 + 1]); } }
        else if (hadOld) { for (k = 0; k < 6; k++) sw[k] = r[k]; }
        else if (hasNew) { for (k = 0; k < 6; k++) sw[k] = nr[k]; }
        p.swept = hadOld || hasNew;
        if (p.swept) fill(sw, p.id);
      }
    }
    // the move is over: give back the path, keep only the new place
    function settle(list) {
      var i, p;
      for (i = 0; i < list.length; i++) { p = list[i]; if (p.swept) clear(p.sweep, p.id); p.swept = false; }
      for (i = 0; i < list.length; i++) { p = list[i]; p.has = rangeOf(p, p.range); if (p.has) fill(p.range, p.id); }
      // a fixed piece that shares cells with a mover (the rail under its shuttle)
      // takes back any of its cells the mover just left
      for (i = 0; i < list.length; i++) {
        var mates = list[i].mates;
        for (var j = 0; mates && j < mates.length; j++) if (mates[j].has && !mates[j].swept) fill(mates[j].range, mates[j].id);
      }
    }
    // module axis -> world axis and direction
    function worldAxis(A, la, out) {
      for (var i = 0; i < 3; i++) { var v = A.R[i * 3 + la]; if (v !== 0) { out[0] = i; out[1] = v > 0 ? 1 : -1; return; } }
    }
    var wax = [0, 1];

    // ----- one actuator (piston, rod, shuttle, cage or a whole arm) tries to go somewhere new
    function tryAct(A, act, t, speed) {
      var d = act.drv, target = ri(act.lo, act.hi);
      if (target === d.cur) target = d.cur < act.hi ? d.cur + 1 : d.cur - 1;
      if (target < act.lo || target > act.hi) return false;
      for (var attempt = 0; attempt < 2; attempt++) {
        var sgn = target > d.cur ? 1 : -1, steps = Math.abs(target - d.cur);
        worldAxis(A, act.axis, wax);
        var st = stampAll(act.movers, act.rods);
        var k = feasible(act.movers, wax[0], wax[1] * act.dir * sgn, steps * 2, st);
        k = k >> 1;
        // the bar that grows behind the moving piece needs clear space too
        var keepCur = d.cur;
        for (; k > 0; k--) {
          d.cur = keepCur + sgn * k;
          var okRods = true;
          for (var ri2 = 0; ri2 < act.rods.length && okRods; ri2++) {
            if (rangeOf(act.rods[ri2], nr) && !free(nr, act.rods[ri2], st)) okRods = false;
          }
          if (okRods) break;
        }
        d.cur = keepCur;
        if (k > 0) {
          d.from = d.cur; d.to = d.cur + sgn * k; d.cur = d.to; d.t0 = t; d.dur = 0.45 + k * 0.5 / speed; d.on = true;
          reserve(act.all);
          act.t1 = t + d.dur; act.busy = true;
          return true;
        }
        // blocked that way: try the other way once
        target = sgn > 0 ? act.lo : act.hi;
        if (target === d.cur) break;
      }
      stats.blocked++;
      return false;
    }
    function endAct(act) { act.drv.on = false; settle(act.all); act.busy = false; }

    // ----- the whole module rides to a new place
    var DIRS = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
    function tryMove(A, t, outward) {
      var order = DIRS.slice(), i, j, tmp;
      for (i = 5; i > 0; i--) { j = Math.floor(R() * (i + 1)); tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
      // usually head back towards the middle so the machine stays one machine
      var inward = !outward && R() < 0.8;
      if (inward) order.sort(function (a, b) { return (A.T[a[0]] * a[1]) - (A.T[b[0]] * b[1]); });
      if (outward) order.sort(function (a, b) { return (A.T[b[0]] * b[1]) - (A.T[a[0]] * a[1]); });
      var st = stampAll(A.parts);
      for (var pass = 0; pass < 2; pass++) for (i = 0; i < 6; i++) {
        var wa = order[i][0], sg = order[i][1];
        // inward: ride until it docks against something; outward: a shorter hop
        var want = (A.T[wa] * sg < 0) ? ri(4, 16) : ri(2, 7);          // half units
        var room = Math.floor((BOUND - sg * A.T[wa]) * 2);
        if (want > room) want = room;
        if (want < 1) continue;
        var k = feasible(A.parts, wa, sg, want * 2, st) >> 1;
        if (k < (pass === 0 ? 3 : 1)) continue;
        var m = A.mv;
        m.from[0] = A.T[0]; m.from[1] = A.T[1]; m.from[2] = A.T[2];
        A.T[wa] += sg * k * 0.5;
        m.to[0] = A.T[0]; m.to[1] = A.T[1]; m.to[2] = A.T[2];
        m.t0 = t; m.dur = 0.9 + k * 0.5 / 2.1; m.on = true;
        reserve(A.parts);
        A.op = { kind: 'move', t1: t + m.dur };
        stats.move++;
        return true;
      }
      return false;
    }

    // ----- the whole module rolls over a quarter turn (needs elbow room)
    var layerR = new Float32Array(GN);
    function tryTurn(A, t) {
      var wa = ri(0, 2), sg = R() < 0.5 ? 1 : -1;
      var u = (wa + 1) % 3, v = (wa + 2) % 3;
      var cu = A.T[u] / Q + GH, cv = A.T[v] / Q + GH;
      var a0 = GN, a1 = 0, i, p, rmax = 0;
      for (i = 0; i < GN; i++) layerR[i] = 0;
      for (i = 0; i < A.parts.length; i++) {
        p = A.parts[i]; if (!p.has) continue;
        var r = p.range;
        var du = Math.max(Math.abs(r[u * 2] - cu), Math.abs(r[u * 2 + 1] - cu));
        var dv = Math.max(Math.abs(r[v * 2] - cv), Math.abs(r[v * 2 + 1] - cv));
        var rad = Math.sqrt(du * du + dv * dv);
        for (var a = r[wa * 2]; a < r[wa * 2 + 1]; a++) if (rad > layerR[a]) layerR[a] = rad;
        if (r[wa * 2] < a0) a0 = r[wa * 2]; if (r[wa * 2 + 1] > a1) a1 = r[wa * 2 + 1];
        if (rad > rmax) rmax = rad;
      }
      var u0 = Math.floor(cu - rmax), u1 = Math.ceil(cu + rmax), v0 = Math.floor(cv - rmax), v1 = Math.ceil(cv + rmax);
      if (u0 < 0 || v0 < 0 || u1 > GN || v1 > GN) return false;
      var idx = [0, 0, 0], id0 = A.parts[0].id, w, pass2, x, y, ax;
      // first look, then (if all clear) book the disc each layer sweeps
      for (pass2 = 0; pass2 < 2; pass2++) {
        for (ax = a0; ax < a1; ax++) {
          var LR = layerR[ax]; if (LR <= 0) continue;
          var LR2 = LR * LR;
          for (x = u0; x < u1; x++) for (y = v0; y < v1; y++) {
            var nx = Math.max(x - cu, cu - (x + 1), 0), ny = Math.max(y - cv, cv - (y + 1), 0);
            if (nx * nx + ny * ny >= LR2) continue;
            idx[wa] = ax; idx[u] = x; idx[v] = y;
            var o = (idx[0] * GN + idx[1]) * GN + idx[2];
            w = grid[o];
            if (pass2 === 0) { if (w !== 0 && parts[w].A !== A) return false; }
            else if (w === 0) grid[o] = id0;
          }
        }
      }
      var ra = A.rot;
      for (i = 0; i < 9; i++) ra.Rfrom[i] = A.R[i];
      ra.axis = wa; ra.sign = sg; ra.t0 = t; ra.dur = 2.3; ra.on = true;
      var Qm = quarter(wa, sg), N = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (var rI = 0; rI < 3; rI++) for (var cI = 0; cI < 3; cI++) {
        N[rI * 3 + cI] = Qm[rI * 3] * A.R[cI] + Qm[rI * 3 + 1] * A.R[3 + cI] + Qm[rI * 3 + 2] * A.R[6 + cI];
      }
      for (i = 0; i < 9; i++) A.R[i] = N[i];
      var box = [0, 0, 0, 0, 0, 0];
      box[wa * 2] = a0; box[wa * 2 + 1] = a1; box[u * 2] = u0; box[u * 2 + 1] = u1; box[v * 2] = v0; box[v * 2 + 1] = v1;
      A.op = { kind: 'turn', t1: t + ra.dur, box: box };
      stats.turn++;
      return true;
    }
    function quarter(axis, sg) {
      var m = [1, 0, 0, 0, 1, 0, 0, 0, 1], c = 0, s = sg;
      if (axis === 0) { m[4] = c; m[5] = -s; m[7] = s; m[8] = c; }
      else if (axis === 1) { m[0] = c; m[2] = s; m[6] = -s; m[8] = c; }
      else { m[0] = c; m[1] = -s; m[3] = s; m[4] = c; }
      return m;
    }
    function endOp(A) {
      var op = A.op, i;
      if (op.kind === 'move') { A.mv.on = false; settle(A.parts); }
      else if (op.kind === 'turn') {
        A.rot.on = false;
        var b = op.box;
        for (var x = b[0]; x < b[1]; x++) for (var y = b[2]; y < b[3]; y++) {
          var o = (x * GN + y) * GN;
          for (var z = b[4]; z < b[5]; z++) { var w = grid[o + z]; if (w !== 0 && parts[w].A === A) grid[o + z] = 0; }
        }
        for (i = 0; i < A.parts.length; i++) { A.parts[i].swept = false; A.parts[i].has = false; }
        settle(A.parts);
      } else if (op.kind === 'arm') { endAct(op.act); }
      A.op = null;
    }

    function tryBig(A, t) {
      var roll = R(), order;
      // a module that wants to roll over first backs out to make elbow room
      if (A.wantTurn > 0) {
        A.wantTurn--;
        if (tryTurn(A, t)) { A.wantTurn = 0; return true; }
        if (A.wantTurn > 0 && tryMove(A, t, true)) return true;
      } else if (roll > 0.72 && roll < 0.86) {
        if (tryTurn(A, t)) return true;
        A.wantTurn = 3;
        if (tryMove(A, t, true)) return true;
      }
      if (roll < 0.3) order = ['move', 'arm', 'turn'];
      else if (roll < 0.75) order = ['turn', 'move', 'arm'];
      else order = ['arm', 'move', 'turn'];
      for (var i = 0; i < 3; i++) {
        var k = order[i];
        if (k === 'move' && tryMove(A, t)) return true;
        if (k === 'turn' && tryTurn(A, t)) return true;
        if (k === 'arm' && A.arms.length) {
          var act = pick(A.arms);
          if (tryAct(A, act, t, 2.0)) { A.op = { kind: 'arm', t1: act.t1, act: act }; stats.arm++; return true; }
        }
      }
      return false;
    }

    // ----- advance the machine
    function step(dt) {
      time += dt;
      var t = time;
      for (var ai = 0; ai < modules.length; ai++) {
        var A = modules[ai], i, act;
        // small parts finishing
        for (i = 0; i < A.acts.length; i++) {
          act = A.acts[i];
          if (act.busy && t >= act.t1) { endAct(act); A.busy--; act.next = t + rr(0.4, 3.2); }
        }
        // flaps just turn (their turning circle is booked for good)
        for (i = 0; i < A.flaps.length; i++) {
          var f = A.flaps[i], d = f.drv;
          if (d.on && t >= d.t0 + d.dur) d.on = false;
          if (!d.on && t >= f.next) {
            d.from = d.cur; d.to = d.cur + (R() < 0.5 ? 1 : -1) * ri(1, 2); d.cur = d.to; d.t0 = t; d.dur = 0.7 + R() * 0.8; d.on = true;
            f.next = t + d.dur + rr(0.6, 4);
          }
        }
        if (A.op) {
          if (t >= A.op.t1) { endOp(A); A.nextBig = t + rr(1.2, 4.5); }
          continue;
        }
        if (t >= A.nextBig) {
          // ask the small parts to come to rest, then make the big move
          A.hold = true;
          if (A.busy === 0) {
            A.hold = false;
            if (!tryBig(A, t)) A.nextBig = t + rr(0.6, 1.6);
            else continue;
          }
        }
        if (!A.hold) {
          for (i = 0; i < A.acts.length; i++) {
            act = A.acts[i];
            if (!act.busy && t >= act.next) {
              if (tryAct(A, act, t, 2.6)) { A.busy++; stats.part++; }
              else act.next = t + rr(0.5, 2);
            }
          }
        }
      }
    }

    // ================= building =================
    function newPart(A, o) {
      var p = {
        id: parts.length, A: A, c: o.c, hn: o.h.slice(), kind: o.kind || 'fixed', axis: o.axis || 0, dir: o.dir || 1,
        drv: o.drv || null, pass: o.pass || 0, gid: o.gid, g: o.g || 0, keep: o.keep || null,
        pat: o.pat || 0, tone: o.tone === undefined ? (R() < 0.22 ? ri(1, 2) : 0) : o.tone,
        range: new Int32Array(6), sweep: new Int32Array(6), has: false, swept: false
      };
      // tiny size difference per part so touching faces never flicker
      var e = 0.004 + 0.02 * hash(p.id, 91);
      p.h = [Math.max(0.01, p.hn[0] - e), Math.max(0.01, p.hn[1] - e), Math.max(0.01, p.hn[2] - e)];
      return p;
    }
    // add a gadget (one or more parts) only if it fits without touching anything else
    function addGadget(A, defs) {
      var gid = gidNo++, made = [], i, p, ok = true, r = new Int32Array(6);
      for (i = 0; i < defs.length; i++) {
        defs[i].gid = gid;
        p = newPart(A, defs[i]); p.id = parts.length + i; made.push(p);
      }
      for (i = 0; i < made.length; i++) { parts.push(made[i]); stamp.push(0); }
      for (i = 0; i < made.length && ok; i++) {
        p = made[i];
        if (rangeOf(p, r) && !free(r, p, -1)) ok = false;
      }
      if (!ok) { parts.length -= made.length; stamp.length -= made.length; return null; }
      for (i = 0; i < made.length; i++) {
        p = made[i]; p.has = rangeOf(p, p.range); if (p.has) fill(p.range, p.id);
        if (made.length > 1) p.mates = made;
        A.parts.push(p);
      }
      return made;
    }
    function makeAct(A, d, movers, rods, axis, dir, lo, hi) {
      return { drv: d, movers: movers, rods: rods, all: movers.concat(rods), axis: axis, dir: dir, lo: lo, hi: hi,
               busy: false, t1: 0, next: rr(0.2, 4) };
    }

    function buildModule() {
      var A = {
        T: [0, 0, 0], R: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        mv: { on: false, from: [0, 0, 0], to: [0, 0, 0], t0: 0, dur: 1 },
        rot: { on: false, axis: 0, sign: 1, t0: 0, dur: 1, Rfrom: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
        groups: [null], parts: [], acts: [], arms: [], flaps: [],
        op: null, busy: 0, hold: false, wantTurn: 0, nextBig: rr(0.5, 6)
      };
      var hull = [], b, tries;
      var nHull = ri(2, 3);
      for (b = 0; b < nHull; b++) {
        for (tries = 0; tries < 8; tries++) {
          var size = pick([1, 1, 1.5, 1.5, 2]);
          var hh = R() < 0.7 ? [size, size, size] : [pick([1, 1.5, 2]), pick([0.5, 1]), pick([1, 1.5])];
          var c = [0, 0, 0], g = 0, G = null, prev = null, ax = 0, sg = 1;
          if (hull.length) {
            prev = pick(hull); ax = ri(0, 2); sg = R() < 0.5 ? -1 : 1;
            c = prev.c.slice();
            c[ax] += sg * (prev.hh[ax] + hh[ax]);
            c[(ax + 1) % 3] += ri(-1, 1) * 0.5;
            // this block is an ARM: it rides out from the block before it on a
            // thick ram, carrying everything bolted to it
            g = A.groups.length;
            G = { parent: prev.g, axis: ax, dir: sg, drv: drv(0) };
          }
          if (G) A.groups.push(G);
          var made = addGadget(A, [{ c: c, h: hh, pat: R() < 0.8 ? ri(1, 2) : 0, g: g }]);
          if (!made) { if (G) A.groups.pop(); continue; }
          var blk = { c: c, hh: hh, g: g, part: made[0] };
          hull.push(blk);
          if (G) {
            var rb = prev.c.slice(); rb[ax] += sg * prev.hh[ax];
            // the ram sits inside the footprint where the two blocks meet
            var o1 = (ax + 1) % 3;
            rb[o1] = (Math.max(prev.c[o1] - prev.hh[o1], c[o1] - hh[o1]) + Math.min(prev.c[o1] + prev.hh[o1], c[o1] + hh[o1])) / 2;
            var lap = Math.min(prev.c[o1] + prev.hh[o1], c[o1] + hh[o1]) - Math.max(prev.c[o1] - prev.hh[o1], c[o1] - hh[o1]);
            var rth = lap >= 1 ? 0.25 : 0.125;
            var rt = [rth, rth, rth];
            var ram = addGadget(A, [{ c: rb, h: rt, kind: 'rod', axis: ax, dir: sg, drv: G.drv, g: prev.g, tone: 2 }]);
            G.ram = ram ? ram[0] : null; G.blk = blk; G.hi = ri(3, 9);
          }
          break;
        }
      }

      var nAttach = ri(40, 56), n;
      for (n = 0; n < nAttach; n++) {
        var hb = pick(hull), cg = hb.g, hid = hb.part.id;
        var fa = ri(0, 2), fs = R() < 0.62 ? 1 : -1;
        var u = (fa + 1) % 3, v = (fa + 2) % 3;
        var pu = Math.round((R() * 2 - 1) * hb.hh[u] * 2) / 2;
        var pv = Math.round((R() * 2 - 1) * hb.hh[v] * 2) / 2;
        var base = hb.c.slice();
        base[fa] += fs * hb.hh[fa]; base[u] += pu; base[v] += pv;
        var roll = R(), d, m2;

        if (roll < 0.22) {
          // PISTON: a block that pushes straight out of the face and back
          var ph = pick([0.25, 0.5, 0.5, 0.75]);
          ph = Math.max(0.25, Math.min(ph, hb.hh[u] - 0.25, hb.hh[v] - 0.25));   // keep it well inside the face
          var depth = Math.min(pick([0.5, 0.75, 1]), hb.hh[fa]);
          var hp = [0, 0, 0]; hp[fa] = depth; hp[u] = ph; hp[v] = ph;
          var cp = base.slice(); cp[fa] -= fs * (depth - 0.25);
          cp[u] = Math.max(hb.c[u] - hb.hh[u] + ph, Math.min(hb.c[u] + hb.hh[u] - ph, cp[u]));
          cp[v] = Math.max(hb.c[v] - hb.hh[v] + ph, Math.min(hb.c[v] + hb.hh[v] - ph, cp[v]));
          d = drv(0);
          m2 = addGadget(A, [{ c: cp, h: hp, kind: 'slide', axis: fa, dir: fs, drv: d, pass: hid, g: cg, pat: R() < 0.7 ? ri(1, 2) : 0 }]);
          if (m2) A.acts.push(makeAct(A, d, m2, [], fa, fs, 0, Math.max(1, Math.round(depth * 4) - 2)));
        } else if (roll < 0.38) {
          // ROD: a thin bar that telescopes out, with a block on its tip
          var hk = pick([0.25, 0.25, 0.5]);
          var ck = base.slice(); ck[fa] += fs * hk;
          d = drv(0);
          m2 = addGadget(A, [
            { c: ck, h: [hk, hk, hk], kind: 'slide', axis: fa, dir: fs, drv: d, g: cg, tone: R() < 0.5 ? 3 : 0, pat: hk >= 0.5 ? 1 : 0 },
            { c: base.slice(), h: [0.125, 0.125, 0.125], kind: 'rod', axis: fa, dir: fs, drv: d, g: cg }
          ]);
          if (m2) A.acts.push(makeAct(A, d, [m2[0]], [m2[1]], fa, fs, 0, ri(2, 6)));
        } else if (roll < 0.54) {
          // RAIL + SHUTTLE: a bar along the face with a block running along it
          var len = pick([1, 1.5, 2, 2.5]);
          var hrail = [0, 0, 0]; hrail[fa] = 0.0625; hrail[u] = len; hrail[v] = 0.0625;
          var cr = base.slice(); cr[fa] += fs * 0.25;
          d = drv(0);
          var span = Math.round(len * 2) - 1;
          m2 = addGadget(A, [
            { c: cr.slice(), h: [0.25, 0.25, 0.25], kind: 'slide', axis: u, dir: 1, drv: d, g: cg, tone: R() < 0.35 ? 3 : ri(0, 2) },
            { c: cr, h: hrail, g: cg }
          ]);
          if (m2) A.acts.push(makeAct(A, d, [m2[0]], [], u, 1, -span, span));
        } else if (roll < 0.66) {
          // FLAP: a flat plate that clacks round in quarter turns
          var fu = pick([0.5, 0.75, 1]), fv = pick([0.25, 0.5]);
          var hf = [0, 0, 0]; hf[fa] = 0.125; hf[u] = fu; hf[v] = fv;
          var rad = Math.ceil(Math.sqrt(fu * fu + fv * fv) * 4) / 4;
          var keep = [0, 0, 0]; keep[fa] = 0.125; keep[u] = rad; keep[v] = rad;
          var cf = base.slice(); cf[fa] += fs * 0.375;
          var hx = [0.125, 0.125, 0.125];
          var cx = base.slice(); cx[fa] += fs * 0.125;
          d = drv(0);
          m2 = addGadget(A, [
            { c: cf, h: hf, kind: 'spin', axis: fa, drv: d, keep: keep, g: cg },
            { c: cx, h: hx, g: cg }
          ]);
          if (m2) A.flaps.push({ drv: d, next: rr(0.5, 5) });
        } else if (roll < 0.74) {
          // CAGE: an open cube frame that slides
          var cs = pick([0.5, 0.75]), t2 = 0.0625;
          var cc = base.slice(); cc[fa] += fs * (cs + 0.25);
          d = drv(0);
          var defs = [];
          for (var e1 = 0; e1 < 3; e1++) {
            var e2 = (e1 + 1) % 3, e3 = (e1 + 2) % 3;
            for (var q = 0; q < 4; q++) {
              var hc = [t2, t2, t2]; hc[e1] = cs;
              var c2 = cc.slice();
              c2[e2] += (q & 1 ? 1 : -1) * (cs - t2);
              c2[e3] += (q & 2 ? 1 : -1) * (cs - t2);
              defs.push({ c: c2, h: hc, kind: 'slide', axis: fa, dir: fs, drv: d, g: cg, tone: 0 });
            }
          }
          m2 = addGadget(A, defs);
          if (m2) A.acts.push(makeAct(A, d, m2, [], fa, fs, 0, ri(1, 4)));
        } else {
          // GREEBLES: small fixed blocks that give the pixelly edge
          var gs = pick([0.125, 0.25, 0.25, 0.375, 0.5]);
          var hg = [gs, gs, gs];
          if (R() < 0.4) hg[pick([u, v])] = gs * pick([2, 3]);
          var cg2 = base.slice(); cg2[fa] += fs * hg[fa];
          addGadget(A, [{ c: cg2, h: hg, g: cg, pat: gs >= 0.375 && R() < 0.6 ? 1 : 0 }]);
        }
      }

      // arms: everything on an arm block (and on arms growing from it) moves together
      for (var gi = 1; gi < A.groups.length; gi++) {
        var Gr = A.groups[gi], sub = {}, movers = [];
        sub[gi] = true;
        for (var gj = gi + 1; gj < A.groups.length; gj++) if (sub[A.groups[gj].parent]) sub[gj] = true;
        for (var pi = 0; pi < A.parts.length; pi++) if (sub[A.parts[pi].g] && A.parts[pi] !== Gr.ram) movers.push(A.parts[pi]);
        if (Gr.ram) A.arms.push(makeAct(A, Gr.drv, movers, [Gr.ram], Gr.axis, Gr.dir, 0, Gr.hi));
      }
      return A;
    }

    function unbook(A) { for (var i = 0; i < A.parts.length; i++) { var p = A.parts[i]; if (p.has) clear(p.range, p.id); } }
    function book(A) { for (var i = 0; i < A.parts.length; i++) { var p = A.parts[i]; p.has = rangeOf(p, p.range); if (p.has) fill(p.range, p.id); } }
    function fits(A) {
      var r = new Int32Array(6);
      for (var i = 0; i < A.parts.length; i++) {
        if (!rangeOf(A.parts[i], r)) continue;
        if (!inGrid(r)) return false;
        for (var x = r[0]; x < r[1]; x++) for (var y = r[2]; y < r[3]; y++) {
          var o = (x * GN + y) * GN;
          for (var z = r[4]; z < r[5]; z++) if (grid[o + z] !== 0) return false;
        }
      }
      return true;
    }

    // build each module on an empty bench, then dock them together, closest to the middle first
    var nMod = 7, mi;
    for (mi = 0; mi < nMod; mi++) { var M = buildModule(); unbook(M); modules.push(M); }
    var spots = [];
    for (var sx = -BOUND; sx <= BOUND; sx += 0.5) for (var sy = -BOUND; sy <= BOUND; sy += 0.5) for (var sz = -BOUND; sz <= BOUND; sz += 0.5) {
      spots.push([sx, sy, sz, Math.sqrt(sx * sx + sy * sy + sz * sz) + R() * 1.2]);
    }
    spots.sort(function (a, b) { return a[3] - b[3]; });
    for (mi = 0; mi < modules.length; mi++) {
      var Mo = modules[mi], placed = false;
      for (var si = 0; si < spots.length && !placed; si++) {
        Mo.T[0] = spots[si][0]; Mo.T[1] = spots[si][1]; Mo.T[2] = spots[si][2];
        if (fits(Mo)) { book(Mo); placed = true; }
      }
      if (!placed) { modules.splice(mi, 1); mi--; }
    }

    return {
      modules: modules, parts: parts, step: step, vis: vis, localBox: localBox, stats: stats,
      time: function () { return time; }
    };
  }

  // ---------- drawing ----------
  var VS = [
    'attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV; attribute vec2 aHalf; attribute vec2 aInfo;',
    'uniform vec2 uView; uniform vec2 uCenter;',                    // world half-height, aspect
    'varying vec3 vN; varying vec2 vUV; varying vec2 vHalf; varying vec2 vInfo;',
    'void main(){',
    '  float sx = (aPos.x - aPos.z) * 0.8660254;',
    '  float sy = aPos.y - (aPos.x + aPos.z) * 0.5;',
    '  float d = aPos.x + aPos.y + aPos.z;',
    '  gl_Position = vec4((sx - uCenter.x) / (uView.x * uView.y), (sy - uCenter.y) / uView.x, -d / 60.0, 1.0);',
    '  vN = aNrm; vUV = aUV; vHalf = aHalf; vInfo = aInfo;',
    '}'
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'uniform vec3 uT0; uniform vec3 uT1; uniform vec3 uT2; uniform vec3 uAcc; uniform vec3 uLine;',
    'uniform float uLW;',                     // line half-width in world units
    'varying vec3 vN; varying vec2 vUV; varying vec2 vHalf; varying vec2 vInfo;',
    'vec3 tone(float i){ i = mod(i, 3.0); return i < 0.5 ? uT0 : (i < 1.5 ? uT1 : uT2); }',
    'vec3 faceCol(float shift){',
    '  vec3 w = abs(normalize(vN)); w = w*w*w; w /= (w.x + w.y + w.z);',
    '  if (vInfo.y > 2.5) return uAcc * (w.y * 1.0 + w.x * 0.82 + w.z * 0.64);',
    '  return tone(shift) * w.y + tone(shift + 1.0) * w.x + tone(shift + 2.0) * w.z;',
    '}',
    'void main(){',
    '  vec2 a = abs(vUV);',
    '  float edge = min(vHalf.x - a.x, vHalf.y - a.y);',
    '  float shift = vInfo.y;',
    '  float lineD = edge;',
    '  float mn = min(vHalf.x, vHalf.y), mx = max(vHalf.x, vHalf.y);',
    '  if (vInfo.x > 0.5 && mn > 0.3 && mx < mn * 1.45) {',
    '    float r1 = 0.66, r2 = 0.40, r3 = 0.17;',
    '    float d1 = max(a.x - r1 * vHalf.x, a.y - r1 * vHalf.y);',
    '    float d2 = max(a.x - r2 * vHalf.x, a.y - r2 * vHalf.y);',
    '    float d3 = max(a.x - r3 * vHalf.x, a.y - r3 * vHalf.y);',
    '    if (d1 < 0.0) shift += 1.0;',
    '    if (d2 < 0.0) shift += 1.0;',
    '    lineD = min(lineD, min(abs(d1), abs(d2)));',
    '    if (vInfo.x > 1.5 && mn > 0.7) { if (d3 < 0.0) shift += 1.0; lineD = min(lineD, abs(d3)); }',
    '  }',
    '  vec3 col = faceCol(shift);',
    '  float l = 1.0 - smoothstep(uLW * 0.55, uLW * 1.25, lineD);',
    '  gl_FragColor = vec4(mix(col, uLine, l * 0.9), 1.0);',
    '}'
  ].join('\n');

  // corner signs for each of the 6 faces: [normal axis, sign]
  var FACES = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  var STRIDE = 12;

  // ---------- the engine the app uses: one per graphics context, a state per loop ----------
  function create(gl) {
    function sh(type, src) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Machinery shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Machinery program: ' + gl.getProgramInfoLog(prog));
    const U = {};
    for (const n of ['uView', 'uCenter', 'uT0', 'uT1', 'uT2', 'uAcc', 'uLine', 'uLW']) U[n] = gl.getUniformLocation(prog, n);
    const MAX_BOXES = 2600;                                   // 24 corners each must stay under 65536
    const vao = gl.createVertexArray(), vbuf = gl.createBuffer(), ibuf = gl.createBuffer();
    const vaoWas0 = gl.getParameter(gl.VERTEX_ARRAY_BINDING), abWas0 = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    const idx = new Uint16Array(MAX_BOXES * 36);
    for (let b = 0, o = 0; b < MAX_BOXES * 6; b++) { const v0 = b * 4; idx[o++] = v0; idx[o++] = v0 + 1; idx[o++] = v0 + 2; idx[o++] = v0; idx[o++] = v0 + 2; idx[o++] = v0 + 3; }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    [['aPos', 3, 0], ['aNrm', 3, 12], ['aUV', 2, 24], ['aHalf', 2, 32], ['aInfo', 2, 40]].forEach(([n, size, off]) => {
      const L = gl.getAttribLocation(prog, n);
      if (L >= 0) { gl.enableVertexAttribArray(L); gl.vertexAttribPointer(L, size, gl.FLOAT, false, STRIDE * 4, off); }
    });
    gl.bindVertexArray(vaoWas0); gl.bindBuffer(gl.ARRAY_BUFFER, abWas0);
    const SAMPLES = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);

    // Where it's drawn: a picture the loop reads, and (where it works) a smoothed picture with depth that is copied into it
    function target(w, h) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      const T = { t, f, w, h, ms: null, rbs: [] };
      const rb = (attach, fmt, samples) => {
        const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r);
        if (samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h); else gl.renderbufferStorage(gl.RENDERBUFFER, fmt, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attach, gl.RENDERBUFFER, r);
        T.rbs.push(r);
      };
      if (SAMPLES > 1) {
        const m = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, m);
        rb(gl.COLOR_ATTACHMENT0, gl.RGBA8, SAMPLES); rb(gl.DEPTH_ATTACHMENT, gl.DEPTH_COMPONENT16, SAMPLES);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) T.ms = m;
        else { gl.deleteFramebuffer(m); T.rbs.forEach((r) => gl.deleteRenderbuffer(r)); T.rbs = []; }
      }
      if (!T.ms) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); rb(gl.DEPTH_ATTACHMENT, gl.DEPTH_COMPONENT16, 0); }
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      return T;
    }
    function state() { return { sim: null, seed: null, out: null, verts: null, view: 12, cx: 0, cy: 0, framed: false }; }
    function release(st) {
      if (!st) return;
      if (st.out) { gl.deleteTexture(st.out.t); gl.deleteFramebuffer(st.out.f); if (st.out.ms) gl.deleteFramebuffer(st.out.ms); st.out.rbs.forEach((r) => gl.deleteRenderbuffer(r)); st.out = null; }
      st.sim = null; st.seed = null; st.verts = null;
    }

    const RA = new Float32Array(9), RP = new Float32Array(9), M = new Float32Array(9), RQ = new Float32Array(9);
    const c = [0, 0, 0], h = [0, 0, 0], T = [0, 0, 0], lp = [0, 0, 0];
    const HALF_PI = Math.PI / 2;
    function modulePose(A, t, Tout, Rout) {
      const m = A.mv;
      if (m.on) { const e = ease((t - m.t0) / m.dur); for (let i = 0; i < 3; i++) Tout[i] = m.from[i] + (m.to[i] - m.from[i]) * e; }
      else { Tout[0] = A.T[0]; Tout[1] = A.T[1]; Tout[2] = A.T[2]; }
      if (Rout) {
        const ra = A.rot;
        if (ra.on) { rot3(ra.axis, ra.sign * HALF_PI * ease((t - ra.t0) / ra.dur), RQ); mul3(RQ, ra.Rfrom, Rout); }
        else for (let i = 0; i < 9; i++) Rout[i] = A.R[i];
      }
    }
    // smooth framing: follow the middle of the machine and how spread out it is
    function frame(st, t, dt) {
      const ms = st.sim.modules, n = ms.length, px = [], py = [];
      let mx = 0, my = 0, v = 0;
      for (let i = 0; i < n; i++) {
        modulePose(ms[i], t, T, null);
        const sx = (T[0] - T[2]) * 0.8660254, sy = T[1] - (T[0] + T[2]) * 0.5;
        px.push(sx); py.push(sy); mx += sx; my += sy;
      }
      mx /= n; my /= n;
      for (let i = 0; i < n; i++) v += Math.max((px[i] - mx) * (px[i] - mx), (py[i] - my) * (py[i] - my));
      const want = 7.4 + 1.45 * Math.sqrt(v / n);
      const k = st.framed ? 1 - Math.exp(-dt * 0.9) : 1;
      st.cx += (mx - st.cx) * k; st.cy += (my - st.cy) * k; st.view += (want - st.view) * k; st.framed = true;
    }
    function fill(st, t) {
      const sim = st.sim, ms = sim.modules, verts = st.verts;
      let o = 0;
      for (let ai = 0; ai < ms.length; ai++) {
        const A = ms[ai];
        modulePose(A, t, T, RA);
        for (let pi = 0; pi < A.parts.length; pi++) {
          const p = A.parts[pi];
          sim.localBox(p, true, t, c, h, p.h);
          const hide = p.kind === 'rod' && h[p.axis] < 0.01;
          if (p.kind === 'spin') { rot3(p.axis, sim.vis(p.drv, t) * HALF_PI, RP); mul3(RA, RP, M); }
          else for (let z = 0; z < 9; z++) M[z] = RA[z];
          const wx = T[0] + RA[0] * c[0] + RA[1] * c[1] + RA[2] * c[2];
          const wy = T[1] + RA[3] * c[0] + RA[4] * c[1] + RA[5] * c[2];
          const wz = T[2] + RA[6] * c[0] + RA[7] * c[1] + RA[8] * c[2];
          for (let f = 0; f < 6; f++) {
            const na = FACES[f][0], ns = FACES[f][1];
            const ua = (na + 1) % 3, va = (na + 2) % 3;
            const nx = M[na] * ns, ny = M[3 + na] * ns, nz = M[6 + na] * ns;
            for (let q = 0; q < 4; q++) {
              const su = (q === 0 || q === 3) ? -1 : 1, sv = q < 2 ? -1 : 1;
              if (hide) { lp[0] = lp[1] = lp[2] = 0; }
              else { lp[na] = ns * h[na]; lp[ua] = su * h[ua]; lp[va] = sv * h[va]; }
              verts[o++] = wx + M[0] * lp[0] + M[1] * lp[1] + M[2] * lp[2];
              verts[o++] = wy + M[3] * lp[0] + M[4] * lp[1] + M[5] * lp[2];
              verts[o++] = wz + M[6] * lp[0] + M[7] * lp[1] + M[8] * lp[2];
              verts[o++] = nx; verts[o++] = ny; verts[o++] = nz;
              verts[o++] = su * h[ua]; verts[o++] = sv * h[va];
              verts[o++] = h[ua]; verts[o++] = h[va];
              verts[o++] = p.pat; verts[o++] = p.tone;
            }
          }
        }
      }
      return o;
    }

    // One frame at outW x outH with settings s (see DEFAULTS). opt: { music: { on, bass } }. Returns the picture.
    function run(st, outW, outH, s, dt, opt = {}) {
      const seed = Math.round(num(s.machSeed, DEFAULTS.machSeed, 1, 99999));
      if (!st.sim || st.seed !== seed) {
        st.sim = new Sim(seed); st.seed = seed; st.framed = false;
        const n = Math.min(MAX_BOXES, st.sim.parts.length - 1);
        st.verts = new Float32Array(n * 24 * STRIDE);
      }
      if (!st.out || st.out.w !== outW || st.out.h !== outH) {
        const sim = st.sim, sd = st.seed, vs = st.verts;
        release(st); st.sim = sim; st.seed = sd; st.verts = vs;
        st.out = target(outW, outH);
      }
      dt = Math.min(0.25, Math.max(0, dt || 1 / 60));
      const mus = opt.music && opt.music.on ? opt.music : null;
      let left = Math.min(0.75, dt * speedOf(num(s.machSpeed, DEFAULTS.machSpeed, 0, 100)) * (mus ? 1 + 1.2 * Math.min(1, mus.bass || 0) : 1));
      const moved = left;
      // advance in small steps so nothing is skipped on a slow frame
      while (left > 1e-6) { const d = Math.min(left, 1 / 30); st.sim.step(d); left -= d; }
      const t = st.sim.time();
      frame(st, t, moved);

      const vaoWas = gl.getParameter(gl.VERTEX_ARRAY_BINDING), abWas = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      const blendWas = gl.isEnabled(gl.BLEND), depthWas = gl.isEnabled(gl.DEPTH_TEST), cullWas = gl.isEnabled(gl.CULL_FACE), scWas = gl.isEnabled(gl.SCISSOR_TEST);
      const O = st.out;
      gl.bindFramebuffer(gl.FRAMEBUFFER, O.ms || O.f);
      gl.viewport(0, 0, outW, outH);
      gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.clearColor(0, 0, 0, 1); gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      const used = fill(st, t);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
      gl.bufferData(gl.ARRAY_BUFFER, st.verts, gl.DYNAMIC_DRAW);
      const P = (PALETTES[s.machColor | 0] || PALETTES[0]).c;
      const aspect = outW / outH, view = aspect >= 1 ? st.view : st.view / aspect;
      gl.uniform2f(U.uView, view, aspect);
      gl.uniform2f(U.uCenter, st.cx, st.cy);
      gl.uniform3fv(U.uT0, hex(P[0])); gl.uniform3fv(U.uT1, hex(P[1])); gl.uniform3fv(U.uT2, hex(P[2]));
      gl.uniform3fv(U.uAcc, hex(P[3])); gl.uniform3fv(U.uLine, hex(P[4]));
      gl.uniform1f(U.uLW, ((2 * view) / outH) * Math.max(0.75, outH / 900));
      gl.drawElements(gl.TRIANGLES, (used / (STRIDE * 4)) * 6, gl.UNSIGNED_SHORT, 0);
      if (O.ms) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, O.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, O.f);
        gl.blitFramebuffer(0, 0, outW, outH, 0, 0, outW, outH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindVertexArray(vaoWas); gl.bindBuffer(gl.ARRAY_BUFFER, abWas);
      if (!depthWas) gl.disable(gl.DEPTH_TEST);
      if (blendWas) gl.enable(gl.BLEND);
      if (cullWas) gl.enable(gl.CULL_FACE);
      if (scWas) gl.enable(gl.SCISSOR_TEST);
      return O.t;
    }
    return { state, run, release, smooth: SAMPLES > 1 };
  }

return { DEFAULTS, COLORS, PALETTES, preview, clean, look, create, Sim, speedOf };
})();
