'use strict';
window.PhosphorShaders = (() => {
const { FR } = window.PhosphorFractals;
const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `
const float TAU = 6.28318531;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
`;

const FS_FEEDBACK = `#version 300 es
precision highp float;
uniform sampler2D uPrev, uOther, uPic, uVid0, uVid1, uCam0, uCam1, uScr0, uScr1, uPho0, uPho1, uOtherPrev, uScene1, uScene2, uText;
uniform vec2 uSim;
uniform float uPxK;   // how many pixels make one Standard-size step (more at a sharper picture), so effects keep their size
uniform float uTime, uZoom, uSpin, uDecay, uHue, uWarp, uMirror, uBlur, uEdge, uGain, uForm, uFloor, uBrushOn;
uniform float uBlend, uScale, uMotion, uXfeed;
uniform float uFlow, uSplit, uSplitOff, uInkDt;
uniform float uMelt, uMeltTurn;   // Melt: how far the picture pushes itself this frame, and which way each brightness slides
uniform float uPush, uPushTurn;   // Pushed by the other loop: the same idea, but the other loop's picture does the pushing
uniform float uDye, uDyeTurn;     // Dyed by the other loop: how far its bright parts turn this loop's colors this frame
uniform float uLook;              // Look-up: how far each spot moves towards the place its own color points at, this frame
uniform vec2 uCenter;             // Chase: the point Zoom and Spin turn around (the middle unless Chase moves it)
uniform float uChroma, uChromaTurn;   // Color chase: how far each color is pushed by another this frame, and a slow turn
uniform float uRestless;          // Restless: how much of what holds still fades this frame
uniform float uJulia;             // Fractal fold: how much of the fold (0 none, 1 all of it)
uniform vec2 uJuliaC;             // Fractal fold: the fractal's constant, which drifts slowly
uniform float uCrystal;           // Crystal: how far each piece turns and zooms this frame
uniform vec4 uCells[5];           // Crystal: the centres of its ten pieces, two to a slot
uniform float uGrow, uGrowR, uGrowTurn;   // Grow: how fast patterns grow this frame, how far apart their stripes sit (pixels), and a turn that changes every frame
uniform float uAspText;   // the Text input's picture: how wide it is for its height
uniform float uSceneK;   // how much of each new frame of a 3D flight gets in (less as Trails rise, so it never whites out)
uniform float uAspPic, uAspVid, uAspCam, uAspScr, uAspPho, uFlipCam, uFlipPho;
uniform int uIn1, uIn2;
uniform vec2 uWave[81];     // the Wave curve's 81 points, worked out once per frame
uniform vec4 uWaveBox[8];   // 8 stretches of 10 segments: centre and radius of each
uniform vec4 uAdjA[11];  // per input: tracking, brightness, contrast, color
uniform vec4 uAdjB[11];  // per input: cut-out level
uniform vec2 uShift;
uniform vec4 uBrush;
uniform vec3 uBrushCol;
out vec4 o;
${COMMON}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}
vec2 fold(vec2 p, float n) {
  if (n < 1.0) return p;
  if (n < 3.0) { p.x = abs(p.x); return p; }
  if (n < 5.0) return abs(p);
  float seg = TAU / n;
  float a = mod(atan(p.y, p.x), seg);
  a = abs(a - seg * 0.5);
  return length(p) * vec2(cos(a), sin(a));
}
vec3 hueRot(vec3 c, float a) {
  const vec3 k = vec3(0.57735027);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
vec3 seedWave(vec2 p, float t) {
  // Only the stretches of curve close enough to glow on this pixel are measured
  float d = 1e5;
  for (int c = 0; c < 8; c++) {
    vec4 bx = uWaveBox[c];
    if (length(p - bx.xy) - bx.z > min(d, 0.08)) continue;
    for (int i = 0; i < 10; i++) {
      int j = c * 10 + i;
      d = min(d, sdSeg(p, uWave[j], uWave[j + 1]));
    }
  }
  if (d > 0.08) return vec3(0.0);
  float w = 0.0045;
  float g = exp(-d * d / (w * w)) + 0.16 * exp(-d / 0.012);
  return hsv(fract(t * 0.04), 0.7, 1.0) * g;
}
vec3 seedShape(vec2 p, float t) {
  float n = floor(uForm + 0.5) + 1.0;
  vec2 q = rot(t * 0.35) * p;
  float r = 0.17 + 0.025 * sin(t * 1.3);
  float a = atan(q.x, q.y);
  float seg = TAU / n;
  float d = cos(floor(0.5 + a / seg) * seg - a) * length(q) - r;
  float w = 0.005;
  float g = exp(-d * d / (w * w)) + 0.14 * exp(-abs(d) / 0.01);
  return hsv(fract(t * 0.06 + 0.5), 0.65, 1.0) * g;
}
vec3 seedBars(vec2 p, float t) {
  vec2 q = rot(t * 0.12) * p;
  float band = exp(-q.y * q.y / (0.035 * 0.035));
  vec3 osc = 0.5 + 0.5 * vec3(sin(q.x * 9.0 + t * 2.1), sin(q.x * 13.0 - t * 1.7 + 2.0), sin(q.x * 6.0 + t * 1.3 + 4.0));
  osc = pow(osc, vec3(2.5));
  float len = smoothstep(0.5, 0.35, abs(q.x));
  return osc * band * len * 1.3;
}
vec3 seedSparks(vec2 p, float t) {
  vec2 g = p * 20.0;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float tb = mod(floor(t * 8.0), 997.0);
  float on = step(0.955, hash(id + tb * 0.731));
  vec2 off = (vec2(hash(id + tb * 1.37 + 3.1), hash(id + tb * 2.11 + 7.7)) - 0.5) * 0.6;
  float d = length(f - off);
  return hsv(hash(id * 1.7 + tb), 0.55, 1.0) * exp(-d * d / 0.01) * on;
}
float sq(float x) { return x * x; }
// Smooth random hills, with their slopes worked out exactly (for Flow)
vec3 noiseD(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx));
}
// Flow: slowly changing currents, big and small. They run along the contour lines of smooth random hills,
// so they never squeeze or stretch the picture, only curl it into threads, the way ink moves in water.
vec2 flowAt(vec2 p, float t) {
  mat2 r1 = rot(t * 0.031), r2 = rot(1.7 - t * 0.047), r3 = rot(t * 0.071 + 0.6);
  vec3 n1 = noiseD(r1 * p * 1.8 + vec2(t * 0.05, -t * 0.03));
  vec3 n2 = noiseD(r2 * p * 4.3 + vec2(17.0 - t * 0.09, t * 0.05));
  vec3 n3 = noiseD(r3 * p * 9.7 + vec2(t * 0.13, 31.0 + t * 0.11));
  vec2 g = (n1.yz * r1) * 1.8 + (n2.yz * r2) * (4.3 * 0.42) + (n3.yz * r3) * (9.7 * 0.13);
  return vec2(g.y, -g.x);
}
// Ink drops, worked out once per frame (see computeInk). For each drop: where it is (xy), how far it
// has spread (z) and a number that makes its edge ragged its own way (w); how hard it splashes (x),
// how much it keeps bleeding (y), how hard it pushes the water aside (z) and its full size (w); its color.
uniform vec4 uInk[6];
uniform vec4 uInkAmt[6];
uniform vec3 uInkCol[6];
// A drop lands with a splash, spreads into a ragged ring, then keeps bleeding color
// while the currents carry it off
vec3 seedInk(vec2 p) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec4 dr = uInk[i], am = uInkAmt[i];
    vec2 d = p - dr.xy;
    float r = length(d);
    // Keep this as one guarded block: continue branches here trigger a Metal
    // pipeline compiler error on Apple GPUs when this shader is first drawn.
    if (am.x + am.y > 0.0 && r <= dr.z * 1.3 + 0.03) {
      float ang = atan(d.y, d.x);
      float wob = 1.0 + 0.16 * sin(ang * 3.0 + dr.w) + 0.08 * sin(ang * 7.0 - dr.w * 1.7);
      float R = dr.z * wob + 0.006;
      float core = smoothstep(R, R * 0.3, r);
      float rim = exp(-sq((r - R) / (0.006 + 0.12 * R)));
      float body = smoothstep(R * 0.85, R * 0.15, r);
      c += uInkCol[i] * ((0.45 * core + rim) * am.x + body * am.y);
    }
  }
  return c * 0.55;
}
// A landing drop pushes the ink already in the water out of its way
vec2 inkPush(vec2 p) {
  vec2 v = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    float push = uInkAmt[i].z;
    if (push <= 0.0) continue;
    vec2 d = p - uInk[i].xy;
    v += d * push * exp(-dot(d, d) / sq(uInk[i].z + 0.05));
  }
  return v;
}
vec2 edgeMask(vec2 q) { return smoothstep(vec2(0.0), vec2(0.012), q) * smoothstep(vec2(1.0), vec2(0.988), q); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
// Melt: the picture pushes itself around. Each spot checks how bright the last frame is around it, and that
// brightness picks the way it slides (bright one way, dim another), while edges curl along themselves.
// Frame after frame the picture folds into itself, like marbling.
vec2 meltAt(vec2 q, float asp) {
  vec2 st = q / vec2(asp, 1.0) + 0.5;
  vec2 r = vec2(0.012 / asp, 0.012), d = r * 0.7071;
  float lE = luma(texture(uPrev, st + vec2(r.x, 0.0)).rgb), lW = luma(texture(uPrev, st - vec2(r.x, 0.0)).rgb);
  float lN = luma(texture(uPrev, st + vec2(0.0, r.y)).rgb), lS = luma(texture(uPrev, st - vec2(0.0, r.y)).rgb);
  float lNE = luma(texture(uPrev, st + d).rgb), lSW = luma(texture(uPrev, st - d).rgb);
  float lNW = luma(texture(uPrev, st + vec2(-d.x, d.y)).rgb), lSE = luma(texture(uPrev, st + vec2(d.x, -d.y)).rgb);
  float L = 0.125 * (lE + lW + lN + lS + lNE + lSW + lNW + lSE);
  vec2 g = (vec2(lE - lW, lN - lS) + 0.7071 * vec2(lNE - lSW + lSE - lNW, lNE - lSW + lNW - lSE)) / 0.048;
  float a = L * 9.4 + uMeltTurn;
  vec2 slide = vec2(cos(a), sin(a)) * smoothstep(0.02, 0.25, L);
  vec2 curl = vec2(g.y, -g.x) / (length(g) + 4.0);
  return uMelt * (slide + 0.5 * curl);
}
// Pushed by the other loop: like Melt, but it's the other loop's latest picture that decides where this one
// moves. Its brightness picks which way each spot slides, its outlines drag this loop's trails along them, and
// its bright parts swell outward a little, so its shapes carve currents and swirls through this loop.
vec2 pushAt(vec2 q, float asp) {
  vec2 st = q / vec2(asp, 1.0) + 0.5;
  vec2 r = vec2(0.016 / asp, 0.016), d = r * 0.7071;
  float lE = luma(texture(uOther, st + vec2(r.x, 0.0)).rgb), lW = luma(texture(uOther, st - vec2(r.x, 0.0)).rgb);
  float lN = luma(texture(uOther, st + vec2(0.0, r.y)).rgb), lS = luma(texture(uOther, st - vec2(0.0, r.y)).rgb);
  float lNE = luma(texture(uOther, st + d).rgb), lSW = luma(texture(uOther, st - d).rgb);
  float lNW = luma(texture(uOther, st + vec2(-d.x, d.y)).rgb), lSE = luma(texture(uOther, st + vec2(d.x, -d.y)).rgb);
  float L = 0.125 * (lE + lW + lN + lS + lNE + lSW + lNW + lSE);
  vec2 g = (vec2(lE - lW, lN - lS) + 0.7071 * vec2(lNE - lSW + lSE - lNW, lNE - lSW + lNW - lSE)) / 0.064;
  float a = L * 7.0 + uPushTurn;
  vec2 slide = vec2(cos(a), sin(a)) * smoothstep(0.03, 0.3, L);
  float gn = length(g) + 3.0;
  vec2 curl = vec2(g.y, -g.x) / gn;
  vec2 swell = g / gn;
  return uPush * (0.6 * slide + 0.9 * curl + 0.35 * swell);
}
// Dyed by the other loop: the other loop's picture soaks color into this one. How bright the other loop is at
// each spot picks a color there, and this loop's trails are steadily stained towards it while their colors keep
// turning. The stains ride along with the trails and get stained again wherever they land, so the other loop's
// shapes show up here as rainbow bands that keep shifting. Only the color changes, never how bright it is.
vec3 dyeBy(vec3 c, vec2 p, float asp) {
  vec2 st = p / vec2(asp, 1.0) + 0.5;
  vec2 r = vec2(0.014 / asp, 0.014), d = r * 0.7071;
  float lo = 0.2 * luma(texture(uOther, st).rgb) +
             0.1 * (luma(texture(uOther, st + vec2(r.x, 0.0)).rgb) + luma(texture(uOther, st - vec2(r.x, 0.0)).rgb) +
                    luma(texture(uOther, st + vec2(0.0, r.y)).rgb) + luma(texture(uOther, st - vec2(0.0, r.y)).rgb) +
                    luma(texture(uOther, st + d).rgb) + luma(texture(uOther, st - d).rgb) +
                    luma(texture(uOther, st + vec2(-d.x, d.y)).rgb) + luma(texture(uOther, st + vec2(d.x, -d.y)).rgb));
  float k = uDye * smoothstep(0.02, 0.5, lo);
  if (k <= 0.0) return c;
  c = max(hueRot(c, k * 0.9), 0.0);
  float l = luma(c);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float grey = 1.0 - (mx - mn) / max(mx, 1e-3);
  vec3 tint = hsv(fract(lo * 1.4 + uDyeTurn), 0.8, 1.0);
  tint = clamp(tint * (l / max(luma(tint), 0.05)), 0.0, 1.0);
  return mix(c, tint, clamp(k * (0.7 + grey), 0.0, 1.0));
}
// Grow: the picture grows patterns out of itself, the way stripes and spots form on animals. Each spot compares
// how bright it is up close with how bright a ring around it is. Brighter than its ring, it gets brighter, in its own
// color; darker than its ring, it gets darker. Bright places shade their surroundings, so the light settles into
// stripes, spots and coral-like mazes about two ring-widths apart. They start at outlines and spread through
// anything lit, while zoom, spin and the rest keep moving them, so they keep growing and re-forming.
vec3 growAt(vec3 c, vec3 near, vec2 st) {
  vec2 px = uPxK / uSim;
  float lc = luma(c);
  float la = luma(mix(c, near, 0.8));
  // The ring: two circles of samples, turned a different way every frame so no direction is favoured
  float li = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = uGrowTurn + float(i) * 0.7853982;
    li += luma(texture(uPrev, st + vec2(cos(a), sin(a)) * uGrowR * px).rgb);
  }
  for (int i = 0; i < 6; i++) {
    float a = 0.5 - uGrowTurn * 1.3 + float(i) * 1.0471976;
    li += 0.75 * luma(texture(uPrev, st + vec2(cos(a), sin(a)) * (uGrowR * 0.6) * px).rgb);
  }
  li /= 12.5;
  float x = la - li;
  // A whisper of noise where there is already some light, so patterns can start up in smooth, even patches
  x += (hash(gl_FragCoord.xy * 0.731 + fract(uGrowTurn * 0.159) * 97.0) - 0.5) * 0.02 * smoothstep(0.02, 0.25, la);
  float lt = clamp(lc + uGrow * tanh(x * 12.0), 0.0, 1.0);
  // Only the brightness changes, never the color: a spot keeps its own color, and a dark spot that lights up
  // takes the color of what's around it (white only where there is no color at all)
  float ln = luma(near);
  vec3 hue = mix(near / max(ln, 1e-4), c / max(lc, 1e-4), smoothstep(0.02, 0.08, lc));
  hue = mix(vec3(1.0), hue, smoothstep(0.0, 0.015, max(lc, ln)));
  return clamp(hue * lt, 0.0, 1.0);
}
// Look-up: each spot copies from a spot its own color points at. How red it is says how far to the side, how green
// how far up or down, and how blue and how bright it is turn that direction round, so every shade reads from its
// own place and neighbouring shades pull apart. The picture keeps rearranging itself by its own colors, folding into liquid-metal
// swirls that never quite repeat. Dark spots point nowhere and stay put.
vec2 lookAt(vec2 q, float asp) {
  vec2 st = q / vec2(asp, 1.0) + 0.5;
  vec2 r = vec2(0.008 / asp, 0.008);
  vec3 c = 0.25 * (texture(uPrev, st + r).rgb + texture(uPrev, st - r).rgb +
                   texture(uPrev, st + vec2(r.x, -r.y)).rgb + texture(uPrev, st + vec2(-r.x, r.y)).rgb);
  vec2 way = rot(c.b * TAU + luma(c) * 9.0) * (c.rg - 0.5 + vec2(0.18, 0.0));
  return q + way * uLook * smoothstep(0.02, 0.2, luma(c));
}
// Color chase: red is pushed around by the green parts of the picture, green by the blue and blue by the red.
// Each color slides along the outlines of the one pushing it, and its brightness picks which way, so the three
// keep chasing each other round in a circle, splitting into rainbow fringes and braids.
vec3 chromaAt(vec2 st, float asp) {
  vec2 r = vec2(0.012 / asp, 0.012);
  vec3 E = texture(uPrev, st + vec2(r.x, 0.0)).rgb, W = texture(uPrev, st - vec2(r.x, 0.0)).rgb;
  vec3 N = texture(uPrev, st + vec2(0.0, r.y)).rgb, S = texture(uPrev, st - vec2(0.0, r.y)).rgb;
  vec3 C = 0.25 * (E + W + N + S);
  vec3 gx = ((E - W) / 0.024).gbr, gy = ((N - S) / 0.024).gbr, by = C.gbr;   // the slope of the color doing the pushing
  vec3 n = sqrt(gx * gx + gy * gy) + 3.0;
  vec3 a = by * 7.0 + uChromaTurn + vec3(0.0, 2.1, 4.2);
  vec3 slide = smoothstep(0.03, 0.3, by);
  vec3 dx = (gy / n * 0.9 + cos(a) * slide * 0.5) * uChroma;
  vec3 dy = (-gx / n * 0.9 + sin(a) * slide * 0.5) * uChroma;
  return vec3(texture(uPrev, st + vec2(dx.r / asp, dy.r)).r,
              texture(uPrev, st + vec2(dx.g / asp, dy.g)).g,
              texture(uPrev, st + vec2(dx.b / asp, dy.b)).b);
}
// Fractal fold: instead of a plain zoom, the picture is folded through the formula behind the Mandelbrot set
// (z becomes z times z plus a constant), so whatever comes in grows into fractal flowers and spirals
vec2 juliaAt(vec2 q) {
  vec2 z = q * 2.2;
  return (vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + uJuliaC) / 2.2;
}
// Crystal: the picture is split into ten pieces around its brightest spots (found by the loop's probe, see
// probeTick), and each piece turns and zooms around its own centre in its own way, like a broken mirror
vec2 crystalAt(vec2 q) {
  float best = 1e9, id = 0.0;
  vec2 cc = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    vec4 c = uCells[i];
    vec2 d1 = q - c.xy, d2 = q - c.zw;
    float e1 = dot(d1, d1), e2 = dot(d2, d2);
    if (e1 < best) { best = e1; cc = c.xy; id = float(i * 2); }
    if (e2 < best) { best = e2; cc = c.zw; id = float(i * 2 + 1); }
  }
  float a = sin(id * 12.9898 + 0.7) * 0.05 * uCrystal;
  float z = (cos(id * 4.1414) * 0.6 + 0.25) * 0.017 * uCrystal;
  return cc + rot(a) * (q - cc) * exp(-z);
}
// The spectrograph (see writeSpec): a picture of the sound. Each row of uSpec is one moment and runs from
// the lowest pitch on the left to the highest on the right; new rows are written over the oldest, like a ring.
uniform sampler2D uSpec;
uniform vec2 uSpecSize;     // the ring's width (pitches) and height (moments)
uniform float uSpecNew;     // which row holds the newest moment
uniform float uSpecAcc;     // how far towards the next row time has moved, so the picture slides smoothly
uniform float uSpecRound;   // 0 scrolls sideways, 1 ripples out from the middle
// Quiet is black, then indigo, violet, pink and amber, and the loudest glows almost white
vec3 specColor(float x) {
  vec3 c = vec3(0.11, 0.05, 0.27) * smoothstep(0.0, 0.2, x);
  c = mix(c, vec3(0.45, 0.2, 0.95), smoothstep(0.16, 0.42, x));
  c = mix(c, vec3(1.0, 0.3, 0.62), smoothstep(0.38, 0.62, x));
  c = mix(c, vec3(1.0, 0.68, 0.22), smoothstep(0.6, 0.82, x));
  return mix(c, vec3(1.0, 0.96, 0.8), smoothstep(0.84, 1.0, x));
}
// pitch: 0 lowest to 1 highest. age: how many rows back from the newest (0 = right now).
float specAt(float pitch, float age) {
  float y = uSpecNew - max(age - uSpecAcc, 0.0);
  float x = (clamp(pitch, 0.0, 1.0) * (uSpecSize.x - 1.0) + 0.5) / uSpecSize.x;
  return texture(uSpec, vec2(x, (y + 0.5) / uSpecSize.y)).r;
}
// How much of this pixel the spectrograph covers. Its loud parts are laid over the trails rather than added
// to them as light (see main), so a bass line that never stops can't pile up into white.
float gSpecA = 0.0;
vec3 specPixel(float level, float fade) {
  gSpecA = smoothstep(0.04, 0.45, level) * fade;
  return specColor(level) * fade;
}
vec3 seedSpec(vec2 p) {
  // Input size 100 fills the screen; smaller shrinks it into a picture inside the picture
  float fill = uScale / 2.5;
  float span = uSpecSize.y - 4.0;   // never show the row about to be written over
  if (uSpecRound > 0.5) {
    // Round: the newest sound is a small ring in the middle that spreads outward. Low pitches sit at the
    // bottom of each ring, high ones at the top, the same on both sides.
    float R = 0.5 * fill;
    float r = length(p) / R;
    if (r > 1.0) return vec3(0.0);
    float pitch = acos(clamp(-p.y / max(length(p), 1e-5), -1.0, 1.0)) / 3.14159265;
    const float HOLE = 0.1;
    float age = max(r - HOLE, 0.0) / (1.0 - HOLE) * span * 0.55;
    float fade = smoothstep(1.0, 0.8, r) * smoothstep(HOLE * 0.4, HOLE, r);
    return specPixel(specAt(pitch, age), fade);
  }
  // Scrolling: the newest sound comes in at the right edge and slides left
  vec2 hs = vec2(0.5 * uSim.x / uSim.y, 0.5) * fill;
  vec2 q = p / (2.0 * hs) + 0.5;
  vec2 e = edgeMask(q);
  if (e.x * e.y <= 0.0) return vec3(0.0);
  return specPixel(specAt(q.y, (1.0 - q.x) * span), e.x * e.y);
}
// VHS-style tracking error: a band of torn, noisy lines rolls up the picture, lines jitter sideways
// and the color smears. Everything else is a plain texture read.
vec3 sampleSrc(sampler2D tex, vec2 q, int id) {
  float trk = uAdjA[id].x;
  if (trk <= 0.0) return texture(tex, clamp(q, 0.0, 1.0)).rgb;
  float t = uTime;
  float line = floor(q.y * 240.0);
  float bandPos = 1.0 - fract(t * (0.04 + 0.12 * trk));
  float inBand = smoothstep(0.03 + 0.14 * trk, 0.0, abs(q.y - bandPos)) * trk;
  float jit = (hash(vec2(line, floor(t * 30.0))) - 0.5) * 0.014 * trk
            + sin(q.y * 23.0 + t * 3.7) * 0.004 * trk
            + (hash(vec2(line * 1.7, floor(t * 60.0))) - 0.5) * 0.2 * inBand;
  vec2 qq = clamp(q + vec2(jit, 0.0), 0.0, 1.0);
  float cs = 0.007 * trk;
  vec3 c = vec3(texture(tex, clamp(qq + vec2(cs, 0.0), 0.0, 1.0)).r,
                texture(tex, qq).g,
                texture(tex, clamp(qq - vec2(cs, 0.0), 0.0, 1.0)).b);
  float nz = step(0.72, hash(vec2(floor(q.x * 320.0), line + floor(t * 60.0))));
  return mix(c, vec3(nz), inBand * 0.75);
}
vec3 grade(vec3 c, int id) {
  vec4 a = uAdjA[id];
  c = (c - 0.5) * (1.0 + a.z) + 0.5 + a.y;                  // contrast, brightness
  c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.0 + a.w);  // color
  c = clamp(c, 0.0, 1.0);
  float key = uAdjB[id].x;                                     // cut out dark parts
  if (key > 0.0) c *= smoothstep(key - 0.06, key + 0.06, dot(c, vec3(0.299, 0.587, 0.114)));
  return c;
}
vec3 still(sampler2D tex, float asp, vec2 p, int id) {
  vec2 hs = vec2(0.3 * uScale * asp, 0.3 * uScale);
  vec2 q = p / (2.0 * hs) + 0.5;
  vec2 e = edgeMask(q);
  return grade(sampleSrc(tex, q, id), id) * e.x * e.y;
}
vec3 live(sampler2D cur, sampler2D prv, float asp, float flip, vec2 p, int id, float base) {
  vec2 hs = vec2(base * uScale * asp, base * uScale);
  vec2 q = p / (2.0 * hs) + 0.5;
  if (flip > 0.5) q.x = 1.0 - q.x;
  vec2 e = edgeMask(q);
  vec3 c = grade(sampleSrc(cur, q, id), id);
  if (uMotion > 0.5) {
    // Only what changed since the previous frame of this source gets into the loop
    float d = length(c - grade(sampleSrc(prv, q, id), id));
    float m = smoothstep(0.07, 0.24, d);
    c = (c * 1.6 + 0.3 * hsv(fract(uTime * 0.05 + d), 0.8, 1.0)) * m;
  }
  return c * e.x * e.y;
}
// Text: the words typed under Text, drawn white (with a soft glow) into their own picture and tinted here with
// slowly turning colors. At Input size 100 they reach nearly across the screen, at 50 a bit over half way.
vec3 seedText(vec2 p, float t) {
  float w = 0.95 * (uSim.x / uSim.y) * pow(uScale / 2.5, 0.6);
  vec2 q = p / vec2(w, w / uAspText) + 0.5;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec3(0.0);
  float l = texture(uText, q).r;
  return hsv(fract(t * 0.05 + q.x * 0.3), 0.55, 1.0) * l;
}
// Patchwork: a hand-inked grid like Nick's sketchbook pages, made of turning tiles whose lines join up. Every tile's
// three marker lanes leave its edges at the same three spots (a sixth, half and five sixths of the way along), so
// however a tile is turned, its lanes run on into its neighbours' and together they draw long paths, loops, mazes
// and weaves. Every few seconds a ripple runs across the page and tiles turn a quarter (or half) turn, lifting
// slightly as they go, and the lines snap together into a new pattern. Each stretch of turns follows one rule
// (random, diagonal waves, spinning checks, rings, a four-way mirror) and one mix of tiles, then moves on.
const vec3 PW_PAL[16] = vec3[16](
  vec3(0.93, 0.42, 0.62), vec3(0.72, 0.16, 0.42), vec3(0.52, 0.36, 0.75), vec3(0.18, 0.20, 0.62),
  vec3(0.20, 0.62, 0.80), vec3(0.10, 0.46, 0.42), vec3(0.52, 0.84, 0.70), vec3(0.84, 0.92, 0.30),
  vec3(0.98, 0.78, 0.22), vec3(0.98, 0.50, 0.16), vec3(0.95, 0.60, 0.52), vec3(0.52, 0.28, 0.18),
  vec3(0.07, 0.07, 0.09), vec3(0.55, 0.55, 0.58), vec3(0.80, 0.60, 0.86), vec3(0.36, 0.68, 0.28));
const vec3 PW_PAPER = vec3(0.80, 0.78, 0.74);
vec3 pwCol(float h) { return PW_PAL[int(h * 16.0) & 15]; }
// A marker stroke: solid color, a darker rim and faint pen strokes. d is how far inside the stroke (cells),
// s runs across it.
vec3 pwInk(vec3 base, vec3 c, float d, float s, float aa) {
  vec3 ink = c * (0.9 + 0.1 * sin(s * 70.0)) * mix(0.62, 1.0, smoothstep(0.0, 0.06, d));
  return mix(base, ink, smoothstep(0.0, aa, d));
}
const float PW_HW = 0.1;   // half the width of a lane
// One lane: d is the distance from its middle line, mid says it's the middle lane (its own color)
vec3 pwLane(vec3 c, float d, float s, bool mid, vec3 cMid, vec3 cOut, float aa) {
  return pwInk(c, mid ? cMid : cOut, PW_HW - abs(d), d * 3.0, aa);
}
// The three straight lanes across a tile (as distances from each), nearest first
vec2 pwStraight(float y) {   // x: distance to the nearest lane, y: 1 if it's the middle one
  float a = y - 1.0 / 6.0, b = y - 0.5, c = y - 5.0 / 6.0;
  float m = abs(a) < abs(b) ? a : b; if (abs(c) < abs(m)) m = c;
  return vec2(m, m == b ? 1.0 : 0.0);
}
// type 0: straight lanes; 1: curves (quarter circles round the corners, a Truchet tile); 2: a woven crossing,
// across over up or up over across; 3: one curve and two straight (the middle lane bends round a corner)
vec3 pwTile(vec2 v, int type, bool over, vec3 cMid, vec3 cOut, float aa) {
  vec3 c = PW_PAPER;
  if (type == 0) {
    vec2 s = pwStraight(v.y);
    return pwLane(c, s.x, v.x, s.y > 0.5, cMid, cOut, aa);
  }
  if (type == 1) {
    // Corner (0,0): the inner lane and the middle lane; corner (1,1) the same; the two other corners the outer lanes
    float r0 = length(v), r1 = length(v - 1.0), r2 = length(v - vec2(1.0, 0.0)), r3 = length(v - vec2(0.0, 1.0));
    float d = r0 - 0.5; bool mid = true; float s = atan(v.y, v.x);
    if (abs(r1 - 0.5) < abs(d)) { d = r1 - 0.5; s = atan(v.y - 1.0, v.x - 1.0); }
    float o = r0 - 1.0 / 6.0;
    if (abs(r1 - 1.0 / 6.0) < abs(o)) o = r1 - 1.0 / 6.0;
    if (abs(r2 - 1.0 / 6.0) < abs(o)) o = r2 - 1.0 / 6.0;
    if (abs(r3 - 1.0 / 6.0) < abs(o)) o = r3 - 1.0 / 6.0;
    if (abs(o) < abs(d)) { d = o; mid = false; }
    return pwLane(c, d, s, mid, cMid, cOut, aa);
  }
  if (type == 2) {
    vec2 a = pwStraight(over ? v.x : v.y), b = pwStraight(over ? v.y : v.x);   // b goes on top
    c = pwLane(c, a.x, over ? v.y : v.x, a.y > 0.5, cMid, cOut, aa);
    c = mix(c, PW_PAPER, smoothstep(0.0, aa, PW_HW + 0.06 - abs(b.x)));   // a gap either side, so it reads as over
    return pwLane(c, b.x, over ? v.x : v.y, b.y > 0.5, cMid, cOut, aa);
  }
  // Mixed: the outer lanes run straight across; the middle lanes from the bottom and right edges join in a curve
  // that weaves under them, and those from the left and top edges end in dots
  vec2 s = pwStraight(v.y);
  if (s.y < 0.5) c = pwLane(c, s.x, v.x, false, cMid, cOut, aa);
  float r = length(v - vec2(1.0, 0.0)) - 0.5;
  c = mix(c, PW_PAPER, smoothstep(0.0, aa, PW_HW + 0.06 - abs(r)));
  c = pwLane(c, r, v.x + v.y, true, cMid, cOut, aa);
  // ...and the left edge's middle lane ends in a dot, and so does the top's
  float e = min(length(v - vec2(0.0, 0.5)), length(v - vec2(0.5, 1.0))) - 0.17;
  return pwInk(c, cMid, -e, v.x, aa);
}
// How a tile is turned (0 to 3 quarter turns) at step n, by the rule of this stretch of steps
float pwTurn(vec2 cell, float n, vec2 ctr) {
  float E = floor(n / 6.0), k = floor(hash(vec2(E, 4.2)) * 5.0);
  vec2 d = cell - ctr;
  float o;
  if (k < 1.0) o = floor(hash(cell + n * 0.37) * 4.0);                                     // random
  else if (k < 2.0) o = cell.x + cell.y + n;                                               // diagonal waves
  else if (k < 3.0) o = mod(cell.x + cell.y, 2.0) < 0.5 ? n : -n + floor(hash(cell) * 2.0); // spinning checks
  else if (k < 4.0) o = floor(length(d) / 2.0) + n;                                         // rings
  else {                                                                                     // four-way mirror
    vec2 q = abs(d + 0.5);
    o = floor(hash(floor(q) + n * 0.61) * 4.0) + (d.x < 0.0 ? 1.0 : 0.0) + (d.y < 0.0 ? 2.0 : 0.0);
  }
  return mod(o, 4.0);
}
int pwType(vec2 cell, float n) {
  float E = floor(n / 6.0), mixk = hash(vec2(E, 9.7)), h = hash(cell * 0.93 + E * 5.3);
  if (mixk < 0.3) return 1;                                  // all curves: a classic maze of loops
  if (mixk < 0.5) return h < 0.6 ? 1 : 0;                    // curves and straights
  if (mixk < 0.7) return h < 0.55 ? 2 : 0;                   // a woven cloth
  return h < 0.4 ? 1 : h < 0.6 ? 0 : h < 0.8 ? 2 : 3;        // everything
}
vec3 seedPatch(vec2 p, float t) {
  // Input size 100 fills the screen; smaller makes it a page in the middle
  float fill = uScale / 2.5;
  vec2 hs = vec2(0.5 * uSim.x / uSim.y, 0.5) * fill;
  if (abs(p.x) > hs.x || abs(p.y) > hs.y) return vec3(0.0);
  const float N = 16.0;              // tiles from top to bottom
  vec2 g = p / fill * N;
  float aa = N / (fill * uSim.y);    // one pixel, in tiles
  vec2 cell = floor(g), u = fract(g);
  // A step every 2.6 s; it ripples out from a point that moves with each stretch of six steps
  const float W = 2.6;
  float E0 = floor(t / (W * 6.0));
  vec2 ctr = floor((vec2(hash(vec2(E0, 1.3)), hash(vec2(E0, 7.9))) - 0.5) * vec2(N * uSim.x / uSim.y, N));
  float tl = t - length(cell + 0.5 - ctr) * 0.07;
  float n = floor(tl / W), a = clamp((fract(tl / W) * W) / 0.9, 0.0, 1.0);   // a: how far through turning
  float o0 = pwTurn(cell, n - 1.0, ctr), o1 = pwTurn(cell, n, ctr);
  float dlt = mod(o1 - o0, 4.0); if (dlt > 2.5) dlt -= 4.0;
  float ea = a * a * (3.0 - 2.0 * a);
  float ang = (o0 + dlt * ea) * 1.5707963;
  // While it turns a tile lifts and shrinks a little, so the corners never poke into the next one
  float lift = (dlt != 0.0 || pwType(cell, n - 1.0) != pwType(cell, n)) ? sin(3.14159265 * a) : 0.0;
  float sc = 1.0 - 0.22 * lift;
  vec2 v = rot(ang) * (u - 0.5) / sc + 0.5;
  vec3 gap = vec3(0.12, 0.10, 0.14);
  vec3 c;
  if (v.x < 0.0 || v.y < 0.0 || v.x > 1.0 || v.y > 1.0) c = gap;
  else {
    float nn = a < 0.5 ? n - 1.0 : n;
    // Colors by patch: the middle lanes one color, the outer lanes another, so joined lanes read as one path.
    // A new set of colors sweeps across the page about every 30 s.
    float P = floor((t - (g.x + g.y) * 0.25) / 30.0);
    float hP = hash(floor((cell + 0.5) / 7.0) + P * 13.1);
    vec3 cMid = pwCol(hP), cOut = pwCol(fract(hP * 7.31 + 0.5));
    bool over = mod(cell.x + cell.y + floor(nn / 6.0), 2.0) < 0.5;
    c = pwTile(v, pwType(cell, nn), over, cMid, cOut, aa / sc);
    // The inked grid line round each tile, faint so the lanes read as running on
    float gl = min(min(v.x, 1.0 - v.x), min(v.y, 1.0 - v.y));
    c = mix(mix(gap, c, 0.65), c, smoothstep(0.0, aa * 1.5, gl - 0.01));
  }
  // Laid over the trails like the spectrograph (see main), never added to them as light, so the white paper can't
  // pile up into a white screen. The ink covers almost fully; the paper less and less as Trails goes up, so the
  // echoes show through the gaps between the lanes.
  float inked = clamp(length(c - PW_PAPER) * 5.0, 0.0, 1.0);
  gSpecA = mix(mix(1.0, 0.25, smoothstep(0.3, 0.97, uDecay)), 0.9, inked);
  return c;
}
vec3 source(int id, vec2 p, sampler2D scene) {
  vec2 g = p / uScale;
  if (id == 0) return seedWave(g, uTime);
  if (id == 1) return seedShape(g, uTime);
  if (id == 2) return seedBars(g, uTime);
  if (id == 3) return seedSparks(g, uTime);
  if (id == 11) return seedInk(p);
  if (id == 12) return seedPatch(p, uTime);
  if (id == 22) return seedSpec(p);
  if (id == 24) return seedText(p, uTime);
  // The 3D worlds (Cubes to Nebula, City, and Mount Ribbit at 31) and the fractal flights (25 to 30), each drawn just before this
  // pass (see draw3D) filling the screen
  if ((id >= 13 && id <= 21) || id == 23 || (id >= 25 && id <= 31)) return uSceneK * texture(scene, clamp(p / vec2(uSim.x / uSim.y, 1.0) + 0.5, 0.0, 1.0)).rgb;
  if (id == 4) return still(uPic, uAspPic, p, 4);
  if (id == 5) return live(uVid0, uVid1, uAspVid, 0.0, p, 5, 0.3);
  if (id == 6) return live(uCam0, uCam1, uAspCam, uFlipCam, p, 6, 0.3);
  if (id == 7) return live(uScr0, uScr1, uAspScr, 0.0, p, 7, 0.3);
  if (id == 8) return live(uPho0, uPho1, uAspPho, uFlipPho, p, 8, 0.3);
  // The other loop's picture: at the default size it lines up exactly with the screen
  if (id == 10) return live(uOther, uOtherPrev, uSim.x / uSim.y, 0.0, p, 10, 0.5);
  return vec3(0.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSim;
  float asp = uSim.x / uSim.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  vec2 pf = fold(p, uMirror);

  // Where this pixel was one frame ago
  vec2 q = rot(uSpin) * (pf - uCenter) * exp(-uZoom) + uCenter;
  if (uJulia > 0.0) q = mix(q, juliaAt(q), uJulia);
  if (uCrystal > 0.0) q = crystalAt(q);
  q -= uShift;
  if (uFlow > 0.0) q -= uFlow * flowAt(q, uTime * 0.6);
  if (uInkDt > 0.0) q -= uInkDt * inkPush(pf);
  q += uWarp * vec2(sin(q.y * 7.0 + uTime * 1.1 + sin(q.x * 3.0 + uTime * 0.5)),
                    cos(q.x * 7.0 - uTime * 0.9 + sin(q.y * 2.0 - uTime * 0.3)));
  if (uMelt > 0.0) q += meltAt(q, asp);
  if (uPush > 0.0) q += pushAt(q, asp);
  if (uLook > 0.0) q = lookAt(q, asp);
  // Split lines: every other line of pixels slides left, the lines between slide right
  float side = mod(floor(gl_FragCoord.y / uPxK), 2.0) < 0.5 ? 1.0 : -1.0;
  q.x += uSplit * side;
  vec2 st = q / vec2(asp, 1.0) + 0.5;
  float inside = 1.0;
  if (uEdge > 0.5) {
    vec2 m = mod(st, 2.0);
    st = mix(m, 2.0 - m, step(1.0, m));
  } else {
    vec2 b = step(vec2(0.0), st) * step(st, vec2(1.0));
    inside = b.x * b.y;
  }
  vec2 px = uPxK / uSim;
  vec3 c0 = uChroma > 0.0 ? chromaAt(st, asp) : texture(uPrev, st).rgb;
  vec3 cb = 0.25 * (texture(uPrev, st + vec2(px.x, 0.0)).rgb + texture(uPrev, st - vec2(px.x, 0.0)).rgb +
                    texture(uPrev, st + vec2(0.0, px.y)).rgb + texture(uPrev, st - vec2(0.0, px.y)).rgb);
  vec3 fb = c0 + (cb - c0) * uBlur;
  // Restless: only what is changing gets to stay. The picture that lands here is compared with what was here
  // a frame ago; where they match, it fades away.
  // Both are softened first, so it follows real movement rather than feeding on its own grain.
  if (uRestless > 0.0) {
    vec3 here = 0.25 * (texture(uPrev, uv + vec2(px.x, 0.0)).rgb + texture(uPrev, uv - vec2(px.x, 0.0)).rgb +
                        texture(uPrev, uv + vec2(0.0, px.y)).rgb + texture(uPrev, uv - vec2(0.0, px.y)).rgb);
    vec3 d = abs(cb - here);
    fb *= 1.0 - uRestless + uRestless * smoothstep(0.004, 0.06, luma(d));
  }
  if (uGrow > 0.0) fb = growAt(fb, cb, st);
  // Cross-feed: the other loop's last frame is poured in through this loop's zoom, spin and warp
  if (uXfeed > 0.0) fb = mix(fb, texture(uOther, st).rgb, uXfeed * 0.5);
  if (uDye > 0.0) fb = dyeBy(fb, pf, asp);
  fb = max(hueRot(fb, uHue), 0.0);
  fb = clamp(fb * uDecay - uFloor, 0.0, 1.0) * inside;

  vec2 ps = pf + vec2(uSplitOff * side, 0.0);
  gSpecA = 0.0;
  vec3 s = source(uIn1, ps, uScene1);
  float specA = gSpecA;
  if (uIn2 != 9) {
    gSpecA = 0.0;
    vec3 s2 = source(uIn2, ps, uScene2);
    float w1 = min(1.0, 2.0 * (1.0 - uBlend)), w2 = min(1.0, 2.0 * uBlend);
    specA = max(specA * w1, gSpecA * w2);
    s = 1.0 - (1.0 - clamp(s * w1, 0.0, 1.0)) * (1.0 - clamp(s2 * w2, 0.0, 1.0));
  }
  s *= uGain;

  float bd = sdSeg(pf, uBrush.xy, uBrush.zw);
  s += uBrushCol * (exp(-bd * bd / (0.011 * 0.011)) + 0.25 * exp(-bd / 0.02)) * uBrushOn;

  s = clamp(s, 0.0, 1.0);
  vec3 outc = 1.0 - (1.0 - fb) * (1.0 - s);
  // Where the spectrograph is loud it shows as itself over the trails; where it's quiet the trails show through
  if (specA > 0.0) outc = mix(outc, s, specA);
  o = vec4(outc, 1.0);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uA, uB;
uniform float uWA, uWB;
uniform vec2 uSim;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uSim;
  vec3 a = texture(uA, uv).rgb * uWA;
  vec3 b = texture(uB, uv).rgb * uWB;
  o = vec4(1.0 - (1.0 - a) * (1.0 - b), 1.0);
}`;

// Time warp: each part of a loop's picture comes from a different moment. The loop's recent frames are kept
// (see twStep) in a stack, newest on top; how far each pixel is from the "now" edge (or the middle) picks how
// far down the stack it reads, blending between neighbouring frames so the picture never steps.
const FS_TIMEWARP = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2D uNow;
uniform sampler2DArray uHist;
uniform vec2 uSim;
uniform float uHead, uFilled, uLayers, uSince, uRate, uSpan, uShape;
out vec4 o;
vec3 kept(float j, vec2 uv) { return texture(uHist, vec3(uv, mod(uHead - j + uLayers, uLayers))).rgb; }
void main() {
  vec2 uv = gl_FragCoord.xy / uSim;
  float asp = uSim.x / uSim.y;
  float d;
  if (uShape < 0.5) d = 1.0 - uv.y;            // the top is now, the bottom is longest ago
  else if (uShape < 1.5) d = uv.x;             // the left is now, the right is longest ago
  else d = min(1.0, length((uv - 0.5) * vec2(asp, 1.0)) / (0.5 * length(vec2(asp, 1.0))));   // the middle is now
  float age = d * uSpan;                       // seconds ago
  vec3 now = texture(uNow, uv).rgb;
  if (uFilled < 1.0) { o = vec4(now, 1.0); return; }
  // The newest kept frame is uSince old; between it and now, blend the two
  float j = (age - uSince) * uRate;
  if (j <= 0.0) {
    float a = uSince > 0.0 ? clamp(age / uSince, 0.0, 1.0) : 1.0;
    o = vec4(mix(now, kept(0.0, uv), a), 1.0);
    return;
  }
  j = min(j, uFilled - 1.0);
  float j0 = floor(j);
  o = vec4(mix(kept(j0, uv), kept(min(j0 + 1.0, uFilled - 1.0), uv), j - j0), 1.0);
}`;

const FS_DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime, uStatic, uLines, uFlash, uPunch, uHueKick;
uniform vec2 uShake;   // the music's jolt: its direction, times how hard
out vec4 o;
${COMMON}
vec3 hueTurn(vec3 c, float a) {
  const vec3 k = vec3(0.57735027);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 cuv = uv;
  // Music hits land straight on the screen: a punch in on the kick and a jolt on the beat,
  // zoomed in just enough that the jolt never shows the edge
  float jolt = length(uShake);
  cuv = (cuv - 0.5) / (1.0 + uPunch + jolt * 0.022) + 0.5 + uShake * 0.008;
  float line = floor(uv.y * uLines);
  cuv.x += (hash(vec2(line, floor(uTime * 60.0))) - 0.5) * 0.03 * uStatic;
  vec2 ca = uShake * 0.01;
  vec3 col;
  col.r = texture(uTex, cuv + ca).r;
  col.g = texture(uTex, cuv).g;
  col.b = texture(uTex, cuv - ca).b;
  if (uHueKick != 0.0) col = max(hueTurn(col, uHueKick), 0.0);

  col *= 1.0 + uFlash;
  col = mix(col, vec3(hash(gl_FragCoord.xy * 0.5 + fract(uTime) * 113.0)), uStatic * 0.9);
  vec2 e = smoothstep(vec2(0.0), vec2(0.006), cuv) * smoothstep(vec2(1.0), vec2(0.994), cuv);
  col *= e.x * e.y;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;


// The 3D flights. Each draws its picture in a pass of its own (see draw3D), only while something uses it,
// so the feedback pass stays as quick as before for every other input.
// Cubes: a flight down a lane through floating cubes towards a glowing light.
const FS_CUBES = `#version 300 es
precision highp float;
uniform vec2 uSim;
uniform float uTime;     // seconds; turns and sways the camera
uniform float uTravel;   // how far the camera has flown, in cubes (wraps every 2048)
uniform float uLens;     // how wide the lens is: tan of half the height of the view
uniform float uGlow;     // how bright the light at the end is (the music pushes it up)
uniform float uSeed;     // loop B flies through a field of its own
out vec4 o;
const float PERIOD = 2048.0;
const float ORB_D = 26.0, ORB_R = 2.3;   // the light flies ahead of the camera, always this far away
float h31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
// What floats in the cube-sized cell c: the cube's centre (xyz) and half its width (w, 0 = empty).
// Cubes mostly keep a lane clear down the middle; the few inside it still leave the camera room to pass.
vec4 cellCube(vec3 c, float orbZ) {
  // The cubes fill a thick tube round the lane and thin out towards its outside, where space is empty
  float lat = max(abs(c.x + 0.5), abs(c.y + 0.5));
  if (lat > 8.0) return vec4(0.0);
  vec3 k = vec3(c.xy, mod(c.z, PERIOD)) + uSeed;
  if (h31(k) > 0.36 * smoothstep(8.5, 3.0, lat)) return vec4(0.0);
  float a = h31(k + 17.1), b = h31(k + 41.7), d = h31(k + 73.3), e = h31(k + 5.9);
  float s = mix(0.06, 0.4, a * a * a);
  vec3 cen = c + 0.5 + (vec3(b, d, e) - 0.5) * (1.0 - 2.0 * s);
  float gap = max(abs(cen.x), abs(cen.y)) - s;
  if (gap < 0.25 || (gap < 1.5 && h31(k + 29.3) > 0.2)) return vec4(0.0);
  // Nothing inside the light itself, and only a few small cubes just in front of it
  float dOrb = length(cen - vec3(0.0, 0.0, orbZ));
  if (dOrb < ORB_R + s * 0.9 || (dOrb < ORB_R * 2.4 && (s > 0.14 || h31(k + 51.7) > 0.4))) return vec4(0.0);
  return vec4(cen, s);
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  float t = uTime;
  // The camera flies straight down the lane, looking around a little and slowly rolling
  vec3 fw = normalize(vec3(0.07 * sin(t * 0.11), 0.05 * sin(t * 0.083 + 1.0), 1.0));
  float roll = t * 0.035 + 0.35 * sin(t * 0.047);
  vec3 upW = vec3(sin(roll), cos(roll), 0.0);
  vec3 rt = normalize(cross(upW, fw)), up = cross(fw, rt);
  vec2 sp = p * 2.0 * uLens;
  vec3 rd = normalize(fw + sp.x * rt + sp.y * up);
  vec3 ro = vec3(0.0, 0.0, uTravel);
  vec3 orb = vec3(0.0, 0.0, uTravel + ORB_D);
  float pix = 2.0 * uLens / uSim.y;   // how wide one pixel is, one cube away

  // Where the ray meets the light, if it does
  vec3 oc = ro - orb;
  float bq = dot(oc, rd), cq = dot(oc, oc) - ORB_R * ORB_R, disc = bq * bq - cq;
  float tOrb = disc > 0.0 ? -bq - sqrt(disc) : 1e5;
  float dMiss = sqrt(max(dot(oc, oc) - bq * bq, 0.0));   // how close the ray passes the light's centre
  float tEnd = min(tOrb, ORB_D + 14.0);

  // Walk the ray from cell to cell (each cell holds at most one cube and one speck of dust)
  vec3 cell = floor(ro);
  vec3 stp = sign(rd);
  vec3 inv = 1.0 / rd;
  vec3 tMax = (cell + max(stp, 0.0) - ro) * inv;
  vec3 tDel = abs(inv);
  float tHit = 1e5;
  vec3 nrm = vec3(0.0), cen = vec3(0.0);
  float size = 0.0;
  vec3 dust = vec3(0.0);
  for (int i = 0; i < 72; i++) {
    vec4 cb = cellCube(cell, orb.z);
    if (cb.w > 0.0) {
      vec3 n = inv * (ro - cb.xyz), kk = abs(inv) * cb.w;
      vec3 t1 = -n - kk, t2 = -n + kk;
      float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z);
      if (tN < tF && tN > 0.0 && tN < tEnd) {
        tHit = tN;
        nrm = -stp * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
        cen = cb.xyz; size = cb.w;
        break;
      }
    }
    // A speck of dust floating in about every fourth cell, twinkling
    vec3 kd = vec3(cell.xy, mod(cell.z, PERIOD)) + uSeed * 1.7;
    float hd = h31(kd + 91.3);
    if (hd < 0.25) {
      vec3 pp = cell + 0.2 + 0.6 * vec3(h31(kd + 3.3), h31(kd + 7.7), h31(kd + 13.1));
      float tp = dot(pp - ro, rd);
      if (tp > 0.3 && tp < tEnd) {
        float w = max(0.01, tp * pix * 0.8);
        vec3 dd = ro + rd * tp - pp;
        float tw = 0.5 + 0.5 * sin(t * (2.0 + 3.0 * hd) + hd * 60.0);
        float lit = 0.25 + 1.5 / (1.0 + 0.02 * dot(pp - orb, pp - orb));
        dust += mix(vec3(1.0, 0.55, 0.75), vec3(0.85, 0.95, 1.0), step(0.08, hd))
              * exp(-dot(dd, dd) / (w * w)) * tw * min(1.0, 0.012 / w) * lit;
      }
    }
    float tNext = min(min(tMax.x, tMax.y), tMax.z);
    if (tNext > tEnd) break;
    vec3 m = step(tMax.xyz, tMax.yzx) * step(tMax.xyz, tMax.zxy);
    cell += m * stp;
    tMax += m * tDel;
    // Rays start in the middle and only move outwards, so once past the cubes and dust there's nothing left
    if (max(abs(cell.x + 0.5), abs(cell.y + 0.5)) > 11.0) break;
  }

  vec3 col;
  float tSeen = min(tHit, tEnd);
  if (tHit < 1e4) {
    vec3 hp = ro + rd * tHit;
    vec3 lp = (hp - cen) / size;   // -1..1 across the cube
    vec2 fuv = abs(nrm.x) > 0.5 ? lp.yz : abs(nrm.y) > 0.5 ? lp.xz : lp.xy;
    vec3 kc = vec3(floor(cen.xy), mod(floor(cen.z), PERIOD)) + uSeed;
    float fid = dot(nrm, vec3(1.0, 2.0, 3.0));
    // Each face is cut into panels, some cut again: pale metal, dark gaps, now and then red
    vec2 u = (fuv * 0.5 + 0.5) * (1.0 + floor(h31(kc + 2.2) * 2.0));
    vec2 g = floor(u), f = fract(u);
    float ph = h31(vec3(g, fid) + kc * 1.31);
    float seamW = 0.06;
    if (ph < 0.55) { g = g * 2.0 + floor(f * 2.0); f = fract(f * 2.0); ph = h31(vec3(g, fid + 7.0) + kc * 1.31); seamW = 0.1; }
    if (ph < 0.3) { g = g * 2.0 + floor(f * 2.0); f = fract(f * 2.0); ph = h31(vec3(g, fid + 13.0) + kc * 1.31); seamW = 0.14; }
    float seam = smoothstep(0.0, seamW, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    vec3 alb = ph < 0.14 ? vec3(0.9, 0.1, 0.13) : ph < 0.34 ? vec3(0.1) : vec3(0.3 + 0.62 * ph * ph) * vec3(0.92, 0.96, 1.0);
    alb *= 0.45 + 0.55 * seam;
    // Far away, where the panels shrink below a few pixels, the face fades to its average so it doesn't shimmer
    alb = mix(vec3(0.3, 0.26, 0.28), alb, smoothstep(0.004, 0.02, size / (tHit * pix * 200.0)));
    // Lit by the light ahead: faces turned towards it glow cold white, faces turned away fall dark,
    // and the nearer a cube is to the light, the brighter
    vec3 toL = orb - hp;
    float dl = length(toL);
    toL /= dl;
    float fall = 1.0 / (1.0 + 0.012 * dl * dl);
    float diff = max(dot(nrm, toL), 0.0);
    float edge = smoothstep(0.8, 0.97, max(abs(fuv.x), abs(fuv.y)));
    float amb = 0.03 + 0.25 * fall;
    // A dim red light from behind the camera catches the faces turned towards it
    float red = max(dot(nrm, normalize(vec3(0.3, -0.45, -1.0))), 0.0);
    // and a soft grey one from the camera shows the panels on cubes a little way off, leaving the nearest in shadow
    float fill = max(dot(nrm, -rd), 0.0) * smoothstep(2.5, 9.0, tHit) * exp(-tHit * 0.03);
    col = alb * (vec3(0.78, 0.92, 1.0) * diff * fall * 3.2 + vec3(0.4, 0.42, 0.5) * amb * 0.5
                 + vec3(0.6, 0.7, 0.8) * fill * 0.2);
    // The red light shows up on the red panels, not as a pink wash over the grey ones
    col += vec3(0.9, 0.06, 0.12) * red * (0.08 + 0.6 * fall) * max(alb.r - alb.g, 0.0);
    col += vec3(0.5, 0.85, 1.0) * edge * diff * fall * 2.8;
    // Cubes close in front of the camera stand dark red against the glow
    col *= 0.25 + 0.75 * smoothstep(1.0, 6.0, tHit);
    col += vec3(0.09, 0.008, 0.03) * smoothstep(9.0, 1.0, tHit);
    // Right by the light they are lost in its glare
    col = mix(col, vec3(1.0, 0.55, 0.95) * uGlow, smoothstep(ORB_R + 2.2, ORB_R + 0.4, length(hp - orb)) * 0.85);
    // Seen against the light, a cube glows magenta round its edges
    col += vec3(0.85, 0.08, 0.6) * 0.5 * uGlow * smoothstep(ORB_R * 1.15, ORB_R * 0.7, dMiss);
  } else if (tOrb < 1e4) {
    // The light itself: white hot, magenta round its rim
    float mu = clamp(dMiss / ORB_R, 0.0, 1.0);
    col = mix(vec3(1.3, 1.28, 1.3), vec3(1.0, 0.12, 0.7), smoothstep(0.7, 0.97, mu)) * uGlow;
  } else {
    col = vec3(0.0);
  }
  // Haze between the camera and whatever it sees, lit by the light ahead
  float ang = atan(dMiss, max(-bq, 0.01));
  vec3 hz = vec3(0.25, 0.75, 1.0) * exp(-ang * ang / 0.04) * 0.75
          + vec3(0.5, 0.06, 0.3) * exp(-ang / 0.3) * 0.16
          + vec3(0.3, 0.02, 0.08) * exp(-ang / 0.7) * 0.08;
  col += hz * uGlow * (1.0 - exp(-tSeen * 0.05));
  // Bloom from the light spills over everything in front of it
  float rim = max(dMiss - ORB_R, 0.0) / ORB_D;
  float front = tHit < tOrb ? 0.45 : tOrb < 1e4 ? 0.0 : 1.0;   // not over the light's own disc, so its rim stays magenta
  col += (vec3(0.9, 0.1, 0.65) * 0.35 * exp(-rim * rim / 0.0002) + vec3(0.2, 0.7, 1.0) * 0.45 * exp(-rim / 0.06)) * uGlow * front;
  // The dark red of the space itself, strongest towards the middle
  col += vec3(0.12, 0.008, 0.04) * exp(-ang / 0.55) * (1.0 - exp(-tSeen * 0.08));
  col += dust;
  o = vec4(col, 1.0);
}`;

// Horizon: a low flight along a wet valley floor towards a striped sunset, glowing grid mountains either side.
const FS_HORIZON = `#version 300 es
precision highp float;
uniform vec2 uSim;
uniform float uTime;     // seconds; sways and banks the flight
uniform float uTravel;   // how far the flight has come (wraps every ZP, where the land repeats)
uniform float uLens;     // how wide the lens is: tan of half the height of the view
uniform float uGlow;     // how bright the sun and the lines are (the music pushes it up)
uniform float uSeed;     // loop B flies over land of its own
out vec4 o;
const float ZP = 512.0;
float h21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// Smooth random hills that repeat every per squares going forward, so the land repeats every ZP
float vnoise(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float z0 = mod(i.y, per), z1 = mod(i.y + 1.0, per);
  float a = h21(vec2(i.x, z0) + uSeed), b = h21(vec2(i.x + 1.0, z0) + uSeed);
  float c = h21(vec2(i.x, z1) + uSeed), d = h21(vec2(i.x + 1.0, z1) + uSeed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float lift() { return 1.0 + (uGlow - 1.0) * 0.5; }   // the mountains swell a little with the music
// Mountains on both sides of a flat valley floor that the flight follows
float terrain(vec2 p) {
  float side = smoothstep(2.5, 13.0, abs(p.x));
  if (side <= 0.0) return 0.0;
  float n = 0.0, a = 0.62, fr = 0.1, per = 51.2;
  for (int i = 0; i < 2; i++) {
    float v = vnoise(p * fr + vec2(float(i) * 37.0, 0.0), per);
    n += a * (i == 0 ? 1.0 - abs(2.0 * v - 1.0) : v);   // sharp ridges, then some rolling detail
    a *= 0.4; fr *= 2.0; per *= 2.0;
  }
  return side * side * (n * n * 13.0 + abs(p.x) * 0.12) * lift();
}
const vec3 SUN = vec3(0.0, 0.06, 0.9982);
vec3 sky(vec3 rd) {
  float y = rd.y;
  vec3 c = mix(vec3(0.95, 0.32, 0.45), vec3(0.2, 0.03, 0.28), smoothstep(-0.02, 0.22, y));
  c = mix(c, vec3(0.02, 0.0, 0.06), smoothstep(0.18, 0.6, y));
  // The sun: a big disc going from gold to magenta, cut by stripes that thicken towards its foot
  vec2 sp = rd.xy / max(rd.z, 0.01) - SUN.xy / SUN.z;
  float r = length(sp), R = 0.2;
  vec3 sunCol = mix(vec3(1.0, 0.18, 0.6), vec3(1.0, 0.78, 0.25), smoothstep(-R * 0.7, R, sp.y));
  float band = sp.y < R * 0.15 ? step(0.18 + 0.55 * smoothstep(R * 0.15, -R, sp.y), fract(sp.y * 28.0 + uTime * 0.25)) : 1.0;
  float disc = smoothstep(R, R - 0.004, r) * band;
  c = mix(c, sunCol * 1.25 * uGlow, disc);
  c += vec3(1.0, 0.3, 0.55) * 0.35 * exp(-max(r - R, 0.0) * 9.0) * uGlow;
  // Stars higher up
  vec2 sg = rd.xz / max(rd.y, 0.02) * 60.0;
  vec2 si = floor(sg);
  float sh = h21(si + 7.0);
  float star = step(0.985, sh) * smoothstep(0.12, 0.0, length(fract(sg) - 0.5)) * smoothstep(0.08, 0.3, y);
  c += vec3(0.8, 0.85, 1.0) * star * (0.5 + 0.5 * sin(uTime * 3.0 + sh * 50.0));
  return c;
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  float t = uTime;
  // Flying low along the valley floor, drifting side to side and banking gently
  vec3 ro = vec3(0.7 * sin(t * 0.13), 1.3 + 0.35 * sin(t * 0.21), uTravel);
  vec3 fw = normalize(vec3(-0.08 * cos(t * 0.13), -0.075 + 0.03 * sin(t * 0.17), 1.0));
  float roll = -0.07 * cos(t * 0.13) + 0.03 * sin(t * 0.29);
  vec3 upW = vec3(sin(roll), cos(roll), 0.0);
  vec3 rt = normalize(cross(upW, fw)), up = cross(fw, rt);
  vec2 sp = p * 2.0 * uLens;
  vec3 rd = normalize(fw + sp.x * rt + sp.y * up);
  float pix = 2.0 * uLens / uSim.y;

  // March until the ray meets the land, or leaves over the top of every mountain
  const float FAR = 140.0;
  float top = 15.0 * lift();
  float tt = 0.05, tPrev = 0.05, hit = 0.0;
  vec3 pos;
  for (int i = 0; i < 110; i++) {
    pos = ro + rd * tt;
    float d = pos.y - terrain(pos.xz);
    if (d < 0.0015 * tt) { hit = 1.0; break; }
    if (tt > FAR || (pos.y > top && rd.y > 0.0)) break;
    tPrev = tt;
    tt += max(d * 0.42, 0.012 * tt);
  }
  // Pin down exactly where it met the land, so the lines on the slopes stay crisp
  if (hit > 0.5) {
    float a = tPrev, b = tt;
    for (int i = 0; i < 5; i++) {
      float m = 0.5 * (a + b);
      vec3 q = ro + rd * m;
      if (q.y - terrain(q.xz) < 0.0) b = m; else a = m;
    }
    tt = b;
    pos = ro + rd * tt;
  }
  vec3 col;
  vec3 haze = mix(vec3(0.95, 0.3, 0.5), vec3(0.35, 0.06, 0.4), smoothstep(0.0, 0.25, rd.y));
  if (hit > 0.5) {
    vec2 e = vec2(0.04, 0.0);
    vec3 n = normalize(vec3(terrain(pos.xz - e.xy) - terrain(pos.xz + e.xy), 2.0 * e.x,
                            terrain(pos.xz - e.yx) - terrain(pos.xz + e.yx)));
    // A glowing grid laid over the land: magenta low down, cyan up on the peaks.
    // Far away the lines blend into their average glow instead of flickering.
    float foot = tt * pix / max(abs(dot(rd, n)), 0.2);
    vec2 g = abs(fract(pos.xz + 0.5) - 0.5);
    float w0 = 0.035;
    vec2 w = vec2(w0) + foot;
    vec2 ln = (1.0 - smoothstep(vec2(0.0), w, g)) * (w0 / w);
    float line = max(ln.x, ln.y);
    vec3 lineCol = mix(vec3(1.0, 0.15, 0.75), vec3(0.2, 0.9, 1.0), smoothstep(0.5, 7.0, pos.y));
    vec3 base = vec3(0.05, 0.0, 0.1) * (0.6 + 0.4 * n.y);
    // The sun behind the mountains lights their ridges and shines along the wet valley floor
    float back = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * max(dot(n, SUN), 0.0);
    col = base + lineCol * line * 1.3 * uGlow + vec3(1.0, 0.35, 0.55) * back * 0.5;
    // The valley floor is wet and glossy: it mirrors the sky and the sun, rippling as the flight rushes over it
    float wet = smoothstep(0.35, 0.02, pos.y) * smoothstep(0.97, 1.0, n.y);
    if (wet > 0.0) {
      vec3 rf = reflect(rd, n);
      rf.x += 0.02 * sin(pos.z * 3.1 + t * 2.0) + 0.01 * sin(pos.z * 7.3 - pos.x * 2.0);
      rf.y += 0.012 * sin(pos.z * 5.3 - t * 1.3);
      rf = normalize(rf);
      float fres = 0.25 + 0.75 * pow(1.0 - max(-rd.y, 0.0), 5.0);
      col += sky(rf) * wet * fres * 0.55 * (1.0 - line * 0.6);
    }
    col = mix(col, haze * 0.8, 1.0 - exp(-tt * 0.022));
  } else {
    col = sky(rd);
  }
  o = vec4(col, 1.0);
}`;

// Cavern: a flight down a winding lane through an endless coral-like sheet, with light pulsing along its veins.
const FS_CAVERN = `#version 300 es
precision highp float;
uniform vec2 uSim;
uniform float uTime;     // seconds; colours drift with it
uniform float uTravel;   // how far the flight has come (wraps every ZP, where the cave repeats)
uniform float uLens;     // how wide the lens is: tan of half the height of the view
uniform float uGlow;     // how bright the veins burn (the music pushes it up)
uniform float uSeed;     // loop B flies through another stretch of cave
out vec4 o;
// Every wave in the cave repeats a whole number of times in ZP, so after ZP the cave is exactly the same
const float ZP = 251.327412;   // 80π
// The winding line the flight follows
vec2 path(float z) { return vec2(2.4 * sin(z * 0.075), 1.5 * sin(z * 0.05 + 1.3)); }
// A gyroid: one smooth sheet that curls through space as endless linked tunnels, like coral or bone
float gyroid(vec3 p, float s) { vec3 q = p * s; return dot(sin(q), cos(q.zxy)) / s; }
float map(vec3 p) {
  vec3 q = p + vec3(0.0, 0.0, uSeed);
  // The main sheet, made lumpy and pitted by a finer one, like coral
  float sheet = abs(gyroid(q, 1.6)) - 0.17 + 0.1 * gyroid(q, 5.6);
  float lane = 1.1 - length(p.xy - path(p.z));   // a winding lane carved clear for the flight
  return max(sheet, lane);
}
vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.01;
  return normalize(k.xyy * map(p + k.xyy * h) + k.yyx * map(p + k.yyx * h) +
                   k.yxy * map(p + k.yxy * h) + k.xxx * map(p + k.xxx * h));
}
vec3 palette(float x) { return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.33, 0.67))); }
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  float z = uTravel;
  vec3 ro = vec3(path(z), z);
  vec3 ta = vec3(path(z + 2.5), z + 2.5);
  vec3 fw = normalize(ta - ro);
  // Bank into the bends
  float roll = -0.35 * (path(z + 1.5).x - path(z).x) + 0.08 * sin(uTime * 0.21);
  vec3 upW = vec3(sin(roll), cos(roll), 0.0);
  vec3 rt = normalize(cross(upW, fw)), up = cross(fw, rt);
  vec2 sp = p * 2.0 * uLens;
  vec3 rd = normalize(fw + sp.x * rt + sp.y * up);

  const float FAR = 30.0;
  float t = 0.0, hit = 0.0;
  float glow = 0.0;
  for (int i = 0; i < 100; i++) {
    vec3 q = ro + rd * t;
    float d = map(q);
    glow += exp(-max(d, 0.0) * 12.0) * 0.012;   // light gathering near the walls, for a soft haze
    if (d < 0.0015 * (1.0 + t)) { hit = 1.0; break; }
    t += d * 0.6;
    if (t > FAR) break;
  }
  vec3 fogCol = vec3(0.01, 0.02, 0.05);
  vec3 col = fogCol;
  float hue = uTime * 0.02 + z * 0.004;
  if (hit > 0.5) {
    vec3 q = ro + rd * t;
    vec3 n = normalAt(q);
    // Soft shadows in the folds
    float ao = clamp(map(q + n * 0.25) / 0.25, 0.0, 1.0) * clamp(0.3 + map(q + n * 0.6) / 0.6, 0.0, 1.0);
    // A lamp just ahead of the camera, so the walls rushing past catch the light and the far ones stay dark
    vec3 lp = ro + fw * 0.6 + up * 0.3;
    vec3 L = lp - q;
    float dl = length(L);
    L /= dl;
    float wrap = max(dot(n, L) * 0.6 + 0.4, 0.0);
    float dif = wrap * wrap / (1.0 + dl * dl * 0.1);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 24.0) / (1.0 + dl * dl * 0.12);
    // Mother-of-pearl: the colour shifts with the angle you see it from, like oil on water
    float facing = max(dot(n, -rd), 0.0);
    vec3 nacre = palette(hue + 0.45 + facing * 0.7 + n.y * 0.1);
    vec3 shell = mix(vec3(0.14, 0.18, 0.24), nacre * 0.5, 0.55);
    col = shell * (dif * 1.6 + 0.03) * ao + vec3(0.8, 0.9, 1.0) * spec * 0.4 * ao;
    col += nacre * fres * 0.35 * ao / (1.0 + t * 0.2);
    // Glowing veins where a finer gyroid crosses the walls, drifting through the colours down the cave
    float v = abs(gyroid(q + vec3(0.0, 0.0, uSeed), 3.2));
    float vein = exp(-v * v / 0.0005) + 0.3 * exp(-v * v / 0.008);
    vec3 veinCol = palette(hue + q.z * 0.03);
    // Pulses of light run along the veins towards the camera
    float pulse = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(q.z * 0.9 + uTime * 3.0), 4.0) * 2.0;
    col += veinCol * vein * 0.8 * pulse * uGlow * (0.4 + 0.6 * ao);
    col = mix(col, fogCol, 1.0 - exp(-t * 0.1));
  }
  col += palette(hue + 0.15) * glow * 0.35 * uGlow;
  // Glowing spores hanging in the air: a few slices of them ahead, each slice fixed in the cave
  // so they stream past as the flight moves on; the walls hide the ones behind them
  float tEnd = hit > 0.5 ? t : FAR;
  const float GAP = ZP / 180.0;   // a whole number of slices in ZP, so they line up when the flight wraps
  float z0 = (floor(ro.z / GAP) + 1.0) * GAP;
  for (int k = 0; k < 7; k++) {
    float zs = z0 + float(k) * GAP;
    float ts = (zs - ro.z) / max(rd.z, 0.05);
    if (ts <= 0.0 || ts > tEnd) continue;
    vec2 xy = (ro + rd * ts).xy - path(zs);
    vec2 cell = floor(xy / 0.7);
    vec3 hs = vec3(fract(sin(dot(cell + mod(zs, ZP) * 1.37, vec2(12.9898, 78.233))) * 43758.5453),
                   fract(sin(dot(cell + mod(zs, ZP) * 2.11, vec2(39.346, 11.135))) * 24634.6345),
                   fract(sin(dot(cell + mod(zs, ZP) * 0.73, vec2(73.156, 52.235))) * 35758.2341));
    if (hs.z > 0.35) continue;
    vec2 c = (cell + 0.2 + 0.6 * hs.xy) * 0.7;
    float r = length(xy - c);
    float w = 0.012 + ts * 2.0 * uLens / uSim.y;
    col += palette(hue + hs.x * 0.3 + 0.3) * exp(-r * r / (w * w)) * min(1.0, 0.02 / w) * 1.2 * uGlow * exp(-ts * 0.08);
  }
  o = vec4(col, 1.0);
}`;

// Black hole: circling a black hole whose pull bends light round it, so its glowing disk shows over the top and underneath.
const FS_BLACKHOLE = `#version 300 es
precision highp float;
uniform vec2 uSim;
uniform float uTime;     // seconds; the disk swirls and the view tilts with it
uniform float uTravel;   // how far round the hole the camera has gone, as an angle (wraps every 2π)
uniform float uLens;     // how wide the lens is: tan of half the height of the view
uniform float uGlow;     // how bright the disk burns (the music pushes it up)
uniform float uSeed;     // loop B sees another sky
out vec4 o;
float h31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float h21(vec2 p) { return h31(vec3(p, 7.1)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
// The far sky: stars, and a faint band of the galaxy
vec3 sky(vec3 d) {
  vec3 c = vec3(0.0);
  vec3 g = d * 170.0;
  vec3 id = floor(g);
  float h = h31(id + uSeed);
  if (h > 0.995) {
    float r = length(fract(g) - 0.5);
    c += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), fract(h * 91.0)) * smoothstep(0.35, 0.0, r) * (h - 0.995) * 500.0;
  }
  float band = exp(-abs(d.y - 0.25 * sin(d.x * 2.0 + d.z)) * 5.0);
  c += vec3(0.35, 0.3, 0.55) * band * 0.07 * (0.6 + 0.8 * vnoise(vec2(atan(d.z, d.x) * 8.0, d.y * 8.0)));
  return c;
}
// The glowing disk of gas swirling into the hole: white hot inside, cooling to orange and red further out.
// It turns faster the closer in it is, and the side racing towards you shines brighter.
vec4 disk(vec3 p, vec3 dir) {
  float r = length(p.xz);
  if (r < 2.3 || r > 13.0) return vec4(0.0);
  float a = atan(p.z, p.x);
  float spin = uTime * 2.4 * pow(3.0 / r, 1.5);
  float sw = a + spin;
  float n = vnoise(vec2(sw * 3.0 / 3.14159 * 4.0 + r * 1.3, r * 1.6)) * 0.65
          + vnoise(vec2(sw * 6.0 / 3.14159 * 4.0 - r * 2.0, r * 3.2)) * 0.35;
  float streak = 0.55 + 0.9 * n * n;
  float T = pow(3.0 / r, 0.9);
  vec3 col = mix(vec3(0.9, 0.18, 0.04), vec3(1.0, 0.72, 0.38), clamp(T, 0.0, 1.0));
  col = mix(col, vec3(1.1, 1.05, 1.0), clamp(T * T - 0.6, 0.0, 1.0));
  vec3 v = normalize(vec3(-p.z, 0.0, p.x));
  float beam = pow(1.0 + 0.5 * dot(v, -dir), 2.2);
  float edge = smoothstep(2.3, 3.2, r) * smoothstep(13.0, 6.5, r);
  float I = edge * streak * T * 1.6 * beam * uGlow;
  return vec4(col * I, clamp(edge * (0.35 + 0.6 * n) * 1.1, 0.0, 0.92));
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  // Slowly circling the hole, a little above the disk, the tilt drifting up and down
  float a = uTravel;
  float incl = 0.1 + 0.09 * sin(uTime * 0.043 + uSeed);
  float D = 17.0;
  vec3 ro = D * vec3(cos(incl) * sin(a), sin(incl), cos(incl) * cos(a));
  vec3 fw = normalize(-ro);
  float roll = 0.12 * sin(uTime * 0.031);
  vec3 upW = vec3(sin(roll), cos(roll), 0.0);
  vec3 rt = normalize(cross(upW, fw)), up = cross(fw, rt);
  vec2 sp = p * 2.0 * uLens;
  vec3 dir = normalize(fw + sp.x * rt + sp.y * up);

  // Follow the light back from the camera: the hole's pull bends its path, so the far side of the disk
  // shows over the top and underneath, and the stars around the hole smear into arcs
  vec3 pos = ro;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float h2 = dot(cross(pos, dir), cross(pos, dir));
  float minR = 1e5;
  bool gone = false;
  for (int i = 0; i < 170; i++) {
    float r = length(pos);
    minR = min(minR, r);
    if (r < 1.0) { gone = true; break; }
    float dt = clamp(0.09 * r * r / (r + 2.0), 0.02, 1.6);
    vec3 acc = -1.5 * h2 * pos / (r * r * r * r * r);
    vec3 np = pos + dir * dt;
    dir = normalize(dir + acc * dt);
    if (pos.y * np.y < 0.0) {
      vec3 hp = mix(pos, np, pos.y / (pos.y - np.y));
      vec4 dk = disk(hp, dir);
      col += (1.0 - alpha) * dk.rgb;
      alpha += (1.0 - alpha) * dk.a;
      if (alpha > 0.97) break;
    }
    pos = np;
    if (r > 45.0 && dot(pos, dir) > 0.0) break;
  }
  if (!gone) col += (1.0 - alpha) * sky(dir);
  // A thin ring of light hugging the edge of the shadow
  col += vec3(1.0, 0.75, 0.5) * 0.25 * exp(-max(minR - 1.5, 0.0) * 5.0) * (1.0 - alpha) * uGlow * (gone ? 0.0 : 1.0);
  o = vec4(col, 1.0);
}`;

// Aurora: a slow glide over a frozen lake under curtains of northern lights, mirrored in the ice.
const FS_AURORA = `#version 300 es
precision highp float;
uniform vec2 uSim;
uniform float uTime;     // seconds; the curtains ripple and fold with it
uniform float uTravel;   // how far the glide has come (wraps every GAP, where the curtains repeat)
uniform float uLens;     // how wide the lens is: tan of half the height of the view
uniform float uGlow;     // how bright the lights burn (the music pushes it up)
uniform float uSeed;     // loop B sees other mountains and other stars
out vec4 o;
const float GAP = 55.0;   // a new curtain of light hangs every GAP ahead
float h31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float h11(float x) { return h31(vec3(x, 3.7, uSeed)); }
float n11(float x) { float i = floor(x), f = fract(x); return mix(h11(i), h11(i + 1.0), f * f * (3.0 - 2.0 * f)); }
// Where a curtain crosses the ground, bending and folding as it drifts
float fold(float x, float t) {
  return 7.0 * sin(x * 0.045 + t * 0.05) + 3.0 * sin(x * 0.12 - t * 0.09 + 1.0) + 1.2 * sin(x * 0.33 + t * 0.21);
}
// The curtains of light seen along one line of sight: sampled at a stack of heights, from the sharp green
// lower hem up to the violet top, each curtain finely streaked with rays
vec3 aurora(vec3 ro, vec3 rd, float dither) {
  if (rd.y <= 0.01) return vec3(0.0);
  vec3 c = vec3(0.0);
  float t = uTime;
  for (int i = 0; i < 26; i++) {
    float f = (float(i) + dither) / 26.0;
    float h = 9.0 + 26.0 * f * f;
    float tt = (h - ro.y) / rd.y;
    if (tt > 420.0) break;
    vec3 q = ro + rd * tt;
    float zz = q.z - fold(q.x, t);
    float m = mod(zz, GAP) - 0.5 * GAP;
    float w = 1.8 + 4.0 * f;
    float sheet = exp(-m * m / (w * w));
    float rays = 0.3 + 0.7 * n11(q.x * 0.9 + t * 0.35 + floor(zz / GAP) * 17.0) * n11(q.x * 2.7 - t * 0.2);
    float hem = 0.45 + 1.4 * exp(-f * 7.0);
    vec3 tint = mix(vec3(1.0, 0.2, 0.55), vec3(0.15, 1.0, 0.45), smoothstep(0.0, 0.05, f));   // a pink lower fringe
    tint = mix(tint, vec3(0.15, 0.6, 1.0), smoothstep(0.15, 0.5, f));
    tint = mix(tint, vec3(0.8, 0.2, 0.85), smoothstep(0.45, 1.0, f));
    c += tint * sheet * rays * hem * exp(-tt * 0.006);
  }
  return c * 0.22 * uGlow;
}
// The far mountains all round, as an outline against the sky: how high they reach in each direction
float ridge(vec3 d) {
  float az = atan(d.x, d.z);
  return 0.025 + 0.05 * n11(az * 5.0 + 11.0) * n11(az * 5.0 + 11.0) + 0.012 * n11(az * 23.0);
}
vec3 sky(vec3 ro, vec3 d, float dither) {
  vec3 c = mix(vec3(0.02, 0.05, 0.1), vec3(0.0, 0.005, 0.02), smoothstep(0.0, 0.5, d.y));
  vec3 g = d * 220.0;
  vec3 id = floor(g);
  float hs = h31(id + uSeed);
  if (hs > 0.996) c += vec3(0.85, 0.9, 1.0) * smoothstep(0.35, 0.0, length(fract(g) - 0.5)) * (0.5 + 0.5 * sin(uTime * 2.0 + hs * 90.0)) * 0.9;
  c += aurora(ro, d, dither);
  if (d.y < ridge(d)) c = vec3(0.004, 0.008, 0.016) + aurora(ro, normalize(vec3(d.x, 0.08, d.z)), dither) * 0.06;
  return c;
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  float t = uTime;
  // Gliding over a frozen lake, gently swaying and looking a little upwards
  vec3 ro = vec3(3.0 * sin(t * 0.04), 1.6 + 0.3 * sin(t * 0.13), uTravel);
  vec3 fw = normalize(vec3(0.12 * sin(t * 0.05), 0.2 + 0.06 * sin(t * 0.07), 1.0));
  float roll = 0.04 * sin(t * 0.09);
  vec3 upW = vec3(sin(roll), cos(roll), 0.0);
  vec3 rt = normalize(cross(upW, fw)), up = cross(fw, rt);
  vec2 sp = p * 2.0 * uLens;
  vec3 rd = normalize(fw + sp.x * rt + sp.y * up);
  float dither = h31(vec3(gl_FragCoord.xy, fract(t) * 13.0));
  vec3 col;
  if (rd.y >= 0.0) {
    col = sky(ro, rd, dither);
  } else {
    // The ice mirrors the sky, dimmer, with faint cracks and frost streaks running across it
    float tt = ro.y / -rd.y;
    vec3 q = ro + rd * tt;
    vec3 rf = vec3(rd.x, -rd.y, rd.z);
    vec2 qq = q.xz;
    // Frost dulls the mirror in soft patches
    float frost = n11(qq.x * 0.35 + 5.0 * n11(mod(qq.y, GAP) * 0.4)) ;
    float fres = 0.35 + 0.65 * pow(1.0 - rf.y, 4.0);
    col = sky(q, rf, dither) * (0.45 + 0.35 * frost) * fres;
    col += vec3(0.02, 0.03, 0.05) * frost * exp(-tt * 0.1);
  }
  o = vec4(col, 1.0);
}`;

// Mercury: circling drops of liquid metal that drift, merge and split, mirroring a neon-lit room.
const FS_MERCURY = `#version 300 es
precision highp float;
uniform vec2 uSim;
uniform float uTime;     // seconds; the blobs drift and merge with it
uniform float uTravel;   // how far round the camera has circled, as an angle (wraps every 2π)
uniform float uLens;     // how wide the lens is: tan of half the height of the view
uniform float uGlow;     // how bright the lights are, and how much the blobs swell (the music pushes it up)
uniform float uSeed;     // loop B watches a different dance
out vec4 o;
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
// Seven drops of liquid metal drifting round each other, flowing together where they meet
float map(vec3 p) {
  float t = uTime * 0.45 + uSeed;
  float swell = 1.0 + 0.18 * (uGlow - 1.0);
  float d = 1e5;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec3 c = vec3(1.5 * sin(t * (0.53 + 0.11 * fi) + fi * 1.7),
                  0.9 * sin(t * (0.71 + 0.07 * fi) + fi * 2.9),
                  1.5 * cos(t * (0.47 + 0.13 * fi) + fi * 0.9));
    float r = (0.55 + 0.3 * fract(fi * 0.618)) * swell;
    d = smin(d, length(p - c) - r, 0.75);
  }
  return d;
}
vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.002;
  return normalize(k.xyy * map(p + k.xyy * h) + k.yyx * map(p + k.yyx * h) + k.yxy * map(p + k.yxy * h) + k.xxx * map(p + k.xxx * h));
}
vec3 hue(float x) { return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.33, 0.67))); }
// The studio round the metal, which it mirrors: a dusky sky with a glowing horizon, three big soft lights,
// and neon tubes standing round the room. The colours drift slowly.
vec3 env(vec3 d) {
  float az = atan(d.x, d.z);
  float tt = uTime * 0.03;
  vec3 c = d.y > 0.0 ? mix(hue(tt + 0.62) * 0.75 + 0.15, hue(tt + 0.1) * 0.25 + 0.05, smoothstep(0.0, 0.9, d.y))
                     : mix(vec3(0.2, 0.19, 0.22), vec3(0.06, 0.055, 0.07), smoothstep(0.0, -0.5, d.y));
  c += hue(tt + 0.9) * exp(-abs(d.y) * 9.0) * 0.9 * uGlow;
  c += vec3(1.0, 0.97, 0.94) * smoothstep(0.6, 0.85, d.y) * 1.4;   // a big soft light overhead
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float ca = fk * 2.094 + 0.4 + uTime * 0.02;
    float da = abs(mod(az - ca + 3.14159, 6.28318) - 3.14159);
    float de = abs(d.y - (0.35 + 0.12 * fk));
    float box = smoothstep(0.03, 0.0, max(da - 0.32, de - 0.2));
    c += mix(vec3(1.0, 0.95, 0.88), hue(tt + fk * 0.33), 0.55) * box * (1.6 + 0.4 * fk);
  }
  float seg = 6.28318 / 7.0;
  float a = mod(az + uTime * 0.05, seg) - 0.5 * seg;
  float tube = exp(-a * a / 0.0008) * smoothstep(0.5, 0.35, abs(d.y - 0.05));
  c += hue(floor((az + uTime * 0.05) / seg) * 0.21 + tt) * tube * 2.5 * uGlow;
  return c;
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  // Circling slowly round the metal, rising and dipping a little
  float a = uTravel;
  float el = 0.28 + 0.18 * sin(uTime * 0.07);
  vec3 ro = 5.6 * vec3(cos(el) * sin(a), sin(el), cos(el) * cos(a));
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw)), up = cross(fw, rt);
  vec2 sp = p * 2.0 * uLens;
  vec3 rd = normalize(fw + sp.x * rt + sp.y * up);
  const float FLOOR = -2.2;

  float t = 0.0, hit = 0.0;
  for (int i = 0; i < 90; i++) {
    float d = map(ro + rd * t);
    if (d < 0.001) { hit = 1.0; break; }
    t += d;
    if (t > 20.0) break;
  }
  float tf = rd.y < 0.0 ? (FLOOR - ro.y) / rd.y : 1e5;
  vec3 col;
  if (hit > 0.5 && t < tf) {
    vec3 q = ro + rd * t;
    vec3 n = normalAt(q);
    vec3 r = reflect(rd, n);
    float fres = 0.7 + 0.3 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
    col = env(r) * fres * vec3(0.92, 0.95, 1.0);
    // Where the metal curls in on itself it catches less light
    col *= 0.5 + 0.5 * clamp(map(q + n * 0.4) / 0.4, 0.0, 1.0);
    // The floor seen in the metal's underside
    if (r.y < 0.0) col *= 0.6;
  } else if (tf < 1e4) {
    // A black glossy floor mirroring the metal and the lights
    vec3 q = ro + rd * tf;
    vec3 r = vec3(rd.x, -rd.y, rd.z);
    float tr = 0.02, rh = 0.0;
    for (int i = 0; i < 50; i++) {
      float d = map(q + r * tr);
      if (d < 0.004) { rh = 1.0; break; }
      tr += d;
      if (tr > 12.0) break;
    }
    vec3 rc = env(r) * 0.22;
    if (rh > 0.5) {
      vec3 qq = q + r * tr;
      vec3 n = normalAt(qq);
      rc = env(reflect(r, n)) * 0.6;
    }
    float fres = 0.2 + 0.8 * pow(1.0 - max(-rd.y, 0.0), 4.0);
    col = rc * fres * 0.55 * exp(-length(q.xz) * 0.06);
    // Far off, the floor fades into the glow of the room's horizon instead of ending in a hard line
    col = mix(col, env(rd) * 0.22, 1.0 - exp(-length(q.xz) * 0.045));
  } else {
    col = env(rd) * 0.22;
  }
  o = vec4(col, 1.0);
}`;

// Fractal: a flight down a hall folded out of spheres, where bubbles grow on bubbles, smaller without end.
const FS_FRACTAL = `#version 300 es
precision highp float;
uniform vec2 uSim;
uniform float uTime;     // seconds; the colours drift and the view sways with it
uniform float uTravel;   // how far the flight has come (wraps every 2, where the fractal repeats)
uniform float uLens;     // how wide the lens is: tan of half the height of the view
uniform float uGlow;     // how bright the lights are (the music pushes it up)
uniform float uSeed;     // loop B takes a different line through the hall
out vec4 o;
// A fractal made by folding space into a repeating box and turning it inside out through a sphere, over
// and over: a hall whose floor and ceiling grow bubbles on bubbles on bubbles, smaller without end.
// Every fold repeats every 2 units, so the whole hall does too.
float map(vec3 p, out float trap) {
  float s = 1.0;
  trap = 1e5;
  for (int i = 0; i < 8; i++) {
    p = -1.0 + 2.0 * fract(0.5 * p + 0.5);
    float r2 = dot(p, p);
    trap = min(trap, r2);
    float k = 1.3 / max(r2, 1e-6);
    p *= k;
    s *= k;
  }
  return 0.25 * abs(p.y) / s;
}
float map(vec3 p) { float t; return map(p, t); }
vec3 hue(float x) { return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.33, 0.67))); }
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  float t = uTime;
  // Flying down the middle of the hall, well clear of the bubbles, looking about slowly
  // (the corridor at mid-height round x = 1 is clear of bubbles for well over 0.4 either side)
  float lane = uSeed > 0.0 ? 0.74 : 1.0;
  vec3 ro = vec3(lane + 0.12 * sin(t * 0.13), 1.0 + 0.05 * sin(t * 0.17), uTravel);
  vec3 fw = normalize(vec3(0.35 * sin(t * 0.05), 0.18 * sin(t * 0.037), 1.0));
  float roll = 0.2 * sin(t * 0.03);
  vec3 upW = vec3(sin(roll), cos(roll), 0.0);
  vec3 rt = normalize(cross(upW, fw)), up = cross(fw, rt);
  vec2 sp = p * 2.0 * uLens;
  vec3 rd = normalize(fw + sp.x * rt + sp.y * up);

  float tt = 0.0, hit = 0.0, trap = 0.0;
  float steps = 0.0;
  for (int i = 0; i < 120; i++) {
    float d = map(ro + rd * tt, trap);
    if (d < 0.0004 * (1.0 + tt * 3.0)) { hit = 1.0; break; }
    tt += d;
    steps += 1.0;
    if (tt > 9.0) break;
  }
  vec3 col = vec3(0.0);
  vec3 fog = hue(t * 0.01 + 0.62) * 0.05;
  if (hit > 0.5) {
    vec3 q = ro + rd * tt;
    vec2 e = vec2(0.0006 * (1.0 + tt * 2.0), 0.0);
    vec3 n = normalize(vec3(map(q + e.xyy) - map(q - e.xyy), map(q + e.yxy) - map(q - e.yxy), map(q + e.yyx) - map(q - e.yyx)));
    // Colour by how close the folds came to the centre of the sphere: gold, teal and violet bands
    vec3 base = hue(0.08 + sqrt(trap) * 2.2 + t * 0.01);
    base = mix(base, vec3(1.0, 0.85, 0.6), 0.25);
    float occ = 1.0 - clamp(steps / 70.0, 0.0, 1.0);   // tight corners took many steps: they sit in shadow
    // A lamp just above the camera, and a cold light filling in from the far end of the hall
    vec3 lp = ro + vec3(0.0, 0.25, 0.3);
    vec3 L = lp - q;
    float dl = length(L);
    L /= dl;
    float att = 1.0 / (1.0 + dl * dl * 0.8);
    float dif = max(dot(n, L), 0.0) * att;
    float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 30.0) * att;
    float fill = max(dot(n, normalize(vec3(0.2, 0.4, -1.0))), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col = base * (dif * 3.2 + fill * 0.15 + 0.04) * occ + vec3(1.0, 0.95, 0.9) * spec * 1.2 * occ;
    col += hue(t * 0.02 + 0.5) * rim * 0.35 * occ * uGlow;
    // The tiniest bubbles glow like embers
    col += vec3(1.0, 0.55, 0.2) * smoothstep(0.02, 0.0, trap) * 1.5 * uGlow;
    col = mix(col, fog, 1.0 - exp(-tt * 0.35));
  } else {
    col = fog;
  }
  // A glow gathers along the hall where the rays graze the bubbles
  col += hue(t * 0.02 + 0.55) * pow(steps / 120.0, 2.0) * 0.5 * uGlow;
  o = vec4(col, 1.0);
}`;

// Nebula: a flight through glowing clouds of gas and dark dust, lit by a nearby star.
const FS_NEBULA = `#version 300 es
precision highp float;
uniform vec2 uSim;
uniform float uTime;     // seconds; the gas churns and the colours drift with it
uniform float uTravel;   // how far the flight has come (wraps every ZP, where the clouds repeat)
uniform float uLens;     // how wide the lens is: tan of half the height of the view
uniform float uGlow;     // how bright the gas and stars shine (the music pushes it up)
uniform float uSeed;     // loop B flies through other clouds
out vec4 o;
const float ZP = 400.0;
float h31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
// Soft random lumps in 3D that repeat every per squares going forward
float vnoise(vec3 p, float per) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float z0 = mod(i.z, per), z1 = mod(i.z + 1.0, per);
  vec3 s = vec3(uSeed, 0.0, 0.0);
  float a = h31(vec3(i.xy, z0) + s), b = h31(vec3(i.x + 1.0, i.y, z0) + s);
  float c = h31(vec3(i.x, i.y + 1.0, z0) + s), d = h31(vec3(i.x + 1.0, i.y + 1.0, z0) + s);
  float e = h31(vec3(i.xy, z1) + s), f2 = h31(vec3(i.x + 1.0, i.y, z1) + s);
  float g = h31(vec3(i.x, i.y + 1.0, z1) + s), h = h31(vec3(i.x + 1.0, i.y + 1.0, z1) + s);
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f2, u.x), mix(g, h, u.x), u.y), u.z);
}
vec2 path(float z) { return vec2(3.0 * sin(z * 6.28318 / 200.0), 2.0 * sin(z * 6.28318 / 133.333 + 1.0)); }
// How thick the gas is here: billowing clouds, thinning out along the winding path the flight takes
float density(vec3 p) {
  vec3 q = p * 0.12;
  float n = vnoise(q, 48.0) * 0.55 + vnoise(q * 2.0 + vec3(0.0, 0.0, 0.0), 96.0) * 0.3 + vnoise(q * 4.0, 192.0) * 0.15;
  float lane = length(p.xy - path(p.z));
  return max(n - 0.5 - 0.12 * smoothstep(6.0, 0.0, lane), 0.0) * 3.0;
}
vec3 hue(float x) { return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.33, 0.67))); }
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  float z = uTravel;
  vec3 ro = vec3(path(z), z);
  vec3 fw = normalize(vec3(path(z + 6.0), z + 6.0) - ro);
  float roll = 0.15 * sin(uTime * 0.04);
  vec3 upW = vec3(sin(roll), cos(roll), 0.0);
  vec3 rt = normalize(cross(upW, fw)), up = cross(fw, rt);
  vec2 sp = p * 2.0 * uLens;
  vec3 rd = normalize(fw + sp.x * rt + sp.y * up);

  // Far stars behind everything
  vec3 g = rd * 160.0;
  float hs = h31(floor(g) + uSeed);
  vec3 bg = hs > 0.994 ? vec3(0.85, 0.9, 1.0) * smoothstep(0.35, 0.0, length(fract(g) - 0.5)) * (hs - 0.994) * 160.0 : vec3(0.0);

  // March through the gas: it glows in its own colours and hides what lies behind it.
  // A bright star floats ahead of the flight and lights the clouds round it.
  vec3 star = vec3(path(z + 40.0), z + 40.0) + vec3(4.0, 2.5, 0.0);
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float dither = h31(vec3(gl_FragCoord.xy, 3.0));
  float t = 0.3 + dither * 0.6;
  for (int i = 0; i < 40; i++) {
    vec3 q = ro + rd * t;
    float d = density(q);
    float dt = 0.45 + t * 0.045;
    if (d > 0.0) {
      // Some of the gas glows (violet, magenta, blue, now and then gold); the rest is dark dust
      float kind = vnoise(q * 0.21 + vec3(7.0, 3.0, 0.0), 84.0);
      float lit = smoothstep(0.35, 0.65, kind);
      vec3 tint = mix(vec3(0.45, 0.2, 1.0), vec3(1.0, 0.2, 0.6), smoothstep(0.3, 0.7, vnoise(q * 0.09 + 11.0, 36.0)));
      tint = mix(tint, vec3(0.2, 0.6, 1.0), smoothstep(0.55, 0.8, kind));
      tint = mix(tint, vec3(1.0, 0.6, 0.25), smoothstep(0.75, 0.95, vnoise(q * 0.05 + 23.0, 20.0)) * 0.8);
      vec3 toS = star - q;
      float ls = 18.0 / (1.0 + dot(toS, toS) * 0.03);
      vec3 emit = tint * d * (0.06 + 1.1 * lit) + vec3(1.0, 0.85, 0.7) * ls * d * 0.25;
      float a = 1.0 - exp(-d * dt * 1.1);
      col += trans * a * emit * uGlow;
      trans *= 1.0 - a;
      if (trans < 0.03) break;
    }
    t += dt;
    if (t > 60.0) break;
  }
  // The star itself, glaring through the gas
  vec3 toStar = normalize(star - ro);
  float sa = max(dot(rd, toStar), 0.0);
  vec3 glare = vec3(1.0, 0.9, 0.8) * (pow(sa, 3000.0) * 3.0 + pow(sa, 200.0) * 0.5 + pow(sa, 20.0) * 0.08) * uGlow;
  col += trans * bg + glare * (0.4 + 0.6 * trans);

  // Specks of light hanging in slices ahead, streaming past as the flight moves on
  const float GAP = 2.0;
  float z0 = (floor(ro.z / GAP) + 1.0) * GAP;
  for (int k = 0; k < 10; k++) {
    float zs = z0 + float(k) * GAP;
    float ts = (zs - ro.z) / max(rd.z, 0.05);
    if (ts <= 0.0) continue;
    vec2 xy = (ro + rd * ts).xy - path(zs);
    vec2 cell = floor(xy / 1.5);
    float hh = h31(vec3(cell, mod(zs, ZP) + uSeed));
    if (hh > 0.25) continue;
    vec2 c = (cell + 0.2 + 0.6 * vec2(h31(vec3(cell, zs + 1.3)), h31(vec3(cell, zs + 2.7)))) * 1.5;
    float r = length(xy - c);
    float w = 0.02 + ts * 2.0 * uLens / uSim.y;
    col += mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.7, 0.9), hh * 4.0) * exp(-r * r / (w * w)) * min(1.0, 0.03 / w) * exp(-ts * 0.05) * uGlow;
  }
  o = vec4(col, 1.0);
}`;

// City: a slow drift sideways along a wet street at night. Shops, lamps, trees and cars in front, rows of
// buildings behind, each row further back sliding past more slowly, and a skyline under a crescent moon.
// Every row is a flat layer standing at its own distance, so the view really is 3D and the depth comes free.
const FS_CITY = `#version 300 es
precision highp float;
uniform vec2 uSim;
uniform float uTime;     // seconds; windows switch on and off, beacons blink, cars drive
uniform float uTravel;   // how far along the street the view has drifted (wraps every PER, where the town repeats)
uniform float uLens;     // how wide the lens is: tan of half the height of the view
uniform float uGlow;     // how bright the lights burn (the music pushes it up)
uniform float uSeed;     // loop B drifts past another part of town
out vec4 o;
const float PER = 3072.0;     // the whole town repeats after this far (every spacing below divides it exactly)
const float CAM_Y = 3.6;      // the view sits about three floors up, across the street
const float LIFT = 0.118;     // the view is shifted up, not tilted, so the street sits low and the walls stay upright
const float CURB = 17.5, WALL = 21.0, LAMPS = 17.8, TREES = 19.6;
float h21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// A random number for the cell-th thing in a row that repeats every n cells (so the town repeats exactly)
float rnd(float cell, float n, float k) { return h21(vec2(mod(cell, n) + 0.37, k * 7.13 + 1.9 + uSeed)); }
// How much of a pixel a shape covers, from its signed distance (negative inside) and the width of a pixel
float cov(float d, float px) { return clamp(0.5 - d / px, 0.0, 1.0); }
float sdBox(vec2 p, vec2 c, vec2 hs) { vec2 d = abs(p - c) - hs; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdRound(vec2 p, vec2 c, vec2 hs, float r) { return sdBox(p, c, hs - r) - r; }
vec3 gAdd;   // light that glows past a shape's own outline (beacons, lamps, headlights), gathered front to back

// The town's colors: blues and violets for the walls, warm and pink for the lights
vec3 wallColor(float r) {
  if (r < 0.2) return vec3(0.12, 0.13, 0.62);
  if (r < 0.45) return vec3(0.2, 0.25, 0.96);
  if (r < 0.6) return vec3(0.36, 0.2, 0.8);
  if (r < 0.76) return vec3(0.45, 0.46, 1.0);
  if (r < 0.85) return vec3(0.56, 0.22, 0.72);
  return vec3(0.08, 0.1, 0.46);
}
vec3 windowLight(float r) {
  if (r < 0.34) return vec3(1.0, 0.7, 0.38);
  if (r < 0.58) return vec3(1.0, 0.9, 0.64);
  if (r < 0.78) return vec3(1.0, 0.42, 0.72);
  if (r < 0.93) return vec3(0.76, 0.74, 1.0);
  return vec3(0.45, 0.9, 1.0);
}
vec3 skyAt(float sx, float e) {
  vec3 c = mix(vec3(0.6, 0.3, 0.95), vec3(0.14, 0.18, 1.0), smoothstep(0.0, 0.16, e));
  c = mix(c, vec3(0.07, 0.06, 0.4), smoothstep(0.14, 0.6, e));
  c += vec3(0.55, 0.12, 0.35) * exp(-max(e, 0.0) * 18.0);   // a warm pink glow along the horizon
  return c;
}
vec3 sky(float sx, float e) {
  vec3 c = skyAt(sx, e);
  // Stars, fewer down towards the glow of the town
  vec2 g = vec2(sx, e) * 110.0;
  vec2 id = floor(g);
  float hs = h21(id + uSeed * 3.1);
  if (hs > 0.975) {
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + 2.0 * fract(hs * 37.0)) + hs * 80.0);
    c += vec3(0.85, 0.85, 1.0) * smoothstep(0.28, 0.0, length(fract(g) - 0.5)) * tw * smoothstep(0.1, 0.3, e);
  }
  // A thin crescent moon with a soft halo
  vec2 m = vec2(sx, e) - vec2(0.36, 0.4);
  float R = 0.034, d = length(m);
  float disc = smoothstep(R, R - 0.002, d) * smoothstep(R * 0.86, R * 0.86 + 0.002, length(m - vec2(0.011, 0.008)));
  c = mix(c, vec3(1.0, 0.95, 0.86), disc);
  c += vec3(0.5, 0.45, 1.0) * 0.18 * exp(-max(d - R, 0.0) * 22.0);
  // Long thin clouds drifting very slowly, lit pink from below (once round per trip through the town, so they
  // come back to the same place when it repeats)
  float band = exp(-pow((e - 0.3 - 0.05 * sin(sx * 2.0 + 1.0)) / 0.035, 2.0));
  float wisp = 0.5 + 0.5 * sin(sx * 7.0 + uTravel * 6.2831853 / PER + sin(sx * 17.0) * 0.8);
  c = mix(c, vec3(0.45, 0.3, 0.95), band * wisp * 0.35);
  return c;
}

