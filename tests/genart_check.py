"""The Generative art input (genart/, `gen` and `gens` in js/app.js): moving pieces, a looping video player per loop.
Checks its button, that the piece plays (new frames keep coming), the gallery (moving previews), ◀ ▶ and Shuffle, each
loop keeping its own piece, Autopilot bringing in a new one, and pictures of it moving.

  python3 tests/genart_check.py            (about 2 minutes)
  python3 tests/genart_check.py --res 432  bigger pictures of the two recipes, for looking at

Checks every file pictures.json names is there (video, still, preview) and the videos are at least 1024 across (ffprobe). Reaches into the app through
window.__plGen. Every wait is a number of frames the app has drawn, or a condition with a ceiling.
"""
import argparse
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402

CLICK = "(s) => { const el = document.querySelector(s); if (!el) throw new Error('no ' + s); el.click(); }"


def files_ok(problems):
    import subprocess
    d = os.path.join(check.ROOT, 'genart')
    data = json.load(open(os.path.join(d, 'pictures.json'), encoding='utf-8'))
    cats = {c['id'] for c in data['cats']}
    for p in data['pics']:
        if p['c'] not in cats:
            problems.append(f"{p['f']}: unknown kind {p['c']}")
        for suffix in ('.webm', '-t.jpg', '-p.webm'):
            path = os.path.join(d, p['f'] + suffix)
            if not os.path.exists(path):
                problems.append(f'missing {path}')
        video = os.path.join(d, p['f'] + '.webm')
        if os.path.exists(video):
            wh = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                                 '-of', 'csv=p=0', video], capture_output=True, text=True).stdout.strip()
            if not wh or min(int(x) for x in wh.split(',')) < 1024:
                problems.append(f'{video} is {wh or "unreadable"}, not at least 1024 across')
    print(f"  {len(data['pics'])} pieces listed, {len(cats)} kinds")
    return len(data['pics'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--res', type=int, default=216)
    ap.add_argument('--frames', type=int, default=120)
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'phosphor-genart'))
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright
    os.makedirs(a.out, exist_ok=True)
    problems, errors = [], []
    t0 = time.time()
    n = files_ok(problems)
    html, _ = check.patched_index(a.res)
    srv, port = check.serve()
    base = f'http://127.0.0.1:{port}/'
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
        c = check.Check(pg, a.out)
        st = lambda: pg.evaluate('window.__plGen()')
        def wait_for(cond, what, frames=60):
            start = c.frames()
            while c.frames() < start + frames:
                if pg.evaluate(cond):
                    return True
                c.wait_frames(2, what)
            problems.append(f'{what}: not after {frames} frames')
            return False
        try:
            pg.goto(base + 'index.html', timeout=check.START_CEILING_S * 1000)
            pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
            c.wait_frames(30, 'starting up', ceiling=check.START_CEILING_S)
            pg.evaluate("() => { try { localStorage.clear(); } catch (_) {} }")
            # The button switches loop A to it and a piece arrives by itself
            pg.evaluate(CLICK, '#inputs [data-src="genart"]')
            wait_for("window.__plGen().loops.A.at >= 0", 'loop A gets a piece')
            s = st()
            if s['loops']['A']['in1'] != 'genart':
                problems.append(f"loop A's input is {s['loops']['A']['in1']}, not genart")
            if s['count'] != n:
                problems.append(f"the app lists {s['count']} pictures, pictures.json {n}")
            if pg.evaluate("document.querySelector('#row-genart').hidden"):
                problems.append('the Generative art controls stay hidden')
            name = pg.evaluate("document.querySelector('#genName').textContent")
            print(f"  loop A: {s['loops']['A']['f']} ({name})")
            # It moves by itself: playing, its time going on, new frames coming in
            f0, t0v = s['loops']['A']['frames'], s['loops']['A']['t']
            c.wait_frames(40, 'drawing it')
            s = st()
            print(f"  playing {s['loops']['A']['playing']}, {s['loops']['A']['frames'] - f0} new frames, time {t0v} -> {s['loops']['A']['t']}")
            if not s['loops']['A']['playing'] or s['loops']['A']['frames'] - f0 < 5:
                problems.append('the piece isn\'t playing (no new frames)')
            _, lit = c.picture('genart-plain')
            if lit < 3:
                problems.append(f'Generative art is black (brightness {lit:.1f})')
            # ◀ ▶ and Shuffle
            first = st()['loops']['A']['at']
            pg.evaluate(CLICK, '#genNext')
            wait_for(f"window.__plGen().loops.A.at !== {first}", '▶ moves on')
            pg.evaluate(CLICK, '#genPrev')
            wait_for(f"window.__plGen().loops.A.at === {first}", '◀ comes back')
            pg.evaluate(CLICK, '#genShuffle')
            wait_for(f"window.__plGen().loops.A.at !== {first}", 'Shuffle changes it')
            # The gallery: every tile, the kinds, a pick
            pg.evaluate(CLICK, '#genOpen')
            wait_for("!document.querySelector('#gen').hidden", 'the gallery opens', 30)
            tiles = pg.evaluate("document.querySelectorAll('#genGrid .nat-tile').length")
            tabs = pg.evaluate("[...document.querySelectorAll('#genTabs .chip')].map(b => b.textContent)")
            c.wait_frames(20, 'previews start')
            moving = pg.evaluate("[...document.querySelectorAll('#genGrid video')].filter(v => !v.paused).length")
            print(f'  previews playing: {moving}')
            if moving != n:
                problems.append(f'{moving} of {n} gallery previews play')
            print(f'  gallery: {tiles} tiles, kinds {tabs}')
            if tiles != n:
                problems.append(f'the gallery shows {tiles} tiles, not {n}')
            pg.evaluate(CLICK, "#genTabs [data-cat='mandala']")
            shown = pg.evaluate("[...document.querySelectorAll('#genGrid .nat-tile')].filter(t => !t.hidden).length")
            pg.evaluate("() => [...document.querySelectorAll('#genGrid .nat-tile')].filter(t => !t.hidden)[2].click()")
            wait_for("document.querySelector('#gen').hidden", 'the gallery closes after a pick', 30)
            mandalas = [x['f'] for x in json.load(open(os.path.join(check.ROOT, 'genart', 'pictures.json'), encoding='utf-8'))['pics'] if x['c'] == 'mandala']
            wait_for(f"{json.dumps(mandalas)}.includes(window.__plGen().loops.A.f)", 'the picked mandala comes in')
            print(f"  Mandalas shows {shown}; picked {st()['loops']['A']['f']}")
            if shown != len(mandalas):
                problems.append(f'Mandalas shows {shown}, not {len(mandalas)}')
            pg.evaluate("() => { try { localStorage.setItem('phosphor-genart-tab', 'all'); } catch (_) {} }")
            # Loop B gets its own; loop A's stays
            a_f = st()['loops']['A']['f']
            pg.evaluate(CLICK, '#tabB')
            c.wait_frames(3, 'tab B')
            pg.evaluate(CLICK, '#inputs [data-src="genart"]')
            wait_for("window.__plGen().loops.B.at >= 0", 'loop B gets a piece')
            pg.evaluate(CLICK, '#genShuffle')
            c.wait_frames(10, 'loop B shuffles')
            s = st()
            print(f"  loop A {s['loops']['A']['f']}, loop B {s['loops']['B']['f']}")
            if s['loops']['A']['f'] != a_f:
                problems.append("loop B's Shuffle changed loop A's piece")
            pg.evaluate(CLICK, '#tabA')
            c.wait_frames(3, 'tab A')
            # A loop that stops using it pauses its player
            pg.evaluate(CLICK, '#tabB')
            pg.evaluate(CLICK, '#inputs [data-src="wave"]')
            c.wait_frames(5, 'loop B on Wave')
            if st()['loops']['B']['playing']:
                problems.append("loop B's player kept playing after it switched to Wave")
            pg.evaluate(CLICK, '#tabA')
            c.wait_frames(3, 'tab A')
            # Picture on the same loop takes the slot back (the nature picture, not the generative art)
            pg.evaluate("() => { document.querySelector('#in2').value = 'picture'; document.querySelector('#in2').dispatchEvent(new Event('change', {bubbles: true})); }")
            c.wait_frames(10, 'Picture as the second input')
            pg.evaluate("() => { document.querySelector('#in2').value = 'none'; document.querySelector('#in2').dispatchEvent(new Event('change', {bubbles: true})); }")
            # Autopilot runs with it about
            pg.evaluate(CLICK, '#autopilot')
            c.wait_frames(40, 'Autopilot')
            pg.evaluate(CLICK, '#autopilot')
            c.wait_frames(5, 'Autopilot off')
            # Pictures of it moving: the two recipes
            for recipe in ('Glow tunnel', 'Mandala bloom'):
                pg.evaluate(CLICK, '#neutral')
                c.wait_frames(3, 'neutral')
                if not pg.evaluate(check.RECIPE_JS, recipe):
                    problems.append(f'no recipe called {recipe}')
                    continue
                pg.keyboard.press('Escape')
                c.wait_frames(a.frames, recipe)
                path, lit = c.picture(recipe.replace(' ', '_'))
                print(f'  picture: {path} (brightness {lit:.0f}, showing {st()["loops"]["A"]["f"]})')
                if lit < 3:
                    problems.append(f'{recipe} is black')
        except check.Stalled as e:
            problems.append(str(e))
        banner = pg.evaluate(check.BANNER_JS)
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
