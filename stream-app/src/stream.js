'use strict';
// The streaming engine. Two kinds of FFmpeg run here:
//  - one "squeezer" (encoder): takes the picture and sound recorded inside Phosphor Loop and turns them into a
//    stream-ready H.264 + AAC feed, using the graphics card when it can;
//  - one "sender" per destination (Twitch, Kick): copies that feed to the platform without touching it again.
// A sender that drops (network blip, platform hiccup, Twitch's 48-hour limit) is restarted on its own without
// disturbing the other one. If the squeezer itself stops, the whole capture is restarted.
const { spawn, execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');

const ENCODERS = [
  { id: 'h264_nvenc', label: 'NVIDIA graphics card' },
  { id: 'h264_amf', label: 'AMD graphics card' },
  { id: 'h264_qsv', label: 'Intel graphics' },
  { id: 'libx264', label: 'Processor (no graphics card help)' },
];

function encoderArgs(id, { fps, bitrate }) {
  const b = String(bitrate), buf = String(bitrate * 2), g = String(fps * 2);
  switch (id) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-rc', 'cbr', '-b:v', b, '-maxrate', b, '-bufsize', buf,
        '-g', g, '-bf', '0', '-profile:v', 'high', '-forced-idr', '1'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-usage', 'lowlatency', '-quality', 'balanced', '-rc', 'cbr', '-b:v', b, '-maxrate', b,
        '-bufsize', buf, '-g', g, '-bf', '0', '-profile:v', 'high'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'faster', '-b:v', b, '-maxrate', b, '-bufsize', buf, '-g', g, '-bf', '0',
        '-look_ahead', '0', '-profile:v', 'high'];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-b:v', b, '-maxrate', b, '-bufsize', buf,
        '-g', g, '-keyint_min', g, '-sc_threshold', '0', '-profile:v', 'high', '-x264-params', 'nal-hrd=cbr'];
  }
}

// Stream keys must never show up in anything the app displays or writes to its log.
function redactor(secrets) {
  const list = secrets.filter((s) => s && s.length >= 4);
  return (text) => list.reduce((t, s) => t.split(s).join('••••'), String(text));
}

