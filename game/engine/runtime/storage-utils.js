"use strict";

const fs = require("node:fs/promises");
const { constants: fsConstants } = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ERROR_CODES, GreyCrowError, sanitizeMeta } = require("../providers/provider-contracts");

const DEFAULT_SAVES_ROOT = path.resolve(process.cwd(), "data", "saves");
const SAVE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const fileQueues = new Map();
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;

function validateSaveId(saveId) {
  if (typeof saveId !== "string" || !SAVE_ID_PATTERN.test(saveId)) {
    throw new GreyCrowError(
      ERROR_CODES.INVALID_SAVE_ID,
      "saveId must use only letters, numbers, hyphen, or underscore.",
      {
        retryable: false,
        meta: {
          rejected_save_id: true,
          length: typeof saveId === "string" ? saveId.length : 0,
        },
      }
    );
  }
  return saveId;
}

function resolveSavesRoot(rootDir) {
  return path.resolve(rootDir || DEFAULT_SAVES_ROOT);
}

function resolveSaveDir(rootDir, saveId) {
  const safeSaveId = validateSaveId(saveId);
  const root = resolveSavesRoot(rootDir);
  const saveDir = path.join(root, safeSaveId);
  const relative = path.relative(root, saveDir);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GreyCrowError(ERROR_CODES.INVALID_SAVE_ID, "saveId resolved outside saves root.", {
      retryable: false,
      meta: { rejected_save_id: true },
    });
  }

  return saveDir;
}

async function ensureDir(dirPath, options = {}) {
  await assertSafeDirectoryCreatePath(dirPath, options);
  await fs.mkdir(dirPath, { recursive: true });
  await assertSafeStorePath(dirPath, options, { allowDirectory: true });
  await assertPathIsNotSymlink(dirPath);
}

async function readJsonFile(filePath, fallback, options = {}) {
  try {
    await assertSafeStorePath(filePath, options);
    await assertPathIsNotSymlink(path.dirname(filePath));
    await assertPathIsNotSymlink(filePath);
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof GreyCrowError) {
      throw error;
    }

    if (error?.code === "ENOENT") {
      return typeof fallback === "function" ? fallback() : fallback;
    }

    throw new GreyCrowError(ERROR_CODES.STORE_READ_FAILED, `Failed to read ${path.basename(filePath)}.`, {
      retryable: false,
      cause: error,
      meta: { file: path.basename(filePath) },
    });
  }
}

async function writeJsonAtomic(filePath, value, options = {}) {
  const dir = path.dirname(filePath);
  await ensureDir(dir, options);
  await assertSafeStorePath(filePath, options);
  await assertPathIsNotSymlink(filePath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );

  try {
    const handle = await fs.open(tmpPath, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertSafeStorePath(filePath, options);
    await assertPathIsNotSymlink(filePath);
    await fs.rename(tmpPath, filePath);
    await fsyncDirectoryBestEffort(dir);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    if (error instanceof GreyCrowError) {
      throw error;
    }
    throw new GreyCrowError(ERROR_CODES.STORE_WRITE_FAILED, `Failed to write ${path.basename(filePath)}.`, {
      retryable: false,
      cause: error,
      meta: { file: path.basename(filePath) },
    });
  }
}

async function withFileQueue(filePath, operation, options = {}) {
  const previous = fileQueues.get(filePath) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current, () => current);
  fileQueues.set(filePath, queued);

  try {
    await previous.catch(() => {});
    return await withFileLock(filePath, operation, options);
  } finally {
    release();
    if (fileQueues.get(filePath) === queued) {
      fileQueues.delete(filePath);
    }
  }
}

