'use strict';
// Skip sponsor parts (switched on from the shield by the address bar): the "this video is sponsored by…", "smash
// that subscribe button" and plugs for the maker's own merch in YouTube videos, as marked by SponsorBlock's
// viewers. While watching, the video jumps over them, so they're never marked or grabbed; a whole YouTube video
// grabbed without marks comes down with them cut out (yt-dlp's --sponsorblock-remove, in engine.js).
const crypto = require('node:crypto');

const CATEGORIES = ['sponsor', 'selfpromo', 'interaction'];
const API = 'https://sponsor.ajay.app/api/skipSegments/';

// The YouTube video a page shows, or ''
function youtubeId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    if (h === 'youtu.be') return u.pathname.slice(1, 12);
    if (h !== 'youtube.com') return '';
    if (u.pathname === '/watch') return (u.searchParams.get('v') || '').slice(0, 11);
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
    return m ? m[1] : '';
  } catch (_) { return ''; }
}

function createSponsors({ fetch, log }) {
  const known = new Map();   // video id -> Promise of [[start, end], ...]
  // Asks by the first 4 letters of the video's fingerprint, so SponsorBlock never learns which video is watched
  function segments(id) {
    if (!known.has(id)) {
      const p = (async () => {
        const prefix = crypto.createHash('sha256').update(id).digest('hex').slice(0, 4);
        const r = await fetch(API + prefix + '?categories=' + encodeURIComponent(JSON.stringify(CATEGORIES)));
        if (r.status === 404) return [];
        if (!r.ok) throw new Error('SponsorBlock answered ' + r.status);
        const list = (await r.json()).find((v) => v.videoID === id);
        return list ? list.segments.map((s) => s.segment).filter((s) => Array.isArray(s) && s[1] - s[0] >= 1).sort((a, b) => a[0] - b[0]) : [];
      })().catch((e) => { log('sponsors: ' + e.message); known.delete(id); return []; });
      known.set(id, p);
      if (known.size > 200) known.delete(known.keys().next().value);
    }
    return known.get(id);
  }
  let skipped = new Set(), page = '';
  return {
    segments,
    // Where to jump the playing video to, or null. Each part is skipped once per visit to the page, so going back
    // into it on purpose (to see it) works.
    async jumpFor(url, video) {
      const id = youtubeId(url);
      if (id !== page) { page = id; skipped = new Set(); }
      if (!id || !video || video.paused) return null;
      const list = await segments(id);
      for (const s of list) {
        const key = s[0] + '-' + s[1];
        if (video.t >= s[0] && video.t < s[1] - 0.5 && !skipped.has(key)) {
          skipped.add(key);
          return Math.min(s[1], video.d > 0 ? video.d - 0.1 : s[1]);
        }
      }
      return null;
    },
  };
}

module.exports = { createSponsors, youtubeId, CATEGORIES };
