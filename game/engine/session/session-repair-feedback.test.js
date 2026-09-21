"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyTurnBundle, validateInitialState } = require("./turn-model");
const { initialState, borrowBundle } = require("./test-fixtures/turn-samples");
const { REPAIR_FEEDBACK_LIMITS, safeFeedback, jsonSyntaxFeedback, toolArgumentsFeedback } = require("./session-repair-feedback");

function rejected(operation) {
  try { operation(); } catch (error) { assert.equal(error.code, "TURN_VALIDATION_FAILED"); return error; }
  assert.fail("fixture must fail the real structural validator");
}
function candidateFeedback(change) {
  const candidate = borrowBundle(); change(candidate);
  return safeFeedback(rejected(() => applyTurnBundle(initialState(), candidate, { adventureId: "fixture", baseRevision: 0 })));
}
function conditionFeedback(change) {
  const candidate = { narration: [{ id: "arm", text: "手腕仍疼。握杯没有加重。" }],
    events: [{ id: "body", type: "condition.add", sourceSegmentIds: ["arm"], data: { characterId: "p",
      basis: "observed", text: "手腕仍疼，握杯未加重", evidence: [{ segmentId: "arm", quote: "手腕仍疼。" }] } }], experiences: [] };
  change(candidate.events[0].data);
  return safeFeedback(rejected(() => applyTurnBundle(initialState(), candidate, { adventureId: "fixture", baseRevision: 0 })));
}

test("real turn-validator failures report precise fields, indices and declared constraints", () => {
  const required = candidateFeedback(value => { delete value.events[0].data.quantity; })[0];
  assert.equal(required.code, "FIELD_REQUIRED"); assert.equal(required.path, "bundle.events[0].data.quantity");
  const range = candidateFeedback(value => { value.events[0].data.quantity = 0; })[0];
  assert.equal(range.code, "INTEGER_RANGE"); assert.deepEqual(range.expected, { type: "integer", minimum: 1, maximum: 1000000000 });
  const enumeration = candidateFeedback(value => { value.experiences[0].kind = "unsupported-private-kind"; })[0];
  assert.equal(enumeration.path, "bundle.experiences[0].kind");
  assert.deepEqual(enumeration.expected, ["event", "claim", "belief"]);
  assert.doesNotMatch(JSON.stringify(enumeration), /unsupported-private-kind/);
  const prose = candidateFeedback(value => { value.narration.push({ id: "other", text: "" }); })[0];
  assert.equal(prose.path, "bundle.narration[1].text"); assert.equal(prose.expected.maxCharacters, 200000);
  const reference = candidateFeedback(value => { value.events[1].sourceSegmentIds = ["not-from-this-turn"]; })[0];
  assert.equal(reference.path, "bundle.events[1].sourceSegmentIds[0]"); assert.equal(reference.code, "TURN_REFERENCE_INVALID");
  assert.doesNotMatch(JSON.stringify(reference), /not-from-this-turn/);
  const event = candidateFeedback(value => { value.events[0].type = "private-invented-event"; })[0];
  assert.equal(event.code, "EVENT_TYPE_INVALID"); assert.equal(event.path, "bundle.events[0].type");
  assert.doesNotMatch(JSON.stringify(event), /private-invented-event/);
});

test("real condition errors identify missing fields and the exact evidence item without quoting story text", () => {
  const missing = conditionFeedback(value => { delete value.basis; })[0];
  assert.equal(missing.path, "bundle.events[0].data.basis"); assert.equal(missing.code, "FIELD_REQUIRED");
  const basis = conditionFeedback(value => { value.basis = "private-wrong-basis"; })[0];
  assert.deepEqual(basis.expected, ["observed", "self_report"]);
  const length = conditionFeedback(value => { value.text = "长".repeat(121); })[0];
  assert.equal(length.expected.maxCharacters, 120); assert.equal(length.expected.wellFormed, true);
  const quote = conditionFeedback(value => { value.evidence.push({ segmentId: "arm", quote: "private-unwritten-condition" }); })[0];
  assert.equal(quote.path, "bundle.events[0].data.evidence[1].quote"); assert.equal(quote.code, "CONDITION_QUOTE_INVALID");
  assert.match(quote.repair, /exact original wording/);
  assert.doesNotMatch(JSON.stringify(quote), /private-unwritten|手腕仍疼/);
  const count = conditionFeedback(value => { value.evidence = []; })[0];
  assert.deepEqual(count.expected, { type: "array", minItems: 1, maxItems: 8 });
});

test("feedback redacts map identities, arbitrary keys and raw messages, including protocol-looking map keys", () => {
  const state = initialState(); state.entities.secret.name = "";
  const hidden = safeFeedback(rejected(() => validateInitialState(state)))[0];
  assert.equal(hidden.path, "state.entities.entry.name"); assert.doesNotMatch(JSON.stringify(hidden), /secret/);
  const unknown = candidateFeedback(value => { value.events[0].data["sk-private-key-12345"] = "private-value"; })[0];
  assert.equal(unknown.path, "bundle.events[0].data.field"); assert.equal(unknown.code, "FIELD_NOT_ALLOWED");
  assert.doesNotMatch(JSON.stringify(unknown), /sk-private|private-value/);
  const fabricated = { code: "TURN_VALIDATION_FAILED", message: "private-message", cause: "private-cause",
    issues: ["state.entities.name.attributes.password: private reason", "state.commitments.status.id: invalid ID"] };
  assert.deepEqual(safeFeedback(fabricated).map(item => item.path), ["state.entities.entry.attributes.field", "state.commitments.entry.id"]);
  assert.doesNotMatch(JSON.stringify(safeFeedback(fabricated)), /private|password/);
  assert.deepEqual(safeFeedback({ code: "UPSTREAM_BAD_RESPONSE", issues: ["bundle: must be an object"] }), []);
});

