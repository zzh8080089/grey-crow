"use strict";
const { PLAYER_ACTION_TIMEOUT_MS } = require("../runtime/model-time-policy");

const { performance } = require("node:perf_hooks");
const { PROVIDER_ERROR_CODES, projectProviderError } = require("./session-provider-error");

// These are application errors, never raw database or model-service messages.
const PUBLIC_CODES = new Set([
  ...PROVIDER_ERROR_CODES,
  "ACTION_INPUT_CONFLICT", "REVISION_CONFLICT", "ADVENTURE_BUSY",
  "ACTION_NOT_FOUND", "ACTION_NOT_RUNNING", "ATTEMPT_STALE",
  "ACTION_INPUT_INVALID", "SAVE_IDENTITY_MISMATCH", "PROCESS_INTERRUPTED",
  "VIEW_REVISION_UNAVAILABLE",
  "FINALE_CONFIRMED",
  "TERMINAL_INPUT_INVALID", "TERMINAL_NOT_READY", "TERMINAL_IDENTITY_MISMATCH", "TERMINAL_LOCKED",
  "TERMINAL_STATE_UNAVAILABLE", "TERMINAL_INTERRUPTED", "TERMINAL_OWNER_MISMATCH",
  "TERMINAL_RECOVERY_REQUIRED",
  "SESSION_LINEAGE_INVALID", "SESSION_LINEAGE_INPUT_INVALID",
  "TURN_VALIDATION_FAILED", "TURN_TIMEOUT", "TURN_CANCELLED",
  "TURN_GENERATION_FAILED", "STORE_CLOSED", "STORE_BUSY", "STORE_OPERATION_FAILED",
  "MODEL_CALL_BUDGET_EXCEEDED", "TOOL_CALL_BUDGET_EXCEEDED", "REPAIR_BUDGET_EXCEEDED", "CONTEXT_BUDGET_EXCEEDED",
  "OUTPUT_BUDGET_EXCEEDED", "TURN_OUTPUT_INVALID", "MEMORY_SOURCE_UNAVAILABLE",
  "CONTEXT_HISTORY_TOO_LARGE", "CONTEXT_SOURCE_UNAVAILABLE", "COMPACTION_BUSY", "COMPACTION_PLAN_STALE",
  "COMPACTION_SOURCE_UNAVAILABLE", "COMPACTION_STATE_UNAVAILABLE", "COMPACTION_INTERRUPTED",
  "COMPACTION_TIMEOUT", "COMPACTION_MODEL_FAILED", "COMPACTION_CONTEXT_BUDGET_EXCEEDED",
  "COMPACTION_MODEL_BUDGET_EXCEEDED", "COMPACTION_OUTPUT_INVALID", "COMPACTION_OUTCOME_UNKNOWN",
]);
const GENERATION_CODES = new Set([
  "MODEL_CALL_BUDGET_EXCEEDED", "TOOL_CALL_BUDGET_EXCEEDED", "REPAIR_BUDGET_EXCEEDED", "CONTEXT_BUDGET_EXCEEDED",
  "OUTPUT_BUDGET_EXCEEDED", "TURN_OUTPUT_INVALID", "MEMORY_SOURCE_UNAVAILABLE",
  "TERMINAL_STATE_UNAVAILABLE", "TERMINAL_IDENTITY_MISMATCH",
  "CONTEXT_HISTORY_TOO_LARGE", "CONTEXT_SOURCE_UNAVAILABLE", "COMPACTION_BUSY", "COMPACTION_PLAN_STALE",
  "COMPACTION_SOURCE_UNAVAILABLE", "COMPACTION_STATE_UNAVAILABLE", "COMPACTION_INTERRUPTED",
  "COMPACTION_TIMEOUT", "COMPACTION_MODEL_FAILED", "COMPACTION_CONTEXT_BUDGET_EXCEEDED",
  "COMPACTION_MODEL_BUDGET_EXCEEDED", "COMPACTION_OUTPUT_INVALID", "COMPACTION_OUTCOME_UNKNOWN",
]);

