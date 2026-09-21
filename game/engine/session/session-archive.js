"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { readContentSnapshot } = require("../content-v2/snapshot-reader");
const { projectPlayerState } = require("./turn-model");
const { projectSessionView, projectSessionHistory, projectSessionChapters, projectSessionPanel,
  resolveSessionMemoryFragmentSkill, projectMemoryFragmentModule } = require("./session-projection");
const { validateMemoryFragmentSources } = require("./session-memory-fragment-sources");
const { validateConditionSources } = require("./session-condition-sources");
const { createSkillLocaleResolver } = require("../content-v2/skill-locale-resolver");
const { readTerminalRecord, publicTerminal, validateTerminalSources, terminalArchiveMetadata } = require("./session-terminal-store");
const { readSessionTimeline, projectSessionTimeline, mapSessionSource } = require("./session-lineage");
const { readSessionHistoryPage } = require("./session-story-history");

const MAX_BYTES = 8 * 1024 * 1024 - 4096;
const MAX_CHARACTERS = 8000000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LEGACY = ["state.json", "meta.json", "save-schema.json", "summary.json", "lineage.json",
  "transcript", "audit", "memory", "chapters", "index", "modules", "finale"];
const SAFE = new Set(["SAVE_PATH_INVALID", "SAVE_IDENTITY_MISMATCH", "SAVE_FORMAT_UNSUPPORTED", "SAVE_ACCESS_DENIED",
  "ARCHIVE_NOT_CLOSED", "ARCHIVE_REVISION_MISMATCH", "ARCHIVE_RECOVERY_REQUIRED", "ARCHIVE_STATE_UNAVAILABLE",
  "ARCHIVE_INPUT_INVALID", "ARCHIVE_PAGE_TOO_LARGE", "STORE_BUSY", "HISTORY_CURSOR_MISMATCH", "HISTORY_PAGE_TOO_LARGE",
  "CHAPTER_CURSOR_MISMATCH", "CHAPTER_PAGE_TOO_LARGE", "SESSION_PROJECTION_INVALID", "SESSION_LOCALE_UNSUPPORTED",
  "SKILL_PANEL_NOT_SELECTED", "SKILL_PANEL_VIEW_INVALID", "SKILL_PANEL_FIELD_UNKNOWN", "SKILL_PANEL_CURSOR_INVALID", "SKILL_PANEL_ITEM_NOT_FOUND",
  "MEMORY_FRAGMENT_SOURCE_INVALID", "CHARACTER_CONDITION_SOURCE_INVALID", "SKILL_MODULE_NOT_SELECTED", "SKILL_MODULE_CURSOR_INVALID", "SKILL_MODULE_FIELD_UNKNOWN", "SKILL_MODULE_OPERATION_INVALID"]);

