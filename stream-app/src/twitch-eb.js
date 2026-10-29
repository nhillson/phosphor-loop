'use strict';
// Twitch Enhanced Broadcasting: Twitch picks the stream's settings, and this computer makes every quality viewers can
// pick (Twitch calls them renditions or tracks) and sends them all in one connection.
//
// How it works, the same way OBS does it (OBS's frontend/utility/GoLiveAPI_*.cpp and MultitrackVideoOutput.cpp):
//  1. "Go live" asks Twitch's settings service (GetClientConfiguration) with the stream key, a description of this
//     computer (graphics card, processor, memory, Windows version) and the picture's size and speed.
//  2. Twitch answers with a list of encodes (codec, size, frame rate, bitrate; the first is the top quality), the
//     sound settings, the server to send to, a stream key just for this stream, and a config id.
//  3. All the encodes go out in one enhanced-RTMP ("multitrack") connection: the first track as normal FLV video,
//     the others as multitrack packets with their track number. FFmpeg 7.1 and newer write exactly this.
// Twitch takes 2K (1440p) only as HEVC, and only from Affiliates and Partners; its answer decides that, not us.
// Anything that goes wrong here falls back to a normal Twitch stream.
const os = require('node:os');
const { execFile } = require('node:child_process');

const CONFIG_URL = 'https://ingest.twitch.tv/api/v3/GetClientConfiguration';
const SCHEMA = '2025-01-25';

// Which codec an encoder type in Twitch's answer means. Twitch names OBS's encoders ("obs_nvenc_hevc_tex",
// "jim_av1_nvenc", "h265_texture_amf", "obs_x264", "obs_qsv11"…); only the codec matters to us.
function codecOf(type, settings) {
  const t = String(type || '').toLowerCase();
  if (/av1/.test(t)) return 'av1';
  if (/hevc|h265|265/.test(t)) return 'hevc';
  const prof = String((settings && settings.profile) || '').toLowerCase();
  if (/main ?10/.test(prof) && !/h264|264/.test(t)) return 'hevc';
  return 'h264';
}

// The picture Twitch is told about. Twitch takes at most 1440p; a bigger picture (4K for YouTube) is scaled down.
function canvasFor(input, fps) {
  const height = Math.min(input.height, 1440);
  const width = Math.round(height * input.width / input.height / 2) * 2;
  return { width, height, canvas_width: input.width, canvas_height: input.height, framerate: { numerator: fps, denominator: 1 } };
}

// Twitch's request body (OBS's GoLiveApi::PostData). machine = systemInfo()'s answer.
function buildPost({ key, version, codecs, canvas, machine, maxBitrate = null, maxTracks = null }) {
  return {
    service: 'IVS',
    schema_version: SCHEMA,
    authentication: key,
    client: { name: 'phosphor-stream', version: String(version || '0'), supported_codecs: [...new Set(codecs)] },
    capabilities: machine,
    preferences: {
      maximum_aggregate_bitrate: maxBitrate,
      maximum_video_tracks: maxTracks,
      vod_track_audio: false,
      composition_gpu_index: 0,
      audio_samples_per_sec: 48000,
      audio_channels: 2,
      audio_max_buffering_ms: 960,
      audio_fixed_buffering: false,
      canvases: [canvas],
    },
  };
}

// Twitch's status messages come as a little HTML; make them plain text for the panel and the log
function plain(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

class TwitchError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

// Ask Twitch for the stream's settings. Throws TwitchError when it can't be used (the caller falls back).
async function requestConfig(post, { url = CONFIG_URL, timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res, text;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post), signal: ctl.signal });
    text = await res.text();
  } catch (e) {
    throw new TwitchError(e.name === 'AbortError' ? 'Twitch’s settings service didn’t answer in time' : 'Couldn’t reach Twitch’s settings service (' + e.message + ')');
  } finally { clearTimeout(timer); }
  let data;
  try { data = JSON.parse(text); } catch (_) {
    throw new TwitchError(`Twitch’s settings service answered ${res.status} with something unreadable: ${plain(text).slice(0, 200)}`);
  }
  const status = data.status || {};
  const message = plain(status.html_en_us || data.message || data.error || '');
  if (status.result === 'error') throw new TwitchError(message || 'Twitch said no without a reason', 'error');
  if (!Array.isArray(data.encoder_configurations) || !data.encoder_configurations.length) {
    throw new TwitchError(message || `Twitch sent no stream settings (HTTP ${res.status})`, status.result === 'warning' ? 'warning' : 'error');
  }
  return { config: data, warning: status.result === 'warning' ? (message || 'Twitch gave a warning without details') : '' };
}

