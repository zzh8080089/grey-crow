"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { createSessionProcess } = require("./session-process");
const { createTurnStore } = require("./turn-store");
const { createOpeningState } = require("./session-opening");
const { createOpenAICompatibleProvider } = require("../providers/openai-compatible");
const { identity, initialState, request, borrowBundle, assertBorrowed } = require("./test-fixtures/turn-samples");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function response(bundle = borrowBundle()) {
  return { text: JSON.stringify(bundle), usage: { input_tokens: 60, output_tokens: 40 },
    model: "synthetic-local", finishReason: "stop" };
}

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-process-"));
  const databasePath = path.join(directory, "adventure.sqlite");
  const clients = [];
  const children = [];
  const sessionOptions = { ...identity(databasePath), initialState: initialState(),
    hostText: "主持人依据正式状态回应自然行动。", worldText: "上海爆发后第十天。", timeoutMs: 2000 };
  t.after(async () => {
    await Promise.all(clients.map((client) => client.close()));
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve) => { child.once("exit", resolve); child.kill("SIGKILL"); });
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, databasePath, sessionOptions, children,
    async open(options = {}) {
      let child;
      const client = await createSessionProcess({ sessionOptions,
        provider: { generate: async () => response() }, ...options,
        spawn(modulePath, args, spawnOptions) {
          child = (options.spawn ?? fork)(modulePath, args, spawnOptions);
          children.push(child);
          return child;
        } });
      clients.push(client);
      return { client, child };
    },
    reopenOptions() { const { initialState: omitted, ...options } = sessionOptions; return options; },
  };
}

