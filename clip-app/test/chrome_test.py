"""The Send to Phosphor Clips button (chrome-button/) in Chromium, talking to the real Phosphor Clips app.

  python test/chrome_test.py        (ELECTRON=<electron program or the installed Phosphor Clips.exe>; on Linux run it
                                     under xvfb-run, since Chromium only runs extensions in a window)

Starts Phosphor Clips (test mode, sharing on port 47811) and the test pages, loads the extension into Chromium, then
does what the button and the right-click menu do (a test can't click Chrome's own toolbar or menus, so it calls the
same functions they call) and checks Phosphor Clips' log for each result: a page with its video picking up at the
same moment, a right-clicked video, a GIF going to the trimmer, a link, a page that can't be sent, and the
"Phosphor Clips isn't running" page with its Start button once the app is closed. Pictures go to OUT
(default test-out/chrome).
"""
import base64
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, 'chrome-button')
OUT = os.path.abspath(os.environ.get('OUT') or os.path.join(ROOT, 'test-out', 'chrome'))
PORT = 47811
problems, passed = [], []


def check(name, ok, note=''):
    (passed if ok else problems).append(name + (f'  ({note})' if note else ''))
    print(('ok    ' if ok else 'FAIL  ') + name + (f'  ({note})' if note else ''), flush=True)


def electron_cmd():
    e = os.environ.get('ELECTRON')
    if not e:
        exe = 'electron.exe' if os.name == 'nt' else 'electron'
        e = os.path.join(ROOT, 'node_modules', 'electron', 'dist', exe)
    args = [e, ROOT]
    if sys.platform.startswith('linux'):
        args.insert(1, '--no-sandbox')
    return args


class App:
    """Phosphor Clips in test mode, with its log lines collected as they come."""

    def __init__(self, work):
        env = dict(os.environ, CLIPS_TEST='1', CLIPS_PORT=str(PORT), CLIPS_NO_VISION='1',
                   CLIPS_DATA=os.path.join(work, 'data'), CLIPS_LIBRARY=os.path.join(work, 'Library'))
        env.pop('CLIPS_TEST_URL', None)
        self.p = subprocess.Popen(electron_cmd(), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                  encoding='utf-8', errors='replace')
        self.lines, self.q = [], queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.p.stdout:
            line = line.rstrip()
            self.lines.append(line)
            self.q.put(line)

    def wait_for(self, pattern, ceiling_s=60, after=0):
        """The first log line from index `after` on matching the pattern; the time is only a ceiling."""
        rx = re.compile(pattern)
        end = time.time() + ceiling_s
        i = after
        while time.time() < end:
            while i < len(self.lines):
                m = rx.search(self.lines[i])
                if m:
                    return m, i + 1
                i += 1
            if self.p.poll() is not None:
                break
            try:
                self.q.get(timeout=0.25)
            except queue.Empty:
                pass
        return None, i

    def stop(self):
        if self.p.poll() is None:
            self.p.terminate()
            try:
                self.p.wait(15)
            except subprocess.TimeoutExpired:
                self.p.kill()


APP = None


