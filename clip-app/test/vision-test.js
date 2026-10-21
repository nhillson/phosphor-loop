'use strict';
// Tests the picture recogniser on pictures whose category is plain: a flower, a puffin and the aurora from
// Phosphor Loop's own nature pictures, and a fractal made by ffmpeg. The first run downloads the model (about
// 150 MB) into CLIPS_DATA/models. Run: node test/vision-test.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork, spawnSync } = require('node:child_process');
const { Vision, combine } = require('../src/vision.js');
const { DEFAULT_CATEGORIES } = require('../src/categories.js');
const { findTools } = require('../src/engine.js');

(async () => {
  const root = path.join(__dirname, '..');
  const tools = findTools([process.env.CLIPS_BIN || path.join(root, 'vendor')]);
  const data = process.env.CLIPS_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'clips-vision-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-vision-pics-'));
  const nature = path.join(root, '..', 'nature');
  const fractal = path.join(work, 'fractal.jpg');
  spawnSync(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'mandelbrot=s=640x360:end_scale=0.02:outer=normalized_iteration_count',
    '-ss', '3', '-frames:v', '1', fractal]);
  const cases = [
    ['a daisy', path.join(nature, 'african-daisy.jpg'), 'nature'],
    ['a puffin', path.join(nature, 'atlantic-puffin.jpg'), 'animals'],
    ['the aurora', path.join(nature, 'aurora-and-meteors.jpg'), 'sky'],
    ['a fractal', fractal, 'abstract'],
  ].filter(([, f]) => fs.existsSync(f));

  const statuses = [];
  const vision = new Vision({
    fork: (script) => fork(script, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }),
    cacheDir: path.join(data, 'models'),
    log: (s) => console.log('   ' + s),
    onStatus: (s) => { if (s.text && (!statuses.length || s.pct - statuses[statuses.length - 1] >= 10)) { statuses.push(s.pct); console.log(`   ${s.text}: ${Math.round(s.pct)}%`); } },
  });
  const results = [];
  let right = 0;
  const t0 = Date.now();
  for (const [name, file, want] of cases) {
    const scores = await vision.classify([file], DEFAULT_CATEGORIES);
    const s = combine(scores, {}, DEFAULT_CATEGORIES);
    const top = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
    const ok = s.id === want;
    if (ok) right++;
    results.push({ name, want, got: s.id, sure: s.sure, top });
    console.log(`${ok ? 'ok   ' : 'MISS '} ${name}: ${s.id || '(none)'} (wanted ${want}; ${top})`);
  }
  const ms = Date.now() - t0;
  vision.stop();
  const ok = cases.length >= 3 && right >= cases.length - 1;
  console.log(`\n${right} of ${cases.length} right in ${(ms / 1000).toFixed(1)} s (including the first-time download)`);
  if (process.env.RESULTS) fs.writeFileSync(process.env.RESULTS, JSON.stringify({ ok, right, of: cases.length, ms, results }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
