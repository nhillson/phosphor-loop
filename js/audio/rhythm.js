/* Shared-stream analysis, isolated from the graphics loop. */
(() => {
  class Rhythm {
    constructor(ctx, source) {
      this.ctx = ctx; this.source = source; this.closed = false;
      this.features = null; this.tempo = null; this.pending = 0; this.gap = false;
      this.clock = new window.PhosphorBeatClock();
      this.state = 'Finding tempo'; this.cost = 0; this.error = '';
    }
    async start() {
      await this.ctx.audioWorklet.addModule('js/audio/rhythm-worklet.js');
      if (this.closed) return;
      this.node = new AudioWorkletNode(this.ctx, 'phosphor-rhythm');
      this.worker = new Worker('js/audio/tempo-worker.js', {type: 'module'});
      this.worker.onmessage = ({data}) => {
        if (data.type === 'ack') this.pending = Math.max(0, this.pending - 1);
        if (data.type === 'ready') this.workerReady = true;
        if (data.type === 'tempo') {
          this.cost = data.cost;
          // An old analysis window must not drive current animation after a stall.
          if (this.ctx.currentTime - data.end > 5) return;
          if (Number.isFinite(data.bpm) && data.bpm > 0 && data.confidence >= 1.5 && Number.isFinite(data.beatTime)) {
            let bpm = data.bpm;
            if (this.tempo) {
              while (bpm < this.tempo.bpm * 0.7) bpm *= 2;
              while (bpm > this.tempo.bpm * 1.4) bpm /= 2;
            }
            if (this.tempo && Math.abs(bpm - this.tempo.bpm) / this.tempo.bpm > 0.08) {
              // Require a second matching estimate before accepting a DJ transition.
              if (!this.candidate || Math.abs(bpm - this.candidate) > 3) {
                this.candidate = bpm; this.state = 'Low confidence'; return;
              }
              this.tempo = null;
            }
            const beatTime = data.beatTime;
            this.candidate = null;
            this.error = '';
            this.tempo = {...data, bpm, beatTime};
            this.clock.setTempo(bpm, beatTime, this.ctx.currentTime);
            this.state = data.confidence >= 3 ? 'Locked' : 'Low confidence';
          } else { this.state = 'Low confidence'; }
        }
        if (data.type === 'error') { this.error = data.message; this.tempo = null; this.state = 'Tempo unavailable'; }
      };
      this.worker.onerror = () => { this.error = 'Tempo worker failed'; this.tempo = null; this.state = 'Tempo unavailable'; };
      this.node.onprocessorerror = () => { this.features = null; this.error = 'Audio analysis failed'; };
      this.node.port.onmessage = ({data}) => {
        if (this.closed) return;
        if (data.type === 'features') {
          this.features = data;
          if (data.rms >= 0.001) this.lastAudioTime = data.time;
        }
        else if (data.type === 'samples' && this.workerReady) {
          if (this.pending >= 16) { this.gap = true; return; }
          if (this.gap) { this.worker.postMessage({type: 'reset'}); this.gap = false; }
          this.pending++;
          this.worker.postMessage(data, [data.samples.buffer]);
        }
      };
      this.source.connect(this.node);
      // Connected to the destination to keep the worklet scheduled. Its output is always zero.
      this.node.connect(this.ctx.destination);
    }
    read() {
      const now = this.ctx.currentTime, f = this.features;
      if (this.closed || this.ctx.state !== 'running' || !f || now - f.time > 0.25) return null;
      const quiet = now - (this.lastAudioTime ?? -Infinity) > 0.75;
      const tempo = this.tempo && now - this.tempo.end < 16 ? this.tempo : null;
      const clock = this.clock.read(now);
      return {...f, bpmBeat: tempo && !quiet ? clock.pulse : 0, gridBeat: tempo && !quiet ? clock.gridBeat : null, beat: f.lastKick < 0 || quiet ? 0 : Math.exp(-Math.max(0, now - f.lastKick) / 0.11),
        bpm: tempo ? clock.bpm : 0,
        phase: tempo ? clock.phase : 0,
        state: quiet ? 'Listening' : tempo ? this.state : this.error ? 'Tempo unavailable' : 'Finding tempo',
        cost: this.cost, age: Math.max(0, now - f.time)};
    }
    stop() {
      this.closed = true;
      this.worker?.terminate();
      if (this.node) {
        this.node.port.onmessage = null; this.node.port.close();
        try { this.source.disconnect(this.node); } catch (_) {}
        this.node.disconnect();
      }
    }
  }
  window.PhosphorRhythm = Rhythm;
})();
