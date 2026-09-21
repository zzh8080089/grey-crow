"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createTurnStore } = require("./turn-store");
const { initialState } = require("./test-fixtures/turn-samples");

function record(number, { mode = number % 2 ? "active_recall" : "passive_association", day = 10 + Math.floor((number - 1) / 2) } = {}) {
  const source = `s-${number}`;
  const content = `第${number}种模糊触感在指尖掠过。熟悉的气味旋即消失，过去仍未得到证实。`;
  return { narration: [{ id: source, text: `第${number}种触感似乎唤起一个未经证实的片段。${content}` }],
    events: [{ id: `day-${number}`, type: "situation.update", sourceSegmentIds: [source], data: { day } },
      { id: `fragment-event-${number}`, type: "memory_fragment.record", sourceSegmentIds: [source],
        data: { discoveryMode: mode, dimension: ["body", "emotion", "skill", "identity"][(number - 1) % 4],
          trigger: `合成触发物 ${number}`, content } }], experiences: [] };
}
function commit(store, identity, bundle, input = "我面对眼前的事物，等待自然的回忆。") {
  const baseRevision = store.readView().revision;
  const request = { actionId: `action-${baseRevision + 1}`, baseRevision, input, locale: identity.locale, contentVersion: identity.contentVersion };
  const action = store.beginAction(request);
  const result = store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
  return { request, action, result };
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-fragments-store-"));
  const identity = { databasePath: path.join(directory, "story.sqlite"), adventureId: "fragments", locale: "zh-CN", contentVersion: "locked-content" };
  const handles = [];
  const open = (extra = {}) => {
    const store = createTurnStore({ ...identity, memoryFragmentsEnabled: true, ...extra }); handles.push(store); return store;
  };
  t.after(async () => { handles.forEach((store) => store.close()); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, identity, open, store: open({ initialState: initialState(), ...options }) };
}

test("fragment and prose roll back together; explicit restart retry commits once with the original source", async (t) => {
  let fail = true;
  const env = await fixture(t, { faultInjector(point) { if (point === "after_turn" && fail) throw new Error("synthetic write interruption"); } });
  const bundle = record(1);
  const request = { actionId: "original", baseRevision: 0, input: "指尖的触感让我试着回忆。", locale: env.identity.locale, contentVersion: env.identity.contentVersion };
  const action = env.store.beginAction(request);
  assert.throws(() => env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle }), /synthetic write interruption/);
  assert.equal(env.store.readView().revision, 0);
  assert.deepEqual(env.store.readMemoryFragments({ revision: 0 }).fragments, []);
  assert.deepEqual(env.store.readView().narration, []);
  env.store.close(); fail = false;
  const reopened = env.open();
  const retry = reopened.beginAction(request, { retry: true });
  assert.equal(retry.started, true);
  reopened.commitAction({ actionId: retry.actionId, attemptId: retry.attemptId, bundle });
  const page = reopened.readMemoryFragments({ revision: 1 });
  assert.equal(page.fragments.length, 1);
  assert.deepEqual(page.fragments[0].source, { adventureId: "fragments", revision: 1,
    eventId: "fragment-event-1", sourceSegmentIds: ["s-1"] });
  assert.equal(page.fragments[0].certainty, "uncertain");
  assert.equal(reopened.beginAction(request).status, "committed");
  reopened.commitAction({ actionId: retry.actionId, attemptId: retry.attemptId, bundle });
  assert.equal(reopened.readView().revision, 1);
  assert.equal(reopened.readMemoryFragments({ revision: 1 }).progress.count, 1);
});

