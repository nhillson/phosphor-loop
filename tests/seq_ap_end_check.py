"""Back to a sequence after its end started Autopilot: nothing Autopilot brought in stays behind the sequence's looks.

  python3 tests/seq_ap_end_check.py       (about a minute; the sequence's own clock)

A sequence on track 1 only, set to Start Autopilot at the end; loop B (no blocks) is yours, showing Bars at 80. Once
the sequence has ended and Autopilot runs, Autopilot's kind of changes are made to loop B and the faders; going back
into the sequence (a jump back, then Play after another end) brings loop B, its fader and the feeds back as they were
when the sequence ended, and Autopilot stops. Every wait is a number of frames or a condition with a ceiling.
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
        J = pg.evaluate

        def until(js, what, ceiling_s=30):
            try:
                pg.wait_for_function(js, polling=200, timeout=int(ceiling_s * 1000))
                return True
            except Exception:
                ok(False, what + f' (waited {ceiling_s} s)')
                return False

        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', timeout=check.START_CEILING_S * 1000)
        c.wait_frames(10, 'starting up', ceiling=check.START_CEILING_S)
        fader = "(id) => +document.querySelector(id).value"
        J("""__plAp.loops.B.tgt.in1 = 'bars'; __plAp.loops.B.tgt.in2 = 'none';
          { const s = document.querySelector('#showB'); s.value = '80'; s.dispatchEvent(new Event('input')); }""")
        J("""(() => { const r = __plSeq.rec; r.blocks.length = 0; r.end = 'auto';
          r.blocks.push({ id: 'p1', track: 0, a: 0, b: 2, label: '', look: { ...__plAp.loops.A.tgt, in1: 'patchwork' }, fin: 0, fout: 0, autos: [] }); })()""")
        J("document.querySelector('#seqBtn').click()")
        c.wait_frames(2, 'open')
        J("document.querySelector('#seqPlay').click()")
        until("__plSeq.running && __plSeq.t > 0.2", 'the sequence did not start')
        until("document.documentElement.classList.contains('ap-on')", 'Autopilot did not start at the end of the sequence', 60)
        # Autopilot's kind of changes: loop B's input, its fader, a feed
        J("""__plAp.loops.B.tgt.in1 = 'wave'; __plAp.loops.B.tgt.in2 = 'camera' === 'x' ? 'none' : 'sparks';
          { const s = document.querySelector('#showB'); s.value = '35'; s.dispatchEvent(new Event('input')); }""")
        c.wait_frames(4, 'autopilot changes')
        ok(J("__plAp.loops.B.tgt.in1") == 'wave', 'Autopilot changed loop B meanwhile')
        # A jump back into the sequence (made long now, so it doesn't end again while it's looked at here)
        J("__plSeq.rec.blocks[0].b = 120; __plSeq.seek(0.3)")
        c.wait_frames(6, 'back in the sequence')
        ok(not J("document.documentElement.classList.contains('ap-on')"), 'going back into the sequence stops Autopilot')
        ok(J("__plAp.loops.B.tgt.in1") == 'bars' and J("__plAp.loops.B.tgt.in2") == 'none',
           f"loop B is back as it was when the sequence ended ({J('__plAp.loops.B.tgt.in1')} + {J('__plAp.loops.B.tgt.in2')})")
        ok(abs(J(f"({fader})('#showB')") - 80) < 1.5, f"and its fader ({J(f'({fader})(\"#showB\")')})")
        ok(J("__plAp.loops.A.tgt.in1") == 'patchwork', 'loop A plays the sequence’s look again')
        # Again, this time pressing Play after the end
        J("__plSeq.rec.blocks[0].b = 0.5")
        until("document.documentElement.classList.contains('ap-on')", 'Autopilot did not start at the second end', 60)
        J("__plAp.loops.B.tgt.in1 = 'shape'")
        c.wait_frames(3, 'autopilot again')
        J("document.querySelector('#seqStop').click()")
        c.wait_frames(3, 'stopped')
        J("__plSeq.rec.blocks[0].b = 120")
        J("document.querySelector('#seqPlay').click()")
        c.wait_frames(6, 'played again')
        ok(J("__plSeq.running"), 'Play runs the sequence again')
        ok(J("__plAp.loops.B.tgt.in1") == 'bars', f"after Stop and Play too, loop B is back as it was ({J('__plAp.loops.B.tgt.in1')})")
        ok(not J("document.documentElement.classList.contains('ap-on')"), 'Autopilot is off')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll end-of-sequence checks passed.')


if __name__ == '__main__':
    main()
