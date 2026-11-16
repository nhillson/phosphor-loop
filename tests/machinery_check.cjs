// Machinery (js/machinery.js): runs machines with no picture, by frames, and fails if any two parts overlap.
// node tests/machinery_check.cjs [seeds, comma separated] [frames]   e.g.  node tests/machinery_check.cjs 3,5,8 12000
require('../js/machinery.js');
var PhosphorMachinery = globalThis.PhosphorMachinery;
var Sim = PhosphorMachinery.Sim;
var seeds = (process.argv[2] || '3').split(',').map(Number), FRAMES = +(process.argv[3] || 7200);
seeds.forEach(function (seed) {
  var t0 = Date.now(), sim = new Sim(seed), ms = sim.modules, c = [0,0,0], h = [0,0,0];
  var worst = 0, bad = 0, checks = 0, example = null;
  var np = sim.parts.length - 1;
  function ease(x){x=x<0?0:x>1?1:x;return x*x*x*(x*(x*6-15)+10);}
  for (var f = 0; f < FRAMES; f++) {
    sim.step(1 / 60);
    if (f % 5) continue;
    var t = sim.time(), boxes = [];
    ms.forEach(function (A) {
      if (A.rot.on) return;                       // rolling modules checked by their booked disc
      var T = A.T.slice();
      if (A.mv.on) { var e = ease((t - A.mv.t0) / A.mv.dur); for (var i=0;i<3;i++) T[i] = A.mv.from[i] + (A.mv.to[i]-A.mv.from[i])*e; }
      A.parts.forEach(function (p) {
        sim.localBox(p, true, t, c, h, p.keep || p.h);
        if (p.kind === 'rod' && h[p.axis] < 0.01) return;
        var lo = [], hi = [];
        for (var i = 0; i < 3; i++) {
          var cw = T[i] + A.R[i*3]*c[0] + A.R[i*3+1]*c[1] + A.R[i*3+2]*c[2];
          var hw = Math.abs(A.R[i*3])*h[0] + Math.abs(A.R[i*3+1])*h[1] + Math.abs(A.R[i*3+2])*h[2];
          lo.push(cw - hw); hi.push(cw + hw);
        }
        boxes.push({ p: p, lo: lo, hi: hi });
      });
    });
    function inside(lo, hi, b) { return b && lo[0] >= b.lo[0]-0.03 && lo[1] >= b.lo[1]-0.03 && lo[2] >= b.lo[2]-0.03 && hi[0] <= b.hi[0]+0.03 && hi[1] <= b.hi[1]+0.03 && hi[2] <= b.hi[2]+0.03; }
    var byId = {}; boxes.forEach(function (b) { byId[b.p.id] = b; });
    for (var i = 0; i < boxes.length; i++) for (var j = i + 1; j < boxes.length; j++) {
      var a = boxes[i], b = boxes[j];
      if (a.p.gid === b.p.gid || a.p.pass === b.p.id || b.p.pass === a.p.id) continue;
      var lo = [], hi = [], pen = 1e9;
      for (var k = 0; k < 3; k++) { lo[k] = Math.max(a.lo[k], b.lo[k]); hi[k] = Math.min(a.hi[k], b.hi[k]); pen = Math.min(pen, hi[k] - lo[k]); }
      if (pen <= 0.03) continue;
      // overlap hidden inside the block both are mounted in doesn't show
      if (inside(lo, hi, byId[a.p.pass]) || inside(lo, hi, byId[b.p.pass])) continue;
      bad++; if (pen > worst) { worst = pen; example = [a.p.kind, b.p.kind, a.p.A === b.p.A, f]; }
    }
    checks++;
  }
  if (bad) process.exitCode = 1;
  console.log(bad ? 'FAIL' : 'ok', 'seed', seed, 'modules', ms.length, 'parts', np, 'frames', FRAMES, 'overlaps', bad, 'worst', worst.toFixed(3), example, JSON.stringify(sim.stats), (Date.now()-t0)+'ms');
});
