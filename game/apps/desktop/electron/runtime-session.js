"use strict";

function createRuntimeOperationRegistry({ AbortControllerImpl = globalThis.AbortController } = {}) {
  if (typeof AbortControllerImpl !== "function") {
    throw new Error("Runtime operations require AbortController support.");
  }

  let sequence = 0;
  const active = new Map();
  const pending = new Map();

  function begin(kind) {
    const operationKind = normalizeOperationKind(kind);
    abort(operationKind, "operation_replaced");

    const controller = new AbortControllerImpl();
    const token = `${operationKind}_${sequence += 1}`;
    let resolveCompletion;
    const completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    const entry = {
      kind: operationKind,
      token,
      controller,
      completion,
      resolveCompletion,
      finished: false,
    };
    active.set(operationKind, entry);
    pending.set(token, entry);

    return {
      kind: operationKind,
      token,
      signal: controller.signal,
      isCurrent() {
        return active.get(operationKind)?.token === token;
      },
      finish() {
        if (active.get(operationKind)?.token === token) {
          active.delete(operationKind);
        }
        if (!entry.finished) {
          entry.finished = true;
          pending.delete(token);
          entry.resolveCompletion();
        }
      },
      abort(reason = "operation_aborted") {
        if (active.get(operationKind)?.token === token) {
          abort(operationKind, reason);
        }
      },
    };
  }

  function abort(kind, reason = "operation_aborted") {
    const operationKind = normalizeOperationKind(kind);
    const current = active.get(operationKind);
    if (!current) {
      return false;
    }
    active.delete(operationKind);
    if (!current.controller.signal.aborted) {
      current.controller.abort(reason);
    }
    return true;
  }

  function abortAll(reason = "operations_aborted", options = {}) {
    const excludedKinds = new Set(normalizeOptionalOperationKinds(options.excludeKinds));
    const kinds = [...active.keys()];
    for (const kind of kinds) {
      if (excludedKinds.has(kind)) continue;
      abort(kind, reason);
    }
    return kinds.filter((kind) => !excludedKinds.has(kind)).length;
  }

  async function abortAndWait(kind, reason = "operation_aborted", options = {}) {
    return abortAndWaitAll([kind], reason, options);
  }

  async function abortAndWaitAll(kinds, reason = "operations_aborted", options = {}) {
    const operationKinds = normalizeOperationKinds(kinds);
    for (const operationKind of operationKinds) {
      abort(operationKind, reason);
    }
    const waiting = [...pending.values()].filter((entry) => operationKinds.includes(entry.kind));
    if (waiting.length === 0) {
      return Object.freeze({
        abortedKinds: Object.freeze([]),
        settled: true,
        timedOutKinds: Object.freeze([]),
      });
    }

    const timeoutMs = normalizeWaitTimeout(options.timeoutMs);
    const settled = await waitForCompletion(waiting, timeoutMs);
    const timedOutKinds = settled
      ? []
      : [...new Set(waiting.filter((entry) => !entry.finished).map((entry) => entry.kind))].sort();
    return Object.freeze({
      abortedKinds: Object.freeze([...new Set(waiting.map((entry) => entry.kind))].sort()),
      settled,
      timedOutKinds: Object.freeze(timedOutKinds),
    });
  }

  return {
    begin,
    abort,
    abortAndWait,
    abortAndWaitAll,
    abortAll,
    activeCount() {
      return active.size;
    },
    has(kind) {
      return active.has(normalizeOperationKind(kind));
    },
    pendingCount() {
      return pending.size;
    },
  };
}

async function waitForCompletion(entries, timeoutMs) {
  let timeoutId;
  const completed = Promise.all(entries.map((entry) => entry.completion)).then(() => true);
  const timedOut = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([completed, timedOut]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeOperationKinds(kinds) {
  const values = Array.isArray(kinds) ? kinds : [kinds];
  const normalized = [...new Set(values.map(normalizeOperationKind))];
  if (normalized.length === 0) {
    throw new Error("Runtime operation kinds are required.");
  }
  return normalized;
}

function normalizeOptionalOperationKinds(kinds) {
  if (kinds === undefined || kinds === null) return [];
  const values = Array.isArray(kinds) ? kinds : [kinds];
  return [...new Set(values.map(normalizeOperationKind))];
}

function normalizeWaitTimeout(value) {
  return Number.isFinite(value) && value >= 1 && value <= 60_000
    ? Math.floor(value)
    : 10_000;
}

function resetRuntimeSessionState(state = {}) {
  return {
    ...state,
    activeBridge: null,
    keyVerified: false,
    gameStarted: false,
    activeSaveId: null,
    activeSaveSummary: null,
  };
}

function normalizeOperationKind(kind) {
  const normalized = typeof kind === "string" ? kind.trim() : "";
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error("Runtime operation kind must be a safe identifier.");
  }
  return normalized;
}

module.exports = {
  createRuntimeOperationRegistry,
  resetRuntimeSessionState,
};
