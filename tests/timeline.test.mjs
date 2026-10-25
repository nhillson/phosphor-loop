import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../js/timeline.js';
const TL = globalThis.PhosphorTimeline;
const look = (in1, zoom = 0) => ({ in1, zoom });
const rec = (blocks, end = 'hold') => TL.normalize({ blocks, markers: [], end });

test('an empty track is blank; a block shows with its fades', () => {
  const r = rec([{ id: 'a', track: 1, a: 10, b: 20, look: look('wave'), fin: 2, fout: 4 }]);
  assert.equal(TL.resolve(r, 5).tracks[1], null);
  assert.equal(TL.resolve(r, 15).tracks[0], null);
  assert.equal(TL.resolve(r, 11).tracks[1].show, 0.5);
  assert.equal(TL.resolve(r, 15).tracks[1].show, 1);
  assert.equal(TL.resolve(r, 18).tracks[1].show, 0.5);
  assert.equal(TL.resolve(r, 15).tracks[1].u, 0.5);
});

test('overlapping blocks on a track crossfade over the overlap only', () => {
  const r = rec([
    { id: 'a', track: 0, a: 0, b: 20, look: look('wave'), fin: 0, fout: 5 },
    { id: 'b', track: 0, a: 16, b: 40, look: look('shape'), fin: 5, fout: 0 },
  ]);
  const before = TL.resolve(r, 10).tracks[0];
  assert.equal(before.main.id, 'a'); assert.equal(before.other, null);
  const mid = TL.resolve(r, 18).tracks[0];
  assert.equal(mid.main.id, 'b'); assert.equal(mid.other.id, 'a'); assert.equal(mid.w, 0.5);
  // the crossfade replaces each block's own fade at that edge, so the loop stays fully on
  assert.equal(mid.show, 1);
  const after = TL.resolve(r, 25).tracks[0];
  assert.equal(after.main.id, 'b'); assert.equal(after.other, null);
});

test('at end: hold, loop or Autopilot', () => {
  const blocks = [{ id: 'a', track: 0, a: 0, b: 10, look: look('wave'), fin: 0, fout: 0 }, { id: 'b', track: 1, a: 2, b: 5, look: look('bars'), fin: 0, fout: 0 }];
  assert.equal(TL.resolve(rec(blocks, 'hold'), 30).tracks[0].main.id, 'a');
  assert.equal(TL.resolve(rec(blocks, 'hold'), 30).tracks[1], null);
  assert.equal(TL.resolve(rec(blocks, 'loop'), 23).tracks[1].main.id, 'b');
  assert.equal(TL.resolve(rec(blocks, 'auto'), 30).autopilot, true);
  assert.equal(TL.resolve(rec(blocks, 'auto'), 9).autopilot, false);
});

test('change lines interpolate smoothly between points', () => {
  const pts = TL.cleanPts([[0, 0], [0.5, 1], [1, 0]]);
  assert.equal(TL.autoValue(pts, 0.25), 0.5);
  assert.equal(TL.autoValue(pts, 0.5), 1);
  assert.equal(TL.autoValue(pts, 0.75), 0.5);
  assert.deepEqual(TL.cleanPts([[0.3, 2]]), [[0, 0.5], [1, 0.5]]);
});

test('loading onto a shorter song cuts blocks off at its end', () => {
  const r = rec([
    { id: 'a', track: 0, a: 0, b: 100, look: look('wave'), fin: 0, fout: 10, autos: [{ key: 'zoom', pts: [[0, 0], [1, 1]] }] },
    { id: 'b', track: 1, a: 150, b: 200, look: look('bars') },
  ]);
  const out = TL.cutToLength(r, 80);
  assert.equal(out.cut, 2);
  assert.equal(out.blocks.length, 1);
  assert.equal(out.blocks[0].b, 80);
  // the change line keeps its shape up to the new end
  assert.ok(Math.abs(TL.autoValue(out.blocks[0].autos[0].pts, 1) - 0.8) < 1e-9);
});

test('old beat-counted steps come across as blocks on track 1', () => {
  const r = TL.fromSteps({ bpm: 120, offset: 4, end: 'loop', steps: [
    { kind: 'look', name: 'Intro', beats: 8, data: { A: look('wave') } },
    { kind: 'file', name: 'clip.mp4', beats: 4 },
    { kind: 'look', name: 'Drop', beats: 16, data: { A: look('shape') } },
  ] });
  assert.equal(r.end, 'loop');
  assert.deepEqual(r.blocks.map((b) => [b.label, b.a, b.b, b.track]), [['Intro', 4, 8, 0], ['Drop', 10, 18, 0]]);
});

test('broken saved data is made safe', () => {
  const r = TL.normalize({ blocks: [null, { look: null }, { track: 9, a: -5, b: -10, look: {}, fin: 99, fout: 99 }], markers: [{ t: 'x' }, { t: 3, name: 7 }], end: 'nope', versions: [{ name: 'v', blocks: [] }, 5] });
  assert.equal(r.end, 'hold');
  assert.equal(r.blocks.length, 1);
  const b = r.blocks[0];
  assert.equal(b.track, 3); assert.equal(b.a, 0); assert.equal(b.b, TL.MIN_LEN);
  assert.ok(b.fin + b.fout <= b.b - b.a);
  assert.deepEqual(r.markers.map((m) => [m.t, m.name]), [[3, '7']]);
  assert.equal(r.versions.length, 1);
});
