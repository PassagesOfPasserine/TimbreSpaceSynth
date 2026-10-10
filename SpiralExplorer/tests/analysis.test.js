import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, estimatePitch, fftMagnitudes, featuresAt, makeDemo } from '../src/analysis.js';
import { spiralVertices, radiusForRms, rotationSpeed, buildRotationTrajectory, rotationAt } from '../src/geometry.js';
const rate = 16000;
const sine = (f, amplitude = .5, seconds = .3) => Float32Array.from({ length: rate * seconds }, (_, n) => amplitude * Math.sin(2 * Math.PI * f * n / rate));
test('FFT finds a known spectral bin', () => {
  const values = Float64Array.from({ length: 2048 }, (_, n) => Math.sin(2 * Math.PI * 32 * n / 2048));
  const bins = fftMagnitudes(values); assert.ok(Math.abs(bins[32] - 1024) < 1e-6);
});
test('fundamental estimation across the supported range', () => {
  for (const hz of [50, 110, 220, 440, 880]) {
    const result = estimatePitch(sine(hz).slice(0, 2048));
    assert.ok(Math.abs(result.f0 - hz) / hz < .015, `${hz}: ${result.f0}`);
    assert.ok(result.confidence > .9);
  }
});
test('silence is unvoiced, zero RMS, finite zero-size geometry', () => {
  const result = analyze(new Float32Array(4800), rate);
  assert.ok(result.rms.every(v => v === 0)); assert.ok(result.pitch.every(v => v === 0));
  assert.equal(radiusForRms(0), 0); assert.equal(rotationSpeed(0), 0);
  assert.ok(spiralVertices(result, .1, 512).every(Number.isFinite));
});
test('RMS amplitude and harmonic shape are independent', () => {
  const quiet = analyze(sine(220, .2), rate), loud = analyze(sine(220, .6), rate);
  const a = featuresAt(quiet, .15), b = featuresAt(loud, .15);
  assert.ok(Math.abs(a.rms - .2 / Math.sqrt(2)) < .004);
  assert.ok(Math.abs(b.rms / a.rms - 3) < .01);
  a.harmonics.forEach((v, i) => assert.ok(Math.abs(v - b.harmonics[i]) < 1e-5));
  assert.ok(radiusForRms(b.rms) > radiusForRms(a.rms));
  assert.ok(rotationSpeed(880) > rotationSpeed(110));
});
test('analysis and geometry repeat exactly; time-varying timbre is preserved', () => {
  const pcm = makeDemo(rate, 2), a = analyze(pcm, rate), b = analyze(pcm, rate);
  assert.deepEqual(a, b); assert.deepEqual(spiralVertices(a, 1, 512), spiralVertices(b, 1, 512));
  assert.notDeepEqual(a.harmonics[5], a.harmonics[75]);
  assert.notDeepEqual(spiralVertices(a, .2, 512), spiralVertices(a, 1.8, 512));
  const vertices = spiralVertices(a, 1, 512);
  assert.ok(vertices.some((v, i) => i % 3 === 2 && Math.abs(v) > .5), 'true depth');
  assert.ok(Math.abs(vertices[1] - 1) < 1e-5); assert.ok(Math.abs(vertices.at(-2) + 1) < 1e-5);
});
test('pitch rotation is seekable, monotonic and tied to timeline', () => {
  const f = analyze(sine(440), rate), trajectory = buildRotationTrajectory(f);
  const earlier = rotationAt(f, trajectory, .1), later = rotationAt(f, trajectory, .2);
  assert.ok(later > earlier); assert.equal(rotationAt(f, trajectory, .1), earlier);
});
test('input validation rejects invalid rate and empty audio', () => {
  assert.throws(() => analyze(new Float32Array(10), NaN));
  assert.throws(() => analyze(new Float32Array(), rate));
});
test('stereo volume stream is independent of the channel chosen for pitch', () => {
  const quiet = sine(220, .1), volume = sine(220, .5);
  const result = analyze(quiet, rate, () => {}, volume);
  const frame = featuresAt(result, .15);
  assert.ok(Math.abs(frame.rms - .5 / Math.sqrt(2)) < .005);
  assert.ok(Math.abs(frame.f0 - 220) < 1);
});
test('source-rate resampling preserves pitch and RMS', () => {
  const sourceRate = 48000;
  const pcm = Float32Array.from({length: sourceRate * .3}, (_, n) => .4 * Math.sin(2 * Math.PI * 330 * n / sourceRate));
  const result = featuresAt(analyze(pcm, sourceRate), .15);
  assert.ok(Math.abs(result.f0 - 330) < 2);
  assert.ok(Math.abs(result.rms - .4 / Math.sqrt(2)) < .005);
});
