"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createAdventureSession } = require("./adventure-session");
const { createTurnStore } = require("./turn-store");
const { createTurnCoordinator } = require("./turn-coordinator");
const { createTurnGenerator } = require("./turn-generator");
const { createTurnMemory } = require("./turn-memory");
const samples = require("./test-fixtures/turn-samples");

function sandbox(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-execution-integration-"));
  const databasePath = path.join(directory, "story.sqlite");
  const sessions = [];
  t.after(async () => { for (const session of sessions) await session.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { databasePath, open(provider, options = {}) {
    const session = createAdventureSession({ ...samples.identity(databasePath), provider,
      hostText: "克制、具体。", worldText: "上海。", ...options });
    sessions.push(session); return session;
  } };
}

const response = extra => ({ text: JSON.stringify(samples.borrowBundle()), finishReason: "stop",
  usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140, prompt_cache_hit_tokens: 25 }, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("actual requests, tools and JSON repair survive session release and reopening without storing their text", async t => {
  const env = sandbox(t);
  const delivered = [];
  const session = env.open({ async generate({ signal, ...payload }) {
    const serialized = JSON.stringify(payload);
    delivered.push({ sha256: createHash("sha256").update(serialized).digest("hex"),
      characters: serialized.length, bytes: Buffer.byteLength(serialized) });
    if (delivered.length === 1) return response({ text: "", finishReason: "tool_calls", toolCalls: [
      { id: "memory-call", name: "recall_memory", arguments: '{"query":"陈姨"}' },
    ], transportState: { private: "PRIVATE_TRANSPORT_PAYLOAD" } });
    if (delivered.length === 2) return response({ text: '{"narration": PRIVATE_INVALID_REPLY' });
    return response();
  } }, { initialState: samples.initialState() });
  const result = await session.runAction(samples.request());
  assert.equal(result.status, "committed");
  assert.equal(result.modelCalls, 3); assert.equal(result.toolCalls, 1);
  samples.assertBorrowed(assert, result.view);
  const diagnostic = session.readDiagnostics();
  assert.equal(diagnostic.execution.records.length, 1);
  const record = diagnostic.execution.records[0];
  assert.equal(record.status, "committed"); assert.equal(record.incomplete, false);
  assert.deepEqual(record.steps.map(step => `${step.kind}:${step.outcome}`), [
    "model:invoked", "model:returned", "tool:invoked", "tool:returned",
    "model:invoked", "model:returned", "repair:requested", "model:invoked", "model:returned",
  ]);
  assert.deepEqual(record.steps.filter(step => step.kind === "model" && step.outcome === "invoked")
    .map(step => { const { sha256, characters, bytes } = step.request; return { sha256, characters, bytes }; }), delivered);
  assert.equal(record.steps.find(step => step.kind === "repair").reason, "json_syntax");
  const returned = record.steps.filter(step => step.kind === "model" && step.outcome === "returned");
  assert.equal(returned.reduce((total, step) => total + step.usage.input_tokens, 0), result.usage.input_tokens);
  assert.equal(returned.reduce((total, step) => total + step.usage.output_tokens, 0), result.usage.output_tokens);
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_|陈姨|递给|arguments|transportState|messages/);
  const duplicate = await session.runAction(samples.request());
  assert.equal(duplicate.modelCalls, 0); assert.equal(delivered.length, 3);
  assert.deepEqual(session.readDiagnostics().execution, diagnostic.execution);
  await session.close();
  const reopened = env.open({ generate() { throw new Error("reopening is not generation"); } });
  assert.deepEqual(reopened.readDiagnostics().execution, diagnostic.execution);
  assert.deepEqual(reopened.readView(), result.view);
});

test("an explicit retry preserves the earlier failed attempt instead of interpreting duplicate zero calls as historical usage", async t => {
  const env = sandbox(t); let calls = 0;
  const session = env.open({ async generate() {
    if (++calls === 1) throw new Error("PRIVATE_PROVIDER_FAILURE /Users/private/key");
    return response({ usage: undefined });
  } }, { initialState: samples.initialState() });
  assert.equal((await session.runAction(samples.request())).status, "failed");
  const earlier = session.readDiagnostics().execution.records[0];
  assert.equal(earlier.error.code, "TURN_GENERATION_FAILED");
  const retried = await session.runAction(samples.request(), { retry: true });
  assert.equal(retried.status, "committed"); assert.equal(calls, 2);
  const records = session.readDiagnostics().execution.records;
  assert.equal(records.length, 2); assert.equal(new Set(records.map(record => record.attemptId)).size, 2);
  assert.deepEqual(records.find(record => record.attemptId === earlier.attemptId), earlier);
  const latest = records.find(record => record.status === "committed");
  const returned = latest.steps.find(step => step.kind === "model" && step.outcome === "returned");
  assert.equal(returned.usage, null); assert.equal(returned.usageComplete, false);
  assert.equal((await session.runAction(samples.request())).modelCalls, 0);
  assert.deepEqual(session.readDiagnostics().execution.records, records);
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_|\/Users/);
});

test("cancelled late replies cannot fill unknown usage or alter persisted execution", async t => {
  const env = sandbox(t); const entered = deferred(); const delayed = deferred();
  const session = env.open({ generate() { entered.resolve(); return delayed.promise; } }, { initialState: samples.initialState() });
  const running = session.runAction(samples.request());
  await entered.promise;
  session.cancelAction(samples.request().actionId);
  assert.equal((await running).status, "cancelled");
  const stopped = session.readDiagnostics().execution;
  assert.equal(stopped.records[0].incomplete, true);
  assert.deepEqual(stopped.records[0].steps.map(step => step.outcome), ["invoked"]);
  delayed.resolve(response());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(session.readDiagnostics().execution, stopped);
  assert.equal(session.readView().revision, 0);
});

test("a lost suffix of execution metadata cannot invalidate the story or masquerade as a complete earlier prefix", async t => {
  const env = sandbox(t); let writes = 0; let committed = false; let calls = 0; let rejected = 0;
  // Fault injection belongs to the store, not the public adventure options.
  const store = createTurnStore({ ...samples.identity(env.databasePath), initialState: samples.initialState(), faultInjector(stage) {
    if (stage === "after_commit") committed = true;
    if (stage === "execution_before_write" && ++writes >= 4 && !committed) {
      rejected++; throw new Error("PRIVATE_DIAGNOSTIC_DISK_FAILURE");
    }
  } });
  const generator = createTurnGenerator({ store, memory: createTurnMemory({ store }), adventureId: "test-adventure",
    hostText: "克制、具体。", worldText: "上海。", provider: { async generate() {
      return ++calls === 1 ? response({ text: "INVALID_JSON" }) : response();
    } } });
  const coordinator = createTurnCoordinator({ store, generateTurn: generator.generateTurn });
  const session = { runAction: coordinator.runAction, readDiagnostics: store.readDiagnostics,
    close() { coordinator.shutdown(); store.close(); } };
  t.after(() => session.close());
  const result = await session.runAction(samples.request());
  assert.equal(result.status, "committed"); assert.equal(calls, 2);
  assert.ok(committed && rejected > 0, "diagnostic faults must actually be injected before the durable story commit");
  generator.releaseAttempt(result.executionAttemptId);
  samples.assertBorrowed(assert, result.view);
  const diagnostic = session.readDiagnostics();
  assert.equal(diagnostic.execution.records[0].status, "committed");
  assert.equal(diagnostic.execution.records[0].incomplete, true, "the retained prefix is not proof that later calls did not happen");
  assert.equal((await session.runAction(samples.request())).modelCalls, 0);
  await session.close();
  const reopened = env.open({ generate() { throw new Error("must not regenerate committed story"); } });
  assert.deepEqual(reopened.readView(), result.view);
  assert.equal(reopened.readDiagnostics().execution.records[0].incomplete, true);
});
