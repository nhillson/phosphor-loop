#!/usr/bin/env python3
"""Subject silhouette check (Inputs › Subject silhouette, js/subject.js).

Puts tests/media/person.webm (a man in a yoga pose, from MediaPipe's own test pictures; the sky between his legs counts as middle) in as loop A's Video
input, then tries Shadow, Glow and Cutout. Each must find the man (a plausible share of the picture, more in the
middle than at the edges) and get its picture into the loop. Waits by frames, like tests/check.py. About a minute.

  python3 tests/subject_check.py            pictures go to /tmp/phosphor-subject
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import (BANNER_JS, FAIL_FAST_MS, START_CEILING_S, Check, Stalled, patched_index, serve)  # noqa: E402

CLIP = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'media', 'person.webm')
LOAD_FRAMES = 600     # the finder (about 11 MB) loads within this many frames
# How much of the picture the finder says is the man, and how much more of him is in the middle than at the edges
MASK_JS = """() => {
  const vid = __plSubject.vid, c = vid.cutter && vid.cutter.white; if (!c || !vid.cutter.ready) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height;
  let all = 0, mid = 0, edge = 0, nm = 0, ne = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = d[(y * w + x) * 4 + 3] / 255; all += a;
    if (Math.abs(x / w - 0.5) < 0.15 && y / h > 0.35 && y / h < 0.8) { mid += a; nm++; }
    else if (x / w < 0.1 || x / w > 0.9) { edge += a; ne++; }
  }
  return { share: all / (w * h), mid: mid / nm, edge: edge / ne };
}"""


def main():
    out = os.path.join(tempfile.gettempdir(), 'phosphor-subject')
    os.makedirs(out, exist_ok=True)
    from playwright.sync_api import sync_playwright
    html, _ = patched_index(216)
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/'
    problems, errors = [], []
    t0 = time.time()

    def ok(cond, what):
        if not cond:
            problems.append(what)
        return cond

    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('CHROME_PATH'), args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                    '--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.set_default_timeout(FAIL_FAST_MS)
        pg.route(lambda u: u.rstrip('/').endswith(f':{port}') or u.split('?')[0].endswith('/index.html'),
                 lambda route: route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
        pg.on('pageerror', lambda e: errors.append(f'page error: {e}'))
        pg.on('console', lambda m: errors.append(f'console error: {m.text}')
              if m.type == 'error' and 'Failed to load resource' not in m.text and not m.text.startswith('INFO:') and 'ERR_' not in m.text else None)
        c = Check(pg, out)
        try:
            pg.goto(base + 'index.html', timeout=START_CEILING_S * 1000)
            pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
            c.wait_frames(20, 'starting up', ceiling=START_CEILING_S)
            pg.set_input_files('#vidFile', CLIP)
            pg.wait_for_function('__plSubject.vid.on && __plSubject.loops.A.tgt.in1 === "video"')
            ok(pg.is_visible('#subjectCtl'), 'the Subject silhouette control is not showing with Video chosen')
            c.wait_frames(10, 'video playing')
            c.picture('subject-off')
            for mode in ['shadow', 'glow', 'cutout']:
                pg.click(f'#subject button[data-subject="{mode}"]')
                ok(pg.get_attribute(f'#subject button[data-subject="{mode}"]', 'aria-pressed') == 'true',
                   f'{mode} button did not light up')
                start = c.frames()
                pg.wait_for_function(f'(__plSubject.vid.sub.{mode} && __plSubject.vid.sub.{mode}.frames >= 3) || window.__plFrames > {start + LOAD_FRAMES}',
                                     polling=100, timeout=120000)
                if not ok(pg.evaluate(f'!!(__plSubject.vid.sub.{mode} && __plSubject.vid.sub.{mode}.frames >= 3)'),
                          f'{mode}: no silhouette pictures within {LOAD_FRAMES} frames '
                          f'(status: {pg.text_content("#subjectStatus")})'):
                    continue
                m = pg.evaluate(MASK_JS)
                print(f'{mode}: man is {m["share"]:.0%} of the picture; middle {m["mid"]:.2f}, edges {m["edge"]:.2f}')
                ok(0.03 < m['share'] < 0.5, f'{mode}: the outline covers {m["share"]:.0%} of the picture')
                ok(m['mid'] > 0.3 and m['edge'] < 0.1, f'{mode}: the outline is not on the man (middle {m["mid"]:.2f}, edges {m["edge"]:.2f})')
                c.wait_frames(60, f'{mode} running')
                path, mean = c.picture('subject-' + mode)
                ok(mean > 3, f'{mode}: black picture')
                print('  picture:', path)
            pg.click('#subject button[data-subject="off"]')
            c.wait_frames(10, 'back to Off')
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
