"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createNewGameLifecycle } = require("./session-new-game-lifecycle");
const { createTurnStore } = require("./turn-store");
const { createOpeningState } = require("./session-opening");
const { readContentSnapshot } = require("../content-v2/snapshot-reader");
const { makeTreeWritable } = require("../content-v2/snapshot-utils");

async function setup(t, { failInitialization = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-native-new-game-")));
  t.after(async () => { await makeTreeWritable(root); await fs.rm(root, { recursive: true, force: true }); });
  const adventuresRoot = path.join(root, "saves");
  let initialized = 0;
  const lifecycle = createNewGameLifecycle({ adventuresRoot, contentRoot: path.resolve(__dirname, "../../content"),
    libraryRoot: path.join(root, "library"), profileRoot: path.join(root, "profile"), adventureIdFactory: () => "fresh-session",
    adventureStore: { async initializeFromContentSnapshot({ adventureId, adventureLocale }) {
      initialized++;
      if (failInitialization) throw Object.assign(new Error("synthetic initialization failure"), { code: "SESSION_INITIALIZATION_FAILED" });
      const snapshot = await readContentSnapshot({ adventuresRoot, adventureId });
      const store = createTurnStore({ databasePath: path.join(adventuresRoot, adventureId, "session.sqlite"),
        adventureId, locale: adventureLocale, contentVersion: snapshot.lock.overallHash, initialState: createOpeningState() });
      try { const view = store.readView(); return { adventureId, adventureLocale, revision: view.revision, state: view.state }; }
      finally { store.close(); }
    } } });
  return { root, adventuresRoot, lifecycle, initialized: () => initialized };
}

test("new-game content flow requires an explicit session store, without an old engine fallback", () => {
  assert.throws(() => createNewGameLifecycle({}), { code: "NEW_GAME_STORE_REQUIRED" });
  assert.ok(Object.keys(require.cache).every((filename) => !filename.includes(`${path.sep}adventure-v2${path.sep}`)
    && !filename.includes(`${path.sep}agent${path.sep}runner${path.sep}`)));
});

for (const locale of ["zh-CN", "en-US", "ja-JP"]) test(`new ${locale} adventure locks approved content and starts an unconfirmed native R0`, async (t) => {
  const env = await setup(t);
  const catalog = await env.lifecycle.catalog();
  const prepared = await env.lifecycle.prepare({ preset: catalog.defaultPreset, adventureLocale: locale });
  assert.equal(prepared.review.localeCoverage.status, "ready");
  const created = await env.lifecycle.create(prepared.createRequest);
  assert.equal(created.inspection.adventureLocale, locale);
  assert.equal(created.inspection.revision, 0);
  assert.equal(created.inspection.state.opening.phase, "creating");
  assert.equal(created.inspection.state.situation.playerId, null);
  assert.equal(created.lockedContent.integrityStatus, "locked");
  assert.equal(created.lockedContent.language, locale);
  assert.equal(env.initialized(), 1);
  const files = await fs.readdir(path.join(env.adventuresRoot, created.adventureId));
  assert.ok(files.includes("session.sqlite"));
  for (const legacy of ["state.json", "save-schema.json", "transcript", "memory"]) assert.ok(!files.includes(legacy));
});

test("stale content confirmation is rejected before creation and failed initialization removes only its partial new directory", async (t) => {
  const env = await setup(t, { failInitialization: true });
  const catalog = await env.lifecycle.catalog();
  const prepared = await env.lifecycle.prepare({ preset: catalog.defaultPreset, adventureLocale: "zh-CN" });
  await assert.rejects(env.lifecycle.create({ ...prepared.createRequest, contentFingerprint: "changed" }), { code: "NEW_GAME_CONFIRMATION_STALE" });
  assert.equal(env.initialized(), 0);
  const oldRoot = path.join(env.adventuresRoot, "old-unsupported");
  await fs.mkdir(oldRoot, { recursive: true });
  await fs.writeFile(path.join(oldRoot, "unchanged.txt"), "original file stays here");
  await assert.rejects(env.lifecycle.create(prepared.createRequest), { code: "SESSION_INITIALIZATION_FAILED" });
  assert.equal(await fs.readFile(path.join(oldRoot, "unchanged.txt"), "utf8"), "original file stays here");
  assert.deepEqual(await fs.readdir(env.adventuresRoot), ["old-unsupported"]);
});
