"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTurnStore } = require("./turn-store");
const { createSessionChapters } = require("./session-chapters");
const { CHAPTER_LIMITS } = require("./session-chapter-store");
const samples = require("./test-fixtures/turn-samples");

function fixture(t, locale = "zh-CN") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-chapters-"));
  const identity = { ...samples.identity(path.join(root, "session.sqlite")), locale };
  const stores = [];
  const services = [];
  const calls = [];
  let revision = 0;
  const store = createTurnStore({ ...identity, initialState: samples.initialState() });
  stores.push(store);
  t.after(async () => {
    for (const service of services) await service.shutdown();
    for (const database of stores) database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { store, identity, calls,
    open() { const database = createTurnStore(identity); stores.push(database); return database; },
    commit(bundle, input = "玩家的原始行动") {
      const action = store.beginAction({ actionId: `action-${revision + 1}`, baseRevision: revision, input,
        locale, contentVersion: identity.contentVersion });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
      return ++revision;
    },
    service(options = {}) {
      const service = createSessionChapters({ store, provider: { async generate(request) {
        calls.push(request);
        return response(candidate(JSON.parse(request.messages[1].content)));
      } }, ...options });
      services.push(service);
      return service;
    },
  };
}

function narration(text, id = "s") { return { narration: [{ id, text }], events: [], experiences: [] }; }
function response(value, options = {}) { return { text: JSON.stringify(value), finishReason: "stop",
  usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 }, ...options }; }
function candidate(data) {
  const source = data.sources?.[0] || data.parts?.[0].keyEvents[0].sources[0];
  return { title: "一段已保存的故事", summary: "回顾已经发生的故事，不继续新剧情。",
    keyEvents: source ? [{ text: "原文中的这段经历。", sources: [{ revision: source.revision, segmentId: source.segmentId }] }] : [],
    openThreads: [] };
}
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
function error(code) { return Object.assign(new Error("private provider key and local path must never be copied"), { code }); }

test("chapter provider failure explains the cause without losing saved story and can recover explicitly", async (t) => {
  for (const [code, retryable] of [["API_TIMEOUT", true], ["UPSTREAM_AUTH_ERROR", false], ["UPSTREAM_RATE_LIMIT", true], ["UPSTREAM_BAD_RESPONSE", false]]) {
    await t.test(code, async (t) => {
      const env = fixture(t);
      env.commit(narration("你站在门口，等陈姨把话说完。"));
      const before = env.store.readView();
      let calls = 0, repaired = false;
      const service = env.service({ provider: { async generate(request) {
        calls++;
        if (!repaired) throw Object.assign(new Error("PRIVATE_UPSTREAM_BODY"), { code, retryable });
        return response(candidate(JSON.parse(request.messages[1].content)));
      } } });
      const failed = await service.saveChapter({ targetRevision: 1 });
      assert.equal(failed.saved, true);
      assert.equal(failed.chapterStatus, "failed");
      assert.deepEqual(failed.error, { code, retryable });
      assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_UPSTREAM_BODY/);
      assert.deepEqual(env.store.readView(), before);
      await service.saveChapter({ targetRevision: 1 });
      assert.equal(calls, 1);
      repaired = true;
      const recovered = await service.saveChapter({ targetRevision: 1 }, { retry: true });
      assert.equal(recovered.chapterStatus, "created", JSON.stringify(recovered));
      assert.equal(calls, 2);
      assert.equal(env.store.readView().revision, before.revision);
    });
  }
});

test("章节原文带各轮开始地点，章末地点不覆盖早先场景且内部锚点不进入保存正文", async (t) => {
  const env = fixture(t);
  env.commit({ narration: [{ id: "arrive", text: "你从楼道走到第二道门。" }], events: [
    { id: "new-place", type: "entity.create", sourceSegmentIds: ["arrive"], data: { entity: {
      id: "second", kind: "location", name: "第二道门", aliases: [], visibility: "player", attributes: {} } } },
    { id: "move", type: "situation.update", sourceSegmentIds: ["arrive"], data: { locationId: "second" } },
  ], experiences: [] });
  env.commit({ narration: [{ id: "reply", text: "你站在门槛前答完话。" }, { id: "leave", text: "你从那里走回楼道。" }],
    events: [{ id: "back", type: "situation.update", sourceSegmentIds: ["leave"], data: { locationId: "home" } }], experiences: [] });
  const before = env.store.readPlayerState();
  const result = await env.service().saveChapter({ targetRevision: 2 });
  assert.equal(result.chapter.mode, "model");
  const data = JSON.parse(env.calls[0].messages[1].content);
  assert.equal(data.currentState.situation.locationId, "home");
  assert.deepEqual(data.sources.map((source) => source.turnStart), [
    { source: { adventureId: "test-adventure", revision: 0 }, location: { id: "home", name: "楼道" } },
    { source: { adventureId: "test-adventure", revision: 1 }, location: { id: "second", name: "第二道门" } },
    { source: { adventureId: "test-adventure", revision: 1 }, location: { id: "second", name: "第二道门" } },
  ]);
  assert.doesNotMatch(JSON.stringify(result.chapter) + JSON.stringify(env.store.readChapters()), /turnStart/);
  assert.deepEqual(env.store.readPlayerState(), before);
});

test("章节拒绝缺失或错版的轮初地点来源，不启动模型也不借章末信息猜测", async (t) => {
  for (const [label, mutation] of [
    ["缺失起点", (turn) => { delete turn.turnStart; }],
    ["版本错位", (turn) => { turn.turnStart.source.revision = turn.revision; }],
    ["冒险错位", (turn) => { turn.turnStart.source.adventureId = "another-adventure"; }],
    ["额外字段", (turn) => { turn.turnStart.location.attributes = { description: "额外字段不应透传" }; }],
  ]) await t.test(label, async (t) => {
    const env = fixture(t);
    env.commit(narration("你在原处等候。"));
    const sourceStore = { ...env.store, readChapterSource(input) {
      const page = env.store.readChapterSource(input); mutation(page.turns[0]); return page;
    } };
    const result = await env.service({ store: sourceStore }).saveChapter({ targetRevision: 1 });
    assert.equal(result.chapterStatus, "failed");
    assert.equal(result.error.code, "CHAPTER_SOURCE_UNAVAILABLE");
    assert.equal(env.calls.length, 0);
    assert.equal(env.store.readChapters().chapters.length, 0);
  });
});

