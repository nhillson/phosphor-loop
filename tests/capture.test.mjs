import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createCaptureServer, ffmpegArgs} from '../tools/capture/pipeline.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t, options = {}) {
  const input = new PassThrough();
  const chunks = [];
  input.on('data', data => chunks.push(data));
  const pipeline = createCaptureServer({root, input, ...options});
  pipeline.server.listen(0, '127.0.0.1');
  await once(pipeline.server, 'listening');
  t.after(() => { pipeline.server.closeAllConnections(); pipeline.server.close(); input.destroy(); });
  return {...pipeline, input, chunks, origin: `http://127.0.0.1:${pipeline.server.address().port}`};
}
test('authenticated ordered delivery preserves exact bytes; rejects retries and wrong credentials', async t => {
  const p = await fixture(t);
  const post = (seq, body, token = p.token) => fetch(`${p.origin}/chunk/${seq}`, {method:'POST', headers:{'X-Capture-Token':token}, body});
  assert.equal((await post(0, 'bad', 'no')).status, 403);
  assert.equal((await post(1, 'bad')).status, 409);
  assert.equal((await post(0, new Uint8Array([0, 255, 1]))).status, 204);
  assert.equal((await post(0, 'duplicate')).status, 409);
  assert.equal((await post(1, 'next')).status, 204);
  assert.deepEqual(Buffer.concat(p.chunks), Buffer.from([0,255,1,110,101,120,116]));
});
test('local server serves app but hides private files and traversal', async t => {
  const p = await fixture(t);
  for (const path of ['/', '/js/app.js', '/styles/app.css', '/js/audio/rhythm-worklet.js', '/js/audio/tempo-worker.js', '/vendor/essentia/essentia-wasm.es.js', '/vendor/essentia/essentia.js-core.es.js']) assert.equal((await fetch(p.origin + path)).status, 200);
  for (const path of ['/vendor/essentia/private.json', '/vendor/private.json', '/.git/config', '/.capture-state/audio-route.json', '/captures/show.mp4', '/tools/audio-route.swift', '/js/../package.json', '/js/..%2fpackage.json', '/nature/..%2f.capture-state/audio-route.json']) assert.equal((await fetch(p.origin + path)).status, 404);
  assert.equal((await fetch(p.origin + '/chunk/0', {method:'POST',headers:{'X-Capture-Token':p.token, Origin:'https://example.com'},body:'bad'})).status,403);
});
test('oversized chunks and encoder failure stop delivery', async t => {
  const p = await fixture(t, {maxChunkBytes: 2});
  const response = await fetch(p.origin + '/chunk/0', {method:'POST',headers:{'X-Capture-Token':p.token},body:'large'});
  assert.equal(response.status, 413);
  assert.match(p.status().failure, /too large/);
  assert.equal((await fetch(p.origin + '/chunk/0', {method:'POST',headers:{'X-Capture-Token':p.token},body:'ok'})).status,503);
});
test('FFmpeg requires both streams, preserves existing files, and supports fragmented MP4 and RTMP', () => {
  const args = ffmpegArgs({output:'/tmp/show.mp4',fps:30,bitrate:6000000});
  assert.ok(args.includes('-n'));
  assert.ok(args.includes('0:a:0'));
  assert.ok(args.includes('0:v:0'));
  assert.ok(args.includes('+frag_keyframe+empty_moov'));
  assert.equal(args[args.indexOf('-preset')+1],'fast');
  const live = ffmpegArgs({rtmp:'rtmp://localhost/live/test',fps:30,bitrate:6000000});
  assert.equal(live[live.indexOf('-maxrate')+1],'6000000');
  assert.equal(live[live.indexOf('-bufsize')+1],'12000000');
  assert.equal(live[live.indexOf('-x264-params')+1],'nal-hrd=cbr:force-cfr=1');
  assert.deepEqual(live.slice(-3), ['-f','flv','rtmp://localhost/live/test']);
  const copy = ffmpegArgs({liveDir:'/tmp/live',captureCodec:'h264',fps:60,bitrate:8000000});
  assert.equal(copy[copy.indexOf('-c:v')+1],'copy');
  assert.equal(copy[copy.indexOf('-c:a')+1],'copy');
  assert.ok(!copy.includes('libx264'),'Single-encode capture must never be recompressed.');
  const hls = ffmpegArgs({liveDir:'/tmp/live',fps:30,bitrate:6000000});
  assert.ok(hls.includes('delete_segments+independent_segments+temp_file'));
  assert.equal(hls.at(-1),'/tmp/live/stream.m3u8');
});
test('encoder backpressure delays acknowledgement and rejects concurrent chunks', async t => {
  let release, wrote;
  const writing = new Promise(resolve => {wrote=resolve;});
  const input = new Writable({highWaterMark:1,write(data,encoding,done){release=done;wrote();}});
  t.after(() => input.destroy());
  const p = await fixture(t,{input});
  const post = seq => fetch(`${p.origin}/chunk/${seq}`,{method:'POST',headers:{'X-Capture-Token':p.token},body:'chunk'});
  const first = post(0);
  await writing;
  assert.equal(p.status().sequence,0); assert.equal(p.status().busy,true);
  assert.equal((await post(1)).status,409);
  release(); assert.equal((await first).status,204); assert.equal(p.status().sequence,1);
});
test('live server exposes the manifest and segments, with correct types, while hiding other state', async t => {
  await mkdir(join(root,'.capture-state'),{recursive:true});
  const liveDir = await mkdtemp(join(root,'.capture-state','unit-live-'));
  t.after(() => rm(liveDir,{recursive:true,force:true}));
  await writeFile(join(liveDir,'stream.m3u8'),'#EXTM3U\n');
  await writeFile(join(liveDir,'segment-000000001.ts'),'test');
  await writeFile(join(liveDir,'private.json'),'secret');
  const p = await fixture(t,{liveDir});
  const manifest = await fetch(p.origin+'/live/stream.m3u8');
  assert.equal(manifest.status,200); assert.match(manifest.headers.get('content-type'),/mpegurl/);
  const segment = await fetch(p.origin+'/live/segment-000000001.ts');
  assert.equal(segment.status,200); assert.equal(segment.headers.get('content-type'),'video/mp2t');
  assert.equal((await fetch(p.origin+'/watch')).status,200);
  assert.equal((await fetch(p.origin+'/player.js')).status,200);
  assert.equal((await fetch(p.origin+'/live/private.json')).status,404);
});
