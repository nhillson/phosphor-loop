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
4b. **Clip library** (Video › Clip library…, fed by the Phosphor Clips app on the `clip-app` branch):
   `python3 tests/clips_check.py` uses a stand-in library; `CLIPS_APP=<clip-app folder>` uses the real sharing
   server. Test clips are WebM because the workspace's Chromium can't play H.264. The test reaches into the app
   through `window.__plClips`.
4d. **Loops Autopilot runs** (Autopilot runs some loops, Nick the rest; Take turns / All at once):
   `python3 tests/ap_loops_check.py` (about 3 minutes). It reaches into Autopilot through `window.__plAp`.
4c. **Loops C and D, and Spread out controls' columns:** `python3 tests/loops_check.py` (about 3 minutes). Each
   loop's column is a copy of the hidden sidebar editor; clicks and sliders in a copy are passed to the real one
   (see "a column per loop" in js/app.js), so new editor controls work there without extra code.
4e. **Subject silhouette** (Inputs › Subject silhouette: Shadow / Glow / Cutout on Video, Camera, Screen, Phone; MediaPipe in
   `vendor/mediapipe`, code in `js/subject.js`): `python3 tests/subject_check.py` (about a minute). It feeds
   `tests/media/person.webm` in and reaches into the app through `window.__plSubject`.
5. **Only test what the change touches.** A wording change needs only the safety check.
6. **Don't wait for the site to go live.** Say "live in about a minute". If confirmation is really needed,
   make one check of the deploy run (the workspace can't fetch github.io itself):
   `curl -s "https://api.github.com/repos/nhillson/phosphor-loop/actions/runs?per_page=1"`.
7. **Fail fast:** single clicks and lookups give up after 5 s, not 30.
8. **Thorough routine only before a show or when Nick asks:** a longer Autopilot run, saving and loading a
   preset, the Output window, and longer picture checks on his computer.

The workspace browser has no graphics chip (software drawing, about 5–9 frames a second at the test size), so
its pictures show fewer, more separate echoes than Nick sees at 60 frames a second.

## Working with Nick

- Before starting a task, give a rough ETA. Send short progress updates with a fresh ETA at milestones, as
  long as they cost next to nothing. Progress updates don't wait for an answer.
- He isn't technical: explain things plainly, step by step, with pictures where they help.
