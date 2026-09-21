"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createTurnStore } = require("./turn-store");
const { createTurnMemory } = require("./turn-memory");
const samples = require("./test-fixtures/turn-samples");

function sandbox(t, { state = samples.initialState(), adventureId = "memory-adventure" } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-memory-"));
  const databasePath = path.join(directory, "adventure.sqlite");
  const identity = { ...samples.identity(databasePath), adventureId };
  const stores = [];
  function open(initialState) {
    const store = createTurnStore({ ...identity, ...(initialState ? { initialState } : {}) });
    stores.push(store);
    return store;
  }
  t.after(() => { for (const store of stores.reverse()) store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store: open(state), open, databasePath };
}

function commit(store, revision, bundle, input = "继续观察周围。") {
  const action = store.beginAction(samples.request({ actionId: `action-${revision + 1}`, baseRevision: revision, input }));
  return store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
}

function memoryBundle({ id = "memory", text, narration = text, kind = "event", knownBy = ["p"], entityIds = ["npc"], supersedes } = {}) {
  return {
    narration: [{ id: "source", text: narration }], events: [],
    experiences: [{ id, ...(text === undefined ? {} : { text }), kind, knownBy, entityIds, eventIds: [], sourceSegmentIds: ["source"], ...(supersedes ? { supersedes } : {}) }],
  };
}

test("field relevance recalls early sources without later entity links ahead of repeated questions in three languages", async (t) => {
  for (const sample of [
    { locale: "zh-CN", query: "钟声", original: "你听见钟声隔了两拍又响了一下，方向并不确定。", question: "我想起钟声，钟声是否意味着有人？" },
    { locale: "en-US", query: "bell sound", original: "The bell sound came twice, but you could not tell its direction.", question: "Was that bell sound someone calling? I keep wondering about the bell sound." },
    { locale: "ja-JP", query: "鈴の音", original: "鈴の音が二度聞こえたが、どこからかは分からなかった。", question: "あの鈴の音は誰かの合図だった？鈴の音について考える。" },
  ]) await t.test(sample.locale, (t) => {
    const context = sandbox(t);
    commit(context.store, 0, memoryBundle({ id: "first-observation", text: "以前の記録。", narration: sample.original,
      entityIds: ["p", "home"] }), "私は立ち止まる。" );
    for (let r = 1; r < 9; r++) commit(context.store, r, memoryBundle({ id: `later-question-${r}`,
      text: sample.question.repeat(3), narration: "你继续坐着，没有新的发现。", kind: "claim",
      entityIds: ["p", "home", "npc"] }), sample.question.repeat(3));
    const before = context.store.readModelState(); context.store.close(); const store = context.open();
    for (const outputMode of ["full", "model"]) {
      const packet = createTurnMemory({ store }).recall({ query: sample.query, entityIds: ["p", "home", "npc"],
        viewerId: "p", revision: 9, limit: 6, maxCharacters: 8000, outputMode });
      assert.equal(packet.results[0].source.experienceId, "first-observation");
      assert.equal(packet.results[0].passages[0].text, sample.original);
      assert.equal(packet.results[0].passages[0].truncated, false);
      assert.equal(packet.results.length, 6); assert.equal(packet.truncated, true);
      assert.ok(JSON.stringify(packet).length <= 8000);
      assert.equal(packet.results[1].experience.kind, "claim", "question matches remain available without promotion to fact");
    }
    const namedOnly = createTurnMemory({ store }).recall({ query: "隔壁邻居", entityIds: ["p", "home", "npc"],
      viewerId: "p", revision: 9, order: "earliest", outputMode: "model" });
    assert.equal(namedOnly.results.some((entry) => entry.source.experienceId === "first-observation"), false,
      "an explicit alias matches that entity, not unrelated player/location hint records");
    assert.deepEqual(store.readModelState(), before);
  });
});

test("time ordering admits matching records, keeps entity-only queries, and bounds sources without changing the fixed state", (t) => {
  const { store } = sandbox(t);
  for (const [i, text] of ["窗外正在下雨。", "钟声响了一次。", "你坐着等候。", "钟声又响了一次。"].entries()) {
    commit(store, i, memoryBundle({ id: `source-${i + 1}`, text, entityIds: ["p", "npc", "home"] }), "我继续等候。" );
  }
  const memory = createTurnMemory({ store }), before = store.readModelState();
  const options = { query: "钟声", entityIds: ["p", "npc", "home"], viewerId: "p", revision: 4, outputMode: "model" };
  for (const [order, expected] of [["earliest", [2, 4]], ["latest", [4, 2]], ["relevance", [4, 2]]]) {
    const packet = memory.recall({ ...options, order });
    assert.deepEqual(packet.results.map((x) => x.source.revision), expected);
    assert.equal(packet.revision, 4); assert.equal(packet.truncated, false);
  }
  assert.deepEqual(memory.recall({ ...options, order: "earliest", afterRevision: 2 }).results.map((x) => x.source.revision), [4]);
  assert.deepEqual(memory.recall({ ...options, order: "latest", beforeRevision: 4, afterRevision: 1 }).results.map((x) => x.source.revision), [2]);
  for (const query of ["", "隔壁邻居"]) assert.deepEqual(memory.recall({ ...options, query, order: "earliest" }).results.map((x) => x.source.revision), [1, 2, 3, 4]);
  assert.deepEqual(memory.recall({ ...options, query: "汽笛", order: "earliest" }).results, []);
  for (const invalid of [{ beforeRevision: 5 }, { afterRevision: 5 }, { beforeRevision: 0 }, { afterRevision: -1 },
    { beforeRevision: 2, afterRevision: 2 }, { beforeRevision: 1.5 }, { afterRevision: "1" }, { order: "oldest" },
    { revision: 2, beforeRevision: 3 }, { revision: 2, afterRevision: 3 }]) {
    assert.throws(() => memory.recall({ ...options, ...invalid }), { code: "MEMORY_QUERY_INVALID" });
  }
  assert.deepEqual(store.readModelState(), before);
});

test("a historical source filter never revives corrections or hidden evidence from the fixed knowledge state", (t) => {
  const { store } = sandbox(t);
  commit(store, 0, memoryBundle({ id: "old", text: "铃声来自楼上。", kind: "claim" }));
  commit(store, 1, memoryBundle({ id: "hidden", text: "铃声来自秘密房间。", entityIds: ["secret"] }));
  commit(store, 2, memoryBundle({ id: "corrected", text: "她纠正了铃声来自楼上的说法：方向无法确认。", kind: "claim",
    supersedes: [{ revision: 1, experienceId: "old" }] }));
  const memory = createTurnMemory({ store }), options = { query: "铃声", viewerId: "p", revision: 3, order: "earliest" };
  assert.deepEqual(memory.recall({ ...options, beforeRevision: 3 }).results, []);
  assert.deepEqual(memory.recall(options).results.map((x) => x.source.experienceId), ["corrected"]);
  assert.deepEqual(memory.recall({ ...options, revision: 1 }).results.map((x) => x.source.experienceId), ["old"]);
  assert.throws(() => memory.recall({ ...options, entityIds: ["secret"] }), { code: "MEMORY_QUERY_INVALID" });
  assert.throws(() => memory.recall({ ...options, viewerId: "npc" }), { code: "MEMORY_VIEWER_INVALID" });
  const bounded = createTurnMemory({ store, maxScannedRecords: 1 }).recall({ ...options, afterRevision: 1, maxCharacters: 256 });
  assert.deepEqual(bounded.results, []); assert.equal(bounded.truncated, true);
  assert.ok(JSON.stringify(bounded).length <= 256);
});

test("a named entity plus a topic cannot fill a time-ordered page with unrelated entity records", (t) => {
  const { store } = sandbox(t);
  for (let i = 0; i < 6; i++) commit(store, i, memoryBundle({ id: `unrelated-${i}`,
    text: "陈姨留在屋里等候。", narration: "陈姨看着窗外下雨。" }), "我陪陈姨坐着。" );
  commit(store, 6, memoryBundle({ id: "topic", text: "她提起钟声。", narration: "钟声响过一次，方向不确定。" }), "我停下来。" );
  const memory = createTurnMemory({ store });
  for (const query of ["钟声", "陈姨 钟声", "隔壁邻居 钟声"]) {
    for (const order of ["earliest", "latest"]) {
      const result = memory.recall({ query, entityIds: ["p", "home", "npc"], order, viewerId: "p", revision: 7, limit: 6 });
      assert.deepEqual(result.results.map((entry) => entry.source.experienceId), ["topic"]);
    }
  }
  for (const query of ["陈姨", "隔壁邻居", ""]) {
    const result = memory.recall({ query, entityIds: ["npc"], order: "earliest", viewerId: "p", revision: 7, limit: 6 });
    assert.deepEqual(result.results.map((entry) => entry.source.revision), [1, 2, 3, 4, 5, 6]);
  }
});

test("自报身份和失败尝试的玩家原话在退出近期与重启后仍同正文配对，自动和工具召回都保留", async (t) => {
  const context = sandbox(t);
  const introduction = "我先介绍自己：我叫林芷，是社区食堂的面点工。";
  const attempt = "我试着拿走柜里的药，先问对方是否同意。";
  commit(context.store, 0, memoryBundle({ id: "self-introduction", text: "门外的人作了回应。", kind: "claim",
    narration: "你说完，门外的人轻声重复了你的称呼。" }), introduction);
  commit(context.store, 1, memoryBundle({ id: "refused-attempt", text: "没有发生物品转移。",
    narration: "对方摇头，柜门没有打开。" }), attempt);
  for (let revision = 2; revision < 16; revision++) commit(context.store, revision,
    { narration: [{ id: "later", text: "你继续听着窗外的雨。" }], events: [], experiences: [] });
  assert.doesNotMatch(JSON.stringify(context.store.readRecentTurns({ limit: 12 })), /林芷|拿走柜里的药/);
  const before = context.store.readPlayerState();
  assert.doesNotMatch(JSON.stringify(before), /林芷|拿走柜里的药/);
  context.store.close(); const reopened = context.open(); const memory = createTurnMemory({ store: reopened });
  for (const outputMode of ["full", "model"]) {
    for (const [query, id, input, revision] of [["介绍自己", "self-introduction", introduction, 1], ["试着拿走", "refused-attempt", attempt, 2]]) {
      const packet = memory.recall({ query, viewerId: "p", revision: 16, outputMode });
      const result = packet.results.find((entry) => entry.experience.id === id);
      assert.ok(result, "query terms found only in the original input still participate in ranking");
      assert.deepEqual(result.playerInput, { kind: "player_input", text: input, start: 0, end: input.length, truncated: false });
      assert.equal(result.source.revision, revision); assert.equal(result.source.actionId, `action-${revision}`);
      assert.equal(result.source.adventureId, "memory-adventure");
      assert.equal(result.passages[0].text, reopened.readTurn(revision).narration[0].text);
      if (outputMode === "model") { assert.equal(result.experience.text, undefined); assert.equal(result.currentFacts, undefined); }
    }
  }
  const { createTurnGenerator } = require("./turn-generator"); let calls = 0;
  const generator = createTurnGenerator({ store: reopened, memory, adventureId: "memory-adventure", hostText: "回应实际来源。",
    worldText: "临时合成楼道场景。", provider: { async generate(request) {
      calls++;
      const packet = calls === 1 ? JSON.parse(request.messages[2].content.split("\n").slice(1).join("\n"))
        : JSON.parse(request.messages.findLast((message) => message.role === "tool").content);
      const record = packet.results.find((entry) => entry.source.revision === 1);
      assert.equal(record.experience.text, undefined);
      if (calls === 1) {
        const history = JSON.parse(request.messages[3].content.split("\n").slice(1).join("\n"));
        const original = history.turns.find(turn => turn.revision === record.source.revision);
        assert.equal(record.playerInput.historyRef, true);
        assert.equal(record.passages[0].historyRef, true);
        assert.equal(original.input, introduction);
        assert.equal(original.narration.find(segment => segment.id === record.passages[0].id).text,
          "你说完，门外的人轻声重复了你的称呼。");
      } else {
        assert.equal(record.playerInput.text, introduction);
        assert.equal(record.passages[0].text, "你说完，门外的人轻声重复了你的称呼。");
      }
      if (calls === 1) return { text: "", finishReason: "tool_calls", toolCalls: [{ id: "inspect-input", name: "recall_memory", arguments: JSON.stringify({ query: "介绍自己" }) }] };
      return { text: JSON.stringify({ narration: [{ id: "reply", text: "你记起是自己先报了称呼。" }], events: [], experiences: [] }), finishReason: "stop" };
    } } });
  await generator.generateTurn({ request: samples.request({ actionId: "revisit", baseRevision: 16, input: "我当时怎么介绍自己的？" }),
    attemptId: "revisit-attempt", state: reopened.readModelState(), signal: new AbortController().signal });
  assert.equal(calls, 2); assert.deepEqual(reopened.readPlayerState(), before);
});

test("玩家原话和正文共享原输出预算，裁剪保持精确来源范围且明确不完整", (t) => {
  const { store } = sandbox(t);
  const input = "尝试".repeat(2500) + "请求许可" + "等待".repeat(2500);
  const original = "没有答应。".repeat(1000);
  commit(store, 0, memoryBundle({ text: "对方没有同意。", narration: original }), input);
  for (const outputMode of ["full", "model"]) {
    const packet = createTurnMemory({ store }).recall({ query: "请求许可", viewerId: "p", maxCharacters: 2000, outputMode });
    const result = packet.results[0]; assert.ok(result.playerInput); assert.ok(result.passages[0]);
    assert.ok(JSON.stringify(packet).length <= 2000); assert.equal(packet.truncated, true);
    assert.equal(result.playerInput.kind, "player_input"); assert.equal(result.playerInput.truncated, true);
    assert.equal(result.playerInput.text, input.slice(result.playerInput.start, result.playerInput.end));
    assert.equal(result.passages[0].text, original.slice(result.passages[0].start, result.passages[0].end));
    assert.ok(result.playerInput.text.length <= 2400 && result.passages[0].text.length <= 2400);
  }
});

test("预算可容纳的长玩家原话与长正文完整返回，保留末尾否定和不确定性", async (t) => {
  const denial = '最后我说明：“我没亲眼看到，\"红箱子\"也只是传闻，别把它当成已确认的事。”\\仍待确认。🧭';
  const long = "窗外的雨敲着铁皮。".repeat(300) + denial;
  assert.ok(long.length > 2400);
  for (const role of ["player_input", "narration", "both"]) await t.test(role, (t) => {
    const context = sandbox(t);
    const input = role === "narration" ? "我询问消息是否可靠。" : long;
    const narration = role === "player_input" ? "陈姨听完，点了点头。" : long;
    commit(context.store, 0, memoryBundle({ text: "箱子传闻。", narration, kind: "claim" }), input);
    const original = context.store.readTurn(1), before = context.store.readModelState();
    context.store.close(); const store = context.open();
    for (const outputMode of ["full", "model"]) {
      const packet = createTurnMemory({ store }).recall({ query: "隔壁邻居", viewerId: "p", maxCharacters: 8000, outputMode });
      const record = packet.results[0];
      assert.ok(JSON.stringify(packet).length <= 8000); assert.equal(packet.truncated, false);
      assert.deepEqual(record.playerInput, { kind: "player_input", text: input, start: 0, end: input.length, truncated: false });
      assert.deepEqual(record.passages, [{ id: "source", text: narration, start: 0, end: narration.length, truncated: false }]);
      assert.equal(record.experience.kind, "claim");
      if (outputMode === "model") { assert.equal(record.experience.text, undefined); assert.equal(record.currentFacts, undefined); }
    }
    assert.deepEqual(store.readTurn(1), original); assert.deepEqual(store.readModelState(), before);
  });
});

test("已核实开局支持段超过2400字仍完整召回，超预算才在各角色原文之间分配", (t) => {
  const { createOpeningState } = require("./session-opening");
  const { store } = sandbox(t, { state: createOpeningState() });
  const summary = "你回忆旧日的工作。".repeat(320) + "但你明确说：这只是可能的去处，并不确定认识那个人。";
  const scene = "门边的人安静地等着，你没有走过去。";
  const input = "我确认这些选择。".repeat(400) + "仍不确认旧日的猜测。";
  commit(store, 0, { narration: [{ id: "proposal-text", text: summary }],
    events: [{ id: "proposal-event", type: "opening.propose", sourceSegmentIds: ["proposal-text"],
      data: { proposalId: "chosen", initialState: samples.initialState() } }], experiences: [] });
  commit(store, 1, { narration: [{ id: "scene", text: scene }],
    events: [{ id: "confirm-event", type: "opening.confirm", sourceSegmentIds: ["scene"], data: { proposalId: "chosen" } }],
    experiences: [{ id: "opening-memory", text: "确认开局选择。", kind: "claim", knownBy: ["p"], entityIds: ["p"],
      eventIds: ["confirm-event"], sourceSegmentIds: ["scene"] }] }, input);
  const before = [store.readTurn(1), store.readTurn(2), store.readModelState()];
  const memory = createTurnMemory({ store });
  for (const outputMode of ["full", "model"]) {
    const complete = memory.recall({ query: "旧日的工作", viewerId: "p", maxCharacters: 8000, outputMode });
    assert.equal(complete.truncated, false); assert.ok(JSON.stringify(complete).length <= 8000);
    const entry = complete.results[0];
    assert.equal(entry.playerInput.text, input); assert.equal(entry.playerInput.truncated, false);
    assert.deepEqual(entry.supportingPassages, [{ kind: "opening_summary", adventureId: "memory-adventure", revision: 1,
      actionId: "action-1", segmentId: "proposal-text", text: summary, start: 0, end: summary.length, truncated: false }]);
    assert.equal(entry.source.revision, 2); assert.equal(entry.supportingPassagesOmitted, 0);
    const bounded = memory.recall({ query: "旧日的工作", viewerId: "p", maxCharacters: 1800, outputMode });
    assert.equal(bounded.truncated, true); assert.ok(JSON.stringify(bounded).length <= 1800);
    const partial = bounded.results[0];
    assert.equal(partial.passages[0].text, scene, "the short scene stays complete beside long input and support");
    assert.equal(partial.passages[0].truncated, false);
    for (const [passage, original] of [[partial.playerInput, input], [partial.supportingPassages[0], summary]]) {
      assert.ok(passage.text.length > 0); assert.equal(passage.truncated, true);
      assert.equal(passage.text, original.slice(passage.start, passage.end));
    }
  }
  assert.deepEqual([store.readTurn(1), store.readTurn(2), store.readModelState()], before);
});

test("完整结果按序列化长度守精确边界，多条命中保持排序并让后条有界退让", (t) => {
  const { store } = sandbox(t);
  const long = '箱子里有纸条。\\路径与"引文"。🧭\n'.repeat(450) + "但她没有看清。";
  const short = "陈姨没有确定箱子的颜色。";
  commit(store, 0, memoryBundle({ id: "older-long", text: "陈姨提起箱子。", narration: long, kind: "claim" }), "我追问箱子的消息。" );
  commit(store, 1, memoryBundle({ id: "newer-short", text: "陈姨提起箱子。", narration: short, kind: "claim" }), "我追问箱子的消息。" );
  const memory = createTurnMemory({ store });
  const options = { query: "隔壁邻居", viewerId: "p", outputMode: "model", limit: 2 };
  const full = memory.recall({ ...options, maxCharacters: 32000 });
  assert.equal(full.truncated, false);
  assert.deepEqual(full.results.map((entry) => entry.experience.id), ["newer-short", "older-long"]);
  const exactSize = JSON.stringify(full).length;
  assert.deepEqual(memory.recall({ ...options, maxCharacters: exactSize }), full);
  for (const maximum of [exactSize - 1, 3000, 1799, 600, 256]) {
    const packet = memory.recall({ ...options, maxCharacters: maximum });
    assert.ok(JSON.stringify(packet).length <= maximum); assert.equal(packet.truncated, true);
    for (const result of packet.results) {
      const original = result.experience.id === "newer-short" ? short : long;
      for (const passage of result.passages) assert.equal(passage.text, original.slice(passage.start, passage.end));
    }
    if (maximum >= 1799) {
      assert.deepEqual(packet.results.map((entry) => entry.experience.id), ["newer-short", "older-long"]);
      assert.equal(packet.results[0].passages[0].text, short);
      assert.equal(packet.results[0].passages[0].truncated, false);
      assert.ok(packet.results[1].passages[0].text.length > 0);
      assert.equal(packet.results[1].passages[0].truncated, true);
    }
  }
});

test("紧预算先保留一段可用正文或开局支持源，输入元数据不使整条召回消失", () => {
  const record = { adventureId: "a", revision: 1, actionId: "t",
    experience: { id: "e", text: "lookup", entityIds: ["p"], eventIds: [], knownBy: ["p"], sourceSegmentIds: ["s"], kind: "event" },
    passages: [{ id: "s", text: "ANSWER" }], playerInput: "x".repeat(1000) };
  // Exercise source reservation independently of lexical ranking; "lookup"
  // exists only in the legacy synopsis and is no longer a search source.
  const options = { query: "", entityIds: ["p"], viewerId: "p", outputMode: "model" };
  const recall = (records, revision, maxCharacters = 8000) => createTurnMemory({ store: {
    listExperienceRecords() { return { revision, records, nextCursor: null }; },
    readModelState() { return samples.initialState(); },
  } }).recall({ ...options, revision, maxCharacters });
  const { playerInput, ...withoutInput } = record;
  const narrativeOnly = recall([withoutInput], 1);
  assert.equal(JSON.stringify(narrativeOnly).length, 329, "the reported boundary fits the entire original paragraph");
  const bounded = recall([record], 1, 329);
  assert.equal(bounded.results.length, 1); assert.equal(bounded.truncated, true);
  assert.ok(JSON.stringify(bounded).length <= 329);
  assert.deepEqual(bounded.results[0].passages, [{ id: "s", text: "ANSWER", start: 0, end: 6, truncated: false }]);
  assert.equal(bounded.results[0].playerInput, undefined);

  const longId = "s" + "a".repeat(80);
  const multiplePassages = { ...record, experience: { ...record.experience, sourceSegmentIds: [longId, "s2"] },
    passages: [{ id: longId, text: "X".repeat(5000) }, { id: "s2", text: "ANSWER" }], playerInput: "Y".repeat(1000) };
  const secondPassage = recall([multiplePassages], 1, 539);
  assert.ok(JSON.stringify(secondPassage).length <= 539); assert.equal(secondPassage.truncated, true);
  assert.equal(secondPassage.results.length, 1);
  assert.deepEqual(secondPassage.results[0].passages, [{ id: "s2", text: "ANSWER", start: 0, end: 6, truncated: false }]);
  assert.equal(secondPassage.results[0].playerInput, undefined, "a failed first paragraph reservation must not hand its place to input");

  const support = { ...record, revision: 2, experience: { ...record.experience, sourceSegmentIds: [] }, passages: [],
    supportingPassages: [{ kind: "opening_summary", adventureId: "a", revision: 1, actionId: "proposal", segmentId: "summary", text: "原选择并不确定。" }] };
  const { playerInput: omitted, ...supportOnly } = support;
  const supportBudget = JSON.stringify(recall([supportOnly], 2)).length;
  const supported = recall([support], 2, supportBudget);
  assert.equal(supported.results.length, 1); assert.equal(supported.truncated, true);
  assert.ok(JSON.stringify(supported).length <= supportBudget);
  assert.equal(supported.results[0].supportingPassages[0].text, "原选择并不确定。");
  assert.equal(supported.results[0].supportingPassages[0].truncated, false);
  assert.equal(supported.results[0].supportingPassagesOmitted, 0);

  const first = { ...record, revision: 2, actionId: "new", experience: { ...record.experience, id: "new" },
    passages: [{ id: "s", text: "较新的简短交谈。" }], playerInput: "我听着。" };
  const firstSize = JSON.stringify(recall([first], 2)).length;
  const envelopeSize = JSON.stringify({ revision: 2, results: [], truncated: false }).length;
  const combinedBudget = firstSize + 329 - envelopeSize + 1;
  const combined = recall([record, first], 2, combinedBudget);
  assert.ok(JSON.stringify(combined).length <= combinedBudget); assert.equal(combined.truncated, true);
  assert.deepEqual(combined.results.map((entry) => entry.experience.id), ["new", "e"]);
  assert.equal(combined.results[0].playerInput.text, "我听着。");
  assert.equal(combined.results[1].passages[0].text, "ANSWER");
  assert.equal(combined.results[1].passages[0].truncated, false);
  assert.equal(record.playerInput, playerInput); assert.equal(support.playerInput, omitted);
});

test("非字符串或不属于该正式行动的输入来源拒绝，自定义旧reader可明确缺省", (t) => {
  const { store, databasePath } = sandbox(t); commit(store, 0, memoryBundle({ text: "门口传来声音。" }), "我问门口的人。" );
  for (const value of [null, 42, {}, undefined]) {
    const malformed = { ...store, listExperienceRecords(input) { const page = store.listExperienceRecords(input); page.records[0].playerInput = value; return page; } };
    assert.throws(() => createTurnMemory({ store: malformed }).recall({ query: "门口", viewerId: "p" }), { code: "MEMORY_SOURCE_UNAVAILABLE" });
  }
  let reads = 0;
  const accessor = { ...store, listExperienceRecords(input) { const page = store.listExperienceRecords(input);
    Object.defineProperty(page.records[0], "playerInput", { get() { reads++; return "forged"; } }); return page; } };
  assert.throws(() => createTurnMemory({ store: accessor }).recall({ query: "门口", viewerId: "p" }), { code: "MEMORY_SOURCE_UNAVAILABLE" }); assert.equal(reads, 0);
  const older = { ...store, listExperienceRecords(input) { const page = store.listExperienceRecords(input); delete page.records[0].playerInput; return page; } };
  assert.equal(createTurnMemory({ store: older }).recall({ query: "门口", viewerId: "p" }).results[0].playerInput, undefined);
  const db = new DatabaseSync(databasePath);
  try {
    const original = JSON.parse(db.prepare("SELECT request_json FROM actions WHERE action_id='action-1'").get().request_json);
    for (const patch of [{ input: {} }, { actionId: "another-action" }, { baseRevision: 5 }, { locale: "en-US" }, { contentVersion: "wrong-version" }]) {
      db.prepare("UPDATE actions SET request_json=? WHERE action_id='action-1'").run(JSON.stringify({ ...original, ...patch }));
      assert.throws(() => store.listExperienceRecords({ viewerId: "p", revision: 1 }), { code: "MEMORY_SOURCE_UNAVAILABLE" });
    }
    db.prepare("UPDATE actions SET request_json=?,status='failed' WHERE action_id='action-1'").run(JSON.stringify(original));
    assert.throws(() => store.listExperienceRecords({ viewerId: "p", revision: 1 }), { code: "MEMORY_SOURCE_UNAVAILABLE" });
  } finally { db.close(); }
});

test("隐藏与已纠正经历的原输入不会靠关键词重新进入召回", (t) => {
  const { store } = sandbox(t);
  commit(store, 0, memoryBundle({ id: "hidden", text: "门口的事。", knownBy: ["npc"] }), "门口 PRIVATE_INPUT");
  commit(store, 1, memoryBundle({ id: "old", text: "门口旧说法。", kind: "claim" }), "门口 OLD_SUPERSEDED_INPUT");
  commit(store, 2, memoryBundle({ id: "correct", text: "门口的新说明。", supersedes: [{ revision: 2, experienceId: "old" }] }), "门口的说明后来纠正了。");
  for (const outputMode of ["full", "model"]) {
    const result = createTurnMemory({ store }).recall({ query: "门口 PRIVATE_INPUT OLD_SUPERSEDED_INPUT", viewerId: "p", outputMode });
    assert.deepEqual(result.results.map((entry) => entry.experience.id), ["correct"]);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_INPUT|OLD_SUPERSEDED_INPUT/);
  }
});

