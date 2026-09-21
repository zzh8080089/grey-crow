"use strict";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const { readTerminalRecord, publicTerminal, validateTerminalSources, terminalArchiveMetadata } = require("./session-terminal-store");
const { readLineageFinale } = require("./session-lineage");

// One archive record accompanies the confirmed story turn. Final chapter
// preparation owns its existing chapter job; sealing has no independent lease.
function createFinaleStore({ db, transaction, assertOpen, identity, currentRevision, readChapterJob, fault }) {
  const { adventureId } = identity;
  transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS finale_archives (
      singleton INTEGER PRIMARY KEY CHECK (singleton=1), finale_id TEXT NOT NULL UNIQUE,
      candidate_id TEXT NOT NULL, confirmation_revision INTEGER NOT NULL UNIQUE REFERENCES turns(revision),
      confirmation_action_id TEXT NOT NULL UNIQUE REFERENCES actions(action_id),
      status TEXT NOT NULL CHECK (status IN ('pending','closed')),
      chapter_id TEXT REFERENCES chapters(chapter_id), closed_at TEXT,
      CHECK ((status='pending' AND chapter_id IS NULL AND closed_at IS NULL)
        OR (status='closed' AND chapter_id IS NOT NULL AND closed_at IS NOT NULL))
    );`);
    const row = db.prepare("SELECT revision,action_id,state_json FROM turns WHERE revision=?").get(currentRevision());
    const state = JSON.parse(row.state_json);
    if (state.finale?.phase === "confirmed") recordConfirmation({ revision: row.revision, actionId: row.action_id, state });
  });

  function publicArchive(row) {
    if (!row) return null;
    return { finaleId: row.finale_id, candidateId: row.candidate_id,
      confirmationRevision: row.confirmation_revision, confirmationActionId: row.confirmation_action_id,
      status: row.status, chapterId: row.chapter_id, closedAt: row.closed_at };
  }

  function snapshot(revision) {
    const target = revision === undefined ? currentRevision() : revision;
    if (!Number.isSafeInteger(target) || target < 0) throw failure("FINALE_INPUT_INVALID");
    const row = db.prepare("SELECT revision,action_id,state_json FROM turns WHERE revision=?").get(target);
    if (!row) throw failure("VIEW_REVISION_UNAVAILABLE");
    return { ...row, state: JSON.parse(row.state_json) };
  }

  function confirmationIdentity({ revision, actionId, state }) {
    const decision = state.finale;
    const confirmation = decision?.confirmation;
    if (decision?.phase !== "confirmed") throw failure("FINALE_NOT_CONFIRMED");
    if (!confirmation || confirmation.revision !== revision || !ID.test(confirmation.candidateId || "")
      || confirmation.candidateId !== decision.candidate?.candidateId || !ID.test(actionId || "")) throw failure("FINALE_STATE_UNAVAILABLE");
    return { finaleId: `finale-${revision}`, candidateId: confirmation.candidateId,
      confirmationRevision: revision, confirmationActionId: actionId };
  }

  function assertIdentity(archive, expected) {
    if (!archive || Object.keys(expected).some((key) => archive[key] !== expected[key])) throw failure("FINALE_IDENTITY_MISMATCH");
  }

  // This is called from the story transaction after its action receipt exists.
  // Opening an older session file may also reconstruct the pending metadata
  // from that same immutable confirmed turn, without generating any new prose.
  function recordConfirmation({ revision, actionId, state }) {
    if (state.finale?.phase !== "confirmed") return;
    if (state.finale.candidate?.kind === "extreme") validateTerminalSources(db, readTerminalRecord(db), { state, revision, actionId });
    const expected = confirmationIdentity({ revision, actionId, state });
    const existing = db.prepare("SELECT * FROM finale_archives WHERE singleton=1").get();
    if (existing) { assertIdentity(publicArchive(existing), expected); return; }
    const source = db.prepare("SELECT narration_json FROM turns WHERE revision=? AND action_id=?").get(revision, actionId);
    const action = db.prepare("SELECT status,revision FROM actions WHERE action_id=?").get(actionId);
    const segments = new Set(source ? JSON.parse(source.narration_json).map((item) => item.id) : []);
    if (action?.status !== "committed" || action.revision !== revision
      || !Array.isArray(state.finale.confirmation.sourceSegmentIds) || !state.finale.confirmation.sourceSegmentIds.length
      || state.finale.confirmation.sourceSegmentIds.some((id) => !segments.has(id))) throw failure("FINALE_STATE_UNAVAILABLE");
    db.prepare("INSERT INTO finale_archives VALUES (1,?,?,?,?,'pending',NULL,NULL)")
      .run(expected.finaleId, expected.candidateId, revision, actionId);
    fault("after_finale_pending");
  }

  function assertPlayable(state) {
    if (state.finale?.phase === "confirmed") throw failure("FINALE_CONFIRMED");
  }

  function readFinale(options = {}) {
    assertOpen();
    fields(options, [], ["revision"]);
    const row = snapshot(options.revision);
    const decision = row.state.finale ?? null;
    const result = { adventureId, revision: row.revision, decision, archive: null, chapterJob: null };
    const terminal = readTerminalRecord(db);
    const terminalView = publicTerminal(terminal, row.revision);
    if (terminalView) {
      validateTerminalSources(db, terminal, { state: row.state, revision: row.revision, actionId: row.action_id });
      result.terminal = terminalView;
    }
    if (decision?.phase !== "confirmed") return result;
    // A child keeps inherited confirmations immutable. Its active singleton
    // belongs only to this chapter of the story; ancestor receipts live in lineage.
    const inherited = readLineageFinale(db, { adventureId, revision: row.revision });
    if (inherited) return inherited;
    const expected = confirmationIdentity({ revision: row.revision, actionId: row.action_id, state: row.state });
    const archive = publicArchive(db.prepare("SELECT * FROM finale_archives WHERE singleton=1").get());
    assertIdentity(archive, expected);
    const job = readChapterJob(`chapter-${expected.confirmationRevision}`);
    if (job) {
      const { chapter, ...small } = job;
      result.chapterJob = small;
    }
    result.archive = { ...archive, ...terminalArchiveMetadata(row.state) };
    return result;
  }

  function sealFinale(options) {
    fields(options, ["finaleId", "chapterId"]);
    if (typeof options.finaleId !== "string" || !ID.test(options.finaleId)
      || typeof options.chapterId !== "string" || !ID.test(options.chapterId)) throw failure("FINALE_INPUT_INVALID");
    const sealed = transaction(() => {
      const current = readFinale();
      if (!current.archive) throw failure("FINALE_NOT_CONFIRMED");
      if (current.archive.finaleId !== options.finaleId) throw failure("FINALE_IDENTITY_MISMATCH");
      if (current.archive.confirmationRevision !== current.revision) throw failure("FINALE_REVISION_CONFLICT");
      if (current.archive.status === "closed") {
        if (current.archive.chapterId !== options.chapterId) throw failure("FINALE_IDENTITY_MISMATCH");
        return { result: current, changed: false };
      }
      const chapter = db.prepare(`SELECT c.*,j.status AS job_status FROM chapters c
        JOIN chapter_jobs j ON j.chapter_id=c.chapter_id WHERE c.chapter_id=?`).get(options.chapterId);
      if (!chapter || chapter.job_status !== "committed" || chapter.to_revision !== current.revision
        || chapter.from_revision > current.archive.confirmationRevision) throw failure("FINALE_CHAPTER_NOT_READY");
      db.prepare("UPDATE finale_archives SET status='closed',chapter_id=?,closed_at=? WHERE singleton=1")
        .run(options.chapterId, new Date().toISOString());
      fault("after_finale_seal");
      return { result: readFinale(), changed: true };
    });
    if (sealed.changed) fault("after_finale_seal_commit");
    return sealed.result;
  }

  return { api: { readFinale, sealFinale }, recordConfirmation, assertPlayable };
}

function fields(value, required, optional = []) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw failure("FINALE_INPUT_INVALID");
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key))) throw failure("FINALE_INPUT_INVALID");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.has(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw failure("FINALE_INPUT_INVALID");
  }
}

function failure(code) { return Object.assign(new Error(code), { code }); }

module.exports = { createFinaleStore };
