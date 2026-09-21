"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  compileContentSnapshot,
  normalizeSkillModuleCreatorDraft,
  prepareSkillModuleSnapshot,
  readContentSnapshot,
  resolveContentPlan,
  validatePackV2,
} = require("..");
const { hashBuffer, hashCanonical } = require("../snapshot-utils");
const { withTempFixture } = require("./test-fixtures/temp-workspace");

async function runSnapshotCompilerChecks() {
  return withTempFixture(async (workspace) => {
    const adventuresRoot = workspace.resolve("adventures");
    const packsRoot = workspace.resolve("packs");
    await fs.mkdir(adventuresRoot, { recursive: true });
    await writeSnapshotPack(workspace, "packs/story-pack", { packId: "story-pack" });
    const packRoot = workspace.resolve("packs/story-pack");
    const validated = await validatePackV2(packRoot, { trustedRoot: packsRoot });
    const plan = resolveContentPlan({
      packs: [validated],
      selection: {
        host: { packId: "story-pack", itemId: "story-host" },
        world: { packId: "story-pack", itemId: "story-world" },
        newGameSkill: { packId: "story-pack", itemId: "story-new-game" },
        skills: [{ packId: "story-pack", itemId: "story-skill" }],
      },
    });
    const compileOptions = {
      adventuresRoot,
      adventureId: "adventure_demo",
      contentProfileId: "content_profile_demo",
      snapshotLockId: "snapshot_demo",
      language: "zh-CN",
      plan,
      packRoots: { "story-pack": packRoot },
      clock: () => "2026-07-14T00:00:00.000Z",
    };
    const compiled = await compileContentSnapshot(compileOptions);
    assert(compiled.profile.host.sha256 === compiled.lock.items[0].sha256, "profile and lock must use the same item digest");
    assert(compiled.profile.newGameSkill.itemId === "story-new-game", "selected New Game Skill must enter the frozen profile");
    assert(compiled.profile.skills.length === 1, "selected Skill must enter the frozen profile");
    assert(compiled.profile.features.includes("skill-panel-presentation-v1")
      && compiled.profile.features.includes("skill-panel-presentation-v2"), "new snapshots must lock both compatible panel generations");
    assert(compiled.profile.skillPanelPresentation.relativePath === "skill-panels.lock.json"
      && compiled.profile.skillPanelPresentationV2.relativePath === "skill-panels-v2.lock.json", "v1 and v2 panel locks must use independent tracked files");
    assert(compiled.lock.files.some((file) => file.relativePath === "skills/story-skill/templates/note.md"), "Skill templates must enter the snapshot");
    assert(compiled.lock.files.some((file) => file.relativePath === "skill-panels.lock.json")
      && compiled.lock.files.some((file) => file.relativePath === "skill-panels-v2.lock.json"), "both panel generations must enter files/hash coverage");
    const adventureMode = (await fs.stat(workspace.resolve("adventures/adventure_demo"))).mode & 0o700;
    const snapshotMode = (await fs.stat(workspace.resolve("adventures/adventure_demo/content-snapshot"))).mode & 0o700;
    const profileMode = (await fs.stat(workspace.resolve("adventures/adventure_demo/content-profile.json"))).mode & 0o600;
    assert((adventureMode & 0o200) !== 0, "adventure root must remain writable for runtime-owned sources");
    assert((snapshotMode & 0o200) === 0 && (profileMode & 0o200) === 0, "content snapshot and profile must remain read-only");

    const loaded = await readContentSnapshot({ adventuresRoot, adventureId: "adventure_demo" });
    const originalHash = loaded.lock.overallHash;
    assert(loaded.content.host.includes("Fixture Host"), "Continue reader must load Host from the snapshot");
    assert(loaded.content.skills[0].templates.length === 1, "Continue reader must load frozen Skill templates");
    assert(loaded.content.skillPanels?.panels.length === 1
      && loaded.content.skillPanelsV2?.panels.some((panel) =>
        panel.sourceKind === "ordinary_skill"
        && panel.ordinarySource.itemId === "story-skill"), "reader must preserve v1 while loading the verified v2 ordinary panel");
    assert(loaded.content.builtInDomainSkills.length === 0, "snapshots compiled without a built-in domain request must stay legacy");
    assert(!await containsSensitiveText(workspace.resolve("adventures/adventure_demo")), "snapshot must not contain credential-like data");

    const characterCompiled = await compileContentSnapshot({
      ...compileOptions,
      adventureId: "adventure_character_facade",
      contentProfileId: "content_profile_character_facade",
      snapshotLockId: "snapshot_character_facade",
      builtInDomainSkillIds: ["characters"],
    });
    assert(characterCompiled.profile.features.includes("built-in-domain-skill-io-v1"), "new Character facade snapshot must declare its feature");
    assert(characterCompiled.profile.builtInDomainSkills?.[0]?.skillId === "characters", "new Character facade snapshot must lock the Character Skill identity");
    assert(characterCompiled.lock.files.filter((file) => file.relativePath.startsWith("built-in-skills/characters/")).length === 3, "Character companion, grant, and lock must all be tracked snapshot files");
    const characterLoaded = await readContentSnapshot({ adventuresRoot, adventureId: "adventure_character_facade" });
    assert(characterLoaded.content.builtInDomainSkills[0].companion.actions.length === 5, "Reader must verify and load all five Character actions");
    assert(characterLoaded.content.skillPanelsV2.panels.some((panel) =>
      panel.sourceKind === "built_in_domain"
      && panel.domainSource.skillId === "characters"), "v2 presentation must lock the selected built-in domain panel identity");

    await compileContentSnapshot({
      ...compileOptions,
      adventureId: "adventure_character_facade_tamper",
      contentProfileId: "content_profile_character_facade_tamper",
      snapshotLockId: "snapshot_character_facade_tamper",
      builtInDomainSkillIds: ["characters"],
    });
    const characterGrant = workspace.resolve("adventures/adventure_character_facade_tamper/content-snapshot/built-in-skills/characters/grant.json");
    await fs.chmod(characterGrant, 0o600);
    await fs.appendFile(characterGrant, "tampered\n", "utf8");
    await assertRejects("SNAPSHOT_FILE_INVALID", () => readContentSnapshot({
      adventuresRoot,
      adventureId: "adventure_character_facade_tamper",
    }));

    await compileContentSnapshot({
      ...compileOptions,
      adventureId: "adventure_panel_v2_tamper",
      contentProfileId: "content_profile_panel_v2_tamper",
      snapshotLockId: "snapshot_panel_v2_tamper",
    });
    const panelV2Tamper = workspace.resolve("adventures/adventure_panel_v2_tamper/content-snapshot/skill-panels-v2.lock.json");
    await tamperTrackedFile(panelV2Tamper);
    await assertRejects("SNAPSHOT_HASH_MISMATCH", () => readContentSnapshot({
      adventuresRoot,
      adventureId: "adventure_panel_v2_tamper",
    }));

    await compileContentSnapshot({
      ...compileOptions,
      adventureId: "adventure_panel_v2_missing",
      contentProfileId: "content_profile_panel_v2_missing",
      snapshotLockId: "snapshot_panel_v2_missing",
    });
    const panelV2MissingRoot = workspace.resolve("adventures/adventure_panel_v2_missing/content-snapshot");
    await makeTreeWritableForFixture(panelV2MissingRoot);
    await fs.rm(path.join(panelV2MissingRoot, "skill-panels-v2.lock.json"));
    await assertRejects("SNAPSHOT_FILE_INVALID", () => readContentSnapshot({
      adventuresRoot,
      adventureId: "adventure_panel_v2_missing",
    }));

    await compileContentSnapshot({
      ...compileOptions,
      adventureId: "adventure_panel_v2_higher",
      contentProfileId: "content_profile_panel_v2_higher",
      snapshotLockId: "snapshot_panel_v2_higher",
    });
    await rewritePanelV2SchemaVersion(
      workspace.resolve("adventures/adventure_panel_v2_higher"),
      "grey-crow-skill-panel-presentation-v3"
    );
    await assertRejects("CONTRACT_INVALID", () => readContentSnapshot({
      adventuresRoot,
      adventureId: "adventure_panel_v2_higher",
    }));

    await compileContentSnapshot({
      ...compileOptions,
      adventureId: "adventure_legacy",
      contentProfileId: "content_profile_legacy",
      snapshotLockId: "snapshot_legacy",
    });
    const legacyProfilePath = workspace.resolve("adventures/adventure_legacy/content-profile.json");
    const legacyProfile = JSON.parse(await fs.readFile(legacyProfilePath, "utf8"));
    delete legacyProfile.newGameSkill;
    await fs.chmod(legacyProfilePath, 0o600);
    await fs.writeFile(legacyProfilePath, `${JSON.stringify(legacyProfile, null, 2)}\n`, "utf8");
    await fs.chmod(legacyProfilePath, 0o400);
    await assertRejects(
      "SNAPSHOT_NEW_GAME_SKILL_REQUIRED",
      () => readContentSnapshot({ adventuresRoot, adventureId: "adventure_legacy" }),
    );

    await compileContentSnapshot({
      ...compileOptions,
      adventureId: "adventure_size_limit",
      contentProfileId: "content_profile_size_limit",
      snapshotLockId: "snapshot_size_limit",
    });
    await declareOversizedSnapshot(workspace.resolve("adventures/adventure_size_limit"));
    await assertRejects(
      "SNAPSHOT_SIZE_LIMIT",
      () => readContentSnapshot({ adventuresRoot, adventureId: "adventure_size_limit" }),
    );

    await compileContentSnapshot({
      ...compileOptions,
      adventureId: "adventure_pre_d2",
      contentProfileId: "content_profile_pre_d2",
      snapshotLockId: "snapshot_pre_d2",
    });
    await convertToPreD2Snapshot(workspace.resolve("adventures/adventure_pre_d2"));
    await addGlobalModuleToSnapshotPack(workspace, "packs/story-pack");
    const preD2Loaded = await readContentSnapshot({ adventuresRoot, adventureId: "adventure_pre_d2" });
    assert(preD2Loaded.content.skillPanels === null, "a real pre-D2 snapshot must remain panel-free");
    assert(preD2Loaded.content.skillPanelsV2 === null, "a real pre-D2 snapshot must remain v2-panel-free");
    assert(preD2Loaded.content.skills[0].module === null, "Reader must not backfill a module from the updated global Pack");
    assert(!Object.prototype.hasOwnProperty.call(preD2Loaded.profile, "features"), "Reader must preserve the pre-D2 feature shape");

    await fs.writeFile(workspace.resolve("packs/story-pack/host/HOST.md"), "# Changed global Host\n", "utf8");
    await fs.rm(packRoot, { recursive: true, force: true });
    const afterGlobalRemoval = await readContentSnapshot({ adventuresRoot, adventureId: "adventure_demo" });
    assert(afterGlobalRemoval.lock.overallHash === originalHash, "global Pack updates or removal must not alter an existing snapshot");
    assert(afterGlobalRemoval.content.host === loaded.content.host, "Continue must not fall back to the global content library");

    const hostSnapshot = workspace.resolve("adventures/adventure_demo/content-snapshot/host/host.md");
    await fs.chmod(hostSnapshot, 0o600);
    const tamperedHost = await fs.readFile(hostSnapshot);
    tamperedHost[0] = tamperedHost[0] === 0x23 ? 0x21 : 0x23;
    await fs.writeFile(hostSnapshot, tamperedHost);
    await assertRejects("SNAPSHOT_HASH_MISMATCH", () => readContentSnapshot({ adventuresRoot, adventureId: "adventure_demo" }));

    await writeSnapshotPack(workspace, "packs/secret-pack", {
      packId: "secret-pack",
      hostBody: "# Host\n\nCredential sk-test-secret-123456 must never enter a snapshot.\n",
    });
    const secretRoot = workspace.resolve("packs/secret-pack");
    const secretValidated = await validatePackV2(secretRoot, { trustedRoot: packsRoot });
    const secretPlan = resolveContentPlan({
      packs: [secretValidated],
      selection: {
        host: { packId: "secret-pack", itemId: "story-host" },
        world: { packId: "secret-pack", itemId: "story-world" },
        newGameSkill: { packId: "secret-pack", itemId: "story-new-game" },
        skills: [],
      },
    });
    await assertRejects("SNAPSHOT_SECRET_REJECTED", () => compileContentSnapshot({
      adventuresRoot,
      adventureId: "adventure_secret",
      plan: secretPlan,
      packRoots: { "secret-pack": secretRoot },
      clock: () => "2026-07-14T00:00:00.000Z",
    }));
    assert(!await exists(workspace.resolve("adventures/adventure_secret")), "failed compilation must not publish a partial adventure");
    const leftovers = (await fs.readdir(adventuresRoot)).filter((name) => name.startsWith(".adventure_secret-content-"));
    assert(leftovers.length === 0, "failed compilation must remove temporary snapshot directories");

    await checkVisiblePlayerOwnedModule({ workspace, adventuresRoot, packsRoot });
    await checkCreatorSelectedPanelSurfaces({ workspace, adventuresRoot, packsRoot });
    await checkSameVersionModuleChanges({ workspace, adventuresRoot, packsRoot });
    await checkImportedReadonlyModule({ workspace, adventuresRoot, packsRoot });
    await checkHiddenModuleOwnership({ workspace, adventuresRoot, packsRoot });
    await checkLocalizedSkillSnapshot({ workspace, adventuresRoot, packsRoot });

    return {
      name: "p2-23-snapshot-compiler",
      ok: true,
      details: {
        contracts_validated: true,
        atomic_publish: true,
        normalized_host_world_skill: true,
        pack_removal_does_not_change_snapshot: true,
        legacy_snapshot_rejected_explicitly: true,
        tamper_rejected: true,
        credential_like_content_rejected: true,
        failed_compile_cleaned: true,
        visible_player_owned_module_locked: true,
        creator_panel_surfaces_locked: true,
        creator_panel_continue_stable: true,
        module_grant_recomputed: true,
        stateless_skill_panel_locked: true,
        module_snapshot_tamper_rejected: true,
        reader_verified_bytes_toctou_closed: true,
        snapshot_size_limit_enforced: true,
        same_version_module_changes_rejected: true,
        imported_readonly_module_rejected: true,
        hidden_module_ownership_enforced: true,
        hidden_module_fields_rejected: true,
        pre_d2_snapshot_compatible_without_backfill: true,
        localized_skill_bundle_locked: true,
        source_only_skill_locale_preserved: true,
        localized_snapshot_tamper_rejected: true,
        skill_io_companion_locked: true,
        stateless_skill_io_locked: true,
        skill_io_capability_review_locked: true,
        skill_io_snapshot_tamper_rejected: true,
        built_in_character_facade_locked: true,
        built_in_character_snapshot_tamper_rejected: true,
        skill_panel_v2_locked_additively: true,
        skill_panel_v2_tamper_rejected: true,
        skill_panel_v2_missing_rejected: true,
        skill_panel_v2_higher_version_rejected: true,
      },
    };
  }, { prefix: "p2-23-snapshot-compiler" });
}