test("残缺前缀与第二个JSON必须同来源修正；三语保持玩家视角，传输与用量只在该任务内续接", async (t) => {
  for (const [locale, prose] of [["zh-CN", "你在窗边等了一会，没有打开门。"],
    ["en-US", "You waited by the window without opening the door."], ["ja-JP", "あなたは扉を開けず、窓辺でしばらく待った。"]]) await t.test(locale, async (t) => {
    const env = fixture(t, locale);
    env.commit(narration(prose, "window"));
    const before = env.store.readPlayerState();
    const requests = []; let malformed;
    const transportState = { kind: "openai-compatible", reasoningContent: "private-opaque-transport" };
    const service = env.service({ maxModelCalls: 2, provider: { async generate(request) {
      requests.push(request);
      const data = JSON.parse(request.messages[1].content);
      assert.equal(data.locale, locale);
      assert.equal(data.currentState.entities.p.name, before.state.entities.p.name);
      assert.ok(Object.values(data.currentState.entities).every((entity) => !Object.hasOwn(entity, "attributes")));
      assert.match(request.messages[0].content, /second-person perspective \(你 \/ you \/ あなた\)/);
      assert.match(request.messages[0].content, /Do not infer gender/);
      assert.deepEqual(request.tools, []); assert.equal(request.maxOutputTokens, 4096);
      const chapter = { title: data.currentState.entities.p.name, summary: prose,
        keyEvents: [{ text: prose, sources: [{ revision: 1, segmentId: "window" }] }], openThreads: [] };
      if (requests.length === 1) {
        malformed = '{"title":"unfinished",{"type":"json_object"}}\n' + JSON.stringify(chapter);
        return response(null, { text: malformed, transportState });
      }
      assert.deepEqual(request.messages.slice(0, 2), requests[0].messages);
      assert.deepEqual(request.messages[2], { role: "assistant", content: malformed, transportState });
      assert.match(request.messages[3].content, /"code":"JSON_SYNTAX"/);
      assert.equal(request.signal, requests[0].signal);
      assert.equal(env.store.readChapterJob("chapter-1").status, "running");
      assert.equal(env.store.readChapters().chapters.length, 0);
      return response(chapter, { usage: { input_tokens: 200, output_tokens: 90, total_tokens: 290 } });
    } } });
    const result = await service.saveChapter({ targetRevision: 1 });
    for (const request of requests) assert.equal(request.thinkingMode, "disabled",
      "initial and same-source repair requests keep the chapter task configuration");
    assert.equal(result.chapter.mode, "model"); assert.equal(result.modelCalls, 2);
    assert.deepEqual(result.usage, { input_tokens: 300, output_tokens: 170, total_tokens: 470 });
    assert.equal(result.usageComplete, true); assert.equal(result.chapter.summary, prose);
    assert.deepEqual(env.store.readPlayerState(), before);
    assert.doesNotMatch(JSON.stringify(result) + JSON.stringify(env.store.readChapterJob("chapter-1")), /private-opaque-transport|unfinished|json_object/);
    assert.equal((await service.saveChapter({ targetRevision: 1 })).modelCalls, 0);
    assert.equal((await env.service({ store: env.open() }).saveChapter({ targetRevision: 1 })).modelCalls, 0);
    assert.equal(requests.length, 2);
  });
});

test("结构反馈只有固定类别和受限位置；额外顶层字段或假引用不放宽", async (t) => {
  for (const defect of ["extra", "source"]) await t.test(defect, async (t) => {
    const env = fixture(t); env.commit(narration("你没有得到答复。")); let calls = 0;
    const result = await env.service({ provider: { generate(request) {
      calls++; const data = JSON.parse(request.messages[1].content); const good = candidate(data);
      if (calls === 1) {
        if (defect === "extra") return response({ ...good, PRIVATE_UNTRUSTED_KEY: "PRIVATE_UNTRUSTED_VALUE", type: "json_object" });
        good.keyEvents[0].sources[0] = { revision: 99, segmentId: "PRIVATE_UNTRUSTED_VALUE" };
        return response(good);
      }
      const feedback = request.messages.at(-1).content;
      assert.doesNotMatch(feedback, /PRIVATE_UNTRUSTED|"revision":99/);
      if (defect === "extra") assert.match(feedback, /"issue":"TOP_LEVEL_FIELDS_INVALID"/);
      else assert.match(feedback, /"issue":"SOURCE_REFERENCE_INVALID","collection":"keyEvents","itemIndex":0,"sourceIndex":0/);
      return response(good);
    } } }).saveChapter({ targetRevision: 1 });
    assert.equal(result.chapter.mode, "model"); assert.equal(result.modelCalls, 2);
    assert.deepEqual(result.chapter.keyEvents[0].sources, [{ revision: 1, segmentId: "s" }]);
  });
});

test("三次纠正仍是坏JSON时不截取后面的合法对象，只有明确原文摘录被保存", async (t) => {
  const env = fixture(t); env.commit(narration("你没有打开那扇门。")); let calls = 0;
  const result = await env.service({ provider: { generate(request) {
    calls++; return response(null, { text: 'broken-prefix\n' + JSON.stringify(candidate(JSON.parse(request.messages[1].content))) });
  } } }).saveChapter({ targetRevision: 1 });
  assert.equal(calls, 4); assert.equal(result.modelCalls, 4);
  assert.equal(result.chapter.mode, "excerpt"); assert.equal(result.chapter.fallbackReason, "CHAPTER_OUTPUT_INVALID");
  assert.equal(result.chapter.keyEvents[0].text, "你没有打开那扇门。");
  assert.deepEqual(result.usage, { input_tokens: 400, output_tokens: 320, total_tokens: 720 });
  assert.equal(env.store.readView().revision, 1);
});

