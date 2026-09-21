"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { createTurnStore } = require("./turn-store");
const { inspectSessionAdventure } = require("./session-catalog");
const { createSessionArchiveReader } = require("./session-archive");
const { loadBuiltInContentPack } = require("../content-v2/built-in-pack");
const { compileContentSnapshot } = require("../content-v2/snapshot-compiler");
const { makeTreeWritable } = require("../content-v2/snapshot-utils");
const samples = require("./test-fixtures/turn-samples");

function bundle(type = "extreme.confirm") {
  return { narration: [{ id: "source", text: type === "extreme.propose" ? "这是虚构角色的选择，仍要继续吗？" : "你明确回应。故事承接这个选择。" }],
    events: [{ id: "decision", type, sourceSegmentIds: ["source"], data: type === "extreme.propose"
      ? { candidateId: "extreme1", characterId: "p", intentReason: "角色主动提出终止旅程。", fictionalContext: "合成游戏角色在虚构场景中的选择。" }
      : { candidateId: "extreme1" } }], experiences: [] };
}
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-terminal-"));
  const identity = samples.identity(path.join(directory, "session.sqlite"));
  const stores = [];
  function open(config = {}) { const value = createTurnStore({ ...identity, ...config }); stores.push(value); return value; }
  const { initialTurnCount = 3, ...storeOptions } = options;
  const store = open({ initialState: samples.initialState(), ...storeOptions });
  t.after(() => { for (const item of stores) item.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  ready(store, identity, initialTurnCount);
  return { store, identity, open, directory };
}
function request(identity, revision, actionId = `action-${revision}`) {
  return { actionId, baseRevision: revision - 1, input: `本测试虚构角色第${revision}次回应。`, locale: identity.locale, contentVersion: identity.contentVersion };
}
function ready(store, identity, count = 3) {
  for (let revision = 1; revision <= count; revision++) {
    const action = store.beginAction(request(identity, revision));
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle(revision === 1 ? "extreme.propose" : "extreme.confirm") });
  }
}

test("首两次新玩家确认不能提前登记或抽取终末分支", (t) => {
  let draws = 0;
  const env = fixture(t, { initialTurnCount: 1, terminalRandomInt() { draws++; return 0; } });
  for (const revision of [2, 3]) {
    const action = env.store.beginAction(request(env.identity, revision));
    assert.throws(() => env.store.reserveTerminal({ actionId: action.actionId, attemptId: action.attemptId,
      candidateId: "extreme1" }), { code: "TERMINAL_NOT_READY" });
    env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle() });
  }
  assert.equal(draws, 0); assert.equal(env.store.getTerminal(), null);
  assert.equal(env.store.readFinale().decision.candidate.confirmations.length, 2);
});
function reserve(store, identity) {
  const action = store.beginAction(request(identity, 4));
  return { action, reservation: store.reserveTerminal({ actionId: action.actionId, attemptId: action.attemptId, candidateId: "extreme1" }) };
}
function finish(store, action) {
  return store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle() });
}
function seal(store) {
  const job = store.beginChapter({ targetRevision: 4 });
  store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: {
    title: "最后的回望", summary: "这段虚构故事已完成。", keyEvents: [{ text: "最后的回应。", sources: [{ revision: 4, segmentId: "source" }] }], openThreads: [], mode: "excerpt", fallbackReason: "CHAPTER_MODEL_UNAVAILABLE" } });
  return store.sealFinale({ finaleId: "finale-4", chapterId: job.chapterId });
}

