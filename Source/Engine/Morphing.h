#pragma once
#include <array>
#include <cmath>
#include <cstddef>
namespace timbre {
struct Point { float x = 0.5f, y = 0.5f; };
// Baseline geometry only. A learned representation must implement its own backend.
class MorphBackend {
public:
    virtual ~MorphBackend() = default;
    virtual std::array<float, 4> weights(Point cursor,
        const std::array<Point, 4>& points, const std::array<bool, 4>& active) const = 0;
};
class SampleBlend final : public MorphBackend {
public:
    std::array<float, 4> weights(Point c, const std::array<Point, 4>& p,
                               const std::array<bool, 4>& active) const override {
        std::array<float, 4> w{}; float total = 0;
        for (std::size_t i = 0; i < 4; ++i) if (active[i]) {
            const auto dx = c.x - p[i].x, dy = c.y - p[i].y;
            w[i] = 1.0f / (0.0001f + dx * dx + dy * dy); total += w[i];
        }
        if (total > 0) for (auto& v : w) v /= total;
        return w;
    }
};
}
