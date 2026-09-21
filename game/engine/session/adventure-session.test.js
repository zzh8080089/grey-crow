"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createAdventureSession } = require("./adventure-session");
const { createTurnStore } = require("./turn-store");
const { createOpenAICompatibleProvider } = require("../providers/openai-compatible");
const samples = require("./test-fixtures/turn-samples");

function sandbox(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-adventure-session-"));
  const sessions = [];
  const databasePath = path.join(directory, "story.sqlite");
  t.after(async () => {
    for (const session of sessions.reverse()) await session.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { databasePath,
    open(provider, options = {}) {
      const session = createAdventureSession({ ...samples.identity(databasePath),
        hostText: "克制、具体的冒险主持人。", worldText: "上海爆发后第十天。", provider, ...options });
      sessions.push(session);
      return session;
    },
  };
}

test("现有Provider适配经生成、校验、提交和恢复；重复行动不再调用模型", async (t) => {
  const context = sandbox(t);
  let calls = 0;
  const provider = createOpenAICompatibleProvider({
    baseUrl: "https://test.invalid/v1", model: "synthetic-model", apiKey: "synthetic-test-key",
    async requestImpl(url, options) {
      calls += 1;
      assert.equal(url, "https://test.invalid/v1/chat/completions");
      assert.equal(options.redirect, "error");
      const body = JSON.parse(options.body);
      assert.equal(body.max_tokens, 2048);
      assert.equal(body.messages.at(-1).role, "user");
      assert.match(JSON.stringify(body.messages), /我问陈姨/);
      return { status: 200, text: async () => JSON.stringify({ model: "synthetic-model",
        choices: [{ message: { role: "assistant", content: JSON.stringify(samples.borrowBundle()) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }) };
    },
  });
  const session = context.open(provider, { initialState: samples.initialState(), maxOutputTokens: 2048 });
  const result = await session.runAction(samples.request());
  assert.equal(result.status, "committed");
  assert.equal(result.modelCalls, 1);
  assert.equal(result.usageComplete, true);
  assert.equal(result.generationPasses, 1);
  samples.assertBorrowed(assert, result.view);
  const duplicate = await session.runAction(samples.request());
  assert.equal(duplicate.status, "committed");
  assert.equal(duplicate.modelCalls, 0);
  assert.equal(calls, 1);
  session.close();
  const restored = context.open({ generate: async () => { throw new Error("must not call on recovery"); } });
  assert.deepEqual(restored.readView(), result.view);
  assert.equal((await restored.runAction(samples.request())).status, "committed");
});

function seedLongContext(databasePath) {
  const identity = samples.identity(databasePath);
  const store = createTurnStore({ ...identity, initialState: samples.initialState() });
  try {
    for (let revision = 0; revision < 30; revision++) {
      const action = store.beginAction({ actionId: "seed-" + revision, baseRevision: revision, input: "我观察楼道。",
        locale: identity.locale, contentVersion: identity.contentVersion });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
        bundle: { narration: [{ id: "s", text: "楼道里传来缓慢的脚步声，林安侧耳听着。".repeat(50) }], events: [], experiences: [] } });
    }
  } finally { store.close(); }
  return identity;
}

const longContextPolicy = { contextPolicy: { configuredContextWindow: 64000, providerContextLimit: 64000, autoCompactRatio: 0.75 } };
function summaryResponse(data) {
  const quote = (data.quoteCandidates || data.parts.flatMap((part) => part.items))[0];
  return { text: JSON.stringify({ selectedQuoteIds: [quote.quoteId] }),
    toolCalls: [], finishReason: "stop", usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 } };
}

async function toolGrowthFixture(t) {
  const context = sandbox(t);
  const identity = seedLongContext(context.databasePath);
  const request = samples.request({ actionId: "after-guide-growth", baseRevision: 30,
    input: "我试着回想小时候闻过的一种气味。" });
  const memoryFragmentText = "模糊的感官印象不等于已经确认的往事。".repeat(300);
  const baseOptions = { memoryFragmentText, contextPolicy: { configuredContextWindow: 256000, autoCompactRatio: 0.75 } };
  const probe = context.open({ generate: async () => assert.fail("preview is read-only") }, baseOptions);
  const preview = await probe.readContextUsage({ revision: 30, input: request.input });
  await probe.close();
  const options = { ...baseOptions, maxContextCharacters: preview.latestEstimate.characters + 1000 };
  const transportState = { reasoning_content: "synthetic opaque transport ".repeat(300) };
  const loader = { text: "", toolCalls: [{ id: "load-guide", name: "read_narrative_module",
    arguments: JSON.stringify({ module: "memory_fragments" }) }], transportState,
    finishReason: "tool_calls", usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 } };
  const content = "潮湿木头的气味闪过一下，来处仍然模糊。";
  const final = { text: JSON.stringify({ narration: [{ id: "memory", text: content }], events: [
    { id: "remember", type: "memory_fragment.record", sourceSegmentIds: ["memory"],
      data: { discoveryMode: "active_recall", dimension: "body", trigger: "主动回想小时候的一种气味", content } },
  ], experiences: [] }), toolCalls: [], finishReason: "stop",
  usage: { input_tokens: 700, output_tokens: 100, total_tokens: 800 } };
  return { context, identity, request, options, memoryFragmentText, transportState, loader, final };
}

test("工具后首次超限才整理，保留同次行动的工具回包、推理续接和已加载指南后单次提交", async (t) => {
  const f = await toolGrowthFixture(t);
  let stories = 0; let summaries = 0; let firstMessages;
  const session = f.context.open({ async generate(request) {
    const data = JSON.parse(request.messages[1].content);
    if (["summarize_context", "merge_context"].includes(data.task)) {
      summaries++;
      assert.equal(stories, 1, "the first story call runs before any compaction");
      return summaryResponse(data);
    }
    stories++;
    if (stories === 1) { firstMessages = structuredClone(request.messages); return f.loader; }
    assert.equal(stories, 2);
    const history = JSON.parse(request.messages[3].content.split("\n").slice(1).join("\n"));
    assert.ok(history.summary);
    assert.deepEqual(history.turns.map(turn => turn.revision), [29, 30]);
    for (const index of [0, 1, 4]) assert.deepEqual(request.messages[index], firstMessages[index]);
    const assistant = request.messages.find(message => message.toolCalls?.[0]?.id === "load-guide");
    assert.deepEqual(assistant.transportState, f.transportState);
    const tool = request.messages.find(message => message.toolCallId === "load-guide");
    const loaded = JSON.parse(tool.content);
    assert.equal(loaded.revision, 30);
    assert.equal(loaded.quotedNarrativeSources.memoryFragmentText, f.memoryFragmentText);
    assert.ok(loaded.instructions.length > 1000);
    return f.final;
  } }, f.options);
  const before = await session.readContextUsage({ revision: 30, input: f.request.input });
  assert.equal(before.fits, true);
  assert.ok(before.latestEstimate.safetyInputTokens < before.policy.autoCompactLimit);
  assert.equal(stories + summaries, 0);
  const result = await session.runAction(f.request);
  assert.equal(result.status, "committed", JSON.stringify({ error: result.error, context: result.contextUsage }));
  assert.equal(result.revision, 31);
  assert.equal(result.generationPasses, 1);
  assert.equal(stories, 2);
  assert.ok(summaries > 0);
  assert.equal(result.compaction.status, "reduced");
  assert.ok(result.compaction.before.latestEstimate.characters > f.options.maxContextCharacters,
    "the plan includes the actual assistant and loaded guide that caused the overflow");
  assert.equal(result.compaction.after.fits, true);
  assert.equal(result.compaction.contextGeneration, 1);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.modelCalls, stories + summaries);
  assert.equal(result.compactionModelCalls, summaries);
  assert.deepEqual(result.usage, { input_tokens: 1200 + summaries * 200,
    output_tokens: 200 + summaries * 100, total_tokens: 1400 + summaries * 300 });
  assert.equal(result.usageComplete, true);
  assert.equal(result.view.state.memoryFragments.fragments.length, 1);
  assert.equal((await session.runAction(f.request)).modelCalls, 0);
  await session.close();
  const reopened = f.context.open({ generate: async () => assert.fail("recovery must not call the model") }, f.options);
  assert.deepEqual(reopened.readView(), result.view);
  assert.equal((await reopened.runAction(f.request)).modelCalls, 0);
});

