'use strict';
// The picture recogniser, in a process of its own so it never slows the window down. It is OpenAI's CLIP (the
// small "ViT-B/32" version, 8-bit, about 90 MB, downloaded once from Hugging Face into the app's data folder) run
// by Transformers.js on the processor. Given a few frames of a clip and a sentence per category ("a video of fire,
// flames, sparks..."), it says how well each sentence fits the frames.
//
// The model's files are downloaded here, each to a temporary name and renamed once it's complete, and only then
// handed to Transformers.js with downloading switched off. (Left to itself, Transformers.js could open the model
// on Windows while it was still being written, and Windows refuses that: "system error number 13".)
//
// Messages in:  { type: 'warm', cacheDir }  |  { type: 'classify', id, cacheDir, frames: [jpg paths], labels: [{id, prompt}] }
// Messages out: { type: 'status', text, pct }  |  { type: 'ready' }  |  { type: 'error', id?, message }
//               { type: 'result', id, scores: {categoryId: share} }   (shares add up to 1)
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const port = process.parentPort || {
  on: (ev, cb) => process.on('message', (m) => cb({ data: m })),
  postMessage: (m) => { if (process.send) process.send(m); },
};
const MODEL = process.env.CLIPS_VISION_MODEL || 'Xenova/clip-vit-base-patch32';
const HUB = (process.env.CLIPS_VISION_HUB || 'https://huggingface.co').replace(/\/+$/, '');
// [file, needed]: the files Transformers.js reads for CLIP's zero-shot pipeline
const FILES = [
  ['config.json', true], ['preprocessor_config.json', true], ['tokenizer.json', true], ['tokenizer_config.json', true],
  ['special_tokens_map.json', false], ['onnx/model_quantized.onnx', true],
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const status = (text, pct) => port.postMessage({ type: 'status', text, pct });

async function exists(p) { try { return (await fsp.stat(p)).size > 0; } catch (_) { return false; } }

// Downloads whatever isn't on disk yet. A file only gets its real name once all of it is there.
async function download(dir) {
  const missing = [];
  for (const [f, needed] of FILES) {
    if (await exists(path.join(dir, f))) continue;
    if (!needed && (await exists(path.join(dir, f + '.none')))) continue;
    missing.push([f, needed]);
  }
  if (!missing.length) return;
  const sizes = {}, got = {};
  let lastSent = -1;
  const report = () => {
    const all = Object.values(sizes).reduce((a, b) => a + b, 0);
    const have = Object.values(got).reduce((a, b) => a + b, 0);
    const pct = all ? Math.floor((100 * have) / all) : 0;
    if (pct !== lastSent) { lastSent = pct; status('Getting the picture recogniser (first time only)', pct); }
  };
  for (const [f, needed] of missing) {
    const dest = path.join(dir, f);
    const part = dest + '.part';
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    let lastErr = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(`${HUB}/${MODEL}/resolve/main/${f}`, { redirect: 'follow' });
        if (res.status === 404 && !needed) { await fsp.writeFile(dest + '.none', ''); lastErr = null; break; }
        if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + f);
        sizes[f] = +res.headers.get('content-length') || 0;
        got[f] = 0;
        const out = fs.createWriteStream(part);
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          got[f] += chunk.length;
          if (sizes[f] > 1e6) report();
        }
        // 'close' comes once Windows has let go of the file, so it can be renamed
        await new Promise((r, j) => { out.once('error', j); out.once('close', r); out.end(); });
        if (sizes[f] && got[f] !== sizes[f]) throw new Error(`${f} came down incomplete (${got[f]} of ${sizes[f]} bytes)`);
        await fsp.rename(part, dest);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await fsp.rm(part, { force: true }).catch(() => {});
        if (attempt < 4) await wait(2000 * attempt);
      }
    }
    if (lastErr) throw new Error('Couldn’t download the picture recogniser: ' + lastErr.message);
  }
}

let loading = null;
function load(cacheDir) {
  if (!loading) {
    loading = (async () => {
      const dir = path.join(cacheDir, ...MODEL.split('/'));
      await download(dir);
      const t = await import('@huggingface/transformers');
      t.env.allowRemoteModels = false;
      t.env.allowLocalModels = true;
      t.env.localModelPath = cacheDir + path.sep;
      t.env.useFSCache = false;
      t.env.cacheDir = cacheDir;
      // Windows can briefly hold a new file (an antivirus scan, say): try again a few times before giving up
      let clf = null, lastErr = null;
      for (let attempt = 1; attempt <= 5 && !clf; attempt++) {
        try {
          clf = await t.pipeline('zero-shot-image-classification', MODEL, { dtype: 'q8', device: 'cpu', local_files_only: true });
        } catch (e) {
          lastErr = e;
          if (attempt < 5) await wait(1500 * attempt);
        }
      }
      if (!clf) throw lastErr;
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
