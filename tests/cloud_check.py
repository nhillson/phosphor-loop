"""The Point cloud (js/pointcloud.js; glue under "point cloud" in js/app.js): the Point cloud input and its Dots of
choices, dragging the dots, Explode, the whole picture as dots, Neutral, presets and Autopilot's Use Point cloud switch.

  python3 tests/cloud_check.py      (about 2 minutes)

Reaches into the app through window.__plCloud. Every wait is a number of frames the app has drawn.
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402

CLICK = "(s) => { const el = document.querySelector(s); if (!el) throw new Error('no ' + s); el.click(); }"
# A drag across the middle of the picture, one step a frame, from a page script
DRAG = """(step) => { const c = document.getElementById('screen'), r = c.getBoundingClientRect();
  const x = r.left + r.width * (0.3 + 0.02 * step), y = r.top + r.height * 0.5;
  const type = step === 0 ? 'pointerdown' : step < 0 ? 'pointerup' : 'pointermove';
  c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: step < 0 ? 0 : 1 })); }"""


def diff(a, b):
    from PIL import Image, ImageChops, ImageStat
    return ImageStat.Stat(ImageChops.difference(Image.open(a).convert('L'), Image.open(b).convert('L'))).mean[0]


def run(c, base, problems):
    pg = c.pg
    pg.goto(base + 'index.html', timeout=check.START_CEILING_S * 1000)
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    c.wait_frames(20, 'starting')
    ok = lambda cond, what: None if cond else problems.append(what)

    # The input
    pg.evaluate(CLICK, '#inputs [data-src="cloud"]')
    c.wait_frames(15, 'Point cloud input')
    ok(pg.evaluate("document.querySelector('#inputs [data-src=\"cloud\"]').getAttribute('aria-pressed')") == 'true', 'the Point cloud button is not lit')
    ok(pg.evaluate('!!__plCloud.cloudSt.A'), 'loop A has no dots after picking Point cloud')
    ok(not pg.evaluate("document.getElementById('row-cloud').hidden"), 'Dots of is not showing')
    ok(not pg.evaluate("document.getElementById('row-picture').hidden"), 'the Picture controls are not showing for dots of the picture')
    p1, light = c.picture('cloud-input')
    ok(light > 3, f'the dots are black (brightness {light:.1f})')
    print(f'  input: brightness {light:.1f}')

    # Its card is in the Effect stack (under Whole picture) while a loop uses the input, and opening it shows the controls
    card = "[...document.querySelectorAll('#stkList .stk-item')].find(x => x.querySelector('.stk-name').textContent.startsWith('Point cloud'))"
    c.wait_frames(6, 'the stack catching up')
    ok(pg.evaluate(f"!!{card} && {card}.dataset.z === 'all'"), 'no Point cloud card under Whole picture in the stack')
    pg.evaluate(f"{card}.querySelector('.stk-name').click()")
    c.wait_frames(3, 'opening the card')
    ok(pg.evaluate(f"!!{card}.querySelector('#cWind') && !!{card}.querySelector('#cloudRecipes')"), 'the Point cloud card does not hold its controls')
    ok(pg.evaluate("getComputedStyle(document.getElementById('cloudGroup')).display") == 'none', 'the separate Point cloud section still shows with the stack')
    pg.evaluate(f"{card}.querySelector('.stk-name').click()")
    c.wait_frames(3, 'closing the card')

    # Dots of the other loop
    pg.evaluate(CLICK, '#cloudOf [data-v="loop"]')
    c.wait_frames(15, 'dots of the other loop')
    ok(pg.evaluate("__plCloud && document.querySelector('#cloudOf [data-v=\"loop\"]').getAttribute('aria-pressed')") == 'true', 'Other loop is not lit under Dots of')
    _, light = c.picture('cloud-of-loop')
    ok(light > 1, f'dots of the other loop are black (brightness {light:.1f})')
    pg.evaluate(CLICK, '#cloudOf [data-v="picture"]')
    c.wait_frames(10, 'back to the picture')

    # Dragging pushes the dots (and doesn't draw)
    pg.evaluate("__plCloud.setCloud({ ...__plCloud.cloud, cMode: 'push', cBrush: 40, cSway: 0 })")
    c.wait_frames(10, 'settling')
    before, _ = c.picture('cloud-before-drag')
    for i in range(0, 12):
        pg.evaluate(DRAG, i)
        if i == 3:
            ok(pg.evaluate('__plCloud.ptr.down'), 'the dots did not take the drag')
        c.wait_frames(1, 'dragging')
    after, _ = c.picture('cloud-drag')
    pg.evaluate(DRAG, -1)
    ok(not pg.evaluate('__plCloud.ptr.down'), 'letting go did not let go of the dots')
    d = diff(before, after)
    print(f'  drag changed the picture by {d:.1f}')
    ok(d > 1.5, f'dragging hardly moved the dots ({d:.1f})')

    # Explode, then they come back
    pg.evaluate(CLICK, '#cloudBoom')
    c.wait_frames(6, 'explode')
    boom, _ = c.picture('cloud-explode')
    ok(diff(before, boom) > 2, 'Explode hardly changed the picture')
    c.wait_frames(120, 'coming back')
    back, _ = c.picture('cloud-back')
    print(f'  explode {diff(before, boom):.1f}, after coming back {diff(before, back):.1f}')

    # The whole picture as dots
    pg.evaluate(CLICK, '#inputs [data-src="wave"]')
    pg.evaluate(check.SLIDER_JS, ['cAmt', 100])
    c.wait_frames(15, 'whole picture as dots')
    ok(pg.evaluate('!!__plCloud.cloudSt.final'), 'no whole-picture dots at Amount 100')
    c.wait_frames(10, 'loop A lets go')
    ok(not pg.evaluate('__plCloud.cloudSt.A'), 'loop A kept its dots after leaving the Point cloud input')
    _, light = c.picture('cloud-whole')
    ok(light > 1, f'the whole picture as dots is black ({light:.1f})')

    # Presets keep it; Neutral turns it off
    snap = pg.evaluate("__plCloud.setCloud({ ...__plCloud.cloud, cAmt: 70, cColor: 3, cWind: 40 }), __plCloud.snap()")
    ok(snap.get('cloud', {}).get('cAmt') == 70, 'a preset did not keep the point cloud')
    pg.evaluate(CLICK, '#neutral')
    c.wait_frames(5, 'neutral')
    ok(pg.evaluate('__plCloud.cloud.cAmt') == 0, 'Neutral left the whole-picture dots on')
    pg.evaluate('(d) => __plCloud.load(d)', snap)
    c.wait_frames(5, 'preset')
    got = pg.evaluate('({ a: __plCloud.cloud.cAmt, c: __plCloud.cloud.cColor, w: __plCloud.cloud.cWind })')
    ok(got == {'a': 70, 'c': 3, 'w': 40}, f'loading the preset gave {got}')
    # An old preset (no cloud) turns the dots off
    old = {k: v for k, v in snap.items() if k != 'cloud'}
    pg.evaluate('(d) => __plCloud.load(d)', old)
    ok(pg.evaluate('__plCloud.cloud.cAmt') == 0, 'an older preset left the dots on')

    # Recipe chips and Autopilot's switch
    pg.evaluate("[...document.querySelectorAll('#cloudRecipes button')].find(b => b.textContent === 'Sandstorm').click()")
    c.wait_frames(5, 'recipe')
    ok(pg.evaluate('__plCloud.cloud.cAmt') == 100 and pg.evaluate('__plCloud.cloud.cDissolve') == 55, 'the Sandstorm recipe did not set things up')
    pg.evaluate(CLICK, '#apCloud')
    ok(pg.evaluate("document.getElementById('apCloud').getAttribute('aria-pressed')") == 'true', 'Use Point cloud did not light')
    pg.evaluate(CLICK, '#apCloud')
    _, light = c.picture('cloud-sandstorm')
    print(f'  sandstorm brightness {light:.1f}')


def main():
    from playwright.sync_api import sync_playwright
    html, notes = check.patched_index(216)
    srv, port = check.serve()
    base = f'http://127.0.0.1:{port}/'
    out = os.path.join(tempfile.gettempdir(), 'phosphor-cloud')
    os.makedirs(out, exist_ok=True)
    errors, problems = [], []
    t0 = time.time()
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('CHROME_PATH'), args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.set_default_timeout(check.FAIL_FAST_MS)
        pg.add_init_script(check.WINDOWS_LIMITS_JS)
        pg.route(lambda u: u.rstrip('/').endswith(f':{port}') or u.split('?')[0].endswith('/index.html'),
                 lambda route: route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
        pg.on('pageerror', lambda e: errors.append(f'page error: {e}'))
        pg.on('console', lambda m: errors.append(f'console error: {m.text}')
              if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        try:
            run(check.Check(pg, out), base, problems)
        except check.Stalled as e:
            problems.append(str(e))
        except Exception as e:
            problems.append(f'test stopped: {str(e).splitlines()[0]}')
        b.close()
    srv.shutdown()
    problems += errors
    if problems:
        print(f'FAIL after {time.time() - t0:.0f}s:')
        for x in dict.fromkeys(problems):
            print('  -', x)
        sys.exit(1)
    print(f'PASS in {time.time() - t0:.0f}s (pictures in {out})')


if __name__ == '__main__':
    main()
