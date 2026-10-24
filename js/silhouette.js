// A silent prerecorded human matte. Beat phase chooses the pose; color comes from the renderer.
(() => {
  const SOURCE_BPM = 104, BEATS = 16;
  class Silhouette {
    constructor() {
      this.video = document.createElement('video');
      this.video.muted = true; this.video.playsInline = true; this.video.loop = true; this.video.preload = 'auto';
      this.video.src = 'static/silhouette-mask-v2.mp4';
      this.error = ''; this.status = 'Loading dancer…'; this.lastBeat = null;
      this.video.addEventListener('error', () => { this.error = 'The built-in dancer could not load. Reload the page to retry.'; });
      this.video.load();
    }
    static target(beat) { return ((beat % BEATS + BEATS) % BEATS) * 60 / SOURCE_BPM; }
    update(clock) {
      const v = this.video;
      if (this.error) { this.status = this.error; return; }
      if (v.readyState < 2) { this.status = 'Loading dancer…'; return; }
      if (!clock || !Number.isFinite(clock.beat) || !Number.isFinite(clock.bpm)) {
        v.pause(); this.lastBeat = null; this.status = 'Waiting for music beat lock. Or select Manual BPM.'; return;
      }
      const target = Math.min(Silhouette.target(clock.beat), Math.max(0, v.duration - 0.025));
      const span = BEATS * 60 / SOURCE_BPM;
      const error = ((target - v.currentTime + span * 1.5) % span) - span / 2;
      const jumped = this.lastBeat === null || clock.beat < this.lastBeat || clock.beat - this.lastBeat > 0.5;
      if (!v.seeking && (jumped || Math.abs(error) > 0.12 || !clock.playing)) {
        if (Math.abs(target - v.currentTime) > 0.035) v.currentTime = target;
      }
      v.playbackRate = Math.max(0.25, Math.min(4, clock.bpm / SOURCE_BPM * (1 + Math.max(-0.08, Math.min(0.08, error)))));
      this.lastBeat = clock.beat;
      if (!clock.playing) { v.pause(); this.status = 'Paused with the music.'; }
      else {
        if (v.paused) v.play().catch(() => { this.status = 'Click the Silhouette input to allow playback.'; });
        this.status = `Beat synced · ${Math.round(clock.bpm * 10) / 10} BPM · ${clock.label}`;
      }
    }
    pause() { this.video.pause(); this.lastBeat = null; }
  }
  Silhouette.sourceBpm = SOURCE_BPM; Silhouette.beats = BEATS;
  globalThis.PhosphorSilhouette = Silhouette;
})();
