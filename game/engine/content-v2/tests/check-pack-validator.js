"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { loadBuiltInContentPack, resolveContentPlan, validatePackV2 } = require("..");
const { createDeterministicFixtureBuilders } = require("./test-fixtures/builders");
const { withTempFixture } = require("./test-fixtures/temp-workspace");

async function runPackValidatorResolverChecks() {
  const builders = createDeterministicFixtureBuilders({ seed: "pack-v2" });
  return withTempFixture(async (workspace) => {
    const manifest = buildCompletePack(builders);
    await writePack(workspace, "trusted/base-pack", manifest);
    const packRoot = workspace.resolve("trusted/base-pack");
    const trustedRoot = workspace.resolve("trusted");
    const validated = await validatePackV2(packRoot, { trustedRoot, engineVersion: "2.0.0" });

    const firstPlan = resolveContentPlan({
      packs: [validated],
      selection: {
        host: { packId: manifest.id, itemId: "fixture-host" },
        world: { packId: manifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: manifest.id, itemId: "fixture-new-game" },
        skills: [
          { packId: manifest.id, itemId: "fixture-map" },
          { packId: manifest.id, itemId: "fixture-state" },
        ],
      },
    });
    const secondPlan = resolveContentPlan({
      packs: [validated],
      selection: {
        host: { packId: manifest.id, itemId: "fixture-host" },
        world: { packId: manifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: manifest.id, itemId: "fixture-new-game" },
        skills: [
          { packId: manifest.id, itemId: "fixture-state" },
          { packId: manifest.id, itemId: "fixture-map" },
        ],
      },
    });
    assert(JSON.stringify(firstPlan) === JSON.stringify(secondPlan), "resolver output must be deterministic");
    assert(firstPlan.skills.map((item) => item.id).join(",") === "fixture-map,fixture-state", "skills must sort deterministically");
    assert(firstPlan.engineCapabilities.includes("memory"), "Engine Memory capability must remain present");
    assert(firstPlan.newGameSkill.id === "fixture-new-game", "one lifecycle New Game Skill must be selected independently");
    assert(firstPlan.routeHints.some((hint) => hint.itemId === "fixture-map"), "Skill triggers must remain route metadata");
    assert(!firstPlan.routeHints.some((hint) => hint.itemId === "fixture-new-game"), "lifecycle activation must not become an ordinary trigger route");

    const legacySourcePlan = resolveContentPlan({
      packs: [validated],
      selection: {
        host: { packId: manifest.id, itemId: "fixture-host" },
        world: { packId: manifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: manifest.id, itemId: "fixture-new-game" },
        skills: [{ packId: manifest.id, itemId: "fixture-state" }],
      },
    });
    const legacyStateSkill = legacySourcePlan.skills[0];
    const legacyFilesByPath = new Map(validated.files.map((file) => [file.relativePath, file]));
    assert(validated.ownership === null && validated.resources.skillModules.length === 0, "legacy validated Packs must keep null ownership and no module resources by default");
    assert(legacyStateSkill.module === null && legacyStateSkill.playerGuide === null, "legacy Skills must remain valid without synthesized module metadata");
    assert(legacyStateSkill.sourceFiles.length === 2, "legacy validated Skills must retain their exact entry and template descriptors");
    assert(legacyStateSkill.sourceFiles.every((file) => file === legacyFilesByPath.get(file.relativePath)), "resolver source descriptors must come from validated.files");
    assert(legacySourcePlan.activePacks[0].title === manifest.title && legacySourcePlan.activePacks[0].ownership === null, "active Pack projection must preserve title and null legacy ownership");

    assertPlanError("PACK_SELECTION_INVALID", () => resolveContentPlan({
      packs: [validated],
      selection: {
        host: { packId: manifest.id, itemId: "fixture-host" },
        world: { packId: manifest.id, itemId: "fixture-world" },
        skills: [],
      },
    }));
    assertPlanError("PACK_SKILL_CLASS_MISMATCH", () => resolveContentPlan({
      packs: [validated],
      selection: {
        host: { packId: manifest.id, itemId: "fixture-host" },
        world: { packId: manifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: manifest.id, itemId: "fixture-map" },
        skills: [],
      },
    }));
    assertPlanError("PACK_SKILL_CLASS_MISMATCH", () => resolveContentPlan({
      packs: [validated],
      selection: {
        host: { packId: manifest.id, itemId: "fixture-host" },
        world: { packId: manifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: manifest.id, itemId: "fixture-new-game" },
        skills: [{ packId: manifest.id, itemId: "fixture-new-game" }],
      },
    }));

    await assertPackError("PACK_ENGINE_INCOMPATIBLE", async () => validatePackV2(packRoot, {
      trustedRoot,
      engineVersion: "3.0.0",
    }));

    await writePack(workspace, "trusted/script-pack", manifest, { "unsafe.js": "module.exports = 1;\n" });
    await assertPackError("PACK_FILE_TYPE_FORBIDDEN", async () => validatePackV2(
      workspace.resolve("trusted/script-pack"),
      { trustedRoot }
    ));

    await writePack(workspace, "trusted/symlink-pack", manifest);
    await fs.symlink(
      workspace.resolve("trusted/base-pack/host/HOST.md"),
      workspace.resolve("trusted/symlink-pack/linked.md")
    );
    await assertPackError("PACK_SYMLINK_FORBIDDEN", async () => validatePackV2(
      workspace.resolve("trusted/symlink-pack"),
      { trustedRoot }
    ));

    await writePack(workspace, "trusted/template-id-pack", manifest, {
      "skills/state/templates/state.md": "# Wrong Template\n\nTemplate ID: `template:not-state`\n",
    });
    await assertPackError("PACK_TEMPLATE_ID_MISMATCH", async () => validatePackV2(
      workspace.resolve("trusted/template-id-pack"),
      { trustedRoot }
    ));

    const moduleManifest = buildModulePack(manifest);
    const moduleDefinition = buildModuleDefinition();
    const moduleRaw = `${JSON.stringify(moduleDefinition, null, 2)}\n`;
    await writePack(workspace, "trusted/module-pack", moduleManifest, {
      "skills/state/module.json": moduleRaw,
    });
    const moduleRoot = workspace.resolve("trusted/module-pack");
    const validatedModulePack = await validatePackV2(moduleRoot, { trustedRoot, ownership: "player_owned" });
    assert(validatedModulePack.engineVersion === "2.3.0", "Module v1 Pack must remain valid against the current Content API by default");
    assert(validatedModulePack.ownership === "player_owned", "validated Pack ownership must come from Engine options");
    const moduleResource = validatedModulePack.resources.skillModules.find((resource) => resource.itemId === "fixture-state");
    const expectedModuleHash = crypto.createHash("sha256").update(Buffer.from(moduleRaw, "utf8")).digest("hex");
    assert(moduleResource?.sha256 === expectedModuleHash, "module resource hash must cover the exact raw module.json bytes");
    assert(moduleResource?.sizeBytes === Buffer.byteLength(moduleRaw, "utf8"), "module resource size must cover the exact raw module.json bytes");
    assert(Object.isFrozen(moduleResource) && Object.isFrozen(moduleResource.definition)
      && Object.isFrozen(moduleResource.definition.fields[0]), "validated module definition must be deeply frozen");
    const manifestModule = validatedModulePack.manifest.provides.find((item) => item.id === "fixture-state").module;
    assert(!Object.prototype.hasOwnProperty.call(manifestModule, "definition")
      && !Object.prototype.hasOwnProperty.call(manifestModule, "sha256")
      && !Object.prototype.hasOwnProperty.call(manifestModule, "sizeBytes"), "Engine-owned module metadata must not be injected into the manifest");

    const modulePlan = resolveContentPlan({
      packs: [validatedModulePack],
      selection: {
        host: { packId: moduleManifest.id, itemId: "fixture-host" },
        world: { packId: moduleManifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: moduleManifest.id, itemId: "fixture-new-game" },
        skills: [{ packId: moduleManifest.id, itemId: "fixture-state" }],
      },
    });
    const resolvedModuleSkill = modulePlan.skills[0];
    assert(resolvedModuleSkill.packTitle === moduleManifest.title && resolvedModuleSkill.ownership === "player_owned", "selected item must preserve Engine-owned Pack title and ownership");
    assert(resolvedModuleSkill.playerGuide === moduleManifest.provides.find((item) => item.id === "fixture-state").playerGuide, "selected item must preserve playerGuide");
    assert(resolvedModuleSkill.module?.definition === moduleResource.definition
      && resolvedModuleSkill.module.sha256 === expectedModuleHash
      && resolvedModuleSkill.module.sizeBytes === Buffer.byteLength(moduleRaw, "utf8")
      && resolvedModuleSkill.module.path === "skills/state/module.json", "resolver must preserve validated module definition, hash, size, and path");
    assert(resolvedModuleSkill.sourceFiles.map((file) => file.relativePath).join(",")
      === "skills/state/SKILL.md,skills/state/templates/state.md,skills/state/module.json", "module Skill source descriptors must cover SKILL, templates, and module.json");
    const moduleFilesByPath = new Map(validatedModulePack.files.map((file) => [file.relativePath, file]));
    assert(resolvedModuleSkill.sourceFiles.every((file) => file === moduleFilesByPath.get(file.relativePath)), "module source descriptors must be the validated file records");
    assert(modulePlan.activePacks[0].title === moduleManifest.title && modulePlan.activePacks[0].ownership === "player_owned", "active Pack metadata must preserve title and ownership");
    assert(!JSON.stringify(modulePlan).includes("moduleRef") && !JSON.stringify(modulePlan).includes("moduleGrant"), "resolver metadata must not pre-authorize a module");
    assertPlanError("PACK_VALIDATED_METADATA_REQUIRED", () => resolveContentPlan({
      packs: [moduleManifest],
      selection: {
        host: { packId: moduleManifest.id, itemId: "fixture-host" },
        world: { packId: moduleManifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: moduleManifest.id, itemId: "fixture-new-game" },
        skills: [{ packId: moduleManifest.id, itemId: "fixture-state" }],
      },
    }));
    await assertPackError("PACK_OWNERSHIP_INVALID", async () => validatePackV2(moduleRoot, {
      trustedRoot,
      ownership: "quarantined",
    }));
    await assertPackError("PACK_ENGINE_INCOMPATIBLE", async () => validatePackV2(moduleRoot, {
      trustedRoot,
      engineVersion: "2.0.0",
    }));

    const broadModuleManifest = clone(moduleManifest);
    broadModuleManifest.id = "broad-module-pack";
    broadModuleManifest.engineCompatibility = ">=2 <3";
    await writePack(workspace, "trusted/broad-module-pack", broadModuleManifest, {
      "skills/state/module.json": `${JSON.stringify(moduleDefinition, null, 2)}\n`,
    });
    await assertPackError("PACK_CONTENT_API_FEATURE_RANGE_INVALID", async () => validatePackV2(
      workspace.resolve("trusted/broad-module-pack"),
      { trustedRoot }
    ));

    const missingModuleManifest = clone(moduleManifest);
    missingModuleManifest.id = "missing-module-pack";
    await writePack(workspace, "trusted/missing-module-pack", missingModuleManifest);
    await assertPackError("PACK_SKILL_MODULE_FILE_MISSING", async () => validatePackV2(
      workspace.resolve("trusted/missing-module-pack"),
      { trustedRoot }
    ));

    const invalidModuleManifest = clone(moduleManifest);
    invalidModuleManifest.id = "invalid-module-pack";
    await writePack(workspace, "trusted/invalid-module-pack", invalidModuleManifest, {
      "skills/state/module.json": `${JSON.stringify({
        schemaVersion: "grey-crow-skill-module-definition-v1",
        stateVersion: 1,
        visibility: "visible",
        summaryFields: [],
        fields: [],
      }, null, 2)}\n`,
    });
    await assertPackError("PACK_SKILL_MODULE_INVALID", async () => validatePackV2(
      workspace.resolve("trusted/invalid-module-pack"),
      { trustedRoot }
    ));

    const localizationManifest = buildLocalizationPack(moduleManifest);
    const localizationExtras = buildLocalizationExtras(moduleDefinition);
    await writePack(workspace, "trusted/localization-pack", localizationManifest, localizationExtras);
    const localizationRoot = workspace.resolve("trusted/localization-pack");
    const validatedLocalizationPack = await validatePackV2(localizationRoot, { trustedRoot, ownership: "player_owned" });
    assert(validatedLocalizationPack.engineVersion === "2.3.0", "Skill localization Pack must remain valid against the current Content API");
    const localizationResource = validatedLocalizationPack.resources.skillLocalizations.find((resource) => resource.itemId === "fixture-state");
    assert(localizationResource?.sourceLocale === "zh-CN" && localizationResource.locales[0]?.locale === "en-US", "validator must preserve source and translated locale identity");
    assert(Object.isFrozen(localizationResource) && Object.isFrozen(localizationResource.locales[0]), "validated localization metadata must be deeply frozen");
    const localizationPlan = resolveContentPlan({
      packs: [validatedLocalizationPack],
      selection: {
        host: { packId: localizationManifest.id, itemId: "fixture-host" },
        world: { packId: localizationManifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: localizationManifest.id, itemId: "fixture-new-game" },
        skills: [{ packId: localizationManifest.id, itemId: "fixture-state" }],
      },
    });
    assert(localizationPlan.skills[0].localization?.locales[0]?.locale === "en-US", "resolver must preserve validated Skill locale metadata");
    assert(localizationPlan.skills[0].sourceFiles.length === 7, "localized module Skill source descriptors must cover source, bundle, translation and overlay files");

    const broadLocalizationManifest = clone(localizationManifest);
    broadLocalizationManifest.id = "broad-localization-pack";
    broadLocalizationManifest.engineCompatibility = ">=2.1 <3";
    await writePack(workspace, "trusted/broad-localization-pack", broadLocalizationManifest, localizationExtras);
    await assertPackError("PACK_CONTENT_API_FEATURE_RANGE_INVALID", async () => validatePackV2(
      workspace.resolve("trusted/broad-localization-pack"),
      { trustedRoot }
    ));

    const invalidOverlayManifest = clone(localizationManifest);
    invalidOverlayManifest.id = "invalid-overlay-pack";
    const invalidOverlayExtras = buildLocalizationExtras(moduleDefinition);
    const invalidOverlay = JSON.parse(invalidOverlayExtras["skills/state/locales/en-US/module-presentation.json"]);
    invalidOverlay.fields[0].fieldId = "changed_progress";
    invalidOverlayExtras["skills/state/locales/en-US/module-presentation.json"] = `${JSON.stringify(invalidOverlay, null, 2)}\n`;
    await writePack(workspace, "trusted/invalid-overlay-pack", invalidOverlayManifest, invalidOverlayExtras);
    await assertPackError("PACK_SKILL_LOCALIZATION_OVERLAY_SHAPE_MISMATCH", async () => validatePackV2(
      workspace.resolve("trusted/invalid-overlay-pack"),
      { trustedRoot }
    ));

    const presetManifest = buildOptionalPresetPack(manifest);
    const presetBody = buildOptionalPreset();
    await writePack(workspace, "trusted/optional-preset-pack", presetManifest, {
      "presets/optional.json": `${JSON.stringify(presetBody, null, 2)}\n`,
    });
    const validatedPresetPack = await validatePackV2(workspace.resolve("trusted/optional-preset-pack"), { trustedRoot });
    assert(validatedPresetPack.engineVersion === "2.3.0", "optionalSkills preset must remain valid against the current Content API");

    const invalidPresetManifest = clone(presetManifest);
    invalidPresetManifest.id = "invalid-preset-pack";
    const invalidPresetBody = clone(presetBody);
    invalidPresetBody.optionalSkills.push({ ...invalidPresetBody.optionalSkills[0] });
    await writePack(workspace, "trusted/invalid-preset-pack", invalidPresetManifest, {
      "presets/optional.json": `${JSON.stringify(invalidPresetBody, null, 2)}\n`,
    });
    await assertPackError("PACK_PRESET_INVALID", async () => validatePackV2(
      workspace.resolve("trusted/invalid-preset-pack"),
      { trustedRoot }
    ));

    const conflicting = clone(manifest);
    conflicting.id = "conflicting-pack";
    conflicting.conflicts = [manifest.id];
    for (const item of conflicting.provides) item.id = `conflict-${item.id}`;
    assertPlanError("PACK_CONFLICT", () => resolveContentPlan({
      packs: [manifest, conflicting],
      selection: {
        host: { packId: manifest.id, itemId: "fixture-host" },
        world: { packId: manifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: manifest.id, itemId: "fixture-new-game" },
        skills: [],
      },
    }));

    const replacementPack = buildReplacementPack("fixture-map");
    assertPlanError("PACK_REPLACEMENT_CONFIRMATION_REQUIRED", () => resolveContentPlan({
      packs: [manifest, replacementPack],
      selection: {
        host: { packId: manifest.id, itemId: "fixture-host" },
        world: { packId: manifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: manifest.id, itemId: "fixture-new-game" },
        skills: [{ packId: replacementPack.id, itemId: "alternate-map" }],
      },
    }));
    const confirmed = resolveContentPlan({
      packs: [manifest, replacementPack],
      selection: {
        host: { packId: manifest.id, itemId: "fixture-host" },
        world: { packId: manifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: manifest.id, itemId: "fixture-new-game" },
        skills: [{ packId: replacementPack.id, itemId: "alternate-map" }],
      },
      replacementConfirmations: [{
        replacementItemId: "alternate-map",
        replacedItemId: "fixture-map",
        confirmedByUser: true,
      }],
    });
    assert(confirmed.replacements.length === 1, "confirmed replacement must enter the normalized plan");

    const coreReplacement = buildReplacementPack("memory");
    assertPlanError("PACK_CORE_REPLACEMENT_FORBIDDEN", () => resolveContentPlan({
      packs: [manifest, coreReplacement],
      selection: {
        host: { packId: manifest.id, itemId: "fixture-host" },
        world: { packId: manifest.id, itemId: "fixture-world" },
        newGameSkill: { packId: manifest.id, itemId: "fixture-new-game" },
        skills: [{ packId: coreReplacement.id, itemId: "alternate-map" }],
      },
      replacementConfirmations: [{ replacementItemId: "alternate-map", replacedItemId: "memory", confirmedByUser: true }],
    }));

    return {
      name: "p2-23-pack-validator-resolver",
      ok: true,
      details: {
        validated_files: validated.totals.files,
        deterministic_plan: true,
        symlink_rejected: true,
        scripts_rejected: true,
        core_replacement_rejected: true,
        explicit_replacement_confirmation: true,
        triggers_are_hints_only: true,
        template_ids_verified: true,
        old_pack_valid_on_content_api_20: true,
        module_contract_validated: true,
        module_requires_content_api_21: true,
        module_metadata_deep_frozen: true,
        module_raw_bytes_hashed: true,
        resolver_metadata_preserved: true,
        legacy_module_absence_compatible: true,
        optional_preset_contract_validated: true,
        skill_localization_contract_validated: true,
        skill_localization_requires_content_api_22: true,
        localized_stable_ids_enforced: true,
      },
    };
  }, { prefix: "p2-23-pack-validator" });
}