// Every request opens a read-only connection and one short read snapshot.
// This reader has no Provider, writable store, schema creation, or repair path.
function createSessionArchiveReader({ adventuresRoot } = {}) {
  if (typeof adventuresRoot !== "string" || !path.isAbsolute(adventuresRoot)) throw failure("SAVE_PATH_INVALID");

  async function withArchive(request, operation) {
    if (typeof request.adventureId !== "string" || !ID.test(request.adventureId)) throw failure("SAVE_PATH_INVALID");
    const adventureId = request.adventureId;
    const root = path.join(adventuresRoot, adventureId);
    let db;
    try {
      for (const directory of [adventuresRoot, root]) {
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure("SAVE_PATH_INVALID");
      }
      const names = new Set(await fs.readdir(root));
      if (LEGACY.some((name) => names.has(name))) throw failure("SAVE_FORMAT_UNSUPPORTED");
      for (const name of ["session.sqlite", "session.sqlite-journal", "session.sqlite-wal", "session.sqlite-shm"]) {
        if (!names.has(name)) continue;
        const stat = await fs.lstat(path.join(root, name));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw failure("SAVE_PATH_INVALID");
      }
      if (!names.has("session.sqlite")) throw failure("SAVE_FORMAT_UNSUPPORTED");
      const databasePath = path.join(root, "session.sqlite");
      const header = await prefix(databasePath, 100);
      if (header.length !== 100 || header.toString("ascii", 0, 16) !== "SQLite format 3\u0000"
        || header.readUInt32BE(68) !== 0x47435331 || header.readUInt32BE(60) !== 1
        || header[18] !== 1 || header[19] !== 1 || names.has("session.sqlite-wal") || names.has("session.sqlite-shm")) {
        throw failure("SAVE_FORMAT_UNSUPPORTED");
      }
      if (names.has("session.sqlite-journal")) {
        const journal = await prefix(`${databasePath}-journal`, 28);
        if (journal.subarray(0, 8).equals(Buffer.from("d9d505f920a163d7", "hex"))) throw failure("ARCHIVE_RECOVERY_REQUIRED");
      }
      const snapshot = await readContentSnapshot({ adventuresRoot, adventureId });
      if (snapshot.profile.adventureId !== adventureId) throw failure("SAVE_IDENTITY_MISMATCH");
      const resolved = await createSkillLocaleResolver({ snapshotLoader: async () => snapshot }).resolveCurrent({ adventureId });
      const discovered = resolved.skills.find((skill) => skill.packId === "grey-crow-default"
        && skill.itemId === "extreme-ending-easter" && skill.panel?.visibility === "hidden_until_active");
      const discoverySkill = discovered ? { packId: discovered.packId, moduleRef: discovered.panel.moduleRef, title: discovered.title } : undefined;
      db = new DatabaseSync(databasePath, { readOnly: true });
      db.exec("BEGIN");
      const row = db.prepare(`SELECT s.*,t.action_id,t.state_json,t.narration_json,a.updated_at
        FROM session s JOIN turns t ON t.revision=s.revision
        LEFT JOIN actions a ON a.action_id=t.action_id WHERE s.singleton=1`).get();
      if (row?.format !== "grey-crow-session-1") throw failure("SAVE_FORMAT_UNSUPPORTED");
      if (row.adventure_id !== adventureId || row.locale !== snapshot.profile.language
        || row.content_version !== snapshot.lock.overallHash) throw failure("SAVE_IDENTITY_MISMATCH");
      if (request.revision !== undefined && request.revision !== row.revision) throw failure("ARCHIVE_REVISION_MISMATCH");
      const state = JSON.parse(row.state_json);
      const timeline = readSessionTimeline(db, { adventureId, revision: row.revision });
      validateMemoryFragmentSources(db, state, timeline);
      validateConditionSources(db, state, timeline);
      const memoryFragmentSkill = resolveSessionMemoryFragmentSkill(snapshot, request.displayLocale || snapshot.profile.language);
      const finale = readClosedFinale(db, row, state);
      const raw = { adventureId, revision: row.revision, actionId: row.action_id, locale: row.locale,
        contentVersion: row.content_version, state: projectPlayerState(state), finale,
        timeline: projectSessionTimeline(timeline), continuation: timeline.continuation,
        narration: [], history: [], historyComplete: false,
        historyNextBeforeRevision: { adventureId, revision: row.revision, beforeRevision: row.revision + 1 } };
      const result = operation({ db, row, raw, snapshot, discoverySkill, memoryFragmentSkill, timeline });
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (SAFE.has(error?.code)) throw failure(error.code);
      if (["EACCES", "EPERM"].includes(error?.code)) throw failure("SAVE_ACCESS_DENIED");
      if ((error?.errcode & 0xff) === 8) throw failure("ARCHIVE_RECOVERY_REQUIRED");
      if ([5, 6].includes(error?.errcode & 0xff)) throw failure("STORE_BUSY");
      throw failure("ARCHIVE_STATE_UNAVAILABLE");
    } finally {
      if (db) { try { db.exec("ROLLBACK"); } catch {} db.close(); }
    }
  }

  async function open(request) {
    fields(request, ["adventureId"], ["displayLocale", "limit", "maxCharacters"]);
    return withArchive(request, ({ db, row, raw, snapshot, discoverySkill, memoryFragmentSkill, timeline }) => {
      const page = historyPage(db, raw, request, timeline);
      raw.narration = JSON.parse(row.narration_json);
      raw.history = page.history;
      raw.historyComplete = page.complete;
      raw.historyNextBeforeRevision = page.nextBeforeRevision;
      const projection = projectSessionView(raw, { delivery: "recovery", displayLocale: request.displayLocale,
        memoryFragmentSkill,
        createdAt: snapshot.profile.createdAt, updatedAt: row.updated_at || snapshot.profile.createdAt,
        ...(discoverySkill ? { discoverySkill } : {}) });
      const chapterPage = boundedProjection((limit) => projectSessionChapters(chaptersPage(db, raw, { limit }, timeline)), 12,
        "chapters", "CHAPTER_PAGE_TOO_LARGE");
      const result = { projection, chapterPage, archive: { mode: "archive", read_only: true }, storyFinale: projection.storyFinale,
        modules: memoryFragmentSkill ? [projectMemoryFragmentModule(raw, { memoryFragmentSkill,
          displayLocale: request.displayLocale || snapshot.profile.language }).module] : [],
        lockedContent: lockedContent(snapshot), readOnlyRoot: path.resolve(adventuresRoot), timeline: raw.timeline };
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) throw failure("ARCHIVE_PAGE_TOO_LARGE");
      return result;
    });
  }

  async function readHistory(request) {
    fields(request, ["adventureId", "revision"], ["beforeRevision", "limit", "maxCharacters"]);
    requireRevision(request.revision);
    return withArchive(request, ({ db, raw, timeline }) => boundedProjection((limit) => projectSessionHistory(historyPage(db, raw, { ...request, limit }, timeline)),
      request.limit ?? 20, "history", "HISTORY_PAGE_TOO_LARGE"));
  }

  async function readChapters(request) {
    fields(request, ["adventureId", "revision"], ["cursor", "limit"]);
    requireRevision(request.revision);
    return withArchive(request, ({ db, raw, timeline }) => boundedProjection((limit) => projectSessionChapters(chaptersPage(db, raw, { ...request, limit }, timeline)),
      request.limit ?? 20, "chapters", "CHAPTER_PAGE_TOO_LARGE"));
  }

  async function readPanel(request) {
    const panelFields = ["panelRef", "view", "fieldId", "itemRef", "cursor", "limit", "displayLocale"];
    fields(request, ["adventureId", "revision", "panelRef"], panelFields.filter((key) => key !== "panelRef"));
    requireRevision(request.revision);
    return withArchive(request, ({ raw, discoverySkill, memoryFragmentSkill }) => projectSessionPanel(raw,
      { ...Object.fromEntries(panelFields.filter((key) => request[key] !== undefined).map((key) => [key, request[key]])),
        memoryFragmentSkill, ...(discoverySkill ? { discoverySkill } : {}) }));
  }

  async function readModule(request) {
    fields(request, ["adventureId", "revision", "moduleRef"], ["fieldId", "cursor", "limit", "displayLocale"]);
    requireRevision(request.revision);
    return withArchive(request, ({ raw, memoryFragmentSkill, snapshot }) => {
      if (!memoryFragmentSkill || request.moduleRef !== memoryFragmentSkill.moduleRef) throw failure("SKILL_MODULE_NOT_SELECTED");
      return projectMemoryFragmentModule(raw, { memoryFragmentSkill, displayLocale: request.displayLocale || snapshot.profile.language,
        ...Object.fromEntries(["fieldId", "cursor", "limit"].filter((key) => request[key] !== undefined).map((key) => [key, request[key]])) });
    });
  }

  return Object.freeze({ open, readHistory, readChapters, readPanel, readModule });
}

