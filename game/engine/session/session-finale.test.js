"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createTurnStore } = require("./turn-store");
const { createSessionChapters } = require("./session-chapters");
const { createSessionFinale } = require("./session-finale");
const { createAdventureSession } = require("./adventure-session");
const samples = require("./test-fixtures/turn-samples");

const offer = { narration: [{ id: "ask", text: "大家已经安全离开。你愿意让这段故事在这里结束吗？" }],
  events: [{ id: "offer", type: "finale.propose", sourceSegmentIds: ["ask"], data: {
    candidateId: "ending-one", closureReason: "离开的选择已落定。", closedThreads: ["同行者安全离开。"],
    intentionalOpenThreads: [], finaleTone: "克制" } }], experiences: [] };
const ending = { narration: [{ id: "last", text: "你向他们道别，走入晨光。这段故事在此结束。" }],
  events: [{ id: "end", type: "finale.confirm", sourceSegmentIds: ["last"], data: { candidateId: "ending-one" } }], experiences: [] };
const chapter = { title: "晨光中的道别", summary: "你选择在大家离开后结束这一段故事。",
  keyEvents: [{ text: "你与同行者道别。", sources: [{ revision: 2, segmentId: "last" }] }], openThreads: [] };
function response(value) { return { text: JSON.stringify(value), usage: { input_tokens: 20, output_tokens: 30 }, finishReason: "stop" }; }

