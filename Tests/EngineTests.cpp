#include "Engine/Morphing.h"
#include "Engine/SpiralResynth.h"
#include <iostream>
#include <cstdlib>
void require(bool condition, const char* message) {
    if (!condition) { std::cerr << message << '\n'; std::exit(1); }
}
int main() {
    timbre::SampleBlend blend;
    const std::array<timbre::Point, 4> points{{{0,0},{1,0},{0,1},{1,1}}};
    auto w = blend.weights({.5f,.5f}, points, {true,true,true,true});
    for (auto v : w) require(std::abs(v - .25f) < 1e-5f, "center symmetry");
    w = blend.weights({0,0}, points, {true,true,true,true});
    require(w[0] > .999f, "sound proximity");
    w = blend.weights({0,0}, points, {false,true,false,false});
    require(w[0] == 0 && w[1] == 1, "empty slots excluded");
    w = blend.weights({0,0}, points, {false,false,false,false});
    for (auto v : w) require(v == 0 && std::isfinite(v), "empty bank safe");
    for (int x = 0; x <= 100; ++x) for (int y = 0; y <= 100; ++y) {
        w = blend.weights({x / 100.f, y / 100.f}, points, {true,true,true,true});
        float sum = 0; for (auto v : w) { require(std::isfinite(v) && v >= 0, "finite positive weights"); sum += v; }
        require(std::abs(sum - 1) < 1e-5f, "normalized weights");
    }
    std::vector<float> pcm(16000);
    for (std::size_t i = 0; i < pcm.size(); ++i) pcm[i] = .3f * std::sin(2 * 3.14159265358979323846 * 261.6256 * i / 16000);
    const auto model = timbre::analyzeSpiral(pcm, 16000);
    require(model && model->frames.size() >= 49, "spiral frames analyzed");
    require(model->frames[20].amplitude > .1f, "spiral amplitude extracted");
    require(model->frames[20].harmonics[0] > .8f, "fundamental harmonic extracted");
    timbre::SpiralOscillator oscillator; oscillator.start(48000, 261.6256f, model);
    float peak = 0; std::array<float, 2> previous{};
    for (int i = 0; i < 48000; ++i) {
        const auto sample = oscillator.tick();
        require(std::isfinite(sample[0]) && std::isfinite(sample[1]), "finite spiral output");
        require(std::abs(sample[0] - previous[0]) < .5f, "continuous spiral output");
        peak = std::max(peak, std::abs(sample[0])); previous = sample;
    }
    require(peak > .01f && peak <= 1, "audible bounded spiral output");
    std::cout << "Geometry and native spiral resynthesis checks passed\n";
}
