"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PROTOCOL_VERSION = 1;
const DEFAULT_WORKER_PATH = resolveDefaultWorkerPath();
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_CHUNK_TIMEOUT_MS = 90_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_PENDING = 4;
const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 16 * 1024;
const RESTART_WINDOW_MS = 30_000;
const MAX_RESTARTS_PER_WINDOW = 3;
const DEFAULT_VOICE_ID = "zm_010";
const SUPPORTED_VOICE_IDS = new Set(["zf_001", "zf_006", "zm_009", "zm_010"]);

function resolveDefaultWorkerPath() {
  if (process.resourcesPath && __dirname.includes("app.asar")) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "tts-kokoro-original-worker.py");
  }
  return path.join(__dirname, "tts-kokoro-original-worker.py");
}

function createKokoroOriginalProvider({
  runtimeRoot,
  outputRoot,
  workerPath = DEFAULT_WORKER_PATH,
  pythonExecutable = null,
  executableArguments = ["-u"],
  spawnImpl = spawn,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  chunkTimeoutMs = DEFAULT_CHUNK_TIMEOUT_MS,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  maxPending = DEFAULT_MAX_PENDING,
  maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
} = {}) {
  const resolvedRuntimeRoot = requireAbsolutePath(runtimeRoot, "runtimeRoot");
  const resolvedOutputRoot = requireAbsolutePath(outputRoot, "outputRoot");
  const resolvedWorkerPath = requireAbsolutePath(workerPath, "workerPath");
  const resolvedPython = pythonExecutable
    ? requireAbsolutePath(pythonExecutable, "pythonExecutable")
    : resolvePrivatePython(resolvedRuntimeRoot);
  const safeExecutableArguments = normalizeExecutableArguments(executableArguments);
  const safeReadyTimeoutMs = normalizeInteger(readyTimeoutMs, 1_000, 180_000, DEFAULT_READY_TIMEOUT_MS);
  const safeChunkTimeoutMs = normalizeInteger(chunkTimeoutMs, 1_000, 300_000, DEFAULT_CHUNK_TIMEOUT_MS);
  const safeShutdownTimeoutMs = normalizeInteger(shutdownTimeoutMs, 100, 10_000, DEFAULT_SHUTDOWN_TIMEOUT_MS);
  const safeMaxPending = normalizeInteger(maxPending, 1, 20, DEFAULT_MAX_PENDING);
  const safeMaxMessageBytes = normalizeInteger(
    maxMessageBytes,
    1_024,
    1024 * 1024,
    DEFAULT_MAX_MESSAGE_BYTES
  );

  let disposed = false;
  let generation = 0;
  let nextRequestId = 1;
  let workerState = null;
  let activeRequest = null;
  let pumping = false;
  let circuitOpenUntil = 0;
  let disposalPromise = null;
  let retirementFailure = null;
  const queuedRequests = [];
  const restartTimes = [];
  const retiringWorkers = new Set();

  const provider = {
    id: "kokoro-original-local",
    cacheVersion: "kokoro-original-zh-1.1-pytorch-v2-phoneme-safe",
    online: false,
    experimental: true,
    fileExtension: "wav",
    mimeType: "audio/wav",
    defaultVoiceId: DEFAULT_VOICE_ID,
    defaultFemaleVoiceId: "zf_001",
    defaultMaleVoiceId: "zm_010",
    voices: [
      { id: "zf_001", gender: "female", defaultForGender: true },
      { id: "zf_006", gender: "female", defaultForGender: false },
      { id: "zm_010", gender: "male", defaultForGender: true },
      { id: "zm_009", gender: "male", defaultForGender: false },
    ],

    synthesizeToFile({ text, voiceId, rate, outputFile, signal = null } = {}) {
      try {
        if (disposed) {
          throw createProviderError(
            "KOKORO_PROVIDER_DISPOSED",
            "Original Kokoro provider has been disposed."
          );
        }
        assertOriginalBundle({
          runtimeRoot: resolvedRuntimeRoot,
          workerPath: resolvedWorkerPath,
          pythonExecutable: resolvedPython,
        });
        const resolvedOutputFile = requireOutputFile(outputFile, resolvedOutputRoot);
        if (queuedRequests.length + (activeRequest ? 1 : 0) >= safeMaxPending) {
          throw createProviderError("KOKORO_QUEUE_FULL", "本地朗读队列已满，请稍后重试。");
        }
        fs.mkdirSync(path.dirname(resolvedOutputFile), { recursive: true });
        return new Promise((resolve, reject) => {
          const request = {
            abortHandler: null,
            id: null,
            text: normalizeText(text),
            voiceId: normalizeVoiceId(voiceId),
            speed: normalizeSpeed(rate),
            outputFile: resolvedOutputFile,
            resolve,
            reject,
            signal,
            timer: null,
          };
          queuedRequests.push(request);
          attachRequestAbort(request);
          if (signal?.aborted) {
            handleRequestAbort(request);
            return;
          }
          pumpQueue();
        });
      } catch (error) {
        return Promise.reject(error);
      }
    },

    dispose() {
      if (disposalPromise) {
        return disposalPromise;
      }
      disposed = true;
      disposalPromise = (async () => {
        const error = createProviderError(
          "KOKORO_PROVIDER_DISPOSED",
          "Original Kokoro provider has been disposed."
        );
        rejectQueued(error);
        rejectActive(error);
        const state = workerState;
        workerState = null;
        const stops = Array.from(retiringWorkers);
        if (state) {
          stops.push(stopWorker(state, { graceful: true, timeoutMs: safeShutdownTimeoutMs }));
        }
        await Promise.all(stops);
      })();
      disposalPromise.catch(() => {});
      return disposalPromise;
    },

    getDebugState() {
      return {
        workerLoaded: Boolean(workerState?.ready),
        active: Boolean(activeRequest),
        queued: queuedRequests.length,
        generation: workerState?.generation || generation,
        circuitOpen: Date.now() < circuitOpenUntil,
        not_model_visible: true,
      };
    },
  };

  return provider;

  async function pumpQueue() {
    if (pumping || disposed || activeRequest || queuedRequests.length === 0) {
      return;
    }
    pumping = true;
    try {
      while (!disposed && !activeRequest && queuedRequests.length > 0) {
        const request = queuedRequests.shift();
        activeRequest = request;
        try {
          const state = await ensureWorker();
          if (disposed) {
            request.reject(createProviderError(
              "KOKORO_PROVIDER_DISPOSED",
              "Original Kokoro provider has been disposed."
            ));
            continue;
          }
          request.id = `g${state.generation}:${nextRequestId++}`;
          request.timer = setTimeout(() => handleChunkTimeout(state, request), safeChunkTimeoutMs);
          request.timer.unref?.();
          await writeMessage(state.child, {
            jsonrpc: "2.0",
            id: request.id,
            method: "tts/synthesize",
            params: {
              text: request.text,
              voiceId: request.voiceId,
              speed: request.speed,
              outputFile: request.outputFile,
            },
          });
        } catch (error) {
          if (activeRequest === request) {
            clearActiveRequest();
          }
          request.reject(normalizeWorkerError(error));
        }
      }
    } finally {
      pumping = false;
      if (!disposed && !activeRequest && queuedRequests.length > 0) {
        queueMicrotask(() => pumpQueue());
      }
    }
  }

  async function ensureWorker() {
    if (workerState?.ready) {
      return workerState;
    }
    if (workerState?.readyPromise) {
      return workerState.readyPromise;
    }
    if (retiringWorkers.size > 0) {
      await Promise.allSettled(Array.from(retiringWorkers));
      if (retirementFailure) {
        throw retirementFailure;
      }
      if (disposed) {
        throw createProviderError("KOKORO_PROVIDER_DISPOSED", "Original Kokoro provider has been disposed.");
      }
      if (workerState?.ready) {
        return workerState;
      }
      if (workerState?.readyPromise) {
        return workerState.readyPromise;
      }
    }
    if (Date.now() < circuitOpenUntil) {
      throw createProviderError("KOKORO_WORKER_UNSTABLE", "本地朗读进程连续失败，请稍后重试。");
    }

    generation += 1;
    const child = spawnImpl(
      resolvedPython,
      [
        ...safeExecutableArguments,
        resolvedWorkerPath,
        "--bundle-root",
        resolvedRuntimeRoot,
        "--output-root",
        resolvedOutputRoot,
      ],
      {
        cwd: resolvedRuntimeRoot,
        detached: false,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: createPrivateWorkerEnvironment(resolvedRuntimeRoot),
      }
    );
    const state = createWorkerState(child, generation);
    workerState = state;
    state.readyPromise = new Promise((resolve, reject) => {
      state.resolveReady = resolve;
      state.rejectReady = reject;
    });
    state.readyPromise.catch(() => {});
    state.readyTimer = setTimeout(() => {
      const error = createProviderError("KOKORO_WORKER_READY_TIMEOUT", "本地朗读模型加载超时。");
      failAndRetireWorker(state, error, { restartFailure: true });
    }, safeReadyTimeoutMs);
    state.readyTimer.unref?.();
    attachWorkerStreams(state);

    const initId = `g${state.generation}:initialize`;
    state.initializeId = initId;
    try {
      await writeMessage(child, {
        jsonrpc: "2.0",
        id: initId,
        method: "worker/initialize",
        params: { protocolVersion: PROTOCOL_VERSION },
      });
    } catch (error) {
      failAndRetireWorker(state, normalizeWorkerError(error), { restartFailure: true });
    }
    return state.readyPromise;
  }

  function createWorkerState(child, workerGeneration) {
    return {
      child,
      generation: workerGeneration,
      buffer: "",
      stderrTail: "",
      ready: false,
      readyPromise: null,
      resolveReady: null,
      rejectReady: null,
      readyTimer: null,
      initializeId: null,
      finalized: false,
      intentionalStop: false,
    };
  }

  function attachWorkerStreams(state) {
    state.child.stdout.setEncoding("utf8");
    state.child.stderr.setEncoding("utf8");
    state.child.stdout.on("data", (chunk) => consumeStdout(state, chunk));
    state.child.stderr.on("data", (chunk) => {
      state.stderrTail = `${state.stderrTail}${chunk}`.slice(-DEFAULT_MAX_STDERR_BYTES);
    });
    state.child.stdin.on("error", (error) => {
      if (state.intentionalStop || state.finalized) {
        return;
      }
      failAndRetireWorker(state, normalizeWorkerError(error), { restartFailure: true });
    });
    state.child.on("error", (error) => {
      if (state.intentionalStop) {
        return;
      }
      failAndRetireWorker(state, normalizeWorkerError(error), { restartFailure: true });
    });
    state.child.on("close", (code, signal) => {
      if (state.finalized) {
        return;
      }
      const error = createProviderError(
        "KOKORO_WORKER_EXITED",
        `Original Kokoro worker stopped (${signal || code || "unknown"}).`
      );
      finalizeWorker(state, error, { restartFailure: !state.intentionalStop });
    });
  }

  function consumeStdout(state, chunk) {
    if (state.finalized || workerState !== state) {
      return;
    }
    state.buffer += chunk;
    if (Buffer.byteLength(state.buffer, "utf8") > safeMaxMessageBytes * 2) {
      handleProtocolFailure(state, "KOKORO_PROTOCOL_MESSAGE_TOO_LARGE");
      return;
    }
    let lineEnd = state.buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = state.buffer.slice(0, lineEnd).trim();
      state.buffer = state.buffer.slice(lineEnd + 1);
      if (line && Buffer.byteLength(line, "utf8") > safeMaxMessageBytes) {
        handleProtocolFailure(state, "KOKORO_PROTOCOL_MESSAGE_TOO_LARGE");
        return;
      }
      if (line) {
        let message;
        try {
          message = JSON.parse(line);
        } catch (_error) {
          handleProtocolFailure(state, "KOKORO_PROTOCOL_INVALID_JSON");
          return;
        }
        handleWorkerMessage(state, message);
      }
      lineEnd = state.buffer.indexOf("\n");
    }
  }

  function handleWorkerMessage(state, message) {
    if (!message || message.jsonrpc !== "2.0") {
      handleProtocolFailure(state, "KOKORO_PROTOCOL_INVALID_RESPONSE");
      return;
    }
    if (message.method === "worker/fatal") {
      const error = createProviderError(
        message?.params?.code || "KOKORO_MODEL_LOAD_FAILED",
        "Original Kokoro worker could not load."
      );
      failAndRetireWorker(state, error, { restartFailure: true });
      return;
    }
    if (message.id === state.initializeId) {
      if (message.error || message?.result?.protocolVersion !== PROTOCOL_VERSION) {
        handleProtocolFailure(state, "KOKORO_PROTOCOL_VERSION_MISMATCH");
        return;
      }
      clearTimeout(state.readyTimer);
      state.ready = true;
      state.resolveReady(state);
      return;
    }
    const request = activeRequest;
    if (!request || message.id !== request.id || !request.id.startsWith(`g${state.generation}:`)) {
      handleProtocolFailure(state, "KOKORO_PROTOCOL_UNEXPECTED_RESPONSE");
      return;
    }
    clearActiveRequest();
    if (message.error) {
      const error = createProviderError(
        message?.error?.data?.code || "KOKORO_SYNTHESIS_FAILED",
        message?.error?.message || "Original Kokoro synthesis failed."
      );
      request.reject(error);
    } else {
      request.resolve(message.result || {});
    }
    pumpQueue();
  }

  function handleProtocolFailure(state, code) {
    const error = createProviderError(code, "本地朗读进程返回了无效数据。");
    failAndRetireWorker(state, error, { restartFailure: true });
  }

  function handleChunkTimeout(state, request) {
    if (activeRequest !== request || workerState !== state) {
      return;
    }
    const error = createProviderError("KOKORO_CHUNK_TIMEOUT", "本段朗读生成超时。");
    clearActiveRequest();
    request.reject(error);
    failAndRetireWorker(state, error, { restartFailure: true, rejectCurrent: false });
  }

  function attachRequestAbort(request) {
    if (!request.signal || typeof request.signal.addEventListener !== "function") {
      return;
    }
    request.abortHandler = () => handleRequestAbort(request);
    request.signal.addEventListener("abort", request.abortHandler, { once: true });
  }

  function detachRequestAbort(request) {
    if (!request?.abortHandler) {
      return;
    }
    request.signal?.removeEventListener?.("abort", request.abortHandler);
    request.abortHandler = null;
  }

  function handleRequestAbort(request) {
    const error = createProviderError("KOKORO_REQUEST_CANCELLED", "本段朗读已取消。");
    const queuedIndex = queuedRequests.indexOf(request);
    if (queuedIndex >= 0) {
      queuedRequests.splice(queuedIndex, 1);
      detachRequestAbort(request);
      request.reject(error);
      return;
    }
    if (activeRequest !== request) {
      return;
    }
    const state = workerState;
    clearActiveRequest();
    request.reject(error);
    if (state) {
      failAndRetireWorker(state, error, { restartFailure: false, rejectCurrent: false });
    } else if (!disposed) {
      queueMicrotask(() => pumpQueue());
    }
  }

  function failAndRetireWorker(state, error, options = {}) {
    if (state.finalized) {
      return;
    }
    const retirement = retireWorker(state, { graceful: false });
    finalizeWorker(state, error, { ...options, deferPump: true });
    retirement.finally(() => {
      if (!disposed) {
        pumpQueue();
      }
    }).catch(() => {});
  }

  function retireWorker(state, { graceful }) {
    const retirement = stopWorker(state, {
      graceful,
      timeoutMs: safeShutdownTimeoutMs,
    });
    retiringWorkers.add(retirement);
    retirement.catch(() => {
      retirementFailure = createProviderError(
        "KOKORO_WORKER_STUCK",
        "旧的本地朗读进程无法确认退出，已停止自动重启。"
      );
      circuitOpenUntil = Number.POSITIVE_INFINITY;
    });
    retirement.finally(() => retiringWorkers.delete(retirement)).catch(() => {});
    return retirement;
  }

  function finalizeWorker(
    state,
    error,
    { restartFailure = false, rejectCurrent = true, deferPump = false } = {}
  ) {
    if (state.finalized) {
      return;
    }
    state.finalized = true;
    clearTimeout(state.readyTimer);
    state.ready = false;
    state.rejectReady?.(error);
    if (workerState === state) {
      workerState = null;
    }
    if (rejectCurrent && activeRequest) {
      const request = activeRequest;
      clearActiveRequest();
      request.reject(error);
    }
    if (restartFailure) {
      registerRestartFailure();
    }
    if (!disposed && !deferPump) {
      queueMicrotask(() => pumpQueue());
    }
  }

  function registerRestartFailure() {
    const now = Date.now();
    restartTimes.push(now);
    while (restartTimes.length && restartTimes[0] < now - RESTART_WINDOW_MS) {
      restartTimes.shift();
    }
    if (restartTimes.length > MAX_RESTARTS_PER_WINDOW) {
      circuitOpenUntil = now + RESTART_WINDOW_MS;
    }
  }

  function clearActiveRequest() {
    if (activeRequest?.timer) {
      clearTimeout(activeRequest.timer);
    }
    detachRequestAbort(activeRequest);
    activeRequest = null;
  }

  function rejectActive(error) {
    if (!activeRequest) {
      return;
    }
    const request = activeRequest;
    clearActiveRequest();
    request.reject(error);
  }

  function rejectQueued(error) {
    while (queuedRequests.length) {
      const request = queuedRequests.shift();
      detachRequestAbort(request);
      request.reject(error);
    }
  }
}

