# Phosphor Stream — handoff

Written 2026-10-20 at version **1.2.0**, for the next agent picking this up cold. Read this file, then
`/CLAUDE.md` at the repo root (Nick's standing testing rules), then the code (about 900 lines in `src/`).

## 1. What this is, and for whom

**Nick** (GitHub `nhillson`, Minnesota, US Central time) built **Phosphor Loop**, a WebGL video-feedback
synthesizer at https://nhillson.github.io/phosphor-loop/ (repo root: `index.html`, `js/app.js`, `js/shaders.js`).
He wants to stream it 24/7 from a dedicated Windows PC ("stream-pc", NVIDIA GPU, model unknown) to **Kick**
(his main platform) and **Twitch**, **without OBS**.

**Phosphor Stream** is that app: a Windows Electron program showing Phosphor Loop on the left and a control panel
on the right (connect Twitch/Kick by pasting stream keys, Go live, status lights, quality Good/Better/Best,
start-with-Windows, go-live-on-open, Autopilot-on-live). It is built **only for Phosphor Loop** (Nick chose this
over a general screen/window streamer) and loads **his own live site**, not a friend's fork.

### Working with Nick (important)
- He is **not technical**. Explain plainly, step by step, with pictures (he's a visual learner). No jargon
  without a one-line plain explanation.
- Give a **rough ETA before starting**, and short progress updates with fresh ETAs at milestones.
- **Every wait in a test is a number of drawn frames, never a fixed time.** Time limits are only ceilings for
  a stalled page. This applies to the app's self-test too (`waitFrames`).
- Test on **his computer** when it's linked (the device bridge reaches "stream-pc"; see §6).
- He reports problems tersely ("Kick quality on best is still crap", "keeps losing connection"). Go to the
  app's log on his PC first (§6); it has answered every question so far.
- He says "please don't reset" things: keep his on-screen look and settings across any change.

## 2. Where everything lives

| What | Where |
|---|---|
| App source | `stream-app/` on branch **`stream-app`** of `nhillson/phosphor-loop` (never merged to `main`) |
| Build + test + release | `.github/workflows/stream-app.yml` (Windows runner; runs on every push to `stream-app` touching `stream-app/**`) |
| Installer for Nick | Release **`stream-app-latest`** → `Phosphor-Stream-Setup.exe` (prerelease; replaced each build) |
| CI test logs/pictures | Release **`ci-logs`** (engine-log.txt, result.json, panel/site/received-frame PNGs) — see §5 for why |
| App data on Nick's PC | `C:\Users\nicho\AppData\Roaming\Phosphor Stream\` → `log.txt`, `settings.json` (keys encrypted with Windows DPAPI via `safeStorage`) |
| Installed app | `C:\Users\nicho\AppData\Local\Programs\phosphor-stream\` (FFmpeg at `resources\ffmpeg.exe`) |
| Research reports | `stream-app/docs/research/` (platforms, NVENC tuning, capture-pipeline audit, lab results + crop pictures, lab scripts) |
| Older headless-streaming attempt | `tools/capture/` on `main` and branch `twitch-stream` (Nick dropped headless; he wants to see and control it) |

The site's `main` branch is live for everyone and rebuilds Nick's Android app on push. **Don't touch `main` for
app work.** If a change to the site itself is needed (§8), follow `/CLAUDE.md`: run `python3 tests/check.py`
before every push.

## 3. How it works

```
 Phosphor Loop page (WebContentsView, capture mode 1920x1080 or 1280x720, 30/60 fps)
   │  canvas.captureStream(fps) + computer sound (WASAPI loopback, no picker)
   │  MediaRecorder  video/x-matroska;codecs=avc1,opus  @ 60 Mbps (90 at 60 fps), 200 ms chunks
   ▼  IPC 'chunk' (src/capture-page.js → src/preload-site.js → src/main.js)
 FFmpeg #1 "squeezer" (src/stream.js startEncoder)
   decode → -r fps cfr → BT.601→BT.709 colour convert → NVENC/AMF/QSV/x264 CBR → MPEG-TS on stdout
   ▼  fan-out in Node (per-destination backpressure guard: 32 MB → restart that sender)
 FFmpeg #2..n "senders" (src/stream.js startSender), one per platform
   -readrate 1 (steady pace) -c copy → FLV → rtmp://live.twitch.tv/app/KEY  |  rtmps://<kick ingest>:443/app/KEY
```

- **Capture mode** is a hook already in Phosphor Loop: if `window.__phosphorCaptureConfig = {width,height,fps,renderHeight}`
  exists before `app.js` runs, the site draws at exactly that size and rate and exposes `window.__phosphorCapture`
  (`canvas`, `listen(stream)` to feed sound to React-to-sound, `autopilot()`). See `js/app.js` lines ~13, 5997–6011,
  6108, 7497, 7643 on `main`.
- `preload-site.js` puts that config in the page with `contextBridge.executeInMainWorld` (Electron 35+) as a
  **mutable** object, so changing quality **resizes in place** (`resizeSite()` in main.js: mutate + dispatch
  `resize`; Phosphor Loop's `fit()`/`resim()` carry the picture across). It only reloads if that fails. CI verifies this.
- **Sound:** `setDisplayMediaRequestHandler` returns `audio: 'loopback'` (Windows), so `getDisplayMedia` gets
  system sound with no dialog. It is mixed into the recording and also given to Phosphor Loop's React-to-sound.
- **Encoder choice:** `Streamer.probe()` tries NVENC → AMF → QSV, each in settings tiers (`TIERS`, best first),
  with a 720p test clip, then falls back to libx264. The log line `Encoder: h264_nvenc, best settings` says
  which one won.
- **Reconnects:** each sender restarts on its own (backoff 2/5/10/20/30 s) without touching the other. If no
  chunks arrive for 6 s, or the squeezer dies, the capture restarts (`gen` counter drops stale chunks). Page
  crash → reload; page reload while live → capture re-attached.
- **Stream keys** are never shown or logged (`redactor`), and are stored encrypted.
- **Quality table** (`QUALITY` in main.js): Good 720p30 4.5 Mbps; Better 1080p30 and Best 1080p60 at
  Kick 7.5 / Twitch 6 Mbps. When both platforms are on, one encode at the lower rate goes to both. Default is
  **Better**.

## 4. History: what went wrong and what we learned

| Ver | Change | Why |
|---|---|---|
| 1.0 | First release: paste keys, Go live, status lights, auto-reconnect | — |
| 1.1 | Nearly lossless first recording; NVENC "quality" tiers; Kick 8 Mbps; frames-per-second readout | Nick: Kick picture "crap". Log showed NVENC p4 `-tune ll` at 6 Mbps, two lossy encodes, dropped frames at 60 fps |
| 1.1.1 | Sender paced with `-readrate 1`; Kick 7.5 Mbps; bufsize = bitrate; probe 3 s; quality change resizes in place | Nick: "keeps losing connection to Kick". Log: Kick (Amazon IVS) hung up at ~10 s every time, because FFmpeg sent its start-up buffer in a burst (≈1.5× rate) over IVS's 8.5 Mbps cap. The 3 s probe fixes a mid-stream rejoin bug (GOP is 2 s, 1 s probe missed the SPS → "Invalid argument") |
| 1.2 | AQ off, p7 + multipass fullres, B-frames, no scene-cut; x264 `aq-mode=0:psy-rd=0`; BT.601→709 colour fix; default Better | Nick: "all of the fine detail is being lost". Four parallel investigations (§7) |

Lessons:
- **Kick = Amazon IVS standard channel**: H.264 + AAC only, CBR, ≤ 8.5 Mbps at 1080p, 2 s keyframes, buffer ≤ bitrate,
  and it **disconnects on bursts**. Kick's top player quality passes our stream through untouched; "Auto" may
  show a 720p transcode. Tell Nick to pick 1080p in the gear menu when judging quality.
- **Adaptive quantisation (AQ) is wrong for this content.** It takes bits from busy, detailed areas, which is
  exactly where Phosphor Loop's detail lives. OBS's "psycho-visual tuning" turns it on, so OBS has the same problem.
- **30 fps beats 60 fps** for detail at a fixed bitrate (each frame gets twice the bits).
- **Chromium's canvas capture uses BT.601 limited range** (libyuv). We used to only *tag* it as 709, which shifted
  colours (Phosphor purple #8b1ab8 showed as (146,47,188)). We now convert, with accurate chroma flags; FFmpeg's
  default flags blur colour badly.
- The first 60 Mbps recording costs almost nothing (< 0.1 dB). **Nearly all detail loss is the final 6–7.5 Mbps
  encode.** At 7.5 Mbps the densest looks are bit-starved (≈ CRF 27–28 equivalent; they'd need ~13 Mbps).
- Phosphor Loop's 4:2:0 chroma loss is large on saturated fine colour detail, and the platforms require 4:2:0.

## 5. Build, test, ship (the workspace has limits)

- **npm is blocked in the Claude workspace**, so Electron can't be installed or run there. Everything that needs
  Electron runs on the **GitHub Windows runner**. Locally you *can* run `node stream-app/test/engine-test.js`
  (pure Node + FFmpeg 6.1) and Playwright/Chromium for page work.
- **CI logs**: `gh run view --log` and artifact downloads are **blocked** from the workspace (blob storage 403).
  That's why the workflow uploads `stream-app/test-output/*` to the **`ci-logs` release**, and failures also emit
  `::error`/`::notice` annotations (read with `gh api repos/nhillson/phosphor-loop/check-runs/<job id>/annotations`).
  Download release assets with `gh api -H "Accept: application/octet-stream" repos/.../releases/assets/<id>`.
- Workflow steps: get the BtbN FFmpeg win64 GPL build → `npm install` → **engine test** (fake recording through
  the real engine into two local RTMP servers; the second opens late to test reconnects; a byte-meter proxy fails
  the test if any 5 s window exceeds 1.3× the stream rate) → **app test** (launches the real app on the live site
  with `PHOSPHOR_TEST=1`, switches quality to check nothing resets, goes live to a local server, checks frames,
  sound and 1280x720) → electron-builder NSIS → release.
- The runner has **no GPU**, so NVENC/AMF/QSV probes fail there and x264 is what gets tested. **NVENC settings are
  only verified on Nick's PC via its log.**
- Bump `version` in `stream-app/package.json` for each release. Commit messages end with the Co-Authored-By line.
- Nick installs by running the new `Phosphor-Stream-Setup.exe` over the old one (settings and keys are kept).
  Windows SmartScreen warns ("More info → Run anyway") because the app isn't code-signed.

## 6. Diagnosing on Nick's PC

The session can be linked to his computer ("stream-pc"). Use `mcp__remote-devices__get_device_info`; if needed
`device_request_folder_access` for `~/AppData/Roaming/Phosphor Stream` (already granted once), then
`device_stage_files` on `log.txt` and read it. There was **no remote shell** (`device_bash`) in this session.
Key log lines:
- `Encoder: h264_nvenc, best settings` (which encoder and tier), and `Encoder … not usable: …` for tiers that failed
- `Going live to Kick at better (1080p30, 7.5 Mbps)`
- `Picture: N new frames a second (asked for M); X Mbps out; repeated R, dropped D`, logged every 60 s while live
- `Kick: …` / `Kick stopped (code …): …` (sender errors; a clean ~10 s cut means a rate burst)
- `Capture N: <mime>, sound on|off`

## 7. Research done (read the reports in `docs/research/`)

1. `platforms.md`: Kick is H.264-only on IVS (no HEVC/AV1). Twitch takes HEVC 1440p at 9 Mbps only through
   **Enhanced Broadcasting** (multitrack, `GetClientConfiguration` handshake, Affiliates/Partners, RTX 20+);
   FFmpeg can't do that handshake. Twitch's blog says "7.5 Mbps for 1080p" but it's **unclear** whether that applies
   to normal single-track RTMP, so we stayed at 6.
2. `nvenc.md`: settings ranked by effect on fine detail; AQ off; p7 + multipass fullres; no scene-cut; B-frames; avoid
   uhq/temporal filter. Also has older-GPU fallbacks.
3. `pipeline.md`: the colour mislabel; MediaRecorder details; timing gate in `app.js` (~7498) uses `performance.now()`
   with 1 ms slack, so it drops whole frames at 60 fps; a design for a **raw-frame, single-encode pipeline**
   (WebGL2 NV12 conversion + async readPixels → IPC → FFmpeg rawvideo), with the shader prototyped and verified
   (`nv12-shader-prototype.html`).
4. `lab-results.md` + `crop_*.jpg`: measurements on real Phosphor Loop footage (x264 as an NVENC stand-in). AQ
   off ≈ +2.8 dB detail SNR on the densest look; tune grain worse; no pre-filter helps; keep 1080p; 30 > 60 fps;
   HEVC +3.1 dB and AV1 +4.1 dB (not allowed on Kick); per-frame random noise in some shaders wastes bits.
   The scripts are in `lab-scripts/`; their paths point at `/tmp/claude-0/...` and need adjusting.

## 8. Open items, in suggested order

1. **Verify 1.2 on Nick's PC.** Read the log after he streams: which NVENC tier won (p7 fullres might be too slow
   on an older card, so check "Picture: … new frames a second" against the target and FFmpeg `speed=`), and look
   at the Kick stream at 1080p with him. If p7 fullres can't keep up, drop to p6/qres (the `good` tier). Consider an
   A/B (AQ on vs off) on his actual GPU, since the lab used x264.
2. **Kick at 8.0 Mbps.** Now that sending is paced, 8.0 video + 0.16 audio should be within IVS's 8.5. That's a
   small gain; test carefully because Kick hangs up when a stream goes over.
3. **Twitch 7.5 Mbps.** Confirm on Twitch's help center whether single-track RTMP allows 7.5 at 1080p; if yes,
   raise it (lab: 6.0 → 7.5 is +1.2 dB).
4. **Stream-friendly rendering mode in Phosphor Loop** (site change, capture mode only). Seed Grow noise per 8 frames
   with a golden-angle ring step instead of `uGrowTurn = Math.random()` every frame (app.js ~7340, shaders.js ~257);
   fixed screen-space dither for Aurora (shaders.js ~1195); 15 Hz, 2 px VCR/Chewed noise (~378–386); shorter post-Clear
   static (~590/599). About 5–10% fewer bits on affected looks. Also fix the capture timing gate (use the rAF
   timestamp with half a frame of slack). These touch the **live site** and the Android app build: follow
   `/CLAUDE.md` (safety check before push; picture checks on Nick's computer).
5. **Raw-frame single-encode pipeline** (`pipeline.md` §"Recommended"): removes the MediaRecorder stage, fixes
   colour siting and frame timing for good, and frees a hardware encoder session. Needs IPC throughput measured on
   the stream PC (~93 MB/s at 1080p30). Key gotcha: copy the canvas inside Phosphor's frame callback, because
   `preserveDrawingBuffer` is false.
6. **Logins instead of pasted keys** (originally promised): Twitch OAuth (`channel:read:stream_key`, Get Stream Key
   API), Kick OAuth 2.1 + PKCE (`streamkey:read`; the key is a field on the channel resource; Kick's developer
   settings need 2FA). Nick must register an app on each (≈5 min each, with a walkthrough). Then: title/category
   editing and viewer counts.
7. **Twitch 1440p HEVC via Enhanced Broadcasting**: the biggest available quality jump for Twitch, but it needs
   the multitrack handshake implemented by hand (risky; Twitch may reject or drop it). The fallback is OBS for Twitch only.
8. Code signing (removes the SmartScreen warning) needs a certificate, which costs money; ask Nick.
9. Small: the CI app test's sound sometimes reports "Timeout starting video source" (runner has no display);
   harmless there.

## 9. Things not to break

- Waits by frames in every test. Engine test's burst check (Kick disconnects). The quality-change-keeps-the-look
  check. The key redaction. The 2 s GOP, `bufsize = bitrate`, and CBR (IVS rules). The `-readrate 1` pacing on senders.
- Don't commit `stream-app/vendor/` (FFmpeg) or `node_modules/` (both are in `.gitignore`).