test("a source outside twelve recent turns is recalled after reopening through a new entity alias", (t) => {
  const context = sandbox(t);
  const answer = "红线绕三圈";
  commit(context.store, 0, memoryBundle({ text: `陈姨提到辨认包裹的办法：${answer}。` }));
  for (let revision = 1; revision < 16; revision += 1) {
    commit(context.store, revision, { narration: [{ id: "weather", text: `走廊第${revision}次传来脚步声。` }], events: [], experiences: [] });
  }
  const recent = [13, 14, 15, 16].map((revision) => context.store.readTurn(revision));
  assert.equal(JSON.stringify(recent).includes(answer), false);
  assert.equal(JSON.stringify(context.store.readModelState()).includes(answer), false);
  const query = "再去找隔壁邻居，想起初次见面那句提醒。";
  assert.equal(query.includes(answer), false);
  context.store.close();
  const memory = createTurnMemory({ store: context.open() });
  const recalled = memory.recall({ query, viewerId: "p" });
  assert.equal(recalled.revision, 16);
  assert.equal(recalled.results.length, 1);
  assert.deepEqual(recalled.results[0].source, { adventureId: "memory-adventure", revision: 1, actionId: "action-1", experienceId: "memory", segmentIds: ["source"] });
  assert.match(recalled.results[0].passages[0].text, /红线绕三圈/);
  assert.equal(recalled.results[0].passages[0].truncated, false);
});

