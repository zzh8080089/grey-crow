"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateInitialState, applyTurnBundle, projectPlayerState } = require("./turn-model");
const { createOpeningState } = require("./session-opening");
const { createTurnGenerator } = require("./turn-generator");
const { initialState, borrowBundle, request } = require("./test-fixtures/turn-samples");

function offerData(candidateId = "ending1") {
  return { candidateId, closureReason: "同行者各自作出了离开或留下的决定。",
    closedThreads: ["共同旅程已经抵达终点。"], intentionalOpenThreads: ["远方的来信仍然没有答案。"], finaleTone: "克制、平静" };
}
function bundle(type, data, text = "你们在晨光中道别。") {
  return { narration: [{ id: "s", text }],
    events: type ? [{ id: "e", type, sourceSegmentIds: ["s"], data }] : [], experiences: [] };
}
function proposedState() {
  const state = initialState();
  state.entities.p.attributes.status = "疲惫，右手已包扎";
  return { ...state, finale: {
    phase: "candidate_pending", candidate: { ...offerData(), proposal: { revision: 2, segmentIds: ["ask"] } },
    lastDeclined: null, confirmation: null,
  } };
}
function confirmedState() {
  const state = proposedState();
  state.finale.phase = "confirmed";
  state.finale.confirmation = { candidateId: "ending1", proposalRevision: 2, proposalSegmentIds: ["ask"],
    revision: 3, sourceSegmentIds: ["last"] };
  return state;
}
function invalid(run) {
  assert.throws(run, (error) => error.code === "TURN_VALIDATION_FAILED" && Array.isArray(error.issues));
}

test("ordinary states stay unchanged and a proposed ending records its actual asking passage", () => {
  const state = initialState();
  const input = bundle("finale.propose", offerData(), "你愿意让这段故事在这里结束吗？");
  const original = structuredClone({ state, input });
  assert.equal(Object.hasOwn(validateInitialState(state), "finale"), false);
  const result = applyTurnBundle(state, input, { baseRevision: 1 });
  assert.deepEqual(result.state.finale, { phase: "candidate_pending", candidate: { ...offerData(),
    proposal: { revision: 2, segmentIds: ["s"] } }, lastDeclined: null, confirmation: null });
  assert.deepEqual({ state, input }, original);
  result.bundle.events.find((event) => event.type === "finale.propose").data.closedThreads[0] = "修改返回值";
  assert.equal(result.state.finale.candidate.closedThreads[0], offerData().closedThreads[0]);
});

test("a later confirmation preserves the candidate and commits real final consequences once", () => {
  const state = proposedState();
  const input = bundle("finale.confirm", { candidateId: "ending1" });
  input.events.unshift({ id: "day", type: "situation.update", sourceSegmentIds: ["s"], data: { day: 11 } });
  const result = applyTurnBundle(state, input, { baseRevision: 2 });
  assert.equal(result.state.situation.day, 11);
  assert.deepEqual(result.state.finale, { ...state.finale, phase: "confirmed", confirmation: {
    candidateId: "ending1", proposalRevision: 2, proposalSegmentIds: ["ask"], revision: 3, sourceSegmentIds: ["s"],
  } });
  assert.equal(state.finale.phase, "candidate_pending");
  assert.equal(state.situation.day, 10);
  assert.deepEqual(result.bundle.narration, input.narration);
  invalid(() => applyTurnBundle(result.state, bundle(null), { baseRevision: 3 }));
  invalid(() => applyTurnBundle(result.state, input, { baseRevision: 3 }));
});

