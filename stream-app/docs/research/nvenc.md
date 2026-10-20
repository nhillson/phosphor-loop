# NVENC / x264 settings for maximum fine detail (Phosphor Stream)

Case: very high-entropy, constantly changing generative content, CBR 6-8 Mbps, 1080p30/60, FFmpeg h264_nvenc on Windows.

## Platform facts that limit the options
- **Kick = Amazon IVS: H.264 only**, CBR only, 1080p up to 8.5 Mbps, keyframe 2 s recommended (1 s ok, never >5 s), **VBV buffer must not exceed the average bitrate**, the stream "probably will disconnect immediately" if over the limit. IVS's own FFmpeg example uses `-x264opts nal-hrd=cbr:no-scenecut`. https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/streaming-config.html
- **Twitch**: single-track 1080p and below is AVC (H.264), now up to **7.5 Mbps for 1080p** (raised June 2026). HEVC is used only for 2K via Enhanced Broadcasting (a multitrack client feature, OBS 32+). https://blog.twitch.tv/en/2026/06/17/introducing-dual-format-and-2k-streaming-on-twitch/ , https://onestream.live/blog/twitch-dual-format-2k-streaming-setup/
- => **hevc_nvenc / av1_nvenc are not usable** for our single-track FFmpeg pushes to Kick or Twitch. Stay on h264_nvenc, High profile, 8-bit 4:2:0 (H.264 10-bit is Blackwell-only and is not decoded by most web players). https://developer.nvidia.com/blog/nvidia-video-codec-sdk-13-0-powered-by-nvidia-blackwell/
- Twitch can now take **7500k** instead of our 6000k: about 25% more bits, a free win.

## Recommendations, ranked by expected impact on fine detail
1. **More bits per pixel per frame (biggest lever).** At 7.5 Mbps, 1080p60 is about 0.060 bits/pixel, 1080p30 about 0.12, and 1664x936 at 30 fps about 0.16. NVIDIA's own streaming guide: "High motion content cannot be compressed as much... If you reduce the resolution... the resulting viewer quality is higher." https://www.nvidia.com/en-gb/geforce/news/broadcasting-guide/print/ OBS forum experts say the same for Twitch and Kick (https://obsproject.com/forum/threads/nvenc-streaming-preset-and-multipass-mode-what-settings-are-correct-for-streaming.163979/latest), though native resolution beats a non-integer rescale (https://obsproject.com/forum/threads/936p-vs-1080p.157676/). For feedback content, frames barely predict one another, so each frame costs close to a keyframe. That means **halving the frame rate roughly doubles the bits per frame**. This is my inference: for typical game footage it is closer to "not half" (TryHD, same thread). **Prefer 1080p30. If you want 60 fps, use 1280x720 or 1664x936 rendered natively by the page** (`renderHeight`), not scaled down by FFmpeg.
2. **Turn off temporal AQ, and turn spatial AQ off or low.** NVIDIA's SDK guide on spatial AQ: "extra bits are allocated to flat regions of the frame at the cost of the regions having high spatial detail" and it causes a "PSNR drop in most of the cases". On temporal AQ it says it "may result in high fluctuation of bits consumed per frame within a GOP" and that strict CBR is not recommended with it. https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvenc-video-encoder-api-prog-guide/index.html NVIDIA's FFmpeg guide adds "don't enable both spatial and temporal AQ together". https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/ StreamFX: strength "controls how aggressively it will drain bitrate from textured and complex areas". https://github.com/Vhonowslend/StreamFX-Public/wiki/Encoder-FFmpeg-NVENC **We currently run both at strength 8, the worst combination for us.** Temporal AQ also helps only static detail, and our content isn't static. Use `-spatial-aq 0 -temporal-aq 0`. If dark flat areas start blocking or banding, A/B test with `-spatial-aq 1 -aq-strength 3`.
3. **Stop scene-cut keyframes and keyframe pulsing.** With lookahead on, NVENC inserts adaptive I-frames at "scene cuts", and chaotic feedback looks like a scene cut all the time. In CBR with a 1 s buffer, every extra I-frame starves the frames around it, which shows as visible "breathing". Use `-no-scenecut 1`, a fixed GOP (`-g` = 2 s, `-forced-idr 1`) and lookahead for rate planning only. IVS's own example also disables scenecut. Don't use intra-refresh: the platforms need real IDR keyframes for segmenting. Don't use `-strict_gop` either: it forces a per-GOP bit target, which makes the pulsing worse. No authoritative "pulsing fix" doc exists; the general cause is too few bits and I-frame starvation (https://support.wowza.com/hc/en-us/articles/6219249271451-why-does-a-live-stream-playback-showing-video-pulsing-issue-).
4. **Preset p7 with multipass fullres** (fallback p6 / qres if the GPU drops frames). The SDK says fullres "generates better statistics for the second pass" and qres catches "larger motion vectors". Both are within-frame bit distribution, which matters most in CBR. NVIDIA's broadcast guide recommends Max Quality (2-pass). OBS experts call P5-P7 close, but "not lower than P4".
5. **B-frames: `-bf 3 -b_ref_mode middle`** (Turing+). NVIDIA's own HEVC live example uses bf 4 middle; OBS defaults to bf 2. Gains are small for chaotic motion but not negative. On Pascal use `-b_ref_mode disabled` (FFmpeg rejects modes the GPU can't do).
6. **Lookahead `-rc-lookahead 16`** (FFmpeg clips it to the available surfaces, with a warning). It improves rate-control accuracy. Leave `lookahead_level` unset: it is documented for HEVC (SDK 12.2) and AV1 (SDK 13.0), not H.264.
7. **`-cbr_padding 1`** to match OBS, which always enables filler in CBR. It doesn't change detail but keeps ingest steady. FFmpeg's default bufsize is 2x the bitrate, so **always set `-bufsize` equal to the bitrate** for IVS.

