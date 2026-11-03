"""Made-up music with known kicks, as the browser's sound analyser would hear it, for tests/hits.test.mjs.

  python3 tests/hits_music.py 60      (writes /tmp/phosphor-hits/frames60.bin and truth60.json)
"""
import os
import numpy as np, json, sys
SR = 48000; N = 2048
rng = np.random.default_rng(1)
def kick(n=int(0.25*SR)):
    t = np.arange(n)/SR; f = 50 + 90*np.exp(-t*25)
    return np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-t*9)
def snare(n=int(0.18*SR)):
    t = np.arange(n)/SR; return (rng.standard_normal(n)*0.6 + np.sin(2*np.pi*190*t)*0.5) * np.exp(-t*22)
def hat(n=int(0.05*SR)):
    t = np.arange(n)/SR; x = rng.standard_normal(n); x = np.diff(x, prepend=0); return x*np.exp(-t*80)*0.25
def add(y, s, at, g=1.0):
    i = int(at*SR); j = min(len(y), i+len(s)); y[i:j] += s[:j-i]*g
def song(dur, parts):
    y = np.zeros(int(dur*SR)); kicks = []
    t = np.arange(len(y))/SR
    for (a, b, bpm, pattern, gain) in parts:
        beat = 60/bpm; x = a
        step = 0
        while x < b - 0.05:
            if pattern == 'four':
                add(y, kick(), x, gain); kicks.append(x)
                if step % 2 == 1: add(y, snare(), x, 0.5*gain)
                add(y, hat(), x + beat/2, gain)
                x += beat
            elif pattern == 'syncop':   # kicks off the grid: 1, 2.5, 3.75, 4.5 ...
                for off in (0, 1.5, 2.75, 3.5):
                    if x + off*beat < b - 0.05: add(y, kick(), x + off*beat, gain); kicks.append(x + off*beat)
                for h in range(8): add(y, hat(), x + h*beat/2, gain*0.8)
                x += 4*beat
            step += 1
        # a sustained pad and a bass drone under it (no hits)
        seg = (t >= a) & (t < b)
        y[seg] += gain*0.12*(np.sin(2*np.pi*220*t[seg]) + np.sin(2*np.pi*277*t[seg]) + np.sin(2*np.pi*330*t[seg]))
        y[seg] += gain*0.10*np.sin(2*np.pi*55*t[seg])
    return y / max(1, np.abs(y).max()) * 0.9, kicks
y, kicks = song(36, [(0, 10, 128, 'four', 1.0), (10, 18, 96, 'four', 1.0), (18, 26, 110, 'syncop', 1.0), (26, 31, 128, 'four', 0.12)])
# 31-33: silence; 33-36: pad only
t = np.arange(len(y))/SR; seg = t >= 33
y[seg] = 0.15*(np.sin(2*np.pi*220*t[seg]) + np.sin(2*np.pi*330*t[seg]))
# The AnalyserNode: Blackman window over the last 2048 samples, magnitude smoothed (0.2) between frames, dB in
# -100..-30 mapped to 0..255, read once a frame at 60 frames a second
w = np.blackman(N); prev = np.zeros(N//2); frames = []
fps = float(sys.argv[1]) if len(sys.argv) > 1 else 60
for k in range(int(36*fps)):
    end = int((k+1)/fps*SR)
    x = y[max(0, end-N):end]
    if len(x) < N: x = np.pad(x, (N-len(x), 0))
    mag = np.abs(np.fft.rfft(x*w))[:N//2] / N
    sm = 0.2*prev + 0.8*mag; prev = sm
    db = 20*np.log10(np.maximum(sm, 1e-12))
    frames.append(np.clip(np.floor(255*(db+100)/70), 0, 255).astype(np.uint8))
os.makedirs('/tmp/phosphor-hits', exist_ok=True)
np.array(frames).tofile(f'/tmp/phosphor-hits/frames{int(fps)}.bin')
json.dump({'kicks': kicks, 'fps': fps, 'bins': N//2, 'hz': SR/N}, open(f'/tmp/phosphor-hits/truth{int(fps)}.json', 'w'))
print(len(frames), 'frames,', len(kicks), 'kicks')
