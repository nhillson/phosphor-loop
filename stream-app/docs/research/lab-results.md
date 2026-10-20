# Phosphor Stream encoder lab: measured on real Phosphor Loop footage

## Footage (real app frames, 1920x1080, renderHeight 1080)
Captured with Playwright/Chromium (software GL) from the local site in capture mode. A **virtual clock** advances
`performance.now()` by exactly 1/fps per drawn frame, so the motion per frame is what a real 30/60 fps run produces.
Each frame was read with `gl.readPixels` right after `onFrame`. All waits were by drawn frames.
Clips are FFV1 4:4:4 BT.709 lossless, in `clips/`. Sample frames are in `samples/`.

| Clip | Recipe | Frames | Character |
|---|---|---|---|
| living30 | Living picture (test card + Grow 45) | 60 @30 (2 s) | **Hardest**: dense 2–4 px Turing stripes everywhere, mean abs frame diff 21.8/255 |
| fractal30 / fractal60 | Fractal garden | 60 @30 / 120 @60 (2 s) | fine lace on a black background, slow motion (frame diff 3.4) |
| mandala30 | Twin mandala | 59 @30 | soft glow, smooth gradients (frame diff 3.1) |
| livingstable30 | Living picture with the Grow noise seed frozen (shader patch) | 60 @30 | stream-friendly test |

## Method
libx264 is used as a **stand-in for NVENC** (the ranking of the settings carries over in direction, but the absolute numbers will not).
Every encode is 1080p30 CBR 7.5 Mbps, `bufsize = bitrate`, GOP 2 s, no scenecut, `nal-hrd=cbr`, preset medium, unless the name says otherwise.
"current-style" stands in for NVENC spatial+temporal AQ at strength 8 as x264 `aq-mode=2:aq-strength=1.6`.
"double_*" = a first stage at x264 60 Mbps (standing in for MediaRecorder), then the 7.5 Mbps encode, which is the real pipeline.
Metrics are on luma against the lossless source. Fine detail is measured on high-pass(Y) = Y − gauss(σ1.5).
- **detail corr** = correlation of output vs source high-pass (1 = all fine detail kept).
- **detail SNR dB** = 10·log10(E[hp_src²]/E[(hp_out−hp_src)²]). This is the main fine-detail score: **+1 dB is clearly visible on the stripes**.
- SSIM/PSNR Y come from ffmpeg. VMAF is not available in this ffmpeg build.

## Results (detail SNR in bold = main score)
| Variant | living30 SSIM | living30 PSNR | living30 detail corr | living30 detail SNR dB | living kbps | fractal30 detail SNR | mandala30 detail SNR |
|---|---|---|---|---|---|---|---|
| medium | 0.9754 | 33.52 | 0.9451 | **9.69** | 7540 | 11.39 | 8.85 |
| medium_aq0 | 0.9667 | 34.04 | 0.9529 | **10.34** | 7524 | 11.95 | 9.13 |
| medium_aqheavy | 0.9774 | 31.5 | 0.9179 | **7.99** | 7511 | 11.33 | 8.69 |
| medium_aq2 | 0.9772 | 32.96 | 0.9381 | **9.19** | 7531 |  |  |
| medium_aq3 | 0.9773 | 32.75 | 0.9354 | **9.0** | 7525 |  |  |
| medium_grain | 0.9694 | 33.18 | 0.9393 | **9.26** | 7538 | 10.94 | 8.45 |
| medium_film | 0.9746 | 33.24 | 0.9417 | **9.43** | 7546 |  |  |
| veryfast | 0.9697 | 32.79 | 0.9435 | **9.58** | 7589 | 10.84 |  |
| faster | 0.9753 | 33.49 | 0.9456 | **9.74** | 7546 |  |  |
| slow | 0.9761 | 33.76 | 0.9479 | **9.91** | 7505 | 11.58 |  |
| medium_deblk-1 | 0.9754 | 33.46 | 0.944 | **9.61** | 7544 |  |  |
| medium_nodeblk | 0.9714 | 33.06 | 0.9377 | **9.14** | 7542 |  |  |
| medium_psy0 | 0.9771 | 34.01 | 0.9502 | **10.11** | 7460 | 11.93 |  |
| medium_psy2 | 0.9745 | 33.27 | 0.9424 | **9.49** | 7535 |  |  |
| medium_aq0_psy0 | 0.9684 | 34.55 | 0.9575 | **10.79** | 7488 | 12.48 | 9.22 |
| pre_hqdn3d | 0.9748 | 33.52 | 0.9461 | **9.78** | 7533 |  |  |
| pre_hqdn3d_t | 0.9715 | 33.54 | 0.9466 | **9.82** | 7591 |  |  |
| pre_cas03 | 0.9755 | 33.47 | 0.9457 | **9.66** | 7488 |  |  |
| pre_unsharp | 0.9756 | 33.14 | 0.951 | **9.68** | 7440 |  |  |
| down900 | 0.9768 | 33.9 | 0.9514 | **10.23** | 7424 | 8.75 | 7.81 |
| down720 | 0.9764 | 33.68 | 0.9492 | **10.04** | 7563 |  |  |
| twitch6000 | 0.9674 | 32.05 | 0.9277 | **8.53** | 6027 | 9.91 |  |
| twitch6000_aq0 | 0.9569 | 32.58 | 0.9378 | **9.16** | 6033 |  |  |
| x265_7500 | 0.985 | 36.6 | 0.9736 | **12.83** | 7683 | 13.72 | 10.12 |
| x265_6000 | 0.9806 | 35.18 | 0.9652 | **11.64** | 6129 |  |  |
| av1_7500 | 0.9831 | 36.98 | 0.9791 | **13.83** | 6369 | 15.03 | 10.17 |
| av1_6000 | 0.9795 | 35.79 | 0.9733 | **12.77** | 5170 |  |  |
| best_slow_aq0_psy0 | 0.9679 | 34.78 | 0.9602 | **11.07** | 7424 |  |  |
| best_aq0_psy0_900 | 0.9705 | 34.88 | 0.9621 | **11.29** | 7356 |  |  |
| twitch6000_aq0_psy0 | 0.959 | 33.06 | 0.9436 | **9.58** | 5998 | 10.99 |  |
| double_aqheavy | 0.9769 | 31.5 | 0.9184 | **8.03** | 7526 | 11.27 | 8.57 |
| double_medium | 0.9753 | 33.49 | 0.9452 | **9.71** | 7526 |  |  |
| double_aq0 | 0.9671 | 34.02 | 0.953 | **10.36** | 7521 |  |  |
| double_aq0_psy0 | 0.9686 | 34.48 | 0.9575 | **10.79** | 7468 | 12.4 | 9.09 |
| double_grain | 0.9697 | 33.21 | 0.9403 | **9.34** | 7539 | 10.92 |  |
(The fractal30 and mandala30 columns were run only for the key variants. Bitrates under 7.5 Mbps on fractal and mandala are x264 CBR without filler; a 2 s clip leaves some VBV slack.)

