"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { setImmediate: nextTick } = require("node:timers/promises");
const { createOpenAICompatibleProvider } = require("../providers/openai-compatible");
const { createAdventureSession } = require("./adventure-session");
const { createTurnStore } = require("./turn-store");
const timePolicy = require("../runtime/model-time-policy");
const samples = require("./test-fixtures/turn-samples");

function controlledClock(t) {
  let now = 0;
  t.mock.method(require("node:perf_hooks").performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return async (milliseconds) => {
    now += milliseconds;
    t.mock.timers.tick(milliseconds);
    await nextTick();
  };
}

function controlledProvider(options = {}) {
  const calls = [];
  const provider = createOpenAICompatibleProvider({ baseUrl: "https://synthetic.invalid/v1",
    model: "synthetic-model", apiKey: "synthetic-key", ...options,
    requestImpl(_url, request) {
      return new Promise((resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        calls.push({ request, respond(message = { role: "assistant", content: "{}" }) {
          resolve({ status: 200, text: async () => JSON.stringify({ choices: [{ message,
            finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }) });
        } });
      });
    },
  });
  return { provider, calls };
}

function sessionSandbox(t, provider, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-model-time-"));
  const identity = samples.identity(path.join(directory, "story.sqlite"));
  const { seedTurns = 0, ...sessionOptions } = options;
  if (seedTurns) {
    const store = createTurnStore({ ...identity, initialState: samples.initialState() });
    try {
      for (let revision = 0; revision < seedTurns; revision++) {
        const action = store.beginAction(samples.request({ actionId: `seed-${revision}`, baseRevision: revision }));
        store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: {
          narration: [{ id: "s", text: "楼道里传来缓慢的脚步声，你侧耳听着。".repeat(50) }], events: [], experiences: [],
        } });
      }
    } finally { store.close(); }
  }
  const session = createAdventureSession({ ...identity,
    ...(seedTurns ? {} : { initialState: samples.initialState() }),
    hostText: "克制、具体的冒险主持人。", worldText: "上海爆发后第十天。", provider, ...sessionOptions });
  t.after(async () => { await session.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return session;
}

function storyMessage() {
  return { role: "assistant", content: JSON.stringify(samples.refusedBundle()) };
}

function toolMessage(index) {
  return { role: "assistant", content: "", tool_calls: [{ id: `read-${index}`, type: "function",
    function: { name: "read_entity", arguments: JSON.stringify({ entityId: "npc" }) } }] };
}

function invalidInventoryMessage(quantity) {
  return { role: "assistant", content: JSON.stringify(samples.borrowBundle({ quantity })) };
}

const mixedCorrections = () => [toolMessage(1),
  { role: "assistant", content: "{invalid JSON" }, invalidInventoryMessage(99), invalidInventoryMessage(98)];

test("desktop gameplay uses three minutes while connection probes retain forty-five seconds", () => {
  const mainPath = path.resolve(__dirname, "../../apps/desktop/electron/main.js");
  const source = fs.readFileSync(mainPath, "utf8");
  function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0);
    const end = source.indexOf("\nfunction ", start + 1);
    assert(end > start);
    return source.slice(start, end);
  }
  const context = vm.createContext({ ...timePolicy, CUSTOM_PROVIDER_ID: "custom",
    PROVIDER_REGISTRY: { create: config => config }, PROVIDER_HTTPS_REQUEST: () => {},
    getCustomConnection: (connections, id) => connections.find(connection => connection.id === id) });
  new vm.Script([extract("createProviderForSettings"), extract("createProviderConfig")].join("\n")).runInContext(context);
  const settings = { api: { provider: "deepseek", model: "synthetic-model" } };
  assert.equal(context.createProviderForSettings(settings, "synthetic-key").timeoutMs, 180_000);
  assert.equal(context.createProviderForSettings(settings, "synthetic-key", timePolicy.CONNECTION_TEST_TIMEOUT_MS).timeoutMs, 45_000);
  const custom = { api: { provider: "custom", connectionId: "relay", customConnections: [
    { id: "relay", baseUrl: "https://synthetic.invalid/v1", modelId: "synthetic-model" },
  ] } };
  assert.equal(context.createProviderForSettings(custom, "synthetic-key").timeoutMs, 180_000);
  assert.equal(context.createProviderForSettings(custom, "synthetic-key").enforcePublicDns, true);
});

test("each model request can exceed one minute but has its own three-minute absolute deadline", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const first = provider.generate({ messages: [] });
  assert.equal(calls[0].request.headersTimeout, 180_000);
  assert.equal(calls[0].request.bodyTimeout, 180_000);
  await advance(130_000);
  assert.equal(calls[0].request.signal.aborted, false);
  calls[0].respond();
  assert.equal((await first).text, "{}");
  const second = provider.generate({ messages: [] });
  const timedOut = assert.rejects(second, error => error.code === "API_TIMEOUT" && error.retryable === true);
  await advance(179_999);
  assert.equal(calls[1].request.signal.aborted, false, "the second request has a fresh three-minute deadline");
  await advance(1);
  await timedOut;
  assert.equal(calls[1].request.signal.aborted, true);
});

