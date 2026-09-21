"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateInitialState, applyTurnBundle, projectPlayerState } = require("./turn-model");
const { createOpeningState } = require("./session-opening");
const { initialState, borrowBundle } = require("./test-fixtures/turn-samples");

function offer(candidateId = "extreme1") {
  return { candidateId, characterId: "p", intentReason: "合成角色提出终止自身旅程。",
    fictionalContext: "这是本地合成游戏中虚构角色的决定，不是现实人物的行动。" };
}
function ordinaryOffer(candidateId = "ordinary1") {
  return { candidateId, closureReason: "旅程告一段落。", closedThreads: ["告别已完成。"], intentionalOpenThreads: [], finaleTone: "平静" };
}
function bundle(type, data = { candidateId: "extreme1" }, segmentId = "s", text = "角色与同伴继续交谈。") {
  return { narration: [{ id: segmentId, text }],
    events: type ? [{ id: "e", type, sourceSegmentIds: [segmentId], data }] : [], experiences: [] };
}
// Hand-authored committed states, independently specifying expected provenance.
function pending(count = 0) {
  const state = initialState();
  return { ...state, finale: { phase: "candidate_pending", candidate: {
    ...offer(), kind: "extreme", proposal: { revision: 2, segmentIds: ["proposal"] },
    confirmations: Array.from({ length: count }, (_, index) => ({ revision: 3 + index, sourceSegmentIds: [`answer${index + 1}`] })),
  }, lastDeclined: null, confirmation: null } };
}
function confirmed(outcome = "standard_extreme_ending") {
  return { ...pending(3), finale: { ...pending(3).finale, phase: "confirmed", confirmation: {
    candidateId: "extreme1", proposalRevision: 2, proposalSegmentIds: ["proposal"], revision: 5,
    sourceSegmentIds: ["answer3"], outcome,
  } } };
}
function reservation(outcome = "standard_extreme_ending", overrides = {}) {
  return { actionId: "third-answer", baseRevision: 4, candidateId: "extreme1", outcome, ...overrides };
}
function invalid(run) {
  assert.throws(run, (error) => error.code === "TURN_VALIDATION_FAILED" && Array.isArray(error.issues));
}

test("extreme proposal belongs to the current character and engine-recorded asking passage", () => {
  const state = initialState();
  const input = bundle("extreme.propose", offer(), "proposal");
  const before = structuredClone({ state, input });
  const result = applyTurnBundle(state, input, { baseRevision: 1 });
  const expected = pending();
  assert.deepEqual(result.state, expected);
  assert.deepEqual(result.bundle, input);
  assert.deepEqual({ state, input }, before);
  result.state.finale.candidate.intentReason = "修改输出";
  assert.equal(input.events.find((event) => event.type === "extreme.propose").data.intentReason, offer().intentReason);
  for (const characterId of ["npc", "secret", "rice", "missing"]) {
    invalid(() => applyTurnBundle(state, bundle("extreme.propose", { ...offer(), characterId }), { baseRevision: 1 }));
  }
});

test("first and second confirmations record distinct committed revisions without ending ordinary play", () => {
  const state = pending();
  const first = bundle("extreme.confirm", undefined, "answer1");
  first.events.push({ id: "day", type: "situation.update", sourceSegmentIds: ["answer1"], data: { day: 11 } });
  const one = applyTurnBundle(state, first, { baseRevision: 2 }).state;
  assert.deepEqual(one.finale, pending(1).finale);
  assert.equal(one.situation.day, 11);
  assert.deepEqual(state, pending());
  // Intermediate ordinary turns do not reset the candidate or invent another
  // confirmation. JSON reopening keeps the first committed decision intact.
  const reopened = validateInitialState(JSON.parse(JSON.stringify(one)));
  const unchanged = applyTurnBundle(reopened, bundle(null), { baseRevision: 3 }).state;
  assert.deepEqual(unchanged, reopened);
  const two = applyTurnBundle(unchanged, bundle("extreme.confirm", undefined, "answer2"), { baseRevision: 4 }).state;
  assert.deepEqual(two.finale.candidate.confirmations, [
    { revision: 3, sourceSegmentIds: ["answer1"] }, { revision: 5, sourceSegmentIds: ["answer2"] },
  ]);
  assert.equal(two.finale.phase, "candidate_pending");
  assert.equal(two.finale.confirmation, null);
});

