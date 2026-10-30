"""Phosphor Loop: checks that Autopilot's new mirror levels come in through the mirror Transition.

  python3 tests/ap_mirror_check.py        (a few minutes; waits by frames, like tests/check.py)

A loop Autopilot swaps in comes in wearing the mirror on screen and changes to its own through its Transition,
over the Fade time (never under 3 seconds); a loop changed in place glides to its new mirror the same way; with
Transition set to Cut the mirror switches at once; a mirror changed by hand still takes 3 seconds.
Exit code 0 = passed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loops_check  # noqa: E402

# Each new look Autopilot brings in, noted the moment it comes (apStep is wrapped through the frame loop: a look
# is new when ap.cameIn changes), with the mirror change it started and the other loop's mirror on screen
WATCH_JS = """() => {
  const P = window.__plAp; window.__mxLog = [];
  let last = null;
  const tick = () => {
    const c = P.ap.cameIn;
    if (c && c !== last) {
      last = c;
      const k = c.k, L = P.loops[k], o = P.loops[k === 'A' ? 'B' : k === 'B' ? 'A' : k], m = L.mx || {};
      window.__mxLog.push({ k, mirror: L.tgt.mirror, from: m.from, to: m.to, e: m.e, secs: m.secs, fx: L.tgt.mirrorFx,
                            other: o.tgt.mirror, pinned: P.ap.pins.has('view') });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""
LOG = "() => window.__mxLog.splice(0)"
MX = """(k) => { const L = window.__plAp.loops[k]; const m = L.mx || {}; return { mirror: L.tgt.mirror, from: m.from, to: m.to, e: m.e, secs: m.secs }; }"""


def run(c, base, out, problems):
    pg = c.pg
    pg.goto(base + 'index.html', timeout=loops_check.START_CEILING_S * 1000)
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    c.wait_frames(30, 'starting up')

    def expect(ok, what):
        print(('  ok    ' if ok else '  FAIL  ') + what)
        if not ok:
            problems.append(what)

    def looks(n_frames, want):
        """Waits up to n_frames frames, 10 at a time, for a new look that passes want; returns it or None."""
        for _ in range(n_frames // 10):
            pg.evaluate("() => { const a = window.__plAp.ap; a.next = Math.min(a.next, performance.now()); }")
            c.wait_frames(10, 'Autopilot working')
            for x in pg.evaluate(LOG):
                if want(x):
                    return x
        return None

    pg.evaluate("() => { const s = window.__plAp.apSet; s.check = false; s.wild = 100; s.fade = 0; }")
    pg.evaluate(WATCH_JS)
    pg.click('#autopilot')
    c.wait_frames(10, 'Autopilot on')

    # Swapped in over the other loop, with a different mirror
    x = looks(400, lambda x: x['k'] in 'AB' and not x['pinned'] and x['mirror'] != x['other'])
    expect(x is not None, 'saw a loop swapped in with a different mirror from the one on screen')
    if x:
        expect(x['from'] == x['other'] and x['to'] == x['mirror'] and x['e'] < 0.5,
               f'loop {x["k"]} comes in wearing the mirror on screen ({x["other"]}) and heads for its own ({x["mirror"]}): e = {x["e"]:.2f}')
        expect(x['secs'] >= 3, f'that change takes the Fade time, at least 3 seconds ({x["secs"]:.1f} s)')

    # Cut: switches at once
    pg.evaluate("() => { for (const k of ['A','B']) window.__plAp.loops[k].tgt.mirrorFx = 'cut'; }")
    pg.evaluate(LOG)
    x = looks(400, lambda x: x['k'] in 'AB' and not x['pinned'] and x['mirror'] != x['other'] and x['fx'] == 'cut')
    expect(x is not None and x['e'] == 1, f'with Transition set to Cut the new mirror switches at once ({x and x["e"]})')
    pg.evaluate("() => { for (const k of ['A','B']) window.__plAp.loops[k].tgt.mirrorFx = 'melt'; }")

    # In place (What you see pinned): the loop on screen glides to its new mirror
    pg.evaluate("() => window.__plAp.ap.pins.add('view')")
    pg.evaluate(LOG)
    before = {k: pg.evaluate(MX, k) for k in 'AB'}
    x = None
    for _ in range(40):
        pg.evaluate("() => { const a = window.__plAp.ap; a.next = Math.min(a.next, performance.now()); }")
        c.wait_frames(10, 'Autopilot working')
        got = [g for g in pg.evaluate(LOG) if g['pinned']]
        if got:
            g = got[-1]
            now = pg.evaluate(MX, g['k'])
            if now['to'] != before[g['k']]['to']:
                x = now
                break
            before = {k: pg.evaluate(MX, k) for k in 'AB'}
    expect(x is not None, 'saw a loop change mirror in place')
    if x:
        expect(x['secs'] >= 3 and x['from'] != x['to'],
               f'it glides from {x["from"]} to {x["to"]} over the Fade time ({x["secs"]:.1f} s, now {x["e"]:.2f} of the way)')

    # By hand: the usual 3 seconds
    pg.evaluate("() => window.__plAp.ap.pins.delete('view')")
    pg.click('#autopilot')
    c.wait_frames(5, 'Autopilot off')
    pg.evaluate("() => { const L = window.__plAp.loops.A; L.tgt.mirror = L.tgt.mirror === 2 ? 4 : 2; }")
    c.wait_frames(2, 'hand change starting')
    a = pg.evaluate(MX, 'A')
    expect(a['secs'] == 3, f'a mirror changed by hand takes the usual 3 seconds ({a["secs"]})')


loops_check.run = run
if __name__ == '__main__':
    loops_check.main()
