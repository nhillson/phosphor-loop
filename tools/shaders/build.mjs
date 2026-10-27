// Builds the built-in shader collection (shaders/index.json, shaders/isf/, shaders/st/).
// Usage: node tools/shaders/build.mjs <folder of ISF .fs files, e.g. a checkout of github.com/Vidvox/ISF-Files/ISF>
// Each candidate is compiled and drawn for a few frames in a real browser with js/shaderhost.js; only shaders that
// compile, draw something and whose licence allows it go in. Shadertoy-style originals in shaders/st/ go in as they are
// (they must pass the same check). CHROME_PATH picks the browser.
import {chromium} from 'playwright-core';
import {readFile, writeFile, readdir, mkdir, rm, copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = process.argv[2];
if (!SRC) { console.error('Give the folder of ISF .fs files.'); process.exit(1); }
// Files whose own notes say they come from Shadertoy or carry a non-commercial licence stay out
const LICENCE = /shadertoy|creative commons|cc by|noncommercial|non-commercial/i;
// Transitions need two pictures to blend between; utilities are tools rather than looks
const SKIP_CATS = new Set(['Wipe', 'Dissolve', 'Utility', 'Transition']);
const slug = (s) => s.toLowerCase().replace(/\.fs$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const host = await readFile(path.join(ROOT, 'js/shaderhost.js'), 'utf8');
globalThis.eval(host);
const {parse} = globalThis.PhosphorShaderHost;

const cands = [];
for (const f of (await readdir(SRC)).filter((f) => f.endsWith('.fs')).sort()) {
  const code = await readFile(path.join(SRC, f), 'utf8');
  const name = f.replace(/\.fs$/, '');
  if (LICENCE.test(code)) continue;
  if (existsSync(path.join(SRC, name + '.vs'))) continue;   // needs its own vertex shader
  const d = parse(code, name);
  if (d.error || d.imports) continue;
  if (d.categories.some((c) => SKIP_CATS.has(c))) continue;
  if (d.inputs.some((i) => i.type === 'image' && i.name !== 'inputImage')) continue;
  cands.push({ id: 'isf/' + slug(f), file: 'isf/' + slug(f) + '.fs', name, kind: 'isf', role: d.filter ? 'effect' : 'input',
    cats: d.categories.filter((c) => !/^v002$/i.test(c)), credit: d.credit, audio: d.audio, code });
}
for (const f of (await readdir(path.join(ROOT, 'shaders/st'))).filter((f) => f.endsWith('.glsl')).sort()) {
  const code = await readFile(path.join(ROOT, 'shaders/st', f), 'utf8');
  const first = (code.match(/^\/\/\s*([^:\n]+)(?:\s*\(effect\))?:/) || [])[1] || f;
  cands.push({ id: 'st/' + f.replace(/\.glsl$/, ''), file: 'st/' + f, name: first.replace(/\s*\(effect\)$/, ''), kind: 'shadertoy',
    role: /iChannel1/.test(code) ? 'effect' : 'input', cats: ['Phosphor Loop'], credit: 'Phosphor Loop', audio: /iChannel0/.test(code), code });
}
console.log(`${cands.length} candidates`);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setContent('<canvas id="c" width="160" height="90"></canvas>');
await page.addScriptTag({ content: host });
const results = await page.evaluate(async (list) => {
  const gl = document.getElementById('c').getContext('webgl2');
  const float = !!gl.getExtension('EXT_color_buffer_float');
  const tex = (w, h, fill) => {
    const t = gl.createTexture(), d = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) fill(d, i * 4, i % w, Math.floor(i / w));
    gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  };
  const noise = tex(256, 256, (d, o) => { d[o] = Math.random() * 255; d[o + 1] = Math.random() * 255; d[o + 2] = Math.random() * 255; d[o + 3] = 255; });
  const image = tex(160, 90, (d, o, x, y) => { d[o] = x * 1.6; d[o + 1] = y * 2.8; d[o + 2] = ((x >> 3) ^ (y >> 3)) & 1 ? 230 : 40; d[o + 3] = 255; });
  const audio = tex(512, 2, (d, o, x) => { const v = 200 * Math.exp(-x / 90); d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; });
  const out = [];
  const px = new Uint8Array(160 * 90 * 4);
  for (const c of list) {
    gl.getError();   // nothing left over from the one before
    const d = PhosphorShaderHost.parse(c.code, c.name);
    if (d.error) { out.push({ id: c.id, ok: false, why: d.error }); continue; }
    const h = new PhosphorShaderHost.ShaderHost(gl, d, float);
    if (h.error) { out.push({ id: c.id, ok: false, why: h.error }); continue; }
    let t = null;
    for (let f = 0; f < 4; f++) t = h.render({ w: 160, h: 90, time: 1.5 + f / 30, dt: 1 / 30, values: {}, audio, fft: audio, wave: audio, image, noise, pic: image, mouse: [0.5, 0.5, 0, 0] });
    const err = gl.getError();
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.readPixels(0, 0, 160, 90, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.deleteFramebuffer(fb);
    let sum = 0, sum2 = 0, top = 0;
    for (let i = 0; i < px.length; i += 4) { const v = (px[i] + px[i + 1] + px[i + 2]) / 3; sum += v; sum2 += v * v; if (v > top) top = v; }
    const n = px.length / 4, mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    h.dispose();
    out.push({ id: c.id, ok: !err && (mean > 3 || top > 60), why: err ? 'GL error ' + err : 'draws black', mean, sd });
  }
  return out;
}, cands.map(({ id, name, code }) => ({ id, name, code })));
await browser.close();

const ok = new Set(results.filter((r) => r.ok).map((r) => r.id));
for (const r of results.filter((r) => !r.ok)) console.log('left out', r.id, '-', String(r.why).slice(0, 120));
// A preview picture of each one for the library: a couple of seconds into its own time, effects shown on a nature photo
const keepers = cands.filter((c) => ok.has(c.id));
const photo = 'data:image/jpeg;base64,' + (await readFile(path.join(ROOT, 'nature/american-flamingo.jpg'))).toString('base64');
const browser2 = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page2 = await browser2.newPage();
await page2.setContent('<canvas id="c" width="240" height="180"></canvas>');
await page2.addScriptTag({ content: host });
const thumbs = await page2.evaluate(async ({ list, photo }) => {
  const gl = document.getElementById('c').getContext('webgl2');
  const W = 240, H = 180, float = !!gl.getExtension('EXT_color_buffer_float');
  const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = photo; });
  const pt = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, pt); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const mk = (w, h, fill) => {
    const t = gl.createTexture(), d = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) fill(d, i * 4, i % w, Math.floor(i / w));
    gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  };
  const noise = mk(256, 256, (d, o) => { for (let k = 0; k < 4; k++) d[o + k] = Math.random() * 255; });
  // Music that looks like music: a strong low end, a few peaks, a waveform with some shape
  const audio = mk(512, 2, (d, o, x, y) => {
    const v = y === 0 ? 235 * Math.exp(-x / 70) + 60 * Math.max(0, Math.sin(x / 9)) * Math.exp(-x / 200) : 128 + 90 * Math.sin(x / 11) * Math.sin(x / 47);
    d[o] = d[o + 1] = d[o + 2] = Math.min(255, v); d[o + 3] = 255;
  });
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'), out = {};
  const shot = (code, name, values) => {
    const d = PhosphorShaderHost.parse(code, name), h = new PhosphorShaderHost.ShaderHost(gl, d, float);
    if (h.error) return null;
    let t = null;
    for (let f = 0; f < 45; f++) t = h.render({ w: W, h: H, time: 1.2 + f / 30, dt: 1 / 30, values, audio, fft: audio, wave: audio, image: pt, noise, pic: pt, mouse: [0.5, 0.5, 0, 0] });
    const px = new Uint8Array(W * H * 4), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.deleteFramebuffer(fb); h.dispose();
    return { px, d };
  };
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 16) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 16); };
  // The plain photo, to see how much an effect changes it
  const plain = shot('/*{"INPUTS":[{"NAME":"inputImage","TYPE":"image"}]}*/ void main() { gl_FragColor = IMG_THIS_PIXEL(inputImage); }', 'plain', {}).px;
  for (const c of list) {
    const first = shot(c.code, c.name, {});
    if (!first) continue;
    let px = first.px;
    // An effect that hardly shows at its starting settings is shown with them turned up (whichever shows more)
    if (first.d.filter && diff(px, plain) < 25) {
      const up = {};
      for (const i of first.d.inputs) if (i.type === 'float' || (i.type === 'long' && !i.values)) up[i.name] = i.min + (i.max - i.min) * 0.7;
      const second = Object.keys(up).length && shot(c.code, c.name, up);
      if (second && diff(second.px, plain) > diff(px, plain)) px = second.px;
    }
    const id = cx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W * 4; x++) id.data[y * W * 4 + x] = x % 4 === 3 ? 255 : px[(H - 1 - y) * W * 4 + x];
    cx.putImageData(id, 0, 0);
    out[c.id] = cv.toDataURL('image/jpeg', 0.8).split(',')[1];
  }
  return out;
}, { list: keepers.map(({ id, name, code }) => ({ id, name, code })), photo });
await browser2.close();
await rm(path.join(ROOT, 'shaders/thumbs'), { recursive: true, force: true });
await mkdir(path.join(ROOT, 'shaders/thumbs'), { recursive: true });
for (const c of keepers) if (thumbs[c.id]) { c.thumb = 'thumbs/' + c.id.replace('/', '-') + '.jpg'; await writeFile(path.join(ROOT, 'shaders', c.thumb), Buffer.from(thumbs[c.id], 'base64')); }

await rm(path.join(ROOT, 'shaders/isf'), { recursive: true, force: true });
await mkdir(path.join(ROOT, 'shaders/isf'), { recursive: true });
const keep = cands.filter((c) => ok.has(c.id));
for (const c of keep) if (c.kind === 'isf') await writeFile(path.join(ROOT, 'shaders', c.file), c.code);
const index = { v: 1, shaders: keep.map(({ code, ...c }) => c) };
await writeFile(path.join(ROOT, 'shaders/index.json'), JSON.stringify(index, null, 1) + '\n');
const lic = existsSync(path.join(SRC, '../LICENSE')) ? await readFile(path.join(SRC, '../LICENSE'), 'utf8') : '';
await writeFile(path.join(ROOT, 'shaders/CREDITS.txt'),
  `Shaders in isf/ come from the ISF Files collection (https://github.com/Vidvox/ISF-Files) under the MIT licence\n` +
  `below; each file keeps its own credit in its header. Shaders in st/ are Phosphor Loop originals.\n\n${lic}`);
console.log(`kept ${keep.length}: ${keep.filter((c) => c.role === 'input').length} inputs, ${keep.filter((c) => c.role === 'effect').length} effects`);
