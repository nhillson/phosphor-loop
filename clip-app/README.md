# Phosphor Clips

A Windows app for the stream PC that grabs videos and GIFs from the web, trims them, and sorts them into a clip
library for Phosphor Loop.

**Install:** download `Phosphor-Clips-Setup.exe` from the
[clip-app-latest release](https://github.com/nhillson/phosphor-loop/releases/tag/clip-app-latest) and double-click it.

## How it's used

1. **Find a video** in the built-in browser (the start page lists free-to-use sites), or paste a link, or drop a
   file on the window, or right-click a video or GIF on any page.
2. **Mark the good part** while it plays: *Start here*, then *End here*. Unmarked, the whole video is grabbed.
   Videos over 10 minutes download only the marked part (plus 3 s either side).
3. **Trim, pick a category, save.** The trimmer opens by itself; drag the purple handles or nudge them. The
   category is suggested from the picture (CLIP, run on the processor) and the title/tags; one click changes it.

Clips are saved as H.264 MP4 (no sound unless *Keep sound* is ticked, up to 1080p by default, at most 60 fps),
encoded on the NVIDIA card when there is one, in `Videos\Phosphor Clips\<Category>\<Name>.mp4`. `library.json`
there lists every clip (name `n`, category `c`, file `f`, thumbnail `t`, length `d`, size `w`×`h`, `fps`, `sound`,
source page `src`, `page` title, `by`, licence `lic`, `part` of the original), in the style of Phosphor Loop's
`nature/pictures.json`. Clips moved, added or deleted in File Explorer are picked up (a new folder becomes a new
category).

## For Claude

- Branch `clip-app`, folder `clip-app/`, built and tested by `.github/workflows/clip-app.yml` on a Windows runner.
  Test results (JSON, pictures, logs) go to the `clip-app-ci-logs` release; the installer to `clip-app-latest`.
- `src/engine.js` (yt-dlp, direct downloads, ffmpeg cutting; plain Node), `src/library.js` (folders + library.json),
  `src/vision.js` + `src/vision-worker.js` (CLIP via Transformers.js in a utility process, model cached in the app
  data folder's `models`), `src/keywords.js`, `src/main.js` (window, built-in browser, jobs), `src/panel/` (UI),
  `src/selftest.js` (the app testing itself, waits by frames).
- Tests: `node test/engine-test.js` (NET=1 adds real sites), `node test/vision-test.js`, `node test/app-test.js`
  (ELECTRON=path, CLIPS_NO_VISION=1 to skip the model). Locally: yt-dlp and Electron from GitHub releases,
  `xvfb-run` for the app test.
- App data on Nick's PC: `%APPDATA%\Phosphor Clips\` (`log.txt`, `settings.json`, `models\`, `bin\yt-dlp.exe`,
  which updates itself daily).