test("read-only RPC restores the latest interrupted player input and bounded redacted diagnostics", async (t) => {
  const env = setup(t);
  const entered = deferred(), delayed = deferred();
  let calls = 0;
  const { client } = await env.open({ provider: { async generate() { calls++; entered.resolve(); return delayed.promise; } } });
  assert.equal(await client.readPendingAction(), null);
  const original = request({ actionId: 'recoverable-original', input: '我轻轻敲门。sk-synthetic-private-input-123456' });
  const running = client.runAction(original).then((value) => value, (error) => error);
  await entered.promise;
  const before = await client.readPendingAction({ revision: 0 });
  assert.equal(before.actionId, original.actionId); assert.equal(before.status, 'running');
  await client.close();
  assert.equal((await running).code, 'SESSION_PROCESS_CLOSED');
  delayed.resolve(response());
  const { client: reopened } = await env.open({ sessionOptions: env.reopenOptions(), provider: { async generate() { calls++; return response(); } } });
  const bytes = fs.readFileSync(env.databasePath);
  const restored = await reopened.readPendingAction({ revision: 0 });
  assert.deepEqual(restored, { ...before, status: 'interrupted', error: { code: 'PROCESS_INTERRUPTED', retryable: true } });
  const diagnostics = await reopened.readDiagnostics({ limit: 1 });
  assert.equal(diagnostics.counts.actions, 1); assert.equal(diagnostics.counts.retainedAttempts, 1);
  assert.equal(diagnostics.attemptHistoryComplete, false); assert.equal(diagnostics.complete, true);
  assert.equal(diagnostics.entries[0].attemptId, restored.attemptId);
  assert.doesNotMatch(JSON.stringify(diagnostics), /synthetic-private|敲门|尚未露面|input"|narration|owner|databasePath|messages/);
  assert.deepEqual(fs.readFileSync(env.databasePath), bytes); assert.equal(calls, 1);
  for (const query of [{ revision: 0, prompt: 'forbidden' }, { includeInput: true }]) {
    await assert.rejects(reopened.readPendingAction(query), { code: 'SESSION_PAYLOAD_INVALID' });
  }
  await assert.rejects(reopened.readPendingAction({ revision: 1 }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(reopened.readDiagnostics({ limit: 1, input: 'forbidden' }), { code: 'SESSION_PAYLOAD_INVALID' });
  for (const limit of [null, 0, 101, 1.5]) await assert.rejects(reopened.readDiagnostics({ limit }), { code: 'ACTION_INPUT_INVALID' });
  let getter = 0;
  await assert.rejects(reopened.readDiagnostics({ get limit() { getter++; return 1; } }), { code: 'SESSION_PAYLOAD_INVALID' });
  assert.equal(getter, 0);
  const repeated = await reopened.runAction(original);
  assert.equal(repeated.status, 'interrupted'); assert.equal(repeated.modelCalls, 0); assert.equal(calls, 1);
  const finished = await reopened.runAction(original, { retry: true });
  assert.equal(finished.status, 'committed'); assert.equal(calls, 2);
  assert.equal(await reopened.readPendingAction({ revision: 1 }), null);
  await assert.rejects(reopened.readPendingAction({ revision: 0 }), { code: 'REVISION_CONFLICT' });
  const final = await reopened.readDiagnostics();
  assert.equal(final.counts.actions, 1); assert.equal(final.counts.retainedAttempts, 1);
  assert.equal(final.entries[0].committedRevision, 1); assert.notEqual(final.entries[0].attemptId, before.attemptId);
  assert.ok(Buffer.byteLength(JSON.stringify(final)) < 8000);
});

test("a real child serves one committed adventure and matches concurrent replies by request ID", async (t) => {
  const environment = setup(t);
  let modelCalls = 0;
  const { client, child } = await environment.open({ provider: { async generate(modelRequest) {
    modelCalls += 1;
    assert.equal(modelRequest.signal instanceof AbortSignal, true);
    assert.equal(Array.isArray(modelRequest.messages), true);
    return response();
  } } });
  assert.notEqual(child.pid, process.pid);
  assert.equal((await client.readView()).revision, 0);
  const result = await client.runAction(request());
  assert.equal(result.status, "committed");
  assertBorrowed(assert, result.view);
  const reads = await Promise.all(Array.from({ length: 12 }, (_, index) => index % 2
    ? client.readAction("missing-action") : client.readView({ revision: 1 })));
  reads.forEach((value, index) => index % 2 ? assert.equal(value, null) : assert.equal(value.revision, 1));
  const repeat = await client.runAction(request(), { retry: true });
  assert.equal(repeat.modelCalls, 0);
  assert.deepEqual(repeat.view, result.view);
  assert.equal(modelCalls, 1);
});

test("real child transports narration settings and separates next context, last request and cumulative usage", async (t) => {
  const environment = setup(t);
  let calls = 0;
  const options = { ...environment.sessionOptions, narrationPreferences: { lengthPreset: "custom", customTargetChars: 180 },
    contextPolicy: { configuredContextWindow: 128000, providerContextLimit: 64000, autoCompactRatio: 0.7 } };
  const { client } = await environment.open({ sessionOptions: options, provider: { async generate(modelRequest) {
    calls++;
    assert.match(modelRequest.messages[0].content, /"targetCharacters":180/);
    if (calls === 1) return { text: "", toolCalls: [{ id: "read-npc", name: "read_entity", arguments: '{"entityId":"npc"}' }],
      usage: { input_tokens: 9000, output_tokens: 100, total_tokens: 9100 } };
    return { ...response(), usage: { input_tokens: 11000, output_tokens: 200, total_tokens: 11200 } };
  } } });
  options.narrationPreferences.customTargetChars = 800;
  const beforeBytes = fs.readFileSync(environment.databasePath);
  const before = await client.readContextUsage({ revision: 0 });
  assert.equal(before.adventureId, options.adventureId); assert.equal(before.revision, 0);
  assert.equal(before.scope, "next_request"); assert.equal(before.latestActual, null); assert.equal(before.actionId, null);
  const draft = await client.readContextUsage({ revision: 0, input: "我问陈姨借米。",
    narrationPreferences: { lengthPreset: "short" }, contextPolicy: { configuredContextWindow: 32000 } });
  assert.notEqual(draft.settingsIdentity, before.settingsIdentity); assert.equal(draft.includesPlayerInput, true);
  assert.deepEqual(await client.readContextUsage({ revision: 0 }), before);
  assert.deepEqual(fs.readFileSync(environment.databasePath), beforeBytes);
  assert.equal(calls, 0); assert.equal(await client.readAction(request().actionId), null);
  for (const invalid of [{ revision: 0, credentials: "secret" }, { input: "missing revision" }]) {
    await assert.rejects(client.readContextUsage(invalid), { code: "SESSION_PAYLOAD_INVALID" });
  }
  await assert.rejects(client.readContextUsage({ revision: 0, contextPolicy: { apiKey: "not-allowed" } }), { code: "CONTEXT_OPTIONS_INVALID" });
  const turn = await client.runAction(request());
  assert.equal(turn.status, "committed"); assert.equal(turn.modelCalls, 2);
  assert.equal(turn.usage.input_tokens, 20000);
  assert.equal(turn.contextUsage.revision, 0); assert.equal(turn.contextUsage.actionId, request().actionId);
  assert.equal(turn.contextUsage.scope, "invocation");
  assert.deepEqual(turn.contextUsage.latestActual, { inputTokens: 11000, outputTokens: 200, callIndex: 2 });
  assert.equal(turn.contextUsage.peak.actualInputTokens, 11000);
  assert.equal(turn.contextUsage.settingsIdentity, before.settingsIdentity);
  assert.doesNotMatch(JSON.stringify(turn.contextUsage), /隐藏|未露面|messages|quotedNarrativeSources|apiKey/);
  const repeated = await client.runAction(request());
  assert.equal(repeated.modelCalls, 0); assert.equal(repeated.contextUsage, null); assert.equal(calls, 2);
  const current = await client.readContextUsage({ revision: 1 });
  assert.equal(current.latestActual, null); assert.equal(current.scope, "next_request");
  await client.close();
  const { client: restored } = await environment.open({ sessionOptions: { ...environment.reopenOptions(),
    narrationPreferences: { lengthPreset: "custom", customTargetChars: 180 }, contextPolicy: options.contextPolicy },
    provider: { generate() { throw new Error("read-only restoration cannot generate"); } } });
  assert.deepEqual(await restored.readContextUsage({ revision: 1 }), current);
  assert.equal((await restored.runAction(request())).contextUsage, null);
});

test("nested session options reject credentials and invalid settings before spawning a child", async (t) => {
  const environment = setup(t);
  for (const change of [{ narrationPreferences: { lengthPreset: "custom", customTargetChars: 900 } },
    { contextPolicy: { configuredContextWindow: 0 } }, { contextPolicy: { credentials: "secret" } }]) {
    await assert.rejects(environment.open({ sessionOptions: { ...environment.sessionOptions, ...change } }), { code: "CONTEXT_OPTIONS_INVALID" });
  }
  assert.equal(environment.children.length, 0);
  assert.equal(fs.existsSync(environment.databasePath), false);
});

function chapterResponse() {
  return response({ title: "楼道里的约定", summary: "陈姨借出了两袋米，你答应明天归还。",
    keyEvents: [{ text: "你获得两袋米。", sources: [{ revision: 1, segmentId: "borrow-text" }] }],
    openThreads: [{ text: "明天向陈姨归还两袋米。", sources: [{ revision: 1, segmentId: "borrow-text" }] }] });
}

test("chapters cross the real process boundary without advancing story or duplicating saved chapters", async (t) => {
  const environment = setup(t);
  let turns = 0;
  let chapterCalls = 0;
  const provider = { async generate(modelRequest) {
    if (modelRequest.messages[0].content.includes("retrospective chapter")) { chapterCalls += 1; return chapterResponse(); }
    turns += 1;
    return response();
  } };
  const { client } = await environment.open({ provider });
  await client.runAction(request());
  const before = await client.readView();
  const saved = await client.saveChapter({ targetRevision: 1 });
  assert.equal(saved.saved, true);
  assert.equal(saved.chapterStatus, "created");
  assert.equal(saved.chapter.mode, "model");
  assert.equal(saved.chapter.fromRevision, 1);
  assert.equal(saved.chapter.toRevision, 1);
  assert.equal(saved.modelCalls, 1);
  assert.deepEqual(await client.readView(), before);
  const repeated = await client.saveChapter({ targetRevision: 1 }, { retry: true });
  assert.equal(repeated.chapterStatus, "unchanged");
  assert.equal(repeated.modelCalls, 0);
  assert.deepEqual(repeated.chapter, saved.chapter);
  const lite = await client.readPlayerState({ revision: 1 });
  assert.equal(lite.history, undefined);
  assert.equal(lite.state.entities.secret, undefined);
  assert.equal(lite.state.inventory[0].quantity, 2);
  await client.close();
  const { client: reopened } = await environment.open({ sessionOptions: environment.reopenOptions(), provider });
  const page = await reopened.readChapters({ revision: 1 });
  assert.deepEqual(page.chapters, [saved.chapter]);
  assert.equal(page.complete, true);
  assert.equal((await reopened.readChapters({ revision: 0 })).chapters.length, 0);
  assert.equal(chapterCalls, 1);
  assert.equal(turns, 1);
});

test("closing a real child interrupts chapter preparation and later explicit retry cannot duplicate it", async (t) => {
  const environment = setup(t);
  const started = deferred();
  const late = deferred();
  let providerSignal;
  const { client } = await environment.open({ provider: { generate(modelRequest) {
    if (modelRequest.messages[0].content.includes("retrospective chapter")) {
      providerSignal = modelRequest.signal;
      started.resolve();
      return late.promise;
    }
    return response();
  } } });
  await client.runAction(request());
  const pending = client.saveChapter({ targetRevision: 1 }).catch((error) => error.code);
  await started.promise;
  await client.close();
  const outcome = await pending;
  assert.ok(typeof outcome === "string" || outcome.chapterStatus !== "created");
  assert.equal(providerSignal.aborted, true);
  late.resolve(chapterResponse());
  let calls = 0;
  const { client: reopened } = await environment.open({ sessionOptions: environment.reopenOptions(),
    provider: { async generate() { calls += 1; return chapterResponse(); } } });
  const interrupted = await reopened.saveChapter({ targetRevision: 1 });
  assert.equal(interrupted.chapterStatus, "interrupted");
  assert.equal(calls, 0);
  const recovered = await reopened.saveChapter({ targetRevision: 1 }, { retry: true });
  assert.equal(recovered.chapterStatus, "created");
  assert.equal(calls, 1);
  assert.equal((await reopened.readChapters({ revision: 1 })).chapters.length, 1);
  assert.equal((await reopened.readView()).revision, 1);
});

test("a real child delivers the ending before finalization, which can be cancelled and explicitly resumed after reopen", { timeout: 10000 }, async (t) => {
  const env = setup(t);
  const offer = { narration: [{ id: "offer-text", text: "同行的人已经离开，你愿意在这里结束故事吗？" }],
    events: [{ id: "offer", type: "finale.propose", sourceSegmentIds: ["offer-text"], data: {
      candidateId: "quiet-ending", closureReason: "这段同行已经结束。", closedThreads: ["同行的人已离开。"],
      intentionalOpenThreads: [], finaleTone: "克制" } }], experiences: [] };
  const ending = { narration: [{ id: "ending-text", text: "你告别同行的人，这段故事在此结束。" }],
    events: [{ id: "finish", type: "finale.confirm", sourceSegmentIds: ["ending-text"], data: { candidateId: "quiet-ending" } }], experiences: [] };
  const chapter = { title: "一次告别", summary: "你确认在告别后结束这段故事。",
    keyEvents: [{ text: "你告别了同行的人。", sources: [{ revision: 2, segmentId: "ending-text" }] }], openThreads: [] };
  const seeded = createTurnStore({ ...identity(env.databasePath), initialState: initialState() });
  try {
    const started = seeded.beginAction(request({ actionId: "offer", baseRevision: 0 }));
    seeded.commitAction({ actionId: started.actionId, attemptId: started.attemptId, bundle: offer });
  } finally { seeded.close(); }
  const entered = deferred(), late = deferred();
  let calls = 0; let chapterSignal;
  const { client } = await env.open({ sessionOptions: { ...env.reopenOptions(), finaleText: "玩家确认后结束故事。" },
    provider: { generate(modelRequest) {
      calls++;
      if (calls === 1) return response(ending);
      chapterSignal = modelRequest.signal;
      entered.resolve();
      return late.promise;
    } } });
  const finish = request({ actionId: "finish", baseRevision: 1, input: "我同意在这里结束故事。" });
  const committed = await client.runAction(finish);
  assert.equal(committed.status, "committed");
  assert.equal(committed.modelCalls, 1);
  assert.equal(calls, 1, "the first RPC returns before starting any derived request");
  assert.equal(committed.view.finale.archive.status, "pending");
  assert.equal(committed.view.finale.chapterJob, null);
  assert.deepEqual(committed.view.narration, ending.narration);
  const delivered = structuredClone(committed);

  const controller = new AbortController();
  const pending = client.finalize({ revision: 2 }, { signal: controller.signal });
  await entered.promise;
  const during = await client.readView({ revision: 2 });
  assert.equal(during.finale.chapterJob.status, "running");
  assert.deepEqual(during.narration, ending.narration);
  assert.deepEqual(during.state, committed.view.state);
  assert.equal((await client.readAction(finish.actionId)).status, "committed");
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.status, "recovery_required");
  assert.equal(cancelled.error.code, "CHAPTER_INTERRUPTED");
  assert.equal(cancelled.finale.chapterJob.status, "interrupted");
  assert.equal(cancelled.chapterWork.modelCalls, 1);
  assert.equal(cancelled.chapterWork.usageComplete, false);
  assert.equal(chapterSignal.aborted, true);
  late.resolve(response(chapter));
  assert.equal((await client.readChapters({ revision: 2 })).chapters.length, 0);
  assert.deepEqual(committed, delivered);
  await client.close();

  let resumedCalls = 0;
  const { client: reopened } = await env.open({ sessionOptions: env.reopenOptions(), provider: { generate() {
    resumedCalls++; return response(chapter);
  } } });
  const restored = await reopened.readView();
  assert.equal(restored.revision, 2);
  assert.deepEqual(restored.state, delivered.view.state);
  assert.deepEqual(restored.narration, ending.narration);
  assert.equal((await reopened.readFinale()).chapterJob.status, "interrupted");
  assert.equal((await reopened.recoverFinale()).status, "recovery_required");
  assert.equal((await reopened.runAction(finish, { retry: true })).modelCalls, 0);
  assert.equal((await reopened.finalize({ revision: 2 })).chapterWork.modelCalls, 0);
  assert.equal(resumedCalls, 0, "reopening, reading and duplicate story requests never resume model work");
  const finalized = await reopened.finalize({ revision: 2 }, { retry: true });
  assert.equal(finalized.status, "closed");
  assert.equal(finalized.chapterWork.modelCalls, 1);
  assert.deepEqual(finalized.chapterWork.usage, { input_tokens: 60, output_tokens: 40 });
  assert.equal(finalized.chapterWork.usageComplete, true);
  assert.equal(resumedCalls, 1);
  assert.equal((await reopened.finalize({ revision: 2 }, { retry: true })).chapterWork, null);
  assert.equal(resumedCalls, 1);
  const finalView = await reopened.readView();
  assert.equal(finalView.revision, 2);
  assert.deepEqual(finalView.state, delivered.view.state);
  assert.deepEqual(finalView.narration, ending.narration);
  assert.deepEqual(finalView.history, delivered.view.history);
  assert.equal(finalView.finale.archive.status, "closed");
});

test("child cancellation aborts the parent Provider and ignores a late model response", async (t) => {
  const environment = setup(t);
  const started = deferred();
  const late = deferred();
  let signal;
  const { client } = await environment.open({ provider: { generate(modelRequest) {
    signal = modelRequest.signal;
    started.resolve();
    return late.promise;
  } } });
  const pending = client.runAction(request());
  await started.promise;
  assert.equal((await client.cancelAction(request().actionId)).status, "cancelled");
  assert.equal((await pending).status, "cancelled");
  assert.equal(signal.aborted, true);
  late.resolve(response());
  await delay(10);
  assert.equal((await client.readView()).revision, 0);
});

test("external AbortSignal crosses both process directions, including a pre-aborted action", async (t) => {
  const environment = setup(t);
  const started = deferred();
  const late = deferred();
  let calls = 0;
  let providerSignal;
  const { client } = await environment.open({ provider: { generate(modelRequest) {
    calls += 1;
    providerSignal = modelRequest.signal;
    started.resolve();
    return late.promise;
  } } });
  const before = new AbortController();
  before.abort();
  assert.equal((await client.runAction(request(), { signal: before.signal })).status, "cancelled");
  assert.equal(calls, 0);
  const during = new AbortController();
  const pending = client.runAction(request({ actionId: "abort-during" }), { signal: during.signal });
  await started.promise;
  during.abort();
  assert.equal((await pending).status, "cancelled");
  assert.equal(providerSignal.aborted, true);
  late.resolve(response());
});

test("the child action deadline stops an uncooperative parent Provider", async (t) => {
  const environment = setup(t);
  let signal;
  const { client } = await environment.open({ sessionOptions: { ...environment.sessionOptions, timeoutMs: 60 },
    provider: { generate(modelRequest) { signal = modelRequest.signal; return new Promise(() => {}); } } });
  const result = await client.runAction(request());
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "TURN_TIMEOUT");
  assert.equal(signal.aborted, true);
  assert.equal((await client.readView()).revision, 0);
});

test("Provider exceptions cross only as fixed codes, without private diagnostics", async (t) => {
  const environment = setup(t);
  const { client } = await environment.open({ provider: { generate() {
    const error = new Error("fixture-api-key-secret private provider path");
    error.code = "fixture-api-key-secret";
    throw error;
  } } });
  const result = await client.runAction(request());
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "TURN_GENERATION_FAILED");
  assert.equal(JSON.stringify(result).includes("fixture-api-key-secret"), false);
  assert.equal((await client.readView()).revision, 0);
});

