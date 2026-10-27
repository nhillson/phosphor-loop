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
        // Music, not a phone call: no echo cancelling, noise removal or volume levelling (they make music sound
        // muffled and underwater), and both speakers at full quality
        const MUSIC = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000, sampleSize: 16 };
        const shared = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: MUSIC });
        shared.getVideoTracks().forEach((t) => t.stop());
        const track = shared.getAudioTracks()[0];
        if (track) {
          try { await track.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }); } catch (_) {}
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

  // For the sharpness test: hand over the next N drawn frames exactly as drawn (raw pixels, no compression).
  // It has to read each one right after Phosphor Loop draws it, before the browser shows it and clears it.
  // With recordBitrate, the page's own recorder (the first step of the stream) records the same frames too, so the
  // test can tell how much that step loses on this computer.
  function sample(n, opts = {}) {
    const hook = window.__phosphorCapture;
    const c = hook.canvas, g = c.getContext('webgl2');
    if (!g) throw new Error('no WebGL');
    const prev = hook.onFrame;
    let left = n, tail = 6, mr = null;
    S.sampleStop = () => { left = 0; tail = 0; hook.onFrame = prev; if (mr && mr.state !== 'inactive') mr.stop(); };
    if (opts.recordBitrate) {
      try {
        const video = c.captureStream(opts.fps).getVideoTracks()[0];
        const types = ['video/x-matroska;codecs=avc1', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/webm'];
        const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
        const parts = [];
        mr = new MediaRecorder(new MediaStream([video]), { mimeType, videoBitsPerSecond: opts.recordBitrate });
        mr.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
        mr.onstop = async () => {
          video.stop();
          try { window.phosphorStream.sampleRec(await new Blob(parts).arrayBuffer(), mimeType); } catch (_) {}
        };
        mr.start(200);
      } catch (e) { mr = null; }
    }
    hook.onFrame = (now) => {
      if (prev) { try { prev(now); } catch (_) {} }
      if (left <= 0) {
        // a few more frames for the recorder, then stop it
        if (mr && --tail <= 0) { hook.onFrame = prev; if (mr.state !== 'inactive') mr.stop(); }
        return;
      }
      const w = c.width, h = c.height;
      const fb = g.getParameter(g.READ_FRAMEBUFFER_BINDING), pb = g.getParameter(g.PIXEL_PACK_BUFFER_BINDING), al = g.getParameter(g.PACK_ALIGNMENT);
      g.bindFramebuffer(g.READ_FRAMEBUFFER, null); g.bindBuffer(g.PIXEL_PACK_BUFFER, null); g.pixelStorei(g.PACK_ALIGNMENT, 4);
      const px = new Uint8Array(w * h * 4);
      g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
      g.bindFramebuffer(g.READ_FRAMEBUFFER, fb); g.bindBuffer(g.PIXEL_PACK_BUFFER, pb); g.pixelStorei(g.PACK_ALIGNMENT, al);
      left--;
      if (left <= 0 && !mr) hook.onFrame = prev;
      window.phosphorStream.sample(w, h, px.buffer);
    };
    return { width: c.width, height: c.height };
  }

  // Recording a video file: a second recorder of its own, next to the stream's, so a recording never disturbs the
  // stream (or the other way round). Its pieces go to the app in order; recDone says the last one has gone.
  async function recStart(opts) {
    recStop();
    const hook = window.__phosphorCapture;
    if (!hook || !hook.canvas) throw new Error('Phosphor Loop is still starting');
    const audio = (await sound(true)).clone();
    const video = hook.canvas.captureStream(opts.fps).getVideoTracks()[0];
    const types = ['video/x-matroska;codecs=avc1,opus', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(new MediaStream([video, audio]), { mimeType, videoBitsPerSecond: opts.bitrate, audioBitsPerSecond: 320000 });
    let chain = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      chain = chain.then(() => e.data.arrayBuffer()).then((buf) => window.phosphorStream.recChunk(buf)).catch(() => {});
    };
    rec.onstop = () => { video.stop(); audio.stop(); chain.then(() => window.phosphorStream.recDone()); };
    rec.onerror = (e) => window.phosphorStream.problem('recording: ' + String((e && e.error && e.error.message) || 'recorder error'));
    rec.start(500);
    S.recFile = rec;
    return { mimeType, width: hook.canvas.width, height: hook.canvas.height, sound: !!S.loop, soundErr: S.loop ? '' : (S.soundErr || '') };
  }
  function recStop() {
    const rec = S.recFile;
    S.recFile = null;
    if (rec && rec.state !== 'inactive') { try { rec.stop(); return true; } catch (_) {} }
    return false;
  }

  window.phosphorStreamCapture = async (cmd, opts = {}) => {
    if (cmd === 'rec-start') return recStart(opts);
    if (cmd === 'rec-stop') return recStop();
    if (cmd === 'frames') return S.frames;
    if (cmd === 'ready') return !!(window.__phosphorCapture && window.__phosphorCapture.canvas);
    // Stream-friendly: calmer motion and gentler Autopilot while live (an older Phosphor Loop without it just says no)
    if (cmd === 'calm') { try { return !!window.__phosphorCapture.streamFriendly(!!opts.on) === !!opts.on; } catch (_) { return false; } }
    if (cmd === 'autopilot') { try { window.__phosphorCapture.autopilot(); return true; } catch (_) { return false; } }
    if (cmd === 'stop') { stop(); return true; }
    if (cmd === 'size') { const c = window.__phosphorCapture && window.__phosphorCapture.canvas; return c ? { width: c.width, height: c.height } : null; }
    if (cmd === 'sample') return sample(opts.frames || 150, opts);
    if (cmd === 'sample-stop') { if (S.sampleStop) S.sampleStop(); return true; }
    if (cmd !== 'start') return null;
    stop();
    const hook = window.__phosphorCapture;
    if (!hook || !hook.canvas) throw new Error('Phosphor Loop is still starting');
    const audio = await sound(opts.sound !== false);
    S.video = hook.canvas.captureStream(opts.fps).getVideoTracks()[0];
    const types = ['video/x-matroska;codecs=avc1,opus', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(new MediaStream([S.video, audio]), { mimeType, videoBitsPerSecond: opts.recordBitrate, audioBitsPerSecond: 320000 });
    const gen = opts.gen;
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      // keep the pieces in order
      S.chain = S.chain.then(() => e.data.arrayBuffer()).then((buf) => window.phosphorStream.chunk(gen, buf)).catch(() => {});
    };
    rec.onerror = (e) => window.phosphorStream.problem(String((e && e.error && e.error.message) || 'recorder error'));
    rec.start(200);
    S.rec = rec;
    let soundInfo = '';
    try {
      const t = S.loop && S.loop.getSettings();
      if (t) soundInfo = (t.channelCount || '?') + ' ch, ' + (t.sampleRate || '?') + ' Hz, echo ' + t.echoCancellation + ', noise ' + t.noiseSuppression + ', level ' + t.autoGainControl;
    } catch (_) {}
    return { mimeType, sound: !!S.loop, soundErr: S.loop ? '' : (S.soundErr || ''), soundInfo };
  };
})();`;
};
