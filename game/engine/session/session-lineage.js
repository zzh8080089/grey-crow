"use strict";

const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { validateInitialState } = require("./turn-model");

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const ADVENTURE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const EMPTY_FINALE = { phase: "idle", candidate: null, lastDeclined: null, confirmation: null };

function fail(code = "SESSION_LINEAGE_INVALID") { throw Object.assign(new Error(code), { code }); }
function fields(value, required, optional = []) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("SESSION_LINEAGE_INPUT_INVALID");
  if (required.some((key) => !Object.hasOwn(value, key))) fail("SESSION_LINEAGE_INPUT_INVALID");
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (![...required, ...optional].includes(key) || !property?.enumerable || !Object.hasOwn(property, "value")) fail("SESSION_LINEAGE_INPUT_INVALID");
  }
}
function id(value, pattern = ID) { return typeof value === "string" && pattern.test(value) && !["__proto__", "prototype", "constructor"].includes(value); }
function integer(value, minimum = 0) { return Number.isSafeInteger(value) && value >= minimum; }
function date(value) { return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)); }
function title(value) { return typeof value === "string" && value.trim().length > 0 && value.length <= 200; }
function exists(db) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_lineage'").get()); }
function parse(value) { try { return JSON.parse(value); } catch { fail(); } }
function state(value) { try { return validateInitialState(parse(value)); } catch { fail(); } }
function metadata(row) {
  return { requestId: row.request_id, lineageId: row.lineage_id, parentAdventureId: row.parent_adventure_id,
    childAdventureId: row.child_adventure_id, parentRevision: row.parent_revision, boundaryRevision: row.boundary_revision,
    sourceFinaleId: row.source_finale_id, createdAt: row.created_at, ...(row.title === null ? {} : { title: row.title }) };
}
function boundaryEvent(value) {
  return { id: "continuation-start", type: "continuation.start", sourceSegmentIds: [], data: {
    lineageId: value.lineageId, parentAdventureId: value.parentAdventureId, childAdventureId: value.childAdventureId,
    parentRevision: value.parentRevision, sourceFinaleId: value.sourceFinaleId,
  } };
}
function archiveFromRow(row) {
  return row && { finaleId: row.finale_id, candidateId: row.candidate_id,
    confirmationRevision: row.confirmation_revision, confirmationActionId: row.confirmation_action_id,
    status: row.status, chapterId: row.chapter_id, closedAt: row.closed_at };
}

// Only archive metadata moves out of the singleton. Its canonical decision and
// every original passage stay in the unchanged inherited turn rows.
function inheritedFinale(db, adventureId, revision, archive) {
  const turn = db.prepare("SELECT action_id,state_json,narration_json FROM turns WHERE revision=?").get(revision);
  if (!turn || !archive || archive.status !== "closed") fail();
  const canonical = state(turn.state_json);
  const decision = canonical.finale;
  const confirmation = decision?.confirmation;
  if (decision?.phase !== "confirmed" || decision.candidate?.kind === "extreme"
    || confirmation.revision !== revision || archive.finaleId !== `finale-${revision}`
    || archive.candidateId !== confirmation.candidateId || archive.confirmationRevision !== revision
    || archive.confirmationActionId !== turn.action_id || !id(archive.chapterId) || !date(archive.closedAt)
    || Object.keys(archive).some((key) => !["finaleId", "candidateId", "confirmationRevision", "confirmationActionId", "status", "chapterId", "closedAt"].includes(key))) fail();
  const action = db.prepare("SELECT status,revision FROM actions WHERE action_id=?").get(turn.action_id);
  const job = db.prepare(`SELECT j.*,c.from_revision AS chapter_from,c.to_revision AS chapter_to
    FROM chapter_jobs j JOIN chapters c ON c.chapter_id=j.chapter_id WHERE j.chapter_id=?`).get(archive.chapterId);
  if (action?.status !== "committed" || action.revision !== revision || !job || job.status !== "committed"
    || job.to_revision !== revision || job.chapter_to !== revision || job.from_revision !== job.chapter_from
    || job.from_revision > revision || job.chapter_id !== `chapter-${revision}`) fail();
  for (const origin of [{ revision, ids: confirmation.sourceSegmentIds },
    { revision: confirmation.proposalRevision, ids: confirmation.proposalSegmentIds }]) {
    const source = db.prepare("SELECT narration_json,action_id FROM turns WHERE revision=?").get(origin.revision);
    const narration = source ? parse(source.narration_json) : [];
    if (!Array.isArray(narration) || narration.some((segment) => !segment || !id(segment.id))) fail();
    const segments = new Set(narration.map((segment) => segment.id));
    if (!source?.action_id || !Array.isArray(origin.ids) || !origin.ids.length || origin.ids.some((key) => !segments.has(key))) fail();
  }
  return { adventureId, revision, decision, archive: structuredClone(archive), chapterJob: {
    adventureId, chapterId: job.chapter_id, attemptId: job.attempt_id, status: job.status,
    fromRevision: job.from_revision, toRevision: job.to_revision,
  } };
}

