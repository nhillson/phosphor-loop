// Subject silhouette: Google's MediaPipe person finder outlines the main person in a video, camera, screen or phone
// picture, every frame, right on this computer. The finder (about 11 MB) loads the first time a loop turns it on.
(() => {
  const BASE = new URL('vendor/mediapipe/', document.baseURI).href;
  const FIND = 256;   // the finder looks at a copy this size on its long side
  const OUT = 960;    // and the finished picture is at most this size on its long side
  const MODES = ['shadow', 'glow', 'cutout'];
  let seg = null, loading = null, failed = '', lastTs = 0;

  function load() {
    loading ||= (async () => {
      const { ImageSegmenter } = await import(BASE + 'vision_bundle.mjs');
      seg = await ImageSegmenter.createFromOptions(
        { wasmLoaderPath: BASE + 'vision_wasm_internal.js', wasmBinaryPath: BASE + 'vision_wasm_internal.wasm' },
        { baseOptions: { modelAssetPath: BASE + 'selfie_segmenter.tflite', delegate: 'CPU' },
          runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
    })().catch((e) => {
      console.warn('Subject silhouette:', e);
      failed = 'The person finder could not load. Check the internet connection, then reload the page.';
    });
    return loading;
  }
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const fit = (w, h, max) => { const s = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; };

  // One per live source: finds the person in each new frame, then draws it the way each loop wants
  class Cutter {
    constructor() {
      this.find = canvas(1, 1); this.fg = this.find.getContext('2d', { willReadFrequently: true });
      this.white = canvas(1, 1); this.black = canvas(1, 1); this.out = canvas(1, 1);
      this.og = this.out.getContext('2d');
      this.conf = null; this.ready = false;
    }
    // Finds the person in this frame; false until the finder has loaded (or if it failed)
    segment(video) {
      if (!seg) { load(); return false; }
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return false;
      const [fw, fh] = fit(vw, vh, FIND);
      if (this.find.width !== fw || this.find.height !== fh) {
        for (const c of [this.find, this.white, this.black]) { c.width = fw; c.height = fh; }
        this.conf = new Float32Array(fw * fh); this.ready = false;
      }
      const [ow, oh] = fit(vw, vh, OUT);
      if (this.out.width !== ow || this.out.height !== oh) { this.out.width = ow; this.out.height = oh; }
      this.fg.drawImage(video, 0, 0, fw, fh);
      lastTs = Math.max(performance.now(), lastTs + 1);   // the finder needs every frame later than the one before
      let res;
      try { res = seg.segmentForVideo(this.find, lastTs); } catch (e) { console.warn('Subject silhouette:', e); return false; }
      try {
        const m = res.confidenceMasks && res.confidenceMasks[0];
        if (!m || m.width !== fw || m.height !== fh) return false;
        const p = m.getAsFloat32Array(), conf = this.conf, fresh = !this.ready;
        const wd = new ImageData(fw, fh), bd = new ImageData(fw, fh), W = wd.data, B = bd.data;
        for (let i = 0; i < p.length; i++) {
          // A little of the last frame's outline is kept, so the edge doesn't shimmer
          const c = conf[i] = fresh ? p[i] : conf[i] * 0.3 + p[i] * 0.7;
          const x = Math.min(1, Math.max(0, (c - 0.3) / 0.4)), a = Math.round(255 * x * x * (3 - 2 * x));
          const j = i * 4;
          W[j] = W[j + 1] = W[j + 2] = 255; W[j + 3] = a;
          B[j + 3] = a;
        }
        this.white.getContext('2d').putImageData(wd, 0, 0);
        this.black.getContext('2d').putImageData(bd, 0, 0);
        this.ready = true;
        return true;
      } finally { res.close(); }
    }
    // The finished picture for one look: Shadow (a black figure), Glow (a white figure) or Cutout (the person as
    // they are). Everything around the person is see-through, so the loop lays the figure over the other input and
    // the trails (see uCutout in js/shaders.js). Draw it into a texture straight away; the next look reuses the canvas.
    render(mode, video) {
      const g = this.og, w = this.out.width, h = this.out.height;
      g.globalCompositeOperation = 'source-over';
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, w, h);
      if (mode === 'shadow') g.drawImage(this.black, 0, 0, w, h);
      else if (mode === 'glow') g.drawImage(this.white, 0, 0, w, h);
      else {
        g.drawImage(video, 0, 0, w, h);
        g.globalCompositeOperation = 'destination-in'; g.drawImage(this.white, 0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      }
      return this.out;
    }
  }
  function status() {
    if (failed) return failed;
    if (!seg) return 'Loading the person finder (about 11 MB, the first time)…';
    return 'Finding the person in every frame, on this computer.';
  }
  globalThis.PhosphorSubject = { Cutter, MODES, load, status, get loaded() { return !!seg; } };
})();
