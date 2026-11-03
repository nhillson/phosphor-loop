"""The sequencer's playhead while following a Spotify song (no real Spotify: its answers are made up here).

  python3 tests/seq_playhead_check.py     (about half a minute)

Answers that come a little early or late (as real ones do, about once a second) never make the playhead step back:
it catches up by running a little faster or slower. A skip (a jump of more than a second and a half) goes straight
there. Pausing holds it still. The times here are the page's own clock, handed to the playhead directly.
"""
import functools
import json
import os
import socketserver
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402


def main():
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
        pg = b.new_page()
        pg.set_default_timeout(check.FAIL_FAST_MS)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        c = check.Check(pg, tempfile.gettempdir())
        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html', timeout=check.START_CEILING_S * 1000)
        c.wait_frames(10, 'starting up', ceiling=check.START_CEILING_S)
        # A made-up song, followed; then the playhead read every 1/60 s of page time, with Spotify's answers coming
        # once a second, each off by up to ±400 ms, a skip from 20 s to 95 s at 12 s in, and a pause at 18 s
        r = pg.evaluate("""() => {
          const S = __plSeq, sp = S.spotify, track = { uri: 'spotify:track:test', name: 'Test', artists: ['Me'], durationMs: 200000 };
          S.follow(track);
          let now = 1e6, songAt = 20, playing = true;
          const answer = (err) => { sp.snapshot = { accountId: 'u', track, playing, progressMs: Math.round((songAt + err) * 1000), receivedAt: now }; };
          const errs = [0.3, -0.4, 0.25, -0.35, 0.4, -0.2, 0.1, -0.4, 0.35, -0.3, 0.2, 0.0, 0.3, -0.2, 0.4, -0.4, 0.1, 0.2, -0.3, 0.0];
          const seen = []; let pausedEnd = 0, back = 0, worstOff = 0, skipT = null, pausedT = [];
          answer(0);
          for (let i = 0; i < 20 * 60; i++) {
            now += 1000 / 60;
            if (playing) songAt += 1 / 60;
            const sec = i / 60;
            if (i === 12 * 60) songAt = 95;
            if (i === 18 * 60) playing = false;
            if (i % 60 === 0 && i > 0) answer(playing ? errs[(i / 60) % errs.length] : 0);
            const t = S.pos(now).t;
            if (playing && seen.length && t < seen[seen.length - 1] - 1e-6 && Math.abs(t - seen[seen.length - 1]) < 1.5) back++;
            if (i > 60 && sec < 11.9) worstOff = Math.max(worstOff, Math.abs(t - songAt));
            if (i === 12 * 60 + 60) skipT = t;
            if (i >= 18 * 60 + 60) pausedT.push(t);
            if (i === 20 * 60 - 1) pausedEnd = t - songAt;
            seen.push(t);
          }
          return { back, worstOff, skipT, songAtSkip: 96, pausedSpread: Math.max(...pausedT.slice(30)) - Math.min(...pausedT.slice(30)), pausedEnd };
        }""")
        ok(r['back'] == 0, f"answers a little early or late never step the playhead back ({r['back']} steps back)")
        ok(r['worstOff'] < 0.6, f"it stays close to the song while catching up (at most {r['worstOff']:.2f} s off)")
        ok(r['skipT'] is not None and abs(r['skipT'] - r['songAtSkip']) < 0.6, f"a skip goes straight there ({r['skipT']:.2f} s, the song at about 96 s)")
        ok(r['pausedSpread'] < 0.01 and abs(r['pausedEnd']) < 0.01, f"paused, it settles where the song stopped and holds still ({r['pausedSpread']:.3f} s, {r['pausedEnd']:.3f} s off)")
        ok(not errors, 'no page errors: ' + '; '.join(errors[:3]))
        b.close()
    srv.shutdown()
    if problems:
        print(f'\nFAILED {len(problems)}')
        sys.exit(1)
    print('\nAll playhead checks passed.')


if __name__ == '__main__':
    main()
