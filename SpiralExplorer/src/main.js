import './style.css';
import './shape-synth.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { featuresAt, makeDemo } from './analysis.js';
import { MAPPING, spiralVertices, radiusForRms, buildRotationTrajectory, rotationAt } from './geometry.js';
import { cloneModel, editRegion, smoothRegion, validateModel } from './sound-model.js';
import { renderModel, encodeWav } from './resynthesis.js';

const $ = id => document.getElementById(id);
const status = message => { $('status').textContent = message; };
const slots = [emptySlot('Spiral A'), emptySlot('Spiral B')];
function emptySlot(name) { return { name, model: null, originalModel: null, buffer: null, trajectory: null, undo: [], redo: [] }; }
let activeSlot = 0, context, synthNode, synthGain, originalSource, originalGain, worker;
let playing = false, offset = 0, startedAt = 0, generation = 0, mode = 'spiral', currentTool = 'select', playDirection = 1;
let playableSynth = false, envelopeLevel = 0, visualNote = 69;
const synthState = { harmonics: Array.from({ length: 16 }, (_, i) => i === 0 ? 1 : 0), phases: Array(16).fill(0) };

function slot() { return slots[activeSlot]; }
function currentDuration() { return slot().model?.source.duration || slot().buffer?.duration || 0; }
function currentTime() { return Math.max(0, Math.min(currentDuration(), playing && context ? offset + (context.currentTime - startedAt) * playDirection : offset)); }
function audioContext() { return context ??= new AudioContext(); }
async function ensureSynth() {
  const audio = audioContext();
  if (synthNode) return;
  if (!audio.audioWorklet) throw new Error('AudioWorklet is unavailable in this browser. Original playback is still available.');
  await audio.audioWorklet.addModule(new URL('./spiral-worklet.js', import.meta.url));
  synthNode = new AudioWorkletNode(audio, 'spiral-processor', { outputChannelCount: [2] });
  synthGain = audio.createGain(); synthNode.connect(synthGain).connect(audio.destination);
  synthNode.port.onmessage = ({ data }) => { if (data.type === 'meter') envelopeLevel = data.envelope; };
  syncSynthModels(); updateSynthParams();
}
function syncSynthModels() {
  if (!synthNode) return;
  slots.forEach((entry, index) => { if (entry.model) synthNode.port.postMessage({ type: 'load', slot: index, model: entry.model }); });
}
function synthParams() {
  return { morph: Number($('morph').value), harmonics: Number($('harmonics').value), residual: Number($('residualAmount').value),
    transient: Number($('transientAmount').value), pitch: 2 ** (Number($('pitchScale').value) / 12),
    traversal: $('traversal').value, level: mode === 'mix' ? .55 : .8 };
}
function updateSynthParams() { if (synthNode) synthNode.port.postMessage({ type: 'params', params: synthParams() }); }
function playableParams() { return { enabled: playableSynth, harmonics: synthState.harmonics, phases: synthState.phases,
  attack: Number($('attack').value), decay: Number($('decay').value), sustain: Number($('sustain').value), release: Number($('release').value),
  width: Number($('stereoWidth').value), master: Number($('synthMaster').value), tuning: 440 }; }
