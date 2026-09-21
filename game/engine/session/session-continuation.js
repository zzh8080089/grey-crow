"use strict";

const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { readContentSnapshot } = require("../content-v2/snapshot-reader");
const { makeTreeReadOnly, makeTreeWritable } = require("../content-v2/snapshot-utils");
const { createSessionArchiveReader } = require("./session-archive");
const { inspectSessionAdventure } = require("./session-catalog");
const { appendContinuationBoundary, readSessionTimeline, projectSessionTimeline } = require("./session-lineage");
const { validateInitialState } = require("./turn-model");
const { validateConditionSources } = require("./session-condition-sources");

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const queues = new Map();
const SAFE = new Set(["SAVE_PATH_INVALID", "SAVE_ACCESS_DENIED", "SAVE_WRITE_FAILED", "SAVE_FORMAT_UNSUPPORTED",
  "SAVE_IDENTITY_MISMATCH", "STORE_BUSY", "SESSION_LINEAGE_INPUT_INVALID", "SESSION_LINEAGE_INVALID", "CHARACTER_CONDITION_SOURCE_INVALID",
  "ADVENTURE_CONTINUATION_INPUT_INVALID", "ADVENTURE_CONTINUATION_PARENT_NOT_CLOSED", "ADVENTURE_CONTINUATION_FORBIDDEN",
  "ADVENTURE_CONTINUATION_PARENT_INVALID", "ADVENTURE_CONTINUATION_SOURCE_CHANGED", "ADVENTURE_CONTINUATION_CONTENT_INVALID",
  "ADVENTURE_CONTINUATION_RECOVERY_REQUIRED", "ADVENTURE_CONTINUATION_REQUEST_MISMATCH", "ADVENTURE_CONTINUATION_ACTIVE_EXISTS",
  "ADVENTURE_CONTINUATION_CATALOG_UNAVAILABLE", "ADVENTURE_CONTINUATION_LOCK_UNAVAILABLE", "ADVENTURE_CONTINUATION_FAILED"]);

