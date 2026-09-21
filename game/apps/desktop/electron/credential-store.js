"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CREDENTIAL_SCHEMA_VERSION = "desktop-credential-vault-v2";
const CREDENTIAL_ENVELOPE_VERSION = "desktop-credential-envelope-v2";
const LEGACY_CREDENTIAL_SCHEMA_VERSION = "desktop-credential-secure-v1";
const LEGACY_CREDENTIAL_ENVELOPE_VERSION = "desktop-credential-envelope-v1";
const SECURE_CREDENTIAL_PERSISTENCE = "secure-storage";
const SESSION_CREDENTIAL_PERSISTENCE = "session-only";
const MAX_CREDENTIAL_ENTRIES = 16;

function createCredentialStore({
  platform = process.platform,
  safeStorage = null,
  secureStorageAvailable = inspectSecureStorage(safeStorage),
  credentialPath = "",
  clock = () => new Date(),
} = {}) {
  const normalizedPath = normalizeCredentialPath(credentialPath);
  const secureStorageEnabled = Boolean(
    secureStorageAvailable &&
    normalizedPath &&
    safeStorage &&
    typeof safeStorage.encryptString === "function" &&
    typeof safeStorage.decryptString === "function"
  );
  let entries = new Map();
  let persistedLoaded = false;
  let lastErrorCode = null;
  let vaultLoadFailed = false;

  function loadPersistedVault() {
    if (persistedLoaded || !secureStorageEnabled) {
      return entries;
    }
    persistedLoaded = true;
    let raw;
    try {
      raw = fs.readFileSync(normalizedPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        entries = new Map();
        lastErrorCode = null;
        vaultLoadFailed = false;
      } else {
        lastErrorCode = normalizeCredentialErrorCode(error, "CREDENTIAL_READ_FAILED");
        vaultLoadFailed = true;
      }
      return entries;
    }
    try {
      const envelope = JSON.parse(raw);
      const cipherText = typeof envelope?.ciphertext === "string" ? envelope.ciphertext : "";
      if (!cipherText || envelope?.encrypted !== true) {
        lastErrorCode = "INVALID_CREDENTIAL_ENVELOPE";
        vaultLoadFailed = true;
        return entries;
      }
      const plainText = safeStorage.decryptString(Buffer.from(cipherText, "base64"));
      const payload = JSON.parse(plainText);
      if (envelope.schemaVersion === CREDENTIAL_ENVELOPE_VERSION) {
        entries = normalizeVaultPayload(payload);
      } else if (envelope.schemaVersion === LEGACY_CREDENTIAL_ENVELOPE_VERSION) {
        const legacy = normalizeLegacyCredentialPayload(payload);
        if (!legacy) throw Object.assign(new Error("Invalid legacy credential payload."), { code: "INVALID_CREDENTIAL_PAYLOAD" });
        entries = new Map([[legacy.id, legacy]]);
        writePersistedVault();
      } else {
        lastErrorCode = "INVALID_CREDENTIAL_ENVELOPE";
        vaultLoadFailed = true;
        return entries;
      }
      lastErrorCode = null;
      vaultLoadFailed = false;
    } catch (error) {
      // An OS/decryption/migration error named ENOENT is not proof that the
      // source vault is absent; only readFileSync above can establish that.
      lastErrorCode = normalizeCredentialErrorCode(error, "CREDENTIAL_READ_FAILED");
      vaultLoadFailed = true;
    }
    return entries;
  }

  function writePersistedVault(candidateEntries = entries) {
    if (!secureStorageEnabled) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
      const payload = JSON.stringify(createVaultPayload(candidateEntries));
      const encrypted = safeStorage.encryptString(payload);
      const envelope = {
        schemaVersion: CREDENTIAL_ENVELOPE_VERSION,
        encrypted: true,
        entryCount: candidateEntries.size,
        ciphertext: Buffer.from(encrypted).toString("base64"),
      };
      const tempPath = `${normalizedPath}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(tempPath, normalizedPath);
      lastErrorCode = null;
    } catch (error) {
      lastErrorCode = normalizeCredentialErrorCode(error, "CREDENTIAL_WRITE_FAILED");
      throw Object.assign(new Error("Secure credential storage failed."), { code: "CREDENTIAL_WRITE_FAILED", retryable: true });
    }
  }

  function ensureLoaded() {
    loadPersistedVault();
    return entries;
  }

  function ensureWritableVault() {
    if (vaultLoadFailed) persistedLoaded = false;
    ensureLoaded();
    if (vaultLoadFailed) {
      throw Object.assign(new Error("Saved credentials could not be read. No existing keys were overwritten or deleted."),
        { code: "CREDENTIAL_READ_FAILED", retryable: true });
    }
  }

  return {
    assertWritable() {
      ensureWritableVault();
    },

    setVerifiedCredential({ credentialId, connectionId, provider, model, secretValue, fingerprint } = {}, { commit } = {}) {
      const normalizedProvider = normalizeIdentifier(provider);
      const id = resolveCredentialId({ credentialId, connectionId, provider: normalizedProvider });
      const normalizedSecret = normalizeSecret(secretValue);
      if (!id || !normalizedProvider || !normalizedSecret) {
        throw new Error("verified credential requires credential identity, provider, and secret");
      }
      ensureWritableVault();
      if (!entries.has(id) && entries.size >= MAX_CREDENTIAL_ENTRIES) {
        throw new Error("credential vault is full");
      }
      const previousEntries = entries;
      const candidateEntries = new Map(entries);
      candidateEntries.set(id, {
        id,
        provider: normalizedProvider,
        model: normalizeModelId(model),
        secretValue: normalizedSecret,
        verifiedAt: clock().toISOString(),
        fingerprint: normalizeFingerprint(fingerprint),
      });
      // Publish neither a new in-memory credential nor a new active connection
      // until both persistence steps have succeeded. The callback is synchronous.
      writePersistedVault(candidateEntries);
      try {
        if (commit) commit();
      } catch (error) {
        try {
          writePersistedVault(previousEntries);
        } catch (_rollbackError) {
          throw Object.assign(new Error("Connection settings could not be saved; secure credential rollback also failed."),
            { code: "CREDENTIAL_COMMIT_ROLLBACK_FAILED", retryable: true });
        }
        throw error;
      }
      entries = candidateEntries;
      persistedLoaded = true;
      return this.status({ credentialId: id });
    },

    getSecret(identity = {}) {
      const id = resolveCredentialId(identity);
      const credential = ensureLoaded().get(id);
      if (!credential || (identity.provider && credential.provider !== normalizeIdentifier(identity.provider))) {
        return "";
      }
      return credential.secretValue;
    },

    isVerified(identity = {}) {
      const id = resolveCredentialId(identity);
      const credential = ensureLoaded().get(id);
      if (!credential || (identity.provider && credential.provider !== normalizeIdentifier(identity.provider))) {
        return false;
      }
      const expectedFingerprint = normalizeFingerprint(identity.fingerprint);
      const expectedModel = normalizeModelId(identity.model);
      return (!expectedModel || credential.model === expectedModel)
        && (!expectedFingerprint || credential.fingerprint === expectedFingerprint);
    },

    clearSession() {
      entries = new Map();
      persistedLoaded = false;
      vaultLoadFailed = false;
      return this.status();
    },

    clear(identity = null) {
      const id = identity && typeof identity === "object" ? resolveCredentialId(identity) : "";
      if (id) ensureWritableVault();
      else ensureLoaded();
      if (id) {
        entries.delete(id);
      } else {
        entries.clear();
      }
      persistedLoaded = true;
      try {
        if (id && !secureStorageEnabled && normalizedPath && fs.existsSync(normalizedPath)) {
          throw new Error("Stored credentials cannot be selectively cleared while secure storage is unavailable.");
        }
        if (id && entries.size && secureStorageEnabled) {
          writePersistedVault();
        } else if (normalizedPath) {
          // Clear-all also removes encrypted data from a previous secure-storage
          // session when the OS key store is currently unavailable.
          for (const filePath of [normalizedPath, `${normalizedPath}.tmp`]) {
            try { fs.unlinkSync(filePath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
          }
        }
        lastErrorCode = null;
        vaultLoadFailed = false;
      } catch (_error) {
        // Cleared secrets stay absent in this process, but the caller must not
        // claim that deletion from this device succeeded. Retrying is supported.
        lastErrorCode = "CREDENTIAL_CLEAR_FAILED";
        throw Object.assign(new Error("Credentials were cleared from memory, but deletion from this device could not be confirmed."),
          { code: "CREDENTIAL_CLEAR_FAILED", retryable: true });
      }
      return this.status({ credentialId: id });
    },

    listStatus() {
      return [...ensureLoaded().values()].map(projectCredentialStatus);
    },

    status(identity = {}) {
      const id = resolveCredentialId(identity);
      const vault = ensureLoaded();
      const credential = id ? vault.get(id) : (vault.size === 1 ? [...vault.values()][0] : null);
      return {
        schemaVersion: CREDENTIAL_SCHEMA_VERSION,
        credentialPersistence: secureStorageEnabled ? SECURE_CREDENTIAL_PERSISTENCE : SESSION_CREDENTIAL_PERSISTENCE,
        credentialCount: vault.size,
        hasVerifiedCredential: Boolean(credential),
        credentialId: credential?.id || id || null,
        provider: credential?.provider || null,
        model: credential?.model || null,
        verifiedAt: credential?.verifiedAt || null,
        fingerprint: credential?.fingerprint || null,
        requiresRetestAfterRestart: !secureStorageEnabled,
        persistentCredentialAvailable: secureStorageEnabled,
        secureStorageEnabled,
        secureStorageAvailable: Boolean(secureStorageAvailable),
        platform: normalizePlatform(platform),
        lastErrorCode,
      };
    },
  };
}

function createSessionCredentialStore(options = {}) {
  return createCredentialStore({
    ...options,
    safeStorage: null,
    credentialPath: "",
    secureStorageAvailable: Boolean(options.secureStorageAvailable),
  });
}

function inspectSecureStorage(safeStorage) {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.())
      && safeStorage?.getSelectedStorageBackend?.() !== "basic_text";
  } catch (_error) {
    return false;
  }
}

function createVaultPayload(entries) {
  return {
    schemaVersion: CREDENTIAL_SCHEMA_VERSION,
    entries: [...entries.values()].map((entry) => ({ ...entry })),
  };
}

function normalizeVaultPayload(payload) {
  if (payload?.schemaVersion !== CREDENTIAL_SCHEMA_VERSION || !Array.isArray(payload.entries)
    || payload.entries.length > MAX_CREDENTIAL_ENTRIES) {
    throw Object.assign(new Error("Invalid credential vault payload."), { code: "INVALID_CREDENTIAL_PAYLOAD" });
  }
  const normalized = new Map();
  for (const item of payload.entries) {
    const entry = normalizeCredentialEntry(item);
    if (!entry || normalized.has(entry.id)) throw Object.assign(new Error("Invalid credential vault entry."),
      { code: "INVALID_CREDENTIAL_PAYLOAD" });
    normalized.set(entry.id, entry);
  }
  return normalized;
}

function normalizeCredentialEntry(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeCredentialId(value.id);
  const provider = normalizeIdentifier(value.provider);
  const secretValue = normalizeSecret(value.secretValue);
  const verifiedAt = normalizeIsoTime(value.verifiedAt);
  if (!id || !provider || !secretValue || !verifiedAt) {
    return null;
  }
  return {
    id,
    provider,
    model: normalizeModelId(value.model),
    secretValue,
    verifiedAt,
    fingerprint: normalizeFingerprint(value.fingerprint),
  };
}

function normalizeLegacyCredentialPayload(payload) {
  if (payload?.schemaVersion !== LEGACY_CREDENTIAL_SCHEMA_VERSION) {
    return null;
  }
  return normalizeCredentialEntry({
    id: createProviderCredentialId(payload.provider),
    provider: payload.provider,
    model: payload.model,
    secretValue: payload.secretValue,
    verifiedAt: payload.verifiedAt,
    fingerprint: "",
  });
}

function projectCredentialStatus(entry) {
  return {
    credentialId: entry.id,
    provider: entry.provider,
    model: entry.model || null,
    verifiedAt: entry.verifiedAt,
    fingerprint: entry.fingerprint || null,
  };
}

function resolveCredentialId(value = {}) {
  const explicit = normalizeCredentialId(value.credentialId);
  if (explicit) {
    return explicit;
  }
  const connectionId = normalizeIdentifier(value.connectionId);
  if (connectionId) {
    return `connection:${connectionId}`;
  }
  return createProviderCredentialId(value.provider);
}

function createProviderCredentialId(provider) {
  const normalized = normalizeIdentifier(provider);
  return normalized ? `provider:${normalized}` : "";
}

function normalizeCredentialId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^(?:provider|connection):[A-Za-z0-9_.-]{1,128}$/.test(text) ? text : "";
}

function normalizeSecret(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIdentifier(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.-]{1,128}$/.test(trimmed) ? trimmed : "";
}

function normalizeModelId(value) {
  return typeof value === "string" ? value.trim().slice(0, 256) : "";
}

function normalizeFingerprint(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

function normalizePlatform(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) ? value : "unknown";
}

function normalizeCredentialPath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  return path.resolve(value);
}

function normalizeIsoTime(value) {
  if (typeof value !== "string") {
    return "";
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function normalizeCredentialErrorCode(error, fallback) {
  const code = typeof error?.code === "string" ? error.code : "";
  return /^[A-Z0-9_]+$/.test(code) ? code : fallback;
}

module.exports = {
  CREDENTIAL_SCHEMA_VERSION,
  SECURE_CREDENTIAL_PERSISTENCE,
  SESSION_CREDENTIAL_PERSISTENCE,
  createCredentialStore,
  createProviderCredentialId,
  createSessionCredentialStore,
  inspectSecureStorage,
};
