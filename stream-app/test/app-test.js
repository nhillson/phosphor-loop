'use strict';
// Full check on the build computer: opens the real app on the live Phosphor Loop site, presses Go live to a
// local stand-in server, lets the page draw a set number of frames, stops, and checks what arrived.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const FF = process.env.FFMPEG || path.join(root, 'vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const FP = FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const outDir = path.join(root, 'test-output');
fs.mkdirSync(outDir, { recursive: true });
const flv = path.join(outDir, 'received.flv');
const ann = (kind, title, text) => { if (process.env.GITHUB_ACTIONS) console.log(`::${kind} title=app ${title}::` + String(text).slice(-3500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')); };
const fail = (m) => { console.error('FAIL: ' + m); ann('error', 'failed', m + '\n' + (typeof logs !== 'undefined' ? logs.join('\n') : '') + (global.extraLog || '')); process.exit(1); };

const server = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-listen', '1', '-f', 'flv', '-i', 'rtmp://127.0.0.1:19370/app/x', '-c', 'copy', '-f', 'flv', flv]);
server.stderr.on('data', (d) => process.stdout.write('server: ' + d));

const app = spawn(electron, [root], {
  env: { ...process.env, PHOSPHOR_TEST: '1', PHOSPHOR_TEST_RTMP: 'rtmp://127.0.0.1:19370/app/test-key-secret',
    PHOSPHOR_TEST_OUT: path.join(outDir, 'result.json'), PHOSPHOR_TEST_SHOTS: outDir, PHOSPHOR_TEST_FRAMES: process.env.FRAMES || '600', FFMPEG: FF },
  stdio: ['ignore', 'pipe', 'pipe'],
});
global.extraLog = '';
for (const st of [app.stdout, app.stderr]) st.on('data', (d) => { process.stdout.write(d); global.extraLog = (global.extraLog + d).slice(-6000); });
app.on('exit', async (code) => {
  await new Promise((r) => { server.on('exit', r); setTimeout(() => { server.kill(); r(); }, 10000); });
  let result = {};
  try { result = JSON.parse(fs.readFileSync(path.join(outDir, 'result.json'), 'utf8')); } catch (_) {}
  console.log('App result:', JSON.stringify(result, null, 2));
  const probe = (args) => { try { return execFileSync(FP, ['-v', 'error', ...args, flv]).toString().trim(); } catch (_) { return ''; } };
  const frames = +probe(['-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0']);
  const info = probe(['-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate', '-of', 'compact']);
  console.log('Received at the test server:', frames, 'frames\n' + info);
  if (code !== 0 || !result.ok) fail('app reported a problem: ' + (result.error || 'exit ' + code));
  if (!(frames > 150)) fail('too few frames reached the server');
  if (!/codec_type=audio/.test(info)) fail('no sound track');
  if (!/width=1280\|height=720/.test(info)) fail('wrong picture size');
  // A frame from the middle, to look at
  try { execFileSync(FF, ['-v', 'error', '-y', '-sseof', '-3', '-i', flv, '-frames:v', '1', path.join(outDir, 'received-frame.png')]); } catch (_) {}
  ann('notice', 'passed', `${frames} frames received\n${info}\n` + JSON.stringify(result));
  console.log('PASS');
  process.exit(0);
});
