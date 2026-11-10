"""The Preset library (My presets › Preset library…): old presets carried over, folders, tags, search, the picked look's
details, saving into a folder, staying after a reload, the library file, and syncing two "devices" (two separate
browser profiles) through a stand-in for GitHub. Waits are frames, never seconds.

  python3 tests/library_check.py       (about 3 minutes)   also: node --test tests/library.test.mjs
"""
import base64, hashlib, json, os, re, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import patched_index, serve, Check, START_CEILING_S, FAIL_FAST_MS

API = 'https://api.github.com/repos/nhillson/phosphor-loop'
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}


class FakeGitHub:
    """Just enough of GitHub's contents API: branches, and files with fingerprints that must match to change them."""
    def __init__(self):
        self.branches, self.files, self.n, self.log = {'main': 'm1'}, {}, 0, []

    def handle(self, route):
        rq = route.request
        path = rq.url[len(API):].split('?')[0]
        def out(status, body=None):
            route.fulfill(status=status, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps(body if body is not None else {}))
        if rq.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
        self.log.append(f'{rq.method} {path}')
        m = re.fullmatch(r'/git/ref/heads/(.+)', path)
        if m: return out(200, {'object': {'sha': self.branches[m[1]]}}) if m[1] in self.branches else out(404)
        if path == '/git/refs' and rq.method == 'POST':
            b = json.loads(rq.post_data); self.branches[b['ref'].split('/')[-1]] = b['sha']; return out(201, {})
        if path == '/contents/library' and rq.method == 'GET':
            if 'preset-library' not in self.branches or not self.files: return out(404)
            return out(200, [{'name': n, 'sha': f['sha']} for n, f in sorted(self.files.items())])
        m = re.fullmatch(r'/contents/library/([^/]+)', path)
        if m:
            name, have = m[1], self.files.get(m[1])
            if rq.method == 'GET': return out(200, {'sha': have['sha'], 'content': have['content']}) if have else out(404)
            b = json.loads(rq.post_data)
            if b.get('branch') != 'preset-library': return out(422)
            if have and b.get('sha') != have['sha']: return out(409)
            if rq.method == 'DELETE':
                if not have: return out(404)
                del self.files[name]; return out(200, {})
            if rq.method == 'PUT':
                if not have and b.get('sha'): return out(409)
                self.n += 1
                sha = hashlib.sha1(f"{self.n}{b['content']}".encode()).hexdigest()
                self.files[name] = {'sha': sha, 'content': b['content']}
                return out(201 if not have else 200, {'content': {'sha': sha}})
        return out(404)

    def preset(self, pid):
        return json.loads(base64.b64decode(self.files[pid + '.json']['content']))


OLD = [{'id': 'pold1', 'name': 'Old tunnel', 'thumb': '', 'data': {'v': 1, 'A': {'in1': 'wave', 'trails': 70, 'zoom': 20}}, 'saved': 1000},
       {'id': 'pold2', 'name': 'Old storm', 'thumb': '', 'data': {'v': 1, 'A': {'in1': 'shape', 'trails': 60, 'spin': 15}}, 'saved': 2000}]
JS = """
window.T = {
  q: (s) => document.querySelector(s),
  click: (s) => { const e = document.querySelector(s); if (!e) throw new Error('nothing matches ' + s); e.click(); },
  type: (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); },
  submit: (s) => document.querySelector(s).requestSubmit(),
  change: (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); },
  enter: (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); },
  tiles: () => [...document.querySelectorAll('#libGrid .nat-tile')].map((b) => b.querySelector('span:last-child').textContent),
  folders: () => [...document.querySelectorAll('#libTree .cx-node')].map((d) => d.dataset.folder),
  pick: (name) => { const b = [...document.querySelectorAll('#libGrid .nat-tile')].find((x) => x.querySelector('span:last-child').textContent === name); if (!b) throw new Error('no look called ' + name); b.click(); },
  folder: (path) => document.querySelector(`#libTree .cx-node[data-folder="${path}"] .cx-fold`).click(),
  by: (name) => __plLib.presets.find((p) => p.name === name) || null,
};
"""


