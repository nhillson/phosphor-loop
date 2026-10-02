// Phosphor Loop check for Nick's own computer, run by Claude inside the Claude app's built-in browser
// (its javascript tool runs this file's text as-is; top-level await works there). It needs the browser
// panel to be showing: while the panel is hidden the page is paused and draws no frames.
//
// Every wait is a number of frames the app draws, never seconds. The only time limit is a ceiling for
// when the page isn't drawing at all, so a paused or broken page answers within a few seconds.
//
// Change these two lines before running:
//   FRAMES  how many frames to let the picture build before reporting (60 = one second on a 60 Hz screen)
//   RECIPE  a Guide recipe to press first (exact name, e.g. 'Currents'), or '' to leave the picture as it is
const FRAMES = 120, RECIPE = '';

await (async () => {
  const out = { page: document.visibilityState };
  const waitFrames = (n) => new Promise((done) => {
    let seen = 0;
    const t0 = performance.now();
    const tick = () => { if (++seen >= n) done({ seen, sec: (performance.now() - t0) / 1000 }); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    // Not a wait: a ceiling. A healthy page finishes long before it; a paused one gets reported.
    setTimeout(() => done({ seen, sec: (performance.now() - t0) / 1000, stalled: true }), 5000 + n * 100);
  });
  const banner = () => { const m = document.getElementById('msg'); return m && !m.hidden ? m.textContent : null; };

  if (RECIPE) {
    const card = [...document.querySelectorAll('.g-recipe')].find((x) => x.querySelector('h3').textContent === RECIPE);
    const btn = card && card.querySelector('button');
    if (!btn) return { problem: `no Guide recipe called "${RECIPE}"` };
    btn.click();
    document.getElementById('clear').click();
  }
  const w = await waitFrames(FRAMES);
  out.framesDrawn = w.seen;
  out.framesPerSecond = Math.round(w.seen / Math.max(w.sec, 0.001));
  if (w.stalled) out.problem = w.seen === 0 && document.visibilityState === 'hidden'
    ? 'the browser panel is hidden, so the page is paused (show it with Ctrl+Shift+B in the Claude app)'
    : `the page stopped drawing after ${w.seen} of ${FRAMES} frames`;
  out.errorOnScreen = banner();

  // How bright the picture is, read straight off the screen canvas right after a frame is drawn
  out.brightness = await Promise.race([new Promise((res) => requestAnimationFrame(() => {
    const s = document.getElementById('screen'), c = document.createElement('canvas');
    c.width = 160; c.height = Math.round(160 * s.height / Math.max(s.width, 1));
    const g = c.getContext('2d');
    g.drawImage(s, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    res(Math.round(sum / (d.length / 4)));
  })), new Promise((res) => setTimeout(() => res(null), 3000))]);
  if (!out.problem && out.brightness !== null && out.brightness < 3) out.problem = 'the picture is black';

  const gl = document.getElementById('screen').getContext('webgl2');
  const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
  out.graphics = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  out.result = out.problem || out.errorOnScreen ? 'FAIL' : 'PASS';
  return out;
})();