function setup(t, storeOptions = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-finale-"));
  const identity = samples.identity(path.join(directory, "session.sqlite"));
  const stores = [];
  const services = [];
  function open(options = {}) { const store = createTurnStore({ ...identity, ...options }); stores.push(store); return store; }
  const store = open({ initialState: samples.initialState(), ...storeOptions });
  function service(options = {}) {
    const current = options.store || store;
    const chapters = createSessionChapters({ store: current, provider: { generate: async () => response(chapter) }, ...options });
    services.push(chapters);
    return createSessionFinale({ store: current, chapters });
  }
  function commit(revision, bundle) {
    const started = store.beginAction(samples.request({ actionId: `turn-${revision}`, baseRevision: revision - 1,
      input: revision === 2 ? "我明确同意，就在这里结束。" : "我回顾刚才发生的事情。" }));
    return store.commitAction({ actionId: started.actionId, attemptId: started.attemptId, bundle });
  }
  t.after(async () => { for (const store of stores) store.close(); await Promise.all(services.map((item) => item.shutdown()));
    fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, identity, store, open, service, commit,
    confirm() { commit(1, offer); commit(2, ending); } };
}

test("a proposal does not start a final chapter or seal an archive", async (t) => {
  const env = setup(t); let calls = 0;
  const service = env.service({ provider: { generate() { calls++; throw new Error("must not call"); } } });
  assert.equal((await service.finalize()).status, "not_confirmed");
  env.commit(1, offer);
  assert.equal(service.recoverFinale().status, "not_confirmed");
  assert.equal((await service.finalize()).status, "not_confirmed");
  assert.equal(calls, 0);
  assert.equal(env.store.readChapters().chapters.length, 0);
});

test("confirmed narration is sealed through one derived chapter without advancing the story", async (t) => {
  const env = setup(t); env.confirm();
  const before = env.store.readModelState(); let calls = 0;
  const service = env.service({ provider: { generate() { calls++; return response(chapter); } } });
  const result = await service.finalize({ revision: 2 });
  assert.equal(result.status, "closed");
  assert.equal(result.chapterWork.modelCalls, 1);
  assert.equal(result.finale.archive.chapterId, "chapter-2");
  const duplicate = await service.finalize({ revision: 2 }, { retry: true });
  assert.equal(duplicate.status, "closed");
  assert.equal(duplicate.chapterWork, null);
  assert.deepEqual(service.recoverFinale().finale, result.finale);
  assert.equal(calls, 1);
  assert.deepEqual(env.store.readModelState(), before);
  assert.equal(env.store.readView().history.filter((turn) => turn.actionId === "turn-2").length, 1);
});

test("a chapter timeout keeps the ending; reopen only reads until an explicit retry", async (t) => {
  const env = setup(t); env.confirm();
  let late; let calls = 0;
  const service = env.service({ timeoutMs: 20, provider: { generate() { calls++; return new Promise((resolve) => { late = resolve; }); } } });
  const failed = await service.finalize({ revision: 2 });
  assert.equal(failed.status, "recovery_required");
  assert.equal(failed.error.code, "CHAPTER_TIMEOUT");
  assert.equal(failed.finale.archive.status, "pending");
  late(response(chapter)); await Promise.resolve();
  assert.equal(env.store.readChapters().chapters.length, 0);
  assert.equal(service.recoverFinale().status, "recovery_required");
  assert.equal(calls, 1);
  env.store.close();
  const reopened = env.open();
  const resumed = env.service({ store: reopened, provider: { generate() { calls++; return response(chapter); } } });
  assert.equal(resumed.recoverFinale().status, "recovery_required");
  assert.equal((await resumed.finalize()).status, "recovery_required");
  assert.equal(calls, 1);
  const complete = await resumed.finalize({ revision: 2 }, { retry: true });
  assert.equal(complete.status, "closed");
  assert.equal(calls, 2);
  assert.equal(reopened.readView().revision, 2);
  assert.deepEqual(reopened.readTurn(2).narration, ending.narration);
});

test("canceling final preparation interrupts its job, never the already confirmed story", async (t) => {
  const env = setup(t); env.confirm(); const controller = new AbortController();
  let start; const started = new Promise((resolve) => { start = resolve; }); let late;
  const service = env.service({ provider: { generate() { start(); return new Promise((resolve) => { late = resolve; }); } } });
  const pending = service.finalize({ revision: 2 }, { signal: controller.signal });
  await started; controller.abort();
  const interrupted = await pending;
  assert.equal(interrupted.status, "recovery_required");
  assert.equal(interrupted.finale.chapterJob.status, "interrupted");
  assert.equal(env.store.readAction("turn-2").status, "committed");
  late(response(chapter)); await Promise.resolve();
  assert.equal(env.store.readChapters().chapters.length, 0);
  assert.throws(() => env.store.beginAction(samples.request({ actionId: "extra", baseRevision: 2 })), { code: "FINALE_CONFIRMED" });
});

test("a committed chapter followed by a seal failure recovers without another model call", async (t) => {
  let failSeal = true; let calls = 0;
  const env = setup(t, { faultInjector(stage) { if (failSeal && stage === "after_finale_seal") throw new Error("synthetic seal failure"); } });
  env.confirm();
  const service = env.service({ provider: { generate() { calls++; return response(chapter); } } });
  assert.equal((await service.finalize()).status, "recovery_required");
  assert.equal(env.store.readFinale().chapterJob.status, "committed");
  failSeal = false;
  const recovered = service.recoverFinale({ revision: 2 });
  assert.equal(recovered.status, "closed");
  assert.equal(recovered.chapterWork, null);
  assert.equal(calls, 1);
  assert.equal(env.store.readView().revision, 2);
});

test("a lost seal receipt is queried before reporting success or attempting generation", async (t) => {
  const env = setup(t, { faultInjector(stage) { if (stage === "after_finale_seal_commit") throw new Error("lost receipt"); } });
  env.confirm(); let calls = 0;
  const service = env.service({ provider: { generate() { calls++; return response(chapter); } } });
  const saved = await service.finalize();
  assert.equal(saved.status, "closed");
  assert.deepEqual((await service.finalize()).finale.archive, saved.finale.archive);
  assert.equal(calls, 1);
});

test("unknown seal outcome remains locked and recovers the committed record without generation", async (t) => {
  const env = setup(t); env.confirm(); let unreadable = false; let calls = 0;
  const wrapped = { ...env.store,
    sealFinale(input) { env.store.sealFinale(input); unreadable = true; throw new Error("lost return"); },
    readFinale(input) { if (unreadable) throw new Error("read unavailable"); return env.store.readFinale(input); } };
  const service = env.service({ store: wrapped, provider: { generate() { calls++; return response(chapter); } } });
  const unknown = await service.finalize();
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.error.code, "FINALE_OUTCOME_UNKNOWN");
  assert.equal(unknown.finale.decision.phase, "confirmed");
  unreadable = false;
  assert.equal(service.recoverFinale().status, "closed");
  assert.equal(calls, 1);
});

