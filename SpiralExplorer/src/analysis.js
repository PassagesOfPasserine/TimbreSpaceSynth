// Versioned, renderer-independent, deterministic analysis. No network or ML services.
export const SCHEMA = 'timbre-space-features/2';
export const ANALYSIS_RATE = 16000;
export const FRAME_SIZE = 2048;
export const HOP_SIZE = 320;
export const HARMONICS = 16;
export const BANDS = 24;

export function fftMagnitudes(input) {
  const n = input.length, re = Float64Array.from(input), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = start + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
      }
    }
  }
  return Float64Array.from({ length: n / 2 + 1 }, (_, i) => Math.hypot(re[i], im[i]));
}

export function fftSpectrum(input) {
  const n = input.length, re = Float64Array.from(input), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = start + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
      }
    }
  }
  const magnitudes = new Float64Array(n / 2 + 1), phases = new Float64Array(n / 2 + 1);
  for (let i = 0; i < magnitudes.length; i++) {
    magnitudes[i] = Math.hypot(re[i], im[i]);
    phases[i] = Math.atan2(im[i], re[i]);
  }
  return { magnitudes, phases };
}

// YIN difference / cumulative mean normalization with sub-sample refinement.
// 40–1000 Hz, confidence gated; unvoiced regions explicitly have f0 = 0.
export function estimatePitch(frame, rate = ANALYSIS_RATE) {
  const minLag = Math.floor(rate / 1000), maxLag = Math.min(Math.floor(rate / 40), frame.length >> 1);
  const difference = new Float64Array(maxLag + 1), length = frame.length - maxLag;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < length; i++) { const d = frame[i] - frame[i + lag]; sum += d * d; }
    difference[lag] = sum;
  }
  let cumulative = 0;
  const normalized = new Float64Array(maxLag + 1); normalized[0] = 1;
  for (let lag = 1; lag <= maxLag; lag++) {
    cumulative += difference[lag]; normalized[lag] = cumulative > 1e-18 ? difference[lag] * lag / cumulative : 1;
  }
  for (let lag = minLag; lag < maxLag; lag++) if (normalized[lag] < .15) {
    while (lag + 1 < maxLag && normalized[lag + 1] < normalized[lag]) lag++;
    const a = normalized[lag - 1], b = normalized[lag], c = normalized[lag + 1];
    const denominator = a - 2 * b + c;
    const offset = Math.abs(denominator) > 1e-12 ? .5 * (a - c) / denominator : 0;
    return { f0: rate / (lag + offset), confidence: Math.max(0, 1 - b) };
  }
  return { f0: 0, confidence: 0 };
}

