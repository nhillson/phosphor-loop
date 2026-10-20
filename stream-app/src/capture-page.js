'use strict';
// Runs inside the Phosphor Loop page (its own world, next to the site's code). It records the finished picture
// straight from Phosphor Loop's canvas, plus the computer's sound, and hands the recording to the app in small
// pieces. The site's built-in capture hook (window.__phosphorCapture) gives us the canvas and lets Phosphor Loop
// react to the same sound. Nothing here changes how the site looks or behaves.
module.exports = function capturePageSource() {
  return `(() => {
  if (window.phosphorStreamCapture) return;
  const S = { frames: 0, chain: Promise.resolve(), rec: null, video: null };
  const count = () => { S.frames++; requestAnimationFrame(count); };
  requestAnimationFrame(count);

  async function sound(wanted) {
    if (!S.ctx) {
      S.ctx = new AudioContext({ sampleRate: 48000 });
      S.dest = S.ctx.createMediaStreamDestination();
      // A silent source keeps the sound track running even when nothing is playing (platforms like a steady track)
      const quiet = S.ctx.createConstantSource(); quiet.offset.value = 0; quiet.connect(S.dest); quiet.start();
    }
    if (wanted && !S.loop) {
      try {
        const shared = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        shared.getVideoTracks().forEach((t) => t.stop());
        const track = shared.getAudioTracks()[0];
        if (track) {
          S.loop = track;
          S.ctx.createMediaStreamSource(new MediaStream([track])).connect(S.dest);
          try { window.__phosphorCapture.listen(new MediaStream([track.clone()])); } catch (_) {}
          track.addEventListener('ended', () => { S.loop = null; });
        } else S.soundErr = 'no sound track';
      } catch (e) { S.soundErr = String(e && e.message || e); }
    }
    if (S.ctx.state !== 'running') { try { await S.ctx.resume(); } catch (_) {} }
    return S.dest.stream.getAudioTracks()[0];
  }

  function stop() {
    if (S.rec && S.rec.state !== 'inactive') { try { S.rec.stop(); } catch (_) {} }
    if (S.video) S.video.stop();
    S.rec = null; S.video = null;
  }

  window.phosphorStreamCapture = async (cmd, opts = {}) => {
    if (cmd === 'frames') return S.frames;
    if (cmd === 'ready') return !!(window.__phosphorCapture && window.__phosphorCapture.canvas);
    if (cmd === 'autopilot') { try { window.__phosphorCapture.autopilot(); return true; } catch (_) { return false; } }
    if (cmd === 'stop') { stop(); return true; }
    if (cmd !== 'start') return null;
    stop();
    const hook = window.__phosphorCapture;
    if (!hook || !hook.canvas) throw new Error('Phosphor Loop is still starting');
    const audio = await sound(opts.sound !== false);
    S.video = hook.canvas.captureStream(opts.fps).getVideoTracks()[0];
    const types = ['video/x-matroska;codecs=avc1,opus', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(new MediaStream([S.video, audio]), { mimeType, videoBitsPerSecond: opts.recordBitrate, audioBitsPerSecond: 192000 });
    const gen = opts.gen;
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      // keep the pieces in order
      S.chain = S.chain.then(() => e.data.arrayBuffer()).then((buf) => window.phosphorStream.chunk(gen, buf)).catch(() => {});
    };
    rec.onerror = (e) => window.phosphorStream.problem(String((e && e.error && e.error.message) || 'recorder error'));
    rec.start(200);
    S.rec = rec;
    return { mimeType, sound: !!S.loop, soundErr: S.loop ? '' : (S.soundErr || '') };
  };
})();`;
};
