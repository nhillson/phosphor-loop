"""Phosphor Loop: checks Fix projector shape (the Output window's four-corner keystone).

  python3 tests/keystone_check.py        (about half a minute; waits by frames, like tests/check.py)

Opens the Output window, turns on Fix projector shape, drags a corner on the Output window itself and nudges one on
the little map under the picture, checks the picture is bent to the corners (each corner of the picture lands where
its dot is), that a shape that would fold over is refused, that the shape is kept for next time and that Reset
puts it square. Takes a picture of the Output window with the test grid. Exit code 0 = passed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loops_check  # noqa: E402

# Where each corner of the Output window's picture actually lands on its screen, after the bend
CORNERS = """() => { const w = window.__plKs.ks.win, cv = w.document.getElementById('out');
  const m = new w.DOMMatrix(w.getComputedStyle(cv).transform === 'none' ? undefined : w.getComputedStyle(cv).transform);
  const W = cv.clientWidth, H = cv.clientHeight;
  return [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => { const p = m.transformPoint(new w.DOMPoint(x, y)); return [p.x / p.w / w.innerWidth, p.y / p.w / w.innerHeight]; }); }"""


def run(c, base, out, problems):
    pg = c.pg
    pg.goto(base + 'index.html', timeout=loops_check.START_CEILING_S * 1000)
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    c.wait_frames(30, 'starting up')

    def expect(ok, what):
        print(('  ok    ' if ok else '  FAIL  ') + what)
        if not ok:
            problems.append(what)

    pg.evaluate("() => localStorage.removeItem('phosphor-keystone')")
    with pg.expect_popup() as pop:
        pg.evaluate("() => document.querySelector('#outBtn').click()")
    w = pop.value
    w.set_viewport_size({'width': 960, 'height': 540})
    c.wait_frames(10, 'Output window open', ceiling=120)
    expect(pg.evaluate("() => !document.querySelector('#ksBtn').hidden"), 'Fix projector shape shows once the Output window is open')
    pg.evaluate("() => document.querySelector('#ksBtn').click()")
    c.wait_frames(3, 'fixing', ceiling=120)
    s = pg.evaluate("""() => { const k = window.__plKs.ks, d = k.win.document;
      return { panel: !document.querySelector('#ksPanel').hidden, dots: [...d.querySelectorAll('.ksdot')].filter((x) => !x.hidden).length,
               grid: !d.querySelector('.ksgrid').hidden, map: document.querySelectorAll('#ksMap .ks-dot').length }; }""")
    expect(s['panel'] and s['map'] == 4, 'the corner map shows under the picture with four dots')
    expect(s['dots'] == 4 and s['grid'], 'the projector shows four dots and the test grid')

    # Drag the top-right dot on the projector itself, in and down (as for a projector off to the right)
    w.mouse.move(960 - 24, 24)   # the dot is kept whole on the screen, just in from the corner
    w.mouse.down()
    w.mouse.move(960 - 24 - 120, 24 + 60, steps=6)
    w.mouse.up()
    c.wait_frames(3, 'dragged', ceiling=120)
    pts = pg.evaluate("() => window.__plKs.ks.pts")
    expect(abs(pts[1][0] - (840 / 960)) < 0.02 and abs(pts[1][1] - (60 / 540)) < 0.02, f'dragging a dot on the projector moves that corner ({[round(v, 3) for v in pts[1]]})')
    got = pg.evaluate(CORNERS)
    expect(all(abs(got[i][j] - pts[i][j]) < 0.01 for i in range(4) for j in range(2)),
           f'the picture is bent so each corner sits on its dot ({[[round(v, 3) for v in p] for p in got]})')

    # Nudge the bottom-left dot on the little map with the arrow keys
    pg.evaluate("() => document.querySelector('#ksMap .ks-dot[data-i=\"3\"]').focus()")
    before = pg.evaluate("() => window.__plKs.ks.pts[3].slice()")
    for _ in range(3):
        pg.keyboard.press('Shift+ArrowRight')
    pg.keyboard.press('ArrowUp')
    c.wait_frames(2, 'nudged', ceiling=120)
    after = pg.evaluate("() => window.__plKs.ks.pts[3].slice()")
    expect(abs((after[0] - before[0]) * 960 - 30) < 1.5 and abs((before[1] - after[1]) * 540 - 1) < 1.5,
           f'arrow keys on the map nudge a corner by pixels of the projector ({before} → {after})')

    # A corner dragged across the picture would turn it inside out: refused
    ok = pg.evaluate("() => window.__plKs.ksMove(0, 1.1, 1.1)")
    expect(ok is False, 'a shape that would fold over is refused')

    c.wait_frames(5, 'picture', ceiling=120)
    w.screenshot(path=os.path.join(out, 'keystone.png'))
    print('  picture:', os.path.join(out, 'keystone.png'))

    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('phosphor-keystone') || 'null')")
    expect(saved is not None and abs(saved[1][0] - pts[1][0]) < 1e-6, 'the shape is kept for next time')
    pg.evaluate("() => document.querySelector('#ksDone').click()")
    c.wait_frames(3, 'done', ceiling=120)
    s = pg.evaluate("""() => { const d = window.__plKs.ks.win.document;
      return { panel: !document.querySelector('#ksPanel').hidden, dots: [...d.querySelectorAll('.ksdot')].filter((x) => !x.hidden).length,
               grid: !d.querySelector('.ksgrid').hidden, bent: d.getElementById('out').style.transform !== '' }; }""")
    expect(not s['panel'] and s['dots'] == 0 and not s['grid'] and s['bent'], 'Done hides the dots and grid, and the picture stays bent')

    # Close and open again: the shape comes back
    pg.evaluate("() => document.querySelector('#outBtn').click()")
    c.wait_frames(5, 'closed', ceiling=120)
    expect(pg.evaluate("() => document.querySelector('#ksBtn').hidden"), 'closing the Output window hides Fix projector shape')
    with pg.expect_popup() as pop:
        pg.evaluate("() => document.querySelector('#outBtn').click()")
    w = pop.value
    w.set_viewport_size({'width': 960, 'height': 540})
    c.wait_frames(5, 'opened again', ceiling=120)
    got = pg.evaluate(CORNERS)
    expect(abs(got[1][0] - pts[1][0]) < 0.01, 'opened again, the picture has the same shape')

    pg.evaluate("() => { document.querySelector('#ksBtn').click(); document.querySelector('#ksReset').click(); }")
    c.wait_frames(3, 'reset', ceiling=120)
    got = pg.evaluate(CORNERS)
    sq = [[0, 0], [1, 0], [1, 1], [0, 1]]
    expect(all(abs(got[i][j] - sq[i][j]) < 0.005 for i in range(4) for j in range(2)) and
           pg.evaluate("() => localStorage.getItem('phosphor-keystone') === null"), 'Reset puts the picture square again')
    pg.evaluate("() => document.querySelector('#outBtn').click()")


loops_check.run = run
if __name__ == '__main__':
    loops_check.main()
