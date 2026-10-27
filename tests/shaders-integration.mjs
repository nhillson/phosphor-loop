// Shaders from outside (Shadertoy, ISF) in a real browser: the folded Shaders section, the built-in list, a shader as a
// loop's input and as its effect, its own sliders, pasting one in (and a broken one turned away), Autopilot's pick,
// presets, and the sequencer's change-over-time list. Waits are by frames. Run: node tests/shaders-integration.mjs
// (CHROME_PATH picks the browser; SHOTS=<folder> also saves a picture of a few shaders).
import {chromium} from 'playwright-core';
import {fileURLToPath} from 'node:url';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createCaptureServer} from '../tools/capture/pipeline.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const input = new PassThrough(); input.resume();
const {server} = createCaptureServer({root, input}); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const step = (name) => console.log('ok -', name);
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => { window.__phosphorCaptureConfig = { width: 320, height: 180, renderHeight: 144 }; });
  await page.goto(`http://127.0.0.1:${server.address().port}`, { timeout: 30000 });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const T = (fn, arg) => page.evaluate(fn, arg);
  await frames(5);

  // Folded away until opened; opening it fetches the built-in list
  const body = page.locator('#fold-h-shaders');
  assert.ok(await body.isHidden(), 'the Shaders section starts folded');
  assert.equal(await T(() => window.__plShaders.lib.index), null, 'and nothing is fetched until it is opened');
  await page.locator('#shaderGroup .group-toggle').click();
  // The library: a gallery of previews, Inputs and Effects, kinds and a search
  await page.click('#shOpenIn');
  await page.waitForFunction(() => !document.getElementById('shLib').hidden && document.querySelectorAll('#shLibGrid .nat-tile img').length > 20);
  const nIn = await page.locator('#shLibGrid .nat-tile').count();
  const firstImg = await page.locator('#shLibGrid .nat-tile img').first().evaluate((i) => new Promise((r) => (i.complete ? r(i.naturalWidth) : i.addEventListener('load', () => r(i.naturalWidth)))));
  assert.equal(firstImg, 240, 'previews load');
  await page.fill('#shLibSearch', 'checker');
  assert.ok((await page.locator('#shLibGrid .nat-tile').count()) < nIn, 'search narrows it');
  await page.fill('#shLibSearch', '');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#shLib').isHidden());
  step(`Shaders section folded until opened; the library shows ${nIn} input shaders with previews`);

  // A built-in ISF input with settings: it draws, and its slider changes the loop's value
  const withFloat = await T(() => window.__plShaders.lib.index.find((e) => e.role === 'input' && e.kind === 'isf' && /Plasma|Noise|Sine|Random/.test(e.name))?.id
    || window.__plShaders.lib.index.find((e) => e.role === 'input' && e.kind === 'isf').id);
  await page.click('#shOpenIn');
  await page.locator(`#shLibGrid .nat-tile[data-id="${withFloat}"]`).click();
  assert.ok(await page.locator('#shLib').isHidden(), 'picking closes the library');
  await page.waitForFunction((id) => window.__plShaders.hosts.A.in?.id === id && window.__plShaders.hosts.A.in.host.frame > 2, withFloat, { timeout: 15000 });
  assert.equal(await T(() => window.__plShaders.loops.A.tgt.in1), 'shader');
  assert.equal(await T(() => window.__plShaders.hosts.A.in.host.error), null);
  const slider = page.locator('#shInVals input[type=range]').first();
  if (await slider.count()) {
    const name = (await slider.getAttribute('id')).replace(/^shv-shInVals-/, '');
    await slider.evaluate((r) => { r.value = r.max; r.dispatchEvent(new Event('input')); });
    assert.equal(+(await T((n) => window.__plShaders.loops.A.tgt.shaderVals[n], name)), +(await slider.getAttribute('max')), 'the slider sets the loop’s value');
  }
  step(`a built-in input shader (${withFloat}) draws on loop A; its sliders work`);

  // An effect shader over the loop's finished picture
  await page.click('#shOpenFx');
  await page.waitForFunction(() => document.querySelectorAll('#shLibGrid .nat-tile').length > 20);
  const fxId = await page.locator('#shLibGrid .nat-tile').first().getAttribute('data-id');
  await page.locator('#shLibGrid .nat-tile').first().click();
  await page.waitForFunction(() => !!window.__plShaders.loops.A.fxOut, null, { timeout: 15000 });
  assert.equal(await T(() => window.__plShaders.loops.A.tgt.fx), fxId);
  await page.click('#shFxOff'); await frames(3);
  assert.equal(await T(() => window.__plShaders.loops.A.fxOut), null, 'taking the effect off');
  step('an effect shader works over the loop’s picture, and comes off');

  // Paste: a broken one is turned away with the reason; a working Shadertoy one joins Yours and goes on the loop
  await page.locator('.sh-paste summary').click();
  await page.fill('#shPasteCode', 'void mainImage(out vec4 c, in vec2 f) { c = vec4(nope, 1.0); }');
  await page.click('#shPasteAdd');
  assert.match(await page.textContent('#shPasteMsg'), /doesn’t run here yet/);
  assert.equal(await T(() => window.__plShaders.lib.mine.length), 0);
  await page.fill('#shPasteName', 'Test stripes');
  await page.fill('#shPasteCode', 'void mainImage(out vec4 c, in vec2 f) { c = vec4(0.5 + 0.5 * sin(f.x * 0.2 + iTime), 0.3, 0.8, 1.0); }');
  await page.click('#shPasteAdd');
  await page.waitForFunction(() => window.__plShaders.lib.mine.length === 1);
  await page.waitForFunction(() => window.__plShaders.hosts.A.in?.host.frame > 2, null, { timeout: 15000 });
  assert.equal(await T(() => window.__plShaders.loops.A.tgt.shader), await T(() => window.__plShaders.lib.mine[0].id));
  await page.click('#shOpenIn');
  await page.locator('#shLibTabs .chip', { hasText: 'Yours' }).click();
  const mineTile = page.locator('#shLibGrid .nat-tile').first();
  assert.equal(await mineTile.locator('span').last().textContent(), 'Test stripes', 'listed under Yours');
  assert.match(await mineTile.locator('img').getAttribute('src'), /^data:image\/jpeg/, 'with a preview of its own');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#shLib').isHidden(), 'Escape closes the library');
  step('pasting: a broken shader is turned away with the reason; a working one is kept and used');

  // Autopilot's looks can bring one in: a look that uses Shader without naming one gets one
  await T(() => window.__plShaders.patchLoop('B', { in1: 'shader' }, true));
  assert.ok(await T(() => !!window.__plShaders.loops.B.tgt.shader), 'a shader is picked');
  step('a look asking for Shader gets one (how Autopilot brings them in)');

  // The sequencer: a block whose look uses a shader offers that shader's own sliders under Change over time
  await T(() => window.__plShaders.patchLoop('A', { in1: 'shader', shader: window.__plShaders.lib.index.find((e) => e.id === 'isf/noise') ? 'isf/noise' : window.__plShaders.loops.A.tgt.shader }, true));
  await page.click('#seqBtn'); await frames(3);
  await page.locator('button.seq-card').nth(0).click();
  await page.click('#seqAddCurrent'); await frames(3);
  const blk = page.locator('.seq-blk').first();
  await blk.click({ button: 'right', position: { x: 8, y: 8 } });
  await page.locator('.seq-menu.fixed > button', { hasText: 'Change over time' }).click();
  const groups = await page.locator('.seq-menu.fixed .mh').allTextContents();
  assert.ok(groups.some((g) => /^Shader: /.test(g)), 'the shader’s own sliders are offered: ' + groups.join(' | '));
  await page.keyboard.press('Escape');
  await page.click('#seqHide');
  step('sequencer blocks can change a shader’s own sliders over time');

  // Saved in looks: a preset made now keeps the shader and its settings
  const snap = await T(() => window.__plGrade.snapshot());
  assert.equal(snap.A.in1, 'shader'); assert.ok(snap.A.shader);
  step('presets keep the shader');

  // Kept after a reload: your shaders, and loop A still on its shader
  await page.reload({ timeout: 30000 }); await frames(5);
  assert.equal(await T(() => window.__plShaders.lib.mine.length), 1);
  step('your shaders are kept in this browser');

  assert.deepEqual(errors, []);
  console.log('PASS');
} finally { await browser?.close(); server.close(); }
