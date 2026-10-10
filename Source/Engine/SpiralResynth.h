#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

namespace timbre {
constexpr std::size_t spiralHarmonics = 16;
struct SpiralFrame {
    float amplitude = 0, fundamental = 0, residual = 0, transient = 0, stereoWidth = 0;
    std::array<float, spiralHarmonics> harmonics{}, phases{};
};
struct SpiralModel {
    double frameRate = 50, duration = 0;
    std::vector<SpiralFrame> frames;
};

inline std::shared_ptr<const SpiralModel> analyzeSpiral(const std::vector<float>& pcm,
                                                        double sampleRate,
                                                        float fundamental = 261.6256f) {
    auto model = std::make_shared<SpiralModel>();
    if (pcm.empty() || sampleRate < 8000 || sampleRate > 384000 || !std::isfinite(sampleRate)) return model;
    constexpr int frameSize = 1024;
    const int hop = std::max(1, static_cast<int>(sampleRate / model->frameRate));
    model->duration = pcm.size() / sampleRate;
    float previousAmplitude = 0;
    for (std::size_t center = 0; center < pcm.size(); center += static_cast<std::size_t>(hop)) {
        SpiralFrame frame; frame.fundamental = fundamental; double energy = 0, harmonicEnergy = 0;
        for (int n = 0; n < frameSize; ++n) {
            const auto index = static_cast<std::int64_t>(center) + n - frameSize / 2;
            const float sample = index >= 0 && index < static_cast<std::int64_t>(pcm.size()) ? pcm[static_cast<std::size_t>(index)] : 0;
            energy += sample * sample;
        }
        frame.amplitude = static_cast<float>(std::sqrt(energy / frameSize));
        for (std::size_t h = 0; h < spiralHarmonics; ++h) {
            double real = 0, imaginary = 0; const double frequency = fundamental * (h + 1);
            if (frequency >= sampleRate * .48) continue;
            for (int n = 0; n < frameSize; ++n) {
                const auto index = static_cast<std::int64_t>(center) + n - frameSize / 2;
                const float sample = index >= 0 && index < static_cast<std::int64_t>(pcm.size()) ? pcm[static_cast<std::size_t>(index)] : 0;
                const double window = .5 - .5 * std::cos(2 * 3.14159265358979323846 * n / (frameSize - 1));
                const double angle = 2 * 3.14159265358979323846 * frequency * n / sampleRate;
                real += sample * window * std::cos(angle); imaginary -= sample * window * std::sin(angle);
            }
            frame.harmonics[h] = static_cast<float>(std::hypot(real, imaginary));
            frame.phases[h] = static_cast<float>(std::atan2(imaginary, real));
            harmonicEnergy += frame.harmonics[h] * frame.harmonics[h];
        }
        float sum = 0; for (auto value : frame.harmonics) sum += value;
        if (sum > 1.0e-9f) for (auto& value : frame.harmonics) value /= sum;
        frame.residual = energy > 1.0e-9 ? static_cast<float>(std::clamp(1 - harmonicEnergy / (energy * frameSize), 0.0, 1.0)) : 0;
        frame.transient = std::clamp((frame.amplitude - previousAmplitude) / std::max(.001f, frame.amplitude), 0.0f, 1.0f);
        previousAmplitude = frame.amplitude; model->frames.push_back(frame);
    }
    return model;
}

class SpiralOscillator {
public:
    void start(double newSampleRate, float midiFrequency, std::shared_ptr<const SpiralModel> newModel) noexcept {
        sampleRate = std::max(1.0, newSampleRate); frequencyScale = midiFrequency / 261.6256f;
        model = std::move(newModel); position = 0; phases.fill(0); noiseState = 0; lastTransient = 0; seed = 0x51f15e;
    }
    std::array<float, 2> tick(float harmonicAmount = 1, float residualAmount = .2f,
                              float transientAmount = .25f) noexcept {
        std::array<float, 2> output{}; if (!model || model->frames.empty()) return output;
        const double framePosition = std::clamp(position * model->frameRate, 0.0, static_cast<double>(model->frames.size() - 1));
        const auto a = static_cast<std::size_t>(framePosition), b = std::min(a + 1, model->frames.size() - 1);
        const float part = static_cast<float>(framePosition - a), inverse = 1 - part;
        auto scalar = [&, inverse](auto member) { return model->frames[a].*member * inverse + model->frames[b].*member * part; };
        const float amplitude = scalar(&SpiralFrame::amplitude), fundamental = scalar(&SpiralFrame::fundamental) * frequencyScale;
        float harmonic = 0;
        for (std::size_t h = 0; h < spiralHarmonics; ++h) {
            const double frequency = fundamental * (h + 1); if (frequency <= 0 || frequency >= sampleRate * .48) continue;
            phases[h] += 2 * 3.14159265358979323846 * frequency / sampleRate;
            if (phases[h] >= 2 * 3.14159265358979323846) phases[h] -= 2 * 3.14159265358979323846;
            const float weight = model->frames[a].harmonics[h] * inverse + model->frames[b].harmonics[h] * part;
            const float phase = model->frames[a].phases[h] * inverse + model->frames[b].phases[h] * part;
            harmonic += weight * static_cast<float>(std::sin(phases[h] + phase));
        }
        seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
        const float noise = static_cast<float>((seed & 0xffffff) / static_cast<double>(0xffffff) * 2 - 1);
        noiseState += .2f * (noise - noiseState);
        const float residual = scalar(&SpiralFrame::residual), transient = scalar(&SpiralFrame::transient);
        const float onset = std::max(0.0f, transient - lastTransient); lastTransient = transient;
        const float value = std::tanh(amplitude * (harmonicAmount * harmonic + residualAmount * residual * noiseState + transientAmount * onset * noise * 2));
        const float width = std::clamp(scalar(&SpiralFrame::stereoWidth), 0.0f, 1.0f);
        output = {value * (1 + .15f * width), value * (1 - .15f * width)}; position += 1 / sampleRate; return output;
    }
private:
    std::shared_ptr<const SpiralModel> model;
    std::array<double, spiralHarmonics> phases{};
    double sampleRate = 44100, position = 0; float frequencyScale = 1, noiseState = 0, lastTransient = 0;
    std::uint32_t seed = 0x51f15e;
};
}