function checkedRows(db, session) {
  const rows = exists(db) ? db.prepare("SELECT * FROM session_lineage ORDER BY boundary_revision").all() : [];
  let preceding;
  const identities = new Set();
  for (const row of rows) {
    const value = metadata(row);
    if (!id(value.requestId) || !id(value.lineageId) || !id(value.parentAdventureId, ADVENTURE_ID)
      || !id(value.childAdventureId, ADVENTURE_ID) || value.parentAdventureId === value.childAdventureId
      || !integer(value.parentRevision, 1) || value.boundaryRevision !== value.parentRevision + 1
      || value.boundaryRevision > session.revision || !id(value.sourceFinaleId)
      || !date(value.createdAt) || (value.title !== undefined && !title(value.title))
      || row.content_version !== session.content_version || identities.has(value.childAdventureId)
      || (preceding && (value.parentAdventureId !== preceding.childAdventureId || value.parentRevision < preceding.boundaryRevision))) fail();
    if (!preceding) identities.add(value.parentAdventureId);
    identities.add(value.childAdventureId);
    const boundary = db.prepare("SELECT action_id,narration_json,events_json,state_json FROM turns WHERE revision=?").get(value.boundaryRevision);
    const parent = db.prepare("SELECT state_json FROM turns WHERE revision=?").get(value.parentRevision);
    if (!boundary || boundary.action_id !== null || !parent || !isDeepStrictEqual(parse(boundary.narration_json), [])
      || !isDeepStrictEqual(parse(boundary.events_json), [boundaryEvent(value)])) fail();
    const expected = state(parent.state_json);
    const archive = parse(row.parent_archive_json);
    if (value.sourceFinaleId !== archive.finaleId || value.sourceFinaleId !== `finale-${value.parentRevision}`) fail();
    inheritedFinale(db, session.adventure_id, value.parentRevision, archive);
    expected.finale = structuredClone(EMPTY_FINALE);
    if (!isDeepStrictEqual(state(boundary.state_json), expected)) fail();
    preceding = value;
  }
  if (preceding && preceding.childAdventureId !== session.adventure_id) fail();
  return rows;
}