test("the integrated session delivers confirmation before any chapter call and settles each phase separately", async (t) => {
  const env = setup(t); env.store.close(); let calls = 0;
  const session = createAdventureSession({ ...env.identity, hostText: "克制的主持人。", worldText: "上海的楼道。", finaleText: "玩家确认后结束故事。",
    provider: { generate() { const result = response([offer, ending, chapter][calls++]);
      if (calls === 3) result.usage = { input_tokens: 70, output_tokens: 90 };
      return result; } } });
  t.after(() => session.close());
  const proposed = await session.runAction(samples.request({ actionId: "offer", baseRevision: 0, input: "回顾已完成的旅程。" }));
  assert.equal(proposed.status, "committed");
  const request = samples.request({ actionId: "finish", baseRevision: 1, input: "我明确同意结束这段故事。" });
  const result = await session.runAction(request);
  assert.equal(result.status, "committed");
  assert.equal(calls, 2, "committing the ending must not start its derived chapter");
  assert.equal(result.modelCalls, 1);
  assert.equal(result.generationPasses, 1);
  assert.equal(result.finalization, undefined);
  assert.deepEqual(result.usage, { input_tokens: 20, output_tokens: 30 });
  assert.equal(result.usageComplete, true);
  assert.equal(result.view.finale.archive.status, "pending");
  assert.equal(result.view.finale.chapterJob, null);
  assert.deepEqual(result.view.narration, ending.narration);
  assert.equal(result.view.revision, 2);
  const storyReceipt = structuredClone(result);
  const again = await session.runAction(request, { retry: true });
  assert.equal(again.status, "committed");
  assert.equal(again.modelCalls, 0);
  assert.equal(again.finalization, undefined);
  assert.equal(calls, 2, "a duplicate story receipt must not start finalization either");
  const finalized = await session.finalize({ revision: 2 });
  assert.equal(finalized.status, "closed");
  assert.equal(finalized.chapterWork.modelCalls, 1);
  assert.deepEqual(finalized.chapterWork.usage, { input_tokens: 70, output_tokens: 90 });
  assert.equal(finalized.chapterWork.usageComplete, true);
  assert.equal(session.readView().finale.archive.status, "closed");
  assert.deepEqual(session.readView().narration, ending.narration);
  assert.equal(session.readView().revision, 2);
  assert.deepEqual(result, storyReceipt, "finalization cannot mutate a delivered story receipt or its usage");
  assert.equal((await session.finalize({ revision: 2 }, { retry: true })).chapterWork, null);
  assert.equal(calls, 3);
});

test("a separate chapter model failure uses an explicit excerpt and leaves the delivered story usage intact", async (t) => {
  const env = setup(t); env.store.close(); let calls = 0;
  const session = createAdventureSession({ ...env.identity, hostText: "克制的主持人。", worldText: "上海的楼道。", finaleText: "玩家确认后结束故事。",
    provider: { generate() {
      calls++;
      if (calls === 3) throw Object.assign(new Error("synthetic unavailable provider"), { code: "PROVIDER_GENERATION_FAILED" });
      return response(calls === 1 ? offer : ending);
    } } });
  t.after(() => session.close());
  await session.runAction(samples.request({ actionId: "offer", baseRevision: 0 }));
  const request = samples.request({ actionId: "finish", baseRevision: 1, input: "我明确同意结束这段故事。" });
  const committed = await session.runAction(request);
  assert.equal(committed.status, "committed");
  assert.equal(calls, 2);
  const before = session.readView();
  const failed = await session.finalize({ revision: 2 });
  assert.equal(failed.status, "closed");
  assert.equal(failed.finale.chapterJob.status, "committed");
  assert.equal(failed.chapterWork.chapter.mode, "excerpt");
  assert.equal(failed.chapterWork.chapter.fallbackReason, "CHAPTER_MODEL_FAILED");
  assert.equal(failed.chapterWork.modelCalls, 1);
  assert.equal(failed.chapterWork.usageComplete, false);
  assert.deepEqual(failed.chapterWork.usage, {}, "a failed response must not invent measured zero token counts");
  assert.equal(committed.modelCalls, 1);
  assert.equal(committed.usageComplete, true);
  assert.deepEqual(committed.usage, { input_tokens: 20, output_tokens: 30 });
  const after = session.readView();
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.state, before.state);
  assert.deepEqual(after.narration, before.narration);
  assert.deepEqual(after.history, before.history);
  assert.equal((await session.runAction(request, { retry: true })).modelCalls, 0);
  assert.equal((await session.finalize({ revision: 2 })).chapterWork, null);
  assert.equal(calls, 3, "neither a duplicate story nor finalization without explicit retry calls the model again");
});

