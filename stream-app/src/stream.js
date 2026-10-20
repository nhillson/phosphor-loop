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
// Each encoder has settings tiers, best first. The first tier the computer's graphics card accepts is used, so an
// older card still gets the best settings it can do instead of falling all the way back to the processor.
const TIERS = { h264_nvenc: ['best', 'good', 'basic'], h264_amf: ['best', 'basic'], h264_qsv: ['best', 'basic'], libx264: ['best'] };

function encoderArgs(id, { fps, bitrate }, tier = 'best') {
  const b = String(bitrate), buf = String(bitrate), g = String(fps * 2);
  const cbr = ['-b:v', b, '-maxrate', b, '-bufsize', buf, '-g', g];
  switch (id) {
    case 'h264_nvenc':
      // Video feedback is fine detail that changes every frame, the hardest kind of picture to squeeze. These
      // settings trade a little graphics-card time and about half a second of delay for a much cleaner picture.
      if (tier === 'best') return ['-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'cbr', '-multipass', 'qres',
        '-spatial-aq', '1', '-temporal-aq', '1', '-aq-strength', '8', '-rc-lookahead', '20', '-bf', '2', '-b_ref_mode', 'middle',
        ...cbr, '-no-scenecut', '1', '-forced-idr', '1', '-profile:v', 'high'];
      if (tier === 'good') return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'cbr', '-spatial-aq', '1',
        '-rc-lookahead', '10', '-bf', '2', ...cbr, '-no-scenecut', '1', '-forced-idr', '1', '-profile:v', 'high'];
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'cbr', '-bf', '0', ...cbr, '-forced-idr', '1', '-profile:v', 'high'];
    case 'h264_amf':
      if (tier === 'best') return ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'cbr',
        '-preanalysis', '1', ...cbr, '-bf', '0', '-profile:v', 'high'];
      return ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'balanced', '-rc', 'cbr', ...cbr, '-bf', '0', '-profile:v', 'high'];
    case 'h264_qsv':
      if (tier === 'best') return ['-c:v', 'h264_qsv', '-preset', 'slower', ...cbr, '-bf', '2', '-profile:v', 'high'];
      return ['-c:v', 'h264_qsv', '-preset', 'faster', ...cbr, '-bf', '0', '-profile:v', 'high'];
    default:
      return ['-c:v', 'libx264', '-preset', 'faster', ...cbr, '-keyint_min', g, '-sc_threshold', '0', '-bf', '2',
        '-profile:v', 'high', '-x264-params', 'nal-hrd=cbr'];
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

  // Try each graphics-card encoder (and its settings tiers, best first) with a short test picture; keep the
  // first that works.
  async probe() {
    const tryArgs = (args) => new Promise((res) => {
      execFile(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30',
        '-frames:v', '30', '-pix_fmt', 'yuv420p', ...args, '-f', 'null', '-'],
        { timeout: 20000, windowsHide: true }, (err, _o, stderr) => res(err ? String(stderr || err.message).trim().split('\n').pop() : ''));
    });
    for (const e of ENCODERS) {
      for (const tier of TIERS[e.id]) {
        if (e.id === 'libx264') { this.encoder = { ...e, tier }; break; }
        const problem = await tryArgs(encoderArgs(e.id, { fps: 30, bitrate: 4000000 }, tier));
        if (!problem) { this.encoder = { ...e, tier }; break; }
        if (e.id === 'h264_nvenc' || tier !== 'best') this.log(`Encoder ${e.id} (${tier}) not usable: ${problem.slice(0, 200)}`);
      }
      if (this.encoder) break;
    }
    this.log(`Encoder: ${this.encoder.id}, ${this.encoder.tier} settings`);
    return this.encoder;
  }

  // dests: [{id, name, url}], quality: {fps, bitrate}
  start(dests, quality) {
    if (this.live) return;
    if (!this.encoder) this.encoder = { ...ENCODERS[ENCODERS.length - 1], tier: 'best' };
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
    const args = ['-hide_banner', '-loglevel', 'warning', '-stats_period', '5', '-progress', 'pipe:2',
      '-fflags', '+genpts', '-thread_queue_size', '1024', '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0?',
      '-r', String(q.fps), '-fps_mode', 'cfr', '-pix_fmt', this.encoder.id === 'h264_qsv' ? 'nv12' : 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      ...encoderArgs(this.encoder.id, q, this.encoder.tier), '-bsf:v', 'dump_extra=freq=keyframe',
      '-af', 'aresample=async=1000', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', 'pipe:1'];
    this.prog = { frame: 0, dup: 0, drop: 0, at: Date.now(), lastLog: Date.now(), lastFrame: 0, lastDup: 0, lastDrop: 0, partial: '' };
    this.pictureFps = 0;
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
    p.stderr.on('data', (d) => this.encoderOutput(String(d)));
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
    // Send at the stream's own pace from the very first second. Without the pace limit, the few seconds FFmpeg
    // gathers while it starts up go out in one burst, and Kick (Amazon IVS) hangs up on anything over its limit.
    // It looks for up to 3 s for a full picture (one comes every 2 s), which it needs when joining mid-stream.
    const args = ['-hide_banner', '-loglevel', 'info', '-nostats', '-probesize', '10000000', '-analyzeduration', '3000000',
      '-readrate', '1', '-readrate_initial_burst', '0.5', '-f', 'mpegts', '-i', 'pipe:0',
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
      if (s.state !== 'live' && /Output #0, flv/.test(tail)) {
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

  // FFmpeg reports its progress every 5 seconds. From that: how many pictures a second really arrive from
  // Phosphor Loop (frames it had to repeat mean the page drew fewer than asked for).
  encoderOutput(text) {
    const pr = this.prog;
    const lines = (pr.partial + text).split(/\r?\n/);
    pr.partial = lines.pop();
    const other = [];
    for (const line of lines) {
      const m = line.match(/^(frame|dup_frames|drop_frames|progress)=(\S+)/);
      if (!m) { if (line.trim()) other.push(line.trim()); continue; }
      if (m[1] === 'frame') pr.frame = +m[2];
      else if (m[1] === 'dup_frames') pr.dup = +m[2];
      else if (m[1] === 'drop_frames') pr.drop = +m[2];
      else if (m[1] === 'progress') {
        const now = Date.now(), secs = (now - pr.at) / 1000;
        if (secs > 1 && pr.lastFrame) {
          const made = pr.frame - pr.lastFrame, dup = pr.dup - pr.lastDup;
          this.pictureFps = Math.max(0, Math.round((made - dup) / secs));
        }
        if (now - pr.lastLog > 60000) {
          pr.lastLog = now;
          this.log(`Picture: ${this.pictureFps} new frames a second (asked for ${this.quality.fps}); ${(this.kbps / 1000).toFixed(1)} Mbps out; repeated ${pr.dup}, dropped ${pr.drop} so far`);
        }
        pr.at = now; pr.lastFrame = pr.frame; pr.lastDup = pr.dup; pr.lastDrop = pr.drop;
      }
    }
    // "More than N frames duplicated" is covered by the picture line above
    const keep = other.filter((l) => !/frames duplicated|^\s*$/.test(l));
    if (keep.length) this.log('encoder: ' + this.redact(keep.join(' | ')));
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
    return { live: this.live, since: this.live ? this.startedAt : 0, kbps: this.kbps, encoder: this.encoder && this.encoder.label,
      pictureFps: this.live ? this.pictureFps : 0, wantFps: this.live && this.quality ? this.quality.fps : 0, destinations };
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

module.exports = { Streamer, buildUrl, encoderArgs, redactor, ENCODERS, TIERS };
