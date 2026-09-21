"use strict";

// Preserve the approved content selection/review flow while requiring the
// session store explicitly. This entry never loads the retired game engine.

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  compileContentSnapshot,
  createContentLibrary,
  createPlayerProfileStore,
  loadBuiltInContentPack,
  prepareSkillModuleSnapshot,
} = require("../content-v2");
const {
  LEGACY_ADVENTURE_LOCALE: DEFAULT_ADVENTURE_LOCALE,
  canonicalizeGameLocale,
} = require("../localization");

const NEW_GAME_CATALOG_SCHEMA = "grey-crow-new-game-catalog-v2";
const NEW_GAME_REVIEW_SCHEMA = "grey-crow-new-game-review-v2";
const MAX_SELECTED_SKILLS = 32;
const PREPARED_CONTENT_PLAN = Symbol("preparedContentPlan");
const PREPARED_SKILL_MODULES = Symbol("preparedSkillModules");
const PREPARED_REQUIRED_SKILLS = Symbol("preparedRequiredSkills");

function createNewGameLifecycle(options = {}) {
  if (typeof options.adventureStore?.initializeFromContentSnapshot !== "function") {
    throw lifecycleError("NEW_GAME_STORE_REQUIRED", "New Game requires the session store adapter.");
  }
  const adventuresRoot = requireAbsolute(options.adventuresRoot, "adventuresRoot");
  const contentRoot = requireAbsolute(options.contentRoot, "contentRoot");
  const contentLibrary = options.contentLibrary || createContentLibrary({
    libraryRoot: requireAbsolute(options.libraryRoot, "libraryRoot"),
    contentRoot,
    extractZip: options.extractZip,
    clock: options.clock,
  });
  const playerProfileStore = options.playerProfileStore || createPlayerProfileStore({
    profileRoot: requireAbsolute(options.profileRoot, "profileRoot"),
    clock: options.clock,
    idFactory: options.playerProfileIdFactory,
  });
  const adventureStore = options.adventureStore;
  const snapshotCompiler = typeof options.snapshotCompiler === "function" ? options.snapshotCompiler : compileContentSnapshot;
  const idFactory = typeof options.adventureIdFactory === "function"
    ? options.adventureIdFactory
    : () => `save_${crypto.randomBytes(8).toString("hex")}`;

  async function loadCatalogState() {
    const library = await contentLibrary.initialize();
    const builtIn = await loadBuiltInContentPack({ contentRoot });
    const presets = await contentLibrary.listNewGamePresets();
    const activePacks = library.packs.filter((pack) => pack.status === "valid" && pack.activation === "active");
    const items = activePacks.flatMap((pack) => (pack.items || []).map((item) => projectCatalogItem(pack, item)));
    const hiddenLifecycleSkillRefs = new Set(items
      .filter((item) => item.hiddenLifecycle === true)
      .map(refKey));
    return { library, builtIn, presets, activePacks, items, hiddenLifecycleSkillRefs };
  }

  function projectCatalog(state) {
    const { library, builtIn, presets, activePacks, items, hiddenLifecycleSkillRefs } = state;
    const visibleItems = items.filter((item) => item.hiddenLifecycle !== true);
    return deepFreeze({
      schemaVersion: NEW_GAME_CATALOG_SCHEMA,
      hosts: visibleItems.filter((item) => item.type === "host"),
      worlds: visibleItems.filter((item) => item.type === "world"),
      newGameSkills: visibleItems.filter((item) => item.type === "skill" && item.skillClass === "new_game"),
      skills: visibleItems.filter((item) => item.type === "skill" && item.skillClass === "ordinary"),
      presets: presets.map((preset) => projectCatalogPreset(preset, hiddenLifecycleSkillRefs)),
      defaultPreset: Object.freeze({ packId: builtIn.pack.manifest.id, itemId: builtIn.defaultPreset.id }),
      defaultSelection: projectPublicSelection(
        normalizeSelection(selectionWithOptionalDefaults(builtIn.defaultPreset)),
        hiddenLifecycleSkillRefs
      ),
      engineCapabilities: builtIn.defaultPlan.engineCapabilities.map(projectEngineCapability),
      packCount: activePacks.length,
      quarantinedPackCount: library.packs.filter((pack) => pack.activation === "quarantined").length,
      invalidPackCount: library.packs.filter((pack) => pack.status !== "valid").length,
    });
  }

  async function catalog() {
    return projectCatalog(await loadCatalogState());
  }

  async function prepare(selectionValue = {}) {
    const adventureLocale = canonicalizeGameLocale(
      selectionValue.adventureLocale || DEFAULT_ADVENTURE_LOCALE
    );
    const catalogState = await loadCatalogState();
    const currentCatalog = projectCatalog(catalogState);
    const requested = resolvePresetRequest(selectionValue, currentCatalog, catalogState.presets);
    const selection = requested.selection;
    assertSelectionVisible(
      selection,
      currentCatalog,
      requested.preset.ownership === "built_in" ? catalogState.hiddenLifecycleSkillRefs : new Set()
    );
    assertOptionalSkillsVisible(requested.optionalSkillChoices, currentCatalog);
    const replacementConfirmations = collectReplacementConfirmations(selection, currentCatalog);
    let plan;
    try {
      plan = await contentLibrary.resolveSelection(selection, replacementConfirmations);
    } catch (error) {
      throw lifecycleError(stableCode(error, "NEW_GAME_CONTENT_INVALID"), "Selected content could not be resolved.");
    }
    const languages = [...new Set([plan.host.language, plan.world.language, plan.newGameSkill.language, ...plan.skills.map((skill) => skill.language)])].sort();
    if (languages.length !== 1) {
      throw lifecycleError("NEW_GAME_LANGUAGE_MISMATCH", "Host, World, and Skills must use one language for this Adventure.");
    }
    const localeCoverage = buildNewGameLocaleCoverage({
      requestedLocale: adventureLocale,
      preset: requested.preset,
      plan,
      hiddenSkillRefs: catalogState.hiddenLifecycleSkillRefs,
    });
    if (localeCoverage.status !== "ready") {
      throw lifecycleError(
        "NEW_GAME_LOCALE_COVERAGE_BLOCKED",
        "The selected story bundle does not completely cover the requested Adventure locale.",
        { coverage: localeCoverage }
      );
    }
    let skillModulePrepare;
    try {
      skillModulePrepare = prepareSkillModuleSnapshot(plan, {
        requiredSkillRefs: requested.preset.selection.skills,
      });
    } catch (error) {
      throw lifecycleError(stableCode(error, "NEW_GAME_SKILL_MODULE_INVALID"), "Selected Skill modules could not be prepared.");
    }
    const visibleSkillKeys = new Set(plan.skills
      .map((skill) => refKey({ packId: skill.packId, itemId: skill.id }))
      .filter((key) => !catalogState.hiddenLifecycleSkillRefs.has(key)));
    const visibleSkillPanels = skillModulePrepare.presentation.panels
      .filter((panel) => panel.visibility !== "hidden_until_active");
    const visibleSkillModuleCount = skillModulePrepare.modules
      .filter((module) => module.definition.visibility !== "hidden_until_active").length;
    const review = deepFreeze({
      schemaVersion: NEW_GAME_REVIEW_SCHEMA,
      preset: projectPreset(requested.preset, adventureLocale),
      selection: projectPublicSelection(selection, catalogState.hiddenLifecycleSkillRefs),
      optionalSkillChoices: requested.optionalSkillChoices,
      host: projectResolvedItem(plan.host, adventureLocale),
      world: projectResolvedItem(plan.world, adventureLocale),
      newGameSkill: projectResolvedItem(plan.newGameSkill, adventureLocale),
      skills: plan.skills
        .filter((skill) => visibleSkillKeys.has(refKey({ packId: skill.packId, itemId: skill.id })))
        .map((skill) => projectResolvedItem(skill, adventureLocale)),
      skillPanels: visibleSkillPanels,
      skillModuleCount: visibleSkillModuleCount,
      moduleCapabilityReview: skillModulePrepare.capabilityReview,
      activePacks: plan.activePacks.map((pack) => ({ id: pack.id, title: pack.title, version: pack.version })),
      engineCapabilities: plan.engineCapabilities.map(projectEngineCapability),
      replacements: plan.replacements.map((replacement) => ({
        replacementItemId: replacement.replacementItemId,
        replacedItemId: replacement.replacedItemId,
        requiresFinalConfirmation: true,
      })),
      language: adventureLocale,
      sourceLanguage: languages[0],
      adventureLocale,
      localeCoverage,
      languageStatus: "matched",
      dependencyStatus: "resolved",
      integrityStatus: "ready_to_lock",
    });
    return deepFreeze({
      review,
      createRequest: {
        preset: { packId: requested.preset.packId, itemId: requested.preset.itemId },
        selection,
        optionalSkillChoices: requested.optionalSkillChoices,
        replacementConfirmations,
        adventureLocale,
        skillModuleCount: skillModulePrepare.modules.length,
        moduleReviewHash: skillModulePrepare.moduleReviewHash,
        contentFingerprint: fingerprintPreparedContent(
          review,
          requested.preset.revision,
          requested.optionalSkillChoices,
          skillModulePrepare.contentHash
        ),
      },
      [PREPARED_CONTENT_PLAN]: plan,
      [PREPARED_SKILL_MODULES]: skillModulePrepare,
      [PREPARED_REQUIRED_SKILLS]: requested.preset.selection.skills,
    });
  }

  async function create(createRequest = {}) {
    const prepared = await prepare({
      preset: createRequest.preset,
      optionalSkillChoices: createRequest.optionalSkillChoices,
      adventureLocale: createRequest.adventureLocale,
    });
    if (createRequest.contentFingerprint !== prepared.createRequest.contentFingerprint) {
      throw lifecycleError("NEW_GAME_CONFIRMATION_STALE", "New Game content changed after confirmation was requested.");
    }
    if ((createRequest.moduleReviewHash || null) !== (prepared.createRequest.moduleReviewHash || null)) {
      throw lifecycleError("NEW_GAME_CONFIRMATION_STALE", "New Game module review changed after confirmation was requested.");
    }
    if (createRequest.skillModuleCount !== prepared.createRequest.skillModuleCount) {
      throw lifecycleError("NEW_GAME_CONFIRMATION_STALE", "New Game module selection changed after confirmation was requested.");
    }
    assertConfirmationMatches(createRequest.replacementConfirmations, prepared.createRequest.replacementConfirmations);
    const profile = await playerProfileStore.load();
    let lastCollision = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const adventureId = requireStableRef(idFactory(), "adventureId");
      try {
        const snapshot = await snapshotCompiler({
          adventuresRoot,
          adventureId,
          plan: prepared[PREPARED_CONTENT_PLAN],
          language: prepared.review.language,
          requiredSkillRefs: prepared[PREPARED_REQUIRED_SKILLS],
          expectedSkillModuleContentHash: prepared[PREPARED_SKILL_MODULES].contentHash,
          expectedModuleReviewHash: prepared[PREPARED_SKILL_MODULES].moduleReviewHash,
          builtInDomainSkillIds: ["characters"],
          resolvePackRoot: contentLibrary.resolvePackRoot,
          clock: options.clock,
        });
        let inspection;
        try {
          inspection = await adventureStore.initializeFromContentSnapshot({
            adventureId,
            playerProfileId: profile.profile.playerProfileId,
            adventureLocale: prepared.review.adventureLocale,
          });
        } catch (error) {
          await removePartialAdventure(adventuresRoot, adventureId);
          throw error;
        }
        return deepFreeze({
          ok: true,
          adventureId,
          inspection,
          lockedContent: {
            ...prepared.review,
            integrityStatus: "locked",
            contentProfileId: snapshot.profile.profileId,
            snapshotLockId: snapshot.lock.lockId,
            overallHash: snapshot.lock.overallHash,
          },
          playerProfile: {
            playerProfileId: profile.profile.playerProfileId,
            persistenceStatus: profile.persistence.status,
          },
        });
      } catch (error) {
        if (error?.code === "SNAPSHOT_ADVENTURE_EXISTS" || error?.code === "ADVENTURE_EXISTS") {
          lastCollision = error;
          continue;
        }
        throw error;
      }
    }
    throw lifecycleError(stableCode(lastCollision, "NEW_GAME_ID_ALLOCATION_FAILED"), "Could not allocate a new Adventure id.");
  }

  return Object.freeze({ catalog, prepare, create });
}

