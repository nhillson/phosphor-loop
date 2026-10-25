#!/usr/bin/env python3
"""Shapes check (the Shapes section, js/shapes.js).

Adds every kind of shape, solid and wireframe, and takes a picture of each row; a black hole close up, bending
the view and then swallowing the trails; then flings one with the mouse, drops one from Add shape onto the picture,
lets two pull each other together and merge, lets Autopilot add one, and clears them all. Waits by frames, like
tests/check.py. About two minutes. Reaches into the app through window.__plShapes.

  python3 tests/shapes_check.py            pictures go to <temp>/phosphor-shapes
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import (BANNER_JS, FAIL_FAST_MS, START_CEILING_S, Check, Stalled, patched_index, serve)  # noqa: E402

RES = 288
ROWS = [('flat', ['circle', 'triangle', 'square', 'star', 'hexagon'], False),
        ('solid', ['sphere', 'cube', 'pyramid', 'diamond', 'donut', 'planet'], False),
        ('wire', ['sphere', 'cube', 'pyramid', 'diamond', 'donut', 'planet'], True)]
ROW_JS = """([kinds, wire]) => { const S = __plShapes, a = S.shapes.aspect, n = kinds.length;
  S.shapes.list.length = 0;
  kinds.forEach((k, i) => S.addShape((i + 0.5) / n * a * 0.9 - a * 0.45, 0, { kind: k, wire, wander: false, gravity: 25,
    disk: 40, tilt: 70, size: 30, swallow: 0, color: wire ? '#66e0ff' : '#c8643c' }));
  S.shapes.list.forEach((s) => { s.life = 1; }); }"""
ONE_JS = """(o) => { const S = __plShapes; S.shapes.list.length = 0;
  const s = S.addShape(o.x || 0, 0, Object.assign({ wander: false }, o)); s.life = 1; return s.id; }"""
STATE_JS = """() => __plShapes.shapes.list.filter((s) => !s.dying).map((s) => ({ id: s.id, x: s.x, y: s.y, vx: s.vx, vy: s.vy, size: s.size, ap: s.byAp }))"""


def main():
    out = os.path.join(tempfile.gettempdir(), 'phosphor-shapes')
    os.makedirs(out, exist_ok=True)
    from playwright.sync_api import sync_playwright
    html, _ = patched_index(RES)
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/'
    problems, errors = [], []
    t0 = time.time()

    def ok(cond, what):
        if not cond:
            problems.append(what)
        return cond

    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('CHROME_PATH'), args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.set_default_timeout(FAIL_FAST_MS)
        pg.route(lambda u: u.rstrip('/').endswith(f':{port}') or u.split('?')[0].endswith('/index.html'),
                 lambda route: route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
        pg.on('pageerror', lambda e: errors.append(f'page error: {e}'))
        pg.on('console', lambda m: errors.append(f'console error: {m.text}')
              if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        c = Check(pg, out)

        def client(x, y):
            """Where a spot on the picture (screen heights from the middle) is on the page."""
            r = pg.evaluate("() => { const b = document.getElementById('screen').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }")
            a = pg.evaluate('__plShapes.shapes.aspect')
            return r[0] + (x / a + 0.5) * r[2], r[1] + (0.5 - y) * r[3]

        try:
            pg.goto(base + 'index.html', timeout=START_CEILING_S * 1000)
            pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
            c.wait_frames(30, 'starting up', ceiling=START_CEILING_S)
            pg.evaluate("() => { const b = document.querySelector('#h-shapes'); const t = b && b.closest('.group-toggle'); if (t && t.getAttribute('aria-expanded') === 'false') t.click(); }")
            ok(pg.is_visible('#shapeAdd'), 'the Shapes section is not showing')
            ok(pg.is_disabled('#shapeClear'), 'Clear all shapes is usable with no shapes')
            # 1. Every kind, in rows
            for name, kinds, wire in ROWS:
                pg.evaluate(ROW_JS, [kinds, wire])
                c.wait_frames(60, f'{name} shapes')
                path, lit = c.picture('shapes-' + name)
                print(f'  {name} row: {path}  (brightness {lit:.0f})')
                ok(lit > 3, f'{name} row: black picture')
            # 2. A black hole close up: bending the view, then swallowing the trails
            for name, sw in [('lens', 0), ('swallow', 100)]:
                pg.click('#clear')
                pg.evaluate(ONE_JS, {'kind': 'sphere', 'color': '#0a0a0c', 'gravity': 85, 'disk': 70, 'tilt': 80, 'size': 55, 'swallow': sw})
                c.wait_frames(120, f'black hole, {name}')
                path, lit = c.picture('shapes-blackhole-' + name)
                print(f'  black hole, {name}: {path}  (brightness {lit:.0f})')
                ok(lit > 3, f'black hole {name}: black picture')
            ok(pg.is_enabled('#shapeClear') and pg.is_enabled('#shapeRemove'), 'Remove / Clear all shapes not usable with a shape picked')
            # 3. Fling: a shape left where it's put, dragged fast and let go, flies on past where it was let go
            pg.evaluate(ONE_JS, {'kind': 'cube', 'size': 40, 'gravity': 20, 'disk': 0, 'x': -0.3})
            x0, y0 = client(-0.3, 0)
            pg.mouse.move(x0, y0)
            pg.mouse.down()
            c.wait_frames(1, 'picked up')
            pg.mouse.move(x0 + 150, y0 - 36, steps=6)   # a quick flick, as a hand would
            pg.mouse.up()
            at = pg.evaluate(STATE_JS)[0]
            c.wait_frames(10, 'flung')
            now = pg.evaluate(STATE_JS)[0]
            print(f'  fling: let go at x {at["x"]:.2f}, moving {at["vx"]:.2f} a second; 10 frames later at x {now["x"]:.2f}')
            ok(at['x'] > -0.2, f'dragging did not move the shape (it is at x {at["x"]:.2f})')
            ok(at['vx'] > 0.2 and now['x'] > at['x'] + 0.02, 'the shape did not fly on after being let go')
            # 4. Drag Add shape onto the picture: it lands where it's let go
            pg.click('#shapeClear')
            c.wait_frames(15, 'cleared')
            ok(pg.evaluate(STATE_JS) == [], 'Clear all shapes left shapes behind')
            ok(pg.evaluate('__plShapes.shapes.list.length') == 0, 'cleared shapes did not fade away')
            pg.click('#shapeMove button[data-wander="0"]')
            pg.locator('#shapeAdd').scroll_into_view_if_needed()
            bb = pg.locator('#shapeAdd').bounding_box()
            pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
            pg.mouse.down()
            tx, ty = client(0.2, 0.15)
            pg.mouse.move(tx, ty, steps=8)
            pg.mouse.up()
            st = pg.evaluate(STATE_JS)
            ok(len(st) == 1 and abs(st[0]['x'] - 0.2) < 0.03 and abs(st[0]['y'] - 0.15) < 0.03,
               f'dropped shape is not where it was let go: {st}')
            pg.click('#shapeAdd')
            ok(len(pg.evaluate(STATE_JS)) == 2, 'clicking Add shape did not add one')
            # 5. Two wandering shapes close together pull each other in and merge into one bigger one
            pg.evaluate("""() => { const S = __plShapes; S.shapes.list.length = 0;
              for (const x of [-0.12, 0.12]) { const s = S.addShape(x, 0, { wander: true, gravity: 100, size: 40, kind: 'sphere' }); s.life = 1; } }""")
            start = c.frames()
            pg.wait_for_function(f'__plShapes.shapes.count === 1 || window.__plFrames > {start + 300}', polling=100, timeout=120000)
            st = pg.evaluate(STATE_JS)
            print(f'  merge: {len(st)} shape(s) after {c.frames() - start} frames' + (f', size {st[0]["size"]:.0f} (from 40)' if len(st) == 1 else ''))
            ok(len(st) == 1 and st[0]['size'] > 40, 'two shapes pulling on each other did not merge into a bigger one')
            # 6. Autopilot adds one of its own
            pg.click('#shapeClear')
            pg.click('#autopilot')
            pg.evaluate('__plShapes.apSoon()')
            c.wait_frames(5, 'autopilot')
            st = pg.evaluate(STATE_JS)
            ok(len(st) == 1 and st[0]['ap'], f'Autopilot did not add a shape: {st}')
            pg.click('#autopilot')
            pg.click('#shapeClear')
            c.wait_frames(15, 'cleared again')
            ok(pg.evaluate('__plShapes.shapes.list.length') == 0, 'shapes left after the last Clear all shapes')
        except Stalled as e:
            problems.append(str(e))
        banner = pg.evaluate(BANNER_JS)
        if banner:
            problems.insert(0, f'error message on screen: {banner}')
        b.close()
    srv.shutdown()
    problems += errors
    if problems:
        print(f'FAIL after {time.time() - t0:.0f}s:')
        for x in dict.fromkeys(problems):
            print('  -', x)
        sys.exit(1)
    print(f'PASS in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