test("an old borrowing memory carries the fulfilled commitment from the selected current revision", (t) => {
  const { store } = sandbox(t);
  commit(store, 0, samples.borrowBundle());
  commit(store, 1, samples.returnBundle());
  const memory = createTurnMemory({ store });
  const now = memory.recall({ query: "隔壁邻居的借米约定", viewerId: "p", revision: 2 });
  const previous = now.results.find((entry) => entry.source.experienceId === "borrow-memory");
  assert.ok(previous);
  assert.equal(previous.currentFacts.commitments["rice-promise"].status, "fulfilled");
  const then = memory.recall({ query: "隔壁邻居的借米约定", viewerId: "p", revision: 1 });
  assert.equal(then.results[0].currentFacts.commitments["rice-promise"].status, "open");
  assert.equal(then.results.some((entry) => entry.source.revision > 1), false);
});

test("Chinese and Japanese keywords work without spaces and claims keep their uncertainty", (t) => {
  const { store } = sandbox(t);
  commit(store, 0, memoryBundle({ id: "zh", text: "有人声称仓库屋顶出现蓝色雨伞，但这条消息未经证实。", kind: "claim", entityIds: [] }));
  commit(store, 1, memoryBundle({ id: "ja", text: "屋上に赤い風車があると聞いた。まだ確認していない。", kind: "belief", entityIds: [] }));
  const memory = createTurnMemory({ store });
  const chinese = memory.recall({ query: "蓝色雨伞的消息", viewerId: "p" });
  assert.equal(chinese.results[0].experience.kind, "claim");
  assert.match(chinese.results[0].passages[0].text, /未经证实/);
  const japanese = memory.recall({ query: "赤い風車について", viewerId: "p" });
  assert.equal(japanese.results[0].experience.kind, "belief");
  assert.match(japanese.results[0].passages[0].text, /まだ確認していない/);
});