test("classified Provider failures cross the real child, retain diagnostics and never retry automatically", async (t) => {
  const env = setup(t);
  let failureCode, calls = 0;
  const statusCodes = { API_TIMEOUT: 408, UPSTREAM_AUTH_ERROR: 401, UPSTREAM_ACCESS_DENIED: 403, UPSTREAM_BALANCE_ERROR: 402,
    UPSTREAM_MODEL_NOT_FOUND: 404, UPSTREAM_RATE_LIMIT: 429, UPSTREAM_SERVER_ERROR: 503 };
  const { client } = await env.open({ provider: createOpenAICompatibleProvider({ model: "synthetic-model",
    apiKey: "synthetic-private-key", baseUrl: "https://model.invalid/v1", async requestImpl() {
      calls++;
      if (failureCode === "PROVIDER_FAILED") throw Object.assign(new Error("private provider network failure"), { code: "ENOTFOUND" });
      if (failureCode === "UPSTREAM_BAD_RESPONSE") return new Response("private invalid response", { status: 200 });
      return new Response(JSON.stringify({ error: { message: "private provider body and key" } }),
        { status: statusCodes[failureCode], headers: { "retry-after": "60" } });
    } }) });
  const codes = ["API_TIMEOUT", "UPSTREAM_AUTH_ERROR", "UPSTREAM_ACCESS_DENIED", "UPSTREAM_BALANCE_ERROR", "UPSTREAM_MODEL_NOT_FOUND",
    "UPSTREAM_RATE_LIMIT", "PROVIDER_FAILED", "UPSTREAM_SERVER_ERROR", "UPSTREAM_BAD_RESPONSE"];
  for (const [index, code] of codes.entries()) {
    failureCode = code;
    const input = request({ actionId: `failure-${index}` });
    const result = await client.runAction(input);
    const expected = { code, retryable: !["UPSTREAM_AUTH_ERROR", "UPSTREAM_ACCESS_DENIED", "UPSTREAM_BALANCE_ERROR", "UPSTREAM_MODEL_NOT_FOUND", "UPSTREAM_BAD_RESPONSE"].includes(code) };
    assert.equal(result.status, "failed");
    assert.deepEqual(result.error, expected);
    assert.equal(calls, index + 1, "an API failure is not a repair or automatic retry");
    assert.equal((await client.readView()).revision, 0);
    const diagnostics = await client.readDiagnostics();
    const entry = diagnostics.entries.find(value => value.actionId === input.actionId);
    assert.deepEqual(entry.error, expected);
    const execution = diagnostics.execution.records.find(value => value.actionId === input.actionId);
    assert.deepEqual(execution.error, expected);
    assert.equal(execution.steps.find(value => value.kind === "model" && value.outcome === "failed").resultCode, code);
    assert.doesNotMatch(JSON.stringify({ result, diagnostics }), /synthetic-private|private provider|private invalid|credential/);
    assert.equal((await client.runAction(input)).status, "failed");
    assert.equal(calls, index + 1);
  }
});

