"""Export video… in the sequencer: the whole sequence plays once from the start by itself, drawn at the size picked, and
is saved as a video (no real Spotify here: the sequence runs on its own clock, and the workspace has no computer sound).

  python3 tests/seq_export_check.py       (about 2 minutes)

Checks: the panel explains the steps; with the sound ticked and no sound shared, it says what to do and nothing starts;
with the sound unticked it draws at 1080p, plays from the top, stops by itself after the last block, gives the picture
back its size, and offers a video of the sequence's length at 1920x1080. Every wait is a number of frames or a
condition with a ceiling.
"""
import functools
import json
import os
import socketserver
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402


def main():
    out = os.path.join(tempfile.gettempdir(), 'phosphor-export')
    os.makedirs(out, exist_ok=True)
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
        ctx = b.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True)
        pg = ctx.new_page()
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, out)
        J = pg.evaluate
        click = lambda sel: J(f"document.querySelector('{sel}').click()")

        def until(js, what, ceiling_s=20):
            try:
                pg.wait_for_function(js, polling=200, timeout=int(ceiling_s * 1000))
                return True
            except Exception:
                ok(False, what + f' (waited {ceiling_s} s)')
                return False

        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', timeout=check.START_CEILING_S * 1000)
        pg.add_style_tag(content='#tip, #osd { display: none !important; }')
        c.wait_frames(10, 'starting up', ceiling=check.START_CEILING_S)
        # Two looks on track 1, 0-3 s and 3-6 s
        J("""(() => { const r = __plSeq.rec; r.blocks.length = 0;
          r.blocks.push({ id: 'e1', track: 0, a: 0, b: 3, label: '', look: { ...__plAp.loops.A.tgt, in1: 'patchwork' }, fin: 0, fout: 0, autos: [] });
          r.blocks.push({ id: 'e2', track: 0, a: 3, b: 6, label: '', look: { ...__plAp.loops.A.tgt, in1: 'bars' }, fin: 0, fout: 0, autos: [] }); })()""")
        click('#seqBtn')
        c.wait_frames(2, 'sequencer open')
        click('#seqExport')
        c.wait_frames(2, 'export panel')
        ok(not J("document.querySelector('#seqExportForm').hidden"), 'Export video… opens its panel')
        how = J("document.querySelector('#seqExHow').textContent")
        ok('0:06' in how and '4K' in how and 'Also share system audio' in how, f'it explains the steps: “{how[:160]}…”')
        ok(J("document.querySelector('#seqExSize [aria-pressed=\"true\"]').dataset.h") == '2160', '4K is picked to start with')

        # With the sound ticked, and no computer sound to share here: it says what to do, and nothing starts
        click('#seqExGo')
        until("document.querySelector('#seqExSay').textContent.length > 10", 'no message when the sound could not be shared')
        say = J("document.querySelector('#seqExSay').textContent")
        ok(J("__plExport.stage") == '' and 'sound' in say.lower(), f'no sound shared: nothing starts, and it says so (“{say}”)')

        # Without the sound, at 1080p
        J("document.querySelector('#seqExSound').checked = false; document.querySelector('#seqExSound').dispatchEvent(new Event('change'))")
        click('#seqExSize [data-h="1080"]')
        before = J("__plExport.size")
        click('#seqExGo')
        until("__plExport.stage === 'play' || __plExport.stage === 'start'", 'the export did not get under way', 60)
        until("__plExport.stage === 'play'", 'the sequence did not start playing for the export', 60)
        size = J("__plExport.size")
        ok(size == {'w': 1920, 'h': 1080}, f'the picture is drawn at 1080p while it exports ({size})')
        ok(J("__plExport.from") < 1.5, f"the sequence plays from the start (under way at {J('__plExport.from'):.2f} s)")
        ok(not J("document.querySelector('#expBar').hidden") and 'Exporting' in J("document.querySelector('#expText').textContent"),
           f"the bar shows how far it’s got: “{J('document.querySelector(\"#expText\").textContent')}”")
        until("__plSeq.t > 3.5", 'the export did not reach the second look', 60)
        ok(J("__plAp.loops.A.tgt.in1") == 'bars', 'the second look plays')
        # It stops by itself after the end, and asks for a name
        until("!document.querySelector('#nameBox').hidden", 'the export did not finish and offer the video by itself', 120)
        ok(J("__plExport.stage") == '', 'the export has finished')
        ok(not J("__plSeq.running"), 'the sequence stopped')
        ok(J("__plExport.size") == before, f"the picture went back to its own size ({J('__plExport.size')})")
        name = J("document.querySelector('#nameIn, #nameBox input').value")
        ok('1080p' in name, f'the video is named with its size (“{name}”)')
        with pg.expect_download(timeout=30000) as dl:
            J("document.querySelector('#nameBox').requestSubmit()")
        f = os.path.join(out, dl.value.suggested_filename)
        dl.value.save_as(f)
        probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height,codec_type:format=duration', '-of', 'json', f], capture_output=True, text=True)
        info = json.loads(probe.stdout or '{}')
        vs = [s for s in info.get('streams', []) if s.get('codec_type') == 'video']
        dur = float(info.get('format', {}).get('duration', 0) or 0)
        ok(vs and vs[0]['width'] == 1920 and vs[0]['height'] == 1080, f'the video is 1920x1080 ({vs[0]["width"] if vs else "?"}x{vs[0]["height"] if vs else "?"})')
        # (a moment either side: 12 frames before, 15 after, a second at most on a real computer, much longer in this
        # workspace's software drawing, a frame or two a second at 1080p)
        ok(dur >= 6, f'it holds the whole sequence ({dur:.1f} s for a 6 s sequence, plus a moment either side)')
        print('  video: ' + f)

        # Following a Spotify song (a stand-in Spotify here: it plays when asked, paused 3 s in to start with), with the
        # sound unticked: the song is started from the top, the export runs with it, and the song is paused at the end
        J("""(() => { const S = __plSeq.spotify; S.stop(); S.token = { access: 'x', scope: 'user-modify-playback-state' };
          const track = { uri: 'spotify:track:T', name: 'Test song', artists: ['Me'], durationMs: 7000 };
          S.snapshot = { track, playing: false, progressMs: 3000, receivedAt: S.now() };
          window.__sp = { plays: [], pauses: 0 };
          S.play = async (ms, uri) => { __sp.plays.push([ms, uri]); S.snapshot = { ...S.snapshot, playing: true, progressMs: ms || 0, receivedAt: S.now() }; return true; };
          S.pause = async () => { __sp.pauses++; S.snapshot = { ...S.snapshot, playing: false, progressMs: S.position(), receivedAt: S.now() }; return true; };
          // as Spotify's own answers would, every second
          setInterval(() => { S.snapshot = { ...S.snapshot, progressMs: S.position(), receivedAt: S.now() }; }, 1000);
          __plSeq.follow(track); })()""")
        c.wait_frames(3, 'following the song')
        click('#seqExport')
        c.wait_frames(2, 'export panel')
        how = J("document.querySelector('#seqExHow').textContent")
        ok('Test song' in how and 'from the top' in how, f'it says the song starts in Spotify from the top: “{how[:200]}…”')
        J("document.querySelector('#seqExSound').checked = false")
        click('#seqExSize [data-h="1080"]')
        click('#seqExGo')
        until("__plExport.stage === 'play'", 'the export did not get going with the song', 120)
        plays = J("__sp.plays")
        ok(plays and plays[0] == [0, 'spotify:track:T'], f'the song was started from the top in Spotify ({plays})')
        ok(J("__plExport.from") < 1.5, f"the sequence follows it from the start (under way at {J('__plExport.from'):.2f} s)")
        until("!document.querySelector('#nameBox').hidden", 'the export with the song did not finish by itself', 120)
        ok(J("__sp.pauses") >= 1, 'the song is paused at the end')
        J("document.querySelector('#nameDrop').click(); document.querySelector('#nameDrop').click()")   # Don't save, then Throw the video away?

        # Spotify won't start it (no permission): the export waits and says to press Play in Spotify, then goes on
        J("""(() => { const S = __plSeq.spotify; S.token = { access: 'x', scope: '' };
          S.snapshot = { ...S.snapshot, playing: false, progressMs: 0, receivedAt: S.now() }; __sp.plays = []; })()""")
        c.wait_frames(3, 'no permission')
        click('#seqExport')
        c.wait_frames(2, 'export panel')
        click('#seqExGo')
        until("document.querySelector('#expText').textContent.includes('Press Play')", 'waiting for the song, it did not say to press Play in Spotify', 120)
        ok(J("__plExport.stage") == 'start', 'it waits for the song')
        J("(() => { const S = __plSeq.spotify; S.snapshot = { ...S.snapshot, playing: true, progressMs: 0, receivedAt: S.now() }; })()")
        until("__plExport.stage === 'play'", 'pressing Play in Spotify did not get the export going', 60)
        ok(True, 'pressing Play in Spotify gets it going')
        J("document.querySelector('#expCancel').click()")
        until("__plExport.stage === ''", 'Cancel did not stop the export', 60)
        c.wait_frames(3, 'cancelled')
        ok(J("__plExport.stage") == '' and J("document.querySelector('#nameBox').hidden"), 'Cancel stops it without offering a video')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll export checks passed.')


if __name__ == '__main__':
    main()
