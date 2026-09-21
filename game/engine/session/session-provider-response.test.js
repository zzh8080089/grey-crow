"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDeepSeekProvider } = require("../providers/deepseek");
const { createOpenAICompatibleProvider } = require("../providers/openai-compatible");

function fakeProvider(body) {
  let calls = 0;
  const provider = createDeepSeekProvider({ apiKey: "synthetic-private-key", async requestImpl() {
    calls++;
    return new Response(JSON.stringify(typeof body === "function" ? body(calls) : body), { status: 200 });
  } });
  return { provider, count: () => calls };
}
function exhausted(content, extra = {}) {
  return { model: "synthetic-model", choices: [{ message: { role: "assistant", content,
    reasoning_content: "synthetic-private-reasoning" }, finish_reason: "length" }],
  usage: { prompt_tokens: 123, completion_tokens: 8192, total_tokens: 8315,
    completion_tokens_details: { reasoning_tokens: 8192 } }, ...extra };
}

test("DeepSeek thinking mode is explicit per request and leaves ordinary defaults and output caps unchanged", async () => {
  const bodies = [];
  const provider = createDeepSeekProvider({ apiKey: "synthetic-key", async requestImpl(_url, options) {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] }), { status: 200 });
  } });
  for (const thinkingMode of [undefined, "disabled", undefined, "enabled"]) {
    await provider.generate({ messages: [{ role: "user", content: "Return JSON." }], tools: [],
      responseFormat: { type: "json_object" }, maxOutputTokens: 8192,
      ...(thinkingMode === undefined ? {} : { thinkingMode }) });
    const body = bodies.at(-1);
    assert.deepEqual(body.thinking, thinkingMode === undefined ? undefined : { type: thinkingMode });
    assert.equal(Object.hasOwn(body, "thinking"), thinkingMode !== undefined);
    assert.equal(Object.hasOwn(body, "thinkingMode"), false);
    assert.equal(Object.hasOwn(body, "reasoning_effort"), false);
    assert.equal(body.max_tokens, 8192);
    assert.deepEqual(body.response_format, { type: "json_object" });
  }
  assert.equal(bodies.length, 4);
});

test("fresh DeepSeek uses the canonical Flash ID while explicit legacy and custom IDs remain exact", async () => {
  for (const model of [undefined, "deepseek-v4-flash", "deepseek-v4-pro", "private-custom-model-id"]) {
    let body;
    const provider = createDeepSeekProvider({ apiKey: "synthetic-key", ...(model ? { model } : {}),
      async requestImpl(url, options) {
        assert.equal(url, "https://api.deepseek.com/chat/completions");
        body = JSON.parse(options.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] }));
      } });
    await provider.generate({ messages: [] });
    assert.equal(body.model, model || "deepseek-flash");
    assert.equal(provider.model, model || "deepseek-flash");
  }
});

test("upstream 401, 402, and 403 retain separate safe connection diagnoses", async () => {
  for (const [status, code, message] of [
    [401, "UPSTREAM_AUTH_ERROR", "authentication failed"],
    [402, "UPSTREAM_BALANCE_ERROR", "requires payment"],
    [403, "UPSTREAM_ACCESS_DENIED", "denied access"],
  ]) {
    const provider = createDeepSeekProvider({ apiKey: "synthetic-private-key", async requestImpl() {
      return new Response(JSON.stringify({ error: { code: "forbidden" } }), { status });
    } });
    await assert.rejects(provider.generate({ messages: [] }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.retryable, false);
      assert.match(error.message, new RegExp(message));
      assert.doesNotMatch(JSON.stringify(error), /synthetic-private|synthetic_private/);
      return true;
    });
  }
});

