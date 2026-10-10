import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { featuresAt, makeDemo } from './analysis.js';
import { MAPPING, spiralVertices, radiusForRms, buildRotationTrajectory, rotationAt } from './geometry.js';
const $ = id => document.getElementById(id);
const status = message => { $('status').textContent = message; };
let context, audioBuffer, features, trajectory, worker, source;
let playing = false, offset = 0, startedAt = 0, generation = 0, fileName = 'Evolving harmonic demo';
function audioContext() { return context ??= new AudioContext(); }
function currentTime() { return audioBuffer ? Math.min(audioBuffer.duration, playing ? offset + context.currentTime - startedAt : offset) : 0; }
function setWavePosition(value) {
  const position = Math.max(0, Math.min(1, Number(value) || 0));
  $('seek').value = position;
  $('positionDial').style.setProperty('--position', position);
  $('seek').setAttribute('aria-valuetext', `${Math.round(position * 100)}%`);
}
function stopSource() {
  if (source) { source.onended = null; source.stop(); source.disconnect(); source = undefined; }
}
function pause() {
  offset = currentTime(); playing = false; stopSource();
  setWavePosition(audioBuffer?.duration ? offset / audioBuffer.duration : 0);
  $('play').textContent = '▶︎'; $('play').setAttribute('aria-label', 'Play');
}
async function play() {
  if (!audioBuffer || !features) return;
  await audioContext().resume();
  if (offset >= audioBuffer.duration) offset = 0;
  stopSource(); source = context.createBufferSource(); source.buffer = audioBuffer;
  source.connect(context.destination); startedAt = context.currentTime; playing = true;
  source.start(0, offset); $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Pause');
  source.onended = () => { if (playing) { offset = audioBuffer.duration; playing = false; $('play').textContent = '▶︎'; $('play').setAttribute('aria-label', 'Play'); } };
}
$('play').onclick = () => { if (playing) pause(); else play().catch(error => status(error.message)); };
$('seek').oninput = async () => {
  const wasPlaying = playing; pause(); offset = Number($('seek').value) * audioBuffer.duration;
  updateGeometry(true); if (wasPlaying) await play();
};
function timeLabel(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function setBusy(busy) {
  $('loading').hidden = !busy; $('file').disabled = busy; $('demo').disabled = busy;
  $('play').disabled = busy || !features; $('seek').disabled = busy || !features; $('export').disabled = busy || !features;
}
function analyzeBuffer(buffer, name) {
  pause(); const job = ++generation; worker?.terminate(); setBusy(true);
  // Analyze the strongest channel for pitch/timbre to avoid antiphase cancellation.
  // Volume uses mean channel energy, preserving stereo RMS independently.
  const volume = new Float32Array(buffer.length); let strongest = 0, strongestEnergy = -1;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const pcm = buffer.getChannelData(ch); let energy = 0;
    for (let i = 0; i < volume.length; i++) { volume[i] += pcm[i] ** 2 / buffer.numberOfChannels; energy += pcm[i] ** 2; }
    if (energy > strongestEnergy) { strongest = ch; strongestEnergy = energy; }
  }
  for (let i = 0; i < volume.length; i++) volume[i] = Math.sqrt(volume[i]);
  const mono = buffer.getChannelData(strongest).slice();
  worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (job !== generation) return;
    if (data.type === 'progress') { $('loading').textContent = `Analyzing sound… ${Math.round(data.progress * 100)}%`; return; }
    worker.terminate(); worker = undefined; setBusy(false);
    if (data.type === 'error') { status(data.message); return; }
    features = data.features; features.source.channels = buffer.numberOfChannels; features.source.timbreChannel = strongest; trajectory = buildRotationTrajectory(features); audioBuffer = buffer; offset = 0; fileName = name;
    $('filename').textContent = name; $('duration').textContent = ` / ${timeLabel(buffer.duration)}`;
    setBusy(false); updateGeometry(true);
    status(`${name} · ${buffer.numberOfChannels} channel(s) · ${Math.round(buffer.sampleRate)} Hz · ${features.times.length} analysis frames. Ready to play.`);
    // Useful inspectable readiness data, contains no source PCM or secrets.
    window.spiralReady = { frames: features.times.length, schema: features.schema };
  };
  worker.onerror = event => { worker?.terminate(); worker = undefined; setBusy(false); status(`Analysis failed: ${event.message}`); };
  worker.postMessage({ mono, volume, rate: buffer.sampleRate }, [mono.buffer, volume.buffer]);
}
$('file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  pause(); setBusy(true); $('loading').textContent = 'Decoding WAV…';
  try {
    if (file.size > 64 * 1024 * 1024) throw new Error('WAV must be smaller than 64 MB.');
    const bytes = await file.arrayBuffer(), header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
    if (header.length !== 12 || String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...header.slice(8, 12)) !== 'WAVE') throw new Error('Select a standard RIFF WAV file.');
    // Decode at the WAV's rate rather than a device-dependent AudioContext rate.
    const view = new DataView(bytes); let sourceRate = 0;
    for (let chunk = 12; chunk + 8 <= bytes.byteLength;) {
      const length = view.getUint32(chunk + 4, true);
      if (chunk + 8 + length > bytes.byteLength) throw new Error('Truncated WAV chunk.');
      if (view.getUint32(chunk, false) === 0x666d7420 && length >= 16) {
        sourceRate = view.getUint32(chunk + 12, true); break;
      }
      chunk += 8 + length + (length % 2);
    }
    if (sourceRate < 8000 || sourceRate > 384000) throw new Error('Unsupported WAV sample rate.');
    const decoder = new OfflineAudioContext(2, 1, sourceRate);
    const buffer = await decoder.decodeAudioData(bytes);
    if (buffer.duration > 120 || buffer.numberOfChannels > 2) throw new Error('Use a mono/stereo WAV up to 120 seconds.');
    analyzeBuffer(buffer, file.name);
  } catch (error) { setBusy(false); status(`Import failed: ${error.message}`); }
  event.target.value = '';
};
function loadDemo() {
  const rate = 24000, pcm = makeDemo(rate), buffer = audioContext().createBuffer(1, pcm.length, rate);
  buffer.copyToChannel(pcm, 0); analyzeBuffer(buffer, 'Evolving harmonic demo');
}
$('demo').onclick = loadDemo;
$('export').onclick = () => {
  if (!features) return;
  const document = { ...features, source: { ...features.source, fileName }, mapping: MAPPING,
    limitations: ['Pitch/timbre use the strongest channel; RMS uses mean stereo energy. No phase or exact stereo image retained.', 'Not an invertible audio encoding.',
      'Spectral analysis limited to 8 kHz; pitch assumes a dominant monophonic fundamental.',
      'Future synthesis must infer missing phase, excitation and residual content.'] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(document)], { type: 'application/json' }));
  const link = window.document.createElement('a'); link.href = url; link.download = 'timbre-space-features.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, .01, 100);
