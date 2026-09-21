"use strict";

// Diagnostics deliberately accept fixed codes, never messages, stacks, payloads,
// paths or model/user text. Revalidate disk data too; it is not trusted input.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { SOURCE_SCOPE } = require("./build-identity");
const MAX_EVENTS = 100;
const MAX_BYTES = 96 * 1024;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const LOCAL_CODES = [
  "DESKTOP_OPERATION_FAILED", "RENDERER_SCRIPT_ERROR", "RENDERER_RESOURCE_ERROR", "RENDERER_PROMISE_ERROR",
  "RENDERER_GONE", "CHILD_PROCESS_GONE", "MAIN_PROCESS_ERROR", "PREVIOUS_RUN_UNCLEAN", "REPORT_WRITE_FAILED",
  "SPEECH_DISABLED", "SPEECH_BUSY", "SPEECH_MODEL_MISSING", "SPEECH_MODEL_INVALID", "SPEECH_RUNTIME_MISSING",
  "SPEECH_RUNTIME_UNAVAILABLE", "SPEECH_DOWNLOAD_FAILED", "SPEECH_DOWNLOAD_TIMEOUT", "SPEECH_DISK_FULL",
  "SPEECH_AUDIO_INVALID", "SPEECH_TOO_LONG", "SPEECH_NO_SPEECH", "SPEECH_TIMEOUT", "SPEECH_FAILED",
  "SPEECH_STORAGE_FAILED", "SPEECH_CAPTURE_FAILED", "SPEECH_PERMISSION_DENIED", "SPEECH_DEVICE_MISSING",
  "SPEECH_DEVICE_BUSY", "KOKORO_MODEL_MISSING", "KOKORO_WORKER_READY_TIMEOUT", "KOKORO_CHUNK_TIMEOUT",
  "KOKORO_QUEUE_FULL", "KOKORO_CIRCUIT_OPEN", "KOKORO_WORKER_EXITED", "TTS_FAILED", "TTS_AUDIO_ERROR",
];
const AREAS = ["application", "connection", "story", "speech-input", "speech-output", "settings", "interface", "desktop"];
const SKIPPED_CODES = new Set(["REQUEST_ABORTED", "TURN_CANCELLED", "SPEECH_CANCELLED", "SPEECH_STALE"]);
const RENDERER_CODES = new Set(["RENDERER_SCRIPT_ERROR", "RENDERER_RESOURCE_ERROR", "RENDERER_PROMISE_ERROR",
  "SPEECH_PERMISSION_DENIED", "SPEECH_DEVICE_MISSING", "SPEECH_DEVICE_BUSY", "SPEECH_CAPTURE_FAILED", "TTS_AUDIO_ERROR"]);
const safeBuildId = value => typeof value === "string" && /^(?:build-\d{13}-[a-f0-9]{16}|dev-[a-f0-9]{16})$/.test(value) ? value : "unknown";

function createProblemRecorder({ root, codes = [], buildId = "unknown", now = () => Date.now() }) {
  const allowed = new Set([...LOCAL_CODES, ...codes]);
  const file = root ? path.join(root, "diagnostics", "recent-problems.json") : null;
  let events = [], dropped = 0, persistenceAvailable = true, open = false;
  let burstStart = 0, burstCount = 0;
  const validTime = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && Date.parse(value) >= now() - MAX_AGE_MS && Date.parse(value) <= now() + 60000;
  function safeEvent(value) {
    if (!value || !AREAS.includes(value.area) || !allowed.has(value.code) || !validTime(value.at)) return null;
    return { at: value.at, area: value.area, code: value.code, buildId: safeBuildId(value.buildId), retryable: value.retryable === true,
      count: Number.isSafeInteger(value.count) && value.count > 0 ? Math.min(value.count, 9999) : 1,
      durationMs: Number.isSafeInteger(value.durationMs) && value.durationMs >= 0 ? Math.min(value.durationMs, 3_600_000) : null };
  }
  function persist() {
    let temporary;
    try {
      if (!file) throw new Error("diagnostics storage unavailable");
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      temporary = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ schema: 1, open, runBuildId: safeBuildId(buildId), dropped, events }), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, file);
      persistenceAvailable = true;
    } catch { persistenceAvailable = false; }
    finally { if (temporary) { try { fs.unlinkSync(temporary); } catch {} } }
  }
  function record(area, code, options = {}) {
    if (!AREAS.includes(area) || SKIPPED_CODES.has(code)) return;
    code = allowed.has(code) ? code : "DESKTOP_OPERATION_FAILED";
    const eventBuildId = safeBuildId(options.buildId ?? buildId);
    const at = new Date(now()).toISOString();
    const last = events.at(-1);
    // Coalesce repeated polling/resource faults without doing synchronous disk
    // writes on every UI refresh. A later distinct event/clean exit flushes count.
    if (last && last.area === area && last.code === code && last.buildId === eventBuildId && now() - Date.parse(last.at) < 5000) {
      last.count = Math.min(9999, last.count + 1); return;
    }
    if (now() - burstStart >= 60000) { burstStart = now(); burstCount = 0; }
    if (++burstCount > 30) { dropped = Math.min(1_000_000, dropped + 1); return; }
    events = events.filter(event => validTime(event.at));
    events.push(safeEvent({ at, area, code, buildId: eventBuildId, retryable: options.retryable, durationMs: options.durationMs }));
    if (events.length > MAX_EVENTS) { dropped += events.length - MAX_EVENTS; events = events.slice(-MAX_EVENTS); }
    persist();
  }
  function start() {
    let unclean = false, previousBuildId = "unknown";
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error("invalid diagnostics file");
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (saved.schema !== 1 || !Array.isArray(saved.events)) throw new Error("invalid diagnostics schema");
      events = saved.events.slice(-MAX_EVENTS).map(safeEvent).filter(Boolean);
      dropped = Number.isSafeInteger(saved.dropped) && saved.dropped >= 0 ? Math.min(saved.dropped, 1_000_000) : 0;
      unclean = saved.open === true;
      previousBuildId = safeBuildId(saved.runBuildId);
    } catch (error) { if (error.code !== "ENOENT") persistenceAvailable = false; }
    open = true;
    if (unclean) record("application", "PREVIOUS_RUN_UNCLEAN", { buildId: previousBuildId });
    persist();
  }
  return { start, record,
    close() { open = false; persist(); },
    snapshot() { return { retentionDays: 14, limit: MAX_EVENTS, dropped, persistenceAvailable,
      events: events.filter(event => validTime(event.at)).map(event => ({ ...event })) }; },
  };
}