def main():
    from playwright.sync_api import sync_playwright
    out = os.path.join(tempfile.gettempdir(), 'phosphor-library')
    os.makedirs(out, exist_ok=True)
    html, _ = patched_index(int(os.environ.get('RES', '120')))
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/'
    problems, errors = [], []
    gh = FakeGitHub()
    def check(ok, what):
        print(('  ok   ' if ok else '  FAIL ') + what)
        if not ok: problems.append(what)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        def device(name, seed=None):
            ctx = b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True, service_workers='block')   # a reload must get the test's page again, not the saved copy
            pg = ctx.new_page()
            pg.set_default_timeout(FAIL_FAST_MS)
            pg.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
            if seed is not None:
                pg.add_init_script("if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('phosphor-presets-v1', %s); }" % json.dumps(json.dumps(seed)))
            pg.route(base + 'index.html', lambda r: r.fulfill(body=html, content_type='text/html'))
            pg.route(API + '/**', gh.handle)
            c = Check(pg, out)
            def start():
                pg.goto(base + 'index.html', timeout=START_CEILING_S * 1000)
                pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
                pg.evaluate(JS)
                c.wait_frames(10, f'{name} starting up', ceiling=START_CEILING_S * 2)
                until(pg, c, '__plLib.ready', f'{name}: the library is read')
            return pg, c, start
        def until(pg, c, js, what, frames=80):
            for _ in range(frames):
                if pg.evaluate(js): return True
                c.wait_frames(1, what)
            check(False, f'{what} (gave up after {frames} frames)')
            return False
        def sync(pg, c, who):
            pg.evaluate('__plLib.run(true)')
            ok = until(pg, c, '!__plLib.sync.busy && __plLib.sync.last > 0', f'{who} syncs')
            c.wait_frames(1, 'settling')
            return ok

        A, ca, startA = device('A', OLD)
        startA()
        names = lambda pg: sorted(pg.evaluate('__plLib.presets.map((p) => p.name)'))
        check(names(A) == ['Old storm', 'Old tunnel'], 'the old My presets are carried over')
        check(A.evaluate("__plLib.presets.every((p) => p.folder === '' && Array.isArray(p.tags) && p.mod > 0)"), '...each with a folder, tags and a changed-time')
        A.evaluate("T.click('#libOpen')")
        check(not A.evaluate("T.q('#lib').hidden") and A.evaluate('T.tiles().length') == 2, 'Preset library… opens with both looks')
        # folders
        A.evaluate("T.click('#libNewFolder'); T.type('#libFolderName', 'Shows'); T.submit('#libFolderForm')")
        check(A.evaluate('T.folders()') == ['', 'Shows'] and A.evaluate('__plLib.lb.folder') == 'Shows', 'a new folder shows in the tree and is picked')
        A.evaluate("T.click('#libSave'); T.type('#libSaveName', 'Tunnel'); T.submit('#libSaveForm')")
        until(A, ca, "!!T.by('Tunnel')", 'Save current look here')
        t = A.evaluate("T.by('Tunnel')")
        check(t and t['folder'] == 'Shows' and t['thumb'].startswith('data:image/jpeg'), 'Save current look here… saves into the picked folder, with its picture')
        check(A.evaluate('T.tiles()') == ['Tunnel'] and not A.evaluate("T.q('#libSide').hidden"), 'the folder shows just that look, picked, with its details at the side')
        # the picked look: tags, name, folder
        A.evaluate("T.enter('#libTagIn', 'Slow'); T.enter('#libTagIn', 'blue, slow')")
        check(A.evaluate("T.by('Tunnel').tags") == ['slow', 'blue'], 'tags are added (lower case, no doubles)')
        A.evaluate("T.change('#libName', 'Blue tunnel')")
        check(A.evaluate("!!T.by('Blue tunnel')"), 'renaming in the details renames the look')
        A.evaluate("T.folder(''); T.pick('Old storm'); T.enter('#libTagIn', 'slow'); T.change('#libFolderSel', 'Shows')")
        check(A.evaluate("T.by('Old storm').folder") == 'Shows', 'the Folder list moves a look')
        # search and tags
        A.evaluate("T.type('#libSearch', 'tunnel')")
        check(sorted(A.evaluate('T.tiles()')) == ['Blue tunnel', 'Old tunnel'], 'search finds names')
        A.evaluate("T.type('#libSearch', 'blue slow')")
        check(A.evaluate('T.tiles()') == ['Blue tunnel'], '...and tags, every word')
        A.evaluate("T.type('#libSearch', ''); T.folder(''); T.click('#libTags [data-tag=slow]')")
        check(sorted(A.evaluate('T.tiles()')) == ['Blue tunnel', 'Old storm'], 'a tag shows its looks from every folder')
        A.evaluate("T.click('#libTags [data-tag=slow]')")
        A.evaluate("T.change('#libSort', 'name')")
        check(A.evaluate('T.tiles()') == ['Blue tunnel', 'Old storm', 'Old tunnel'], 'By name sorts A to Z')
        # folders inside folders, renaming, taking away
        A.evaluate("T.folder('Shows'); T.click('#libNewFolder'); T.type('#libFolderName', 'Friday'); T.submit('#libFolderForm')")
        check('Shows/Friday' in A.evaluate('T.folders()'), 'a folder inside a folder')
        A.evaluate("T.folder('Shows'); T.click('#libTree [data-f=ren]'); T.type('#libFolderName', 'Gigs'); T.submit('#libFolderForm')")
        check(A.evaluate('T.folders()') == ['', 'Gigs', 'Gigs/Friday'] and A.evaluate("T.by('Blue tunnel').folder") == 'Gigs', 'renaming a folder takes its looks and inner folders along')
        A.evaluate("T.folder('Gigs/Friday'); T.click('#libTree [data-f=del]')")
        check('Gigs/Friday' in A.evaluate('T.folders()'), 'taking a folder away asks first')
        A.evaluate("T.click('#libTree [data-f=del]')")
        check(A.evaluate('T.folders()') == ['', 'Gigs'], '...and a second click takes it away')
        # loading
        A.evaluate("T.folder(''); T.pick('Old tunnel'); T.click('#libLoad')")
        check(A.evaluate("T.q('#lib').hidden") and A.evaluate("__plAp.loops.A.tgt.in1") == 'wave', 'Load this look loads it and closes the window')
        # stays after a reload, pictures and all
        ca.wait_frames(2, 'saving')
        startA()
        check(names(A) == ['Blue tunnel', 'Old storm', 'Old tunnel'] and A.evaluate("T.by('Blue tunnel').thumb.length") > 500 and A.evaluate('T.by("Blue tunnel").folder') == 'Gigs',
              'after a reload everything is still there (folders, tags, pictures)')
        # the library file
        A.evaluate("T.click('#libOpen'); T.click('#libMore')")
        check(A.evaluate("T.q('#libSyncBox').hidden"), 'no sync box without the GitHub key')
        with A.expect_download() as dl: A.evaluate("T.click('#libExport')")
        path = os.path.join(out, 'library.json'); dl.value.save_as(path)
        file = json.load(open(path))
        check(len(file['presets']) == 3 and file['folders'] == ['Gigs'], 'Save the library to a file holds every look and folder')
        A.evaluate("T.pick('Old storm'); T.click('#libDel')")
        check(len(names(A)) == 3, 'Delete asks first')
        A.evaluate("T.click('#libDel')")
        check(names(A) == ['Blue tunnel', 'Old tunnel'] and A.evaluate("'pold2' in __plLib.meta.gone"), '...then deletes, and remembers the deletion')
        A.set_input_files('#libFile', path)
        until(A, ca, "!!T.by('Old storm')", 'opening the library file')
        check(names(A) == ['Blue tunnel', 'Old storm', 'Old tunnel'], 'Open a library file… brings the deleted look back and doubles nothing')

        # ---- two devices and a stand-in GitHub
        A.evaluate("__plLib.key('test-key'); T.click('#libSyncOn')")
        check(not A.evaluate("T.q('#libSyncBox').hidden"), 'with the key, the sync box shows')
        until(A, ca, '!__plLib.sync.busy && __plLib.sync.last > 0', 'A syncs for the first time', 200)
        check('preset-library' in gh.branches and set(gh.files) == {'_meta.json', 'pold1.json', 'pold2.json', A.evaluate("T.by('Blue tunnel').id") + '.json'},
              'first sync: the side branch is made and every look is sent, one file each')
        check(not any('main' in l and l.startswith(('PUT', 'DELETE')) for l in gh.log), 'nothing is ever written to the site itself (main)')
        Bp, cb, startB = device('B')
        startB()
        Bp.evaluate("__plLib.key('test-key')")
        sync(Bp, cb, 'B')
        check(names(Bp) == ['Blue tunnel', 'Old storm', 'Old tunnel'] and Bp.evaluate("T.by('Blue tunnel').tags") == ['slow', 'blue'], 'a second device gets every look, with tags')
        Bp.evaluate("T.click('#libOpen')")
        check(Bp.evaluate('T.folders()') == ['', 'Gigs'] and Bp.evaluate("T.by('Blue tunnel').thumb.length") > 500, '...and the folders and pictures')
        n_before = len(gh.log)
        sync(Bp, cb, 'B again')
        check(not any(l.startswith(('PUT', 'DELETE')) for l in gh.log[n_before:]), 'syncing again with nothing changed sends nothing')
        # B renames one and deletes another; A gets both
        Bp.evaluate("T.pick('Old tunnel'); T.change('#libName', 'Green tunnel'); T.pick('Old storm'); T.click('#libDel'); T.click('#libDel')")
        sync(Bp, cb, 'B after changes')
        check('pold2.json' not in gh.files and gh.preset('pold1')['name'] == 'Green tunnel', 'a rename and a deletion reach GitHub')
        sync(A, ca, 'A after B')
        check(names(A) == ['Blue tunnel', 'Green tunnel'], '...and the other device')
        # both rename the same look: the later change wins everywhere
        A.evaluate("T.folder(''); T.pick('Green tunnel'); T.change('#libName', 'A name')")
        ca.wait_frames(1, 'a moment apart')
        Bp.evaluate("T.pick('Green tunnel'); T.change('#libName', 'B name')")
        sync(A, ca, 'A'); sync(Bp, cb, 'B'); sync(A, ca, 'A')
        check(names(A) == names(Bp) == ['B name', 'Blue tunnel'], 'changed on both devices: the later change wins on both')
        # A deletes a look that B then changes: it comes back
        A.evaluate("T.pick('B name'); T.click('#libDel'); T.click('#libDel')")
        sync(A, ca, 'A')
        cb.wait_frames(1, 'a moment later')
        Bp.evaluate("T.pick('B name'); T.enter('#libTagIn', 'keeper')")
        sync(Bp, cb, 'B'); sync(A, ca, 'A')
        check(names(A) == names(Bp) == ['B name', 'Blue tunnel'] and A.evaluate("T.by('B name').tags") == ['keeper'], 'deleted on one device but changed later on the other: it comes back')
        # a folder made on B reaches A
        Bp.evaluate("T.folder(''); T.click('#libNewFolder'); T.type('#libFolderName', 'Ideas'); T.submit('#libFolderForm')")
        sync(Bp, cb, 'B'); sync(A, ca, 'A')
        check(A.evaluate('T.folders()') == ['', 'Gigs', 'Ideas'], 'an empty folder made on one device shows on the other')
        # the sidebar keeps to the newest dozen
        many = [{'id': f'pm{i}', 'name': f'Many {i:02d}', 'data': {'v': 1, 'A': {}}, 'saved': 5000 + i, 'mod': 5000 + i} for i in range(14)]
        A.evaluate('(l) => __plLib.import(l)', many)
        check(A.evaluate("document.querySelectorAll('#presetList .pre').length") == 12 and not A.evaluate("T.q('#presetRecent').hidden"), 'past a dozen, the sidebar shows the newest 12 and says where the rest are')
        A.screenshot(path=os.path.join(out, 'library.png'))
        print(f'       picture: {os.path.join(out, "library.png")}')
        b.close()
    for e in errors: problems.append('page error: ' + e)
    print('PASS' if not problems else 'FAIL:\n  ' + '\n  '.join(problems))
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
