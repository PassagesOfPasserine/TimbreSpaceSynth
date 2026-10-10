# Spherical spiral representation

The explorer uses three audio-derived streams: **timbre → deformation**, **volume → overall scale**, **pitch → rotation speed**. Resolution, camera, axes and direction are presentation controls, not extra sound properties. Color follows position along the curve; it does not encode a fourth audio feature.

## Geometry

For normalized curve position `t ∈ [0,1]`, the undeformed baseline is:

```
θ = πt
φ = 2π · 9t
x = R sin(θ) cos(φ)
y = R cos(θ)
z = R sin(θ) sin(φ)
```

The original mathematical Z-up convention is remapped to Three.js Y-up. This is the same spherical geometry with permuted axes. A continuous centerline is sampled at 512–8192 points and expanded into a six-sided tube mesh, with real depth, surface normals, perspective, and lighting. It is not a pre-rendered image or a flat sprite.

Normalized harmonic amplitudes contribute radial ripples; 24 normalized log-frequency spectral bands contribute polar bends and azimuth twists. The deformation vanishes at the poles. At playback time `τ`, each curve location reads timbre at `max(0, τ − 4(1−t))`: the entire curve retains a four-second timbre history rather than reducing an imported sound to one static spectrum. There is no random deformation.

The object's radius is `4 sqrt(clamp(RMS,0,1))`. RMS uses a centered 40 ms window and mean channel energy. It uses absolute audio amplitude rather than per-file loudness normalization: a quieter copy is visibly smaller. Silence collapses the spiral to zero size.

Angular velocity is `2π · 0.12 · clamp(f₀/440,0,4)` radians/second. Unvoiced frames have zero velocity. A trapezoidal pitch integral provides rotation at any playback time, so pause, resume and seeking do not depend on frame count. Direction is a configurable sign. Camera damping continues while audio is paused.

## Analysis and synchronization

RIFF chunks provide the source sample rate; an OfflineAudioContext decodes at that rate so device output rate does not determine analysis. Original stereo audio is preserved for playback. Pitch and timbre analyze the strongest-energy channel to avoid stereo antiphase cancellation; RMS uses both channels. This dominant-channel choice is a limitation for sounds whose channels have different timbres.

A worker performs windowed-sinc resampling to 16 kHz, a 2048-sample complex Hann-windowed FFT every 320 samples (20 ms), and YIN fundamental estimation over 40–1000 Hz. Its normalized-difference threshold is 0.15. Silence and low-confidence frames explicitly have `f₀=0`. Each frame retains harmonic magnitude and phase, a 24-band envelope, residual-energy estimate, positive spectral-flux transient strength and stereo-width estimate. Magnitudes are normalized independently of RMS. Analysis is limited to 8 kHz.

Web Audio's playback clock, not animation frame counts, drives the features. The mesh updates at up to 30 Hz; the camera and rotation render at display refresh rate. Centered analysis windows avoid causal analysis latency, but smooth rapid transients. Browser decoding, resampling, output-device latency and low-end GPU performance impose practical synchronization limits. A 120-second file may take noticeable analysis time; work occurs off the UI thread.

## Resynthesis

The exported `timbre-space-features/2` model contains timestamps, RMS, f₀/confidence, harmonic magnitudes/phases, spectral envelope, centroid, residual energy, transient strength, stereo width, source metadata, analysis settings and mapping version. Geometry never replaces these streams.

The AudioWorklet maintains phase-continuous partial oscillators, suppresses partials above 48% of sample rate, interpolates adjacent frames, adds seeded filtered residual noise and transient excitation, and applies bounded saturation. Original, Spiral and Mix modes make the difference explicit. Offline export follows the same deterministic model and produces 16-bit stereo RIFF WAV. Region edits change underlying feature arrays and then regenerate both audio and geometry; rendering pixels or vertices are never treated as audio data.

**Neither the feature set nor the spiral perfectly reconstructs the WAV.** Analysis keeps sampled harmonic phase but not complete sample phase, exact stereo image, fine transient waveforms, or frequencies above 8 kHz. Residual synthesis is filtered seeded noise rather than the original residual waveform. Fundamental estimation assumes a dominant monophonic source and can fail or octave-shift on chords, noise, missing fundamentals, and strong vibrato. This is deterministic DSP, not AI.

Determinism holds for identical decoded PCM, analysis version and playback time. The mappings contain no random numbers. Browser decoder differences can cause small numeric differences across platforms. Feature JSON preserves an analysis result for reproducible downstream work.
