#!/usr/bin/env node
"use strict";

// Current Main functions, real settings normalization and real in-memory vault;
// only the provider, Electron transport and OS persistence failures are fixtures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { createSessionCredentialStore } = require("../credential-store");
const { createRuntimeOperationRegistry } = require("../runtime-session");
const settingsApi = require("../settings-store");
const connectionsApi = require("../model-connections");
const source = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const KEY = "synthetic-old-connection-key";
const NEW_KEY = "synthetic-candidate-connection-key";

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function extract(name) {
  const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
  assert(start, `Missing production function ${name}`);
  const tail = source.slice(start.index + 1);
  const next = /\n(?:async )?function \w+\(/.exec(tail);
  assert(next, `Cannot delimit production function ${name}`);
  return source.slice(start.index, start.index + 1 + next.index);
}

function harness({ custom = false } = {}) {
  let settings = settingsApi.normalizeDesktopSettings();
  const credentials = createSessionCredentialStore();
  credentials.setVerifiedCredential({ provider: "deepseek", model: settings.api.model, secretValue: KEY });
  if (custom) {
    const draft = connectionsApi.upsertCustomConnection([], { name: "Current", baseUrl: "https://old.example.com/v1", modelId: "old-model" });
    const verified = connectionsApi.markCustomConnectionVerified(draft.connections, draft.connection.id);
    settings = settingsApi.normalizeDesktopSettings(settingsApi.mergeDesktopSettings(settings, { api: {
      provider: "openai-compatible", model: verified.connection.modelId,
      connectionId: verified.connection.id, customConnections: verified.connections,
    } }));
    credentials.setVerifiedCredential({ provider: "openai-compatible", connectionId: verified.connection.id,
      model: verified.connection.modelId, fingerprint: verified.connection.fingerprint, secretValue: KEY });
  }
  const effects = { resets: [], probes: [], saveError: null, activationError: false, settingsWrites: 0,
    preview: null, previewStarted: deferred() };
  const operations = createRuntimeOperationRegistry();
  const handlers = new Map();
  const context = vm.createContext({ ...settingsApi, ...connectionsApi, runtimeOperations: operations,
    CONNECTION_TEST_TIMEOUT_MS: 45_000,
    loadDesktopSettings: () => settings,
    saveDesktopSettings(value) {
      if (effects.saveError) throw effects.saveError;
      settings = settingsApi.normalizeDesktopSettings(value); effects.settingsWrites += 1;
    },
    getSettingsSnapshot: () => JSON.parse(JSON.stringify(settings)),
    getDesktopSettingsCatalog: settingsApi.getSettingsCatalog,
    getCredentialStore: () => credentials,
    normalizeApiKey: (value) => typeof value === "string" ? value.trim() : "",
    createProviderForSettings(value, key, timeout) { return { settings: value, key, timeout }; },
    runProviderCompatibilityProbe({ provider, signal }) {
      const pending = deferred(); effects.probes.push({ ...pending, provider, signal }); return pending.promise;
    },
    validateActiveContextSettings: async () => {
      effects.previewStarted.resolve();
      return effects.preview ? effects.preview.promise : { ok: true };
    },
    resetRuntimeSession(reason) {
      effects.resets.push(reason); operations.abortAll(reason);
      if (effects.activationError) throw new Error("synthetic activation failure");
    },
    createStatus: () => ({ keyVerified: credentials.isVerified(context.getCredentialIdentity(settings)),
      provider: settings.api.provider, model: settings.api.model }),
    createFailure(code, _message, retryable) { return { ok: false, error: { code, retryable }, status: context.createStatus() }; },
    createFailureFromError(error) { return context.createFailure(error.code || "INTERNAL_ERROR", "", error.retryable); },
    assertTrustedSender() {}, CHANNELS: new Proxy({}, { get: (_, name) => name }),
    ipcMain: { handle(name, callback) { handlers.set(name, callback); } },
    getLocaleCoordinator: () => ({ setPreferredLocale() {} }),
    readRequestedPreferredLocale: () => ({ provided: false }),
    gameStarted: false, activeSaveId: null, speechInput: null,
    settingsAffectTts: () => false, settingsAffectTtsCache: () => false,
    settingsAffectNarration: () => false, settingsAffectAgentContext: () => false,
    settingsAffectSavePolicy: () => false,
  });
  new vm.Script(["getCredentialIdentity", "resolveCredentialIdentityKey", "resolveProviderTestCandidate",
    "providerConnectionChangeBusy", "providerConnectionBusyFailure", "testAndUseProviderConnection",
    "clearSavedProviderCredentials"].map(extract).join("\n")).runInContext(context);
  for (const name of ["UPDATE_SETTINGS", "UPSERT_CUSTOM_CONNECTION", "DELETE_CUSTOM_CONNECTION",
    "CLEAR_ALL_PROVIDER_CREDENTIALS", "CLEAR_PROVIDER_CREDENTIAL"]) {
    const start = source.indexOf(`  ipcMain.handle(CHANNELS.${name},`);
    const end = source.indexOf("  ipcMain.handle(CHANNELS.", start + 1);
    assert(start >= 0 && end > start);
    new vm.Script(source.slice(start, end)).runInContext(context);
  }
  return { context, credentials, effects, operations, get settings() { return settings; },
    invoke: (name, payload) => handlers.get(name)({}, payload),
    async complete(index = effects.probes.length - 1) {
      effects.probes[index].resolve({ ok: true, protocol: "synthetic-compatible" });
      await Promise.resolve();
    },
  };
}

test("unsaved custom candidate is private until successful test-and-use", async () => {
  const h = harness(); const before = JSON.stringify(h.settings);
  const pending = h.context.testAndUseProviderConnection({ provider: "openai-compatible", apiKey: NEW_KEY,
    connection: { name: "Candidate", baseUrl: "https://candidate.example.com/v1", modelId: "candidate-model" } });
  assert.equal(JSON.stringify(h.settings), before);
  assert.equal(h.effects.resets.length, 0);
  assert.equal(h.credentials.getSecret({ provider: "deepseek" }), KEY);
  await h.complete(); const result = await pending;
  assert.equal(result.ok, true); assert.equal(result.applied, true);
  assert.equal(h.settings.api.customConnections.length, 1);
  assert.equal(h.credentials.isVerified(h.context.getCredentialIdentity(h.settings)), true);
  assert.equal(h.effects.resets.length, 1);
  assert(!JSON.stringify(result).includes(NEW_KEY));
});

test("edited endpoint cannot silently receive the saved key; failed explicit test keeps old connection", async () => {
  const h = harness({ custom: true }); const before = JSON.stringify(h.settings);
  const edited = { ...h.settings.api.customConnections[0], baseUrl: "https://new.example.com/v1" };
  const missing = await h.context.testAndUseProviderConnection({ provider: "openai-compatible", connection: edited });
  assert.equal(missing.error.code, "MISSING_API_KEY"); assert.equal(h.effects.probes.length, 0);
  const pending = h.context.testAndUseProviderConnection({ provider: "openai-compatible", connection: edited, apiKey: NEW_KEY });
  h.effects.probes[0].reject(Object.assign(new Error("synthetic invalid key"), { code: "UPSTREAM_AUTH_ERROR" }));
  const failed = await pending;
  assert.equal(failed.error.code, "UPSTREAM_AUTH_ERROR");
  assert.equal(JSON.stringify(h.settings), before); assert.equal(h.effects.resets.length, 0);
  assert.equal(h.credentials.getSecret(h.context.getCredentialIdentity(h.settings)), KEY);
});

test("custom key reuse requires the vault to verify the previous endpoint identity", async () => {
  const h = harness({ custom: true }); const previous = h.settings.api.customConnections[0];
  const mismatched = { ...previous, baseUrl: "https://another.example.com/v1", modelId: "another-model" };
  h.credentials.setVerifiedCredential({ provider: "openai-compatible", connectionId: previous.id,
    model: mismatched.modelId, fingerprint: connectionsApi.createConnectionFingerprint(mismatched), secretValue: NEW_KEY });
  const failed = await h.context.testAndUseProviderConnection({ provider: "openai-compatible", connectionId: previous.id });
  assert.equal(failed.error.code, "MISSING_API_KEY"); assert.equal(h.effects.probes.length, 0);
  const valid = harness({ custom: true }); const connection = valid.settings.api.customConnections[0];
  const pending = valid.context.testAndUseProviderConnection({ provider: "openai-compatible",
    connection: { ...connection, modelId: "new-model-same-endpoint" } });
  assert.equal(valid.effects.probes[0].provider.key, KEY);
  await valid.complete(); assert.equal((await pending).ok, true);
});

test("ordinary preferences cannot change models or forge custom verification", async () => {
  const h = harness(); const oldModel = h.settings.api.model;
  const result = await h.invoke("UPDATE_SETTINGS", { api: { model: "deepseek-v4-pro" } });
  assert.equal(result.error.code, "MODEL_CONNECTION_REQUIRES_TEST");
  assert.equal(h.settings.api.model, oldModel); assert.equal(h.effects.settingsWrites, 0);
  const forgedDraft = connectionsApi.upsertCustomConnection([], { name: "Forged", baseUrl: "https://forged.example.com/v1", modelId: "untested" });
  const forged = connectionsApi.markCustomConnectionVerified(forgedDraft.connections, forgedDraft.connection.id);
  assert.equal((await h.invoke("UPDATE_SETTINGS", { api: { customConnections: forged.connections } })).error.code,
    "MODEL_CONNECTION_REQUIRES_TEST");
  assert.equal(h.settings.api.customConnections.length, 0);
  const ordinary = await h.invoke("UPDATE_SETTINGS", { ui: { narrationTextSize: "large" }, audio: { gameVolume: 42 } });
  assert.equal(ordinary.ok, true); assert.equal(h.settings.ui.narrationTextSize, "large");
  assert.equal(h.settings.audio.gameVolume, 42); assert.equal(h.effects.resets.length, 0);
});

test("built-in key is reusable but a different model needs its own successful test", async () => {
  const h = harness();
  assert.equal(h.credentials.isVerified({ provider: "deepseek", model: "deepseek-v4-pro" }), false);
  const pending = h.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro" });
  assert.equal(h.effects.probes[0].provider.key, KEY);
  await h.complete(); assert.equal((await pending).ok, true);
  assert.equal(h.settings.api.model, "deepseek-v4-pro");
  assert.equal(h.credentials.isVerified({ provider: "deepseek", model: "deepseek-v4-pro" }), true);
});

test("all-key deletion requires confirmation and blocks late successful probes", async () => {
  const h = harness({ custom: true });
  const pending = h.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: NEW_KEY });
  const denied = h.invoke("CLEAR_ALL_PROVIDER_CREDENTIALS", {});
  assert.equal(denied.error.code, "CREDENTIAL_CLEAR_CONFIRMATION_REQUIRED");
  assert.equal(h.credentials.status().credentialCount, 2); assert.equal(h.effects.probes[0].signal.aborted, false);
  const cleared = h.invoke("CLEAR_ALL_PROVIDER_CREDENTIALS", { confirmed: true });
  assert.equal(cleared.ok, true); assert.equal(h.credentials.status().credentialCount, 0);
  assert.equal(h.settings.api.customConnections[0].verifiedAt, null);
  assert.equal(h.effects.probes[0].signal.aborted, true);
  await h.complete(); assert.equal((await pending).error.code, "REQUEST_ABORTED");
  assert.equal(h.credentials.status().credentialCount, 0); assert.equal(h.effects.resets.length, 1);
});

