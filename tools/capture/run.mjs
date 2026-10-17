import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {once} from 'node:events';
import {createCaptureServer, ffmpegArgs} from './pipeline.mjs';
import {startCapture} from './browser.mjs';

const {values} = parseArgs({options: {
  output: {type: 'string'}, seconds: {type: 'string'}, width: {type: 'string', default: '1280'},
  height: {type: 'string', default: '720'}, fps: {type: 'string', default: '30'},
  bitrate: {type: 'string', default: '6000000'}, device: {type: 'string', default: 'BlackHole 2ch'},
  rtmp: {type: 'boolean'}, autopilot: {type: 'boolean'}, help: {type: 'boolean'},
}});
if (values.help) {
  console.log('npm run capture -- [--output captures/show.mp4] [--seconds 10] [--autopilot]\n  [--width 1280 --height 720 --fps 30 --bitrate 6000000]\n  [--device "BlackHole 2ch"] [--rtmp (uses PHOSPHOR_RTMP_URL)]\nStop with Ctrl+C. CHROME_PATH and FFMPEG_PATH optionally override executables.');
  process.exit(0);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const config = {device: values.device, autopilot: values.autopilot, maxQueueBytes: 16 * 1024 * 1024};
for (const [key, low, high] of [['width', 160, 3840], ['height', 120, 2160], ['fps', 1, 60], ['bitrate', 100000, 50000000]]) {
  config[key] = Number(values[key]);
  if (!Number.isInteger(config[key]) || config[key] < low || config[key] > high || (['width', 'height'].includes(key) && config[key] % 2)) throw new Error(`Invalid ${key}. Dimensions must be even.`);
}
if (values.seconds !== undefined && (!Number.isFinite(+values.seconds) || +values.seconds <= 0)) throw new Error('--seconds must be positive.');
if (values.rtmp) {
  config.rtmp = process.env.PHOSPHOR_RTMP_URL;
  if (!/^rtmps?:\/\//.test(config.rtmp || '')) throw new Error('Set PHOSPHOR_RTMP_URL to the complete RTMP destination.');
  if (values.output) throw new Error('Choose either --output or --rtmp.');
} else {
  config.output = resolve(root, values.output || `captures/phosphor-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`);
  if (!/\.(mp4|mkv)$/i.test(config.output)) throw new Error('Output must end in .mp4 or .mkv.');
  await mkdir(dirname(config.output), {recursive: true});
}
let browser, page, server, encoder, encoderDone, timer, monitor;
let stopping = false, resolveStop;
const stopRequested = new Promise(resolve => { resolveStop = resolve; });
const requestStop = () => resolveStop();
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);
const redact = text => config.rtmp ? text.split(config.rtmp).join('[RTMP destination]') : text;
try {
  encoder = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ffmpegArgs(config), {stdio: ['pipe', 'ignore', 'pipe']});
  let encoderError;
  encoderDone = new Promise(resolve => {
    encoder.on('error', error => { encoderError = error.message; requestStop(); resolve(-1); });
    encoder.on('close', code => { if (!stopping) requestStop(); resolve(code); });
  });
  encoder.stderr.on('data', data => process.stderr.write(redact(data.toString())));
  const pipeline = createCaptureServer({root, input: encoder.stdin});
  server = pipeline.server;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: false,
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  browser.on('disconnected', requestStop);
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
  await context.grantPermissions(['microphone'], {origin});
  await context.addInitScript(c => { window.__phosphorCaptureConfig = c; }, {width: config.width, height: config.height});
  page = await context.newPage();
  page.on('pageerror', error => { console.error(redact(error.message)); process.exitCode = 1; requestStop(); });
  page.on('close', requestStop);
  await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 20000});
  await page.waitForFunction(() => window.__phosphorCapture, null, {timeout: 10000});
  const result = await page.evaluate(startCapture, {...config, rtmp: undefined, output: undefined, token: pipeline.token});
  console.log(`Audio settings: ${JSON.stringify(result.settings)}`);
  console.log(`Recording ${result.width}×${result.height} at ${config.fps} fps with ${result.device}.`);
  console.log(config.rtmp ? 'Streaming to the configured RTMP destination.' : `Saving to ${config.output}`);
  console.log('Press Ctrl+C to stop and finalize.');
  if (values.seconds) timer = setTimeout(requestStop, Number(values.seconds) * 1000);
  let checking = false;
  monitor = setInterval(async () => {
    if (checking || stopping) return;
    checking = true;
    try {
      const status = await page.evaluate(() => window.__captureSession.status());
      if (status.failure || pipeline.status().failure) throw new Error(status.failure || pipeline.status().failure);
    } catch (error) { console.error(redact(error.message)); process.exitCode = 1; requestStop(); }
    finally { checking = false; }
  }, 1000);
  await stopRequested;
  stopping = true;
  clearInterval(monitor);
  if (!page.isClosed()) await page.evaluate(() => window.__captureSession.stop());
  console.log(`Delivered ${pipeline.status().sequence} media chunks.`);
  encoder.stdin.end();
  const deadline = setTimeout(() => encoder.kill('SIGKILL'), 20000);
  const code = await encoderDone;
  clearTimeout(deadline);
  if (code !== 0) throw new Error(encoderError || `FFmpeg exited with status ${code}.`);
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
}
