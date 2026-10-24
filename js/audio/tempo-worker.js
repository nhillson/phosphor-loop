import { EssentiaWASM } from '../../vendor/essentia/essentia-wasm.es.js';
import Essentia from '../../vendor/essentia/essentia.js-core.es.js';
const engine = new Essentia(EssentiaWASM);
const rate = 44100, ring = new Float32Array(rate * 12);
let written = 0, next = ring.length, sourcePosition = 0, previous = 0, sourceRate = 0;
postMessage({type: 'ready'});
self.onmessage = ({data}) => {
  if (data.type === 'reset') { written = 0; next = ring.length; sourcePosition = 0; previous = 0; return; }
  if (data.type !== 'samples') return;
  postMessage({type: 'ack'});
  const samples = data.samples;
  if (data.rate !== sourceRate) {
    sourceRate = data.rate; written = 0; next = ring.length; sourcePosition = 0; previous = 0;
  }
  // Stateful linear resampling: preserve fractional position across capture blocks.
  for (let i = 0; i < samples.length; i++) {
    while (sourcePosition <= 1) {
      ring[written++ % ring.length] = previous + (samples[i] - previous) * sourcePosition;
      sourcePosition += sourceRate / rate;
    }
    sourcePosition -= 1; previous = samples[i];
  }
  if (written < next) return;
  next = written + rate * 4;
  const window = new Float32Array(ring.length);
  let energy = 0;
  for (let i = 0; i < window.length; i++) {
    const v = ring[(written + i) % ring.length]; window[i] = v; energy += v * v;
  }
  if (energy / window.length < 0.000001) {
    postMessage({type: 'tempo', bpm: 0, confidence: 0, end: data.end, cost: 0}); return;
  }
  let vector, result;
  const start = performance.now();
  try {
    vector = engine.arrayToVector(window);
    result = engine.RhythmExtractor2013(vector, 190, 'multifeature', 60);
    const ticks = engine.vectorToArray(result.ticks);
    postMessage({type: 'tempo', bpm: result.bpm, confidence: result.confidence,
      beatTime: ticks.length ? data.end - window.length / rate + ticks[ticks.length - 1] : null,
      end: data.end, cost: performance.now() - start});
  } catch (error) { postMessage({type: 'error', message: error.message}); }
  finally {
    vector?.delete();
    if (result) for (const value of Object.values(result)) if (value?.delete) value.delete();
  }
};