function updatePlayableParams() { synthNode?.port.postMessage({ type: 'synth', params: playableParams() }); updateGeometry(true); }
function stopSources() {
  if (originalSource) { originalSource.onended = null; try { originalSource.stop(); } catch {} originalSource.disconnect(); originalSource = null; }
  synthNode?.port.postMessage({ type: 'stop' });
}
function setWavePosition(value) {
  const position = Math.max(0, Math.min(1, Number(value) || 0));
  $('seek').value = position; $('positionDial').style.setProperty('--position', position);
  $('seek').setAttribute('aria-valuetext', `${Math.round(position * 100)}%`);
}
function pause() {
  offset = currentTime(); playing = false; stopSources(); setWavePosition(currentDuration() ? offset / currentDuration() : 0);
  $('play').textContent = '▶︎'; $('play').setAttribute('aria-label', 'Play');
}
async function play() {
  if (!slot().model) return;
  const audio = audioContext(); await audio.resume();
  if (offset >= currentDuration()) offset = 0;
  playDirection = mode === 'spiral' ? Number($('direction').value) : 1;
  if (playDirection < 0 && offset <= 0) offset = currentDuration();
  stopSources();
  if (mode !== 'original') {
    await ensureSynth(); updateSynthParams(); syncSynthModels();
    synthGain.gain.value = mode === 'mix' ? .7 : 1;
    synthNode.port.postMessage({ type: 'play', offset, direction: playDirection });
  }
  if (mode !== 'spiral' && slot().buffer) {
    originalSource = audio.createBufferSource(); originalSource.buffer = slot().buffer;
    originalGain = audio.createGain(); originalGain.gain.value = mode === 'mix' ? .55 : 1;
    originalSource.connect(originalGain).connect(audio.destination); originalSource.start(0, offset);
  }
  startedAt = audio.currentTime; playing = true; $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Pause');
}
$('play').onclick = () => { if (playing) pause(); else play().catch(error => status(error.message)); };
$('seek').oninput = async () => {
  const wasPlaying = playing; pause(); offset = Number($('seek').value) * currentDuration();
  synthNode?.port.postMessage({ type: 'seek', time: offset }); updateGeometry(true); if (wasPlaying) await play();
};
function timeLabel(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function setBusy(busy) {
  $('loading').hidden = !busy; $('file').disabled = busy; $('demo').disabled = busy;
  for (const id of ['play', 'seek', 'export', 'exportAudio', 'applyEdit', 'smoothEdit', 'resetEdits']) $(id).disabled = busy || !slot().model;
}

function analyzeBuffer(buffer, name, target = Number($('importTarget').value)) {
  pause(); const job = ++generation; worker?.terminate(); setBusy(true); $('loading').textContent = 'Analyzing sound…';
  const volume = new Float32Array(buffer.length), width = new Float32Array(buffer.length); let strongest = 0, strongestEnergy = -1;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const pcm = buffer.getChannelData(ch); let energy = 0;
    for (let i = 0; i < volume.length; i++) { volume[i] += pcm[i] ** 2 / buffer.numberOfChannels; energy += pcm[i] ** 2; }
    if (energy > strongestEnergy) { strongest = ch; strongestEnergy = energy; }
  }
  for (let i = 0; i < volume.length; i++) volume[i] = Math.sqrt(volume[i]);
  if (buffer.numberOfChannels > 1) {
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    for (let i = 0; i < width.length; i++) width[i] = Math.abs(left[i] - right[i]) / (Math.abs(left[i]) + Math.abs(right[i]) + 1e-6);
  }
  const mono = buffer.getChannelData(strongest).slice();
  worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (job !== generation) return;
    if (data.type === 'progress') { $('loading').textContent = `Analyzing sound… ${Math.round(data.progress * 100)}%`; return; }
    worker.terminate(); worker = null;
    if (data.type === 'error') { setBusy(false); status(data.message); return; }
    const model = validateModel(data.features); model.source.channels = buffer.numberOfChannels; model.source.timbreChannel = strongest;
    Object.assign(slots[target], { name, model, originalModel: cloneModel(model), buffer, trajectory: buildRotationTrajectory(model), undo: [], redo: [] });
    activeSlot = target; offset = 0; syncSynthModels(); refreshUI(); setBusy(false);
    status(`${name} · ${model.times.length} feature frames · spherical resynthesis ready.`);
    window.spiralReady = { frames: model.times.length, schema: model.schema, resynthesis: true };
  };
  worker.onerror = event => { worker?.terminate(); worker = null; setBusy(false); status(`Analysis failed: ${event.message}`); };
  worker.postMessage({ mono, volume, width, rate: buffer.sampleRate, quality: $('quality').value }, [mono.buffer, volume.buffer, width.buffer]);
}

