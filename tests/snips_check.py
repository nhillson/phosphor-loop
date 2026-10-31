"""Save to clip library (snips) and the sequencer's + Add clip, checked end to end against the real Phosphor Clips.

  CLIPS_APP=/path/to/clip-app python3 tests/snips_check.py     (about a minute and a half)

The clip-app folder comes from the clip-app branch (git worktree add ../clipwt clip-app). Its sharing server and
snip cutter (test/serve-library.js, src/snip.js) run for real on 127.0.0.1:47811, so ffmpeg must be on the PATH.
It picks a library clip, marks a part (Mark start / Mark end), checks the marked bar under the slider, saves the
part to the Water category and checks it's in the library at the right length; does the same for a video file of
your own (sent over to Phosphor Clips); then adds the snip to the sequencer with + Add clip and checks the block
(Video input, the clip, as long as the clip). Every wait is a number of frames or a condition with a ceiling.
"""
import functools
import json
import os
import socketserver
import subprocess
import sys
import tempfile
import threading
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402

PORT = 47811


def main():
    app = os.environ.get('CLIPS_APP')
    if not app:
        sys.exit('Set CLIPS_APP to the clip-app folder (from the clip-app branch).')
    out = os.path.join(tempfile.gettempdir(), 'phosphor-snips-check')
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp(prefix='snips-check-')
    proc = subprocess.Popen(['node', os.path.join(app, 'test', 'serve-library.js'), str(PORT), os.path.join(work, 'Library')],
                            stdout=subprocess.PIPE, text=True)
    line = proc.stdout.readline().strip()
    if not line.startswith('READY'):
        sys.exit('FAIL: the Phosphor Clips server did not start: ' + line)
    lib = json.loads(line.split(' ', 2)[2])
    swirl = next(c for c in lib if c['c'] == 'abstract')
    library = lambda: json.loads(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/library.json').read())

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
        b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = b.new_context(viewport={'width': 1400, 'height': 900}).new_page()
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, out)

        def until(js, what, ceiling_s=30):
            try:
                pg.wait_for_function(js, polling=100, timeout=int(ceiling_s * 1000))
                return True
            except Exception:
                ok(False, what)
                return False

        def seek(frac):
            pg.evaluate(f"(() => {{ const r = document.querySelector('#vidPos'); r.value = String({round(frac * 1000)}); r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }})()")
            c.wait_frames(2, 'seek')

        pg.goto(base + 'index.html', timeout=check.START_CEILING_S * 1000)
        pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
        c.wait_frames(20, 'starting up', ceiling=check.START_CEILING_S)

        # 1. A library clip in, a part of it marked
        pg.evaluate("document.querySelector('#row-video').hidden = false")
        pg.click('#clipOpen')
        until("document.querySelectorAll('#clipsGrid .nat-tile').length === 2", 'the gallery did not show the clips')
        pg.click(f"#clipsGrid .nat-tile[data-id='{swirl['id']}']")
        until(f"__plClips.vidOn && __plClips.vidFrames > 5 && __plClips.cur === '{swirl['id']}'", 'the clip did not play')
        pg.evaluate("document.querySelector('#vidPlay').click()")   # paused, so the marks land where the slider says
        c.wait_frames(3, 'paused')
        seek(0.25)
        pg.click('#vidIn')
        seek(0.75)
        pg.click('#vidOut')
        c.wait_frames(3, 'marked')
        bar = pg.evaluate("(() => { const m = document.querySelector('#vidMark'); return { shown: !m.hidden, left: parseFloat(m.style.left), width: parseFloat(m.style.width) }; })()")
        ok(bar['shown'] and abs(bar['left'] - 25) < 3 and abs(bar['width'] - 50) < 4, f'the marked part shows as a bar under the slider ({bar})')

        # 2. Save to clip library
        pg.click('#snipOpen')
        if until("!document.querySelector('#snipForm').hidden && document.querySelectorAll('#snipCat option').length >= 3", 'the save form did not open with the categories'):
            ok(pg.evaluate("document.querySelector('#snipName').value") == 'Swirl 1s–3s', 'the name is filled in: ' + pg.evaluate("document.querySelector('#snipName').value"))
            ok(pg.evaluate("document.querySelector('#snipCat').value") == 'abstract', 'the category starts as the clip’s own')
            ok('0:01 to 0:03' in pg.evaluate("document.querySelector('#snipWhat').textContent"), 'the form says which part')
            c.wait_frames(3, 'form')
            pg.screenshot(path=os.path.join(out, 'snip-form.png'))
            pg.fill('#snipName', 'Swirl middle')
            pg.select_option('#snipCat', 'water')
            pg.click('#snipSave')
            if until("document.querySelector('#snipStatus').textContent.startsWith('Saved')", 'the snip was not saved: ' + str(pg.evaluate("document.querySelector('#snipStatus').textContent")), 60):
                got = [x for x in library()['clips'] if x['n'] == 'Swirl middle']
                ok(len(got) == 1 and got[0]['c'] == 'water' and abs(got[0]['d'] - 2) < 0.2, f'the snip is in the library under Water, 2 s long ({got})')
                ok(pg.evaluate("document.querySelector('#snipForm').hidden && !document.querySelector('#snipOpen').hidden"), 'the form closed')
                ok(pg.evaluate("__plClips.list.some(c => c.n === 'Swirl middle')"), 'the page’s clip list has it straight away')
                pg.screenshot(path=os.path.join(out, 'snip-saved.png'))

        # 3. A video file of your own: sent over and cut
        pg.evaluate(f"fetch('http://127.0.0.1:{PORT}/clip/{swirl['id']}').then(r => r.blob()).then(b => __plClips.loadFile(new File([b], 'mine.webm', {{ type: 'video/webm' }})))")
        if until("__plClips.own === true && __plClips.vidOn && document.querySelector('#vidStatus').textContent.includes('mine.webm')", 'the video file of your own did not go in'):
            ok(pg.evaluate("document.querySelector('#vidMark').hidden"), 'the marks were cleared for the new video')
            pg.evaluate("document.querySelector('#vidPlay').click()")
            c.wait_frames(3, 'paused')
            seek(0.5)
            pg.click('#vidIn')
            pg.click('#snipOpen')
            until("!document.querySelector('#snipForm').hidden", 'the save form did not open for your own video')
            ok(pg.evaluate("document.querySelector('#snipCat').value") == 'water', 'the last category picked is remembered')
            pg.click('#snipSave')
            if until("document.querySelector('#snipStatus').textContent.startsWith('Saved')", 'your own video’s snip was not saved: ' + str(pg.evaluate("document.querySelector('#snipStatus').textContent")), 60):
                got = [x for x in library()['clips'] if x['n'] == 'mine 2s–4s']
                ok(len(got) == 1 and abs(got[0]['d'] - 2) < 0.2 and got[0]['page'] == 'mine.webm', f'your own video’s snip: from the mark to the end, 2 s ({got})')

        # 4. The sequencer's + Add clip
        pg.click('#seqBtn')
        c.wait_frames(5, 'sequencer open')
        pg.evaluate("document.querySelector('#seqAddClip').click()")
        if until("document.querySelectorAll('#seqClipMenu [data-clip]').length === 4", 'the + Add clip menu did not list the 4 clips'):
            heads = pg.evaluate("[...document.querySelectorAll('#seqClipMenu .mh')].map(h => h.textContent)")
            ok(sorted(heads) == ['Abstract', 'Water'], f'clips grouped by category ({heads})')
            c.wait_frames(5, 'menu')
            pg.screenshot(path=os.path.join(out, 'add-clip-menu.png'))
            snipped = next(x for x in library()['clips'] if x['n'] == 'Swirl middle')
            n0 = pg.evaluate("__plSeq.rec.blocks.length")
            pg.evaluate(f"document.querySelector(\"#seqClipMenu [data-clip='{snipped['id']}']\").click()")
            c.wait_frames(3, 'block added')
            blocks = pg.evaluate("__plSeq.rec.blocks")
            ok(len(blocks) == n0 + 1, 'a block was added')
            if len(blocks) == n0 + 1:
                bl = blocks[-1]
                ok(bl['label'] == 'Swirl middle' and bl['look']['in1'] == 'video', f"the block plays Video, named for the clip ({bl['label']}, {bl['look']['in1']})")
                ok(bl.get('media', {}).get('vid', {}).get('kind') == 'clip' and bl['media']['vid']['id'] == snipped['id'], f"the block holds the clip ({bl.get('media')})")
                ok(abs((bl['b'] - bl['a']) - 4) < 0.01, f"a 2 s clip makes a block of at least 4 s ({bl['b'] - bl['a']})")
            ok(pg.evaluate("document.querySelector('#seqClipMenu').hidden"), 'the menu closed')
            pg.screenshot(path=os.path.join(out, 'sequencer-with-clip.png'))

        if errors:
            problems.extend('page error: ' + e for e in errors)
        b.close()
    proc.terminate()
    proc.wait()
    srv.shutdown()
    if problems:
        print(f'FAIL ({len(problems)}):')
        for x in problems:
            print('  -', x)
        sys.exit(1)
    print('PASS')


if __name__ == '__main__':
    main()
