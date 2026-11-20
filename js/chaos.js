'use strict';
// Chaos game: the old trick of starting anywhere inside a triangle, picking a corner at random and hopping halfway
// to it, over and over, which draws a Sierpinski triangle. Here, after an idea posted on Reddit, every hop goes
// towards the AVERAGE of several corners picked at random, and the polygon is itself made fractal (every corner
// carries a little polygon of corners, and each of those a smaller one still). With one corner a hop the picture is
// sharp and geometric; the more corners are averaged, the more it turns into cells, like something grown.
//
// Nothing is remembered between frames except the glow: every dot is worked out from scratch in the vertex shader
// (its own number picks its random corners for a run of hops from the middle), so the corners, the hop and the
// little polygons can all glide and the whole picture morphs with them (between two whole numbers of corners
// averaged, some dots use one and some the other, so it's two sharp pictures mixed, never a smear). The dots are added up in a picture of
// their own that fades over about a quarter of a second, and how many landed on each spot picks its color.
window.PhosphorChaos = (() => {
// A loop's settings (the app keeps them with the loop's look): sides 3-12, the rest 0-100. Drift (the app's doing,
// see chaosDrift in js/app.js) moves the faders about by themselves, at chaosSpeed; Corners too unless chaosDriftSides is off.
const DEFAULTS = { chaosSides: 12, chaosMix: 50, chaosJump: 50, chaosDeep: 30, chaosMove: 40, chaosColor: 0, chaosDrift: false, chaosSpeed: 40, chaosDriftSides: true,
  chaosDim: 0, chaosView: 0, chaosCrisp: true };   // Flat (0) or 3D (1); in 3D: 0 Turning, 1 Slices, 2 Fly-through
// The sets of colors. A ramp's eight colors run from where few dots land to where the most do; the dark ones in
// between are what turn a soft heap of dots into a ring with a dark middle. Corners gives each dot the color of the
// corner it last hopped towards; Rainbow is the Point cloud's rainbow (the whole color wheel, sliding along).
const PALETTES = [
  { name: 'Neon', c: [[0, 0, 0], [.10, .03, .42], [.14, .48, .92], [.02, .03, .16], [.78, .30, .05], [.90, .05, .12], [.04, .10, .16], [.20, 1, .80]] },
  { name: 'Lime', c: [[0, 0, 0], [.02, .30, .04], [.25, .75, .08], [.80, .85, .10], [.03, .05, .25], [.90, .45, .08], [.85, .08, .10], [1, .95, .85]] },
  { name: 'Corners', mode: 1 },
  { name: 'Phosphor', c: [[0, 0, 0], [.20, .03, .30], [.545, .10, .72], [.05, .01, .10], [.95, .25, .70], [.30, .05, .45], [.08, .02, .12], [1, .92, 1]] },
  { name: 'Rainbow', mode: 2 },
  { name: 'Fire', c: [[0, 0, 0], [.35, .02, .02], [.85, .12, .03], [.10, .01, .01], [1, .50, .05], [.55, .08, .02], [.12, .03, .01], [1, .95, .60]] },
  { name: 'Ice', c: [[0, 0, 0], [.03, .08, .35], [.10, .45, .85], [.01, .04, .14], [.45, .90, 1], [.08, .30, .60], [.02, .08, .16], [.95, 1, 1]] },
  { name: 'Sunset', c: [[0, 0, 0], [.25, .04, .38], [.85, .12, .50], [.10, .02, .14], [1, .45, .15], [.70, .10, .30], [.14, .03, .08], [1, .90, .45]] },
  { name: 'Ocean', c: [[0, 0, 0], [.02, .16, .26], [.04, .55, .58], [.01, .06, .12], [.20, .90, .55], [.05, .30, .70], [.02, .08, .14], [.80, 1, .95]] },
  { name: 'Gold', c: [[0, 0, 0], [.26, .13, .02], [.80, .55, .10], [.08, .04, .01], [1, .80, .30], [.50, .28, .05], [.10, .06, .02], [1, .97, .82]] },
  { name: 'Candy', c: [[0, 0, 0], [.45, .05, .40], [1, .35, .70], [.10, .03, .16], [.30, .90, 1], [.95, .85, .25], [.14, .05, .20], [1, 1, 1]] },
  { name: 'Mono', c: [[0, 0, 0], [.22, .22, .24], [.80, .80, .84], [.05, .05, .06], [.55, .55, .58], [1, 1, 1], [.10, .10, .11], [1, 1, 1]] },
];
const COLORS = PALETTES.map((P) => P.name);
// A set's colors as a CSS background, for its button
function preview(i) {
  const P = PALETTES[i] || PALETTES[0];
  if (P.mode === 1) return 'linear-gradient(90deg,#000 0 6%,#e05a5a,#d9d45a,#5ad97a,#5ac8d9,#7a6ee0,#d95ac0)';
  if (P.mode === 2) return 'linear-gradient(90deg,#000 0 6%,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';
  return 'linear-gradient(90deg,' + P.c.map((c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`).join(',') + ')';
}
const MAX_K = 6, MAX_N = 12, MAX_V3 = 20;
// 3D: the dots hop towards the corners of a solid instead of a flat polygon. The Corners fader (3 to 12) picks one of
// ten solids, from the 4-cornered pyramid (the Sierpinski pyramid) to the 20-cornered dodecahedron. Each is scaled to
// fit a ball of 1. "base" is what's left of a dot's own place at which the solid's copies of itself on its corners
// about touch (nearest two corners apart, against the widest): the middle of the Hop fader, as touchOf is in 2D.
const VIEWS = ['Turning', 'Slices', 'Fly-through'];
const SHAPES = (() => {
  const P = (1 + Math.sqrt(5)) / 2, pm = [-1, 1];
  const ring = (n, y, r, a0 = 0) => Array.from({ length: n }, (_, i) => [r * Math.cos(a0 + 2 * Math.PI * i / n), y, r * Math.sin(a0 + 2 * Math.PI * i / n)]);
  const cube = [], ico = [], cubo = [], dode = [];
  for (const x of pm) for (const y of pm) for (const z of pm) cube.push([x, y, z]);
  for (const a of pm) for (const b of pm) {
    ico.push([0, a, b * P], [a, b * P, 0], [b * P, 0, a]);
    cubo.push([a, b, 0], [a, 0, b], [0, a, b]);
    dode.push([0, a / P, b * P], [a / P, b * P, 0], [a * P, 0, b / P]);
  }
  const axes = [[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]];
  const list = [
    ['Pyramid', [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]],
    ['Double pyramid', [[0, 1, 0], [0, -1, 0], ...ring(3, 0, 1)]],
    ['Diamond', [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]],
    ['Gem', [[0, 1, 0], [0, -1, 0], ...ring(5, 0, 1)]],
    ['Cube', cube],
    ['Twisted box', [...ring(4, 0.55, 0.835), ...ring(4, -0.55, 0.835, Math.PI / 4)]],
    ['Icosahedron', ico],
    ['Cuboctahedron', cubo],
    ['Rhombic', [...cube, ...axes]],
    ['Dodecahedron', [...cube, ...dode]],
  ];
  return list.map(([name, L]) => {
    const r = Math.max(...L.map((v) => Math.hypot(...v)));
    L = L.map((v) => v.map((x) => x / r));
    let dmin = Infinity, dmax = 0;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const d = Math.hypot(L[i][0] - L[j][0], L[i][1] - L[j][1], L[i][2] - L[j][2]); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
    const v = new Float32Array(MAX_V3 * 3); L.forEach((p, i) => v.set(p, i * 3));
    return { name, v, n: L.length, base: dmin / (dmin + dmax) };
  });
})();
const shapeName = (sides) => (SHAPES[Math.round(sides) - 3] || SHAPES[0]).name;
// 3 x 3 turns, as rows, and as GLSL wants them (by columns)
const m3 = {
  axis(ax, a) { const l = Math.hypot(...ax), x = ax[0] / l, y = ax[1] / l, z = ax[2] / l, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]]; },
  mul(A, B) { return A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j])); },
  gl(R) { return new Float32Array([R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]]); },
};
const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; } };
const num = (v, d, a, b) => { v = +v; return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
function clean(s) {
  s = s || {};
  return { chaosSides: Math.round(num(s.chaosSides, DEFAULTS.chaosSides, 3, MAX_N)), chaosMix: num(s.chaosMix, DEFAULTS.chaosMix, 0, 100),
    chaosJump: num(s.chaosJump, DEFAULTS.chaosJump, 0, 100), chaosDeep: num(s.chaosDeep, DEFAULTS.chaosDeep, 0, 100),
    chaosMove: num(s.chaosMove, DEFAULTS.chaosMove, 0, 100), chaosColor: Math.round(num(s.chaosColor, 0, 0, COLORS.length - 1)),
    chaosDrift: !!s.chaosDrift, chaosSpeed: num(s.chaosSpeed, DEFAULTS.chaosSpeed, 0, 100), chaosDriftSides: s.chaosDriftSides !== false,
    chaosDim: num(s.chaosDim, 0, 0, 1) >= 0.5 ? 1 : 0, chaosView: Math.round(num(s.chaosView, 0, 0, VIEWS.length - 1)), chaosCrisp: s.chaosCrisp !== false };
}
// Keep it crisp: the rules found by scoring hundreds of patterns held still. The more corners the shape has, the fewer
// can be averaged before it turns into a fuzzy ball (12 corners: up to 3; 8 or more: up to 4); only whole numbers are
// averaged (in between, two patterns lie on top of each other); a soft Hop melts the fewer corners are averaged, so
// Hop has a floor (1 corner averaged: 50, 2: 40, 3: 35, 4 and up: 25); Fractal corners above 30 blurs everything.
const kOf = (mix) => 1 + (MAX_K - 1) * Math.pow(Math.max(0, Math.min(1, mix)), 1.3);   // mix 0-1
const mixFor = (k) => 100 * Math.pow(Math.max(0, (k - 1) / (MAX_K - 1)), 1 / 1.3);     // the fader value for k corners
const kCap = (corners) => corners >= 10 ? 3 : corners >= 8 ? 4 : MAX_K;
const kSnap = (k) => { const f = k - Math.floor(k), x = Math.max(0, Math.min(1, (f - 0.45) / 0.1)); return Math.floor(k) + x * x * (3 - 2 * x); };
const hopFloor = (k) => k <= 1 ? 0.5 : k <= 2 ? 0.5 - 0.1 * (k - 1) : k <= 3 ? 0.4 - 0.05 * (k - 2) : k <= 4 ? 0.35 - 0.1 * (k - 3) : 0.25;
const DEEP_MAX = 0.3;
const cornersOf = (s) => s.chaosDim === 1 ? (SHAPES[Math.round(s.chaosSides) - 3] || SHAPES[0]).n : Math.round(s.chaosSides);
// What a loop's faders really give, held still (for the readouts): corners averaged, Hop and Fractal corners, 0-100
function effective(s) {
  s = clean(s);
  let k = kOf(s.chaosMix / 100), jump = s.chaosJump, deep = s.chaosDeep;
  if (s.chaosCrisp) { k = Math.round(Math.min(k, kCap(cornersOf(s)))); jump = Math.max(jump, 100 * hopFloor(k)); deep = Math.min(deep, 100 * DEEP_MAX); }
  return { k, jump, deep, cap: s.chaosCrisp ? kCap(cornersOf(s)) : MAX_K };
}
// A pattern picked at random (the dice button, Surprise me and Autopilot); crisp (the default) keeps to the clean zones
function look(crisp = true) {
  const r = (a, b) => Math.round(a + Math.random() * (b - a));
  if (crisp) {
    const dim = Math.random() < 0.4 ? 1 : 0, sides = [3, 4, 5, 6, 6, 8, 8, 10, 12, 12, 12][r(0, 10)];
    const corners = cornersOf({ chaosDim: dim, chaosSides: sides }), cap = kCap(corners);
    // Two or three corners averaged most often (the cells and rings), now and then one (the classic fractals) or more
    const k = Math.min(cap, [1, 2, 2, 3, 3, 3, 4, 5, 6][r(0, 8)]);
    return { chaosSides: sides, chaosMix: Math.round(mixFor(k)), chaosJump: r(Math.max(45, 100 * hopFloor(k)), 75),
      chaosDeep: Math.random() < 0.3 ? 0 : r(5, 30), chaosMove: r(25, 70), chaosColor: r(0, COLORS.length - 1), chaosDim: dim, chaosView: r(0, VIEWS.length - 1) };
  }
  return { chaosSides: [3, 4, 5, 6, 6, 8, 8, 10, 12, 12, 12][r(0, 10)], chaosMix: Math.random() < 0.25 ? r(0, 25) : r(25, 100), chaosJump: r(35, 70),
    chaosDeep: Math.random() < 0.25 ? 0 : r(15, 100), chaosMove: r(25, 70), chaosColor: r(0, COLORS.length - 1),
    chaosDim: Math.random() < 0.4 ? 1 : 0, chaosView: r(0, VIEWS.length - 1) };
}

const VS_TRI = `#version 300 es
void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position=vec4(p*2.-1.,0.,1.); }`;
// One dot: a run of hops from the middle, each towards the average of uK corners (the last one counting for only
// the part of uK past a whole number, so the number averaged can glide)
const VS_DOT = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uV[${MAX_N}], uVb[${MAX_N}];   // the polygon's corners (on a circle of 1), already turned; and with one corner more
uniform vec2 uSub, uSub2;    // which way the little polygons on each corner are turned, and the smaller ones on theirs
uniform float uN, uNmix, uK, uDeep, uDeep2, uSame, uFit, uAsp, uSize;
uniform vec2 uLeft, uLeftB;  // what's left of a dot's own place after a hop, for floor(uK) corners and for one more (B: the polygon with one corner more)
uniform int uSteps;
uniform uint uSeed;
out vec3 vCol;
uint pcg(uint v){ uint s=v*747796405u+2891336453u; uint w=((s>>((s>>28u)+4u))^s)*277803737u; return (w>>22u)^w; }
vec2 mul(vec2 a, vec2 b){ return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
void main(){
  uint h=pcg(uint(gl_VertexID)*2654435761u ^ uSeed);
  // While the number of corners changes, some dots use the old polygon and some the new: two sharp pictures mixed
  bool nb=float(pcg(h^0x2c1b3c6du)>>8)/16777216.<uNmix;
  uint n=uint(uN)+(nb?1u:0u);
  // Each dot averages a whole number of corners: between two whole numbers some dots use one and some the other,
  // so the picture is always two sharp pictures mixed, never a smear
  float kf=floor(uK+1e-4), more=step(float(h>>8)/16777216., uK-kf);
  int kc=int(kf+more);
  vec2 lf=nb?uLeftB:uLeft;
  float left=mix(lf.x, lf.y, more), s1=uDeep/float(kc), s2=s1*s1*uDeep2, R=1./(1.+s1+s2);
  vec2 p=vec2(0.), first=vec2(0.);
  for(int s=0;s<uSteps;s++){
    vec2 t=vec2(0.); uint g=0u;
    for(int j=0;j<${MAX_K};j++){
      if(j>=kc) break;
      h=pcg(h+uint(j)+1u);
      // Now and then the same corner again: it spreads the dots out to the rim instead of heaping them in the middle
      if(j==0 || float(h>>8)/16777216.>=uSame) g=pcg(h^0x68bc21ebu);
      uint i0=g%n, i1=(g/n)%n, i2=(g/(n*n))%n;
      vec2 a=nb?uVb[i0]:uV[i0];
      t+=a+s1*mul(uSub,nb?uVb[i1]:uV[i1])+s2*mul(uSub2,nb?uVb[i2]:uV[i2]);
      if(j==0) first=a;
    }
    p=mix(t*(R/float(kc)), p, left);
  }
  vCol=vec3(1., first);
  gl_Position=vec4(p.x*uFit/uAsp, p.y*uFit, 0., 1.);
  gl_PointSize=uSize;
}`;
const FS_DOT = `#version 300 es
precision highp float;
uniform float uSoft, uW;
in vec3 vCol; out vec4 o;
void main(){
  float w=uW;
  if(uSoft>.5){ vec2 q=gl_PointCoord*2.-1.; w*=max(0., 1.-dot(q,q)); }
  o=vec4(vCol*w, w);
}`;
// One dot in 3D: the same hops, towards a solid's corners, with the little solids on each corner turned by uR1 / uR2.
// Then how it's seen: Turning (the whole solid turning in front of you, nearer dots brighter), Slices (only the dots
// in a thin slab sweeping through it) or Fly-through (a camera wandering inside the cloud, near dots bigger).
const VS_DOT3 = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 uV[${MAX_V3}], uVb[${MAX_V3}];   // this solid's corners; the next one's (while Corners changes)
uniform mat3 uR1, uR2, uView;
uniform vec3 uCam;
uniform float uN, uNb, uNmix, uK, uDeep, uDeep2, uSame, uFit, uAsp, uSize, uMode, uSlice, uThick;
uniform vec2 uLeft, uLeftB;
uniform int uSteps;
uniform uint uSeed;
out vec3 vCol;
out float vW, vPs;
uint pcg(uint v){ uint s=v*747796405u+2891336453u; uint w=((s>>((s>>28u)+4u))^s)*277803737u; return (w>>22u)^w; }
vec3 corner(bool b, uint i){ return b?uVb[i]:uV[i]; }
void main(){
  uint h=pcg(uint(gl_VertexID)*2654435761u ^ uSeed);
  bool nb=float(pcg(h^0x2c1b3c6du)>>8)/16777216.<uNmix;
  uint n=uint(nb?uNb:uN);
  float kf=floor(uK+1e-4), more=step(float(h>>8)/16777216., uK-kf);
  int kc=int(kf+more);
  vec2 lf=nb?uLeftB:uLeft;
  float left=mix(lf.x, lf.y, more), s1=uDeep/float(kc), s2=s1*s1*uDeep2, R=1./(1.+s1+s2);
  vec3 p=vec3(0.), first=vec3(0.);
  for(int s=0;s<uSteps;s++){
    vec3 t=vec3(0.); uint g=0u;
    for(int j=0;j<${MAX_K};j++){
      if(j>=kc) break;
      h=pcg(h+uint(j)+1u);
      if(j==0 || float(h>>8)/16777216.>=uSame) g=pcg(h^0x68bc21ebu);
      vec3 a=corner(nb, g%n);
      t+=a+s1*(uR1*corner(nb,(g/n)%n))+s2*(uR2*corner(nb,(g/(n*n))%n));
      if(j==0) first=a;
    }
    p=mix(t*(R/float(kc)), p, left);
  }
  float w=1., ps=uSize; vec2 xy=vec2(0.); bool keep=true;
  if(uMode<.5){            // Turning: seen from 4 away, so the near side is a little bigger
    vec3 q=uView*p; float D=4.;
    xy=q.xy*(D/(D-q.z))*uFit*1.2*(D-1.)/D;
    w=mix(.3,1.45,clamp(q.z*.5+.5,0.,1.));
  } else if(uMode<1.5){    // Slices: a soft slab of the solid, square on
    vec3 q=uView*p; float d=abs(q.z-uSlice)/uThick;
    keep=d<1.; w=1.-d*d; xy=q.xy*uFit*1.2;
  } else {                 // Fly-through: a camera inside it
    vec3 q=uView*(p-uCam);
    keep=q.z>.015;
    xy=q.xy*(1.15/max(q.z,.015));
    ps=clamp(uSize*.35/max(q.z,.01), uSize, uSize*7.);
    w=1./(1.+q.z*q.z*.8);
  }
  vec2 c2=vec2(first.x+.55*first.z, first.y-.45*first.z);
  vCol=vec3(1., c2);
  vW=keep?w:0.; vPs=ps;
  gl_Position=keep?vec4(xy.x/uAsp, xy.y, 0., 1.):vec4(2.,2.,2.,1.);
  gl_PointSize=ps;
}`;
// A 3D dot: soft and round when bigger than a pixel, adding up to the same in all whatever its size
const FS_DOT3 = `#version 300 es
precision highp float;
uniform float uW;
in vec3 vCol; in float vW, vPs; out vec4 o;
void main(){
  float w=uW*vW;
  if(vPs>1.5){ vec2 q=gl_PointCoord*2.-1.; w*=max(0., 1.-dot(q,q))/(vPs*vPs*.39); }
  o=vec4(vCol*w, w);
}`;
const FS_FADE = `#version 300 es
precision highp float;
uniform float uKeep; out vec4 o;
void main(){ o=vec4(0.,0.,0.,uKeep); }`;
// The finished picture: how many dots landed on each spot (on a log scale, so faint parts show and thick parts
// don't burn out) picks the color. The bands of each set of colors go dark between the bright ones, which is what
// turns a soft heap of dots into a ring with a dark middle.
const FS_SHOW = `#version 300 es
precision highp float;
uniform sampler2D uAcc;
uniform vec3 uC[8];
uniform float uNorm, uMode, uGain, uShift;
out vec4 o;
vec3 hue(float h){ return clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.); }
void main(){
  ivec2 q=ivec2(gl_FragCoord.xy), sz=textureSize(uAcc,0), m=sz-1;
  vec4 a=texelFetch(uAcc,q,0)*4.;
  a+=texelFetch(uAcc,clamp(q+ivec2(1,0),ivec2(0),m),0)+texelFetch(uAcc,clamp(q-ivec2(1,0),ivec2(0),m),0);
  a+=texelFetch(uAcc,clamp(q+ivec2(0,1),ivec2(0),m),0)+texelFetch(uAcc,clamp(q-ivec2(0,1),ivec2(0),m),0);
  a/=8.;
  float d=a.r*uNorm, x=log2(1.+d*uGain)/6.6;
  vec3 col;
  if(uMode<.5){        // a ramp of eight colors
    float y=clamp(x,0.,1.)*7.; int i=int(min(6., floor(y))); float f=y-float(i); f=f*f*(3.-2.*f);
    col=mix(uC[i], uC[i+1], f);
  } else if(uMode<1.5){ // Corners: each dot takes the color of the corner it last hopped towards
    float sat=clamp(length(a.gb)/max(a.r,1e-5)*1.6, 0., 1.);
    vec3 hcol=hue(atan(a.b,a.g)/6.2831853+uShift);
    float v=smoothstep(0.,.5,x)*(.55+.45*cos(x*18.));
    col=mix(vec3(.75), hcol, sat)*v;
  } else {              // Rainbow, as the Point cloud's: the whole color wheel by how thick the dots are and how high up, sliding along
    float v=smoothstep(0.,.4,x)*(.6+.4*cos(x*18.));
    col=hue(x*1.5+(gl_FragCoord.y/float(sz.y))*.35+uShift)*v;
  }
  col*=smoothstep(0., .035, x);
  o=vec4(col, 1.);
}`;

function create(gl) {
  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Chaos game shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs, names) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Chaos game program: ' + gl.getProgramInfoLog(p));
    const u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }
  // Dots are added up in a picture that can hold more than 255 a spot, where the graphics card can draw to one
  const deep = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const dot = program(VS_DOT, FS_DOT, ['uV', 'uVb', 'uLeftB', 'uNmix', 'uSub', 'uSub2', 'uN', 'uK', 'uDeep', 'uDeep2', 'uSame', 'uLeft', 'uFit', 'uAsp', 'uSize', 'uSteps', 'uSeed', 'uSoft', 'uW']);
  const dot3 = program(VS_DOT3, FS_DOT3, ['uV', 'uVb', 'uR1', 'uR2', 'uView', 'uCam', 'uN', 'uNb', 'uNmix', 'uK', 'uDeep', 'uDeep2', 'uSame', 'uFit', 'uAsp', 'uSize', 'uMode', 'uSlice', 'uThick', 'uLeft', 'uLeftB', 'uSteps', 'uSeed', 'uW']);
  const fade = program(VS_TRI, FS_FADE, ['uKeep']);
  const show = program(VS_TRI, FS_SHOW, ['uAcc', 'uNorm', 'uMode', 'uC', 'uGain', 'uShift']);
  const vao = gl.createVertexArray();
  const FIT = 0.95, RATE = 9e6, RATE3 = 14e6, TAU = 0.25, SAME = 0.3, THICK = 0.07;
  // Where 3D's dots would spread to if they were even, against Turning's disc: a Slice catches only about a tenth of
  // the dots, so it's as if they were spread ten times as thin; Fly-through fills the screen, with half behind the camera
  const C3_SLICE = 9, C3_FLY = 1.6;   // how much of the height it fills; dots a second; the glow's fade (seconds)

  function target(w, h, deepOne) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (deepOne) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const filt = deepOne ? gl.NEAREST : gl.LINEAR;
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filt], [gl.TEXTURE_MAG_FILTER, filt], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { t, f, w, h };
  }
  function state() {
    return { acc: null, out: null, total: 0, t: Math.random() * 600, turn: Math.random() * 6.283, sub: Math.random() * 6.283, kick: 0, kickV: 0,
      bass: 0, high: 0, frame: (Math.random() * 1e6) | 0, cur: null,
      yaw: Math.random() * 6.283, slice: Math.random() * 6.283, fly: Math.random() * 100 };
  }
  function release(st) {
    if (!st) return;
    for (const k of ['acc', 'out']) if (st[k]) { gl.deleteTexture(st[k].t); gl.deleteFramebuffer(st[k].f); st[k] = null; }
    st.total = 0;
  }

  // One frame at outW x outH with settings s (see DEFAULTS). opt: { music: { on, bass, high, hit } }. Returns the picture.
  function run(st, outW, outH, s, dt, opt = {}) {
    const vaoWas = gl.getParameter(gl.VERTEX_ARRAY_BINDING), blendWas = gl.isEnabled(gl.BLEND);
    const bs = gl.getParameter(gl.BLEND_SRC_RGB), bd = gl.getParameter(gl.BLEND_DST_RGB), bsa = gl.getParameter(gl.BLEND_SRC_ALPHA), bda = gl.getParameter(gl.BLEND_DST_ALPHA);
    dt = Math.min(0.25, Math.max(1 / 240, dt || 1 / 60));
    if (!st.acc || st.acc.w !== outW || st.acc.h !== outH) {
      release(st);
      st.acc = target(outW, outH, deep); st.out = target(outW, outH, false);
    }
    s = clean(s);
    // The settings glide to where the faders are (the number of corners too: see the two polygons below)
    const want = { sides: s.chaosSides, mix: s.chaosMix / 100, jump: s.chaosJump / 100, deep: s.chaosDeep / 100, move: s.chaosMove / 100 };
    if (!st.cur) st.cur = { ...want };
    const ease = 1 - Math.exp(-dt * 5);
    for (const k of Object.keys(want)) if (k !== 'sides') st.cur[k] += (want[k] - st.cur[k]) * ease;
    // Corners change over a second or two, one corner at a time: between two whole numbers the dots are shared
    // between the two polygons
    if (!Number.isFinite(st.cur.sides)) st.cur.sides = want.sides;
    { const d = want.sides - st.cur.sides, step = dt * Math.max(0.9, Math.abs(d) * 1.2); st.cur.sides = Math.abs(d) <= step ? want.sides : st.cur.sides + Math.sign(d) * step; }
    const c = st.cur, N = Math.min(MAX_N, Math.floor(c.sides + 1e-4)), Nb = Math.min(MAX_N, N + 1);
    const nmix = N === Nb ? 0 : (() => { const f = c.sides - N; return f * f * (3 - 2 * f); })();
    // The music: the bass tightens the hop (the cells pull in to bright knots and let go), the high sounds average
    // more corners (more grown-looking), and a hit shoves the turning along
    const M = opt.music || {}, mOn = !!M.on;
    st.bass += ((mOn ? Math.min(1, M.bass || 0) : 0) - st.bass) * (1 - Math.exp(-dt * 14));
    st.high += ((mOn ? Math.min(1, M.high || 0) : 0) - st.high) * (1 - Math.exp(-dt * 10));
    if (mOn && M.hit > 0) st.kickV += 0.5 + Math.min(1.5, M.hit) * 0.5;
    st.kick += st.kickV * dt; st.kickV *= Math.exp(-dt * 4);
    // Moving by itself: the polygon turns, the little polygons turn the other way on their corners (which is what
    // reshuffles the cells), and the hop, the number averaged and the little polygons' size breathe, each at its own pace
    const mv = c.move;
    st.t += dt;
    st.turn += dt * 0.045 * mv;
    st.sub += dt * 0.10 * mv;
    const turn = st.turn + st.kick * 0.25, subTurn = -(st.sub + st.kick * 0.6);
    const crisp = s.chaosCrisp;
    // (Crisp: no breathing of the number averaged, which would hold it between whole numbers; the high sounds still
    // push it up a whole corner at a time)
    let K = kOf(c.mix) + (crisp ? 0 : 0.7 * mv * Math.sin(st.t * 0.083 + 1.3)) + 1.2 * st.high;
    K = Math.max(1, Math.min(MAX_K, K));
    if (crisp) K = kSnap(Math.min(K, kCap(s.chaosDim === 1 ? (SHAPES[N - 3] || SHAPES[0]).n : N)));
    // The classic game's hop is the average of where the dot is and the corner picked. With more corners the dot's
    // own place counts for less the more corners there are to average and the more sides the polygon has (0.5 over
    // "touch" is the hop at which a polygon's copies of itself just touch: the triangle's and square's half, the
    // pentagon's 0.38 and so on). That's the middle of the Hop fader. Softer keeps more of the dot's own place (the
    // dots smear into each other), sharper less (tight separate dots).
    const touchOf = (n) => { let t = 1; for (let i = 1; i <= Math.floor(n / 4); i++) t += Math.cos(2 * Math.PI * i / n); return t; };
    const jumpNow = crisp ? Math.max(c.jump, hopFloor(K)) : c.jump, deepNow = crisp ? Math.min(c.deep, DEEP_MAX) : c.deep;
    const hop = Math.pow(2, (0.5 - jumpNow) * 3) * (1 + 0.14 * mv * Math.sin(st.t * 0.127)) * (1 - 0.22 * st.bass);
    const leftFor = (k, n) => Math.max(0.03, Math.min(0.8, (0.5 / touchOf(n) / Math.pow(k, 1.6)) * hop));
    const k0 = Math.floor(K + 1e-4), k1 = Math.min(MAX_K, k0 + 1), left0 = leftFor(k0, N), left1 = leftFor(k1, N);
    const deep1 = 0.16 * deepNow * (1 + 0.3 * mv * Math.sin(st.t * 0.061 + 2.1)), deep2 = Math.min(1, Math.max(0, (deepNow - 0.3) / 0.3));
    const dim3 = s.chaosDim === 1;
    const px = Math.max(1, Math.round(outH / 620)), soft = px > 1;
    const keep = deep ? Math.exp(-dt / TAU) : 0;
    const seed = (st.frame = (st.frame + 1) >>> 0) * 0x9E3779B9 >>> 0;
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.acc.f);
    gl.viewport(0, 0, outW, outH);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    if (deep) {
      gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
      gl.useProgram(fade.p); gl.uniform1f(fade.u.uKeep, keep);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.blendFunc(gl.ONE, gl.ONE);
    let n, each, cover;
    const disc = Math.PI * Math.pow(FIT * outH / 2, 2) * 0.45;
    if (dim3) {
      // The solid (and the next one while Corners changes), the hop for each, and how it's seen
      const A = SHAPES[N - 3] || SHAPES[0], B = SHAPES[Nb - 3] || A;
      const left3 = (k, S) => Math.max(0.03, Math.min(0.8, (S.base / Math.pow(k, 1.6)) * hop));
      const l0 = left3(k0, A);
      const steps = Math.max(5, Math.min(22, Math.ceil(Math.log(0.0015) / Math.log(Math.max(l0, nmix > 0 ? left3(k0, B) : 0)))));
      const view = s.chaosView;
      st.yaw += dt * (0.06 + 0.4 * mv); st.slice += dt * (0.05 + 0.35 * mv); st.fly += dt * (0.03 + 0.2 * mv);
      const yaw = st.yaw + st.kick * 0.3, pitch = 0.35 + 0.4 * Math.sin(st.t * 0.07);
      let M = m3.mul(m3.axis([1, 0, 0], pitch), m3.axis([0, 1, 0], yaw)), cam = [0, 0, 0];
      if (view === 2) {
        // A wandering path inside the cloud, looking a little ahead and in towards the middle, rolling now and then
        const at = (f) => [0.55 * Math.sin(f), 0.45 * Math.sin(f * 1.37 + 1.1), 0.55 * Math.sin(f * 0.83 + 2.3)];
        cam = at(st.fly);
        const ahead = at(st.fly + 0.5).map((x) => x * 0.7);
        const fwd = v3.norm(v3.sub(ahead, cam));
        let right = v3.norm(v3.cross(fwd, [0, 1, 0])), up = v3.cross(right, fwd);
        const roll = 0.5 * Math.sin(st.fly * 0.41) + st.kick * 0.3, cr = Math.cos(roll), sr = Math.sin(roll);
        [right, up] = [right.map((x, i) => x * cr + up[i] * sr), up.map((x, i) => x * cr - right[i] * sr)];
        M = [right, up, fwd];
      }
      gl.useProgram(dot3.p);
      gl.uniform3fv(dot3.u.uV, A.v); gl.uniform3fv(dot3.u.uVb, B.v);
      gl.uniform1f(dot3.u.uN, A.n); gl.uniform1f(dot3.u.uNb, B.n); gl.uniform1f(dot3.u.uNmix, nmix);
      gl.uniform2f(dot3.u.uLeft, l0, left3(k1, A)); gl.uniform2f(dot3.u.uLeftB, left3(k0, B), left3(k1, B));
      gl.uniformMatrix3fv(dot3.u.uR1, false, m3.gl(m3.axis([1, 1, 0.3], subTurn)));
      gl.uniformMatrix3fv(dot3.u.uR2, false, m3.gl(m3.axis([0.2, -1, 1], 2.3 * subTurn)));
      gl.uniformMatrix3fv(dot3.u.uView, false, m3.gl(M));
      gl.uniform3f(dot3.u.uCam, cam[0], cam[1], cam[2]);
      gl.uniform1f(dot3.u.uK, K); gl.uniform1f(dot3.u.uDeep, deep1); gl.uniform1f(dot3.u.uDeep2, deep2); gl.uniform1f(dot3.u.uSame, SAME);
      gl.uniform1f(dot3.u.uFit, FIT); gl.uniform1f(dot3.u.uAsp, outW / outH); gl.uniform1f(dot3.u.uSize, px);
      gl.uniform1f(dot3.u.uMode, view); gl.uniform1f(dot3.u.uSlice, 0.75 * Math.sin(st.slice)); gl.uniform1f(dot3.u.uThick, THICK);
      gl.uniform1i(dot3.u.uSteps, steps); gl.uniform1ui(dot3.u.uSeed, seed);
      gl.uniform1f(dot3.u.uW, deep ? 1 : 2 / 255);
      n = Math.round(Math.max(80000, Math.min(deep ? 320000 : 200000, RATE3 * dt)));
      gl.drawArrays(gl.POINTS, 0, n);
      each = 1;
      cover = view === 0 ? disc * 1.1 : view === 1 ? disc * C3_SLICE : outW * outH * C3_FLY;
    } else {
      const ring = (n) => { const V = new Float32Array(MAX_N * 2); for (let i = 0; i < n; i++) { const a = turn + Math.PI / 2 + (i / n) * 2 * Math.PI; V[i * 2] = Math.cos(a); V[i * 2 + 1] = Math.sin(a); } return V; };
      const V = ring(N), Vb = ring(Nb);
      // Enough hops that where a dot started no longer shows
      const steps = Math.max(5, Math.min(22, Math.ceil(Math.log(0.0015) / Math.log(Math.max(left0, nmix > 0 ? leftFor(k0, Nb) : 0)))));
      n = Math.round(Math.max(60000, Math.min(deep ? 240000 : 200000, RATE * dt)));
      each = soft ? px * px * 0.39 : 1;   // what one dot adds in all (a soft round dot's average over its square)
      gl.useProgram(dot.p);
      gl.uniform2fv(dot.u.uV, V); gl.uniform2fv(dot.u.uVb, Vb); gl.uniform1f(dot.u.uNmix, nmix);
      gl.uniform2f(dot.u.uLeftB, leftFor(k0, Nb), leftFor(k1, Nb));
      gl.uniform2f(dot.u.uSub, Math.cos(subTurn), Math.sin(subTurn));
      gl.uniform2f(dot.u.uSub2, Math.cos(2.3 * subTurn), Math.sin(2.3 * subTurn));
      gl.uniform1f(dot.u.uN, N); gl.uniform1f(dot.u.uK, K); gl.uniform2f(dot.u.uLeft, left0, left1);
      gl.uniform1f(dot.u.uDeep, deep1); gl.uniform1f(dot.u.uDeep2, deep2); gl.uniform1f(dot.u.uSame, SAME);
      gl.uniform1f(dot.u.uFit, FIT); gl.uniform1f(dot.u.uAsp, outW / outH); gl.uniform1f(dot.u.uSize, px);
      gl.uniform1i(dot.u.uSteps, steps); gl.uniform1ui(dot.u.uSeed, seed);
      gl.uniform1f(dot.u.uSoft, soft ? 1 : 0); gl.uniform1f(dot.u.uW, deep ? 1 : 2 / 255);
      gl.drawArrays(gl.POINTS, 0, n);
      cover = disc;
    }
    st.total = st.total * keep + n;

    // Colors by how many dots landed there, against how many there'd be if they were spread evenly over the shape
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.out.f);
    gl.useProgram(show.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.acc.t); gl.uniform1i(show.u.uAcc, 0);
    gl.uniform1f(show.u.uNorm, (deep ? 1 : 255 / 2) * cover / (st.total * each));
    const P = PALETTES[s.chaosColor] || PALETTES[0];
    gl.uniform1f(show.u.uMode, P.mode || 0); gl.uniform1f(show.u.uGain, 2.2 * (1 + 0.5 * st.bass));
    if (P.c) gl.uniform3fv(show.u.uC, P.flat || (P.flat = new Float32Array(P.c.flat())));
    gl.uniform1f(show.u.uShift, P.mode === 1 ? st.t * 0.01 * mv : P.mode === 2 ? st.t * 0.03 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(vaoWas);
    gl.blendFuncSeparate(bs, bd, bsa, bda);
    if (blendWas) gl.enable(gl.BLEND);
    return st.out.t;
  }
  return { state, run, release, deep };
}
return { DEFAULTS, COLORS, PALETTES, VIEWS, SHAPES, shapeName, preview, clean, look, effective, mixFor, kCap, hopFloor, DEEP_MAX, create };
})();