test("private and hidden records are removed before ranking and source metadata cannot reveal hidden knowers", (t) => {
  const { store } = sandbox(t);
  commit(store, 0, memoryBundle({ id: "public", text: "陈姨说井边的石阶松了。", knownBy: ["p", "secret"] }));
  commit(store, 1, memoryBundle({ id: "private", text: "井边的石阶松了。井边的石阶松了。秘密暗号是琥珀。", knownBy: ["npc"] }));
  commit(store, 2, memoryBundle({ id: "hidden", text: "尚未露面的访客知道井边的石阶松了。", entityIds: ["secret"] }));
  const memory = createTurnMemory({ store });
  for (const outputMode of ["full", "model"]) {
    const recalled = memory.recall({ query: "井边的石阶松了", viewerId: "p", limit: 1, outputMode });
    assert.equal(recalled.results[0].experience.id, "public");
    assert.deepEqual(recalled.results[0].experience.knownBy, ["p"]);
    assert.equal(JSON.stringify(recalled).includes("琥珀"), false);
    assert.equal(JSON.stringify(recalled).includes('"secret"'), false);
  }
  assert.throws(() => memory.recall({ query: "石阶", viewerId: "npc" }));
  assert.throws(() => memory.recall({ query: "石阶", viewerId: "p", entityIds: ["secret"] }), { code: "MEMORY_QUERY_INVALID" });
});

