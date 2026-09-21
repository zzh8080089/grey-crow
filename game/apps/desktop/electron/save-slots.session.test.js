"use strict";

const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { createSaveSlotStore, DELETE_CONFIRMATION_TTL_MS } = require("./save-slots");
const { createNewGameLifecycle } = require("../../../engine/session/session-new-game-lifecycle");
const { readContentSnapshot } = require("../../../engine/content-v2/snapshot-reader");
const { createTurnStore } = require("../../../engine/session/turn-store");
const { createOpeningState } = require("../../../engine/session/session-opening");

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-save-slots-session-"));
  function writable(target) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory() || stat.nlink === 1) fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
    if (stat.isDirectory()) for (const entry of fs.readdirSync(target)) writable(path.join(target, entry));
  }
  t.after(() => { writable(root); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

async function fixture(t, locale = "zh-CN", initialState = createOpeningState({ day: 10 })) {
  const dataRoot = temporary(t);
  const adventuresRoot = path.join(dataRoot, "saves");
  const lifecycle = createNewGameLifecycle({ adventuresRoot,
    contentRoot: path.resolve(__dirname, "../../../content"), libraryRoot: path.join(dataRoot, "library"),
    profileRoot: path.join(dataRoot, "profile"), adventureIdFactory: () => "save_session",
    adventureStore: { initializeFromContentSnapshot: async () => ({ adventureLocale: locale }) },
  });
  const catalog = await lifecycle.catalog();
  const prepared = await lifecycle.prepare({ preset: catalog.defaultPreset, adventureLocale: locale });
  const created = await lifecycle.create(prepared.createRequest);
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId: created.adventureId });
  const saveDir = path.join(adventuresRoot, created.adventureId);
  const identity = { databasePath: path.join(saveDir, "session.sqlite"), adventureId: created.adventureId,
    locale, contentVersion: snapshot.lock.overallHash };
  createTurnStore({ ...identity, initialState }).close();
  return { dataRoot, adventuresRoot, saveDir, identity, snapshot };
}

