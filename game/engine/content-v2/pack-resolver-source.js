"use strict";

const semver = require("semver");

const ENGINE_CONTENT_API_VERSION = "2.3.0";
const CORE_CAPABILITY_IDS = Object.freeze([
  "base-state",
  "compaction",
  "delete-game",
  "game-save",
  "memory",
  "new-game",
  "summarize",
  "transcript",
]);
const CORE_TOOL_NAMES = Object.freeze([
  "compact_context",
  "edit_current_save",
  "finalize_new_game",
  "read_memory",
  "read_state",
  "read_transcript_range",
  "search_memory",
  "supersede_memory",
  "upsert_memory",
]);
const CORE_IDS = new Set([...CORE_CAPABILITY_IDS, ...CORE_TOOL_NAMES]);
const ENGINE_OWNERSHIPS = new Set(["built_in", "player_owned", "imported_readonly"]);

function resolveContentPlan(input = {}) {
  const engineVersion = normalizeEngineVersion(input.engineVersion || ENGINE_CONTENT_API_VERSION);
  const packs = normalizePacks(input.packs, engineVersion);
  const selection = normalizeSelection(input.selection);
  const confirmations = normalizeConfirmations(input.replacementConfirmations);
  const packById = new Map(packs.map((pack) => [pack.id, pack]));
  const itemByRef = createItemLookup(packs);

  validatePackConflicts(packs, packById);

  const host = resolveSelectedItem(selection.host, "host", packById, itemByRef);
  const world = resolveSelectedItem(selection.world, "world", packById, itemByRef);
  const newGameSkill = resolveSelectedSkill(selection.newGameSkill, "new_game", packById, itemByRef);
  const skills = selection.skills.map((ref) => resolveSelectedSkill(ref, "ordinary", packById, itemByRef));
  assertUniqueSelection(skills);

  const selectedItems = [host, world, newGameSkill, ...skills];
  const replacements = [];
  for (const item of selectedItems) {
    if (!item.replaces) {
      continue;
    }
    const replacedId = item.replaces.itemId;
    if (CORE_IDS.has(replacedId)) {
      throw planError("PACK_CORE_REPLACEMENT_FORBIDDEN", "Core capabilities and Engine tools cannot be replaced.", {
        item_id: item.id,
        replaced_item_id: replacedId,
      });
    }
    const confirmationKey = `${item.id}:${replacedId}`;
    if (!confirmations.has(confirmationKey)) {
      throw planError("PACK_REPLACEMENT_CONFIRMATION_REQUIRED", "A non-core Skill replacement requires explicit confirmation.", {
        item_id: item.id,
        replaced_item_id: replacedId,
      });
    }
    replacements.push(Object.freeze({
      replacementItemId: item.id,
      replacedItemId: replacedId,
      confirmedByUser: true,
    }));
  }

  const sortedSkills = [...skills].sort(compareResolvedItems);
  const usedPackIds = new Set([host.packId, world.packId, newGameSkill.packId, ...sortedSkills.map((item) => item.packId)]);
  const activePacks = packs
    .filter((pack) => usedPackIds.has(pack.id))
    .sort(comparePacks)
    .map(projectPack);

  return Object.freeze({
    schemaVersion: "grey-crow-content-load-plan-v2",
    engineVersion,
    host,
    world,
    newGameSkill,
    skills: Object.freeze(sortedSkills),
    replacements: Object.freeze(replacements.sort(compareReplacements)),
    activePacks: Object.freeze(activePacks),
    routeHints: Object.freeze(sortedSkills.map((item) => Object.freeze({
      itemId: item.id,
      triggers: item.triggers,
    }))),
    engineCapabilities: CORE_CAPABILITY_IDS,
  });
}

function validateEngineCompatibility(range, engineVersion = ENGINE_CONTENT_API_VERSION) {
  const normalizedVersion = normalizeEngineVersion(engineVersion);
  if (typeof range !== "string" || !semver.validRange(range)) {
    throw planError("PACK_ENGINE_RANGE_INVALID", "Pack Engine compatibility range is invalid.");
  }
  if (!semver.satisfies(normalizedVersion, range, { includePrerelease: true })) {
    throw planError("PACK_ENGINE_INCOMPATIBLE", "Pack is not compatible with this Engine content API.", {
      engine_version: normalizedVersion,
    });
  }
  return true;
}

