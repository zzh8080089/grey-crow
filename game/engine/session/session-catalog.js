"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { readContentSnapshot } = require("../content-v2/snapshot-reader");
const { projectPlayerState } = require("./turn-model");
const { projectSessionView } = require("./session-projection");
const { readTerminalRecord, publicTerminal, validateTerminalSources, terminalArchiveMetadata } = require("./session-terminal-store");
const { readSessionTimeline, projectSessionTimeline } = require("./session-lineage");

// Menu inspection never creates, migrates, repairs, or runs an adventure. Opening
// a selected adventure in the session process owns journal recovery and play.
async function inspectSessionAdventure({ adventuresRoot, adventureId, displayLocale } = {}) {
  if (typeof adventuresRoot !== "string" || !path.isAbsolute(adventuresRoot)
    || typeof adventureId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(adventureId)) {
    throw Object.assign(new Error("SAVE_PATH_INVALID"), { code: "SAVE_PATH_INVALID" });
  }
  const root = path.join(adventuresRoot, adventureId);
  let directory;
  let names;
  try {
    directory = await fs.lstat(root).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (directory?.isDirectory() && !directory.isSymbolicLink()) names = new Set(await fs.readdir(root));
  } catch { return unavailable("SAVE_ACCESS_DENIED"); }
  if (!directory) return { status: "empty", schemaKind: "empty", playerContinuable: false, deleteAllowed: false, summary: null };
  if (!directory.isDirectory() || directory.isSymbolicLink()) return unavailable("SAVE_PATH_INVALID");
  if (!names.has("session.sqlite")) {
    if (["state.json", "save-schema.json", "meta.json"].some((name) => names.has(name))) {
      // Identify legacy data without interpreting its player state or treating
      // it as a new database. This runtime supports only native session saves.
      return unavailable("SAVE_FORMAT_UNSUPPORTED", "legacy");
    }
    return names.size ? unavailable("SESSION_DATABASE_MISSING")
      : { status: "empty", schemaKind: "empty", playerContinuable: false, deleteAllowed: true, summary: null };
  }
  let snapshot;
  let db;
  try {
    for (const name of ["session.sqlite", "session.sqlite-journal", "session.sqlite-wal", "session.sqlite-shm"]) {
      const stat = await fs.lstat(path.join(root, name)).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) return unavailable("SAVE_PATH_INVALID");
    }
    const header = Buffer.alloc(100);
    const file = await fs.open(path.join(root, "session.sqlite"), "r");
    let bytesRead;
    try { ({ bytesRead } = await file.read(header, 0, header.length, 0)); }
    finally { await file.close(); }
    // Session stores use rollback journals, never WAL. Check before invoking
    // SQLite: even a read-only WAL connection can create shared-memory files.
    if (bytesRead !== 100 || header.toString("ascii", 0, 16) !== "SQLite format 3\u0000"
      || header.readUInt32BE(68) !== 0x47435331 || header.readUInt32BE(60) !== 1
      || header[18] !== 1 || header[19] !== 1) return unavailable("SAVE_FORMAT_UNSUPPORTED");
    snapshot = await readContentSnapshot({ adventuresRoot, adventureId });
    db = new DatabaseSync(path.join(root, "session.sqlite"), { readOnly: true });
    // This synchronous reader runs on Electron's main event loop. A locked
    // database must yield a retryable menu entry rather than wait on that loop.
    db.exec("PRAGMA busy_timeout=0;");
    db.exec("BEGIN");
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_import'").get()) {
      return unavailable("SAVE_FORMAT_UNSUPPORTED");
    }
    // One statement fixes identity, version, state and timestamps together.
    const row = db.prepare(`SELECT s.*,t.action_id,t.state_json,
      a.updated_at FROM session s JOIN turns t ON t.revision=s.revision
      LEFT JOIN actions a ON a.action_id=t.action_id WHERE s.singleton=1`).get();
    if (row?.format !== "grey-crow-session-1") return unavailable("SAVE_FORMAT_UNSUPPORTED");
    if (row.adventure_id !== adventureId || row.locale !== snapshot.profile.language
      || row.content_version !== snapshot.lock.overallHash) return unavailable("SAVE_IDENTITY_MISMATCH");
    const state = JSON.parse(row.state_json);
    const timeline = readSessionTimeline(db, { adventureId, revision: row.revision });
    const finale = readCatalogFinale(db, { adventureId, revision: row.revision, actionId: row.action_id, state });
    const view = { adventureId, locale: row.locale, contentVersion: row.content_version,
      revision: row.revision, actionId: row.action_id, state: projectPlayerState(state),
      timeline: projectSessionTimeline(timeline), continuation: timeline.continuation,
      ...(finale ? { finale } : {}),
      narration: [], history: [], historyComplete: row.revision === 0,
      historyNextBeforeRevision: row.revision === 0 ? null
        : { adventureId, revision: row.revision, beforeRevision: row.revision + 1 } };
    const projected = projectSessionView(view, { delivery: "recovery", displayLocale,
      createdAt: snapshot.profile.createdAt,
      updatedAt: row.updated_at || timeline.lineage.find((entry) => entry.boundaryRevision === row.revision)?.createdAt || snapshot.profile.createdAt });
    const confirmed = state.finale?.phase === "confirmed";
    const reserved = finale?.terminal?.status === "reserved";
    const closed = confirmed && finale?.archive?.status === "closed";
    const inspection = { status: closed ? "closed" : confirmed || reserved ? "recovery_required" : "ready",
      schemaKind: "session", playerContinuable: !closed,
      continuable: !closed, deleteAllowed: true, adventureLocale: row.locale,
      adventureLocaleSource: "session_database", revision: row.revision,
      errorCode: reserved ? "TERMINAL_RECOVERY_REQUIRED" : confirmed && !closed ? "FINALE_RECOVERY_REQUIRED" : null };
    return { ...inspection, summary: { ...projected.save, schemaKind: "session",
      adventureLocale: row.locale, adventureLocaleSource: "session_database", catalogRole: closed ? "archive" : "active",
      compatibility: inspection } };
  } catch (error) {
    // A read-only pager cannot roll back a hot journal. Make recovery explicit
    // and keep the entry selectable; never delete the journal from the menu.
    if ((error.errcode & 0xff) === 8 && names.has("session.sqlite-journal") && snapshot) {
      return { status: "recovery_required", schemaKind: "session", playerContinuable: true,
        continuable: true, deleteAllowed: true, adventureLocale: snapshot.profile.language,
        adventureLocaleSource: "content_profile", errorCode: "SESSION_RECOVERY_REQUIRED", summary: null };
    }
    return unavailable(["EACCES", "EPERM"].includes(error.code) ? "SAVE_ACCESS_DENIED"
      : (error.errcode & 0xff) === 5 ? "STORE_BUSY" : "SESSION_INSPECTION_FAILED");
  } finally { try { db?.exec("ROLLBACK"); } catch {} db?.close(); }

  function unavailable(errorCode, schemaKind = "session") {
    return { status: "unavailable", schemaKind, playerContinuable: false,
      continuable: false, deleteAllowed: true, errorCode, retryable: errorCode === "STORE_BUSY", summary: null };
  }
}

