// Verify RTMP delivery against a local FFmpeg receiver; no external service/key.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
await mkdir(resolve(root,'captures'),{recursive:true});
const file=resolve(root,`captures/rtmp-test-${Date.now()}.mkv`),url=`rtmp://127.0.0.1:${port}/live/check`;
const receiver=spawn('ffmpeg',['-hide_banner','-loglevel','warning','-listen','1','-i',url,'-map','0','-c','copy','-progress','pipe:1','-nostats',file],{stdio:['ignore','pipe','pipe']});
const received=new Promise(resolve=>receiver.on('close',resolve));
let receiverLog='',progress='';receiver.stderr.on('data',data=>receiverLog+=data);
const enough=new Promise((resolve,reject)=>{
  receiver.stdout.on('data',data=>{progress+=data;const frames=[...progress.matchAll(/frame=(\d+)/g)];if(frames.some(m=>+m[1]>=120))resolve();});
  receiver.once('error',reject);
  receiver.once('close',code=>reject(new Error(`Receiver exited ${code}: ${receiverLog}`)));
});
const sender=spawn(process.execPath,['tools/capture/run.mjs','--rtmp'],{cwd:root,env:{...process.env,PHOSPHOR_RTMP_URL:url},stdio:['ignore','pipe','pipe']});
const sent=new Promise(resolve=>sender.on('close',resolve));
let senderLog='';sender.stdout.on('data',data=>senderLog+=data);sender.stderr.on('data',data=>senderLog+=data);
let ceiling;
try {
 await Promise.race([enough,new Promise((_,reject)=>{ceiling=setTimeout(()=>reject(new Error('RTMP receive timed out: '+senderLog+'\n'+receiverLog)),45000);})]);
 clearTimeout(ceiling);
 sender.kill('SIGINT');assert.equal(await sent,0,senderLog);
 const receiverCeiling=setTimeout(()=>receiver.kill('SIGINT'),5000);
 await received;clearTimeout(receiverCeiling);
 const {stdout}=await exec('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,channels,width,height','-of','json',file]);
 const streams=JSON.parse(stdout).streams;
 assert.ok(streams.some(s=>s.codec_name==='h264'&&s.width===1280&&s.height===720));
 assert.ok(streams.some(s=>s.codec_name==='aac'&&s.channels===2));
 assert.ok(!senderLog.includes(url),'RTMP destination leaked in sender logs');
 console.log('PASS: local RTMP receiver got at least 120 video frames, 720p H.264, and stereo AAC; sender stopped cleanly.');
}finally{
 clearTimeout(ceiling);
 if(sender.exitCode===null){sender.kill('SIGINT');const t=setTimeout(()=>sender.kill('SIGKILL'),5000);await sent;clearTimeout(t);}
 if(receiver.exitCode===null){receiver.kill('SIGINT');const t=setTimeout(()=>receiver.kill('SIGKILL'),5000);await received;clearTimeout(t);}
}