async function runBuiltInPackChecks() {
  const gameRoot = path.resolve(__dirname, "..", "..", "..");
  const contentRoot = path.join(gameRoot, "content");
  const loaded = await loadBuiltInContentPack({ contentRoot, engineVersion: "2.2.0" });
  const hostText = await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "host", "HOST.md"), "utf8");
  const worldText = await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "world", "WORLD.md"), "utf8");
  const newGameSkillText = await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "skills", "new-game-default", "SKILL.md"), "utf8");
  const newGameTemplatePath = "skills/new-game-default/templates/opening-anchor-write.md";
  const newGameTemplateText = await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", newGameTemplatePath), "utf8");
  const gameStateText = await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "skills", "game-state", "SKILL.md"), "utf8");
  const gameStateTemplateTexts = await Promise.all([
    "inventory-item.md",
    "player-status.md",
    "scene-state.md",
  ].map((file) => fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "skills", "game-state", "templates", file), "utf8")));
  const mapText = await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "skills", "map", "SKILL.md"), "utf8");
  const entityMemoryText = await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "skills", "entity-memory", "SKILL.md"), "utf8");
  const memoryFragmentText = await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "skills", "memory-fragment", "SKILL.md"), "utf8");
  const storyFinaleText = await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "skills", "story-finale", "SKILL.md"), "utf8");
  const easterText = await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "skills", "extreme-ending-easter", "SKILL.md"), "utf8");
  const easterDefinition = JSON.parse(await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "skills", "extreme-ending-easter", "module.json"), "utf8"));
  const memoryFragmentDefinition = JSON.parse(await fs.readFile(path.join(contentRoot, "packs", "grey-crow-default", "skills", "memory-fragment", "module.json"), "utf8"));
  const skillIds = loaded.defaultPlan.skills.map((item) => item.id);
  const skillItems = loaded.pack.manifest.provides.filter((item) => item.type === "skill");

  assert(loaded.sourceKind === "normalized_pack", "v2 built-in loader must expose one normalized Pack source");
  assert(loaded.defaultPlan.host.id === "grey-crow-host", "default Host must resolve from the built-in Pack");
  assert(loaded.defaultPlan.world.id === "shanghai-day10", "default World must resolve from the built-in Pack");
  assert(loaded.defaultPlan.newGameSkill.id === "new-game-default", "default preset must resolve one New Game Skill");
  assert(skillIds.join(",") === "entity-memory,extreme-ending-easter,game-state,map,memory-fragment,story-finale", "default preset must preserve three gameplay Skills, required Story Finale, the hidden official Easter Skill, and the default-enabled memory module");
  assert(loaded.pack.manifest.version === "2.2.0" && loaded.pack.manifest.engineCompatibility === ">=2.2 <3", "built-in localized Skill Pack must advertise its 2.2 content capability floor");
  assert(loaded.defaultPreset.optionalSkills.length === 1
    && loaded.defaultPreset.optionalSkills[0].itemId === "memory-fragment"
    && loaded.defaultPreset.optionalSkills[0].defaultEnabled === true, "memory fragments must be an explicit default-on optional Skill");
  assert(!hostText.includes("上海") && !hostText.includes("N7-Rabies-Variant"), "Host snapshot must not contain the fixed World background");
  assert(worldText.includes("上海") && worldText.includes("N7-Rabies-Variant"), "World item must own the default World background");
  assert(loaded.defaultPlan.engineCapabilities.includes("base-state"), "base state capability must remain Engine-owned");
  assert(!loaded.pack.manifest.provides.some((item) => ["new-game", "delete-game", "game-save", "summarize"].includes(item.id)), "lifecycle and maintenance capabilities must not become optional items");
  assert(loaded.defaultPlan.newGameSkill.skillClass === "new_game", "New Game content must remain distinct from the Engine new-game capability");
  assert(loaded.defaultPlan.newGameSkill.templates.includes(newGameTemplatePath), "New Game write guidance must remain an on-demand template");
  assert(newGameTemplateText.trim().length > 0, "New Game guidance must remain present in the locked content");
  assert(["繁华市中心", "老城区", "城市边缘", "工业区"].every((label) => newGameSkillText.includes(label)), "Default New Game Skill must preserve the four authored Shanghai starting zones");
  assert(newGameSkillText.includes("每次回复只要求玩家作出一个主要决定"), "Default New Game Skill must prohibit a batched setup questionnaire");
  assert(newGameSkillText.includes("角色创建阶段不生成、不询问也不摘要记忆碎片")
    && !newGameTemplateText.includes("记忆碎片"), "default New Game content must leave no memory-fragment prompt or submission residue before the optional module becomes available");
  assert(skillItems.every((item) => /当|需要|开始|询问|涉及|选择/.test(item.description)), "built-in Skill descriptions must explain applicability as well as capability");
  assert(!gameStateText.includes("saveRoot/") && !gameStateText.includes("hard_state_proposal") && !gameStateText.includes("record_type"), "game-state main body must keep payload and storage details in templates");
  // These are preserved authored sources. Native TurnBundle protocol is tested
  // by the session engine, not by retaining retired tool names in content tests.
  assert(gameStateTemplateTexts.every((text) => text.trim().length > 0), "inventory, player and scene guidance must all remain present");
  assert(entityMemoryText.includes("# 实体与世界记忆") && entityMemoryText.includes("## 何时使用") && !entityMemoryText.includes("saveRoot/"), "entity-memory main body must use the Pack language without raw storage paths");
  assert(mapText.includes("只读") && mapText.includes("不会自动") && !mapText.includes("saveRoot/") && loaded.pack.manifest.provides.find((item) => item.id === "map")?.writeScopes.length === 0, "map Skill must remain read-only and side-effect free");
  const fragmentsField = memoryFragmentDefinition.fields.find((field) => field.id === "fragments");
  const revelationField = memoryFragmentDefinition.fields.find((field) => field.id === "revelation_status");
  assert(memoryFragmentText.includes("选择并塑造") && memoryFragmentText.includes("恢复记忆者")
    && fragmentsField?.maxItems === 30 && fragmentsField.allowedOperations.join(",") === "append"
    && revelationField?.options.some((option) => option.value === "sealed" && option.label.includes("选择新的自己"))
    && revelationField?.options.some((option) => option.value === "accepted" && option.label.includes("恢复记忆者")), "official memory content must preserve append-only 30, player-authored new-self freedom, and the accepted title");
  assert(storyFinaleText.includes("整个故事是否已经自然闭合")
    && storyFinaleText.includes("不能替玩家选择")
    && !/\b(?:propose_story_finale|resolve_story_finale_\w+)\b/.test(storyFinaleText)
    && !storyFinaleText.includes("saveRoot/"), "official Story Finale content must preserve natural closure and player choice without retired execution tools or storage paths");
  assert(easterText.includes("三次自然确认")
    && easterText.includes("现实与虚构边界")
    && easterText.includes("不得提出候选")
    && easterDefinition.visibility === "hidden_until_active"
    && easterDefinition.fields.length === 0, "official Easter content must preserve three natural confirmations and use an empty built-in hidden lifecycle module");

  return {
    name: "p2-23-built-in-content-pack",
    ok: true,
    details: {
      source_kind: loaded.sourceKind,
      host_world_separated: true,
      optional_skills: skillIds,
      memory_fragment_reference_skill: true,
      engine_capabilities_preserved: true,
      new_game_template_on_demand: true,
      skill_specification_audited: true,
      normalized_files: loaded.pack.totals.files,
    },
  };
}

