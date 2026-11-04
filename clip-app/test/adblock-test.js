'use strict';
// Quick checks of the ad blocker's site rules and Skip sponsor parts, without Electron or the internet:
// which site a page is on, Allow ads on this site, finding the YouTube video on a page, and jumping over a
// sponsor part once (with SponsorBlock's answer made up here).
const assert = require('node:assert');
const { hostOf, allowedIn } = require('../src/adblock.js');
const { createSponsors, youtubeId } = require('../src/sponsors.js');

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
};

(async () => {
  await check('the site of a page', () => {
    assert.strictEqual(hostOf('https://www.youtube.com/watch?v=abc'), 'youtube.com');
    assert.strictEqual(hostOf('https://giphy.com/gifs/x'), 'giphy.com');
    assert.strictEqual(hostOf('file:///C:/start/index.html'), '');
  });
  await check('Allow ads on a site covers its parts, not look-alikes', () => {
    assert.ok(allowedIn(['youtube.com'], 'm.youtube.com'));
    assert.ok(allowedIn(['youtube.com'], 'youtube.com'));
    assert.ok(!allowedIn(['youtube.com'], 'notyoutube.com'));
    assert.ok(!allowedIn(['youtube.com'], ''));
  });
  await check('the YouTube video on a page', () => {
    assert.strictEqual(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s'), 'dQw4w9WgXcQ');
    assert.strictEqual(youtubeId('https://youtu.be/dQw4w9WgXcQ?si=x'), 'dQw4w9WgXcQ');
    assert.strictEqual(youtubeId('https://m.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.strictEqual(youtubeId('https://vimeo.com/123'), '');
  });
  await check('a sponsor part is jumped over once, and only while playing', async () => {
    const asked = [];
    const fetch = async (url) => {
      asked.push(url);
      return { ok: true, status: 200, json: async () => [
        { videoID: 'someoneelse', segments: [{ segment: [1, 50] }] },
        { videoID: 'dQw4w9WgXcQ', segments: [{ segment: [60, 90.5], category: 'sponsor' }, { segment: [10, 10.4] }] },
      ] };
    };
    const sp = createSponsors({ fetch, log: () => {} });
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    assert.strictEqual(await sp.jumpFor(url, { t: 30, d: 200, paused: false }), null);
    assert.strictEqual(await sp.jumpFor(url, { t: 61, d: 200, paused: true }), null, 'paused: no jump');
    assert.strictEqual(await sp.jumpFor(url, { t: 61, d: 200, paused: false }), 90.5);
    assert.strictEqual(await sp.jumpFor(url, { t: 62, d: 200, paused: false }), null, 'going back into it on purpose works');
    assert.strictEqual(await sp.jumpFor(url, { t: 10.1, d: 200, paused: false }), null, 'parts under a second are left');
    assert.strictEqual(asked.length, 1, 'asked SponsorBlock once');
    assert.ok(!asked[0].includes('dQw4w9WgXcQ'), 'SponsorBlock isn\u2019t told which video');
    assert.match(asked[0], /skipSegments\/[0-9a-f]{4}\?categories=/);
  });
  await check('SponsorBlock out of reach: the video just plays', async () => {
    const sp = createSponsors({ fetch: async () => { throw new Error('offline'); }, log: () => {} });
    assert.strictEqual(await sp.jumpFor('https://youtu.be/dQw4w9WgXcQ', { t: 61, d: 200, paused: false }), null);
  });
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
