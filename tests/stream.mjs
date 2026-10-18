// Real GPU -> canvas -> browser encoder -> FFmpeg -> HTTP HLS -> browser decoder.
import {chromium} from 'playwright-core';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const exec = promisify(execFile), root = fileURLToPath(new URL('../',import.meta.url));
const reserve = createServer(); reserve.listen(0,'127.0.0.1'); await once(reserve,'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const sender = spawn(process.execPath,['tools/capture/run.mjs','--live','--port',String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});
let logs = '', renderer;
sender.stdout.on('data',data => {logs+=data; if (data.toString().includes('Graphics:')) renderer=data.toString();});
sender.stderr.on('data',data => {logs+=data;});
const exited = new Promise(resolve => sender.on('close',resolve));
let browser;
try {
  await new Promise((resolve,reject) => {
    const ceiling=setTimeout(() => reject(new Error('Stream startup timed out: '+logs)),30000);
    sender.stdout.on('data',() => {if(logs.includes('Watch:')) {clearTimeout(ceiling);resolve();}});
    sender.once('error',error => {clearTimeout(ceiling);reject(error);});
    sender.once('close',code => {clearTimeout(ceiling);reject(new Error(`Sender exited ${code}: ${logs}`));});
  });
  browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage();
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/watch`,{waitUntil:'domcontentloaded',timeout:20000});
  try {
    await page.waitForFunction(() => {const v=document.querySelector('video');return v.readyState>=2 && v.currentTime>1;},null,{polling:'raf',timeout:30000});
  } catch(error) {
    console.error(await page.evaluate(() => {const v=document.querySelector('video');return {error:v.error?.message,ready:v.readyState,time:v.currentTime,status:document.querySelector('#status').textContent,native:v.canPlayType('application/vnd.apple.mpegurl'),hls:Hls.isSupported()};}));
    throw error;
  }
  const pictureHandle = await page.waitForFunction(() => {
    const v=document.querySelector('video'),c=document.createElement('canvas');c.width=64;c.height=36;
    const ctx=c.getContext('2d');ctx.drawImage(v,0,0,64,36);
    const pixels=ctx.getImageData(0,0,64,36).data;
    let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]+pixels[i+1]+pixels[i+2];
    const light=sum/(64*36*3);
    return light>3 ? {width:v.videoWidth,height:v.videoHeight,light} : false;
  },null,{polling:'raf',timeout:20000});
  const picture = await pictureHandle.jsonValue();
  const playableAudio = await page.evaluate(() => {
    const stream=document.querySelector('video').captureStream();
    const count=stream.getAudioTracks().length;
    stream.getTracks().forEach(track=>track.stop());
    return count;
  });
  assert.ok(playableAudio>0,'Chromium player has no decoded audio track; volume control would be disabled.');
  assert.equal(picture.width,1920);assert.equal(picture.height,1080);assert.ok(picture.light>3,JSON.stringify(picture));
  assert.deepEqual(errors,[]);
  assert.ok(renderer && !/SwiftShader|llvmpipe/.test(renderer),'The sender must use real GPU rendering. '+logs);
  const url=`http://127.0.0.1:${port}/live/stream.m3u8`;
  const {stdout}=await exec('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,channels,width,height,avg_frame_rate','-of','json',url],{timeout:15000});
  const streams=JSON.parse(stdout).streams;
  assert.ok(streams.some(s=>s.codec_type==='video'&&s.codec_name==='h264'&&s.avg_frame_rate==='60/1'));
  assert.ok(streams.some(s=>s.codec_type==='audio'&&s.codec_name==='aac'&&s.channels===2));
  console.log(`PASS: real GPU, 1920×1080 at 60 fps H.264, stereo AAC, live HTTP playback with a nonblack picture (brightness ${picture.light.toFixed(1)}).`);
  sender.kill('SIGINT'); assert.equal(await exited,0,logs);
  const performance = logs.match(/Captured \d+ frames \([\d.]+ fps\)/);
  assert.ok(performance,'Missing capture performance summary');
  assert.ok(+performance[0].match(/\(([\d.]+) fps\)/)[1]>=55,'Capture is not sustaining close to 60 unique frames per second: '+performance[0]);
  console.log(performance[0]);
  console.log('PASS: clean stream stop and FFmpeg finalization.');
} finally {
  await browser?.close();
  if(sender.exitCode===null) {
    sender.kill('SIGINT');const ceiling=setTimeout(()=>sender.kill('SIGKILL'),10000);await exited;clearTimeout(ceiling);
  }
}
