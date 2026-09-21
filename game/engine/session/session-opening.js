"use strict";

// Pure opening rules. The outer turn model supplies safe JSON and validates the
// narration/event envelope. This module never reads files, calls a model, or
// authorizes menu/content creation. Its factory runs after the separate desktop
// content-selection confirmation; that confirmation does not confirm a role.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const conditions = require("./session-character-conditions");

function reject(path, reason) {
  const error = new Error(`${path}: ${reason}`);
  error.code = "TURN_VALIDATION_FAILED";
  error.reason = "INVALID_OPENING_STATE";
  error.issues = [error.message];
  throw error;
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(path, "must be an object");
}

function fields(value, required, optional, path) {
  object(value, path);
  for (const key of required) if (!Object.hasOwn(value, key)) reject(path, "required field is missing");
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))) reject(path, "unknown field");
}

function identifier(value, path) {
  if (typeof value !== "string" || !ID.test(value) || FORBIDDEN.has(value)) reject(path, "invalid ID");
}

function revision(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) reject(path, "invalid revision or day");
}

function sources(value, path, available) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) reject(path, "source segments are required");
  const seen = new Set();
  for (const segmentId of value) {
    identifier(segmentId, path);
    if (seen.has(segmentId)) reject(path, "duplicate source segment");
    if (available && !available.has(segmentId)) reject(path, "source segment is not in this turn");
    seen.add(segmentId);
  }
}

function readyState(state, validateReadyState, path) {
  object(state, path);
  if (Object.hasOwn(state, "opening")) reject(path, "candidate initial state cannot contain opening metadata");
  if (typeof validateReadyState !== "function") throw new TypeError("validateReadyState is required");
  // The callback must validate the ordinary formal state without recursing into
  // these opening rules. It may normalize its private copy, never caller input.
  const copy = structuredClone(state);
  let normalized;
  try { normalized = validateReadyState(copy) ?? copy; }
  catch (error) {
    if (error?.code === "TURN_VALIDATION_FAILED") throw error;
    reject(path, "candidate initial state is invalid");
  }
  object(normalized, path);
  if (Object.hasOwn(normalized, "opening")) reject(path, "candidate initial state cannot contain opening metadata");
  return normalized;
}

function withoutOpening(state) {
  const copy = { ...state };
  delete copy.opening;
  return copy;
}

function requireEmptyFormalState(state) {
  object(state.entities, "state.entities");
  object(state.commitments, "state.commitments");
  fields(state.situation, ["playerId", "locationId", "day"], [], "state.situation");
  if (Object.keys(state.entities).length || Object.keys(state.commitments).length
    || !Array.isArray(state.inventory) || state.inventory.length
    || state.situation.playerId !== null || state.situation.locationId !== null) {
    reject("state.opening", "unconfirmed opening cannot contain formal people, locations, inventory, or commitments");
  }
  revision(state.situation.day, "state.situation.day");
}

function validateOpening(state, { validateReadyState } = {}) {
  object(state, "state");
  // Existing ordinary states are already ready. They cannot re-enter creation.
  if (!Object.hasOwn(state, "opening")) {
    readyState(state, validateReadyState, "state");
    return state;
  }
  const opening = state.opening;
  fields(opening, ["phase", "draft", "proposal"], ["confirmation"], "state.opening");
  object(opening.draft, "state.opening.draft");
  if (Object.keys(opening.draft).length > 64) reject("state.opening.draft", "too many draft fields");
  if (!["creating", "awaiting_confirmation", "ready"].includes(opening.phase)) reject("state.opening.phase", "invalid opening phase");
  if (opening.phase === "ready") {
    if (opening.proposal !== null || Object.keys(opening.draft).length) reject("state.opening", "ready opening must clear its draft and candidate");
    const confirmation = opening.confirmation;
    fields(confirmation, ["proposalId", "summaryRevision", "summarySegmentIds", "revision", "sourceSegmentIds"], [], "state.opening.confirmation");
    identifier(confirmation.proposalId, "state.opening.confirmation.proposalId");
    revision(confirmation.summaryRevision, "state.opening.confirmation.summaryRevision", 1);
    revision(confirmation.revision, "state.opening.confirmation.revision", 1);
    if (confirmation.summaryRevision >= confirmation.revision) reject("state.opening.confirmation", "summary must precede confirmation");
    sources(confirmation.summarySegmentIds, "state.opening.confirmation.summarySegmentIds");
    sources(confirmation.sourceSegmentIds, "state.opening.confirmation.sourceSegmentIds");
    readyState(withoutOpening(state), validateReadyState, "state");
    return state;
  }
  requireEmptyFormalState(state);
  if (Object.hasOwn(opening, "confirmation")) reject("state.opening", "unconfirmed opening cannot contain confirmation evidence");
  if (opening.phase === "creating") {
    if (opening.proposal !== null) reject("state.opening.proposal", "creating opening cannot retain a confirmation candidate");
    return state;
  }
  const proposal = opening.proposal;
  fields(proposal, ["proposalId", "initialState", "summary"], [], "state.opening.proposal");
  identifier(proposal.proposalId, "state.opening.proposal.proposalId");
  fields(proposal.summary, ["revision", "segmentIds"], [], "state.opening.proposal.summary");
  revision(proposal.summary.revision, "state.opening.proposal.summary.revision", 1);
  sources(proposal.summary.segmentIds, "state.opening.proposal.summary.segmentIds");
  const candidate = readyState(proposal.initialState, validateReadyState, "state.opening.proposal.initialState");
  if (candidate.situation?.day !== state.situation.day) reject("state.opening.proposal.initialState", "opening day cannot change before confirmation");
  const player = candidate.entities?.[candidate.situation?.playerId];
  const location = candidate.entities?.[candidate.situation?.locationId];
  if (player?.kind !== "character" || player.visibility !== "player"
    || location?.kind !== "location" || location.visibility !== "player") {
    reject("state.opening.proposal.initialState", "opening requires a player-visible protagonist and starting location");
  }
  // A retained thing may be an ability, memory, or obsession in player
  // attributes. Names may be explicitly unknown and forms of address skipped.
  // Do not invent extra required inventory items or force a questionnaire here.
  return state;
}

