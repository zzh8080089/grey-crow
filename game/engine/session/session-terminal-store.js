"use strict";

const crypto = require("node:crypto");
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const OUTCOMES = new Set(["grey_crow_view", "standard_extreme_ending"]);

// This is a control receipt, not narration. A retry can finish the original
// player action, but can never roll again or replace its locked intent.
function createTerminalStore({ db, transaction, assertOpen, currentRevision, readModelState,
  requireAttempt, ownerId, fault, randomInt = crypto.randomInt }) {
  transaction(() => db.exec(`CREATE TABLE IF NOT EXISTS terminal_reservations (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), terminal_id TEXT NOT NULL UNIQUE,
    action_id TEXT NOT NULL UNIQUE REFERENCES actions(action_id), base_revision INTEGER NOT NULL REFERENCES turns(revision),
    candidate_id TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('grey_crow_view','standard_extreme_ending')),
    draw INTEGER NOT NULL CHECK(draw>=0 AND draw<10000), threshold INTEGER NOT NULL CHECK(threshold=4440),
    created_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('reserved','committed')),
    committed_revision INTEGER REFERENCES turns(revision),
    CHECK((status='reserved' AND committed_revision IS NULL) OR (status='committed' AND committed_revision=base_revision+1))
  );`));

  function getTerminal(options = {}) {
    assertOpen(); fields(options, [], ["actionId"]);
    if (options.actionId !== undefined) identifier(options.actionId);
    const record = readTerminalRecord(db);
    return record && (options.actionId === undefined || options.actionId === record.actionId) ? record : null;
  }
  function reserveTerminal(options) {
    fields(options, ["actionId", "attemptId", "candidateId"]);
    for (const key of ["actionId", "attemptId", "candidateId"]) identifier(options[key]);
    const reserved = transaction(() => {
      const action = requireAttempt(options.actionId, options.attemptId);
      if (action.owner_id !== ownerId || action.owner_pid !== process.pid) throw failure("TERMINAL_OWNER_MISMATCH");
      const request = JSON.parse(action.request_json);
      if (request.baseRevision !== currentRevision()) throw failure("REVISION_CONFLICT");
      const state = readModelState();
      const candidate = state.finale?.candidate;
      if (state.finale?.phase !== "candidate_pending" || candidate?.kind !== "extreme"
        || candidate.candidateId !== options.candidateId || candidate.confirmations?.length !== 2) throw failure("TERMINAL_NOT_READY");
      const existing = getTerminal();
      if (existing) {
        if (existing.actionId !== options.actionId || existing.baseRevision !== request.baseRevision
          || existing.candidateId !== options.candidateId || existing.status !== "reserved") throw failure("TERMINAL_IDENTITY_MISMATCH");
        return { record: existing, changed: false };
      }
      const draw = randomInt(10000);
      if (!Number.isSafeInteger(draw) || draw < 0 || draw >= 10000) throw failure("TERMINAL_STATE_UNAVAILABLE");
      db.prepare("INSERT INTO terminal_reservations VALUES(1,?,?,?,?,?,?,4440,?,'reserved',NULL)")
        .run(`terminal-${crypto.randomUUID()}`, options.actionId, request.baseRevision, options.candidateId,
          draw < 4440 ? "grey_crow_view" : "standard_extreme_ending", draw, new Date().toISOString());
      fault("after_terminal_reserve");
      return { record: getTerminal(), changed: true };
    });
    if (reserved.changed) fault("after_terminal_reserve_commit");
    return reserved.record;
  }
  function assertUnlocked(actionId) {
    const record = getTerminal();
    if (record && record.actionId !== actionId) throw failure("TERMINAL_LOCKED");
  }
  function forCommit({ actionId, attemptId, revision }) {
    const record = getTerminal();
    if (!record) return undefined;
    assertUnlocked(actionId);
    const action = requireAttempt(actionId, attemptId);
    if (action.owner_id !== ownerId || action.owner_pid !== process.pid) throw failure("TERMINAL_OWNER_MISMATCH");
    if (record.status !== "reserved" || record.baseRevision !== revision) throw failure("TERMINAL_IDENTITY_MISMATCH");
    return { actionId, baseRevision: revision, candidateId: record.candidateId, outcome: record.outcome };
  }
  function commitTerminal({ actionId, revision, state }) {
    const record = getTerminal();
    const extreme = state.finale?.phase === "confirmed" && state.finale.candidate?.kind === "extreme";
    if (!record && !extreme) return;
    if (!record || !extreme || record.actionId !== actionId || record.baseRevision + 1 !== revision
      || state.finale.candidate.candidateId !== record.candidateId
      || state.finale.confirmation.outcome !== record.outcome) throw failure("TERMINAL_IDENTITY_MISMATCH");
    db.prepare("UPDATE terminal_reservations SET status='committed',committed_revision=? WHERE singleton=1").run(revision);
    validateTerminalSources(db, getTerminal(), { state, revision, actionId });
    fault("after_terminal_commit");
  }
  return { api: { reserveTerminal, getTerminal }, assertUnlocked, forCommit, commitTerminal };
}

