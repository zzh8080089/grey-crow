"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { validateContract } = require("../contracts/v2");
const { readJsonFile, writeJsonAtomic } = require("../runtime/storage-utils");
const { loadBuiltInContentPack } = require("./built-in-pack");
const { resolveContentPlan } = require("./generated/pack-resolver.cjs");
const { validatePackV2 } = require("./pack-validator");
const {
  CREATOR_FACADE_DRAFT_VERSION,
  createSkillModuleCreatorDraft,
  normalizeSkillModuleCreatorDraft,
} = require("./skill-module-creator");

const LIBRARY_SCHEMA_VERSION = "grey-crow-content-library-v2";
const PACK_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const ITEM_ID_PATTERN = PACK_ID_PATTERN;
const MAX_EDITOR_MARKDOWN_CHARS = 120_000;
const MAX_EDITOR_TEMPLATE_CHARS = 40_000;
const MAX_PRESET_BYTES = 64 * 1024;
const EDITABLE_ITEM_TYPES = new Set(["host", "world", "skill"]);
const BLANK_CONTENT_KINDS = new Set(["host", "world", "ordinary_skill", "new_game_skill"]);
const READ_SCOPES = new Set(["state", "memory", "transcript", "chapters", "world", "skill", "content_snapshot"]);
const WRITE_SCOPES = new Set(["state", "memory", "chapter", "world_records", "character_records", "item_records", "timeline"]);

