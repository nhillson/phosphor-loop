'use strict';
// The clip library: a folder per category inside the library folder (Videos\Phosphor Clips by default), each clip
// an MP4, plus library.json listing every clip with its name, category, size, length and where it came from (in the
// same style as Phosphor Loop's nature/pictures.json, so Phosphor Loop can read it later). Thumbnails live in
// .thumbs. The folders are the truth: clips moved, added or deleted in File Explorer are picked up on the next look.
// Each clip can have a settings file beside it, <Name>.phosphor.json: its tags, the Phosphor Loop effects saved with
// it (the whole picture, like a preset), its category and where it came from. It travels with the clip: copy both
// files into a category folder of another library (on another computer, say) and that library picks up the tags and
// effects too. library.json keeps the tags and whether there are effects (fx); the effects themselves stay in the
// settings file, so library.json stays small with thousands of clips.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_CATEGORIES, slug } = require('./categories.js');

const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv)$/i;
const INDEX = 'library.json';
const SIDE = '.phosphor.json';
// Tags: lower case, single spaces, no commas, up to 40 of them
function cleanTags(tags) {
  const out = [];
  for (const t of Array.isArray(tags) ? tags : String(tags || '').split(',')) {
    const x = String(t || '').toLowerCase().replace(/[,\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (x && !out.includes(x)) out.push(x);
    if (out.length >= 40) break;
  }
  return out;
}
const THUMBS = '.thumbs';

// A name Windows accepts as a file or folder name
function safeName(name, fallback = 'clip') {
  let s = String(name || '').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s += ' clip';
  if (s.length > 80) s = s.slice(0, 80).trim();
  return s || fallback;
}
const rel = (p) => p.split(path.sep).join('/');
const newId = () => crypto.randomBytes(6).toString('hex');

async function moveFile(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try { await fsp.rename(from, to); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.copyFile(from, to);
    await fsp.unlink(from);
  }
}
async function exists(p) { try { await fsp.access(p); return true; } catch (_) { return false; } }

class Library {
  // tools: { probe(file) → {duration,width,height,fps,hasAudio}, thumb(video, jpg) }, trash(file) → moves to the
  // Recycle Bin (falls back to deleting)
  constructor(dir, { probe, thumb, trash, log } = {}) {
    this.dir = dir;
    this.probe = probe;
    this.thumb = thumb;
    this.trash = trash || ((f) => fsp.rm(f, { force: true }));
    this.log = log || (() => {});
    this.data = { app: 'Phosphor Clips', version: 1, cats: DEFAULT_CATEGORIES.map((c) => ({ ...c })), clips: [] };
    this.chain = Promise.resolve();
  }

  // Library changes happen one at a time
  serial(fn) {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  indexFile() { return path.join(this.dir, INDEX); }
  cat(id) { return this.data.cats.find((c) => c.id === id); }
  catFolder(cat) { return path.join(this.dir, safeName(cat.n, cat.id)); }
  abs(clip) { return path.join(this.dir, ...clip.f.split('/')); }
  thumbAbs(clip) { return clip.t ? path.join(this.dir, ...clip.t.split('/')) : ''; }
  // The clip's settings file: beside it, with the same name
  sideAbs(clip) { return this.abs(clip).replace(/\.[^.\\/]+$/, '') + SIDE; }
  async readSide(clip) {
    try { const d = JSON.parse(await fsp.readFile(this.sideAbs(clip), 'utf8')); return d && typeof d === 'object' ? d : null; } catch (_) { return null; }
  }
  // Writes the clip's settings file from what the library knows, with these effects (undefined: keep the file's own;
  // null: none). No tags, no effects: no file.
  async writeSide(clip, look) {
    const file = this.sideAbs(clip);
    if (look === undefined) look = ((await this.readSide(clip)) || {}).look || null;
    clip.fx = !!look;
    if (!look && !(clip.tags && clip.tags.length)) { await fsp.rm(file, { force: true }).catch(() => {}); return; }
    const cat = this.cat(clip.c);
    const d = {
      app: 'Phosphor Clips', kind: 'clip settings', version: 1, name: clip.n, category: cat ? cat.n : '', tags: clip.tags || [],
      src: clip.src || '', page: clip.page || '', by: clip.by || '', lic: clip.lic || '', part: clip.part || undefined, look: look || null,
    };
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(d, null, 1));
    await fsp.rename(tmp, file);
  }
  // A clip that's new to the library (dropped into a folder, copied from another computer) takes what its settings
  // file says: tags, whether there are effects, where it came from
  async takeSide(clip) {
    const d = await this.readSide(clip);
    if (!d) return;
    clip.tags = cleanTags(d.tags);
    clip.fx = !!(d.look && typeof d.look === 'object');
    for (const k of ['src', 'page', 'by', 'lic']) if (typeof d[k] === 'string' && d[k] && !clip[k]) clip[k] = d[k].slice(0, 400);
    if (Array.isArray(d.part) && !clip.part) clip.part = d.part.slice(0, 2);
  }
  // The effects saved with a clip (or null)
  async lookOf(clip) {
    const d = await this.readSide(clip);
    return d && d.look && typeof d.look === 'object' ? d.look : null;
  }

  async open() {
    await fsp.mkdir(this.dir, { recursive: true });
    try {
      const d = JSON.parse(await fsp.readFile(this.indexFile(), 'utf8'));
      if (d && Array.isArray(d.cats) && Array.isArray(d.clips)) {
        this.data = { app: 'Phosphor Clips', version: 1, ...d };
        if (!this.cat('other')) this.data.cats.push({ ...DEFAULT_CATEGORIES.find((c) => c.id === 'other') });
      }
    } catch (_) { /* a new library */ }
    // A folder for every category, so clips can be dragged between them in File Explorer
    for (const c of this.data.cats) await fsp.mkdir(this.catFolder(c), { recursive: true }).catch(() => {});
    await this.scan();
    return this.data;
  }

  async write() {
    const tmp = this.indexFile() + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 1));
    await fsp.rename(tmp, this.indexFile());
  }

  // Brings library.json in line with the folders: clips moved between category folders follow, clips deleted are
  // dropped, and videos dropped into a folder join (a new folder becomes a new category)
  scan() {
    return this.serial(async () => {
      const onDisk = new Map();   // file path relative to the library → category id
      const folders = new Map(this.data.cats.map((c) => [safeName(c.n, c.id).toLowerCase(), c.id]));
      let entries = [];
      try { entries = await fsp.readdir(this.dir, { withFileTypes: true }); } catch (_) { /* empty */ }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (e.isFile() && VIDEO_EXT.test(e.name)) { onDisk.set(e.name, 'other'); continue; }
        if (!e.isDirectory()) continue;
        let id = folders.get(e.name.toLowerCase());
        let files = [];
        try { files = await fsp.readdir(path.join(this.dir, e.name)); } catch (_) { continue; }
        files = files.filter((f) => VIDEO_EXT.test(f));
        if (!id) {
          if (!files.length) continue;
          id = this.uniqueCatId(slug(e.name));
          this.data.cats.splice(this.data.cats.length - 1, 0, { id, n: e.name });
          folders.set(e.name.toLowerCase(), id);
          this.log('library: new category from folder ' + e.name);
        }
        for (const f of files) onDisk.set(e.name + '/' + f, id);
      }
      const byName = new Map();
      for (const k of onDisk.keys()) {
        const b = k.split('/').pop().toLowerCase();
        if (!byName.has(b)) byName.set(b, []);
        byName.get(b).push(k);
      }
      const known = new Set();
      const kept = [];
      let changed = false;
      for (const c of this.data.clips) {
        if (onDisk.has(c.f) && !known.has(c.f)) {
          if (onDisk.get(c.f) !== c.c) { c.c = onDisk.get(c.f); changed = true; }
          known.add(c.f); kept.push(c); continue;
        }
        const moved = (byName.get(c.f.split('/').pop().toLowerCase()) || []).find((k) => !known.has(k) && !this.data.clips.some((o) => o.f === k));
        if (moved) { c.f = moved; c.c = onDisk.get(moved); known.add(moved); kept.push(c); changed = true; continue; }
        changed = true;   // gone
        this.log('library: ' + c.f + ' is gone');
        if (c.t) await fsp.rm(this.thumbAbs(c), { force: true }).catch(() => {});
      }
      this.data.clips = kept;
      for (const [f, id] of onDisk) {
        if (known.has(f)) continue;
        const abs = path.join(this.dir, ...f.split('/'));
        const clip = { id: newId(), n: f.split('/').pop().replace(/\.[^.]+$/, ''), c: id, f, added: new Date().toISOString() };
        if (this.probe) {
          try {
            const p = await this.probe(abs);
            Object.assign(clip, { d: round(p.duration), w: p.width, h: p.height, fps: p.fps, sound: p.hasAudio });
          } catch (e) { this.log('library: couldn’t read ' + f + ': ' + e.message); continue; }
        }
        await this.takeSide(clip);
        await this.makeThumb(clip);
        this.data.clips.push(clip);
        changed = true;
        this.log('library: found ' + f + (clip.fx ? ' (with effects)' : '') + (clip.tags && clip.tags.length ? ' (tags: ' + clip.tags.join(', ') + ')' : ''));
      }
      for (const c of this.data.clips) if (!c.t || !(await exists(this.thumbAbs(c)))) { if (await this.makeThumb(c)) changed = true; }
      if (changed || !(await exists(this.indexFile()))) await this.write();
      return this.data;
    });
  }

  async makeThumb(clip, at) {
    if (!this.thumb) return false;
    const t = THUMBS + '/' + clip.id + '.jpg';
    try {
      await fsp.mkdir(path.join(this.dir, THUMBS), { recursive: true });
      await this.thumb(this.abs(clip), path.join(this.dir, THUMBS, clip.id + '.jpg'), at == null ? (clip.d || 1) / 2 : at);
      clip.t = t;
      return true;
    } catch (e) { this.log('library: no thumbnail for ' + clip.f + ': ' + e.message); return false; }
  }

  uniqueCatId(id) {
    let out = id, i = 2;
    while (this.cat(out)) out = id + '-' + i++;
    return out;
  }

  async uniquePath(folder, name, ext, skip) {
    let base = safeName(name), p = path.join(folder, base + ext), i = 2;
    while ((await exists(p)) && p !== skip) p = path.join(folder, `${base} (${i++})${ext}`);
    return p;
  }

  /* ---------- clips ---------- */

  // file: the finished MP4 (moved into the library); meta: name, category and where it came from
  addClip(file, meta) {
    return this.serial(async () => {
      const cat = this.cat(meta.c) || this.cat('other');
      const folder = this.catFolder(cat);
      await fsp.mkdir(folder, { recursive: true });
      const dest = await this.uniquePath(folder, meta.n || 'clip', path.extname(file) || '.mp4');
      await moveFile(file, dest);
      const clip = {
        id: newId(), n: path.basename(dest).replace(/\.[^.]+$/, ''), c: cat.id, f: rel(path.relative(this.dir, dest)),
        d: round(meta.d), w: meta.w, h: meta.h, fps: meta.fps, sound: !!meta.sound,
        src: meta.src || '', page: meta.page || '', by: meta.by || '', lic: meta.lic || '', site: meta.site || '',
        part: meta.part || undefined, crop: meta.crop || undefined, guess: meta.guess || undefined, added: new Date().toISOString(),
      };
      const tags = cleanTags(meta.tags);
      if (tags.length) clip.tags = tags;
      if (tags.length || meta.look) await this.writeSide(clip, meta.look || null);
      await this.makeThumb(clip, meta.thumbAt);
      this.data.clips.push(clip);
      await this.write();
      return clip;
    });
  }

  updateClip(id, changes) {
    return this.serial(async () => {
      const clip = this.data.clips.find((c) => c.id === id);
      if (!clip) throw new Error('That clip isn’t in the library any more.');
      const cat = changes.c ? this.cat(changes.c) : this.cat(clip.c);
      if (!cat) throw new Error('That category doesn’t exist.');
      const name = changes.n != null ? safeName(changes.n) : clip.n;
      if (cat.id !== clip.c || name !== clip.n) {
        const from = this.abs(clip), sideFrom = this.sideAbs(clip);
        const dest = await this.uniquePath(this.catFolder(cat), name, path.extname(from), from);
        if (dest !== from) await moveFile(from, dest);
        clip.f = rel(path.relative(this.dir, dest));
        clip.n = path.basename(dest).replace(/\.[^.]+$/, '');
        clip.c = cat.id;
        // Its settings file goes with it
        if (await exists(sideFrom) && sideFrom !== this.sideAbs(clip)) await moveFile(sideFrom, this.sideAbs(clip));
      }
      const sideChanged = changes.tags !== undefined || changes.look !== undefined || changes.n != null || changes.c;
      if (changes.tags !== undefined) {
        const tags = cleanTags(changes.tags);
        if (tags.length) clip.tags = tags; else delete clip.tags;
      }
      if (changes.look !== undefined && changes.look !== null && typeof changes.look !== 'object') throw new Error('Those effects weren’t understood.');
      if (sideChanged) await this.writeSide(clip, changes.look);
      await this.write();
      return clip;
    });
  }

  removeClip(id) {
    return this.serial(async () => {
      const clip = this.data.clips.find((c) => c.id === id);
      if (!clip) return;
      await this.trash(this.abs(clip));
      if (await exists(this.sideAbs(clip))) await this.trash(this.sideAbs(clip)).catch(() => {});
      if (clip.t) await fsp.rm(this.thumbAbs(clip), { force: true }).catch(() => {});
      this.data.clips = this.data.clips.filter((c) => c !== clip);
      await this.write();
    });
  }

  /* ---------- categories ---------- */

  addCategory(name) {
    return this.serial(async () => {
      const n = safeName(name, '').slice(0, 40);
      if (!n) throw new Error('Give the category a name.');
      const same = this.data.cats.find((c) => c.n.toLowerCase() === n.toLowerCase());
      if (same) return same;
      const cat = { id: this.uniqueCatId(slug(n)), n };
      this.data.cats.splice(this.data.cats.length - (this.data.cats[this.data.cats.length - 1].id === 'other' ? 1 : 0), 0, cat);
      await fsp.mkdir(this.catFolder(cat), { recursive: true });
      await this.write();
      return cat;
    });
  }

  renameCategory(id, name) {
    return this.serial(async () => {
      const cat = this.cat(id);
      if (!cat) throw new Error('That category doesn’t exist.');
      const n = safeName(name, '').slice(0, 40);
      if (!n) throw new Error('Give the category a name.');
      if (this.data.cats.some((c) => c !== cat && c.n.toLowerCase() === n.toLowerCase())) throw new Error('There’s already a category called ' + n + '.');
      const oldFolder = this.catFolder(cat);
      const oldName = cat.n;
      cat.n = n;
      // The recogniser's description and words were written for the old name; a renamed default keeps them only
      // if the new name is just a respelling
      if (cat.p && slug(oldName) !== slug(n) && !DEFAULT_CATEGORIES.some((d) => d.id === cat.id && slug(d.n) === slug(n))) { delete cat.p; delete cat.k; }
      const newFolder = this.catFolder(cat);
      if (oldFolder !== newFolder && (await exists(oldFolder))) {
        if (oldFolder.toLowerCase() === newFolder.toLowerCase()) {
          const tmp = oldFolder + '.renaming';
          await fsp.rename(oldFolder, tmp);
          await fsp.rename(tmp, newFolder);
        } else if (await exists(newFolder)) {
          for (const f of await fsp.readdir(oldFolder)) await moveFile(path.join(oldFolder, f), await this.uniquePath(newFolder, f.replace(/\.[^.]+$/, ''), path.extname(f)));
          await fsp.rmdir(oldFolder).catch(() => {});
        } else {
          await fsp.rename(oldFolder, newFolder);
        }
        for (const c of this.data.clips) {
          if (c.c !== cat.id) continue;
          const f = c.f.split('/').pop();
          c.f = rel(path.relative(this.dir, path.join(newFolder, f)));
        }
      }
      await this.write();
      return cat;
    });
  }

  // The category goes; its clips move to Other
  removeCategory(id) {
    return this.serial(async () => {
      if (id === 'other') throw new Error('Other always stays.');
      const cat = this.cat(id);
      if (!cat) return;
      const other = this.cat('other');
      const folder = this.catFolder(cat);
      for (const c of this.data.clips) {
        if (c.c !== id) continue;
        const from = this.abs(c), sideFrom = this.sideAbs(c);
        const dest = await this.uniquePath(this.catFolder(other), c.n, path.extname(from));
        if (await exists(from)) await moveFile(from, dest);
        c.f = rel(path.relative(this.dir, dest));
        c.c = 'other';
        if (await exists(sideFrom)) { await moveFile(sideFrom, this.sideAbs(c)); await this.writeSide(c); }
      }
      try { if (!(await fsp.readdir(folder)).length) await fsp.rmdir(folder); } catch (_) { /* gone already */ }
      this.data.cats = this.data.cats.filter((c) => c !== cat);
      await this.write();
    });
  }
}

