'use strict';
// Checks the streaming engine without Electron: a fake "Phosphor Loop recording" (FFmpeg test picture and tone)
// goes through the squeezer and two senders into two local stand-in servers. Waits are counted in frames of
// the fake recording, never in seconds. The second server only opens once 330 frames have been sent, so the
// "reconnect by itself" path is exercised too.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Streamer, buildUrl } = require('../src/stream.js');

const FF = process.env.FFMPEG || 'ffmpeg';
const FRAMES = +(process.env.FRAMES || 360);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pstest-'));
const logs = [];
const ann = (kind, title, text) => { if (process.env.GITHUB_ACTIONS) console.log(`::${kind} title=engine ${title}::` + String(text).slice(-3500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')); };
const fail = (m) => { console.error('FAIL: ' + m); ann('error', 'failed', m + '\n' + (typeof logs !== 'undefined' ? logs.join('\n') : '') + (global.extraLog || '')); process.exit(1); };

function listener(port, out) {
  const p = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-listen', '1', '-f', 'flv', '-i', `rtmp://127.0.0.1:${port}/app/x`, '-c', 'copy', '-f', 'flv', out]);
  p.stderr.on('data', (d) => logs.push(`listener ${port}: ${d}`));
  return p;
}
function countFrames(file) {
  try {
    return +execFileSync(FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'), ['-v', 'error', '-count_packets', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]).toString().trim();
  } catch (_) { return 0; }
}
function hasAudio(file) {
  try { return /audio/.test(execFileSync(FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).toString()); } catch (_) { return false; }
}

(async () => {
  const keyA = 'live_secretKEYaaaa', keyB = 'sk_us-west-2_secretKEYbbbb';
  const A = path.join(dir, 'a.flv'), B = path.join(dir, 'b.flv');
  const la = listener(19350, A);
  let lb = null;
  const s = new Streamer({ ffmpeg: FF, log: (m) => logs.push(m) });
  await s.probe();
  console.log('Encoder picked:', s.encoder.id);
  const statuses = [];
  s.on('status', (st) => statuses.push(JSON.stringify(st)));
  const urlA = 'rtmp://127.0.0.1:19350/app/' + keyA;
  const urlB = buildUrl('custom', { server: 'rtmp://127.0.0.1:19351/app', key: keyB });
  // check address building
  const kick = buildUrl('kick', { server: 'rtmps://fa723fc1b171.global-contribute.live-video.net', key: 'sk_1' });
  if (kick !== 'rtmps://fa723fc1b171.global-contribute.live-video.net:443/app/sk_1') fail('Kick address: ' + kick);
  if (buildUrl('kick', { server: 'rtmps://h.example:443/app/', key: 'k' }) !== 'rtmps://h.example:443/app/k') fail('Kick address with /app');
  if (buildUrl('twitch', { key: ' live_1 ' }) !== 'rtmp://live.twitch.tv/app/live_1') fail('Twitch address');

  await new Promise((r) => setTimeout(r, 300)); // let the first stand-in server open its port (setup, not a picture wait)
  s.start([{ id: 'a', name: 'Twitch', url: urlA, secret: keyA }, { id: 'b', name: 'Kick', url: urlB, secret: keyB }], { fps: 30, bitrate: 2500000 });

  // The fake recording: what MediaRecorder hands over inside the app (Matroska, H.264 + Opus), in real time
  let gen = s.gen;
  s.on('capture', (g) => { gen = g; });
  const src = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-progress', 'pipe:2', '-re', '-f', 'lavfi', '-i', `testsrc2=s=${process.env.SIZE || "640x360"}:r=30`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-frames:v', String(FRAMES),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'libopus', '-f', 'matroska', 'pipe:1']);
  src.stdout.on('data', (d) => s.write(gen, d));
  let frame = 0;
  src.stderr.on('data', (d) => {
    const m = String(d).match(/frame=(\d+)/g);
    if (m) frame = +m[m.length - 1].slice(6);
    if (!lb && frame >= 330) { lb = listener(19351, B); logs.push('second server opened at frame ' + frame); }
  });
  await new Promise((r) => src.on('exit', r));
  console.log('Fake recording sent', frame, 'frames');
  s.stop();
  await Promise.all([la, lb].filter(Boolean).map((p) => new Promise((r) => { p.on('exit', r); setTimeout(() => { p.kill(); r(); }, 8000); })));

  const fa = countFrames(A), fb = countFrames(B);
  console.log('Frames received: first server', fa, '| second server (opened late)', fb);
  const all = logs.join('\n') + statuses.join('\n');
  if (all.includes(keyA) || all.includes(keyB)) fail('a stream key showed up in the log or status');
  if (fa < FRAMES * 0.85) { console.log(logs.join('\n')); fail('first server got too few frames'); }
  if (!hasAudio(A)) fail('no sound on first server');
  if (!(fb > 30)) { console.log(logs.join('\n')); fail('second server never recovered'); }
  if (!statuses.some((x) => /"b":\{"state":"retrying"/.test(x))) fail('second destination never showed as retrying');
  if (!statuses.some((x) => /"b":\{"state":"live"/.test(x))) fail('second destination never showed as live');
  console.log('Sample retry message:', (statuses.map((x) => JSON.parse(x).destinations.b).find((d) => d && d.state === 'retrying') || {}).message);
  ann('notice', 'passed', `encoder ${s.encoder.id}; first ${fa} frames, second ${fb} frames`);
  console.log('PASS');
  process.exit(0);
})().catch((e) => fail(e.stack));
