# Picture path audit: Phosphor Loop canvas to final NVENC encode

(v1.1.1: the sender is paced with `-readrate 1`, probes 3 s, bufsize = bitrate, Kick at 7.5 Mbps. Those affect delivery only, not the picture before NVENC.)

Code audited: `stream-app/src/{main.js,stream.js,capture-page.js,preload-site.js}`, `js/app.js` (capture mode), `js/shaders.js` (FS_DISPLAY).
Measurements: Chromium 141.0.7390.37 (Playwright) in this workspace, which is close to Electron 38's Chromium 140, plus FFmpeg 6.1.

## 1. Where detail or accuracy is lost before the final encode

| # | Where | What happens | Effect | Severity |
|---|---|---|---|---|
| L1 | `capture-page.js:53-56` (MediaRecorder) plus `stream.js:123-127` (decode and re-encode) | **Two lossy encodes.** Chromium H.264 at 60/90 Mbps (Media Foundation hardware encoder on Windows, CBR, probably Baseline, no lookahead or B-frames), then a decode, then NVENC at 6–7.5 Mbps. | Generation loss. NVENC also spends bits copying the first encoder's noise and block edges. See the numbers in §4. | Medium |
| L2 | Chromium canvas capture, `libyuv::ConvertToI420` | RGB to YUV uses **BT.601 limited range**. **Measured:** red gives Y/U/V 82/90/239 (BT.601 predicts 81/90/240; BT.709 predicts 63/102/240). VP9 output is tagged `smpte170m`. The Media Foundation H.264 path writes no colour signalling in its VUI. | See L3. | |
| L3 | `stream.js:126` `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv` | **Labels only, no conversion.** **Measured (FFmpeg 6.1):** the pixels come out unchanged and are tagged 709, so players decode BT.601 numbers with BT.709 maths. | Hue and brightness shift, not a contrast crush (both stages are limited range). Pure green shows as (0,215,0); Phosphor purple #8b1ab8 shows as (146,47,188), so it is lighter and less saturated; red picks up some green. | Medium (colour) |
| L4 | Chromium `ConvertToI420` | 4:2:0 chroma made by a 2×2 box average, centre-sited. H.264 expects left-sited chroma (the default `chroma_sample_location`). | Colour detail at half resolution (unavoidable for Kick and Twitch), plus a half-pixel colour shift at edges. | Low–Med |
| L5 | `app.js:7498-7500` capture gate | `if (now < captureNextAt - 1) skip`. `now` is `performance.now()` (it jitters), not the rAF vsync timestamp. A callback that runs about 1.1 ms early drops a whole frame. On a 144 Hz monitor, 60 fps alternates 2- and 3-vsync gaps. FFmpeg `-r fps -fps_mode cfr` (`stream.js:125`) then duplicates or drops to fill its grid. | Lost detail over time (judder), and repeated frames spend bits unevenly. | Medium at 60 fps |
| L6 | `shaders.js:588` (FS_DISPLAY) | On beats, `uPunch`/`uShake` zoom the finished picture by up to about 6–8% with **bilinear** sampling. Otherwise `cuv == uv` lands exactly on pixel centres, so the copy is 1:1. | Softening on every kick when React to sound uses kick or warp. Whole-frame zoom also starves the encoder. | Low (art choice) |
| L7 | 8-bit canvas with no dithering after RGBA16F loops | Banding in dark gradients. | Minor. | Low |

**Checked and fine:** capture mode really is 1920×1080 with 1080 simulation lines. `resim()` gives h=1080 and w=round(1080·16/9/4)·4=1920 (`app.js:6008-6010`). `SHARP_MAX_PX` is skipped when `cap` is set (`:6011`). The DPR cap is skipped because `fit()` uses `cfg.width/height` directly (`:6108-6111`). The CSS size and WebContentsView size only affect the on-screen preview, because `captureStream` reads the canvas's own 1920×1080 buffer. `comp` (simW×simH) to the canvas (1920×1080) is 1:1, so there is no scaling. MediaRecorder does not cap high bitrates: only a 75 kbps minimum exists, and `videoBitsPerSecond` passes through ([media_recorder.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/mediarecorder/media_recorder.cc)).