test("工具后整理中取消并重启只恢复未完成输入，迟到摘要不采用且不重跑故事", async (t) => {
  const f = await toolGrowthFixture(t);
  let stories = 0; let summaries = 0; let finishLate;
  let entered;
  const summaryStarted = new Promise(resolve => { entered = resolve; });
  const session = f.context.open({ async generate(request) {
    const data = JSON.parse(request.messages[1].content);
    if (["summarize_context", "merge_context"].includes(data.task)) {
      summaries++;
      entered(request.signal);
      return new Promise(resolve => { finishLate = () => resolve(summaryResponse(data)); });
    }
    stories++;
    assert.equal(stories, 1);
    return f.loader;
  } }, f.options);
  const before = session.readView();
  const running = session.runAction(f.request);
  const signal = await summaryStarted;
  assert.equal((await session.runAction(f.request, { retry: true })).status, "running");
  assert.equal(stories, 1); assert.equal(summaries, 1);
  assert.equal(session.cancelAction(f.request.actionId).status, "cancelled");
  const result = await running;
  assert.equal(signal.aborted, true);
  assert.equal(result.status, "cancelled");
  assert.equal(result.modelCalls, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.compactionModelCalls, 1);
  assert.equal(result.usageComplete, false, "an unfinished summary has unknown usage, not zero usage");
  assert.deepEqual(result.usage, f.loader.usage);
  assert.deepEqual(session.readView(), before);
  await session.close();
  const reopened = f.context.open({ generate: async () => assert.fail("read-only recovery cannot generate") }, f.options);
  finishLate();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reopened.readView(), before);
  assert.equal((await reopened.runAction(f.request, { retry: true })).status, "cancelled");
  const context = await reopened.readContextUsage({ revision: 30, input: f.request.input });
  assert.equal(context.contextGeneration, 0);
  assert.equal(context.pendingCompaction.status, "interrupted");
  assert.equal(context.pendingCompaction.input, f.request.input);
  assert.equal(stories, 1); assert.equal(summaries, 1);
});

