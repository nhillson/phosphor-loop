"""Type art over time in the sequencer (no Spotify: the sequence runs on its own clock).

  python3 tests/seq_type_check.py     (about a minute)

Change over time… offers Type art amount, Character size and Shimmer. A block's Amount line fades Type art up and
its Character size line grows the characters, following the lines; what you'd set comes back when the sequence
stops. Every wait is a number of frames.
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
        pg = b.new_page(viewport={'width': 1400, 'height': 1000})
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, tempfile.gettempdir())
        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', timeout=check.START_CEILING_S * 1000)
        c.wait_frames(10, 'starting up', ceiling=check.START_CEILING_S)
        J = pg.evaluate
        ty = lambda: J("__plGrade.snapshot().type")
        before = ty()
        J("document.querySelector('#seqBtn').click()")
        c.wait_frames(2, 'open')
        # The Change over time menu offers the three
        J("__plSeq.rec.blocks.push({ id: 't1', track: 0, a: 0, b: 400, label: '', look: { ...__plAp.loops.A.tgt }, fin: 0, fout: 0, autos: [] }); __plSeq.select('t1')")
        c.wait_frames(2, 'drawn')
        J("""(() => { const e = document.querySelector('.seq-blk[data-id="t1"]'), r = e.getBoundingClientRect();
          e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 40, clientY: r.y + 20 })); })()""")
        J("[...document.querySelectorAll('.seq-menu.fixed button')].find(b => b.textContent.startsWith('Change over time')).click()")
        names = J("[...document.querySelectorAll('.seq-menu.fixed button')].map(b => b.textContent)")
        ok(all(n in names for n in ('Type art amount', 'Character size', 'Shimmer')), f'Change over time… offers Type art amount, Character size and Shimmer')
        J("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); document.body.click()")
        # Amount 0 → 100 % over the block, Character size 10 → 90
        J("""(() => { const bl = __plSeq.rec.blocks.find(b => b.id === 't1');
          bl.autos = [{ key: 'tAmt', pts: [[0, 0], [1, 1]] }, { key: 'tSize', pts: [[0, 0.1], [1, 0.9]] }]; })()""")
        J("document.querySelector('#seqPlay').click()")
        got = {}
        for at in (40, 200, 360):
            J(f"__plSeq.seek({at})")
            c.wait_frames(4, f'at {at} s')
            got[at] = (ty()['tAmt'], ty()['tSize'])
        print('   ', got)
        ok(got[40][0] < got[200][0] < got[360][0] and abs(got[200][0] - 50) <= 3, f'Type art’s amount follows its line ({[v[0] for v in got.values()]})')
        ok(got[40][1] < got[200][1] < got[360][1] and abs(got[200][1] - 50) <= 3, f'and Character size follows its line ({[v[1] for v in got.values()]})')
        fv = J("[+document.querySelector('#tAmt').value, __plGrade.snapshot().type.tAmt]")
        ok(abs(fv[0] - fv[1]) <= 3 and fv[0] > 80, f'the Type art faders follow along ({fv[0]} on the fader, {fv[1]} in use)')
        J("document.querySelector('#seqPlay').click()")
        c.wait_frames(3, 'stopped')
        after = ty()
        ok(after['tAmt'] == before['tAmt'] and after['tSize'] == before['tSize'], f"stopping puts Type art back as you had it ({after['tAmt']}, {after['tSize']})")
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll Type art over time checks passed.')


if __name__ == '__main__':
    main()
