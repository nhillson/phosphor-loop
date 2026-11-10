// The preset library's logic (js/library.js): cleaning, folders, tags, search, merging a file, and what a sync does.
//   node --test tests/library.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../js/library.js';
const L = globalThis.PhosphorLibrary;
const P = (id, o = {}) => L.cleanPreset({ id, name: id, data: {}, saved: 100, ...o });

test('cleaning', () => {
  assert.equal(L.cleanPath(' Shows / Friday //'), 'Shows/Friday');
  assert.deepEqual(L.cleanTags(['Fractal', ' fractal ', 'Slow, burn', '']), ['fractal', 'slow burn']);
  assert.equal(L.cleanPreset({ id: 'bad id!', name: 'x', data: {} }), null);
  const p = L.cleanPreset({ id: 'p1', name: 'Old one', data: { A: {} }, saved: 5, thumb: 'javascript:alert(1)' });
  assert.deepEqual([p.folder, p.tags, p.mod, p.thumb], ['', [], 5, '']);
  assert.equal(L.cleanList([P('a'), P('a'), null, { id: 'b' }]).length, 1);
});
test('folders, tags and search', () => {
  const list = [P('a', { name: 'Blue tunnel', folder: 'Shows/Friday', tags: ['slow'], mod: 3 }), P('b', { name: 'Red storm', folder: 'Shows', tags: ['fast', 'slow'], mod: 9 }), P('c', { name: 'Tunnel two', mod: 5 })];
  const meta = { folders: { 'Ideas/Later': 10, Old: 10 }, goneFolders: { Old: 20 } };
  assert.deepEqual(L.folderList(list, meta), ['Ideas', 'Ideas/Later', 'Shows', 'Shows/Friday']);
  assert.deepEqual(L.filter(list, {}).map((p) => p.id), ['b', 'c', 'a']);
  assert.deepEqual(L.filter(list, { folder: 'Shows' }).map((p) => p.id), ['b', 'a']);
  assert.deepEqual(L.filter(list, { folder: 'Shows/Friday', tag: 'slow', sort: 'name' }).map((p) => p.id), ['a', 'b'], 'a tag shows its looks from any folder');
  assert.deepEqual(L.filter(list, { q: 'tunnel slow' }).map((p) => p.id), ['a']);
  assert.deepEqual(L.tagCounts(list), [['slow', 2], ['fast', 1]]);
});
test('opening a library file never loses a look', () => {
  const r = L.mergeLists([P('a', { mod: 5, name: 'mine' }), P('b', { mod: 5 })], [P('a', { mod: 9, name: 'theirs' }), P('b', { mod: 1, name: 'older' }), P('c')]);
  assert.deepEqual([r.added, r.updated], [1, 1]);
  assert.deepEqual(r.list.map((p) => p.name), ['theirs', 'b', 'c']);
});
test('what a sync does', () => {
  const local = [P('same', { mod: 5 }), P('mine', { mod: 9 }), P('theirs', { mod: 5 }), P('both', { mod: 9 }), P('new', { mod: 7 }), P('dead', { mod: 5 }), P('alive', { mod: 30 })];
  const state = { same: { sha: 's1', mod: 5 }, mine: { sha: 's2', mod: 5 }, theirs: { sha: 's3', mod: 5 }, both: { sha: 's4', mod: 5 }, dead: { sha: 's5', mod: 5 }, alive: { sha: 's6', mod: 5 } };
  const remote = { same: 's1', mine: 's2', theirs: 's3x', both: 's4x', far: 's7', binned: 's8' };
  const gone = { binned: 50, dead: 20, alive: 20 };
  const plan = L.planSync({ local, state, remote, gone });
  assert.deepEqual(plan, { down: ['theirs', 'far'], up: ['mine', 'new', 'alive'], check: ['both'], delRemote: ['binned'], delLocal: ['dead'] });
  assert.equal(L.settle({ mod: 9 }, { mod: 12 }), 'down');
  assert.equal(L.settle({ mod: 9 }, { mod: 3 }), 'up');
  // A first sync on a device that already has the same looks: each is looked at, none blindly overwritten
  assert.deepEqual(L.planSync({ local: [P('a')], state: {}, remote: { a: 'x' }, gone: {} }).check, ['a']);
});
test('notes from two devices', () => {
  const m = L.mergeMeta({ folders: { A: 5 }, gone: { x: 10 } }, { folders: { A: 9, B: 2 }, goneFolders: { B: 4 }, gone: { x: 3, y: 1 } }, 0);
  assert.deepEqual(m, { folders: { A: 9, B: 2 }, goneFolders: { B: 4 }, gone: { x: 10, y: 1 } });
  assert.ok(L.sameMeta(m, { gone: { y: 1, x: 10 }, goneFolders: { B: 4 }, folders: { B: 2, A: 9 } }));
  assert.deepEqual(L.mergeMeta({ gone: { old: 1 } }, {}, 400 * 24 * 3600 * 1000).gone, {});
});