function normalizeSelection(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw lifecycleError("NEW_GAME_SELECTION_INVALID", "New Game content selection is required.");
  }
  const skills = Array.isArray(value.skills) ? value.skills.map((ref) => normalizeRef(ref, "skill")) : [];
  if (skills.length > MAX_SELECTED_SKILLS) {
    throw lifecycleError("NEW_GAME_SKILL_LIMIT", "Too many Skills were selected.");
  }
  const keys = new Set(skills.map(refKey));
  if (keys.size !== skills.length) {
    throw lifecycleError("NEW_GAME_SKILL_DUPLICATE", "A Skill was selected more than once.");
  }
  return deepFreeze({
    host: normalizeRef(value.host, "host"),
    world: normalizeRef(value.world, "world"),
    newGameSkill: normalizeRef(value.newGameSkill, "newGameSkill"),
    skills,
  });
}

function resolvePresetRequest(value = {}, catalog, availablePresets) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw lifecycleError("NEW_GAME_SELECTION_INVALID", "New Game content selection is required.");
  }
  const allowed = new Set(["preset", "optionalSkillChoices", "adventureLocale"]);
  if (Object.keys(value).some((key) => !allowed.has(key)) || !value.preset) {
    throw lifecycleError("NEW_GAME_PRESET_REQUIRED", "New Game must use one installed story bundle.");
  }
  const presetRef = normalizeRef(value.preset, "preset");
  const catalogPreset = catalog.presets.find((item) => refKey(item) === refKey(presetRef));
  const preset = availablePresets.find((item) => refKey(item) === refKey(presetRef));
  if (!catalogPreset || !preset) {
    throw lifecycleError("NEW_GAME_PRESET_NOT_FOUND", "Selected story bundle is unavailable.");
  }
  const optionalSkillChoices = normalizeOptionalSkillChoices(
    value.optionalSkillChoices,
    preset.selection.optionalSkills || []
  );
  const enabledOptionalSkills = optionalSkillChoices
    .filter((choice) => choice.enabled)
    .map(({ packId, itemId }) => ({ packId, itemId }));
  const selection = normalizeSelection({
    ...preset.selection,
    skills: [...preset.selection.skills, ...enabledOptionalSkills],
  });
  return deepFreeze({ preset, selection, optionalSkillChoices });
}

