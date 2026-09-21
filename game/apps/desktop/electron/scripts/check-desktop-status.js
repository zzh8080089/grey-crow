#!/usr/bin/env node
"use strict";

const { createDesktopStatus } = require("../desktop-status");

const secret = "STATUS_SECRET_SHOULD_NOT_LEAK";
const status = createDesktopStatus({
  settings: {
    api: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: secret,
    },
    audio: {
      gameVolume: 35,
      tts: {
        enabled: true,
        provider: "edge",
        apiKey: secret,
      },
    },
    apiKey: secret,
  },
  keyVerified: true,
  gameStarted: true,
  activeSaveId: "save_status",
  activeSave: { id: "save_status", title: "Status Check" },
  platform: "test-platform",
  appDataStatus: {
    schemaVersion: "desktop-app-data-v1",
    mode: "electron-userData",
    providerCheckMode: "electron-temp",
    dataRootReady: true,
    settingsReady: true,
    savesReady: true,
    providerCheckReady: true,
    overrideEnabled: false,
    providerCheckOverrideEnabled: false,
    localPathsExposed: false,
    dataRoot: "/tmp/SHOULD_NOT_LEAK",
  },
  credentialStatus: {
    schemaVersion: "desktop-credential-secure-v1",
    credentialPersistence: "secure-storage",
    hasVerifiedCredential: true,
    credentialId: "provider:deepseek",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    secureStorageEnabled: true,
    secureStorageAvailable: true,
    requiresRetestAfterRestart: false,
    persistentCredentialAvailable: true,
    platform: "test-platform",
    apiKey: secret,
  },
  localeState: {
    schemaVersion: "grey-crow-locale-state-v1",
    preferredLocale: "en-US",
    adventureLocale: "zh-CN",
    effectiveLocale: "zh-CN",
    localeRevision: "locale_000002",
    selectionRequired: false,
    activeAdventure: true,
    activeAdventureId: "save_status",
    adventureLocaleSource: "save_metadata",
  },
});

const raw = JSON.stringify(status);
assert(status.provider === "deepseek", "status should expose normalized provider.");
assert(status.model === "deepseek-v4-flash", "status should expose normalized model.");
assert(status.settings.audio.tts.provider === "disabled", "status should normalize disabled TTS provider.");
assert(status.settingsRuntime.credentialPersistence === "secure-storage", "status should expose secure credential mode.");
assert(status.settingsRuntime.requiresRetestAfterRestart === false, "status should expose restart restore semantics.");
assert(status.settingsRuntime.persistentCredentialAvailable === true, "status should expose remember-key availability.");
assert(status.dataRootReady === true && status.appData.localPathsExposed === false, "status should expose app data readiness without local paths.");
assert(status.credential.hasVerifiedCredential === true, "status should expose credential readiness.");
assert(status.credential.requiresRetestAfterRestart === false, "credential status should not require restart re-test when safeStorage is enabled.");
assert(status.credential.persistentCredentialAvailable === true, "credential status should claim persistent availability only from main process.");
assert(status.locale.preferredLocale === "en-US" && status.locale.adventureLocale === "zh-CN"
  && status.locale.effectiveLocale === "zh-CN", "desktop status must project menu and immutable Adventure locales separately.");
assert(status.settingsRuntime.secureStorageEnabled === true, "status should report secure storage enabled from main process.");
assert(!raw.includes(secret), "status must not expose raw secret values.");
assert(!raw.includes("/tmp/SHOULD_NOT_LEAK"), "status must not expose local path values.");
assert(!/apiKey|api_key/.test(raw), "status must not expose key field names.");

const proStatus = createDesktopStatus({
  settings: { api: { provider: "deepseek", model: "deepseek-v4-pro" } },
  keyVerified: true,
  credentialStatus: {
    credentialPersistence: "secure-storage",
    hasVerifiedCredential: true,
    credentialId: "provider:deepseek",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    secureStorageEnabled: true,
    secureStorageAvailable: true,
  },
});
assert(proStatus.keyVerified === true && proStatus.credential.model === "deepseek-v4-pro", "provider-scoped DeepSeek credentials should remain ready when switching from Flash to Pro.");

const customStatus = createDesktopStatus({
  settings: {
    api: {
      provider: "openai-compatible",
      model: "vendor/story-model",
      connectionId: "custom_0123456789abcdef",
      customConnections: [{
        id: "custom_0123456789abcdef",
        name: "Custom",
        provider: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        modelId: "vendor/story-model",
      }],
    },
  },
  keyVerified: true,
  credentialStatus: {
    credentialPersistence: "secure-storage",
    hasVerifiedCredential: true,
    credentialId: "connection:custom_0123456789abcdef",
    provider: "openai-compatible",
    model: "vendor/story-model",
    secureStorageEnabled: true,
    secureStorageAvailable: true,
  },
});
assert(customStatus.keyVerified === true, "custom credentials should be scoped by connectionId.");

const mismatchedCredentialStatus = createDesktopStatus({
  settings: {
    api: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
    },
  },
  keyVerified: true,
  credentialStatus: {
    schemaVersion: "desktop-credential-secure-v1",
    credentialPersistence: "secure-storage",
    hasVerifiedCredential: true,
    provider: "openai-compatible",
    model: "custom-model",
    secureStorageEnabled: true,
    secureStorageAvailable: true,
    requiresRetestAfterRestart: false,
    persistentCredentialAvailable: true,
    platform: "test-platform",
  },
});
assert(mismatchedCredentialStatus.keyVerified === false, "status must not verify a credential scoped to another provider/model.");
assert(mismatchedCredentialStatus.credential.provider === null, "mismatched credential provider should be withheld.");

process.stdout.write("desktop status checks passed\n");

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