test("章节第2和第3次纠正仍沿用原来源与准确反馈，成功后才保存", async (t) => {
  for (const repairs of [2, 3]) await t.test(String(repairs), async (t) => {
    const env = fixture(t); env.commit(narration("你没有打开那扇门。"));
    let calls = 0, originalMessages;
    const result = await env.service({ provider: { generate(request) {
      calls++;
      const data = JSON.parse(request.messages[1].content);
      if (calls === 1) originalMessages = structuredClone(request.messages);
      else {
        assert.deepEqual(request.messages.slice(0, 2), originalMessages);
        const feedback = JSON.parse(request.messages.at(-1).content.split("Fixed structural feedback: ")[1]);
        if (calls === 2) {
          assert.equal(feedback[0].code, "JSON_SYNTAX");
          assert.equal(feedback[0].position, '{"private-parser-text":'.length);
        } else assert.equal(feedback[0].issue, "SOURCE_REFERENCE_INVALID");
        assert.doesNotMatch(JSON.stringify(feedback), /private-parser-text|private-source/);
      }
      assert.equal(env.store.readChapters().chapters.length, 0);
      if (calls > repairs) return response(candidate(data));
      if (calls === 1) return response(null, { text: '{"private-parser-text":' });
      const invalid = candidate(data);
      invalid.keyEvents[0].sources[0] = { revision: 99, segmentId: "private-source" };
      return response(invalid);
    } } }).saveChapter({ targetRevision: 1 });
    assert.equal(result.chapter.mode, "model");
    assert.equal(result.modelCalls, repairs + 1);
    assert.equal(calls, repairs + 1);
    assert.deepEqual(result.chapter.keyEvents[0].sources, [{ revision: 1, segmentId: "s" }]);
    assert.equal(env.store.readView().revision, 1);
  });
});

test("章节所有分块和最终合并共享三次纠正，第四次错误不能获新额度", async (t) => {
  for (const exhaust of [false, true]) await t.test(exhaust ? "fourth error" : "three repairs succeed", async (t) => {
    const env = fixture(t);
    for (let revision = 1; revision <= 3; revision++) env.commit(narration("中".repeat(7000), "long"));
    const stages = new Map(), requests = [];
    const failures = exhaust ? [2, 1, 1] : [1, 1, 1];
    const result = await env.service({ maxModelCalls: 8, contextPolicy: { configuredContextWindow: 64000 }, provider: { generate(request) {
      requests.push(request);
      const data = JSON.parse(request.messages[1].content), key = JSON.stringify(data);
      if (!stages.has(key)) stages.set(key, { index: stages.size, calls: 0, first: structuredClone(request.messages.slice(0, 2)), task: data.task });
      const stage = stages.get(key); stage.calls++;
      assert.deepEqual(request.messages.slice(0, 2), stage.first);
      assert.equal(env.store.readChapters().chapters.length, 0);
      return stage.calls <= failures[stage.index] ? response(null, { text: "{" }) : response(candidate(data));
    } } }).saveChapter({ targetRevision: 3 });
    assert.deepEqual([...stages.values()].map(stage => stage.task), ["summarize_chapter", "summarize_chapter", "merge_chapter"]);
    assert.equal(result.modelCalls, 6);
    assert.equal(requests.length, 6);
    assert.equal(result.chapter.mode, exhaust ? "excerpt" : "model");
    if (exhaust) assert.equal(result.chapter.fallbackReason, "CHAPTER_OUTPUT_INVALID");
    assert.equal(env.store.readTurn(1).narration[0].text, "中".repeat(7000));
    assert.equal(env.store.readView().revision, 3);
  });
});

test("结构修正不能占用后续部分和汇总预算，即使还有共享纠正次数", async (t) => {
  for (const mode of ["reserve", "shared"]) await t.test(mode, async (t) => {
    const env = fixture(t);
    if (mode === "reserve") env.commit(narration("中".repeat(45000), "long"));
    else for (let revision = 1; revision <= 3; revision++) env.commit(narration("中".repeat(7000), "long"));
    let calls = 0; let firstData;
    const result = await env.service({ maxModelCalls: 4, contextPolicy: { configuredContextWindow: 64000 }, provider: { generate(request) {
      calls++; const data = JSON.parse(request.messages[1].content);
      assert.equal(data.task, "summarize_chapter"); assert.equal(data.coverage, "part");
      if (calls === 1) firstData = data;
      if (calls === 2) { assert.deepEqual(data, firstData); return response(candidate(data)); }
      return response(null, { text: "invalid JSON" });
    } } }).saveChapter({ targetRevision: mode === "reserve" ? 1 : 3 });
    assert.equal(calls, mode === "reserve" ? 1 : 3, JSON.stringify(result.chapter));
    assert.equal(result.chapter.mode, "excerpt");
    assert.equal(result.chapter.fallbackReason, "CHAPTER_MODEL_BUDGET_EXCEEDED");
    assert.equal(result.usage.input_tokens, calls * 100);
    assert.equal(env.store.readTurn(1).narration[0].text.length, mode === "reserve" ? 45000 : 7000);
  });
});

test("修正请求的完整assistant传输内容也计入原上下文上限", async (t) => {
  const env = fixture(t); env.commit(narration("原文没有改变。")); let calls = 0;
  const result = await env.service({ maxContextCharacters: 9000, provider: { generate() {
    calls++; return response(null, { text: "invalid", transportState: { reasoningContent: "x".repeat(10000) } });
  } } }).saveChapter({ targetRevision: 1 });
  assert.equal(calls, 1); assert.equal(result.chapter.mode, "excerpt");
  assert.equal(result.chapter.fallbackReason, "CHAPTER_CONTEXT_BUDGET_EXCEEDED");
  assert.equal(env.store.readView().revision, 1);
});

