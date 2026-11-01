'use strict';
// Type art: the picture typed out in characters, after TypeArt (typeart.mitpit.com). Not the usual ASCII art,
// where each spot's brightness picks a character from a ramp: here each spot tries every character and keeps the
// one whose SHAPE best matches that bit of the picture (a slope gets a slash, a curve a bracket). Up to three
// layers of text are stacked, each shifted part of a character against the others, and each layer picks its
// characters to fill what the layers already there leave out, like a typewriter going over the page again.
//
// It all runs on the graphics chip, every frame:
//   prep    the picture made ready: how much ink each spot wants (brightness, contrast, outlines) and its color
//   choose  one pass per layer, one pixel per character cell: tries each character against 4 x 6 points of the
//           cell, given what the other layers put there, and writes down the best one. Each layer sees the
//           other layers' latest choices, so over a few frames they settle into each other (TypeArt's passes).
//           Shimmer jiggles the scores (TypeArt's Anneal heat); Steady letters favours last frame's character.
//   render  draws the characters from a sheet of them (the atlas), colored, over or instead of the picture.
// js/app.js runs it over the finished picture (Final Pass) or inside each loop (Within Loops).
window.PhosphorTypeArt = (() => {
const SX = 4, SY = 6, S = SX * SY;   // the points of a cell each character is scored on
const GH = 48, PAD = 6;              // a character's height on the sheet, and the empty border round it

const range = (a, b) => { let s = ''; for (let c = a; c <= b; c++) s += String.fromCodePoint(c); return s; };
// The character sets. Space is always added as the first: an empty cell.
const SETS = {
  letters:  { label: 'Letters and numbers', chars: range(65, 90) + range(97, 122) + range(48, 57) },
  keyboard: { label: 'Everything on a keyboard', chars: range(33, 126) },
  lines:    { label: 'Lines and slashes', chars: '/\\|-_=+xX<>^v()[]{}\'"~.,:;`' },
  blocks:   { label: 'Blocks', chars: '░▒▓█▀▄▌▐▖▗▘▙▚▛▜▝▞▟▁▂▃▅▆▇▏▎▍▋▊▉▔▕' },
  braille:  { label: 'Braille dots', chars: range(0x2801, 0x28FF) },
  shapes:   { label: 'Shapes', chars: '◢◣◤◥▲▼◀▶◆◇○●◐◑◒◓◔◕◖◗■□▪▫◧◨◩◪◫◰◱◲◳◴◵◶◷▢▣▤▥▦▧▨▩◸◹◺◿⬒⬓◜◝◞◟◠◡' },
  stars:    { label: 'Stars and flowers', chars: '✦✧★☆✩✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊❋·•∙*+' },
  cyrillic: { label: 'Cyrillic', chars: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя' },
  kana:     { label: 'Matrix code', chars: range(0xFF66, 0xFF9D) + '0123456789:.=*+-<>¦|' },
  digits:   { label: 'Numbers', chars: '0123456789' },
  custom:   { label: 'Your own characters', chars: '' },
};
const FONTS = {
  typewriter: { label: 'Typewriter', css: '"Courier New", Courier, "Liberation Mono", "Nimbus Mono L", monospace', weight: 'normal' },
  code:       { label: 'Code', css: 'Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace', weight: 'normal' },
  bold:       { label: 'Bold', css: 'Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace', weight: 'bold' },
  serif:      { label: 'Book', css: 'Georgia, "Times New Roman", "Liberation Serif", serif', weight: 'normal' },
};
// The color schemes, light on black. ink: the color each layer glows in (null: the picture's own colors there).
const COLORS = {
  picture: { label: 'The picture’s colors', ink: null },
  white:   { label: 'White', ink: [[1, 1, 1]] },
  green:   { label: 'Terminal green', ink: [[0.35, 1, 0.45]] },
  neon:    { label: 'Neon layers', ink: [[1, 0.25, 0.75], [0.2, 0.9, 1], [1, 0.9, 0.25]] },
  purple:  { label: 'Phosphor purple', ink: [[0.75, 0.35, 1]] },
};
const DEFAULTS = { tAmt: 0, tSet: 'keyboard', tSet2: 'same', tFont: 'typewriter', tSize: 35, tLayers: 2, tSpread: 0,
  tColor: 'picture', tInk: 0, tContrast: 100, tEdge: 0, tShimmer: 15, tHold: 50, tBg: 0, tCustom: 'PHOSPHOR', tInside: false, tInvert: false };

/* ---------- shaders ---------- */
const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
// The picture made ready, at about one texel per scoring point: rgb its color, a how much ink it wants (0 to 1)
const FS_PREP = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSize;        // this picture's size
uniform float uContrast, uEdge, uInvert, uInkMax;
out vec4 o;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 at(vec2 p) {
  // four taps across the texel, so a fine picture is averaged rather than skipped
  vec2 d = 0.25 / uSize;
  return 0.25 * (texture(uSrc, p + vec2(-d.x, -d.y)).rgb + texture(uSrc, p + vec2(d.x, -d.y)).rgb
               + texture(uSrc, p + vec2(-d.x, d.y)).rgb + texture(uSrc, p + vec2(d.x, d.y)).rgb);
}
void main() {
  vec2 p = gl_FragCoord.xy / uSize, e = 1.0 / uSize;
  vec3 c = clamp(at(p), 0.0, 1.0);
  float l = lum(c);
  // Outlines: how sharply the brightness changes here (a Sobel edge)
  float edge = 0.0;
  if (uEdge > 0.0) {
    float tl = lum(at(p + vec2(-e.x, e.y))), t = lum(at(p + vec2(0.0, e.y))), tr = lum(at(p + e));
    float ml = lum(at(p - vec2(e.x, 0.0))), mr = lum(at(p + vec2(e.x, 0.0)));
    float bl = lum(at(p - e)), b = lum(at(p - vec2(0.0, e.y))), br = lum(at(p + vec2(e.x, -e.y)));
    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl), gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    edge = clamp(length(vec2(gx, gy)) * 1.6, 0.0, 1.0);
  }
  float ink = mix(l, 1.0 - l, uInvert);   // which parts want the ink: the bright ones, or (swapped) the dark
  ink = clamp((ink - 0.5) * uContrast + 0.5, 0.0, 1.0);
  ink = mix(ink, edge, uEdge);
  o = vec4(c, ink * uInkMax);
}`;
// One layer's choice: one pixel per character cell, the chosen character's number (out of 255) in red
const FS_CHOOSE = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPrep, uSig, uPrev;
uniform sampler2D uIdxO0, uIdxO1, uSigO0, uSigO1;
uniform vec2 uOut, uCell, uOff;
uniform vec2 uCellO0, uCellO1, uOffO0, uOffO1;
uniform ivec2 uGridO0, uGridO1;
uniform float uWO0, uWO1, uW;
uniform int uN;
uniform float uAsym, uHeat, uHold, uSeed, uPrevOK;
out vec4 o;
float hash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
// How much ink another layer puts at point p (its character's coverage of the scoring box p falls in)
float covAt(sampler2D idx, sampler2D sig, vec2 cell, vec2 off, ivec2 grid, vec2 p) {
  vec2 q = (p - off) / cell;
  ivec2 c = ivec2(floor(q));
  if (c.x < 0 || c.y < 0 || c.x >= grid.x || c.y >= grid.y) return 0.0;
  int g = int(texelFetch(idx, c, 0).r * 255.0 + 0.5);
  vec2 f = fract(q);
  int s = int(min(floor(f.y * ${SY}.0), ${SY - 1}.0)) * ${SX} + int(min(floor(f.x * ${SX}.0), ${SX - 1}.0));
  return texelFetch(sig, ivec2(s, g), 0).r;
}
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float T[${S}], B[${S}];
  float tSum = 0.0;
  for (int sy = 0; sy < ${SY}; sy++) for (int sx = 0; sx < ${SX}; sx++) {
    int s = sy * ${SX} + sx;
    vec2 p = uOff + (cell + (vec2(sx, sy) + 0.5) / vec2(${SX}.0, ${SY}.0)) * uCell;
    float t = texture(uPrep, p / uOut).a;
    float b = 0.0;
    if (uWO0 > 0.0) b = 1.0 - (1.0 - b) * (1.0 - uWO0 * covAt(uIdxO0, uSigO0, uCellO0, uOffO0, uGridO0, p));
    if (uWO1 > 0.0) b = 1.0 - (1.0 - b) * (1.0 - uWO1 * covAt(uIdxO1, uSigO1, uCellO1, uOffO1, uGridO1, p));
    T[s] = t; B[s] = b; tSum += t;
  }
  int prev = uPrevOK > 0.5 ? int(texelFetch(uPrev, ivec2(cell), 0).r * 255.0 + 0.5) : -1;
  float best = 1e9;
  int bestG = 0;
  float heat = uHeat * (0.02 + 0.12 * tSum / ${S}.0);
  for (int g = 0; g < 256; g++) {
    if (g >= uN) break;
    float err = 0.0;
    for (int s = 0; s < ${S}; s++) {
      float pred = B[s] + (1.0 - B[s]) * uW * texelFetch(uSig, ivec2(s, g), 0).r;
      float d = pred - T[s];
      err += d * d * (d > 0.0 ? 1.0 + uAsym : 1.0 - uAsym);
    }
    err /= ${S}.0;
    if (g == prev) err = err * (1.0 - 0.6 * uHold) - 0.004 * uHold;
    if (heat > 0.0) err += heat * hash(vec3(cell, float(g) + uSeed));
    if (err < best) { best = err; bestG = g; }
  }
  o = vec4(float(bestG) / 255.0, 0.0, 0.0, 1.0);
}`;
// The characters drawn: each layer's character in each cell, from its sheet, colored and stacked
const FS_RENDER = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc, uPrep;
uniform sampler2D uIdx0, uIdx1, uIdx2, uAtlas0, uAtlas1, uAtlas2;
uniform vec2 uOut;
uniform vec2 uCell0, uCell1, uCell2, uOff0, uOff1, uOff2;
uniform vec4 uAt0, uAt1, uAt2;       // each sheet: columns, glyph width, sheet width, sheet height (pixels)
uniform float uLod0, uLod1, uLod2;
uniform int uLayers;
uniform vec3 uInk0, uInk1, uInk2;
uniform float uInkPic, uBg, uMix;
out vec4 o;
float glyph(sampler2D idx, sampler2D atlas, vec2 cell, vec2 off, vec4 at, float lod, vec2 p, out vec2 cc) {
  vec2 q = (p - off) / cell;
  vec2 c = floor(q);
  cc = off + (c + 0.5) * cell;
  ivec2 ic = ivec2(c);
  ivec2 sz = textureSize(idx, 0);
  if (ic.x < 0 || ic.y < 0 || ic.x >= sz.x || ic.y >= sz.y) return 0.0;
  float g = floor(texelFetch(idx, ic, 0).r * 255.0 + 0.5);
  if (g < 0.5) return 0.0;
  float col = mod(g, at.x), row = floor(g / at.x);
  vec2 f = fract(q);
  vec2 slot = vec2(at.y + ${2 * PAD}.0, ${GH + 2 * PAD}.0);
  vec2 uv = (vec2(col, row) * slot + ${PAD}.0 + vec2(f.x * at.y, (1.0 - f.y) * ${GH}.0)) / at.zw;
  return textureLod(atlas, uv, lod).r;
}
vec3 inkOf(vec3 fixedInk, vec2 cc) {
  if (uInkPic < 0.5) return fixedInk;
  vec3 c = texture(uPrep, cc / uOut).rgb;
  // glowing letters at full brightness in the picture's hue
  return c / max(max(c.r, max(c.g, c.b)), 0.08);
}
vec3 lay(vec3 acc, float cov, vec3 ink) { return acc + (1.0 - acc) * cov * ink; }
void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 src = texture(uSrc, p / uOut).rgb;
  vec3 acc = src * uBg;
  vec2 cc;
  float g = glyph(uIdx0, uAtlas0, uCell0, uOff0, uAt0, uLod0, p, cc);
  if (g > 0.0) acc = lay(acc, g, inkOf(uInk0, cc));
  if (uLayers > 1) { g = glyph(uIdx1, uAtlas1, uCell1, uOff1, uAt1, uLod1, p, cc); if (g > 0.0) acc = lay(acc, g, inkOf(uInk1, cc)); }
  if (uLayers > 2) { g = glyph(uIdx2, uAtlas2, uCell2, uOff2, uAt2, uLod2, p, cc); if (g > 0.0) acc = lay(acc, g, inkOf(uInk2, cc)); }
  o = vec4(mix(src, clamp(acc, 0.0, 1.0), uMix), 1.0);
}`;

/* ---------- the character sheets ---------- */
// Each set of characters drawn in a font: a sheet of them for drawing, and each one's ink at the 4 x 6 scoring
// points (its "signature"). Characters this computer has no font for (drawn as an empty box) and exact repeats
// are left out.
function uniqueChars(str) {
  const seen = new Set(), out = [];
  for (const ch of str) if (ch.trim() && !seen.has(ch)) { seen.add(ch); out.push(ch); }
  return out;
}
function drawSheet(chars, font) {
  const f = FONTS[font] || FONTS.typewriter;
  const px = Math.round(GH * 0.82);
  const css = `${f.weight} ${px}px ${f.css}`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = css;
  // A cell is as wide as the font's own characters (Courier's are 0.6 of its size)
  const adv = probe.measureText('M').width || px * 0.6;
  const GW = Math.max(16, Math.round(Math.min(Math.max(adv / px, 0.45), 0.9) * GH));
  const slotW = GW + 2 * PAD, slotH = GH + 2 * PAD;
  const one = document.createElement('canvas');
  one.width = slotW; one.height = slotH;
  const c1 = one.getContext('2d', { willReadFrequently: true });
  const render = (ch) => {
    c1.fillStyle = '#000'; c1.fillRect(0, 0, slotW, slotH);
    c1.font = css;
    c1.fillStyle = '#fff';
    c1.textBaseline = 'alphabetic';
    const w = c1.measureText(ch).width || 1;
    const k = Math.min(1, GW / w);
    c1.save();
    c1.translate(PAD + GW / 2, PAD + GH * 0.8);
    c1.scale(k, 1);
    c1.fillText(ch, -w / 2, 0);
    c1.restore();
    return c1.getImageData(PAD, PAD, GW, GH).data;
  };
  const key = (d) => { let h = 2166136261; for (let i = 0; i < d.length; i += 4) { h ^= d[i]; h = Math.imul(h, 16777619); } return h; };
  // What a missing character looks like here
  const missing = new Set([key(render(String.fromCodePoint(0x10FFFD))), key(render(String.fromCodePoint(0xE0FFF)))]);
  const kept = [], bitmaps = [], seen = new Set();
  for (const ch of chars) {
    const d = render(ch);
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) ink += d[i];
    const h = key(d);
    if (!ink || missing.has(h) || seen.has(h)) continue;
    seen.add(h);
    kept.push(ch); bitmaps.push(d.slice());
    if (kept.length >= 255) break;
  }
  const n = kept.length + 1;   // with space first
  const cols = Math.min(16, n), rows = Math.ceil(n / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * slotW; sheet.height = rows * slotH;
  const cs = sheet.getContext('2d');
  cs.fillStyle = '#000'; cs.fillRect(0, 0, sheet.width, sheet.height);
  const sig = new Uint8Array(S * n);
  let inkMax = 0;
  bitmaps.forEach((d, i) => {
    const g = i + 1;
    const img = cs.createImageData(GW, GH);
    img.data.set(d);
    cs.putImageData(img, (g % cols) * slotW + PAD, Math.floor(g / cols) * slotH + PAD);
    let total = 0;
    for (let sy = 0; sy < SY; sy++) for (let sx = 0; sx < SX; sx++) {
      // scoring row 0 is the bottom of the cell (the graphics chip counts upwards)
      const y0 = Math.round(GH * (1 - (sy + 1) / SY)), y1 = Math.round(GH * (1 - sy / SY));
      const x0 = Math.round(GW * sx / SX), x1 = Math.round(GW * (sx + 1) / SX);
      let sum = 0, cnt = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += d[(y * GW + x) * 4]; cnt++; }
      const v = cnt ? sum / cnt : 0;
      sig[g * S + sy * SX + sx] = Math.round(v);
      total += v;
    }
    inkMax = Math.max(inkMax, total / S / 255);
  });
  return { sheet, sig, n, cols, GW, inkMax: Math.max(inkMax, 0.05), aspect: GW / GH };
}

/* ---------- the engine ---------- */
function create(gl) {
  function prog(fs) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log); }
      return s;
    };
    const p = gl.createProgram();
    const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  const prep = prog(FS_PREP), choose = prog(FS_CHOOSE), render = prog(FS_RENDER);
  const L = (pr, n) => pr.u[n] || null;
  const f1 = (pr, n, v) => { const l = L(pr, n); if (l) gl.uniform1f(l, v); };
  const f2 = (pr, n, a, b) => { const l = L(pr, n); if (l) gl.uniform2f(l, a, b); };
  const f3 = (pr, n, a) => { const l = L(pr, n); if (l) gl.uniform3f(l, a[0], a[1], a[2]); };
  const f4 = (pr, n, a, b, c, d) => { const l = L(pr, n); if (l) gl.uniform4f(l, a, b, c, d); };
  const i1 = (pr, n, v) => { const l = L(pr, n); if (l) gl.uniform1i(l, v); };
  const i2 = (pr, n, a, b) => { const l = L(pr, n); if (l) gl.uniform2i(l, a, b); };

  function target(w, h, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h };
  }
  const drop = (t) => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } };

  // The sheets made so far, by set, font and (for Your own characters) the characters typed
  const sheets = new Map();
  function sheetOf(set, font, custom) {
    const chars = set === 'custom' ? uniqueChars(custom || 'PHOSPHOR').join('') : (SETS[set] || SETS.keyboard).chars;
    const key = `${set}|${font}|${set === 'custom' ? chars : ''}`;
    let s = sheets.get(key);
    if (s) return s;
    let made = drawSheet(uniqueChars(chars), font);
    if (made.n < 2) made = drawSheet(uniqueChars(SETS.keyboard.chars), font);   // nothing drawable: fall back to the keyboard
    const atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, made.sheet);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const sig = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sig);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, S, made.n, 0, gl.RED, gl.UNSIGNED_BYTE, made.sig);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    s = { atlas, sig, n: made.n, cols: made.cols, GW: made.GW, W: made.sheet.width, H: made.sheet.height, inkMax: made.inkMax, aspect: made.aspect };
    sheets.set(key, s);
    // Keep only a handful of sheets
    if (sheets.size > 8) {
      const [oldKey, old] = sheets.entries().next().value;
      gl.deleteTexture(old.atlas); gl.deleteTexture(old.sig); sheets.delete(oldKey);
    }
    return s;
  }

  // A place to draw: the final picture, or one loop. Each keeps its layers' choices from frame to frame.
  function state() { return { layers: [null, null, null], prepRT: null, out: null, frame: 0 }; }
  function release(st) {
    if (!st) return;
    st.layers.forEach((l) => { if (l) { drop(l.rt[0]); drop(l.rt[1]); } });
    st.layers = [null, null, null];
    drop(st.prepRT); drop(st.out);
    st.prepRT = null; st.out = null;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Lay out the layers for a picture outW x outH: each one's sheet, cell size, shift and grid
  function plan(t, outW, outH) {
    const n = clamp(Math.round(t.tLayers), 1, 3);
    const h1 = outH * 0.0075 * Math.pow(0.085 / 0.0075, clamp(t.tSize, 0, 100) / 100);
    const spread = clamp(t.tSpread, 0, 100) / 100;
    const sizeK = [1, 1 - 0.45 * spread, 1 + 0.8 * spread];
    const col = COLORS[t.tColor] || COLORS.picture;
    const out = [];
    for (let j = 0; j < n; j++) {
      const sh = sheetOf(j === 0 || t.tSet2 === 'same' ? t.tSet : t.tSet2, t.tFont, t.tCustom);
      const ch = Math.max(3, h1 * sizeK[j]), cw = Math.max(2, ch * sh.aspect);
      const k = j / n;
      const off = [-cw * k, -ch * ((k * 1.618) % 1)];
      const nx = Math.ceil((outW - off[0]) / cw), ny = Math.ceil((outH - off[1]) / ch);
      const ink = col.ink ? col.ink[j % col.ink.length] : [1, 1, 1];
      out.push({ sh, cell: [cw, ch], off, nx, ny, ink, lod: Math.max(0, Math.log2(48 / ch)) });
    }
    return { n, layers: out, col };
  }

  // Type the picture srcTex into dst ({fbo, w, h}), or into this place's own picture (returned) if dst is null.
  // amount: 0 to 1, how much of the typed picture shows over the original.
  function run(st, srcTex, outW, outH, t, amount, dst) {
    const pl = plan(t, outW, outH);
    st.frame++;
    // The made-ready picture, at about one texel per scoring point of the first layer
    const c0 = pl.layers[0].cell;
    const pw = clamp(Math.ceil(outW / (c0[0] / SX)), 8, 2048), ph = clamp(Math.ceil(outH / (c0[1] / SY)), 8, 2048);
    if (!st.prepRT || st.prepRT.w !== pw || st.prepRT.h !== ph) { drop(st.prepRT); st.prepRT = target(pw, ph, gl.LINEAR); }
    // The most ink the layers can lay down together: the picture's tones are spread over that
    let free = 1;
    for (const l of pl.layers) free *= 1 - l.sh.inkMax;
    const inkMax = 1 - free;
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.prepRT.fbo);
    gl.viewport(0, 0, pw, ph);
    gl.useProgram(prep.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    i1(prep, 'uSrc', 0);
    f2(prep, 'uSize', pw, ph);
    const cv = clamp(t.tContrast, 0, 200) / 100;
    f1(prep, 'uContrast', cv <= 1 ? cv : 1 + (cv - 1) * 3);
    f1(prep, 'uEdge', clamp(t.tEdge, 0, 100) / 100);
    f1(prep, 'uInvert', t.tInvert ? 1 : 0);
    f1(prep, 'uInkMax', inkMax);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Each layer's choice: its picture of choices, two of them taking turns (last frame's and this frame's)
    for (let j = 0; j < pl.n; j++) {
      const lp = pl.layers[j];
      let ls = st.layers[j];
      const fresh = !ls || ls.nx !== lp.nx || ls.ny !== lp.ny || ls.sh !== lp.sh;
      if (!ls || ls.nx !== lp.nx || ls.ny !== lp.ny) {
        if (ls) { drop(ls.rt[0]); drop(ls.rt[1]); }
        ls = st.layers[j] = { rt: [target(lp.nx, lp.ny, gl.NEAREST), target(lp.nx, lp.ny, gl.NEAREST)], f: 0, nx: lp.nx, ny: lp.ny };
      }
      ls.sh = lp.sh;
      Object.assign(ls, { cell: lp.cell, off: lp.off });
      ls.fresh = fresh;
    }
    for (let j = pl.n; j < 3; j++) if (st.layers[j]) { drop(st.layers[j].rt[0]); drop(st.layers[j].rt[1]); st.layers[j] = null; }

    gl.useProgram(choose.p);
    const asym = clamp(t.tInk, -100, 100) / 100 * -0.85;   // more ink: missing ink costs more than too much
    const shimmer = clamp(t.tShimmer, 0, 100) / 100;
    f1(choose, 'uAsym', asym);
    f1(choose, 'uHeat', shimmer * shimmer * 3);
    f1(choose, 'uHold', clamp(t.tHold, 0, 100) / 100);
    f1(choose, 'uSeed', shimmer > 0 ? (st.frame % 997) * 7.31 : 0);
    f2(choose, 'uOut', outW, outH);
    i1(choose, 'uPrep', 0); i1(choose, 'uSig', 1); i1(choose, 'uPrev', 2);
    i1(choose, 'uIdxO0', 3); i1(choose, 'uSigO0', 4); i1(choose, 'uIdxO1', 5); i1(choose, 'uSigO1', 6);
    for (let j = 0; j < pl.n; j++) {
      const ls = st.layers[j], lp = pl.layers[j];
      const others = [0, 1, 2].filter((o) => o !== j && o < pl.n).map((o) => st.layers[o]);
      const back = ls.rt[1 - ls.f], front = ls.rt[ls.f];
      gl.bindFramebuffer(gl.FRAMEBUFFER, back.fbo);
      gl.viewport(0, 0, ls.nx, ls.ny);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.prepRT.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lp.sh.sig);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, front.tex);
      for (let o = 0; o < 2; o++) {
        const ol = others[o];
        // A layer that's just been made has nothing in it yet worth reading
        const live = ol && !ol.fresh;
        gl.activeTexture(gl.TEXTURE3 + 2 * o); gl.bindTexture(gl.TEXTURE_2D, live ? ol.rt[ol.f].tex : front.tex);
        gl.activeTexture(gl.TEXTURE4 + 2 * o); gl.bindTexture(gl.TEXTURE_2D, live ? ol.sh.sig : lp.sh.sig);
        f1(choose, 'uWO' + o, live ? 1 : 0);
        if (live) {
          f2(choose, 'uCellO' + o, ol.cell[0], ol.cell[1]);
          f2(choose, 'uOffO' + o, ol.off[0], ol.off[1]);
          i2(choose, 'uGridO' + o, ol.nx, ol.ny);
        }
      }
      f2(choose, 'uCell', lp.cell[0], lp.cell[1]);
      f2(choose, 'uOff', lp.off[0], lp.off[1]);
      f1(choose, 'uW', 1);
      i1(choose, 'uN', lp.sh.n);
      f1(choose, 'uPrevOK', ls.fresh ? 0 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      ls.f = 1 - ls.f;
      ls.fresh = false;
    }

    // Draw them
    if (!dst) {
      if (!st.out || st.out.w !== outW || st.out.h !== outH) { drop(st.out); st.out = target(outW, outH, gl.LINEAR); }
      dst = st.out;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(render.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, st.prepRT.tex);
    i1(render, 'uSrc', 0); i1(render, 'uPrep', 1);
    for (let j = 0; j < 3; j++) {
      const ls = st.layers[Math.min(j, pl.n - 1)], lp = pl.layers[Math.min(j, pl.n - 1)];
      gl.activeTexture(gl.TEXTURE2 + j); gl.bindTexture(gl.TEXTURE_2D, ls.rt[ls.f].tex);
      gl.activeTexture(gl.TEXTURE5 + j); gl.bindTexture(gl.TEXTURE_2D, lp.sh.atlas);
      i1(render, 'uIdx' + j, 2 + j); i1(render, 'uAtlas' + j, 5 + j);
      f2(render, 'uCell' + j, lp.cell[0], lp.cell[1]);
      f2(render, 'uOff' + j, lp.off[0], lp.off[1]);
      f4(render, 'uAt' + j, lp.sh.cols, lp.sh.GW, lp.sh.W, lp.sh.H);
      f1(render, 'uLod' + j, lp.lod);
      f3(render, 'uInk' + j, lp.ink);
    }
    f2(render, 'uOut', outW, outH);
    i1(render, 'uLayers', pl.n);
    f1(render, 'uInkPic', pl.col.ink ? 0 : 1);
    f1(render, 'uBg', clamp(t.tBg, 0, 100) / 100 * 0.5);
    f1(render, 'uMix', clamp(amount, 0, 1));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    return dst;
  }
  return { state, release, run, sheetOf };
}

return { create, SETS, FONTS, COLORS, DEFAULTS };
})();
