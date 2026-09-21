"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { validateContract } = require("../contracts/v2");
const { ENGINE_CONTENT_API_VERSION, validateEngineCompatibility } = require("./generated/pack-resolver.cjs");
const { assertSkillIOCompanionMatchesDefinition } = require("./skill-module-creator");

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MODULE_DEFINITION_BYTES = 256 * 1024;
const MAX_SKILL_IO_COMPANION_BYTES = 256 * 1024;
const MAX_LOCALIZATION_BUNDLE_BYTES = 512 * 1024;
const MAX_LOCALIZATION_OVERLAY_BYTES = 256 * 1024;
const MAX_PRESET_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PACK_BYTES = 128 * 1024 * 1024;
const MAX_PACK_FILES = 2048;
const ALLOWED_EXTENSIONS = new Set([".json", ".md"]);
const FORBIDDEN_EXTENSIONS = new Set([".bat", ".bin", ".cmd", ".com", ".dll", ".dylib", ".exe", ".js", ".mjs", ".cjs", ".node", ".ps1", ".py", ".sh", ".so", ".wasm"]);
const ENGINE_OWNERSHIPS = new Set(["built_in", "player_owned", "imported_readonly"]);

async function validatePackV2(packRoot, options = {}) {
  const ownership = normalizeOwnership(options.ownership);
  const root = await resolvePackRoot(packRoot, options.trustedRoot);
  const manifest = await readManifest(path.join(root, "manifest.json"));
  validateContract("extension-pack-v2", manifest);
  validateEngineCompatibility(manifest.engineCompatibility, options.engineVersion || ENGINE_CONTENT_API_VERSION);
  const files = await scanPackFiles(root);
  const features = await assertProvideFiles(root, manifest, new Map(files.map((file) => [file.relativePath, file])));
  assertFeatureCompatibility(manifest.engineCompatibility, features);
  return Object.freeze({
    ok: true,
    schemaVersion: "grey-crow-validated-pack-v2",
    engineVersion: String(options.engineVersion || ENGINE_CONTENT_API_VERSION),
    ownership,
    manifest: deepFreeze(JSON.parse(JSON.stringify(manifest))),
    files: Object.freeze(files),
    resources: deepFreeze({
      skillModules: features.skillModules,
      skillIOCompanions: features.skillIOCompanions,
      skillLocalizations: features.skillLocalizations,
      narrativeLocalizations: features.narrativeLocalizations,
    }),
    totals: Object.freeze({ files: files.length, bytes: files.reduce((sum, file) => sum + file.sizeBytes, 0) }),
  });
}

async function resolvePackRoot(packRoot, trustedRoot) {
  if (typeof packRoot !== "string" || !path.isAbsolute(packRoot)) {
    throw packError("PACK_ROOT_INVALID", "Pack root must be an absolute path.");
  }
  const requested = path.resolve(packRoot);
  const requestedStat = await fs.lstat(requested).catch(() => null);
  if (!requestedStat?.isDirectory() || requestedStat.isSymbolicLink()) {
    throw packError("PACK_ROOT_INVALID", "Pack root must be a real directory.");
  }
  const realRoot = await fs.realpath(requested);
  const trustBase = trustedRoot ? await fs.realpath(path.resolve(trustedRoot)) : path.dirname(realRoot);
  if (!isContained(trustBase, realRoot)) {
    throw packError("PACK_ROOT_OUTSIDE_TRUSTED_ROOT", "Pack root is outside the trusted content root.");
  }
  return realRoot;
}

async function readManifest(manifestPath) {
  const stat = await fs.lstat(manifestPath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw packError("PACK_MANIFEST_MISSING", "Pack manifest.json is missing.");
  }
  if (stat.size > MAX_MANIFEST_BYTES) {
    throw packError("PACK_MANIFEST_TOO_LARGE", "Pack manifest.json exceeds the size limit.");
  }
  try {
    return JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    throw packError("PACK_MANIFEST_INVALID_JSON", "Pack manifest.json is not valid JSON.");
  }
}