// The hidden directory holds disposable staging copies and an empty mutex table,
// never a second lineage or request ledger. A published child's own database is
// the receipt. SQLite's OS locks release after a crash without a stale-lock TTL.
function createSessionContinuationService({ adventuresRoot, clock = () => new Date().toISOString(), faultInjector = () => {} } = {}) {
  if (typeof adventuresRoot !== "string" || !path.isAbsolute(adventuresRoot)) throw failure("SAVE_PATH_INVALID");
  adventuresRoot = path.resolve(adventuresRoot);
  const privateRoot = path.join(adventuresRoot, ".session-continuations");

  async function fork(input) {
    const request = checkedRequest(input);
    const childAdventureId = `continuation-${createHash("sha256").update(request.requestId).digest("hex").slice(0, 40)}`;
    try {
      return await queued(adventuresRoot, async () => {
        await realDirectoryChain(adventuresRoot);
        await fs.mkdir(privateRoot, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
        await realDirectoryChain(privateRoot);
        return withMutex(privateRoot, async () => {
          const targetRoot = path.join(adventuresRoot, childAdventureId);
          // Read this before the parent or the active-adventure check: a lost
          // receipt remains recoverable after play, or after deleting the parent.
          if (await exists(targetRoot)) return readPublished(request, childAdventureId, "existing");
          const parentRoot = path.join(adventuresRoot, request.parentAdventureId);
          const stageRoot = path.join(privateRoot, `stage-${childAdventureId}`);
          const childRoot = path.join(stageRoot, childAdventureId);
          let source;
          let published = false;
          try {
            await assertNoActiveAdventure(request.parentAdventureId);
            const before = await captureAdventure(parentRoot);
            const snapshot = await readContentSnapshot({ adventuresRoot, adventureId: request.parentAdventureId });
            // This independent reader checks the actual closed archive, chapter
            // receipt and confirmation sources without loading the full story.
            await createSessionArchiveReader({ adventuresRoot }).readChapters({ adventureId: request.parentAdventureId,
              revision: request.parentRevision, limit: 1 });
            source = new DatabaseSync(path.join(parentRoot, "session.sqlite"), { readOnly: true });
            source.exec("PRAGMA busy_timeout=0; BEGIN");
            const row = checkedDatabase(source, request.parentAdventureId, snapshot);
            if (row.revision !== request.parentRevision) throw failure("ADVENTURE_CONTINUATION_PARENT_INVALID");
            const state = validateInitialState(JSON.parse(source.prepare("SELECT state_json FROM turns WHERE revision=?").get(row.revision).state_json));
            if (state.finale?.candidate?.kind === "extreme") throw failure("ADVENTURE_CONTINUATION_FORBIDDEN");
            const archive = source.prepare("SELECT * FROM finale_archives WHERE singleton=1").get();
            if (state.finale?.phase !== "confirmed" || archive?.status !== "closed") throw failure("ADVENTURE_CONTINUATION_PARENT_NOT_CLOSED");
            if (archive.finale_id !== request.sourceFinaleId || archive.confirmation_revision !== row.revision) throw failure("ADVENTURE_CONTINUATION_PARENT_INVALID");
            const timeline = readSessionTimeline(source, { adventureId: request.parentAdventureId, revision: row.revision });
            const createdAt = clock();
            if (typeof createdAt !== "string" || createdAt.length > 64 || !Number.isFinite(Date.parse(createdAt))) throw failure("ADVENTURE_CONTINUATION_INPUT_INVALID");
            const title = continuationTitle(state, timeline.continuation?.title, row.locale);
            await faultInjector("parent_verified", { ...request, childAdventureId });
            await removeStage(stageRoot);
            await fs.mkdir(childRoot, { recursive: true, mode: 0o700 });
            for (const file of before.files) {
              if (file.relativePath === "session.sqlite-journal") continue; // inert rollback residue is not story data
              const target = path.join(childRoot, file.relativePath);
              await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
              const copied = await transferFile(path.join(parentRoot, file.relativePath), target);
              if (copied.hash !== file.hash || copied.size !== file.size) throw failure("ADVENTURE_CONTINUATION_SOURCE_CHANGED");
            }
            await fs.writeFile(path.join(childRoot, "content-profile.json"), `${JSON.stringify({ ...snapshot.profile, adventureId: childAdventureId }, null, 2)}\n`, { mode: 0o600 });
            let child;
            try {
              child = new DatabaseSync(path.join(childRoot, "session.sqlite"));
              child.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
              appendContinuationBoundary(child, { ...request, childAdventureId, createdAt, title });
            } finally { child?.close(); }
            await faultInjector("boundary_committed", { ...request, childAdventureId });
            const staged = await readCopy(stageRoot, request, childAdventureId, "created");
            await makeTreeReadOnly(path.join(childRoot, "content-snapshot"));
            await fs.chmod(path.join(childRoot, "content-profile.json"), 0o400);
            await syncTree(childRoot);
            await faultInjector("before_publish", { ...request, childAdventureId });
            // The shared parent read transaction prevents SQLite writers from
            // changing its bytes during copying; file hashes also cover content.
            const after = await captureAdventure(parentRoot);
            if (JSON.stringify(before) !== JSON.stringify(after)) throw failure("ADVENTURE_CONTINUATION_SOURCE_CHANGED");
            await assertNoActiveAdventure(request.parentAdventureId);
            if (await exists(targetRoot)) throw failure("ADVENTURE_CONTINUATION_REQUEST_MISMATCH");
            await fs.rename(childRoot, targetRoot);
            published = true;
            await syncDirectory(adventuresRoot);
            await faultInjector("after_publish", { ...request, childAdventureId });
            return staged;
          } finally {
            try { source?.exec("ROLLBACK"); } catch {}
            source?.close();
            // A killed process leaves only a hidden copy. A later request under
            // the mutex discards it, or finds the already published receipt.
            if (!published || await exists(stageRoot)) await removeStage(stageRoot);
          }
        });
      });
    } catch (error) { throw normalizeError(error); }
  }

  async function readPublished(request, childAdventureId, status) {
    return readCopy(adventuresRoot, request, childAdventureId, status);
  }

  async function assertNoActiveAdventure(parentAdventureId) {
    for (const entry of await fs.readdir(adventuresRoot, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || !ID.test(entry.name) || entry.name === parentAdventureId) continue;
      if (entry.isSymbolicLink()) throw failure("SAVE_PATH_INVALID");
      if (!entry.isDirectory()) continue;
      const inspection = await inspectSessionAdventure({ adventuresRoot, adventureId: entry.name });
      if (inspection.status === "empty" || inspection.status === "closed") continue;
      if (inspection.errorCode === "SAVE_FORMAT_UNSUPPORTED") continue;
      if (inspection.playerContinuable) throw failure("ADVENTURE_CONTINUATION_ACTIVE_EXISTS");
      throw failure("ADVENTURE_CONTINUATION_CATALOG_UNAVAILABLE");
    }
  }

  return Object.freeze({ fork });
}

async function readCopy(adventuresRoot, request, childAdventureId, status) {
  await captureAdventure(path.join(adventuresRoot, childAdventureId));
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId: childAdventureId });
  let db;
  try {
    db = new DatabaseSync(path.join(adventuresRoot, childAdventureId, "session.sqlite"), { readOnly: true });
    db.exec("PRAGMA busy_timeout=0; BEGIN");
    const row = checkedDatabase(db, childAdventureId, snapshot);
    const timeline = readSessionTimeline(db, { adventureId: childAdventureId, revision: row.revision });
    const continuation = timeline.continuation;
    if (!continuation || continuation.childAdventureId !== childAdventureId
      || ["requestId", "parentAdventureId", "parentRevision", "sourceFinaleId"].some((key) => continuation[key] !== request[key])) {
      throw failure("ADVENTURE_CONTINUATION_REQUEST_MISMATCH");
    }
    const state = validateInitialState(JSON.parse(db.prepare("SELECT state_json FROM turns WHERE revision=?").get(row.revision).state_json));
    validateConditionSources(db, state, timeline);
    return { ok: true, status, childAdventureId, parentAdventureId: request.parentAdventureId,
      parentRevision: request.parentRevision, sourceFinaleId: request.sourceFinaleId,
      revision: row.revision, boundaryRevision: continuation.boundaryRevision, locale: row.locale,
      title: continuation.title, createdAt: continuation.createdAt, lineage: timeline.lineage, continuation,
      timeline: projectSessionTimeline(timeline) };
  } finally { try { db?.exec("ROLLBACK"); } catch {} db?.close(); }
}

