"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { createNewGameLifecycle } = require("./session-new-game-lifecycle");
const { readContentSnapshot } = require("../content-v2/snapshot-reader");
const { createTurnStore } = require("./turn-store");
const { createOpeningState } = require("./session-opening");
const { inspectSessionAdventure } = require("./session-catalog");

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-catalog-"));
  function writable(target) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return;
    fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
    if (stat.isDirectory()) for (const entry of fs.readdirSync(target)) writable(path.join(target, entry));
  }
  t.after(() => { writable(root); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

async function createSnapshot(root, locale = "zh-CN") {
  const adventuresRoot = path.join(root, "saves");
  const lifecycle = createNewGameLifecycle({ adventuresRoot,
    contentRoot: path.resolve(__dirname, "../../content"), libraryRoot: path.join(root, "library"),
    profileRoot: path.join(root, "profile"), adventureIdFactory: () => "save_catalog",
    adventureStore: { initializeFromContentSnapshot: async () => ({ adventureLocale: locale }) },
  });
  const catalog = await lifecycle.catalog();
  const prepared = await lifecycle.prepare({ preset: catalog.defaultPreset, adventureLocale: locale });
  const created = await lifecycle.create(prepared.createRequest);
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId: created.adventureId });
  return { adventuresRoot, adventureId: created.adventureId, snapshot,
    databasePath: path.join(adventuresRoot, created.adventureId, "session.sqlite") };
}

function hash(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

test("菜单遇独立连接独占锁立即返回可重试繁忙，不阻塞定时器；解锁后同存档可读且文件未改", async (t) => {
  const { DatabaseSync } = require("node:sqlite");
  const { performance } = require("node:perf_hooks");
  const context = await createSnapshot(temporary(t));
  createTurnStore({ ...context, locale: "zh-CN", contentVersion: context.snapshot.lock.overallHash,
    initialState: createOpeningState({ day: 10 }) }).close();
  const directory = path.dirname(context.databasePath);
  const before = { hash: hash(context.databasePath), stat: fs.statSync(context.databasePath), names: fs.readdirSync(directory).sort() };
  const blocker = new DatabaseSync(context.databasePath);
  const originalExec = DatabaseSync.prototype.exec;
  let enteredAt;
  let timer;
  // Arm the real timer at the synchronous SQLite boundary, so preceding async
  // snapshot IO cannot let the timer fire before the blocking call is exercised.
  t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
    if (/^PRAGMA busy_timeout=/.test(sql)) {
      enteredAt = performance.now();
      timer = new Promise((resolve) => setTimeout(() => resolve(performance.now() - enteredAt), 10));
    }
    return originalExec.call(this, sql);
  });
  try {
    blocker.exec("BEGIN EXCLUSIVE");
    const result = await inspectSessionAdventure(context);
    const sqliteElapsed = performance.now() - enteredAt;
    const timerElapsed = await timer;
    assert.equal(result.errorCode, "STORE_BUSY");
    assert.equal(result.retryable, true);
    assert.equal(result.playerContinuable, false);
    assert.equal(result.continuable, false);
    assert.equal(result.summary, null);
    assert.equal(result.revision, undefined);
    assert(sqliteElapsed < 500, `SQLite blocked the main loop for ${sqliteElapsed} ms`);
    assert(timerElapsed < 500, `10 ms timer took ${timerElapsed} ms`);
    t.diagnostic(`busy SQLite boundary ${sqliteElapsed.toFixed(2)} ms; 10 ms timer ${timerElapsed.toFixed(2)} ms`);
    blocker.exec("ROLLBACK");
    // Stop instrumenting once the lock boundary has been measured.
    DatabaseSync.prototype.exec.mock.restore();
    const restored = await inspectSessionAdventure(context);
    assert.equal(restored.status, "ready");
    assert.equal(restored.summary.adventureId, context.adventureId);
    assert.equal(restored.revision, 0);
    assert.equal(hash(context.databasePath), before.hash);
    assert.deepEqual(fs.readdirSync(directory).sort(), before.names);
    const after = fs.statSync(context.databasePath);
    for (const field of ["ino", "size", "mtimeMs", "ctimeMs", "mode"]) assert.equal(after[field], before.stat[field], field);
  } finally {
    try { blocker.exec("ROLLBACK"); } catch {}
    blocker.close();
  }
});