async function writeSnapshotPack(workspace, relativeRoot, options) {
  const packId = options.packId;
  const provides = [
    {
      type: "host", id: "story-host", title: "Story Host", path: "host/HOST.md",
      language: "zh-CN", description: "Snapshot Host fixture.", danger: "low",
    },
    {
      type: "world", id: "story-world", title: "Story World", path: "world/WORLD.md",
      language: "zh-CN", description: "Snapshot World fixture.", danger: "low",
    },
    {
      type: "skill", skillClass: "new_game", id: "story-new-game", title: "Story New Game", path: "skills/new-game/SKILL.md",
      language: "zh-CN", description: "New Game fixture.", danger: "medium", triggers: ["ui_start_new_game"],
      templates: [], readScopes: ["state", "world"], writeScopes: ["state", "timeline"],
    },
    {
      type: "skill", skillClass: "ordinary", id: "story-skill", title: "Story Skill", path: "skills/story/SKILL.md",
      language: "zh-CN", description: "Snapshot Skill fixture.", danger: "low", triggers: ["story"],
      templates: ["skills/story/templates/note.md"], readScopes: ["memory"], writeScopes: [],
    },
  ];
  if (options.localized) {
    provides[3].localization = {
      schemaVersion: "grey-crow-skill-localization-ref-v1",
      path: "skills/story/localizations.json",
    };
  }
  await workspace.writeJson(`${relativeRoot}/manifest.json`, {
    schemaVersion: "grey-crow-extension-pack-v2",
    id: packId,
    title: "Snapshot Fixture Pack",
    version: options.localized ? "2.2.0" : "2.0.0",
    author: "Grey Crow Tests",
    engineCompatibility: options.localized ? ">=2.2 <3" : ">=2 <3",
    languages: options.localized ? ["zh-CN", "en-US"] : ["zh-CN"],
    provides,
    permissions: ["read_base_content", "write_current_saveRoot_via_tools"],
    conflicts: [],
  });
  await workspace.writeText(`${relativeRoot}/host/HOST.md`, options.hostBody || "# Fixture Host\n");
  await workspace.writeText(`${relativeRoot}/world/WORLD.md`, "# Fixture World\n");
  await workspace.writeText(`${relativeRoot}/skills/new-game/SKILL.md`, "# Fixture New Game Skill\n");
  await workspace.writeText(`${relativeRoot}/skills/story/SKILL.md`, "# Fixture Skill\n");
  await workspace.writeText(`${relativeRoot}/skills/story/templates/note.md`, "# Fixture Template\n\nTemplate ID: `template:note`\n");
  if (options.localized) {
    await workspace.writeJson(`${relativeRoot}/skills/story/localizations.json`, {
      schemaVersion: "grey-crow-skill-localization-bundle-v1",
      itemId: "story-skill",
      sourceLocale: "zh-CN",
      locales: [{
        locale: "en-US",
        title: "Story Skill",
        description: "Uses frozen story notes when the current scene calls for them.",
        triggers: ["story", "recall a story note"],
        playerGuide: null,
        skillPath: "skills/story/locales/en-US/SKILL.md",
        templates: [{
          templateId: "template:note",
          path: "skills/story/locales/en-US/templates/note.md",
        }],
        modulePresentationPath: null,
      }],
    });
    await workspace.writeText(`${relativeRoot}/skills/story/locales/en-US/SKILL.md`, "# Story Skill\n\nUse frozen story notes when the current scene calls for them.\n");
    await workspace.writeText(`${relativeRoot}/skills/story/locales/en-US/templates/note.md`, "# Story Note\n\nTemplate ID: `template:note`\n");
  }
}

