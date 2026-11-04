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
   It also fails any graphics program that reads more than 16 pictures (textures): Chrome and Edge on Windows
   allow only 16, and such a program won't start there at all, though this workspace's software graphics allow 32.
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
4f. **Shapes** (the Shapes section: 2D/3D shapes over everything, with gravity, lens/swallow and an accretion disk;
   code in `js/shapes.js`, glue under "shapes" in js/app.js): `python3 tests/shapes_check.py` (about 3 minutes). It
   takes a picture of every kind, flings, drops, merges and clears, and reaches into the app through `window.__plShapes`.
4g. **3D lighting** (the 3D lighting section over the finished picture, and 3D depth / smoothness / shine under each input's
   Adjust the picture; `reliefShade` in js/shaders.js): `python3 tests/relief_check.py` (about 1.5 minutes). It feeds
   `tests/media/person.webm` in and reaches into the app through `window.__plRelief`.
4h. **Autopilot's mirror changes** (a new mirror level comes in through the loop's Transition over the Fade time,
   from the mirror on screen; `mirrorGlideIn` / `L.mxSecs` in js/app.js): `python3 tests/ap_mirror_check.py`
   (about a minute and a half).
4i. **Pins per loop** (a pin lights only under the loop it holds, on the tabs and in Spread out controls' columns;
   class-wide updates like `syncPins` skip the column copies with `notCopy`): `python3 tests/pins_check.py` (about a minute).
4j. **The clip explorer** (Clip library… and the sequencer's + Add clip… open it: folder tree of categories and subfolders,
   search over names and tags, tags, saved effects with Use with its effects / Just the clip, Copy to a drive, New folder,
   moving clips, and in the sequencer Add with its whole look: a block per loop the saved look used, with Show/feed and
   grading as steady automation) **and ✂ Save clip** (under the picture: trim strip, folder, tags, whole look). Phosphor Clips does the storing (sharing
   server: /snip, /clip/<id>, /look/<id>, /folder, /copy; clip-app/src/snip.js and library.js on the clip-app branch;
   each clip's tags and effects live in a <Name>.phosphor.json beside it). Test: `CLIPS_APP=<clip-app folder> python3
   tests/snips_check.py` (about 4 minutes, 77 checks; runs the real sharing server and cutter, so ffmpeg must be installed). Click,
   type and pick from page scripts (`element.click()`, set value + input event), not Playwright's own click or fill: it can wait forever on this page in the workspace
   browser. `tests/clips_check.py`'s last check (the last clip coming back after a reload) fails here when run after the
   rest of that test, also on versions before the explorer; it passes on its own.
4k. **Recorded moves** (✂ Save clip… › Record the settings: the settings over time, saved as a library clip's effects
   `look.moves` with a preview video; Play the recording in the explorer, Add the recording in the sequencer; logic in
   `js/moves.js`, glue under "recorded moves" in js/app.js): `CLIPS_APP=<clip-app folder> python3 tests/moves_check.py`
   (about 4 minutes; the real sharing server, so ffmpeg must be installed). With a video shown, Save clip asks first
   (trim or record); snips_check.py picks Trim. It reaches into the app through `window.__plMoves`.
   Everything Save clip saves goes into the **Look library**: Phosphor Clips 1.9's `looks` category (folder Looks),
   opened with the Look library button under the picture (`openClips('looks')`). The Clip library (Video) and
   Autopilot see only the web clips (`clips.web`); the sequencer's + Add clip sees both (`clipsSetView`). While a
   look records, the picture is drawn at the size picked (1080p/1440p/4K, `MV.size` through `capCfg`), not the
   preview's.
4h2. **Autopilot's black-out watch** (`darkWatch` / `liftLoop` in js/app.js, next to the white-out watch: Trails, Input size and
   brightness up a notch on a loop going black, show the lit loop, next look after 4 s; never while the white-out watch is busy):
   `python3 tests/ap_dark_check.py` (about 2 minutes; it hands the eye copies of a black screen, since this workspace's graphics are too slow).
4h3. **Cue mode** (Autopilot › Cue mode, `apSet.cue` / `apSet.cuePreviews`; `cueTick`, `cueGo`, `cueDeck`, `cueScene` in js/app.js): no timed
   looks, watches or build-ups; a scout runs in loop C's place (only with 2 loops) trying looks, judged by `lookVerdict` + `tasteJudge`;
   up to 5 ready looks with snapshots in `#cueStrip`; the next waits built up on the hidden loop and Next look cuts on the same frame.
   Cue looks never read the other loop (no Other loop input, push, dye or feeds). `python3 tests/cue_check.py` (about 2.5 minutes;
   feeds the eye copies for the scout, leaves out 3D worlds and fractals, which take seconds a frame here). Reaches in via `window.__plCue`.
4l. **Autopilot's Use Type art** (switch under Autopilot, `apSet.type`, `apTypeArt` / `typeTick` in js/app.js):
   `python3 tests/ap_type_check.py` (about a minute and a half).
4m. **The sequencer's playhead with Spotify** (`seqPos` in js/app.js: small differences caught up by speed, skips over
   1.5 s jump; js/spotify.js polls every second while playing and moves the position at once on a seek):
   `python3 tests/seq_playhead_check.py` (about half a minute) and `node --test tests/spotify.test.mjs`.