test("third confirmation atomically retains final prose, consequences and either engine-reserved outcome", () => {
  for (const outcome of ["grey_crow_view", "standard_extreme_ending"]) {
    const state = { ...applyTurnBundle(initialState(), borrowBundle()).state, finale: pending(2).finale };
    const input = bundle("extreme.confirm", undefined, "answer3", "这段虚构旅程在此结束。未归还的借米承诺仍留在故事中。");
    input.events.unshift({ id: "day", type: "situation.update", sourceSegmentIds: ["answer3"], data: { day: 11 } });
    const token = reservation(outcome, { terminalId: "terminal1", createdAt: "2026-09-10T00:00:00Z", status: "reserved", committedRevision: null });
    const before = structuredClone({ state, input, token });
    const result = applyTurnBundle(state, input, { baseRevision: 4, terminalReservation: token });
    assert.deepEqual(result.state.finale, confirmed(outcome).finale);
    assert.deepEqual(result.bundle, input);
    assert.equal(result.state.situation.day, 11);
    assert.equal(result.state.commitments["rice-promise"].status, "open");
    assert.deepEqual({ state, input, token }, before);
    assert.deepEqual(validateInitialState(JSON.parse(JSON.stringify(result.state))), result.state);
    assert.doesNotMatch(JSON.stringify(result.bundle), /outcome|terminalId|createdAt|committedRevision/);
    assert.doesNotMatch(JSON.stringify(result.state), /terminalId|createdAt|committedRevision/);
  }
});

test("cancelling any pending stage preserves its provenance and allows a fresh different candidate", () => {
  for (const count of [0, 1, 2]) {
    const state = pending(count);
    const result = applyTurnBundle(state, bundle("extreme.cancel", undefined, "cancel"), { baseRevision: 2 + count }).state;
    assert.deepEqual(result.finale, { phase: "idle", candidate: null, confirmation: null,
      lastDeclined: { candidate: state.finale.candidate, decision: { revision: 3 + count, sourceSegmentIds: ["cancel"] } } });
    assert.deepEqual(result.inventory, state.inventory);
    invalid(() => applyTurnBundle(result, bundle("extreme.propose", offer()), { baseRevision: 3 + count }));
    const next = applyTurnBundle(result, bundle("extreme.propose", offer("extreme2")), { baseRevision: 3 + count }).state;
    assert.equal(next.finale.candidate.candidateId, "extreme2");
    assert.deepEqual(next.finale.candidate.confirmations, []);
    assert.deepEqual(next.finale.lastDeclined, result.finale.lastDeclined);
    assert.equal(applyTurnBundle(result, bundle("finale.propose", ordinaryOffer()), { baseRevision: 3 + count }).state.finale.candidate.candidateId, "ordinary1");
  }
});

test("normal and extreme decisions are mutually exclusive in state and across the whole event list", () => {
  const ordinary = { ...initialState(), finale: { phase: "candidate_pending", candidate: {
    ...ordinaryOffer(), proposal: { revision: 2, segmentIds: ["ask"] } }, lastDeclined: null, confirmation: null } };
  for (const type of ["finale.confirm", "finale.decline"]) {
    invalid(() => applyTurnBundle(pending(), bundle(type), { baseRevision: 2 }));
  }
  for (const type of ["extreme.confirm", "extreme.cancel"]) {
    invalid(() => applyTurnBundle(ordinary, bundle(type, { candidateId: "ordinary1" }), { baseRevision: 2 }));
  }
  invalid(() => applyTurnBundle(ordinary, bundle("extreme.propose", offer()), { baseRevision: 2 }));
  invalid(() => applyTurnBundle(pending(), bundle("finale.propose", ordinaryOffer()), { baseRevision: 2 }));
  const cancelAndPropose = bundle("extreme.cancel");
  cancelAndPropose.events.push({ id: "next", type: "finale.propose", sourceSegmentIds: ["s"], data: ordinaryOffer() });
  invalid(() => applyTurnBundle(pending(), cancelAndPropose, { baseRevision: 2 }));
  const declineAndPropose = bundle("finale.decline", { candidateId: "ordinary1" });
  declineAndPropose.events.push({ id: "next", type: "extreme.propose", sourceSegmentIds: ["s"], data: offer() });
  invalid(() => applyTurnBundle(ordinary, declineAndPropose, { baseRevision: 2 }));
});

