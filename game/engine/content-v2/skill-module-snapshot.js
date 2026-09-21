"use strict";

const { validateContract } = require("../contracts/v2");
const { assertNoSecret, hashCanonical, snapshotError } = require("./snapshot-utils");
const { assertSkillIOCompanionMatchesDefinition } = require("./skill-module-creator");

const SKILL_PANEL_PRESENTATION_FEATURE = "skill-panel-presentation-v1";
const SKILL_PANEL_PRESENTATION_V2_FEATURE = "skill-panel-presentation-v2";
const SKILL_MODULE_FEATURE = "skill-module-v1";
const SKILL_IO_FEATURE = "skill-io-companion-v1";
const MODULE_LIMITS_VERSION = 1;
const MAX_REVIEW_MODULES = 16;
const MODULE_OWNERSHIPS = new Set(["built_in", "player_owned"]);
const PANEL_OWNERSHIPS = new Set(["built_in", "player_owned", "imported_readonly"]);
const OPERATION_ORDER = new Map([
  ["set", 0],
  ["append", 1],
  ["remove_by_id", 2],
  ["clear", 3],
]);

function prepareSkillModuleSnapshot(plan, options = {}) {
  requirePlan(plan);
  const requiredRefs = new Set((Array.isArray(options.requiredSkillRefs) ? options.requiredSkillRefs : plan.skills)
    .map((ref) => refKey(ref)));
  const modules = [];
  const skillIOCompanions = [];
  const panels = [];

  for (const skill of plan.skills) {
    const preparedModule = skill.module ? prepareModule(skill) : null;
    if (preparedModule) modules.push(preparedModule);
    const preparedSkillIO = skill.skillIO ? prepareSkillIO(skill, preparedModule) : null;
    if (preparedSkillIO) skillIOCompanions.push(preparedSkillIO);
    panels.push(buildPanel(skill, preparedModule));
  }

  modules.sort((left, right) => left.moduleRef.localeCompare(right.moduleRef));
  skillIOCompanions.sort((left, right) => left.namespace.localeCompare(right.namespace));
  assertUniqueSkillIOCompanions(skillIOCompanions);
  panels.sort((left, right) => left.itemId.localeCompare(right.itemId) || left.packId.localeCompare(right.packId));
  const presentation = {
    schemaVersion: "grey-crow-skill-panel-presentation-v1",
    panels,
  };
  validateContract("skill-panel-presentation-v1", presentation);
  assertNoSecret(Buffer.from(JSON.stringify(presentation), "utf8"));

  const skillIOByModuleRef = new Map(skillIOCompanions.filter((entry) => entry.moduleRef)
    .map((entry) => [entry.moduleRef, entry]));
  const capabilityReview = buildCapabilityReview(modules, requiredRefs, plan.host.language, skillIOByModuleRef);
  const features = [SKILL_PANEL_PRESENTATION_FEATURE];
  if (modules.length > 0) features.push(SKILL_MODULE_FEATURE);
  if (skillIOCompanions.length > 0) features.push(SKILL_IO_FEATURE);

  const prepared = {
    schemaVersion: "grey-crow-skill-module-prepare-v1",
    features,
    presentation,
    presentationHash: hashCanonical(presentation),
    capabilityReview,
    moduleReviewHash: capabilityReview?.reviewHash || null,
    modules,
    skillIOCompanions,
    contentHash: hashCanonical({
      engineVersion: plan.engineVersion,
      items: [plan.host, plan.world, plan.newGameSkill, ...plan.skills].map(projectItemFingerprint),
      replacements: plan.replacements,
      presentation,
      moduleReviewHash: capabilityReview?.reviewHash || null,
      limitsVersion: MODULE_LIMITS_VERSION,
    }),
  };
  return deepFreeze(prepared);
}