test("工具后整理没有收益便停止；失败与重启均不自动重试或丢弃已取得的来源", async (t) => {
  const f = await toolGrowthFixture(t);
  let stories = 0; let summaries = 0;
  const session = f.context.open({ async generate(request) {
    const data = JSON.parse(request.messages[1].content);
    if (["summarize_context", "merge_context"].includes(data.task)) {
      summaries++;
      const quotes = data.quoteCandidates || data.parts.flatMap(part => part.items);
      return { ...summaryResponse(data), text: JSON.stringify({ selectedQuoteIds: [...new Set(quotes.map(quote => quote.quoteId))] }) };
    }
    stories++;
    assert.equal(stories, 1, "no benefit must not issue another story request");
    return f.loader;
  } }, f.options);
  const before = session.readView();
  const result = await session.runAction(f.request);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "CONTEXT_BUDGET_EXCEEDED");
  assert.equal(result.compaction.status, "no_benefit");
  assert.ok(summaries > 0);
  assert.equal(result.compactionModelCalls, summaries);
  assert.equal(result.modelCalls, summaries + 1);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.usageComplete, true);
  assert.deepEqual(session.readView(), before);
  assert.equal((await session.readContextUsage({ revision: 30 })).contextGeneration, 0);
  assert.equal((await session.runAction(f.request)).modelCalls, 0);
  await session.close();
  const reopened = f.context.open({ generate: async () => assert.fail("failed receipt recovery cannot generate") }, f.options);
  assert.deepEqual(reopened.readView(), before);
  assert.equal(reopened.readPendingAction({ revision: 30 }).input, f.request.input);
  assert.equal((await reopened.runAction(f.request)).modelCalls, 0);
});

test("工具后一次整理已用尽时，修正消息再次超限不得再整理或重置模型计数", async (t) => {
  const { countSessionContext } = require("./session-context");
  const { DatabaseSync } = require("node:sqlite");
  const f = await toolGrowthFixture(t);
  let stories = 0; let summaries = 0;
  const session = f.context.open({ async generate(request) {
    const data = JSON.parse(request.messages[1].content);
    if (["summarize_context", "merge_context"].includes(data.task)) {
      summaries++;
      assert.equal(summaries, 1, "all repair passes share one automatic compaction opportunity");
      const quotes = data.quoteCandidates.filter(quote => quote.source.kind === "narration").slice(0, 4);
      assert.equal(quotes.length, 4);
      return { ...summaryResponse(data), text: JSON.stringify({ selectedQuoteIds: quotes.map(quote => quote.quoteId) }) };
    }
    stories++;
    if (stories === 1) return f.loader;
    assert.equal(stories, 2);
    const current = countSessionContext(request).characters;
    const extra = f.options.maxContextCharacters - current + 1000;
    assert.ok(extra > 0 && extra < 30000, "the second response fits its output cap but makes the next full input too large");
    return { text: "{", toolCalls: [], finishReason: "stop",
      transportState: { reasoning_content: "x".repeat(extra) }, usage: f.final.usage };
  } }, f.options);
  const before = session.readView();
  const result = await session.runAction(f.request);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "CONTEXT_BUDGET_EXCEEDED");
  assert.equal(result.compaction.status, "reduced");
  assert.equal(result.modelCalls, 3);
  assert.equal(result.compactionModelCalls, 1);
  assert.equal(result.toolCalls, 1);
  assert.equal(stories, 2); assert.equal(summaries, 1);
  assert.deepEqual(session.readView(), before);
  const db = new DatabaseSync(f.context.databasePath, { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT count(*) AS count FROM context_compactions").get().count, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM turns WHERE revision > 30").get().count, 0);
  } finally { db.close(); }
});