camera.position.set(5, 3.5, 7);
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
catch (error) { status('WebGL is unavailable. Use a browser with hardware acceleration enabled.'); throw error; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x09121c, 0); $('viewport').appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .075; controls.minDistance = 1; controls.maxDistance = 35;
controls.target.set(0, 0, 0);
$('reset').onclick = () => { camera.position.set(5, 3.5, 7); controls.target.set(0, 0, 0); controls.update(); };
const axes = new THREE.AxesHelper(3); axes.visible = false; scene.add(axes);
$('axes').onchange = () => { axes.visible = $('axes').checked; };
scene.add(new THREE.AmbientLight(0xa2e4ef, 1.2));
const light = new THREE.DirectionalLight(0xc3fff1, 3); light.position.set(3, 5, 4); scene.add(light);
const rim = new THREE.DirectionalLight(0xa48afe, 2); rim.position.set(-4, -1, -4); scene.add(rim);
const group = new THREE.Group(); scene.add(group);
let mesh, geometry, resolution = 4096, centers, positions, normals;
const sides = 6;
function configureGeometry() {
  resolution = Number($('resolution').value); $('resolutionValue').textContent = resolution;
  if (mesh) { group.remove(mesh); geometry.dispose(); mesh.material.dispose(); }
  centers = new Float32Array(resolution * 3); positions = new Float32Array(resolution * sides * 3);
  normals = new Float32Array(positions.length);
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  const colors = new Float32Array(positions.length), indices = [];
  const color = new THREE.Color();
  for (let i = 0; i < resolution; i++) {
    color.setHSL(.44 + .25 * i / resolution, .55, .6);
    for (let j = 0; j < sides; j++) {
      const vertex = i * sides + j; colors[vertex * 3] = color.r; colors[vertex * 3 + 1] = color.g; colors[vertex * 3 + 2] = color.b;
      if (i + 1 < resolution) {
        const a = vertex, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides;
        indices.push(a, b, c, b, d, c);
      }
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setIndex(indices);
  mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .25 }));
  mesh.frustumCulled = false; group.add(mesh); updateGeometry(true);
}
$('resolution').oninput = configureGeometry;
let lastGeometryTime = -1;
function updateGeometry(force = false) {
  if (!features || !geometry) return;
  const time = currentTime();
  if (!force && Math.abs(time - lastGeometryTime) < 1 / 30) return;
  lastGeometryTime = time;
  spiralVertices(features, time, resolution, centers);
  const tangent = new THREE.Vector3(), normal = new THREE.Vector3(), binormal = new THREE.Vector3(), up = new THREE.Vector3();
  for (let i = 0; i < resolution; i++) {
    const before = Math.max(0, i - 1) * 3, after = Math.min(resolution - 1, i + 1) * 3;
    tangent.set(centers[after] - centers[before], centers[after + 1] - centers[before + 1], centers[after + 2] - centers[before + 2]).normalize();
    up.set(0, 1, 0); if (Math.abs(tangent.y) > .95) up.set(1, 0, 0);
    normal.crossVectors(tangent, up).normalize(); binormal.crossVectors(tangent, normal).normalize();
    for (let j = 0; j < sides; j++) {
      const angle = 2 * Math.PI * j / sides, c = Math.cos(angle), s = Math.sin(angle), p = (i * sides + j) * 3;
      const nx = normal.x * c + binormal.x * s, ny = normal.y * c + binormal.y * s, nz = normal.z * c + binormal.z * s;
      positions[p] = centers[i * 3] + .006 * nx; positions[p + 1] = centers[i * 3 + 1] + .006 * ny; positions[p + 2] = centers[i * 3 + 2] + .006 * nz;
      normals[p] = nx; normals[p + 1] = ny; normals[p + 2] = nz;
    }
  }
  geometry.attributes.position.needsUpdate = true; geometry.attributes.normal.needsUpdate = true;
}
configureGeometry();
new ResizeObserver(() => {
  const width = $('viewport').clientWidth, height = $('viewport').clientHeight;
  renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
}).observe($('viewport'));
function animate() {
  requestAnimationFrame(animate); controls.update();
  if (features) {
    const time = currentTime(), frame = featuresAt(features, time);
    updateGeometry(); group.scale.setScalar(radiusForRms(frame.rms));
    group.rotation.y = rotationAt(features, trajectory, time) * Number($('direction').value);
    $('current').textContent = timeLabel(time); setWavePosition(audioBuffer.duration ? time / audioBuffer.duration : 0);
    $('centroid').textContent = `${Math.round(frame.centroid)} Hz`;
    $('rms').textContent = `${frame.rms > 1e-6 ? (20 * Math.log10(frame.rms)).toFixed(1) : '−∞'} dB`;
    $('pitch').textContent = frame.f0 ? `${frame.f0.toFixed(1)} Hz` : 'Unvoiced';
  }
  renderer.render(scene, camera);
}
animate(); loadDemo();