// Lit and dark windows across a building's face. q: position on the face (from its left edge, up from the
// ground), w and h: the face's size, px: how wide a pixel is there
vec4 windows(vec2 q, float w, float h, float id, float px, float lit, float bay, float first) {
  float nb = max(1.0, floor((w - 0.3) / bay));
  float bw = (w - 0.3) / nb;
  float bx = (q.x - 0.15) / bw, fy = q.y - first;
  if (bx < 0.0 || bx >= nb || fy < 0.0 || q.y > h - 0.45) return vec4(0.0);
  vec2 c = vec2(floor(bx), floor(fy));
  vec2 f = vec2(fract(bx) * bw, fract(fy));
  float r = h21(c + vec2(id * 3.7, id * 1.3) + uSeed);
  // Most windows keep their state; one in eight switches on or off every half minute or so
  float r2 = r;
  if (fract(r * 53.0) < 0.125) r2 = h21(c + id + floor(uTime / 30.0 + r * 9.0));
  float on = step(r2, lit);
  vec3 lc = windowLight(fract(r * 17.0)) * (0.85 + 0.3 * f.y) * uGlow;
  vec3 dark = vec3(0.05, 0.05, 0.24);
  vec3 wc = mix(dark, lc, on);
  float m = cov(sdBox(f, vec2(0.5 * bw, 0.5), vec2(0.28 * bw, 0.27)), px);
  // Far off, where a window shrinks to a few pixels, blend it into its average so it doesn't shimmer
  float fade = smoothstep(0.12, 0.35, px);
  return vec4(mix(wc, mix(dark, vec3(1.0, 0.72, 0.6) * uGlow, lit), fade), mix(m, 0.28, fade));
}

