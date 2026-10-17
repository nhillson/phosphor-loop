'use strict';
window.PhosphorHelpers = (() => {
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function hsv(h, s, v) {
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
function foldJS(x, y, n) {
  if (n < 1) return [x, y];
  if (n < 3) return [Math.abs(x), y];
  if (n < 5) return [Math.abs(x), Math.abs(y)];
  const seg = Math.PI * 2 / n;
  let a = Math.atan2(y, x);
  a = ((a % seg) + seg) % seg;
  a = Math.abs(a - seg / 2);
  const r = Math.hypot(x, y);
  return [r * Math.cos(a), r * Math.sin(a)];
}
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function randId(n) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const x of r) s += a[x % a.length];
  return s;
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}


return { clamp, rnd, pick, hsv, foldJS, stamp, randId, loadScript };
})();