### 30 vs 60 fps (same 7.5 Mbps)
| | 30 fps detail SNR | 60 fps detail SNR |
|---|---|---|
| fractal (real 60 fps capture) medium / aq0 | 11.39 / 11.95 | 10.21 / 10.86 (**−1.1 dB**) |
| living, 60 fps proxy (same frames played at 60, the worst case) medium / aq0+psy0 / current-style | 9.69 / 10.79 / 8.03 | 6.48 / 7.41 / 5.29 (**−3.2 dB**) |
On dense content the real 60 fps cost is somewhere between −1.1 and −3.2 dB.

### 4:2:0 chroma (no compression, just 4:4:4 → 4:2:0 → RGB)
| clip | RGB PSNR of the round trip | colour-difference fine detail kept |
|---|---|---|
| living30 | 30.9 dB | 0.78 |
| fractal30 | 39.7 dB | 0.61 |
| mandala30 | 44.8 dB | 0.36 (very little fine colour detail to begin with) |
On living, 4:2:0 alone loses more RGB fidelity than the whole 7.5 Mbps encode loses in luma (33.5 dB). The platforms require 4:2:0, so the only lever is in the content: put fine detail in brightness and make colour change on a coarser scale.

### Temporal / noise analysis (section 3)
| clip | mean abs frame diff (0-255) | high-pass share of frame diff | spatial HP rms | x264 CRF 23 bitrate |
|---|---|---|---|---|
| living30 | 21.8 | 0.121 | 14.6 | 13.0 Mbps |
| livingstable30 (Grow noise seed frozen) | 20.9 | 0.120 | 14.5 | **11.8 Mbps (−9%)** |
| fractal30 | 3.4 | 0.126 | 6.5 | |
| mandala30 | 3.1 | 0.019 | 1.7 | |
At 7.5 Mbps CBR, livingstable30 gives detail SNR 10.21 / 11.17 / 8.41 (medium / aq0+psy0 / current-style) against 9.69 / 10.79 / 8.03 for living30, a gain of about **+0.4–0.5 dB**.
The two runs differ only in that patch, but `uGrowTurn` comes from `Math.random()`, so the frames are not identical: treat this as indicative.
The dense look needs about 13 Mbps for CRF-23 quality, so at 7.5 Mbps it runs at roughly CRF 27–28. Its bits go to genuine whole-frame change (zoom, spin and growth), not to dither.