function createContentLibrary(options = {}) {
  const libraryRoot = requireAbsolute(options.libraryRoot, "libraryRoot");
  const contentRoot = requireAbsolute(options.contentRoot, "contentRoot");
  const packsRoot = path.join(libraryRoot, "packs");
  const stagingRoot = path.join(libraryRoot, ".staging");
  const registryPath = path.join(libraryRoot, "library.json");
  const extractZip = typeof options.extractZip === "function" ? options.extractZip : null;
  const clock = typeof options.clock === "function" ? options.clock : () => new Date().toISOString();
  const allowThirdPartyImport = options.allowThirdPartyImport === true;
  let editorMutation = Promise.resolve();

  async function initialize() {
    await ensureLibraryRoots();
    await loadRegistry();
    return scan();
  }

  async function scan() {
    await ensureLibraryRoots();
    const registry = await loadRegistry();
    const builtIn = await loadBuiltInContentPack({ contentRoot });
    const entries = [projectPackEntry(builtIn.pack, { ownership: "built_in", status: "valid" })];
    const dirEntries = await fs.readdir(packsRoot, { withFileTypes: true });
    for (const entry of dirEntries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !PACK_ID_PATTERN.test(entry.name)) continue;
      const packRoot = safeChild(packsRoot, entry.name);
      const stat = await fs.lstat(packRoot);
      if (stat.isSymbolicLink()) {
        entries.push(invalidEntry(entry.name, "PACK_SYMLINK_FORBIDDEN", ownershipFromRegistry(registry, entry.name)));
        continue;
      }
      try {
        const ownership = ownershipFromRegistry(registry, entry.name);
        const pack = await validatePackV2(packRoot, {
          trustedRoot: packsRoot,
          ownership,
        });
        entries.push(projectPackEntry(pack, {
          ownership,
          status: "valid",
        }));
      } catch (error) {
        entries.push(invalidEntry(entry.name, stableErrorCode(error), ownershipFromRegistry(registry, entry.name)));
      }
    }
    return Object.freeze({
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      packs: Object.freeze(entries.sort((a, b) => a.id.localeCompare(b.id))),
    });
  }

  async function importFolder(sourceRoot, importOptions = {}) {
    assertThirdPartyImportEnabled();
    await ensureLibraryRoots();
    const source = requireAbsolute(sourceRoot, "sourceRoot");
    const validated = await validatePackV2(source, { trustedRoot: path.dirname(source), ownership: "imported_readonly" });
    const staging = await createStagingDir("import");
    try {
      await copyValidatedFiles(source, staging, validated.files);
      const stagedPack = await validatePackV2(staging, { trustedRoot: stagingRoot, ownership: "imported_readonly" });
      await installStagedPack(staging, stagedPack.manifest.id, Boolean(importOptions.replaceExisting));
      await updateRegistryEntry(stagedPack.manifest.id, {
        ownership: "imported_readonly",
        installedAt: clock(),
      });
      await setTreeWritable(safeChild(packsRoot, stagedPack.manifest.id), false);
      return projectPackEntry(stagedPack, { ownership: "imported_readonly", status: "valid" });
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async function importZip(zipPath, importOptions = {}) {
    assertThirdPartyImportEnabled();
    if (!extractZip) throw libraryError("CONTENT_ZIP_UNAVAILABLE", "ZIP import is not configured.");
    await ensureLibraryRoots();
    const extractionRoot = await createStagingDir("zip");
    try {
      await extractZip(requireAbsolute(zipPath, "zipPath"), extractionRoot);
      const packSource = await locateExtractedPackRoot(extractionRoot);
      return await importFolder(packSource, importOptions);
    } finally {
      await fs.rm(extractionRoot, { recursive: true, force: true });
    }
  }

  async function clonePack(packId, cloneOptions = {}) {
    await ensureLibraryRoots();
    await assertPackActive(packId);
    const source = await resolveInstalledOrBuiltInRoot(packId);
    const validated = await validatePackV2(source.root, {
      trustedRoot: source.trustedRoot,
      ownership: packId === "grey-crow-default" ? "built_in" : "player_owned",
    });
    const newPackId = requirePackId(cloneOptions.newPackId);
    const staging = await createStagingDir("clone");
    try {
      await copyValidatedFiles(source.root, staging, validated.files);
      const manifestPath = path.join(staging, "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const hiddenLifecycleItemIds = new Set((validated.resources?.skillModules || [])
        .filter((resource) => resource.definition?.visibility === "hidden_until_active")
        .map((resource) => resource.itemId));
      const localizationByItemId = new Map((validated.resources?.skillLocalizations || [])
        .map((resource) => [resource.itemId, resource]));
      const hiddenLifecyclePaths = manifest.provides
        .filter((item) => hiddenLifecycleItemIds.has(item.id))
        .flatMap((item) => {
          const localization = localizationByItemId.get(item.id);
          return [
            item.path,
            ...(item.templates || []),
            item.module?.path,
            localization?.path,
            ...(localization?.locales || []).flatMap((locale) => [
              locale.body.path,
              ...locale.templates.map((template) => template.path),
              locale.modulePresentation?.path,
            ]),
          ].filter(Boolean);
        });
      const clonableItems = manifest.provides.filter((item) => !hiddenLifecycleItemIds.has(item.id));
      const itemIdMap = new Map(clonableItems.map((item) => [item.id, clonedItemId(newPackId, item.id)]));
      manifest.id = newPackId;
      manifest.title = normalizeShortText(cloneOptions.title || `${manifest.title} Copy`, 240);
      manifest.author = normalizeShortText(cloneOptions.author || "Player", 240);
      manifest.version = "1.0.0";
      manifest.conflicts = [];
      manifest.provides = clonableItems.map((item) => {
        const next = { ...item, id: itemIdMap.get(item.id) };
        delete next.replaces;
        return next;
      });
      await writeJsonInside(staging, manifestPath, manifest);
      for (const relativePath of hiddenLifecyclePaths) {
        await fs.rm(safeChild(staging, relativePath), { force: true });
      }
      await rewriteLocalizationRefs(staging, [
        ...(validated.resources?.skillLocalizations || []),
        ...(validated.resources?.narrativeLocalizations || []),
      ], itemIdMap);
      await rewritePresetRefs(staging, validated.files, validated.manifest.id, newPackId, itemIdMap);
      const stagedPack = await validatePackV2(staging, { trustedRoot: stagingRoot, ownership: "player_owned" });
      await installStagedPack(staging, newPackId, false);
      await updateRegistryEntry(newPackId, { ownership: "player_owned", installedAt: clock() });
      await setTreeWritable(safeChild(packsRoot, newPackId), true);
      return projectPackEntry(stagedPack, { ownership: "player_owned", status: "valid" });
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async function exportPack(packId, destinationRoot) {
    const source = await resolveInstalledOrBuiltInRoot(packId);
    const validated = await validatePackV2(source.root, {
      trustedRoot: source.trustedRoot,
      ownership: packId === "grey-crow-default" ? "built_in" : "player_owned",
    });
    const destination = safeChild(requireAbsolute(destinationRoot, "destinationRoot"), validated.manifest.id);
    if (await exists(destination)) throw libraryError("CONTENT_EXPORT_EXISTS", "Export destination already exists.", { pack_id: packId });
    await fs.mkdir(destination, { recursive: false });
    try {
      await copyValidatedFiles(source.root, destination, validated.files);
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true });
      throw error;
    }
    return Object.freeze({ ok: true, packId: validated.manifest.id, files: validated.files.length });
  }

  async function deletePack(packId) {
    requirePackId(packId);
    if (packId === "grey-crow-default") throw libraryError("CONTENT_BUILT_IN_READ_ONLY", "Built-in Pack cannot be deleted.");
    const target = safeChild(packsRoot, packId);
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw libraryError("CONTENT_PACK_NOT_FOUND", "Installed Pack was not found.", { pack_id: packId });
    await setTreeWritable(target, true);
    await fs.rm(target, { recursive: true, force: false });
    const registry = await loadRegistry();
    delete registry.packs[packId];
    await saveRegistry(registry);
    return Object.freeze({ ok: true, packId });
  }

  async function readEditableItem(packId, itemId) {
    await ensureLibraryRoots();
    const editable = await loadEditablePack(packId);
    return projectEditableItem(editable.root, editable.pack, requireItemId(itemId));
  }

  function saveEditableItem(packId, itemId, input = {}) {
    const operation = editorMutation.then(() => saveEditableItemNow(packId, itemId, input));
    editorMutation = operation.catch(() => {});
    return operation;
  }

  function createBlankContent(input = {}) {
    const operation = editorMutation.then(() => createBlankContentNow(input));
    editorMutation = operation.catch(() => {});
    return operation;
  }

  function saveNewGamePreset(packId, input = {}) {
    const operation = editorMutation.then(() => saveNewGamePresetNow(packId, input));
    editorMutation = operation.catch(() => {});
    return operation;
  }

  async function saveEditableItemNow(packId, itemId, input) {
    await ensureLibraryRoots();
    const editable = await loadEditablePack(packId);
    const normalizedItemId = requireItemId(itemId);
    const current = await projectEditableItem(editable.root, editable.pack, normalizedItemId);
    if (typeof input.expectedRevision !== "string" || input.expectedRevision !== current.revision) {
      throw libraryError("CONTENT_EDIT_STALE", "Content changed after the editor opened.", { pack_id: packId, item_id: itemId });
    }
    const item = editable.pack.manifest.provides.find((entry) => entry.id === normalizedItemId);
    const moduleEditRequested = Object.prototype.hasOwnProperty.call(input, "moduleDraft");
    const playerGuideEditRequested = Object.prototype.hasOwnProperty.call(input, "playerGuide");
    if ((moduleEditRequested || playerGuideEditRequested)
      && (item.type !== "skill" || item.skillClass !== "ordinary")) {
      throw libraryError("CONTENT_MODULE_CREATOR_FORBIDDEN", "Only an ordinary player-owned Skill can use the module Creator.");
    }
    const requestedLanguage = normalizeLanguage(input.language);
    if (item.localization && requestedLanguage !== item.language) {
      throw libraryError("CONTENT_LOCALIZATION_CREATOR_UNSUPPORTED", "The current Creator cannot change the source language of a localized Skill.", { item_id: item.id });
    }
    if (item.localization && moduleEditRequested) {
      throw libraryError("CONTENT_LOCALIZATION_CREATOR_UNSUPPORTED", "The current Creator cannot change a module definition while localized presentation overlays are attached.", { item_id: item.id });
    }
    const normalizedModule = moduleEditRequested ? normalizeSkillModuleCreatorDraft(input.moduleDraft, {
      identitySeed: `${packId}:${normalizedItemId}`,
    }) : null;
    if (moduleEditRequested && item.skillIO && normalizedModule.draft.schemaVersion !== CREATOR_FACADE_DRAFT_VERSION) {
      throw libraryError("CONTENT_SKILL_IO_CREATOR_VERSION_REQUIRED", "This Skill must be edited with the companion-aware Creator draft.");
    }
    const staging = await createStagingDir("edit");
    try {
      await copyValidatedFiles(editable.root, staging, editable.pack.files);
      const manifestPath = path.join(staging, "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const stagedItem = manifest.provides.find((entry) => entry.id === normalizedItemId);
      if (!stagedItem || stagedItem.type !== item.type) {
        throw libraryError("CONTENT_ITEM_NOT_FOUND", "Editable content item was not found.", { pack_id: packId, item_id: itemId });
      }
      stagedItem.title = normalizeShortText(input.title, 240);
      stagedItem.language = requestedLanguage;
      stagedItem.description = normalizeShortText(input.description, 1200);
      stagedItem.danger = normalizeDanger(input.danger);
      if (stagedItem.type === "skill") {
        stagedItem.triggers = normalizeStringList(input.triggers, 32, 120, "CONTENT_EDIT_TRIGGERS_INVALID");
        stagedItem.readScopes = normalizeScopeList(input.readScopes, READ_SCOPES, "CONTENT_EDIT_READ_SCOPE_INVALID");
        stagedItem.writeScopes = normalizeScopeList(input.writeScopes, WRITE_SCOPES, "CONTENT_EDIT_WRITE_SCOPE_INVALID");
      }
      if (playerGuideEditRequested) {
        const playerGuide = normalizeOptionalPlayerGuide(input.playerGuide);
        if (playerGuide) stagedItem.playerGuide = playerGuide;
        else delete stagedItem.playerGuide;
      }
      if (moduleEditRequested) {
        const existingModulePath = stagedItem.module?.path || null;
        const existingSkillIOPath = stagedItem.skillIO?.path || null;
        const modulePath = `${path.posix.dirname(stagedItem.path)}/module.json`;
        const skillIOPath = `${path.posix.dirname(stagedItem.path)}/skill-io.json`;
        if (normalizedModule.definition) {
          stagedItem.module = { schemaVersion: "grey-crow-skill-module-ref-v1", path: modulePath };
          await writeJsonInside(staging, safeChild(staging, modulePath), normalizedModule.definition);
          if (existingModulePath && existingModulePath !== modulePath) {
            await fs.rm(safeChild(staging, existingModulePath), { force: true });
          }
        } else {
          delete stagedItem.module;
          if (existingModulePath) await fs.rm(safeChild(staging, existingModulePath), { force: true });
        }
        if (normalizedModule.companion) {
          stagedItem.skillIO = { schemaVersion: "grey-crow-skill-io-ref-v1", path: skillIOPath };
          await writeJsonInside(staging, safeChild(staging, skillIOPath), normalizedModule.companion);
          if (existingSkillIOPath && existingSkillIOPath !== skillIOPath) {
            await fs.rm(safeChild(staging, existingSkillIOPath), { force: true });
          }
        } else {
          delete stagedItem.skillIO;
          if (existingSkillIOPath) await fs.rm(safeChild(staging, existingSkillIOPath), { force: true });
        }
      }
      if (manifest.provides.some((entry) => entry.skillIO)) manifest.engineCompatibility = ">=2.3 <3";
      else if (manifest.provides.some((entry) => entry.localization)) manifest.engineCompatibility = ">=2.2 <3";
      else if (manifest.provides.some((entry) => entry.playerGuide || entry.module)) manifest.engineCompatibility = ">=2.1 <3";
      else manifest.engineCompatibility = ">=2 <3";
      const localizedLanguages = (editable.pack.resources?.skillLocalizations || [])
        .flatMap((resource) => [resource.sourceLocale, ...resource.locales.map((locale) => locale.locale)]);
      manifest.languages = [...new Set([
        ...manifest.provides.map((entry) => entry.language),
        ...localizedLanguages,
      ])].sort();
      manifest.version = incrementPatchVersion(manifest.version);
      await writeJsonInside(staging, manifestPath, manifest);
      await writeTextInside(staging, stagedItem.path, normalizeMarkdown(input.markdown, MAX_EDITOR_MARKDOWN_CHARS));
      if (stagedItem.type === "skill") {
        const templateBodies = normalizeTemplateBodies(input.templates, stagedItem.templates, packId, normalizedItemId);
        for (const template of templateBodies) {
          await writeTextInside(staging, template.relativePath, template.markdown);
        }
      }
      await validatePackV2(staging, { trustedRoot: stagingRoot, ownership: "player_owned" });
      await installStagedPack(staging, packId, true, true);
      await setTreeWritable(safeChild(packsRoot, packId), true);
      const updated = await loadEditablePack(packId);
      return projectEditableItem(updated.root, updated.pack, normalizedItemId);
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async function createBlankContentNow(input) {
    await ensureLibraryRoots();
    const content = normalizeBlankContent(input);
    const identity = await allocateBlankContentIdentity(content.kind);
    const staging = await createStagingDir("blank");
    const target = safeChild(packsRoot, identity.packId);
    let installed = false;
    try {
      const item = createBlankManifestItem(content, identity.itemId);
      if (content.playerGuide) item.playerGuide = content.playerGuide;
      if (content.module?.definition) {
        item.module = {
          schemaVersion: "grey-crow-skill-module-ref-v1",
          path: `${path.posix.dirname(item.path)}/module.json`,
        };
      }
      if (content.module?.companion) {
        item.skillIO = {
          schemaVersion: "grey-crow-skill-io-ref-v1",
          path: `${path.posix.dirname(item.path)}/skill-io.json`,
        };
      }
      const manifest = {
        schemaVersion: "grey-crow-extension-pack-v2",
        id: identity.packId,
        title: content.title,
        version: "1.0.0",
        author: content.author,
        engineCompatibility: item.skillIO ? ">=2.3 <3" : item.playerGuide || item.module ? ">=2.1 <3" : ">=2 <3",
        languages: [content.language],
        provides: [item],
        permissions: [],
        conflicts: [],
      };
      await writeJsonInside(staging, path.join(staging, "manifest.json"), manifest);
      await writeNewTextInside(staging, item.path, content.markdown);
      if (item.module) await writeJsonInside(staging, safeChild(staging, item.module.path), content.module.definition);
      if (item.skillIO) await writeJsonInside(staging, safeChild(staging, item.skillIO.path), content.module.companion);
      const stagedPack = await validatePackV2(staging, { trustedRoot: stagingRoot, ownership: "player_owned" });
      await installStagedPack(staging, identity.packId, false);
      installed = true;
      try {
        await updateRegistryEntry(identity.packId, { ownership: "player_owned", installedAt: clock() });
      } catch (error) {
        await fs.rm(target, { recursive: true, force: true });
        installed = false;
        throw error;
      }
      await setTreeWritable(target, true);
      return await projectEditableItem(target, stagedPack, identity.itemId);
    } finally {
      if (!installed) await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async function allocateBlankContentIdentity(kind) {
    const packs = await loadValidPacks();
    const packIds = new Set(packs.map((pack) => pack.manifest.id));
    const itemIds = new Set(packs.flatMap((pack) => pack.manifest.provides.map((item) => item.id)));
    const itemPrefix = kind === "ordinary_skill" ? "skill" : kind.replaceAll("_", "-");
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const token = crypto.randomBytes(12).toString("hex");
      const packId = `player-content-${token}`;
      const itemId = `${itemPrefix}-${token}`;
      if (!packIds.has(packId) && !itemIds.has(itemId) && !await exists(safeChild(packsRoot, packId))) {
        return Object.freeze({ packId, itemId });
      }
    }
    throw libraryError("CONTENT_BLANK_ID_ALLOCATION_FAILED", "Could not allocate blank content identifiers.");
  }

  async function saveNewGamePresetNow(packId, input) {
    await ensureLibraryRoots();
    const editable = await loadEditablePack(packId);
    const selection = normalizePresetSelection(input.selection);
    const plan = await resolveSelection({
      host: selection.host,
      world: selection.world,
      newGameSkill: selection.newGameSkill,
      skills: [
        ...selection.skills,
        ...selection.optionalSkills
          .filter((skill) => skill.defaultEnabled)
          .map(({ packId: selectedPackId, itemId }) => ({ packId: selectedPackId, itemId })),
      ],
    }, []);
    const language = normalizeLanguage(input.language);
    const languages = new Set([
      plan.host.language,
      plan.world.language,
      plan.newGameSkill.language,
      ...plan.skills.map((skill) => skill.language),
    ]);
    if (languages.size !== 1 || !languages.has(language)) {
      throw libraryError("CONTENT_PRESET_LANGUAGE_MISMATCH", "Preset content must use one matching language.");
    }

    const existingItemId = input.itemId === undefined || input.itemId === null || input.itemId === ""
      ? null
      : requireItemId(input.itemId);
    const existingItem = existingItemId
      ? editable.pack.manifest.provides.find((item) => item.id === existingItemId)
      : null;
    if (existingItemId && existingItem?.type !== "new_game_preset") {
      throw libraryError("CONTENT_PRESET_NOT_FOUND", "Editable preset was not found.", {
        pack_id: packId,
        item_id: existingItemId,
      });
    }
    if (existingItem) {
      const current = await readNewGamePreset(editable.root, editable.pack.manifest, existingItem, "player_owned");
      if (typeof input.expectedRevision !== "string" || input.expectedRevision !== current.revision) {
        throw libraryError("CONTENT_PRESET_STALE", "Preset changed after the composer opened.", {
          pack_id: packId,
          item_id: existingItemId,
        });
      }
    } else if (input.expectedRevision !== undefined && input.expectedRevision !== null && input.expectedRevision !== "") {
      throw libraryError("CONTENT_PRESET_REVISION_INVALID", "A new preset cannot include an existing revision.");
    }

    const title = normalizeShortText(input.title, 240);
    const description = normalizeShortText(input.description, 1200);
    const itemId = existingItemId || generatePresetId(editable.pack.manifest);
    const relativePath = existingItem?.path || `presets/${itemId}.json`;
    const staging = await createStagingDir("preset");
    try {
      await copyValidatedFiles(editable.root, staging, editable.pack.files);
      const manifestPath = path.join(staging, "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      let stagedItem = manifest.provides.find((item) => item.id === itemId);
      if (!stagedItem) {
        stagedItem = {
          type: "new_game_preset",
          id: itemId,
          title,
          path: relativePath,
          language,
          description,
          danger: "low",
        };
        manifest.provides.push(stagedItem);
      } else if (stagedItem.type === "new_game_preset") {
        stagedItem.title = title;
        stagedItem.language = language;
        stagedItem.description = description;
        stagedItem.danger = "low";
      } else {
        throw libraryError("CONTENT_PRESET_NOT_FOUND", "Editable preset was not found.", {
          pack_id: packId,
          item_id: itemId,
        });
      }
      if (manifest.provides.some((entry) => entry.localization)) manifest.engineCompatibility = ">=2.2 <3";
      else if (selection.optionalSkills.length > 0) manifest.engineCompatibility = ">=2.1 <3";
      const localizedLanguages = (editable.pack.resources?.skillLocalizations || [])
        .flatMap((resource) => [resource.sourceLocale, ...resource.locales.map((locale) => locale.locale)]);
      manifest.languages = [...new Set([
        ...manifest.provides.map((entry) => entry.language),
        ...localizedLanguages,
      ])].sort();
      manifest.version = incrementPatchVersion(manifest.version);
      await writeJsonInside(staging, manifestPath, manifest);
      await fs.mkdir(path.dirname(safeChild(staging, relativePath)), { recursive: true });
      await writeJsonInside(staging, safeChild(staging, relativePath), {
        schemaVersion: "grey-crow-new-game-preset-v2",
        id: itemId,
        language,
        host: selection.host,
        world: selection.world,
        newGameSkill: selection.newGameSkill,
        skills: selection.skills,
        ...(selection.optionalSkills.length > 0 ? { optionalSkills: selection.optionalSkills } : {}),
      });
      await validatePackV2(staging, { trustedRoot: stagingRoot, ownership: "player_owned" });
      await installStagedPack(staging, packId, true, true);
      await setTreeWritable(safeChild(packsRoot, packId), true);
      const updated = await loadEditablePack(packId);
      const updatedItem = updated.pack.manifest.provides.find((item) => item.id === itemId);
      return readNewGamePreset(updated.root, updated.pack.manifest, updatedItem, "player_owned");
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async function resolveSelection(selection, replacementConfirmations = []) {
    await assertSelectionPacksActive(selection);
    const packs = await loadValidPacks();
    return resolveContentPlan({ packs, selection, replacementConfirmations });
  }

  async function listNewGamePresets() {
    await ensureLibraryRoots();
    const registry = await loadRegistry();
    const packs = await loadValidPacks();
    const presets = [];
    for (const pack of packs) {
      const source = await resolveInstalledOrBuiltInRoot(pack.manifest.id);
      const ownership = pack.manifest.id === "grey-crow-default"
        ? "built_in"
        : registry.packs[pack.manifest.id]?.ownership === "player_owned"
          ? "player_owned"
          : "imported_readonly";
      for (const item of pack.manifest.provides.filter((entry) => entry.type === "new_game_preset")) {
        presets.push(await readNewGamePreset(source.root, pack.manifest, item, ownership));
      }
    }
    return Object.freeze(presets.sort((left, right) => `${left.packId}:${left.itemId}`.localeCompare(`${right.packId}:${right.itemId}`)));
  }

  async function resolvePackRoot(packId) {
    await assertPackActive(packId);
    const source = await resolveInstalledOrBuiltInRoot(packId);
    return source.root;
  }

  async function loadValidPacks() {
    await ensureLibraryRoots();
    const registry = await loadRegistry();
    const builtIn = await loadBuiltInContentPack({ contentRoot });
    const packs = [builtIn.pack];
    const entries = await fs.readdir(packsRoot, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !PACK_ID_PATTERN.test(entry.name)) continue;
      if (ownershipFromRegistry(registry, entry.name) !== "player_owned") continue;
      try {
        packs.push(await validatePackV2(safeChild(packsRoot, entry.name), {
          trustedRoot: packsRoot,
          ownership: "player_owned",
        }));
      } catch {
        // Invalid installed content is isolated from resolution but remains visible in scan().
      }
    }
    return packs;
  }

  function assertThirdPartyImportEnabled() {
    if (!allowThirdPartyImport) {
      throw libraryError("CONTENT_IMPORT_DISABLED", "Third-party content import is disabled for this release.");
    }
  }

  async function assertPackActive(packId) {
    await ensureLibraryRoots();
    const normalizedPackId = requirePackId(packId);
    if (normalizedPackId === "grey-crow-default") return;
    const registry = await loadRegistry();
    const installed = await exists(safeChild(packsRoot, normalizedPackId));
    if (installed && ownershipFromRegistry(registry, normalizedPackId) !== "player_owned") {
      throw libraryError("CONTENT_PACK_QUARANTINED", "Imported content is preserved but cannot be enabled in this release.", {
        pack_id: normalizedPackId,
      });
    }
  }

  async function assertSelectionPacksActive(selection) {
    const refs = [
      selection?.host,
      selection?.world,
      selection?.newGameSkill,
      ...(Array.isArray(selection?.skills) ? selection.skills : []),
      ...(Array.isArray(selection?.optionalSkills) ? selection.optionalSkills : []),
    ];
    const packIds = [...new Set(refs.map((ref) => ref?.packId).filter((packId) => typeof packId === "string" && PACK_ID_PATTERN.test(packId)))];
    for (const packId of packIds) await assertPackActive(packId);
  }

  async function ensureLibraryRoots() {
    await fs.mkdir(packsRoot, { recursive: true });
    await fs.mkdir(stagingRoot, { recursive: true });
    for (const target of [libraryRoot, packsRoot, stagingRoot]) {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw libraryError("CONTENT_LIBRARY_PATH_INVALID", "Content library path is invalid.");
    }
  }

  async function createStagingDir(kind) {
    return fs.mkdtemp(path.join(stagingRoot, `${kind}-`));
  }

  async function installStagedPack(staging, packId, replaceExisting, rollbackWritable = false) {
    requirePackId(packId);
    const target = safeChild(packsRoot, packId);
    const backup = safeChild(stagingRoot, `backup-${packId}-${crypto.randomBytes(6).toString("hex")}`);
    const targetExists = await exists(target);
    if (targetExists && !replaceExisting) throw libraryError("CONTENT_PACK_EXISTS", "Pack is already installed.", { pack_id: packId });
    if (!targetExists) {
      await fs.rename(staging, target);
      return;
    }
    await setTreeWritable(target, true);
    await fs.rename(target, backup);
    try {
      await fs.rename(staging, target);
    } catch (error) {
      if (!(await exists(target)) && await exists(backup)) {
        await fs.rename(backup, target);
        await setTreeWritable(target, rollbackWritable);
      }
      throw error;
    }
    // The replacement is committed after rename. A stale backup is safer than
    // reporting failure after the new validated Pack is already installed.
    await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
  }

  async function loadEditablePack(packId) {
    const normalizedPackId = requirePackId(packId);
    if (normalizedPackId === "grey-crow-default") {
      throw libraryError("CONTENT_BUILT_IN_READ_ONLY", "Built-in Pack cannot be edited.");
    }
    const registry = await loadRegistry();
    if (registry.packs[normalizedPackId]?.ownership !== "player_owned") {
      throw libraryError("CONTENT_PACK_READ_ONLY", "Only player-owned Packs can be edited.", { pack_id: normalizedPackId });
    }
    const root = safeChild(packsRoot, normalizedPackId);
    const pack = await validatePackV2(root, { trustedRoot: packsRoot, ownership: "player_owned" });
    if (pack.manifest.id !== normalizedPackId) {
      throw libraryError("CONTENT_PACK_ID_MISMATCH", "Installed Pack identity is invalid.", { pack_id: normalizedPackId });
    }
    return { root, pack };
  }

  async function resolveInstalledOrBuiltInRoot(packId) {
    requirePackId(packId);
    if (packId === "grey-crow-default") {
      return { root: path.join(contentRoot, "packs", packId), trustedRoot: path.join(contentRoot, "packs") };
    }
    return { root: safeChild(packsRoot, packId), trustedRoot: packsRoot };
  }

  async function loadRegistry() {
    const value = await readJsonFile(registryPath, () => ({ schemaVersion: LIBRARY_SCHEMA_VERSION, packs: {} }), { rootDir: libraryRoot });
    if (!value || value.schemaVersion !== LIBRARY_SCHEMA_VERSION || !value.packs || typeof value.packs !== "object" || Array.isArray(value.packs)) {
      throw libraryError("CONTENT_LIBRARY_REGISTRY_INVALID", "Content library registry is invalid.");
    }
    return { schemaVersion: LIBRARY_SCHEMA_VERSION, packs: { ...value.packs } };
  }

  async function updateRegistryEntry(packId, metadata) {
    const registry = await loadRegistry();
    registry.packs[packId] = { ownership: metadata.ownership, installedAt: metadata.installedAt };
    await saveRegistry(registry);
  }

  async function saveRegistry(registry) {
    await writeJsonAtomic(registryPath, registry, { rootDir: libraryRoot });
  }

  return Object.freeze({
    initialize,
    scan,
    importFolder,
    importZip,
    clonePack,
    exportPack,
    deletePack,
    readEditableItem,
    createBlankContent,
    saveEditableItem,
    saveNewGamePreset,
    listNewGamePresets,
    resolveSelection,
    resolvePackRoot,
  });
}

async function readNewGamePreset(packRoot, manifest, item, ownership) {
  const target = safeChild(packRoot, item.path);
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > MAX_PRESET_BYTES) {
    throw libraryError("CONTENT_PRESET_INVALID", "New Game preset file is missing, unsafe, or too large.", {
      pack_id: manifest.id,
      item_id: item.id,
    });
  }
  let value;
  let raw;
  try {
    raw = await fs.readFile(target, "utf8");
    value = JSON.parse(raw);
  } catch {
    throw libraryError("CONTENT_PRESET_INVALID", "New Game preset JSON is invalid.", {
      pack_id: manifest.id,
      item_id: item.id,
    });
  }
  try {
    validateContract("new-game-preset-v2", value);
  } catch {
    throw libraryError("CONTENT_PRESET_INVALID", "New Game preset failed contract validation.", {
      pack_id: manifest.id,
      item_id: item.id,
    });
  }
  if (value.schemaVersion !== "grey-crow-new-game-preset-v2" || value.id !== item.id || value.language !== item.language) {
    throw libraryError("CONTENT_PRESET_INVALID", "New Game preset identity or language does not match its manifest entry.", {
      pack_id: manifest.id,
      item_id: item.id,
    });
  }
  const skills = Array.isArray(value.skills) ? value.skills.map((ref) => normalizePresetRef(ref)) : null;
  const optionalSkills = (value.optionalSkills || []).map(normalizePresetOptionalRef);
  return deepFreeze({
    packId: manifest.id,
    packTitle: manifest.title,
    packVersion: manifest.version,
    ownership,
    itemId: item.id,
    title: item.title,
    language: item.language,
    availableLocales: Object.freeze([...(value.locales || [value.language])]),
    localizedMetadata: Object.freeze((value.localizedMetadata || []).map((entry) => Object.freeze({ ...entry }))),
    description: item.description,
    danger: item.danger,
    revision: sha256(JSON.stringify({
      packVersion: manifest.version,
      item,
      body: raw,
    })),
    selection: {
      host: normalizePresetRef(value.host),
      world: normalizePresetRef(value.world),
      newGameSkill: normalizePresetRef(value.newGameSkill),
      skills,
      optionalSkills,
    },
  });
}

function normalizePresetSelection(value) {
  const allowed = new Set(["host", "world", "newGameSkill", "skills", "optionalSkills"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))
    || !Array.isArray(value.skills)
    || (value.optionalSkills !== undefined && !Array.isArray(value.optionalSkills))) {
    throw libraryError("CONTENT_PRESET_SELECTION_INVALID", "Preset selection is invalid.");
  }
  const skills = value.skills.map(normalizePresetRef);
  const optionalSkills = (value.optionalSkills || []).map(normalizePresetOptionalRef);
  const skillKeys = skills.map((ref) => `${ref.packId}:${ref.itemId}`);
  const optionalKeys = optionalSkills.map((ref) => `${ref.packId}:${ref.itemId}`);
  const defaultEnabledCount = optionalSkills.filter((skill) => skill.defaultEnabled).length;
  if (skills.length > 32 || optionalSkills.length > 32
    || skills.length + defaultEnabledCount > 32
    || new Set(skillKeys).size !== skills.length
    || new Set(optionalKeys).size !== optionalSkills.length
    || optionalKeys.some((key) => skillKeys.includes(key))) {
    throw libraryError("CONTENT_PRESET_SELECTION_INVALID", "Preset Skill selection is invalid.");
  }
  return deepFreeze({
    host: normalizePresetRef(value.host),
    world: normalizePresetRef(value.world),
    newGameSkill: normalizePresetRef(value.newGameSkill),
    skills,
    optionalSkills,
  });
}

function normalizePresetRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => key !== "packId" && key !== "itemId")
    || !PACK_ID_PATTERN.test(String(value.packId || ""))
    || !ITEM_ID_PATTERN.test(String(value.itemId || ""))) {
    throw libraryError("CONTENT_PRESET_INVALID", "New Game preset contains an invalid content reference.");
  }
  return Object.freeze({ packId: value.packId, itemId: value.itemId });
}

function normalizePresetOptionalRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => key !== "packId" && key !== "itemId" && key !== "defaultEnabled")
    || typeof value.defaultEnabled !== "boolean") {
    throw libraryError("CONTENT_PRESET_INVALID", "New Game preset contains an invalid optional Skill reference.");
  }
  const ref = normalizePresetRef({ packId: value.packId, itemId: value.itemId });
  return Object.freeze({ ...ref, defaultEnabled: value.defaultEnabled });
}

