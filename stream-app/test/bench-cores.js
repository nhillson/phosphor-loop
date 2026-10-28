'use strict';
// Measures ways to spread the squeezer's picture steps over the processor's cores (run by hand on the build
// computer: Actions › "Stream app core benchmark"). Five Twitch sizes (1080p down to 160p) from a 1440p and from a
// 1080p picture, decoding and picture steps only (no encoding), each way timed. Prints speed (x real time).
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { buildGraph } = require('../src/stream.js');
const FF = process.env.FFMPEG || 'ffmpeg';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psbench-'));
const N = os.cpus().length;
const SECS = 8;
const mk = (h) => ({ width: Math.round(h * 16 / 9 / 2) * 2, height: h, variant: 'nv-p7-full' });
const enc = [mk(1080), mk(720), mk(480), mk(360), { ...mk(160), width: 284 }];
const lines = [`${os.cpus()[0].model} x${N}; ${execFileSync(FF, ['-hide_banner', '-version']).toString().split('\n')[0]}`];
const run = (input, pre, graphs, extra = []) => {
  const args = ['-hide_banner', '-loglevel', 'error', ...pre, '-i', input];
  for (const g of graphs) args.push('-filter_complex', g.graph);
  args.push(...extra);
  for (const g of graphs) for (const o of g.outs) args.push('-map', o);
  args.push('-f', 'null', '-');
  const t = Date.now();
  execFileSync(FF, args, { maxBuffer: 1e7 });
  return SECS / ((Date.now() - t) / 1000);
};
const conv = 'in_color_matrix=bt601:out_color_matrix=bt709:in_range=tv:out_range=tv';
for (const h of [1440, 1080]) {
  const w = h === 1440 ? 2560 : 1920;
  const input = path.join(dir, `in${h}.mkv`);
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=30,noise=alls=30:allf=t`, '-t', String(SECS),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', h === 1440 ? '90M' : '60M', '-pix_fmt', 'yuv420p', input]);
  const plan = { fps: 30, encodes: enc };
  const one = buildGraph(plan, { width: w, height: h });
  const outs = enc.map((_, i) => `[v${i}]`);
  const withThreads = one.replace(/(flags=[a-z_+]+)/g, `$1:threads=${N}`);
  // Each size its own graph (each its own thread), each converting from the full picture
  const sharp = (zh) => (Math.max(zh, h) > 1080 ? 'accurate_rnd+full_chroma_inp' : 'accurate_rnd+full_chroma_int+full_chroma_inp');
  const separate = enc.map((e, i) => ({ graph: `[0:v:0]scale=w=${e.width}:h=${e.height}:${conv}:flags=lanczos+${sharp(e.height)},format=yuv420p[v${i}]`, outs: [`[v${i}]`] }));
  const tests = [
    ['one graph (1.9.1)', [], [{ graph: one, outs }]],
    ['one graph + filter_complex_threads', [], [{ graph: one, outs }], ['-filter_complex_threads', String(N)]],
    ['one graph + scale threads', [], [{ graph: withThreads, outs }]],
    ['one graph + both', [], [{ graph: withThreads, outs }], ['-filter_complex_threads', String(N)]],
    ['five graphs side by side', [], separate],
  ];
  for (const [name, pre, graphs, extra] of tests) {
    let speed;
    try { speed = run(input, pre, graphs, extra).toFixed(2) + 'x'; } catch (e) { speed = 'failed: ' + String(e.stderr || e.message).slice(0, 200); }
    lines.push(`${h}p picture, ${name}: ${speed}`);
    console.log(lines[lines.length - 1]);
  }
}
if (process.env.GITHUB_ACTIONS) console.log('::notice title=core benchmark::' + lines.join('%0A'));
