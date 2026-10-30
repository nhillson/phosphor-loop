"""Phosphor Loop: checks that a pin lights only under the loop it holds, in the sidebar and in Spread out controls.

  python3 tests/pins_check.py        (about a minute; waits by frames, like tests/check.py)

Pins Grow on loop A and Spin on loop A (from A's column), and checks each pin is lit under loop A only: on the A tab
but not the B tab, and in loop A's column but not loop B's. Also checks each column's Final Pass / Within Loops
switch shows its own loop's setting. Exit code 0 = passed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loops_check  # noqa: E402

LIT = """(key) => {
  const real = document.querySelector(`.editor .pin[data-pin="${key}"]`);
  const out = { sidebar: real.getAttribute('aria-pressed') === 'true' };
  for (const c of document.querySelectorAll('.loop-col')) {
    const m = c.querySelector('[data-loop]'), p = c.querySelector(`.pin[data-pin="${key}"]`);
    if (m && p) out[m.dataset.loop] = p.getAttribute('aria-pressed') === 'true';
  }
  return out;
}"""
WHERE = """() => {
  const out = {};
  for (const c of document.querySelectorAll('.loop-col')) {
    const m = c.querySelector('[data-loop]'), g = c.querySelector('.where[data-where="mirrorFinal"]');
    if (m && g) out[m.dataset.loop] = g.querySelector('[aria-pressed="true"]').dataset.final === '1';
  }
  return out;
}"""


def run(c, base, out, problems):
    pg = c.pg
    pg.goto(base + 'index.html', timeout=loops_check.START_CEILING_S * 1000)
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    c.wait_frames(20, 'starting up')

    def expect(ok, what):
        print(('  ok    ' if ok else '  FAIL  ') + what)
        if not ok:
            problems.append(what)

    pg.evaluate("() => document.getElementById('autopilot').click()")
    c.wait_frames(5, 'Autopilot on')
    pg.evaluate("() => document.querySelectorAll('details').forEach((d) => d.open = true)")
    pg.evaluate("() => document.getElementById('tabA').click()")
    c.wait_frames(3, 'loop A')
    pg.evaluate("() => document.querySelector('.editor .pin[data-pin=\"grow\"]').click()")
    c.wait_frames(3, 'Grow pinned on A')
    expect(pg.evaluate(LIT, 'grow')['sidebar'], 'Grow pinned on A: lit on the A tab')
    pg.evaluate("() => document.getElementById('tabB').click()")
    c.wait_frames(3, 'loop B')
    expect(not pg.evaluate(LIT, 'grow')['sidebar'], 'Grow pinned on A: not lit on the B tab')

    pg.evaluate("() => document.getElementById('wideBtn').click()")
    c.wait_frames(10, 'Spread out controls')
    g = pg.evaluate(LIT, 'grow')
    expect(g.get('A') is True and g.get('B') is False, f'Spread out: Grow lit in A’s column only ({g})')

    pg.evaluate("""() => { for (const c of document.querySelectorAll('.loop-col')) {
      const m = c.querySelector('[data-loop]'); if (m && m.dataset.loop === 'A') c.querySelector('.pin[data-pin="spin"]').click(); } }""")
    c.wait_frames(5, 'Spin pinned from A’s column')
    s = pg.evaluate(LIT, 'spin')
    expect(s.get('A') is True and s.get('B') is False, f'Spread out: Spin pinned from A’s column, lit there only ({s})')
    expect(pg.evaluate("() => [...window.__plAp.ap.pins].sort().join(' ')") == 'grow@A spin@A', 'both pins hold loop A only')

    pg.evaluate("() => { const L = window.__plAp.loops; L.A.tgt.mirrorFinal = true; L.B.tgt.mirrorFinal = false; }")
    c.wait_frames(30, 'columns refreshed')
    w = pg.evaluate(WHERE)
    expect(w.get('A') is True and w.get('B') is False, f'each column’s Mirror Final Pass / Within Loops shows its own loop ({w})')


loops_check.run = run
if __name__ == '__main__':
    loops_check.main()
