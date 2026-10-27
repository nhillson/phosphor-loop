// Shaders from outside: Shadertoy code (a mainImage function) and ISF shaders (a JSON header in a comment, then
// GLSL). parse() reads one and says what it is; ShaderHost runs it in the app's WebGL2 context, drawing into a
// picture of its own each frame, with its passes, its settings, the music and (for a filter) a picture to work on.
(() => {
  const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
  // A setting's code name as words: gridSize → Grid size, u_bias → Bias
  const nice = (n) => { const w = n.replace(/^u_?(?=[A-Z_])/, '').replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase(); return w ? w[0].toUpperCase() + w.slice(1) : n; };

  // What kind of shader some code is, its settings and passes. Never throws; a problem comes back as error.
  function parse(code, nameHint = 'Shader') {
    const src = String(code || '').replace(/\r\n?/g, '\n');
    const head = src.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//);
    if (head && /"(ISFVSN|INPUTS|PASSES|CATEGORIES|DESCRIPTION)"/.test(head[1])) {
      let meta;
      try { meta = JSON.parse(head[1]); } catch (e) { return { error: 'The ISF header (the JSON at the top) isn’t valid: ' + e.message }; }
      const body = src.slice(head.index + head[0].length);
      const inputs = [];
      for (const i of Array.isArray(meta.INPUTS) ? meta.INPUTS : []) {
        if (!i || typeof i.NAME !== 'string' || !SAFE_ID.test(i.NAME)) continue;
        const t = String(i.TYPE || '');
        const base = { name: i.NAME, type: t, label: String(i.LABEL || nice(i.NAME)) };
        if (t === 'float') inputs.push({ ...base, min: num(i.MIN, 0), max: num(i.MAX, 1), def: num(i.DEFAULT, num(i.MIN, 0)) });
        else if (t === 'long') {
          const values = Array.isArray(i.VALUES) ? i.VALUES.map((v) => Math.round(num(v, 0))) : null;
          inputs.push({ ...base, min: values ? Math.min(...values) : num(i.MIN, 0), max: values ? Math.max(...values) : num(i.MAX, 10), def: Math.round(num(i.DEFAULT, values ? values[0] : 0)),
            values, labels: Array.isArray(i.LABELS) ? i.LABELS.map(String) : null });
        } else if (t === 'bool' || t === 'event') inputs.push({ ...base, type: 'bool', def: i.DEFAULT ? 1 : 0 });
        else if (t === 'color') inputs.push({ ...base, def: Array.isArray(i.DEFAULT) ? i.DEFAULT.slice(0, 4).map((v) => num(v, 1)) : [1, 1, 1, 1] });
        else if (t === 'point2D') {
          const mn = Array.isArray(i.MIN) ? i.MIN : [0, 0], mx = Array.isArray(i.MAX) ? i.MAX : [1, 1];
          inputs.push({ ...base, min: mn.map((v) => num(v, 0)), max: mx.map((v) => num(v, 1)), def: Array.isArray(i.DEFAULT) ? i.DEFAULT.map((v) => num(v, 0.5)) : [0.5, 0.5], norm: !Array.isArray(i.MAX) });
        } else if (t === 'image' || t === 'audio' || t === 'audioFFT') inputs.push(base);
      }
      const passes = (Array.isArray(meta.PASSES) && meta.PASSES.length ? meta.PASSES : [{}]).slice(0, 8).map((p) => ({
        target: (() => { const t = p.TARGET ?? p.target; return typeof t === 'string' && SAFE_ID.test(t) ? t : ''; })(),
        persistent: !!(p.PERSISTENT || p.persistent), float: !!(p.FLOAT || p.float),
        width: p.WIDTH != null ? String(p.WIDTH) : '', height: p.HEIGHT != null ? String(p.HEIGHT) : '',
      }));
      const filter = inputs.some((i) => i.type === 'image' && i.name === 'inputImage');
      const imports = meta.IMPORTED && Object.keys(meta.IMPORTED).length;
      return { kind: 'isf', name: nameHint, description: String(meta.DESCRIPTION || ''), credit: String(meta.CREDIT || ''),
        categories: Array.isArray(meta.CATEGORIES) ? meta.CATEGORIES.map(String) : [], inputs, passes, filter,
        audio: inputs.some((i) => i.type === 'audio' || i.type === 'audioFFT'), body, imports: !!imports };
    }
    if (/\bvoid\s+mainImage\s*\(/.test(src)) {
      return { kind: 'shadertoy', name: nameHint, description: '', credit: '', categories: [], filter: /iChannel1/.test(src),
        audio: /iChannel0/.test(src), inputs: [], passes: [{ target: '' }], body: src };
    }
    return { error: 'This doesn’t look like a Shadertoy shader (no mainImage) or an ISF shader (no JSON header at the top).' };
  }

  const ST_HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec3 iResolution;
uniform float iTime, iTimeDelta, iFrameRate, iSampleRate;
uniform int iFrame;
uniform vec4 iMouse, iDate;
uniform sampler2D iChannel0, iChannel1, iChannel2, iChannel3;
uniform vec3 iChannelResolution[4];
uniform float iChannelTime[4];
out vec4 st_FragColor;
`;
  const ST_FOOT = `
void main() {
  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(c, gl_FragCoord.xy);
  st_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
}`;
  // ISF was written for older GLSL; these make it read as WebGL2's
  function isfSource(d, passIndexDecl) {
    let u = '';
    for (const i of d.inputs) {
      if (i.type === 'float') u += `uniform float ${i.name};\n`;
      else if (i.type === 'long') u += `uniform int ${i.name};\n`;
      else if (i.type === 'bool') u += `uniform bool ${i.name};\n`;
      else if (i.type === 'color') u += `uniform vec4 ${i.name};\n`;
      else if (i.type === 'point2D') u += `uniform vec2 ${i.name};\n`;
      else u += `uniform sampler2D ${i.name};\n`;
    }
    for (const p of d.passes) if (p.target && !d.inputs.some((i) => i.name === p.target)) u += `uniform sampler2D ${p.target};\n`;
    // ISF's names for a picture's size and rectangle
    for (const n of [...d.inputs.filter((i) => i.type === 'image' || i.type === 'audio' || i.type === 'audioFFT').map((i) => i.name), ...d.passes.map((p) => p.target).filter(Boolean)]) {
      u += `#define _${n}_imgSize vec2(textureSize(${n}, 0))\n#define _${n}_imgRect vec4(0.0, 0.0, _${n}_imgSize)\n#define _${n}_flip false\n`;
    }
    let body = d.body;
    // Older GLSL let a shader define its own sign() or round(); here those names are taken, so its own get new ones
    for (const m of body.matchAll(/\b(?:float|vec[234]|int|bool)\s+(sign|round|trunc|inverse|transpose|determinant|outerProduct|isnan|isinf)\s*\(/g)) {
      body = body.replace(new RegExp(`\\b${m[1]}\\b`, 'g'), 'isf_' + m[1]);
    }
    body = body
      .replace(/\bgl_FragColor\b/g, 'isf_FragColor')
      .replace(/\btexture2DRect\b/g, 'texture')
      .replace(/\btexture2D\b/g, 'texture')
      .replace(/^\s*varying\s+/gm, 'in ');
    return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 isf_FragColor;
uniform vec2 RENDERSIZE;
uniform float TIME, TIMEDELTA;
uniform int FRAMEINDEX;
uniform vec4 DATE;
${passIndexDecl}
#define isf_FragNormCoord (gl_FragCoord.xy / RENDERSIZE)
#define vv_FragNormCoord isf_FragNormCoord
#define IMG_PIXEL(i, c) texture(i, (c) / vec2(textureSize(i, 0)))
#define IMG_NORM_PIXEL(i, c) texture(i, c)
#define IMG_THIS_PIXEL(i) texture(i, isf_FragNormCoord)
#define IMG_THIS_NORM_PIXEL(i) texture(i, isf_FragNormCoord)
#define IMG_SIZE(i) vec2(textureSize(i, 0))
${u}
${body}
`;
  }

  // A small expression from an ISF pass size ("$WIDTH/2.0", "floor($HEIGHT*0.25)"), worked out safely
  function sizeExpr(expr, vars, fallback) {
    if (!expr) return fallback;
    let s = String(expr).replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => (n in vars ? `(${+vars[n] || 0})` : '0'));
    if (!/^[0-9+\-*/().,\s a-z]*$/.test(s)) return fallback;
    s = s.replace(/\b(floor|ceil|max|min|pow|sqrt|abs|round)\b/g, 'Math.$1');
    if (/[a-z]/i.test(s.replace(/Math\.(floor|ceil|max|min|pow|sqrt|abs|round)/g, ''))) return fallback;
    try { const v = Function(`return (${s});`)(); return Number.isFinite(v) ? Math.max(1, Math.min(4096, Math.round(v))) : fallback; }
    catch (_) { return fallback; }
  }

  class ShaderHost {
    // gl: the app's WebGL2 context; d: what parse() gave; float: whether float pictures can be drawn into
    constructor(gl, d, float) {
      this.gl = gl; this.d = d; this.float = float; this.frame = 0; this.error = null;
      this.targets = {}; this.out = null; this.progs = [];
      // A blank picture for any sampler with nothing to show yet, so none is left pointing at the picture being drawn
      this.blank = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.blank);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      const compile = (type, text) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, text); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          const log = gl.getShaderInfoLog(s) || 'unknown error'; gl.deleteShader(s);
          throw new Error(log.split('\n').filter(Boolean).slice(0, 3).join(' · '));
        }
        return s;
      };
      try {
        const vs = compile(gl.VERTEX_SHADER, VS);
        const texts = d.kind === 'shadertoy' ? [ST_HEAD + d.body + ST_FOOT]
          : [isfSource(d, 'uniform int PASSINDEX;')];
        for (const text of texts) {
          const p = gl.createProgram();
          gl.attachShader(p, vs); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, text));
          gl.linkProgram(p);
          if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
          const u = {}, samplers = [];
          const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
          for (let i = 0; i < n; i++) {
            const info = gl.getActiveUniform(p, i), name = info.name.replace(/\[0\]$/, '');
            u[name] = gl.getUniformLocation(p, info.name);
            if (info.type === gl.SAMPLER_2D) samplers.push(name);
          }
          this.progs.push({ p, u, samplers });
        }
      } catch (e) { this.error = e.message; }
    }
    target(w, h, float) {
      const gl = this.gl, tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (float && this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo, w, h };
    }
    drop(t) { if (t) { this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fbo); } }
    // Pictures for each pass target (two for a persistent one, taking turns), resized when the output size changes
    sized(name, w, h, float, pair) {
      let t = this.targets[name];
      if (t && (t.w !== w || t.h !== h)) { t.bufs.forEach((b) => this.drop(b)); t = null; }
      if (!t) t = this.targets[name] = { w, h, bufs: pair ? [this.target(w, h, float), this.target(w, h, float)] : [this.target(w, h, float)], cur: 0 };
      return t;
    }
    // Draws one frame. o: { w, h, time, dt, values, audio, wave, image, noise, pic, mouse }. Returns the picture.
    render(o) {
      if (this.error || !this.progs.length) return null;
      const gl = this.gl, d = this.d;
      const set = (P, name, fn, ...v) => { const l = P.u[name]; if (l) gl[fn](l, ...v); };
      let unit = 0, bound = new Set();
      const bindTex = (P, name, tex) => { const l = P.u[name]; if (!l || !tex) return; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(l, unit++); bound.add(name); };
      const bindRest = (P) => { for (const name of P.samplers) if (!bound.has(name)) bindTex(P, name, this.blank); };
      const now = new Date();
      const date = [now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000];
      const out = this.sized('__out', o.w, o.h, false, false), outRT = out.bufs[0];
      if (d.kind === 'shadertoy') {
        const P = this.progs[0];
        gl.bindFramebuffer(gl.FRAMEBUFFER, outRT.fbo); gl.viewport(0, 0, o.w, o.h); gl.useProgram(P.p);
        set(P, 'iResolution', 'uniform3f', o.w, o.h, 1);
        set(P, 'iTime', 'uniform1f', o.time); set(P, 'iTimeDelta', 'uniform1f', o.dt); set(P, 'iFrameRate', 'uniform1f', 60);
        set(P, 'iSampleRate', 'uniform1f', 44100); set(P, 'iFrame', 'uniform1i', this.frame);
        const m = o.mouse || [0, 0, 0, 0];
        set(P, 'iMouse', 'uniform4f', m[0] * o.w, m[1] * o.h, m[2] * o.w, m[3] * o.h);
        set(P, 'iDate', 'uniform4f', ...date);
        unit = 0;
        bindTex(P, 'iChannel0', o.audio); bindTex(P, 'iChannel1', o.image || o.noise); bindTex(P, 'iChannel2', o.noise); bindTex(P, 'iChannel3', o.pic || o.noise);
        const l = P.u.iChannelResolution;
        if (l) gl.uniform3fv(l, [512, 2, 1, o.w, o.h, 1, 256, 256, 1, o.w, o.h, 1]);
        bindRest(P);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.frame++;
        return outRT.tex;
      }
      // ISF: each pass in turn, into its target (or the output for the last one)
      const P = this.progs[0], vals = o.values || {};
      const vars = { WIDTH: o.w, HEIGHT: o.h };
      for (const i of d.inputs) if (i.type === 'float' || i.type === 'long') vars[i.name] = vals[i.name] ?? i.def;
      gl.useProgram(P.p);
      d.passes.forEach((pass, pi) => {
        const last = pi === d.passes.length - 1 && !pass.target;
        const w = sizeExpr(pass.width, vars, o.w), h = sizeExpr(pass.height, vars, o.h);
        // A persistent target draws into its other picture, so it can read what it drew last frame
        let dst;
        if (last) dst = outRT;
        else {
          const t = this.sized(pass.target, w, h, pass.float, pass.persistent);
          dst = t.bufs.length > 1 ? t.bufs[1 - t.cur] : t.bufs[0];
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo); gl.viewport(0, 0, dst.w, dst.h);
        unit = 0; bound = new Set();
        set(P, 'RENDERSIZE', 'uniform2f', dst.w, dst.h);
        set(P, 'TIME', 'uniform1f', o.time); set(P, 'TIMEDELTA', 'uniform1f', o.dt);
        set(P, 'FRAMEINDEX', 'uniform1i', this.frame); set(P, 'PASSINDEX', 'uniform1i', pi);
        set(P, 'DATE', 'uniform4f', ...date);
        for (const i of d.inputs) {
          const v = vals[i.name] ?? i.def;
          if (i.type === 'float') set(P, i.name, 'uniform1f', +v);
          else if (i.type === 'long') set(P, i.name, 'uniform1i', Math.round(+v));
          else if (i.type === 'bool') set(P, i.name, 'uniform1i', v ? 1 : 0);
          else if (i.type === 'color') set(P, i.name, 'uniform4f', ...[0, 1, 2, 3].map((k) => +(v[k] ?? 1)));
          else if (i.type === 'point2D') {
            const pv = i.norm ? [v[0] * dst.w, v[1] * dst.h] : v;
            set(P, i.name, 'uniform2f', +pv[0], +pv[1]);
          } else if (i.type === 'image') bindTex(P, i.name, i.name === 'inputImage' ? o.image || o.noise : o.pic || o.noise);
          else if (i.type === 'audioFFT') bindTex(P, i.name, o.fft || o.audio);
          else if (i.type === 'audio') bindTex(P, i.name, o.wave || o.audio);
        }
        // Earlier passes' pictures (a persistent one shows what it drew last frame until it's drawn again)
        for (const p2 of d.passes) {
          const t = p2.target && this.targets[p2.target];
          // never the picture this pass is drawing into
          if (t && t.bufs[t.cur] !== dst) bindTex(P, p2.target, t.bufs[t.cur].tex);
        }
        bindRest(P);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!last && this.targets[pass.target].bufs.length > 1) this.targets[pass.target].cur ^= 1;
      });
      // An ISF whose last pass has a target: the output is that target's picture
      const lp = d.passes[d.passes.length - 1];
      this.frame++;
      if (lp.target) { const t = this.targets[lp.target]; return t.bufs[t.cur].tex; }
      return outRT.tex;
    }
    dispose() {
      for (const t of Object.values(this.targets)) t.bufs.forEach((b) => this.drop(b));
      this.targets = {};
      for (const P of this.progs) this.gl.deleteProgram(P.p);
      this.gl.deleteTexture(this.blank);
      this.progs = [];
    }
  }

  globalThis.PhosphorShaderHost = { parse, ShaderHost, sizeExpr };
})();