function readClosedFinale(db, row, state) {
  if (state.finale?.phase !== "confirmed") throw failure("ARCHIVE_NOT_CLOSED");
  const confirmation = state.finale.confirmation;
  if (confirmation?.revision !== row.revision || confirmation.candidateId !== state.finale.candidate?.candidateId) throw failure("ARCHIVE_STATE_UNAVAILABLE");
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('finale_archives','chapters','chapter_jobs')").all();
  if (names.length !== 3) throw failure("ARCHIVE_NOT_CLOSED");
  const archive = db.prepare("SELECT * FROM finale_archives WHERE singleton=1").get();
  if (!archive || archive.status !== "closed") throw failure("ARCHIVE_NOT_CLOSED");
  if (archive.finale_id !== `finale-${row.revision}` || archive.candidate_id !== confirmation.candidateId
    || archive.confirmation_revision !== row.revision || archive.confirmation_action_id !== row.action_id
    || typeof archive.closed_at !== "string" || !Number.isFinite(Date.parse(archive.closed_at))) throw failure("ARCHIVE_STATE_UNAVAILABLE");
  const job = db.prepare(`SELECT j.*,c.from_revision AS chapter_from,c.to_revision AS chapter_to FROM chapter_jobs j
    JOIN chapters c ON c.chapter_id=j.chapter_id WHERE j.chapter_id=?`).get(archive.chapter_id);
  if (!job || job.status !== "committed" || job.chapter_id !== `chapter-${row.revision}`
    || job.to_revision !== row.revision || job.chapter_to !== row.revision || job.from_revision !== job.chapter_from
    || job.from_revision > row.revision) throw failure("ARCHIVE_STATE_UNAVAILABLE");
  const action = db.prepare("SELECT status,revision FROM actions WHERE action_id=?").get(row.action_id);
  const narration = new Set(JSON.parse(row.narration_json).map((segment) => segment.id));
  if (action?.status !== "committed" || action.revision !== row.revision
    || !Array.isArray(confirmation.sourceSegmentIds) || !confirmation.sourceSegmentIds.length
    || confirmation.sourceSegmentIds.some((id) => !narration.has(id))) throw failure("ARCHIVE_STATE_UNAVAILABLE");
  {
    const proposal = db.prepare("SELECT narration_json FROM turns WHERE revision=?").get(confirmation.proposalRevision);
    const proposedSegments = new Set(proposal ? JSON.parse(proposal.narration_json).map((segment) => segment.id) : []);
    if (!Array.isArray(confirmation.proposalSegmentIds) || !confirmation.proposalSegmentIds.length
      || confirmation.proposalSegmentIds.some((id) => !proposedSegments.has(id))) throw failure("ARCHIVE_STATE_UNAVAILABLE");
  }
  const terminal = readTerminalRecord(db);
  if (terminal || state.finale.candidate?.kind === "extreme") validateTerminalSources(db, terminal,
    { state, revision: row.revision, actionId: row.action_id });
  return { adventureId: row.adventure_id, revision: row.revision, decision: state.finale,
    ...(terminal ? { terminal: publicTerminal(terminal, row.revision) } : {}),
    archive: { finaleId: archive.finale_id, candidateId: archive.candidate_id, confirmationRevision: row.revision,
      confirmationActionId: row.action_id, status: "closed", chapterId: archive.chapter_id, closedAt: archive.closed_at,
      ...terminalArchiveMetadata(state) },
    chapterJob: { adventureId: row.adventure_id, chapterId: job.chapter_id, attemptId: job.attempt_id,
      status: "committed", fromRevision: job.from_revision, toRevision: job.to_revision } };
}

