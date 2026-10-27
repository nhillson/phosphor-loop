'use strict';
// Twitch Enhanced Broadcasting, without Electron and without a real Twitch account:
//  1. the request to Twitch's settings service, and reading its answers (good, error, warning, garbage, no answer);
//  2. this computer's description (from a sample of what Windows reports);
//  3. end to end: a stand-in settings service asks for three qualities (two H.264, one HEVC, one of them at a lower
//     frame rate); the engine makes them and sends them in ONE multitrack connection to a stand-in server, which must
//     receive all three tracks with the right sizes and codecs (needs FFmpeg 7.1 or newer);
//  4. falling back: a multitrack stream that keeps being turned down switches to a normal single stream by itself;
//  5. (on the build computer only, never fails) what the real Twitch service says to a made-up key, to show the
//     request's shape is accepted.
// Waits are counted in frames of the fake recording, never in seconds.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const EB = require('../src/twitch-eb.js');
const { Streamer, VARIANTS } = require('../src/stream.js');

const FF = process.env.FFMPEG || 'ffmpeg';
const FP = FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const FRAMES = +(process.env.FRAMES || 900);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pseb-'));
const logs = [];
const appLogs = []; // what the app itself would write to its log (the stand-in servers' own messages are kept apart)
const ann = (kind, title, text) => { if (process.env.GITHUB_ACTIONS) console.log(`::${kind} title=twitch-eb ${title}::` + String(text).slice(-3500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')); };
const fail = (m) => { console.error('FAIL: ' + m); console.log(logs.slice(-60).join('\n')); ann('error', 'failed', m + '\n' + logs.slice(-40).join('\n')); process.exit(1); };
const ok = (m) => console.log('ok  ' + m);

// A sample answer, shaped like Twitch's (OBS's GoLiveApi::Config)
const CONFIG = {
  meta: { service: 'IVS', schema_version: '2025-01-25', config_id: 'cfg-1234' },
  status: { result: 'success', html_en_us: null },
  ingest_endpoints: [
    { protocol: 'RTMPS', url_template: 'rtmps://127.0.0.1:443/app/{stream_key}', authentication: 'live_minted_SECRET?x=1' },
    { protocol: 'RTMP', url_template: 'rtmp://127.0.0.1:19371/app/{stream_key}', authentication: 'live_minted_SECRET?x=1' },
  ],
  encoder_configurations: [
    { type: 'obs_x264', width: 640, height: 360, framerate: { numerator: 30, denominator: 1 }, settings: { bitrate: 1200, keyint_sec: 2, rate_control: 'CBR', profile: 'high' }, canvas_index: 0 },
    { type: 'obs_nvenc_hevc_tex', width: 480, height: 270, framerate: { numerator: 15, denominator: 1 }, settings: { bitrate: 600, keyint_sec: 2, rate_control: 'CBR', profile: 'main' }, canvas_index: 0 },
    { type: 'jim_nvenc', width: 320, height: 180, framerate: { numerator: 30, denominator: 1 }, settings: { bitrate: 300, keyint_sec: 2 }, canvas_index: 0 },
    { type: 'obs_x264', width: 360, height: 640, framerate: { numerator: 30, denominator: 1 }, settings: { bitrate: 900 }, canvas_index: 1 }, // vertical: not ours
  ],
  audio_configurations: { live: [{ codec: 'aac', track_id: 1, channels: 2, settings: { bitrate: 160 } }] },
};

function server(handler) {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => handler(req, rsp, body));
    }).listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}/GetClientConfiguration` }));
  });
}

async function unit() {
  // codec names Twitch uses for OBS's encoders
  assert.equal(EB.codecOf('obs_nvenc_hevc_tex'), 'hevc');
  assert.equal(EB.codecOf('jim_hevc_nvenc'), 'hevc');
  assert.equal(EB.codecOf('h265_texture_amf'), 'hevc');
  assert.equal(EB.codecOf('jim_av1_nvenc'), 'av1');
  assert.equal(EB.codecOf('obs_qsv11'), 'h264');
  assert.equal(EB.codecOf('obs_x264'), 'h264');
  assert.equal(EB.codecOf('jim_nvenc'), 'h264');
  ok('encoder types → codecs');

  // the picture Twitch is told about: at most 1440p, scaled from a bigger one
  assert.deepEqual(EB.canvasFor({ width: 3840, height: 2160 }, 30), { width: 2560, height: 1440, canvas_width: 3840, canvas_height: 2160, framerate: { numerator: 30, denominator: 1 } });
  assert.deepEqual(EB.canvasFor({ width: 1920, height: 1080 }, 60).height, 1080);
  ok('canvas');

  // the request has every field OBS's PostData has
  const machine = EB.describe(null, [{ vendorId: 0x10de, deviceId: 0x2484, driverVersion: '32.0.15.6094', deviceString: 'NVIDIA GeForce RTX 3070', active: true }]);
  const post = EB.buildPost({ key: 'live_1_abc', version: '1.9.0', codecs: ['h264', 'h265', 'h264'], canvas: EB.canvasFor({ width: 2560, height: 1440 }, 30), machine });
  for (const k of ['service', 'schema_version', 'authentication', 'client', 'capabilities', 'preferences']) assert.ok(k in post, k);
  assert.deepEqual(post.client.supported_codecs, ['h264', 'h265']);
  for (const k of ['cpu', 'memory', 'system', 'gpu']) assert.ok(k in post.capabilities, k);
  for (const k of ['physical_cores', 'logical_cores']) assert.ok(Number.isInteger(post.capabilities.cpu[k]), k);
  for (const k of ['version', 'name', 'build', 'release', 'revision', 'bits', 'arm', 'armEmulation']) assert.ok(k in post.capabilities.system, k);
  for (const k of ['vod_track_audio', 'audio_samples_per_sec', 'audio_channels', 'audio_max_buffering_ms', 'audio_fixed_buffering', 'canvases']) assert.ok(k in post.preferences, k);
  assert.equal(post.capabilities.gpu[0].vendor_id, 0x10de);
  ok('request shape');

  // what Windows reports → Twitch's graphics card list (Microsoft's basic driver left out; real memory size from the registry)
  const win = {
    gpus: [{ name: 'Microsoft Basic Display Adapter', pnp: 'ROOT\\BasicDisplay\\0000', driver: '10.0', ram: 0 },
      { name: 'NVIDIA GeForce RTX 3070', pnp: 'PCI\\VEN_10DE&DEV_2484&SUBSYS_146B10DE&REV_A1\\4&1', driver: '32.0.15.6094', ram: 4293918720 }],
    reg: [{ desc: 'NVIDIA GeForce RTX 3070', id: 'pci\\ven_10de&dev_2484', mem: 8589934592 }],
    cpu: { Name: 'AMD Ryzen 7 5800X 8-Core Processor', NumberOfCores: 8, NumberOfLogicalProcessors: 16, MaxClockSpeed: 3801 },
    ver: { CurrentBuildNumber: '22631', DisplayVersion: '23H2', UBR: 4317, CurrentMajorVersionNumber: 10, CurrentMinorVersionNumber: 0 },
  };
  const d = EB.describe(win, []);
  assert.equal(d.gpu.length, 1);
  assert.deepEqual([d.gpu[0].model, d.gpu[0].vendor_id, d.gpu[0].device_id, d.gpu[0].dedicated_video_memory, d.gpu[0].driver_version],
    ['NVIDIA GeForce RTX 3070', 0x10de, 0x2484, 8589934592, '32.0.15.6094']);
  assert.deepEqual([d.cpu.physical_cores, d.cpu.logical_cores, d.cpu.speed], [8, 16, 3801]);
  assert.deepEqual([d.system.version, d.system.build, d.system.release, d.system.revision], ['10.0', 22631, '23H2', '4317']);
  ok('machine description');

  // reading the answer: our qualities only (not the vertical canvas), clamped to the picture, Twitch's order kept
  const t = EB.tracksFrom(CONFIG, { input: { width: 640, height: 360 }, fps: 30 });
  assert.deepEqual(t.map((x) => [x.codec, x.width, x.height, x.fps, x.bitrate, x.gop]),
    [['h264', 640, 360, 30, 1200000, 2], ['hevc', 480, 270, 15, 600000, 2], ['h264', 320, 180, 30, 300000, 2]]);
  const big = EB.tracksFrom({ encoder_configurations: [{ type: 'x', width: 1920, height: 1080, framerate: { numerator: 60, denominator: 1 }, settings: { bitrate: 6000 } }] }, { input: { width: 1280, height: 720 }, fps: 30 });
  assert.deepEqual([big[0].width, big[0].height, big[0].fps], [1280, 720, 30]);
  ok('tracks from the answer');

  // where to send: Twitch's server, its minted key, our key's own query items, and the config id
  const u = EB.ingestUrl(CONFIG, 'live_1_abc?bandwidthtest=true');
  assert.equal(u.url, 'rtmp://127.0.0.1:19371/app/live_minted_SECRET?x=1&bandwidthtest=true&clientConfigId=cfg-1234');
  assert.ok(u.secrets.includes('live_minted_SECRET') && u.secrets.includes('live_1_abc'));
  const u2 = EB.ingestUrl({ ...CONFIG, ingest_endpoints: [{ protocol: 'RTMP', url_template: 'rtmp://x.contribute.live-video.net/app/{stream_key}' }] }, 'live_1_abc');
  assert.equal(u2.url, 'rtmp://x.contribute.live-video.net/app/live_1_abc?clientConfigId=cfg-1234');
  ok('ingest address');

  assert.equal(EB.plain('<p>Your <b>GPU</b>&nbsp;is &amp; too old.<br>Update.</p>'), 'Your GPU is & too old. Update.');

  // the settings service: success, error, warning without settings, unreadable, no answer in time
  let seen = null, mode = 'good';
  const { srv, url } = await server((req, rsp, body) => {
    seen = { method: req.method, type: req.headers['content-type'], body: JSON.parse(body) };
    if (mode === 'slow') return; // never answers
    rsp.setHeader('Content-Type', 'application/json');
    if (mode === 'good') return rsp.end(JSON.stringify(CONFIG));
    if (mode === 'error') return rsp.end(JSON.stringify({ meta: {}, status: { result: 'error', html_en_us: '<p>Invalid <b>stream key</b>.</p>' } }));
    if (mode === 'warn') return rsp.end(JSON.stringify({ meta: {}, status: { result: 'warning', html_en_us: 'Your GPU is not supported.' }, encoder_configurations: [] }));
    rsp.statusCode = 502; rsp.end('<html>Bad gateway</html>');
  });
  const r = await EB.requestConfig(post, { url });
  assert.equal(seen.method, 'POST'); assert.equal(seen.type, 'application/json'); assert.equal(seen.body.authentication, 'live_1_abc');
  assert.equal(r.config.meta.config_id, 'cfg-1234'); assert.equal(r.warning, '');
  for (const [m, want, kind] of [['error', 'Invalid stream key.', 'error'], ['warn', 'Your GPU is not supported.', 'warning'], ['junk', '502', 'error']]) {
    mode = m;
    await assert.rejects(EB.requestConfig(post, { url }), (e) => e instanceof EB.TwitchError && e.message.includes(want) && e.kind === kind, m);
  }
  mode = 'slow';
  await assert.rejects(EB.requestConfig(post, { url, timeoutMs: 800 }), (e) => /in time/.test(e.message));
  srv.closeAllConnections(); srv.close();
  ok('settings service answers');
  return { url };
}

function ffVersion() {
  try {
    const v = execFileSync(FF, ['-hide_banner', '-version']).toString().split('\n')[0];
    const m = v.match(/version n?(\d+)\.(\d+)/);
    return { line: v, major: m ? +m[1] : 99, minor: m ? +m[2] : 0 }; // master builds ("N-12345-g…") are new enough
  } catch (e) { return { line: 'none', major: 0, minor: 0 }; }
}
function listener(port, out, name) {
  const p = spawn(FF, ['-hide_banner', '-loglevel', 'warning', '-y', '-listen', '1', '-analyzeduration', '5000000', '-probesize', '20000000', '-f', 'flv', '-i', `rtmp://127.0.0.1:${port}/app/x`,
    '-map', '0', '-c', 'copy', '-f', 'matroska', out]);
  p.stderr.on('data', (d) => logs.push(`${name}: ${String(d).trim()}`));
  return p;
}
const streamsOf = (file) => {
  try {
    return JSON.parse(execFileSync(FP, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate', '-of', 'json', file]).toString()).streams || [];
  } catch (_) { return []; }
};
function fakeRecording(s, getGen, frames) {
  const src = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'libopus', '-f', 'matroska', 'pipe:1']);
  src.stdout.on('data', (d) => s.write(getGen(), d));
  return new Promise((r) => src.on('exit', r));
}
const stopAll = (procs) => Promise.all(procs.map((p) => new Promise((r) => { if (p.exitCode != null) return r(); p.on('exit', r); setTimeout(() => { p.kill(); r(); }, 10000); })));