async function scanPackFiles(root) {
  const files = [];
  let totalBytes = 0;
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relativePath = path.relative(root, absolute).split(path.sep).join("/");
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw packError("PACK_SYMLINK_FORBIDDEN", "Pack contains a symbolic link.", { relative_path: relativePath });
      }
      if (stat.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!stat.isFile()) {
        throw packError("PACK_SPECIAL_FILE_FORBIDDEN", "Pack contains a non-regular file.", { relative_path: relativePath });
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (FORBIDDEN_EXTENSIONS.has(extension) || !ALLOWED_EXTENSIONS.has(extension)) {
        throw packError("PACK_FILE_TYPE_FORBIDDEN", "Pack contains an unsupported file type.", { relative_path: relativePath });
      }
      if (stat.size > MAX_FILE_BYTES) {
        throw packError("PACK_FILE_TOO_LARGE", "Pack file exceeds the size limit.", { relative_path: relativePath });
      }
      totalBytes += stat.size;
      if (totalBytes > MAX_PACK_BYTES) {
        throw packError("PACK_TOO_LARGE", "Pack exceeds the total size limit.");
      }
      files.push(Object.freeze({ relativePath, sizeBytes: stat.size, sha256: await hashFile(absolute) }));
      if (files.length > MAX_PACK_FILES) {
        throw packError("PACK_TOO_MANY_FILES", "Pack exceeds the file count limit.");
      }
    }
  }
  await walk(root);
  return files;
}

async function assertProvideFiles(root, manifest, filesByPath) {
  let usesContentApi21 = false;
  let usesContentApi22 = false;
  let usesContentApi23 = false;
  const skillModules = [];
  const skillIOCompanions = [];
  const skillLocalizations = [];
  const narrativeLocalizations = [];
  for (const item of manifest.provides) {
    const expectedExtension = item.type === "new_game_preset" ? ".json" : ".md";
    if (!filesByPath.has(item.path) || path.extname(item.path).toLowerCase() !== expectedExtension) {
      throw packError("PACK_ITEM_FILE_MISSING", "Pack item entry file is missing or invalid.", { item_id: item.id, relative_path: item.path });
    }
    for (const templatePath of item.templates || []) {
      if (!filesByPath.has(templatePath) || path.extname(templatePath).toLowerCase() !== ".md") {
        throw packError("PACK_TEMPLATE_FILE_MISSING", "Pack Skill template is missing or invalid.", { item_id: item.id, relative_path: templatePath });
      }
      const expectedTemplateId = `template:${path.posix.basename(templatePath).replace(/\.md$/i, "")}`;
      const templateText = await fs.readFile(path.join(root, templatePath), "utf8");
      const declaredIds = [...templateText.matchAll(/^Template ID:\s*`?(template:[A-Za-z0-9][A-Za-z0-9_.-]{0,79})`?\s*$/gmi)]
        .map((match) => match[1]);
      if (declaredIds.length !== 1 || declaredIds[0] !== expectedTemplateId) {
        throw packError("PACK_TEMPLATE_ID_MISMATCH", "Pack Skill template id does not match its declared file.", {
          item_id: item.id,
          relative_path: templatePath,
          expected_template_id: expectedTemplateId,
        });
      }
    }
    if (item.playerGuide || item.module) {
      usesContentApi21 = true;
    }
    const skillModule = item.module
      ? await readSkillModuleDefinition(root, item, filesByPath)
      : null;
    if (skillModule) skillModules.push(skillModule);
    const skillIO = item.skillIO
      ? await readSkillIOCompanion(root, item, filesByPath, skillModule)
      : null;
    if (skillIO) {
      usesContentApi23 = true;
      skillIOCompanions.push(skillIO);
    }
    if (item.localization) {
      usesContentApi22 = true;
      if (item.localization.schemaVersion === "grey-crow-skill-localization-ref-v1") {
        skillLocalizations.push(await readSkillLocalizationBundle(
          root,
          item,
          manifest,
          filesByPath,
          skillModule
        ));
      } else if (item.localization.schemaVersion === "grey-crow-narrative-localization-ref-v1") {
        narrativeLocalizations.push(await readNarrativeLocalizationBundle(
          root,
          item,
          manifest,
          filesByPath
        ));
      }
    }
    if (item.type === "new_game_preset") {
      const presetResource = await readContractJsonResource(root, item.path, filesByPath, {
        maxBytes: MAX_PRESET_BYTES,
        missingCode: "PACK_PRESET_INVALID",
        invalidCode: "PACK_PRESET_INVALID",
        missingMessage: "Pack New Game preset is missing or invalid.",
        invalidMessage: "Pack New Game preset failed contract validation.",
        contractId: "new-game-preset-v2",
        meta: { item_id: item.id },
      });
      const preset = presetResource.value;
      if (preset.id !== item.id || preset.language !== item.language) {
        throw packError("PACK_PRESET_INVALID", "Pack New Game preset identity does not match its manifest item.", {
          item_id: item.id,
        });
      }
      const presetLocales = preset.locales || [preset.language];
      if (!presetLocales.includes(preset.language)
        || presetLocales.some((locale) => !manifest.languages.includes(locale))) {
        throw packError("PACK_PRESET_INVALID", "Pack New Game preset locales are inconsistent with the Pack languages.", {
          item_id: item.id,
        });
      }
      const metadataLocales = new Set();
      for (const entry of preset.localizedMetadata || []) {
        if (entry.locale === preset.language || metadataLocales.has(entry.locale) || !presetLocales.includes(entry.locale)) {
          throw packError("PACK_PRESET_INVALID", "Pack New Game preset localized metadata is inconsistent with its locales.", {
            item_id: item.id,
          });
        }
        metadataLocales.add(entry.locale);
      }
      if (Array.isArray(preset.optionalSkills)) {
        usesContentApi21 = true;
      }
    }
  }
  skillModules.sort((left, right) => left.itemId.localeCompare(right.itemId));
  skillIOCompanions.sort((left, right) => left.itemId.localeCompare(right.itemId));
  skillLocalizations.sort((left, right) => left.itemId.localeCompare(right.itemId));
  narrativeLocalizations.sort((left, right) => left.itemId.localeCompare(right.itemId));
  return deepFreeze({ usesContentApi21, usesContentApi22, usesContentApi23, skillModules, skillIOCompanions, skillLocalizations, narrativeLocalizations });
}

