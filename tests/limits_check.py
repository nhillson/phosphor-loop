"""Frame rate limit and Resolution limit (under Screen; both No limit at first).

  python3 tests/limits_check.py     (about a minute)

Resolution limit: with Picture sharpness on Full the picture is drawn with more than 240 lines; at a 240 limit the
loops and the screen's canvas are 240 lines; the limit is remembered after a reload; No limit brings the lines back.
Frame rate limit: the fader snaps (29 -> 30) and its top is No limit; a limit below what this workspace manages
(1.5 a second, set from the test, under the fader's lowest of 10) slows the drawing to about that; off, it speeds up
again. Every wait is a number of frames (drawn frames, for the frame rate part).
"""
import functools
import os
import socketserver
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402


def main():
    out = os.path.join(tempfile.gettempdir(), 'phosphor-limits-check')
    os.makedirs(out, exist_ok=True)
    html, notes = check.patched_index(216)
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
    base = f'http://127.0.0.1:{srv.server_address[1]}/'
    problems = []

    def ok(cond, what):
        print(('  ok    ' if cond else '  FAIL  ') + what)
        if not cond:
            problems.append(what)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1400, 'height': 900})
        pg = ctx.new_page()
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, out)
        pg.goto(base + 'index.html', timeout=check.START_CEILING_S * 1000)
        c.wait_frames(20, 'starting up', ceiling=check.START_CEILING_S)
        J = lambda js: pg.evaluate(js)

        def drawn(n, what, ceiling=60):
            """Wait for n more frames actually drawn; returns drawn frames a second."""
            start = J('__plLimits.drawnFrames')
            t = time.time()
            pg.wait_for_function(f'__plLimits.drawnFrames >= {start + n}', polling=50, timeout=ceiling * 1000)
            return n / max(time.time() - t, 1e-3)

        ok(J('__plLimits.set') == {'fps': 0, 'res': 0}, 'both limits start at No limit')
        ok(J("document.querySelector('#fpsLimOut').textContent") == 'NO LIMIT', 'Frame rate limit reads NO LIMIT')

        # Resolution
        J("document.querySelector('#sharp [data-sharp=\"full\"]').click()")
        c.wait_frames(5, 'sharpness Full')
        full = J('__plLimits.lines')
        ok(full > 240, f'Full sharpness, no limit: {full} lines')
        J("(() => { const e = document.querySelector('#resLim'); e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); })()")
        c.wait_frames(5, 'limit 240')
        d = J('__plLimits.drawn')
        ok(J('__plLimits.lines') == 240, f'limit 240: the loops are drawn with {J("__plLimits.lines")} lines')
        ok(d['h'] == 240, f'limit 240: the screen\'s canvas is {d["w"]} x {d["h"]}')
        ok(J("document.querySelector('#resLimOut').textContent") == '240', 'the read-out says 240')
        ok(J("document.querySelector('#linesOut').textContent").startswith('· 240 lines'), 'the top of the page says 240 lines')
        pg.reload(timeout=check.START_CEILING_S * 1000)
        c.wait_frames(10, 'after a reload', ceiling=check.START_CEILING_S)
        ok(J('__plLimits.set')['res'] == 240 and J('__plLimits.lines') == 240, 'the limit is remembered after a reload')
        J("document.querySelector('#resLim').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
        c.wait_frames(5, 'no limit')
        ok(J('__plLimits.set')['res'] == 0 and J('__plLimits.lines') > 240, f'double-click: No limit, {J("__plLimits.lines")} lines')
        J("document.querySelector('#sharp [data-sharp=\"auto\"]').click()")
        c.wait_frames(3, 'sharpness Auto')

        # Frame rate
        J("(() => { const e = document.querySelector('#fpsLim'); e.value = 29; e.dispatchEvent(new Event('input', { bubbles: true })); })()")
        ok(J('__plLimits.set')['fps'] == 30 and J("document.querySelector('#fpsLim').value") == '30', 'the fader snaps 29 to 30')
        J("(() => { const e = document.querySelector('#fpsLim'); e.value = 145; e.dispatchEvent(new Event('input', { bubbles: true })); })()")
        ok(J('__plLimits.set')['fps'] == 0, 'the fader\'s top is No limit')
        free = drawn(12, 'no limit')
        print(f'        (this workspace draws about {free:.1f} frames a second with no limit)')
        J('__plLimits.forceFps(1.5)')
        drawn(2, 'settling at 1.5')
        slow = drawn(9, 'limit 1.5')
        ok(slow < 1.8, f'limit 1.5: about {slow:.1f} frames a second drawn')
        ok(free > slow * 1.3, 'no limit drew faster than the limit')
        J('__plLimits.forceFps(0)')
        again = drawn(12, 'limit off')
        ok(again > slow * 1.3, f'off again: about {again:.1f} frames a second')
        ok(not errors, 'no page errors' + (': ' + '; '.join(errors[:3]) if errors else ''))
        b.close()
    srv.shutdown()
    for n in notes:
        print('  note  ' + n)
    if problems:
        sys.exit(f'FAIL: {len(problems)} problem(s)')
    print('PASS')


if __name__ == '__main__':
    main()
