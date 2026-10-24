#!/usr/bin/env python3
"""Build a longer, edge-softened dancer matte from the supplied commercial."""
from pathlib import Path
import json
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'static/2003 Commercial： Original iPod [DjFgMyDtKSU].webm'
BPM = 104
# Full-body shots only; exclude black lead-in, close-ups, title cards and cut frames.
# Beat-aligned edits produce a 16-beat loop (9.230769 seconds at the source tempo).
SHOTS = [(0.40, 3), (2.80, 1), (4.70, 1), (6.40, 2),
         (9.67, 2), (13.70, 4), (3.10, 1), (1.08, 2)]
TOTAL_BEATS = sum(beats for _, beats in SHOTS)
# Decode before trimming: input-side AV1 seeking previously admitted two black lead-in frames.
expr = '255*(1-clip((max(r(X,Y),max(g(X,Y),b(X,Y)))-35)/30,0,1))'
matte = 'crop=464:344:88:8,scale=480:360,format=rgb24,geq=' + ':'.join(k + "='" + expr + "'" for k in ['r', 'g', 'b'])
# Close tiny compression holes, upscale with Lanczos, and soften only the edge (~1 source pixel).
# The mask is still opaque inside the body, with transparent space outside it.
matte += ',format=gray,dilation,erosion,scale=960:720:flags=lanczos,gblur=sigma=1.2,setsar=1,format=yuv420p'
filters = []
for i, (start, beats) in enumerate(SHOTS):
    filters.append(f'[0:v]trim=start={start}:end={start + beats * 60 / BPM},setpts=PTS-STARTPTS,{matte}[s{i}]')
filters.append(''.join(f'[s{i}]' for i in range(len(SHOTS))) + f'concat=n={len(SHOTS)}:v=1:a=0,fps=52,trim=duration={TOTAL_BEATS * 60 / BPM},setpts=PTS-STARTPTS[out]')
# 52 fps gives exactly 30 frames per source beat at 104 BPM; no fractional-frame loop tail.
with tempfile.TemporaryDirectory(prefix='phosphor-dancer-') as folder:
    output = Path(folder) / 'silhouette-mask-v2.mp4'
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(SOURCE),
                    '-filter_complex', ';'.join(filters), '-map', '[out]', '-an', '-c:v', 'libx264',
                    '-crf', '15', '-preset', 'medium', '-g', '52', '-bf', '0', '-movflags', '+faststart', str(output)], check=True)
    # Inspect every decoded mask frame, including both sides of every edit and the loop seam.
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(output), '-vf', 'scale=120:90',
                                   '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'])
    frame_size = 120 * 90
    coverage = [sum(value > 128 for value in raw[i:i + frame_size]) / frame_size for i in range(0, len(raw), frame_size)]
    if not coverage or min(coverage) < 0.015 or max(coverage) > 0.25:
        raise RuntimeError(f'Bad matte frames: coverage range {min(coverage):.3f}–{max(coverage):.3f}')
    (ROOT / 'static/silhouette-mask-v2.mp4').write_bytes(output.read_bytes())
    print(json.dumps({'beats': TOTAL_BEATS, 'seconds': TOTAL_BEATS * 60 / BPM, 'frames': len(coverage),
                      'minimum_body_coverage': min(coverage), 'maximum_body_coverage': max(coverage)}))
