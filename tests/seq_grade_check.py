"""A block keeps the Color grading it was added with, and From the start plays the sequence from its very beginning.

  python3 tests/seq_grade_check.py       (about a minute; the sequence's own clock)

Checks: + Add current look keeps the grading on screen with the block; playing, that loop is graded the block's way
and a loop with no block of its own is graded yours (and yours isn't laid over everything as well); the block's
details list its grading, and None takes it off; stopping puts grading back as you have it; From the start plays from
0:00. Every wait is a number of frames.
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
        J("__plSeq.rec.blocks.length = 0; __plGrade.setGrade({ gSat: 150, gHue: 0 })")
        click('#seqBtn')
        c.wait_frames(2, 'open')
        click('#seqAddCurrent')
        c.wait_frames(2, 'added')
        g = J("__plSeq.rec.blocks[0] && __plSeq.rec.blocks[0].grade")
        ok(g and g.get('gSat') == 150, f'+ Add current look keeps the grading on screen with the block ({g})')
        J("__plSeq.select(__plSeq.rec.blocks[0].id)")
        c.wait_frames(2, 'selected')
        insp = J("document.querySelector('#seqInsp').textContent")
        ok('Color grading: Saturation' in insp, f'the block’s details list its grading (“{insp[insp.find("Color grading"):][:60]}”)')
        # Your grading changes afterwards: hue 40, saturation back to normal
        J("__plGrade.setGrade({ gSat: 100, gHue: 40 })")
        click('#seqPlay')
        c.wait_frames(5, 'playing')
        lg = J("__plGrade.loop()")
        ok(lg['A'] and lg['A']['gSat'] == 150 and lg['A'].get('gHue', 0) == 0, f"loop A is graded the block’s way ({lg['A']})")
        ok(lg['B'] and lg['B']['gHue'] == 40, f"loop B (no block of its own) is graded yours ({lg['B']})")
        ok(J("__plGrade.owned()"), 'and yours isn’t laid over the whole picture as well')
        click('#seqInsp [data-grade="none"]')
        c.wait_frames(4, 'none')
        ok(not J("__plSeq.rec.blocks[0].grade"), 'None takes the block’s grading off')
        lg = J("__plGrade.loop()")
        ok(lg['A'] is None or lg['A'].get('gHue') == 40, f"loop A then shows yours ({lg['A']})")
        click('#seqInsp [data-grade="now"]')
        c.wait_frames(2, 'now')
        ok((J("__plSeq.rec.blocks[0].grade") or {}).get('gHue') == 40, 'Use the grading on screen gives it yours as it is now')
        click('#seqStop')
        c.wait_frames(3, 'stopped')
        ok(all(v is None for v in J("__plGrade.loop()").values()) and not J("__plGrade.owned()"), 'stopping puts grading back as you have it')
        # From the start
        J("__plSeq.seek(9)")
        c.wait_frames(2, 'moved')
        click('#seqTop')
        # (the playhead is caught as soon as it moves: this workspace draws a frame or two a second)
        try:
            pg.wait_for_function("__plSeq.running && __plSeq.t < 1.5", polling=50, timeout=10000)
            started = True
        except Exception:
            started = False
        ok(started, f"From the start plays from 0:00 (it was at 9 s; now {J('__plSeq.t'):.1f} s)")
        click('#seqStop')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll grading and From the start checks passed.')


if __name__ == '__main__':
    main()
