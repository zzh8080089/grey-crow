"use strict";

const { EXECUTION_FORMAT, EXECUTION_MAX_BYTES, sanitizeExecutionSnapshot } = require("./session-execution");
const { PROVIDER_ERROR_CODES } = require("./session-provider-error");

const EXECUTION_ACTION_CODES = Object.freeze([
  ...PROVIDER_ERROR_CODES,
  "PROCESS_INTERRUPTED", "TURN_TIMEOUT", "TURN_CANCELLED", "TURN_VALIDATION_FAILED", "TURN_GENERATION_FAILED",
  "STORE_CLOSED", "STORE_BUSY", "STORE_OPERATION_FAILED", "MODEL_CALL_BUDGET_EXCEEDED", "TOOL_CALL_BUDGET_EXCEEDED", "REPAIR_BUDGET_EXCEEDED",
  "CONTEXT_BUDGET_EXCEEDED", "OUTPUT_BUDGET_EXCEEDED", "TURN_OUTPUT_INVALID", "MEMORY_SOURCE_UNAVAILABLE",
  "CONTEXT_HISTORY_TOO_LARGE", "CONTEXT_SOURCE_UNAVAILABLE", "TERMINAL_STATE_UNAVAILABLE", "TERMINAL_IDENTITY_MISMATCH",
  "TERMINAL_INTERRUPTED", "COMPACTION_BUSY", "COMPACTION_PLAN_STALE", "COMPACTION_SOURCE_UNAVAILABLE",
  "COMPACTION_STATE_UNAVAILABLE", "COMPACTION_INTERRUPTED", "COMPACTION_TIMEOUT", "COMPACTION_MODEL_FAILED",
  "COMPACTION_CONTEXT_BUDGET_EXCEEDED", "COMPACTION_MODEL_BUDGET_EXCEEDED", "COMPACTION_OUTPUT_INVALID", "COMPACTION_OUTCOME_UNKNOWN",
]);

const MAX_ENDED = 100;
const MAX_DIAGNOSTICS_BYTES = 512 * 1024;
const STATUS = ["running", "committed", "cancelled", "failed", "interrupted", "unknown"];
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) ? value : null;
const safeError = row => row.error_code ? { code: EXECUTION_ACTION_CODES.includes(row.error_code) ? row.error_code : "ACTION_FAILED",
  retryable: Boolean(row.retryable) } : null;

