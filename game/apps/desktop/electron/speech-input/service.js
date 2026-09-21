"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { createSpeechResources, speechError } = require("./resources");

const MAX_SECONDS = 120;
const SAMPLE_RATE = 16000;
const MAX_AUDIO_BYTES = SAMPLE_RATE * 2 * MAX_SECONDS + 4096;
const LANGUAGE_SET = new Set(["zh", "en", "ja"]);

async function cleanupSpeechRecordings(root) {
  const directory = path.join(root, "recordings");
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw speechError("SPEECH_STORAGE_FAILED");
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (/^task-[a-zA-Z0-9-]+$/.test(entry.name)) await fs.rm(path.join(directory, entry.name), { recursive: true, force: true });
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const ERROR_MESSAGES = Object.freeze({
  SPEECH_DISABLED: "请先在声音设置中启用语音输入。",
  SPEECH_BUSY: "上一项语音操作仍在处理，请稍后重试。",
  SPEECH_MODEL_MISSING: "请先下载语音输入模型。文字输入仍可使用。",
  SPEECH_MODEL_INVALID: "语音模型文件不完整，请重新下载。",
  SPEECH_RUNTIME_MISSING: "此版本缺少适用于当前电脑的语音组件。文字输入仍可使用。",
  SPEECH_DOWNLOAD_FAILED: "模型下载失败，请检查网络后重试。",
  SPEECH_DOWNLOAD_TIMEOUT: "模型下载等待过久，已停止。请稍后重试。",
  SPEECH_DISK_FULL: "可用磁盘空间不足，请腾出空间后重试。",
  SPEECH_AUDIO_INVALID: "录音格式无效，请重新录音。",
  SPEECH_TOO_LONG: "单次录音最多2分钟，请分次输入。",
  SPEECH_NO_SPEECH: "没有识别到清晰的语音，请靠近麦克风重试。",
  SPEECH_CANCELLED: "已取消语音操作，原输入已保留。",
  SPEECH_TIMEOUT: "语音识别等待过久，已停止。请缩短录音后重试。",
  SPEECH_FAILED: "本地语音识别失败，请重试或使用文字输入。",
  SPEECH_STALE: "当前输入场景已变化，识别结果未写入。",
  SPEECH_STORAGE_FAILED: "无法读写语音临时文件，请检查磁盘空间和权限。",
});

function failure(error) {
  let code = error?.code;
  if (["ENOSPC"].includes(code)) code = "SPEECH_DISK_FULL";
  else if (["EACCES", "EPERM", "EROFS"].includes(code)) code = "SPEECH_STORAGE_FAILED";
  if (!ERROR_MESSAGES[code]) code = "SPEECH_FAILED";
  return { ok: false, error: { code, message: ERROR_MESSAGES[code], retryable: !["SPEECH_DISABLED", "SPEECH_STALE"].includes(code) } };
}

function decodeWav(input) {
  let audio;
  if (input instanceof ArrayBuffer) audio = Buffer.from(input);
  else if (ArrayBuffer.isView(input)) audio = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  else throw speechError("SPEECH_AUDIO_INVALID");
  if (audio.length > MAX_AUDIO_BYTES) throw speechError("SPEECH_TOO_LONG");
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE"
    || audio.readUInt32LE(4) + 8 !== audio.length) throw speechError("SPEECH_AUDIO_INVALID");
  let offset = 12, format = false, data = null;
  while (offset + 8 <= audio.length) {
    const id = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    offset += 8;
    if (size > audio.length - offset) throw speechError("SPEECH_AUDIO_INVALID");
    if (id === "fmt ") {
      if (format || size < 16 || audio.readUInt16LE(offset) !== 1 || audio.readUInt16LE(offset + 2) !== 1
        || audio.readUInt32LE(offset + 4) !== SAMPLE_RATE || audio.readUInt32LE(offset + 8) !== SAMPLE_RATE * 2
        || audio.readUInt16LE(offset + 12) !== 2 || audio.readUInt16LE(offset + 14) !== 16) throw speechError("SPEECH_AUDIO_INVALID");
      format = true;
    } else if (id === "data") {
      if (data || size % 2) throw speechError("SPEECH_AUDIO_INVALID");
      data = audio.subarray(offset, offset + size);
    }
    offset += size + (size % 2);
  }
  if (offset !== audio.length || !format || !data || data.length < SAMPLE_RATE / 5 * 2) throw speechError("SPEECH_AUDIO_INVALID");
  const seconds = data.length / (SAMPLE_RATE * 2);
  if (seconds > MAX_SECONDS) throw speechError("SPEECH_TOO_LONG");
  // Canonical header keeps the native boundary small even for RIFF files with extra chunks.
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24); wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return { wav, seconds };
}