async function copyValidatedFiles(sourceRoot, destinationRoot, files) {
  for (const file of files) {
    const source = safeChild(sourceRoot, file.relativePath);
    const destination = safeChild(destinationRoot, file.relativePath);
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw libraryError("CONTENT_SOURCE_CHANGED", "Pack source changed during import.", { relative_path: file.relativePath });
    const content = await fs.readFile(source);
    if (content.length !== file.sizeBytes || sha256(content) !== file.sha256) throw libraryError("CONTENT_SOURCE_CHANGED", "Pack source changed during import.", { relative_path: file.relativePath });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, { flag: "wx" });
  }
}

async function locateExtractedPackRoot(extractionRoot) {
  if (await exists(path.join(extractionRoot, "manifest.json"))) return extractionRoot;
  const entries = (await fs.readdir(extractionRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (entries.length === 1 && await exists(path.join(extractionRoot, entries[0].name, "manifest.json"))) {
    return path.join(extractionRoot, entries[0].name);
  }
  throw libraryError("CONTENT_ZIP_LAYOUT_INVALID", "ZIP must contain one Pack root.");
}

async function rewritePresetRefs(root, files, oldPackId, newPackId, itemIdMap) {
  for (const file of files.filter((item) => item.relativePath.endsWith(".json") && item.relativePath !== "manifest.json")) {
    const target = safeChild(root, file.relativePath);
    let value;
    try { value = JSON.parse(await fs.readFile(target, "utf8")); } catch { continue; }
    if (value?.schemaVersion !== "grey-crow-new-game-preset-v2") continue;
    if (value.id && itemIdMap.has(value.id)) value.id = itemIdMap.get(value.id);
    if (Array.isArray(value.skills)) {
      value.skills = value.skills.filter((ref) => ref?.packId !== oldPackId || itemIdMap.has(ref.itemId));
    }
    if (Array.isArray(value.optionalSkills)) {
      value.optionalSkills = value.optionalSkills.filter((ref) => ref?.packId !== oldPackId || itemIdMap.has(ref.itemId));
    }
    for (const ref of [
      value.host,
      value.world,
      value.newGameSkill,
      ...(Array.isArray(value.skills) ? value.skills : []),
      ...(Array.isArray(value.optionalSkills) ? value.optionalSkills : []),
    ]) {
      if (ref?.packId === oldPackId) ref.packId = newPackId;
      if (ref?.itemId && itemIdMap.has(ref.itemId)) ref.itemId = itemIdMap.get(ref.itemId);
    }
    await writeJsonInside(root, target, value);
  }
}

async function rewriteLocalizationRefs(root, resources, itemIdMap) {
  for (const resource of Array.isArray(resources) ? resources : []) {
    const clonedItemId = itemIdMap.get(resource.itemId);
    if (!clonedItemId) continue;
    const bundlePath = safeChild(root, resource.path);
    const bundle = JSON.parse(await fs.readFile(bundlePath, "utf8"));
    bundle.itemId = clonedItemId;
    await writeJsonInside(root, bundlePath, bundle);
    for (const locale of resource.locales) {
      if (!locale.modulePresentation) continue;
      const overlayPath = safeChild(root, locale.modulePresentation.path);
      const overlay = JSON.parse(await fs.readFile(overlayPath, "utf8"));
      overlay.itemId = clonedItemId;
      await writeJsonInside(root, overlayPath, overlay);
    }
  }
}

async function writeJsonInside(root, target, value) {
  safeChild(root, path.relative(root, target));
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeTextInside(root, relativePath, value) {
  const target = safeChild(root, relativePath);
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw libraryError("CONTENT_EDIT_FILE_INVALID", "Editable content file is missing or invalid.", { relative_path: relativePath });
  }
  await fs.writeFile(target, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

async function writeNewTextInside(root, relativePath, value) {
  const target = safeChild(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, value.endsWith("\n") ? value : `${value}\n`, { encoding: "utf8", flag: "wx" });
}

async function setTreeWritable(root, writable) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) await setTreeWritable(target, writable);
    else if (entry.isFile()) await fs.chmod(target, writable ? 0o600 : 0o400).catch(() => {});
  }
  await fs.chmod(root, writable ? 0o700 : 0o500).catch(() => {});
}

function projectPackEntry(pack, metadata) {
  const activation = activationForOwnership(metadata.ownership);
  const moduleByItemId = new Map((pack.resources?.skillModules || [])
    .map((resource) => [resource.itemId, resource]));
  const skillIOByItemId = new Map((pack.resources?.skillIOCompanions || [])
    .map((resource) => [resource.itemId, resource]));
  const localizationByItemId = new Map([
    ...(pack.resources?.skillLocalizations || []),
    ...(pack.resources?.narrativeLocalizations || []),
  ].map((resource) => [resource.itemId, resource]));
  return Object.freeze({
    id: pack.manifest.id,
    title: pack.manifest.title,
    version: pack.manifest.version,
    languages: Object.freeze([...pack.manifest.languages]),
    ownership: metadata.ownership,
    activation,
    status: metadata.status,
    editable: metadata.ownership === "player_owned" && activation === "active",
    itemCount: pack.manifest.provides.length,
    items: Object.freeze(pack.manifest.provides
      .filter((item) => item.type === "host" || item.type === "world" || item.type === "skill")
      .map((item) => projectSelectionItem(
        item,
        moduleByItemId.get(item.id),
        localizationByItemId.get(item.id),
        skillIOByItemId.get(item.id)
      ))),
  });
}

function projectSelectionItem(item, moduleResource = null, localizationResource = null, skillIOResource = null) {
  return Object.freeze({
    id: item.id,
    type: item.type,
    title: item.title,
    language: item.language,
    description: item.description,
    danger: item.danger,
    skillClass: item.type === "skill" ? item.skillClass : null,
    triggers: Object.freeze([...(item.triggers || [])]),
    readScopes: Object.freeze([...(item.readScopes || [])]),
    writeScopes: Object.freeze([...(item.writeScopes || [])]),
    playerGuide: typeof item.playerGuide === "string" ? item.playerGuide : null,
    availableLocales: Object.freeze([item.language, ...(localizationResource?.locales || []).map((entry) => entry.locale)]),
    localizedMetadata: Object.freeze((localizationResource?.locales || []).map((entry) => Object.freeze({
      locale: entry.locale,
      title: entry.title,
      description: entry.description,
    }))),
    hasModule: Boolean(item.module),
    hasSkillIO: Boolean(skillIOResource),
    moduleVisibility: moduleResource?.definition?.visibility || null,
    replaces: item.replaces || null,
  });
}

async function projectEditableItem(root, pack, itemId) {
  const item = pack.manifest.provides.find((entry) => entry.id === itemId);
  if (!item || !EDITABLE_ITEM_TYPES.has(item.type)) {
    throw libraryError("CONTENT_ITEM_NOT_FOUND", "Editable content item was not found.", { pack_id: pack.manifest.id, item_id: itemId });
  }
  const filesByPath = new Map(pack.files.map((file) => [file.relativePath, file]));
  const templatePaths = item.type === "skill" ? item.templates || [] : [];
  const moduleResource = item.type === "skill"
    ? (pack.resources?.skillModules || []).find((resource) => resource.itemId === item.id) || null
    : null;
  const skillIOResource = item.type === "skill"
    ? (pack.resources?.skillIOCompanions || []).find((resource) => resource.itemId === item.id) || null
    : null;
  const revision = sha256(JSON.stringify({
    manifest: filesByPath.get("manifest.json")?.sha256 || "",
    item: filesByPath.get(item.path)?.sha256 || "",
    templates: templatePaths.map((relativePath) => filesByPath.get(relativePath)?.sha256 || ""),
    module: moduleResource?.sha256 || "",
    skillIO: skillIOResource?.sha256 || "",
  }));
  return Object.freeze({
    schemaVersion: "grey-crow-content-editor-item-v2",
    packId: pack.manifest.id,
    packVersion: pack.manifest.version,
    itemId: item.id,
    type: item.type,
    title: item.title,
    language: item.language,
    description: item.description,
    danger: item.danger,
    skillClass: item.type === "skill" ? item.skillClass : null,
    triggers: Object.freeze([...(item.triggers || [])]),
    readScopes: Object.freeze([...(item.readScopes || [])]),
    writeScopes: Object.freeze([...(item.writeScopes || [])]),
    replaces: item.replaces ? Object.freeze({
      packId: item.replaces.packId,
      itemId: item.replaces.itemId,
    }) : null,
    markdown: await fs.readFile(safeChild(root, item.path), "utf8"),
    templates: Object.freeze(await Promise.all(templatePaths.map(async (relativePath) => Object.freeze({
      templateId: editorTemplateId(pack.manifest.id, item.id, relativePath),
      title: path.basename(relativePath, path.extname(relativePath)),
      markdown: await fs.readFile(safeChild(root, relativePath), "utf8"),
    })))),
    ...(item.type === "skill" && item.skillClass === "ordinary" ? {
      playerGuide: typeof item.playerGuide === "string" ? item.playerGuide : "",
      module: Object.freeze({
          enabled: Boolean(moduleResource),
          definitionSchemaVersion: moduleResource?.definition?.schemaVersion || null,
          creatorSupport: skillIOResource ? "editable_v2" : moduleResource ? "editable_v1" : "available_v2",
          draft: moduleResource || skillIOResource
            ? createSkillModuleCreatorDraft(
              moduleResource?.definition || null,
              {},
              skillIOResource?.companion || null
            )
            : {
              schemaVersion: CREATOR_FACADE_DRAFT_VERSION,
              enabled: false,
              skillIOEnabled: true,
              namespace: null,
              fields: [],
            },
        }),
    } : {}),
    revision,
  });
}

function normalizeTemplateBodies(value, templatePaths, packId, itemId) {
  if (!Array.isArray(value) || value.length !== templatePaths.length) {
    throw libraryError("CONTENT_EDIT_TEMPLATES_INVALID", "Skill templates are incomplete.");
  }
  const submitted = new Map();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || typeof entry.templateId !== "string" || submitted.has(entry.templateId)) {
      throw libraryError("CONTENT_EDIT_TEMPLATES_INVALID", "Skill templates are invalid.");
    }
    submitted.set(entry.templateId, normalizeMarkdown(entry.markdown, MAX_EDITOR_TEMPLATE_CHARS));
  }
  return templatePaths.map((relativePath) => {
    const templateId = editorTemplateId(packId, itemId, relativePath);
    if (!submitted.has(templateId)) throw libraryError("CONTENT_EDIT_TEMPLATES_INVALID", "Skill templates are incomplete.");
    return { relativePath, markdown: submitted.get(templateId) };
  });
}

