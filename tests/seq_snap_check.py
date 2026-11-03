"""Snapping in the sequencer: a dragged block (or its end) snaps to the ends of blocks on other tracks.

  python3 tests/seq_snap_check.py       (about a minute; real mouse drags)

Checks: moving a block on track 2 so its start lands near the end of a block on track 1 puts it exactly there, with
the dashed snap line showing while dragging; its right end dragged near another block's start lands exactly on it;
with Alt held it doesn't snap. Every wait is a number of frames.
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
        pg = b.new_page(viewport={'width': 1600, 'height': 1000})
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, tempfile.gettempdir())
        J = pg.evaluate
        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', timeout=check.START_CEILING_S * 1000)
        c.wait_frames(10, 'starting up', ceiling=check.START_CEILING_S)
        J("""(() => { const r = __plSeq.rec, L = __plAp.loops.A.tgt; r.blocks.length = 0; r.markers.length = 0;
          r.blocks.push({ id: 'a1', track: 0, a: 20, b: 60, label: 'One', look: { ...L }, fin: 0, fout: 0, autos: [] });
          r.blocks.push({ id: 'b1', track: 1, a: 100, b: 130, label: 'Two', look: { ...L }, fin: 0, fout: 0, autos: [] });
          r.blocks.push({ id: 'a2', track: 0, a: 170, b: 200, label: 'Three', look: { ...L }, fin: 0, fout: 0, autos: [] }); })()""")
        J("document.querySelector('#seqBtn').click()")
        c.wait_frames(3, 'open')
        J("__plSeq.seek(230)")
        c.wait_frames(2, 'playhead out of the way')
        rect = lambda sel: J(f"(() => {{ const r = document.querySelector('{sel}').getBoundingClientRect(); return {{ x: r.x, y: r.y, w: r.width, h: r.height }}; }})()")
        blk = lambda i: J(f"(() => {{ const b = __plSeq.rec.blocks.find(x => x.id === '{i}'); return [b.a, b.b, b.track]; }})()")
        r = rect('.seq-blk[data-id="b1"]')
        pps = r['w'] / 30.0

        def drag(x0, y0, x1, y1, alt=False, look=None):
            pg.mouse.move(x0, y0)
            if alt:
                pg.keyboard.down('Alt')
            pg.mouse.down()
            for i in range(1, 9):
                pg.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8)
            seen = J(look) if look else None
            pg.mouse.up()
            if alt:
                pg.keyboard.up('Alt')
            c.wait_frames(2, 'dropped')
            return seen

        # Track 2's block moved so its start lands 1.5 s past the end of track 1's first block (60 s): it snaps to 60
        y = r['y'] + r['h'] / 2
        x0 = r['x'] + r['w'] * 0.5
        line = drag(x0, y, x0 - (40 - 1.5) * pps, y, look="!document.querySelector('#seqSnapLine').hidden")
        ok(line, 'the dashed snap line shows while it snaps')
        a, bb, tr = blk('b1')
        ok(abs(a - 60) < 0.011 and tr == 1, f'its start snapped to the end of the block on track 1 (60 s; it’s at {a:.2f} s, track {tr + 1})')
        ok(J("document.querySelector('#seqSnapLine').hidden"), 'the snap line goes when you let go')
        # Its right end dragged near the start of track 1's third block (170 s): it lands on 170
        r = rect('.seq-blk[data-id="b1"] .eg.r')
        x0, y = r['x'] + r['w'] / 2, r['y'] + r['h'] / 2
        a, bb, _ = blk('b1')
        drag(x0, y, x0 + (170 - bb - 1.2) * pps, y)
        a, bb, _ = blk('b1')
        ok(abs(bb - 170) < 0.011, f'its end snapped to the start of the block on track 1 (170 s; it’s at {bb:.2f} s)')
        # With Alt held: no snapping
        r = rect('.seq-blk[data-id="b1"]')
        a0, _, _ = blk('b1')
        x0, y = r['x'] + r['w'] * 0.5, r['y'] + r['h'] / 2
        drag(x0, y, x0 + 1.5 * pps, y, alt=True)
        a, _, _ = blk('b1')
        ok(abs(a - (a0 + 1.5)) < 0.3 and abs(a - 60) > 0.5, f'with Alt held it moves freely ({a0:.2f} → {a:.2f} s)')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll snapping checks passed.')


if __name__ == '__main__':
    main()
