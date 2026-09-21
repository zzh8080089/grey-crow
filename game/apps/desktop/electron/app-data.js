"use strict";

const fs = require("node:fs");
const path = require("node:path");

const APP_DATA_SCHEMA_VERSION = "desktop-app-data-v1";
const APP_DATA_DIR_NAME = "grey-crow";
const PROVIDER_CHECK_DIR_NAME = "grey-crow-provider-check";
const ENV_DATA_ROOT = "GREY_CROW_DATA_ROOT";
const ENV_PROVIDER_CHECK_ROOT = "GREY_CROW_PROVIDER_CHECK_ROOT";

function createAppDataLayout({
  userDataPath,
  tempPath,
  env = process.env,
  appDataDirName = APP_DATA_DIR_NAME,
  providerCheckDirName = PROVIDER_CHECK_DIR_NAME,
} = {}) {
  const dataOverride = normalizeOptionalEnvPath(env, ENV_DATA_ROOT);
  const providerCheckOverride = normalizeOptionalEnvPath(env, ENV_PROVIDER_CHECK_ROOT);
  const dataRoot = dataOverride || path.join(requireAbsolutePath(userDataPath, "userDataPath"), appDataDirName);
  const providerCheckRoot =
    providerCheckOverride || path.join(requireAbsolutePath(tempPath, "tempPath"), providerCheckDirName);
  const resolvedDataRoot = path.resolve(dataRoot);
  const resolvedProviderCheckRoot = path.resolve(providerCheckRoot);

  return Object.freeze({
    schemaVersion: APP_DATA_SCHEMA_VERSION,
    mode: dataOverride ? "override" : "electron-userData",
    providerCheckMode: providerCheckOverride ? "override" : "electron-temp",
    dataRoot: resolvedDataRoot,
    settingsPath: path.join(resolvedDataRoot, "settings.json"),
    savesRoot: path.join(resolvedDataRoot, "saves"),
    contentLibraryRoot: path.join(resolvedDataRoot, "user-content"),
    playerProfileRoot: path.join(resolvedDataRoot, "player-profile"),
    providerCheckRoot: resolvedProviderCheckRoot,
  });
}

function ensureAppDataLayout(layout) {
  assertLayout(layout);
  fs.mkdirSync(layout.dataRoot, { recursive: true });
  fs.mkdirSync(layout.savesRoot, { recursive: true });
  fs.mkdirSync(layout.contentLibraryRoot, { recursive: true });
  fs.mkdirSync(layout.playerProfileRoot, { recursive: true });
  fs.mkdirSync(layout.providerCheckRoot, { recursive: true });
  return projectAppDataStatus(layout, {
    dataRootReady: true,
    settingsReady: true,
    savesReady: true,
    providerCheckReady: true,
  });
}

function projectAppDataStatus(layout, readiness = {}) {
  return {
    schemaVersion: APP_DATA_SCHEMA_VERSION,
    mode: normalizeStatusMode(layout?.mode, "unavailable"),
    providerCheckMode: normalizeStatusMode(layout?.providerCheckMode, "unavailable"),
    dataRootReady: Boolean(readiness.dataRootReady),
    settingsReady: Boolean(readiness.settingsReady),
    savesReady: Boolean(readiness.savesReady),
    providerCheckReady: Boolean(readiness.providerCheckReady),
    overrideEnabled: layout?.mode === "override",
    providerCheckOverrideEnabled: layout?.providerCheckMode === "override",
    localPathsExposed: false,
  };
}

function projectAppDataFailureStatus(error) {
  return {
    schemaVersion: APP_DATA_SCHEMA_VERSION,
    mode: "unavailable",
    providerCheckMode: "unavailable",
    dataRootReady: false,
    settingsReady: false,
    savesReady: false,
    providerCheckReady: false,
    overrideEnabled: false,
    providerCheckOverrideEnabled: false,
    localPathsExposed: false,
    errorCode: normalizeAppDataErrorCode(error),
  };
}

function normalizeOptionalEnvPath(env, key) {
  const value = env && typeof env[key] === "string" ? env[key].trim() : "";
  if (!value) {
    return "";
  }
  return requireAbsolutePath(value, key);
}

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const trimmed = value.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`${label} must be absolute`);
  }
  return path.resolve(trimmed);
}

function assertLayout(layout) {
  if (!layout || typeof layout !== "object") {
    throw new Error("app data layout is required");
  }
  requireAbsolutePath(layout.dataRoot, "dataRoot");
  requireAbsolutePath(layout.savesRoot, "savesRoot");
  requireAbsolutePath(layout.contentLibraryRoot, "contentLibraryRoot");
  requireAbsolutePath(layout.playerProfileRoot, "playerProfileRoot");
  requireAbsolutePath(layout.providerCheckRoot, "providerCheckRoot");
}

function normalizeStatusMode(value, fallback) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) ? value : fallback;
}

function normalizeAppDataErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (/^[A-Z0-9_]+$/.test(code)) {
    return code;
  }
  return "APP_DATA_UNAVAILABLE";
}

module.exports = {
  APP_DATA_SCHEMA_VERSION,
  ENV_DATA_ROOT,
  ENV_PROVIDER_CHECK_ROOT,
  createAppDataLayout,
  ensureAppDataLayout,
  projectAppDataFailureStatus,
  projectAppDataStatus,
};