async function checkLocalizedSkillSnapshot({ workspace, adventuresRoot, packsRoot }) {
  const packId = "localized-story-pack";
  const relativeRoot = `packs/${packId}`;
  await writeSnapshotPack(workspace, relativeRoot, { packId, localized: true });
  const packRoot = workspace.resolve(relativeRoot);
  const validated = await validatePackV2(packRoot, { trustedRoot: packsRoot, ownership: "player_owned" });
  const plan = resolveContentPlan({
    packs: [validated],
    selection: {
      host: { packId, itemId: "story-host" },
      world: { packId, itemId: "story-world" },
      newGameSkill: { packId, itemId: "story-new-game" },
      skills: [{ packId, itemId: "story-skill" }],
    },
  });
  const compiled = await compileContentSnapshot({
    adventuresRoot,
    adventureId: "adventure_localized",
    contentProfileId: "content_profile_localized",
    snapshotLockId: "snapshot_localized",
    language: "zh-CN",
    plan,
    packRoots: { [packId]: packRoot },
    clock: () => "2026-07-17T08:00:00.000Z",
  });
  assert(compiled.profile.features.includes("skill-localization-v1"), "localized snapshot must declare the Skill localization feature");
  assert(compiled.lock.skillLocalization?.relativePath === "skill-localizations.lock.json", "localized snapshot must lock one aggregate localization file");
  assert(compiled.lock.files.some((file) => file.relativePath === "skills/story-skill/locales/en-US/SKILL.md"), "translated Skill body must enter the tracked snapshot files");
  const loaded = await readContentSnapshot({ adventuresRoot, adventureId: "adventure_localized" });
  const localization = loaded.content.skillLocalizations;
  assert(localization?.skills.length === 2, "localization lock must cover the New Game Skill and every selected ordinary Skill");
  const newGameLock = localization.skills.find((skill) => skill.itemId === "story-new-game");
  const storyLock = localization.skills.find((skill) => skill.itemId === "story-skill");
  assert(newGameLock?.locales.length === 1 && newGameLock.locales[0].locale === "zh-CN", "untranslated selected Skills must remain explicit source-only entries");
  assert(storyLock?.locales.map((entry) => entry.locale).join(",") === "zh-CN,en-US", "localized Skill must preserve source and translated locale resources under one stable identity");

  const translatedBody = workspace.resolve("adventures/adventure_localized/content-snapshot/skills/story-skill/locales/en-US/SKILL.md");
  await fs.chmod(translatedBody, 0o600);
  await fs.appendFile(translatedBody, "tampered\n", "utf8");
  await assertRejects("SNAPSHOT_FILE_INVALID", () => readContentSnapshot({ adventuresRoot, adventureId: "adventure_localized" }));
}

