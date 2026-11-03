"""A block's look is there from its first frame: its settings, its Type art, and its mirror (Cut, or the Transition
picked in its details).

  python3 tests/seq_block_start_check.py       (about a minute; the sequence's own clock)

Checks: an Amount glide Autopilot left going doesn't pull Type art away from the block's line; the block's sliders
(Zoom here) don't glide in from the look before; its mirror is there straight away by default; picking Melt over 6 s
in its details (At the start its mirror comes in with…) brings it in that way instead, and is kept with the block.
Every wait is a number of frames or a condition with a ceiling.
"""
import functools
import os
import socketserver
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402


def main():
    html, _ = check.patched_index(216)
    body = html.encode('utf-8')

    class Site(check.QuietHandler):
        def do_GET(self):
            if self.path.split('?')[0] in ('/', '/index.html'):
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Site, directory=check.ROOT))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    problems = []

    def ok(cond, what):
        print(('  ok    ' if cond else '  FAIL  ') + what)
        if not cond:
            problems.append(what)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1400, 'height': 900})
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, tempfile.gettempdir())
        J = pg.evaluate
        click = lambda sel: J(f"document.querySelector('{sel}').click()")
        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', timeout=check.START_CEILING_S * 1000)
        c.wait_frames(10, 'starting up', ceiling=check.START_CEILING_S)
        # (Type art is slow in this workspace's software drawing, a few seconds a frame: generous ceilings)

        # Loop A before the sequence: Zoom 10, no mirror, settled. Type art at 90, gliding down to 0 over a minute
        J("""(() => { const L = __plAp.loops.A; L.tgt.zoom = 10; L.cur.zoom = 10; L.tgt.mirror = 0; L.mx = { from: 0, to: 0, e: 1 };
          __plType.setType({ ...__plType.typeArt, tAmt: 90 }); __plType.fadeTo(0, 60); })()""")
        c.wait_frames(3, 'glide under way', ceiling=120)
        ok(J("__plType.gliding"), 'Type art’s Amount is gliding (as Autopilot leaves it)')
        # One block: Zoom 80, Mirror 6, Type art amount 50 all through
        J("""(() => { const r = __plSeq.rec; r.blocks.length = 0;
          r.blocks.push({ id: 's1', track: 0, a: 0, b: 300, label: '', look: { ...__plAp.loops.A.tgt, zoom: 80, mirror: 6 }, fin: 0, fout: 0,
            autos: [{ key: 'tAmt', pts: [[0, 0.5], [1, 0.5]] }] }); })()""")
        click('#seqBtn')
        c.wait_frames(2, 'open', ceiling=120)
        click('#seqPlay')
        c.wait_frames(3, 'block started', ceiling=120)
        ok(J("__plType.typeArt.tAmt") == 50 and not J("__plType.gliding"), f"Type art is the block’s from the start ({J('__plType.typeArt.tAmt')}, gliding {J('__plType.gliding')})")
        c.wait_frames(6, 'a little later', ceiling=120)
        ok(J("__plType.typeArt.tAmt") == 50, f"and stays there ({J('__plType.typeArt.tAmt')})")
        ok(abs(J("__plAp.loops.A.cur.zoom") - 80) < 0.5, f"Zoom is the block’s from its first frames, not gliding in ({J('__plAp.loops.A.cur.zoom'):.1f})")
        mx = J("__plAp.loops.A.mx")
        ok(mx['to'] == 6 and mx['e'] >= 1, f'its mirror is there straight away ({mx})')

        # The block's details: At the start its mirror comes in with… Melt, over 6 s
        J("__plSeq.select('s1')")
        c.wait_frames(2, 'selected', ceiling=120)
        ok(J("!!document.querySelector('#seqInsp [data-sfx=\"cut\"][aria-pressed=\"true\"]')"), 'the block’s details offer how its mirror comes in, Cut to start with')
        click('#seqInsp [data-sfx="melt"]')
        c.wait_frames(1, 'melt', ceiling=120)
        click('#seqInsp [data-ssecs="6"]')
        c.wait_frames(1, '6 s', ceiling=120)
        ok(J("__plSeq.rec.blocks[0].mxIn") == ['melt', 6], f"kept with the block ({J('__plSeq.rec.blocks[0].mxIn')})")
        # From the top again, mirror Off before it
        click('#seqStop')
        c.wait_frames(2, 'stopped', ceiling=120)
        J("(() => { const L = __plAp.loops.A; L.tgt.mirror = 0; L.mx = { from: 0, to: 0, e: 1 }; })()")
        c.wait_frames(2, 'mirror off', ceiling=120)
        click('#seqPlay')
        c.wait_frames(3, 'block started again', ceiling=120)
        mx = J("__plAp.loops.A.mx")
        ok(mx['to'] == 6 and mx['from'] == 0 and 0 < mx['e'] < 1 and J("__plAp.loops.A.tgt.mirrorFx") == 'melt',
           f"now it melts in from the mirror before ({mx}, {J('__plAp.loops.A.tgt.mirrorFx')})")
        ok(abs(mx.get('secs', 0) - 6) < 0.01, f"over 6 s ({mx.get('secs')})")
        click('#seqStop')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll block-start checks passed.')


if __name__ == '__main__':
    main()
