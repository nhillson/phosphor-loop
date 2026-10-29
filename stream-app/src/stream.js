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
// gop: seconds between keyframes (2 unless Twitch's Enhanced Broadcasting asks for something else)
const rules = ({ fps, bitrate, gop = 2 }) => ['-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate), '-g', String(Math.round(fps * gop))];
const nv = (preset, extra, { idr = true } = {}) => (q) => ['-c:v', 'h264_nvenc', '-preset', preset, '-tune', 'hq', '-rc', 'cbr',
  ...extra, ...rules(q), '-no-scenecut', '1', ...(idr ? ['-forced-idr', '1'] : []), '-profile:v', 'high'];
const AQ0 = ['-spatial-aq', '0', '-temporal-aq', '0'];
const x264 = (preset, params) => (q) => ['-c:v', 'libx264', '-preset', preset, ...rules(q), '-keyint_min', String(Math.round(q.fps * (q.gop || 2))),
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
  // Lighter, for the smaller extra qualities Twitch's Enhanced Broadcasting asks for (720p and below), so the card
  // has time left for the top quality and the other platforms
  'nv-p5-light': { codec: 'h264_nvenc', auto: false, label: 'Lighter (extra Twitch qualities)',
    args: nv('p5', ['-multipass', 'disabled', ...AQ0, '-rc-lookahead', '8', '-bf', '2']) },
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
      `scenecut=0:aq-mode=0:psy-rd=0:keyint=${Math.round(q.fps * (q.gop || 2))}:min-keyint=${Math.round(q.fps * (q.gop || 2))}:log-level=error`] },
  // AV1, only if Twitch ever asks for it (Enhanced Broadcasting) and the card can make it (NVIDIA RTX 40 and newer,
  // AMD RX 7000 and newer, Intel Arc). Never made on the processor: far too slow.
  'nva-p7': { codec: 'av1_nvenc', family: 'h264_nvenc', av1: true, auto: false, label: 'AV1, max quality',
    args: (q) => ['-c:v', 'av1_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'cbr', '-multipass', 'fullres', ...AQ0, '-rc-lookahead', '16',
      '-bf', '3', ...rules(q), '-no-scenecut', '1', '-forced-idr', '1'] },
  'nva-p5': { codec: 'av1_nvenc', family: 'h264_nvenc', av1: true, auto: false, label: 'AV1, lighter',
    args: (q) => ['-c:v', 'av1_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'cbr', '-multipass', 'disabled', ...AQ0, '-bf', '0', ...rules(q), '-no-scenecut', '1', '-forced-idr', '1'] },
  'amfa': { codec: 'av1_amf', family: 'h264_amf', av1: true, auto: false, label: 'AV1, AMD',
    args: (q) => ['-c:v', 'av1_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'cbr', ...rules(q)] },
  'qsva': { codec: 'av1_qsv', family: 'h264_qsv', av1: true, auto: false, label: 'AV1, Intel',
    args: (q) => ['-c:v', 'av1_qsv', '-preset', 'slower', ...rules(q)] },
};
// HEVC settings per graphics card, best first
const HEVC_TIERS = { h264_nvenc: ['nvh-p7', 'nvh-p5'], h264_amf: ['amfh'], h264_qsv: ['qsvh'], libx264: ['x265-fast'] };
const AV1_TIERS = { h264_nvenc: ['nva-p7', 'nva-p5'], h264_amf: ['amfa'], h264_qsv: ['qsva'], libx264: [] };
// The lighter settings per codec and graphics card, for Twitch's smaller extra qualities
const LIGHT = {
  h264: { h264_nvenc: 'nv-p5-light', h264_amf: 'amf-basic', h264_qsv: 'qsv-basic', libx264: 'x264-veryfast' },
  hevc: { h264_nvenc: 'nvh-p5', h264_amf: 'amfh', h264_qsv: 'qsvh', libx264: 'x265-fast' },
  av1: { h264_nvenc: 'nva-p5', h264_amf: 'amfa', h264_qsv: 'qsva', libx264: null },
};
const codecOfVariant = (id) => (VARIANTS[id] && VARIANTS[id].av1 ? 'av1' : VARIANTS[id] && VARIANTS[id].hevc ? 'hevc' : 'h264');
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

// The squeezer's picture steps, done as little as possible. The colour conversion (the browser's BT.601 to BT.709,
// with sharp colour edges) happens ONCE, at the biggest size any platform gets; every smaller size is then scaled
// down from the next bigger one (a 1080p picture becomes 720p, that becomes 480p, and so on). Twitch's Enhanced
// Broadcasting asks for five sizes at once; doing the full conversion five times from the full picture was too slow
// on Nick's PC at 1440p (the squeeze fell to 0.6x real time, 17 frames a second).
// The extra-sharp colour step (full_chroma_int) costs about twice as much; it's kept up to 1080p, where the processor
// has time for it, and left out above (a 1440p or 4K conversion with it can't keep up on a fast desktop processor).
// Stream-friendly's light smoothing is also done once, on the biggest picture.
// Labels: [v<i>] is the finished picture for encode i.
function buildGraph(plan, input = {}) {
  const conv = 'in_color_matrix=bt601:out_color_matrix=bt709:in_range=tv:out_range=tv';
  const sharp = 'accurate_rnd+full_chroma_int+full_chroma_inp', light = 'accurate_rnd+full_chroma_inp';
  const iw = input.width || 0, ih = input.height || 0;
  const sizeOf = (e) => ({ w: e.width || iw, h: e.height || ih });
  // distinct sizes, biggest first
  const sizes = [];
  for (const e of plan.encodes) { const z = sizeOf(e); if (!sizes.some((x) => x.w === z.w && x.h === z.h)) sizes.push(z); }
  sizes.sort((a, b) => b.h - a.h || b.w - a.w);
  const parts = [];
  sizes.forEach((z, k) => {
    const users = plan.encodes.map((e, i) => ({ e, i })).filter(({ e }) => { const s = sizeOf(e); return s.w === z.w && s.h === z.h; });
    const outs = users.length + (k + 1 < sizes.length ? 1 : 0);
    let chain;
    if (k === 0) {
      const resize = iw && ih && (z.w !== iw || z.h !== ih);
      chain = `[0:v:0]${plan.calm ? 'hqdn3d=1.5:1:4:3,' : ''}scale=${resize ? `w=${z.w}:h=${z.h}:` : ''}${conv}:flags=${resize ? 'lanczos+' : ''}${Math.max(z.h, ih) > 1080 ? light : sharp}`;
    } else {
      // From the next bigger picture (already BT.709): sharp lanczos for 720p and up, a lighter filter below
      chain = `[z${k - 1}]scale=w=${z.w}:h=${z.h}:flags=${z.h >= 720 ? 'lanczos' : 'bicubic'}+${light}`;
    }
    const labels = users.map(({ i }) => `[u${i}]`).concat(k + 1 < sizes.length ? [`[z${k}]`] : []);
    parts.push(outs > 1 ? `${chain},split=${outs}${labels.join('')}` : `${chain}${labels[0]}`);
    for (const { e, i } of users) {
      const fmt = /_qsv$/.test(VARIANTS[e.variant] ? VARIANTS[e.variant].codec : '') ? 'nv12' : 'yuv420p';
      // A slower extra quality (Twitch's Enhanced Broadcasting can ask for 30 fps copies of a 60 fps picture)
      const slower = e.fps && e.fps < plan.fps ? `fps=${e.fps},` : '';
      parts.push(`[u${i}]${slower}format=${fmt}[v${i}]`);
    }
  });
  return parts.join(';');
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

  // The best AV1 settings this computer can make at this size (null if none)
  async probeAv1(size) {
    const family = this.encoder ? this.encoder.id : 'libx264';
    for (const v of AV1_TIERS[family] || []) {
      const problem = await this.tryVariant(v, size);
      if (!problem) return v;
      this.log(`AV1 ${v} at ${size.width}x${size.height} not usable: ${problem.slice(0, 200)}`);
    }
    return null;
  }

  // Can this computer make all of a plan's encodes at the same time? (A graphics card has a limit on how many it
  // makes at once, and Twitch's Enhanced Broadcasting can ask for five.) '' = yes, otherwise FFmpeg's reason.
  // Only whether the encoders open and run matters here (a card's limit shows up at once), not speed: a few frames are
  // enough, and a check that only runs out of time (a busy computer) counts as a yes.
  tryPlan(plan, frames = 6) {
    const input = plan.input || { width: 1280, height: 720 };
    const n = plan.encodes.length;
    const branches = plan.encodes.map((e, i) => `[s${i}]${e.fps && e.fps < plan.fps ? `fps=${e.fps},` : ''}scale=${e.width || input.width}:${e.height || input.height},format=${/_qsv$/.test(VARIANTS[e.variant] ? VARIANTS[e.variant].codec : '') ? 'nv12' : 'yuv420p'}[v${i}]`);
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${input.width}x${input.height}:r=${plan.fps}`,
      '-frames:v', String(frames), '-filter_complex', `[0:v]split=${n}${plan.encodes.map((_, i) => `[s${i}]`).join('')};` + branches.join(';')];
    plan.encodes.forEach((e, i) => args.push('-map', `[v${i}]`, ...forStream(encoderArgs(e.variant, { fps: e.fps || plan.fps, bitrate: e.bitrate, gop: e.gop }), i)));
    args.push('-f', 'null', '-');
    return new Promise((res) => {
      execFile(this.ffmpeg, args, { timeout: 45000, windowsHide: true }, (err, _o, stderr) => {
        if (err && err.killed) { this.log('Checking all encodes at once took too long (a busy computer); going ahead'); return res(''); }
        res(err ? String(stderr || err.message).trim().split('\n').slice(-2).join(' ') || 'failed' : '');
      });
    });
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
    this.redact = redactor(dests.flatMap((d) => [d.secret, ...(d.secrets || [])]));
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
    const graph = buildGraph(plan, input);
    const encArgs = [];
    plan.encodes.forEach((e, i) => {
      const fps = e.fps && e.fps < q.fps ? e.fps : q.fps;
      encArgs.push('-map', `[v${i}]`, ...forStream(encoderArgs(e.variant || this.encoder.variant, { fps, bitrate: e.bitrate, gop: e.gop }), i), `-r:v:${i}`, String(fps));
    });
    const args = ['-hide_banner', '-loglevel', 'warning', '-stats_period', '5', '-progress', 'pipe:2',
      // A picture bigger than 1080p is unpacked on the graphics card when it can (much less work for the processor)
      ...((input.height || 0) > 1080 ? ['-hwaccel', 'auto'] : []),
      '-fflags', '+genpts', '-thread_queue_size', '1024', '-i', 'pipe:0',
      '-filter_complex', graph, ...encArgs, '-map', '0:a:0?',
      '-fps_mode', 'cfr',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-bsf:v', 'dump_extra=freq=keyframe',
      '-af', 'aresample=async=1000', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
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
    // Twitch's Enhanced Broadcasting: several encodes ("tracks") in one connection, the top quality first. FFmpeg
    // sends the first as ordinary FLV video and the others as enhanced-RTMP multitrack packets, as OBS does.
    const streams = s.def.multitrack && Array.isArray(s.def.streams) && s.def.streams.length ? s.def.streams : [s.def.stream];
    const enc = this.plan.encodes[streams[0]] || this.plan.encodes[0];
    const hevc = !s.def.multitrack && VARIANTS[enc.variant] && VARIANTS[enc.variant].hevc;
    const args = ['-hide_banner', '-loglevel', 'info', '-nostats', '-probesize', String(Math.max(10000000, Math.round(total / 8 * 4))),
      '-analyzeduration', '3000000',
      '-readrate', '1', '-readrate_initial_burst', '0.5', '-f', 'mpegts', '-i', 'pipe:0',
      ...streams.flatMap((n) => ['-map', `0:v:${n}`]), '-map', '0:a:0?', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-flvflags', 'no_duration_filesize', '-rw_timeout', '15000000',
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
      if (s.state !== 'live' && /Output #0, flv/.test(text + tail)) {
        s.state = 'live'; s.message = 'Live'; s.retry = 0; s.wasLive = true; this.emitStatus();
      }
      // (Joining a stream mid-way, the first moments can't be read until the next full picture: not worth logging)
      for (const line of text.split(/\r?\n/)) if (/error|fail|refused|denied|invalid|timed? ?out/i.test(line) && !/decode_slice_header|non-existing PPS|no frame!/i.test(line)) this.log(`${s.def.name}: ${line.trim()}`);
    });
    p.on('exit', (code) => {
      if (s.proc === p) s.proc = null;
      if (!this.live || !this.senders.has(id)) return;
      // Enhanced Broadcasting that keeps failing within half a minute (Twitch turning it down, or the stream key it
      // gave no longer working): switch this platform to its normal single stream, made from one of the tracks
      // already being squeezed, so nothing else is disturbed
      if (s.def.multitrack) {
        s.mtFails = Date.now() - s.startedAt < 30000 ? (s.mtFails || 0) + 1 : 0;
        if (s.mtFails >= 3) {
          const why = tail.split('\n').slice(-3).join(' | ');
          this.log(`${s.def.name}: Enhanced Broadcasting failed ${s.mtFails} times in a row (${why})`);
          this.emit('multitrack-failed', s.def, why);
          if (s.def.fallback) {
            this.log(`${s.def.name}: switching to a normal stream (${s.def.fallback.label || 'one track'})`);
            s.def = { ...s.def, ...s.def.fallback, multitrack: false, streams: null, fallback: null, note: s.def.fallback.note || '' };
            s.retry = 0; s.mtFails = 0; s.wasLive = false;
            s.state = 'retrying'; s.message = 'Switching to a normal stream…';
            s.timer = setTimeout(() => this.startSender(id), 1000);
            this.emitStatus();
            return;
          }
        }
      }
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
      // FFmpeg's other progress figures (fps=, bitrate=, out_time=, stream_0_1_q=…) aren't needed in the log
      if (!m) { if (line.trim() && !/^[a-z0-9_]+=/.test(line.trim())) other.push(line.trim()); continue; }
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
    for (const [id, s] of this.senders) destinations[id] = { state: s.state, message: s.message, note: s.def.note || '' };
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

module.exports = { Streamer, buildGraph, buildUrl, encoderArgs, forStream, redactor, ENCODERS, TIERS, VARIANTS, HEVC_TIERS, AV1_TIERS, LIGHT, codecOfVariant };
