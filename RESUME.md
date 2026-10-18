# Resume: system-audio capture and FFmpeg output

See the latest streaming status below before older notes.

## Latest: live streaming and Apple GPU fix completed

### Follow-up: missing playback audio fixed

- User reported Chromium /watch volume control disabled. ffprobe of current
  rolling stream showed an AAC declaration but sample_rate=0/channels=0: no
  usable audio packets. Hardware loopback tone test still passed.
- Recorder was sharing the exact audio track owned by the workstation analyzer;
  Off/reconnect stopped that recording track without firing track.onended.
  Recorder now holds an independent clone, and status checks its readyState.
- Capture hook now correctly selects/displays Loopback adapter and the actual
  BlackHole device rather than marking it as Microphone.
- Added npm run capture:audio-test: actual encoded AAC retains nonzero BlackHole
  samples after analyzer Off/reconnect (RMS 0.0932 in latest run). PASS.
- stream:test now also asserts Chromium's playing video has an audio track via
  video.captureStream(), catching the disabled-volume issue. PASS, 59.8 fps.
- Restart stream after code updates and reload /watch to rebuild its media buffers.

### Follow-up: 1080p60 defaults

- User requested 1080p60 at about 7 Mbps. Runner defaults now 1920x1080, 60 fps,
  7,000,000 bps video, with stereo AAC 192 kbps. HLS/RTMP use CBR filler and
  min/max 7 Mbps, 14 Mb VBV buffer, and 2-second GOP; recordings use capped rate.
- Actual recording check: 600 captured frames in 10 seconds (60.0 fps), ffprobe
  confirmed 1920x1080 H.264 at 60/1 and AAC. Updated live HLS test PASS: real GPU,
  browser playback, **309 frames at 59.9 fps**, stereo AAC, clean stop. Pipeline
  unit checks PASS. RTMP receiver test at 1080p also PASS (>=120 frames received).
- YouTube official guidance checked: H.264 1080p60 minimum 6 Mbps, recommended
  17 Mbps; requested 7 Mbps is above minimum. User was told recommendation is
  higher; do not increase bitrate beyond requested 7ish without reason.

- User confirmed loopback + SMSL working and requested a commit, then streaming
  video. Committed baseline as **6335e53** (loopback UI, mirrored SMSL routing,
  tests, and the then-WIP capture scaffold). Nothing pushed.
- User clarified headless is optional; streaming output is the priority. No RTMP
  destination supplied. Implemented local HTTP HLS plus RTMP support.
- Fixed the zero-chunk capture by copying the WebGL canvas into a 2D capture
  canvas inside the render callback, then explicitly requesting a video frame.
  WebGL's discarded drawing buffer cannot be captured asynchronously reliably.
- Isolated Metal failure: small WebGL draws work on M3 Max, but main feedback
  shader caused Metal internal pipeline compiler error and lost context. Replacing
  seedInk's two continue branches with one equivalent guarded block FIXED it.
  No OS/driver installation or changes. GPU is the runner default again.
- `npm run stream` opens a separate GPU Chrome workstation and serves:
  preview http://127.0.0.1:8787/watch
  OBS/VLC http://127.0.0.1:8787/live/stream.m3u8
  Picture only + exact BlackHole stereo sound, H.264/AAC, target 720p30.
  HLS has a few seconds latency. Localhost only. Preview muted to avoid feedback.
  Rolling segments are bounded and removed on stop. Workstation controls change
  this stream; other independent browser windows are not attached.
- `npm run capture -- --rtmp --headed` uses PHOSPHOR_RTMP_URL (not logged).
  `npm run capture -- --output captures/show.mp4` records without a window.
  --renderer software is fallback; --autopilot optional. README documents commands.
- Verified: 6 capture pipeline tests (including actual backpressure, HLS serving,
  encoded traversal rejection); normal file:// + capture smoke; local HLS browser
  playback with real M3 Max Metal, H.264 1280x720 and stereo AAC; local RTMP receiver
  received >=120 video frames. SIGINT now finalizes cleanly (disabled Playwright's
  competing browser signal handlers). Last streaming test: **148 frames, 30.3 fps**.
- Tests: npm run capture:test; npm run capture:smoke; npm run stream:test;
  npm run stream:rtmp-test. Stream tests use frame/media conditions, not sleep.
- Added hls.js dependency served locally for Chrome's browser player. Prefer
  Hls.js when supported; Chrome's native HLS capability detection was unreliable.
- User saw slow software-rendering window earlier; GPU stream is now working.
  Fresh recording captures/gpu-check.mp4 was visually verified nonblack.
- Broader session filesystem and network permissions are enabled.

## Latest status — October 17, resumed session

### Follow-up: webpage loopback option completed