function normalizeOptionalSkillChoices(value, declarations) {
  const declared = declarations.map((entry) => ({
    packId: entry.packId,
    itemId: entry.itemId,
    defaultEnabled: entry.defaultEnabled === true,
  }));
  const choices = value === undefined
    ? declared.map((entry) => ({ packId: entry.packId, itemId: entry.itemId, enabled: entry.defaultEnabled }))
    : normalizeExplicitOptionalSkillChoices(value);
  const declaredKeys = declared.map(refKey).sort();
  const choiceKeys = choices.map(refKey).sort();
  if (choiceKeys.length !== declaredKeys.length
    || choiceKeys.some((key, index) => key !== declaredKeys[index])) {
    throw optionalSkillChoiceError();
  }
  return deepFreeze(choices.slice().sort((left, right) => refKey(left).localeCompare(refKey(right))));
}

function normalizeExplicitOptionalSkillChoices(value) {
  if (!Array.isArray(value)) throw optionalSkillChoiceError();
  const choices = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some((key) => key !== "packId" && key !== "itemId" && key !== "enabled")
      || typeof entry.enabled !== "boolean") {
      throw optionalSkillChoiceError();
    }
    try {
      const ref = normalizeRef({ packId: entry.packId, itemId: entry.itemId }, "optionalSkillChoice");
      return Object.freeze({ ...ref, enabled: entry.enabled });
    } catch {
      throw optionalSkillChoiceError();
    }
  });
  if (new Set(choices.map(refKey)).size !== choices.length) throw optionalSkillChoiceError();
  return choices;
}

