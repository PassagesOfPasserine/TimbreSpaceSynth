#include "PluginProcessor.h"
#include <iostream>
#include <cstdlib>
static void require(bool condition, const char* message) {
    if (!condition) { std::cerr << message << '\n'; std::exit(1); }
}
static float render(TimbreProcessor& processor, juce::MidiBuffer& midi, int frames = 256) {
    juce::AudioBuffer<float> output(2, frames); processor.processBlock(output, midi);
    for (int ch = 0; ch < 2; ++ch) for (int n = 0; n < frames; ++n)
        require(std::isfinite(output.getSample(ch, n)), "finite output");
    return output.getMagnitude(0, frames);
}
int main() {
    juce::ScopedJuceInitialiser_GUI init;
    TimbreProcessor p; p.prepareToPlay(48000, 256); juce::MidiBuffer midi;
    require(render(p, midi) < 1e-12f, "idle silence");
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, .8f), 128);
    juce::AudioBuffer<float> timed(2, 256); p.processBlock(timed, midi);
    require(timed.getMagnitude(0, 128) < 1e-12f, "sample-accurate note offset");
    require(timed.getMagnitude(128, 128) > .001f, "built-in MIDI tone");
    midi.addEvent(juce::MidiMessage::noteOff(1, 60), 0); render(p, midi);
    for (int i = 0; i < 100; ++i) render(p, midi);
    require(render(p, midi) < 1e-5f, "release ends");
    for (int n = 40; n < 64; ++n) midi.addEvent(juce::MidiMessage::noteOn(1, n, .7f), 0);
    require(render(p, midi) > .001f, "polyphony and bounded voice stealing");
    midi.addEvent(juce::MidiMessage::allSoundOff(1), 0); render(p, midi);
    auto file = juce::File::getSpecialLocation(juce::File::tempDirectory).getNonexistentChildFile("timbre-test", ".wav");
    juce::WavAudioFormat wav;
    std::unique_ptr<juce::OutputStream> outputStream(file.createOutputStream());
    auto writer = wav.createWriterFor(outputStream, juce::AudioFormatWriterOptions{}
        .withSampleRate(48000).withNumChannels(1).withBitsPerSample(16));
    require(bool(writer), "fixture writer");
    juce::AudioBuffer<float> pcm(1, 4800);
    for (int n = 0; n < 4800; ++n) pcm.setSample(0, n, .5f * std::sin(n * juce::MathConstants<double>::twoPi * 220 / 48000));
    auto stereoSample = std::make_shared<timbre::Sample>(); stereoSample->rate = 48000;
    stereoSample->audio.setSize(2, 4800);
    for (int n = 0; n < 4800; ++n) {
        stereoSample->audio.setSample(0, n, pcm.getSample(0, n));
        stereoSample->audio.setSample(1, n, -pcm.getSample(0, n));
    }
    auto stereoBank = std::make_shared<timbre::Bank>(); stereoBank->samples[0] = stereoSample;
    timbre::Voice stereoVoice; stereoVoice.start(60, 1, 1, 48000, {.001f, .001f, 1, .01f}, stereoBank);
    float stereoPeak = 0;
    for (int n = 0; n < 500; ++n) {
        const auto output = stereoVoice.tick({1, 0, 0, 0});
        require(std::abs(output[0] + output[1]) < 1e-6f, "stereo phase retained");
        stereoPeak = juce::jmax(stereoPeak, std::abs(output[0]));
    }
    require(stereoPeak > .01f, "antiphase sample remains audible in stereo");
    require(writer->writeFromAudioSampleBuffer(pcm, 0, 4800), "fixture write"); writer.reset();
    require(p.importSample(file, 0).isEmpty(), "WAV import");
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, .8f), 0); require(render(p, midi) > .001f, "sample MIDI playback");
    juce::MemoryBlock state; p.getStateInformation(state);
    TimbreProcessor restored; restored.setStateInformation(state.getData(), static_cast<int>(state.getSize()));
    require(bool(restored.snapshot()->samples[0]), "embedded sample state restored");
    require(restored.snapshot()->samples[0]->audio.getNumSamples() == 4800, "PCM length round-trip");
    restored.prepareToPlay(48000, 256); midi.addEvent(juce::MidiMessage::noteOn(1, 60, .8f), 0);
    require(render(restored, midi) > .001f, "restored sample playback");
    const char corrupt[] = "invalid"; restored.setStateInformation(corrupt, sizeof(corrupt));
    require(bool(restored.snapshot()->samples[0]), "invalid state preserves existing sample");
    require(!p.importSample(file.getSiblingFile("missing-timbre-fixture.wav"), 0).isEmpty(), "missing file rejected");
    restored.setStateInformation(state.getData(), static_cast<int>(state.getSize() / 2));
    require(bool(restored.snapshot()->samples[0]), "truncated state preserves bank");
    require(!p.importSample(file, 4).isEmpty(), "slot bounds validation"); file.deleteFile();
    p.keyboard.allNotesOff(0);
    std::unique_ptr<juce::AudioProcessorEditor> editor(p.createEditor());
    require(bool(editor), "editor creation");
    editor->setSize(1080, 740);
    juce::Image image(juce::Image::ARGB, 1080, 740, true);
    juce::Graphics graphics(image); editor->paintEntireComponent(graphics, true);
    auto imageFile = juce::File::getCurrentWorkingDirectory().getChildFile("synth-editor.png");
    auto imageStream = imageFile.createOutputStream(); juce::PNGImageFormat png;
    if (imageStream) { imageStream->setPosition(0); imageStream->truncate(); }
    require(imageStream && png.writeImageToStream(image, *imageStream), "offscreen UI render");
    editor->setSize(840, 620); require(editor->getWidth() == 840, "editor resize");
    editor.reset();
    TimbreProcessor additive; additive.prepareToPlay(48000, 256);
    additive.parameters.getParameter("harmonic2")->setValueNotifyingHost(.7f);
    additive.parameters.getParameter("stereoWidth")->setValueNotifyingHost(1.0f);
    juce::MidiBuffer additiveMidi; additiveMidi.addEvent(juce::MidiMessage::noteOn(1, 69, 1.0f), 0);
    juce::AudioBuffer<float> additiveOutput(2, 256); additive.processBlock(additiveOutput, additiveMidi);
    float stereoDifference = 0;
    for (int n = 0; n < additiveOutput.getNumSamples(); ++n)
        stereoDifference = juce::jmax(stereoDifference, std::abs(additiveOutput.getSample(0, n) - additiveOutput.getSample(1, n)));
    require(stereoDifference > .001f, "stereo width changes additive output");
    std::cout << "Processor checks passed: silence, MIDI additive tone/stereo width, release, polyphony, WAV playback, PCM state, corrupt state, slot bounds\n";
}