function normalizeStringList(value, maximumItems, maximumLength, code) {
  if (!Array.isArray(value) || value.length > maximumItems) throw libraryError(code, "Content list is invalid.");
  const normalized = value.map((entry) => {
    const text = String(entry || "").trim();
    if (!text || text.length > maximumLength || /[\u0000-\u001F\u007F]/.test(text)) throw libraryError(code, "Content list is invalid.");
    return text;
  });
  if (new Set(normalized).size !== normalized.length) throw libraryError(code, "Content list contains duplicate values.");
  return normalized;
}

function normalizeScopeList(value, allowlist, code) {
  const normalized = normalizeStringList(value, 8, 64, code);
  if (normalized.some((entry) => !allowlist.has(entry))) throw libraryError(code, "Content scope is not allowed.");
  return normalized;
}

function normalizeMarkdown(value, maximumLength) {
  if (typeof value !== "string") throw libraryError("CONTENT_EDIT_MARKDOWN_INVALID", "Markdown content is invalid.");
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized || normalized.length > maximumLength || /[\u0000\u000B\u000C\u007F]/.test(normalized)) {
    throw libraryError("CONTENT_EDIT_MARKDOWN_INVALID", "Markdown content is invalid.");
  }
  return normalized;
}

function normalizeLanguage(value) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized) || normalized.length > 35) {
    throw libraryError("CONTENT_EDIT_LANGUAGE_INVALID", "Content language is invalid.");
  }
  return normalized;
}

