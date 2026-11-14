'use strict';
// Brushes: thousands of little brushes that wander over a canvas of their own, each leaving a stroke behind it.
// Inspired by Math Chaos Patterns' "autonomous brushes". Every brush is steered by an invisible current: made-up
// swirling currents that slowly change, the picture's own brightness (they run along its edges and contours, so the
// picture combs itself), or both. In Picture colors each brush picks its color up from the picture under it as it
// goes, like a brush dragged through wet colors; the other colors are palettes of their own.
//
// All of it runs on the graphics chip every frame:
//   update  one pixel per brush: where it is (xy), its age and how long it lives, its color and heading; ping-ponged
//   dry     the canvas fades a little: to black (the input), or back to the live picture (the whole-picture effect)
//   strokes every brush drawn as a short soft band from where it was to where it is now, with bristle streaks
//   out     the canvas, over the original by Amount (the whole-picture effect)
// js/app.js uses it as an input (one state per loop) and over the finished picture (Brushes in the Effect stack).
//
// The music: hits jolt the currents round and make the brushes surge; louder music runs them faster. With Only music
// (bOnly) the music is all that moves them: in silence they stand still and their strokes stop, so the sound draws.
window.PhosphorBrushes = (() => {
const COUNT = [64, 128, 200, 300, 448];        // brushes across (and down): about 4, 16, 40, 90 and 200 thousand
const COLORS = ['Picture', 'Rainbow', 'Purple', 'Fire', 'Ice', 'White', 'Ember & ice', 'Orchid', 'Moss', 'Lagoon'];
// What the brushes follow when no picture steers them: the shapes Math Chaos Patterns' gallery grows
const SHAPES = ['Currents', 'Cells', 'Burst', 'Spiral', 'Rings', 'Formula'];
const DEFAULTS = { bAmt: 0, bShape: 0, bSense: 0, bSteer: 2, bCount: 1, bSpeed: 35, bSwirl: 40, bChange: 25, bWidth: 8, bLength: 45, bDry: 75,
  bOpacity: 60, bBristle: 50, bColor: 0, bGlow: false, bMusic: true, bOnly: false };
// Recipes leave Steered by alone unless they need it. The first ones grow the gallery's organic forms: hair-fine lines
// in masses, glowing where they bunch up; the later ones are broad bristled strokes.
const HAIR = { bWidth: 1, bBristle: 0, bGlow: true, bCount: 3 };
const RECIPES = {
  'Urchin':        { ...HAIR, bShape: 2, bSense: 25, bSwirl: 25, bSpeed: 40, bChange: 15, bLength: 70, bDry: 92, bOpacity: 35, bColor: 6 },
  'Dandelion':     { ...HAIR, bShape: 2, bSense: -30, bSwirl: 60, bSpeed: 30, bChange: 20, bLength: 55, bDry: 90, bOpacity: 30, bColor: 7 },
  'Cells':         { ...HAIR, bShape: 1, bSense: -55, bSwirl: 45, bSpeed: 30, bChange: 10, bLength: 60, bDry: 93, bOpacity: 30, bColor: 8 },
  'Veins':         { ...HAIR, bShape: 0, bSense: 80, bSwirl: 35, bSpeed: 45, bChange: 15, bLength: 85, bDry: 90, bOpacity: 30, bColor: 9 },
  'Fur':           { ...HAIR, bShape: 0, bSense: 35, bSwirl: 55, bSpeed: 25, bChange: 10, bLength: 35, bDry: 88, bOpacity: 40, bColor: 8 },
  'Spiral shell':  { ...HAIR, bShape: 3, bSense: 20, bSwirl: 40, bSpeed: 40, bChange: 15, bLength: 80, bDry: 92, bOpacity: 30, bColor: 6 },
  'Rings':         { ...HAIR, bShape: 4, bSense: -20, bSwirl: 40, bSpeed: 35, bChange: 20, bLength: 75, bDry: 92, bOpacity: 30, bColor: 7 },
  'Formula':       { ...HAIR, bShape: 5, bSense: 15, bSwirl: 45, bSpeed: 40, bChange: 25, bLength: 90, bDry: 94, bOpacity: 25, bColor: 9 },
  'Flow':          { bShape: 0, bSense: 0, bSteer: 0, bSwirl: 35, bSpeed: 35, bChange: 20, bWidth: 6, bLength: 50, bDry: 75, bOpacity: 60, bBristle: 40, bColor: 0, bGlow: false, bCount: 1 },
  'Starry swirls': { bShape: 0, bSense: 10, bSteer: 2, bSwirl: 70, bSpeed: 45, bChange: 25, bWidth: 10, bLength: 35, bDry: 85, bOpacity: 70, bBristle: 70, bColor: 0, bGlow: false, bCount: 1 },
  'Combed':        { bShape: 0, bSense: 0, bSteer: 1, bSwirl: 30, bSpeed: 50, bChange: 20, bWidth: 4, bLength: 60, bDry: 60, bOpacity: 65, bBristle: 80, bColor: 0, bGlow: false, bCount: 1 },
  'Silk':          { bShape: 0, bSense: 0, bSwirl: 15, bSpeed: 30, bChange: 15, bWidth: 2, bLength: 90, bDry: 95, bOpacity: 30, bBristle: 10, bColor: 1, bGlow: true, bCount: 2 },
};

const VS_TRI = `#version 300 es
out vec2 vUv; void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
const NOISE = `
float h3(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm(vec3 p){ return .6*vnoise(p)+.3*vnoise(p*2.03+7.1)+.1*vnoise(p*4.1+3.3); }
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
`;
// One pixel per brush. pos: xy (0 to 1 across and up), age and life in seconds. col: rgb, and heading in w.
const FS_UPDATE = `#version 300 es
precision highp float;
uniform sampler2D uPos, uCol, uSrc, uAcc;
uniform vec2 uGrid, uFit, uCenter;
uniform float uAspect, uDt, uFT, uSpeed, uSteer, uScale, uLife, uColor, uInit, uHasSrc, uTime, uKick, uFlip, uSeed, uDark, uShape, uSense;
layout(location=0) out vec4 oPos;
layout(location=1) out vec4 oCol;
${NOISE}
vec3 src(vec2 p){ vec2 q=(p-.5)*uFit+.5; if(uFlip>.5) q.x=1.-q.x; return clamp(textureLod(uSrc, q, 0.).rgb, 0., 1.); }
float lum(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
vec3 hue(float h){ return clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.); }
// Feeding on itself, colors would average out into grey mud: lift dim ones, deepen pale ones, and where the
// color has all gone, bring some back from the brush's own hue
vec3 keepColor(vec3 c, float rnd){
  float l=max(lum(c),.02);
  c*=clamp(.4/l, 1., 1.8);
  vec3 g=vec3(lum(c));
  c=clamp(g+(c-g)*1.5, 0., 1.);
  float ch=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));
  return mix(hue(rnd+uFT*.07)*(.4+lum(c)), c, smoothstep(.04,.18,ch));
}
// u: how far through its life the brush is, so two-tone palettes change along each stroke (dark at its root, bright at its tip)
vec3 palette(float m, float r, float h, float u){
  if(m>5.5){
    vec3 a, b, t;
    if(m<6.5){ a=vec3(.05,.2,.6); b=vec3(.25,.6,1.); t=vec3(1.,.62,.15); }        // Ember & ice: blue, orange tips
    else if(m<7.5){ a=vec3(.25,.03,.4); b=vec3(.85,.25,.75); t=vec3(1.,.85,.75); }  // Orchid
    else if(m<8.5){ a=vec3(.03,.18,.08); b=vec3(.2,.7,.35); t=vec3(.8,1.,.7); }     // Moss
    else { a=vec3(.0,.15,.25); b=vec3(.1,.65,.75); t=vec3(.85,1.,1.); }             // Lagoon
    float k=clamp(u*1.1+(r-.5)*.3, 0., 1.);
    return k<.65 ? mix(a, b, k/.65) : mix(b, t, (k-.65)/.35);
  }
  if(m<1.5) return hue(h);
  if(m<2.5) return mix(vec3(.545,.10,.72), vec3(1.,.72,1.), r*r);
  if(m<3.5) return mix(mix(vec3(.6,.05,0.), vec3(1.,.45,0.), smoothstep(0.,.6,r)), vec3(1.,.95,.6), smoothstep(.6,1.,r));
  if(m<4.5) return mix(vec3(.05,.25,.7), vec3(.75,.97,1.), r);
  return vec3(.85+.15*r);
}
// The current here: made-up swirls, the picture's contours, or both
vec2 h2(vec2 q){ return vec2(hash(q), hash(q+19.19)); }
// The shape: the way a brush at a goes, before the picture has its say
float shapeAngle(vec2 a, float rnd){
  float nz=fbm(vec3(a*uScale+uSeed*13.1, uFT));
  int m=int(uShape+.5);
  if(m==0) return nz*12.566+uKick;
  vec2 c=a-uCenter*vec2(uAspect,1.); float r=length(c)+1e-4, th=atan(c.y,c.x);
  float wob=(nz-.5)*2.;                                   // a little wander, so nothing is ruler-straight
  if(m==1){
    // Cells: away from the nearest of a drifting grid of seeds, so the brushes heap up along the walls between them
    float sc=1.5+uScale*1.6; vec2 g=a*sc, gi=floor(g), best=vec2(0.); float bd=9.;
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
      vec2 o=vec2(x,y), q=gi+o; vec2 j=h2(q+uSeed);
      vec2 sp=o+.5+.38*vec2(sin(uFT*.7+j.x*6.28), cos(uFT*.6+j.y*6.28))-fract(g);
      float d=dot(sp,sp); if(d<bd){ bd=d; best=sp; }
    }
    return atan(-best.y,-best.x)+.35+wob*.6+uKick*.3;
  }
  if(m==2) return th+wob*(.3+.12*uScale)+sin(th*7.+uFT)*.15+uKick*.2;          // Burst: out from the middle
  if(m==3) return th+1.5708+.55+wob*.35+uKick*.2;                                   // Spiral: round and in
  if(m==4) return th+1.5708+sin(r*uScale*6.-uFT*2.)*.5+wob*.4+uKick*.2;             // Rings: round the middle, rippling
  // Formula: a flow of sines, like Peter de Jong's attractors, its numbers drifting
  float k1=1.4+.6*sin(uFT*.31+uSeed), k2=-2.3+.5*cos(uFT*.23), k3=2.4+.4*sin(uFT*.17+1.), k4=-2.1+.5*cos(uFT*.29+2.);
  vec2 q=c*(1.2+uScale*.35);
  vec2 v=vec2(sin(k1*q.y)-cos(k2*q.x), sin(k3*q.x)-cos(k4*q.y));
  return atan(v.y, v.x)+wob*.25+uKick*.2;
}
float fieldAngle(vec2 p, float rnd){
  vec2 a=p*vec2(uAspect,1.);
  float n=shapeAngle(a, rnd);
  if(uHasSrc<.5 || uSteer<.01) return n;
  float e=.006;
  float gx=lum(src(p+vec2(e/uAspect,0.)))-lum(src(p-vec2(e/uAspect,0.)));
  float gy=lum(src(p+vec2(0.,e)))-lum(src(p-vec2(0.,e)));
  float g=length(vec2(gx,gy));
  float w=smoothstep(.004,.05,g)*uSteer;
  vec2 cn=vec2(-gy,gx)/(g+1e-5);           // along the contour
  vec2 dn=vec2(cos(n),sin(n));
  if(dot(cn,dn)<0. && uSteer<.99) cn=-cn;  // with Both, go the current's way along the contour
  vec2 d=mix(dn, cn, w);
  if(uSteer>.99 && w<.05) d=dn*.3+vec2(cos(uKick+rnd*6.28),sin(uKick+rnd*6.28))*.7*(1.-w);
  return atan(d.y, d.x+1e-6);
}
vec3 pickColor(vec2 p, float rnd, float h){
  if(uColor<.5 && uHasSrc>.5){
    vec3 c=src(p);
    // Feeding on a dark picture (a loop at the very start) the brushes bring colors of their own, so it can begin
    if(uDark>.5 && lum(c)<.06) return hue(rnd+uFT*.07)*.9;
    // ...and lift dim colors, so feeding on itself doesn't sink into mud
    return uDark>.5 ? keepColor(c, rnd) : c;
  }
  return palette(max(uColor,1.), rnd, h/6.2831853+uFT*.05+rnd*.15, 0.);
}
vec3 paletteAt(float rnd, float h, float u){ return palette(max(uColor,1.), rnd, h/6.2831853+uFT*.05+rnd*.15, u); }
// Following its own strokes: like slime mould, each brush feels ahead, ahead-left and ahead-right on the canvas
// and turns towards the brightest (Gather, so strokes run together into veins) or the darkest (Avoid, so they
// keep apart and fill space into cells and mazes)
float feel(vec2 p, float h, float d){ vec2 q=p+vec2(cos(h)/uAspect, sin(h))*d; return dot(textureLod(uAcc, q, 0.).rgb, vec3(.3,.5,.2)); }
void main(){
  ivec2 ic=ivec2(gl_FragCoord.xy);
  vec2 id=(vec2(ic)+.5)/uGrid;
  float rnd=hash(id*917.13+uSeed);
  vec4 P=texelFetch(uPos, ic, 0), C=texelFetch(uCol, ic, 0);
  vec2 p=P.xy; float age=P.z, life=P.w, h=C.w;
  bool born=uInit>.5 || life<=0. || age>=life || p.x<-.05 || p.x>1.05 || p.y<-.05 || p.y>1.05 || !(p.x==p.x);
  if(born){
    float t=floor(uTime*7.)+rnd*31.;
    p=vec2(hash(id*31.7+t+.13), hash(id*57.3+t*1.7+.71));
    // Burst: most brushes start near the middle and head out, like the spines of an urchin
    if(int(uShape+.5)==2 && rnd<.7){ float an=hash(id*7.7+t)*6.2831853, rr=pow(hash(id*3.3+t*.7),2.)*.22; p=uCenter+vec2(cos(an)/uAspect, sin(an))*rr; }
    life=uLife*(.5+rnd);
    age=uInit>.5 ? hash(id*13.1)*life : 0.;   // at the start, brushes at every stage of their lives
    h=fieldAngle(p, rnd);
    oPos=vec4(p, age, life); oCol=vec4(uColor>5.5 ? paletteAt(rnd, h, 0.) : pickColor(p, rnd, h), h);
    return;
  }
  // Turn towards the current gently, so strokes curve rather than kink
  float ta=fieldAngle(p, rnd);
  float d=mod(ta-h+3.14159265, 6.2831853)-3.14159265;
  h+=d*clamp(uDt*7., 0., 1.);
  if(abs(uSense)>.01){
    float sd=.012+.01*rnd, sa=.55;
    float fl=feel(p,h+sa,sd), fc=feel(p,h,sd), fr=feel(p,h-sa,sd);
    float turn = (fc>=fl && fc>=fr) ? 0. : (fl>fr ? 1. : -1.);
    if(uSense<0.) turn = (fc<=fl && fc<=fr) ? 0. : (fl<fr ? 1. : -1.);
    h+=turn*abs(uSense)*uDt*9.;
  }
  float v=uSpeed*(.55+.9*rnd);
  p+=vec2(cos(h)/uAspect, sin(h))*v*uDt;
  age+=uDt;
  vec3 c=C.rgb;
  if(uColor<.5 && uHasSrc>.5){
    vec3 s=src(p);
    if(!(uDark>.5 && lum(s)<.06)) c=mix(c, uDark>.5 ? keepColor(s, rnd) : s, clamp(uDt*2.5, 0., 1.));
  }
  else if(uColor>5.5) c=paletteAt(rnd, h, age/max(life,.01));
  else c=mix(c, pickColor(p, rnd, h), clamp(uDt*1.5, 0., 1.));
  oPos=vec4(p, age, life); oCol=vec4(c, h);
}`;
// Every brush a band from where it was to where it is, 6 corners each
const VS_STROKE = `#version 300 es
precision highp float;
uniform sampler2D uOld, uNew, uCol;
uniform ivec2 uGridI; uniform vec2 uOut; uniform float uWidth, uOpacity;
out vec2 vQ; out vec3 vC; out float vA; out float vS;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
void main(){
  int i=gl_VertexID/6, k=gl_VertexID-i*6, W=uGridI.x;
  ivec2 c=ivec2(i%W, i/W);
  vec4 A=texelFetch(uOld, c, 0), B=texelFetch(uNew, c, 0), C=texelFetch(uCol, c, 0);
  float rnd=hash((vec2(c)+.5)/vec2(uGridI)*917.13);
  // Just born (younger than before): nothing to join up
  if(B.z<A.z || B.w<=0.){ gl_Position=vec4(2.,2.,2.,1.); vQ=vec2(0.); vC=vec3(0.); vA=0.; vS=0.; return; }
  vec2 a=A.xy*uOut, b=B.xy*uOut, d=b-a; float L=length(d);
  vec2 dir=L>.01 ? d/L : vec2(cos(C.w), sin(C.w));
  vec2 n=vec2(-dir.y, dir.x);
  float w0=uWidth*(.6+.8*rnd)*.5, w=max(w0, .9), ext=w*.3;
  // corners: 0 a-, 1 a+, 2 b-, 3 b-, 4 a+, 5 b+
  bool atB = k==2 || k==3 || k==5; float side = (k==1 || k==4 || k==5) ? 1. : -1.;
  vec2 q=(atB ? b+dir*ext : a-dir*ext)+n*w*side;
  gl_Position=vec4(q/uOut*2.-1., 0., 1.);
  vQ=vec2(atB ? 1. : 0., side);
  float u=clamp(B.z/max(B.w,.001), 0., 1.);
  vA=smoothstep(0., .12, u)*smoothstep(1., .7, u)*uOpacity*min(1., w0/.9);
  vC=C.rgb; vS=rnd;
}`;
const FS_STROKE = `#version 300 es
precision highp float;
uniform float uBristle, uGlow;
in vec2 vQ; in vec3 vC; in float vA; in float vS; out vec4 o;
void main(){
  float s=abs(vQ.y);
  float a=1.-smoothstep(.5, 1., s);
  // Bristles: each brush has its own streaks across its width, so strokes come out combed
  float lane=floor((vQ.y*.5+.5)*7.);
  float b=fract(sin(lane*91.3+vS*317.)*437.58);
  a*=mix(1., .2+.8*b, uBristle)*vA;
  if(a<.002) discard;
  o = uGlow>.5 ? vec4(vC*a*.7, 1.) : vec4(vC, a);
}`;
const FS_DRY = `#version 300 es
precision highp float; uniform sampler2D uTo; uniform float uRate, uHasTo; in vec2 vUv; out vec4 o;
void main(){ o=vec4(uHasTo>.5 ? texture(uTo, vUv).rgb : vec3(0.), uRate); }`;
const FS_OUT = `#version 300 es
precision highp float; uniform sampler2D uAcc, uOrig; uniform float uAmt, uSoft; in vec2 vUv; out vec4 o;
void main(){
  vec3 c=texture(uAcc,vUv).rgb;
  // Glowing strokes pile up past white where thousands cross: softly limited, so the cores glow rather than clip
  c = uSoft>.5 ? 1.-exp(-max(c,0.)*1.25) : clamp(c, 0., 1.);
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
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Brushes shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Brushes program: ' + gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p, u };
  }
  const PU = program(VS_TRI, FS_UPDATE), PS = program(VS_STROKE, FS_STROKE), PD = program(VS_TRI, FS_DRY), PO = program(VS_TRI, FS_OUT);
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
    return { t, f, w, h, fresh: true };
  }
  // A black picture to read when there's nothing to follow
  const black = tex(1, 1, gl.RGBA8, gl.UNSIGNED_BYTE, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, black);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  const dropT = (x) => { if (x) { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); } };
  function dropGrid(st) {
    if (!st.grid) return;
    st.grid.sets.forEach((s) => { gl.deleteTexture(s.pos); gl.deleteTexture(s.col); gl.deleteFramebuffer(s.fbo); });
    st.grid = null;
  }
  function buildGrid(st, count) {
    dropGrid(st);
    const W = COUNT[count] || COUNT[1], H = W;
    const sets = [0, 1].map(() => {
      const pos = tex(W, H, SFMT[0], SFMT[1], gl.NEAREST), col = tex(W, H, SFMT[0], SFMT[1], gl.NEAREST);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pos, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, col, 0);
      return { pos, col, fbo };
    });
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Brushes: brush positions can’t be stored here');
    st.grid = { W, H, N: W * H, sets, cur: 0, count };
    st.needInit = true;
  }

  function state() { return { grid: null, acc: null, out: null, needInit: true, time: 0, ft: Math.random() * 50, kick: 0, kickV: 0, surge: 0, seed: Math.random() * 97 }; }
  function release(st) { if (!st) return; dropGrid(st); dropT(st.acc); dropT(st.out); st.acc = st.out = null; }
  function rebuild(st) { if (st) { st.needInit = true; if (st.acc) st.acc.fresh = true; } }

  // One frame. src: the picture the brushes follow and take colors from (or null: currents and palettes only;
  // aspect: its width / height). Draws at outW x outH and gives back that picture's texture.
  // opt: { effect: dry back to src rather than to black, orig + amt: mix over orig, flip (mirror), dark: brushes bring
  // their own colors where the picture is dark, music: { on, lvl (about 0 to 1.5, louder higher), hit (0, or a hit's
  // strength about 0.4 to 1.5 this frame) } }
  function run(st, src, aspect, outW, outH, s, dt, opt = {}) {
    const vaoWas = gl.getParameter(gl.VERTEX_ARRAY_BINDING), blendWas = gl.isEnabled(gl.BLEND);
    const bs = gl.getParameter(gl.BLEND_SRC_RGB), bd = gl.getParameter(gl.BLEND_DST_RGB), bsa = gl.getParameter(gl.BLEND_SRC_ALPHA), bda = gl.getParameter(gl.BLEND_DST_ALPHA);
    gl.bindVertexArray(vao);
    const raw = Math.min(0.25, Math.max(1 / 240, dt || 1 / 60));
    st.time += raw;
    // The music: a hit spins the currents round and makes the brushes surge, both settling over a second or so
    const M = opt.music || {}, mOn = !!M.on, lvl = mOn ? Math.max(0, Math.min(2, M.lvl || 0)) : 0;
    if (mOn && M.hit > 0) {
      st.kickV += (Math.random() < 0.5 ? -1 : 1) * (1.5 + 2.5 * Math.min(1.5, M.hit));
      st.surge = Math.max(st.surge, 0.8 * Math.min(1.5, M.hit));
    }
    st.kick += st.kickV * raw; st.kickV *= Math.exp(-raw * 3);
    st.surge *= Math.exp(-raw * 3.5);
    // Only music: the sound is the brushes' clock. Silence stops them, their currents and their ageing.
    const only = !!s.bOnly, drive = only ? (mOn ? Math.min(2, lvl * 1.4 + st.surge) : 0) : 1 + (mOn ? lvl * 0.6 + st.surge : 0);
    const mdt = Math.min(1 / 15, raw) * drive;
    st.ft += raw * (0.02 + 0.5 * Math.pow(s.bChange / 100, 1.5)) * (only ? drive : 1 + (mOn ? lvl * 0.5 : 0));
    const strokeA = only ? Math.min(1, Math.max(0, (drive - 0.03) * 4)) : 1;

    if (!st.grid || st.grid.count !== s.bCount) buildGrid(st, s.bCount);
    if (!st.acc || st.acc.w !== outW || st.acc.h !== outH) {
      dropT(st.acc); dropT(st.out);
      st.acc = target(outW, outH, f16 ? gl.RGBA16F : gl.RGBA8, f16 ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE);
      st.out = target(outW, outH, gl.RGBA8, gl.UNSIGNED_BYTE);
    }
    const g = st.grid, oa = outW / outH;
    const sa = Number.isFinite(aspect) && aspect > 0.05 ? aspect : oa;
    // The picture covers the canvas (cropped, never stretched)
    const fit = [Math.min(1, oa / sa), Math.min(1, sa / oa)];
    const srcT = src || black;

    // Move the brushes
    gl.disable(gl.BLEND);
    if (mdt > 0 || st.needInit) {
      const cur = g.sets[g.cur], nxt = g.sets[1 - g.cur];
      gl.bindFramebuffer(gl.FRAMEBUFFER, nxt.fbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, g.W, g.H);
      gl.useProgram(PU.p);
      const u = PU.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cur.pos); gl.uniform1i(u.uPos, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cur.col); gl.uniform1i(u.uCol, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, srcT); gl.uniform1i(u.uSrc, 2);
      gl.uniform2f(u.uGrid, g.W, g.H); gl.uniform2f(u.uFit, fit[0], fit[1]);
      gl.uniform1f(u.uAspect, oa); gl.uniform1f(u.uDt, mdt); gl.uniform1f(u.uFT, st.ft);
      gl.uniform1f(u.uSpeed, 0.02 + 0.6 * Math.pow(s.bSpeed / 100, 1.3));
      gl.uniform1f(u.uSteer, src ? [0, 1, 0.75][s.bSteer] ?? 0.75 : 0);
      gl.uniform1f(u.uScale, 0.4 + 5 * Math.pow(s.bSwirl / 100, 1.4));
      gl.uniform1f(u.uLife, 0.4 + 7.6 * Math.pow(s.bLength / 100, 1.5));
      gl.uniform1f(u.uColor, s.bColor); gl.uniform1f(u.uInit, st.needInit ? 1 : 0); gl.uniform1f(u.uHasSrc, src ? 1 : 0);
      gl.uniform1f(u.uTime, st.time); gl.uniform1f(u.uKick, st.kick); gl.uniform1f(u.uFlip, opt.flip ? 1 : 0);
      gl.uniform1f(u.uSeed, st.seed); gl.uniform1f(u.uDark, opt.dark ? 1 : 0);
      gl.uniform1f(u.uShape, s.bShape || 0); gl.uniform1f(u.uSense, (s.bSense || 0) / 100);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, st.acc.t); gl.uniform1i(u.uAcc, 3);
      // The middle the Burst, Spiral and Rings grow round drifts a little
      gl.uniform2f(u.uCenter, 0.5 + 0.04 * Math.sin(st.ft * 0.7), 0.5 + 0.04 * Math.cos(st.ft * 0.53));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      g.cur = 1 - g.cur;
    }

    // Dry: the canvas fades towards black (the input) or back to the live picture (the effect). Dry 100 never dries.
    const dry = s.bDry / 100, fresh = st.acc.fresh || st.needInit;
    st.needInit = false;
    let rate = dry >= 0.995 ? 0 : 1 - Math.pow(0.5, raw / (0.05 * Math.pow(160, dry)));
    if (st.acc.fresh) rate = 1;
    st.acc.fresh = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.acc.f);
    gl.viewport(0, 0, outW, outH);
    gl.enable(gl.BLEND);
    if (rate > 0) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.useProgram(PD.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, opt.effect && opt.orig ? opt.orig : black); gl.uniform1i(PD.u.uTo, 0);
      gl.uniform1f(PD.u.uRate, rate); gl.uniform1f(PD.u.uHasTo, opt.effect && opt.orig ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // The strokes, from where each brush was to where it is
    if (!fresh && strokeA > 0.001) {
      if (s.bGlow) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.useProgram(PS.p);
      const u = PS.u, oldS = g.sets[1 - g.cur], newS = g.sets[g.cur];
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, oldS.pos); gl.uniform1i(u.uOld, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, newS.pos); gl.uniform1i(u.uNew, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, newS.col); gl.uniform1i(u.uCol, 2);
      gl.uniform2i(u.uGridI, g.W, g.H); gl.uniform2f(u.uOut, outW, outH);
      // Lines thinner than a pixel are drawn a pixel wide and fainter, so the picture looks the same at any size;
      // with many brushes each is fainter, so a swarm glows where they bunch up rather than turning the screen white
      gl.uniform1f(u.uWidth, s.bWidth * outH / 1080 * 1.5);
      gl.uniform1f(u.uOpacity, s.bOpacity / 100 * strokeA * Math.min(1.5, Math.sqrt(40000 / g.N)));
      gl.uniform1f(u.uBristle, s.bBristle / 100); gl.uniform1f(u.uGlow, s.bGlow ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, g.N * 6);
    }
    gl.disable(gl.BLEND);
    // Out: over the original by Amount
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.out.f);
    gl.useProgram(PO.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.acc.t); gl.uniform1i(PO.u.uAcc, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, opt.orig || st.acc.t); gl.uniform1i(PO.u.uOrig, 1);
    gl.uniform1f(PO.u.uAmt, opt.orig ? Math.max(0, Math.min(1, opt.amt ?? 1)) : 1);
    gl.uniform1f(PO.u.uSoft, s.bGlow ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(vaoWas);
    gl.blendFuncSeparate(bs, bd, bsa, bda);
    if (blendWas) gl.enable(gl.BLEND);
    return st.out.t;
  }
  return { state, run, release, rebuild };
}
return { COUNT, COLORS, SHAPES, DEFAULTS, RECIPES, create };
})();
