"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTurnStore } = require("./turn-store");
const { createTurnMemory } = require("./turn-memory");
const { createTurnGenerator } = require("./turn-generator");
const { createSessionCompaction, validateSelection } = require("./session-compaction");
const samples = require("./test-fixtures/turn-samples");
const { COMPACTION_QUOTE_MAX_ITEMS, createCompactionQuotes } = require("./session-compaction-quotes");
const { countSessionContext, estimateSessionContext, normalizeSessionContextOptions } = require("./session-context");

function response(value, extra = {}) {
  return { text: JSON.stringify(value), toolCalls: [], finishReason: "stop", usage: { input_tokens: 200, output_tokens: 100 }, ...extra };
}
function candidate(data, index = 0) {
  const quotes = data.quoteCandidates || data.parts?.flatMap((part) => part.items);
  return { selectedQuoteIds: [quotes[index].quoteId] };
}
function canonicalWholeQuote(quote) {
  assert.deepEqual(quote.range, { start: 0, end: quote.text.length, totalCharacters: quote.text.length });
  return createCompactionQuotes({ ...quote.source, text: quote.text })[0];
}

function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-compaction-"));
  const identity = samples.identity(path.join(root, "session.sqlite"));
  const stores = []; const services = []; const calls = [];
  let revision = 0;
  const store = createTurnStore({ ...identity, initialState: samples.initialState(), ...(options.storeOptions || {}) });
  stores.push(store);
  const contextOptions = options.contextOptions || {};
  function open() { const next = createTurnStore(identity); stores.push(next); return next; }
  function generator(database = store, provider = { generate: async () => { throw new Error("Unexpected story call"); } }) {
    return createTurnGenerator({ store: database, adventureId: identity.adventureId, memory: createTurnMemory({ store: database }),
      provider, hostText: "克制、具体地回应玩家。", worldText: "上海，爆发后的第十天。", compactionAvailable: true, ...contextOptions });
  }
  const planner = generator();
  function service(extra = {}) {
    const item = createSessionCompaction({ store, generator: planner,
      provider: { async generate(request) { calls.push(request); return response(candidate(JSON.parse(request.messages[1].content))); } },
      ...contextOptions, ...extra });
    services.push(item); return item;
  }
  t.after(async () => { for (const item of services) await item.shutdown(); for (const database of stores) database.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { identity, store, planner, calls, open, generator, service,
    commit(bundle = { narration: [{ id: "s", text: "林安站在楼梯间，观察窗外。".repeat(25) }], events: [], experiences: [] }, input = "我观察楼道。") {
      const action = store.beginAction({ actionId: "turn-" + (revision + 1), baseRevision: revision, input,
        locale: identity.locale, contentVersion: identity.contentVersion });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
      return ++revision;
    },
  };
}

test("compaction preserves provider reasons and permits explicit recovery after connection repair", async (t) => {
  for (const [code, retryable] of [["API_TIMEOUT", true], ["UPSTREAM_AUTH_ERROR", false], ["UPSTREAM_RATE_LIMIT", true], ["UPSTREAM_BAD_RESPONSE", false]]) {
    await t.test(code, async (t) => {
      const env = fixture(t);
      for (let i = 0; i < 8; i++) env.commit();
      const before = env.store.readContextHistory();
      let calls = 0, repaired = false;
      const service = env.service({ provider: { async generate(request) {
        calls++;
        if (!repaired) throw Object.assign(new Error("PRIVATE_UPSTREAM_BODY"), { code, retryable });
        return response(candidate(JSON.parse(request.messages[1].content)));
      } } });
      const request = { requestId: "provider-recovery", revision: 8 };
      const failed = await service.compact(request);
      assert.equal(failed.status, "failed");
      assert.deepEqual(failed.error, { code, retryable });
      const restored = env.open();
      assert.deepEqual(restored.readCompactionState().pendingJob.error, { code, retryable });
      assert.equal(restored.readCompactionState().pendingJob.requestId, request.requestId);
      assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_UPSTREAM_BODY/);
      assert.deepEqual(env.store.readContextHistory(), before);
      assert.deepEqual((await service.compact(request)).error, { code, retryable });
      assert.equal(calls, 1, "reading a failed job cannot silently call the model again");
      repaired = true;
      const recovered = await service.compact(request, { retry: true });
      assert.equal(recovered.status, "reduced", JSON.stringify(recovered));
      assert.equal(calls, 2);
      assert.equal(env.store.readCompactionState().pendingJob, null);
    });
  }
});

test("request-local quote IDs map exactly back to canonical sources across adoption and restart", async (t) => {
  const env = fixture(t);
  const text = '她说：“还不能确定。”\nThe answer is "maybe".\\😀 まだ不明。';
  env.commit({ narration: [{ id: "uncertain", text }], events: [], experiences: [] });
  for (let i = 1; i < 8; i++) env.commit();
  const canonical = createCompactionQuotes({ adventureId: env.identity.adventureId, revision: 1,
    segmentId: "uncertain", text })[0];
  let data;
  const result = await env.service({ provider: { async generate(request) {
    env.calls.push(request); data = JSON.parse(request.messages[1].content);
    return response({ selectedQuoteIds: ["q1"] });
  } } }).compact({ requestId: "local-selection", revision: 8 });
  assert.deepEqual(data.quoteCandidates.map(quote => quote.quoteId),
    data.quoteCandidates.map((_, index) => `q${index + 1}`));
  assert.deepEqual(data.quoteCandidates[0], { ...canonical, quoteId: "q1" });
  assert.equal(result.status, "reduced", JSON.stringify(result.error));
  assert.equal(result.modelCalls, 1);
  assert.deepEqual(env.store.readContextHistory().summary.items, [canonical]);
  assert.deepEqual(env.open().readContextHistory().summary.items, [canonical]);
});