test("same-turn confirmations, stale bases, unknown candidates and final events after the third are rejected", () => {
  const proposeAndConfirm = bundle("extreme.propose", offer());
  proposeAndConfirm.events.push({ id: "confirm", type: "extreme.confirm", sourceSegmentIds: ["s"], data: { candidateId: "extreme1" } });
  invalid(() => applyTurnBundle(initialState(), proposeAndConfirm, { baseRevision: 1 }));
  for (const count of [0, 1, 2]) {
    const opts = { baseRevision: 2 + count, ...(count === 2 ? { terminalReservation: reservation() } : {}) };
    const double = bundle("extreme.confirm");
    double.events.push({ ...double.events.find((event) => event.type === "extreme.confirm"), id: "again" });
    invalid(() => applyTurnBundle(pending(count), double, opts));
    invalid(() => applyTurnBundle(pending(count), bundle("extreme.confirm", { candidateId: "other" }), opts));
    invalid(() => applyTurnBundle(pending(count), bundle("extreme.confirm"), { ...opts, baseRevision: 1 + count }));
  }
  const late = bundle("extreme.confirm");
  late.events.push({ id: "late", type: "situation.update", sourceSegmentIds: ["s"], data: { day: 11 } });
  invalid(() => applyTurnBundle(pending(2), late, { baseRevision: 4, terminalReservation: reservation() }));
  invalid(() => applyTurnBundle(pending(), bundle("extreme.confirm")));
});

test("the third result cannot be supplied or selected by model events or an unrelated reservation", () => {
  const input = bundle("extreme.confirm");
  for (const token of [undefined, null, [], {}, reservation("invented"), reservation("grey_crow_view", { actionId: "constructor" }),
    reservation("grey_crow_view", { baseRevision: 3 }), reservation("grey_crow_view", { candidateId: "other" })]) {
    invalid(() => applyTurnBundle(pending(2), input, { baseRevision: 4, terminalReservation: token }));
  }
  for (const extra of [{ outcome: "grey_crow_view" }, { probability: 1 }, { confirmation: 3 }, { terminalReservation: reservation() }]) {
    invalid(() => applyTurnBundle(pending(2), bundle("extreme.confirm", { candidateId: "extreme1", ...extra }), {
      baseRevision: 4, terminalReservation: reservation(),
    }));
  }
  // The durable store verifies this ID against its real action/attempt. The
  // pure reducer does not claim to authenticate arbitrary engine records.
  assert.equal(applyTurnBundle(pending(2), input, { baseRevision: 4, terminalReservation: reservation() }).state.finale.confirmation.outcome, "standard_extreme_ending");
});

test("reservations cannot accompany early confirmations, cancellation or unrelated ordinary turns", () => {
  for (const [state, input] of [
    [initialState(), bundle("extreme.propose", offer())], [pending(), bundle("extreme.confirm")],
    [pending(1), bundle("extreme.confirm")], [pending(2), bundle("extreme.cancel")],
    [pending(2), bundle(null)], [initialState(), borrowBundle()],
    [initialState(), bundle("finale.propose", ordinaryOffer())],
  ]) invalid(() => applyTurnBundle(state, input, { baseRevision: 4, terminalReservation: reservation() }));
});

test("stored special state has exact fields, ordered provenance and exactly three final confirmations", () => {
  const mutations = [
    (s) => { s.finale.candidate.kind = "ordinary"; },
    (s) => { s.finale.candidate.characterId = "npc"; },
    (s) => { s.finale.candidate.intentReason = " "; },
    (s) => { s.finale.candidate.intentReason = "长".repeat(1601); },
    (s) => { s.finale.candidate.fictionalContext = ""; },
    (s) => { s.finale.candidate.fictionalContext = "长".repeat(4001); },
    (s) => { s.finale.candidate.probability = 1; },
    (s) => { s.finale.candidate.confirmations[0].revision = 2; },
    (s) => { s.finale.candidate.confirmations[1].revision = 3; },
    (s) => { s.finale.candidate.confirmations[0].revision = 2.5; },
    (s) => { s.finale.candidate.confirmations[0].sourceSegmentIds = []; },
    (s) => { s.finale.candidate.confirmations[0].sourceSegmentIds = ["s", "s"]; },
    (s) => { s.finale.candidate.confirmations[0].outcome = "grey_crow_view"; },
    (s) => { s.finale.candidate.confirmations.pop(); },
    (s) => { s.finale.candidate.confirmations.push({ revision: 6, sourceSegmentIds: ["four"] }); },
    (s) => { s.finale.confirmation.outcome = "other"; },
    (s) => { delete s.finale.confirmation.outcome; },
    (s) => { s.finale.confirmation.revision = 6; },
    (s) => { s.finale.confirmation.sourceSegmentIds = ["invented"]; },
  ];
  for (const mutate of mutations) { const state = confirmed(); mutate(state); invalid(() => validateInitialState(state)); }
  invalid(() => validateInitialState(pending(3)));
  const cancelled = { ...initialState(), finale: { phase: "idle", candidate: null, confirmation: null,
    lastDeclined: { candidate: pending(2).finale.candidate, decision: { revision: 4, sourceSegmentIds: ["cancel"] } } } };
  invalid(() => validateInitialState(cancelled));
  cancelled.finale.lastDeclined.candidate = pending(3).finale.candidate;
  cancelled.finale.lastDeclined.decision.revision = 6;
  invalid(() => validateInitialState(cancelled));
});

