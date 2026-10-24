// Continuous audio-time oscillator. Tempo updates steer it without resetting a beat.
(() => {
  class BeatClock {
    constructor() { this.time = null; this.position = 0; this.bpm = 0; }
    setTempo(bpm, beatTime, now) {
      if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(beatTime)) return;
      this.advance(now);
      if (!this.bpm) {
        this.bpm = bpm;
        this.position = (now - beatTime) * bpm / 60;
      }
      this.targetBpm = bpm; this.anchor = beatTime; this.time = now;
    }
    advance(now) {
      if (this.time === null) { this.time = now; return; }
      const dt = Math.max(0, now - this.time);
      if (this.bpm && dt > 0) {
        const previousBpm = this.bpm;
        this.bpm += (this.targetBpm - this.bpm) * (1 - Math.exp(-dt / 4));
        this.position += (previousBpm + this.bpm) / 2 / 60 * dt;
        const expected = (now - this.anchor) * this.targetBpm / 60;
        const error = ((expected - this.position) % 1 + 1.5) % 1 - 0.5;
        // Correct at most 1.5% of a beat per second, rather than jumping phase.
        this.position += Math.max(-0.015, Math.min(0.015, error / 4)) * dt;
      }
      this.time = now;
    }
    read(now) {
      this.advance(now);
      const phase = ((this.position % 1) + 1) % 1;
      return {bpm: this.bpm, phase, gridBeat: Math.floor(this.position),
        pulse: this.bpm ? Math.exp(-phase * 60 / this.bpm / 0.11) : 0};
    }
  }
  window.PhosphorBeatClock = BeatClock;
})();