function buildCompletePack(builders) {
  const manifest = builders.buildPack();
  manifest.provides = [
    manifest.provides[0],
    {
      type: "world", id: "fixture-world", title: "Fixture World", path: "world/WORLD.md",
      language: "zh-CN", description: "Deterministic world fixture.", danger: "low",
    },
    {
      type: "skill", skillClass: "new_game", id: "fixture-new-game", title: "Fixture New Game",
      path: "skills/new-game/SKILL.md", language: "zh-CN",
      description: "Runs a multi-turn setup when the UI starts a new adventure.", danger: "medium",
      triggers: ["ui_start_new_game"], templates: [], readScopes: ["state", "world"], writeScopes: ["state", "timeline"],
    },
    {
      type: "skill", skillClass: "ordinary", id: "fixture-state", title: "Fixture State", path: "skills/state/SKILL.md",
      language: "zh-CN", description: "Explains guarded state updates when current player or scene anchors change.", danger: "low", triggers: ["state"],
      templates: ["skills/state/templates/state.md"], readScopes: ["state"], writeScopes: ["state"],
    },
    {
      type: "skill", skillClass: "ordinary", id: "fixture-map", title: "Fixture Map", path: "skills/map/SKILL.md",
      language: "zh-CN", description: "Reads known routes when the player asks about nearby places or travel.", danger: "low", triggers: ["map"],
      templates: [], readScopes: ["world"], writeScopes: [],
    },
  ];
  return manifest;
}