function optionalSkillChoiceError() {
  return lifecycleError(
    "NEW_GAME_OPTIONAL_SKILL_CHOICES_INVALID",
    "Optional Skill choices must exactly match the selected story bundle."
  );
}

function selectionWithOptionalDefaults(preset) {
  return {
    ...preset,
    skills: [
      ...preset.skills,
      ...(preset.optionalSkills || [])
        .filter((skill) => skill.defaultEnabled)
        .map(({ packId, itemId }) => ({ packId, itemId })),
    ],
  };
}

function normalizeRef(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw lifecycleError("NEW_GAME_SELECTION_INVALID", `${label} selection is required.`);
  }
  const allowed = new Set(["packId", "itemId"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw lifecycleError("NEW_GAME_SELECTION_INVALID", `${label} selection contains unsupported fields.`);
  }
  return Object.freeze({
    packId: requireStableRef(value.packId, `${label}.packId`),
    itemId: requireStableRef(value.itemId, `${label}.itemId`),
  });
}

function assertSelectionVisible(selection, catalog, hiddenLifecycleSkillRefs = new Set()) {
  const visible = new Map([
    ...catalog.hosts.map((item) => [refKey(item), item.type]),
    ...catalog.worlds.map((item) => [refKey(item), item.type]),
    ...catalog.newGameSkills.map((item) => [refKey(item), item.skillClass]),
    ...catalog.skills.map((item) => [refKey(item), item.type]),
  ]);
  if (visible.get(refKey(selection.host)) !== "host" || visible.get(refKey(selection.world)) !== "world") {
    throw lifecycleError("NEW_GAME_SELECTION_NOT_FOUND", "Selected Host or World is unavailable.");
  }
  if (visible.get(refKey(selection.newGameSkill)) !== "new_game") {
    throw lifecycleError("NEW_GAME_SELECTION_NOT_FOUND", "Selected New Game Skill is unavailable.");
  }
  if (selection.skills.some((skill) => visible.get(refKey(skill)) !== "skill"
    && !hiddenLifecycleSkillRefs.has(refKey(skill)))) {
    throw lifecycleError("NEW_GAME_SELECTION_NOT_FOUND", "A selected Skill is unavailable.");
  }
}

