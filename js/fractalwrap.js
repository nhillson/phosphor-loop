'use strict';
// Fractal wrap: a picture wrapped round the iteration boundaries of a Julia or Mandelbrot set, after the method
// shared on r/GraphicsProgramming ("wrapping images around fractals", also Karim Salama's bamia.net article).
// Each pixel is iterated z = z² + c until |z| > 400. Where it escapes, the angle of the last z picks the spot across
// the picture (once round per tile) and how far past the bailout it got picks the spot down it (log-scaled, so each
// iteration band is one layer of tiles). Layers further in can be shaded away (Depth). The picture can be anything:
// a nature picture, the video, the camera, the other loop, or this loop itself, so the feedback wraps round itself.
//
// Here it moves: the Julia set's c wanders along a path so the shape keeps changing, the view breathes, turns, and
// the tiles can flow down into the fractal layer by layer (Flow), which looks like an endless zoom. Music hits jolt c
// and the bass swells the view.
window.PhosphorFractalWrap = (() => {
const DEFAULTS = { fwKind: 0, fwShape: 0, fwDrift: 25, fwZoom: 20, fwSpin: 10, fwFlow: 30, fwTiles: 2, fwDepth: 40, fwDetail: 1, fwMirror: true, fwMusic: true };
// Julia shapes: paths for c to wander along (centre, radius across, radius up)
const SHAPES = [
  { name: 'Wandering', c: [-0.75, 0.0], r: [0.0, 0.0] },          // round the edge of the Mandelbrot set's main body
  { name: 'Spirals', c: [-0.7269, 0.1889], r: [0.012, 0.012] },
  { name: 'Dendrite', c: [0.0, 1.0], r: [0.02, 0.02] },
  { name: 'Rabbit', c: [-0.123, 0.745], r: [0.015, 0.015] },
  { name: 'Snowflake', c: [-0.4, 0.6], r: [0.02, 0.02] },
];
const DETAIL = [48, 96, 160, 256];
const RECIPES = {
  'Endless': { fwKind: 0, fwShape: 0, fwDrift: 20, fwZoom: 20, fwSpin: 8, fwFlow: 45, fwTiles: 2, fwDepth: 35 },
  'Spirals': { fwKind: 0, fwShape: 1, fwDrift: 15, fwZoom: 20, fwSpin: 12, fwFlow: 25, fwTiles: 3, fwDepth: 50 },
  'Coral':   { fwKind: 0, fwShape: 2, fwDrift: 30, fwZoom: 20, fwSpin: 0, fwFlow: -25, fwTiles: 1, fwDepth: 20 },
  'Rabbit':  { fwKind: 0, fwShape: 3, fwDrift: 25, fwZoom: 20, fwSpin: 15, fwFlow: 35, fwTiles: 2, fwDepth: 45 },
  'Seahorse valley': { fwKind: 1, fwShape: 0, fwDrift: 25, fwZoom: 60, fwSpin: 5, fwFlow: 40, fwTiles: 2, fwDepth: 40 },
};

const VS_TRI = `#version 300 es
out vec2 vUv; void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uC, uCenter, uRot, uFlowUV;
uniform float uAspect, uScale, uTiles, uDepth, uMaxIt, uKind, uMirror, uFlip, uSeed, uT, uItRef;
in vec2 vUv; out vec4 o;
const float PI=3.14159265, LOG_ESCAPE=5.991464547;   // log(400): the bailout is |z| > 400
vec3 hue(float h){ return clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.); }
// The picture repeats round and down; mirrored, so neighbouring tiles always meet edge to edge
vec2 tileUV(vec2 t){ return uMirror>.5 ? 1.-abs(fract(t*.5)*2.-1.) : fract(t); }
void main(){
  vec2 p=(vUv-.5)*vec2(uAspect,1.);
  p=vec2(p.x*uRot.x-p.y*uRot.y, p.x*uRot.y+p.y*uRot.x)*uScale+uCenter;
  vec2 z, c;
  if(uKind<.5){ z=p; c=uC; } else { z=vec2(0.); c=p; }
  // z ends as the last iterate inside the bailout (between about 20 and 400), which the method maps down the picture
  float it=0., zMag=0.; bool out_=false;
  for(int i=0;i<256;i++){
    if(float(i)>=uMaxIt) break;
    vec2 zn=vec2(z.x*z.x-z.y*z.y, 2.*z.x*z.y)+c;
    if(length(zn)>400.){ out_=true; break; }
    z=zn; it+=1.;
  }
  zMag=max(length(z), 1e-6);
  if(!out_){ o=vec4(0.,0.,0.,1.); return; }
  // The method: angle round the last z across the picture, how far past the bailout it got down the picture
  float angle=atan(z.y, z.x)/(2.*PI)+.5;                       // 0 to 1 once round
  float radius=max(0., (LOG_ESCAPE-log(zMag))/(LOG_ESCAPE/2.));  // 0 at the bailout (400), 1 at its square root (20)
  vec2 t=vec2(angle*uTiles, clamp(radius, 0., 1.));
  // Flow: the tiles slide round and down, one layer flowing into the next
  t.x+=uFlowUV.x; t.y=t.y+uFlowUV.y;
  float layer=it+floor(t.y); t.y=fract(t.y);
  // Neighbouring layers of a mirrored picture flip, so they still meet edge to edge
  vec2 q=tileUV(vec2(t.x, t.y+(uMirror>.5 ? mod(layer,2.) : 0.)));
  if(uFlip>.5) q.x=1.-q.x;
  vec3 col=textureLod(uSrc, q, 0.).rgb;
  // A picture that's still black (this loop at its very start) gets faint bands of its own, so it can begin
  float l=dot(col, vec3(.299,.587,.114));
  if(l<.04) col=mix(col, hue(layer*.13+angle*uTiles+uSeed+uT*.02)*.35, .8);
  // Depth: deeper layers shaded away, so the outer ones stand in front
  // (counted from the outermost layer on screen, so zooming in doesn't darken everything)
  float sh=pow(1.-.9*uDepth, max(0., it-uItRef)*.25+radius*.25);
  o=vec4(col*sh, 1.);
}`;

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

  function state() { return { out: null, t: Math.random() * 100, ph: Math.random() * 6.283, flow: [0, 0], kick: 0, kickV: 0, swell: 0, seed: Math.random() }; }
  function release(st) { if (st && st.out) { gl.deleteTexture(st.out.t); gl.deleteFramebuffer(st.out.f); st.out = null; } }

  // One frame at outW x outH from src (or null). opt: { flip, music: { on, lvl, hit } }
  function run(st, src, outW, outH, s, dt, opt = {}) {
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
    // The music: a hit jolts the shape along its path, the bass swells the view
    const M = opt.music || {}, mOn = !!(M.on && s.fwMusic);
    if (mOn && M.hit > 0) st.kickV += (0.8 + Math.min(1.5, M.hit)) * 1.2;
    st.kick += st.kickV * dt; st.kickV *= Math.exp(-dt * 4);
    st.swell += ((mOn ? Math.min(1.5, M.lvl || 0) : 0) - st.swell) * (1 - Math.exp(-dt * 8));
    st.t += dt;
    const drift = 0.02 + 0.5 * Math.pow(s.fwDrift / 100, 1.5);
    st.ph += dt * drift;
    const ph = st.ph + st.kick;
    // Where c is: round the main body's edge (Wandering), or a small loop round a well-known spot
    let c;
    const sh = SHAPES[s.fwShape] || SHAPES[0];
    if ((s.fwShape || 0) === 0) {
      // The cardioid's edge, pulled in a little so the set stays connected and lacy
      const a = ph * 0.6, w = 0.5 * Math.cos(a) - 0.25 * Math.cos(2 * a), v = 0.5 * Math.sin(a) - 0.25 * Math.sin(2 * a);
      // just round the edge, in and out a little: lacy, broken into islands now and then, never a solid blob
      const k = 1.0 + 0.035 * Math.sin(ph * 0.37);
      c = [(w + 0.25) * k - 0.25, v * k];
    } else c = [sh.c[0] + sh.r[0] * Math.cos(ph), sh.c[1] + sh.r[1] * Math.sin(ph * 1.3)];
    // The view: Zoom 0 shows the whole set, 100 is a close look; it breathes slowly and swells with the bass
    const z = s.fwZoom / 100, breathe = 1 + 0.12 * Math.sin(st.t * 0.21);
    let scale = 1.8 * Math.pow(0.12, z) * breathe / (1 + 0.25 * st.swell);
    let center = [0, 0];
    if (s.fwKind === 1) { center = [-0.7445, 0.1215]; scale = 2.4 * Math.pow(0.003, z) * breathe / (1 + 0.25 * st.swell); if (z < 0.05) center = [-0.6, 0]; }
    const rot = st.t * (s.fwSpin / 100) * 0.5;
    const fl = (s.fwFlow / 100);
    st.flow[0] = (st.flow[0] + dt * fl * 0.05) % 2;
    st.flow[1] = st.flow[1] + dt * fl * 0.35 * (1 + st.swell);
    if (Math.abs(st.flow[1]) > 64) st.flow[1] %= 2;

    // The outermost layer on screen: the fewest steps to escape over a coarse grid of the view (cheap, on the CPU)
    const maxIt = DETAIL[s.fwDetail] || 96, aspect = outW / outH, cr = Math.cos(rot), sr = Math.sin(rot);
    let itRef = maxIt;
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 9; gx++) {
      const px = (gx / 8 - 0.5) * aspect, py = gy / 6 - 0.5;
      const x0 = (px * cr - py * sr) * scale + center[0], y0 = (px * sr + py * cr) * scale + center[1];
      let zx = s.fwKind === 1 ? 0 : x0, zy = s.fwKind === 1 ? 0 : y0;
      const cx = s.fwKind === 1 ? x0 : c[0], cy = s.fwKind === 1 ? y0 : c[1];
      let i = 0;
      for (; i < maxIt; i++) { const nx = zx * zx - zy * zy + cx; zy = 2 * zx * zy + cy; zx = nx; if (zx * zx + zy * zy > 160000) break; }
      if (i < itRef) itRef = i;
    }
    st.itRef = st.itRef == null ? itRef : st.itRef + (itRef - st.itRef) * Math.min(1, dt * 3);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.out.f);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src || black); gl.uniform1i(u.uSrc, 0);
    gl.uniform2f(u.uC, c[0], c[1]); gl.uniform2f(u.uCenter, center[0], center[1]);
    gl.uniform2f(u.uRot, Math.cos(rot), Math.sin(rot)); gl.uniform2f(u.uFlowUV, st.flow[0], st.flow[1]);
    gl.uniform1f(u.uAspect, outW / outH); gl.uniform1f(u.uScale, scale);
    gl.uniform1f(u.uTiles, Math.max(1, s.fwTiles)); gl.uniform1f(u.uDepth, s.fwDepth / 100);
    gl.uniform1f(u.uMaxIt, DETAIL[s.fwDetail] || 96); gl.uniform1f(u.uKind, s.fwKind);
    gl.uniform1f(u.uMirror, s.fwMirror ? 1 : 0); gl.uniform1f(u.uFlip, opt.flip ? 1 : 0);
    gl.uniform1f(u.uSeed, st.seed); gl.uniform1f(u.uT, st.t); gl.uniform1f(u.uItRef, st.itRef);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(vaoWas);
    if (blendWas) gl.enable(gl.BLEND);
    return st.out.t;
  }
  return { state, run, release };
}
return { DEFAULTS, SHAPES, DETAIL, RECIPES, create };
})();
