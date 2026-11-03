"""Mirror as a change over time in the sequencer (no Spotify: the sequence runs on its own clock).

  python3 tests/seq_mirror_check.py     (about a minute)

A block's Mirror line steps Off → 2 → 4 → 6 → 8 as it climbs, each step coming in through the line's Transition
over the line's time (Iris over 6 s here; Cut switches at once), and the Mirror buttons follow. Picking the
Transition and time in the block's details changes the line. Every wait is a number of frames.
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
        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', timeout=check.START_CEILING_S * 1000)
        c.wait_frames(10, 'starting up', ceiling=check.START_CEILING_S)
        J = pg.evaluate
        J("document.querySelector('#seqBtn').click()")
        c.wait_frames(2, 'open')
        # A block on track 1, its Mirror line from Off at the start to 8 at the end
        J("""(() => { const look = { ...__plAp.loops.A.tgt, mirror: 0 };
          __plSeq.rec.blocks.push({ id: 'm1', track: 0, a: 0, b: 400, label: '', look, fin: 0, fout: 0,
            autos: [{ key: 'mirror', pts: [[0, 0], [1, 1]], fx: 'iris', secs: 6 }] }); })()""")
        ok(J("document.querySelector('#seqView') !== null"), 'the sequencer is open')
        # Seek through the block by its own clock: each fifth of the way, one step up
        seen = []
        J("document.querySelector('#seqPlay').click()")
        for at in (10, 60, 130, 210, 290, 360, 399):
            J(f"__plSeq.seek({at})")
            c.wait_frames(4, f'at {at} s')
            seen.append((at, J("__plAp.loops.A.tgt.mirror"), J("__plAp.loops.A.tgt.mirrorFx"), J("(__plAp.loops.A.mx || {}).secs || 0")))
        steps = [m for _, m, _, _ in seen]
        ok(steps == sorted(steps) and set(steps) >= {0, 2, 4, 6, 8}, f'the mirror steps up Off → 8 as the line climbs ({steps})')
        ok(all(fx == 'iris' for _, m, fx, _ in seen if m), f"each step comes in with the line's Transition, Iris ({[fx for _, _, fx, _ in seen]})")
        ok(any(abs(s - 6) < 0.01 for _, m, _, s in seen if m), f"over the line's 6 seconds ({[s for _, _, _, s in seen]})")
        ok(J("+document.querySelector('#mirror button[aria-pressed=\"true\"]').dataset.mirror") == steps[-1], 'the Mirror buttons follow')
        # The block's details: pick Ripple over 1 s
        J("__plSeq.select('m1')")
        c.wait_frames(2, 'selected')
        ok(J("!!document.querySelector('#seqInsp [data-mfx=\"iris\"][aria-pressed=\"true\"]')"), "the block's details show the line's Transition")
        J("document.querySelector('#seqInsp [data-mfx=\"ripple\"]').click()")
        J("document.querySelector('#seqInsp [data-msecs=\"1\"]').click()")
        au = J("__plSeq.rec.blocks.find(b => b.id === 'm1').autos[0]")
        ok(au['fx'] == 'ripple' and au['secs'] == 1, f"picking Ripple over 1 s changes the line ({au['fx']}, {au['secs']})")
        c.wait_frames(3, 'drawn')
        try:
            pg.screenshot(path=os.path.join(tempfile.gettempdir(), 'seq-mirror.png'), timeout=30000)
        except Exception as e:
            print('  note: no picture', str(e).splitlines()[0])
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll Mirror change checks passed.')


if __name__ == '__main__':
    main()
