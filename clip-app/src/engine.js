'use strict';
// Phosphor Clips engine: getting a video off a web page (yt-dlp, or straight from a video or GIF link), making it
// playable for the trimmer, and cutting the chosen part into a clean MP4 with ffmpeg. No Electron in here, so the
// tests run it with plain Node.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawn } = require('node:child_process');

const IS_WIN = process.platform === 'win32';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// Seconds kept either side of a marked part, so the trimmer has room to adjust
const PAD = 3;

class ClipError extends Error {
  constructor(message, code = 'failed', detail = '') { super(message); this.code = code; this.detail = detail; }
}
const cancelled = () => new ClipError('Stopped.', 'cancelled');

/* ---------------------------------------------------------------------------------------------------------------
   The helper programs: ffmpeg and ffprobe (video), yt-dlp (getting videos off web pages) and Deno (which yt-dlp
   needs for YouTube). Found next to the app, in CLIPS_* settings, or on the PATH.
   --------------------------------------------------------------------------------------------------------------- */
function findTools(dirs = []) {
  const name = (b) => (IS_WIN ? b + '.exe' : b);
  const pick = (envName, base) => {
    const fromEnv = process.env[envName];
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
    for (const d of dirs) { const p = path.join(d, name(base)); if (d && fs.existsSync(p)) return p; }
    for (const d of String(process.env.PATH || '').split(path.delimiter)) {
      if (!d) continue;
      const p = path.join(d, name(base));
      if (fs.existsSync(p)) return p;
    }
    return '';
  };
  return {
    ffmpeg: pick('CLIPS_FFMPEG', 'ffmpeg'), ffprobe: pick('CLIPS_FFPROBE', 'ffprobe'),
    ytdlp: pick('CLIPS_YTDLP', 'yt-dlp'), deno: pick('CLIPS_DENO', 'deno'),
  };
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch (_) { try { child.kill('SIGKILL'); } catch (__) { /* already gone */ } }
}

// Runs a program, handing each line it prints to onLine/onErrLine. Resolves { code, stdout, stderr }.
function run(cmd, args, { onLine, onErrLine, signal, cwd, log } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(cancelled()); return; }
    if (log) log('run: ' + path.basename(cmd) + ' ' + args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
    let child;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true, detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { reject(new ClipError('Couldn’t start ' + path.basename(cmd) + '.', 'failed', e.message)); return; }
    let out = '', err = '';
    const keep = (s, d, max) => { s += d; return s.length > max ? s.slice(-max) : s; };
    const lines = (stream, cb, store) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (d) => {
        store(d);
        if (!cb) return;
        buf += d;
        let i;
        while ((i = buf.search(/[\r\n]/)) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) cb(line);
        }
      });
      stream.on('end', () => { if (cb && buf.trim()) cb(buf); });
    };
    lines(child.stdout, onLine, (d) => { out = keep(out, d, 64e6); });
    lines(child.stderr, onErrLine, (d) => { err = keep(err, d, 2e5); });
    const onAbort = () => killTree(child);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new ClipError('Couldn’t start ' + path.basename(cmd) + '.', 'failed', e.message));
    });
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) { reject(cancelled()); return; }
      resolve({ code, stdout: out, stderr: err });
    });
  });
}

/* ---------------------------------------------------------------------------------------------------------------
   Looking at a video file
   --------------------------------------------------------------------------------------------------------------- */
const ratio = (s) => {
  const m = /^(\d+)[:/](\d+)$/.exec(String(s || ''));
  if (!m || !+m[2] || !+m[1]) return 0;
  return +m[1] / +m[2];
};

async function probe(tools, file, { signal } = {}) {
  const r = await run(tools.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { signal });
  if (r.code !== 0) throw new ClipError('That file isn’t a video this app can read.', 'unreadable', r.stderr.slice(-500));
  let j;
  try { j = JSON.parse(r.stdout); } catch (_) { throw new ClipError('That file isn’t a video this app can read.', 'unreadable'); }
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  if (!v) throw new ClipError('There’s no picture in that file.', 'unreadable');
  let rot = 0;
  for (const sd of v.side_data_list || []) if (typeof sd.rotation === 'number') rot = sd.rotation;
  if (v.tags && v.tags.rotate) rot = +v.tags.rotate || rot;
  const sar = ratio(v.sample_aspect_ratio) || 1;
  let w = Math.round((+v.width || 0) * sar), h = +v.height || 0;
  if (Math.abs(rot) % 180 === 90) [w, h] = [h, w];
  let fps = ratio(v.avg_frame_rate) || ratio(v.r_frame_rate) || 30;
  if (fps > 240) fps = ratio(v.r_frame_rate) || 30;
  let duration = +(j.format && j.format.duration) || +v.duration || 0;
  return {
    duration, width: w, height: h, fps: Math.round(fps * 1000) / 1000,
    vcodec: v.codec_name || '', acodec: a ? a.codec_name || '' : '', hasAudio: !!a,
    format: (j.format && j.format.format_name) || '', frames: +v.nb_frames || 0,
  };
}