test("菜单从新数据库同一版本投影，未确认角色不伪造正式事实，读取不改数据库", async (t) => {
  const context = await createSnapshot(temporary(t), "ja-JP");
  const store = createTurnStore({ ...context, locale: "ja-JP", contentVersion: context.snapshot.lock.overallHash,
    initialState: createOpeningState({ day: 10 }) });
  store.close();
  const before = hash(context.databasePath);
  const inspected = await inspectSessionAdventure({ ...context, displayLocale: "ja-JP" });
  assert.equal(inspected.status, "ready");
  assert.equal(inspected.adventureLocale, "ja-JP");
  assert.equal(inspected.schemaKind, "session");
  assert.equal(inspected.summary.revision, 0);
  assert.equal(inspected.summary.state_hint.lifecycle.phase, "new_game_creation");
  assert.equal(inspected.summary.state_hint.scene.location, null);
  assert.equal(hash(context.databasePath), before);
  assert.equal(fs.existsSync(path.join(context.adventuresRoot, context.adventureId, "meta.json")), false);
  const resumed = createTurnStore({ ...context, locale: "ja-JP", contentVersion: context.snapshot.lock.overallHash });
  const action = resumed.beginAction({ actionId: "draft-name", baseRevision: 0, input: "名前はまだ決めていません。",
    locale: "ja-JP", contentVersion: context.snapshot.lock.overallHash });
  resumed.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
    bundle: { narration: [{ id: "ask", text: "名前は今は不明のままにしましょう。" }], events: [], experiences: [] } });
  resumed.close();
  const changed = hash(context.databasePath);
  const afterTurn = await inspectSessionAdventure(context);
  assert.equal(afterTurn.status, "ready");
  assert.equal(afterTurn.summary.revision, 1);
  assert.equal(afterTurn.summary.turn, 1);
  assert.equal(hash(context.databasePath), changed);
});

test("仅按文件身份识别旧存档，不把旧正文或元数据当作新运行状态", async (t) => {
  const root = temporary(t);
  const adventuresRoot = path.join(root, "saves");
  const directory = path.join(adventuresRoot, "save_old");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "state.json"), "invalid JSON with private story content");
  const inspected = await inspectSessionAdventure({ adventuresRoot, adventureId: "save_old" });
  assert.equal(inspected.schemaKind, "legacy");
  assert.equal(inspected.playerContinuable, false);
  assert.equal(inspected.errorCode, "SAVE_FORMAT_UNSUPPORTED");
  assert.equal(inspected.summary, null);
  assert.doesNotMatch(JSON.stringify(inspected), /private story/);
  assert.equal(fs.existsSync(path.join(directory, "session.sqlite")), false);
});

test("缺失数据库的快照不自动创建；跨身份和链接文件不会被当作可玩冒险", async (t) => {
  const context = await createSnapshot(temporary(t));
  assert.equal((await inspectSessionAdventure(context)).errorCode, "SESSION_DATABASE_MISSING");
  assert.equal(fs.existsSync(context.databasePath), false);
  const store = createTurnStore({ ...context, locale: "en-US", contentVersion: context.snapshot.lock.overallHash,
    initialState: createOpeningState() });
  store.close();
  const original = hash(context.databasePath);
  assert.equal((await inspectSessionAdventure(context)).errorCode, "SAVE_IDENTITY_MISMATCH");
  assert.equal(hash(context.databasePath), original);
  const moved = path.join(path.dirname(context.databasePath), "original.sqlite");
  fs.renameSync(context.databasePath, moved);
  fs.symlinkSync(moved, context.databasePath);
  assert.equal((await inspectSessionAdventure(context)).errorCode, "SAVE_PATH_INVALID");
  assert.equal(hash(moved), original);
});

test("导入格式标记不会被当作原生空前史，菜单与会话入口只读拒绝", async (t) => {
  const { DatabaseSync } = require("node:sqlite");
  const context = await createSnapshot(temporary(t));
  const options = { ...context, locale: "zh-CN", contentVersion: context.snapshot.lock.overallHash };
  createTurnStore({ ...options, initialState: createOpeningState() }).close();
  const db = new DatabaseSync(context.databasePath);
  try { db.exec("CREATE TABLE legacy_import (private_body TEXT)"); } finally { db.close(); }
  const before = hash(context.databasePath);
  const inspected = await inspectSessionAdventure(context);
  assert.equal(inspected.errorCode, "SAVE_FORMAT_UNSUPPORTED");
  assert.equal(inspected.playerContinuable, false);
  assert.equal(inspected.summary, null);
  assert.throws(() => createTurnStore(options), { code: "SAVE_FORMAT_UNSUPPORTED" });
  assert.equal(hash(context.databasePath), before);
});

