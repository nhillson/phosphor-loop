'use strict';
// Checks several encodes at once (YouTube's big stream next to Kick's smaller one) without Electron. A fake "Phosphor
// Loop recording" goes through one squeezer that makes two encodes: full size in HEVC for the stand-in YouTube
// (enhanced RTMP), and a half-size H.264 copy for the stand-in Kick, which must also stay at a steady pace.
// Waits are counted in frames of the fake recording, never in seconds.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { Streamer } = require('../src/stream.js');

const FF = process.env.FFMPEG || 'ffmpeg';
const FP = FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const FRAMES = +(process.env.FRAMES || 450);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psmulti-'));
const logs = [];
const ann = (kind, title, text) => { if (process.env.GITHUB_ACTIONS) console.log(`::${kind} title=multi ${title}::` + String(text).slice(-3500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')); };
const fail = (m) => { console.error('FAIL: ' + m); console.log(logs.slice(-60).join('\n')); ann('error', 'failed', m + '\n' + logs.slice(-40).join('\n')); process.exit(1); };

function listener(port, out) {
  const p = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-listen', '1', '-f', 'flv', '-i', `rtmp://127.0.0.1:${port}/live2/x`, '-c', 'copy', '-f', 'flv', out]);
  p.stderr.on('data', (d) => logs.push(`listener ${port}: ${d}`));
  return p;
}
const probe = (file, args) => { try { return execFileSync(FP, ['-v', 'error', ...args, file]).toString().trim(); } catch (_) { return ''; } };
const arrivals = [];
function meter(listenPort, targetPort) {
  return net.createServer((client) => {
    const up = net.connect(targetPort, '127.0.0.1');
    client.on('data', (d) => { arrivals.push([Date.now(), d.length]); up.write(d); });
    up.on('data', (d) => client.write(d));
    const end = () => { client.destroy(); up.destroy(); };
    client.on('close', end); up.on('close', end); client.on('error', end); up.on('error', end);
  }).listen(listenPort, '127.0.0.1');
}
function worstWindowMbps(windowMs) {
  let worst = 0, j = 0, sum = 0;
  for (let i = 0; i < arrivals.length; i++) {
    sum += arrivals[i][1];
    while (arrivals[i][0] - arrivals[j][0] > windowMs) { sum -= arrivals[j][1]; j++; }
    if (arrivals[i][0] - arrivals[0][0] >= windowMs) worst = Math.max(worst, sum * 8 / (windowMs / 1000) / 1e6);
  }
  return worst;
}

(async () => {
  const A = path.join(dir, 'youtube.flv'), B = path.join(dir, 'kick.flv');
  const la = listener(19362, A), lb = listener(19361, B);
  const proxy = meter(19360, 19361);
  const s = new Streamer({ ffmpeg: FF, log: (m) => logs.push(m) });
  await s.probe();
  // HEVC on whatever this computer has (graphics card or processor)
  const hevc = await s.probeHevc({ width: 640, height: 360 });
  console.log('Encoder:', s.encoder.variant, '| HEVC:', hevc);
  if (!hevc) fail('no HEVC encoder found');
  await new Promise((r) => setTimeout(r, 300)); // let the stand-in servers open their ports (setup, not a picture wait)
  const keyY = 'yt-secretKEY-1234', keyK = 'sk_us-west-2_secretKICK';
  const plan = { fps: 30, input: { width: 640, height: 360 }, encodes: [
    { width: 640, height: 360, bitrate: 3000000, variant: hevc },
    { width: 320, height: 180, bitrate: 1000000, variant: 'x264-veryfast' },
  ] };
  const statuses = [];
  s.on('status', (st) => statuses.push(JSON.stringify(st)));
  s.start([
    { id: 'youtube', name: 'YouTube', url: `rtmp://127.0.0.1:19362/live2/${keyY}`, secret: keyY, stream: 0 },
    { id: 'kick', name: 'Kick', url: `rtmp://127.0.0.1:19360/live2/${keyK}`, secret: keyK, stream: 1 },
  ], plan);
  let gen = s.gen;
  s.on('capture', (g) => { gen = g; });
  const src = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-progress', 'pipe:2', '-re', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-frames:v', String(FRAMES),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'libopus', '-f', 'matroska', 'pipe:1']);
  src.stdout.on('data', (d) => s.write(gen, d));
  await new Promise((r) => src.on('exit', r));
  const worst = worstWindowMbps(5000);
  proxy.close();
  s.stop();
  await Promise.all([la, lb].map((p) => new Promise((r) => { p.on('exit', r); setTimeout(() => { p.kill(); r(); }, 8000); })));

  const info = (f) => probe(f, ['-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'compact']);
  const count = (f) => +probe(f, ['-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0']);
  const ia = info(A), ib = info(B), fa = count(A), fb = count(B);
  console.log('YouTube got:', fa, 'frames |', ia.replace(/\n/g, ' ; '));
  console.log('Kick got:', fb, 'frames |', ib.replace(/\n/g, ' ; '));
  console.log(`Kick's fastest 5-second stretch: ${worst.toFixed(2)} Mbps (its stream is 1.16 Mbps)`);
  const all = logs.join('\n') + statuses.join('\n');
  if (all.includes(keyY) || all.includes(keyK)) fail('a stream key showed up in the log or status');
  if (!/codec_name=hevc\|codec_type=video\|width=640\|height=360/.test(ia)) fail('YouTube did not get 640x360 HEVC');
  if (!/codec_name=h264\|codec_type=video\|width=320\|height=180/.test(ib)) fail('Kick did not get 320x180 H.264');
  if (!/codec_type=audio/.test(ia) || !/codec_type=audio/.test(ib)) fail('sound missing');
  if (fa < FRAMES * 0.85 || fb < FRAMES * 0.85) fail('too few frames arrived');
  if (worst > 1.16 * 1.3) fail(`Kick got a burst: ${worst.toFixed(2)} Mbps over 5 s`);
  ann('notice', 'passed', `HEVC ${hevc}: YouTube ${fa} frames, Kick ${fb} frames, Kick peak ${worst.toFixed(2)} Mbps`);
  console.log('PASS');
  process.exit(0);
})().catch((e) => fail(e.stack));