test("结构修正沿用任务截止时间，超时或取消后不采用迟到修正", async (t) => {
  for (const stop of ["timeout", "abort"]) await t.test(stop, async (t) => {
    const env = fixture(t); env.commit(narration("已保存的正文。"));
    let now = 0; t.mock.method(require("node:perf_hooks").performance, "now", () => now);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const entered = deferred(), late = deferred(); let calls = 0; let data, providerSignal;
    const controller = new AbortController();
    const service = env.service({ timeoutMs: 20, provider: { generate(request) {
      calls++; if (calls === 1) { now = 12; return response(null, { text: "invalid" }); }
      data = JSON.parse(request.messages[1].content); providerSignal = request.signal; entered.resolve(); return late.promise;
    } } });
    const pending = service.saveChapter({ targetRevision: 1 }, { signal: controller.signal });
    await entered.promise;
    if (stop === "timeout") { now = 20; t.mock.timers.tick(20); } else controller.abort();
    const result = await pending;
    assert.equal(result.error.code, stop === "timeout" ? "CHAPTER_TIMEOUT" : "CHAPTER_INTERRUPTED");
    assert.equal(providerSignal.aborted, true); assert.equal(result.modelCalls, 2); assert.equal(result.usageComplete, false);
    assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 80, total_tokens: 180 });
    late.resolve(response(candidate(data))); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(env.store.readChapters().chapters.length, 0); assert.equal(env.store.readView().revision, 1);
    assert.equal((await env.service().saveChapter({ targetRevision: 1 })).modelCalls, 0);
    const retry = await env.service().saveChapter({ targetRevision: 1 }, { retry: true });
    assert.equal(retry.chapter.mode, "model"); assert.equal(retry.modelCalls, 1);
  });
});

test("保存只回顾固定的正式版本，引用、玩家权限和已还承诺一致；重复与重开零模型", async (t) => {
  const env = fixture(t);
  env.commit(samples.borrowBundle(), "我请求借米，并答应明天归还。");
  env.commit(samples.returnBundle());
  const before = env.store.readPlayerState({ revision: 2 });
  const service = env.service({ provider: { async generate(request) {
    env.calls.push(request);
    const data = JSON.parse(request.messages[1].content);
    assert.equal(data.task, "summarize_chapter");
    assert.equal(data.coverage, "complete");
    assert.deepEqual(data.range, { fromRevision: 1, toRevision: 2 });
    assert.equal(data.currentState.commitments["rice-promise"].status, "fulfilled");
    assert.doesNotMatch(JSON.stringify(data), /尚未露面的访客|未发现的钥匙/);
    assert.deepEqual(data.sources.map((source) => source.revision), [1, 2]);
    assert.equal(data.sources[0].playerInput, "我请求借米，并答应明天归还。");
    assert.deepEqual(request.tools, []);
    assert.deepEqual(request.responseFormat, { type: "json_object" });
    assert.equal(request.maxOutputTokens, 4096);
    return response({ title: "借米与归还", summary: "你向陈姨借了两袋米，随后归还，兑现了承诺。",
      keyEvents: [{ text: "借来的两袋米已归还。", sources: [
        { revision: 1, segmentId: "borrow-text" }, { revision: 2, segmentId: "return-text" } ] }], openThreads: [] });
  } } });
  const result = await service.saveChapter({ targetRevision: 2 });
  assert.equal(env.calls[0].thinkingMode, "disabled", "the complete chapter uses its own task configuration");
  assert.equal(result.saved, true);
  assert.equal(result.savedRevision, 2);
  assert.equal(result.chapterStatus, "created");
  assert.equal(result.chapter.mode, "model");
  assert.deepEqual(result.chapter.openThreads, []);
  assert.equal(result.modelCalls, 1);
  assert.equal(result.usageComplete, true);
  assert.equal(result.usage.total_tokens, 180);
  assert.deepEqual(env.store.readPlayerState({ revision: 2 }), before);
  const duplicate = await service.saveChapter({ targetRevision: 2 });
  assert.equal(duplicate.chapterStatus, "unchanged");
  assert.equal(duplicate.modelCalls, 0);
  assert.equal(duplicate.usageComplete, true);
  const reopened = env.service({ store: env.open() });
  assert.deepEqual((await reopened.saveChapter({ targetRevision: 1 })).chapter, result.chapter);
  assert.equal(env.calls.length, 1);
});

test("没有新故事时不创建回顾或调用模型", async (t) => {
  const env = fixture(t);
  const result = await env.service().saveChapter({ targetRevision: 0 });
  assert.equal(result.chapterStatus, "unchanged");
  assert.equal(result.modelCalls, 0);
  assert.equal(result.chapter, undefined);
  assert.equal(env.calls.length, 0);
});

test("简短回顾是写作目标，较长合法摘要不触发修正且旧章重开保持全文", async (t) => {
  const env = fixture(t);
  env.commit(narration("你在窗边等待，没有打开门。"));
  const oldJob = env.store.beginChapter({ targetRevision: 1 });
  const oldSummary = "旧章原文仍完整保留。".repeat(400);
  const oldChapter = { title: "此前的等待", summary: oldSummary, keyEvents: [], openThreads: [], mode: "model" };
  env.store.commitChapter({ chapterId: oldJob.chapterId, attemptId: oldJob.attemptId, chapter: oldChapter });
  const savedOldChapter = env.store.readChapters().chapters[0];
  env.commit(narration("你仍在窗边，门没有打开。"));
  const before = env.store.readPlayerState();
  const newSummary = "你仍在窗边等待，门没有打开。".repeat(30);
  assert.ok(newSummary.length > 180 && oldSummary.length <= CHAPTER_LIMITS.summaryCharacters);
  const result = await env.service({ provider: { async generate(request) {
    env.calls.push(request);
    const data = JSON.parse(request.messages[1].content);
    assert.equal(data.coverage, "complete");
    assert.deepEqual(data.sources.map((source) => source.text), ["你仍在窗边，门没有打开。"]);
    return response({ title: "等待仍在继续", summary: newSummary, keyEvents: [], openThreads: [] });
  } } }).saveChapter({ targetRevision: 2 });
  assert.equal(result.chapter.mode, "model");
  assert.equal(result.modelCalls, 1, "a writing target is not a new rejection or retry condition");
  assert.equal(result.chapter.summary, newSummary);
  assert.deepEqual(env.store.readPlayerState(), before);
  assert.deepEqual(env.store.readChapters().chapters[0], savedOldChapter);
  env.store.close();
  const reopened = env.open();
  assert.deepEqual(reopened.readChapters().chapters.map((chapter) => chapter.summary), [oldSummary, newSummary]);
  assert.deepEqual(reopened.readChapters().chapters[0], savedOldChapter);
  assert.equal((await env.service({ store: reopened }).saveChapter({ targetRevision: 2 })).modelCalls, 0);
  assert.equal(env.calls.length, 1);
});

