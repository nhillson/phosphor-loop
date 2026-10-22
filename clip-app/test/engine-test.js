'use strict';
// Tests the engine and library with plain Node: grabbing from pages and links on a local test server (yt-dlp's
// own page reader, a marked part of a long video, a GIF, a page with no video), cutting clips, and the library
// folders. With NET=1 it also grabs a few real videos from the internet (GitHub's Windows runner).
// Run: node test/engine-test.js     (needs ffmpeg, ffprobe and yt-dlp on the PATH or in CLIPS_* settings)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const { Library } = require('../src/library.js');
const { DEFAULT_CATEGORIES } = require('../src/categories.js');
const { guessFromText } = require('../src/keywords.js');
const { combine } = require('../src/vision.js');
const { makeMedia, serve } = require('./fixtures.js');

const tools = E.findTools([process.env.CLIPS_BIN || path.join(__dirname, '..', 'vendor')]);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-test-'));
const results = [];
const log = process.env.VERBOSE ? (s) => console.log('   ' + s) : () => {};
let failed = 0;

async function test(name, fn, { optional = false } = {}) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, note });
    console.log(`ok    ${name}${note ? '  (' + note + ')' : ''}`);
  } catch (e) {
    results.push({ name, ok: false, optional, ms: Date.now() - t0, error: String(e.message || e), detail: e.detail || '' });
    console.log(`${optional ? 'skip ' : 'FAIL '} ${name}: ${e.message}${e.detail ? '\n      ' + String(e.detail).slice(0, 400) : ''}`);
    if (!optional) failed++;
  }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);
let n = 0;
const job = () => { const d = path.join(work, 'job' + ++n); fs.mkdirSync(d, { recursive: true }); return d; };