function normalizePacks(values, engineVersion) {
  if (!Array.isArray(values) || values.length === 0) {
    throw planError("PACK_PLAN_EMPTY", "At least one normalized Pack is required.");
  }
  const seen = new Set();
  return values.map((value) => {
    const validated = value?.schemaVersion === "grey-crow-validated-pack-v2" && Boolean(value?.manifest);
    const manifest = value?.manifest || value;
    const id = requiredString(manifest?.id, "PACK_PLAN_INVALID", "Pack id is required.");
    if (seen.has(id)) {
      throw planError("PACK_DUPLICATE_ID", "Pack ids must be unique.", { pack_id: id });
    }
    seen.add(id);
    validateEngineCompatibility(manifest.engineCompatibility, engineVersion);
    const ownership = validated ? normalizeOwnership(value.ownership) : null;
    const filesByPath = validated ? createValidatedFileLookup(value.files, id) : null;
    const modulesByItemId = validated
      ? createValidatedModuleLookup(value.resources?.skillModules, id)
      : null;
    const skillIOByItemId = validated
      ? createValidatedSkillIOLookup(value.resources?.skillIOCompanions, id)
      : null;
    const localizationsByItemId = validated
      ? createValidatedLocalizationLookup([
        ...(value.resources?.skillLocalizations || []),
        ...(value.resources?.narrativeLocalizations || []),
      ], id)
      : null;
    const items = (manifest.provides || []).map((item) => {
      const templates = Object.freeze([...(item.templates || [])]);
      const module = normalizeModuleMetadata(item, modulesByItemId, filesByPath, validated, id);
      const skillIO = normalizeSkillIOMetadata(item, skillIOByItemId, filesByPath, validated, id);
      const localization = normalizeLocalizationMetadata(item, localizationsByItemId, filesByPath, validated, id);
      const sourceFiles = resolveSourceFiles(
        [item.path, ...templates, ...(item.module ? [item.module.path] : []), ...(item.skillIO ? [item.skillIO.path] : []), ...localizationSourcePaths(localization)],
        filesByPath,
        id,
        item.id
      );
      return Object.freeze({
        id: item.id,
        type: item.type,
        title: item.title,
        path: item.path,
        language: item.language,
        description: item.description,
        danger: item.danger,
        skillClass: item.type === "skill" ? item.skillClass : null,
        triggers: Object.freeze([...(item.triggers || [])]),
        templates,
        readScopes: Object.freeze([...(item.readScopes || [])]),
        writeScopes: Object.freeze([...(item.writeScopes || [])]),
        replaces: item.replaces ? Object.freeze({ ...item.replaces }) : null,
        playerGuide: typeof item.playerGuide === "string" ? item.playerGuide : null,
        module,
        skillIO,
        localization,
        sourceFiles,
      });
    });
    return Object.freeze({
      id,
      title: manifest.title,
      version: manifest.version,
      ownership,
      languages: Object.freeze([...(manifest.languages || [])]),
      conflicts: Object.freeze([...(manifest.conflicts || [])]),
      permissions: Object.freeze([...(manifest.permissions || [])]),
      items: Object.freeze(items),
    });
  }).sort(comparePacks);
}

function createValidatedFileLookup(values, packId) {
  if (!Array.isArray(values)) {
    throw planError("PACK_VALIDATED_FILE_METADATA_INVALID", "Validated Pack file metadata is missing.", { pack_id: packId });
  }
  const lookup = new Map();
  for (const file of values) {
    if (
      !file
      || typeof file.relativePath !== "string"
      || !/^[a-f0-9]{64}$/.test(file.sha256 || "")
      || !Number.isInteger(file.sizeBytes)
      || file.sizeBytes < 0
      || lookup.has(file.relativePath)
    ) {
      throw planError("PACK_VALIDATED_FILE_METADATA_INVALID", "Validated Pack file metadata is invalid.", { pack_id: packId });
    }
    lookup.set(file.relativePath, file);
  }
  return lookup;
}