test("首轮自动整理已占用本attempt机会时，工具后超限不能另起第二次整理", async (t) => {
  const { DatabaseSync } = require("node:sqlite");
  const f = await toolGrowthFixture(t);
  const probe = f.context.open({ generate: async () => assert.fail("preview cannot generate") }, f.options);
  const measured = await probe.readContextUsage({ revision: 30, input: f.request.input });
  await probe.close();
  const options = { ...f.options, memoryFragmentText: f.memoryFragmentText.repeat(4),
    contextPolicy: { configuredContextWindow: Math.ceil(measured.latestEstimate.safetyInputTokens / 0.8), autoCompactRatio: 0.75 } };
  let stories = 0; let summaries = 0;
  const session = f.context.open({ async generate(request) {
    const data = JSON.parse(request.messages[1].content);
    if (["summarize_context", "merge_context"].includes(data.task)) {
      summaries++;
      assert.equal(stories, 0, "this compaction is the initial preparation only");
      return summaryResponse(data);
    }
    stories++;
    assert.equal(stories, 1);
    assert.ok(JSON.parse(request.messages[3].content.split("\n").slice(1).join("\n")).summary);
    return f.loader;
  } }, options);
  const before = await session.readContextUsage({ revision: 30, input: f.request.input });
  assert.equal(before.fits, true);
  assert.ok(before.latestEstimate.safetyInputTokens >= before.policy.autoCompactLimit);
  const result = await session.runAction(f.request);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "CONTEXT_BUDGET_EXCEEDED");
  assert.equal(result.compaction.status, "reduced");
  assert.equal(result.compaction.after.fits, true);
  assert.equal(result.contextUsage.fits, false, "the later guide must still respect the full request budget");
  assert.equal(result.compactionModelCalls, summaries);
  assert.equal(result.modelCalls, summaries + 1);
  assert.equal(result.toolCalls, 1);
  assert.equal(session.readView().revision, 30);
  const db = new DatabaseSync(f.context.databasePath, { readOnly: true });
  try { assert.equal(db.prepare("SELECT count(*) AS count FROM context_compactions").get().count, 1); }
  finally { db.close(); }
});

test("自动阈值在登记行动后仅整理一次，再执行故事；累计调用和单次上下文分开", async (t) => {
  const context = sandbox(t);
  const identity = seedLongContext(context.databasePath);
  let summaries = 0; let stories = 0;
  const session = context.open({ async generate(request) {
    const data = JSON.parse(request.messages[1].content);
    if (["summarize_context", "merge_context"].includes(data.task)) { summaries++; return summaryResponse(data); }
    stories++;
    const history = JSON.parse(request.messages[3].content.split("\n").slice(1).join("\n"));
    assert.ok(history.summary);
    assert.deepEqual(history.turns.map((turn) => turn.revision), [29, 30]);
    return { text: JSON.stringify({ narration: [{ id: "next", text: "林安沿走廊继续向前。" }], events: [], experiences: [] }),
      toolCalls: [], finishReason: "stop", usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 } };
  } }, longContextPolicy);
  const before = await session.readContextUsage({ revision: 30, input: "我继续往前。" });
  assert.ok(before.latestEstimate.safetyInputTokens >= before.policy.autoCompactLimit);
  assert.equal(summaries + stories, 0);
  const request = { actionId: "after-auto", baseRevision: 30, input: "我继续往前。", locale: identity.locale, contentVersion: identity.contentVersion };
  const result = await session.runAction(request);
  assert.equal(result.status, "committed");
  assert.equal(result.revision, 31);
  assert.equal(result.compaction.status, "reduced");
  assert.equal(result.compaction.contextGeneration, 1);
  assert.ok(summaries > 0); assert.equal(stories, 1);
  assert.equal(result.modelCalls, summaries + stories);
  assert.equal(result.compactionModelCalls, summaries);
  assert.equal(result.usage.input_tokens, summaries * 200 + 500);
  assert.equal(result.contextUsage.latestActual.inputTokens, 500);
  assert.equal((await session.runAction(request)).modelCalls, 0);
  const after = await session.readContextUsage({ revision: 31 });
  assert.equal(after.contextGeneration, 1); assert.equal(after.pendingCompaction, null);
  assert.equal(stories, 1);
});