test("one invalid option among 44 selections rejects the whole result after three same-map repairs", async (t) => {
  for (const invalid of ["unknown", "duplicate", "canonical", "padded"]) await t.test(invalid, async (t) => {
    const env = fixture(t);
    for (let i = 0; i < 26; i++) env.commit();
    const before = env.store.readContextHistory();
    let firstMessages;
    const result = await env.service({ provider: { async generate(request) {
      env.calls.push(request);
      const data = JSON.parse(request.messages[1].content);
      if (env.calls.length === 1) firstMessages = structuredClone(request.messages);
      else {
        assert.deepEqual(request.messages.slice(0, 2), firstMessages);
        assert.deepEqual(JSON.parse(request.messages.at(-1).content.split("Fixed structural feedback: ")[1]),
          [{ issue: "QUOTE_NOT_SUPPLIED_OR_DUPLICATE", itemIndex: 15 }]);
      }
      const selectedQuoteIds = data.quoteCandidates.slice(0, 44).map(quote => quote.quoteId);
      assert.equal(selectedQuoteIds.length, 44);
      selectedQuoteIds[15] = invalid === "unknown" ? "q999999" : invalid === "duplicate" ? selectedQuoteIds[0]
        : invalid === "canonical" ? canonicalWholeQuote(data.quoteCandidates[15]).quoteId : ` ${selectedQuoteIds[15]} `;
      return response({ selectedQuoteIds });
    } } }).compact({ requestId: `strict-${invalid}`, revision: 26 });
    assert.equal(result.status, "failed"); assert.equal(result.error.code, "COMPACTION_OUTPUT_INVALID");
    assert.equal(result.modelCalls, 4); assert.equal(env.calls.length, 4);
    assert.deepEqual(env.store.readContextHistory(), before);
    assert.deepEqual(env.open().readContextHistory(), before);
  });
});

test("request fitting uses the same short options sent to the provider, while preview and storage receive canonical quotes", async (t) => {
  const contextOptions = { maxContextCharacters: 36000 };
  const env = fixture(t, { contextOptions });
  env.commit({ narration: Array.from({ length: 128 }, (_, index) => ({ id: `s${index}`, text: '“未确认”\\\n😀' })), events: [], experiences: [] });
  env.commit(); env.commit();
  const settings = normalizeSessionContextOptions(contextOptions);
  let canonicalCharacters, actualCharacters;
  const service = env.service({ maxModelCalls: 1, provider: { async generate(request) {
    env.calls.push(request);
    const data = JSON.parse(request.messages[1].content);
    assert.equal(data.coverage, "complete");
    assert.equal(data.quoteCandidates.length, 129);
    const canonicalData = { ...data, quoteCandidates: data.quoteCandidates.map(canonicalWholeQuote) };
    const canonicalMessages = [request.messages[0], { ...request.messages[1], content: JSON.stringify(canonicalData) }];
    actualCharacters = countSessionContext(request).characters;
    canonicalCharacters = countSessionContext({ ...request, messages: canonicalMessages }).characters;
    assert.equal(estimateSessionContext({ ...request, settings,
      identity: { adventureId: env.identity.adventureId, revision: 3, actionId: null }, scope: "invocation" }).fits, true);
    return response(candidate(data));
  } } });
  const result = await service.compact({ requestId: "transport-fitting", revision: 3 });
  assert.equal(result.status, "reduced", JSON.stringify(result.error));
  assert.equal(result.modelCalls, 1);
  assert.ok(actualCharacters <= contextOptions.maxContextCharacters, String(actualCharacters));
  assert.ok(canonicalCharacters > contextOptions.maxContextCharacters, String(canonicalCharacters));
  assert.match(env.store.readContextHistory().summary.items[0].quoteId, /^quote-[a-f0-9]{64}$/);
  assert.deepEqual(result.after.latestEstimate, (await env.planner.readContextUsage({ revision: 3 })).latestEstimate);
  t.diagnostic(JSON.stringify({ actualCharacters, canonicalCharacters, characterLimit: contextOptions.maxContextCharacters }));
});

test("二十四轮真实正文被带来源摘要替换，收益来自实际完整请求；重复和重启零模型", async (t) => {
  const env = fixture(t);
  for (let i = 0; i < 24; i++) env.commit();
  const before = env.store.readPlayerState({ revision: 24 });
  const history = env.store.readHistory({ revision: 24, limit: 40 });
  const planned = await env.planner.readCompactionPlan({ revision: 24 });
  assert.equal(planned.status, "ready");
  assert.equal(planned.turns.length, 22);
  const service = env.service();
  const result = await service.compact({ requestId: "compact-24", revision: 24 });
  assert.equal(result.status, "reduced");
  assert.equal(result.modelCalls, 1);
  assert.ok(result.savedSafetyInputTokens > 0);
  const after = await env.planner.readContextUsage({ revision: 24 });
  assert.equal(after.latestEstimate.safetyInputTokens, result.after.latestEstimate.safetyInputTokens);
  assert.equal(after.contextGeneration, 1);
  assert.deepEqual(env.store.readPlayerState({ revision: 24 }), before);
  assert.deepEqual(env.store.readHistory({ revision: 24, limit: 40 }), history);
  const compressed = env.store.readContextHistory({ revision: 24 });
  assert.equal(compressed.summary.summaryId, "compact-24");
  assert.equal(compressed.summary.throughRevision, 22);
  assert.deepEqual(compressed.turns.map((turn) => turn.revision), [23, 24]);
  assert.equal((await service.compact({ requestId: "compact-24", revision: 24 })).modelCalls, 0);
  const reopened = env.open();
  const nextService = env.service({ store: reopened, generator: env.generator(reopened) });
  assert.equal((await nextService.compact({ requestId: "compact-24", revision: 24 })).status, "reduced");
  assert.equal(env.calls.length, 1);
  assert.equal(nextService.readCompaction({ requestId: "compact-24" }).modelCalls, 0);
});

test("连续两次整理只能保留原文选择，犹疑原话跨重启不被再次改写", async (t) => {
  const env = fixture(t);
  const original = "她迟疑着说：‘大前天……下午？’又摇了摇头，自己也不敢肯定。";
  env.commit({ narration: [{ id: "uncertain", text: original }], events: [], experiences: [] });
  for (let i = 1; i < 8; i++) env.commit();
  const first = await env.service().compact({ requestId: "quotes-first", revision: 8 });
  assert.equal(first.status, "reduced");
  const saved = env.store.readContextHistory({ revision: 8 }).summary.items[0];
  assert.equal(saved.text, original);
  assert.deepEqual(saved.range, { start: 0, end: original.length, totalCharacters: original.length });
  env.commit(); env.commit();
  const database = env.open();
  const second = await env.service({ store: database, generator: env.generator(database), provider: { async generate(request) {
    env.calls.push(request);
    const data = JSON.parse(request.messages[1].content);
    assert.deepEqual(data.previousSummary.items, [{ ...saved, quoteId: data.previousSummary.items[0].quoteId }]);
    assert.match(data.previousSummary.items[0].quoteId, /^q[1-9][0-9]*$/);
    assert.ok(data.quoteCandidates.every((quote) => quote.source.revision > 6));
    assert.equal(data.selectionLimits.maxCount,
      new Set([...data.previousSummary.items, ...data.quoteCandidates].map(quote => quote.quoteId)).size);
    return response({ selectedQuoteIds: [data.previousSummary.items[0].quoteId, data.quoteCandidates[0].quoteId] });
  } } }).compact({ requestId: "quotes-second", revision: 10 });
  assert.equal(second.status, "reduced");
  const reopened = env.open().readContextHistory({ revision: 10 });
  assert.equal(reopened.contextGeneration, 2);
  assert.equal(reopened.summary.throughRevision, 8);
  assert.deepEqual(reopened.summary.items[0], saved);
  assert.deepEqual(reopened.turns.map((turn) => turn.revision), [9, 10]);
  assert.equal(env.calls.length, 2);
});

