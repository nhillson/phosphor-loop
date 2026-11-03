"""A sequence playing, and your hand on the loops (no real Spotify: the sequence runs on its own clock).

  python3 tests/seq_takeover_check.py     (about a minute)

A sequence with blocks only on track 1 leaves loop B alone (it used to hide it the whole time); picking an input on
loop A while the sequence plays it stops the sequence (you took over); stopping gives back the loops the sequence
hid. Every wait is a number of frames. (This is with Play over it off; seq_hand_check.py tests it on.)
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
        pg = b.new_page()
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, tempfile.gettempdir())
        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', timeout=check.START_CEILING_S * 1000)
        c.wait_frames(10, 'starting up', ceiling=check.START_CEILING_S)
        J = pg.evaluate
        click = lambda sel: J(f"document.querySelector('{sel}').click()")
        # Loop B shown alongside A, and a block on track 1 only, 0-40 s, a gap after it
        J("__plAp.loops.B.tgt.in1 = 'bars'; document.querySelector('#showB').value = '80'; document.querySelector('#showB').dispatchEvent(new Event('input'))")
        J("__plSeq.rec.blocks.push({ id: 'b1', track: 0, a: 0, b: 2, label: '', look: { ...__plAp.loops.A.tgt, in1: 'patchwork' }, fin: 0, fout: 0, autos: [] })")
        J("document.querySelector('#seqBtn').click()")
        c.wait_frames(2, 'open')
        click('#seqPlay')
        c.wait_frames(6, 'playing')
        ok(J("__plSeq.running"), 'the sequence plays')
        ok(J("__plAp.loops.A.tgt.in1") == 'patchwork', 'loop A takes the block’s look')
        ok(J("+document.querySelector('#showB').value") >= 79, f"loop B (no blocks on its track) stays shown ({J('document.querySelector(\"#showB\").value')})")
        # Past the block, before the next: loop A is hidden in the gap (that's the sequence's), then Stop gives it back
        J("__plSeq.rec.blocks[0].b = 0.6; __plSeq.rec.blocks.push({ ...__plSeq.rec.blocks[0], id: 'b2', a: 200, b: 210 })")
        c.wait_frames(8, 'past the block')
        ok(J("+document.querySelector('#showA').value") < 1, 'in the gap after its block, loop A is hidden by the sequence')
        click('#seqPlay')
        c.wait_frames(4, 'stopped')
        ok(not J("__plSeq.running"), 'Stop stops it')
        ok(J("+document.querySelector('#showA').value") >= 99, f"stopping gives loop A back ({J('document.querySelector(\"#showA\").value')})")
        # Playing again, then picking an input on loop A: you take over
        # (with Play over it off: on, your hand rides on top instead, see seq_hand_check.py)
        click('#seqHandOn')
        ok(J("document.querySelector('#seqHandOn').getAttribute('aria-pressed')") == 'false', 'Play over it switched off')
        J("__plSeq.rec.blocks[0].b = 60; __plSeq.rec.blocks.length = 1")
        click('#seqPlay')
        c.wait_frames(6, 'playing again')
        J("document.querySelector('.loop-tab[data-k=\"A\"], [data-edit=\"A\"]') && document.querySelector('.loop-tab[data-k=\"A\"], [data-edit=\"A\"]').click()")
        click('#inputs button[data-src="wave"]')
        c.wait_frames(6, 'took over')
        ok(not J("__plSeq.running"), 'picking an input on a loop the sequence plays stops the sequence')
        ok(J("__plAp.loops.A.tgt.in1") == 'wave' and J("+document.querySelector('#showA').value") >= 99, 'and your input stays, on screen')
        ok('You took over' in J("document.querySelector('#seqNote').textContent"), 'the sequencer says so')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll take-over checks passed.')


if __name__ == '__main__':
    main()