test("自动整理结构失败后仅同一行动显式重试可恢复；同进程与重启都保留身份、预算和一次提交", async (t) => {
  const { DatabaseSync } = require("node:sqlite");
  for (const reopen of [false, true]) await t.test(reopen ? "重启后明确重试" : "同会话明确重试", async (t) => {
    const context = sandbox(t);
    const identity = seedLongContext(context.databasePath);
    const request = { actionId: "retry-invalid-auto", baseRevision: 30, input: "我继续留意楼道里的声音。",
      locale: identity.locale, contentVersion: identity.contentVersion };
    const probe = context.open({ generate: async () => assert.fail("preview cannot generate") }, longContextPolicy);
    const measured = await probe.readContextUsage({ revision: 30, input: request.input });
    await probe.close();
    // Trigger automatic preparation while reserving room for its complete
    // selection request and its bounded structural repairs, rather than testing overflow.
    const window = Math.floor(measured.latestEstimate.safetyInputTokens * 1.9);
    const options = { contextPolicy: { configuredContextWindow: window, autoCompactRatio: 0.5 } };
    let invalidSelection = true;
    let summaries = 0;
    let stories = 0;
    const provider = { async generate(payload) {
      assert.equal(Object.hasOwn(payload, "retry"), false, "retry authorization is internal, not a Provider option");
      assert.equal(payload.maxOutputTokens, 4096);
      const data = JSON.parse(payload.messages[1].content);
      if (["summarize_context", "merge_context"].includes(data.task)) {
        summaries++;
        assert.equal(data.adventureId, identity.adventureId);
        assert.equal(data.revision, request.baseRevision);
        if (!invalidSelection) return summaryResponse(data);
        return { ...summaryResponse(data), text: JSON.stringify({
          selectedQuoteIds: Array(48).fill(data.quoteCandidates[0].quoteId),
        }) };
      }
      stories++;
      assert.equal(payload.messages.find((message) => message.content.startsWith("Current player action:\n")).content,
        "Current player action:\n" + request.input);
      const history = JSON.parse(payload.messages[3].content.split("\n").slice(1).join("\n"));
      assert.ok(history.summary);
      assert.deepEqual(history.turns.map((turn) => turn.revision), [29, 30]);
      // A commit-time repair is still inside this action attempt. It must not
      // restart the now successful automatic preparation a second time.
      return { text: JSON.stringify(stories === 1 ? { narration: [], events: [], experiences: [] }
        : { narration: [{ id: "next", text: "你仍在楼道里听着，暂时没有离开。" }],
          events: [], experiences: [] }),
        toolCalls: [], finishReason: "stop", usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 } };
    } };
    let session = context.open(provider, options);
    const before = await session.readContextUsage({ revision: 30, input: request.input });
    assert.equal(before.fits, true);
    assert.ok(before.latestEstimate.safetyInputTokens >= before.policy.autoCompactLimit);
    function job() {
      const db = new DatabaseSync(context.databasePath, { readOnly: true });
      try { return db.prepare("SELECT request_id,request_json,source_hash,through_revision,start_generation,attempt_id,owner_action_id,owner_attempt_id,status FROM context_compactions").get(); }
      finally { db.close(); }
    }
    const first = await session.runAction(request);
    assert.equal(first.status, "failed");
    assert.equal(first.error.code, "COMPACTION_OUTPUT_INVALID");
    assert.equal(first.compaction.status, "failed");
    assert.equal(first.compactionModelCalls, 4);
    assert.deepEqual(first.compactionUsage, { input_tokens: 800, output_tokens: 400, total_tokens: 1200 });
    assert.equal(first.modelCalls, 4);
    assert.equal(stories, 0);
    assert.equal(session.readView().revision, 30);
    const failedJob = job();
    assert.equal(failedJob.status, "failed");
    invalidSelection = false;
    if (reopen) { await session.close(); session = context.open(provider, options); }
    const pending = session.readPendingAction({ revision: 30 });
    assert.equal(pending.actionId, request.actionId);
    assert.equal(pending.input, request.input);
    assert.equal((await session.runAction(request)).status, "failed");
    assert.equal(summaries, 4);
    assert.equal(stories, 0);
    assert.deepEqual(job(), failedJob);
    const conflict = await session.runAction({ ...request, input: "另一个输入不能替代原行动。" }, { retry: true });
    assert.equal(conflict.error.code, "ACTION_INPUT_CONFLICT");
    assert.equal(summaries, 4);
    const restored = await session.runAction(request, { retry: true });
    assert.equal(restored.status, "committed");
    assert.equal(restored.revision, 31);
    assert.equal(restored.actionId, first.actionId);
    assert.notEqual(restored.attemptId, first.attemptId);
    const completedJob = job();
    assert.equal(completedJob.request_id, failedJob.request_id);
    assert.equal(completedJob.request_json, failedJob.request_json);
    for (const field of ["source_hash", "through_revision", "start_generation"]) assert.equal(completedJob[field], failedJob[field]);
    assert.notEqual(completedJob.attempt_id, failedJob.attempt_id);
    assert.equal(completedJob.owner_action_id, request.actionId);
    assert.equal(completedJob.owner_attempt_id, restored.attemptId);
    assert.equal(completedJob.status, "committed");
    assert.equal(restored.compaction.requestId, failedJob.request_id);
    assert.equal(restored.compaction.status, "reduced");
    assert.equal(restored.compaction.contextGeneration, 1);
    assert.equal(restored.compactionModelCalls, summaries - 4);
    assert.equal(restored.modelCalls, summaries - 4 + stories);
    assert.equal(restored.usage.input_tokens, (summaries - 4) * 200 + stories * 500);
    assert.equal(restored.usage.output_tokens, (summaries - 4) * 100 + stories * 100);
    assert.equal(restored.usageComplete, true);
    assert.equal(restored.generationPasses, 2);
    assert.equal(stories, 2);
    const duplicate = await session.runAction(request, { retry: true });
    assert.equal(duplicate.status, "committed");
    assert.equal(duplicate.modelCalls, 0);
    assert.equal(duplicate.compactionModelCalls, 0);
    assert.equal(session.readView().revision, 31);
    assert.deepEqual(job(), completedJob);
  });
});