async function readNarrativeLocalizationBundle(root, item, manifest, filesByPath) {
  const resource = await readContractJsonResource(root, item.localization.path, filesByPath, {
    maxBytes: MAX_LOCALIZATION_BUNDLE_BYTES,
    missingCode: "PACK_NARRATIVE_LOCALIZATION_FILE_MISSING",
    invalidCode: "PACK_NARRATIVE_LOCALIZATION_INVALID",
    missingMessage: "Pack narrative localization bundle is missing or invalid.",
    invalidMessage: "Pack narrative localization bundle failed contract validation.",
    contractId: "narrative-localization-bundle-v1",
    meta: { item_id: item.id },
  });
  const bundle = resource.value;
  if (bundle.itemId !== item.id || bundle.itemType !== item.type || bundle.sourceLocale !== item.language) {
    throw packError(
      "PACK_NARRATIVE_LOCALIZATION_IDENTITY_MISMATCH",
      "Pack narrative localization identity does not match its manifest item.",
      { item_id: item.id }
    );
  }
  const declaredLanguages = new Set(manifest.languages);
  const seenLocales = new Set([bundle.sourceLocale]);
  const locales = [];
  for (const locale of bundle.locales) {
    if (!declaredLanguages.has(locale.locale)) {
      throw packError(
        "PACK_NARRATIVE_LOCALIZATION_LANGUAGE_UNDECLARED",
        "Localized narrative language must be declared by the Pack.",
        { item_id: item.id, locale: locale.locale }
      );
    }
    if (seenLocales.has(locale.locale)) {
      throw packError(
        "PACK_NARRATIVE_LOCALIZATION_LOCALE_DUPLICATE",
        "Localized narrative language must be unique and different from the source language.",
        { item_id: item.id, locale: locale.locale }
      );
    }
    seenLocales.add(locale.locale);
    const body = await readLocalizationMarkdown(root, locale.contentPath, filesByPath, item.id);
    locales.push(deepFreeze({
      locale: locale.locale,
      title: locale.title,
      description: locale.description,
      body: { path: locale.contentPath, sha256: body.sha256, sizeBytes: body.sizeBytes },
    }));
  }
  return deepFreeze({
    itemId: item.id,
    itemType: item.type,
    path: item.localization.path,
    sourceLocale: bundle.sourceLocale,
    bundle,
    sha256: resource.sha256,
    sizeBytes: resource.sizeBytes,
    locales,
  });
}

