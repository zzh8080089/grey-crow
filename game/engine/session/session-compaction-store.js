"use strict";
const { PROVIDER_ERROR_CODES } = require("./session-provider-error");

const { createHash, randomUUID } = require("node:crypto");
const { readSessionTimeline, mapSessionSource } = require("./session-lineage");
const { projectContextHistory } = require("./session-context-history");
const { countContextText } = require("./session-context");
const { COMPACTION_QUOTE_FORMAT, COMPACTION_QUOTE_MAX_ITEMS, createCompactionQuotes, validateCompactionQuotes } = require("./session-compaction-quotes");

const COMPACTION_LIMITS = Object.freeze({ items: COMPACTION_QUOTE_MAX_ITEMS, itemCharacters: 1200, entityIds: 12,
  sourcesPerItem: 16, candidateCharacters: 64000, historyMaxCharacters: 8000000,
  historyMaxBytes: 8 * 1024 * 1024 - 4096 });
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const HASH = /^[a-f0-9]{64}$/;
const RECOVERABLE_FAILURE_SQL = `(retryable=1 OR error_code IN (${PROVIDER_ERROR_CODES.map(() => "?").join(",")}))`;
const FAILURE_CODES = new Set([...PROVIDER_ERROR_CODES, "COMPACTION_INTERRUPTED", "COMPACTION_CANCELLED", "COMPACTION_TIMEOUT",
  "COMPACTION_PLAN_STALE", "COMPACTION_MODEL_UNAVAILABLE", "COMPACTION_MODEL_FAILED",
  "COMPACTION_MODEL_BUDGET_EXCEEDED", "COMPACTION_CONTEXT_BUDGET_EXCEEDED", "COMPACTION_OUTPUT_INVALID",
  "COMPACTION_OUTPUT_BUDGET_EXCEEDED", "COMPACTION_SOURCE_UNAVAILABLE", "COMPACTION_STATE_UNAVAILABLE",
  "COMPACTION_VALIDATION_FAILED", "COMPACTION_COMMIT_FAILED", "CONTEXT_HISTORY_TOO_LARGE"]);