function createValidatedModuleLookup(values, packId) {
  const resources = values === undefined ? [] : values;
  if (!Array.isArray(resources)) {
    throw planError("PACK_VALIDATED_MODULE_METADATA_INVALID", "Validated Pack module metadata is invalid.", { pack_id: packId });
  }
  const lookup = new Map();
  for (const resource of resources) {
    if (
      !resource
      || typeof resource.itemId !== "string"
      || typeof resource.path !== "string"
      || !resource.definition
      || resource.definition.schemaVersion !== "grey-crow-skill-module-definition-v1"
      || !/^[a-f0-9]{64}$/.test(resource.sha256 || "")
      || !Number.isInteger(resource.sizeBytes)
      || resource.sizeBytes < 0
      || lookup.has(resource.itemId)
    ) {
      throw planError("PACK_VALIDATED_MODULE_METADATA_INVALID", "Validated Pack module metadata is invalid.", { pack_id: packId });
    }
    lookup.set(resource.itemId, resource);
  }
  return lookup;
}

function createValidatedSkillIOLookup(values, packId) {
  const resources = values === undefined ? [] : values;
  if (!Array.isArray(resources)) {
    throw planError("PACK_VALIDATED_SKILL_IO_METADATA_INVALID", "Validated Pack Skill I/O metadata is invalid.", { pack_id: packId });
  }
  const lookup = new Map();
  for (const resource of resources) {
    if (
      !resource
      || typeof resource.itemId !== "string"
      || typeof resource.path !== "string"
      || resource.companion?.schemaVersion !== "grey-crow-skill-io-companion-v1"
      || !/^[a-f0-9]{64}$/.test(resource.sha256 || "")
      || !Number.isInteger(resource.sizeBytes)
      || resource.sizeBytes < 0
      || lookup.has(resource.itemId)
    ) {
      throw planError("PACK_VALIDATED_SKILL_IO_METADATA_INVALID", "Validated Pack Skill I/O metadata is invalid.", { pack_id: packId });
    }
    lookup.set(resource.itemId, resource);
  }
  return lookup;
}

function createValidatedLocalizationLookup(values, packId) {
  const resources = values === undefined ? [] : values;
  if (!Array.isArray(resources)) {
    throw planError("PACK_VALIDATED_LOCALIZATION_METADATA_INVALID", "Validated Pack localization metadata is invalid.", { pack_id: packId });
  }
  const lookup = new Map();
  for (const resource of resources) {
    if (
      !resource
      || typeof resource.itemId !== "string"
      || typeof resource.path !== "string"
      || !resource.bundle
      || ![
        "grey-crow-skill-localization-bundle-v1",
        "grey-crow-narrative-localization-bundle-v1",
      ].includes(resource.bundle.schemaVersion)
      || !Array.isArray(resource.locales)
      || !/^[a-f0-9]{64}$/.test(resource.sha256 || "")
      || !Number.isInteger(resource.sizeBytes)
      || resource.sizeBytes < 0
      || lookup.has(resource.itemId)
    ) {
      throw planError("PACK_VALIDATED_LOCALIZATION_METADATA_INVALID", "Validated Pack localization metadata is invalid.", { pack_id: packId });
    }
    lookup.set(resource.itemId, resource);
  }
  return lookup;
}

function normalizeModuleMetadata(item, modulesByItemId, filesByPath, validated, packId) {
  if (!item.module) {
    return null;
  }
  if (!validated) {
    throw planError(
      "PACK_VALIDATED_METADATA_REQUIRED",
      "Skill modules can only be resolved from an Engine-validated Pack.",
      { pack_id: packId, item_id: item.id }
    );
  }
  const resource = modulesByItemId.get(item.id);
  const file = filesByPath.get(item.module.path);
  if (
    !resource
    || resource.path !== item.module.path
    || !file
    || file.sha256 !== resource.sha256
    || file.sizeBytes !== resource.sizeBytes
  ) {
    throw planError(
      "PACK_VALIDATED_MODULE_METADATA_INVALID",
      "Validated Skill module metadata does not match the manifest and file set.",
      { pack_id: packId, item_id: item.id }
    );
  }
  return Object.freeze({
    schemaVersion: item.module.schemaVersion,
    path: resource.path,
    definition: resource.definition,
    sha256: resource.sha256,
    sizeBytes: resource.sizeBytes,
  });
}

