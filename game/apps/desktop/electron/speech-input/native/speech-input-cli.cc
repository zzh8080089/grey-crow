#include "audio-input.h"
#include "sherpa-onnx/c-api/c-api.h"
#include <chrono>
#include <iostream>
#include <map>
#include <memory>
#include <sstream>
#ifdef _WIN32
#include <windows.h>
#endif

namespace {
using Clock = std::chrono::steady_clock;
double Seconds(Clock::time_point start) { return std::chrono::duration<double>(Clock::now() - start).count(); }
std::string Json(const std::string& value) {
  std::string result = "\"";
  constexpr char hex[] = "0123456789abcdef";
  for (unsigned char c : value) {
    if (c == '"' || c == '\\') { result += '\\'; result += c; }
    else if (c < 0x20) { result += "\\u00"; result += hex[c >> 4]; result += hex[c & 15]; }
    else result += c;
  }
  return result + '"';
}
struct Segment { speech_input::Range range; std::string text; };
int Run(const std::vector<std::string>& args) {
  if (args.size() == 2 && args[1] == "--version") {
    std::cout << "{\"protocolVersion\":1,\"runtime\":\"sherpa-onnx\",\"version\":\"1.13.8\",\"tts\":false,\"maxDurationSeconds\":120}\n";
    return 0;
  }
  std::map<std::string, std::string> options;
  for (size_t i = 1; i < args.size(); i += 2) {
    if (i + 1 >= args.size() || options.count(args[i]) ||
        (args[i] != "--model" && args[i] != "--tokens" && args[i] != "--input" &&
         args[i] != "--language" && args[i] != "--output")) throw std::runtime_error("INVALID_ARGUMENT");
    options[args[i]] = args[i + 1];
  }
  if (options.size() != 5 || (options["--language"] != "zh" && options["--language"] != "en" && options["--language"] != "ja"))
    throw std::runtime_error("INVALID_ARGUMENT");
  for (const auto* key : {"--model", "--tokens", "--input", "--output"}) {
    if (!std::filesystem::u8path(options[key]).is_absolute()) throw std::runtime_error("INVALID_ARGUMENT");
  }
  const auto output = std::filesystem::u8path(options["--output"]);
  for (const auto* key : {"--model", "--tokens", "--input"}) {
    const auto input = std::filesystem::u8path(options[key]);
    if (!std::filesystem::is_regular_file(input)) throw std::runtime_error("RESOURCE_UNAVAILABLE");
    if (output.lexically_normal() == input.lexically_normal() ||
        (std::filesystem::exists(output) && std::filesystem::equivalent(output, input)))
      throw std::runtime_error("INVALID_ARGUMENT");
  }
  const auto samples = speech_input::ReadWave(std::filesystem::u8path(options["--input"]));
  const auto ranges = speech_input::Split(samples);
  const bool has_audio = std::any_of(ranges.begin(), ranges.end(), [&](auto range) {
    return !speech_input::IsSilent(samples, range);
  });
  SherpaOnnxOfflineRecognizerConfig config{};
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.model_config.sense_voice.model = options["--model"].c_str();
  config.model_config.sense_voice.language = options["--language"].c_str();
  config.model_config.sense_voice.use_itn = 1;
  config.model_config.tokens = options["--tokens"].c_str();
  config.model_config.num_threads = 4;
  config.model_config.provider = "cpu";
  config.model_config.debug = 0;
  config.decoding_method = "greedy_search";
  const auto load_start = Clock::now();
  using Recognizer = std::unique_ptr<const SherpaOnnxOfflineRecognizer, decltype(&SherpaOnnxDestroyOfflineRecognizer)>;
  Recognizer recognizer(has_audio ? SherpaOnnxCreateOfflineRecognizer(&config) : nullptr, SherpaOnnxDestroyOfflineRecognizer);
  if (has_audio && !recognizer) throw std::runtime_error("MODEL_LOAD_FAILED");
  const double load_seconds = has_audio ? Seconds(load_start) : 0;
  const auto infer_start = Clock::now();
  std::vector<Segment> segments;
  std::string text;
  for (const auto range : ranges) {
    if (speech_input::IsSilent(samples, range)) { segments.push_back({range, ""}); continue; }
    using Stream = std::unique_ptr<const SherpaOnnxOfflineStream, decltype(&SherpaOnnxDestroyOfflineStream)>;
    Stream stream(SherpaOnnxCreateOfflineStream(recognizer.get()), SherpaOnnxDestroyOfflineStream);
    if (!stream) throw std::runtime_error("RECOGNITION_FAILED");
    SherpaOnnxAcceptWaveformOffline(stream.get(), 16000, samples.data() + range.begin,
                                 static_cast<int32_t>(range.end - range.begin));
    SherpaOnnxDecodeOfflineStream(recognizer.get(), stream.get());
    using Result = std::unique_ptr<const SherpaOnnxOfflineRecognizerResult, decltype(&SherpaOnnxDestroyOfflineRecognizerResult)>;
    Result result(SherpaOnnxGetOfflineStreamResult(stream.get()), SherpaOnnxDestroyOfflineRecognizerResult);
    if (!result || !result->text) throw std::runtime_error("RECOGNITION_FAILED");
    std::string part(result->text);
    if (part.size() > 65536 || text.size() + part.size() > 262144) throw std::runtime_error("RESULT_TOO_LARGE");
    if (!text.empty() && !part.empty() && options["--language"] == "en") text += ' ';
    text += part;
    segments.push_back({range, std::move(part)});
  }
  std::ostringstream json;
  json << "{\"protocolVersion\":1,\"text\":" << Json(text)
       << ",\"durationSeconds\":" << double(samples.size()) / 16000
       << ",\"modelLoadSeconds\":" << load_seconds
       << ",\"inferenceSeconds\":" << Seconds(infer_start) << ",\"segments\":[";
  for (size_t i = 0; i < segments.size(); ++i) {
    if (i) json << ',';
    json << "{\"startSeconds\":" << double(segments[i].range.begin) / 16000
         << ",\"endSeconds\":" << double(segments[i].range.end) / 16000
         << ",\"text\":" << Json(segments[i].text) << '}';
  }
  json << "]}\n";
  // The Node service gives each job a private new output path and accepts this
  // file only after exit code 0. Cancellation may leave a partial file to delete.
  std::ofstream file(output, std::ios::binary | std::ios::trunc);
  const auto serialized = json.str();
  if (!file || !file.write(serialized.data(), static_cast<std::streamsize>(serialized.size())) || !file.flush())
    throw std::runtime_error("OUTPUT_UNWRITABLE");
  return 0;
}
int SafeRun(const std::vector<std::string>& args) {
  try { return Run(args); }
  catch (const std::runtime_error& error) {
    const std::string code = error.what();
    const std::vector<std::string> known = {"INVALID_ARGUMENT", "INVALID_AUDIO", "INPUT_UNREADABLE", "RESOURCE_UNAVAILABLE", "MODEL_LOAD_FAILED", "RECOGNITION_FAILED", "RESULT_TOO_LARGE", "OUTPUT_UNWRITABLE"};
    std::cerr << (std::find(known.begin(), known.end(), code) != known.end() ? code : "RECOGNITION_FAILED") << '\n';
  } catch (...) { std::cerr << "RECOGNITION_FAILED\n"; }
  return 1;
}
}
#ifdef _WIN32
int wmain(int argc, wchar_t* argv[]) {
  std::vector<std::string> args;
  for (int i = 0; i < argc; ++i) {
    const int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1, nullptr, 0, nullptr, nullptr);
    if (count < 1) return 1;
    std::string utf8(count, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1, utf8.data(), count, nullptr, nullptr);
    utf8.pop_back(); args.push_back(std::move(utf8));
  }
  return SafeRun(args);
}
#else
int main(int argc, char* argv[]) { return SafeRun(std::vector<std::string>(argv, argv + argc)); }
#endif
