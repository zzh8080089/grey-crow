"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const RUNTIME_ROOT = resolveRuntimeRoot();

const SAVE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DELETE_CONFIRMATION_TTL_MS = 2 * 60 * 1000;
const DELETE_TOMBSTONE_PREFIX = ".delete-intent-";

function resolveRuntimeRoot() {
  if (typeof process.resourcesPath === "string") {
    const packagedRoot = path.resolve(process.resourcesPath);
    if (fsSync.existsSync(path.join(packagedRoot, "engine"))) {
      return packagedRoot;
    }
  }
  return path.resolve(__dirname, "../../..");
}

function createSaveSlotStore({ dataRoot, clock = () => new Date(), displayLocale } = {}) {
  if (typeof dataRoot !== "string" || !dataRoot.trim()) {
    throw new Error("save slot store requires dataRoot");
  }
  if (!path.isAbsolute(dataRoot)) throw capabilityError("ADVENTURES_ROOT_INVALID");

  const savesRoot = path.join(dataRoot, "saves");
  const inspectSessionAdventure = (require(path.join(RUNTIME_ROOT, "engine/session/session-catalog")).inspectSessionAdventure);
  const compatibilityGate = Object.freeze({
    async inspect(id) {
      assertSafeSaveId(id);
      await assertSessionRoot();
      return Object.freeze({ adventureId: id,
        ...await inspectSessionAdventure({ adventuresRoot: savesRoot, adventureId: id, displayLocale }) });

    },
    async list() {
      await assertSessionRoot();

      const entries = await readSaveEntries(savesRoot);
      const inspections = [];
      for (const entry of entries) {
        if (entry.isDirectory() && isSafeSaveId(entry.name)) inspections.push(await compatibilityGate.inspect(entry.name));
      }
      return Object.freeze(inspections);
    },
    async openForPlayer(id) {

      const inspection = await compatibilityGate.inspect(id);
      if (!inspection.playerContinuable) throw capabilityError(inspection.errorCode || "ADVENTURE_NOT_CONTINUABLE");
      // Read-only selection only. The child session process owns hot-journal
      // recovery; inspecting or selecting a menu entry never starts a model.
      return inspection;
    },

  });
  const lifecycleConfirmations = new Map();

  async function assertSessionRoot() {

    for (const root of [dataRoot, savesRoot]) {
      const stat = await lstatIfPresent(root);
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw capabilityError("SAVE_PATH_INVALID");
    }
  }

  async function loadProjectedSummary(saveDir, id) {
    const inspection = await compatibilityGate.inspect(id);
    if (inspection.status === "empty") return null;
    if (inspection.summary) return inspection.summary;
    const language = displayLocale || inspection.adventureLocale || "zh-CN";
    const title = /^en(?:-|$)/i.test(language) ? "Current adventure"
      : /^ja(?:-|$)/i.test(language) ? "現在の冒険" : "当前冒险";
    // A missing read-only snapshot (including a hot journal) has no known
    // revision. Keep the menu entry selectable without inventing turn zero
    // or presenting an old JSON state while the session process recovers it.
    return projectCompatibleSummary({ id, adventureId: id, title, revision: null, actionId: null,
      createdAt: null, updatedAt: null, turn: null, state_hint: null }, inspection, id);

  }

  return {
    savesRoot,
    compatibilityGate,
    async list() {
      await assertSessionRoot();

      const entries = await readSaveEntries(savesRoot);
      const summaries = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !isSafeSaveId(entry.name)) {
          continue;
        }
        const saveDir = resolveSaveDir(savesRoot, entry.name);
        if (!(await isRealDirectory(saveDir))) {
          continue;
        }
        const summary = await loadProjectedSummary(saveDir, entry.name);
        if (summary) {
          summaries.push(summary);
        }
      }
      return summaries.sort(compareSummaries);
    },
    async listPendingDeletes() {
      await assertSessionRoot();
      return discoverPendingDeletes(savesRoot);
    },
    async retryPendingDelete(deletionId) {
      if (typeof deletionId !== "string") throw capabilityError("SAVE_DELETE_PENDING_NOT_FOUND"); await assertSessionRoot();
      const pending = (await discoverPendingDeletes(savesRoot)).find(item => item.deletionId === deletionId);
      if (!pending) return null;
      try {
        const target = path.join(savesRoot, pending.deletionId);
        if (!(await isRealDirectory(target))) throw capabilityError("SAVE_DELETE_PENDING_NOT_FOUND");
        await makeWritable(target, true);
        await fs.rm(target, { recursive: true, force: false });
        return { ok: true, deleted: true, saveId: pending.saveId, deletionId: pending.deletionId, recoveredDelete: true };
      } catch {
        throw capabilityError("SAVE_DELETE_PENDING");
      }
    },
    async get(id) {
      assertSafeSaveId(id);
      await assertSessionRoot();
      const saveDir = resolveSaveDir(savesRoot, id);
      if (!(await isRealDirectory(saveDir))) {
        return null;
      }
      return loadProjectedSummary(saveDir, id);
    },
    async restore(id) {
      return this.get(id);
    },
    async requestDelete(id) {
      assertSafeSaveId(id);
      await assertSessionRoot();
      pruneExpiredConfirmations(lifecycleConfirmations, clock);
      const saveDir = resolveSaveDir(savesRoot, id);
      if (!(await isRealDirectory(saveDir))) {
        return null;
      }
      const save = await loadProjectedSummary(saveDir, id);
      if (!save) {
        return null;
      }
      return issueLifecycleConfirmation(lifecycleConfirmations, clock, {
        operation: "delete",
        saveId: id,
        save,
      });
    },
    async delete(id, options = {}) {
      assertSafeSaveId(id);
      await assertSessionRoot();
      pruneExpiredConfirmations(lifecycleConfirmations, clock);
      const confirmationToken = typeof options.confirmationToken === "string" ? options.confirmationToken : "";
      const confirmation = lifecycleConfirmations.get(confirmationToken);
      if (!confirmation || confirmation.operation !== "delete" || confirmation.saveId !== id) {
        throw new Error("delete save requires a valid runtime confirmation token");
      }
      lifecycleConfirmations.delete(confirmationToken);
      const saveDir = resolveSaveDir(savesRoot, id);
      if (!(await isRealDirectory(saveDir))) {
        return null;
      }
      await removeSaveDirectoryAtomically(savesRoot, id, true);
      return {
        ok: true,
        deleted: true,
        saveId: id,
      };
    },
    async deleteConfirmed(id) {
      assertSafeSaveId(id);
      await assertSessionRoot();
      const saveDir = resolveSaveDir(savesRoot, id);
      if (!(await isRealDirectory(saveDir))) {
        return null;
      }
      await removeSaveDirectoryAtomically(savesRoot, id, true);
      return {
        ok: true,
        deleted: true,
        saveId: id,
      };
    },
  };
}

