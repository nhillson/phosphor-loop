// The sequencer under the picture, in a real browser with a stand-in Spotify: songs switching, blocks playing
// onto their loops (blank tracks, crossfades, change lines, each loop's own grading), editing, versions and the
// spectrograph. Waits are by frames. Run: node tests/sequencer-integration.mjs (CHROME_PATH picks the browser).
import {chromium} from 'playwright-core';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createCaptureServer} from '../tools/capture/pipeline.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const input=new PassThrough();input.resume();
const {server}=createCaptureServer({root,input});server.listen(0,'127.0.0.1');await once(server,'listening');
const step=(name)=>console.log('ok -',name);
let browser;
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.setDefaultTimeout(5000);
 await page.addInitScript(()=>{
  window.__phosphorCaptureConfig={width:320,height:180,renderHeight:144};
  sessionStorage.setItem('phosphor-spotify-session-v1',JSON.stringify({access:'fixture',refresh:'fixture',scope:'user-modify-playback-state',expiresAt:Date.now()+3600000}));
 });
 const app=(await readFile(root+'/js/app.js','utf8')).replace('let captureNextAt = 0;','window.__seqTest={seq,seqTick,spotify,snd,ap,loops,mix,loopGrade,TL,KEYS}; let captureNextAt = 0;');
 await page.route('**/js/app.js',r=>r.fulfill({contentType:'text/javascript',body:app}));
 const frames=count=>page.evaluate(count=>new Promise(resolve=>{const next=()=>{if(--count<=0)resolve();else requestAnimationFrame(next);};requestAnimationFrame(next);}),count);
 let track='A',progress=0,playing=true;const seeks=[],calls=[];
 const item=id=>({uri:'spotify:track:'+id,type:'track',name:id==='A'?'Ghosts n Stuff':'Strobe',artists:[{name:'deadmau5'}],duration_ms:id==='A'?180000:120000});
 await page.route('https://api.spotify.com/v1/**',route=>{
  const url=new URL(route.request().url()),path=url.pathname;calls.push(route.request().method()+' '+path);
  if(path==='/v1/me/player/seek'){progress=Number(url.searchParams.get('position_ms'));seeks.push(progress);return route.fulfill({status:204});}
  if(path==='/v1/me/player/play'){playing=true;return route.fulfill({status:204});}
  if(path==='/v1/me/player/pause'){playing=false;return route.fulfill({status:204});}
  const data=path==='/v1/me'?{id:'account-one'}:path.endsWith('/queue')?{currently_playing:item(track),queue:[]}:{currently_playing_type:'track',item:item(track),progress_ms:progress,is_playing:playing};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 const T=(fn,arg)=>page.evaluate(fn,arg);
 const poll=()=>T(()=>window.__seqTest.spotify.poll());
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.waitForFunction(()=>window.__seqTest?.seq.song?.uri==='spotify:track:A');
 await T(()=>window.__seqTest.spotify.stop());
 assert.equal(await page.locator('#drift').count(),0,'Auto-drift is gone');
 assert.ok(await T(()=>window.__seqTest.ap.on),'a song with no sequence runs Autopilot');
 step('song with no sequence runs Autopilot; Auto-drift removed');

 // Open the sequencer: the picture gives up height to it
 const before=await page.locator('#screen').boundingBox();
 await page.click('#seqBtn');await frames(4);
 const after=await page.locator('#screen').boundingBox(),panel=await page.locator('#seq').boundingBox();
 assert.ok(after.height<before.height,'the picture shrinks');assert.ok(after.y+after.height<=panel.y+1,'the picture sits above the panel');
 step('sequencer opens under the picture, which shrinks to make room');

 // Two blocks on track 1 that overlap, one on track 2 later on; track 1's second block has a Zoom line
 await T(()=>{const {seq,TL}=window.__seqTest;
  seq.rec.blocks.push(TL.cleanBlock({id:'a1',track:0,a:0,b:40,label:'Wave',look:{in1:'wave',zoom:0,spin:0},fin:0,fout:0}));
  seq.rec.blocks.push(TL.cleanBlock({id:'a2',track:0,a:30,b:90,label:'Shape',look:{in1:'shape',zoom:60,spin:0},fin:0,fout:0,autos:[{key:'gExposure',pts:[[0,1],[1,1]]}]}));
  seq.rec.blocks.push(TL.cleanBlock({id:'b1',track:1,a:60,b:120,label:'Bars',look:{in1:'bars',zoom:0},fin:0,fout:10,autos:[{key:'spin',pts:[[0,0],[1,1]]}]}));
  seq.dirty=true;});
 await page.click('#seqPlay');await frames(3);
 assert.ok(!(await T(()=>window.__seqTest.ap.on)),'Play takes over from Autopilot');
 // Paused in Spotify while sampling, so the song stays exactly where it's put
 const at=async t=>{progress=t*1000;playing=false;await poll();await frames(3);return T(()=>{const {loops,mix,loopGrade}=window.__seqTest;return {
  a:{...loops.A.tgt},b:{...loops.B.tgt},showA:mix.tgt.showA,showB:mix.tgt.showB,gradeA:loopGrade.A};});};
 let s=await at(10);
 assert.equal(s.a.in1,'wave');assert.ok(s.showA>99);assert.equal(s.showB,0,'track 2 has nothing yet: loop B is blank');
 s=await at(35);
 assert.equal(s.a.in1,'wave');assert.equal(s.a.in2,'shape');assert.ok(Math.abs(s.a.blend-50)<3,'halfway through the crossfade');assert.ok(Math.abs(s.a.zoom-30)<3);
 assert.ok(s.showA>99,'a crossfade keeps the loop fully on');
 s=await at(70);
 assert.equal(s.a.in1,'shape');assert.equal(s.a.zoom,60);assert.equal(s.gradeA.gExposure,Number(await page.getAttribute('#gExposure','max')),'loop A is graded on its own');
 assert.equal(s.b.in1,'bars');assert.ok(Math.abs(s.b.spin-(-100+200*(10/60)))<4,'Spin follows its change line');
 s=await at(115);
 assert.ok(s.showB<60&&s.showB>40,'fading out');
 s=await at(150);
 assert.ok(s.showB<0.5);assert.equal(s.a.in1,'shape','At end: hold last look');
 step('blocks play on their loops: blank tracks, crossfade, change lines, own grading, fades, hold at end');

 // Editing: drag the Bars block to track 3, undo puts it back
 await T(()=>{const v=window.__seqTest.seq.view;v.start=0;v.pps=v.minPps;window.__seqTest.seq.dirty=true;});await frames(2);
 const blk=page.locator('.seq-blk[data-id="b1"]'),box=await blk.boundingBox(),lane2=await page.locator('.seq-lane').nth(2).boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2+30,lane2.y+lane2.height/2,{steps:5});await page.mouse.up();await frames(2);
 let moved=await T(()=>window.__seqTest.seq.rec.blocks.find(b=>b.id==='b1'));
 assert.equal(moved.track,2);assert.ok(moved.a>60);
 await page.click('#seqUndo');await frames(2);
 moved=await T(()=>window.__seqTest.seq.rec.blocks.find(b=>b.id==='b1'));
 assert.equal(moved.track,1);assert.equal(moved.a,60);
 step('drag a block to another track; undo puts it back');

 // Right-click menu has no Duplicate; Change over time lists Loop, Effects and Color grading only
 await page.locator('.seq-blk[data-id="b1"]').click({button:'right'});
 const items=await page.locator('.seq-menu.fixed button').allTextContents();
 assert.ok(!items.some(t=>/Duplicate/.test(t)));assert.ok(items.some(t=>/Change over time/.test(t)));
 await page.locator('.seq-menu.fixed button',{hasText:'Change over time'}).click();
 const groups=await page.locator('.seq-menu.fixed .mh').allTextContents();
 assert.deepEqual(groups,['Loop','Effects','Color grading']);
 await page.keyboard.press('Escape');
 step('right-click menu: copy, paste, change over time, delete');

 // Versions: save, change, load back
 await page.click('#seqSave');await page.fill('#seqSaveName','Main');await page.click('#seqSaveForm button[type=submit]');
 await T(()=>{const {seq}=window.__seqTest;seq.rec.blocks=seq.rec.blocks.filter(b=>b.id!=='a1');seq.dirty=true;});
 await page.click('#seqLoad');await page.locator('#seqLoadMenu button',{hasText:'Main'}).click();await frames(2);
 assert.equal(await T(()=>window.__seqTest.seq.rec.blocks.length),3);
 step('save sequence and load it back');
 // Add current look: no made-up name; the block shows its input. Rename it, then save it to My presets.
 await page.locator('button.seq-card').nth(0).click();
 await page.click('#seqAddCurrent');await frames(2);
 const added=await T(()=>{const {seq}=window.__seqTest;return seq.rec.blocks.find(b=>b.id===seq.selId);});
 assert.equal(added.label,'');
 const shown=await page.locator(`.seq-blk[data-id="${added.id}"]`).getAttribute('title');
 assert.ok(!/Current look/.test(shown)&&/^[A-Z]/.test(shown),'it shows what its loop shows: '+shown);
 await page.locator(`.seq-blk[data-id="${added.id}"]`).click({button:'right',position:{x:10,y:10}});
 await page.locator('.seq-menu.fixed > button',{hasText:'Rename'}).click();
 await page.fill('#seqAskIn','Opening glow');await page.keyboard.press('Enter');await frames(2);
 assert.equal(await T(id=>window.__seqTest.seq.rec.blocks.find(b=>b.id===id).label,added.id),'Opening glow');
 await page.locator(`.seq-blk[data-id="${added.id}"]`).click({button:'right',position:{x:10,y:10}});
 await page.locator('.seq-menu.fixed > button',{hasText:'Save to My presets'}).click();
 assert.equal(await page.inputValue('#seqAskIn'),'Opening glow');
 await page.keyboard.press('Enter');await frames(2);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('phosphor-presets-v1')||localStorage.getItem('phosphor-presets')||'[]'));
 assert.ok(JSON.stringify(saved).includes('Opening glow'),'the look is in My presets');
 await page.click('#seqAddSaved');
 assert.ok(await page.locator('#seqSavedMenu button',{hasText:'Opening glow'}).count(),'and Add saved look offers it');
 await page.keyboard.press('Escape');
 await page.locator(`.seq-blk[data-id="${added.id}"]`).click({position:{x:10,y:10}});await page.keyboard.press('Delete');await frames(2);
 assert.ok(!(await T(id=>window.__seqTest.seq.rec.blocks.some(b=>b.id===id),added.id)));
 step('current looks come in unnamed; rename a block; save its look to My presets');

 // Spectrograph: what the app hears while the song plays fills it in, and is kept for the song
 await T(()=>{const {snd}=window.__seqTest;snd.analyser={fftSize:2048,frequencyBinCount:1024,getByteFrequencyData:b=>b.fill(200)};snd.rate=48000;snd.bins=new Uint8Array(1024).fill(200);});
 progress=20000;playing=true;await poll();await frames(8);
 const heard=await T(()=>{const sp=window.__seqTest.seq.spec;return {at:sp.heard.slice(400,440).some(Boolean)?1:0,before:sp.heard[100]};});
 assert.equal(heard.at,1);assert.equal(heard.before,0);
 await T(()=>{const {snd}=window.__seqTest;snd.analyser=null;snd.bins=null;});
 step('spectrograph fills in from what it hears');

 // Clicking the timeline moves the song in Spotify
 const ruler=await page.locator('#seqRuler').boundingBox();
 await page.mouse.click(ruler.x+ruler.width/2,ruler.y+ruler.height/2);await frames(2);
 assert.ok(seeks.length&&Math.abs(seeks.at(-1)-90000)<3000,'seeks to the middle of the 3-minute song');
 step('click the timeline to seek Spotify');

 // Another song: empty, so Autopilot; back again, and its sequence returns and plays
 track='B';progress=1000;await poll();await frames(2);
 assert.equal(await T(()=>window.__seqTest.seq.rec.blocks.length),0);assert.ok(await T(()=>window.__seqTest.ap.on));
 track='A';progress=12000;await poll();await frames(3);
 assert.equal(await T(()=>window.__seqTest.seq.rec.blocks.length),3);
 assert.ok(await T(()=>window.__seqTest.seq.running));assert.ok(!(await T(()=>window.__seqTest.ap.on)));
 step('each song keeps its own sequence, which starts by itself');

 // Reload: the sequence and its versions are still there
 await page.reload();await page.waitForFunction(()=>window.__seqTest?.seq.song?.uri==='spotify:track:A');
 const kept=await T(()=>({n:window.__seqTest.seq.rec.blocks.length,v:window.__seqTest.seq.rec.versions.map(x=>x.name)}));
 assert.equal(kept.n,3);assert.deepEqual(kept.v,['Main']);
 assert.ok(await page.locator('#seq').isVisible(),'the sequencer stays open');
 step('sequence and versions survive a reload');
 await page.waitForFunction(()=>window.__seqTest.seq.spec.heard.slice(400,440).some(Boolean));
 step('the spectrograph is kept with the song');

 // Record look changes: while the sequence plays, changing loop B's look writes blocks onto track 2
 await page.click('#seqPlay');await frames(2);if(!(await T(()=>window.__seqTest.seq.running)))await page.click('#seqPlay');
 track='A';progress=130000;playing=true;await poll();
 await page.locator('button.seq-card').nth(1).click();
 await page.click('#seqRec');await frames(6);
 await T(()=>{window.__seqTest.loops.B.gen++;});await frames(6);
 await page.click('#seqRec');await frames(2);
 const recd=await T(()=>window.__seqTest.seq.rec.blocks.filter(b=>b.a>=129&&!b.rec).map(b=>[b.track,b.a<b.b,b.label]));
 if(recd.length<2||!recd.every(([t,ok,label])=>t===1&&ok&&label===''))console.log(await T(()=>({blocks:window.__seqTest.seq.rec.blocks.map(b=>[b.label,b.track,b.a,b.b]),running:window.__seqTest.seq.running,playing:window.__seqTest.seq.playing,t:window.__seqTest.seq.t,rec:window.__seqTest.seq.recording})));
 assert.ok(recd.length>=2,'one block per look');assert.ok(recd.every(([t,ok,label])=>t===1&&ok&&label===''),'recorded blocks go on track 2, unnamed');
 step('record look changes writes blocks onto the chosen track');

 // Sizing by hand: the bar between picture and controls, then the picture's corner; both are remembered
 await page.click('#seqHide');await frames(2);
 const split=await page.locator('#deckSplit').boundingBox();
 await page.mouse.move(split.x+3,split.y+300);await page.mouse.down();await page.mouse.move(split.x-117,split.y+300,{steps:4});await page.mouse.up();await frames(3);
 const side=await page.evaluate(()=>document.querySelector('.panel').getBoundingClientRect().width);
 assert.ok(Math.abs(side-500)<12,'controls about 120 px wider: '+side);
 const corner=await page.locator('.rz-c').boundingBox(),c0=await page.locator('#screen').boundingBox();
 await page.mouse.move(corner.x+10,corner.y+10);await page.mouse.down();await page.mouse.move(corner.x-190,corner.y-90,{steps:5});await page.mouse.up();await frames(3);
 const c1=await page.locator('#screen').boundingBox(),btns=await page.locator('#tasteStrip').boundingBox();
 assert.ok(Math.abs(c0.width-200-c1.width)<6&&Math.abs(c0.height-100-c1.height)<6,`picture resized by its corner: ${c0.width}x${c0.height} -> ${c1.width}x${c1.height}`);
 assert.ok(btns.y<c1.y+c1.height+60,'the buttons move up under the smaller picture');
 const right=await page.locator('.rz-r').boundingBox();
 await page.mouse.move(right.x+6,right.y+right.height/2);await page.mouse.down();await page.mouse.move(right.x+46,right.y+right.height/2,{steps:3});await page.mouse.up();await frames(3);
 const c2=await page.locator('#screen').boundingBox();
 assert.ok(Math.abs(c2.width-c1.width-40)<6&&Math.abs(c2.height-c1.height)<2,'the right edge changes width only');
 await page.reload();await page.waitForFunction(()=>window.__seqTest?.seq);await frames(4);
 const c3=await page.locator('#screen').boundingBox();
 assert.ok(Math.abs(c3.width-c2.width)<3&&Math.abs(c3.height-c2.height)<3,'sizes are remembered');
 await page.dblclick('.rz-c');await page.dblclick('#deckSplit');await frames(3);
 const c4=await page.locator('#screen').boundingBox();
 assert.ok(c4.width>c3.width,'double-click goes back to filling the space');
 step('drag to size the controls and the picture; remembered; double-click resets');

 assert.deepEqual(errors,[]);
 console.log('PASS');
} finally { await browser?.close(); server.close(); }
