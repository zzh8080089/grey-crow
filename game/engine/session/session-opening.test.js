"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createOpeningState, validateOpening, applyOpeningEvent } = require("./session-opening");
const { validateInitialState, applyTurnBundle, projectPlayerState } = require("./turn-model");
const { initialState } = require("./test-fixtures/turn-samples");

const validateReadyState = validateInitialState;
const sourceIds = new Set(["summary", "reply", "opening"]);
function event(type, data, sourceSegmentIds = ["reply"]) {
  return { id: "opening-event", type, sourceSegmentIds, data };
}
function apply(state, value, { priorState = state, baseRevision = 0, segmentIds = sourceIds } = {}) {
  return applyOpeningEvent(state, value, { priorState, baseRevision, segmentIds, validateReadyState });
}
function proposal(state = createOpeningState({ day: 10 }), baseRevision = 2, candidate = initialState()) {
  return apply(state, event("opening.propose", { proposalId: "opening-choice", initialState: candidate }, ["summary"]), { baseRevision });
}
function confirm(state, options = {}) {
  return apply(state, event("opening.confirm", { proposalId: "opening-choice" }, ["opening"]), { baseRevision: 3, ...options });
}
function rejects(operation) { assert.throws(operation, { code: "TURN_VALIDATION_FAILED" }); }

test("content confirmation creates an empty draft without inventing a formal protagonist or location", () => {
  const state = createOpeningState({ day: 10 });
  assert.deepEqual(state, { entities: {}, inventory: [], commitments: {},
    situation: { playerId: null, locationId: null, day: 10 },
    opening: { phase: "creating", draft: {}, proposal: null } });
  assert.equal(validateOpening(state), state);
  rejects(() => apply(state, event("opening.confirm", { proposalId: "menu-confirmation" })));
});

test("draft updates preserve natural anchors without forcing a questionnaire or writing world facts", () => {
  const original = createOpeningState();
  const first = apply(original, event("opening.draft", { draft: { identity: "姓名未知，曾修理自行车", formOfAddress: null } }));
  const secondDraft = { ...first.opening.draft, keepsake: "方向感：在废墟中记住回去的路", startingLocation: "老里弄" };
  const second = apply(first, event("opening.draft", { draft: secondDraft }), { baseRevision: 1 });
  assert.deepEqual(second.opening.draft, secondDraft);
  assert.deepEqual(second.entities, {});
  assert.deepEqual(second.inventory, []);
  assert.equal(second.situation.playerId, null);
  assert.deepEqual(original.opening.draft, {});
  secondDraft.identity = "外部变更";
  assert.equal(second.opening.draft.identity, "姓名未知，曾修理自行车");
});

test("a proposal stores the complete candidate and summary provenance while official state stays empty", () => {
  const draft = apply(createOpeningState(), event("opening.draft", { draft: { keepsake: "一本旧日记" } }));
  const candidate = initialState();
  const awaiting = proposal(draft, 2, candidate);
  assert.equal(awaiting.opening.phase, "awaiting_confirmation");
  assert.deepEqual(awaiting.opening.proposal.summary, { revision: 3, segmentIds: ["summary"] });
  const expected = structuredClone(candidate);
  for (const entity of Object.values(expected.entities)) if (entity.kind === "character") entity.conditionRecords = { format: "body-conditions-1", items: [] };
  assert.deepEqual(awaiting.opening.proposal.initialState, expected);
  assert.equal(Object.hasOwn(candidate.entities.p, "conditionRecords"), false);
  assert.deepEqual(awaiting.opening.draft, draft.opening.draft);
  assert.deepEqual(awaiting.entities, {});
  assert.equal(awaiting.situation.locationId, null);
  candidate.entities.p.name = "不应污染候选";
  assert.equal(awaiting.opening.proposal.initialState.entities.p.name, "玩家");
});

