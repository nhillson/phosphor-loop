"""Phosphor Loop quick check, for Claude's workspace (no graphics chip there, so it runs at low resolution).

Every wait is a number of frames the app has drawn, never a number of seconds. Each wait also has a
ceiling, and a page that stops drawing ends the check at once, so a broken build fails in seconds.

  python3 tests/check.py                       safety check: loads, draws, no errors, picture not black,
                                               then a quick workout (Surprise, Autopilot, Neutral, tabs, Clear)
  python3 tests/check.py --shot "Marbled"      also takes a picture of a Guide recipe after --frames frames
  python3 tests/check.py --shot "Currents|push=0|view=50"   ...with sliders changed after the recipe

Options: --frames N (frames before each picture, default 120), --res H (test picture height, default 216),
--out DIR (where pictures go, default <temp>/phosphor-check), --skip-workout.
PL_ROOT=/some/folder checks a copy of the site somewhere else. Exit code 0 = passed.
Needs Python Playwright and Pillow (both pre-installed in Claude's workspace).
"""
import argparse
import base64
import functools
import http.server
import os
import socketserver
import sys
import tempfile
import threading
import time

ROOT = os.environ.get('PL_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAIL_FAST_MS = 5000      # any single click or lookup gives up after this
START_CEILING_S = 20     # the first frames must come within this long
FRAME_CEILING_S = 1.0    # later frame waits give up after 10 s plus this much per frame asked for

# Copies the picture straight off the screen canvas right after the app draws a frame: much faster than a
# screenshot of the page, and exactly what the canvas shows
GRAB_JS = """() => new Promise((res) => requestAnimationFrame(() => {
  const s = document.getElementById('screen'), c = document.createElement('canvas');
  c.width = s.width; c.height = s.height;
  c.getContext('2d').drawImage(s, 0, 0);
  res(c.toDataURL('image/png'));
}))"""
BANNER_JS = "() => { const m = document.getElementById('msg'); return m && !m.hidden ? m.textContent : ''; }"
SLIDER_JS = """([id, v]) => { const el = document.getElementById(id); if (!el) throw new Error('no slider called ' + id);
  el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); }"""
RECIPE_JS = """(n) => { const a = [...document.querySelectorAll('.g-recipe')].find(x => x.querySelector('h3').textContent === n);
  const b = a && a.querySelector('button'); if (!b) return false; b.click(); return true; }"""
WORKOUT = [('#surprise', 10), ('#surprise', 10), ('#autopilot', 20), ('#autopilot', 3),
           ('#neutral', 5), ('#tabB', 3), ('#tabA', 3), ('#clear', 5)]


class Stalled(Exception):
    pass


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def patched_index(res):
    """The page as served to the test: smaller picture, and a frame counter at the top of frame()."""
    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
        html = f.read()
    notes = []
    if 'const SIM_H = 576;' in html:
        html = html.replace('const SIM_H = 576;', f'const SIM_H = {res};', 1)
    else:
        notes.append('could not lower the test resolution (the SIM_H line changed), so this ran at full size')
    if 'function frame() {' not in html:
        sys.exit('FAIL: could not find function frame() to count frames; tests/check.py needs updating')
    html = html.replace('function frame() {', 'function frame() { window.__plFrames = (window.__plFrames || 0) + 1;', 1)
    return html, notes


class Check:
    def __init__(self, pg, out):
        self.pg, self.out = pg, out

    def frames(self):
        return self.pg.evaluate('window.__plFrames || 0')

    def wait_frames(self, n, what, ceiling=None):
        """Wait until the app has drawn n more frames. Returns frames a second."""
        start = self.frames()
        t = time.time()
        try:
            self.pg.wait_for_function(f'(window.__plFrames || 0) >= {start + n}', polling=100,
                                      timeout=int((ceiling or 10 + n * FRAME_CEILING_S) * 1000))
        except Exception:
            raise Stalled(f'{what}: the page stopped drawing ({self.frames() - start} of {n} frames came)')
        return n / max(time.time() - t, 1e-3)

    def picture(self, name):
        from PIL import Image, ImageStat
        path = os.path.join(self.out, name + '.png')
        data = self.pg.evaluate(GRAB_JS)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(data.split(',', 1)[1]))
        return path, ImageStat.Stat(Image.open(path).convert('L')).mean[0]


def run(c, a, base, problems):
    pg = c.pg
    # 1. It loads and draws
    pg.goto(base + 'index.html')
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    t = time.time()
    c.wait_frames(30, 'starting up', ceiling=START_CEILING_S)
    print(f'  drawing within {time.time() - t:.0f}s')
    # 2. The picture isn't black
    fps = c.wait_frames(30, 'warming up')
    _, light = c.picture('start')
    if light < 3:
        problems.append(f'the picture is black (brightness {light:.1f} of 255)')
    # 3. A quick workout through the main buttons
    if not a.skip_workout:
        for sel, n in WORKOUT:
            try:
                pg.click(sel)
            except Exception as e:
                problems.append(f'could not press {sel}: {str(e).splitlines()[0]}')
                continue
            c.wait_frames(n, f'after pressing {sel}')
    # 4. Pictures of Guide recipes, each after a set number of frames
    for spec in a.shot:
        name, *sets = spec.split('|')
        if not pg.evaluate(RECIPE_JS, name):
            problems.append(f'no Guide recipe called "{name}"')
            continue
        for kv in sets:
            k, v = kv.split('=')
            pg.evaluate(SLIDER_JS, [k.strip(), float(v)])
        pg.click('#clear')
        shot_fps = c.wait_frames(a.frames, f'recipe {name}')
        fname = '_'.join([name.replace(' ', '_').replace('/', '-')] + [s.replace('=', '') for s in sets])
        path, lit = c.picture(fname)
        print(f'  picture: {path}  ({a.frames} frames at {shot_fps:.1f} a second, brightness {lit:.0f})')
    return fps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', type=int, default=120)
    ap.add_argument('--res', type=int, default=216)
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'phosphor-check'))
    ap.add_argument('--shot', action='append', default=[])
    ap.add_argument('--skip-workout', action='store_true')
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright

    html, notes = patched_index(a.res)
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/'
    errors, problems = [], []
    t_start = time.time()
    os.makedirs(a.out, exist_ok=True)
    fps = 0
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.set_default_timeout(FAIL_FAST_MS)
        pg.route(lambda u: u.rstrip('/').endswith(f':{port}') or u.split('?')[0].endswith('/index.html'),
                 lambda route: route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
        # Fonts or files the workspace can't download aren't the app's fault; anything else is
        pg.on('pageerror', lambda e: errors.append(f'page error: {e}'))
        pg.on('console', lambda m: errors.append(f'console error: {m.text}')
              if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        try:
            fps = run(Check(pg, a.out), a, base, problems)
        except Stalled as e:
            problems.append(str(e))
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
    took = time.time() - t_start
    if problems:
        print(f'FAIL after {took:.0f}s:')
        for x in dict.fromkeys(problems):
            print('  -', x)
        sys.exit(1)
    print(f'PASS in {took:.0f}s (test picture {a.res} high, about {fps:.1f} frames a second here)')


if __name__ == '__main__':
    main()