async function checkVisiblePlayerOwnedModule({ workspace, adventuresRoot, packsRoot }) {
  const packId = "visible-module-pack";
  const relativeRoot = `packs/${packId}`;
  const fixture = await writeModuleSnapshotPack(workspace, relativeRoot, {
    packId,
    visibility: "visible",
    skillIO: true,
  });
  const packRoot = workspace.resolve(relativeRoot);
  const plan = await resolveModulePlan({ packRoot, packsRoot, packId, ownership: "player_owned" });
  const compile = (adventureId) => compileContentSnapshot({
    adventuresRoot,
    adventureId,
    language: "zh-CN",
    plan,
    packRoots: { [packId]: packRoot },
    clock: () => "2026-07-14T00:00:00.000Z",
  });
  const compiled = await compile("adventure_module_demo");
  await compile("adventure_module_tamper");
  await compile("adventure_panel_tamper");
  await compile("adventure_reader_verified_bytes");
  await compile("adventure_skill_io_tamper");

  const profileModuleItem = compiled.profile.skills.find((item) => item.itemId === fixture.moduleSkillId);
  const lockModuleItem = compiled.lock.items.find((item) => item.itemId === fixture.moduleSkillId);
  assert(profileModuleItem?.skillModule, "visible player-owned module must enter the content profile");
  assert(lockModuleItem?.skillModule, "visible player-owned module must enter the snapshot lock");
  assertJsonEqual(profileModuleItem.skillModule, lockModuleItem.skillModule, "profile and lock must freeze the same module grant");
  assertJsonEqual(profileModuleItem.skillModule.grant.writableFields, [
    { fieldId: "progress", operations: ["set"] },
  ], "module grant must include only modelWritable fields");
  assert(!profileModuleItem.skillModule.grant.writableFields.some((field) => field.fieldId === "note"), "read-only module fields must not receive write capability");
  assert(compiled.profile.features.includes("skill-module-v1")
    && compiled.profile.features.includes("skill-panel-presentation-v1")
    && compiled.profile.features.includes("skill-io-companion-v1"), "module snapshot must advertise module, companion and panel features");
  assert(compiled.profile.moduleReviewHash === compiled.lock.moduleReviewHash
    && /^[a-f0-9]{64}$/.test(compiled.profile.moduleReviewHash || ""), "writable module review hash must be frozen in profile and lock");
  assert(compiled.lock.files.some((file) => file.relativePath === `skills/${fixture.moduleSkillId}/module.json`), "module definition must be tracked by the snapshot lock");
  assert(compiled.lock.files.some((file) => file.relativePath === `skills/${fixture.moduleSkillId}/skill-io.json`)
    && compiled.lock.files.some((file) => file.relativePath === `skills/${fixture.statelessSkillId}/skill-io.json`), "stateful and stateless companions must both be tracked by the snapshot lock");
  assert(compiled.lock.files.some((file) => file.relativePath === "skill-panels.lock.json"), "Skill panel presentation must be tracked by the snapshot lock");

  const adventureRoot = workspace.resolve("adventures/adventure_module_demo");
  const snapshotRoot = path.join(adventureRoot, "content-snapshot");
  const lockedDefinition = JSON.parse(await fs.readFile(path.join(snapshotRoot, `skills/${fixture.moduleSkillId}/module.json`), "utf8"));
  assertJsonEqual(lockedDefinition, fixture.definition, "snapshot must freeze the validated module definition");
  const lockedPanels = JSON.parse(await fs.readFile(path.join(snapshotRoot, "skill-panels.lock.json"), "utf8"));
  const modulePanel = lockedPanels.panels.find((panel) => panel.itemId === fixture.moduleSkillId);
  const statelessPanel = lockedPanels.panels.find((panel) => panel.itemId === fixture.statelessSkillId);
  assert(modulePanel?.hasModule === true
    && modulePanel.moduleRef === profileModuleItem.skillModule.moduleRef
    && modulePanel.visibility === "visible", "visible module panel must be bound to the locked module identity");
  assert(statelessPanel?.hasModule === false
    && statelessPanel.moduleRef === null
    && statelessPanel.visibility === null, "ordinary Skill without a module must still receive a stateless panel");
  await assertNoModuleStateDirectory(adventureRoot);

  const loaded = await readContentSnapshot({ adventuresRoot, adventureId: "adventure_module_demo" });
  const loadedModuleSkill = loaded.content.skills.find((skill) => skill.id === fixture.moduleSkillId);
  const loadedStatelessSkill = loaded.content.skills.find((skill) => skill.id === fixture.statelessSkillId);
  assertJsonEqual(loadedModuleSkill?.module?.definition, fixture.definition, "Reader must return the locked module definition");
  assertJsonEqual(loadedModuleSkill?.module?.grant, profileModuleItem.skillModule.grant, "Reader must recompute the same bounded grant from the definition");
  assert(loadedModuleSkill.module.grant !== profileModuleItem.skillModule.grant, "Reader must return its independently recomputed grant");
  assertJsonEqual(loadedModuleSkill?.skillIO?.companion, fixture.companion, "Reader must return the locked stateful companion");
  assert(profileModuleItem.skillIO?.moduleRef === profileModuleItem.skillModule.moduleRef
    && profileModuleItem.skillIO.namespace === fixture.companion.namespace, "stateful companion lock must bind its module and hidden namespace");
  const statelessProfileItem = compiled.profile.skills.find((item) => item.itemId === fixture.statelessSkillId);
  assert(loadedStatelessSkill?.module === null
    && loadedStatelessSkill?.skillIO?.companion.defaultView === "guide"
    && statelessProfileItem?.skillIO?.moduleRef === null
    && statelessProfileItem.skillIO.actionIds.length === 0, "Reader must preserve a guide-only companion without inventing module state");
  const prepared = prepareSkillModuleSnapshot(plan);
  const reviewed = prepared.capabilityReview?.modules.find((entry) => entry.moduleRef === profileModuleItem.skillModule.moduleRef);
  assert(reviewed?.writeSummary.includes("推进进度")
    && reviewed?.readSummary.includes("guide")
    && reviewed.readSummary.includes("overview"), "capability review must summarize generated semantic actions and fixed read views");
  await assertReaderUsesVerifiedBytes({
    workspace,
    adventuresRoot,
    adventureId: "adventure_reader_verified_bytes",
    fixture,
  });

  await fs.rm(packRoot, { recursive: true, force: true });
  const afterGlobalRemoval = await readContentSnapshot({ adventuresRoot, adventureId: "adventure_module_demo" });
  const moduleAfterRemoval = afterGlobalRemoval.content.skills.find((skill) => skill.id === fixture.moduleSkillId)?.module;
  assertJsonEqual(moduleAfterRemoval?.definition, fixture.definition, "module snapshot must remain readable after deleting its global Pack");
  assertJsonEqual(moduleAfterRemoval?.grant, profileModuleItem.skillModule.grant, "module grant must remain readable after deleting its global Pack");

  await tamperTrackedFile(workspace.resolve(`adventures/adventure_module_tamper/content-snapshot/skills/${fixture.moduleSkillId}/module.json`));
  await assertRejects(
    "SNAPSHOT_HASH_MISMATCH",
    () => readContentSnapshot({ adventuresRoot, adventureId: "adventure_module_tamper" }),
  );
  await tamperTrackedFile(workspace.resolve(`adventures/adventure_skill_io_tamper/content-snapshot/skills/${fixture.moduleSkillId}/skill-io.json`));
  await assertRejects(
    "SNAPSHOT_HASH_MISMATCH",
    () => readContentSnapshot({ adventuresRoot, adventureId: "adventure_skill_io_tamper" }),
  );
  await tamperTrackedFile(workspace.resolve("adventures/adventure_panel_tamper/content-snapshot/skill-panels.lock.json"));
  await assertRejects(
    "SNAPSHOT_HASH_MISMATCH",
    () => readContentSnapshot({ adventuresRoot, adventureId: "adventure_panel_tamper" }),
  );
}

