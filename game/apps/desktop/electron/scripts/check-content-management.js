#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDesktopContentManagement } = require("../content-management");

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}${error?.meta ? `\n${JSON.stringify(error.meta)}` : ""}\n`);
  process.exit(1);
});

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-content-management-"));
  try {
    const dataRoot = path.join(root, "data");
    const exportRoot = path.join(root, "exports");
    const contentRoot = path.resolve(__dirname, "../../../../content");
    const engineRoot = path.resolve(__dirname, "../../../../engine");
    const { normalizeSkillModuleCreatorDraft } = require(path.join(engineRoot, "content-v2"));
    await fs.mkdir(dataRoot, { recursive: true });
    await fs.mkdir(exportRoot, { recursive: true });
    const management = createDesktopContentManagement({
      dataRoot,
      contentRoot,
      engineRoot,
      clock: () => "2026-07-14T00:00:00.000Z",
    });

    const initial = await management.listContent();
    assert(initial.packs.length === 1, "content management must expose the built-in Pack");
    assert(initial.packs[0].ownership === "built_in" && initial.packs[0].activation === "active" && !initial.packs[0].editable, "built-in Pack must remain active and read-only");
    assert(initial.presets.length === 1 && initial.presets[0].ownership === "built_in", "content management must expose path-free story bundles");

    const profile = await management.loadPlayerProfile();
    const playerProfileId = profile.profile.playerProfileId;
    const savedProfile = await management.savePlayerProfile({
      fields: {
        preferredLanguage: "zh-CN",
        displayName: "测试玩家",
        pronouns: "她",
        narrativePreferences: ["保持克制"],
        contentBoundaries: ["不描写虐待"],
        notes: "跨冒险档案",
      },
    });
    assert(savedProfile.profile.playerProfileId === playerProfileId, "profile save must preserve the stable player id");
    assert(savedProfile.profile.displayName === "测试玩家", "profile save must persist explicit fields");

    const blankFixtures = [
      {
        kind: "host",
        title: "空白主持人",
        description: "由玩家从空白笔记开始编写的主持人规则。",
        markdown: "# 空白主持人\n\n保持冷静，只陈述角色能感知到的事实。",
      },
      {
        kind: "world",
        title: "空白世界",
        description: "由玩家从空白笔记开始编写的世界背景。",
        markdown: "# 空白世界\n\n这里记录世界规律和已知背景。",
      },
      {
        kind: "ordinary_skill",
        title: "空白玩法规则",
        description: "当主持人需要执行玩家自定义规则时读取这项玩法说明。",
        markdown: "# 空白玩法规则\n\n仅在相关情境出现时按需读取。",
        triggers: ["当玩家要求使用自定义规则时。"],
        playerGuide: "空白创建时一并保存的玩家说明。",
        moduleDraft: createCreatorModuleDraft(),
      },
      {
        kind: "ordinary_skill",
        title: "空白纯文本玩法规则",
        description: "用于验证玩家可以从纯文本玩法规则开始，再自行添加状态模块。",
        markdown: "# 空白纯文本玩法规则\n\n初始不挂载模块。",
        triggers: ["当玩家要求测试纯文本玩法规则时。"],
      },
      {
        kind: "ordinary_skill",
        title: "空白只读主持指南",
        description: "用于验证无状态 Skill 也能生成统一 guide companion 而不创建伪状态。",
        markdown: "# 空白只读主持指南\n\n仅通过统一 Skill 读取入口提供说明。",
        triggers: ["当玩家要求使用只读主持指南时。"],
        moduleDraft: {
          schemaVersion: "grey-crow-skill-module-creator-draft-v2",
          enabled: false,
          skillIOEnabled: true,
          namespace: null,
          fields: [],
        },
      },
      {
        kind: "new_game_skill",
        title: "空白开局流程",
        description: "从新游戏入口开始时按步骤确认玩家的开局锚点。",
        markdown: "# 空白开局流程\n\n逐步询问并复述确认开局信息。",
        triggers: ["hostile_renderer_trigger"],
      },
    ];
    const blankResults = [];
    for (const fixture of blankFixtures) {
      blankResults.push(await management.createBlankContent({
        ...fixture,
        language: "zh-CN",
        packId: "renderer-chosen-pack",
        itemId: "renderer-chosen-item",
        path: "/tmp/renderer-chosen-path",
        danger: "critical",
        readScopes: ["state"],
        writeScopes: ["state"],
        permissions: ["write_current_saveRoot_via_tools"],
      }));
    }
    const blankItems = blankResults.map((result) => result.item);
    assert(new Set(blankItems.map((item) => item.packId)).size === blankFixtures.length, "each blank content item must receive an independent generated Pack");
    assert(blankItems.every((item) => /^player-content-[a-f0-9]{24}$/.test(item.packId)), "blank content Pack IDs must be generated behind the desktop boundary");
    assert(blankItems.every((item) => item.danger === "low"), "blank content must start with the safe danger default");
    assert(blankItems.every((item) => item.technical?.schemaVersion === "grey-crow-content-technical-v1"), "blank content must return a structured safe technical projection");
    assert(blankItems.every((item) => item.technical.policy.manifestEditable === false
      && item.technical.policy.permissionsEditable === false
      && item.technical.policy.localPathsExposed === false), "technical projections must stay read-only and path-free");
    const blankOrdinarySkill = blankItems.find((item) => item.skillClass === "ordinary");
    const blankTextOnlySkill = blankItems.find((item) => item.skillClass === "ordinary" && item.module?.enabled === false);
    const blankGuideSkill = blankItems.find((item) => item.module?.creatorSupport === "editable_v2");
    const blankNewGameSkill = blankItems.find((item) => item.skillClass === "new_game");
    assert(blankOrdinarySkill?.triggers.join("") === "当玩家要求使用自定义规则时。", "ordinary blank Skills may keep the authored trigger hint");
    assert(blankOrdinarySkill?.readScopes.length === 0 && blankOrdinarySkill?.writeScopes.length === 0, "ordinary blank Skills must start without permissions");
    assert(blankOrdinarySkill?.module?.enabled === true
      && blankOrdinarySkill?.module?.draft?.fields.length === 7
      && blankOrdinarySkill?.playerGuide === "空白创建时一并保存的玩家说明。", "blank ordinary Skills must atomically create their optional v1 module and player guide");
    assert(blankTextOnlySkill?.module?.creatorSupport === "available_v2", "blank text-only ordinary Skills must default to the companion-aware Creator for later module creation");
    assert(blankGuideSkill?.module?.enabled === false
      && blankGuideSkill.module.draft.skillIOEnabled === true
      && blankGuideSkill.module.draft.fields.length === 0, "blank guide-only Skill must persist a companion without creating module state");
    assert(blankNewGameSkill?.triggers.join(",") === "ui_start_new_game", "blank New Game Skills must keep the fixed system trigger");
    assert(blankNewGameSkill?.readScopes.length === 0 && blankNewGameSkill?.writeScopes.length === 0, "blank New Game Skills must start without renderer-supplied permissions");
    assert(blankNewGameSkill?.technical.item.triggers.join(",") === "ui_start_new_game"
      && blankNewGameSkill?.technical.item.readScopes.length === 0
      && blankNewGameSkill?.technical.item.writeScopes.length === 0, "advanced technical data must reflect the fixed trigger and empty scopes without enabling edits");
    assert(!JSON.stringify(blankResults).includes("renderer-chosen") && !JSON.stringify(blankResults).includes("/tmp/"), "blank content projections must discard renderer IDs and paths");

    const beforeRejectedBlank = await management.listContent();
    await assertRejects("CONTRACT_INVALID", () => management.createBlankContent({
      kind: "ordinary_skill",
      title: "无效空白规则",
      language: "zh-CN",
      description: "太短",
      markdown: "# 无效空白规则\n\n该草稿不应安装。",
    }));
    const afterRejectedBlank = await management.listContent();
    assert(afterRejectedBlank.packs.length === beforeRejectedBlank.packs.length, "failed blank validation must not install a half Pack");

    const restartedManagement = createDesktopContentManagement({
      dataRoot,
      contentRoot,
      engineRoot,
      clock: () => "2026-07-14T00:00:00.000Z",
    });
    const restartedLibrary = await restartedManagement.listContent();
    assert(blankItems.every((item) => restartedLibrary.packs.some((pack) => pack.id === item.packId)), "blank content must remain discoverable after a desktop restart");
    const reopenedNewGameSkill = await restartedManagement.loadEditableContent({
      packId: blankNewGameSkill.packId,
      itemId: blankNewGameSkill.itemId,
    });
    assert(reopenedNewGameSkill.item.skillClass === "new_game" && reopenedNewGameSkill.item.markdown.includes("逐步询问"), "reopened blank content must preserve its type and authored body");

    const cloned = await management.cloneContent({
      packId: "grey-crow-default",
      newPackId: "smoke-player-pack",
      title: "Smoke Player Pack",
      author: "Smoke",
    });
    assert(cloned.pack.ownership === "player_owned" && cloned.pack.activation === "active" && cloned.pack.editable, "cloned Pack must be active, player-owned, and editable");
    assert(cloned.pack.items.some((item) => item.skillClass === "new_game"), "content projections must distinguish New Game Skills for the composer");

    const hostId = cloned.pack.items.find((item) => item.type === "host").id;
    const loadedHost = await management.loadEditableContent({ packId: "smoke-player-pack", itemId: hostId });
    assert(loadedHost.item.markdown.includes("Grey Crow Host") && loadedHost.localPathsExposed === false, "editable content must load without exposing paths");
    assert(loadedHost.item.technical.pack.id === "smoke-player-pack"
      && loadedHost.item.technical.pack.version === "1.0.0"
      && loadedHost.item.technical.pack.ownership === "player_owned"
      && loadedHost.item.technical.pack.validationStatus === "valid", "loaded content must expose only the validated player Pack technical summary");
    assert(loadedHost.item.technical.item.id === hostId
      && loadedHost.item.technical.item.danger === loadedHost.item.danger
      && loadedHost.item.technical.item.revision === loadedHost.item.revision, "technical item data must match the bounded editor projection");
    const savedHost = await management.saveEditableContent({
      ...loadedHost.item,
      packId: "smoke-player-pack",
      itemId: hostId,
      expectedRevision: loadedHost.item.revision,
      title: "测试主持人",
      language: "zh-CN",
      description: "桌面受限编辑器测试。",
      danger: "medium",
      markdown: "# 测试主持人\n\n只编辑玩家副本。",
      templates: [],
    });
    assert(savedHost.item.title === "测试主持人" && savedHost.item.packVersion === "1.0.1", "editable content saves must return the validated revision");
    assert(!JSON.stringify(savedHost).includes(root), "editable content projections must stay path-free");

    const playerPreset = savedHost.library.presets.find((preset) => preset.packId === "smoke-player-pack");
    const playerWorld = cloned.pack.items.find((item) => item.type === "world");
    const playerNewGame = cloned.pack.items.find((item) => item.skillClass === "new_game");
    const playerSkill = cloned.pack.items.find((item) => item.skillClass === "ordinary");
    const playerOptionalSkill = cloned.pack.items.find((item) => item.skillClass === "ordinary" && item.id !== playerSkill.id);
    const savedPreset = await management.saveContentPreset({
      packId: "smoke-player-pack",
      itemId: playerPreset.itemId,
      expectedRevision: playerPreset.revision,
      title: "桌面测试组合",
      description: "通过窄桌面接口保存的玩家剧本组合。",
      language: "zh-CN",
      selection: {
        host: { packId: "smoke-player-pack", itemId: hostId },
        world: { packId: "smoke-player-pack", itemId: playerWorld.id },
        newGameSkill: { packId: "smoke-player-pack", itemId: playerNewGame.id },
        skills: [{ packId: "smoke-player-pack", itemId: playerSkill.id }],
        optionalSkills: [{ packId: "smoke-player-pack", itemId: playerOptionalSkill.id, defaultEnabled: false }],
      },
    });
    assert(savedPreset.preset.title === "桌面测试组合" && savedPreset.preset.selection.skills.length === 1, "desktop preset saves must round-trip the validated selection");
    assert(savedPreset.preset.selection.optionalSkills.length === 1
      && savedPreset.preset.selection.optionalSkills[0].defaultEnabled === false, "desktop preset saves must preserve optional Skill default-on/default-off state");
    assert(savedPreset.library.presets.some((preset) => preset.title === "桌面测试组合"), "saved presets must refresh the content library projection");
    assert(!JSON.stringify(savedPreset).includes(root), "preset projections must stay path-free");

    const loadedSkill = await management.loadEditableContent({ packId: blankTextOnlySkill.packId, itemId: blankTextOnlySkill.itemId });
    assert(loadedSkill.item.module?.enabled === false
      && loadedSkill.item.module?.creatorSupport === "available_v2"
      && loadedSkill.item.module?.draft?.schemaVersion === "grey-crow-skill-module-creator-draft-v2"
      && loadedSkill.item.module?.draft?.skillIOEnabled === true, "ordinary Skills without modules must expose a real companion-aware Creator draft");
    const moduleDraft = createCreatorModuleDraft();
    const normalizedCreatorDraft = normalizeSkillModuleCreatorDraft(moduleDraft, { requireRoundTrip: true });
    assert(normalizedCreatorDraft.previewValues[normalizedCreatorDraft.draft.fields[2].id].includes("\n"), "Creator normalization must round-trip bounded multiline preview text");
    assert(normalizedCreatorDraft.panelSurface === "list_detail", "record-card Creator drafts must select the bounded list/detail panel surface");
    const tableDraft = clone(moduleDraft);
    tableDraft.fields.find((field) => field.type === "record_list").widget = "table";
    assert(normalizeSkillModuleCreatorDraft(tableDraft).panelSurface === "list_detail", "record-table Creator drafts must select the bounded list/detail panel surface");
    const timelineDraft = clone(moduleDraft);
    timelineDraft.fields.find((field) => field.type === "record_list").widget = "timeline";
    assert(normalizeSkillModuleCreatorDraft(timelineDraft).panelSurface === "timeline", "timeline record widgets must select the bounded timeline panel surface");
    const fieldsDraft = clone(moduleDraft);
    fieldsDraft.fields = fieldsDraft.fields.filter((field) => field.type !== "record_list");
    for (const field of fieldsDraft.fields) {
      if (field.type === "integer" || field.type === "number") field.widget = "number";
    }
    assert(normalizeSkillModuleCreatorDraft(fieldsDraft).panelSurface === "fields", "scalar Creator drafts without progress widgets must select the fields surface");
    const progressDraft = clone(fieldsDraft);
    progressDraft.fields.find((field) => field.type === "integer").widget = "progress";
    assert(normalizeSkillModuleCreatorDraft(progressDraft).panelSurface === "progress", "numeric progress widgets must select the progress surface");
    const reorderedDraft = clone(normalizedCreatorDraft.draft);
    const reorderedRecord = reorderedDraft.fields.find((field) => field.type === "record_list");
    const originalItemIds = reorderedRecord.itemFields.map((field) => field.id);
    const groupedItemId = reorderedRecord.itemFields[reorderedRecord.groupCountItemIndex].id;
    reorderedRecord.itemFields.reverse();
    reorderedRecord.groupCountItemIndex = reorderedRecord.itemFields.findIndex((field) => field.id === groupedItemId);
    const normalizedReorderedDraft = normalizeSkillModuleCreatorDraft(reorderedDraft, { requireRoundTrip: true }).draft;
    const normalizedReorderedRecord = normalizedReorderedDraft.fields.find((field) => field.type === "record_list");
    assert(normalizedReorderedRecord.itemFields.map((field) => field.id).join(",") === [...originalItemIds].reverse().join(",")
      && normalizedReorderedRecord.itemFields[normalizedReorderedRecord.groupCountItemIndex].id === groupedItemId,
    "reordering record item fields must preserve stable field identities and the grouped field target");
    for (const forbidden of [
      ["panelSurface", "list_detail"],
      ["sourceKind", "built_in_domain"],
      ["placement", "characters"],
      ["capability", "character_records"],
    ]) {
      const invalidPanelDraft = clone(moduleDraft);
      invalidPanelDraft[forbidden[0]] = forbidden[1];
      await assertRejects("CONTENT_MODULE_DRAFT_INVALID", () =>
        normalizeSkillModuleCreatorDraft(invalidPanelDraft));
    }
    const moduleSaved = await management.saveEditableContent({
      ...loadedSkill.item,
      expectedRevision: loadedSkill.item.revision,
      playerGuide: "这是玩家可见的状态面板说明。",
      moduleDraft,
    });
    assert(moduleSaved.item.module?.enabled === true
      && moduleSaved.item.module?.creatorSupport === "editable_v1"
      && moduleSaved.item.module?.draft?.fields.length === 7, "Creator save must install a validated v1 module across all supported field types");
    assert(moduleSaved.item.playerGuide === "这是玩家可见的状态面板说明。"
      && moduleSaved.item.technical.item.module?.definitionSchemaVersion === "grey-crow-skill-module-definition-v1", "Creator save must round-trip the player guide and bounded version projection");
    const stableFieldIds = moduleSaved.item.module.draft.fields.map((field) => field.id);
    assert(stableFieldIds.every((id) => /^[a-z][a-z0-9_]{0,63}$/.test(id))
      && new Set(stableFieldIds).size === stableFieldIds.length, "Engine must generate stable unique field IDs behind the Creator boundary");
    const modulePreview = await management.previewSkillModule({
      title: moduleSaved.item.title,
      description: moduleSaved.item.description,
      playerGuide: moduleSaved.item.playerGuide,
      triggers: moduleSaved.item.triggers,
      moduleDraft,
      path: "/tmp/renderer-must-not-control-preview",
      operations: ["unsafe_raw_write"],
    });
    assert(modulePreview.projection?.fields.length === 7
      && modulePreview.projection.fields.some((field) => field.widget === "progress")
      && modulePreview.projection.fields.some((field) => field.type === "record_list" && field.value.length === 1), "Creator preview must use the Runtime projection path and preserve sample record values");
    assert(modulePreview.projection.summary.length === 3
      && !JSON.stringify(modulePreview).includes("/tmp/")
      && !JSON.stringify(modulePreview).includes("unsafe_raw_write"), "Creator preview must stay path-free and expose no raw operations");
    assert(modulePreview.panelSurface === "list_detail"
      && modulePreview.panelProjection?.schemaVersion === "grey-crow-skill-panel-view-projection-v1"
      && modulePreview.panelProjection.sourceKind === "ordinary_skill"
      && modulePreview.panelProjection.ownership === "player_owned"
      && modulePreview.panelProjection.group === "player_extensions", "Creator preview must use the formal ordinary player-owned panel projection boundary");
    assert(modulePreview.panelListProjection?.items[0]?.title === "戴灰围巾的人认出了地图。"
      && modulePreview.panelListProjection.items[0].subtitle.includes("类别")
      && modulePreview.panelListProjection.items[0].statusLabel === null
      && modulePreview.panelDetailProjection?.detail?.sections[0]?.fields.map((field) => field.label).join(",") === "内容,类别", "list/detail preview must derive title, subtitle, and detail order mechanically from record-field order");
    const reopenedSkill = await management.loadEditableContent({ packId: blankTextOnlySkill.packId, itemId: blankTextOnlySkill.itemId });
    assert(JSON.stringify(reopenedSkill.item.module.draft.fields.map((field) => field.id)) === JSON.stringify(stableFieldIds), "Creator field IDs must survive save and reopen");
    const reopenedPanelPreview = await management.previewSkillModule({
      title: reopenedSkill.item.title,
      language: reopenedSkill.item.language,
      description: reopenedSkill.item.description,
      playerGuide: reopenedSkill.item.playerGuide,
      triggers: reopenedSkill.item.triggers,
      moduleDraft: reopenedSkill.item.module.draft,
    });
    assert(reopenedPanelPreview.panelSurface === "list_detail"
      && reopenedPanelPreview.panelProjection.panelRef === modulePreview.panelProjection.panelRef
      && JSON.stringify(reopenedSkill.item.module.draft.fields.map((field) => field.id)) === JSON.stringify(stableFieldIds), "save and reopen must preserve panel selection and every stable field identity");
    await assertRejects("CONTENT_EDIT_STALE", () => management.saveEditableContent({
      ...loadedSkill.item,
      expectedRevision: loadedSkill.item.revision,
      title: "过期编辑不应覆盖模块",
    }));
    const invalidDraft = clone(moduleSaved.item.module.draft);
    const enumField = invalidDraft.fields.find((field) => field.type === "enum");
    enumField.options = [{ id: null, label: "重复" }, { id: null, label: "重复" }];
    await assertRejects("CONTENT_MODULE_OPTIONS_INVALID", () => management.saveEditableContent({
      ...moduleSaved.item,
      expectedRevision: moduleSaved.item.revision,
      moduleDraft: invalidDraft,
    }));
    const afterInvalidModule = await management.loadEditableContent({ packId: blankTextOnlySkill.packId, itemId: blankTextOnlySkill.itemId });
    assert(afterInvalidModule.item.revision === moduleSaved.item.revision
      && JSON.stringify(afterInvalidModule.item.module.draft.fields.map((field) => field.id)) === JSON.stringify(stableFieldIds), "failed Creator validation must leave the installed Pack unchanged");
    const packRoot = path.join(dataRoot, "user-content", "packs", blankTextOnlySkill.packId);
    const manifestWithModule = JSON.parse(await fs.readFile(path.join(packRoot, "manifest.json"), "utf8"));
    const manifestSkill = manifestWithModule.provides.find((item) => item.id === blankTextOnlySkill.itemId);
    assert(manifestWithModule.engineCompatibility === ">=2.1 <3" && manifestSkill.module?.path, "module save must raise the Pack compatibility floor and add a canonical module reference");
    await fs.access(path.join(packRoot, manifestSkill.module.path));
    const companionDraft = upgradeCreatorDraftToSkillIO(afterInvalidModule.item.module.draft);
    const companionSaved = await management.saveEditableContent({
      ...afterInvalidModule.item,
      expectedRevision: afterInvalidModule.item.revision,
      moduleDraft: companionDraft,
    });
    assert(companionSaved.item.module?.creatorSupport === "editable_v2"
      && companionSaved.item.module.draft.skillIOEnabled === true
      && /^skillio_[a-f0-9]{24}$/.test(companionSaved.item.module.draft.namespace), "companion-aware Creator save must allocate one hidden stable namespace");
    const stableActions = new Map(companionSaved.item.module.draft.fields
      .map((field) => [field.id, field.hostAction.id]));
    assert(stableActions.size === 7 && new Set(stableActions.values()).size === 7, "Engine must allocate one hidden stable action id per writable field");
    const manifestWithCompanion = JSON.parse(await fs.readFile(path.join(packRoot, "manifest.json"), "utf8"));
    const companionManifestSkill = manifestWithCompanion.provides.find((item) => item.id === blankTextOnlySkill.itemId);
    assert(manifestWithCompanion.engineCompatibility === ">=2.3 <3"
      && companionManifestSkill.skillIO?.path.endsWith("/skill-io.json"), "companion save must raise the Content API floor and add a canonical Skill I/O reference");
    const companionFile = JSON.parse(await fs.readFile(path.join(packRoot, companionManifestSkill.skillIO.path), "utf8"));
    assert(companionFile.schemaVersion === "grey-crow-skill-io-companion-v1"
      && companionFile.namespace === companionSaved.item.module.draft.namespace
      && companionFile.readViews.some((view) => view.id === "lookup")
      && companionFile.actions.length === 7, "Pack must persist the generated companion rather than raw Creator intent");
    const companionReopened = await management.loadEditableContent({ packId: blankTextOnlySkill.packId, itemId: blankTextOnlySkill.itemId });
    assert(JSON.stringify(companionReopened.item.module.draft) === JSON.stringify(companionSaved.item.module.draft), "companion-aware Creator draft must survive Pack save and reopen exactly");
    const renamedCompanionDraft = clone(companionReopened.item.module.draft);
    renamedCompanionDraft.fields.reverse();
    renamedCompanionDraft.fields[0].label = "重命名后的记忆碎片";
    renamedCompanionDraft.fields[0].hostAction.label = "追加一条记忆碎片";
    const companionRenamed = await management.saveEditableContent({
      ...companionReopened.item,
      expectedRevision: companionReopened.item.revision,
      moduleDraft: renamedCompanionDraft,
    });
    assert(companionRenamed.item.module.draft.namespace === companionSaved.item.module.draft.namespace
      && companionRenamed.item.module.draft.fields.every((field) => stableActions.get(field.id) === field.hostAction.id), "rename and reorder must reuse hidden field, action and namespace identities");
    const moduleDisabled = await management.saveEditableContent({
      ...companionRenamed.item,
      expectedRevision: companionRenamed.item.revision,
      moduleDraft: { schemaVersion: "grey-crow-skill-module-creator-draft-v2", enabled: false, skillIOEnabled: false, namespace: null, fields: [] },
    });
    assert(moduleDisabled.item.module?.enabled === false, "Creator must support returning an ordinary Skill to text-only mode");
    const manifestWithoutModule = JSON.parse(await fs.readFile(path.join(packRoot, "manifest.json"), "utf8"));
    const disabledManifestSkill = manifestWithoutModule.provides.find((item) => item.id === blankTextOnlySkill.itemId);
    assert(!disabledManifestSkill.module && !disabledManifestSkill.skillIO, "disabling a module and companion must remove both manifest references atomically");
    await assertRejects("ENOENT", () => fs.access(path.join(packRoot, manifestSkill.module.path)));
    await assertRejects("ENOENT", () => fs.access(path.join(packRoot, companionManifestSkill.skillIO.path)));
    await assertRejects("CONTENT_BUILT_IN_READ_ONLY", () => management.loadEditableContent({
      packId: "grey-crow-default",
      itemId: "grey-crow-host",
    }));
    await assertRejects("CONTENT_BUILT_IN_READ_ONLY", () => management.saveContentPreset({
      packId: "grey-crow-default",
      title: "禁止组合",
      description: "内置内容不能成为保存目标。",
      language: "zh-CN",
      selection: savedPreset.preset.selection,
    }));

    const exported = await management.exportContent({ packId: "smoke-player-pack", destinationRoot: exportRoot });
    assert(exported.ok && exported.files > 0 && exported.destinationExposed === false, "export must return a path-free result");
    await management.deleteContent({ packId: "smoke-player-pack" });

    await assertRejects("CONTENT_IMPORT_DISABLED", () => management.importContent({
      kind: "folder",
      sourcePath: path.join(exportRoot, "smoke-player-pack"),
    }));
    const { createContentLibrary } = require(path.join(engineRoot, "content-v2"));
    const importFixtureLibrary = createContentLibrary({
      libraryRoot: path.join(dataRoot, "user-content"),
      contentRoot,
      allowThirdPartyImport: true,
      clock: () => "2026-07-14T00:00:00.000Z",
    });
    await importFixtureLibrary.importFolder(path.join(exportRoot, "smoke-player-pack"));
    const quarantined = await management.listContent();
    const quarantinedPack = quarantined.packs.find((pack) => pack.id === "smoke-player-pack");
    assert(quarantinedPack?.ownership === "imported_readonly" && quarantinedPack.activation === "quarantined" && !quarantinedPack.editable, "existing imports must remain visible but quarantined");
    await assertRejects("CONTENT_PACK_READ_ONLY", () => management.loadEditableContent({
      packId: "smoke-player-pack",
      itemId: hostId,
    }));
    await assertRejects("CONTENT_PACK_QUARANTINED", () => management.cloneContent({
      packId: "smoke-player-pack",
      newPackId: "forbidden-import-copy",
      title: "Forbidden Import Copy",
      author: "Smoke",
    }));
    const quarantinedExportRoot = path.join(root, "quarantined-exports");
    await fs.mkdir(quarantinedExportRoot, { recursive: true });
    const quarantinedExport = await management.exportContent({ packId: "smoke-player-pack", destinationRoot: quarantinedExportRoot });
    assert(quarantinedExport.ok && quarantinedExport.files > 0, "quarantined Pack must remain exportable");
    await management.deleteContent({ packId: "smoke-player-pack" });

    const projection = JSON.stringify({ initial, savedProfile, blankResults, restartedLibrary, reopenedNewGameSkill, cloned, loadedHost, savedHost, savedPreset, moduleSaved, modulePreview, moduleDisabled, exported, quarantined, quarantinedExport });
    assert(!projection.includes(root), "content management projections must not expose local paths");
    await assertRejects("CONTENT_BUILT_IN_READ_ONLY", () => management.deleteContent({ packId: "grey-crow-default" }));
    await assertRejects("PLAYER_PROFILE_SECRET_REJECTED", () => management.savePlayerProfile({
      fields: { notes: "sk-testsecret12345678" },
    }));

    process.stdout.write("content management checks passed\n");
  } finally {
    await makeWritable(root);
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createCreatorModuleDraft() {
  const base = (label, type, widget, modelWritable = true, showInSummary = false) => ({
    id: null, label, type, widget, modelWritable, showInSummary,
  });
  return {
    schemaVersion: "grey-crow-skill-module-creator-draft-v1",
    enabled: true,
    fields: [
      { ...base("恢复进度", "integer", "progress", true, true), minimum: 0, maximum: 10, default: 0, preview: 4 },
      { ...base("气温", "number", "meter"), minimum: -50, maximum: 60, default: 18.5, preview: 21.5 },
      { ...base("当前状况", "text", "multiline"), maxLength: 240, default: "尚未确认", preview: "天色阴沉\n风从废墟间穿过。" },
      { ...base("信标已启动", "boolean", "indicator"), default: false, preview: true },
      {
        ...base("警戒等级", "enum", "badge", true, true),
        options: [{ id: null, label: "低" }, { id: null, label: "高" }],
        defaultOptionIndex: 0,
        previewOptionIndex: 1,
      },
      { ...base("已知线索", "string_list", "chips"), maxItems: 8, itemMaxLength: 120, default: [], preview: ["车站脚印", "旧地图"] },
      {
        ...base("记忆碎片", "record_list", "cards", true, true),
        maxItems: 20,
        collectionMode: "maintain_clear",
        itemFields: [
          { id: null, label: "内容", type: "text", maxLength: 240, preview: "戴灰围巾的人认出了地图。" },
          {
            id: null,
            label: "类别",
            type: "enum",
            options: [{ id: null, label: "人物" }, { id: null, label: "地点" }],
            previewOptionIndex: 0,
          },
        ],
        previewRecordEnabled: true,
        summaryMode: "count_progress",
        summaryTarget: 10,
        milestones: [{ minimum: 3, label: "记忆开始连贯" }],
        groupCountItemIndex: 1,
      },
    ],
  };
}

function upgradeCreatorDraftToSkillIO(value) {
  const draft = clone(value);
  draft.schemaVersion = "grey-crow-skill-module-creator-draft-v2";
  draft.skillIOEnabled = true;
  draft.namespace = null;
  const behaviorByType = {
    integer: "adjust_number",
    number: "set_value",
    text: "set_value",
    boolean: "set_value",
    enum: "choose_enum",
    string_list: "change_list_item",
    record_list: "append_record",
  };
  for (const field of draft.fields) {
    field.views = [
      ...(field.showInSummary ? ["overview"] : []),
      ...(field.type === "record_list" ? ["recent", "lookup"] : []),
    ];
    field.hostAction = {
      id: null,
      label: `更新${field.label}`,
      behavior: behaviorByType[field.type],
    };
  }
  return draft;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function assertRejects(code, callback) {
  try {
    await callback();
  } catch (error) {
    if (error?.code === code) return;
    throw new Error(`expected ${code}, received ${error?.code || "unknown"}`);
  }
  throw new Error(`expected ${code}`);
}

async function makeWritable(root) {
  const stat = await fs.lstat(root).catch(() => null);
  if (!stat) return;
  await fs.chmod(root, stat.isDirectory() ? 0o700 : 0o600).catch(() => {});
  if (!stat.isDirectory()) return;
  const entries = await fs.readdir(root).catch(() => []);
  for (const entry of entries) await makeWritable(path.join(root, entry));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
