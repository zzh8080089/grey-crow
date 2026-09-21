#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace speech_input {
constexpr size_t kSampleRate = 16000;
constexpr size_t kMaxSamples = 120 * kSampleRate;
constexpr size_t kMaxSegmentSamples = 25 * kSampleRate;
struct Range { size_t begin; size_t end; };
// Only reject near-digital silence, not a general voice activity classifier.
// Noise and quiet real speech still need the player's review before submission.
inline bool IsSilent(const std::vector<float>& samples, Range range) {
  double energy = 0;
  float peak = 0;
  for (size_t i = range.begin; i < range.end; ++i) {
    energy += samples[i] * samples[i];
    peak = std::max(peak, std::abs(samples[i]));
  }
  return peak <= 0.001f && energy / std::max(size_t(1), range.end - range.begin) <= 1e-8;
}
inline uint16_t U16(const uint8_t* p) { return p[0] | (uint16_t(p[1]) << 8); }
inline uint32_t U32(const uint8_t* p) { return U16(p) | (uint32_t(U16(p + 2)) << 16); }
inline bool Tag(const uint8_t* p, const char* s) { return std::equal(p, p + 4, s); }
inline std::vector<float> ReadWave(const std::filesystem::path& file) {
  std::ifstream stream(file, std::ios::binary | std::ios::ate);
  if (!stream) throw std::runtime_error("INPUT_UNREADABLE");
  const auto length = stream.tellg();
  if (length < 44 || length > static_cast<std::streamoff>(2 * kMaxSamples + 65536))
    throw std::runtime_error("INVALID_AUDIO");
  std::vector<uint8_t> bytes(static_cast<size_t>(length));
  stream.seekg(0);
  if (!stream.read(reinterpret_cast<char*>(bytes.data()), length))
    throw std::runtime_error("INPUT_UNREADABLE");
  if (!Tag(bytes.data(), "RIFF") || !Tag(bytes.data() + 8, "WAVE") ||
      uint64_t(U32(bytes.data() + 4)) + 8 != bytes.size())
    throw std::runtime_error("INVALID_AUDIO");
  bool format_found = false, data_found = false;
  size_t data_offset = 0, data_length = 0;
  for (size_t at = 12; at < bytes.size();) {
    if (bytes.size() - at < 8) throw std::runtime_error("INVALID_AUDIO");
    const size_t count = U32(bytes.data() + at + 4);
    const size_t payload = at + 8;
    if (count > bytes.size() - payload) throw std::runtime_error("INVALID_AUDIO");
    if (Tag(bytes.data() + at, "fmt ")) {
      if (format_found || count < 16) throw std::runtime_error("INVALID_AUDIO");
      const auto* p = bytes.data() + payload;
      if (U16(p) != 1 || U16(p + 2) != 1 || U32(p + 4) != kSampleRate ||
          U32(p + 8) != kSampleRate * 2 || U16(p + 12) != 2 || U16(p + 14) != 16)
        throw std::runtime_error("INVALID_AUDIO");
      format_found = true;
    } else if (Tag(bytes.data() + at, "data")) {
      if (data_found || count % 2) throw std::runtime_error("INVALID_AUDIO");
      data_offset = payload; data_length = count; data_found = true;
    }
    at = payload + count + (count % 2);
    if (at > bytes.size()) throw std::runtime_error("INVALID_AUDIO");
  }
  if (!format_found || !data_found || data_length < kSampleRate / 5 ||
      data_length / 2 > kMaxSamples) throw std::runtime_error("INVALID_AUDIO");
  std::vector<float> samples(data_length / 2);
  for (size_t i = 0; i < samples.size(); ++i)
    samples[i] = static_cast<int16_t>(U16(bytes.data() + data_offset + 2 * i)) / 32768.0f;
  return samples;
}

// Partition every sample exactly once. Prefer a low-energy 160 ms pause in the
// final 10 seconds; an uninterrupted utterance necessarily has a hard boundary.
// No text deduplication: repeated words can be intentional player speech.
inline std::vector<Range> Split(const std::vector<float>& samples) {
  std::vector<Range> ranges;
  for (size_t begin = 0; begin < samples.size();) {
    size_t end = std::min(begin + kMaxSegmentSamples, samples.size());
    if (end < samples.size()) {
      constexpr size_t window = kSampleRate * 160 / 1000;
      constexpr size_t hop = kSampleRate / 50;
      const size_t search_begin = begin + 15 * kSampleRate;
      double best_energy = 1e99;
      size_t best = end;
      for (size_t at = search_begin; at + window <= end; at += hop) {
        double energy = 0;
        for (size_t j = at; j < at + window; ++j) energy += samples[j] * samples[j];
        energy /= window;
        // Prefer later pauses at equal energy, avoiding excess tiny segments.
        if (energy <= best_energy) { best_energy = energy; best = at + window / 2; }
      }
      if (best_energy < 0.0001) end = best;
    }
    ranges.push_back({begin, end});
    begin = end;
  }
  return ranges;
}
}  // namespace speech_input