async function checkCreatorSelectedPanelSurfaces({ workspace, adventuresRoot, packsRoot }) {
  for (const surface of ["list_detail", "timeline"]) {
    const packId = `creator-${surface.replace("_", "-")}-pack`;
    const relativeRoot = `packs/${packId}`;
    const definition = buildCreatorRecordDefinition(surface === "timeline" ? "timeline" : "cards");
    const fixture = await writeModuleSnapshotPack(workspace, relativeRoot, {
      packId,
      visibility: "visible",
      definition,
    });
    const packRoot = workspace.resolve(relativeRoot);
    const plan = await resolveModulePlan({ packRoot, packsRoot, packId, ownership: "player_owned" });
    const adventureId = `adventure_creator_${surface}`;
    await compileContentSnapshot({
      adventuresRoot,
      adventureId,
      language: "zh-CN",
      plan,
      packRoots: { [packId]: packRoot },
      clock: () => "2026-07-25T00:00:00.000Z",
    });
    const first = await readContentSnapshot({ adventuresRoot, adventureId });
    const second = await readContentSnapshot({ adventuresRoot, adventureId });
    const firstPanel = first.content.skillPanelsV2.panels.find((panel) =>
      panel.sourceKind === "ordinary_skill"
      && panel.ordinarySource.itemId === fixture.moduleSkillId);
    const secondPanel = second.content.skillPanelsV2.panels.find((panel) =>
      panel.sourceKind === "ordinary_skill"
      && panel.ordinarySource.itemId === fixture.moduleSkillId);
    assert(firstPanel?.surface === surface
      && firstPanel.ownership === "player_owned"
      && firstPanel.group === "player_extensions", `Creator ${surface} choice must compile into the existing bounded v2 presentation`);
    assert(secondPanel?.panelRef === firstPanel.panelRef
      && secondPanel.surface === firstPanel.surface, `Creator ${surface} panel identity and surface must remain stable after Continue`);
  }
}

async function checkSameVersionModuleChanges({ workspace, adventuresRoot, packsRoot }) {
  const modulePackId = "stale-module-pack";
  const moduleRelativeRoot = `packs/${modulePackId}`;
  const moduleFixture = await writeModuleSnapshotPack(workspace, moduleRelativeRoot, {
    packId: modulePackId,
    visibility: "visible",
  });
  const modulePackRoot = workspace.resolve(moduleRelativeRoot);
  const modulePlan = await resolveModulePlan({
    packRoot: modulePackRoot,
    packsRoot,
    packId: modulePackId,
    ownership: "player_owned",
  });
  const moduleManifestBefore = JSON.parse(await fs.readFile(path.join(modulePackRoot, "manifest.json"), "utf8"));
  const changedDefinition = JSON.parse(JSON.stringify(moduleFixture.definition));
  changedDefinition.fields.find((field) => field.id === "progress").maximum += 1;
  await writeJson(path.join(modulePackRoot, moduleFixture.moduleRelativePath), changedDefinition);
  const moduleManifestAfter = JSON.parse(await fs.readFile(path.join(modulePackRoot, "manifest.json"), "utf8"));
  assert(moduleManifestAfter.version === moduleManifestBefore.version, "module stale fixture must keep the Pack version unchanged");
  await assertRejects("SNAPSHOT_SOURCE_CHANGED", () => compileContentSnapshot({
    adventuresRoot,
    adventureId: "adventure_module_stale",
    plan: modulePlan,
    packRoots: { [modulePackId]: modulePackRoot },
    clock: () => "2026-07-14T00:00:00.000Z",
  }));
  await assertNoPartialAdventure(adventuresRoot, "adventure_module_stale");

  const guidePackId = "stale-guide-pack";
  const guideRelativeRoot = `packs/${guidePackId}`;
  await writeModuleSnapshotPack(workspace, guideRelativeRoot, {
    packId: guidePackId,
    visibility: "visible",
  });
  const guidePackRoot = workspace.resolve(guideRelativeRoot);
  const guidePlan = await resolveModulePlan({
    packRoot: guidePackRoot,
    packsRoot,
    packId: guidePackId,
    ownership: "player_owned",
  });
  const guideManifestPath = path.join(guidePackRoot, "manifest.json");
  const changedManifest = JSON.parse(await fs.readFile(guideManifestPath, "utf8"));
  const unchangedVersion = changedManifest.version;
  changedManifest.provides.find((item) => item.id === "module-skill").playerGuide += " Updated without a version bump.";
  await writeJson(guideManifestPath, changedManifest);
  assert(JSON.parse(await fs.readFile(guideManifestPath, "utf8")).version === unchangedVersion, "playerGuide stale fixture must keep the Pack version unchanged");
  await assertRejects("SNAPSHOT_ITEM_CHANGED", () => compileContentSnapshot({
    adventuresRoot,
    adventureId: "adventure_guide_stale",
    plan: guidePlan,
    packRoots: { [guidePackId]: guidePackRoot },
    clock: () => "2026-07-14T00:00:00.000Z",
  }));
  await assertNoPartialAdventure(adventuresRoot, "adventure_guide_stale");
}

async function checkImportedReadonlyModule({ workspace, adventuresRoot, packsRoot }) {
  const packId = "imported-module-pack";
  const relativeRoot = `packs/${packId}`;
  await writeModuleSnapshotPack(workspace, relativeRoot, {
    packId,
    visibility: "visible",
  });
  const packRoot = workspace.resolve(relativeRoot);
  const plan = await resolveModulePlan({
    packRoot,
    packsRoot,
    packId,
    ownership: "imported_readonly",
  });
  await assertRejects("SKILL_MODULE_OWNERSHIP_FORBIDDEN", () => compileContentSnapshot({
    adventuresRoot,
    adventureId: "adventure_imported_module",
    plan,
    packRoots: { [packId]: packRoot },
    clock: () => "2026-07-14T00:00:00.000Z",
  }));
  await assertNoPartialAdventure(adventuresRoot, "adventure_imported_module");
}

