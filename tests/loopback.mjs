// Exercise the real page controls against controlled browser audio inputs.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createCaptureServer} from '../tools/capture/pipeline.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const input = new PassThrough(); input.resume();
const {server} = createCaptureServer({root, input});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args:['--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const source = (await readFile(new URL('../js/app.js', import.meta.url),'utf8')).replace('const SIM_H = 576;','const SIM_H = 144;');
async function fixture({missing = false, deny = false, privateNames = false, delayed = false, real = false} = {}) {
  const context = await browser.newContext({serviceWorkers:'block'});
  if (real) await context.grantPermissions(['microphone'],{origin});
  else await context.addInitScript(({missing,deny,privateNames,delayed}) => {
    const devices = [{kind:'audioinput',deviceId:'room',label:'Room microphone'},
      ...(!missing ? [{kind:'audioinput',deviceId:'bh16',label:'BlackHole 16ch (Virtual)'},
        {kind:'audioinput',deviceId:'bh2',label:'BlackHole 2ch (Virtual)'}] : [])];
    const state = window.__audioTest = {calls:[],tracks:[],permission:!privateNames};
    Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async () => devices.map(d => ({...d,label:state.permission ? d.label : ''}))});
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async constraints => {
      state.calls.push(constraints);
      if (deny) throw new DOMException('Denied','NotAllowedError');
      state.permission = true;
      const id = constraints.audio.deviceId?.exact || 'room';
      const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator(); osc.connect(dest); osc.start();
      const stream = dest.stream, track = stream.getAudioTracks()[0];
      Object.defineProperty(track,'label',{value:devices.find(d => d.deviceId === id)?.label || ''});
      track.getSettings = () => ({deviceId:id,sampleRate:48000,channelCount:2});
      state.tracks.push(track);
      if (delayed && constraints.audio.deviceId) await new Promise(resolve => { state.release = resolve; });
      return stream;
    }});
  },{missing,deny,privateNames,delayed});
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await page.route('**/js/app.js',route => route.fulfill({contentType:'application/javascript',body:source}));
  await page.goto(origin,{waitUntil:'domcontentloaded',timeout:20000});
  await page.waitForFunction(() => document.querySelector('#sndAmtOut').textContent === '60');
  const choose = value => page.locator(`#soundSrc [data-snd="${value}"]`).click();
  const close = async () => { assert.deepEqual(errors,[]); await context.close(); };
  return {context,page,choose,close};
}
try {
  {
    const t = await fixture({privateNames:true});
    await t.choose('loopback');
    await t.page.waitForFunction(() => document.querySelector('#sndStatus').textContent.includes('through BlackHole 2ch'));
    assert.equal(await t.page.locator('#micSel').inputValue(),'bh2');
    assert.equal(await t.page.locator('#micSel option').count(),2);
    assert.ok(await t.page.locator('#loopbackHint').isVisible());
    const calls = await t.page.evaluate(() => window.__audioTest.calls);
    assert.equal(calls.length,2);
    assert.deepEqual(calls[1].audio,{echoCancellation:false,noiseSuppression:false,autoGainControl:false,deviceId:{exact:'bh2'},channelCount:{ideal:2}});
    assert.equal(await t.page.evaluate(() => window.__audioTest.tracks[0].readyState),'ended');
    await t.page.locator('#micSel').selectOption('bh16');
    await t.page.waitForFunction(() => document.querySelector('#sndStatus').textContent.includes('through BlackHole 16ch'));
    await t.choose('off');
    assert.equal(await t.page.evaluate(() => window.__audioTest.tracks.every(t => t.readyState === 'ended')),true);
    await t.choose('mic');
    await t.page.waitForFunction(() => document.querySelector('#sndStatus').textContent.includes('through the microphone'));
    assert.equal(await t.page.locator('#micSel option').count(),3);
    await t.choose('loopback');
    await t.page.waitForFunction(() => document.querySelector('#sndStatus').textContent.includes('through BlackHole 16ch'));
    await t.close();
    console.log('PASS: permission discovery; BlackHole preference; exact stereo constraints; adapter switching; Off releases tracks; microphone choice stays independent.');
  }
  for (const [options,text] of [[{missing:true},'No loopback adapter was found'],[{deny:true,privateNames:true},'Microphone access was blocked']]) {
    const t = await fixture(options); await t.choose('loopback');
    await t.page.waitForFunction(text => document.querySelector('#sndStatus').textContent.includes(text),text);
    assert.ok(await t.page.locator('#sndRetry').isVisible());
    if (options.missing) assert.equal(await t.page.evaluate(() => window.__audioTest.calls.length),0);
    await t.close();
  }
  console.log('PASS: missing adapter never opens room microphone; denied access offers retry.');
  {
    const t = await fixture({delayed:true}); await t.choose('loopback');
    await t.page.waitForFunction(() => !!window.__audioTest.release);
    await t.choose('off');
    await t.page.evaluate(() => window.__audioTest.release());
    await t.page.waitForFunction(() => window.__audioTest.tracks.every(t => t.readyState === 'ended'));
    assert.equal(await t.page.locator('#soundSrc [data-snd="off"]').getAttribute('aria-pressed'),'true');
    await t.close();
    console.log('PASS: switching Off during permission/device opening discards the stale stream.');
  }
  if (process.argv.includes('--real')) {
    const t = await fixture({real:true}); await t.choose('loopback');
    await t.page.waitForFunction(() => document.querySelector('#sndStatus').textContent.includes('through BlackHole'),null,{timeout:15000});
    const label = await t.page.locator('#micSel option:checked').textContent();
    assert.match(label,/BlackHole 2ch/);
    await t.page.locator('#soundGroup').screenshot({path:'/tmp/phosphor-loopback.png'});
    await t.choose('off'); await t.close();
    console.log(`PASS: real BlackHole input selected through the webpage: ${label}. Screenshot: /tmp/phosphor-loopback.png`);
  }
} finally { await browser.close(); server.closeAllConnections(); server.close(); input.destroy(); }
