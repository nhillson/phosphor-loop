'use strict';
// The page the button opens when something needs explaining: Phosphor Clips isn't running (a Start button that
// starts it with the request), the page can't be sent, or Phosphor Clips said no.
const q = new URLSearchParams(location.search);
const why = q.get('why') || 'notRunning';
const $ = (id) => document.getElementById(id);
const closeTab = () => chrome.tabs.getCurrent((t) => { if (t) chrome.tabs.remove(t.id); else window.close(); });
const GET_IT = 'https://github.com/nhillson/phosphor-loop/releases/tag/clip-app-latest';

$(why) && ($(why).hidden = false);
for (const id of ['close1', 'close2']) $(id).addEventListener('click', closeTab);
$('getLink').href = GET_IT;
$('getLink').target = '_blank';

if (why === 'notWeb') $('title').textContent = 'This page can’t be sent';
if (why === 'refused') {
  $('title').textContent = 'Phosphor Clips couldn’t open that';
  $('refusedText').textContent = q.get('m') || 'Something went wrong.';
}

if (why === 'notRunning') {
  const link = q.get('link') || 'phosphor-clips://open';
  if (!/^phosphor-clips:\/\//.test(link)) $('start').hidden = true;
  else $('start').href = link;
  // After Start: wait for Phosphor Clips to answer (it got the request through the link), then close this tab
  let watching = false;
  $('start').addEventListener('click', () => {
    if (watching) return;
    watching = true;
    say('wait', 'Waiting for Phosphor Clips to open…');
    const t0 = Date.now();
    const tick = async () => {
      for (const p of [47811, 47812, 47813]) {
        try {
          const r = await fetch(`http://127.0.0.1:${p}/ping`, { cache: 'no-store' });
          if (r.ok && (await r.json()).app === 'Phosphor Clips') {
            say('ok', 'Phosphor Clips is open. You can close this tab.');
            setTimeout(closeTab, 1500);
            return;
          }
        } catch (_) { /* not yet */ }
      }
      if (Date.now() - t0 > 45000) { say('', 'Phosphor Clips didn’t open. Is it installed? Press Start again, or get it with the link below.'); watching = false; return; }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 800);
  });
}
function say(kind, text) {
  $('state').hidden = false;
  $('state').className = 'state ' + kind;
  $('stateText').textContent = text;
}
