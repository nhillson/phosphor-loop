"""Many change lines in one sequencer block (no Spotify needed).

  python3 tests/seq_lines_check.py     (about a minute)

Five lines in one block: only the line being edited shows its points and takes clicks, the rest drawn faintly
behind; the selected block's track grows taller; the buttons in the block's details bring a line to the front, and
so does clicking a faint line. Every point of the line in front, at the bottom (Mirror Off), the top and both ends,
is the thing under the mouse at its centre (not a resize handle or the next track), and a real mouse click picks it.
Every wait is a number of frames.
"""
import functools
import json
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
        J("document.querySelector('#seqBtn').click()")
        c.wait_frames(2, 'open')
        autos = [
            {'key': 'zoom', 'pts': [[0, 0.5], [0.5, 0.9], [1, 0.4]]},
            {'key': 'spin', 'pts': [[0, 0.5], [0.5, 0.5], [1, 0.5]]},
            {'key': 'trails', 'pts': [[0, 0.7], [1, 0.7]]},
            {'key': 'color', 'pts': [[0, 0.3], [0.7, 0.6], [1, 0.3]]},
            {'key': 'mirror', 'pts': [[0, 0], [0.4, 0, 'iris', 6], [0.7, 1, 'ripple', 1], [1, 0, 'cut', 3]]},
        ]
        J(f"""(() => {{ __plSeq.rec.blocks.push({{ id: 'c1', track: 1, a: 10, b: 200, label: '', look: {{ ...__plAp.loops.B.tgt }}, fin: 0, fout: 0, autos: {json.dumps(autos)} }}); __plSeq.select('c1'); }})()""")
        c.wait_frames(4, 'drawn')
        dots = lambda: J("[...document.querySelectorAll('.seq-blk[data-id=\"c1\"] .dot')].map(d => +d.dataset.a)")
        ok(set(dots()) == {4}, f'only the line in front (the newest, Mirror) shows its points ({sorted(set(dots()))})')
        ok(J("document.querySelector('.seq-lane[data-track=\"1\"]').offsetHeight") > 100 and J("document.querySelector('.seq-lane[data-track=\"0\"]').offsetHeight") < 50,
           'the selected block’s track grows taller (the others don’t)')
        ok(J("document.querySelectorAll('#seqInsp [data-line]').length") == 5, 'the block’s details have a button for each line')
        # Every Mirror point is what's under the mouse at its centre
        under = J("""[...document.querySelectorAll('.seq-blk[data-id="c1"] .dot')].map(d => { const r = d.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === d; })""")
        ok(all(under), f'every point of the line in front, top, bottom and both ends, is clickable ({under})')
        # A real mouse click on the bottom point at 40% (Mirror Off) picks it
        box = J("""(() => { const r = document.querySelector('.seq-blk[data-id="c1"] .dot[data-p="1"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()""")
        pg.mouse.click(box[0], box[1])
        c.wait_frames(3, 'clicked')
        ok(J("!!document.querySelector('.seq-blk[data-id=\"c1\"] .dot.sel[data-p=\"1\"]')") and 'The change to Mirror Off' in J("document.querySelector('#seqInsp').textContent"),
           'a real click on the bottom point (Mirror Off) picks that change')
        # The details' Zoom button brings Zoom to the front
        J("document.querySelector('#seqInsp [data-line=\"0\"]').click()")
        c.wait_frames(3, 'zoom in front')
        ok(set(dots()) == {0}, f'the Zoom button brings Zoom to the front ({sorted(set(dots()))})')
        ok('Editing Zoom' in J("document.querySelector('.seq-blk[data-id=\"c1\"] .atag').textContent"), 'the block says which line is being edited')
        # Clicking the faint Trails line (at 70%, flat) brings it to the front
        pt = J("""(() => { const l = document.querySelector('.seq-blk[data-id="c1"] .lines').getBoundingClientRect(); return [l.x + l.width * 0.9, l.y + l.height * 0.3]; })()""")
        hit = J(f"(() => {{ const e = document.elementFromPoint({pt[0]}, {pt[1]}); return e && e.dataset ? [e.dataset.h, e.dataset.a] : null; }})()")
        pg.mouse.click(pt[0], pt[1])
        c.wait_frames(3, 'trails in front')
        ok(set(dots()) == {2}, f'clicking the faint Trails line brings it to the front ({hit} → {sorted(set(dots()))})')
        # Double-clicking (a real mouse double-click, which the timeline holds on to) adds a point to the line in front only
        n0 = J("__plSeq.rec.blocks.find(b => b.id === 'c1').autos.map(a => a.pts.length)")
        pt2 = J("""(() => { const l = document.querySelector('.seq-blk[data-id="c1"] .lines').getBoundingClientRect(); return [l.x + l.width * 0.55, l.y + l.height * 0.8]; })()""")
        pg.mouse.dblclick(pt2[0], pt2[1])
        c.wait_frames(3, 'added')
        n1 = J("__plSeq.rec.blocks.find(b => b.id === 'c1').autos.map(a => a.pts.length)")
        # As on a fast computer: the block is redrawn between the two clicks (the browser then counts no
        # double-click); the app counts it itself
        pt3 = J("""(() => { const l = document.querySelector('.seq-blk[data-id="c1"] .lines').getBoundingClientRect(); return [l.x + l.width * 0.2, l.y + l.height * 0.8]; })()""")
        J("window.__sawDbl = 0; document.addEventListener('dblclick', (e) => { if (e.target.closest && e.target.closest('.seq-blk')) window.__sawDbl++; }, true);"
          "document.addEventListener('pointerup', () => __plSeq.redraw(), { once: true, capture: true })")   # the block is rebuilt right after the first click
        pg.mouse.dblclick(pt3[0], pt3[1])
        c.wait_frames(3, 'added again')
        n2 = J("__plSeq.rec.blocks.find(b => b.id === 'c1').autos.map(a => a.pts.length)")
        ok(n2[2] == n1[2] + 1, f'a double-click still adds a point when the block is redrawn between the clicks ({n1[2]} → {n2[2]})')
        # Right-click › Add a point here
        J("""(() => { const l = document.querySelector('.seq-blk[data-id="c1"] .lines').getBoundingClientRect();
          document.querySelector('.seq-blk[data-id="c1"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: l.x + l.width * 0.8, clientY: l.y + l.height * 0.8 })); })()""")
        c.wait_frames(2, 'menu')
        J("[...document.querySelectorAll('.seq-menu.fixed button')].find(b => b.textContent.startsWith('Add a point here')).click()")
        c.wait_frames(2, 'added by menu')
        n3 = J("__plSeq.rec.blocks.find(b => b.id === 'c1').autos.map(a => a.pts.length)")
        ok(n3[2] == n2[2] + 1, f'right-click › Add a point here adds one ({n2[2]} → {n3[2]})')
        ok(n1[2] == n0[2] + 1 and [x for i, x in enumerate(n1) if i != 2] == [x for i, x in enumerate(n0) if i != 2], f'double-clicking adds a point to Trails only ({n0} → {n1})')
        try:
            pg.screenshot(path=os.path.join(tempfile.gettempdir(), 'seq-lines.png'), timeout=30000)
        except Exception as e:
            print('  note: no picture', str(e).splitlines()[0])
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll change-line checks passed.')


if __name__ == '__main__':
    main()