test("only the official OpenAI endpoint uses max_completion_tokens without guessing from model or provider names", async () => {
  for (const [baseUrl, providerName, model, tokenField] of [
    ["https://api.openai.com/v1/", "openai-compatible", "custom-model-id", "max_completion_tokens"],
    ["https://api.openai.com/v1/chat/completions", "openai-compatible", "o3", "max_completion_tokens"],
    ["https://proxy.example/v1", "openai", "o3", "max_tokens"],
    ["https://api.openai.com.example/v1", "openai-compatible", "gpt-5", "max_tokens"],
    ["https://api.openai.com/custom/v1", "openai-compatible", "gpt-5", "max_tokens"],
    ["https://api.deepseek.com", "deepseek", "deepseek-flash", "max_tokens"],
  ]) {
    let body;
    const provider = createOpenAICompatibleProvider({ baseUrl, providerName, model, apiKey: "synthetic-key",
      async requestImpl(_url, options) {
        body = JSON.parse(options.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] }));
      } });
    await provider.generate({ messages: [], maxOutputTokens: 8192 });
    assert.equal(body[tokenField], 8192);
    assert.equal(Object.hasOwn(body, tokenField === "max_tokens" ? "max_completion_tokens" : "max_tokens"), false);
    assert.equal(body.model, model);
  }
});

test("upstream aborted is an API failure even when its partial text is valid JSON", async () => {
  for (const content of [null, "", '{"narration":[]}']) {
    const fixture = fakeProvider({ choices: [{ message: { role: "assistant", content }, finish_reason: "aborted" }] });
    await assert.rejects(fixture.provider.generate({ messages: [] }), (error) => {
      assert.equal(error.code, "UPSTREAM_SERVER_ERROR");
      assert.equal(error.retryable, true);
      assert.doesNotMatch(JSON.stringify(error), /narration|synthetic-private/);
      return true;
    });
    assert.equal(fixture.count(), 1);
  }
});

test("Gemini tool signatures survive parallel and sequential continuations only on their matching call", async () => {
  const baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai", model = "gemini-synthetic";
  const bodies = [];
  const signatureA = 'opaque "signature" \\n 😀 sk-synthetic-never-redact', signatureB = "second-signature==";
  const call = (id, signature) => ({ id, type: "function", function: { name: "lookup", arguments: "{}" },
    ...(signature === undefined ? {} : { extra_content: { google: { thought_signature: signature, unknown: "never-copy" }, other: "never-copy" } }) });
  const replies = [
    { role: "assistant", content: null, tool_calls: [call("call-a", signatureA), call("call-parallel")] },
    { role: "assistant", content: null, tool_calls: [call("call-b", signatureB)] },
    { role: "assistant", content: "Done." },
  ];
  const provider = createOpenAICompatibleProvider({ baseUrl, model, apiKey: "synthetic-key", async requestImpl(_url, options) {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: replies[bodies.length - 1], finish_reason: bodies.length < 3 ? "tool_calls" : "stop" }] }));
  } });
  const messages = [{ role: "user", content: "Look up two places, then follow up." }];
  const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }];
  for (let step = 0; step < 3; step++) {
    const response = await provider.generate({ messages, tools: step === 2 ? [] : tools });
    assert.doesNotMatch(JSON.stringify({ toolCalls: response.toolCalls, text: response.text, meta: response.meta }), /signature|never-copy/);
    if (step < 2) {
      messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls, transportState: response.transportState });
      for (const tool of response.toolCalls) messages.push({ role: "tool", toolCallId: tool.id, content: "{}" });
    }
  }
  const continuations = bodies[2].messages.filter((message) => message.role === "assistant");
  assert.deepEqual(continuations[0].tool_calls[0].extra_content, { google: { thought_signature: signatureA } });
  assert.equal(Object.hasOwn(continuations[0].tool_calls[1], "extra_content"), false);
  assert.deepEqual(continuations[1].tool_calls[0].extra_content, { google: { thought_signature: signatureB } });
  assert.doesNotMatch(JSON.stringify(bodies), /transportState|toolSignatures|never-copy/);
  const snapshot = structuredClone(messages);
  for (const [otherUrl, otherModel] of [[baseUrl, "different-model"], ["https://proxy.example/v1", model]]) {
    let otherBody;
    const other = createOpenAICompatibleProvider({ baseUrl: otherUrl, model: otherModel, apiKey: "synthetic-key", async requestImpl(_url, options) {
      otherBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Done." }, finish_reason: "stop" }] }));
    } });
    await other.generate({ messages });
    assert.doesNotMatch(JSON.stringify(otherBody), /thought_signature|toolSignatures|transportState/);
  }
  assert.deepEqual(messages, snapshot);
});