test("自动整理中取消不提交正文；新行动不能自动绕过未解决任务，手动明确恢复原摘要", async (t) => {
  const context = sandbox(t); const identity = seedLongContext(context.databasePath);
  let notify; const started = new Promise((resolve) => { notify = resolve; });
  let calls = 0;
  const session = context.open({ async generate() { calls++; notify(); return new Promise(() => {}); } }, longContextPolicy);
  const request = { actionId: "cancel-auto", baseRevision: 30, input: "我继续观察。", locale: identity.locale, contentVersion: identity.contentVersion };
  const running = session.runAction(request);
  await started;
  const duplicate = await session.runAction(request, { retry: true });
  assert.equal(duplicate.status, "running");
  assert.equal(duplicate.modelCalls, 0);
  assert.equal(calls, 1, "explicit retry cannot steal a running automatic preparation");
  assert.equal(session.cancelAction(request.actionId).status, "cancelled");
  const cancelled = await running;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.modelCalls, 1);
  assert.equal(session.readPlayerState().revision, 30);
  await session.close();
  const restarted = context.open({ async generate(request) { calls++; return summaryResponse(JSON.parse(request.messages[1].content)); } }, longContextPolicy);
  const recovered = await restarted.readContextUsage({ revision: 30 });
  assert.equal(recovered.pendingCompaction.status, "interrupted");
  assert.equal(recovered.pendingCompaction.input, request.input);
  assert.equal(calls, 1);
  assert.equal((await restarted.runAction(request, { retry: true })).status, "cancelled");
  assert.equal(calls, 1);
  const another = await restarted.runAction({ ...request, actionId: "new-action-after-interrupted" }, { retry: true });
  assert.equal(another.status, "failed");
  assert.equal(another.modelCalls, 0);
  assert.equal(calls, 1);
  const retried = await restarted.compactContext({ requestId: recovered.pendingCompaction.requestId,
    revision: 30, input: recovered.pendingCompaction.input }, { retry: true });
  assert.equal(retried.status, "reduced");
  assert.equal(restarted.readPlayerState().revision, 30);
});

