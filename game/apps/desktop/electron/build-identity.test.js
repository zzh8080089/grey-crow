"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBuildIdentity, writeBuildIdentity, sourceFingerprint, METADATA_FILE } = require("./build-identity");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-build-"));
  const appRoot = path.join(root, "desktop"); const runtimeRoot = path.join(root, "runtime");
  fs.mkdirSync(path.join(appRoot, "renderer"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "engine", "session"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "content", "packs"), { recursive: true });
  fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
  fs.writeFileSync(path.join(appRoot, "main.js"), "module.exports = 'main';\n");
  fs.writeFileSync(path.join(appRoot, "renderer", "index.html"), "<main>story</main>\n");
  fs.writeFileSync(path.join(runtimeRoot, "engine", "session", "turn.js"), "module.exports = 'turn';\n");
  fs.writeFileSync(path.join(runtimeRoot, "content", "packs", "manifest.json"), "{\"id\":\"default\"}\n");
  return { root, appRoot, runtimeRoot };
}

test("development identity projects only validated fields and fingerprints source changes", () => {
  const item = fixture();
  try {
    const versions = { electron: "42.6.1", node: "24.0.0", v8: "private" };
    const first = createBuildIdentity({ ...item, packaged: false, platform: "darwin", arch: "arm64", versions });
    assert.deepEqual(Object.keys(first).sort(), ["appVersion", "arch", "buildId", "electron", "node", "packaged", "platform", "sourceFingerprint", "sourceScope"].sort());
    assert.equal(first.appVersion, "1.2.3"); assert.equal(first.platform, "darwin"); assert.equal(first.arch, "arm64");
    assert.match(first.sourceFingerprint, /^[a-f0-9]{64}$/); assert.equal(first.buildId, `dev-${first.sourceFingerprint.slice(0, 16)}`);
    fs.writeFileSync(path.join(item.runtimeRoot, "engine", "session", "turn.js"), "module.exports = 'changed';\n");
    const second = createBuildIdentity({ ...item, packaged: false, platform: "plan9", arch: "sparc", versions: { electron: "x", node: "private" } });
    assert.notEqual(second.sourceFingerprint, first.sourceFingerprint, "runtime source must affect the development fingerprint");
    assert.equal(second.platform, "unknown"); assert.equal(second.arch, "unknown"); assert.equal(second.electron, "unknown"); assert.equal(second.node, "unknown");
  } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
});

test("generated identity metadata is excluded from the source hash and packaged values require validation", () => {
  const item = fixture();
  try {
    const before = sourceFingerprint(item.appRoot, item.runtimeRoot);
    fs.writeFileSync(path.join(item.appRoot, METADATA_FILE), JSON.stringify({ schema: 1, buildId: "build-1234567890123-0123456789abcdef",
      sourceFingerprint: "a".repeat(64), injectedPath: "/private/release", secret: "do-not-project" }));
    assert.equal(sourceFingerprint(item.appRoot, item.runtimeRoot), before, "generated metadata must not alter the source fingerprint");
    const packaged = createBuildIdentity({ ...item, packaged: true, platform: "win32", arch: "x64", versions: { electron: "42.6.1", node: "24.0.0" } });
    assert.equal(packaged.buildId, "build-1234567890123-0123456789abcdef"); assert.equal(packaged.sourceFingerprint, "a".repeat(64));
    assert.equal(JSON.stringify(packaged).includes("/private/release"), false); assert.equal(JSON.stringify(packaged).includes("do-not-project"), false);
    fs.writeFileSync(path.join(item.appRoot, METADATA_FILE), JSON.stringify({ schema: 1, buildId: "unverified", sourceFingerprint: "not-a-hash" }));
    const rejected = createBuildIdentity({ ...item, packaged: true, versions: {} });
    assert.equal(rejected.buildId, "unknown"); assert.equal(rejected.sourceFingerprint, "unknown");
  } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
});

test("identity writer emits validated metadata for a temporary source tree", () => {
  const item = fixture();
  try {
    const written = writeBuildIdentity(item.appRoot, item.runtimeRoot);
    assert.equal(written.schema, 1); assert.match(written.buildId, /^build-\d{13}-[a-f0-9]{16}$/); assert.match(written.sourceFingerprint, /^[a-f0-9]{64}$/);
    const packaged = createBuildIdentity({ ...item, packaged: true, versions: { electron: "42.6.1", node: "24.0.0" } });
    assert.equal(packaged.buildId, written.buildId); assert.equal(packaged.sourceFingerprint, written.sourceFingerprint);
  } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
});

test("beforePack uses electron-builder's PlatformPackager.info.appDir contract", async () => {
  const item = fixture();
  try {
    const hook = require("./scripts/write-build-identity");
    await hook({ packager: { info: { appDir: item.appRoot } } });
    const identity = JSON.parse(fs.readFileSync(path.join(item.appRoot, METADATA_FILE), "utf8"));
    assert.match(identity.buildId, /^build-\d{13}-[a-f0-9]{16}$/);
    assert.match(identity.sourceFingerprint, /^[a-f0-9]{64}$/);
  } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
});

test("source identity follows the packaged allowlist including generated cjs contracts", () => {
  const item = fixture();
  try {
    const pkg = { version: "1.2.3", build: { files: ["package.json", "main.js", "renderer/**", "!renderer/**/*.test.js"],
      extraResources: [{ to: "engine", filter: ["session/turn.js", "session/validators.cjs"] }, { to: "content", filter: ["packs/**"] }] } };
    fs.writeFileSync(path.join(item.appRoot, "package.json"), JSON.stringify(pkg));
    const generated = path.join(item.runtimeRoot, "engine/session/validators.cjs");
    fs.writeFileSync(generated, "one");
    const baseline = sourceFingerprint(item.appRoot, item.runtimeRoot);
    fs.writeFileSync(path.join(item.runtimeRoot, "engine/not-in-package.js"), "ignored");
    fs.writeFileSync(path.join(item.appRoot, "renderer/view.test.js"), "ignored");
    assert.equal(sourceFingerprint(item.appRoot, item.runtimeRoot), baseline);
    fs.writeFileSync(generated, "two");
    assert.notEqual(sourceFingerprint(item.appRoot, item.runtimeRoot), baseline);
  } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
});
