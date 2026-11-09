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
   up to 5 ready looks with snapshots in `#cueStrip` (a full list is never replaced: the scout stops trying until one is cleared or cut to); the next waits built up on the hidden loop and Next look cuts on the same frame.
   Cue looks never read the other loop (no Other loop input, push, dye or feeds). `python3 tests/cue_check.py` (about 2.5 minutes;
   feeds the eye copies for the scout, leaves out 3D worlds and fractals, which take seconds a frame here). Reaches in via `window.__plCue`.
   **Keys for cueing:** 1 to 5 (top row or number pad, by `e.code`) pick that preview (`cueKey` → `cuePickSlot(i, byKey)`, the same as a
   click); the picked one's number again cuts. In Cue mode Space cuts (blurring whatever has focus, so click-then-Space works) and
   Shift+Space freezes; held keys cut once. A preview's ✕ (`.cue-x`, in a `.cue-slot` beside it) or Shift + its number clears that
   look (`cueDrop(i)`; if it was waiting on the hidden loop the next best takes its place). **Fade between looks** (`apSet.cueFade`,
   `cueFadeSecs` ½–8 s; also `#cueFadeBar` beside Cut): `cueGo` starts `cue.fade` and `cueFadeTick` eases What you see across; no new look is
   loaded (`cueDeck` waits) until it's done; pressing again finishes it and goes on. Checked at the end of `tests/cue_check.py`.
   Previews show Clips (`apSet.cueLive` false: `cueCapture` tiles the scout into `clipSheet` 15 fps from 1.5 s, read back async by
   `readLater`/`cueReads` only when a look passes) or Live (`MINI` loops P0–P4 run at 180 lines inside `withMini`, which swaps
   simW/simH; `miniRun` gives draw3D its own scene targets; `liveSheet` read back every other frame). `extraLoop`/`picOf` let the
   scout and minis use the deck loop's picture and get their final pass. `cuePlay` draws both into the previews.
4h4. **Fix projector shape** (keystone, `ks`, `ksAttach`, `ksMatrix`, `ksMap` in js/app.js; button `#ksBtn` shows while the Output window
   is open): the Output window's canvas gets a CSS `matrix3d` from four corners (parts of the window's size, clockwise from top left,
   kept in `phosphor-keystone`); dots and a CSS test grid in the Output window, a little SVG map with arrow-key nudging in `#ksPanel`.
   Folding shapes are refused (`ksConvex`). `python3 tests/keystone_check.py` (about 50 s; opens the real Output window).