function createOpeningState({ day = 10 } = {}) {
  revision(day, "state.situation.day");
  return { entities: {}, inventory: [], commitments: {},
    situation: { playerId: null, locationId: null, day },
    opening: { phase: "creating", draft: {}, proposal: null } };
}

function applyOpeningEvent(state, event, { priorState, baseRevision, segmentIds, validateReadyState, adventureId, narration } = {}) {
  validateOpening(state, { validateReadyState });
  if (!state.opening || state.opening.phase === "ready") reject("event", "opening is already ready");
  if (!priorState) throw new TypeError("priorState is required");
  validateOpening(priorState, { validateReadyState });
  if (!priorState.opening || priorState.opening.phase === "ready") reject("event", "opening is already ready");
  if (state.situation.day !== priorState.situation.day) reject("state.situation.day", "opening day cannot change before confirmation");
  revision(baseRevision, "baseRevision");
  if (baseRevision === Number.MAX_SAFE_INTEGER) reject("baseRevision", "cannot advance revision");
  const available = segmentIds instanceof Set ? segmentIds : Array.isArray(segmentIds) ? new Set(segmentIds) : null;
  if (!available) throw new TypeError("segmentIds is required");
  object(event, "event");
  sources(event.sourceSegmentIds, "event.sourceSegmentIds", available);
  const next = structuredClone(state);
  const data = event.data;
  switch (event.type) {
    case "opening.draft":
      fields(data, ["draft"], [], "event.data");
      object(data.draft, "event.data.draft");
      next.opening = { phase: "creating", draft: structuredClone(data.draft), proposal: null };
      break;
    case "opening.withdraw":
      fields(data, [], [], "event.data");
      next.opening = { phase: "creating", draft: next.opening.draft, proposal: null };
      break;
    case "opening.propose": {
      fields(data, ["proposalId", "initialState"], ["initialConditions"], "event.data");
      if (Object.hasOwn(data.initialState || {}, "memoryFragments")) reject("event.data.initialState", "opening proposal cannot supply memory-fragment gameplay");
      const candidate = readyState(data.initialState, validateReadyState, "event.data.initialState");
      for (const entity of Object.values(candidate.entities)) {
        conditions.initializeCharacterConditions(entity, { path: `event.data.initialState.entities.${entity.id}` });
      }
      if (Object.hasOwn(data, "initialConditions")) {
        if (!Array.isArray(data.initialConditions) || data.initialConditions.length > 10000) reject("event.data.initialConditions", "invalid condition collection");
        const priorCandidate = structuredClone(candidate);
        for (const [index, condition] of data.initialConditions.entries()) {
          conditions.applyCharacterConditionEvent(candidate, { type: "condition.add", data: condition, sourceSegmentIds: event.sourceSegmentIds },
            { priorState: priorCandidate, adventureId, baseRevision, narration, path: `event.data.initialConditions[${index}]` });
        }
      }
      next.opening = { phase: "awaiting_confirmation", draft: next.opening.draft,
        proposal: { proposalId: data.proposalId, initialState: candidate,
          summary: { revision: baseRevision + 1, segmentIds: [...event.sourceSegmentIds] } } };
      break;
    }
    case "opening.confirm": {
      // This event is the Agent's interpretation of the current player's intent.
      // The reducer enforces provenance and ordering, not natural-language consent.
      fields(data, ["proposalId"], [], "event.data");
      const previous = priorState.opening;
      const current = state.opening;
      if (previous?.phase !== "awaiting_confirmation" || current.phase !== "awaiting_confirmation"
        || previous.proposal.summary.revision > baseRevision
        || current.proposal.summary.revision > baseRevision
        || data.proposalId !== previous.proposal.proposalId
        || JSON.stringify(current) !== JSON.stringify(previous)) {
        reject("event", "confirmation requires the unchanged proposal from a previously committed summary");
      }
      const proposal = previous.proposal;
      const confirmed = readyState(proposal.initialState, validateReadyState, "state.opening.proposal.initialState");
      if (priorState.memoryFragments) confirmed.memoryFragments = structuredClone(priorState.memoryFragments);
      confirmed.opening = { phase: "ready", draft: {}, proposal: null, confirmation: {
        proposalId: proposal.proposalId, summaryRevision: proposal.summary.revision,
        summarySegmentIds: [...proposal.summary.segmentIds], revision: baseRevision + 1,
        sourceSegmentIds: [...event.sourceSegmentIds],
      } };
      validateOpening(confirmed, { validateReadyState });
      return confirmed;
    }
    default:
      reject("event.type", "unsupported opening event");
  }
  validateOpening(next, { validateReadyState });
  return next;
}

module.exports = { createOpeningState, validateOpening, applyOpeningEvent };
