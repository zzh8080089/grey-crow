#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTtsService } = require(path.resolve(__dirname, "../../../..", "engine/tts/tts-service"));
const {
  MAX_UTTERANCE_GRAPHEMES,
} = require(path.resolve(__dirname, "../../../..", "engine/tts/utterance-planner"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-tts-"));
let synthesizeCalls = 0;
const service = createTtsService({
  cacheRoot: tmp,
  cacheLimit: 40,
  providers: {
    "kokoro-original-local": {
      id: "kokoro-original-local",
      online: false,
      fileExtension: "wav",
      mimeType: "audio/wav",
      defaultVoiceId: "zf_001",
      async synthesizeToFile({ outputFile }) {
        synthesizeCalls += 1;
        fs.writeFileSync(outputFile, Buffer.from("RIFFmock-wave"));
      },
    },
  },
});

const settings = {
  audio: {
    tts: {
      enabled: true,
      provider: "kokoro-original-local",
      voiceId: "zf_001",
      rate: "+0%",
      pitch: "+0Hz",
    },
  },
};

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});

async function main() {
  const first = await service.synthesize({ text: "灰鸦测试朗读。", settings });
  assert(first.ok === true, "first synthesis should succeed.");
  assert(first.cacheHit === false, "first synthesis should not be a cache hit.");
  assert(first.dataUrl.startsWith("data:audio/wav;base64,"), "local synthesis must return a WAV data URL.");
  assert(!JSON.stringify(first).includes(tmp), "TTS result must not expose cache path.");

  const second = await service.synthesize({ text: "灰鸦测试朗读。", settings });
  assert(second.cacheHit === true, "second synthesis should hit cache.");
  assert(synthesizeCalls === 1, "cache hit should not call provider again.");

  const voiceRoutingRoot = path.join(tmp, "voice-routing");
  const routedVoices = [];
  const voiceRoutingService = createTtsService({
    cacheRoot: voiceRoutingRoot,
    providers: {
      "kokoro-original-local": {
        id: "kokoro-original-local",
        cacheVersion: "voice-routing-v1",
        fileExtension: "wav",
        mimeType: "audio/wav",
        defaultVoiceId: "zm_010",
        async synthesizeToFile({ voiceId, outputFile }) {
          routedVoices.push(voiceId);
          fs.writeFileSync(outputFile, Buffer.from(`RIFF${voiceId}`));
        },
      },
    },
  });
  const curatedVoiceIds = ["zf_001", "zf_006", "zm_010", "zm_009"];
  for (const voiceId of curatedVoiceIds) {
    const voiceSettings = {
      ...settings,
      audio: {
        ...settings.audio,
        tts: {
          ...settings.audio.tts,
          voiceId,
        },
      },
    };
    const result = await voiceRoutingService.synthesize({ text: "四音色路由测试。", settings: voiceSettings });
    assert(result.voiceId === voiceId, `TTS service should preserve curated voice ID ${voiceId}.`);
    assert(result.cacheHit === false, `the first ${voiceId} synthesis should not reuse another voice's cache.`);
  }
  assert(
    JSON.stringify(routedVoices) === JSON.stringify(curatedVoiceIds),
    "all four curated voice IDs must reach the provider unchanged."
  );
  assert(
    fs.readdirSync(voiceRoutingRoot).filter((name) => name.endsWith(".wav")).length === curatedVoiceIds.length,
    "different voice IDs must use isolated audio cache entries."
  );
  await voiceRoutingService.dispose();

  const versionedCacheRoot = path.join(tmp, "provider-cache-version");
  let versionedCalls = 0;
  for (const cacheVersion of ["test-v1", "test-v2"]) {
    const versionedService = createTtsService({
      cacheRoot: versionedCacheRoot,
      providers: {
        "kokoro-original-local": {
          id: "kokoro-original-local",
          cacheVersion,
          fileExtension: "wav",
          mimeType: "audio/wav",
          defaultVoiceId: "zf_001",
          async synthesizeToFile({ outputFile }) {
            versionedCalls += 1;
            fs.writeFileSync(outputFile, Buffer.from(`RIFF${cacheVersion}`));
          },
        },
      },
    });
    const versionedResult = await versionedService.synthesize({ text: "缓存实现版本隔离。", settings });
    assert(versionedResult.cacheHit === false, "a new provider cache version must not reuse old audio.");
    await versionedService.dispose();
  }
  assert(versionedCalls === 2, "provider cache versions must produce isolated audio files.");

  const beforeConcurrent = synthesizeCalls;
  const concurrent = await Promise.all([
    service.synthesize({ text: "并发合并朗读。", settings }),
    service.synthesize({ text: "并发合并朗读。", settings }),
  ]);
  assert(concurrent.every((result) => result.ok && result.mimeType === "audio/wav"), "coalesced requests should both receive valid WAV results.");
  assert(synthesizeCalls === beforeConcurrent + 1, "identical in-flight requests should synthesize only once.");
  assert(!fs.readdirSync(tmp).some((name) => /\.\d+\.[a-f0-9-]+\.(?:wav|mp3)$/.test(name)), "atomic synthesis temp files must be removed.");

  for (let index = 0; index < 45; index += 1) {
    await service.synthesize({ text: `灰鸦缓存测试 ${index}`, settings });
  }
  const audioFiles = fs.readdirSync(tmp).filter((name) => /\.(?:wav|mp3)$/.test(name));
  assert(audioFiles.length <= 40, "TTS cache must prune to 40 audio files.");

  const unavailableService = createTtsService({
    cacheRoot: path.join(tmp, "unavailable"),
    providers: {},
    unavailableProviders: {
      "kokoro-original-local": {
        code: "KOKORO_MODEL_MISSING",
        message: "未安装语音包。",
      },
    },
  });
  await expectFailure("missing Kokoro language pack", () => unavailableService.synthesize({
    text: "资源缺失时不能启动 worker。",
    settings,
  }), "KOKORO_MODEL_MISSING");
  assert(unavailableService.getStatus(settings).ok === false && unavailableService.getStatus(settings).errorCode === "KOKORO_MODEL_MISSING", "TTS status should project the stable missing-resource error.");
  await unavailableService.dispose();

  await expectFailure("disabled provider", () => service.synthesize({
    text: "灰鸦测试朗读。",
    settings: { audio: { tts: { enabled: false, provider: "disabled" } } },
  }), "TTS_PROVIDER_DISABLED");
  await expectFailure("long text", () => service.synthesize({
    text: "长".repeat(2100),
    settings,
  }), "TTS_TEXT_TOO_LONG");

  const sessionTexts = [];
  const sessionService = createTtsService({
    cacheRoot: path.join(tmp, "sessions"),
    cacheLimit: 40,
    providers: {
      "kokoro-original-local": {
        id: "kokoro-original-local",
        fileExtension: "wav",
        mimeType: "audio/wav",
        defaultVoiceId: "zf_001",
        async synthesizeToFile({ text, outputFile }) {
          sessionTexts.push(text);
          await new Promise((resolve) => setTimeout(resolve, 5));
          fs.writeFileSync(outputFile, Buffer.from("RIFFmock-session-wave"));
        },
      },
    },
  });

  const longNarration = Array.from({ length: 300 }, (_value, index) =>
    index % 47 === 46 ? "。" : String.fromCodePoint(0x4e00 + (index % 200))
  ).join("");
  const firstSegment = await sessionService.startUtterance({ text: longNarration, settings });
  assert(firstSegment.segmentIndex === 0, "utterance must begin at segment zero.");
  assert(firstSegment.segmentKind === "lead-1", "utterance must begin with lead-1.");
  assert(firstSegment.segmentCount >= 4, "300-character narration should expose short follow-up playback units.");
  assert(firstSegment.hasMore === true, "first segment should report remaining audio.");
  assertTtsSegmentProjection(firstSegment, tmp);

  const concurrentContinuation = await Promise.allSettled([
    sessionService.continueUtterance({ utteranceId: firstSegment.utteranceId }),
    sessionService.continueUtterance({ utteranceId: firstSegment.utteranceId }),
  ]);
  const fulfilled = concurrentContinuation.filter((entry) => entry.status === "fulfilled");
  const rejected = concurrentContinuation.filter((entry) => entry.status === "rejected");
  assert(fulfilled.length === 1, "only one concurrent continuation may advance an utterance.");
  assert(rejected.length === 1 && rejected[0].reason?.code === "TTS_UTTERANCE_BUSY", "concurrent continuation must fail with TTS_UTTERANCE_BUSY.");
  const secondSegment = fulfilled[0].value;
  assert(secondSegment.segmentIndex === 1 && secondSegment.segmentKind === "lead-2", "second utterance unit must be lead-2.");
  assertTtsSegmentProjection(secondSegment, tmp);

  const generatedSegments = [firstSegment, secondSegment];
  let nextSegment = secondSegment;
  while (nextSegment.hasMore) {
    nextSegment = await sessionService.continueUtterance({ utteranceId: firstSegment.utteranceId });
    generatedSegments.push(nextSegment);
    assertTtsSegmentProjection(nextSegment, tmp);
  }
  assert(generatedSegments.length === firstSegment.segmentCount, "utterance should emit every planned playback unit.");
  assert(generatedSegments.slice(2).every((segment) => segment.segmentKind === "tail"), "all units after the two leads must be Tail playback units.");
  assert(nextSegment.hasMore === false, "final utterance unit must close the session.");
  assert(sessionTexts.join("") === longNarration, "utterance synthesis must cover the source exactly once and in order.");
  await expectFailure("completed utterance", () => sessionService.continueUtterance({
    utteranceId: firstSegment.utteranceId,
  }), "TTS_UTTERANCE_NOT_FOUND");

  const callsBeforeReplay = sessionTexts.length;
  const replaySegments = [];
  let replay = await sessionService.startUtterance({ text: longNarration, settings });
  replaySegments.push(replay);
  while (replay.hasMore) {
    replay = await sessionService.continueUtterance({ utteranceId: replay.utteranceId });
    replaySegments.push(replay);
  }
  assert(replaySegments.length === firstSegment.segmentCount, "complete cache replay must preserve the original segment plan.");
  assert(replaySegments.every((segment) => segment.cacheHit), "complete cache replay must use every cached segment.");
  assert(sessionTexts.length === callsBeforeReplay, "complete cache replay must not call the provider again.");

  const expandedNarration = Array.from(
    { length: 1200 },
    (_value, index) => String.fromCodePoint(0x4e00 + index)
  ).join("");
  const cacheCountBeforeExpanded = sessionService.getCacheStatus(settings).utteranceCount;
  const expandedProviderCallStart = sessionTexts.length;
  const expandedSegments = [];
  let expanded = await sessionService.startUtterance({ text: expandedNarration, settings });
  expandedSegments.push(expanded);
  while (expanded.hasMore) {
    expanded = await sessionService.continueUtterance({ utteranceId: expanded.utteranceId });
    expandedSegments.push(expanded);
  }
  assert(expandedSegments.length > 10, "expanded utterance must continue to use bounded playback units.");
  assert(
    sessionTexts.slice(expandedProviderCallStart).join("") === expandedNarration,
    "expanded utterance synthesis must cover text beyond the former 1000-character limit."
  );
  assert(
    sessionService.getCacheStatus(settings).utteranceCount === cacheCountBeforeExpanded + 1,
    "one expanded utterance must consume one cache entry regardless of segment count."
  );

  const cancelStart = await sessionService.startUtterance({ text: longNarration, settings });
  const cancelResult = sessionService.cancelUtterance({ utteranceId: cancelStart.utteranceId });
  assert(cancelResult.ok && cancelResult.canceled, "active utterance cancellation must be acknowledged.");
  await expectFailure("canceled utterance", () => sessionService.continueUtterance({
    utteranceId: cancelStart.utteranceId,
  }), "TTS_UTTERANCE_NOT_FOUND");
  await expectFailure("utterance grapheme cap", () => sessionService.startUtterance({
    text: "长".repeat(MAX_UTTERANCE_GRAPHEMES + 1),
    settings,
  }), "TTS_TEXT_TOO_LONG", false);

  const raceNarration = "并发切换朗读正文。".repeat(20);
  const staleStart = sessionService.startUtterance({ text: raceNarration, settings });
  await new Promise((resolve) => setTimeout(resolve, 1));
  const latestStart = sessionService.startUtterance({ text: raceNarration, settings });
  const [staleOutcome, latestOutcome] = await Promise.allSettled([staleStart, latestStart]);
  assert(staleOutcome.status === "rejected" && staleOutcome.reason?.code === "TTS_UTTERANCE_CANCELLED", "replaced utterance should finish as canceled.");
  assert(latestOutcome.status === "fulfilled" && latestOutcome.value.dataUrl.startsWith("data:audio/wav"), "latest identical utterance must retain the shared audio file until it is read.");
  sessionService.cancelUtterance({ utteranceId: latestOutcome.value.utteranceId });
  await sessionService.dispose();

  let providerAbortCount = 0;
  const cancellationService = createTtsService({
    cacheRoot: path.join(tmp, "provider-cancel"),
    providers: {
      "kokoro-original-local": {
        id: "kokoro-original-local",
        fileExtension: "wav",
        mimeType: "audio/wav",
        defaultVoiceId: "zf_001",
        synthesizeToFile({ outputFile, signal }) {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              cleanup();
              fs.writeFileSync(outputFile, Buffer.from("RIFFmock-cancel-wave"));
              resolve();
            }, 100);
            const onAbort = () => {
              providerAbortCount += 1;
              cleanup();
              const error = new Error("provider synthesis canceled");
              error.code = "KOKORO_REQUEST_CANCELLED";
              reject(error);
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            function cleanup() {
              clearTimeout(timer);
              signal?.removeEventListener("abort", onAbort);
            }
          });
        },
      },
    },
  });
  const abandonedStart = cancellationService.startUtterance({
    text: "应被新朗读取消的旧正文。".repeat(12),
    settings,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const replacementStart = cancellationService.startUtterance({
    text: "替换后的新正文。",
    settings,
  });
  await expectFailure("provider cancellation propagation", () => abandonedStart, "TTS_UTTERANCE_CANCELLED", false);
  const replacement = await replacementStart;
  assert(replacement.ok && replacement.hasMore === false, "replacement utterance must continue after provider cancellation.");
  assert(providerAbortCount === 1, "canceling an unshared generation must abort its provider exactly once.");
  await cancellationService.dispose();

  const policyRoot = path.join(tmp, "utterance-policy");
  const policyService = createTtsService({
    cacheRoot: policyRoot,
    cacheByteLimit: 1024 * 1024,
    providers: {
      "kokoro-original-local": {
        id: "kokoro-original-local",
        fileExtension: "wav",
        mimeType: "audio/wav",
        defaultVoiceId: "zf_001",
        async synthesizeToFile({ outputFile }) {
          fs.writeFileSync(outputFile, Buffer.alloc(64, 1));
        },
      },
    },
  });
  const tenEntrySettings = withCacheUtteranceLimit(settings, 10);
  const fortyEntrySettings = withCacheUtteranceLimit(settings, 40);
  for (let index = 0; index < 12; index += 1) {
    const result = await policyService.startUtterance({
      text: `完整朗读缓存条目 ${String(index).padStart(2, "0")}。`,
      settings: fortyEntrySettings,
    });
    assert(result.hasMore === false, "short cache policy fixtures should complete in one segment.");
  }
  assert(policyService.getCacheStatus(fortyEntrySettings).utteranceCount === 12, "40-entry cache policy should retain all 12 complete fixtures.");
  const tenEntryStatus = policyService.applyCachePolicy(tenEntrySettings);
  assert(tenEntryStatus.utteranceCount === 10, "utterance cache must prune complete readings to the selected 10-entry limit.");
  assert(tenEntryStatus.utteranceLimit === 10 && tenEntryStatus.byteLimit === 1024 * 1024, "cache status must project active count and byte limits.");
  const manifests = fs.readdirSync(path.join(policyRoot, "utterances")).filter((name) => name.endsWith(".json"));
  assert(manifests.length === 10, "utterance cache must store one manifest per complete reading.");
  const manifestRaw = fs.readFileSync(path.join(policyRoot, "utterances", manifests[0]), "utf8");
  assert(!manifestRaw.includes("完整朗读") && !manifestRaw.includes(policyRoot), "utterance manifests must not store narration text or local paths.");
  await policyService.dispose();

  const bytePolicyRoot = path.join(tmp, "utterance-byte-policy");
  const bytePolicyService = createTtsService({
    cacheRoot: bytePolicyRoot,
    cacheByteLimit: 100,
    providers: {
      "kokoro-original-local": {
        id: "kokoro-original-local",
        fileExtension: "wav",
        mimeType: "audio/wav",
        defaultVoiceId: "zf_001",
        async synthesizeToFile({ outputFile }) {
          fs.writeFileSync(outputFile, Buffer.alloc(64, 2));
        },
      },
    },
  });
  await bytePolicyService.startUtterance({ text: "容量上限测试甲。", settings: withCacheUtteranceLimit(settings, 40) });
  await bytePolicyService.startUtterance({ text: "容量上限测试乙。", settings: withCacheUtteranceLimit(settings, 40) });
  const byteStatus = bytePolicyService.getCacheStatus(withCacheUtteranceLimit(settings, 40));
  assert(byteStatus.utteranceCount === 1 && byteStatus.bytes === 64, "500 MiB-style byte cap must evict LRU utterances independently from entry count.");
  await bytePolicyService.dispose();

  const brokenService = createTtsService({
    cacheRoot: path.join(tmp, "broken"),
    providers: {
      "kokoro-original-local": {
        id: "kokoro-original-local",
        fileExtension: "wav",
        mimeType: "audio/wav",
        async synthesizeToFile() {
          const error = new Error("missing model path must stay private");
          error.code = "KOKORO_MODEL_MISSING";
          throw error;
        },
      },
    },
  });
  await expectFailure("missing local model", () => brokenService.synthesize({
    text: "资源缺失",
    settings,
  }), "KOKORO_MODEL_MISSING", false);

  await service.dispose();

  process.stdout.write("TTS service checks passed\n");
}

function assertTtsSegmentProjection(result, privatePath) {
  const serialized = JSON.stringify(result);
  assert(typeof result.utteranceId === "string" && result.utteranceId.length >= 16, "utterance result must expose only an opaque session id.");
  assert(result.dataUrl.startsWith("data:audio/wav;base64,"), "utterance segment must expose playable audio data.");
  assert(!Object.hasOwn(result, "text") && !serialized.includes("鸦"), "utterance result must not expose source or segment text.");
  assert(!serialized.includes(privatePath), "utterance result must not expose local cache paths.");
}

function withCacheUtteranceLimit(source, cacheUtteranceLimit) {
  return {
    ...source,
    audio: {
      ...source.audio,
      tts: {
        ...source.audio.tts,
        cacheUtteranceLimit,
      },
    },
  };
}

async function expectFailure(label, fn, code, retryable = null) {
  try {
    await fn();
  } catch (error) {
    assert(error.code === code, `${label} should fail with ${code}.`);
    if (retryable !== null) {
      assert(error.retryable === retryable, `${label} retryable should be ${retryable}.`);
    }
    return;
  }
  throw new Error(`${label} should have failed.`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
