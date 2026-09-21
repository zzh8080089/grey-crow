"use strict";

const { PROVIDER_ERROR_CODES } = require("./session-provider-error");

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { DatabaseSync } = require("node:sqlite");
const { isMainThread } = require("node:worker_threads");
const { validateInitialState, applyTurnBundle, projectPlayerState } = require("./turn-model");
const { createChapterStore } = require("./session-chapter-store");
const { createFinaleStore } = require("./session-finale-store");
const { createTerminalStore } = require("./session-terminal-store");
const { createExecutionStore, EXECUTION_ACTION_CODES } = require("./session-execution-store");
const { createCompactionStore } = require("./session-compaction-store");
const { readSessionTimeline, projectSessionTimeline, storyTurnAt, mapSessionSource } = require("./session-lineage");
const { readSessionHistoryPage } = require("./session-story-history");
const { createStorySourceReader } = require("./session-memory-source");
const { memoryFragmentProgress } = require("./session-memory-fragments");
const { validateMemoryFragmentSources } = require("./session-memory-fragment-sources");
const { validateConditionSources, readConditionSource: readStoredConditionSource } = require("./session-condition-sources");
const { applyOpeningEvent } = require("./session-opening");
const { generation: ownerGeneration, processIdentity: ownerProcessIdentity, createRecoveryVerifier } = require("./session-process-owner");

const FORMAT = "grey-crow-session-1";
const APPLICATION_ID = 0x47435331;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const HISTORY_MAX_CHARACTERS = 2_000_000;
const HISTORY_MAX_BYTES = 8 * 1024 * 1024 - 4096; // Reserve room for the IPC envelope.
const ACTION_STATUSES = ["running", "committed", "cancelled", "failed", "interrupted"];
// Diagnostics may read older failure receipts, but never echo an arbitrary
// stored exception or service message as an error code.
const ACTION_DIAGNOSTIC_CODES = new Set(EXECUTION_ACTION_CODES);