Per-frame random sources in `js/shaders.js` / `js/app.js`:
1. Grow: `uGrowTurn = Math.random()*2π` every frame (app.js:7340). This turns the ring sampling a random way **and** reseeds the "whisper of noise" hash (shaders.js:257) each frame. The noise is then amplified by `tanh(x*12)` inside the loop.
2. Aurora: `dither = h31(vec3(gl_FragCoord.xy, fract(t)*13.0))` (shaders.js:1195) is new white-noise dither every frame. Nebula already uses a fixed seed (`3.0`, line 1469), which is the right pattern.
3. VCR/Chewed tape: tracking jitter and noise use `floor(t*60)` (lines 378–386), so they are new every frame even at 30 fps.
4. Static after Clear / display (`uStatic`, lines 590/599) is white noise every frame. It is brief, but each Clear or Surprise costs a burst of bits.
5. Sparks reseed per time bucket. That is content and fine.
Proposed "stream-friendly" mode (capture mode only, `__phosphorCaptureConfig.streamFriendly`): (a) seed the Grow noise from `floor(frame/8)` or a fixed value, and change `uGrowTurn` by a slow golden-angle step instead of a random jump; (b) use a fixed screen-space dither (blue noise or `h31(gl_FragCoord, const)`) for Aurora, the same as Nebula; (c) quantise the VCR/static noise time to 15 Hz and make its grain 2 px; (d) shorten or soften the Clear static when streaming; (e) optionally lower the default Grow fineness (growSize) one step when streaming. Expected gain: 5–10% fewer bits at equal quality on the noise-driven looks, and none on the others.

## Winners (fine detail, at 7.5 Mbps)
1. **AQ off is the single biggest encoder setting.** On the dense look: current-style heavy AQ 8.0 dB → x264 default AQ 9.7 → **AQ off 10.3 → AQ off + psy-rd 0 10.8 dB** (+2.8 dB over current-style). It also helps on fractal (+1.1) and mandala (+0.5). SSIM slightly prefers AQ, because AQ protects flat areas; the fine-detail scores all say AQ off. The NVENC translation is `-spatial-aq 0 -temporal-aq 0`.
2. **tune grain does not help this content:** 9.26 against 9.69 for medium on living, and worse on fractal and mandala. Its deadzone and psy settings spend bits on noise-like texture, which inflates high-pass energy (1.03×) without matching the source.
3. psy-rd 0 > 1 > 2. Deblock: default ≈ −1,−1 > off. Preset: slow +0.2, veryfast −0.1 to −0.5 dB, so the preset matters little next to AQ.
4. Pre-filters: hqdn3d +0.1 dB (insignificant). cas/unsharp raise the energy but not the accuracy (≈0). **Don't sharpen and don't denoise.**
5. Resolution: 1600x900 helps the dense look (+0.5 dB; aq0+psy0 at 900p reaches 11.29 against 10.79) but **hurts the sparse looks badly** (fractal −2.6, mandala −1.0). Keep 1080p for general use. Treat 900p as an option only for wall-to-wall-texture looks.
6. 30 fps beats 60 fps by 1.1–3.2 dB at the same bitrate.
7. Double encode (60 Mbps first stage): ≤0.05 dB penalty with x264 at 60 Mbps, so it is negligible. MediaRecorder's real encoder may be worse; this was not tested.
8. Codecs (reference only, since Kick and Twitch single-track need H.264): HEVC +3.1 dB, AV1 (SVT preset 8) +4.1 dB over x264 medium on living. AV1 at 6 Mbps beats H.264 at 7.5 Mbps.
9. Twitch 6000k: −1.2 dB against 7500k. With AQ off + psy0 at 6000k (9.58) it about matches default settings at 7500k (9.69).

**Best H.264 found:** `-preset slow -x264-params aq-mode=0:psy-rd=0,0` → 11.07 dB on living (current-style 8.03). For NVENC: `-spatial-aq 0 -temporal-aq 0`, 1080p30, no sharpening or denoise, and 7.5 Mbps on Twitch too.

## Images
- `crop_living_stripes.png`: source / current-style (heavy AQ) / tune grain / AQ off + psy-rd 0, frame 40, 2x zoom.
- `crop_living_center.png`: source / current-style / best H.264 / AV1 reference.
- `crop_fractal.png`: source / current-style / tune grain / best H.264.

## Caveats
- x264 stands in for NVENC. NVENC's AQ is implemented differently and its psy settings don't exist (closest: `-tune hq`, no psy-rd control). Confirm the AQ-off win on the stream PC with a real NVENC A/B.
- The clips are short (2 s = one GOP). Rate control warm-up and VBV slack affect the absolute numbers but not the ranking.
- The 60 fps proxy for the dense look overstates the penalty, so the real value lies between the two measurements.
- Software-rendered capture is the same picture as on the GPU, just slower. Thanks to the virtual clock, the motion per frame is real.
- There is no VMAF. Detail SNR and correlation are custom metrics. Look at the crops.