function prepareSkillPanelPresentationV2(plan, prepared, builtInDomainSkills = [], options = {}) {
  requirePlan(plan);
  if (!prepared || prepared.schemaVersion !== "grey-crow-skill-module-prepare-v1") {
    throw snapshotError("SKILL_PANEL_PRESENTATION_INVALID", "Prepared ordinary Skill metadata is required.");
  }
  const language = String(options.language || plan.host.language || "en-US").trim();
  const skillByIdentity = new Map(plan.skills.map((skill) => [refKey(skill), skill]));
  const ordinaryPanels = prepared.presentation.panels.map((panel, index) => {
    const skill = skillByIdentity.get(`${panel.packId}:${panel.itemId}`);
    const ownership = skill?.ownership || "imported_readonly";
    if (!skill || !PANEL_OWNERSHIPS.has(ownership)) {
      throw snapshotError("SKILL_PANEL_PRESENTATION_INVALID", "Ordinary Skill panel ownership is invalid.", {
        item_id: panel.itemId,
      });
    }
    const module = panel.moduleRef
      ? prepared.modules.find((entry) => entry.moduleRef === panel.moduleRef)
      : null;
    return {
      panelRef: derivePanelRef({
        sourceKind: "ordinary_skill",
        packId: panel.packId,
        packVersion: panel.packVersion,
        itemId: panel.itemId,
      }),
      sourceKind: "ordinary_skill",
      ownership,
      group: ownership === "built_in" ? "adventure_gameplay" : "player_extensions",
      sortOrder: (ownership === "built_in" ? 1000 : 2000) + index,
      title: panel.title,
      language: panel.language,
      description: panel.description,
      triggers: [...panel.triggers],
      playerGuide: panel.playerGuide,
      surface: selectOrdinaryPanelSurface(module?.definition || null),
      ordinarySource: {
        packId: panel.packId,
        itemId: panel.itemId,
        hasModule: panel.hasModule,
        moduleRef: panel.moduleRef,
        visibility: panel.visibility,
      },
      domainSource: null,
    };
  });
  const domainPanels = builtInDomainSkills.map((entry, index) => {
    const copy = builtInDomainPanelCopy(entry.skillId, language);
    return {
      panelRef: derivePanelRef({
        sourceKind: "built_in_domain",
        skillId: entry.skillId,
        capability: entry.capability,
      }),
      sourceKind: "built_in_domain",
      ownership: "built_in",
      group: "story_records",
      sortOrder: 100 + index,
      title: copy.title,
      language,
      description: copy.description,
      triggers: copy.triggers,
      playerGuide: copy.playerGuide,
      surface: "list_detail",
      ordinarySource: null,
      domainSource: {
        skillId: entry.skillId,
        capability: entry.capability,
        defaultView: entry.bundle.companion.defaultView,
      },
    };
  });
  const presentation = {
    schemaVersion: "grey-crow-skill-panel-presentation-v2",
    panels: [...domainPanels, ...ordinaryPanels],
  };
  validateContract("skill-panel-presentation-v2", presentation);
  assertNoSecret(Buffer.from(JSON.stringify(presentation), "utf8"));
  return deepFreeze(presentation);
}

function derivePanelRef(identity) {
  return `panel_${hashCanonical(identity).slice(0, 32)}`;
}

function selectOrdinaryPanelSurface(definition) {
  if (!definition) return "guide";
  const recordFields = definition.fields.filter((field) => field.type === "record_list");
  if (recordFields.some((field) => field.display?.widget === "timeline")) return "timeline";
  if (recordFields.length > 0) return "list_detail";
  if (definition.fields.some((field) =>
    (field.type === "integer" || field.type === "number")
    && (field.display?.widget === "progress" || field.display?.widget === "meter"))) {
    return "progress";
  }
  return "fields";
}

function builtInDomainPanelCopy(skillId, language) {
  if (skillId !== "characters") {
    throw snapshotError("SKILL_PANEL_PRESENTATION_INVALID", "Built-in domain panel metadata is unavailable.");
  }
  const locale = String(language || "").toLowerCase();
  if (locale.startsWith("zh")) {
    return {
      title: "角色记录",
      description: "查看本局由 Runtime 维护的角色记录。",
      triggers: ["角色", "人物", "名字"],
      playerGuide: "浏览角色列表，并按稳定引用查看只读角色详情。",
    };
  }
  if (locale.startsWith("ja")) {
    return {
      title: "キャラクター記録",
      description: "Runtime が管理する現在の物語の人物記録を確認します。",
      triggers: ["人物", "名前", "キャラクター"],
      playerGuide: "人物一覧から、安定した参照を使って読み取り専用の詳細を確認します。",
    };
  }
  return {
    title: "Character Records",
    description: "Review Runtime-owned character records for the current story.",
    triggers: ["character", "person", "name"],
    playerGuide: "Browse the character list and open read-only details by stable reference.",
  };
}