test("a later decline retains its basis and permits ordinary play and a new proposal without a cooldown", () => {
  const state = proposedState();
  const declined = applyTurnBundle(state, bundle("finale.decline", { candidateId: "ending1" }, "你转身走向尚未探过的街道。"), { baseRevision: 2 }).state;
  assert.deepEqual(declined.finale, { phase: "idle", candidate: null, confirmation: null,
    lastDeclined: { candidate: state.finale.candidate, decision: { revision: 3, sourceSegmentIds: ["s"] } } });
  assert.equal(applyTurnBundle(declined, borrowBundle(), { baseRevision: 3 }).state.commitments["rice-promise"].status, "open");
  invalid(() => applyTurnBundle(declined, bundle("finale.propose", offerData()), { baseRevision: 3 }));
  const renewed = applyTurnBundle(declined, bundle("finale.propose", offerData("ending2")), { baseRevision: 3 }).state;
  assert.equal(renewed.finale.candidate.proposal.revision, 4);
  assert.deepEqual(renewed.finale.lastDeclined, declined.finale.lastDeclined);
  // Semantic suitability of reconsideration is an Agent/playtest concern; this
  // proves only that the engine imposes no invented waiting period.
});

test("no finale event means a pending question stays pending and open commitments stay open", () => {
  const borrowed = applyTurnBundle(initialState(), borrowBundle()).state;
  const state = { ...borrowed, finale: proposedState().finale };
  const unchanged = applyTurnBundle(state, bundle(null, null, "你仍在考虑，并未给出答复。"), { baseRevision: 2 }).state;
  const expected = structuredClone(state);
  assert.deepEqual(unchanged, expected);
  const confirmed = applyTurnBundle(state, bundle("finale.confirm", { candidateId: "ending1" }), { baseRevision: 2 }).state;
  assert.equal(confirmed.commitments["rice-promise"].status, "open");
});

test("same-turn decisions, multiple finale events, stale candidates and events after confirmation are rejected", () => {
  const offer = bundle("finale.propose", offerData());
  const finish = { id: "f", type: "finale.confirm", sourceSegmentIds: ["s"], data: { candidateId: "ending1" } };
  invalid(() => applyTurnBundle(initialState(), { ...offer, events: [...offer.events, finish] }, { baseRevision: 1 }));
  for (const type of ["finale.confirm", "finale.decline"]) {
    invalid(() => applyTurnBundle(initialState(), bundle(type, { candidateId: "ending1" }), { baseRevision: 2 }));
    invalid(() => applyTurnBundle(proposedState(), bundle(type, { candidateId: "obsolete" }), { baseRevision: 2 }));
    invalid(() => applyTurnBundle(proposedState(), bundle(type, { candidateId: "ending1" }), { baseRevision: 1 }));
  }
  invalid(() => applyTurnBundle(proposedState(), offer, { baseRevision: 2 }));
  const after = bundle("finale.confirm", { candidateId: "ending1" });
  after.events.push({ id: "late", type: "situation.update", sourceSegmentIds: ["s"], data: { day: 11 } });
  invalid(() => applyTurnBundle(proposedState(), after, { baseRevision: 2 }));
  const two = bundle("finale.decline", { candidateId: "ending1" });
  two.events.push({ ...offer.events.find((event) => event.type === "finale.propose"), id: "new", data: offerData("ending2") });
  invalid(() => applyTurnBundle(proposedState(), two, { baseRevision: 2 }));
  for (const baseRevision of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
    invalid(() => applyTurnBundle(initialState(), offer, { baseRevision }));
  }
});

test("opening cannot inject a finale or propose one in its own confirmation turn", () => {
  const creating = createOpeningState();
  invalid(() => applyTurnBundle(creating, bundle("finale.propose", offerData()), { baseRevision: 0 }));
  const readyCandidate = initialState();
  const proposed = applyTurnBundle(creating, bundle("opening.propose", { proposalId: "role", initialState: readyCandidate }), { baseRevision: 0 }).state;
  const opening = bundle("opening.confirm", { proposalId: "role" });
  opening.events.push({ id: "ending", type: "finale.propose", sourceSegmentIds: ["s"], data: offerData() });
  invalid(() => applyTurnBundle(proposed, opening, { baseRevision: 1 }));
  readyCandidate.finale = confirmedState().finale;
  invalid(() => applyTurnBundle(creating, bundle("opening.propose", { proposalId: "role", initialState: readyCandidate }), { baseRevision: 0 }));
});

