"""Phosphor Loop: checks Loops Autopilot runs (Autopilot runs some loops, you run the rest).

  python3 tests/ap_loops_check.py         (about a minute; waits by frames, like tests/check.py)

Turns on 4 loops, lets Autopilot run only A and C, and checks over several new looks that loops B and D (yours)
never change while A and C do; that Take turns changes one of A and C each time and All at once changes both;
that moving a slider on loop B neither pins it nor stops Autopilot; and that the tabs say AUTO and YOU.
Exit code 0 = passed.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loops_check  # noqa: E402
from check import SLIDER_JS  # noqa: E402

SNAP = """() => { const { loops } = window.__plAp; return Object.fromEntries(['A','B','C','D'].map((k) => [k, JSON.stringify(loops[k].tgt)])); }"""
STEP = """() => window.__plAp.step()"""


def run(c, base, out, problems):
    pg = c.pg
    pg.goto(base + 'index.html', timeout=loops_check.START_CEILING_S * 1000)
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    c.wait_frames(30, 'starting up')

    def expect(ok, what):
        print(('  ok    ' if ok else '  FAIL  ') + what)
        if not ok:
            problems.append(what)

    pg.click('#loopCount button[data-n="4"]')
    c.wait_frames(10, '4 loops')
    pg.evaluate("() => document.querySelectorAll('details').forEach((d) => d.open = true)")
    for k in 'BD':
        pg.evaluate("(k) => document.querySelector(`#apLoops [data-aploop='${k}']`).click()", k)
    expect(pg.evaluate("() => window.__plAp.apSet.runs.join('')") == 'AC', 'Autopilot runs only loops A and C')
    pg.evaluate("() => document.querySelector(`#apLoops [data-aploop='A']`).click()")
    pg.evaluate("() => document.querySelector(`#apLoops [data-aploop='C']`).click()")
    expect(pg.evaluate("() => window.__plAp.apSet.runs.join('')") == 'C', 'the last loop can’t be switched off')
    pg.evaluate("() => document.querySelector(`#apLoops [data-aploop='A']`).click()")
    expect(pg.evaluate("() => window.__plAp.apSet.runs.join('')") == 'AC', 'loop A switched back on')
    pg.evaluate("() => { window.__plAp.apSet.check = false; }")
    pg.click('#autopilot')
    c.wait_frames(10, 'Autopilot on')
    tabs = pg.evaluate("() => ['A','B','C','D'].map((k) => document.getElementById('who' + k).textContent).join(' ')")
    expect(tabs == 'AUTO YOU AUTO YOU', f'tabs say whose loop it is ({tabs})')

    # Take turns
    before = pg.evaluate(SNAP)
    changed = []
    for i in range(4):
        s0 = pg.evaluate(SNAP)
        pg.evaluate(STEP)
        c.wait_frames(5, f'new look {i + 1}')
        s1 = pg.evaluate(SNAP)
        changed.append(''.join(k for k in 'AC' if s0[k] != s1[k]))
    after = pg.evaluate(SNAP)
    expect(before['B'] == after['B'] and before['D'] == after['D'], 'loops B and D (yours) never changed')
    expect(all(len(x) >= 1 for x in changed) and 'A' in ''.join(changed) and 'C' in ''.join(changed),
           f'taking turns, A and C both got new looks ({changed})')
    turns = pg.evaluate("() => { const { ap, apTurn } = window.__plAp; const r = []; for (let i = 0; i < 4; i++) { r.push(apTurn().go.join('')); ap.turnN = apTurn().i + 1; } return r; }")
    expect(turns == ['A', 'C', 'A', 'C'], f'take turns goes A, C, A, C ({turns})')

    # All at once
    pg.click('#apTurns button[data-turns="0"]')
    go = pg.evaluate("() => window.__plAp.apTurn().go.join('')")
    expect(go == 'AC', f'all at once changes A and C together ({go})')
    # Both A and B: they count as one turn
    pg.evaluate("() => document.querySelector(`#apLoops [data-aploop='B']`).click()")
    go = pg.evaluate("() => window.__plAp.apTurn().go.join(',')")
    expect(go == 'AB,C', f'with A, B and C, A and B count as one turn ({go})')
    pg.evaluate("() => document.querySelector(`#apLoops [data-aploop='B']`).click()")

    # Moving loop B's slider by hand: no pin, Autopilot keeps going
    pg.click('#tabB')
    pg.evaluate(SLIDER_JS, ['zoom', 33])
    c.wait_frames(5, 'moved B')
    expect(pg.evaluate("() => window.__plAp.ap.on") is True, 'moving loop B by hand leaves Autopilot running')
    expect(pg.evaluate("() => window.__plAp.ap.pins.size") == 0, 'moving loop B by hand pins nothing')
    expect(pg.evaluate("() => window.__plAp.loops.B.tgt.zoom") == 33, 'loop B takes your setting')
    for i in range(3):
        pg.evaluate(STEP)
        c.wait_frames(5, f'look after moving B {i + 1}')
    expect(pg.evaluate("() => window.__plAp.loops.B.tgt.zoom") == 33, 'loop B keeps your setting through new looks')
    # Moving loop A's slider still pins it
    pg.click('#tabA')
    pg.evaluate(SLIDER_JS, ['zoom', -20])
    c.wait_frames(5, 'moved A')
    expect(pg.evaluate("() => window.__plAp.ap.pins.has('zoom@A')"), 'moving loop A (Autopilot’s) pins it as before')
    expect(pg.evaluate("() => document.querySelector('#editor .pin[data-pin=\"zoom\"]').classList.contains('not-ap')") is False,
           'pins show on loop A')
    pg.click('#tabB')
    expect(pg.evaluate("() => document.querySelector('#editor .pin[data-pin=\"zoom\"]').classList.contains('not-ap')") is True,
           'no pins on loop B (yours)')
    for i in range(40):
        c.wait_frames(3, 'running')
    _, lit = c.picture('ap-loops')
    expect(lit > 3, f'picture still drawing (brightness {lit:.0f})')


loops_check.run = run
if __name__ == '__main__':
    loops_check.main()
