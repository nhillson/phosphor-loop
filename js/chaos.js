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
const DEFAULTS = { chaosSides: 12, chaosMix: 50, chaosJump: 50, chaosDeep: 30, chaosMove: 40, chaosColor: 0, chaosDrift: false, chaosSpeed: 40, chaosDriftSides: true };
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
const MAX_K = 6, MAX_N = 12;
const num = (v, d, a, b) => { v = +v; return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
function clean(s) {
  s = s || {};
  return { chaosSides: Math.round(num(s.chaosSides, DEFAULTS.chaosSides, 3, MAX_N)), chaosMix: num(s.chaosMix, DEFAULTS.chaosMix, 0, 100),
    chaosJump: num(s.chaosJump, DEFAULTS.chaosJump, 0, 100), chaosDeep: num(s.chaosDeep, DEFAULTS.chaosDeep, 0, 100),
    chaosMove: num(s.chaosMove, DEFAULTS.chaosMove, 0, 100), chaosColor: Math.round(num(s.chaosColor, 0, 0, COLORS.length - 1)),
    chaosDrift: !!s.chaosDrift, chaosSpeed: num(s.chaosSpeed, DEFAULTS.chaosSpeed, 0, 100), chaosDriftSides: s.chaosDriftSides !== false };
}
// A pattern picked at random (the dice button, Surprise me and Autopilot)
function look() {
  const r = (a, b) => Math.round(a + Math.random() * (b - a));
  return { chaosSides: [3, 4, 5, 6, 6, 8, 8, 10, 12, 12, 12][r(0, 10)], chaosMix: Math.random() < 0.25 ? r(0, 25) : r(25, 100), chaosJump: r(35, 70),
    chaosDeep: Math.random() < 0.25 ? 0 : r(15, 100), chaosMove: r(25, 70), chaosColor: r(0, COLORS.length - 1) };
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
  const fade = program(VS_TRI, FS_FADE, ['uKeep']);
  const show = program(VS_TRI, FS_SHOW, ['uAcc', 'uNorm', 'uMode', 'uC', 'uGain', 'uShift']);
  const vao = gl.createVertexArray();
  const FIT = 0.95, RATE = 9e6, TAU = 0.25, SAME = 0.3;   // how much of the height it fills; dots a second; the glow's fade (seconds)

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
      bass: 0, high: 0, frame: (Math.random() * 1e6) | 0, cur: null };
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
    let K = 1 + (MAX_K - 1) * Math.pow(c.mix, 1.3) + 0.7 * mv * Math.sin(st.t * 0.083 + 1.3) + 1.2 * st.high;
    K = Math.max(1, Math.min(MAX_K, K));
    // The classic game's hop is the average of where the dot is and the corner picked. With more corners the dot's
    // own place counts for less the more corners there are to average and the more sides the polygon has (0.5 over
    // "touch" is the hop at which a polygon's copies of itself just touch: the triangle's and square's half, the
    // pentagon's 0.38 and so on). That's the middle of the Hop fader. Softer keeps more of the dot's own place (the
    // dots smear into each other), sharper less (tight separate dots).
    const touchOf = (n) => { let t = 1; for (let i = 1; i <= Math.floor(n / 4); i++) t += Math.cos(2 * Math.PI * i / n); return t; };
    const hop = Math.pow(2, (0.5 - c.jump) * 3) * (1 + 0.14 * mv * Math.sin(st.t * 0.127)) * (1 - 0.22 * st.bass);
    const leftFor = (k, n) => Math.max(0.03, Math.min(0.8, (0.5 / touchOf(n) / Math.pow(k, 1.6)) * hop));
    const k0 = Math.floor(K + 1e-4), k1 = Math.min(MAX_K, k0 + 1), left0 = leftFor(k0, N), left1 = leftFor(k1, N);
    const deep1 = 0.16 * c.deep * (1 + 0.3 * mv * Math.sin(st.t * 0.061 + 2.1)), deep2 = Math.min(1, Math.max(0, (c.deep - 0.3) / 0.3));
    const ring = (n) => { const V = new Float32Array(MAX_N * 2); for (let i = 0; i < n; i++) { const a = turn + Math.PI / 2 + (i / n) * 2 * Math.PI; V[i * 2] = Math.cos(a); V[i * 2 + 1] = Math.sin(a); } return V; };
    const V = ring(N), Vb = ring(Nb);
    // Enough hops that where a dot started no longer shows
    const steps = Math.max(5, Math.min(22, Math.ceil(Math.log(0.0015) / Math.log(Math.max(left0, nmix > 0 ? leftFor(k0, Nb) : 0)))));
    // As many dots a second whatever the frame rate, so the picture is as thick at 30 frames a second as at 60
    const px = Math.max(1, Math.round(outH / 620)), soft = px > 1;
    const n = Math.round(Math.max(60000, Math.min(deep ? 240000 : 200000, RATE * dt)));
    const keep = deep ? Math.exp(-dt / TAU) : 0;
    const each = soft ? px * px * 0.39 : 1;   // what one dot adds in all (a soft round dot's average over its square)

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
    gl.useProgram(dot.p);
    gl.uniform2fv(dot.u.uV, V); gl.uniform2fv(dot.u.uVb, Vb); gl.uniform1f(dot.u.uNmix, nmix);
    gl.uniform2f(dot.u.uLeftB, leftFor(k0, Nb), leftFor(k1, Nb));
    gl.uniform2f(dot.u.uSub, Math.cos(subTurn), Math.sin(subTurn));
    gl.uniform2f(dot.u.uSub2, Math.cos(2.3 * subTurn), Math.sin(2.3 * subTurn));
    gl.uniform1f(dot.u.uN, N); gl.uniform1f(dot.u.uK, K); gl.uniform2f(dot.u.uLeft, left0, left1);
    gl.uniform1f(dot.u.uDeep, deep1); gl.uniform1f(dot.u.uDeep2, deep2); gl.uniform1f(dot.u.uSame, SAME);
    gl.uniform1f(dot.u.uFit, FIT); gl.uniform1f(dot.u.uAsp, outW / outH); gl.uniform1f(dot.u.uSize, px);
    gl.uniform1i(dot.u.uSteps, steps); gl.uniform1ui(dot.u.uSeed, (st.frame = (st.frame + 1) >>> 0) * 0x9E3779B9 >>> 0);
    gl.uniform1f(dot.u.uSoft, soft ? 1 : 0); gl.uniform1f(dot.u.uW, deep ? 1 : 2 / 255);
    gl.drawArrays(gl.POINTS, 0, n);
    st.total = st.total * keep + n;

    // Colors by how many dots landed there, against how many there'd be if they were spread evenly over the shape
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.out.f);
    gl.useProgram(show.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.acc.t); gl.uniform1i(show.u.uAcc, 0);
    const cover = Math.PI * Math.pow(FIT * outH / 2, 2) * 0.45;
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
return { DEFAULTS, COLORS, PALETTES, preview, clean, look, create };
})();
