"""Each loop's own video, and the sequencer's videos coming in without the one before flashing up.

  python3 tests/two_videos_check.py       (about a minute; a stand-in clip library, like tests/clips_check.py)

Loop A plays one clip while loop B plays another; a loop with no video of its own shows another loop's; the Video
controls follow the loop being edited. In the sequencer: a video block, then a block with no video, then a block with
a different video on the same track: the next video is loaded ahead during the middle block, and at no frame does the
loop show the first video once the third block has begun (a jump straight into it shows black until it's in). Every
wait is a number of frames or a condition with a ceiling.
"""
import functools
import os
import socketserver
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402
import clips_check  # noqa: E402  (the stand-in clip library)


def main():
    out = os.path.join(tempfile.gettempdir(), 'phosphor-two-videos')
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp(prefix='two-videos-')
    stop, lib = clips_check.start_library(work)
    swirl = next(c for c in lib if c['c'] == 'abstract')
    blue = next(c for c in lib if c['c'] == 'water')
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
        c = check.Check(pg, out)
        J = pg.evaluate

        def until(js, what, ceiling_s=20):
            try:
                pg.wait_for_function(js, polling=100, timeout=int(ceiling_s * 1000))
                return True
            except Exception:
                ok(False, what + ' (waited ' + str(ceiling_s) + ' s)')
                return False

        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', timeout=check.START_CEILING_S * 1000)
        pg.add_style_tag(content='#tip, #osd { display: none !important; }')
        c.wait_frames(10, 'starting up', ceiling=check.START_CEILING_S)
        V = lambda: J('__plClips.vids()')

        # The library, then loop A's clip only: loop B, set to Video, shows loop A's
        J("document.querySelector('#row-video').hidden = false; document.querySelector('#clipOpen').click()")
        until("document.querySelectorAll('#clipsGrid .nat-tile').length === 2", 'the clip library did not open')
        J("__plClips.close()")
        J(f"__plClips.pickInto('A', '{swirl['id']}')")
        until("__plClips.vids().A.on", 'loop A’s clip did not go in')
        J("__plClips.setInput('A', 'in1', 'video'); __plClips.setInput('B', 'in1', 'video'); __plClips.setInput('A', 'in2', 'none'); __plClips.setInput('B', 'in2', 'none');"
          "for (const id of ['#showA', '#showB']) { const s = document.querySelector(id); s.value = '100'; s.dispatchEvent(new Event('input')); }")
        c.wait_frames(6, 'one video')
        v = V()
        ok(v['A']['shows'] == 'A' and v['B']['shows'] == 'A' and not v['B']['on'], f"loop B with no video of its own shows loop A’s ({v['B']['shows']})")
        J("document.querySelector('#tabB').click()")
        c.wait_frames(2, 'edit B')
        st = J("document.querySelector('#vidStatus').textContent")
        ok('loop A’s video' in st and swirl['n'] in st, f'the Video controls on loop B say it shows loop A’s video: “{st}”')

        # Loop B's own clip: both play at once, each its own
        J(f"__plClips.pickInto('B', '{blue['id']}')")
        until("__plClips.vids().B.on", 'loop B’s clip did not go in')
        f0 = V()
        c.wait_frames(20, 'two videos')
        v = V()
        ok(v['A']['clip'] == swirl['id'] and v['B']['clip'] == blue['id'], f"loop A has {v['A']['name']}, loop B has {v['B']['name']}")
        ok(v['A']['shows'] == 'A' and v['B']['shows'] == 'B', 'each loop shows its own video')
        ok(not v['A']['paused'] and not v['B']['paused'], 'both videos play')
        ok(v['A']['frames'] > f0['A']['frames'] and v['B']['frames'] > f0['B']['frames'], f"both draw new pictures (A {f0['A']['frames']}→{v['A']['frames']}, B {f0['B']['frames']}→{v['B']['frames']})")
        st = J("document.querySelector('#vidStatus').textContent")
        ok(blue['n'] in st, f'the Video controls on loop B show its own clip: “{st}”')
        J("document.querySelector('#tabA').click()")
        c.wait_frames(2, 'edit A')
        st = J("document.querySelector('#vidStatus').textContent")
        ok(swirl['n'] in st, f'and on loop A, loop A’s: “{st}”')
        pg.screenshot(path=os.path.join(out, 'two-videos.png'), timeout=30000)
        # Loop B off Video: its clip pauses, loop A's keeps playing
        J("__plClips.setInput('B', 'in1', 'wave')")
        c.wait_frames(6, 'B off video')
        v = V()
        ok(v['B']['paused'] and not v['A']['paused'], 'loop B off Video: its clip pauses, loop A’s plays on')

        # The sequencer: swirl, then no video, then blue, all on track 1 (loop A); loop B's track empty
        look = "({ ...__plAp.loops.A.tgt, in2: 'none', in1: %s })"
        J(f"""(() => {{ const r = __plSeq.rec; r.blocks.length = 0;
          const vidOf = (c) => ({{ vid: {{ kind: 'clip', id: c.id, name: c.n, at: 0 }} }});
          r.blocks.push({{ id: 'v1', track: 0, a: 0, b: 3, label: '', look: {look % "'video'"}, fin: 0, fout: 0, autos: [], media: vidOf({{ id: '{swirl['id']}', n: '{swirl['n']}' }}) }});
          r.blocks.push({{ id: 'n2', track: 0, a: 3, b: 40, label: '', look: {look % "'wave'"}, fin: 0, fout: 0, autos: [] }});
          r.blocks.push({{ id: 'v3', track: 0, a: 40, b: 90, label: '', look: {look % "'video'"}, fin: 0, fout: 0, autos: [], media: vidOf({{ id: '{blue['id']}', n: '{blue['n']}' }}) }});
          r.blocks.push({{ id: 'n4', track: 0, a: 90, b: 120, label: '', look: {look % "'wave'"}, fin: 0, fout: 0, autos: [] }});
        }})()""")
        # Loop A's player back to swirl, as the first block wants
        J(f"__plClips.pickInto('A', '{swirl['id']}')")
        until(f"__plClips.vids().A.clip === '{swirl['id']}'", 'loop A’s clip did not go back to the first')
        # Every frame from now: the song's time, whether loop A shows Video, and which video its player holds
        J("""window.__rec = []; (function f() { const v = __plClips.vids().A;
          __rec.push({ t: __plSeq.t, inVid: __plAp.loops.A.tgt.in1 === 'video', name: v.name, wait: v.wait, running: __plSeq.running, loading: v.loading });
          requestAnimationFrame(f); })()""")
        # The workspace's software graphics load a clip slowly (15 s or more), so the next video is loaded further ahead here
        J("__plSeq.preloadSecs = 36")
        J("document.querySelector('#seqBtn').click()")
        c.wait_frames(2, 'open')
        J("__plSeq.seek(0)")
        J("document.querySelector('#seqPlay').click()")
        until("__plSeq.running && __plSeq.t > 0.3", 'the sequence did not start')
        until(f"__plSeq.t > 3.5", 'the sequence did not reach the middle block', 30)
        ok(J("__plAp.loops.A.tgt.in1") == 'wave', f"the middle block shows no video ({J('__plAp.loops.A.tgt.in1')}, t {J('__plSeq.t'):.2f}, running {J('__plSeq.running')})")
        if os.environ.get('DEBUG'):
            last = None
            for r in J('__rec'):
                k = (r['inVid'], r['name'], r['wait'], r['running'], r.get('loading'))
                if k != last: print('   ', round(r['t'], 2), k); last = k
        loaded = until(f"__plClips.vids().A.clip === '{blue['id']}' && __plSeq.t < 40", 'the third block’s video was not loaded ahead, during the middle block', 60)
        if loaded:
            ok(J("__plSeq.t") < 40, f"the next video was ready {40 - J('__plSeq.t'):.1f} s before its block")
        until("__plSeq.t > 41", 'the sequence did not reach the third block', 60)
        if os.environ.get('DEBUG'):
            print('    note:', J("document.querySelector('#seqNote').textContent"), J("__plClips.vids().A"))
        c.wait_frames(10, 'third block')
        rec = J("__rec")
        bad = [r for r in rec if r['running'] and r['t'] >= 40.05 and r['inVid'] and r['name'] == swirl['n'] and not r['wait']]
        ok(not bad, f"no frame in the third block shows the first video ({len(bad)} did; {len([r for r in rec if r['t'] >= 40.05])} frames looked at)")
        v = V()
        ok(v['A']['name'] == blue['n'] and not v['A']['paused'] and not v['A']['wait'], f"the third block plays its own video ({v['A']['name']})")
        pg.screenshot(path=os.path.join(out, 'third-block.png'), timeout=30000)

        # A jump straight from the first block into the third (no time to load ahead): black until it's in, never the first
        J("__plSeq.preloadSecs = 0")   # nothing loaded ahead now: the jump has to wait for its video
        J(f"__plSeq.seek(1)")
        until(f"__plClips.vids().A.clip === '{swirl['id']}' && !__plClips.vids().A.wait", 'back in the first block, its video did not come back', 60)
        c.wait_frames(4, 'first block again')
        J("__rec.length = 0; __plSeq.seek(45)")
        until(f"__plClips.vids().A.clip === '{blue['id']}' && !__plClips.vids().A.wait", 'after the jump, the third block’s video did not come in', 60)
        c.wait_frames(6, 'after the jump')
        rec = J("__rec")
        bad = [r for r in rec if r['t'] >= 40.05 and r['inVid'] and r['name'] == swirl['n'] and not r['wait']]
        waited = [r for r in rec if r['t'] >= 40.05 and r['wait']]
        ok(not bad, f"after a jump into the third block no frame shows the first video ({len(bad)} did; black for {len(waited)} frames while it loaded)")
        ok(len(waited) > 0, 'while the jump’s video loaded, the loop showed black')
        J("document.querySelector('#seqPlay').click()")
        c.wait_frames(4, 'stopped')
        ok(not J("__plClips.vids().A.wait"), 'stopping leaves nothing blacked out')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    stop()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll two-video checks passed. Pictures in ' + out)


if __name__ == '__main__':
    main()
