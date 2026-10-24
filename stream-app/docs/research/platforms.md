# Platform levers for fine detail: Kick and Twitch (researched 2026-10-19)

## 1. Kick

Confirmed:
- Kick runs on Amazon IVS. Community Note, 2023, matching the ingest domain to the IVS docs: https://birdwatcharchive.org/notes/1669790562793168902
- **IVS ingest accepts H.264 video and AAC-LC audio only.** Settings: Main profile, CBR, YUV420P, BT.709, 2 s IDR (no more than 5 s), "VBV not exceed the average bitrate". Audio is 96–320 kbps, 44.1/48 kHz, stereo. 1080p30/60 tops out at **8.5 Mbps**: "If you exceed the allowable input resolution or bitrate, the stream probably will disconnect immediately." https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/streaming-config.html
- STANDARD channel ladder for 1080p60 input: **video source passthrough** plus 720p60 at 3.4 Mbps, 480p30 at 1.4, 360p30 at 0.63 and 160p30 at 0.23 Mbps. Picking the top quality means the viewer gets our exact encode, re-encoded zero times. https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/channel-types.html
- IVS supports HEVC only through **multitrack** (enhanced RTMP plus `GetClientConfiguration`), on a channel set up with FRAGMENTED_MP4 and MultitrackInputConfiguration. That is a per-channel setting Kick would have to turn on. The page does not mention AV1. https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/multitrack-video-setup.html
- Third-party guides agree: H.264 only, about 8 Mbps, 1080p60, 2 s keyframes, CBR. One says outright "Kick does not accept HEVC or AV1". https://obs-versions.com/kick , https://meldstudio.co/docs/outputs/kick/ , https://support.restream.io/en/articles/7183157-stream-to-kick

Uncertain:
- I found no official Kick doc and no evidence that Kick has turned on IVS multitrack/HEVC. Treat Kick as H.264-only.
- Whether audio counts toward the 8.5 Mbps cap. Keep video plus audio at or under about 8.3 Mbps to be safe.
- What Kick's "Auto" picks. Extensions such as "Kick Quality Enforcer" exist because the player drops to lower renditions on its own. That suggests ABR often falls to the 720p60 rendition at 3.4 Mbps, which would wipe out fine detail. https://chromewebstore.google.com/detail/ebbnoanfkddbmlhmldlpjdjpfodkimco
- Kick's own quality labels ("Best/Better") don't match the IVS ladder exactly. Kick may use a custom ladder.

## 2. Twitch

Confirmed:
- 2K launched on 2026-06-17. **1440p HEVC is allowed up to 9 Mbps**, with 1080p AVC up to 7.5 Mbps. It requires **Enhanced Broadcasting** and is open to Partners and Affiliates. Server-side transcoding is added for Partners and many Affiliates. AV1 is not mentioned. https://blog.twitch.tv/en/2026/06/17/introducing-dual-format-and-2k-streaming-on-twitch/
- Setup: OBS 32+, NVIDIA RTX 20-series or newer (driver 550+) for 2K, eligibility shown in the Creator Dashboard. Upload needed: 9 Mbps with server transcode, 20 Mbps without. https://onestream.live/blog/twitch-dual-format-2k-streaming-setup/
- Enhanced Broadcasting is the IVS multitrack protocol. The client sends its GPU, OS and preferences, plus the stream key, to `GetClientConfiguration`. The server returns the exact tracks: codec, resolution, fps and bitrate. Any mismatch, unaligned IDRs, or missing per-IDR "broadcast performance metrics" SEI gets the stream **disconnected**. https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/multitrack-video-sw-integration.html
- Non-OBS clients do exist: Streamlabs Desktop 1.18.3+ and XSplit 4.5+. Ranges: 1.5–10.5 Mbps total, 1080p60 down to 480p, 2–5 renditions, top track 6 Mbps. https://streamlabs.com/content-hub/post/twitch-multiple-encodes-streamlabs-desktop

