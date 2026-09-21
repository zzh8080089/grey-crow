"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { createTurnStore } = require("./turn-store");
const { createOpeningState } = require("./session-opening");
const { CHAPTER_LIMITS } = require("./session-chapter-store");
const samples = require("./test-fixtures/turn-samples");

function sandbox(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-chapter-store-"));
  const stores = [];
  t.after(() => {
    for (const store of stores.reverse()) store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, databasePath: path.join(directory, "adventure.sqlite"),
    open(options = {}) {
      const store = createTurnStore({ ...samples.identity(this.databasePath), ...options });
      stores.push(store);
      return store;
    } };
}

function code(expected) { return (error) => error.code === expected; }

function turn(store, revision, bundle = { narration: [{ id: `passage-${revision}`, text: `第 ${revision} 轮：你听见走廊里的脚步声。` }], events: [], experiences: [] }) {
  const action = store.beginAction(samples.request({ actionId: `action-${revision}`, baseRevision: revision - 1, input: `观察第 ${revision} 轮` }));
  try { store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle }); }
  catch (error) { if (error.code !== "HISTORY_PAGE_TOO_LARGE") throw error; }
  assert.equal(store.readAction(action.actionId).status, "committed");
}

function candidate(revision, segmentId = `passage-${revision}`) {
  return { title: "楼道往事", summary: "你留意了楼道中的声响。",
    keyEvents: [{ text: "楼道里有脚步声。", sources: [{ revision, segmentId }] }],
    openThreads: [], mode: "model" };
}

function commit(store, job, chapter = candidate(job.toRevision)) {
  return store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter });
}

