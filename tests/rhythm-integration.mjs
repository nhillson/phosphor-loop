import {chromium} from 'playwright-core';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createCaptureServer} from '../tools/capture/pipeline.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = new PassThrough(); input.resume();
const {server} = createCaptureServer({root, input});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({headless:true,
    executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const context = await browser.newContext({serviceWorkers:'block'});
  await context.addInitScript(() => { window.__phosphorCaptureConfig = {width:320, height:180, renderHeight:144}; });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const app = (await readFile(root + '/js/app.js','utf8'))
    .replace('const reacts =', 'window.__testSound = snd; const reacts =');
  await page.route('**/js/app.js', route => route.fulfill({contentType:'application/javascript',body:app}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__phosphorCapture);
  const connect = bpm => page.evaluate(async bpm => {
    window.__fixture?.source.stop();
    if (window.__fixture) await window.__fixture.ctx.close();
    const ctx = new AudioContext({sampleRate:48000}); await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    const source = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, 48000 * 40, 48000), samples = buffer.getChannelData(0);
    for (let t = 0.5; t < 39; t += 60 / bpm) {
      for (let i = 0; i < 48000 * 0.16; i++) {
        const x = i / 48000;
        samples[Math.round(t * 48000) + i] += 0.8 * Math.sin(2 * Math.PI * (65 * x + 5 * (1 - Math.exp(-x * 35)))) * Math.exp(-x * 32);
      }
    }
    source.buffer = buffer; source.connect(dest); source.start();
    window.__fixture = {ctx, source};
    window.__phosphorCapture.listen(dest.stream);
  }, bpm);
  await connect(128);
  await page.waitForFunction(() => Math.abs(window.__testSound.rhythmSample?.bpm - 128) < 2, null, {timeout:35000});
  await page.waitForFunction(() => window.__testSound.beats >= 3, null, {timeout:5000});
  assert.match(await page.locator('#rhythmStatus').textContent(), /\d+ BPM/);
  await page.evaluate(() => { window.__oldRhythm = window.__testSound.rhythm; window.__fixture.source.stop(); });
  await page.waitForFunction(() => window.__testSound.rhythmSample?.state === 'Listening' && window.__testSound.env.beat === 0);
  const beats = await page.evaluate(() => window.__testSound.beats);
  await page.waitForFunction(() => window.__testSound.rhythmSample.time - window.__testSound.rhythm.lastAudioTime > 1.5);
  assert.equal(await page.evaluate(() => window.__testSound.beats), beats, 'silence must not generate grid events');
  await connect(120);
  assert.ok(await page.evaluate(() => window.__oldRhythm.closed), 'reconnect stops the old worker');
  assert.equal(await page.evaluate(() => window.__testSound.rhythmSample), null, 'reconnect clears old tempo');
  await page.waitForFunction(() => Math.abs(window.__testSound.rhythmSample?.bpm - 120) < 2, null, {timeout:35000});
  await page.evaluate(() => window.__phosphorCapture.stopSound());
  assert.equal(await page.evaluate(() => window.__testSound.env.beat), 0);
  assert.equal(await page.evaluate(() => window.__testSound.rhythm), null);
  assert.deepEqual(errors, []);
  console.log('PASS: main app detects BPM, advances beat events, stops pulses in silence, and reacquires after reconnect.');

  await page.route('**/tempo-worker.js', route => route.abort());
  await connect(128);
  await page.waitForFunction(() => window.__testSound.rhythm?.error);
  await page.waitForFunction(() => document.querySelector('#rhythmStatus').textContent.includes('unavailable'));
  assert.equal(await page.evaluate(() => window.__testSound.env.beat), 0);
  await page.evaluate(async () => {
    window.__phosphorCapture.stopSound();
    window.__fixture.source.stop(); await window.__fixture.ctx.close();
  });
  console.log('PASS: worker failure reports unavailable BPM and leaves the pulse off.');
} finally { await browser?.close(); server.closeAllConnections(); server.close(); input.destroy(); }