test("malformed or oversized Gemini signatures fail safely without copying unknown response extensions", async () => {
  for (const signature of [null, 42, {}, "", "s".repeat(256 * 1024 + 1)]) {
    const provider = createOpenAICompatibleProvider({ baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-synthetic", apiKey: "synthetic-key", async requestImpl() {
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null,
          tool_calls: [{ id: "call-a", type: "function", function: { name: "lookup", arguments: "{}" },
            extra_content: { google: { thought_signature: signature }, unknown: "synthetic-private-extension" } }] }, finish_reason: "tool_calls" }] }));
      } });
    await assert.rejects(provider.generate({ messages: [] }), (error) => {
      assert.equal(error.code, "UPSTREAM_BAD_RESPONSE");
      assert.doesNotMatch(JSON.stringify(error), /synthetic-private|thought_signature/);
      return true;
    });
  }
});

test("the actual Gemini connection probe replays its tool signature without exposing it in the success result", async () => {
  const { runProviderCompatibilityProbe, PROBE_TOOL_NAME } = require("../providers/connection-probe");
  const signature = "synthetic-private-opaque-signature==";
  let calls = 0;
  const provider = createOpenAICompatibleProvider({ baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-synthetic", apiKey: "synthetic-key", async requestImpl(_url, options) {
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(body.max_tokens, 128);
      if (calls === 1) return new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: {
        role: "assistant", content: null, tool_calls: [{ id: "probe-call", type: "function",
          function: { name: PROBE_TOOL_NAME, arguments: "{}" }, extra_content: { google: { thought_signature: signature } } }],
      } }] }));
      const assistant = body.messages.find((message) => message.role === "assistant");
      assert.deepEqual(assistant.tool_calls[0].extra_content, { google: { thought_signature: signature } });
      assert.equal(body.messages.find((message) => message.role === "tool").tool_call_id, "probe-call");
      assert.equal(Object.hasOwn(assistant, "transportState"), false);
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Connected." } }] }));
    } });
  const result = await runProviderCompatibilityProbe({ provider });
  assert.equal(result.ok, true);
  assert.equal(result.providerCalls, 2);
  assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private|thought_signature|transportState/);
});

test("DeepSeek reasoning effort maps per request without changing defaults, thinking replay or output caps", async () => {
  const bodies = [];
  const provider = createDeepSeekProvider({ apiKey: "synthetic-key", model: "deepseek-flash", async requestImpl(_url, options) {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] }), { status: 200 });
  } });
  for (const options of [{ reasoningEffort: "low" }, { reasoningEffort: "high", thinkingMode: "enabled" },
    { reasoningEffort: "max" }, {}]) {
    const request = { messages: [{ role: "user", content: "Return JSON." },
      { role: "assistant", content: "{}", transportState: { protocolFamily: "openai-chat", reasoningContent: "synthetic-private-replay" } }],
    tools: [], responseFormat: { type: "json_object" }, maxOutputTokens: 8192, ...options };
    const snapshot = structuredClone(request);
    await provider.generate(request);
    const body = bodies.at(-1);
    assert.equal(body.reasoning_effort, options.reasoningEffort);
    assert.equal(Object.hasOwn(body, "reasoning_effort"), options.reasoningEffort !== undefined);
    assert.equal(Object.hasOwn(body, "reasoningEffort"), false);
    assert.deepEqual(body.thinking, options.thinkingMode ? { type: options.thinkingMode } : undefined);
    assert.equal(body.messages[1].reasoning_content, "synthetic-private-replay");
    assert.equal(body.max_tokens, 8192);
    assert.equal(body.model, "deepseek-flash");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.deepEqual(request, snapshot);
  }
  assert.equal(bodies.length, 4);
});

test("other OpenAI-compatible providers never receive the DeepSeek thinking or effort options", async () => {
  for (const providerName of ["openai-compatible", "openai", "custom"]) {
    let body;
    const provider = createOpenAICompatibleProvider({ providerName, model: "synthetic-model", apiKey: "synthetic-key",
      baseUrl: "https://model.example/v1", async requestImpl(_url, options) {
        body = JSON.parse(options.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] }), { status: 200 });
      } });
    await provider.generate({ messages: [], thinkingMode: "disabled", reasoningEffort: "low", maxOutputTokens: 8192 });
    assert.equal(body.max_tokens, 8192);
    assert.equal(Object.hasOwn(body, "thinkingMode"), false);
    assert.equal(Object.hasOwn(body, "thinking"), false);
    assert.equal(Object.hasOwn(body, "reasoningEffort"), false);
    assert.equal(Object.hasOwn(body, "reasoning_effort"), false);
  }
});

