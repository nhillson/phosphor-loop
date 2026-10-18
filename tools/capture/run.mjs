import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {once} from 'node:events';
import {createCaptureServer, ffmpegArgs} from './pipeline.mjs';
import {startCapture} from './browser.mjs';

const {values} = parseArgs({options: {
  output: {type: 'string'}, seconds: {type: 'string'}, width: {type: 'string', default: '1920'},
  height: {type: 'string', default: '1080'}, fps: {type: 'string', default: '60'},
  bitrate: {type: 'string', default: '8000000'}, device: {type: 'string', default: 'BlackHole 2ch'},
  'capture-bitrate': {type:'string'}, 'render-height': {type:'string'},
  'capture-codec': {type:'string',default:'h264'},
  preset: {type:'string',default:'fast'},
  'encoder-latency': {type:'string',default:'quality'},
  rtmp: {type: 'boolean'}, autopilot: {type: 'boolean'}, help: {type: 'boolean'},
  renderer: {type: 'string', default: 'gpu'}, headed: {type: 'boolean'}, headless: {type:'boolean'},
  live: {type:'boolean'}, port: {type:'string',default:'8787'},
}});
if (values.help) {
  console.log('npm run stream -- [--port 8787] [--autopilot]\nnpm run capture -- [--output captures/show.mp4] [--seconds 10]\n  [--width 1920 --height 1080 --fps 60 --bitrate 8000000]\n  [--device "BlackHole 2ch"] [--renderer gpu|software] [--headed | --headless]\n  [--live | --rtmp (uses PHOSPHOR_RTMP_URL)]\nStop with Ctrl+C. GPU rendering is the default; software is an optional fallback.\nCHROME_PATH and FFMPEG_PATH optionally override executables.');
  process.exit(0);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const config = {device: values.device, autopilot: values.autopilot, maxQueueBytes: 16 * 1024 * 1024};
if (!['ultrafast','superfast','veryfast','faster','fast','medium','slow'].includes(values.preset)) throw new Error('Invalid --preset.');
config.preset = values.preset;
config.encoderLatency = values['encoder-latency'];
if (!['quality','realtime'].includes(config.encoderLatency)) throw new Error('--encoder-latency must be quality or realtime.');
config.captureCodec = values['capture-codec'];
if (!['h264','vp8'].includes(config.captureCodec)) throw new Error('--capture-codec must be h264 or vp8.');
config.captureBitrate = Number(values['capture-bitrate'] || (config.captureCodec === 'h264' ? values.bitrate : '24000000'));
if (!Number.isInteger(config.captureBitrate) || config.captureBitrate < 1000000 || config.captureBitrate > 100000000) throw new Error('--capture-bitrate must be between 1000000 and 100000000.');
if (!['software','gpu'].includes(values.renderer)) throw new Error('--renderer must be software or gpu.');
for (const [key, low, high] of [['width', 160, 3840], ['height', 120, 2160], ['fps', 1, 60], ['bitrate', 100000, 50000000]]) {
  config[key] = Number(values[key]);
  if (!Number.isInteger(config[key]) || config[key] < low || config[key] > high || (['width', 'height'].includes(key) && config[key] % 2)) throw new Error(`Invalid ${key}. Dimensions must be even.`);
}
if (values.seconds !== undefined && (!Number.isFinite(+values.seconds) || +values.seconds <= 0)) throw new Error('--seconds must be positive.');
config.renderHeight = Number(values['render-height'] || config.height);
if (!Number.isInteger(config.renderHeight) || config.renderHeight < 120 || config.renderHeight > 2160 || config.renderHeight % 2) throw new Error('--render-height must be an even number between 120 and 2160.');
if ([!!values.rtmp,!!values.live,!!values.output].filter(Boolean).length > 1) throw new Error('Choose one of --live, --rtmp, or --output.');
if (values.live) {
  const parent = resolve(root,'.capture-state'); await mkdir(parent,{recursive:true});
  config.liveDir = await mkdtemp(resolve(parent,'live-'));
  config.port = Number(values.port);
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('--port must be between 1024 and 65535.');
} else if (values.rtmp) {
  config.rtmp = process.env.PHOSPHOR_RTMP_URL;
  if (!/^rtmps?:\/\//.test(config.rtmp || '')) throw new Error('Set PHOSPHOR_RTMP_URL to the complete RTMP destination.');
  if (values.output) throw new Error('Choose either --output or --rtmp.');
} else {
  config.output = resolve(root, values.output || `captures/phosphor-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`);
  if (!/\.(mp4|mkv)$/i.test(config.output)) throw new Error('Output must end in .mp4 or .mkv.');
  await mkdir(dirname(config.output), {recursive: true});
}
let browser, page, server, encoder, encoderDone, timer, monitor;
const encodedStats = {frames:0,duplicates:0,dropped:0,timeUs:0};
let stopping = false, resolveStop;
const stopRequested = new Promise(resolve => { resolveStop = resolve; });
const requestStop = () => resolveStop();
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);
const streamKey = config.rtmp ? new URL(config.rtmp).pathname.split('/').filter(Boolean).at(-1) : '';
const redact = text => {
  if (!config.rtmp) return text;
  const safe = text.split(config.rtmp).join('[RTMP destination]');
  return streamKey ? safe.split(streamKey).join('[stream key]') : safe;
};
try {
  encoder = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ffmpegArgs(config), {stdio: ['pipe', 'pipe', 'pipe']});
  let progressBuffer = '', confirmed = false;
  encoder.stdout.on('data', data => {
    progressBuffer += data.toString();
    let end;
    while ((end = progressBuffer.indexOf('\n')) >= 0) {
      const line = progressBuffer.slice(0,end).trim(); progressBuffer = progressBuffer.slice(end+1);
      const [key,value] = line.split('=');
      if (key === 'frame') encodedStats.frames = Number(value);
      if (key === 'dup_frames') encodedStats.duplicates = Number(value);
      if (key === 'drop_frames') encodedStats.dropped = Number(value);
      if (key === 'out_time_us') encodedStats.timeUs = Number(value);
      if (config.rtmp && !confirmed && /^frame=\s*[1-9]\d*$/.test(line)) {
        confirmed = true;
        console.log('RTMP connection active: encoded video and audio are being sent.');
      }
    }
  });
  let encoderError;
  encoderDone = new Promise(resolve => {
    encoder.on('error', error => { encoderError = error.message; requestStop(); resolve(-1); });
    encoder.on('close', code => { if (!stopping) requestStop(); resolve(code); });
  });
  encoder.stderr.on('data', data => process.stderr.write(redact(data.toString())));
  const pipeline = createCaptureServer({root, input: encoder.stdin, liveDir:config.liveDir});
  server = pipeline.server;
  server.listen(config.port || 0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: values.headless || !values.headed,
    handleSIGINT:false, handleSIGTERM:false, handleSIGHUP:false,
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      ...(values.renderer === 'software' ? ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] : [])],
  });
  browser.on('disconnected', requestStop);
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
  await context.grantPermissions(['microphone'], {origin});
  await context.addInitScript(c => { window.__phosphorCaptureConfig = c; }, {width: config.width, height: config.height, renderHeight:config.renderHeight, fps:config.fps});
  page = await context.newPage();
  page.on('pageerror', error => { console.error(redact(error.message)); process.exitCode = 1; requestStop(); });
  page.on('close', requestStop);
  await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 20000});
  await page.waitForFunction(() => window.__phosphorCapture, null, {timeout: 10000});
  const result = await page.evaluate(startCapture, {...config, rtmp: undefined, output: undefined, liveDir:undefined, token: pipeline.token});
  await page.evaluate(({streaming,height,fps}) => {
    document.title = `${streaming ? 'STREAM CONTROLS' : 'RECORDING CONTROLS'} · Phosphor Loop`;
    const indicator = document.querySelector('header .lines');
    if (indicator) {
      indicator.textContent = `${streaming ? 'STREAM OUTPUT' : 'RECORDING OUTPUT'} · ${height}p${fps}`;
      indicator.title = 'These controls change the captured output. Only the picture and audio are captured.';
    }
  }, {streaming:!!(config.liveDir || config.rtmp),height:config.height,fps:config.fps});
  console.log(`Audio settings: ${JSON.stringify(result.settings)}`);
  console.log(`Graphics: ${result.renderer}`);
  console.log(`Feedback rendering: ${result.renderWidth}×${result.renderHeight}; ${(config.captureBitrate/1e6).toFixed(0)} Mbps capture; ${config.captureCodec === 'h264' ? 'H.264/AAC passthrough (single encode)' : `H.264 ${config.preset} transcode`}.`);
  console.log(`Capture codec: ${result.mimeType}`);
  console.log(`Recording ${result.width}×${result.height} at ${config.fps} fps with ${result.device}.`);
  console.log(config.liveDir ? `Watch: ${origin}/watch\nOBS / VLC: ${origin}/live/stream.m3u8` : config.rtmp ? 'Streaming to the configured RTMP destination.' : `Saving to ${config.output}`);
  console.log('Press Ctrl+C to stop and finalize.');
  if (values.seconds) timer = setTimeout(requestStop, Number(values.seconds) * 1000);
  const startedAt = Date.now();
  let checking = false;
  monitor = setInterval(async () => {
    if (checking || stopping) return;
    checking = true;
    try {
      const status = await page.evaluate(() => window.__captureSession.status());
      if (process.env.PHOSPHOR_DEBUG) console.log(JSON.stringify(status));
      if (status.failure || pipeline.status().failure) throw new Error(status.failure || pipeline.status().failure);
      if (Date.now() - startedAt > 10000 && status.sequence === 0) throw new Error('No video arrived within 10 seconds. Try --renderer software.');
    } catch (error) { console.error(redact(error.message)); process.exitCode = 1; requestStop(); }
    finally { checking = false; }
  }, 1000);
  await stopRequested;
  stopping = true;
  clearInterval(monitor);
  if (!page.isClosed()) {
    const summary = await page.evaluate(() => window.__captureSession.stop());
    if (summary.skipped !== undefined) console.log(`Encoder backpressure skipped ${summary.skipped} frames.`);
    console.log(`Captured ${summary.frames} frames (${(summary.frames/summary.seconds).toFixed(1)} fps).`);
  }
  console.log(`Delivered ${pipeline.status().sequence} media chunks.`);
  encoder.stdin.end();
  const deadline = setTimeout(() => encoder.kill('SIGKILL'), 20000);
  const code = await encoderDone;
  clearTimeout(deadline);
  if (code !== 0) throw new Error(encoderError || `FFmpeg exited with status ${code}.`);
  if (encodedStats.timeUs > 0) {
    const unique = encodedStats.frames - encodedStats.duplicates;
    console.log(`Encoded ${unique} unique frames (${(unique/(encodedStats.timeUs/1e6)).toFixed(1)} fps), ${encodedStats.duplicates} duplicated, ${encodedStats.dropped} dropped.`);
  }
  console.log('Capture finalized. Audio routing remains active; restore with npm run audio:restore.');
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
} finally {
  stopping = true;
  clearTimeout(timer); clearInterval(monitor);
  await browser?.close().catch(() => {});
  server?.closeAllConnections();
  server?.close();
  if (encoder && encoder.exitCode === null) {
    encoder.stdin.end();
    const deadline = setTimeout(() => encoder.kill('SIGKILL'), 5000);
    await encoderDone;
    clearTimeout(deadline);
  }
  process.off('SIGINT', requestStop); process.off('SIGTERM', requestStop);
  if (config.liveDir) await rm(config.liveDir,{recursive:true,force:true});
}
