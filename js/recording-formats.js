'use strict';
window.PhosphorRecording = (() => {
// Browsers save videos without writing down how long they are, so video players can't show the length
// or jump around in a long one. This writes the length into the start of the file. Only the first few KB
// are read and changed; the rest of the video is reused as is. If anything looks unfamiliar, the file is
// left exactly as the browser made it.
async function addWebmDuration(blob, ms) {
  try {
    if (!/webm/i.test(blob.type) || !(ms > 0)) return blob;
    const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer());
    // A WebM file is nested labelled boxes; each label and each size is a variable-length number
    const vint = (p, keepMarker) => {
      const b = head[p];
      if (!b) return null;
      let len = 1, mask = 0x80;
      while (!(b & mask)) { len++; mask >>= 1; }
      if (p + len > head.length) return null;
      let v = keepMarker ? b : b & (mask - 1);
      let allOnes = (b & (mask - 1)) === mask - 1;
      for (let i = 1; i < len; i++) { v = v * 256 + head[p + i]; if (head[p + i] !== 0xff) allOnes = false; }
      return { v, len, unknown: !keepMarker && allOnes };
    };
    const box = (p) => {
      const id = vint(p, true);
      if (!id || id.len > 4) return null;
      const size = vint(p + id.len, false);
      if (!size) return null;
      return { id: id.v, sizeAt: p + id.len, sizeLen: size.len, data: p + id.len + size.len, size: size.v, unknown: size.unknown };
    };
    const ebml = box(0);
    if (!ebml || ebml.id !== 0x1A45DFA3 || ebml.unknown) return blob;
    const seg = box(ebml.data + ebml.size);
    if (!seg || seg.id !== 0x18538067) return blob;
    const segEnd = seg.unknown ? head.length : Math.min(head.length, seg.data + seg.size);
    let info = null;
    for (let p = seg.data; p < segEnd;) {
      const e = box(p);
      if (!e || e.unknown) return blob;
      if (e.id === 0x1549A966) { info = e; break; }
      if (e.id !== 0xEC) return blob;   // only padding may come before it; anything else and we leave the file alone
      p = e.data + e.size;
    }
    if (!info || info.data + info.size > head.length) return blob;
    let scale = 1000000, dur = null;
    for (let p = info.data; p < info.data + info.size;) {
      const e = box(p);
      if (!e || e.unknown) return blob;
      if (e.id === 0x2AD7B1) { scale = 0; for (let i = 0; i < e.size; i++) scale = scale * 256 + head[e.data + i]; }
      else if (e.id === 0x4489) dur = e;
      p = e.data + e.size;
    }
    if (!(scale > 0)) return blob;
    const value = ms * 1e6 / scale;
    if (dur) {   // a length is already there: fill it in where it is
      const dv = new DataView(head.buffer, dur.data, dur.size);
      if (dur.size === 8) dv.setFloat64(0, value); else if (dur.size === 4) dv.setFloat32(0, value); else return blob;
      return new Blob([head, blob.slice(head.length)], { type: blob.type });
    }
    // Add the length to the file's information box, and grow that box's size to match
    const add = new Uint8Array(11);
    add.set([0x44, 0x89, 0x88]);
    new DataView(add.buffer).setFloat64(3, value);
    const newSize = info.size + add.length;
    if (newSize >= 2 ** (7 * info.sizeLen) - 1) return blob;
    const sizeBytes = new Uint8Array(info.sizeLen);
    for (let i = info.sizeLen - 1, n = newSize; i >= 0; i--) { sizeBytes[i] = n % 256; n = Math.floor(n / 256); }
    sizeBytes[0] |= 0x80 >> (info.sizeLen - 1);
    const end = info.data + info.size;
    return new Blob([head.subarray(0, info.sizeAt), sizeBytes, head.subarray(info.sizeAt + info.sizeLen, end), add, blob.slice(end)], { type: blob.type });
  } catch (_) {
    return blob;
  }
}

// Chrome writes an MP4 as a string of small pieces with no overall length, which some players and editors
// can't show the length of, can't jump around in, or won't open. This rewrites it as an ordinary MP4: one
// table of contents at the front (with the length), then the picture and sound. The picture and sound
// themselves are reused untouched; only the small labelled boxes that describe them are read and rewritten.
// If anything looks unfamiliar, the file is left exactly as the browser made it.
async function standardMp4(blob) {
  try {
    if (!/mp4/i.test(blob.type) || blob.size < 16) return blob;
    // Read a small window of the file at a time, so a long video isn't copied into memory
    let winAt = 0, win = null;
    const read = async (at, len) => {
      if (at < 0 || at + len > blob.size) throw new Error('past the end');
      if (!win || at < winAt || at + len > winAt + win.length) {
        winAt = at;
        win = new Uint8Array(await blob.slice(at, Math.min(blob.size, at + Math.max(len, 65536))).arrayBuffer());
      }
      return win.subarray(at - winAt, at - winAt + len);
    };
    const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
    const s32 = (b, p) => u32(b, p) | 0;
    const u64 = (b, p) => u32(b, p) * 4294967296 + u32(b, p + 4);
    const tag = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    // The boxes inside a box that's held in memory
    const kids = (b, from, to) => {
      const out = [];
      for (let p = from; p + 8 <= to;) {
        let size = u32(b, p), head = 8;
        if (size === 1) { size = u64(b, p + 8); head = 16; } else if (size === 0) size = to - p;
        if (size < head || p + size > to) throw new Error('bad box');
        out.push({ type: tag(b, p + 4), at: p, body: p + head, end: p + size });
        p += size;
      }
      return out;
    };
    const one = (list, type) => list.find((k) => k.type === type);

    // 1. Walk the file's top-level boxes, keeping the table of contents and each piece's description
    let moov = null;
    const frags = [];
    for (let at = 0; at < blob.size;) {
      if (blob.size - at < 8) return blob;
      const h = await read(at, Math.min(16, blob.size - at));
      let size = u32(h, 0), head = 8;
      const type = tag(h, 4);
      if (size === 1) { if (h.length < 16) return blob; size = u64(h, 8); head = 16; } else if (size === 0) size = blob.size - at;
      if (size < head || at + size > blob.size) return blob;
      if (type === 'moov') { if (moov) return blob; moov = { b: (await read(at, size)).slice(), head }; }
      else if (type === 'moof') frags.push({ at, b: (await read(at, size)).slice(), head });
      at += size;
    }
    if (!moov || !frags.length) return blob;
    const mb = moov.b;
    const mk = kids(mb, moov.head, mb.length);
    const mvhd = one(mk, 'mvhd');
    if (!mvhd) return blob;
    const mts = u32(mb, mvhd.body + (mb[mvhd.body] ? 20 : 12));
    if (!mts) return blob;

    // 2. Each track: its description boxes, plus the defaults its pieces fall back on
    const tracks = new Map();
    for (const t of mk.filter((k) => k.type === 'trak')) {
      const tk = kids(mb, t.body, t.end);
      const tkhd = one(tk, 'tkhd'), mdia = one(tk, 'mdia');
      if (!tkhd || !mdia || one(tk, 'edts')) return blob;
      const md = kids(mb, mdia.body, mdia.end);
      const mdhd = one(md, 'mdhd'), hdlr = one(md, 'hdlr'), minf = one(md, 'minf');
      if (!mdhd || !hdlr || !minf) return blob;
      const mi = kids(mb, minf.body, minf.end);
      const stbl = one(mi, 'stbl');
      if (!stbl) return blob;
      const st = kids(mb, stbl.body, stbl.end);
      const stsd = one(st, 'stsd'), stsz = one(st, 'stsz');
      // Samples already listed in the table of contents would need merging: leave such a file alone
      if (!stsd || !stsz || u32(mb, stsz.body + 8) !== 0) return blob;
      const id = u32(mb, tkhd.body + (mb[tkhd.body] ? 20 : 12));
      const ts = u32(mb, mdhd.body + (mb[mdhd.body] ? 20 : 12));
      if (!ts || tracks.has(id)) return blob;
      tracks.set(id, {
        tk, tkhd, md, mdhd, mi, stsd, ts, video: tag(mb, hdlr.body + 8) === 'vide',
        def: { sdi: 1, dur: 0, size: 0, flags: 0 },
        size: [], dur: [], cto: [], sync: [], hasCto: false, chunks: [], start: null, time: 0,
      });
    }
    const mvex = one(mk, 'mvex');
    if (mvex) for (const x of kids(mb, mvex.body, mvex.end)) {
      if (x.type !== 'trex') continue;
      const tr = tracks.get(u32(mb, x.body + 4));
      if (tr) tr.def = { sdi: u32(mb, x.body + 8), dur: u32(mb, x.body + 12), size: u32(mb, x.body + 16), flags: u32(mb, x.body + 20) };
    }
    if (!tracks.size) return blob;

    // 3. Each piece: where its samples sit in the file, and how long and big each one is
    const runs = [];
    for (const f of frags) {
      const fb = f.b;
      let firstTraf = true;
      for (const traf of kids(fb, f.head, fb.length).filter((k) => k.type === 'traf')) {
        const tk = kids(fb, traf.body, traf.end);
        const tfhd = one(tk, 'tfhd');
        if (!tfhd) return blob;
        const fl = u32(fb, tfhd.body) & 0xffffff;
        const tr = tracks.get(u32(fb, tfhd.body + 4));
        if (!tr) return blob;
        let p = tfhd.body + 8, base = f.at;
        if (fl & 1) { base = u64(fb, p); p += 8; }
        else if (!(fl & 0x20000) && !firstTraf) return blob;
        firstTraf = false;
        let sdi = tr.def.sdi, dDur = tr.def.dur, dSize = tr.def.size, dFlags = tr.def.flags;
        if (fl & 2) { sdi = u32(fb, p); p += 4; }
        if (fl & 8) { dDur = u32(fb, p); p += 4; }
        if (fl & 0x10) { dSize = u32(fb, p); p += 4; }
        if (fl & 0x20) { dFlags = u32(fb, p); p += 4; }
        if (p > tfhd.end) return blob;
        if (fl & 0x10000) continue;   // an empty piece
        const tfdt = one(tk, 'tfdt');
        if (tfdt) {
          const t = fb[tfdt.body] ? u64(fb, tfdt.body + 4) : u32(fb, tfdt.body + 4);
          if (tr.start === null) { tr.start = t; tr.time = t; }
          else if (t > tr.time && tr.dur.length) { tr.dur[tr.dur.length - 1] += t - tr.time; tr.time = t; }   // a gap: hold the last sample
        }
        if (tr.start === null) { tr.start = 0; tr.time = 0; }
        let dataAt = base;
        for (const run of tk.filter((k) => k.type === 'trun')) {
          const vf = u32(fb, run.body), v = vf >>> 24, rf = vf & 0xffffff;
          const n = u32(fb, run.body + 4);
          let q = run.body + 8;
          if (rf & 1) { dataAt = base + s32(fb, q); q += 4; }
          let firstFlags = null;
          if (rf & 4) { firstFlags = u32(fb, q); q += 4; }
          const per = ((rf >> 8) & 1) + ((rf >> 9) & 1) + ((rf >> 10) & 1) + ((rf >> 11) & 1);
          if (q + n * per * 4 > run.end) return blob;
          const from = dataAt;
          for (let i = 0; i < n; i++) {
            let d = dDur, s = dSize, sf = i === 0 && firstFlags !== null ? firstFlags : dFlags, c = 0;
            if (rf & 0x100) { d = u32(fb, q); q += 4; }
            if (rf & 0x200) { s = u32(fb, q); q += 4; }
            if (rf & 0x400) { sf = u32(fb, q); q += 4; }
            if (rf & 0x800) { c = v ? s32(fb, q) : u32(fb, q); q += 4; if (c) tr.hasCto = true; }
            tr.size.push(s); tr.dur.push(d); tr.cto.push(c);
            if (!(sf & 0x10000)) tr.sync.push(tr.size.length);
            dataAt += s; tr.time += d;
          }
          if (!n) continue;
          if (from < 0 || dataAt > blob.size) return blob;
          const r = { from, len: dataAt - from, out: 0 };
          runs.push(r);
          tr.chunks.push({ n, sdi, run: r });
        }
      }
    }
    const used = [...tracks.values()].filter((tr) => tr.size.length);
    if (!used.length) return blob;

    // 4. The picture and sound go in one block, in the order they were recorded
    const parts = [];
    let payload = 0;
    for (const r of runs) {
      r.out = payload;
      const last = parts[parts.length - 1];
      if (last && last.to === r.from) last.to += r.len; else parts.push({ from: r.from, to: r.from + r.len });
      payload += r.len;
    }
    const big = payload + 8 > 0xffffffff;
    const wide = payload + 16 * 1048576 > 0xffffffff;   // chunk positions need 64-bit numbers past 4 GB

    // 5. Writing boxes
    const box = (type, ...inner) => {
      inner = inner.filter(Boolean);
      const len = 8 + inner.reduce((a, x) => a + x.length, 0);
      const b = new Uint8Array(len);
      new DataView(b.buffer).setUint32(0, len);
      for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
      let o = 8;
      for (const x of inner) { b.set(x, o); o += x.length; }
      return b;
    };
    const table = (type, version, head, rows, cols, bits64) => {   // a full box: version, a few numbers, then rows of numbers
      const w = bits64 ? 8 : 4;
      const b = new Uint8Array(4 + head.length * 4 + rows.length * cols * w);
      const dv = new DataView(b.buffer);
      dv.setUint32(0, (version << 24) >>> 0);
      let o = 4;
      for (const x of head) { dv.setUint32(o, x); o += 4; }
      for (const row of rows) for (const x of (cols === 1 ? [row] : row)) {
        if (bits64) { dv.setUint32(o, Math.floor(x / 4294967296)); dv.setUint32(o + 4, x % 4294967296); }
        else if (x < 0) dv.setInt32(o, x); else dv.setUint32(o, x);
        o += w;
      }
      return box(type, b);
    };
    const pairs = (list) => {   // runs of equal values: [count, value]
      const out = [];
      for (const x of list) { const l = out[out.length - 1]; if (l && l[1] === x) l[0]++; else out.push([1, x]); }
      return out;
    };
    const copy = (k) => mb.subarray(k.at, k.end);
    const setTime = (b, at, version, value) => {   // write a length into a copied box
      const dv = new DataView(b.buffer, b.byteOffset, b.length);
      if (version) { dv.setUint32(at, Math.floor(value / 4294967296)); dv.setUint32(at + 4, value % 4294967296); }
      else { if (value > 0xffffffff) throw new Error('too long'); dv.setUint32(at, value); }
    };

    // Line the tracks up: whichever started first starts at zero, and a later one waits with an empty edit
    const startSec = Math.min(...used.map((tr) => tr.start / tr.ts));
    let movieDur = 0;
    for (const tr of used) {
      tr.mediaDur = tr.dur.reduce((a, x) => a + x, 0);
      tr.wait = Math.round((tr.start / tr.ts - startSec) * mts);
      tr.movieDur = Math.round(tr.mediaDur * mts / tr.ts);
      movieDur = Math.max(movieDur, tr.wait + tr.movieDur);
    }

    const ftyp = box('ftyp', new Uint8Array([105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50, 97, 118, 99, 49, 109, 112, 52, 49]));   // isom, isom iso2 avc1 mp41
    const buildMoov = (dataStart) => {
      const traks = used.map((tr) => {
        const tkhd = copy(tr.tkhd).slice();
        const tkv = tkhd[8];
        setTime(tkhd, tkv ? 36 : 28, tkv, tr.wait + tr.movieDur);
        const mdhd = copy(tr.mdhd).slice();
        const mdv = mdhd[8];
        setTime(mdhd, mdv ? 32 : 24, mdv, tr.mediaDur);
        const edts = tr.wait > 0 ? box('edts', table('elst', 0, [2], [[tr.wait, 0xffffffff, 0x10000], [tr.movieDur, 0, 0x10000]], 3)) : null;
        const chunkRows = [];
        tr.chunks.forEach((c, i) => {
          const l = chunkRows[chunkRows.length - 1];
          if (!l || l[1] !== c.n || l[2] !== c.sdi) chunkRows.push([i + 1, c.n, c.sdi]);
        });
        const stts = pairs(tr.dur);
        const ctts = tr.hasCto ? pairs(tr.cto) : null;
        const stbl = box('stbl',
          copy(tr.stsd),
          table('stts', 0, [stts.length], stts, 2),
          ctts && table('ctts', tr.cto.some((x) => x < 0) ? 1 : 0, [ctts.length], ctts, 2),
          tr.video && tr.sync.length < tr.size.length ? table('stss', 0, [tr.sync.length], tr.sync, 1) : null,
          table('stsc', 0, [chunkRows.length], chunkRows, 3),
          table('stsz', 0, [0, tr.size.length], tr.size, 1),
          table(wide ? 'co64' : 'stco', 0, [tr.chunks.length], tr.chunks.map((c) => dataStart + c.run.out), 1, wide));
        const minf = box('minf', ...tr.mi.filter((k) => k.type !== 'stbl').map(copy), stbl);
        const mdia = box('mdia', mdhd, ...tr.md.filter((k) => k.type !== 'mdhd' && k.type !== 'minf').map(copy), minf);
        return box('trak', tkhd, edts, ...tr.tk.filter((k) => k.type !== 'tkhd' && k.type !== 'mdia').map(copy), mdia);
      });
      const mv = copy(mvhd).slice();
      const mvv = mv[8];
      setTime(mv, mvv ? 32 : 24, mvv, movieDur);
      return box('moov', mv, ...traks, ...mk.filter((k) => !['mvhd', 'trak', 'mvex'].includes(k.type)).map(copy));
    };
    const mdatHead = big ? 16 : 8;
    const size0 = buildMoov(0).length;   // chunk positions don't change the size, so measure once, then fill them in
    const moovOut = buildMoov(ftyp.length + size0 + mdatHead);
    if (moovOut.length !== size0) return blob;
    const mh = new Uint8Array(mdatHead), mdv = new DataView(mh.buffer);
    if (big) { mdv.setUint32(0, 1); mdv.setUint32(8, Math.floor((payload + 16) / 4294967296)); mdv.setUint32(12, (payload + 16) % 4294967296); }
    else mdv.setUint32(0, payload + 8);
    mh.set([109, 100, 97, 116], 4);   // mdat
    return new Blob([ftyp, moovOut, mh, ...parts.map((x) => blob.slice(x.from, x.to))], { type: blob.type });
  } catch (_) {
    return blob;
  }
}


return { addWebmDuration, standardMp4 };
})();
