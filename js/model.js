// The Model input (one of the 3D worlds): a 3D model made in Blender (or any 3D app), exported as glTF Binary (.glb).
// three.js (vendor/three/three-gltf.js, loaded the first time a model is shown) draws it on a canvas of its own and
// app.js copies that picture into the loop like any other 3D world's (drawExt). Each loop gets its own wandering
// camera, or the file's own camera (Blender's) when it has one and that's picked. The file's animations all play,
// looping. Models are kept in this browser (IndexedDB phosphor-models: `meta` {id, name, added, size} and `data`
// {id, buf}); which one shows and the camera choice in localStorage phosphor-model. With none added, a sample shows.
(() => {
'use strict';
const SRC = 'vendor/three/three-gltf.js';
const SET_KEY = 'phosphor-model';
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const KEY_SEED = { A: 0, B: 1, C: 2, D: 3 };

let T = null, state = 'idle', R = null, cur = null, loading = null, index = [], simT = 0;
const listeners = new Set();
const cams = {};
const settings = { id: 'sample', cam: 'wander' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (_) { /* ignore */ }
const saveSet = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (_) { /* ignore */ } };
const emit = () => { for (const f of listeners) { try { f(); } catch (e) { console.error(e); } } };

/* ================= keeping models in this browser ================= */
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((res, rej) => {
    const r = indexedDB.open('phosphor-models', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('meta', { keyPath: 'id' }); r.result.createObjectStore('data', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbP;
}
function run(stores, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('aborted'));
  }));
}
const loadIndex = () => run(['meta'], 'readonly', (t) => t.objectStore('meta').getAll())
  .then((all) => { index = (all || []).sort((a, b) => a.added - b.added); emit(); })
  .catch(() => { index = []; });
const readData = (id) => run(['data'], 'readonly', (t) => t.objectStore('data').get(id)).then((r) => (r ? r.buf : null));

/* ================= three.js ================= */
function loadThree() {
  if (T) return Promise.resolve(T);
  if (!loading) loading = new Promise((res, rej) => {
    if (window.PhosphorThree) { res(window.PhosphorThree); return; }
    const s = document.createElement('script');
    s.src = SRC;
    s.onload = () => (window.PhosphorThree ? res(window.PhosphorThree) : rej(new Error('three.js missing')));
    s.onerror = () => rej(new Error('three.js didn’t load'));
    document.head.appendChild(s);
  }).then((t) => (T = t));
  return loading;
}
function makeRenderer() {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 2;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);
  const scene = new T.Scene();
  scene.background = new T.Color(0x000000);
  const pm = new T.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  pm.dispose();
  // A soft fill, a key light that rides with each loop's camera and two colored lights circling the model
  const hemi = new T.HemisphereLight(0xc9d6ff, 0x1a0f24, 0.6);
  const key = new T.DirectionalLight(0xffffff, 2.2);
  const rimA = new T.PointLight(0xd23cff, 3, 0, 0), rimB = new T.PointLight(0x2ee6ff, 3, 0, 0);
  scene.add(hemi, key, key.target, rimA, rimB);
  const camera = new T.PerspectiveCamera(50, 1, 0.01, 1000);
  const blank = document.createElement('canvas');
  blank.width = 2; blank.height = 2;
  { const g = blank.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 2, 2); }
  return { renderer, canvas, scene, camera, key, rimA, rimB, blank };
}