/* ---------- copying clips to a drive ---------- */
// Copies these clips, each with its settings file (written fresh, so the category and credit go too), into
// <dest>/Phosphor Clips/<Category>/, the same layout as a library: copy those category folders into another
// library's folder and it picks them all up, tags and effects included. A clip already there (same name, same size)
// is skipped. Returns { copied, skipped, folder }.
Library.prototype.copyTo = async function copyTo(dest, ids, onProgress = () => {}) {
  const root = path.join(dest, 'Phosphor Clips');
  const want = new Set(ids);
  const list = this.data.clips.filter((c) => want.has(c.id));
  let copied = 0, skipped = 0, i = 0;
  for (const c of list) {
    onProgress(++i, list.length, c);
    const cat = this.cat(c.c) || { n: 'Other', id: 'other' };
    const folder = path.join(root, safeName(cat.n, cat.id));
    await fsp.mkdir(folder, { recursive: true });
    const from = this.abs(c), to = path.join(folder, path.basename(from));
    let st;
    try { st = await fsp.stat(from); } catch (_) { skipped++; continue; }
    const there = await fsp.stat(to).catch(() => null);
    if (!there || there.size !== st.size) { await fsp.copyFile(from, to + '.part'); await fsp.rename(to + '.part', to); copied++; } else skipped++;
    // The settings file, always: tags, effects, category and credit
    const look = await this.lookOf(c);
    const d = { app: 'Phosphor Clips', kind: 'clip settings', version: 1, name: c.n, category: cat.n, tags: c.tags || [],
      src: c.src || '', page: c.page || '', by: c.by || '', lic: c.lic || '', part: c.part || undefined, look };
    await fsp.writeFile(to.replace(/\.[^.\\/]+$/, '') + SIDE, JSON.stringify(d, null, 1));
  }
  return { copied, skipped, folder: root };
};

const round = (n) => (Number.isFinite(+n) ? Math.round(+n * 100) / 100 : undefined);

module.exports = { Library, safeName, cleanTags, VIDEO_EXT, SIDE };
