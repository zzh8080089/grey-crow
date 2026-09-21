"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { validateContract } = require("../contracts/v2");
const { readJsonFile, withFileQueue, writeJsonAtomic } = require("../runtime/storage-utils");

const PROFILE_SCHEMA_VERSION = "grey-crow-player-profile-v2";
const IDENTITY_SCHEMA_VERSION = "grey-crow-player-identity-v1";
const META_SCHEMA_VERSION = "grey-crow-player-profile-meta-v1";
const EDITABLE_FIELDS = Object.freeze([
  "preferredLanguage",
  "displayName",
  "pronouns",
  "narrativePreferences",
  "contentBoundaries",
  "notes",
]);
const EDITABLE_FIELD_SET = new Set(EDITABLE_FIELDS);
const SECRET_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i;

function createPlayerProfileStore(options = {}) {
  const profileRoot = requireAbsolute(options.profileRoot, "profileRoot");
  const profilePath = path.join(profileRoot, "profile.json");
  const identityPath = path.join(profileRoot, "identity.json");
  const metaPath = path.join(profileRoot, "profile-meta.json");
  const clock = typeof options.clock === "function" ? options.clock : () => new Date().toISOString();
  const idFactory = typeof options.idFactory === "function"
    ? options.idFactory
    : () => `player_${crypto.randomBytes(16).toString("hex")}`;
  const defaultLanguage = normalizeLanguage(options.defaultLanguage || "zh-CN");
  const storageOptions = { rootDir: profileRoot };

  async function load() {
    return withFileQueue(profilePath, loadInternal, storageOptions);
  }

  async function save(fields = {}) {
    return withFileQueue(profilePath, async () => {
      const current = await loadInternal();
      const patch = normalizeEditableFields(fields);
      const explicitFields = new Set(current.explicitFields);
      for (const field of Object.keys(patch)) explicitFields.add(field);
      const profile = {
        ...current.profile,
        ...patch,
        playerProfileId: current.profile.playerProfileId,
        schemaVersion: PROFILE_SCHEMA_VERSION,
        updatedAt: normalizeTimestamp(clock()),
      };
      assertProfileSafe(profile);
      validateContract("player-profile-v2", profile);
      const meta = createMeta([...explicitFields]);
      await writeJsonAtomic(profilePath, profile, storageOptions);
      await writeJsonAtomic(metaPath, meta, storageOptions);
      return freezeResult({ profile, explicitFields: meta.explicitFields, status: "saved", warning: null });
    }, storageOptions);
  }

  async function projectForModel() {
    const current = await load();
    const projection = { playerProfileId: current.profile.playerProfileId };
    for (const field of current.explicitFields) {
      const value = current.profile[field];
      if (Array.isArray(value) ? value.length > 0 : Boolean(value)) projection[field] = value;
    }
    return deepFreeze({
      schemaVersion: "grey-crow-player-profile-projection-v2",
      ...projection,
    });
  }

  async function loadInternal() {
    const identityRead = await readOptional(identityPath);
    const profileRead = await readOptional(profilePath);
    const profileValidation = validateExistingProfile(profileRead.value);
    let playerProfileId = validIdentityId(identityRead.value);
    let status = "ready";
    let warning = null;

    if (!playerProfileId && profileValidation.valid) {
      playerProfileId = profileValidation.profile.playerProfileId;
      status = "recovered_identity";
      warning = "PLAYER_PROFILE_IDENTITY_RECOVERED";
    }
    if (!playerProfileId) {
      playerProfileId = requireStableRef(idFactory());
      status = identityRead.exists || profileRead.exists ? "recovered_default" : "created";
      warning = status === "created" ? null : "PLAYER_PROFILE_RECOVERED_DEFAULT";
    }
    if (validIdentityId(identityRead.value) !== playerProfileId) {
      await writeJsonAtomic(identityPath, createIdentity(playerProfileId), storageOptions);
    }

    let profile;
    let explicitFields = [];
    if (profileValidation.valid && profileValidation.profile.playerProfileId === playerProfileId) {
      profile = profileValidation.profile;
      const metaRead = await readOptional(metaPath);
      const metaFields = validExplicitFields(metaRead.value);
      if (metaFields) {
        explicitFields = metaFields;
      } else if (metaRead.exists) {
        status = "recovered_metadata";
        warning = "PLAYER_PROFILE_METADATA_RECOVERED";
        await writeJsonAtomic(metaPath, createMeta([]), storageOptions);
      }
    } else {
      profile = createDefaultProfile(playerProfileId, defaultLanguage, clock());
      explicitFields = [];
      if (profileRead.exists) {
        status = "recovered_default";
        warning = "PLAYER_PROFILE_RECOVERED_DEFAULT";
      } else if (status === "ready") {
        status = "created";
      }
      await writeJsonAtomic(profilePath, profile, storageOptions);
      await writeJsonAtomic(metaPath, createMeta([]), storageOptions);
    }
    return freezeResult({ profile, explicitFields, status, warning });
  }

  return Object.freeze({ load, projectForModel, save });
}