// A row of buildings standing at one depth. X: where the line of sight crosses the row, Y: how high.
// lv: 0 the far skyline, 1 far, 2 middle, 3 the near side of the street.
vec4 buildings(float X, float Y, float px, int lv) {
  float W = lv == 0 ? 16.0 : lv == 1 ? 12.0 : lv == 2 ? 8.0 : 6.0;
  float hmin = lv == 0 ? 12.0 : lv == 1 ? 9.0 : lv == 2 ? 6.0 : 3.2;
  float hmax = lv == 0 ? 58.0 : lv == 1 ? 34.0 : lv == 2 ? 20.0 : 11.0;
  float fillMin = lv == 0 ? 0.4 : lv == 1 ? 0.5 : lv == 2 ? 0.62 : 0.84;
  if (Y > hmax * 1.25 + 9.6) return vec4(0.0);
  float n = PER / W, k = float(lv) * 10.0;
  float cell = floor(X / W), lx = X - cell * W;
  float bwid = W * mix(fillMin, 1.0, rnd(cell, n, k));
  float xl = (W - bwid) * rnd(cell, n, k + 1.0), xr = xl + bwid;
  float id = mod(cell, n) * 2.0;   // every building's own number, the same each time round the town
  // Some lots hold two buildings side by side
  if (lv > 0 && rnd(cell, n, k + 2.0) > 0.45) {
    float s = xl + bwid * mix(0.35, 0.65, rnd(cell, n, k + 3.0));
    if (lx < s) xr = s; else { xl = s; id += 1.0; }
  }
  float w = xr - xl;
  float hr = rnd(id, 2.0 * n, k + 4.0), rt = rnd(id, 2.0 * n, k + 5.0), rc = rnd(id, 2.0 * n, k + 6.0);
  float h = mix(hmin, hmax, pow(hr, 1.7));
  vec2 q = vec2(lx - xl, Y);
  if (q.y > h + 9.0 || q.x < -1.0 || q.x > w + 1.0) return vec4(0.0);
  // The outline: a body, maybe stepped in near the top, with a spire, a water tank or a pointed roof
  float top = h, body = h;
  float a = cov(sdBox(q, vec2(0.5 * w, 0.5 * h), vec2(0.5 * w, 0.5 * h)), px);
  float tier = 0.0;
  if (rt < 0.4 && hr > 0.35 && w > 2.0) {
    body = h * 0.8;
    float in1 = w * 0.16;
    a = max(cov(sdBox(q, vec2(0.5 * w, 0.5 * body), vec2(0.5 * w, 0.5 * body)), px),
            cov(sdBox(q, vec2(0.5 * w, 0.5 * (body + h)), vec2(0.5 * w - in1, 0.5 * (h - body))), px));
    tier = step(body, q.y);
    if (lv < 2 && rt < 0.2) {
      float t2 = h + (h - body) * 0.6;
      a = max(a, cov(sdBox(q, vec2(0.5 * w, 0.5 * (h + t2)), vec2(0.5 * w - w * 0.3, 0.5 * (t2 - h))), px));
      top = t2;
    }
  }
  vec3 add = vec3(0.0);
  if (rt >= 0.4 && rt < 0.64 && lv < 3) {
    // A spire with a red beacon blinking on top
    float sh = mix(1.5, 6.0, fract(rt * 31.0)) * (lv == 0 ? 1.6 : 1.0);
    float sw = 0.08 * (4.0 - float(lv)) * 0.5;
    float sx = 0.5 * w + (fract(rt * 7.0) - 0.5) * w * 0.3;
    a = max(a, cov(sdBox(q, vec2(sx, top + 0.5 * sh), vec2(sw, 0.5 * sh)), px));
    float blink = smoothstep(0.55, 0.9, sin(uTime * 2.2 + rt * 40.0));
    float bd = length(q - vec2(sx, top + sh));
    add += vec3(1.0, 0.15, 0.3) * blink * (smoothstep(0.35, 0.0, bd) * 0.9 + exp(-bd * bd / (0.4 + 0.4 * float(3 - lv))) * 0.35) * uGlow;
  } else if (rt >= 0.64 && rt < 0.8 && lv >= 2 && w > 2.2) {
    // A water tank on legs
    float tx = w * mix(0.25, 0.7, fract(rt * 13.0));
    a = max(a, cov(min(sdBox(q, vec2(tx - 0.32, h + 0.3), vec2(0.04, 0.3)), sdBox(q, vec2(tx + 0.32, h + 0.3), vec2(0.04, 0.3))), px));
    a = max(a, cov(sdRound(q, vec2(tx, h + 1.0), vec2(0.45, 0.42), 0.08), px));
    a = max(a, cov(max(abs(q.x - tx) - 0.5 + (q.y - h - 1.42) * 1.1, abs(q.y - h - 1.62) - 0.2), px));
  } else if (rt >= 0.84 && lv == 3 && h < 6.0) {
    // A pointed roof
    a = max(a, cov(max(abs(q.x - 0.5 * w) - 0.5 * w + (q.y - h) * 1.2, h - q.y), px));
  }
  if (a <= 0.0) { gAdd += add; return vec4(0.0); }
  // Flat, poster-like shading: a bright edge down the right-hand side, a darker band down the left,
  // a pale ledge along the top
  vec3 base = wallColor(rc);
  vec3 col = base;
  float edgeW = max(w * 0.05, 1.5 * px);
  col = mix(col, base * 1.45 + vec3(0.08, 0.04, 0.16), smoothstep(w - edgeW - px, w - edgeW, q.x));
  col *= 1.0 - 0.22 * smoothstep(edgeW * 1.5, 0.0, q.x);
  col = mix(col, base * 1.3 + vec3(0.1, 0.08, 0.2), step(body - max(0.28, 2.0 * px), q.y) * step(q.y, body) * (1.0 - tier));
  if (q.y > h) col = base * 0.75;   // spires, tanks and roofs a shade darker
  else {
    float lit = lv == 0 ? 0.16 : lv == 1 ? 0.24 : lv == 2 ? 0.34 : 0.46;
    vec4 wn = windows(q, w, body, id + float(lv) * 1000.0, px, lit, lv == 0 ? 1.1 : 0.8, lv == 3 ? 1.35 : 0.3);
    col = mix(col, wn.rgb, wn.a * (1.0 - tier));
    if (lv == 3 && q.y < 1.35) {
      // Shops along the street: glowing windows, a door, and often a striped awning
      float sr = rnd(id, 2.0 * n, 44.0);
      vec3 shop = mix(vec3(1.0, 0.55, 0.3), vec3(1.0, 0.35, 0.65), fract(sr * 7.0)) * (0.7 + 0.35 * (1.0 - q.y)) * uGlow;
      float glass = cov(sdBox(q, vec2(0.5 * w, 0.52), vec2(0.5 * w - 0.25, 0.4)), px);
      float mull = cov(abs(mod(q.x - 0.25, 0.9) - 0.45) - 0.03, px) * glass;
      col = mix(col, shop, glass);
      col = mix(col, base * 0.5, mull);
      float door = cov(sdBox(q, vec2(w * mix(0.3, 0.7, sr), 0.42), vec2(0.2, 0.42)), px);
      col = mix(col, vec3(0.08, 0.06, 0.3), door);
      if (sr < 0.65) {
        vec3 awn = sr < 0.22 ? vec3(1.0, 0.3, 0.55) : sr < 0.44 ? vec3(0.25, 0.8, 0.95) : vec3(1.0, 0.55, 0.25);
        float stripe = step(0.5, fract(q.x / 0.36));
        float scallop = 1.02 + 0.05 * cos(q.x / 0.36 * 6.2832);
        float am = cov(max(abs(q.x - 0.5 * w) - 0.5 * w + 0.12, max(scallop - q.y, q.y - 1.34)), px);
        col = mix(col, mix(awn, vec3(0.96, 0.92, 1.0), stripe * 0.85), am);
      } else {
        // or a thin neon strip above the window
        float neon = cov(abs(q.y - 1.1) - 0.035, px) * cov(abs(q.x - 0.5 * w) - 0.5 * w + 0.3, px);
        vec3 nc = fract(sr * 11.0) < 0.5 ? vec3(1.0, 0.3, 0.8) : vec3(0.3, 0.95, 1.0);
        col = mix(col, nc * 1.4 * uGlow, neon);
        add += nc * exp(-pow(q.y - 1.1, 2.0) / 0.05) * 0.25 * uGlow * cov(abs(q.x - 0.5 * w) - 0.5 * w + 0.3, px);
      }
    }
  }
  // Distance: the further the row, the more it melts into the glow of the sky
  float haze = lv == 0 ? 0.6 : lv == 1 ? 0.4 : lv == 2 ? 0.2 : 0.0;
  col = mix(col, skyAt(0.0, 0.03) * 0.75, haze);
  gAdd += add * (1.0 - haze * 0.5);
  return vec4(col, a);
}