// The tracks to make, from Twitch's answer, in Twitch's order (the first is the top quality). A track can't be bigger
// or faster than the picture.
function tracksFrom(config, { input, fps }) {
  return config.encoder_configurations.filter((c) => (c.canvas_index || 0) === 0).map((c) => {
    const s = c.settings || {};
    const f = c.framerate && c.framerate.numerator ? c.framerate.numerator / (c.framerate.denominator || 1) : fps;
    let height = Math.min(+c.height || 1080, input.height);
    let width = Math.min(+c.width || Math.round(height * 16 / 9), input.width);
    width -= width % 2; height -= height % 2;
    const kbps = +s.bitrate || +s.max_bitrate || 0;
    return {
      codec: codecOf(c.type, s), type: String(c.type || ''), width, height,
      fps: Math.max(1, Math.min(fps, Math.round(f))),
      bitrate: Math.round((kbps || 2500) * 1000),
      gop: Math.max(1, Math.min(4, +s.keyint_sec || 2)),
    };
  });
}

// The address to send to: Twitch's server, the stream key it gave for this stream (or the usual one), plus the
// config id so Twitch knows which settings this stream uses. Query items on the usual key (like ?bandwidthtest=true)
// are carried over. Same steps as OBS's create_service().
function ingestUrl(config, userKey, { rtmps = false } = {}) {
  const eps = (config.ingest_endpoints || []).filter((e) => /^rtmp/i.test(e.protocol || '') && e.url_template);
  const ep = eps.find((e) => /rtmps/i.test(e.protocol) === rtmps) || eps[0];
  if (!ep) throw new TwitchError('Twitch sent no server to stream to');
  const server = ep.url_template.replace(/\/\{stream_key\}.*$/, '').replace(/\/+$/, '');
  const [userBase, userQuery = ''] = String(userKey).split('?');
  const minted = ep.authentication && String(ep.authentication).trim();
  const [keyBase, keyQuery = ''] = (minted || userBase).split('?');
  const q = new URLSearchParams(keyQuery);
  for (const [k, v] of new URLSearchParams(userQuery)) q.append(k, v);
  const id = config.meta && config.meta.config_id;
  if (id) q.append('clientConfigId', id);
  const query = q.toString();
  return { url: `${server}/${keyBase}${query ? '?' + query : ''}`, secrets: [keyBase, minted, userBase].filter(Boolean), server, configId: id || '' };
}

/* ---------- this computer, described the way Twitch asks for it ---------- */
const PS = `
$ErrorActionPreference='SilentlyContinue'
$g = @(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name=$_.Name; pnp=$_.PNPDeviceID; driver=$_.DriverVersion; ram=[uint64]$_.AdapterRAM } })
$r = @(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' | ForEach-Object {
  $m = $_.'HardwareInformation.qwMemorySize'; if ($m -is [byte[]]) { $b = New-Object byte[] 8; [Array]::Copy($m, $b, [Math]::Min(8, $m.Length)); $m = [BitConverter]::ToUInt64($b, 0) }
  [pscustomobject]@{ desc=$_.DriverDesc; id=$_.MatchingDeviceId; mem=[uint64]$m } })
$c = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed
$v = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' | Select-Object CurrentBuildNumber, DisplayVersion, ReleaseId, UBR, CurrentMajorVersionNumber, CurrentMinorVersionNumber
@{ gpus=$g; reg=$r; cpu=$c; ver=$v } | ConvertTo-Json -Depth 4 -Compress`;

function runPowerShell(script, timeout = 15000) {
  return new Promise((res) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 4e6 }, (err, out) => {
        if (err) return res(null);
        try { res(JSON.parse(String(out).trim())); } catch (_) { res(null); }
      });
  });
}
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);

