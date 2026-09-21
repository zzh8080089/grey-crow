#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createKokoroOriginalProvider,
  inspectOriginalBundle,
} = require("../tts-kokoro-original-provider");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-kokoro-original-provider-"));
const runtimeRoot = path.join(tempRoot, "runtime");
const outputRoot = path.join(tempRoot, "cache");
const workerPath = path.resolve(__dirname, "fixtures/kokoro-original-protocol-worker.js");

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function main() {
  const missingInspection = inspectOriginalBundle({
    runtimeRoot,
    workerPath,
    pythonExecutable: process.execPath,
  });
  assert(missingInspection.available === false && missingInspection.code === "KOKORO_MODEL_MISSING", "incomplete runtime staging should be reported without spawning a worker.");
  createRuntimeFixture(runtimeRoot);
  const completeInspection = inspectOriginalBundle({
    runtimeRoot,
    workerPath,
    pythonExecutable: process.execPath,
  });
  assert(completeInspection.available === true && completeInspection.missingCount === 0, "complete development staging should remain selectable.");
  const provider = createProvider();
  assert(provider.defaultVoiceId === "zm_010", "the original Kokoro provider should default to the curated male apocalypse voice.");
  assert(provider.getDebugState().workerLoaded === false, "provider must not spawn before a cache miss.");

  const firstOutput = path.join(outputRoot, "first.wav");
  const first = await provider.synthesizeToFile({
    text: "第一段朗读",
    voiceId: "zf_001",
    rate: "+20%",
    outputFile: firstOutput,
  });
  assert(first.bytes > 44 && fs.existsSync(firstOutput), "fixture synthesis should create a WAV file.");
  assert(provider.getDebugState().workerLoaded === true, "worker should stay loaded after synthesis.");
  const maleDefault = await provider.synthesizeToFile({
    text: "默认男声音色",
    voiceId: "zm_010",
    outputFile: path.join(outputRoot, "male-default.wav"),
  });
  assert(maleDefault.bytes > 44, "curated male default voice should synthesize.");
  await expectFailure(provider.synthesizeToFile({
    text: "未知音色",
    voiceId: "unknown_voice",
    outputFile: path.join(outputRoot, "unknown-voice.wav"),
  }), "KOKORO_VOICE_UNSUPPORTED");

  const queuedOne = provider.synthesizeToFile({
    text: "队列第一段",
    outputFile: path.join(outputRoot, "queue-1.wav"),
  });
  const queuedTwo = provider.synthesizeToFile({
    text: "队列第二段",
    outputFile: path.join(outputRoot, "queue-2.wav"),
  });
  await Promise.all([queuedOne, queuedTwo]);
  assert(provider.getDebugState().queued === 0, "single-concurrency queue should drain in order.");

  await expectFailure(provider.synthesizeToFile({
    text: "越界输出",
    outputFile: path.join(tempRoot, "outside.wav"),
  }), "INVALID_KOKORO_OUTPUT");

  const crashing = provider.synthesizeToFile({
    text: "__crash__",
    outputFile: path.join(outputRoot, "crash.wav"),
  });
  await expectFailure(crashing, "KOKORO_WORKER_EXITED");
  const recovered = await provider.synthesizeToFile({
    text: "崩溃后惰性重启",
    outputFile: path.join(outputRoot, "recovered.wav"),
  });
  assert(recovered.bytes > 44, "provider should recover on the next request after a crash.");
  await provider.dispose();
  assert(provider.getDebugState().workerLoaded === false, "dispose should release the private worker.");

  const timeoutProvider = createProvider({ chunkTimeoutMs: 1_000, maxPending: 2 });
  const eventFile = path.join(runtimeRoot, "worker-events.jsonl");
  fs.rmSync(eventFile, { force: true });
  const hanging = timeoutProvider.synthesizeToFile({
    text: "__hang__",
    outputFile: path.join(outputRoot, "hang.wav"),
  });
  const afterTimeout = timeoutProvider.synthesizeToFile({
    text: "超时后保留的队列请求",
    outputFile: path.join(outputRoot, "after-timeout.wav"),
  });
  await expectFailure(hanging, "KOKORO_CHUNK_TIMEOUT");
  const timeoutRecovery = await afterTimeout;
  assert(timeoutRecovery.bytes > 44, "queued request should continue on a fresh worker after timeout.");
  const timeoutEvents = readEvents(eventFile);
  const timeoutStarts = timeoutEvents.filter((event) => event.type === "start");
  const firstStopIndex = timeoutEvents.findIndex((event) => event.type === "stop");
  const secondStartIndex = timeoutEvents.findIndex((event, index) => event.type === "start" && index > 0);
  if (process.platform === "win32") {
    assert(timeoutStarts.length === 2 && !isProcessAlive(timeoutStarts[0].pid),
      "Windows replacement worker must start only after the timed-out worker exits.");
  } else {
    assert(firstStopIndex >= 0 && secondStartIndex > firstStopIndex,
      "replacement worker must start only after the timed-out worker exits.");
  }
  await timeoutProvider.dispose();

  fs.rmSync(eventFile, { force: true });
  const killEscalationProvider = createProvider({ chunkTimeoutMs: 1_000, shutdownTimeoutMs: 200 });
  const ignoresTerm = killEscalationProvider.synthesizeToFile({
    text: "__hang_ignore_sigterm__",
    outputFile: path.join(outputRoot, "ignore-term.wav"),
  });
  const afterKillEscalation = killEscalationProvider.synthesizeToFile({
    text: "SIGKILL 后恢复",
    outputFile: path.join(outputRoot, "after-sigkill.wav"),
  });
  await expectFailure(ignoresTerm, "KOKORO_CHUNK_TIMEOUT");
  assert((await afterKillEscalation).bytes > 44,
    "provider should wait for SIGKILL close before starting the replacement worker.");
  const killEvents = readEvents(eventFile);
  const killStarts = killEvents.filter((event) => event.type === "start");
  assert(killStarts.length === 2 && !isProcessAlive(killStarts[0].pid),
    "SIGKILL escalation must confirm the old pid exited before recovery succeeds.");
  await killEscalationProvider.dispose();

  const boundedProvider = createProvider({ chunkTimeoutMs: 1_000, maxPending: 1 });
  const boundedHang = boundedProvider.synthesizeToFile({
    text: "__hang__",
    outputFile: path.join(outputRoot, "bounded-hang.wav"),
  });
  await expectFailure(boundedProvider.synthesizeToFile({
    text: "队列不得无限增长",
    outputFile: path.join(outputRoot, "bounded-overflow.wav"),
  }), "KOKORO_QUEUE_FULL");
  await expectFailure(boundedHang, "KOKORO_CHUNK_TIMEOUT");
  await boundedProvider.dispose();

  fs.rmSync(eventFile, { force: true });
  const cancellationProvider = createProvider({ chunkTimeoutMs: 5_000 });
  const cancellationController = new AbortController();
  const canceledSynthesis = cancellationProvider.synthesizeToFile({
    text: "__hang__",
    outputFile: path.join(outputRoot, "canceled.wav"),
    signal: cancellationController.signal,
  });
  await waitFor(() => {
    const state = cancellationProvider.getDebugState();
    return state.workerLoaded && state.active;
  }, 2_000, "cancellation fixture did not reach active synthesis");
  cancellationController.abort();
  await expectFailure(canceledSynthesis, "KOKORO_REQUEST_CANCELLED");
  const afterCancellation = await cancellationProvider.synthesizeToFile({
    text: "取消后由新进程继续",
    outputFile: path.join(outputRoot, "after-cancel.wav"),
  });
  assert(afterCancellation.bytes > 44, "provider should recover after an active request cancellation.");
  const cancellationEvents = readEvents(eventFile);
  const cancellationStarts = cancellationEvents.filter((event) => event.type === "start");
  assert(cancellationStarts.length === 2 && !isProcessAlive(cancellationStarts[0].pid),
    `active cancellation must stop the old worker before starting its replacement: ${JSON.stringify(cancellationEvents)}`);
  await cancellationProvider.dispose();

  fs.writeFileSync(path.join(runtimeRoot, "hang-ready"), "fixture");
  const readyTimeoutProvider = createProvider({ readyTimeoutMs: 1_000 });
  await expectFailure(readyTimeoutProvider.synthesizeToFile({
    text: "模型加载握手超时",
    outputFile: path.join(outputRoot, "ready-timeout.wav"),
  }), "KOKORO_WORKER_READY_TIMEOUT");
  await readyTimeoutProvider.dispose();
  fs.rmSync(path.join(runtimeRoot, "hang-ready"), { force: true });

  const protocolProvider = createProvider();
  await expectFailure(protocolProvider.synthesizeToFile({
    text: "__invalid_json__",
    outputFile: path.join(outputRoot, "invalid-json.wav"),
  }), "KOKORO_PROTOCOL_INVALID_JSON");
  const protocolRecovery = await protocolProvider.synthesizeToFile({
    text: "协议错误后重新启动",
    outputFile: path.join(outputRoot, "protocol-recovered.wav"),
  });
  assert(protocolRecovery.bytes > 44, "provider should recover after invalid protocol output.");
  await protocolProvider.dispose();

  const framingProvider = createProvider();
  const fragmented = await framingProvider.synthesizeToFile({
    text: "__fragmented__",
    outputFile: path.join(outputRoot, "fragmented.wav"),
  });
  assert(fragmented.bytes > 44, "JSONL parser should accept a response split across stdout chunks.");
  const noisy = await framingProvider.synthesizeToFile({
    text: "__stderr__",
    outputFile: path.join(outputRoot, "stderr.wav"),
  });
  assert(noisy.bytes > 44, "large stderr output must not block protocol responses.");
  await framingProvider.dispose();

  const stdinProvider = createProvider({ chunkTimeoutMs: 2_000 });
  await stdinProvider.synthesizeToFile({
    text: "__close_stdin__",
    outputFile: path.join(outputRoot, "close-stdin.wav"),
  });
  const afterClosedStdin = stdinProvider.synthesizeToFile({
    text: "stdin 已关闭",
    outputFile: path.join(outputRoot, "epipe.wav"),
  });
  if (process.platform === "win32") {
    try {
      const buffered = await afterClosedStdin;
      assert(buffered.bytes > 44, "Windows may accept one buffered pipe write before observing closure.");
    } catch (error) {
      assert(["KOKORO_WORKER_FAILED", "KOKORO_WORKER_EXITED", "KOKORO_CHUNK_TIMEOUT"].includes(error.code),
        `unexpected Windows closed-pipe result: ${error.code}`);
    }
  } else {
    await expectFailureOneOf(afterClosedStdin, ["KOKORO_WORKER_FAILED", "KOKORO_WORKER_EXITED"]);
  }
  const stdinRecovery = await stdinProvider.synthesizeToFile({
    text: "EPIPE 后恢复",
    outputFile: path.join(outputRoot, "epipe-recovered.wav"),
  });
  assert(stdinRecovery.bytes > 44, "stdin failure must not terminate the parent and should recover.");
  await stdinProvider.dispose();

  const activeDisposeProvider = createProvider({ chunkTimeoutMs: 5_000 });
  const activeDuringDispose = activeDisposeProvider.synthesizeToFile({
    text: "__hang__",
    outputFile: path.join(outputRoot, "dispose-active.wav"),
  });
  await delay(50);
  const activeDispose = activeDisposeProvider.dispose();
  const concurrentDispose = activeDisposeProvider.dispose();
  assert(activeDispose === concurrentDispose, "concurrent dispose calls must share one shutdown promise.");
  await expectFailure(activeDuringDispose, "KOKORO_PROVIDER_DISPOSED");
  await activeDispose;
  assert(activeDisposeProvider.getDebugState().workerLoaded === false,
    "dispose during synthesis must wait for the worker to exit.");

  process.stdout.write("Kokoro original stdio provider checks passed\n");
}

function createProvider(overrides = {}) {
  return createKokoroOriginalProvider({
    runtimeRoot,
    outputRoot,
    workerPath,
    pythonExecutable: process.execPath,
    executableArguments: [],
    readyTimeoutMs: 5_000,
    shutdownTimeoutMs: 500,
    ...overrides,
  });
}

function createRuntimeFixture(root) {
  for (const relativePath of [
    "models/kokoro-original/config.json",
    "models/kokoro-original/kokoro-v1_1-zh.pth",
    "models/kokoro-original/zf_001.pt",
    "models/kokoro-original/zf_006.pt",
    "models/kokoro-original/zm_009.pt",
    "models/kokoro-original/zm_010.pt",
  ]) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "fixture");
  }
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
}

async function expectFailure(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert(error.code === code, `expected ${code}, got ${error.code}`);
    return;
  }
  throw new Error(`expected failure ${code}`);
}

async function expectFailureOneOf(promise, codes) {
  try {
    await promise;
  } catch (error) {
    assert(codes.includes(error.code), `expected one of ${codes.join(", ")}, got ${error.code}`);
    return;
  }
  throw new Error(`expected failure ${codes.join(" or ")}`);
}

function readEvents(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(10);
  }
  throw new Error(message);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