async function withFileLock(filePath, operation, options = {}) {
  const lockDir = `${filePath}.lock`;
  await ensureDir(path.dirname(filePath), options);
  await assertSafeStorePath(filePath, options);
  await assertSafeStorePath(lockDir, options, { allowDirectory: true });
  await assertPathIsNotSymlink(lockDir);
  await acquireLock(lockDir);
  try {
    return await operation();
  } finally {
    await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function appendJsonLine(filePath, value, options = {}) {
  return appendJsonLineFrom(filePath, () => value, options);
}

async function appendJsonLineFrom(filePath, createValue, options = {}) {
  await ensureDir(path.dirname(filePath), options);
  await assertSafeStorePath(filePath, options);
  return withFileQueue(filePath, async () => {
    try {
      const value = await createValue();
      await assertSafeStorePath(filePath, options);
      await assertPathIsNotSymlink(filePath);
      await appendFileNoFollow(filePath, `${JSON.stringify(value)}\n`);
      return value;
    } catch (error) {
      if (error instanceof GreyCrowError) {
        throw error;
      }
      throw new GreyCrowError(ERROR_CODES.STORE_WRITE_FAILED, `Failed to append ${path.basename(filePath)}.`, {
        retryable: false,
        cause: error,
        meta: { file: path.basename(filePath) },
      });
    }
  }, options);
}

async function readJsonLines(filePath, options = {}) {
  try {
    await assertSafeStorePath(filePath, options);
    await assertPathIsNotSymlink(path.dirname(filePath));
    await assertPathIsNotSymlink(filePath);
    const text = await fs.readFile(filePath, "utf8");
    const records = [];
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line) {
        continue;
      }
      try {
        records.push(JSON.parse(line));
      } catch (_error) {
        records.push({
          schema_version: 1,
          kind: "jsonl_parse_error",
          sequence: index + 1,
          createdAt: null,
          error: "Skipped malformed JSONL record.",
        });
      }
    }
    return records;
  } catch (error) {
    if (error instanceof GreyCrowError) {
      throw error;
    }

    if (error?.code === "ENOENT") {
      return [];
    }

    throw new GreyCrowError(ERROR_CODES.STORE_READ_FAILED, `Failed to read ${path.basename(filePath)}.`, {
      retryable: false,
      cause: error,
      meta: { file: path.basename(filePath) },
    });
  }
}

async function acquireLock(lockDir) {
  while (true) {
    try {
      await fs.mkdir(lockDir);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw new GreyCrowError(ERROR_CODES.STORE_WRITE_FAILED, "Failed to acquire file lock.", {
          retryable: true,
          cause: error,
          meta: { file: path.basename(lockDir) },
        });
      }

      await removeStaleLock(lockDir);
      await delay(LOCK_RETRY_MS);
    }
  }
}

async function removeStaleLock(lockDir) {
  try {
    const stat = await fs.lstat(lockDir);
    if (stat.isSymbolicLink()) {
      throw new GreyCrowError(ERROR_CODES.INVALID_SAVE_ID, "Save lock path cannot be a symlink.", {
        retryable: false,
        meta: { file: path.basename(lockDir) },
      });
    }
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error instanceof GreyCrowError) {
      throw error;
    }
    if (error?.code !== "ENOENT") {
      return;
    }
    // Another process may have released the lock between mkdir attempts.
  }
}

async function assertPathIsNotSymlink(targetPath) {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      throw new GreyCrowError(ERROR_CODES.INVALID_SAVE_ID, "Save path cannot be a symlink.", {
        retryable: false,
        meta: { file: path.basename(targetPath) },
      });
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function assertSafeStorePath(targetPath, options = {}, extra = {}) {
  const target = path.resolve(targetPath);
  await assertPathIsNotSymlink(target);

  if (!hasRootOption(options)) {
    return;
  }

  const root = resolveSavesRoot(options.rootDir);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GreyCrowError(ERROR_CODES.INVALID_SAVE_ID, "Store path resolved outside saves root.", {
      retryable: false,
      meta: { file: path.basename(target) },
    });
  }

  await assertPathIsNotSymlink(root);
  if (!extra.allowDirectory) {
    await assertPathIsNotSymlink(path.dirname(target));
  }

  const rootReal = await realpathIfExists(root);
  if (!rootReal) {
    return;
  }

  const comparePath = extra.allowDirectory ? target : path.dirname(target);
  const parentReal = await realpathIfExists(comparePath);
  if (parentReal && !isPathInside(rootReal, parentReal)) {
    throw new GreyCrowError(ERROR_CODES.INVALID_SAVE_ID, "Store path realpath escaped saves root.", {
      retryable: false,
      meta: { file: path.basename(target) },
    });
  }

  const targetReal = await realpathIfExists(target);
  if (targetReal && !isPathInside(rootReal, targetReal)) {
    throw new GreyCrowError(ERROR_CODES.INVALID_SAVE_ID, "Store file realpath escaped saves root.", {
      retryable: false,
      meta: { file: path.basename(target) },
    });
  }
}

