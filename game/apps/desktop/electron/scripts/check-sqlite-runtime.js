#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function runSessionSqliteChecks() {
  const { DatabaseSync } = require("node:sqlite");
  const { createTurnStore } = require("../../../../engine/session/turn-store");
  const samples = require("../../../../engine/session/test-fixtures/turn-samples");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-native-sqlite-"));
  const options = samples.identity(path.join(root, "session.sqlite"));
  let store;
  let injectRollback = true;
  try {
    store = createTurnStore({ ...options, initialState: samples.initialState(), faultInjector(stage) {
      if (injectRollback && stage === "after_revision") throw Object.assign(new Error("SYNTHETIC_ROLLBACK"), { code: "SYNTHETIC_ROLLBACK" });
    } });
    const request = samples.request();
    const started = store.beginAction(request);
    const commit = () => store.commitAction({ actionId: started.actionId, attemptId: started.attemptId, bundle: samples.borrowBundle() });
    assert.throws(commit, { code: "SYNTHETIC_ROLLBACK" });
    assert.equal(store.readView().revision, 0);
    assert.equal(store.readAction(started.actionId).status, "running");
    assert.deepEqual(store.readModelState(), samples.initialState());
    injectRollback = false;
    const committed = commit();
    assert.equal(committed.status, "committed");
    assert.equal(committed.view.revision, 1);
    assert.equal(committed.view.state.commitments["rice-promise"].status, "open");
    assert.equal(committed.view.state.inventory.find((item) => item.itemId === "rice").quantity, 2);
    assert.equal(Object.hasOwn(committed.view.state.entities, "secret"), false);
    store.close();
    store = createTurnStore(options);
    assert.equal(store.readAction(request.actionId).status, "committed");
    assert.equal(store.beginAction(request).status, "committed");
    assert.equal(store.readView().revision, 1);
    assert.deepEqual(store.readTurn(1).narration, samples.borrowBundle().narration);
    assert.equal(store.listExperienceRecords({ revision: 1, viewerId: "p" }).records.length, 1);
    store.close();
    store = null;
    const db = new DatabaseSync(options.databasePath, { readOnly: true });
    let sqliteVersion;
    try {
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.equal(db.prepare("PRAGMA application_id").get().application_id, 0x47435331);
      sqliteVersion = db.prepare("SELECT sqlite_version() AS version").get().version;
    } finally { db.close(); }
    return { name: "native-session-sqlite", ok: true, runtime: process.versions.electron ? "electron-node" : "node",
      sqliteVersion, checks: { atomicRollback: true, committedStateAndSources: true, recoveryAndIdempotency: true, playerVisibility: true } };
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  if (process.argv.includes("--electron") && !process.versions.electron) {
    const result = spawnSync(require("electron"), [__filename], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit",
    });
    if (result.error) process.stderr.write("ELECTRON_SQLITE_CHECK_START_FAILED\n");
    process.exit(result.status ?? 1);
  }
  try { process.stdout.write(`${JSON.stringify(runSessionSqliteChecks(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.code || "SESSION_SQLITE_CHECK_FAILED"}: ${error.message}\n`); process.exitCode = 1; }
}
module.exports = { runSessionSqliteChecks };
