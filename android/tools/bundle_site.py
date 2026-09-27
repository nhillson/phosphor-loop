#!/usr/bin/env python3
"""Put a copy of Phosphor Loop (and its fonts) inside the Android app.

The app normally loads the live site, so updates arrive by themselves. This copy is only used when the
phone has never been online with the app yet. Run from anywhere; GitHub runs it before each build.
"""
import html
import json
import os
import re
import shutil
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, 'android', 'app', 'build', 'offline-assets', 'offline')
SITE = 'https://nhillson.github.io/phosphor-loop/'
FILES = {
    'index.html': 'text/html',
    'phone.html': 'text/html',
    'qrcode.js': 'application/javascript',
    'sw.js': 'application/javascript',
    'icon-180.png': 'image/png',
    'icon-192.png': 'image/png',
}
# Google Fonts picks the font format from the browser name, so ask the way the app's browser would
UA = ('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36')


def text_charset(mime):
    return 'utf-8' if mime.startswith('text/') or mime in ('application/javascript', 'application/json') else ''


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read(), r.headers.get_content_type()


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    manifest = {}
    count = 0

    def add(url, data, mime):
        nonlocal count
        name = f'f{count}'
        count += 1
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(data)
        manifest[url] = {'file': name, 'mime': mime, 'charset': text_charset(mime)}

    pages = ''
    for name, mime in FILES.items():
        path = os.path.join(REPO, name)
        if not os.path.isfile(path):
            print(f'skipped {name} (not found)')
            continue
        with open(path, 'rb') as f:
            data = f.read()
        add(SITE + name, data, mime)
        if name.endswith('.html'):
            pages += data.decode('utf-8', 'replace')

    for css_url in sorted(set(html.unescape(u) for u in re.findall(r'https://fonts\.googleapis\.com/css2\?[^"\'\s<>)]+', pages))):
        try:
            css, _ = get(css_url)
        except Exception as e:  # fonts are a nicety; the page falls back to built-in fonts
            print(f'fonts skipped: {e}')
            continue
        add(css_url, css, 'text/css')
        for font_url in sorted(set(re.findall(r'url\((https://fonts\.gstatic\.com/[^)\s]+)\)', css.decode('utf-8', 'replace')))):
            try:
                data, mime = get(font_url)
                if font_url.endswith('.woff2'):
                    mime = 'font/woff2'
                add(font_url, data, mime)
            except Exception as e:
                print(f'font file skipped: {font_url}: {e}')

    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)
    print(f'bundled {len(manifest)} files into {OUT}')


if __name__ == '__main__':
    main()