function normalizeDanger(value) {
  if (!["low", "medium", "high", "critical"].includes(value)) {
    throw libraryError("CONTENT_EDIT_DANGER_INVALID", "Content danger level is invalid.");
  }
  return value;
}

function incrementPatchVersion(value) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(String(value || ""));
  if (!match) throw libraryError("CONTENT_EDIT_VERSION_INVALID", "Player Pack version cannot be incremented.");
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function editorTemplateId(packId, itemId, relativePath) {
  return `template_${sha256(`${packId}\n${itemId}\n${relativePath}`).slice(0, 24)}`;
}

function invalidEntry(id, errorCode, ownership = "imported_readonly") {
  return Object.freeze({
    id,
    title: id,
    version: "unknown",
    languages: Object.freeze([]),
    ownership,
    activation: activationForOwnership(ownership),
    status: "invalid",
    editable: false,
    itemCount: 0,
    errorCode,
  });
}

function ownershipFromRegistry(registry, packId) {
  return registry?.packs?.[packId]?.ownership === "player_owned" ? "player_owned" : "imported_readonly";
}

function activationForOwnership(ownership) {
  return ownership === "imported_readonly" ? "quarantined" : "active";
}

function clonedItemId(packId, itemId) {
  const proposed = `${packId}-${itemId}`;
  if (proposed.length <= 64) return proposed;
  return `${packId.slice(0, 48).replace(/-+$/g, "")}-${sha256(proposed).slice(0, 12)}`;
}