async function endToEnd() {
  const v = ffVersion();
  console.log('FFmpeg:', v.line);
  if (v.major < 7 || (v.major === 7 && v.minor < 1)) {
    console.log('skip: multitrack FLV needs FFmpeg 7.1 or newer (the build computer has it)');
    if (process.env.GITHUB_ACTIONS) fail('the build computer\'s FFmpeg is too old for multitrack: ' + v.line);
    return;
  }
  const s = new Streamer({ ffmpeg: FF, log: (m) => { logs.push(m); appLogs.push(m); } });
  await s.probe();
  const hevc = await s.probeHevc({ width: 480, height: 270 });
  if (!hevc) fail('no HEVC encoder for the test');
  const tracks = EB.tracksFrom(CONFIG, { input: { width: 640, height: 360 }, fps: 30 });
  const variantFor = { h264: s.encoder.variant, hevc };
  const plan = { fps: 30, input: { width: 640, height: 360 }, calm: false,
    encodes: tracks.map((t) => ({ width: t.width, height: t.height, bitrate: t.bitrate, fps: t.fps < 30 ? t.fps : undefined, variant: variantFor[t.codec] })) };
  const problem = await s.tryPlan(plan);
  if (problem) fail('tryPlan: ' + problem);
  ok('all three encodes can be made at once');

  // 3. one multitrack connection with all three tracks
  const A = path.join(dir, 'multitrack.mkv');
  const la = listener(19371, A, 'multitrack server');
  await new Promise((r) => setTimeout(r, 400)); // let the stand-in server open its port (setup, not a picture wait)
  const { url, secrets } = EB.ingestUrl(CONFIG, 'live_1_userKEY');
  let gen = 0;
  s.on('capture', (g) => { gen = g; });
  s.start([{ id: 'twitch', name: 'Twitch', url, secret: 'live_1_userKEY', secrets, multitrack: true, streams: [0, 1, 2], stream: 0, note: 'Enhanced: test' }], plan);
  gen = s.gen;
  await fakeRecording(s, () => gen, Math.round(FRAMES / 2));
  const st = s.status();
  s.stop();
  await stopAll([la]);
  const got = streamsOf(A);
  logs.push('multitrack received: ' + JSON.stringify(got));
  const video = got.filter((x) => x.codec_type === 'video');
  if (video.length !== 3) fail(`the server got ${video.length} video tracks, not 3: ${JSON.stringify(got)}`);
  const want = [['h264', 640, 360], ['hevc', 480, 270], ['h264', 320, 180]];
  for (const w of want) if (!video.some((x) => x.codec_name === w[0] && x.width === w[1] && x.height === w[2])) fail(`no ${w.join(' ')} track: ${JSON.stringify(video)}`);
  const slow = video.find((x) => x.width === 480);
  const [rn, rd] = String((slow && slow.avg_frame_rate) || '0/1').split('/').map(Number);
  const rate = rd ? rn / rd : 0; // "15/1"
  if (rate && Math.abs(rate - 15) > 1) fail('the 15 fps track arrived at ' + slow.avg_frame_rate);
  if (!got.some((x) => x.codec_type === 'audio' && x.codec_name === 'aac')) fail('no AAC sound on the multitrack stream');
  if (!st.destinations.twitch || st.destinations.twitch.note !== 'Enhanced: test') fail('status has no Enhanced Broadcasting note: ' + JSON.stringify(st));
  const leak = appLogs.find((l) => /live_minted_SECRET|live_1_userKEY/.test(l));
  if (leak) fail('a stream key reached the log: ' + leak.slice(0, 200));
  ok(`multitrack: ${video.map((x) => `${x.codec_name} ${x.width}x${x.height} ${x.avg_frame_rate}`).join(', ')} + aac`);

  // 4. turned down three times in a row → a normal stream from the H.264 track, by itself
  const B = path.join(dir, 'fallback.mkv');
  const lb = listener(19372, B, 'normal server');
  await new Promise((r) => setTimeout(r, 400));
  const s2 = new Streamer({ ffmpeg: FF, log: (m) => { logs.push(m); appLogs.push(m); } });
  s2.encoder = s.encoder;
  let failed = 0, gen2 = 0;
  s2.on('multitrack-failed', () => { failed++; });
  s2.on('capture', (g) => { gen2 = g; });
  s2.start([{ id: 'twitch', name: 'Twitch', url: 'rtmp://127.0.0.1:19379/app/nobody-listens', secret: 'k', multitrack: true, streams: [0, 1, 2], stream: 0,
    fallback: { url: 'rtmp://127.0.0.1:19372/app/live_1_userKEY', stream: 0, label: '360p H.264', note: 'Normal stream' } }], plan);
  gen2 = s2.gen;
  // long enough for three refusals (2 s and 5 s apart) and then a stretch of normal streaming
  await fakeRecording(s2, () => gen2, FRAMES);
  const st2 = s2.status();
  s2.stop();
  await stopAll([lb]);
  if (failed !== 1) fail(`multitrack-failed was reported ${failed} times`);
  const got2 = streamsOf(B).filter((x) => x.codec_type === 'video');
  if (got2.length !== 1 || got2[0].codec_name !== 'h264' || got2[0].height !== 360) fail('fallback stream wrong: ' + JSON.stringify(got2));
  if (!st2.destinations.twitch || st2.destinations.twitch.note !== 'Normal stream') fail('fallback note missing: ' + JSON.stringify(st2));
  ok('falls back to a normal stream by itself');
}

// 5. The real Twitch service with a made-up key: shows whether Twitch reads our request (never fails the build)
async function realTwitch() {
  if (!process.env.GITHUB_ACTIONS || process.env.SKIP_REAL_TWITCH) return;
  try {
    const machine = await EB.systemInfo([]);
    const post = EB.buildPost({ key: 'live_000000000_notARealKeyFromPhosphorStreamCI', version: 'ci', codecs: ['h264', 'h265'],
      canvas: EB.canvasFor({ width: 2560, height: 1440 }, 30), machine });
    const res = await fetch(EB.CONFIG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post) });
    const text = await res.text();
    const line = `HTTP ${res.status}: ${text.slice(0, 1500)}`;
    console.log('Real Twitch answer to a made-up key: ' + line);
    console.log('(sent the graphics cards: ' + JSON.stringify(machine.gpu) + ')');
    ann('notice', 'real Twitch answer', line);
  } catch (e) { console.log('Real Twitch not reachable: ' + e.message); }
}

(async () => {
  await unit();
  await endToEnd();
  await realTwitch();
  console.log('PASS');
  process.exit(0);
})().catch((e) => fail(e.stack || e.message));