async function removeSaveDirectoryAtomically(savesRoot, id, protectLinkedFiles = false) {
  const saveDir = resolveSaveDir(savesRoot, id);
  const tombstone = path.join(savesRoot, `${DELETE_TOMBSTONE_PREFIX}${id}-${crypto.randomBytes(8).toString("hex")}`);
  await fs.rename(saveDir, tombstone);
  try {
    await fs.writeFile(path.join(tombstone, ".delete-intent.json"), JSON.stringify({ schema: 1, saveId: id, requestedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    await makeWritable(tombstone, protectLinkedFiles);
    await fs.rm(tombstone, { recursive: true, force: false });
  } catch (error) {
    throw capabilityError("SAVE_DELETE_PENDING");
  }
}

async function discoverPendingDeletes(savesRoot) {
  const entries = await readSaveEntries(savesRoot); const pending = [];
  for (const entry of entries) {
    const match = entry.name.match(/^(?:\.delete-intent-([A-Za-z0-9][A-Za-z0-9_-]{0,63})-[a-f0-9]{16}|\.([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.deleting-[a-f0-9]{16})$/);
    if (!match || !entry.isDirectory()) continue;
    const target = path.join(savesRoot, entry.name);
    if (!(await isRealDirectory(target))) continue;
    pending.push(Object.freeze({ deletionId: entry.name, saveId: match[1] || match[2], state: "delete_pending" }));
  }
  return Object.freeze(pending);
}

async function makeWritable(target, protectLinkedFiles) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(target)) {
      await makeWritable(path.join(target, entry), protectLinkedFiles);
    }
    await fs.chmod(target, 0o700).catch(() => {});
  } else if (stat.isFile() && (!protectLinkedFiles || stat.nlink === 1)) {
    // Unlinking a save-owned name must not chmod another hard-linked name.
    await fs.chmod(target, 0o600).catch(() => {});
  }
}

async function pathExists(target) {
  return Boolean(await fs.lstat(target).catch(() => null));
}

async function lstatIfPresent(target) {
  return fs.lstat(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

async function readSaveEntries(savesRoot) {
  return fs.readdir(savesRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

function capabilityError(code) {
  return Object.assign(new Error(code), { code, retryable: ["STORE_BUSY", "SAVE_DELETE_PENDING"].includes(code) });
}

function projectCompatibleSummary(summary, compatibility, id) {
  const base = summary || {
    id,
    title: "当前冒险",
    createdAt: null,
    updatedAt: null,
    turn: null,
    revision: null,
    state_hint: null,
  };
  return Object.freeze({
    ...base,
    adventureLocale: compatibility.adventureLocale || null,
    adventureLocaleSource: compatibility.adventureLocaleSource || null,
    catalogRole: compatibility.status === "closed"
      ? "archive"
      : compatibility.playerContinuable === true
        ? "active"
        : "unavailable",
    schemaKind: compatibility.schemaKind,
    compatibility: Object.freeze({
      status: compatibility.status,
      playerContinuable: compatibility.playerContinuable === true,
      deleteAllowed: compatibility.deleteAllowed === true,
      errorCode: compatibility.errorCode || null,
      retryable: compatibility.retryable === true,
      adventureLocale: compatibility.adventureLocale || null,
      adventureLocaleSource: compatibility.adventureLocaleSource || null,
    }),
  });
}

function compareSummaries(a, b) {
  const roleRank = { active: 0, archive: 1, unavailable: 2 };
  const roleDifference = (roleRank[a.catalogRole] ?? 3) - (roleRank[b.catalogRole] ?? 3);
  if (roleDifference !== 0) return roleDifference;
  const bTime = Date.parse(b.updatedAt || "") || 0;
  const aTime = Date.parse(a.updatedAt || "") || 0;
  if (bTime !== aTime) {
    return bTime - aTime;
  }
  return a.id.localeCompare(b.id);
}

async function isRealDirectory(dirPath) {
  try {
    const stat = await fs.lstat(dirPath);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (_error) {
    return false;
  }
}

function resolveSaveDir(savesRoot, saveId) {
  assertSafeSaveId(saveId);
  const root = path.resolve(savesRoot);
  const saveDir = path.join(root, saveId);
  const relative = path.relative(root, saveDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("save id resolved outside saves root");
  }
  return saveDir;
}

function assertSafeSaveId(saveId) {
  if (!isSafeSaveId(saveId)) {
    throw new Error("save id must be ASCII letters, numbers, hyphen, or underscore");
  }
}

function isSafeSaveId(saveId) {
  return typeof saveId === "string" && SAVE_ID_PATTERN.test(saveId);
}

function pruneExpiredConfirmations(confirmations, clock) {
  const nowMs = clock().getTime();
  for (const [token, confirmation] of confirmations.entries()) {
    const expiresMs = Date.parse(confirmation.expiresAt || "");
    if (!expiresMs || expiresMs <= nowMs) {
      confirmations.delete(token);
    }
  }
}

function issueLifecycleConfirmation(confirmations, clock, details) {
  const confirmationToken = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(clock().getTime() + DELETE_CONFIRMATION_TTL_MS).toISOString();
  confirmations.set(confirmationToken, {
    operation: details.operation,
    saveId: details.saveId,
    expiresAt,
  });
  return {
    ok: true,
    operation: details.operation,
    requiresConfirmation: true,
    confirmationToken,
    expiresAt,
    save: details.save,
    warnings: Array.isArray(details.warnings) ? details.warnings : [],
  };
}

module.exports = {
  SAVE_ID_PATTERN,
  DELETE_CONFIRMATION_TTL_MS,
  DELETE_TOMBSTONE_PREFIX,
  createSaveSlotStore,
  isSafeSaveId,
};