function buildUrl(platform, { server, key }) {
  key = String(key || '').trim();
  if (!key) return null;
  if (platform === 'twitch') return `rtmp://live.twitch.tv/app/${key}`;
  if (platform === 'custom') return String(server || '').trim().replace(/\/+$/, '') + '/' + key;
  // Kick shows its own server address (Amazon IVS). It may come with or without :443 and /app.
  let s = String(server || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  if (!/^rtmps?:\/\//i.test(s)) s = 'rtmps://' + s;
  const m = s.match(/^(rtmps?):\/\/([^/]+)(\/.*)?$/i);
  if (!m) return null;
  let [, scheme, host, path] = m;
  if (scheme.toLowerCase() === 'rtmps' && !/:\d+$/.test(host)) host += ':443';
  if (!path) path = '/app';
  return `${scheme.toLowerCase()}://${host}${path}/${key}`;
}

class Streamer extends EventEmitter {
  constructor({ ffmpeg, log = () => {} }) {
    super();
    this.ffmpeg = ffmpeg;
    this.log = log;
    this.encoder = null;       // chosen encoder {id,label}
    this.enc = null;           // encoder process
    this.senders = new Map();  // id -> {def, proc, state, message, retry, timer, startedAt}
    this.live = false;
    this.gen = 0;              // capture generation; chunks from an older capture are dropped
    this.bytesOut = 0; this.kbps = 0; this.lastIn = 0; this.chunksIn = 0;
    this.redact = (t) => t;
  }

  // Try each graphics-card encoder with a tiny test picture and keep the first that works.
  async probe() {
    for (const e of ENCODERS) {
      if (e.id === 'libx264') { this.encoder = e; break; }
      const ok = await new Promise((res) => {
        execFile(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x240:r=30',
          '-frames:v', '10', ...encoderArgs(e.id, { fps: 30, bitrate: 1000000 }), '-f', 'null', '-'],
          { timeout: 15000, windowsHide: true }, (err) => res(!err));
      });
      if (ok) { this.encoder = e; break; }
    }
    this.log(`Encoder: ${this.encoder.id}`);
    return this.encoder;
  }

  // dests: [{id, name, url}], quality: {fps, bitrate}
  start(dests, quality) {
    if (this.live) return;
    if (!this.encoder) this.encoder = ENCODERS[ENCODERS.length - 1];
    this.live = true;
    this.quality = quality;
    this.redact = redactor(dests.map((d) => d.secret));
    this.startedAt = Date.now();
    for (const d of dests) this.senders.set(d.id, { def: d, proc: null, state: 'connecting', message: 'Connecting…', retry: 0, timer: null });
    this.startEncoder();
    for (const id of this.senders.keys()) this.startSender(id);
    this.meter = setInterval(() => this.tick(), 1000);
    this.emitStatus();
  }

  startEncoder() {
    this.gen++;
    const q = this.quality;
    const args = ['-hide_banner', '-loglevel', 'warning', '-fflags', '+genpts', '-thread_queue_size', '1024',
      '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0?',
      '-r', String(q.fps), '-fps_mode', 'cfr', '-pix_fmt', this.encoder.id === 'h264_qsv' ? 'nv12' : 'yuv420p',
      ...encoderArgs(this.encoder.id, q), '-bsf:v', 'dump_extra=freq=keyframe',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', 'pipe:1'];
    const p = spawn(this.ffmpeg, args, { windowsHide: true });
    const gen = this.gen;
    this.enc = p;
    p.stdin.on('error', () => {});
    p.stdout.on('data', (buf) => {
      this.bytesOut += buf.length;
      for (const s of this.senders.values()) {
        if (!s.proc || !s.proc.stdin.writable) continue;
        if (s.proc.stdin.writableLength > 32 * 1024 * 1024) { this.log(`${s.def.name}: upload stuck, restarting`); s.proc.kill(); continue; }
        s.proc.stdin.write(buf);
      }
    });
    p.stderr.on('data', (d) => this.log('encoder: ' + this.redact(d).trim()));
    p.on('exit', (code) => {
      if (this.enc === p) this.enc = null;
      if (this.live && gen === this.gen) {
        this.log(`Encoder stopped (code ${code}); restarting capture`);
        setTimeout(() => { if (this.live && !this.enc) this.startEncoder(); }, 1000);
      }
    });
    this.emit('capture', this.gen);
  }

  // A chunk of the recording made inside Phosphor Loop
  write(gen, chunk) {
    if (!this.live || gen !== this.gen || !this.enc) return;
    this.chunksIn++;
    this.lastIn = Date.now();
    this.enc.stdin.write(Buffer.from(chunk));
  }

  startSender(id) {
    const s = this.senders.get(id);
    if (!s || !this.live) return;
    clearTimeout(s.timer);
    const args = ['-hide_banner', '-loglevel', 'info', '-nostats', '-f', 'mpegts', '-i', 'pipe:0',
      '-map', '0', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-flvflags', 'no_duration_filesize', '-rw_timeout', '15000000',
      '-f', 'flv', s.def.url];
    const p = spawn(this.ffmpeg, args, { windowsHide: true });
    s.proc = p; s.state = s.retry ? 'retrying' : 'connecting'; s.message = s.retry ? 'Reconnecting…' : 'Connecting…';
    s.startedAt = Date.now();
    let tail = '';
    p.stdin.on('error', () => {});
    p.stderr.on('data', (d) => {
      const text = this.redact(d);
      tail = (tail + text).slice(-600);
      if (/Output #0, flv/.test(text) && s.state !== 'live') {
        s.state = 'live'; s.message = 'Live'; s.retry = 0; s.wasLive = true; this.emitStatus();
      }
      for (const line of text.split(/\r?\n/)) if (/error|fail|refused|denied|invalid|timed? ?out/i.test(line)) this.log(`${s.def.name}: ${line.trim()}`);
    });
    p.on('exit', (code) => {
      if (s.proc === p) s.proc = null;
      if (!this.live || !this.senders.has(id)) return;
      s.retry++;
      const wait = Math.min(30, [2, 5, 10, 20][s.retry - 1] || 30);
      s.state = 'retrying';
      s.message = explain(tail, s.def, s.wasLive) + ` Trying again in ${wait} s.`;
      s.wasLive = false;
      this.log(`${s.def.name} stopped (code ${code}): ${tail.split('\n').slice(-3).join(' | ')}`);
      s.timer = setTimeout(() => this.startSender(id), wait * 1000);
      this.emitStatus();
    });
    this.emitStatus();
  }

  tick() {
    this.kbps = Math.round(this.bytesOut * 8 / 1000);
    this.bytesOut = 0;
    // No pictures arriving from Phosphor Loop for a while: ask for the capture to be restarted
    if (this.live && this.lastIn && Date.now() - this.lastIn > 6000) {
      this.log('No picture for 6 s; restarting capture');
      this.lastIn = 0;
      this.restartEncoder();
    }
    this.emitStatus();
  }

  restartEncoder() {
    const old = this.enc;
    this.gen++;               // the old encoder's exit is now ignored
    this.enc = null;
    if (old) { try { old.stdin.end(); } catch (_) {} setTimeout(() => old.kill(), 1500); }
    this.startEncoder();
  }

  stop() {
    if (!this.live) return;
    this.live = false;
    clearInterval(this.meter);
    // Let the squeezer finish what it has, then close the senders once everything has been passed on
    const enc = this.enc; this.enc = null;
    const procs = [...this.senders.values()].map((s) => { clearTimeout(s.timer); return s.proc; }).filter(Boolean);
    this.senders.clear();
    const closeSenders = () => procs.forEach((p) => { try { p.stdin.end(); } catch (_) {} setTimeout(() => p.kill(), 5000); });
    if (enc) {
      enc.stdout.on('end', closeSenders);
      try { enc.stdin.end(); } catch (_) {}
      setTimeout(() => { enc.kill(); }, 8000);
      // keep passing the last pictures on while it finishes
      enc.stdout.on('data', (buf) => procs.forEach((p) => { if (p.stdin.writable) p.stdin.write(buf); }));
    } else closeSenders();
    this.kbps = 0; this.lastIn = 0;
    this.emitStatus();
  }

  status() {
    const destinations = {};
    for (const [id, s] of this.senders) destinations[id] = { state: s.state, message: s.message };
    return { live: this.live, since: this.live ? this.startedAt : 0, kbps: this.kbps, encoder: this.encoder && this.encoder.label, destinations };
  }
  emitStatus() { this.emit('status', this.status()); }
}

// Turn FFmpeg's last words into plain English
function explain(tail, def, wasLive) {
  if (/401|403|unauthori|forbidden|invalid.*key|NetStream\.Publish\.BadName|Input\/output error/i.test(tail) && !/timed? ?out/i.test(tail))
    return `${def.name} didn’t accept the stream. Check the stream key.`;
  if (/resolve|getaddrinfo|No such host|Name or service not known/i.test(tail)) return `Couldn’t reach ${def.name}. Check the internet connection${def.id === 'kick' ? ' and the Kick server address' : ''}.`;
  if (/refused|timed? ?out|Connection reset|Broken pipe|End of file/i.test(tail)) return wasLive ? `The connection to ${def.name} dropped.` : `Couldn’t connect to ${def.name}.`;
  return `${def.name} stopped.`;
}

module.exports = { Streamer, buildUrl, encoderArgs, redactor, ENCODERS };
