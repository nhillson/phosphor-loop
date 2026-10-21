'use strict';
// The picture recogniser, in a process of its own so it never slows the window down. It is OpenAI's CLIP (the
// small "ViT-B/32" version, 8-bit, about 150 MB, downloaded once from Hugging Face into the app's data folder) run
// by Transformers.js on the processor. Given a few frames of a clip and a sentence per category ("a video of fire,
// flames, sparks..."), it says how well each sentence fits the frames.
//
// Messages in:  { type: 'warm', cacheDir }  |  { type: 'classify', id, cacheDir, frames: [jpg paths], labels: [{id, prompt}] }
// Messages out: { type: 'status', text, pct }  |  { type: 'ready' }  |  { type: 'error', id?, message }
//               { type: 'result', id, scores: {categoryId: share} }   (shares add up to 1)

const port = process.parentPort || {
  on: (ev, cb) => process.on('message', (m) => cb({ data: m })),
  postMessage: (m) => { if (process.send) process.send(m); },
};
const MODEL = process.env.CLIPS_VISION_MODEL || 'Xenova/clip-vit-base-patch32';

let loading = null;
function load(cacheDir) {
  if (!loading) {
    loading = (async () => {
      const t = await import('@huggingface/transformers');
      if (cacheDir) t.env.cacheDir = cacheDir;
      t.env.allowLocalModels = false;
      const seen = {};
      const clf = await t.pipeline('zero-shot-image-classification', MODEL, {
        dtype: 'q8',
        device: 'cpu',
        progress_callback: (p) => {
          if (p.status !== 'progress' || !p.total) return;
          seen[p.file] = [p.loaded || 0, p.total];
          let got = 0, all = 0;
          for (const [g, a] of Object.values(seen)) { got += g; all += a; }
          if (all > 5e6) port.postMessage({ type: 'status', text: 'Getting the picture recogniser (first time only)', pct: (100 * got) / all });
        },
      });
      port.postMessage({ type: 'ready' });
      return clf;
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

port.on('message', async (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'warm') { await load(m.cacheDir); return; }
    if (m.type !== 'classify') return;
    const clf = await load(m.cacheDir);
    const labels = (m.labels || []).filter((l) => l.prompt);
    if (labels.length < 2 || !(m.frames || []).length) { port.postMessage({ type: 'result', id: m.id, scores: {} }); return; }
    const sum = Object.fromEntries(labels.map((l) => [l.id, 0]));
    const byPrompt = new Map(labels.map((l) => [l.prompt, l.id]));
    let n = 0;
    for (const f of m.frames) {
      const out = await clf(f, labels.map((l) => l.prompt), { hypothesis_template: '{}' });
      for (const o of out) { const id = byPrompt.get(o.label); if (id) sum[id] += o.score; }
      n++;
    }
    for (const k of Object.keys(sum)) sum[k] /= n || 1;
    port.postMessage({ type: 'result', id: m.id, scores: sum });
  } catch (err) {
    port.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err).slice(0, 500) });
  }
});
