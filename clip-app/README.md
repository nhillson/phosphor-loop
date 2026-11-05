# Phosphor Clips

A Windows app for the stream PC that grabs videos and GIFs from the web, trims them, and sorts them into a clip
library for Phosphor Loop.

**Install:** download `Phosphor-Clips-Setup.exe` from the
[clip-app-latest release](https://github.com/nhillson/phosphor-loop/releases/tag/clip-app-latest) and double-click it.

## How it's used

1. **Find a video** in the built-in browser (the start page lists free-to-use sites), or paste a link, or drop a
   file on the window, or right-click a video or GIF on any page.
2. **Mark the good part** while it plays: *Start here*, then *End here*. Unmarked, the whole video is grabbed.
   Marked, only the marked part downloads (plus 3 s either side), whatever the video's length; if a site won't hand
   out a part, the whole video comes down instead.
   In Chrome, the button's menu does the same: *Start here*, *End here*, *Grab the marked part*.
3. **Trim, crop, pick a category, save.** The trimmer opens by itself and always shows the whole picture. Drag the
   purple handles or nudge them. **Crop** keeps part of the picture (Free, 16:9, 4:3 or Square; drag the box or its
   corners). The category is suggested from the picture (CLIP, run on the processor, looking only at the cropped part)
   and the title/tags; one click changes it.

Clips are saved as H.264 MP4 (no sound unless *Keep sound* is ticked, up to 1080p by default, at most 60 fps),
encoded on the NVIDIA card when there is one, in `Videos\Phosphor Clips\<Category>\<Name>.mp4`. `library.json`
there lists every clip (name `n`, category `c`, file `f`, thumbnail `t`, length `d`, size `w`×`h`, `fps`, `sound`,
source page `src`, `page` title, `by`, licence `lic`, `part` of the original), in the style of Phosphor Loop's
`nature/pictures.json`. Clips moved, added or deleted in File Explorer are picked up (a new folder becomes a new
category).

## Phosphor Loop uses the library

Phosphor Clips shares the library with Phosphor Loop on the same computer (`src/server.js`, http://127.0.0.1:47811,
falling back to 47812/47813). It answers only `https://*.github.io`, localhost pages and file pages. Closing the window
keeps it by the clock, and it starts with Windows out of sight (on by default; tray menu or the Library page).
In Phosphor Loop: **Video › Clip library…** opens the gallery; Autopilot brings in clips from the categories ticked
there. Chrome 142+ asks once whether the site may reach apps on this device (Local Network Access): Allow.
Phosphor Stream (Electron 38, Chromium 140) doesn't ask; if it moves to Electron 39+ its permission allow-list in
`stream-app/src/main.js` needs the local/loopback network permission too.

## Snips from Phosphor Loop (`src/snip.js`)

In Phosphor Loop, under **Video › Repeat a section**, mark a start and an end on the video playing, then **Save to
clip library**: name it, pick a category, and Phosphor Clips cuts that part out and files it like a clip saved in the
trimmer (H.264 MP4, at the size picked in the trimmer last, sound only if *Keep sound* is ticked there).
- A library clip: Phosphor Loop sends only its id and the marks (`POST /snip?from=<id>&start=&end=&name=&cat=&sound=`);
  the snip keeps the clip's credit and says which part of the original it is.
- A video of your own: Phosphor Loop sends the file in the request (`POST /snip?start=&end=&...&src=<file name>`, up to
  8 GB); only the snip is kept.
- Only `https://nhillson.github.io`, localhost pages and file pages may send snips (they write into the library);
  reading the library stays open to any `*.github.io`. Phosphor Clips must be running on the same computer.
- Test: `node test/snip-test.js`.

## Stickers (GIFs with see-through parts, as GIPHY's)

A grabbed GIF with see-through parts is saved as a sticker (`hasSeeThrough`, `cutClip(..., { sticker })` in
`src/engine.js`). A video can't keep see-through parts, so the clip is twice as tall: the sticker on black on top,
its see-through map (white solid, black see-through) underneath, cut from the GIF itself (the trimmer plays a copy
on black). It is tagged `sticker`; Phosphor Loop knows it by that tag and puts the two halves back together as it
plays. This app's library shows only the top half of a sticker (`.pic.sticker`, `#cmVideo.sticker`). Snips Phosphor
Loop saves of a sticker arrive already packed and tagged. Since 1.11.

Moving WebP (how GIPHY hands out most stickers) and AVIF go through Chrome's reader whatever ffmpeg can do (older ffmpeg sees a picture with no size; ffmpeg 9 plays a moving WebP but without its see-through parts), so
Chrome's own picture reader unpacks them in a hidden window (`decodePicture` in `src/main.js`, page `src/decode.html`)
and `picturesToVideo` in `src/engine.js` turns the frames into a lossless FFV1 video with see-through parts, which is
used from then on like a GIF. Since 1.11.1; the self-test grabs `sticker.webp` and `sticker.gif` from the test pages.

## Tags, saved effects, and copying clips to another computer

- **Tags** (`fractal`, `industrial`, `neon glow`…): set in Phosphor Loop's clip explorer, in the snip form, or in
  the clip window here (Library › a clip › Tags, commas between). The Library search finds clips by name or tag.
- **Saved effects**: Phosphor Loop can save the whole picture (all loops, mixing, Color grading, 3D lighting, like a
  preset) with a clip; its explorer then offers *Use with its effects* or *Just the clip*.
- **Looks** (Phosphor Loop's Look library): every library has a `looks` category (folder `Looks`, `sys: true`) that
  can't be renamed or removed, isn't offered for web grabs or suggested by the recogniser, and holds what Phosphor
  Loop's ✂ Save clip saves. Snips into it are kept up to 4K, at a lower quantiser (`HIGH` in engine.js), sound AAC
  320 kbps 48 kHz; web clips stay as before (up to the trimmer's size, 192 kbps).
- **Recorded settings** (Phosphor Loop's ✂ Save clip… › Record the settings): the effects are a start look plus
  `moves`, the settings over time (`js/moves.js` on Phosphor Loop's `main`); the clip's video is a preview. These
  clips are marked `mv` in the listing (a red REC badge in Phosphor Loop's explorer).
- Both live in a **settings file** beside the clip, `<Name>.phosphor.json` (tags, effects, category, credit);
  `library.json` keeps only the tags and whether there are effects (`fx`). Renaming, moving or deleting a clip here
  takes its settings file along.
- **Subfolders**: inside a category folder, as deep as you like (`Abstract/Fractals/Blue`). Make them in Phosphor
  Loop's explorer (*New folder*) or in File Explorer; move clips between them from the explorer, or drag them in File
  Explorer (picked up on the next look). Snips can be saved straight into one.
- **Copy to a drive…** (Library page: the clips shown; or from Phosphor Loop's explorer: the clips picked there)
  copies each clip and its settings file into `Phosphor Clips/<Category>/<subfolders>/` on the folder or drive you pick. On the
  other computer, drop those category folders into its library folder (or press *Look again*): the clips come in
  with their tags, effects and credit.
- Addresses (sharing server): `POST /clip/<id>` `{ n?, c?, p?, tags?, look? }`, `POST /folder` `{ c, p }`, `GET /look/<id>`, `POST /copy` `{ ids }`
  (opens the folder picker here); like `/snip`, only from nhillson.github.io, localhost pages and file pages.

## Send to Phosphor Clips (the Chrome button, `chrome-button/`)

A Chrome (or Edge) extension that hands what you're watching to Phosphor Clips on the same computer:
- **The button** opens a small menu (`popup.html`/`popup.js`): the video's clock (read 4 times a second with
  `chrome.scripting`, every frame of the page, the biggest playing video), **Start here** / **End here** (keys S
  and E; kept per tab and page in `chrome.storage.session` while the menu is closed), and **Grab the marked part**
  (Enter): `POST /open` with `kind: 'grab'` and the marks, so only the marked part downloads (plus 3 s either side)
  and opens in the trimmer; Chrome's copy pauses. Unmarked, it grabs the whole video. **Open this page in Phosphor
  Clips instead**: the page opens in Phosphor Clips' browser and its video picks up at the same moment (YouTube
  also gets `&t=`).
- **Updates itself**: `/ping` reports the button version Phosphor Clips carries (`button`); when it's newer, the
  extension waits until its menu is closed, then `chrome.runtime.reload()`s to pick up the new files from the
  fixed folder (once per version, noted in `chrome.storage.local.reloadFor`, so it can't loop). Needs Developer
  mode, which *Load unpacked* needs anyway. Buttons from before 1.1.0 don't do this: Phosphor Clips sees their
  version (sent with each request and `/hello`) and its Library page shows an *Update the Chrome button* card
  until the one manual reload in `chrome://extensions`.
- **Right-click a video**: *Send this video to Phosphor Clips* (the same, for that video). **A GIF**: *Grab this GIF
  with Phosphor Clips* (straight to the trimmer; `.gif`/`.gifv` addresses). **A link**: *Open link in Phosphor Clips*.
- Talks to the sharing server: `POST /open` and `POST /hello`, accepted only from extension origins (or a local
  program sending `X-Phosphor-Clips: 1`). All requests are made from the extension's service worker or its own page:
  Chrome's Local Network Access check exempts those (not content scripts). Needs only `activeTab`, `scripting`,
  `contextMenus` and `http://127.0.0.1/*`.
- **Not running**: it opens `explain.html` with a *Start Phosphor Clips* button: a `phosphor-clips://open?d=<base64url
  JSON>` link (registered by the installer and `app.setAsDefaultProtocolClient`) that starts the app with the request.
- **Installing**: Phosphor Clips copies the extension to `%APPDATA%\Phosphor Clips\Chrome button` (a fixed folder,
  refreshed when the version changes) and its *Add the button to Chrome…* helper walks through Developer mode and
  *Load unpacked* with pictures (`src/panel/img/chrome-*.png`, the extensions page screenshots made with Playwright).
  The zip is also on the release page.
- Tested by `test/chrome_test.py` (the real extension in Chromium, the real app beside it; on Linux under `xvfb-run`)
  and the app's self-test (the server side, the helper, the pick-up, the link).

## Ad blocker and Skip sponsor parts (`src/adblock.js`, `src/sponsors.js`)

- **The shield** by the address bar: purple with a tick and a count when it's blocking the page that's showing,
  grey and crossed out when it's off or the site is allowed. Click it for a small menu: *Block ads* (on by default),
  *Allow ads on <site>* (for a site that won't work with ads blocked; covers the site's sub-addresses), and
  *Skip sponsor parts in YouTube videos* (off by default). Changing blocking reloads the page.
- **Blocking**: Ghostery's engine (`@ghostery/adblocker-electron`, uBlock Origin-compatible lists: ads and trackers),
  wired by hand into the `persist:web` session so it can be switched off or allowed per site at once and can count.
  Lists are cached in the app data folder (`adblock-engine.bin`) and fetched fresh in the background once a day. If
  they can't be fetched the browser just works without blocking. Grabs never go through it (yt-dlp and direct
  downloads are separate).
- **Skip sponsor parts**: SponsorBlock's marked parts (sponsor, self-promotion, subscribe reminders), asked for by a
  4-letter hash prefix so the service never learns which video is watched. While watching, each part is jumped over
  once per visit (a toast says so); a whole YouTube video grabbed with nothing marked is downloaded with them cut out
  (`--sponsorblock-remove`), falling back to the full video if SponsorBlock can't be reached. Marked grabs are left
  alone so the marks and the trimmer agree.
- Settings: `adblock`, `adAllow` (sites), `skipSponsors`. Tests: `node test/adblock-test.js`, and the self-test's
  ad page (`ads.html`).

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