function assertOptionalSkillsVisible(choices, catalog) {
  const visibleSkills = new Set(catalog.skills.map(refKey));
  if (choices.some((choice) => !visibleSkills.has(refKey(choice)))) {
    throw lifecycleError("NEW_GAME_SELECTION_NOT_FOUND", "An optional Skill is unavailable.");
  }
}

function collectReplacementConfirmations(selection, catalog) {
  const selectedKeys = new Set([refKey(selection.host), refKey(selection.world), refKey(selection.newGameSkill), ...selection.skills.map(refKey)]);
  return [...catalog.hosts, ...catalog.worlds, ...catalog.newGameSkills, ...catalog.skills]
    .filter((item) => selectedKeys.has(refKey(item)) && item.replaces)
    .map((item) => deepFreeze({
      replacementItemId: item.itemId,
      replacedItemId: item.replaces.itemId,
      confirmedByUser: true,
    }));
}

function assertConfirmationMatches(actualValue, expectedValue) {
  const actual = confirmationKeys(actualValue);
  const expected = confirmationKeys(expectedValue);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw lifecycleError("NEW_GAME_CONFIRMATION_STALE", "New Game content confirmation no longer matches the selection.");
  }
}

function confirmationKeys(value) {
  return (Array.isArray(value) ? value : [])
    .filter((entry) => entry?.confirmedByUser === true)
    .map((entry) => `${entry.replacementItemId}:${entry.replacedItemId}`)
    .sort();
}

