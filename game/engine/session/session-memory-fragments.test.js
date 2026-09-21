"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyTurnBundle, validateInitialState, projectPlayerState } = require("./turn-model");
const { createEmptyMemoryFragments, memoryFragmentProgress, validateMemoryFragments, MEMORY_FRAGMENT_LIMITS } = require("./session-memory-fragments");

function initial() {
  return { entities: {
    player: { id: "player", kind: "character", name: "旅人", aliases: [], visibility: "player", attributes: { occupation: "修理工" } },
    place: { id: "place", kind: "location", name: "街角", aliases: [], visibility: "player", attributes: {} },
  }, inventory: [], commitments: {}, situation: { playerId: "player", locationId: "place", day: 10 } };
}
function event(number, overrides = {}) {
  return { id: `record-${number}`, type: "memory_fragment.record", sourceSegmentIds: [`segment-${number}`], data: {
    discoveryMode: number % 2 ? "active_recall" : "passive_association",
    dimension: ["body", "emotion", "skill", "identity"][(number - 1) % 4],
    trigger: `触发物-${number}`, content: `不确定的触觉片段-${number}。也许曾经见过，但无法确认。`, ...overrides,
  } };
}
function bundle(number, events = [event(number)]) {
  const fragments = events.filter((entry) => entry.type === "memory_fragment.record" && typeof entry.data.content === "string")
    .map((entry) => entry.data.content).join("\n\n");
  return { narration: [{ id: `segment-${number}`, text: `片段 ${number} 从触觉中一闪而过；往事仍无法确认。${fragments}` }], events: [...events], experiences: [] };
}
function options(baseRevision, adventureId = "parent-adventure") {
  return { adventureId, baseRevision, memoryFragmentsEnabled: true };
}
function add(state, number, adventureId) {
  const candidate = bundle(number);
  const day = 10 + Math.floor((number - 1) / 2);
  if (state.situation.day !== day) candidate.events.unshift({ id: `day-${number}`, type: "situation.update", sourceSegmentIds: [`segment-${number}`], data: { day } });
  return applyTurnBundle(state, candidate, options(number - 1, adventureId)).state;
}
function collected(count = 30) {
  let state = initial();
  for (let number = 1; number <= count; number += 1) state = add(state, number);
  return state;
}
function choose(state, choice, baseRevision = 30, adventureId) {
  const number = baseRevision + 1;
  return applyTurnBundle(state, bundle(number, [{ id: `choice-${number}`, type: "memory_fragment.resolve", sourceSegmentIds: [`segment-${number}`], data: { choice } }]), options(baseRevision, adventureId)).state;
}
function fails(run) { assert.throws(run, (error) => error.code === "TURN_VALIDATION_FAILED" && Array.isArray(error.issues)); }

test("optional progress is readonly and enabled empty sessions start without collected fragments", () => {
  const state = initial();
  assert.equal(memoryFragmentProgress(state), null);
  assert.deepEqual(memoryFragmentProgress(state, { memoryFragmentsEnabled: true }), {
    count: 0, maxCount: 30, phase: "collecting", choice: null,
    dimensions: { body: 0, emotion: 0, skill: 0, identity: 0 },
    today: { day: 10, activeRecallRemaining: 1, passiveAssociationRemaining: 1 },
  });
  assert.equal(Object.hasOwn(state, "memoryFragments"), false);
  assert.deepEqual(createEmptyMemoryFragments(), { fragments: [], revelationStatus: "collecting", unlockedAt: null, decision: null });
  fails(() => applyTurnBundle(state, bundle(1), { baseRevision: 0, adventureId: "parent-adventure" }));
  state.memoryFragments = createEmptyMemoryFragments();
  fails(() => applyTurnBundle(state, bundle(1), { baseRevision: 0, adventureId: "parent-adventure" }));
  assert.equal(add(initial(), 1).memoryFragments.fragments.length, 1);
});