Sources: [video_track_recorder.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/mediarecorder/video_track_recorder.cc) (hardware VEA first, OpenH264 Baseline fallback, `libyuv::ConvertToI420`, drops frames when "Too many frames are queued up"); [canvas_capture_handler.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/mediacapturefromelement/canvas_capture_handler.cc) (I420 only); [MF encode accelerator](https://cobalt.googlesource.com/cobalt/+/HEAD/media/gpu/windows/media_foundation_video_encode_accelerator_win.cc) (CBR or peak-VBR, no B-frames, no MF_MT_YUV_MATRIX); [Chromium commit on capture colour space](https://chromium.googlesource.com/chromium/src/+/846b7af2175ae970e53b41cdf9556a285f5247af).

## 2. Ranked fixes

| Rank | Fix | Detail kept | Cost | Latency | Risk (Electron 38, Windows) |
|---|---|---|---|---|---|
| 0 (now, one line) | Correct the colour: `-vf scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=tv:out_range=tv:flags=accurate_rnd+full_chroma_int+full_chroma_inp` before the encoder. The flags are required: default flags blur colour (§4). **Measured** to land exactly on BT.709 targets (red 62/102/239 against a target of 63/102/240). Don't use `colorspace=all=bt709:iall=bt601-6-525`: it also changes the primaries, which is wrong here. | Colour accuracy | Negligible | 0 | Very low |
| 0b (now) | Gate fix in `app.js`: use the rAF timestamp and allow half a frame of slack: `if (ts < captureNextAt - 500/captureFps)`. | Steady motion | 0 | 0 | Low |
| **1 (recommended)** | **Raw frames, one encode.** WebGL2 pass in the page turns the canvas into **BT.709 limited NV12** (left-sited chroma). Async `readPixels` through a PBO and fence gives 3.1 MB per frame. IPC to main, then FFmpeg `-f rawvideo -pix_fmt nv12`, then NVENC. Bandwidth is 93 MB/s at 30 fps and 187 MB/s at 60 fps. | **Best possible.** Only the platform encode is left. | Low GPU (one small pass, readback 3 MB). Main process copies about 190 MB/s at 60 fps. Frees the second encoder session. | Lower (no 200 ms chunks, no decode) | Medium. Measure IPC throughput on the stream PC; 30 fps fallback. |
| 2 | WebCodecs `VideoEncoder` in the page (hardware avc1, `latencyMode:'quality'`, 40–60 Mbps, or `bitrateMode:'quantizer'` where supported), then FFmpeg as now. | About the same as L1 but you set the profile, keyframes, colour (build the NV12 VideoFrame yourself) and timestamps. Still two encodes. | Like now | Like now | Medium. Quantizer mode on Windows hardware is not guaranteed; check with `isConfigSupported`. |
| 3 | WebCodecs as the *final* encode at 7.5 Mbps, stream copy. | **Worse** than FFmpeg NVENC p6, because Chromium's MF path has no lookahead, no B-frames and no spatial or temporal AQ. | Lowest | Low | Medium. Not recommended. |
| 4 | Keep MediaRecorder but go higher (VP9 or AV1 at 100+ Mbps, or `codecs=avc1.640033` to ask for High profile). | Small gain. VP9 and AV1 are software only in MediaRecorder, too slow at 1080p60. | High CPU (VP9/AV1) | Same | Low |
| 5 | Electron offscreen `useSharedTexture` to get GPU frames in main. | Lossless | Lowest copy cost | Lowest | **High.** Needs a native D3D11 and NVENC module ([Electron OSR docs](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)). It captures the whole page, not just the canvas. Bitmap mode means 8 MB per frame of BGRA through the CPU. |

## 3. Chroma

Kick and Twitch ingest only 8-bit 4:2:0 H.264, so 4:4:4 is not possible. Phosphor's purple #8b1ab8 has BT.709 luma of only about 0.21 (Y≈69). So purple-on-black edges still have a sharp luma edge, but changes between purple, magenta and blue have almost no luma and are carried at half resolution, then quantised harder (H.264 shares one QP and chroma tolerates it badly at low rates). Options, all for the NV12 shader in Fix 1:
- **Correct siting:** horizontal [¼,½,¼] centred on even columns, vertical 2-row average (left-sited, the H.264 default). This removes L4's half-pixel shift.
- **Sharp-YUV (libwebp `sharpyuv` idea):** adjust each chroma sample so that the upsampled result plus luma matches the RGB. This reduces colour bleed at saturated edges, and a cheap one-iteration version fits in the same shader.
- **Encoder:** `h264_nvenc -qp_cb_offset -2 -qp_cr_offset -2` ([FFmpeg nvenc_h264 options](https://ffmpeg.org/doxygen/7.0/nvenc__h264_8c_source.html)) spends a little more on colour. Under CBR this takes bits from luma, so only test it, A/B, on purple looks.

## 4. Measured generation loss (real Phosphor frames, x264 standing in for MF and NVENC)

Clip: 6 real 1080p Phosphor frames (`lab/frames/test`), cycled and panned 3 px/frame to make 60 moving frames at 30 fps.
Proxies: x264 veryfast **Baseline** CBR 60 Mbps zerolatency stands in for Chromium's MF encoder, and x264 medium High CBR **7.5 Mbps** with bf 2 and g 60 stands in for NVENC p6. Scores compare to the source RGB, decoded the way a player would. Script: `pipe/exp2.sh`.

| Path | SSIM | PSNR dB |
|---|---|---|
| A: 4:2:0 conversion only, no encode | 0.990 | 49.1 |
| B: first stage only (60 Mbps) | 0.974 | 42.7 |
| C: **current**, BT.601 numbers shown as BT.709 | 0.840 | 32.08 |
| D: current, colour decoded correctly | 0.842 | 32.63 |
| E: current plus FFmpeg `scale` matrix fix, **default flags** | 0.785 | 32.30 |
| E': same with `flags=accurate_rnd+full_chroma_int+full_chroma_inp` | 0.841 | 32.58 |
| F: **proposed**, raw frames into one encode | 0.847 | 32.69 |

**Conclusion (be honest with Nick):** almost all of the lost detail is lost at the final 6–7.5 Mbps encode (49 dB down to about 32.7 dB), plus whatever Kick's transcode ladder does after that. The first 60 Mbps encode costs only about 0.06 dB and 0.005 SSIM after the final encode. Getting rid of it is worth doing for colour, timing, latency and simplicity, but **it will not visibly bring the fine detail back.** The colour mislabel is visible as a hue and brightness shift, not as lost detail. Watch out: the FFmpeg `scale` matrix fix with default flags (bicubic, chroma not fully interpolated) blurs colour and drops SSIM to 0.785. Always add `accurate_rnd+full_chroma_int+full_chroma_inp`. Caveats: x264 is a proxy, the clip is short, and the motion is synthetic. NVIDIA's MF encoder at 60 Mbps may be a little worse than x264 Baseline, so check this on the stream PC.

## 5. Recommended architecture and sketch

```
Phosphor canvas (1920x1080 RGBA8)
  └─ onFrame hook → WebGL2 (own context) texImage2D(canvas) → NV12 shader (BT.709 limited, left-sited chroma)
       → R8 target 1920x1620 → readPixels into PBO, fenceSync → next frame: getBufferSubData (3.1 MB)
  └─ ipcRenderer.send('frame', gen, buf)  (contextBridge)
main: frame pump at exactly fps (repeat last frame if late, drop if early) → ffmpeg stdin (rawvideo nv12)
audio: AudioWorklet PCM f32 48k → IPC → ffmpeg pipe:3 (or keep MediaRecorder audio-only webm/opus on pipe:3)
ffmpeg: -f rawvideo -pix_fmt nv12 -s 1920x1080 -framerate fps -color_range tv -colorspace bt709 ... -i pipe:0
        -f f32le -ar 48000 -ac 2 -i pipe:3 → h264_nvenc (same "best" tier) → mpegts → senders (unchanged)
```

**Page side (inject into capture-page.js).** **Verified here (Chromium 141):** this shader round-trips colour bars exactly: red→(255,1,0), purple→(139,26,184). Output comes out top-first, and `IMPLEMENTATION_COLOR_READ_FORMAT` is RED. **Must run inside `onFrame`, in the same task as Phosphor's draw.** Called later (after the frame is shown), `texImage2D(canvas)` returns **black**, because `preserveDrawingBuffer:false` (measured).
```js
const W = 1920, H = 1080, OUT_H = H * 3 / 2;                // NV12: Y (H rows) then interleaved UV (H/2 rows)
const oc = new OffscreenCanvas(W, OUT_H), g = oc.getContext('webgl2', { antialias: false });
const src = g.createTexture(); g.bindTexture(g.TEXTURE_2D, src);
g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
// No FLIP_Y: texel row 0 = top of the picture, and readPixels row 0 = fragment row 0, so the buffer comes out top-first
const FS = `#version 300 es
precision highp float; uniform sampler2D s; out vec4 o;
const vec3 KY = vec3(0.2126, 0.7152, 0.0722);                // BT.709
vec3 px(ivec2 p){ return texelFetch(s, clamp(p, ivec2(0), ivec2(${W-1},${H-1})), 0).rgb; }
float lim(float y){ return (16.0 + 219.0*y) / 255.0; }
float limc(float c){ return (128.0 + 224.0*c) / 255.0; }
void main(){
  ivec2 f = ivec2(gl_FragCoord.xy);                         // output row f.y = buffer row f.y (top-first)
  if (f.y < ${H}) { o = vec4(lim(dot(KY, px(f))), 0,0,1); return; }
  int cx = (f.x / 2) * 2, cy = (f.y - ${H}) * 2; bool isV = (f.x & 1) == 1;
  vec3 a = vec3(0);                                          // left-sited: [1/4,1/2,1/4] across x, 2 rows down
  for (int dy = 0; dy < 2; dy++) a += 0.25*px(ivec2(cx-1,cy+dy)) + 0.5*px(ivec2(cx,cy+dy)) + 0.25*px(ivec2(cx+1,cy+dy));
  a *= 0.5; float y = dot(KY, a);
  float c = isV ? (a.r - y) / 1.5748 : (a.b - y) / 1.8556;   // Cr or Cb
  o = vec4(limc(c), 0,0,1);
}`;
// ...compile FS with a fullscreen-triangle VS; target = R8 texture W x OUT_H on an FBO...
const pbo = [g.createBuffer(), g.createBuffer()]; let fences = [null, null], k = 0;
pbo.forEach(b => { g.bindBuffer(g.PIXEL_PACK_BUFFER, b); g.bufferData(g.PIXEL_PACK_BUFFER, W*OUT_H, g.STREAM_READ); });
hook.onFrame = () => {
  g.bindTexture(g.TEXTURE_2D, src); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, hook.canvas);
  g.bindFramebuffer(g.FRAMEBUFFER, fbo); g.viewport(0, 0, W, OUT_H); g.drawArrays(g.TRIANGLES, 0, 3);
  g.bindBuffer(g.PIXEL_PACK_BUFFER, pbo[k]); g.readPixels(0, 0, W, OUT_H, g.RED, g.UNSIGNED_BYTE, 0);
  fences[k] = g.fenceSync(g.SYNC_GPU_COMMANDS_COMPLETE, 0); g.flush();
  const j = k ^ 1; k = j;                                     // collect the previous frame (one frame behind)
  if (fences[j] && g.clientWaitSync(fences[j], 0, 0) !== g.TIMEOUT_EXPIRED) {
    const out = new Uint8Array(W * OUT_H); g.bindBuffer(g.PIXEL_PACK_BUFFER, pbo[j]);
    g.getBufferSubData(g.PIXEL_PACK_BUFFER, 0, out); g.deleteSync(fences[j]); fences[j] = null;
    window.phosphorStream.frame(gen, out.buffer);
  }
};
```
Notes: readPixels with `g.RED` on an R8 FBO is allowed in WebGL2 only when the implementation reports it (`IMPLEMENTATION_COLOR_READ_FORMAT`). The safe alternative is to pack 4 output bytes per RGBA8 texel: draw a W/4×OUT_H RGBA8 target where each fragment computes 4 adjacent outputs, then `readPixels(..., RGBA, UNSIGNED_BYTE)`. This is also 4× fewer fragments. Orientation: no UNPACK_FLIP_Y, so texel row 0 is the top of the picture and readPixels row 0 is fragment row 0. The buffer comes out top-first, which is what FFmpeg rawvideo expects. Check this with the colour-bar test.

**preload-site.js:** `frame: (gen, buf) => ipcRenderer.send('frame', gen, buf)`.

**main/stream.js (frame pump and FFmpeg input):**
```js
// stream.js startEncoder(): replace '-i pipe:0' input and the color tag flags
const args = ['-hide_banner', '-loglevel', 'warning', '-stats_period', '5', '-progress', 'pipe:2',
  '-f', 'rawvideo', '-pix_fmt', 'nv12', '-s', `${q.width}x${q.height}`, '-framerate', String(q.fps),
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-thread_queue_size', '64', '-i', 'pipe:0',
  '-f', 'f32le', '-ar', '48000', '-ac', '2', '-thread_queue_size', '1024', '-i', 'pipe:3',
  '-map', '0:v', '-map', '1:a', '-pix_fmt', 'nv12', ...encoderArgs(id, q, tier),
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-c:a', 'aac', '-b:a', '160k', '-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', 'pipe:1'];
const p = spawn(this.ffmpeg, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });

// Frame pump: FFmpeg gets exactly fps frames a second whatever the page does, so A/V stays locked to the clock
let last = null, sent = 0, t0 = 0;
ipcMain.on('frame', (_e, gen, buf) => { if (gen === streamer.gen) last = Buffer.from(buf); });
function pump() {
  if (!t0) t0 = performance.now();
  const due = Math.floor((performance.now() - t0) * fps / 1000);
  while (last && sent < due) {                         // repeats the last frame if the page is late
    if (enc.stdin.writableLength > 4 * last.length) { sent = due; break; }   // never queue up: skip ahead
    enc.stdin.write(last); sent++;
  }
  setTimeout(pump, 4);
}
```
Audio: an `AudioWorkletNode` on `S.dest`'s graph posts 128-frame Float32 blocks (interleave L/R). Batch them to about 20 ms and send over IPC to `p.stdio[3]`. If pipe:3 gives trouble on the Windows FFmpeg build, use `-i tcp://127.0.0.1:PORT?listen=1` for the audio.

**Tests (frame-based, workspace, software GL, 640×360):** (1) send a known colour-bar frame through the NV12 shader and FFmpeg to PNG, and check BT.709 values within ±2. (2) After N=300 drawn frames, check FFmpeg's `frame=` ≈ elapsed×fps and that `dup` stays small. (3) Run `tests/check.py`.