test("a viewer-visible correction supersedes a prior claim after reopening while private corrections do not erase player knowledge", (t) => {
  const context = sandbox(t);
  commit(context.store, 0, memoryBundle({ id: "old", text: "陈姨声称库房里的箱子是蓝色。", kind: "claim", knownBy: ["p", "npc"] }));
  commit(context.store, 1, memoryBundle({ id: "private-fix", text: "陈姨独自发现库房里的箱子是黑色。", knownBy: ["npc"], supersedes: [{ revision: 1, experienceId: "old" }] }));
  let memory = createTurnMemory({ store: context.store });
  const beforePublicCorrection = memory.recall({ query: "陈姨的库房箱子", viewerId: "p" });
  assert.equal(beforePublicCorrection.results.some((entry) => entry.source.experienceId === "old"), true);
  assert.equal(beforePublicCorrection.results.some((entry) => entry.source.experienceId === "private-fix"), false);
  commit(context.store, 2, memoryBundle({ id: "public-fix", text: "陈姨公开纠正此前说法：库房里的箱子是黑色。", supersedes: [{ revision: 1, experienceId: "old" }] }));
  context.store.close();
  const reopened = context.open();
  memory = createTurnMemory({ store: reopened });
  const corrected = memory.recall({ query: "陈姨的库房箱子", viewerId: "p" });
  assert.deepEqual(corrected.results.map((entry) => entry.source.experienceId), ["public-fix"]);
  assert.match(corrected.results[0].experience.text, /黑色/);
  assert.match(reopened.readTurn(1).experiences[0].text, /蓝色/);
  assert.equal(memory.recall({ query: "库房箱子", viewerId: "p", revision: 1 }).results[0].source.experienceId, "old");
  const model = memory.recall({ query: "陈姨的库房箱子", viewerId: "p", outputMode: "model" });
  assert.deepEqual(model.results.map((entry) => entry.source), corrected.results.map((entry) => entry.source));
  assert.deepEqual(model.results[0].experience.supersedes, [{ revision: 1, experienceId: "old" }]);
  assert.equal(memory.recall({ query: "库房箱子", viewerId: "p", revision: 1, outputMode: "model" }).results[0].source.experienceId, "old");
});