test("engine creates identity, uncertainty and original adventure provenance without mutating inputs", () => {
  const state = initial(); const candidate = bundle(1);
  const before = structuredClone({ state, candidate });
  const result = applyTurnBundle(state, candidate, options(0));
  assert.deepEqual({ state, candidate }, before);
  assert.deepEqual(result.state.memoryFragments.fragments[0], {
    id: "fragment-1", gameDay: 10, discoveryMode: "active_recall", dimension: "body",
    trigger: "触发物-1", content: "不确定的触觉片段-1。也许曾经见过，但无法确认。", certainty: "uncertain",
    source: { adventureId: "parent-adventure", revision: 1, eventId: "record-1", sourceSegmentIds: ["segment-1"] },
  });
  const expectedEntities = structuredClone(state.entities);
  assert.deepEqual(result.state.entities, expectedEntities);
  assert.equal(result.state.finale, undefined);
  result.bundle.events[0].data.content = "改写返回候选";
  assert.equal(result.state.memoryFragments.fragments[0].content, event(1).data.content);
  const projection = projectPlayerState(result.state);
  projection.memoryFragments.fragments[0].content = "改写玩家副本";
  assert.equal(result.state.memoryFragments.fragments[0].content, event(1).data.content);
});

test("each game day permits one recall and one association, independent of turn count", () => {
  const first = add(initial(), 1);
  const second = add(first, 2);
  assert.deepEqual(memoryFragmentProgress(second).today, { day: 10, activeRecallRemaining: 0, passiveAssociationRemaining: 0 });
  for (const mode of ["active_recall", "passive_association"]) {
    fails(() => applyTurnBundle(second, bundle(3, [event(3, { discoveryMode: mode })]), options(2)));
  }
  const third = add(second, 3);
  assert.equal(third.situation.day, 11);
  assert.equal(third.memoryFragments.fragments[2].gameDay, 11);
  assert.deepEqual(memoryFragmentProgress(third).today, { day: 11, activeRecallRemaining: 0, passiveAssociationRemaining: 1 });
  const together = bundle(1, [event(1), { ...event(2), sourceSegmentIds: ["segment-1"] }]);
  assert.equal(applyTurnBundle(initial(), together, options(0)).state.memoryFragments.fragments.length, 2);
});

test("fragment-bearing turns cannot rewind days to farm allowances; ordinary corrections remain legal", () => {
  const state = initial();
  const day = (id, value) => ({ id, type: "situation.update", sourceSegmentIds: ["segment-1"], data: { day: value } });
  for (const events of [[day("back", 9), event(1)], [day("forward", 11), event(1), day("back", 10)],
    [event(1), day("back", 9), day("restore", 10)]]) {
    fails(() => applyTurnBundle(state, bundle(1, events), options(0)));
  }
  assert.equal(applyTurnBundle(state, bundle(1, [day("back", 9)]), options(0)).state.situation.day, 9);
  assert.equal(state.situation.day, 10);
});

test("normalized duplicate triggers or body text are rejected across Chinese, English and Japanese", () => {
  for (const [original, duplicate] of [["旧门  冷铁", "  旧门\n冷铁  "], ["ＡＢＣ  Door", "abc door"], ["カタカナ　扉", "ｶﾀｶﾅ 扉"]]) {
    for (const key of ["trigger", "content"]) {
      const state = applyTurnBundle(initial(), bundle(1, [event(1, { [key]: original })]), options(0)).state;
      fails(() => applyTurnBundle(state, bundle(2, [event(2, { [key]: duplicate })]), options(1)));
    }
  }
  // Different paraphrases are not a mechanical proof of different memories.
  const first = applyTurnBundle(initial(), bundle(1, [event(1, { content: "冷铁擦过手掌。" })]), options(0)).state;
  assert.equal(applyTurnBundle(first, bundle(2, [event(2, { content: "掌心贴着冰冷的铁。" })]), options(1)).state.memoryFragments.fragments.length, 2);
});