test("finale schema rejects fabricated provenance, unsafe data and oversized evidence without calling getters", () => {
  for (const change of [
    (state) => { state.finale.closed = true; },
    (state) => { state.finale.phase = "closed"; },
    (state) => { state.finale.candidate.closedThreads = []; },
    (state) => { state.finale.candidate.intentionalOpenThreads = Array(9).fill("未明"); },
    (state) => { state.finale.candidate.closureReason = "长".repeat(1601); },
    (state) => { state.finale.candidate.proposal.segmentIds = ["ask", "ask"]; },
    (state) => { state.finale.confirmation.proposalRevision = 1; },
    (state) => { state.finale.confirmation.proposalSegmentIds = ["invented"]; },
    (state) => { state.finale.confirmation.revision = 2; },
    (state) => { state.finale.confirmation.candidateId = "other"; },
  ]) {
    const state = confirmedState(); change(state); invalid(() => validateInitialState(state));
  }
  for (const change of [
    (input) => { input.events.find((event) => event.type.startsWith("finale.")).data.closed = true; },
    (input) => { input.events.find((event) => event.type.startsWith("finale.")).data.candidateId = "constructor"; },
    (input) => { input.events.find((event) => event.type.startsWith("finale.")).sourceSegmentIds = ["invented"]; },
    (input) => { input.events.find((event) => event.type.startsWith("finale.")).data.proposal = { revision: 1, segmentIds: ["s"] }; },
  ]) {
    const input = bundle("finale.propose", offerData()); change(input);
    invalid(() => applyTurnBundle(initialState(), input, { baseRevision: 1 }));
  }
  let invoked = 0;
  const hostile = proposedState();
  Object.defineProperty(hostile.finale.candidate, "closureReason", { enumerable: true, get() { invoked++; return "禁止调用"; } });
  invalid(() => validateInitialState(hostile));
  assert.equal(invoked, 0);
});

test("player projection retains lifecycle sources but omits private closure reasoning and rejected history", () => {
  const state = confirmedState();
  state.finale.candidate.closureReason = "隐藏访客的真实身份与秘密计划。";
  const projected = projectPlayerState(state);
  assert.deepEqual(projected.finale, { phase: "confirmed", candidate: { candidateId: "ending1",
    proposal: { revision: 2, segmentIds: ["ask"] } }, confirmation: state.finale.confirmation });
  assert.doesNotMatch(JSON.stringify(projected), /秘密计划|closureReason|closedThreads|lastDeclined/);
  projected.finale.confirmation.sourceSegmentIds.push("changed");
  assert.deepEqual(state.finale.confirmation.sourceSegmentIds, ["last"]);
});

function generated(responses, options = {}) {
  const calls = [];
  let viewerId = initialState().situation.playerId;
  const generator = createTurnGenerator({
    provider: { async generate(input) { calls.push(input); return { text: JSON.stringify(responses[Math.min(calls.length - 1, responses.length - 1)]),
      usage: { input_tokens: 200, output_tokens: 100 }, finishReason: "stop" }; } },
    store: { readContextHistory({ revision }) { return {
      adventureId: "testfixture", revision, viewerId,
      contextGeneration: 0, materializationId: "a".repeat(64), sourceHash: "b".repeat(64),
      summary: null, summaryValidity: "none", timeline: { systemRevisions: [], storyTurnCount: revision },
      turns: Array.from({ length: revision }, (_, index) => ({ revision: index + 1,
        actionId: `prior-${index + 1}`, input: "此前的玩家行动。",
        narration: [{ id: `prior-segment-${index + 1}`, text: "此前已提交的正文。" }] })),
    }; } },
    memory: { recall({ revision }) { return { revision, results: [], truncated: false }; } },
    ...options,
  });
  return { generator, calls, args: (state = initialState(), input = "我们停在这里吧。", locale = "zh-CN") => {
    viewerId = state.situation.playerId;
    return { request: request({ input, locale, baseRevision: 2 }), attemptId: "test-attempt", state };
  } };
}