function writeMessage(child, payload) {
  if (!child?.stdin || child.stdin.destroyed || !child.stdin.writable) {
    return Promise.reject(createProviderError(
      "KOKORO_WORKER_NOT_WRITABLE",
      "Original Kokoro worker is unavailable."
    ));
  }
  const line = `${JSON.stringify(payload)}\n`;
  return new Promise((resolve, reject) => {
    try {
      child.stdin.write(line, "utf8", (error) => {
        if (error) {
          reject(normalizeWorkerError(error));
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(normalizeWorkerError(error));
    }
  });
}

async function stopWorker(state, { graceful, timeoutMs }) {
  if (!state?.child) {
    return;
  }
  state.intentionalStop = true;
  const child = state.child;
  if (!graceful) {
    child.kill("SIGTERM");
    if (await waitForClose(child, Math.min(500, timeoutMs))) {
      return;
    }
    child.kill("SIGKILL");
    await waitForClose(child, 500);
    return;
  }
  if (graceful && !child.killed && child.stdin?.writable) {
    try {
      await writeMessage(child, {
        jsonrpc: "2.0",
        id: `g${state.generation}:shutdown`,
        method: "worker/shutdown",
        params: {},
      });
      child.stdin.end();
    } catch (_error) {
      // The escalation below is the reliable shutdown path.
    }
  }
  if (await waitForClose(child, timeoutMs)) {
    return;
  }
  child.kill("SIGTERM");
  if (await waitForClose(child, Math.min(500, timeoutMs))) {
    return;
  }
  child.kill("SIGKILL");
  if (!await waitForClose(child, 2_000)) {
    throw createProviderError(
      "KOKORO_WORKER_STUCK",
      "Original Kokoro worker did not exit after SIGKILL."
    );
  }
}

function waitForClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    const onClose = () => finish(true);
    child.once("close", onClose);
    function finish(value) {
      clearTimeout(timer);
      child.removeListener("close", onClose);
      resolve(value);
    }
  });
}

