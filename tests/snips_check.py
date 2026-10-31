"""The clip explorer, Save to clip library (snips), tags, saved effects, the sequencer's + Add clip… and Copy to a
drive, checked end to end against the real Phosphor Clips.

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
COPY_TO = ''


def main():
    app = os.environ.get('CLIPS_APP')
    if not app:
        sys.exit('Set CLIPS_APP to the clip-app folder (from the clip-app branch).')
    out = os.path.join(tempfile.gettempdir(), 'phosphor-snips-check')
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp(prefix='snips-check-')
    global COPY_TO
    COPY_TO = os.path.join(work, 'USB drive')
    os.makedirs(COPY_TO)
    proc = subprocess.Popen(['node', os.path.join(app, 'test', 'serve-library.js'), str(PORT), os.path.join(work, 'Library')],
                            stdout=subprocess.PIPE, text=True, env={**os.environ, 'CLIPS_COPY_TO': COPY_TO})
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

        J = lambda js: pg.evaluate(js)
        click = lambda sel: pg.evaluate(f"document.querySelector({json.dumps(sel)}).click()")
        def key(sel, k):
            pg.evaluate(f"document.querySelector({json.dumps(sel)}).dispatchEvent(new KeyboardEvent('keydown', {{ key: {json.dumps(k)}, bubbles: true }}))")
        def typein(sel, text, k='Enter'):
            pg.fill(sel, text)
            key(sel, k)
        def tile(name):
            return f"[...document.querySelectorAll('#clipsGrid .nat-tile')].find(t => t.querySelector('span:last-of-type').textContent === {json.dumps(name)})"
        def pick_tile(name, ctrl=False):
            pg.evaluate(f"{tile(name)}.dispatchEvent(new MouseEvent('click', {{ bubbles: true, ctrlKey: {str(ctrl).lower()} }}))")
            c.wait_frames(2, 'picked')
        shown = lambda: J("[...document.querySelectorAll('#clipsGrid .nat-tile')].map(t => t.querySelector('span:last-of-type').textContent)")
        lib_clip = lambda name: next((x for x in library()['clips'] if x['n'] == name), None)

        # 1. The explorer: a library clip in with Just the clip, a part of it marked
        J("document.querySelector('#row-video').hidden = false")
        click('#clipOpen')
        until("document.querySelectorAll('#clipsGrid .nat-tile').length === 2", 'the explorer did not show the clips')
        ok(J("document.querySelector('#cxSide').hidden"), 'nothing picked: no side panel')
        pick_tile('Swirl')
        ok(J("!document.querySelector('#cxSide').hidden && document.querySelector('#cxName').value === 'Swirl'"), 'clicking a clip shows it at the side')
        ok(J("document.querySelector('#cxUseFx').disabled"), 'Use with its effects is off for a clip with none')
        click('#cxUseClip')
        until(f"__plClips.vidOn && __plClips.vidFrames > 5 && __plClips.cur === '{swirl['id']}'", 'Just the clip did not play it')
        ok(J("document.querySelector('#clips').hidden"), 'the explorer closed')
        click('#vidPlay')
        c.wait_frames(3, 'paused')
        seek(0.25)
        click('#vidIn')
        seek(0.75)
        click('#vidOut')
        c.wait_frames(3, 'marked')
        bar = J("(() => { const m = document.querySelector('#vidMark'); return { shown: !m.hidden, left: parseFloat(m.style.left), width: parseFloat(m.style.width) }; })()")
        ok(bar['shown'] and abs(bar['left'] - 25) < 3 and abs(bar['width'] - 50) < 4, f'the marked part shows as a bar under the slider ({bar})')

        # 2. Save to clip library, with tags and the effects on screen
        J("__plAp.loops.A.tgt.zoom = 37; __plAp.loops.A.tgt.mirror = 6;")
        click('#snipOpen')
        if until("!document.querySelector('#snipForm').hidden && document.querySelectorAll('#snipCat option').length >= 3", 'the save form did not open with the categories'):
            ok(J("document.querySelector('#snipName').value") == 'Swirl 1s–3s', 'the name is filled in: ' + J("document.querySelector('#snipName').value"))
            ok(J("document.querySelector('#snipCat').value") == 'abstract|', 'the folder starts as the clip’s own')
            ok(J("document.querySelector('#snipFx').checked"), 'Save the effects on screen is on to start with')
            pg.fill('#snipName', 'Swirl middle')
            pg.select_option('#snipCat', 'water|')
            pg.fill('#snipTags', 'Fractal, neon')
            c.wait_frames(3, 'form')
            pg.screenshot(path=os.path.join(out, 'snip-form.png'))
            click('#snipSave')
            if until("document.querySelector('#snipStatus').textContent.startsWith('Saved')", 'the snip was not saved', 60):
                got = lib_clip('Swirl middle')
                ok(got and got['c'] == 'water' and abs(got['d'] - 2) < 0.2, f'the snip is in the library under Water, 2 s long')
                ok(got and got['tags'] == ['fractal', 'neon'], f"its tags ({got and got['tags']})")
                ok(got and got['fx'], 'its effects were saved')
                look = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/look/{got['id']}").read())['look']
                ok(look and look['A']['zoom'] == 37 and look['A']['mirror'] == 6 and look['vid'] == ['A'], f"the effects are the picture on screen ({look and look['A'].get('zoom')}, {look and look.get('vid')})")
                ok('with the effects on screen' in J("document.querySelector('#snipStatus').textContent"), 'the message says the effects went with it')

        # 3. A video file of your own, no effects
        J(f"fetch('http://127.0.0.1:{PORT}/clip/{swirl['id']}').then(r => r.blob()).then(b => __plClips.loadFile(new File([b], 'mine.webm', {{ type: 'video/webm' }})))")
        if until("__plClips.own === true && __plClips.vidOn && document.querySelector('#vidStatus').textContent.includes('mine.webm')", 'the video file of your own did not go in'):
            click('#vidPlay')
            c.wait_frames(3, 'paused')
            seek(0.5)
            click('#vidIn')
            click('#snipOpen')
            until("!document.querySelector('#snipForm').hidden", 'the save form did not open for your own video')
            J("document.querySelector('#snipFx').checked = false")
            pg.fill('#snipTags', 'industrial')
            ok(J("document.querySelector('#snipCat').value") == 'water|', 'the last folder picked is remembered')
            click('#snipSave')
            if until("document.querySelector('#snipStatus').textContent.startsWith('Saved')", 'your own video’s snip was not saved', 60):
                got = lib_clip('mine 2s–4s')
                ok(got and abs(got['d'] - 2) < 0.2 and got['tags'] == ['industrial'] and not got['fx'], f'your own video’s snip: 2 s, tagged, no effects ({got})')

        # 4. Searching and tags in the explorer
        click('#clipOpen')
        until("document.querySelectorAll('#clipsGrid .nat-tile').length === 4", 'the explorer did not show all 4 clips')
        ok(sorted(J("[...document.querySelectorAll('#cxTags .chip')].map(b => b.dataset.tag)")) == ['fractal', 'industrial', 'neon'], 'the tag chips list the library’s tags')
        pg.fill('#cxSearch', 'neon')
        c.wait_frames(2, 'search')
        ok(shown() == ['Swirl middle'], f'searching a tag finds it ({shown()})')
        pg.fill('#cxSearch', 'swirl')
        c.wait_frames(2, 'search')
        ok(sorted(shown()) == ['Swirl', 'Swirl middle'], f'searching a name ({shown()})')
        pg.fill('#cxSearch', 'swirl fractal')
        c.wait_frames(2, 'search')
        ok(shown() == ['Swirl middle'], f'every word has to match ({shown()})')
        pg.fill('#cxSearch', '')
        J("document.querySelector('#cxSearch').dispatchEvent(new Event('input'))")
        click("#cxTags [data-tag='industrial']")
        c.wait_frames(2, 'tag filter')
        ok(shown() == ['mine 2s–4s'], f'clicking a tag shows just its clips ({shown()})')
        click("#cxTags [data-tag='industrial']")
        c.wait_frames(2, 'tag filter off')
        ok(len(shown()) == 4, 'clicking it again shows them all')
        # Several picked: tag them all
        pick_tile('Swirl middle')
        pick_tile('Blue stripes', ctrl=True)
        ok(J("!document.querySelector('#cxMany').hidden && document.querySelector('#cxManyN').textContent") == '2 clips picked', 'Ctrl-click picks a second clip')
        typein('#cxManyTag', 'Glow')
        until("document.querySelector('#cxSay').textContent.startsWith('Added')", 'tagging both did not finish')
        ok('glow' in lib_clip('Swirl middle')['tags'] and lib_clip('Blue stripes')['tags'] == ['glow'], 'both clips got the tag')
        # One picked: rename, add and take off a tag
        pick_tile('Blue stripes')
        pg.fill('#cxName', 'Blue lines')
        J("document.querySelector('#cxName').dispatchEvent(new Event('change'))")
        until("__plClips.list.some(c => c.n === 'Blue lines')", 'renaming did not take')
        ok(lib_clip('Blue lines') is not None, 'renamed in Phosphor Clips')
        typein('#cxTagIn', 'water, calm')
        until("(__plClips.list.find(c => c.n === 'Blue lines').tags || []).includes('calm')", 'adding tags did not take')
        ok(lib_clip('Blue lines')['tags'] == ['glow', 'water', 'calm'], f"tags added ({lib_clip('Blue lines')['tags']})")
        J("[...document.querySelectorAll('#cxTagList .cx-chip')].find(c => c.textContent.startsWith('#glow')).querySelector('button').click()")
        until("!(__plClips.list.find(c => c.n === 'Blue lines').tags || []).includes('glow')", 'taking a tag off did not take')
        c.wait_frames(5, 'explorer')
        pg.screenshot(path=os.path.join(out, 'explorer.png'))

        # 5. Effects: save the picture on screen to a clip, then use a clip with its effects
        J("__plAp.loops.A.tgt.zoom = -20; __plAp.loops.B.tgt.spin = 44;")
        click('#cxFxSave')
        until("__plClips.list.find(c => c.n === 'Blue lines').fx === true", 'saving the picture as its effects did not take')
        blue_look = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/look/{lib_clip('Blue lines')['id']}").read())['look']
        ok(blue_look['A']['zoom'] == -20 and blue_look['B']['spin'] == 44, 'the picture on screen was saved as its effects')
        ok(J("!document.querySelector('#cxFxOff').hidden && !document.querySelector('#cxUseFx').disabled"), 'it now offers its effects')
        J("__plAp.loops.A.tgt.zoom = 5; __plAp.loops.A.tgt.mirror = 0;")
        pick_tile('Swirl middle')
        click('#cxUseFx')
        sm = lib_clip('Swirl middle')
        until(f"__plClips.cur === '{sm['id']}' && __plAp.loops.A.tgt.zoom === 37", 'Use with its effects did not bring back its picture and clip')
        ok(J("__plAp.loops.A.tgt.mirror === 6 && __plAp.loops.A.tgt.in1 === 'video'"), 'its whole picture came back, playing the clip')
        # Taking effects off
        click('#clipOpen')
        until("document.querySelectorAll('#clipsGrid .nat-tile').length === 4", 'the explorer did not open again')
        pick_tile('Blue lines')
        click('#cxFxOff')
        until("__plClips.list.find(c => c.n === 'Blue lines').fx === false", 'taking the effects off did not take')
        click('#clipsClose')

        # 6. The sequencer: + Add clip… opens the explorer
        click('#seqBtn')
        c.wait_frames(5, 'sequencer open')
        J("__plAp.loops.A.tgt.zoom = 0")
        click('#seqAddClip')
        until("!document.querySelector('#clips').hidden && document.querySelectorAll('#clipsGrid .nat-tile').length === 4", '+ Add clip… did not open the explorer')
        ok(J("document.querySelector('#clipsTitle').textContent") == 'Add a clip to track 1', 'the explorer says where the clip will go')
        pick_tile('Swirl middle')
        ok(J("document.querySelector('#cxUseFx').textContent") == 'Add to track 1 with its effects', 'its buttons add to the track')
        n0 = J("__plSeq.rec.blocks.length")
        click('#cxUseFx')
        c.wait_frames(3, 'block added')
        blocks = J("__plSeq.rec.blocks")
        ok(len(blocks) == n0 + 1, 'a block was added')
        if len(blocks) == n0 + 1:
            bl = blocks[-1]
            ok(bl['look']['zoom'] == 37 and bl['look']['mirror'] == 6 and bl['look']['in1'] == 'video', f"with its effects: the loop that played the clip ({bl['look'].get('zoom')}, {bl['look'].get('in1')})")
            ok(bl['media']['vid']['id'] == sm['id'] and abs((bl['b'] - bl['a']) - 4) < 0.01, 'the block holds the clip, at least 4 s long')
        ok(J("document.querySelector('#clips').hidden"), 'the explorer closed')
        J("window.__plSeq && (document.querySelector('#seqView') || {}).focus && 0")
        click('#seqAddClip')
        until("!document.querySelector('#clips').hidden && document.querySelectorAll('#clipsGrid .nat-tile').length === 4", 'the explorer did not open again')
        pick_tile('mine 2s–4s')
        click('#cxUseClip')
        c.wait_frames(3, 'block added')
        bl = J("__plSeq.rec.blocks")[-1]
        ok(bl['label'] == 'mine 2s–4s' and bl['look']['zoom'] == 0 and bl['look']['in1'] == 'video', f"just the clip: the track's loop as it is, playing Video ({bl['label']})")
        pg.screenshot(path=os.path.join(out, 'sequencer-with-clip.png'))

        # 7. Copy to a drive
        click('#seqAddClip')
        until("!document.querySelector('#clips').hidden && document.querySelectorAll('#clipsGrid .nat-tile').length === 4", 'the explorer did not open for copying')
        pick_tile('Swirl middle')
        ok(J("document.querySelector('#cxCopy').textContent") == 'Copy 1 picked to a drive…', 'the Copy button says what it copies')
        click('#cxCopy')
        until("document.querySelector('#cxSay').textContent.startsWith('Copied 1 clip')", 'Copy to a drive did not finish: ' + str(J("document.querySelector('#cxSay').textContent")))
        side = os.path.join(COPY_TO, 'Phosphor Clips', 'Water', 'Swirl middle.phosphor.json')
        ok(os.path.exists(os.path.join(COPY_TO, 'Phosphor Clips', 'Water', 'Swirl middle.mp4')) and os.path.exists(side), 'the clip and its settings file are on the drive')
        if os.path.exists(side):
            d = json.load(open(side))
            ok(d['tags'] == ['fractal', 'neon', 'glow'] and d['look']['A']['zoom'] == 37, 'the settings file carries its tags and effects')
        click('#clipsClose')

        # 8. Folders: make them in the tree, move clips into them, browse them
        click('#clipOpen')
        until("document.querySelectorAll('#clipsGrid .nat-tile').length >= 1", 'the explorer did not open for folders')
        fold = lambda name: f"[...document.querySelectorAll('#clipsTabs .cx-fold')].find(b => b.querySelector('span').textContent === {json.dumps(name)})"
        def go(name):
            pg.evaluate(f"{fold(name)}.click()")
            c.wait_frames(2, 'folder')
        def newfolder(name):
            click('#cxNewFolder')
            pg.fill('#cxNewName', name)
            pg.evaluate("document.querySelector('#cxNewForm').requestSubmit()")
            until(f"!!({fold(name)}) && {fold(name)}.getAttribute('aria-current') === 'true'", f'the folder {name} was not made')
        go('All clips')
        go('Abstract')
        newfolder('Fractals')
        newfolder('Blue')
        ok(any(f['c'] == 'abstract' and f['p'] == 'Fractals/Blue' for f in library()['folders']), 'Phosphor Clips has Abstract › Fractals › Blue')
        ok(shown() == [] and J("document.querySelector('#cxNone').hidden === false"), 'a new folder is empty')
        go('All clips')
        pick_tile('Swirl middle')
        J("(() => { const s = document.querySelector('#cxCat'); s.value = 'abstract|Fractals/Blue'; s.dispatchEvent(new Event('change')); })()")
        until("__plClips.list.find(c => c.n === 'Swirl middle').p === 'Fractals/Blue'", 'moving a clip into a folder did not take')
        ok((lib_clip('Swirl middle') or {}).get('p') == 'Fractals/Blue', 'Phosphor Clips moved it into the folder')
        pick_tile('mine 2s–4s')
        pick_tile('Blue lines', ctrl=True)
        J("(() => { const s = document.querySelector('#cxManyMove'); s.value = 'abstract|Fractals'; s.dispatchEvent(new Event('change')); })()")
        until("document.querySelector('#cxSay').textContent.startsWith('Moved 2')", 'moving two clips did not finish')
        go('Fractals')
        ok(sorted(shown()) == ['Blue lines', 'Swirl middle', 'mine 2s–4s'], f'a folder shows its clips and the ones in folders inside it ({shown()})')
        go('Blue')
        ok(shown() == ['Swirl middle'], f'the inner folder shows just its own ({shown()})')
        counts = J("Object.fromEntries([...document.querySelectorAll('#clipsTabs .cx-fold')].map(b => [b.querySelector('span').textContent, +b.querySelector('b').textContent]))")
        ok(counts.get('Abstract') == 4 and counts.get('Fractals') == 3 and counts.get('Blue') == 1 and counts.get('Water') == 0, f'the tree counts what is inside ({counts})')
        pg.fill('#cxSearch', 'neon')
        go('Fractals')
        ok(shown() == ['Swirl middle'], f'search works inside a folder ({shown()})')
        pg.fill('#cxSearch', '')
        c.wait_frames(5, 'tree')
        pg.screenshot(path=os.path.join(out, 'explorer-folders.png'))
        click('#clipsClose')

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
