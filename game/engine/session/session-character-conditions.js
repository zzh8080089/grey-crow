"use strict";

// Pure structural/provenance rules. Verbatim evidence does not establish that
// the selected words support the condition, its subject, or every qualifier.
const crypto = require("node:crypto");
const CONDITION_RECORD_FORMAT = "body-conditions-1";
const CONDITION_LIMITS = Object.freeze({ text: 120, evidence: 8, quote: 2000, totalQuote: 8000, records: 32 });
const LEGACY_CHARACTER_CONDITION_KEYS = Object.freeze([
  "status", "condition", "health", "injuries", "hunger", "thirst", "fatigue", "localizedStatus", "localized_status",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

function reject(path, reason) {
  const error = new Error(`${path}: ${reason}`);
  error.code = "TURN_VALIDATION_FAILED";
  error.reason = "INVALID_CHARACTER_CONDITIONS";
  error.issues = [error.message];
  throw error;
}
function fields(value, required, optional, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject(path, "must be an object");
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) reject(typeof key === "string" ? `${path}.${key}` : path, "unknown or non-data field");
  }
  for (const key of required) if (!Object.hasOwn(value, key)) reject(`${path}.${key}`, "required field is missing");
}
function identifier(value, path) {
  if (typeof value !== "string" || !ID.test(value) || FORBIDDEN.has(value)) reject(path, "invalid ID");
}
function text(value, maximum, path) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || !value.isWellFormed()) {
    reject(path, `must be nonempty well-formed text of at most ${maximum} characters`);
  }
}
function integer(value, minimum, path) {
  if (!Number.isSafeInteger(value) || value < minimum) reject(path, `must be an integer from ${minimum} to ${Number.MAX_SAFE_INTEGER}`);
}
function list(value, minimum, maximum, path) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) reject(path, `must be an array with ${minimum} to ${maximum} entries`);
}
function basis(value, path) {
  if (!["observed", "self_report"].includes(value)) reject(path, "invalid condition basis");
}
function sourceValue(source) {
  return { adventureId: source.adventureId, revision: source.revision, segmentId: source.segmentId,
    start: source.start, end: source.end, totalCharacters: source.totalCharacters, quote: source.quote };
}
function conditionRecordId(record) {
  const value = { characterId: record.characterId, basis: record.basis, text: record.text,
    sources: record.sources.map(sourceValue), ...(record.predecessor ? { predecessor: {
      adventureId: record.predecessor.adventureId, revision: record.predecessor.revision, recordId: record.predecessor.recordId,
    } } : {}) };
  return `condition_${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
function emptyConditionRecords() { return { format: CONDITION_RECORD_FORMAT, items: [] }; }

function validateConditionRecords(value, { characterId, path = "conditionRecords" } = {}) {
  identifier(characterId, `${path}.characterId`);
  fields(value, ["format", "items"], [], path);
  if (value.format !== CONDITION_RECORD_FORMAT) reject(path, "unsupported condition record format");
  list(value.items, 0, CONDITION_LIMITS.records, `${path}.items`);
  const ids = new Set();
  for (const [index, record] of value.items.entries()) {
    const at = `${path}.items[${index}]`;
    fields(record, ["id", "characterId", "basis", "text", "sources"], ["predecessor"], at);
    identifier(record.id, `${at}.id`);
    if (record.characterId !== characterId || ids.has(record.id)) reject(at, "condition identity mismatch or duplicate");
    ids.add(record.id); basis(record.basis, `${at}.basis`); text(record.text, CONDITION_LIMITS.text, `${at}.text`);
    list(record.sources, 1, CONDITION_LIMITS.evidence, `${at}.sources`);
    let totalQuote = 0;
    const sources = new Set();
    for (const source of record.sources) {
      fields(source, ["adventureId", "revision", "segmentId", "start", "end", "totalCharacters", "quote"], [], `${at}.sources`);
      identifier(source.adventureId, `${at}.sources.adventureId`); identifier(source.segmentId, `${at}.sources.segmentId`);
      integer(source.revision, 1, `${at}.sources.revision`); integer(source.start, 0, `${at}.sources.start`);
      integer(source.end, 1, `${at}.sources.end`); integer(source.totalCharacters, 1, `${at}.sources.totalCharacters`);
      text(source.quote, CONDITION_LIMITS.quote, `${at}.sources.quote`);
      if (source.end > source.totalCharacters || source.end - source.start !== source.quote.length
        || source.adventureId !== record.sources[0].adventureId || source.revision !== record.sources[0].revision) {
        reject(at, "condition sources must identify one creation turn and exact quote coordinates");
      }
      const key = JSON.stringify([source.segmentId, source.start, source.end]);
      if (sources.has(key)) reject(at, "duplicate condition evidence");
      sources.add(key); totalQuote += source.quote.length;
    }
    if (totalQuote > CONDITION_LIMITS.totalQuote) reject(at, "condition evidence exceeds total text limit");
    if (Object.hasOwn(record, "predecessor")) {
      fields(record.predecessor, ["adventureId", "revision", "recordId"], [], `${at}.predecessor`);
      identifier(record.predecessor.adventureId, `${at}.predecessor.adventureId`);
      identifier(record.predecessor.recordId, `${at}.predecessor.recordId`);
      integer(record.predecessor.revision, 1, `${at}.predecessor.revision`);
      if (record.predecessor.revision >= record.sources[0].revision) reject(at, "predecessor must precede the new record");
    }
    if (record.id !== conditionRecordId(record)) reject(at, "condition record hash does not match its data");
  }
  return value;
}

function compileConditionEvidence(evidence, { adventureId, revision, narration, sourceSegmentIds, path = "evidence" } = {}) {
  identifier(adventureId, `${path}.adventureId`); integer(revision, 1, `${path}.revision`);
  list(evidence, 1, CONDITION_LIMITS.evidence, path);
  if (!Array.isArray(narration) || !Array.isArray(sourceSegmentIds)) reject(path, "current narration and event sources are required");
  const allowed = new Set(sourceSegmentIds);
  const result = []; let total = 0;
  for (const [index, item] of evidence.entries()) {
    const at = `${path}[${index}]`;
    fields(item, ["segmentId", "quote"], [], at);
    identifier(item.segmentId, `${at}.segmentId`); text(item.quote, CONDITION_LIMITS.quote, `${at}.quote`);
    total += item.quote.length;
    if (total > CONDITION_LIMITS.totalQuote) reject(path, "condition evidence exceeds total text limit");
    const segments = narration.filter(segment => segment.id === item.segmentId);
    if (!allowed.has(item.segmentId) || segments.length !== 1 || typeof segments[0].text !== "string") reject(`${at}.segmentId`, "condition evidence must reference this event's current narration");
    const original = segments[0].text;
    const start = original.indexOf(item.quote);
    if (start === -1 || original.indexOf(item.quote, start + 1) !== -1) reject(`${at}.quote`, "condition quote must match current narration exactly once");
    const source = { adventureId, revision, segmentId: item.segmentId, start,
      end: start + item.quote.length, totalCharacters: original.length, quote: item.quote };
    if (result.some(other => other.segmentId === source.segmentId && other.start === source.start && other.end === source.end)) reject(at, "duplicate condition evidence");
    result.push(source);
  }
  return result;
}

function compileConditionSources(data, context = {}) {
  // Older committed events retain their exact excerpts. An explicitly present
  // invalid value must fail, rather than silently opting into whole paragraphs.
  if (Object.hasOwn(data, "evidence")) return compileConditionEvidence(data.evidence, context);
  const { narration, sourceSegmentIds, path = "sources" } = context;
  list(sourceSegmentIds, 1, CONDITION_LIMITS.evidence, path);
  if (!Array.isArray(narration)) reject(path, "current narration and event sources are required");
  const evidence = sourceSegmentIds.map(segmentId => {
    identifier(segmentId, `${path}.segmentId`);
    const segments = narration.filter(segment => segment.id === segmentId);
    if (segments.length !== 1) reject(path, "condition evidence must reference this event's current narration");
    return { segmentId, quote: segments[0].text };
  });
  return compileConditionEvidence(evidence, context);
}

function hasLegacyConditions(entity) {
  return LEGACY_CHARACTER_CONDITION_KEYS.some(key => Object.hasOwn(entity?.attributes || {}, key));
}
function initializeCharacterConditions(entity, { path = "entity" } = {}) {
  if (Object.hasOwn(entity, "conditionRecords")) reject(path, "condition records are engine-owned");
  if (entity.kind === "character") {
    if (hasLegacyConditions(entity)) reject(path, "new character conditions require condition events");
    entity.conditionRecords = emptyConditionRecords();
  }
  return entity;
}
function applyCharacterConditionEvent(state, event, context = {}) {
  const path = context.path || "event";
  const data = event.data;
  const type = event.type;
  if (!["condition.add", "condition.replace", "condition.remove"].includes(type)) reject(path, "unsupported condition event");
  fields(data, type === "condition.add" ? ["characterId", "basis", "text"]
    : type === "condition.replace" ? ["characterId", "recordId", "basis", "text"]
      : ["characterId", "recordId", "reason"], ["evidence"], `${path}.data`);
  identifier(data.characterId, `${path}.data.characterId`);
  const target = state.entities[data.characterId];
  const prior = context.priorState?.entities[data.characterId];
  if (!target || target.kind !== "character") reject(`${path}.data.characterId`, "condition target must be an existing character");
  if (hasLegacyConditions(target) || hasLegacyConditions(prior)) reject(path, "legacy character conditions cannot be converted by condition events");
  if (!target.conditionRecords) target.conditionRecords = emptyConditionRecords();
  validateConditionRecords(target.conditionRecords, { characterId: data.characterId });
  integer(context.baseRevision, 0, "baseRevision");
  if (context.baseRevision === Number.MAX_SAFE_INTEGER) reject(path, "cannot advance revision");
  const sources = compileConditionSources(data, { adventureId: context.adventureId, revision: context.baseRevision + 1,
    narration: context.narration, sourceSegmentIds: event.sourceSegmentIds,
    path: Object.hasOwn(data, "evidence") ? `${path}.data.evidence` : "event.sourceSegmentIds" });
  let previous;
  if (type !== "condition.add") {
    identifier(data.recordId, `${path}.data.recordId`);
    previous = prior?.conditionRecords?.items.find(item => item.id === data.recordId);
    const key = `${data.characterId}:${data.recordId}`;
    if (!previous || !target.conditionRecords.items.some(item => item.id === previous.id)
      || !context.conditionTargets || context.conditionTargets.has(key)) reject(`${path}.data.recordId`, "condition replacement or removal requires an unchanged record from the turn's initial state");
    context.conditionTargets.add(key);
  }
  if (type === "condition.remove") {
    if (!["resolved", "retracted"].includes(data.reason)) reject(`${path}.data.reason`, "invalid condition removal reason");
    target.conditionRecords.items = target.conditionRecords.items.filter(item => item.id !== previous.id);
    return state;
  }
  basis(data.basis, `${path}.data.basis`); text(data.text, CONDITION_LIMITS.text, `${path}.data.text`);
  const record = { characterId: data.characterId, basis: data.basis, text: data.text, sources,
    ...(previous ? { predecessor: { adventureId: previous.sources[0].adventureId, revision: previous.sources[0].revision, recordId: previous.id } } : {}) };
  record.id = conditionRecordId(record);
  if (target.conditionRecords.items.some(item => item.id === record.id)) reject(path, "duplicate condition record");
  if (previous) target.conditionRecords.items = target.conditionRecords.items.map(item => item.id === previous.id ? record : item);
  else target.conditionRecords.items.push(record);
  validateConditionRecords(target.conditionRecords, { characterId: data.characterId });
  return state;
}

module.exports = { CONDITION_RECORD_FORMAT, CONDITION_LIMITS, LEGACY_CHARACTER_CONDITION_KEYS,
  emptyConditionRecords, validateConditionRecords, conditionRecordId, compileConditionEvidence, compileConditionSources,
  hasLegacyConditions, initializeCharacterConditions, applyCharacterConditionEvent };