test("章节与同范围保存可读回，正文、事实和故事版本不变", (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  turn(store, 1, samples.borrowBundle());
  const originalView = store.readView();
  const originalState = store.readModelState();
  const job = store.beginChapter({ targetRevision: 1 });
  assert.equal(job.started, true);
  assert.equal(job.chapterId, "chapter-1");
  assert.deepEqual([job.fromRevision, job.toRevision], [1, 1]);
  const chapter = candidate(1, "borrow-text");
  chapter.openThreads = [{ text: "你答应明天归还借来的米。", sources: [{ revision: 1, segmentId: "borrow-text" }] }];
  const result = commit(store, job, chapter);
  assert.equal(result.status, "committed");
  assert.match(result.chapter.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(result.chapter.keyEvents, chapter.keyEvents);
  chapter.keyEvents[0].text = "调用者后来修改";
  result.chapter.openThreads.length = 0;
  assert.equal(store.readChapterJob(job.chapterId).chapter.openThreads.length, 1);
  const repeated = store.beginChapter({ targetRevision: 1, retry: true });
  assert.equal(repeated.status, "unchanged");
  assert.equal(repeated.started, false);
  assert.equal(repeated.attemptId, job.attemptId);
  assert.deepEqual(commit(store, job, {}), store.readChapterJob(job.chapterId));
  assert.deepEqual(store.readView(), originalView);
  assert.deepEqual(store.readModelState(), originalState);
  assert.deepEqual(store.readPlayerState(), { adventureId: "test-adventure", locale: "zh-CN", contentVersion: "test-v1", revision: 1,
    state: originalView.state, timeline: { storyTurnCount: 1, systemRevisions: [] }, continuation: null });
});

test("没有新故事不建立章任务，草稿与未确认摘要不能归章；确认所在轮是首个来源", (t) => {
  const context = sandbox(t);
  const empty = context.open({ initialState: samples.initialState() });
  assert.deepEqual(empty.beginChapter({ targetRevision: 0 }), {
    adventureId: "test-adventure", chapterId: null, attemptId: null, status: "unchanged", started: false, fromRevision: 1, toRevision: 0,
  });
  empty.close();
  context.databasePath = path.join(context.directory, "opening.sqlite");
  const store = context.open({ initialState: createOpeningState({ day: 10 }) });
  assert.throws(() => store.beginChapter({ targetRevision: 0 }), code("CHAPTER_NOT_READY"));
  turn(store, 1, { narration: [{ id: "summary", text: "你将从楼道开始。确认这个开局吗？" }],
    events: [{ id: "propose", type: "opening.propose", sourceSegmentIds: ["summary"],
      data: { proposalId: "role-one", initialState: samples.initialState() } }], experiences: [] });
  assert.throws(() => store.beginChapter({ targetRevision: 1 }), code("CHAPTER_NOT_READY"));
  turn(store, 2, { narration: [{ id: "first-scene", text: "你站在楼道里，听见门后传来的动静。" }],
    events: [{ id: "confirm", type: "opening.confirm", sourceSegmentIds: ["first-scene"], data: { proposalId: "role-one" } }], experiences: [] });
  const job = store.beginChapter({ targetRevision: 2 });
  assert.deepEqual([job.fromRevision, job.toRevision], [2, 2]);
  const page = store.readChapterSource(jobArgs(job));
  assert.deepEqual(page.turns.map((item) => item.revision), [2]);
  assert.doesNotMatch(JSON.stringify(page), /role-one|initialState|未发现的钥匙|尚未露面的访客|确认这个开局/);
  assert.throws(() => commit(store, job, candidate(1, "summary")), code("CHAPTER_VALIDATION_FAILED"));
  commit(store, job, candidate(2, "first-scene"));
  assert.equal(store.readChapters({ revision: 1 }).chapters.length, 0);
});

function jobArgs(job) { return { chapterId: job.chapterId, attemptId: job.attemptId }; }

test("章节地点锚点取各轮前版，分页和后续改名不能把旧门槛移到章末地点", (t) => {
  const context = sandbox(t);
  const initial = samples.initialState();
  initial.entities.second = { id: "second", kind: "location", name: "拐角后的第二道门", aliases: [],
    visibility: "player", attributes: { description: "不应进入地点锚点的自由描述" } };
  initial.situation.locationId = "second";
  const store = context.open({ initialState: initial });
  turn(store, 1, { narration: [{ id: "reply", text: "你在门槛前说完话。" }, { id: "leave", text: "你绕过拐角，回到了楼道。" }],
    events: [{ id: "go-home", type: "situation.update", sourceSegmentIds: ["leave"], data: { locationId: "home" } }], experiences: [] });
  turn(store, 2, { narration: [{ id: "return", text: "你又走回第二道门，并得知这里叫旧车库。" }],
    events: [{ id: "go-back", type: "situation.update", sourceSegmentIds: ["return"], data: { locationId: "second" } },
      { id: "rename", type: "entity.update", sourceSegmentIds: ["return"], data: { id: "second", name: "旧车库" } }], experiences: [] });
  const job = store.beginChapter({ targetRevision: 2 });
  turn(store, 3);
  const first = store.readChapterSource({ ...jobArgs(job), limit: 1 });
  const second = store.readChapterSource({ ...jobArgs(job), cursor: first.nextCursor, limit: 1 });
  assert.deepEqual(first.turns[0].turnStart, { source: { adventureId: "test-adventure", revision: 0 },
    location: { id: "second", name: "拐角后的第二道门" } });
  assert.deepEqual(second.turns[0].turnStart, { source: { adventureId: "test-adventure", revision: 1 },
    location: { id: "home", name: "楼道" } });
  assert.equal(second.complete, true);
  assert.equal(store.readPlayerState({ revision: 2 }).state.situation.locationId, "second");
  assert.doesNotMatch(JSON.stringify([first, second]), /不应进入地点锚点的自由描述/);
  const before = JSON.stringify(store.readTurn(1));
  store.close();
  const reopened = context.open();
  assert.deepEqual(reopened.readChapterSource({ ...jobArgs(job), limit: 1 }).turns, first.turns);
  assert.equal(JSON.stringify(reopened.readTurn(1)), before);
});

test("未公开的轮初地点保持未知，不泄露隐藏名称或使用后来的公开地点补齐", (t) => {
  const initial = samples.initialState();
  initial.entities.home.visibility = "hidden";
  initial.entities.home.name = "尚未公开的秘密房间";
  const store = sandbox(t).open({ initialState: initial });
  turn(store, 1, { narration: [{ id: "reveal", text: "你留在原地，终于知道了这个房间的位置。" }],
    events: [{ id: "reveal-location", type: "entity.update", sourceSegmentIds: ["reveal"],
      data: { id: "home", visibility: "player", name: "当前公开的房间" } }], experiences: [] });
  const page = store.readChapterSource(jobArgs(store.beginChapter({ targetRevision: 1 })));
  assert.deepEqual(page.turns[0].turnStart, { source: { adventureId: "test-adventure", revision: 0 }, location: null });
  assert.doesNotMatch(JSON.stringify(page), /尚未公开的秘密房间|当前公开的房间/);
});

test("章节生成期间故事可以继续，固定区间不混入随后提交；跨目标不能并发归章", (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  for (let revision = 1; revision <= 3; revision += 1) turn(store, revision);
  const job = store.beginChapter({ targetRevision: 2 });
  turn(store, 4);
  assert.equal(store.beginChapter({ targetRevision: 2 }).started, false);
  assert.throws(() => store.beginChapter({ targetRevision: 4 }), code("CHAPTER_BUSY"));
  assert.deepEqual(store.readChapterSource(jobArgs(job)).turns.map((item) => item.revision), [1, 2]);
  commit(store, job);
  assert.equal(store.beginChapter({ targetRevision: 1 }).status, "unchanged");
  const next = store.beginChapter({ targetRevision: 4 });
  assert.deepEqual([next.fromRevision, next.toRevision], [3, 4]);
  commit(store, next);
  assert.deepEqual(store.readChapters({ revision: 3 }).chapters.map((item) => item.toRevision), [2]);
  assert.equal(store.readView().revision, 4);
});

test("显式重试重算未覆盖范围并使旧尝试和旧游标失效", (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  for (let revision = 1; revision <= 4; revision += 1) turn(store, revision);
  const old = store.beginChapter({ targetRevision: 4 });
  const cursor = store.readChapterSource({ ...jobArgs(old), limit: 1 }).nextCursor;
  const failed = store.failChapter({ ...jobArgs(old), code: "CHAPTER_MODEL_FAILED" });
  assert.deepEqual(failed.error, { code: "CHAPTER_MODEL_FAILED", retryable: true });
  assert.equal(store.beginChapter({ targetRevision: 4 }).started, false);
  commit(store, store.beginChapter({ targetRevision: 2 }));
  const retry = store.beginChapter({ targetRevision: 4, retry: true });
  assert.equal(retry.chapterId, old.chapterId);
  assert.notEqual(retry.attemptId, old.attemptId);
  assert.deepEqual([retry.fromRevision, retry.toRevision], [3, 4]);
  assert.throws(() => commit(store, old), code("CHAPTER_ATTEMPT_STALE"));
  assert.throws(() => store.readChapterSource(jobArgs(old)), code("CHAPTER_ATTEMPT_STALE"));
  assert.throws(() => store.readChapterSource({ ...jobArgs(retry), cursor }), code("CHAPTER_CURSOR_MISMATCH"));
  assert.throws(() => store.failChapter({ ...jobArgs(old), code: "CHAPTER_INTERRUPTED" }), code("CHAPTER_ATTEMPT_STALE"));
  commit(store, retry);
  assert.deepEqual(store.readChapters().chapters.map((item) => [item.fromRevision, item.toRevision]), [[1, 2], [3, 4]]);
});

test("非可重试失败不自动换尝试，活连接不能抢另一归档所有者", (t) => {
  const context = sandbox(t);
  const owner = context.open({ initialState: samples.initialState() });
  turn(owner, 1);
  const job = owner.beginChapter({ targetRevision: 1 });
  const other = context.open();
  assert.equal(other.readChapterJob(job.chapterId).status, "running");
  assert.equal(other.beginChapter({ targetRevision: 1, retry: true }).started, false);
  assert.throws(() => commit(other, job), code("CHAPTER_OWNER_MISMATCH"));
  assert.throws(() => other.failChapter({ ...jobArgs(job), code: "CHAPTER_INTERRUPTED" }), code("CHAPTER_OWNER_MISMATCH"));
  other.close();
  assert.equal(owner.readChapterJob(job.chapterId).status, "running");
  owner.failChapter({ ...jobArgs(job), code: "CHAPTER_SOURCE_UNAVAILABLE", retryable: false });
  const repeated = owner.beginChapter({ targetRevision: 1, retry: true });
  assert.equal(repeated.started, false);
  assert.equal(repeated.attemptId, job.attemptId);
});

test("关闭将未完成章节标为中断，重开只读，明确重试才换尝试", (t) => {
  const context = sandbox(t);
  let store = context.open({ initialState: samples.initialState() });
  turn(store, 1);
  const job = store.beginChapter({ targetRevision: 1 });
  store.close();
  store = context.open();
  assert.deepEqual(store.readChapterJob(job.chapterId).error, { code: "CHAPTER_INTERRUPTED", retryable: true });
  assert.equal(store.readChapterJob(job.chapterId).status, "interrupted");
  assert.equal(store.beginChapter({ targetRevision: 1 }).started, false);
  assert.throws(() => commit(store, job), code("CHAPTER_NOT_RUNNING"));
  const retry = store.beginChapter({ targetRevision: 1, retry: true });
  commit(store, retry);
  store.close();
  store = context.open();
  assert.equal(store.readChapterJob(job.chapterId).status, "committed");
  assert.equal(store.readChapters().chapters.length, 1);
});

for (const stage of ["after_chapter", "after_chapter_job", "after_chapter_commit"]) {
  test(`真实进程在 ${stage} 退出：章节正文和回执原子恢复`, (t) => {
    const context = sandbox(t);
    const initial = context.open({ initialState: samples.initialState() });
    turn(initial, 1);
    initial.close();
    const script = `const {createTurnStore}=require(${JSON.stringify(require.resolve("./turn-store"))});
      const store=createTurnStore({...${JSON.stringify(samples.identity(context.databasePath))},faultInjector(stage){if(stage===${JSON.stringify(stage)})process.exit(73)}});
      const job=store.beginChapter({targetRevision:1});
      store.commitChapter({chapterId:job.chapterId,attemptId:job.attemptId,chapter:${JSON.stringify(candidate(1))}});`;
    const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 73, child.stderr);
    const recovered = context.open();
    const committed = stage === "after_chapter_commit";
    assert.equal(recovered.readChapterJob("chapter-1").status, committed ? "committed" : "interrupted");
    assert.equal(recovered.readChapters().chapters.length, committed ? 1 : 0);
    assert.equal(recovered.readView().revision, 1);
    const retry = recovered.beginChapter({ targetRevision: 1, retry: true });
    assert.equal(retry.started, !committed);
    if (!committed) commit(recovered, retry);
    assert.equal(recovered.readChapters().chapters.length, 1);
  });
}