test("invalid DeepSeek thinking options fail before HTTP without exposing the supplied value", async () => {
  const fake = fakeProvider(exhausted(""));
  for (const thinkingMode of [null, false, 42, {}, "synthetic-private-invalid-mode"]) {
    await assert.rejects(fake.provider.generate({ messages: [], thinkingMode }), (error) => {
      assert.equal(error.code, "INVALID_PROVIDER_CONFIG");
      assert.equal(error.retryable, false);
      assert.doesNotMatch(JSON.stringify(error), /synthetic-private/);
      return true;
    });
  }
  assert.equal(fake.count(), 0);
});

test("invalid DeepSeek effort and disabled-thinking combinations fail before HTTP with safe errors", async () => {
  const fake = fakeProvider(exhausted(""));
  const invalid = [null, false, 42, {}, [], "", "minimal", "medium", "xhigh", "ultra", "LOW", "synthetic-private-invalid-effort"];
  const options = [...invalid.map(reasoningEffort => ({ reasoningEffort })),
    ...["low", "high", "max"].map(reasoningEffort => ({ reasoningEffort, thinkingMode: "disabled" }))];
  for (const option of options) {
    await assert.rejects(fake.provider.generate({ messages: [], ...option }), (error) => {
      assert.equal(error.code, "INVALID_PROVIDER_CONFIG");
      assert.equal(error.retryable, false);
      assert.doesNotMatch(`${error.message}\n${JSON.stringify(error)}`, /synthetic-private/);
      return true;
    });
  }
  assert.equal(fake.count(), 0);
});

test("empty and null final content preserve recognized stop reasons and actual usage without exposing reasoning as prose", async () => {
  for (const finishReason of ["stop", "length", "tool_calls", "content_filter", "insufficient_system_resource"]) for (const content of ["", null]) {
    const body = exhausted(content);
    body.choices[0].finish_reason = finishReason;
    const fake = fakeProvider(body);
    const response = await fake.provider.generate({ messages: [{ role: "user", content: "Return JSON." }], maxOutputTokens: 8192 });
    assert.equal(fake.count(), 1);
    assert.equal(response.text, "");
    assert.equal(response.finishReason, finishReason);
    assert.equal(response.usage.input_tokens, 123);
    assert.equal(response.usage.output_tokens, 8192);
    assert.equal(response.usage.reasoning_tokens, 8192);
    assert.equal(response.usage.total_tokens, 8315);
    assert.equal(response.transportState.reasoningContent, "synthetic-private-reasoning");
    assert.equal(Object.hasOwn(response, "raw"), false);
    assert.doesNotMatch(JSON.stringify({ text: response.text, meta: response.meta, usage: response.usage }), /synthetic-private/);
  }
});

test("a length stop needs no reasoning or usage report and never invents zero usage", async () => {
  const fake = fakeProvider({ choices: [{ message: { role: "assistant", content: null }, finish_reason: "length" }] });
  const response = await fake.provider.generate({ messages: [] });
  assert.equal(fake.count(), 1);
  assert.equal(response.text, "");
  assert.equal(response.finishReason, "length");
  assert.equal(response.usage, null);
  assert.equal(Object.hasOwn(response, "transportState"), false);
});

test("a length marker does not make malformed upstream shapes acceptable", async () => {
  const invalid = [null, {}, { choices: [] }, { choices: [null] },
    { choices: [{ finish_reason: "length" }] },
    { choices: [{ message: [], finish_reason: "length" }] },
    ...[
      { role: "assistant" },
      { role: "assistant", content: { private: "synthetic-private-body" } },
      { role: "assistant", content: null, reasoning_content: 42 },
      { role: "assistant", content: null, tool_calls: "invalid" },
      { role: "user", content: null },
    ].map((message) => ({ choices: [{ message, finish_reason: "length" }] })),
    { choices: [{ message: { role: "assistant", content: null }, finish_reason: "unknown" }] },
    { choices: [{ message: { role: "assistant", content: "" } }] },
  ];
  for (const body of invalid) {
    const fake = fakeProvider(body);
    await assert.rejects(fake.provider.generate({ messages: [] }), (error) => {
      assert.equal(error.code, "UPSTREAM_BAD_RESPONSE");
      assert.equal(error.status, 200);
      assert.doesNotMatch(JSON.stringify(error), /synthetic-private/);
      return true;
    });
    assert.equal(fake.count(), 1);
  }
});

