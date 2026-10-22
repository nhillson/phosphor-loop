'use strict';
// Shares the clip library with Phosphor Loop on the same computer: a tiny web server on 127.0.0.1 (reachable only
// from this computer) that Phosphor Loop's Clip library button and Autopilot read from. It answers web pages from
// Phosphor Loop's own sites (github.io), from this computer, and from files opened directly; any other website
// gets nothing, so a random page can't list Nick's clips.
//   GET /library.json   the categories and clips (no file paths)
//   GET /clip/<id>      the clip's MP4 (byte ranges supported, for seeking)
//   GET /thumb/<id>     its thumbnail
//   GET /ping           { app, version, open }
// It also takes pages, videos and GIFs sent from Chrome by the Send to Phosphor Clips button (chrome-button/):
//   POST /open          { kind: 'page' | 'video' | 'gif' | 'link' | 'grab', url, title, t, src, referer, marks, d, v }
//                       -> opens it in the app ('grab': straight to a download of the marked part)
//   POST /hello         { v } the button saying it's in Chrome (so the setup helper can say it worked)
// /ping also says which version of the button's files Phosphor Clips has (button), so the button can update itself.
// Only a browser extension may send these (or a program on this computer that says who it is with the
// X-Phosphor-Clips header), so no website can make Phosphor Clips open things.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORTS = [47811, 47812, 47813];
const TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.jpg': 'image/jpeg' };
const MAX_BODY = 16 * 1024;

// Which web pages may read the library
function allowedOrigin(origin) {
  if (!origin) return true;   // typed into the address bar, or a program on this computer
  if (origin === 'null') return true;   // a page opened straight from a file (Phosphor Loop's index.html, say)
  return /^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

// A browser extension: Chrome and Edge (chrome-extension://), Firefox (moz-extension://)
const extensionOrigin = (origin) => /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin || '');
// Who may send things to open: an extension, or (with no Origin at all) a program on this computer that adds the
// X-Phosphor-Clips header. A web page can't send that header here without asking first, and that asking (the
// OPTIONS preflight) is only answered for extensions.
function mayOpen(req) {
  const origin = req.headers.origin;
  if (origin) return extensionOrigin(origin);
  return req.headers['x-phosphor-clips'] === '1';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    // Too much is read to the end and dropped, so the answer (413) still gets back
    req.on('data', (d) => { size += d.length; if (size <= MAX_BODY) parts.push(d); });
    req.on('end', () => {
      if (size > MAX_BODY) reject(Object.assign(new Error('too big'), { status: 413 }));
      else resolve(Buffer.concat(parts).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function handleOpen(req, res, headers, onOpen) {
  const json = (code, o) => { res.writeHead(code, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (!mayOpen(req)) { json(403, { ok: false, message: 'Not allowed' }); return; }
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) { json(e.status || 400, { ok: false, message: 'That wasn\u2019t understood.' }); return; }
  if (!body || typeof body !== 'object' || !/^https?:\/\//i.test(String(body.url || ''))) {
    json(400, { ok: false, message: 'Only web pages (http or https) can be opened.' });
    return;
  }
  if (!onOpen) { json(503, { ok: false, message: 'Phosphor Clips is still starting.' }); return; }
  try {
    const r = (await onOpen(body, req.headers.origin || '')) || { ok: true };
    json(r.ok === false ? 422 : 200, r);
  } catch (e) { json(500, { ok: false, message: e.message || 'Something went wrong.' }); }
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

// getLibrary() returns the open Library (it can change when the library folder is changed). onOpen(request, origin)
// opens something sent from Chrome and returns { ok, message }. onHello(origin) hears the Chrome button say hello.
function startServer({ getLibrary, onOpen = null, onHello = null, pingInfo = null, version = '', log = () => {}, ports = PORTS }) {
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    let p = '';
    try { p = new URL(req.url, 'http://127.0.0.1').pathname; } catch (_) { res.writeHead(400); res.end(); return; }
    const isOpen = p === '/open' || p === '/hello';
    // The Chrome button may only ask whether the app is there and send things to open
    const ok = isOpen ? !origin || extensionOrigin(origin) : allowedOrigin(origin) || (p === '/ping' && extensionOrigin(origin));
    const headers = { 'Vary': 'Origin' };
    if (origin) {
      if (!ok) { res.writeHead(403); res.end(); return; }
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges';
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...headers, 'Access-Control-Allow-Methods': isOpen ? 'POST' : 'GET, HEAD',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
        // Browsers check this before a website may talk to a program on this computer
        'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Local-Network': 'true', 'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
    if (isOpen) {
      if (req.method !== 'POST') { res.writeHead(405, { ...headers, Allow: 'POST' }); res.end(); return; }
      if (p === '/hello') {
        const yes = mayOpen(req);
        readBody(req).then((text) => { let b = {}; try { b = JSON.parse(text || '{}') || {}; } catch (_) { /* fine */ } return b; }, () => ({})).then((b) => {
          if (yes && onHello) { try { onHello(origin || '', b); } catch (_) { /* fine */ } }
          res.writeHead(yes ? 200 : 403, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: yes, app: 'Phosphor Clips', version }));
        });
        return;
      }
      handleOpen(req, res, headers, onOpen).catch((e) => { log('open: ' + e.message); try { res.writeHead(500); res.end(); } catch (_) { /* gone */ } });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers); res.end(); return; }
    const lib = getLibrary();
    if (p === '/ping') {
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      let extra = {};
      try { extra = (pingInfo && pingInfo()) || {}; } catch (_) { /* fine */ }
      res.end(JSON.stringify({ app: 'Phosphor Clips', version, open: !!onOpen, ...extra }));
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

module.exports = { startServer, allowedOrigin, extensionOrigin, PORTS };
