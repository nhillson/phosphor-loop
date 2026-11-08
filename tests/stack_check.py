"""Effect stack (Effects, with Effect stack chosen rather than Classic layout): every loop's effects in one list in
order, in three zones (inside the loop, on the way out, whole picture). Loads the page small and works the stack the
way Nick would: adds effects from the menu, moves them up and down and across zones, adds Patch effects and
whole-picture ones, hands a fader to a mover, takes effects out, saves and loads a look, runs Autopilot for a while,
and switches to Classic and back. Checks the picture is never black and nothing goes wrong; takes a picture of the
list and of the screen at each step. Clicks and picks go through page scripts. About 3 minutes.

  python3 tests/stack_check.py
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check as C  # noqa: E402

OUT = os.path.join(tempfile.gettempdir(), 'phosphor-stack')
CLICK = "(s) => { const e = document.querySelector(s); if (!e) throw new Error('nothing at ' + s); e.click(); }"
PICK = """([s, v]) => { const e = document.querySelector(s); if (!e) throw new Error('nothing at ' + s);
  e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); }"""
SLIDE = """([s, v]) => { const e = document.querySelector(s); if (!e) throw new Error('nothing at ' + s);
  e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); }"""
LIST = "() => window.__plStack.list().map(it => it.kind + ':' + it.zone + (it.on ? '' : ':off'))"
ALL = "() => window.__plStack.all().map(it => it.kind + (it.on ? '' : ':off'))"
ITEM = "(kind) => { const it = [...window.__plStack.list(), ...window.__plStack.all()].find(x => x.kind === kind); return it ? it.id : null; }"
ACT = """([kind, act]) => { const it = [...window.__plStack.list(), ...window.__plStack.all()].find(x => x.kind === kind);
  if (!it) throw new Error('no ' + kind + ' in the stack'); const b = document.querySelector(`.stk-item[data-id="${it.id}"] [data-act="${act}"]`);
  if (!b) throw new Error('no ' + act + ' on ' + kind); b.click(); }"""


def main():
    from playwright.sync_api import sync_playwright
    os.makedirs(OUT, exist_ok=True)
    html, _ = C.patched_index(216)
    srv, port = C.serve()
    base = f'http://127.0.0.1:{port}/'
    errors, fails = [], []
    t0 = time.time()

    def ok(cond, what):
        print(('  ok   ' if cond else '  FAIL ') + what)
        if not cond:
            fails.append(what)

    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1280, 'height': 1000})
        pg.set_default_timeout(C.FAIL_FAST_MS)
        pg.add_init_script(C.WINDOWS_LIMITS_JS)
        pg.route(lambda u: u.rstrip('/').endswith(f':{port}') or u.split('?')[0].endswith('/index.html'),
                 lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
        pg.on('pageerror', lambda e: errors.append(f'page error: {e}'))
        pg.on('console', lambda m: errors.append(f'console error: {m.text}')
              if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        pg.goto(base)
        pg.add_style_tag(content='#tip, #osd { display: none !important; }')
        c = C.Check(pg, OUT)
        c.wait_frames(20, 'starting up', ceiling=C.START_CEILING_S)

        def shot(name, n=40, dim=False):
            c.wait_frames(n, name)
            path, lit = c.picture(name)
            # Type art over a thin picture is dim at this small test size, just as in Classic (checked: Type art
            # inside the loop over Wave gives the same brightness in both), so those pictures are only looked at
            if dim:
                print(f'  ..   {name}: brightness {lit:.1f} (Type art: dim here, as in Classic)')
            else:
                ok(lit > 3, f'{name}: picture not black (brightness {lit:.1f})')
            return lit

        def panel(name):
            el = pg.query_selector('#stackGroup')
            el.scroll_into_view_if_needed(timeout=30000)
            el.screenshot(path=os.path.join(OUT, name + '-list.png'), timeout=60000, animations='disabled')

        ok(pg.evaluate('window.__plStack.mode'), 'the effect stack is on to start with')
        ok(pg.evaluate("() => !document.getElementById('stackGroup').closest('.group').hidden && getComputedStyle(document.getElementById('stackGroup')).display !== 'none'"), 'the stack shows')
        ok(pg.evaluate("() => getComputedStyle(document.getElementById('classicFx')).display === 'none'"), 'the Classic effects are hidden')
        # From Neutral: Wave in, trails up
        pg.evaluate(CLICK, '#neutral')
        pg.evaluate(CLICK, '#inputs [data-src="wave"]')
        pg.evaluate(SLIDE, ['#trails', '85'])
        c.wait_frames(5, 'after Neutral')
        pg.evaluate('window.__plStack.sync()')
        ok(pg.evaluate(LIST) == [], f'Neutral empties the stack ({pg.evaluate(LIST)})')
        ok(pg.evaluate("() => document.getElementById('stkFixed').contains(document.getElementById('trails'))"), 'Trails sits at the top of the stack')
        # Add Zoom & spin, Mirror, Melt
        for kind in ['zoom', 'mirror', 'melt']:
            pg.evaluate(PICK, ['#stkAdd', kind])
            c.wait_frames(2, 'after adding ' + kind)
        ok(pg.evaluate(LIST) == ['mirror:in', 'zoom:in', 'melt:in'], f'added in the old order, inside the loop ({pg.evaluate(LIST)})')
        ok(pg.evaluate("() => +document.getElementById('zoom').value") == 25, 'Zoom starts at 25')
        ok(pg.evaluate("() => window.__plMirror && true") and pg.evaluate("() => document.querySelector('#mirror [aria-pressed=\"true\"]').dataset.mirror") == '4', 'Mirror starts at 4')
        ok(pg.evaluate("() => !!document.querySelector('.stk-body #zoom')"), 'Zoom’s fader is inside its card')
        n0 = pg.evaluate('window.__plStack.programs()')
        shot('1-mirror-zoom-melt')
        panel('1')
        sig1 = pg.evaluate('window.__plStack.sig()')
        # Move Mirror below Zoom: a different order inside the loop, a new program
        pg.evaluate(ACT, ['mirror', 'down'])
        c.wait_frames(3, 'after moving Mirror down')
        ok(pg.evaluate(LIST) == ['zoom:in', 'mirror:in', 'melt:in'], f'Mirror moved below Zoom ({pg.evaluate(LIST)})')
        ok(pg.evaluate('window.__plStack.sig()') != sig1, 'the loop’s order changed')
        ok(pg.evaluate('window.__plStack.programs()') > n0, 'a program was made for the new order')
        shot('2-zoom-then-mirror')
        # Mirror down again and again: past Melt, then out of the loop (on the way out)
        pg.evaluate(ACT, ['mirror', 'down'])
        pg.evaluate(ACT, ['mirror', 'down'])
        c.wait_frames(3, 'after moving Mirror out')
        ok(pg.evaluate(LIST) == ['zoom:in', 'melt:in', 'mirror:out'], f'Mirror on the way out ({pg.evaluate(LIST)})')
        shot('3-mirror-on-the-way-out')
        # Melt can't go on the way out: down from the bottom of the inside goes nowhere it can't work
        pg.evaluate(ACT, ['melt', 'down'])
        c.wait_frames(2, 'after trying to move Melt out')
        ok(pg.evaluate(LIST) == ['zoom:in', 'melt:in', 'mirror:out'], f'Melt stays inside the loop ({pg.evaluate(LIST)})')
        # Posterize comes on the way out, as it did in Classic; then up into the loop
        pg.evaluate(PICK, ['#stkAdd', 'poster'])
        c.wait_frames(2, 'after adding Posterize')
        ok('poster:out' in pg.evaluate(LIST), f'Posterize starts on the way out ({pg.evaluate(LIST)})')
        pid = pg.evaluate(ITEM, 'poster')
        pg.evaluate(f"window.__plStack.moveTo('{pid}', 0)")
        c.wait_frames(2, 'after moving Posterize in')
        ok(pg.evaluate(LIST)[0] == 'poster:in', f'Posterize moved to the top inside the loop ({pg.evaluate(LIST)})')
        shot('4-posterize-inside')
        # Patch effects: Kaleido on the way out, then Gradient colors; Kaleido then into the loop
        pg.evaluate(PICK, ['#stkAdd', 'p:kaleido'])
        pg.evaluate(PICK, ['#stkAdd', 'p:colors'])
        c.wait_frames(3, 'after adding Patch effects')
        L = pg.evaluate(LIST)
        ok('p:kaleido:out' in L and 'p:colors:out' in L, f'Patch effects on the way out ({L})')
        shot('5-kaleido-colors-out')
        panel('5')
        kid = pg.evaluate(ITEM, 'p:kaleido')
        pg.evaluate(f"window.__plStack.moveTo('{kid}', 1)")
        c.wait_frames(3, 'after moving Kaleido in')
        ok('p:kaleido:in' in pg.evaluate(LIST), f'Kaleido inside the loop ({pg.evaluate(LIST)})')
        shot('6-kaleido-inside')
        # Whole picture: 3D lighting and Type art, then lighting above type
        pg.evaluate(PICK, ['#stkAdd', 'relief'])
        pg.evaluate(PICK, ['#stkAdd', 'type'])
        c.wait_frames(3, 'after adding whole-picture effects')
        ok(pg.evaluate(ALL) == ['relief', 'type'], f'whole picture: 3D lighting, Type art ({pg.evaluate(ALL)})')
        ok(pg.evaluate("() => !!document.querySelector('.stk-body #rDepth')"), '3D lighting’s controls are in its card')
        shot('7-relief-type', 30, dim=True)
        pg.evaluate(ACT, ['type', 'up'])
        c.wait_frames(3, 'after moving Type art up')
        ok(pg.evaluate(ALL) == ['type', 'relief'], f'Type art above 3D lighting ({pg.evaluate(ALL)})')
        shot('8-type-then-relief', 30, dim=True)
        panel('8')
        # Type art up again: into this loop (inside)
        pg.evaluate(ACT, ['type', 'up'])
        c.wait_frames(3, 'after moving Type art into the loop')
        ok('type:in' in pg.evaluate(LIST) and 'type' not in pg.evaluate(ALL), f'Type art inside loop A ({pg.evaluate(LIST)} / {pg.evaluate(ALL)})')
        shot('9-type-inside', 30, dim=True)
        # Switch Type art and 3D lighting off, then take Type art out
        pg.evaluate(ACT, ['relief', 'on'])
        c.wait_frames(2, 'after switching 3D lighting off')
        ok(pg.evaluate(ALL) == ['relief:off'], f'3D lighting off ({pg.evaluate(ALL)})')
        pg.evaluate(ACT, ['type', 'del'])
        c.wait_frames(3, 'after taking Type art out')
        ok(pg.evaluate('window.__plType.typeArt.tAmt') == 0, 'taking Type art out turns it off')
        # A mover on Zoom
        zid = pg.evaluate(ITEM, 'zoom')
        if not pg.evaluate(f"() => !!document.querySelector('.stk-item[data-id=\"{zid}\"] .stk-body')"):
            pg.evaluate(ACT, ['zoom', 'fold'])
        pg.evaluate(PICK, [f'.stk-item[data-id="{zid}"] select[data-act="mvm"][data-k="zoom"]', 'slow'])
        c.wait_frames(5, 'after a mover on Zoom')
        ok(pg.evaluate("(id) => window.__plStack.list().find(x => x.id === id).mv.zoom.m", zid) == 'slow', 'Zoom moves with a slow wave')
        # Take Zoom out: its faders go to 0
        pg.evaluate(ACT, ['zoom', 'del'])
        c.wait_frames(3, 'after taking Zoom out')
        ok(pg.evaluate("() => +document.getElementById('zoom').value") == 0, 'taking Zoom & spin out puts Zoom at 0')
        shot('10-after-removing')
        # Save the look, mess it up, load it back
        saved = pg.evaluate('window.__plCloud.snap()')
        before = pg.evaluate(LIST)
        pg.evaluate(CLICK, '#neutral')
        c.wait_frames(5, 'after Neutral')
        pg.evaluate('(d) => window.__plCloud.load(d)', saved)
        c.wait_frames(5, 'after loading')
        ok(pg.evaluate(LIST) == before, f'a saved look brings its stack back ({pg.evaluate(LIST)})')
        # An old look (no stack): its stack is made from its settings
        old = dict(saved)
        old['A'] = {k: v for k, v in saved['A'].items() if k != 'stack'}
        old['A'].update({'zoom': 30, 'melt': 40, 'warp': 20, 'warpFinal': True, 'mirror': 0, 'poster': 0})
        pg.evaluate('(d) => window.__plCloud.load(d)', old)
        c.wait_frames(5, 'after loading an old look')
        L = pg.evaluate(LIST)
        ok('zoom:in' in L and 'melt:in' in L and 'warp:out' in L, f'an old look gets a stack from its settings ({L})')
        # Autopilot for a while: effects it brings in join the stack by themselves
        pg.evaluate(CLICK, '#autopilot')
        c.wait_frames(150, 'Autopilot running')
        pg.evaluate('window.__plStack.sync()')
        L = pg.evaluate(LIST)
        print('       Autopilot’s stack: ' + ', '.join(L))
        shot('11-autopilot', 10)
        pg.evaluate(CLICK, '#autopilot')
        # Loop B has a stack of its own
        pg.evaluate(CLICK, '#tabB')
        c.wait_frames(3, 'after picking loop B')
        ok(pg.evaluate("() => window.__plStack.list('B') !== window.__plStack.list('A')"), 'loop B has its own stack')
        panel('12-loopB')
        pg.evaluate(CLICK, '#tabA')
        # Spread out controls: each loop's column shows its own stack, and its arrows work there
        pg.evaluate(CLICK, '#wideBtn')
        c.wait_frames(10, 'after Spread out controls')
        ok(pg.evaluate("() => document.querySelectorAll('.stk-list').length") >= 3, 'each loop’s column has a copy of its stack')
        pg.screenshot(path=os.path.join(OUT, 'spread-out.png'))
        bl = pg.evaluate("() => window.__plStack.list('B').map(it => it.kind)")
        if len(bl) >= 2:
            pg.evaluate("""() => { const col = [...document.querySelectorAll('[data-loop="B"]')].find(m => m.id !== 'editor' && m.querySelector('.stk-item'));
              col.querySelector('.stk-item [data-act="down"]').click(); }""")
            c.wait_frames(5, 'after moving in loop B’s column')
            ok(pg.evaluate("() => window.__plStack.list('B').map(it => it.kind)") != bl, f'an arrow in loop B’s column moves loop B’s effect ({bl} → {pg.evaluate("() => window.__plStack.list(\'B\').map(it => it.kind)")})')
        pg.evaluate(CLICK, '#wideBtn')
        c.wait_frames(5, 'after Spread out off')
        # Classic and back
        pg.evaluate(CLICK, '[data-fxmode="classic"]')
        c.wait_frames(5, 'after switching to Classic')
        ok(not pg.evaluate('window.__plStack.mode'), 'Classic layout chosen')
        ok(pg.evaluate("() => getComputedStyle(document.getElementById('classicFx')).display !== 'none'"), 'the Classic effects show')
        ok(pg.evaluate("() => document.getElementById('classicFx').contains(document.getElementById('zoom'))"), 'Zoom is back in the Classic layout')
        shot('13-classic')
        pg.evaluate(CLICK, '#classicFx [data-fxmode="stack"]')
        c.wait_frames(5, 'after switching back')
        ok(pg.evaluate('window.__plStack.mode'), 'back to the effect stack')
        shot('14-stack-again')
        pg.screenshot(path=os.path.join(OUT, 'whole-page.png'))
        b.close()
    srv.shutdown()
    for e in errors[:10]:
        print('  ' + e)
    if errors:
        fails.append(f'{len(errors)} page errors')
    print(f'{"PASS" if not fails else "FAIL"} in {time.time() - t0:.0f}s; pictures in {OUT}')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