/* ---------------------------------------------------------------------------------------------------------------
   Getting a video off the web
   --------------------------------------------------------------------------------------------------------------- */
const DIRECT_EXT = /\.(mp4|m4v|webm|mov|mkv|ogv|gif|gifv|webp|avif)(?:[?#]|$)/i;
const isDirectLink = (url) => {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) && DIRECT_EXT.test(u.pathname); } catch (_) { return false; }
};

// Plain-English reasons for yt-dlp's errors
function explainYtdlp(stderr) {
  const s = String(stderr || '');
  const tail = s.split(/\r?\n/).filter((l) => /ERROR/.test(l)).slice(-2).join(' ').slice(0, 400) || s.slice(-400);
  if (/Unsupported URL|No video formats found|no suitable InfoExtractor|Unable to extract|not a valid URL/i.test(s)) {
    return new ClipError('No video was found at that link.', 'unsupported', tail);
  }
  if (/Sign in|log ?in|logged[- ]in|registered users|cookies|members[- ]only|age[- ]restricted|confirm your age|private video/i.test(s)) {
    return new ClipError('That site wants you signed in first. Sign in to it in the browser on the left, then grab again.', 'login', tail);
  }
  if (/Video unavailable|has been removed|no longer available|This video is not available|HTTP Error 404/i.test(s)) {
    return new ClipError('That video isn’t available any more.', 'unavailable', tail);
  }
  if (/geo|not available in your country/i.test(s)) return new ClipError('That video isn’t available in your country.', 'unavailable', tail);
  if (/is live|live event|Premieres in/i.test(s)) return new ClipError('Live streams can’t be grabbed. Grab it once it’s finished.', 'live', tail);
  if (/HTTP Error 403|Forbidden/i.test(s)) return new ClipError('The site refused the download. Try again in a minute.', 'forbidden', tail);
  if (/timed out|Unable to download|getaddrinfo|Connection|network|SSL/i.test(s)) {
    return new ClipError('The download didn’t get through. Check the internet connection and try again.', 'network', tail);
  }
  return new ClipError('That video couldn’t be grabbed.', 'failed', tail);
}

function ytdlpBase(tools, { cookies } = {}) {
  const a = ['--no-colors', '--no-playlist', '--socket-timeout', '20', '--retries', '3', '--fragment-retries', '5'];
  if (tools.ffmpeg) a.push('--ffmpeg-location', path.dirname(tools.ffmpeg));
  if (tools.deno) a.push('--js-runtimes', 'deno:' + tools.deno);
  if (cookies && fs.existsSync(cookies)) a.push('--cookies', cookies);
  return a;
}

// What yt-dlp knows about the video at a link. Writes info.json in jobDir for the download that follows.
async function videoInfo(tools, url, jobDir, { cookies, signal, log } = {}) {
  if (!tools.ytdlp) throw new ClipError('The video downloader is missing. Reinstall Phosphor Clips.', 'failed');
  const r = await run(tools.ytdlp, [...ytdlpBase(tools, { cookies }), '--dump-single-json', url], { signal, log });
  if (r.code !== 0 || !r.stdout.trim()) throw explainYtdlp(r.stderr);
  let info;
  try { info = JSON.parse(r.stdout); } catch (_) { throw explainYtdlp(r.stderr); }
  if (info._type === 'playlist') {
    const entries = (info.entries || []).filter(Boolean);
    if (entries.length === 1) info = entries[0];
    else throw new ClipError('That link is a list of videos. Open just the one you want, then grab it.', 'playlist');
  }
  const file = path.join(jobDir, 'info.json');
  await fsp.writeFile(file, JSON.stringify(info));
  return { info, file };
}

// The parts of yt-dlp's information the app keeps
function summarize(info, url) {
  let title = String(info.title || info.fulltitle || '').trim();
  // yt-dlp numbers the videos it finds on an ordinary page: "Page title (1)"
  if (/generic|html5/i.test(info.extractor_key || info.extractor || '')) title = title.replace(/\s+\(\d+\)$/, '');
  return {
    title,
    by: String(info.uploader || info.channel || info.creator || info.artist || '').trim(),
    url: info.webpage_url || info.original_url || url,
    lic: String(info.license || '').trim(),
    duration: +info.duration || 0,
    live: !!info.is_live,
    tags: Array.isArray(info.tags) ? info.tags.slice(0, 60) : [],
    categories: Array.isArray(info.categories) ? info.categories.slice(0, 10) : [],
    description: String(info.description || '').slice(0, 2000),
    site: String(info.extractor_key || info.extractor || '').replace(/^(Generic|HTML5MediaEmbed|html5)$/i, ''),
  };
}