// Street lamps along the curb, glowing warm
vec4 lamps(float X, float Y, float px) {
  float cell = floor(X / 12.0);
  float lx = X - cell * 12.0 - 6.0;
  if (Y > 5.0 || abs(lx - 0.4) > 3.0) return vec4(0.0);
  vec3 lc = rnd(cell, PER / 12.0, 71.0) < 0.5 ? vec3(1.0, 0.62, 0.42) : vec3(1.0, 0.45, 0.8);
  float a = cov(sdBox(vec2(lx, Y), vec2(0.0, 1.45), vec2(0.05, 1.45)), px);
  a = max(a, cov(sdBox(vec2(lx, Y), vec2(0.0, 0.12), vec2(0.12, 0.12)), px));
  a = max(a, cov(sdBox(vec2(lx, Y), vec2(0.3, 2.88), vec2(0.3, 0.035)), px));
  float head = cov(sdRound(vec2(lx, Y), vec2(0.62, 2.84), vec2(0.2, 0.07), 0.05), px);
  float d = length(vec2(lx, Y) - vec2(0.62, 2.76));
  gAdd += lc * (exp(-d * d / 0.08) * 0.8 + exp(-d * d / 1.2) * 0.22) * uGlow;
  vec3 col = mix(vec3(0.06, 0.05, 0.28), lc * 1.3 * uGlow, head);
  return vec4(col, max(a, head));
}
// Round trees between the lamps
vec4 trees(float X, float Y, float px) {
  if (Y > 3.8) return vec4(0.0);
  float cell = floor(X / 12.0);
  if (rnd(cell, PER / 12.0, 83.0) > 0.7) return vec4(0.0);
  float lx = X - cell * 12.0 - 12.0 * mix(0.3, 0.7, rnd(cell, PER / 12.0, 84.0));
  vec2 q = vec2(lx, Y);
  float s = mix(0.8, 1.2, rnd(cell, PER / 12.0, 85.0));
  float crown = min(min(length(q - vec2(0.0, 2.3 * s)) - 1.05 * s, length(q - vec2(-0.6, 1.85 * s)) - 0.7 * s), length(q - vec2(0.62, 1.95 * s)) - 0.75 * s);
  float a = max(cov(crown, px), cov(sdBox(q, vec2(0.0, 0.7), vec2(0.07, 0.7)), px));
  vec3 col = vec3(0.1, 0.08, 0.42);
  // Moonlight on the top right of the crown
  float hi = smoothstep(-0.15, 0.4, dot(normalize(q - vec2(0.0, 2.0 * s) + 1e-4), vec2(0.6, 0.8))) * step(crown, 0.0);
  col = mix(col, vec3(0.3, 0.24, 0.85), hi * smoothstep(-0.45 * s, -0.05, crown));
  return vec4(col, a);
}
// Cars: the near lane drives the way the view drifts, a little faster; the far lane comes the other way
vec4 cars(float X, float Y, float px, int lane) {
  if (Y > 1.0) return vec4(0.0);
  float v = lane == 0 ? 3.4 : -2.6;
  float u = mod(X - mod(v * uTime, PER), PER);
  float cell = floor(u / 16.0), n = PER / 16.0, kk = float(lane) * 20.0 + 100.0;
  if (rnd(cell, n, kk) > 0.62) return vec4(0.0);
  float cx = u - cell * 16.0 - mix(1.0, 12.0, rnd(cell, n, kk + 1.0));
  if (lane == 1) cx = 1.8 - cx;   // oncoming cars face left
  vec2 q = vec2(cx, Y);
  if (cx < -0.6 || cx > 2.4) return vec4(0.0);
  float kind = rnd(cell, n, kk + 2.0);
  float van = step(kind, 0.2);
  vec3 lampCol = kind < 0.2 ? vec3(0.85, 0.84, 1.0) : kind < 0.35 ? vec3(1.0, 0.78, 0.25) : kind < 0.55 ? vec3(1.0, 0.24, 0.38) :
               kind < 0.7 ? vec3(0.22, 0.78, 0.95) : kind < 0.85 ? vec3(1.0, 0.55, 0.25) : vec3(0.2, 0.18, 0.55);
  float bodyT = mix(0.38, 0.62, van);
  float body = sdRound(q, vec2(0.9, 0.12 + 0.5 * (bodyT - 0.12)), vec2(0.9, 0.5 * (bodyT - 0.12)), 0.08);
  float cab = van > 0.5 ? 1e5 : sdRound(q, vec2(0.95, 0.47), vec2(0.5 - (q.y - 0.38) * 0.35, 0.11), 0.09);
  float shape = min(body, cab);
  float wheel = min(length(q - vec2(0.38, 0.13)), length(q - vec2(1.42, 0.13))) - 0.13;
  float a = max(cov(shape, px), cov(wheel, px));
  vec3 col = lampCol * mix(0.6, 1.05, smoothstep(0.1, 0.5, q.y));
  // Windows
  float win = van > 0.5 ? sdRound(q, vec2(1.1, 0.5), vec2(0.62, 0.07), 0.03) : cab + 0.035;
  col = mix(col, vec3(0.12, 0.12, 0.42) + vec3(0.25, 0.25, 0.5) * smoothstep(0.03, 0.0, abs(q.x - q.y * 0.6 - 0.72)), cov(win, px));
  col = mix(col, vec3(0.04, 0.03, 0.18), cov(wheel, px));
  col = mix(col, vec3(0.5, 0.5, 0.85), cov(min(length(q - vec2(0.38, 0.13)), length(q - vec2(1.42, 0.13))) - 0.045, px));
  // Headlight at the front, taillight at the back
  float hd = length(q - vec2(1.78, 0.3)), td = length(q - vec2(0.02, 0.3));
  col = mix(col, vec3(1.0, 0.95, 0.8) * 1.4, cov(hd - 0.045, px));
  col = mix(col, vec3(1.0, 0.1, 0.25) * 1.3, cov(td - 0.04, px));
  gAdd += (vec3(1.0, 0.9, 0.7) * exp(-hd * hd / 0.05) * 0.6 + vec3(1.0, 0.1, 0.3) * exp(-td * td / 0.03) * 0.5) * uGlow;
  return vec4(col, a);
}

