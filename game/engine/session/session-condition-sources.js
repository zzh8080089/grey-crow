"use strict";

const { isDeepStrictEqual } = require("node:util");
const { createHash } = require("node:crypto");
const { mapSessionSource } = require("./session-lineage");
const { validateConditionRecords, compileConditionSources, conditionRecordId } = require("./session-character-conditions");

const PAGE_CHARACTERS = 12000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

function failure(code = "CHARACTER_CONDITION_SOURCE_INVALID") {
  return Object.assign(new Error(code), { code });
}

// The copied database contains the original committed source rows. Never open
// an ancestor directory, relabel inherited evidence, or repair a stored record.
// Proofs are local to this read: a failed transaction or externally changed row
// cannot leave a successful cached proof behind.
function validateConditionSources(db, state, timeline) {
  try { validate(db, state, timeline); }
  catch { throw failure(); }
}

function validate(db, state, timeline) {
  const pending = [];
  const requireValid = (value) => { if (!value) throw failure(); };
  function ledger(value, characterId) {
    if (value === undefined || value === null) return [];
    validateConditionRecords(value, { characterId });
    return value.items;
  }
  for (const entities of [state.entities, state.opening?.proposal?.initialState?.entities]) {
    for (const [characterId, character] of Object.entries(entities || {})) {
      if (!Object.hasOwn(character, "conditionRecords")) continue;
      requireValid(character.kind === "character" && character.id === characterId && character.conditionRecords !== null);
      for (const record of ledger(character.conditionRecords, characterId)) pending.push(record);
    }
  }
  // Historical snapshots without the new field keep their existing read path.
  if (!pending.length) return;
  const session = db.prepare("SELECT adventure_id,locale,content_version,revision FROM session WHERE singleton=1").get();
  requireValid(session?.adventure_id === timeline.adventureId && timeline.revision <= session.revision);
  const rows = new Map();
  const ledgers = new Map();
  const verified = new Map();
  function sourceRow(revision) {
    if (rows.has(revision)) return rows.get(revision);
    const origin = mapSessionSource(timeline, revision); // Rejects R0 and system boundaries.
    const row = db.prepare(`SELECT t.action_id,t.narration_json,t.events_json,a.status,a.revision AS action_revision,a.request_json
      FROM turns t LEFT JOIN actions a ON a.action_id=t.action_id WHERE t.revision=?`).get(revision);
    requireValid(row?.action_id && row.status === "committed" && row.action_revision === revision);
    const request = JSON.parse(row.request_json);
    requireValid(request.actionId === row.action_id && request.baseRevision === revision - 1 && typeof request.input === "string"
      && request.locale === session.locale && request.contentVersion === session.content_version);
    const value = { origin, actionId: row.action_id, input: request.input,
      narration: JSON.parse(row.narration_json), events: JSON.parse(row.events_json) };
    requireValid(Array.isArray(value.narration) && Array.isArray(value.events));
    rows.set(revision, value);
    return value;
  }
  function at(revision, characterId) {
    const key = JSON.stringify([revision, characterId]);
    if (ledgers.has(key)) return ledgers.get(key);
    // IDs are validated by the pure record validator. Bind JSON paths anyway;
    // do not interpolate untrusted record data into SQL text.
    const suffix = `entities.${JSON.stringify(characterId)}`;
    const row = db.prepare(`SELECT json_extract(state_json,?) AS current_entity,
      json_extract(state_json,?) AS proposed_entity FROM turns WHERE revision=?`)
      .get(`$.${suffix}`, `$.opening.proposal.initialState.${suffix}`, revision);
    requireValid(row);
    function entityRecords(serialized) {
      if (serialized == null) return [];
      const entity = JSON.parse(serialized);
      if (!Object.hasOwn(entity, "conditionRecords")) return [];
      requireValid(entity.id === characterId && entity.kind === "character" && entity.conditionRecords !== null);
      return ledger(entity.conditionRecords, characterId);
    }
    const value = { current: entityRecords(row.current_entity), proposed: entityRecords(row.proposed_entity) };
    ledgers.set(key, value);
    return value;
  }
  function compile(data, event, row, revision, previous) {
    const sources = compileConditionSources(data, { adventureId: row.origin.adventureId,
      revision, narration: row.narration, sourceSegmentIds: event.sourceSegmentIds });
    const record = { characterId: data.characterId, basis: data.basis, text: data.text, sources,
      ...(previous ? { predecessor: { adventureId: previous.sources[0].adventureId,
        revision: previous.sources[0].revision, recordId: previous.id } } : {}) };
    return { id: conditionRecordId(record), ...record };
  }
  while (pending.length) {
    const record = pending.pop();
    const key = JSON.stringify([record.sources[0].adventureId, record.sources[0].revision, record.id]);
    if (verified.has(key)) { requireValid(isDeepStrictEqual(verified.get(key), record)); continue; }
    const revision = record.sources[0].revision;
    const row = sourceRow(revision);
    requireValid(row.origin.adventureId === record.sources[0].adventureId);
    const stored = at(revision, record.characterId);
    const originals = [...stored.current, ...stored.proposed].filter((entry) => entry.id === record.id);
    requireValid(originals.length === 1 && isDeepStrictEqual(originals[0], record));
    let matches = 0;
    let predecessor;
    for (const event of row.events) {
      if (event.type === "condition.add" || event.type === "condition.replace") {
        if (event.data?.characterId !== record.characterId) continue;
        const data = event.data;
        const expectedKeys = event.type === "condition.add"
          ? ["characterId", "basis", "text"] : ["characterId", "recordId", "basis", "text"];
        if (Object.hasOwn(data, "evidence")) expectedKeys.push("evidence");
        requireValid(Object.keys(data).length === expectedKeys.length && expectedKeys.every((field) => Object.hasOwn(data, field)));
        let previous;
        if (event.type === "condition.replace") {
          const active = at(revision - 1, record.characterId).current.filter((entry) => entry.id === data.recordId);
          requireValid(active.length === 1);
          previous = active[0];
          requireValid(previous.sources[0].revision < revision);
        }
        const expected = compile(data, event, row, revision, previous);
        if (expected.id === record.id) {
          requireValid(isDeepStrictEqual(expected, record));
          matches++;
          predecessor = previous;
        }
      } else if (event.type === "opening.propose") {
        for (const data of event.data?.initialConditions || []) {
          if (data.characterId !== record.characterId) continue;
          const expected = compile(data, event, row, revision);
          if (expected.id === record.id) { requireValid(isDeepStrictEqual(expected, record)); matches++; }
        }
      }
    }
    requireValid(matches === 1);
    if (record.predecessor) requireValid(predecessor && predecessor.characterId === record.characterId);
    if (predecessor) pending.push(predecessor);
    verified.set(key, record);
  }
  return { records: [...verified.values()], rows };
}