test("finale content is optional, quoted only when enabled, and unavailable events cannot escape the call budget", async () => {
  for (const finaleText of ["", " \n "]) {
    const env = generated([bundle("finale.propose", offerData()), bundle(null)], { finaleText, maxModelCalls: 2 });
    assert.deepEqual(await env.generator.generateTurn(env.args()), bundle(null));
    assert.equal(env.calls.length, 2);
    assert.equal(JSON.parse(env.calls[0].messages[1].content).quotedNarrativeSources.finaleText, undefined);
    assert.match(env.calls[1].messages.at(-1).content, /finale events are unavailable/);
  }
  const blocked = generated([bundle("finale.propose", offerData())], { maxModelCalls: 1 });
  await assert.rejects(blocked.generator.generateTurn(blocked.args()), { code: "TURN_OUTPUT_INVALID" });
  assert.equal(blocked.calls.length, 1);
});

test("enabled ending protocol forwards each locale's complete concluding bundle without synthesizing another scene", async () => {
  for (const [locale, line, answer] of [
    ["zh-CN", "你们在晨光中道别。", "让这个故事在这里结束。"],
    ["en-US", "You part in the morning light.", "Let this story end here."],
    ["ja-JP", "朝の光の中で、二人は別れを告げた。", "この物語をここで終わりにします。"],
  ]) {
    const closing = bundle("finale.confirm", { candidateId: "ending1" }, line);
    const env = generated([closing], { finaleText: "保留的收尾准则；旧 resolve_story_finale_finish 工具已失效。" });
    const result = await env.generator.generateTurn(env.args(proposedState(), answer, locale));
    assert.deepEqual(result, closing);
    assert.equal(env.calls.length, 1);
    const data = JSON.parse(env.calls[0].messages[1].content);
    assert.equal(data.locale, locale);
    assert.match(data.quotedNarrativeSources.finaleText, /旧 resolve_story_finale_finish/);
    assert.deepEqual(env.calls[0].tools.map((tool) => tool.function.name), ["recall_memory", "read_entity"]);
    assert.equal(applyTurnBundle(proposedState(), result, { baseRevision: 2 }).state.finale.phase, "confirmed");
  }
});

test("player wording never adds a confirmation absent from the synthetic model result", async () => {
  // This proves absence of keyword automation, not genuine model interpretation.
  for (const input of ["我不是说要结束。", "他说‘是的，结束’，但我还没决定。", "Yes, but I want to keep exploring.", "終了という意味ですか？"]) {
    const clarification = bundle(null, null, "你还没有作出决定。我们可以继续谈谈。");
    const env = generated([clarification], { finaleText: "结束前应等待后续明确回答。" });
    const result = await env.generator.generateTurn(env.args(proposedState(), input));
    assert.deepEqual(result, clarification);
    const expected = proposedState();
    assert.deepEqual(applyTurnBundle(proposedState(), result, { baseRevision: 2 }).state, expected);
    assert.equal(env.calls[0].messages.at(-1).content, `Current player action:\n${input}`);
  }
});

test("confirmed stories, missing pending-finale capability and character creation cannot run an ending", async () => {
  const closed = generated([bundle(null)], { finaleText: "结束准则。" });
  await assert.rejects(closed.generator.generateTurn(closed.args(confirmedState())), { code: "ADVENTURE_CLOSED" });
  assert.equal(closed.calls.length, 0);
  const missing = generated([bundle(null)]);
  await assert.rejects(missing.generator.generateTurn(missing.args(proposedState())), { code: "TURN_GENERATION_FAILED" });
  assert.equal(missing.calls.length, 0);
  const creating = generated([bundle("finale.propose", offerData()), bundle(null)], { finaleText: "结束准则。" });
  await creating.generator.generateTurn(creating.args(createOpeningState()));
  assert.equal(creating.calls.length, 2);
  assert.equal(JSON.parse(creating.calls[0].messages[1].content).quotedNarrativeSources.finaleText, undefined);
});