const FORMAT = 'bv*[height<=?{H}]+ba/b[height<=?{H}]/bv*+ba/b';

// Downloads the video (or only its part from..to, in seconds). Returns the downloaded file.
// sponsors: cut out a YouTube video's sponsor parts (only for a whole video, so the marks and the trimmer agree)
async function downloadWithYtdlp(tools, infoFile, jobDir, { maxHeight = 1080, section, cookies, sponsors, signal, log, onProgress } = {}) {
  const args = [...ytdlpBase(tools, { cookies }), '--load-info-json', infoFile,
    '-f', FORMAT.replace(/\{H\}/g, String(maxHeight)), '-S', `res:${maxHeight},fps:60,vcodec:h264,acodec:m4a`,
    '--merge-output-format', 'mp4/mkv', '-o', path.join(jobDir, 'source.%(ext)s'), '--no-mtime', '--no-part',
    '--newline', '--progress', '--progress-delta', '0.5',
    '--progress-template', 'download:@@P %(progress._percent_str)s|%(progress._eta_str)s',
    '--print', 'after_move:@@F %(filepath)s'];
  if (section) args.push('--download-sections', `*${section[0].toFixed(2)}-${section[1].toFixed(2)}`);
  else if (sponsors) args.push('--sponsorblock-remove', 'sponsor,selfpromo,interaction');
  let file = '', part = 0, lastPct = -1;
  const r = await run(tools.ytdlp, args, {
    signal, log,
    onLine: (line) => {
      if (line.startsWith('@@F ')) { file = line.slice(4).trim(); return; }
      if (line.startsWith('@@P ')) {
        const [pct, eta] = line.slice(4).split('|');
        const p = parseFloat(pct);
        if (Number.isFinite(p)) {
          if (p < lastPct - 20) part++;   // the sound comes after the picture: a second download from 0
          lastPct = p;
          if (onProgress) onProgress({ pct: p, eta: (eta || '').trim(), part });
        }
      }
    },
    onErrLine: (line) => { if (log && /ERROR|WARNING/.test(line)) log('yt-dlp: ' + line.slice(0, 300)); },
  });
  if (r.code !== 0) throw explainYtdlp(r.stderr);
  if (!file || !fs.existsSync(file)) {
    const found = (await fsp.readdir(jobDir)).find((f) => /^source\./.test(f) && !/\.(json|part|ytdl)$/.test(f));
    if (found) file = path.join(jobDir, found);
  }
  if (!file) throw new ClipError('The download finished but no video came out.', 'failed', r.stderr.slice(-400));
  return file;
}

// Straight download of a video or GIF link
async function downloadDirect(url, jobDir, { referer, cookieHeader, signal, onProgress, log } = {}) {
  if (log) log('direct download: ' + url);
  const headers = { 'User-Agent': UA, Accept: '*/*' };
  if (referer) headers.Referer = referer;
  if (cookieHeader) headers.Cookie = cookieHeader;
  let res;
  try { res = await fetch(url, { headers, redirect: 'follow', signal }); } catch (e) {
    if (signal && signal.aborted) throw cancelled();
    throw new ClipError('The download didn’t get through. Check the internet connection and try again.', 'network', e.message);
  }
  if (!res.ok) throw new ClipError('The site refused the download (' + res.status + ').', res.status === 404 ? 'unavailable' : 'forbidden');
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (/text\/html|application\/json|text\/plain/.test(type)) {
    try { await res.body.cancel(); } catch (_) { /* fine */ }
    throw new ClipError('No video was found at that link.', 'unsupported', 'content-type ' + type);
  }
  let ext = (/\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(new URL(res.url || url).pathname) || [])[1] || '';
  ext = ext.toLowerCase();
  if (ext === 'gifv') ext = 'mp4';
  if (/image\/gif/.test(type)) ext = 'gif';
  else if (/video\/webm/.test(type)) ext = 'webm';
  else if (/video\/mp4/.test(type) && !ext) ext = 'mp4';
  else if (/image\/webp/.test(type)) ext = 'webp';
  if (!ext || ext.length > 4) ext = 'mp4';
  const file = path.join(jobDir, 'source.' + ext);
  const total = +res.headers.get('content-length') || 0;
  const outStream = fs.createWriteStream(file);
  let got = 0, lastSent = 0;
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!outStream.write(chunk)) await new Promise((r) => outStream.once('drain', r));
      if (onProgress && total && got - lastSent > 256 * 1024) { lastSent = got; onProgress({ pct: (100 * got) / total, part: 0 }); }
    }
  } catch (e) {
    outStream.destroy();
    if (signal && signal.aborted) throw cancelled();
    throw new ClipError('The download was cut off. Try again.', 'network', e.message);
  }
  await new Promise((r, j) => outStream.end((e) => (e ? j(e) : r())));
  if (got < 1024) throw new ClipError('No video was found at that link.', 'unsupported', 'only ' + got + ' bytes');
  return file;
}

