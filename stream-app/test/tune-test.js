'use strict';
// Checks the sharpness test without Electron: a moving test picture (FFmpeg's Mandelbrot zoom with grain) stands in
// for Phosphor Loop's frames, goes through the recorder frame by frame, and is scored with the processor's
// settings (and the graphics card's, where the computer has one). Waits are counted in frames.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Tuner, candidates, pick } = require('../src/tune.js');

const FF = process.env.FFMPEG || 'ffmpeg';
const W = +(process.env.W || 640), H = +(process.env.H || 360), FPS = 30, FRAMES = +(process.env.FRAMES || 60);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pstune-'));
  const logs = [];
  const t = new Tuner({ ffmpeg: FF, log: (m) => logs.push(m), dir });
  t.startRecording({ width: W, height: H, fps: FPS, frames: FRAMES });
  // The stand-in page: raw RGBA frames, bottom row first like WebGL's readPixels
  const src = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `mandelbrot=s=${W}x${H}:rate=${FPS}:end_scale=0.02,noise=alls=12:allf=t`,
    '-frames:v', String(FRAMES + 5), '-vf', 'vflip', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']);
  const frameBytes = W * H * 4;
  let pending = Buffer.alloc(0), sent = 0, skipped = 0;
  src.stdout.on('data', (d) => {
    pending = Buffer.concat([pending, d]);
    while (pending.length >= frameBytes) {
      const f = pending.subarray(0, frameBytes); pending = pending.subarray(frameBytes);
      if (skipped < 3) { skipped++; continue; } // the sample starts 3 frames in (the recorder check expects that)
      if (sent < FRAMES) { t.addFrame(W, H, f.buffer.slice(f.byteOffset, f.byteOffset + f.length)); sent++; }
    }
  });
  const info = await t.waitRecording();
  console.log('Recorded', info.frames, 'frames,', fs.statSync(t.sample).size, 'bytes');
  if (fs.statSync(t.sample).size !== W * H * 3 / 2 * FRAMES) fail('sample has the wrong size');
  const sig = await t.detailEnergy(info);
  console.log('Fine detail in the clip (dB):', sig);
  if (!Number.isFinite(sig)) fail('could not measure the clip');
  const ids = ONLY || candidates('libx264');
  const results = [];
  for (const id of ids) {
    const r = await t.measure(id, info, +(process.env.BITRATE || 1500000), sig);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  // The page recorder check: a stand-in recording of the same frames in the browser's colour format (BT.601), starting
  // 3 frames early, missing frame 20 and repeating frame 40, at 60 Mbps
  t.expectRecording();
  const recFile = path.join(dir, 'fake-recorder.mkv');
  const mk = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `mandelbrot=s=${W}x${H}:rate=${FPS}:end_scale=0.02,noise=alls=12:allf=t`,
    '-frames:v', String(FRAMES + 3), '-vf', `trim=start_frame=0,select='not(eq(n\\,23))',loop=loop=1:size=1:start=42,setpts=N/(${FPS}*TB),scale=out_color_matrix=bt601:out_range=tv,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '60M', '-f', 'matroska', recFile]);
  await new Promise((r) => mk.on('close', r));
  t.saveRecording(fs.readFileSync(recFile), 'video/x-matroska;codecs=avc1');
  const first = await t.measureFirstStage(info);
  console.log('Page recorder check:', JSON.stringify(first));
  if (!first.ok) fail('page recorder check failed: ' + first.error);
  if (first.startOffset !== 3) fail('recorder start not found');
  if (first.missing !== 1 || first.extra !== 1) fail('missing/extra frames not counted right');
  if (!(first.psnrY > 38 && first.psnrU > 38 && first.psnrV > 38)) fail('recorder colours or picture do not match');

  const best = pick(results, { fps: FPS, bitrate: +(process.env.BITRATE || 1500000), usual: ids[0] });
  console.log('Picked:', best && best.id);
  const good = results.filter((r) => r.ok);
  if (good.length < Math.min(2, ids.length)) fail('too few settings could be scored');
  if (good.some((r) => !(r.detail > -20 && r.detail < 60) || !(r.psnr > 10) || !(r.ssim > 0.2))) fail('scores out of range');
  if (!best && !process.env.SLOW_OK) fail('nothing picked');
  console.log('PASS');
})().catch((e) => fail(e.stack));