async function runNative({ executable, modelRoot, input, output, language, signal, timeoutMs = 180000 }) {
  if (signal.aborted) throw speechError("SPEECH_CANCELLED");
  await new Promise((resolve, reject) => {
    let child, killTimer, reason = null, outputBytes = 0;
    const finish = (error) => {
      clearTimeout(timeout); clearTimeout(killTimer); signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const stop = (code) => {
      reason ||= speechError(code);
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        killTimer ||= setTimeout(() => child.kill("SIGKILL"), 3000);
      }
    };
    const abort = () => stop("SPEECH_CANCELLED");
    const timeout = setTimeout(() => stop("SPEECH_TIMEOUT"), timeoutMs);
    try {
      child = spawn(executable, ["--model", path.join(modelRoot, "model.int8.onnx"), "--tokens", path.join(modelRoot, "tokens.txt"),
        "--input", input, "--language", language, "--output", output], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false });
    } catch (error) { finish(speechError("SPEECH_RUNTIME_MISSING")); return; }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const consume = (chunk) => { outputBytes += chunk.length; if (outputBytes > 65536) stop("SPEECH_FAILED"); };
    child.stdout.on("data", consume); child.stderr.on("data", consume);
    child.once("error", () => { reason ||= speechError("SPEECH_RUNTIME_MISSING"); });
    child.once("close", (code) => finish(reason || (code === 0 ? null : speechError("SPEECH_FAILED"))));
  });
}

