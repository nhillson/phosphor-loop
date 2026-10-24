'use strict';
// Recording a video file (for uploading to YouTube). It works in two steps, so the file comes out as clean as it can:
//  1. While recording, Phosphor Loop's picture is recorded inside the page at a very high quality and written to a
//     working file. This is light work for the computer, so the picture keeps drawing smoothly.
//  2. When the recording stops, FFmpeg squeezes that working file into the finished .mp4 at the chosen quality. It
//     isn't racing the clock, so it can use the careful settings (and the processor, if there's no graphics card).
// Colours are converted from the browser's BT.601 to BT.709 (what YouTube expects), with sharp colour edges, the same
// way the stream does. Sound: AAC 384 kbps stereo, YouTube's recommendation.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REC_SIZES = { 2160: { width: 3840, height: 2160 }, 1440: { width: 2560, height: 1440 }, 1080: { width: 1920, height: 1080 } };
// Mbps at 30 frames a second, for each size. 60 frames a second gets half as much again.
//   youtube: YouTube's own recommended upload rates (its "recommended upload encoding settings")
//   clean:   about twice that: YouTube re-squeezes every upload, and does much better with fine detail when it
//            starts from a clean file
//   perfect: nearly lossless, for keeping or editing
const REC_QUALITY = {
  youtube: { label: 'YouTube standard', mbps: { 2160: 45, 1440: 24, 1080: 12 } },
  clean: { label: 'Very clean', mbps: { 2160: 100, 1440: 50, 1080: 30 } },
  perfect: { label: 'Near-perfect', mbps: { 2160: 250, 1440: 130, 1080: 70 } },
};
const REC_DEFAULTS = { size: 2160, quality: 'clean', fps: 30 };

function recPlan(opts) {
  const size = REC_SIZES[opts.size] ? +opts.size : REC_DEFAULTS.size;
  const quality = REC_QUALITY[opts.quality] ? opts.quality : REC_DEFAULTS.quality;
  const fps = opts.fps === 60 ? 60 : 30;
  const bitrate = Math.round(REC_QUALITY[quality].mbps[size] * (fps > 30 ? 1.5 : 1) * 1e6);
  // The working recording is kept well above the final quality, so the final squeeze is the only real loss
  const firstBitrate = Math.min(300e6, Math.max(2 * bitrate, size >= 2160 ? 160e6 : size >= 1440 ? 100e6 : 60e6));
  return { ...REC_SIZES[size], size, quality, fps, bitrate, firstBitrate };
}
// How big the finished file is, in GB, for this many minutes
const recGB = (plan, minutes) => ((plan.bitrate + 384000) * minutes * 60) / 8 / 1e9;

// The final squeeze, for this computer's encoder family. Variable bitrate around the chosen rate (a little more for a
// busy moment), no adaptive quantisation (it smears Phosphor Loop's fine detail), a full picture every half second
// (YouTube's recommendation), the most careful settings each encoder has.
function finalArgs(family, plan) {
  const b = plan.bitrate, max = Math.min(Math.round(b * 1.5), 300e6);
  const rate = ['-b:v', String(b), '-maxrate', String(max), '-bufsize', String(2 * b), '-g', String(Math.max(1, Math.round(plan.fps / 2)))];
  if (family === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-multipass', 'fullres', '-spatial-aq', '0', '-temporal-aq', '0',
      '-rc-lookahead', '32', '-bf', '3', '-b_ref_mode', 'middle', ...rate, '-profile:v', 'high'];
  }
  if (family === 'h264_amf') return ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'vbr_peak', '-preanalysis', '1', ...rate, '-bf', '0', '-profile:v', 'high'];
  if (family === 'h264_qsv') return ['-c:v', 'h264_qsv', '-preset', 'veryslow', ...rate, '-bf', '2', '-profile:v', 'high'];
  return ['-c:v', 'libx264', '-preset', 'medium', ...rate, '-bf', '2', '-profile:v', 'high', '-x264-params', 'aq-mode=0:psy-rd=0.0,0.0'];
}

// Squeezes the working file into the finished one. onProgress(0..1). Resolves to '' when done, or FFmpeg's reason.
function finish({ ffmpeg, input, output, plan, family, seconds, onProgress = () => {}, log = () => {} }) {
  return new Promise((resolve) => {
    const fmt = family === 'h264_qsv' ? 'nv12' : 'yuv420p';
    const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y',
      ...(plan.height > 1080 && family !== 'libx264' ? ['-hwaccel', 'auto'] : []),
      '-i', input,
      '-vf', `scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=tv:out_range=tv:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=${fmt}`,
      '-r', String(plan.fps), '-fps_mode', 'cfr',
      ...finalArgs(family, plan),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart', output];
    log(`Recording: finishing with ${family} at ${(plan.bitrate / 1e6).toFixed(0)} Mbps`);
    const p = spawn(ffmpeg, args, { windowsHide: true });
    let err = '', part = '';
    p.stdout.on('data', (d) => {
      const lines = (part + d).split(/\r?\n/);
      part = lines.pop();
      for (const l of lines) {
        const m = l.match(/^out_time_us=(\d+)/);
        if (m && seconds > 0) onProgress(Math.min(1, +m[1] / 1e6 / seconds));
      }
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
    p.on('error', (e) => resolve(e.message || 'could not start FFmpeg'));
    p.on('exit', (code) => resolve(code === 0 ? '' : (err.trim().split('\n').pop() || `FFmpeg stopped (code ${code})`)));
  });
}

// "Phosphor Loop 2026-10-24 11-30-05.mp4" in the folder, never overwriting one that's there
function outputName(dir, date = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())} ${p2(date.getHours())}-${p2(date.getMinutes())}-${p2(date.getSeconds())}`;
  let name = path.join(dir, `Phosphor Loop ${stamp}.mp4`), i = 2;
  while (fs.existsSync(name)) name = path.join(dir, `Phosphor Loop ${stamp} (${i++}).mp4`);
  return name;
}

module.exports = { REC_SIZES, REC_QUALITY, REC_DEFAULTS, recPlan, recGB, finalArgs, finish, outputName };
