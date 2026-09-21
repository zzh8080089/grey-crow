"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function createTempFixtureWorkspace(options = {}) {
  const prefix = normalizePrefix(options.prefix || "p2-23-fixture");
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  let cleaned = false;

  function resolve(relativePath) {
    if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) {
      throw workspaceError("FIXTURE_PATH_INVALID", "Fixture paths must be non-empty relative paths.");
    }
    const target = path.resolve(rootDir, relativePath);
    if (target !== rootDir && !target.startsWith(`${rootDir}${path.sep}`)) {
      throw workspaceError("FIXTURE_PATH_OUTSIDE_ROOT", "Fixture path escaped the temporary root.");
    }
    return target;
  }

  async function writeText(relativePath, value) {
    assertOpen();
    const target = resolve(relativePath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, String(value), "utf8");
    return target;
  }

  async function writeJson(relativePath, value) {
    return writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async function listFiles() {
    assertOpen();
    return walkFiles(rootDir, rootDir);
  }

  async function cleanup() {
    if (cleaned) {
      return;
    }
    await makeTreeRemovable(rootDir);
    await fs.promises.rm(rootDir, { recursive: true, force: true });
    cleaned = true;
    if (fs.existsSync(rootDir)) {
      throw workspaceError("FIXTURE_CLEANUP_FAILED", "Fixture temporary directory still exists after cleanup.");
    }
  }

  function assertOpen() {
    if (cleaned) {
      throw workspaceError("FIXTURE_WORKSPACE_CLOSED", "Fixture workspace has already been cleaned.");
    }
  }

  return Object.freeze({
    rootDir,
    resolve,
    writeText,
    writeJson,
    listFiles,
    cleanup,
  });
}

async function makeTreeRemovable(target) {
  const stat = await fs.promises.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    await fs.promises.chmod(target, 0o700).catch(() => {});
    const entries = await fs.promises.readdir(target).catch(() => []);
    for (const entry of entries) await makeTreeRemovable(path.join(target, entry));
    return;
  }
  if (stat.isFile()) await fs.promises.chmod(target, 0o600).catch(() => {});
}

async function withTempFixture(callback, options = {}) {
  if (typeof callback !== "function") {
    throw workspaceError("FIXTURE_CALLBACK_REQUIRED", "withTempFixture requires a callback.");
  }
  const workspace = await createTempFixtureWorkspace(options);
  try {
    return await callback(workspace);
  } finally {
    await workspace.cleanup();
  }
}

async function walkFiles(rootDir, currentDir) {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(rootDir, absolute));
    } else if (entry.isFile()) {
      files.push(path.relative(rootDir, absolute).split(path.sep).join("/"));
    }
  }
  return files;
}

function normalizePrefix(value) {
  const normalized = String(value).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "p2-23-fixture";
}

function workspaceError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

module.exports = {
  createTempFixtureWorkspace,
  withTempFixture,
};