test("a trigger without the full recollection, unreferenced prose, or reordered/changed words cannot commit a fragment", async (t) => {
  const content = "右手在暗处摸索管壁的螺纹。膝下的瓷砖很凉。头顶有人问你冷不冷。";
  const cases = [
    { narration: [{ id: "s-1", text: "门缝里飘来潮湿气味，远处响起水声。" }], sourceSegmentIds: ["s-1"], content },
    { narration: [{ id: "s-1", text: "门缝里飘来潮湿气味。" }, { id: "not-linked", text: content }], sourceSegmentIds: ["s-1"], content },
    { narration: [{ id: "second", text: "膝下的瓷砖很凉。" }, { id: "first", text: "右手在暗处摸索管壁的螺纹。" }],
      sourceSegmentIds: ["first", "second"], content: "右手在暗处摸索管壁的螺纹。膝下的瓷砖很凉。" },
    { narration: [{ id: "s-1", text: "I was notable. The rest remains unclear." }], sourceSegmentIds: ["s-1"], content: "I was not able. The rest remains unclear." },
  ];
  for (const example of cases) {
    const { store, identity } = await fixture(t);
    const candidate = record(1, { day: 11 });
    candidate.narration = example.narration;
    candidate.events[0].sourceSegmentIds = [example.narration[0].id];
    Object.assign(candidate.events[1], { sourceSegmentIds: example.sourceSegmentIds });
    candidate.events[1].data.content = example.content;
    const before = store.readModelState(); const beforeCandidate = structuredClone(candidate);
    const action = store.beginAction({ actionId: "bad-recollection", baseRevision: 0, input: "我试着想起这个气味。",
      locale: identity.locale, contentVersion: identity.contentVersion });
    assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: candidate }), (error) => {
      assert.equal(error.code, "TURN_VALIDATION_FAILED");
      assert.deepEqual(error.issues, ["bundle.events[1].data.content: fragment content must appear in its referenced narration"]);
      assert.doesNotMatch(error.message, /瓷砖|notable|冷不冷/); return true;
    });
    assert.equal(store.readView().revision, 0);
    assert.deepEqual(store.readView().narration, []);
    assert.deepEqual(store.readModelState(), before, "even the preceding day change is not committed");
    assert.deepEqual(candidate, beforeCandidate, "the validator neither fills prose nor changes the fragment");
    assert.equal(store.readMemoryFragments({ revision: 0 }).progress.count, 0);
  }
});

test("the complete visible recollection commits unchanged, including referenced Chinese paragraphs and English word spacing", async (t) => {
  const first = "右手在暗处摸索管壁的螺纹。"; const second = "膝下的瓷砖很凉。头顶有人问你冷不冷。";
  for (const example of [
    { narration: [{ id: "s-1", text: `潮湿气味里，一个未被证实的画面浮现：${first}${second}` }], refs: ["s-1"], content: first + second },
    { narration: [{ id: "first", text: first }, { id: "second", text: `\n\t${second}` }], refs: ["second", "first"], content: `${first}  ${second}` },
    { narration: [{ id: "first", text: "I was not able." }, { id: "second", text: "The rest remains unclear." }],
      refs: ["first", "second"], content: "I was  not able.\nThe rest remains unclear." },
  ]) {
    const { store, identity, open } = await fixture(t);
    const candidate = record(1);
    candidate.narration = example.narration;
    candidate.events[0].sourceSegmentIds = [example.narration[0].id];
    candidate.events[1].sourceSegmentIds = example.refs;
    candidate.events[1].data.content = example.content;
    commit(store, identity, candidate);
    assert.equal(store.readView().revision, 1);
    assert.deepEqual(store.readView().narration, example.narration);
    store.close(); const reopened = open();
    const page = reopened.readMemoryFragments({ revision: 1 });
    assert.equal(page.progress.count, 1);
    assert.equal(page.fragments[0].content, example.content, "normalization is comparison-only");
    assert.deepEqual(page.fragments[0].source.sourceSegmentIds, example.refs);
  }
});