function hash(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function code(expected) { return (error) => { assert.equal(error.code, expected, error.stack); return true; }; }

test("繁忙存档仍保留菜单身份和未知版本，只有繁忙可重试，解锁后重新读取同档", async (t) => {
  const { DatabaseSync } = require("node:sqlite");
  const context = await fixture(t);
  const slots = createSaveSlotStore({ dataRoot: context.dataRoot });
  const before = hash(context.identity.databasePath);
  const names = fs.readdirSync(context.saveDir).sort();
  const blocker = new DatabaseSync(context.identity.databasePath);
  try {
    blocker.exec("BEGIN EXCLUSIVE");
    const listed = await slots.list();
    assert.equal(listed.length, 1);
    const [summary] = listed;
    assert.equal(summary.id, context.identity.adventureId);
    assert.equal(summary.adventureId, summary.id);
    assert.equal(summary.catalogRole, "unavailable");
    assert.equal(summary.compatibility.errorCode, "STORE_BUSY");
    assert.equal(summary.compatibility.retryable, true);
    assert.equal(summary.compatibility.playerContinuable, false);
    for (const field of ["revision", "actionId", "state_hint", "turn", "updatedAt"]) assert.equal(summary[field], null);
    await assert.rejects(slots.compatibilityGate.openForPlayer(summary.id), (error) => {
      assert.equal(error.code, "STORE_BUSY");
      assert.equal(error.retryable, true);
      return true;
    });
    await assert.rejects(slots.compatibilityGate.openForPlayer("missing"), (error) => {
      assert.equal(error.code, "ADVENTURE_NOT_CONTINUABLE");
      assert.equal(error.retryable, false);
      return true;
    });
    blocker.exec("ROLLBACK");
    const recovered = await slots.get(summary.id);
    assert.equal(recovered.id, summary.id);
    assert.equal(recovered.revision, 0);
    assert.equal(recovered.compatibility.status, "ready");
    assert.equal((await slots.compatibilityGate.openForPlayer(summary.id)).revision, 0);
    assert.equal(hash(context.identity.databasePath), before);
    assert.deepEqual(fs.readdirSync(context.saveDir).sort(), names);
  } finally {
    try { blocker.exec("ROLLBACK"); } catch {}
    blocker.close();
  }
});

function seed() {
  const entities = Object.fromEntries([
    ["player", "character", "旅人"], ["hall", "location", "楼道"], ["yard", "location", "庭院"],
    ["rice", "item", "米"], ["hidden", "character", "未遇见的人"],
  ].map(([id, kind, name]) => [id, { id, kind, name, aliases: [],
    visibility: id === "hidden" ? "hidden" : "player", attributes: {} }]));
  entities.yard.attributes.localizedNames = { "zh-CN": "庭院", "en-US": "Courtyard", "ja-JP": "中庭" };
  return { entities, inventory: [], commitments: {}, situation: { playerId: "player", locationId: "hall", day: 10 } };
}

test("新菜单、恢复和继续只读同一提交版本的三语状态，不采用旁置旧 JSON", async (t) => {
  for (const [locale, location, condition] of [["zh-CN", "庭院", "疲惫，右手已包扎"], ["en-US", "Courtyard", "Tired, with a bandaged right hand"], ["ja-JP", "中庭", "疲労が強く、右手は包帯で保護されている"]]) {
    await t.test(locale, async (t) => {
      const initial = seed(); initial.entities.player.attributes.status = condition;
      const context = await fixture(t, locale, initial);
      const db = createTurnStore(context.identity);
      const action = db.beginAction({ actionId: "go-yard", baseRevision: 0, input: "去庭院取米。",
        locale, contentVersion: context.identity.contentVersion });
      db.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: {
        narration: [{ id: "s", text: "你走进庭院，取出一袋米。" }], experiences: [], events: [
          { id: "move", type: "situation.update", sourceSegmentIds: ["s"], data: { locationId: "yard", day: 11 } },
          { id: "gain", type: "inventory.adjust", sourceSegmentIds: ["s"], data: { ownerId: "player", itemId: "rice", delta: 1 } },
        ],
      } });
      db.close();
      fs.writeFileSync(path.join(context.saveDir, "meta.json"), JSON.stringify({ title: "旧标题不应显示" }));
      fs.writeFileSync(path.join(context.saveDir, "state.json"), JSON.stringify({ version: 999,
        scene: { location: "过期地点" }, player: { status: "旧私密状态" }, time: { turn: 999 } }));
      const before = hash(context.identity.databasePath);
      const slots = createSaveSlotStore({ dataRoot: context.dataRoot, displayLocale: locale });
      const listed = await slots.list();
      assert.equal(listed.length, 1);
      const summary = listed[0];
      assert.equal(summary.id, context.identity.adventureId);
      assert.equal(summary.adventureId, summary.id);
      assert.equal(summary.revision, 1);
      assert.equal(summary.actionId, "go-yard");
      assert.equal(summary.turn, 1);
      assert.equal(summary.title, location);
      assert.equal(summary.state_hint.revision, 1);
      assert.equal(summary.state_hint.scene.location, location);
      assert.equal(summary.state_hint.time.day, 11);
      assert.equal(summary.state_hint.inventory.count, 1);
      assert.equal(summary.adventureLocale, locale);
      assert.equal(summary.compatibility.playerContinuable, true);
      assert.doesNotMatch(JSON.stringify(summary), /旧标题|过期地点|旧私密状态|未遇见的人/);
      assert.equal(summary.state_hint.player.status, condition, "walking and gaining an item do not rewrite the pre-existing bodily condition");
      assert.deepEqual(await slots.get(summary.id), summary);
      assert.deepEqual(await slots.restore(summary.id), summary);
      const { openForPlayer } = slots.compatibilityGate;
      const inspected = await openForPlayer(summary.id);
      assert.equal(inspected.revision, summary.revision);
      assert.deepEqual(inspected.summary, summary);
      assert.equal((await slots.compatibilityGate.list())[0].revision, 1);
      assert.equal(hash(context.identity.databasePath), before);
      assert.equal(fs.existsSync(path.join(context.saveDir, "snapshots.jsonl")), false);
    });
  }
});