function prepareModule(skill) {
  const definition = skill.module?.definition;
  if (!definition || skill.module.schemaVersion !== "grey-crow-skill-module-ref-v1") {
    throw snapshotError("SKILL_MODULE_METADATA_INVALID", "Resolved Skill module metadata is invalid.", {
      pack_id: skill.packId,
      item_id: skill.id,
    });
  }
  validateContract("skill-module-definition-v1", definition);
  assertNoSecret(Buffer.from(JSON.stringify(definition), "utf8"));
  if (!MODULE_OWNERSHIPS.has(skill.ownership)) {
    throw snapshotError(
      "SKILL_MODULE_OWNERSHIP_FORBIDDEN",
      "Skill modules can only be prepared from built-in or player-owned content.",
      { item_id: skill.id }
    );
  }
  if (!/^[a-f0-9]{64}$/.test(skill.module.sha256 || "")) {
    throw snapshotError("SKILL_MODULE_HASH_INVALID", "Resolved Skill module hash is invalid.", { item_id: skill.id });
  }
  if (definition.visibility === "hidden_until_active" && skill.ownership !== "built_in") {
    throw snapshotError(
      "SKILL_MODULE_HIDDEN_OWNERSHIP_FORBIDDEN",
      "Hidden lifecycle modules are restricted to built-in content.",
      { item_id: skill.id }
    );
  }
  if (definition.visibility === "hidden_until_active" && definition.fields.length > 0) {
    throw snapshotError(
      "SKILL_MODULE_HIDDEN_FIELDS_FORBIDDEN",
      "Hidden lifecycle modules cannot declare writable or player-owned state fields in Module v1.",
      { item_id: skill.id }
    );
  }
  const definitionHash = skill.module.sha256;
  const moduleRef = deriveModuleRef(skill, definitionHash);
  const grant = deriveGrant(definition, moduleRef, definitionHash);
  const lock = {
    schemaVersion: "grey-crow-skill-module-lock-v1",
    moduleRef,
    definitionHash,
    definitionSchemaVersion: definition.schemaVersion,
    stateVersion: definition.stateVersion,
    grant,
  };
  return deepFreeze({
    packId: skill.packId,
    itemId: skill.id,
    title: skill.title,
    moduleRef,
    definitionHash,
    definition,
    grant,
    lock,
  });
}

function prepareSkillIO(skill, preparedModule) {
  const companion = skill.skillIO?.companion;
  if (!companion || skill.skillIO.schemaVersion !== "grey-crow-skill-io-ref-v1") {
    throw snapshotError("SKILL_IO_METADATA_INVALID", "Resolved Skill I/O metadata is invalid.", {
      pack_id: skill.packId,
      item_id: skill.id,
    });
  }
  try {
    assertSkillIOCompanionMatchesDefinition(companion, preparedModule?.definition || null);
  } catch {
    throw snapshotError("SKILL_IO_DEFINITION_MISMATCH", "Skill I/O companion does not match the selected Skill module.", {
      item_id: skill.id,
    });
  }
  assertNoSecret(Buffer.from(JSON.stringify(companion), "utf8"));
  if (!MODULE_OWNERSHIPS.has(skill.ownership)) {
    throw snapshotError("SKILL_IO_OWNERSHIP_FORBIDDEN", "Skill I/O companions can only be prepared from built-in or player-owned content.", {
      item_id: skill.id,
    });
  }
  if (!/^[a-f0-9]{64}$/.test(skill.skillIO.sha256 || "")) {
    throw snapshotError("SKILL_IO_HASH_INVALID", "Resolved Skill I/O hash is invalid.", { item_id: skill.id });
  }
  const lock = buildSkillIOLock(companion, skill.skillIO.sha256, preparedModule?.moduleRef || null);
  return deepFreeze({
    packId: skill.packId,
    itemId: skill.id,
    title: skill.title,
    namespace: companion.namespace,
    companionHash: skill.skillIO.sha256,
    companion,
    moduleRef: preparedModule?.moduleRef || null,
    lock,
  });
}

function assertUniqueSkillIOCompanions(companions) {
  const namespaces = new Set();
  const toolNames = new Set();
  for (const entry of companions) {
    if (namespaces.has(entry.namespace)) {
      throw snapshotError("SKILL_IO_NAMESPACE_COLLISION", "Selected Skill I/O companions must use unique hidden namespaces.");
    }
    namespaces.add(entry.namespace);
    for (const action of entry.companion.actions) {
      if (toolNames.has(action.toolName)) {
        throw snapshotError("SKILL_IO_TOOL_COLLISION", "Selected Skill I/O companions generated a duplicate model tool name.");
      }
      toolNames.add(action.toolName);
    }
  }
}

function buildSkillIOLock(companion, companionHash, moduleRef) {
  return {
    schemaVersion: "grey-crow-skill-io-lock-v1",
    namespace: companion.namespace,
    companionHash,
    companionSchemaVersion: companion.schemaVersion,
    moduleRef,
    readViewIds: companion.readViews.map((view) => view.id),
    actionIds: companion.actions.map((action) => action.id),
  };
}