// The street itself, where the line of sight meets the ground
vec3 ground(float Xg, float zg, float pxz, float px) {
  vec3 c;
  if (zg < CURB) {
    c = vec3(0.05, 0.045, 0.24);
    float dash = cov(abs(zg - 13.5) - 0.09, pxz) * cov(abs(mod(Xg, 4.0) - 1.2) - 1.1, px);
    c = mix(c, vec3(0.55, 0.58, 1.0), dash * 0.8);
  } else if (zg < CURB + 0.3) {
    c = vec3(0.4, 0.4, 0.95);
  } else if (zg < WALL) {
    c = vec3(0.16, 0.14, 0.6);
    c *= 1.0 - 0.25 * cov(abs(mod(Xg + 0.75, 1.5) - 0.75) - 0.025, px);   // joints between the paving slabs
    // Warm light spilling out of the shops
    c += vec3(0.5, 0.2, 0.25) * smoothstep(18.8, 21.0, zg) * 0.5 * uGlow;
  } else {
    c = vec3(0.06, 0.05, 0.26);
  }
  // Pools of light under the lamps on either side
  for (int i = 0; i < 2; i++) {
    float cell = floor((Xg - 6.62) / 12.0) + float(i);
    vec3 lc = rnd(cell, PER / 12.0, 71.0) < 0.5 ? vec3(1.0, 0.62, 0.42) : vec3(1.0, 0.45, 0.8);
    vec2 d = vec2(Xg - (cell * 12.0 + 6.62), (zg - LAMPS) * 1.4);
    c += lc * exp(-dot(d, d) / 5.0) * 0.4 * uGlow;
  }
  return c;
}

