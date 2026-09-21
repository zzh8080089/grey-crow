"use strict";

const SUPPORTED_GAME_LOCALES = Object.freeze(["zh-CN", "en-US", "ja-JP"]);
const SUPPORTED_GAME_LOCALE_SET = new Set(SUPPORTED_GAME_LOCALES);
const DEFAULT_GAME_LOCALE = "zh-CN";
const LEGACY_ADVENTURE_LOCALE = "zh-CN";
const LOCALE_REGISTRY_SCHEMA = "grey-crow-locale-registry-v1";
const LOCALE_STATE_SCHEMA = "grey-crow-locale-state-v1";

const GAME_LOCALE_OPTIONS = deepFreeze([
  { id: "zh-CN", nativeLabel: "简体中文", englishLabel: "Simplified Chinese" },
  { id: "en-US", nativeLabel: "English", englishLabel: "English" },
  { id: "ja-JP", nativeLabel: "日本語", englishLabel: "Japanese" },
]);

function getLocaleRegistry() {
  return deepFreeze({
    schemaVersion: LOCALE_REGISTRY_SCHEMA,
    supportedLocales: [...SUPPORTED_GAME_LOCALES],
    options: GAME_LOCALE_OPTIONS.map((option) => ({ ...option })),
    defaultLocale: DEFAULT_GAME_LOCALE,
    legacyAdventureLocale: LEGACY_ADVENTURE_LOCALE,
    firstLaunchSelectionRequired: false,
    adventureLocaleMutable: false,
  });
}

function canonicalizeGameLocale(value, options = {}) {
  const allowNull = options.allowNull === true;
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw localeError("GAME_LOCALE_REQUIRED", "A supported game locale is required.");
  }
  const raw = String(value).trim();
  let canonical;
  try {
    canonical = Intl.getCanonicalLocales(raw)[0];
  } catch (_error) {
    throw localeError("GAME_LOCALE_INVALID", "Game locale must be a valid BCP 47 language tag.");
  }
  if (!SUPPORTED_GAME_LOCALE_SET.has(canonical)) {
    throw localeError("GAME_LOCALE_UNSUPPORTED", `Unsupported game locale: ${canonical}.`, {
      requested_locale: canonical,
      supported_locales: [...SUPPORTED_GAME_LOCALES],
    });
  }
  return canonical;
}

function normalizePreferredLocale(value) {
  return canonicalizeGameLocale(value, { allowNull: true });
}

function normalizeStoredPreferredLocale(value) {
  try {
    return normalizePreferredLocale(value) || DEFAULT_GAME_LOCALE;
  } catch (_error) {
    return DEFAULT_GAME_LOCALE;
  }
}

function resolveAdventureLocale(value) {
  if (value === null || value === undefined || value === "") {
    return Object.freeze({
      adventureLocale: LEGACY_ADVENTURE_LOCALE,
      localeSource: "legacy_default",
    });
  }
  return Object.freeze({
    adventureLocale: canonicalizeGameLocale(value),
    localeSource: "save_metadata",
  });
}

function createLocaleCoordinator(options = {}) {
  let preferredLocale = normalizePreferredLocale(options.preferredLocale) || DEFAULT_GAME_LOCALE;
  let activeAdventure = null;
  let revision = 0;

  function setPreferredLocale(value) {
    if (activeAdventure) {
      throw localeError(
        "GAME_LOCALE_LOCKED_BY_ADVENTURE",
        "The menu language cannot change while an Adventure is active.",
        { adventure_id: activeAdventure.adventureId, adventure_locale: activeAdventure.adventureLocale }
      );
    }
    const next = canonicalizeGameLocale(value);
    if (next !== preferredLocale) {
      preferredLocale = next;
      revision += 1;
    }
    return snapshot();
  }

  function enterAdventure(input = {}) {
    const adventureId = requireAdventureId(input.adventureId);
    const resolved = resolveAdventureLocale(input.adventureLocale);
    if (activeAdventure) {
      if (activeAdventure.adventureId !== adventureId
        || activeAdventure.adventureLocale !== resolved.adventureLocale) {
        throw localeError("GAME_LOCALE_ADVENTURE_CONFLICT", "Another Adventure already owns the locale projection.", {
          active_adventure_id: activeAdventure.adventureId,
          requested_adventure_id: adventureId,
        });
      }
      return snapshot();
    }
    activeAdventure = Object.freeze({
      adventureId,
      adventureLocale: resolved.adventureLocale,
      localeSource: resolved.localeSource,
    });
    revision += 1;
    return snapshot();
  }

  function leaveAdventure(input = {}) {
    if (!activeAdventure) return snapshot();
    if (input.adventureId !== undefined && input.adventureId !== null
      && requireAdventureId(input.adventureId) !== activeAdventure.adventureId) {
      throw localeError("GAME_LOCALE_ADVENTURE_CONFLICT", "The requested Adventure does not own the locale projection.");
    }
    activeAdventure = null;
    revision += 1;
    return snapshot();
  }

  function snapshot() {
    const adventureLocale = activeAdventure?.adventureLocale || null;
    return deepFreeze({
      schemaVersion: LOCALE_STATE_SCHEMA,
      preferredLocale,
      adventureLocale,
      effectiveLocale: adventureLocale || preferredLocale,
      localeRevision: `locale_${String(revision).padStart(6, "0")}`,
      selectionRequired: false,
      activeAdventure: Boolean(activeAdventure),
      activeAdventureId: activeAdventure?.adventureId || null,
      adventureLocaleSource: activeAdventure?.localeSource || null,
    });
  }

  return Object.freeze({ enterAdventure, leaveAdventure, setPreferredLocale, snapshot });
}

function requireAdventureId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(id)) {
    throw localeError("GAME_LOCALE_ADVENTURE_ID_INVALID", "Adventure id is invalid.");
  }
  return id;
}

function localeError(code, message, meta = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  error.meta = Object.freeze({ ...meta });
  return error;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

module.exports = {
  DEFAULT_GAME_LOCALE,
  GAME_LOCALE_OPTIONS,
  LEGACY_ADVENTURE_LOCALE,
  LOCALE_REGISTRY_SCHEMA,
  LOCALE_STATE_SCHEMA,
  SUPPORTED_GAME_LOCALES,
  canonicalizeGameLocale,
  createLocaleCoordinator,
  getLocaleRegistry,
  normalizePreferredLocale,
  normalizeStoredPreferredLocale,
  resolveAdventureLocale,
};
