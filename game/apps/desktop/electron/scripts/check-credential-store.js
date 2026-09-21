#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createCredentialStore,
  createSessionCredentialStore,
  inspectSecureStorage,
} = require("../credential-store");

const secret = "SESSION_SECRET_SHOULD_NOT_LEAK_1234567890";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-credential-"));
const credentialPath = path.join(tmp, "credentials", "provider.enc.json");
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${Buffer.from(value, "utf8").toString("base64")}`, "utf8"),
  decryptString: (value) => {
    const text = Buffer.from(value).toString("utf8");
    if (!text.startsWith("encrypted:")) {
      throw new Error("bad ciphertext");
    }
    return Buffer.from(text.slice("encrypted:".length), "base64").toString("utf8");
  },
};

const store = createCredentialStore({
  platform: "test-platform",
  safeStorage,
  secureStorageAvailable: inspectSecureStorage(safeStorage),
  credentialPath,
  clock: () => new Date("2026-05-20T00:00:00.000Z"),
});

assert(store.status().credentialPersistence === "secure-storage", "credential store should use secure storage when available.");
assert(store.status().requiresRetestAfterRestart === false, "secure credentials should not require re-test after restart.");
assert(store.status().persistentCredentialAvailable === true, "remember-key persistence should be available behind safeStorage.");
assert(store.status().secureStorageAvailable === true, "secure storage availability should be detectable.");
assert(store.status().secureStorageEnabled === true, "secure storage should be enabled when safeStorage and a credential path are available.");
assert(store.isVerified({ provider: "deepseek", model: "deepseek-v4-flash" }) === false, "empty store should not be verified.");

store.setVerifiedCredential({
  provider: "deepseek",
  model: "deepseek-v4-flash",
  secretValue: secret,
});

assert(fs.existsSync(credentialPath), "secure credential file should be written after successful verification.");
const diskRaw = fs.readFileSync(credentialPath, "utf8");
assert(!diskRaw.includes(secret), "credential file must not contain raw secret values.");
assert(!/apiKey|api_key|secretValue/.test(diskRaw), "credential file envelope must not expose key-like field names.");
assert(store.isVerified({ provider: "deepseek", model: "deepseek-v4-flash" }) === true, "stored credential should be verified.");
assert(store.getSecret({ provider: "deepseek", model: "deepseek-v4-flash" }) === secret, "main process should retrieve the secure secret.");
assert(store.getSecret({ provider: "openai-compatible", model: "deepseek-v4-flash" }) === "", "provider mismatch should not return a secret.");
assert(store.isVerified({ provider: "deepseek", model: "deepseek-v4-pro" }) === false, "Reusing a provider key must not claim that a different model has been tested.");

const customSecretA = "CUSTOM_SECRET_A_SHOULD_NOT_LEAK_1234567890";
const customSecretB = "CUSTOM_SECRET_B_SHOULD_NOT_LEAK_1234567890";
const fingerprintA = "a".repeat(64);
const fingerprintB = "b".repeat(64);
store.setVerifiedCredential({
  connectionId: "custom_0123456789abcdef",
  provider: "openai-compatible",
  model: "model-a",
  secretValue: customSecretA,
  fingerprint: fingerprintA,
});
store.setVerifiedCredential({
  connectionId: "custom_fedcba9876543210",
  provider: "openai-compatible",
  model: "model-b",
  secretValue: customSecretB,
  fingerprint: fingerprintB,
});
assert(store.getSecret({ connectionId: "custom_0123456789abcdef", provider: "openai-compatible" }) === customSecretA, "custom connection A should recover only its own key.");
assert(store.getSecret({ connectionId: "custom_fedcba9876543210", provider: "openai-compatible" }) === customSecretB, "custom connection B should recover only its own key.");
assert(store.isVerified({ connectionId: "custom_0123456789abcdef", provider: "openai-compatible", fingerprint: fingerprintA }) === true, "matching custom connection fingerprint should verify.");
assert(store.isVerified({ connectionId: "custom_0123456789abcdef", provider: "openai-compatible", fingerprint: fingerprintB }) === false, "changed custom connection identity should invalidate the stored key.");
const multiDiskRaw = fs.readFileSync(credentialPath, "utf8");
for (const leaked of [secret, customSecretA, customSecretB]) {
  assert(!multiDiskRaw.includes(leaked), "credential vault envelope must not contain raw secrets.");
}

const statusRaw = JSON.stringify(store.status());
assert(!statusRaw.includes(secret), "credential status must not expose raw secret values.");
assert(!/apiKey|api_key|secretValue/.test(statusRaw), "credential status must not expose key-like field names.");
assert(statusRaw.includes("secure-storage"), "credential status should disclose secure-storage mode.");
assert(statusRaw.includes("persistentCredentialAvailable"), "credential status should disclose persistent credential availability.");

const restartedStore = createCredentialStore({
  platform: "test-platform",
  safeStorage,
  secureStorageAvailable: true,
  credentialPath,
  clock: () => new Date("2026-05-20T00:01:00.000Z"),
});
assert(restartedStore.status({ provider: "deepseek" }).hasVerifiedCredential === true, "a fresh process should recover a secure stored credential.");
assert(restartedStore.getSecret({ provider: "deepseek", model: "deepseek-v4-flash" }) === secret, "a fresh process should decrypt the previous secret.");
assert(restartedStore.isVerified({ provider: "deepseek", model: "wrong-model" }) === false, "Verification must retain the tested model across restart.");
assert(restartedStore.getSecret({ connectionId: "custom_0123456789abcdef", provider: "openai-compatible" }) === customSecretA, "a fresh process should restore custom connection keys independently.");

restartedStore.clearSession();
assert(restartedStore.status({ provider: "deepseek" }).hasVerifiedCredential === true, "clearSession should keep secure credentials visible to the next status read.");
assert(restartedStore.status({ provider: "deepseek" }).requiresRetestAfterRestart === false, "clearSession should not downgrade secure credentials to retest-required.");
assert(restartedStore.getSecret({ provider: "deepseek", model: "deepseek-v4-flash" }) === secret, "clearSession should not delete secure credentials.");
restartedStore.clear({ connectionId: "custom_0123456789abcdef" });
assert(restartedStore.getSecret({ connectionId: "custom_0123456789abcdef", provider: "openai-compatible" }) === "", "clearing one custom connection must delete only its key.");
assert(restartedStore.getSecret({ connectionId: "custom_fedcba9876543210", provider: "openai-compatible" }) === customSecretB, "clearing one custom connection must preserve other keys.");
restartedStore.clear();
assert(!fs.existsSync(credentialPath), "clear should remove the secure credential file.");
assert(restartedStore.isVerified({ provider: "deepseek", model: "deepseek-v4-flash" }) === false, "clear should reset verification.");
assert(restartedStore.getSecret({ provider: "deepseek", model: "deepseek-v4-flash" }) === "", "clear should remove the secret.");

const legacyPayload = JSON.stringify({
  schemaVersion: "desktop-credential-secure-v1",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  secretValue: secret,
  verifiedAt: "2026-05-19T23:00:00.000Z",
});
fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
fs.writeFileSync(credentialPath, JSON.stringify({
  schemaVersion: "desktop-credential-envelope-v1",
  encrypted: true,
  ciphertext: Buffer.from(safeStorage.encryptString(legacyPayload)).toString("base64"),
}, null, 2));
const migratedStore = createCredentialStore({
  platform: "test-platform",
  safeStorage,
  secureStorageAvailable: true,
  credentialPath,
});
assert(migratedStore.getSecret({ provider: "deepseek" }) === secret, "legacy DeepSeek credentials should migrate without re-entry.");
const migratedEnvelope = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
assert(migratedEnvelope.schemaVersion === "desktop-credential-envelope-v2", "legacy credentials should be rewritten as the provider vault envelope.");
migratedStore.clear();

const sessionOnlyStore = createSessionCredentialStore({
  platform: "test-platform",
  secureStorageAvailable: false,
  clock: () => new Date("2026-05-20T00:02:00.000Z"),
});
assert(sessionOnlyStore.status().credentialPersistence === "session-only", "unavailable safeStorage should fall back to session-only.");
assert(sessionOnlyStore.status().requiresRetestAfterRestart === true, "session-only credentials should require restart re-test.");
sessionOnlyStore.setVerifiedCredential({
  provider: "deepseek",
  model: "deepseek-v4-flash",
  secretValue: secret,
});
assert(sessionOnlyStore.getSecret({ provider: "deepseek", model: "deepseek-v4-flash" }) === secret, "session fallback should work during the current process.");
const newSessionOnlyStore = createSessionCredentialStore({
  platform: "test-platform",
  secureStorageAvailable: false,
});
assert(newSessionOnlyStore.getSecret({ provider: "deepseek", model: "deepseek-v4-flash" }) === "", "session fallback must not recover across processes.");

assert(inspectSecureStorage({ isEncryptionAvailable: () => { throw new Error("unavailable"); } }) === false, "safeStorage errors should be treated as unavailable.");

// Failures are injected only into this isolated synthetic credential fixture.
const transactionalPath = path.join(tmp, "transactional", "provider.enc.json");
let refuseEncryption = false;
const transactionalStore = createCredentialStore({ safeStorage: {
  ...safeStorage, encryptString(value) {
    if (refuseEncryption) throw new Error("synthetic secure storage failure");
    return safeStorage.encryptString(value);
  },
}, credentialPath: transactionalPath, secureStorageAvailable: true });
transactionalStore.setVerifiedCredential({ provider: "deepseek", model: "old-model", secretValue: secret });
const oldCiphertext = fs.readFileSync(transactionalPath, "utf8");
refuseEncryption = true;
assertThrowsCode(() => transactionalStore.setVerifiedCredential({ provider: "deepseek", model: "new-model", secretValue: customSecretA }), "CREDENTIAL_WRITE_FAILED");
assert(transactionalStore.isVerified({ provider: "deepseek", model: "old-model" }), "Failed persistence must retain the previous tested model.");
assert(transactionalStore.getSecret({ provider: "deepseek" }) === secret, "Failed persistence must not publish the candidate key in memory.");
assert(fs.readFileSync(transactionalPath, "utf8") === oldCiphertext, "Failed encryption must retain the previous encrypted vault.");
refuseEncryption = false;
assertThrowsCode(() => transactionalStore.setVerifiedCredential({ provider: "deepseek", model: "new-model", secretValue: customSecretA }, {
  commit() { throw Object.assign(new Error("synthetic settings write failure"), { code: "SETTINGS_WRITE_FAILED" }); },
}), "SETTINGS_WRITE_FAILED");
assert(transactionalStore.getSecret({ provider: "deepseek" }) === secret, "Settings commit failure must retain the current in-memory key.");
assert(fs.readFileSync(transactionalPath, "utf8") === oldCiphertext, "Settings commit failure must restore the previous encrypted vault.");
const unlinkOriginal = fs.unlinkSync;
fs.unlinkSync = (filePath) => {
  if (filePath === transactionalPath) throw Object.assign(new Error("synthetic deletion failure"), { code: "EACCES" });
  return unlinkOriginal(filePath);
};
try {
  assertThrowsCode(() => transactionalStore.clear(), "CREDENTIAL_CLEAR_FAILED");
  assert(transactionalStore.getSecret({ provider: "deepseek" }) === "", "Failed disk deletion must still remove secrets from current memory.");
  assert(transactionalStore.status().lastErrorCode === "CREDENTIAL_CLEAR_FAILED", "Failed deletion must remain visible and retryable.");
  assert(fs.existsSync(transactionalPath), "The injected deletion failure must leave the encrypted fixture present.");
} finally { fs.unlinkSync = unlinkOriginal; }
transactionalStore.clear();
assert(!fs.existsSync(transactionalPath), "Retrying clear must remove the encrypted vault left by the first failure.");
transactionalStore.setVerifiedCredential({ provider: "deepseek", model: "old-model", secretValue: secret });
fs.writeFileSync(`${transactionalPath}.tmp`, "synthetic-encrypted-temp");
const unavailableStore = createCredentialStore({ safeStorage: null, credentialPath: transactionalPath, secureStorageAvailable: false });
unavailableStore.clear();
assert(!fs.existsSync(transactionalPath) && !fs.existsSync(`${transactionalPath}.tmp`), "Clear-all must remove old encrypted vaults and temp files even when OS secure storage is unavailable.");
assert(inspectSecureStorage({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" }) === false,
  "Linux basic_text must not be represented as secure credential storage.");
const unreadablePath = path.join(tmp, "unreadable", "provider.enc.json");
const writable = createCredentialStore({ safeStorage, credentialPath: unreadablePath, secureStorageAvailable: true });
writable.setVerifiedCredential({ provider: "deepseek", model: "model-a", secretValue: secret });
writable.setVerifiedCredential({ connectionId: "custom_0123456789abcdef", provider: "openai-compatible",
  model: "model-b", secretValue: customSecretB, fingerprint: fingerprintB });
const unreadableCiphertext = fs.readFileSync(unreadablePath, "utf8");
let denyDecryption = true;
const unreadable = createCredentialStore({ safeStorage: { ...safeStorage, decryptString(value) {
  if (denyDecryption) throw new Error("synthetic OS keychain access denied");
  return safeStorage.decryptString(value);
} }, credentialPath: unreadablePath, secureStorageAvailable: true });
assertThrowsCode(() => unreadable.setVerifiedCredential({ provider: "deepseek", model: "model-new", secretValue: "synthetic-replacement-key" }), "CREDENTIAL_READ_FAILED");
assertThrowsCode(() => unreadable.clear({ provider: "deepseek" }), "CREDENTIAL_READ_FAILED");
assert(fs.readFileSync(unreadablePath, "utf8") === unreadableCiphertext,
  "A read/decryption failure must not overwrite or unlink the vault through a single-connection operation.");
denyDecryption = false;
unreadable.setVerifiedCredential({ provider: "deepseek", model: "model-new", secretValue: customSecretA });
assert(unreadable.getSecret({ connectionId: "custom_0123456789abcdef" }) === customSecretB,
  "After OS access is restored, a retry must preserve the other saved keys.");
const missingAfterReadFailure = createCredentialStore({ safeStorage: { ...safeStorage,
  decryptString() { throw Object.assign(new Error("synthetic missing OS keychain item"), { code: "ENOENT" }); },
}, credentialPath: unreadablePath, secureStorageAvailable: true });
assertThrowsCode(() => missingAfterReadFailure.assertWritable(), "CREDENTIAL_READ_FAILED");
assert(fs.existsSync(unreadablePath), "A decryptor's ENOENT must not be treated as an absent vault file.");
fs.unlinkSync(unreadablePath);
missingAfterReadFailure.setVerifiedCredential({ provider: "deepseek", model: "model-after-removal", secretValue: secret });
assert(missingAfterReadFailure.isVerified({ provider: "deepseek", model: "model-after-removal" }),
  "After the source vault is actually removed, explicit save may start a fresh vault instead of retaining a stale read-failure lock.");
assert(missingAfterReadFailure.status().lastErrorCode === null, "Successful missing-file recovery must clear the old read error.");
const stillUnreadable = createCredentialStore({ safeStorage: { ...safeStorage, decryptString() { throw new Error("synthetic deny"); } },
  credentialPath: unreadablePath, secureStorageAvailable: true });
stillUnreadable.clear();
assert(!fs.existsSync(unreadablePath), "Explicit all-key deletion must remain possible when the vault cannot be decrypted.");
process.stdout.write("credential store checks passed\n");

function assertThrowsCode(callback, code) {
  let thrown;
  try { callback(); } catch (error) { thrown = error; }
  assert(thrown?.code === code, `Expected ${code}, received ${thrown?.code || "no error"}.`);
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