function normalizeSkillIOMetadata(item, resourcesByItemId, filesByPath, validated, packId) {
  if (!item.skillIO) return null;
  if (!validated) {
    throw planError(
      "PACK_VALIDATED_METADATA_REQUIRED",
      "Skill I/O companions can only be resolved from an Engine-validated Pack.",
      { pack_id: packId, item_id: item.id }
    );
  }
  const resource = resourcesByItemId.get(item.id);
  const file = filesByPath.get(item.skillIO.path);
  if (!resource || resource.path !== item.skillIO.path || !file
    || file.sha256 !== resource.sha256 || file.sizeBytes !== resource.sizeBytes) {
    throw planError(
      "PACK_VALIDATED_SKILL_IO_METADATA_INVALID",
      "Validated Skill I/O metadata does not match the manifest and file set.",
      { pack_id: packId, item_id: item.id }
    );
  }
  return Object.freeze({
    schemaVersion: item.skillIO.schemaVersion,
    path: resource.path,
    companion: resource.companion,
    sha256: resource.sha256,
    sizeBytes: resource.sizeBytes,
  });
}

function normalizeLocalizationMetadata(item, localizationsByItemId, filesByPath, validated, packId) {
  if (!item.localization) {
    return null;
  }
  if (!validated) {
    throw planError(
      "PACK_VALIDATED_METADATA_REQUIRED",
      "Content localization can only be resolved from an Engine-validated Pack.",
      { pack_id: packId, item_id: item.id }
    );
  }
  const resource = localizationsByItemId.get(item.id);
  const file = filesByPath.get(item.localization.path);
  if (
    !resource
    || resource.path !== item.localization.path
    || resource.sourceLocale !== item.language
    || !file
    || file.sha256 !== resource.sha256
    || file.sizeBytes !== resource.sizeBytes
  ) {
    throw planError(
      "PACK_VALIDATED_LOCALIZATION_METADATA_INVALID",
      "Validated content localization metadata does not match the manifest and file set.",
      { pack_id: packId, item_id: item.id }
    );
  }
  return deepFreeze({
    itemId: resource.itemId,
    itemType: resource.itemType || null,
    schemaVersion: item.localization.schemaVersion,
    path: resource.path,
    sourceLocale: resource.sourceLocale,
    bundle: resource.bundle,
    sha256: resource.sha256,
    sizeBytes: resource.sizeBytes,
    locales: resource.locales,
  });
}

function localizationSourcePaths(localization) {
  if (!localization) return [];
  return [
    localization.path,
    ...localization.locales.flatMap((locale) => [
      locale.body.path,
      ...(locale.templates || []).map((template) => template.path),
      ...(locale.modulePresentation ? [locale.modulePresentation.path] : []),
    ]),
  ];
}

function resolveSourceFiles(paths, filesByPath, packId, itemId) {
  if (!filesByPath) {
    return Object.freeze([]);
  }
  const files = paths.map((relativePath) => {
    const file = filesByPath.get(relativePath);
    if (!file) {
      throw planError(
        "PACK_VALIDATED_FILE_METADATA_INVALID",
        "Selected item source metadata is missing from the validated Pack.",
        { pack_id: packId, item_id: itemId }
      );
    }
    return file;
  });
  return Object.freeze(files);
}

function normalizeOwnership(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string" && ENGINE_OWNERSHIPS.has(value)) {
    return value;
  }
  throw planError("PACK_OWNERSHIP_INVALID", "Pack ownership must be assigned by the Engine.");
}

function normalizeSelection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw planError("PACK_SELECTION_INVALID", "Content selection is required.");
  }
  return {
    host: normalizeRef(value.host, "host"),
    world: normalizeRef(value.world, "world"),
    newGameSkill: normalizeRef(value.newGameSkill, "newGameSkill"),
    skills: Array.isArray(value.skills) ? value.skills.map((ref) => normalizeRef(ref, "skill")) : [],
  };
}

function normalizeRef(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw planError("PACK_SELECTION_INVALID", `A ${label} selection is required.`);
  }
  return Object.freeze({
    packId: requiredString(value.packId, "PACK_SELECTION_INVALID", `${label} packId is required.`),
    itemId: requiredString(value.itemId, "PACK_SELECTION_INVALID", `${label} itemId is required.`),
  });
}

function normalizeConfirmations(values) {
  const confirmations = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    if (value?.confirmedByUser === true && value.replacementItemId && value.replacedItemId) {
      confirmations.add(`${value.replacementItemId}:${value.replacedItemId}`);
    }
  }
  return confirmations;
}

