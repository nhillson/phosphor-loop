// Phosphor Loop keeps a copy of itself in the browser, so after one visit it opens without internet.
// Online, every file is fetched fresh and the copy updated; offline, or on a very slow network, the copy is used.
const CACHE = 'pl-v1';
const APP = ['./', 'index.html', 'phone.html', 'qrcode.js', 'icon-180.png', 'icon-192.png'];
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
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) { event.respondWith(cacheFirst(req)); return; }
  if (url.origin !== self.location.origin) return;   // the phone link's servers and anything else go straight out
  event.respondWith(networkFirst(event, req, url));
});

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
    const hit = await cache.match(key);
    if (hit) return hit;
    return res || network;   // nothing saved yet, so wait for the network after all
  })();
}
