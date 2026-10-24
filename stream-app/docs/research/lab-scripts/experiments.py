"""Run encoder experiments on a lossless source clip. Usage: experiments.py LOOK [variant names...]"""
import sys, subprocess, json, os, shlex
LAB = '/tmp/claude-0/research/lab'
look = sys.argv[1]; only = sys.argv[2:]
SRC = f'{LAB}/clips/{look}.mkv'
fps = int(subprocess.run(['ffprobe','-v','error','-select_streams','v','-show_entries','stream=r_frame_rate','-of','csv=p=0',SRC],capture_output=True,text=True).stdout.strip().split('/')[0])
G = 2 * fps
def x264(rate=7500, preset='medium', params='', tune='', vf='', extra=''):
    xp = f'nal-hrd=cbr:scenecut=0:force-cfr=1' + (':' + params if params else '')
    t = f'-tune {tune}' if tune else ''
    v = f'-vf {vf},format=yuv420p' if vf else '-pix_fmt yuv420p'
    return f'{v} -c:v libx264 -preset {preset} {t} -profile:v high -b:v {rate}k -maxrate {rate}k -bufsize {rate}k -g {G} -keyint_min {G} -x264-params {xp} {extra}'
CUR = 'aq-mode=2:aq-strength=1.6'     # stand-in for NVENC spatial+temporal AQ at strength 8
V = {
 'medium':            x264(),
 'medium_aq0':        x264(params='aq-mode=0'),
 'medium_aqheavy':    x264(params=CUR),
 'medium_aq2':        x264(params='aq-mode=2'),
 'medium_aq3':        x264(params='aq-mode=3'),
 'medium_grain':      x264(tune='grain'),
 'medium_film':       x264(tune='film'),
 'veryfast':          x264(preset='veryfast'),
 'faster':            x264(preset='faster'),
 'slow':              x264(preset='slow'),
 'medium_deblk-1':    x264(params='deblock=-1,-1'),
 'medium_nodeblk':    x264(params='no-deblock=1'),
 'medium_psy0':       x264(params='psy-rd=0,0'),
 'medium_psy2':       x264(params='psy-rd=2.0,0'),
 'medium_aq0_psy0':   x264(params='aq-mode=0:psy-rd=0,0'),
 'pre_hqdn3d':        x264(vf='hqdn3d=1:1:3:3'),
 'pre_hqdn3d_t':      x264(vf='hqdn3d=0:0:4:4'),
 'pre_cas03':         x264(vf='cas=0.3'),
 'pre_unsharp':       x264(vf='unsharp=5:5:0.4:3:3:0'),
 'down900':           x264(vf='scale=1600:900:flags=lanczos'),
 'down720':           x264(vf='scale=1280:720:flags=lanczos'),
 'twitch6000':        x264(rate=6000),
 'twitch6000_aq0':    x264(rate=6000, params='aq-mode=0'),
 'x265_7500':         f'-pix_fmt yuv420p -c:v libx265 -preset medium -b:v 7500k -x265-params vbv-maxrate=7500:vbv-bufsize=7500:keyint={G}:min-keyint={G}:scenecut=0:log-level=error',
 'x265_6000':         f'-pix_fmt yuv420p -c:v libx265 -preset medium -b:v 6000k -x265-params vbv-maxrate=6000:vbv-bufsize=6000:keyint={G}:min-keyint={G}:scenecut=0:log-level=error',
 'av1_7500':          f'-pix_fmt yuv420p -c:v libsvtav1 -preset 8 -b:v 7500k -g {G} -svtav1-params rc=1:mbr=8000',
 'av1_6000':          f'-pix_fmt yuv420p -c:v libsvtav1 -preset 8 -b:v 6000k -g {G} -svtav1-params rc=1:mbr=6400',
 'best_slow_aq0_psy0': x264(preset='slow', params='aq-mode=0:psy-rd=0,0'),
 'best_aq0_psy0_900':  x264(params='aq-mode=0:psy-rd=0,0', vf='scale=1600:900:flags=lanczos'),
 'twitch7500_aq0_psy0': x264(params='aq-mode=0:psy-rd=0,0'),
 'twitch6000_aq0_psy0': x264(rate=6000, params='aq-mode=0:psy-rd=0,0'),
 'h264_60M_lossless_ref': x264(rate=60000, preset='veryfast'),
}
# double encode: first stage = MediaRecorder stand-in (60 Mbps), then the stream encode
DOUBLE = {'double_aq0_psy0': 'aq-mode=0:psy-rd=0,0', 'double_aqheavy': CUR, 'double_medium': '', 'double_aq0': 'aq-mode=0', 'double_grain': None}
def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode: print(r.stderr[-1500:], file=sys.stderr); raise SystemExit(cmd)
def kbps(f):
    sz = os.path.getsize(f); d = float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f],capture_output=True,text=True).stdout)
    return round(sz * 8 / d / 1000)
res = {}
rf = f'{LAB}/results_{look}.json'
if os.path.exists(rf): res = json.load(open(rf))
names = only or list(V) + list(DOUBLE)
os.makedirs(f'{LAB}/enc/{look}', exist_ok=True)
stage1 = f'{LAB}/enc/{look}/stage1_60M.mkv'
for n in names:
    out = f'{LAB}/enc/{look}/{n}.mkv'
    if n.startswith('as60_'):
        p = {'as60_medium': '', 'as60_aq0_psy0': 'aq-mode=0:psy-rd=0,0'}[n]
        G0 = G; G = 120
        run(f'ffmpeg -y -v error -itsscale 0.5 -i {SRC} ' + x264(params=p) + f' -an {out}'); G = G0
    elif n in V:
        run(f'ffmpeg -y -v error -i {SRC} {V[n]} -an {out}')
    else:
        if not os.path.exists(stage1):
            run(f'ffmpeg -y -v error -i {SRC} -pix_fmt yuv420p -c:v libx264 -preset veryfast -b:v 60000k -maxrate 60000k -bufsize 60000k -g {G} {stage1}')
        p = DOUBLE[n]
        run(f'ffmpeg -y -v error -i {stage1} ' + (x264(tune='grain') if p is None else x264(params=p)) + f' -an {out}')
    m = json.loads(subprocess.run(['python3', f'{LAB}/metrics.py', SRC, out], capture_output=True, text=True).stdout)
    m['kbps'] = kbps(out); res[n] = m
    print(n, m, flush=True)
    json.dump(res, open(rf, 'w'), indent=1)
