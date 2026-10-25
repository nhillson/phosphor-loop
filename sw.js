// Phosphor Loop keeps a copy of itself in the browser, so after one visit it opens without internet.
// Online, every file is fetched fresh and the copy updated; offline, or on a very slow network, the copy is used.
const CACHE = 'pl-v12-subject';
const NATURE = 'pl-nature';   // nature pictures seen so far, or all of them via Show setup; kept when the app updates
const APP = ['./', 'index.html', 'phone.html', 'qrcode.js', 'icon-180.png', 'icon-192.png', 'nature/pictures.json', 'styles/base.css', 'styles/app.css', 'js/fractal-math.js', 'js/shaders.js', 'js/helpers.js', 'js/recording-formats.js', 'js/output-template.js', 'js/ribbit.js', 'js/app.js', 'js/silhouette.js', 'js/subject.js', 'static/silhouette-mask-v2.mp4', 'js/step-sequencer.js', 'js/spotify.js', 'js/audio/beat-clock.js', 'js/audio/rhythm.js', 'js/audio/rhythm-worklet.js', 'js/audio/tempo-worker.js', 'vendor/essentia/essentia-wasm.es.js', 'vendor/essentia/essentia.js-core.es.js', 'vendor/essentia/LICENSE', 'vendor/essentia/README.md'];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Michroma&family=VT323&display=swap';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const SLOW_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP.map((u) => new Request(u, { cache: 'reload' })));
    // The fonts come from Google; save the stylesheet and every font file it names
    try {
      const res = await fetch(FONT_CSS, { mode: 'cors' });
      if (res.ok) {
        const css = await res.clone().text();
        await cache.put(FONT_CSS, res);
        const files = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];
        await Promise.all(files.map((u) => fetch(u, { mode: 'cors' })
          .then((r) => (r.ok ? cache.put(u, r) : null)).catch(() => null)));
      }
    } catch (_) { /* without them the page falls back to the computer's own fonts */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE && key !== NATURE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) { event.respondWith(cacheFirst(req)); return; }
  if (url.origin === self.location.origin && url.pathname.endsWith('/static/silhouette-mask-v2.mp4')) { event.respondWith(silhouetteVideo(req, url)); return; }
  if (url.origin !== self.location.origin) return;   // the phone link's servers and anything else go straight out
  if (/\/nature\/[^/]+\.jpg$/.test(url.pathname)) { event.respondWith(natureFirst(req, url)); return; }
  event.respondWith(networkFirst(event, req, url));
});

// A nature picture never changes, so once seen it's kept (in its own store) and served from there
async function natureFirst(req, url) {
  const key = new URL(url.pathname, url.origin).href;
  const cache = await caches.open(NATURE);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch (_) {
    return Response.error();
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  } catch (_) {
    return Response.error();
  }
}

function networkFirst(event, req, url) {
  const key = new URL(url.pathname, url.origin).href;   // ?show=1 and the like share one copy
  const cacheP = caches.open(CACHE);
  const network = fetch(req);
  // Refresh the saved copy whenever the network answers, even if the saved one was served first
  event.waitUntil(network.then((res) => {
    if (!res.ok || res.type !== 'basic') return null;
    const copy = res.clone();
    return cacheP.then((c) => c.put(key, copy));
  }).catch(() => null));
  return (async () => {
    const cache = await cacheP;
    const slow = new Promise((resolve) => setTimeout(resolve, SLOW_MS, null));
    let res = null;
    try { res = await Promise.race([network, slow]); } catch (_) { res = null; }
    if (res && res.ok) return res;
    const hit = (await cache.match(key)) || (await caches.match(key));
    if (hit) return hit;
    return res || network;   // nothing saved yet, so wait for the network after all
  })();
}

// A cached full matte can answer media byte-range requests even while offline.
async function silhouetteVideo(req, url) {
  const key = url.href, cache = await caches.open(CACHE);
  let full = await cache.match(key);
  if (!full) {
    try {
      full = await fetch(key);
      if (full.ok && full.status === 200) await cache.put(key, full.clone());
    } catch (_) { return Response.error(); }
  }
  const range = req.headers.get('Range');
  if (!range || full.status !== 200) return full;
  const bytes = await full.arrayBuffer(), size = bytes.byteLength;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const invalid = () => new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + size}});
  if (!match || (!match[1] && !match[2])) return invalid();
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return invalid();
  return new Response(bytes.slice(start, end + 1), {status: 206, headers: {
    'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1),
  }});
}
