'use strict';
// Talks to the picture recogniser (vision-worker.js) and turns its view and the words around the video into one
// suggested category. start(fork): fork(scriptPath) must return { postMessage, on('message', cb), kill } (Electron's
// utilityProcess in the app, child_process.fork in tests).
const path = require('node:path');
const { promptFor } = require('./categories.js');
const { guessFromText } = require('./keywords.js');

class Vision {
  constructor({ fork, cacheDir, log, onStatus }) {
    this.fork = fork;
    this.cacheDir = cacheDir;
    this.log = log || (() => {});
    this.onStatus = onStatus || (() => {});
    this.proc = null;
    this.waiting = new Map();
    this.seq = 0;
    this.ready = false;
    this.broken = '';
  }

  ensure() {
    if (this.proc) return this.proc;
    this.proc = this.fork(path.join(__dirname, 'vision-worker.js'));
    this.proc.on('message', (m) => this.onMessage(m && m.data !== undefined && m.type === undefined ? m.data : m));
    if (this.proc.on) {
      this.proc.on('exit', (code) => {
        this.log('vision: worker ended (' + code + ')');
        this.proc = null;
        this.ready = false;
        for (const [, w] of this.waiting) w.reject(new Error('The picture recogniser stopped.'));
        this.waiting.clear();
      });
    }
    return this.proc;
  }

  onMessage(m) {
    if (!m) return;
    if (m.type === 'status') { this.onStatus({ text: m.text, pct: m.pct }); return; }
    if (m.type === 'ready') { this.ready = true; this.broken = ''; this.onStatus({ text: '', pct: 100, ready: true }); this.log('vision: ready'); return; }
    const w = this.waiting.get(m.id);
    if (m.type === 'error') {
      this.log('vision: ' + m.message);
      // Couldn't even start (no internet for the first download, say): suggestions come from words until it can
      if (!this.ready) { this.broken = m.message; this.onStatus({ text: '', error: m.message }); }
      if (w) { this.waiting.delete(m.id); w.reject(new Error(m.message)); }
      return;
    }
    if (m.type === 'result' && w) { this.waiting.delete(m.id); w.resolve(m.scores || {}); }
  }

  warm() {
    try { this.ensure().postMessage({ type: 'warm', cacheDir: this.cacheDir }); } catch (e) { this.broken = e.message; this.log('vision: ' + e.message); }
  }

  // frames: jpg paths; cats: the library's categories. Resolves {categoryId: share}, or rejects.
  classify(frames, cats, { timeoutMs = 10 * 60 * 1000 } = {}) {
    const labels = cats.map((c) => ({ id: c.id, prompt: promptFor(c) })).filter((l) => l.prompt);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      let proc;
      try { proc = this.ensure(); } catch (e) { reject(e); return; }
      const t = setTimeout(() => { if (this.waiting.delete(id)) reject(new Error('The picture recogniser took too long.')); }, timeoutMs);
      this.waiting.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      proc.postMessage({ type: 'classify', id, cacheDir: this.cacheDir, frames, labels });
    });
  }

  stop() { try { if (this.proc) this.proc.kill(); } catch (_) { /* gone */ } this.proc = null; }
}

// One suggestion from the picture's view (most weight) and the words'. Returns
// { id: suggested category or '', sure: 0..1, by: 'picture'|'words'|'both'|'', scores }
function combine(visionScores, info, cats) {
  const words = guessFromText(info || {}, cats);
  const v = visionScores && Object.keys(visionScores).length ? visionScores : null;
  const ids = cats.map((c) => c.id).filter((id) => id !== 'other');
  const scores = {};
  for (const id of ids) {
    const pv = v ? v[id] || 0 : 0;
    const pw = words.scores[id] || 0;
    // Words only count when there are a few of them; one stray word shouldn't outvote the picture
    const ww = words.strength >= 3 ? 0.35 : words.strength >= 1 ? 0.15 : 0;
    scores[id] = v ? (1 - ww) * pv + ww * pw : pw;
  }
  let best = '', top = 0, second = 0;
  for (const [id, s] of Object.entries(scores)) {
    if (s > top) { second = top; top = s; best = id; } else if (s > second) second = s;
  }
  // How sure: high when one category clearly leads
  const sure = v ? Math.min(1, top * 1.4 + (top - second)) : Math.min(1, words.strength / 6);
  if (!best || (v && top < 0.18) || (!v && words.strength < 1)) return { id: '', sure: 0, by: '', scores };
  const by = v && words.strength >= 1 && words.best === best ? 'both' : v ? 'picture' : 'words';
  return { id: best, sure: Math.round(sure * 100) / 100, by, scores };
}

module.exports = { Vision, combine };