test("invalid or accessor requests never start chapter work", async (t) => {
  const env = setup(t); env.confirm(); let calls = 0; let getters = 0;
  const service = env.service({ provider: { generate() { calls++; return response(chapter); } } });
  const hostile = {}; Object.defineProperty(hostile, "revision", { enumerable: true, get() { getters++; return 2; } });
  for (const input of [hostile, { revision: -1 }, { revision: 1.5 }, { revision: 2, extra: true }]) {
    await assert.rejects(service.finalize(input), { code: "FINALE_INPUT_INVALID" });
  }
  await assert.rejects(service.finalize({}, { retry: "yes" }), { code: "FINALE_INPUT_INVALID" });
  await assert.rejects(service.finalize({}, { signal: {} }), { code: "FINALE_INPUT_INVALID" });
  assert.equal(getters, 0); assert.equal(calls, 0);
});

test("an ended chapter with an unknown receipt keeps a safe retry entry without rerunning the closing turn", async (t) => {
  const { projectSessionFinale } = require("./session-projection");
  const env = setup(t); env.confirm();
  const originalState = env.store.readModelState();
  let broken = true; let calls = 0; let otherCalls = 0;
  const wrapped = { ...env.store,
    commitChapter(input) {
      if (broken) throw Object.assign(new Error("synthetic commit unavailable"), { code: "STORE_BUSY" });
      return env.store.commitChapter(input);
    },
    readChapterJob(chapterId) {
      if (broken) throw Object.assign(new Error("synthetic receipt unavailable"), { code: "STORE_BUSY" });
      return env.store.readChapterJob(chapterId);
    } };
  // readFinale uses the real store's own readChapterJob. Its succeeding read can
  // see the durable running row after this chapter execution has already ended.
  const service = env.service({ store: wrapped, provider: { generate() { calls++; return response(chapter); } } });
  const unknown = await service.finalize({ revision: 2 });
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.chapterWork.chapterStatus, "unknown");
  assert.equal(unknown.error.code, "FINALE_OUTCOME_UNKNOWN");
  assert.equal(unknown.chapterWork.error.code, "CHAPTER_COMMIT_OUTCOME_UNKNOWN");
  const durable = env.store.readFinale({ revision: 2 });
  assert.equal(durable.chapterJob.status, "running");
  const projected = projectSessionFinale(durable);
  assert.equal(projected.projection.inputAllowed, false);
  assert.equal(projected.projection.actions.resumeFinalization, true);
  assert.equal((await service.finalize({ revision: 2 })).status, "unknown");
  assert.equal(calls, 1, "an unknown result cannot automatically regenerate a chapter");
  const other = env.service({ provider: { generate() { otherCalls++; return response(chapter); } } });
  assert.equal((await other.finalize({ revision: 2 }, { retry: true })).status, "finalizing");
  assert.equal(otherCalls, 0, "another service cannot take over a running attempt through the retry entry");
  assert.equal(env.store.readFinale().chapterJob.attemptId, durable.chapterJob.attemptId);
  broken = false;
  const resumed = await service.finalize({ revision: 2 }, { retry: true });
  assert.equal(resumed.status, "closed");
  assert.equal(calls, 2);
  assert.equal(env.store.readAction("turn-2").status, "committed");
  assert.equal(env.store.readView().revision, 2);
  assert.deepEqual(env.store.readModelState(), originalState);
  assert.deepEqual(env.store.readTurn(2).narration, ending.narration);
  assert.equal(env.store.readView().history.filter((turn) => turn.actionId === "turn-2").length, 1);
});
