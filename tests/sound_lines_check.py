"""Sound on lines (React to sound › Sound on lines, Line detail): Wave, Shape, Bars and Topo map carry the music's
sound wave. Made-up music is fed in as raw sound (window.__plSnd.fake). Waits are frames, never seconds.

  python3 tests/sound_lines_check.py          (about 2 minutes; pictures go to <temp>/phosphor-sound-lines)
"""
import os, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import patched_index, serve, Check, START_CEILING_S, FAIL_FAST_MS
from PIL import Image, ImageChops, ImageStat

SLOTS_JS = """(() => {
  const P = WebGL2RenderingContext.prototype, link = P.linkProgram, G = WebGL2RenderingContext;
  const rows = { [G.FLOAT_MAT2]: 2, [G.FLOAT_MAT3]: 3, [G.FLOAT_MAT4]: 4 };
  window.__plSlots = 0;
  P.linkProgram = function (prog) {
    link.call(this, prog);
    if (!this.getProgramParameter(prog, this.LINK_STATUS)) return;
    let n = 0;
    const count = this.getProgramParameter(prog, this.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) { const u = this.getActiveUniform(prog, i); n += (rows[u.type] || 1) * u.size; }
    window.__plSlots = Math.max(window.__plSlots, n);
  };
})();"""


def main():
    from playwright.sync_api import sync_playwright
    out = os.path.join(tempfile.gettempdir(), 'phosphor-sound-lines')
    os.makedirs(out, exist_ok=True)
    html, notes = patched_index(216)
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
        pg.add_init_script(SLOTS_JS)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.route(base + 'index.html', lambda r: r.fulfill(body=html, content_type='text/html'))
        pg.goto(base + 'index.html', timeout=START_CEILING_S * 1000)
        pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
        c = Check(pg, out)
        c.wait_frames(30, 'starting up', ceiling=START_CEILING_S)
        print(f'  biggest graphics program uses {pg.evaluate("window.__plSlots")} uniform slots (phones allow at least 224)')
        check(pg.evaluate("!document.getElementById('sndDetailRow').hidden"), 'Line detail shows while Sound on lines is on (on to start with)')
        pg.evaluate('__plSnd.fake()')
        pg.evaluate("""() => { const L = __plAp.loops; for (const k of ['A', 'B']) { Object.assign(L[k].tgt, { trails: 20, zoom: 0, spin: 0, warp: 0, mirror: 0, melt: 0, push: 0, dye: 0, flow: 0, in2: 'none' }); }
          L.B.tgt.in1 = 'none'; }""")
        for inp in ['wave', 'shape', 'bars', 'topo']:
            pg.evaluate(f"__plAp.loops.A.tgt.in1 = '{inp}'")
            pg.evaluate('__plClear()')
            c.wait_frames(60, f'{inp} with sound')
            line = pg.evaluate('__plSnd.line')
            spread = max(line) - min(line)
            check(pg.evaluate('__plSnd.on') and pg.evaluate("__plSnd.amp('A')") > 0, f'{inp}: the sound reaches loop A')
            check(spread > 0.5, f'{inp}: the sound wave has shape (spread {spread:.2f})')
            on_path, _ = c.picture(f'{inp}_sound')
            pg.evaluate("document.querySelector('#sndMap [data-map=lines]').click()")
            pg.evaluate('__plClear()')
            c.wait_frames(40, f'{inp} plain')
            check(pg.evaluate("__plSnd.amp('A')") == 0, f'{inp}: plain again with Sound on lines off')
            off_path, _ = c.picture(f'{inp}_plain')
            pg.evaluate("document.querySelector('#sndMap [data-map=lines]').click()")
            diff = ImageStat.Stat(ImageChops.difference(Image.open(on_path).convert('L'), Image.open(off_path).convert('L'))).mean[0]
            check(diff > 0.3, f'{inp}: the lines look different with the sound (difference {diff:.2f})')
            print(f'       pictures: {on_path}, {off_path}')
        pg.evaluate("document.querySelector('#sndMap [data-map=lines]').click()")
        check(pg.evaluate("document.getElementById('sndDetailRow').hidden"), 'Line detail hides with Sound on lines off')
        pg.evaluate("document.querySelector('#sndMap [data-map=lines]').click()")
        # Line detail: Fuzzy keeps more of the hi-hats, so the wave wiggles more from step to step
        def rough():   # how much the wave bends from step to step (fine detail), over 20 frames
            tot = 0
            for _ in range(20):
                c.wait_frames(1, 'reading the wave')
                v = pg.evaluate('__plSnd.line'); tot += sum(abs(v[i + 1] - 2 * v[i] + v[i - 1]) for i in range(1, len(v) - 1))
            return tot
        pg.evaluate("""() => { const e = document.getElementById('sndDetail'); e.value = 0; e.dispatchEvent(new Event('input')); }""")
        c.wait_frames(10, 'Smooth')
        smooth = rough()
        pg.evaluate("""() => { const e = document.getElementById('sndDetail'); e.value = 100; e.dispatchEvent(new Event('input')); }""")
        c.wait_frames(10, 'Fuzzy')
        fuzzy = rough()
        check(fuzzy > smooth * 2, f'Fuzzy shows more detail than Smooth ({fuzzy:.1f} against {smooth:.1f})')
        check(pg.evaluate("document.getElementById('sndDetailOut').textContent") == 'Fuzzy', 'Line detail reads Fuzzy')
        # Saved with a look
        snap = pg.evaluate('__plGrade.snapshot()')
        check(snap.get('snd', {}).get('detail') == 100 and snap['snd']['map'].get('lines') is True, 'a saved look keeps Sound on lines and Line detail')
        b.close()
    for e in errors: problems.append('page error: ' + e)
    print('PASS' if not problems else 'FAIL:\n  ' + '\n  '.join(problems))
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
