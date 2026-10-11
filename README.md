# Shape of Sound

A JUCE 9.0.3 / C++17 instrument foundation with a browser-based **3D spherical spiral synthesizer and resynthesizer**. No API keys or online analysis services are required. Imported sound stays local.

The browser explorer is automatically deployed from `main` to [passagesofpasserine.github.io/TimbreSpaceSynth](https://passagesofpasserine.github.io/TimbreSpaceSynth/). GitHub Actions runs its analysis tests and production build before each deployment.

The synth builds **VST3** and **Standalone** targets. The browser instrument uses WebGL, Web Audio and an AudioWorklet. Its playable mode maps harmonic amplitude and phase to deformation, MIDI pitch to rotation, ADSR amplitude to active arc length, and stereo width to both tube thickness and oscillator phase spread. Its WAV mode drives phase-continuous harmonic, deterministic residual, and transient resynthesis; it is not a renamed wavetable.

## Run the spherical spiral explorer

Install Node.js 22.12+ (or 24 LTS), then:

```sh
cd SpiralExplorer
npm ci
npm run dev
```

Open the address printed by Vite. Click **Enable playable synth**, then use the on-screen keys, computer keys A–K, or **Connect MIDI**. Harmonic bars change the audible additive spectrum and spiral deformation at the same time. ADSR controls the sound envelope and active spiral length; stereo width controls both audible stereo phase spread and line thickness. Presets interpolate synthesis parameters rather than crossfading recordings.

The app also loads an evolving harmonic demo without autoplay. Click Play or import a RIFF WAV (mono/stereo, ≤120 seconds, ≤64 MB). Choose Original, Spiral or Mix playback. Drag to orbit, scroll to zoom, right-drag to pan, and double-click the spiral to scrub. Select Brush or Twist and drag vertically on the 3D spiral for direct feature editing. Region controls edit harmonics, phase twist and energy with undo/redo. Spiral A/B morphing aligns normalized feature time. Export versioned model JSON or render the resynthesis to a stereo WAV.

The working vertical slice implements Spiral A/B sources, feature overlays, one-shot/loop/pendulum/freeze traversal, phase-continuous partials, residual noise, transient excitation, local model import/export and offline WAV rendering. The Sampler, Filter, macro and envelope tabs establish the intended modular workflow; their complete modulation/effects engines remain later stages.

```sh
npm test
npm run build
```

Browser integration tests require a running dev server and Chromium. In the prepared Linux cloud machine:

```sh
npm run test:browser
```

Elsewhere set `CHROMIUM_PATH` to your Chromium executable and optionally `SPIRAL_TEST_URL` to the test server. See [spiral mathematics and limitations](docs/SPIRAL.md).

## Windows x64: Visual Studio 2026

Install Visual Studio 2026 with **Desktop development with C++**, the MSVC x64 toolchain, and Windows SDK. Install CMake **4.2 or newer** for the Visual Studio 18 2026 generator, and Git. Use a Developer PowerShell:

```powershell
cmake -S . -B build-win -G "Visual Studio 18 2026" -A x64
cmake --build build-win --config Release --parallel 4
ctest --test-dir build-win -C Release --output-on-failure
```

CMake fetches JUCE at the exact 9.0.3 commit. For an existing JUCE 9.0.3 checkout, add `-DJUCE_SOURCE_DIR=C:/path/to/JUCE`. Do not use a different JUCE version without validating it separately.

Outputs:

- `build-win/TimbreSpaceSynth_artefacts/Release/VST3/Shape of Sound.vst3`
- `build-win/TimbreSpaceSynth_artefacts/Release/Standalone/Shape of Sound.exe`

Copy the **whole `.vst3` bundle** into `C:\Program Files\Common Files\VST3` (requires administrator permission), then use FL Studio's **Options → Manage plugins → Find installed plugins**. Load Shape of Sound as an instrument. Verify MIDI chords, note releases, sustain pedal, parameter automation, imported samples, preset/project restoration, and both offline rendering and live playback. Choose an audio/MIDI device in the standalone application's settings.

Windows compilation and FL Studio hosting must be validated on Windows; Linux builds do not establish host compatibility. No installer, signing, or distribution package is included yet.

## Synth controls

Sixteen native polyphonic voices play the additive harmonic shape until samples are imported. Eight host-automatable harmonic levels determine the native oscillator spectrum and stereo width introduces deterministic partial phase spread. Select one of four slots and import a mono/stereo WAV ≤30 seconds. Samples are one-shot, linearly resampled, and assumed to have root note **MIDI 60** (C4 in scientific notation; DAW octave labels differ). Drag sound points or the central cursor. Inverse-distance **sample blending** changes the voice mix; this is not learned or AI timbre morphing. ADSR controls amplitude. The LFO modulates low-pass cutoff. Master gain is smoothed.

Parameters, point locations, and bounded PCM samples are saved in plugin state. A voice holds its bank until its note ends; replacement imports affect new notes. Four long, high-rate samples may produce large DAW project states. Pitch bend, looping, root-note detection, effects, and learned synthesis are future work.

## Architecture and validation

See [architecture](docs/ARCHITECTURE.md) and [validation record](docs/VALIDATION.md). Linux cloud setup is repeatable with `bash scripts/setup-cloud.sh`; it installs headers in `/workspace/native` without modifying system packages. Each cloud task already has an isolated checkout: use it directly, without creating a Git worktree.

JUCE licensing applies independently to distribution of the synth. Review JUCE's AGPL/commercial terms before release. Three.js and the tooling retain their dependency licenses.
