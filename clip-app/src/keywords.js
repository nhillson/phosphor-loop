'use strict';
// Guessing a clip's category from words: the video's title, tags, site categories, description and the page it
// came from. Each category's words are counted (title and tags count most), and the counts become shares that add
// up to 1. This is the quick guess; the picture recogniser (vision.js) looks at the clip itself.
const { wordsFor } = require('./categories.js');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// How often each of a category's words appears in the text, as whole words (so "art" doesn't match "start")
function countWords(text, words) {
  let n = 0;
  for (const w of words) {
    const re = new RegExp('(^|[^a-z0-9])' + esc(w.toLowerCase()) + '(s|es)?(?=$|[^a-z0-9])', 'g');
    const m = text.match(re);
    if (m) n += m.length;
  }
  return n;
}

// info: what yt-dlp says about the video (title, tags, categories, description...), plus page (the page's title)
// Returns { scores: {id: share}, best: id or '', strength: how many word hits the best one had }
function guessFromText(info, cats) {
  const parts = [
    [3, [info.title, info.page, info.fulltitle].filter(Boolean).join(' ')],
    [3, (info.tags || []).join(' , ')],
    [2, (info.categories || []).join(' , ')],
    [1, String(info.description || '').slice(0, 1500)],
    [1, String(info.url || '').replace(/[-_/.]+/g, ' ')],
  ];
  const raw = {};
  let total = 0;
  for (const c of cats) {
    const words = wordsFor(c);
    if (!words.length) continue;
    let s = 0;
    for (const [weight, text] of parts) if (text) s += weight * countWords(' ' + text.toLowerCase() + ' ', words);
    raw[c.id] = s;
    total += s;
  }
  const scores = {};
  let best = '', top = 0;
  for (const [id, s] of Object.entries(raw)) {
    scores[id] = total ? s / total : 0;
    if (s > top) { top = s; best = id; }
  }
  return { scores, best, strength: top };
}

module.exports = { guessFromText, countWords };