function createSpeechInputService({ root, runtimeRoot, bundledModelRoot = null, getSettings, fetchImpl, runner = runNative, resources, timeoutMs = 180000 }) {
  if (!path.isAbsolute(root) || !path.isAbsolute(runtimeRoot)) throw new TypeError("Speech paths must be absolute");
  if (bundledModelRoot !== null && !path.isAbsolute(bundledModelRoot)) throw new TypeError("Bundled speech model root must be absolute");
  const model = resources || createSpeechResources({ root, bundledModelRoot, fetchImpl });
  const executable = path.join(runtimeRoot, "bin", process.platform === "win32" ? "speech-input-cli.exe" : "speech-input-cli");
  let operation = null, disposed = false, progress = { received: 0, total: model.totalBytes };
  const settings = () => getSettings()?.audio?.input || {};
  const ensureEnabled = () => { if (disposed) throw speechError("SPEECH_CANCELLED"); if (!settings().enabled) throw speechError("SPEECH_DISABLED"); };
  async function runtimeAvailable() { try { const stat = await fs.stat(executable); return stat.isFile(); } catch { return false; } }
  async function resolveModel(options) {
    if (typeof model.resolve === "function") return model.resolve(options);
    return await model.verify(options) ? { modelRoot: model.modelRoot, source: "download" } : null;
  }
  async function status() {
    const [resolvedModel, availableRuntime] = await Promise.all([resolveModel(), runtimeAvailable()]);
    const modelInstalled = Boolean(resolvedModel);
    return { ok: true, status: { enabled: Boolean(settings().enabled), available: modelInstalled && availableRuntime,
      modelInstalled, modelSource: resolvedModel?.source || null, bundledModel: resolvedModel?.source === "bundled",
      runtimeAvailable: availableRuntime, modelBytes: model.totalBytes, downloadBytes: resolvedModel?.source === "bundled" ? 0 : model.totalBytes,
      downloading: operation?.kind === "install", busy: Boolean(operation), progress: { ...progress },
      errorCode: !availableRuntime ? "SPEECH_RUNTIME_MISSING" : !modelInstalled ? "SPEECH_MODEL_MISSING" : null } };
  }
  function perform(kind, requestId, work) {
    if (disposed) throw speechError("SPEECH_CANCELLED");
    if (kind === "transcribe") ensureEnabled();
    if (operation) throw speechError("SPEECH_BUSY");
    const current = { kind, requestId, controller: new AbortController(), done: null };
    operation = current;
    current.done = Promise.resolve().then(async () => {
      const result = await work(current.controller.signal);
      // Include result reads and temporary-file cleanup in the cancellation boundary.
      if (kind === "transcribe" && current.controller.signal.aborted) throw speechError("SPEECH_CANCELLED");
      return result;
    }).finally(() => { if (operation === current) operation = null; });
    return current.done;
  }
  async function install() {
    return perform("install", "model-download", async (signal) => {
      if (!await runtimeAvailable()) throw speechError("SPEECH_RUNTIME_MISSING");
      progress = { received: 0, total: model.totalBytes };
      let expired = false;
      const timer = setTimeout(() => { expired = true; operation?.controller.abort(); }, 20 * 60 * 1000);
      try { await model.install({ signal, onProgress: (value) => { progress = value; } }); return { ok: true }; }
      catch (error) { if (expired) throw speechError("SPEECH_DOWNLOAD_TIMEOUT"); if (error.code?.startsWith("SPEECH_") || ["ENOSPC", "EACCES", "EPERM"].includes(error.code)) throw error; throw speechError("SPEECH_DOWNLOAD_FAILED"); }
      finally { clearTimeout(timer); }
    });
  }
  async function cancel({ requestId } = {}) {
    const current = operation;
    if (current && (!requestId || requestId === current.requestId)) {
      current.controller.abort();
      await current.done.catch(() => {});
    }
    return { ok: true };
  }
  async function remove() { return perform("remove", "model-remove", async () => { await model.remove(); return { ok: true }; }); }
  async function transcribe(payload) {
    if (!payload || typeof payload.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(payload.requestId)) throw speechError("SPEECH_AUDIO_INVALID");
    const { wav, seconds } = decodeWav(payload.audio);
    const language = settings().language || "zh";
    if (!LANGUAGE_SET.has(language)) throw speechError("SPEECH_AUDIO_INVALID");
    return perform("transcribe", payload.requestId, async (signal) => {
      const started = performance.now();
      if (!await runtimeAvailable()) throw speechError("SPEECH_RUNTIME_MISSING");
      const resolvedModel = await resolveModel({ force: true, signal });
      if (!resolvedModel) throw speechError("SPEECH_MODEL_MISSING");
      if (signal.aborted) throw speechError("SPEECH_CANCELLED");
      const tempRoot = path.join(root, "recordings");
      await fs.mkdir(tempRoot, { recursive: true, mode: 0o700 });
      // The app has a single-instance lock. Clear only this module's orphaned task directories.
      await cleanupSpeechRecordings(root);
      const directory = await fs.mkdtemp(path.join(tempRoot, "task-"));
      try {
        const input = path.join(directory, "input.wav"), output = path.join(directory, "result.json");
        await fs.writeFile(input, wav, { mode: 0o600 });
        await runner({ executable, modelRoot: resolvedModel.modelRoot, input, output, language, signal, timeoutMs });
        if (signal.aborted) throw speechError("SPEECH_CANCELLED");
        const stat = await fs.stat(output);
        if (!stat.isFile() || stat.size > 256 * 1024) throw speechError("SPEECH_FAILED");
        const result = JSON.parse(await fs.readFile(output, "utf8"));
        if (signal.aborted) throw speechError("SPEECH_CANCELLED");
        if (typeof result.text !== "string" || result.text.length > 64000) throw speechError("SPEECH_FAILED");
        const text = result.text.replace(/<\|[^|]*\|>/g, "").trim();
        if (!text) throw speechError("SPEECH_NO_SPEECH");
        return { ok: true, result: { text, durationSeconds: seconds, elapsedSeconds: (performance.now() - started) / 1000 } };
      } finally { await fs.rm(directory, { recursive: true, force: true }); }
    });
  }
  async function dispose() { disposed = true; await cancel(); }
  return { status, install, remove, transcribe, cancel, dispose, busy: () => Boolean(operation) };
}

module.exports = { createSpeechInputService, cleanupSpeechRecordings, decodeWav, runNative, failure, MAX_SECONDS, MAX_AUDIO_BYTES };