// This is a narrow read of a visible character's reachable body provenance,
// not a general historical-state or file reader. A cursor only binds a page;
// permissions and the complete predecessor proof are rechecked on every read.
function readConditionSource(db, state, timeline, options) {
  const fields = options && Object.getOwnPropertyDescriptors(options);
  if (!fields || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
    || Reflect.ownKeys(fields).some(key => !["entityId", "recordId", "cursor"].includes(key)
      || !fields[key].enumerable || !Object.hasOwn(fields[key], "value"))
    || !Object.hasOwn(fields, "entityId") || !Object.hasOwn(fields, "recordId")) throw failure("CONDITION_SOURCE_INPUT_INVALID");
  const { entityId, recordId, cursor } = options;
  if (typeof entityId !== "string" || !ID.test(entityId) || typeof recordId !== "string" || !ID.test(recordId)
    || (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 2048))) throw failure("CONDITION_SOURCE_INPUT_INVALID");
  const entity = Object.hasOwn(state.entities, entityId) ? state.entities[entityId] : null;
  if (entity?.kind !== "character" || entity.visibility !== "player" || !entity.conditionRecords?.items.length) {
    throw failure("CONDITION_RECORD_NOT_AVAILABLE");
  }
  let proof;
  try { proof = validate(db, { entities: { [entityId]: entity } }, timeline); }
  catch { throw failure(); }
  const record = proof.records.find(value => value.id === recordId && value.characterId === entityId);
  if (!record) throw failure("CONDITION_RECORD_NOT_AVAILABLE");
  const row = proof.rows.get(record.sources[0].revision);
  if (!row || row.narration.some(segment => !segment || typeof segment.id !== "string" || !ID.test(segment.id)
    || typeof segment.text !== "string" || !segment.text.isWellFormed()
    || Object.keys(segment).some(key => !["id", "text"].includes(key)))
    || new Set(row.narration.map(segment => segment.id)).size !== row.narration.length || !row.input.isWellFormed()) throw failure();
  const source = { ...row.origin, actionId: row.actionId };
  const passages = [{ kind: "player_input", text: row.input },
    ...row.narration.map(segment => ({ kind: "narration", segmentId: segment.id, text: segment.text }))];
  const sourceHash = createHash("sha256").update(JSON.stringify({ source, input: row.input, narration: row.narration })).digest("hex");
  const binding = { version: 1, adventureId: timeline.adventureId, revision: timeline.revision, entityId, recordId, sourceHash };
  const encode = position => position === null ? null : Buffer.from(JSON.stringify({ ...binding, ...position })).toString("base64url");
  function next(index, offset = 0) {
    while (index < passages.length && offset === passages[index].text.length) { index++; offset = 0; }
    return index === passages.length ? null : { index, offset };
  }
  function boundary(text, offset) {
    return offset === 0 || offset === text.length
      || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
        && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);
  }
  let position = next(0);
  if (cursor !== undefined) {
    try {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Number.isSafeInteger(value.index) || value.index < 0 || value.index >= passages.length
        || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset >= passages[value.index].text.length
        || !boundary(passages[value.index].text, value.offset)
        || !isDeepStrictEqual(value, { ...binding, index: value.index, offset: value.offset })
        || encode({ index: value.index, offset: value.offset }) !== cursor) throw failure();
      position = { index: value.index, offset: value.offset };
    } catch { throw failure("CONDITION_SOURCE_CURSOR_INVALID"); }
  }
  const result = { revision: timeline.revision, entityId,
    record: { id: record.id, characterId: record.characterId, basis: record.basis, text: record.text,
      ...(record.predecessor ? { predecessor: structuredClone(record.predecessor) } : {}) }, source,
    evidenceRanges: record.sources.map(({ segmentId, start, end, totalCharacters }) => ({ segmentId, start, end, totalCharacters })),
    passages: [], nextCursor: encode(position) };
  function piece(block, start, end) {
    return { kind: block.kind, ...(block.segmentId === undefined ? {} : { segmentId: block.segmentId }),
      text: block.text.slice(start, end), start, end, totalCharacters: block.text.length };
  }
  function fits(passage, following) {
    return JSON.stringify({ ...result, passages: [...result.passages, passage], nextCursor: encode(following) }).length <= PAGE_CHARACTERS;
  }
  while (position) {
    const { index, offset } = position;
    const block = passages[index];
    const following = next(index, block.text.length);
    const complete = piece(block, offset, block.text.length);
    if (fits(complete, following)) {
      result.passages.push(complete); position = following; result.nextCursor = encode(position); continue;
    }
    let low = 1, high = block.text.length - offset, best = offset;
    while (low <= high) {
      const length = Math.floor((low + high) / 2);
      let end = offset + length;
      if (!boundary(block.text, end)) end--;
      if (fits(piece(block, offset, end), next(index, end))) { best = Math.max(best, end); low = length + 1; }
      else high = length - 1;
    }
    if (best > offset) {
      result.passages.push(piece(block, offset, best)); position = next(index, best);
    }
    result.nextCursor = encode(position);
    break;
  }
  if (!result.passages.some(passage => passage.text.length) || JSON.stringify(result).length > PAGE_CHARACTERS) {
    throw failure("CONDITION_SOURCE_PAGE_TOO_LARGE");
  }
  return result;
}

module.exports = { validateConditionSources, readConditionSource };