async function decodeWav(file) {
  if (file.size > 64 * 1024 * 1024) throw new Error('WAV must be smaller than 64 MB.');
  const bytes = await file.arrayBuffer(), header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
  if (header.length !== 12 || String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...header.slice(8, 12)) !== 'WAVE') throw new Error('Select a standard RIFF WAV file.');
  const view = new DataView(bytes); let sourceRate = 0;
  for (let chunk = 12; chunk + 8 <= bytes.byteLength;) {
    const length = view.getUint32(chunk + 4, true); if (chunk + 8 + length > bytes.byteLength) throw new Error('Truncated WAV chunk.');
    if (view.getUint32(chunk, false) === 0x666d7420 && length >= 16) { sourceRate = view.getUint32(chunk + 12, true); break; }
    chunk += 8 + length + (length % 2);
  }
  if (sourceRate < 8000 || sourceRate > 384000) throw new Error('Unsupported WAV sample rate.');
  const decoder = new OfflineAudioContext(2, 1, sourceRate), buffer = await decoder.decodeAudioData(bytes);
  if (buffer.duration > 120 || buffer.numberOfChannels > 2) throw new Error('Use a mono/stereo WAV up to 120 seconds.');
  return buffer;
}
$('file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  pause(); setBusy(true); $('loading').textContent = 'Decoding WAV…';
  try { analyzeBuffer(await decodeWav(file), file.name); } catch (error) { setBusy(false); status(`Import failed: ${error.message}`); }
  event.target.value = '';
};
function loadDemo() {
  const rate = 24000, pcm = makeDemo(rate), buffer = audioContext().createBuffer(1, pcm.length, rate);
  buffer.copyToChannel(pcm, 0); analyzeBuffer(buffer, 'Evolving harmonic demo', 0);
}
$('demo').onclick = loadDemo;

function download(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type })), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').onclick = () => slot().model && download(JSON.stringify({ ...slot().model, mapping: MAPPING,
  limitations: ['Lossy deterministic feature model.', 'No exact phase, stereo image, or perfect reconstruction guarantee.', 'This is DSP resynthesis, not AI.'] }), 'application/json', 'timbre-space-model.json');
$('exportAudio').onclick = () => {
  if (!slot().model) return; status('Rendering spiral resynthesis…');
  setTimeout(() => { const rendered = renderModel(slot().model, 44100, { harmonicAmount: Number($('harmonics').value), residualAmount: Number($('residualAmount').value), transientAmount: Number($('transientAmount').value), pitchScale: 2 ** (Number($('pitchScale').value) / 12) });
    download(encodeWav(rendered), 'audio/wav', 'timbre-space-resynthesis.wav'); status('Rendered WAV locally.'); }, 0);
};
$('importFeatures').onclick = () => $('featureFile').click();
$('featureFile').onchange = async event => {
  try {
    const model = validateModel(JSON.parse(await event.target.files[0].text())), target = Number($('importTarget').value);
    Object.assign(slots[target], { name: event.target.files[0].name, model, originalModel: cloneModel(model), trajectory: buildRotationTrajectory(model), undo: [], redo: [] });
    activeSlot = target; pause(); offset = 0; syncSynthModels(); refreshUI(); status('Imported spherical sound model.');
  } catch (error) { status(`Model import failed: ${error.message}`); }
  event.target.value = '';
};

function rememberEdit(next) { const entry = slot(); entry.undo.push(entry.model); if (entry.undo.length > 32) entry.undo.shift(); entry.model = next; entry.redo = []; entry.trajectory = buildRotationTrajectory(next); syncSynthModels(); refreshUI(); }
function selectedRegion() { return [Number($('regionStart').value), Number($('regionEnd').value)].sort(); }
$('applyEdit').onclick = () => { const [start, end] = selectedRegion(); rememberEdit(editRegion(slot().model, start, end, { harmonics: Number($('editHarmonics').value), twist: Number($('editTwist').value), radius: Number($('editRadius').value) })); status('Applied feature edit to selected spiral region.'); };
$('smoothEdit').onclick = () => { const [start, end] = selectedRegion(); rememberEdit(smoothRegion(slot().model, start, end)); status('Smoothed selected feature frames.'); };
$('resetEdits').onclick = () => rememberEdit(cloneModel(slot().originalModel));
$('undo').onclick = () => { const entry = slot(); if (!entry.undo.length) return; entry.redo.push(entry.model); entry.model = entry.undo.pop(); entry.trajectory = buildRotationTrajectory(entry.model); syncSynthModels(); refreshUI(); };
$('redo').onclick = () => { const entry = slot(); if (!entry.redo.length) return; entry.undo.push(entry.model); entry.model = entry.redo.pop(); entry.trajectory = buildRotationTrajectory(entry.model); syncSynthModels(); refreshUI(); };