test("complete track pages retain every fragment at one revision and unlock only a later explicit choice", async (t) => {
  const { store, identity, open } = await fixture(t);
  for (let n = 1; n <= 30; n++) commit(store, identity, record(n));
  const pages = [];
  let page = store.readMemoryFragments({ revision: 30 });
  const firstCursor = page.nextCursor;
  for (;;) { pages.push(page); if (page.complete) break; page = store.readMemoryFragments({ revision: 30, cursor: page.nextCursor }); }
  assert.deepEqual(pages.map((entry) => entry.fragments.length), [10, 10, 10]);
  assert.deepEqual(pages.flatMap((entry) => entry.fragments.map((fragment) => fragment.id)), Array.from({ length: 30 }, (_, i) => `fragment-${i + 1}`));
  assert.equal(page.progress.phase, "available");
  const before = store.readModelState({ revision: 30 });
  for (const choice of ["deferred", "accepted"]) {
    commit(store, identity, { narration: [{ id: "choice-source", text: `你明确选择${choice}这份未经证实的自我叙事。` }],
      events: [{ id: "choice-event", type: "memory_fragment.resolve", sourceSegmentIds: ["choice-source"], data: { choice } }], experiences: [] });
  }
  const state = store.readModelState({ revision: 32 });
  const expectedEntities = structuredClone(before.entities);
  assert.deepEqual(state.entities, expectedEntities);
  assert.deepEqual(state.inventory, before.inventory);
  assert.equal(state.finale, undefined);
  assert.equal(state.memoryFragments.revelationStatus, "accepted");
  assert.equal(state.memoryFragments.decision.source.revision, 32);
  assert.throws(() => store.readMemoryFragments({ revision: 32, cursor: firstCursor }), { code: "MEMORY_FRAGMENT_CURSOR_MISMATCH" });
  assert.throws(() => store.readMemoryFragments({ revision: 30, cursor: { ...firstCursor, adventureId: "other" } }), { code: "MEMORY_FRAGMENT_CURSOR_MISMATCH" });
  assert.throws(() => store.readMemoryFragments({ revision: 30, limit: 11 }), { code: "ACTION_INPUT_INVALID" });
  assert.equal(store.readMemoryFragments({ revision: 30, cursor: firstCursor }).progress.phase, "available");
  store.close();
  const reopened = open();
  assert.deepEqual(reopened.readModelState({ revision: 32 }).memoryFragments, state.memoryFragments);
  assert.equal(reopened.readMemoryFragments({ revision: 32 }).progress.phase, "accepted");
  reopened.close();
  const db = new DatabaseSync(identity.databasePath);
  const rolledBack = structuredClone(state);
  rolledBack.memoryFragments = before.memoryFragments;
  db.prepare("UPDATE turns SET state_json=? WHERE revision=32").run(JSON.stringify(rolledBack)); db.close();
  assert.throws(() => open().readMemoryFragments({ revision: 32 }), { code: "MEMORY_FRAGMENT_SOURCE_INVALID" });
});

test("unselected content cannot acquire fragments even when the model attempts a record", async (t) => {
  const { store, identity } = await fixture(t, { memoryFragmentsEnabled: false });
  const request = { actionId: "disabled", baseRevision: 0, input: "试着回忆。", locale: identity.locale, contentVersion: identity.contentVersion };
  const action = store.beginAction(request);
  assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: record(1) }), { code: "TURN_VALIDATION_FAILED" });
  assert.equal(store.readView().revision, 0);
  assert.throws(() => store.readMemoryFragments({ revision: 0 }), { code: "MEMORY_FRAGMENTS_UNAVAILABLE" });
});

test("source date follows event order when the day advances after a fragment in the same committed turn", async (t) => {
  const { store, identity, open } = await fixture(t);
  const bundle = record(1);
  bundle.events.push({ id: "later-day", type: "situation.update", sourceSegmentIds: ["s-1"], data: { day: 11 } });
  commit(store, identity, bundle); store.close();
  const reopened = open();
  const page = reopened.readMemoryFragments({ revision: 1 });
  assert.equal(page.fragments[0].gameDay, 10);
  assert.equal(page.progress.today.day, 11);
  assert.equal(page.progress.today.activeRecallRemaining, 1);
});

test("chapter requests keep collection progress separate from facts and do not repeat the full fragment ledger", async (t) => {
  const { createSessionChapters } = require("./session-chapters");
  const { store, identity } = await fixture(t);
  commit(store, identity, record(1));
  let calls = 0;
  const chapters = createSessionChapters({ store, provider: { generate(request) {
    calls++;
    const data = JSON.parse(request.messages[1].content);
    assert.equal(data.currentState.memoryFragments, undefined);
    assert.equal(data.memoryFragmentProgress.count, 1);
    assert.equal(data.memoryFragmentProgress.phase, "collecting");
    assert.equal(JSON.stringify(data.currentState).includes(record(1).events[1].data.content), false);
    assert.match(request.messages[0].content, /uncertain personal recollection/);
    return { text: JSON.stringify({ title: "一段合成回顾", summary: "你感到一段未经证实的片段。",
      keyEvents: [{ text: "一次未经证实的回忆浮现", sources: [{ revision: 1, segmentId: "s-1" }] }], openThreads: [] }),
      finishReason: "stop", usage: { input_tokens: 200, output_tokens: 80 } };
  } } });
  t.after(() => chapters.shutdown());
  const saved = await chapters.saveChapter({ targetRevision: 1 });
  assert.equal(saved.chapterStatus, "created"); assert.equal(calls, 1);
  assert.equal(store.readView().revision, 1);
});

