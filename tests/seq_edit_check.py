"""Edit this look: a block's look changed with the ordinary controls, then Save to block (or Cancel).

  python3 tests/seq_edit_check.py       (about a minute)

Checks: right-click › Edit this look… puts the block's look on its loop (and its Color grading on the faders), shows
the bar; Play waits until the edit is saved or cancelled; Save to block keeps the changed look and grading, and your
own grading comes back; Cancel leaves the block as it was and puts the loop back. Every wait is a number of frames.
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
        slider = lambda sel, v: J(f"(() => {{ const s = document.querySelector('{sel}'); s.value = '{v}'; s.dispatchEvent(new Event('input', {{ bubbles: true }})); }})()")
        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', timeout=check.START_CEILING_S * 1000)
        c.wait_frames(10, 'starting up', ceiling=check.START_CEILING_S)
        # Loop A as you have it: Bars, Zoom 70, your grading Hue 20. The block: Patchwork, Zoom 30, Saturation 150
        J("""__plAp.loops.A.tgt.in1 = 'bars'; __plAp.loops.A.tgt.zoom = 70; __plGrade.setGrade({ gHue: 20, gSat: 100 });
          (() => { const r = __plSeq.rec; r.blocks.length = 0;
            r.blocks.push({ id: 'e1', track: 0, a: 0, b: 20, label: 'Verse', look: { ...__plAp.loops.A.tgt, in1: 'patchwork', zoom: 30 }, fin: 0, fout: 0, autos: [],
              grade: { gSat: 150 } }); })()""")
        click('#seqBtn')
        c.wait_frames(2, 'open')
        J("""(() => { const e = document.querySelector('.seq-blk[data-id="e1"]'), r = e.getBoundingClientRect();
          e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 15 })); })()""")
        names = J("[...document.querySelectorAll('.seq-menu.fixed button')].map(b => b.textContent)")
        ok(any(n.startswith('Edit this look') for n in names), f'right-click offers Edit this look… ({names[:3]})')
        J("[...document.querySelectorAll('.seq-menu.fixed button')].find(b => b.textContent.startsWith('Edit this look')).click()")
        c.wait_frames(3, 'editing')
        A = lambda q: J(f"__plAp.loops.A.tgt.{q}")
        ok(J("__plSeq.editing") == 'e1' and not J("document.querySelector('#seqEditBar').hidden"), 'the block is being edited, with the bar under the picture')
        ok(A('in1') == 'patchwork' and A('zoom') == 30, f"its look is on loop A ({A('in1')}, zoom {A('zoom')})")
        ok(J("__plGrade.grade.gSat") == 150 and J("__plGrade.grade.gHue") == 0, 'its Color grading is on the faders')
        ok(J("+document.querySelector('#gSat').value") == 150, 'and the Saturation fader shows it')
        # Play waits while a look is being edited
        click('#seqPlay')
        c.wait_frames(2, 'play pressed')
        ok(not J("__plSeq.running") and 'Save to block' in J("document.querySelector('#seqNote').textContent"), 'Play says to save or cancel first')
        # Changes with the ordinary controls, then Save to block
        slider('#zoom', 55)
        slider('#gSat', 120)
        c.wait_frames(2, 'changed')
        click('#seqEditSave')
        c.wait_frames(2, 'saved')
        bl = J("__plSeq.rec.blocks[0]")
        ok(bl['look']['zoom'] == 55 and bl['look']['in1'] == 'patchwork', f"Save to block keeps the new look (zoom {bl['look']['zoom']})")
        ok((bl.get('grade') or {}).get('gSat') == 120, f"and its new grading ({bl.get('grade')})")
        ok(J("__plGrade.grade.gHue") == 20 and J("__plGrade.grade.gSat") == 100, 'your own grading comes back')
        ok(J("document.querySelector('#seqEditBar').hidden") and J("__plSeq.editing") is None, 'the bar goes')
        # Edit again, change, Cancel
        J("__plAp.loops.A.tgt.zoom = 10")
        J("__plSeq.edit('e1')")
        c.wait_frames(2, 'editing again')
        ok(A('zoom') == 55, 'editing again starts from the saved look')
        slider('#zoom', -40)
        c.wait_frames(2, 'changed again')
        click('#seqEditCancel')
        c.wait_frames(2, 'cancelled')
        ok(J("__plSeq.rec.blocks[0].look.zoom") == 55, 'Cancel leaves the block as it was')
        ok(A('zoom') == 10, f"and puts loop A back as it was before ({A('zoom')})")
        click('#seqPlay')
        c.wait_frames(3, 'playing')
        ok(J("__plSeq.running") and A('zoom') == 55, 'then the sequence plays the saved look')
        click('#seqStop')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll Edit this look checks passed.')


if __name__ == '__main__':
    main()