test("跨二十轮源分页仍完整进入回顾，进行中的新行动不会扩大固定范围", async (t) => {
  const env = fixture(t);
  for (let i = 1; i <= 24; i++) env.commit(narration(`第${i}轮的正式原文。`));
  let sourceReads = 0;
  const service = env.service({ store: { ...env.store,
    readChapterSource(input) { sourceReads++; return env.store.readChapterSource(input); },
  }, provider: { async generate(request) {
    env.calls.push(request);
    const data = JSON.parse(request.messages[1].content);
    assert.deepEqual(data.sources.map((source) => source.revision), Array.from({ length: 24 }, (_, i) => i + 1));
    env.commit(narration("保存开始之后才提交的新故事。"));
    return response(candidate(data));
  } } });
  const result = await service.saveChapter({ targetRevision: 24 });
  assert.equal(sourceReads, 2);
  assert.equal(result.chapter.toRevision, 24);
  assert.equal(result.savedRevision, 24);
  assert.equal(env.store.readPlayerState({ revision: 25 }).revision, 25);
});

test("超单请求来源按完整覆盖的分块汇总再合并，每次请求都受上下文预算约束", async (t) => {
  const env = fixture(t);
  const original = "长段原文甲乙丙丁。".repeat(1100);
  env.commit(narration(original, "long"));
  const requests = [];
  const service = env.service({ maxContextCharacters: 8000, maxModelCalls: 8,
    provider: { async generate(request) {
      requests.push(request);
      const { signal, ...bounded } = request;
      assert.ok(JSON.stringify(bounded).length <= 8000);
      return response(candidate(JSON.parse(request.messages[1].content)));
  } } });
  const result = await service.saveChapter({ targetRevision: 1 });
  for (const request of requests) {
    assert.equal(request.thinkingMode, "disabled", "every source part and the final merge use the chapter task configuration");
    assert.equal(request.maxOutputTokens, 4096, "task configuration does not enlarge the output cap");
    assert.deepEqual(request.messages[0], requests[0].messages[0],
      "every source part and the final merge share the original overview/detail instructions");
  }
  assert.equal(result.chapter.mode, "model", JSON.stringify({ fallbackReason: result.chapter.fallbackReason,
    calls: requests.map((request) => ({ characters: JSON.stringify({ ...request, signal: undefined }).length,
      task: JSON.parse(request.messages[1].content).task })) }));
  assert.ok(result.modelCalls > 2 && result.modelCalls <= 8);
  const inputs = requests.map((request) => JSON.parse(request.messages[1].content));
  assert.equal(inputs.at(-1).task, "merge_chapter");
  assert.equal(inputs.at(-1).coverage, "complete");
  assert.ok(inputs.slice(0, -1).every((input) => input.coverage === "part"));
  const pieces = inputs.slice(0, -1).flatMap((input) => input.sources);
  const start = { source: { adventureId: "test-adventure", revision: 0 }, location: { id: "home", name: "楼道" } };
  assert.ok(pieces.length > 1);
  for (const piece of pieces) assert.deepEqual(piece.turnStart, start);
  for (const part of inputs.at(-1).parts) assert.deepEqual(part.turnStarts, [{ revision: 1, ...start }]);
  assert.doesNotMatch(JSON.stringify(result.chapter), /turnStart/);
  for (const segment of env.store.readTurn(1).narration) {
    const sourcePieces = pieces.filter((part) => part.segmentId === segment.id);
    assert.equal(sourcePieces.map((part) => part.text).join(""), segment.text);
  }
  const longPieces = pieces.filter((part) => part.segmentId === "long");
  assert.equal(longPieces[0].part.start, 0);
  assert.equal(longPieces.at(-1).part.end, original.length);
  assert.equal(result.usage.input_tokens, 100 * requests.length);
});

test("64K窗口按中文字节保守估算分块，即使整章字符数低于旧48K上限", async (t) => {
  const env = fixture(t);
  const original = "中".repeat(24000);
  env.commit(narration(original, "chinese-source"));
  const requests = [];
  const result = await env.service({ contextPolicy: { configuredContextWindow: 64000 }, provider: { async generate(request) {
    requests.push(request);
    const { messages, tools, responseFormat } = request;
    const conservativeBytes = Buffer.byteLength(JSON.stringify({ messages, tools, responseFormat }), "utf8");
    assert.ok(conservativeBytes < 57600, "90% window guard applies to every part and merge");
    assert.ok(conservativeBytes + request.maxOutputTokens + 1024 <= 64000);
    return response(candidate(JSON.parse(messages[1].content)));
  } } }).saveChapter({ targetRevision: 1 });
  assert.equal(result.chapter.mode, "model");
  assert.equal(requests.length, 3);
  const inputs = requests.map((request) => JSON.parse(request.messages[1].content));
  assert.equal(inputs.at(-1).task, "merge_chapter");
  const pieces = inputs.slice(0, -1).flatMap((input) => input.sources);
  for (const segment of env.store.readTurn(1).narration) {
    const sourcePieces = pieces.filter((part) => part.segmentId === segment.id);
    assert.equal(sourcePieces.map((part) => part.text).join(""), segment.text);
  }
  const longPieces = pieces.filter((part) => part.segmentId === "chinese-source");
  assert.equal(longPieces[0].part.start, 0);
  assert.equal(longPieces.at(-1).part.end, original.length);
  assert.equal(env.store.readTurn(1).narration[0].text, original);
});