function historyPage(db, raw, options, timeline) {
  const { adventureId, revision } = raw;
  try { return readSessionHistoryPage(db, { ...options, adventureId, revision }, timeline); }
  catch (error) { if (error.code === "ACTION_INPUT_INVALID") throw failure("ARCHIVE_INPUT_INVALID"); throw error; }
}

function chaptersPage(db, raw, options, timeline) {
  const { adventureId, revision } = raw;
  const limit = options.limit === undefined ? 20 : options.limit;
  integer(limit, 1, 100);
  let after = 0;
  let through = revision;
  if (options.cursor !== undefined && options.cursor !== 0) {
    const cursor = options.cursor;
    fields(cursor, ["adventureId", "revision", "afterToRevision", "throughToRevision"]);
    if (cursor.adventureId !== adventureId || cursor.revision !== revision
      || !Number.isSafeInteger(cursor.throughToRevision) || cursor.throughToRevision < 1 || cursor.throughToRevision > revision
      || !Number.isSafeInteger(cursor.afterToRevision) || cursor.afterToRevision < 1 || cursor.afterToRevision >= cursor.throughToRevision
      || !db.prepare("SELECT 1 FROM chapters WHERE to_revision=?").get(cursor.afterToRevision)
      || !db.prepare("SELECT 1 FROM chapters WHERE to_revision=?").get(cursor.throughToRevision)) throw failure("CHAPTER_CURSOR_MISMATCH");
    after = cursor.afterToRevision; through = cursor.throughToRevision;
  }
  let page = { adventureId, revision, timeline: raw.timeline, chapters: [], nextCursor: null, complete: true };
  for (const row of db.prepare("SELECT * FROM chapters WHERE to_revision>? AND to_revision<=? ORDER BY to_revision LIMIT ?").iterate(after, through, limit)) {
    const chapter = { chapterId: row.chapter_id, fromRevision: row.from_revision, toRevision: row.to_revision,
      createdAt: row.created_at, ...JSON.parse(row.body_json) };
    if (timeline.lineage.length) {
      chapter.source = mapSessionSource(timeline, row.to_revision);
      for (const kind of ["keyEvents", "openThreads"]) {
        for (const item of chapter[kind]) item.sources = item.sources.map((source) => ({ ...source,
          source: mapSessionSource(timeline, source.revision) }));
      }
    }
    const complete = row.to_revision === through;
    const candidate = { adventureId, revision, timeline: raw.timeline, chapters: [...page.chapters, chapter], complete,
      nextCursor: complete ? null : { adventureId, revision, afterToRevision: row.to_revision, throughToRevision: through } };
    if (!fits(candidate, 200000)) { if (!page.chapters.length) throw failure("CHAPTER_PAGE_TOO_LARGE"); break; }
    page = candidate;
  }
  return page;
}

