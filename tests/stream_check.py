"""Stream mode check, for Claude's workspace: the Twitch version of the picture (index.html?stream=1) and the
Go live page (stream.html) that sets it up and sends it sound.

Nothing here reaches Twitch or the real connection service: the test stands in for both. A pretend Twitch chat
sends !like and !skip votes, and a pretend connection service passes messages between the two pages, so the Go
live page and the stream picture link up for real inside the test browser, with the browser's fake microphone
(a beep) as the sound.

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

            # 3. The Go live page: settings, the OBS file, and the link with sound
            gl = ctx.new_page()
            gl.set_viewport_size({'width': 1100, 'height': 900})
            watch(gl, 'Go live page')
            gl.goto(base + f'stream.html?signal={SIGNAL}&link={LINK}', timeout=15000)
            gl.fill('#twName', 'TestChannel')
            gl.dispatch_event('#twName', 'change')
            with gl.expect_download(timeout=check.FAIL_FAST_MS) as dl:
                gl.click('#obsFile')
            path = os.path.join(a.out, 'obs-scene.json')
            dl.value.save_as(path)
            scene = json.load(open(path, encoding='utf-8'))
            src = next((s for s in scene.get('sources', []) if s.get('id') == 'browser_source'), None)
            for key in ('name', 'current_scene', 'sources'):
                if key not in scene:
                    problems.append(f'the OBS file has no "{key}" (OBS refuses files without it)')
            if not src or 'stream=1' not in src['settings']['url'] or 'twitch=testchannel' not in src['settings']['url']:
                problems.append(f'the OBS file\'s browser source address is wrong: {src and src["settings"]["url"]}')
            elif f'link={LINK}' not in src['settings']['url']:
                problems.append('the OBS file\'s address does not carry the link code')
            step(f'OBS file: {os.path.basename(path)}, {src and src["settings"]["width"]} x {src and src["settings"]["height"]}')

            # Link up and send the (fake) microphone
            gl.click('#tabLive')
            gl.click('#sndMic')
            c.wait_frames(5, 'link starting', ceiling=20)
            ok = False
            for _ in range(40):
                c.wait_frames(4, 'waiting for the link and the sound', ceiling=20)
                ui = gl.evaluate("document.getElementById('linkState').textContent")
                if 'Connected' in ui and gl.evaluate("document.body.dataset.heard === '1'"):
                    ok = True
                    break
            if not ok:
                problems.append(f'the Go live page never showed the stream hearing the sound (status: "{ui}")')
            else:
                step(f'link: "{ui.strip()}", the stream picture hears the Go live page\'s sound')
            # The streamer's buttons
            gl.click('#rNext')
            c.wait_frames(3, 'Next look from the Go live page')
            if not st.evaluate("document.querySelector('.sv-flash').textContent.includes('New look')"):
                problems.append('Next look on the Go live page did nothing on the stream')
            # Settings changed on the Go live page reach the stream
            gl.click('#tabSetup')
            gl.evaluate("document.querySelector('#st1 details').open = true")
            gl.select_option('#skipN', '3')
            c.wait_frames(6, 'settings reaching the stream')
            need = st.evaluate("document.querySelector('.sv-v.dn i').textContent")
            if '3' not in need:
                problems.append(f'changing votes-to-skip on the Go live page did not reach the stream ("{need}")')
            step('Go live page buttons and settings reach the stream')
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