function deriveModuleRef(skill, definitionHash) {
  return `module_${hashCanonical({
    packId: skill.packId,
    packVersion: skill.packVersion,
    itemId: skill.id,
    definitionHash,
  }).slice(0, 32)}`;
}

function deriveGrant(definition, moduleRef, definitionHash) {
  const writableFields = definition.fields
    .filter((field) => field.modelWritable === true)
    .map((field) => ({
      fieldId: field.id,
      operations: [...field.allowedOperations].sort(compareOperations),
    }))
    .sort((left, right) => left.fieldId.localeCompare(right.fieldId));
  const grant = {
    schemaVersion: "grey-crow-skill-module-grant-v1",
    moduleRef,
    definitionHash,
    read: true,
    writableFields,
    limitsVersion: MODULE_LIMITS_VERSION,
  };
  validateContract("skill-module-grant-v1", grant);
  return deepFreeze(grant);
}

function buildPanel(skill, preparedModule) {
  return {
    packId: skill.packId,
    packTitle: skill.packTitle,
    packVersion: skill.packVersion,
    itemId: skill.id,
    title: skill.title,
    language: skill.language,
    description: skill.description,
    triggers: [...skill.triggers],
    playerGuide: skill.playerGuide || null,
    hasModule: Boolean(preparedModule),
    moduleRef: preparedModule?.moduleRef || null,
    visibility: preparedModule?.definition.visibility || null,
  };
}

function buildCapabilityReview(modules, requiredRefs, language, skillIOByModuleRef = new Map()) {
  const writableModules = modules.filter((entry) => entry.grant.writableFields.length > 0);
  if (writableModules.length === 0) return null;
  if (writableModules.length > MAX_REVIEW_MODULES) {
    throw snapshotError("SKILL_MODULE_REVIEW_LIMIT", "Too many writable Skill modules were selected.");
  }
  const basis = {
    schemaVersion: "grey-crow-skill-module-capability-review-v1",
    modules: writableModules.map((entry) => {
      const skillIO = skillIOByModuleRef.get(entry.moduleRef) || null;
      return {
        moduleRef: entry.moduleRef,
        title: entry.title,
        required: requiredRefs.has(`${entry.packId}:${entry.itemId}`),
        enabled: true,
        writeSummary: buildWriteSummary(entry.definition, language, skillIO?.companion || null),
        ...(skillIO ? { readSummary: buildReadSummary(skillIO.companion, language) } : {}),
      };
    }),
    limitsSummary: buildLimitsSummary(language),
    risk: "local_module_state",
  };
  const review = { ...basis, reviewHash: hashCanonical(basis) };
  validateContract("skill-module-capability-review-v1", review);
  assertNoSecret(Buffer.from(JSON.stringify(review), "utf8"));
  return deepFreeze(review);
}

function buildWriteSummary(definition, language, companion = null) {
  const semanticActions = companion?.actions || null;
  const entries = semanticActions
    ? semanticActions.map((action) => action.label)
    : definition.fields.filter((field) => field.modelWritable === true).map((field) => field.label);
  const labels = entries.slice(0, 4)
    .map((label) => `“${String(label).slice(0, 48)}”`)
    .join(languageStartsWithChinese(language) ? "、" : ", ");
  const remainder = Math.max(0, entries.length - 4);
  if (!semanticActions) {
    if (languageStartsWithChinese(language)) {
      return `主持人可在本局记录 ${entries.length} 个受限模块字段：${labels}${remainder ? `等 ${entries.length} 项` : ""}；操作仅限定义声明的类型与上限。`;
    }
    return `The host may update ${entries.length} bounded local module field${entries.length === 1 ? "" : "s"}: ${labels}${remainder ? ` and ${remainder} more` : ""}; operations remain limited by the locked definition.`;
  }
  if (languageStartsWithChinese(language)) {
    return `主持人可调用 ${entries.length} 个受限语义动作：${labels}${remainder ? `等 ${entries.length} 项` : ""}；Runtime 只执行锁定的类型、数量与操作。`;
  }
  return `The host may call ${entries.length} bounded semantic action${entries.length === 1 ? "" : "s"}: ${labels}${remainder ? ` and ${remainder} more` : ""}; Runtime execution remains limited by the locked definition.`;
}