function fields(value, required, optional = []) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw failure("ARCHIVE_INPUT_INVALID");
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key))) throw failure("ARCHIVE_INPUT_INVALID");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.has(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw failure("ARCHIVE_INPUT_INVALID");
  }
}
function boundedProjection(readPage, limit, key, code) {
  const initial = readPage(limit);
  if (Buffer.byteLength(JSON.stringify(initial)) <= MAX_BYTES) return initial;
  // Projection adds identity and speech-deduplication metadata. Bound the
  // actual result, and recalculate its cursor at a smaller whole-record page.
  let low = 1;
  let high = initial[key].length - 1;
  let best;
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const page = readPage(count);
    if (Buffer.byteLength(JSON.stringify(page)) <= MAX_BYTES) { best = page; low = count + 1; }
    else high = count - 1;
  }
  if (!best) throw failure(code);
  return best;
}
function lockedContent(snapshot) {
  const item = (ref, body) => {
    const title = typeof ref.title === "string" && ref.title.trim() ? ref.title
      : /^#\s+(.+)$/m.exec(body || "")?.[1]?.trim();
    if (!title) throw failure("ARCHIVE_STATE_UNAVAILABLE");
    return { ...Object.fromEntries(["packId", "packVersion", "itemId", "itemType", "skillClass", "language"]
      .filter((key) => ref[key] !== undefined).map((key) => [key, ref[key]])), title, implementation: "narrative_reference" };
  };
  return { integrityStatus: "locked", language: snapshot.profile.language, contentProfileId: snapshot.profile.profileId,
    snapshotLockId: snapshot.lock.lockId, overallHash: snapshot.lock.overallHash,
    host: item(snapshot.profile.host, snapshot.content.host), world: item(snapshot.profile.world, snapshot.content.world), skills: [] };
}
function requireRevision(value) { integer(value, 1, Number.MAX_SAFE_INTEGER); }
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) throw failure("ARCHIVE_INPUT_INVALID"); }
function fits(value, maximum) { const json = JSON.stringify(value); return json.length <= maximum && Buffer.byteLength(json) <= MAX_BYTES; }
async function prefix(file, count) {
  const handle = await fs.open(file, "r");
  try { const buffer = Buffer.alloc(count); const { bytesRead } = await handle.read(buffer, 0, count, 0); return buffer.subarray(0, bytesRead); }
  finally { await handle.close(); }
}
function failure(code) { return Object.assign(new Error(code), { code }); }

module.exports = { createSessionArchiveReader };
