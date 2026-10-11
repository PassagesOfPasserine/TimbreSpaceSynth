# Architecture

## JUCE instrument

`PluginProcessor` owns host parameters, MIDI handling, the sixteen-voice pool, keyboard state, global low-pass filter, smoothed master gain, and versioned state serialization. MIDI events execute at their sample offsets. Sustain CC64 and all-notes/all-sound-off are supported. Output is mono or stereo; there is no input bus.

`Engine/SampleVoice.h` owns immutable sample data and per-note playback state. Note-on snapshots a sample bank, resets positions, additive phases and ADSR, and computes sample-rate/pitch increments. Each empty-bank voice performs eight-partial additive synthesis; host parameters control each harmonic and stereo width introduces matching left/right phase spread. A loaded voice instead sums interpolated sample values with geometry-derived weights. Stereo samples retain both channels; mono samples are duplicated to stereo. Mono output averages the channels. Voice allocation uses the first free slot and steals slot zero when full; a production stealing/click-suppression policy is future work.

`Engine/Morphing.h` defines a replaceable `MorphBackend` contract and explicitly named `SampleBlend` baseline. This contract only supplies mix weights. A future learned backend will need an additional latent-representation decoder/render contract; mix weights alone are not an AI synthesis architecture. It should integrate at the voice/source layer, leaving MIDI, envelopes, host parameters and UI independent.

`Engine/SpiralResynth.h` supplies the native feature-frame model, deterministic PCM analysis and a phase-continuous, Nyquist-bounded harmonic/residual/transient oscillator. It performs no allocation during `tick()`. This portable C++ core is tested independently and is the integration boundary for the next JUCE voice/UI stage; the released native plugin still exposes its established sampler workflow.

WAV decoding and allocations happen during import, not inside rendering. Atomic immutable-bank publication lets voices retain older sounds. Retired banks are reclaimed on the message thread when unreferenced, avoiding large sample-buffer destruction during note rendering. Standard-library atomic shared pointers are not guaranteed lock-free; this foundation needs real-device latency/profiling before a hard real-time guarantee. State loading is a host lifecycle operation and is not intended to run within `processBlock`.

Host state embeds little-endian PCM floats with a magic/version header, bounds checks and rejection of non-finite values. Restore is transactional: malformed input preserves the previous state. Parameters are host-automatable. Envelope settings are captured at note-on; cutoff and master are smoothed while playing. Cursor mix weights update at block boundaries.

`PluginEditor` owns the resizable rounded panel layout, host-attached controls, draggable points/cursor, waveform wireframe terrain, asynchronous native file chooser and MIDI keyboard. The terrain derives from the selected sample's PCM, but it is a 2D perspective drawing. The companion explorer below provides the true interactive 3D visualization.

## Spherical spiral companion

- `analysis.js`: standalone pure DSP, versioned feature schema, interpolation and deterministic demo generator.
- `analysis-worker.js`: off-main-thread analysis and progress/errors.
- `sound-model.js`: validation, immutable region edits, smoothing, cloning and A/B feature morphing.
- `resynthesis.js`: deterministic offline harmonic/residual/transient rendering and WAV encoding.
- `spiral-worklet.js`: real-time phase-continuous spherical feature resynthesis plus a twelve-voice additive MIDI engine with ADSR and stereo phase spread.
- `geometry.js`: renderer-independent spherical mappings and seekable pitch integral.
- `main.js`: Spiral A/B state, Three.js editor, direct brush/twist editing, Web MIDI/on-screen keyboard, parameter-to-geometry mappings, AudioWorklet/original/mix transport, undo/redo, import/export and UI bindings.
- `style.css` / `index.html`: responsive dark workspace and accessible labeled controls.

Feature storage is independent of mesh resolution and camera state. Changing resolution does not rerun audio analysis. Original playback uses decoded audio; Spiral playback resynthesizes from feature frames. See [mathematics](SPIRAL.md) for equations and limitations.

In playable mode, the renderer and worklet receive the same harmonic vector. Harmonics above the fundamental create deterministic radial deformation. The envelope meter controls mesh draw range (active arc length), stereo width controls tube radius and partial phase spread, and the current MIDI note controls oscillator frequency plus a deliberately slowed visual rotation. Audio processing never depends on the Three.js frame rate.
