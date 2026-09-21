"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const SECRET_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i;

function hashBuffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashCanonical(value) {
  return hashBuffer(Buffer.from(canonicalStringify(value), "utf8"));
}

function canonicalStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function safeChild(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw snapshotError("SNAPSHOT_PATH_OUTSIDE_ROOT", "Snapshot path escaped its trusted root.");
  }
  return target;
}

async function readJsonBounded(filePath) {
  const stat = await fs.lstat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > MAX_METADATA_BYTES) {
    throw snapshotError("SNAPSHOT_METADATA_INVALID", "Snapshot metadata is missing or invalid.");
  }
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    throw snapshotError("SNAPSHOT_METADATA_INVALID", "Snapshot metadata is not valid JSON.");
  }
}

async function writeJsonExclusive(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function makeTreeReadOnly(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) await makeTreeReadOnly(target);
    else if (entry.isFile()) await fs.chmod(target, 0o400);
    else throw snapshotError("SNAPSHOT_SPECIAL_FILE", "Snapshot contains a non-regular file.");
  }
  await fs.chmod(root, 0o500);
}

async function makeTreeWritable(root) {
  const stat = await fs.lstat(root).catch(() => null);
  if (!stat || stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    await fs.chmod(root, 0o700).catch(() => {});
    const entries = await fs.readdir(root).catch(() => []);
    for (const entry of entries) await makeTreeWritable(path.join(root, entry));
  } else if (stat.isFile()) {
    await fs.chmod(root, 0o600).catch(() => {});
  }
}

function assertNoSecret(value) {
  if (SECRET_PATTERN.test(value.toString("utf8"))) {
    throw snapshotError("SNAPSHOT_SECRET_REJECTED", "Content snapshot source contains credential-like data.");
  }
}

function assertSnapshotByteLimit(files) {
  let total = 0;
  for (const file of Array.isArray(files) ? files : []) {
    if (!Number.isInteger(file?.sizeBytes) || file.sizeBytes < 0) {
      throw snapshotError("SNAPSHOT_FILE_INVALID", "Snapshot file size metadata is invalid.");
    }
    total += file.sizeBytes;
    if (total > MAX_SNAPSHOT_BYTES) {
      throw snapshotError("SNAPSHOT_SIZE_LIMIT", "Content snapshot exceeds the Engine byte limit.");
    }
  }
  return total;
}

function snapshotError(code, message, meta = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  error.meta = Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, String(value).slice(0, 160)]));
  return error;
}

module.exports = {
  MAX_METADATA_BYTES,
  MAX_SNAPSHOT_BYTES,
  assertNoSecret,
  assertSnapshotByteLimit,
  canonicalStringify,
  hashBuffer,
  hashCanonical,
  makeTreeReadOnly,
  makeTreeWritable,
  readJsonBounded,
  safeChild,
  snapshotError,
  writeJsonExclusive,
};
