"use strict";
const { PROVIDER_ERROR_CODES } = require("./session-provider-error");

const { randomUUID } = require("node:crypto");
const { readSessionTimeline, projectSessionTimeline, storyTurnAt, mapSessionSource } = require("./session-lineage");


const CHAPTER_LIMITS = Object.freeze({
  titleCharacters: 120, summaryCharacters: 6000, itemsPerKind: 16,
  itemCharacters: 500, sourcesPerItem: 64, candidateCharacters: 128000,
  sourceDefaultCharacters: 48000, sourceMaxCharacters: 8000000,
  pageMaxBytes: 8 * 1024 * 1024 - 4096,
});
const CHAPTER_FALLBACK_REASONS = Object.freeze([
  "CHAPTER_MODEL_UNAVAILABLE", "CHAPTER_MODEL_FAILED", "CHAPTER_OUTPUT_INVALID",
  "CHAPTER_CONTEXT_BUDGET_EXCEEDED", "CHAPTER_MODEL_BUDGET_EXCEEDED", "CHAPTER_OUTPUT_BUDGET_EXCEEDED",
]);
const FAILURE_CODES = new Set([...PROVIDER_ERROR_CODES, ...CHAPTER_FALLBACK_REASONS,
  "CHAPTER_INTERRUPTED", "CHAPTER_TIMEOUT", "CHAPTER_SOURCE_TOO_LARGE", "CHAPTER_SOURCE_UNAVAILABLE",
  "CHAPTER_VALIDATION_FAILED", "CHAPTER_GENERATION_FAILED", "CHAPTER_COMMIT_FAILED",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

// The connection and transaction belong to turn-store. Chapters are derived
// records in that same database; none of these operations advances story state.
function createChapterStore({ db, transaction, assertOpen, identity, currentRevision, ownerId, ownerGeneration, ownerProcessIdentity, fault }) {
  const { adventureId } = identity;
  transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chapter_jobs (
        chapter_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('running','committed','failed','interrupted')),
        attempt_id TEXT NOT NULL, from_revision INTEGER NOT NULL CHECK (from_revision>0),
        to_revision INTEGER NOT NULL CHECK (to_revision>=from_revision),
        owner_id TEXT NOT NULL, owner_pid INTEGER NOT NULL, owner_generation TEXT, owner_process_identity TEXT,
        retryable INTEGER NOT NULL DEFAULT 0, error_code TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_running_chapter ON chapter_jobs ((1)) WHERE status='running';
      CREATE TABLE IF NOT EXISTS chapters (
        chapter_id TEXT PRIMARY KEY REFERENCES chapter_jobs(chapter_id),
        from_revision INTEGER NOT NULL REFERENCES turns(revision),
        to_revision INTEGER NOT NULL UNIQUE REFERENCES turns(revision),
        created_at TEXT NOT NULL, body_json TEXT NOT NULL
      );
    `);
    if (!db.prepare("PRAGMA table_info(chapter_jobs)").all().some((column) => column.name === "owner_generation")) {
      db.exec("ALTER TABLE chapter_jobs ADD COLUMN owner_generation TEXT");
    }
    if (!db.prepare("PRAGMA table_info(chapter_jobs)").all().some((column) => column.name === "owner_process_identity")) {
      db.exec("ALTER TABLE chapter_jobs ADD COLUMN owner_process_identity TEXT");
    }
    const { createRecoveryVerifier } = require("./session-process-owner");
    const shouldRecover = createRecoveryVerifier();
    for (const job of db.prepare("SELECT chapter_id,owner_pid,owner_generation,owner_process_identity,updated_at FROM chapter_jobs WHERE status='running'").all()) {
      if (shouldRecover(job)) interruptJob(job.chapter_id);
    }
  });

  function jobRow(chapterId) {
    requireId(chapterId);
    return db.prepare("SELECT * FROM chapter_jobs WHERE chapter_id=?").get(chapterId);
  }

  function publicChapter(row) {
    if (!row) return null;
    const body = JSON.parse(row.body_json);
    const timeline = chapterTimeline(row.to_revision);
    if (timeline.lineage.length) {
      for (const kind of ["keyEvents", "openThreads"]) {
        for (const item of body[kind]) item.sources = item.sources.map((source) => ({ ...source,
          source: mapSessionSource(timeline, source.revision) }));
      }
      body.source = mapSessionSource(timeline, row.to_revision);
    }
    return { chapterId: row.chapter_id, fromRevision: row.from_revision, toRevision: row.to_revision,
      createdAt: row.created_at, ...body };
  }

  function publicJob(row) {
    if (!row) return null;
    return { adventureId, chapterId: row.chapter_id, attemptId: row.attempt_id, status: row.status,
      fromRevision: row.from_revision, toRevision: row.to_revision,
      ...(row.error_code ? { error: { code: row.error_code, retryable: Boolean(row.retryable) } } : {}),
      ...(row.status === "committed" ? { chapter: publicChapter(db.prepare("SELECT * FROM chapters WHERE chapter_id=?").get(row.chapter_id)) } : {}),
    };
  }

  function targetRevision(revision) {
    const target = revision === undefined ? currentRevision() : revision;
    requireInteger(target, 0, Number.MAX_SAFE_INTEGER);
    const row = db.prepare("SELECT state_json FROM turns WHERE revision=?").get(target);
    if (!row) throw failure("VIEW_REVISION_UNAVAILABLE");
    return { target, row };
  }

  function coveredThrough() {
    return db.prepare("SELECT max(to_revision) AS revision FROM chapters").get().revision ?? 0;
  }

  function chapterTimeline(revision) {
    try { return readSessionTimeline(db, { adventureId, revision }); }
    catch { throw failure("CHAPTER_SOURCE_UNAVAILABLE"); }
  }

  function beginChapter(options) {
    fields(options, ["targetRevision"], ["retry"]);
    requireInteger(options.targetRevision, 0, Number.MAX_SAFE_INTEGER);
    if (options.retry !== undefined && typeof options.retry !== "boolean") throw failure("CHAPTER_INPUT_INVALID");
    return transaction(() => {
      const { target, row } = targetRevision(options.targetRevision);
      const timeline = chapterTimeline(target);
      const state = JSON.parse(row.state_json);
      if (state.opening && state.opening.phase !== "ready") throw failure("CHAPTER_NOT_READY");
      const first = state.opening ? state.opening.confirmation?.revision : 1;
      if (!Number.isSafeInteger(first) || first < 1 || (state.opening && first > target)) throw failure("CHAPTER_NOT_READY");
      const covered = coveredThrough();
      if (target <= covered) {
        const existing = db.prepare("SELECT chapter_id FROM chapters WHERE from_revision<=? AND to_revision>=? ORDER BY to_revision LIMIT 1")
          .get(target, target);
        return existing ? { ...publicJob(jobRow(existing.chapter_id)), status: "unchanged", started: false }
          : { adventureId, chapterId: null, attemptId: null, status: "unchanged", started: false, fromRevision: first, toRevision: target };
      }
      const lower = Math.max(first, covered + 1);
      const system = new Set(timeline.systemRevisions);
      let from = lower;
      let to = target;
      while (from <= to && system.has(from)) from += 1;
      while (to >= from && system.has(to)) to -= 1;
      if (to < from) return { adventureId, chapterId: null, attemptId: null, status: "unchanged", started: false, fromRevision: from, toRevision: target };
      const chapterId = `chapter-${to}`;
      const previous = jobRow(chapterId);
      if (previous && (previous.status === "running" || !options.retry
        || (!previous.retryable && !PROVIDER_ERROR_CODES.includes(previous.error_code)))) {
        return { ...publicJob(previous), started: false };
      }
      if (db.prepare("SELECT 1 FROM chapter_jobs WHERE status='running'").get()) throw failure("CHAPTER_BUSY");
      const attemptId = randomUUID();
      const now = new Date().toISOString();
      if (previous) {
        // An explicit retry keeps the target, but excludes chapters completed
        // since the failed attempt. The old attempt and its cursors are stale.
        db.prepare("UPDATE chapter_jobs SET status='running',attempt_id=?,from_revision=?,owner_id=?,owner_pid=?,owner_generation=?,owner_process_identity=?,retryable=0,error_code=NULL,updated_at=? WHERE chapter_id=?")
          .run(attemptId, from, ownerId, process.pid, ownerGeneration, ownerProcessIdentity, now, chapterId);
      } else {
        db.prepare("INSERT INTO chapter_jobs (chapter_id,status,attempt_id,from_revision,to_revision,owner_id,owner_pid,owner_generation,owner_process_identity,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .run(chapterId, "running", attemptId, from, to, ownerId, process.pid, ownerGeneration, ownerProcessIdentity, now, now);
      }
      return { ...publicJob(jobRow(chapterId)), started: true };
    });
  }

  function matchingJob(chapterId, attemptId, writing = false) {
    requireId(attemptId);
    const row = jobRow(chapterId);
    if (!row) throw failure("CHAPTER_NOT_FOUND");
    if (row.attempt_id !== attemptId) throw failure("CHAPTER_ATTEMPT_STALE");
    if (writing && row.owner_id !== ownerId) throw failure("CHAPTER_OWNER_MISMATCH");
    return row;
  }

  function commitChapter(options) {
    fields(options, ["chapterId", "attemptId", "chapter"]);
    const result = transaction(() => {
      const row = matchingJob(options.chapterId, options.attemptId);
      if (row.status === "committed") return { job: publicJob(row), inserted: false };
      if (row.status !== "running") throw failure("CHAPTER_NOT_RUNNING");
      matchingJob(options.chapterId, options.attemptId, true);
      if (coveredThrough() >= row.from_revision) throw failure("CHAPTER_RANGE_CONFLICT");
      const timeline = chapterTimeline(row.to_revision);
      const systemCount = timeline.systemRevisions.filter((revision) => revision >= row.from_revision && revision <= row.to_revision).length;
      const sourceCount = db.prepare("SELECT count(*) AS count FROM turns t JOIN actions a ON a.action_id=t.action_id WHERE t.revision>=? AND t.revision<=? AND a.status='committed' AND a.revision=t.revision")
        .get(row.from_revision, row.to_revision).count;
      if (sourceCount < 1 || sourceCount + systemCount !== row.to_revision - row.from_revision + 1) throw failure("CHAPTER_SOURCE_UNAVAILABLE");
      const chapter = validateChapter(options.chapter, row);
      const now = new Date().toISOString();
      db.prepare("INSERT INTO chapters VALUES (?,?,?,?,?)")
        .run(row.chapter_id, row.from_revision, row.to_revision, now, JSON.stringify(chapter));
      fault("after_chapter");
      db.prepare("UPDATE chapter_jobs SET status='committed',retryable=0,error_code=NULL,updated_at=? WHERE chapter_id=?")
        .run(now, row.chapter_id);
      fault("after_chapter_job");
      return { job: publicJob(jobRow(row.chapter_id)), inserted: true };
    });
    if (result.inserted) fault("after_chapter_commit");
    return result.job;
  }

  function validateChapter(value, job) {
    const code = "CHAPTER_VALIDATION_FAILED";
    const candidate = cloneJson(value, code);
    if (JSON.stringify(candidate).length > CHAPTER_LIMITS.candidateCharacters) throw failure(code);
    fields(candidate, ["title", "summary", "keyEvents", "openThreads", "mode"], ["fallbackReason"], code);
    text(candidate.title, CHAPTER_LIMITS.titleCharacters, code);
    text(candidate.summary, CHAPTER_LIMITS.summaryCharacters, code);
    if (!["model", "excerpt"].includes(candidate.mode)) throw failure(code);
    if (candidate.fallbackReason !== undefined && (candidate.mode !== "excerpt" || !CHAPTER_FALLBACK_REASONS.includes(candidate.fallbackReason))) throw failure(code);
    const segments = new Map();
    for (const kind of ["keyEvents", "openThreads"]) {
      if (!Array.isArray(candidate[kind]) || candidate[kind].length > CHAPTER_LIMITS.itemsPerKind) throw failure(code);
      for (const item of candidate[kind]) {
        fields(item, ["text", "sources"], [], code);
        text(item.text, CHAPTER_LIMITS.itemCharacters, code);
        if (!Array.isArray(item.sources) || item.sources.length < 1 || item.sources.length > CHAPTER_LIMITS.sourcesPerItem) throw failure(code);
        const seen = new Set();
        for (const source of item.sources) {
          fields(source, ["revision", "segmentId"], [], code);
          requireInteger(source.revision, job.from_revision, job.to_revision, code);
          requireId(source.segmentId, code);
          const key = `${source.revision}:${source.segmentId}`;
          if (seen.has(key)) throw failure(code);
          seen.add(key);
          if (!segments.has(source.revision)) {
            const row = db.prepare("SELECT t.narration_json FROM turns t JOIN actions a ON a.action_id=t.action_id WHERE t.revision=? AND a.status='committed' AND a.revision=t.revision").get(source.revision);
            if (!row) throw failure("CHAPTER_SOURCE_UNAVAILABLE");
            segments.set(source.revision, new Set(JSON.parse(row.narration_json).map((segment) => segment.id)));
          }
          if (!segments.get(source.revision).has(source.segmentId)) throw failure(code);
        }
      }
    }
    return candidate;
  }

  function failChapter(options) {
    fields(options, ["chapterId", "attemptId", "code"], ["retryable"]);
    if (!FAILURE_CODES.has(options.code) || (options.retryable !== undefined && typeof options.retryable !== "boolean")) throw failure("CHAPTER_INPUT_INVALID");
    return transaction(() => {
      const row = matchingJob(options.chapterId, options.attemptId);
      if (row.status !== "running") return publicJob(row);
      matchingJob(options.chapterId, options.attemptId, true);
      db.prepare("UPDATE chapter_jobs SET status=?,retryable=?,error_code=?,updated_at=? WHERE chapter_id=?")
        .run(options.code === "CHAPTER_INTERRUPTED" ? "interrupted" : "failed", options.retryable === false ? 0 : 1,
          options.code, new Date().toISOString(), row.chapter_id);
      return publicJob(jobRow(row.chapter_id));
    });
  }

  function readChapterJob(chapterId) {
    assertOpen();
    return publicJob(jobRow(chapterId));
  }

  function readTurnStart(revision, timeline) {
    const previousRevision = revision - 1;
    let row;
    try {
      // Select only the prior location's public identity, without loading old
      // descriptions or invoking unrelated memory/condition source readers.
      row = db.prepare(`SELECT json_type(t.state_json,'$.situation.locationId') AS location_type,
        json_extract(t.state_json,'$.situation.locationId') AS location_id,
        json_extract(e.value,'$.id') AS entity_id, json_extract(e.value,'$.kind') AS kind,
        json_extract(e.value,'$.name') AS name, json_extract(e.value,'$.visibility') AS visibility
        FROM turns t LEFT JOIN json_each(t.state_json,'$.entities') e
          ON e.key=json_extract(t.state_json,'$.situation.locationId')
        WHERE t.revision=?`).get(previousRevision);
    } catch { throw failure("CHAPTER_SOURCE_UNAVAILABLE"); }
    if (!row || !["text", "null"].includes(row.location_type)) throw failure("CHAPTER_SOURCE_UNAVAILABLE");
    let location = null;
    if (row.location_type === "text") {
      requireId(row.location_id, "CHAPTER_SOURCE_UNAVAILABLE");
      if (row.entity_id !== row.location_id || row.kind !== "location"
        || !["player", "hidden"].includes(row.visibility)) throw failure("CHAPTER_SOURCE_UNAVAILABLE");
      text(row.name, 512, "CHAPTER_SOURCE_UNAVAILABLE");
      if (row.visibility === "player") location = { id: row.location_id, name: row.name };
    }
    // Unlike narration, a starting snapshot may be R0 or a continuation's
    // system boundary; that boundary belongs to the child that created it.
    const nextBoundary = timeline.lineage.find((entry) => previousRevision < entry.boundaryRevision);
    return { source: { adventureId: nextBoundary?.parentAdventureId ?? timeline.adventureId,
      revision: previousRevision }, location };
  }

  function readChapterSource(options) {
    assertOpen();
    fields(options, ["chapterId", "attemptId"], ["cursor", "limit", "maxCharacters"]);
    const job = matchingJob(options.chapterId, options.attemptId);
    const timeline = chapterTimeline(job.to_revision);
    const system = new Set(timeline.systemRevisions);
    const limit = options.limit === undefined ? 20 : options.limit;
    const maxCharacters = options.maxCharacters === undefined ? CHAPTER_LIMITS.sourceDefaultCharacters : options.maxCharacters;
    requireInteger(limit, 1, 100);
    requireInteger(maxCharacters, 1, CHAPTER_LIMITS.sourceMaxCharacters);
    const base = { adventureId, chapterId: job.chapter_id, attemptId: job.attempt_id, fromRevision: job.from_revision, toRevision: job.to_revision };
    let next = job.from_revision;
    if (options.cursor !== undefined) {
      fields(options.cursor, [...Object.keys(base), "nextRevision"]);
      if (Object.keys(base).some((key) => options.cursor[key] !== base[key])) throw failure("CHAPTER_CURSOR_MISMATCH");
      requireInteger(options.cursor.nextRevision, job.from_revision, job.to_revision, "CHAPTER_CURSOR_MISMATCH");
      next = options.cursor.nextRevision;
    }
    const advance = (revision) => {
      while (revision <= job.to_revision && system.has(revision)) revision += 1;
      return revision;
    };
    next = advance(next);
    let page = { ...base, turns: [], nextCursor: null, complete: true };
    const rows = db.prepare(`SELECT t.revision,t.action_id,t.narration_json,a.request_json FROM turns t
      JOIN actions a ON a.action_id=t.action_id
      WHERE t.revision>=? AND t.revision<=? AND a.status='committed' AND a.revision=t.revision
      ORDER BY t.revision LIMIT ?`).iterate(next, job.to_revision, limit);
    for (const row of rows) {
      if (row.revision !== next) throw failure("CHAPTER_SOURCE_UNAVAILABLE");
      const turn = { revision: row.revision, actionId: row.action_id, input: JSON.parse(row.request_json).input,
        narration: JSON.parse(row.narration_json), source: mapSessionSource(timeline, row.revision),
        storyTurn: storyTurnAt(timeline, row.revision), turnStart: readTurnStart(row.revision, timeline) };
      const following = advance(row.revision + 1);
      const complete = following > job.to_revision;
      const candidate = { ...base, turns: [...page.turns, turn],
        nextCursor: complete ? null : { ...base, nextRevision: following }, complete };
      if (!fits(candidate, maxCharacters)) {
        if (page.turns.length === 0) throw failure("CHAPTER_SOURCE_TOO_LARGE");
        break;
      }
      page = candidate;
      next = following;
    }
    if (page.turns.length === 0 || (!page.complete && page.turns.length < limit && next <= job.to_revision
      && !db.prepare("SELECT 1 FROM turns t JOIN actions a ON a.action_id=t.action_id WHERE t.revision=? AND a.status='committed' AND a.revision=t.revision").get(next))) {
      throw failure("CHAPTER_SOURCE_UNAVAILABLE");
    }
    return page;
  }

  function readChapters(options = {}) {
    assertOpen();
    fields(options, [], ["revision", "cursor", "limit"]);
    const limit = options.limit === undefined ? 20 : options.limit;
    requireInteger(limit, 1, 100);
    const cursor = options.cursor;
    let target, through, after = 0;
    if (cursor === undefined || cursor === 0) {
      target = targetRevision(options.revision).target;
      through = db.prepare("SELECT max(to_revision) AS revision FROM chapters WHERE to_revision<=?").get(target).revision ?? 0;
    } else {
      fields(cursor, ["adventureId", "revision", "afterToRevision", "throughToRevision"]);
      if (cursor.adventureId !== adventureId || (options.revision !== undefined && options.revision !== cursor.revision)) throw failure("CHAPTER_CURSOR_MISMATCH");
      target = targetRevision(cursor.revision).target;
      requireInteger(cursor.throughToRevision, 1, target, "CHAPTER_CURSOR_MISMATCH");
      requireInteger(cursor.afterToRevision, 1, cursor.throughToRevision - 1, "CHAPTER_CURSOR_MISMATCH");
      through = cursor.throughToRevision;
      after = cursor.afterToRevision;
      if (!db.prepare("SELECT 1 FROM chapters WHERE to_revision=?").get(through)
        || !db.prepare("SELECT 1 FROM chapters WHERE to_revision=?").get(after)) throw failure("CHAPTER_CURSOR_MISMATCH");
    }
    const readTimeline = chapterTimeline(target);
    const timeline = projectSessionTimeline(readTimeline);
    let page = { adventureId, revision: target, timeline, chapters: [], nextCursor: null, complete: true };
    const rows = db.prepare("SELECT * FROM chapters WHERE to_revision>? AND to_revision<=? ORDER BY to_revision LIMIT ?").iterate(after, through, limit);
    for (const row of rows) {
      const complete = row.to_revision === through;
      const candidate = { adventureId, revision: target, timeline, chapters: [...page.chapters, publicChapter(row)],
        nextCursor: complete ? null : { adventureId, revision: target, afterToRevision: row.to_revision, throughToRevision: through }, complete };
      if (!fits(candidate, 2000000)) {
        if (page.chapters.length === 0) throw failure("CHAPTER_PAGE_TOO_LARGE");
        break;
      }
      page = candidate;
    }
    return page;
  }

  function interruptJob(chapterId) {
    db.prepare("UPDATE chapter_jobs SET status='interrupted',retryable=1,error_code='CHAPTER_INTERRUPTED',updated_at=? WHERE chapter_id=? AND status='running'")
      .run(new Date().toISOString(), chapterId);
  }

  // Called inside turn-store.close's transaction so all owned work closes at
  // the same boundary. Closing is an interruption, never a player cancellation.
  function interruptOwned() {
    assertOpen();
    for (const row of db.prepare("SELECT chapter_id FROM chapter_jobs WHERE owner_id=? AND status='running'").all(ownerId)) interruptJob(row.chapter_id);
  }

  return { api: { beginChapter, commitChapter, failChapter, readChapterJob, readChapterSource, readChapters }, interruptOwned };
}

function fits(value, maxCharacters) {
  const serialized = JSON.stringify(value);
  return serialized.length <= maxCharacters && Buffer.byteLength(serialized) <= CHAPTER_LIMITS.pageMaxBytes;
}

function fields(value, required, optional = [], code = "CHAPTER_INPUT_INVALID") {
  if (!value || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw failure(code);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.has(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw failure(code);
  }
  if (required.some((key) => !Object.hasOwn(value, key))) throw failure(code);
}

function cloneJson(value, code) {
  const seen = new Set();
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 20000 || depth > 16) throw failure(code);
    if (typeof item === "string" && item.length > CHAPTER_LIMITS.candidateCharacters) throw failure(code);
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || seen.has(item)) throw failure(code);
    seen.add(item);
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw failure(code);
    const result = array ? [] : Object.create(null);
    const keys = Reflect.ownKeys(item);
    if (array && (item.length > 4096 || keys.length !== item.length + 1)) throw failure(code);
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
        || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")
        || (array && !/^(0|[1-9][0-9]*)$/.test(key))) throw failure(code);
      result[key] = visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
    return result;
  }
  return visit(value, 0);
}

function text(value, maximum, code) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw failure(code);
}

function requireId(value, code = "CHAPTER_INPUT_INVALID") {
  if (typeof value !== "string" || !ID.test(value)) throw failure(code);
}

function requireInteger(value, min, max, code = "CHAPTER_INPUT_INVALID") {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw failure(code);
}

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

module.exports = { createChapterStore, CHAPTER_LIMITS, CHAPTER_FALLBACK_REASONS };