async function readSkillLocalizationBundle(root, item, manifest, filesByPath, skillModule) {
  const resource = await readContractJsonResource(root, item.localization.path, filesByPath, {
    maxBytes: MAX_LOCALIZATION_BUNDLE_BYTES,
    missingCode: "PACK_SKILL_LOCALIZATION_FILE_MISSING",
    invalidCode: "PACK_SKILL_LOCALIZATION_INVALID",
    missingMessage: "Pack Skill localization bundle is missing or invalid.",
    invalidMessage: "Pack Skill localization bundle failed contract validation.",
    contractId: "skill-localization-bundle-v1",
    meta: { item_id: item.id },
  });
  const bundle = resource.value;
  if (bundle.itemId !== item.id || bundle.sourceLocale !== item.language) {
    throw packError("PACK_SKILL_LOCALIZATION_IDENTITY_MISMATCH", "Pack Skill localization identity does not match its manifest item.", {
      item_id: item.id,
    });
  }
  const declaredLanguages = new Set(manifest.languages);
  const sourceTemplateIds = (item.templates || [])
    .map(templateIdFromPath)
    .sort();
  const locales = [];
  for (const locale of bundle.locales) {
    if (!declaredLanguages.has(locale.locale)) {
      throw packError("PACK_SKILL_LOCALIZATION_LANGUAGE_UNDECLARED", "Localized Skill language must be declared by the Pack.", {
        item_id: item.id,
        locale: locale.locale,
      });
    }
    const body = await readLocalizationMarkdown(root, locale.skillPath, filesByPath, item.id);
    const templates = [];
    for (const template of locale.templates) {
      const file = await readLocalizationMarkdown(root, template.path, filesByPath, item.id);
      assertTemplateDeclaration(await fs.readFile(path.join(root, template.path), "utf8"), template.templateId, item.id, template.path);
      templates.push(deepFreeze({
        templateId: template.templateId,
        path: template.path,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
      }));
    }
    const localizedTemplateIds = templates.map((template) => template.templateId).sort();
    if (!sameStrings(sourceTemplateIds, localizedTemplateIds)) {
      throw packError("PACK_SKILL_LOCALIZATION_TEMPLATE_SET_MISMATCH", "Localized Skill templates must preserve the source template ids.", {
        item_id: item.id,
        locale: locale.locale,
      });
    }
    const hasOverlay = locale.modulePresentationPath !== null;
    if (hasOverlay !== Boolean(skillModule)) {
      throw packError("PACK_SKILL_LOCALIZATION_MODULE_MISMATCH", "Localized module presentation must be present exactly when the Skill has a module.", {
        item_id: item.id,
        locale: locale.locale,
      });
    }
    const modulePresentation = hasOverlay
      ? await readLocalizedModulePresentation(root, item, locale, filesByPath, skillModule)
      : null;
    locales.push(deepFreeze({
      locale: locale.locale,
      title: locale.title,
      description: locale.description,
      triggers: [...locale.triggers],
      playerGuide: locale.playerGuide,
      body: { path: locale.skillPath, sha256: body.sha256, sizeBytes: body.sizeBytes },
      templates,
      modulePresentation,
    }));
  }
  return deepFreeze({
    itemId: item.id,
    path: item.localization.path,
    sourceLocale: bundle.sourceLocale,
    bundle,
    sha256: resource.sha256,
    sizeBytes: resource.sizeBytes,
    locales,
  });
}

async function readLocalizationMarkdown(root, relativePath, filesByPath, itemId) {
  const file = filesByPath.get(relativePath);
  if (!file || path.extname(relativePath).toLowerCase() !== ".md") {
    throw packError("PACK_SKILL_LOCALIZATION_RESOURCE_MISSING", "Localized Skill Markdown resource is missing or invalid.", {
      item_id: itemId,
      relative_path: relativePath,
    });
  }
  const raw = await fs.readFile(path.join(root, relativePath));
  if (raw.length !== file.sizeBytes || hashBuffer(raw) !== file.sha256) {
    throw packError("PACK_SKILL_LOCALIZATION_RESOURCE_INVALID", "Localized Skill resource changed during validation.", {
      item_id: itemId,
      relative_path: relativePath,
    });
  }
  return file;
}

async function readLocalizedModulePresentation(root, item, locale, filesByPath, skillModule) {
  const resource = await readContractJsonResource(root, locale.modulePresentationPath, filesByPath, {
    maxBytes: MAX_LOCALIZATION_OVERLAY_BYTES,
    missingCode: "PACK_SKILL_LOCALIZATION_OVERLAY_MISSING",
    invalidCode: "PACK_SKILL_LOCALIZATION_OVERLAY_INVALID",
    missingMessage: "Localized Skill module presentation is missing or invalid.",
    invalidMessage: "Localized Skill module presentation failed contract validation.",
    contractId: "skill-module-presentation-overlay-v1",
    meta: { item_id: item.id, locale: locale.locale },
  });
  if (resource.value.itemId !== item.id || resource.value.locale !== locale.locale) {
    throw packError("PACK_SKILL_LOCALIZATION_OVERLAY_IDENTITY_MISMATCH", "Localized module presentation identity does not match its Skill locale.", {
      item_id: item.id,
      locale: locale.locale,
    });
  }
  assertPresentationOverlayMatchesDefinition(resource.value, skillModule.definition, item.id, locale.locale);
  return deepFreeze({
    path: locale.modulePresentationPath,
    presentation: resource.value,
    sha256: resource.sha256,
    sizeBytes: resource.sizeBytes,
  });
}

