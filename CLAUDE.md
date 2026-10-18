# Phosphor Loop: notes for Claude

The site is `index.html` (plus `phone.html`, `qrcode.js`, `sw.js`, icons, `nature/`, `presets.json`), served by
GitHub Pages from `main` at https://nhillson.github.io/phosphor-loop/. Pushing to `main` puts it live for everyone in
about a minute and rebuilds the Android app (see `.github/workflows/android.yml`). Changes to `tests/` or this
file don't rebuild the app.

## Testing: Nick's standing rules

1. **Wait by frames, never by seconds.** Every wait in a test (scripts, browser checks, pictures) is "until
   the app has drawn N frames". A time limit is only a ceiling for when the page has stopped drawing, never
   a pause. No `sleep 14` to let a picture build.
2. **Safety check before every push:** `python3 tests/check.py` (about 35 s). It loads the page at low
   resolution, waits by frames, fails on any page error, an on-screen error message or a black picture, and
   presses Surprise, Autopilot, Neutral, the loop tabs and Clear. Never push when it fails. A broken shader
   fails it in about 20 s and names the line.
3. **New or changed effects:** add `--shot "Recipe name"` (optionally `"Recipe|slider=value|..."`) for each
   one, at the default 120 frames. One picture each is enough; Nick judges the look himself.
4. **Use Nick's computer for visual checks whenever it's linked** (the `mcp__remote-devices__Claude_Browser__*`
   tools, the Claude app's built-in browser, nhillson.github.io is allowed). It has real graphics
   (Intel Iris Xe, 24–30 frames a second in that panel) so it shows the true look. Run the text of
   `tests/laptop-check.js` with the javascript tool after setting `FRAMES` and `RECIPE`, then take a screenshot
   if the look matters. That browser can't open Claude's own local server, so the laptop check runs on the
   live site, right after a push. If the panel is hidden the page may pause; the script says so, and Nick can
   show it with Ctrl+Shift+B in the Claude app.
5. **Only test what the change touches.** A wording change needs only the safety check.
6. **Don't wait for the site to go live.** Say "live in about a minute". If confirmation is really needed,
   make one check of the deploy run (the workspace can't fetch github.io itself):
   `curl -s "https://api.github.com/repos/nhillson/phosphor-loop/actions/runs?per_page=1"`.
7. **Fail fast:** single clicks and lookups give up after 5 s, not 30.
8. **Thorough routine only before a show or when Nick asks:** a longer Autopilot run, saving and loading a
   preset, the Output window, and longer picture checks on his computer.

The workspace browser has no graphics chip (software drawing, about 5–9 frames a second at the test size), so
its pictures show fewer, more separate echoes than Nick sees at 60 frames a second.

## Twitch: headless streaming

Nick wants it truly headless: nothing on screen, no OBS. `headless/Phosphor Loop on Twitch.cmd` is one file that is
both the installer (as a .cmd it reruns itself in PowerShell with `-Install`: copies itself to
`%LOCALAPPDATA%\PhosphorLoopStream\PhosphorLoopStream.ps1` and makes a desktop icon that runs it through
`conhost --headless`) and the runner (tray icon; double-click again = stop). It downloads the branch's files and
ffmpeg, serves the files from `http://localhost:47810`, opens Chrome/Edge `--headless=new --enable-gpu
--use-angle=d3d11`, sizes and "clicks" the page over the debugging port (CDP) so it may capture system audio, and
relays the page's MediaRecorder pieces into ffmpeg (QuickSync or x264, keyframe every 2 s) to
`rtmp://ingest.global-contribute.live-video.net/app/<key>`. Keep the .cmd plain ASCII with CRLF (`.gitattributes`
stores it as-is): Windows PowerShell 5.1 reads files without a BOM as ANSI.

The page side is runner mode, `index.html?stream=1&runner=1` (section "the hidden runner" in stream mode). The
stream page reads Twitch chat (!like / !skip, vote counter) and links to `stream.html?link=…` (the live view the tray
icon opens) over the phone link's PeerJS service.

Checks: `python3 tests/stream_check.py` (about 35 s; stands in for Twitch chat and PeerJS, and checks runner mode
and the installer download). The runner itself: run the .cmd copied to `runner.ps1` under PowerShell 7 for Linux
(download the tarball from GitHub releases into the scratchpad) with `-Console -Out test.flv -StopAfterPieces 24
-Browser /opt/pw-browsers/chromium-*/chrome-linux/chrome -BrowserArgs '--no-sandbox --use-angle=swiftshader
--enable-unsafe-swiftshader --use-fake-device-for-media-stream' -Ffmpeg /usr/bin/ffmpeg -Site <repo> -Sound mic
-Channel test -HomeDir <scratch>`, then ffprobe the file. While on a branch, the web pages are reachable at
`https://raw.githack.com/nhillson/phosphor-loop/<branch>/stream.html` (one "One more step" notice per browser).

## Working with Nick

- Before starting a task, give a rough ETA. Send short progress updates with a fresh ETA at milestones, as
  long as they cost next to nothing. Progress updates don't wait for an answer.
- He isn't technical: explain things plainly, step by step, with pictures where they help.
