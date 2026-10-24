"""Capture real Phosphor Loop frames at 1920x1080 with a virtual clock (each drawn frame = exactly 1/fps of app time).
Waits are by drawn frames only; time limits are ceilings."""
import base64, functools, http.server, os, socketserver, sys, threading, time, json
from playwright.sync_api import sync_playwright
ROOT = '/home/claude/phosphor-loop'
OUT = '/tmp/claude-0/research/lab/frames'
look, recipe, fps, warm, n = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
extra = sys.argv[6] if len(sys.argv) > 6 else ''
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers['Content-Length']); data = self.rfile.read(n)
        with open(self.path.split('?')[1], 'wb') as f: f.write(data)
        self.send_response(200); self.send_header('Content-Length', '0'); self.end_headers()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]
INIT = """
window.__phosphorCaptureConfig = {width:1920,height:1080,fps:%d,renderHeight:1080};
(() => { const STEP = 1000/%d; let vt = 1000; const q = []; let sched = false; const nraf = window.requestAnimationFrame.bind(window);
  let id = 0; const dead = new Set();
  window.requestAnimationFrame = (cb) => { const i = ++id; q.push([i, cb]); if (!sched) { sched = true; nraf(() => { sched = false; vt += STEP;
    const cbs = q.splice(0); for (const [j, c] of cbs) { if (dead.has(j)) continue; try { c(vt); } catch (e) { console.error(e); } } dead.clear(); }); } return i; };
  window.cancelAnimationFrame = (i) => dead.add(i);
  performance.now = () => vt;
  window.__drawn = 0; window.__cap = []; window.__want = 0;
})();
""" % (fps, fps)
HOOK = """(dir) => { window.__saved = 0; window.__idx = 0; window.__phosphorCapture.onFrame = () => { window.__drawn++;
  if (window.__want > 0) { window.__want--; const c = window.__phosphorCapture.canvas, g = c.getContext('webgl2');
    const tA = Date.now(); const px = new Uint8Array(c.width * c.height * 4); g.readPixels(0, 0, c.width, c.height, g.RGBA, g.UNSIGNED_BYTE, px);
    window.__rp = (window.__rp||0) + (Date.now()-tA); const tF = Date.now(); const i = window.__idx++; fetch('/save?' + dir + '/' + String(i).padStart(4, '0') + '.rgba', {method: 'POST', body: px}).then(() => { window.__saved++; window.__ft = (window.__ft||0) + Date.now() - tF; }); } }; }"""
RECIPE_JS = """(n) => { const a = [...document.querySelectorAll('.g-recipe')].find(x => x.querySelector('h3').textContent === n);
  const b = a && a.querySelector('button'); if (!b) return false; b.click(); return true; }"""
os.makedirs(f'{OUT}/{look}', exist_ok=True)
t0 = time.time()
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    pg.set_default_timeout(5000)
    pg.on('pageerror', lambda e: print('pageerror', e))
    pg.add_init_script(INIT)
    if os.environ.get('PATCH'):
        old, new = os.environ['PATCH'].split('|||')
        body = open(ROOT + '/js/shaders.js').read(); assert body.count(old) == 1, 'patch target not found'
        body = body.replace(old, new)
        pg.route('**/js/shaders.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=body))
    pg.goto(f'http://127.0.0.1:{port}/index.html', timeout=30000)
    pg.wait_for_function('window.__phosphorCapture', timeout=30000)
    pg.evaluate(HOOK, f'{OUT}/{look}')
    pg.wait_for_function('window.__drawn >= 3', timeout=60000)
    if recipe:
        if recipe.startswith('#'):
            for sel in recipe.split(','): pg.evaluate("(s)=>document.querySelector(s).click()", sel)
        elif not pg.evaluate(RECIPE_JS, recipe): sys.exit('no recipe ' + recipe)
    if extra: pg.evaluate(extra)
    pg.evaluate("()=>document.getElementById('clear').click()")
    start = pg.evaluate('window.__drawn')
    pg.wait_for_function(f'window.__drawn >= {start + warm}', polling=200, timeout=int((60 + warm * 30) * 1000))
    print(f'warm {warm} frames in {time.time()-t0:.0f}s', flush=True)
    pg.evaluate(f'window.__want = {n}')
    pg.wait_for_function(f'window.__saved >= {n}', polling=500, timeout=int((120 + n * 40) * 1000))
    print(pg.evaluate('[window.__rp, window.__ft, performance.now()]')); print(f'captured {n} frames in {time.time()-t0:.0f}s', flush=True)
    b.close()
