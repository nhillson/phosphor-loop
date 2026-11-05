"""Neutral this loop (Inputs › Neutral this loop, per loop, and in each Spread out column): just that loop's input,
its effects off and nothing fed into it; the other loops stay. Autopilot hands that loop back (or stops if it was its
only loop). Waits are frames, never seconds.

  python3 tests/neutral_loop_check.py          (about a minute)
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import patched_index, serve, Check, START_CEILING_S, FAIL_FAST_MS

LOOK = """() => { const L = __plAp.loops, M = __plAp.mix;
  Object.assign(L.A.tgt, { in1: 'shape', in2: 'bars', trails: 80, zoom: 30, spin: 20, mirror: 4, melt: 40, color: 50 });
  Object.assign(L.B.tgt, { in1: 'wave', in2: 'sparks', trails: 70, zoom: -20, warp: 40, push: 50, mirror: 6 });
  M.tgt.xab = 40; M.tgt.xba = 30; }"""
STATE = """(k) => { const t = __plAp.loops[k].tgt; return { in1: t.in1, in2: t.in2, trails: t.trails, zoom: t.zoom, mirror: t.mirror,
  melt: t.melt, push: t.push, warp: t.warp, xab: __plAp.mix.tgt.xab, xba: __plAp.mix.tgt.xba }; }"""


def main():
    from playwright.sync_api import sync_playwright
    out = os.path.join(tempfile.gettempdir(), 'phosphor-neutral-loop')
    os.makedirs(out, exist_ok=True)
    html, _ = patched_index(216)
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/'
    problems, errors = [], []
    def check(ok, what):
        print(('  ok   ' if ok else '  FAIL ') + what)
        if not ok: problems.append(what)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1920, 'height': 1080})
        pg.set_default_timeout(FAIL_FAST_MS)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.route(base + 'index.html', lambda r: r.fulfill(body=html, content_type='text/html'))
        pg.goto(base + 'index.html', timeout=START_CEILING_S * 1000)
        pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
        c = Check(pg, out)
        c.wait_frames(30, 'starting up', ceiling=START_CEILING_S)

        # 1. In the sidebar, editing loop B
        pg.evaluate(LOOK)
        c.wait_frames(5, 'look')
        pg.evaluate("document.getElementById('tabB').click()")
        pg.evaluate("document.getElementById('loopNeutral').click()")
        c.wait_frames(10, 'neutral B')
        A, B = pg.evaluate(STATE, 'A'), pg.evaluate(STATE, 'B')
        check(B['in1'] == 'wave' and B['in2'] == 'none', f"loop B keeps its main input and drops the second ({B['in1']}, {B['in2']})")
        check(B['trails'] == 0 and B['zoom'] == 0 and B['mirror'] == 0 and B['warp'] == 0 and B['push'] == 0, 'loop B: every effect off')
        check(B['xab'] == 0, 'nothing fed into loop B any more')
        check(A['trails'] == 80 and A['zoom'] == 30 and A['mirror'] == 4 and A['melt'] == 40 and A['in2'] == 'bars', 'loop A is left as it was')
        check(A['xba'] == 30, 'loop A still gets what was fed into it')
        path, lit = c.picture('after_neutral_B')
        check(lit > 1, f'the picture is not black (brightness {lit:.1f})')

        # 2. Autopilot running both loops: neutral A hands A back and keeps Autopilot on B
        pg.evaluate("__plAp.apSet.runs = ['A', 'B']")
        pg.evaluate("document.getElementById('autopilot').click()")
        c.wait_frames(10, 'autopilot on')
        pg.evaluate("__plNeutralLoop('A')")
        c.wait_frames(5, 'neutral A')
        check(pg.evaluate('__plAp.ap.on') and pg.evaluate('__plAp.apSet.runs.join()') == 'B', 'Autopilot keeps running loop B and hands loop A back')
        check(pg.evaluate("document.getElementById('whoA').textContent") == 'YOU', "loop A's tab says YOU")
        pg.evaluate("__plNeutralLoop('B')")
        c.wait_frames(5, 'neutral B again')
        check(not pg.evaluate('__plAp.ap.on'), 'Autopilot stops when its only loop goes neutral')
        pg.evaluate("__plAp.apSet.runs = ['A', 'B']")

        # 3. Spread out controls: each loop's column has its own button
        pg.evaluate(LOOK)
        pg.evaluate("document.getElementById('wideBtn').click()")
        c.wait_frames(10, 'spread out')
        n = pg.evaluate("""() => document.querySelectorAll('.loop-col [data-mid="loopNeutral"]').length""")
        check(n == 2, f'a Neutral this loop button in each loop column ({n})')
        pg.evaluate("""() => document.querySelector(`.loop-col .mirror[data-loop='A'] [data-mid="loopNeutral"]`).click()""")
        c.wait_frames(10, 'neutral A from its column')
        A, B = pg.evaluate(STATE, 'A'), pg.evaluate(STATE, 'B')
        check(A['trails'] == 0 and A['zoom'] == 0 and A['mirror'] == 0 and A['in1'] == 'shape', "loop A's column button sets loop A neutral")
        check(B['trails'] == 70 and B['mirror'] == 6, 'loop B is left as it was')
        pg.screenshot(path=os.path.join(out, 'spread.png'), timeout=60000)
        print('       picture:', os.path.join(out, 'spread.png'))
        b.close()
    for e in errors: problems.append('page error: ' + e)
    print('PASS' if not problems else 'FAIL:\n  ' + '\n  '.join(problems))
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
