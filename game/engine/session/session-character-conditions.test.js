"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyTurnBundle, validateInitialState, projectPlayerState } = require("./turn-model");
const { initialState } = require("./test-fixtures/turn-samples");
const { emptyConditionRecords, validateConditionRecords, conditionRecordId, compileConditionEvidence, compileConditionSources } = require("./session-character-conditions");
const options = { adventureId: "conditions-adventure", baseRevision: 0 };
const narration = [{ id: "arm", text: "你抬起右手，手腕仍疼，握杯时没有加重。" },
  { id: "breath", text: "她说：坐着不喘，走几步仍会气短，原因还不知道。" }];
function condition(type = "add", data = {}, id = "change") {
  return { id, type: `condition.${type}`, sourceSegmentIds: ["arm", "breath"], data: {
    characterId: "p", ...(type === "remove" ? {} : { basis: "observed", text: "右手腕仍疼，握杯未加重" }),
    evidence: [{ segmentId: "arm", quote: "手腕仍疼，握杯时没有加重。" }], ...data } };
}
function bundle(events = [], prose = narration) { return { narration: prose, events, experiences: [] }; }
function apply(state, events, baseRevision = 0, adventureId = options.adventureId) {
  return applyTurnBundle(state, bundle(events), { baseRevision, adventureId });
}
function rejects(run) { assert.throws(run, { code: "TURN_VALIDATION_FAILED" }); }
function added() { return apply(initialState(), [condition()]).state; }

test("omitted evidence preserves complete selected paragraphs, qualifications and caller input", () => {
  const prose = [{ id: "body", text: '她说："还是疼，还是疼。"\n🪶 但坐着时不疼，原因不明。' },
    { id: "limit", text: "她还没试过搬东西，不能据此判断能否负重。" }, { id: "unrelated", text: "雨还在下。" }];
  const event = condition("add", { characterId: "npc", basis: "self_report", text: "自觉仍疼，坐着时不疼；原因未知" });
  delete event.data.evidence;
  event.sourceSegmentIds = ["body", "limit"];
  const state = initialState(), candidate = bundle([event], prose), before = structuredClone({ state, candidate });
  const result = applyTurnBundle(state, candidate, options);
  assert.deepEqual({ state, candidate }, before);
  assert.deepEqual(result.bundle, candidate, "the engine does not reinsert evidence into model events");
  const record = result.state.entities.npc.conditionRecords.items[0];
  assert.equal(record.basis, "self_report");
  assert.deepEqual(record.sources, prose.slice(0, 2).map(segment => ({ adventureId: options.adventureId,
    revision: 1, segmentId: segment.id, start: 0, end: segment.text.length,
    totalCharacters: segment.text.length, quote: segment.text })));
  assert.deepEqual(applyTurnBundle(result.state, bundle([], prose), { ...options, baseRevision: 1 }).state, result.state);
});

test("whole-paragraph sources reject invalid IDs and explicit malformed compatibility evidence", () => {
  const context = { ...options, revision: 1, narration, sourceSegmentIds: ["arm"] };
  for (const sourceSegmentIds of [[], ["missing"], ["arm", "arm"], [""], [1], "arm"]) {
    rejects(() => compileConditionSources({}, { ...context, sourceSegmentIds }));
  }
  rejects(() => compileConditionSources({}, { ...context, narration: [narration[0], narration[0]] }));
  for (const evidence of [null, false, "", {}, [], undefined, [{ segmentId: "arm" }]]) {
    rejects(() => compileConditionSources({ evidence }, context));
    if (evidence !== undefined) rejects(() => apply(initialState(), [condition("add", { evidence })]));
  }
  assert.equal(compileConditionSources({ evidence: [{ segmentId: "arm", quote: "手腕仍疼" }] }, context)[0].quote, "手腕仍疼");
  rejects(() => compileConditionSources({ evidence: [{ segmentId: "arm", quote: "已经恢复" }] }, context));
});

