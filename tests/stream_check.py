"""Stream mode check, for Claude's workspace: the Twitch version of the picture (index.html?stream=1), the Go live
page (stream.html: the install view and the live view the tray icon opens), and runner mode (runner=1, what the
hidden browser shows, recording itself for the Windows runner in headless/).

Nothing here reaches Twitch or the real connection service: the test stands in for both. A pretend Twitch chat
sends !like and !skip votes, and a pretend connection service passes messages between the pages, so the Go live
page and the stream picture link up for real inside the test browser. Runner mode records the browser's fake
microphone (a beep) and hands its pieces to the test instead of the runner.

The runner itself (PowerShell) is tested separately, end to end, with PowerShell, this browser and ffmpeg writing
a file: see CLAUDE.md.

Every wait is a number of frames the stream picture has drawn, never a number of seconds; each has a ceiling.

  python3 tests/stream_check.py           all of it (about a minute)
  python3 tests/stream_check.py --shot    also saves a picture of the stream with its vote counter

Exit code 0 = passed. Needs Python Playwright and Pillow (both pre-installed in Claude's workspace).
"""
import argparse
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402  (the safety check's server, page patching and frame waits)

IRC = 'ws://irc.test/'
SIGNAL = 'ws://signal.test/peerjs'
LINK = 'testlink42'


class PretendTwitch:
    """Answers like Twitch chat does for someone watching without logging in, and lets the test type in it."""

    def __init__(self):
        self.ws = None
        self.joined = None

    def handle(self, ws):
        self.ws = ws

        def on(msg):
            for line in str(msg).split('\r\n'):
                if line.startswith('JOIN #'):
                    self.joined = line[6:]
                    ws.send(f':justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #{self.joined}\r\n'
                            f'@room-id=1 :tmi.twitch.tv ROOMSTATE #{self.joined}')
        ws.on_message(on)

    def say(self, user, text):
        self.ws.send(f'@display-name={user};user-id=id-{user.lower()} :{user.lower()}!{user.lower()}@x.tmi.twitch.tv '
                     f'PRIVMSG #{self.joined} :{text}')


class PretendSignal:
    """The few messages of the PeerJS connection service the pages use: OPEN, and passing OFFER/ANSWER/... on."""

    def __init__(self):
        self.peers = {}

    def handle(self, ws):
        from urllib.parse import urlparse, parse_qs
        pid = parse_qs(urlparse(ws.url).query).get('id', [''])[0]
        if pid in self.peers:
            ws.send(json.dumps({'type': 'ID-TAKEN'}))
            return
        self.peers[pid] = ws

        def on(msg):
            try:
                m = json.loads(msg)
            except Exception:
                return
            if m.get('type') == 'HEARTBEAT':
                return
            dst = self.peers.get(m.get('dst'))
            if dst:
                dst.send(json.dumps({'type': m['type'], 'src': pid, 'payload': m.get('payload')}))
            elif m.get('type') == 'OFFER':
                ws.send(json.dumps({'type': 'EXPIRE', 'src': m.get('dst')}))

        def gone(*_):
            if self.peers.get(pid) is ws:
                del self.peers[pid]
        ws.on_message(on)
        ws.on_close(gone)
        ws.send(json.dumps({'type': 'OPEN'}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--res', type=int, default=216)
    ap.add_argument('--shot', action='store_true')
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'phosphor-check'))
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright

    html, notes = check.patched_index(a.res)
    srv, port = check.serve()
    base = f'http://127.0.0.1:{port}/'
    os.makedirs(a.out, exist_ok=True)
    problems, errors = [], []
    t0 = time.time()
    tw, sig = PretendTwitch(), PretendSignal()

    def step(text):
        print(f'  {text}')

    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                                    '--autoplay-policy=no-user-gesture-required'])
        ctx = b.new_context(viewport={'width': 480, 'height': 270})
        ctx.grant_permissions(['microphone'])
        ctx.route_web_socket(IRC, tw.handle)
        ctx.route_web_socket(lambda u: u.startswith(SIGNAL), sig.handle)
        # Outside files (fonts, the live site's shared profiles) aren't reachable here; that's not the app's fault
        ctx.route(lambda u: not u.startswith(base), lambda r: r.abort())
        ctx.route(lambda u: u.split('?')[0].endswith('/index.html'),
                  lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))

        def watch(pg, who):
            pg.set_default_timeout(check.FAIL_FAST_MS)
            pg.on('pageerror', lambda e: errors.append(f'{who}: page error: {e}'))
            pg.on('console', lambda m: errors.append(f'{who}: console error: {m.text}')
                  if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)

        st = ctx.new_page()
        watch(st, 'stream picture')
        c = check.Check(st, a.out)
        try:
            # 0. Runner mode (what the hidden browser shows): it records itself and hands the pieces over. In a
            # context of its own, first, while nothing else is drawing (this workspace draws in software)
            rctx = b.new_context(viewport={'width': 480, 'height': 270})
            rctx.grant_permissions(['microphone'])
            rctx.route_web_socket(IRC, PretendTwitch().handle)
            rctx.route(lambda u: not u.startswith(base), lambda r: r.abort())
            rctx.route(lambda u: u.split('?')[0].endswith('/index.html'),
                       lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
            pieces, reports = [], []
            rn = rctx.new_page()
            watch(rn, 'runner page')
            rn.route('**/push?*', lambda r: (pieces.append(len(r.request.post_data_buffer or b'')), r.fulfill(status=200, body='ok')))
            rn.route('**/status', lambda r: (reports.append(r.request.post_data or ''), r.fulfill(status=200, body='ok')))
            rn.goto(base + f'index.html?stream=1&runner=1&sound=mic&twitch=testchannel&irc={IRC}', timeout=check.START_CEILING_S * 1000)
            rc = check.Check(rn, a.out)
            rc.wait_frames(20, 'runner page starting', ceiling=check.START_CEILING_S)
            sound = rn.evaluate('window.__plRunnerSound()')
            for _ in range(30):
                rc.wait_frames(5, 'recording pieces arriving', ceiling=30)
                if len(pieces) >= 4:
                    break
            last = json.loads(reports[-1]) if reports else {}
            if not str(sound).startswith('ok'):
                problems.append(f'runner page sound: {sound}')
            if len(pieces) < 4 or not all(n > 0 for n in pieces):
                problems.append(f'runner page sent {len(pieces)} recording pieces ({pieces[:6]})')
            if not last.get('recording'):
                problems.append(f'runner page says it is not recording: {last}')
            step(f'runner page: sound {sound}, {len(pieces)} pieces handed over ({last.get("mime")}), reports {len(reports)}')
            rctx.close()

            # 1. The stream picture: only the canvas, Autopilot on, joined to the chat
            st.goto(base + f'index.html?stream=1&twitch=TestChannel&skip=2&taste=chat&every=20&link={LINK}'
                    f'&irc={IRC}&signal={SIGNAL}&at=1000', timeout=check.START_CEILING_S * 1000)
            c.wait_frames(30, 'stream picture starting', ceiling=check.START_CEILING_S)
            state = st.evaluate("""() => ({
              ui: [...document.body.children].filter(e => e.id !== 'streamLayer' && getComputedStyle(e).display !== 'none').map(e => e.className || e.tagName),
              canvas: document.getElementById('screen').parentElement.id,
              size: [document.getElementById('screen').width, document.getElementById('screen').height],
              ap: document.documentElement.classList.contains('ap-on'),
            })""")
            if state['ui']:
                problems.append(f'controls showing on the stream: {state["ui"]}')
            if state['canvas'] != 'streamLayer':
                problems.append('the picture is not in the stream layer')
            if state['size'] != [480, 270]:
                problems.append(f'picture is {state["size"]}, not the window size 480 x 270')
            if not state['ap']:
                problems.append('Autopilot did not start by itself')
            if tw.joined != 'testchannel':
                problems.append(f'joined chat #{tw.joined}, not #testchannel')
            step(f'stream picture: controls hidden, {state["size"][0]} x {state["size"][1]}, Autopilot on, chat #{tw.joined}')
            c.wait_frames(10, 'counter showing')
            if st.evaluate("document.querySelector('.sv').classList.contains('off')"):
                problems.append('the vote counter did not show after joining the chat')
            _, lit = c.picture('stream-start')
            if lit < 3:
                problems.append(f'the stream picture is black (brightness {lit:.1f})')

            # 2. Chat votes: a like counts once per viewer, two skips (more than likes) bring a new look
            tw.say('Ana', '!like this one')
            tw.say('Ana', '!like')
            tw.say('Bo', 'hello')
            c.wait_frames(3, 'first votes')
            counts = st.evaluate("[...document.querySelectorAll('.sv-v b')].map(b => +b.textContent)")
            if counts != [1, 0]:
                problems.append(f'after one viewer liked twice, the counter shows {counts}, not [1, 0]')
            line = st.evaluate("document.querySelector('.sv-line').textContent")
            if 'Ana' not in line:
                problems.append(f'the counter did not name the voter: "{line}"')
            rated = st.evaluate("JSON.parse(localStorage.getItem('phosphor-taste-v2')).profiles.find(p => p.id === 'twitchchat').votes.length")
            if rated != 1:
                problems.append(f'the Twitch chat taste profile has {rated} ratings after a like, not 1')
            tw.say('Cy', '!skip')
            c.wait_frames(3, 'one skip')
            if st.evaluate("document.querySelector('.sv-flash').classList.contains('on')"):
                problems.append('one skip (of 2 needed) already skipped the look')
            tw.say('Dee', '!SKIP please')
            c.wait_frames(3, 'second skip')
            # Two skips vs one like: the look goes
            if not st.evaluate("document.querySelector('.sv-flash').classList.contains('on')"):
                problems.append('two skips against one like did not skip the look')
            step(f'chat votes: like counted once, named "{line.strip()}", 2 skips skipped the look')
            if a.shot:
                path, _ = c.picture('stream-votes')
                st.screenshot(path=os.path.join(a.out, 'stream-votes-page.png'))
                step(f'pictures: {path} and the whole page with the counter: {os.path.join(a.out, "stream-votes-page.png")}')

            # 3. The Go live page, as the tray icon opens it: linked to the stream, its buttons and settings reach it
            gl = ctx.new_page()
            gl.set_viewport_size({'width': 1100, 'height': 900})
            watch(gl, 'Go live page')
            gl.goto(base + f'stream.html?signal={SIGNAL}&link={LINK}&runner=1', timeout=15000)
            ok, ui = False, ''
            for _ in range(40):
                c.wait_frames(4, 'waiting for the Go live page to link up', ceiling=20)
                ui = gl.evaluate("document.getElementById('linkState').textContent")
                if 'running' in ui:
                    ok = True
                    break
            if not ok:
                problems.append(f'the Go live page never linked up with the stream (status: "{ui}")')
            else:
                step(f'Go live page: "{ui.strip()}"')
            if gl.evaluate("document.getElementById('twName').value") != 'testchannel':
                problems.append('the Go live page did not show the stream\'s own settings')
            gl.click('#rNext')
            c.wait_frames(3, 'Next look from the Go live page')
            if not st.evaluate("document.querySelector('.sv-flash').textContent.includes('New look')"):
                problems.append('Next look on the Go live page did nothing on the stream')
            gl.select_option('#skipN', '3')
            c.wait_frames(6, 'settings reaching the stream')
            need = st.evaluate("document.querySelector('.sv-v.dn i').textContent")
            if '3' not in need:
                problems.append(f'changing votes-to-skip on the Go live page did not reach the stream ("{need}")')
            step('Go live page buttons and settings reach the stream')

            # 4. The install view (opened from the web): the download gives the one-file installer
            gi = ctx.new_page()
            watch(gi, 'install page')
            gi.goto(base + 'stream.html', timeout=15000)
            with gi.expect_download(timeout=check.FAIL_FAST_MS) as dl:
                gi.click('#getRunner')
            got = os.path.join(a.out, 'installer.cmd')
            dl.value.save_as(got)
            raw = open(got, 'rb').read()
            if dl.value.suggested_filename != 'Phosphor Loop on Twitch.cmd' or not raw.startswith(b'<# :') or b'\r\n' not in raw:
                problems.append(f'the installer download is wrong ({dl.value.suggested_filename}, {raw[:20]!r})')
            if any(ch > 127 for ch in raw):
                problems.append('the installer has non-ASCII characters (Windows PowerShell 5.1 would misread them)')
            step(f'install page: downloads {dl.value.suggested_filename} ({len(raw) // 1024} KB)')

        except check.Stalled as e:
            problems.append(str(e))
        banner = st.evaluate(check.BANNER_JS)
        if banner:
            problems.insert(0, f'error message on the stream picture: {banner}')
        # Playwright's stand-in sockets print a harmless traceback if the browser closes with them open, so close them first
        for pg in ctx.pages:
            try:
                pg.evaluate("() => { try { document.title = 'done'; } catch (e) {} }")
                pg.close()
            except Exception:
                pass
        b.close()
    srv.shutdown()
    for n in notes:
        print('note:', n)
    problems += errors
    took = time.time() - t0
    if problems:
        print(f'FAIL after {took:.0f}s:')
        for x in dict.fromkeys(problems):
            print('  -', x)
        sys.exit(1)
    print(f'PASS in {took:.0f}s')


if __name__ == '__main__':
    main()
