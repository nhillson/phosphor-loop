"""Play over it: your hand on top of a playing sequence (no real Spotify: the sequence runs on its own clock).

  python3 tests/seq_hand_check.py     (about a minute and a half)

With Play over it on (the default), a fader moved on a loop the sequence plays keeps the sequence going and adds
your amount to the sequence's own value: a plain setting stays shifted, a change line keeps moving with your amount
on top, and a new block keeps your amount too. Picking an input or moving Show doesn't stop the sequence. Let go
gives it all back (the block's input too); a double-click gives back one fader; "Drifts back" eases a fader back to
the sequence after you let go of it. Every wait is a number of frames.
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
        T = lambda key: J(f"__plAp.loops.A.tgt.{key}")
        slide = lambda sel, v: J(f"(() => {{ const e = document.querySelector('{sel}'); e.value = '{v}'; e.dispatchEvent(new Event('input')); }})()")
        live = lambda: not J("document.querySelector('#handA').hidden")
        # A block on track 1 over 0-60 s: Color 30 (a plain setting) and a Trails line from 20 up to 60
        J("""__plSeq.rec.blocks.push({ id: 'b1', track: 0, a: 0, b: 60, label: '',
              look: { ...__plAp.loops.A.tgt, in1: 'patchwork', in2: 'none', color: 30 }, fin: 0, fout: 0,
              autos: [{ key: 'trails', pts: [[0, 0.2], [1, 0.6]] }] })""")
        J("document.querySelector('#seqBtn').click()")
        c.wait_frames(2, 'open')
        ok(J("document.querySelector('#seqHandOn').getAttribute('aria-pressed')") == 'true', 'Play over it is on to start with')
        click('#seqPlay')
        c.wait_frames(6, 'playing')
        ok(J("__plSeq.running") and T('color') == 30, 'the sequence plays its block')
        ok(not live() and J("document.querySelector('#seqLetGo').disabled"), 'no LIVE tag and Let go is greyed out before you touch anything')

        # A plain setting: stays where you put it
        slide('#color', 50)
        c.wait_frames(6, 'moved Color')
        ok(J("__plSeq.running") and T('color') == 50, f"Color moved by hand stays at 50, the sequence keeps going ({T('color')})")
        ok(live() and not J("document.querySelector('#seqLetGo').disabled"), 'loop A shows LIVE and Let go lights up')

        # A change line: keeps moving, with your amount on top
        line = lambda: J("20 + 40 * Math.min(1, __plSeq.t / 60)")
        slide('#trails', round(T('trails') + 20))
        c.wait_frames(4, 'moved Trails')
        d1 = T('trails') - line()
        c.wait_frames(20, 'the line moves on')
        d2 = T('trails') - line()
        ok(abs(d1 - 20) < 2.5 and abs(d2 - 20) < 2.5, f'Trails rides its change line 20 higher ({d1:.1f}, then {d2:.1f})')

        # An input and Show: the sequence doesn't stop
        click('#inputs button[data-src="wave"]')
        slide('#showA', 50)
        c.wait_frames(6, 'picked an input, lowered Show')
        ok(J("__plSeq.running"), 'picking an input and moving Show don’t stop the sequence')
        ok(T('in1') == 'wave', f"your input stays ({T('in1')})")
        ok(abs(J("+document.querySelector('#showA').value") - 50) < 1, f"Show stays where you put it ({J('+document.querySelector("#showA").value')})")

        # The next block: your amounts and input stay on top of it
        J("""(() => { const t = __plSeq.t, b1 = __plSeq.rec.blocks[0]; b1.b = t + 0.3;
              __plSeq.rec.blocks.push({ ...b1, id: 'b2', a: t + 0.3, b: 120, look: { ...b1.look, color: 10 }, autos: [] }); })()""")
        c.wait_frames(14, 'the next block')
        ok(J("__plSeq.running") and T('color') == 30, f"the next block (Color 10) comes in with your +20 on it ({T('color')})")
        ok(T('in1') == 'wave', 'and your input still holds')

        # Let go: all back
        click('#seqLetGo')
        c.wait_frames(6, 'let go')
        ok(T('color') == 10 and T('in1') == 'patchwork', f"Let go: the block’s Color and input come back ({T('color')}, {T('in1')})")
        ok(abs(J("+document.querySelector('#showA').value") - 100) < 1, 'and its Show')
        ok(not live() and J("document.querySelector('#seqLetGo').disabled"), 'the LIVE tag goes away')

        # Double-click: one fader back
        slide('#color', 70)
        c.wait_frames(4, 'moved Color')
        J("document.querySelector('#color').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
        c.wait_frames(4, 'double-clicked')
        ok(T('color') == 10 and J("__plSeq.running"), f"double-clicking Color gives just it back to the sequence ({T('color')})")

        # Drifts back
        J("(() => { const s = document.querySelector('#seqHandDrift'); s.value = '2'; s.dispatchEvent(new Event('change')); })()")
        slide('#color', 60)
        c.wait_frames(2, 'moved Color')
        first = T('color')
        gone = False
        for _ in range(40):
            c.wait_frames(3, 'drifting back')
            if T('color') == 10 and not live():
                gone = True
                break
        ok(10 < first < 60 and gone, f'with “Drifts back, 2 s”, Color eases from {first} back to the sequence’s 10 ({T("color")})')
        ok(J("localStorage.getItem('phosphor-seq-hand')").find('"secs":2') >= 0, 'the drift choice is kept for next time')

        # Stop: what's on screen stays, nothing held
        J("(() => { const s = document.querySelector('#seqHandDrift'); s.value = '0'; s.dispatchEvent(new Event('change')); })()")
        slide('#color', 80)
        c.wait_frames(3, 'moved Color')
        click('#seqPlay')
        c.wait_frames(4, 'stopped')
        ok(not J("__plSeq.running") and T('color') == 80 and not live(), f"Stop keeps what’s on screen, with nothing held ({T('color')})")
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll Play over it checks passed.')


if __name__ == '__main__':
    main()
