'use strict';
// Hits, straight from the sound: the beat Phosphor Loop's picture pulses to. No tempo is guessed (an earlier
// tempo finder drifted off the beat or settled on the wrong BPM); a pulse comes the moment a hit is heard, and
// none comes without one.
//
// A hit is the spectrum jumping up all at once: each frame, how much louder every pitch got since the last frame
// (only the rises count), in the bass (35-160 Hz, where kicks live) and across everything. Each rise is judged
// against its own last second or so (its typical level plus 1.6 times its spread), so busy and sparse music, loud
// and quiet, find their hits alike. A hit in the bass (a kick) gives a full pulse; one only up high (a snare, a
// clap, a hi-hat) a lighter one, so the kicks lead and the hats don't pump the picture on every eighth note.
// After a hit there's a short rest (0.12 s). The pulse (beat, 0 to 1) jumps on a hit and dies away in about a
// fifth of a second. strong: this frame's hit counts as a beat (Autopilot's Change on the beat, color flips).
//
// step(bins, hz, dt, t, loud): bins: this frame's AnalyserNode byte spectrum; hz: Hz per bin; dt: seconds since
// the last frame; t: now in seconds; loud: how loud the sound is (silence never hits). Returns this frame's new
// hit's strength (0 for none), and sets strong.
(() => {
  // A running typical level and spread, for one kind of rise
  const stat = () => ({ avg: 0, dev: 0.02 });
  const over = (S, x) => x - (S.avg + 1.6 * S.dev);
  const learn = (S, x, k) => {
    const r = Math.min(x, S.avg + 4 * S.dev);   // a hit only nudges it, so one big hit doesn't hide the next
    S.avg += (r - S.avg) * k;
    S.dev = Math.max(0.004, S.dev + (Math.abs(r - S.avg) - S.dev) * k);
  };
  class Hits {
    constructor() { this.prev = null; this.lo = stat(); this.all = stat(); this.last = -1; this.times = []; this.beat = 0; this.strong = false; }
    step(bins, hz, dt, t, loud) {
      const n = bins.length;
      const span = (lo, hi) => [Math.max(1, Math.floor(lo / hz)), Math.min(n - 1, Math.ceil(hi / hz))];
      this.strong = false;
      if (!this.prev || this.prev.length !== n) { this.prev = new Uint8Array(n); this.prev.set(bins); return 0; }
      const [l0, l1] = span(35, 160), [b0, b1] = span(160, 9000);
      let low = 0, wide = 0;
      // A rise counts by how loud that pitch now is: a near-silent pitch flickering up (a hi-hat's faint smear
      // into the bass, say) is many decibels but nothing you'd hear as a hit
      const W = (v) => (v / 255) * (v / 255);
      for (let i = l0; i <= l1; i++) { const d = bins[i] - this.prev[i]; if (d > 0) low += d * W(bins[i]); }
      for (let i = b0; i <= b1; i++) { const d = bins[i] - this.prev[i]; if (d > 0) wide += d * W(bins[i]); }
      this.prev.set(bins);
      // Measured per sixtieth of a second (a slow frame gathers more rise)
      const per = Math.min(4, Math.max(0.25, dt * 60));
      const lr = low / ((l1 - l0 + 1) * 255) / per, wr = wide / ((b1 - b0 + 1) * 255) / per;
      const all = 0.65 * lr + 0.35 * wr;
      const oLo = over(this.lo, lr), oAll = over(this.all, all);
      let hit = 0;
      if (loud > 0.006 && t - this.last > 0.12) {
        if (oLo > 0 && lr > 0.02) {
          // A hit with weight in the bass (a kick, a floor tom, a bass note's attack): a full pulse
          hit = Math.min(1, 0.6 + 0.4 * oLo / Math.max(this.lo.dev * 3, 0.01));
          this.strong = true;
        } else if (oAll > 0 && all > 0.012) {
          // A hit up high (a snare, a clap, a hi-hat, a strum): a lighter pulse, more for a bigger one
          hit = Math.min(0.55, 0.25 + 0.3 * oAll / Math.max(this.all.dev * 3, 0.01));
          this.strong = hit >= 0.45;
        }
        if (hit) { this.last = t; this.times.push(t); }
      }
      const k = 1 - Math.exp(-dt / 1.2);
      learn(this.lo, lr, k);
      learn(this.all, all, k);
      while (this.times.length && t - this.times[0] > 4) this.times.shift();
      this.beat = hit > 0 ? Math.max(hit, this.beat) : this.beat * Math.exp(-dt / (loud > 0.006 ? 0.09 : 0.05));
      return hit;
    }
  }
  (typeof window !== 'undefined' ? window : globalThis).PhosphorHits = Hits;
})();