4h5. **Map my boxes** (projection mapping onto boxes, `bm`, `bmAttach`, `bmDraw`, `bmMoveDot` in js/app.js; button `#bmBtn` with the Output
   window): faces are four corners each (parts of the window's size, kept with on/shade/kind in `phosphor-boxmap`); the Output window gets an
   SVG overlay: black with the faces cut out by a mask (one picture across all faces), plus black at `BM_SHADE[kind]` over Front/Side faces
   while Depth shading is on; while tracing, faces lit with the picked one's dots. Corners snap within 14 px (`BM_SNAP_PX`, Alt to stop).
   Faces have 3 to 64 corners (`bmAddDot` / `bmDelDot`, + Corner / − Corner, double-click an edge, right-click a dot); outlines may bend
   in but mustn't cross themselves (`bmSimple`).
   `python3 tests/boxmap_check.py` (about 1.5 minutes; opens the real Output window, measures its pixels).
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
   **A clip dragged out of Phosphor Clips** (1.12, `lib:drag`) arrives as its file; `dropLibraryClip` knows it by name and length
   (only when the clip library has been used here, `CLIP_ON_KEY`) and loads it as that library clip with `clipPick`.
   `python3 tests/gif_check.py` (about a minute).
4z7. **Frame rate limit and Resolution limit** (Screen, under Picture sharpness; `lim`, `limFps`, `limLines`, `setFpsLim`, `setResLim`,
   kept in `phosphor-fps-limit` / `phosphor-res-limit`, No limit to start with). The frame limit skips the screen's frames that come too
   soon at the top of `frame()` (with Phosphor Stream's own fps, `captureNextAt`); fader 10–144 snapping to common rates, top 145 = No
   limit. The resolution limit (240 to 2160 lines) caps `wantLines` (may go below Standard) and the screen's and Output window's canvas
   in `fit`. Both rest while `capCfg()` is set (Stream, Save clip recording, Export video). Auto sharpness judges smooth against
   `limTarget()`. Skipped calls still count in the tests' `__plFrames`; drawn frames are `__plLimits.drawnFrames`.
   `python3 tests/limits_check.py` (about a minute).
4z8. **Chromatic aberration** (Effects, under Halftone; loop keys `aberr`, `aberrShape` 0 Lens / 1 Sideways / 2 Turning, `aberrFinal`,
   true to start with; `LENS` group in js/app.js, `aberrUniforms`, `ABERR_ONCE` / `ABERR_K`; `aberrOff` in js/shaders.js). Final Pass /
   On the way out: `aberrSpread`, five tinted looks along the split (smooth rainbow fringes). Within the loop: red and blue read apart
   every frame in the loop's pass (next to Color chase's `c0`), so they drift apart echo after echo. Lens spreads from the middle
   (follows Off-center's `offAt`). Stack kind `aberr` (zones out, in). Autopilot, Surprise, taste, pins, limits and the sequencer
   include it. Check with `--shot "Prism lens"` and `--shot "Rainbow tunnel"`.
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
4y. **Sound on lines** (React to sound › What the music moves › Sound on lines, `snd.map.lines`, on to start with; Line detail
   `snd.detail`, shown only while it's on): once a frame `sndLinesTick` reads the raw sound (`getFloatTimeDomainData`, also on the fast
   analyser), smooths it (Smooth ≈150 Hz to Fuzzy ≈9 kHz), starts at a rising zero crossing so it holds still, evens out its level
   and packs 96 steps into `uSnd` (vec4[24]); `sndLineAmp(k)` → `uSndAmp`. Wave (per-stretch thirds pushed along the curve's
   normals, `reach` grows its boxes), Shape (one wave all the way round), Bars (a wave through the bar, sharp core) and Topo map
   (`topoHum`, the land ripples). Input size swells half as much meanwhile. `python3 tests/sound_lines_check.py` (about 2 minutes).
4z. **Lopsided effects** (Effects › Lopsided, `ASYM` = offc / wind in js/app.js; `asymTick`): **Off-center** moves Zoom/Spin's
   point (`uCenter`, added to Chase's) and draws the inputs there too (`uInOff`, 0.8 of it); only it follows the music (React to sound ›
   Off-center, `snd.map.asym`: hits shove it, `L.offKick`; the bass widens its wander). **Wind** (`uWind`, `windDir` 0-7 eighths from →
   anticlockwise, 8 Turning; compass buttons `#windDir`) doesn't react to sound. Glitch slide was tried and removed at Nick's request.
   Check with `--shot "Leaning tunnel"` and `--shot "Smoke on the wind"`.
4z2. **Slit-scan** (Effects › Slit-scan, `SLIT` = scan / corr in js/app.js; `scanStep`, FS_SLIT + FS_SCAN in js/shaders.js): each frame a
   slit (brightest of 5 spots across it) of the loop's picture after Time warp (`warpedTex`) goes into the newest columns of a round strip
   (`L.sc.buf`, `SC_W` columns, `SC_SPEED[scanSpeed]` a second); `shownTex` then gives `L.sc.out`. **Photo finish** (`scan`): slit fixed at
   `SC_SLIT`, its past spread to the left. **Corridor** (`corr`, `corrShape` 0 Tunnel / 1 Floor & ceiling / 2 Two walls): the strip on a
   corridor's surfaces, newest at the far point (which follows Off-center's `offAt`), slit drifting across. Autopilot brings them in less
   often (`apFx`). Time warp's shapes (`TIME_SHAPES` = 7): + Diagonal, Rings, Sweep (needs `uTime`), By brightness. Check with
   `--shot "Light corridor"`, `--shot "Photo finish"`, `--shot "Prism|time=90|click=#timeShape [data-tshape='4']"`.
4z3. **Generative art** (Inputs › Generative art: moving pieces made with jdxyw/generativeart's `genart` tool, in `genart/` as
   `<f>.webm` 1024 square seamless loops, `<f>-t.jpg` still and `<f>-p.webm` 240 px gallery preview, listed in `genart/pictures.json`,
   how each was made in `genart/CREDITS.txt`; `gen`, `gens` (a LiveSource video player per loop), `genPick`, `genTick` in js/app.js).
   It has no picture slot of its own (16-texture limit): its frames go through the Picture's slot (`loopUsesGen`, `SRC_ID.genart = 4`).
   The service worker leaves the .webm files to the network (Range requests). `python3 tests/genart_check.py` (about 2.5 minutes).
4z4. **Patch's layers** (the Patch input was removed; its kinds live on as effect stack items `p:<kind>`):
   `js/patch.js` holds the layer kinds `KINDS` (patterns ids 0-14, effects 100-110, colors 200-204), movers (`value`: slow/fast wave,
   music, bass, beat; `speed` faders run a per-layer clock, `speedRate`) and the one-pass-per-layer shader `FS`; js/app.js keeps only
   `patchEnv`, `patchClock`, `patchUP` for the stack. Old looks whose input was Patch fall back to Wave (`patchLoop`). js/patch.js is
   listed in sw.js and android/tools/bundle_site.py.
4z5. **Point cloud** (js/pointcloud.js: one engine, a state per use, `create(gl)` → `state/run/release/burst/rebuild`; glue under
   "point cloud" in js/app.js: settings `cloud` (`phosphor-cloud-v1`, kept in presets as `cloud`), the **Point cloud input**
   (`src 'cloud'`, read through the 3D world slot as Patch is, `SRC_ID.cloud = 37`; per-loop `cloudOf` picture/video/camera/loop,
   `drawCloud`), **Whole picture as dots** (`cAmt`, `cloudFinal` after Shapes, before Type art), dragging (`cloudPress`/`cloudMove` in
   startDraw/moveDraw, `cMode` off = drawing), double-click / Explode (`cloudBoomAt`), music hits (`cloudTick`), Autopilot's
   Use Point cloud (`apSet.cloud`, `apCloud`). `python3 tests/cloud_check.py` (about 2.5 minutes). Check with `--shot "Dust portrait"`
   and `--shot "Dot galaxy"`. js/pointcloud.js is listed in sw.js and android/tools/bundle_site.py.
   tests/check.py presses its buttons from a page script (Playwright's own click times out on this page in the workspace).
   In the Effect stack the Point cloud is a Whole picture card holding the whole `cloudGroup` panel (`WHOLE_KINDS.cloud.group`;
   the section itself is Classic only); the card shows while `cAmt` > 0 or any loop uses the input (`wholeActive('cloud')`).
   Music hits only shove (bursts under 2.5 never tear dots loose; at most one every 0.6 s, `cloudHitAt`).
   **The stack list holds still** while the mouse is over it, a button is held on it or the add menu is open (`stkBusy`,
   `stkPending`, `stackLater`): unforced redraws wait, so cards don't jump or lose clicks. **A loop's Neutral** also zeroes every
   stack kind's faders (`effectsOff`) and turns the whole-picture effects off (grading, 3D lighting, Type art, Point cloud, `stackAll`).
4z6. **Effect stack** (Effects › Effect stack / Classic layout, `stackMode`, kept in `phosphor-fx-mode`, on to start with;
   kinds in `js/stack.js`, glue under "effect stack" in js/app.js). Each loop's list is `tgt.stack` (never changed in place; `loopStack(k)`
   makes one from the settings with `stackFromClassic` when missing), the whole-picture list `stackAll` (`phosphor-stack-all-v1`, in presets
   as `stackAll`). Zones: `in` (the loop's own pass, put together in the stack's order by `feedbackFS(order)` / `feedbackParts` in
   js/shaders.js: movements, colors before the input (A) and after it (B) trade places only among their own slots, so Classic order is the
   old program exactly; one program per order in `fbCache`), `out` (`stackOut`: one pass per effect, the loop's own through `finalProg`
   with only that effect up, Posterize remembering its steps in `so.mem`; Time warp / Photo finish / Corridor always first, `first`),
   `all` (`stackWhole`: Point cloud dots, Type art, and Color grading / 3D lighting as passes of their own, `stackWholeProg`; the display
   pass leaves those two out while the stack is on). Patch's effects/colors/patterns (`p:<kind>`) work in any zone through
   `stackPatchProg` (Patch's pass plus `uMix`; inside a loop, Amount goes part of the way each frame). `runLoopAny` swaps `L.cur` for
   `stackEff(k)` (out-of-stack or switched-off effects at 0, movers added) and sets `stackRunK` so `fxIn` / `setLoopGradeUniforms` read the
   stack. `stackSync` (every 300 ms): an effect whose fader comes up joins its loop's stack (`auto`, old place and zone); an auto one leaves
   once its fader is back to 0 and has faded (`kindActive(..., still)`), unless its card is open or was touched in the last 5 s. Taking an
   effect out puts its faders to 0 (`stackStop`); adding starts it gently (`stackStart`). Cards hold the real control rows (moved in
   with `homeOf` / `sendHome`, so pins, tooltips and Spread out columns keep working; `mirrorForward` picks the column's loop before finding
   the control, since the cards are drawn afresh for it). React to sound's list is replaced by movers (`sndMapNow`: only Sound on lines).
   **Autopilot's stacks** (`apStackFor`, called from `apFinish`, so Surprise and Cue looks get them too): the look's strongest few effects
   (2 at How wild 0 to 5 at 100, besides Zoom & spin, Color shift, Mirror, Posterize, Halftone and anything pinned; the rest set to 0) in their
   places and zones, some swapped inside the loop and now and then one moved across (more with How wild; Posterize/Halftone stay put),
   sometimes a Patch effect or faint pattern (`AP_PATCH_FX` / `AP_PATCH_PAT`, `fadeIn`), movers (React to sound's old choices plus a
   random one); a liked look's stack comes back nearly as it was. Effects still fading stay until gone; Patch effects a new look drops
   fade out (`stackCarry` marks them `bye`, `stackAmt` eases amounts, `stackSync` removes them). New orders compile alongside drawing
   (`stackProg` through `sceneReady`; the loop keeps `L.fbLast` meanwhile). **Taste**: profiles and sessions carry `mode: 'stack'` and
   are shown/followed only in their layout (`tasteMode`, `tpMode`; switching layout waits for a session to finish); looks keep their
   stack in votes (`tasteLook`), words `sk:` (effect@zone), `so:` (order), `sl:` (with the input), `sm:` (movers), `sa:` (whole picture).
   Add menu: Movement / Color, texture and patterns / Time / Whole picture, A to Z (`STK.MENU`; some Patch kinds renamed, `PATCH_NAME`).
   `python3 tests/stack_check.py` (about 9 minutes; reaches in through `window.__plStack`). Cue mode's scout and live previews stay Classic.
4z9. **Phones: a steady picture size while scrolling** (`viewH`, `touchUI`, `lvhProbe` before `fit()` in js/app.js): on touch screens the
   narrow layout's picture height comes from the tallest the window gets at this width (100lvh, the address bar hidden), so the
   address bar sliding while the page scrolls doesn't resize the canvas and rebuild the loops (`resim`). Computers still follow
   innerHeight. Checked by setting a phone-sized page's height back and forth (`is_mobile`, `has_touch`) and counting canvas sizes.
4z10. **Taps on phones** (styles/base.css: `touch-action: manipulation` on buttons, summaries, selects, `[data-act]`, chips,
   section headings and labels): two quick taps in one place were double-tap-to-zoom, so the second was lost (opening an effect
   card and closing it again). New looks keep the cards' ids of the effects still there (`stackKeepIds` in `apStackFor`), so an
   open card stays open. Checked by opening and closing every card twice with `touchscreen.tap` on an `is_mobile` page and with
   the mouse, Autopilot on and off.