function checkedDatabase(db, adventureId, snapshot) {
  const row = db.prepare("SELECT * FROM session WHERE singleton=1").get();
  if (row?.format !== "grey-crow-session-1") throw failure("SAVE_FORMAT_UNSUPPORTED");
  if (row.adventure_id !== adventureId || row.locale !== snapshot.profile.language || row.content_version !== snapshot.lock.overallHash) throw failure("SAVE_IDENTITY_MISMATCH");
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").get()) throw failure("SESSION_LINEAGE_INVALID");
  return row;
}

function continuationTitle(state, parentTitle, locale) {
  const location = state.entities[state.situation.locationId];
  const names = location?.attributes?.localizedNames || location?.attributes?.localized_names;
  const base = parentTitle || names?.[locale] || names?.[locale.split("-")[0]] || location?.name;
  const suffix = { "zh-CN": " · 续篇", "en-US": " · Continuation", "ja-JP": "・続編" }[locale];
  if (!suffix || typeof base !== "string" || !base.trim()) throw failure("ADVENTURE_CONTINUATION_CONTENT_INVALID");
  const clipped = base.slice(0, 200 - suffix.length).replace(/[\uD800-\uDBFF]$/, "");
  return `${clipped}${suffix}`;
}

function checkedRequest(input) {
  const keys = ["requestId", "parentAdventureId", "parentRevision", "sourceFinaleId"];
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Reflect.ownKeys(input).length !== keys.length || keys.some((key) => !Object.getOwnPropertyDescriptor(input, key)?.enumerable
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), "value"))) throw failure("ADVENTURE_CONTINUATION_INPUT_INVALID");
  if (typeof input.requestId !== "string" || typeof input.parentAdventureId !== "string"
    || !REQUEST_ID.test(input.requestId) || !ID.test(input.parentAdventureId)
    || ["__proto__", "prototype", "constructor"].some((key) => [input.requestId, input.parentAdventureId].includes(key))
    || !Number.isSafeInteger(input.parentRevision) || input.parentRevision < 1 || input.parentRevision >= Number.MAX_SAFE_INTEGER
    || typeof input.sourceFinaleId !== "string" || !REQUEST_ID.test(input.sourceFinaleId)) throw failure("ADVENTURE_CONTINUATION_INPUT_INVALID");
  return Object.fromEntries(keys.map((key) => [key, input[key]]));
}

