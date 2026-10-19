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

## Streaming to Twitch or Kick (with OBS)

Nick tried a headless streamer (hidden browser + ffmpeg, no OBS) and dropped it: he wants to see and control
things, so streaming goes through OBS Studio on screen. Don't bring the headless runner back (it's in git history,
commit cf2d781 and later).

`index.html?stream=1&taste=…&every=…&text=…&link=…` is the picture alone for OBS's browser source (section "stream
mode" near the end of index.html). `stream.html` is the Go live page: its Set up tab picks Twitch or Kick, walks
through installing OBS, connecting it (Twitch: Connect Account; Kick: Service Kick or Custom, its Stream URL and
Stream Key), the OBS settings for a sharp 1080p picture on the NVIDIA card (NVENC H.264, CBR, 8000 Kbps Twitch /
7500 Kick since Kick's limit is 8000 with the sound, keyframe 2 s, P7, High Quality, two passes full resolution,
look-ahead, psycho visual tuning, 2 B-frames, 1920x1080 at 30 fps) and makes the OBS scene collection file. Its Go
live tab links to the stream picture over the phone link's PeerJS service to send the computer's sound (screen
sharing with system audio, or a microphone), Next look and settings; OBS itself captures the computer's sound for
the stream. Nick had chat voting (!like / !skip, a vote counter, a "Twitch chat" taste) removed entirely; don't
bring it back.

Check changes to either with `python3 tests/stream_check.py` (about 25 s): it stands in for the connection service
and uses the browser's fake microphone, so it works offline, and it fails on any chat connection. While the work
lives on a branch, its pages are reachable at `https://raw.githack.com/nhillson/phosphor-loop/<branch>/stream.html`
(GitHub Pages only serves `main`; OBS shows the mirror's "One more step" notice once, the Set up tab covers it).

## Working with Nick

- Before starting a task, give a rough ETA. Send short progress updates with a fresh ETA at milestones, as
  long as they cost next to nothing. Progress updates don't wait for an answer.
- He isn't technical: explain things plainly, step by step, with pictures where they help.
