"""Phosphor Loop's Clip library (clips shared by Phosphor Clips on the same computer), checked end to end.

  python3 tests/clips_check.py                 against a stand-in library served by this script
  CLIPS_APP=/path/to/clip-app python3 tests/clips_check.py
  (the clips are WebM here: Playwright's open-source Chromium can't play H.264, which Phosphor Clips makes and
  Chrome, Edge and Phosphor Stream all play)
                                               against the real Phosphor Clips sharing server (clip-app branch)

It opens the gallery, picks a clip, checks it plays into the loop, ticks and unticks Autopilot's categories, has
Autopilot bring clips in and swap them, checks a video file of your own stays put, that the last clip comes back
when the page opens again, and what the gallery says when Phosphor Clips isn't running. Every wait is a number of
frames the app has drawn, or a condition with a ceiling. Pictures go to --out (default <temp>/phosphor-clips-check).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402  (the safety check's page server, frame counter and pictures)

PORT = 47811


def make_standin(folder):
    """A library like Phosphor Clips shares: two 4 s clips with thumbnails."""
    os.makedirs(folder, exist_ok=True)
    clips = [('a1', 'Swirl', 'abstract', 'mandelbrot=s=640x360:r=30:end_scale=0.05,hue=H=t'),
             ('w1', 'Blue stripes', 'water', 'testsrc2=s=640x360:r=30,hue=h=200:s=2,format=yuv420p')]
    for cid, _, _, lavfi in clips:
        mp4 = os.path.join(folder, cid + '.mp4')
        if not os.path.exists(mp4):
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', lavfi, '-t', '4', '-c:v', 'libvpx-vp9',
                            '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-pix_fmt', 'yuv420p', '-f', 'webm', mp4], check=True)
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', '2', '-i', mp4, '-frames:v', '1', '-vf', 'scale=320:-2',
                            os.path.join(folder, cid + '.jpg')], check=True)
    lib = {'app': 'Phosphor Clips', 'version': 'stand-in',
           'cats': [{'id': 'abstract', 'n': 'Abstract', 'count': 1}, {'id': 'water', 'n': 'Water', 'count': 1}, {'id': 'other', 'n': 'Other', 'count': 0}],
           'clips': [{'id': cid, 'n': n, 'c': c, 'd': 4, 'w': 640, 'h': 360, 'fps': 30, 'sound': False, 'thumb': True,
                      'by': 'Test', 'lic': 'CC0', 'src': 'https://example.com/' + c} for cid, n, c, _ in clips]}
    return lib


def serve_standin(folder, lib):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def cors(self):
            o = self.headers.get('Origin')
            if o:
                self.send_header('Access-Control-Allow-Origin', o)

        def do_OPTIONS(self):
            self.send_response(204)
            self.cors()
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.end_headers()

        def do_GET(self):
            p = self.path.split('?')[0]
            if p == '/library.json':
                body, kind = json.dumps(lib).encode(), 'application/json'
            elif p.startswith('/clip/') or p.startswith('/thumb/'):
                cid = p.split('/')[-1]
                f = os.path.join(folder, cid + ('.mp4' if p.startswith('/clip/') else '.jpg'))
                if not os.path.exists(f):
                    self.send_response(404); self.cors(); self.end_headers(); return
                body, kind = open(f, 'rb').read(), 'video/webm' if f.endswith('.mp4') else 'image/jpeg'
            else:
                self.send_response(404); self.cors(); self.end_headers(); return
            self.send_response(200)
            self.cors()
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def start_library(work):
    """The real sharing server when CLIPS_APP is set, otherwise the stand-in. Returns (stop, clips)."""
    app = os.environ.get('CLIPS_APP')
    if app:
        p = subprocess.Popen(['node', os.path.join(app, 'test', 'serve-library.js'), str(PORT), os.path.join(work, 'Library')],
                             stdout=subprocess.PIPE, text=True)
        line = p.stdout.readline().strip()
        if not line.startswith('READY'):
            sys.exit('FAIL: the Phosphor Clips server did not start: ' + line)
        clips = json.loads(line.split(' ', 2)[2])
        return (lambda: (p.terminate(), p.wait())), clips
    lib = make_standin(os.path.join(work, 'standin'))
    srv = serve_standin(os.path.join(work, 'standin'), lib)
    return (lambda: (srv.shutdown(), srv.server_close())), [{'id': c['id'], 'n': c['n'], 'c': c['c']} for c in lib['clips']]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'phosphor-clips-check'))
    ap.add_argument('--res', type=int, default=216)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    work = tempfile.mkdtemp(prefix='clips-check-')
    stop, lib = start_library(work)
    swirl = next(c for c in lib if c['c'] == 'abstract')
    blue = next(c for c in lib if c['c'] == 'water')
    print(f"  library: {', '.join(c['n'] + ' (' + c['c'] + ')' for c in lib)} via {'Phosphor Clips' if os.environ.get('CLIPS_APP') else 'the stand-in'}")
    html, notes = check.patched_index(a.res)
    # The test page is served (not swapped in by the test browser), so the browser knows it comes from this
    # computer: a swapped-in page has no address, counts as a public website, and may not reach Phosphor Clips
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
    import functools
    import socketserver
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Site, directory=check.ROOT))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    base = f'http://127.0.0.1:{port}/'
    problems = []
    stopped = False
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = b.new_context(viewport={'width': 1400, 'height': 900})
        pg = ctx.new_page()
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, a.out)
        ok = lambda cond, what: None if cond else problems.append(what)

        def until(js, what, ceiling_s=20):
            """Wait for a condition (a clip loading, the gallery filling). The time is only a ceiling."""
            try:
                pg.wait_for_function(js, polling=100, timeout=int(ceiling_s * 1000))
                return True
            except Exception:
                problems.append(what)
                return False

        pg.goto(base + 'index.html', timeout=check.START_CEILING_S * 1000)
        pg.add_style_tag(content='#tip, #osd { display: none !important; }')
        c.wait_frames(20, 'starting up', ceiling=check.START_CEILING_S)

        # 1. Before the button is used, the page never looks for Phosphor Clips
        ok(pg.evaluate("__plClips.list === null && !__plClips.wanted()"), 'the page looked for Phosphor Clips before the Clip library button was used')

        # 2. The gallery: categories, Autopilot's categories, tiles
        pg.evaluate("document.querySelector('[data-src=video]').click()")   # the Video input with no video: opens a file chooser for now
        pg.evaluate("document.querySelector('#row-video').hidden = false")
        pg.click('#clipOpen')
        if until("document.querySelectorAll('#clipsGrid .nat-tile').length === 2", 'the gallery did not show the 2 clips'):
            tabs = pg.evaluate("[...document.querySelectorAll('#clipsTabs .chip')].map(b => b.textContent.trim())")
            ok(sorted(tabs) == ['Abstract 1', 'All 2', 'Water 1'] and tabs[0] == 'All 2', f'category tabs: {tabs}')
            apc = pg.evaluate("[...document.querySelectorAll('#clipsApCats .chip')].map(b => b.textContent.trim() + ':' + b.getAttribute('aria-pressed'))")
            ok(sorted(apc) == ['Abstract:true', 'Water:true'], f"Autopilot's categories: {apc}")
            until("[...document.querySelectorAll('#clipsGrid img')].every(i => i.complete && i.naturalWidth > 0)", 'the thumbnails did not load')
            c.wait_frames(5, 'gallery')
            pg.screenshot(path=os.path.join(a.out, 'gallery.png'))
            pg.click('#clipsTabs .chip:has-text("Water")')
            ok(pg.evaluate("[...document.querySelectorAll('#clipsGrid .nat-tile')].filter(t => !t.hidden).length") == 1, 'the Water tab did not show just its clip')
            pg.click('#clipsTabs .chip:has-text("All")')

            # 3. Picking a clip feeds it in as Video
            pg.click(f"#clipsGrid .nat-tile[data-id='{swirl['id']}']")
            if until(f"__plClips.vidOn && __plClips.vidFrames > 5 && __plClips.cur === '{swirl['id']}'", 'the picked clip did not play into the loop'):
                c.wait_frames(30, 'clip playing')
                ok(pg.evaluate("__plClips.input(__plClips.edit, 'in1') === 'video' || __plClips.input(__plClips.edit, 'in2') === 'video'"), 'the loop did not switch to Video')
                ok(pg.evaluate("document.querySelector('#vidStatus').textContent.includes('Swirl')"), 'the Video status does not name the clip')
                ok(pg.evaluate("!document.querySelector('#clipCredit').hidden && document.querySelector('#clipCredit').textContent.includes('Abstract')"), 'no clip library credit line')
                _, light = c.picture('clip-in-loop')
                ok(light > 3, f'the picture is black with the clip in ({light:.1f})')
                pg.screenshot(path=os.path.join(a.out, 'controls.png'))

            # 4. Autopilot's categories: untick Water
            pg.click('#clipOpen')
            until("document.querySelectorAll('#clipsApCats .chip').length === 2", 'the gallery did not open again')
            pg.click('#clipsApCats .chip:has-text("Water")')
            ok(pg.evaluate("JSON.parse(localStorage.getItem('phosphor-clips-ap-off')).includes('water')"), 'unticking Water was not kept')
            pg.click('#clipsClose')

            # 5. Autopilot brings a clip in when a look uses Video and none is in, only from ticked categories
            pg.evaluate("__plClips.detachVideo(); __plClips.setInput('A', 'in1', 'video'); __plClips.setInput('B', 'in1', 'wave'); __plClips.setInput('B', 'in2', 'none');")
            ok(pg.evaluate("__plClips.videoUsable()"), "Autopilot doesn't count Video as usable with the library there")
            pg.evaluate("__plClips.apClip('A')")
            until(f"__plClips.vidOn && __plClips.cur === '{swirl['id']}'", 'Autopilot did not bring in a clip from the ticked category')
            # ...and swaps it every few looks: with only Abstract ticked there's no other, so it stays
            pg.evaluate("__plClips.apClip('A', 1)")
            c.wait_frames(10, 'after a swap with nothing to swap to')
            ok(pg.evaluate(f"__plClips.cur === '{swirl['id']}'"), 'Autopilot swapped to a clip from an unticked category')
            pg.evaluate("__plClips.off = []; __plClips.apClip('A', 1)")
            until(f"__plClips.cur === '{blue['id']}' && __plClips.vidOn", 'Autopilot did not swap in the other clip once Water was ticked again')

            # 5b. A real Autopilot run with the library there: a dozen new looks, then a picture
            seen_video = 0
            for i in range(12):
                pg.click('#nextLookBar')
                c.wait_frames(12, f'Autopilot look {i + 1}')
                if pg.evaluate("['A', 'B'].some(k => __plClips.input(k, 'in1') === 'video' || __plClips.input(k, 'in2') === 'video')"):
                    seen_video += 1
            ok(pg.evaluate("__plClips.vidOn"), 'no clip was ready during the Autopilot run')
            _, light = c.picture('autopilot-with-clips')
            ok(light > 3, f'the picture went black during the Autopilot run ({light:.1f})')
            print(f'  Autopilot: {seen_video} of 12 looks used Video')
            pg.click('#autopilot') if pg.evaluate("document.querySelector('#autopilot').getAttribute('aria-pressed') === 'true'") else None

            # 6. A video file of your own stays put
            pg.evaluate("""fetch('http://127.0.0.1:47811/clip/' + __plClips.list[0].id).then(r => r.blob()).then(b => __plClips.loadFile(new File([b], 'mine.webm', { type: 'video/webm' })))""")
            if until("__plClips.own === true && __plClips.vidOn && document.querySelector('#vidStatus').textContent.includes('mine.webm')", 'a video file of your own did not go in'):
                pg.evaluate("__plClips.apClip('A', 1)")
                c.wait_frames(10, 'after Autopilot with your own video in')
                ok(pg.evaluate("__plClips.own && document.querySelector('#vidStatus').textContent.includes('mine.webm')"), 'Autopilot replaced your own video')
                ok(pg.evaluate("document.querySelector('#clipCredit').hidden"), 'the clip credit stayed up for your own video')

            # 7. The last clip comes back when the page opens again
            pg.evaluate(f"localStorage.setItem('phosphor-clips-last', '{blue['id']}')")
            pg.reload(timeout=check.START_CEILING_S * 1000)
            c.wait_frames(20, 'starting up again', ceiling=check.START_CEILING_S)
            until(f"__plClips.vidOn && __plClips.cur === '{blue['id']}'", 'the last clip did not come back when the page opened')

        # 8. Phosphor Clips not running: a plain message and Try again
        pg.evaluate("__plClips.close()")
        stop()
        stopped = True
        pg.evaluate("document.querySelector('#row-video').hidden = false")   # the Video controls (the page reopened on other inputs)
        pg.click('#clipOpen')
        until("!document.querySelector('#clipsMsg').hidden && document.querySelector('#clipsMsgText').textContent.includes('isn’t answering')", 'no message when Phosphor Clips is not running')
        c.wait_frames(5, 'message')
        pg.screenshot(path=os.path.join(a.out, 'not-running.png'))
        ok(pg.evaluate("document.querySelector('#clipsGrid').children.length === 0 && !document.querySelector('#clipsRetry').hidden"), 'the not-running message is incomplete')
        pg.click('#clipsClose')
        if errors:
            problems.extend('page error: ' + e for e in errors)
        b.close()
    if not stopped:
        stop()
    srv.shutdown()
    for n in notes:
        print('  note: ' + n)
    if problems:
        print('FAIL:\n  ' + '\n  '.join(problems))
        sys.exit(1)
    print(f'PASS (pictures in {a.out})')


if __name__ == '__main__':
    main()
