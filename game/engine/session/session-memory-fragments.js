"use strict";

// This optional narrative track is not verified biography or the retrieval
// memory system. The engine checks quotas, provenance and ordering; it cannot
// prove a natural trigger, semantic similarity, or the player's consent.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const MODES = Object.freeze(["active_recall", "passive_association"]);
const DIMENSIONS = Object.freeze(["body", "emotion", "skill", "identity"]);
const CHOICES = Object.freeze(["deferred", "accepted", "sealed"]);
const MEMORY_FRAGMENT_LIMITS = Object.freeze({ fragments: 30, triggerCharacters: 160, contentCharacters: 500 });

function reject(path, reason) {
  const issue = `${path}: ${reason}`;
  const error = new Error(issue);
  error.code = "TURN_VALIDATION_FAILED";
  error.reason = "INVALID_MEMORY_FRAGMENT_STATE";
  error.issues = [issue];
  throw error;
}
function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject(path, "invalid object");
}
function field(value, key, path) {
  object(value, path);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) reject(path, "ordinary data fields required");
  return descriptor.value;
}
function fields(value, names, path) {
  object(value, path);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some((key) => !names.includes(key))) reject(path, "unexpected or missing field");
  names.forEach((key) => field(value, key, `${path}.${key}`));
}
function list(value, maximum, path, minimum = 0) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < minimum || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) reject(path, "invalid list");
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) reject(path, "ordinary list entries required");
  }
}
function identifier(value, path) {
  if (typeof value !== "string" || !ID.test(value) || FORBIDDEN.has(value)) reject(path, "invalid ID");
}
function integer(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(path, "invalid integer");
}
function text(value, maximum, path) {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > maximum) reject(path, "invalid text or size");
}
function choice(value, choices, path) {
  if (!choices.includes(value)) reject(path, "unsupported value");
}
function source(value, path) {
  fields(value, ["adventureId", "revision", "eventId", "sourceSegmentIds"], path);
  identifier(value.adventureId, `${path}.adventureId`);
  integer(value.revision, `${path}.revision`, 1);
  identifier(value.eventId, `${path}.eventId`);
  list(value.sourceSegmentIds, 256, `${path}.sourceSegmentIds`, 1);
  const seen = new Set();
  value.sourceSegmentIds.forEach((segmentId) => {
    identifier(segmentId, `${path}.sourceSegmentIds`);
    if (seen.has(segmentId)) reject(path, "duplicate source segment");
    seen.add(segmentId);
  });
}
function sameSource(left, right) {
  return left.adventureId === right.adventureId && left.revision === right.revision
    && left.eventId === right.eventId && left.sourceSegmentIds.length === right.sourceSegmentIds.length
    && left.sourceSegmentIds.every((id, index) => id === right.sourceSegmentIds[index]);
}
function comparisonText(value) {
  // Exact normalized duplicate detection only, not semantic similarity.
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}
function createEmptyMemoryFragments() {
  return { fragments: [], revelationStatus: "collecting", unlockedAt: null, decision: null };
}