/* ================= the model shown ================= */
function dispose(o) {
  o.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    const ms = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
    for (const m of ms) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
}
function show(root, animations, cameras, name, update) {
  if (cur) { R.scene.remove(cur.root); if (cur.mixer) cur.mixer.stopAllAction(); dispose(cur.root); }
  R.scene.add(root);
  root.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(root);
  const sphere = box.isEmpty() ? new T.Sphere(new T.Vector3(), 1) : box.getBoundingSphere(new T.Sphere());
  if (!(sphere.radius > 1e-6)) sphere.radius = 1;
  let mixer = null;
  if (animations && animations.length) {
    mixer = new T.AnimationMixer(root);
    for (const clip of animations) mixer.clipAction(clip).setLoop(T.LoopRepeat, Infinity).play();
  }
  cur = { root, mixer, cams: (cameras || []).filter((c) => c.isPerspectiveCamera), name, sphere, update, anims: animations ? animations.length : 0 };
  emit();
}
function makeSample() {
  const g = new T.Group();
  const knot = new T.Mesh(new T.TorusKnotGeometry(1, 0.32, 260, 36, 2, 3),
    new T.MeshStandardMaterial({ color: 0x8b1ab8, metalness: 0.85, roughness: 0.2 }));
  g.add(knot);
  const gems = [];
  for (let i = 0; i < 14; i++) {
    const col = new T.Color().setHSL(i / 14, 0.9, 0.55);
    const m = new T.Mesh(new T.IcosahedronGeometry(0.13, 0), new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.35 }));
    m.userData = { a: (i / 14) * Math.PI * 2, r: 1.9 + 0.35 * Math.sin(i * 2.3), y: 0.6 * Math.sin(i * 1.7), w: 0.25 + 0.1 * Math.cos(i) };
    gems.push(m);
    g.add(m);
  }
  const update = (t) => {
    knot.rotation.set(t * 0.11, t * 0.17, 0);
    for (const m of gems) {
      const u = m.userData, a = u.a + t * u.w;
      m.position.set(Math.cos(a) * u.r, u.y + 0.25 * Math.sin(t * 0.7 + u.a * 3), Math.sin(a) * u.r);
      m.rotation.set(t * 1.3 + u.a, t * 0.9, 0);
    }
  };
  update(0);
  return { root: g, update };
}
function parse(buf) {
  return new Promise((res, rej) => {
    try { new T.GLTFLoader().parse(buf, '', res, rej); } catch (e) { rej(e); }
  });
}
// A plain-words reason a file wouldn't open
function why(e) {
  const m = String((e && e.message) || e || '');
  if (/draco/i.test(m)) return 'it’s compressed. In Blender’s glTF export, untick Compression and export again.';
  if (/meshopt|ktx|basis/i.test(m)) return 'it uses a kind of compression this can’t open. Export it again without compression.';
  if (/fetch|load|uri|\.bin|image/i.test(m)) return 'it needs other files beside it. In Blender’s glTF export pick the format glTF Binary (.glb).';
  return 'it isn’t a glTF model this can read. In Blender use File › Export › glTF 2.0 and pick glTF Binary (.glb).';
}
async function loadCurrent() {
  const id = settings.id;
  if (id !== 'sample' && index.some((m) => m.id === id)) {
    try {
      const buf = await readData(id);
      if (buf && settings.id === id) {
        const g = await parse(buf);
        if (settings.id !== id) return;
        show(g.scene, g.animations, g.cameras, (index.find((m) => m.id === id) || {}).name || 'Model', null);
        return;
      }
    } catch (e) { console.error('Model', e); }
  }
  const s = makeSample();
  show(s.root, [], [], 'Sample', s.update);
}
function build() {
  if (state !== 'idle') return;
  state = 'building';
  emit();
  loadThree().then(async () => {
    R = makeRenderer();
    await loadIndex();
    await loadCurrent();
    state = 'ready';
    emit();
  }).catch((e) => { console.error('Model', e); state = 'failed'; emit(); });
}
function whenReady() {
  if (state === 'idle') build();
  return new Promise((res, rej) => {
    const check = () => {
      if (state === 'ready') { listeners.delete(check); res(); }
      else if (state === 'failed') { listeners.delete(check); rej(new Error('The model viewer couldn’t start on this computer.')); }
    };
    listeners.add(check);
    check();
  });
}

/* ================= cameras ================= */
function camOf(k) {
  if (!cams[k]) {
    const seed = k in KEY_SEED ? KEY_SEED[k] : [...String(k)].reduce((a, c) => a + c.charCodeAt(0), 0);
    cams[k] = { t: seed * 7.3, seed };
  }
  return cams[k];
}
// The wandering camera: round and round the model, rising and sinking, now and then diving in close, looking
// at a point near its middle that drifts, with a little roll
function placeWander(cam, c, aspect, scale) {
  const S = cur.sphere, r = S.radius, s = c.seed, t = c.t;
  const fov = clamp(50 * Math.pow(2.5 / Math.max(scale, 0.05), 0.6), 20, 110);
  const fill = 1 / Math.sin(fov * Math.PI / 360);
  const az = t * 0.32 + s * 1.9 + 0.7 * Math.sin(t * 0.21 + s * 3.1);
  const el = clamp(0.28 + 0.42 * Math.sin(t * 0.17 + s * 1.3) + 0.12 * Math.sin(t * 0.43 + s), -0.7, 1.25);
  const dive = Math.pow(Math.max(0, Math.sin(t * 0.09 + s * 2.3)), 4);
  const d = r * fill * Math.max(0.55, 1.2 + 0.4 * Math.sin(t * 0.13 + s * 0.7) - 0.7 * dive);
  const C = S.center;
  cam.position.set(C.x + d * Math.cos(el) * Math.sin(az), C.y + d * Math.sin(el), C.z + d * Math.cos(el) * Math.cos(az));
  const wob = r * 0.3 * (0.4 + dive);
  cam.up.set(0, 1, 0);
  cam.lookAt(C.x + wob * Math.sin(t * 0.29 + s), C.y + 0.6 * wob * Math.sin(t * 0.23 + 2 * s), C.z + wob * Math.cos(t * 0.31 + 3 * s));
  cam.rotateZ(0.22 * Math.sin(t * 0.11 + s * 1.7));
  cam.fov = fov;
  cam.aspect = aspect;
  cam.near = Math.max(d - r * 1.6, d * 0.005, r * 1e-4);
  cam.far = d + r * 6;
  cam.updateProjectionMatrix();
  return cam;
}