test("clearing an explicit other provider does not clear or interrupt the current custom connection", () => {
  const h = harness({ custom: true });
  const result = h.invoke("CLEAR_PROVIDER_CREDENTIAL", { provider: "deepseek" });
  assert.equal(result.ok, true);
  assert.equal(h.credentials.getSecret({ provider: "deepseek" }), "");
  assert.equal(h.credentials.getSecret(h.context.getCredentialIdentity(h.settings)), KEY);
  assert.equal(h.effects.resets.length, 0);
});

test("active actions prevent probe start and prevent a later commit without cancelling the action", async () => {
  const h = harness(); const action = h.operations.begin("run-turn");
  assert.equal((await h.context.testAndUseProviderConnection({ provider: "deepseek", apiKey: NEW_KEY })).error.code, "ADVENTURE_BUSY");
  assert.equal(h.effects.probes.length, 0); assert.equal(action.signal.aborted, false); action.finish();
  const pending = h.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: NEW_KEY });
  const nextAction = h.operations.begin("manual-save");
  await h.complete(); assert.equal((await pending).error.code, "ADVENTURE_BUSY");
  assert.equal(h.effects.resets.length, 0); assert.equal(nextAction.signal.aborted, false);
  assert.equal(h.credentials.getSecret({ provider: "deepseek" }), KEY); nextAction.finish();
});

