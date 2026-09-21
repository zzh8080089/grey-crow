"use strict";

const fs = require("node:fs/promises");
const {
  compileContentSnapshot,
  createSkillLocaleResolver,
  readContentSnapshot,
  resolveContentPlan,
  validatePackV2,
} = require("..");
const { hashCanonical } = require("../snapshot-utils");
const { withTempFixture } = require("./test-fixtures/temp-workspace");

async function runSkillLocaleResolverChecks() {
  return withTempFixture(async (workspace) => {
    const adventuresRoot = workspace.resolve("adventures");
    const packsRoot = workspace.resolve("packs");
    const packId = "localized-module-pack";
    const packRoot = workspace.resolve(`packs/${packId}`);
    const adventureId = "localized_adventure";
    const clock = () => "2026-07-18T08:00:00.000Z";
    await fs.mkdir(adventuresRoot, { recursive: true });
    await writeLocalizedModulePack(workspace, `packs/${packId}`, packId);
    const validated = await validatePackV2(packRoot, {
      trustedRoot: packsRoot,
      ownership: "built_in",
    });
    const plan = resolveContentPlan({
      packs: [validated],
      selection: {
        host: { packId, itemId: "locale-host" },
        world: { packId, itemId: "locale-world" },
        newGameSkill: { packId, itemId: "locale-new-game" },
        skills: [{ packId, itemId: "memory-locale-skill" }],
      },
    });
    await compileContentSnapshot({
      adventuresRoot,
      adventureId,
      language: "zh-CN",
      plan,
      packRoots: { [packId]: packRoot },
      clock,
    });
    const snapshotLoader = () => readContentSnapshot({ adventuresRoot, adventureId });
    const snapshot = await snapshotLoader();
    const snapshotBefore = hashCanonical(snapshot);

    let localeState = { gameLocale: "zh-CN", localeRevision: "locale_zh_001" };
    const localeResolver = createSkillLocaleResolver({
      snapshotLoader,
      localeProvider: async () => localeState,
    });

    const sourceView = await localeResolver.resolveCurrent({ adventureId });
    const sourceViewAgain = await localeResolver.resolveCurrent({ adventureId });
    assert(sourceView === sourceViewAgain, "one locale revision must reuse one immutable resolved Skill view");
    assert(sourceView.skills[0].title === "记忆碎片", "source locale must resolve the locked source Skill metadata");
    assert(localeResolver.inspectCache().cached === true, "resolved source locale must populate the revision cache");

    const missingCoverage = await localeResolver.preflight({
      gameLocale: "ja-JP",
      localeRevision: "locale_ja_001",
    });
    assert(missingCoverage.status === "blocked" && missingCoverage.blockers.length === 2, "preflight must block when any selected Skill lacks the requested locale");
    assert(missingCoverage.blockers.every((entry) => entry.ownership === "built_in" && entry.reason === "missing_locale"), "coverage blockers must preserve ownership and a stable missing-locale reason");

    localeState = { gameLocale: "en-US", localeRevision: "locale_zh_001" };
    await assertRejects("SKILL_LOCALE_REVISION_CONFLICT", () => localeResolver.resolveCurrent({ adventureId }));
    localeState = { gameLocale: "en-US", localeRevision: "locale_en_001" };
    const englishView = await localeResolver.resolveCurrent({ adventureId });
    assert(englishView.gameLocale === "en-US" && englishView.localeRevision === "locale_en_001", "a new locale revision must resolve the requested locale");
    assert(englishView.newGameSkill.body.includes("Ask one clear setup question"), "New Game Skill body must switch with the same resolved locale");
    assert(englishView.skills[0].body.includes("Store one memory fragment"), "ordinary Skill body must switch atomically");
    assert(englishView.skills[0].templates[0].body.includes("Memory Card Template"), "Skill templates must use the same locale revision");

    localeState = { gameLocale: "zh-CN", localeRevision: "locale_zh_002" };
    const restoredView = await localeResolver.resolveCurrent({ adventureId });
    assert(restoredView.localeRevision === "locale_zh_002", "a later locale revision must replace the cache");
    assert(restoredView.skills[0].title === "记忆碎片" && restoredView.skills[0].body.includes("写入一枚记忆碎片"), "source locale metadata and body must return together");
    assert(hashCanonical(await snapshotLoader()) === snapshotBefore, "resolving locale views must not mutate the locked snapshot");

    const sourceOnlySnapshot = {
      ...snapshot,
      content: { ...snapshot.content, skillLocaleResources: null },
    };
    const oldResolver = createSkillLocaleResolver({
      snapshotLoader: async () => sourceOnlySnapshot,
      localeProvider: async () => ({ gameLocale: "en-US", localeRevision: "legacy_en_001" }),
    });
    const oldCoverage = await oldResolver.preflight({ gameLocale: "en-US", localeRevision: "legacy_en_001" });
    assert(oldCoverage.status === "blocked" && oldCoverage.blockers.every((entry) => entry.reason === "source_only_snapshot"), "old source-only snapshots must fail closed instead of silently mixing locale content");
    await assertRejects("SKILL_LOCALE_COVERAGE_BLOCKED", () => oldResolver.resolveCurrent({ adventureId }));

    return {
      name: "p2-26-skill-locale-resolver",
      ok: true,
      details: {
        coverage_preflight: true,
        revision_cache_and_conflict: true,
        new_game_and_skill_body_atomic: true,
        template_atomic: true,
        locked_snapshot_unchanged: true,
        source_only_snapshot_fail_closed: true,
      },
    };
  }, { prefix: "p2-26-skill-locale-resolver" });
}