/* ---------------------------------------------------------------------------------------------------------------
   Turning anything into something the trimmer can play. Chromium plays MP4 and WebM with H.264, VP8/9 or AV1;
   GIFs and other files get a quick, high-quality H.264 copy.
   --------------------------------------------------------------------------------------------------------------- */
const PLAYABLE_V = ['h264', 'vp8', 'vp9', 'av1'];
const PLAYABLE_A = ['aac', 'opus', 'vorbis', 'mp3', 'flac'];

// Stickers (GIFs with see-through parts, as GIPHY's stickers are). A video can't keep see-through parts, so a
// sticker's clip is made twice as tall: the sticker on black on top, and under it its see-through map (white where
// it's solid, black where it's see-through). Phosphor Loop puts the two back together as it plays (stickerUnpack
// in its js/app.js) and knows such a clip by its "sticker" tag. The trimmer shows the sticker on black as before.
const STICKER_TAG = 'sticker';
// (ffv1: the frames of a picture ffmpeg couldn't read itself, see picturesToVideo)
const PICTURE_CODECS = ['gif', 'webp', 'apng', 'png', 'ffv1'];

// A moving picture ffmpeg can't read (moving WebP, as GIPHY's stickers are, or AVIF), unpacked by Chrome's own
// reader in main.js (decodePicture): its frames go into a lossless video that keeps see-through parts (FFV1, BGRA),
// which everything after this can read like a GIF.
async function picturesToVideo(tools, file, jobDir, decodePicture, { signal, log } = {}) {
  const got = await decodePicture(file, { signal });
  if (!got || !got.frames || !got.frames.length || !got.w) throw new ClipError('That file isn’t a video this app can read.', 'unreadable');
  const dir = path.join(jobDir, 'frames');
  await fsp.mkdir(dir, { recursive: true });
  // A still picture shows for 3 seconds
  if (got.frames.length === 1) got.frames[0].ms = 3000;
  const list = [];
  for (let i = 0; i < got.frames.length; i++) {
    const name = 'f' + String(i).padStart(5, '0') + '.png';
    await fsp.writeFile(path.join(dir, name), got.frames[i].png);
    list.push(`file '${name}'`, `duration ${(got.frames[i].ms / 1000).toFixed(4)}`);
  }
  // The concat list's last frame is listed twice, or its time is lost
  list.push(list[list.length - 2]);
  await fsp.writeFile(path.join(dir, 'list.txt'), list.join('\n') + '\n');
  const out = path.join(jobDir, 'source-frames.mkv');
  const w = 2 * Math.ceil(got.w / 2), h = 2 * Math.ceil(got.h / 2);
  const r = await run(tools.ffmpeg, ['-hide_banner', '-y', '-nostdin', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', `format=bgra,pad=${w}:${h}:0:0:color=black@0`, '-fps_mode', 'vfr', '-c:v', 'ffv1', '-pix_fmt', 'bgra', out], { signal, log });
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  if (r.code !== 0 || !fs.existsSync(out)) throw new ClipError('That file isn’t a video this app can read.', 'unreadable', r.stderr.slice(-400));
  if (log) log(`picture: ${got.frames.length} frames of ${got.w}x${got.h} read by Chrome's picture reader`);
  return out;
}
// Whether a moving picture has see-through parts worth keeping (more than a sliver in some frame)
async function hasSeeThrough(tools, file, p, { signal } = {}) {
  if (!PICTURE_CODECS.includes(p.vcodec)) return false;
  const r = await run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-frames:v', '120', '-vf',
    'format=rgba,alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { signal });
  if (r.code !== 0) return false;
  return (r.stdout.match(/YAVG=([\d.]+)/g) || []).some((m) => +m.slice(5) < 250);
}

// A WebP or AVIF picture, by its first bytes
async function chromeReads(file) {
  try {
    const fh = await fsp.open(file, 'r');
    const b = Buffer.alloc(16);
    await fh.read(b, 0, 16, 0);
    await fh.close();
    const t = (a, n) => b.toString('latin1', a, a + n);
    return (t(0, 4) === 'RIFF' && t(8, 4) === 'WEBP') || (t(4, 4) === 'ftyp' && /^avi[fs]/.test(t(8, 4)));
  } catch (_) { return false; }
}

async function makePlayable(tools, file, jobDir, { signal, log, onProgress, decodePicture } = {}) {
  let p = null, why = null;
  try { p = await probe(tools, file, { signal }); } catch (e) { why = e; }
  // Moving WebP and AVIF go through Chrome's reader: older ffmpeg reads a moving WebP as a picture with no size, and
  // newer ffmpeg (9) plays it but without its see-through parts, so stickers would come out on black. Anything else
  // ffmpeg can't read gets a try with Chrome's reader too.
  let unpacked = null;
  if ((!p || !p.width || !p.height || (await chromeReads(file))) && decodePicture) {
    try {
      unpacked = await picturesToVideo(tools, file, jobDir, decodePicture, { signal, log });
      file = unpacked;
      p = await probe(tools, file, { signal });
    } catch (e) { if (e && e.code === 'cancelled') throw e; if (log) log('picture reader: ' + (e && e.message)); }
  }
  if (!p || !p.width) throw why || new ClipError('That file isn’t a video this app can read.', 'unreadable');
  const ext = path.extname(file).toLowerCase();
  const okCodecs = PLAYABLE_V.includes(p.vcodec) && (!p.hasAudio || PLAYABLE_A.includes(p.acodec));
  const isGif = p.vcodec === 'gif' || ext === '.gif' || !!unpacked;
  if (!isGif && okCodecs && /mp4|mov|webm/.test(p.format) && ext !== '.mkv') return { file, probe: p };
  const out = path.join(jobDir, 'playable.mp4');
  if (!isGif && okCodecs && p.vcodec !== 'vp8') {
    // Only the wrapper is unusual (an MKV, say): rewrap it without touching the picture
    const r = await run(tools.ffmpeg, ['-hide_banner', '-y', '-nostdin', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
      '-movflags', '+faststart', out], { signal, log });
    if (r.code === 0 && fs.existsSync(out)) return { file: out, probe: await probe(tools, out, { signal }) };
  }
  const { w, h } = fitSize(p, 1080);
  const args = ['-hide_banner', '-y', '-nostdin', '-i', file, '-map', '0:v:0'];
  if (p.hasAudio) args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k', '-ac', '2');
  else args.push('-an');
  const vf = [`scale=${w}:${h}:flags=lanczos`, 'setsar=1'];
  if (p.fps > 60) vf.push('fps=60');
  vf.push('format=yuv420p');
  args.push('-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', isGif ? '14' : '16',
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', out);
  const total = p.duration || 0;
  const r = await run(tools.ffmpeg, args, { signal, log, onLine: progressReader(total, onProgress) });
  if (r.code !== 0) throw new ClipError('That video couldn’t be opened.', 'unreadable', r.stderr.slice(-500));
  const sticker = await hasSeeThrough(tools, file, p, { signal }).catch(() => false);
  if (sticker && log) log('sticker: see-through parts found, it will be saved as a sticker');
  return { file: out, probe: await probe(tools, out, { signal }), sticker, unpacked };
}

// The size to make a picture: no taller than maxHeight (and no wider than 16:9 at that height would be, so
// tall phone videos aren't huge), even numbers for H.264, square pixels
function fitSize(p, maxHeight) {
  let w = Math.max(2, p.width || 2), h = Math.max(2, p.height || 2);
  const maxW = Math.round((maxHeight * 16) / 9);
  const s = Math.min(1, maxHeight / h, maxW / w);
  w = Math.max(2, 2 * Math.round((w * s) / 2));
  h = Math.max(2, 2 * Math.round((h * s) / 2));
  return { w, h };
}

const progressReader = (total, onProgress) => (line) => {
  if (!onProgress || !total) return;
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
  if (m) onProgress({ pct: Math.min(100, (100 * +m[1]) / 1e6 / total), part: 0 });
};

/* ---------------------------------------------------------------------------------------------------------------
   Pictures from a video: the filmstrip under the trimmer, frames for the picture recogniser, the library thumbnail
   --------------------------------------------------------------------------------------------------------------- */
// A crop (fractions of the frame: {x, y, w, h}) as an ffmpeg crop filter, on even pixels, or '' for none
function cropFilter(crop) {
  if (!crop) return '';
  const f = (n) => Math.min(1, Math.max(0, +n || 0)).toFixed(6);
  const w = f(crop.w), h = f(crop.h);
  if (+w >= 0.999 && +h >= 0.999) return '';
  return `crop=floor(iw*${w}/2)*2:floor(ih*${h}/2)*2:floor(iw*${f(crop.x)}):floor(ih*${f(crop.y)})`;
}
const validCrop = (c) => !!c && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(+c[k])) && +c.w > 0.005 && +c.h > 0.005 &&
  +c.x >= -0.001 && +c.y >= -0.001 && +c.x + +c.w <= 1.001 && +c.y + +c.h <= 1.001;

async function frameAt(tools, file, t, out, { width = 320, signal, crop } = {}) {
  const vf = [cropFilter(crop), `scale=${width}:-2:flags=bicubic`].filter(Boolean).join(',');
  const r = await run(tools.ffmpeg, ['-hide_banner', '-y', '-nostdin', '-ss', Math.max(0, t).toFixed(3), '-i', file,
    '-frames:v', '1', '-vf', vf, '-q:v', '3', out], { signal });
  if (r.code !== 0 || !fs.existsSync(out)) {
    // Right at the end of a file there may be no frame: try a moment earlier
    if (t > 0.5) return frameAt(tools, file, t - 0.5, out, { width, signal, crop });
    throw new ClipError('Couldn’t take a picture from the video.', 'failed', r.stderr.slice(-300));
  }
  return out;
}

async function frames(tools, file, times, dir, prefix, { width = 320, signal, crop } = {}) {
  await fsp.mkdir(dir, { recursive: true });
  const outs = new Array(times.length);
  let next = 0;
  const worker = async () => {
    while (next < times.length) {
      const i = next++;
      outs[i] = await frameAt(tools, file, times[i], path.join(dir, `${prefix}-${String(i).padStart(2, '0')}.jpg`), { width, signal, crop });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return outs;
}

const spread = (from, to, n) => Array.from({ length: n }, (_, i) => from + ((i + 0.5) * (to - from)) / n);

/* ---------------------------------------------------------------------------------------------------------------
   Cutting the clip. The picture is made again (not copied) so the cut lands on the exact frame, at up to the
   chosen height, as H.264 in an MP4: what Phosphor Loop and every browser play best. The NVIDIA card does it when
   there is one (fast, and it spares the processor); otherwise the processor at a high quality.
   --------------------------------------------------------------------------------------------------------------- */
const ENCODERS = {
  nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-maxrate', '60M',
    '-bufsize', '120M', '-profile:v', 'high', '-bf', '2'],
  amf: ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20', '-qp_b', '22', '-profile:v', 'high'],
  qsv: ['-c:v', 'h264_qsv', '-preset', 'slow', '-global_quality', '20', '-profile:v', 'high'],
  x264: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high'],
};
// Looks (Phosphor Loop's Save clip): its picture is already one lossy step away from the screen, so it's kept closer
// to what was sent: a lower quantiser and room for 4K
const HIGH = { nvenc: ['-cq', '14', '-maxrate', '200M', '-bufsize', '400M'], amf: ['-qp_i', '14', '-qp_p', '16', '-qp_b', '18'], qsv: ['-global_quality', '15'], x264: ['-crf', '14'] };
function encoderArgs(enc, high) {
  const a = ENCODERS[enc].slice();
  if (!high) return a;
  const h = HIGH[enc];
  for (let i = 0; i < h.length; i += 2) { const j = a.indexOf(h[i]); if (j >= 0) a[j + 1] = h[i + 1]; else a.push(h[i], h[i + 1]); }
  return a;
}
let encoderPick = null;
function pickEncoder(tools, log) {
  if (encoderPick) return encoderPick;
  encoderPick = (async () => {
    const forced = process.env.CLIPS_ENCODER;
    if (forced && ENCODERS[forced]) return forced;
    for (const id of ['nvenc', 'amf', 'qsv']) {
      const r = await run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=0.5',
        '-vf', 'format=yuv420p', ...ENCODERS[id], '-g', '60', '-f', 'null', '-'], {}).catch(() => ({ code: 1 }));
      if (r.code === 0) { if (log) log('encoder: ' + id); return id; }
    }
    if (log) log('encoder: x264 (no video card encoder here)');
    return 'x264';
  })();
  return encoderPick;
}

// sticker: src is a moving picture with see-through parts; the clip is made as a sticker (see STICKER_TAG)
async function cutClip(tools, src, out, { start = 0, end, keepSound = false, maxHeight = 1080, crop = null, high = false, sticker = false, signal, log, onProgress } = {}) {
  const p = await probe(tools, src, { signal });
  const stop = Math.min(end == null ? p.duration : end, p.duration || end || 0);
  const dur = Math.max(0.1, stop - start);
  // Cropped: only that part of the picture, then sized as usual
  const cf = validCrop(crop) ? cropFilter(crop) : '';
  const shown = cf ? { width: p.width * crop.w, height: p.height * crop.h } : p;
  const { w, h } = fitSize(shown, maxHeight);
  const enc = await pickEncoder(tools, log);
  const fps = p.fps > 60 ? 60 : p.fps || 30;
  const vf = [cf, `scale=${w}:${h}:flags=lanczos`, 'setsar=1'].filter(Boolean);
  if (p.fps > 60) vf.push('fps=60');
  // A sticker: the picture made solid on black, its see-through map under it
  if (sticker) vf.push('format=gbrap,split[c][a];[c]premultiply=inplace=1,format=gbrp[cc];[a]alphaextract,format=gbrp[aa];[cc][aa]vstack');
  vf.push('format=yuv420p');
  const args = ['-hide_banner', '-y', '-nostdin', '-ss', start.toFixed(3), '-i', src, '-t', dur.toFixed(3), '-map', '0:v:0'];
  const sound = keepSound && p.hasAudio;
  if (sound) args.push('-map', '0:a:0?');
  const encArgs = encoderArgs(enc, high);
  args.push('-vf', vf.join(','), ...encArgs, '-g', String(Math.max(1, Math.round(fps * 2))));
  // Looks keep their sound at 320 kbps (near the top AAC gives), 48 kHz stereo
  if (sound) args.push('-c:a', 'aac', '-b:a', high ? '320k' : '192k', '-ar', '48000', '-ac', '2'); else args.push('-an');
  args.push('-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', out);
  let r = await run(tools.ffmpeg, args, { signal, log, onLine: progressReader(dur, onProgress) });
  if (r.code !== 0 && enc !== 'x264') {
    // The card's encoder can refuse odd sizes; the processor never does
    if (log) log('encoder ' + enc + ' failed, using x264: ' + r.stderr.slice(-300));
    const i = args.indexOf(encArgs[0]);
    args.splice(i, encArgs.length, ...encoderArgs('x264', high));
    r = await run(tools.ffmpeg, args, { signal, log, onLine: progressReader(dur, onProgress) });
  }
  if (r.code !== 0 || !fs.existsSync(out)) throw new ClipError('The clip couldn’t be made.', 'failed', r.stderr.slice(-500));
  const made = await probe(tools, out, { signal });
  return { file: out, probe: made, sound, encoder: enc, crop: cf ? crop : null, sticker: !!sticker };
}

// The part to download for marked Start here / End here (seconds in the original video), with PAD either side so
// the trimmer has room; only Start here marked: the minute after it. null when there's nothing to gain (the part
// would be the whole video anyway).
function partOf(marks, duration) {
  if (!marks || !Number.isFinite(marks.start)) return null;
  const a = Math.max(0, marks.start - PAD);
  let b = (Number.isFinite(marks.end) && marks.end > marks.start ? marks.end : marks.start + 60) + PAD;
  if (duration > 0) b = Math.min(duration, b);
  if (!(b > a + 0.5)) return null;
  if (duration > 0 && a < 0.5 && b > duration - 0.5) return null;
  return [a, b];
}

// Just part of a video file on the web (a direct link, or the video a page plays), read by ffmpeg, which asks the
// server for only the pieces it needs. The picture isn't re-made: it starts at the key frame before the start.
async function downloadDirectPart(tools, url, jobDir, section, { referer, cookieHeader, signal, log, onProgress } = {}) {
  const out = path.join(jobDir, 'source-part.mkv');
  let headers = `User-Agent: ${UA}\r\n`;
  if (referer) headers += `Referer: ${referer}\r\n`;
  if (cookieHeader) headers += `Cookie: ${cookieHeader}\r\n`;
  const len = section[1] - section[0];
  const r = await run(tools.ffmpeg, ['-hide_banner', '-y', '-nostdin', '-headers', headers, '-ss', section[0].toFixed(3), '-i', url,
    '-t', len.toFixed(3), '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero',
    '-progress', 'pipe:1', '-nostats', out], { signal, log, onLine: progressReader(len, onProgress) });
  if (r.code !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 1024) {
    throw new ClipError('The marked part couldn’t be downloaded on its own.', 'failed', r.stderr.slice(-400));
  }
  return out;
}

// Removes what a part download left behind before the whole video is downloaded instead
async function clearSources(jobDir) {
  for (const f of await fsp.readdir(jobDir).catch(() => [])) {
    if (/^source/.test(f) && !/\.json$/.test(f)) await fsp.rm(path.join(jobDir, f), { force: true }).catch(() => {});
  }
}

/* ---------------------------------------------------------------------------------------------------------------
   The whole "get a video" step for one grab: from a page or link (yt-dlp first, then the page's own video file
   if yt-dlp finds nothing), or a file already on the computer.
   req: { url, direct, referer, file, marks: {start, end} (seconds in the original video), maxHeight, cookies,
          cookieHeader, skipSponsors }
   Returns { source, playable, probe, info, offset, marks }: offset is where the downloaded file starts in the
   original video (more than 0 when only part was downloaded).
   --------------------------------------------------------------------------------------------------------------- */
async function fetchVideo(tools, req, jobDir, { signal, log, decodePicture, onStatus = () => {}, onProgress = () => {} } = {}) {
  await fsp.mkdir(jobDir, { recursive: true });
  let source = '', info = { title: '', url: req.url || '' }, offset = 0, section = null;
  const marks = req.marks && Number.isFinite(req.marks.start) ? { ...req.marks } : null;
  // A video file on the web: the marked part (section) if there is one and the server allows it, else all of it
  const fetchDirect = async (url, referer) => {
    if (section) {
      onStatus('Downloading the marked part…');
      try { return await downloadDirectPart(tools, url, jobDir, section, { referer, cookieHeader: req.cookieHeader, signal, log, onProgress }); } catch (e) {
        if (e.code === 'cancelled') throw e;
        if (log) log('part download failed (' + String(e.detail || e.message).slice(-200) + '), downloading the whole video');
        section = null;
        await clearSources(jobDir);
      }
    }
    onStatus('Downloading…');
    return downloadDirect(url, jobDir, { referer, cookieHeader: req.cookieHeader, signal, onProgress, log });
  };
  if (req.file) {
    onStatus('Opening the file…');
    source = req.file;
    info = { title: req.title || path.basename(req.file).replace(/\.[^.]+$/, ''), url: req.sourceUrl || '' };
  } else if (isDirectLink(req.url)) {
    // A video file opened straight in the browser, marked: just that part (a GIF is always fetched whole)
    if (!/\.gifv?(?:[?#]|$)/i.test(req.url)) section = partOf(marks, req.pageDuration);
    source = await fetchDirect(req.url, req.referer);
    // A GIF's file name is often meaningless ("giphy.gif"); the page it was on says more
    info = { title: req.pageTitle || titleFromUrl(req.url), url: req.referer || req.url };
  } else {
    onStatus('Looking at the page…');
    let found = null, why = null;
    try { found = await videoInfo(tools, req.url, jobDir, { cookies: req.cookies, signal, log }); } catch (e) {
      if (e.code === 'cancelled') throw e;
      why = e;
    }
    if (found) {
      info = summarize(found.info, req.url);
      if (info.live) throw new ClipError('Live streams can’t be grabbed. Grab it once it’s finished.', 'live');
      // Some pages (a plain video tag, say) don't tell yt-dlp the length; the page's own player knows it
      if (!info.duration && req.pageDuration > 0) info.duration = req.pageDuration;
      // Marked: only the marked part comes down, whatever the video's length
      section = partOf(marks, info.duration);
      const ytdl = (part, sponsors) => downloadWithYtdlp(tools, found.file, jobDir, { maxHeight: req.maxHeight || 1080, section: part, cookies: req.cookies, sponsors, signal, log, onProgress });
      if (section) {
        onStatus('Downloading the marked part…');
        try { source = await ytdl(section); } catch (e) {
          if (e.code === 'cancelled') throw e;
          // Some sites won't hand out a part: the whole video, then
          if (log) log('part download failed (' + e.message + '), downloading the whole video');
          section = null;
          await clearSources(jobDir);
        }
      }
      if (!section) {
        onStatus('Downloading…');
        // A whole YouTube video, with Skip sponsor parts on and nothing marked: comes down with them cut out. If
        // SponsorBlock can't be reached, the video comes down as it is.
        const cut = !!req.skipSponsors && !marks && /youtube/i.test(found.info.extractor_key || found.info.extractor || '');
        try { source = await ytdl(null, cut); } catch (e) {
          if (!cut || e.code === 'cancelled') throw e;
          if (log) log('sponsor parts not cut (' + e.message + '), downloading the video as it is');
          await clearSources(jobDir);
          source = await ytdl(null, false);
        }
        if (cut) info.sponsorsCut = true;
      }
    } else if (req.direct && /^https?:/i.test(req.direct)) {
      if (log) log('yt-dlp found nothing (' + (why && why.detail) + '), downloading the page’s own video');
      section = partOf(marks, req.pageDuration);
      source = await fetchDirect(req.direct, req.url);
      info = { title: req.pageTitle || titleFromUrl(req.direct), url: req.url };
    } else {
      throw why || new ClipError('No video was found at that link.', 'unsupported');
    }
  }
  if (!info.title && req.pageTitle) info.title = req.pageTitle;
  onStatus('Getting it ready…');
  onProgress({ pct: -1, part: 0 });
  const made = await makePlayable(tools, source, jobDir, { signal, log, onProgress, decodePicture });
  // A picture Chrome's reader unpacked: its frames are the source from here on (they keep see-through parts)
  if (made.unpacked) source = made.unpacked;
  // A part download starts at the key frame before the asked-for start, so it runs a little long at the front:
  // where it really starts is its end minus its length
  if (section) offset = Math.max(0, section[1] - made.probe.duration);
  return { source, playable: made.file, probe: made.probe, info, offset, marks, sticker: !!made.sticker };
}

function titleFromUrl(url) {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return base.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_]+/g, ' ').trim();
  } catch (_) { return ''; }
}

module.exports = {
  ClipError, findTools, run, probe, isDirectLink, videoInfo, summarize, downloadWithYtdlp, downloadDirect,
  makePlayable, frames, frameAt, spread, cutClip, pickEncoder, fetchVideo, fitSize, titleFromUrl, explainYtdlp,
  partOf, cropFilter, validCrop, hasSeeThrough, STICKER_TAG, PAD, UA,
};
