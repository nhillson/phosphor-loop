"""Autopilot's Use Type art switch (under Autopilot; off at first).

  python3 tests/ap_type_check.py     (about a minute and a half)

Off: twenty new looks never touch Type art. On: over twenty new looks it comes in (amount fading up over the Fade
time, its characters, font and color picked) and goes out again; the switch is remembered after a reload; and a
hand on a Type art control stops the fade. Every wait is a number of frames.
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
    out = os.path.join(tempfile.gettempdir(), 'phosphor-ap-type-check')
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
        pg = b.new_context(viewport={'width': 1400, 'height': 900}).new_page()
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, out)
        pg.goto(base + 'index.html', timeout=check.START_CEILING_S * 1000)
        c.wait_frames(20, 'starting up', ceiling=check.START_CEILING_S)
        J = lambda js: pg.evaluate(js)
        click = lambda sel: pg.evaluate(f"document.querySelector('{sel}').click()")
        ty = lambda: J("__plGrade.snapshot().type")

        ok(J("document.querySelector('#apType').getAttribute('aria-pressed')") == 'false', 'Use Type art is off at first')
        click('#autopilotBar')
        c.wait_frames(3, 'autopilot on')
        before = ty()
        for _ in range(20):
            J("__plAp.step()")
            c.wait_frames(2, 'new look')
        ok(ty() == before, 'off: twenty new looks leave Type art alone')

        click('#apType')
        ok(J("document.querySelector('#apType').getAttribute('aria-pressed')") == 'true', 'the switch turns on')
        J("__plAp.apSet.fade = 0")   # fades of about a second and a half, so the test sees them finish
        came_in, went_out, sets = False, False, set()
        for _ in range(30):
            J("__plAp.step()")
            c.wait_frames(14, 'fading')
            t = ty()
            sets.add((t['tSet'], t['tFont'], t['tColor']))
            if t['tAmt'] > 0:
                came_in = True
            elif came_in:
                went_out = True
            if came_in and went_out and len(sets) >= 3:
                break
        ok(came_in, 'on: Type art comes in with some new looks')
        ok(went_out, 'and goes out again with others')
        ok(len(sets) >= 2, f'its characters, font and color change ({len(sets)} different)')
        try:
            pg.screenshot(path=os.path.join(out, 'type-on.png'), timeout=20000)
        except Exception as e:
            print('  note: no picture', str(e).splitlines()[0])

        # A hand on the amount: the fade stops there
        J("__plAp.apSet.fade = 100; __plAp.step()")
        c.wait_frames(2, 'slow fade')
        J("document.querySelector('#tAmt').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
        J("(() => { const e = document.querySelector('#tAmt'); e.value = '33'; e.dispatchEvent(new Event('input', { bubbles: true })); })()")
        c.wait_frames(10, 'held')
        ok(ty()['tAmt'] == 33, f"moving Type art’s amount by hand stops Autopilot’s fade ({ty()['tAmt']})")

        J("__plAp.apSet.fade = 63")
        pg.reload(timeout=check.START_CEILING_S * 1000)
        c.wait_frames(20, 'reloaded', ceiling=check.START_CEILING_S)
        ok(J("document.querySelector('#apType').getAttribute('aria-pressed')") == 'true', 'the switch is remembered after a reload')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}:')
        for x in problems:
            print('  - ' + x)
        sys.exit(1)
    print('\nAll Type art Autopilot checks passed.')


if __name__ == '__main__':
    main()
