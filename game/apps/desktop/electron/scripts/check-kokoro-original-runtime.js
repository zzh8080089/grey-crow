#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createKokoroOriginalProvider } = require("../tts-kokoro-original-provider");
const { createTtsService } = require(path.resolve(__dirname, "../../../..", "engine/tts/tts-service"));

if (!process.argv.includes("--allow-local-model")) {
  process.stderr.write("Refusing to load the original Kokoro runtime without --allow-local-model.\n");
  process.exit(2);
}

const runtimeRoot = process.env.GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT;
if (!runtimeRoot || !path.isAbsolute(runtimeRoot)) {
  process.stderr.write("GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT must be an absolute staging path.\n");
  process.exit(2);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-kokoro-original-live-"));
const voiceId = process.env.GREY_CROW_KOKORO_ORIGINAL_VOICE_ID || "zf_001";
const fullRuntimeSmoke = process.argv.includes("--full-runtime-smoke");
const provider = createKokoroOriginalProvider({
  runtimeRoot,
  outputRoot: tempRoot,
  readyTimeoutMs: 60_000,
  chunkTimeoutMs: 90_000,
});

main().catch((error) => {
  process.stderr.write(`${error?.code || "ERROR"}: ${error?.message || error}\n`);
  process.exitCode = 1;
}).finally(async () => {
  await provider.dispose().catch(() => {});
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function main() {
  const startedAt = Date.now();
  const cases = fullRuntimeSmoke ? createFullSmokeCases() : [{
    id: "short",
    text: "灰鸦原版中文语音正在通过私有进程生成这一小段测试文本。",
    voiceId,
  }];
  const results = [];
  for (const item of cases) {
    const outputFile = path.join(tempRoot, `${item.id}.wav`);
    const itemStartedAt = Date.now();
    const result = await provider.synthesizeToFile({
      text: item.text,
      voiceId: item.voiceId,
      rate: "+0%",
      outputFile,
    });
    const stat = fs.statSync(outputFile);
    if (!stat.isFile() || stat.size <= 44 || result.bytes !== stat.size) {
      throw new Error("Original Kokoro runtime smoke returned an invalid WAV file.");
    }
    const wav = inspectPcm16Wav(outputFile);
    if (wav.channels !== 1 || wav.sampleRate !== 24000 || wav.bitsPerSample !== 16 || wav.dataBytes <= 0) {
      throw new Error("Original Kokoro runtime smoke returned an unexpected WAV format.");
    }
    const expectedHash = crypto.createHash("sha256").update(item.text, "utf8").digest("hex");
    if (result.inputChars !== item.text.length || result.coverageHash !== expectedHash ||
        !Number.isInteger(result.inferenceChunks) || result.inferenceChunks < 1 ||
        !Number.isInteger(result.maxPhonemes) || result.maxPhonemes > 450) {
      throw new Error("Original Kokoro runtime smoke did not prove complete phoneme-safe coverage.");
    }
    results.push({
      id: item.id,
      elapsedMs: Date.now() - itemStartedAt,
      bytes: stat.size,
      sampleRate: result.sampleRate,
      durationMs: result.durationMs,
      voiceId: item.voiceId,
      textChars: Array.from(item.text).length,
      dataBytes: wav.dataBytes,
      inferenceChunks: result.inferenceChunks,
      maxPhonemes: result.maxPhonemes,
      coverageHash: result.coverageHash,
    });
  }

  let activeCancellation = null;
  let cacheReplay = null;
  if (fullRuntimeSmoke) {
    const controller = new AbortController();
    const cancellationStartedAt = Date.now();
    const canceledRequest = provider.synthesizeToFile({
      text: "雨声压过广播，旧的朗读请求应当在这里被立即取消。".repeat(20),
      voiceId: "zf_001",
      rate: "+0%",
      outputFile: path.join(tempRoot, "active-cancel.wav"),
      signal: controller.signal,
    });
    await delay(50);
    controller.abort();
    try {
      await canceledRequest;
      throw new Error("Active Kokoro cancellation unexpectedly completed synthesis.");
    } catch (error) {
      if (error?.code !== "KOKORO_REQUEST_CANCELLED") {
        throw error;
      }
    }
    const recoveryStartedAt = Date.now();
    const recovery = await provider.synthesizeToFile({
      text: "取消完成后，新的朗读已经恢复。",
      voiceId: "zf_001",
      rate: "+0%",
      outputFile: path.join(tempRoot, "after-active-cancel.wav"),
    });
    activeCancellation = {
      canceledInMs: recoveryStartedAt - cancellationStartedAt,
      recoveredInMs: Date.now() - recoveryStartedAt,
      recoveryBytes: recovery.bytes,
    };

    const sessionCacheRoot = path.join(tempRoot, "session-cache");
    const sessionService = createTtsService({
      cacheRoot: sessionCacheRoot,
      providers: { "kokoro-original-local": provider },
    });
    const sessionSettings = {
      audio: {
        tts: {
          enabled: true,
          provider: "kokoro-original-local",
          voiceId: "zf_001",
          rate: "+0%",
          pitch: "+0Hz",
          cacheUtteranceLimit: 20,
        },
      },
    };
    const replayText = "雨幕后的广播仍在重复，玩家沿着旧站台继续前进，并记住出口和同伴的位置。".repeat(7);
    const firstReading = await drainUtterance(sessionService, replayText, sessionSettings);
    const secondReading = await drainUtterance(sessionService, replayText, sessionSettings);
    if (!firstReading.length || firstReading[0].cacheHit ||
        !secondReading.every((segment) => segment.cacheHit)) {
      throw new Error("Original Kokoro utterance cache replay did not preserve complete segment hits.");
    }
    cacheReplay = {
      segmentCount: firstReading.length,
      firstPassCacheHits: firstReading.filter((segment) => segment.cacheHit).length,
      replayCacheHits: secondReading.filter((segment) => segment.cacheHit).length,
      manifestCount: sessionService.getCacheStatus(sessionSettings).utteranceCount,
    };
  }

  const loadedState = provider.getDebugState();
  if (!loadedState.workerLoaded || loadedState.queued !== 0 || loadedState.active) {
    throw new Error("Original Kokoro worker did not settle after continuous synthesis.");
  }
  await provider.dispose();
  if (provider.getDebugState().workerLoaded) {
    throw new Error("Original Kokoro worker remained loaded after dispose.");
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    fullRuntimeSmoke,
    elapsedMs: Date.now() - startedAt,
    cases: results,
    activeCancellation,
    cacheReplay,
    workerReleased: true,
  }) + "\n");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drainUtterance(service, text, settings) {
  const segments = [];
  let segment = await service.startUtterance({ text, settings });
  segments.push(segment);
  while (segment.hasMore) {
    segment = await service.continueUtterance({ utteranceId: segment.utteranceId });
    segments.push(segment);
  }
  return segments;
}

function createFullSmokeCases() {
  const longSentence = "雨水沿着旧站台的钢梁落下，玩家记住了出口、时间、同伴和仍未解决的线索。";
  const noPunctuationSeed = "雨水沿着旧站台钢梁落下玩家记住出口时间同伴和仍未解决线索";
  let longText = "";
  while (Array.from(longText).length < 850) {
    longText += longSentence;
  }
  if (Array.from(longText).length < 800 || Array.from(longText).length > 1000) {
    throw new Error("Full runtime smoke corpus must remain within 800-1000 characters.");
  }
  const noPunctuationText = noPunctuationSeed.repeat(Math.ceil(500 / noPunctuationSeed.length)).slice(0, 500);
  return [
    { id: "female-default", text: "默认女声正在确认灰鸦的中文叙事节奏。", voiceId: "zf_001" },
    { id: "female-alternate", text: "备用女声正在朗读雨夜里的短句。", voiceId: "zf_006" },
    { id: "male-default", text: "默认男声正在确认低沉对白的清晰度。", voiceId: "zm_010" },
    { id: "male-alternate", text: "备用男声正在朗读远处传来的警报。", voiceId: "zm_009" },
    { id: "no-punctuation-500", text: noPunctuationText, voiceId: "zf_001" },
    { id: "continuous-800", text: longText, voiceId: "zf_001" },
  ];
}

function inspectPcm16Wav(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Original Kokoro output is not a RIFF/WAVE file.");
  }
  let offset = 12;
  let format = null;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > buffer.length) {
      throw new Error("Original Kokoro WAV has a truncated chunk.");
    }
    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (!format || format.audioFormat !== 1 || !dataBytes) {
    throw new Error("Original Kokoro WAV is missing PCM format or audio data.");
  }
  return { ...format, dataBytes };
}