// Everything the line of sight passes, from the front to the back. camY and dy say where it starts and how it
// slopes (a mirrored line gives the wet street's reflection); z0 skips anything nearer than that.
vec3 scene(float camY, float dy, float dx, float z0, out float zHit, out float T) {
  vec3 col = vec3(0.0);
  T = 1.0;
  zHit = -1.0;
  float zg = dy < 0.0 ? camY / -dy : 1e9;
  float pxK = 2.0 * uLens / uSim.y;
  vec4 c;
  float X, Y, px;
  // One stage per row of things, nearest first: stop at the street if the line of sight reaches it first,
  // and stop as soon as something solid fills the pixel
#define STAGE(Z, CALL) if (Z >= z0) { if (zg < Z) { zHit = zg; return col; } X = uTravel + dx * Z; Y = camY + dy * Z; px = pxK * Z; gAdd = vec3(0.0); c = CALL; col += T * (c.a * c.rgb + gAdd); T *= 1.0 - c.a; if (T < 0.003) return col; }
  STAGE(12.0, cars(X, Y, px, 0))
  STAGE(15.0, cars(X, Y, px, 1))
  STAGE(LAMPS, lamps(X, Y, px))
  STAGE(TREES, trees(X, Y, px))
  STAGE(WALL, buildings(X, Y, px, 3))
  STAGE(40.0, buildings(X, Y, px, 2))
  STAGE(80.0, buildings(X, Y, px, 1))
  STAGE(160.0, buildings(X, Y, px, 0))
#undef STAGE
  if (zg < 1e8) { zHit = zg; return col; }
  col += T * sky(dx, dy);
  T = 0.0;
  return col;
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  float dx = p.x * 2.0 * uLens, dy = (p.y + LIFT) * 2.0 * uLens;
  float zHit, T;
  vec3 col = scene(CAM_Y, dy, dx, 0.0, zHit, T);
  if (zHit > 0.0 && T > 0.003) {
    float pxK = 2.0 * uLens / uSim.y;
    float Xg = uTravel + dx * zHit;
    vec3 g = ground(Xg, zHit, zHit * zHit * pxK / CAM_Y, pxK * zHit);
    // The street is wet: it mirrors the lamps, the cars and the lit windows, stretched into streaks and
    // rippling a little. The bright lights show most; the walls only faintly.
    float wet = zHit < CURB ? 0.42 : zHit < WALL ? 0.16 : 0.25;
    float rip = 0.003 * sin(zHit * 2.1 + uTime * 1.3) + 0.0015 * sin(Xg * (6.2831853 * 832.0 / PER) - uTime * 0.7);
    float z2, T2;
    vec3 r = scene(-0.7 * CAM_Y, -dy * 0.7, dx + rip, zHit, z2, T2);
    r *= 0.3 + 0.7 * smoothstep(0.55, 1.3, max(r.r, max(r.g, r.b)));
    col += T * (g + r * wet);
  }
  o = vec4(col, 1.0);
}`;

// ---- The fractal flights' pictures ----
// All six share one way of drawing: rays from the wandering camera step through the fractal's distance
// (worked out the same way as FR above), and everything that sets how far to look, how fine to draw and how
// the light falls off is measured against uScale, the camera's distance to the nearest surface. So however
// deep the camera has dived, the picture is drawn and lit the same way: that is what makes the zoom endless.
// Each fractal brings its shape (map: distance, plus a note of how the folding went, used for colour) and
// its colours (paint).
function fractalFS(map, paint, deq) {
  return `#version 300 es
