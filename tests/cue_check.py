"""Phosphor Loop: checks Autopilot's Cue mode.

  python3 tests/cue_check.py        (about 2 minutes; waits by frames, like tests/check.py)

Cue mode (Autopilot settings): Autopilot leaves the picture alone, tries looks out of sight on the scout (loop C's
place), keeps up to five ready looks with previews under the picture, and Next look cuts to the waiting one on the
same frame. Clicking a preview makes it the next look; then Space cuts to it, keys 1 to 5 pick and the same number again cuts.
Switching Cue mode off gives Autopilot its timed looks back.
Exit code 0 = passed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loops_check  # noqa: E402

# The workspace's software graphics hand the eye its copies too slowly for a test, so copies of a rich, moving
# picture are handed to it for the scout here (what Cue mode does with them is what's tested)
FEED = """() => { const e = window.__plAp.eye, t = performance.now();
  e.hist.C.push({ t, mean: 0.3, white: 0, lit: 0.7, detail: 0.12, busy: 0.6, shades: 0.85, colorful: 0.4, variety: 0.6, motion: 0.2 });
  while (e.hist.C.length > 1 && t - e.hist.C[0].t > 8000) e.hist.C.shift(); }"""
STATE = """() => { const P = window.__plAp, C = window.__plCue, c = C.cue;
  const shown = P.mix.tgt.view >= 50 ? 'B' : 'A';
  return { active: C.cueActive(), scout: c.scout, n: c.list.length, ids: c.list.map((i) => i.id), deck: c.deck && { k: c.deck.k, id: c.deck.id },
           pick: c.pick, view: P.mix.cur.view, shown, look: JSON.stringify(P.loops[shown].tgt),
           status: document.querySelector('#apState').textContent, strip: !document.querySelector('#cueStrip').hidden,
           clock: document.querySelector('#lookClockText').textContent }; }"""


def run(c, base, out, problems):
    pg = c.pg
    pg.goto(base + 'index.html', timeout=loops_check.START_CEILING_S * 1000)
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    c.wait_frames(30, 'starting up')

    def expect(ok, what):
        print(('  ok    ' if ok else '  FAIL  ') + what)
        if not ok:
            problems.append(what)

    # 3D worlds and fractals take seconds a frame in this workspace's software drawing: left out here
    pg.evaluate("() => { window.__plAp.apSet.off = ['world', 'fractal', 'camera', 'screen', 'phone', 'video']; }")
    pg.evaluate("() => document.querySelector('#apCue').click()")
    c.wait_frames(10, 'Cue mode on', ceiling=120)
    s = pg.evaluate(STATE)
    expect(s['active'] and s['scout'], 'Cue mode turns Autopilot on and starts looking out of sight')
    expect('Cue mode' in s['status'], f'the status line says so (“{s["status"][:90]}”)')
    expect(s['strip'], 'the previews show under the picture')
    expect(s['view'] in (0, 100), f'one loop on screen at a time (What you see {s["view"]})')

    # Nothing on screen changes by itself, even past when Autopilot's next look would have been due
    pg.evaluate("() => { const a = window.__plAp.ap; a.next = performance.now() - 1; }")
    before = s
    for _ in range(60):
        pg.evaluate(FEED)
        c.wait_frames(3, 'looks being tried', ceiling=120)
        s = pg.evaluate(STATE)
        if s['n'] >= 3:
            break
    expect(s['shown'] == before['shown'] and s['look'] == before['look'], 'the look on screen stayed exactly as it was')
    expect(s['n'] >= 3, f'ready looks piled up on the list ({s["n"]})')
    pics = pg.evaluate("""() => [...document.querySelectorAll('#cueStrip .cue-pic')].filter((b) => !b.disabled).map((b) => {
      const cv = b.querySelector('canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let lit = 0; for (let i = 0; i < d.length; i += 4) lit += d[i] + d[i + 1] + d[i + 2]; return lit / (d.length / 4) / 3; })""")
    expect(len(pics) == s['n'] and all(p > 1 for p in pics), f'each ready look has its picture ({[round(p) for p in pics]})')
    expect('ready' in s['clock'], f'the clock under the picture counts ready looks (“{s["clock"]}”)')
    c.wait_frames(40, 'next look building up', ceiling=120)

    # Next look: on the same frame, the waiting look is on screen
    s = pg.evaluate(STATE)
    deck = s['deck']
    r = pg.evaluate("""() => { const P = window.__plAp, C = window.__plCue.cue, k = C.deck.k, look = JSON.stringify(P.loops[k].tgt);
      document.querySelector('#nextLook').click();
      return { k, same: JSON.stringify(P.loops[k].tgt) === look, view: P.mix.cur.view, n: C.list.length }; }""")
    expect(r['view'] == (100 if r['k'] == 'B' else 0), f'Next look cuts to loop {r["k"]} on the very same frame (What you see {r["view"]})')
    expect(r['same'], 'the look that comes on is the one that was waiting, untouched')
    expect(deck['id'] is not None and r['n'] == s['n'] - 1, f'it leaves the list ({s["n"]} → {r["n"]})')
    c.wait_frames(5, 'after the cut', ceiling=120)
    s = pg.evaluate(STATE)
    expect(s['deck'] and s['deck']['k'] != r['k'], 'the next look is already waiting on the other loop')

    # Clicking a preview makes it the next look
    target = pg.evaluate("() => { const b = [...document.querySelectorAll('#cueStrip .cue-pic')].filter((x) => !x.disabled).pop(); b.click(); return +b.dataset.id; }")
    c.wait_frames(3, 'picked', ceiling=120)
    s = pg.evaluate(STATE)
    expect(s['pick'] == target and s['deck']['id'] == target, f'a clicked preview is the next look (picked {target}, waiting {s["deck"]})')
    marked = pg.evaluate("() => +document.querySelector('#cueStrip .cue-pic.next').dataset.id")
    expect(marked == target, 'and it is marked Next')
    pg.evaluate("() => window.__plCue.cueGo()")
    c.wait_frames(3, 'cut to the pick', ceiling=120)
    s = pg.evaluate(STATE)
    expect(target not in s['ids'] and s['pick'] is None, 'Next look cut to the picked one')

    # The keyboard, for DJing: click a preview then Space cuts to it; 1 to 5 pick; the same number again cuts
    for _ in range(60):
        s = pg.evaluate(STATE)
        if s['n'] >= 3:
            break
        pg.evaluate(FEED)
        c.wait_frames(3, 'more looks being tried', ceiling=120)
    expect(s['n'] >= 3, f'enough ready looks for the key checks ({s["n"]})')
    # A click leaves the button with the keyboard in a real browser: focused here, the way a click leaves it
    target = pg.evaluate("""() => { const b = document.querySelectorAll('#cueStrip .cue-pic')[1]; b.focus(); b.click(); b.focus(); return +b.dataset.id; }""")
    c.wait_frames(3, 'picked by click', ceiling=120)
    pg.keyboard.press('Space')
    c.wait_frames(3, 'Space', ceiling=120)
    s = pg.evaluate(STATE)
    expect(target not in s['ids'] and s['pick'] is None, f'click a preview, then Space cuts to it (picked {target}, list {s["ids"]})')
    shown = s['shown']
    pg.keyboard.press('Shift+Space')
    c.wait_frames(3, 'Shift+Space', ceiling=120)
    s2 = pg.evaluate(STATE)
    expect(s2['shown'] == shown, 'Shift+Space doesn’t cut')
    pg.keyboard.press('Shift+Space')
    c.wait_frames(3, 'unfreeze', ceiling=120)
    want = pg.evaluate("() => window.__plCue.cue.list[0].id")
    pg.keyboard.press('Digit1')
    c.wait_frames(3, 'key 1', ceiling=120)
    s = pg.evaluate(STATE)
    expect(s['pick'] == want and s['deck']['id'] == want, f'key 1 makes the first preview the next look (wanted {want}, waiting {s["deck"]})')
    pg.keyboard.press('Numpad1')
    c.wait_frames(3, 'number pad 1 again', ceiling=120)
    s = pg.evaluate(STATE)
    expect(want not in s['ids'] and s['pick'] is None, 'pressing its number again (number pad) cuts to it')
    n = s['n']
    pg.keyboard.press('Digit5') if n < 5 else None
    c.wait_frames(2, 'key 5', ceiling=120)
    s = pg.evaluate(STATE)
    expect(n >= 5 or s['pick'] is None, 'a number with no ready look yet does nothing')

    # Clearing single looks: the small ✕ on a preview, or Shift + its number
    for _ in range(60):
        s = pg.evaluate(STATE)
        if s['n'] >= 3:
            break
        pg.evaluate(FEED)
        c.wait_frames(3, 'more looks being tried', ceiling=120)
    xs = pg.evaluate("() => [...document.querySelectorAll('#cueStrip .cue-x')].map((x) => !x.hidden)")
    expect(xs[:s['n']] == [True] * s['n'] and not any(xs[s['n']:]), f'each ready look has a ✕, empty places don’t ({xs})')
    gone = pg.evaluate("""() => { const c = window.__plCue.cue, id = c.list[1].id; document.querySelectorAll('#cueStrip .cue-x')[1].click();
      return { id, ids: c.list.map((i) => i.id) }; }""")
    expect(gone['id'] not in gone['ids'] and len(gone['ids']) == s['n'] - 1, f'the ✕ clears just that look ({s["ids"]} → {gone["ids"]})')
    s = pg.evaluate(STATE)
    waiting = s['deck']['id']
    slot = s['ids'].index(waiting) if waiting in s['ids'] else None
    if slot is not None:
        pg.keyboard.press(f'Shift+Digit{slot + 1}')
        c.wait_frames(3, 'Shift + number', ceiling=120)
        s2 = pg.evaluate(STATE)
        expect(waiting not in s2['ids'] and s2['deck'] and s2['deck']['id'] != waiting,
               f'Shift + its number clears the look that was next, and another takes its place ({waiting} → {s2["deck"]})')
    else:
        expect(False, f'the waiting look is on the list ({waiting}, {s["ids"]})')

    # Fade between looks: the Cut/Fade button beside Cut; What you see slides over the fade time, nothing new loads meanwhile
    pg.evaluate("() => { window.__plCue.apSet.cueFadeSecs = 8; document.querySelector('#cueFadeBar').click(); }")
    lbl = pg.evaluate("() => [document.querySelector('#cueFadeBarLabel').textContent, document.querySelector('#apCueFade').getAttribute('aria-pressed')]")
    expect(lbl == ['Fade 8 s', 'true'], f'the Cut/Fade button switches fading on, and the switch under Cue mode follows ({lbl})')
    c.wait_frames(20, 'next look building up', ceiling=120)
    r = pg.evaluate("""() => { const P = window.__plAp, C = window.__plCue.cue, k = C.deck.k; window.__plCue.cueGo();
      return { k, view: P.mix.cur.view, fading: !!C.fade, deck: C.deck }; }""")
    target = 100 if r['k'] == 'B' else 0
    expect(r['fading'] and r['view'] != target and r['deck'] is None, f'pressed: a fade starts instead of a cut (What you see {r["view"]:.0f}, going to {target})')
    mids = []
    # 8 s here, since this workspace draws only a few frames a second
    for _ in range(120):
        c.wait_frames(1, 'fading', ceiling=60)
        v = pg.evaluate("() => [window.__plAp.mix.cur.view, !!window.__plCue.cue.fade]")
        mids.append(round(v[0]))
        if not v[1]:
            break
    between = [m for m in mids if 3 < m < 97]
    s = pg.evaluate(STATE)
    expect(len(between) >= 2 and s['view'] == target, f'What you see slides across and lands on the new look ({mids})')
    expect(s['deck'] and s['deck']['k'] != r['k'], 'once it has faded, the next look goes on the other loop')
    # Pressed again in the middle of a fade: it finishes at once and the next fade starts
    c.wait_frames(10, 'next look building up', ceiling=120)
    r1 = pg.evaluate("() => { const C = window.__plCue.cue, k = C.deck.k; window.__plCue.cueGo(); return k; }")
    c.wait_frames(1, 'part way', ceiling=60)
    r2 = pg.evaluate("""() => { const C = window.__plCue.cue; C.deck = null; window.__plCue.cueGo();
      return { fading: !!C.fade, to: C.fade && C.fade.to }; }""")
    expect(r2['fading'] and r2['to'] == (0 if r1 == 'B' else 100), f'pressing again mid-fade finishes it and fades back the other way ({r2})')
    pg.evaluate("() => { document.querySelector('#cueFadeBar').click(); window.__plCue.cue.fade && (window.__plCue.cue.fade.ms = 1); }")
    c.wait_frames(3, 'fade off', ceiling=120)
    lbl = pg.evaluate("() => document.querySelector('#cueFadeBarLabel').textContent")
    expect(lbl == 'Cut', f'switched off, it says Cut again ({lbl})')

    # Off again: Autopilot changes looks by itself
    pg.evaluate("() => document.querySelector('#apCue').click()")
    c.wait_frames(5, 'Cue mode off', ceiling=120)
    s = pg.evaluate(STATE)
    expect(not s['active'] and not s['scout'] and not s['strip'], 'switched off, the scout stops and the previews go')
    expect('Next new look' in s['status'] or 'New look' in s['status'], f'Autopilot has its timed looks back (“{s["status"][:80]}”)')


loops_check.run = run
if __name__ == '__main__':
    loops_check.main()