test("自动线以上但90%以下的整理失败也不会静默继续故事", async (t) => {
  const context = sandbox(t); const identity = seedLongContext(context.databasePath);
  const probe = context.open({ generate: async () => { throw new Error("read-only preview must not generate"); } }, longContextPolicy);
  const initial = await probe.readContextUsage({ revision: 30, input: "我继续观察。" });
  await probe.close();
  const window = Math.ceil(initial.latestEstimate.safetyInputTokens / 0.8);
  let summaries = 0; let stories = 0;
  const session = context.open({ async generate(request) {
    if (JSON.parse(request.messages[1].content).task === "summarize_context") { summaries++; throw new Error("synthetic model outage"); }
    stories++; throw new Error("story must not proceed");
  } }, { contextPolicy: { configuredContextWindow: window, providerContextLimit: window, autoCompactRatio: 0.75 } });
  const before = await session.readContextUsage({ revision: 30, input: "我继续观察。" });
  assert.equal(before.fits, true);
  assert.ok(before.latestEstimate.safetyInputTokens >= before.policy.autoCompactLimit);
  assert.ok(before.latestEstimate.safetyInputTokens < before.policy.emergencyLimit);
  const request = { actionId: "failed-auto-with-headroom", baseRevision: 30, input: "我继续观察。",
    locale: identity.locale, contentVersion: identity.contentVersion };
  const result = await session.runAction(request);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "COMPACTION_MODEL_FAILED");
  assert.equal(result.modelCalls, 1);
  assert.equal(session.readPlayerState().revision, 30);
  assert.equal(stories, 0); assert.equal(summaries, 1);
  assert.equal((await session.readContextUsage({ revision: 30 })).pendingCompaction.input, request.input);
});

test("结构修复共享实际模型预算，并报告真实调用次数而非生成轮次", async (t) => {
  const context = sandbox(t);
  let calls = 0;
  const session = context.open({ generate: async () => {
    calls += 1;
    return { text: JSON.stringify(calls === 1 ? samples.borrowBundle({ quantity: 99 }) : samples.borrowBundle()),
      usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } };
  } }, { initialState: samples.initialState(), maxModelCalls: 2 });
  const result = await session.runAction(samples.request());
  assert.equal(result.status, "committed");
  assert.equal(result.generationPasses, 2);
  assert.equal(result.modelCalls, 2);
  assert.equal(calls, 2);
  samples.assertBorrowed(assert, result.view);
});

test("关闭中止不配合的生成并持久记中断，重开显式重试同一输入", async (t) => {
  const context = sandbox(t);
  let entered;
  let respond;
  const started = new Promise((resolve) => { entered = resolve; });
  const session = context.open({ generate: async ({ signal }) => {
    entered(signal);
    return new Promise((resolve) => { respond = resolve; });
  } }, { initialState: samples.initialState() });
  const pending = session.runAction(samples.request());
  const signal = await started;
  session.close();
  assert.equal(signal.aborted, true);
  const ended = await pending;
  assert.equal(ended.status, "unknown");
  assert.equal(ended.error.code, "PROCESS_INTERRUPTED");
  const reopened = context.open({ generate: async () => ({ text: JSON.stringify(samples.borrowBundle()) }) });
  assert.equal(reopened.readAction("borrow-rice").status, "interrupted");
  assert.equal((await reopened.runAction(samples.request())).status, "interrupted");
  respond({ text: JSON.stringify(samples.borrowBundle()) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reopened.readView().revision, 0);
  const retried = await reopened.runAction(samples.request(), { retry: true });
  assert.equal(retried.status, "committed");
  assert.equal(reopened.readView().revision, 1);
  assert.equal(retried.usageComplete, false);
});

test("非法配置在创建数据库之前失败", (t) => {
  const context = sandbox(t);
  const provider = { generate: async () => ({}) };
  for (const bad of [{ timeoutMs: -1 }, { maxModelCalls: 0 }, { maxOutputTokens: 32769 }, { hostText: "" },
    { narrationPreferences: { lengthPreset: "custom", customTargetChars: 119 } },
    { contextPolicy: { configuredContextWindow: -1 } }, { contextPolicy: { apiKey: "must-not-enter" } }]) {
    assert.throws(() => context.open(provider, { initialState: samples.initialState(), ...bad }));
    assert.equal(fs.existsSync(context.databasePath), false);
  }
});

test("只读上下文预览绑定正式版本，待用设置不改变默认或产生行动", async (t) => {
  const context = sandbox(t);
  let calls = 0;
  const preferences = { lengthPreset: "custom", customTargetChars: 180 };
  const session = context.open({ generate: async (request) => {
    calls++;
    assert.match(request.messages[0].content, /"targetCharacters":180/);
    return { text: JSON.stringify(samples.borrowBundle()), usage: { input_tokens: 9000, output_tokens: 100, total_tokens: 9100 } };
  } }, { initialState: samples.initialState(), narrationPreferences: preferences,
    contextPolicy: { configuredContextWindow: 128000, providerContextLimit: 64000, autoCompactRatio: 0.7 } });
  preferences.customTargetChars = 800;
  const beforeFile = fs.readFileSync(context.databasePath);
  const before = await session.readContextUsage({ revision: 0 });
  assert.equal(before.adventureId, samples.identity(context.databasePath).adventureId);
  assert.equal(before.revision, 0); assert.equal(before.actionId, null); assert.equal(before.scope, "next_request");
  assert.equal(before.latestActual, null); assert.equal(before.compactionAvailable, true);
  assert.equal(before.policy.effectiveContextWindow, 64000);
  const preview = await session.readContextUsage({ revision: 0, input: "我询问陈姨。",
    narrationPreferences: { lengthPreset: "detailed" }, contextPolicy: { configuredContextWindow: 32000, autoCompactRatio: 0.5 } });
  assert.notEqual(preview.settingsIdentity, before.settingsIdentity);
  assert.equal(preview.includesPlayerInput, true);
  assert.deepEqual(await session.readContextUsage({ revision: 0 }), before);
  assert.deepEqual(fs.readFileSync(context.databasePath), beforeFile);
  assert.equal(calls, 0); assert.equal(session.readAction(samples.request().actionId), null);
  const committed = await session.runAction(samples.request());
  assert.equal(committed.status, "committed");
  assert.equal(committed.contextUsage.revision, 0); assert.equal(committed.contextUsage.scope, "invocation");
  assert.equal(committed.contextUsage.actionId, samples.request().actionId);
  assert.equal(committed.contextUsage.settingsIdentity, before.settingsIdentity);
  const duplicate = await session.runAction(samples.request());
  assert.equal(duplicate.modelCalls, 0); assert.equal(duplicate.contextUsage, null);
  const next = await session.readContextUsage({ revision: 1 });
  assert.equal(next.revision, 1); assert.equal(next.latestActual, null); assert.equal(calls, 1);
});

test("章节消费者也接收同一上下文策略，无法容纳请求时零模型保存摘录", async (t) => {
  const context = sandbox(t);
  const { createTurnStore } = require("./turn-store");
  const store = createTurnStore({ ...samples.identity(context.databasePath), initialState: samples.initialState() });
  const action = store.beginAction(samples.request());
  store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.borrowBundle() });
  store.close();
  let calls = 0;
  const session = context.open({ generate() { calls++; throw new Error("chapter must respect configured context before invoking Provider"); } },
    { contextPolicy: { configuredContextWindow: 1 } });
  const result = await session.saveChapter({ targetRevision: 1 });
  assert.equal(result.saved, true); assert.equal(result.chapterStatus, "created");
  assert.equal(result.chapter.mode, "excerpt");
  assert.equal(result.chapter.fallbackReason, "CHAPTER_CONTEXT_BUDGET_EXCEEDED");
  assert.equal(result.modelCalls, 0); assert.equal(calls, 0);
  assert.equal(session.readView().revision, 1);
});