function areaForChannel(channel) {
  if (channel.includes("speech-input")) return "speech-input";
  if (channel.includes("tts")) return "speech-output";
  if (/provider|connection|credential/.test(channel)) return "connection";
  if (/turn|game|context-compaction|finale|save|chapter|adventure/.test(channel)) return "story";
  if (channel.includes("settings")) return "settings";
  return "desktop";
}
function createReportingIpc({ ipcMain, recorder }) {
  const record = (...args) => { try { recorder?.record(...args); } catch {} };
  return { handle(channel, handler) {
    ipcMain.handle(channel, async (...args) => {
      const start = Date.now();
      try {
        const result = await handler(...args);
        if (result?.ok === false && !result.stale && result.error) record(areaForChannel(channel), result.error.code,
          { retryable: result.error.retryable === true, durationMs: Date.now() - start });
        // Speech status can be a successful read of a failed resource state.
        if (channel === "grey-crow:speech-input-status" && result?.status?.errorCode) record("speech-input", result.status.errorCode);
        return result;
      } catch (error) {
        record(areaForChannel(channel), error?.code, { durationMs: Date.now() - start });
        throw error;
      }
    });
  } };
}

function createPlayerProblemReport({ build = {}, recorder, settings = {}, state = {} }) {
  const match = (value, regex) => typeof value === "string" && value.length <= 128 && regex.test(value) ? value : "unknown";
  const identity = { appVersion: match(build?.appVersion, /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
    buildId: match(build?.buildId, /^(?:build-\d{13}-[a-f0-9]{16}|dev-[a-f0-9]{16})$/),
    sourceFingerprint: match(build?.sourceFingerprint, /^[a-f0-9]{64}$/), sourceScope: SOURCE_SCOPE,
    packaged: build?.packaged === true, platform: ["darwin", "win32", "linux"].includes(build?.platform) ? build.platform : "unknown",
    arch: ["x64", "arm64", "ia32", "arm"].includes(build?.arch) ? build.arch : "unknown",
    electron: match(build?.electron, /^[\d.]+$/), node: match(build?.node, /^[\d.]+$/) };
  return { schema: "grey-crow-player-problem-report-v1", exportedAt: new Date().toISOString(), build: identity,
    context: { locale: ["zh-CN", "en-US", "ja-JP"].includes(settings.localization?.preferredLocale) ? settings.localization.preferredLocale : "unknown",
      theme: ["light", "dark"].includes(settings.ui?.storyNotebookTheme) ? settings.ui.storyNotebookTheme : "unknown",
      narration: ["short", "standard", "detailed", "custom", "adaptive"].includes(settings.narration?.lengthPreset) ? settings.narration.lengthPreset : "unknown",
      speechInputEnabled: settings.audio?.input?.enabled === true,
      modelConnected: state.keyVerified === true, adventureOpen: state.gameStarted === true },
    diagnostics: recorder.snapshot(),
    privacy: { storyText: false, playerInput: false, credentials: false, audio: false, localPaths: false, automaticallyUploaded: false },
    coverage: { errorsSinceFeatureInstalled: true, rawCrashDump: false, completeExecutionReplay: false,
      note: "PREVIOUS_RUN_UNCLEAN means the previous run did not close normally; it does not prove a crash." } };
}

// The OS dialog is the only source of the destination path. No renderer-supplied
// path or content reaches the filesystem; returning the basename is sufficient.
async function savePlayerProblemReport({ dialog, window, documentsPath, locale, report }) {
  const names = { "zh-CN": ["保存问题报告", "问题报告"], "en-US": ["Save problem report", "Problem report"], "ja-JP": ["問題レポートを保存", "問題レポート"] };
  const [title, label] = names[locale] || names["zh-CN"];
  const name = `grey-crow-problem-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const options = { title, defaultPath: path.join(documentsPath, name), filters: [{ name: label, extensions: ["json"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"] };
  const result = await dialog.showSaveDialog(window, options);
  if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
  try {
    await fs.promises.writeFile(result.filePath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    return { ok: true, cancelled: false, filename: path.basename(result.filePath) };
  } catch { return { ok: false, error: { code: "REPORT_WRITE_FAILED", retryable: true } }; }
}

module.exports = { createProblemRecorder, createReportingIpc, createPlayerProblemReport, savePlayerProblemReport, RENDERER_CODES, MAX_EVENTS };