test("整理可以成对保留玩家原话与回答，不能把玩家尝试改成成功事实", async (t) => {
  const env = fixture(t);
  const input = "我是这家食堂的小沈。你叫什么？我试着抬一下门，卡住就停。";
  const narration = "你问了一句。门外只回了‘小沈？’；门没有抬起来。";
  env.commit({ narration: [{ id: "response", text: narration }], events: [], experiences: [] }, input);
  for (let i = 1; i < 8; i++) env.commit();
  const result = await env.service({ provider: { async generate(request) {
    env.calls.push(request);
    const data = JSON.parse(request.messages[1].content);
    const selected = data.quoteCandidates.filter(quote => quote.source.revision === 1);
    assert.equal(selected.length, 2);
    return response({ selectedQuoteIds: selected.map(quote => quote.quoteId) });
  } } }).compact({ requestId: "player-source", revision: 8 });
  assert.equal(result.status, "reduced");
  const retained = env.store.readContextHistory({ revision: 8 }).summary.items;
  assert.deepEqual(retained.map(quote => [quote.source.kind, quote.text]), [["narration", narration], ["player_input", input]]);
  assert.equal(env.store.readPlayerState({ revision: 8 }).revision, 8);
});

test("额外顶层字段与伪造引用用同来源一次修正；传输状态、用量和正式事实保留", async (t) => {
  const env = fixture(t);
  env.commit(samples.borrowBundle());
  env.commit({ narration: [{ id: "s", text: "林安还没弄清响声的原因。左手有一道浅划伤。" }], events: [
    { id: "description", type: "entity.update", sourceSegmentIds: ["s"], data: { id: "p", attributes: { description: "不应作为历史证据的自由概括" } } },
    { id: "body", type: "condition.add", sourceSegmentIds: ["s"], data: { characterId: "p", basis: "observed", text: "左手浅划伤", evidence: [{ segmentId: "s", quote: "左手有一道浅划伤。" }] } },
  ], experiences: [] });
  for (let i = 2; i < 8; i++) env.commit();
  const formal = env.store.readPlayerState({ revision: 8 });
  const original = env.store.readHistory({ revision: 8 });
  const transportState = { protocolFamily: "openai-chat", reasoningContent: "private-repair-continuation" };
  let attemptId, firstRequest, invalidText;
  const service = env.service({ provider: { async generate(request) {
    env.calls.push(request);
    const data = JSON.parse(request.messages[1].content);
    assert.equal(request.thinkingMode, "disabled");
    assert.equal(request.maxOutputTokens, 4096);
    assert.deepEqual(data.currentState.inventory, formal.state.inventory);
    assert.deepEqual(data.currentState.commitments, formal.state.commitments);
    for (const entity of Object.values(data.currentState.entities)) {
      assert.equal(Object.hasOwn(entity, "attributes"), false);
      assert.equal(Object.hasOwn(entity, "conditionRecords"), false);
    }
    assert.doesNotMatch(JSON.stringify(data), /左手浅划伤/);
    assert.equal(env.store.readCompactionJob("repair-structure").status, "running");
    assert.equal(env.store.readContextHistory({ revision: 8 }).summary, null);
    const valid = candidate(data);
    if (env.calls.length === 1) {
      firstRequest = structuredClone({ ...request, signal: undefined });
      attemptId = env.store.readCompactionJob("repair-structure").attemptId;
      const exampleLine = request.messages[0].content.split("\n").find((line) => line.startsWith("Minimal shape example"));
      assert.deepEqual(Object.keys(JSON.parse(exampleLine.slice(exampleLine.indexOf('{')))), ["selectedQuoteIds"]);
      invalidText = JSON.stringify({ ...valid, type: "json_object", "private-field-872": "private-value-193",
        selectedQuoteIds: ["quote-not-supplied"] });
      return response(null, { text: invalidText, transportState,
        usage: { input_tokens: 200, output_tokens: 100, reasoning_tokens: 20 } });
    }
    assert.equal(env.store.readCompactionJob("repair-structure").attemptId, attemptId);
    assert.deepEqual(request.messages.slice(0, 2), firstRequest.messages);
    assert.deepEqual(request.messages[2], { role: "assistant", content: invalidText, transportState });
    const feedback = request.messages.at(-1).content;
    assert.match(feedback, /TOP_LEVEL_FIELDS_INVALID/);
    assert.match(feedback, /QUOTE_NOT_SUPPLIED_OR_DUPLICATE/);
    assert.doesNotMatch(feedback, /workflow|private-field|private-value|872|193|private-repair-continuation/);
    return response(valid, { usage: { input_tokens: 210, output_tokens: 90, reasoning_tokens: 10 } });
  } } });
  const input = { requestId: "repair-structure", revision: 8, input: "我回想之前发生的事。" };
  const result = await service.compact(input);
  assert.equal(result.status, "reduced"); assert.equal(result.modelCalls, 2);
  assert.deepEqual(result.usage, { input_tokens: 410, output_tokens: 190, reasoning_tokens: 30 });
  assert.equal(result.usageComplete, true);
  assert.equal(env.store.readContextHistory({ revision: 8 }).contextGeneration, 1);
  assert.deepEqual(env.store.readPlayerState({ revision: 8 }), formal);
  assert.equal(formal.state.entities.p.attributes.description, "不应作为历史证据的自由概括");
  assert.equal(formal.state.entities.p.conditionRecords.items[0].text, "左手浅划伤");
  assert.deepEqual(env.store.readHistory({ revision: 8 }), original);
  assert.doesNotMatch(JSON.stringify(result), /private-repair-continuation|private-field|private-value|workflow/);
  assert.equal((await service.compact(input)).modelCalls, 0);
  assert.equal(env.calls.length, 2);
});

