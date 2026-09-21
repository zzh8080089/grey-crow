"use strict";

const path = require("node:path");
const { fork } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { normalizeNarrationPreferences, normalizeSessionContextPolicy } = require("./session-context");
const { PROVIDER_ERROR_CODES, projectProviderError, providerFailure } = require("./session-provider-error");

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PENDING = 128;
const CHILD_PATH = path.join(__dirname, "session-process-child.js");
const SESSION_KEYS = new Set(["databasePath", "adventureId", "locale", "contentVersion",
  "initialState", "hostText", "worldText", "openingText", "finaleText", "extremeText", "memoryFragmentText", "maxAttempts", "timeoutMs", "maxModelCalls",
  "maxToolCalls", "maxContextCharacters", "maxOutputTokens", "maxChapterModelCalls", "maxCompactionModelCalls", "narrationPreferences", "contextPolicy"]);
const SAFE_CODES = new Set([
  ...PROVIDER_ERROR_CODES,
  "ACTION_INPUT_CONFLICT", "REVISION_CONFLICT", "ADVENTURE_BUSY", "ACTION_NOT_FOUND",
  "ACTION_NOT_RUNNING", "ATTEMPT_STALE", "ACTION_INPUT_INVALID", "SAVE_IDENTITY_MISMATCH",
  "SAVE_FORMAT_UNSUPPORTED", "SAVE_PATH_INVALID", "SAVE_ALREADY_EXISTS", "INITIAL_STATE_REQUIRED",
  "VIEW_REVISION_UNAVAILABLE", "TURN_VALIDATION_FAILED", "STORE_CLOSED", "STORE_BUSY",
  "REPAIR_BUDGET_EXCEEDED",
  "STORE_OPERATION_FAILED", "SESSION_NOT_READY", "SESSION_ALREADY_INITIALIZED",
  "SESSION_METHOD_NOT_ALLOWED", "SESSION_PAYLOAD_INVALID", "SESSION_PAYLOAD_TOO_LARGE",
  "SESSION_BUSY", "SESSION_PROCESS_CLOSED", "SESSION_OPTIONS_INVALID",
  "HISTORY_CURSOR_MISMATCH", "HISTORY_PAGE_TOO_LARGE",
  "CHAPTER_NOT_READY", "CHAPTER_NOT_FOUND", "CHAPTER_NOT_RUNNING", "CHAPTER_ATTEMPT_STALE",
  "CHAPTER_INPUT_INVALID", "CHAPTER_VALIDATION_FAILED", "CHAPTER_SOURCE_TOO_LARGE",
  "CHAPTER_CURSOR_MISMATCH", "CHAPTER_RANGE_CONFLICT", "CHAPTER_BUSY",
  "CHAPTER_PAGE_TOO_LARGE", "CHAPTER_OWNER_MISMATCH", "CHAPTER_SOURCE_UNAVAILABLE",
  "FINALE_INPUT_INVALID", "FINALE_NOT_CONFIRMED", "FINALE_IDENTITY_MISMATCH", "FINALE_CHAPTER_NOT_READY",
  "FINALE_REVISION_CONFLICT", "FINALE_STATE_UNAVAILABLE", "FINALE_CONFIRMED", "FINALE_OUTCOME_UNKNOWN",
  "TERMINAL_INPUT_INVALID", "TERMINAL_NOT_READY", "TERMINAL_IDENTITY_MISMATCH", "TERMINAL_LOCKED",
  "TERMINAL_STATE_UNAVAILABLE", "TERMINAL_INTERRUPTED", "TERMINAL_OWNER_MISMATCH",
  "TERMINAL_RECOVERY_REQUIRED",
  "SESSION_LINEAGE_INVALID", "SESSION_LINEAGE_INPUT_INVALID",
  "CONTEXT_OPTIONS_INVALID", "CONTEXT_INPUT_INVALID", "CONTEXT_SOURCE_UNAVAILABLE", "CONTEXT_BUDGET_EXCEEDED",
  "CONTEXT_HISTORY_TOO_LARGE", "CONTEXT_PLAN_STALE", "CONTEXT_PLAN_INVALID",
  "COMPACTION_INPUT_INVALID", "COMPACTION_INPUT_CONFLICT", "COMPACTION_BUSY", "COMPACTION_NOT_READY",
  "COMPACTION_PLAN_STALE", "COMPACTION_ATTEMPT_STALE", "COMPACTION_SOURCE_UNAVAILABLE",
  "COMPACTION_STATE_UNAVAILABLE", "COMPACTION_COMMIT_FAILED", "COMPACTION_OUTCOME_UNKNOWN",
  "COMPACTION_INTERRUPTED", "COMPACTION_CANCELLED", "COMPACTION_TIMEOUT", "COMPACTION_SERVICE_CLOSED",
  "COMPACTION_ALREADY_EVALUATED",
  "MEMORY_FRAGMENTS_UNAVAILABLE", "MEMORY_FRAGMENT_CURSOR_MISMATCH", "MEMORY_FRAGMENT_SOURCE_INVALID",
]);

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeCode(error) {
  try {
    const code = error && Object.getOwnPropertyDescriptor(error, "code")?.value;
    return SAFE_CODES.has(code) ? code : "SESSION_REQUEST_FAILED";
  } catch { return "SESSION_REQUEST_FAILED"; }
}

