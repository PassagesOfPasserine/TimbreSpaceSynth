import { featuresAt } from './analysis.js';
export const MAPPING = {
  version: 'spherical-spiral/1', turns: 9, historySeconds: 4,
  radius: '4 * sqrt(clamp(RMS, 0, 1))',
  rotation: '2*pi * clamp(f0/440, 0, 4) * 0.12 radians/second; unvoiced = 0',
  deformation: 'normalized harmonic radial ripples, spectral-envelope polar bends and azimuth twists',
};
export function radiusForRms(rms) { return 4 * Math.sqrt(Math.max(0, Math.min(1, rms))); }
export function rotationSpeed(f0) { return 2 * Math.PI * Math.min(4, Math.max(0, f0 / 440)) * .12; }
export function timeForSpiralPosition(model, position) {
  return Math.max(0, Math.min(1, position)) * model.source.duration;
}
export function spiralPositionForTime(model, time) {
  return model.source.duration > 0 ? Math.max(0, Math.min(1, time / model.source.duration)) : 0;
}
export function buildRotationTrajectory(features) {
  const trajectory = new Float64Array(features.times.length);
  for (let i = 1; i < trajectory.length; i++) trajectory[i] = trajectory[i - 1] +
    .5 * (rotationSpeed(features.pitch[i - 1]) + rotationSpeed(features.pitch[i])) * (features.times[i] - features.times[i - 1]);
  return trajectory;
}
export function rotationAt(features, trajectory, time) {
  const hop = features.analysis.hopSize / features.analysis.rate;
  const pos = Math.max(0, Math.min(trajectory.length - 1, time / hop));
  const a = Math.floor(pos), b = Math.min(a + 1, trajectory.length - 1), part = pos - a;
  return trajectory[a] * (1 - part) + trajectory[b] * part;
}
// Unit-radius vertices; RMS controls the entire object scale independently.
export function spiralVertices(features, time, resolution, output = new Float32Array(resolution * 3)) {
  if (resolution < 2 || output.length !== resolution * 3) throw new Error('Invalid spiral resolution');
  for (let i = 0; i < resolution; i++) {
    const t = i / (resolution - 1), theta = Math.PI * t, phi = 2 * Math.PI * MAPPING.turns * t;
    const f = featuresAt(features, Math.max(0, time - MAPPING.historySeconds * (1 - t)));
    let radial = 0, bend = 0, twist = 0;
    for (let h = 0; h < f.harmonics.length; h++) radial += f.harmonics[h] * Math.sin((h + 1) * phi + theta * (h + 1));
    for (let b = 0; b < f.envelope.length; b++) {
      bend += f.envelope[b] * Math.sin((b + 1) * theta * 2);
      twist += f.envelope[b] * Math.sin((b + 1) * theta + phi * .25);
    }
    const poleFade = Math.sin(theta); // Both poles remain continuous and well behaved.
    const polar = theta + .22 * bend * poleFade, azimuth = phi + .65 * twist;
    const radius = 1 + .24 * radial * poleFade;
    output[i * 3] = radius * Math.sin(polar) * Math.cos(azimuth);
    output[i * 3 + 1] = radius * Math.cos(polar); // Three.js uses Y as vertical.
    output[i * 3 + 2] = radius * Math.sin(polar) * Math.sin(azimuth);
  }
  return output;
}
