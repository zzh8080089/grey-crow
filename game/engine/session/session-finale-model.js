"use strict";

// Internal pure rules. turn-model supplies safe JSON and validates the event's
// narration references. A confirmed decision is a story fact; chapter creation
// and archive sealing are separate durable operations, never another turn.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const EMPTY = Object.freeze({ phase: "idle", candidate: null, lastDeclined: null, confirmation: null });
const EXTREME_OUTCOMES = ["grey_crow_view", "standard_extreme_ending"];
function referencePrecedes(left, right) { return left.revision < right.revision; }
function referenceRevision(value) { return value.revision; }

function reject(path, reason) {
  const error = new Error(`${path}: ${reason}`);
  error.code = "TURN_VALIDATION_FAILED";
  error.reason = "INVALID_FINALE_STATE";
  error.issues = [error.message];
  throw error;
}

function fields(value, required, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(path, "must be an object");
  if (required.some((key) => !Object.hasOwn(value, key))) reject(path, "required field is missing");
  if (Object.keys(value).some((key) => !required.includes(key))) reject(path, "unknown field");
}
function identifier(value, path) {
  if (typeof value !== "string" || !ID.test(value) || FORBIDDEN.has(value)) reject(path, "invalid ID");
}
function revision(value, path, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) reject(path, "invalid revision");
}
function text(value, maximum, path) {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > maximum) reject(path, "invalid text or size");
}
function strings(values, minimum, maximum, path, check) {
  if (!Array.isArray(values) || values.length < minimum || values.length > maximum) reject(path, "invalid list size");
  const seen = new Set();
  for (const value of values) {
    check(value, path);
    if (seen.has(value)) reject(path, "duplicate value");
    seen.add(value);
  }
}
function sources(values, path) { strings(values, 1, 256, path, identifier); }
const CANDIDATE_FIELDS = ["candidateId", "closureReason", "closedThreads", "intentionalOpenThreads", "finaleTone"];
function ordinaryCandidate(value, path, stored = true) {
  fields(value, [...CANDIDATE_FIELDS, ...(stored ? ["proposal"] : [])], path);
  identifier(value.candidateId, `${path}.candidateId`);
  text(value.closureReason, 1600, `${path}.closureReason`);
  text(value.finaleTone, 240, `${path}.finaleTone`);
  strings(value.closedThreads, 1, 8, `${path}.closedThreads`, (entry, at) => text(entry, 800, at));
  strings(value.intentionalOpenThreads, 0, 8, `${path}.intentionalOpenThreads`, (entry, at) => text(entry, 800, at));
  if (stored) proposal(value.proposal, `${path}.proposal`);
}
function proposal(value, path) {
  fields(value, ["revision", "segmentIds"], path);
  revision(value.revision, `${path}.revision`);
  sources(value.segmentIds, `${path}.segmentIds`);
}
function decision(value, path) {
  fields(value, ["revision", "sourceSegmentIds"], path);
  revision(value.revision, `${path}.revision`);
  sources(value.sourceSegmentIds, `${path}.sourceSegmentIds`);
}
function extremeCandidate(value, path, state, stored = true) {
  fields(value, ["candidateId", "characterId", "intentReason", "fictionalContext",
    ...(stored ? ["kind", "proposal", "confirmations"] : [])], path);
  identifier(value.candidateId, `${path}.candidateId`);
  identifier(value.characterId, `${path}.characterId`);
  if (value.characterId !== state.situation?.playerId || state.entities?.[value.characterId]?.kind !== "character") {
    reject(`${path}.characterId`, "must reference the current player character");
  }
  // These are bounded narrative evidence, not a semantic proof of fictional
  // context or consent. No keyword, probability or outcome is inferred here.
  text(value.intentReason, 1600, `${path}.intentReason`);
  text(value.fictionalContext, 4000, `${path}.fictionalContext`);
  if (stored) {
    if (value.kind !== "extreme") reject(`${path}.kind`, "invalid candidate kind");
    proposal(value.proposal, `${path}.proposal`);
    if (!Array.isArray(value.confirmations) || value.confirmations.length > 3) reject(`${path}.confirmations`, "invalid confirmation count");
    let previous = value.proposal;
    value.confirmations.forEach((confirmation, index) => {
      const at = `${path}.confirmations[${index}]`;
      decision(confirmation, at);
      if (!referencePrecedes(previous, confirmation)) reject(at, "confirmation must follow a separate committed turn");
      previous = confirmation;
    });
  }
}
function candidate(value, path, state) {
  if (value?.kind === "extreme") extremeCandidate(value, path, state);
  else ordinaryCandidate(value, path);
}
function latestCandidateRevision(value) {
  return value.kind === "extreme" && value.confirmations.length
    ? referenceRevision(value.confirmations.at(-1)) : referenceRevision(value.proposal);
}
function latestCandidateReference(value) { return value.kind === "extreme" && value.confirmations.length ? value.confirmations.at(-1) : value.proposal; }