function buildModulePack(baseManifest) {
  const manifest = clone(baseManifest);
  manifest.id = "module-pack";
  manifest.version = "2.1.0";
  manifest.engineCompatibility = ">=2.1 <3";
  const stateSkill = manifest.provides.find((item) => item.id === "fixture-state");
  stateSkill.playerGuide = "This Skill keeps bounded local state for the current story.";
  stateSkill.module = {
    schemaVersion: "grey-crow-skill-module-ref-v1",
    path: "skills/state/module.json",
  };
  return manifest;
}

function buildModuleDefinition() {
  return {
    schemaVersion: "grey-crow-skill-module-definition-v1",
    stateVersion: 1,
    visibility: "visible",
    summaryFields: ["progress"],
    fields: [{
      id: "progress",
      label: "Progress",
      type: "integer",
      default: 0,
      minimum: 0,
      maximum: 10,
      modelWritable: true,
      allowedOperations: ["set"],
      display: { widget: "progress" },
    }],
  };
}

function buildLocalizationPack(baseManifest) {
  const manifest = clone(baseManifest);
  manifest.id = "localization-pack";
  manifest.version = "2.2.0";
  manifest.engineCompatibility = ">=2.2 <3";
  manifest.languages = ["zh-CN", "en-US"];
  const stateSkill = manifest.provides.find((item) => item.id === "fixture-state");
  stateSkill.localization = {
    schemaVersion: "grey-crow-skill-localization-ref-v1",
    path: "skills/state/localizations.json",
  };
  return manifest;
}