async function checkHiddenModuleOwnership({ workspace, adventuresRoot, packsRoot }) {
  const packId = "hidden-module-pack";
  const relativeRoot = `packs/${packId}`;
  const fixture = await writeModuleSnapshotPack(workspace, relativeRoot, {
    packId,
    visibility: "hidden_until_active",
  });
  const packRoot = workspace.resolve(relativeRoot);
  const playerOwnedPlan = await resolveModulePlan({
    packRoot,
    packsRoot,
    packId,
    ownership: "player_owned",
  });
  await assertRejects("SKILL_MODULE_HIDDEN_OWNERSHIP_FORBIDDEN", () => compileContentSnapshot({
    adventuresRoot,
    adventureId: "adventure_hidden_player_owned",
    plan: playerOwnedPlan,
    packRoots: { [packId]: packRoot },
    clock: () => "2026-07-14T00:00:00.000Z",
  }));
  await assertNoPartialAdventure(adventuresRoot, "adventure_hidden_player_owned");

  const builtInPlan = await resolveModulePlan({
    packRoot,
    packsRoot,
    packId,
    ownership: "built_in",
  });
  const compiled = await compileContentSnapshot({
    adventuresRoot,
    adventureId: "adventure_hidden_builtin",
    plan: builtInPlan,
    packRoots: { [packId]: packRoot },
    clock: () => "2026-07-14T00:00:00.000Z",
  });
  const moduleItem = compiled.profile.skills.find((item) => item.itemId === fixture.moduleSkillId);
  assert(moduleItem?.skillModule?.grant.writableFields.length === 0, "hidden built-in lifecycle module must lock an empty write grant");
  assert(!Object.prototype.hasOwnProperty.call(compiled.profile, "moduleReviewHash")
    && !Object.prototype.hasOwnProperty.call(compiled.lock, "moduleReviewHash"), "read-only hidden built-in module must not create a capability review hash");
  const loaded = await readContentSnapshot({ adventuresRoot, adventureId: "adventure_hidden_builtin" });
  const loadedModule = loaded.content.skills.find((skill) => skill.id === fixture.moduleSkillId)?.module;
  const panel = loaded.content.skillPanels.panels.find((entry) => entry.itemId === fixture.moduleSkillId);
  assert(loadedModule?.definition.visibility === "hidden_until_active"
    && loadedModule.definition.fields.length === 0
    && loadedModule.grant.writableFields.length === 0, "Reader must load the locked empty hidden built-in module");
  assert(panel?.hasModule === true
    && panel.visibility === "hidden_until_active"
    && panel.moduleRef === loadedModule.moduleRef, "hidden built-in panel must remain bound to its locked module");
  await assertNoModuleStateDirectory(workspace.resolve("adventures/adventure_hidden_builtin"));

  const nonEmptyPackId = "hidden-fields-pack";
  const nonEmptyRelativeRoot = `packs/${nonEmptyPackId}`;
  await writeModuleSnapshotPack(workspace, nonEmptyRelativeRoot, {
    packId: nonEmptyPackId,
    definition: buildHiddenNonEmptyModuleDefinition(),
  });
  const nonEmptyPackRoot = workspace.resolve(nonEmptyRelativeRoot);
  const nonEmptyBuiltInPlan = await resolveModulePlan({
    packRoot: nonEmptyPackRoot,
    packsRoot,
    packId: nonEmptyPackId,
    ownership: "built_in",
  });
  await assertRejects("SKILL_MODULE_HIDDEN_FIELDS_FORBIDDEN", () => compileContentSnapshot({
    adventuresRoot,
    adventureId: "adventure_hidden_fields",
    plan: nonEmptyBuiltInPlan,
    packRoots: { [nonEmptyPackId]: nonEmptyPackRoot },
    clock: () => "2026-07-14T00:00:00.000Z",
  }));
  await assertNoPartialAdventure(adventuresRoot, "adventure_hidden_fields");
}

async function writeModuleSnapshotPack(workspace, relativeRoot, options) {
  const moduleSkillId = "module-skill";
  const statelessSkillId = "stateless-skill";
  const moduleRelativePath = "skills/module/module.json";
  const moduleSkillIORelativePath = "skills/module/skill-io.json";
  const statelessSkillIORelativePath = "skills/stateless/skill-io.json";
  const definition = options.definition || (options.visibility === "hidden_until_active"
    ? buildHiddenModuleDefinition()
    : buildVisibleModuleDefinition());
  const companionFixture = options.skillIO ? buildSkillIOFixture() : null;
  if (companionFixture && hashCanonical(companionFixture.definition) !== hashCanonical(definition)) {
    throw new Error("Skill I/O fixture definition drifted from the module fixture");
  }
  await workspace.writeJson(`${relativeRoot}/manifest.json`, {
    schemaVersion: "grey-crow-extension-pack-v2",
    id: options.packId,
    title: "Module Snapshot Fixture Pack",
    version: options.skillIO ? "2.3.0" : "2.1.0",
    author: "Grey Crow Tests",
    engineCompatibility: options.skillIO ? ">=2.3 <3" : ">=2.1 <3",
    languages: ["zh-CN"],
    provides: [
      {
        type: "host", id: "module-host", title: "Module Host", path: "host/HOST.md",
        language: "zh-CN", description: "Module snapshot Host fixture.", danger: "low",
      },
      {
        type: "world", id: "module-world", title: "Module World", path: "world/WORLD.md",
        language: "zh-CN", description: "Module snapshot World fixture.", danger: "low",
      },
      {
        type: "skill", skillClass: "new_game", id: "module-new-game", title: "Module New Game", path: "skills/new-game/SKILL.md",
        language: "zh-CN", description: "Module snapshot New Game fixture.", danger: "medium", triggers: ["ui_start_new_game"],
        templates: [], readScopes: ["state", "world"], writeScopes: ["state", "timeline"],
      },
      {
        type: "skill", skillClass: "ordinary", id: moduleSkillId, title: "Module Skill", path: "skills/module/SKILL.md",
        language: "zh-CN", description: "Bounded module snapshot fixture.", danger: "low", triggers: ["module_fixture"],
        templates: [], readScopes: ["state"], writeScopes: [],
        playerGuide: "This Skill exposes a bounded local panel for the current story.",
        module: { schemaVersion: "grey-crow-skill-module-ref-v1", path: moduleRelativePath },
        ...(options.skillIO ? { skillIO: { schemaVersion: "grey-crow-skill-io-ref-v1", path: moduleSkillIORelativePath } } : {}),
      },
      {
        type: "skill", skillClass: "ordinary", id: statelessSkillId, title: "Stateless Skill", path: "skills/stateless/SKILL.md",
        language: "zh-CN", description: "Stateless panel fixture.", danger: "low", triggers: ["stateless_fixture"],
        templates: [], readScopes: [], writeScopes: [],
        ...(options.skillIO ? { skillIO: { schemaVersion: "grey-crow-skill-io-ref-v1", path: statelessSkillIORelativePath } } : {}),
      },
    ],
    permissions: ["read_base_content", "write_current_saveRoot_via_tools"],
    conflicts: [],
  });
  await workspace.writeText(`${relativeRoot}/host/HOST.md`, "# Module Fixture Host\n");
  await workspace.writeText(`${relativeRoot}/world/WORLD.md`, "# Module Fixture World\n");
  await workspace.writeText(`${relativeRoot}/skills/new-game/SKILL.md`, "# Module Fixture New Game Skill\n");
  await workspace.writeText(`${relativeRoot}/skills/module/SKILL.md`, "# Module Fixture Skill\n");
  await workspace.writeText(`${relativeRoot}/skills/stateless/SKILL.md`, "# Stateless Fixture Skill\n");
  await workspace.writeJson(`${relativeRoot}/${moduleRelativePath}`, definition);
  if (options.skillIO) {
    await workspace.writeJson(`${relativeRoot}/${moduleSkillIORelativePath}`, companionFixture.companion);
    await workspace.writeJson(`${relativeRoot}/${statelessSkillIORelativePath}`, buildStatelessSkillIOFixture());
  }
  return { definition, companion: companionFixture?.companion || null, moduleRelativePath, moduleSkillId, statelessSkillId };
}