function createPrivateWorkerEnvironment(runtimeRoot) {
  const pythonPath = process.platform === "win32"
    ? path.join(runtimeRoot, "python")
    : path.join(runtimeRoot, "python", "bin");
  const systemPaths = process.platform === "win32"
    ? [process.env.SystemRoot || process.env.WINDIR]
        .filter(Boolean)
        .map((root) => path.join(root, "System32"))
    : ["/usr/bin", "/bin"];
  const env = {
    HOME: path.join(runtimeRoot, "home"),
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    TOKENIZERS_PARALLELISM: "false",
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONUTF8: "1",
    PATH: [pythonPath, ...systemPaths].join(path.delimiter),
    LANG: process.env.LANG || "en_US.UTF-8",
  };
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"]) {
    if (process.env[name]) {
      env[name] = process.env[name];
    }
  }
  return env;
}

function assertOriginalBundle({ runtimeRoot, workerPath, pythonExecutable }) {
  const inspection = inspectOriginalBundle({ runtimeRoot, workerPath, pythonExecutable });
  if (!inspection.available) {
    throw createProviderError("KOKORO_MODEL_MISSING", "Original Kokoro resources are incomplete.");
  }
}

function inspectOriginalBundle({ runtimeRoot, workerPath = DEFAULT_WORKER_PATH, pythonExecutable = null } = {}) {
  const resolvedRuntimeRoot = requireAbsolutePath(runtimeRoot, "runtimeRoot");
  const resolvedWorkerPath = requireAbsolutePath(workerPath, "workerPath");
  const resolvedPython = pythonExecutable
    ? requireAbsolutePath(pythonExecutable, "pythonExecutable")
    : resolvePrivatePython(resolvedRuntimeRoot);
  const required = [
    resolvedWorkerPath,
    resolvedPython,
    path.join(resolvedRuntimeRoot, "models", "kokoro-original", "config.json"),
    path.join(resolvedRuntimeRoot, "models", "kokoro-original", "kokoro-v1_1-zh.pth"),
    path.join(resolvedRuntimeRoot, "models", "kokoro-original", "zf_001.pt"),
    path.join(resolvedRuntimeRoot, "models", "kokoro-original", "zf_006.pt"),
    path.join(resolvedRuntimeRoot, "models", "kokoro-original", "zm_009.pt"),
    path.join(resolvedRuntimeRoot, "models", "kokoro-original", "zm_010.pt"),
  ];
  const missing = required.filter((filePath) => !fs.existsSync(filePath));
  return {
    available: missing.length === 0,
    code: missing.length ? "KOKORO_MODEL_MISSING" : null,
    requiredCount: required.length,
    missingCount: missing.length,
  };
}