function createItemLookup(packs) {
  const lookup = new Map();
  const globalIds = new Map();
  for (const pack of packs) {
    for (const item of pack.items) {
      lookup.set(`${pack.id}:${item.id}`, { pack, item });
      const previous = globalIds.get(item.id);
      if (previous && !item.replaces && !previous.item.replaces) {
        throw planError("PACK_ITEM_ID_COLLISION", "Duplicate item ids require an explicit replacement declaration.", {
          item_id: item.id,
          pack_id: pack.id,
        });
      }
      globalIds.set(item.id, { pack, item });
    }
  }
  return lookup;
}

function resolveSelectedItem(ref, expectedType, packById, itemByRef) {
  const pack = packById.get(ref.packId);
  const entry = itemByRef.get(`${ref.packId}:${ref.itemId}`);
  if (!pack || !entry || entry.item.type !== expectedType) {
    throw planError("PACK_SELECTION_NOT_FOUND", `Selected ${expectedType} item is not available.`, {
      pack_id: ref.packId,
      item_id: ref.itemId,
    });
  }
  const item = entry.item;
  return Object.freeze({
    packId: pack.id,
    packTitle: pack.title,
    packVersion: pack.version,
    ownership: pack.ownership,
    id: item.id,
    type: item.type,
    title: item.title,
    path: item.path,
    language: item.language,
    description: item.description,
    danger: item.danger,
    skillClass: item.type === "skill" ? item.skillClass : null,
    triggers: item.triggers,
    templates: item.templates,
    readScopes: item.readScopes,
    writeScopes: item.writeScopes,
    replaces: item.replaces,
    playerGuide: item.playerGuide,
    module: item.module,
    skillIO: item.skillIO,
    localization: item.localization,
    sourceFiles: item.sourceFiles,
  });
}

function resolveSelectedSkill(ref, expectedClass, packById, itemByRef) {
  const item = resolveSelectedItem(ref, "skill", packById, itemByRef);
  if (item.skillClass !== expectedClass) {
    throw planError("PACK_SKILL_CLASS_MISMATCH", "Selected Skill does not match the required lifecycle class.", {
      item_id: item.id,
      expected_skill_class: expectedClass,
    });
  }
  return item;
}

function validatePackConflicts(packs, packById) {
  for (const pack of packs) {
    for (const conflictId of pack.conflicts) {
      if (packById.has(conflictId)) {
        throw planError("PACK_CONFLICT", "Conflicting Packs cannot be resolved together.", {
          pack_id: pack.id,
          conflict_pack_id: conflictId,
        });
      }
    }
  }
}

function assertUniqueSelection(items) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw planError("PACK_SELECTION_DUPLICATE", "A Skill can only be selected once.", { item_id: item.id });
    }
    seen.add(item.id);
  }
}

function normalizeEngineVersion(value) {
  const normalized = String(value || "").trim();
  if (!semver.valid(normalized)) {
    throw planError("PACK_ENGINE_VERSION_INVALID", "Engine content API version is invalid.");
  }
  return normalized;
}

function projectPack(pack) {
  return Object.freeze({
    id: pack.id,
    title: pack.title,
    version: pack.version,
    ownership: pack.ownership,
    languages: pack.languages,
    permissions: pack.permissions,
  });
}

function comparePacks(left, right) {
  return left.id.localeCompare(right.id) || semver.compare(left.version, right.version);
}

function compareResolvedItems(left, right) {
  return left.id.localeCompare(right.id) || left.packId.localeCompare(right.packId) || semver.compare(left.packVersion, right.packVersion);
}

function compareReplacements(left, right) {
  return left.replacedItemId.localeCompare(right.replacedItemId) || left.replacementItemId.localeCompare(right.replacementItemId);
}

function requiredString(value, code, message) {
  if (typeof value !== "string" || !value.trim()) {
    throw planError(code, message);
  }
  return value.trim();
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function planError(code, message, meta = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  error.meta = Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, String(value).slice(0, 160)]));
  return error;
}

module.exports = {
  CORE_CAPABILITY_IDS,
  CORE_TOOL_NAMES,
  ENGINE_CONTENT_API_VERSION,
  resolveContentPlan,
  validateEngineCompatibility,
};
