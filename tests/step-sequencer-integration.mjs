import {chromium} from 'playwright-core';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createCaptureServer} from '../tools/capture/pipeline.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const input=new PassThrough();input.resume();
const {server}=createCaptureServer({root,input});server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try {
 browser=await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__phosphorCaptureConfig={width:320,height:180,renderHeight:144};
  sessionStorage.setItem('phosphor-spotify-session-v1',JSON.stringify({access:'fixture',refresh:'fixture',scope:'user-modify-playback-state',expiresAt:Date.now()+3600000}));
 });
 const app=(await readFile(root+'/js/app.js','utf8')).replace('let captureNextAt = 0;', 'window.__showTest={showSequence,showSequenceTick,spotify,snd,ap,loops}; let captureNextAt = 0;');
 const frames=async count=>page.evaluate(count=>new Promise(resolve=>{const next=()=>{if(--count<=0)resolve();else requestAnimationFrame(next);};requestAnimationFrame(next);}),count);
 await page.route('**/js/app.js',r=>r.fulfill({contentType:'text/javascript',body:app}));
 let track='A', progress=0, playing=true, account='account-one', fail=false;
 const seeks=[];
 const item=id=>({uri:'spotify:track:'+id,type:'track',name:id==='A'?'Ghosts n Stuff':'Next song',artists:[{name:'Artist'}],duration_ms:180000});
 await page.route('https://api.spotify.com/v1/**',route=>{
  const url=new URL(route.request().url()), path=url.pathname;
  if(path==='/v1/me/player/seek') {
   assert.equal(route.request().method(),'PUT');progress=Number(url.searchParams.get('position_ms'));seeks.push(progress);
   return route.fulfill({status:204});
  }
  let data=path==='/v1/me'?{id:account}:path.endsWith('/queue')?{currently_playing:item(track),queue:[item(track==='A'?'B':'A')]}:{currently_playing_type:'track',item:item(track),progress_ms:progress,is_playing:playing};
  return route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.__showTest?.showSequence.song?.uri==='spotify:track:A');
 await page.evaluate(()=>window.__showTest.spotify.stop());
 const poll=()=>page.evaluate(()=>window.__showTest.spotify.poll());
 assert.equal(await page.locator('#showSeqSteps li').count(),0);
 assert.ok(await page.evaluate(()=>window.__showTest.ap.on));
 assert.match(await page.locator('#spotifyNext').textContent(),/Next song/);
 await page.locator('#showSeqCurrent').click();await page.locator('#showSeqCurrent').click();
 await page.locator('[aria-label="Name for step 1"]').fill('Intro');await page.locator('[aria-label="Name for step 1"]').dispatchEvent('change');
 await page.locator('[aria-label="Name for step 2"]').fill('Drop');await page.locator('[aria-label="Name for step 2"]').dispatchEvent('change');
 await poll();
 assert.equal(await page.evaluate(()=>window.__showTest.showSequence.engine.index),0);
 assert.equal(await page.evaluate(()=>window.__showTest.ap.on),false);
 progress=4500;await poll();assert.equal(await page.evaluate(()=>window.__showTest.showSequence.engine.index),1);
 playing=false;await poll();
 const paused=await page.evaluate(()=>window.__showTest.spotify.position());await frames(6);
 assert.equal(await page.evaluate(()=>window.__showTest.spotify.position()),paused);
 progress=1000;await poll();assert.equal(await page.evaluate(()=>window.__showTest.showSequence.engine.index),0);
 await page.waitForFunction(()=>document.querySelectorAll('#trackCheckpoints button').length===2);
 assert.equal(await page.locator('#trackTimeline').isVisible(),true);
 await page.locator('#trackCheckpoints button').nth(1).click();
 await page.waitForFunction(()=>window.__showTest.showSequence.engine.index===1);
 assert.equal(seeks.at(-1),4000);assert.equal(playing,false);
 assert.match(await page.locator('#trackTimelineStep').textContent(),/Drop/);
 await page.locator('#trackTimelineScrub').evaluate(e=>{e.value='1000';e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));});
 await page.waitForFunction(()=>window.__showTest.spotify.snapshot.progressMs===1000);
 assert.equal(seeks.at(-1),1000);
 assert.equal(await page.evaluate(()=>window.__showTest.showSequence.engine.index),0);
 await page.evaluate(()=>{window.__showTest.spotify.token.scope='';});
 await page.waitForFunction(()=>document.querySelector('#trackTimelineScrub').disabled);
 assert.equal(await page.locator('#trackTimelineReconnect').isVisible(),true);
 await page.evaluate(()=>{window.__showTest.spotify.token.scope='user-modify-playback-state';});
 await page.waitForFunction(()=>!document.querySelector('#trackTimelineScrub').disabled);
 // Resize a step end: preview snaps to beats, release commits without seeking.
 const handle=page.locator('[data-resize][data-index="0"][data-cycle="0"]');
 const resizeTo=async beats=>{
  await page.locator('#trackCheckpoints').scrollIntoViewIfNeeded();await handle.waitFor({state:'visible'});
  const grip=await handle.boundingBox(), rail=await page.locator('#trackCheckpoints').boundingBox();
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
  await page.mouse.move(rail.x+rail.width*(beats*500)/180000,grip.y+grip.height/2,{steps:3});
 };
 const seekCount=seeks.length;
 await resizeTo(12);
 assert.equal(await page.evaluate(()=>window.__showTest.showSequence.steps[0].beats),8);
 assert.equal(await handle.getAttribute('aria-valuenow'),'12');
 await page.mouse.up();
 await page.waitForFunction(()=>window.__showTest.showSequence.steps[0].beats===12);
 assert.equal(await page.locator('[aria-label="Beats for step 1"]').inputValue(),'12');
 assert.match(await page.locator('#trackCheckpoints button').first().textContent(),/12 beats/);
 assert.equal(await page.locator('.track-checkpoint').nth(1).getAttribute('data-start'),'6000');
 assert.equal(seeks.length,seekCount);
 await resizeTo(20);await page.keyboard.press('Escape');await page.mouse.up();
 assert.equal(await page.evaluate(()=>window.__showTest.showSequence.steps[0].beats),12);
 await resizeTo(8);await page.mouse.up();
 await page.waitForFunction(()=>window.__showTest.showSequence.steps[0].beats===8);
 await handle.focus();await page.keyboard.press('ArrowRight');
 assert.equal(await page.evaluate(()=>window.__showTest.showSequence.steps[0].beats),9);
 await page.keyboard.press('ArrowLeft');
 assert.equal(await page.evaluate(()=>window.__showTest.showSequence.steps[0].beats),8);
 await page.locator('#trackTimelineHide').click();assert.equal(await page.locator('#trackTimeline').isVisible(),false);
 // Hidden means hidden: nothing is left over the picture; the transport button brings it back
 assert.equal(await page.locator('#screenWrap button:visible').count(),0);
 await page.locator('#trackTimelineToggle').click();assert.equal(await page.locator('#trackTimeline').isVisible(),true);



 await page.locator('[aria-label="Copy step 1"]').click();
 track='B';progress=0;playing=true;await poll();
 assert.equal(await page.locator('#showSeqSteps li').count(),0);assert.ok(await page.evaluate(()=>window.__showTest.ap.on));
 await page.locator('#showSeqPaste').click();assert.equal(await page.locator('#showSeqSteps li').count(),1);
 await page.locator('[aria-label="Duplicate step 1"]').click();assert.equal(await page.locator('#showSeqSteps li').count(),2);
 await page.locator('[aria-label="Name for step 2"]').fill('Independent copy');await page.locator('[aria-label="Name for step 2"]').dispatchEvent('change');
 assert.equal(await page.locator('[aria-label="Name for step 1"]').inputValue(),'Intro');
 // Vertical layout and no horizontal overflow, even at phone width.
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('#showSeqSteps li')].map(e=>e.getBoundingClientRect());
  return rows[1].top>rows[0].bottom && document.querySelector('#showSeqSteps').scrollWidth<=document.querySelector('#showSeqSteps').clientWidth+1;
 }));
 await page.setViewportSize({width:1440,height:1000});
 track='A';progress=5000;await poll();
 assert.equal(await page.locator('[aria-label="Name for step 2"]').inputValue(),'Drop');
 assert.equal(await page.evaluate(()=>window.__showTest.showSequence.engine.index),1);
 progress=0;await poll();assert.equal(await page.evaluate(()=>window.__showTest.showSequence.engine.index),0);
 fail=true;await poll();assert.equal(await page.locator('#showSeqSteps li').count(),2);fail=false;
 await page.locator('#trackTimelineHide').click();
 await page.reload();await page.waitForFunction(()=>window.__showTest?.showSequence.song?.uri==='spotify:track:A');await page.evaluate(()=>window.__showTest.spotify.stop());
 assert.equal(await page.locator('[aria-label="Name for step 1"]').inputValue(),'Intro');
 assert.equal(await page.evaluate(()=>window.__showTest.showSequence.engine.index),0);
 assert.equal(await page.locator('#trackTimeline').isVisible(),false);
 await page.locator('#trackTimelineToggle').click();

 account='account-two';await page.evaluate(()=>{window.__showTest.spotify.accountId=null;});await poll();
 assert.equal(await page.locator('#showSeqSteps li').count(),0);assert.ok(await page.evaluate(()=>window.__showTest.ap.on));
 // A real browser-decodable clip is prepared and attached at the song position.
 const video=execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=64x64:d=1:r=10','-c:v','libvpx','-f','webm','pipe:1'],{timeout:10000});
 await page.locator('#showSeqFile').setInputFiles({name:'test.webm',mimeType:'video/webm',buffer:video});
 await page.waitForFunction(()=>window.__showTest.showSequence.ready);
 assert.equal(await page.evaluate(()=>window.__showTest.loops.A.tgt.in1),'video');
 playing=false;await poll();assert.equal(await page.evaluate(()=>[...window.__showTest.showSequence.prepared.values()][0].paused),true);
 playing=true;progress=2000;await poll();await page.waitForFunction(()=>![...window.__showTest.showSequence.prepared.values()][0].paused);
 await page.locator('#sequenceGroup').scrollIntoViewIfNeeded();
 if(process.argv[2]) await page.locator('#stage').screenshot({path:process.argv[2]});
 await page.locator('#spotifyDisconnect').click();assert.equal(await page.locator('#showSeqSong').textContent(),'Standalone sequence');
 assert.equal(await page.evaluate(()=>window.__showTest.spotify.token),null);
 assert.deepEqual(errors,[]);
 console.log('PASS: Spotify queue; song restore/autoplay; pause, seek, skip, repeat; cross-song copy/duplicate; persistence/account isolation; vertical mobile layout; real clip playback; timeline seek/resize/cancel/keyboard; persistent hide toggle; disconnect.');
}finally{await browser?.close();server.closeAllConnections();server.close();input.destroy();}
