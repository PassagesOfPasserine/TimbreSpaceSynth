#pragma once
#include <JuceHeader.h>
#include "Engine/SampleVoice.h"
class TimbreProcessor final : public juce::AudioProcessor, private juce::Timer {
public:
    TimbreProcessor();
    ~TimbreProcessor() override { stopTimer(); }
    void prepareToPlay(double, int) override;
    void releaseResources() override {}
    using juce::AudioProcessor::processBlock;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "Shape of Sound"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 5; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;
    juce::String importSample(const juce::File&, int slot);
    std::shared_ptr<const timbre::Bank> snapshot() const { return std::atomic_load(&bank); }
    juce::AudioProcessorValueTreeState parameters;
    juce::MidiKeyboardState keyboard;
private:
    void publish(std::shared_ptr<const timbre::Bank>);
    void timerCallback() override;
    juce::CriticalSection retirementLock;
    std::vector<std::shared_ptr<const timbre::Bank>> retiredBanks;
    static juce::AudioProcessorValueTreeState::ParameterLayout layout();
    void handleMidi(const juce::MidiMessage&);
    float param(const char* id) const { return parameters.getRawParameterValue(id)->load(); }
    std::shared_ptr<const timbre::Bank> bank;
    std::array<timbre::Voice, 16> voices;
    std::array<std::atomic<float>*, 4> pointXParams{}, pointYParams{};
    std::array<std::atomic<float>*, 8> harmonicParams{};
    timbre::SampleBlend morph;
    juce::dsp::StateVariableTPTFilter<float> filter;
    juce::SmoothedValue<float> master, cutoff;
    double sampleRateHz = 44100, lfoPhase = 0;
    std::atomic<float>* stereoWidthParam = nullptr;
    bool sustain[17]{};
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(TimbreProcessor)
};
