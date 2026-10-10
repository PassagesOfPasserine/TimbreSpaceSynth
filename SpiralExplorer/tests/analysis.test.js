import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, estimatePitch, fftMagnitudes, featuresAt, makeDemo } from '../src/analysis.js';
import { spiralVertices, radiusForRms, rotationSpeed, buildRotationTrajectory, rotationAt, timeForSpiralPosition, spiralPositionForTime } from '../src/geometry.js';
import { cloneModel, editRegion, smoothRegion, validateModel, morphFrame } from '../src/sound-model.js';
import { renderModel, encodeWav } from '../src/resynthesis.js';
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
test('spiral position and feature time map bidirectionally', () => {
  const model = analyze(sine(220), rate);
  for (const position of [0, .1, .5, .9, 1])
    assert.ok(Math.abs(spiralPositionForTime(model, timeForSpiralPosition(model, position)) - position) < 1e-12);
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
test('analysis quality controls temporal feature resolution', () => {
  const pcm = sine(220, .3, .5);
  const fast = analyze(pcm, rate, () => {}, pcm, null, { quality: 'fast' });
  const high = analyze(pcm, rate, () => {}, pcm, null, { quality: 'high' });
  assert.ok(high.times.length > fast.times.length);
  assert.equal(fast.analysis.quality, 'fast'); assert.equal(high.analysis.quality, 'high');
});
test('feature model contains deterministic phase, residual and transient streams', () => {
  const a = analyze(makeDemo(rate, 1), rate), b = analyze(makeDemo(rate, 1), rate);
  assert.deepEqual(a.harmonicPhases, b.harmonicPhases);
  assert.deepEqual(a.residual, b.residual); assert.deepEqual(a.transient, b.transient);
  assert.equal(a.schema, 'timbre-space-features/2'); validateModel(a);
});
test('region edits are immutable, bounded and smoothable', () => {
  const original = analyze(makeDemo(rate, 1), rate), snapshot = cloneModel(original);
  const edited = editRegion(original, .25, .75, { harmonics: 1.8, twist: 1, radius: .5, residual: 1.2 });
  assert.deepEqual(original, snapshot); assert.notDeepEqual(edited.harmonics, original.harmonics);
  assert.notDeepEqual(edited.harmonicPhases, original.harmonicPhases);
  assert.ok(edited.rms.every(value => value >= 0 && value <= 1));
  assert.doesNotThrow(() => validateModel(smoothRegion(edited, .3, .7)));
});
test('A/B feature morph interpolates sound properties', () => {
  const a = analyze(sine(220, .2), rate), b = analyze(sine(440, .6), rate);
  const left = morphFrame(a, b, .15, 0), middle = morphFrame(a, b, .15, .5), right = morphFrame(a, b, .15, 1);
  assert.ok(Math.abs(middle.f0 - (left.f0 + right.f0) / 2) < 1e-6);
  assert.ok(middle.rms > left.rms && middle.rms < right.rms);
});
test('resynthesis is deterministic, finite, phase-continuous and exports valid stereo WAV', () => {
  const model = analyze(sine(220, .35, .2), rate), a = renderModel(model, rate), b = renderModel(model, rate);
  assert.deepEqual(a.left, b.left); assert.ok(a.left.every(Number.isFinite));
  assert.ok(a.left.some(value => Math.abs(value) > .001));
  let largestStep = 0; for (let i = 1; i < a.left.length; i++) largestStep = Math.max(largestStep, Math.abs(a.left[i] - a.left[i - 1]));
  assert.ok(largestStep < .5, `largest sample discontinuity ${largestStep}`);
  const wav = new Uint8Array(encodeWav(a));
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(new DataView(wav.buffer).getUint16(22, true), 2);
});
test('Nyquist suppression keeps high partial synthesis finite', () => {
  const model = analyze(sine(880, .3, .1), rate), rendered = renderModel(model, 8000, { pitchScale: 4 });
  assert.ok(rendered.left.every(Number.isFinite)); assert.ok(Math.max(...rendered.left.map(Math.abs)) <= 1);
});