function safeError(error) {
  const projected = projectProviderError(error);
  return PROVIDER_ERROR_CODES.includes(projected.code) ? projected : { code: safeCode(error) };
}

// No getters, toJSON, functions, prototypes, or cycles are evaluated across the
// process boundary. A byte bound also prevents unbounded queued IPC payloads.
function jsonCopy(value) {
  const ancestors = new WeakSet();
  let nodes = 0;
  let bytes = 0;
  function copy(item, depth) {
    if (++nodes > 300_000 || depth > 32) throw failure("SESSION_PAYLOAD_TOO_LARGE");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item === "string") {
      bytes += Buffer.byteLength(item);
      if (bytes > MAX_BYTES) throw failure("SESSION_PAYLOAD_TOO_LARGE");
      return item;
    }
    if (!item || typeof item !== "object" || ancestors.has(item)) throw failure("SESSION_PAYLOAD_INVALID");
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) {
      throw failure("SESSION_PAYLOAD_INVALID");
    }
    ancestors.add(item);
    const result = array ? [] : {};
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) throw failure("SESSION_PAYLOAD_INVALID");
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) {
        throw failure("SESSION_PAYLOAD_INVALID");
      }
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) {
        throw failure("SESSION_PAYLOAD_INVALID");
      }
      bytes += Buffer.byteLength(key);
      if (bytes > MAX_BYTES) throw failure("SESSION_PAYLOAD_TOO_LARGE");
      const property = Object.getOwnPropertyDescriptor(item, key);
      if (!property.enumerable || !Object.hasOwn(property, "value")) throw failure("SESSION_PAYLOAD_INVALID");
      result[key] = copy(property.value, depth + 1);
    }
    ancestors.delete(item);
    return result;
  }
  const result = copy(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) throw failure("SESSION_PAYLOAD_TOO_LARGE");
  return result;
}

function fields(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("SESSION_PAYLOAD_INVALID");
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))) throw failure("SESSION_PAYLOAD_INVALID");
}

function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(value)) throw failure("SESSION_PAYLOAD_INVALID");
}

function sessionOptionsCopy(options) {
  const copy = jsonCopy(options);
  if (!copy || typeof copy !== "object" || Array.isArray(copy) || Object.keys(copy).some((key) => !SESSION_KEYS.has(key))) {
    throw failure("SESSION_OPTIONS_INVALID");
  }
  if (copy.narrationPreferences !== undefined) copy.narrationPreferences = normalizeNarrationPreferences(copy.narrationPreferences);
  if (copy.contextPolicy !== undefined) copy.contextPolicy = normalizeSessionContextPolicy(copy.contextPolicy);
  return copy;
}

