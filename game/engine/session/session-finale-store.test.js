"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { createTurnStore } = require("./turn-store");
const samples = require("./test-fixtures/turn-samples");

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-finale-store-"));
  const identity = samples.identity(path.join(directory, "session.sqlite"));
  const stores = [];
  t.after(() => { for (const store of stores.reverse()) store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  function open(overrides = {}) { const store = createTurnStore({ ...identity, ...overrides }); stores.push(store); return store; }
  return { identity, open, store: open({ initialState: samples.initialState(), ...options }) };
}

function propose() {
  return { narration: [{ id: "ask", text: "这段故事可以停在这里。你愿意就此结束吗？" }],
    events: [{ id: "offer", type: "finale.propose", sourceSegmentIds: ["ask"], data: {
      candidateId: "ending1", closureReason: "主要选择的后果已经落定。", closedThreads: ["离开的决定已经做出。"],
      intentionalOpenThreads: [], finaleTone: "平静" } }], experiences: [] };
}
function confirm() {
  return { narration: [{ id: "last", text: "你向楼道告别。门外天光渐亮，这一段故事在此结束。" }],
    events: [{ id: "finish", type: "finale.confirm", sourceSegmentIds: ["last"], data: { candidateId: "ending1" } }], experiences: [] };
}
function commitTurn(store, revision, bundle) {
  const request = samples.request({ actionId: `turn-${revision}`, baseRevision: revision - 1, input: revision === 2 ? "就到这里结束吧。" : "我想想。" });
  const action = store.beginAction(request);
  return { ...store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle }), request };
}
function chapter(store, revision = 2) {
  const job = store.beginChapter({ targetRevision: revision });
  return store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: {
    title: "楼道告别", summary: "你作出结束这一段故事的选择。", keyEvents: [{ text: "你告别楼道。",
      sources: [{ revision, segmentId: revision === 2 ? "last" : "ask" }] }], openThreads: [], mode: "model" } });
}

test("提议不封存；确认轮和待封存回执共同提交，历史查看不提前暴露归档", (t) => {
  const { store } = fixture(t);
  const originalPlayer = store.readModelState().entities.p;
  assert.deepEqual(store.readFinale(), { adventureId: "test-adventure", revision: 0, decision: null, archive: null, chapterJob: null });
  assert.equal(store.readView().finale, undefined);
  commitTurn(store, 1, propose());
  const pending = store.readFinale();
  assert.equal(pending.decision.phase, "candidate_pending");
  assert.equal(pending.archive, null);
  assert.equal(pending.chapterJob, null);
  const confirmed = commitTurn(store, 2, confirm());
  const finale = store.readFinale();
  assert.deepEqual(store.readModelState().entities.p, originalPlayer,
    "considering and confirming an ending do not establish a bodily change");
  assert.deepEqual(finale.archive, { finaleId: "finale-2", candidateId: "ending1", confirmationRevision: 2,
    confirmationActionId: "turn-2", status: "pending", chapterId: null, closedAt: null });
  assert.deepEqual(confirmed.view.finale, finale);
  assert.deepEqual(store.readPlayerState({ revision: 2 }).finale, finale);
  assert.deepEqual(store.readFinale({ revision: 1 }), pending);
  assert.deepEqual(store.readView({ revision: 1 }).finale, pending);
  assert.throws(() => store.beginAction(samples.request({ actionId: "after-ending", baseRevision: 2 })), { code: "FINALE_CONFIRMED" });
  assert.equal(store.beginAction(confirmed.request, { retry: true }).started, false);
  const repeated = store.commitAction({ actionId: confirmed.actionId, attemptId: confirmed.attemptId, bundle: {} });
  assert.equal(repeated.status, "committed");
  assert.equal(store.readView().history.length, 2);
  finale.decision.candidate.closureReason = "caller change";
  assert.notEqual(store.readFinale().decision.candidate.closureReason, "caller change");
});

test("确认写入中故障使正文、决定与归档回执全部回滚", (t) => {
  let fail = true;
  const { store } = fixture(t, { faultInjector(stage) { if (fail && stage === "after_finale_pending") throw new Error("synthetic interruption"); } });
  commitTurn(store, 1, propose());
  assert.throws(() => commitTurn(store, 2, confirm()), /synthetic interruption/);
  assert.equal(store.readView().revision, 1);
  assert.equal(store.readFinale().decision.phase, "candidate_pending");
  assert.equal(store.readFinale().archive, null);
  const action = store.readAction("turn-2");
  assert.equal(action.status, "running");
  fail = false;
  store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: confirm() });
  assert.equal(store.readFinale().archive.status, "pending");
  assert.equal(store.readView().history.filter((item) => item.actionId === "turn-2").length, 1);
});

