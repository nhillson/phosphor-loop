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
        # A block on track 1: its Mirror line holds Off, changes to 2 at 30% (Iris over 6 s), straight to 6 at 60%
        # (Ripple over 1 s, one change, not 4 on the way), and to 8 at 90% (Cut)
        J("""(() => { const look = { ...__plAp.loops.A.tgt, mirror: 0 };
          __plSeq.rec.blocks.push({ id: 'm1', track: 0, a: 0, b: 400, label: '', look, fin: 0, fout: 0,
            autos: [{ key: 'mirror', pts: [[0, 0], [0.3, 0.25, 'iris', 6], [0.6, 0.75, 'ripple', 1], [0.9, 1, 'cut', 3], [1, 1]] }] }); })()""")
        J("document.querySelector('#seqPlay').click()")
        state = lambda: (J("__plAp.loops.A.tgt.mirror"), J("__plAp.loops.A.tgt.mirrorFx"), J("(__plAp.loops.A.mx || {}).secs || 0"), J("(__plAp.loops.A.mx || {}).e ?? 1"))
        # Jumping into the song: the mirror is simply what the line says there, no change played out
        J("__plSeq.seek(200)")
        c.wait_frames(4, 'jumped')
        j = state()
        ok(j[0] == 2 and j[3] == 1, f'after a jump to 50% the mirror is 2 at once, nothing played out ({j})')
        # Playing across each point: the change happens there, its own way
        def cross(before, want):
            J(f"__plSeq.seek({before})")
            c.wait_frames(1, 'just before')
            pre = J("__plAp.loops.A.tgt.mirror")
            try:
                pg.wait_for_function(f"__plAp.loops.A.tgt.mirror === {want}", polling=50, timeout=20000)
            except Exception:
                pass
            return pre, state()
        pre, at30 = cross(116, 2)
        ok(pre == 0 and at30[0] == 2 and at30[1] == 'iris' and abs(at30[2] - 6) < 0.01, f'playing past 30% it changes Off → 2, with Iris over 6 s ({pre} → {at30})')
        pre, at60 = cross(236, 6)
        ok(pre == 2 and at60[0] == 6 and at60[1] == 'ripple' and abs(at60[2] - 1) < 0.01, f'playing past 60% it changes straight 2 → 6 with Ripple over 1 s, one change ({pre} → {at60})')
        ok(J("(__plAp.loops.A.mx || {}).from") == 2, 'from 2 straight to 6, not by way of 4')
        pre, at90 = cross(356, 8)
        ok(pre == 6 and at90[0] == 8 and at90[1] == 'cut', f'playing past 90% it cuts to 8 ({pre} → {at90})')
        ok(J("+document.querySelector('#mirror button[aria-pressed=\"true\"]').dataset.mirror") == 8, 'the Mirror buttons follow')
        # Dragging a point left moves when that change happens: the change to 6 at 55% instead of 60%
        J("__plSeq.rec.blocks.find(b => b.id === 'm1').autos[0].pts[2][0] = 0.55")
        J("__plSeq.seek(225)")
        c.wait_frames(4, 'moved')
        ok(J("__plAp.loops.A.tgt.mirror") == 6, 'moving a point moves its change (at 56% it’s already 6)')
        # Pick the first change's point and give it Melt over 10 s
        J("__plSeq.select('m1')")
        c.wait_frames(2, 'selected')
        ok('Click a point on the Mirror line' in J("document.querySelector('#seqInsp').textContent"), 'with no point picked, it says to click one')
        J("""(() => { const d = document.querySelector('.seq-blk[data-id="m1"] .dot[data-a="0"][data-p="1"]'); const r = d.getBoundingClientRect();
          d.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.x + 4, clientY: r.y + 4, pointerId: 1 }));
          document.querySelector('#seqView').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: r.x + 4, clientY: r.y + 4, pointerId: 1 })); })()""")
        c.wait_frames(3, 'point picked')
        ok(J("!!document.querySelector('#seqInsp [data-mfx=\"iris\"][aria-pressed=\"true\"]')"), "the picked point's own Transition shows (Iris)")
        ok(J("!!document.querySelector('.seq-blk[data-id=\"m1\"] .dot.sel')"), 'the picked point is ringed')
        J("document.querySelector('#seqInsp [data-mfx=\"melt\"]').click()")
        J("document.querySelector('#seqInsp [data-msecs=\"10\"]').click()")
        pts = J("__plSeq.rec.blocks.find(b => b.id === 'm1').autos[0].pts")
        ok(pts[1][2:] == ['melt', 10] and pts[2][2:] == ['ripple', 1], f"only that change becomes Melt over 10 s; the next keeps Ripple over 1 s ({pts[1][2:]}, {pts[2][2:]})")
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