test("confirmation copies only the already-saved candidate and records both source revisions", () => {
  const awaiting = proposal();
  const savedCandidate = structuredClone(awaiting.opening.proposal.initialState);
  const ready = confirm(awaiting);
  assert.deepEqual({ entities: ready.entities, inventory: ready.inventory, commitments: ready.commitments, situation: ready.situation }, savedCandidate);
  assert.deepEqual(ready.opening, { phase: "ready", draft: {}, proposal: null, confirmation: {
    proposalId: "opening-choice", summaryRevision: 3, summarySegmentIds: ["summary"], revision: 4, sourceSegmentIds: ["opening"],
  } });
  assert.equal(awaiting.opening.phase, "awaiting_confirmation");
  rejects(() => apply(awaiting, event("opening.confirm", { proposalId: "opening-choice", initialState: initialState() }), { baseRevision: 3 }));
});

test("candidate and confirmed facts use the ready validator's normalized copy", () => {
  const candidate = initialState();
  candidate.inventory.push({ ownerId: "p", itemId: "rice", quantity: 0 });
  const awaiting = proposal(undefined, 2, candidate);
  assert.equal(candidate.inventory.length, 3, "caller candidate is unchanged");
  assert.equal(awaiting.opening.proposal.initialState.inventory.length, 2);
  const restored = structuredClone(awaiting);
  restored.opening.proposal.initialState.inventory.push({ ownerId: "p", itemId: "rice", quantity: 0 });
  assert.equal(confirm(restored).inventory.length, 2);
  assert.equal(restored.opening.proposal.initialState.inventory.length, 3);
});

test("a symbolic retained thing remains player attributes rather than a fabricated inventory item", () => {
  const candidate = initialState();
  candidate.entities.p.name = "姓名未知";
  candidate.entities.p.attributes = { keepsake: "一个必须找到妹妹的执念", formOfAddress: "跳过" };
  candidate.inventory = [];
  const ready = confirm(proposal(undefined, 2, candidate));
  assert.equal(ready.entities.p.attributes.keepsake, "一个必须找到妹妹的执念");
  assert.deepEqual(ready.inventory, []);
  assert.equal(ready.entities.p.name, "姓名未知");
});

test("proposing and confirming in one result is rejected even when an Agent labels it confirmed", () => {
  const prior = createOpeningState();
  const sameTurnProposal = proposal(prior, 0);
  rejects(() => confirm(sameTurnProposal, { priorState: prior, baseRevision: 0 }));
  rejects(() => confirm(sameTurnProposal, { priorState: prior, baseRevision: 1 }));
  rejects(() => confirm(sameTurnProposal, { priorState: sameTurnProposal, baseRevision: 0 }));
});

test("a different, edited, or replaced proposal cannot consume the previous summary confirmation", () => {
  const prior = proposal();
  rejects(() => apply(prior, event("opening.confirm", { proposalId: "another-choice" }), { baseRevision: 3 }));
  const edited = apply(prior, event("opening.draft", { draft: { startingLocation: "改去仓库" } }), { baseRevision: 3 });
  rejects(() => confirm(edited, { priorState: prior }));
  const replacement = proposal(edited, 3);
  rejects(() => confirm(replacement, { priorState: prior }));
  const tampered = structuredClone(prior);
  tampered.opening.proposal.initialState.entities.p.name = "另一个人";
  rejects(() => confirm(tampered, { priorState: prior }));
});

test("withdrawal keeps conversational anchors and invalidates confirmation without deleting the adventure", () => {
  const draft = apply(createOpeningState(), event("opening.draft", { draft: { identity: "修车人" } }));
  const awaiting = proposal(draft);
  const withdrawn = apply(awaiting, event("opening.withdraw", {}), { baseRevision: 3 });
  assert.deepEqual(withdrawn.opening, { phase: "creating", draft: { identity: "修车人" }, proposal: null });
  assert.deepEqual(withdrawn.entities, {});
  rejects(() => confirm(withdrawn));
  const newProposal = proposal(withdrawn, 4);
  assert.equal(confirm(newProposal, { baseRevision: 5 }).opening.phase, "ready");
});

