"use strict";

const { getSettingsCatalog, normalizeDesktopSettings } = require("./settings-store");

function createDesktopStatus({
  settings,
  keyVerified = false,
  gameStarted = false,
  activeSaveId = null,
  activeSave = null,
  platform = process.platform,
  appDataStatus = null,
  credentialStatus = null,
  localeState = null,
} = {}) {
  const catalog = getSettingsCatalog();
  const safeSettings = normalizeDesktopSettings(settings);
  const safeAppData = normalizeAppDataStatus(appDataStatus);
  const safeCredential = normalizeCredentialStatus(credentialStatus, {
    keyVerified,
    platform,
    catalog,
    settings: safeSettings,
  });
  return {
    provider: safeSettings.api.provider,
    model: safeSettings.api.model,
    keyVerified: Boolean(safeCredential.hasVerifiedCredential),
    gameStarted: Boolean(gameStarted),
    activeSaveId: activeSaveId || null,
    activeSave: activeSave || null,
    dataRootReady: Boolean(safeAppData.dataRootReady),
    appData: safeAppData,
    credential: safeCredential,
    locale: normalizeLocaleState(localeState, safeSettings),
    settingsRuntime: {
      schemaVersion: catalog.schemaVersion,
      credentialPersistence: safeCredential.credentialPersistence,
      requiresRetestAfterRestart: safeCredential.requiresRetestAfterRestart,
      persistentCredentialAvailable: safeCredential.persistentCredentialAvailable,
      secureStorageEnabled: safeCredential.secureStorageEnabled,
      secureStorageAvailable: safeCredential.secureStorageAvailable,
      platform,
    },
    settings: clone(safeSettings),
  };
}

function normalizeLocaleState(localeState, settings) {
  const source = localeState && typeof localeState === "object" ? localeState : {};
  const preferredLocale = source.preferredLocale || settings?.localization?.preferredLocale || "zh-CN";
  const adventureLocale = source.adventureLocale || null;
  return {
    schemaVersion: source.schemaVersion || "grey-crow-locale-state-v1",
    preferredLocale,
    adventureLocale,
    effectiveLocale: source.effectiveLocale || adventureLocale || preferredLocale,
    localeRevision: source.localeRevision || "locale_000000",
    selectionRequired: false,
    activeAdventure: Boolean(source.activeAdventure),
    activeAdventureId: source.activeAdventureId || null,
    adventureLocaleSource: source.adventureLocaleSource || null,
  };
}

function normalizeAppDataStatus(status = {}) {
  const source = status && typeof status === "object" ? status : {};
  return {
    schemaVersion: normalizeText(source.schemaVersion, "desktop-app-data-v1"),
    mode: normalizeText(source.mode, "unavailable"),
    providerCheckMode: normalizeText(source.providerCheckMode, "unavailable"),
    dataRootReady: Boolean(source.dataRootReady),
    settingsReady: Boolean(source.settingsReady),
    savesReady: Boolean(source.savesReady),
    providerCheckReady: Boolean(source.providerCheckReady),
    overrideEnabled: Boolean(source.overrideEnabled),
    providerCheckOverrideEnabled: Boolean(source.providerCheckOverrideEnabled),
    localPathsExposed: false,
    ...(source.errorCode ? { errorCode: normalizeText(source.errorCode, "APP_DATA_UNAVAILABLE") } : {}),
  };
}

function normalizeCredentialStatus(status = {}, { keyVerified, platform, catalog, settings } = {}) {
  const source = status && typeof status === "object" ? status : {};
  const provider = normalizeOptionalText(source.provider);
  const model = normalizeOptionalText(source.model);
  const credentialId = normalizeOptionalCredentialId(source.credentialId);
  const providerMatches = Boolean(provider && provider === settings?.api?.provider);
  const matchesSettings = credentialId?.startsWith("connection:")
    ? providerMatches && credentialId === `connection:${settings?.api?.connectionId || ""}`
    : (credentialId?.startsWith("provider:")
      ? providerMatches && credentialId === `provider:${settings?.api?.provider || ""}`
      : providerMatches && model === settings?.api?.model);
  const hasScopedCredential = Boolean(credentialId || (provider && model));
  const verified = hasScopedCredential
    ? Boolean(source.hasVerifiedCredential && matchesSettings)
    : Boolean(keyVerified);
  return {
    schemaVersion: normalizeText(source.schemaVersion, "desktop-credential-secure-v1"),
    credentialPersistence: normalizeText(
      source.credentialPersistence,
      catalog?.security?.credentialPersistence || "session-only"
    ),
    hasVerifiedCredential: verified,
    provider: matchesSettings ? provider : null,
    model: matchesSettings ? settings?.api?.model || model : null,
    verifiedAt: verified ? normalizeOptionalText(source.verifiedAt) : null,
    requiresRetestAfterRestart: Boolean(source.requiresRetestAfterRestart),
    persistentCredentialAvailable: Boolean(source.persistentCredentialAvailable),
    secureStorageEnabled: Boolean(source.secureStorageEnabled),
    secureStorageAvailable: Boolean(source.secureStorageAvailable),
    platform: normalizeText(source.platform || platform, "unknown"),
    lastErrorCode: normalizeOptionalText(source.lastErrorCode),
  };
}

function normalizeOptionalCredentialId(value) {
  return typeof value === "string" && /^(?:provider|connection):[A-Za-z0-9_.-]{1,128}$/.test(value)
    ? value
    : null;
}

function normalizeText(value, fallback) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : fallback;
}

function normalizeOptionalText(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  createDesktopStatus,
};