test("选择反馈区分数组类型、空选择、数量与总大小，仅报告受控类型和精确数值", () => {
  const allowed = new Map(Array.from({ length: 3 }, (_, index) => {
    const quote = createCompactionQuotes({ adventureId: "test", revision: 1, segmentId: `s${index}`, text: "原话" })[0];
    return [quote.quoteId, quote];
  }));
  const oversized = { selectedQuoteIds: ["PRIVATE_SOURCE_TEXT".repeat(700)] };
  const cases = [
    [{ selectedQuoteIds: "PRIVATE_SOURCE_TEXT" }, { issue: "SELECTION_ARRAY_REQUIRED", actualType: "string", expectedType: "array" }],
    [{ selectedQuoteIds: null }, { issue: "SELECTION_ARRAY_REQUIRED", actualType: "null", expectedType: "array" }],
    [{ selectedQuoteIds: [] }, { issue: "SELECTION_EMPTY", actualCount: 0, minCount: 1, maxCount: 3 }],
    [{ selectedQuoteIds: Array(48).fill("PRIVATE_QUOTE_ID") }, { issue: "SELECTION_COUNT_EXCEEDED", actualCount: 48, minCount: 1, maxCount: 3 }],
    [oversized, { issue: "SELECTION_SIZE_EXCEEDED", actualCharacters: JSON.stringify(oversized).length, maxCharacters: 10000 }],
  ];
  for (const [value, feedback] of cases) assert.throws(() => validateSelection(value, allowed), (error) => {
    assert.equal(error.code, "COMPACTION_OUTPUT_INVALID");
    assert.deepEqual(error.feedback, [feedback]);
    assert.doesNotMatch(JSON.stringify(error.feedback), /PRIVATE_SOURCE_TEXT|PRIVATE_QUOTE_ID/);
    return true;
  });
});

test("完整选择JSON可容128个正式ID，绝对上限和重复或未知来源仍严格拒绝", () => {
  const quotes = Array.from({ length: COMPACTION_QUOTE_MAX_ITEMS + 1 }, (_, index) => createCompactionQuotes({
    adventureId: "test", revision: 1, segmentId: `s${index}`, text: "尚未核实。" })[0]);
  const allowed = new Map(quotes.map(quote => [quote.quoteId, quote]));
  const valid = { selectedQuoteIds: quotes.slice(0, COMPACTION_QUOTE_MAX_ITEMS).map(quote => quote.quoteId) };
  assert.ok(JSON.stringify(valid).length < 10000);
  assert.deepEqual(validateSelection(valid, allowed).items, quotes.slice(0, COMPACTION_QUOTE_MAX_ITEMS));
  assert.throws(() => validateSelection({ selectedQuoteIds: quotes.map(quote => quote.quoteId) }, allowed), error => {
    assert.deepEqual(error.feedback, [{ issue: "SELECTION_COUNT_EXCEEDED", actualCount: 129, minCount: 1, maxCount: COMPACTION_QUOTE_MAX_ITEMS }]);
    return error.code === "COMPACTION_OUTPUT_INVALID";
  });
  for (const ids of [[quotes[0].quoteId, quotes[0].quoteId], [quotes[0].quoteId, "quote-other-adventure"]]) {
    assert.throws(() => validateSelection({ selectedQuoteIds: ids }, allowed), error => {
      assert.deepEqual(error.feedback, [{ issue: "QUOTE_NOT_SUPPLIED_OR_DUPLICATE", itemIndex: 1 }]);
      return error.code === "COMPACTION_OUTPUT_INVALID";
    });
  }
});

test("33或48条短原话可在真实请求缩小且fit后完整采用，不再因固定32条阻断", async (t) => {
  for (const count of [33, 48]) await t.test(String(count), async (t) => {
    const env = fixture(t);
    for (let i = 0; i < 50; i++) env.commit();
    const revision = 50, original = env.store.readHistory({ revision, limit: 100 });
    const formal = env.store.readPlayerState({ revision });
    let selected;
    const result = await env.service({ provider: { async generate(request) {
      env.calls.push(request);
      const data = JSON.parse(request.messages[1].content);
      assert.equal(data.coverage, "complete");
      const unique = new Set(data.quoteCandidates.map(quote => quote.quoteId));
      assert.deepEqual(data.selectionLimits, { minCount: 1, maxCount: Math.min(COMPACTION_QUOTE_MAX_ITEMS, unique.size), maxCharacters: 10000 });
      selected = data.quoteCandidates.filter(quote => quote.source.kind === "player_input").slice(0, count);
      assert.equal(selected.length, count);
      return response({ selectedQuoteIds: selected.map(quote => quote.quoteId) });
    } } }).compact({ requestId: `retain-${count}`, revision });
    assert.equal(result.status, "reduced"); assert.equal(result.modelCalls, 1);
    assert.equal(result.after.fits, true); assert.ok(result.savedSafetyInputTokens > 0);
    const summary = env.store.readContextHistory({ revision }).summary;
    assert.deepEqual(summary.items, selected.map(canonicalWholeQuote), "no clipping or added interpretation of player statements");
    assert.deepEqual(env.open().readContextHistory({ revision }).summary, summary);
    assert.deepEqual(env.store.readHistory({ revision, limit: 100 }), original);
    assert.deepEqual(env.store.readPlayerState({ revision }), formal);
  });
});

