"use strict";

const { mapSessionSource } = require("./session-lineage");

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function integer(value, minimum = 0) { return Number.isSafeInteger(value) && value >= minimum; }
function parse(value) { try { return JSON.parse(value); } catch { fail("MEMORY_SOURCE_UNAVAILABLE"); } }
function ids(value) { return Array.isArray(value) && value.every(id => typeof id === "string" && ID.test(id)); }
function optionsFields(options) {
  if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail("ACTION_INPUT_INVALID");
  for (const key of Reflect.ownKeys(options)) {
    const property = Object.getOwnPropertyDescriptor(options, key);
    if (!["revision", "viewerId", "cursor", "limit", "beforeRevision", "afterRevision"].includes(key)
      || !property?.enumerable || !Object.hasOwn(property, "value")) fail("ACTION_INPUT_INVALID");
  }
}

// A second source channel for already-delivered prose, not a new fact index.
// Fully indexed turns never consume this channel's candidate allowance. Mixed
// turns retain their original knowledge boundary, including the player input.
function createStorySourceReader({ db, adventureId, locale, contentVersion, snapshot, timelineAt }) {
  function listUnindexedStoryRecords(options = {}) {
    optionsFields(options);
    const { revision, viewerId, cursor = 0, limit = 32, beforeRevision, afterRevision } = options;
    if ((revision !== undefined && !integer(revision)) || !integer(cursor) || !integer(limit, 1) || limit > 512
      || (beforeRevision !== undefined && !integer(beforeRevision, 1))
      || (afterRevision !== undefined && !integer(afterRevision))
      || (beforeRevision !== undefined && afterRevision !== undefined && afterRevision >= beforeRevision)) fail("ACTION_INPUT_INVALID");
    const fixed = snapshot(revision);
    const target = fixed.revision;
    if (!integer(target) || cursor > target || (beforeRevision !== undefined && beforeRevision > target)
      || (afterRevision !== undefined && afterRevision > target)) fail("ACTION_INPUT_INVALID");
    const state = parse(fixed.state_json);
    if (typeof viewerId !== "string" || !ID.test(viewerId) || viewerId !== state.situation?.playerId
      || state.entities?.[viewerId]?.kind !== "character" || state.entities[viewerId].visibility !== "player") fail("MEMORY_VIEWER_INVALID");
    const visible = new Set(Object.values(state.entities).filter(entity => entity.visibility === "player").map(entity => entity.id));
    const visibleJson = JSON.stringify([...visible]);
    const timeline = timelineAt(target);
    const lower = Math.max(cursor, afterRevision ?? 0);
    const upper = Math.min(target, beforeRevision === undefined ? target : beforeRevision - 1);
    const candidates = db.prepare(`
      SELECT t.revision,t.action_id,t.narration_json,a.request_json,a.status AS action_status,a.revision AS action_revision,
        json_type(t.state_json,'$.opening') AS opening_type,json_extract(t.state_json,'$.opening.phase') AS opening_phase
      FROM turns t JOIN actions a ON a.action_id=t.action_id
      WHERE t.revision>? AND t.revision<=? AND a.status='committed'
        AND EXISTS (
          SELECT 1 FROM json_each(t.narration_json) segment
          WHERE NOT EXISTS (
            SELECT 1 FROM experiences e,json_each(e.body_json,'$.sourceSegmentIds') ref
            WHERE e.revision=t.revision AND ref.value=json_extract(segment.value,'$.id')
          )
        )
      ORDER BY t.revision LIMIT ?
    `).all(lower, upper, limit + 1);
    const selected = candidates.slice(0, limit);
    const records = [];
    const experienceRows = db.prepare(`
      SELECT e.experience_id,e.body_json,EXISTS (
        SELECT 1 FROM experience_replacements replacement
        JOIN experiences correction ON correction.revision=replacement.correction_revision
          AND correction.experience_id=replacement.correction_experience_id
        WHERE replacement.viewer_id=? AND replacement.target_revision=e.revision
          AND replacement.target_experience_id=e.experience_id AND replacement.correction_revision<=?
          AND NOT EXISTS (SELECT 1 FROM json_each(correction.body_json,'$.entityIds')
            WHERE value NOT IN (SELECT value FROM json_each(?)))
      ) AS superseded FROM experiences e WHERE e.revision=? ORDER BY e.rowid
    `);
    for (const row of selected) {
      if (row.opening_type !== null && (row.opening_type !== "object" || row.opening_phase !== "ready")) continue;
      const narration = parse(row.narration_json);
      const request = parse(row.request_json);
      if (row.action_status !== "committed" || row.action_revision !== row.revision
        || request?.actionId !== row.action_id || request.baseRevision !== row.revision - 1
        || request.locale !== locale || request.contentVersion !== contentVersion || typeof request.input !== "string"
        || !Array.isArray(narration) || narration.some(segment => !segment || typeof segment.id !== "string"
          || !ID.test(segment.id) || typeof segment.text !== "string" || !segment.text.trim())
        || new Set(narration.map(segment => segment.id)).size !== narration.length) fail("MEMORY_SOURCE_UNAVAILABLE");
      const segmentIds = new Set(narration.map(segment => segment.id));
      const referenced = new Set();
      let allowed = true;
      for (const item of experienceRows.all(viewerId, target, visibleJson, row.revision)) {
        const experience = parse(item.body_json);
        if (!experience || experience.id !== item.experience_id || !ids(experience.knownBy) || !ids(experience.entityIds)
          || !ids(experience.sourceSegmentIds) || experience.sourceSegmentIds.some(id => !segmentIds.has(id))) fail("MEMORY_SOURCE_UNAVAILABLE");
        for (const id of experience.sourceSegmentIds) referenced.add(id);
        if (!experience.knownBy.includes(viewerId) || experience.entityIds.some(id => !visible.has(id)) || item.superseded) allowed = false;
      }
      if (!allowed) continue;
      const passages = narration.filter(segment => !referenced.has(segment.id)).map(({ id, text }) => ({ id, text }));
      if (!passages.length) continue;
      records.push({ adventureId, revision: row.revision, actionId: row.action_id,
        source: mapSessionSource(timeline, row.revision), passages, playerInput: request.input, recordType: "story_source" });
    }
    return { revision: target, records, scannedRecords: selected.length,
      nextCursor: candidates.length > limit ? selected.at(-1).revision : null };
  }
  return Object.freeze({ listUnindexedStoryRecords });
}

module.exports = { createStorySourceReader };