function assertPresentationOverlayMatchesDefinition(overlay, definition, itemId, locale) {
  const actions = new Map((overlay.actions || []).map((action) => [action.actionId, action]));
  const expectedActions = (definition.actions || []).map((action) => action.id).sort();
  if (!sameStrings([...actions.keys()].sort(), expectedActions)) {
    throwLocalizationOverlayShape(itemId, locale);
  }
  const fields = new Map(overlay.fields.map((field) => [field.fieldId, field]));
  if (!sameStrings([...fields.keys()].sort(), definition.fields.map((field) => field.id).sort())) {
    throwLocalizationOverlayShape(itemId, locale);
  }
  for (const field of definition.fields) {
    const translated = fields.get(field.id);
    const expectedOptions = field.type === "enum" ? field.options.map((option) => option.value).sort() : [];
    if (!sameStrings(expectedOptions, translated.options.map((option) => option.value).sort())) {
      throwLocalizationOverlayShape(itemId, locale);
    }
    const expectedItemFields = field.type === "record_list" ? field.itemFields : [];
    if (!sameStrings(expectedItemFields.map((entry) => entry.id).sort(), translated.itemFields.map((entry) => entry.fieldId).sort())) {
      throwLocalizationOverlayShape(itemId, locale);
    }
    const translatedItemFields = new Map(translated.itemFields.map((entry) => [entry.fieldId, entry]));
    for (const itemField of expectedItemFields) {
      const translatedItem = translatedItemFields.get(itemField.id);
      const expectedItemOptions = itemField.type === "enum" ? itemField.options.map((option) => option.value).sort() : [];
      if (!sameStrings(expectedItemOptions, translatedItem.options.map((option) => option.value).sort())) {
        throwLocalizationOverlayShape(itemId, locale);
      }
    }
    const expectedMilestones = (field.display?.summary?.milestones || []).map((milestone) => milestone.minimum).sort((a, b) => a - b);
    const translatedMilestones = translated.milestones.map((milestone) => milestone.minimum).sort((a, b) => a - b);
    if (!sameStrings(expectedMilestones, translatedMilestones)) {
      throwLocalizationOverlayShape(itemId, locale);
    }
  }
}

function throwLocalizationOverlayShape(itemId, locale) {
  throw packError("PACK_SKILL_LOCALIZATION_OVERLAY_SHAPE_MISMATCH", "Localized module presentation must preserve every stable field, option and milestone identity.", {
    item_id: itemId,
    locale,
  });
}

function assertTemplateDeclaration(templateText, expectedTemplateId, itemId, templatePath) {
  const declaredIds = [...String(templateText).matchAll(/^Template ID:\s*`?(template:[A-Za-z0-9][A-Za-z0-9_.-]{0,79})`?\s*$/gmi)]
    .map((match) => match[1]);
  if (declaredIds.length !== 1 || declaredIds[0] !== expectedTemplateId) {
    throw packError("PACK_TEMPLATE_ID_MISMATCH", "Pack Skill template id does not match its declared file.", {
      item_id: itemId,
      relative_path: templatePath,
      expected_template_id: expectedTemplateId,
    });
  }
}

function templateIdFromPath(templatePath) {
  return `template:${path.posix.basename(templatePath).replace(/\.md$/i, "")}`;
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => String(value) === String(right[index]));
}

async function readSkillModuleDefinition(root, item, filesByPath) {
  const resource = await readContractJsonResource(root, item.module.path, filesByPath, {
    maxBytes: MAX_MODULE_DEFINITION_BYTES,
    missingCode: "PACK_SKILL_MODULE_FILE_MISSING",
    invalidCode: "PACK_SKILL_MODULE_INVALID",
    missingMessage: "Pack Skill module definition is missing or invalid.",
    invalidMessage: "Pack Skill module definition failed contract validation.",
    contractId: "skill-module-definition-v1",
    meta: { item_id: item.id },
  });
  return deepFreeze({
    itemId: item.id,
    path: item.module.path,
    definition: resource.value,
    sha256: resource.sha256,
    sizeBytes: resource.sizeBytes,
  });
}