function readSessionTimeline(db, options) {
  fields(options, ["adventureId", "revision"]);
  if (!id(options.adventureId) || !integer(options.revision)) fail("SESSION_LINEAGE_INPUT_INVALID");
  const session = db.prepare("SELECT * FROM session WHERE singleton=1").get();
  if (!session || session.format !== "grey-crow-session-1" || session.adventure_id !== options.adventureId
    || !integer(session.revision) || options.revision > session.revision) fail();
  // Import-era development files are not native sessions. Inspect only the
  // format marker, never read their original records or silently drop them.
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_import'").get()) fail("SAVE_FORMAT_UNSUPPORTED");
  const rows = checkedRows(db, session);
  // A missing revision is corruption. Only exact lineage-backed NULL-action
  // rows explain a non-player revision; arbitrary empty turns are never skipped.
  const totals = db.prepare("SELECT count(*) AS n,min(revision) AS first,max(revision) AS last FROM turns").get();
  if (totals.n !== session.revision + 1 || totals.first !== 0 || totals.last !== session.revision) fail();
  const root = db.prepare("SELECT action_id,narration_json,events_json FROM turns WHERE revision=0").get();
  if (root.action_id !== null || !isDeepStrictEqual(parse(root.narration_json), []) || !isDeepStrictEqual(parse(root.events_json), [])) fail();
  const systems = db.prepare("SELECT revision FROM turns WHERE revision>0 AND action_id IS NULL ORDER BY revision").all().map((row) => row.revision);
  if (!isDeepStrictEqual(systems, rows.map((row) => row.boundary_revision))) fail();
  const invalid = db.prepare(`SELECT 1 FROM turns t LEFT JOIN actions a ON a.action_id=t.action_id
    WHERE t.revision>0 AND t.action_id IS NOT NULL AND (a.action_id IS NULL OR a.status!='committed' OR a.revision IS NULL OR a.revision!=t.revision) LIMIT 1`).get();
  if (invalid) fail();
  const systemRevisions = systems.filter((revision) => revision <= options.revision);
  const lineage = rows.map((row) => ({ ...metadata(row), contentVersion: row.content_version }));
  // This is the continuation known at the requested historical revision. In a
  // grandchild copy its child identity can be an ancestor of the current DB;
  // outer adventureId still binds every read to this local copied database.
  const current = rows.filter((row) => row.boundary_revision <= options.revision).at(-1);
  return { adventureId: options.adventureId, revision: options.revision,
    storyTurnCount: options.revision - systemRevisions.length, systemRevisions,
    lineage, continuation: current ? metadata(current) : null };
}

function projectSessionTimeline(value) {
  return { storyTurnCount: value.storyTurnCount, systemRevisions: [...value.systemRevisions] };
}

function storyTurnAt(value, revision) {
  return revision
    - value.systemRevisions.filter((boundary) => boundary <= revision).length;
}

function mapSessionSource(timeline, revision) {
  if (!integer(revision, 1) || revision > timeline.revision || timeline.systemRevisions.includes(revision)) fail();
  const nextBoundary = timeline.lineage.find((entry) => revision < entry.boundaryRevision);
  return { adventureId: nextBoundary?.parentAdventureId ?? timeline.adventureId, revision };
}

function readLineageFinale(db, options) {
  const timeline = readSessionTimeline(db, options);
  const inherited = timeline.lineage.find((entry) => entry.parentRevision === options.revision);
  if (!inherited) return null;
  const row = db.prepare("SELECT parent_archive_json FROM session_lineage WHERE boundary_revision=?").get(inherited.boundaryRevision);
  return inheritedFinale(db, options.adventureId, options.revision, parse(row.parent_archive_json));
}