function buildSkillIOFixture() {
  const normalized = normalizeSkillModuleCreatorDraft({
    schemaVersion: "grey-crow-skill-module-creator-draft-v2",
    enabled: true,
    skillIOEnabled: true,
    namespace: "skillio_module_fixture",
    fields: [
      {
        id: "progress", label: "Progress", type: "integer", widget: "progress", modelWritable: true,
        showInSummary: true, views: ["overview"], hostAction: { id: "action_progress", label: "推进进度", behavior: "set_value" },
        minimum: 0, maximum: 10, default: 0, preview: 4,
      },
      {
        id: "note", label: "Locked note", type: "text", widget: "text", modelWritable: false,
        showInSummary: true, views: ["overview"], hostAction: null, maxLength: 80, default: "Ready", preview: "Ready",
      },
    ],
  }, { requireRoundTrip: true });
  return { definition: normalized.definition, companion: normalized.companion };
}

function buildStatelessSkillIOFixture() {
  return normalizeSkillModuleCreatorDraft({
    schemaVersion: "grey-crow-skill-module-creator-draft-v2",
    enabled: false,
    skillIOEnabled: true,
    namespace: "skillio_stateless_fixture",
    fields: [],
  }).companion;
}

function buildVisibleModuleDefinition() {
  return {
    schemaVersion: "grey-crow-skill-module-definition-v1",
    stateVersion: 1,
    visibility: "visible",
    summaryFields: ["progress", "note"],
    fields: [
      {
        id: "progress",
        label: "Progress",
        type: "integer",
        default: 0,
        minimum: 0,
        maximum: 10,
        modelWritable: true,
        allowedOperations: ["set"],
        display: { widget: "progress" },
      },
      {
        id: "note",
        label: "Locked note",
        type: "text",
        default: "Ready",
        maxLength: 80,
        modelWritable: false,
        allowedOperations: [],
        display: { widget: "text" },
      },
    ],
  };
}

function buildCreatorRecordDefinition(widget) {
  return normalizeSkillModuleCreatorDraft({
    schemaVersion: "grey-crow-skill-module-creator-draft-v1",
    enabled: true,
    fields: [{
      id: "entries",
      label: "Entries",
      type: "record_list",
      widget,
      modelWritable: true,
      showInSummary: true,
      maxItems: 20,
      collectionMode: "append_only",
      itemFields: [
        { id: "title", label: "Title", type: "text", maxLength: 120, preview: "First entry" },
        {
          id: "category",
          label: "Category",
          type: "enum",
          options: [{ id: "open", label: "Open" }, { id: "closed", label: "Closed" }],
          previewOptionIndex: 0,
        },
      ],
      previewRecordEnabled: true,
      summaryMode: "count",
      summaryTarget: null,
      milestones: [],
      groupCountItemIndex: 1,
    }],
  }, { requireRoundTrip: true }).definition;
}

function buildHiddenModuleDefinition() {
  return {
    schemaVersion: "grey-crow-skill-module-definition-v1",
    stateVersion: 1,
    visibility: "hidden_until_active",
    summaryFields: [],
    fields: [],
  };
}

function buildHiddenNonEmptyModuleDefinition() {
  const definition = buildVisibleModuleDefinition();
  definition.visibility = "hidden_until_active";
  definition.summaryFields = ["progress"];
  definition.fields = [definition.fields[0]];
  return definition;
}

async function resolveModulePlan({ packRoot, packsRoot, packId, ownership }) {
  const validated = await validatePackV2(packRoot, { trustedRoot: packsRoot, ownership });
  assert(validated.ownership === ownership, "validated Pack must preserve Engine-assigned ownership");
  return resolveContentPlan({
    packs: [validated],
    selection: {
      host: { packId, itemId: "module-host" },
      world: { packId, itemId: "module-world" },
      newGameSkill: { packId, itemId: "module-new-game" },
      skills: [
        { packId, itemId: "module-skill" },
        { packId, itemId: "stateless-skill" },
      ],
    },
  });
}

async function declareOversizedSnapshot(adventureRoot) {
  const lockPath = path.join(adventureRoot, "content-snapshot/manifest.lock.json");
  await fs.chmod(lockPath, 0o600);
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  for (let index = 0; index < 26; index += 1) {
    lock.files.push({
      relativePath: `oversized/chunk-${String(index).padStart(2, "0")}.md`,
      sha256: "0".repeat(64),
      sizeBytes: 10 * 1024 * 1024,
    });
  }
  await writeJson(lockPath, lock);
  await fs.chmod(lockPath, 0o400);
}

async function convertToPreD2Snapshot(adventureRoot) {
  const snapshotRoot = path.join(adventureRoot, "content-snapshot");
  const profilePath = path.join(adventureRoot, "content-profile.json");
  const lockPath = path.join(snapshotRoot, "manifest.lock.json");
  await makeTreeWritableForFixture(snapshotRoot);
  await fs.chmod(profilePath, 0o600);
  const profile = JSON.parse(await fs.readFile(profilePath, "utf8"));
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  const panelRelativePath = lock.skillPanelPresentation?.relativePath;
  const panelV2RelativePath = lock.skillPanelPresentationV2?.relativePath;
  assert(panelRelativePath === "skill-panels.lock.json", "pre-D2 conversion requires a tracked panel fixture");
  assert(panelV2RelativePath === "skill-panels-v2.lock.json", "pre-D2 conversion requires a tracked v2 panel fixture");
  lock.files = lock.files.filter((file) =>
    file.relativePath !== panelRelativePath && file.relativePath !== panelV2RelativePath);
  await fs.rm(path.join(snapshotRoot, panelRelativePath));
  await fs.rm(path.join(snapshotRoot, panelV2RelativePath));
  for (const value of [profile, lock]) {
    delete value.features;
    delete value.skillPanelPresentation;
    delete value.skillPanelPresentationV2;
    delete value.moduleReview;
    delete value.moduleReviewHash;
  }
  lock.overallHash = hashCanonical({ items: lock.items, files: lock.files });
  await writeJson(profilePath, profile);
  await writeJson(lockPath, lock);
  await makeTreeReadOnlyForFixture(snapshotRoot);
  await fs.chmod(profilePath, 0o400);
}