test("an authentication failure restores input and permits explicit recovery after correcting the connection", async (t) => {
  const env = setup(t);
  let calls = 0;
  const input = request();
  const { client } = await env.open({ provider: { generate() {
    calls++;
    throw Object.assign(new Error("private-key"), { code: "UPSTREAM_AUTH_ERROR", retryable: false });
  } } });
  assert.deepEqual((await client.runAction(input)).error, { code: "UPSTREAM_AUTH_ERROR", retryable: false });
  await client.close();
  const { client: reopened } = await env.open({ sessionOptions: env.reopenOptions(),
    provider: { generate() { calls++; return response(); } } });
  const pending = await reopened.readPendingAction({ revision: 0 });
  assert.equal(pending.input, input.input);
  assert.deepEqual(pending.error, { code: "UPSTREAM_AUTH_ERROR", retryable: false });
  assert.equal((await reopened.runAction(input)).status, "failed");
  assert.equal(calls, 1, "reopening and receipt recovery never resend the request");
  assert.equal((await reopened.runAction(input, { retry: true })).status, "committed");
  assert.equal(calls, 2);
  assert.equal((await reopened.runAction(input, { retry: true })).status, "committed");
  assert.equal(calls, 2, "an already committed action is never regenerated");
});

test("child crash rejects pending work; a new process reads interruption before an explicit retry", async (t) => {
  const environment = setup(t);
  const started = deferred();
  const late = deferred();
  let signal;
  const { client, child } = await environment.open({ provider: { generate(modelRequest) {
    signal = modelRequest.signal;
    started.resolve();
    return late.promise;
  } } });
  const pending = client.runAction(request());
  await started.promise;
  const rejected = assert.rejects(pending, { code: "SESSION_PROCESS_EXITED" });
  child.kill("SIGKILL");
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(child.signalCode, "SIGKILL");
  let freshCalls = 0;
  const fresh = await environment.open({ sessionOptions: environment.reopenOptions(),
    provider: { async generate() { freshCalls += 1; return response(); } } });
  assert.equal((await fresh.client.readAction(request().actionId)).status, "interrupted");
  assert.equal((await fresh.client.runAction(request())).status, "interrupted");
  assert.equal(freshCalls, 0);
  assert.equal((await fresh.client.runAction(request(), { retry: true })).status, "committed");
  late.resolve(response());
  await delay(10);
  assert.equal((await fresh.client.readView()).revision, 1);
  assert.equal(freshCalls, 1);
});