test("summary and confirmation citations must point to actual current narration segments", () => {
  const state = createOpeningState();
  rejects(() => apply(state, event("opening.propose", { proposalId: "p", initialState: initialState() }, ["not-in-narration"])));
  rejects(() => apply(state, event("opening.propose", { proposalId: "p", initialState: initialState() }, ["summary", "summary"])));
  rejects(() => apply(state, event("opening.draft", { draft: {} }, [])));
  rejects(() => confirm(proposal(), { segmentIds: ["summary"] }));
});

test("candidates require valid visible identities and the locked initial day without recursive opening", () => {
  for (const change of [
    (candidate) => { candidate.opening = createOpeningState().opening; },
    (candidate) => { candidate.situation.playerId = "missing"; },
    (candidate) => { candidate.entities.p.visibility = "hidden"; },
    (candidate) => { candidate.entities.home.visibility = "hidden"; },
    (candidate) => { candidate.situation.day = 11; },
  ]) {
    const candidate = initialState(); change(candidate);
    rejects(() => proposal(undefined, 2, candidate));
  }
  const original = createOpeningState();
  const changedDay = createOpeningState({ day: 11 });
  rejects(() => apply(changedDay, event("opening.draft", { draft: {} }), { priorState: original }));
});

test("an unconfirmed snapshot cannot contain a partly initialized official state", () => {
  for (const change of [
    (state) => { state.entities = initialState().entities; },
    (state) => { state.situation.playerId = "p"; },
    (state) => { state.situation.locationId = "home"; },
    (state) => { state.inventory = [{ ownerId: "p", itemId: "rice", quantity: 0 }]; },
    (state) => { state.commitments = { invented: {} }; },
  ]) {
    const state = createOpeningState(); change(state);
    rejects(() => validateOpening(state, { validateReadyState }));
  }
});

test("ready states and prior ready snapshots cannot be reset through opening events", () => {
  for (const ready of [initialState(), confirm(proposal())]) {
    assert.equal(validateOpening(ready, { validateReadyState }), ready);
    rejects(() => apply(ready, event("opening.draft", { draft: {} })));
    rejects(() => apply(createOpeningState(), event("opening.draft", { draft: {} }), { priorState: ready }));
  }
  const malformed = confirm(proposal());
  malformed.opening.confirmation.summaryRevision = malformed.opening.confirmation.revision;
  rejects(() => validateOpening(malformed, { validateReadyState }));
});

test("current turn model enforces the proposal boundary and hides candidate hidden facts from player projection", () => {
  const empty = createOpeningState();
  const proposed = { narration: [{ id: "summary", text: "你是修车人，唯一带着记住旧路的本领，准备从老里弄开始。确认、修改，还是取消？" }],
    events: [event("opening.propose", { proposalId: "opening-choice", initialState: initialState() }, ["summary"])], experiences: [] };
  const awaiting = applyTurnBundle(empty, proposed, { baseRevision: 0 }).state;
  const projection = projectPlayerState(awaiting);
  assert.equal(projection.opening.phase, "awaiting_confirmation");
  assert.equal(projection.opening.proposal.initialState, undefined);
  assert.deepEqual(projection.entities, {});
  const combined = structuredClone(proposed);
  combined.events.push({ ...event("opening.confirm", { proposalId: "opening-choice" }, ["summary"]), id: "confirm-event" });
  rejects(() => applyTurnBundle(empty, combined, { baseRevision: 0 }));
  const finalized = { narration: [{ id: "opening", text: "你确认采用眼前的设定。楼道外传来水桶磕碰的声音，你可以走出去看看。" }],
    events: [event("opening.confirm", { proposalId: "opening-choice" }, ["opening"])], experiences: [] };
  assert.equal(applyTurnBundle(awaiting, finalized, { baseRevision: 1 }).state.opening.phase, "ready");
});