function validateFinale(state) {
  if (!Object.hasOwn(state, "finale")) return state;
  if (state.opening && state.opening.phase !== "ready") reject("state.finale", "finale requires confirmed opening");
  const finale = state.finale;
  fields(finale, ["phase", "candidate", "lastDeclined", "confirmation"], "state.finale");
  if (!["idle", "candidate_pending", "confirmed"].includes(finale.phase)) reject("state.finale.phase", "invalid finale phase");
  if (finale.lastDeclined !== null) {
    const declined = finale.lastDeclined;
    fields(declined, ["candidate", "decision"], "state.finale.lastDeclined");
    candidate(declined.candidate, "state.finale.lastDeclined.candidate", state);
    decision(declined.decision, "state.finale.lastDeclined.decision");
    if (declined.candidate.kind === "extreme" && declined.candidate.confirmations.length > 2) reject("state.finale.lastDeclined", "completed candidate cannot be cancelled");
    if (!referencePrecedes(latestCandidateReference(declined.candidate), declined.decision)) reject("state.finale.lastDeclined", "decision must follow the latest candidate confirmation or proposal");
  }
  if (finale.phase === "idle") {
    if (finale.candidate !== null || finale.confirmation !== null) reject("state.finale", "idle finale cannot retain a candidate or confirmation");
    return state;
  }
  candidate(finale.candidate, "state.finale.candidate", state);
  if (finale.lastDeclined && (finale.candidate.candidateId === finale.lastDeclined.candidate.candidateId
    || !referencePrecedes(finale.lastDeclined.decision, finale.candidate.proposal))) {
    reject("state.finale.candidate", "new proposal must follow the declined candidate with a new ID");
  }
  if (finale.phase === "candidate_pending") {
    if (finale.confirmation !== null) reject("state.finale.confirmation", "pending candidate cannot already be confirmed");
    if (finale.candidate.kind === "extreme" && finale.candidate.confirmations.length > 2) reject("state.finale.candidate.confirmations", "third confirmation must complete the finale");
    return state;
  }
  const extreme = finale.candidate.kind === "extreme";
  const confirmation = finale.confirmation;
  fields(confirmation, ["candidateId", "proposalRevision", "proposalSegmentIds", "revision", "sourceSegmentIds",
    ...(extreme ? ["outcome"] : [])], "state.finale.confirmation");
  identifier(confirmation.candidateId, "state.finale.confirmation.candidateId");
  revision(confirmation.proposalRevision, "state.finale.confirmation.proposalRevision");
  revision(confirmation.revision, "state.finale.confirmation.revision");
  sources(confirmation.proposalSegmentIds, "state.finale.confirmation.proposalSegmentIds");
  sources(confirmation.sourceSegmentIds, "state.finale.confirmation.sourceSegmentIds");
  if (confirmation.candidateId !== finale.candidate.candidateId
    || confirmation.proposalRevision !== finale.candidate.proposal.revision
    || JSON.stringify(confirmation.proposalSegmentIds) !== JSON.stringify(finale.candidate.proposal.segmentIds)
    || confirmation.revision <= confirmation.proposalRevision) {
    reject("state.finale.confirmation", "confirmation must reference the earlier unchanged proposal");
  }
  if (extreme && (finale.candidate.confirmations.length !== 3
    || !EXTREME_OUTCOMES.includes(confirmation.outcome)
    || confirmation.revision !== finale.candidate.confirmations.at(-1).revision
    || JSON.stringify(confirmation.sourceSegmentIds) !== JSON.stringify(finale.candidate.confirmations.at(-1).sourceSegmentIds))) {
    reject("state.finale.confirmation", "extreme outcome requires the third confirmation and its exact sources");
  }
  return state;
}

