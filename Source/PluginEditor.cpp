#include "PluginEditor.h"
namespace { const juce::Colour background{0xff10131c}, panel{0xff1c2231}, accent{0xff7ce9cf}; }
TimbreEditor::TimbreEditor(TimbreProcessor& p)
 : AudioProcessorEditor(p), processor(p), keyboard(p.keyboard, juce::MidiKeyboardComponent::horizontalKeyboard) {
    look.setColour(juce::Slider::rotarySliderFillColourId, accent);
    look.setColour(juce::Slider::rotarySliderOutlineColourId, juce::Colour(0xff343c50));
    look.setColour(juce::Slider::textBoxTextColourId, juce::Colours::white);
    look.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff35435b));
    setLookAndFeel(&look);
    const char* ids[] = {"attack", "decay", "sustain", "release", "lfoRate", "lfoDepth", "cutoff", "volume"};
    const char* names[] = {"Attack", "Decay", "Sustain", "Release", "LFO Hz", "Filter depth", "Low-pass Hz", "Master"};
    for (size_t i = 0; i < knobs.size(); ++i) {
        auto& knob = knobs[i]; knob.setNumDecimalPlacesToDisplay(i == 6 ? 0 : (i == 4 ? 1 : 3));
        knob.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        knob.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 80, 20); addAndMakeVisible(knob);
        labels[i].setText(names[i], juce::dontSendNotification);
        labels[i].setJustificationType(juce::Justification::centred); addAndMakeVisible(labels[i]);
        attachments.push_back(std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(p.parameters, ids[i], knob));
        knob.textFromValueFunction = [i](double v) { return juce::String(v, i == 6 ? 0 : (i == 4 ? 1 : 3)); };
        knob.updateText();
    }
    for (int i = 1; i <= 4; ++i) slot.addItem("Sound " + juce::String(i), i);
    slot.setSelectedId(1); addAndMakeVisible(slot); addAndMakeVisible(importButton);
    importButton.onClick = [this] { import(); };
    status.setText("WAV root note: MIDI 60 | Drag sounds or cursor to blend", juce::dontSendNotification);
    status.setColour(juce::Label::textColourId, juce::Colour(0xffa8b5cd)); addAndMakeVisible(status);
    keyboard.setAvailableRange(24, 96); keyboard.setKeyWidth(22); addAndMakeVisible(keyboard);
    setResizable(true, true); setResizeLimits(840, 620, 1600, 1100); setSize(1080, 740); startTimerHz(30);
}
float TimbreEditor::value(const juce::String& id) const { return processor.parameters.getRawParameterValue(id)->load(); }
juce::String TimbreEditor::idFor(int i, bool x) const {
    return i < 0 ? juce::String(x ? "cursorX" : "cursorY") : juce::String(x ? "pointX" : "pointY") + juce::String(i);
}
juce::Point<float> TimbreEditor::location(int i) const {
    return {plane.getX() + value(idFor(i, true)) * plane.getWidth(),
            plane.getY() + value(idFor(i, false)) * plane.getHeight()};
}
void TimbreEditor::resized() {
    auto b = getLocalBounds().reduced(24);
    auto header = b.removeFromTop(56); importButton.setBounds(header.removeFromRight(120).reduced(0, 10));
    slot.setBounds(header.removeFromRight(120).reduced(8, 10));
    keyboard.setBounds(b.removeFromBottom(76));
    status.setBounds(b.removeFromBottom(28));
    auto controls = b.removeFromBottom(170);
    const int unit = controls.getWidth() / 8;
    for (size_t i = 0; i < knobs.size(); ++i) {
        auto area = controls.removeFromLeft(unit).reduced(5, 20);
        labels[i].setBounds(area.removeFromTop(22)); knobs[i].setBounds(area);
    }
    b.removeFromBottom(14);
    auto left = b.removeFromLeft(b.getWidth() * 3 / 5).reduced(12);
    plane = left.withTrimmedTop(36).reduced(12).toFloat();
    terrain = b.reduced(12).withTrimmedTop(36).toFloat();
}
void TimbreEditor::paint(juce::Graphics& g) {
    g.fillAll(background); g.setColour(juce::Colours::white); g.setFont(26);
    g.drawText("TIMBRE SPACE", 24, 24, 320, 32, juce::Justification::centredLeft);
    g.setFont(12); g.setColour(accent);
    g.drawText("SYNTH  /  SAMPLE BLEND FOUNDATION", 350, 28, 350, 24, juce::Justification::centredLeft);
    for (auto r : {plane, terrain}) { g.setColour(panel); g.fillRoundedRectangle(r.expanded(12, 12).withTrimmedTop(-30), 16); }
    g.setColour(juce::Colours::white); g.setFont(14);
    g.drawText("TIMBRE PLANE | drag sounds or cursor", plane.withY(plane.getY() - 32).withHeight(22), juce::Justification::centredLeft);
    g.drawText("WAVEFORM TERRAIN", terrain.withY(terrain.getY() - 32).withHeight(22), juce::Justification::centredLeft);
    g.setColour(juce::Colour(0xff30394c));
    for (int i = 0; i <= 8; ++i) {
        float x = plane.getX() + plane.getWidth() * static_cast<float>(i) / 8;
        float y = plane.getY() + plane.getHeight() * static_cast<float>(i) / 8;
        g.drawVerticalLine(static_cast<int>(x), plane.getY(), plane.getBottom());
        g.drawHorizontalLine(static_cast<int>(y), plane.getX(), plane.getRight());
    }
    auto bank = processor.snapshot();
    for (int i = 0; i < 4; ++i) {
        const auto pos = location(i); const bool loaded = bool(bank->samples[static_cast<size_t>(i)]);
        g.setColour(loaded ? accent : juce::Colour(0xff69758d)); g.fillEllipse(pos.x - 9, pos.y - 9, 18, 18);
        g.setFont(12); g.drawText(juce::String(i + 1) + ": " + (loaded ? bank->samples[static_cast<size_t>(i)]->name : "empty"),
            juce::Rectangle<float>(pos.x - 60, pos.y + 13, 120, 20), juce::Justification::centred);
    }
    const auto soundCursor = location(-1); g.setColour(juce::Colour(0xffdca3ff));
    g.drawEllipse(soundCursor.x - 14, soundCursor.y - 14, 28, 28, 2);
    g.drawLine(soundCursor.x - 20, soundCursor.y, soundCursor.x + 20, soundCursor.y);
    g.drawLine(soundCursor.x, soundCursor.y - 20, soundCursor.x, soundCursor.y + 20);
    // Perspective wireframe derived from the actual loaded PCM; no AI claims.
    for (int row = 0; row < 14; ++row) {
        juce::Path path;
        const float depth = static_cast<float>(row) / 13;
        for (int col = 0; col < 100; ++col) {
            const float t = static_cast<float>(col) / 99;
            float amplitude = std::sin(t * juce::MathConstants<float>::twoPi * 3);
            auto sample = bank->samples[static_cast<size_t>(slot.getSelectedId() - 1)];
            if (sample) amplitude = sample->audio.getSample(0, juce::jmin(sample->audio.getNumSamples() - 1,
                static_cast<int>(t * static_cast<float>(sample->audio.getNumSamples() - 1))));
            const float x = terrain.getX() + terrain.getWidth() * (.08f + .1f * depth + t * (.8f - .18f * depth));
            const float y = terrain.getBottom() - 25 - depth * terrain.getHeight() * .65f - amplitude * 22;
            if (col == 0) path.startNewSubPath(x, y); else path.lineTo(x, y);
        }
        g.setColour(accent.withAlpha(.25f + .65f * (1 - depth))); g.strokePath(path, juce::PathStrokeType(1));
    }
    // Independent rounded ADSR, LFO and output sections.
    for (const auto& range : {std::pair<int, int>{0, 3}, {4, 5}, {6, 7}}) {
        auto r = knobs[static_cast<size_t>(range.first)].getBounds().getUnion(knobs[static_cast<size_t>(range.second)].getBounds());
        r = r.withTrimmedTop(-28).expanded(3, 4);
        g.setColour(panel); g.fillRoundedRectangle(r.toFloat(), 10);
    }
    g.setColour(juce::Colour(0xff64738d)); g.setFont(12);
    g.drawText("ADSR", 30, keyboard.getY() - 192, getWidth() / 2 - 30, 22, juce::Justification::centredLeft);
    g.drawText("OUTPUT", getWidth() * 3 / 4, keyboard.getY() - 192, getWidth() / 4 - 24, 22, juce::Justification::centredLeft);
    g.drawText("LFO -> FILTER", getWidth() / 2, keyboard.getY() - 192, getWidth() / 4, 22, juce::Justification::centredLeft);
}
void TimbreEditor::mouseDown(const juce::MouseEvent& e) {
    if (!plane.contains(e.position)) return;
    dragging = -1;
    for (int i = 0; i < 4; ++i) if (location(i).getDistanceFrom(e.position) < 18) { dragging = i; break; }
    for (bool x : {true, false}) processor.parameters.getParameter(idFor(dragging, x))->beginChangeGesture();
    move(e);
}
void TimbreEditor::move(const juce::MouseEvent& e) {
    if (dragging == -2) return;
    processor.parameters.getParameter(idFor(dragging, true))->setValueNotifyingHost(juce::jlimit(0.0f, 1.0f, (e.position.x - plane.getX()) / plane.getWidth()));
    processor.parameters.getParameter(idFor(dragging, false))->setValueNotifyingHost(juce::jlimit(0.0f, 1.0f, (e.position.y - plane.getY()) / plane.getHeight()));
    repaint();
}
void TimbreEditor::mouseDrag(const juce::MouseEvent& e) { move(e); }
void TimbreEditor::mouseUp(const juce::MouseEvent&) {
    if (dragging == -2) return;
    for (bool x : {true, false}) processor.parameters.getParameter(idFor(dragging, x))->endChangeGesture();
    dragging = -2;
}
void TimbreEditor::import() {
    chooser = std::make_unique<juce::FileChooser>("Import WAV (maximum 30 seconds)", juce::File{}, "*.wav");
    const int target = slot.getSelectedId() - 1;
    juce::Component::SafePointer<TimbreEditor> safe(this);
    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
        [safe, target](const juce::FileChooser& c) {
            if (!safe || c.getResult() == juce::File{}) return;
            const auto error = safe->processor.importSample(c.getResult(), target);
            safe->status.setText(error.isEmpty() ? "Imported " + c.getResult().getFileName() : error, juce::dontSendNotification);
            safe->repaint();
        });
}
