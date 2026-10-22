'use strict';
// Shares the clip library with Phosphor Loop on the same computer: a tiny web server on 127.0.0.1 (reachable only
// from this computer) that Phosphor Loop's Clip library button and Autopilot read from. It answers web pages from
// Phosphor Loop's own sites (github.io), from this computer, and from files opened directly; any other website
// gets nothing, so a random page can't list Nick's clips.
//   GET /library.json   the categories and clips (no file paths)
//   GET /clip/<id>      the clip's MP4 (byte ranges supported, for seeking)
//   GET /thumb/<id>     its thumbnail
//   GET /ping           { app, version }
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORTS = [47811, 47812, 47813];
const TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.jpg': 'image/jpeg' };

// Which web pages may read the library
function allowedOrigin(origin) {
  if (!origin) return true;   // typed into the address bar, or a program on this computer
  if (origin === 'null') return true;   // a page opened straight from a file (Phosphor Loop's index.html, say)
  return /^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

function libraryJson(lib, version) {
  const d = lib.data;
  return {
    app: 'Phosphor Clips', version,
    cats: d.cats.map((c) => ({ id: c.id, n: c.n, count: d.clips.filter((x) => x.c === c.id).length })),
    clips: d.clips.map((c) => ({
      id: c.id, n: c.n, c: c.c, d: c.d, w: c.w, h: c.h, fps: c.fps, sound: !!c.sound, thumb: !!c.t,
      by: c.by || '', lic: c.lic || '', src: c.src || '', page: c.page || '', added: c.added || '',
    })),
  };
}

function sendFile(req, res, file, headers) {
  let st;
  try { st = fs.statSync(file); } catch (_) { res.writeHead(404, headers); res.end(); return; }
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const size = st.size;
  const base = { ...headers, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Last-Modified': st.mtime.toUTCString() };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  let start = 0, end = size - 1, code = 200;
  if (m) {
    start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
    end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` }); res.end(); return; }
    code = 206;
    base['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  base['Content-Length'] = end - start + 1;
  res.writeHead(code, base);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

// getLibrary() returns the open Library (it can change when the library folder is changed)
function startServer({ getLibrary, version = '', log = () => {}, ports = PORTS }) {
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const headers = { 'Vary': 'Origin' };
    if (origin) {
      if (!allowedOrigin(origin)) { res.writeHead(403); res.end(); return; }
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges';
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...headers, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
        // Browsers check this before a website may talk to a program on this computer
        'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Local-Network': 'true', 'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers); res.end(); return; }
    const lib = getLibrary();
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch (_) { res.writeHead(400, headers); res.end(); return; }
    const p = url.pathname;
    if (p === '/ping') {
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ app: 'Phosphor Clips', version }));
      return;
    }
    if (!lib) { res.writeHead(503, headers); res.end(); return; }
    if (p === '/library.json') {
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(libraryJson(lib, version)));
      return;
    }
    const m = /^\/(clip|thumb)\/([a-z0-9-]+)$/i.exec(p);
    if (m) {
      const clip = lib.data.clips.find((c) => c.id === m[2]);
      if (!clip) { res.writeHead(404, headers); res.end(); return; }
      const file = m[1] === 'clip' ? lib.abs(clip) : lib.thumbAbs(clip);
      if (!file) { res.writeHead(404, headers); res.end(); return; }
      sendFile(req, res, file, headers);
      return;
    }
    res.writeHead(404, headers);
    res.end();
  });
  server.on('clientError', (_e, socket) => { try { socket.destroy(); } catch (_) { /* gone */ } });
  return new Promise((resolve) => {
    let i = 0;
    const tryNext = () => {
      if (i >= ports.length) { log('library sharing: no free port (' + ports.join(', ') + ')'); resolve(null); return; }
      const port = ports[i++];
      server.once('error', (e) => { log('library sharing: port ' + port + ' ' + e.code); tryNext(); });
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error');
        server.on('error', (e) => log('library sharing: ' + e.message));
        const actual = server.address().port;
        log('library sharing on http://127.0.0.1:' + actual);
        resolve({ server, port: actual, close: () => server.close() });
      });
    };
    tryNext();
  });
}

module.exports = { startServer, allowedOrigin, PORTS };