function readCatalogFinale(db, { adventureId, revision, actionId, state }) {
  const decision = state.finale;
  const terminal = readTerminalRecord(db);
  if (!decision) { if (terminal) throw new Error("TERMINAL_STATE_UNAVAILABLE"); return null; }
  const result = { adventureId, revision, decision, archive: null, chapterJob: null };
  if (terminal || (decision.phase === "confirmed" && decision.candidate?.kind === "extreme")) {
    validateTerminalSources(db, terminal, { state, revision, actionId });
    result.terminal = publicTerminal(terminal, revision);
  }
  if (decision.phase !== "confirmed") return result;
  const confirmation = decision.confirmation;
  if (confirmation?.revision !== revision || confirmation.candidateId !== decision.candidate?.candidateId) {
    throw new Error("FINALE_STATE_UNAVAILABLE");
  }
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('finale_archives','chapter_jobs','chapters')").all().map((row) => row.name));
  // Older files can expose a confirmed turn before archive metadata exists.
  // The menu marks it for recovery; only a writable session may create tables.
  if (!tables.has("finale_archives")) return result;
  const row = db.prepare("SELECT * FROM finale_archives WHERE singleton=1").get();
  if (!row) return result;
  if (row.finale_id !== `finale-${revision}` || row.candidate_id !== confirmation.candidateId
    || row.confirmation_revision !== revision || row.confirmation_action_id !== actionId
    || !["pending", "closed"].includes(row.status)) throw new Error("FINALE_IDENTITY_MISMATCH");
  if (tables.has("chapter_jobs")) {
    const job = db.prepare("SELECT chapter_id,attempt_id,status,from_revision,to_revision,error_code,retryable FROM chapter_jobs WHERE chapter_id=?").get(`chapter-${revision}`);
    if (job) {
      if (job.to_revision !== revision) throw new Error("FINALE_IDENTITY_MISMATCH");
      result.chapterJob = { adventureId, chapterId: job.chapter_id, attemptId: job.attempt_id,
        status: job.status, fromRevision: job.from_revision, toRevision: job.to_revision,
        ...(job.error_code ? { error: { code: job.error_code, retryable: Boolean(job.retryable) } } : {}) };
    }
  }
  if (row.status === "closed") {
    if (!tables.has("chapters") || !row.chapter_id || typeof row.closed_at !== "string"
      || !Number.isFinite(Date.parse(row.closed_at))) throw new Error("FINALE_STATE_UNAVAILABLE");
    const chapter = db.prepare("SELECT from_revision,to_revision FROM chapters WHERE chapter_id=?").get(row.chapter_id);
    if (!chapter || chapter.to_revision !== revision || chapter.from_revision > revision
      || result.chapterJob?.status !== "committed" || result.chapterJob.chapterId !== row.chapter_id) throw new Error("FINALE_STATE_UNAVAILABLE");
  } else if (row.chapter_id !== null || row.closed_at !== null) throw new Error("FINALE_STATE_UNAVAILABLE");
  result.archive = { finaleId: row.finale_id, candidateId: row.candidate_id,
    confirmationRevision: revision, confirmationActionId: actionId, status: row.status,
    chapterId: row.chapter_id, closedAt: row.closed_at, ...terminalArchiveMetadata(state) };
  return result;
}

module.exports = { inspectSessionAdventure };
