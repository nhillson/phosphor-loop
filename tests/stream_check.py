"""Stream mode check, for Claude's workspace: the stream picture (index.html?stream=1, what OBS sends to Twitch or
Kick) and the Go live page (stream.html: Set up, with the OBS file it makes, and Go live, which links up with the
stream picture to send sound, Next look and settings).

Nothing here reaches Twitch, Kick, OBS or the real connection service: a pretend connection service passes messages
between the pages, so the Go live page and the stream picture link up for real inside the test browser, and the
browser's fake microphone (a beep) stands in for the music. Chat voting was removed on purpose; the test fails if a
page tries to reach a chat or shows a vote counter.

Every wait is a number of frames the stream picture has drawn, never a number of seconds; each has a ceiling.

  python3 tests/stream_check.py           all of it (about 40 s)
  python3 tests/stream_check.py --shot    also saves a picture of the stream

Exit code 0 = passed. Needs Python Playwright and Pillow (both pre-installed in Claude's workspace).
"""
import argparse
import json
import os
import sys
import tempfile
import time
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402  (the safety check's server, page patching and frame waits)

SIGNAL = 'ws://signal.test/peerjs'
LINK = 'testlink42'


def is_chat(url):
    """A chat connection of any kind: there should never be one now."""
    u = url.lower()
    return 'irc' in u or 'twitch' in u or 'kick' in u or 'pusher' in u


class PretendSignal:
    """The few messages of the PeerJS connection service the pages use: OPEN, and passing OFFER/ANSWER/... on."""

    def __init__(self):
        self.peers = {}

    def handle(self, ws):
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


STREAM_STATE_JS = """() => ({
  ui: [...document.body.children].filter(e => e.id !== 'streamLayer' && getComputedStyle(e).display !== 'none').map(e => e.className || e.tagName),
  canvas: document.getElementById('screen').parentElement.id,
  size: [document.getElementById('screen').width, document.getElementById('screen').height],
  ap: document.documentElement.classList.contains('ap-on'),
  counter: !!document.querySelector('.sv, .sv-flash'),
  taste: window.__plStream().taste,
})"""

SETUP_JS = """() => ({
  setupShown: !document.getElementById('setup').hidden,
  rate: document.getElementById('rateTxt').textContent,
  kickSteps: !document.querySelector('ol[data-site="kick"]').hidden,
  twitchSteps: !document.querySelector('ol[data-site="twitch"]').hidden,
  fig: document.getElementById('figStream').textContent,
  names: [...document.querySelectorAll('.siteName')].map(e => e.textContent),
})"""

LIVE_JS = """() => ({
  gone: ['twName', 'skipN', 'votesOn', 'rUp', 'rDown', 'tasteBox', 'sChat', 'sVotes', 'figWizard'].filter(id => document.getElementById(id)),
  chatText: /!like|!skip|\\bchat\\b|vote/i.test(document.body.innerText),   // what's shown, not the script
  pic: document.getElementById('sPic').textContent,
})"""


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
    sig = PretendSignal()
    chat_tries = []

    def step(text):
        print(f'  {text}')

    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                                    '--autoplay-policy=no-user-gesture-required'])
        ctx = b.new_context(viewport={'width': 480, 'height': 270}, accept_downloads=True)
        ctx.grant_permissions(['microphone'])
        ctx.route_web_socket(is_chat, lambda ws: chat_tries.append(ws.url))
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
            # 1. The stream picture, as OBS shows it: only the canvas, Autopilot on, no chat and no vote counter.
            # taste=chat is what older Go live pages saved; it now means no taste
            st.goto(base + f'index.html?stream=1&taste=chat&every=20&link={LINK}&signal={SIGNAL}&at=1000',
                    timeout=check.START_CEILING_S * 1000)
            c.wait_frames(30, 'stream picture starting', ceiling=check.START_CEILING_S)
            state = st.evaluate(STREAM_STATE_JS)
            if state['ui']:
                problems.append(f'controls showing on the stream: {state["ui"]}')
            if state['canvas'] != 'streamLayer':
                problems.append('the picture is not in the stream layer')
            if state['size'] != [480, 270]:
                problems.append(f'picture is {state["size"]}, not the window size 480 x 270')
            if not state['ap']:
                problems.append('Autopilot did not start by itself')
            if state['counter']:
                problems.append('a vote counter is on the stream picture')
            if state['taste'] != 'none':
                problems.append(f'taste=chat (from an older Go live page) became "{state["taste"]}", not none')
            step(f'stream picture: controls hidden, {state["size"][0]} x {state["size"][1]}, Autopilot on, '
                 f'no vote counter, taste {state["taste"]}')
            path, lit = c.picture('stream-start')
            if lit < 3:
                problems.append(f'the stream picture is black (brightness {lit:.1f})')
            if a.shot:
                step(f'picture: {path}')

            # 2. The Go live page, first visit: it opens on Set up. Twitch or Kick changes the OBS steps and bitrate
            gl = ctx.new_page()
            gl.set_viewport_size({'width': 1100, 'height': 900})
            watch(gl, 'Go live page')
            gl.goto(base + f'stream.html?signal={SIGNAL}&link={LINK}', timeout=15000)
            gl.check('#siteKick')
            kick = gl.evaluate(SETUP_JS)
            gl.check('#siteTwitch')
            twitch = gl.evaluate(SETUP_JS)
            if not kick['setupShown']:
                problems.append('the Go live page did not open on Set up the first time')
            if kick['rate'] != '7500' or not kick['kickSteps'] or kick['twitchSteps'] or 'Server' not in kick['fig'] or set(kick['names']) != {'Kick'}:
                problems.append(f'picking Kick did not show the Kick steps and 7500 Kbps: {kick}')
            if twitch['rate'] != '8000' or not twitch['twitchSteps'] or twitch['kickSteps'] or 'Connect Account' not in twitch['fig']:
                problems.append(f'picking Twitch did not show the Twitch steps and 8000 Kbps: {twitch}')
            step(f'Set up: Kick shows its steps and {kick["rate"]} Kbps, Twitch shows its steps and {twitch["rate"]} Kbps')

            # The OBS file: one browser source with the stream picture's address at 1920 x 1080, and the computer's sound
            with gl.expect_download(timeout=check.FAIL_FAST_MS) as dl:
                gl.click('#obsFile')
            got = os.path.join(a.out, 'obs.json')
            dl.value.save_as(got)
            obs = json.load(open(got, encoding='utf-8'))
            pic = next((s for s in obs.get('sources', []) if s.get('id') == 'browser_source'), {})
            ps = pic.get('settings', {})
            q = parse_qs(urlparse(ps.get('url', '')).query)
            if obs.get('name') != 'Phosphor Loop' or ps.get('width') != 1920 or ps.get('height') != 1080:
                problems.append(f'the OBS file is wrong: {obs.get("name")}, {ps.get("width")} x {ps.get("height")}')
            if q.get('stream') != ['1'] or q.get('link') != [LINK] or any(k in q for k in ('twitch', 'skip', 'votes')):
                problems.append(f'the OBS file points at the wrong address: {ps.get("url")}')
            if (obs.get('DesktopAudioDevice1') or {}).get('id') != 'wasapi_output_capture':
                problems.append('the OBS file does not take the computer\'s sound')
            step(f'OBS file: "{obs.get("name")}", picture {ps.get("width")} x {ps.get("height")}, address {urlparse(ps.get("url", "")).path}?stream=1…')

            # 3. Go live: linked to the stream picture; a microphone's sound, Next look and settings reach it
            gl.click('#tabLive')
            ok, ui = False, ''
            for _ in range(40):
                c.wait_frames(4, 'waiting for the Go live page to link up', ceiling=20)
                ui = gl.evaluate("document.getElementById('linkState').textContent")
                if 'Connected' in ui:
                    ok = True
                    break
            if not ok:
                problems.append(f'the Go live page never linked up with the stream picture (status: "{ui}")')
            else:
                step(f'Go live: "{ui.strip()}"')
            live = gl.evaluate(LIVE_JS)
            if live['gone'] or live['chatText']:
                problems.append(f'chat voting is still on the Go live page: {live["gone"]}, chat words: {live["chatText"]}')
            if '480' not in live['pic']:
                problems.append(f'the Go live page does not show the picture size: "{live["pic"]}"')
            gl.click('#sndMic')
            heard, said = False, ''
            for _ in range(40):
                c.wait_frames(4, 'the microphone reaching the stream picture', ceiling=20)
                said = gl.evaluate("document.getElementById('sndState').textContent")
                if 'hears it' in said:
                    heard = True
                    break
            if not heard:
                problems.append(f'the microphone\'s sound did not reach the stream picture ("{said}")')
            gl.click('#rNext')
            nexts = 0
            for _ in range(10):
                c.wait_frames(3, 'Next look from the Go live page')
                nexts = st.evaluate('window.__plStream().nexts')
                if nexts:
                    break
            if nexts != 1:
                problems.append(f'Next look on the Go live page reached the stream {nexts} times, not once')
            gl.evaluate("() => { const e = document.getElementById('everyN'); e.value = '45'; e.dispatchEvent(new Event('change')); }")
            every = None
            for _ in range(10):
                c.wait_frames(3, 'settings reaching the stream')
                every = st.evaluate('window.__plStream().every')
                if every == 45:
                    break
            if every != 45:
                problems.append(f'changing "A new look every" did not reach the stream picture ({every})')
            step(f'Go live: shows {live["pic"].strip()}; sound {"heard" if heard else "not heard"}; Next look and settings reach the stream; no chat voting')

        except check.Stalled as e:
            problems.append(str(e))
        if chat_tries:
            problems.append(f'a page tried to connect to a chat: {chat_tries[:3]}')
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