test("超出请求所供唯一引用数得到精确反馈；一次合法修正才采用，再超限不提交", async (t) => {
  const suppliedCount = 52;
  for (const secondCount of [2, suppliedCount + 1]) await t.test(String(secondCount), async (t) => {
    const env = fixture(t);
    for (let i = 0; i < 28; i++) env.commit();
    const revision = 28, firstCount = suppliedCount + 1;
    const requestId = `selection-${firstCount}-${secondCount}`;
    const original = env.store.readHistory({ revision, limit: 100 });
    let initialMessages, attemptId, selected;
    const result = await env.service({ provider: { async generate(request) {
      env.calls.push(request);
      const data = JSON.parse(request.messages[1].content);
      assert.equal(data.coverage, "complete");
      assert.equal(new Set(data.quoteCandidates.map(quote => quote.quoteId)).size, suppliedCount);
      assert.equal(data.selectionLimits.maxCount, suppliedCount);
      const job = env.store.readCompactionJob(requestId);
      assert.equal(env.store.readContextHistory({ revision }).summary, null);
      if (env.calls.length === 1) {
        initialMessages = structuredClone(request.messages); attemptId = job.attemptId;
        return response({ selectedQuoteIds: [...data.quoteCandidates, data.quoteCandidates[0]].map(quote => quote.quoteId) });
      }
      assert.ok(env.calls.length >= 2 && env.calls.length <= 4); assert.equal(job.attemptId, attemptId);
      assert.deepEqual(request.messages.slice(0, 2), initialMessages);
      const text = request.messages.at(-1).content;
      assert.deepEqual(JSON.parse(text.split("Fixed structural feedback: ")[1]),
        [{ issue: "SELECTION_COUNT_EXCEEDED", actualCount: firstCount, minCount: 1, maxCount: suppliedCount }]);
      assert.ok(text.includes(`1..${suppliedCount} items`)); assert.match(text, /recount/);
      assert.doesNotMatch(text, /quote-[a-f0-9]{64}|窗外/);
      selected = [...data.quoteCandidates, data.quoteCandidates[0]].slice(0, secondCount);
      return response({ selectedQuoteIds: selected.map(quote => quote.quoteId) });
    } } }).compact({ requestId, revision });
    const expectedCalls = secondCount <= suppliedCount ? 2 : 4;
    assert.equal(result.modelCalls, expectedCalls, JSON.stringify(result)); assert.equal(env.calls.length, expectedCalls);
    assert.deepEqual(result.usage, { input_tokens: expectedCalls * 200, output_tokens: expectedCalls * 100 });
    const stored = env.store.readContextHistory({ revision });
    if (secondCount <= suppliedCount) {
      assert.equal(result.status, "reduced"); assert.deepEqual(stored.summary.items, selected.map(canonicalWholeQuote));
    } else {
      assert.equal(result.status, "failed"); assert.equal(result.error.code, "COMPACTION_OUTPUT_INVALID");
      assert.equal(stored.contextGeneration, 0); assert.equal(stored.summary, null);
    }
    assert.deepEqual(env.store.readHistory({ revision, limit: 100 }), original);
  });
});

test("短ID不豁免修正请求预算：129项拒绝回答的完整传输正文超限时不再调用", async (t) => {
  const env = fixture(t);
  env.commit({ narration: Array.from({ length: COMPACTION_QUOTE_MAX_ITEMS }, (_, index) => ({ id: `s${index}`, text: "仍未确认。" })), events: [], experiences: [] }, "我听着。");
  env.commit(); env.commit();
  const original = env.store.readHistory({ revision: 3 });
  const result = await env.service({ provider: { async generate(request) {
    env.calls.push(request);
    const data = JSON.parse(request.messages[1].content);
    assert.equal(data.quoteCandidates.length, 129);
    assert.equal(data.selectionLimits.maxCount, COMPACTION_QUOTE_MAX_ITEMS);
    const text = JSON.stringify({ selectedQuoteIds: data.quoteCandidates.map(quote => quote.quoteId) }).padEnd(25000, " ");
    return response(null, { text });
  } } }).compact({ requestId: "repair-packet-budget", revision: 3 });
  assert.equal(result.status, "failed"); assert.equal(result.error.code, "COMPACTION_CONTEXT_BUDGET_EXCEEDED");
  assert.equal(result.modelCalls, 1); assert.equal(env.calls.length, 1);
  assert.equal(env.store.readContextHistory().summary, null);
  assert.deepEqual(env.store.readHistory({ revision: 3 }), original);
});

test("解析失败最多修正三次，失败候选不生摘要，输出与上下文预算不扩大", async (t) => {
  for (const mode of ["repaired-json", "invalid-again", "no-call-budget", "transport-budget", "length"]) {
    await t.test(mode, async (t) => {
      const env = fixture(t);
      for (let i = 0; i < 8; i++) env.commit();
      const service = env.service({ maxModelCalls: mode === "no-call-budget" ? 1 : 8, provider: { async generate(request) {
        env.calls.push(request);
        if (env.calls.length > 1) {
          assert.match(request.messages.at(-1).content, /JSON_SYNTAX/);
          assert.doesNotMatch(request.messages.at(-1).content, /private-parser-source/);
          if (mode === "repaired-json") return response(candidate(JSON.parse(request.messages[1].content)));
        }
        return response(null, { text: "{private-parser-source broken",
          ...(mode === "length" ? { finishReason: "length" } : {}),
          ...(mode === "transport-budget" ? { transportState: { protocolFamily: "openai-chat", reasoningContent: "r".repeat(50000) } } : {}) });
      } } });
      const result = await service.compact({ requestId: "parse-" + mode, revision: 8 });
      const expected = { "invalid-again": "COMPACTION_OUTPUT_INVALID", "no-call-budget": "COMPACTION_MODEL_BUDGET_EXCEEDED",
        "transport-budget": "COMPACTION_CONTEXT_BUDGET_EXCEEDED", length: "COMPACTION_OUTPUT_BUDGET_EXCEEDED" };
      assert.equal(env.calls.length, mode === "invalid-again" ? 4 : mode === "repaired-json" ? 2 : 1);
      assert.equal(result.modelCalls, env.calls.length);
      if (mode === "repaired-json") assert.equal(result.status, "reduced");
      else {
        assert.equal(result.error.code, expected[mode]);
        assert.equal(env.store.readContextHistory({ revision: 8 }).summary, null);
        assert.equal(env.store.readContextHistory({ revision: 8 }).contextGeneration, 0);
      }
    });
  }
});