// Compactions share the story connection, but are derived records. Keeping the
// result and receipt in one row makes adopting coverage an atomic operation.
function createCompactionStore({ db, transaction, assertOpen, identity, currentRevision, ownerId, ownerGeneration, ownerProcessIdentity, fault }) {
  const { adventureId } = identity;
  transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS context_compactions (
      adventure_id TEXT NOT NULL, request_id TEXT NOT NULL,
      request_json TEXT NOT NULL, input_hash TEXT NOT NULL, viewer_id TEXT,
      settings_identity TEXT NOT NULL, target_revision INTEGER NOT NULL,
      source_hash TEXT NOT NULL, through_revision INTEGER NOT NULL,
      start_generation INTEGER NOT NULL, coverage_hash TEXT,
      status TEXT NOT NULL CHECK(status IN ('running','committed','failed','interrupted','cancelled')),
      attempt_id TEXT NOT NULL, owner_id TEXT NOT NULL, owner_pid INTEGER NOT NULL, owner_generation TEXT, owner_process_identity TEXT,
      acquisition_id TEXT,
      owner_action_id TEXT, owner_attempt_id TEXT,
      retryable INTEGER NOT NULL DEFAULT 0, error_code TEXT,
      outcome TEXT CHECK(outcome IN ('reduced','no_benefit')),
      result_json TEXT, committed_generation INTEGER,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(adventure_id,request_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_compaction ON context_compactions(adventure_id) WHERE status='running';
    CREATE INDEX IF NOT EXISTS compaction_summaries ON context_compactions(viewer_id,target_revision,committed_generation) WHERE status='committed' AND outcome='reduced';`);
    if (!db.prepare("PRAGMA table_info(context_compactions)").all().some((column) => column.name === "acquisition_id")) {
      db.exec("ALTER TABLE context_compactions ADD COLUMN acquisition_id TEXT");
    }
    if (!db.prepare("PRAGMA table_info(context_compactions)").all().some((column) => column.name === "owner_generation")) {
      db.exec("ALTER TABLE context_compactions ADD COLUMN owner_generation TEXT");
    }
    if (!db.prepare("PRAGMA table_info(context_compactions)").all().some((column) => column.name === "owner_process_identity")) {
      db.exec("ALTER TABLE context_compactions ADD COLUMN owner_process_identity TEXT");
    }
    const { createRecoveryVerifier } = require("./session-process-owner");
    const shouldRecover = createRecoveryVerifier();
    for (const row of db.prepare("SELECT request_id,owner_pid,owner_generation,owner_process_identity,updated_at FROM context_compactions WHERE adventure_id=? AND status='running'").all(adventureId)) {
      if (shouldRecover(row)) interruptJob(row.request_id);
    }
  });

  function rowFor(requestId) {
    id(requestId);
    return db.prepare("SELECT * FROM context_compactions WHERE adventure_id=? AND request_id=?").get(adventureId, requestId);
  }
  function publicJob(row) {
    if (!row) return null;
    const request = JSON.parse(row.request_json);
    const result = row.result_json ? JSON.parse(row.result_json) : null;
    return { adventureId: row.adventure_id, requestId: row.request_id, revision: row.target_revision,
      input: request.input, inputHash: row.input_hash, viewerId: row.viewer_id, settingsIdentity: row.settings_identity,
      sourceHash: row.source_hash, throughRevision: row.through_revision, contextGeneration: row.start_generation,
      summaryId: row.request_id, attemptId: row.attempt_id, status: row.status,
      acquisitionId: row.acquisition_id ?? null, ownedHere: row.owner_id === ownerId,
      ownerActionId: row.owner_action_id, ownerAttemptId: row.owner_attempt_id,
      outcome: row.outcome, ...(result ? result : {}),
      ...(row.committed_generation === null ? {} : { committedGeneration: row.committed_generation }),
      ...(row.error_code ? { error: { code: row.error_code, retryable: Boolean(row.retryable) } } : {}) };
  }
  function matching(requestId, attemptId, writing = false) {
    id(attemptId);
    const row = rowFor(requestId);
    if (!row) throw failure("COMPACTION_NOT_FOUND");
    if (row.attempt_id !== attemptId) throw failure("COMPACTION_ATTEMPT_STALE");
    if (writing && row.owner_id !== ownerId) throw failure("COMPACTION_OWNER_MISMATCH");
    return row;
  }
  function sourceAt(revision) {
    integer(revision, 0);
    const row = db.prepare("SELECT state_json FROM turns WHERE revision=?").get(revision);
    if (!row || revision > currentRevision()) throw failure("VIEW_REVISION_UNAVAILABLE");
    let timeline;
    try { timeline = readSessionTimeline(db, { adventureId, revision }); }
    catch { throw failure("COMPACTION_SOURCE_UNAVAILABLE"); }
    const state = JSON.parse(row.state_json);
    const viewerId = state.situation.playerId;
    const visibleIds = Object.values(state.entities).filter((entity) => entity.visibility === "player").map((entity) => entity.id);
    return { revision, timeline, state, viewerId, visibleIds, visibleJson: JSON.stringify(visibleIds) };
  }
  function sourceRows(throughRevision, afterRevision = 0) {
    return db.prepare(`SELECT t.revision,t.action_id,t.narration_json,a.request_json FROM turns t
      JOIN actions a ON a.action_id=t.action_id AND a.status='committed' AND a.revision=t.revision
      WHERE t.revision>? AND t.revision<=? ORDER BY t.revision`).iterate(afterRevision, throughRevision);
  }
  function storyTurn(row, source) {
    return { revision: row.revision, actionId: row.action_id, input: JSON.parse(row.request_json).input,
      narration: JSON.parse(row.narration_json), source: mapSessionSource(source.timeline, row.revision),
      storyTurn: row.revision - source.timeline.systemRevisions.filter((r) => r <= row.revision).length };
  }
  function visibleExperiences(source, throughRevision) {
    return db.prepare(`SELECT e.revision,e.experience_id,e.body_json FROM experience_access access
      JOIN experiences e ON e.revision=access.revision AND e.experience_id=access.experience_id
      WHERE access.viewer_id=? AND e.revision<=?
        AND NOT EXISTS (SELECT 1 FROM json_each(e.body_json,'$.entityIds') WHERE value NOT IN (SELECT value FROM json_each(?)))
        AND NOT EXISTS (SELECT 1 FROM experience_replacements replacement JOIN experiences correction
          ON correction.revision=replacement.correction_revision AND correction.experience_id=replacement.correction_experience_id
          WHERE replacement.viewer_id=? AND replacement.target_revision=e.revision
            AND replacement.target_experience_id=e.experience_id AND replacement.correction_revision<=?
            AND NOT EXISTS (SELECT 1 FROM json_each(correction.body_json,'$.entityIds') WHERE value NOT IN (SELECT value FROM json_each(?))))
      ORDER BY e.revision,e.experience_id`).iterate(source.viewerId, throughRevision, source.visibleJson,
      source.viewerId, source.revision, source.visibleJson);
  }
  // Hash the original prefix incrementally, independent of the current summary.
  // A visible correction outside the prefix removes its old experience from
  // this fingerprint too; a carried-forward summary cannot miss that correction.
  function sourceHash(source, throughRevision) {
    const hash = createHash("sha256");
    const add = (value) => hash.update(JSON.stringify(value)).update("\n");
    add({ viewerId: source.viewerId, locale: identity.locale, contentVersion: identity.contentVersion, throughRevision });
    for (const row of sourceRows(throughRevision)) add(storyTurn(row, source));
    for (const revision of source.timeline.systemRevisions) {
      if (revision <= throughRevision) add({ revision, system: JSON.parse(db.prepare("SELECT events_json FROM turns WHERE revision=?").get(revision).events_json) });
    }
    for (const row of visibleExperiences(source, throughRevision)) add({ revision: row.revision,
      source: mapSessionSource(source.timeline, row.revision), experience: JSON.parse(row.body_json) });
    return hash.digest("hex");
  }
  function applicable(row, source) {
    if (row.target_revision > source.revision || row.viewer_id !== source.viewerId) return false;
    if (row.adventure_id === adventureId) return true;
    return source.timeline.lineage.some((link) => link.parentAdventureId === row.adventure_id && row.target_revision <= link.parentRevision);
  }
  function generation(source) {
    let value = 0;
    for (const row of db.prepare("SELECT * FROM context_compactions WHERE status='committed' AND outcome='reduced' AND target_revision<=?").iterate(source.revision)) {
      if (applicable(row, source)) value = Math.max(value, row.committed_generation);
    }
    return value;
  }
  function materialize(source) {
    const contextGeneration = generation(source);
    const hash = sourceHash(source, source.revision);
    let summary = null;
    let summaryValidity = "none";
    for (const row of db.prepare("SELECT * FROM context_compactions WHERE status='committed' AND outcome='reduced' AND target_revision<=? ORDER BY committed_generation DESC").iterate(source.revision)) {
      if (!applicable(row, source)) continue;
      try {
        const candidate = JSON.parse(row.result_json).summary;
        if (!candidate || row.coverage_hash !== sourceHash(source, row.through_revision)) throw failure("COMPACTION_VALIDATION_FAILED");
        summary = validateSummary({ format: candidate.format, items: candidate.items }, row, source);
        summaryValidity = "valid";
      } catch { summaryValidity = "invalidated"; }
      // If the latest adopted summary is invalid, expose the complete original
      // prefix again. Never silently substitute another stale summary.
      break;
    }
    const materializationId = digest({ adventureId, revision: source.revision, viewerId: source.viewerId,
      contextGeneration, sourceHash: hash, summary, summaryValidity });
    return { contextGeneration, materializationId, sourceHash: hash, summary, summaryValidity };
  }

  function readSnapshot(operation) {
    assertOpen(); db.exec("BEGIN");
    try { const result = operation(); db.exec("COMMIT"); return result; }
    catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  }
  function readContextHistory(options = {}) { return readSnapshot(() => contextHistory(options)); }

  function emptyHistory(source, state) {
    return { adventureId, revision: source.revision, viewerId: source.viewerId, ...state,
      turns: [], timeline: { systemRevisions: source.timeline.systemRevisions, storyTurnCount: source.timeline.storyTurnCount },
      continuation: source.timeline.continuation };
  }
  // This private manifest never contains the full transcript. Counts cover
  // its exact JSON encoded again as a messages.content string, including escapes.
  function readContextCompaction(options = {}) { return readSnapshot(() => {
    fields(options, ["revision"], ["summary"]);
    const source = sourceAt(options.revision), state = materialize(source);
    const history = emptyHistory(source, state);
    const fullHistoryCounts = countContextText(JSON.stringify(JSON.stringify(projectContextHistory(history))));
    const retained = []; let replacedCount = 0;
    let nativeThrough = state.summary?.throughRevision ?? 0;
    let length = 0;
    const add = (turn) => {
      const part = countContextText(JSON.stringify(JSON.stringify(turn)).slice(1, -1));
      if (length++) { part.ascii++; part.characters++; part.bytes++; }
      for (const key of Object.keys(part)) fullHistoryCounts[key] += part[key];
      retained.push(turn);
      if (retained.length > 2) {
        const previous = retained.shift(); replacedCount++;
        nativeThrough = previous.revision;
      }
    };
    for (const row of sourceRows(source.revision, state.summary?.throughRevision ?? 0)) add(storyTurn(row, source));
    history.turns = retained;
    const range = replacedCount ? { fromRevision: 1, throughRevision: nativeThrough } : null;
    const result = { kind: "streamed_context", history, range, replacedCount, fullHistoryCounts };
    if (options.summary !== undefined) {
      const candidate = cloneJson(options.summary, "COMPACTION_VALIDATION_FAILED");
      fields(candidate, ["summaryId", "fromRevision", "throughRevision", "format", "items"], [], "COMPACTION_VALIDATION_FAILED");
      if (!range || candidate.fromRevision !== 1 || candidate.throughRevision !== range.throughRevision
        || candidate.summaryId === state.summary?.summaryId) throw failure("COMPACTION_VALIDATION_FAILED");
      id(candidate.summaryId, "COMPACTION_VALIDATION_FAILED");
      const summary = validateSummary({ format: candidate.format, items: candidate.items }, { request_id: candidate.summaryId,
        through_revision: range.throughRevision }, source);
      result.candidateHistory = { ...history, summary, summaryValidity: "valid" };
    }
    const serialized = JSON.stringify(result);
    if (serialized.length > COMPACTION_LIMITS.historyMaxCharacters || Buffer.byteLength(serialized) > COMPACTION_LIMITS.historyMaxBytes) throw failure("CONTEXT_HISTORY_TOO_LARGE");
    return result;
  }); }

  function readCompactionSources(options) { return readSnapshot(() => {
    fields(options, ["requestId", "attemptId"], ["cursor", "limit", "maxCharacters"]);
    const row = matching(options.requestId, options.attemptId, true);
    if (row.status !== "running") throw failure("COMPACTION_NOT_RUNNING");
    const source = sourceAt(row.target_revision), state = materialize(source);
    if (currentRevision() !== row.target_revision || state.sourceHash !== row.source_hash
      || state.contextGeneration !== row.start_generation) throw failure("COMPACTION_PLAN_STALE");
    const limit = options.limit ?? 20, maximum = options.maxCharacters ?? 500000;
    integer(limit, 1, 100); integer(maximum, 1, 2000000);
    const nativeStart = state.summary?.throughRevision ?? 0;
    let afterRevision = nativeStart;
    if (options.cursor !== undefined) {
      const cursor = options.cursor;
      fields(cursor, ["adventureId", "requestId", "attemptId", "sourceHash", "revision", "afterRevision"]);
      if (cursor.adventureId !== adventureId || cursor.requestId !== row.request_id || cursor.attemptId !== row.attempt_id
        || cursor.sourceHash !== row.source_hash || cursor.revision !== row.target_revision) throw failure("COMPACTION_PLAN_STALE");
      integer(cursor.afterRevision, nativeStart, row.through_revision);
      afterRevision = cursor.afterRevision;
    }
    const records = []; let complete = false;
    const cursor = () => ({ adventureId, requestId: row.request_id, attemptId: row.attempt_id, sourceHash: row.source_hash,
      revision: row.target_revision, afterRevision });
    const page = () => ({ adventureId, revision: row.target_revision, requestId: row.request_id, attemptId: row.attempt_id,
      sourceHash: row.source_hash, records, nextCursor: complete ? null : cursor(), complete });
    const add = (turn) => {
      const before = afterRevision; afterRevision = turn.revision;
      records.push(turn);
      if (JSON.stringify(page()).length > maximum || Buffer.byteLength(JSON.stringify(page())) > COMPACTION_LIMITS.historyMaxBytes) {
        records.pop(); afterRevision = before;
        if (!records.length) throw failure("CONTEXT_HISTORY_TOO_LARGE"); return false;
      }
      return true;
    };
    for (const entry of sourceRows(row.through_revision, afterRevision)) {
      if (records.length >= limit || !add(storyTurn(entry, source))) return page();
    }
    complete = true;
    return page();
  }); }
  function contextHistory(options) {
    assertOpen();
    fields(options, [], ["revision", "maxCharacters"]);
    const maxCharacters = options.maxCharacters ?? COMPACTION_LIMITS.historyMaxCharacters;
    integer(maxCharacters, 1, COMPACTION_LIMITS.historyMaxCharacters);
    const source = sourceAt(options.revision ?? currentRevision());
    const state = materialize(source);
    const result = { adventureId, revision: source.revision, viewerId: source.viewerId, ...state,
      turns: [], timeline: { systemRevisions: source.timeline.systemRevisions, storyTurnCount: source.timeline.storyTurnCount },
      continuation: source.timeline.continuation };
    // Check serialized bytes, not only string length. No source paragraph is
    // truncated, and an oversized history remains an explicit failure.
    let serialized = JSON.stringify(result);
    let characters = serialized.length;
    let bytes = Buffer.byteLength(serialized);
    const check = () => { if (characters > maxCharacters || bytes > COMPACTION_LIMITS.historyMaxBytes) throw failure("CONTEXT_HISTORY_TOO_LARGE"); };
    check();
    for (const row of sourceRows(source.revision, state.summary?.throughRevision ?? 0)) {
      const turn = storyTurn(row, source);
      serialized = JSON.stringify(turn);
      characters += serialized.length + (result.turns.length ? 1 : 0);
      bytes += Buffer.byteLength(serialized) + (result.turns.length ? 1 : 0);
      check(); result.turns.push(turn);
    }
    return result;
  }

  function beginCompaction(options) {
    fields(options, ["requestId", "revision", "input", "viewerId", "settingsIdentity", "sourceHash", "throughRevision", "contextGeneration"],
      ["ownerActionId", "ownerAttemptId", "retry", "acquisitionId"]);
    id(options.requestId); integer(options.revision, 0); integer(options.throughRevision, 1, options.revision);
    integer(options.contextGeneration, 0);
    if (options.viewerId !== null) id(options.viewerId);
    if (options.acquisitionId !== undefined) id(options.acquisitionId);
    if (typeof options.input !== "string" || options.input.length > 100000 || !isHash(options.settingsIdentity)
      || !isHash(options.sourceHash) || (options.retry !== undefined && typeof options.retry !== "boolean")) throw failure("COMPACTION_INPUT_INVALID");
    const ownerActionId = options.ownerActionId ?? null;
    const ownerAttemptId = options.ownerAttemptId ?? null;
    if (ownerActionId !== null || ownerAttemptId !== null) { id(ownerActionId); id(ownerAttemptId); }
    const request = { requestId: options.requestId, revision: options.revision, input: options.input,
      viewerId: options.viewerId, settingsIdentity: options.settingsIdentity };
    const serialized = JSON.stringify(request);
    return transaction(() => {
      const previous = rowFor(options.requestId);
      if (previous && previous.request_json !== serialized) throw failure("COMPACTION_INPUT_CONFLICT");
      if (previous && (!options.retry || (!previous.retryable && !PROVIDER_ERROR_CODES.includes(previous.error_code))
        || !["failed", "interrupted"].includes(previous.status))) {
        return { ...publicJob(previous), started: false };
      }
      if (currentRevision() !== options.revision) throw failure("COMPACTION_PLAN_STALE");
      const source = sourceAt(options.revision);
      if (source.viewerId !== options.viewerId) throw failure("COMPACTION_INPUT_CONFLICT");
      if (source.state.finale?.phase === "confirmed") throw failure("COMPACTION_NOT_READY");
      if (generation(source) !== options.contextGeneration || sourceHash(source, source.revision) !== options.sourceHash) throw failure("COMPACTION_PLAN_STALE");
      const running = db.prepare("SELECT * FROM actions WHERE status='running'").get();
      if (ownerActionId === null) {
        if (running) throw failure("COMPACTION_BUSY");
      } else if (!running || running.action_id !== ownerActionId || running.attempt_id !== ownerAttemptId
        || running.owner_id !== ownerId || JSON.parse(running.request_json).baseRevision !== options.revision) throw failure("COMPACTION_OWNER_MISMATCH");
      const unresolved = db.prepare(`SELECT request_id FROM context_compactions WHERE adventure_id=? AND (status='running' OR (status IN ('failed','interrupted') AND ${RECOVERABLE_FAILURE_SQL})) AND request_id<>?`)
        .get(adventureId, ...PROVIDER_ERROR_CODES, options.requestId);
      if (unresolved) throw failure("COMPACTION_BUSY");
      if (db.prepare("SELECT 1 FROM context_compactions WHERE adventure_id=? AND status='committed' AND outcome='no_benefit' AND source_hash=? AND settings_identity=? AND input_hash=? AND json_extract(result_json,'$.format')=?")
        .get(adventureId, options.sourceHash, options.settingsIdentity, digest(options.input), COMPACTION_QUOTE_FORMAT)) {
        throw failure("COMPACTION_ALREADY_EVALUATED");
      }
      const attemptId = randomUUID();
      const now = new Date().toISOString();
      if (previous) {
        db.prepare(`UPDATE context_compactions SET status='running',attempt_id=?,owner_id=?,owner_pid=?,owner_generation=?,owner_process_identity=?,owner_action_id=?,owner_attempt_id=?,
          source_hash=?,through_revision=?,start_generation=?,acquisition_id=?,retryable=0,error_code=NULL,updated_at=? WHERE adventure_id=? AND request_id=?`)
          .run(attemptId, ownerId, process.pid, ownerGeneration, ownerProcessIdentity, ownerActionId, ownerAttemptId, options.sourceHash, options.throughRevision,
            options.contextGeneration, options.acquisitionId ?? null, now, adventureId, options.requestId);
      } else {
        db.prepare(`INSERT INTO context_compactions (adventure_id,request_id,request_json,input_hash,viewer_id,settings_identity,target_revision,
          source_hash,through_revision,start_generation,status,attempt_id,owner_id,owner_pid,owner_generation,owner_process_identity,owner_action_id,owner_attempt_id,acquisition_id,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,'running',?,?,?,?,?,?,?,?,?,?)`)
          .run(adventureId, options.requestId, serialized, digest(options.input), options.viewerId, options.settingsIdentity, options.revision,
            options.sourceHash, options.throughRevision,
            options.contextGeneration, attemptId, ownerId, process.pid, ownerGeneration, ownerProcessIdentity, ownerActionId, ownerAttemptId, options.acquisitionId ?? null, now, now);
      }
      return { ...publicJob(rowFor(options.requestId)), started: true };
    });
  }

  function validateSummary(value, row, source) {
    const code = "COMPACTION_VALIDATION_FAILED";
    const candidate = validateCompactionQuotes(value);
    const byRevision = new Map();
    for (const item of candidate.items) {
      const ref = item.source;
      if (ref.revision > row.through_revision || source.timeline.systemRevisions.includes(ref.revision)
        || mapSessionSource(source.timeline, ref.revision).adventureId !== ref.adventureId) throw failure(code);
      if (!byRevision.has(ref.revision)) byRevision.set(ref.revision, []);
      byRevision.get(ref.revision).push(item);
    }
    const allowed = new Map();
    for (const [revision, selected] of byRevision) {
      const turn = db.prepare(`SELECT t.narration_json,a.request_json FROM turns t JOIN actions a ON a.action_id=t.action_id
        AND a.status='committed' AND a.revision=t.revision WHERE t.revision=?`).get(revision);
      if (!turn) throw failure(code);
      const narration = JSON.parse(turn.narration_json);
      const playerInput = JSON.parse(turn.request_json).input;
      // Retain one source turn and bounded selected quotes, not every original
      // turn referenced by the candidate. Source ranges are program-defined:
      // a valid hash of an arbitrary substring is still not an allowed quote.
      const bySource = new Map();
      for (const item of selected) {
        const key = JSON.stringify(item.source);
        if (!bySource.has(key)) bySource.set(key, []);
        bySource.get(key).push(item);
      }
      for (const group of bySource.values()) {
        const ref = group[0].source;
        const original = ref.kind === "player_input" ? playerInput
          : narration.find((paragraph) => paragraph.id === ref.segmentId)?.text;
        if (typeof original !== "string") throw failure(code);
        const quotes = new Map(createCompactionQuotes({ ...ref, text: original }).map((quote) => [quote.quoteId, quote]));
        for (const item of group) {
          const expected = quotes.get(item.quoteId);
          if (!expected || item.text !== original.slice(item.range.start, item.range.end)
            || item.range.totalCharacters !== original.length) throw failure(code);
          allowed.set(item.quoteId, expected);
        }
      }
    }
    return { summaryId: row.request_id, fromRevision: 1, throughRevision: row.through_revision,
      ...validateCompactionQuotes(candidate, allowed) };
  }
  function validateMetrics(value, row, outcome) {
    const code = "COMPACTION_VALIDATION_FAILED";
    const metrics = cloneJson(value, code);
    fields(metrics, ["before", "after", "savedSafetyInputTokens"], [], code);
    for (const usage of [metrics.before, metrics.after]) {
      // Mid-action compaction budgets include the paused tool conversation.
      // Preserve its scope, but only accept the exact durable action owner.
      const ownedInvocation = row.owner_action_id !== null && usage?.scope === "invocation"
        && usage.actionId === row.owner_action_id;
      if (!usage || usage.adventureId !== row.adventure_id || usage.revision !== row.target_revision
        || !(ownedInvocation || usage.actionId === null && usage.scope === "next_request") || usage.settingsIdentity !== row.settings_identity
        || typeof usage.fits !== "boolean") throw failure(code);
      for (const key of ["inputTokens", "safetyInputTokens", "characters", "bytes", "callIndex"]) integer(usage.latestEstimate?.[key], 0, Number.MAX_SAFE_INTEGER, code);
      if (ownedInvocation && usage.latestEstimate.callIndex < 1) throw failure(code);
      if (usage.contextGeneration !== undefined && usage.contextGeneration !== row.start_generation) throw failure(code);
    }
    if (metrics.before.scope !== metrics.after.scope || metrics.before.actionId !== metrics.after.actionId
      || metrics.before.latestEstimate.callIndex !== metrics.after.latestEstimate.callIndex) throw failure(code);
    const saved = metrics.before.latestEstimate.safetyInputTokens - metrics.after.latestEstimate.safetyInputTokens;
    if (!Number.isSafeInteger(metrics.savedSafetyInputTokens) || metrics.savedSafetyInputTokens !== saved
      || (outcome === "reduced" && (saved <= 0 || !metrics.after.fits))) throw failure(code);
    return metrics;
  }
  function commitCompaction(options) {
    fields(options, ["requestId", "attemptId", "outcome", "metrics"], ["summary"]);
    if (!["reduced", "no_benefit"].includes(options.outcome) || (options.outcome === "reduced") !== (options.summary !== undefined)) throw failure("COMPACTION_INPUT_INVALID");
    const result = transaction(() => {
      const row = matching(options.requestId, options.attemptId);
      if (row.status === "committed") return { job: publicJob(row), inserted: false };
      if (row.status !== "running") throw failure("COMPACTION_NOT_RUNNING");
      matching(options.requestId, options.attemptId, true);
      if (currentRevision() !== row.target_revision) throw failure("COMPACTION_PLAN_STALE");
      const source = sourceAt(row.target_revision);
      if (source.viewerId !== row.viewer_id || generation(source) !== row.start_generation
        || sourceHash(source, source.revision) !== row.source_hash) throw failure("COMPACTION_PLAN_STALE");
      if (row.owner_action_id !== null) {
        const owner = db.prepare("SELECT * FROM actions WHERE action_id=?").get(row.owner_action_id);
        if (!owner || owner.status !== "running" || owner.attempt_id !== row.owner_attempt_id || owner.owner_id !== ownerId) throw failure("COMPACTION_OWNER_MISMATCH");
      }
      const metrics = validateMetrics(options.metrics, row, options.outcome);
      const summary = options.outcome === "reduced" ? validateSummary(options.summary, row, source) : null;
      const generationValue = options.outcome === "reduced"
        ? (db.prepare("SELECT max(committed_generation) AS value FROM context_compactions").get().value ?? 0) + 1 : row.start_generation;
      const body = { format: COMPACTION_QUOTE_FORMAT, metrics, ...(summary ? { summary } : {}) };
      db.prepare("UPDATE context_compactions SET result_json=?,coverage_hash=? WHERE adventure_id=? AND request_id=?")
        .run(JSON.stringify(body), summary ? sourceHash(source, row.through_revision) : null, adventureId, row.request_id);
      fault("after_compaction_result");
      db.prepare("UPDATE context_compactions SET status='committed',outcome=?,committed_generation=?,retryable=0,error_code=NULL,updated_at=? WHERE adventure_id=? AND request_id=?")
        .run(options.outcome, generationValue, new Date().toISOString(), adventureId, row.request_id);
      fault("after_compaction_job");
      return { job: publicJob(rowFor(row.request_id)), inserted: true };
    });
    if (result.inserted) fault("after_compaction_commit");
    return result.job;
  }
  function failCompaction(options) {
    fields(options, ["requestId", "attemptId", "code"], ["retryable"]);
    if (!FAILURE_CODES.has(options.code) || (options.retryable !== undefined && typeof options.retryable !== "boolean")) throw failure("COMPACTION_INPUT_INVALID");
    return transaction(() => {
      const row = matching(options.requestId, options.attemptId);
      if (row.status !== "running") return publicJob(row);
      matching(options.requestId, options.attemptId, true);
      const status = options.code === "COMPACTION_INTERRUPTED" ? "interrupted" : options.code === "COMPACTION_CANCELLED" ? "cancelled" : "failed";
      db.prepare("UPDATE context_compactions SET status=?,error_code=?,retryable=?,updated_at=? WHERE adventure_id=? AND request_id=?")
        .run(status, options.code, status === "cancelled" || options.code === "COMPACTION_PLAN_STALE" || options.retryable === false ? 0 : 1,
          new Date().toISOString(), adventureId, row.request_id);
      return publicJob(rowFor(row.request_id));
    });
  }
  function cancelCompaction(requestId) {
    assertOpen(); id(requestId);
    return transaction(() => {
      const row = rowFor(requestId);
      if (!row || row.status === "committed" || row.status === "cancelled") return publicJob(row);
      db.prepare("UPDATE context_compactions SET status='cancelled',error_code='COMPACTION_CANCELLED',retryable=0,updated_at=? WHERE adventure_id=? AND request_id=?")
        .run(new Date().toISOString(), adventureId, requestId);
      return publicJob(rowFor(requestId));
    });
  }
  function invalidateCompaction(options) {
    fields(options, ["requestId"], ["settingsIdentity"]);
    if (options.settingsIdentity !== undefined && !isHash(options.settingsIdentity)) throw failure("COMPACTION_INPUT_INVALID");
    return transaction(() => {
      const row = rowFor(options.requestId);
      if (!row) throw failure("COMPACTION_NOT_FOUND");
      if (row.status === "running") throw failure("COMPACTION_BUSY");
      if (!["failed", "interrupted"].includes(row.status)
        || (!row.retryable && !PROVIDER_ERROR_CODES.includes(row.error_code))) return publicJob(row);
      const source = sourceAt(currentRevision());
      const stale = row.target_revision !== source.revision
        || (options.settingsIdentity !== undefined && options.settingsIdentity !== row.settings_identity)
        || row.start_generation !== generation(source) || row.source_hash !== sourceHash(source, source.revision);
      if (!stale) throw failure("COMPACTION_INPUT_CONFLICT");
      // This is an explicit manual decision, never a read or an automatic retry.
      db.prepare("UPDATE context_compactions SET status='failed',error_code='COMPACTION_PLAN_STALE',retryable=0,updated_at=? WHERE adventure_id=? AND request_id=?")
        .run(new Date().toISOString(), adventureId, row.request_id);
      return publicJob(rowFor(row.request_id));
    });
  }
  function readCompactionJob(requestId) { assertOpen(); return publicJob(rowFor(requestId)); }
  function readCompactionState(options = {}) { return readSnapshot(() => compactionState(options)); }
  function compactionState(options) {
    assertOpen(); fields(options, [], ["revision"]);
    const source = sourceAt(options.revision ?? currentRevision());
    const state = materialize(source);
    const pending = db.prepare(`SELECT * FROM context_compactions WHERE adventure_id=? AND target_revision<=? AND (status='running' OR (status IN ('failed','interrupted') AND ${RECOVERABLE_FAILURE_SQL})) ORDER BY created_at,request_id LIMIT 1`)
      .get(adventureId, source.revision, ...PROVIDER_ERROR_CODES);
    const complete = db.prepare("SELECT * FROM context_compactions WHERE adventure_id=? AND target_revision<=? AND status='committed' ORDER BY updated_at DESC,rowid DESC LIMIT 1")
      .get(adventureId, source.revision);
    return { adventureId, revision: source.revision, contextGeneration: state.contextGeneration,
      materializationId: state.materializationId, sourceHash: state.sourceHash, summaryValidity: state.summaryValidity,
      summary: state.summary && { summaryId: state.summary.summaryId, fromRevision: 1, throughRevision: state.summary.throughRevision,
        },
      pendingJob: publicJob(pending), lastCompleted: complete ? { requestId: complete.request_id, revision: complete.target_revision,
        outcome: complete.outcome, format: complete.result_json ? JSON.parse(complete.result_json).format ?? null : null,
        sourceHash: complete.source_hash, settingsIdentity: complete.settings_identity, inputHash: complete.input_hash } : null };
  }
  function assertActionAllowed() {
    if (db.prepare("SELECT 1 FROM context_compactions WHERE adventure_id=? AND status='running'").get(adventureId)) throw failure("COMPACTION_BUSY");
  }
  function interruptJob(requestId) {
    db.prepare("UPDATE context_compactions SET status='interrupted',error_code='COMPACTION_INTERRUPTED',retryable=1,updated_at=? WHERE adventure_id=? AND request_id=? AND status='running'")
      .run(new Date().toISOString(), adventureId, requestId);
  }
  function interruptOwned() {
    for (const row of db.prepare("SELECT request_id FROM context_compactions WHERE adventure_id=? AND owner_id=? AND status='running'").all(adventureId, ownerId)) interruptJob(row.request_id);
  }
  return { api: { beginCompaction, commitCompaction, failCompaction, cancelCompaction, invalidateCompaction, readContextCompaction, readCompactionSources,
    readCompactionJob, readCompactionState, readContextHistory }, assertActionAllowed, interruptOwned };
}

function fields(value, required, optional = [], code = "COMPACTION_INPUT_INVALID") {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw failure(code);
  if (required.some((key) => !Object.hasOwn(value, key))) throw failure(code);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (![...required, ...optional].includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw failure(code);
  }
}
function cloneJson(value, code) {
  const ancestors = new Set(); let nodes = 0;
  function copy(item, depth) {
    if (++nodes > 30000 || depth > 24) throw failure(code);
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string" && item.length <= COMPACTION_LIMITS.candidateCharacters) return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || ancestors.has(item)) throw failure(code);
    const array = Array.isArray(item);
    if (array && Object.getPrototypeOf(item) !== Array.prototype) throw failure(code);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw failure(code);
    ancestors.add(item); const result = array ? [] : {};
    if (array && (item.length > 4096 || Reflect.ownKeys(item).length !== item.length + 1)) throw failure(code);
    for (const key of Reflect.ownKeys(item)) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
        || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw failure(code);
      result[key] = copy(descriptor.value, depth + 1);
    }
    ancestors.delete(item); return result;
  }
  const result = copy(value, 0);
  if (JSON.stringify(result).length > COMPACTION_LIMITS.candidateCharacters) throw failure(code);
  return result;
}
function id(value, code = "COMPACTION_INPUT_INVALID") { if (typeof value !== "string" || !ID.test(value)) throw failure(code); }
function isHash(value) { return typeof value === "string" && HASH.test(value); }
function integer(value, min, max = Number.MAX_SAFE_INTEGER, code = "COMPACTION_INPUT_INVALID") {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw failure(code);
}
function digest(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function failure(code) { return Object.assign(new Error(code), { code }); }

module.exports = { createCompactionStore, COMPACTION_LIMITS };
