"""Phosphor Loop: checks Autopilot's black-out watch.

  python3 tests/ap_dark_check.py        (about a minute; waits by frames, like tests/check.py)

With Autopilot on, both loops are given a look that drains away to nearly black. The watch should notice, turn
Trails, Input size and brightness up on the loops doing it, say so in the status line, and, if the screen stays
black, bring the next look on. With Autopilot off, a dark picture is left alone.
Exit code 0 = passed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loops_check  # noqa: E402

DIM = """() => { const P = window.__plAp; P.ap.next = performance.now() + 9e5; P.ap.due = P.ap.next;
  for (const k of ['A','B']) Object.assign(P.loops[k].tgt, { in1: 'sparks', in2: 'none', size: 15, trails: 8, gain: 0.05, zoom: -40 });
  Object.assign(P.loops.A.cur, { size: 15, trails: 8, gain: 0.05 }); Object.assign(P.loops.B.cur, { size: 15, trails: 8, gain: 0.05 }); }"""
STATE = """() => { const P = window.__plAp, a = P.loops.A.tgt, b = P.loops.B.tgt;
  return { A: [a.trails, a.size, a.gain], B: [b.trails, b.size, b.gain], hot: P.dark.hot, lifting: P.dark.lifting,
           skipped: P.dark.skipped,  status: document.querySelector('#apState').textContent, next: P.ap.next - performance.now() }; }"""

FEED = """() => { const e = window.__plAp.eye, t = performance.now();
  for (const k of ['comp', 'A', 'B']) { e.hist[k].push({ t, mean: 0.002, white: 0, lit: 0.01, detail: 0, busy: 0, shades: 0, colorful: 0, variety: 0, motion: 0 });
    while (e.hist[k].length > 1 && t - e.hist[k][0].t > 8000) e.hist[k].shift(); } }"""


def run(c, base, out, problems):
    pg = c.pg
    pg.goto(base + 'index.html', timeout=loops_check.START_CEILING_S * 1000)
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    c.wait_frames(30, 'starting up')

    def expect(ok, what):
        print(('  ok    ' if ok else '  FAIL  ') + what)
        if not ok:
            problems.append(what)

    pg.evaluate("() => { const s = window.__plAp.apSet; s.check = false; }")
    pg.evaluate("() => document.querySelector('#autopilot').click()")
    c.wait_frames(20, 'Autopilot on')
    pg.evaluate(DIM)
    start = pg.evaluate(STATE)
    saw_text = saw_lift = saw_hot = False
    s = start
    for _ in range(30):
        # The workspace's software graphics hand the eye's copies over too slowly for a test, so the copies of a
        # black screen it would see are handed to it here (what the watch does with them is what's tested)
        pg.evaluate(FEED)
        c.wait_frames(4, 'picture fading')
        s = pg.evaluate(STATE)
        saw_hot = saw_hot or s['hot'] > 0
        saw_text = saw_text or 'go black' in s['status']
        saw_lift = saw_lift or (s['A'][0] > 8 or s['B'][0] > 8)
        if saw_lift and saw_text and s['skipped']:
            break
    expect(saw_hot, 'the watch noticed the screen going black')
    expect(saw_lift, f'Trails were turned up on a dark loop (now A {s["A"]}, B {s["B"]})')
    expect(saw_text, 'the status line said it was bringing a loop back up')
    expect(s['skipped'] or s['hot'] > 4, f'still black after a while: the next look is brought on ({s["hot"]:.1f} s black)')
    expect(all(v[0] <= 84 for v in (s['A'], s['B'])), 'Trails stayed at 84 or below')

    # Autopilot off: left alone
    pg.evaluate("() => document.querySelector('#autopilot').click()")
    c.wait_frames(5, 'Autopilot off')
    pg.evaluate("() => { for (const k of ['A','B']) Object.assign(window.__plAp.loops[k].tgt, { in1: 'sparks', size: 15, trails: 8, gain: 0.05 }); }")
    for _ in range(10):
        pg.evaluate(FEED)
        c.wait_frames(4, 'dark by hand')
    s = pg.evaluate(STATE)
    expect(s['A'][0] == 8 and s['B'][0] == 8, f'with Autopilot off nothing is turned up (Trails A {s["A"][0]}, B {s["B"][0]})')


loops_check.run = run
if __name__ == '__main__':
    loops_check.main()
