#!/usr/bin/env python3
"""Gather the built-in nature pictures from Wikimedia Commons' Featured Pictures.

Runs on GitHub (see .github/workflows/nature-pictures.yml). Steps, chosen by nature-src/job.txt:
  explore     list the featured-picture categories and how many files each holds
  candidates  collect free-license photos from the chosen categories, score them, make contact sheets
  final       download the chosen photos, make thumbnails, write nature/pictures.json and credits
"""
import html
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = 'https://commons.wikimedia.org/w/api.php'
UA = 'PhosphorLoopNaturePictures/1.0 (https://github.com/nhillson/phosphor-loop; nicholas.hillson@gmail.com)'
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'nature-src')
OUT = os.path.join(ROOT, 'nature')


def http(url, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(3 * (i + 1) ** 2)
                continue
            raise
        except Exception:
            if i < tries - 1:
                time.sleep(3 * (i + 1))
                continue
            raise


def api(**params):
    params.update(format='json', formatversion='2', maxlag='5')
    out = json.loads(http(API + '?' + urllib.parse.urlencode(params)))
    if 'error' in out:
        if out['error'].get('code') == 'maxlag':
            time.sleep(5)
            return api(**{k: v for k, v in params.items() if k not in ('format', 'formatversion', 'maxlag')})
        raise RuntimeError(out['error'])
    return out


def api_all(**params):
    cont = {}
    while True:
        out = api(**params, **cont)
        yield out
        if 'continue' not in out:
            break
        cont = out['continue']


def subcats(cat):
    res = []
    for out in api_all(action='query', list='categorymembers', cmtitle=cat, cmtype='subcat', cmlimit='500'):
        res += [m['title'] for m in out['query']['categorymembers']]
    return res


def files_in(cat):
    res = []
    for out in api_all(action='query', list='categorymembers', cmtitle=cat, cmtype='file', cmlimit='500'):
        res += [m['title'] for m in out['query']['categorymembers']]
    return res


def catinfo(cats):
    info = {}
    for i in range(0, len(cats), 50):
        out = api(action='query', prop='categoryinfo', titles='|'.join(cats[i:i + 50]))
        for p in out['query']['pages']:
            ci = p.get('categoryinfo', {})
            info[p['title']] = (ci.get('files', 0), ci.get('subcats', 0))
    return info


# ---------------------------------------------------------------- explore
def explore(args):
    roots = [l.strip() for l in open(os.path.join(SRC, 'explore.txt'), encoding='utf-8') if l.strip() and not l.startswith('#')]
    lines = []
    seen = set()

    def walk(cat, depth, maxdepth):
        if cat in seen:
            return
        seen.add(cat)
        kids = subcats(cat)
        info = catinfo([cat] + kids) if kids else catinfo([cat])
        f, s = info.get(cat, (0, 0))
        lines.append('  ' * depth + f'{cat}  [files {f}, subcats {s}]')
        if depth < maxdepth:
            for k in kids:
                walk(k, depth + 1, maxdepth)
        else:
            for k in kids:
                kf, ks = info.get(k, (0, 0))
                lines.append('  ' * (depth + 1) + f'{k}  [files {kf}, subcats {ks}]  (not opened)')

    for r in roots:
        cat, _, d = r.partition('|')
        walk(cat.strip(), 0, int(d or 3))
    with open(os.path.join(SRC, 'explore-report.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'{len(lines)} categories listed')


# ---------------------------------------------------------------- shared helpers
OK_LICENSE = re.compile(r'^(public domain|pd\b|pd-|cc0|cc[ -]by(-sa)?[ -]?\d|cc[ -]by(-sa)?$)', re.I)
BAD_LICENSE = re.compile(r'\b(nc|nd)\b|gfdl only|fal\b', re.I)
BAD_TITLE = re.compile(r'illustrat|drawing|painting|plate|engraving|lithograph|haeckel|kunstformen|map\b|stamp|coin|'
                       r'logo|statue|sculpture|specimen|skeleton|fossil|museum|herbarium|diagram|chart|book|'
                       r'woodcut|watercolou?r|poster|\bart\b|mosaic|tapestry|x-ray|microscop|sem image|svg', re.I)


def strip_html(s):
    s = re.sub(r'<[^>]+>', '', s or '')
    s = html.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()


def imageinfo(titles, thumbw):
    """Size, license, author and a thumbnail address for up to 50 files at a time."""
    res = {}
    for i in range(0, len(titles), 50):
        out = api(action='query', prop='imageinfo', titles='|'.join(titles[i:i + 50]),
                  iiprop='size|mime|url|extmetadata', iiurlwidth=str(thumbw),
                  iiextmetadatafilter='LicenseShortName|LicenseUrl|Artist|Credit|ObjectName|Restrictions')
        for p in out['query']['pages']:
            ii = (p.get('imageinfo') or [None])[0]
            if not ii:
                continue
            md = ii.get('extmetadata', {})
            g = lambda k: (md.get(k) or {}).get('value', '')
            res[p['title']] = {
                'title': p['title'], 'pageid': p.get('pageid'), 'w': ii['width'], 'h': ii['height'], 'mime': ii.get('mime', ''),
                'thumb': ii.get('thumburl', ''), 'page': ii.get('descriptionurl', ''),
                'license': strip_html(g('LicenseShortName')), 'licenseUrl': strip_html(g('LicenseUrl')),
                'artist': strip_html(g('Artist')) or strip_html(g('Credit')),
                'name': strip_html(g('ObjectName')), 'restrictions': strip_html(g('Restrictions')),
            }
    return res


def license_ok(lic):
    return bool(lic) and bool(OK_LICENSE.search(lic)) and not BAD_LICENSE.search(lic)


def score_image(im):
    """Colorfulness (Hasler & Suesstrunk) plus contrast, plus a little for dark surroundings that glow in feedback."""
    from PIL import ImageStat
    small = im.convert('RGB').resize((96, 72))
    px = list(small.get_flattened_data()) if hasattr(small, 'get_flattened_data') else list(small.getdata())
    rg = [r - g for r, g, b in px]
    yb = [0.5 * (r + g) - b for r, g, b in px]

    def ms(v):
        m = sum(v) / len(v)
        return m, math.sqrt(sum((x - m) ** 2 for x in v) / len(v))
    mrg, srg = ms(rg)
    myb, syb = ms(yb)
    color = math.sqrt(srg ** 2 + syb ** 2) + 0.3 * math.sqrt(mrg ** 2 + myb ** 2)
    lum = small.convert('L')
    contrast = ImageStat.Stat(lum).stddev[0]
    w, h = lum.size
    edge = [lum.getpixel((x, y)) for x in range(w) for y in range(h) if x < 8 or y < 6 or x >= w - 8 or y >= h - 6]
    dark = sum(1 for v in edge if v < 50) / len(edge)
    return round(color + 0.5 * contrast + 25 * dark, 1), round(color, 1), round(contrast, 1), round(dark, 2)


GENERIC = {'flower', 'flowers', 'tree', 'trees', 'bird', 'plant', 'nature', 'forest', 'animal', 'fish', 'insect',
           'mushroom', 'fungus', 'leaf', 'leaves', 'water', 'sky', 'landscape', 'macro photography', 'close-up',
           'bokeh', 'wildlife', 'blossom', 'inflorescence', 'flower bud', 'petal', 'fruit', 'male', 'female',
           'juvenile', 'adult', 'feather', 'spider web', 'dew', 'snow', 'winter', 'autumn', 'spring', 'summer'}


def depicts(items):
    """Common names from each file's 'depicts' statement on Commons (and the label on Wikidata)."""
    ids = {}
    good = [d for d in items if d.get('pageid')]
    for i in range(0, len(good), 50):
        chunk = good[i:i + 50]
        out = api(action='wbgetentities', ids='|'.join(f"M{d['pageid']}" for d in chunk), props='claims')
        for d in chunk:
            ent = out.get('entities', {}).get(f"M{d['pageid']}", {})
            claims = ent.get('statements') or ent.get('claims') or {}
            qs = []
            for c in claims.get('P180', []):
                v = ((c.get('mainsnak') or {}).get('datavalue') or {}).get('value') or {}
                if v.get('id'):
                    qs.append(v['id'])
            ids[d['title']] = qs
    allq = sorted({q for qs in ids.values() for q in qs})
    labels = {}
    for i in range(0, len(allq), 50):
        url = 'https://www.wikidata.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'wbgetentities', 'ids': '|'.join(allq[i:i + 50]), 'props': 'labels', 'languages': 'en',
            'languagefallback': '1', 'format': 'json', 'formatversion': '2'})
        out = json.loads(http(url))
        for q, ent in out.get('entities', {}).items():
            lab = (ent.get('labels', {}).get('en') or {}).get('value')
            if lab:
                labels[q] = lab
    for d in items:
        names = [labels[q] for q in ids.get(d['title'], []) if q in labels]
        names = [n for n in names if n.lower() not in GENERIC] or names
        d['depicts'] = names[:3]


# ---------------------------------------------------------------- candidates
def find_cats(pattern, root='Category:Featured pictures by subject', depth=3):
    """Featured-picture categories anywhere under root whose names match pattern."""
    found, seen = [], set()
    rx = re.compile(pattern, re.I)

    def walk(cat, d):
        if cat in seen or d > depth:
            return
        seen.add(cat)
        for k in subcats(cat):
            if re.search(r' by country| in [A-Z]| in the |by Ermell', k):
                continue
            if rx.search(k):
                found.append(k)
            walk(k, d + 1)
    walk(root, 0)
    print(f'  found categories: {found}', flush=True)
    return found


def candidates(args):
    from PIL import Image, ImageDraw, ImageFont
    second = bool(args and args[0] == 'more')
    plan = json.load(open(os.path.join(SRC, 'plan2.json' if second else 'plan.json'), encoding='utf-8'))
    old = json.load(open(os.path.join(SRC, 'candidates.json'), encoding='utf-8')) if second else []
    seen_titles = {d['title'] for d in old}
    start_id = max([d['id'] for d in old] or [0])
    pool = {}
    for bucket in plan['buckets']:
        files = []
        seen_cats = set()
        if bucket.get('find'):
            bucket['cats'] = bucket.get('cats', []) + find_cats(bucket['find'])

        def walk(cat, depth):
            if cat in seen_cats or depth > bucket.get('depth', 2):
                return
            seen_cats.add(cat)
            files.extend(files_in(cat))
            for k in subcats(cat):
                if any(x.lower() in k.lower() for x in bucket.get('skip', [])):
                    continue
                walk(k, depth + 1)
        for c in bucket['cats']:
            walk(c, 0)
        files = [t for t in dict.fromkeys(files) if not BAD_TITLE.search(t)]
        print(f"{bucket['id']}: {len(files)} files in {len(seen_cats)} categories", flush=True)
        info = imageinfo(files, 330)
        keep = []
        for t, d in info.items():
            if t in pool or t in seen_titles:
                continue
            if not d['mime'].startswith('image/jpeg') and d['mime'] != 'image/png':
                continue
            if not license_ok(d['license']):
                continue
            if max(d['w'], d['h']) < 1600 or d['w'] < 1000:
                continue
            asp = d['w'] / d['h']
            if asp < 0.75 or asp > 2.4:
                continue
            keep.append(d)
        print(f"  {len(keep)} pass license/size/shape", flush=True)
        scored = []

        def fetch(d):
            try:
                im = Image.open(io.BytesIO(http(d['thumb'])))
                im.load()
            except Exception as e:
                print('  thumb failed', d['title'], e, flush=True)
                return None
            d['score'], d['color'], d['contrast'], d['dark'] = score_image(im)
            d['bucket'] = bucket['id']
            d['_im'] = im.convert('RGB')
            return d
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(4) as ex:
            for n, d in enumerate(ex.map(fetch, keep)):
                if d:
                    scored.append(d)
                if n % 200 == 199:
                    print(f'  scored {n + 1}', flush=True)
        scored.sort(key=lambda d: -d['score'])
        take = scored[:bucket['pool']]
        for d in take:
            pool[d['title']] = d
        print(f"  kept {len(take)} (score cut {take[-1]['score'] if take else '-'})", flush=True)

    try:
        depicts(list(pool.values()))
    except Exception as e:
        print('depicts lookup failed:', e, flush=True)

    # contact sheets: numbered tiles, 8 across, 6 down
    sheets = os.path.join(SRC, 'sheets')
    os.makedirs(sheets, exist_ok=True)
    prefix = 'more' if second else 'sheet'
    for f in os.listdir(sheets):
        if f.startswith(prefix):
            os.remove(os.path.join(sheets, f))
    items = list(pool.values())
    tw, th, cols, rows = 200, 150, 8, 6
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
    except Exception:
        font = ImageFont.load_default()
    cand = []
    for i, d in enumerate(items):
        d['id'] = start_id + i + 1
        cand.append({k: v for k, v in d.items() if k != '_im'})
    per = cols * rows
    for s in range(0, len(items), per):
        sheet = Image.new('RGB', (cols * tw, rows * th), (20, 20, 20))
        dr = ImageDraw.Draw(sheet)
        for j, d in enumerate(items[s:s + per]):
            im = d['_im'].convert('RGB')
            im.thumbnail((tw - 4, th - 4))
            x, y = (j % cols) * tw, (j // cols) * th
            sheet.paste(im, (x + (tw - im.width) // 2, y + (th - im.height) // 2))
            dr.rectangle([x + 2, y + 2, x + 52, y + 24], fill=(0, 0, 0))
            dr.text((x + 5, y + 3), str(d['id']), fill=(255, 255, 0), font=font)
        sheet.save(os.path.join(sheets, f'{prefix}-{s // per + 1:02d}.jpg'), quality=80)
    cand = old + cand
    with open(os.path.join(SRC, 'candidates.json'), 'w', encoding='utf-8') as f:
        json.dump(cand, f, indent=0, ensure_ascii=False)
    print(f'{len(cand)} candidates, {math.ceil(len(cand) / per)} sheets')


# ---------------------------------------------------------------- final
def nice_name(d):
    n = d.get('name') or ''
    if not n or len(n) > 60 or re.search(r'\.(jpe?g|png)$', n, re.I) or re.search(r'\d{4,}', n):
        n = re.sub(r'^File:', '', d['title'])
        n = re.sub(r'\.(jpe?g|png)$', '', n, flags=re.I)
        n = re.sub(r'[_]+', ' ', n)
        n = re.sub(r'\b(IMG|DSC|DSCN|P)\s?\d+\b', '', n)
        n = re.sub(r'\s*[-–(,]\s*\d{3,}.*$', '', n)
        n = re.sub(r'\s*\((cropped|edit|retouched)[^)]*\)', '', n, flags=re.I)
        n = re.sub(r'\s+', ' ', n).strip(' -–,')
    return n[:60]


def slug(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s[:40] or 'picture'


def final(args):
    from PIL import Image
    pick = json.load(open(os.path.join(SRC, 'pick.json'), encoding='utf-8'))
    buckets = {b['id']: b for b in json.load(open(os.path.join(SRC, 'plan.json'), encoding='utf-8'))['buckets']}
    titles = [p['title'] for p in pick]
    info = imageinfo(titles, 1280)
    os.makedirs(OUT, exist_ok=True)
    keep_files = set()
    pictures, credits = [], []
    used = set()
    for p in pick:
        d = info.get(p['title'])
        if not d:
            print('missing', p['title'], flush=True)
            continue
        name = p.get('label') or nice_name(d)
        base = slug(name)
        k = 2
        while base in used:
            base = f'{slug(name)}-{k}'
            k += 1
        used.add(base)
        big, small = f'{base}.jpg', f'{base}-t.jpg'
        keep_files.update([big, small])
        if not (os.path.exists(os.path.join(OUT, big)) and os.path.exists(os.path.join(OUT, small))):
            try:
                im = Image.open(io.BytesIO(http(d['thumb'])))
                im.load()
            except Exception as e:
                print('download failed', p['title'], e, flush=True)
                continue
            im = im.convert('RGB')
            im.thumbnail((1024, 1024), Image.LANCZOS)
            im.save(os.path.join(OUT, big), quality=80, optimize=True, progressive=True)
            t = im.copy()
            tw, th = 240, 180
            sc = max(tw / t.width, th / t.height)
            t = t.resize((max(tw, round(t.width * sc)), max(th, round(t.height * sc))), Image.LANCZOS)
            l, u = (t.width - tw) // 2, (t.height - th) // 2
            t.crop((l, u, l + tw, u + th)).save(os.path.join(OUT, small), quality=78, optimize=True)
            time.sleep(0.1)
        by = d['artist'] or 'Unknown'
        if len(by) > 80:
            by = by[:77] + '…'
        pictures.append({'n': name, 'c': p['bucket'], 'f': base, 'by': by, 'lic': d['license'], 'src': d['page']})
        credits.append(f"{base}.jpg — {name}\n  by {d['artist'] or 'Unknown'} — {d['license']}"
                       f"{' (' + d['licenseUrl'] + ')' if d['licenseUrl'] else ''}\n  {d['page']}")
    for f in os.listdir(OUT):
        if f.endswith('.jpg') and f not in keep_files:
            os.remove(os.path.join(OUT, f))
    cats = [{'id': b['id'], 'n': b['label']} for b in buckets.values() if any(p['c'] == b['id'] for p in pictures)]
    with open(os.path.join(OUT, 'pictures.json'), 'w', encoding='utf-8') as f:
        json.dump({'cats': cats, 'pics': pictures}, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'CREDITS.txt'), 'w', encoding='utf-8') as f:
        f.write('Nature pictures in Phosphor Loop\n\n'
                'Every photo comes from Wikimedia Commons (Featured Pictures) and is free to use under the license\n'
                'shown. They are resized copies of the originals; follow each link for the full picture and details.\n\n')
        f.write('\n\n'.join(credits) + '\n')
    print(f'{len(pictures)} pictures written')


if __name__ == '__main__':
    words = sys.argv[1:] or open(os.path.join(SRC, 'job.txt')).read().split()
    {'explore': explore, 'candidates': candidates, 'final': final}[words[0]](words[1:])