for (const [draw, outcome] of [[4439, "grey_crow_view"], [4440, "standard_extreme_ending"]]) {
  test(`分支阈值 ${draw} 固定为 ${outcome}，重复和恢复不重抽`, (t) => {
    let draws = 0;
    const env = fixture(t, { terminalRandomInt(max) { assert.equal(max, 10000); draws++; return draw; } });
    const before = env.store.readView();
    const { action, reservation } = reserve(env.store, env.identity);
    assert.equal(reservation.outcome, outcome);
    assert.deepEqual(env.store.reserveTerminal({ actionId: action.actionId, attemptId: action.attemptId, candidateId: "extreme1" }), reservation);
    assert.equal(draws, 1);
    assert.deepEqual(env.store.readView().state, before.state);
    assert.equal(env.store.readView().revision, 3);
    assert.equal(env.store.readFinale().terminal.status, "reserved");
    assert.equal(JSON.stringify(env.store.readFinale().terminal).includes(outcome), false);
    assert.equal(env.store.readFinale({ revision: 2 }).terminal, undefined);
    const result = finish(env.store, action);
    assert.equal(result.revision, 4);
    assert.equal(result.view.finale.archive.source, "extreme");
    assert.equal(result.view.finale.archive.outcome, outcome);
    assert.equal(result.view.finale.archive.continuationPolicy, "forbidden");
    assert.equal(env.store.getTerminal().status, "committed");
    assert.equal(seal(env.store).archive.status, "closed");
    assert.deepEqual(finish(env.store, action).view.narration, result.view.narration);
    env.store.close();
    const reopened = env.open({ terminalRandomInt() { throw new Error("must never reroll"); } });
    assert.equal(reopened.getTerminal().outcome, outcome);
    assert.equal(reopened.readFinale().archive.status, "closed");
    assert.equal(reopened.readHistory({ revision: 4 }).history.length, 4);
  });
}

test("锁定后的取消是可恢复中断，其他行动与旧attempt不能夺取结果", (t) => {
  const env = fixture(t); const { action, reservation } = reserve(env.store, env.identity);
  const stopped = env.store.cancelAction(action.actionId);
  assert.equal(stopped.status, "interrupted"); assert.deepEqual(stopped.error, { code: "TERMINAL_INTERRUPTED", retryable: true });
  assert.equal(env.store.beginAction(request(env.identity, 4)).started, false);
  assert.throws(() => env.store.beginAction(request(env.identity, 4, "other")), { code: "TERMINAL_LOCKED" });
  const retry = env.store.beginAction(request(env.identity, 4), { retry: true });
  assert.notEqual(retry.attemptId, action.attemptId);
  assert.throws(() => finish(env.store, action), { code: "ATTEMPT_STALE" });
  assert.deepEqual(env.store.reserveTerminal({ actionId: retry.actionId, attemptId: retry.attemptId, candidateId: "extreme1" }), reservation);
  env.store.failAction({ actionId: retry.actionId, attemptId: retry.attemptId, code: "TURN_GENERATION_FAILED", retryable: false });
  assert.equal(env.store.readAction(retry.actionId).error.retryable, true);
  const last = env.store.beginAction(request(env.identity, 4), { retry: true });
  assert.equal(finish(env.store, last).status, "committed");
});

test("终末鉴权失败保留设置错误与分支，修正连接后仅显式重试可恢复", (t) => {
  const env = fixture(t); const { action, reservation } = reserve(env.store, env.identity);
  env.store.failAction({ actionId: action.actionId, attemptId: action.attemptId,
    code: "UPSTREAM_AUTH_ERROR", retryable: false });
  assert.deepEqual(env.store.readAction(action.actionId).error, { code: "UPSTREAM_AUTH_ERROR", retryable: false });
  assert.equal(env.store.beginAction(request(env.identity, 4)).started, false);
  assert.throws(() => env.store.beginAction(request(env.identity, 4, "other")), { code: "TERMINAL_LOCKED" });
  env.store.close();
  const reopened = env.open({ terminalRandomInt() { throw new Error("must never reroll"); } });
  const retry = reopened.beginAction(request(env.identity, 4), { retry: true });
  assert.equal(retry.started, true);
  assert.deepEqual(reopened.reserveTerminal({ actionId: retry.actionId, attemptId: retry.attemptId, candidateId: "extreme1" }), reservation);
  assert.equal(finish(reopened, retry).status, "committed");
});