function buildReadSummary(companion, language) {
  const views = companion.readViews.map((view) => view.id).join(languageStartsWithChinese(language) ? "、" : ", ");
  if (languageStartsWithChinese(language)) return `主持人可按需读取这些固定视图：${views}；Runtime 不判断叙事语义。`;
  return `The host may inspect these fixed views: ${views}; Runtime does not judge narrative semantics.`;
}

function buildLimitsSummary(language) {
  if (languageStartsWithChinese(language)) {
    return "仅限当前故事的模块私有状态；总量受 Engine 固定配额限制；不能修改核心状态、其他故事、本机文件或网络。";
  }
  return "Limited to private module state in this story under fixed Engine quotas; it cannot modify core state, other stories, local files, or the network.";
}

function assertModuleLockMatchesDefinition(skill, definition, lock) {
  validateContract("skill-module-definition-v1", definition);
  const expectedRef = deriveModuleRef(skill, lock.definitionHash);
  const expectedGrant = deriveGrant(definition, expectedRef, lock.definitionHash);
  if (lock.moduleRef !== expectedRef || hashCanonical(lock.grant) !== hashCanonical(expectedGrant)) {
    throw snapshotError("SNAPSHOT_MODULE_GRANT_MISMATCH", "Locked Skill module grant does not match its definition.", {
      item_id: skill.id || skill.itemId,
    });
  }
  return expectedGrant;
}

function assertSkillIOLockMatchesCompanion(companion, lock, moduleRef) {
  try {
    validateContract("skill-io-companion-v1", companion);
  } catch {
    throw snapshotError("SNAPSHOT_SKILL_IO_INVALID", "Locked Skill I/O companion is invalid.");
  }
  const expected = buildSkillIOLock(companion, lock.companionHash, moduleRef || null);
  if (hashCanonical(expected) !== hashCanonical(lock)) {
    throw snapshotError("SNAPSHOT_SKILL_IO_LOCK_MISMATCH", "Locked Skill I/O metadata does not match its companion.");
  }
  return true;
}

function projectItemFingerprint(item) {
  return {
    packId: item.packId,
    packTitle: item.packTitle,
    packVersion: item.packVersion,
    ownership: item.ownership,
    itemId: item.id,
    type: item.type,
    title: item.title,
    language: item.language,
    description: item.description,
    danger: item.danger,
    skillClass: item.skillClass,
    triggers: item.triggers,
    playerGuide: item.playerGuide,
    sourceFiles: item.sourceFiles,
    module: item.module ? {
      schemaVersion: item.module.schemaVersion,
      path: item.module.path,
      sha256: item.module.sha256,
      sizeBytes: item.module.sizeBytes,
    } : null,
    skillIO: item.skillIO ? {
      schemaVersion: item.skillIO.schemaVersion,
      path: item.skillIO.path,
      sha256: item.skillIO.sha256,
      sizeBytes: item.skillIO.sizeBytes,
    } : null,
    localization: item.localization ? {
      schemaVersion: item.localization.schemaVersion,
      path: item.localization.path,
      sha256: item.localization.sha256,
      sizeBytes: item.localization.sizeBytes,
      locales: item.localization.locales.map((locale) => ({
        locale: locale.locale,
        body: locale.body,
        templates: locale.templates,
        modulePresentation: locale.modulePresentation
          ? {
            path: locale.modulePresentation.path,
            sha256: locale.modulePresentation.sha256,
            sizeBytes: locale.modulePresentation.sizeBytes,
          }
          : null,
      })),
    } : null,
  };
}

function refKey(ref) {
  return `${ref.packId}:${ref.itemId || ref.id}`;
}

function languageStartsWithChinese(value) {
  return String(value || "").toLowerCase().startsWith("zh");
}

function compareOperations(left, right) {
  return (OPERATION_ORDER.get(left) ?? 99) - (OPERATION_ORDER.get(right) ?? 99) || left.localeCompare(right);
}

function requirePlan(value) {
  if (!value || value.schemaVersion !== "grey-crow-content-load-plan-v2" || !Array.isArray(value.skills)) {
    throw snapshotError("SKILL_MODULE_PLAN_INVALID", "A resolved content plan is required.");
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

module.exports = {
  MODULE_LIMITS_VERSION,
  SKILL_MODULE_FEATURE,
  SKILL_IO_FEATURE,
  SKILL_PANEL_PRESENTATION_FEATURE,
  SKILL_PANEL_PRESENTATION_V2_FEATURE,
  assertModuleLockMatchesDefinition,
  assertSkillIOLockMatchesCompanion,
  deriveGrant,
  deriveModuleRef,
  prepareSkillPanelPresentationV2,
  prepareSkillModuleSnapshot,
};