test("工具续接后取消只报告终态，执行结果独立结算两次模型调用并忽略迟到usage", async (t) => {
  const context = sandbox(t);
  let calls = 0;
  let entered;
  let finishLate;
  const secondCallStarted = new Promise((resolve) => { entered = resolve; });
  const session = context.open({ generate: async () => {
    calls += 1;
    if (calls === 1) return { text: "", toolCalls: [
      { id: "read-person", name: "read_entity", arguments: '{"entityId":"npc"}' },
    ], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    entered();
    return new Promise((resolve) => { finishLate = resolve; });
  } }, { initialState: samples.initialState() });
  const pending = session.runAction(samples.request());
  await secondCallStarted;
  const cancellation = session.cancelAction(samples.request().actionId);
  assert.equal(cancellation.status, "cancelled");
  assert.equal(Object.hasOwn(cancellation, "modelCalls"), false);
  const ended = await pending;
  assert.equal(ended.status, "cancelled");
  assert.equal(calls, 2);
  assert.equal(ended.modelCalls, 2);
  assert.equal(ended.generationPasses, 1);
  assert.equal(ended.toolCalls, 1);
  assert.equal(ended.usageComplete, false);
  assert.deepEqual(ended.usage, { input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  assert.equal(ended.contextUsage.revision, 0);
  assert.equal(ended.contextUsage.latestEstimate.callIndex, 2);
  assert.equal(ended.contextUsage.latestActual.inputTokens, 10);
  const settledUsage = structuredClone(ended.usage);
  const settledContext = structuredClone(ended.contextUsage);
  finishLate({ text: JSON.stringify(samples.borrowBundle()), usage: { input_tokens: 20, output_tokens: 15, total_tokens: 35 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ended.usage, settledUsage);
  assert.deepEqual(ended.contextUsage, settledContext);
  assert.equal(ended.usageComplete, false);
  assert.equal(session.readView().revision, 0);
});