async function captureAdventure(root) {
  await realDirectoryChain(root);
  const names = (await fs.readdir(root)).sort();
  if (names.some((name) => !["session.sqlite", "session.sqlite-journal", "content-profile.json", "content-snapshot"].includes(name))
    || !["session.sqlite", "content-profile.json", "content-snapshot"].every((name) => names.includes(name))) throw failure("SAVE_FORMAT_UNSUPPORTED");
  const files = await captureTree(root);
  const handle = await openRegular(path.join(root, "session.sqlite"));
  try {
    const header = Buffer.alloc(100);
    const { bytesRead } = await handle.read(header, 0, 100, 0);
    if (bytesRead !== 100 || header.toString("ascii", 0, 16) !== "SQLite format 3\u0000"
      || header.readUInt32BE(68) !== 0x47435331 || header.readUInt32BE(60) !== 1 || header[18] !== 1 || header[19] !== 1) throw failure("SAVE_FORMAT_UNSUPPORTED");
  } finally { await handle.close(); }
  if (names.includes("session.sqlite-journal")) {
    const journal = await openRegular(path.join(root, "session.sqlite-journal"));
    try {
      const header = Buffer.alloc(8);
      await journal.read(header, 0, 8, 0);
      if (header.equals(Buffer.from("d9d505f920a163d7", "hex"))) throw failure("ADVENTURE_CONTINUATION_RECOVERY_REQUIRED");
    } finally { await journal.close(); }
  }
  return { files };
}

async function captureTree(root, relative = "") {
  const records = [];
  for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
    const relativePath = path.join(relative, name);
    const target = path.join(root, relativePath);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)) throw failure("SAVE_PATH_INVALID");
    if (stat.isDirectory()) records.push(...await captureTree(root, relativePath));
    else records.push({ relativePath, ...(await transferFile(target)), inode: stat.ino, mtime: stat.mtimeMs, ctime: stat.ctimeMs, mode: stat.mode });
  }
  return records;
}

async function transferFile(source, target) {
  const input = await openRegular(source);
  let output;
  try {
    if (target) output = await fs.open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
    const before = await input.stat();
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let size = 0;
    while (true) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, size);
      if (!bytesRead) break;
      const part = buffer.subarray(0, bytesRead);
      hash.update(part);
      if (output) await output.writeFile(part);
      size += bytesRead;
    }
    const after = await input.stat();
    const current = await fs.lstat(source);
    if (after.nlink !== 1 || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || size !== after.size) throw failure("ADVENTURE_CONTINUATION_SOURCE_CHANGED");
    await output?.sync();
    return { hash: hash.digest("hex"), size };
  } finally { await input.close(); await output?.close(); }
}