**Don't use / no gain:** `-tune uhq` (HEVC/AV1 only, Turing+; it forces 4-5 fixed B-frames and turns on **temporal filtering, a denoiser that would smooth our noise textures**). The same goes for `-tf_level 4` (H.264 temporal filter needs SDK 13 / new GPUs and `-bf 4`). Also skip `-zerolatency`, `-nonref_p`, `-weighted_pred` (needs bf 0), `-unidir_b` (low-latency tool), `-split_encode_mode` (HEVC/AV1 only, at heights of 2112 or more; it lowers quality), `-bluray-compat`, and `-highbitdepth` (H.264 10-bit is Blackwell-only, and players don't decode it).

**OBS NVENC defaults** (obs-nvenc, current master): p5, tune hq, multipass qres, CBR, bf 2, keyint 0 (auto), High, "psycho-visual" AQ on = spatial AQ strength 8 **plus** temporal AQ where supported, lookahead on if supported (depth 8), CBR filler on, vbv = bitrate. UHQ forces bf at least 4. https://raw.githubusercontent.com/obsproject/obs-studio/master/plugins/obs-nvenc/nvenc-properties.c , https://raw.githubusercontent.com/obsproject/obs-studio/master/plugins/obs-nvenc/nvenc.c

## Exact h264_nvenc arguments (Kick 1080p30 at 7.5 Mbps; Twitch the same with 7500k)
```
-c:v h264_nvenc -preset p7 -tune hq -profile:v high -level 4.2 -pix_fmt yuv420p
-rc cbr -b:v 7500k -maxrate 7500k -bufsize 7500k -cbr_padding 1
-multipass fullres -spatial-aq 0 -temporal-aq 0
-rc-lookahead 16 -no-scenecut 1
-bf 3 -b_ref_mode middle
-g 60 -keyint_min 60 -forced-idr 1
-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv
```
At 60 fps use `-g 120`. Keep the Kick total including audio at or below about 8.0 Mbps (the IVS cap is 8.5).

**GPU fallbacks**
- **Blackwell / Ada / Ampere / Turing (not TU117):** as above. If frames drop with 60 fps capture plus WebGL rendering, step down to `-multipass qres`, then `-preset p6`.
- **Turing TU117 (GTX 1650 non-Super) / Pascal (GTX 10xx):** older encoder, no B-frame refs. Use `-preset p6 -multipass qres -bf 2 -b_ref_mode disabled -rc-lookahead 8`, keep AQ off, and strongly prefer 1080p30 or 720p60. Presets p1-p7 need driver 456.71+ / SDK 10+, so any recent driver is fine.
- **Maxwell or older:** use x264.

## x264 backup (if the CPU can afford it)
```
-c:v libx264 -preset fast -tune grain -profile:v high -pix_fmt yuv420p
-b:v 7500k -maxrate 7500k -bufsize 7500k -g 60 -keyint_min 60
-x264-params nal-hrd=cbr:scenecut=0:force-cfr=1
```
`--tune grain` = aq-strength 0.5, no-dct-decimate, deadzone 6/6, deblock -2:-2, **ipratio 1.1 / pbratio 1.1** (which narrows the keyframe vs P-frame quality gap, so less pulsing), psy-rd :0.25, qcomp 0.8. That is designed to keep noise-like texture. https://manpages.org/x264 Use `-preset faster` or `veryfast` if the CPU can't keep 30 fps alongside the WebGL page.

## Non-encoder notes that also matter
- **Kick's player defaults to Auto.** Judge quality on "Source"; the transcoded renditions will always be soft.
- Our pipeline encodes twice: MediaRecorder H.264 at about 60 Mbps, then NVENC. Noise-like content at 60 Mbps may already lose some detail at the first step. Check the intermediate file once.
- Lowering the content's own entropy (bigger noise grain, fewer single-pixel speckles) at stream time would help more than any flag. Single-pixel noise can't survive 0.06-0.12 bits/pixel.