for (const corrupt of ["adventure", "content", "event", "segment", "day", "missing-ledger", "empty-ledger"]) {
  test(`fragment source corruption (${corrupt}) is rejected rather than projected as verified progress`, async (t) => {
    const env = await fixture(t);
    commit(env.store, env.identity, record(1)); env.store.close();
    const db = new DatabaseSync(env.identity.databasePath);
    const state = JSON.parse(db.prepare("SELECT state_json FROM turns WHERE revision=1").get().state_json);
    const fragment = state.memoryFragments.fragments[0];
    if (corrupt === "adventure") fragment.source.adventureId = "other-adventure";
    if (corrupt === "content") fragment.content = "另一个未经证实但来源不符的片段。";
    if (corrupt === "event") fragment.source.eventId = "not-recorded";
    if (corrupt === "segment") fragment.source.sourceSegmentIds = ["not-recorded"];
    if (corrupt === "day") fragment.gameDay = 11;
    if (corrupt === "missing-ledger") delete state.memoryFragments;
    if (corrupt === "empty-ledger") state.memoryFragments.fragments = [];
    db.prepare("UPDATE turns SET state_json=? WHERE revision=1").run(JSON.stringify(state)); db.close();
    const reopened = env.open();
    assert.throws(() => reopened.readPlayerState(), { code: "MEMORY_FRAGMENT_SOURCE_INVALID" });
    assert.throws(() => reopened.readMemoryFragments({ revision: 1 }), { code: "MEMORY_FRAGMENT_SOURCE_INVALID" });
  });
}