test("a correction that references a hidden entity cannot erase the player's still-readable earlier memory", (t) => {
  const { store } = sandbox(t);
  commit(store, 0, memoryBundle({ id: "old-visible", text: "陈姨说通行暗号是白鹭。", kind: "claim" }));
  commit(store, 1, memoryBundle({ id: "hidden-correction", text: "尚未露面的访客纠正通行暗号为夜莺。",
    entityIds: ["secret"], knownBy: ["p"], supersedes: [{ revision: 1, experienceId: "old-visible" }] }));
  const memory = createTurnMemory({ store });
  const recalled = memory.recall({ query: "通行暗号", viewerId: "p" });
  assert.deepEqual(recalled.results.map((entry) => entry.source.experienceId), ["old-visible"]);
  assert.match(recalled.results[0].experience.text, /白鹭/);
  assert.equal(JSON.stringify(recalled).includes("夜莺"), false);
  // When that character becomes player-visible, the same formal correction
  // becomes readable; an older revision must still retain its earlier view.
  commit(store, 2, { narration: [{ id: "reveal", text: "访客现身向你介绍自己。" }],
    events: [{ id: "reveal-visitor", type: "entity.update", sourceSegmentIds: ["reveal"], data: { id: "secret", visibility: "player" } }], experiences: [] });
  const revealed = memory.recall({ query: "通行暗号", viewerId: "p" });
  assert.deepEqual(revealed.results.map((entry) => entry.source.experienceId), ["hidden-correction"]);
  assert.equal(memory.recall({ query: "通行暗号", viewerId: "p", revision: 2 }).results[0].source.experienceId, "old-visible");
});

test("two adventures cannot supply one another's experiences even when IDs coincide", (t) => {
  const first = sandbox(t, { adventureId: "first" });
  const second = sandbox(t, { adventureId: "second" });
  commit(first.store, 0, memoryBundle({ text: "陈姨留下的暗号是白鹭。" }));
  commit(second.store, 0, memoryBundle({ text: "陈姨留下的暗号是夜莺。" }));
  const recalled = createTurnMemory({ store: first.store }).recall({ query: "隔壁邻居", viewerId: "p" });
  assert.equal(recalled.results[0].source.adventureId, "first");
  assert.equal(JSON.stringify(recalled).includes("夜莺"), false);
  assert.equal(JSON.stringify(recalled).includes("白鹭"), true);
});

test("scanning and response budgets are explicit and oversized facts do not discard a source", (t) => {
  const state = samples.initialState();
  state.entities.npc.attributes.description = "长篇外貌说明。".repeat(1500);
  const { store } = sandbox(t, { state });
  for (let revision = 0; revision < 5; revision += 1) {
    commit(store, revision, memoryBundle({ id: `memory-${revision}`, text: `陈姨第${revision}次提到石阶。`, narration: "天气平静。".repeat(1000) + "陈姨提到石阶。" }));
  }
  const scanned = createTurnMemory({ store, maxScannedRecords: 2 }).recall({ query: "隔壁邻居", viewerId: "p", maxCharacters: 2000 });
  assert.equal(scanned.truncated, true);
  assert.ok(scanned.results.length >= 1);
  assert.ok(JSON.stringify(scanned).length <= 2000);
  assert.equal(scanned.results[0].source.adventureId, "memory-adventure");
  assert.ok(scanned.results[0].currentFacts.omitted.entities >= 1);
  assert.equal(scanned.results[0].passages[0].truncated, true);
  const minimum = createTurnMemory({ store }).recall({ query: "隔壁邻居", viewerId: "p", maxCharacters: 256 });
  assert.equal(minimum.truncated, true);
  assert.ok(JSON.stringify(minimum).length <= 256);
});

test("legacy synopsis-only words cannot admit or improve a record while full recall preserves the stored audit text", (t) => {
  const { store } = sandbox(t);
  const synopsis = "phantomorchid ".repeat(30) + "你已空着手出门。";
  commit(store, 0, memoryBundle({ id: "unsupported-index", text: synopsis,
    narration: "你把杯子放在屋内的台上，仍留在门内。" }), "我把杯子放下，先留在屋内。" );
  const memory = createTurnMemory({ store });
  for (const outputMode of ["full", "model"]) for (const order of ["relevance", "earliest", "latest"]) {
    assert.deepEqual(memory.recall({ query: "phantomorchid", entityIds: ["p", "npc", "home"],
      viewerId: "p", revision: 1, order, outputMode }).results, []);
  }
  commit(store, 1, memoryBundle({ id: "original-word", text: "门内。",
    narration: "门内的纸签只写着 phantomorchid，你还不知道它指什么。" }), "我看纸签。" );
  for (const outputMode of ["full", "model"]) {
    const recalled = memory.recall({ query: "phantomorchid", viewerId: "p", outputMode });
    assert.deepEqual(recalled.results.map((entry) => entry.source.experienceId), ["original-word"]);
  }
  const audit = memory.recall({ query: "门内", viewerId: "p", revision: 1 });
  assert.equal(audit.results[0].experience.text, synopsis);
  assert.equal(store.readTurn(1).experiences[0].text, synopsis);
});