function conditionProposal() {
  return { narration: [{ id: "summary", text: "你右手有一处擦伤，已止血。" },
    { id: "limits", text: "你说握杯时仍疼，原因不明。" }], experiences: [], events: [event("opening.propose", {
    proposalId: "body-opening", initialState: initialState(), initialConditions: [
      { characterId: "p", basis: "observed", text: "右手擦伤，已止血", evidence: [{ segmentId: "summary", quote: "右手有一处擦伤，已止血。" }] },
      { characterId: "p", basis: "self_report", text: "握杯时仍疼，原因不明", evidence: [{ segmentId: "limits", quote: "握杯时仍疼，原因不明。" }] },
    ],
  }, ["summary", "limits"])] };
}

test("initial condition evidence is compiled at proposal revision and confirmed verbatim later", () => {
  const state = createOpeningState(); const candidate = conditionProposal();
  const before = structuredClone({ state, candidate });
  const pending = applyTurnBundle(state, candidate, { baseRevision: 2, adventureId: "opening-adventure" }).state;
  assert.deepEqual({ state, candidate }, before);
  const records = pending.opening.proposal.initialState.entities.p.conditionRecords;
  assert.equal(records.items.length, 2);
  assert.equal(records.items[0].sources[0].revision, 3);
  assert.equal(records.items[1].sources[0].segmentId, "limits");
  for (const entity of Object.values(pending.opening.proposal.initialState.entities)) {
    if (entity.kind === "character" && entity.id !== "p") assert.deepEqual(entity.conditionRecords, { format: "body-conditions-1", items: [] });
  }
  const confirmation = { narration: [{ id: "opening", text: "你确认了开局，随后听见楼道外有人走动。" }], experiences: [],
    events: [event("opening.confirm", { proposalId: "body-opening" }, ["opening"])] };
  const ready = applyTurnBundle(pending, confirmation, { baseRevision: 3, adventureId: "opening-adventure" }).state;
  assert.deepEqual(ready.entities.p.conditionRecords, records);
  assert.deepEqual(ready.opening.confirmation.summarySegmentIds, ["summary", "limits"]);
  assert.equal(ready.opening.confirmation.revision, 4);
  assert.equal(ready.entities.p.conditionRecords.items[0].sources[0].revision, 3, "confirmation is not the source of the original physical evidence");
  rejects(() => applyTurnBundle(pending, { ...confirmation, events: [{ ...confirmation.events[0], data: {
    proposalId: "body-opening", initialConditions: candidate.events[0].data.initialConditions,
  } }] }, { baseRevision: 3, adventureId: "opening-adventure" }));
});

test("opening rejects forged records, legacy body writes and unsupported condition sources atomically", () => {
  for (const modify of [
    value => { value.events[0].data.initialState.entities.p.conditionRecords = { format: "body-conditions-1", items: [] }; },
    value => { value.events[0].data.initialState.entities.npc.attributes.status = "健康"; },
    value => { value.events[0].data.initialState.entities.p.attributes.fatigue = "疲惫"; },
    value => { value.events[0].data.initialConditions[0].characterId = "home"; },
    value => { value.events[0].data.initialConditions[0].characterId = "outside"; },
    value => { value.events[0].data.initialConditions[0].evidence[0].quote = "伤势已经痊愈"; },
    value => { value.events[0].data.initialConditions[0].evidence[0].revision = 1; },
    value => { value.events[0].sourceSegmentIds = ["summary"]; },
    value => { value.events[0].data.initialConditions[1].text = ""; },
  ]) {
    const state = createOpeningState(); const candidate = conditionProposal(); modify(candidate);
    const before = structuredClone({ state, candidate });
    rejects(() => applyTurnBundle(state, candidate, { baseRevision: 0, adventureId: "opening-adventure" }));
    assert.deepEqual({ state, candidate }, before);
  }
});