for (const count of [2, 30]) {
  test(`offline archive and copied continuation preserve ${count} fragments, source ancestry and the existing choice`, async (t) => {
    const { createHash } = require("node:crypto");
    const { loadBuiltInContentPack } = require("../content-v2/built-in-pack");
    const { compileContentSnapshot } = require("../content-v2/snapshot-compiler");
    const { readContentSnapshot } = require("../content-v2/snapshot-reader");
    const { makeTreeWritable } = require("../content-v2/snapshot-utils");
    const { createSessionArchiveReader } = require("./session-archive");
    const { createSessionContinuationService } = require("./session-continuation");
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-fragments-copy-")));
    const adventuresRoot = path.join(root, "saves"); await fs.mkdir(adventuresRoot);
    const stores = [];
    t.after(async () => { stores.forEach((store) => store.close()); await makeTreeWritable(root); await fs.rm(root, { recursive: true, force: true }); });
    const contentRoot = path.resolve(__dirname, "../../content");
    const pack = await loadBuiltInContentPack({ contentRoot });
    await compileContentSnapshot({ adventuresRoot, adventureId: "parent", language: "zh-CN", plan: pack.defaultPlan,
      requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"], resolvePackRoot: (id) => path.join(contentRoot, "packs", id) });
    const snapshot = await readContentSnapshot({ adventuresRoot, adventureId: "parent" });
    const identity = { databasePath: path.join(adventuresRoot, "parent/session.sqlite"), adventureId: "parent",
      locale: "zh-CN", contentVersion: snapshot.lock.overallHash, memoryFragmentsEnabled: true };
    const parent = createTurnStore({ ...identity, initialState: initialState() }); stores.push(parent);
    for (let n = 1; n <= count; n++) commit(parent, identity, record(n));
    if (count === 30) commit(parent, identity, { narration: [{ id: "chosen", text: "你决定放下这些未经证实的过去，选择新的自己。" }],
      events: [{ id: "sealed", type: "memory_fragment.resolve", sourceSegmentIds: ["chosen"], data: { choice: "sealed" } }], experiences: [] });
    const originalTrack = parent.readModelState().memoryFragments;
    commit(parent, identity, { narration: [{ id: "offer", text: "这段旅程到了可以停留的地方，你愿意暂且告一段落吗？" }],
      events: [{ id: "ending", type: "finale.propose", sourceSegmentIds: ["offer"], data: { candidateId: "end",
        closureReason: "合成阶段已完成", closedThreads: ["这一阶段的行动"], intentionalOpenThreads: [], finaleTone: "平静" } }], experiences: [] });
    commit(parent, identity, { narration: [{ id: "closed", text: "你确认在这里结束本篇，记得自己作出的选择。" }],
      events: [{ id: "confirm", type: "finale.confirm", sourceSegmentIds: ["closed"], data: { candidateId: "end" } }], experiences: [] });
    const revision = parent.readView().revision;
    const chapter = parent.beginChapter({ targetRevision: revision });
    parent.commitChapter({ chapterId: chapter.chapterId, attemptId: chapter.attemptId, chapter: { title: "合成旅程", summary: "片段仍然未经证实，本篇暂告一段落。",
      keyEvents: [{ text: "本篇结束", sources: [{ revision, segmentId: "closed" }] }], openThreads: [], mode: "model" } });
    parent.sealFinale({ finaleId: `finale-${revision}`, chapterId: chapter.chapterId }); parent.close();
    const digest = async () => createHash("sha256").update(await fs.readFile(identity.databasePath)).digest("hex");
    const before = await digest();
    const reader = createSessionArchiveReader({ adventuresRoot });
    for (const displayLocale of ["zh-CN", "en-US", "ja-JP"]) {
      const opened = await reader.open({ adventureId: "parent", displayLocale });
      const descriptor = opened.projection.panels.panels.find((panel) => panel.panelRef === "session-memory-fragments");
      assert.equal(descriptor.language, displayLocale);
      assert.equal(opened.modules.length, 1);
      const page = await reader.readPanel({ adventureId: "parent", revision, panelRef: descriptor.panelRef,
        displayLocale, view: "list", fieldId: "fragments", limit: 24 });
      assert.equal(page.panel.items.length, Math.min(24, count));
      assert.equal(page.sources[0].source.adventureId, "parent");
      assert.deepEqual(page.resolutionSources.decision, originalTrack.decision);
      const classic = await reader.readModule({ adventureId: "parent", revision, displayLocale,
        moduleRef: opened.modules[0].moduleRef, fieldId: "fragments", limit: 24 });
      assert.equal(classic.module.fields[0].value.length, Math.min(24, count));
    }
    const child = await createSessionContinuationService({ adventuresRoot }).fork({ requestId: "continue-fragments",
      parentAdventureId: "parent", parentRevision: revision, sourceFinaleId: `finale-${revision}` });
    const childSnapshot = await readContentSnapshot({ adventuresRoot, adventureId: child.childAdventureId });
    const childIdentity = { ...identity, databasePath: path.join(adventuresRoot, child.childAdventureId, "session.sqlite"),
      adventureId: child.childAdventureId, contentVersion: childSnapshot.lock.overallHash };
    const childStore = createTurnStore(childIdentity); stores.push(childStore);
    assert.deepEqual(childStore.readModelState().memoryFragments, originalTrack);
    assert.equal(childStore.readMemoryFragments({ revision: revision + 1 }).progress.today.activeRecallRemaining, 0);
    if (count === 2) {
      const baseRevision = childStore.readView().revision;
      const action = childStore.beginAction({ actionId: "child-fragment", baseRevision,
        input: "这气味让我试着回忆。", locale: childIdentity.locale, contentVersion: childIdentity.contentVersion });
      assert.throws(() => childStore.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
        bundle: record(3, { day: 10 }) }), { code: "TURN_VALIDATION_FAILED" });
      assert.equal(childStore.readView().revision, baseRevision);
      childStore.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: record(3, { day: 11 }) });
      const fragments = childStore.readMemoryFragments({ revision: baseRevision + 1 }).fragments;
      assert.deepEqual(fragments.slice(0, 2), originalTrack.fragments);
      assert.equal(fragments[2].source.adventureId, child.childAdventureId);
    } else {
      assert.equal(childStore.readMemoryFragments({ revision: revision + 1 }).progress.phase, "sealed");
      assert.equal(childStore.readModelState().finale.phase, "idle");
    }
    assert.equal(await digest(), before);
  });
}