test("只有本实例当前有效动作可登记终末，外部参数不能指定概率或结果", (t) => {
  const env = fixture(t); const action = env.store.beginAction(request(env.identity, 4));
  const other = env.open();
  const args = { actionId: action.actionId, attemptId: action.attemptId, candidateId: "extreme1" };
  assert.throws(() => other.reserveTerminal(args), { code: "TERMINAL_OWNER_MISMATCH" });
  assert.throws(() => env.store.reserveTerminal({ ...args, outcome: "grey_crow_view" }), { code: "TERMINAL_INPUT_INVALID" });
  assert.throws(() => env.store.reserveTerminal({ ...args, candidateId: "wrong" }), { code: "TERMINAL_NOT_READY" });
  let getters = 0; const hostile = { ...args }; Object.defineProperty(hostile, "candidateId", { enumerable: true, get() { getters++; return "extreme1"; } });
  assert.throws(() => env.store.reserveTerminal(hostile), { code: "TERMINAL_INPUT_INVALID" }); assert.equal(getters, 0);
  assert.equal(env.store.getTerminal(), null);
  assert.throws(() => finish(env.store, action), { code: "TURN_VALIDATION_FAILED" });
  env.store.reserveTerminal(args);
  for (const candidate of [bundle("extreme.cancel"), { narration: [{ id: "plain", text: "没有确认。" }], events: [], experiences: [] }]) {
    assert.throws(() => env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: candidate }), { code: "TURN_VALIDATION_FAILED" });
  }
  assert.equal(env.store.readView().revision, 3);
});

for (const stage of ["after_terminal_reserve", "after_terminal_reserve_commit"]) {
  test(`${stage} 故障按持久回执恢复`, (t) => {
    let injected = true; let draws = 0;
    const env = fixture(t, { terminalRandomInt() { draws++; return 0; }, faultInjector(at) { if (injected && at === stage) throw new Error("synthetic"); } });
    const action = env.store.beginAction(request(env.identity, 4));
    const args = { actionId: action.actionId, attemptId: action.attemptId, candidateId: "extreme1" };
    assert.throws(() => env.store.reserveTerminal(args));
    assert.equal(Boolean(env.store.getTerminal()), stage.endsWith("_commit"));
    injected = false;
    const record = env.store.reserveTerminal(args);
    assert.equal(record.outcome, "grey_crow_view");
    assert.equal(draws, stage.endsWith("_commit") ? 1 : 2);
    assert.equal(finish(env.store, action).status, "committed");
  });
}

for (const stage of ["after_terminal_commit", "after_finale_pending"]) {
  test(`${stage} 回滚正文/事实/封存回执但保留原分支`, (t) => {
    let injected = true;
    const env = fixture(t, { faultInjector(at) { if (injected && at === stage) throw new Error("synthetic"); } });
    const { action, reservation } = reserve(env.store, env.identity);
    assert.throws(() => finish(env.store, action));
    assert.equal(env.store.readView().revision, 3);
    assert.equal(env.store.readFinale().archive, null);
    assert.deepEqual(env.store.getTerminal(), reservation);
    injected = false;
    assert.equal(finish(env.store, action).view.finale.archive.outcome, reservation.outcome);
    assert.equal(env.store.readHistory({ revision: 4 }).history.filter((row) => row.actionId === action.actionId).length, 1);
  });
}

test("实际进程在分支登记后退出，重开只读恢复并显式重试原action", (t) => {
  const env = fixture(t); env.store.close();
  const script = `const {createTurnStore}=require(${JSON.stringify(require.resolve("./turn-store"))});
    const store=createTurnStore({...JSON.parse(process.argv[1]),terminalRandomInt:()=>1});
    const action=store.beginAction(JSON.parse(process.argv[2]));store.reserveTerminal({actionId:action.actionId,attemptId:action.attemptId,candidateId:'extreme1'});process.exit(0);`;
  assert.equal(spawnSync(process.execPath, ["-e", script, JSON.stringify(env.identity), JSON.stringify(request(env.identity, 4))]).status, 0);
  const store = env.open({ terminalRandomInt() { throw new Error("must not reroll"); } });
  assert.equal(store.readAction("action-4").status, "interrupted");
  assert.equal(store.getTerminal().outcome, "grey_crow_view");
  assert.equal(store.beginAction(request(env.identity, 4)).started, false);
  const retry = store.beginAction(request(env.identity, 4), { retry: true });
  assert.equal(finish(store, retry).status, "committed");
});

