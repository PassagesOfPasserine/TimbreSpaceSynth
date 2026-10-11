#include "PluginProcessor.h"
#include "PluginEditor.h"
juce::AudioProcessorValueTreeState::ParameterLayout TimbreProcessor::layout() {
    juce::AudioProcessorValueTreeState::ParameterLayout p;
    auto add = [&](const char* id, const char* name, float lo, float hi, float def) {
        p.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{id, 1}, name,
            juce::NormalisableRange<float>(lo, hi), def));
    };
    add("attack", "Attack", .001f, 2, .02f); add("decay", "Decay", .001f, 2, .2f);
    add("sustain", "Sustain", 0, 1, .75f); add("release", "Release", .005f, 5, .4f);
    add("cutoff", "Low-pass", 30, 20000, 12000); add("volume", "Master", 0, 1, .7f);
    add("lfoRate", "LFO rate", .1f, 15, 1); add("lfoDepth", "LFO filter depth", 0, 1, 0);
    add("cursorX", "Cursor X", 0, 1, .5f); add("cursorY", "Cursor Y", 0, 1, .5f);
    add("stereoWidth", "Spiral thickness / stereo width", 0, 1, .25f);
    for (int i = 0; i < 8; ++i) {
        auto id = "harmonic" + juce::String(i + 1);
        add(id.toRawUTF8(), id.toRawUTF8(), 0, 1, i == 0 ? 1.0f : 0.0f);
    }
    for (int i = 0; i < 4; ++i) {
        auto x = "pointX" + juce::String(i), y = "pointY" + juce::String(i);
        add(x.toRawUTF8(), x.toRawUTF8(), 0, 1, (i % 2) ? .8f : .2f);
        add(y.toRawUTF8(), y.toRawUTF8(), 0, 1, (i / 2) ? .8f : .2f);
    }
    return p;
}
TimbreProcessor::TimbreProcessor()
 : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
   parameters(*this, nullptr, "TimbreSpaceState", layout()), bank(std::make_shared<timbre::Bank>()) {
    for (int i = 0; i < 4; ++i) {
        pointXParams[static_cast<std::size_t>(i)] = parameters.getRawParameterValue("pointX" + juce::String(i));
        pointYParams[static_cast<std::size_t>(i)] = parameters.getRawParameterValue("pointY" + juce::String(i));
    }
    for (int i = 0; i < 8; ++i) harmonicParams[static_cast<std::size_t>(i)] = parameters.getRawParameterValue("harmonic" + juce::String(i + 1));
    stereoWidthParam = parameters.getRawParameterValue("stereoWidth"); startTimer(1000);
}
bool TimbreProcessor::isBusesLayoutSupported(const BusesLayout& b) const {
    return b.getMainInputChannelSet().isDisabled() &&
       (b.getMainOutputChannelSet() == juce::AudioChannelSet::stereo() ||
        b.getMainOutputChannelSet() == juce::AudioChannelSet::mono());
}
void TimbreProcessor::prepareToPlay(double sr, int block) {
    sampleRateHz = sr; lfoPhase = 0;
    for (auto& v : voices) { v.active = false; v.bank.reset(); }
    std::fill(std::begin(sustain), std::end(sustain), false);
    filter.prepare({sr, static_cast<juce::uint32>(block), static_cast<juce::uint32>(getTotalNumOutputChannels())});
    filter.setType(juce::dsp::StateVariableTPTFilterType::lowpass); filter.setResonance(.707f);
    master.reset(sr, .02); master.setCurrentAndTargetValue(param("volume"));
    cutoff.reset(sr, .02); cutoff.setCurrentAndTargetValue(param("cutoff"));
}
void TimbreProcessor::handleMidi(const juce::MidiMessage& m) {
    const int ch = m.getChannel();
    if (m.isNoteOn()) {
        auto* voice = &voices[0];
        for (auto& v : voices) if (!v.active) { voice = &v; break; }
        voice->start(m.getNoteNumber(), ch, m.getFloatVelocity(), sampleRateHz,
          {param("attack"), param("decay"), param("sustain"), param("release")}, snapshot());
    } else if (m.isNoteOff()) {
        for (auto& v : voices) if (v.active && v.note == m.getNoteNumber() && v.channel == ch) {
            v.held = false; if (!sustain[ch]) v.release();
        }
    } else if (m.isController() && m.getControllerNumber() == 64) {
        sustain[ch] = m.getControllerValue() >= 64;
        if (!sustain[ch]) for (auto& v : voices) if (v.channel == ch && !v.held) v.release();
    } else if (m.isAllNotesOff() || m.isAllSoundOff()) {
        sustain[ch] = false;
        for (auto& v : voices) if (v.channel == ch) {
            if (m.isAllSoundOff()) { v.active = false; v.bank.reset(); } else v.release();
        }
    }
}
void TimbreProcessor::processBlock(juce::AudioBuffer<float>& out, juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals; out.clear();
    keyboard.processNextMidiBuffer(midi, 0, out.getNumSamples(), true);
    std::array<timbre::Point, 4> points;
    for (int i = 0; i < 4; ++i) {
        points[static_cast<size_t>(i)] = {pointXParams[static_cast<std::size_t>(i)]->load(),
                                       pointYParams[static_cast<std::size_t>(i)]->load()};
    }
    const timbre::Point cursor{param("cursorX"), param("cursorY")};
    std::array<float, 8> harmonicShape{};
    for (int i = 0; i < 8; ++i) harmonicShape[static_cast<std::size_t>(i)] = harmonicParams[static_cast<std::size_t>(i)]->load();
    const float stereoWidth = stereoWidthParam->load();
    auto updateWeights = [&](timbre::Voice& v) {
        std::array<bool, 4> active{};
        for (size_t i = 0; i < 4; ++i) active[i] = bool(v.bank->samples[i]);
        v.blendWeights = morph.weights(cursor, points, active);
    };
    for (auto& v : voices) if (v.active) updateWeights(v);
    master.setTargetValue(param("volume")); cutoff.setTargetValue(param("cutoff"));
    auto event = midi.cbegin();
    for (int frame = 0; frame < out.getNumSamples(); ++frame) {
        while (event != midi.cend() && (*event).samplePosition <= frame) {
            handleMidi((*event).getMessage()); ++event;
            for (auto& v : voices) if (v.active) updateWeights(v);
        }
        std::array<float, 2> signal{};
        for (auto& v : voices) if (v.active) {
            const auto sample = v.tick(v.blendWeights, harmonicShape, stereoWidth);
            for (size_t ch = 0; ch < 2; ++ch) signal[ch] += sample[ch];
        }
        lfoPhase += juce::MathConstants<double>::twoPi * param("lfoRate") / sampleRateHz;
        if (lfoPhase >= juce::MathConstants<double>::twoPi) lfoPhase -= juce::MathConstants<double>::twoPi;
        const float frequency = cutoff.getNextValue() * std::pow(2.0f, param("lfoDepth") * static_cast<float>(std::sin(lfoPhase)) * 2);
        filter.setCutoffFrequency(juce::jlimit(20.0f, static_cast<float>(sampleRateHz * .45), frequency));
        const float gain = master.getNextValue();
        for (int channel = 0; channel < out.getNumChannels(); ++channel)
            out.setSample(channel, frame, std::tanh(filter.processSample(channel, out.getNumChannels() == 1 ?
                .5f * (signal[0] + signal[1]) : signal[static_cast<size_t>(channel)])) * gain);
    }
    midi.clear();
}
juce::String TimbreProcessor::importSample(const juce::File& file, int slot) {
    if (slot < 0 || slot >= 4) return "Invalid sample slot";
    juce::WavAudioFormat format;
    auto input = file.createInputStream();
    if (!input) return "Cannot open WAV file";
    std::unique_ptr<juce::AudioFormatReader> reader(format.createReaderFor(input.release(), true));
    if (!reader || reader->lengthInSamples < 2 || reader->sampleRate < 8000 || reader->sampleRate > 384000 || reader->numChannels < 1) return "Cannot read this WAV file";
    if (reader->lengthInSamples > reader->sampleRate * 30 || reader->numChannels > 2)
        return "Use a mono/stereo WAV up to 30 seconds";
    auto sample = std::make_shared<timbre::Sample>();
    sample->audio.setSize(static_cast<int>(reader->numChannels), static_cast<int>(reader->lengthInSamples));
    if (!reader->read(&sample->audio, 0, sample->audio.getNumSamples(), 0, true, true)) return "WAV read failed";
    for (int ch = 0; ch < sample->audio.getNumChannels(); ++ch)
        for (int n = 0; n < sample->audio.getNumSamples(); ++n) {
            auto value = sample->audio.getSample(ch, n);
            if (!std::isfinite(value)) return "WAV contains non-finite samples";
            sample->audio.setSample(ch, n, juce::jlimit(-1.0f, 1.0f, value));
        }
    sample->rate = reader->sampleRate; sample->name = file.getFileNameWithoutExtension();
    auto next = std::make_shared<timbre::Bank>(*snapshot()); next->samples[static_cast<size_t>(slot)] = sample;
    publish(next);
    return {};
}
void TimbreProcessor::getStateInformation(juce::MemoryBlock& dest) {
    // Embed bounded PCM so projects do not depend on external file paths.
    juce::MemoryOutputStream stream(dest, false);
    stream.writeInt(0x54535331); stream.writeInt(1);
    auto xml = parameters.copyState().createXml(); stream.writeString(xml->toString());
    auto b = snapshot();
    for (auto& s : b->samples) {
        stream.writeBool(bool(s)); if (!s) continue;
        stream.writeString(s->name); stream.writeDouble(s->rate);
        stream.writeInt(s->audio.getNumChannels()); stream.writeInt(s->audio.getNumSamples());
        for (int ch = 0; ch < s->audio.getNumChannels(); ++ch)
            for (int n = 0; n < s->audio.getNumSamples(); ++n) stream.writeFloat(s->audio.getSample(ch, n));
    }
}
void TimbreProcessor::setStateInformation(const void* data, int size) {
    juce::MemoryInputStream stream(data, static_cast<size_t>(juce::jmax(0, size)), false);
    if (stream.getNumBytesRemaining() < 8 || stream.readInt() != 0x54535331 || stream.readInt() != 1) return;
    auto xml = juce::parseXML(stream.readString()); if (!xml || !xml->hasTagName("TimbreSpaceState")) return;
    auto next = std::make_shared<timbre::Bank>();
    for (auto& s : next->samples) {
        if (stream.isExhausted()) return;
        if (!stream.readBool()) continue;
        auto sample = std::make_shared<timbre::Sample>(); sample->name = stream.readString(); sample->rate = stream.readDouble();
        const int channels = stream.readInt(), count = stream.readInt();
        if (!std::isfinite(sample->rate) || sample->rate < 8000 || sample->rate > 384000 ||
            channels < 1 || channels > 2 || count < 2 || count > sample->rate * 30 ||
            static_cast<juce::int64>(channels) * count * 4 > stream.getNumBytesRemaining()) return;
        sample->audio.setSize(channels, count);
        for (int ch = 0; ch < channels; ++ch) for (int n = 0; n < count; ++n) {
            const float value = stream.readFloat(); if (!std::isfinite(value)) return;
            sample->audio.setSample(ch, n, juce::jlimit(-1.0f, 1.0f, value));
        }
        s = sample;
    }
    parameters.replaceState(juce::ValueTree::fromXml(*xml));
    publish(next);
}
juce::AudioProcessorEditor* TimbreProcessor::createEditor() { return new TimbreEditor(*this); }
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new TimbreProcessor; }

void TimbreProcessor::publish(std::shared_ptr<const timbre::Bank> next) {
    const juce::ScopedLock lock(retirementLock);
    // Keep a reference until every voice releases the bank; reclaim on message thread.
    retiredBanks.push_back(snapshot());
    std::atomic_store(&bank, std::move(next));
}
void TimbreProcessor::timerCallback() {
    const juce::ScopedLock lock(retirementLock);
    retiredBanks.erase(std::remove_if(retiredBanks.begin(), retiredBanks.end(),
        [](const auto& old) { return old.use_count() == 1; }), retiredBanks.end());
}
