#!/usr/bin/env python3
"""Check real external assets, double-click opening, and on-demand shader compilation.

Uses the same Playwright/Pillow environment as check.py. Waits only by frames.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from check import ROOT, serve


def main():
    root = Path(ROOT)
    app = (root / 'js/app.js').read_text().replace('const SIM_H = 576;', 'const SIM_H = 144;', 1)
    app = app.replace('function frame() {', 'function frame() { window.__plFrames = (window.__plFrames || 0) + 1;', 1)
    srv, port = serve()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            for url in [f'http://127.0.0.1:{port}/index.html', (root / 'index.html').as_uri()]:
                context = browser.new_context(service_workers='block', viewport={'width': 1000, 'height': 700})
                context.add_init_script('''
                    window.__programs = 0;
                    const create = WebGL2RenderingContext.prototype.createProgram;
                    WebGL2RenderingContext.prototype.createProgram = function() {
                        window.__programs++;
                        return create.call(this);
                    };
                ''')
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('**/js/app.js', lambda route: route.fulfill(content_type='application/javascript', body=app))
                page.goto(url, timeout=20000)

                def frames(n):
                    start = page.evaluate('window.__plFrames || 0')
                    page.wait_for_function('(n) => (window.__plFrames || 0) >= n', arg=start + n, timeout=20000)

                frames(10)
                assert page.evaluate('window.__programs') == 6, 'startup compiled optional worlds'
                assert page.locator('#msg').is_hidden(), 'startup error banner'
                assert page.locator('body').evaluate('(e) => getComputedStyle(e).backgroundColor') == 'rgb(24, 22, 25)', 'external CSS missing'
                for world, count in [('cubes', 7), ('sponge', 8), ('cubes', 8)]:
                    page.locator(f'[data-world="{world}"]').evaluate('(b) => b.click()')
                    frames(10)
                    assert page.evaluate('window.__programs') == count, f'{world}: shader was not compiled once and reused'
                    assert not page.locator(f'[data-world="{world}"]').evaluate('(b) => b.hidden'), f'{world}: compilation failed'
                with page.expect_popup() as opened:
                    page.locator('#outBtn').click()
                output = opened.value
                output.wait_for_function("getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)'", polling=100, timeout=10000)
                output.close()
                assert not errors, errors
                print(f'PASS {url.split(":")[0]}: external assets, 6 startup programs, worlds compile once and are reused')
                context.close()
            browser.close()
    finally:
        srv.shutdown()


if __name__ == '__main__':
    main()