function childEnvironment() {
  const env = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG",
    "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "TMP", "TEMP", "ELECTRON_RUN_AS_NODE"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

/** Start the fixed storage/session child; the existing Provider stays here. */
async function createSessionProcess({ sessionOptions, provider, spawn = fork,
  startupTimeoutMs = 10_000, closeGraceMs = 5_000 }) {
  const options = sessionOptionsCopy(sessionOptions);
  if (typeof provider?.generate !== "function" || typeof spawn !== "function") throw failure("SESSION_OPTIONS_INVALID");
  for (const duration of [startupTimeoutMs, closeGraceMs]) {
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 60_000) throw failure("SESSION_OPTIONS_INVALID");
  }
  let child;
  try {
    child = spawn(CHILD_PATH, [], { execPath: process.execPath, execArgv: [],
      cwd: __dirname, env: childEnvironment(), stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "json" });
  } catch { throw failure("SESSION_PROCESS_EXITED"); }
  const pending = new Map();
  const providerCalls = new Map();
  let closing = false;
  let exited = false;
  let resolveExit;
  let closePromise;
  let disconnectTimer;
  const exit = new Promise((resolve) => { resolveExit = resolve; });

  function rejectPending(code) {
    for (const entry of pending.values()) { entry.cleanup(); entry.reject(failure(code)); }
    pending.clear();
  }
  function stopProviders() {
    for (const { controller } of providerCalls.values()) controller.abort();
    providerCalls.clear();
  }
  function onExit() {
    if (exited) return;
    exited = true;
    clearTimeout(disconnectTimer);
    stopProviders();
    rejectPending(closing ? "SESSION_PROCESS_CLOSED" : "SESSION_PROCESS_EXITED");
    resolveExit();
  }
  child.once("exit", onExit);
  child.once("close", onExit); // A failed spawn may emit close without exit.
  child.on("error", () => {
    stopProviders();
    rejectPending("SESSION_PROCESS_EXITED");
  });
  child.on("disconnect", () => {
    if (!exited && !closing) {
      stopProviders();
      // A crash commonly closes IPC before emitting exit. Wait for that
      // authoritative event so existing requests report PROCESS_EXITED.
      // A merely disconnected live child gets time to close its store.
      disconnectTimer = setTimeout(() => { if (!exited) child.kill("SIGKILL"); }, closeGraceMs);
    }
  });

  function send(message, onFailure = () => {}) {
    if (exited || !child.connected) { onFailure(failure("SESSION_CHANNEL_CLOSED")); return; }
    try {
      child.send(jsonCopy(message), (error) => { if (error) onFailure(failure("SESSION_CHANNEL_CLOSED")); });
    } catch (error) { onFailure(error?.code?.startsWith("SESSION_PAYLOAD_") ? error : failure("SESSION_CHANNEL_CLOSED")); }
  }

  async function handleProvider(message) {
    fields(message, ["v", "type", "callId", "request"]);
    id(message.callId);
    fields(message.request, ["messages"], ["tools", "responseFormat", "maxOutputTokens", "thinkingMode"]);
    if (message.request.thinkingMode !== undefined && !["enabled", "disabled"].includes(message.request.thinkingMode)) {
      throw failure("SESSION_PAYLOAD_INVALID");
    }
    if (closing || providerCalls.has(message.callId) || providerCalls.size >= MAX_PENDING) {
      send({ v: 1, type: "provider.result", callId: message.callId, ok: false, error: { code: "PROVIDER_UNAVAILABLE" } });
      return;
    }
    const controller = new AbortController();
    const call = { controller };
    providerCalls.set(message.callId, call);
    try {
      const response = await provider.generate({ ...message.request, signal: controller.signal });
      if (providerCalls.get(message.callId) !== call || closing || exited) return;
      // Raw transport diagnostics and arbitrary provider properties are not a
      // session contract and may contain credentials; never forward them.
      const value = {};
      for (const key of ["text", "toolCalls", "transportState", "usage", "model", "finishReason"]) {
        if (response?.[key] !== undefined) value[key] = response[key];
      }
      const copied = jsonCopy(value);
      send({ v: 1, type: "provider.result", callId: message.callId, ok: true, value: copied });
    } catch (error) {
      if (providerCalls.get(message.callId) === call && !closing && !exited) {
        send({ v: 1, type: "provider.result", callId: message.callId, ok: false,
          error: projectProviderError(error) });
      }
    } finally {
      if (providerCalls.get(message.callId) === call) providerCalls.delete(message.callId);
    }
  }

  child.on("message", (raw) => {
    try {
      const message = jsonCopy(raw);
      if (message.v !== 1) throw failure("SESSION_PAYLOAD_INVALID");
      if (message.type === "provider.call") {
        handleProvider(message).catch(() => { void close(); });
      } else if (message.type === "provider.cancel") {
        fields(message, ["v", "type", "callId"]);
        id(message.callId);
        providerCalls.get(message.callId)?.controller.abort();
        providerCalls.delete(message.callId);
      } else if (message.type === "result") {
        fields(message, ["v", "type", "requestId", "ok"], ["value", "error"]);
        id(message.requestId);
        const entry = pending.get(message.requestId);
        if (!entry) return;
        pending.delete(message.requestId);
        entry.cleanup();
        if (message.ok === true && Object.hasOwn(message, "value")) entry.resolve(message.value);
        else if (message.ok === false && typeof message.error?.code === "string") {
          entry.reject(PROVIDER_ERROR_CODES.includes(message.error.code) ? providerFailure(message.error)
            : failure(SAFE_CODES.has(message.error.code) ? message.error.code : "SESSION_REQUEST_FAILED"));
        } else entry.reject(failure("SESSION_PAYLOAD_INVALID"));
      } else throw failure("SESSION_PAYLOAD_INVALID");
    } catch {
      rejectPending("SESSION_PAYLOAD_INVALID");
      void close();
    }
  });

  function invoke(method, args, signal, init = false) {
    if (closing) return Promise.reject(failure("SESSION_PROCESS_CLOSED"));
    if (exited) return Promise.reject(failure("SESSION_PROCESS_EXITED"));
    if (pending.size >= MAX_PENDING) return Promise.reject(failure("SESSION_BUSY"));
    let message;
    const requestId = randomUUID();
    try {
      message = jsonCopy(init ? { v: 1, type: "init", requestId, options: args }
        : { v: 1, type: "call", requestId, method, args });
    } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const abort = () => send({ v: 1, type: "action.abort", requestId });
      const cleanup = () => signal?.removeEventListener("abort", abort);
      pending.set(requestId, { resolve, reject, cleanup });
      send(message, (error) => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        cleanup();
        reject(error);
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  function close() {
    if (closePromise) return closePromise;
    closing = true;
    stopProviders();
    rejectPending("SESSION_PROCESS_CLOSED");
    closePromise = (async () => {
      if (exited) return;
      send({ v: 1, type: "call", requestId: randomUUID(), method: "close", args: [] }, () => child.kill("SIGTERM"));
      const timer = setTimeout(() => { if (!exited) child.kill("SIGKILL"); }, closeGraceMs);
      try { await exit; } finally { clearTimeout(timer); }
    })();
    return closePromise;
  }

  const timer = setTimeout(() => {
    rejectPending("SESSION_START_TIMEOUT");
    child.kill("SIGKILL");
  }, startupTimeoutMs);
  try { await invoke("init", options, undefined, true); }
  catch (error) { await close(); throw error; }
  finally { clearTimeout(timer); }

  return Object.freeze({
    runAction(request, { retry = false, signal } = {}) {
      if (typeof retry !== "boolean" || (signal !== undefined && !(signal instanceof AbortSignal))) {
        return Promise.reject(failure("SESSION_PAYLOAD_INVALID"));
      }
      return invoke("runAction", [request, { retry, aborted: Boolean(signal?.aborted) }], signal);
    },
    cancelAction: (actionId) => invoke("cancelAction", [actionId]),
    readAction: (actionId) => invoke("readAction", [actionId]),
    readPendingAction: (options = {}) => invoke("readPendingAction", [options]),
    readDiagnostics: (options = {}) => invoke("readDiagnostics", [options]),
    readView: (options = {}) => invoke("readView", [options]),
    readHistory: (options) => invoke("readHistory", [options]),
    saveChapter(request, { retry = false, signal } = {}) {
      if (typeof retry !== "boolean" || (signal !== undefined && !(signal instanceof AbortSignal))) {
        return Promise.reject(failure("SESSION_PAYLOAD_INVALID"));
      }
      return invoke("saveChapter", [request, { retry, aborted: Boolean(signal?.aborted) }], signal);
    },
    readChapters: (options = {}) => invoke("readChapters", [options]),
    readPlayerState: (options = {}) => invoke("readPlayerState", [options]),
    readMemoryFragments: (options = {}) => invoke("readMemoryFragments", [options]),
    readContextUsage: (options = {}) => invoke("readContextUsage", [options]),
    compactContext(request, { retry = false, signal } = {}) {
      if (typeof retry !== "boolean" || (signal !== undefined && !(signal instanceof AbortSignal))) {
        return Promise.reject(failure("SESSION_PAYLOAD_INVALID"));
      }
      return invoke("compactContext", [request, { retry, aborted: Boolean(signal?.aborted) }], signal);
    },
    readContextCompaction: (request) => invoke("readContextCompaction", [request]),
    readFinale: (options = {}) => invoke("readFinale", [options]),
    recoverFinale: (options = {}) => invoke("recoverFinale", [options]),
    finalize(request = {}, { retry = false, signal } = {}) {
      if (typeof retry !== "boolean" || (signal !== undefined && !(signal instanceof AbortSignal))) {
        return Promise.reject(failure("SESSION_PAYLOAD_INVALID"));
      }
      return invoke("finalize", [request, { retry, aborted: Boolean(signal?.aborted) }], signal);
    },
    close,
  });
}

module.exports = { createSessionProcess,
  _sessionWire: { MAX_PENDING, jsonCopy, fields, id, failure, safeCode, safeError, sessionOptionsCopy } };
