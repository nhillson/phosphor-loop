import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('../static/silhouette-mask-v2.mp4',import.meta.url));
const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
test('built-in dancer is a silent 16-beat loop with no blank/full-screen frames',()=>{
 const info=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
 assert.equal(info.streams.length,1);const video=info.streams[0];
 assert.equal(video.width,960);assert.equal(video.height,720);assert.equal(video.nb_frames,'480');
 assert.ok(Math.abs(Number(info.format.duration)-16*60/104)<0.001);
 const bytes=execFileSync(ffmpeg,['-v','error','-i',file,'-vf','scale=120:90','-pix_fmt','gray','-f','rawvideo','pipe:1'],{maxBuffer:10*1024*1024});
 const frameSize=120*90;
 assert.equal(bytes.length/frameSize,480);
 for(let frame=0;frame<480;frame++){
  let occupied=0;for(let i=frame*frameSize;i<(frame+1)*frameSize;i++)if(bytes[i]>128)occupied++;
  const coverage=occupied/frameSize;
  assert.ok(coverage>0.015&&coverage<0.25,`Frame ${frame}: ${(coverage*100).toFixed(1)}% coverage`);
 }
});
test('matte has softened fractional coverage at its edges',()=>{
 const bytes=execFileSync(ffmpeg,['-v','error','-i',file,'-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],{maxBuffer:2*1024*1024});
 let soft=0;for(const value of bytes)if(value>12&&value<243)soft++;
 assert.ok(soft>800,`Expected antialiased edges, found ${soft} intermediate pixels`);
});