document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => { mode = button.dataset.mode; document.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('active', item === button)); updateSynthParams(); status(`${button.textContent} playback selected.`); });
document.querySelectorAll('[data-panel]').forEach(button => button.onclick = () => {
  document.querySelectorAll('[data-panel]').forEach(item => item.classList.toggle('active', item === button));
  if (button.dataset.panel === 'synth') { $('synthMode').click(); }
  else if (button.dataset.panel === 'spiral-a' || button.dataset.panel === 'spiral-b') { if (playableSynth) $('synthMode').click(); pause(); activeSlot = button.dataset.panel === 'spiral-a' ? 0 : 1; offset = 0; refreshUI(); }
  else status(`${button.textContent.trim()} panel is part of the modular signal path; the working vertical slice focuses on Spiral A/B.`);
});
document.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => { currentTool = button.dataset.tool; document.querySelectorAll('[data-tool]').forEach(item => item.classList.toggle('active', item === button)); if (currentTool === 'smooth' && slot().model) $('smoothEdit').click(); });
for (const [id, output, format] of [['morph','morphValue',v=>`${v*100|0}%`],['harmonics','harmonicsValue',v=>`${v*100|0}%`],['residualAmount','residualValue',v=>`${v*100|0}%`],['transientAmount','transientValue',v=>`${v*100|0}%`],['pitchScale','pitchScaleValue',v=>`${v} st`],['editHarmonics','editHarmonicsValue',v=>`${v*100|0}%`],['editTwist','editTwistValue',v=>`${Math.round(v*180/Math.PI)}°`],['editRadius','editRadiusValue',v=>`${v*100|0}%`]]) {
  $(id).oninput = () => { $(output).value = format(Number($(id).value)); updateSynthParams(); };
}
$('traversal').onchange = updateSynthParams;