// Turns PowerShell's answer (or nothing) into Twitch's "capabilities". electronGpu: app.getGPUInfo('basic').gpuDevice
// as a fallback for the graphics card list.
function describe(win, electronGpu = []) {
  const cpus = os.cpus();
  const total = os.totalmem();
  const gpus = [];
  for (const g of arr(win && win.gpus)) {
    const m = /VEN_([0-9A-F]{4}).*DEV_([0-9A-F]{4})/i.exec(g.pnp || '');
    if (!m) continue;
    const vendor = parseInt(m[1], 16), device = parseInt(m[2], 16);
    if (vendor === 0x1414) continue; // Microsoft's basic display driver (not a graphics card)
    const reg = arr(win.reg).find((r) => r.id && new RegExp(`ven_${m[1]}&dev_${m[2]}`, 'i').test(r.id)) || arr(win.reg).find((r) => r.desc === g.name);
    const mem = reg && reg.mem > 0 ? reg.mem : g.ram || 0;
    gpus.push({ model: g.name || 'Unknown', vendor_id: vendor, device_id: device, dedicated_video_memory: mem,
      shared_system_memory: Math.floor(total / 2), driver_version: g.driver || null });
  }
  if (!gpus.length) {
    for (const d of electronGpu || []) {
      if (!d.vendorId || d.vendorId === 0x1414) continue;
      gpus.push({ model: d.deviceString || 'Unknown', vendor_id: d.vendorId, device_id: d.deviceId || 0, dedicated_video_memory: 0,
        shared_system_memory: Math.floor(total / 2), driver_version: d.driverVersion || null });
    }
  }
  // The card the picture is drawn on (the active one) first, NVIDIA before others when unsure
  const active = (electronGpu || []).find((d) => d.active);
  gpus.sort((a, b) => (active ? (b.vendor_id === active.vendorId && b.device_id === active.deviceId) - (a.vendor_id === active.vendorId && a.device_id === active.deviceId) : 0)
    || (b.vendor_id === 0x10de) - (a.vendor_id === 0x10de));
  const c = (win && win.cpu) || {};
  const v = (win && win.ver) || {};
  const rel = os.release().split('.');
  return {
    cpu: {
      physical_cores: +c.NumberOfCores || Math.max(1, Math.round(cpus.length / 2)),
      logical_cores: +c.NumberOfLogicalProcessors || cpus.length,
      speed: +c.MaxClockSpeed || (cpus[0] && cpus[0].speed) || null,
      name: String(c.Name || (cpus[0] && cpus[0].model) || '').trim() || null,
    },
    memory: { total, free: os.freemem() },
    gaming_features: null,
    system: {
      version: v.CurrentMajorVersionNumber != null ? `${v.CurrentMajorVersionNumber}.${v.CurrentMinorVersionNumber || 0}` : `${rel[0] || 10}.${rel[1] || 0}`,
      name: process.platform === 'win32' ? 'Windows' : os.type(),
      build: +v.CurrentBuildNumber || +rel[2] || 0,
      release: String(v.DisplayVersion || v.ReleaseId || 'unavailable'),
      revision: String(v.UBR != null ? v.UBR : 0),
      bits: 64, arm: process.arch === 'arm64', armEmulation: false,
    },
    gpu: gpus,
  };
}

let cachedWin;
async function systemInfo(electronGpu) {
  if (process.platform === 'win32' && cachedWin === undefined) cachedWin = await runPowerShell(PS);
  return describe(cachedWin, electronGpu);
}

// Nick's choice to send the top quality at more than Twitch picked (a Twitch engineer suggested about 8 Mbps for
// 1080p H.265). Only ever raises, only the top track; returns the new tracks and what changed (for the log).
function raiseTop(tracks, bps) {
  if (!bps || !tracks.length || tracks[0].bitrate >= bps) return { tracks, raised: null };
  const from = tracks[0].bitrate;
  return { tracks: [{ ...tracks[0], bitrate: bps, raised: from }, ...tracks.slice(1)], raised: { from, to: bps } };
}

// A short line for the log and the panel: "1440p HEVC 8.0 + 1080p H.264 6.0 + 720p H.264 3.0 Mbps"
const CODEC_NAME = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1' };
function summary(tracks) {
  return tracks.map((t) => `${t.height}p${t.fps} ${CODEC_NAME[t.codec]} ${(t.bitrate / 1e6).toFixed(1)}${t.raised ? ' (raised)' : ''}`).join(' + ') + ' Mbps';
}

module.exports = { raiseTop, CONFIG_URL, codecOf, canvasFor, buildPost, requestConfig, tracksFrom, ingestUrl, describe, systemInfo, plain, summary, TwitchError, CODEC_NAME };
