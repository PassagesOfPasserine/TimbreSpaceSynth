# Architecture

## JUCE instrument

`PluginProcessor` owns host parameters, MIDI handling, the sixteen-voice pool, keyboard state, global low-pass filter, smoothed master gain, and versioned state serialization. MIDI events execute at their sample offsets. Sustain CC64 and all-notes/all-sound-off are supported. Output is mono or stereo; there is no input bus.

`Engine/SampleVoice.h` owns immutable sample data and per-note playback state. Note-on snapshots a sample bank, resets positions and ADSR, and computes sample-rate/pitch increments. Each voice sums interpolated sample values with the geometry-derived weights, or uses a sine when its bank is empty. Stereo samples retain both channels; mono samples are duplicated to stereo. Mono output averages the channels. Voice allocation uses the first free slot and steals slot zero when full; a production stealing/click-suppression policy is future work.

`Engine/Morphing.h` defines a replaceable `MorphBackend` contract and explicitly named `SampleBlend` baseline. This contract only supplies mix weights. A future learned backend will need an additional latent-representation decoder/render contract; mix weights alone are not an AI synthesis architecture. It should integrate at the voice/source layer, leaving MIDI, envelopes, host parameters and UI independent.

WAV decoding and allocations happen during import, not inside rendering. Atomic immutable-bank publication lets voices retain older sounds. Retired banks are reclaimed on the message thread when unreferenced, avoiding large sample-buffer destruction during note rendering. Standard-library atomic shared pointers are not guaranteed lock-free; this foundation needs real-device latency/profiling before a hard real-time guarantee. State loading is a host lifecycle operation and is not intended to run within `processBlock`.

Host state embeds little-endian PCM floats with a magic/version header, bounds checks and rejection of non-finite values. Restore is transactional: malformed input preserves the previous state. Parameters are host-automatable. Envelope settings are captured at note-on; cutoff and master are smoothed while playing. Cursor mix weights update at block boundaries.

`PluginEditor` owns the resizable rounded panel layout, host-attached controls, draggable points/cursor, waveform wireframe terrain, asynchronous native file chooser and MIDI keyboard. The terrain derives from the selected sample's PCM, but it is a 2D perspective drawing. The companion explorer below provides the true interactive 3D visualization.

## Spherical spiral companion

- `analysis.js`: standalone pure DSP, versioned feature schema, interpolation and deterministic demo generator.
- `analysis-worker.js`: off-main-thread analysis and progress/errors.
- `geometry.js`: renderer-independent spherical mappings and seekable pitch integral.
- `main.js`: Three.js tube mesh, OrbitControls, Web Audio transport, WAV decoding, feature export and UI bindings.
- `style.css` / `index.html`: responsive dark workspace and accessible labeled controls.

Feature storage is independent of mesh resolution and camera state. Changing resolution does not rerun audio analysis. Playback uses original decoded audio; it does not reconstruct sound from the visualization. See [mathematics](SPIRAL.md) for equations and limitations.