def main():
    global APP
    os.makedirs(OUT, exist_ok=True)
    work = tempfile.mkdtemp(prefix='clips-chrome-')
    fx = subprocess.Popen(['node', os.path.join(ROOT, 'test', 'serve-fixtures.js'), os.path.join(work, 'media')],
                          stdout=subprocess.PIPE, text=True)
    first = fx.stdout.readline().strip()
    if not first.startswith('READY'):
        sys.exit('FAIL: the test pages did not start: ' + first)
    base = first.split(' ', 1)[1]
    app = App(work)
    APP = app
    m, at = app.wait_for(r'library sharing on http://127\.0\.0\.1:(\d+)', 90)
    if not m or int(m.group(1)) != PORT:
        print('\n'.join(app.lines[-30:]))
        app.stop(); fx.terminate()
        sys.exit(f'FAIL: Phosphor Clips did not start sharing on port {PORT}')
    print('  Phosphor Clips is up; test pages at ' + base, flush=True)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            os.path.join(work, 'chrome-profile'), headless=False, viewport={'width': 1280, 'height': 760},
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--autoplay-policy=no-user-gesture-required'])
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=20000)
        check('the extension loads', sw.url.endswith('/background.js'), sw.url)
        ext_id = sw.url.split('/')[2]
        # Developer mode on, as in Nick's Chrome (it's needed to add the button; without it Chrome turns an unpacked
        # extension off when it reloads itself). Switched on on the extensions page, as he did.
        try:
            ep = ctx.new_page()
            ep.goto('chrome://extensions')
            ep.evaluate("() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })")
            dev = ep.evaluate("() => chrome.developerPrivate.getProfileConfiguration().then((c) => c.inDeveloperMode)")
            ep.close()
        except Exception as e:
            dev = str(e).splitlines()[0]
        check('Developer mode is on (as in Nick’s Chrome)', dev is True, str(dev))
        # Its Chrome functions are there once it has finished starting (a ceiling, not a pause)
        end = time.time() + 20
        while time.time() < end and not sw.evaluate("() => typeof chrome !== 'undefined' && !!chrome.contextMenus && !!self.__clips"):
            time.sleep(0.2)

        # The right-click menu items are there
        menus = sw.evaluate("""() => Promise.all(['video', 'gif', 'link'].map((id) => new Promise((r) =>
            chrome.contextMenus.update(id, {}, () => r(chrome.runtime.lastError ? id + ': missing' : id + ': ok')))))""")
        check('the right-click menu has its three items', all(x.endswith(': ok') for x in menus), ', '.join(menus))

        # It said hello to Phosphor Clips when it was added
        m, at = app.wait_for(r'chrome: the button was added to Chrome', 20, 0)
        check('Phosphor Clips heard the button being added', bool(m))

        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        tab_of = """async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)"""

        def video_frames(n):
            return pg.evaluate("""(n) => new Promise((r) => { const v = document.querySelector('video'); let i = 0;
                const cb = () => (++i >= n ? r(v.currentTime) : v.requestVideoFrameCallback(cb)); v.requestVideoFrameCallback(cb); })""", n)

        # 1. The button on a page whose video is at 3:20
        pg.goto(base + 'long.html')
        video_frames(5)
        pg.evaluate("document.querySelector('video').currentTime = 200")
        t_chrome = video_frames(10)
        r = sw.evaluate(f"""async () => self.__clips.sendPage(await ({tab_of})({json.dumps(base + 'long.html')}))""")
        check('the button sends the page', r.get('ok'), r.get('message', ''))
        m, at = app.wait_for(r'chrome: page (\S+) at ([\d.]+) s \(button\)', 20, at)
        check('Phosphor Clips gets the page with its video time', bool(m) and m.group(1).endswith('long.html') and abs(float(m.group(2)) - t_chrome) < 2,
              m.group(0) if m else 'nothing in the log')
        m, at = app.wait_for(r'chrome: picked the video up at ([\d.]+) s', 60, at)
        check('the video picks up there in Phosphor Clips', bool(m), m.group(0) if m else 'it did not')
        paused = pg.evaluate("document.querySelector('video').paused")
        check('the video in Chrome pauses once it’s handed over', paused)
        pg.screenshot(path=os.path.join(OUT, '1-page-sent.png'))

        # 2. Right-click a video: Send this video to Phosphor Clips
        pg.evaluate("document.querySelector('video').play()")
        pg.evaluate("document.querySelector('video').currentTime = 420")
        video_frames(10)
        r = sw.evaluate(f"""async () => {{ const tab = await ({tab_of})({json.dumps(base + 'long.html')});
            return self.__clips.onMenu({{ menuItemId: 'video', pageUrl: tab.url, srcUrl: {json.dumps(base + 'long.webm')}, frameId: 0 }}, tab); }}""")
        check('Send this video to Phosphor Clips sends it', r.get('ok'), r.get('message', ''))
        m, at = app.wait_for(r'chrome: video (\S+) at ([\d.]+) s', 20, at)
        check('Phosphor Clips gets the video with its time', bool(m) and abs(float(m.group(2)) - 420) < 3, m.group(0) if m else 'nothing in the log')
        m, at = app.wait_for(r'chrome: picked the video up at ([\d.]+) s', 60, at)
        check('that video picks up there too', bool(m) and abs(float(m.group(1)) - 420) < 3, m.group(0) if m else 'it did not')

        # 3. Right-click a GIF: Grab this GIF with Phosphor Clips (straight to the trimmer)
        pg.goto(base + 'gif.html')
        r = sw.evaluate(f"""async () => {{ const tab = await ({tab_of})({json.dumps(base + 'gif.html')});
            return self.__clips.onMenu({{ menuItemId: 'gif', pageUrl: tab.url, srcUrl: {json.dumps(base + 'spin.gif')} }}, tab); }}""")
        check('Grab this GIF with Phosphor Clips sends it', r.get('ok'), r.get('message', ''))
        m, at = app.wait_for(r'chrome: gif (\S+)', 20, at)
        check('Phosphor Clips gets the GIF', bool(m) and m.group(1).endswith('spin.gif'))
        m, at = app.wait_for(r'grab \S+ ready: (\d+)x(\d+) ([\d.]+) s', 120, at)
        check('the GIF is downloaded and ready to trim', bool(m) and abs(float(m.group(3)) - 4) < 0.3, m.group(0) if m else 'it was not')

        # 4. Right-click a link: Open link in Phosphor Clips
        r = sw.evaluate(f"""async () => {{ const tab = await ({tab_of})({json.dumps(base + 'gif.html')});
            return self.__clips.onMenu({{ menuItemId: 'link', pageUrl: tab.url, linkUrl: {json.dumps(base + 'video.html')} }}, tab); }}""")
        check('Open link in Phosphor Clips sends it', r.get('ok'), r.get('message', ''))
        m, at = app.wait_for(r'chrome: link (\S+)', 20, at)
        check('Phosphor Clips opens the link', bool(m) and m.group(1).endswith('video.html'))

        # 4b. The button's menu: Start here / End here while the video plays, then Grab: only that part downloads
        pg.goto(base + 'long.html')
        video_frames(5)
        tab_id = sw.evaluate(f"""async () => (await ({tab_of})({json.dumps(base + 'long.html')})).id""")
        popup_url = f'chrome-extension://{ext_id}/popup.html?tab={tab_id}'

        def text_until(m, sel, pattern, ceiling_s=10):
            """The element's text once it matches (extension pages don't allow the usual in-page waits); the time
            is only a ceiling"""
            rx = re.compile(pattern)
            end = time.time() + ceiling_s
            t = ''
            while time.time() < end:
                t = m.inner_text(sel)
                if rx.search(t):
                    return t
                time.sleep(0.1)
            return t

        def open_menu():
            m = ctx.new_page()
            m.set_viewport_size({'width': 340, 'height': 420})
            m.goto(popup_url)
            text_until(m, '#nowText', 'Video', 15)
            return m

        menu = open_menu()
        # (paused at exact times: the page's tab is in the background while the menu is open, so its clock can't be
        # watched frame by frame)
        pg.evaluate("(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 200; })()")
        text_until(menu, '#nowText', r'paused at 3:20\.0')
        menu.click('#start')
        pg.evaluate("document.querySelector('video').currentTime = 210")
        text_until(menu, '#nowText', r'paused at 3:30\.0')
        menu.click('#end')
        sv, ev = menu.inner_text('#startVal'), menu.inner_text('#endVal')
        check('Start here and End here mark the video in Chrome', sv == '3:20.0' and ev == '3:30.0', f'{sv} to {ev}')
        note = menu.inner_text('#note')
        check('the menu says only the marked part downloads', 'downloads' in note and '3:17' in note, note)
        check('the big button says Grab the marked part', menu.inner_text('#grab') == 'Grab the marked part')
        menu.screenshot(path=os.path.join(OUT, '3-menu-marked.png'))
        # The menu closes when you click on the page; open it again and the marks are still there
        menu.close()
        menu = open_menu()
        check('the marks are kept when the menu closes and opens again', menu.inner_text('#startVal') == sv and menu.inner_text('#endVal') == ev)
        menu.click('#grab')
        m, at = app.wait_for(r'chrome: grab (\S+) marked ([\d.]+)-([\d.]+) s', 20, at)
        check('Phosphor Clips gets the grab with the marks', bool(m) and abs(float(m.group(2)) - 200) < 2 and abs(float(m.group(3)) - 210) < 2,
              m.group(0) if m else 'nothing in the log')
        m, at = app.wait_for(r'grab \S+ ready: (\d+)x(\d+) ([\d.]+) s', 120, at)
        check('only the marked part downloads (plus a little either side)', bool(m) and float(m.group(3)) < 30, m.group(0) if m else 'it did not')
        try:
            done = text_until(menu, '#done', 'Sent to Phosphor Clips', 5)
            check('the menu says it was sent', 'Sent to Phosphor Clips' in done)
            menu.screenshot(path=os.path.join(OUT, '4-menu-sent.png'))
        except Exception:
            check('the menu says it was sent', menu.is_closed(), 'it closed already')
        check('the video in Chrome pauses once it\u2019s grabbed', pg.evaluate("document.querySelector('video').paused"))
        # Open this page in Phosphor Clips instead (what the button did before)
        pg.evaluate("document.querySelector('video').play()")
        video_frames(5)
        menu = open_menu()
        check('the marks are cleared after a grab', menu.inner_text('#startVal') == '\u2014')
        menu.click('#openPage')
        m, at = app.wait_for(r'chrome: page (\S+) at ([\d.]+) s \(button\)', 20, at)
        check('Open this page in Phosphor Clips instead still works', bool(m) and m.group(1).endswith('long.html'), m.group(0) if m else 'nothing in the log')
        if not menu.is_closed():
            menu.close()

        # 4c. The button updates itself when Phosphor Clips has newer files (once per version)
        check('the button knows which versions are newer', sw.evaluate("() => self.__clips.newer('1.10.0', '1.9.2') && !self.__clips.newer('1.1.0', '1.1.0')"))
        old_sw = sw
        # With the menu open it waits (a reload would close the menu under the mouse), then reloads once it's closed
        menu = open_menu()
        sw.evaluate("() => { self.__clips.updateIfNewer('9.9.9'); }")
        time.sleep(2)   # (a ceiling: a reload would have replaced this background within this time)
        try:
            waiting = sw.evaluate("async () => !!self.__clips && !(await chrome.storage.local.get('reloadFor')).reloadFor")
        except Exception:
            waiting = False
        check('it waits while the menu is open', waiting)
        menu.close()

        def live_background(not_this=None, ceiling_s=20):
            """The extension's background after a reload: a working one that isn't the old one (a ceiling, not a pause)"""
            end = time.time() + ceiling_s
            woke = False
            while time.time() < end:
                for w in ctx.service_workers:
                    if w is not_this or not w.url.endswith('/background.js'):
                        continue
                    try:
                        if w.evaluate("() => !!self.__clips"):
                            return w
                    except Exception:
                        pass
                if not woke and time.time() > end - ceiling_s + 3:
                    # A background that has stopped starts again for a message: open the menu once to wake it
                    try:
                        m = ctx.new_page(); m.goto(popup_url); m.close()
                    except Exception:
                        pass
                    woke = True
                time.sleep(0.25)
            return None

        sw2 = live_background(not_this=old_sw)
        if sw2:
            again = sw2.evaluate("async () => (await chrome.storage.local.get('reloadFor')).reloadFor")
            check('it reloads itself to pick up newer files', again == '9.9.9', again)
            sw = sw2
            sw.evaluate("() => { self.__clips.updateIfNewer('9.9.9'); }")
            time.sleep(2)   # (a ceiling: a second reload would replace this background within this time)
            try:
                still = sw.evaluate("() => !!self.__clips")
            except Exception:
                still = False
            check('only once per version (no reload loop)', still)
        else:
            check('it reloads itself to pick up newer files', False, 'no background came back')
            sw = live_background() or old_sw

        # 5. A page that can't be sent (one of Chrome's own)
        pg.goto('chrome://version')
        n_before = len(ctx.pages)
        r = sw.evaluate("""async () => self.__clips.sendPage((await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0])""")
        check('Chrome’s own pages aren’t sent', r.get('ok') is False)
        ctx.wait_for_event('page', timeout=10000) if len(ctx.pages) == n_before else None
        explain = [x for x in ctx.pages if 'explain.html' in x.url]
        check('it explains why on a page beside it', bool(explain) and 'why=notWeb' in explain[-1].url, explain[-1].url if explain else 'no page')
        for x in explain:
            x.close()

        # 6. Phosphor Clips not running: the explain page with a Start button carrying the request
        app.stop()
        pg.goto(base + 'long.html')   # (WebM: this Chromium can't play the H.264 test video)
        video_frames(5)
        n_before = len(ctx.pages)
        r = sw.evaluate(f"""async () => self.__clips.sendPage(await ({tab_of})({json.dumps(base + 'long.html')}))""")
        check('with Phosphor Clips closed, the button says so', r.get('notRunning') is True)
        if len(ctx.pages) == n_before:
            ctx.wait_for_event('page', timeout=10000)
        ex = [x for x in ctx.pages if 'explain.html' in x.url]
        if ex:
            page = ex[-1]
            page.wait_for_load_state()
            page.set_viewport_size({'width': 900, 'height': 640})
            href = page.get_attribute('#start', 'href') or ''
            ok = href.startswith('phosphor-clips://open?d=')
            payload = {}
            if ok:
                d = href.split('d=', 1)[1]
                payload = json.loads(base64.urlsafe_b64decode(d + '=' * (-len(d) % 4)).decode('utf-8'))
            check('its Start Phosphor Clips button carries what was sent', ok and payload.get('url') == base + 'long.html' and payload.get('kind') == 'page' and payload.get('t', 0) > 0,
                  json.dumps(payload)[:120])
            check('the page is visible and plain', page.is_visible('#start') and 'isn’t running' in page.inner_text('h1'))
            page.screenshot(path=os.path.join(OUT, '2-not-running.png'))
        else:
            check('the "not running" page opens', False, 'no page')
        ctx.close()
    app.stop()
    fx.terminate()
    with open(os.path.join(OUT, 'app-log.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(app.lines))
    with open(os.path.join(OUT, 'result.json'), 'w', encoding='utf-8') as f:
        json.dump({'ok': not problems, 'passed': passed, 'failed': problems}, f, indent=2)
    shutil.rmtree(work, ignore_errors=True)
    print(f"\n{len(passed)} passed, {len(problems)} failed")
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except BaseException:
        # Keep what was found so far (the Windows build's log can't always be read): results, the crash, the app's log
        import traceback
        tb = traceback.format_exc()
        print(tb, flush=True)
        check('the test ran to the end', False, tb[-1800:])
        os.makedirs(OUT, exist_ok=True)
        if APP:
            try:
                APP.stop()
            except Exception:
                pass
            with open(os.path.join(OUT, 'app-log.txt'), 'w', encoding='utf-8') as f:
                f.write('\n'.join(APP.lines))
        with open(os.path.join(OUT, 'result.json'), 'w', encoding='utf-8') as f:
            json.dump({'ok': False, 'passed': passed, 'failed': problems}, f, indent=2)
        print(f"\n{len(passed)} passed, {len(problems)} failed")
        sys.exit(1)