test("whole-paragraph sources retain existing paragraph and total limits without trimming", () => {
  const paragraphs = Array.from({ length: 5 }, (_, i) => ({ id: `whole-${i}`, text: `${i}` + '🙂\\"'.repeat(499) + "尾字节" }));
  assert.ok(paragraphs.every(segment => segment.text.length === 2000));
  const context = list => ({ ...options, revision: 1, narration: list, sourceSegmentIds: list.map(segment => segment.id) });
  const four = paragraphs.slice(0, 4);
  const sources = compileConditionSources({}, context(four));
  assert.deepEqual(sources.map(source => source.quote), four.map(segment => segment.text));
  assert.equal(sources.reduce((sum, source) => sum + source.quote.length, 0), 8000);
  rejects(() => compileConditionSources({}, context(paragraphs)));
  rejects(() => compileConditionSources({}, context([{ id: "long", text: "前" + paragraphs[0].text }])));
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `short-${i}`, text: `完整短段${i}` }));
  assert.equal(compileConditionSources({}, context(nine.slice(0, 8))).length, 8);
  rejects(() => compileConditionSources({}, context(nine)));
  const event = condition(); delete event.data.evidence; event.sourceSegmentIds = ["long"];
  const state = added(), candidate = bundle([event], [{ id: "long", text: "x".repeat(2001) }]);
  const before = structuredClone({ state, candidate });
  assert.throws(() => applyTurnBundle(state, candidate, { ...options, baseRevision: 1 }), error => {
    assert.equal(error.code, "TURN_VALIDATION_FAILED");
    assert.ok(error.message.startsWith("event.sourceSegmentIds"));
    assert.equal(error.message.includes("data.evidence"), false, "default source errors do not request the retired model field");
    return true;
  });
  assert.deepEqual({ state, candidate }, before);
});

test("conditions compile exact current evidence and preserve caller input, identity and untouched records", () => {
  const state = initialState(); state.entities.p.attributes.occupation = "修理工";
  const candidate = bundle([condition(), condition("add", { characterId: "npc", basis: "self_report", text: "走几步仍气短，坐着不喘；原因未知",
    evidence: [{ segmentId: "breath", quote: narration[1].text }] }, "second")]);
  const before = structuredClone({ state, candidate });
  const result = applyTurnBundle(state, candidate, options);
  assert.deepEqual({ state, candidate }, before);
  assert.deepEqual(result.bundle, candidate, "compiled fields never get written into model events");
  const record = result.state.entities.p.conditionRecords.items[0];
  assert.equal(record.id, conditionRecordId(record)); assert.equal(record.characterId, "p");
  const quote = "手腕仍疼，握杯时没有加重。";
  assert.deepEqual(record.sources, [{ adventureId: options.adventureId, revision: 1, segmentId: "arm",
    start: narration[0].text.indexOf(quote), end: narration[0].text.indexOf(quote) + quote.length,
    totalCharacters: narration[0].text.length, quote }]);
  assert.equal(result.state.entities.npc.conditionRecords.items[0].basis, "self_report");
  assert.deepEqual(result.state.entities.p.attributes, { occupation: "修理工" });
  assert.deepEqual(apply(result.state, [], 1).state, result.state);
  result.bundle.events[0].data.text = "外部改写";
  assert.equal(record.text, "右手腕仍疼，握杯未加重");
});

test("targeted replacement and removal preserve other conditions and ancestor predecessor identity", () => {
  let state = apply(initialState(), [condition(), condition("add", { text: "手臂擦伤", evidence: [{ segmentId: "arm", quote: "你抬起右手" }] }, "second")]).state;
  const [first, second] = state.entities.p.conditionRecords.items;
  const replaced = apply(state, [condition("replace", { recordId: first.id, text: "右手腕疼痛减轻" })], 1, "child-adventure").state;
  const current = replaced.entities.p.conditionRecords.items[0];
  assert.deepEqual(current.predecessor, { adventureId: options.adventureId, revision: 1, recordId: first.id });
  assert.equal(current.sources[0].adventureId, "child-adventure"); assert.equal(current.sources[0].revision, 2);
  assert.deepEqual(replaced.entities.p.conditionRecords.items[1], second);
  const removed = apply(replaced, [condition("remove", { recordId: current.id, reason: "resolved" })], 2, "child-adventure").state;
  assert.deepEqual(removed.entities.p.conditionRecords.items, [second]);
  assert.equal(Object.hasOwn(removed.entities.p.attributes, "status"), false);
  const empty = apply(removed, [condition("remove", { recordId: second.id, reason: "retracted" })], 3).state;
  assert.deepEqual(empty.entities.p.conditionRecords, emptyConditionRecords());
  assert.deepEqual(state.entities.p.conditionRecords.items, [first, second]);
});

