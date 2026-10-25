"""Phosphor Loop: checks Color grading and sliders following Autopilot.

  python3 tests/grade_check.py         (about a minute; waits by frames, like tests/check.py)

Color grading: Saturation 0 makes the picture grey, Exposure down makes it darker, a preset keeps the grading and
brings it back, Neutral and Back to normal reset it, it's remembered for next time, and Recolor is gone.
Sliders following Autopilot: after a new look, a slider Autopilot is changing shows the gliding value (not the end
value) and moves toward the end over the following frames; a slider moved by hand shows where it was put; when
Autopilot stops, sliders show the settings again.
Reaches into the app through window.__plGrade and window.__plAp. CHROME_PATH picks the browser, as in check.py.
Exit code 0 = passed.
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import Check, Stalled, patched_index, serve, FAIL_FAST_MS, START_CEILING_S, BANNER_JS, SLIDER_JS  # noqa: E402

# How grey and how bright the screen is right after a frame: mean channel spread and mean brightness, 0-255
STATS_JS = """() => new Promise((res) => requestAnimationFrame(() => {
  const s = document.getElementById('screen'), c = document.createElement('canvas');
  c.width = 160; c.height = 90;
  const g = c.getContext('2d'); g.drawImage(s, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let spread = 0, light = 0;
  for (let i = 0; i < d.length; i += 4) {
    spread += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    light += (d[i] + d[i + 1] + d[i + 2]) / 3;
  }
  const n = d.length / 4;
  res([spread / n, light / n]);
}))"""
# Loop A's sliders that Autopilot's new look moved furthest from where the picture is now
FAR_JS = """() => { const L = window.__plAp.loops.A;
  return ['zoom', 'spin', 'trails', 'color', 'warp', 'flow', 'size']
    .map((k) => [k, Math.abs(L.tgt[k] - L.cur[k])]).sort((a, b) => b[1] - a[1])[0]; }"""
SHOWN_JS = """(k) => { const L = window.__plAp.loops.A;
  return { shown: +document.getElementById(k).value, cur: L.cur[k], tgt: L.tgt[k] }; }"""


def run(c, base, problems):
    pg = c.pg
    pg.goto(base + 'index.html', timeout=START_CEILING_S * 1000)
    pg.add_style_tag(content='#tip, #osd, #toast { display: none !important; }')
    c.wait_frames(30, 'starting up')

    def expect(ok, what):
        print(('  ok    ' if ok else '  FAIL  ') + what)
        if not ok:
            problems.append(what)

    expect(pg.evaluate("() => !document.getElementById('recolor')"), 'Recolor slider is gone')
    expect(pg.evaluate("() => !!document.getElementById('gradeGroup')"), 'Color grading section is there')

    # Color grading on the picture
    c.wait_frames(30, 'warming up')
    spread0, light0 = pg.evaluate(STATS_JS)
    pg.evaluate(SLIDER_JS, ['gSat', 0])
    c.wait_frames(3, 'saturation 0')
    spread1, _ = pg.evaluate(STATS_JS)
    expect(spread1 < 2 and spread0 > 4, f'Saturation 0 makes the picture grey (color spread {spread0:.1f} → {spread1:.1f})')
    pg.evaluate(SLIDER_JS, ['gExposure', -20])
    c.wait_frames(3, 'exposure down')
    _, light2 = pg.evaluate(STATS_JS)
    expect(light2 < light0 * 0.5, f'Exposure −2 makes it darker (brightness {light0:.0f} → {light2:.0f})')
    expect(pg.evaluate("() => document.getElementById('gExposureOut').textContent") == '−2.0', 'Exposure shows −2.0')

    # Presets keep it
    data = pg.evaluate("() => window.__plGrade.snapshot()")
    expect(data.get('grade', {}).get('gSat') == 0 and data['grade'].get('gExposure') == -20, 'a preset keeps the grading')
    pg.click('#gradeReset')
    expect(pg.evaluate("() => window.__plGrade.grade.gSat") == 100, 'Back to normal resets it')
    pg.evaluate("(d) => window.__plGrade.loadPreset(d)", data)
    c.wait_frames(3, 'preset loaded')
    expect(pg.evaluate("() => [window.__plGrade.grade.gSat, +document.getElementById('gSat').value]") == [0, 0],
           'loading the preset brings the grading back (and its slider)')
    old = dict(data)
    old.pop('grade')
    old['A'] = dict(old['A'], recolor=90)
    pg.evaluate("(d) => window.__plGrade.loadPreset(d)", old)
    c.wait_frames(3, 'old preset loaded')
    expect(pg.evaluate("() => window.__plGrade.grade.gSat") == 100, 'a preset from before grading loads it at normal')
    expect(pg.evaluate("() => !('recolor' in window.__plAp.loops.A.tgt)"), "an old preset's Recolor is left behind")

    # Neutral resets it; a reload remembers it
    pg.evaluate(SLIDER_JS, ['gHue', 120])
    pg.click('#neutral')
    expect(pg.evaluate("() => window.__plGrade.grade.gHue") == 0, 'Neutral resets it')
    pg.evaluate(SLIDER_JS, ['gContrast', 150])
    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('phosphor-grade-v1') || '{}')")
    expect(saved.get('gContrast') == 150, 'remembered in the browser for next time')
    pg.click('#gradeReset')

    # Sliders follow Autopilot's glide
    pg.evaluate("() => { const { apSet } = window.__plAp; apSet.check = false; apSet.touch = 'play'; apSet.runs = ['A', 'B']; }")
    pg.click('#tabA')
    pg.click('#autopilot')
    c.wait_frames(5, 'Autopilot on')
    key, gap = None, 0
    for i in range(6):
        pg.evaluate("() => window.__plAp.step()")
        c.wait_frames(2, f'new look {i + 1}')
        key, gap = pg.evaluate(FAR_JS)
        if gap >= 8:
            break
    if gap < 8:
        problems.append('Autopilot never made a new look far enough from the last to watch a slider glide')
    else:
        s0 = pg.evaluate(SHOWN_JS, key)
        expect(abs(s0['shown'] - round(s0['cur'])) <= 1 and abs(s0['shown'] - s0['tgt']) >= 4,
               f"{key} shows the gliding value, not the end value (shows {s0['shown']}, now {s0['cur']:.1f}, heading for {s0['tgt']})")
        c.wait_frames(15, 'gliding')
        s1 = pg.evaluate(SHOWN_JS, key)
        expect(abs(s1['shown'] - s1['tgt']) < abs(s0['shown'] - s0['tgt']) and abs(s1['shown'] - round(s1['cur'])) <= 1,
               f"{key} moves toward the end as the picture glides ({s0['shown']} → {s1['shown']}, heading for {s1['tgt']})")
    # A slider moved by hand shows where it was put
    pg.evaluate(SLIDER_JS, ['spin', 77])
    c.wait_frames(5, 'moved spin by hand')
    s = pg.evaluate(SHOWN_JS, 'spin')
    expect(pg.evaluate("() => window.__plAp.ap.on") and s['shown'] == 77,
           f"a slider moved by hand stays where it was put (shows {s['shown']}, picture at {s['cur']:.1f})")
    # Autopilot off: sliders show the settings
    pg.evaluate("() => window.__plAp.step()")
    c.wait_frames(2, 'one more look')
    pg.click('#autopilot')
    c.wait_frames(2, 'Autopilot off')
    mism = pg.evaluate("""() => { const L = window.__plAp.loops.A;
      return ['zoom', 'spin', 'trails', 'color', 'warp', 'flow', 'size'].filter((k) => +document.getElementById(k).value !== Math.round(L.tgt[k])); }""")
    expect(not mism, f'with Autopilot off, sliders show the settings ({mism or "all match"})')


def main():
    from playwright.sync_api import sync_playwright
    out = os.path.join(tempfile.gettempdir(), 'phosphor-check')
    os.makedirs(out, exist_ok=True)
    html, notes = patched_index(216)
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/'
    errors, problems = [], []
    t0 = time.time()
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('CHROME_PATH'),
                              args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1920, 'height': 1080})
        pg.set_default_timeout(FAIL_FAST_MS)
        pg.route(lambda u: u.rstrip('/').endswith(f':{port}') or u.split('?')[0].endswith('/index.html'),
                 lambda route: route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
        pg.on('pageerror', lambda e: errors.append(f'page error: {e}'))
        pg.on('console', lambda m: errors.append(f'console error: {m.text}')
              if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text else None)
        try:
            run(Check(pg, out), base, problems)
        except Stalled as e:
            problems.append(str(e))
        except Exception as e:
            problems.append(f'test stopped: {str(e).splitlines()[0]}')
        try:
            banner = pg.evaluate(BANNER_JS)
        except Exception:
            banner = ''
        if banner:
            problems.insert(0, f'error message on screen: {banner}')
        b.close()
    srv.shutdown()
    for n in notes:
        print('note:', n)
    problems += errors
    if problems:
        print(f'FAIL in {time.time() - t0:.0f}s')
        for x in problems:
            print('  -', x)
        sys.exit(1)
    print(f'PASS in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