// Auxiliary metadata only. Construction and reads never create a table. All
// writes run AFTER the story transaction and swallow even injected failures.
function createExecutionStore({ db, adventureId, ownerId, fault = () => {} }) {
  const exists = () => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='execution_attempts'").get());
  const failedRecordings = new Set();
  const action = id => db.prepare("SELECT * FROM actions WHERE action_id=?").get(id);
  function ensure() {
    db.exec(`CREATE TABLE IF NOT EXISTS execution_attempts (
      adventure_id TEXT NOT NULL, action_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL, status TEXT NOT NULL, committed_revision INTEGER,
      ended_at TEXT, error_code TEXT, retryable INTEGER NOT NULL DEFAULT 0,
      recording_failed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (adventure_id, attempt_id)
    )`);
  }
  function finish(row) {
    if (!row || row.status === "running") return;
    db.prepare(`UPDATE execution_attempts SET status=?,committed_revision=?,ended_at=?,error_code=?,retryable=?
      WHERE adventure_id=? AND action_id=? AND attempt_id=? AND status='running'`)
      .run(row.status, row.revision, row.updated_at, safeError(row)?.code ?? null, row.retryable,
        adventureId, row.action_id, row.attempt_id);
  }
  function reconcileRows() {
    for (const stored of db.prepare("SELECT action_id,attempt_id FROM execution_attempts WHERE adventure_id=? AND status='running'").all(adventureId)) {
      const current = action(stored.action_id);
      if (current?.attempt_id === stored.attempt_id) {
        if (current.status !== "running") {
          // Recovery found no durable normal seal. A closed-looking prefix is
          // insufficient evidence that later callbacks were all recorded.
          db.prepare("UPDATE execution_attempts SET recording_failed=1 WHERE adventure_id=? AND attempt_id=?")
            .run(adventureId, stored.attempt_id);
          finish(current);
        }
      }
      else db.prepare(`UPDATE execution_attempts SET status='unknown',ended_at=?
        WHERE adventure_id=? AND attempt_id=?`).run(new Date().toISOString(), adventureId, stored.attempt_id);
    }
  }
  function prune() {
    // Continuation copies can inherit this table. Diagnostic history is local to
    // this adventure; retain neither hidden ancestor logs nor unbounded copies.
    db.prepare("DELETE FROM execution_attempts WHERE adventure_id<>?").run(adventureId);
    db.prepare(`DELETE FROM execution_attempts WHERE adventure_id=? AND status<>'running' AND rowid NOT IN
      (SELECT rowid FROM execution_attempts WHERE adventure_id=? AND status<>'running'
       ORDER BY ended_at DESC,rowid DESC LIMIT ?)` ).run(adventureId, adventureId, MAX_ENDED);
  }
  function write(operation) {
    let begun = false;
    try {
      db.exec("BEGIN IMMEDIATE"); begun = true;
      fault("execution_before_write"); ensure();
      const result = operation();
      if (result === false) { db.exec("ROLLBACK"); return false; }
      for (const attemptId of failedRecordings) db.prepare("UPDATE execution_attempts SET recording_failed=1 WHERE adventure_id=? AND attempt_id=?")
        .run(adventureId, attemptId);
      reconcileRows(); prune(); fault("execution_before_commit");
      db.exec("COMMIT");
      failedRecordings.clear();
      return true;
    } catch { if (begun) { try { db.exec("ROLLBACK"); } catch {} } return false; }
  }
  function begin(actionId, prior) {
    return write(() => {
      if (prior) {
        // The action row already belongs to the new attempt. A still-unsealed
        // predecessor therefore needs the same uncertainty marker as recovery;
        // its apparently closed prefix may omit failed diagnostic writes.
        db.prepare(`UPDATE execution_attempts SET recording_failed=1
          WHERE adventure_id=? AND action_id=? AND attempt_id=? AND status='running'`)
          .run(adventureId, prior.action_id, prior.attempt_id);
        finish(prior);
      }
      const row = action(actionId);
      if (!row || row.status !== "running" || row.owner_id !== ownerId) return false;
      const snapshot = sanitizeExecutionSnapshot({ format: EXECUTION_FORMAT, phase: "story_generation", adventureId,
        actionId, attemptId: row.attempt_id, baseRevision: JSON.parse(row.request_json).baseRevision,
        startedAt: row.updated_at, lastSequence: 0, truncated: false, steps: [] });
      if (!snapshot) return false;
      db.prepare(`INSERT OR IGNORE INTO execution_attempts
        (adventure_id,action_id,attempt_id,snapshot_json,status) VALUES (?,?,?,?,'running')`)
        .run(adventureId, actionId, row.attempt_id, JSON.stringify(snapshot));
    });
  }
  function record(value) {
    const snapshot = sanitizeExecutionSnapshot(value);
    if (!snapshot || snapshot.adventureId !== null && snapshot.adventureId !== adventureId) return false;
    snapshot.adventureId = adventureId;
    if (!sanitizeExecutionSnapshot(snapshot)) return false;
    let authorized = false;
    try {
      const current = action(snapshot.actionId);
      authorized = current?.status === "running" && current.owner_id === ownerId && current.attempt_id === snapshot.attemptId
        && JSON.parse(current.request_json).baseRevision === snapshot.baseRevision;
    } catch {}
    if (!authorized) return false;
    const recorded = write(() => {
      const row = action(snapshot.actionId);
      if (!row || row.status !== "running" || row.owner_id !== ownerId || row.attempt_id !== snapshot.attemptId
        || JSON.parse(row.request_json).baseRevision !== snapshot.baseRevision) return false;
      const old = db.prepare("SELECT snapshot_json,status FROM execution_attempts WHERE adventure_id=? AND attempt_id=?").get(adventureId, snapshot.attemptId);
      if (old) {
        const prior = sanitizeExecutionSnapshot(JSON.parse(old.snapshot_json));
        if (old.status !== "running" || !prior || snapshot.lastSequence < prior.lastSequence
          || prior.steps.some((step, i) => JSON.stringify(step) !== JSON.stringify(snapshot.steps[i]))) return false;
        if (prior.lastSequence > 0 && snapshot.startedAt !== prior.startedAt) return false;
      }
      db.prepare(`INSERT INTO execution_attempts(adventure_id,action_id,attempt_id,snapshot_json,status)
        VALUES (?,?,?,?,'running') ON CONFLICT(adventure_id,attempt_id) DO UPDATE SET snapshot_json=excluded.snapshot_json`)
        .run(adventureId, snapshot.actionId, snapshot.attemptId, JSON.stringify(snapshot));
    });
    if (!recorded) failedRecordings.add(snapshot.attemptId);
    return recorded;
  }
  function seal(row) {
    if (!row || row.status === "running") return false;
    try { return exists() ? write(() => finish(row)) : false; }
    catch { return false; }
    finally {
      // If sealing failed, the unsealed row already projects as incomplete and
      // recovery preserves that uncertainty. Do not retain ended IDs in memory.
      failedRecordings.delete(row.attempt_id);
    }
  }
  function sealAction(actionId) {
    try { return seal(action(actionId)); } catch { return false; }
  }
  function reconcile() {
    try {
      if (!exists()) return false;
      const pending = db.prepare(`SELECT 1 FROM execution_attempts e LEFT JOIN actions a ON a.action_id=e.action_id
        WHERE e.adventure_id=? AND e.status='running'
        AND (a.attempt_id IS NULL OR a.attempt_id<>e.attempt_id OR a.status<>'running') LIMIT 1`).get(adventureId);
      if (!pending) return true;
    } catch { return false; }
    return write(() => {});
  }
  function read(base) {
    const result = { available: false, format: EXECUTION_FORMAT, records: [], retainedAttempts: 0, returnedAttempts: 0,
      truncated: false, historyComplete: false, maxRecordBytes: EXECUTION_MAX_BYTES, maxEndedAttempts: MAX_ENDED };
    try {
      fault("execution_read");
      if (!exists()) return result;
      result.available = true;
      result.retainedAttempts = db.prepare("SELECT count(*) AS count FROM execution_attempts WHERE adventure_id=?").get(adventureId).count;
      const rows = db.prepare(`SELECT * FROM execution_attempts WHERE adventure_id=?
        ORDER BY (status='running') DESC,ended_at DESC,rowid DESC LIMIT ?`).iterate(adventureId, MAX_ENDED + 1);
      for (const row of rows) {
        const snapshot = sanitizeExecutionSnapshot(JSON.parse(row.snapshot_json));
        if (!snapshot || snapshot.adventureId !== adventureId || snapshot.actionId !== row.action_id || snapshot.attemptId !== row.attempt_id
          || !STATUS.includes(row.status)) throw new Error();
        // A failed auxiliary seal must not make a durably committed action look
        // active. This projection is read-only and never rewrites the snapshot.
        let state = row;
        if (row.status === "running") {
          const current = action(row.action_id);
          state = current?.attempt_id === row.attempt_id
            ? { status: current.status, committed_revision: current.revision, ended_at: current.status === "running" ? null : current.updated_at,
              error_code: current.error_code, retryable: current.retryable }
            : { status: "unknown", committed_revision: null, ended_at: null };
        }
        if (!STATUS.includes(state.status) || state.committed_revision !== null
          && (!Number.isSafeInteger(state.committed_revision) || state.committed_revision < 0)) throw new Error();
        const error = safeError(state);
        const record = { ...snapshot, status: state.status, committedRevision: state.committed_revision,
          endedAt: timestamp(state.ended_at), ...(error ? { error } : {}), incomplete: false };
        while (bytes(record) > EXECUTION_MAX_BYTES && record.steps.length) { record.steps.pop(); record.truncated = true; }
        record.incomplete = record.truncated || row.recording_failed !== 0 || failedRecordings.has(snapshot.attemptId)
          || row.status === "running" || record.steps.length === 0
          || ["interrupted", "unknown"].includes(record.status) || hasUnfinishedCall(record.steps);
        result.records.push(record); result.returnedAttempts = result.records.length;
        if (bytes({ ...base, execution: result }) > MAX_DIAGNOSTICS_BYTES) {
          result.records.pop(); result.returnedAttempts = result.records.length; result.truncated = true; break;
        }
        if (record.truncated) result.truncated = true;
      }
      if (result.returnedAttempts < result.retainedAttempts) result.truncated = true;
      return result;
    } catch {
      return { ...result, available: false, records: [], returnedAttempts: 0, truncated: true };
    }
  }
  return Object.freeze({ begin, record, seal, sealAction, reconcile, read });
}

function hasUnfinishedCall(steps) {
  const pending = new Set();
  for (const step of steps) {
    if (step.kind === "repair") continue;
    const key = `${step.kind}:${step.callIndex}:${step.toolIndex ?? 0}`;
    if (step.outcome === "invoked" || step.outcome === "requested") pending.add(key);
    else pending.delete(key);
  }
  return pending.size > 0;
}

module.exports = { createExecutionStore, EXECUTION_ACTION_CODES };