test("untrusted accessors and oversized feedback cannot enter repair messages", () => {
  let accesses = 0;
  const hostile = { get code() { accesses++; return "TURN_VALIDATION_FAILED"; }, get issues() { accesses++; return ["private"]; } };
  assert.deepEqual(safeFeedback(hostile), []);
  const issues = []; Object.defineProperty(issues, "0", { get() { accesses++; return "private"; } });
  assert.deepEqual(safeFeedback({ code: "TURN_VALIDATION_FAILED", issues }), []);
  jsonSyntaxFeedback({ get message() { accesses++; return "private"; } }, "{}");
  const tool = { entityId: "p", get sourceCursor() { accesses++; return "private"; } };
  const output = toolArgumentsFeedback("read_entity", tool);
  assert.equal(accesses, 0); assert.doesNotMatch(JSON.stringify(output), /private/);
  const bounded = safeFeedback({ code: "TURN_VALIDATION_FAILED", issues: Array(64).fill("bundle.events[123].data.evidence[7].quote: condition quote must match current narration exactly once") });
  assert(bounded.length > 0 && bounded.length <= REPAIR_FEEDBACK_LIMITS.issues);
  assert(Buffer.byteLength(JSON.stringify(bounded)) <= REPAIR_FEEDBACK_LIMITS.bytes);
});

test("JSON syntax feedback extracts location without source snippets or malformed raw error fields", () => {
  const input = '{\n"secret":"private-key"\n"next":true}';
  let error; try { JSON.parse(input); } catch (caught) { error = caught; }
  const feedback = jsonSyntaxFeedback(error, input);
  assert.equal(feedback.code, "JSON_SYNTAX"); assert.equal(feedback.line, 3); assert.equal(feedback.column, 1);
  assert.equal(feedback.position, input.indexOf('"next"'));
  assert.doesNotMatch(JSON.stringify(feedback), /private-key|secret|next/);
  const truncated = '{"n":';
  try { JSON.parse(truncated); } catch (caught) {
    assert.equal(jsonSyntaxFeedback(caught, truncated).position, truncated.length);
  }
  const forged = jsonSyntaxFeedback(new Error("private position 99999999999999999"), "{}");
  assert.equal(forged.position, undefined); assert.doesNotMatch(JSON.stringify(forged), /private|99999/);
});

test("tool argument feedback names precise constraints without returning supplied identifiers or hidden membership", () => {
  const recall = toolArgumentsFeedback("recall_memory", { query: "", entityIds: ["hidden-secret-id"], order: "private-order", beforeRevision: 30 },
    { baseRevision: 10, visibleEntityIds: ["p"] });
  assert.deepEqual(recall.map(issue => issue.code), ["ENTITY_REFERENCES_INVALID", "ENUM_VALUE", "REVISION_BOUND_INVALID"]);
  assert.doesNotMatch(JSON.stringify(recall), /hidden-secret|private-order/);
  const unknown = toolArgumentsFeedback("recall_memory", { query: "", entityIds: ["unknown-id"], order: "other-value", beforeRevision: 30 },
    { baseRevision: 10, visibleEntityIds: ["p"] });
  assert.deepEqual(unknown, recall, "hidden and unknown identities cannot be distinguished by feedback");
  assert.equal(toolArgumentsFeedback("recall_memory", { query: "x", afterRevision: 5, beforeRevision: 5 }, { baseRevision: 9 })[0].code, "REVISION_RANGE_INVALID");
  const missingQuery = toolArgumentsFeedback("recall_memory", { order: "latest" });
  assert.equal(missingQuery[0].path, "arguments.query");
  const module = toolArgumentsFeedback("read_narrative_module", { module: "private-module" });
  assert.deepEqual(module[0].expected, ["memory_fragments"]);
  const parse = toolArgumentsFeedback("read_entity", '{"entityId":"private-id",}');
  assert.equal(parse[0].code, "JSON_SYNTAX"); assert.doesNotMatch(JSON.stringify(parse), /private-id/);
});

test("cursor feedback tells models to copy the correct reader cursor and avoids blaming unrelated valid arguments", () => {
  const source = toolArgumentsFeedback("read_entity", { entityId: "p", conditionRecordId: "record", sourceCursor: "private-cursor" }, { cursorInvalid: true });
  assert.equal(source[0].path, "arguments.sourceCursor"); assert.equal(source[0].code, "CURSOR_INVALID");
  assert.doesNotMatch(JSON.stringify(source), /private-cursor/);
  const page = toolArgumentsFeedback("read_memory_fragments", { limit: 0, cursor: { adventureId: "a", revision: 10, afterIndex: 1 } }, { baseRevision: 10 });
  assert.equal(page.length, 1); assert.equal(page[0].path, "arguments.limit");
  const invalid = toolArgumentsFeedback("read_memory_fragments", { cursor: { adventureId: "private-adventure", revision: 11, afterIndex: 1 } }, { baseRevision: 10 });
  assert.equal(invalid[0].path, "arguments.cursor"); assert.doesNotMatch(JSON.stringify(invalid), /private-adventure/);
  const output = toolArgumentsFeedback("private-tool", { "private-arg": "private-value" });
  assert.equal(output[0].code, "TOOL_NOT_AVAILABLE"); assert.doesNotMatch(JSON.stringify(output), /private/);
});