function generatePresetId(manifest) {
  const existing = new Set((manifest.provides || []).map((item) => item.id));
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = `preset-${crypto.randomBytes(8).toString("hex")}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw libraryError("CONTENT_PRESET_ID_ALLOCATION_FAILED", "Could not allocate a preset id.");
}

function normalizeBlankContent(input = {}) {
  const kind = String(input.kind || "").trim();
  if (!BLANK_CONTENT_KINDS.has(kind)) {
    throw libraryError("CONTENT_BLANK_KIND_INVALID", "Blank content type is invalid.");
  }
  const title = normalizeShortText(input.title, 240);
  const language = normalizeLanguage(input.language);
  const description = normalizeShortText(input.description, 1200);
  const markdown = normalizeMarkdown(input.markdown, MAX_EDITOR_MARKDOWN_CHARS);
  const author = normalizeShortText(input.author || "Player", 240);
  const triggers = kind === "ordinary_skill"
    ? normalizeStringList(input.triggers || [], 32, 120, "CONTENT_EDIT_TRIGGERS_INVALID")
    : kind === "new_game_skill" ? ["ui_start_new_game"] : [];
  const playerGuide = kind === "ordinary_skill" ? normalizeOptionalPlayerGuide(input.playerGuide) : "";
  const module = kind === "ordinary_skill" && Object.prototype.hasOwnProperty.call(input, "moduleDraft")
    ? normalizeSkillModuleCreatorDraft(input.moduleDraft)
    : null;
  if (kind !== "ordinary_skill" && (input.playerGuide || input.moduleDraft?.enabled)) {
    throw libraryError("CONTENT_MODULE_CREATOR_FORBIDDEN", "Only an ordinary Skill can enable a module.");
  }
  return deepFreeze({ kind, title, language, description, markdown, author, triggers, playerGuide, module });
}

function normalizeOptionalPlayerGuide(value) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (normalized.length > 2000 || /[\u0000\u000B\u000C\u007F]/.test(normalized)) {
    throw libraryError("CONTENT_PLAYER_GUIDE_INVALID", "Skill player guide is invalid.");
  }
  return normalized;
}

function createBlankManifestItem(content, itemId) {
  const common = {
    type: content.kind === "host" || content.kind === "world" ? content.kind : "skill",
    id: itemId,
    title: content.title,
    path: blankContentPath(content.kind, itemId),
    language: content.language,
    description: content.description,
    danger: "low",
  };
  if (common.type !== "skill") return common;
  return {
    ...common,
    skillClass: content.kind === "new_game_skill" ? "new_game" : "ordinary",
    triggers: content.triggers,
    templates: [],
    readScopes: [],
    writeScopes: [],
  };
}

function blankContentPath(kind, itemId) {
  if (kind === "host") return "host/HOST.md";
  if (kind === "world") return "world/WORLD.md";
  return `skills/${itemId}/SKILL.md`;
}

function requirePackId(value) {
  if (typeof value !== "string" || !PACK_ID_PATTERN.test(value)) throw libraryError("CONTENT_PACK_ID_INVALID", "Pack id is invalid.");
  return value;
}

function requireItemId(value) {
  if (typeof value !== "string" || !ITEM_ID_PATTERN.test(value)) throw libraryError("CONTENT_ITEM_ID_INVALID", "Content item id is invalid.");
  return value;
}

function normalizeShortText(value, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) throw libraryError("CONTENT_METADATA_INVALID", "Pack metadata is invalid.");
  return normalized;
}

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw libraryError("CONTENT_PATH_INVALID", `${label} must be absolute.`);
  return path.resolve(value);
}

function safeChild(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw libraryError("CONTENT_PATH_OUTSIDE_ROOT", "Content path escaped its trusted root.");
  return target;
}

async function exists(target) {
  return Boolean(await fs.lstat(target).catch(() => null));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "CONTENT_PACK_INVALID";
}

function libraryError(code, message, meta = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  error.meta = Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, String(value).slice(0, 160)]));
  return error;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

module.exports = { LIBRARY_SCHEMA_VERSION, createContentLibrary };