test("source-only experiences survive reopening and old-context exit with input, corrections, privacy and bounded originals intact", (t) => {
  const context = sandbox(t);
  commit(context.store, 0, memoryBundle({ id: "old", text: "旧概括：石阶已经断了。",
    narration: "你听人说石阶断了，还没有亲眼确认。", kind: "claim" }));
  commit(context.store, 1, memoryBundle({ id: "private-fix", narration: "陈姨独自看见石阶完整，旁边写着 sablemarker。",
    knownBy: ["npc"], supersedes: [{ revision: 1, experienceId: "old" }] }));
  const original = "石阶完整，松动的是旁边的木板。" + '雨水打在牌面“🪶”上。\n'.repeat(180) + "木板底下的情况还没看清。";
  const input = "我试着看清 quartzsignal 标记下面的情况；看不清就停下。";
  commit(context.store, 2, memoryBundle({ id: "public-fix", narration: original, knownBy: ["p", "secret"],
    supersedes: [{ revision: 1, experienceId: "old" }] }), input);
  commit(context.store, 3, memoryBundle({ id: "hidden", narration: "sablemarker 是访客独知的石阶记号。", entityIds: ["secret"] }));
  for (let revision = 4; revision < 16; revision++) commit(context.store, revision,
    { narration: [{ id: "wait", text: "你沿着走廊继续向前，没有新的发现。" }], events: [], experiences: [] });
  const before = context.store.readTurn(3);
  const database = new DatabaseSync(context.databasePath, { readOnly: true });
  const storedRows = () => database.prepare("SELECT body_json FROM experiences ORDER BY rowid").all();
  t.after(() => database.close());
  const originalRows = storedRows();
  assert.equal(Object.hasOwn(before.experiences[0], "text"), false);
  context.store.close();
  const store = context.open(), memory = createTurnMemory({ store });
  for (const outputMode of ["full", "model"]) {
    const fixedPast = memory.recall({ query: "石阶", viewerId: "p", revision: 2, outputMode });
    assert.deepEqual(fixedPast.results.map((entry) => entry.source.experienceId), ["old"]);
    const complete = memory.recall({ query: "石阶", viewerId: "p", revision: 16, maxCharacters: 6400, outputMode });
    assert.deepEqual(complete.results.map((entry) => entry.source.experienceId), ["public-fix"]);
    assert.equal(complete.results[0].passages[0].text, original);
    assert.equal(complete.results[0].playerInput.text, input);
    assert.deepEqual(complete.results[0].experience.supersedes, [{ revision: 1, experienceId: "old" }]);
    assert.deepEqual(complete.results[0].experience.knownBy, ["p"]);
    assert.deepEqual(memory.recall({ query: "sablemarker", viewerId: "p", revision: 16, outputMode }).results, []);
    const inputOnly = memory.recall({ query: "quartzsignal", viewerId: "p", revision: 16, outputMode });
    assert.deepEqual(inputOnly.results.map((entry) => entry.source.experienceId), ["public-fix"]);
    for (const maxCharacters of [256, 800, 1800]) {
      const packet = memory.recall({ query: "石阶", viewerId: "p", revision: 16, maxCharacters, outputMode });
      assert.ok(JSON.stringify(packet).length <= maxCharacters);
      assert.equal(packet.truncated, true);
      if (maxCharacters === 1800) assert.equal(packet.results.length, 1);
      for (const result of packet.results) {
        for (const field of ["text", "textRange", "textTruncated"]) assert.equal(Object.hasOwn(result.experience, field), false);
        for (const passage of result.passages) assert.equal(passage.text, original.slice(passage.start, passage.end));
        if (result.playerInput) assert.equal(result.playerInput.text, input.slice(result.playerInput.start, result.playerInput.end));
      }
    }
  }
  assert.deepEqual(store.readTurn(3), before);
  assert.deepEqual(storedRows(), originalRows, "recall and restart do not rewrite either legacy or source-only rows");
});

test("model packets spend their unchanged budget on originals while full recall preserves legacy synopses for audit", (t) => {
  const state = samples.initialState();
  state.entities.npc.attributes.description = "当前人物自由描述。".repeat(300);
  const { store } = sandbox(t, { state });
  const synopsis = "index-selection-copper " + "供内部检索使用的概括。".repeat(180);
  const original = "陈姨停顿了一下：" + "情况仍待确认。".repeat(150) + "我也记不清，别当成确定的事。";
  commit(store, 0, memoryBundle({ text: synopsis, narration: original, kind: "claim", knownBy: ["p", "secret"] }));
  const before = store.readModelState({ revision: 1 }), originalTurn = store.readTurn(1);
  const memory = createTurnMemory({ store });
  const query = { query: "情况仍待确认", viewerId: "p", revision: 1, maxCharacters: 1800 };
  const full = memory.recall(query), model = memory.recall({ ...query, outputMode: "model" });
  assert.equal(full.results.length, 1);
  assert.equal(model.results.length, 1);
  assert.deepEqual(model.results[0].source, full.results[0].source);
  assert.equal(full.results[0].passages[0].truncated, true);
  assert.equal(model.results[0].passages[0].text, original);
  assert.equal(model.results[0].passages[0].truncated, false);
  assert.equal(model.results[0].experience.kind, "claim");
  assert.deepEqual(model.results[0].experience.knownBy, ["p"]);
  assert.equal(Object.hasOwn(model.results[0], "currentFacts"), false);
  assert.equal(Object.hasOwn(model.results[0].experience, "text"), false);
  assert.doesNotMatch(JSON.stringify(model), /index-selection-copper|当前人物自由描述|textRange|textTruncated|secret/);
  assert.ok(JSON.stringify(full).length <= 1800);
  assert.ok(JSON.stringify(model).length <= 1800);
  const complete = memory.recall({ ...query, maxCharacters: 16000 });
  assert.equal(complete.results[0].experience.text, synopsis);
  assert.deepEqual(complete.results[0].currentFacts.entities.npc, before.entities.npc);
  assert.deepEqual(memory.recall(query), full, "model projection must not mutate the default reader");
  assert.deepEqual(store.readModelState({ revision: 1 }), before);
  assert.deepEqual(store.readTurn(1), originalTurn);
  const tiny = memory.recall({ ...query, outputMode: "model", maxCharacters: 256 });
  assert.deepEqual(tiny.results, [], "do not fill a small model packet with metadata-only records");
  assert.equal(tiny.truncated, true);
  assert.throws(() => memory.recall({ ...query, outputMode: "arbitrary" }), { code: "MEMORY_QUERY_INVALID" });
});

test("hidden and superseded candidates count toward the scan limit even when they produce an empty page", (t) => {
  for (const mode of ["hidden", "superseded"]) {
    const { store } = sandbox(t);
    for (let revision = 0; revision < 10; revision += 1) {
      commit(store, revision, memoryBundle({ id: `entry-${revision}`, text: `陈姨提到通行暗号第${revision}个版本。`,
        entityIds: mode === "hidden" && revision < 9 ? ["secret"] : ["npc"],
        ...(mode === "superseded" && revision > 0 ? { supersedes: [{ revision, experienceId: `entry-${revision - 1}` }] } : {}) }));
    }
    let calls = 0, scanned = 0;
    const counted = { ...store, listExperienceRecords(options) {
      calls += 1;
      assert.ok(options.limit >= 1 && options.limit <= 2);
      const page = store.listExperienceRecords(options);
      assert.equal(page.records.length, 0);
      assert.equal(page.scannedRecords, options.limit);
      scanned += page.scannedRecords;
      assert.ok(scanned <= 2, "filtered candidates still consume the shared allowance");
      assert.notEqual(page.nextCursor, null);
      return page;
    } };
    const limited = createTurnMemory({ store: counted, maxScannedRecords: 2 }).recall({ query: "通行暗号", viewerId: "p" });
    assert.ok(calls >= 1 && calls <= 2); assert.equal(scanned, 2);
    assert.deepEqual(limited.results, []);
    assert.equal(limited.truncated, true);
    const sufficient = createTurnMemory({ store, maxScannedRecords: 12 }).recall({ query: "通行暗号", viewerId: "p" });
    assert.deepEqual(sufficient.results.map((entry) => entry.source.experienceId), ["entry-9"]);
  }
});

test("paging pins the state revision even when another action commits between pages", (t) => {
  const { store } = sandbox(t);
  for (let revision = 0; revision < 35; revision += 1) commit(store, revision, memoryBundle({ id: `history-${revision}`, text: `陈姨提到第${revision}扇窗。` }));
  let pageCount = 0;
  const connection = { ...store, listExperienceRecords(options) {
    const page = store.listExperienceRecords(options);
    pageCount += 1;
    if (pageCount === 1) commit(store, 35, memoryBundle({ id: "future", text: "陈姨说未来暗号是翠鸟。" }));
    return page;
  } };
  const recalled = createTurnMemory({ store: connection }).recall({ query: "隔壁邻居", viewerId: "p" });
  assert.ok(pageCount > 1);
  assert.equal(recalled.revision, 35);
  assert.equal(recalled.results.some((entry) => entry.source.revision > 35), false);
  assert.equal(JSON.stringify(recalled).includes("翠鸟"), false);
});

