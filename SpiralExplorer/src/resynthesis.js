import { featuresAt } from './analysis.js';

export function renderModel(model, sampleRate = 44100, options = {}) {
  const duration = options.duration ?? model.source.duration;
  const count = Math.max(1, Math.ceil(duration * sampleRate));
  const left = new Float32Array(count), right = new Float32Array(count);
  const phases = new Float64Array(options.harmonicCount || 16);
  const harmonicAmount = options.harmonicAmount ?? 1, residualAmount = options.residualAmount ?? .2;
  const transientAmount = options.transientAmount ?? .25, pitchScale = options.pitchScale ?? 1;
  let seed = 0x51f15e, filteredNoise = 0, lastTransient = 0;
  for (let n = 0; n < count; n++) {
    const frame = featuresAt(model, n / sampleRate);
    let harmonic = 0;
    const f0 = Math.max(0, frame.f0 * pitchScale);
    for (let h = 0; h < phases.length; h++) {
      const frequency = f0 * (h + 1);
      if (frequency <= 0 || frequency >= sampleRate * .48) continue;
      phases[h] += 2 * Math.PI * frequency / sampleRate;
      if (phases[h] > Math.PI * 2) phases[h] -= Math.PI * 2;
      harmonic += (frame.harmonics[h] || 0) * Math.sin(phases[h] + (frame.harmonicPhases[h] || 0));
    }
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const noise = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    const coefficient = Math.min(.98, Math.max(.02, frame.centroid / sampleRate * 3));
    filteredNoise += coefficient * (noise - filteredNoise);
    const onset = Math.max(0, frame.transient - lastTransient); lastTransient = frame.transient;
    const signal = frame.rms * (harmonicAmount * harmonic + residualAmount * frame.residual * filteredNoise
      + transientAmount * onset * noise * 2);
    const width = Math.max(0, Math.min(1, frame.stereoWidth || 0));
    left[n] = Math.tanh(signal * (1 + width * .15));
    right[n] = Math.tanh(signal * (1 - width * .15));
  }
  return { sampleRate, left, right };
}

export function encodeWav(rendered) {
  const { sampleRate, left, right } = rendered, frames = Math.min(left.length, right.length);
  const buffer = new ArrayBuffer(44 + frames * 4), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((character, i) => view.setUint8(offset + i, character.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
    view.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
  }
  return buffer;
}
