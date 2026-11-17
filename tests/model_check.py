"""The Model input: your own 3D model (from Blender, as a .glb) shown as a 3D world, drawn by three.js (js/model.js).

  python3 tests/model_check.py          (about 2 minutes)

Makes tests/media/spin-cube.glb (a spinning red cube on a slab, with a camera) if it isn't there, then: the Sample
shows before any model is added; dropping the .glb on the picture puts it into the loop's Model input, keeps it in
this browser and lists it; its animation plays; the file's own camera can be picked; the wandering camera moves;
a broken file is turned away with a message; a reload brings the model back; removing it (two clicks on its ✕)
goes back to the Sample. Every wait is a number of frames the app has drawn, or a condition with a ceiling.
"""
import base64
import functools
import os
import socketserver
import threading
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402
from gif_check import DROP  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(HERE, 'media', 'spin-cube.glb')


def main():
    if not os.path.exists(GLB):
        subprocess.run([sys.executable, os.path.join(HERE, 'make_test_glb.py')], check=True)
    out = os.path.join(tempfile.gettempdir(), 'phosphor-model-check')
    os.makedirs(out, exist_ok=True)
    body = check.patched_index(216)[0].encode('utf-8')

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
    ok = lambda cond, what: None if cond else problems.append(what)
    b64 = base64.b64encode(open(GLB, 'rb').read()).decode()

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1400, 'height': 900}, service_workers='block')
        pg = ctx.new_page()
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, out)

        def until(js, what, ceiling_s=30):
            try:
                pg.wait_for_function(js, polling=100, timeout=int(ceiling_s * 1000))
                return True
            except Exception:
                problems.append(what)
                return False

        def load():
            pg.goto(base + 'index.html', timeout=check.START_CEILING_S * 1000)
            pg.add_style_tag(content='#tip, #osd { display: none !important; }')
            c.wait_frames(15, 'starting up', ceiling=check.START_CEILING_S)

        load()
        ok(pg.evaluate("!!window.PhosphorModel"), 'js/model.js did not load')
        ok(pg.evaluate("!document.querySelector('[data-world=ribbit]')"), 'Mount Ribbit is still in the 3D world picker')
        ok(pg.evaluate("!!document.querySelector('#worlds [data-world=model]')"), 'no Model button in the 3D world picker')

        # 1. The Sample, before any model is added
        pg.evaluate("document.querySelector('#worlds [data-world=model]').click()")
        until("PhosphorModel.state === 'ready'", 'the model viewer did not get ready', 40)
        c.wait_frames(20, 'sample showing')
        ok(pg.evaluate("PhosphorModel.name()") == 'Sample', f"Sample did not show first ({pg.evaluate('PhosphorModel.name()')})")
        ok(pg.evaluate("!document.querySelector('#modelRow').hidden"), 'the Model row is hidden while the Model shows')
        _, lum = c.picture('1-sample')
        ok(lum > 3, f'the Sample picture is black (brightness {lum:.1f})')

        # 2. A .glb dropped on the picture goes into the loop and is kept
        pg.evaluate(DROP, [b64, 'spin-cube.glb', 'model/gltf-binary', None, None])
        if until("PhosphorModel.name() === 'spin-cube'", 'the dropped .glb did not show'):
            inp = pg.evaluate("[__plClips.input(__plClips.edit, 'in1'), __plClips.input(__plClips.edit, 'in2')]")
            ok('model' in inp, f'the loop is not fed by the Model input ({inp})')
            ok(pg.evaluate("PhosphorModel.list().length") == 1, 'the model was not kept in this browser')
            ok(pg.evaluate("PhosphorModel.anims()") == 1, 'its animation was not found')
            ok(pg.evaluate("PhosphorModel.hasCamera()"), 'its camera was not found')
            ok(pg.evaluate("!document.querySelector('#modelCam').hidden"), 'the Camera choice is hidden though the file has a camera')
            ok(pg.evaluate("document.querySelector('#modelList [data-model][aria-pressed=true]').textContent.includes('spin-cube')"), 'the list does not show spin-cube as picked')
            c.wait_frames(20, 'model showing')
            _, lum = c.picture('2-model-wander')
            ok(lum > 3, f'the model picture is black (brightness {lum:.1f})')

            # 3. The wandering camera moves on
            pos = "(() => { const s = PhosphorModel.sphere(); return s && s.r; })()"
            ok(pg.evaluate(pos) > 1, 'the model looks empty (no size)')

            # 4. The file's own camera
            pg.evaluate("document.querySelector('#modelCam [data-cam=blender]').click()")
            ok(pg.evaluate("PhosphorModel.camMode()") == 'blender', "The file's own camera did not get picked")
            c.wait_frames(20, "the file's camera")
            _, lum = c.picture('3-model-own-camera')
            ok(lum > 3, f"the file's-camera picture is black (brightness {lum:.1f})")
            pg.evaluate("document.querySelector('#modelCam [data-cam=wander]').click()")

        # 5. A broken file is turned away, the model stays
        bad = base64.b64encode(b'not a model at all').decode()
        pg.evaluate(DROP, [bad, 'broken.glb', 'model/gltf-binary', None, None])
        until("[...document.querySelectorAll('#toast, .toast')].some((t) => /couldn.t be opened/.test(t.textContent))", 'no message for a broken file', 15)
        ok(pg.evaluate("PhosphorModel.name()") == 'spin-cube', 'a broken file replaced the model')
        ok(pg.evaluate("PhosphorModel.list().length") == 1, 'a broken file was kept')

        # 6. A reload brings it back
        load()
        pg.evaluate("document.querySelector('#worlds [data-world=model]').click()")
        until("PhosphorModel.state === 'ready' && PhosphorModel.name() === 'spin-cube'", 'the model did not come back after a reload', 40)

        # 7. Removing it: two clicks on its ✕, then the Sample shows
        pg.evaluate("document.querySelector('#modelList [data-drop]').click()")
        ok(pg.evaluate("PhosphorModel.list().length") == 1, 'one click on ✕ already removed the model')
        pg.evaluate("document.querySelector('#modelList [data-drop]').click()")
        until("PhosphorModel.list().length === 0 && PhosphorModel.name() === 'Sample'", 'removing the model did not go back to the Sample')

        # 8. The old Mount Ribbit walking keys do nothing harmful
        pg.keyboard.press('KeyW')
        c.wait_frames(5, 'after a key')
        ok(not errors, f'page errors: {errors[:3]}')
        b.close()
    srv.shutdown()
    if problems:
        print('FAIL'); [print('  -', x) for x in problems]; print('pictures in', out)
        sys.exit(1)
    print('PASS  pictures in', out)


if __name__ == '__main__':
    main()
