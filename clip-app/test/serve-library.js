'use strict';
// A real Phosphor Clips library shared the real way, for testing Phosphor Loop's Clip library: two short clips
// (a swirling fractal in Abstract, blue water-ish stripes in Water) made with ffmpeg, served by src/server.js, which
// also takes snips from Phosphor Loop (snip.js).
// Run: node test/serve-library.js [port] [folder]   prints "READY <port>" once it answers. Stop it with Ctrl+C.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const E = require('../src/engine.js');
const { Library } = require('../src/library.js');
const { startServer } = require('../src/server.js');

(async () => {
  const port = +(process.argv[2] || 47811);
  const dir = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'clips-lib-'));
  const tools = E.findTools([process.env.CLIPS_BIN || path.join(__dirname, '..', 'vendor')]);
  const lib = new Library(dir, { probe: (f) => E.probe(tools, f), thumb: (v, out, t) => E.frameAt(tools, v, t, out, { width: 480 }) });
  await lib.open();
  if (!lib.data.clips.length) {
    const make = (name, lavfi, cat) => {
      // WebM (VP9): the open-source Chromium that Phosphor Loop's tests use can't play H.264
      const f = path.join(os.tmpdir(), `clips-src-${process.pid}-${cat}.webm`);
      const r = spawnSync(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', lavfi, '-t', '4',
        '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-pix_fmt', 'yuv420p', f]);
      if (r.status !== 0) throw new Error(String(r.stderr));
      return lib.addClip(f, { n: name, c: cat, d: 4, w: 640, h: 360, src: 'https://example.com/' + cat, by: 'Test', lic: 'CC0' });
    };
    await make('Swirl', 'mandelbrot=s=640x360:r=30:end_scale=0.05,hue=H=t', 'abstract');
    await make('Blue stripes', 'testsrc2=s=640x360:r=30,hue=h=200:s=2,format=yuv420p', 'water');
  }
  // Snips from Phosphor Loop are cut and filed the real way (snip.js)
  const Snip = require('../src/snip.js');
  const sh = await startServer({ getLibrary: () => lib, version: 'test', ports: [port],
    onSnip: (req, params) => Snip.makeSnip({ tools, library: lib, work: os.tmpdir(), req, ask: Snip.readAsk(params), log: (s) => console.log('  ' + s) }) });
  if (!sh) { console.log('FAILED port ' + port); process.exit(1); }
  console.log('READY ' + sh.port + ' ' + JSON.stringify(lib.data.clips.map((c) => ({ id: c.id, n: c.n, c: c.c }))));
})().catch((e) => { console.log('FAILED ' + e.message); process.exit(1); });
