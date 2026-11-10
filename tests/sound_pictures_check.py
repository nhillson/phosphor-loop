"""Sound pictures (React to sound › Ripple tank, Build and drop, Scan-line hills). Made-up music is fed in as raw sound
(window.__plSnd.fake); Build and drop's bass-out and drop are set by hand on its listener, since the made-up music never
changes. Waits are frames, never seconds.

  python3 tests/sound_pictures_check.py       (about 2 minutes; pictures go to <temp>/phosphor-sound-pictures)
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import patched_index, serve, Check, START_CEILING_S, FAIL_FAST_MS
from PIL import Image, ImageChops, ImageStat


def main():
    from playwright.sync_api import sync_playwright
    out = os.path.join(tempfile.gettempdir(), 'phosphor-sound-pictures')
    os.makedirs(out, exist_ok=True)
    html, notes = patched_index(int(os.environ.get('RES', '216')))
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/'
    problems, errors = [], []
    def check(ok, what):
        print(('  ok   ' if ok else '  FAIL ') + what)
        if not ok: problems.append(what)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.set_default_timeout(FAIL_FAST_MS)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
        pg.route(base + 'index.html', lambda r: r.fulfill(body=html, content_type='text/html'))
        pg.goto(base + 'index.html', timeout=START_CEILING_S * 1000)
        pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
        c = Check(pg, out)
        c.wait_frames(30, 'starting up', ceiling=START_CEILING_S)
        chip = lambda k: pg.evaluate(f"document.querySelector('#sndMap [data-map={k}]').click()")
        shown = lambda k: pg.evaluate(f"getComputedStyle(document.querySelector('#sndMap [data-map={k}]')).display !== 'none'")
        for k in ['ripple', 'build', 'hills']:
            check(pg.evaluate(f"__plSnd.snd.map.{k}") is False, f'{k} is off to start with')
        pg.evaluate('__plSnd.fake()')
        # A still, detailed picture: the test card, no movement of its own
        pg.evaluate("""() => { const L = __plAp.loops; for (const k of ['A', 'B']) Object.assign(L[k].tgt, { trails: 0, zoom: 0, spin: 0, warp: 0, mirror: 0, melt: 0, push: 0, dye: 0, flow: 0, in2: 'none' });
          L.A.tgt.in1 = 'picture'; L.B.tgt.in1 = 'none'; }""")
        pg.evaluate("document.getElementById('sndAmt').value = 0; document.getElementById('sndAmt').dispatchEvent(new Event('input'))")
        c.wait_frames(40, 'plain picture')
        check(shown('ripple') and shown('build') and shown('hills'), 'the three switches show in the effect stack layout')
        check(not pg.evaluate("__plSfx.tex('A')"), 'nothing is laid over the loop while all three are off')
        pg.evaluate("document.getElementById('sndAmt').value = 60; document.getElementById('sndAmt').dispatchEvent(new Event('input'))")
        pg.evaluate("for (const k of ['kick','size','spin','color','warp','flash','asym']) __plSnd.snd.map[k] = false")
        c.wait_frames(30, 'plain picture with sound')
        plain, _ = c.picture('plain')
        def differs(name, least):
            path, _ = c.picture(name)
            d = ImageStat.Stat(ImageChops.difference(Image.open(path).convert('L'), Image.open(plain).convert('L'))).mean[0]
            check(d > least, f'{name}: the picture changed (difference {d:.2f})')
            print(f'       picture: {path}')
        # Ripple tank
        chip('ripple')
        c.wait_frames(60, 'ripples')
        n = pg.evaluate('__plSfx.sfx.rip.length')
        check(n >= 1, f'hits drop ripples ({n} on the water; this workspace draws too slowly to hear most hits)')
        # ...so a kick and a hi-hat by hand as well
        pg.evaluate("__plSfx.drop(true, 1); __plSfx.drop(true, 0.8); __plSfx.drop(false, 0.4); __plSfx.drop(false, 0.5)")
        c.wait_frames(3, 'hand-made hits')
        rip = pg.evaluate('__plSfx.sfx.rip')
        big = [r for r in rip if r['wl'] > 0.12]; small = [r for r in rip if r['wl'] < 0.12]
        check(len(big) > 0 and len(small) > 0, f'kicks make big rings and hi-hats small ones ({len(big)} big, {len(small)} small)')
        if big and small: check(max(r['speed'] for r in big) < min(r['speed'] for r in small), 'big rings travel slower than small ones')
        check(pg.evaluate("__plSfx.tex('A')"), 'the ripples are laid over loop A')
        differs('ripple_tank', 0.3)
        pg.evaluate("document.querySelector('#sndLoops [data-react=A]').click()")
        c.wait_frames(5, 'loop A not reacting')
        check(not pg.evaluate("__plSfx.tex('A')"), 'a loop that ignores the sound gets no ripples')
        pg.evaluate("document.querySelector('#sndLoops [data-react=A]').click()")
        chip('ripple')
        c.wait_frames(5, 'ripples off')
        check(not pg.evaluate("__plSfx.tex('A')"), 'off again: the loop is as it was')
        # Scan-line hills
        chip('hills')
        c.wait_frames(60, 'hills')
        check(pg.evaluate("__plSfx.hills('A')") > 0.9, 'Scan-line hills fades in')
        check(pg.evaluate('__plSnd.on'), 'the sound wave is read for the hills (no line input needed)')
        check(pg.evaluate("__plSnd.amp('A')") == 0, 'Sound on lines itself stays out of it')
        check(not pg.evaluate("document.getElementById('sndDetailRow').hidden"), 'Line detail shows for the hills')
        differs('scan_line_hills', 2)
        chip('hills')
        c.wait_frames(60, 'hills off')
        check(not pg.evaluate("__plSfx.tex('A')"), 'hills fade out and the pass is let go')
        # Build and drop: the made-up music has a steady bass, so nothing happens by itself
        chip('build')
        c.wait_frames(40, 'build and drop, steady music')
        st = pg.evaluate('__plSfx.sfx.bd')
        check(st['ref'] > 0.004 and st['float'] < 0.05 and st['rel'] < 0.05, f"steady music: no float, no drop (state {st['state']})")
        # The bass drops out: pretend its usual level was far higher than what's heard now
        pg.evaluate('__plSfx.sfx.bd.hold = setInterval(() => { __plSfx.sfx.bd.ref = 50; }, 4)')
        fps = c.wait_frames(40, 'bass out')
        st = pg.evaluate('__plSfx.sfx.bd')
        check(st['float'] > 0.5 and st['state'] == 'float', f"bass out: the picture floats (float {st['float']:.2f}, out for {st['outFor']:.1f} s)")
        check(st['wind'] > 0.02, f"...and starts winding up (wind {st['wind']:.2f})")
        differs('build_floating', 0.3)
        # The bass comes back
        pg.evaluate('clearInterval(__plSfx.sfx.bd.hold); __plSfx.sfx.bd.ref = 0.0041; __plSfx.sfx.bd.outFor = Math.max(2, __plSfx.sfx.bd.outFor)')
        got = False
        for _ in range(30):
            c.wait_frames(1, 'waiting for the drop')
            if pg.evaluate('__plSfx.sfx.bd.rel') > 0.3: got = True; break
        check(got, 'the bass returns: the drop lets go')
        differs('build_drop', 0.3)
        c.wait_frames(max(30, int(fps * 5)), 'after the drop')
        st = pg.evaluate('__plSfx.sfx.bd')
        check(st['rel'] < 0.05 and st['float'] < 0.05, 'a few seconds on, it has settled')
        chip('build')
        # Saved with a look
        chip('ripple'); chip('hills')
        snap = pg.evaluate('__plGrade.snapshot()')
        m = snap.get('snd', {}).get('map', {})
        check(m.get('ripple') is True and m.get('hills') is True and m.get('build') is False, 'a saved look keeps the three switches')
        c.wait_frames(40, 'ripples and hills together')
        differs('ripples_and_hills', 2)
        b.close()
    for e in errors: problems.append('page error: ' + e)
    print('PASS' if not problems else 'FAIL:\n  ' + '\n  '.join(problems))
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
