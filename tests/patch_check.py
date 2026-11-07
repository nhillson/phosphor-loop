"""Patch (Inputs › Patch): the layer stack. Loads the page small, picks Patch on loop A, then works the stack the way
Nick would: load a ready-made patch, open a layer, move a fader, hand it to a mover, add, move, switch off and remove
layers, save the patch and load it back, and checks the picture is never black. Takes pictures of the layers' controls
and of each step. Clicks and picks go through page scripts (element.click(), value + event): Playwright's own click
can wait forever on this page in the workspace browser. About 2 minutes.

  python3 tests/patch_check.py
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check as C  # noqa: E402

OUT = os.path.join(tempfile.gettempdir(), 'phosphor-patch')
CLICK = "(s) => { const e = document.querySelector(s); if (!e) throw new Error('nothing at ' + s); e.click(); }"
PICK = """([s, v]) => { const e = document.querySelector(s); if (!e) throw new Error('nothing at ' + s);
  e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); }"""
SLIDE = """([s, v]) => { const e = document.querySelector(s); if (!e) throw new Error('nothing at ' + s);
  e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); }"""
PT = "() => { const P = window.__plPatch; return JSON.parse(JSON.stringify(P.loops[P.edit].tgt.patch)); }"


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
        pg = b.new_page(viewport={'width': 1280, 'height': 900})
        pg.set_default_timeout(C.FAIL_FAST_MS)
        pg.add_init_script(C.WINDOWS_LIMITS_JS)
        pg.route(lambda u: u.rstrip('/').endswith(f':{port}') or u.split('?')[0].endswith('/index.html'),
                 lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
        pg.on('pageerror', lambda e: errors.append(f'page error: {e}'))
        pg.on('console', lambda m: errors.append(f'console error: {m.text}')
              if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        pg.goto(base)
        c = C.Check(pg, OUT)
        c.wait_frames(20, 'starting up', ceiling=C.START_CEILING_S)
        pg.evaluate("() => localStorage.removeItem('phosphor-patches-v1')")
        # Patch on loop A, with no trails so the picture is the patch itself
        pg.evaluate(CLICK, '#inputs [data-src="patch"]')
        pg.evaluate(SLIDE, ['#trails', '0'])
        pg.evaluate(SLIDE, ['#zoom', '50'])
        pg.evaluate(SLIDE, ['#spin', '50'])
        c.wait_frames(10, 'after picking Patch')
        ok(not pg.evaluate("() => document.getElementById('row-patch').hidden"), 'the Patch row shows')
        ok(pg.evaluate("() => document.querySelectorAll('#patchStack .pl-layer').length") >= 3, 'the first ready-made patch has its layers')
        _, light = c.picture('1-liquid-marble')
        ok(light > 3, f'the picture isn\'t black ({light:.0f})')
        # Load another ready-made patch
        pg.evaluate(PICK, ['#patchPick', 's1'])
        c.wait_frames(10, 'after loading Neon tunnel')
        ok(pg.evaluate(PT)['name'] == 'Neon tunnel', 'Load a patch › Neon tunnel')
        _, light = c.picture('2-neon-tunnel')
        ok(light > 3, f'Neon tunnel draws ({light:.0f})')
        # Open the first layer, move a fader, give it a mover
        pg.evaluate(CLICK, '#patchStack .pl-layer[data-i="0"] [data-act="fold"]')
        ok(pg.evaluate("() => !!document.querySelector('#patchStack .pl-layer[data-i=\"0\"] .pl-body')"), 'clicking a layer\'s name opens it')
        pg.evaluate(SLIDE, ['#patchStack .pl-layer[data-i="0"] input[data-act="p"][data-k="count"]', '80'])
        ok(pg.evaluate(PT)['layers'][0]['p']['count'] == 80, 'a layer\'s fader changes the patch')
        pg.evaluate(PICK, ['#patchStack .pl-layer[data-i="0"] select[data-k="soft"]', 'slow'])
        pt = pg.evaluate(PT)
        ok(pt['layers'][0]['mv'].get('soft', {}).get('m') == 'slow', 'a fader handed to Slow wave')
        ok(pg.evaluate("() => !!document.querySelector('#patchStack .pl-layer[data-i=\"0\"] input[data-act=\"mva\"][data-k=\"soft\"]')"), 'a moving fader gets its How far fader')
        # Add a pattern and an effect: both go in above the colors at the bottom
        n0 = len(pt['layers'])
        pg.evaluate(PICK, ['#patchAdd', 'dots'])
        pg.evaluate(PICK, ['#patchAdd', 'mirror'])
        pt = pg.evaluate(PT)
        kinds = [l['kind'] for l in pt['layers']]
        ok(len(kinds) == n0 + 2 and kinds[-1] == 'colors' and 'dots' in kinds and 'mirror' in kinds, f'added Dots and Mirror above the colors ({kinds})')
        i = kinds.index('dots')
        pg.evaluate(PICK, [f'#patchStack .pl-layer[data-i="{i}"] select[data-act="blend"]', '3'])
        ok(pg.evaluate(PT)['layers'][i]['blend'] == 3, 'Dots blend set to Difference')
        c.wait_frames(8, 'after adding layers')
        # Move the mirror up, switch the dots off, remove the mirror
        j = kinds.index('mirror')
        pg.evaluate(CLICK, f'#patchStack .pl-layer[data-i="{j}"] [data-act="up"]')
        ok(pg.evaluate(PT)['layers'][j - 1]['kind'] == 'mirror', 'Move up')
        pg.evaluate(CLICK, f'#patchStack .pl-layer[data-i="{i}"] [data-act="on"]')
        ok(pg.evaluate(PT)['layers'][i]['on'] is False, 'switching a layer off')
        c.wait_frames(8, 'after switching a layer off')
        _, light = c.picture('3-edited')
        ok(light > 3, f'the edited patch draws ({light:.0f})')
        try:
            r = pg.evaluate("() => { const e = document.getElementById('row-patch'); e.scrollIntoView({block: 'start'}); const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, Math.min(b.height, 880)]; }")
            pg.screenshot(path=os.path.join(OUT, 'controls.png'), clip={'x': r[0], 'y': r[1], 'width': r[2], 'height': r[3]}, timeout=30000)
        except Exception as e:
            print('  (no picture of the controls:', str(e).splitlines()[0], ')')
        pg.evaluate(CLICK, f'#patchStack .pl-layer[data-i="{j - 1}"] [data-act="del"]')
        ok('mirror' not in [l['kind'] for l in pg.evaluate(PT)['layers']], 'removing a layer')
        # Save under a new name, load something else, load it back
        pg.evaluate("() => { const e = document.getElementById('patchName'); e.value = 'Test patch'; }")
        pg.evaluate(CLICK, '#patchSave')
        saved = pg.evaluate(PT)
        ok(any(p['name'] == 'Test patch' for p in pg.evaluate("() => window.__plPatch.patchLib()")), 'Save keeps the patch')
        pg.evaluate(PICK, ['#patchPick', 's4'])
        pg.evaluate(PICK, ['#patchPick', 'u0'])
        back = pg.evaluate(PT)
        ok(back['name'] == 'Test patch' and [l['kind'] for l in back['layers']] == [l['kind'] for l in saved['layers']], 'loading the saved patch back')
        # An empty patch shows black but doesn't break, and the page keeps drawing
        pg.evaluate(PICK, ['#patchPick', 'new'])
        c.wait_frames(5, 'with an empty patch')
        ok(pg.evaluate("() => !!document.querySelector('#patchStack .pl-empty')"), 'an empty patch says how to start')
        # Every kind of layer, one at a time, draws without an error
        kinds_all = pg.evaluate("() => Object.keys(window.__plPatch.PATCH.KINDS)")
        pg.evaluate(PICK, ['#patchAdd', 'noise'])
        for k in kinds_all:
            if k == 'noise':
                continue
            pg.evaluate(PICK, ['#patchAdd', k])
            c.wait_frames(2, f'with a {k} layer')
            pg.evaluate(CLICK, '#patchStack .pl-layer[data-i="1"] [data-act="del"]')
        ok(True, f'all {len(kinds_all)} kinds of layer drew')
        # Autopilot picks patches too
        ok(pg.evaluate("() => { const r = []; for (let i = 0; i < 5; i++) r.push(window.__plPatch.randomPatch().layers.length); return r.every((n) => n > 0); }"), 'Autopilot\'s random patches have layers')
        # Spread out controls: each loop's column is a copy of the editor, and the stack works there too
        pg.evaluate(CLICK, '#wideBtn')
        c.wait_frames(6, 'after Spread out controls')
        M = "document.querySelector(`.loop-col .mirror[data-loop='B']`)"
        pg.evaluate("() => " + M + ".querySelector(\"button[data-src='patch']\").click()")
        c.wait_frames(6, 'after picking Patch in loop B\'s column')
        ok(pg.evaluate("() => window.__plPatch.loops.B.tgt.in1") == 'patch', "Patch picked in loop B's column")
        pg.evaluate("() => " + M + ".querySelector('.pl-layer [data-act=\"fold\"]').click()")
        c.wait_frames(6, 'after opening a layer in the column')
        got = pg.evaluate("() => { const m = " + M + "; const el = m.querySelector('.pl-body input[data-act=\"p\"]'); if (!el) return null;"
                          " el.focus(); el.value = 77; el.dispatchEvent(new Event('input', {bubbles: true})); el.blur();"
                          " const L = window.__plPatch.loops.B.tgt.patch.layers[0]; return L.p[el.dataset.k]; }")
        ok(got == 77, f"a fader in loop B's column moves loop B's patch ({got})")
        pg.evaluate(CLICK, '#wideBtn')
        b.close()
    srv.shutdown()
    fails += errors
    took = time.time() - t0
    if fails:
        print(f'FAIL after {took:.0f}s:')
        for x in dict.fromkeys(fails):
            print('  -', x)
        sys.exit(1)
    print(f'PASS in {took:.0f}s; pictures in {OUT}')


if __name__ == '__main__':
    main()