function buildLocalizationExtras(moduleDefinition) {
  const bundle = {
    schemaVersion: "grey-crow-skill-localization-bundle-v1",
    itemId: "fixture-state",
    sourceLocale: "zh-CN",
    locales: [{
      locale: "en-US",
      title: "Fixture State",
      description: "Explains guarded state changes in the current player scene.",
      triggers: ["state", "status changes"],
      playerGuide: "This Skill keeps bounded local state for the current story.",
      skillPath: "skills/state/locales/en-US/SKILL.md",
      templates: [{
        templateId: "template:state",
        path: "skills/state/locales/en-US/templates/state.md",
      }],
      modulePresentationPath: "skills/state/locales/en-US/module-presentation.json",
    }],
  };
  const overlay = {
    schemaVersion: "grey-crow-skill-module-presentation-overlay-v1",
    itemId: "fixture-state",
    locale: "en-US",
    fields: [{
      fieldId: "progress",
      label: "Progress",
      options: [],
      itemFields: [],
      milestones: [],
    }],
  };
  return {
    "skills/state/module.json": `${JSON.stringify(moduleDefinition, null, 2)}\n`,
    "skills/state/localizations.json": `${JSON.stringify(bundle, null, 2)}\n`,
    "skills/state/locales/en-US/SKILL.md": "# Fixture State\n\nUse the guarded state tool when status changes.\n",
    "skills/state/locales/en-US/templates/state.md": "# Fixture State Template\n\nTemplate ID: `template:state`\n",
    "skills/state/locales/en-US/module-presentation.json": `${JSON.stringify(overlay, null, 2)}\n`,
  };
}

