'use strict';
// The sharpness test. It records a few seconds of the real Phosphor Loop picture exactly as drawn (no compression),
// then squeezes that same clip with each encoder setting at the real stream speed (Mbps), on this computer's own
// graphics card, and scores how much of the fine detail survives. The sharpest setting this computer can keep up
// with is the one the stream then uses.
//
// Scores (all compare the squeezed clip with the original):
//  - detail: fine-detail score in dB. The picture minus a slightly blurred copy of itself is its "fine detail";
//    the score is how closely the squeezed clip's fine detail matches the original's (higher = sharper;
//    +1 dB is clearly visible on fine stripes). This is the one used to pick.
//  - psnr / ssim: the usual whole-picture match scores, for reference.
//  - speed: frames a second this computer squeezes at (must be well above the stream's frame rate).
//  - peakMbps: the busiest second of the squeezed clip (platforms hang up on bursts).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { encoderArgs, VARIANTS } = require('./stream.js');

function runFF(ffmpeg, args, { onLine, timeout = 300000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, args, { windowsHide: true });
    let err = '', partial = '';
    const t = setTimeout(() => { try { p.kill(); } catch (_) {} }, timeout);
    p.stdout.on('data', () => {});
    p.stderr.on('data', (d) => {
      const text = partial + String(d);
      const lines = text.split(/\r?\n/);
      partial = lines.pop();
      for (const l of lines) { if (onLine) onLine(l); err = (err + l + '\n').slice(-8000); }
    });
    p.on('error', (e) => { err += e.message; });
    p.on('close', (code) => { clearTimeout(t); if (partial) err += partial; resolve({ code, err }); });
  });
}
// FFmpeg's most useful complaint: the encoder's own words if it said anything, otherwise its last line
const lastError = (text) => {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[a-z0-9_]+=\S*$/.test(l));
  const own = lines.filter((l) => /^\[(h264|hevc|av1|lib)\w*\s@/.test(l) || /Unrecognized option|Option not found|not supported|No capable devices|Cannot load|InitializeEncoder failed/i.test(l));
  return (own.length ? own.slice(0, 2).join(' | ') : lines.pop()) || 'failed';
};

class Tuner {
  constructor({ ffmpeg, log = () => {}, dir }) {
    this.ffmpeg = ffmpeg; this.log = log; this.dir = dir;
    this.rec = null;
  }

  get sample() { return path.join(this.dir, 'sample.yuv'); }
  get meta() { return path.join(this.dir, 'sample.json'); }