async function checkCompaction(t, finishReason) {
  const { createTurnStore } = require("./turn-store");
  const { createTurnMemory } = require("./turn-memory");
  const { createTurnGenerator } = require("./turn-generator");
  const { createSessionCompaction } = require("./session-compaction");
  const samples = require("./test-fixtures/turn-samples");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-empty-provider-response-"));
  const store = createTurnStore({ ...samples.identity(path.join(root, "session.sqlite")), initialState: samples.initialState() });
  let service;
  t.after(async () => { await service?.shutdown(); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  for (let index = 0; index < 3; index++) {
    const action = store.beginAction(samples.request({ actionId: `turn-${index}`, baseRevision: index, input: "我观察楼道。" }));
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
      bundle: { narration: [{ id: "scene", text: "窗外仍很安静，门把手有些松动。".repeat(20) }], events: [], experiences: [] } });
  }
  const original = store.readView();
  const body = exhausted("");
  body.choices[0].finish_reason = finishReason;
  const fake = fakeProvider(body);
  const generator = createTurnGenerator({ store, memory: createTurnMemory({ store }), adventureId: "test-adventure",
    provider: { generate() { throw new Error("Unexpected story generation"); } }, hostText: "克制、具体。", worldText: "上海第十天。", maxOutputTokens: 8192 });
  service = createSessionCompaction({ store, generator, provider: fake.provider, maxOutputTokens: 8192 });
  const result = await service.compact({ requestId: "empty-length-response", revision: 3 });
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, finishReason === "length" ? "COMPACTION_OUTPUT_BUDGET_EXCEEDED" : "COMPACTION_OUTPUT_INVALID");
  const expectedCalls = finishReason === "length" ? 1 : 4;
  assert.equal(result.modelCalls, expectedCalls);
  assert.equal(fake.count(), expectedCalls);
  assert.equal(result.usage.input_tokens, 123 * expectedCalls);
  assert.equal(result.usage.output_tokens, 8192 * expectedCalls);
  assert.equal(result.usage.reasoning_tokens, 8192 * expectedCalls);
  assert.equal(result.usage.total_tokens, 8315 * expectedCalls);
  assert.equal(result.usageComplete, true);
  assert.equal(store.readContextHistory().summary, null);
  assert.deepEqual(store.readView(), original);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private/);
}

test("a real compaction classifies empty stop/length output, retains usage and preserves the original story", async (t) => {
  for (const finishReason of ["stop", "length"]) await t.test(finishReason, (t) => checkCompaction(t, finishReason));
});

test("connection and locale probes reject empty responses after transport accepts their valid shape", async () => {
  const { runProviderCompatibilityProbe, runProviderLocaleQualityProbe } = require("../providers/connection-probe");
  const empty = { choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }] };
  const firstEmpty = fakeProvider(empty);
  await assert.rejects(runProviderCompatibilityProbe({ provider: firstEmpty.provider }), { code: "MODEL_CAPABILITY_UNSUPPORTED" });
  assert.equal(firstEmpty.count(), 1);
  const finalEmpty = fakeProvider((number) => number === 2 ? empty : { choices: [{ message: {
    role: "assistant", content: null, tool_calls: [{ id: "probe", type: "function",
      function: { name: "grey_crow_connection_probe", arguments: "{}" } }],
  }, finish_reason: "tool_calls" }] });
  await assert.rejects(runProviderCompatibilityProbe({ provider: finalEmpty.provider }), { code: "MODEL_CAPABILITY_UNSUPPORTED" });
  assert.equal(finalEmpty.count(), 2);
  const localeEmpty = fakeProvider(empty);
  await assert.rejects(runProviderLocaleQualityProbe({ provider: localeEmpty.provider }), { code: "MODEL_CAPABILITY_UNSUPPORTED" });
  assert.equal(localeEmpty.count(), 1);
});