test("a lost committed RPC receipt is recovered by a new process without another model call", async (t) => {
  const environment = setup(t);
  let swallowed = false;
  const { client } = await environment.open({
    spawn(modulePath, args, options) {
      const child = fork(modulePath, args, options);
      const emit = child.emit.bind(child);
      child.emit = (event, ...values) => {
        const message = values[0];
        if (event === "message" && message?.type === "result" && message?.value?.status === "committed") {
          // The real child has committed; only delivery of its receipt fails.
          swallowed = true;
          child.kill("SIGKILL");
          return true;
        }
        return emit(event, ...values);
      };
      return child;
    } });
  await assert.rejects(client.runAction(request()), { code: "SESSION_PROCESS_EXITED" });
  assert.equal(swallowed, true);
  let calls = 0;
  const fresh = await environment.open({ sessionOptions: environment.reopenOptions(),
    provider: { async generate() { calls += 1; return response(); } } });
  assert.equal((await fresh.client.readAction(request().actionId)).status, "committed");
  const recovered = await fresh.client.runAction(request(), { retry: true });
  assert.equal(recovered.status, "committed");
  assertBorrowed(assert, recovered.view);
  assert.equal(calls, 0);
});

test("close waits for actual exit, aborts the parent Provider, and preserves interruption rather than cancellation", async (t) => {
  const environment = setup(t);
  const started = deferred();
  let signal;
  const { client, child } = await environment.open({ provider: { generate(modelRequest) {
    signal = modelRequest.signal;
    started.resolve();
    return new Promise(() => {});
  } } });
  const pending = client.runAction(request());
  await started.promise;
  const rejected = assert.rejects(pending, { code: "SESSION_PROCESS_CLOSED" });
  await client.close();
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(child.exitCode, 0);
  await client.close();
  await assert.rejects(client.readView(), { code: "SESSION_PROCESS_CLOSED" });
  const fresh = await environment.open({ sessionOptions: environment.reopenOptions() });
  assert.equal((await fresh.client.readAction(request().actionId)).status, "interrupted");
});