/* ================= drawing ================= */
function tick(dt) {
  simT += dt;
  if (!cur) return;
  if (cur.mixer) cur.mixer.update(dt);
  if (cur.update) cur.update(simT);
}
function step(k, dt, mult) {
  camOf(k).t += dt * (mult || 1) * 0.6;
}
function render(k, w, h, scale, glow) {
  if (state === 'idle') build();
  if (state !== 'ready' || !cur) return R ? R.blank : blankCanvas();
  const r = R.renderer;
  if (R.canvas.width !== w || R.canvas.height !== h) r.setSize(w, h, false);
  const c = camOf(k);
  let cam;
  if (settings.cam === 'blender' && cur.cams.length) {
    cam = cur.cams[0];
    cam.updateMatrixWorld(true);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  } else cam = placeWander(R.camera, c, w / h, scale);
  // The lights: the key comes from over the camera's shoulder, the colored pair circle round
  const S = cur.sphere, rad = S.radius, C = S.center, g = glow || 1;
  const p = new T.Vector3().setFromMatrixPosition(cam.matrixWorld);
  R.key.position.set(p.x + rad, p.y + rad * 1.5, p.z + rad * 0.5);
  R.key.target.position.copy(C);
  R.key.intensity = 2.2 * g;
  const a = simT * 0.35;
  R.rimA.position.set(C.x + Math.cos(a) * rad * 1.7, C.y + rad * 0.8, C.z + Math.sin(a) * rad * 1.7);
  R.rimB.position.set(C.x - Math.cos(a) * rad * 1.7, C.y - rad * 0.4, C.z - Math.sin(a) * rad * 1.7);
  R.rimA.intensity = R.rimB.intensity = 3 * g;
  r.toneMappingExposure = 0.95 * g;
  r.render(R.scene, cam);
  return R.canvas;
}
let _blank = null;
function blankCanvas() {
  if (!_blank) { _blank = document.createElement('canvas'); _blank.width = 2; _blank.height = 2; const g = _blank.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 2, 2); }
  return _blank;
}

/* ================= your models ================= */
async function add(file) {
  if (!file) throw new Error('No file');
  if (!/\.(glb|gltf)$/i.test(file.name || '')) throw new Error('Pick a .glb file (in Blender: File › Export › glTF 2.0, format glTF Binary).');
  await whenReady();
  const buf = await file.arrayBuffer();
  let g;
  try { g = await parse(buf.slice(0)); } catch (e) { throw new Error(`${file.name} couldn’t be opened: ${why(e)}`); }
  const id = `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const name = (file.name || 'Model').replace(/\.(glb|gltf)$/i, '');
  const meta = { id, name, added: Date.now(), size: buf.byteLength };
  let kept = true;
  try {
    await run(['meta', 'data'], 'readwrite', (t) => { t.objectStore('meta').put(meta); t.objectStore('data').put({ id, buf }); });
    index.push(meta);
  } catch (e) { console.error('Model', e); kept = false; }
  settings.id = kept ? id : settings.id;
  saveSet();
  show(g.scene, g.animations, g.cameras, name, null);
  return { id, name, kept, anims: g.animations.length, hasCamera: cur.cams.length > 0 };
}
async function remove(id) {
  await run(['meta', 'data'], 'readwrite', (t) => { t.objectStore('meta').delete(id); t.objectStore('data').delete(id); });
  index = index.filter((m) => m.id !== id);
  if (settings.id === id) { settings.id = index.length ? index[index.length - 1].id : 'sample'; saveSet(); if (state === 'ready') await loadCurrent(); }
  emit();
}
async function pick(id) {
  settings.id = id;
  saveSet();
  emit();
  if (state === 'ready') await loadCurrent();
  else build();
}
function setCam(mode) { settings.cam = mode === 'blender' ? 'blender' : 'wander'; saveSet(); emit(); }

loadIndex();
window.PhosphorModel = {
  get state() { return state; },
  build,
  tick(dt) { tick(dt); },
  step,
  render(k, w, h, scale, glow) {
    if (state === 'failed') return null;
    try { return render(k, w, h, scale, glow); } catch (err) { console.error('Model', err); state = 'failed'; emit(); return null; }
  },
  list: () => index.map((m) => ({ id: m.id, name: m.name, size: m.size })),
  current: () => settings.id,
  name: () => (cur ? cur.name : ''),
  hasCamera: () => !!(cur && cur.cams.length),
  anims: () => (cur ? cur.anims : 0),
  camMode: () => settings.cam,
  setCam,
  add,
  remove,
  pick,
  onChange(f) { listeners.add(f); },
  sphere: () => (cur ? { c: cur.sphere.center.toArray(), r: cur.sphere.radius } : null),
};
})();