test("事务内异常回滚章与回执，提交后异常仍可精确读回且不重复写", (t) => {
  const context = sandbox(t);
  let failingStage = "after_chapter_job";
  const store = context.open({ initialState: samples.initialState(), faultInjector(stage) { if (stage === failingStage) throw new Error("synthetic failure"); } });
  turn(store, 1);
  const job = store.beginChapter({ targetRevision: 1 });
  assert.throws(() => commit(store, job), /synthetic failure/);
  assert.equal(store.readChapterJob(job.chapterId).status, "running");
  assert.equal(store.readChapters().chapters.length, 0);
  failingStage = "after_chapter_commit";
  assert.throws(() => commit(store, job), /synthetic failure/);
  assert.equal(store.readChapterJob(job.chapterId).status, "committed");
  assert.equal(commit(store, job).status, "committed");
  assert.equal(store.readChapters().chapters.length, 1);
});

test("来源引用只能指向本章的已提交段落，拒绝伪造、越界及非 JSON 候选", (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  for (let revision = 1; revision <= 3; revision += 1) turn(store, revision);
  commit(store, store.beginChapter({ targetRevision: 1 }));
  const job = store.beginChapter({ targetRevision: 2 });
  const invalid = [candidate(1), candidate(3), candidate(2, "hidden_key"), candidate(2, "missing-segment")];
  const duplicate = candidate(2); duplicate.keyEvents[0].sources.push({ revision: 2, segmentId: "passage-2" }); invalid.push(duplicate);
  const missing = candidate(2); missing.keyEvents[0].sources = []; invalid.push(missing);
  const extra = candidate(2); extra.state = samples.initialState(); invalid.push(extra);
  const length = candidate(2); length.summary = "x".repeat(CHAPTER_LIMITS.summaryCharacters + 1); invalid.push(length);
  const badMode = candidate(2); badMode.fallbackReason = "secret provider response"; invalid.push(badMode);
  const hiddenSource = candidate(2); hiddenSource.keyEvents[0].sources[0].entityId = "secret"; invalid.push(hiddenSource);
  const date = candidate(2); date.title = new Date(); invalid.push(date);
  const cycle = candidate(2); cycle.openThreads.push(cycle); invalid.push(cycle);
  const accessor = candidate(2); Object.defineProperty(accessor, "title", { enumerable: true, get() { throw new Error("must not execute"); } }); invalid.push(accessor);
  for (const chapter of invalid) assert.throws(() => commit(store, job, chapter), code("CHAPTER_VALIDATION_FAILED"));
  assert.equal(store.readChapters().chapters.length, 1);
  assert.equal(store.readChapterJob(job.chapterId).status, "running");
  const excerpt = candidate(2); excerpt.mode = "excerpt"; excerpt.fallbackReason = "CHAPTER_MODEL_UNAVAILABLE";
  commit(store, job, excerpt);
  assert.equal(store.readChapterJob(job.chapterId).chapter.fallbackReason, "CHAPTER_MODEL_UNAVAILABLE");
});