function applyFinaleEvent(state, event, { priorState, baseRevision, terminalReservation } = {}) {
  validateFinale(state);
  validateFinale(priorState);
  // Opening confirmation and ending proposal cannot be smuggled into one turn.
  if ((state.opening && state.opening.phase !== "ready")
    || (priorState.opening && priorState.opening.phase !== "ready")) reject("event", "finale requires previously confirmed opening");
  revision(baseRevision, "baseRevision", 0);
  if (baseRevision === Number.MAX_SAFE_INTEGER) reject("baseRevision", "cannot advance revision");
  const previous = priorState.finale || EMPTY;
  const current = state.finale || EMPTY;
  if (previous.phase === "confirmed") reject("event", "finale decision is already confirmed");
  const extremeEvent = event.type.startsWith("extreme.");
  const terminal = event.type === "extreme.confirm" && previous.phase === "candidate_pending"
    && previous.candidate.kind === "extreme" && previous.candidate.confirmations.length === 2;
  if (terminalReservation !== undefined && !terminal) reject("terminalReservation", "reservation is only valid for the third extreme confirmation");
  if (terminal) {
    // Store checks ownership and action identity against its durable reservation.
    // This pure layer binds only the candidate, revision and engine-owned result.
    if (!terminalReservation || typeof terminalReservation !== "object" || Array.isArray(terminalReservation)) reject("terminalReservation", "third confirmation requires an engine reservation");
    identifier(terminalReservation.actionId, "terminalReservation.actionId");
    if (terminalReservation.baseRevision !== baseRevision
      || terminalReservation.candidateId !== previous.candidate.candidateId
      || !EXTREME_OUTCOMES.includes(terminalReservation.outcome)) reject("terminalReservation", "reservation must match this candidate and revision");
  }
  const next = structuredClone(state);
  const data = event.data;
  if (event.type === "finale.propose" || event.type === "extreme.propose") {
    if (extremeEvent) extremeCandidate(data, "event.data", state, false);
    else ordinaryCandidate(data, "event.data", false);
    if (previous.phase !== "idle" || current.phase !== "idle") reject("event", "proposal requires an idle finale");
    next.finale = { phase: "candidate_pending", candidate: { ...structuredClone(data),
      ...(extremeEvent ? { kind: "extreme", confirmations: [] } : {}),
      proposal: { revision: baseRevision + 1, segmentIds: [...event.sourceSegmentIds] } },
    lastDeclined: structuredClone(current.lastDeclined), confirmation: null };
  } else if (["finale.decline", "finale.confirm", "extreme.cancel", "extreme.confirm"].includes(event.type)) {
    fields(data, ["candidateId"], "event.data");
    identifier(data.candidateId, "event.data.candidateId");
    // Intent interpretation belongs to the Agent reading the new player input.
    // This enforces provenance and ordering, not natural-language consent.
    if (previous.phase !== "candidate_pending" || current.phase !== "candidate_pending"
      || (previous.candidate.kind === "extreme") !== extremeEvent
      || latestCandidateRevision(previous.candidate) > baseRevision
      || data.candidateId !== previous.candidate.candidateId
      || JSON.stringify(current) !== JSON.stringify(previous)) {
      reject("event", "decision requires the unchanged candidate from a previously committed proposal");
    }
    const proposal = previous.candidate.proposal;
    if (event.type === "finale.decline" || event.type === "extreme.cancel") {
      next.finale = { phase: "idle", candidate: null, confirmation: null,
        lastDeclined: { candidate: structuredClone(previous.candidate),
          decision: { revision: baseRevision + 1, sourceSegmentIds: [...event.sourceSegmentIds] } } };
    } else if (extremeEvent && !terminal) {
      next.finale = structuredClone(previous);
      next.finale.candidate.confirmations.push({ revision: baseRevision + 1, sourceSegmentIds: [...event.sourceSegmentIds] });
    } else {
      next.finale = { ...structuredClone(previous), phase: "confirmed", confirmation: {
        candidateId: data.candidateId, proposalRevision: proposal.revision,
        proposalSegmentIds: [...proposal.segmentIds], revision: baseRevision + 1,
        sourceSegmentIds: [...event.sourceSegmentIds],
        ...(extremeEvent ? { outcome: terminalReservation.outcome } : {}),
      } };
      if (extremeEvent) next.finale.candidate.confirmations.push({ revision: baseRevision + 1, sourceSegmentIds: [...event.sourceSegmentIds] });
    }
  } else reject("event.type", "unsupported finale event");
  validateFinale(next);
  return next;
}

module.exports = { validateFinale, applyFinaleEvent };
