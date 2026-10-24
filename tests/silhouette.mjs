import {chromium} from 'playwright-core';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createCaptureServer} from '../tools/capture/pipeline.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)), input=new PassThrough();input.resume();
const {server}=createCaptureServer({root,input});server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1280,height:900}}), errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__phosphorCaptureConfig={width:640,height:480,renderHeight:144};});
 const app=(await readFile(root+'/js/app.js','utf8')).replace('let captureNextAt = 0;', `window.__dancerTest={dancers,loops,snd,spotify,showSequence,gl,canvas,allRT,setAutopilot,
  freeze:value=>{frozen=value;}, white:()=>{for(const rt of allRT()){gl.bindFramebuffer(gl.FRAMEBUFFER,rt.fbo);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT);}},
  black:()=>{for(const rt of allRT()){gl.bindFramebuffer(gl.FRAMEBUFFER,rt.fbo);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);}}};let captureNextAt = 0;`);
 const frames=async count=>page.evaluate(count=>new Promise(resolve=>{const next=()=>{if(--count<=0)resolve();else requestAnimationFrame(next);};requestAnimationFrame(next);}),count);
 await page.route('**/js/app.js',r=>r.fulfill({contentType:'text/javascript',body:app}));
 const base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(base);await page.waitForFunction(()=>window.__dancerTest);
 const asset=await page.request.get(base+'/static/silhouette-mask-v2.mp4');assert.equal(asset.status(),200);assert.match(asset.headers()['content-type'],/video\/mp4/);
 assert.equal((await page.request.get(base+'/static/not-public.webm')).status(),404);
 const range=await page.request.get(base+'/static/silhouette-mask-v2.mp4',{headers:{Range:'bytes=0-99'}});assert.equal(range.status(),206);assert.equal((await range.body()).length,100);
 assert.equal((await page.request.get(base+'/static/silhouette-mask-v2.mp4',{headers:{Range:'bytes=99999999-'}})).status(),416);
 const previousInput=await page.evaluate(()=>window.__dancerTest.loops.A.tgt.in1);
 await page.locator('#inputs [data-src="silhouette"]').click();
 assert.equal(await page.locator('#row-silhouette').isVisible(),true);
 assert.equal(await page.evaluate(()=>window.__dancerTest.loops.A.tgt.in2),previousInput);
 await page.selectOption('#silhouetteClock','manual');
 await page.waitForFunction(()=>window.__dancerTest.dancers.A.player?.video.readyState>=2);
 await page.waitForFunction(()=>!window.__dancerTest.dancers.A.player.video.paused);
 await page.locator('#silhouetteBpm').fill('208');await page.locator('#silhouetteBpm').dispatchEvent('change');
 await page.waitForFunction(()=>Math.abs(window.__dancerTest.dancers.A.player.video.playbackRate-2)<0.2);
 // Hold a known pose on a white loop image. Transparent areas must leave that white image intact.
 await page.evaluate(()=>{
  const t=window.__dancerTest;t.setAutopilot(false,true);t.freeze(true);t.white();
  t.loops.A.tgt.in2='none';t.dancers.A.player.pause();t.dancers.A.player.video.currentTime=0.7;
 });
 try { await page.waitForFunction(()=>!window.__dancerTest.dancers.A.player.video.seeking&&Math.abs(window.__dancerTest.dancers.A.time-0.7)<0.05,null,{timeout:7000}); }
 catch(error){console.log(await page.evaluate(()=>{const t=window.__dancerTest,s=t.dancers.A,v=s.player.video;return{ready:v.readyState,seeking:v.seeking,time:s.time,current:v.currentTime,paused:v.paused,source:t.loops.A.tgt.in1,status:s.player.status,error:s.player.error};}));console.log(errors);throw error;}
 const pixels=()=>page.evaluate(()=>new Promise(resolve=>{
  window.__phosphorCapture.onFrame=()=>{
   window.__phosphorCapture.onFrame=null;const {gl,canvas}=window.__dancerTest;
   const rgba=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
   let black=0,white=0,light=0;for(let y=20;y<canvas.height-20;y++)for(let x=20;x<canvas.width-20;x++){const i=(y*canvas.width+x)*4;if(rgba[i]<10&&rgba[i+1]<10&&rgba[i+2]<10)black++;if(rgba[i]>240&&rgba[i+1]>240&&rgba[i+2]>240)white++;if(Math.max(rgba[i],rgba[i+1],rgba[i+2])>100)light++;}
   resolve({black,white,light,corner:Array.from(rgba.slice((30*canvas.width+30)*4,(30*canvas.width+30)*4+3))});
  };
 }));
 const clean=await pixels();assert.ok(clean.black>3000,JSON.stringify(clean));assert.ok(clean.white>200000,JSON.stringify(clean));assert.ok(clean.corner.every(v=>v>240));
 // Both sides of the loop seam must leave the background intact and keep a dancer visible.
 const duration=await page.evaluate(()=>window.__dancerTest.dancers.A.player.video.duration);assert.ok(duration>9&&duration<9.3);
 for(const pose of [duration-0.04,0.01]){
  await page.evaluate(pose=>{const v=window.__dancerTest.dancers.A.player.video;v.pause();v.currentTime=pose;},pose);
  await page.waitForFunction(pose=>{const s=window.__dancerTest.dancers.A;return !s.player.video.seeking&&Math.abs(s.time-pose)<0.035;},pose);
  const seam=await pixels();assert.ok(seam.black>3000&&seam.black<40000&&seam.white>200000,JSON.stringify(seam));
 }
 const held=await page.evaluate(()=>window.__dancerTest.dancers.A.player.video.currentTime);await frames(9);assert.equal(await page.evaluate(()=>window.__dancerTest.dancers.A.player.video.currentTime),held);
 if(process.argv[2])await page.locator('#stage').screenshot({path:process.argv[2]});
 await page.locator('#silhouetteFX').click();const bypassed=await pixels();assert.ok(bypassed.black<clean.black/2);
 await page.evaluate(()=>{const t=window.__dancerTest;t.black();t.freeze(false);Object.assign(t.loops.A.tgt,{in1:'silhouette',in2:'none',dancerFX:true,trails:0,color:0,mirror:0});Object.assign(t.loops.A.cur,t.loops.A.tgt);});
 await frames(9);const effects=await pixels();assert.ok(effects.light>1000,JSON.stringify(effects));
 // Audio clock and Spotify pause are independent of the muted media's original audio.
 await page.selectOption('#silhouetteClock','auto');
 await page.evaluate(()=>{window.__dancerTest.snd.rhythmSample={gridBeat:10,phase:0.2,bpm:156};});
 await page.waitForFunction(()=>Math.abs(window.__dancerTest.dancers.A.player.video.playbackRate-1.5)<0.2);
 await page.evaluate(()=>{
  const t=window.__dancerTest;t.showSequence.songDrive=true;t.showSequence.bpm=104;t.showSequence.offset=0;
  t.spotify.snapshot={track:{uri:'fixture',durationMs:60000},progressMs:1000,receivedAt:performance.now(),playing:false};
 });
 await page.waitForFunction(()=>window.__dancerTest.dancers.A.player.video.paused);
 assert.deepEqual(errors,[]);
 console.log('PASS: bundled matte route, private source protection, source selection, manual/audio tempo sync, transparent black overlay pixels, freeze, effects routing, Spotify pause.');
}finally{await browser?.close();server.closeAllConnections();server.close();input.destroy();}