test("整理第2和第3次纠正保留同一引用映射，合法结果才采用", async (t) => {
  for (const repairs of [2, 3]) await t.test(String(repairs), async (t) => {
    const env = fixture(t);
    for (let index = 0; index < 8; index++) env.commit();
    let initialMessages, selected;
    const result = await env.service({ provider: { generate(request) {
      env.calls.push(request);
      const data = JSON.parse(request.messages[1].content);
      if (env.calls.length === 1) initialMessages = structuredClone(request.messages);
      else {
        assert.deepEqual(request.messages.slice(0, 2), initialMessages);
        const feedback = JSON.parse(request.messages.at(-1).content.split("Fixed structural feedback: ")[1]);
        if (env.calls.length === 2) {
          assert.equal(feedback[0].code, "JSON_SYNTAX");
          assert.equal(feedback[0].position, '{"private-parser-text":'.length);
        } else assert.equal(feedback[0].issue, "QUOTE_NOT_SUPPLIED_OR_DUPLICATE");
        assert.doesNotMatch(JSON.stringify(feedback), /private-parser-text|private-quote/);
      }
      assert.equal(env.store.readContextHistory().summary, null);
      if (env.calls.length > repairs) { selected = canonicalWholeQuote(data.quoteCandidates[0]); return response(candidate(data)); }
      return env.calls.length === 1 ? response(null, { text: '{"private-parser-text":' })
        : response({ selectedQuoteIds: ["private-quote"] });
    } } }).compact({ requestId: `repaired-${repairs}`, revision: 8 });
    assert.equal(result.status, "reduced", JSON.stringify(result));
    assert.equal(result.modelCalls, repairs + 1);
    assert.deepEqual(env.store.readContextHistory().summary.items, [selected]);
    assert.equal(env.store.readView().revision, 8);
  });
});

test("整理所有分块和最终合并共享三次纠正，第四次错误不采用部分摘要", async (t) => {
  for (const exhaust of [false, true]) await t.test(exhaust ? "fourth error" : "three repairs succeed", async (t) => {
    const env = fixture(t, { contextOptions: { contextPolicy: { configuredContextWindow: 64000 } } });
    for (let revision = 1; revision <= 3; revision++) env.commit({ narration: [
      { id: "long", text: "中".repeat(7000) }], events: [], experiences: [] });
    env.commit(); env.commit();
    const original = env.store.readHistory({ revision: 5 });
    const stages = new Map();
    // Put the fourth error in the smaller merge, so this case isolates the
    // shared repair budget instead of exhausting a full source part's context.
    const failures = exhaust ? [1, 1, 2] : [1, 1, 1];
    const result = await env.service({ maxModelCalls: 8, provider: { generate(request) {
      env.calls.push(request);
      const data = JSON.parse(request.messages[1].content), key = JSON.stringify(data);
      if (!stages.has(key)) stages.set(key, { index: stages.size, calls: 0, first: structuredClone(request.messages.slice(0, 2)), task: data.task });
      const stage = stages.get(key); stage.calls++;
      assert.deepEqual(request.messages.slice(0, 2), stage.first);
      assert.equal(env.store.readContextHistory().summary, null);
      return stage.calls <= failures[stage.index] ? response(null, { text: "{" }) : response(candidate(data));
    } } }).compact({ requestId: "three-shared-repairs", revision: 5 });
    assert.deepEqual([...stages.values()].map(stage => stage.task), ["summarize_context", "summarize_context", "merge_context"], JSON.stringify(result));
    assert.equal(result.modelCalls, 6);
    assert.equal(env.calls.length, 6);
    assert.equal(result.status, exhaust ? "failed" : "reduced", JSON.stringify(result));
    if (exhaust) {
      assert.equal(result.error.code, "COMPACTION_OUTPUT_INVALID");
      assert.equal(env.store.readContextHistory().summary, null);
    }
    assert.deepEqual(env.store.readHistory({ revision: 5 }), original);
  });
});

test("分块任务预留后续必需请求，剩余纠正次数不能扩大总模型调用预算", async (t) => {
  for (const maxModelCalls of [3, 4]) {
    await t.test("calls-" + maxModelCalls, async (t) => {
      const env = fixture(t);
      for (let i = 0; i < 2; i++) env.commit({ narration: [{ id: "s", text: "x".repeat(30000) }], events: [], experiences: [] });
      env.commit(); env.commit();
      const result = await env.service({ maxModelCalls, provider: { async generate(request) {
        env.calls.push(request);
        const data = JSON.parse(request.messages[1].content);
        // Repair the smaller final part, not a greedily packed first part:
        // this isolates the shared call allowance from repair-context headroom.
        if (env.calls.length <= 3) assert.equal(data.task, "summarize_context");
        else assert.equal(data.task, "merge_context");
        return [1, 3].includes(env.calls.length) ? response(candidate(data)) : response(null, { text: "{" });
      } } }).compact({ requestId: "chunk-repair", revision: 4 });
      assert.equal(result.status, "failed");
      assert.equal(result.error.code, "COMPACTION_MODEL_BUDGET_EXCEEDED");
      assert.equal(result.modelCalls, maxModelCalls === 3 ? 2 : 4);
      assert.equal(env.calls.length, result.modelCalls);
      assert.equal(env.store.readContextHistory({ revision: 4 }).summary, null);
    });
  }
});