test("replaced probes cannot overwrite the newer test", async () => {
  const h = harness();
  const old = h.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: NEW_KEY });
  const current = h.context.testAndUseProviderConnection({ provider: "deepseek", model: h.settings.api.model, apiKey: KEY });
  await h.complete(1); assert.equal((await current).ok, true);
  await h.complete(0); assert.equal((await old).error.code, "REQUEST_ABORTED");
  assert.equal(h.credentials.getSecret({ provider: "deepseek" }), KEY); assert.equal(h.effects.resets.length, 1);
});

test("settings persistence failure does not publish a candidate key or reset the current game", async () => {
  const h = harness(); const before = JSON.stringify(h.settings);
  h.effects.saveError = Object.assign(new Error("synthetic settings failure"), { code: "SETTINGS_WRITE_FAILED" });
  const pending = h.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: NEW_KEY });
  await h.complete(); assert.equal((await pending).error.code, "SETTINGS_WRITE_FAILED");
  assert.equal(JSON.stringify(h.settings), before); assert.equal(h.credentials.getSecret({ provider: "deepseek" }), KEY);
  assert.equal(h.effects.resets.length, 0);
});

test("unreadable credential storage is reported before any provider probe", async () => {
  const h = harness(); const before = JSON.stringify(h.settings);
  h.credentials.assertWritable = () => { throw Object.assign(new Error("synthetic read failure"), { code: "CREDENTIAL_READ_FAILED" }); };
  const failed = await h.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro" });
  assert.equal(failed.error.code, "CREDENTIAL_READ_FAILED");
  assert.equal(h.effects.probes.length, 0); assert.equal(h.effects.resets.length, 0);
  assert.equal(JSON.stringify(h.settings), before);
});