test("来源分页正序完整且身份绑定，较小页预算明确失败并可提高预算重读", (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  for (let revision = 1; revision <= 55; revision += 1) turn(store, revision);
  const job = store.beginChapter({ targetRevision: 55 });
  assert.throws(() => store.readChapterSource({ ...jobArgs(job), maxCharacters: 100 }), code("CHAPTER_SOURCE_TOO_LARGE"));
  const first = store.readChapterSource({ ...jobArgs(job), limit: 3, maxCharacters: 2000 });
  assert.equal(first.complete, false);
  assert.deepEqual(first.turns.map((item) => item.revision), [1, 2, 3]);
  for (const mutate of [(cursor) => { cursor.adventureId = "another-adventure"; }, (cursor) => { cursor.toRevision = 56; },
    (cursor) => { cursor.attemptId = "stale-attempt"; }, (cursor) => { cursor.nextRevision = 0; }]) {
    const cursor = structuredClone(first.nextCursor); mutate(cursor);
    assert.throws(() => store.readChapterSource({ ...jobArgs(job), cursor }), code("CHAPTER_CURSOR_MISMATCH"));
  }
  turn(store, 56);
  const all = [...first.turns];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = store.readChapterSource({ ...jobArgs(job), cursor, limit: 7 });
    all.push(...page.turns); cursor = page.nextCursor;
  }
  assert.deepEqual(all.map((item) => item.revision), Array.from({ length: 55 }, (_, index) => index + 1));
  assert.deepEqual(all.map((item) => item.narration[0].text), Array.from({ length: 55 }, (_, index) => `第 ${index + 1} 轮：你听见走廊里的脚步声。`));
  assert.doesNotMatch(JSON.stringify(all), /未发现的钥匙|尚未露面的访客/);
});