// A store owns one adventure. Opening it never starts a model or converts an old save.
// Recovery binds running work to a process creation identity and runtime generation.
function createTurnStore(options = {}) {
  if (!isMainThread) throw failure("STORE_REQUIRES_PROCESS_SCOPE");
  const adventureId = requireId(options.adventureId);
  const locale = requireText(options.locale, 64);
  const contentVersion = requireText(options.contentVersion, 256);
  if (options.memoryFragmentsEnabled !== undefined && typeof options.memoryFragmentsEnabled !== "boolean") throw failure("ACTION_INPUT_INVALID");
  const memoryFragmentsEnabled = options.memoryFragmentsEnabled === true;
  const databasePath = validateDatabasePath(options.databasePath);
  const exists = fs.existsSync(databasePath);
  const identity = { adventureId, locale, contentVersion };
  let initialState;
  if (exists) {
    checkExistingIdentity(databasePath, identity);
    if (options.initialState !== undefined) throw failure("SAVE_ALREADY_EXISTS");
  } else {
    if (options.initialState === undefined) throw failure("INITIAL_STATE_REQUIRED");
    initialState = validateInitialState(options.initialState);
  }
  const ownerId = randomUUID();
  const fault = typeof options.faultInjector === "function" ? options.faultInjector : () => {};
  let db;
  let closed = false;
  let chapterStore;
  let finaleStore;
  let terminalStore;
  let compactionStore;
  let executionStore;
  const timelines = new Map();

  try {
    if (!exists) fs.closeSync(fs.openSync(databasePath, "wx", 0o600));
    db = new DatabaseSync(databasePath);
    db.exec("PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
    if (!exists) initialize();
    ensureExperienceIndexes();
    executionStore = createExecutionStore({ db, adventureId, ownerId, fault });
    recoverInterruptedActions();
    ensureOwnerGenerationColumns();
    chapterStore = createChapterStore({ db, transaction, assertOpen, identity, currentRevision, ownerId, ownerGeneration, ownerProcessIdentity, fault });
    terminalStore = createTerminalStore({ db, transaction, assertOpen, currentRevision, readModelState,
      requireAttempt, ownerId, fault, ...(options.terminalRandomInt === undefined ? {} : { randomInt: options.terminalRandomInt }) });
    finaleStore = createFinaleStore({ db, transaction, assertOpen, identity, currentRevision,
      readChapterJob: chapterStore.api.readChapterJob, fault });
    compactionStore = createCompactionStore({ db, transaction, assertOpen, identity, currentRevision, ownerId, ownerGeneration, ownerProcessIdentity, fault });
  } catch (error) {
    try { db?.close(); } catch {}
    throw error;
  }

  function initialize() {
    transaction(() => {
      db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;`);
      db.exec(`
        CREATE TABLE session (
          singleton INTEGER PRIMARY KEY CHECK (singleton=1),
          format TEXT NOT NULL, adventure_id TEXT NOT NULL,
          locale TEXT NOT NULL, content_version TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision>=0)
        );
        CREATE TABLE actions (
          action_id TEXT PRIMARY KEY, request_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running','committed','cancelled','failed','interrupted')),
          attempt_id TEXT NOT NULL, owner_id TEXT NOT NULL, owner_pid INTEGER NOT NULL, owner_generation TEXT, owner_process_identity TEXT,
          retryable INTEGER NOT NULL DEFAULT 0, error_code TEXT,
          revision INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX one_running_action ON actions ((1)) WHERE status='running';
        CREATE TABLE turns (
          revision INTEGER PRIMARY KEY CHECK (revision>=0),
          action_id TEXT UNIQUE REFERENCES actions(action_id),
          narration_json TEXT NOT NULL, events_json TEXT NOT NULL, state_json TEXT NOT NULL
        );
        CREATE TABLE experiences (
          revision INTEGER NOT NULL REFERENCES turns(revision),
          experience_id TEXT NOT NULL, body_json TEXT NOT NULL,
          PRIMARY KEY (revision, experience_id)
        );
      `);
      db.prepare("INSERT INTO session VALUES (1,?,?,?,?,0)").run(FORMAT, adventureId, locale, contentVersion);
      db.prepare("INSERT INTO turns VALUES (0,NULL,'[]','[]',?)").run(JSON.stringify(initialState));
      validateConditionSources(db, initialState, readSessionTimeline(db, { adventureId, revision: 0 }));
    });
  }

  function transaction(operation) {
    assertOpen();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function indexExperience(revision, cursor, experience) {
    const access = db.prepare("INSERT INTO experience_access VALUES (?,?,?,?)");
    const replacement = db.prepare("INSERT INTO experience_replacements VALUES (?,?,?,?,?)");
    for (const viewer of experience.knownBy) {
      access.run(viewer, cursor, revision, experience.id);
      for (const target of experience.supersedes || []) {
        replacement.run(viewer, target.revision, target.experienceId, revision, experience.id);
      }
    }
  }

  function ensureExperienceIndexes() {
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('experience_access','experience_replacements')").all();
    if (existing.length === 2) return;
    // These are disposable lookup relations, not another memory authority. An
    // older session-1 file can rebuild them solely from its committed records.
    transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS experience_access (
          viewer_id TEXT NOT NULL, source_cursor INTEGER NOT NULL,
          revision INTEGER NOT NULL, experience_id TEXT NOT NULL,
          PRIMARY KEY(viewer_id,source_cursor),
          FOREIGN KEY(revision,experience_id) REFERENCES experiences(revision,experience_id)
        );
        CREATE TABLE IF NOT EXISTS experience_replacements (
          viewer_id TEXT NOT NULL, target_revision INTEGER NOT NULL, target_experience_id TEXT NOT NULL,
          correction_revision INTEGER NOT NULL, correction_experience_id TEXT NOT NULL,
          PRIMARY KEY(viewer_id,target_revision,target_experience_id,correction_revision,correction_experience_id),
          FOREIGN KEY(target_revision,target_experience_id) REFERENCES experiences(revision,experience_id),
          FOREIGN KEY(correction_revision,correction_experience_id) REFERENCES experiences(revision,experience_id)
        );
        DELETE FROM experience_access;
        DELETE FROM experience_replacements;
      `);
      for (const item of db.prepare("SELECT rowid,revision,body_json FROM experiences ORDER BY rowid").iterate()) {
        indexExperience(item.revision, item.rowid, JSON.parse(item.body_json));
      }
    });
  }

  function ensureOwnerGenerationColumns() {
    transaction(() => {
      if (!db.prepare("PRAGMA table_info(actions)").all().some((column) => column.name === "owner_generation")) {
        db.exec("ALTER TABLE actions ADD COLUMN owner_generation TEXT");
      }
      if (!db.prepare("PRAGMA table_info(actions)").all().some((column) => column.name === "owner_process_identity")) {
        db.exec("ALTER TABLE actions ADD COLUMN owner_process_identity TEXT");
      }
    });
  }

  function assertOpen() {
    if (closed) throw failure("STORE_CLOSED");
  }

  function currentRevision() {
    return db.prepare("SELECT revision FROM session WHERE singleton=1").get().revision;
  }

  function timelineAt(revision) {
    if (!timelines.has(revision)) {
      timelines.set(revision, readSessionTimeline(db, { adventureId, revision }));
      if (timelines.size > 32) timelines.delete(timelines.keys().next().value);
    }
    return timelines.get(revision);
  }
  function timelineMetadata(value) {
    return projectSessionTimeline(value);
  }
  function storySource(value, revision) {
    return { source: mapSessionSource(value, revision),
      storyTurn: storyTurnAt(value, revision) };
  }

  function actionRow(actionId) {
    return db.prepare("SELECT * FROM actions WHERE action_id=?").get(requireId(actionId));
  }

  function publicAction(row) {
    if (!row) return null;
    return {
      adventureId,
      actionId: row.action_id,
      status: row.status,
      attemptId: row.attempt_id,
      request: JSON.parse(row.request_json),
      revision: row.revision,
      ...(row.error_code ? { error: { code: row.error_code, retryable: Boolean(row.retryable) } } : {}),
    };
  }

  function readAction(actionId) {
    assertOpen();
    return publicAction(actionRow(actionId));
  }

  function readActionSnapshot(operation) {
    assertOpen();
    db.exec("BEGIN");
    try { const result = operation(); db.exec("COMMIT"); return result; }
    catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  }

  function actionError(row) {
    return row.error_code ? { code: ACTION_DIAGNOSTIC_CODES.has(row.error_code) ? row.error_code : "ACTION_FAILED",
      retryable: Boolean(row.retryable) } : null;
  }

  function readPendingAction(options = {}) {
    requireDataFields(options, [], ["revision"]);
    if (options.revision !== undefined) requireRevision(options.revision);
    return readActionSnapshot(() => {
      const revision = currentRevision();
      if (options.revision !== undefined && options.revision !== revision) throw failure("REVISION_CONFLICT");
      // The terminal reservation has its own explicit recovery protocol.
      if (terminalStore.api.getTerminal()) return null;
      // Pick the newest registered action before filtering its status. A later
      // cancellation or permanent failure must not resurrect an earlier input.
      const row = db.prepare("SELECT * FROM actions WHERE json_extract(request_json,'$.baseRevision')=? ORDER BY rowid DESC LIMIT 1").get(revision);
      if (!row || !(row.status === "running" || row.status === "interrupted" || row.status === "failed"
        && (row.retryable === 1 || PROVIDER_ERROR_CODES.includes(row.error_code)))) return null;
      const request = JSON.parse(row.request_json);
      const error = actionError(row);
      return { adventureId, actionId: row.action_id, baseRevision: request.baseRevision, input: request.input,
        locale: request.locale, contentVersion: request.contentVersion, status: row.status, attemptId: row.attempt_id,
        ...(error ? { error } : {}) };
    });
  }

  function readDiagnostics(options = {}) {
    requireDataFields(options, [], ["limit"]);
    const limit = options.limit === undefined ? 50 : options.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw failure("ACTION_INPUT_INVALID");
    return readActionSnapshot(() => {
      const revision = currentRevision();
      const aggregate = db.prepare("SELECT count(*) AS actions,count(DISTINCT attempt_id) AS retainedAttempts FROM actions").get();
      const byStatus = Object.fromEntries(ACTION_STATUSES.map((status) => [status, 0]));
      for (const row of db.prepare("SELECT status,count(*) AS count FROM actions GROUP BY status").iterate()) byStatus[row.status] = row.count;
      // Fetch only identity, status and timestamps. No input, model message,
      // narration, event, state, owner process or filesystem path is selected.
      const rows = db.prepare(`SELECT action_id,attempt_id,status,json_extract(request_json,'$.baseRevision') AS base_revision,
        revision,retryable,error_code,created_at,updated_at FROM actions ORDER BY rowid DESC LIMIT ?`).all(limit).reverse();
      const timestamp = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && Number.isFinite(Date.parse(value)) ? value : null;
      const entries = rows.map((row) => {
        const error = actionError(row);
        return { actionId: row.action_id, attemptId: row.attempt_id, status: row.status,
          baseRevision: row.base_revision, committedRevision: row.revision,
          createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at), ...(error ? { error } : {}) };
      });
      // actions retains only each action's latest attempt. These counts cannot
      // establish lifetime retry/model counts. complete concerns this page only.
      const diagnostics = { adventureId, revision, counts: { ...aggregate, byStatus }, attemptHistoryComplete: false,
        entries, complete: entries.length === aggregate.actions };
      return { ...diagnostics, execution: executionStore.read(diagnostics) };
    });
  }

  function beginAction(request, { retry = false } = {}) {
    const normalized = normalizeRequest(request, identity);
    const serialized = JSON.stringify(normalized);
    let priorAttempt;
    const result = transaction(() => {
      const previous = actionRow(normalized.actionId);
      if (previous && previous.request_json !== serialized) throw failure("ACTION_INPUT_CONFLICT");
      if (previous) {
        // retryable=false on a Provider receipt asks the player to fix their
        // connection/account first. Preserve its action identity so an explicit
        // retry after that intervention can recover even a reserved ending.
        // Merely reading/reopening or repeating without retry never invokes it.
        const canRetry = previous.status === "interrupted" || (previous.status === "failed"
          && (previous.retryable === 1 || PROVIDER_ERROR_CODES.includes(previous.error_code)));
        if (!canRetry || !retry) return { ...publicAction(previous), started: false };
      }
      timelineAt(currentRevision());
      finaleStore.assertPlayable(readModelState());
      terminalStore.assertUnlocked(normalized.actionId);
      if (normalized.baseRevision !== currentRevision()) throw failure("REVISION_CONFLICT");
      compactionStore.assertActionAllowed();
      if (db.prepare("SELECT 1 FROM actions WHERE status='running'").get()) throw failure("ADVENTURE_BUSY");
      priorAttempt = previous;
      const attemptId = randomUUID();
      const now = new Date().toISOString();
      if (previous) {
        db.prepare("UPDATE actions SET status='running',attempt_id=?,owner_id=?,owner_pid=?,owner_generation=?,owner_process_identity=?,retryable=0,error_code=NULL,updated_at=? WHERE action_id=?")
          .run(attemptId, ownerId, process.pid, ownerGeneration, ownerProcessIdentity, now, normalized.actionId);
      } else {
        db.prepare("INSERT INTO actions (action_id,request_json,status,attempt_id,owner_id,owner_pid,owner_generation,owner_process_identity,created_at,updated_at) VALUES (?,?,'running',?,?,?,?,?,?,?)")
          .run(normalized.actionId, serialized, attemptId, ownerId, process.pid, ownerGeneration, ownerProcessIdentity, now, now);
      }
      return { ...publicAction(actionRow(normalized.actionId)), started: true };
    });
    if (result.started) executionStore.begin(result.actionId, priorAttempt);
    return result;
  }

  function requireAttempt(actionId, attemptId) {
    const row = actionRow(actionId);
    if (!row) throw failure("ACTION_NOT_FOUND");
    if (row.attempt_id !== requireId(attemptId)) throw failure("ATTEMPT_STALE");
    if (row.status !== "running") throw failure("ACTION_NOT_RUNNING");
    return row;
  }

  function commitAction({ actionId, attemptId, bundle }) {
    const committed = transaction(() => {
      const existing = actionRow(actionId);
      if (existing?.status === "committed") {
        if (existing.attempt_id !== requireId(attemptId)) throw failure("ATTEMPT_STALE");
        return { row: existing, newlyCommitted: false };
      }
      const row = requireAttempt(actionId, attemptId);
      const request = JSON.parse(row.request_json);
      const revision = currentRevision();
      if (request.baseRevision !== revision) throw failure("REVISION_CONFLICT");
      const current = db.prepare("SELECT state_json FROM turns WHERE revision=?").get(revision);
      const state = JSON.parse(current.state_json);
      validateMemoryFragmentSources(db, state, timelineAt(revision));
      validateConditionSources(db, state, timelineAt(revision));
      finaleStore.assertPlayable(state);
      const terminalReservation = terminalStore.forCommit({ actionId, attemptId, revision });
      const applied = applyTurnBundle(state, bundle, { baseRevision: revision, adventureId, memoryFragmentsEnabled,
        ...(terminalReservation ? { terminalReservation } : {}) });
      const next = revision + 1;
      // Corrections point only to committed source experiences in this adventure.
      // The old source remains immutable; each viewer's recall applies the correction.
      for (const experience of applied.bundle.experiences) {
        for (const target of experience.supersedes || []) {
          if (target.revision > revision || !db.prepare("SELECT 1 FROM experiences WHERE revision=? AND experience_id=?")
            .get(target.revision, target.experienceId)) {
            const error = failure("TURN_VALIDATION_FAILED");
            error.issues = ["experience.supersedes must reference an earlier committed experience"];
            throw error;
          }
        }
      }
      db.prepare("INSERT INTO turns VALUES (?,?,?,?,?)").run(next, actionId,
        JSON.stringify(applied.bundle.narration), JSON.stringify(applied.bundle.events), JSON.stringify(applied.state));
      fault("after_turn");
      const insertExperience = db.prepare("INSERT INTO experiences VALUES (?,?,?)");
      for (const experience of applied.bundle.experiences) {
        const inserted = insertExperience.run(next, experience.id, JSON.stringify(experience));
        indexExperience(next, inserted.lastInsertRowid, experience);
      }
      fault("after_experiences");
      db.prepare("UPDATE session SET revision=? WHERE singleton=1").run(next);
      fault("after_revision");
      db.prepare("UPDATE actions SET status='committed',revision=?,retryable=0,error_code=NULL,updated_at=? WHERE action_id=?")
        .run(next, new Date().toISOString(), actionId);
      fault("after_action");
      // The new source turn and its committed action now exist inside this
      // transaction. Failed provenance rolls back narration, state and receipt.
      // A normal action cannot add a continuation boundary. Reuse the checked
      // base lineage; the source validator separately checks the new row and
      // committed action, without rescanning the whole timeline a second time.
      validateConditionSources(db, applied.state, { ...timelineAt(revision), revision: next });
      terminalStore.commitTerminal({ actionId, revision: next, state: applied.state });
      finaleStore.recordConfirmation({ revision: next, actionId, state: applied.state });
      return { row: actionRow(actionId), newlyCommitted: true };
    });
    executionStore.seal(committed.row);
    // An error here is an acknowledgement failure, never grounds to repeat the action.
    if (committed.newlyCommitted) fault("after_commit");
    return { ...publicAction(committed.row), view: readView({ revision: committed.row.revision }) };
  }

  function failAction({ actionId, attemptId, code, retryable = false }) {
    requireErrorCode(code);
    const result = transaction(() => {
      const row = actionRow(actionId);
      if (!row) throw failure("ACTION_NOT_FOUND");
      if (row.attempt_id !== requireId(attemptId)) throw failure("ATTEMPT_STALE");
      if (row.status !== "running") return publicAction(row);
      db.prepare("UPDATE actions SET status='failed',retryable=?,error_code=?,updated_at=? WHERE action_id=?")
        .run(retryable === true || (!PROVIDER_ERROR_CODES.includes(code) && terminalStore.api.getTerminal({ actionId })) ? 1 : 0,
          code, new Date().toISOString(), actionId);
      return publicAction(actionRow(actionId));
    });
    executionStore.sealAction(result?.actionId);
    return result;
  }

  function cancelAction(actionId) {
    const result = transaction(() => {
      const row = actionRow(actionId);
      if (!row) return null;
      if (row.status === "committed" || row.status === "cancelled") return publicAction(row);
      if (terminalStore.api.getTerminal({ actionId })) {
        db.prepare("UPDATE actions SET status='interrupted',retryable=1,error_code='TERMINAL_INTERRUPTED',updated_at=? WHERE action_id=?")
          .run(new Date().toISOString(), actionId);
        return publicAction(actionRow(actionId));
      }
      db.prepare("UPDATE actions SET status='cancelled',retryable=0,error_code=NULL,updated_at=? WHERE action_id=?")
        .run(new Date().toISOString(), actionId);
      return publicAction(actionRow(actionId));
    });
    executionStore.sealAction(result?.actionId);
    return result;
  }

  function recoverInterruptedActions() {
    const count = transaction(() => {
      const shouldRecover = createRecoveryVerifier();
      const rows = db.prepare("SELECT action_id,owner_pid,owner_generation,owner_process_identity,updated_at FROM actions WHERE status='running'").all();
      let count = 0;
      for (const row of rows) {
        if (!shouldRecover(row)) continue;
        count += Number(db.prepare("UPDATE actions SET status='interrupted',retryable=1,error_code='PROCESS_INTERRUPTED',updated_at=? WHERE action_id=? AND status='running'")
          .run(new Date().toISOString(), row.action_id).changes);
      }
      return count;
    });
    executionStore.reconcile();
    return count;
  }

  function snapshot(revision) {
    assertOpen();
    const target = revision === undefined ? currentRevision() : requireRevision(revision);
    const row = db.prepare("SELECT * FROM turns WHERE revision=?").get(target);
    if (!row) throw failure("VIEW_REVISION_UNAVAILABLE");
    return row;
  }

  function readModelState({ revision } = {}) {
    const row = snapshot(revision);
    const state = JSON.parse(row.state_json);
    validateMemoryFragmentSources(db, state, timelineAt(row.revision));
    validateConditionSources(db, state, timelineAt(row.revision));
    return state;
  }

  function readPlayerState({ revision } = {}) {
    const row = snapshot(revision);
    const state = JSON.parse(row.state_json);
    const timeline = timelineAt(row.revision);
    validateMemoryFragmentSources(db, state, timeline);
    validateConditionSources(db, state, timeline);
    return { adventureId, locale, contentVersion, revision: row.revision, state: projectPlayerState(state),
      timeline: timelineMetadata(timeline), continuation: structuredClone(timeline.continuation),
      ...(state.finale ? { finale: finaleStore.api.readFinale({ revision: row.revision }) } : {}) };
  }

  function readView({ revision, maxCharacters = 200_000 } = {}) {
    const row = snapshot(revision);
    const state = JSON.parse(row.state_json);
    // Rows for a committed revision are immutable, so late readers cannot mix versions.
    const page = readHistory({ revision: row.revision, maxCharacters });
    const timeline = timelineAt(row.revision);
    validateMemoryFragmentSources(db, state, timeline);
    validateConditionSources(db, state, timeline);
    return {
      adventureId, locale, contentVersion, revision: row.revision, actionId: row.action_id,
      narration: JSON.parse(row.narration_json), state: projectPlayerState(state),
      history: page.history, historyComplete: page.complete, historyNextBeforeRevision: page.nextBeforeRevision,
      timeline: page.timeline, continuation: structuredClone(timeline.continuation),
      ...(state.finale ? { finale: finaleStore.api.readFinale({ revision: row.revision }) } : {}),
    };
  }

  function readMemoryFragments(options = {}) {
    assertOpen();
    requireDataFields(options, ["revision"], ["cursor", "limit"]);
    if (!memoryFragmentsEnabled) throw failure("MEMORY_FRAGMENTS_UNAVAILABLE");
    const revision = requireRevision(options.revision);
    const limit = options.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw failure("ACTION_INPUT_INVALID");
    const state = readModelState({ revision });
    const progress = memoryFragmentProgress(state, { memoryFragmentsEnabled });
    const fragments = state.memoryFragments?.fragments ?? [];
    let afterIndex = 0;
    if (options.cursor != null) {
      const cursor = options.cursor;
      requireDataFields(cursor, ["adventureId", "revision", "afterIndex"], []);
      if (cursor.adventureId !== adventureId || cursor.revision !== revision
        || !Number.isSafeInteger(cursor.afterIndex) || cursor.afterIndex < 1 || cursor.afterIndex >= fragments.length) {
        throw failure("MEMORY_FRAGMENT_CURSOR_MISMATCH");
      }
      afterIndex = cursor.afterIndex;
    }
    const end = Math.min(afterIndex + limit, fragments.length);
    return { adventureId, revision, progress, fragments: structuredClone(fragments.slice(afterIndex, end)),
      complete: end === fragments.length, nextCursor: end === fragments.length ? null : { adventureId, revision, afterIndex: end } };
  }

  function readConditionSource(options = {}) {
    try {
      requireDataFields(options, ["revision", "entityId", "recordId"], ["cursor"]);
      requireRevision(options.revision); requireId(options.entityId); requireId(options.recordId);
      if (options.cursor !== undefined && (typeof options.cursor !== "string" || options.cursor.length > 2048)) throw failure("ACTION_INPUT_INVALID");
    } catch { throw failure("CONDITION_SOURCE_INPUT_INVALID"); }
    const row = snapshot(options.revision);
    const state = JSON.parse(row.state_json);
    const entity = Object.hasOwn(state.entities, options.entityId) ? state.entities[options.entityId] : null;
    // Reject a hidden target before traversing any historical condition data.
    if (entity?.kind !== "character" || entity.visibility !== "player") throw failure("CONDITION_RECORD_NOT_AVAILABLE");
    return readStoredConditionSource(db, state, timelineAt(row.revision), { entityId: options.entityId,
      recordId: options.recordId, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) });
  }

  // Pages walk backwards through one fixed adventure revision, but each page
  // is ascending for display. beforeRevision is a bound cursor, never a bare
  // offset that could silently follow a different adventure or newer revision.
  function readHistory(options = {}) {
    assertOpen();
    requireDataFields(options, ["revision"], ["beforeRevision", "limit", "maxCharacters"]);
    const target = requireRevision(options.revision);
    const limit = options.limit === undefined ? 20 : options.limit;
    const maxCharacters = options.maxCharacters === undefined ? 200_000 : options.maxCharacters;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || !Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > HISTORY_MAX_CHARACTERS) {
      throw failure("ACTION_INPUT_INVALID");
    }
    if (!db.prepare("SELECT 1 FROM turns WHERE revision=?").get(target)) throw failure("VIEW_REVISION_UNAVAILABLE");
    return readSessionHistoryPage(db, { ...options, adventureId, revision: target }, timelineAt(target));
  }

  function readTurn(revision) {
    const row = snapshot(revision);
    return { revision: row.revision, actionId: row.action_id,
      narration: JSON.parse(row.narration_json), events: JSON.parse(row.events_json),
      experiences: db.prepare("SELECT body_json FROM experiences WHERE revision=? ORDER BY rowid")
        .all(row.revision).map((item) => JSON.parse(item.body_json)) };
  }

  function readRecentTurns({ revision, limit = 6 } = {}) {
    const row = snapshot(revision);
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 12) throw failure("ACTION_INPUT_INVALID");
    const timeline = timelineAt(row.revision);
    const turns = db.prepare("SELECT t.revision,t.action_id,t.narration_json,a.request_json FROM turns t JOIN actions a ON a.action_id=t.action_id WHERE t.revision<=? ORDER BY t.revision DESC LIMIT ?")
      .all(row.revision, limit).reverse().map((item) => ({
        revision: item.revision, actionId: item.action_id,
        input: JSON.parse(item.request_json).input, narration: JSON.parse(item.narration_json),
        ...storySource(timeline, item.revision),
      }));
    return { revision: row.revision, turns, timeline: timelineMetadata(timeline), continuation: structuredClone(timeline.continuation) };
  }

  // The confirmation scene can be shorter than the identity/possession summary
  // the player accepted. Follow only this engine-recorded opening relationship;
  // it is not an arbitrary historical read supplied by the model. The returned
  // passages are supporting source text, not proof of the experience's meaning.
  function openingSupportingPassages(item, experience, state, timeline, cache) {
    try {
      const events = JSON.parse(item.events_json);
      if (!Array.isArray(events) || !Array.isArray(experience.eventIds)) throw failure("MEMORY_SOURCE_UNAVAILABLE");
      if (experience.eventIds.some((id) => events.filter((event) => event?.id === id).length !== 1)) throw failure("MEMORY_SOURCE_UNAVAILABLE");
      const confirms = events.filter((event) => event?.type === "opening.confirm" && experience.eventIds.includes(event.id));
      if (!confirms.length) return null;
      if (confirms.length !== 1) throw failure("MEMORY_SOURCE_UNAVAILABLE");
      if (cache.has(item.revision)) {
        const cached = cache.get(item.revision);
        if (cached.eventId !== confirms[0].id) throw failure("MEMORY_SOURCE_UNAVAILABLE");
        return cached.passages;
      }
      const checked = (revision) => {
        if (!Number.isSafeInteger(revision) || revision < 1 || revision > timeline.revision) throw failure("MEMORY_SOURCE_UNAVAILABLE");
        const row = snapshot(revision);
        const action = row.action_id && actionRow(row.action_id);
        if (!action || action.status !== "committed" || action.revision !== revision) throw failure("MEMORY_SOURCE_UNAVAILABLE");
        const sourceState = validateInitialState(JSON.parse(row.state_json));
        validateConditionSources(db, sourceState, timelineAt(revision));
        return { row, state: sourceState, events: JSON.parse(row.events_json), narration: JSON.parse(row.narration_json) };
      };
      const confirmed = checked(item.revision);
      const confirmation = confirmed.state.opening?.confirmation;
      if (confirms.length !== 1 || confirmed.state.opening?.phase !== "ready" || !confirmation
        || confirmation.revision !== item.revision || state.opening?.phase !== "ready"
        || !isDeepStrictEqual(state.opening.confirmation, confirmation)
        || confirmed.state.situation.playerId !== state.situation.playerId
        || !isDeepStrictEqual(confirms[0].data, { proposalId: confirmation.proposalId })
        || !isDeepStrictEqual(confirms[0].sourceSegmentIds, confirmation.sourceSegmentIds)) throw failure("MEMORY_SOURCE_UNAVAILABLE");
      const originalSegments = new Set(confirmed.narration.map((segment) => segment.id));
      if (confirmation.sourceSegmentIds.some((id) => !originalSegments.has(id))) throw failure("MEMORY_SOURCE_UNAVAILABLE");
      const prior = checked(item.revision - 1);
      const proposal = prior.state.opening?.proposal;
      if (prior.state.opening?.phase !== "awaiting_confirmation" || !proposal
        || proposal.proposalId !== confirmation.proposalId
        || proposal.summary.revision !== confirmation.summaryRevision
        || !isDeepStrictEqual(proposal.summary.segmentIds, confirmation.summarySegmentIds)) throw failure("MEMORY_SOURCE_UNAVAILABLE");
      const summary = checked(confirmation.summaryRevision);
      if (summary.state.opening?.phase !== "awaiting_confirmation"
        || !isDeepStrictEqual(summary.state.opening.proposal, proposal)) throw failure("MEMORY_SOURCE_UNAVAILABLE");
      const proposedEvent = summary.events.findLast((event) => event?.type === "opening.propose");
      if (!proposedEvent) throw failure("MEMORY_SOURCE_UNAVAILABLE");
      requireDataFields(proposedEvent.data, ["initialState", "proposalId"], ["initialConditions"]);
      const source = mapSessionSource(timeline, summary.row.revision);
      let expectedInitial = validateInitialState(proposedEvent.data.initialState);
      if (Object.hasOwn(proposedEvent.data, "initialConditions")
        || Object.values(proposal.initialState.entities).some((entity) => Object.hasOwn(entity, "conditionRecords"))) {
        const before = validateInitialState(JSON.parse(snapshot(summary.row.revision - 1).state_json));
        expectedInitial = applyOpeningEvent(before, proposedEvent, { priorState: before,
          baseRevision: summary.row.revision - 1, adventureId: source.adventureId, narration: summary.narration,
          segmentIds: new Set(summary.narration.map((segment) => segment.id)), validateReadyState: validateInitialState }).opening.proposal.initialState;
      }
      // Old pending proposals have no record container and remain readable.
      // New ones must reproduce the whole engine-compiled candidate, including
      // empty ledgers and initialConditions; never ignore the body fields.
      if (proposedEvent.data.proposalId !== proposal.proposalId
        || !isDeepStrictEqual(expectedInitial, proposal.initialState)
        || !isDeepStrictEqual(proposedEvent.sourceSegmentIds, confirmation.summarySegmentIds)) throw failure("MEMORY_SOURCE_UNAVAILABLE");
      if (source.adventureId !== mapSessionSource(timeline, item.revision).adventureId) throw failure("MEMORY_SOURCE_UNAVAILABLE");
      const passages = confirmation.summarySegmentIds.map((segmentId) => {
        const matching = summary.narration.filter((segment) => segment?.id === segmentId);
        if (matching.length !== 1 || typeof matching[0].text !== "string" || !matching[0].text.trim()) throw failure("MEMORY_SOURCE_UNAVAILABLE");
        return { kind: "opening_summary", ...source, actionId: summary.row.action_id, segmentId, text: matching[0].text };
      });
      cache.set(item.revision, { eventId: confirms[0].id, passages });
      return passages;
    } catch { throw failure("MEMORY_SOURCE_UNAVAILABLE"); }
  }

  function listExperienceRecords({ revision, viewerId, cursor = 0, limit = 128, beforeRevision, afterRevision } = {}) {
    const row = snapshot(revision);
    const state = JSON.parse(row.state_json);
    const timeline = timelineAt(row.revision);
    // The first memory consumer is the player's turn. Caller-supplied identities
    // cannot elevate access to an NPC or an omniscient historical memory channel.
    if (typeof viewerId !== "string" || viewerId !== state.situation.playerId) throw failure("MEMORY_VIEWER_INVALID");
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit)
      || limit < 1 || limit > 512
      || (beforeRevision !== undefined && (!Number.isSafeInteger(beforeRevision) || beforeRevision < 1 || beforeRevision > row.revision))
      || (afterRevision !== undefined && (!Number.isSafeInteger(afterRevision) || afterRevision < 0 || afterRevision > row.revision))
      || (beforeRevision !== undefined && afterRevision !== undefined && afterRevision >= beforeRevision)) throw failure("ACTION_INPUT_INVALID");
    const visibleIds = JSON.stringify(Object.values(state.entities).filter((entity) => entity.visibility === "player").map((entity) => entity.id));
    const after = afterRevision ?? 0;
    const through = beforeRevision === undefined ? row.revision : beforeRevision - 1;
    // Committed experiences append in revision order, including copied lineage.
    // Seek both range ends through the revision index, then page the existing
    // viewer/cursor index. Out-of-range history must not consume the scan budget.
    const lastCursor = db.prepare("SELECT max(rowid) AS cursor FROM experiences WHERE revision=(SELECT max(revision) FROM experiences WHERE revision<=?)");
    const highWater = lastCursor.get(through).cursor ?? 0;
    const pageStart = Math.max(cursor, afterRevision === undefined ? 0 : lastCursor.get(after).cursor ?? 0);
    // Bound raw indexed candidates before visibility/correction filtering. An
    // empty page can still advance: hidden or superseded records cost scan work.
    const candidates = db.prepare("SELECT source_cursor FROM experience_access WHERE viewer_id=? AND source_cursor>? AND source_cursor<=? AND revision>? AND revision<=? ORDER BY source_cursor LIMIT ?")
      .all(viewerId, pageStart, highWater, after, through, limit + 1);
    const scannedRecords = Math.min(limit, candidates.length);
    const pageEnd = scannedRecords ? candidates[scannedRecords - 1].source_cursor : pageStart;
    const rows = db.prepare(`
      SELECT access.source_cursor AS cursor,e.revision,e.experience_id,e.body_json,t.action_id,t.narration_json,t.events_json,
        a.request_json,a.status AS action_status,a.revision AS action_revision
      FROM experience_access access
      JOIN experiences e ON e.revision=access.revision AND e.experience_id=access.experience_id
      JOIN turns t ON t.revision=e.revision
      LEFT JOIN actions a ON a.action_id=t.action_id
      WHERE access.viewer_id=? AND access.source_cursor>? AND access.source_cursor<=?
        AND access.revision>? AND access.revision<=?
        AND NOT EXISTS (SELECT 1 FROM json_each(e.body_json,'$.entityIds') WHERE value NOT IN (SELECT value FROM json_each(?)))
        AND NOT EXISTS (
          SELECT 1 FROM experience_replacements replacement
          JOIN experiences correction ON correction.revision=replacement.correction_revision
            AND correction.experience_id=replacement.correction_experience_id
          WHERE replacement.viewer_id=? AND replacement.target_revision=e.revision
            AND replacement.target_experience_id=e.experience_id AND replacement.correction_revision<=?
            AND NOT EXISTS (SELECT 1 FROM json_each(correction.body_json,'$.entityIds') WHERE value NOT IN (SELECT value FROM json_each(?)))
        )
      ORDER BY access.source_cursor LIMIT ?
    `).all(viewerId, pageStart, pageEnd, after, through, visibleIds, viewerId, row.revision, visibleIds, limit);
    const supportingCache = new Map();
    const records = rows.map((item) => {
      const experience = JSON.parse(item.body_json);
      const narration = JSON.parse(item.narration_json);
      let request;
      try { request = JSON.parse(item.request_json); } catch { throw failure("MEMORY_SOURCE_UNAVAILABLE"); }
      // A quotation belongs to the committed action in this local database.
      // Copied ancestor actions retain their original IDs and input; lineage
      // below changes attribution, never which database supplies the text.
      if (item.action_status !== "committed" || item.action_revision !== item.revision
        || !request || request.actionId !== item.action_id || request.baseRevision !== item.revision - 1
        || request.locale !== locale || request.contentVersion !== contentVersion
        || typeof request.input !== "string") throw failure("MEMORY_SOURCE_UNAVAILABLE");
      const passages = experience.sourceSegmentIds.map((id) => {
        const segment = narration.find((entry) => entry.id === id);
        if (!segment) throw failure("MEMORY_SOURCE_UNAVAILABLE");
        return segment;
      });
      const supportingPassages = openingSupportingPassages(item, experience, state, timeline, supportingCache);
      return { adventureId, revision: item.revision, actionId: item.action_id, experience, passages, playerInput: request.input,
        ...(supportingPassages ? { supportingPassages: structuredClone(supportingPassages) } : {}),
        source: mapSessionSource(timeline, item.revision) };
    });
    return { revision: row.revision, records, scannedRecords,
      nextCursor: candidates.length > limit ? pageEnd : null };
  }

  function close() {
    if (closed) return;
    transaction(() => {
      db.prepare("UPDATE actions SET status='interrupted',retryable=1,error_code='PROCESS_INTERRUPTED',updated_at=? WHERE owner_id=? AND status='running'")
        .run(new Date().toISOString(), ownerId);
      chapterStore.interruptOwned();
      compactionStore.interruptOwned();
    });
    executionStore.reconcile();
    db.close();
    closed = true;
  }

  const storySources = createStorySourceReader({ db, adventureId, locale, contentVersion, snapshot, timelineAt });
  return Object.freeze({ beginAction, commitAction, failAction, cancelAction, readAction, readPendingAction, readDiagnostics, recordExecution: executionStore.record, readView, readHistory, readModelState, readPlayerState, readMemoryFragments, readConditionSource, readTurn, readRecentTurns, listExperienceRecords, recoverInterruptedActions,
    ...storySources,
    ...chapterStore.api, ...finaleStore.api, ...terminalStore.api, ...compactionStore.api, close });
}