async function assertSafeDirectoryCreatePath(dirPath, options = {}) {
  const target = path.resolve(dirPath);
  await assertPathIsNotSymlink(target);

  if (!hasRootOption(options)) {
    return;
  }

  const root = resolveSavesRoot(options.rootDir);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GreyCrowError(ERROR_CODES.INVALID_SAVE_ID, "Store directory resolved outside saves root.", {
      retryable: false,
      meta: { file: path.basename(target) },
    });
  }

  await assertPathIsNotSymlink(root);
  await assertExistingDescendantPathIsNotSymlink(root, target);
  const rootReal = await realpathIfExists(root);
  const existingReal = await realpathIfExists(await deepestExistingDescendantPath(root, target));
  if (rootReal && existingReal && !isPathInside(rootReal, existingReal)) {
    throw new GreyCrowError(ERROR_CODES.INVALID_SAVE_ID, "Store directory realpath escaped saves root.", {
      retryable: false,
      meta: { file: path.basename(target) },
    });
  }
}

async function assertExistingDescendantPathIsNotSymlink(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (!relative || relative === "") {
    return;
  }

  let current = root;
  for (const segment of relative.split(path.sep)) {
    if (!segment) {
      continue;
    }
    current = path.join(current, segment);
    try {
      await assertPathIsNotSymlink(current);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function deepestExistingDescendantPath(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  let current = root;
  let deepest = root;
  if (!relative || relative === "") {
    return deepest;
  }

  for (const segment of relative.split(path.sep)) {
    if (!segment) {
      continue;
    }
    current = path.join(current, segment);
    try {
      await fs.lstat(current);
      deepest = current;
    } catch (error) {
      if (error?.code === "ENOENT") {
        return deepest;
      }
      throw error;
    }
  }
  return deepest;
}

async function appendFileNoFollow(filePath, text) {
  const noFollow = Number.isFinite(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  const flags = fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_WRONLY | noFollow;
  const handle = await fs.open(filePath, flags, 0o600);
  try {
    await handle.writeFile(text, "utf8");
  } finally {
    await handle.close();
  }
}

async function fsyncDirectoryBestEffort(dirPath) {
  let handle = null;
  try {
    handle = await fs.open(dirPath, fsConstants.O_RDONLY);
    await handle.sync();
  } catch (_error) {
    // Directory fsync is platform-sensitive; same-directory rename remains the primary atomic boundary.
  } finally {
    await handle?.close?.().catch(() => {});
  }
}

async function realpathIfExists(targetPath) {
  try {
    return await fs.realpath(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function hasRootOption(options = {}) {
  return Object.prototype.hasOwnProperty.call(options, "rootDir");
}

function isPathInside(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeRecord(record) {
  if (record && typeof record === "object") {
    return sanitizeMeta(record);
  }
  return sanitizeMeta({ value: record }).value;
}

module.exports = {
  DEFAULT_SAVES_ROOT,
  SAVE_ID_PATTERN,
  validateSaveId,
  resolveSavesRoot,
  resolveSaveDir,
  ensureDir,
  readJsonFile,
  writeJsonAtomic,
  withFileQueue,
	  withFileLock,
	  appendJsonLine,
	  appendJsonLineFrom,
	  readJsonLines,
	  sanitizeRecord,
	  assertSafeStorePath,
	};
