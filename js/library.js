'use strict';
// The preset library's own logic, apart from the page: what a saved look may hold, folders and tags, searching,
// where the library is kept (the browser's IndexedDB, which has room for hundreds of looks with their pictures),
// and how two devices' libraries are brought into line (planSync). js/app.js does the showing and the talking to
// GitHub ("preset library" there).
//
// A preset: { id, name, thumb, data, saved, mod, folder, tags }
//   folder: '' (the top) or a path like 'Shows/Friday' (folders inside folders, split by /)
//   tags:   lower-case words, searched along with the name
//   mod:    when anything about it last changed (ms); the newer copy wins when two devices disagree
// The library's notes (meta): { folders: { path: when made }, goneFolders: { path: when taken away },
//   gone: { id: when deleted } }. Deletions are remembered so another device that still has the look takes it away
//   too instead of bringing it back.
(() => {
  const MAX = 1000, NAME_MAX = 60, GONE_KEEP_MS = 180 * 24 * 3600 * 1000;
  const THUMB = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;
  const ID = /^[a-z0-9]{1,40}$/i;

  function cleanPath(s) {
    return String(s == null ? '' : s).split('/').map((x) => x.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40)).filter(Boolean).slice(0, 6).join('/');
  }
  function cleanTags(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : String(list || '').split(',')) {
      const t = String(raw).replace(/[\u0000-\u001f,]/g, '').trim().toLowerCase().slice(0, 30);
      if (t && !out.includes(t)) out.push(t);
      if (out.length >= 20) break;
    }
    return out;
  }
  function cleanPreset(p) {
    if (!p || typeof p.id !== 'string' || !ID.test(p.id) || typeof p.name !== 'string' || !p.data || typeof p.data !== 'object') return null;
    const saved = Number.isFinite(p.saved) ? p.saved : 0;
    return { id: p.id, name: p.name.trim().slice(0, NAME_MAX) || 'Look', thumb: typeof p.thumb === 'string' && THUMB.test(p.thumb) ? p.thumb : '',
      data: p.data, saved, mod: Number.isFinite(p.mod) ? p.mod : saved, folder: cleanPath(p.folder), tags: cleanTags(p.tags) };
  }
  function cleanList(list) {
    const seen = new Set(), out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const p = cleanPreset(raw);
      if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
    return out.slice(-MAX);
  }
  const stamps = (o, okKey) => {
    const out = {};
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (Number.isFinite(v) && okKey(k)) out[okKey(k)] = Math.max(out[okKey(k)] || 0, v);
    return out;
  };
  function cleanMeta(m) {
    m = m && typeof m === 'object' ? m : {};
    // Folders used to be a plain list in the first test builds; read either
    const folders = Array.isArray(m.folders) ? Object.fromEntries(m.folders.map((f) => [f, 1])) : m.folders;
    return { folders: stamps(folders, cleanPath), goneFolders: stamps(m.goneFolders, cleanPath), gone: stamps(m.gone, (k) => (ID.test(k) ? k : '')) };
  }
  // Two devices' notes together: the later time wins for each folder and each deletion
  function mergeMeta(a, b, now) {
    a = cleanMeta(a); b = cleanMeta(b);
    const both = (x, y) => { const o = { ...x }; for (const [k, v] of Object.entries(y)) o[k] = Math.max(o[k] || 0, v); return o; };
    const out = { folders: both(a.folders, b.folders), goneFolders: both(a.goneFolders, b.goneFolders), gone: both(a.gone, b.gone) };
    if (now) for (const k of Object.keys(out.gone)) if (now - out.gone[k] > GONE_KEEP_MS) delete out.gone[k];
    return out;
  }
  const sameMeta = (a, b) => JSON.stringify(sortKeys(cleanMeta(a))) === JSON.stringify(sortKeys(cleanMeta(b)));
  function sortKeys(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }

  // Every folder there is, with the folders above each, A to Z: the ones made by hand that haven't been taken away
  // since, and any a preset sits in
  function folderList(presets, meta) {
    const set = new Set(), m = cleanMeta(meta);
    const add = (path) => { const parts = path.split('/'); for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/')); };
    for (const [f, t] of Object.entries(m.folders)) if (f && t > (m.goneFolders[f] || 0)) add(f);
    for (const p of presets) if (p.folder) add(p.folder);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
  const inFolder = (p, folder, deep) => !folder || p.folder === folder || (deep !== false && p.folder.startsWith(folder + '/'));
  // The looks to show: in this folder (and the folders inside it), with this tag (from any folder when a tag is
  // picked), whose name, tags or folder hold every word typed
  function filter(presets, { q = '', tag = '', folder = '', sort = 'new' } = {}) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = presets.filter((p) => {
      if (tag ? !p.tags.includes(tag) : !inFolder(p, folder)) return false;
      if (!words.length) return true;
      const hay = (p.name + ' ' + p.tags.join(' ') + ' ' + p.folder).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    else out.sort((a, b) => (b.mod || b.saved || 0) - (a.mod || a.saved || 0));
    return out;
  }
  function tagCounts(presets) {
    const n = new Map();
    for (const p of presets) for (const t of p.tags) n.set(t, (n.get(t) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  // A library file (or another device's looks) laid into this one: new looks join, and of two copies of the same
  // look the one changed last stays. Nothing is ever taken away by this.
  function mergeLists(mine, theirs) {
    const by = new Map(mine.map((p) => [p.id, p]));
    let added = 0, updated = 0;
    for (const p of cleanList(theirs)) {
      const have = by.get(p.id);
      if (!have) { by.set(p.id, p); added++; }
      else if ((p.mod || 0) > (have.mod || 0)) { by.set(p.id, p); updated++; }
    }
    return { list: [...by.values()].slice(-MAX), added, updated };
  }

  // What a sync has to do. local: this device's presets; state: { id: { sha, mod } } as of the last sync here (the
  // file's fingerprint on GitHub then, and this device's `mod` then); remote: { id: sha } on GitHub now; gone: the
  // deletions both sides know of. Returns the ids to bring down, send up, look at (changed on both sides: the copy
  // changed last wins, see settle), delete on GitHub and delete here.
  function planSync({ local, state, remote, gone }) {
    const plan = { down: [], up: [], check: [], delRemote: [], delLocal: [] };
    const here = new Map(local.map((p) => [p.id, p]));
    for (const id of Object.keys(remote)) {
      const L = here.get(id), S = state[id];
      if (!L) { (gone[id] ? plan.delRemote : plan.down).push(id); continue; }
      const remoteChanged = !S || S.sha !== remote[id], localChanged = !S || (L.mod || 0) > (S.mod || 0);
      if (remoteChanged && localChanged) plan.check.push(id);
      else if (remoteChanged) plan.down.push(id);
      else if (localChanged) plan.up.push(id);
    }
    for (const L of local) {
      if (L.id in remote) continue;
      if (gone[L.id] && gone[L.id] >= (L.mod || 0)) plan.delLocal.push(L.id);
      else plan.up.push(L.id);
    }
    return plan;
  }
  // Changed on both sides: 'down' when GitHub's copy was changed last (or they're level), 'up' when this device's was
  const settle = (mine, theirs) => ((theirs.mod || 0) >= (mine.mod || 0) ? 'down' : 'up');

  // ---- where it's kept: one small IndexedDB store, a value per key
  const DB = 'phosphor-library', STORE = 'kv';
  let dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise((res, rej) => {
      let rq;
      try { rq = indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
      rq.onupgradeneeded = () => { rq.result.createObjectStore(STORE); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
      rq.onblocked = () => rej(new Error('blocked'));
    });
    dbP.catch(() => { dbP = null; });
    return dbP;
  }
  async function get(key) {
    const d = await db();
    return new Promise((res, rej) => { const rq = d.transaction(STORE).objectStore(STORE).get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  }
  async function set(key, val) {
    const d = await db();
    return new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key); tx.oncomplete = () => res(true); tx.onerror = tx.onabort = () => rej(tx.error); });
  }

  (typeof window !== 'undefined' ? window : globalThis).PhosphorLibrary = {
    MAX, NAME_MAX, cleanPath, cleanTags, cleanPreset, cleanList, cleanMeta, mergeMeta, sameMeta, folderList, inFolder, filter, tagCounts,
    mergeLists, planSync, settle, get, set };
})();