test("章节请求排除自由实体概括，保留完整原文与结构事实且不修改正式存档", async (t) => {
  const env = fixture(t);
  const turn = samples.borrowBundle();
  turn.narration[0].text += "你的左手有一道浅划伤。";
  const original = turn.narration[0].text;
  turn.events.push({ id: "body", type: "condition.add", sourceSegmentIds: ["borrow-text"], data: { characterId: "p", basis: "observed", text: "左手浅划伤", evidence: [{ segmentId: "borrow-text", quote: "你的左手有一道浅划伤。" }] } });
  turn.events.push({ id: "free-description", type: "entity.update", sourceSegmentIds: ["borrow-text"],
    data: { id: "p", attributes: { description: "未经原文证实的自由概括".repeat(2400) } } });
  env.commit(turn, "我请求借两袋米，承诺明天归还。");
  const before = env.store.readPlayerState({ revision: 1 });
  const canonicalBefore = env.store.readModelState({ revision: 1 });
  const originalTurn = env.store.readTurn(1);
  const expectedState = structuredClone(before.state);
  assert.equal(expectedState.entities.p.conditionRecords.items[0].text, "左手浅划伤");
  for (const entity of Object.values(expectedState.entities)) { delete entity.attributes; delete entity.conditionRecords; }
  const result = await env.service({ contextPolicy: { configuredContextWindow: 64000 }, provider: { async generate(request) {
    env.calls.push(request);
    const data = JSON.parse(request.messages[1].content);
    assert.deepEqual(data.currentState, expectedState);
    assert.deepEqual(data.currentState.inventory, [{ ownerId: "p", itemId: "rice", quantity: 2 }]);
    assert.equal(data.currentState.commitments["rice-promise"].status, "open");
    assert.doesNotMatch(JSON.stringify(data), /未经原文证实的自由概括|左手浅划伤|尚未露面的访客|未发现的钥匙/);
    assert.equal(data.sources.length, 1);
    assert.equal(data.sources[0].text, original);
    assert.equal(data.sources[0].revision, 1);
    assert.equal(data.sources[0].segmentId, "borrow-text");
    assert.equal(data.sources[0].playerInput, "我请求借两袋米，承诺明天归还。");
    return response(candidate(data));
  } } }).saveChapter({ targetRevision: 1 });
  assert.equal(result.chapter.mode, "model");
  assert.equal(result.modelCalls, 1);
  assert.equal(env.calls.length, 1);
  assert.deepEqual(result.chapter.keyEvents[0].sources, [{ revision: 1, segmentId: "borrow-text" }]);
  assert.deepEqual(env.store.readPlayerState({ revision: 1 }), before);
  assert.deepEqual(env.store.readModelState({ revision: 1 }), canonicalBefore);
  assert.deepEqual(env.store.readTurn(1), originalTurn);
});

test("多个已生成部分合并后超过中文字节窗口时不会发送超限汇总请求", async (t) => {
  const env = fixture(t);
  env.commit(narration("原".repeat(45000), "long-source"));
  let calls = 0;
  const result = await env.service({ contextPolicy: { configuredContextWindow: 64000 }, provider: { async generate(request) {
    calls++;
    const data = JSON.parse(request.messages[1].content);
    assert.equal(data.task, "summarize_chapter", "the oversized merge must not reach Provider");
    const part = candidate(data);
    part.summary = "述".repeat(CHAPTER_LIMITS.summaryCharacters);
    part.keyEvents[0].text = "事".repeat(CHAPTER_LIMITS.itemCharacters);
    return response(part);
  } } }).saveChapter({ targetRevision: 1 });
  assert.equal(calls, 3);
  assert.equal(result.chapter.mode, "excerpt");
  assert.equal(result.chapter.fallbackReason, "CHAPTER_CONTEXT_BUDGET_EXCEEDED");
  assert.equal(result.usage.input_tokens, 300);
  assert.equal(env.store.readTurn(1).narration[0].text.length, 45000);
});

test("Provider实际输入越过窗口保护线后不继续下一分块或汇总", async (t) => {
  const env = fixture(t);
  env.commit(narration("章".repeat(24000), "reported-overflow"));
  let calls = 0;
  const result = await env.service({ contextPolicy: { configuredContextWindow: 64000 }, provider: { async generate(request) {
    calls++;
    return response(candidate(JSON.parse(request.messages[1].content)), { usage: { input_tokens: 60000, output_tokens: 100, total_tokens: 60100 } });
  } } }).saveChapter({ targetRevision: 1 });
  assert.equal(calls, 1);
  assert.equal(result.modelCalls, 1);
  assert.equal(result.usage.input_tokens, 60000, "already reported usage is retained, not undone");
  assert.equal(result.chapter.mode, "excerpt");
  assert.equal(result.chapter.fallbackReason, "CHAPTER_CONTEXT_BUDGET_EXCEEDED");
  assert.equal(env.store.readView().revision, 1);
});

test("预先发现总调用预算不足则零模型退为真实摘录，不伪装完整总结或创造未解决线索", async (t) => {
  const env = fixture(t, "en-US");
  const original = "A long saved passage. ".repeat(1000);
  env.commit(narration(original));
  const result = await env.service({ maxContextCharacters: 6000, maxModelCalls: 1 }).saveChapter({ targetRevision: 1 });
  assert.equal(result.chapter.mode, "excerpt");
  assert.match(result.chapter.summary, /complete chapter review is not yet available/);
  assert.equal(result.chapter.keyEvents[0].text, original.slice(0, CHAPTER_LIMITS.itemCharacters));
  assert.deepEqual(result.chapter.openThreads, []);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.usageComplete, true);
  assert.ok(["CHAPTER_MODEL_BUDGET_EXCEEDED", "CHAPTER_CONTEXT_BUDGET_EXCEEDED"].includes(result.chapter.fallbackReason));
});

