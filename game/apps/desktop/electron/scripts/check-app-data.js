#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ENV_DATA_ROOT,
  ENV_PROVIDER_CHECK_ROOT,
  createAppDataLayout,
  ensureAppDataLayout,
  projectAppDataFailureStatus,
} = require("../app-data");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-app-data-"));
const userDataPath = path.join(tmp, "user-data");
const tempPath = path.join(tmp, "tmp");
const layout = createAppDataLayout({
  userDataPath,
  tempPath,
  env: {},
});
const status = ensureAppDataLayout(layout);
const statusRaw = JSON.stringify(status);

assert(layout.dataRoot === path.join(userDataPath, "grey-crow"), "default dataRoot should live under Electron userData.");
assert(layout.savesRoot === path.join(layout.dataRoot, "saves"), "saves root should live under app dataRoot.");
assert(layout.providerCheckRoot === path.join(tempPath, "grey-crow-provider-check"), "provider check root should live under temp.");
assert(fs.statSync(layout.dataRoot).isDirectory(), "dataRoot should be created.");
assert(fs.statSync(layout.savesRoot).isDirectory(), "savesRoot should be created.");
assert(fs.statSync(layout.providerCheckRoot).isDirectory(), "providerCheckRoot should be created.");
assert(status.dataRootReady && status.savesReady && status.providerCheckReady, "status should report ready directories.");
assert(!statusRaw.includes(userDataPath) && !statusRaw.includes(tempPath), "status must not expose local paths.");

const overrideRoot = path.join(tmp, "override-data");
const overrideProviderCheckRoot = path.join(tmp, "override-provider-check");
const overrideLayout = createAppDataLayout({
  userDataPath,
  tempPath,
  env: {
    [ENV_DATA_ROOT]: overrideRoot,
    [ENV_PROVIDER_CHECK_ROOT]: overrideProviderCheckRoot,
  },
});
const overrideStatus = ensureAppDataLayout(overrideLayout);
assert(overrideLayout.dataRoot === overrideRoot, "absolute dataRoot override should be honored.");
assert(overrideLayout.providerCheckRoot === overrideProviderCheckRoot, "absolute provider check override should be honored.");
assert(overrideStatus.overrideEnabled === true, "override status should disclose mode without path.");
assert(overrideStatus.providerCheckOverrideEnabled === true, "provider check override status should disclose mode without path.");

const failureStatus = projectAppDataFailureStatus(new Error("boom"));
assert(failureStatus.dataRootReady === false, "failure status should mark app data unavailable.");
assert(!JSON.stringify(failureStatus).includes(tmp), "failure status must not expose local paths.");

assertThrows(() => createAppDataLayout({ userDataPath: "relative", tempPath, env: {} }), "relative userDataPath should fail.");
assertThrows(
  () => createAppDataLayout({ userDataPath, tempPath, env: { [ENV_DATA_ROOT]: "relative-data" } }),
  "relative dataRoot override should fail."
);

process.stdout.write("app data checks passed\n");

function assertThrows(fn, message) {
  try {
    fn();
  } catch (_error) {
    return;
  }
  assert(false, message);
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