function buildOptionalPresetPack(baseManifest) {
  const manifest = clone(baseManifest);
  manifest.id = "optional-preset-pack";
  manifest.version = "2.1.0";
  manifest.engineCompatibility = ">=2.1 <3";
  manifest.provides.push({
    type: "new_game_preset",
    id: "optional-preset",
    title: "Optional Fixture Preset",
    path: "presets/optional.json",
    language: "zh-CN",
    description: "Fixture preset with one bounded optional Skill.",
    danger: "low",
  });
  return manifest;
}

function buildOptionalPreset() {
  return {
    schemaVersion: "grey-crow-new-game-preset-v2",
    id: "optional-preset",
    language: "zh-CN",
    host: { packId: "optional-preset-pack", itemId: "fixture-host" },
    world: { packId: "optional-preset-pack", itemId: "fixture-world" },
    newGameSkill: { packId: "optional-preset-pack", itemId: "fixture-new-game" },
    skills: [{ packId: "optional-preset-pack", itemId: "fixture-state" }],
    optionalSkills: [{ packId: "optional-preset-pack", itemId: "fixture-map", defaultEnabled: true }],
  };
}

async function writePack(workspace, relativeRoot, manifest, extras = {}) {
  await workspace.writeJson(`${relativeRoot}/manifest.json`, manifest);
  for (const item of manifest.provides) {
    await workspace.writeText(`${relativeRoot}/${item.path}`, `# ${item.title}\n\nFixture body.\n`);
    for (const templatePath of item.templates || []) {
      const templateId = path.posix.basename(templatePath).replace(/\.md$/i, "");
      await workspace.writeText(`${relativeRoot}/${templatePath}`, `# ${item.title} Template\n\nTemplate ID: \`template:${templateId}\`\n`);
    }
  }
  for (const [relativePath, content] of Object.entries(extras)) {
    await workspace.writeText(`${relativeRoot}/${relativePath}`, content);
  }
}

