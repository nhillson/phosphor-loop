"""Dropped GIFs (and moving WebP pictures, and GIPHY stickers) move: they go into the Video input as a looping video,
into the loop they are dropped on.

  python3 tests/gif_check.py          (about half a minute)

Makes a moving GIF, a moving WebP and a still GIF with ffmpeg, drops each on the picture the way a drag does
(a file in the drop), and drops a GIF that comes as a web address only (as from a web page). Checks the moving
ones play in the Video input (time moving on, frames drawn, at least 6 s long, loops), the still one goes in as a
Picture, and nothing errors. Every wait is a number of frames the app has drawn, or a condition with a ceiling.
"""
import base64
import json
import functools
import os
import socketserver
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402

DROP = """async ([b64, name, type, asUrl, onto]) => {
  const dt = new DataTransfer();
  if (asUrl) { dt.setData('text/uri-list', asUrl); dt.setData('text/html', '<img src="' + asUrl + '">'); }
  else {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], name, { type }));
  }
  const ev = (el, kind) => el.dispatchEvent(new DragEvent(kind, { dataTransfer: dt, bubbles: true, cancelable: true }));
  const st = document.querySelector('#stage');
  // onto: where it lands (a loop's drop target, or a loop tab); the stage builds its targets on dragenter
  if (onto && onto.startsWith('#tab')) { const t = document.querySelector(onto); ev(t, 'dragover'); ev(t, 'drop'); return; }
  ev(st, 'dragenter');
  const at = onto ? document.querySelector(onto) : st;
  if (!at) throw new Error('no drop target ' + onto);
  ev(at, 'dragover'); ev(at, 'drop');
}"""