test("explicit short provider budgets and player cancellation remain effective", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider({ timeoutMs: 50 });
  const timedOut = assert.rejects(provider.generate({ messages: [] }), error => error.code === "API_TIMEOUT");
  assert.equal(calls[0].request.headersTimeout, 50);
  await advance(49);
  assert.equal(calls[0].request.signal.aborted, false);
  await advance(1);
  await timedOut;
  const controller = new AbortController();
  const cancelled = assert.rejects(provider.generate({ messages: [], signal: controller.signal }), error => error.code === "REQUEST_ABORTED");
  controller.abort();
  await cancelled;
  assert.equal(calls[1].request.signal.aborted, true);
});

test("a player action can complete two slow model calls without losing the tool continuation", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const session = sessionSandbox(t, provider);
  const pending = session.runAction(samples.request());
  await nextTick();
  assert.equal(calls.length, 1);
  await advance(130_000);
  calls[0].respond(toolMessage(1));
  await nextTick();
  assert.equal(calls.length, 2);
  const secondBody = JSON.parse(calls[1].request.body);
  assert(secondBody.messages.some(message => message.role === "tool" && message.tool_call_id === "read-1"));
  await advance(130_000);
  assert.equal(calls[1].request.signal.aborted, false);
  calls[1].respond(storyMessage());
  const result = await pending;
  assert.equal(result.status, "committed");
  assert.equal(result.modelCalls, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(session.readView().revision, 1);
});

test("four model calls share the five-minute action deadline and cannot commit after it", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const session = sessionSandbox(t, provider);
  const pending = session.runAction(samples.request());
  await nextTick();
  for (let index = 0; index < 3; index++) {
    assert.equal(calls.length, index + 1);
    await advance(80_000);
    calls[index].respond(toolMessage(index + 1));
    await nextTick();
  }
  assert.equal(calls.length, 4);
  await advance(59_999);
  assert.equal(calls[3].request.signal.aborted, false);
  await advance(1);
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "TURN_TIMEOUT");
  assert.equal(calls[3].request.signal.aborted, true, "the action deadline stops a request with time remaining");
  assert.equal(session.readView().revision, 0);
  calls[3].respond(storyMessage());
  await nextTick();
  assert.equal(session.readView().revision, 0);
});

test("a bounded output correction gets a new request deadline while preserving the original action", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const session = sessionSandbox(t, provider);
  const pending = session.runAction(samples.request());
  await nextTick();
  await advance(130_000);
  calls[0].respond({ role: "assistant", content: "{invalid JSON" });
  await nextTick();
  assert.equal(calls.length, 2);
  await advance(130_000);
  assert.equal(calls[1].request.signal.aborted, false);
  calls[1].respond(storyMessage());
  const result = await pending;
  assert.equal(result.status, "committed");
  assert.equal(result.actionId, samples.request().actionId);
  assert.equal(result.modelCalls, 2);
  assert.equal(session.readView().revision, 1);
});

test("three corrections shared across JSON and state validation can succeed after a tool call within five minutes", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const session = sessionSandbox(t, provider, { maxModelCalls: 8, maxAttempts: 4 });
  const pending = session.runAction(samples.request());
  await nextTick();
  const replies = [...mixedCorrections(), { role: "assistant", content: JSON.stringify(samples.borrowBundle()) }];
  for (const [index, reply] of replies.entries()) {
    assert.equal(calls.length, index + 1);
    await advance(50_000);
    assert.equal(calls[index].request.signal.aborted, false);
    calls[index].respond(reply);
    await nextTick();
  }
  const result = await pending;
  assert.equal(result.status, "committed");
  assert.equal(result.modelCalls, 5);
  assert.equal(result.toolCalls, 1, "correction never re-executes the earlier tool");
  samples.assertBorrowed(assert, session.readView());
});

test("a fourth requested correction stops before the model-call or five-minute budgets run out", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const session = sessionSandbox(t, provider, { maxModelCalls: 8, maxAttempts: 4 });
  const pending = session.runAction(samples.request());
  await nextTick();
  const replies = [...mixedCorrections(), invalidInventoryMessage(97)];
  for (const [index, reply] of replies.entries()) {
    assert.equal(calls.length, index + 1);
    await advance(50_000);
    calls[index].respond(reply);
    await nextTick();
  }
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "REPAIR_BUDGET_EXCEEDED");
  assert.equal(result.modelCalls, 5, "the unused three model calls cannot authorize a fourth correction");
  assert.equal(calls.length, 5);
  assert.equal(session.readView().revision, 0);
});

