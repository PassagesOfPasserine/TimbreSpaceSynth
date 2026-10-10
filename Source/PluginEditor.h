#pragma once
#include "PluginProcessor.h"
class TimbreEditor final : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit TimbreEditor(TimbreProcessor&);
    ~TimbreEditor() override { setLookAndFeel(nullptr); }
    void paint(juce::Graphics&) override;
    void resized() override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
private:
    void timerCallback() override { repaint(); }
    void move(const juce::MouseEvent&);
    void import();
    float value(const juce::String& id) const;
    juce::Point<float> location(int index) const;
    juce::String idFor(int index, bool x) const;
    TimbreProcessor& processor;
    juce::LookAndFeel_V4 look;
    juce::MidiKeyboardComponent keyboard;
    std::array<juce::Slider, 8> knobs;
    std::array<juce::Label, 8> labels;
    std::vector<std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment>> attachments;
    juce::TextButton importButton{"Import WAV"};
    juce::ComboBox slot;
    juce::Label status;
    std::unique_ptr<juce::FileChooser> chooser;
    juce::Rectangle<float> plane, terrain;
    int dragging = -2;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(TimbreEditor)
};