test("preferences changed while the probe runs are retained; changes during final preview reject stale commit", async () => {
  const h = harness();
  const pending = h.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: NEW_KEY });
  await h.invoke("UPDATE_SETTINGS", { audio: { gameVolume: 37 } });
  await h.complete(); assert.equal((await pending).ok, true); assert.equal(h.settings.audio.gameVolume, 37);
  const second = harness(); second.effects.preview = deferred();
  const stale = second.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: NEW_KEY });
  await second.complete();
  await second.effects.previewStarted.promise;
  second.context.saveDesktopSettings(settingsApi.mergeDesktopSettings(second.settings, { audio: { gameVolume: 29 } }));
  second.effects.preview.resolve({ ok: true });
  assert.equal((await stale).error.code, "CONTEXT_SETTINGS_STALE");
  assert.equal(second.credentials.getSecret({ provider: "deepseek" }), KEY);
});

test("legacy save-connection cannot edit a verified endpoint before testing", () => {
  const h = harness({ custom: true }); const before = JSON.stringify(h.settings);
  const changed = { ...h.settings.api.customConnections[0], modelId: "different-model" };
  const result = h.invoke("UPSERT_CUSTOM_CONNECTION", { connection: changed });
  assert.equal(result.error.code, "MODEL_CONNECTION_REQUIRES_TEST");
  assert.equal(JSON.stringify(h.settings), before); assert.equal(h.credentials.getSecret(h.context.getCredentialIdentity(h.settings)), KEY);
});