function requireDataFields(value, required, optional = []) {
  if (!value || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw failure("ACTION_INPUT_INVALID");
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.has(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw failure("ACTION_INPUT_INVALID");
  }
  if (required.some((key) => !Object.hasOwn(value, key))) throw failure("ACTION_INPUT_INVALID");
}

function checkExistingIdentity(databasePath, identity) {
  // Inspect the SQLite application tag without asking its pager to recover an
  // unrelated database. A crash with spilled pages needs a writable rollback.
  const header = Buffer.alloc(100);
  const fd = fs.openSync(databasePath, "r");
  let bytes;
  try { bytes = fs.readSync(fd, header, 0, header.length, 0); }
  finally { fs.closeSync(fd); }
  if (bytes < 100 || header.toString("ascii", 0, 16) !== "SQLite format 3\u0000"
    || header.readUInt32BE(68) !== APPLICATION_ID || header.readUInt32BE(60) !== 1) {
    throw failure("SAVE_FORMAT_UNSUPPORTED");
  }
  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    let row;
    try { row = db.prepare("SELECT * FROM session WHERE singleton=1").get(); }
    catch (error) {
      if ((error.errcode & 0xff) !== 8 || !fs.existsSync(`${databasePath}-journal`)) throw error;
      db.close();
      db = new DatabaseSync(databasePath);
      // SQLite restores its own hot journal; never delete or rewrite it ourselves.
      row = db.prepare("SELECT * FROM session WHERE singleton=1").get();
    }
    if (row?.format !== FORMAT) throw failure("SAVE_FORMAT_UNSUPPORTED");
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_import'").get()) {
      throw failure("SAVE_FORMAT_UNSUPPORTED");
    }
    if (row.adventure_id !== identity.adventureId || row.locale !== identity.locale || row.content_version !== identity.contentVersion) {
      throw failure("SAVE_IDENTITY_MISMATCH");
    }
  } catch (error) {
    if (error.code?.startsWith("SAVE_")) throw error;
    if ((error.errcode & 0xff) === 5) throw failure("STORE_BUSY");
    throw failure("SAVE_FORMAT_UNSUPPORTED");
  } finally { db?.close(); }
}

function validateDatabasePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw failure("SAVE_PATH_INVALID");
  // Resolve the explicitly supplied directory once; refuse database/sidecar symlinks.
  let directory;
  try { directory = fs.realpathSync(path.dirname(value)); } catch { throw failure("SAVE_PATH_INVALID"); }
  if (!fs.statSync(directory).isDirectory()) throw failure("SAVE_PATH_INVALID");
  const result = path.join(directory, path.basename(value));
  for (const candidate of [result, `${result}-journal`, `${result}-wal`, `${result}-shm`]) {
    try {
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw failure("SAVE_PATH_INVALID");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return result;
}

function normalizeRequest(value, identity) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw failure("ACTION_INPUT_INVALID");
  const keys = ["actionId", "baseRevision", "input", "locale", "contentVersion"];
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) throw failure("ACTION_INPUT_INVALID");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw failure("ACTION_INPUT_INVALID");
  }
  const request = {
    actionId: requireId(value.actionId), baseRevision: requireRevision(value.baseRevision),
    input: requireText(value.input, 100000), locale: requireText(value.locale, 64),
    contentVersion: requireText(value.contentVersion, 256),
  };
  if (request.locale !== identity.locale || request.contentVersion !== identity.contentVersion) throw failure("SAVE_IDENTITY_MISMATCH");
  return request;
}

function requireId(value) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw failure("ACTION_INPUT_INVALID");
  return value;
}
function requireText(value, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw failure("ACTION_INPUT_INVALID");
  return value;
}
function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw failure("REVISION_CONFLICT");
  return value;
}
function requireErrorCode(value) {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,95}$/.test(value)) throw failure("ACTION_INPUT_INVALID");
}
function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

module.exports = { createTurnStore };