test("all four dimensions contribute to one maximum of thirty; unlock does not decide identity", () => {
  const state = collected();
  assert.equal(state.memoryFragments.fragments.length, MEMORY_FRAGMENT_LIMITS.fragments);
  assert.equal(state.memoryFragments.revelationStatus, "available");
  assert.deepEqual(state.memoryFragments.unlockedAt, state.memoryFragments.fragments[29].source);
  assert.equal(state.memoryFragments.decision, null);
  assert.deepEqual(memoryFragmentProgress(state).dimensions, { body: 8, emotion: 8, skill: 7, identity: 7 });
  assert.deepEqual(memoryFragmentProgress(state).today, { day: 24, activeRecallRemaining: 0, passiveAssociationRemaining: 0 });
  const expectedEntities = initial().entities;
  assert.deepEqual(state.entities, expectedEntities);
  assert.equal(state.finale, undefined);
  fails(() => add(state, 31));
});

test("thirtieth fragment cannot resolve in its own turn and ambiguous narration does not choose", () => {
  const state = collected(29);
  const candidate = bundle(30, [event(30), { id: "same-turn-choice", type: "memory_fragment.resolve", sourceSegmentIds: ["segment-30"], data: { choice: "accepted" } }]);
  fails(() => applyTurnBundle(state, candidate, options(29)));
  assert.equal(state.memoryFragments.fragments.length, 29);
  const available = add(state, 30);
  const vague = applyTurnBundle(available, { narration: [{ id: "s", text: "也许这些过去意味着什么，但你还没有作出决定。" }], events: [], experiences: [] }, options(30));
  assert.equal(vague.state.memoryFragments.revelationStatus, "available");
  assert.equal(vague.state.memoryFragments.decision, null);
});

test("defer survives normalization and later accepted or sealed preserve every original fragment", () => {
  const available = collected();
  const deferred = validateInitialState(choose(available, "deferred"));
  assert.equal(memoryFragmentProgress(deferred).choice, "deferred");
  assert.deepEqual(deferred.memoryFragments.decision, { choice: "deferred", source: { adventureId: "parent-adventure", revision: 31, eventId: "choice-31", sourceSegmentIds: ["segment-31"] } });
  fails(() => applyTurnBundle(deferred, bundle(32, [
    { id: "one", type: "memory_fragment.resolve", sourceSegmentIds: ["segment-32"], data: { choice: "deferred" } },
    { id: "two", type: "memory_fragment.resolve", sourceSegmentIds: ["segment-32"], data: { choice: "accepted" } },
  ]), options(31)));
  for (const ending of ["accepted", "sealed"]) {
    const resolved = choose(deferred, ending, 31);
    assert.deepEqual(resolved.memoryFragments.fragments, available.memoryFragments.fragments);
    assert.equal(resolved.memoryFragments.revelationStatus, ending);
    assert.equal(resolved.memoryFragments.decision.source.revision, 32);
    const { memoryFragments, ...world } = resolved;
    const { memoryFragments: ignored, ...beforeWorld } = available;
    assert.deepEqual(world, beforeWorld, "uncertain recollection and personal interpretation do not change identity or bodily condition");
    fails(() => choose(resolved, "deferred", 32));
    fails(() => choose(resolved, ending, 32));
  }
});

test("copied continuation keeps parent origins, quotas and pending choice while new sources use child identity", () => {
  const parent = collected(29);
  // The private fork appends one system revision without changing this state.
  const child = applyTurnBundle(structuredClone(parent), bundle(30), options(30, "child-adventure")).state;
  assert.deepEqual(child.memoryFragments.fragments.slice(0, 29), parent.memoryFragments.fragments);
  assert.deepEqual(child.memoryFragments.fragments[29].source, { adventureId: "child-adventure", revision: 31, eventId: "record-30", sourceSegmentIds: ["segment-30"] });
  const deferred = choose(child, "deferred", 31, "child-adventure");
  assert.equal(deferred.memoryFragments.decision.source.adventureId, "child-adventure");
  const grandchild = choose(structuredClone(deferred), "sealed", 33, "grandchild-adventure");
  assert.equal(grandchild.memoryFragments.decision.source.revision, 34);
  assert.deepEqual(grandchild.memoryFragments.fragments, child.memoryFragments.fragments);
  assert.equal(parent.memoryFragments.fragments.length, 29);
});

