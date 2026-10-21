'use strict';
// Test videos made with ffmpeg, and a tiny local web server (with the byte ranges video players and ffmpeg ask for)
// serving them on pages like the ones the app meets on the web.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

function ff(ffmpeg, args) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
}

function makeMedia(dir, ffmpeg) {
  fs.mkdirSync(dir, { recursive: true });
  const has = (f) => fs.existsSync(path.join(dir, f));
  // 20 s of swirling colour with a tone, 1280x720 at 30 fps, H.264 + AAC: the everyday web video
  if (!has('swirl.mp4')) {
    ff(ffmpeg, ['-f', 'lavfi', '-i', 'mandelbrot=s=1280x720:r=30:end_scale=0.05,hue=H=t/2', '-f', 'lavfi', '-i', 'sine=f=330:d=20',
      '-t', '20', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'swirl.mp4')]);
  }
  // 4 s animated GIF
  if (!has('spin.gif')) {
    ff(ffmpeg, ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=15:d=4', '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', path.join(dir, 'spin.gif')]);
  }
  // 12 minutes, small and cheap: long enough that a marked part is downloaded on its own
  if (!has('long.webm')) {
    ff(ffmpeg, ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=10:d=720', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8',
      '-b:v', '60k', '-g', '20', path.join(dir, 'long.webm')]);
  }
  // A clip with an odd size and 120 frames a second, to check the clip comes out even-sized at 60 at most
  if (!has('odd.mkv')) {
    ff(ffmpeg, ['-f', 'lavfi', '-i', 'testsrc2=s=1001x563:r=120:d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(dir, 'odd.mkv')]);
  }
  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
    `<meta name="keywords" content="abstract, fractal"><style>body{margin:0;background:#111;color:#ddd;font:16px sans-serif}` +
    `video{width:960px;display:block;margin:20px auto}</style></head><body>${body}</body></html>`;
  fs.writeFileSync(path.join(dir, 'video.html'), page('Swirling fractal colours - abstract loop',
    '<h1>Swirling fractal colours</h1><video id="v" src="swirl.mp4" autoplay muted loop playsinline controls></video>'));
  fs.writeFileSync(path.join(dir, 'gif.html'), page('A spinning test GIF',
    '<h1>GIF</h1><img id="g" src="spin.gif" width="320" height="240">'));
  fs.writeFileSync(path.join(dir, 'long.html'), page('Twelve minute test pattern',
    '<h1>Long</h1><video id="v" src="long.webm" autoplay muted playsinline controls></video>'));
  fs.writeFileSync(path.join(dir, 'blob.html'), page('Nothing to grab here', '<h1>No video on this page</h1>'));
  return dir;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif', '.mkv': 'video/x-matroska', '.jpg': 'image/jpeg' };

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const f = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''));
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      const size = fs.statSync(f).size;
      const type = TYPES[path.extname(f)] || 'application/octet-stream';
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const start = range[1] ? +range[1] : size - +range[2];
        const end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
        if (start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
        res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(f, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(f).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() }));
  });
}

module.exports = { makeMedia, serve };