test("结构修正沿用任务截止时间，超时后的完整修正也不能晚提交", async (t) => {
  const env = fixture(t);
  for (let i = 0; i < 8; i++) env.commit();
  let now = 0;
  t.mock.method(require("node:perf_hooks").performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entered = deferred(), late = deferred(); let data, signal;
  const service = env.service({ timeoutMs: 15, provider: { async generate(request) {
    env.calls.push(request);
    if (env.calls.length === 1) { now = 10; return response(null, { text: "{" }); }
    data = JSON.parse(request.messages[1].content); signal = request.signal; entered.resolve(); return late.promise;
  } } });
  const pending = service.compact({ requestId: "repair-deadline", revision: 8 });
  await Promise.race([entered.promise, pending.then(() => assert.fail("repair ended before its Provider entry"))]);
  now = 15; t.mock.timers.tick(15);
  const result = await pending;
  assert.equal(result.error.code, "COMPACTION_TIMEOUT");
  assert.equal(result.modelCalls, 2); assert.equal(signal.aborted, true);
  assert.equal(result.usageComplete, false);
  late.resolve(response(candidate(data)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.store.readContextHistory({ revision: 8 }).summary, null);
  assert.equal(env.store.readContextHistory({ revision: 8 }).contextGeneration, 0);
});

test("原细节退出摘要和近期正文并重启后，仅检索消息带回旧来源", async (t) => {
  const env = fixture(t);
  const borrow = samples.borrowBundle();
  borrow.narration[0].text += "借来的米暂时放在绑红绳的矮凳下。";
  env.commit(borrow, "我向陈姨借米。");
  for (let i = 1; i < 24; i++) env.commit();
  const compact = await env.service({ provider: { async generate(request) {
    env.calls.push(request); const data = JSON.parse(request.messages[1].content);
    return response(candidate(data, 1));
  } } }).compact({ requestId: "memory-summary", revision: 24 });
  assert.equal(compact.status, "reduced");
  const database = env.open(); let checked = false;
  const generator = env.generator(database, { async generate(request) {
    const memoryMessages = request.messages.filter((message) => message.content.startsWith("Player-known related experiences"));
    assert.equal(memoryMessages.length, 1);
    assert.match(memoryMessages[0].content, /红绳/);
    for (const message of request.messages.filter((message) => !memoryMessages.includes(message))) assert.doesNotMatch(message.content, /红绳|矮凳/);
    checked = true;
    return response({ narration: [{ id: "recalled", text: "林安记起米曾放在绑红绳的矮凳下。" }], events: [], experiences: [] });
  } });
  await generator.generateTurn({ request: { actionId: "recall-after-summary", baseRevision: 24,
    input: "陈姨借给我的米之前放在哪里？", locale: env.identity.locale, contentVersion: env.identity.contentVersion },
    attemptId: "memory-attempt", state: database.readModelState({ revision: 24 }), signal: new AbortController().signal });
  assert.equal(checked, true);
});

test("没有可替换区间和不可缩基线超限不调用模型", async (t) => {
  const env = fixture(t);
  env.commit(); env.commit();
  assert.equal((await env.service().compact({ requestId: "short", revision: 2 })).status, "not_needed");
  env.commit({ narration: [{ id: "s", text: "大".repeat(50000) }], events: [], experiences: [] });
  const result = await env.service().compact({ requestId: "large-baseline", revision: 3 });
  assert.equal(result.status, "baseline_too_large");
  assert.equal(env.calls.length, 0);
});

test("无收益结果持久保存，同来源的新请求也不重复模型", async (t) => {
  const env = fixture(t);
  for (let i = 0; i < 3; i++) env.commit({ narration: [{ id: "s", text: "门没有开。" }], events: [], experiences: [] });
  const service = env.service({ provider: { async generate(request) {
    env.calls.push(request);
    const data = JSON.parse(request.messages[1].content);
    assert.equal(data.selectionLimits.maxCount, 2, "one eligible turn supplies narration and player input only");
    return response(candidate(data));
  } } });
  assert.equal((await service.compact({ requestId: "no-benefit", revision: 3 })).status, "no_benefit");
  assert.equal((await service.compact({ requestId: "another-id", revision: 3 })).status, "no_benefit");
  assert.equal(env.calls.length, 1);
  assert.equal(env.store.readContextHistory({ revision: 3 }).summary, null);
});

test("超时和迟到回答不提交，明确重试沿原请求只提交一次摘要", async (t) => {
  const env = fixture(t);
  for (let i = 0; i < 10; i++) env.commit();
  // Advance the deadline only after the Provider is entered. Real filesystem
  // preparation may exceed 15 ms under parallel tests and is not this case.
  let now = 0;
  t.mock.method(require("node:perf_hooks").performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entered = deferred(); const late = deferred(); let data; let providerSignal;
  const service = env.service({ timeoutMs: 15, provider: { async generate(request) {
    env.calls.push(request); data = JSON.parse(request.messages[1].content);
    providerSignal = request.signal; entered.resolve(); return late.promise;
  } } });
  const pending = service.compact({ requestId: "timeout", revision: 10 });
  await Promise.race([entered.promise, pending.then(() => assert.fail("compaction ended before Provider entry"))]);
  const firstAttempt = env.store.readCompactionJob("timeout").attemptId;
  assert.equal(providerSignal.aborted, false);
  now = 15;
  t.mock.timers.tick(15);
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "COMPACTION_TIMEOUT");
  assert.equal(result.modelCalls, 1);
  assert.equal(providerSignal.aborted, true);
  late.resolve(response(candidate(data)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.store.readContextHistory({ revision: 10 }).summary, null);
  assert.equal(env.store.readContextHistory({ revision: 10 }).contextGeneration, 0);
  const next = env.service();
  assert.equal((await next.compact({ requestId: "timeout", revision: 10 })).modelCalls, 0);
  assert.equal(env.calls.length, 1);
  assert.equal((await next.compact({ requestId: "timeout", revision: 10 }, { retry: true })).status, "reduced");
  assert.notEqual(env.store.readCompactionJob("timeout").attemptId, firstAttempt);
  assert.equal(env.calls.length, 2);
  assert.equal((await next.compact({ requestId: "timeout", revision: 10 }, { retry: true })).modelCalls, 0);
  assert.equal(env.store.readContextHistory({ revision: 10 }).contextGeneration, 1);
});

test("提交后回执丢失仅查同结果，未知回执不会再次发模型", async (t) => {
  const env = fixture(t);
  for (let i = 0; i < 10; i++) env.commit();
  let failRead = false;
  const service = env.service({ store: { ...env.store,
    commitCompaction(input) { env.store.commitCompaction(input); failRead = true; throw new Error("lost reply"); },
    readCompactionJob(id) { if (failRead) throw new Error("temporary read failure"); return env.store.readCompactionJob(id); },
  } });
  assert.equal((await service.compact({ requestId: "unknown", revision: 10 })).status, "unknown");
  failRead = false;
  assert.equal(service.readCompaction({ requestId: "unknown" }).status, "reduced");
  assert.equal((await service.compact({ requestId: "unknown", revision: 10 }, { retry: true })).modelCalls, 0);
  assert.equal(env.calls.length, 1);
});

test("领取任务后回执丢失先确认本次领取，再明确重试；开始阶段读失败也能恢复", async (t) => {
  for (const loseRead of [false, true]) {
    await t.test(loseRead ? "begin-and-read-receipts" : "begin-receipt", async (t) => {
      const env = fixture(t);
      for (let i = 0; i < 8; i++) env.commit();
      let first = true; let readUnavailable = false;
      const service = env.service({ store: { ...env.store,
        beginCompaction(input) {
          const job = env.store.beginCompaction(input);
          if (first) { first = false; readUnavailable = loseRead; throw new Error("begin receipt lost"); }
          return job;
        },
        readCompactionJob(id) { if (readUnavailable) throw new Error("read unavailable"); return env.store.readCompactionJob(id); },
      } });
      const request = { requestId: "lost-begin", revision: 8 };
      assert.equal((await service.compact(request)).status, "unknown");
      assert.equal(env.calls.length, 0);
      assert.equal(env.store.readCompactionJob(request.requestId).status, "running");
      readUnavailable = false;
      const checked = service.readCompaction({ requestId: request.requestId });
      assert.equal(checked.status, "unknown");
      assert.equal(checked.recoveryRequired, true); assert.equal(checked.canRetry, true);
      assert.equal(env.store.readCompactionJob(request.requestId).status, "running", "receipt query is read-only");
      assert.equal((await service.compact(request, { retry: true })).status, "reduced");
      assert.equal(env.calls.length, 1);
    });
  }
});

test("相同store的另一service不能把别人的有效领取当成自己的回执中断", async (t) => {
  const env = fixture(t);
  for (let i = 0; i < 8; i++) env.commit();
  const started = deferred(); const responseReady = deferred(); let data;
  const owner = env.service({ provider: { async generate(request) {
    env.calls.push(request); data = JSON.parse(request.messages[1].content); started.resolve(); return responseReady.promise;
  } } });
  const request = { requestId: "live-other-service", revision: 8 };
  const running = owner.compact(request); await started.promise;
  const original = env.store.readCompactionJob(request.requestId);
  const other = env.service({ store: { ...env.store, beginCompaction(input) {
    env.store.beginCompaction(input); throw new Error("a facade loses an existing non-started receipt");
  } } });
  assert.equal((await other.compact(request, { retry: true })).status, "running");
  const checked = other.readCompaction({ requestId: request.requestId });
  assert.equal(checked.status, "running"); assert.notEqual(checked.canRetry, true);
  assert.equal(env.store.readCompactionJob(request.requestId).attemptId, original.attemptId);
  responseReady.resolve(response(candidate(data)));
  assert.equal((await running).status, "reduced");
  assert.equal(env.calls.length, 1);
});

test("模型不能添加实体字段或选择未提供的其他冒险原文", async (t) => {
  for (const mode of ["entity", "source"]) {
    await t.test(mode, async (t) => {
      const env = fixture(t);
      for (let i = 0; i < 8; i++) env.commit();
      const result = await env.service({ provider: { async generate(request) {
        const value = candidate(JSON.parse(request.messages[1].content));
        if (mode === "entity") value.entityIds = ["unseen-person"];
        else value.selectedQuoteIds[0] = "quote-other-adventure";
        return response(value);
      } } }).compact({ requestId: "invalid", revision: 8 });
      assert.equal(result.status, "failed");
      assert.equal(result.error.code, "COMPACTION_OUTPUT_INVALID");
      assert.equal(env.store.readContextHistory({ revision: 8 }).summary, null);
    });
  }
});

test("真实容量预算下完整分块再合并，不让中文字符数代替请求字节", async (t) => {
  const env = fixture(t, { contextOptions: { maxContextCharacters: 48000,
    contextPolicy: { configuredContextWindow: 64000, providerContextLimit: 64000, autoCompactRatio: 0.75 } } });
  for (let i = 0; i < 4; i++) env.commit({ narration: [{ id: "s", text: "楼道的风声与脚步。".repeat(1800) }], events: [], experiences: [] });
  env.commit(); env.commit();
  const result = await env.service().compact({ requestId: "chunked", revision: 6 });
  assert.equal(result.status, "reduced");
  assert.ok(env.calls.length > 1);
  const originalParts = env.calls.slice(0, -1).flatMap((request) => JSON.parse(request.messages[1].content).quoteCandidates);
  for (let revision = 1; revision <= 4; revision++) {
    for (const segment of env.store.readTurn(revision).narration) {
      const parts = originalParts.filter((source) => source.source.revision === revision
        && source.source.kind === "narration" && source.source.segmentId === segment.id);
      assert.equal(parts.map((part) => part.text).join(""), segment.text);
    }
  }
  assert.equal(JSON.parse(env.calls.at(-1).messages[1].content).task, "merge_context");
});

test("滚动分块与合并按实际供给的唯一引用计数，重复旧引用不扩大merge上限", async (t) => {
  const env = fixture(t);
  for (let i = 0; i < 8; i++) env.commit();
  assert.equal((await env.service().compact({ requestId: "before-parts", revision: 8 })).status, "reduced");
  const previous = env.store.readContextHistory().summary.items[0];
  for (let i = 0; i < 4; i++) env.commit({ narration: [{ id: "long", text: "完整的旧现场记录。".repeat(2500) }], events: [], experiences: [] });
  env.commit(); env.commit();
  let parts = 0, merges = 0;
  const result = await env.service({ provider: { async generate(request) {
    const data = JSON.parse(request.messages[1].content);
    const supplied = [...(data.quoteCandidates || []), ...(data.previousSummary?.items || []),
      ...(data.parts || []).flatMap(part => part.items)];
    const unique = new Set(supplied.map(quote => quote.quoteId));
    assert.ok([...unique].every(id => /^q[1-9][0-9]*$/.test(id)));
    const previousOption = supplied.find(quote => quote.text === previous.text
      && JSON.stringify(quote.source) === JSON.stringify(previous.source));
    assert.ok(previousOption);
    assert.deepEqual(previousOption, { ...previous, quoteId: previousOption.quoteId });
    assert.equal(data.selectionLimits.maxCount, Math.min(COMPACTION_QUOTE_MAX_ITEMS, unique.size));
    assert.equal(data.selectionLimits.maxCharacters, 10000);
    if (data.task === "merge_context") {
      merges++; assert.ok(supplied.length > unique.size, "each part deliberately retained the same previous quote");
      assert.equal(data.previousSummary, null);
      assert.equal(previousOption.quoteId, "q1", "merge binds its own set; the first selected source receives its first option");
      return response({ selectedQuoteIds: [previousOption.quoteId] });
    }
    parts++; assert.equal(data.coverage, "part");
    assert.deepEqual(data.previousSummary.items, [previousOption]);
    assert.notEqual(previousOption.quoteId, "q1", "part options include the new source set before previous quotations");
    return response({ selectedQuoteIds: [previousOption.quoteId, data.quoteCandidates[0].quoteId] });
  } } }).compact({ requestId: "rolling-parts", revision: 14 });
  assert.equal(result.status, "reduced");
  assert.ok(parts > 1); assert.equal(merges, 1); assert.equal(result.modelCalls, parts + 1); assert.ok(result.modelCalls <= 8);
  assert.equal(result.after.fits, true); assert.ok(result.savedSafetyInputTokens > 0);
  assert.deepEqual(env.store.readContextHistory().summary.items, [previous]);
});