(async () => {
  console.log('tools:', JSON.stringify(tools));
  assert.ok(tools.ffmpeg && tools.ffprobe && tools.ytdlp, 'ffmpeg, ffprobe and yt-dlp are needed');
  const media = makeMedia(path.join(work, 'media'), tools.ffmpeg);
  const site = await serve(media);
  let swirl = null;

  await test('page with a video: yt-dlp reads it and downloads it whole', async () => {
    const r = await E.fetchVideo(tools, { url: site.url + 'video.html', marks: { start: 5, end: 9 } }, job(), { log });
    assert.ok(fs.existsSync(r.playable));
    near(r.probe.duration, 20, 0.2, 'length');
    assert.equal(r.offset, 0);
    assert.equal(r.probe.width, 1280);
    assert.equal(r.info.title, 'Swirling fractal colours - abstract loop');
    swirl = r;
    return `${r.info.title}, ${r.probe.width}x${r.probe.height}, ${r.probe.vcodec}`;
  });

  await test('long video with a marked part: only that part (plus a little either side) comes down', async () => {
    const r = await E.fetchVideo(tools, { url: site.url + 'long.html', marks: { start: 400, end: 410 }, pageDuration: 720 }, job(), { log });
    // Key frames are every 2 s, so the part starts at most 2 s before the asked-for start (400 - PAD)
    assert.ok(r.offset <= 400 - E.PAD && r.offset >= 400 - E.PAD - 2.2, 'offset ' + r.offset);
    // The cut snaps to the video's key frames (every 2 s here), so allow a couple of seconds
    near(r.probe.duration, 10 + 2 * E.PAD, 2.5, 'length');
    return `${r.probe.duration.toFixed(1)} s from ${r.offset} s`;
  });

  await test('GIF link: downloaded and turned into a playable video', async () => {
    const r = await E.fetchVideo(tools, { url: site.url + 'spin.gif', referer: site.url + 'gif.html' }, job(), { log });
    assert.equal(path.extname(r.playable), '.mp4');
    assert.equal(r.probe.vcodec, 'h264');
    near(r.probe.duration, 4, 0.3, 'length');
    return `${r.probe.width}x${r.probe.height}, ${r.probe.duration.toFixed(2)} s`;
  });

  await test('page with no video: a clear message', async () => {
    await assert.rejects(E.fetchVideo(tools, { url: site.url + 'blob.html' }, job(), { log }), (e) => {
      assert.equal(e.code, 'unsupported');
      assert.match(e.message, /No video was found/);
      return true;
    });
  });

  await test('page yt-dlp can’t read: falls back to the video the page is playing', async () => {
    const r = await E.fetchVideo(tools, { url: site.url + 'blob.html', direct: site.url + 'swirl.mp4', pageTitle: 'Page title' }, job(), { log });
    near(r.probe.duration, 20, 0.2, 'length');
    assert.equal(r.info.title, 'Page title');
  });

  await test('file from the computer: an MKV becomes playable', async () => {
    const r = await E.fetchVideo(tools, { file: path.join(media, 'odd.mkv') }, job(), { log });
    assert.equal(path.extname(r.playable), '.mp4');
    assert.equal(r.info.title, 'odd');
    return `${r.probe.width}x${r.probe.height} ${r.probe.fps} fps`;
  });

  await test('stopping a download part way', async () => {
    const ac = new AbortController();
    const p = E.fetchVideo(tools, { url: site.url + 'long.html' }, job(), { log, signal: ac.signal, onStatus: (s) => { if (/Download/.test(s)) ac.abort(); } });
    await assert.rejects(p, (e) => e.code === 'cancelled');
  });

  let cut = null;
  await test('cutting a clip: exact length, no sound, even size', async () => {
    const out = path.join(job(), 'clip.mp4');
    const r = await E.cutClip(tools, swirl.playable, out, { start: 5.2, end: 9.7, log });
    near(r.probe.duration, 4.5, 0.12, 'length');
    assert.equal(r.probe.hasAudio, false);
    assert.equal(r.probe.vcodec, 'h264');
    assert.equal(r.probe.width % 2, 0);
    cut = r;
    return `${r.encoder}, ${r.probe.width}x${r.probe.height}, ${r.probe.duration.toFixed(2)} s`;
  });

  await test('cutting with sound, at most 720 tall', async () => {
    const r = await E.cutClip(tools, swirl.playable, path.join(job(), 'clip.mp4'), { start: 0, end: 3, keepSound: true, maxHeight: 720, log });
    assert.equal(r.probe.hasAudio, true);
    assert.equal(r.probe.height, 720);
    assert.equal(r.probe.width, 1280);
  });

  await test('cutting an odd-sized 120 fps video: even size, 60 fps', async () => {
    const r = await E.cutClip(tools, path.join(media, 'odd.mkv'), path.join(job(), 'clip.mp4'), { start: 0.5, end: 2.5, log });
    assert.equal(r.probe.width % 2, 0);
    assert.equal(r.probe.height % 2, 0);
    near(r.probe.fps, 60, 0.5, 'fps');
    return `${r.probe.width}x${r.probe.height} ${r.probe.fps} fps`;
  });

  await test('library: save, recategorise, rename, categories, File Explorer changes, delete', async () => {
    const dir = path.join(work, 'Library');
    const lib = new Library(dir, {
      probe: (f) => E.probe(tools, f),
      thumb: (v, out, t) => E.frameAt(tools, v, t, out, { width: 480 }),
      log,
    });
    await lib.open();
    assert.equal(lib.data.cats.length, DEFAULT_CATEGORIES.length);
    const tmp = path.join(job(), 'x.mp4');
    fs.copyFileSync(cut.file, tmp);
    const c = await lib.addClip(tmp, { n: 'Swirl: "best" bit?', c: 'abstract', d: cut.probe.duration, w: cut.probe.width, h: cut.probe.height, src: site.url, page: 'Swirling' });
    assert.equal(c.f, 'Abstract/Swirl best bit.mp4');
    assert.ok(fs.existsSync(path.join(dir, 'Abstract', 'Swirl best bit.mp4')));
    assert.ok(fs.existsSync(lib.thumbAbs(c)), 'thumbnail');
    // Same name again gets (2)
    fs.copyFileSync(cut.file, tmp);
    const c2 = await lib.addClip(tmp, { n: 'Swirl best bit', c: 'abstract' });
    assert.equal(c2.f, 'Abstract/Swirl best bit (2).mp4');
    await lib.updateClip(c.id, { c: 'nature', n: 'Green swirl' });
    assert.ok(fs.existsSync(path.join(dir, 'Nature', 'Green swirl.mp4')));
    const cat = await lib.addCategory('Smoke');
    assert.equal(cat.id, 'smoke');
    assert.ok(fs.existsSync(path.join(dir, 'Smoke')));
    await lib.updateClip(c2.id, { c: 'smoke' });
    await lib.renameCategory('smoke', 'Smoke & fog');
    assert.ok(fs.existsSync(path.join(dir, 'Smoke & fog', 'Swirl best bit (2).mp4')));
    assert.equal(lib.data.clips.find((x) => x.id === c2.id).f, 'Smoke & fog/Swirl best bit (2).mp4');
    // In File Explorer: a clip dragged to another category folder, a new video dropped into a new folder
    fs.renameSync(path.join(dir, 'Nature', 'Green swirl.mp4'), path.join(dir, 'Water', 'Green swirl.mp4'));
    fs.mkdirSync(path.join(dir, 'Lava lamps'));
    fs.copyFileSync(cut.file, path.join(dir, 'Lava lamps', 'blob.mp4'));
    await lib.scan();
    assert.equal(lib.data.clips.find((x) => x.id === c.id).c, 'water');
    const lava = lib.data.cats.find((x) => x.n === 'Lava lamps');
    assert.ok(lava, 'new category from the folder');
    const blob = lib.data.clips.find((x) => x.c === lava.id);
    assert.ok(blob && blob.d > 4 && fs.existsSync(lib.thumbAbs(blob)));
    await lib.removeCategory('smoke');
    assert.equal(lib.data.clips.find((x) => x.id === c2.id).c, 'other');
    assert.ok(fs.existsSync(path.join(dir, 'Other', 'Swirl best bit (2).mp4')));
    await lib.removeClip(c.id);
    assert.ok(!fs.existsSync(path.join(dir, 'Water', 'Green swirl.mp4')));
    // A fresh look at the folder agrees with what was saved
    const again = new Library(dir, { probe: (f) => E.probe(tools, f), log });
    await again.open();
    assert.equal(again.data.clips.length, lib.data.clips.length);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'));
    return `${json.clips.length} clips, ${json.cats.length} categories`;
  });

  await test('sharing the library with Phosphor Loop: list, clip, thumbnail, only for its sites', async () => {
    const { startServer } = require('../src/server.js');
    const dir = path.join(work, 'Shared');
    const lib = new Library(dir, { probe: (f) => E.probe(tools, f), thumb: (v, out, t) => E.frameAt(tools, v, t, out, { width: 480 }), log });
    await lib.open();
    const tmp = path.join(job(), 'y.mp4');
    fs.copyFileSync(cut.file, tmp);
    const clip = await lib.addClip(tmp, { n: 'Shared swirl', c: 'abstract', d: cut.probe.duration, w: cut.probe.width, h: cut.probe.height });
    const sh = await startServer({ getLibrary: () => lib, version: 'test', ports: [0] });
    const base = 'http://127.0.0.1:' + sh.port;
    try {
      const origin = 'https://nhillson.github.io';
      let r = await fetch(base + '/library.json', { headers: { Origin: origin } });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('access-control-allow-origin'), origin);
      const j = await r.json();
      assert.equal(j.app, 'Phosphor Clips');
      assert.equal(j.clips.length, 1);
      assert.equal(j.clips[0].n, 'Shared swirl');
      assert.equal(j.cats.find((c) => c.id === 'abstract').count, 1);
      assert.ok(!JSON.stringify(j).includes(dir), 'no folder paths are shared');
      r = await fetch(base + '/clip/' + clip.id, { headers: { Origin: origin, Range: 'bytes=0-99' } });
      assert.equal(r.status, 206);
      assert.equal((await r.arrayBuffer()).byteLength, 100);
      r = await fetch(base + '/clip/' + clip.id, { headers: { Origin: origin } });
      assert.equal(r.headers.get('content-type'), 'video/mp4');
      assert.equal((await r.arrayBuffer()).byteLength, fs.statSync(lib.abs(clip)).size);
      r = await fetch(base + '/thumb/' + clip.id, { headers: { Origin: origin } });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'image/jpeg');
      r = await fetch(base + '/library.json', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true' } });
      assert.equal(r.status, 204);
      assert.equal(r.headers.get('access-control-allow-private-network'), 'true');
      r = await fetch(base + '/library.json', { headers: { Origin: 'https://some-other-site.example' } });
      assert.equal(r.status, 403, 'other websites are refused');
      r = await fetch(base + '/library.json', { headers: { Origin: 'http://localhost:8080' } });
      assert.equal(r.status, 200, 'a copy of Phosphor Loop on this computer is fine');
      r = await fetch(base + '/clip/nope', { headers: { Origin: origin } });
      assert.equal(r.status, 404);
    } finally { sh.close(); }
    return 'port ' + sh.port;
  });

  await test('words: a title and tags point to a category', async () => {
    const g = guessFromText({ title: 'Swirling fractal colours - abstract loop', tags: ['vj loop', 'psychedelic'] }, DEFAULT_CATEGORIES);
    assert.equal(g.best, 'abstract');
    const g2 = guessFromText({ title: 'Ocean waves at sunset, 4K', description: 'waves rolling onto the beach' }, DEFAULT_CATEGORIES);
    assert.equal(g2.best, 'water');
    const g3 = guessFromText({ title: 'IMG_2041' }, DEFAULT_CATEGORIES);
    assert.equal(g3.best, '');
    const art = guessFromText({ title: 'Start the party' }, DEFAULT_CATEGORIES);
    assert.notEqual(art.best, 'abstract');
  });

  await test('suggestion: the picture leads, strong words help', async () => {
    const v = { nature: 0.1, animals: 0.05, water: 0.4, sky: 0.05, fire: 0.05, abstract: 0.25, city: 0.03, people: 0.02, retro: 0.05 };
    assert.equal(combine(v, { title: 'clip' }, DEFAULT_CATEGORIES).id, 'water');
    const both = combine(v, { title: 'abstract fractal psychedelic kaleidoscope loop' }, DEFAULT_CATEGORIES);
    assert.equal(both.id, 'abstract');
    assert.equal(combine(null, { title: 'IMG_2041' }, DEFAULT_CATEGORIES).id, '');
    assert.equal(combine(null, { title: 'Campfire flames at night' }, DEFAULT_CATEGORIES).id, 'fire');
  });

  if (process.env.NET === '1') {
    // Real videos from the internet. Sites change, and some block computers in data centres (like GitHub's), so
    // these only report; they don't fail the build.
    const real = [
      ['a GIF from Wikimedia Commons', 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif'],
      ['a Wikimedia Commons video page', 'https://commons.wikimedia.org/wiki/File:Aurora_Borealis_Time_Lapse_-_Polar_Lights_-_Northern_Lights_-_Tromso,_Norway_-_4K_UHD.webm'],
      ['a NASA video page', 'https://images.nasa.gov/details/GSFC_20171208_Archive_e002076'],
      ['a Vimeo video', 'https://vimeo.com/76979871'],
      ['a YouTube video (Creative Commons)', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
    ];
    for (const [name, url] of real) {
      await test('internet: ' + name, async () => {
        const r = await E.fetchVideo(tools, { url, marks: { start: 10, end: 14 }, maxHeight: 720 }, job(), { log });
        const c = await E.cutClip(tools, r.playable, path.join(job(), 'c.mp4'), { start: 0, end: Math.min(3, r.probe.duration), maxHeight: 720, log });
        return `${r.info.title || '?'}: ${r.probe.width}x${r.probe.height} ${r.probe.vcodec} ${r.probe.duration.toFixed(1)} s, clip ${c.probe.duration.toFixed(1)} s`;
      }, { optional: true });
    }
  }

  site.close();
  if (process.env.RESULTS) fs.writeFileSync(process.env.RESULTS, JSON.stringify({ tools, results }, null, 2));
  if (!process.env.KEEP) fs.rmSync(work, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