function readTerminalRecord(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='terminal_reservations'").get()) return null;
  const row = db.prepare("SELECT * FROM terminal_reservations WHERE singleton=1").get();
  if (!row) return null;
  if (!ID.test(row.terminal_id) || !ID.test(row.action_id) || !ID.test(row.candidate_id)
    || !Number.isSafeInteger(row.base_revision) || row.base_revision < 0 || !OUTCOMES.has(row.outcome)
    || !Number.isSafeInteger(row.draw) || row.draw < 0 || row.draw >= 10000 || row.threshold !== 4440
    || row.outcome !== (row.draw < 4440 ? "grey_crow_view" : "standard_extreme_ending")
    || !["reserved", "committed"].includes(row.status) || !Number.isFinite(Date.parse(row.created_at))
    || (row.status === "reserved" ? row.committed_revision !== null : row.committed_revision !== row.base_revision + 1)) throw failure("TERMINAL_STATE_UNAVAILABLE");
  return { terminalId: row.terminal_id, actionId: row.action_id, baseRevision: row.base_revision,
    candidateId: row.candidate_id, outcome: row.outcome, createdAt: row.created_at,
    status: row.status, committedRevision: row.committed_revision };
}

function publicTerminal(record, revision) {
  if (!record || (record.status === "reserved" ? record.baseRevision !== revision : record.committedRevision !== revision)) return null;
  const { outcome, createdAt, ...value } = record;
  return value;
}

function terminalArchiveMetadata(state) {
  return state.finale?.candidate?.kind === "extreme" && state.finale.phase === "confirmed"
    ? { source: "extreme", outcome: state.finale.confirmation.outcome, continuationPolicy: "forbidden" } : {};
}

// Shared with the readonly menu/archive readers: no connection or write is made.
function validateTerminalSources(db, record, { state, revision, actionId }) {
  const candidate = state.finale?.candidate;
  const confirmed = state.finale?.phase === "confirmed";
  if (!record || candidate?.kind !== "extreme" || candidate.candidateId !== record.candidateId
    || record.status !== (confirmed ? "committed" : "reserved")
    || (confirmed ? record.committedRevision !== revision || record.actionId !== actionId
      || state.finale.confirmation.outcome !== record.outcome : record.baseRevision !== revision)
    || candidate.confirmations?.length !== (confirmed ? 3 : 2)) throw failure("TERMINAL_IDENTITY_MISMATCH");
  const action = db.prepare("SELECT request_json,status,revision FROM actions WHERE action_id=?").get(record.actionId);
  const request = action && JSON.parse(action.request_json);
  if (!request || request.actionId !== record.actionId || request.baseRevision !== record.baseRevision
    || (confirmed ? action.status !== "committed" || action.revision !== revision
      : !["running", "failed", "interrupted"].includes(action.status))) throw failure("TERMINAL_IDENTITY_MISMATCH");
  let previous = 0;
  const origins = [{ revision: candidate.proposal.revision, sourceSegmentIds: candidate.proposal.segmentIds },
    ...candidate.confirmations];
  for (let i = 0; i < origins.length; i++) {
    const source = origins[i];
    if (!Number.isSafeInteger(source.revision) || source.revision < 1 || source.revision > revision
      || source.revision <= previous) throw failure("TERMINAL_STATE_UNAVAILABLE");
    const turn = db.prepare("SELECT narration_json FROM turns WHERE revision=?").get(source.revision);
    const segments = new Set(turn ? JSON.parse(turn.narration_json).map((item) => item.id) : []);
    if (!Array.isArray(source.sourceSegmentIds) || !source.sourceSegmentIds.length
      || source.sourceSegmentIds.some((id) => !segments.has(id))) throw failure("TERMINAL_STATE_UNAVAILABLE");
    previous = source.revision;
  }
  if (confirmed && candidate.confirmations[2].revision !== revision) throw failure("TERMINAL_IDENTITY_MISMATCH");
  return record;
}

function fields(value, required, optional = []) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw failure("TERMINAL_INPUT_INVALID");
  if (required.some((key) => !Object.hasOwn(value, key))) throw failure("TERMINAL_INPUT_INVALID");
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (![...required, ...optional].includes(key) || !property?.enumerable || !Object.hasOwn(property, "value")) throw failure("TERMINAL_INPUT_INVALID");
  }
}
function identifier(value) { if (typeof value !== "string" || !ID.test(value)) throw failure("TERMINAL_INPUT_INVALID"); }
function failure(code) { return Object.assign(new Error(code), { code }); }

module.exports = { createTerminalStore, readTerminalRecord, publicTerminal, validateTerminalSources, terminalArchiveMetadata };