4n. **The beat, straight from the sound** (`js/audio/hits.js`; the old tempo finder in js/audio/rhythm.js no longer
   starts, `USE_TEMPO_GRID` in js/app.js): `python3 tests/hits_music.py 60 && python3 tests/hits_music.py 30 &&
   node --test tests/hits.test.mjs` (made-up music with known kicks, as Chrome's analyser hears it).
4o. **A sequence and your hand** (a loop whose track has no blocks is yours; picking an input or raising Show on a loop
   the sequence plays stops it; stopping gives back the loops it hid; `seqRun`, `seqTakeOver`, `seqGiveBack`):
   `python3 tests/seq_takeover_check.py` (about a minute; with Play over it switched off).
4o2. **Play over it** (sequencer switch, on by default, `hand` in js/app.js, kept in `phosphor-seq-hand`): while a sequence plays,
   a fader moved on one of its loops adds your amount on top of the sequence's own value (`hand.loop` / `hand.mix`,
   `handSlider`); other things picked on that loop (input, mirror, switches) are held as they are (`hand.set`, caught by
   `handBefore` within 1.5 s of a touch). Each frame `handBefore` gives the sequence its values back, `seqApplyTrack`
   plays, `handAfter` lays yours on top. Let go / double-click a fader / "When I let go: Drifts back" (`handEase`).
   Off during Export video. `python3 tests/seq_hand_check.py` (about a minute and a half).
4p. **Mirror as a change over time** (sequencer key `mirror`, range 0-8 snapped to Off/2/4/6/8 by `mirrorSnap`). Each point
   is one change with its own Transition and time (`[u, v, fx, secs]`, kept by `cleanPts` in js/timeline.js); the
   line holds each mirror until its next point and changes straight to that point's mirror there, its way (`lineValue`,
   `mirrorPoint`: 0 to 6 is one change); click a point to pick it in the block's details (`seq.selPt`). After a jump
   in the song (`seq.jumped`) the mirror is simply what the line says, nothing played out. `python3 tests/seq_mirror_check.py`.
