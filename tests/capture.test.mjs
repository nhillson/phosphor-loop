import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
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
  for (const path of ['/', '/js/app.js', '/styles/app.css']) assert.equal((await fetch(p.origin + path)).status, 200);
  for (const path of ['/.git/config', '/.capture-state/audio-route.json', '/captures/show.mp4', '/tools/audio-route.swift', '/js/../package.json']) assert.equal((await fetch(p.origin + path)).status, 404);
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
  const live = ffmpegArgs({rtmp:'rtmp://localhost/live/test',fps:30,bitrate:6000000});
  assert.deepEqual(live.slice(-3), ['-f','flv','rtmp://localhost/live/test']);
});