function fingerprintPreparedContent(review, presetRevision, optionalSkillChoices, skillModuleContentHash) {
  return crypto.createHash("sha256").update(JSON.stringify({
    preset: review.preset,
    presetRevision,
    optionalSkillChoices,
    selection: review.selection,
    activePacks: review.activePacks,
    skillModuleContentHash,
    moduleReviewHash: review.moduleCapabilityReview?.reviewHash || null,
    language: review.language,
    sourceLanguage: review.sourceLanguage,
    localeCoverage: review.localeCoverage,
    replacements: review.replacements,
  })).digest("hex");
}

function projectCatalogItem(pack, item) {
  return deepFreeze({
    packId: pack.id,
    packTitle: pack.title,
    packVersion: pack.version,
    ownership: pack.ownership,
    itemId: item.id,
    type: item.type,
    title: item.title,
    language: item.language,
    description: item.description,
    availableLocales: [...(item.availableLocales || [item.language])],
    localizedMetadata: (item.localizedMetadata || []).map((entry) => ({ ...entry })),
    danger: item.danger,
    skillClass: item.type === "skill" ? item.skillClass : null,
    triggers: [...(item.triggers || [])],
    readScopes: [...(item.readScopes || [])],
    writeScopes: [...(item.writeScopes || [])],
    hiddenLifecycle: pack.ownership === "built_in" && item.moduleVisibility === "hidden_until_active",
    replaces: item.replaces ? { ...item.replaces } : null,
  });
}

function projectResolvedItem(item, locale = item.language) {
  const localized = item.localization?.locales?.find((entry) => entry.locale === locale) || null;
  return deepFreeze({
    packId: item.packId,
    packVersion: item.packVersion,
    itemId: item.id,
    type: item.type,
    title: localized?.title || item.title,
    language: localized ? locale : item.language,
    sourceLanguage: item.language,
    description: localized?.description || item.description,
    danger: item.danger,
    skillClass: item.type === "skill" ? item.skillClass : null,
  });
}

function projectPreset(preset, locale = preset.language) {
  const localized = preset.localizedMetadata?.find((entry) => entry.locale === locale) || null;
  return deepFreeze({
    packId: preset.packId,
    packVersion: preset.packVersion,
    itemId: preset.itemId,
    title: localized?.title || preset.title,
    language: localized ? locale : preset.language,
    sourceLanguage: preset.language,
    availableLocales: [...(preset.availableLocales || [preset.language])],
    description: localized?.description || preset.description,
    danger: preset.danger,
  });
}

function projectCatalogPreset(preset, hiddenLifecycleSkillRefs = new Set()) {
  return deepFreeze({
    packId: preset.packId,
    packTitle: preset.packTitle,
    packVersion: preset.packVersion,
    ownership: preset.ownership,
    itemId: preset.itemId,
    title: preset.title,
    language: preset.language,
    availableLocales: [...(preset.availableLocales || [preset.language])],
    localizedMetadata: (preset.localizedMetadata || []).map((entry) => ({ ...entry })),
    description: preset.description,
    danger: preset.danger,
    selection: {
      host: { ...preset.selection.host },
      world: { ...preset.selection.world },
      newGameSkill: { ...preset.selection.newGameSkill },
      skills: preset.selection.skills
        .filter((skill) => !hiddenLifecycleSkillRefs.has(refKey(skill)))
        .map((skill) => ({ ...skill })),
      optionalSkills: (preset.selection.optionalSkills || []).map((skill) => ({
        packId: skill.packId,
        itemId: skill.itemId,
        defaultEnabled: skill.defaultEnabled === true,
      })),
    },
  });
}

function projectPublicSelection(selection, hiddenLifecycleSkillRefs = new Set()) {
  return deepFreeze({
    host: { ...selection.host },
    world: { ...selection.world },
    newGameSkill: { ...selection.newGameSkill },
    skills: selection.skills
      .filter((skill) => !hiddenLifecycleSkillRefs.has(refKey(skill)))
      .map((skill) => ({ ...skill })),
  });
}

function projectEngineCapability(id) {
  return Object.freeze({ id: String(id), required: true, disableAllowed: false });
}

function refKey(ref) {
  return `${ref.packId}:${ref.itemId}`;
}

