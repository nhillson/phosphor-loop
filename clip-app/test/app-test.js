'use strict';
// Starts the whole app against the local test pages and lets it test itself (src/selftest.js): marking a playing
// video, grabbing, trimming, saving, a GIF, a part of a long video and the library. Pictures and result.json go to
// OUT (default test-out/). Run: node test/app-test.js   (ELECTRON=path to electron if not installed with npm;
// CLIPS_NO_VISION=1 to skip the picture recogniser and its one-time download)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeMedia, serve } = require('./fixtures.js');
const { findTools } = require('../src/engine.js');

(async () => {
  const root = path.join(__dirname, '..');
  const tools = findTools([process.env.CLIPS_BIN || path.join(root, 'vendor')]);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-app-'));
  const out = path.resolve(process.env.OUT || path.join(root, 'test-out'));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const media = makeMedia(path.join(work, 'media'), tools.ffmpeg);
  const site = await serve(media);
  let electron = process.env.ELECTRON;
  if (!electron) electron = require('electron');   // the path to the Electron program, when installed with npm
  const env = {
    ...process.env, CLIPS_TEST: '1', CLIPS_TEST_URL: site.url, CLIPS_TEST_OUT: out,
    CLIPS_DATA: process.env.CLIPS_DATA || path.join(work, 'data'), CLIPS_LIBRARY: path.join(work, 'Library'),
    CLIPS_FFMPEG: tools.ffmpeg, CLIPS_FFPROBE: tools.ffprobe, CLIPS_YTDLP: tools.ytdlp, CLIPS_DENO: tools.deno || '',
  };
  const args = [root];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const child = spawn(electron, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logLines = [];
  const take = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { logLines.push(l); if (/selftest|failed|ERROR|vision/i.test(l)) console.log(l); } };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  const code = await new Promise((r) => child.on('close', r));
  site.close();
  fs.writeFileSync(path.join(out, 'app-log.txt'), logLines.join('\n'));
  let result = null;
  try { result = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')); } catch (_) { /* none */ }
  if (!result) { console.log('No result: the app ended with ' + code + '. Last lines:\n' + logLines.slice(-30).join('\n')); process.exit(1); }
  console.log('\n' + result.checks.map((c) => (c.ok ? 'ok    ' : 'FAIL  ') + c.name + (c.note ? '  (' + c.note + ')' : '')).join('\n'));
  console.log(result.ok ? '\nall passed' : '\nFAILED');
  if (!process.env.KEEP) fs.rmSync(work, { recursive: true, force: true });
  process.exit(result.ok && code === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
