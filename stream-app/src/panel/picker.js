'use strict';
// Share another window…: a tile for every open program and screen. Click one, then Share (or double-click a tile).
const $ = (s) => document.querySelector(s);
let chosen = null;

function tile(item) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.className = 'tile'; b.dataset.i = item.i; b.setAttribute('aria-pressed', 'false'); b.title = item.name;
  const shot = document.createElement('div'); shot.className = 'shot';
  if (item.thumb) shot.style.backgroundImage = `url("${item.thumb}")`;
  const name = document.createElement('div'); name.className = 'name';
  if (item.icon) { const img = document.createElement('img'); img.src = item.icon; img.alt = ''; name.append(img); }
  const t = document.createElement('span'); t.textContent = item.name; name.append(t);
  b.append(shot, name);
  b.addEventListener('click', () => select(item.i));
  b.addEventListener('dblclick', () => { select(item.i); share(); });
  li.append(b);
  return li;
}
function select(i) {
  chosen = i;
  document.querySelectorAll('.tile').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i === i)));
  $('#share').disabled = false;
}
function share() { if (chosen !== null) window.picker.choose(chosen); }

window.picker.onItems((items) => {
  const wins = items.filter((x) => x.kind === 'window'), scrs = items.filter((x) => x.kind === 'screen');
  $('#windows').replaceChildren(...wins.map(tile));
  $('#screens').replaceChildren(...scrs.map(tile));
  $('#noWindows').hidden = wins.length > 0;
});
$('#share').addEventListener('click', share);
$('#cancel').addEventListener('click', () => window.picker.choose(null));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.picker.choose(null);
  else if (e.key === 'Enter' && chosen !== null) share();
});
