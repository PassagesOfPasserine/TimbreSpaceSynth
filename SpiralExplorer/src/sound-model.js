import { SCHEMA, featuresAt } from './analysis.js';

export function validateModel(model) {
  if (!model || model.schema !== SCHEMA || !Array.isArray(model.times) || model.times.length < 1)
    throw new Error(`Expected ${SCHEMA} feature data.`);
  const count = model.times.length;
  for (const name of ['rms', 'pitch', 'confidence', 'harmonics', 'harmonicPhases', 'envelope', 'residual', 'transient']) {
    if (!Array.isArray(model[name]) || model[name].length !== count) throw new Error(`Invalid ${name} stream.`);
  }
  for (const stream of ['rms', 'pitch', 'confidence', 'residual', 'transient'])
    if (model[stream].some(value => !Number.isFinite(value))) throw new Error(`Non-finite ${stream} value.`);
  return model;
}

export function cloneModel(model) {
  return structuredClone(validateModel(model));
}

export function editRegion(model, start, end, edit) {
  const result = cloneModel(model), lo = Math.max(0, Math.min(start, end)), hi = Math.min(1, Math.max(start, end));
  const first = Math.floor(lo * (result.times.length - 1)), last = Math.ceil(hi * (result.times.length - 1));
  for (let i = first; i <= last; i++) {
    const edge = Math.min(i - first + 1, last - i + 1, 4) / 4;
    if (edit.harmonics != null) result.harmonics[i] = result.harmonics[i].map((v, h) =>
      Math.max(0, v * (1 + edge * (edit.harmonics - 1) * (1 + h / result.harmonics[i].length))));
    if (edit.twist != null) result.harmonicPhases[i] = result.harmonicPhases[i].map((v, h) =>
      v + edge * edit.twist * (h + 1) * .12);
    if (edit.radius != null) result.rms[i] = Math.max(0, Math.min(1, result.rms[i] * (1 + edge * (edit.radius - 1))));
    if (edit.residual != null) result.residual[i] = Math.max(0, Math.min(1, result.residual[i] * (1 + edge * (edit.residual - 1))));
  }
  return result;
}

export function smoothRegion(model, start, end) {
  const result = cloneModel(model), first = Math.max(1, Math.floor(start * (result.times.length - 1)));
  const last = Math.min(result.times.length - 2, Math.ceil(end * (result.times.length - 1)));
  for (let i = first; i <= last; i++) {
    for (const name of ['rms', 'pitch', 'residual', 'transient'])
      result[name][i] = (model[name][i - 1] + 2 * model[name][i] + model[name][i + 1]) / 4;
    for (const name of ['harmonics', 'harmonicPhases', 'envelope'])
      result[name][i] = model[name][i].map((value, k) =>
        (model[name][i - 1][k] + 2 * value + model[name][i + 1][k]) / 4);
  }
  return result;
}

export function morphFrame(a, b, time, amount) {
  if (!b) return featuresAt(a, time);
  const left = featuresAt(a, Math.min(time, a.source.duration));
  const right = featuresAt(b, Math.min(time / Math.max(a.source.duration, .001) * b.source.duration, b.source.duration));
  const mix = (x, y) => x * (1 - amount) + y * amount;
  return {
    rms: mix(left.rms, right.rms), f0: mix(left.f0, right.f0), confidence: mix(left.confidence, right.confidence),
    centroid: mix(left.centroid, right.centroid), residual: mix(left.residual, right.residual),
    transient: mix(left.transient, right.transient), stereoWidth: mix(left.stereoWidth, right.stereoWidth),
    harmonics: left.harmonics.map((v, i) => mix(v, right.harmonics[i] || 0)),
    harmonicPhases: left.harmonicPhases.map((v, i) => mix(v, right.harmonicPhases[i] || 0)),
    envelope: left.envelope.map((v, i) => mix(v, right.envelope[i] || 0)),
  };
}