test("大单轮来源不受历史恢复预算误阻挡，玩家状态单独读取不带长正文", (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const narration = [...Array.from({ length: 24 }, (_, index) => ({ id: `long-${index}`, text: "长".repeat(100000) }))];
  turn(store, 1, { narration, events: [], experiences: [] });
  const job = store.beginChapter({ targetRevision: 1 });
  assert.throws(() => store.readView({ maxCharacters: 2000000 }), code("HISTORY_PAGE_TOO_LARGE"));
  assert.throws(() => store.readChapterSource(jobArgs(job)), code("CHAPTER_SOURCE_TOO_LARGE"));
  const page = store.readChapterSource({ ...jobArgs(job), maxCharacters: CHAPTER_LIMITS.sourceMaxCharacters });
  assert.equal(page.complete, true);
  assert.deepEqual(page.turns[0].narration, narration);
  const state = store.readPlayerState({ revision: 1 });
  assert.equal(state.revision, 1);
  assert.equal(state.narration, undefined);
  assert.equal(state.history, undefined);
  assert.doesNotMatch(JSON.stringify(state), /未发现的钥匙|尚未露面的访客/);
});

test("章节列表游标固定冒险、故事版本及首次可见最高章，不混入后补归章", (t) => {
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  for (let revision = 1; revision <= 5; revision += 1) turn(store, revision);
  for (let revision = 1; revision <= 3; revision += 1) commit(store, store.beginChapter({ targetRevision: revision }));
  const first = store.readChapters({ revision: 5, limit: 1 });
  assert.deepEqual(first.nextCursor, { adventureId: "test-adventure", revision: 5, afterToRevision: 1, throughToRevision: 3 });
  commit(store, store.beginChapter({ targetRevision: 4 }));
  commit(store, store.beginChapter({ targetRevision: 5 }));
  turn(store, 6);
  const rest = store.readChapters({ cursor: first.nextCursor });
  assert.equal(rest.revision, 5);
  assert.deepEqual(rest.chapters.map((item) => item.toRevision), [2, 3]);
  assert.equal(rest.complete, true);
  assert.deepEqual(store.readChapters({ revision: 5 }).chapters.map((item) => item.toRevision), [1, 2, 3, 4, 5]);
  assert.deepEqual(store.readChapters({ revision: 2 }).chapters.map((item) => item.toRevision), [1, 2]);
  assert.throws(() => store.readChapters({ cursor: first.nextCursor, revision: 6 }), code("CHAPTER_CURSOR_MISMATCH"));
  assert.throws(() => store.readChapters({ cursor: { ...first.nextCursor, adventureId: "another-adventure" } }), code("CHAPTER_CURSOR_MISMATCH"));
  assert.throws(() => store.readChapters({ cursor: 1 }), code("CHAPTER_INPUT_INVALID"));
});

