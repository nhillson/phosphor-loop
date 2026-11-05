"""Phosphor Loop: checks Map my boxes (projection mapping onto a stack of boxes, in the Output window).

  python3 tests/boxmap_check.py        (about a minute; waits by frames, like tests/check.py)

Opens the Output window, traces faces (Add a face, dragging a dot and a whole face on the projector itself),
checks that a corner dragged near another face's corner snaps onto it, then Done: the picture shows only inside
the faces (black around them), a Side face is darker than a Top with Depth shading on and the same with it off,
Mapping off shows the whole picture, and the faces come back when the Output window opens again. Takes a
picture of the Output window with the mapping on. Exit code 0 = passed.
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loops_check  # noqa: E402

W, H = 960, 540


def run(c, base, out, problems):
    from PIL import Image
    pg = c.pg
    pg.goto(base + 'index.html', timeout=loops_check.START_CEILING_S * 1000)
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    c.wait_frames(30, 'starting up')

    def expect(ok, what):
        print(('  ok    ' if ok else '  FAIL  ') + what)
        if not ok:
            problems.append(what)

    def open_out():
        with pg.expect_popup() as pop:
            pg.evaluate("() => document.querySelector('#outBtn').click()")
        w = pop.value
        w.set_viewport_size({'width': W, 'height': H})
        w.add_style_tag(content='.hint, .fsx { display: none !important; }')
        c.wait_frames(10, 'Output window open', ceiling=120)
        return w

    def shot(w):
        return Image.open(io.BytesIO(w.screenshot())).convert('L')

    def lit(img, box):
        x0, y0, x1, y1 = [int(v) for v in box]
        from PIL import ImageStat
        return ImageStat.Stat(img.crop((x0, y0, x1, y1))).mean[0]

    pg.evaluate("() => { localStorage.removeItem('phosphor-boxmap'); localStorage.removeItem('phosphor-keystone'); }")
    # A plain, bright picture to look at: Neutral with the test card is busy; full white is simplest to measure
    w = open_out()
    expect(pg.evaluate("() => !document.querySelector('#bmBtn').hidden"), 'Map my boxes shows once the Output window is open')
    pg.evaluate("() => document.querySelector('#bmBtn').click()")
    c.wait_frames(3, 'tracing', ceiling=120)
    s = pg.evaluate("() => ({ panel: !document.querySelector('#bmPanel').hidden, count: document.querySelector('#bmCount').textContent })")
    expect(s['panel'] and 'No faces' in s['count'], f'the panel opens and says how to start (“{s["count"]}”)')
    for _ in range(3):
        pg.evaluate("() => document.querySelector('#bmAdd').click()")
    c.wait_frames(3, 'faces added', ceiling=120)
    n = pg.evaluate("() => window.__plBm.bm.faces.length")
    dots = pg.evaluate("() => [...window.__plBm.bm.dots].filter((d) => !d.hidden).length")
    expect(n == 3 and dots == 4, f'Add a face adds faces, the picked one with four dots on the projector ({n} faces, {dots} dots)')

    # Drag the picked face's top-left dot on the projector
    f = pg.evaluate("() => window.__plBm.bm.faces[2].pts.map((p) => [p[0] * innerWidth, p[1] * innerHeight])")
    p0 = pg.evaluate("() => { const d = window.__plBm.bm.dots[0]; return [parseFloat(d.style.left), parseFloat(d.style.top)]; }")
    w.mouse.move(p0[0], p0[1]); w.mouse.down(); w.mouse.move(p0[0] - 40, p0[1] - 30, steps=5); w.mouse.up()
    c.wait_frames(2, 'dot dragged', ceiling=120)
    q = pg.evaluate("() => window.__plBm.bm.faces[2].pts[0]")
    want = pg.evaluate(f"() => [{p0[0] - 40} / {W}, {p0[1] - 30} / {H}]")
    expect(abs(q[0] - want[0]) < 0.01 and abs(q[1] - want[1]) < 0.01, f'dragging a dot on the projector moves that corner ({[round(v, 3) for v in q]})')

    # Drag face 1 whole, from inside it
    a = pg.evaluate("() => window.__plBm.bm.faces[0].pts.map((p) => p.slice())")
    cx, cy = sum(p[0] for p in a) / 4 * W, sum(p[1] for p in a) / 4 * H
    w.mouse.move(cx, cy); w.mouse.down(); w.mouse.move(cx + 30, cy + 20, steps=5); w.mouse.up()
    c.wait_frames(2, 'face moved', ceiling=120)
    b = pg.evaluate("() => window.__plBm.bm.faces[0].pts")
    moved = all(abs((b[i][0] - a[i][0]) * W - 30) < 2 and abs((b[i][1] - a[i][1]) * H - 20) < 2 for i in range(4))
    sel = pg.evaluate("() => window.__plBm.bm.sel")
    expect(moved and sel == 0, 'clicking a face on the projector picks it, and dragging it moves the whole face')

    # Snapping: face 2's corner dragged near face 1's corner lands exactly on it
    pg.evaluate("""() => { const B = window.__plBm, f0 = B.bm.faces[0], f1 = B.bm.faces[1];
      f0.pts = [[0.10, 0.30], [0.35, 0.30], [0.35, 0.80], [0.10, 0.80]];
      f1.pts = [[0.40, 0.30], [0.62, 0.30], [0.62, 0.80], [0.40, 0.80]];
      B.bmMoveDot(f1, 0, 0.35 + 6 / innerWidth, 0.30 + 5 / innerHeight); }""")
    sn = pg.evaluate("() => window.__plBm.bm.faces[1].pts[0]")
    expect(abs(sn[0] - 0.35) < 1e-9 and abs(sn[1] - 0.30) < 1e-9, f'a corner dragged near another face’s corner snaps onto it ({sn})')
    bad = pg.evaluate("() => { const B = window.__plBm; return B.bmMoveDot(B.bm.faces[1], 0, 0.7, 0.6, false); }")
    expect(bad is False, 'a corner that would make its face’s edges cross is refused')

    # Other shapes: − Corner makes a triangle, never fewer than three; + Corner and double-clicking an edge add corners
    pg.evaluate("() => { const B = window.__plBm; B.bm.sel = 1; B.bm.dot = -1; B.bmDraw(); document.querySelector('#bmDotDel').click(); }")
    n1 = pg.evaluate("() => window.__plBm.bm.faces[1].pts.length")
    off = pg.evaluate("() => { document.querySelector('#bmDotDel').click(); return [window.__plBm.bm.faces[1].pts.length, document.querySelector('#bmDotDel').disabled]; }")
    expect(n1 == 3 and off == [3, True], f'− Corner makes a triangle, and a face never has fewer than three corners ({n1}, then {off})')
    pg.evaluate("() => document.querySelector('#bmDotAdd').click()")
    c.wait_frames(2, 'corner added', ceiling=120)
    n2, dots = pg.evaluate("() => [window.__plBm.bm.faces[1].pts.length, [...window.__plBm.bm.dots].filter((d) => !d.hidden).length]")
    expect(n2 == 4 and dots == 4, f'+ Corner adds a corner, with its dot on the projector ({n2} corners, {dots} dots)')
    # Double-click the middle of the face's bottom edge on the projector
    P = pg.evaluate("() => window.__plBm.bm.faces[1].pts")
    e = max(range(4), key=lambda i: P[i][1] + P[(i + 1) % 4][1])
    mx, my = (P[e][0] + P[(e + 1) % 4][0]) / 2 * W, (P[e][1] + P[(e + 1) % 4][1]) / 2 * H
    w.mouse.dblclick(mx, my + 4)
    c.wait_frames(3, 'double-clicked an edge', ceiling=120)
    n3 = pg.evaluate("() => window.__plBm.bm.faces[1].pts.length")
    fs = w.evaluate("() => !!document.fullscreenElement")
    expect(n3 == 5 and not fs, f'double-clicking an edge on the projector adds a corner there, without going full screen ({n3} corners)')
    # Right-click a dot on the map takes it away
    pg.evaluate("() => document.querySelector('#bmMap .ks-dot[data-i=\"2\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))")
    n4 = pg.evaluate("() => window.__plBm.bm.faces[1].pts.length")
    maps = pg.evaluate("() => document.querySelectorAll('#bmMap .ks-dot').length")
    expect(n4 == 4 and maps == 4, f'right-clicking a dot on the map removes that corner ({n4} corners, {maps} map dots)')
    # A face that bends in (an L shape) is fine; a curve is lots of corners
    ok = pg.evaluate("""() => { const B = window.__plBm; return B.bmSimple([[0.1,0.1],[0.3,0.1],[0.3,0.2],[0.2,0.2],[0.2,0.4],[0.1,0.4]]) &&
      B.bmSimple(Array.from({ length: 40 }, (_, i) => [0.5 + 0.2 * Math.cos(i / 40 * 6.283), 0.5 + 0.3 * Math.sin(i / 40 * 6.283)])); }""")
    expect(ok, 'an L-shaped face and a round one (40 corners) are allowed')

    # Lay out three faces for measuring: a Top (left), a Side (middle), a Front (right); a gap of black between them
    pg.evaluate("""() => { const B = window.__plBm, F = B.bm.faces;
      F[0].pts = [[0.05, 0.2], [0.30, 0.2], [0.30, 0.8], [0.05, 0.8]]; F[0].kind = 'top';
      F[1].pts = [[0.40, 0.2], [0.62, 0.2], [0.62, 0.8], [0.40, 0.8]]; F[1].kind = 'side';
      F[2].pts = [[0.72, 0.2], [0.95, 0.2], [0.95, 0.8], [0.72, 0.8]]; F[2].kind = 'front';
      B.bmDraw(); }""")
    # A bright, even picture so the shading can be measured: everything white
    pg.evaluate("() => { window.__plBm.bm.svg.ownerDocument.getElementById('out').style.background = '#fff'; }")
    w.add_style_tag(content='canvas#out { filter: brightness(0) invert(1); }')
    pg.evaluate("() => document.querySelector('#bmDone').click()")
    c.wait_frames(5, 'mapping on', ceiling=120)
    img = shot(w)
    top, side, front = lit(img, (0.1 * W, 0.3 * H, 0.25 * W, 0.7 * H)), lit(img, (0.45 * W, 0.3 * H, 0.57 * W, 0.7 * H)), lit(img, (0.77 * W, 0.3 * H, 0.9 * W, 0.7 * H))
    gap, edge = lit(img, (0.33 * W, 0.3 * H, 0.37 * W, 0.7 * H)), lit(img, (0, 0, W, 0.12 * H))
    expect(gap < 3 and edge < 3, f'outside the faces is black (between faces {gap:.0f}, above them {edge:.0f})')
    expect(top > 240, f'a Top face shows the picture at full brightness ({top:.0f})')
    expect(side < front < top and side < 170, f'depth shading: Side darker than Front darker than Top ({side:.0f} < {front:.0f} < {top:.0f})')
    expect(pg.evaluate("() => [...window.__plBm.bm.dots].every((d) => d.hidden)"), 'Done hides the dots')

    pg.evaluate("() => { document.querySelector('#bmBtn').click(); document.querySelector('#bmShade').click(); document.querySelector('#bmDone').click(); }")
    c.wait_frames(3, 'shading off', ceiling=120)
    img = shot(w)
    side = lit(img, (0.45 * W, 0.3 * H, 0.57 * W, 0.7 * H))
    expect(side > 240, f'Depth shading off: every face at full brightness (side {side:.0f})')

    pg.evaluate("() => { document.querySelector('#bmBtn').click(); document.querySelector('#bmShade').click(); document.querySelector('#bmOn').click(); document.querySelector('#bmDone').click(); }")
    c.wait_frames(3, 'mapping off', ceiling=120)
    img = shot(w)
    gap = lit(img, (0.33 * W, 0.3 * H, 0.37 * W, 0.7 * H))
    expect(gap > 240, f'Mapping off shows the whole picture again ({gap:.0f})')
    pg.evaluate("() => { document.querySelector('#bmBtn').click(); document.querySelector('#bmOn').click(); document.querySelector('#bmDone').click(); }")

    # The faces are kept: close and open the Output window again
    pg.evaluate("() => document.querySelector('#outBtn').click()")
    c.wait_frames(5, 'closed', ceiling=120)
    expect(pg.evaluate("() => document.querySelector('#bmBtn').hidden"), 'closing the Output window hides Map my boxes')
    w = open_out()
    c.wait_frames(10, 'the real picture', ceiling=120)
    w.screenshot(path=os.path.join(out, 'boxmap.png'))
    print('  picture:', os.path.join(out, 'boxmap.png'))
    w.add_style_tag(content='canvas#out { filter: brightness(0) invert(1); }')
    c.wait_frames(3, 'white', ceiling=120)
    img = shot(w)
    gap, top = lit(img, (0.33 * W, 0.3 * H, 0.37 * W, 0.7 * H)), lit(img, (0.1 * W, 0.3 * H, 0.25 * W, 0.7 * H))
    kinds = pg.evaluate("() => window.__plBm.bm.faces.map((f) => f.kind)")
    expect(gap < 3 and top > 240 and kinds == ['top', 'side', 'front'], f'opened again, the same faces map the picture ({kinds})')

    # A triangle face lights a triangle: inside it lit, the empty corner of its box black
    pg.evaluate("""() => { const B = window.__plBm, F = B.bm.faces; F.length = 1;
      F[0].pts = [[0.2, 0.1], [0.8, 0.9], [0.2, 0.9]]; F[0].kind = 'top'; B.bmDraw(); }""")
    c.wait_frames(3, 'triangle', ceiling=120)
    img = shot(w)
    inside, corner = lit(img, (0.22 * W, 0.7 * H, 0.32 * W, 0.85 * H)), lit(img, (0.65 * W, 0.15 * H, 0.78 * W, 0.35 * H))
    expect(inside > 240 and corner < 3, f'a triangle face lights a triangle (inside {inside:.0f}, beside it {corner:.0f})')
    pg.evaluate("() => document.querySelector('#outBtn').click()")


loops_check.run = run
if __name__ == '__main__':
    loops_check.main()
