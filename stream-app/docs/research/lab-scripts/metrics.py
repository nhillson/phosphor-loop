"""Fine-detail metrics: compare decoded test video vs lossless source (both 1920x1080), Y plane.
Usage: metrics.py src.mkv test.mkv [step]  -> json: psnr_y, ssim_y (from ffmpeg), hp_corr, hp_energy_ratio, hp_snr_db"""
import sys, subprocess, json, re, numpy as np
from scipy.ndimage import gaussian_filter
src, tst = sys.argv[1], sys.argv[2]; step = int(sys.argv[3]) if len(sys.argv) > 3 else 4
W, H = 1920, 1080
def ffm():
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', tst, '-i', src, '-lavfi',
        '[0:v]scale=1920:1080:flags=bicubic,format=yuv420p,setpts=N/(30*TB)[a];[1:v]format=yuv420p,setpts=N/(30*TB)[b];[a]split[a1][a2];[b]split[b1][b2];[a1][b1]ssim;[a2][b2]psnr',
        '-f', 'null', '-'], capture_output=True, text=True)
    s = float(re.search(r'SSIM Y:([\d.]+)', r.stderr).group(1)); p = float(re.search(r'PSNR y:([\d.inf]+)', r.stderr).group(1))
    return s, p
def ys(f):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-vf', f"select='not(mod(n\\,{step}))',scale=1920:1080:flags=bicubic,format=gray", '-fps_mode', 'passthrough',
                        '-f', 'rawvideo', '-'], capture_output=True).stdout
    return np.frombuffer(p, np.uint8).reshape(-1, H, W).astype(np.float32)
s, p = ffm()
A, B = ys(src), ys(tst); n = min(len(A), len(B))
num = den_s = den_t = err = 0.0
for i in range(n):
    hs = A[i] - gaussian_filter(A[i], 1.5); ht = B[i] - gaussian_filter(B[i], 1.5)
    num += float((hs * ht).sum()); den_s += float((hs * hs).sum()); den_t += float((ht * ht).sum()); err += float(((hs - ht) ** 2).sum())
print(json.dumps({'ssim_y': round(s, 4), 'psnr_y': round(p, 2), 'hp_corr': round(num / np.sqrt(den_s * den_t), 4),
                  'hp_energy': round(den_t / den_s, 3), 'hp_snr_db': round(10 * np.log10(den_s / err), 2)}))