test("大于历史视图上限的单轮仍可读源并生成日文摘录，正式正文完全保留", async (t) => {
  const env = fixture(t, "ja-JP");
  const bundle = { narration: [...Array.from({ length: 24 }, (_, i) => ({ id: `large-${i}`, text: "x".repeat(100000) }))], events: [], experiences: [] };
  const action = env.store.beginAction({ actionId: "large-turn", baseRevision: 0, input: "長い場面。",
    locale: "ja-JP", contentVersion: env.identity.contentVersion });
  assert.throws(() => env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle }),
    (error) => error.code === "HISTORY_PAGE_TOO_LARGE");
  assert.equal(env.store.readAction("large-turn").status, "committed");
  const result = await env.service({ maxModelCalls: 1 }).saveChapter({ targetRevision: 1 });
  assert.equal(result.chapterStatus, "created");
  assert.equal(result.chapter.mode, "excerpt");
  assert.match(result.chapter.summary, /原文はすべて保存/);
  assert.equal(result.modelCalls, 0);
  assert.deepEqual(env.store.readTurn(1).narration, bundle.narration);
  assert.equal(env.store.readTurn(1).narration.reduce((sum, segment) => sum + segment.text.length, 0), 2400000);
});

test("模型不可用、任意异常、非法 JSON/来源/工具和输出截断只产生明确摘录且不泄漏诊断", async (t) => {
  for (const [name, provider, fallback] of [
    ["unavailable", null, "CHAPTER_MODEL_UNAVAILABLE"],
    ["error", { generate() { throw error("RAW_SECRET"); } }, "CHAPTER_MODEL_FAILED"],
    ["invalid JSON", { generate() { return response(null, { text: '{"__proto__":{"secret":1}}' }); } }, "CHAPTER_OUTPUT_INVALID"],
    ["false source", { generate() { return response({ title: "标题", summary: "摘要", keyEvents: [
      { text: "伪引用", sources: [{ revision: 99, segmentId: "secret" }] }], openThreads: [] }); } }, "CHAPTER_OUTPUT_INVALID"],
    ["tools", { generate() { return response(null, { toolCalls: [{ name: "write_world" }] }); } }, "CHAPTER_OUTPUT_INVALID"],
    ["truncated", { generate() { return response(null, { finishReason: "length" }); } }, "CHAPTER_OUTPUT_BUDGET_EXCEEDED"],
  ]) await t.test(name, async (t) => {
    const env = fixture(t);
    env.commit(narration("你并未拿到那袋米，对方拒绝了你的请求。"));
    const result = await env.service({ provider }).saveChapter({ targetRevision: 1 });
    assert.equal(result.chapterStatus, "created");
    assert.equal(result.chapter.mode, "excerpt");
    assert.equal(result.chapter.fallbackReason, fallback);
    assert.equal(result.modelCalls, name === "unavailable" ? 0 : ["invalid JSON", "false source"].includes(name) ? 4 : 1,
      "only structural failures get up to three repairs; Provider, tool and length failures do not retry");
    assert.match(result.chapter.keyEvents[0].text, /并未拿到/);
    assert.deepEqual(result.chapter.openThreads, []);
    assert.doesNotMatch(JSON.stringify(result), /private provider|local path|RAW_SECRET/);
  });
});

test("缺失用量不当作零成本，输出上限由服务及 Provider 请求共同约束", async (t) => {
  const env = fixture(t);
  env.commit(narration("雨停了。"));
  const result = await env.service({ maxOutputTokens: 20, provider: { generate(request) {
    assert.equal(request.maxOutputTokens, 20);
    return response(null, { text: "x".repeat(161), usage: undefined });
  } } }).saveChapter({ targetRevision: 1 });
  assert.equal(result.chapter.fallbackReason, "CHAPTER_OUTPUT_BUDGET_EXCEEDED");
  assert.equal(result.modelCalls, 1);
  assert.equal(result.usageComplete, false);
  assert.deepEqual(result.usage, {});
});

test("取消/关闭不把迟到模型结果归章；中断必须显式重试", async (t) => {
  for (const stop of ["abort", "shutdown"]) await t.test(stop, async (t) => {
    const env = fixture(t);
    env.commit(narration("正式故事始终保留。"));
    const entered = deferred();
    const late = deferred();
    let input;
    const service = env.service({ provider: { generate(request) { input = JSON.parse(request.messages[1].content); entered.resolve(); return late.promise; } } });
    const controller = new AbortController();
    const pending = service.saveChapter({ targetRevision: 1 }, { signal: controller.signal });
    await entered.promise;
    if (stop === "abort") controller.abort();
    else await service.shutdown();
    const interrupted = await pending;
    assert.equal(interrupted.saved, true);
    assert.equal(interrupted.chapterStatus, "interrupted");
    assert.equal(interrupted.error.code, "CHAPTER_INTERRUPTED");
    assert.equal(interrupted.usageComplete, false);
    late.resolve(response(candidate(input)));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(env.store.readChapterJob("chapter-1").status, "interrupted");
    const resumed = env.service();
    assert.equal((await resumed.saveChapter({ targetRevision: 1 })).modelCalls, 0);
    const retried = await resumed.saveChapter({ targetRevision: 1 }, { retry: true });
    assert.equal(retried.chapterStatus, "created");
    assert.equal(retried.modelCalls, 1);
  });
});