test("数据库格式标识不匹配时菜单和正式入口一致拒绝，检查不修改文件", async (t) => {
  const { DatabaseSync } = require("node:sqlite");
  const context = await createSnapshot(temporary(t));
  const options = { ...context, locale: "zh-CN", contentVersion: context.snapshot.lock.overallHash };
  createTurnStore({ ...options, initialState: createOpeningState() }).close();
  for (const pragma of [
    "PRAGMA application_id=0; PRAGMA user_version=1;",
    "PRAGMA application_id=1195594545; PRAGMA user_version=2;",
  ]) {
    const db = new DatabaseSync(context.databasePath);
    try { db.exec(pragma); } finally { db.close(); }
    const before = hash(context.databasePath);
    const names = fs.readdirSync(path.dirname(context.databasePath)).sort();
    const inspected = await inspectSessionAdventure(context);
    assert.equal(inspected.status, "unavailable");
    assert.equal(inspected.playerContinuable, false);
    assert.equal(inspected.errorCode, "SAVE_FORMAT_UNSUPPORTED");
    assert.equal(inspected.summary, null);
    assert.throws(() => createTurnStore(options), { code: "SAVE_FORMAT_UNSUPPORTED" });
    assert.equal(hash(context.databasePath), before);
    assert.deepEqual(fs.readdirSync(path.dirname(context.databasePath)).sort(), names);
  }
});

test("菜单拒绝WAL格式且不创建日志或共享内存文件", async (t) => {
  const { DatabaseSync } = require("node:sqlite");
  const context = await createSnapshot(temporary(t));
  createTurnStore({ ...context, locale: "zh-CN", contentVersion: context.snapshot.lock.overallHash,
    initialState: createOpeningState() }).close();
  const db = new DatabaseSync(context.databasePath);
  try { assert.equal(db.prepare("PRAGMA journal_mode=WAL").get().journal_mode, "wal"); }
  finally { db.close(); }
  const directory = path.dirname(context.databasePath);
  const names = fs.readdirSync(directory).sort();
  assert.equal(names.includes("session.sqlite-wal"), false);
  assert.equal(names.includes("session.sqlite-shm"), false);
  const before = hash(context.databasePath);
  const inspected = await inspectSessionAdventure(context);
  assert.equal(inspected.status, "unavailable");
  assert.equal(inspected.playerContinuable, false);
  assert.equal(inspected.errorCode, "SAVE_FORMAT_UNSUPPORTED");
  assert.equal(hash(context.databasePath), before);
  assert.deepEqual(fs.readdirSync(directory).sort(), names);
});

test("单个存档目录不可读时返回固定错误并保留其他正常存档列表", async (t) => {
  const { createSaveSlotStore } = require("../../apps/desktop/electron/save-slots");
  const root = temporary(t);
  const context = await createSnapshot(root);
  createTurnStore({ ...context, locale: "zh-CN", contentVersion: context.snapshot.lock.overallHash,
    initialState: createOpeningState() }).close();
  const unreadableId = "save_unreadable";
  const unreadable = path.join(context.adventuresRoot, unreadableId);
  fs.mkdirSync(unreadable);
  fs.chmodSync(unreadable, 0);
  try {
    let denied = false;
    try { fs.readdirSync(unreadable); }
    catch (error) {
      assert.ok(["EACCES", "EPERM"].includes(error.code));
      denied = true;
    }
    if (!denied) {
      t.skip("当前进程可绕过目录读取权限，无法真实复现拒绝访问");
      return;
    }
    const inspected = await inspectSessionAdventure({ adventuresRoot: context.adventuresRoot, adventureId: unreadableId });
    assert.equal(inspected.status, "unavailable");
    assert.equal(inspected.errorCode, "SAVE_ACCESS_DENIED");
    assert.equal(inspected.playerContinuable, false);
    assert.equal(JSON.stringify(inspected).includes(root), false);
    const summaries = await createSaveSlotStore({ dataRoot: root, sessionRuntime: true }).list();
    assert.equal(summaries.length, 2);
    assert.equal(summaries.find((entry) => entry.id === context.adventureId).compatibility.playerContinuable, true);
    const unavailable = summaries.find((entry) => entry.id === unreadableId);
    assert.equal(unavailable.compatibility.errorCode, "SAVE_ACCESS_DENIED");
    assert.equal(unavailable.compatibility.playerContinuable, false);
    assert.equal(JSON.stringify(summaries).includes(root), false);
  } finally { fs.chmodSync(unreadable, 0o700); }
});