test("JSON and state correction do not reset the action deadline or accept a late valid candidate", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const session = sessionSandbox(t, provider, { maxModelCalls: 8, maxAttempts: 4 });
  const pending = session.runAction(samples.request());
  await nextTick();
  for (const [index, reply] of mixedCorrections().slice(0, 3).entries()) {
    await advance(80_000);
    calls[index].respond(reply);
    await nextTick();
  }
  assert.equal(calls.length, 4);
  await advance(59_999);
  assert.equal(calls[3].request.signal.aborted, false);
  await advance(1);
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "TURN_TIMEOUT");
  assert.equal(calls[3].request.signal.aborted, true);
  calls[3].respond({ role: "assistant", content: JSON.stringify(samples.borrowBundle()) });
  await nextTick();
  assert.equal(session.readView().revision, 0);
  assert.equal(calls.length, 4);
});

test("a single three-minute request timeout remains classified and does not spend a correction", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const session = sessionSandbox(t, provider);
  const pending = session.runAction(samples.request());
  await nextTick();
  await advance(180_000);
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "API_TIMEOUT");
  assert.equal(result.error.retryable, true);
  assert.equal(result.modelCalls, 1);
  calls[0].respond(storyMessage());
  await nextTick();
  assert.equal(calls.length, 1);
  assert.equal(session.readView().revision, 0);
});

test("stopping during correction preserves the input and rejects a late model answer", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const session = sessionSandbox(t, provider);
  const controller = new AbortController();
  const request = samples.request();
  const pending = session.runAction(request, { signal: controller.signal });
  await nextTick();
  await advance(40_000);
  calls[0].respond({ role: "assistant", content: "{invalid JSON" });
  await nextTick();
  assert.equal(calls.length, 2);
  controller.abort();
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(calls[1].request.signal.aborted, true);
  calls[1].respond(storyMessage());
  await nextTick();
  assert.equal(session.readAction(request.actionId).request.input, request.input);
  assert.equal(session.readView().revision, 0);
  assert.equal(calls.length, 2);
});

for (const kind of ["chapter", "compaction"]) test(`${kind} owns a three-minute job deadline, with explicit short overrides preserved`, async (t) => {
  for (const timeoutMs of [undefined, 50]) await t.test(timeoutMs === undefined ? "production deadline" : "explicit override", async (t) => {
    const advance = controlledClock(t);
    const calls = [];
    // Deliberately uncooperative: this tests the job's deadline independently
    // of the provider adapter's request timer.
    const provider = { generate(request) { calls.push(request); return new Promise(() => {}); } };
    const seedTurns = kind === "chapter" ? 1 : 30;
    const session = sessionSandbox(t, provider, { seedTurns,
      ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    const pending = kind === "chapter" ? session.saveChapter({ targetRevision: seedTurns })
      : session.compactContext({ requestId: "manual-compaction", revision: seedTurns });
    await nextTick();
    assert.equal(calls.length, 1);
    await advance((timeoutMs ?? 180_000) - 1);
    assert.equal(calls[0].signal.aborted, false);
    await advance(1);
    const result = await pending;
    assert.equal(kind === "chapter" ? result.chapterStatus : result.status, "failed");
    assert.equal(result.error.code, kind === "chapter" ? "CHAPTER_TIMEOUT" : "COMPACTION_TIMEOUT");
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(session.readView().revision, seedTurns);
  });
});

for (const kind of ["chapter", "compaction"]) test(`${kind} correction keeps only the remainder of its original three-minute deadline`, async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const seedTurns = kind === "chapter" ? 1 : 30;
  const session = sessionSandbox(t, provider, { seedTurns });
  const pending = kind === "chapter" ? session.saveChapter({ targetRevision: seedTurns })
    : session.compactContext({ requestId: "manual-compaction", revision: seedTurns });
  await nextTick();
  assert.equal(calls.length, 1);
  await advance(120_000);
  calls[0].respond({ role: "assistant", content: "{invalid JSON" });
  await nextTick();
  assert.equal(calls.length, 2);
  await advance(59_999);
  assert.equal(calls[1].request.signal.aborted, false);
  await advance(1);
  const result = await pending;
  assert.equal(kind === "chapter" ? result.chapterStatus : result.status, "failed");
  assert.equal(result.error.code, kind === "chapter" ? "CHAPTER_TIMEOUT" : "COMPACTION_TIMEOUT");
  assert.equal(calls[1].request.signal.aborted, true);
  assert.equal(session.readView().revision, seedTurns);
});

test("an explicitly shorter session budget still bounds the entire action", async (t) => {
  const advance = controlledClock(t);
  const { provider, calls } = controlledProvider();
  const session = sessionSandbox(t, provider, { timeoutMs: 50 });
  const pending = session.runAction(samples.request());
  await nextTick();
  await advance(50);
  const result = await pending;
  assert.equal(result.error.code, "TURN_TIMEOUT");
  assert.equal(calls[0].request.signal.aborted, true);
  assert.equal(session.readView().revision, 0);
});