function validateExistingProfile(value) {
  try {
    validateContract("player-profile-v2", value);
    assertProfileSafe(value);
    return { valid: true, profile: value };
  } catch {
    return { valid: false, profile: null };
  }
}

async function readOptional(filePath) {
  try {
    const value = await readJsonFile(filePath, null, { rootDir: path.dirname(filePath) });
    return { exists: value !== null, value };
  } catch {
    return { exists: true, value: null };
  }
}

function normalizeEditableFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw profileError("PLAYER_PROFILE_INPUT_INVALID", "Player profile fields must be an object.");
  const unknown = Object.keys(value).filter((field) => !EDITABLE_FIELD_SET.has(field));
  if (unknown.length > 0) throw profileError("PLAYER_PROFILE_FIELD_FORBIDDEN", "Player profile contains a non-editable field.");
  const patch = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    patch[field] = Array.isArray(fieldValue) ? fieldValue.map((item) => String(item)) : String(fieldValue);
  }
  return patch;
}

function createDefaultProfile(playerProfileId, preferredLanguage, timestamp) {
  const profile = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    playerProfileId,
    preferredLanguage,
    displayName: "",
    pronouns: "",
    narrativePreferences: [],
    contentBoundaries: [],
    notes: "",
    updatedAt: normalizeTimestamp(timestamp),
  };
  validateContract("player-profile-v2", profile);
  return profile;
}

function createIdentity(playerProfileId) {
  return { schemaVersion: IDENTITY_SCHEMA_VERSION, playerProfileId };
}

function createMeta(explicitFields) {
  return {
    schemaVersion: META_SCHEMA_VERSION,
    explicitFields: [...new Set(explicitFields)].filter((field) => EDITABLE_FIELD_SET.has(field)).sort(),
  };
}

function validIdentityId(value) {
  if (!value || value.schemaVersion !== IDENTITY_SCHEMA_VERSION || Object.keys(value).sort().join(",") !== "playerProfileId,schemaVersion") return null;
  try { return requireStableRef(value.playerProfileId); } catch { return null; }
}

function validExplicitFields(value) {
  if (!value || value.schemaVersion !== META_SCHEMA_VERSION || !Array.isArray(value.explicitFields) || Object.keys(value).sort().join(",") !== "explicitFields,schemaVersion") return null;
  const fields = [...new Set(value.explicitFields)];
  if (fields.length !== value.explicitFields.length || fields.some((field) => !EDITABLE_FIELD_SET.has(field))) return null;
  return fields.sort();
}

function assertProfileSafe(profile) {
  const visibleText = [
    profile.displayName,
    profile.pronouns,
    profile.notes,
    ...(profile.narrativePreferences || []),
    ...(profile.contentBoundaries || []),
  ].join("\n");
  if (SECRET_PATTERN.test(visibleText)) throw profileError("PLAYER_PROFILE_SECRET_REJECTED", "Player profile contains credential-like data.");
}

function normalizeLanguage(value) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized)) throw profileError("PLAYER_PROFILE_LANGUAGE_INVALID", "Player profile language is invalid.");
  return normalized;
}

function normalizeTimestamp(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(normalized)) throw profileError("PLAYER_PROFILE_TIMESTAMP_INVALID", "Player profile timestamp is invalid.");
  return normalized;
}

function requireStableRef(value) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(normalized)) throw profileError("PLAYER_PROFILE_ID_INVALID", "Player profile id is invalid.");
  return normalized;
}

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw profileError("PLAYER_PROFILE_PATH_INVALID", `${label} must be absolute.`);
  return path.resolve(value);
}

function freezeResult(value) {
  return deepFreeze({
    ok: true,
    profile: value.profile,
    explicitFields: [...value.explicitFields],
    persistence: { status: value.status, warning: value.warning },
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function profileError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

module.exports = {
  EDITABLE_FIELDS,
  IDENTITY_SCHEMA_VERSION,
  META_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  createPlayerProfileStore,
};
