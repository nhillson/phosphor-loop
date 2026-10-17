# Resume: system-audio capture and FFmpeg output

User is restarting macOS so the BlackHole driver becomes available.

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
