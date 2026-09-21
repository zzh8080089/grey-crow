"use strict";

const { mapSessionSource, projectSessionTimeline, storyTurnAt } = require("./session-lineage");

const MAX_BYTES = 8 * 1024 * 1024 - 4096;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function fields(value, keys) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || keys.some((key) => !Object.hasOwn(value, key))) fail("ACTION_INPUT_INVALID");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!keys.includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("ACTION_INPUT_INVALID");
  }
}

// Both live play and offline archives use this one chronological boundary.
// Continuation boundaries remain system revisions and never become player turns.
function readSessionHistoryPage(db, options, timeline) {
  const { adventureId, revision } = options;
  const limit = options.limit === undefined ? 20 : options.limit;
  const maxCharacters = options.maxCharacters === undefined ? 200_000 : options.maxCharacters;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 8_000_000
    || timeline.adventureId !== adventureId || timeline.revision !== revision) fail("ACTION_INPUT_INVALID");
  const metadata = projectSessionTimeline(timeline);
  const fits = (value) => {
    const serialized = JSON.stringify(value);
    return serialized.length <= maxCharacters && Buffer.byteLength(serialized) <= MAX_BYTES;
  };
  let before = revision + 1;
  if (options.beforeRevision !== undefined) {
    const cursor = options.beforeRevision;
    fields(cursor, ["adventureId", "revision", "beforeRevision"]);
    if (cursor.adventureId !== adventureId || cursor.revision !== revision
      || !Number.isSafeInteger(cursor.beforeRevision) || cursor.beforeRevision < 1
      || cursor.beforeRevision > revision + 1) fail("HISTORY_CURSOR_MISMATCH");
    before = cursor.beforeRevision;
  }
  let page = { adventureId, revision, timeline: metadata, history: [], nextBeforeRevision: null, complete: true };
  if (!fits(page)) fail("HISTORY_PAGE_TOO_LARGE");
  {
    const descending = [];
    const rows = db.prepare(`SELECT t.revision,t.action_id,t.narration_json,a.request_json,
      EXISTS(SELECT 1 FROM turns older JOIN actions oa ON oa.action_id=older.action_id
        WHERE older.revision<t.revision AND oa.status='committed' AND oa.revision=older.revision) AS has_older
      FROM turns t JOIN actions a ON a.action_id=t.action_id
      WHERE t.revision<? AND a.status='committed' AND a.revision=t.revision ORDER BY t.revision DESC LIMIT ?`).iterate(before, limit);
    for (const row of rows) {
      const item = { revision: row.revision, actionId: row.action_id,
        input: JSON.parse(row.request_json).input, narration: JSON.parse(row.narration_json),
        source: mapSessionSource(timeline, row.revision), storyTurn: storyTurnAt(timeline, row.revision) };
      const cursor = row.has_older ? { adventureId, revision, beforeRevision: row.revision } : null;
      const candidate = { adventureId, revision, timeline: metadata, history: [...descending, item].reverse(),
        nextBeforeRevision: cursor, complete: cursor === null };
      if (!fits(candidate)) { if (!descending.length) fail("HISTORY_PAGE_TOO_LARGE"); break; }
      descending.push(item); page = candidate;
    }
    return page;
  }
}

module.exports = { readSessionHistoryPage };