test("model-supplied lifecycle fields and unsafe options never invoke accessors", () => {
  for (const extra of [{ kind: "extreme" }, { confirmations: [] }, { proposal: { revision: 2, segmentIds: ["s"] } }]) {
    invalid(() => applyTurnBundle(initialState(), bundle("extreme.propose", { ...offer(), ...extra }), { baseRevision: 1 }));
  }
  let invoked = 0;
  const getter = () => { invoked++; return reservation(); };
  const options = { baseRevision: 4 };
  Object.defineProperty(options, "terminalReservation", { enumerable: true, get: getter });
  invalid(() => applyTurnBundle(pending(2), bundle("extreme.confirm"), options));
  const token = reservation();
  Object.defineProperty(token, "outcome", { enumerable: true, get: getter });
  invalid(() => applyTurnBundle(pending(2), bundle("extreme.confirm"), { baseRevision: 4, terminalReservation: token }));
  const hostile = pending();
  Object.defineProperty(hostile.finale.candidate, "fictionalContext", { enumerable: true, get: getter });
  invalid(() => validateInitialState(hostile));
  invalid(() => applyTurnBundle(initialState(), bundle(null), { baseRevision: 0, outcome: "grey_crow_view" }));
  assert.equal(invoked, 0);
});

test("special candidates require a previously confirmed opening and cannot be smuggled into its proposed world", () => {
  const empty = createOpeningState();
  invalid(() => applyTurnBundle(empty, bundle("extreme.propose", offer()), { baseRevision: 0 }));
  const awaiting = applyTurnBundle(empty, bundle("opening.propose", { proposalId: "role", initialState: initialState() }), { baseRevision: 0 }).state;
  const both = bundle("opening.confirm", { proposalId: "role" });
  both.events.push({ id: "next", type: "extreme.propose", sourceSegmentIds: ["s"], data: offer() });
  invalid(() => applyTurnBundle(awaiting, both, { baseRevision: 1 }));
  invalid(() => applyTurnBundle(empty, bundle("opening.propose", { proposalId: "role", initialState: pending() }), { baseRevision: 0 }));
});

test("player state discloses no special route, internal evidence, progress count or outcome", () => {
  for (const state of [pending(), pending(1), pending(2), confirmed("grey_crow_view"), confirmed()]) {
    const view = projectPlayerState(state);
    const { outcome, ...publicConfirmation } = state.finale.confirmation || {};
    assert.deepEqual(view.finale, { phase: state.finale.phase,
      candidate: { candidateId: "extreme1", proposal: { revision: 2, segmentIds: ["proposal"] } },
      confirmation: state.finale.confirmation ? publicConfirmation : null });
    assert.doesNotMatch(JSON.stringify(view.finale), /"kind"|"characterId"|"intentReason"|"fictionalContext"|"confirmations"|"outcome"|grey_crow_view|standard_extreme_ending|lastDeclined/);
    view.finale.candidate.proposal.segmentIds.push("changed");
    assert.deepEqual(state.finale.candidate.proposal.segmentIds, ["proposal"]);
  }
});

test("text without a finale event never advances the special decision and confirmed stories cannot accept another bundle", () => {
  // Synthetic text verifies absence of engine keyword automation only. Actual
  // interpretation of uncertainty, consent and fiction needs model playtests.
  for (const text of ["我还没决定。", "Yes, but I want to keep playing.", "確定という意味ではありません。", "我第三次确认。 "]) {
    const expected = pending(2);
    assert.deepEqual(applyTurnBundle(pending(2), bundle(null, null, "s", text), { baseRevision: 4 }).state, expected);
  }
  for (const type of [null, "extreme.confirm", "extreme.cancel", "finale.propose"]) {
    invalid(() => applyTurnBundle(confirmed(), bundle(type), { baseRevision: 5 }));
  }
});
