// The outgoing audio must survive stopping/reconnecting the workstation analyzer.
import {chromium} from 'playwright-core';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createCaptureServer,ffmpegArgs} from '../tools/capture/pipeline.mjs';
import {startCapture} from '../tools/capture/browser.mjs';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(resolve(root,'captures'),{recursive:true});
const output=resolve(root,`captures/audio-reconnect-${Date.now()}.mp4`),tone='/tmp/phosphor-capture-tone.wav';
await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-af','volume=0.3','-ac','2',tone]);
const config={captureCodec:'h264',width:640,height:360,fps:30,bitrate:1000000,output,device:'BlackHole 2ch',maxQueueBytes:16*1024*1024};
const encoder=spawn('ffmpeg',ffmpegArgs(config),{stdio:['pipe','ignore','pipe']});
let log='';encoder.stderr.on('data',data=>log+=data);
const encoded=new Promise(resolve=>encoder.on('close',resolve));
const {server,token}=createCaptureServer({root,input:encoder.stdin});
server.listen(0,'127.0.0.1');await once(server,'listening');
let browser,playback;
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({serviceWorkers:'block'}),origin=`http://127.0.0.1:${server.address().port}`;
 await context.grantPermissions(['microphone'],{origin});
 await context.addInitScript(()=>{window.__phosphorCaptureConfig={width:640,height:360};});
 const page=await context.newPage();
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:20000});
 await page.waitForFunction(()=>window.__phosphorCapture,null,{timeout:10000});
 await page.evaluate(startCapture,{...config,output:undefined,token});
 assert.equal(await page.locator('#soundSrc [data-snd="loopback"]').getAttribute('aria-pressed'),'true');
 // This used to stop the very track MediaRecorder was encoding.
 await page.locator('#soundSrc [data-snd="off"]').click({timeout:5000});
 assert.equal(await page.evaluate(()=>window.__captureSession.status().tracks.find(t=>t.kind==='audio').state),'live');
 playback=spawn('/usr/bin/afplay',[tone],{stdio:'ignore'});
 const target=await page.evaluate(()=>window.__captureSession.status().frames+90);
 await page.waitForFunction(target=>window.__captureSession.status().frames>=target,target,{polling:'raf',timeout:15000});
 // Reconnecting the analyzer also must leave the recording track intact.
 await page.locator('#soundSrc [data-snd="loopback"]').click({timeout:5000});
 await page.waitForFunction(()=>document.querySelector('#sndStatus').textContent.includes('through BlackHole'),null,{timeout:10000});
 assert.equal(await page.evaluate(()=>window.__captureSession.status().tracks.find(t=>t.kind==='audio').state),'live');
 await page.evaluate(()=>window.__captureSession.stop());
 encoder.stdin.end();assert.equal(await encoded,0,log);
 const {stdout}=await exec('ffmpeg',['-hide_banner','-loglevel','error','-i',output,'-map','0:a:0','-ac','1','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:8*1024*1024});
 let energy=0;for(let i=0;i+4<=stdout.length;i+=4){const v=stdout.readFloatLE(i);energy+=v*v;}
 const rms=Math.sqrt(energy/(stdout.length/4));
 assert.ok(rms>0.003,`Missing tone in outgoing AAC: RMS ${rms}`);
 console.log(`PASS: outgoing AAC contains actual BlackHole sound after analyzer Off/reconnect (RMS ${rms.toFixed(4)}).`);
} finally {
 playback?.kill();await browser?.close();server.closeAllConnections();server.close();
 if(encoder.exitCode===null){encoder.stdin.end();const t=setTimeout(()=>encoder.kill('SIGKILL'),5000);await encoded;clearTimeout(t);}
}
