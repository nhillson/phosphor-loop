'use strict';
// Tests snips from Phosphor Loop with plain Node: the real sharing server and library, a snip of a library clip
// (by its id), a snip of a video sent in the request, the marks kept, the credit carried over, and that only Nick's
// own site (and pages on this computer) may send snips. Run: node test/snip-test.js (needs ffmpeg and ffprobe).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const E = require('../src/engine.js');
const { Library } = require('../src/library.js');
const { startServer } = require('../src/server.js');
const Snip = require('../src/snip.js');

const tools = E.findTools([process.env.CLIPS_BIN || path.join(__dirname, '..', 'vendor')]);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-snip-'));
let failed = 0;
async function test(name, fn) {
  try { const note = await fn(); console.log(`ok    ${name}${note ? '  (' + note + ')' : ''}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${e.message}`); }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);
const make = (file, secs, extra = []) => {
  const r = spawnSync(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=640x360:r=30:d=${secs}`,
    ...extra, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
  if (r.status !== 0) throw new Error(String(r.stderr));
  return file;
};

(async () => {
  const dir = path.join(work, 'library');
  const lib = new Library(dir, { probe: (f) => E.probe(tools, f), thumb: (v, out, t) => E.frameAt(tools, v, t, out, { width: 320 }) });
  await lib.open();
  const orig = await lib.addClip(make(path.join(work, 'orig.mp4'), 10), { n: 'Long one', c: 'abstract', d: 10, w: 640, h: 360,
    src: 'https://example.com/v', by: 'Someone', lic: 'CC BY', part: [20, 30] });
  const sh = await startServer({
    getLibrary: () => lib, version: 'test', ports: [47911],
    onSnip: (req, params) => Snip.makeSnip({ tools, library: lib, work, req, ask: Snip.readAsk(params), settings: { maxHeight: 720 } }),
  });
  const base = `http://127.0.0.1:${sh.port}`;
  const post = (q, body, origin = 'https://nhillson.github.io') => fetch(`${base}/snip?${new URLSearchParams(q)}`, {
    method: 'POST', body, headers: { Origin: origin, ...(body ? { 'Content-Type': 'video/mp4' } : {}) } });

  await test('a snip of a library clip, by its id', async () => {
    const r = await post({ from: orig.id, start: 2, end: 5.5, name: 'Middle bit', cat: 'water' });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.ok, true);
    assert.equal(j.clip.n, 'Middle bit');
    assert.equal(j.clip.c, 'water');
    near(j.clip.d, 3.5, 0.15, 'length');
    const c = lib.data.clips.find((x) => x.id === j.clip.id);
    assert.deepEqual(c.part, [22, 25.5], 'which part of the original it is');
    assert.equal(c.by, 'Someone'); assert.equal(c.lic, 'CC BY'); assert.equal(c.src, 'https://example.com/v');
    assert.ok(fs.existsSync(lib.abs(c)), 'its file is in the library');
    assert.ok(c.t && fs.existsSync(path.join(dir, c.t)), 'it has a thumbnail');
    assert.ok(lib.abs(c).includes(path.sep + 'Water' + path.sep) || /water/i.test(c.f), 'filed under Water: ' + c.f);
    const lj = await (await fetch(base + '/library.json')).json();
    assert.ok(lj.clips.some((x) => x.id === j.clip.id), 'Phosphor Loop sees it in the library');
    return c.f;
  });

  await test('a snip of a video sent in the request', async () => {
    const own = make(path.join(work, 'own.mp4'), 8, ['-f', 'lavfi', '-i', 'sine=f=440:d=8', '-c:a', 'aac', '-shortest']);
    const r = await post({ start: 1, end: 4, name: '', cat: 'abstract', sound: '1', src: 'My holiday.mp4' }, fs.readFileSync(own));
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.clip.n, 'My holiday (snip)', 'named after the file when no name is given');
    assert.equal(j.clip.sound, true, 'sound kept when asked');
    near(j.clip.d, 3, 0.15, 'length');
    assert.ok(j.clip.h <= 720, 'sized as set in Phosphor Clips');
    const left = fs.readdirSync(work).filter((f) => f.startsWith('snip-'));
    assert.equal(left.length, 0, 'the sent video isn’t kept: ' + left.join(', '));
  });

  await test('no end mark: to the end of the video', async () => {
    const r = await post({ from: orig.id, start: 7, cat: 'abstract' });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    near(j.clip.d, 3, 0.15, 'length');
    assert.equal(j.clip.n, 'Long one (snip)');
  });

  await test('bad marks get a plain answer', async () => {
    let j = await (await post({ from: orig.id, start: 9.95, cat: 'abstract' })).json();
    assert.equal(j.ok, false); assert.match(j.message, /too short/);
    j = await (await post({ from: orig.id, start: 4, end: 3, cat: 'abstract' })).json();
    assert.equal(j.ok, false); assert.match(j.message, /after the start/);
    const r = await post({ from: 'nothere', start: 1, cat: 'abstract' });
    assert.equal(r.status, 404);
  });

  await test('only Nick’s own site and this computer may send snips', async () => {
    const n = lib.data.clips.length;
    for (const o of ['https://someone.github.io', 'https://evil.example.com']) {
      const r = await post({ from: orig.id, start: 1, end: 2, cat: 'abstract' }, null, o);
      assert.equal(r.status, 403, o);
    }
    const pre = await fetch(`${base}/snip`, { method: 'OPTIONS', headers: { Origin: 'https://nhillson.github.io', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-methods') || '', /POST/);
    assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
    for (const o of ['http://127.0.0.1:8000', 'null']) {
      const r = await post({ from: orig.id, start: 1, end: 2, cat: 'abstract', name: 'From ' + o }, null, o);
      assert.equal(r.status, 200, o);
    }
    assert.equal(lib.data.clips.length, n + 2);
    // Reading the library is still open to other github.io pages, as before
    assert.equal((await fetch(base + '/library.json', { headers: { Origin: 'https://someone.github.io' } })).status, 200);
  });

  sh.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + e.stack); process.exit(1); });
