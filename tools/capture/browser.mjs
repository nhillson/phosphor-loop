// Injected by the local runner, never loaded by the public workstation.
export async function startCapture(config) {
  const hook = window.__phosphorCapture;
  let audio, media, recorder;
  let pending = Promise.resolve(), queued = 0, sequence = 0, failure;
  const fail = error => {
    failure ||= String(error?.message || error);
    if (recorder?.state === 'recording') recorder.stop();
  };
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some(d => d.kind === 'audioinput' && d.label)) {
      const permission = await navigator.mediaDevices.getUserMedia({audio: true});
      permission.getTracks().forEach(track => track.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    const inputs = devices.filter(d => d.kind === 'audioinput' && !['default', 'communications'].includes(d.deviceId));
    const matches = inputs.filter(d => d.label === config.device || d.label.startsWith(config.device + ' ('));
    if (matches.length !== 1) throw new Error(`Audio input "${config.device}" unavailable or ambiguous. Available inputs: ${inputs.map(d => d.label).join(', ')}. Run npm run audio:setup first.`);
    const device = matches[0];
    audio = await navigator.mediaDevices.getUserMedia({video: false, audio: {
      deviceId: {exact: device.deviceId}, channelCount: {ideal: 2},
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    }});
    const track = audio.getAudioTracks()[0];
    hook.listen(audio);
    if (config.autopilot) hook.autopilot();
    // Wait for rendered frames before taking the canvas stream.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Copy while WebGL's drawing buffer still contains this frame. Its buffer is
    // discarded after compositing, so asynchronous capture can otherwise miss it.
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = hook.canvas.width; captureCanvas.height = hook.canvas.height;
    const ctx = captureCanvas.getContext('2d', {alpha:false});
    media = captureCanvas.captureStream(0);
    const videoTrack = media.getVideoTracks()[0];
    videoTrack.onended = () => fail('Canvas video capture ended.');
    let next = 0, frames = 0;
    hook.onFrame = now => {
      if (now < next - 1) return;
      next = Math.max(next + 1000 / config.fps, now);
      try {
        ctx.drawImage(hook.canvas,0,0);
        videoTrack.requestFrame();
        frames++;
      } catch(error) { fail(error); }
    };
    media.addTrack(track);
    const mimeType = 'video/webm;codecs=vp8,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error('Chrome cannot encode VP8/Opus WebM.');
    recorder = new MediaRecorder(media, {mimeType, videoBitsPerSecond: config.bitrate, audioBitsPerSecond: 192000});
    let stopped;
    const done = new Promise(resolve => { stopped = resolve; });
    recorder.onstop = stopped;
    recorder.onerror = event => fail(event.error || 'MediaRecorder failed');
    recorder.ondataavailable = event => {
      if (!event.data.size || failure) return;
      queued += event.data.size;
      if (queued > config.maxQueueBytes) { fail('Capture delivery fell behind (queue limit exceeded).'); return; }
      const seq = sequence++;
      pending = pending.then(async () => {
        if (failure) return;
        const response = await fetch(`/chunk/${seq}`, {
          method: 'POST', headers: {'X-Capture-Token': config.token}, body: event.data,
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`FFmpeg delivery failed (${response.status}).`);
      }).catch(fail).finally(() => { queued -= event.data.size; });
    };
    track.onended = () => fail('BlackHole audio input disconnected.');
    const started = performance.now();
    recorder.start(250);
    window.__captureSession = {
      status: () => {
        if (gl.isContextLost()) fail('The graphics context was lost. Restart with --renderer software to diagnose.');
        return {failure, queued, sequence, frames, state: recorder.state, visibility:document.visibilityState,
          tracks:media.getTracks().map(t => ({kind:t.kind,state:t.readyState,muted:t.muted,settings:t.getSettings()}))};
      },
      async stop() {
        if (recorder.state !== 'inactive') recorder.stop();
        await done;
        await pending;
        hook.onFrame = null;
        media.getTracks().forEach(t => t.stop());
        hook.stopSound();
        if (failure) throw new Error(failure);
        return {frames, seconds:(performance.now()-started)/1000};
      },
    };
    const gl = hook.canvas.getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {device: track.label, settings: track.getSettings(), width: hook.canvas.width, height: hook.canvas.height,
      renderer:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)};
  } catch (error) {
    hook.onFrame = null;
    media?.getTracks().forEach(t => t.stop());
    audio?.getTracks().forEach(t => t.stop());
    hook.stopSound();
    throw error;
  }
}
