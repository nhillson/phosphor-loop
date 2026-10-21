'use strict';
// The app testing itself, the way Nick would use it: open a page with a video, press Start here and End here while
// it plays, grab, check the trimmer opened on the marked part, save, then the same for a GIF and for a marked part
// of a long video. Every wait is a number of drawn frames (the page's video, or the panel's own frames); time
// limits are only ceilings for when something has stopped. Runs when CLIPS_TEST=1 and CLIPS_TEST_URL is set (the
// test server's address); writes result.json and pictures to CLIPS_TEST_OUT.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function selftest(h) {
  const base = process.env.CLIPS_TEST_URL;
  const out = process.env.CLIPS_TEST_OUT || path.join(h.app.getPath('userData'), 'selftest');
  fs.mkdirSync(out, { recursive: true });
  const checks = [];
  const check = (name, ok, note = '') => { checks.push({ name, ok: !!ok, note: String(note) }); h.log('selftest: ' + (ok ? 'ok   ' : 'FAIL ') + name + (note ? ' (' + note + ')' : '')); };
  const panel = () => h.win().webContents;
  const page = () => h.web().webContents;
  const pjs = (code) => panel().executeJavaScript(code);
  const ceiling = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('gave up waiting for ' + what)), ms))]);
  // Waits until the panel has drawn frames with cond true; the panel draws ~60 frames a second while it waits
  const panelUntil = (cond, what, ms = 120000) => ceiling(pjs(`new Promise((r) => { const chk = () => { try { if (${cond}) { r(true); return; } } catch (_) {} requestAnimationFrame(chk); }; chk(); })`), ms, what);
  const panelFrames = (n) => ceiling(pjs(`new Promise((r) => { let i = 0; const f = () => (++i >= ${n} ? r(i) : requestAnimationFrame(f)); requestAnimationFrame(f); })`), 30000, n + ' panel frames');
  // Waits for the page's video to show n new frames; resolves its time
  const videoFrames = (n) => ceiling(page().executeJavaScript(`new Promise((r) => { const v = document.querySelector('video'); let i = 0;
    const cb = () => (++i >= ${n} ? r(v.currentTime) : v.requestVideoFrameCallback(cb)); v.requestVideoFrameCallback(cb); })`), 60000, n + ' video frames');
  const editorFrames = (n) => ceiling(pjs(`new Promise((r) => { const v = document.querySelector('#edVideo'); let i = 0;
    const cb = () => (++i >= ${n} ? r(v.currentTime) : v.requestVideoFrameCallback(cb)); v.requestVideoFrameCallback(cb); })`), 60000, n + ' trimmer frames');
  const click = (sel) => pjs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
  // The window's picture, plus the web page's own picture and where it sits (the window's picture leaves it out)
  const shot = async (name) => {
    fs.writeFileSync(path.join(out, name + '.png'), (await h.win().capturePage()).toPNG());
    const w = h.web();
    if (w && w.getVisible() && w.getBounds().width > 0) {
      fs.writeFileSync(path.join(out, name + '.web.png'), (await w.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(out, name + '.web.json'), JSON.stringify(w.getBounds()));
    }
  };
  const loadPage = (url) => new Promise((r) => { page().once('did-finish-load', r); page().loadURL(url); });
  const vision = process.env.CLIPS_NO_VISION !== '1';

  let code = 1;
  try {
    await panelUntil('window.__clipsReady === true', 'the panel');
    check('panel opened', true);
    await shot('0-start-page');

    /* ---- 1. a page with a video: mark a part while it plays, grab, trim, save ---- */
    await loadPage(base + 'video.html');
    const t0 = await videoFrames(20);
    check('the page video plays', t0 > 0, t0.toFixed(2) + ' s');
    await panelUntil(`document.querySelector('#now').classList.contains('playing')`, 'the panel to see the video');
    check('the panel sees the video playing', true, await pjs(`document.querySelector('#nowText').textContent`));
    await click('#markStart');
    await panelUntil(`document.querySelector('#markStart').classList.contains('set')`, 'the start mark');
    const markedStart = await pjs(`S.video.start`);
    await videoFrames(60);
    await click('#markEnd');
    await panelUntil(`document.querySelector('#markEnd').classList.contains('set')`, 'the end mark');
    const markedEnd = await pjs(`S.video.end`);
    check('Start here and End here mark the playing video', markedEnd > markedStart + 0.5, markedStart.toFixed(2) + ' to ' + markedEnd.toFixed(2));
    await shot('1-marked');
    await click('#grabPage');
    await panelUntil(`S.ed && !document.querySelector('#editor').hidden`, 'the trimmer', 180000);
    await editorFrames(15);
    const ed = await pjs(`({ start: S.ed.start, end: S.ed.end, d: S.ed.d })`);
    check('the trimmer opens on the marked part', Math.abs(ed.start - markedStart) < 0.35 && Math.abs(ed.end - markedEnd) < 0.35,
      `${ed.start.toFixed(2)}-${ed.end.toFixed(2)} of ${ed.d.toFixed(1)} s`);
    check('the whole short video came down', Math.abs(ed.d - 20) < 0.3, ed.d.toFixed(2) + ' s');
    if (vision) await panelUntil(`(() => { const j = S.jobs.find((x) => x.id === S.ed.id); return j && !j.looking; })()`, 'the picture recogniser', 15 * 60 * 1000);
    const sug = await pjs(`(() => { const j = S.jobs.find((x) => x.id === S.ed.id); return j && j.suggestion; })()`);
    check('a category is suggested', sug && sug.id, sug ? `${sug.id} (${sug.by}, ${sug.sure})` : 'none');
    if (vision) check('the picture recogniser took part', sug && (sug.by === 'picture' || sug.by === 'both'), sug && sug.by);
    // Trim a little by hand: nudge the end in by a second
    await pjs(`document.querySelector('[data-nudge="end,-1"]').click()`);
    await panelFrames(5);
    const trimmed = await pjs(`({ start: S.ed.start, end: S.ed.end })`);
    await shot('2-trimmer');
    if (!(await pjs(`!!S.ed.cat`))) await click('#edCats [data-cat="abstract"]');
    const cat1 = await pjs(`S.ed.cat`);
    await click('#edSave');
    await panelUntil(`S.lib && S.lib.clips.length >= 1 && !S.ed`, 'the save', 180000);
    const clip1 = await pjs(`S.lib.clips[0]`);
    const lib = h.library();
    const file1 = path.join(lib.dir, ...clip1.f.split('/'));
    check('the clip is in the library folder', fs.existsSync(file1), clip1.f);
    check('the clip is the trimmed length', Math.abs(clip1.d - (trimmed.end - trimmed.start)) < 0.15, clip1.d + ' s vs ' + (trimmed.end - trimmed.start).toFixed(2));
    check('the clip went to the chosen category', clip1.c === cat1, clip1.c);
    check('the clip remembers where it came from', /video\.html/.test(clip1.src) && clip1.page, clip1.src + ' | ' + clip1.page);

    /* ---- 2. a GIF, the way right-click > Grab this GIF does it ---- */
    await loadPage(base + 'gif.html');
    h.startJob({ url: base + 'spin.gif', referer: base + 'gif.html', pageTitle: 'A spinning test GIF' });
    await panelUntil(`S.ed && !document.querySelector('#editor').hidden`, 'the GIF in the trimmer', 120000);
    await editorFrames(10);
    const gd = await pjs(`S.ed.d`);
    check('the GIF opens in the trimmer as a video', Math.abs(gd - 4) < 0.3, gd.toFixed(2) + ' s');
    await click('#edCats [data-cat="retro"]');
    await panelFrames(3);
    await shot('3-gif');
    await click('#edSave');
    await panelUntil(`S.lib.clips.length >= 2 && !S.ed`, 'the GIF save', 120000);
    const clip2 = await pjs(`S.lib.clips.find((c) => c.c === 'retro')`);
    check('the GIF is saved as an MP4 clip in Retro & glitch', clip2 && /^Retro & glitch\/.+\.mp4$/.test(clip2.f), clip2 && clip2.f);

    /* ---- 3. a marked part of a long video: only that part is downloaded ---- */
    await loadPage(base + 'long.html');
    await videoFrames(5);
    await page().executeJavaScript(`document.querySelector('video').currentTime = 400`);
    await videoFrames(10);
    await click('#markStart');
    await panelUntil(`S.video.start > 300`, 'the start mark on the long video');
    const ls = await pjs(`S.video.start`);
    await videoFrames(40);
    await click('#markEnd');
    await panelUntil(`S.video.end > S.video.start`, 'the end mark on the long video');
    const le = await pjs(`S.video.end`);
    await click('#grabPage');
    await panelUntil(`S.ed && !document.querySelector('#editor').hidden`, 'the long video in the trimmer', 180000);
    const led = await pjs(`({ start: S.ed.start, end: S.ed.end, d: S.ed.d })`);
    check('a long video downloads only the marked part', led.d < 30, led.d.toFixed(1) + ' s downloaded for ' + (le - ls).toFixed(1) + ' s marked');
    check('the trimmer lines up with the marks in a part download', Math.abs((led.end - led.start) - (le - ls)) < 0.5 && led.start < 6, `${led.start.toFixed(2)}-${led.end.toFixed(2)}`);
    await click('#edDiscard');
    await panelUntil(`!S.ed`, 'the trimmer to close');

    /* ---- 4. the library ---- */
    await click('#tabLib');
    await panelUntil(`document.querySelectorAll('#grid .clip').length >= 2`, 'the library grid');
    await panelFrames(20);
    await shot('4-library');
    check('the library shows the clips', true, await pjs(`document.querySelectorAll('#grid .clip').length + ' cards'`));
    const json = JSON.parse(fs.readFileSync(path.join(lib.dir, 'library.json'), 'utf8'));
    check('library.json lists them', json.clips.length === 2, json.clips.map((c) => c.f).join(', '));
    code = checks.every((c) => c.ok) ? 0 : 1;
  } catch (e) {
    check('self-test ran to the end', false, e.message);
    try { await shot('error'); } catch (_) { /* window gone */ }
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ok: code === 0, checks }, null, 2));
  h.log('selftest: ' + (code === 0 ? 'all passed' : 'FAILED'));
  h.app.exit(code);
};
