'use strict';
// Full check on the build computer: opens the real app on the live Phosphor Loop site, presses Go live to a
// local stand-in server, lets the page draw a set number of frames, stops, and checks what arrived.
// The stand-in server plays Twitch with Enhanced Broadcasting: a stand-in settings service asks for two qualities
// (720p and 360p), and both must arrive in the one connection.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const FF = process.env.FFMPEG || path.join(root, 'vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const FP = FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const outDir = path.join(root, 'test-output');
fs.mkdirSync(outDir, { recursive: true });
const flv = path.join(outDir, 'received.mkv');
const http = require('node:http');
const ann = (kind, title, text) => { if (process.env.GITHUB_ACTIONS) console.log(`::${kind} title=app ${title}::` + String(text).slice(-3500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')); };
const fail = (m) => { console.error('FAIL: ' + m); ann('error', 'failed', m + '\n' + (typeof logs !== 'undefined' ? logs.join('\n') : '') + (global.extraLog || '')); process.exit(1); };

const server = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-listen', '1', '-analyzeduration', '5000000', '-f', 'flv', '-i', 'rtmp://127.0.0.1:19370/app/x',
  '-map', '0', '-c', 'copy', '-f', 'matroska', flv]);
server.stderr.on('data', (d) => process.stdout.write('server: ' + d));

// Stand-in for Twitch's settings service (GetClientConfiguration)
let ebRequest = null;
const config = http.createServer((req, rsp) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    try { ebRequest = JSON.parse(body); ebRequest.authentication = ebRequest.authentication ? '(the key)' : '(none)'; } catch (_) { ebRequest = { unreadable: body.slice(0, 500) }; }
    fs.writeFileSync(path.join(outDir, 'eb-request.json'), JSON.stringify(ebRequest, null, 2));
    rsp.setHeader('Content-Type', 'application/json');
    rsp.end(JSON.stringify({
      meta: { service: 'IVS', schema_version: '2025-01-25', config_id: 'ci-config' }, status: { result: 'success' },
      ingest_endpoints: [{ protocol: 'RTMP', url_template: 'rtmp://127.0.0.1:19370/app/{stream_key}', authentication: 'ci-minted-secret' }],
      encoder_configurations: [
        { type: 'obs_x264', width: 1280, height: 720, framerate: { numerator: 30, denominator: 1 }, settings: { bitrate: 3000, keyint_sec: 2 }, canvas_index: 0 },
        { type: 'obs_x264', width: 640, height: 360, framerate: { numerator: 30, denominator: 1 }, settings: { bitrate: 800, keyint_sec: 2 }, canvas_index: 0 },
      ],
      audio_configurations: { live: [{ codec: 'aac', track_id: 1, channels: 2, settings: { bitrate: 160 } }] },
    }));
  });
}).listen(19375, '127.0.0.1');

const app = spawn(electron, [root], {
  env: { ...process.env, PHOSPHOR_TEST: '1', PHOSPHOR_TEST_RTMP: 'rtmp://127.0.0.1:19370/app/test-key-secret',
    PHOSPHOR_TWITCH_CONFIG_URL: 'http://127.0.0.1:19375/api/v3/GetClientConfiguration',
    PHOSPHOR_TEST_OUT: path.join(outDir, 'result.json'), PHOSPHOR_TEST_SHOTS: outDir, PHOSPHOR_TEST_FRAMES: process.env.FRAMES || '600', FFMPEG: FF },
  stdio: ['ignore', 'pipe', 'pipe'],
});
global.extraLog = '';
// The whole app log is kept too, and published with the other test logs (the Actions log needs a sign-in to read)
const appLog = fs.createWriteStream(path.join(outDir, 'app-log.txt'));
for (const st of [app.stdout, app.stderr]) st.on('data', (d) => { process.stdout.write(d); appLog.write(d); global.extraLog = (global.extraLog + d).slice(-6000); });
app.on('exit', async (code) => {
  await new Promise((r) => appLog.end(r));
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
  // Enhanced Broadcasting: the app asked the stand-in settings service, described this computer, and sent both qualities
  config.close();
  if (!ebRequest) fail('the app never asked the Twitch settings service');
  if (!ebRequest.capabilities || !ebRequest.capabilities.cpu || !ebRequest.preferences || !ebRequest.preferences.canvases) fail('Twitch request incomplete: ' + JSON.stringify(ebRequest).slice(0, 800));
  console.log('Enhanced Broadcasting request: ' + JSON.stringify({ client: ebRequest.client, cpu: ebRequest.capabilities.cpu, gpu: ebRequest.capabilities.gpu, system: ebRequest.capabilities.system, canvases: ebRequest.preferences.canvases }));
  if (!/width=640\|height=360/.test(info)) fail('the second Enhanced Broadcasting quality (640x360) did not arrive');
  if ((info.match(/codec_type=video/g) || []).length !== 2) fail('expected 2 video tracks: ' + info);
  const appText = fs.readFileSync(path.join(outDir, 'app-log.txt'), 'utf8');
  if (/ci-minted-secret|test-key-secret/.test(appText)) fail('a stream key reached the log');
  // A frame from the middle, to look at
  try { execFileSync(FF, ['-v', 'error', '-y', '-sseof', '-3', '-i', flv, '-frames:v', '1', path.join(outDir, 'received-frame.png')]); } catch (_) {}
  ann('notice', 'passed', `${frames} frames received\n${info}\n` + JSON.stringify(result));
  console.log('PASS');
  process.exit(0);
});
