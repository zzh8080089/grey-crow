"use strict";

const { randomUUID } = require("node:crypto");
const { createAdventureSession } = require("./adventure-session");
const { _sessionWire: wire } = require("./session-process");
const { providerFailure } = require("./session-provider-error");

// Fixed session service only: no module paths, eval, arbitrary method lookup,
// provider configuration, or credentials are accepted over this channel.
function serveSessionProcess() {
  let session;
  let initialized = false;
  let closing = false;
  const calls = new Map();
  const providers = new Map();

  function send(message) {
    if (!process.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        process.send(wire.jsonCopy(message), (error) => error ? reject(wire.failure("SESSION_CHANNEL_CLOSED")) : resolve());
      } catch (error) { reject(error); }
    });
  }

  async function result(requestId, ok, value) {
    try {
      await send(ok ? { v: 1, type: "result", requestId, ok: true, value: value ?? null }
        : { v: 1, type: "result", requestId, ok: false, error: wire.safeError(value) });
    } catch (error) {
      await send({ v: 1, type: "result", requestId, ok: false, error: wire.safeError(error) }).catch(() => {});
    }
  }

  const provider = {
    generate(request) {
      if (closing) return Promise.reject(wire.failure("PROVIDER_UNAVAILABLE"));
      const { signal, ...data } = request;
      const callId = randomUUID();
      return new Promise((resolve, reject) => {
        const abort = () => {
          if (!providers.has(callId)) return;
          providers.delete(callId);
          signal?.removeEventListener("abort", abort);
          void send({ v: 1, type: "provider.cancel", callId }).catch(() => {});
          reject(wire.failure("PROVIDER_ABORTED"));
        };
        providers.set(callId, { resolve, reject, cleanup: () => signal?.removeEventListener("abort", abort) });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        void send({ v: 1, type: "provider.call", callId, request: data }).catch(() => {
          const pending = providers.get(callId);
          if (!pending) return;
          providers.delete(callId);
          pending.cleanup();
          pending.reject(wire.failure("PROVIDER_UNAVAILABLE"));
        });
      });
    },
  };

  async function shutdown(requestId) {
    if (closing) return;
    closing = true;
    for (const [callId, pending] of providers) {
      pending.cleanup();
      pending.reject(wire.failure("PROVIDER_UNAVAILABLE"));
      void send({ v: 1, type: "provider.cancel", callId }).catch(() => {});
    }
    providers.clear();
    let error;
    try { await session?.close(); } catch (caught) { error = caught; }
    if (requestId) await result(requestId, !error, error ?? null);
    if (process.connected) process.disconnect();
    process.exit(error ? 1 : 0);
  }

  async function onMessage(raw) {
    let message;
    try {
      message = wire.jsonCopy(raw);
      if (message.v !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
      if (message.type === "provider.result") {
        wire.fields(message, ["v", "type", "callId", "ok"], ["value", "error"]);
        wire.id(message.callId);
        const pending = providers.get(message.callId);
        if (!pending) return;
        providers.delete(message.callId);
        pending.cleanup();
        if (message.ok === true && Object.hasOwn(message, "value")) pending.resolve(message.value);
        else pending.reject(providerFailure(message.error));
        return;
      }
      if (message.type === "action.abort") {
        wire.fields(message, ["v", "type", "requestId"]);
        wire.id(message.requestId);
        calls.get(message.requestId)?.abort();
        return;
      }
      wire.id(message.requestId);
      if (closing) throw wire.failure("SESSION_PROCESS_CLOSED");
      if (message.type === "init") {
        wire.fields(message, ["v", "type", "requestId", "options"]);
        if (initialized) throw wire.failure("SESSION_ALREADY_INITIALIZED");
        initialized = true;
        session = await createAdventureSession({ ...wire.sessionOptionsCopy(message.options), provider });
        if (closing) { await session.close(); return; }
        await result(message.requestId, true, { ready: true });
        return;
      }
      wire.fields(message, ["v", "type", "requestId", "method", "args"]);
      if (message.type !== "call" || !Array.isArray(message.args)) throw wire.failure("SESSION_PAYLOAD_INVALID");
      if (message.method === "close") {
        if (message.args.length !== 0) throw wire.failure("SESSION_PAYLOAD_INVALID");
        await shutdown(message.requestId);
        return;
      }
      if (!session) throw wire.failure("SESSION_NOT_READY");
      if (calls.has(message.requestId) || calls.size >= wire.MAX_PENDING) throw wire.failure("SESSION_BUSY");
      let operation;
      const controller = new AbortController();
      if (["runAction", "saveChapter", "finalize", "compactContext"].includes(message.method)) {
        if (message.args.length !== 2) throw wire.failure("SESSION_PAYLOAD_INVALID");
        const [request, options] = message.args;
        wire.fields(options, ["retry", "aborted"]);
        if (typeof options.retry !== "boolean" || typeof options.aborted !== "boolean") throw wire.failure("SESSION_PAYLOAD_INVALID");
        if (options.aborted) controller.abort();
        if (message.method === "saveChapter") wire.fields(request, ["targetRevision"]);
        if (message.method === "finalize") wire.fields(request, [], ["revision"]);
        if (message.method === "compactContext") wire.fields(request, ["requestId", "revision"], ["input"]);
        operation = message.method === "runAction"
          ? () => session.runAction(request, { retry: options.retry, signal: controller.signal })
          : message.method === "saveChapter"
            ? () => session.saveChapter(request, { retry: options.retry, signal: controller.signal })
            : message.method === "compactContext"
              ? () => session.compactContext(request, { retry: options.retry, signal: controller.signal })
              : () => session.finalize(request, { retry: options.retry, signal: controller.signal });
      } else if (["cancelAction", "readAction"].includes(message.method)) {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.id(message.args[0]);
        operation = message.method === "cancelAction"
          ? () => session.cancelAction(message.args[0]) : () => session.readAction(message.args[0]);
      } else if (message.method === "readPendingAction") {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.fields(message.args[0], [], ["revision"]);
        operation = () => session.readPendingAction(message.args[0]);
      } else if (message.method === "readDiagnostics") {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.fields(message.args[0], [], ["limit"]);
        operation = () => session.readDiagnostics(message.args[0]);
      } else if (message.method === "readView") {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.fields(message.args[0], [], ["revision", "maxCharacters"]);
        operation = () => session.readView(message.args[0]);
      } else if (message.method === "readHistory") {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.fields(message.args[0], ["revision"], ["beforeRevision", "limit", "maxCharacters"]);
        if (message.args[0].beforeRevision !== undefined) {
          const cursor = message.args[0].beforeRevision;
          wire.fields(cursor, Object.hasOwn(cursor, "kind")
            ? ["adventureId", "revision", "kind", "importId", "sourceFingerprint", "beforeSequence"]
            : ["adventureId", "revision", "beforeRevision"]);
        }
        operation = () => session.readHistory(message.args[0]);
      } else if (message.method === "readChapters") {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.fields(message.args[0], [], ["revision", "cursor", "limit"]);
        operation = () => session.readChapters(message.args[0]);
      } else if (message.method === "readPlayerState") {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.fields(message.args[0], [], ["revision"]);
        operation = () => session.readPlayerState(message.args[0]);
      } else if (message.method === "readMemoryFragments") {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.fields(message.args[0], ["revision"], ["cursor", "limit"]);
        if (message.args[0].cursor != null) wire.fields(message.args[0].cursor, ["adventureId", "revision", "afterIndex"]);
        operation = () => session.readMemoryFragments(message.args[0]);
      } else if (message.method === "readContextUsage") {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.fields(message.args[0], ["revision"], ["input", "narrationPreferences", "contextPolicy"]);
        operation = () => session.readContextUsage(message.args[0]);
      } else if (message.method === "readContextCompaction") {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.fields(message.args[0], ["requestId"]);
        operation = () => session.readContextCompaction(message.args[0]);
      } else if (["readFinale", "recoverFinale"].includes(message.method)) {
        if (message.args.length !== 1) throw wire.failure("SESSION_PAYLOAD_INVALID");
        wire.fields(message.args[0], [], ["revision"]);
        operation = message.method === "readFinale"
          ? () => session.readFinale(message.args[0]) : () => session.recoverFinale(message.args[0]);
      } else throw wire.failure("SESSION_METHOD_NOT_ALLOWED");
      calls.set(message.requestId, controller);
      try { await result(message.requestId, true, await operation()); }
      finally { calls.delete(message.requestId); }
    } catch (error) {
      try { wire.id(message?.requestId); } catch { await shutdown(); return; }
      await result(message.requestId, false, error);
    }
  }

  process.on("message", (message) => { void onMessage(message).catch(() => shutdown()); });
  process.on("disconnect", () => { void shutdown(); });
}

if (require.main === module) serveSessionProcess();

module.exports = { serveSessionProcess };