test("missing original evidence is reported rather than silently replaced with experience text", (t) => {
  const { store, databasePath } = sandbox(t);
  commit(store, 0, memoryBundle({ text: "陈姨提到井边的石阶松了。" }));
  // Simulate corruption only in this disposable database. The experience text
  // survives, but it must not be misrepresented as the missing original source.
  const database = new DatabaseSync(databasePath);
  try { database.prepare("UPDATE turns SET narration_json='[]' WHERE revision=1").run(); }
  finally { database.close(); }
  assert.throws(() => createTurnMemory({ store }).recall({ query: "石阶", viewerId: "p" }), { code: "MEMORY_SOURCE_UNAVAILABLE" });
});

test("unindexed story paragraphs remain searchable after reopening without inventing experience metadata", (t) => {
  const context = sandbox(t);
  const original = "窗边传来两声铜哨，但你听不出方向，也不能确定是不是人在吹。";
  const input = "我停下听，不把声音当作有人求救。";
  commit(context.store, 0, { narration: [{ id: "sound", text: original }], events: [], experiences: [] }, input);
  commit(context.store, 1, memoryBundle({ id: "ordinary", narration: "你坐到椅子上。" }));
  const before = context.store.readModelState(); context.store.close();
  const store = context.open(), memory = createTurnMemory({ store });
  for (const outputMode of ["full", "model"]) {
    const packet = memory.recall({ query: "铜哨", viewerId: "p", revision: 2, outputMode });
    assert.equal(packet.results.length, 1);
    const record = packet.results[0];
    assert.equal(record.recordType, "story_source");
    assert.deepEqual(record.source, { adventureId: "memory-adventure", revision: 1, actionId: "action-1", segmentIds: ["sound"] });
    assert.equal(Object.hasOwn(record, "experience"), false);
    assert.equal(Object.hasOwn(record, "currentFacts"), false);
    assert.deepEqual(record.passages, [{ id: "sound", text: original, start: 0, end: original.length, truncated: false }]);
    assert.deepEqual(record.playerInput, { kind: "player_input", text: input, start: 0, end: input.length, truncated: false });
    assert.equal(packet.truncated, false);
  }
  assert.deepEqual(store.readModelState(), before);
});

test("unindexed supplementation neither repeats indexed paragraphs nor revives excluded mixed-turn input", (t) => {
  const { store } = sandbox(t);
  const mixed = (knownBy, id) => ({
    narration: [{ id: "indexed", text: "铜哨旧说法仍有疑问。" }, { id: "loose", text: "铜哨旁边放着折好的布。" }],
    events: [], experiences: [{ id, kind: "claim", entityIds: ["npc"], knownBy, eventIds: [], sourceSegmentIds: ["indexed"] }],
  });
  commit(store, 0, mixed(["p"], "public"));
  commit(store, 1, mixed(["npc"], "private"), "PRIVATE_INPUT 铜哨");
  const memory = createTurnMemory({ store });
  let packet = memory.recall({ query: "铜哨", viewerId: "p", revision: 2, outputMode: "model" });
  assert.equal(packet.results.length, 2);
  assert.deepEqual(packet.results.flatMap(record => record.passages.map(p => p.id)).sort(), ["indexed", "loose"]);
  assert.doesNotMatch(JSON.stringify(packet), /PRIVATE_INPUT|action-2/);
  commit(store, 2, memoryBundle({ id: "correction", narration: "此前那段关于铜哨的说法收回。",
    kind: "claim", supersedes: [{ revision: 1, experienceId: "public" }] }));
  packet = memory.recall({ query: "铜哨", viewerId: "p", revision: 3, outputMode: "model", beforeRevision: 3 });
  assert.deepEqual(packet.results, [], "the unindexed neighbor must not reintroduce an excluded source turn");
});

test("source filters reach late indexed and unindexed passages inside the existing scan budget", (t) => {
  const { store } = sandbox(t);
  for (let r = 0; r < 5; r++) commit(store, r, memoryBundle({ id: `old-${r}`, narration: "你观察雨中的窗户。" }));
  commit(store, 5, memoryBundle({ id: "late", narration: "铜哨响了一声。" }));
  commit(store, 6, { narration: [{ id: "later", text: "铜哨隔了片刻又响了一声。" }], events: [], experiences: [] });
  const memory = createTurnMemory({ store, maxScannedRecords: 2 });
  const packet = memory.recall({ query: "铜哨", viewerId: "p", revision: 7, afterRevision: 5, outputMode: "model" });
  assert.deepEqual(packet.results.map(record => record.source.revision), [7, 6]);
  assert.equal(packet.truncated, false);
  assert.equal(packet.results[0].recordType, "story_source");
  assert.equal(packet.results[1].source.experienceId, "late");
});

test("large unindexed original sources retain exact bounded excerpts instead of fabricated summaries", (t) => {
  const { store } = sandbox(t);
  const original = "雨声断断续续。".repeat(1100) + "铜哨也可能是窗框摩擦的声音，不能确认。";
  commit(store, 0, { narration: [{ id: "long", text: original }], events: [], experiences: [] }, "我只是停下来听。" );
  const packet = createTurnMemory({ store }).recall({ query: "铜哨", viewerId: "p", revision: 1, maxCharacters: 900, outputMode: "model" });
  assert.equal(packet.results.length, 1);
  assert.ok(JSON.stringify(packet).length <= 900); assert.equal(packet.truncated, true);
  const passage = packet.results[0].passages[0];
  assert.equal(passage.text, original.slice(passage.start, passage.end));
  assert.equal(passage.truncated, true); assert.match(passage.text, /铜哨/);
  assert.equal(Object.hasOwn(packet.results[0], "experience"), false);
});

test("a small shared scan allowance gives both indexed and unindexed sources an opportunity", (t) => {
  const { store } = sandbox(t);
  commit(store, 0, { narration: [{ id: "indexed", text: "雨落在窗台上。" }, { id: "unindexed", text: "铜哨响了两声。" }],
    events: [], experiences: Array.from({ length: 32 }, (_, i) => ({ id: `rain-${i}`, kind: "event", entityIds: ["p"], knownBy: ["p"], eventIds: [], sourceSegmentIds: ["indexed"] })) });
  const memory = createTurnMemory({ store, maxScannedRecords: 2 });
  const packet = memory.recall({ query: "铜哨", viewerId: "p", revision: 1, outputMode: "model" });
  assert.equal(packet.results.length, 1);
  assert.equal(packet.results[0].recordType, "story_source");
  assert.equal(packet.results[0].passages[0].text, "铜哨响了两声。");
  assert.equal(packet.truncated, true, "the indexed remainder is still unscanned");
});