function errorCode(error, fallback) {
  return PUBLIC_CODES.has(error?.code) ? error.code : fallback;
}

function immutableCopy(value) {
  const copy = structuredClone(value);
  const seen = new WeakSet();
  function freeze(item) {
    if (item === null || typeof item !== "object" || seen.has(item)) return item;
    seen.add(item);
    for (const child of Object.values(item)) freeze(child);
    return Object.freeze(item);
  }
  return freeze(copy);
}

function validationFeedback(error) {
  return Object.freeze({
    code: "TURN_VALIDATION_FAILED",
    // Only the structural validator's diagnostics go back to the generator;
    // provider errors and database exceptions never enter repair prompts.
    issues: Object.freeze(Array.isArray(error.issues)
      ? error.issues.slice(0, 3).filter((issue) => typeof issue === "string")
        .map((issue) => issue.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 240))
      : []),
  });
}

/**
 * Coordinate one durable action around an injected generator. maxAttempts bounds
 * generation passes, including validation repairs; they share one store attemptId.
 * A generator with tool calls must separately bound all its Provider requests.
 * No transaction is held while awaiting the generator. A stop races even a
 * generator that ignores AbortSignal; its eventual result is never committed.
 */
function createTurnCoordinator({ store, generateTurn, maxAttempts = 4, timeoutMs = PLAYER_ACTION_TIMEOUT_MS }) {
  for (const method of ["beginAction", "commitAction", "failAction", "cancelAction",
    "readAction", "readView", "readModelState"]) {
    if (typeof store?.[method] !== "function") throw new TypeError(`store.${method} is required`);
  }
  if (typeof generateTurn !== "function") throw new TypeError("generateTurn is required");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive safe integer");
  }
  // A larger caller limit cannot grant extra semantic correction rounds. The
  // generator shares these same three repairs with JSON and tool corrections.
  const candidateLimit = Math.min(maxAttempts, 4);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError("timeoutMs must fit a positive timer duration");
  }
  const active = new Map();
  // Only attempts whose execution ended here with an unknown receipt belong in
  // this map. Never infer ownership merely from a durable 'running' status.
  const unresolved = new Map();
  let shutDown = false;

  function present(action, modelCalls = 0) {
    const result = {
      status: action.status, actionId: action.actionId,
      attemptId: action.attemptId ?? null, modelCalls,
    };
    if (action.status === "running" && unresolved.get(action.actionId) === action.attemptId
      && !active.has(action.actionId)) result.recoveryRequired = true;
    if (action.error) {
      result.error = { code: errorCode(action.error, "STORE_OPERATION_FAILED") };
      if (typeof action.error.retryable === "boolean") result.error.retryable = action.error.retryable;
    }
    if (action.status === "committed") {
      result.revision = action.revision;
      try {
        result.view = action.view ?? store.readView({ revision: action.revision });
      } catch {
        // The action is still committed. Display recovery must not rerun it.
        result.error = { code: "VIEW_UNAVAILABLE" };
      }
    }
    return result;
  }

  function unavailable(action, modelCalls, code) {
    return { status: "unknown", actionId: action.actionId,
      attemptId: action.attemptId ?? null, error: { code }, modelCalls };
  }

  function settleFailure(action, modelCalls, code, retryable) {
    try {
      const latest = store.readAction(action.actionId);
      if (!latest) return unavailable(action, modelCalls, "ACTION_STATE_UNAVAILABLE");
      if (latest.status !== "running" || latest.attemptId !== action.attemptId) {
        return present(latest, modelCalls);
      }
      return present(store.failAction({ actionId: action.actionId,
        attemptId: action.attemptId, code, retryable }), modelCalls);
    } catch {
      return unavailable(action, modelCalls, "ACTION_STATE_UNAVAILABLE");
    }
  }

  function cancelAction(actionId) {
    // Store state arbitrates cancellation versus a completed commit.
    const running = active.get(actionId);
    let action;
    try {
      action = store.cancelAction(actionId);
    } catch {
      try {
        action = store.readAction(actionId);
        if (["committed", "cancelled", "interrupted"].includes(action?.status)) {
          return present(action, running?.modelCalls ?? 0);
        }
      } catch {}
      // Aborting a provider is not proof that cancellation was durably saved.
      return unavailable({ actionId, attemptId: action?.attemptId ?? running?.attemptId },
        running?.modelCalls ?? 0, "CANCEL_OUTCOME_UNKNOWN");
    } finally {
      running?.stop("cancelled");
    }
    return action ? present(action, running?.modelCalls ?? 0) : null;
  }

  async function runAction(request, { retry = false, signal } = {}) {
    if (shutDown) return { status: "failed", actionId: request?.actionId ?? null,
      attemptId: null, modelCalls: 0, error: { code: "STORE_CLOSED" } };
    let action;
    const unresolvedAttempt = unresolved.get(request?.actionId);
    if (unresolvedAttempt) {
      try {
        if (!readAction(request.actionId)) {
          return unavailable({ actionId: request.actionId, attemptId: unresolvedAttempt },
            0, "COMMIT_OUTCOME_UNKNOWN");
        }
      } catch {
        return unavailable({ actionId: request.actionId, attemptId: unresolvedAttempt },
          0, "COMMIT_OUTCOME_UNKNOWN");
      }
    }
    try {
      action = store.beginAction(request, { retry });
      if (!action.started && retry === true && action.status === "running"
        && unresolved.get(action.actionId) === action.attemptId && !active.has(action.actionId)) {
        // beginAction first validates the immutable input. Only an explicit
        // retry may settle our ended attempt and acquire a new one.
        const settled = settleFailure(action, 0, "STORE_OPERATION_FAILED", true);
        if (settled.status !== "failed" || settled.attemptId !== action.attemptId) return settled;
        unresolved.delete(action.actionId);
        action = store.beginAction(request, { retry: true });
      }
    } catch (error) {
      return { status: "failed", actionId: typeof request?.actionId === "string" ? request.actionId : null,
        attemptId: null, error: { code: errorCode(error, "STORE_OPERATION_FAILED") }, modelCalls: 0 };
    }
    if (!action.started) return present(action);

    const controller = new AbortController();
    let notifyStop;
    const stopped = new Promise((resolve) => { notifyStop = resolve; });
    const running = {
      attemptId: action.attemptId, modelCalls: 0, reason: null,
      stop(reason) {
        if (this.reason) return;
        this.reason = reason;
        notifyStop({ type: "stopped" });
        controller.abort(new Error(reason === "timeout" ? "TURN_TIMEOUT" : "TURN_CANCELLED"));
      },
    };
    let resultUnknown = false;
    function finish(result) {
      resultUnknown = result.status === "unknown";
      // The receipt may now belong to a newer attempt. Accounting and cleanup
      // still belong to the execution started by this invocation.
      return { ...result, executionAttemptId: action.attemptId };
    }
    active.set(action.actionId, running);
    const deadline = performance.now() + timeoutMs;
    const timer = setTimeout(() => running.stop("timeout"), timeoutMs);
    const abortFromCaller = () => {
      try { cancelAction(action.actionId); } catch { running.stop("cancelled"); }
    };
    function ensureRunning() {
      if (!running.reason && performance.now() >= deadline) running.stop("timeout");
      if (running.reason) {
        const error = new Error("Action stopped");
        error.code = running.reason === "timeout" ? "TURN_TIMEOUT" : "TURN_CANCELLED";
        throw error;
      }
    }

    try {
      if (signal?.aborted) abortFromCaller();
      else signal?.addEventListener("abort", abortFromCaller, { once: true });
      ensureRunning();
      // Read the immutable stored request, not the caller's mutable object.
      const fixedRequest = immutableCopy(action.request);
      const fixedState = immutableCopy(store.readModelState({ revision: fixedRequest.baseRevision }));
      let validationError;
      while (running.modelCalls < candidateLimit) {
        ensureRunning();
        const generated = Promise.resolve().then(() => {
          ensureRunning();
          running.modelCalls += 1;
          return generateTurn({ request: fixedRequest, attemptId: action.attemptId,
            state: fixedState, signal: controller.signal, retry: retry === true,
            ...(validationError ? { validationError } : {}) });
        }).then((bundle) => ({ type: "generated", bundle }),
          (error) => ({ type: "error", error }));
        const outcome = await Promise.race([generated, stopped]);
        ensureRunning();
        if (outcome.type === "error") {
          // A generator cannot self-authorize repair retries by choosing an error code.
          const safeError = projectProviderError(outcome.error);
          return finish(settleFailure(action, running.modelCalls,
            GENERATION_CODES.has(outcome.error?.code) ? outcome.error.code : safeError.code,
            GENERATION_CODES.has(outcome.error?.code) ? outcome.error.retryable !== false : safeError.retryable));
        }

        try {
          return finish(present(store.commitAction({ actionId: action.actionId,
            attemptId: action.attemptId, bundle: outcome.bundle }), running.modelCalls));
        } catch (error) {
          let latest;
          try { latest = store.readAction(action.actionId); } catch {
            return finish(unavailable(action, running.modelCalls, "COMMIT_OUTCOME_UNKNOWN"));
          }
          if (!latest) return finish(unavailable(action, running.modelCalls, "COMMIT_OUTCOME_UNKNOWN"));
          if (latest.status !== "running" || latest.attemptId !== action.attemptId) {
            return finish(present(latest, running.modelCalls));
          }
          ensureRunning();
          if (error?.code === "TURN_VALIDATION_FAILED" && running.modelCalls < candidateLimit) {
            validationError = validationFeedback(error);
            continue;
          }
          return finish(settleFailure(action, running.modelCalls,
            error?.code === "TURN_VALIDATION_FAILED" && running.modelCalls >= 4 ? "REPAIR_BUDGET_EXCEEDED"
              : errorCode(error, "STORE_OPERATION_FAILED"), true));
        }
      }
    } catch (error) {
      if (running.reason === "shutdown") {
        // The owning session closes its store before stopping execution. Do not
        // turn process shutdown into player cancellation or invent a receipt.
        return finish(unavailable(action, running.modelCalls, "PROCESS_INTERRUPTED"));
      }
      if (running.reason === "cancelled") {
        try {
          const cancelled = store.cancelAction(action.actionId);
          return finish(cancelled ? present(cancelled, running.modelCalls)
            : unavailable(action, running.modelCalls, "ACTION_STATE_UNAVAILABLE"));
        } catch {
          return finish(unavailable(action, running.modelCalls, "ACTION_STATE_UNAVAILABLE"));
        }
      }
      return finish(settleFailure(action, running.modelCalls,
        running.reason === "timeout" ? "TURN_TIMEOUT" : errorCode(error, "STORE_OPERATION_FAILED"), true));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
      if (active.get(action.actionId) === running) active.delete(action.actionId);
      if (resultUnknown) unresolved.set(action.actionId, action.attemptId);
    }
  }

  function readAction(actionId) {
    const action = store.readAction(actionId);
    const attemptId = unresolved.get(actionId);
    if (attemptId && action) {
      if (action.attemptId !== attemptId || action.status !== "running") unresolved.delete(actionId);
      else return { ...action, recoveryRequired: true };
    }
    return action;
  }

  function shutdown() {
    shutDown = true;
    for (const running of active.values()) running.stop("shutdown");
  }

  return { runAction, cancelAction, readAction, shutdown,
    readView: (options) => store.readView(options) };
}

module.exports = { createTurnCoordinator };