// Windowed-sinc resampling prevents high-frequency content aliasing into pitch.
export function resample(input, sourceRate, targetRate = ANALYSIS_RATE) {
  if (sourceRate === targetRate) return input.slice();
  const ratio = sourceRate / targetRate, cutoff = Math.min(1, targetRate / sourceRate) * .94;
  const radius = Math.ceil(16 / cutoff);
  const out = new Float32Array(Math.ceil(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const center = i * ratio; let sum = 0, norm = 0;
    for (let j = Math.ceil(center - radius); j <= Math.floor(center + radius); j++) {
      if (j < 0 || j >= input.length) continue;
      const distance = j - center, u = distance * cutoff;
      const sinc = Math.abs(u) < 1e-10 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
      const weight = cutoff * sinc * (.5 + .5 * Math.cos(Math.PI * distance / radius));
      sum += input[j] * weight; norm += weight;
    }
    out[i] = norm !== 0 ? sum / norm : 0;
  }
  return out;
}

export function analyze(mono, sampleRate, onProgress = () => {}, volumePcm = mono, widthPcm = null, options = {}) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000 || !mono.length)
    throw new Error('Unsupported sample rate or empty audio.');
  const pcm = resample(mono, sampleRate), quality = options.quality || 'balanced';
  const hopSize = quality === 'fast' ? HOP_SIZE * 2 : quality === 'high' ? HOP_SIZE / 2 : HOP_SIZE;
  const duration = mono.length / sampleRate;
  const times = [], rms = [], pitch = [], confidence = [], centroid = [], harmonics = [], harmonicPhases = [];
  const envelope = [], residual = [], transient = [], stereoWidth = [];
  let previousMagnitudes = null;
  const count = Math.ceil(duration * ANALYSIS_RATE / hopSize);
  for (let index = 0; index < count; index++) {
    const center = index * hopSize, frame = new Float64Array(FRAME_SIZE), windowed = new Float64Array(FRAME_SIZE);
    let energy = 0, volumeEnergy = 0, widthEnergy = 0, volumeCount = 0;
    // Analysis centered on the timeline, no causal-analysis delay in playback.
    for (let i = 0; i < FRAME_SIZE; i++) {
      const position = center + i - FRAME_SIZE / 2;
      frame[i] = pcm[position] || 0; energy += frame[i] ** 2;
      windowed[i] = frame[i] * (.5 - .5 * Math.cos(2 * Math.PI * i / (FRAME_SIZE - 1)));
    }
    // RMS from original PCM, not the bandlimited pitch analysis signal.
    const originalCenter = Math.round(center / ANALYSIS_RATE * sampleRate);
    const halfWindow = Math.round(sampleRate * .02);
    for (let n = Math.max(0, originalCenter - halfWindow); n < Math.min(mono.length, originalCenter + halfWindow); n++) {
      volumeEnergy += volumePcm[n] ** 2; widthEnergy += (widthPcm?.[n] || 0) ** 2; volumeCount++;
    }
    const amplitude = Math.sqrt(volumeEnergy / Math.max(1, volumeCount));
    const estimate = energy / FRAME_SIZE > 1e-8 ? estimatePitch(frame) : { f0: 0, confidence: 0 };
    const spectrum = fftSpectrum(windowed), magnitudes = spectrum.magnitudes;
    let weighted = 0, magnitudeSum = 0;
    for (let k = 1; k < magnitudes.length; k++) { weighted += magnitudes[k] * k * ANALYSIS_RATE / FRAME_SIZE; magnitudeSum += magnitudes[k]; }
    const harmonic = Array(HARMONICS).fill(0), phase = Array(HARMONICS).fill(0);
    if (estimate.f0) for (let h = 1; h <= HARMONICS; h++) {
      const bin = Math.round(h * estimate.f0 * FRAME_SIZE / ANALYSIS_RATE);
      if (bin > 0 && bin < magnitudes.length - 1) {
        harmonic[h - 1] = Math.max(magnitudes[bin - 1], magnitudes[bin], magnitudes[bin + 1]);
        phase[h - 1] = spectrum.phases[bin];
      }
    }
    const spectralEnergy = magnitudes.reduce((sum, value) => sum + value * value, 0);
    const harmonicEnergy = harmonic.reduce((sum, value) => sum + value * value, 0);
    let flux = 0, positiveEnergy = 0;
    if (previousMagnitudes) for (let k = 1; k < magnitudes.length; k++) {
      const delta = magnitudes[k] - previousMagnitudes[k];
      if (delta > 0) flux += delta * delta;
      positiveEnergy += magnitudes[k] * magnitudes[k];
    }
    previousMagnitudes = magnitudes.slice();
    const harmonicSum = harmonic.reduce((a, b) => a + b, 0);
    if (harmonicSum > 1e-9) for (let h = 0; h < HARMONICS; h++) harmonic[h] /= harmonicSum;
    const bands = Array(BANDS).fill(0);
    for (let band = 0; band < BANDS; band++) {
      const low = 40 * (8000 / 40) ** (band / BANDS), high = 40 * (8000 / 40) ** ((band + 1) / BANDS);
      for (let k = Math.max(1, Math.ceil(low * FRAME_SIZE / ANALYSIS_RATE)); k <= Math.min(magnitudes.length - 1, Math.floor(high * FRAME_SIZE / ANALYSIS_RATE)); k++) bands[band] += magnitudes[k] ** 2;
      bands[band] = Math.sqrt(bands[band]);
    }
    const bandNorm = bands.reduce((a, b) => a + b, 0);
    if (bandNorm > 1e-9) for (let b = 0; b < BANDS; b++) bands[b] /= bandNorm;
    times.push(center / ANALYSIS_RATE); rms.push(amplitude); pitch.push(estimate.f0); confidence.push(estimate.confidence);
    centroid.push(magnitudeSum > 1e-9 ? weighted / magnitudeSum : 0); harmonics.push(harmonic); harmonicPhases.push(phase); envelope.push(bands);
    residual.push(spectralEnergy > 1e-9 ? Math.max(0, Math.min(1, 1 - harmonicEnergy / spectralEnergy)) : 0);
    transient.push(positiveEnergy > 1e-9 ? Math.max(0, Math.min(1, Math.sqrt(flux / positiveEnergy))) : 0);
    stereoWidth.push(Math.max(0, Math.min(1, Math.sqrt(widthEnergy / Math.max(1, volumeCount)))));
    if (index % 25 === 0) onProgress(index / count);
  }
  return { schema: SCHEMA, source: { sampleRate, samples: mono.length, duration },
    analysis: { rate: ANALYSIS_RATE, frameSize: FRAME_SIZE, hopSize, quality, pitchRangeHz: [40, 1000],
      method: 'Hann complex FFT + normalized harmonic magnitudes/phases + residual/flux + 24 log spectral bands + YIN',
      spectralLimitHz: 8000, rmsWindowSeconds: .04 },
    times, rms, pitch, confidence, centroid, harmonics, harmonicPhases, envelope, residual, transient, stereoWidth };
}

