"""Stream-friendly check (the stream app's switch, through window.__phosphorCapture.streamFriendly).

Loads the page in the stream app's capture mode, turns Stream-friendly on with Autopilot running, waits by frames
until it has fully glided in, takes a picture, turns it off and waits until it has glided out. Fails on any page
error, a black picture, or the switch not gliding in or out. About a minute.

  python3 tests/stream_calm_check.py
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import patched_index, serve, Check, Stalled, FAIL_FAST_MS  # noqa: E402

RES = 216
GLIDE_FRAMES = 240   # calmK glides in at 0.8 a second: well past 95% by 240 frames at any frame rate here


def main():
    from playwright.sync_api import sync_playwright
    html, _ = patched_index(RES)
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/'
    out = os.path.join(tempfile.gettempdir(), 'phosphor-calm')
    os.makedirs(out, exist_ok=True)
    errors, problems = [], []
    t0 = time.time()
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('CHROME_PATH'),
                              args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.set_default_timeout(FAIL_FAST_MS)
        pg.add_init_script(f'window.__phosphorCaptureConfig = {{ width: 384, height: {RES}, fps: 30, renderHeight: {RES} }};')
        pg.route(lambda u: u.rstrip('/').endswith(f':{port}') or u.split('?')[0].endswith('/index.html'),
                 lambda route: route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
        pg.on('pageerror', lambda e: errors.append(f'page error: {e}'))
        c = Check(pg, out)
        try:
            pg.goto(base + 'index.html', timeout=20000)
            c.wait_frames(30, 'starting up', ceiling=20)
            if not pg.evaluate('!!window.__phosphorCapture?.streamFriendly'):
                problems.append('__phosphorCapture.streamFriendly is missing')
            else:
                pg.evaluate('window.__phosphorCapture.autopilot(); window.__phosphorCapture.streamFriendly(true)')
                c.wait_frames(GLIDE_FRAMES, 'gliding in')
                calm = pg.evaluate('window.__phosphorCapture.calm')
                print(f'  on: {calm}')
                if not calm['on'] or calm['amount'] < 0.9:
                    problems.append(f'Stream-friendly did not glide in ({calm})')
                path, lit = c.picture('stream-friendly-on')
                print(f'  picture: {path} (brightness {lit:.0f})')
                if lit < 3:
                    problems.append('the picture is black with Stream-friendly on')
                pg.evaluate('window.__phosphorCapture.streamFriendly(false)')
                c.wait_frames(GLIDE_FRAMES, 'gliding out')
                calm = pg.evaluate('window.__phosphorCapture.calm')
                print(f'  off: {calm}')
                if calm['on'] or calm['amount'] > 0.1:
                    problems.append(f'Stream-friendly did not glide out ({calm})')
        except Stalled as e:
            problems.append(str(e))
        b.close()
    srv.shutdown()
    problems += errors
    if problems:
        print(f'FAIL after {time.time() - t0:.0f}s:')
        for x in problems:
            print('  -', x)
        sys.exit(1)
    print(f'PASS in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
