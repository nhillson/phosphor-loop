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
// Encoder settings ("variants"). Every variant keeps the platform rules: constant bitrate (CBR), a buffer no bigger
// than one second of stream (Kick hangs up on bursts), and a keyframe every 2 s with no extra ones.
// Tested on real Phosphor Loop footage: adaptive quantisation (spatial/temporal AQ) moves bits away from busy,
// detailed areas towards flat ones, which smears exactly the fine detail Phosphor Loop is made of. So AQ is off in
// the default settings. Scene-cut keyframes are off too (chaotic feedback looks like a scene change all the time and
// every extra keyframe starves the frames around it).
// The sharpness test (tune.js) tries these on the real graphics card and keeps whichever comes out sharpest.
//   auto: may be picked by the sharpness test; false = measured for comparison only (never streamed with)
const rules = ({ fps, bitrate }) => ['-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate), '-g', String(fps * 2)];
const nv = (preset, extra, { idr = true } = {}) => (q) => ['-c:v', 'h264_nvenc', '-preset', preset, '-tune', 'hq', '-rc', 'cbr',
  ...extra, ...rules(q), '-no-scenecut', '1', ...(idr ? ['-forced-idr', '1'] : []), '-profile:v', 'high'];
const AQ0 = ['-spatial-aq', '0', '-temporal-aq', '0'];
const x264 = (preset, params) => (q) => ['-c:v', 'libx264', '-preset', preset, ...rules(q), '-keyint_min', String(q.fps * 2),
  '-sc_threshold', '0', '-bf', '2', '-profile:v', 'high', '-x264-params', 'nal-hrd=cbr:' + params];
const VARIANTS = {
  // NVIDIA
  'nv-p7-full': { codec: 'h264_nvenc', auto: true, label: 'Max quality, full look-over',
    args: nv('p7', ['-multipass', 'fullres', ...AQ0, '-rc-lookahead', '16', '-bf', '3', '-b_ref_mode', 'middle']) },
  'nv-p7-qres': { codec: 'h264_nvenc', auto: true, label: 'Max quality, quick look-over',
    args: nv('p7', ['-multipass', 'qres', ...AQ0, '-rc-lookahead', '16', '-bf', '3', '-b_ref_mode', 'middle']) },
  'nv-p7-1pass': { codec: 'h264_nvenc', auto: true, label: 'Max quality, single pass',
    args: nv('p7', ['-multipass', 'disabled', ...AQ0, '-rc-lookahead', '16', '-bf', '3', '-b_ref_mode', 'middle']) },
  'nv-p7-full-la32': { codec: 'h264_nvenc', auto: true, label: 'Max quality, looks further ahead',
    args: nv('p7', ['-multipass', 'fullres', ...AQ0, '-rc-lookahead', '32', '-bf', '3', '-b_ref_mode', 'middle']) },
  'nv-p7-full-bf0': { codec: 'h264_nvenc', auto: true, label: 'Max quality, no in-between frames',
    args: nv('p7', ['-multipass', 'fullres', ...AQ0, '-rc-lookahead', '16', '-bf', '0']) },
  'nv-p7-full-bf2': { codec: 'h264_nvenc', auto: true, label: 'Max quality, 2 in-between frames',
    args: nv('p7', ['-multipass', 'fullres', ...AQ0, '-rc-lookahead', '16', '-bf', '2', '-b_ref_mode', 'disabled']) },
  'nv-p7-full-chroma': { codec: 'h264_nvenc', auto: true, label: 'Max quality, extra colour detail',
    args: nv('p7', ['-multipass', 'fullres', ...AQ0, '-rc-lookahead', '16', '-bf', '3', '-b_ref_mode', 'middle', '-qp_cb_offset', '-2', '-qp_cr_offset', '-2']) },
  'nv-p7-full-saq2': { codec: 'h264_nvenc', auto: true, label: 'Max quality, gentle flat-area help',
    args: nv('p7', ['-multipass', 'fullres', '-spatial-aq', '1', '-aq-strength', '2', '-temporal-aq', '0', '-rc-lookahead', '16', '-bf', '3', '-b_ref_mode', 'middle']) },
  'nv-p7-full-saq8': { codec: 'h264_nvenc', auto: true, label: 'Max quality, strong flat-area help',
    args: nv('p7', ['-multipass', 'fullres', '-spatial-aq', '1', '-aq-strength', '8', '-temporal-aq', '0', '-rc-lookahead', '16', '-bf', '3', '-b_ref_mode', 'middle']) },
  'nv-p6-qres': { codec: 'h264_nvenc', auto: true, label: 'High quality (lighter)',
    args: nv('p6', ['-multipass', 'qres', ...AQ0, '-rc-lookahead', '8', '-bf', '2']) },
  'nv-obs': { codec: 'h264_nvenc', auto: false, label: 'What OBS uses (for comparison)',
    args: nv('p5', ['-multipass', 'qres', '-spatial-aq', '1', '-aq-strength', '8', '-temporal-aq', '1', '-rc-lookahead', '8', '-bf', '2'], { idr: true }) },
  'nv-p4': { codec: 'h264_nvenc', auto: true, label: 'Basic (older cards)',
    args: (q) => ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'cbr', '-bf', '0', ...rules(q), '-forced-idr', '1', '-profile:v', 'high'] },
  // AMD and Intel
  'amf-best': { codec: 'h264_amf', auto: true, label: 'AMD, quality',
    args: (q) => ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'cbr', '-preanalysis', '1', ...rules(q), '-bf', '0', '-profile:v', 'high'] },
  'amf-basic': { codec: 'h264_amf', auto: true, label: 'AMD, balanced',
    args: (q) => ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'balanced', '-rc', 'cbr', ...rules(q), '-bf', '0', '-profile:v', 'high'] },
  'qsv-best': { codec: 'h264_qsv', auto: true, label: 'Intel, slower',
    args: (q) => ['-c:v', 'h264_qsv', '-preset', 'slower', ...rules(q), '-bf', '2', '-profile:v', 'high'] },
  'qsv-basic': { codec: 'h264_qsv', auto: true, label: 'Intel, faster',
    args: (q) => ['-c:v', 'h264_qsv', '-preset', 'faster', ...rules(q), '-bf', '0', '-profile:v', 'high'] },
  // The processor (no graphics card help). Same lesson: AQ and psychovisual tuning off keep the most real detail.
  'x264-veryfast': { codec: 'libx264', auto: true, cpu: true, label: 'Processor, very fast', args: x264('veryfast', 'aq-mode=0:psy-rd=0.0,0.0') },
  'x264-faster': { codec: 'libx264', auto: true, cpu: true, label: 'Processor, fast', args: x264('faster', 'aq-mode=0:psy-rd=0.0,0.0') },
  'x264-medium': { codec: 'libx264', auto: true, cpu: true, label: 'Processor, careful', args: x264('medium', 'aq-mode=0:psy-rd=0.0,0.0') },
  'x264-slow': { codec: 'libx264', auto: true, cpu: true, label: 'Processor, very careful', args: x264('slow', 'aq-mode=0:psy-rd=0.0,0.0') },
  // HEVC (H.265), for YouTube: more picture per Mbps than H.264. Kick and Twitch (without Enhanced Broadcasting)
  // only take H.264. family = the H.264 encoder that tells us which graphics card this is.
  'nvh-p7': { codec: 'hevc_nvenc', family: 'h264_nvenc', hevc: true, auto: false, label: 'HEVC, max quality',
    args: (q) => ['-c:v', 'hevc_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'cbr', '-multipass', 'fullres', ...AQ0, '-rc-lookahead', '16',
      '-bf', '3', '-b_ref_mode', 'middle', ...rules(q), '-no-scenecut', '1', '-forced-idr', '1', '-profile:v', 'main'] },
  'nvh-p5': { codec: 'hevc_nvenc', family: 'h264_nvenc', hevc: true, auto: false, label: 'HEVC (older cards)',
    args: (q) => ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'cbr', '-multipass', 'qres', ...AQ0, '-rc-lookahead', '8',
      '-bf', '0', ...rules(q), '-no-scenecut', '1', '-forced-idr', '1', '-profile:v', 'main'] },
  'amfh': { codec: 'hevc_amf', family: 'h264_amf', hevc: true, auto: false, label: 'HEVC, AMD',
    args: (q) => ['-c:v', 'hevc_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'cbr', ...rules(q), '-profile:v', 'main'] },
  'qsvh': { codec: 'hevc_qsv', family: 'h264_qsv', hevc: true, auto: false, label: 'HEVC, Intel',
    args: (q) => ['-c:v', 'hevc_qsv', '-preset', 'slower', ...rules(q), '-profile:v', 'main'] },
  'x265-fast': { codec: 'libx265', family: 'libx264', hevc: true, cpu: true, auto: false, label: 'HEVC, processor',
    args: (q) => ['-c:v', 'libx265', '-preset', 'veryfast', ...rules(q), '-x265-params',
      `scenecut=0:aq-mode=0:psy-rd=0:keyint=${q.fps * 2}:min-keyint=${q.fps * 2}:log-level=error`] },
};
// HEVC settings per graphics card, best first
const HEVC_TIERS = { h264_nvenc: ['nvh-p7', 'nvh-p5'], h264_amf: ['amfh'], h264_qsv: ['qsvh'], libx264: ['x265-fast'] };
// Each encoder has settings tiers, best first. The first tier the computer's graphics card accepts is used, so an
// older card still gets the best settings it can do instead of falling all the way back to the processor.
const TIERS = { h264_nvenc: ['nv-p7-full', 'nv-p6-qres', 'nv-p4'], h264_amf: ['amf-best', 'amf-basic'],
  h264_qsv: ['qsv-best', 'qsv-basic'], libx264: ['x264-faster'] };
const TIER_NAMES = ['best', 'good', 'basic'];

// The FFmpeg settings for one variant (or, for older callers, an encoder and tier name)
function encoderArgs(idOrVariant, q, tier = 'best') {
  if (VARIANTS[idOrVariant]) return VARIANTS[idOrVariant].args(q);
  const list = TIERS[idOrVariant] || TIERS.libx264;
  return VARIANTS[list[Math.min(list.length - 1, Math.max(0, TIER_NAMES.indexOf(tier)))]].args(q);
}

// The same settings for the n-th video stream of a stream with several encodes: "-b:v 6M" becomes "-b:v:1 6M"
function forStream(args, n) {
  const out = [];
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i];
    out.push(/:v$/.test(k) ? `${k}:${n}` : k.includes(':') ? k : `${k}:v:${n}`, args[i + 1]);
  }
  return out;
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
  // YouTube's secure server (its recommended one)
  if (platform === 'youtube') return `rtmps://a.rtmps.youtube.com:443/live2/${key}`;
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

  // Can this computer use these encoder settings? Tried on a short test picture. '' = yes, otherwise FFmpeg's reason.
  tryVariant(variant, { width = 1280, height = 720, bitrate = 4000000 } = {}) {
    return new Promise((res) => {
      execFile(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=30`,
        '-frames:v', '30', '-pix_fmt', 'yuv420p', ...encoderArgs(variant, { fps: 30, bitrate }), '-f', 'null', '-'],
        { timeout: 20000, windowsHide: true }, (err, _o, stderr) => res(err ? String(stderr || err.message).trim().split('\n').pop() || 'failed' : ''));
    });
  }

  // Try each graphics-card encoder (and its settings tiers, best first) with a short test picture; keep the
  // first that works. Settings picked by the sharpness test ("preferred") are tried first.
  async probe(preferred) {
    this.encoder = null;
    if (preferred && VARIANTS[preferred]) {
      const v = VARIANTS[preferred];
      const problem = v.cpu ? '' : await this.tryVariant(preferred);
      if (!problem) this.encoder = { ...ENCODERS.find((e) => e.id === v.codec), tier: 'tuned', variant: preferred };
      else this.log(`Settings picked by the sharpness test (${preferred}) not usable now: ${problem.slice(0, 200)}`);
    }
    for (const e of ENCODERS) {
      if (this.encoder) break;
      for (const [i, variant] of TIERS[e.id].entries()) {
        const tier = TIER_NAMES[i];
        if (e.id === 'libx264') { this.encoder = { ...e, tier, variant }; break; }
        const problem = await this.tryVariant(variant);
        if (!problem) { this.encoder = { ...e, tier, variant }; break; }
        if (e.id === 'h264_nvenc' || i > 0) this.log(`Encoder ${e.id} (${tier}) not usable: ${problem.slice(0, 200)}`);
      }
    }
    this.log(`Encoder: ${this.encoder.id}, ${this.encoder.tier} settings (${this.encoder.variant})`);
    return this.encoder;
  }

  // The best HEVC settings this computer can make at this size (null if none)
  async probeHevc(size) {
    const family = this.encoder ? this.encoder.id : 'libx264';
    for (const v of HEVC_TIERS[family] || []) {
      if (VARIANTS[v].cpu && size.height > 1080) continue; // the processor can't make big HEVC in real time
      const problem = await this.tryVariant(v, size);
      if (!problem) return v;
      this.log(`HEVC ${v} at ${size.width}x${size.height} not usable: ${problem.slice(0, 200)}`);
    }
    return null;
  }

  // dests: [{id, name, url, secret, stream}], plan: {fps, input: {width, height}, encodes: [{width, height, bitrate,
  // variant}]}. Each destination gets the encode numbered by its "stream" (encodes are shared when identical).
  // Older form: plan = {fps, bitrate}: one encode for every destination.
  start(dests, plan) {
    if (this.live) return;
    if (!this.encoder) this.encoder = { ...ENCODERS[ENCODERS.length - 1], tier: 'best', variant: 'x264-faster' };
    if (!plan.encodes) plan = { ...plan, encodes: [{ bitrate: plan.bitrate, variant: this.encoder.variant }] };
    dests = dests.map((d) => ({ ...d, stream: d.stream || 0 }));
    this.live = true;
    this.quality = plan;
    this.plan = plan;
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
    const plan = this.plan, q = plan;
    const input = plan.input || {};
    // The browser turns the picture into video colours with the older BT.601 formula; convert to BT.709 (what the
    // tags say and what players expect) so Phosphor Loop's colours come out right. The flags keep colour edges
    // sharp (FFmpeg's defaults blur them). An encode smaller than the picture (Kick's 1080p copy of a 4K picture)
    // is scaled down in the same step, with a sharp filter.
    const conv = 'in_color_matrix=bt601:out_color_matrix=bt709:in_range=tv:out_range=tv';
    // Stream-friendly: a light smoothing of fine speckle and frame-to-frame shimmer before squeezing, so the
    // platform's small bitrate goes on the shapes instead of noise. Recordings never pass through here.
    const calm = plan.calm ? 'hqdn3d=1.5:1:4:3,' : '';
    const n = plan.encodes.length;
    const branches = plan.encodes.map((e, i) => {
      const resize = e.width && e.height && (e.width !== input.width || e.height !== input.height);
      const fmt = /_qsv$/.test(VARIANTS[e.variant] ? VARIANTS[e.variant].codec : '') ? 'nv12' : 'yuv420p';
      return `[s${i}]${calm}scale=${resize ? `w=${e.width}:h=${e.height}:` : ''}${conv}:flags=${resize ? 'lanczos+' : ''}accurate_rnd+full_chroma_int+full_chroma_inp,format=${fmt}[v${i}]`;
    });
    const graph = `[0:v:0]split=${n}${plan.encodes.map((_, i) => `[s${i}]`).join('')};` + branches.join(';');
    const encArgs = [];
    plan.encodes.forEach((e, i) => {
      encArgs.push('-map', `[v${i}]`, ...forStream(encoderArgs(e.variant || this.encoder.variant, { fps: q.fps, bitrate: e.bitrate }), i));
    });
    const args = ['-hide_banner', '-loglevel', 'warning', '-stats_period', '5', '-progress', 'pipe:2',
      // A picture bigger than 1080p is unpacked on the graphics card when it can (much less work for the processor)
      ...((input.height || 0) > 1080 ? ['-hwaccel', 'auto'] : []),
      '-fflags', '+genpts', '-thread_queue_size', '1024', '-i', 'pipe:0',
      '-filter_complex', graph, ...encArgs, '-map', '0:a:0?',
      '-r', String(q.fps), '-fps_mode', 'cfr',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-bsf:v', 'dump_extra=freq=keyframe',
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
    // It takes only its own encode out of the shared stream (which may hold several).
    const total = this.plan.encodes.reduce((a, e) => a + e.bitrate, 0) + 160000;
    const enc = this.plan.encodes[s.def.stream] || this.plan.encodes[0];
    const hevc = VARIANTS[enc.variant] && VARIANTS[enc.variant].hevc;
    const args = ['-hide_banner', '-loglevel', 'info', '-nostats', '-probesize', String(Math.max(10000000, Math.round(total / 8 * 4))),
      '-analyzeduration', '3000000',
      '-readrate', '1', '-readrate_initial_burst', '0.5', '-f', 'mpegts', '-i', 'pipe:0',
      '-map', `0:v:${s.def.stream}`, '-map', '0:a:0?', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-flvflags', 'no_duration_filesize', '-rw_timeout', '15000000',
      // HEVC goes out as "enhanced RTMP", which YouTube understands
      ...(hevc ? ['-rtmp_enhanced_codecs', 'hvc1'] : []),
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
    // An upload that can't keep up: the sender's waiting pile keeps growing. Say so plainly (once per stretch).
    for (const s of this.senders.values()) {
      const waiting = s.proc && s.proc.stdin ? s.proc.stdin.writableLength : 0;
      s.slow = waiting > 6 * 1024 * 1024 ? (s.slow || 0) + 1 : 0;
      if (s.slow === 10) {
        this.log(`${s.def.name}: the internet upload isn't keeping up (${(waiting / 1e6).toFixed(0)} MB waiting)`);
        this.emit('slow-upload', s.def);
      }
    }
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
      const m = line.match(/^(frame|dup_frames|drop_frames|speed|progress)=\s*(\S+)/);
      if (!m) { if (line.trim()) other.push(line.trim()); continue; }
      if (m[1] === 'frame') pr.frame = +m[2];
      else if (m[1] === 'dup_frames') pr.dup = +m[2];
      else if (m[1] === 'drop_frames') pr.drop = +m[2];
      else if (m[1] === 'speed') {
        // The squeezer can't keep up with real time (too big a picture or too many streams for this computer)
        const sp = parseFloat(m[2]);
        pr.slowSpeed = Number.isFinite(sp) && sp > 0 && sp < 0.93 && Date.now() - this.startedAt > 30000 ? (pr.slowSpeed || 0) + 1 : 0;
        if (pr.slowSpeed === 4) { this.log(`Squeezing is behind real time (speed ${sp}x)`); this.emit('slow-encode', sp); }
      }
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

module.exports = { Streamer, buildUrl, encoderArgs, forStream, redactor, ENCODERS, TIERS, VARIANTS, HEVC_TIERS };