// Private fork-service operation. Call only on the service's complete staging
// copy, never through model tools or the session RPC API. Parent files are not
// opened here. This transaction changes the copied identity and appends one
// non-player boundary while preserving all inherited committed rows.
function appendContinuationBoundary(db, options) {
  fields(options, ["parentAdventureId", "childAdventureId", "parentRevision", "sourceFinaleId", "requestId", "createdAt"], ["title"]);
  if (!id(options.parentAdventureId, ADVENTURE_ID) || !id(options.childAdventureId, ADVENTURE_ID)
    || options.parentAdventureId === options.childAdventureId || !integer(options.parentRevision, 1)
    || options.parentRevision >= Number.MAX_SAFE_INTEGER || !id(options.sourceFinaleId)
    || !id(options.requestId) || !date(options.createdAt) || (options.title !== undefined && !title(options.title))) fail("SESSION_LINEAGE_INPUT_INVALID");
  db.exec("BEGIN IMMEDIATE");
  try {
    const session = db.prepare("SELECT * FROM session WHERE singleton=1").get();
    if (exists(db)) {
      const existing = db.prepare("SELECT * FROM session_lineage WHERE request_id=?").get(options.requestId);
      if (existing) {
        const value = metadata(existing);
        if (session.adventure_id !== options.childAdventureId || ["parentAdventureId", "childAdventureId", "parentRevision", "sourceFinaleId"].some((key) => value[key] !== options[key])
          || (options.title !== undefined && options.title !== value.title)) fail("SESSION_LINEAGE_INPUT_INVALID");
        const result = readSessionTimeline(db, { adventureId: session.adventure_id, revision: session.revision });
        db.exec("COMMIT"); return result;
      }
    }
    if (session?.adventure_id !== options.parentAdventureId || session.revision !== options.parentRevision) fail("ADVENTURE_CONTINUATION_PARENT_INVALID");
    const priorTimeline = readSessionTimeline(db, { adventureId: session.adventure_id, revision: session.revision });
    if (priorTimeline.lineage.some((row) => row.parentAdventureId === options.childAdventureId || row.childAdventureId === options.childAdventureId)) fail("SESSION_LINEAGE_INPUT_INVALID");
    const previous = state(db.prepare("SELECT state_json FROM turns WHERE revision=?").get(session.revision).state_json);
    if (previous.finale?.candidate?.kind === "extreme") fail("ADVENTURE_CONTINUATION_FORBIDDEN");
    if (previous.finale?.phase !== "confirmed") fail("ADVENTURE_CONTINUATION_PARENT_NOT_CLOSED");
    const archive = archiveFromRow(db.prepare("SELECT * FROM finale_archives WHERE singleton=1").get());
    if (archive?.status !== "closed") fail("ADVENTURE_CONTINUATION_PARENT_NOT_CLOSED");
    if (archive.finaleId !== options.sourceFinaleId) fail("ADVENTURE_CONTINUATION_PARENT_INVALID");
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='terminal_reservations'").get()
      && db.prepare("SELECT 1 FROM terminal_reservations LIMIT 1").get()) fail("ADVENTURE_CONTINUATION_FORBIDDEN");
    inheritedFinale(db, session.adventure_id, session.revision, archive);
    if (db.prepare("SELECT 1 FROM actions WHERE status='running'").get() || db.prepare("SELECT 1 FROM chapter_jobs WHERE status='running'").get()) fail("ADVENTURE_CONTINUATION_PARENT_INVALID");
    const value = { requestId: options.requestId, lineageId: `lineage-${randomUUID()}`,
      parentAdventureId: options.parentAdventureId, childAdventureId: options.childAdventureId,
      parentRevision: options.parentRevision, boundaryRevision: options.parentRevision + 1,
      sourceFinaleId: options.sourceFinaleId, createdAt: options.createdAt, ...(options.title === undefined ? {} : { title: options.title }) };
    db.exec(`CREATE TABLE IF NOT EXISTS session_lineage (
      boundary_revision INTEGER PRIMARY KEY REFERENCES turns(revision), request_id TEXT NOT NULL UNIQUE, lineage_id TEXT NOT NULL UNIQUE,
      parent_adventure_id TEXT NOT NULL, child_adventure_id TEXT NOT NULL UNIQUE, parent_revision INTEGER NOT NULL UNIQUE REFERENCES turns(revision),
      source_finale_id TEXT NOT NULL, content_version TEXT NOT NULL, created_at TEXT NOT NULL, title TEXT,
      parent_archive_json TEXT NOT NULL
    );`);
    previous.finale = structuredClone(EMPTY_FINALE);
    const next = validateInitialState(previous);
    db.prepare("INSERT INTO turns VALUES (?,NULL,'[]',?,?)").run(value.boundaryRevision, JSON.stringify([boundaryEvent(value)]), JSON.stringify(next));
    db.prepare("INSERT INTO session_lineage VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(value.boundaryRevision, value.requestId, value.lineageId,
      value.parentAdventureId, value.childAdventureId, value.parentRevision, value.sourceFinaleId, session.content_version, value.createdAt, value.title ?? null, JSON.stringify(archive));
    db.prepare("UPDATE session SET adventure_id=?,revision=? WHERE singleton=1").run(value.childAdventureId, value.boundaryRevision);
    db.prepare("DELETE FROM finale_archives").run();
    const result = readSessionTimeline(db, { adventureId: value.childAdventureId, revision: value.boundaryRevision });
    db.exec("COMMIT");
    return result;
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
}

module.exports = { readSessionTimeline, projectSessionTimeline, storyTurnAt, mapSessionSource, readLineageFinale, appendContinuationBoundary };