4q. **Many change lines in a block**: one line is in front (`seqLineAct`: its points, clickable; picked with the buttons in
   the block's details or by clicking its faint line), the others drawn faintly behind; the selected block's track
   grows taller (`.seq-h-lane.tall`). Double-clicking a block is counted by the app (two presses within 0.5 s and 8 px,
   `seq.lastPress`), not the browser's dblclick, which doesn't come when the block is redrawn between the clicks;
   right-click › Add a point here too (`seqAddPointAt`). `python3 tests/seq_lines_check.py` (real mouse clicks).
4r. **Type art over time** (sequencer keys `tAmt`, `tSize`, `tShimmer`, `SEQ_TYPE`; whole-picture, so blocks on several tracks
   mix by Show, `seqTypeApply`; what Nick set is kept in `seq.typeBase` and comes back when no block sets it):
   `python3 tests/seq_type_check.py`. **Play when following a paused Spotify song** starts it (`spotify.play()`: on its
   device, or the one it was last on / first open when Spotify has gone idle, from the same spot; Premium only):
   `node --test tests/spotify.test.mjs`.
4s. **Each loop's own video** (`vids` in js/app.js: a player per loop; `vid` is the edited loop's, which the Video
   controls, Save clip and `inMedia.vid` / `clips.cur` work on; `vidFor(k)` is what loop k shows: its own, or else the
   first loop's that has one). The sequencer loads a track's next video into its loop's player ahead
   (`seqPreloadVid`, `seq.preloadSecs`): when the player is showing the block before (two video blocks back to back),
   into its spare player (`to.spare`, `vidUseSpare` swaps it in, `vidDropSpare` lets it go). A loop waiting for its
   video shows black (`seqVidWait`), never the one before: `python3 tests/two_videos_check.py` (about 4 minutes; the
   stand-in clip library).
4t. **Export video…** (sequencer: plays the sequence once from the top by itself while the picture is drawn at 4K / 1440p /
   1080p through `MV.size` and recorded with this computer's sound, then offers an MP4; the song starts in Spotify from
   the top with `spotify.play(0, uri)` and is paused at the end, `spotify.pause()`; `EX`, `exGo`, `exTick` in js/app.js):
   `python3 tests/seq_export_check.py` (about 2 minutes; own clock, no sound) and `node --test tests/spotify.test.mjs`.
   **Quality** (export panel, `EX_QUALITY`, `exBps`, `phosphor-ex-quality`, Very clean to start with): the same three rates as Phosphor
   Stream's recordings (stream-app/src/record.js `REC_QUALITY`), times 1.5 for 60 frames a second, 300 Mbps at most; keep the two tables alike.
   Recordings hold their sound back by **Sound timing** (export panel, `recSync`, `phosphor-rec-sync`, ½ s to start with;
   `blendSounds(tracks, delay)`), because in a recording the picture comes after its sound; Record and Save clip use it too.
4u. **A block's start, and its grading** (a block starting by itself has its settings and Show from its first frame, its mirror
   Cut unless its details pick a Transition, `bl.mxIn`; an Autopilot Type art glide stops; `startFresh` in seqApplyTrack):
   `python3 tests/seq_block_start_check.py`. A block keeps the Color grading it was added with (`bl.grade`, `seqGradeNow`,
   `seqBlockGrade`); while graded blocks play each loop is graded on its own and yours isn't laid over the whole picture
   (`seqGradeRest`, `seq.gradeOwned`). **From the start** (`seqFromStart`, Home key): `python3 tests/seq_grade_check.py`.
   After the end's Autopilot, going back into the sequence puts things back as they were at the end (`seqApSnap`,
   `seqApBack`): `python3 tests/seq_ap_end_check.py`. Type art in this workspace takes seconds a frame: long ceilings.
4v. **Edit this look** (right-click a block, or the button in its details: the sequence stops, the block's look and grading go
   onto its loop and the Color grading faders; Save to block / Cancel in the bar under the picture; `seqEditStart`,
   `seqEditEnd`, `seq.editing`): `python3 tests/seq_edit_check.py`.
4w. **Snapping** (a dragged block or its end snaps to other blocks' ends on any track, the playhead, markers and 0:00 within
   10 px, a dashed line shows where, Alt drags freely; `seqSnapTo`, `seqSnapLine`; a block changes track only once the
   pointer has moved up or down 16 px): `python3 tests/seq_snap_check.py` (real mouse drags).
4x. **Moving pictures** (a dropped or picked GIF, or moving WebP/PNG, goes into the Video input as a looping WebM made in the page:
   `movingToVideo` / `webmFile` / `asVideoFile` in js/app.js, ImageDecoder + VideoEncoder VP8, played through to at least 6 s; a still one
   stays a Picture; a drop that brings only an address is fetched, `dropFetch`; the sequencer remakes the video from your GIF).
   **Stickers** (see-through parts, as GIPHY's): Chrome can't encode alpha, so the video is twice as tall, picture over a white-on-black
   see-through map (`file.sticker`, `videoURL` → `stickerURLs`); `stickerUnpack` rebuilds each frame with alpha in LiveSource.update
   and the loop takes it as a cutout (`uVidCut`, the Subject silhouette path in `live()`). **Drop into a loop**: dragging over the picture
   shows a target per loop that's on (`dropZones`, `dropLoopAt`); the loop tabs take drops too; `loadFile(file, handle, k)`.
   **Save clip of a sticker** keeps the packed video and always adds the tag `sticker` (`STICKER_TAG`, `clipIsSticker`); a library
   clip with that tag is unpacked when picked (`clipPick`), and its thumbnail shows only the top half (`.sticker-thumb`).
   **Each loop has its own picture** (`pics`, `pic` = the edited loop's, like `vids` / `vid`; `inMedia.pic` is `pic.media`;
   `natPick(i, quiet, to)`, `picUseCard(to)`, `seqLoadPic(pm, K)`, `picPanelSync` on tab change; recordings keep `media.pics`
   per loop, older ones' single `pic` goes to every loop; each loop's last nature picture is kept, `natLastKey(k)`).
   `python3 tests/gif_check.py` (about a minute).
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