for (const draw of [0, 9999]) {
  test(`菜单和只读封存核对特殊来源，draw=${draw} 不写文件且拒绝篡改来源`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-terminal-archive-"));
    const adventuresRoot = path.join(root, "saves"); fs.mkdirSync(adventuresRoot);
    const contentRoot = path.resolve(__dirname, "../../content"); const pack = await loadBuiltInContentPack({ contentRoot });
    const adventureId = "extreme_archive";
    const snapshot = await compileContentSnapshot({ adventuresRoot, adventureId, language: "zh-CN", plan: pack.defaultPlan,
      requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"], resolvePackRoot: (id) => path.join(contentRoot, "packs", id) });
    const identity = { databasePath: path.join(adventuresRoot, adventureId, "session.sqlite"), adventureId,
      locale: "zh-CN", contentVersion: snapshot.lock.overallHash };
    const store = createTurnStore({ ...identity, initialState: samples.initialState(), terminalRandomInt: () => draw });
    t.after(async () => { store.close(); await makeTreeWritable(root); fs.rmSync(root, { recursive: true, force: true }); });
    ready(store, identity); const { action } = reserve(store, identity);
    const digest = () => createHash("sha256").update(fs.readFileSync(identity.databasePath)).digest("hex");
    const before = digest(); const names = fs.readdirSync(path.dirname(identity.databasePath));
    const pending = await inspectSessionAdventure({ adventuresRoot, adventureId });
    assert.equal(pending.status, "recovery_required"); assert.equal(pending.playerContinuable, true);
    assert.equal(pending.summary.revision, 3); assert.equal(digest(), before);
    assert.deepEqual(fs.readdirSync(path.dirname(identity.databasePath)), names);
    const reader = createSessionArchiveReader({ adventuresRoot });
    await assert.rejects(reader.open({ adventureId }), { code: "ARCHIVE_NOT_CLOSED" });
    finish(store, action); seal(store); store.close();
    const sealedHash = digest(); const stat = fs.statSync(identity.databasePath);
    const archived = await reader.open({ adventureId });
    assert.equal(archived.projection.storyFinale.projection.phase, "closed");
    assert.equal(archived.projection.history.length, 4);
    assert.equal(archived.projection.storyFinale.projection.closedFinale.continuationPolicy, "forbidden");
    assert.equal(archived.projection.panels.panels.some((panel) => panel.panelRef === "session_grey_crow_echo"), draw === 0);
    if (draw === 0) {
      const guide = await reader.readPanel({ adventureId, revision: 4, panelRef: "session_grey_crow_echo", view: "overview" });
      assert.equal(guide.panel.title, "灰鸦余响");
      assert.doesNotMatch(JSON.stringify(guide), /4440|44\.4|grey_crow_view|confirmations|fictionalContext|intentReason/);
    } else await assert.rejects(reader.readPanel({ adventureId, revision: 4, panelRef: "session_grey_crow_echo", view: "overview" }), { code: "SKILL_PANEL_NOT_SELECTED" });
    assert.equal(JSON.stringify(archived).includes('"outcome"'), false);
    assert.equal((await inspectSessionAdventure({ adventuresRoot, adventureId })).status, "closed");
    assert.equal(digest(), sealedHash); assert.equal(fs.statSync(identity.databasePath).mtimeMs, stat.mtimeMs);
    assert.deepEqual(fs.readdirSync(path.dirname(identity.databasePath)), names);
    const db = new DatabaseSync(identity.databasePath);
    const original = db.prepare("SELECT outcome FROM terminal_reservations").get().outcome;
    db.prepare("UPDATE terminal_reservations SET outcome=?").run(original === "grey_crow_view" ? "standard_extreme_ending" : "grey_crow_view");
    db.close();
    await assert.rejects(reader.open({ adventureId }), { code: "ARCHIVE_STATE_UNAVAILABLE" });
    assert.equal((await inspectSessionAdventure({ adventuresRoot, adventureId })).status, "unavailable");
    const restored = new DatabaseSync(identity.databasePath);
    restored.prepare("UPDATE terminal_reservations SET outcome=?").run(original);
    const row = restored.prepare("SELECT state_json FROM turns WHERE revision=4").get();
    const changed = JSON.parse(row.state_json); changed.finale.candidate.confirmations[1].sourceSegmentIds = ["not-written"];
    restored.prepare("UPDATE turns SET state_json=? WHERE revision=4").run(JSON.stringify(changed)); restored.close();
    const changedHash = digest();
    await assert.rejects(reader.open({ adventureId }), { code: "ARCHIVE_STATE_UNAVAILABLE" });
    assert.equal((await inspectSessionAdventure({ adventuresRoot, adventureId })).status, "unavailable");
    assert.equal(digest(), changedHash);
  });
}