test("未确认的真实内容快照显示开局状态，不创建正式人物；旧写能力明确拒绝", async (t) => {
  const context = await fixture(t, "ja-JP");
  const slots = createSaveSlotStore({ dataRoot: context.dataRoot, displayLocale: "ja-JP" });
  const summary = await slots.get(context.identity.adventureId);
  assert.equal(summary.title, "現在の冒険");
  assert.equal(summary.state_hint.lifecycle.phase, "new_game_creation");
  assert.equal(summary.state_hint.scene.location, null);
  assert.equal(summary.state_hint.opening.status_label, "キャラクター作成中");
  const before = hash(context.identity.databasePath);
  const names = fs.readdirSync(context.saveDir).sort();
  for (const name of ["create", "rename", "snapshot", "requestOverwrite", "overwrite"]) assert.equal(slots[name], undefined);
  assert.equal(slots.compatibilityGate.openInternalV1Fallback, undefined);
  assert.deepEqual(fs.readdirSync(context.saveDir).sort(), names);
  assert.equal(hash(context.identity.databasePath), before);
});

test("空菜单和缺失存档不建目录或数据库；旧格式明确不兼容且不读旧状态", async (t) => {
  const root = temporary(t);
  const dataRoot = path.join(root, "not-created");
  const empty = createSaveSlotStore({ dataRoot });
  assert.deepEqual(await empty.list(), []);
  assert.deepEqual(await empty.compatibilityGate.list(), []);
  assert.equal(await empty.get("missing"), null);
  await assert.rejects(empty.compatibilityGate.openForPlayer("missing"), code("ADVENTURE_NOT_CONTINUABLE"));
  assert.equal(empty.create, undefined);
  assert.equal(fs.existsSync(dataRoot), false);
  const old = path.join(root, "saves", "save_old");
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, "state.json"), "invalid JSON with private historical text");
  fs.writeFileSync(path.join(old, "meta.json"), JSON.stringify({ title: "private old title" }));
  const slots = createSaveSlotStore({ dataRoot: root });
  const summary = (await slots.list())[0];
  assert.equal(summary.compatibility.errorCode, "SAVE_FORMAT_UNSUPPORTED");
  assert.equal(summary.compatibility.playerContinuable, false);
  assert.equal(summary.schemaKind, "legacy");
  assert.equal(summary.revision, null);
  assert.equal(summary.state_hint, null);
  assert.doesNotMatch(JSON.stringify(summary), /private/);
  await assert.rejects(slots.compatibilityGate.openForPlayer("save_old"), code("SAVE_FORMAT_UNSUPPORTED"));
  assert.equal(fs.existsSync(path.join(old, "session.sqlite")), false);
});

test("默认存档接口只提供新格式读取和受控删除，不暴露旧执行回退", async (t) => {
  const context = await fixture(t);
  const before = hash(context.identity.databasePath);
  const slots = createSaveSlotStore({ dataRoot: context.dataRoot });
  const summary = await slots.get(context.identity.adventureId);
  assert.equal(summary.schemaKind, "session");
  assert.equal(summary.compatibility.playerContinuable, true);
  assert.equal(summary.revision, 0);
  assert.equal(slots.compatibilityGate.openInternalV1Fallback, undefined);
  for (const name of ["create", "rename", "snapshot", "requestOverwrite", "overwrite"]) assert.equal(slots[name], undefined);
  assert.equal(hash(context.identity.databasePath), before);
});