test("loss of the parent channel makes the actual child close its store and exit", async (t) => {
  const environment = setup(t);
  const started = deferred();
  const { client, child } = await environment.open({ provider: { generate() {
    started.resolve();
    return new Promise(() => {});
  } } });
  const pending = client.runAction(request());
  await started.promise;
  const rejected = assert.rejects(pending, (error) => ["SESSION_CHANNEL_CLOSED", "SESSION_PROCESS_EXITED"].includes(error.code));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.disconnect();
  await rejected;
  await exited;
  assert.notEqual(child.exitCode === null && child.signalCode === null, true);
  const fresh = await environment.open({ sessionOptions: environment.reopenOptions() });
  assert.equal((await fresh.client.readAction(request().actionId)).status, "interrupted");
});

test("credentials, raw Provider fields, and executable paths do not enter the child channel", async (t) => {
  const environment = setup(t);
  const sent = [];
  let spawnOptions;
  const key = "GREY_CROW_TEST_PROVIDER_SECRET";
  const previous = process.env[key];
  process.env[key] = "fixture-environment-secret";
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  const { client } = await environment.open({ provider: { apiKey: "fixture-object-secret",
    async generate() { return { ...response(), raw: { apiKey: "fixture-raw-secret" },
      meta: { secret: "fixture-meta-secret" }, apiKey: "fixture-response-secret" }; } },
    spawn(modulePath, args, options) {
      spawnOptions = options;
      assert.equal(modulePath, path.join(__dirname, "session-process-child.js"));
      const child = fork(modulePath, args, options);
      const send = child.send.bind(child);
      child.send = (message, callback) => { sent.push(message); return send(message, callback); };
      return child;
    } });
  assert.equal(spawnOptions.env[key], undefined);
  assert.equal(spawnOptions.env.NODE_OPTIONS, undefined);
  assert.deepEqual(spawnOptions.execArgv, []);
  assert.equal((await client.runAction(request())).status, "committed");
  assert.equal(JSON.stringify(sent).includes("-secret"), false);
  await assert.rejects(createSessionProcess({ sessionOptions: { ...environment.sessionOptions, modulePath: "/arbitrary/module.js" },
    provider: { generate: async () => response() } }), { code: "SESSION_OPTIONS_INVALID" });
});

test("the RPC boundary rejects oversized input and arbitrary methods without executing an action", async (t) => {
  const environment = setup(t);
  const { client, child } = await environment.open();
  await assert.rejects(client.runAction(request({ input: "x".repeat(8 * 1024 * 1024) })), { code: "SESSION_PAYLOAD_TOO_LARGE" });
  assert.equal(await client.readAction(request().actionId), null);
  const denied = new Promise((resolve) => {
    const listener = (message) => {
      if (message.requestId === "forbidden-method") { child.off("message", listener); resolve(message); }
    };
    child.on("message", listener);
  });
  child.send({ v: 1, type: "call", requestId: "forbidden-method", method: "constructor", args: [] });
  assert.equal((await denied).error.code, "SESSION_METHOD_NOT_ALLOWED");
  assert.equal((await client.readView()).revision, 0);
});

test("startup timeout returns only after the real child has been terminated", async (t) => {
  const environment = setup(t);
  let child;
  await assert.rejects(environment.open({ startupTimeoutMs: 40, closeGraceMs: 40,
    spawn(modulePath, args, options) {
      child = fork(modulePath, args, options);
      const send = child.send.bind(child);
      child.send = (message, callback) => {
        if (message.type === "init") { callback?.(null); return true; }
        return send(message, callback);
      };
      return child;
    } }), { code: "SESSION_START_TIMEOUT" });
  assert.notEqual(child.exitCode === null && child.signalCode === null, true);
  assert.equal(fs.existsSync(environment.databasePath), false);
});

test("a lost close request is escalated to a real kill and awaited, never presumed complete", async (t) => {
  const environment = setup(t);
  const { client, child } = await environment.open({ closeGraceMs: 40,
    spawn(modulePath, args, options) {
      const child = fork(modulePath, args, options);
      const send = child.send.bind(child);
      child.send = (message, callback) => {
        if (message.method === "close") { callback?.(null); return true; }
        return send(message, callback);
      };
      return child;
    } });
  await client.close();
  assert.equal(child.signalCode, "SIGKILL");
});

