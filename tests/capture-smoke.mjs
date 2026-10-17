// Regression checks in installed Chrome. All rendering waits count frames.
import {chromium} from 'playwright-core';
import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
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
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const source = (await readFile(new URL('../js/app.js', import.meta.url), 'utf8'))
    .replace('const SIM_H = 576;', 'const SIM_H = 144;')
    .replace('function frame() {', 'function frame() { window.__frames = (window.__frames || 0) + 1;');
  for (const capture of [false, true]) {
    const context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 1280, height: 800}});
    if (capture) await context.addInitScript(() => { window.__phosphorCaptureConfig = {width: 640, height: 360}; });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/js/app.js', route => route.fulfill({contentType: 'application/javascript', body: source}));
    const url = capture ? `http://127.0.0.1:${server.address().port}/` : pathToFileURL(root + '/index.html').href;
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 20000});
    const frames = async count => {
      const target = await page.evaluate(n => (window.__frames || 0) + n, count);
      await page.waitForFunction(n => window.__frames >= n, target, {timeout: 20000});
    };
    await frames(60);
    const stats = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
      const screen = document.querySelector('#screen'), c = document.createElement('canvas');
      c.width = 64; c.height = 36;
      const ctx = c.getContext('2d'); ctx.drawImage(screen, 0, 0, 64, 36);
      const pixels = ctx.getImageData(0, 0, 64, 36).data;
      let light = 0; for (let i = 0; i < pixels.length; i += 4) light += pixels[i] + pixels[i+1] + pixels[i+2];
      resolve({light: light / (64*36*3), width:screen.width, height:screen.height, hook:!!window.__phosphorCapture});
    })));
    assert.ok(stats.light > 3, `Black picture: ${stats.light}`);
    assert.equal(stats.hook, capture);
    if (capture) { assert.equal(stats.width,640); assert.equal(stats.height,360); }
    for (const [selector, count] of [['#surprise',10],['#surprise',10],['#autopilot',20],['#autopilot',3],['#neutral',5],['#tabB',3],['#tabA',3],['#clear',5]]) {
      await page.locator(selector).click({timeout:5000}); await frames(count);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${capture ? 'fixed capture resolution' : 'normal file:// startup'}; nonblack picture; control workout; no page errors.`);
    await context.close();
  }
} finally { await browser?.close(); server.closeAllConnections(); server.close(); input.destroy(); }
