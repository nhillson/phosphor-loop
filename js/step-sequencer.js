// Beat durations accumulate only while a valid music grid is available.
(() => {
  class StepSequencer {
    start(durations, end = 'hold') {
      this.durations = durations; this.end = end; this.index = -1;
      this.elapsed = 0; this.previous = null; this.running = true;
    }
    static locate(progressMs, bpm, offsetSeconds, durations, end = 'hold') {
      const total = durations.reduce((a, b) => a + b, 0);
      if (!total || !Number.isFinite(progressMs) || !Number.isFinite(bpm) || bpm <= 0) return { index: -1, waiting: true };
      const beats = (progressMs / 1000 - offsetSeconds) * bpm / 60;
      if (beats < 0) return { index: -1, waiting: true };
      const cycle = end === 'loop' ? Math.floor(beats / total) : 0;
      let remaining = end === 'loop' ? beats % total : beats;
      for (let index = 0; index < durations.length; index++) {
        if (remaining < durations[index]) return { index, elapsed: remaining, cycle, ended: false };
        remaining -= durations[index];
      }
      return { index: durations.length - 1, elapsed: durations.at(-1), cycle, ended: true };
    }
    stop() { this.running = false; this.previous = null; }
    tick(position) {
      if (!this.running) return null;
      if (!Number.isFinite(position)) { this.previous = null; return null; }
      if (this.previous === null) { this.previous = position; return null; }
      const delta = position - this.previous;
      this.previous = position;
      // A reconnected tracker may have a different epoch. Never count its jump.
      if (delta < 0 || delta > 2) return null;
      if (this.index < 0) {
        if (Math.floor(position) === Math.floor(position - delta)) return null;
        this.index = 0; this.elapsed = position % 1;
        return { index: 0 };
      }
      this.elapsed += delta;
      let changed = false;
      while (this.elapsed >= this.durations[this.index]) {
        this.elapsed -= this.durations[this.index]; this.index++; changed = true;
        if (this.index === this.durations.length) {
          if (this.end === 'loop') this.index = 0;
          else { this.stop(); return { done: true, autopilot: this.end === 'auto' }; }
        }
      }
      return changed ? { index: this.index } : null;
    }
  }
  globalThis.PhosphorStepSequencer = StepSequencer;
})();
