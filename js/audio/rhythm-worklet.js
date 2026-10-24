// Continuous, bounded analysis on the audio clock. No audible output.
class RhythmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.low = 0; this.mid = 0; this.dc = 0;
    this.energy = [0, 0, 0]; this.previous = [0, 0, 0];
    this.baseline = [0.00001, 0.00001, 0.00001];
    this.percussion = 0; this.tonal = 0;
    this.count = 0; this.lastKick = -1; this.kicks = 0;
    this.chunk = new Float32Array(2048); this.used = 0;
    this.aLow = 1 - Math.exp(-2 * Math.PI * 170 / sampleRate);
    this.aMid = 1 - Math.exp(-2 * Math.PI * 2500 / sampleRate);
    this.aDC = 1 - Math.exp(-2 * Math.PI * 30 / sampleRate);
    this.hop = Math.round(sampleRate * 0.01);
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let x = 0;
      for (const channel of channels) x += channel[i] / channels.length;
      this.dc += this.aDC * (x - this.dc);
      this.low += this.aLow * (x - this.low);
      this.mid += this.aMid * (x - this.mid);
      const bass = this.low - this.dc, mid = this.mid - this.low, high = x - this.mid;
      this.energy[0] += bass * bass; this.energy[1] += mid * mid; this.energy[2] += high * high;
      this.chunk[this.used++] = x;
      if (this.used === this.chunk.length) {
        this.port.postMessage({type: 'samples', samples: this.chunk, rate: sampleRate,
          end: (currentFrame + i + 1) / sampleRate}, [this.chunk.buffer]);
        this.chunk = new Float32Array(2048); this.used = 0;
      }
      if (++this.count === this.hop) {
        const time = (currentFrame + i + 1) / sampleRate;
        const levels = this.energy.map(v => v / this.hop);
        const attacks = levels.map((v, b) => Math.max(0, v - this.previous[b]));
        const kick = levels[0] > 0.00002 && attacks[0] > Math.max(0.000015, this.baseline[0] * 0.65)
          && levels[0] > this.previous[0] * 1.45 && time - this.lastKick > 0.22;
        if (kick) { this.lastKick = time; this.kicks++; }
        const activity = levels.map((v, b) => Math.min(1, Math.sqrt(v / Math.max(0.0001, this.baseline[b] * 4))));
        this.percussion = Math.max(this.percussion * Math.exp(-0.01 / 0.09),
          Math.min(1, attacks[1] / Math.max(0.0001, this.baseline[1])));
        this.tonal += (activity[1] - this.tonal) * (1 - Math.exp(-0.01 / 0.5));
        this.port.postMessage({type: 'features', time, kick, kicks: this.kicks, lastKick: this.lastKick,
          bass: activity[0], percussion: this.percussion, highs: activity[2], tonal: this.tonal,
          rms: Math.sqrt(levels.reduce((a, b) => a + b, 0))});
        for (let b = 0; b < 3; b++) {
          this.baseline[b] += (levels[b] - this.baseline[b]) * 0.01;
          this.previous[b] = levels[b]; this.energy[b] = 0;
        }
        this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor('phosphor-rhythm', RhythmProcessor);