function validateMemoryFragments(state) {
  const track = field(state, "memoryFragments", "state");
  if (track === undefined) {
    if (Object.hasOwn(state, "memoryFragments")) reject("state.memoryFragments", "must be an object when present");
    return state;
  }
  const at = "state.memoryFragments";
  fields(track, ["fragments", "revelationStatus", "unlockedAt", "decision"], at);
  list(track.fragments, MEMORY_FRAGMENT_LIMITS.fragments, `${at}.fragments`);
  choice(track.revelationStatus, ["collecting", "available", ...CHOICES], `${at}.revelationStatus`);
  const triggers = new Set();
  const contents = new Set();
  const allowances = new Set();
  const sources = new Set();
  let previousSource = null;
  track.fragments.forEach((fragment, index) => {
    const path = `${at}.fragments[${index}]`;
    fields(fragment, ["id", "gameDay", "discoveryMode", "dimension", "trigger", "content", "certainty", "source"], path);
    if (fragment.id !== `fragment-${index + 1}`) reject(`${path}.id`, "must match the append-only fragment sequence");
    integer(fragment.gameDay, `${path}.gameDay`, 0, 1_000_000_000);
    choice(fragment.discoveryMode, MODES, `${path}.discoveryMode`);
    choice(fragment.dimension, DIMENSIONS, `${path}.dimension`);
    text(fragment.trigger, MEMORY_FRAGMENT_LIMITS.triggerCharacters, `${path}.trigger`);
    text(fragment.content, MEMORY_FRAGMENT_LIMITS.contentCharacters, `${path}.content`);
    if (fragment.certainty !== "uncertain") reject(`${path}.certainty`, "fragments are unverified recollections");
    source(fragment.source, `${path}.source`);
    if (previousSource && (fragment.source.revision < previousSource.revision
      || (fragment.source.revision === previousSource.revision && fragment.source.adventureId !== previousSource.adventureId))) {
      reject(`${path}.source`, "fragment sources must follow the inherited timeline");
    }
    previousSource = fragment.source;
    const trigger = comparisonText(fragment.trigger);
    const content = comparisonText(fragment.content);
    const allowance = `${fragment.gameDay}:${fragment.discoveryMode}`;
    const origin = `${fragment.source.adventureId}:${fragment.source.revision}:${fragment.source.eventId}`;
    if (triggers.has(trigger) || contents.has(content)) reject(path, "normalized trigger or content already recorded");
    if (allowances.has(allowance)) reject(path, "daily discovery allowance already used");
    if (sources.has(origin)) reject(path, "source event already recorded");
    triggers.add(trigger); contents.add(content); allowances.add(allowance); sources.add(origin);
  });
  if (track.fragments.length < MEMORY_FRAGMENT_LIMITS.fragments) {
    if (track.revelationStatus !== "collecting" || track.unlockedAt !== null || track.decision !== null) reject(at, "incomplete track cannot unlock a choice");
  } else {
    source(track.unlockedAt, `${at}.unlockedAt`);
    if (!sameSource(track.unlockedAt, track.fragments.at(-1).source) || track.revelationStatus === "collecting") reject(at, "unlock must reference the thirtieth fragment");
    if (track.revelationStatus === "available") {
      if (track.decision !== null) reject(at, "available choice cannot retain a decision");
    } else {
      fields(track.decision, ["choice", "source"], `${at}.decision`);
      choice(track.decision.choice, CHOICES, `${at}.decision.choice`);
      source(track.decision.source, `${at}.decision.source`);
      if (track.decision.choice !== track.revelationStatus
        || track.decision.source.revision <= track.unlockedAt.revision) reject(at, "choice must follow the committed unlock in a later turn");
    }
  }
  const opening = field(state, "opening", "state");
  if (opening && field(opening, "phase", "state.opening") !== "ready" && track.fragments.length) reject(at, "opening cannot contain collected fragments");
  if (opening && track.fragments.length) {
    const confirmation = field(opening, "confirmation", "state.opening");
    const confirmedRevision = field(confirmation, "revision", "state.opening.confirmation");
    integer(confirmedRevision, "state.opening.confirmation.revision", 1);
    if (track.fragments[0].source.revision <= confirmedRevision) reject(at, "first fragment must follow the confirmed opening scene");
  }
  return state;
}

