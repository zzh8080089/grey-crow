"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EXECUTION_MAX_BYTES, EXECUTION_MAX_STEPS, sanitizeExecutionSnapshot,
  createSessionExecution, executionRequest, executionUsage } = require("./session-execution");

const identity = { adventureId: "adventure-a", actionId: "action-a", attemptId: "attempt-a", baseRevision: 3 };
const metadata = () => executionRequest({ messages: [{ role: "user", content: '保留"条件"\\🙂' }], tools: [],
  responseFormat: { type: "json_object" }, maxOutputTokens: 8192 }, {
  latestEstimate: { inputTokens: 100, safetyInputTokens: 200 }, contextGeneration: 2, settingsIdentity: "a".repeat(64),
});

test("execution metadata is an independent bounded whitelist, not a copy of model data", () => {
  const writes = [];
  const journal = createSessionExecution(identity, value => { writes.push(value); value.steps.length = 0; });
  journal.record("model", "invoked", { callIndex: 1, request: metadata() });
  journal.record("model", "returned", { callIndex: 1, durationMs: 5, finishReason: "stop",
    ...executionUsage({ input_tokens: 5, output_tokens: 0, upstream_secret: "private" }) });
  const snapshot = journal.read();
  assert.equal(snapshot.steps.length, 2);
  assert.equal(snapshot.truncated, false);
  assert.equal(snapshot.steps[1].usageComplete, true);
  assert.deepEqual(snapshot.steps[1].usage, { input_tokens: 5, output_tokens: 0 });
  assert.doesNotMatch(JSON.stringify(snapshot), /保留|条件|upstream_secret|private/);
  const checked = sanitizeExecutionSnapshot(snapshot);
  checked.steps[0].request.bytes = 1;
  assert.notEqual(snapshot.steps[0].request.bytes, 1);
  assert.equal(writes.length, 2);
  journal.stop(); journal.record("repair", "requested", { callIndex: 1, reason: "validation" });
  assert.equal(writes.length, 2);
});

test("missing token usage stays unknown while measured zero is complete", () => {
  assert.deepEqual(executionUsage(undefined), { usage: null, usageComplete: false });
  assert.deepEqual(executionUsage({ input_tokens: 0, output_tokens: 0 }), {
    usage: { input_tokens: 0, output_tokens: 0 }, usageComplete: true });
  assert.deepEqual(executionUsage({ input_tokens: 30, output_tokens: -1 }), {
    usage: { input_tokens: 30 }, usageComplete: false });
});

test("failed model diagnostics retain only a classified error and accept older records", () => {
  const journal = createSessionExecution(identity);
  journal.record("model", "failed", { callIndex: 1, durationMs: 2, resultCode: "API_TIMEOUT" });
  const snapshot = journal.read();
  assert.equal(snapshot.steps[0].resultCode, "API_TIMEOUT");
  const older = structuredClone(snapshot); delete older.steps[0].resultCode;
  assert.ok(sanitizeExecutionSnapshot(older));
  const invalid = structuredClone(snapshot); invalid.steps[0].resultCode = "private-provider-message";
  assert.equal(sanitizeExecutionSnapshot(invalid), null);
});

test("raw fields, fabricated outcomes, token strings and accessors cannot enter diagnostics", () => {
  const journal = createSessionExecution(identity);
  journal.record("model", "invoked", { callIndex: 1, request: metadata() });
  const valid = journal.read();
  for (const mutate of [
    value => { value.raw = "secret"; },
    value => { value.steps[0].arguments = "secret"; },
    value => { value.steps[0].outcome = "arbitrary upstream message"; },
    value => { value.steps[0].request.secret = "secret"; },
    value => { value.steps[0].request.bytes = "100"; },
    value => { value.steps[0].seq = 2; },
    value => { value.steps[0].durationMs = 0; },
  ]) { const next = structuredClone(valid); mutate(next); assert.equal(sanitizeExecutionSnapshot(next), null); }
  let accessed = 0;
  const getter = { ...valid, get steps() { accessed++; return valid.steps; } };
  assert.equal(sanitizeExecutionSnapshot(getter), null);
  const arrayGetter = structuredClone(valid);
  Object.defineProperty(arrayGetter.steps, "0", { get() { accessed++; return valid.steps[0]; } });
  assert.equal(sanitizeExecutionSnapshot(arrayGetter), null);
  assert.equal(accessed, 0);
});

test("recording failures and excess steps preserve generation-independent bounded metadata", () => {
  const journal = createSessionExecution(identity, () => { throw new Error("private disk path"); });
  assert.doesNotThrow(() => {
    for (let index = 0; index < EXECUTION_MAX_STEPS + 20; index++) journal.record("model", "invoked", {
      callIndex: index + 1, request: metadata() });
  });
  const snapshot = journal.read();
  assert(snapshot.steps.length > 0);
  assert(snapshot.steps.length <= EXECUTION_MAX_STEPS);
  assert(Buffer.byteLength(JSON.stringify(snapshot)) <= EXECUTION_MAX_BYTES);
  assert.equal(snapshot.lastSequence, EXECUTION_MAX_STEPS + 20);
  assert.equal(snapshot.truncated, true);
  assert.equal(sanitizeExecutionSnapshot({ ...snapshot, truncated: false }), null);
  assert.doesNotMatch(JSON.stringify(snapshot), /private disk path/);
});