test("replacement and removal target only initial active records once per turn", () => {
  const state = added(); const record = state.entities.p.conditionRecords.items[0];
  for (const events of [
    [condition("replace", { recordId: "missing" })],
    [condition("replace", { characterId: "npc", recordId: record.id })],
    [condition("replace", { recordId: record.id }), condition("remove", { recordId: record.id, reason: "resolved" }, "twice")],
    [condition("remove", { recordId: record.id, reason: "expired" })],
  ]) rejects(() => apply(state, events, 1));
  const fresh = apply(initialState(), [condition()]).state.entities.p.conditionRecords.items[0];
  rejects(() => apply(initialState(), [condition(), condition("remove", { recordId: fresh.id, reason: "resolved" }, "same-turn")]));
  const onceRemoved = apply(state, [condition("remove", { recordId: record.id, reason: "resolved" })], 1).state;
  rejects(() => apply(onceRemoved, [condition("replace", { recordId: record.id })], 2));
});

test("partial invalid bundles leave prior records, inventory and candidate untouched", () => {
  const state = added(); const record = state.entities.p.conditionRecords.items[0];
  const candidate = bundle([{ id: "take", type: "inventory.adjust", sourceSegmentIds: ["arm"], data: { ownerId: "p", itemId: "rice", delta: 1 } },
    condition("remove", { recordId: record.id, reason: "resolved" }), condition("add", { text: "" }, "bad")]);
  const before = structuredClone({ state, candidate });
  rejects(() => applyTurnBundle(state, candidate, { ...options, baseRevision: 1 }));
  assert.deepEqual({ state, candidate }, before);
});

test("evidence rejects invented, ambiguous, undeclared, foreign or model-supplied coordinates", () => {
  for (const data of [
    { evidence: [] }, { evidence: [{ segmentId: "old", quote: "手腕仍疼" }] },
    { evidence: [{ segmentId: "arm", quote: "手腕已经好了" }] },
    { evidence: [{ segmentId: "arm", quote: "手腕仍疼", start: 0 }] },
    { evidence: [{ segmentId: "arm", quote: "手腕仍疼", adventureId: "other" }] },
    { evidence: [{ segmentId: "arm", quote: "手腕仍疼" }, { segmentId: "arm", quote: "手腕仍疼" }] },
    { characterId: "rice" }, { characterId: "missing" }, { basis: "diagnosed" }, { text: "x".repeat(121) },
  ]) rejects(() => apply(initialState(), [condition("add", data)]));
  const undeclared = condition(); undeclared.sourceSegmentIds = ["breath"];
  rejects(() => apply(initialState(), [undeclared]));
  rejects(() => applyTurnBundle(initialState(), bundle([condition("add", { evidence: [{ segmentId: "arm", quote: "疼" }] })],
    [{ id: "arm", text: "疼，又疼。" }, narration[1]]), options));
  rejects(() => applyTurnBundle(initialState(), bundle([condition()]), { baseRevision: 0 }));
});

test("limits and Unicode preserve full quotes without truncation or hidden alias fields", () => {
  const quote = '🙂\\"'.repeat(400);
  const record = applyTurnBundle(initialState(), bundle([condition("add", { text: "症".repeat(120), evidence: [{ segmentId: "arm", quote }] })],
    [{ id: "arm", text: `前${quote}后` }, narration[1]]), options).state.entities.p.conditionRecords.items[0];
  assert.equal(record.sources[0].start, 1); assert.equal(record.sources[0].quote, quote);
  const long = "x".repeat(2001);
  rejects(() => compileConditionEvidence([{ segmentId: "arm", quote: long }], { ...options, revision: 1, narration: [{ id: "arm", text: long }], sourceSegmentIds: ["arm"] }));
  rejects(() => apply(initialState(), [condition("add", { text: "\ud800" })]));
  const chunks = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, text: String(i).repeat(2000) }));
  const four = chunks.slice(0, 4);
  const exact = compileConditionEvidence(four.map(s => ({ segmentId: s.id, quote: s.text })),
    { adventureId: options.adventureId, revision: 1, narration: four, sourceSegmentIds: four.map(s => s.id) });
  assert.equal(exact.reduce((sum, source) => sum + source.quote.length, 0), 8000);
  rejects(() => compileConditionEvidence(chunks.map(s => ({ segmentId: s.id, quote: s.text })),
    { adventureId: options.adventureId, revision: 1, narration: chunks, sourceSegmentIds: chunks.map(s => s.id) }));
  const events = Array.from({ length: 32 }, (_, i) => condition("add", { text: `状况${i}` }, `add-${i}`));
  const full = apply(initialState(), events).state;
  assert.equal(full.entities.p.conditionRecords.items.length, 32);
  rejects(() => apply(full, [condition("add", { text: "额外一项" })], 1));
  assert.equal(apply(full, [condition("replace", { recordId: full.entities.p.conditionRecords.items[0].id, text: "一项变化" })], 1).state.entities.p.conditionRecords.items.length, 32);
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, text: `原文${i}` }));
  rejects(() => compileConditionEvidence(nine.map(s => ({ segmentId: s.id, quote: s.text })),
    { adventureId: options.adventureId, revision: 1, narration: nine, sourceSegmentIds: nine.map(s => s.id) }));
});