test("opening proposal survives child restart; only confirmation installs formal facts before ordinary play", async (t) => {
  const environment = setup(t);
  const readyState = initialState();
  readyState.entities.p.name = "林安";
  const openingText = "OPENING_SOURCE_FOR_PROCESS_TEST：先确定身份和起点，再展示摘要等待玩家确认。";
  const proposal = {
    narration: [{ id: "opening-summary", text: "你叫林安，现在站在楼道里，隔壁住着陈姨。请确认这个开局。" }],
    events: [{ id: "proposed-opening", type: "opening.propose", sourceSegmentIds: ["opening-summary"],
      data: { proposalId: "opening-one", initialState: readyState } }],
    experiences: [],
  };
  const confirmation = {
    narration: [{ id: "opening-confirmed", text: "你确认了这个身份和起点，冒险从楼道开始。" }],
    events: [{ id: "confirmed-opening", type: "opening.confirm", sourceSegmentIds: ["opening-confirmed"],
      data: { proposalId: "opening-one" } }],
    experiences: [],
  };
  let firstCalls = 0;
  const first = await environment.open({ sessionOptions: { ...environment.sessionOptions,
    initialState: createOpeningState({ day: 10 }), openingText },
  provider: { async generate(modelRequest) {
    firstCalls += 1;
    assert.match(JSON.stringify(modelRequest.messages), /OPENING_SOURCE_FOR_PROCESS_TEST/);
    return response(proposal);
  } } });
  const empty = await first.client.readView();
  assert.equal(empty.revision, 0);
  assert.equal(empty.state.opening.phase, "creating");
  assert.deepEqual(empty.state.entities, {});
  assert.equal(empty.state.situation.playerId, null);
  assert.equal(empty.state.situation.locationId, null);
  const proposedRequest = request({ actionId: "propose-opening", baseRevision: 0,
    input: "我叫林安，从楼道开始，请整理开局摘要。" });
  const proposed = await first.client.runAction(proposedRequest);
  assert.equal(proposed.status, "committed");
  assert.equal(proposed.view.revision, 1);
  assert.equal(proposed.view.state.opening.phase, "awaiting_confirmation");
  assert.deepEqual(proposed.view.state.entities, {});
  assert.deepEqual(proposed.view.state.inventory, []);
  assert.equal(proposed.view.state.situation.playerId, null);
  assert.equal(proposed.view.state.situation.locationId, null);
  assert.equal(proposed.view.state.opening.proposal.initialState, undefined);
  assert.deepEqual(proposed.view.state.opening.proposal.summary, { revision: 1, segmentIds: ["opening-summary"] });
  assert.deepEqual((await first.client.readView({ revision: 0 })).state, empty.state);
  assert.equal(firstCalls, 1);
  await first.client.close();

  let resumedCalls = 0;
  const resumed = await environment.open({ sessionOptions: { ...environment.reopenOptions(), openingText },
    provider: { async generate() {
      resumedCalls += 1;
      return response(resumedCalls === 1 ? confirmation : borrowBundle());
    } } });
  assert.deepEqual(await resumed.client.readView(), proposed.view);
  assert.equal((await resumed.client.readAction(proposedRequest.actionId)).status, "committed");
  assert.equal((await resumed.client.runAction(proposedRequest)).modelCalls, 0);
  assert.equal(resumedCalls, 0);
  const confirmed = await resumed.client.runAction(request({ actionId: "confirm-opening", baseRevision: 1,
    input: "确认这个身份和开局，开始冒险。" }));
  assert.equal(confirmed.status, "committed");
  assert.equal(confirmed.view.revision, 2);
  assert.equal(confirmed.view.state.opening.phase, "ready");
  assert.equal(confirmed.view.state.entities.p.name, "林安");
  assert.equal(confirmed.view.state.situation.playerId, "p");
  assert.equal(confirmed.view.state.situation.locationId, "home");
  assert.equal(confirmed.view.state.opening.confirmation.summaryRevision, 1);
  assert.deepEqual(confirmed.view.state.opening.confirmation.summarySegmentIds, ["opening-summary"]);
  const borrowed = await resumed.client.runAction(request({ baseRevision: 2 }));
  assert.equal(borrowed.status, "committed");
  assert.equal(borrowed.view.revision, 3);
  assertBorrowed(assert, borrowed.view);
  assert.equal(resumedCalls, 2);
  await resumed.client.close();
  const final = await environment.open({ sessionOptions: { ...environment.reopenOptions(), openingText },
    provider: { generate() { throw new Error("restoration must not generate"); } } });
  assert.deepEqual(await final.client.readView(), borrowed.view);
});

test("a real child restores more than 8 MiB of story through bound pages without omissions or new-version leakage", async (t) => {
  const environment = setup(t);
  const expected = [];
  const body = "楼道回声".repeat(15000);
  // This exercises durable paging, not model context fitting. Seed complete
  // committed turns through the real store so a generator cannot silently
  // discard prior history merely to manufacture a large paging fixture.
  const seeded = createTurnStore({ ...identity(environment.databasePath), initialState: initialState() });
  try {
    for (let revision = 1; revision <= 55; revision += 1) {
      const input = request({ actionId: `long-story-${revision}`, baseRevision: revision - 1, input: `我继续观察第${revision}处动静。` });
      const action = seeded.beginAction(input);
      const narration = [{ id: `story-${revision}`, text: `第${revision}轮\n${body}\n保留结尾${revision}` }];
      const result = seeded.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
        bundle: { narration, events: [], experiences: [] } });
      assert.equal(result.status, "committed"); assert.equal(result.view.revision, revision);
      expected.push({ revision, actionId: input.actionId, input: input.input,
        source: { adventureId: environment.sessionOptions.adventureId, revision }, storyTurn: revision, narration });
    }
  } finally { seeded.close(); }
  assert.ok(Buffer.byteLength(JSON.stringify(expected)) > 8 * 1024 * 1024, "the old all-history payload would exceed IPC capacity");
  let resumedCalls = 0;
  const resumed = await environment.open({ sessionOptions: { ...environment.reopenOptions(), maxOutputTokens: 12000 },
    provider: { async generate() {
      resumedCalls += 1;
      throw new Error("history restoration must not call a model");
    } } });
  const view = await resumed.client.readView();
  assert.equal(view.revision, 55);
  assert.equal(view.historyComplete, false);
  assert.ok(view.history.length > 0 && view.history.length <= 20);
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 8 * 1024 * 1024);
  assert.equal(resumedCalls, 0);
  const newAction = request({ actionId: "new-after-snapshot", baseRevision: 55, input: "我再看一眼窗外。" });
  const appended = createTurnStore(identity(environment.databasePath));
  try {
    const action = appended.beginAction(newAction);
    assert.equal(appended.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
      bundle: { narration: [{ id: "new-story", text: "第56轮的新故事不属于旧快照。" }], events: [], experiences: [] } }).view.revision, 56);
  } finally { appended.close(); }
  assert.equal((await resumed.client.readView()).revision, 56);
  await assert.rejects(resumed.client.readHistory({ revision: 56, beforeRevision: view.historyNextBeforeRevision }), { code: "HISTORY_CURSOR_MISMATCH" });
  await assert.rejects(resumed.client.readHistory({ revision: 55, beforeRevision: view.historyNextBeforeRevision, maxCharacters: 1000 }), { code: "HISTORY_PAGE_TOO_LARGE" });
  await assert.rejects(resumed.client.readHistory({ revision: 55, unexpectedMethod: "read-file" }), { code: "SESSION_PAYLOAD_INVALID" });
  await assert.rejects(resumed.client.readHistory({ revision: 55,
    beforeRevision: { ...view.historyNextBeforeRevision, adventureId: "another-adventure" } }), { code: "HISTORY_CURSOR_MISMATCH" });
  let collected = view.history;
  let cursor = view.historyNextBeforeRevision;
  let pages = 1;
  while (cursor) {
    const page = await resumed.client.readHistory({ revision: 55, beforeRevision: cursor, maxCharacters: 200000 });
    assert.equal(page.revision, 55);
    assert.ok(page.history.length > 0, "each successful unfinished page advances");
    assert.ok(page.history.at(-1).revision < cursor.beforeRevision);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 8 * 1024 * 1024);
    collected = [...page.history, ...collected];
    cursor = page.nextBeforeRevision;
    assert.equal(page.complete, cursor === null);
    pages += 1;
  }
  assert.ok(pages > 3, "the character budget, not only the count bound, splits these long turns");
  assert.deepEqual(collected, expected);
  assert.equal(new Set(collected.map((item) => item.actionId)).size, 55);
  assert.equal(resumedCalls, 0, "history recovery never requests a model");
});