precision highp float;
uniform vec2 uSim;
uniform float uTime;     // seconds; the colours drift with it
uniform float uLens;     // how wide the lens is: tan of half the height of the view
uniform float uGlow;     // how bright the lights are (the music pushes it up)
uniform vec3 uCam;       // where the wandering camera is, which way it looks, and which way is up for it
uniform vec3 uFwd;
uniform vec3 uUp;
uniform float uScale;    // how far the nearest surface is: the zoom
out vec4 o;
vec3 hue(float x) { return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.33, 0.67))); }
${map}
float mapD(vec3 p) { vec4 t; return map(p, t); }
void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * uSim) / uSim.y;
  vec3 fw = normalize(uFwd), up = normalize(uUp - dot(uUp, fw) * fw), rt = cross(up, fw);
  vec2 sp = q * 2.0 * uLens;
  vec3 rd = normalize(fw + sp.x * rt + sp.y * up);
  float px = 2.0 * uLens / uSim.y;          // how wide one pixel is, a unit away
  float far = min(uScale * 60.0, 12.0);
  float t = 0.0, steps = 0.0, hit = 0.0, d = 0.0;
  vec4 tr = vec4(0.0);
  for (int i = 0; i < 110; i++) {
    d = map(uCam + rd * t, tr);
    if (d < px * t * 0.6 + uScale * 0.002) { hit = 1.0; break; }
    t += d * 0.9;
    steps += 1.0;
    if (t > far) break;
  }
  float tz = t / uScale;                     // how far that is, in the zoom's own terms
  float fogK = 1.0 - exp(-tz * 0.045);
  vec3 col = vec3(0.0), fogC, glowC;
  if (hit > 0.5) {
    vec3 pos = uCam + rd * t;
    float e = max(px * t * 0.5, uScale * 0.0005);
    vec2 k = vec2(1.0, -1.0);
    vec3 n = normalize(k.xyy * mapD(pos + k.xyy * e) + k.yyx * mapD(pos + k.yyx * e) + k.yxy * mapD(pos + k.yxy * e) + k.xxx * mapD(pos + k.xxx * e));
    // Light gets into the folds less: test a few steps out from the surface
    float ao = 0.0, w = 1.0;
    for (int i = 1; i <= 4; i++) {
      float h = t * 0.045 * float(i);
      ao += w * max(h - mapD(pos + n * h) / ${(deq || 1).toFixed(2)}, 0.0) / h;
      w *= 0.65;
    }
    ao = clamp(1.0 - ao * 0.6, 0.0, 1.0) * (1.0 - 0.35 * clamp(steps / 90.0, 0.0, 1.0));
    // A lamp riding just above the camera, and a soft light from one fixed side, so the roll shows
    vec3 L = uCam + up * uScale * 0.6 - pos;
    float dl = length(L);
    L /= dl;
    float att = 1.0 / (1.0 + pow(dl / (uScale * 7.0), 2.0));
    float dif = max(dot(n, L), 0.0);
    float fill = 0.5 + 0.5 * dot(n, normalize(vec3(0.45, 0.75, -0.35)));
    float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 24.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    vec3 base, emit;
${paint}
    col = base * (0.035 + dif * 1.25 * att + fill * 0.2) * ao + vec3(1.0, 0.95, 0.9) * spec * 0.5 * att * ao;
    col += glowC * rim * 0.35 * ao * uGlow + emit * uGlow;
    col = mix(col, fogC, fogK);
  } else {
    vec3 pos = uCam + rd * t, n = -rd, base, emit;
    float ao = 1.0, att = 0.0, dif = 0.0, fill = 0.0, spec = 0.0, rim = 0.0;
${paint}
    col = fogC;
  }
  // A haze gathers where the rays graze the fractal
  col += glowC * pow(steps / 110.0, 2.0) * 0.55 * uGlow;
  o = vec4(col, 1.0);
}`;
}

const FS_SPONGE = fractalFS(`
// Menger sponge: a cube with a cross-shaped hole through it, and the same hole through every smaller cube.
// tr.x: which size of hole made this bit of wall (0 the biggest), or -1 for the cube's outside.
float map(vec3 p, out vec4 tr) {
  vec3 b = abs(p) - 1.0;
  float d = min(max(b.x, max(b.y, b.z)), 0.0) + length(max(b, 0.0));
  float s = 1.0;
  tr = vec4(-1.0, 0.0, 0.0, 0.0);
  for (int m = 0; m < 6; m++) {
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float c = (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.0) / s;
    if (c > d) { d = c; tr = vec4(float(m), r); }
  }
  return d;
}`, `
    // Each size of hole its own colour, slowly shifting; the hole rims glow
    float lv = tr.x;
    base = lv < 0.0 ? vec3(0.5, 0.48, 0.46) : mix(hue(0.58 + lv * 0.17 + uTime * 0.008), vec3(0.85), 0.25);
    emit = vec3(0.0);
    fogC = hue(uTime * 0.01 + 0.62) * 0.045;
    glowC = hue(uTime * 0.012 + 0.5 + 0.1 * sin(uTime * 0.07));`);

const FS_BULB = fractalFS(`
// Mandelbulb: the Mandelbrot set's rule worked in 3D, to the 8th power. tr: how close the folding came to the middle.
float map(vec3 p, out vec4 tr) {
  vec3 w = p;
  float m = dot(w, w), dz = 1.0;
  tr = vec4(abs(w), m);
  for (int i = 0; i < 7; i++) {
    dz = 8.0 * pow(m, 3.5) * dz + 1.0;
    float r = sqrt(m);
    float b = 8.0 * acos(clamp(w.y / max(r, 1e-12), -1.0, 1.0)), a = 8.0 * atan(w.x, w.z);
    w = p + pow(r, 8.0) * vec3(sin(b) * sin(a), cos(b), sin(b) * cos(a));
    m = dot(w, w);
    tr = min(tr, vec4(abs(w), m));
    if (m > 256.0) break;
  }
  return 0.25 * log(m) * sqrt(m) / dz;
}`, `
    // Mother of pearl: the colour follows how the folding went
    base = mix(hue(0.05 + sqrt(tr.w) * 0.9 + uTime * 0.01), vec3(1.0, 0.9, 0.8), 0.3);
    base *= 0.8 + 0.5 * clamp(tr.x * 1.5, 0.0, 1.0);
    emit = hue(0.55 + uTime * 0.01) * smoothstep(0.08, 0.0, tr.w) * 0.6 * ao;
    fogC = hue(uTime * 0.01 + 0.7) * 0.04;
    glowC = hue(uTime * 0.012 + 0.9);`, 0.5);

const FS_MANDELBOX = fractalFS(`
// Mandelbox: space folded inside a box and turned inside out through a ball, over and over.
float map(vec3 p0, out vec4 tr) {
  vec3 p = p0 / ${FR.BOX_K.toFixed(4)}, c = p;
  float dr = 1.0;
  tr = vec4(1e5);
  for (int i = 0; i < 10; i++) {
    p = clamp(p, -1.0, 1.0) * 2.0 - p;
    float r2 = dot(p, p);
    tr = min(tr, vec4(abs(p), r2));
    float k = r2 < 0.25 ? 4.0 : r2 < 1.0 ? 1.0 / r2 : 1.0;
    p *= k;
    dr *= k;
    p = ${FR.BOX_S.toFixed(4)} * p + c;
    dr = dr * ${Math.abs(FR.BOX_S).toFixed(4)} + 1.0;
  }
  return length(p) / abs(dr) * ${FR.BOX_K.toFixed(4)};
}`, `
    // Dark gunmetal, with glowing seams where the folds turned inside out
    base = mix(vec3(0.32, 0.34, 0.38), hue(0.08 + uTime * 0.008 + tr.w * 0.15), 0.35);
    emit = hue(0.02 + uTime * 0.01 + tr.x * 0.2) * smoothstep(0.12, 0.0, min(tr.x, min(tr.y, tr.z))) * 0.45 * ao;
    fogC = hue(uTime * 0.01 + 0.08) * 0.035;
    glowC = hue(uTime * 0.012 + 0.05);`, 0.7);

const FS_SIERPINSKI = fractalFS(`
// Sierpinski pyramid: a pyramid made of four half-size pyramids, each made of four, and so on.
float map(vec3 p, out vec4 tr) {
  float s = 1.0;
  tr = vec4(1e5);
  for (int i = 0; i < 9; i++) {
    if (p.x + p.y < 0.0) p.xy = -p.yx;
    if (p.x + p.z < 0.0) p.xz = -p.zx;
    if (p.y + p.z < 0.0) p.zy = -p.yz;
    p = 2.0 * p - 1.0;
    s *= 2.0;
    tr = min(tr, vec4(abs(p), dot(p, p)));
  }
  return (max(max(-p.x - p.y - p.z, p.x + p.y - p.z), max(-p.x + p.y + p.z, p.x - p.y + p.z)) - 1.0) * 0.57735027 / s;
}`, `
    // Gold, with blue light deep in the gaps
    base = mix(vec3(1.0, 0.72, 0.32), hue(0.55 + uTime * 0.01 + tr.w * 0.05), 0.3 * clamp(tr.w * 0.3, 0.0, 1.0));
    emit = vec3(0.0);
    fogC = hue(uTime * 0.01 + 0.6) * 0.045;
    glowC = hue(uTime * 0.012 + 0.58);`);

const FS_JULIA = fractalFS(`
// Julia: a slice through a 4D Julia set (the Mandelbrot set's cousin), grown out of rounded lobes.
float map(vec3 p, out vec4 tr) {
  vec4 z = vec4(p * ${FR.JK.toFixed(4)}, 0.0);
  const vec4 C = vec4(${FR.JC.map((v) => v.toFixed(4)).join(', ')});
  float md2 = 1.0, mz2 = dot(z, z);
  tr = vec4(abs(z.xyz), mz2);
  for (int i = 0; i < 9; i++) {
    md2 *= 4.0 * mz2;
    z = vec4(z.x * z.x - dot(z.yzw, z.yzw), 2.0 * z.x * z.yzw) + C;
    mz2 = dot(z, z);
    tr = min(tr, vec4(abs(z.xyz), mz2));
    if (mz2 > 16.0) break;
  }
  return 0.25 * sqrt(mz2 / md2) * log(mz2) / ${FR.JK.toFixed(4)};
}`, `
    // Shimmering, like oil on water
    base = hue(0.35 + sqrt(tr.w) * 1.6 + uTime * 0.012);
    base = mix(base, vec3(0.9), 0.15);
    emit = hue(0.9 + uTime * 0.01) * smoothstep(0.05, 0.0, tr.w) * 0.5 * ao;
    fogC = hue(uTime * 0.01 + 0.8) * 0.04;
    glowC = hue(uTime * 0.012 + 0.35);`, 0.5);

const FS_KALEIDO = fractalFS(`
// Kaleidoscope: a box mirrored eight ways, turned a little, shrunk and mirrored again: faceted crystal.
float map(vec3 p, out vec4 tr) {
  float s = 1.0;
  tr = vec4(1e5);
  for (int i = 0; i < 4; i++) {
    p = vec3(dot(vec3(${FR.KR1.slice(0, 3).map((v) => v.toFixed(6))}), p), dot(vec3(${FR.KR1.slice(3, 6).map((v) => v.toFixed(6))}), p), dot(vec3(${FR.KR1.slice(6, 9).map((v) => v.toFixed(6))}), p));
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    p = vec3(dot(vec3(${FR.KR2.slice(0, 3).map((v) => v.toFixed(6))}), p), dot(vec3(${FR.KR2.slice(3, 6).map((v) => v.toFixed(6))}), p), dot(vec3(${FR.KR2.slice(6, 9).map((v) => v.toFixed(6))}), p));
    p = vec3(${FR.KS.toFixed(4)} * p.x - ${(FR.KC[0] * (FR.KS - 1)).toFixed(6)}, ${FR.KS.toFixed(4)} * p.y - ${(FR.KC[1] * (FR.KS - 1)).toFixed(6)}, ${FR.KS.toFixed(4)} * p.z);
    if (p.z > ${(0.5 * FR.KC[2] * (FR.KS - 1)).toFixed(6)}) p.z -= ${(FR.KC[2] * (FR.KS - 1)).toFixed(6)};
    s *= ${FR.KS.toFixed(4)};
    tr = min(tr, vec4(abs(p), dot(p, p)));
  }
  vec3 b = abs(p) - 1.0;
  return (min(max(b.x, max(b.y, b.z)), 0.0) + length(max(b, 0.0))) / s * ${FR.KSAFE.toFixed(2)};
}`, `
    // Ice and glass, catching every colour
    base = mix(vec3(0.5, 0.68, 0.8), hue(0.5 + tr.w * 0.03 + uTime * 0.015), 0.45);
    emit = hue(0.75 + uTime * 0.01 + tr.y * 0.1) * smoothstep(0.15, 0.0, tr.z) * 0.35 * ao;
    fogC = hue(uTime * 0.01 + 0.55) * 0.045;
    glowC = hue(uTime * 0.015 + 0.75);`, 0.7);



const FS_COPY = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSim;
out vec4 o;
void main() { o = vec4(texture(uSrc, gl_FragCoord.xy / uSim).rgb, 1.0); }`;

const FS_PROBE = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uOut;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uOut, d = 0.33 / uOut;
  float l = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++)
    l += dot(texture(uSrc, uv + vec2(float(x), float(y)) * d).rgb, vec3(0.299, 0.587, 0.114));
  o = vec4(clamp(l / 9.0, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

const FS_EYE = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uOut;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uOut, d = 0.25 / uOut;
  vec3 c = texture(uSrc, uv - d).rgb + texture(uSrc, uv + d).rgb +
           texture(uSrc, uv + vec2(d.x, -d.y)).rgb + texture(uSrc, uv + vec2(-d.x, d.y)).rgb;
  o = vec4(clamp(c * 0.25, 0.0, 1.0), 1.0);
}`;

return { FS_COPY, FS_PROBE, FS_EYE, VS, COMMON, FS_FEEDBACK, FS_COMPOSITE, FS_TIMEWARP, FS_DISPLAY, FS_CUBES, FS_HORIZON, FS_CAVERN, FS_BLACKHOLE, FS_AURORA, FS_MERCURY, FS_FRACTAL, FS_NEBULA, FS_CITY, FS_SPONGE, FS_BULB, FS_MANDELBOX, FS_SIERPINSKI, FS_JULIA, FS_KALEIDO };
})();
