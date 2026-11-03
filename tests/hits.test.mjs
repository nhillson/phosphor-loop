// The beat straight from the sound (js/audio/hits.js), on made-up music with known kicks (tests/hits_music.py):
// every kick found as a full beat within 60 ms, after a tempo change, off the grid and quiet; nothing in silence
// or on a held chord.   python3 tests/hits_music.py 60 && python3 tests/hits_music.py 30 && node --test tests/hits.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../js/audio/hits.js';
for (const fps of [60, 30]) test(`hits at ${fps} frames a second`, () => {
  const T = JSON.parse(fs.readFileSync(`/tmp/phosphor-hits/truth${fps}.json`)), raw = fs.readFileSync(`/tmp/phosphor-hits/frames${fps}.bin`), nb = T.bins;
  const band = (b, lo, hi) => { const a = Math.max(1, Math.floor(lo / T.hz)), z = Math.min(nb - 1, Math.ceil(hi / T.hz)); let s = 0; for (let i = a; i <= z; i++) { const v = b[i] / 255; s += v * v; } return s / (z - a + 1); };
  const f = new globalThis.PhosphorHits(), hits = [], strong = [];
  for (let k = 0; k * nb < raw.length; k++) {
    const b = raw.subarray(k * nb, (k + 1) * nb), t = (k + 1) / fps;
    if (f.step(b, T.hz, 1 / fps, t, band(b, 35, 150) + band(b, 250, 2000) + band(b, 3000, 12000)) > 0) { hits.push(t); if (f.strong) strong.push(t); }
  }
  const found = (a, b) => { const ks = T.kicks.filter((x) => x >= a && x < b); return [ks.filter((x) => strong.some((h) => h >= x - 0.01 && h <= x + 0.06)).length, ks.length]; };
  for (const [a, b, need] of [[0.5, 10, 1], [10, 18, 1], [18, 26, 0.75], [26, 31, 0.8]]) {
    const [n, of] = found(a, b);
    assert.ok(n >= need * of, `${n} of ${of} kicks found as beats between ${a} and ${b} s`);
  }
  assert.equal(hits.filter((x) => x >= 31.2 && x < 33).length, 0, 'no hits in silence');
  assert.equal(hits.filter((x) => x >= 33.3 && x < 36).length, 0, 'no hits on a held chord');
});
