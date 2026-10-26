#!/usr/bin/env python3
"""3D lighting check (the 3D lighting section, and 3D depth / smoothness / shine under each input's Adjust the picture).

Puts tests/media/person.webm in as loop A's Video with Trails at 0 and holds one frame, so pictures can be compared.
Then: the input's own 3D depth changes the picture, and back at 0 it's as before; the same for the finished
picture's Depth; a preset keeps both and brings them back; Neutral turns both off. Takes pictures of the video with
each, and of the finished picture's 3D lighting over trails. Waits by frames, like tests/check.py. About a minute.
Reaches into the app through window.__plRelief and window.__plGrade.

  python3 tests/relief_check.py            pictures go to /tmp/phosphor-relief
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import (BANNER_JS, FAIL_FAST_MS, SLIDER_JS, START_CEILING_S, Check, Stalled, patched_index, serve)  # noqa: E402

CLIP = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'media', 'person.webm')


def diff(a, b):
    """How different two pictures are: mean difference per channel, 0-255."""
    from PIL import Image, ImageChops, ImageStat
    d = ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB'))
    return sum(ImageStat.Stat(d).mean) / 3


def main():
    out = os.path.join(tempfile.gettempdir(), 'phosphor-relief')
    os.makedirs(out, exist_ok=True)
    from playwright.sync_api import sync_playwright
    html, _ = patched_index(324)
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/'
    problems, errors = [], []
    t0 = time.time()

    def ok(cond, what):
        print(('  ok    ' if cond else '  FAIL  ') + what)
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
            ok(pg.is_visible('#reliefGroup') or pg.evaluate("!!document.getElementById('reliefGroup')"), '3D lighting section is there')
            pg.set_input_files('#vidFile', CLIP)
            pg.wait_for_function('__plSubject.vid.on && __plSubject.loops.A.tgt.in1 === "video"')
            pg.evaluate(SLIDER_JS, ['trails', 0])
            c.wait_frames(15, 'video playing')
            pg.evaluate("document.querySelector('#row-video .hold-btn').click()")
            c.wait_frames(10, 'frame held')
            flat, light = c.picture('video-flat')
            ok(light > 20, f'the test video is on screen (brightness {light:.0f})')

            # The input's own 3D look
            pg.evaluate(SLIDER_JS, ['adj-video-rDepth', 70])
            c.wait_frames(10, 'input 3D on')
            inp, _ = c.picture('video-input-3d')
            ok(diff(flat, inp) > 3, f'the input\'s 3D depth changes the picture (by {diff(flat, inp):.1f})')
            pg.evaluate(SLIDER_JS, ['adj-video-rDepth', 0])
            c.wait_frames(10, 'input 3D off')
            back, _ = c.picture('video-input-off-again')
            ok(diff(flat, back) < 1, f'the input\'s 3D depth at 0 leaves it as before (off by {diff(flat, back):.1f})')

            # The finished picture's 3D look
            pg.evaluate(SLIDER_JS, ['rDepth', 70])
            c.wait_frames(10, 'final 3D on')
            fin, _ = c.picture('video-final-3d')
            ok(diff(flat, fin) > 3, f'3D lighting Depth changes the finished picture (by {diff(flat, fin):.1f})')
            pg.evaluate(SLIDER_JS, ['rLight', 315])
            c.wait_frames(10, 'light from bottom right')
            other, _ = c.picture('video-final-3d-light-bottom-right')
            ok(diff(fin, other) > 2, f'Light comes from moves the shading (by {diff(fin, other):.1f})')
            ok(pg.text_content('#rLightOut') == 'BOTTOM RIGHT', f'the light\'s side reads {pg.text_content("#rLightOut")!r}')
            pg.evaluate(SLIDER_JS, ['rLight', 135])

            # A preset keeps both; Neutral turns both off
            pg.evaluate(SLIDER_JS, ['adj-video-rDepth', 40])
            snap = pg.evaluate('__plGrade.snapshot()')
            ok(snap.get('relief', {}).get('rDepth') == 70 and snap['adj']['video']['rDepth'] == 40, 'a preset keeps both 3D looks')
            pg.evaluate("document.getElementById('reliefReset').click()")
            pg.evaluate(SLIDER_JS, ['adj-video-rDepth', 0])
            ok(pg.evaluate('__plRelief.relief.rDepth') == 0, 'Back to normal turns 3D lighting off')
            pg.evaluate('(d) => __plGrade.loadPreset(d)', snap)
            c.wait_frames(10, 'preset loaded')
            ok(pg.evaluate('__plRelief.relief.rDepth') == 70 and pg.evaluate('__plRelief.adj.video.rDepth') == 40
               and pg.evaluate("+document.getElementById('rDepth').value") == 70, 'loading the preset brings both back')
            pg.evaluate("document.getElementById('neutral').click()")
            c.wait_frames(10, 'after Neutral')
            ok(pg.evaluate('__plRelief.relief.rDepth') == 0 and pg.evaluate('__plRelief.adj.video.rDepth') == 0, 'Neutral turns both off')

            # The look over trails: video playing, Trails up, the light circling
            if pg.evaluate('__plSubject.loops.A.tgt.in1') != 'video':
                pg.click('#inputs button[data-src="video"]')
            pg.evaluate("document.querySelector('#row-video .hold-btn').getAttribute('aria-pressed') === 'true' && document.querySelector('#row-video .hold-btn').click()")
            for k, v in [('trails', 85), ('zoom', 20), ('rDepth', 80), ('rSmooth', 45), ('rShine', 80), ('rSpin', 40)]:
                pg.evaluate(SLIDER_JS, [k, v])
            c.wait_frames(120, 'trails building')
            path, light = c.picture('video-trails-final-3d')
            ok(light > 5, f'3D lighting over trails is not black (brightness {light:.0f})')
            print('  pictures in', out)
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
