// Song timelines: four tracks (loops A to D) of blocks placed by time in seconds. Each block carries one loop's look,
// fades in and out, and can change sliders over its length. Blocks that overlap on a track crossfade for the overlap.
(() => {
  const TRACKS = 4, MIN_LEN = 0.5, MAX_BLOCKS = 400, MAX_MARKERS = 200, MAX_VERSIONS = 40;
  const END = ['hold', 'loop', 'auto'];
  const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r2 = (v) => Math.round(v * 100) / 100;
  const id = () => Math.random().toString(36).slice(2, 10);

  const newRecord = () => ({ v: 2, blocks: [], markers: [], end: 'hold', versions: [] });

  function cleanPts(pts) {
    const out = (Array.isArray(pts) ? pts : []).filter((p) => Array.isArray(p) && p.length >= 2)
      .map(([u, v]) => [clamp(num(u), 0, 1), clamp(num(v), 0, 1)]).sort((p, q) => p[0] - q[0]).slice(0, 64);
    if (out.length < 2) return [[0, 0.5], [1, 0.5]];
    out[0][0] = 0; out[out.length - 1][0] = 1;
    return out;
  }
  function cleanBlock(b) {
    if (!b || typeof b !== 'object' || !b.look || typeof b.look !== 'object') return null;
    const a = Math.max(0, num(b.a)), end = Math.max(a + MIN_LEN, num(b.b, a + 16));
    const len = end - a, fin = clamp(num(b.fin, 1), 0, len), fout = clamp(num(b.fout, 1), 0, len - fin);
    const autos = (Array.isArray(b.autos) ? b.autos : []).filter((x) => x && typeof x.key === 'string')
      .slice(0, 32).map((x) => ({ key: x.key.slice(0, 40), pts: cleanPts(x.pts) }));
    return { id: typeof b.id === 'string' ? b.id.slice(0, 24) : id(), track: clamp(Math.round(num(b.track)), 0, TRACKS - 1),
      a: r2(a), b: r2(end), label: typeof b.label === 'string' ? b.label.slice(0, 80) : '', look: b.look, fin: r2(fin), fout: r2(fout), autos };
  }
  function cleanData(d) {
    return {
      blocks: (Array.isArray(d?.blocks) ? d.blocks : []).map(cleanBlock).filter(Boolean).slice(0, MAX_BLOCKS),
      markers: (Array.isArray(d?.markers) ? d.markers : []).filter((m) => m && Number.isFinite(+m.t)).slice(0, MAX_MARKERS)
        .map((m) => ({ id: typeof m.id === 'string' ? m.id.slice(0, 24) : id(), t: r2(Math.max(0, +m.t)), name: String(m.name || 'Marker').slice(0, 40) })),
    };
  }
  function normalize(rec) {
    const out = { v: 2, ...cleanData(rec), end: END.includes(rec?.end) ? rec.end : 'hold', versions: [] };
    if (Array.isArray(rec?.versions)) out.versions = rec.versions.filter((x) => x && typeof x.name === 'string')
      .slice(0, MAX_VERSIONS).map((x) => ({ name: x.name.slice(0, 60), saved: num(x.saved), ...cleanData(x) }));
    return out;
  }
  // An old beat-counted step list becomes blocks on track 1, placed by the song's BPM and start offset
  function fromSteps(old) {
    const rec = newRecord(), bpm = clamp(num(old?.bpm, 120), 30, 300);
    let t = Math.max(0, num(old?.offset));
    rec.end = END.includes(old?.end) ? old.end : 'hold';
    for (const s of Array.isArray(old?.steps) ? old.steps : []) {
      const len = clamp(Math.round(num(s?.beats, 8)), 1, 1024) * 60 / bpm;
      if (s?.kind === 'look' && s.data?.A) rec.blocks.push(cleanBlock({ track: 0, a: t, b: t + len, label: s.name, look: s.data.A, fin: 0.5, fout: 0.5 }));
      t += len;
    }
    rec.blocks = rec.blocks.filter(Boolean);
    return rec;
  }
  const lastEnd = (rec) => rec.blocks.reduce((m, b) => Math.max(m, b.b), 0);

  // How much a block shows at time t from its own fades (1 in the middle); either edge can be skipped
  function fadeOf(b, t, skipIn, skipOut) {
    let f = 1;
    if (!skipIn && b.fin > 0) f = Math.min(f, (t - b.a) / b.fin);
    if (!skipOut && b.fout > 0) f = Math.min(f, (b.b - t) / b.fout);
    return clamp(f, 0, 1);
  }
  // A change line's value (0 to 1) at u, part way through its block
  function autoValue(pts, u) {
    if (u <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [u1, v1] = pts[i];
      if (u <= u1) { const [u0, v0] = pts[i - 1]; return u1 - u0 < 1e-6 ? v1 : v0 + (v1 - v0) * (u - u0) / (u1 - u0); }
    }
    return pts[pts.length - 1][1];
  }

  // What each track shows at song time t. A track with nothing on it is blank.
  // Each track: null, or { main, other, w, show, u } where other (if any) is crossfading out while main comes in
  // over the overlap, w goes 0 to 1 across it, and u is how far through main the time is (0 to 1).
  function resolve(rec, t) {
    const seqEnd = lastEnd(rec);
    let at = t, ended = false;
    if (seqEnd > 0 && t >= seqEnd) {
      ended = true;
      if (rec.end === 'loop') at = t % seqEnd;
      else if (rec.end === 'auto') return { ended, autopilot: true, tracks: Array(TRACKS).fill(null) };
      else at = seqEnd - 1e-3;
    }
    const tracks = [];
    for (let k = 0; k < TRACKS; k++) {
      const on = rec.blocks.filter((b) => b.track === k && b.a <= at && at < b.b).sort((p, q) => p.a - q.a || p.b - q.b);
      if (!on.length) { tracks.push(null); continue; }
      const main = on[on.length - 1], uOf = (b) => clamp((at - b.a) / (b.b - b.a), 0, 1);
      if (on.length === 1) { tracks.push({ main, other: null, w: 1, show: fadeOf(main, at), u: uOf(main) }); continue; }
      const other = on[on.length - 2], x1 = Math.min(other.b, main.b);
      const w = clamp((at - main.a) / Math.max(1e-3, x1 - main.a), 0, 1);
      const show = (1 - w) * fadeOf(other, at, false, true) + w * fadeOf(main, at, true, false);
      tracks.push({ main, other, w, show, u: uOf(main), uOther: uOf(other) });
    }
    return { ended, autopilot: false, tracks, at };
  }

  // Loading a sequence onto a song of a different length: blocks past the end are cut off
  function cutToLength(data, dur) {
    let cut = 0;
    const blocks = [];
    for (const b of data.blocks) {
      if (b.a >= dur - MIN_LEN) { cut++; continue; }
      const nb = { ...b, autos: b.autos.map((x) => ({ ...x, pts: x.pts.map((p) => [...p]) })) };
      if (nb.b > dur) {
        cut++;
        // Its change lines keep their shape up to the new end
        const keep = (dur - nb.a) / (nb.b - nb.a);
        nb.autos = nb.autos.map((x) => ({ ...x, pts: cleanPts([...x.pts.filter((p) => p[0] < keep).map(([u, v]) => [u / keep, v]), [1, autoValue(x.pts, keep)]]) }));
        nb.b = r2(dur); nb.fin = Math.min(nb.fin, nb.b - nb.a); nb.fout = Math.min(nb.fout, nb.b - nb.a - nb.fin);
      }
      blocks.push(nb);
    }
    return { blocks, markers: data.markers.filter((m) => m.t <= dur), cut };
  }

  globalThis.PhosphorTimeline = { TRACKS, MIN_LEN, MAX_VERSIONS, newRecord, normalize, cleanBlock, cleanPts, fromSteps, lastEnd, fadeOf, autoValue, resolve, cutToLength, id };
})();