// These fixtures are already normalized Provider responses. They do not claim
// that the adapter preserved malformed raw upstream tool-call fields.
function normalizedProbe({ providerName = "deepseek", first, second } = {}) {
  const requests = [];
  const tool = { id: "provider-issued-probe-id", name: "grey_crow_connection_probe", arguments: "{}" };
  return { tool, requests, provider: { name: providerName, model: "synthetic-probe-model", async generate(request) {
    requests.push(structuredClone(request));
    assert(requests.length <= 2, "a compatibility probe must not retry");
    return requests.length === 1
      ? first ?? { text: "", toolCalls: [tool], finishReason: "tool_calls" }
      : second ?? { text: "Connection confirmed.", finishReason: "stop" };
  } } };
}

test("connection probe uses the one normalized response ID for its matching tool receipt and nonempty final", async () => {
  const { runProviderCompatibilityProbe, PROVIDER_COMPATIBILITY_CONTRACT_VERSION } = require("../providers/connection-probe");
  const tool = { ...normalizedProbe().tool, id: " provider-issued-probe-id " };
  const fixture = normalizedProbe({ first: { text: "", toolCalls: [tool], finishReason: "tool_calls" } });
  const result = await runProviderCompatibilityProbe({ provider: fixture.provider });
  assert.equal(result.ok, true);
  assert.equal(result.providerCalls, 2);
  assert.equal(fixture.requests.length, 2);
  const messages = fixture.requests[1].messages;
  const assistant = messages.find(message => message.role === "assistant");
  const receipts = messages.filter(message => message.role === "tool");
  assert.deepEqual(assistant.toolCalls, [tool]);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].toolCallId, tool.id);
  assert.deepEqual(JSON.parse(receipts[0].content), { ok: true, contract: PROVIDER_COMPATIBILITY_CONTRACT_VERSION });
  assert.deepEqual(fixture.requests[1].tools, []);
});

test("connection probe preserves DeepSeek thinking defaults on exactly two bounded technical requests", async () => {
  const { runProviderCompatibilityProbe } = require("../providers/connection-probe");
  const fixture = normalizedProbe();
  await runProviderCompatibilityProbe({ provider: fixture.provider });
  assert.equal(fixture.requests.length, 2);
  for (const request of fixture.requests) {
    assert.equal(Object.hasOwn(request, "thinkingMode"), false);
    assert.equal(request.maxOutputTokens, 128);
    assert.equal(Object.hasOwn(request, "reasoningEffort"), false);
  }
});

test("connection probe preserves DeepSeek reasoning replay, original IDs and empty-object arguments on the wire", async () => {
  const { runProviderCompatibilityProbe } = require("../providers/connection-probe");
  const bodies = [];
  const call = { id: "provider-issued-id", type: "function",
    function: { name: "grey_crow_connection_probe", arguments: "{ \n }" } };
  const provider = createDeepSeekProvider({ apiKey: "synthetic-private-key", async requestImpl(_url, options) {
    bodies.push(JSON.parse(options.body));
    assert(bodies.length <= 2, "a compatibility probe must not retry");
    return new Response(JSON.stringify({ choices: [{ message: bodies.length === 1
      ? { role: "assistant", content: null, tool_calls: [call], reasoning_content: "synthetic-private-reasoning" }
      : { role: "assistant", content: "Connection confirmed." }, finish_reason: bodies.length === 1 ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 123, completion_tokens: 50, total_tokens: 173 } }), { status: 200 });
  } });
  const result = await runProviderCompatibilityProbe({ provider });
  assert.equal(result.ok, true);
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    assert.equal(body.max_tokens, 128);
    assert.equal(Object.hasOwn(body, "thinking"), false);
    assert.equal(Object.hasOwn(body, "reasoning_effort"), false);
  }
  const assistant = bodies[1].messages.find(message => message.role === "assistant");
  assert.deepEqual(assistant.tool_calls, [call]);
  assert.equal(assistant.reasoning_content, "synthetic-private-reasoning");
  const receipts = bodies[1].messages.filter(message => message.role === "tool");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].tool_call_id, call.id);
  assert.equal(result.usage.first.input_tokens, 123);
  assert.equal(result.usage.second.output_tokens, 50);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private/);
});