test("clear failure is not reported as success; late test cannot restore the removed in-memory key", async () => {
  const h = harness({ custom: true });
  const pending = h.context.testAndUseProviderConnection({ provider: "deepseek", apiKey: NEW_KEY });
  h.effects.saveError = Object.assign(new Error("synthetic metadata failure"), { code: "SETTINGS_WRITE_FAILED" });
  const cleared = h.invoke("CLEAR_ALL_PROVIDER_CREDENTIALS", { confirmed: true });
  assert.equal(cleared.error.code, "CREDENTIAL_CLEAR_FAILED"); assert.equal(h.credentials.status().credentialCount, 0);
  await h.complete(); assert.equal((await pending).error.code, "REQUEST_ABORTED");
  assert.equal(h.credentials.status().credentialCount, 0);
});

test("post-commit activation failure truthfully reports the saved selection", async () => {
  const h = harness(); h.effects.activationError = true;
  const pending = h.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: NEW_KEY });
  await h.complete(); const result = await pending;
  assert.equal(result.error.code, "MODEL_CONNECTION_ACTIVATION_FAILED"); assert.equal(result.applied, true);
  assert.equal(result.settings.api.model, "deepseek-v4-pro");
});

test("ordinary settings validation cannot later overwrite a successfully switched connection", async () => {
  const h = harness(); const preview = deferred(); const entered = deferred(); const previousModel = h.settings.api.model;
  h.context.validateActiveContextSettings = async (_previous, next) => {
    if (next.api.model === previousModel && next.ui.narrationTextSize === "large") {
      entered.resolve(); return preview.promise;
    }
    return { ok: true };
  };
  const saving = h.invoke("UPDATE_SETTINGS", { ui: { narrationTextSize: "large" } });
  await entered.promise;
  const pending = h.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: NEW_KEY });
  await h.complete(); assert.equal((await pending).ok, true);
  preview.resolve({ ok: true });
  assert.equal((await saving).error.code, "CONTEXT_SETTINGS_STALE");
  assert.equal(h.settings.api.model, "deepseek-v4-pro");
  assert.equal(h.credentials.isVerified(h.context.getCredentialIdentity(h.settings)), true);
});

test("failed asynchronous window changes roll back only the window, preserving a new connection", async () => {
  const h = harness(); const originalMode = h.settings.ui.windowMode; const osWindow = deferred(); const entered = deferred();
  h.context.mainWindow = {};
  h.context.canDisplayWindowMode = () => true;
  h.context.applyWindowMode = async (_mode, options) => {
    if (options?.allowFallback) return;
    entered.resolve(); return osWindow.promise;
  };
  const saving = h.invoke("UPDATE_SETTINGS", { ui: { windowMode: "fullscreen" } });
  await entered.promise;
  const pending = h.context.testAndUseProviderConnection({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: NEW_KEY });
  await h.complete(); assert.equal((await pending).ok, true);
  osWindow.reject(Object.assign(new Error("synthetic OS window rejection"), { code: "WINDOW_MODE_UNAVAILABLE" }));
  assert.equal((await saving).error.code, "WINDOW_MODE_UNAVAILABLE");
  assert.equal(h.settings.ui.windowMode, originalMode);
  assert.equal(h.settings.api.model, "deepseek-v4-pro");
  assert.equal(h.credentials.isVerified(h.context.getCredentialIdentity(h.settings)), true);
});
