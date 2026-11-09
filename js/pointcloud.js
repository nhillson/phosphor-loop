'use strict';
// Point cloud: a picture turned into a cloud of glowing dots in 3D. Each dot belongs to one spot of the picture,
// takes its color, and sits forward by how bright that spot is, so bright parts stand out towards you. The dots are
// real little bodies: a spring pulls each one home, and wind, swirling air, gravity, your finger and explosions push
// them about. Dissolve lets go of whole patches (or one side) so they stream away on the wind and keep coming back.
//
// All of it runs on the graphics chip every frame:
//   update  one pixel per dot: where it is (xyz, plus how loose it is in w) and how fast it's going, ping-ponged
//   points  every dot drawn as a soft round glow, added up, into a picture of its own (with optional trails)
//   out     that picture, softly limited so piles of dots glow instead of clipping, mixed over the original
// js/app.js uses it as an input (one state per loop) and over the finished picture (the Point cloud section).
window.PhosphorPointCloud = (() => {
const DENS = [240, 400, 640, 960];              // dots across, for Few / Some / Lots / Masses
const MODES = ['off', 'smear', 'push', 'pull', 'swirl', 'tear'];
const DEFAULTS = { cAmt: 0, cMode: 'smear', cBrush: 25, cWind: 0, cWindDir: 20, cTurb: 15, cGravity: 0, cHold: 75, cLoop: 8,
  cPulse: 0, cVortex: 0, cDissolve: 0, cSide: 1, cDepth: 45, cSize: 16, cDens: 2, cBright: 80, cTrails: 35, cSpark: 60, cSway: 50,
  cColor: 0, cMusic: true };
// Everything that moves by itself repeats every Loop length (cLoop seconds): the swirling air, gusts, sway, rainbow
// and Dissolve's wave, which takes part of the picture away and brings it all back before the loop starts again.
// So every recipe loops cleanly (dragging, explosions and music hits are the only things that don't repeat).
const RECIPES = {
  'Calm':         { cWind: 0, cTurb: 15, cGravity: 0, cHold: 75, cPulse: 0, cVortex: 0, cDissolve: 0, cTrails: 35, cSway: 50, cSpark: 60, cLoop: 8 },
  'Disintegrate': { cWind: 35, cWindDir: 25, cTurb: 55, cGravity: 0, cHold: 80, cPulse: 0, cVortex: 0, cDissolve: 45, cSide: 1, cTrails: 55, cSpark: 85, cColor: 1, cLoop: 8 },
  'Sandstorm':    { cWind: 75, cWindDir: 0, cTurb: 35, cGravity: 15, cHold: 70, cPulse: 0, cVortex: 0, cDissolve: 60, cSide: 0, cTrails: 45, cSpark: 40, cLoop: 8 },
  'Jelly':        { cWind: 0, cTurb: 8, cGravity: 0, cHold: 45, cPulse: 60, cVortex: 0, cDissolve: 0, cTrails: 25, cSpark: 30, cMode: 'smear', cLoop: 4 },
  'Galaxy':       { cWind: 0, cTurb: 30, cGravity: 0, cHold: 40, cPulse: 0, cVortex: 60, cDissolve: 55, cSide: 5, cTrails: 75, cSpark: 70, cColor: 3, cMode: 'swirl', cLoop: 16 },
  'Rain down':    { cWind: 5, cWindDir: 0, cTurb: 20, cGravity: 60, cHold: 80, cPulse: 0, cVortex: 0, cDissolve: 55, cSide: 3, cTrails: 50, cSpark: 70, cLoop: 8 },
  'Ghost':        { cWind: 15, cWindDir: 90, cTurb: 70, cGravity: 0, cHold: 55, cPulse: 0, cVortex: 0, cDissolve: 30, cSide: 0, cTrails: 85, cSpark: 90, cColor: 2, cLoop: 12 },
};

const VS_TRI = `#version 300 es
out vec2 vUv; void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
const NOISE = `
float h3(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm(vec3 p){ return .55*vnoise(p)+.3*vnoise(p*2.03+7.1)+.15*vnoise(p*4.1+3.3); }
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
`;
// One pixel per dot. A dot's home is its spot of the picture, pushed forward by its brightness.
const FS_UPDATE = `#version 300 es
precision highp float;
uniform sampler2D uPos, uVel, uSrc;
uniform vec2 uGrid;
uniform float uAspect, uDepth, uTime, uDt;
uniform float uHold, uWind, uWindDir, uTurb, uGravity, uDissolve, uSide, uPh, uVortex;
uniform vec3 uMouse; uniform vec2 uMouseVel; uniform float uBrush, uMode, uInit;
uniform vec4 uBurst; uniform float uFlip;
layout(location=0) out vec4 oPos;
layout(location=1) out vec4 oVel;
${NOISE}
// Swirling air that comes round to where it started every loop: the noise is read along a circle as the loop goes by
vec3 curl(vec3 p, vec2 cyc){
  float s=1.3, e=.04; vec3 q=vec3(p.x*s+cyc.x*.8, p.y*s, cyc.y*.8);
  float n1=vnoise(q+vec3(0,e,0)), n2=vnoise(q-vec3(0,e,0)), n3=vnoise(q+vec3(e,0,0)), n4=vnoise(q-vec3(e,0,0));
  vec2 c=vec2(n1-n2, -(n3-n4))/(2.*e);
  float z=vnoise(vec3(p.xy*s*.8+31.7+cyc*.6, p.z))-.5;
  return vec3(c*.35, z*1.2);
}
void main(){
  ivec2 ic=ivec2(gl_FragCoord.xy);
  vec2 uv=(vec2(ic)+.5)/uGrid;
  vec3 c=textureLod(uSrc, vec2(uFlip>.5 ? 1.-uv.x : uv.x, uv.y), 0.).rgb;
  float lum=clamp(dot(c, vec3(.299,.587,.114)), 0., 1.5);
  vec3 home=vec3((uv.x*2.-1.)*uAspect, uv.y*2.-1., (lum-.3)*uDepth);
  if(uInit>.5){ oPos=vec4(home,0.); oVel=vec4(0.,0.,0.,1.); return; }
  vec4 P=texelFetch(uPos, ic, 0); vec4 V=texelFetch(uVel, ic, 0);
  vec3 p=P.xyz, v=V.xyz; float fr=P.w, al=V.w;   // al: how far a dot that was put back home has faded in again
  float rnd=hash(uv*917.13), mass=.6+.8*rnd;
  vec2 cyc=vec2(cos(6.2831853*uPh), sin(6.2831853*uPh));
  // Dissolve: a wave each loop. Part of the picture (uDissolve of it, from the side picked, with a ragged edge) lets
  // go in turn during the first 40% of the loop and streams away; from halfway to 80% it comes back in the same
  // order, so by the end of the loop the picture is whole again.
  bool loose=false;
  if(uDissolve>.001){
    float n=fbm(vec3(uv*vec2(uAspect,1.)*2.6, 1.7)), r;
    if(uSide<.5) r=clamp((n-.28)*2.2, 0., 1.);
    else if(uSide<4.5){ float g = uSide<1.5 ? 1.-uv.x : uSide<2.5 ? uv.x : uSide<3.5 ? 1.-uv.y : uv.y; r=clamp(g*.82+(n-.5)*.36+.05, 0., 1.); }
    else r=clamp(length((uv-.5)*vec2(uAspect,1.))/(.5*length(vec2(uAspect,1.)))*.82+(n-.5)*.36+.05, 0., 1.);
    if(r<uDissolve){ float q=r/uDissolve; loose = uPh>=q*.4 && uPh<.5+q*.3; }
  }
  if(loose) fr=min(1., fr+uDt*(3.+5.*rnd)); else fr=max(0., fr-uDt*2.5);
  float att=1.-fr, k=uHold*uHold*90.;
  if(!loose && fr>0.) k=max(k, 30.);   // coming back: firmly enough to be home before the loop ends
  vec3 a=(home-p)*k*att - v*(2.*sqrt(k)*.7+.5)*att;
  float wr=.12+.88*fr, gust=.65+.35*sin(6.2831853*uPh+p.x*.7+rnd*2.);
  a+=vec3(cos(uWindDir), sin(uWindDir), 0.)*uWind*7.*gust*wr/mass;
  a+=curl(p, cyc)*uTurb*9.*wr/mass;
  a.y-=uGravity*6.*fr;
  // Whirl: loose dots orbit the middle
  if(uVortex>0.){ float L=length(p.xy)+.35; a.xy+=vec2(-p.y,p.x)/L*uVortex*5.*wr; a.xy-=p.xy*uVortex*.6*fr; }
  v*=exp(-uDt*.6*fr);
  if(uMouse.z>.5){
    vec2 d=p.xy-uMouse.xy; float dd=dot(d,d), fall=exp(-dd/(uBrush*uBrush)), L=sqrt(dd)+1e-4;
    int mode=int(uMode+.5);
    if(mode==1){ v.xy=mix(v.xy, uMouseVel, clamp(fall*.35,0.,1.)); v.z+=fall*length(uMouseVel)*.02; }
    else if(mode==2){ a.xy+=d/L*fall*45.; a.z+=fall*18.; }
    else if(mode==3){ a.xy-=d/(L+.03)*fall*30.; a.z-=fall*6.; }
    else if(mode==4){ a.xy+=vec2(-d.y,d.x)/(L+.04)*fall*28.; a.xy-=d*fall*4.; }
    else if(mode==5){ if(fall>.3) fr=1.; a.xy+=d/L*fall*5.; a.z+=fall*3.; }
  }
  if(uBurst.w>0.){
    vec3 d=p-uBurst.xyz; float L=length(d)+.05, f=exp(-L*L*.35);
    vec3 j=vec3(hash(uv+1.3),hash(uv+2.7),hash(uv+3.1))-.5;
    v+=(d/L+j*.9)*uBurst.w*f*(.5+rnd);
    if(f>.12 && uBurst.w>=2.5) fr=1.;   // only a real blast tears dots loose; a music shove springs back
  }
  v+=a*uDt; p+=v*uDt;
  al=min(1., al+uDt*2.5);
  bool bad = !(p.x==p.x && p.y==p.y && p.z==p.z && v.x==v.x);
  // A dot that has drifted out of sight (it has faded out by then) is put back home and fades in there: while its
  // part of the picture is loose it streams off again, otherwise it's back. Far-off dots coming back do the same
  // instead of flying all the way across the picture.
  float away=length(p-home);
  if(bad || (fr>.01 && (away>2.3 || abs(p.z)>4.)) || (!loose && fr>.05 && away>1.2)){ p=home; v=vec3(0.); al=0.; if(!loose) fr=0.; }
  oPos=vec4(p,fr); oVel=vec4(v,al);
}`;
const VS_POINTS = `#version 300 es
precision highp float;
uniform sampler2D uPos, uVel, uSrc;
uniform ivec2 uGridI; uniform float uAspect, uDepth;
uniform mat4 uVP; uniform float uSize, uPx, uCut, uColor, uSpark, uBright, uPh, uFlip;
out vec3 vCol;
vec3 hue(float h){ return clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.); }
void main(){
  int W=uGridI.x; ivec2 c=ivec2(gl_VertexID % W, gl_VertexID / W);
  vec4 P=texelFetch(uPos, c, 0);
  vec2 uv=(vec2(c)+.5)/vec2(uGridI);
  vec3 s=clamp(textureLod(uSrc, vec2(uFlip>.5 ? 1.-uv.x : uv.x, uv.y), 0.).rgb, 0., 1.5);
  float lum=dot(s, vec3(.299,.587,.114));
  vec3 home=vec3((uv.x*2.-1.)*uAspect, uv.y*2.-1., (lum-.3)*uDepth);
  float fr=P.w;
  float vis=smoothstep(uCut, uCut+.06, lum);
  vis*=mix(1., smoothstep(2.2, .4, length(P.xyz-home)), fr)*texelFetch(uVel, c, 0).w;
  gl_Position=uVP*vec4(P.xyz,1.);
  if(vis<.003){ gl_Position=vec4(2.,2.,2.,1.); gl_PointSize=0.; vCol=vec3(0.); return; }
  vec3 col; int m=int(uColor+.5);
  if(m==0) col=s;
  else if(m==1) col=vec3(lum)*vec3(.92,.97,.88);
  else if(m==2) col=mix(vec3(.545,.10,.72), vec3(1.,.86,1.), lum)*(.35+lum);
  else col=hue(P.z*.45+uv.y*.35+uPh)*(.3+lum);
  col=mix(col, vec3(.75+lum*.5), fr*uSpark*.7)*(1.+fr*uSpark*1.4);
  vCol=col*vis*uBright;
  gl_PointSize=clamp(uSize*uPx/gl_Position.w*(.7+.6*lum), 1., 48.);
}`;
const FS_POINTS = `#version 300 es
precision highp float;
in vec3 vCol; out vec4 o;
void main(){ vec2 q=gl_PointCoord*2.-1.; float d=dot(q,q); if(d>1.) discard; o=vec4(vCol*exp(-d*3.2),1.); }`;
const FS_FADE = `#version 300 es
precision highp float; uniform float uKeep; out vec4 o; void main(){ o=vec4(0.,0.,0.,uKeep); }`;
const FS_OUT = `#version 300 es
precision highp float; uniform sampler2D uAcc, uOrig; uniform float uAmt; in vec2 vUv; out vec4 o;
void main(){
  vec3 c=1.-exp(-texture(uAcc,vUv).rgb*1.5);
  if(uAmt<.999) c=mix(texture(uOrig,vUv).rgb, c, uAmt);
  o=vec4(c,1.);
}`;

function create(gl) {
  const f32 = gl.getExtension('EXT_color_buffer_float');
  const f16 = f32 || gl.getExtension('EXT_color_buffer_half_float');
  if (!f16) throw new Error('no float render targets');
  const SFMT = f32 ? [gl.RGBA32F, gl.FLOAT] : [gl.RGBA16F, gl.HALF_FLOAT];

  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Point cloud shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Point cloud program: ' + gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p, u };
  }
  const PU = program(VS_TRI, FS_UPDATE), PP = program(VS_POINTS, FS_POINTS), PF = program(VS_TRI, FS_FADE), PO = program(VS_TRI, FS_OUT);
  const vao = gl.createVertexArray();

  function tex(w, h, ifmt, type, filter) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(w, h, ifmt, type) {
    const t = tex(w, h, ifmt, type, gl.LINEAR), f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { t, f, w, h };
  }
  const dropT = (x) => { if (x) { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); } };
  function dropGrid(st) {
    if (!st.grid) return;
    st.grid.sets.forEach((s) => { gl.deleteTexture(s.pos); gl.deleteTexture(s.vel); gl.deleteFramebuffer(s.fbo); });
    st.grid = null;
  }
  function buildGrid(st, dens, aspect) {
    dropGrid(st);
    const W = DENS[dens] || DENS[2], H = Math.max(2, Math.round(W / aspect));
    const sets = [0, 1].map(() => {
      const pos = tex(W, H, SFMT[0], SFMT[1], gl.NEAREST), vel = tex(W, H, SFMT[0], SFMT[1], gl.NEAREST);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pos, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, vel, 0);
      return { pos, vel, fbo };
    });
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Point cloud: dot positions can’t be stored here');
    st.grid = { W, H, N: W * H, sets, cur: 0, aspect, dens };
    st.needInit = true;
  }

  const FOV = 45 * Math.PI / 180, TF = Math.tan(FOV / 2);
  // The camera: looking at the picture's plane, swaying gently. fit < 1 shows the picture smaller.
  function camera(st, s, outW, outH, fit) {
    const sa = outW / outH, a = st.grid.aspect, sway = s.cSway / 100;
    const D = Math.max(1, a / sa) / TF * 1.1 / fit;
    // The sway goes round once in a whole number of loops (about 12 s or more), so it loops too
    const loop = Math.max(1, s.cLoop || 8), n = Math.max(1, Math.round(12 / loop)), ph = 2 * Math.PI * ((st.time / (loop * n)) % 1);
    const yaw = st.yaw + sway * .38 * Math.sin(ph), pitch = st.pitch + sway * .22 * Math.sin(ph + 1.3);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
    const R = [[cy, 0, sy], [sx * sy, cx, -sx * cy], [-cx * sy, sx, cx * cy]];
    const f = 1 / TF, near = .05, far = 50;
    const Pm = [f / sa, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
    const V = [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, 0, 0, -D, 1];
    const VP = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let q = 0; for (let k = 0; k < 4; k++) q += Pm[k * 4 + r] * V[c * 4 + k]; VP[c * 4 + r] = q; }
    const RT = (v) => [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2], R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]];
    return { VP, D, sa, f, RT, pos: RT([0, 0, D]) };
  }
  // A spot on the output (0 to 1 across and up) to the picture's plane
  function toPlane(cam, u, v) {
    const dir = cam.RT([(u * 2 - 1) * TF * cam.sa, (v * 2 - 1) * TF, -1]);
    if (Math.abs(dir[2]) < 1e-4) return null;
    const k = -cam.pos[2] / dir[2];
    return [cam.pos[0] + dir[0] * k, cam.pos[1] + dir[1] * k];
  }

  function state() { return { grid: null, acc: null, out: null, needInit: true, time: 0, yaw: 0, pitch: 0, prevW: null, vel: [0, 0], bursts: [] }; }
  function release(st) { if (!st) return; dropGrid(st); dropT(st.acc); dropT(st.out); st.acc = st.out = null; }
  // A blast: at (u, v) on the output, or the middle when u is null; strength about 1 (a nudge) to 6 (everything flies)
  function burst(st, u, v, strength) { if (st) st.bursts.push([u, v, strength]); }
  function rebuild(st) { if (st) st.needInit = true; }

  // One frame. src: the picture to make dots of (aspect: its width / height). Draws at outW x outH and gives back
  // that picture's texture. opt: { ptr: {down, u, v} or null, trails (0 to .95), orig: texture to mix over, amt (0 to 1), fit, flip (mirror) }
  function run(st, src, aspect, outW, outH, s, dt, opt = {}) {
    const vaoWas = gl.getParameter(gl.VERTEX_ARRAY_BINDING), blendWas = gl.isEnabled(gl.BLEND);
    const bs = gl.getParameter(gl.BLEND_SRC_RGB), bd = gl.getParameter(gl.BLEND_DST_RGB), bsa = gl.getParameter(gl.BLEND_SRC_ALPHA), bda = gl.getParameter(gl.BLEND_DST_ALPHA);
    gl.bindVertexArray(vao);
    // The loop follows the clock (so 8 s is 8 s even when frames come slowly). The dots keep up with it: when a frame
    // took long they move in several small steps (1/30 s or less each, at most 6 a frame), so they're home in time.
    const raw = Math.min(0.25, Math.max(1 / 240, dt || 1 / 60));
    st.time += raw;
    const steps = Math.min(6, Math.ceil(raw * 30 - 1e-6));
    dt = Math.min(1 / 20, raw / steps);
    const loopS = Math.max(1, s.cLoop || 8), cycle = Math.floor(st.time / loopS), uPh = (st.time / loopS) % 1;
    // Pulse: a springy shove from the middle as each loop starts (under 2.5, so it never tears dots loose)
    if (st.cycle !== undefined && cycle !== st.cycle && s.cPulse > 0) st.bursts.push([null, null, 2.2 * s.cPulse / 100]);
    st.cycle = cycle;
    aspect = Number.isFinite(aspect) && aspect > 0.05 ? aspect : outW / outH;
    if (!st.grid || st.grid.dens !== s.cDens || Math.abs(st.grid.aspect - aspect) / aspect > .01) buildGrid(st, s.cDens, aspect);
    if (!st.acc || st.acc.w !== outW || st.acc.h !== outH) {
      dropT(st.acc); dropT(st.out);
      st.acc = target(outW, outH, f16 ? gl.RGBA16F : gl.RGBA8, f16 ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE);
      st.out = target(outW, outH, gl.RGBA8, gl.UNSIGNED_BYTE);
    }
    const g = st.grid, cam = camera(st, s, outW, outH, opt.fit || 1);

    // Your finger, on the picture's plane, and how fast it moves there
    let mouse = [0, 0, 0];
    const ptr = opt.ptr, mode = MODES.indexOf(s.cMode);
    if (ptr && ptr.down && mode > 0) {
      const w = toPlane(cam, ptr.u, ptr.v);
      if (w) {
        if (st.prevW) {
          const vx = (w[0] - st.prevW[0]) / dt, vy = (w[1] - st.prevW[1]) / dt;
          st.vel[0] = st.vel[0] * .5 + vx * .5; st.vel[1] = st.vel[1] * .5 + vy * .5;
          const m = Math.hypot(st.vel[0], st.vel[1]); if (m > 10) { st.vel[0] *= 10 / m; st.vel[1] *= 10 / m; }
        }
        st.prevW = w; mouse = [w[0], w[1], 1];
      }
    } else { st.prevW = null; st.vel = [0, 0]; }
    let bu = [0, 0, 0, 0];
    const b = st.bursts.shift();
    if (b) { const w = b[0] == null ? [0, 0] : toPlane(cam, b[0], b[1]) || [0, 0]; bu = [w[0], w[1], 0, b[2]]; }
    if (st.bursts.length > 4) st.bursts.length = 4;

    // Move the dots
    gl.disable(gl.BLEND);
    let u;
    for (let step = 0; step < steps; step++) {
    if (step > 0) { mouse = [0, 0, 0]; bu = [0, 0, 0, 0]; }
    const cur = g.sets[g.cur], nxt = g.sets[1 - g.cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, nxt.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, g.W, g.H);
    gl.useProgram(PU.p);
    u = PU.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cur.pos); gl.uniform1i(u.uPos, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cur.vel); gl.uniform1i(u.uVel, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(u.uSrc, 2);
    gl.uniform2f(u.uGrid, g.W, g.H);
    gl.uniform1f(u.uAspect, g.aspect); gl.uniform1f(u.uDepth, s.cDepth / 100 * 1.3);
    gl.uniform1f(u.uTime, st.time); gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uHold, s.cHold / 100); gl.uniform1f(u.uWind, s.cWind / 100); gl.uniform1f(u.uWindDir, s.cWindDir * Math.PI / 180);
    gl.uniform1f(u.uTurb, s.cTurb / 100); gl.uniform1f(u.uGravity, s.cGravity / 100); gl.uniform1f(u.uDissolve, s.cDissolve / 100);
    gl.uniform1f(u.uSide, s.cSide); gl.uniform1f(u.uPh, uPh); gl.uniform1f(u.uVortex, (s.cVortex || 0) / 100);
    gl.uniform3f(u.uMouse, mouse[0], mouse[1], mouse[2]); gl.uniform2f(u.uMouseVel, st.vel[0], st.vel[1]);
    gl.uniform1f(u.uBrush, Math.max(.03, s.cBrush / 100)); gl.uniform1f(u.uMode, Math.max(0, mode));
    gl.uniform1f(u.uInit, st.needInit ? 1 : 0);
    gl.uniform4f(u.uBurst, bu[0], bu[1], bu[2], bu[3]); gl.uniform1f(u.uFlip, opt.flip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    g.cur = 1 - g.cur; st.needInit = false;
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    }

    // Trails: what was drawn before fades
    const trails = Math.max(0, Math.min(.95, opt.trails ?? s.cTrails / 100));
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.acc.f);
    gl.viewport(0, 0, outW, outH);
    gl.enable(gl.BLEND);
    gl.useProgram(PF.p); gl.uniform1f(PF.u.uKeep, trails);
    gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // The dots, added up
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(PP.p);
    u = PP.u;
    const ps = g.sets[g.cur];
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ps.pos); gl.uniform1i(u.uPos, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ps.vel); gl.uniform1i(u.uVel, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(u.uSrc, 2);
    gl.uniform2i(u.uGridI, g.W, g.H);
    gl.uniform1f(u.uAspect, g.aspect); gl.uniform1f(u.uDepth, s.cDepth / 100 * 1.3);
    gl.uniformMatrix4fv(u.uVP, false, cam.VP);
    gl.uniform1f(u.uSize, s.cSize / 10); gl.uniform1f(u.uPx, cam.f * outH / g.H);
    gl.uniform1f(u.uCut, .08); gl.uniform1f(u.uColor, s.cColor); gl.uniform1f(u.uSpark, s.cSpark / 100);
    gl.uniform1f(u.uBright, s.cBright / 100 * .45 * (1 - trails * .55)); gl.uniform1f(u.uPh, uPh); gl.uniform1f(u.uFlip, opt.flip ? 1 : 0);
    gl.drawArrays(gl.POINTS, 0, g.N);
    gl.disable(gl.BLEND);
    // Out: softly limited, over the original by Amount
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.out.f);
    gl.useProgram(PO.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.acc.t); gl.uniform1i(PO.u.uAcc, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, opt.orig || st.acc.t); gl.uniform1i(PO.u.uOrig, 1);
    gl.uniform1f(PO.u.uAmt, opt.orig ? Math.max(0, Math.min(1, opt.amt ?? 1)) : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(vaoWas);
    gl.blendFuncSeparate(bs, bd, bsa, bda);
    if (blendWas) gl.enable(gl.BLEND);
    return st.out.t;
  }
  return { state, run, release, burst, rebuild };
}
return { DENS, MODES, DEFAULTS, RECIPES, create };
})();