async function writeLocalizedModulePack(workspace, relativeRoot, packId) {
  const definition = {
    schemaVersion: "grey-crow-skill-module-definition-v1",
    stateVersion: 1,
    visibility: "visible",
    summaryFields: ["progress", "status"],
    fields: [
      {
        id: "progress",
        label: "回忆进度",
        type: "integer",
        default: 3,
        minimum: 0,
        maximum: 30,
        modelWritable: true,
        allowedOperations: ["set"],
        display: { widget: "progress" },
      },
      {
        id: "status",
        label: "恢复状态",
        type: "enum",
        default: "dormant",
        options: [
          { value: "dormant", label: "沉睡" },
          { value: "recovered", label: "已恢复" },
        ],
        modelWritable: true,
        allowedOperations: ["set"],
        display: { widget: "badge" },
      },
    ],
  };
  await workspace.writeJson(`${relativeRoot}/manifest.json`, {
    schemaVersion: "grey-crow-extension-pack-v2",
    id: packId,
    title: "Skill Locale Resolver Fixture",
    version: "2.2.0",
    author: "Grey Crow Tests",
    engineCompatibility: ">=2.2 <3",
    languages: ["zh-CN", "en-US"],
    provides: [
      { type: "host", id: "locale-host", title: "本地化主持人", path: "host/HOST.md", language: "zh-CN", description: "本地化解析测试主持人内容。", danger: "low" },
      { type: "world", id: "locale-world", title: "本地化世界", path: "world/WORLD.md", language: "zh-CN", description: "本地化解析测试世界内容。", danger: "low" },
      {
        type: "skill",
        skillClass: "new_game",
        id: "locale-new-game",
        title: "本地化开局",
        path: "skills/new-game/SKILL.md",
        language: "zh-CN",
        description: "通过自然提问完成本地化测试开局。",
        danger: "medium",
        triggers: ["ui_start_new_game"],
        templates: [],
        readScopes: ["state"],
        writeScopes: ["state", "timeline"],
        localization: { schemaVersion: "grey-crow-skill-localization-ref-v1", path: "skills/new-game/localizations.json" },
      },
      {
        type: "skill",
        skillClass: "ordinary",
        id: "memory-locale-skill",
        title: "记忆碎片",
        path: "skills/memory/SKILL.md",
        language: "zh-CN",
        description: "当玩家触摸旧物并主动回忆时记录碎片。",
        danger: "low",
        triggers: ["触摸旧物", "主动回忆", "想起过去"],
        templates: ["skills/memory/templates/memory-card.md"],
        readScopes: ["state", "memory"],
        writeScopes: ["memory"],
        playerGuide: "查看已经恢复的记忆进度与当前状态。",
        module: { schemaVersion: "grey-crow-skill-module-ref-v1", path: "skills/memory/module.json" },
        localization: { schemaVersion: "grey-crow-skill-localization-ref-v1", path: "skills/memory/localizations.json" },
      },
    ],
    permissions: ["read_base_content", "write_current_saveRoot_via_tools"],
    conflicts: [],
  });
  await workspace.writeText(`${relativeRoot}/host/HOST.md`, "# 本地化主持人\n\n只用于 resolver 测试。\n");
  await workspace.writeText(`${relativeRoot}/world/WORLD.md`, "# 本地化世界\n\n一间保存旧照片的房间。\n");
  await workspace.writeText(`${relativeRoot}/skills/new-game/SKILL.md`, "# 本地化开局\n\n每轮只询问一个清晰的开局问题。\n");
  await workspace.writeJson(`${relativeRoot}/skills/new-game/localizations.json`, {
    schemaVersion: "grey-crow-skill-localization-bundle-v1",
    itemId: "locale-new-game",
    sourceLocale: "zh-CN",
    locales: [{
      locale: "en-US",
      title: "Localized New Game",
      description: "Starts the localized test through natural setup questions.",
      triggers: ["ui_start_new_game"],
      playerGuide: null,
      skillPath: "skills/new-game/locales/en-US/SKILL.md",
      templates: [],
      modulePresentationPath: null,
    }],
  });
  await workspace.writeText(`${relativeRoot}/skills/new-game/locales/en-US/SKILL.md`, "# Localized New Game\n\nAsk one clear setup question per turn.\n");
  await workspace.writeText(`${relativeRoot}/skills/memory/SKILL.md`, "# 记忆碎片\n\n在合适的叙事节点写入一枚记忆碎片。\n");
  await workspace.writeText(`${relativeRoot}/skills/memory/templates/memory-card.md`, "# 记忆卡片模板\n\nTemplate ID: `template:memory-card`\n");
  await workspace.writeJson(`${relativeRoot}/skills/memory/module.json`, definition);
  await workspace.writeJson(`${relativeRoot}/skills/memory/localizations.json`, {
    schemaVersion: "grey-crow-skill-localization-bundle-v1",
    itemId: "memory-locale-skill",
    sourceLocale: "zh-CN",
    locales: [{
      locale: "en-US",
      title: "Memory Fragments",
      description: "Records a fragment when the player touches an old object and deliberately recalls the past.",
      triggers: ["touch an old object", "deliberately recall", "remember the past"],
      playerGuide: "Review recovered memories and the current recovery status.",
      skillPath: "skills/memory/locales/en-US/SKILL.md",
      templates: [{ templateId: "template:memory-card", path: "skills/memory/locales/en-US/templates/memory-card.md" }],
      modulePresentationPath: "skills/memory/locales/en-US/module-presentation.json",
    }],
  });
  await workspace.writeText(`${relativeRoot}/skills/memory/locales/en-US/SKILL.md`, "# Memory Fragments\n\nStore one memory fragment at an appropriate narrative moment.\n");
  await workspace.writeText(`${relativeRoot}/skills/memory/locales/en-US/templates/memory-card.md`, "# Memory Card Template\n\nTemplate ID: `template:memory-card`\n");
  await workspace.writeJson(`${relativeRoot}/skills/memory/locales/en-US/module-presentation.json`, {
    schemaVersion: "grey-crow-skill-module-presentation-overlay-v1",
    itemId: "memory-locale-skill",
    locale: "en-US",
    fields: [
      { fieldId: "progress", label: "Memory Progress", options: [], itemFields: [], milestones: [] },
      {
        fieldId: "status",
        label: "Recovery Status",
        options: [
          { value: "dormant", label: "Dormant" },
          { value: "recovered", label: "Recovered" },
        ],
        itemFields: [],
        milestones: [],
      },
    ],
  });
}

async function assertRejects(code, callback) {
  try {
    await callback();
  } catch (error) {
    if (error?.code === code) return;
    throw new Error(`expected ${code}, received ${error?.code || "unknown"}: ${error?.message || error}`);
  }
  throw new Error(`expected ${code}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

module.exports = { runSkillLocaleResolverChecks };
