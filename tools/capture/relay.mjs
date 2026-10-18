// Forward the already-encoded local stream without rendering or encoding again.
import {spawn} from 'node:child_process';
const destination=process.env.PHOSPHOR_RTMP_URL;
if (!/^rtmps?:\/\//.test(destination||'')) throw new Error('Set PHOSPHOR_RTMP_URL to the complete RTMP(S) destination.');
const key=new URL(destination).pathname.split('/').filter(Boolean).at(-1);
const redact=text=>{
  const safe=text.split(destination).join('[RTMP destination]');
  return key?safe.split(key).join('[stream key]'):safe;
};
const source=process.env.PHOSPHOR_SOURCE_URL||'http://127.0.0.1:8787/live/stream.m3u8';
const encoder=spawn(process.env.FFMPEG_PATH||'ffmpeg',[
  '-hide_banner','-loglevel','warning','-re','-rw_timeout','15000000','-live_start_index','-1','-i',source,
  '-map','0:v:0','-map','0:a:0','-c','copy','-rw_timeout','15000000',
  '-progress','pipe:1','-stats_period','2','-f','flv',destination,
],{stdio:['ignore','pipe','pipe']});
let progress='',errors='',connected=false;
encoder.stdout.on('data',data=>{
  progress+=data.toString();let end;
  while((end=progress.indexOf('\n'))>=0){
    const line=progress.slice(0,end).trim();progress=progress.slice(end+1);
    if(!connected&&/^frame=\s*[1-9]\d*$/.test(line)){
      connected=true;console.log('RTMPS connected: sending the current H.264 video and AAC audio without re-encoding.');
    }
  }
});
// Redact whole lines so keys split between stderr chunks cannot leak.
encoder.stderr.on('data',data=>{
  errors+=data.toString();let end;
  while((end=errors.indexOf('\n'))>=0){console.error(redact(errors.slice(0,end)));errors=errors.slice(end+1);}
});
const stop=()=>encoder.kill('SIGINT');
process.on('SIGINT',stop);process.on('SIGTERM',stop);
encoder.on('error',error=>{console.error(redact(error.message));process.exitCode=1;});
encoder.on('close',code=>{
  if(errors)console.error(redact(errors));
  console.log(connected?'Remote stream forwarding stopped.':'Remote connection did not start.');
  process.exitCode=code===0||code===255?0:1;
  process.off('SIGINT',stop);process.off('SIGTERM',stop);
});
