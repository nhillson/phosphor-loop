"""Phosphor Loop: checks for 3 and 4 loops and the column-per-loop Spread out controls.

  python3 tests/loops_check.py            (about a minute; waits by frames, like tests/check.py)

Turns on 4 loops, shows only loop C to see it draws, spreads the controls out, changes loop C and loop D from
their own columns and checks only that loop changed, checks the column layout at two screen widths, runs
Autopilot with four loops, and goes back to 2 loops and the sidebar. Saves a page picture of the columns to
<temp>/phosphor-check/. Exit code 0 = passed.
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import Check, Stalled, patched_index, serve, FAIL_FAST_MS, START_CEILING_S, BANNER_JS, SLIDER_JS  # noqa: E402

MIRROR = "(k) => document.querySelector(`.loop-col .mirror[data-loop='${k}']`)"
PRESSED = """([k, src]) => { const m = document.querySelector(`.loop-col .mirror[data-loop='${k}']`);
  const b = m && m.querySelector(`button[data-src='${src}']`); return b ? b.getAttribute('aria-pressed') : null; }"""
ZOOM_TEXT = """(k) => { const m = document.querySelector(`.loop-col .mirror[data-loop='${k}']`);
  const o = m && m.querySelector("output[data-mid='zoomOut']"); return o ? o.textContent : null; }"""
SET_MIRROR_SLIDER = """([k, id, v]) => { const m = document.querySelector(`.loop-col .mirror[data-loop='${k}']`);
  const el = m.querySelector(`input[data-mid='${id}']`); el.focus(); el.value = v;
  el.dispatchEvent(new Event('input', {bubbles: true})); el.blur(); }"""
CLICK_MIRROR = """([k, sel]) => { const m = document.querySelector(`.loop-col .mirror[data-loop='${k}']`);
  m.querySelector(sel).click(); }"""
LAYOUT = """() => { const r = document.querySelector('.wide-cols'); if (!r) return null;
  return { cols: r.children.length, per: r.dataset.per, loops: document.querySelectorAll('.loop-col').length,
           firstHasSound: !!r.children[0].querySelector('#soundGroup'), firstHasLoops: !!r.children[0].querySelector('#h-mix'),
           realHidden: getComputedStyle(document.getElementById('editor')).display === 'none' }; }"""


def run(c, base, out, problems):
    pg = c.pg
    pg.goto(base + 'index.html', timeout=START_CEILING_S * 1000)
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    c.wait_frames(30, 'starting up', ceiling=START_CEILING_S)

    def expect(ok, what):
        print(('  ok    ' if ok else '  FAIL  ') + what)
        if not ok:
            problems.append(what)

    # Four loops
    pg.click('#loopCount button[data-n="4"]')
    c.wait_frames(10, '4 loops')
    expect(pg.is_visible('#tabC') and pg.is_visible('#tabD'), 'tabs for loops C and D show')
    expect(pg.is_visible('#showC') and pg.is_visible('#showD') and pg.is_visible('#xc') and pg.is_visible('#xd'),
           'Show and Feed faders for C and D show')
    # Only loop C on screen: it must draw something
    for k, v in (('showA', 0), ('showB', 0), ('showD', 0), ('showC', 100)):
        pg.evaluate(SLIDER_JS, [k, v])
    pg.click('#clear')
    c.wait_frames(40, 'loop C alone')
    _, lit = c.picture('loop-C-alone')
    expect(lit > 3, f'loop C on its own draws a picture (brightness {lit:.0f})')
    pg.evaluate(SLIDER_JS, ['showA', 100])

    # Spread out controls at 1920 wide: column one, then two loops to a column
    pg.click('#wideBtn')
    c.wait_frames(10, 'spread out')
    L = pg.evaluate(LAYOUT)
    print('  layout at 1920:', L)
    expect(bool(L) and L['loops'] == 4, 'a column section for each of the 4 loops')
    expect(bool(L) and L['firstHasLoops'] and L['firstHasSound'], 'Loops and React to sound are in column one')
    expect(bool(L) and L['realHidden'], 'the sidebar loop settings are hidden while spread out')

    # Change loop C from its own column, and loop D's zoom from its column
    pg.evaluate(CLICK_MIRROR, ['C', "button[data-src='ink']"])
    c.wait_frames(5, 'ink on C')
    pg.evaluate(SET_MIRROR_SLIDER, ['D', 'zoom', 77])
    c.wait_frames(5, 'zoom on D')
    expect(pg.evaluate(PRESSED, ['C', 'ink']) == 'true', "loop C's column shows Ink chosen")
    expect(pg.evaluate(PRESSED, ['A', 'ink']) == 'false' and pg.evaluate(PRESSED, ['D', 'ink']) == 'false',
           "loops A and D didn't get Ink")
    expect(pg.evaluate(ZOOM_TEXT, 'D') == 'IN 77', f"loop D's zoom reads IN 77 ({pg.evaluate(ZOOM_TEXT, 'D')})")
    expect(pg.evaluate(ZOOM_TEXT, 'A') != 'IN 77', "loop A's zoom is unchanged")
    # The sidebar tabs agree once spread out is off again (checked below)
    pg.screenshot(path=os.path.join(out, 'spread-4-loops-1920.png'), timeout=60000)
    print('  picture:', os.path.join(out, 'spread-4-loops-1920.png'))

    # Wider screen: a column per loop
    pg.set_viewport_size({'width': 2560, 'height': 1080})
    c.wait_frames(5, 'wider')
    L = pg.evaluate(LAYOUT)
    print('  layout at 2560:', L)
    expect(bool(L) and L['per'] == '1' and L['cols'] == 5, 'at 2560 wide, one column per loop (5 columns)')
    pg.screenshot(path=os.path.join(out, 'spread-4-loops-2560.png'), timeout=60000)
    pg.set_viewport_size({'width': 1920, 'height': 1080})
    c.wait_frames(5, 'back to 1920')
    L = pg.evaluate(LAYOUT)
    expect(bool(L) and L['per'] == '2' and L['cols'] == 3, f'at 1920 wide, two loops to a column (3 columns) {L}')

    # Two loops: at 1920 that fits a column each
    pg.click('#loopCount button[data-n="2"]')
    c.wait_frames(5, '2 loops')
    L = pg.evaluate(LAYOUT)
    expect(bool(L) and L['loops'] == 2 and L['per'] == '1', f'2 loops: two loop columns, one each {L}')
    pg.screenshot(path=os.path.join(out, 'spread-2-loops-1920.png'), timeout=60000)
    pg.click('#loopCount button[data-n="4"]')
    c.wait_frames(5, '4 loops again')

    # Autopilot with four loops for a while, with loop D left to you (so its zoom must stay as set)
    pg.evaluate("() => document.querySelector(`#apLoops [data-aploop='D']`).click()")
    pg.click('#autopilotBar')
    c.wait_frames(60, 'Autopilot with 4 loops')
    pg.click('#autopilotBar')
    c.wait_frames(5, 'Autopilot off')

    # Back to the sidebar: the tabs are back and loop D still has its zoom
    pg.click('#wideBtn')
    c.wait_frames(5, 'sidebar')
    expect(pg.evaluate("() => !document.querySelector('.wide-cols')") and pg.is_visible('#editor'), 'sidebar is back')
    pg.click('#tabD')
    c.wait_frames(3, 'tab D')
    expect(pg.text_content('#zoomOut') == 'IN 77', f"tab D shows loop D's zoom ({pg.text_content('#zoomOut')})")
    pg.evaluate("() => document.querySelector(`#apLoops [data-aploop='D']`).click()")
    pg.click('#loopCount button[data-n="2"]')
    c.wait_frames(5, 'back to 2')
    expect(not pg.is_visible('#tabC') and pg.get_attribute('#editor', 'data-loop') == 'A', 'back to 2 loops, editing loop A')
    _, lit = c.picture('end')
    expect(lit > 3, f'picture still showing at the end (brightness {lit:.0f})')


def main():
    from playwright.sync_api import sync_playwright
    out = os.path.join(tempfile.gettempdir(), 'phosphor-check')
    os.makedirs(out, exist_ok=True)
    html, notes = patched_index(216)
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/'
    errors, problems = [], []
    t0 = time.time()
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1920, 'height': 1080})
        pg.set_default_timeout(FAIL_FAST_MS)
        pg.route(lambda u: u.rstrip('/').endswith(f':{port}') or u.split('?')[0].endswith('/index.html'),
                 lambda route: route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
        pg.on('pageerror', lambda e: errors.append(f'page error: {e}'))
        pg.on('console', lambda m: errors.append(f'console error: {m.text}')
              if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        try:
            run(Check(pg, out), base, out, problems)
        except Stalled as e:
            problems.append(str(e))
        except Exception as e:
            problems.append(f'test stopped: {str(e).splitlines()[0]}')
        try:
            banner = pg.evaluate(BANNER_JS)
        except Exception:
            banner = ''
        if banner:
            problems.insert(0, f'error message on screen: {banner}')
        b.close()
    srv.shutdown()
    for n in notes:
        print('note:', n)
    problems += errors
    if problems:
        print(f'FAIL after {time.time() - t0:.0f}s:')
        for x in dict.fromkeys(problems):
            print('  -', x)
        sys.exit(1)
    print(f'PASS in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