  // Step 1: the page hands over each drawn frame (raw RGBA, bottom row first); FFmpeg turns them into the
  // stream's colour format (BT.709, 4:2:0, the same as the stream) without any compression.
  startRecording({ width, height, fps, frames }) {
    fs.mkdirSync(this.dir, { recursive: true });
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`,
      '-r', String(fps), '-i', 'pipe:0', '-vf',
      'vflip,scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=yuv420p',
      '-f', 'rawvideo', this.sample];
    const p = spawn(this.ffmpeg, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.stdin.on('error', () => {});
    const rec = { width, height, fps, frames, got: 0, proc: p, lastAt: Date.now(), firstAt: 0 };
    rec.done = new Promise((resolve, reject) => {
      rec.finish = resolve; rec.fail = reject;
      p.on('close', (code) => {
        if (rec.got >= frames && code === 0) resolve();
        else reject(new Error(`recording stopped after ${rec.got} of ${frames} frames ${lastError(err)}`));
      });
    });
    this.rec = rec;
    return rec;
  }

  addFrame(width, height, buf) {
    const r = this.rec;
    if (!r || r.got >= r.frames) return;
    if (width !== r.width || height !== r.height) { r.proc.kill(); return; }
    r.got++; r.lastAt = Date.now(); if (!r.firstAt) r.firstAt = r.lastAt;
    r.proc.stdin.write(Buffer.from(buf));
    if (r.got >= r.frames) r.proc.stdin.end();
  }

  // Waits until every frame has arrived (counted in frames). The ceiling is only for a page that stopped drawing.
  async waitRecording(stallMs = 20000) {
    const r = this.rec;
    const watch = setInterval(() => { if (r.got < r.frames && Date.now() - r.lastAt > stallMs) r.proc.kill(); }, 1000);
    try { await r.done; } finally { clearInterval(watch); this.rec = null; }
    // How fast the raw pictures came across from the page (useful for a future no-compression stream path)
    const secs = (r.lastAt - r.firstAt) / 1000;
    const rate = secs > 0 ? (r.got - 1) / secs : 0;
    const info = { width: r.width, height: r.height, fps: r.fps, frames: r.frames, at: new Date().toISOString(),
      arrivedFps: +rate.toFixed(1), arrivedMBps: +(rate * r.width * r.height * 4 / 1e6).toFixed(1) };
    fs.writeFileSync(this.meta, JSON.stringify(info, null, 2));
    return info;
  }

  // How much fine detail the clip has at all (the same for every setting, so measured once).
  async detailEnergy(info) {
    const { width: W, height: H, fps: R } = info;
    const res = await runFF(this.ffmpeg, ['-hide_banner', '-nostats', '-loglevel', 'info',
      '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-r', String(R), '-i', this.sample,
      '-f', 'lavfi', '-i', `color=c=0x808080:s=${W}x${H}:r=${R},format=gray`,
      '-filter_complex', `[0:v]setpts=N/(${R}*TB),settb=1/${R},extractplanes=y,split[ra][rb];[rb]gblur=sigma=1.5[rg];` +
        `[ra][rg]blend=all_mode=grainextract[hr];[1:v]setpts=N/(${R}*TB),settb=1/${R}[g];[hr][g]psnr@sig=eof_action=endall:shortest=1[x];[x]format=gray[out]`,
      '-map', '[out]', '-f', 'null', '-']);
    const m = res.err.match(/psnr@sig[^\n]*PSNR y:([\d.]+|inf)/);
    return m ? +m[1] : NaN;
  }

  // Step 2: squeeze the clip with one setting, then score it.
  async measure(id, info, bitrate, sigPsnr, custom) {
    const v = custom || VARIANTS[id];
    const { width: W, height: H, fps: R, frames: N } = info;
    const out = path.join(this.dir, 'out.ts');
    const q = { fps: R, bitrate, width: W, height: H };
    const args = custom ? custom.args : encoderArgs(id, q);
    // The graphics card is fast, so the clip is played twice to time it properly; the score uses the first pass.
    const loops = v.cpu ? 0 : 1;
    let firstAt = 0, firstFrame = 0, lastAt = 0, lastFrame = 0;
    const enc = await runFF(this.ffmpeg, ['-hide_banner', '-nostats', '-loglevel', 'error', '-stats_period', '0.1', '-progress', 'pipe:2', '-y',
      '-stream_loop', String(loops), '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-r', String(R), '-i', this.sample,
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      ...args, '-an', '-f', 'mpegts', out], {
      onLine: (l) => {
        const m = l.match(/^frame=(\d+)/);
        if (!m) return;
        const f = +m[1], now = Date.now();
        if (f > 0 && !firstAt) { firstAt = now; firstFrame = f; }
        lastAt = now; lastFrame = f;
      },
    });
    if (enc.code !== 0) return { id, label: v.label, ok: false, error: lastError(enc.err).slice(0, 200) };
    const speed = lastAt > firstAt && lastFrame > firstFrame ? (lastFrame - firstFrame) / ((lastAt - firstAt) / 1000) : 0;

    // The busiest second of the result, from the size of each squeezed frame
    const sizes = [];
    const crc = await new Promise((resolve) => {
      const p = spawn(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', out, '-map', '0:v', '-c', 'copy', '-frames:v', String(N), '-f', 'framecrc', '-'], { windowsHide: true });
      let text = '';
      p.stdout.on('data', (d) => { text += d; });
      p.on('close', () => resolve(text));
      p.on('error', () => resolve(''));
    });
    for (const line of crc.split(/\r?\n/)) {
      if (!line || line[0] === '#') continue;
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length >= 5) sizes.push(+parts[4]);
    }
    // Busiest second after the first one (every encoder may spend a little extra at the very start, once)
    let peak = 0, startMbps = 0, sum = 0;
    for (let i = 0; i < sizes.length; i++) {
      sum += sizes[i];
      if (i >= R) sum -= sizes[i - R];
      if (i === R - 1) startMbps = sum * 8 / 1e6;
      if (i >= 2 * R - 1) peak = Math.max(peak, sum * 8 / 1e6);
    }
    if (!peak) peak = startMbps;
    const avgMbps = sizes.length ? sizes.reduce((a, b) => a + b, 0) * 8 / (sizes.length / R) / 1e6 : 0;

    // The scores
    const g = `setpts=N/(${R}*TB),settb=1/${R}`;
    const met = await runFF(this.ffmpeg, ['-hide_banner', '-nostats', '-loglevel', 'info',
      '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-r', String(R), '-i', this.sample, '-i', out,
      '-filter_complex',
      `[1:v]format=yuv420p,${g},extractplanes=y,split=3[o0][o1][o2];` +
      `[0:v]${g},extractplanes=y,split=3[r0][r1][r2];` +
      `[o0][r0]psnr@full=eof_action=endall[x0];[o1][r1]ssim@y=eof_action=endall[x1];` +
      `[o2]split[oa][ob];[ob]gblur=sigma=1.5[og];[oa][og]blend=all_mode=grainextract[ho];` +
      `[r2]split[ra][rb];[rb]gblur=sigma=1.5[rg];[ra][rg]blend=all_mode=grainextract[hr];` +
      `[ho][hr]psnr@err=eof_action=endall[x2];[x1]nullsink;[x2]nullsink;[x0]format=gray[out]`,
      '-map', '[out]', '-frames:v', String(N), '-f', 'null', '-']);
    const num = (re) => { const m = met.err.match(re); return m ? (m[1] === 'inf' ? 99 : +m[1]) : NaN; };
    const psnr = num(/psnr@full[^\n]*PSNR y:([\d.]+|inf)/);
    const ssim = num(/ssim@y[^\n]*SSIM Y:([\d.]+)/);
    const errPsnr = num(/psnr@err[^\n]*PSNR y:([\d.]+|inf)/);
    const detail = errPsnr - sigPsnr;
    try { fs.unlinkSync(out); } catch (_) {}
    if (!Number.isFinite(detail)) return { id, label: v.label, ok: false, error: 'could not score: ' + lastError(met.err).slice(0, 160) };
    return { id, label: v.label, ok: true, detail: +detail.toFixed(2), psnr: +psnr.toFixed(2), ssim: +ssim.toFixed(4),
      extra: !!custom, speed: Math.round(speed), peakMbps: +peak.toFixed(2), startMbps: +startMbps.toFixed(2), avgMbps: +avgMbps.toFixed(2), cpu: !!v.cpu, auto: !custom && v.auto !== false };
  }
}

// The first step of the real stream is the page's own recorder (Chromium's MediaRecorder, which on Windows uses the
// graphics card through Media Foundation). It recorded the same frames during the sample. This lines its frames up
// with the exact ones and reports what that step loses: match scores for brightness (Y) and colour (U, V), and how
// many frames it dropped or repeated. Colour is converted the same way as the stream (BT.601 in, BT.709 out), so a
// wrong conversion would show up as poor colour scores.
Tuner.prototype.saveRecording = function (buf, mime) {
  try {
    fs.mkdirSync(this.dir, { recursive: true });
    this.recFile = path.join(this.dir, /webm/.test(mime) ? 'recorder.webm' : 'recorder.mkv');
    fs.writeFileSync(this.recFile, Buffer.from(buf));
    this.recMime = mime;
    if (this.recWaiter) this.recWaiter();
  } catch (e) { this.log('Could not keep the recorder sample: ' + e.message); }
};
Tuner.prototype.expectRecording = function () {
  this.recFile = null;
  this.recReady = new Promise((r) => { this.recWaiter = r; });
};
Tuner.prototype.measureFirstStage = async function (info, ceilingMs = 30000) {
  const got = await Promise.race([this.recReady, new Promise((r) => setTimeout(() => r('late'), ceilingMs))]);
  if (got === 'late' || !this.recFile) return { ok: false, error: 'the page recorder sample never arrived' };
  const { width: W, height: H, frames: N } = info;
  const recYuv = path.join(this.dir, 'recorder.yuv');
  const dec = await runFF(this.ffmpeg, ['-hide_banner', '-nostats', '-loglevel', 'error', '-y', '-i', this.recFile, '-map', '0:v:0',
    '-vf', `scale=${W}:${H}:in_color_matrix=bt601:out_color_matrix=bt709:in_range=tv:out_range=tv:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=yuv420p`,
    '-fps_mode', 'passthrough', '-frames:v', String(N + 60), '-f', 'rawvideo', recYuv]);
  if (dec.code !== 0) return { ok: false, error: 'could not read the recorder sample: ' + lastError(dec.err).slice(0, 160) };
  const fs1 = W * H * 3 / 2;
  const M = Math.floor(fs.statSync(recYuv).size / fs1);
  const fa = fs.openSync(this.sample, 'r'), fb = fs.openSync(recYuv, 'r');
  const A = Buffer.alloc(fs1), B = Buffer.alloc(fs1);
  const readA = (i) => fs.readSync(fa, A, 0, fs1, i * fs1), readB = (j) => fs.readSync(fb, B, 0, fs1, j * fs1);
  // quick brightness difference on a sparse grid, to line frames up
  const quick = () => { let s = 0, n = 0; for (let y = 2; y < H; y += 8) for (let x = 3, o = y * W; x < W; x += 8) { const d = A[o + x] - B[o + x]; s += d * d; n++; } return s / n; };
  const sq = (o, len) => { let s = 0; for (let k = o; k < o + len; k++) { const d = A[k] - B[k]; s += d * d; } return s / len; };
  try {
    // where the recorder's frames start: the best match for the sample's first frame
    readA(0);
    let start = 0, bestErr = Infinity;
    for (let j = 0; j < Math.min(M, 45); j++) { readB(j); const e = quick(); if (e < bestErr) { bestErr = e; start = j; } }
    // Walk both in step. A sample frame with no close match in the recording was dropped by the recorder; a
    // recording frame skipped over was an extra (repeated) one.
    let cur = start, typical = Math.max(1, bestErr), matched = 0, missing = 0, extra = 0, sy = 0, su = 0, sv = 0;
    for (let i = 0; i < N && cur < M; i++) {
      readA(i);
      let best = cur, be = Infinity;
      for (let k = Math.max(0, cur - 1); k <= Math.min(M - 1, cur + 2); k++) { readB(k); const e = quick(); if (e < be) { be = e; best = k; } }
      if (be > 3 * typical + 2) { missing++; continue; }
      if (best > cur) extra += best - cur;
      readB(best);
      sy += sq(0, W * H); su += sq(W * H, W * H / 4); sv += sq(W * H * 5 / 4, W * H / 4);
      matched++; typical = 0.8 * typical + 0.2 * Math.max(1, be); cur = best + 1;
    }
    if (!matched) return { ok: false, error: 'the recording did not line up with the sample' };
    const p = (mse) => +(10 * Math.log10(255 * 255 / Math.max(1e-9, mse / matched))).toFixed(2);
    return { ok: true, mime: this.recMime, recFrames: M, startOffset: start, matched, missing, extra,
      psnrY: p(sy), psnrU: p(su), psnrV: p(sv), sizeMB: +(fs.statSync(this.recFile).size / 1e6).toFixed(1) };
  } finally { fs.closeSync(fa); fs.closeSync(fb); try { fs.unlinkSync(recYuv); } catch (_) {} }
};

// Which settings to compare on this computer: every setting for the graphics card the app found, plus the
// processor's (which only win if this computer's processor is fast enough).
function candidates(codec) {
  return Object.entries(VARIANTS).filter(([, v]) => v.codec === codec || v.codec === 'libx264').map(([id]) => id);
}

// The winner: the sharpest setting that is fast enough (well above the stream's frame rate, with room to spare for
// drawing Phosphor Loop at the same time) and doesn't burst. Ties (under 0.1 dB, not visible) keep the usual setting.
function pick(results, { fps, bitrate, usual }) {
  const ok = results.filter((r) => r.ok && r.auto && r.speed >= fps * (r.cpu ? 2.5 : 1.6) && r.peakMbps <= bitrate / 1e6 * 1.3);
  if (!ok.length) return null;
  ok.sort((a, b) => b.detail - a.detail);
  const base = ok.find((r) => r.id === usual);
  if (base && ok[0].detail - base.detail < 0.1) return base;
  return ok[0];
}

module.exports = { Tuner, candidates, pick };