test("connection probe does not add DeepSeek request options for other providers", async () => {
  const { runProviderCompatibilityProbe } = require("../providers/connection-probe");
  for (const providerName of ["openai-compatible", "openai", "custom"]) {
    const fixture = normalizedProbe({ providerName });
    await runProviderCompatibilityProbe({ provider: fixture.provider });
    assert.equal(fixture.requests.length, 2);
    for (const request of fixture.requests) {
      assert.equal(request.maxOutputTokens, 128);
      assert.equal(Object.hasOwn(request, "thinkingMode"), false);
      assert.equal(Object.hasOwn(request, "reasoningEffort"), false);
    }
  }
});

test("connection probe rejects extra or malformed normalized calls before fabricating any tool receipt", async (t) => {
  const { runProviderCompatibilityProbe } = require("../providers/connection-probe");
  const tool = normalizedProbe().tool;
  const malformed = [
    ["missing calls", undefined],
    ["nonarray calls", {}],
    ["no calls", []],
    ["wrong tool name", [{ ...tool, name: "unrelated_tool" }]],
    ["two probe calls", [tool, { ...tool, id: "second-probe-id" }]],
    ["probe plus an unrelated tool", [tool, { ...tool, id: "unrelated-id", name: "unrelated_tool" }]],
    ["missing response ID", [{ name: tool.name, arguments: "{}" }]],
    ["nonstring response ID", [{ ...tool, id: 42 }]],
    ["blank response ID", [{ ...tool, id: " " }]],
    ["missing arguments", [{ id: tool.id, name: tool.name }]],
    ["nonstring arguments", [{ ...tool, arguments: {} }]],
    ["invalid JSON arguments", [{ ...tool, arguments: "synthetic-private-invalid-json" }]],
    ["null JSON arguments", [{ ...tool, arguments: "null" }]],
    ["array JSON arguments", [{ ...tool, arguments: "[]" }]],
    ["unexpected argument key", [{ ...tool, arguments: '{"synthetic-private-key":1}' }]],
  ];
  for (const [name, toolCalls] of malformed) await t.test(name, async () => {
    const fixture = normalizedProbe({ first: { toolCalls, finishReason: "tool_calls" } });
    await assert.rejects(runProviderCompatibilityProbe({ provider: fixture.provider }), (error) => {
      assert.equal(error.code, "MODEL_CAPABILITY_UNSUPPORTED");
      assert.equal(error.retryable, false);
      assert.doesNotMatch(`${error.message}\n${JSON.stringify(error)}`, /synthetic-private/);
      return true;
    });
    assert.equal(fixture.requests.length, 1);
  });
});

test("connection probe cannot certify explicit truncated filtered or exhausted responses", async (t) => {
  const { runProviderCompatibilityProbe } = require("../providers/connection-probe");
  const tool = normalizedProbe().tool;
  for (const finishReason of ["length", "content_filter", "insufficient_system_resource"]) {
    await t.test(`tool response ${finishReason}`, async () => {
      const fixture = normalizedProbe({ first: { toolCalls: [tool], finishReason } });
      await assert.rejects(runProviderCompatibilityProbe({ provider: fixture.provider }), { code: "MODEL_CAPABILITY_UNSUPPORTED" });
      assert.equal(fixture.requests.length, 1);
    });
    await t.test(`final response ${finishReason}`, async () => {
      const fixture = normalizedProbe({ second: { text: "Incomplete confirmation", finishReason } });
      await assert.rejects(runProviderCompatibilityProbe({ provider: fixture.provider }), { code: "MODEL_CAPABILITY_UNSUPPORTED" });
      assert.equal(fixture.requests.length, 2);
    });
  }
});

test("connection probe still rejects another final tool or whitespace-only final text", async (t) => {
  const { runProviderCompatibilityProbe } = require("../providers/connection-probe");
  const tool = normalizedProbe().tool;
  for (const [name, second] of [
    ["another tool", { text: "Not done", toolCalls: [tool], finishReason: "tool_calls" }],
    ["invalid tool collection", { text: "Not done", toolCalls: null, finishReason: "stop" }],
    ["whitespace text", { text: " \n\t ", finishReason: "stop" }],
  ]) await t.test(name, async () => {
    const fixture = normalizedProbe({ second });
    await assert.rejects(runProviderCompatibilityProbe({ provider: fixture.provider }), { code: "MODEL_CAPABILITY_UNSUPPORTED" });
    assert.equal(fixture.requests.length, 2);
  });
});