test("new characters initialize empty records and cannot import engine-owned data or legacy body fields", () => {
  const create = attributes => ({ id: "create", type: "entity.create", sourceSegmentIds: ["arm"], data: { entity: {
    id: "visitor", kind: "character", name: "访客", aliases: [], visibility: "player", attributes } } });
  const created = apply(initialState(), [create({ occupation: "店员" })]).state;
  assert.deepEqual(created.entities.visitor.conditionRecords, emptyConditionRecords());
  const withCondition = apply(initialState(), [create({}), condition("add", { characterId: "visitor" })]).state;
  assert.equal(withCondition.entities.visitor.conditionRecords.items.length, 1);
  const forged = create({}); forged.data.entity.conditionRecords = emptyConditionRecords();
  rejects(() => apply(initialState(), [forged]));
  rejects(() => apply(initialState(), [create({ status: "正常" })]));
  rejects(() => apply(initialState(), [{ id: "set", type: "entity.update", sourceSegmentIds: ["arm"], data: { id: "p", conditionRecords: emptyConditionRecords() } }]));
});

test("legacy snapshots remain readable but cannot be silently cleared then converted in the same turn", () => {
  const state = initialState(); state.entities.p.attributes.status = "旧状态";
  assert.deepEqual(validateInitialState(state), state); assert.deepEqual(apply(state, []).state, state);
  rejects(() => apply(state, [condition()]));
  rejects(() => apply(state, [{ id: "clear", type: "entity.update", sourceSegmentIds: ["arm"], data: { id: "p", removeAttributes: ["status"] } }, condition()]));
  const mixed = added(); mixed.entities.p.attributes.health = "旧值";
  rejects(() => validateInitialState(mixed));
});

test("legacy body attributes cannot be cleared in an earlier turn to bypass the read-only boundary", () => {
  for (const key of ["status", "condition", "health", "injuries", "hunger", "thirst", "fatigue", "localizedStatus", "localized_status", "conditionRecords"]) {
    const state = initialState(); state.entities.p.attributes[key] = "旧身体资料";
    const before = structuredClone(state);
    const clear = { id: "clear", type: "entity.update", sourceSegmentIds: ["arm"], data: { id: "p", removeAttributes: [key] } };
    rejects(() => apply(state, [clear]));
    assert.deepEqual(state, before);
    if (key !== "conditionRecords") rejects(() => apply(state, [condition()], 1));
  }
  const state = initialState(); state.entities.p.attributes.description = "旧描述"; state.entities.rice.attributes.condition = "旧包装记录";
  const changes = [
    { id: "description", type: "entity.update", sourceSegmentIds: ["arm"], data: { id: "p", removeAttributes: ["description"] } },
    { id: "item", type: "entity.update", sourceSegmentIds: ["arm"], data: { id: "rice", removeAttributes: ["condition"] } },
  ];
  const result = apply(state, changes).state;
  assert.deepEqual(result.entities.p.attributes, {}); assert.deepEqual(result.entities.rice.attributes, {});
});

test("metadata hashes bind text, subject, coordinates and predecessor without pretending to prove source truth", () => {
  const record = added().entities.p.conditionRecords.items[0];
  for (const change of [r => { r.text = "改写"; }, r => { r.characterId = "npc"; }, r => { r.sources[0].start++; },
    r => { r.sources[0].adventureId = "other"; }, r => { r.sources[0].quote = "x".repeat(r.sources[0].quote.length); },
    r => { r.predecessor = { adventureId: "old", revision: 1, recordId: "old-record" }; }]) {
    const copy = structuredClone(record); change(copy);
    rejects(() => validateConditionRecords({ format: "body-conditions-1", items: [copy] }, { characterId: "p" }));
  }
  const hidden = added(); hidden.entities.p.visibility = "hidden";
  assert.equal(projectPlayerState(hidden).entities.p, undefined);
  const falseMeaning = apply(initialState(), [condition("add", { text: "右手已完全恢复" })]).state;
  assert.equal(falseMeaning.entities.p.conditionRecords.items[0].text, "右手已完全恢复", "semantic contradictions remain a real-model/player review responsibility");
});
