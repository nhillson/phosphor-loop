// Hardware integration check: a quiet system-output tone must reach BlackHole.
import {chromium} from 'playwright-core';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createCaptureServer} from '../tools/capture/pipeline.mjs';
const exec = promisify(execFile);
const tone = '/tmp/phosphor-route-tone.wav';
await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-af','volume=0.3','-ac','2',tone]);
const input = new PassThrough(); input.resume();
const {server} = createCaptureServer({root:fileURLToPath(new URL('../',import.meta.url)),input});
server.listen(0,'127.0.0.1'); await once(server,'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, playback;
try {
  browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required']});
  const context = await browser.newContext({serviceWorkers:'block'});
  await context.grantPermissions(['microphone'],{origin});
  const page = await context.newPage();
  // Test a minimal page so rendering cost does not affect the audio routing check.
  await page.route('**/index.html',route => route.fulfill({contentType:'text/html',body:'<title>Audio routing check</title>'}));
  await page.goto(origin + '/index.html');
  const device = await page.evaluate(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const selected = devices.find(d => d.kind === 'audioinput' && /^BlackHole 2ch/.test(d.label));
    if (!selected) throw new Error('BlackHole unavailable');
    const stream = await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:selected.deviceId},echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
    const ctx = new AudioContext(); await ctx.resume();
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    window.__routeCheck = {stream,ctx,analyser,peak:0,data:new Float32Array(2048)};
    return selected.label;
  });
  playback = spawn('/usr/bin/afplay',[tone],{stdio:'ignore'});
  playback.on('error',error => console.error(error.message));
  await page.waitForFunction(() => {
    const s = window.__routeCheck;
    s.analyser.getFloatTimeDomainData(s.data);
    let energy = 0; for (const v of s.data) energy += v*v;
    const rms = Math.sqrt(energy / s.data.length);
    s.peak = Math.max(s.peak,rms);
    return rms > 0.01;
  },null,{polling:'raf',timeout:10000});
  console.log(`PASS: system-output tone reached ${device}; RMS ${await page.evaluate(() => window.__routeCheck.peak)}.`);
  await page.evaluate(async () => { const s = window.__routeCheck; s.stream.getTracks().forEach(t => t.stop()); await s.ctx.close(); });
} finally {
  playback?.kill(); await browser?.close(); server.closeAllConnections(); server.close(); input.destroy();
}