test("新模式拒绝目录及数据库链接；已确认删除不触及外部链接的内容和权限", async (t) => {
  const context = await fixture(t);
  const slots = createSaveSlotStore({ dataRoot: context.dataRoot });
  const outside = path.join(context.dataRoot, "external.sqlite");
  fs.renameSync(context.identity.databasePath, outside);
  const before = hash(outside);
  fs.chmodSync(outside, 0o400);
  const mode = fs.statSync(outside).mode;
  fs.symlinkSync(outside, context.identity.databasePath);
  assert.equal((await slots.get(context.identity.adventureId)).compatibility.errorCode, "SAVE_PATH_INVALID");
  await assert.rejects(slots.compatibilityGate.openForPlayer(context.identity.adventureId), code("SAVE_PATH_INVALID"));
  fs.unlinkSync(context.identity.databasePath);
  fs.linkSync(outside, context.identity.databasePath);
  assert.equal((await slots.get(context.identity.adventureId)).compatibility.errorCode, "SAVE_PATH_INVALID");
  fs.symlinkSync(context.saveDir, path.join(context.adventuresRoot, "directory_link"));
  assert.equal(await slots.get("directory_link"), null);
  assert.equal(await slots.deleteConfirmed("directory_link"), null);
  assert.equal((await slots.list()).length, 1);
  const confirmation = await slots.requestDelete(context.identity.adventureId);
  await slots.delete(context.identity.adventureId, { confirmationToken: confirmation.confirmationToken });
  assert.equal(hash(outside), before);
  assert.equal(fs.statSync(outside).mode, mode);
  assert.equal(fs.statSync(outside).nlink, 1);
  assert.equal(fs.existsSync(context.saveDir), false);
  assert.equal(fs.readdirSync(context.adventuresRoot).some((name) => name.includes("deleting-")), false);
  fs.unlinkSync(path.join(context.adventuresRoot, "directory_link"));
  fs.rmdirSync(context.adventuresRoot);
  const outsideRoot = path.join(context.dataRoot, "outside-saves");
  fs.mkdirSync(outsideRoot);
  fs.symlinkSync(outsideRoot, context.adventuresRoot);
  for (const operation of [() => slots.list(), () => slots.get("missing"),
    () => slots.compatibilityGate.inspect("missing"), () => slots.deleteConfirmed("missing")]) {
    await assert.rejects(operation(), code("SAVE_PATH_INVALID"));
  }
  assert.deepEqual(fs.readdirSync(outsideRoot), []);
});

test("新模式删除保留冒险和有效期确认边界，能清理只读内容快照", async (t) => {
  const context = await fixture(t);
  let time = Date.parse("2026-09-10T10:00:00Z");
  const slots = createSaveSlotStore({ dataRoot: context.dataRoot, clock: () => new Date(time) });
  const id = context.identity.adventureId;
  const request = await slots.requestDelete(id);
  await assert.rejects(slots.delete(id), /valid runtime confirmation token/);
  await assert.rejects(slots.delete("another", { confirmationToken: request.confirmationToken }), /valid runtime confirmation token/);
  time += DELETE_CONFIRMATION_TTL_MS;
  await assert.rejects(slots.delete(id, { confirmationToken: request.confirmationToken }), /valid runtime confirmation token/);
  assert.equal(fs.existsSync(context.saveDir), true);
  const fresh = await slots.requestDelete(id);
  assert.equal(fresh.save.compatibility.deleteAllowed, true);
  assert.deepEqual(await slots.delete(id, { confirmationToken: fresh.confirmationToken }), { ok: true, deleted: true, saveId: id });
  assert.equal(await slots.get(id), null);
  assert.deepEqual(await slots.list(), []);
  await assert.rejects(slots.delete(id, { confirmationToken: fresh.confirmationToken }), /valid runtime confirmation token/);
  assert.deepEqual(fs.readdirSync(context.adventuresRoot), []);
});

test("删档部分失败保留持久删除意图，不把残缺目录恢复为可玩存档，并可重启后重试", async (t) => {
  const context = await fixture(t); const slots = createSaveSlotStore({ dataRoot: context.dataRoot });
  const originalRm = fsPromises.rm; let failed = false;
  fsPromises.rm = async (target, options) => {
    if (!failed && String(target).includes(".delete-intent-")) {
      failed = true;
      fs.unlinkSync(path.join(target, "session.sqlite"));
      fs.unlinkSync(path.join(target, ".delete-intent.json"));
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    }
    return originalRm(target, options);
  };
  try {
    const confirmation = await slots.requestDelete(context.identity.adventureId);
    await assert.rejects(slots.delete(context.identity.adventureId, { confirmationToken: confirmation.confirmationToken }), code("SAVE_DELETE_PENDING"));
  } finally { fsPromises.rm = originalRm; }
  assert.equal(await slots.get(context.identity.adventureId), null, "a partial deletion must never return as a playable directory");
  assert.deepEqual(await slots.list(), [], "pending deletion must not be silently menu-hidden as a normal save");
  const restarted = createSaveSlotStore({ dataRoot: context.dataRoot });
  const pending = await restarted.listPendingDeletes();
  assert.equal(pending.length, 1); assert.equal(pending[0].saveId, context.identity.adventureId); assert.equal(pending[0].state, "delete_pending");
  assert.match(pending[0].deletionId, /^\.delete-intent-save_session-[a-f0-9]{16}$/); assert.equal(JSON.stringify(pending).includes(context.dataRoot), false);
  const external = path.join(context.dataRoot, "settings.json"); fs.writeFileSync(external, "global-settings");
  fs.mkdirSync(context.saveDir);
  fs.writeFileSync(path.join(context.saveDir, "new-story.txt"), "new-save-with-the-same-id");
  assert.equal(await restarted.retryPendingDelete(".delete-intent-save_session-forged00000000"), null, "a forged tombstone id must not select any path");
  assert.deepEqual(await restarted.retryPendingDelete(pending[0].deletionId), { ok: true, deleted: true, saveId: context.identity.adventureId, deletionId: pending[0].deletionId, recoveredDelete: true });
  assert.equal(fs.readFileSync(external, "utf8"), "global-settings");
  assert.equal(fs.readFileSync(path.join(context.saveDir, "new-story.txt"), "utf8"), "new-save-with-the-same-id");
  assert.deepEqual(await restarted.listPendingDeletes(), []);
});

