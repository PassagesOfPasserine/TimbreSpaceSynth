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

A worker performs windowed-sinc resampling to 16 kHz, a 2048-sample Hann-windowed FFT every 320 samples (20 ms), and YIN fundamental estimation over 40–1000 Hz. Its normalized-difference threshold is 0.15. Silence and low-confidence frames explicitly have `f₀=0`. Harmonic magnitudes are sampled around integer multiples of estimated f₀; the spectral envelope is always retained, including unvoiced audio. Magnitude vectors are normalized independently of RMS. The analysis spectrum is limited to 8 kHz.

Web Audio's playback clock, not animation frame counts, drives the features. The mesh updates at up to 30 Hz; the camera and rotation render at display refresh rate. Centered analysis windows avoid causal analysis latency, but smooth rapid transients. Browser decoding, resampling, output-device latency and low-end GPU performance impose practical synchronization limits. A 120-second file may take noticeable analysis time; work occurs off the UI thread.

## Future reconstruction

The exported `timbre-space-features/1` JSON contains timestamps, RMS, f₀/confidence, normalized harmonic magnitudes, spectral envelope, spectral centroid (a timbre diagnostic), source metadata, analysis settings and mapping version. Geometry never replaces these streams. They can be inputs to a future additive, source-filter, or learned synthesis backend.

**Neither the feature set nor the spiral perfectly reconstructs the WAV.** Phase, exact stereo image, fine transients, stochastic excitation, and frequencies above the analysis limit are not encoded. Fundamental estimation assumes a dominant monophonic pitched source and can fail or octave-shift on chords, noisy audio, missing fundamentals, and strong vibrato. A future reconstruction engine must model missing information and measure reconstruction error; no inverse or AI engine is claimed here.

Determinism holds for identical decoded PCM, analysis version and playback time. The mappings contain no random numbers. Browser decoder differences can cause small numeric differences across platforms. Feature JSON preserves an analysis result for reproducible downstream work.