async function removePartialAdventure(adventuresRoot, adventureId) {
  const target = path.join(adventuresRoot, adventureId);
  await makeWritable(target);
  await fs.rm(target, { recursive: true, force: true });
}

async function makeWritable(target) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) return;
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    const entries = await fs.readdir(target).catch(() => []);
    for (const entry of entries) await makeWritable(path.join(target, entry));
    await fs.chmod(target, 0o700).catch(() => {});
  } else if (stat.isFile()) {
    await fs.chmod(target, 0o600).catch(() => {});
  }
}

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw lifecycleError("NEW_GAME_PATH_INVALID", `${label} must be absolute.`);
  }
  return path.resolve(value);
}

function requireStableRef(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,95}$/.test(normalized)) {
    throw lifecycleError("NEW_GAME_ID_INVALID", `${label} is invalid.`);
  }
  return normalized;
}

function stableCode(error, fallback) {
  return typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : fallback;
}

function lifecycleError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  if (details.coverage) error.coverage = details.coverage;
  return error;
}

function buildNewGameLocaleCoverage({ requestedLocale, preset, plan, hiddenSkillRefs = new Set() }) {
  const target = canonicalizeGameLocale(requestedLocale);
  const candidates = [
    projectLocaleCandidate("preset", preset),
    projectLocaleCandidate("host", plan.host),
    projectLocaleCandidate("world", plan.world),
    projectLocaleCandidate("new_game_skill", plan.newGameSkill),
    ...plan.skills.map((skill) => projectLocaleCandidate(
      hiddenSkillRefs.has(refKey({ packId: skill.packId, itemId: skill.id })) ? "required_skill" : "skill",
      skill,
      { hideIdentity: hiddenSkillRefs.has(refKey({ packId: skill.packId, itemId: skill.id })) }
    )),
  ];
  const readyItems = [];
  const blockers = [];
  for (const candidate of candidates) {
    if (candidate.availableLocales.includes(target)) {
      readyItems.push(candidate);
    } else {
      blockers.push({
        kind: candidate.kind,
        packId: candidate.packId,
        itemId: candidate.itemId,
        ownership: candidate.ownership,
        reason: "missing_locale",
        sourceLocale: candidate.sourceLocale,
        availableLocales: candidate.availableLocales,
      });
    }
  }
  return deepFreeze({
    schemaVersion: "grey-crow-new-game-locale-coverage-v1",
    requestedLocale: target,
    status: blockers.length === 0 ? "ready" : "blocked",
    readyItems: readyItems.map(({ kind, packId, itemId, ownership, sourceLocale, availableLocales }) => ({
      kind,
      packId,
      itemId,
      ownership,
      sourceLocale,
      availableLocales,
    })).sort(compareLocaleCandidates),
    blockers: blockers.sort(compareLocaleCandidates),
  });
}

function projectLocaleCandidate(kind, item, options = {}) {
  const sourceLocale = canonicalizeGameLocale(item.language);
  const localized = Array.isArray(item.availableLocales)
    ? item.availableLocales.map((locale) => canonicalizeGameLocale(locale))
    : Array.isArray(item.localization?.locales)
      ? item.localization.locales.map((entry) => canonicalizeGameLocale(entry.locale))
      : [];
  return deepFreeze({
    kind,
    packId: options.hideIdentity ? "built_in" : item.packId,
    itemId: options.hideIdentity ? "required-hidden-skill" : (item.itemId || item.id),
    ownership: item.ownership || "unknown",
    sourceLocale,
    availableLocales: [...new Set([sourceLocale, ...localized])].sort(),
  });
}

function compareLocaleCandidates(left, right) {
  return left.kind.localeCompare(right.kind)
    || left.packId.localeCompare(right.packId)
    || left.itemId.localeCompare(right.itemId);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

module.exports = {
  MAX_SELECTED_SKILLS,
  NEW_GAME_CATALOG_SCHEMA,
  NEW_GAME_REVIEW_SCHEMA,
  buildNewGameLocaleCoverage,
  createNewGameLifecycle,
};