- Subsequent routing bug FIXED: `stacked=0` created a 4-output aggregate, sending
  ordinary stereo only to SMSL. Despite the misleading installed SDK comment,
  this Mac requires `stacked=1` for a true mirrored 2-output Multi-Output Device.
  Repaired existing route in place, preserving device identity. System profiler
  now shows 2 output channels, no input channels, and route remains default.
  Setup helper now creates correct stacked=1 routes. Added describe/repair/activate
  commands and npm audio:repair/audio:activate scripts; fixed CFString pointer warning.
- `npm run audio:test` PASS: quiet 440Hz tone played through default combined output
  was captured through actual Chrome BlackHole input (RMS ~0.01675). This verifies
  real signal flow, not just device availability. Routing test lives in
  tests/audio-route.mjs; it briefly plays an audible test tone.

- Session now has full filesystem/network permissions.
- User asked to add loopback selection to the webpage before returning to headless work.
- Added **Loopback adapter** to React to sound and Spectrograph controls, with a
  filtered adapter picker; BlackHole 2ch preferred, exact input ID, stereo requested,
  speech processing disabled. Supports BlackHole/Soundflower and existing loopback names.
- Missing adapter reports an error without using a room mic as the listening source.
  Initial browser audio permission may briefly open the default input solely to reveal
  device labels; that track is immediately stopped. Off cancels pending opens.
- Show mode saves/restores chosen loopback source; existing recording Computer sound
  reuses the loopback track. Android keeps its existing Phone sound controls.
- Updated Guide/README. Added `npm run loopback:test` (mocked permission, missing
  device, switching, cancellation, exact constraints). `-- --real` also verifies the
  actual installed BlackHole through the webpage. Both PASS. Screenshot visually
  inspected: /tmp/phosphor-loopback.png.
- `npm run capture:smoke` with SwiftShader now PASSES both normal file:// startup
  and fixed capture dimensions, including nonblack frames and control workout.
  The previous black smoke result is resolved by software rendering in that test;
  actual capture zero-chunk problem remains unresolved. No recording success claimed.
- Changes remain local/uncommitted; no push or publish.

### Earlier capture work

- BlackHole 2ch is installed and visible to CoreAudio and Chrome.
- Ran `swift -module-cache-path /tmp/phosphor-swift-cache tools/audio-route.swift setup`
  outside sandbox successfully. Default output before setup was **SMSL USB AUDIO**,
  not the MacBook speakers. The multi-output route is now ACTIVE; it mirrors SMSL
  and BlackHole. Restore point is ignored `.capture-state/audio-route.json`.
- `npm install` succeeded; package-lock.json exists, playwright-core available.
- User asked for broader permissions to avoid repeated prompts. Explained that
  agent cannot change session-wide permissions. Requested reusable prefix approvals.
  Runtime explicitly confirmed saved prefixes `npm run capture` and
  `npm run capture:test`. Requested `npm run capture:smoke` approval too, but it
  was NOT saved (later un-escalated run hit EPERM). Swift helper prefix was requested,
  but no saved-prefix confirmation was received. Use escalation when needed.
- Implemented WIP files (all uncommitted): tools/capture/{run,browser,pipeline}.mjs,
  tests/capture.test.mjs, tests/capture-smoke.mjs, package-lock.json; modified
  package.json and js/app.js. DO NOT claim recording works yet.
- Pipeline tests PASS outside sandbox: `npm run capture:test` (4 tests: ordered
  authenticated chunks, static asset privacy, oversized chunk rejection, FFmpeg args).
- Browser helper uses exact device ID, no echo/noise/gain processing. Chrome labels
  BlackHole as `BlackHole 2ch (Virtual)`; matching handles a parenthesized suffix.
- Real recording attempt selected correct device and reported 48kHz stereo with
  processing disabled, but **MediaRecorder delivered zero chunks**, so FFmpeg failed
  with invalid input. No successful recording exists. Need debug why canvas/audio
  stream supplies no media. Potential clue: initial smoke test with headless Chrome
  also reported a black picture despite 60 frame callbacks. Could be canvas drawing
  timing/GPU issue, actual rendering, audio route sample flow, or track processing.
- Added normal-file:// and fixed-resolution smoke checks using Node Playwright
  because Python Playwright/Pillow are absent. Initial smoke failed black picture.
  Changed smoke launch to existing tests' SwiftShader flags, but retry was blocked by
  sandbox (localhost EPERM), so that version has NOT run. Next run needs escalation.
  Production capture keeps real GPU ON; flags disable occlusion/background throttling.
- Existing Python safety/startup tests have not run this session. No pushes.
- No capture/test process should be active: last capture finalized unsuccessfully,
  Chrome/FFmpeg cleanup completed. Audio routing remains active intentionally.
- Next steps: debug zero media/black picture, verify actual audible loopback using a
  short known test signal if necessary, improve failure/backpressure coverage,
  inspect audio-route Swift CFString pointer warning, document commands, run real
  recording + ffprobe audio/video validation, update this handoff.
- Code review concerns: ensure early FFmpeg failure and closed-page paths return
  errors; bounded delivery/clean stop must be verified. Current runner logs audio
  settings and delivered chunk count to help debugging. Capture server binds only
  localhost, token-authenticates POSTs, and hides private files and captures.