const presets = {
  sine: [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  warm: [1,.48,.26,.13,.08,.05,.03,.02,.01,0,0,0,0,0,0,0],
  bright: [1,.72,.55,.44,.34,.28,.22,.18,.14,.1,.08,.06,.04,.03,.02,.01],
  hollow: [1,0,.48,0,.27,0,.16,0,.1,0,.06,0,.04,0,.02,0],
};
function rebuildHarmonicEditor() {
  $('harmonicEditor').replaceChildren(...synthState.harmonics.map((value, index) => {
    const label = document.createElement('label'); label.title = `Harmonic ${index + 1}: ${Math.round(value * 100)}%`;
    const input = document.createElement('input'); input.type = 'range'; input.min = 0; input.max = 1; input.step = .01; input.value = value;
    input.setAttribute('aria-label', `Harmonic ${index + 1}`); input.oninput = () => { synthState.harmonics[index] = Number(input.value); label.title = `Harmonic ${index + 1}: ${Math.round(input.value * 100)}%`; updatePlayableParams(); };
    const number = document.createElement('span'); number.textContent = index + 1; label.append(input, number); return label;
  }));
}
function loadPreset(name) {
  const saved=name==='user'&&localStorage.getItem('shape-of-sound-preset')?JSON.parse(localStorage.getItem('shape-of-sound-preset')):null;
  synthState.harmonics=[...(saved?.harmonics||presets[name])];synthState.phases=[...(saved?.phases||Array(16).fill(0))];
  if(saved)for(const key of ['attack','decay','sustain','release'])$(key).value=saved[key];
  if(saved){$('stereoWidth').value=saved.width;$('synthMaster').value=saved.master;}
  rebuildHarmonicEditor();updatePlayableParams();status(`${$('preset').selectedOptions[0].textContent} timbre loaded.`);
}
$('preset').onchange = () => loadPreset($('preset').value);
$('savePreset').onclick = () => { localStorage.setItem('shape-of-sound-preset', JSON.stringify({ ...playableParams(), name: 'User Spiral' })); $('preset').querySelector('[value="user"]').disabled=false; $('preset').value='user'; status('Preset saved in this browser and available as User preset.'); };
$('synthMode').onclick = async () => { playableSynth = !playableSynth; await ensureSynth(); pause(); synthNode.port.postMessage({ type: 'panic' }); updatePlayableParams(); $('synthMode').textContent = playableSynth ? 'Playable synth on' : 'Enable playable synth'; $('synthMode').classList.toggle('active', playableSynth); status(playableSynth ? 'Playable additive spiral enabled. Use the keyboard or connect MIDI.' : 'Spherical resynthesis mode enabled.'); };
for (const [id, output, format] of [['stereoWidth','widthValue',v=>`${Math.round(v*100)}%`],['synthMaster','masterValue',v=>`${Math.round(v*100)}%`],['attack','attackValue',v=>`${Math.round(v*1000)} ms`],['decay','decayValue',v=>`${Math.round(v*1000)} ms`],['sustain','sustainValue',v=>`${Math.round(v*100)}%`],['release','releaseValue',v=>`${Math.round(v*1000)} ms`]]) {
  $(id).oninput = () => { $(output).value = format(Number($(id).value)); updatePlayableParams(); };
}
const keyboardNotes = [60,62,64,65,67,69,71,72,74,76,77,79,81], keyboardMap = { a:60,s:62,d:64,f:65,g:67,h:69,j:71,k:72 };
function noteOn(note, velocity=.8) { if (!playableSynth) $('synthMode').click(); ensureSynth().then(() => { visualNote = note; synthNode.port.postMessage({ type:'noteOn', note, velocity }); }); document.querySelector(`[data-note="${note}"]`)?.classList.add('down'); }
function noteOff(note) { synthNode?.port.postMessage({ type:'noteOff', note }); document.querySelector(`[data-note="${note}"]`)?.classList.remove('down'); }
for (const note of keyboardNotes) { const key=document.createElement('button'); key.dataset.note=note; key.className='key'; key.textContent=['C','D','E','F','G','A','B'][[0,2,4,5,7,9,11].indexOf(note%12)] || '•'; key.onpointerdown=e=>{e.preventDefault();key.setPointerCapture(e.pointerId);noteOn(note)}; key.onpointerup=()=>noteOff(note); key.onpointercancel=()=>noteOff(note); $('keyboard').append(key); }
const heldKeys = new Set(); window.addEventListener('keydown', event => { const note=keyboardMap[event.key.toLowerCase()]; if (note != null && !heldKeys.has(event.key)) { heldKeys.add(event.key); noteOn(note); } });
window.addEventListener('keyup', event => { const note=keyboardMap[event.key.toLowerCase()]; if (note != null) { heldKeys.delete(event.key); noteOff(note); } });
$('midiAccess').onclick = async () => { if (!navigator.requestMIDIAccess) return status('Web MIDI is unavailable in this browser.'); try { const access=await navigator.requestMIDIAccess(); for (const input of access.inputs.values()) input.onmidimessage=event=>{const [command,note,velocity]=event.data;if((command&0xf0)===0x90&&velocity)noteOn(note,velocity/127);else if((command&0xf0)===0x80||((command&0xf0)===0x90&&!velocity))noteOff(note)}; status(`Connected ${access.inputs.size} MIDI input${access.inputs.size===1?'':'s'}.`); } catch(error) { status(`MIDI access failed: ${error.message}`); } };
rebuildHarmonicEditor();
if(localStorage.getItem('shape-of-sound-preset'))$('preset').querySelector('[value="user"]').disabled=false;

const scene = new THREE.Scene(), perspective = new THREE.PerspectiveCamera(42, 1, .01, 100), orthographic = new THREE.OrthographicCamera(-5, 5, 5, -5, .01, 100);
perspective.position.set(5, 3.5, 7); orthographic.position.copy(perspective.position); let camera = perspective;
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (error) { status('WebGL is unavailable.'); throw error; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x09121c, 0); $('viewport').appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .075; controls.minDistance = 1; controls.maxDistance = 35;
$('reset').onclick = () => { camera.position.set(5, 3.5, 7); controls.target.set(0, 0, 0); controls.update(); };
$('projection').onclick = () => { camera = camera === perspective ? orthographic : perspective; camera.position.copy(controls.object.position); controls.object = camera; $('projection').textContent = camera === perspective ? 'Orthographic' : 'Perspective'; resize(); };
const axes = new THREE.AxesHelper(3); axes.visible = false; scene.add(axes); $('axes').onchange = () => { axes.visible = $('axes').checked; };
scene.add(new THREE.AmbientLight(0xa2e4ef, 1.2)); const light = new THREE.DirectionalLight(0xc3fff1, 3); light.position.set(3, 5, 4); scene.add(light); const rim = new THREE.DirectionalLight(0xa48afe, 2); rim.position.set(-4, -1, -4); scene.add(rim);
const boundary = new THREE.Mesh(new THREE.SphereGeometry(4, 32, 20), new THREE.MeshBasicMaterial({ color:0x315064, wireframe:true, transparent:true, opacity:.13 })); scene.add(boundary);
const group = new THREE.Group(); scene.add(group); let mesh, geometry, resolution = 4096, centers, positions, normals, colors; const sides = 6;
function configureGeometry() {
  resolution = Number($('resolution').value); $('resolutionValue').value = resolution;
  if (mesh) { group.remove(mesh); geometry.dispose(); mesh.material.dispose(); }
  centers = new Float32Array(resolution * 3); positions = new Float32Array(resolution * sides * 3); normals = new Float32Array(positions.length); colors = new Float32Array(positions.length);
  geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)); geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const indices = []; for (let i = 0; i + 1 < resolution; i++) for (let j = 0; j < sides; j++) { const a = i*sides+j, b=i*sides+(j+1)%sides, c=a+sides, d=b+sides; indices.push(a,b,c,b,d,c); }
  geometry.setIndex(indices); mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .34, metalness: .24 })); mesh.frustumCulled = false; group.add(mesh); updateGeometry(true);
}
$('resolution').oninput = configureGeometry; $('overlay').onchange = () => updateColors();
function updateColors() {
  if (!slot().model || !colors) return; const color = new THREE.Color(), overlay = $('overlay').value;
  for (let i = 0; i < resolution; i++) {
    const frame = featuresAt(slot().model, i / (resolution - 1) * slot().model.source.duration); let value = i / resolution;
    if (overlay === 'pitch') value = Math.min(1, frame.f0 / 1000); if (overlay === 'volume') value = Math.min(1, frame.rms * 3); if (overlay === 'residual') value = frame.residual; if (overlay === 'transient') value = frame.transient;
    color.setHSL(.48 + .32 * value, .68, .52 + .18 * value); for (let j = 0; j < sides; j++) { const p=(i*sides+j)*3; colors[p]=color.r; colors[p+1]=color.g; colors[p+2]=color.b; }
  }
  geometry.attributes.color.needsUpdate = true;
}
let lastGeometryTime = -1;
function updateGeometry(force = false) {
  if (!slot().model || !geometry) return; const time = currentTime(); if (!force && Math.abs(time-lastGeometryTime)<1/30) return; lastGeometryTime=time;
  spiralVertices(slot().model,time,resolution,centers);
  if(playableSynth) for(let i=0;i<resolution;i++){const u=i/(resolution-1),theta=Math.PI*u,phi=2*Math.PI*MAPPING.turns*u;let deformation=0;for(let h=1;h<synthState.harmonics.length;h++)deformation+=synthState.harmonics[h]*Math.sin((h+1)*phi+synthState.phases[h])/(h+1);const scale=4*(1+.42*deformation*Math.sin(theta));centers[i*3]*=scale;centers[i*3+1]*=scale;centers[i*3+2]*=scale;}
  const thickness=playableSynth ? .004+.026*Number($('stereoWidth').value) : .007, tangent=new THREE.Vector3(),normal=new THREE.Vector3(),binormal=new THREE.Vector3(),up=new THREE.Vector3();
  for(let i=0;i<resolution;i++){const before=Math.max(0,i-1)*3,after=Math.min(resolution-1,i+1)*3;tangent.set(centers[after]-centers[before],centers[after+1]-centers[before+1],centers[after+2]-centers[before+2]).normalize();up.set(0,1,0);if(Math.abs(tangent.y)>.95)up.set(1,0,0);normal.crossVectors(tangent,up).normalize();binormal.crossVectors(tangent,normal).normalize();for(let j=0;j<sides;j++){const angle=2*Math.PI*j/sides,c=Math.cos(angle),s=Math.sin(angle),p=(i*sides+j)*3,nx=normal.x*c+binormal.x*s,ny=normal.y*c+binormal.y*s,nz=normal.z*c+binormal.z*s;positions[p]=centers[i*3]+thickness*nx;positions[p+1]=centers[i*3+1]+thickness*ny;positions[p+2]=centers[i*3+2]+thickness*nz;normals[p]=nx;normals[p+1]=ny;normals[p+2]=nz;}}
  geometry.setDrawRange(0,Math.max(0,Math.floor((resolution-1)*(playableSynth?envelopeLevel:1))*sides*6));
  geometry.attributes.position.needsUpdate=true;geometry.attributes.normal.needsUpdate=true;
}
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
renderer.domElement.addEventListener('dblclick', event => { if (!mesh || !slot().model) return; const box=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,-((event.clientY-box.top)/box.height)*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(mesh)[0];if(hit){const index=Math.floor((hit.face.a/sides)/(resolution-1)*1000)/1000;$('seek').value=index;$('seek').dispatchEvent(new Event('input'));} });
let directEdit = null;
renderer.domElement.addEventListener('pointerdown', event => {
  if (!['brush','twist'].includes(currentTool) || !mesh || !slot().model) return;
  const box=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,-((event.clientY-box.top)/box.height)*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(mesh)[0];if(!hit)return;
  const center=(hit.face.a/sides)/(resolution-1), entry=slot(); directEdit={ y:event.clientY, center, base:entry.model, tool:currentTool }; entry.undo.push(entry.model); entry.redo=[]; controls.enabled=false; renderer.domElement.setPointerCapture(event.pointerId); event.preventDefault();
});
renderer.domElement.addEventListener('pointermove', event => {
  if(!directEdit)return; const amount=Math.max(-1,Math.min(1,(directEdit.y-event.clientY)/120)), start=Math.max(0,directEdit.center-.04), end=Math.min(1,directEdit.center+.04);
  slot().model=editRegion(directEdit.base,start,end,directEdit.tool==='brush'?{harmonics:1+amount*.85}:{twist:amount*Math.PI});slot().trajectory=buildRotationTrajectory(slot().model);syncSynthModels();updateGeometry(true);status(`Direct ${directEdit.tool} edit · ${Math.round(directEdit.center*100)}% along spiral`);
});
renderer.domElement.addEventListener('pointerup', event => { if(!directEdit)return;directEdit=null;controls.enabled=true;try{renderer.domElement.releasePointerCapture(event.pointerId)}catch{}refreshUI(); });
function resize(){const width=$('viewport').clientWidth,height=$('viewport').clientHeight;renderer.setSize(width,height);perspective.aspect=width/height;perspective.updateProjectionMatrix();const aspect=width/height;orthographic.left=-4*aspect;orthographic.right=4*aspect;orthographic.top=4;orthographic.bottom=-4;orthographic.updateProjectionMatrix();}
new ResizeObserver(resize).observe($('viewport'));
function refreshUI() {
  const entry=slot(), ready=!!entry.model;$('activeSource').textContent=`SPIRAL ${activeSlot?'B':'A'}`;$('filename').textContent=entry.name;$('frameCount').textContent=ready?`${entry.model.times.length} FRAMES`:'— FRAMES';$('duration').textContent=` / ${timeLabel(currentDuration())}`;$('undo').disabled=!entry.undo.length;$('redo').disabled=!entry.redo.length;setBusy(false);updateColors();updateGeometry(true);
  document.querySelectorAll('[data-panel]').forEach((button,index)=>button.classList.toggle('active',index===activeSlot));
}
function animate(){requestAnimationFrame(animate);controls.update();if(slot().model){const time=currentTime(),frame=featuresAt(slot().model,time);if(playing&&((playDirection>0&&time>=currentDuration())||(playDirection<0&&time<=0))){playing=false;stopSources();$('play').textContent='▶︎';}updateGeometry();if(playableSynth&&geometry)geometry.setDrawRange(0,Math.max(0,Math.floor((resolution-1)*envelopeLevel)*sides*6));group.scale.setScalar(playableSynth?1:radiusForRms(frame.rms));group.rotation.y=playableSynth?performance.now()/1000*(440*2**((visualNote-69)/12))/35:rotationAt(slot().model,slot().trajectory,time)*Number($('direction').value);$('current').textContent=timeLabel(time);setWavePosition(currentDuration()?time/currentDuration():0);$('centroid').textContent=`${Math.round(frame.centroid)} Hz`;$('rms').textContent=playableSynth?`${Math.round(envelopeLevel*100)}% length`:`${frame.rms>1e-6?(20*Math.log10(frame.rms)).toFixed(1):'−∞'} dB`;$('pitch').textContent=playableSynth?`${(440*2**((visualNote-69)/12)).toFixed(1)} Hz`:frame.f0?`${frame.f0.toFixed(1)} Hz`:'Unvoiced';$('residualMeter').textContent=playableSynth?`${Math.round(Number($('stereoWidth').value)*100)}% width`:`${Math.round(frame.residual*100)}%`;}renderer.render(scene,camera);}
configureGeometry();animate();loadDemo();