function applyMemoryFragmentEvent(state, event, { priorState, baseRevision, adventureId, memoryFragmentsEnabled = false } = {}) {
  validateMemoryFragments(state);
  validateMemoryFragments(priorState);
  if (memoryFragmentsEnabled !== true) reject("event", "memory fragments are not enabled by the locked content");
  if ((state.opening && state.opening.phase !== "ready") || (priorState.opening && priorState.opening.phase !== "ready")) reject("event", "fragments require a previously confirmed opening");
  integer(baseRevision, "baseRevision", 0, Number.MAX_SAFE_INTEGER - 1);
  identifier(adventureId, "adventureId");
  const origin = { adventureId, revision: baseRevision + 1, eventId: event.id, sourceSegmentIds: [...event.sourceSegmentIds] };
  source(origin, "event.source");
  const current = state.memoryFragments || createEmptyMemoryFragments();
  const previous = priorState.memoryFragments || createEmptyMemoryFragments();
  if (previous.fragments.some((fragment) => fragment.source.revision > baseRevision)
    || (previous.decision && previous.decision.source.revision > baseRevision)) reject("state.memoryFragments", "source is newer than this turn's base revision");
  const next = structuredClone(state);
  next.memoryFragments = structuredClone(current);
  const data = event.data;
  if (event.type === "memory_fragment.record") {
    fields(data, ["discoveryMode", "dimension", "trigger", "content"], "event.data");
    choice(data.discoveryMode, MODES, "event.data.discoveryMode");
    choice(data.dimension, DIMENSIONS, "event.data.dimension");
    text(data.trigger, MEMORY_FRAGMENT_LIMITS.triggerCharacters, "event.data.trigger");
    text(data.content, MEMORY_FRAGMENT_LIMITS.contentCharacters, "event.data.content");
    if (current.revelationStatus !== "collecting" || current.fragments.length >= MEMORY_FRAGMENT_LIMITS.fragments) reject("event", "fragment collection is already complete");
    integer(state.situation.day, "state.situation.day", 0, 1_000_000_000);
    if (state.situation.day < priorState.situation.day) reject("event", "fragment collection cannot move the game day backwards");
    next.memoryFragments.fragments.push({ id: `fragment-${current.fragments.length + 1}`, gameDay: state.situation.day,
      ...structuredClone(data), certainty: "uncertain", source: origin });
    if (next.memoryFragments.fragments.length === MEMORY_FRAGMENT_LIMITS.fragments) {
      next.memoryFragments.revelationStatus = "available";
      next.memoryFragments.unlockedAt = structuredClone(origin);
    }
  } else if (event.type === "memory_fragment.resolve") {
    fields(data, ["choice"], "event.data");
    choice(data.choice, CHOICES, "event.data.choice");
    if (!["available", "deferred"].includes(previous.revelationStatus)
      || previous.fragments.length !== MEMORY_FRAGMENT_LIMITS.fragments
      || previous.unlockedAt.revision > baseRevision
      || JSON.stringify(previous) !== JSON.stringify(current)) reject("event", "choice requires the unchanged, previously committed complete track");
    next.memoryFragments.revelationStatus = data.choice;
    next.memoryFragments.decision = { choice: data.choice, source: origin };
  } else reject("event.type", "unsupported fragment event");
  // All original-adventure references survive a copied continuation unchanged.
  // Store validation additionally proves these sources exist in that timeline.
  validateMemoryFragments(next);
  return next;
}

function memoryFragmentProgress(state, options = {}) {
  validateMemoryFragments(state);
  object(options, "options");
  if (Reflect.ownKeys(options).some((key) => key !== "memoryFragmentsEnabled")) reject("options", "unknown field");
  const configured = field(options, "memoryFragmentsEnabled", "options");
  if (configured !== undefined && typeof configured !== "boolean") reject("options.memoryFragmentsEnabled", "must be a boolean");
  const enabled = configured === undefined ? Object.hasOwn(state, "memoryFragments") : configured;
  if (!enabled) return null;
  const track = state.memoryFragments || createEmptyMemoryFragments();
  const dimensions = { body: 0, emotion: 0, skill: 0, identity: 0 };
  const situation = field(state, "situation", "state");
  const day = field(situation, "day", "state.situation");
  integer(day, "state.situation.day", 0, 1_000_000_000);
  track.fragments.forEach((fragment) => { dimensions[fragment.dimension] += 1; });
  const collecting = track.revelationStatus === "collecting" && (!state.opening || state.opening.phase === "ready");
  const remaining = (mode) => collecting && !track.fragments.some((fragment) => fragment.gameDay === day && fragment.discoveryMode === mode) ? 1 : 0;
  return { count: track.fragments.length, maxCount: MEMORY_FRAGMENT_LIMITS.fragments, phase: track.revelationStatus,
    choice: track.decision?.choice ?? null, dimensions,
    today: { day, activeRecallRemaining: remaining("active_recall"), passiveAssociationRemaining: remaining("passive_association") } };
}

module.exports = { MEMORY_FRAGMENT_LIMITS, createEmptyMemoryFragments, validateMemoryFragments, applyMemoryFragmentEvent, memoryFragmentProgress };