Uncertain:
- Whether Twitch accepts a third-party Enhanced Broadcasting client without vetting. The IVS guide lists no allowlist, but Twitch's endpoint may check the client's identity.
- Users in the 2025 beta saw `GetClientConfiguration` leave out HEVC and live ingest drop. https://obsproject.com/forum/threads/i-got-access-to-twitch-2k-open-beta-1440p-60fps-but-it-doesnt-work.186554/page-3
- Plain RTMP (no Enhanced Broadcasting) is H.264. The official guidance is 6 Mbps. 8.5 Mbps is a widely reported practical tolerance but unofficial. https://obsproject.com/forum/threads/twitch-8000-bitrate.143352/
- I found no evidence that Twitch accepts single-track HEVC over plain E-RTMP.
- Twitch help-center pages could not be fetched (JavaScript-only).

## 3. FFmpeg and NVENC

- FFmpeg 6.1+ muxes HEVC, AV1 and VP9 into enhanced FLV. https://help.aliyun.com/en/live/use-cases/enhanced-rtmp , https://lists.ffmpeg.org/pipermail/ffmpeg-cvslog/2023-July/138234.html
- The RTMP option `-rtmp_enhanced_codecs hvc1,av01` advertises the fourCC list in connect. https://ffmpeg.org/ffmpeg-protocols.html
- Multitrack FLV muxing (E-RTMP v2) landed in December 2024, so it is in FFmpeg 7.1/8.x. https://www.phoronix.com/news/FFmpeg-FLV-Improvements
- Example: `-c:v hevc_nvenc ... -f flv -rtmp_enhanced_codecs hvc1 rtmps://...`
- FFmpeg cannot do Twitch's `GetClientConfiguration` handshake or the required per-IDR metrics SEI. That needs our own code around it.
- NVENC generations (from NVIDIA's support matrix): HEVC encode from Maxwell gen-2 (GTX 950+), HEVC B-frames from Turing (RTX 20 / most GTX 16), AV1 encode only on Ada (RTX 40) and Blackwell (RTX 50). https://blogs.nvidia.com/blog/twitch-multiencode-av1-livestreaming , https://docs.nvidia.com/video-technologies/video-codec-sdk/12.1/nvenc-application-note/index.html

## 4. Detail per bit

- NVIDIA reports AV1 on NVENC about 40% more efficient than H.264. At 1080p60, AV1 reaches 42 dB PSNR at 7 Mbps where H.264 needs 11 Mbps. https://developer.nvidia.com/blog/improving-video-quality-and-performance-with-av1-and-nvidia-ada-lovelace-architecture
- HEVC is typically 20–35% better than H.264. This figure is general industry consensus, not measured on our content.
- On very high-entropy content, the percentage gain usually holds but cannot rescue a heavily starved encode.

## 5. Other platform-side levers

- Neither Kick (IVS STANDARD) nor plain Twitch accepts 1440p.
- At a fixed cap, 30 fps gives each frame about twice the bits of 60 fps.
- A 720p input still uses the 8.5 Mbps cap on IVS, which means more bits per pixel but a softer picture.
- Our 1 s VBV matches the IVS rule.

## Recommendation

**Kick:**
- H.264 high profile, CBR, about 8.0 Mbps video plus 160 kbps audio (total ≤ 8.3 Mbps), 2 s GOP.
- Offer 1080p30 as the "detail" mode, since it gets about twice the bits per frame of 60 fps.
- Tell Nick and his viewers to pick the top quality manually, not Auto. Auto can drop to the 3.4 Mbps 720p rendition, which destroys detail.
- HEVC/AV1 is not available on Kick.

**Twitch:**
- Short term: plain H.264 at 6–7.5 Mbps, with 1080p30 for detail. (8+ Mbps is unofficial and risky without transcoding.)
- Medium term: if Nick is an Affiliate or Partner, a 1440p HEVC 9 Mbps Enhanced Broadcasting stream is the single biggest gain.
- Getting there means implementing the IVS multitrack client: `GetClientConfiguration`, aligned IDRs and the metrics SEI. FFmpeg 7.1/8.x can mux the E-RTMP multitrack FLV, but the handshake and SEI need our own code.
- The simplest working path for that one feature is Nick running OBS for Twitch only. Ours would be the first custom client attempt, with real risk of disconnects or vetting.