## Older handoff (superseded by latest status above where different)

## Goal and authorization

Set up a local loopback device to capture whatever is playing on this Mac, feed
that audio into Phosphor Loop's existing analyzer, and send canvas video plus
that same audio to FFmpeg for continuous file recording or RTMP output.
User explicitly excludes music/broadcast permission discussions from scope.
No RTMP endpoint has been supplied; first verify a local recording.

## Completed previously

Commit f6960ee extracted the workstation's styles, shaders, helpers, fractal
math, recording utilities, and projector template. Optional 3D shaders compile
on demand. Existing browser safety and startup tests passed. Nothing pushed.
Normal opening still works by double-clicking index.html with js/ and styles/.

## This session's machine setup

- Homebrew FFmpeg 8.1 installed successfully: /opt/homebrew/bin/ffmpeg.
- Homebrew downloaded BlackHole 2ch 0.6.1, but the automated install stopped at
  sudo because it needed the user's administrator password.
- Asked user to run `brew install --cask blackhole-2ch` in Terminal themselves.
  They are now restarting for that driver. Verify driver availability afterward.
- Before setup, default output and system output were MacBook Pro Speakers;
  default input was MacBook Pro Microphone. Also saw twg Microphone.
- No audio routing changes have been made by the agent.

## Work in progress on disk (NOT tested or ready)

- package.json: planned Node capture runner using playwright-core; npm scripts
  refer to tools/capture/run.mjs and tests/capture.test.mjs, which DO NOT EXIST YET.
- .gitignore: ignores node_modules/, captures/, .capture-state/, __pycache__/.
- tools/audio-route.swift: draft CoreAudio CLI: list/setup/restore. It creates a
  persistent Multi-Output Device named "Phosphor Loop + Speakers", mirrors the
  previous default output and BlackHole 2ch, uses the speaker as clock with drift
  compensation on BlackHole, and saves previous output UIDs to
  .capture-state/audio-route.json for restoration. Restore retains the route.
  This code has NOT compiled or been run successfully yet.
- npm install was attempted inside sandbox and had not produced a lockfile or
  node_modules when interrupted. Finish dependency installation.
- tools/capture/ exists as an empty directory.

## Next steps

1. Inspect git status and machine devices. `system_profiler SPAudioDataType`
   needs escalated execution; sandbox returns an empty device list.
2. Verify/compile helper:
   `swift -module-cache-path /tmp/phosphor-swift-cache tools/audio-route.swift list`
   (the previous invocation with SWIFT_MODULECACHE_PATH alone still attempted a
   forbidden ~/.cache/clang write). The escalated retry was interrupted by user.
3. When BlackHole is available, run helper setup and verify system output is the
   multi-output route. Keep ordinary listening through speakers/headphones.
   Do not restart the machine automatically.
4. Implement Node local server + dedicated Chrome session + browser capture
   module. Capture only canvas video, plus exact BlackHole audio input with all
   speech processing disabled. Attach same stream to app analyzer via listen().
5. Stream MediaRecorder chunks promptly to Node/FFmpeg with ordered delivery and
   bounded queues/backpressure. Do not accumulate full recordings in memory.
6. Provide clean stop/finalization, process failure handling, and file/RTMP options.
7. Verify a short real recording (audio + video via ffprobe), with meaningful
   regression tests and commands documented for starting/stopping/restoring audio.

## Implementation notes

- js/app.js: listen(stream) connects input to existing analyzer; setSound('mic')
  uses micDeviceId and disables echo cancellation/noise suppression/auto gain.
- Existing recorder starts at around line 5530: canvas.captureStream(30), combines
  audio, MediaRecorder.start(250), but recChunks buffers entire recording.
- fit() around line 5690 controls canvas output size. Add optional fixed capture
  dimensions for automated capture without changing normal workstation behavior.
- Keep the normal site usable without Node or a server. Runner can inject config
  through Playwright addInitScript, expose a small capture hook from app closure.
- Use an isolated Chrome profile/context; do not touch user's existing Chrome
  session. GPU acceleration should remain ON, no --disable-gpu flags.
- A proposed pipeline is browser VP8/Opus MediaRecorder -> localhost chunk POSTs ->
  FFmpeg stdin -> H.264/AAC MP4/MKV or RTMP/FLV. Evaluate latency/CPU in practice.
- RTMP destination/stream key should be supplied by environment, not committed.
- Local recording defaults can live in ignored captures/.
- Repo tests/check.py uses Python Playwright/Pillow. Previous temporary env was
  /tmp/phosphor-check-env and browsers in /tmp/phosphor-browsers, possibly gone
  after restart. Tests wait by frames rather than arbitrary sleeps.

## Skills / tools

Read computer-use skill earlier; prefer CLI/CoreAudio for audio routing. If UI
is needed, use @oai/sky through node_repl and follow that skill. No UI changes
were performed. External system installs and audio access require escalation.
