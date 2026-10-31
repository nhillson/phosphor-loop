'use strict';
// Snips from Phosphor Loop: a part of the video playing there (Video input › Repeat a section › Save to clip
// library), cut out and filed in the library like any clip saved in the trimmer.
//   From a library clip: Phosphor Loop sends only the clip's id and the marks; the cut is made from the file here.
//   From a video of your own: Phosphor Loop sends the file itself (it's on the same computer, so this is quick),
//   which is cut and then thrown away. Only the snip is kept.
// The cut is the same as the trimmer's: H.264 MP4, up to 1080p (or the size picked in the trimmer last), at most
// 60 fps, sound only when asked for. A snip of a library clip carries the clip's credit (source, by, licence).
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const E = require('./engine.js');

const MAX_UPLOAD = 8 * 1024 * 1024 * 1024;   // a video sent from Phosphor Loop: up to 8 GB
const MIN_LEN = 0.2;
const round3 = (n) => Math.round(n * 1000) / 1000;

class SnipError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// What Phosphor Loop asked for, from the address's ?from=&start=&end=&name=&cat=&sound=&src=&tags=
function readAsk(params) {
  const num = (k) => (params.has(k) && params.get(k) !== '' ? +params.get(k) : null);
  const ask = {
    from: (params.get('from') || '').trim(),
    start: num('start'), end: num('end'),
    name: String(params.get('name') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    cat: String(params.get('cat') || '').trim(),
    sound: params.get('sound') === '1',
    // Where a video of your own came from (its file name), kept as the clip's page title
    src: String(params.get('src') || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    // Tags, comma separated (the effects come separately, in a POST to /clip/<id>: they're too big for an address)
    tags: String(params.get('tags') || ''),
  };
  if (ask.from && !/^[a-z0-9-]+$/i.test(ask.from)) throw new SnipError('That clip isn’t in the library.');
  if (ask.start == null || !Number.isFinite(ask.start) || ask.start < 0) throw new SnipError('Mark where the snip starts.');
  if (ask.end != null && (!Number.isFinite(ask.end) || ask.end <= ask.start)) throw new SnipError('The end has to come after the start.');
  return ask;
}

// Writes the request's body (the video) into file, up to MAX_UPLOAD
function saveBody(req, file) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const out = fs.createWriteStream(file);
    const fail = (e) => { if (done) return; done = true; out.destroy(); req.resume(); reject(e); };
    req.on('data', (d) => { size += d.length; if (size > MAX_UPLOAD) fail(new SnipError('That video is too big to send (8 GB at most).', 413)); });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => { if (!done) { done = true; resolve(size); } });
    req.pipe(out);
  });
}

// Makes the snip. tools: ffmpeg/ffprobe; library: the open Library; work: a folder for the in-between files;
// req: the request (its body is the video when there's no `from`); settings: { maxHeight }.
// Returns the new clip as the library lists it, plus its category's name.
async function makeSnip({ tools, library, work, req, ask, settings = {}, log = () => {} }) {
  if (!library) throw new SnipError('The clip library isn’t open yet.', 503);
  const cat = library.cat(ask.cat) || library.cat('other') || library.data.cats[0];
  if (!cat) throw new SnipError('Make a category in Phosphor Clips first.');
  const dir = path.join(work, 'snip-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  await fsp.mkdir(dir, { recursive: true });
  try {
    let src, from = null;
    if (ask.from) {
      req.resume();
      from = library.data.clips.find((c) => c.id === ask.from);
      if (!from) throw new SnipError('That clip isn’t in the library any more.', 404);
      src = library.abs(from);
      if (!fs.existsSync(src)) throw new SnipError('That clip’s file has gone (moved or deleted).', 404);
    } else {
      src = path.join(dir, 'source');
      const size = await saveBody(req, src);
      if (!size) throw new SnipError('No video came with the snip.');
    }
    const p = await E.probe(tools, src);
    const end = Math.min(ask.end == null ? p.duration : ask.end, p.duration || ask.end);
    if (!(end - ask.start >= MIN_LEN)) throw new SnipError('The snip is too short (or starts after the video ends).');
    const out = path.join(dir, 'snip.mp4');
    const made = await E.cutClip(tools, src, out, { start: ask.start, end, keepSound: ask.sound, maxHeight: +settings.maxHeight || 1080, log });
    // A snip of a snip still says which part of the original it is
    const off = from && Array.isArray(from.part) ? from.part[0] : 0;
    const name = ask.name || (from ? from.n + ' (snip)' : ask.src ? ask.src.replace(/\.[^.]+$/, '') + ' (snip)' : 'Snip');
    const clip = await library.addClip(made.file, {
      n: name, c: cat.id,
      d: made.probe.duration, w: made.probe.width, h: made.probe.height, fps: made.probe.fps, sound: made.sound,
      src: from ? from.src || '' : '', page: from ? from.page || from.n : ask.src, by: from ? from.by || '' : '',
      lic: from ? from.lic || '' : '', site: from ? from.site || '' : '',
      part: from ? [round3(off + ask.start), round3(off + end)] : [round3(ask.start), round3(end)],
      tags: ask.tags,
      thumbAt: made.probe.duration / 2,
    });
    log(`snip: saved ${clip.f} (${clip.w}x${clip.h}, ${clip.d} s, ${made.encoder}) from ${from ? 'clip ' + from.f : 'a video sent from Phosphor Loop'}`);
    return { clip, catName: cat.n };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { readAsk, makeSnip, SnipError, MAX_UPLOAD };
