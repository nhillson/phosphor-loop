'use strict';
// Fractal wrap: pictures wrapped round the iteration bands of a Julia or Mandelbrot set, after Ivan Freyman's
// FractalWrapper (bryceguy72, http://FreymanArt.com; public domain, credit asked). As his julia.frag does: each pixel
// is iterated z = z² + c until |z|² > 400; the angle of that last z picks the spot across the tile (once round = the
// whole tile, a quarter-tile phase for tiles up to 3:1, the iterate before for wider ones), and
// (log 400 − log|z|) / (log 400 / 2) picks the spot down it (0 at the top = the outer edge of each band). Points that
// escape in fewer than Min layers steps stay black; the outermost band drawn (exactly Min layers) uses the tile's
// "cap", so the outer ring is whole; Glow fades deeper bands towards a colour; Outline (distance estimation) draws the
// set's edge in a fine colour line.
//
// The tile is what makes the gallery look: a 2:1 picture whose right half is the subject (a head, a hand) and whose
// left half is a stretched stem narrowing downwards, so each band's bottom meets the next band's tops. Tile pictures
// are such tiles (his, or your own; a "…cap" file beside one is its cap). Every other source (a picture, the video,
// the camera, a loop) is turned into a tile here: its middle, cut out from its background, as the subject, and its
// bottom edge stretched into a tapering stem; its cap is the subject twice.
//
// Moving: the Julia c wanders a little round its shape, the view breathes and turns, Flow slides the bands outward
// or inward (each band's content handing on to the next, doubled round, as the bands themselves are), and music
// hits jolt c along, the bass swelling the view.
window.PhosphorFractalWrap = (() => {
const DEFAULTS = { fwAmt: 0, fwKind: 0, fwShape: 0, fwDrift: 10, fwZoom: 14, fwSpin: 0, fwFlow: 0, fwMin: 4, fwDetail: 1,
  fwGlow: true, fwGlowCol: 0, fwGlowIn: 50, fwEdge: true, fwEdgeCol: 0, fwEdgeW: 30, fwCut: true, fwSmooth: false, fwMusic: true };
// Julia constants: his three parameter files first, then other well-known shapes; each wanders a little round its spot
const SHAPES = [
  { name: 'Dendrite', c: [0.0, 1.0], r: [0.004, 0.004] },          // "Darth parameters": c = i
  { name: 'Cauliflower', c: [0.3321, -0.0001], r: [0.003, 0.003] }, // "ET parameters"
  { name: 'Dust', c: [-2.3733, 0.0], r: [0.02, 0.0] },              // "Terminator params"
  { name: 'Spine', c: [-1.6, 0.0], r: [0.08, 0.0] },
  { name: 'Spiral ring', c: [-0.8, 0.156], r: [0.006, 0.005] },
  { name: 'Rabbit', c: [-0.123, 0.745], r: [0.008, 0.008] },
  { name: 'Spirals', c: [-0.7269, 0.1889], r: [0.008, 0.008] },
  { name: 'Wandering', c: [-0.75, 0.0], r: [0, 0] },               // all round the edge of the main body
];
const DETAIL = [42, 64, 96, 132];
const GLOWS = [[1, 0.3, 0.39], [1, 0.72, 0.42], [0.54, 0.72, 1], [0.545, 0.102, 0.722], [1, 1, 1]];   // rose, gold, ice, purple, white
const GLOW_NAMES = ['Rose', 'Gold', 'Ice', 'Purple', 'White'];
const EDGES = [[1, 1, 1], [1, 0.9, 0.77], [0.84, 0.96, 1], [0.8, 0.5, 1]];
const EDGE_NAMES = ['White', 'Cream', 'Ice', 'Lilac'];
// A recipe sets every setting but Amount
const RECIPES = {
  'Darth':        { fwKind: 0, fwShape: 0, fwZoom: 14, fwMin: 4, fwDetail: 0, fwGlow: true, fwGlowCol: 0, fwGlowIn: 55, fwEdge: true, fwEdgeCol: 0, fwEdgeW: 30, fwFlow: 0, fwSpin: 0, fwDrift: 10 },
  'Cauliflower':  { fwKind: 0, fwShape: 1, fwZoom: 18, fwMin: 4, fwDetail: 3, fwGlow: true, fwGlowCol: 1, fwGlowIn: 45, fwEdge: true, fwEdgeCol: 1, fwEdgeW: 40, fwFlow: 0, fwSpin: 0, fwDrift: 10 },
  'Dust':         { fwKind: 0, fwShape: 2, fwZoom: 5, fwMin: 3, fwDetail: 1, fwGlow: true, fwGlowCol: 2, fwGlowIn: 50, fwEdge: true, fwEdgeCol: 2, fwEdgeW: 25, fwFlow: 0, fwSpin: 0, fwDrift: 10 },
  'Hands':        { fwKind: 0, fwShape: 3, fwZoom: 8, fwMin: 4, fwDetail: 2, fwGlow: true, fwGlowCol: 4, fwGlowIn: 40, fwEdge: true, fwEdgeCol: 0, fwEdgeW: 25, fwFlow: 0, fwSpin: 0, fwDrift: 10 },
  'Spiral ring':  { fwKind: 0, fwShape: 4, fwZoom: 2, fwMin: 4, fwDetail: 3, fwGlow: true, fwGlowCol: 4, fwGlowIn: 22, fwEdge: true, fwEdgeCol: 0, fwEdgeW: 25, fwFlow: 0, fwSpin: 5, fwDrift: 8 },
  'Endless':      { fwKind: 0, fwShape: 7, fwZoom: 10, fwMin: 3, fwDetail: 2, fwGlow: true, fwGlowCol: 3, fwGlowIn: 50, fwEdge: false, fwEdgeCol: 0, fwEdgeW: 30, fwFlow: 40, fwSpin: 8, fwDrift: 25 },
  'Seahorse valley': { fwKind: 1, fwShape: 0, fwZoom: 70, fwMin: 3, fwDetail: 3, fwGlow: true, fwGlowCol: 1, fwGlowIn: 50, fwEdge: true, fwEdgeCol: 1, fwEdgeW: 30, fwFlow: 0, fwSpin: 3, fwDrift: 10 },
};

const VS_TRI = `#version 300 es
out vec2 vUv; void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uMain, uCap, uOrig;
uniform vec2 uC, uCenter, uRot, uHalf;     // Julia c; view centre; turn; half the view's width and height
uniform float uMini, uMaxi, uKind, uFlow, uT, uSeed;
uniform float uTileAsp;                      // the tile's width / height (2 or 4 for tile pictures)
uniform float uAuto, uSrcAsp, uSrcFlipV, uSrcFlipX, uCut, uSelfBands;   // an ordinary picture made into a tile
uniform float uGlow, uGlowMin, uGlowMax; uniform vec3 uGlowCol;
uniform float uEdge, uEdgeTh; uniform vec3 uEdgeCol;
uniform float uEffect, uAmt, uAA;
in vec2 vUv; out vec4 o;
const float PI=3.1415926535, ESCAPE=400., LOG_ESCAPE=5.991464547;
vec3 hue(float h){ return clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.); }
// --- an ordinary picture as a tile ---
vec4 src(vec2 q){ if(uSrcFlipX>.5) q.x=1.-q.x; if(uSrcFlipV>.5) q.y=1.-q.y; return textureLod(uMain, q, 0.); }
vec3 bgCol(){
  vec3 b=vec3(0.);
  for(int i=0;i<5;i++){ float f=(float(i)+.5)/5.;
    b+=src(vec2(f,.01)).rgb+src(vec2(f,.99)).rgb+src(vec2(.01,f)).rgb+src(vec2(.99,f)).rgb; }
  return b/20.;
}
vec3 keyed(vec4 t, vec3 bg){ vec3 c=t.rgb*t.a; return uCut>.5 ? c*smoothstep(.10,.22,distance(t.rgb,bg)) : c; }
// The subject: the picture's middle, as wide as it is tall (top of the picture at the top of the band)
vec3 subject(vec2 s, vec3 bg){
  vec2 q=vec2(.5+(s.x-.5)*min(1., 1./uSrcAsp), s.y);
  if(uSrcAsp<1.) q.y=.5+(q.y-.5)*uSrcAsp;
  return keyed(src(q), bg);
}
// The stem: the subject's bottom edge stretched down, narrowing to half its width, as the hand-made tiles' arms are
vec3 stem(vec2 s, vec3 bg){
  float w=mix(.95, .42, s.y), d=(s.x-.5)/w;
  if(abs(d)>.5) return vec3(0.);
  float u=.5+d*min(1., 1./uSrcAsp);
  float v=mix(.88, .97, s.y);                 // a strip at the picture's bottom, read a little lower further down
  return keyed(src(vec2(u, v)), bg)*(1.-smoothstep(.42,.5,abs(d))*.6);
}
vec3 autoTile(vec2 tc, bool cap, vec3 bg){
  float x=fract(tc.x)*2.; bool right=x>=1.; vec2 s=vec2(fract(x), tc.y);
  if(cap || right) return subject(s, bg);
  return stem(s, bg);
}
// --- one sample: his sampleColor() ---
vec3 sampleColor(vec2 p0, vec3 bg){
  vec2 z, c, dz;
  if(uKind<.5){ z=p0; c=uC; dz=vec2(1.,0.); } else { z=vec2(0.); c=p0; dz=vec2(0.); }
  vec2 prev=z; float iter=0., rrii=0.; bool esc=false;
  float maxE = uEdge>.5 ? uMaxi*2. : uMaxi;
  for(int i=1;i<=264;i++){
    if(float(i)>maxE) break;
    if(uEdge>.5){ dz=2.*vec2(z.x*dz.x-z.y*dz.y, z.x*dz.y+z.y*dz.x); if(uKind>.5) dz.x+=1.; }
    prev=z;
    z=vec2(z.x*z.x-z.y*z.y, 2.*z.x*z.y)+c;
    rrii=dot(z,z);
    if(rrii>ESCAPE){ iter=float(i); esc=true; break; }
  }
  if(!esc || iter<uMini) return vec3(-1.);   // inside, or outside the outermost band: the caller decides
  float zMag=sqrt(rrii), lz=log(zMag);
  bool wide=uTileAsp>3.;
  vec2 az = wide ? prev : z;
  float phase = wide ? 0. : .25;                 // px/2 of a 2px-wide tile = a quarter round
  float ang=mod(atan(az.y, az.x)/(2.*PI)+phase, 1.);
  float rad=clamp((LOG_ESCAPE-lz)/(LOG_ESCAPE/2.), 0., 1.);
  // Flow: the band's content slides down (inward) or up; past the band's end it carries on into the next band,
  // where the same spot round is reached twice as fast, as the bands double going in
  float yy=rad+uFlow, k=floor(yy), band=iter+k;
  vec2 tc=vec2(fract(ang*exp2(-k)), fract(yy));
  bool cap = band<uMini+.5;
  vec3 col;
  if(uAuto>.5) col=autoTile(tc, cap, bg);
  else col = cap ? textureLod(uCap, tc, 0.).rgb : textureLod(uMain, tc, 0.).rgb;
  if(uSelfBands>.5 && dot(col,vec3(.299,.587,.114))<.04) col=mix(col, hue(band*.13+ang+uSeed+uT*.02)*.35, .8);
  if(uGlow>.5){ float t=clamp((iter-uGlowMin)/max(1., uGlowMax-uGlowMin), 0., 1.); col=mix(col, uGlowCol, t); }
  if(uEdge>.5){
    float dm=length(dz), dist = dm>0. ? zMag*lz/dm : 1e10;
    if(dist<uEdgeTh) col=uEdgeCol;
  }
  return col;
}
void main(){
  vec3 bg = (uAuto>.5 && uCut>.5) ? bgCol() : vec3(0.);
  vec3 acc=vec3(0.); float n=0.;
  int AA = uAA>1.5 ? 2 : 1;
  vec2 px=vec2(dFdx(vUv.x), dFdy(vUv.y));
  for(int j=0;j<2;j++) for(int i=0;i<2;i++){
    if(i>=AA || j>=AA) continue;
    vec2 off = AA>1 ? (vec2(float(i),float(j))+.5)/2.-.5 : vec2(0.);
    vec2 uv=vUv+off*px;
    vec2 d=(uv-.5)*2.*uHalf;
    d=vec2(d.x*uRot.x-d.y*uRot.y, d.x*uRot.y+d.y*uRot.x);
    vec2 p=vec2(uCenter.x+d.x, -(uCenter.y+d.y));   // his view has the imaginary axis upside down
    vec3 s=sampleColor(p, bg);
    if(s.x<0.) s = uEffect>.5 ? texture(uOrig, uv).rgb : vec3(0.);   // inside / outside: the picture as it is, or black
    acc+=s; n+=1.;
  }
  vec3 col=acc/n;
  if(uEffect>.5 && uAmt<.999) col=mix(texture(uOrig, vUv).rgb, col, uAmt);
  o=vec4(col, 1.);
}`;

// A tile of Phosphor's own to start with (drawn here, in the spirit of FractalWrapper's default): a stem on the left
// narrowing down, a glowing bulb on the right; its cap is two bulbs
function defaultTiles() {
  const W = 1024, H = 512;
  const make = (cap) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const bulb = (cx) => {
      const gr = g.createRadialGradient(cx - 40, 150, 10, cx, 230, 210);
      gr.addColorStop(0, '#ffe9ff'); gr.addColorStop(0.35, '#e070ff'); gr.addColorStop(0.75, '#8b1ab8'); gr.addColorStop(1, '#2a0640');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(cx, 270, 150, 225, 0, Math.PI, 0); g.lineTo(cx + 150, H); g.lineTo(cx - 150, H); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(cx - 55, 140, 28, 60, -0.4, 0, Math.PI * 2); g.fill();
    };
    if (cap) { bulb(256); bulb(768); return cv; }
    const gr = g.createLinearGradient(0, 0, 512, 0);
    gr.addColorStop(0, '#2a0640'); gr.addColorStop(0.5, '#b040e0'); gr.addColorStop(1, '#2a0640');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(6, 0); g.lineTo(506, 0); g.lineTo(406, H); g.lineTo(106, H); g.closePath(); g.fill();
    bulb(768);
    return cv;
  };
  return { main: make(false), cap: make(true), name: 'Phosphor bulb' };
}

function create(gl) {
  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Fractal wrap shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VS_TRI)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Fractal wrap program: ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
  const vao = gl.createVertexArray();
  const black = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, black);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  // Tile pictures: uploaded top row first (no flip), so the tile's top is at the band's outer edge as in his shader
  function upload(img) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), pre = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, pre);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  let tile = null;   // { main, cap, asp, name }
  function setTiles(mainImg, capImg, name) {
    if (tile) { gl.deleteTexture(tile.main); if (tile.cap !== tile.main) gl.deleteTexture(tile.cap); }
    const main = upload(mainImg), cap = capImg ? upload(capImg) : main;
    const w = mainImg.width || mainImg.videoWidth, h = mainImg.height || mainImg.videoHeight;
    tile = { main, cap, asp: w / Math.max(1, h), name: name || 'Tile' };
  }
  function tileName() { return tile ? tile.name : ''; }

  function state() { return { out: null, t: Math.random() * 100, ph: Math.random() * 6.283, flow: 0, kick: 0, kickV: 0, swell: 0, seed: Math.random() }; }
  function release(st) { if (st && st.out) { gl.deleteTexture(st.out.t); gl.deleteFramebuffer(st.out.f); st.out = null; } }

  // One frame at outW x outH. src: a picture to make into a tile (null: the tile pictures), srcAsp its width / height.
  // opt: { flipV (the source's top is at v=1, as the app's pictures are), flipX, music: { on, lvl, hit },
  //        effect + orig + amt (over the original picture), selfBands (a loop wrapping itself: bands where it's black) }
  function run(st, src, srcAsp, outW, outH, s, dt, opt = {}) {
    const vaoWas = gl.getParameter(gl.VERTEX_ARRAY_BINDING), blendWas = gl.isEnabled(gl.BLEND);
    dt = Math.min(0.25, Math.max(1 / 240, dt || 1 / 60));
    if (!st.out || st.out.w !== outW || st.out.h !== outH) {
      release(st);
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, outW, outH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      st.out = { t, f, w: outW, h: outH };
    }
    if (!tile) { const d = defaultTiles(); setTiles(d.main, d.cap, d.name); }
    // The music: a hit jolts c along its little path, the bass swells the view
    const M = opt.music || {}, mOn = !!(M.on && s.fwMusic);
    if (mOn && M.hit > 0) st.kickV += (0.8 + Math.min(1.5, M.hit)) * 1.2;
    st.kick += st.kickV * dt; st.kickV *= Math.exp(-dt * 4);
    st.swell += ((mOn ? Math.min(1.5, M.lvl || 0) : 0) - st.swell) * (1 - Math.exp(-dt * 8));
    st.t += dt;
    st.ph += dt * (0.02 + 0.5 * Math.pow(s.fwDrift / 100, 1.5));
    const ph = st.ph + st.kick;
    const sh = SHAPES[s.fwShape] || SHAPES[0];
    let c;
    if (sh.name === 'Wandering') {
      const a = ph * 0.6, w = 0.5 * Math.cos(a) - 0.25 * Math.cos(2 * a), v = 0.5 * Math.sin(a) - 0.25 * Math.sin(2 * a);
      const k = 1.0 + 0.03 * Math.sin(ph * 0.37);
      c = [(w + 0.25) * k - 0.25, v * k];
    } else c = [sh.c[0] + sh.r[0] * Math.cos(ph), sh.c[1] + sh.r[1] * Math.sin(ph * 1.3)];
    // The view: his "zoom 3" (half the width is 3) at Zoom 0; it breathes slowly and swells with the bass
    const z = s.fwZoom / 100, breathe = 1 + 0.04 * Math.sin(st.t * 0.21);
    let half = 3 * Math.pow(0.03, z) * breathe / (1 + 0.2 * st.swell), center = [0, 0];
    if (s.fwKind === 1) { half = 2.2 * Math.pow(0.004, z) * breathe / (1 + 0.2 * st.swell); center = z < 0.05 ? [-0.6, 0] : [-0.7445, -0.1215]; }
    const asp = outW / outH, rot = st.t * (s.fwSpin / 100) * 0.5;
    st.flow += dt * (s.fwFlow / 100) * 0.35 * (1 + st.swell);
    if (Math.abs(st.flow) > 1e4) st.flow %= 1;
    const maxi = DETAIL[s.fwDetail] || 64, mini = Math.max(1, Math.min(12, s.fwMin | 0));
    const g = GLOWS[s.fwGlowCol] || GLOWS[0], e = EDGES[s.fwEdgeCol] || EDGES[0];

    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.out.f);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(p);
    const auto = !!src;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, auto ? src : tile.main); gl.uniform1i(u.uMain, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, auto ? black : tile.cap); gl.uniform1i(u.uCap, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, opt.orig || black); gl.uniform1i(u.uOrig, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(u.uC, c[0], c[1]); gl.uniform2f(u.uCenter, center[0], center[1]);
    gl.uniform2f(u.uRot, Math.cos(rot), Math.sin(rot)); gl.uniform2f(u.uHalf, half, half / asp);
    gl.uniform1f(u.uMini, mini); gl.uniform1f(u.uMaxi, maxi); gl.uniform1f(u.uKind, s.fwKind);
    gl.uniform1f(u.uFlow, st.flow); gl.uniform1f(u.uT, st.t); gl.uniform1f(u.uSeed, st.seed);
    gl.uniform1f(u.uTileAsp, auto ? 2 : tile.asp);
    gl.uniform1f(u.uAuto, auto ? 1 : 0); gl.uniform1f(u.uSrcAsp, Number.isFinite(srcAsp) && srcAsp > 0.05 ? srcAsp : asp);
    gl.uniform1f(u.uSrcFlipV, opt.flipV === false ? 0 : 1); gl.uniform1f(u.uSrcFlipX, opt.flipX ? 1 : 0);
    gl.uniform1f(u.uCut, s.fwCut ? 1 : 0); gl.uniform1f(u.uSelfBands, opt.selfBands ? 1 : 0);
    // Glow: from Min layers to further in by Glow depth (his glowMinIter / glowMaxIter)
    gl.uniform1f(u.uGlow, s.fwGlow ? 1 : 0); gl.uniform3f(u.uGlowCol, g[0], g[1], g[2]);
    gl.uniform1f(u.uGlowMin, mini); gl.uniform1f(u.uGlowMax, mini + 2 + (maxi * 0.8) * (1 - s.fwGlowIn / 100) ** 1.5);
    // Outline: his demThreshold (about 1.3e-4 to 2.9e-4) times the half width, so it stays as thick on screen at any zoom
    gl.uniform1f(u.uEdge, s.fwEdge ? 1 : 0); gl.uniform3f(u.uEdgeCol, e[0], e[1], e[2]);
    gl.uniform1f(u.uEdgeTh, (0.4e-4 + 4.6e-4 * (s.fwEdgeW / 100)) * half * (1080 / Math.max(240, outH)));
    gl.uniform1f(u.uEffect, opt.effect ? 1 : 0); gl.uniform1f(u.uAmt, Math.max(0, Math.min(1, opt.amt ?? 1)));
    gl.uniform1f(u.uAA, s.fwSmooth ? 2 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(vaoWas);
    if (blendWas) gl.enable(gl.BLEND);
    return st.out.t;
  }
  return { state, run, release, setTiles, tileName };
}
return { DEFAULTS, SHAPES, DETAIL, GLOW_NAMES, EDGE_NAMES, RECIPES, defaultTiles, create };
})();
