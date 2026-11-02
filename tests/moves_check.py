"""✂ Save clip… › Record the settings, checked end to end against the real Phosphor Clips.

  CLIPS_APP=/path/to/clip-app python3 tests/moves_check.py     (about two minutes)

With no video shown, Save clip records the settings: it records while loop A's Zoom moves and its input changes,
saves (the preview video plus the recording as the clip's effects), and checks the library marks it as a recording
(mv) with the moves in its effects. In the clip explorer it has the REC badge and Play the recording, which brings
the changes back in order; Autopilot ends it, and so does Stop. The sequencer's + Add clip turns it into blocks with
change lines. With a video in, Save clip asks first (trim or record), and once no loop shows the video it records
(it used to trim a video that wasn't on screen). Every wait is a number of frames or a condition with a ceiling.
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
    out = os.path.join(tempfile.gettempdir(), 'phosphor-moves-check')
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp(prefix='moves-check-')
    proc = subprocess.Popen(['node', os.path.join(app, 'test', 'serve-library.js'), str(PORT), os.path.join(work, 'Library')],
                            stdout=subprocess.PIPE, text=True)
    line = proc.stdout.readline().strip()
    if not line.startswith('READY'):
        sys.exit('FAIL: the Phosphor Clips server did not start: ' + line)
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

        pg.goto(base + 'index.html', timeout=check.START_CEILING_S * 1000)
        pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
        c.wait_frames(20, 'starting up', ceiling=check.START_CEILING_S)
        J = lambda js: pg.evaluate(js)
        click = lambda sel: pg.evaluate(f"document.querySelector({json.dumps(sel)}).click()")

        def fill(sel, text):
            pg.evaluate("([s, t]) => { const e = document.querySelector(s); e.focus(); e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }", [sel, text])

        def slide(sel, v):
            pg.evaluate("([s, v]) => { const e = document.querySelector(s); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }", [sel, v])

        def tile(name):
            return f"[...document.querySelectorAll('#clipsGrid .nat-tile')].find(t => t.querySelector('span:last-of-type').textContent === {json.dumps(name)})"

        def pick_tile(name):
            pg.evaluate(f"{tile(name)}.dispatchEvent(new MouseEvent('click', {{ bubbles: true }}))")
            c.wait_frames(2, 'picked')

        def shot(name):
            try:
                pg.screenshot(path=os.path.join(out, name), timeout=20000)
            except Exception as e:
                print('  note: no picture', name, str(e).splitlines()[0])

        stage = lambda: J("__plMoves.rec.stage")
        J("document.querySelector('.loop-tab[data-loop=\"A\"]') && document.querySelector('.loop-tab[data-loop=\"A\"]').click()")

        # 1. No video in: Save clip records the settings straight away
        ok(J("!document.querySelector('#snipOpen').hidden"), '✂ Save clip shows with no video in')
        ok(J("!document.querySelector('#snipOpen').title.includes('Trim the video playing and save')"), 'its tooltip talks about recording')
        click('#snipOpen')
        until("__plMoves.rec.stage === 'rec'", 'with no video, Save clip did not go straight to recording')
        ok(J("document.querySelector('#snipCat').value === 'looks|' && [...document.querySelectorAll('#snipCat option')].every(o => o.value.startsWith('looks|'))"),
           'Save clip saves only into the Look library')
        ok(J("getComputedStyle(document.querySelector('.snip-rec')).display !== 'none' && getComputedStyle(document.querySelector('.trim')).display === 'none'"),
           'the record button shows, the trim strip doesn’t')
        shot('1-ready.png')
        start_in = J("__plMoves.tgt('A').in1")
        new_in = 'patchwork' if start_in != 'patchwork' else 'bars'

        # 2. Record: Zoom moves, then loop A's input changes, then Zoom again
        J("document.querySelector('#snipRecSize').value = '1080'")
        click('#snipRecGo')
        until("__plMoves.rec.stage === 'recording' && __plMoves.rec.on", 'recording did not start')
        ok(J("__plMoves.drawn().h") == 1080, f"the picture is drawn 1080 lines tall while it records ({J('__plMoves.drawn()')})")
        for v in (0, 20, 40, 60, 80):
            slide('#zoom', v)
            c.wait_frames(3, 'zooming')
        click(f'#inputs button[data-src="{new_in}"]')
        c.wait_frames(6, 'new input')
        slide('#zoom', -50)
        c.wait_frames(8, 'held')
        ok(J("/^Stop \\d+:\\d\\d$/.test(document.querySelector('#snipRecLabel').textContent)"), 'the button counts the time while recording')
        shot('2-recording.png')
        click('#snipRecGo')
        until("__plMoves.rec.stage === 'recorded' && __plMoves.rec.blob", 'the recording did not finish')
        ok(J("__plMoves.drawn().h") != 1080 or J("__plMoves.drawn().screen"), f"the picture went back to the preview's size ({J('__plMoves.drawn()')})")
        mv = J("__plMoves.rec.moves")
        zoom = (mv or {}).get('tr', {}).get('A.zoom', [])
        ok(len(zoom) >= 4 and max(zoom[1::2]) >= 79 and min(zoom[1::2]) <= -49, f'Zoom’s moves were recorded ({zoom[:12]}…)')
        ok(any(e[1] == 'A.in1' and e[2] == new_in for e in (mv or {}).get('ev', [])), f'the input change to {new_in} was recorded')
        ok(J("document.querySelector('#snipWhat').textContent.startsWith('Recorded ')"), 'it says what was recorded: ' + J("document.querySelector('#snipWhat').textContent"))
        ok(J("getComputedStyle(document.querySelector('#snipSave')).display !== 'none' && getComputedStyle(document.querySelector('#snipRedo')).display !== 'none'"), 'Save and Record again show')
        shot('3-recorded.png')

        # 3. Save: the preview goes to the library, the recording with it
        fill('#snipName', 'Test moves')
        click('#snipSave')
        until("document.querySelector('#snipStatus').textContent.includes('Saved the recording')", 'saving the recording failed: ' + J("document.querySelector('#snipStatus').textContent"), 90)
        clip = next((x for x in library()['clips'] if x['n'] == 'Test moves'), None)
        ok(bool(clip) and clip['c'] == 'looks', f"it is in the Look library ({clip and clip['c']})")
        ok(J("!__plMoves.web().some(c => c.n === 'Test moves')"), 'and not among the web clips Autopilot uses')
        if clip:
            look = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/look/{clip["id"]}').read()).get('look') or {}
            ok(isinstance(look.get('moves'), dict) and 'A.zoom' in look['moves'].get('tr', {}), 'its effects hold the recording')
            ok(look.get('A', {}).get('in1') == start_in, 'and the look it started from')
            ok(clip['h'] == 1080, f"its video is 1080 lines tall ({clip['w']}×{clip['h']})")
        ok(J("document.querySelector('#snipPanel').hidden"), 'the panel closed')

        # 4. The explorer: the REC badge, Play the recording brings the changes back
        ok(J("!document.querySelector('#looksOpen').hidden"), 'the Look library button shows under the picture')
        click('#looksOpen')
        until(f"!!{tile('Test moves')}", 'the recording is not in the Look library')
        ok(J("document.querySelector('#clipsTitle').textContent === 'Look library'"), 'it opens as the Look library')
        ok(J("[...document.querySelectorAll('#clipsGrid .nat-tile')].every(t => t.dataset.c === 'looks')"), 'the Look library shows only looks')
        ok(J("document.querySelector('#clipsAp').hidden && document.querySelector('#clipsFile').hidden"), 'no Autopilot categories or Choose a video file there')
        ok(J(f"!!{tile('Test moves')}.querySelector('.cx-fxb.mv')"), 'its tile has the REC badge')
        pick_tile('Test moves')
        until("document.querySelector('#cxUseFx').textContent === 'Play the recording'", 'the button did not become Play the recording')
        ok(J("document.querySelector('#cxFxState').textContent.startsWith('Recorded settings')"), 'the side says it is recorded settings')
        shot('4-explorer.png')
        slide('#zoom', 0)
        click('#cxUseFx')
        until("!!__plMoves.play", 'Play the recording did not start')
        ok(J("document.querySelector('#clips').hidden && !document.querySelector('#movesBar').hidden"), 'the explorer closed and the playing bar shows')
        ok(J(f"__plMoves.tgt('A').in1 === {json.dumps(start_in)}"), 'it starts from the recorded start look')
        until(f"__plMoves.tgt('A').zoom > 70", 'Zoom did not follow the recording up', 60)
        until(f"__plMoves.tgt('A').in1 === {json.dumps(new_in)}", 'the input did not change when the recording did', 60)
        until(f"__plMoves.tgt('A').zoom < -45", 'Zoom did not follow the recording down', 60)
        shot('5-playing.png')
        until(f"__plMoves.tgt('A').in1 === {json.dumps(start_in)}", 'the recording did not start over at its end', 60)
        ok(not errors, 'no page errors while playing: ' + '; '.join(errors[:3]))
        click('#movesStop')
        c.wait_frames(2, 'stopped')
        ok(J("!__plMoves.play && document.querySelector('#movesBar').hidden"), 'Stop ends it')
        J("__plMoves.movesPlay({ n: 'Again' }, " + json.dumps({**look}) + ")") if clip else None
        c.wait_frames(2, 'playing again')
        click('#autopilotBar')
        c.wait_frames(2, 'autopilot')
        ok(J("!__plMoves.play"), 'turning Autopilot on ends it')
        click('#autopilotBar')

        # 5. The sequencer: + Add clip › Add the recording
        J("document.querySelector('#seq').hidden || document.querySelector('#seqBtn').click()")
        c.wait_frames(2, 'sequencer')
        n0 = J("__plSeq.rec.blocks.length")
        click('#seqAddClip')
        until(f"!!{tile('Test moves')}", 'the sequencer’s + Add clip did not show the recording')
        pick_tile('Test moves')
        until("document.querySelector('#cxUseAll').textContent === 'Add the recording' && !document.querySelector('#cxUseAll').hidden", 'Add the recording did not show')
        click('#cxUseAll')
        c.wait_frames(2, 'added')
        blocks = J("__plSeq.rec.blocks").copy()[n0:]
        ok(len(blocks) >= 2, f'the recording became blocks ({len(blocks)}): {[ (b["track"], b["a"], b["b"], b["look"].get("in1")) for b in blocks]}')
        zb = [b for b in blocks if b['track'] == 0 and any(a['key'] == 'zoom' for a in b['autos'])]
        ok(bool(zb), 'loop A’s blocks have a Zoom change line')
        ins = [b['look'].get('in1') for b in blocks if b['track'] == 0]
        ok(start_in in ins and new_in in ins, f'a new block starts where the input changed ({ins})')
        ok(J("document.querySelector('#seqNote').textContent.startsWith('Added the recording')"), J("document.querySelector('#seqNote').textContent"))
        shot('6-sequencer.png')

        # 6. A video in: asked first; once no loop shows it, recording (not trimming a video that isn't on screen)
        click('#clipOpen')
        until(f"!!{tile('Swirl')}", 'the explorer did not open')
        pick_tile('Swirl')
        click('#cxUseClip')
        until("__plClips.vidOn && __plClips.vidFrames > 5", 'Just the clip did not play it')
        J("document.querySelector('.loop-tab[data-loop=\"A\"]') && document.querySelector('.loop-tab[data-loop=\"A\"]').click()")
        click('#inputs button[data-src="video"]')
        c.wait_frames(3, 'video in')
        click('#snipOpen')
        until("__plMoves.rec.stage === 'choose'", 'with a video shown, Save clip did not ask first')
        ok(J("getComputedStyle(document.querySelector('.snip-choose')).display !== 'none'"), 'both choices show')
        shot('7-choose.png')
        click('#snipPickTrim')
        c.wait_frames(2, 'trim')
        ok(J("__plMoves.rec.stage === 'trim' && getComputedStyle(document.querySelector('.trim')).display !== 'none'"), 'Trim the video shows the trim strip')
        click('#inputs button[data-src="wave"]')
        J("['B','C','D'].forEach(k => { const t = __plMoves.tgt(k); })")
        c.wait_frames(3, 'video out')
        uses_video = J("['A','B'].some(k => __plMoves.tgt(k).in1 === 'video' || __plMoves.tgt(k).in2 === 'video')")
        if not uses_video:
            ok(J("document.querySelector('#snipPanel').hidden"), 'the trim closed once no loop shows the video')
            click('#snipOpen')
            until("__plMoves.rec.stage === 'rec'", 'with the video in but not shown, Save clip did not record the settings')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    proc.terminate()
    srv.shutdown()
    print(f'\nPictures in {out}')
    if problems:
        print(f'\nFAILED {len(problems)}:')
        for x in problems:
            print('  - ' + x)
        sys.exit(1)
    print('\nAll moves checks passed.')


if __name__ == '__main__':
    main()