async function openRegular(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw failure("SAVE_PATH_INVALID");
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const actual = await handle.stat();
  if (!actual.isFile() || actual.nlink !== 1 || actual.ino !== stat.ino || actual.dev !== stat.dev) { await handle.close(); throw failure("SAVE_PATH_INVALID"); }
  return handle;
}

async function realDirectoryChain(directory) {
  const parsed = path.parse(path.resolve(directory));
  let current = parsed.root;
  for (const component of path.resolve(directory).slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure("SAVE_PATH_INVALID");
  }
}

async function removeStage(root) {
  if (!await exists(root)) return;
  await realDirectoryChain(root);
  await captureTree(root); // do not chmod or traverse a linked/special entry
  await makeTreeWritable(root);
  await fs.rm(root, { recursive: true });
}

async function syncTree(root) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) await syncTree(target);
    else { const handle = await openRegular(target); try { await handle.sync(); } finally { await handle.close(); } }
  }
  await syncDirectory(root);
}

async function syncDirectory(root) {
  let handle;
  try { handle = await fs.open(root, "r"); await handle.sync(); }
  catch (error) { if (process.platform !== "win32" || !["EPERM", "EISDIR", "EINVAL"].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}

async function withMutex(root, operation) {
  const file = path.join(root, "mutex.sqlite");
  try { const created = await fs.open(file, "wx", 0o600); await created.close(); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    if (!await exists(file + suffix)) continue;
    const handle = await openRegular(file + suffix); await handle.close();
    if (["-wal", "-shm"].includes(suffix)) throw failure("ADVENTURE_CONTINUATION_LOCK_UNAVAILABLE");
  }
  const db = new DatabaseSync(file);
  let acquired = false;
  try {
    db.exec("PRAGMA busy_timeout=0");
    const deadline = Date.now() + 5000;
    while (!acquired) {
      try { db.exec("BEGIN IMMEDIATE"); acquired = true; }
      catch (error) {
        if (![5, 6].includes(error.errcode & 0xff)) throw failure("ADVENTURE_CONTINUATION_LOCK_UNAVAILABLE");
        if (Date.now() >= deadline) throw failure("STORE_BUSY");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    db.exec("CREATE TABLE IF NOT EXISTS mutex (singleton INTEGER PRIMARY KEY CHECK(singleton=1))");
    return await operation();
  } finally {
    if (acquired) { try { db.exec("COMMIT"); } catch { try { db.exec("ROLLBACK"); } catch {} } }
    db.close();
  }
}

async function queued(key, operation) {
  const prior = queues.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(operation);
  queues.set(key, next);
  try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}
async function exists(target) { try { await fs.lstat(target); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
function failure(code) { return Object.assign(new Error(code), { code, retryable: ["STORE_BUSY", "ADVENTURE_CONTINUATION_FAILED", "SAVE_WRITE_FAILED"].includes(code) }); }
function normalizeError(error) {
  if (SAFE.has(error?.code)) return failure(error.code);
  if (error?.code?.startsWith("SNAPSHOT_")) return failure("ADVENTURE_CONTINUATION_CONTENT_INVALID");
  if (["EACCES", "EPERM"].includes(error?.code)) return failure("SAVE_ACCESS_DENIED");
  if (["ENOSPC", "EDQUOT", "EIO"].includes(error?.code)) return failure("SAVE_WRITE_FAILED");
  if ([5, 6].includes(error?.errcode & 0xff)) return failure("STORE_BUSY");
  if (error?.code === "ARCHIVE_NOT_CLOSED") return failure("ADVENTURE_CONTINUATION_PARENT_NOT_CLOSED");
  if (error?.code === "ARCHIVE_REVISION_MISMATCH") return failure("ADVENTURE_CONTINUATION_PARENT_INVALID");
  if (error?.code === "ARCHIVE_RECOVERY_REQUIRED") return failure("ADVENTURE_CONTINUATION_RECOVERY_REQUIRED");
  return failure("ADVENTURE_CONTINUATION_FAILED");
}

module.exports = { createSessionContinuationService };
