#include "Engine/Morphing.h"
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
    std::cout << "5 geometry checks passed (including 10201 plane positions)\n";
}