function resolvePrivatePython(runtimeRoot) {
  return process.platform === "win32"
    ? path.join(runtimeRoot, "python", "python.exe")
    : path.join(runtimeRoot, "python", "bin", "python3.12");
}

function requireOutputFile(value, outputRoot) {
  const resolved = requireAbsolutePath(value, "outputFile");
  if (path.extname(resolved).toLowerCase() !== ".wav" || !isInsideRoot(outputRoot, resolved)) {
    throw createProviderError("INVALID_KOKORO_OUTPUT", "Kokoro output must stay inside the TTS cache.");
  }
  return resolved;
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function normalizeText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw createProviderError("INVALID_TTS_INPUT", "没有可朗读文本。");
  }
  if (text.length > 1000) {
    throw createProviderError("TTS_TEXT_TOO_LONG", "本段文字过长，暂时不能朗读。");
  }
  return text;
}

function normalizeVoiceId(value) {
  const voiceId = typeof value === "string" ? value.trim() : "";
  if (!voiceId) {
    return DEFAULT_VOICE_ID;
  }
  if (!SUPPORTED_VOICE_IDS.has(voiceId)) {
    throw createProviderError("KOKORO_VOICE_UNSUPPORTED", "当前本地语音包没有安装这个音色。");
  }
  return voiceId;
}

function normalizeSpeed(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "default") {
    return 1;
  }
  const percent = /^([+-])(\d{1,3})%$/.exec(text);
  if (!percent) {
    return 1;
  }
  const delta = Number(percent[2]) / 100;
  return Math.min(2, Math.max(0.5, percent[1] === "+" ? 1 + delta : 1 - delta));
}

function normalizeInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeExecutableArguments(value) {
  if (!Array.isArray(value) || value.length > 8 || value.some((item) => typeof item !== "string")) {
    throw new Error("executableArguments must be a short string array.");
  }
  return value.slice();
}

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return path.resolve(value);
}

function normalizeWorkerError(error) {
  if (error?.code && String(error.code).startsWith("KOKORO_")) {
    return error;
  }
  return createProviderError("KOKORO_WORKER_FAILED", "Original Kokoro worker failed.");
}

function createProviderError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  PROTOCOL_VERSION,
  SUPPORTED_VOICE_IDS,
  createKokoroOriginalProvider,
  createPrivateWorkerEnvironment,
  inspectOriginalBundle,
  normalizeSpeed,
};