async function confirmedCatalogFixture(t) {
  const samples = require("./test-fixtures/turn-samples");
  const context = await createSnapshot(temporary(t));
  const options = { ...context, locale: "zh-CN", contentVersion: context.snapshot.lock.overallHash };
  const store = createTurnStore({ ...options, initialState: samples.initialState() });
  t.after(() => store.close());
  const proposal = { narration: [{ id: "proposal", text: "这段故事可以在此结束，你愿意吗？" }],
    events: [{ id: "offer", type: "finale.propose", sourceSegmentIds: ["proposal"], data: {
      candidateId: "ending-one", closureReason: "主要选择已经落定。", closedThreads: ["离开的决定已作出。"],
      intentionalOpenThreads: [], finaleTone: "平静" } }], experiences: [] };
  function commit(revision, bundle) {
    const action = store.beginAction({ actionId: `end-${revision}`, baseRevision: revision - 1,
      input: revision === 2 ? "就在这里结束。" : "看看现在的局势。", locale: options.locale, contentVersion: options.contentVersion });
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
  }
  commit(1, proposal);
  const pendingCandidate = await inspectSessionAdventure(context);
  assert.equal(pendingCandidate.status, "ready");
  assert.equal(pendingCandidate.summary.catalogRole, "active");
  commit(2, { narration: [{ id: "last", text: "你走出楼道，向这里告别。故事到此结束。" }],
    events: [{ id: "finish", type: "finale.confirm", sourceSegmentIds: ["last"], data: { candidateId: "ending-one" } }], experiences: [] });
  return { ...context, options, store };
}

test("菜单只读识别待封存与已封存：恢复入口可选但故事输入锁住，归档进入 archive 分类", async (t) => {
  const context = await confirmedCatalogFixture(t);
  const directory = path.dirname(context.databasePath);
  let before = hash(context.databasePath);
  let names = fs.readdirSync(directory).sort();
  const pending = await inspectSessionAdventure(context);
  assert.equal(pending.status, "recovery_required");
  assert.equal(pending.playerContinuable, true);
  assert.equal(pending.summary.catalogRole, "active");
  assert.equal(pending.summary.compatibility.status, "recovery_required");
  assert.equal(pending.errorCode, "FINALE_RECOVERY_REQUIRED");
  assert.equal(hash(context.databasePath), before);
  assert.deepEqual(fs.readdirSync(directory).sort(), names);
  const job = context.store.beginChapter({ targetRevision: 2 });
  context.store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: {
    title: "楼道的告别", summary: "你选择结束这段故事。", keyEvents: [{ text: "你已走出楼道。",
      sources: [{ revision: 2, segmentId: "last" }] }], openThreads: [], mode: "model" } });
  context.store.sealFinale({ finaleId: "finale-2", chapterId: job.chapterId });
  context.store.close();
  before = hash(context.databasePath); names = fs.readdirSync(directory).sort();
  const closed = await inspectSessionAdventure(context);
  assert.equal(closed.status, "closed");
  assert.equal(closed.playerContinuable, false);
  assert.equal(closed.continuable, false);
  assert.equal(closed.summary.catalogRole, "archive");
  assert.equal(closed.summary.compatibility.status, "closed");
  assert.equal(closed.summary.revision, 2);
  assert.equal(hash(context.databasePath), before);
  assert.deepEqual(fs.readdirSync(directory).sort(), names);
});

test("确认旧文件没有 finale 表时菜单仅标记待恢复，不建表或修改数据", async (t) => {
  const { DatabaseSync } = require("node:sqlite");
  const context = await confirmedCatalogFixture(t);
  context.store.close();
  const db = new DatabaseSync(context.databasePath);
  db.exec("DROP TABLE finale_archives"); db.close();
  const before = hash(context.databasePath);
  const names = fs.readdirSync(path.dirname(context.databasePath)).sort();
  const inspected = await inspectSessionAdventure(context);
  assert.equal(inspected.status, "recovery_required");
  assert.equal(inspected.playerContinuable, true);
  assert.equal(inspected.summary.revision, 2);
  assert.equal(hash(context.databasePath), before);
  assert.deepEqual(fs.readdirSync(path.dirname(context.databasePath)).sort(), names);
  const readonly = new DatabaseSync(context.databasePath, { readOnly: true });
  assert.equal(readonly.prepare("SELECT name FROM sqlite_master WHERE name='finale_archives'").get(), undefined);
  readonly.close();
  const resumed = createTurnStore(context.options);
  assert.equal(resumed.readFinale().archive.status, "pending");
  assert.equal(resumed.readView().history.length, 2);
  resumed.close();
});

test("归档确认身份不符的存档不能在菜单冒充正常封存，检查保持只读", async (t) => {
  const { DatabaseSync } = require("node:sqlite");
  const context = await confirmedCatalogFixture(t);
  context.store.close();
  const db = new DatabaseSync(context.databasePath);
  db.prepare("UPDATE finale_archives SET candidate_id=?").run("different-ending"); db.close();
  const before = hash(context.databasePath);
  const inspected = await inspectSessionAdventure(context);
  assert.equal(inspected.status, "unavailable");
  assert.equal(inspected.playerContinuable, false);
  assert.equal(inspected.errorCode, "SESSION_INSPECTION_FAILED");
  assert.equal(inspected.summary, null);
  assert.equal(hash(context.databasePath), before);
  assert.throws(() => createTurnStore(context.options), { code: "FINALE_IDENTITY_MISMATCH" });
});
