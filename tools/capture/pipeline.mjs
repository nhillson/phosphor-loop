import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat, realpath} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';

export function ffmpegArgs(config) {
  const args = ['-hide_banner', '-loglevel', 'warning', '-n', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p', '-r', String(config.fps), '-g', String(config.fps * 2),
    '-b:v', String(config.bitrate), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'];
  if (config.rtmp) args.push('-f', 'flv', config.rtmp);
  else {
    if (extname(config.output).toLowerCase() === '.mp4') args.push('-movflags', '+frag_keyframe+empty_moov');
    args.push(config.output);
  }
  return args;
}

export function createCaptureServer({root, input, maxChunkBytes = 8 * 1024 * 1024}) {
  const token = randomBytes(32).toString('hex');
  let sequence = 0, busy = false, failure;
  const types = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg'};
  input.on('error', error => { failure = error; });
  const server = createServer(async (req, res) => {
    const reply = (status, body = '') => { if (!res.destroyed) res.writeHead(status).end(body); };
    try {
      if (req.url.startsWith('/chunk/')) {
        const supplied = Buffer.from(req.headers['x-capture-token'] || '');
        if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return reply(403);
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return reply(403);
        if (req.method !== 'POST') return reply(405);
        if (busy || req.url !== `/chunk/${sequence}`) return reply(409);
        if (failure || input.destroyed || input.writableEnded) return reply(503);
        busy = true;
        try {
          let total = 0;
          for await (const data of req) {
            total += data.length;
            if (total > maxChunkBytes) { failure = new Error('Chunk too large'); return reply(413); }
            if (!input.write(data)) await once(input, 'drain');
          }
          sequence++;
          reply(204);
        } catch (error) { failure = error; reply(503); }
        finally { busy = false; }
        return;
      }
      if (req.method !== 'GET') return reply(405);
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      // Serve workstation assets only; never expose local state, credentials, or captures.
      if (!/^\/(?:index\.html|phone\.html|qrcode\.js|presets\.json|icon-[\w.-]+|(?:js|styles|nature)\/[^\0]+)?$/.test(pathname)) return reply(404);
      const file = await realpath(resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)));
      if (!file.startsWith(resolve(root) + sep)) return reply(403);
      const info = await stat(file);
      if (!info.isFile()) return reply(404);
      res.writeHead(200, {'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { reply(404); }
  });
  server.requestTimeout = 20000;
  return {server, token, status: () => ({sequence, busy, failure: failure?.message})};
}