test("persisted fragments reject invented certainty, source ordering, quota and unlock inconsistencies", () => {
  const state = collected();
  for (const change of [
    (track) => { track.fragments[0].certainty = "verified"; },
    (track) => { track.fragments[0].id = "fragment-30"; },
    (track) => { track.fragments[0].source.revision = 0; },
    (track) => { track.fragments[1].source.revision = 0.5; },
    (track) => { track.fragments[1].source.adventureId = "other"; track.fragments[1].source.revision = 1; },
    (track) => { track.fragments[1].discoveryMode = "active_recall"; },
    (track) => { track.fragments[1].trigger = track.fragments[0].trigger; },
    (track) => { track.fragments[0].source.sourceSegmentIds = ["s", "s"]; },
    (track) => { track.unlockedAt.revision = 29; },
    (track) => { track.revelationStatus = "collecting"; },
    (track) => { track.revelationStatus = "sealed"; },
    (track) => { track.fragments.push(structuredClone(track.fragments[0])); },
  ]) {
    const invalid = structuredClone(state); change(invalid.memoryFragments);
    fails(() => validateInitialState(invalid));
  }
  const decided = choose(state, "accepted");
  decided.memoryFragments.decision.source.revision = 30;
  fails(() => validateInitialState(decided));
  fails(() => choose(state, "deferred", 29));
});

test("model cannot supply runtime fields or unknown variants; structured limits do not truncate text", () => {
  for (const change of [
    (data) => { data.id = "invented"; }, (data) => { data.gameDay = 300; },
    (data) => { data.certainty = "certain"; }, (data) => { data.source = { adventureId: "other" }; },
    (data) => { data.discoveryMode = "automatic"; }, (data) => { data.dimension = "truth"; },
    (data) => { data.trigger = " "; }, (data) => { data.content = "x".repeat(501); },
    (data) => { data.trigger = "x".repeat(161); },
  ]) {
    const candidate = bundle(1); change(candidate.events[0].data);
    fails(() => applyTurnBundle(initial(), candidate, options(0)));
  }
  const content = "あ".repeat(500); const trigger = "气".repeat(160);
  const candidate = bundle(1, [event(1, { content, trigger })]);
  const result = applyTurnBundle(initial(), candidate, options(0));
  assert.equal(result.state.memoryFragments.fragments[0].content, content);
  assert.equal(result.state.memoryFragments.fragments[0].trigger, trigger);
  assert.deepEqual(result.bundle.narration, candidate.narration, "the full 500-character recollection remains intact without a forced condition update");
  fails(() => choose(collected(), "undecided"));
});

test("fragment validation and option checks reject getters without executing them", () => {
  let calls = 0;
  const state = initial();
  Object.defineProperty(state, "memoryFragments", { enumerable: true, get() { calls += 1; return createEmptyMemoryFragments(); } });
  fails(() => validateMemoryFragments(state));
  const invalid = initial(); invalid.memoryFragments = createEmptyMemoryFragments();
  Object.defineProperty(invalid.memoryFragments, "fragments", { enumerable: true, get() { calls += 1; return []; } });
  fails(() => validateMemoryFragments(invalid));
  const opts = {}; Object.defineProperty(opts, "memoryFragmentsEnabled", { enumerable: true, get() { calls += 1; return true; } });
  fails(() => memoryFragmentProgress(initial(), opts));
  fails(() => applyTurnBundle(initial(), bundle(1), opts));
  fails(() => applyTurnBundle(initial(), bundle(1), { ...options(0), memoryFragmentsEnabled: "true" }));
  assert.equal(calls, 0);
});