async function readSkillIOCompanion(root, item, filesByPath, skillModule) {
  const resource = await readContractJsonResource(root, item.skillIO.path, filesByPath, {
    maxBytes: MAX_SKILL_IO_COMPANION_BYTES,
    missingCode: "PACK_SKILL_IO_FILE_MISSING",
    invalidCode: "PACK_SKILL_IO_INVALID",
    missingMessage: "Pack Skill I/O companion is missing or invalid.",
    invalidMessage: "Pack Skill I/O companion failed contract validation.",
    contractId: "skill-io-companion-v1",
    meta: { item_id: item.id },
  });
  try {
    assertSkillIOCompanionMatchesDefinition(resource.value, skillModule?.definition || null);
  } catch {
    throw packError("PACK_SKILL_IO_DEFINITION_MISMATCH", "Pack Skill I/O companion does not match its Skill module definition.", {
      item_id: item.id,
    });
  }
  return deepFreeze({
    itemId: item.id,
    path: item.skillIO.path,
    companion: resource.value,
    sha256: resource.sha256,
    sizeBytes: resource.sizeBytes,
  });
}

async function readContractJsonResource(root, relativePath, filesByPath, options) {
  const file = filesByPath.get(relativePath);
  if (!file || path.extname(relativePath).toLowerCase() !== ".json") {
    throw packError(options.missingCode, options.missingMessage, options.meta);
  }
  if (file.sizeBytes > options.maxBytes) {
    throw packError(options.invalidCode, options.invalidMessage, options.meta);
  }
  let raw;
  let value;
  try {
    raw = await fs.readFile(path.join(root, relativePath));
    if (raw.length !== file.sizeBytes || hashBuffer(raw) !== file.sha256) {
      throw new Error("resource changed after Pack scan");
    }
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw packError(options.invalidCode, options.invalidMessage, options.meta);
  }
  try {
    validateContract(options.contractId, value);
  } catch {
    throw packError(options.invalidCode, options.invalidMessage, options.meta);
  }
  return deepFreeze({
    value,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
  });
}

function assertFeatureCompatibility(range, features) {
  if (features.usesContentApi23) {
    const accepts23 = acceptsEngineVersion(range, "2.3.0");
    const accepts22 = acceptsEngineVersion(range, "2.2.0");
    if (!accepts23 || accepts22) {
      throw packError(
        "PACK_CONTENT_API_FEATURE_RANGE_INVALID",
        "Skill I/O companion features require an Engine compatibility range that includes 2.3 and excludes 2.2."
      );
    }
    return;
  }
  if (features.usesContentApi22) {
    const accepts22 = acceptsEngineVersion(range, "2.2.0");
    const accepts21 = acceptsEngineVersion(range, "2.1.0");
    if (!accepts22 || accepts21) {
      throw packError(
        "PACK_CONTENT_API_FEATURE_RANGE_INVALID",
        "Skill localization features require an Engine compatibility range that includes 2.2 and excludes 2.1."
      );
    }
    return;
  }
  if (!features.usesContentApi21) {
    return;
  }
  const accepts21 = acceptsEngineVersion(range, "2.1.0");
  const accepts20 = acceptsEngineVersion(range, "2.0.0");
  if (!accepts21 || accepts20) {
    throw packError(
      "PACK_CONTENT_API_FEATURE_RANGE_INVALID",
      "Pack features require an Engine compatibility range that includes 2.1 and excludes 2.0."
    );
  }
}

function acceptsEngineVersion(range, engineVersion) {
  try {
    validateEngineCompatibility(range, engineVersion);
    return true;
  } catch (error) {
    if (error?.code === "PACK_ENGINE_INCOMPATIBLE") {
      return false;
    }
    throw error;
  }
}

async function hashFile(filePath) {
  return hashBuffer(await fs.readFile(filePath));
}

function hashBuffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeOwnership(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string" && ENGINE_OWNERSHIPS.has(value)) {
    return value;
  }
  throw packError("PACK_OWNERSHIP_INVALID", "Pack ownership must be assigned by the Engine.");
}

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function packError(code, message, meta = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  error.meta = Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, String(value).slice(0, 240)]));
  return error;
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_LOCALIZATION_BUNDLE_BYTES,
  MAX_LOCALIZATION_OVERLAY_BYTES,
  MAX_PACK_BYTES,
  MAX_PACK_FILES,
  MAX_MODULE_DEFINITION_BYTES,
  MAX_SKILL_IO_COMPANION_BYTES,
  validatePackV2,
};