export function featuresAt(features, time) {
  const position = Math.max(0, Math.min(features.times.length - 1, time * features.analysis.rate / features.analysis.hopSize));
  const a = Math.floor(position), b = Math.min(a + 1, features.times.length - 1), blend = position - a;
  const mix = (stream) => stream[a] * (1 - blend) + stream[b] * blend;
  // Do not interpolate a voiced f0 toward silence as if it were a lower note.
  const voiced = features.pitch[a] > 0 && features.pitch[b] > 0;
  const vectors = (name, fallback = 0) => (features[name]?.[a] || Array(HARMONICS).fill(fallback))
    .map((v, i) => v * (1 - blend) + (features[name]?.[b]?.[i] ?? v) * blend);
  return { rms: mix(features.rms), f0: voiced ? mix(features.pitch) : features.pitch[Math.round(position)],
    confidence: mix(features.confidence), centroid: mix(features.centroid),
    residual: features.residual ? mix(features.residual) : 0,
    transient: features.transient ? mix(features.transient) : 0,
    stereoWidth: features.stereoWidth ? mix(features.stereoWidth) : 0,
    harmonics: vectors('harmonics'), harmonicPhases: vectors('harmonicPhases'),
    envelope: (features.envelope[a] || []).map((v, i) => v * (1 - blend) + features.envelope[b][i] * blend) };
}

export function makeDemo(rate = 24000, duration = 12) {
  const pcm = new Float32Array(rate * duration); let phase = 0;
  for (let i = 0; i < pcm.length; i++) {
    const t = i / rate, f0 = 160 + 120 * (.5 + .5 * Math.sin(t * .6)); phase += 2 * Math.PI * f0 / rate;
    const brightness = .5 + .5 * Math.sin(t * 1.2);
    const amp = .13 + .2 * (.5 + .5 * Math.sin(t * 1.8));
    const fade = Math.min(1, t / .01, (duration - t) / .05);
    pcm[i] = fade * amp * (Math.sin(phase) + brightness * .5 * Math.sin(phase * 2) + brightness * .3 * Math.sin(phase * 3));
  }
  return pcm;
}
