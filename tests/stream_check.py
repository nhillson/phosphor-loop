"""Stream mode check, for Claude's workspace: the stream picture (index.html?stream=1, what goes out on Twitch or
Kick), the Go live page (stream.html: the install view and the live view the tray icon opens), and runner mode
(runner=1, what the hidden browser shows, recording itself for the Windows runner in headless/).

Nothing here reaches Twitch, Kick or the real connection service: a pretend connection service passes messages
between the pages, so the Go live page and the stream picture link up for real inside the test browser. Chat voting
was removed on purpose; the test fails if a page tries to reach a chat or shows a vote counter. Runner mode records
the browser's fake microphone (a beep) and hands its pieces to the test instead of the runner.

The runner itself (PowerShell) is tested separately, end to end, with PowerShell, this browser and ffmpeg writing
a file: see CLAUDE.md.

Every wait is a number of frames the stream picture has drawn, never a number of seconds; each has a ceiling.

  python3 tests/stream_check.py           all of it (about a minute)
  python3 tests/stream_check.py --shot    also saves a picture of the stream

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


STREAM_STATE_JS = """() => ({
  ui: [...document.body.children].filter(e => e.id !== 'streamLayer' && getComputedStyle(e).display !== 'none').map(e => e.className || e.tagName),
  canvas: document.getElementById('screen').parentElement.id,
  size: [document.getElementById('screen').width, document.getElementById('screen').height],
  ap: document.documentElement.classList.contains('ap-on'),
  counter: !!document.querySelector('.sv, .sv-flash'),
  taste: window.__plStream().taste,
})"""

GOLIVE_FORM_JS = """() => ({
  every: document.getElementById('everyN').value,
  taste: document.getElementById('tasteSel').value,
  gone: ['twName', 'skipN', 'votesOn', 'rUp', 'rDown', 'tasteBox', 'sChat', 'sVotes'].filter(id => document.getElementById(id)),
  chatText: /!like|!skip|\\bchat\\b|vote/i.test(document.getElementById('live').textContent),
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
        ctx = b.new_context(viewport={'width': 480, 'height': 270})
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
            # 0. Runner mode (what the hidden browser shows): it records itself and hands the pieces over. In a
            # context of its own, first, while nothing else is drawing (this workspace draws in software)
            rctx = b.new_context(viewport={'width': 480, 'height': 270})
            rctx.grant_permissions(['microphone'])
            rctx.route_web_socket(is_chat, lambda ws: chat_tries.append(ws.url))
            rctx.route(lambda u: not u.startswith(base), lambda r: r.abort())
            rctx.route(lambda u: u.split('?')[0].endswith('/index.html'),
                       lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
            pieces, reports = [], []
            rn = rctx.new_page()
            watch(rn, 'runner page')
            rn.route('**/push?*', lambda r: (pieces.append(len(r.request.post_data_buffer or b'')), r.fulfill(status=200, body='ok')))
            rn.route('**/status', lambda r: (reports.append(r.request.post_data or ''), r.fulfill(status=200, body='ok')))
            rn.goto(base + 'index.html?stream=1&runner=1&sound=mic', timeout=check.START_CEILING_S * 1000)
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
            if 'chat' in last or 'ch' in last:
                problems.append(f'runner page still reports on a chat: {last}')
            step(f'runner page: sound {sound}, {len(pieces)} pieces handed over ({last.get("mime")}), reports {len(reports)}')
            rctx.close()

            # 1. The stream picture: only the canvas, Autopilot on, no chat and no vote counter. taste=chat is what
            # older Go live pages saved; it now means no taste
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

            # 2. The Go live page, as the tray icon opens it: linked to the stream, Next look and settings reach it
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
            form = gl.evaluate(GOLIVE_FORM_JS)
            if form['every'] != '20' or form['taste'] != 'none':
                problems.append(f"the Go live page did not show the stream's own settings ({form})")
            if form['gone'] or form['chatText']:
                problems.append(f'chat voting is still on the Go live page: {form["gone"]}, chat words: {form["chatText"]}')
            if '480' not in form['pic']:
                problems.append(f'the Go live page does not show the picture size: "{form["pic"]}"')
            gl.click('#rNext')
            nexts = 0
            for _ in range(10):
                c.wait_frames(3, 'Next look from the Go live page')
                nexts = st.evaluate('window.__plStream().nexts')
                if nexts:
                    break
            if nexts != 1:
                problems.append(f'Next look on the Go live page reached the stream {nexts} times, not once')
            gl.select_option('#everyN', '45')
            every = None
            for _ in range(10):
                c.wait_frames(3, 'settings reaching the stream')
                every = st.evaluate('window.__plStream().every')
                if every == 45:
                    break
            if every != 45:
                problems.append(f'changing "A new look every" on the Go live page did not reach the stream ({every})')
            step(f'Go live page: shows {form["pic"].strip()}; Next look and settings reach the stream; no chat voting')

            # 3. The install view (opened from the web): the download gives the one-file installer, which asks
            # Twitch or Kick
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
            if b"Items.Add('Kick')" not in raw or b'channel name' in raw.lower():
                problems.append('the installer does not offer Twitch or Kick (or still asks for a channel name)')
            fig = gi.evaluate("document.getElementById('figSetup').textContent")
            if 'Where do you stream?' not in fig:
                problems.append('the picture of the first-time box does not show the Twitch or Kick choice')
            step(f'install page: downloads {dl.value.suggested_filename} ({len(raw) // 1024} KB), which asks Twitch or Kick')

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