test("旧删除墓碑可精确清理，但伪造路径和链接不是清理目标", async (t) => {
  const context = await fixture(t);
  const oldName = `.${context.identity.adventureId}.deleting-0123456789abcdef`;
  fs.renameSync(context.saveDir, path.join(context.adventuresRoot, oldName));
  const outside = path.join(context.dataRoot, "outside"); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "keep.txt"), "keep");
  fs.symlinkSync(outside, path.join(context.adventuresRoot, ".linked.deleting-0123456789abcdef"), "dir");
  fs.mkdirSync(path.join(context.adventuresRoot, ".foreign.deleting-not-a-nonce"));
  const store = createSaveSlotStore({ dataRoot: context.dataRoot });
  assert.deepEqual((await store.listPendingDeletes()).map(item => item.deletionId), [oldName]);
  assert.equal(await store.retryPendingDelete("../outside"), null);
  assert.equal(await store.retryPendingDelete(".linked.deleting-0123456789abcdef"), null);
  assert.equal((await store.retryPendingDelete(oldName)).deleted, true);
  assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "keep");
  assert(fs.existsSync(path.join(context.adventuresRoot, ".foreign.deleting-not-a-nonce")));
});

test("热恢复日志在菜单和选择时保持原样，真正重开才回滚未提交的大轮次", async (t) => {
  const context = await fixture(t);
  const source = `
    const { createTurnStore } = require(${JSON.stringify(require.resolve("../../../engine/session/turn-store"))});
    const identity = JSON.parse(process.argv[1]);
    const db = createTurnStore({ ...identity, faultInjector(stage) { if (stage === 'after_experiences') process.exit(73); } });
    const action = db.beginAction({ actionId: 'interrupted', baseRevision: 0, input: '继续讨论开局。',
      locale: identity.locale, contentVersion: identity.contentVersion });
    db.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
      bundle: { narration: Array.from({ length: 24 }, (_, i) => ({ id: 's' + i, text: 'x'.repeat(100000) })), events: [], experiences: [] } });
  `;
  const result = spawnSync(process.execPath, ["-e", source, JSON.stringify(context.identity)], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 73, result.stderr);
  const journal = `${context.identity.databasePath}-journal`;
  assert.notDeepEqual(fs.readFileSync(journal).subarray(0, 8), Buffer.alloc(8));
  const before = [hash(context.identity.databasePath), hash(journal)];
  const slots = createSaveSlotStore({ dataRoot: context.dataRoot });
  const summary = (await slots.list())[0];
  assert.equal(summary.compatibility.status, "recovery_required");
  assert.equal(summary.compatibility.errorCode, "SESSION_RECOVERY_REQUIRED");
  assert.equal(summary.compatibility.playerContinuable, true);
  assert.equal(summary.catalogRole, "active");
  assert.equal(summary.revision, null);
  assert.equal(summary.turn, null);
  assert.equal(summary.state_hint, null);
  assert.equal((await slots.compatibilityGate.openForPlayer(summary.id)).status, "recovery_required");
  assert.deepEqual([hash(context.identity.databasePath), hash(journal)], before);
  const resumed = createTurnStore(context.identity);
  assert.equal(resumed.readView().revision, 0);
  assert.equal(resumed.readAction("interrupted").status, "interrupted");
  resumed.close();
  assert.equal((await slots.get(summary.id)).compatibility.status, "ready");
});