def main():
    out = os.path.join(tempfile.gettempdir(), 'phosphor-gif-check')
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp(prefix='gif-check-')
    ff = lambda *a: subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *a], check=True)
    moving = os.path.join(work, 'dancing.gif')
    ff('-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=10', '-t', '2', moving)
    still = os.path.join(work, 'still.gif')
    ff('-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=10', '-frames:v', '1', still)
    webp = os.path.join(work, 'swirl.webp')
    try:
        ff('-f', 'lavfi', '-i', 'mandelbrot=s=320x240:r=10', '-t', '1.5', '-loop', '0', '-c:v', 'libwebp_anim', webp)
    except Exception:
        webp = None
    # A sticker: a ball moving over a see-through background, as GIPHY's stickers are
    from PIL import Image, ImageDraw
    sticker = os.path.join(work, 'sticker.gif')
    frames = []
    for i in range(12):
        im = Image.new('P', (200, 200), 0)
        im.putpalette([0, 0, 0] + [255, 60, 200] + [40, 220, 255] + [0, 0, 0] * 253)
        d = ImageDraw.Draw(im)
        x = 30 + i * 10
        d.ellipse((x, 60, x + 80, 140), fill=1)
        d.rectangle((x + 25, 90, x + 55, 110), fill=2)
        frames.append(im)
    frames[0].save(sticker, save_all=True, append_images=frames[1:], duration=100, loop=0, transparency=0, disposal=2)
    sticker_webp = os.path.join(work, 'sticker.webp')
    rgba = []
    for f in frames:   # palette entry 0 is the see-through background
        g = f.copy(); g.info['transparency'] = 0
        rgba.append(g.convert('RGBA'))
    rgba[0].save(sticker_webp, save_all=True, append_images=rgba[1:], duration=100, loop=0, lossless=True)
    b64 = lambda f: base64.b64encode(open(f, 'rb').read()).decode()

    html, _ = check.patched_index(216)
    body = html.encode('utf-8')

    class Site(check.QuietHandler):
        def do_GET(self):
            p = self.path.split('?')[0]
            if p in ('/', '/index.html'):
                data, kind = body, 'text/html; charset=utf-8'
            elif p == '/media/far.gif':
                data, kind = open(moving, 'rb').read(), 'image/gif'
            else:
                return super().do_GET()
            self.send_response(200)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Site, directory=check.ROOT))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_address[1]}/'
    problems = []
    ok = lambda cond, what: None if cond else problems.append(what)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = b.new_context(viewport={'width': 1400, 'height': 900}).new_page()
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, out)

        def until(js, what, ceiling_s=20):
            try:
                pg.wait_for_function(js, polling=100, timeout=int(ceiling_s * 1000))
                return True
            except Exception:
                problems.append(what)
                return False

        def shows_moving(name, what):
            if not until(f"(() => {{ const v = __plClips.vids()[__plClips.edit]; return v.on && v.name === {name!r} && v.t > 0; }})()", f'{what}: did not come in as a playing video'):
                return
            inp = pg.evaluate("[__plClips.input(__plClips.edit, 'in1'), __plClips.input(__plClips.edit, 'in2')]")
            ok('video' in inp, f'{what}: the loop is not fed by the Video input ({inp})')
            t0 = pg.evaluate("__plClips.vids()[__plClips.edit].t")
            c.wait_frames(30, f'{what} playing')
            t1 = pg.evaluate("__plClips.vids()[__plClips.edit].t")
            ok(t1 != t0, f'{what}: the video time did not move ({t0} then {t1})')
            d = pg.evaluate("(() => { const v = __plClips.vids()[__plClips.edit]; return [v.dur, v.loops]; })()")
            ok(d and d[0] >= 5.5 and d[1], f'{what}: the video is not at least 6 s and looping ({d})')
            c.picture(what.replace(' ', '-'))

        pg.goto(base + 'index.html', timeout=check.START_CEILING_S * 1000)
        pg.add_style_tag(content='#tip, #osd { display: none !important; }')
        c.wait_frames(20, 'starting up', ceiling=check.START_CEILING_S)

        # 1. A moving GIF dropped as a file
        pg.evaluate(DROP, [b64(moving), 'dancing.gif', 'image/gif', None, None])
        shows_moving('dancing.gif', 'moving GIF')

        # 2. A moving WebP (what GIPHY's pages often show)
        if webp:
            pg.evaluate(DROP, [b64(webp), 'swirl.webp', 'image/webp', None, None])
            shows_moving('swirl.webp', 'moving WebP')
        else:
            print('  (this ffmpeg cannot make moving WebP; skipped)')

        # 3. A GIF that comes as a web address only
        pg.evaluate(DROP, ['', '', '', base + 'media/far.gif', None])
        shows_moving('far.gif', 'GIF from a web address')

        # 4. A still GIF stays a Picture
        pg.evaluate(DROP, [b64(still), 'still.gif', 'image/gif', None, None])
        if until("document.querySelector('#picName').textContent === 'still.gif'", 'still GIF: did not go in as a Picture'):
            inp = pg.evaluate("[__plClips.input(__plClips.edit, 'in1'), __plClips.input(__plClips.edit, 'in2')]")
            ok('picture' in inp, f'still GIF: the loop is not fed by the Picture input ({inp})')

        # 4b. A sticker keeps its see-through parts: its video is put back together with them as it plays
        pg.evaluate(DROP, [b64(sticker), 'sticker.gif', 'image/gif', None, None])
        shows_moving('sticker.gif', 'sticker')
        st = pg.evaluate("__plClips.vids()[__plClips.edit]")
        ok(st.get('sticker') is True, f"sticker: not played as a sticker ({st.get('sticker')})")
        ok(abs((st.get('aspect') or 0) - 1.0) < 0.05, f"sticker: its shape is wrong (aspect {st.get('aspect')}, should be 1)")
        alpha = pg.evaluate("__plClips.stickerAlpha(__plClips.edit)")
        ok(alpha and alpha[0] > 0.2 and alpha[1] > 0.05, f'sticker: no see-through parts and solid parts both ({alpha})')

        # 4b2. A moving WebP sticker (how GIPHY hands most stickers out) keeps its see-through parts too
        pg.evaluate(DROP, [b64(sticker_webp), 'sticker.webp', 'image/webp', None, None])
        shows_moving('sticker.webp', 'WebP sticker')
        sw = pg.evaluate("__plClips.vids()[__plClips.edit]")
        ok(sw.get('sticker') is True, f"WebP sticker: not played as a sticker ({sw.get('sticker')})")
        alpha = pg.evaluate("__plClips.stickerAlpha(__plClips.edit)")
        ok(alpha and alpha[0] > 0.2 and alpha[1] > 0.05, f'WebP sticker: no see-through parts and solid parts both ({alpha})')

        # 4c. Dropped onto loop B's target: it goes into loop B, and A keeps what it had
        a_before = pg.evaluate("__plClips.vids().A.name")
        pg.evaluate(DROP, [b64(moving), 'into-b.gif', 'image/gif', None, '#drop .drop-zone[data-k=B]'])
        if until("__plClips.vids().B.name === 'into-b.gif' && __plClips.vids().B.t > 0", 'drop into loop B: loop B did not get the video'):
            ok(pg.evaluate("[__plClips.input('B', 'in1'), __plClips.input('B', 'in2')]").count('video') >= 1, 'drop into loop B: loop B is not fed by Video')
            ok(pg.evaluate("__plClips.vids().A.name") == a_before, 'drop into loop B: loop A changed too')
        zones = pg.evaluate("document.querySelectorAll('#drop .drop-zone').length")
        ok(zones == 2, f'drop targets: {zones} shown with 2 loops on, should be 2')

        # 4d. Dropped on Loop B's tab: a still picture goes into loop B
        pg.evaluate(DROP, [b64(still), 'tab-b.gif', 'image/gif', None, '#tabB'])
        if until("__plClips.pics().B === 'tab-b.gif'", 'drop on the Loop B tab: the picture did not come in'):
            ok('picture' in pg.evaluate("[__plClips.input('B', 'in1'), __plClips.input('B', 'in2')]"), 'drop on the Loop B tab: loop B is not fed by Picture')

        # 4e. Each loop has its own picture: a picture dropped on loop B leaves loop A's alone, and the Picture
        # controls show the picture of the loop whose tab is picked
        pg.evaluate(DROP, [b64(still), 'pic-a.gif', 'image/gif', None, '#drop .drop-zone[data-k=A]'])
        until("__plClips.pics().A === 'pic-a.gif'", 'own pictures: loop A did not get its picture')
        pg.evaluate(DROP, [b64(still), 'pic-b.gif', 'image/gif', None, '#drop .drop-zone[data-k=B]'])
        until("__plClips.pics().B === 'pic-b.gif'", 'own pictures: loop B did not get its picture')
        ps = pg.evaluate("__plClips.pics()")
        ok(ps['A'] == 'pic-a.gif', f'own pictures: loop A\'s picture changed when one went into loop B ({ps})')
        pg.evaluate("document.querySelector('#tabB').click()")
        ok(pg.evaluate("document.querySelector('#picName').textContent") == 'pic-b.gif', 'own pictures: the Picture controls did not show loop B\'s picture on its tab')
        pg.evaluate("document.querySelector('#tabA').click()")
        ok(pg.evaluate("document.querySelector('#picName').textContent") == 'pic-a.gif', 'own pictures: the Picture controls did not show loop A\'s picture on its tab')
        pg.evaluate("document.querySelector('#useCard').click()")
        ps = pg.evaluate("__plClips.pics()")
        ok(ps['A'] == 'the test card' and ps['B'] == 'pic-b.gif', f'own pictures: Use the test card on loop A changed loop B too ({ps})')
        c.wait_frames(10, 'two pictures')

        # 4f. ✂ Save clip of a sticker: saved with the "sticker" tag, and back from the library it plays as a sticker
        # (Phosphor Clips is stood in for here: its library, /snip and /clip answered by the test)
        pg.evaluate(DROP, [b64(sticker), 'save-me.gif', 'image/gif', None, '#drop .drop-zone[data-k=A]'])
        until("__plClips.vids().A.name === 'save-me.gif' && __plClips.vids().A.sticker", 'save sticker: the sticker did not come into loop A')
        lib = {'clips': []}
        got = {}

        def library(route):
            route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                          body=json.dumps({'app': 'Phosphor Clips', 'version': '1.10.0',
                                           'cats': [{'id': 'looks', 'n': 'Looks', 'count': len(lib['clips'])}, {'id': 'other', 'n': 'Other', 'count': 0}],
                                           'folders': [], 'clips': lib['clips']}))

        def snipped(route):
            req = route.request
            if req.method == 'OPTIONS':
                route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Private-Network': 'true'})
                return
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(req.url).query)
            got['tags'] = q.get('tags', [''])[0]
            got['body'] = req.post_data_buffer
            clip = {'id': 's1', 'n': 'Saved sticker', 'c': 'looks', 'p': '', 'd': 6, 'w': 200, 'h': 400, 'fps': 10, 'sound': False, 'thumb': False,
                    'tags': [t for t in got['tags'].split(',') if t]}
            lib['clips'] = [clip]
            route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                          body=json.dumps({'ok': True, 'clip': clip, 'cat': 'Looks'}))

        def clip_file(route):
            if route.request.method != 'GET':
                route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body='{"ok":true}')
                return
            route.fulfill(status=200, content_type='video/webm', headers={'Access-Control-Allow-Origin': '*'}, body=got.get('body') or b'')

        for port in (47811, 47812, 47813):
            pg.route(f'http://127.0.0.1:{port}/library.json*', library)
            pg.route(f'http://127.0.0.1:{port}/snip*', snipped)
            pg.route(f'http://127.0.0.1:{port}/clip/**', clip_file)
        pg.evaluate("document.querySelector('#snipOpen').click()")
        if until("!document.querySelector('#snipPickTrim').closest('[hidden]')", 'save sticker: Save clip did not offer Trim'):
            pg.evaluate("document.querySelector('#snipPickTrim').click()")
            ok('sticker' in pg.evaluate("document.querySelector('#snipTags').value"), 'save sticker: the tags did not start with "sticker"')
            pg.evaluate("document.querySelector('#snipTags').value = 'blue'")   # even with the tag typed over
            pg.evaluate("document.querySelector('#snipPanel').requestSubmit()")
            if until("document.querySelector('#snipStatus').textContent.includes('Saved')", 'save sticker: it was not saved'):
                ok('sticker' in got.get('tags', '').split(','), f"save sticker: sent without the sticker tag ({got.get('tags')})")
                # (the library is asked again just after saving: the clip may take a moment to be listed)
                for _ in range(20):
                    if pg.evaluate("__plClips.pickInto('B', 's1')"):
                        break
                    c.wait_frames(5, 'library listing the saved sticker')
                pg.evaluate("__plClips.setInput('B', 'in1', 'video')")   # loop B shows it (it came in quietly)
                if not until("__plClips.vids().B.name === 'Saved sticker' && __plClips.vids().B.frames > 2", 'save sticker: the saved clip did not play from the library'):
                    print('   debug:', len(got.get('body') or b''), pg.evaluate("JSON.stringify(__plClips.vids().B)"))
                else:
                    c.wait_frames(10, 'saved sticker playing')
                    vb = pg.evaluate("__plClips.vids().B")
                    ok(vb['sticker'], 'save sticker: from the library it did not play as a sticker')
                    alpha = pg.evaluate("__plClips.stickerAlpha('B')")
                    ok(alpha and alpha[0] > 0.2 and alpha[1] > 0.05, f'save sticker: from the library it has no see-through parts ({alpha})')
        pg.evaluate("document.querySelector('#snipCancel') && document.querySelector('#snipCancel').click()")

        # 5. A GIF with no type given (as some drags hand it over) is recognised from its bytes
        pg.evaluate(DROP, [b64(moving), 'notype.gif', '', None, None])
        shows_moving('notype.gif', 'GIF with no type')

        c.wait_frames(10, 'settling')
        ok(not errors, 'page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print('FAILED:\n  ' + '\n  '.join(problems))
        sys.exit(1)
    print(f'All GIF checks passed. Pictures in {out}')


if __name__ == '__main__':
    main()