test("a real child adopts compaction without a story turn, then reads the same receipt and estimate after restart with zero models", async (t) => {
  const environment = setup(t);
  const seeded = createTurnStore({ ...identity(environment.databasePath), initialState: initialState() });
  try {
    for (let revision = 1; revision <= 12; revision++) {
      const action = seeded.beginAction(request({ actionId: `context-${revision}`, baseRevision: revision - 1,
        input: "我观察楼道。" }));
      seeded.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: {
        narration: [{ id: "s", text: "林安站在楼梯间，仔细观察窗外的动静。".repeat(25) }], events: [], experiences: [],
      } });
    }
  } finally { seeded.close(); }
  let calls = 0;
  const first = await environment.open({ sessionOptions: environment.reopenOptions(), provider: { async generate(value) {
    calls++;
    const payload = JSON.parse(value.messages[1].content);
    assert.equal(payload.task, "summarize_context");
    assert.equal(value.thinkingMode, "disabled", "the compaction mode survives the real child boundary");
    assert.equal(value.maxOutputTokens, 4096, "mode selection does not raise the output allowance");
    return response({ selectedQuoteIds: [payload.quoteCandidates[0].quoteId] });
  } } });
  const beforeView = await first.client.readView();
  const before = await first.client.readContextUsage({ revision: 12 });
  const compactRequest = { requestId: "compact-through-child", revision: 12, input: "我继续观察。" };
  const result = await first.client.compactContext(compactRequest);
  assert.equal(result.status, "reduced"); assert.equal(result.modelCalls, 1); assert.equal(calls, 1);
  assert.equal(result.contextGeneration, 1); assert.ok(result.savedSafetyInputTokens > 0);
  assert.deepEqual(await first.client.readView(), beforeView);
  const after = await first.client.readContextUsage({ revision: 12, input: compactRequest.input });
  assert.equal(after.latestEstimate.safetyInputTokens, result.after.latestEstimate.safetyInputTokens);
  assert.equal(after.contextGeneration, 1); assert.notEqual(after.materializationId, before.materializationId);
  assert.equal((await first.client.compactContext(compactRequest)).modelCalls, 0);
  await assert.rejects(first.client.compactContext({ ...compactRequest, arbitraryModule: "node:fs" }), { code: "SESSION_PAYLOAD_INVALID" });
  await assert.rejects(first.client.readContextCompaction({ requestId: compactRequest.requestId, arbitraryRead: true }), { code: "SESSION_PAYLOAD_INVALID" });
  await first.client.close();
  let recoveryCalls = 0;
  const reopened = await environment.open({ sessionOptions: environment.reopenOptions(), provider: { async generate() {
    recoveryCalls++; throw new Error("a committed compaction must only be read");
  } } });
  assert.equal((await reopened.client.readContextCompaction({ requestId: compactRequest.requestId })).status, "reduced");
  assert.equal((await reopened.client.compactContext(compactRequest, { retry: true })).modelCalls, 0);
  assert.deepEqual(await reopened.client.readContextUsage({ revision: 12, input: compactRequest.input }), after);
  assert.deepEqual(await reopened.client.readView(), beforeView);
  assert.equal(recoveryCalls, 0);
});

test("an oversized single turn reports a recoverable history budget failure across IPC", async (t) => {
  const environment = setup(t);
  const narration = [{ id: "large-one", text: "完整正文".repeat(30000) }, { id: "large-two", text: "完整尾段".repeat(30000) }];
  const { client } = await environment.open({ sessionOptions: { ...environment.sessionOptions, maxOutputTokens: 32768 },
    provider: { generate: async () => response({ narration, events: [], experiences: [] }) } });
  const result = await client.runAction(request());
  assert.equal(result.status, "committed");
  assert.equal(result.error.code, "VIEW_UNAVAILABLE");
  assert.equal((await client.readAction(request().actionId)).revision, 1);
  await assert.rejects(client.readView(), { code: "HISTORY_PAGE_TOO_LARGE" });
  await assert.rejects(client.readHistory({ revision: 1 }), { code: "HISTORY_PAGE_TOO_LARGE" });
  const restored = await client.readView({ revision: 1, maxCharacters: 500000 });
  assert.deepEqual(restored.narration, narration);
  assert.deepEqual(restored.history[0].narration, narration);
  assert.equal(restored.historyComplete, true);
  const page = await client.readHistory({ revision: 1, maxCharacters: 500000 });
  assert.deepEqual(page.history, restored.history);
  assert.equal(page.complete, true);
});