test("封存要求已提交末章覆盖确认原文；相同身份幂等，不增加故事版本", (t) => {
  const { store, open } = fixture(t);
  assert.throws(() => store.sealFinale({ finaleId: "finale-2", chapterId: "chapter-2" }), { code: "FINALE_NOT_CONFIRMED" });
  commitTurn(store, 1, propose());
  chapter(store, 1);
  commitTurn(store, 2, confirm());
  const before = store.readModelState();
  assert.throws(() => store.sealFinale({ finaleId: "finale-other", chapterId: "chapter-2" }), { code: "FINALE_IDENTITY_MISMATCH" });
  assert.throws(() => store.sealFinale({ finaleId: "finale-2", chapterId: "chapter-1" }), { code: "FINALE_CHAPTER_NOT_READY" });
  const job = store.beginChapter({ targetRevision: 2 });
  assert.equal(store.readFinale().chapterJob.status, "running");
  assert.throws(() => store.sealFinale({ finaleId: "finale-2", chapterId: job.chapterId }), { code: "FINALE_CHAPTER_NOT_READY" });
  chapter(store);
  const final = store.sealFinale({ finaleId: "finale-2", chapterId: "chapter-2" });
  assert.equal(final.archive.status, "closed");
  assert.match(final.archive.closedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(final.chapterJob.status, "committed");
  assert.equal(final.chapterJob.chapter, undefined);
  assert.equal(JSON.stringify(final).includes("楼道告别"), false);
  assert.deepEqual(store.sealFinale({ finaleId: "finale-2", chapterId: "chapter-2" }), final);
  assert.throws(() => store.sealFinale({ finaleId: "finale-2", chapterId: "chapter-1" }), { code: "FINALE_IDENTITY_MISMATCH" });
  assert.deepEqual(store.readModelState(), before);
  assert.equal(store.readView().revision, 2);
  assert.equal(store.readView().history.length, 2);
  assert.equal(store.readFinale({ revision: 1 }).archive, null);
  store.close();
  assert.deepEqual(open().readFinale(), final);
});

test("seal 事务失败保留 pending，提交后回执失败可读回原封存且不重写时间", (t) => {
  let failingStage;
  const { store } = fixture(t, { faultInjector(stage) { if (stage === failingStage) throw new Error("synthetic seal fault"); } });
  commitTurn(store, 1, propose()); commitTurn(store, 2, confirm()); chapter(store);
  const args = { finaleId: "finale-2", chapterId: "chapter-2" };
  failingStage = "after_finale_seal";
  assert.throws(() => store.sealFinale(args), /synthetic seal fault/);
  assert.equal(store.readFinale().archive.status, "pending");
  failingStage = "after_finale_seal_commit";
  assert.throws(() => store.sealFinale(args), /synthetic seal fault/);
  const after = store.readFinale();
  assert.equal(after.archive.status, "closed");
  assert.deepEqual(store.sealFinale(args), after);
});

for (const stage of ["after_finale_pending", "after_finale_seal", "after_finale_seal_commit"]) {
  test(`真实子进程在 ${stage} 退出后仅恢复已落盘结果`, (t) => {
    const { store, identity, open } = fixture(t);
    commitTurn(store, 1, propose());
    if (stage !== "after_finale_pending") { commitTurn(store, 2, confirm()); chapter(store); }
    store.close();
    const request = samples.request({ actionId: "turn-2", baseRevision: 1, input: "就到这里结束吧。" });
    const script = `const {createTurnStore}=require(${JSON.stringify(require.resolve("./turn-store"))});
      const store=createTurnStore({...${JSON.stringify(identity)},faultInjector(stage){if(stage===${JSON.stringify(stage)})process.exit(71)}});
      if(${JSON.stringify(stage)}==='after_finale_pending') { const action=store.beginAction(${JSON.stringify(request)});
        store.commitAction({actionId:action.actionId,attemptId:action.attemptId,bundle:${JSON.stringify(confirm())}}); }
      else store.sealFinale({finaleId:'finale-2',chapterId:'chapter-2'});`;
    const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 71, child.stderr);
    const recovered = open();
    if (stage === "after_finale_pending") {
      assert.equal(recovered.readFinale().archive, null);
      assert.equal(recovered.readView().revision, 1);
      assert.equal(recovered.readAction("turn-2").status, "interrupted");
      const retried = recovered.beginAction(request, { retry: true });
      recovered.commitAction({ actionId: retried.actionId, attemptId: retried.attemptId, bundle: confirm() });
      chapter(recovered);
    } else assert.equal(recovered.readFinale().archive.status, stage === "after_finale_seal_commit" ? "closed" : "pending");
    recovered.sealFinale({ finaleId: "finale-2", chapterId: "chapter-2" });
    assert.equal(recovered.readView().history.length, 2);
    assert.equal(recovered.readFinale().archive.status, "closed");
  });
}

test("旧文件缺少 finale 表时只依据正式确认轮恢复 pending，不生成正文", (t) => {
  const { store, identity, open } = fixture(t);
  commitTurn(store, 1, propose()); commitTurn(store, 2, confirm());
  const story = store.readModelState();
  const history = store.readView().history;
  store.close();
  const db = new DatabaseSync(identity.databasePath);
  db.exec("DROP TABLE finale_archives"); db.close();
  const recovered = open();
  assert.equal(recovered.readFinale().archive.status, "pending");
  assert.deepEqual(recovered.readModelState(), story);
  assert.deepEqual(recovered.readView().history, history);
  assert.equal(recovered.readChapters().chapters.length, 0);
});

test("终局读写拒绝额外字段、访问器及不存在的历史版本", (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.readFinale({ revision: 1 }), { code: "VIEW_REVISION_UNAVAILABLE" });
  assert.throws(() => store.readFinale({ revision: -1 }), { code: "FINALE_INPUT_INVALID" });
  assert.throws(() => store.readFinale({ state: {} }), { code: "FINALE_INPUT_INVALID" });
  assert.throws(() => store.sealFinale({ finaleId: "finale-2", chapterId: "chapter-2", state: {} }), { code: "FINALE_INPUT_INVALID" });
  const input = { chapterId: "chapter-2" };
  Object.defineProperty(input, "finaleId", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => store.sealFinale(input), { code: "FINALE_INPUT_INVALID" });
  store.close();
  assert.throws(() => store.readFinale(), { code: "STORE_CLOSED" });
});