async function rewritePanelV2SchemaVersion(adventureRoot, schemaVersion) {
  const snapshotRoot = path.join(adventureRoot, "content-snapshot");
  const profilePath = path.join(adventureRoot, "content-profile.json");
  const lockPath = path.join(snapshotRoot, "manifest.lock.json");
  const panelPath = path.join(snapshotRoot, "skill-panels-v2.lock.json");
  await makeTreeWritableForFixture(snapshotRoot);
  await fs.chmod(profilePath, 0o600);
  const profile = JSON.parse(await fs.readFile(profilePath, "utf8"));
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  const presentation = JSON.parse(await fs.readFile(panelPath, "utf8"));
  presentation.schemaVersion = schemaVersion;
  const buffer = Buffer.from(`${JSON.stringify(presentation, null, 2)}\n`, "utf8");
  await fs.writeFile(panelPath, buffer);
  const sha256 = hashBuffer(buffer);
  profile.skillPanelPresentationV2.sha256 = sha256;
  lock.skillPanelPresentationV2.sha256 = sha256;
  const tracked = lock.files.find((file) => file.relativePath === "skill-panels-v2.lock.json");
  tracked.sha256 = sha256;
  tracked.sizeBytes = buffer.length;
  lock.overallHash = hashCanonical(snapshotHashBasisForFixture(lock));
  await writeJson(profilePath, profile);
  await writeJson(lockPath, lock);
  await makeTreeReadOnlyForFixture(snapshotRoot);
  await fs.chmod(profilePath, 0o400);
}

function snapshotHashBasisForFixture(lock) {
  return {
    features: lock.features,
    skillPanelPresentation: lock.skillPanelPresentation,
    skillPanelPresentationV2: lock.skillPanelPresentationV2,
    ...(lock.moduleReviewHash ? { moduleReviewHash: lock.moduleReviewHash } : {}),
    ...(lock.skillLocalization ? { skillLocalization: lock.skillLocalization } : {}),
    ...(lock.builtInDomainSkills ? { builtInDomainSkills: lock.builtInDomainSkills } : {}),
    items: lock.items,
    files: lock.files,
  };
}

async function addGlobalModuleToSnapshotPack(workspace, relativeRoot) {
  const manifestPath = workspace.resolve(`${relativeRoot}/manifest.json`);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.version = "2.1.0";
  manifest.engineCompatibility = ">=2.1 <3";
  const skill = manifest.provides.find((item) => item.id === "story-skill");
  skill.playerGuide = "This global-only update must not be backfilled into an existing snapshot.";
  skill.module = {
    schemaVersion: "grey-crow-skill-module-ref-v1",
    path: "skills/story/module.json",
  };
  await writeJson(manifestPath, manifest);
  await writeJson(workspace.resolve(`${relativeRoot}/skills/story/module.json`), buildVisibleModuleDefinition());
}

async function assertReaderUsesVerifiedBytes({ workspace, adventuresRoot, adventureId, fixture }) {
  const snapshotRoot = workspace.resolve(`adventures/${adventureId}/content-snapshot`);
  const modulePath = path.join(snapshotRoot, `skills/${fixture.moduleSkillId}/module.json`);
  const panelPath = path.join(snapshotRoot, "skill-panels.lock.json");
  const originalReaddir = fs.readdir;
  let replacedAfterVerification = false;
  fs.readdir = async (target, ...args) => {
    const entries = await originalReaddir(target, ...args);
    if (!replacedAfterVerification && path.resolve(target) === snapshotRoot) {
      replacedAfterVerification = true;
      await tamperTrackedFile(modulePath);
      await tamperTrackedFile(panelPath);
    }
    return entries;
  };
  let loaded;
  try {
    loaded = await readContentSnapshot({ adventuresRoot, adventureId });
  } finally {
    fs.readdir = originalReaddir;
  }
  assert(replacedAfterVerification, "Reader TOCTOU fixture must replace files after integrity verification");
  const loadedModule = loaded.content.skills.find((skill) => skill.id === fixture.moduleSkillId)?.module;
  const loadedPanel = loaded.content.skillPanels.panels.find((panel) => panel.itemId === fixture.moduleSkillId);
  assertJsonEqual(loadedModule?.definition, fixture.definition, "Reader must parse the module from the verified bytes, not a second disk read");
  assert(loadedPanel?.hasModule === true
    && loadedPanel.moduleRef === loadedModule.moduleRef
    && loadedPanel.visibility === fixture.definition.visibility, "Reader must parse the panel from the verified bytes, not a second disk read");
}

async function tamperTrackedFile(target) {
  await fs.chmod(target, 0o600);
  const value = await fs.readFile(target);
  assert(value.length > 0, "tamper fixture must target a non-empty file");
  value[0] ^= 0x01;
  await fs.writeFile(target, value);
}

async function assertNoPartialAdventure(adventuresRoot, adventureId) {
  assert(!await exists(path.join(adventuresRoot, adventureId)), "failed compilation must not publish a partial Adventure");
  const leftovers = (await fs.readdir(adventuresRoot)).filter((name) => name.startsWith(`.${adventureId}-content-`));
  assert(leftovers.length === 0, "failed compilation must remove its temporary snapshot directory");
}

async function assertNoModuleStateDirectory(adventureRoot) {
  assert(!await exists(path.join(adventureRoot, "modules")), "snapshot compilation must not create runtime module state");
  assert(!await exists(path.join(adventureRoot, "module-state")), "snapshot compilation must not create an alternate module state directory");
}

async function makeTreeWritableForFixture(target) {
  const stat = await fs.lstat(target);
  if (stat.isDirectory()) {
    await fs.chmod(target, 0o700);
    for (const entry of await fs.readdir(target)) {
      await makeTreeWritableForFixture(path.join(target, entry));
    }
    return;
  }
  await fs.chmod(target, 0o600);
}

async function makeTreeReadOnlyForFixture(target) {
  const stat = await fs.lstat(target);
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(target)) {
      await makeTreeReadOnlyForFixture(path.join(target, entry));
    }
    await fs.chmod(target, 0o500);
    return;
  }
  await fs.chmod(target, 0o400);
}

async function writeJson(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertJsonEqual(actual, expected, message) {
  assert(hashCanonical(actual) === hashCanonical(expected), message);
}

async function containsSensitiveText(root) {
  for (const relativePath of await listFiles(root, root)) {
    const value = await fs.readFile(path.join(root, relativePath), "utf8");
    if (/sk-[A-Za-z0-9_-]{8,}|Bearer\s+/i.test(value)) return true;
  }
  return false;
}

async function listFiles(root, current) {
  const out = [];
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(root, target));
    else if (entry.isFile()) out.push(path.relative(root, target));
  }
  return out;
}

async function assertRejects(code, callback) {
  try {
    await callback();
  } catch (error) {
    assert(error?.code === code, `expected ${code}, received ${error?.code || "unknown"}`);
    return;
  }
  throw new Error(`expected ${code}`);
}

async function exists(target) {
  return Boolean(await fs.lstat(target).catch(() => null));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

module.exports = { runSnapshotCompilerChecks };
