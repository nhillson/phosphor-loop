import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const sandbox = {window:{}};
vm.runInNewContext(await readFile(new URL('../js/audio/beat-clock.js', import.meta.url),'utf8'), sandbox);
vm.runInNewContext(await readFile(new URL('../js/audio/rhythm.js', import.meta.url),'utf8'), sandbox);
const Clock = sandbox.window.PhosphorBeatClock;

test('beat clock keeps tempo and phase across slow and fast render frames', () => {
  for (const fps of [15, 30, 60, 144]) {
    const clock = new Clock(); clock.setTempo(120, 0, 0);
    let crossings = 0, last = 0;
    for (let i = 1; i <= fps * 10; i++) {
      const sample = clock.read(i / fps);
      crossings += sample.gridBeat - last; last = sample.gridBeat;
    }
    assert.ok(Math.abs(crossings - 20) <= 1);
    assert.equal(clock.read(10.5).pulse, 1);
    assert.ok(clock.read(10.75).pulse < 0.11);
  }
});
test('tempo corrections preserve a forward-moving phase and converge', () => {
  const clock = new Clock(); clock.setTempo(120,0,0); clock.read(3);
  const before = clock.position; clock.setTempo(128,2.8,3);
  assert.equal(clock.position,before);
  let previous = before;
  for (let i = 1; i <= 1200; i++) {
    clock.read(3 + i / 60);
    assert.ok(clock.position >= previous); previous = clock.position;
  }
  assert.ok(Math.abs(clock.bpm - 128) < 0.1);
});
test('stale analysis, silence, suspended audio and expired tempo suppress grid pulses', () => {
  const ctx = {currentTime:1, state:'running'};
  const rhythm = new sandbox.window.PhosphorRhythm(ctx,{});
  rhythm.clock.setTempo(120,0,1);
  rhythm.features = {time:1,lastKick:1}; rhythm.lastAudioTime = 1;
  rhythm.tempo = {end:1};
  assert.equal(rhythm.read().bpmBeat,1);
  ctx.currentTime = 1.5; assert.equal(rhythm.read(),null);
  rhythm.features.time = 2; ctx.currentTime = 2;
  assert.equal(rhythm.read().bpmBeat,0); assert.equal(rhythm.read().gridBeat,null);
  ctx.state = 'suspended'; assert.equal(rhythm.read(),null);
  ctx.state = 'running'; ctx.currentTime = 18; rhythm.features.time = 18; rhythm.lastAudioTime = 18;
  assert.equal(rhythm.read().bpm,0); assert.equal(rhythm.read().gridBeat,null);
});