test("预先取消零模型且不遗留运行锁；超时保留可重试章节失败而故事仍已保存", async (t) => {
  const env = fixture(t);
  env.commit(narration("已保存。"));
  const controller = new AbortController();
  controller.abort();
  const service = env.service();
  const cancelled = await service.saveChapter({ targetRevision: 1 }, { signal: controller.signal });
  assert.equal(cancelled.chapterStatus, "interrupted");
  assert.equal(cancelled.modelCalls, 0);
  await service.shutdown();
  const timeout = env.service({ timeoutMs: 20, provider: { generate() { return new Promise(() => {}); } } });
  const result = await timeout.saveChapter({ targetRevision: 1 }, { retry: true });
  assert.equal(result.saved, true);
  assert.equal(result.chapterStatus, "failed");
  assert.equal(result.error.code, "CHAPTER_TIMEOUT");
  assert.equal(result.modelCalls, 1);
});

test("其他存储连接已有章节运行时相同或更新目标零模型，不抢占其 attempt", async (t) => {
  const env = fixture(t);
  env.commit(narration("第一轮。"));
  const first = env.store.beginChapter({ targetRevision: 1 });
  env.commit(narration("第二轮。"));
  const service = env.service({ store: env.open() });
  const same = await service.saveChapter({ targetRevision: 1 });
  const later = await service.saveChapter({ targetRevision: 2 });
  assert.equal(same.chapterStatus, "running");
  assert.equal(later.chapterStatus, "running");
  assert.equal(later.error.code, "CHAPTER_BUSY");
  assert.equal(same.modelCalls + later.modelCalls, 0);
  assert.equal(env.calls.length, 0);
  assert.equal(env.store.readChapterJob(first.chapterId).attemptId, first.attemptId);
});

test("提交已完成但响应丢失时只读回执，随后再次保存不再生成", async (t) => {
  const env = fixture(t);
  env.commit(narration("既有正文。"));
  let unreadable = true;
  const service = env.service({ store: { ...env.store,
    commitChapter(input) { env.store.commitChapter(input); throw error("arbitrary"); },
    readChapterJob(id) { if (unreadable) throw error("arbitrary"); return env.store.readChapterJob(id); },
  } });
  const first = await service.saveChapter({ targetRevision: 1 });
  assert.equal(first.chapterStatus, "unknown");
  assert.equal(first.error.code, "CHAPTER_COMMIT_OUTCOME_UNKNOWN");
  assert.equal(env.store.readChapterJob("chapter-1").status, "committed");
  assert.equal((await service.saveChapter({ targetRevision: 1 })).modelCalls, 0);
  unreadable = false;
  const restored = await service.saveChapter({ targetRevision: 1 });
  assert.equal(restored.chapterStatus, "unchanged");
  assert.equal(restored.modelCalls, 0);
  assert.equal(env.calls.length, 1);
});

test("未提交且回执未知的本服务尝试，查明后只有显式重试才重新生成", async (t) => {
  const env = fixture(t);
  env.commit(narration("存档中的原文。"));
  let failCommit = true;
  let unreadable = true;
  const service = env.service({ store: { ...env.store,
    commitChapter(input) { if (failCommit) throw error("private"); return env.store.commitChapter(input); },
    readChapterJob(id) { if (unreadable) throw error("private"); return env.store.readChapterJob(id); },
  } });
  const first = await service.saveChapter({ targetRevision: 1 });
  const originalAttempt = env.store.readChapterJob("chapter-1").attemptId;
  assert.equal(first.error.code, "CHAPTER_COMMIT_OUTCOME_UNKNOWN");
  unreadable = false;
  assert.equal((await service.saveChapter({ targetRevision: 1 })).chapterStatus, "unknown");
  assert.equal(env.calls.length, 1);
  failCommit = false;
  const retried = await service.saveChapter({ targetRevision: 1 }, { retry: true });
  assert.equal(retried.chapterStatus, "created");
  assert.notEqual(env.store.readChapterJob("chapter-1").attemptId, originalAttempt);
  assert.equal(env.calls.length, 2);
});

test("来源身份、当前状态读取故障不猜语言、不冒充摘录成功或透出存储错误", async (t) => {
  for (const mode of ["wrong-adventure", "wrong-attempt", "state-error"]) await t.test(mode, async (t) => {
    const env = fixture(t, "en-US");
    env.commit(narration("A saved passage."));
    const service = env.service({ store: { ...env.store,
      readChapterSource(input) { const page = env.store.readChapterSource(input);
        if (mode === "wrong-adventure") page.adventureId = "other";
        if (mode === "wrong-attempt") page.attemptId = "other";
        return page; },
      readPlayerState(input) { if (mode === "state-error") throw error("raw-error"); return env.store.readPlayerState(input); },
    } });
    const result = await service.saveChapter({ targetRevision: 1 });
    assert.equal(result.saved, true);
    assert.equal(result.chapterStatus, "failed");
    assert.equal(result.chapter, undefined);
    assert.equal(result.modelCalls, 0);
    assert.equal(result.error.code, "CHAPTER_SOURCE_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(result), /private provider|local path/);
  });
});

test("直接调用拒绝 request/options 的访问器和伪造 signal，不执行 getter 或创建任务", async (t) => {
  const env = fixture(t);
  env.commit(narration("正式正文。"));
  const service = env.service();
  let touched = 0;
  const request = Object.defineProperty({}, "targetRevision", { enumerable: true, get() { touched++; return 1; } });
  const options = Object.defineProperty({}, "signal", { enumerable: true, get() { touched++; return new AbortController().signal; } });
  const fakeSignal = Object.defineProperty({}, "aborted", { get() { touched++; return false; } });
  for (const call of [() => service.saveChapter(request), () => service.saveChapter({ targetRevision: 1 }, options),
    () => service.saveChapter({ targetRevision: 1 }, { signal: fakeSignal }),
    () => service.saveChapter(Object.create({ targetRevision: 1 })),
    () => service.saveChapter({ targetRevision: 1, __proto__: { secret: true } })]) {
    await assert.rejects(call(), (error) => error.code === "CHAPTER_INPUT_INVALID");
  }
  assert.equal(touched, 0);
  assert.equal(env.store.readChapterJob("chapter-1"), null);
  assert.equal(env.calls.length, 0);
});