test("原有无章节表的 session 存档可重开，原始故事完整保留", (t) => {
  const context = sandbox(t);
  let store = context.open({ initialState: samples.initialState() });
  turn(store, 1, samples.borrowBundle());
  const before = store.readView();
  store.close();
  const db = new DatabaseSync(context.databasePath);
  db.exec("DROP TABLE chapters; DROP TABLE chapter_jobs;");
  db.close();
  store = context.open();
  assert.deepEqual(store.readView(), before);
  assert.deepEqual(store.readChapters(), { adventureId: "test-adventure", revision: 1,
    timeline: { storyTurnCount: 1, systemRevisions: [] }, chapters: [], nextCursor: null, complete: true });
  commit(store, store.beginChapter({ targetRevision: 1 }), candidate(1, "borrow-text"));
});

test("参数和错误码采用受限数据字段，拒绝越界、跨版本和读取访问器", (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  turn(store, 1);
  for (const options of [{ targetRevision: undefined }, { targetRevision: -1 }, { targetRevision: 1, retry: "yes" },
    { targetRevision: 1, extra: true }, Object.create({ targetRevision: 1 })]) {
    assert.throws(() => store.beginChapter(options), code("CHAPTER_INPUT_INVALID"));
  }
  assert.throws(() => store.beginChapter({ targetRevision: 2 }), code("VIEW_REVISION_UNAVAILABLE"));
  const accessor = { targetRevision: 1 };
  Object.defineProperty(accessor, "retry", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => store.beginChapter(accessor), code("CHAPTER_INPUT_INVALID"));
  const job = store.beginChapter({ targetRevision: 1 });
  for (const extra of [{ limit: 0 }, { limit: 101 }, { maxCharacters: 0 }, { maxCharacters: CHAPTER_LIMITS.sourceMaxCharacters + 1 },
    { cursor: { adventureId: "test-adventure" } }]) {
    assert.throws(() => store.readChapterSource({ ...jobArgs(job), ...extra }), code("CHAPTER_INPUT_INVALID"));
  }
  assert.throws(() => store.failChapter({ ...jobArgs(job), code: "private provider error detail" }), code("CHAPTER_INPUT_INVALID"));
  assert.throws(() => store.failChapter({ ...jobArgs(job), code: "CHAPTER_MODEL_FAILED", retryable: 1 }), code("CHAPTER_INPUT_INVALID"));
  assert.equal(store.readChapterJob(job.chapterId).status, "running");
  store.close();
  assert.throws(() => store.readChapterSource(jobArgs(job)), code("STORE_CLOSED"));
  assert.throws(() => store.readChapters(), code("STORE_CLOSED"));
});
