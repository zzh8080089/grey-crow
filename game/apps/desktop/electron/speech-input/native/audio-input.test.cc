#include "audio-input.h"
#include <cassert>
#include <iostream>

using namespace speech_input;
void CheckCoverage(size_t length, bool with_pause) {
  std::vector<float> samples(length, 0.1f);
  if (with_pause && length > 23 * kSampleRate)
    std::fill(samples.begin() + 22 * kSampleRate, samples.begin() + 23 * kSampleRate, 0);
  const auto ranges = Split(samples);
  size_t cursor = 0;
  for (auto range : ranges) {
    assert(range.begin == cursor);
    assert(range.end > range.begin);
    assert(range.end - range.begin <= kMaxSegmentSamples);
    cursor = range.end;
  }
  assert(cursor == samples.size());
  if (with_pause && length > 25 * kSampleRate) {
    assert(ranges.front().end >= 22 * kSampleRate);
    assert(ranges.front().end <= 23 * kSampleRate);
  }
}
int main() {
  for (size_t count : {size_t(1600), 25 * kSampleRate, 25 * kSampleRate + 1,
                       26 * kSampleRate, 50 * kSampleRate, kMaxSamples}) {
    CheckCoverage(count, false);
    CheckCoverage(count, true);
  }
  std::vector<float> silent(16000, 0), quantization_noise(16000, 1.0f / 32768), quiet(16000, 0.002f);
  assert(IsSilent(silent, {0, silent.size()}));
  assert(IsSilent(quantization_noise, {0, quantization_noise.size()}));
  assert(!IsSilent(quiet, {0, quiet.size()}));
  std::cout << "All 12 segmentation coverage/boundary and 3 near-silence checks passed.\n";
}