function buildReplacementPack(replacedItemId) {
  return {
    schemaVersion: "grey-crow-extension-pack-v2",
    id: "replacement-pack",
    title: "Replacement Pack",
    version: "2.0.0",
    author: "Grey Crow Tests",
    engineCompatibility: ">=2 <3",
    languages: ["zh-CN"],
    provides: [{
      type: "skill", skillClass: "ordinary", id: "alternate-map", title: "Alternate Map", path: "skills/map/SKILL.md",
      language: "zh-CN", description: "Replacement fixture.", danger: "medium", triggers: [], templates: [],
      readScopes: ["world"], writeScopes: [], replaces: { itemId: replacedItemId, compatibleVersion: ">=2 <3" },
    }],
    permissions: ["read_base_content"],
    conflicts: [],
  };
}

async function assertPackError(code, callback) {
  try {
    await callback();
  } catch (error) {
    assert(error?.code === code, `expected ${code}, received ${error?.code || "unknown"}`);
    return;
  }
  throw new Error(`expected ${code}`);
}

function assertPlanError(code, callback) {
  try {
    callback();
  } catch (error) {
    assert(error?.code === code, `expected ${code}, received ${error?.code || "unknown"}`);
    return;
  }
  throw new Error(`expected ${code}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

module.exports = { runBuiltInPackChecks, runPackValidatorResolverChecks };
