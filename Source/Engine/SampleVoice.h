#pragma once
#include <JuceHeader.h>
#include "Morphing.h"
namespace timbre {
struct Sample {
    juce::AudioBuffer<float> audio;
    double rate = 44100;
    juce::String name;
};
struct Bank { std::array<std::shared_ptr<const Sample>, 4> samples; };
struct Voice {
    bool active = false, held = false;
    int note = 0, channel = 1;
    float velocity = 0;
    double phase = 0, oscillatorIncrement = 0;
    std::array<double, 4> positions{}, increments{};
    std::array<float, 4> blendWeights{};
    std::shared_ptr<const Bank> bank;
    juce::ADSR envelope;
    void start(int n, int ch, float v, double rate, const juce::ADSR::Parameters& adsr,
               std::shared_ptr<const Bank> b) {
        oscillatorIncrement = juce::MathConstants<double>::twoPi * juce::MidiMessage::getMidiNoteInHertz(n) / rate;
        active = held = true; note = n; channel = ch; velocity = v;
        phase = 0; positions.fill(0); bank = std::move(b);
        for (size_t i = 0; i < 4; ++i) increments[i] = bank->samples[i] ?
            std::pow(2.0, (note - 60) / 12.0) * bank->samples[i]->rate / rate : 0;
        envelope.setSampleRate(rate); envelope.setParameters(adsr); envelope.reset(); envelope.noteOn();
    }
    void release() { held = false; envelope.noteOff(); }
    std::array<float, 2> tick(const std::array<float, 4>& weights) {
        std::array<float, 2> value{}; bool hasSample = false;
        for (std::size_t i = 0; i < 4; ++i) if (bank->samples[i]) {
            hasSample = true; const auto& s = *bank->samples[i];
            const int length = s.audio.getNumSamples();
            if (positions[i] < length - 1) {
                const int index = static_cast<int>(positions[i]);
                const float fraction = static_cast<float>(positions[i] - index);
                for (size_t ch = 0; ch < 2; ++ch) {
                    const int sourceChannel = juce::jmin(static_cast<int>(ch), s.audio.getNumChannels() - 1);
                    value[ch] += weights[i] * (s.audio.getSample(sourceChannel, index) * (1 - fraction)
                          + s.audio.getSample(sourceChannel, index + 1) * fraction);
                }
            }
            positions[i] += increments[i];
        }
        if (!hasSample) {
            value.fill(static_cast<float>(std::sin(phase)));
            phase += oscillatorIncrement;
            if (phase > juce::MathConstants<double>::twoPi) phase -= juce::MathConstants<double>::twoPi;
        }
        const auto gain = envelope.getNextSample();
        if (!envelope.isActive()) { active = false; bank.reset(); }
        for (auto& amplitude : value) amplitude *= gain * velocity * 0.18f;
        return value;
    }
};
}
