// Injected by the local runner, never loaded by the public workstation.
export async function startCapture(config) {
  const hook = window.__phosphorCapture;
  let audio, media, recorder, recordingTrack;
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
    // The workstation owns/stops its analyzer track when the sound controls
    // change. Keep an independent clone alive for the continuous recording.
    recordingTrack = track.clone();
    hook.listen(audio);
    if (config.autopilot) hook.autopilot();
    if (config.captureCodec === 'h264') {
      const {Muxer, StreamTarget} = await import('/capture-muxer.js');
      let started = performance.now();
      let frames = 0, skipped = 0, next = 0, audioOrigin, audioOffset, bytePosition = 0;
      let active = true, lastKey = -Infinity;
      const deliver = data => {
        queued += data.byteLength;
        if (queued > config.maxQueueBytes) { fail('Capture delivery fell behind (queue limit exceeded).'); return; }
        const seq = sequence++;
        pending = pending.then(async () => {
          if (failure) return;
          const response = await fetch(`/chunk/${seq}`, {method:'POST',
            headers:{'X-Capture-Token':config.token}, body:data, signal:AbortSignal.timeout(15000)});
          if (!response.ok) throw new Error(`FFmpeg delivery failed (${response.status}).`);
        }).catch(fail).finally(() => { queued -= data.byteLength; });
      };
      const audioSettings = recordingTrack.getSettings();
      const sampleRate = audioSettings.sampleRate || 48000, channels = audioSettings.channelCount || 2;
      const muxer = new Muxer({
        target:new StreamTarget({chunked:true,chunkSize:262144,onData(data,position) {
          if (position !== bytePosition) { fail('Muxer attempted a nonsequential write.'); return; }
          bytePosition += data.byteLength; deliver(data);
        }}),
        video:{codec:'avc',width:config.width,height:config.height},
        audio:{codec:'aac',sampleRate,numberOfChannels:channels},
        fastStart:'fragmented',minFragmentDuration:1,firstTimestampBehavior:'offset',
      });
      const videoConfig = {codec:'avc1.64002a',width:config.width,height:config.height,
        bitrate:config.bitrate,framerate:config.fps,bitrateMode:'constant',
        latencyMode:config.encoderLatency || 'quality',hardwareAcceleration:'prefer-hardware',avc:{format:'avc'}};
      if (!(await VideoEncoder.isConfigSupported(videoConfig)).supported)
        throw new Error('Hardware H.264 configuration unsupported.');
      let warming = true, videoMetadata;
      const videoEncoder = new VideoEncoder({output:(chunk,meta) => {
        if (meta?.decoderConfig) videoMetadata=meta;
        if (warming) return;
        try { muxer.addVideoChunk(chunk,meta?.decoderConfig ? meta : videoMetadata); } catch(error) { fail(error); }
      },error:fail});
      videoEncoder.configure(videoConfig);
      // Initialize VideoToolbox before starting either timeline. Its first encode
      // can take over a second; counting that startup as dropped live frames
      // creates an avoidable gap at the beginning of every stream.
      const warmCanvas=document.createElement('canvas');
      warmCanvas.width=config.width; warmCanvas.height=config.height;
      const warmFrame=new VideoFrame(warmCanvas,{timestamp:0});
      videoEncoder.encode(warmFrame,{keyFrame:true}); warmFrame.close();
      await videoEncoder.flush(); warming=false; started=performance.now();
      const audioEncoder = new AudioEncoder({output:(chunk,meta) => {
        try { muxer.addAudioChunk(chunk,meta,chunk.timestamp-audioOrigin+audioOffset); } catch(error) { fail(error); }
      },error:fail});
      audioEncoder.configure({codec:'mp4a.40.2',sampleRate,numberOfChannels:channels,bitrate:192000});
      const reader = new MediaStreamTrackProcessor({track:recordingTrack}).readable.getReader();
      const audioDone = (async () => {
        try {
          while (active) {
            const {value,done} = await reader.read();
            if (done) break;
            if (audioOrigin === undefined) { audioOrigin=value.timestamp; audioOffset=Math.round((performance.now()-started)*1000); }
            if (audioEncoder.encodeQueueSize > 20) { value.close(); throw new Error('Audio encoder fell behind.'); }
            audioEncoder.encode(value); value.close();
          }
        } catch(error) { if (active) fail(error); }
      })();
      const encodeCanvas=document.createElement('canvas');
      encodeCanvas.width=config.width; encodeCanvas.height=config.height;
      const encodeContext=encodeCanvas.getContext('2d',{alpha:false});
      hook.onFrame = now => {
        if (!active || failure || (window.__phosphorCaptureConfig?.fps !== config.fps && now < next-1)) return;
        next = Math.max(next+1000/config.fps,now);
        if (videoEncoder.encodeQueueSize > 3) { skipped++; return; }
        const timestamp=Math.round((now-started)*1000);
        encodeContext.drawImage(hook.canvas,0,0);
        const frame=new VideoFrame(encodeCanvas,{timestamp:Math.max(0,timestamp),duration:Math.round(1e6/config.fps)});
        try {
          const keyFrame=now-lastKey>=2000;
          videoEncoder.encode(frame,{keyFrame});
          if (keyFrame) lastKey=now;
          frames++;
        } catch(error) { fail(error); }
        finally { frame.close(); }
      };
      const gl=hook.canvas.getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');
      window.__captureSession = {
        status:() => {
          if (gl.isContextLost()) fail('The graphics context was lost.');
          if (recordingTrack.readyState !== 'live') fail('The recording audio track stopped.');
          return {failure,queued,sequence,frames,skipped,state:active?'recording':'inactive',
            tracks:[{kind:'audio',state:recordingTrack.readyState,muted:recordingTrack.muted,settings:recordingTrack.getSettings()}]};
        },
        async stop() {
          active=false; hook.onFrame=null;
          await reader.cancel(); await audioDone;
          await videoEncoder.flush(); await audioEncoder.flush();
          muxer.finalize(); await pending;
          videoEncoder.close(); audioEncoder.close(); recordingTrack.stop(); hook.stopSound();
          if (failure) throw new Error(failure);
          return {frames,skipped,seconds:(performance.now()-started)/1000};
        },
      };
      return {device:track.label,settings:track.getSettings(),width:hook.canvas.width,height:hook.canvas.height,
        renderWidth:hook.renderSize.width,renderHeight:hook.renderSize.height,mimeType:`WebCodecs H.264 CBR/AAC (${config.encoderLatency || 'quality'} mode, hardware preferred)`,
        renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
    }
    // Wait for rendered frames before taking the canvas stream.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Copy while WebGL's drawing buffer still contains this frame. Its buffer is
    // discarded after compositing, so asynchronous capture can otherwise miss it.
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = hook.canvas.width; captureCanvas.height = hook.canvas.height;
    const ctx = captureCanvas.getContext('2d', {alpha:false});
    // Advertise the intended frame rate to the encoder as well as explicitly
    // requesting frames; a zero-rate track can make codecs choose a lower rate.
    media = captureCanvas.captureStream(config.fps);
    const videoTrack = media.getVideoTracks()[0];
    videoTrack.onended = () => fail('Canvas video capture ended.');
    let next = 0, frames = 0;
    hook.onFrame = now => {
      if (window.__phosphorCaptureConfig?.fps !== config.fps && now < next - 1) return;
      next = Math.max(next + 1000 / config.fps, now);
      try {
        ctx.drawImage(hook.canvas,0,0);
        videoTrack.requestFrame();
        frames++;
      } catch(error) { fail(error); }
    };
    media.addTrack(recordingTrack);
    const mimeType = config.captureCodec === 'h264' ? 'video/mp4;codecs=avc1.64002a,mp4a.40.2' : 'video/webm;codecs=vp8,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error(`Chrome cannot encode ${mimeType}. Try --capture-codec vp8.`);
    recorder = new MediaRecorder(media, {mimeType, videoBitsPerSecond: config.captureBitrate || config.bitrate,
      audioBitsPerSecond: 192000, videoKeyFrameIntervalDuration:1000});
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
    recordingTrack.onended = () => fail('BlackHole audio input disconnected.');
    const started = performance.now();
    recorder.start(250);
    window.__captureSession = {
      status: () => {
        if (gl.isContextLost()) fail('The graphics context was lost. Restart with --renderer software to diagnose.');
        if (recordingTrack.readyState !== 'live') fail('The recording audio track stopped.');
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
      renderWidth:hook.renderSize.width,renderHeight:hook.renderSize.height,mimeType,
      renderer:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)};
  } catch (error) {
    hook.onFrame = null;
    media?.getTracks().forEach(t => t.stop());
    audio?.getTracks().forEach(t => t.stop());
    recordingTrack?.stop();
    hook.stopSound();
    throw error;
  }
}
