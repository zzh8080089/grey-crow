"use strict";

const { hashCanonical } = require("../../content-v2/snapshot-utils");

const MIN_SKILL_DESCRIPTION_CHARS = 12;
const WRITE_PERMISSION = "write_current_saveRoot_via_tools";
const SKILL_PANEL_PRESENTATION_FEATURE = "skill-panel-presentation-v1";
const SKILL_PANEL_PRESENTATION_V2_FEATURE = "skill-panel-presentation-v2";
const SKILL_MODULE_FEATURE = "skill-module-v1";
const SKILL_LOCALIZATION_FEATURE = "skill-localization-v1";
const SKILL_IO_FEATURE = "skill-io-companion-v1";
const BUILT_IN_DOMAIN_SKILL_IO_FEATURE = "built-in-domain-skill-io-v1";
const CHARACTER_DOMAIN_SKILL_ID = "characters";
const CHARACTER_DOMAIN_NAMESPACE = "builtin_characters_v1";
const CHARACTER_READ_VIEWS = Object.freeze([
  Object.freeze({ id: "guide", operation: "read_character_guide", query: false, limit: 1 }),
  Object.freeze({ id: "overview", operation: "read_character_overview", query: false, limit: 5 }),
  Object.freeze({ id: "recent", operation: "read_recent_characters", query: false, limit: 5 }),
  Object.freeze({ id: "lookup", operation: "lookup_characters", query: true, limit: 5 }),
]);
const CHARACTER_DOMAIN_ACTIONS = Object.freeze([
  characterDomainAction("remember_new_character", "create_character", [
    characterTextInput("description", 800),
    characterTextInput("encounter", 800),
  ]),
  characterDomainAction("record_character_encounter", "append_encounter", [
    characterTextInput("character", 80),
    characterTextInput("encounter", 800),
  ]),
  characterDomainAction("identify_character", "record_identity", [
    characterTextInput("character", 80),
    characterTextInput("name", 160),
    characterEnumInput("basis", ["self_reported", "observed", "alias", "rumor"]),
  ]),
  characterDomainAction("record_character_fact", "append_fact", [
    characterTextInput("character", 80),
    characterTextInput("fact", 800),
    characterEnumInput("authority", [
      "observed",
      "self_reported",
      "player_claim",
      "rumor",
      "narrative_event",
      "disputed",
    ]),
  ]),
  characterDomainAction("update_character_relationship", "set_relationship", [
    characterTextInput("character", 80),
    characterTextInput("relationship", 400),
  ]),
]);
const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_WIDGETS = Object.freeze({
  integer: new Set(["number", "progress", "meter"]),
  number: new Set(["number", "progress", "meter"]),
  text: new Set(["text", "multiline"]),
  boolean: new Set(["indicator"]),
  enum: new Set(["badge", "text"]),
  string_list: new Set(["chips", "list"]),
  record_list: new Set(["cards", "timeline", "table"]),
});
const FIELD_OPERATIONS = Object.freeze({
  integer: new Set(["set"]),
  number: new Set(["set"]),
  text: new Set(["set", "clear"]),
  boolean: new Set(["set"]),
  enum: new Set(["set"]),
  string_list: new Set(["set", "clear"]),
  record_list: new Set(["append", "remove_by_id", "clear"]),
});
const FIELD_TYPE_PROPERTIES = Object.freeze({
  integer: new Set(["minimum", "maximum"]),
  number: new Set(["minimum", "maximum"]),
  text: new Set(["maxLength"]),
  boolean: new Set(),
  enum: new Set(["options"]),
  string_list: new Set(["maxItems", "itemMaxLength"]),
  record_list: new Set(["maxItems", "itemFields"]),
});
const BASE_FIELD_PROPERTIES = new Set(["id", "label", "type", "default", "modelWritable", "allowedOperations", "display"]);
const ENGINE_RECORD_FIELD_IDS = new Set(["entry_id", "created_turn", "created_at"]);
const RESERVED_ACTION_TOOL_NAMES = new Set([
  "shell",
  "read_file",
  "write_file",
  "network_scan",
  "read_skill_module_state",
  "update_skill_module_state",
]);

function validateSemanticContract(contractId, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  if (contractId === "adventure-save-v2") {
    return validateAdventureSave(value);
  }
  if (contractId === "extension-pack-v2") {
    return validateExtensionPack(value);
  }
  if (contractId === "content-profile-v2") {
    return validateContentProfile(value);
  }
  if (contractId === "snapshot-lock-v2") {
    return validateSnapshotLock(value);
  }
  if (contractId === "memory-frontmatter-v2") {
    return validateMemoryFrontmatter(value);
  }
  if (contractId === "source-range-v2") {
    return validateSourceRange(value);
  }
  if (contractId === "skill-module-definition-v1") {
    return validateSkillModuleDefinition(value);
  }
  if (contractId === "skill-module-state-v1") {
    return validateSkillModuleState(value);
  }
  if (contractId === "skill-module-grant-v1") {
    return validateSkillModuleGrant(value);
  }
  if (contractId === "skill-module-capability-review-v1") {
    return validateSkillModuleCapabilityReview(value);
  }
  if (contractId === "skill-io-companion-v1") {
    return validateSkillIOCompanion(value);
  }
  if (contractId === "built-in-domain-skill-io-v1") {
    return validateBuiltInDomainSkillIO(value);
  }
  if (contractId === "built-in-domain-skill-grant-v1") {
    return validateBuiltInDomainSkillGrant(value);
  }
  if (contractId === "built-in-domain-skill-lock-v1") {
    return validateBuiltInDomainSkillLock(value);
  }
  if (contractId === "skill-panel-presentation-v1") {
    return validateSkillPanelPresentation(value);
  }
  if (contractId === "skill-panel-presentation-v2") {
    return validateSkillPanelPresentationV2(value);
  }
  if (contractId === "skill-panel-view-projection-v1") {
    return validateSkillPanelViewProjection(value);
  }
  if (contractId === "skill-module-projection-v1") {
    return validateSkillModuleProjection(value);
  }
  if (contractId === "skill-localization-bundle-v1") {
    return validateSkillLocalizationBundle(value);
  }
  if (contractId === "skill-module-presentation-overlay-v1") {
    return validateSkillModulePresentationOverlay(value);
  }
  if (contractId === "skill-localization-lock-v1") {
    return validateSkillLocalizationLock(value);
  }
  if (contractId === "skill-locale-coverage-v1") {
    return validateSkillLocaleCoverage(value);
  }
  if (contractId === "new-game-preset-v2") {
    return validateNewGamePreset(value);
  }
  if (contractId === "story-finale-candidate-v1") {
    return validateStoryFinaleCandidate(value);
  }
  if (contractId === "story-finale-decision-v1") {
    return validateStoryFinaleDecision(value);
  }
  if (contractId === "story-finale-ledger-v1") {
    return validateStoryFinaleLedger(value);
  }
  if (contractId === "story-finale-projection-v1") {
    return validateStoryFinaleProjection(value);
  }
  if (contractId === "story-finale-transaction-v1") {
    return validateStoryFinaleTransaction(value);
  }
  if (contractId === "extreme-ending-easter-candidate-v1") {
    return validateExtremeEndingEasterCandidate(value);
  }
  if (contractId === "extreme-ending-easter-confirmation-v1") {
    return validateExtremeEndingEasterConfirmation(value);
  }
  if (contractId === "extreme-ending-easter-receipt-v1") {
    return validateExtremeEndingEasterReceipt(value);
  }
  if (contractId === "extreme-ending-easter-ledger-v1") {
    return validateExtremeEndingEasterLedger(value);
  }
  if (contractId === "extreme-ending-easter-projection-v1") {
    return validateExtremeEndingEasterProjection(value);
  }
  if (contractId === "adventure-lineage-v1") {
    return validateAdventureLineage(value);
  }
  return [];
}

function validateAdventureSave(value) {
  const issues = [];
  if (value.creationState === "creating" && value.contentProfileRef !== null) {
    issues.push(issue("/contentProfileRef", "creation_state", "must be null while the adventure is creating"));
  }
  if (value.creationState && value.creationState !== "creating" && value.contentProfileRef === null) {
    issues.push(issue("/contentProfileRef", "creation_state", "is required after adventure creation"));
  }
  return issues;
}

function validateExtensionPack(value) {
  const issues = [];
  pushDuplicateIssues(issues, value.provides, (item) => item?.id, "/provides", "provide item id");
  pushDuplicateIssues(
    issues,
    (Array.isArray(value.provides) ? value.provides : []).filter((item) => item?.module?.path),
    (item) => item.module.path,
    "/provides",
    "Skill module resource path"
  );
  pushDuplicateIssues(
    issues,
    (Array.isArray(value.provides) ? value.provides : []).filter((item) => item?.skillIO?.path),
    (item) => item.skillIO.path,
    "/provides",
    "Skill I/O companion resource path"
  );
  pushDuplicateIssues(
    issues,
    (Array.isArray(value.provides) ? value.provides : []).filter((item) => item?.localization?.path),
    (item) => item.localization.path,
    "/provides",
    "content localization resource path"
  );

  const languages = new Set(Array.isArray(value.languages) ? value.languages : []);
  const permissions = new Set(Array.isArray(value.permissions) ? value.permissions : []);
  for (const [index, item] of arrayEntries(value.provides)) {
    if (item?.language && !languages.has(item.language)) {
      issues.push(issue(`/provides/${index}/language`, "language_membership", "must be declared by the pack"));
    }
    if (item?.type !== "skill" && hasAnyOwn(item, ["skillClass", "triggers", "templates", "readScopes", "writeScopes", "replaces", "playerGuide", "module", "skillIO"])) {
      issues.push(issue(`/provides/${index}`, "item_fields", "non-skill items cannot declare skill-only fields"));
    }
    if (item?.type === "skill" && item.skillClass === "new_game") {
      if (!Array.isArray(item.triggers) || !item.triggers.includes("ui_start_new_game")) {
        issues.push(issue(`/provides/${index}/triggers`, "lifecycle_trigger", "New Game Skill must declare ui_start_new_game"));
      }
      if (item.replaces) {
        issues.push(issue(`/provides/${index}/replaces`, "lifecycle_replacement", "New Game Skill is selected directly and cannot declare replaces"));
      }
    }
    if (item?.type === "skill") {
      validateSkillMetadata(issues, item, index, permissions);
      if (item.skillClass !== "ordinary" && hasAnyOwn(item, ["playerGuide", "module", "skillIO"])) {
        issues.push(issue(`/provides/${index}`, "ordinary_skill_feature", "playerGuide, module and skillIO are only available to ordinary Skills"));
      }
      validateSkillModuleRef(issues, item, index);
      validateSkillIORef(issues, item, index);
      validateSkillLocalizationRef(issues, item, index);
    } else if (item?.localization) {
      validateSkillLocalizationRef(issues, item, index);
    }
  }
  return issues;
}

function validateSkillLocalizationRef(issues, item, index) {
  if (!item?.localization) {
    return;
  }
  const contentPath = typeof item.path === "string" ? item.path : "";
  const slash = contentPath.lastIndexOf("/");
  const expectedPath = slash > 0 ? `${contentPath.slice(0, slash)}/localizations.json` : "";
  if (!expectedPath || item.localization.path !== expectedPath) {
    issues.push(issue(
      `/provides/${index}/localization/path`,
      "localization_scope",
      "must be the localizations.json resource beside this content entry"
    ));
  }
}

function validateSkillModuleRef(issues, item, index) {
  if (!item?.module) {
    return;
  }
  const skillPath = typeof item.path === "string" ? item.path : "";
  const slash = skillPath.lastIndexOf("/");
  const expectedPath = slash > 0 ? `${skillPath.slice(0, slash)}/module.json` : "";
  if (!expectedPath || item.module.path !== expectedPath) {
    issues.push(issue(`/provides/${index}/module/path`, "module_scope", "must be the module.json resource beside this Skill entry"));
  }
}

function validateSkillIORef(issues, item, index) {
  if (!item?.skillIO) return;
  const skillPath = typeof item.path === "string" ? item.path : "";
  const slash = skillPath.lastIndexOf("/");
  const expectedPath = slash > 0 ? `${skillPath.slice(0, slash)}/skill-io.json` : "";
  if (!expectedPath || item.skillIO.path !== expectedPath) {
    issues.push(issue(`/provides/${index}/skillIO/path`, "skill_io_scope", "must be the skill-io.json resource beside this Skill entry"));
  }
}

function validateSkillMetadata(issues, item, index, permissions) {
  const basePath = `/provides/${index}`;
  const description = normalizedText(item.description);
  const title = normalizedText(item.title);
  if (unicodeLength(description) < MIN_SKILL_DESCRIPTION_CHARS || description.toLowerCase() === title.toLowerCase()) {
    issues.push(issue(`${basePath}/description`, "skill_description", "must briefly explain what the Skill does and when it applies"));
  }

  const seenTriggers = new Set();
  for (const [triggerIndex, trigger] of arrayEntries(item.triggers)) {
    const normalized = normalizedLookupText(trigger);
    if (!normalized || /[\u0000-\u001F\u007F]/.test(String(trigger || ""))) {
      issues.push(issue(`${basePath}/triggers/${triggerIndex}`, "trigger_format", "must be a visible semantic hint"));
      continue;
    }
    if (seenTriggers.has(normalized)) {
      issues.push(issue(`${basePath}/triggers/${triggerIndex}`, "duplicate_trigger", "must be unique after whitespace and case normalization"));
    }
    seenTriggers.add(normalized);
  }

  const skillPath = typeof item.path === "string" ? item.path : "";
  const slash = skillPath.lastIndexOf("/");
  const skillRoot = slash > 0 ? skillPath.slice(0, slash) : "";
  const templateRoot = skillRoot ? `${skillRoot}/templates/` : "";
  const seenTemplateIds = new Set();
  for (const [templateIndex, templatePath] of arrayEntries(item.templates)) {
    const relativePath = String(templatePath || "");
    const filename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    const templateId = filename.replace(/\.md$/i, "").toLowerCase();
    if (!templateRoot || !relativePath.startsWith(templateRoot) || relativePath === templateRoot) {
      issues.push(issue(`${basePath}/templates/${templateIndex}`, "template_scope", "must remain inside this Skill's templates directory"));
    }
    if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(templateId)) {
      issues.push(issue(`${basePath}/templates/${templateIndex}`, "template_id", "must resolve to a stable template id"));
    } else if (seenTemplateIds.has(templateId)) {
      issues.push(issue(`${basePath}/templates/${templateIndex}`, "duplicate_template_id", "must resolve to a unique template id"));
    }
    seenTemplateIds.add(templateId);
  }

  if (Array.isArray(item.writeScopes) && item.writeScopes.length > 0 && !permissions.has(WRITE_PERMISSION)) {
    issues.push(issue(`${basePath}/writeScopes`, "write_permission", `requires pack permission ${WRITE_PERMISSION}`));
  }
}

function validateContentProfile(value) {
  const issues = [];
  pushDuplicateIssues(issues, value.skills, (item) => item?.itemId, "/skills", "skill item id");
  if (value.newGameSkill?.itemId && value.skills?.some((item) => item?.itemId === value.newGameSkill.itemId)) {
    issues.push(issue("/newGameSkill", "duplicate_id", "New Game Skill cannot also be selected as an ordinary Skill"));
  }
  pushDuplicateIssues(
    issues,
    value.replacements,
    (item) => item?.replacedItemId,
    "/replacements",
    "replaced item id"
  );
  issues.push(...validateLockedSkillFeatures(value, [
    { item: value.host, path: "/host" },
    { item: value.world, path: "/world" },
    { item: value.newGameSkill, path: "/newGameSkill" },
    ...(Array.isArray(value.skills)
      ? value.skills.map((item, index) => ({ item, path: `/skills/${index}` }))
      : []),
  ]));
  return issues;
}

function validateSnapshotLock(value) {
  const issues = [];
  pushDuplicateIssues(issues, value.items, (item) => `${item?.itemType || ""}:${item?.itemId || ""}`, "/items", "item reference");
  pushDuplicateIssues(issues, value.files, (item) => item?.relativePath, "/files", "snapshot path");
  const newGameSkills = Array.isArray(value.items)
    ? value.items.filter((item) => item?.itemType === "skill" && item?.skillClass === "new_game")
    : [];
  if (newGameSkills.length !== 1) {
    issues.push(issue("/items", "new_game_skill_count", "snapshot must contain exactly one New Game Skill"));
  }
  issues.push(...validateLockedSkillFeatures(
    value,
    (Array.isArray(value.items) ? value.items : []).map((item, index) => ({ item, path: `/items/${index}` }))
  ));
  if (isPlainObject(value.skillPanelPresentation)) {
    const file = (Array.isArray(value.files) ? value.files : [])
      .find((item) => item?.relativePath === value.skillPanelPresentation.relativePath);
    if (!file) {
      issues.push(issue(
        "/skillPanelPresentation/relativePath",
        "presentation_file",
        "must reference a tracked snapshot file"
      ));
    } else if (file.sha256 !== value.skillPanelPresentation.sha256) {
      issues.push(issue(
        "/skillPanelPresentation/sha256",
        "presentation_hash",
        "must match the tracked snapshot file hash"
      ));
    }
  }
  if (isPlainObject(value.skillPanelPresentationV2)) {
    const file = (Array.isArray(value.files) ? value.files : [])
      .find((item) => item?.relativePath === value.skillPanelPresentationV2.relativePath);
    if (!file) {
      issues.push(issue(
        "/skillPanelPresentationV2/relativePath",
        "presentation_file",
        "must reference a tracked snapshot file"
      ));
    } else if (file.sha256 !== value.skillPanelPresentationV2.sha256) {
      issues.push(issue(
        "/skillPanelPresentationV2/sha256",
        "presentation_hash",
        "must match the tracked snapshot file hash"
      ));
    }
  }
  if (isPlainObject(value.skillLocalization)) {
    const file = (Array.isArray(value.files) ? value.files : [])
      .find((item) => item?.relativePath === value.skillLocalization.relativePath);
    if (!file) {
      issues.push(issue(
        "/skillLocalization/relativePath",
        "localization_file",
        "must reference a tracked snapshot file"
      ));
    } else if (file.sha256 !== value.skillLocalization.sha256) {
      issues.push(issue(
        "/skillLocalization/sha256",
        "localization_hash",
        "must match the tracked snapshot file hash"
      ));
    }
  }
  for (const [index, builtInSkill] of (value.builtInDomainSkills || []).entries()) {
    for (const resourceName of ["companion", "grant", "lock"]) {
      const resource = builtInSkill?.[resourceName];
      const file = (Array.isArray(value.files) ? value.files : [])
        .find((item) => item?.relativePath === resource?.relativePath);
      if (!file) {
        issues.push(issue(
          `/builtInDomainSkills/${index}/${resourceName}/relativePath`,
          "built_in_domain_skill_file",
          "must reference a tracked snapshot file"
        ));
      } else if (file.sha256 !== resource.sha256) {
        issues.push(issue(
          `/builtInDomainSkills/${index}/${resourceName}/sha256`,
          "built_in_domain_skill_hash",
          "must match the tracked snapshot file hash"
        ));
      }
    }
  }
  return issues;
}

function validateLockedSkillFeatures(value, itemEntries) {
  const issues = [];
  const features = new Set(Array.isArray(value.features) ? value.features : []);
  const hasPanelFeature = features.has(SKILL_PANEL_PRESENTATION_FEATURE);
  const hasPanelPresentation = hasAnyOwn(value, ["skillPanelPresentation"]);
  const hasPanelV2Feature = features.has(SKILL_PANEL_PRESENTATION_V2_FEATURE);
  const hasPanelPresentationV2 = hasAnyOwn(value, ["skillPanelPresentationV2"]);
  const moduleEntries = itemEntries.filter((entry) => hasAnyOwn(entry.item, ["skillModule"]));
  const hasModuleFeature = features.has(SKILL_MODULE_FEATURE);
  const skillIOEntries = itemEntries.filter((entry) => hasAnyOwn(entry.item, ["skillIO"]));
  const hasSkillIOFeature = features.has(SKILL_IO_FEATURE);
  const hasModuleReview = hasAnyOwn(value, ["moduleReviewHash"]);
  const hasWritableModule = moduleEntries.some((entry) => Array.isArray(entry.item?.skillModule?.grant?.writableFields)
    && entry.item.skillModule.grant.writableFields.length > 0);
  const hasLocalizationFeature = features.has(SKILL_LOCALIZATION_FEATURE);
  const hasLocalizationLock = hasAnyOwn(value, ["skillLocalization"]);
  const builtInDomainSkills = Array.isArray(value.builtInDomainSkills) ? value.builtInDomainSkills : [];
  const hasBuiltInDomainSkillFeature = features.has(BUILT_IN_DOMAIN_SKILL_IO_FEATURE);
  const hasBuiltInDomainSkills = builtInDomainSkills.length > 0;

  if (hasPanelFeature !== hasPanelPresentation) {
    issues.push(issue(
      hasPanelFeature ? "/skillPanelPresentation" : "/features",
      "skill_panel_feature",
      "skill-panel-presentation-v1 and skillPanelPresentation must be declared together"
    ));
  }
  if (hasPanelV2Feature !== hasPanelPresentationV2) {
    issues.push(issue(
      hasPanelV2Feature ? "/skillPanelPresentationV2" : "/features",
      "skill_panel_v2_feature",
      "skill-panel-presentation-v2 and skillPanelPresentationV2 must be declared together"
    ));
  }
  if (hasPanelV2Feature && !hasPanelFeature) {
    issues.push(issue(
      "/features",
      "skill_panel_v2_compatibility",
      "skill-panel-presentation-v2 requires the sealed v1 presentation compatibility lock"
    ));
  }
  if (hasModuleFeature !== (moduleEntries.length > 0)) {
    issues.push(issue(
      hasModuleFeature ? "/features" : moduleEntries[0]?.path || "/features",
      "skill_module_feature",
      "skill-module-v1 must be declared exactly when an ordinary Skill locks a module"
    ));
  }
  if (hasModuleFeature && !hasPanelFeature) {
    issues.push(issue(
      "/features",
      "skill_module_presentation",
      "skill-module-v1 requires skill-panel-presentation-v1"
    ));
  }
  if (hasSkillIOFeature !== (skillIOEntries.length > 0)) {
    issues.push(issue(
      hasSkillIOFeature ? "/features" : skillIOEntries[0]?.path || "/features",
      "skill_io_feature",
      "skill-io-companion-v1 must be declared exactly when an ordinary Skill locks a companion"
    ));
  }
  if (hasSkillIOFeature && !hasPanelFeature) {
    issues.push(issue("/features", "skill_io_presentation", "skill-io-companion-v1 requires skill-panel-presentation-v1"));
  }
  if (hasLocalizationFeature !== hasLocalizationLock) {
    issues.push(issue(
      hasLocalizationFeature ? "/skillLocalization" : "/features",
      "skill_localization_feature",
      "skill-localization-v1 and skillLocalization must be declared together"
    ));
  }
  if (hasBuiltInDomainSkillFeature !== hasBuiltInDomainSkills) {
    issues.push(issue(
      hasBuiltInDomainSkillFeature ? "/builtInDomainSkills" : "/features",
      "built_in_domain_skill_feature",
      "built-in-domain-skill-io-v1 and builtInDomainSkills must be declared together"
    ));
  }
  const seenBuiltInSkillIds = new Set();
  const seenBuiltInCapabilities = new Set();
  for (const [index, entry] of builtInDomainSkills.entries()) {
    if (seenBuiltInSkillIds.has(entry?.skillId)) {
      issues.push(issue(`/builtInDomainSkills/${index}/skillId`, "duplicate_id", "built-in Skill ids must be unique"));
    }
    if (seenBuiltInCapabilities.has(entry?.capability)) {
      issues.push(issue(`/builtInDomainSkills/${index}/capability`, "duplicate_id", "built-in Skill capabilities must be unique"));
    }
    seenBuiltInSkillIds.add(entry?.skillId);
    seenBuiltInCapabilities.add(entry?.capability);
  }
  if (hasWritableModule !== hasModuleReview) {
    issues.push(issue(
      "/moduleReviewHash",
      "module_review",
      "moduleReviewHash must be declared exactly when a locked module grants model writes"
    ));
  }

  const seenModuleRefs = new Set();
  for (const entry of moduleEntries) {
    const moduleLock = entry.item?.skillModule;
    if (entry.item?.itemType !== "skill" || entry.item?.skillClass !== "ordinary") {
      issues.push(issue(
        `${entry.path}/skillModule`,
        "ordinary_skill_module",
        "only an ordinary Skill may lock a Skill module"
      ));
    }
    const moduleRef = moduleLock?.moduleRef;
    if (typeof moduleRef === "string") {
      if (seenModuleRefs.has(moduleRef)) {
        issues.push(issue(
          `${entry.path}/skillModule/moduleRef`,
          "duplicate_id",
          "locked Skill module refs must be unique"
        ));
      }
      seenModuleRefs.add(moduleRef);
    }
    issues.push(...validateLockedSkillModule(moduleLock, `${entry.path}/skillModule`));
  }
  const seenNamespaces = new Set();
  for (const entry of skillIOEntries) {
    const skillIO = entry.item?.skillIO;
    if (entry.item?.itemType !== "skill" || entry.item?.skillClass !== "ordinary") {
      issues.push(issue(`${entry.path}/skillIO`, "ordinary_skill_io", "only an ordinary Skill may lock a Skill I/O companion"));
    }
    if (typeof skillIO?.namespace === "string") {
      if (seenNamespaces.has(skillIO.namespace)) {
        issues.push(issue(`${entry.path}/skillIO/namespace`, "duplicate_id", "locked Skill I/O namespaces must be unique"));
      }
      seenNamespaces.add(skillIO.namespace);
    }
    const expectedModuleRef = entry.item?.skillModule?.moduleRef || null;
    if ((skillIO?.moduleRef || null) !== expectedModuleRef) {
      issues.push(issue(`${entry.path}/skillIO/moduleRef`, "skill_io_module_ref", "must match the Skill module lock or remain null for a stateless companion"));
    }
    if (!Array.isArray(skillIO?.readViewIds) || !skillIO.readViewIds.includes("guide")) {
      issues.push(issue(`${entry.path}/skillIO/readViewIds`, "skill_io_guide", "must include the guide view"));
    }
    if ((skillIO?.actionIds || []).length > 0 && !skillIO?.moduleRef) {
      issues.push(issue(`${entry.path}/skillIO/actionIds`, "skill_io_action_state", "state-changing actions require a locked Skill module"));
    }
  }
  return issues;
}

function validateLockedSkillModule(value, basePath) {
  if (!isPlainObject(value) || !isPlainObject(value.grant)) {
    return [];
  }
  const issues = [];
  if (typeof value.moduleRef === "string" && value.grant.moduleRef !== value.moduleRef) {
    issues.push(issue(
      `${basePath}/grant/moduleRef`,
      "module_grant_ref",
      "must match the locked moduleRef"
    ));
  }
  if (typeof value.definitionHash === "string" && value.grant.definitionHash !== value.definitionHash) {
    issues.push(issue(
      `${basePath}/grant/definitionHash`,
      "module_grant_hash",
      "must match the locked definitionHash"
    ));
  }
  for (const grantIssue of validateSkillModuleGrant(value.grant)) {
    issues.push(issue(
      `${basePath}/grant${grantIssue.instancePath}`,
      grantIssue.keyword,
      grantIssue.message
    ));
  }
  return issues;
}

function validateMemoryFrontmatter(value) {
  if (value.supersededBy && value.supersededBy === value.memoryId) {
    return [issue("/supersededBy", "self_reference", "cannot reference the same memory id")];
  }
  return [];
}

function validateSourceRange(value) {
  if (Number.isInteger(value.startTurn) && Number.isInteger(value.endTurn) && value.startTurn > value.endTurn) {
    return [issue("/endTurn", "range_order", "must be greater than or equal to startTurn")];
  }
  return [];
}

function validateSkillModuleDefinition(value) {
  const issues = [];
  const fields = Array.isArray(value.fields) ? value.fields : [];
  if (fields.length === 0 && value.visibility !== "hidden_until_active") {
    issues.push(issue("/fields", "empty_module", "only a hidden lifecycle module may have no state fields"));
  }
  pushDuplicateIssues(issues, fields, (field) => field?.id, "/fields", "field id");
  pushNormalizedDuplicateIssues(issues, fields, (field) => field?.label, "/fields", "field label");

  const fieldById = new Map(fields.filter(isPlainObject).map((field) => [field.id, field]));
  for (const [index, field] of fields.entries()) {
    validateModuleField(issues, field, index);
  }

  const summaryFields = Array.isArray(value.summaryFields) ? value.summaryFields : [];
  for (const [index, fieldId] of summaryFields.entries()) {
    const field = fieldById.get(fieldId);
    if (!field) {
      issues.push(issue(`/summaryFields/${index}`, "summary_field_unknown", "must reference a field in this module"));
    } else if (field.type === "record_list" && !field.display?.summary) {
      issues.push(issue(`/summaryFields/${index}`, "summary_projection", "record lists require a fixed count summary before they can appear in the panel summary"));
    }
  }
  validateModuleActions(issues, value.actions, fieldById);
  return issues;
}

function validateModuleActions(issues, value, fieldById) {
  const actions = Array.isArray(value) ? value : [];
  pushDuplicateIssues(issues, actions, (action) => action?.id, "/actions", "action id");
  pushDuplicateIssues(issues, actions, (action) => action?.toolName, "/actions", "action tool name");
  const coveredFields = new Set();
  for (const [index, action] of actions.entries()) {
    if (!isPlainObject(action)) continue;
    const basePath = `/actions/${index}`;
    const target = fieldById.get(action.targetField);
    if (!target) {
      issues.push(issue(`${basePath}/targetField`, "action_target_unknown", "must reference a field in this module"));
      continue;
    }
    if (!target.modelWritable) {
      issues.push(issue(`${basePath}/targetField`, "action_target_read_only", "must reference a model-writable field"));
    }
    coveredFields.add(target.id);
    if (RESERVED_ACTION_TOOL_NAMES.has(action.toolName)) {
      issues.push(issue(`${basePath}/toolName`, "action_tool_reserved", "must not shadow a Runtime or forbidden tool"));
    }
    validateModuleActionShape(issues, action, target, fieldById, basePath);
  }
  if (actions.length > 0) {
    for (const field of fieldById.values()) {
      if (field.modelWritable && !coveredFields.has(field.id)) {
        issues.push(issue("/actions", "action_coverage", `must cover writable field ${field.id} when semantic actions are declared`));
      }
    }
  }
}

function validateModuleActionShape(issues, action, target, fieldById, basePath) {
  const modelFields = Array.isArray(action.modelFields) ? action.modelFields : [];
  const runtimeFields = Array.isArray(action.runtimeFields) ? action.runtimeFields : [];
  const constantFields = Array.isArray(action.constantFields) ? action.constantFields : [];
  const declaredRecordFields = [
    ...modelFields,
    ...runtimeFields.map((entry) => entry?.fieldId),
    ...constantFields.map((entry) => entry?.fieldId),
  ];
  pushDuplicateIssues(issues, declaredRecordFields, (fieldId) => fieldId, `${basePath}/modelFields`, "action record field");

  if (action.archetype === "append_record") {
    if (target.type !== "record_list" || !target.allowedOperations.includes("append")) {
      issues.push(issue(`${basePath}/archetype`, "action_archetype_target", "append_record requires an appendable record_list target"));
      return;
    }
    if ((action.allowedValues || []).length > 0) {
      issues.push(issue(`${basePath}/allowedValues`, "action_allowed_values", "append_record does not accept allowedValues"));
    }
    const itemById = new Map(target.itemFields.map((field) => [field.id, field]));
    const expected = [...itemById.keys()].sort();
    const actual = declaredRecordFields.filter(Boolean).sort();
    if (!sameStrings(expected, actual)) {
      issues.push(issue(`${basePath}/modelFields`, "action_record_shape", "model, Runtime, and constant fields must cover the target record exactly once"));
    }
    for (const [fieldIndex, fieldId] of modelFields.entries()) {
      if (!itemById.has(fieldId)) {
        issues.push(issue(`${basePath}/modelFields/${fieldIndex}`, "action_model_field_unknown", "must reference a target record item field"));
      }
    }
    for (const [fieldIndex, runtimeField] of runtimeFields.entries()) {
      const itemField = itemById.get(runtimeField?.fieldId);
      if (!itemField || runtimeField?.source !== "current_game_day" || itemField.type !== "integer") {
        issues.push(issue(`${basePath}/runtimeFields/${fieldIndex}`, "action_runtime_source", "current_game_day must populate an integer target record field"));
      }
    }
    for (const [fieldIndex, constantField] of constantFields.entries()) {
      const itemField = itemById.get(constantField?.fieldId);
      if (!itemField || !validateScalarAgainstItemField(constantField?.value, itemField)) {
        issues.push(issue(`${basePath}/constantFields/${fieldIndex}`, "action_constant_value", "must match the target record item field"));
      }
    }
    if (action.namedPolicy === "memory_fragment_record_v1") {
      const requiredIds = ["game_day", "discovery_mode", "dimension", "trigger", "content", "certainty"];
      if (!sameStrings([...itemById.keys()].sort(), requiredIds.sort())) {
        issues.push(issue(`${basePath}/namedPolicy`, "action_named_policy", "memory_fragment_record_v1 requires the stable memory fragment record shape"));
      }
    } else if (action.namedPolicy !== "none") {
      issues.push(issue(`${basePath}/namedPolicy`, "action_named_policy", "is not compatible with append_record"));
    }
    if (action.namedTransition === "unlock_at_record_limit") {
      const status = fieldById.get("revelation_status");
      const values = new Set((status?.options || []).map((option) => option.value));
      if (status?.type !== "enum" || !status.allowedOperations.includes("set") || !values.has("available")) {
        issues.push(issue(`${basePath}/namedTransition`, "action_named_transition", "unlock_at_record_limit requires a writable revelation_status enum with available"));
      }
    } else if (action.namedTransition !== "none") {
      issues.push(issue(`${basePath}/namedTransition`, "action_named_transition", "is not compatible with append_record"));
    }
    return;
  }

  if (action.archetype === "choose_enum") {
    const allowedValues = Array.isArray(action.allowedValues) ? action.allowedValues : [];
    const targetValues = new Set((target.options || []).map((option) => option.value));
    if (target.type !== "enum" || !target.allowedOperations.includes("set")) {
      issues.push(issue(`${basePath}/archetype`, "action_archetype_target", "choose_enum requires a writable enum target"));
    }
    if (!sameStrings(modelFields, ["choice"]) || runtimeFields.length > 0 || constantFields.length > 0) {
      issues.push(issue(`${basePath}/modelFields`, "action_choose_shape", "choose_enum exposes only the flat choice field"));
    }
    if (allowedValues.length === 0 || allowedValues.some((value) => !targetValues.has(value))) {
      issues.push(issue(`${basePath}/allowedValues`, "action_allowed_values", "must be a non-empty subset of target enum values"));
    }
    if (action.namedPolicy !== "none" && action.namedPolicy !== "memory_fragment_resolution_v1") {
      issues.push(issue(`${basePath}/namedPolicy`, "action_named_policy", "is not compatible with choose_enum"));
    }
    if (action.namedTransition !== "none") {
      issues.push(issue(`${basePath}/namedTransition`, "action_named_transition", "choose_enum does not accept a named transition"));
    }
  }
}

function validateModuleField(issues, field, index) {
  if (!isPlainObject(field)) {
    return;
  }
  const basePath = `/fields/${index}`;
  const type = field.type;
  const allowedTypeProperties = FIELD_TYPE_PROPERTIES[type];
  if (allowedTypeProperties) {
    for (const key of Object.keys(field)) {
      if (!BASE_FIELD_PROPERTIES.has(key) && !allowedTypeProperties.has(key)) {
        issues.push(issue(`${basePath}/${key}`, "field_property", `is not valid for ${type} fields`));
      }
    }
  }

  const operations = Array.isArray(field.allowedOperations) ? field.allowedOperations : [];
  const permittedOperations = FIELD_OPERATIONS[type];
  for (const [operationIndex, operation] of operations.entries()) {
    if (permittedOperations && !permittedOperations.has(operation)) {
      issues.push(issue(`${basePath}/allowedOperations/${operationIndex}`, "field_operation", `is not supported by ${type} fields`));
    }
  }
  if (field.modelWritable === false && operations.length > 0) {
    issues.push(issue(`${basePath}/allowedOperations`, "read_only_operations", "must be empty when modelWritable is false"));
  }
  if (field.modelWritable === true && operations.length === 0) {
    issues.push(issue(`${basePath}/allowedOperations`, "writable_operations", "must declare at least one bounded operation when modelWritable is true"));
  }

  const widgets = FIELD_WIDGETS[type];
  if (widgets && !widgets.has(field.display?.widget)) {
    issues.push(issue(`${basePath}/display/widget`, "field_widget", `is not supported by ${type} fields`));
  }
  if (type !== "record_list" && hasAnyOwn(field.display, ["groupCountBy", "summary"])) {
    issues.push(issue(`${basePath}/display`, "derived_display", "group counts and count summaries are only valid for record lists"));
  }

  if (type === "integer" || type === "number") {
    validateNumericField(issues, field, basePath, type === "integer");
  } else if (type === "text") {
    if (!Number.isInteger(field.maxLength)) {
      issues.push(issue(`${basePath}/maxLength`, "text_limit", "must declare a bounded text length"));
    }
    if (typeof field.default !== "string" || unicodeLength(field.default) > field.maxLength) {
      issues.push(issue(`${basePath}/default`, "field_default", "must be text within maxLength"));
    }
  } else if (type === "boolean") {
    if (typeof field.default !== "boolean") {
      issues.push(issue(`${basePath}/default`, "field_default", "must be a boolean"));
    }
  } else if (type === "enum") {
    validateOptions(issues, field.options, `${basePath}/options`);
    const values = new Set((Array.isArray(field.options) ? field.options : []).map((option) => option?.value));
    if (typeof field.default !== "string" || !values.has(field.default)) {
      issues.push(issue(`${basePath}/default`, "field_default", "must match one declared enum option"));
    }
  } else if (type === "string_list") {
    if (!Number.isInteger(field.maxItems) || field.maxItems > 64) {
      issues.push(issue(`${basePath}/maxItems`, "list_limit", "must declare at most 64 string items"));
    }
    if (!Number.isInteger(field.itemMaxLength)) {
      issues.push(issue(`${basePath}/itemMaxLength`, "list_item_limit", "must declare a bounded item length"));
    }
    const validDefault = Array.isArray(field.default)
      && field.default.length <= field.maxItems
      && field.default.every((item) => typeof item === "string" && unicodeLength(item) <= field.itemMaxLength);
    if (!validDefault) {
      issues.push(issue(`${basePath}/default`, "field_default", "must be a bounded list of strings"));
    }
  } else if (type === "record_list") {
    validateRecordField(issues, field, basePath);
  }
}

function validateNumericField(issues, field, basePath, integerOnly) {
  const validBounds = typeof field.minimum === "number"
    && Number.isFinite(field.minimum)
    && typeof field.maximum === "number"
    && Number.isFinite(field.maximum)
    && field.minimum <= field.maximum
    && (!integerOnly || (Number.isInteger(field.minimum) && Number.isInteger(field.maximum)));
  if (!validBounds) {
    issues.push(issue(`${basePath}/minimum`, "numeric_bounds", "must declare an ordered, type-compatible minimum and maximum"));
  }
  const validDefault = typeof field.default === "number"
    && Number.isFinite(field.default)
    && (!integerOnly || Number.isInteger(field.default))
    && field.default >= field.minimum
    && field.default <= field.maximum;
  if (!validDefault) {
    issues.push(issue(`${basePath}/default`, "field_default", "must be within the declared numeric bounds"));
  }
}

function validateRecordField(issues, field, basePath) {
  if (!Number.isInteger(field.maxItems)) {
    issues.push(issue(`${basePath}/maxItems`, "list_limit", "must declare a bounded record count"));
  }
  const itemFields = Array.isArray(field.itemFields) ? field.itemFields : [];
  pushDuplicateIssues(issues, itemFields, (item) => item?.id, `${basePath}/itemFields`, "record item field id");
  pushNormalizedDuplicateIssues(issues, itemFields, (item) => item?.label, `${basePath}/itemFields`, "record item field label");
  for (const [index, itemField] of itemFields.entries()) {
    validateRecordItemField(issues, itemField, `${basePath}/itemFields/${index}`);
    if (ENGINE_RECORD_FIELD_IDS.has(itemField?.id)) {
      issues.push(issue(`${basePath}/itemFields/${index}/id`, "reserved_item_field", "is reserved for Engine-owned record metadata"));
    }
  }

  const validDefault = Array.isArray(field.default)
    && field.default.length <= field.maxItems
    && field.default.every((item) => validateRecordDefaultItem(item, itemFields));
  if (!validDefault) {
    issues.push(issue(`${basePath}/default`, "field_default", "must be a bounded list matching every declared item field"));
  }

  const groupCountBy = field.display?.groupCountBy;
  if (groupCountBy) {
    const groupedField = itemFields.find((item) => item?.id === groupCountBy);
    if (!groupedField || groupedField.type !== "enum") {
      issues.push(issue(`${basePath}/display/groupCountBy`, "group_field", "must reference an enum item field in this record"));
    }
  }

  const summary = field.display?.summary;
  if (summary) {
    if (summary.mode === "count_progress") {
      if (!Number.isInteger(summary.target) || summary.target > field.maxItems) {
        issues.push(issue(`${basePath}/display/summary/target`, "summary_target", "must be present and no greater than maxItems"));
      }
    } else if (hasAnyOwn(summary, ["target"])) {
      issues.push(issue(`${basePath}/display/summary/target`, "summary_target", "is only valid for count_progress"));
    }
    let previous = -1;
    for (const [index, milestone] of arrayEntries(summary.milestones)) {
      if (!Number.isInteger(milestone?.minimum) || milestone.minimum <= previous || milestone.minimum > (summary.target || field.maxItems)) {
        issues.push(issue(`${basePath}/display/summary/milestones/${index}/minimum`, "milestone_order", "must increase and remain within the summary limit"));
      }
      previous = milestone?.minimum;
    }
  }
}

function validateRecordItemField(issues, field, basePath) {
  if (!isPlainObject(field)) {
    return;
  }
  const allowed = FIELD_TYPE_PROPERTIES[field.type] || new Set();
  for (const key of Object.keys(field)) {
    if (!["id", "label", "type"].includes(key) && !allowed.has(key)) {
      issues.push(issue(`${basePath}/${key}`, "item_field_property", `is not valid for ${field.type} item fields`));
    }
  }
  if (field.type === "integer" || field.type === "number") {
    const integerOnly = field.type === "integer";
    const valid = typeof field.minimum === "number" && typeof field.maximum === "number"
      && field.minimum <= field.maximum
      && (!integerOnly || (Number.isInteger(field.minimum) && Number.isInteger(field.maximum)));
    if (!valid) {
      issues.push(issue(`${basePath}/minimum`, "numeric_bounds", "must declare ordered bounds compatible with the item type"));
    }
  } else if (field.type === "text" && !Number.isInteger(field.maxLength)) {
    issues.push(issue(`${basePath}/maxLength`, "text_limit", "must declare a bounded item text length"));
  } else if (field.type === "enum") {
    validateOptions(issues, field.options, `${basePath}/options`);
  }
}

function validateOptions(issues, options, basePath) {
  const values = Array.isArray(options) ? options : [];
  pushDuplicateIssues(issues, values, (option) => option?.value, basePath, "enum option value");
  pushNormalizedDuplicateIssues(issues, values, (option) => option?.label, basePath, "enum option label");
}

function validateRecordDefaultItem(value, itemFields) {
  if (!isPlainObject(value)) {
    return false;
  }
  const expectedIds = new Set(itemFields.map((field) => field?.id));
  if (Object.keys(value).length !== expectedIds.size || Object.keys(value).some((key) => !expectedIds.has(key))) {
    return false;
  }
  return itemFields.every((field) => validateScalarAgainstItemField(value[field.id], field));
}

function validateScalarAgainstItemField(value, field) {
  if (field.type === "integer") {
    return Number.isInteger(value) && value >= field.minimum && value <= field.maximum;
  }
  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value) && value >= field.minimum && value <= field.maximum;
  }
  if (field.type === "text") {
    return typeof value === "string" && unicodeLength(value) <= field.maxLength;
  }
  if (field.type === "boolean") {
    return typeof value === "boolean";
  }
  if (field.type === "enum") {
    return typeof value === "string" && (Array.isArray(field.options) ? field.options : []).some((option) => option?.value === value);
  }
  return false;
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validateSkillModuleState(value) {
  const issues = [];
  if (Number.isInteger(value.createdTurn) && Number.isInteger(value.updatedTurn) && value.createdTurn > value.updatedTurn) {
    issues.push(issue("/updatedTurn", "turn_order", "must be greater than or equal to createdTurn"));
  }
  if (typeof value.createdAt === "string" && typeof value.updatedAt === "string"
    && Date.parse(value.createdAt) > Date.parse(value.updatedAt)) {
    issues.push(issue("/updatedAt", "timestamp_order", "must be greater than or equal to createdAt"));
  }
  return issues;
}

function validateSkillModuleGrant(value) {
  const issues = [];
  pushDuplicateIssues(issues, value.writableFields, (field) => field?.fieldId, "/writableFields", "granted field id");
  return issues;
}

function validateSkillModuleCapabilityReview(value) {
  const issues = [];
  pushDuplicateIssues(issues, value.modules, (module) => module?.moduleRef, "/modules", "review module ref");
  for (const [index, module] of arrayEntries(value.modules)) {
    if (module?.required === true && module.enabled !== true) {
      issues.push(issue(`/modules/${index}/enabled`, "required_module", "a required module cannot be disabled in the final review"));
    }
  }
  return issues;
}

function validateSkillIOCompanion(value) {
  const issues = [];
  const views = Array.isArray(value.readViews) ? value.readViews : [];
  const actions = Array.isArray(value.actions) ? value.actions : [];
  pushDuplicateIssues(issues, views, (view) => view?.id, "/readViews", "read view id");
  pushDuplicateIssues(issues, actions, (action) => action?.id, "/actions", "action id");
  pushDuplicateIssues(issues, actions, (action) => action?.toolName, "/actions", "action tool name");

  const viewIds = new Set(views.map((view) => view?.id));
  if (!viewIds.has("guide")) {
    issues.push(issue("/readViews", "guide_required", "the language-neutral guide view is always required"));
  }
  if (!viewIds.has(value.defaultView)) {
    issues.push(issue("/defaultView", "default_view", "must reference a declared read view"));
  }
  const expectedViews = {
    guide: { projection: "guide", query: false, minimumTargets: 0, maximumTargets: 0, limit: 1 },
    overview: { projection: "summary", query: false, minimumTargets: 1, maximumTargets: 12 },
    recent: { projection: "recent_records", query: false, minimumTargets: 1, maximumTargets: 1 },
    lookup: { projection: "record_lookup", query: true, minimumTargets: 1, maximumTargets: 1 },
  };
  for (const [index, view] of arrayEntries(views)) {
    const expected = expectedViews[view?.id];
    if (!expected) continue;
    const targetCount = Array.isArray(view.targetFieldIds) ? view.targetFieldIds.length : 0;
    if (view.projection !== expected.projection || view.query !== expected.query
      || targetCount < expected.minimumTargets || targetCount > expected.maximumTargets
      || (expected.limit && view.limit !== expected.limit)) {
      issues.push(issue(`/readViews/${index}`, "read_view_shape", "must use the fixed Runtime projection, query and target shape for its view id"));
    }
  }

  for (const [index, action] of arrayEntries(actions)) {
    if (!isPlainObject(action)) continue;
    const base = `/actions/${index}`;
    if (RESERVED_ACTION_TOOL_NAMES.has(action.toolName)) {
      issues.push(issue(`${base}/toolName`, "action_tool_reserved", "must not shadow a Runtime or forbidden tool"));
    }
    const fields = Array.isArray(action.modelInput?.fields) ? action.modelInput.fields : [];
    const required = Array.isArray(action.modelInput?.required) ? action.modelInput.required : [];
    const bindings = Array.isArray(action.runtimeMapping?.bindings) ? action.runtimeMapping.bindings : [];
    pushDuplicateIssues(issues, fields, (field) => field?.name, `${base}/modelInput/fields`, "model input name");
    pushDuplicateIssues(issues, bindings, (binding) => binding?.argument, `${base}/runtimeMapping/bindings`, "binding argument");
    const fieldNames = fields.map((field) => field?.name).filter(Boolean).sort();
    if (!sameStrings([...required].sort(), fieldNames)) {
      issues.push(issue(`${base}/modelInput/required`, "model_input_required", "must require every flat model input exactly once"));
    }
    if (!sameStrings(bindings.map((binding) => binding?.argument).filter(Boolean).sort(), fieldNames)) {
      issues.push(issue(`${base}/runtimeMapping/bindings`, "runtime_binding_coverage", "must bind every flat model input exactly once"));
    }
    for (const [fieldIndex, field] of arrayEntries(fields)) {
      const numeric = field?.type === "integer" || field?.type === "number";
      if (numeric) {
        if (!Number.isFinite(field.minimum) || !Number.isFinite(field.maximum) || field.minimum > field.maximum
          || Object.prototype.hasOwnProperty.call(field, "maxLength") || Object.prototype.hasOwnProperty.call(field, "enum")) {
          issues.push(issue(`${base}/modelInput/fields/${fieldIndex}`, "model_input_shape", "numeric inputs require only a finite ordered range"));
        }
      } else if (field?.type === "string") {
        const hasLength = Number.isInteger(field.maxLength);
        const hasEnum = Array.isArray(field.enum) && field.enum.length > 0;
        if (hasLength === hasEnum || Object.prototype.hasOwnProperty.call(field, "minimum") || Object.prototype.hasOwnProperty.call(field, "maximum")) {
          issues.push(issue(`${base}/modelInput/fields/${fieldIndex}`, "model_input_shape", "string inputs require exactly one bounded length or fixed enum"));
        }
      } else if (field?.type === "boolean" && hasAnyOwn(field, ["minimum", "maximum", "maxLength", "enum"])) {
        issues.push(issue(`${base}/modelInput/fields/${fieldIndex}`, "model_input_shape", "boolean inputs cannot declare numeric, length or enum constraints"));
      }
    }
    for (const [bindingIndex, binding] of arrayEntries(bindings)) {
      const hasValueMap = Array.isArray(binding?.valueMap) && binding.valueMap.length > 0;
      if ((binding?.mode === "exact_enum_label") !== hasValueMap) {
        issues.push(issue(`${base}/runtimeMapping/bindings/${bindingIndex}/valueMap`, "binding_value_map", "is required exactly for exact enum label bindings"));
      }
      if (hasValueMap) {
        pushDuplicateIssues(issues, binding.valueMap, (entry) => entry?.input, `${base}/runtimeMapping/bindings/${bindingIndex}/valueMap`, "mapped model value");
        pushDuplicateIssues(issues, binding.valueMap, (entry) => entry?.value, `${base}/runtimeMapping/bindings/${bindingIndex}/valueMap`, "mapped Runtime value");
      }
    }
  }
  return issues;
}

function validateBuiltInDomainSkillIO(value) {
  const issues = [];
  if (value.skillId !== CHARACTER_DOMAIN_SKILL_ID) {
    issues.push(issue("/skillId", "character_skill_identity", `must be ${CHARACTER_DOMAIN_SKILL_ID}`));
  }
  if (value.namespace !== CHARACTER_DOMAIN_NAMESPACE) {
    issues.push(issue("/namespace", "character_skill_namespace", `must be ${CHARACTER_DOMAIN_NAMESPACE}`));
  }
  if (value.defaultView !== "overview") {
    issues.push(issue("/defaultView", "character_default_view", "must be overview"));
  }
  validateFixedCharacterReadViews(issues, value.readViews, "/readViews");
  validateFixedCharacterActions(issues, value.actions, "/actions", { companion: true });
  return issues;
}

function validateBuiltInDomainSkillGrant(value) {
  const issues = [];
  validateCharacterDomainIdentity(issues, value);
  const expectedViews = CHARACTER_READ_VIEWS.map((view) => view.id);
  if (!sameStrings(value.readViewIds, expectedViews)) {
    issues.push(issue("/readViewIds", "character_read_grant", "must grant the fixed Character read views in canonical order"));
  }
  validateFixedCharacterActions(issues, value.actions, "/actions", { grant: true });
  return issues;
}

function validateBuiltInDomainSkillLock(value) {
  const issues = [];
  validateCharacterDomainIdentity(issues, value);
  if (value.companion?.schemaVersion !== "grey-crow-built-in-domain-skill-io-v1") {
    issues.push(issue("/companion/schemaVersion", "character_companion_lock", "must lock built-in domain Skill I/O v1"));
  }
  if (value.grant?.schemaVersion !== "grey-crow-built-in-domain-skill-grant-v1") {
    issues.push(issue("/grant/schemaVersion", "character_grant_lock", "must lock built-in domain Skill grant v1"));
  }
  const expectedViews = CHARACTER_READ_VIEWS.map((view) => view.id);
  if (!sameStrings(value.readViewIds, expectedViews)) {
    issues.push(issue("/readViewIds", "character_read_lock", "must lock the fixed Character read views in canonical order"));
  }
  validateFixedCharacterActions(issues, value.actions, "/actions", { lock: true });
  return issues;
}

function validateCharacterDomainIdentity(issues, value) {
  if (value.skillId !== CHARACTER_DOMAIN_SKILL_ID) {
    issues.push(issue("/skillId", "character_skill_identity", `must be ${CHARACTER_DOMAIN_SKILL_ID}`));
  }
  if (value.namespace !== CHARACTER_DOMAIN_NAMESPACE) {
    issues.push(issue("/namespace", "character_skill_namespace", `must be ${CHARACTER_DOMAIN_NAMESPACE}`));
  }
  if (value.capability !== "character_records") {
    issues.push(issue("/capability", "character_capability", "must be character_records"));
  }
}

function validateFixedCharacterReadViews(issues, views, basePath) {
  const actual = Array.isArray(views) ? views : [];
  pushDuplicateIssues(issues, actual, (view) => view?.id, basePath, "Character read view id");
  for (let index = 0; index < CHARACTER_READ_VIEWS.length; index += 1) {
    const expected = CHARACTER_READ_VIEWS[index];
    const current = actual[index];
    if (!current || current.id !== expected.id || current.operation !== expected.operation
      || current.query !== expected.query || current.limit !== expected.limit) {
      issues.push(issue(`${basePath}/${index}`, "character_read_view_shape", `must be the fixed ${expected.id} Character view`));
    }
  }
}

function validateFixedCharacterActions(issues, actions, basePath, mode) {
  const actual = Array.isArray(actions) ? actions : [];
  pushDuplicateIssues(issues, actual, (action) => action?.id, basePath, "Character action id");
  pushDuplicateIssues(issues, actual, (action) => action?.toolName, basePath, "Character tool name");
  for (let index = 0; index < CHARACTER_DOMAIN_ACTIONS.length; index += 1) {
    const expected = CHARACTER_DOMAIN_ACTIONS[index];
    const current = actual[index];
    const actionPath = `${basePath}/${index}`;
    if (!current || current.id !== expected.id || current.toolName !== expected.id) {
      issues.push(issue(actionPath, "character_action_identity", `must be the fixed ${expected.id} Character action`));
      continue;
    }
    if (mode.companion) {
      if (current.descriptionKey !== `skill.characters.action.${expected.id}`) {
        issues.push(issue(`${actionPath}/descriptionKey`, "character_description_key", "must use the stable localized description key"));
      }
      if (current.runtimeMapping?.capability !== "character_records"
        || current.runtimeMapping?.operation !== expected.operation) {
        issues.push(issue(`${actionPath}/runtimeMapping`, "character_runtime_mapping", `must map only to ${expected.operation}`));
      }
      validateFixedCharacterInputs(issues, current.modelInput, expected.inputs, `${actionPath}/modelInput`);
    } else if (mode.grant) {
      if (current.operation !== expected.operation
        || !sameStrings(current.inputNames, expected.inputs.map((field) => field.name))) {
        issues.push(issue(actionPath, "character_action_grant", "must grant only the fixed operation and flat input names"));
      }
    }
  }
}

function validateFixedCharacterInputs(issues, modelInput, expectedInputs, basePath) {
  const fields = Array.isArray(modelInput?.fields) ? modelInput.fields : [];
  const expectedNames = expectedInputs.map((field) => field.name);
  pushDuplicateIssues(issues, fields, (field) => field?.name, `${basePath}/fields`, "Character model input name");
  if (!sameStrings(modelInput?.required, expectedNames)) {
    issues.push(issue(`${basePath}/required`, "character_required_inputs", "must require every fixed flat input in canonical order"));
  }
  for (let index = 0; index < expectedInputs.length; index += 1) {
    const expected = expectedInputs[index];
    const current = fields[index];
    const inputPath = `${basePath}/fields/${index}`;
    const sameBase = current?.name === expected.name
      && current?.type === "string"
      && current?.descriptionKey === `skill.characters.input.${expected.name}`;
    const sameConstraint = expected.enum
      ? sameStrings(current?.enum, expected.enum) && !Object.prototype.hasOwnProperty.call(current || {}, "maxLength")
      : current?.maxLength === expected.maxLength && !Object.prototype.hasOwnProperty.call(current || {}, "enum");
    if (!sameBase || !sameConstraint) {
      issues.push(issue(inputPath, "character_model_input", `must be the fixed ${expected.name} flat input`));
    }
  }
}

function characterDomainAction(id, operation, inputs) {
  return Object.freeze({ id, operation, inputs: Object.freeze(inputs) });
}

function characterTextInput(name, maxLength) {
  return Object.freeze({ name, maxLength });
}

function characterEnumInput(name, values) {
  return Object.freeze({ name, enum: Object.freeze(values) });
}

function validateSkillPanelPresentation(value) {
  const issues = [];
  const panels = Array.isArray(value.panels) ? value.panels : [];
  pushDuplicateIssues(issues, panels, (panel) => `${panel?.packId || ""}:${panel?.itemId || ""}`, "/panels", "Skill panel identity");
  pushDuplicateIssues(issues, panels.filter((panel) => panel?.moduleRef), (panel) => panel.moduleRef, "/panels", "module ref");
  for (const [index, panel] of arrayEntries(value.panels)) {
    const hasIdentity = typeof panel?.moduleRef === "string" && typeof panel?.visibility === "string";
    if (panel?.hasModule !== hasIdentity) {
      issues.push(issue(`/panels/${index}`, "module_identity", "hasModule must match moduleRef and visibility"));
    }
  }
  return issues;
}

function validateSkillPanelPresentationV2(value) {
  const issues = [];
  const panels = Array.isArray(value.panels) ? value.panels : [];
  pushDuplicateIssues(issues, panels, (panel) => panel?.panelRef, "/panels", "panel ref");
  pushDuplicateIssues(
    issues,
    panels.filter((panel) => panel?.sourceKind === "ordinary_skill"),
    (panel) => `${panel?.ordinarySource?.packId || ""}:${panel?.ordinarySource?.itemId || ""}`,
    "/panels",
    "ordinary Skill source identity"
  );
  pushDuplicateIssues(
    issues,
    panels.filter((panel) => panel?.sourceKind === "built_in_domain"),
    (panel) => `${panel?.domainSource?.skillId || ""}:${panel?.domainSource?.capability || ""}`,
    "/panels",
    "built-in domain source identity"
  );
  return issues;
}

function validateSkillPanelViewProjection(value) {
  const issues = [];
  pushDuplicateIssues(issues, value.summary, (item) => item?.id, "/summary", "summary id");
  pushDuplicateIssues(issues, value.fields, (field) => field?.id, "/fields", "display field id");
  pushDuplicateIssues(issues, value.items, (item) => item?.ref, "/items", "list item ref");

  for (const [index, field] of arrayEntries(value.fields)) {
    validateSkillPanelDisplayField(issues, field, `/fields/${index}`);
  }

  const sections = Array.isArray(value.detail?.sections) ? value.detail.sections : [];
  pushDuplicateIssues(issues, sections, (section) => section?.id, "/detail/sections", "detail section id");
  for (const [sectionIndex, section] of arrayEntries(sections)) {
    const sectionPath = `/detail/sections/${sectionIndex}`;
    pushDuplicateIssues(issues, section?.fields, (field) => field?.id, `${sectionPath}/fields`, "detail field id");
    pushDuplicateIssues(issues, section?.records, (record) => record?.id, `${sectionPath}/records`, "detail record id");
    for (const [fieldIndex, field] of arrayEntries(section?.fields)) {
      validateSkillPanelDisplayField(issues, field, `${sectionPath}/fields/${fieldIndex}`);
    }
  }

  if (value.pagination) {
    if (value.pagination.returnedItems > value.pagination.totalItems) {
      issues.push(issue("/pagination/returnedItems", "pagination_count", "cannot exceed totalItems"));
    }
    if (value.view === "list" && Array.isArray(value.items)
      && value.pagination.returnedItems !== value.items.length) {
      issues.push(issue("/pagination/returnedItems", "pagination_count", "must match the number of projected list items"));
    }
    if (value.view === "detail"
      && value.pagination.returnedItems !== sections.reduce((count, section) => count + (section.records?.length || 0), 0)) {
      issues.push(issue("/pagination/returnedItems", "pagination_count", "must match the number of projected detail records"));
    }
    if (value.view === "detail" && value.pagination.hasMore && !value.pagination.returnedItems) {
      issues.push(issue("/pagination/returnedItems", "pagination_count", "a continuing detail page must contain records"));
    }
    const cursorMatches = value.pagination.hasMore
      ? typeof value.pagination.nextCursor === "string"
      : value.pagination.nextCursor === null;
    if (!cursorMatches) {
      issues.push(issue("/pagination/nextCursor", "pagination_cursor", "must be present exactly when more items remain"));
    }
  }

  return issues;
}

function validateSkillPanelDisplayField(issues, field, fieldPath) {
  const numeric = field?.kind === "number" || field?.kind === "progress";
  if (numeric) {
    if (!Number.isFinite(field?.value)) {
      issues.push(issue(`${fieldPath}/value`, "display_value", `${field?.kind} fields require a finite numeric value`));
    }
    if (!Number.isFinite(field?.minimum) || !Number.isFinite(field?.maximum)
      || field.minimum > field.maximum) {
      issues.push(issue(fieldPath, "numeric_display_range", "numeric fields require a finite ordered display range"));
    }
    return;
  }

  if (field?.minimum !== null || field?.maximum !== null) {
    issues.push(issue(fieldPath, "numeric_display_range", "non-numeric fields cannot expose numeric display bounds"));
  }
  if (field?.kind === "boolean" && typeof field.value !== "boolean") {
    issues.push(issue(`${fieldPath}/value`, "display_value", "boolean fields require a boolean value"));
  }
  if (field?.kind === "chips"
    && (!Array.isArray(field.value) || field.value.some((item) => typeof item !== "string"))) {
    issues.push(issue(`${fieldPath}/value`, "display_value", "chips fields require a string array"));
  }
  if ((field?.kind === "text" || field?.kind === "badge")
    && field.value !== null && typeof field.value !== "string") {
    issues.push(issue(`${fieldPath}/value`, "display_value", `${field.kind} fields require a string or null value`));
  }
}

function validateSkillModuleProjection(value) {
  const issues = [];
  const hasIdentity = typeof value.moduleRef === "string"
    && typeof value.visibility === "string"
    && value.stateVersion === 1
    && Number.isInteger(value.revision);
  if (value.hasModule !== hasIdentity) {
    issues.push(issue("/hasModule", "module_identity", "must match the module state identity fields"));
  }
  if (value.hasModule === false && (value.activated !== false || value.fields?.length || value.summary?.length || value.pagination !== null)) {
    issues.push(issue("/fields", "stateless_projection", "a Skill without a module cannot project state fields or pagination"));
  }
  pushDuplicateIssues(issues, value.fields, (field) => field?.id, "/fields", "projected field id");
  pushDuplicateIssues(issues, value.summary, (item) => item?.fieldId, "/summary", "summary field id");
  const fieldById = new Map((Array.isArray(value.fields) ? value.fields : []).map((field) => [field?.id, field]));
  for (const [index, item] of arrayEntries(value.summary)) {
    if (!fieldById.has(item?.fieldId)) {
      issues.push(issue(`/summary/${index}/fieldId`, "summary_field_unknown", "must reference a projected field"));
    }
  }
  for (const [index, field] of arrayEntries(value.fields)) {
    if (FIELD_WIDGETS[field?.type] && !FIELD_WIDGETS[field.type].has(field.widget)) {
      issues.push(issue(`/fields/${index}/widget`, "field_widget", `is not supported by ${field.type} fields`));
    }
    if (field?.type !== "record_list" && field?.derivedSummary !== null) {
      issues.push(issue(`/fields/${index}/derivedSummary`, "derived_display", "is only valid for a record list"));
    }
    if (!validateProjectedFieldValue(field?.value, field?.type)) {
      issues.push(issue(`/fields/${index}/value`, "projected_value", `must match the declared ${field?.type || "unknown"} type`));
    }
    const numeric = field?.type === "integer" || field?.type === "number";
    if (numeric) {
      if (!Number.isFinite(field.minimum) || !Number.isFinite(field.maximum) || field.minimum > field.maximum) {
        issues.push(issue(`/fields/${index}`, "numeric_display_range", "numeric projections require a finite ordered display range"));
      }
    } else if (field?.minimum !== null || field?.maximum !== null) {
      issues.push(issue(`/fields/${index}`, "numeric_display_range", "non-numeric projections cannot expose numeric display bounds"));
    }
    if (field?.type === "enum") {
      if (!Array.isArray(field.options) || field.options.length === 0
        || !field.options.some((option) => option?.value === field.value)) {
        issues.push(issue(`/fields/${index}/options`, "enum_display_options", "enum projections require the selected player-visible option"));
      }
    } else if (field?.options?.length) {
      issues.push(issue(`/fields/${index}/options`, "enum_display_options", "only enum projections can expose options"));
    }
    if (field?.type === "record_list") {
      if (!Array.isArray(field.itemFields) || field.itemFields.length === 0) {
        issues.push(issue(`/fields/${index}/itemFields`, "record_display_fields", "record projections require player-visible item fields"));
      }
    } else if (field?.itemFields?.length) {
      issues.push(issue(`/fields/${index}/itemFields`, "record_display_fields", "only record projections can expose item fields"));
    }
    pushDuplicateIssues(issues, field?.options, (option) => option?.value, `/fields/${index}/options`, "display option value");
    pushDuplicateIssues(issues, field?.itemFields, (item) => item?.id, `/fields/${index}/itemFields`, "record display field id");
    pushDuplicateIssues(issues, field?.derivedSummary?.groupCounts, (group) => group?.value, `/fields/${index}/derivedSummary/groupCounts`, "group value");
    if (field?.derivedSummary) {
      const groupedCount = (Array.isArray(field.derivedSummary.groupCounts) ? field.derivedSummary.groupCounts : [])
        .reduce((total, group) => total + (Number.isInteger(group?.count) ? group.count : 0), 0);
      if (groupedCount > field.derivedSummary.count) {
        issues.push(issue(`/fields/${index}/derivedSummary/groupCounts`, "group_count", "cannot exceed the canonical record count"));
      }
    }
  }
  if (value.pagination) {
    const pagedField = fieldById.get(value.pagination.fieldId);
    if (!pagedField || pagedField.type !== "record_list") {
      issues.push(issue("/pagination/fieldId", "pagination_field", "must reference a projected record list"));
    }
    if (value.pagination.returnedItems > value.pagination.totalItems) {
      issues.push(issue("/pagination/returnedItems", "pagination_count", "cannot exceed totalItems"));
    }
    if (Array.isArray(pagedField?.value) && value.pagination.returnedItems !== pagedField.value.length) {
      issues.push(issue("/pagination/returnedItems", "pagination_count", "must match the number of projected record items"));
    }
    const cursorMatches = value.pagination.hasMore
      ? typeof value.pagination.nextCursor === "string"
      : value.pagination.nextCursor === null;
    if (!cursorMatches) {
      issues.push(issue("/pagination/nextCursor", "pagination_cursor", "must be present exactly when more items remain"));
    }
  }
  return issues;
}

function validateSkillLocalizationBundle(value) {
  const issues = [];
  validateCanonicalLocale(issues, value.sourceLocale, "/sourceLocale");
  const locales = Array.isArray(value.locales) ? value.locales : [];
  pushDuplicateIssues(issues, locales, (entry) => entry?.locale, "/locales", "localized locale");
  for (const [index, entry] of arrayEntries(locales)) {
    const basePath = `/locales/${index}`;
    validateCanonicalLocale(issues, entry?.locale, `${basePath}/locale`);
    if (entry?.locale === value.sourceLocale) {
      issues.push(issue(`${basePath}/locale`, "source_locale", "must not duplicate the source locale"));
    }
    validateLocalizedSkillMetadata(issues, entry, basePath);
    validateLocalizedSkillPaths(issues, entry, basePath);
  }
  return issues;
}

function validateLocalizedSkillMetadata(issues, entry, basePath) {
  const description = normalizedText(entry?.description);
  const title = normalizedText(entry?.title);
  if (unicodeLength(description) < MIN_SKILL_DESCRIPTION_CHARS || description.toLowerCase() === title.toLowerCase()) {
    issues.push(issue(`${basePath}/description`, "skill_description", "must briefly explain what the localized Skill does and when it applies"));
  }
  const seenTriggers = new Set();
  for (const [triggerIndex, trigger] of arrayEntries(entry?.triggers)) {
    const normalized = normalizedLookupText(trigger);
    if (!normalized || /[\u0000-\u001F\u007F]/.test(String(trigger || ""))) {
      issues.push(issue(`${basePath}/triggers/${triggerIndex}`, "trigger_format", "must be a visible semantic hint"));
    } else if (seenTriggers.has(normalized)) {
      issues.push(issue(`${basePath}/triggers/${triggerIndex}`, "duplicate_trigger", "must be unique after whitespace and case normalization"));
    }
    seenTriggers.add(normalized);
  }
  pushDuplicateIssues(issues, entry?.templates, (template) => template?.templateId, `${basePath}/templates`, "localized template id");
  pushDuplicateIssues(issues, entry?.templates, (template) => template?.path, `${basePath}/templates`, "localized template path");
}

function validateLocalizedSkillPaths(issues, entry, basePath) {
  if (typeof entry?.locale !== "string") {
    return;
  }
  const skillPath = typeof entry.skillPath === "string" ? entry.skillPath : "";
  const marker = `/locales/${entry.locale}/`;
  const markerIndex = skillPath.indexOf(marker);
  const localeRoot = markerIndex > 0 ? skillPath.slice(0, markerIndex + marker.length - 1) : "";
  if (!localeRoot || skillPath !== `${localeRoot}/SKILL.md`) {
    issues.push(issue(`${basePath}/skillPath`, "localization_scope", `must resolve to locales/${entry.locale}/SKILL.md inside the Skill`));
  }
  for (const [templateIndex, template] of arrayEntries(entry.templates)) {
    if (!localeRoot || !String(template?.path || "").startsWith(`${localeRoot}/templates/`)) {
      issues.push(issue(`${basePath}/templates/${templateIndex}/path`, "localization_scope", "must remain inside the localized templates directory"));
    }
  }
  if (entry.modulePresentationPath !== null
    && (!localeRoot || entry.modulePresentationPath !== `${localeRoot}/module-presentation.json`)) {
    issues.push(issue(`${basePath}/modulePresentationPath`, "localization_scope", "must be module-presentation.json beside the localized Skill body"));
  }
}

function validateSkillModulePresentationOverlay(value) {
  const issues = [];
  validateCanonicalLocale(issues, value.locale, "/locale");
  const fields = Array.isArray(value.fields) ? value.fields : [];
  const actions = Array.isArray(value.actions) ? value.actions : [];
  pushDuplicateIssues(issues, actions, (action) => action?.actionId, "/actions", "localized action id");
  pushDuplicateIssues(issues, fields, (field) => field?.fieldId, "/fields", "localized field id");
  for (const [index, field] of arrayEntries(fields)) {
    const basePath = `/fields/${index}`;
    pushDuplicateIssues(issues, field?.options, (option) => option?.value, `${basePath}/options`, "localized option value");
    pushDuplicateIssues(issues, field?.itemFields, (item) => item?.fieldId, `${basePath}/itemFields`, "localized record field id");
    pushDuplicateIssues(issues, field?.milestones, (milestone) => String(milestone?.minimum), `${basePath}/milestones`, "localized milestone minimum");
    for (const [itemIndex, item] of arrayEntries(field?.itemFields)) {
      pushDuplicateIssues(
        issues,
        item?.options,
        (option) => option?.value,
        `${basePath}/itemFields/${itemIndex}/options`,
        "localized record option value"
      );
    }
  }
  return issues;
}

function validateSkillLocalizationLock(value) {
  const issues = [];
  const skills = Array.isArray(value.skills) ? value.skills : [];
  pushDuplicateIssues(issues, skills, (skill) => `${skill?.packId || ""}:${skill?.itemId || ""}`, "/skills", "localized Skill identity");
  for (const [skillIndex, skill] of arrayEntries(skills)) {
    const basePath = `/skills/${skillIndex}`;
    validateCanonicalLocale(issues, skill?.sourceLocale, `${basePath}/sourceLocale`);
    const locales = Array.isArray(skill?.locales) ? skill.locales : [];
    pushDuplicateIssues(issues, locales, (entry) => entry?.locale, `${basePath}/locales`, "locked locale");
    if (!locales.some((entry) => entry?.locale === skill?.sourceLocale)) {
      issues.push(issue(`${basePath}/sourceLocale`, "source_locale", "must be present in the locked locales"));
    }
    const seenPaths = new Set();
    for (const [localeIndex, entry] of arrayEntries(locales)) {
      const localePath = `${basePath}/locales/${localeIndex}`;
      validateCanonicalLocale(issues, entry?.locale, `${localePath}/locale`);
      validateLockedLocalizationFiles(issues, entry, localePath, seenPaths);
      validateLocalizedSkillMetadata(issues, entry, localePath);
    }
  }
  return issues;
}

function validateLockedLocalizationFiles(issues, entry, basePath, seenPaths) {
  const descriptors = [
    { descriptor: entry?.body, path: `${basePath}/body` },
    { descriptor: entry?.modulePresentation, path: `${basePath}/modulePresentation` },
    ...(Array.isArray(entry?.templates)
      ? entry.templates.map((template, index) => ({ descriptor: template, path: `${basePath}/templates/${index}` }))
      : []),
  ];
  pushDuplicateIssues(issues, entry?.templates, (template) => template?.templateId, `${basePath}/templates`, "locked template id");
  for (const item of descriptors) {
    if (!item.descriptor || typeof item.descriptor.relativePath !== "string") {
      continue;
    }
    if (seenPaths.has(item.descriptor.relativePath)) {
      issues.push(issue(`${item.path}/relativePath`, "duplicate_path", "localized snapshot paths must be unique within a Skill"));
    }
    seenPaths.add(item.descriptor.relativePath);
  }
}

function validateSkillLocaleCoverage(value) {
  const issues = [];
  validateCanonicalLocale(issues, value.requestedLocale, "/requestedLocale");
  pushDuplicateIssues(issues, value.blockers, (entry) => `${entry?.packId || ""}:${entry?.itemId || ""}`, "/blockers", "blocked Skill identity");
  const ready = new Set(Array.isArray(value.readySkillIds) ? value.readySkillIds : []);
  const blockers = Array.isArray(value.blockers) ? value.blockers : [];
  if ((value.status === "ready") !== (blockers.length === 0)) {
    issues.push(issue("/status", "coverage_status", "must be ready exactly when no Skill locale blockers remain"));
  }
  for (const [index, blocker] of arrayEntries(blockers)) {
    const basePath = `/blockers/${index}`;
    validateCanonicalLocale(issues, blocker?.sourceLocale, `${basePath}/sourceLocale`);
    for (const [localeIndex, locale] of arrayEntries(blocker?.availableLocales)) {
      validateCanonicalLocale(issues, locale, `${basePath}/availableLocales/${localeIndex}`);
    }
    if (ready.has(blocker?.itemId)) {
      issues.push(issue(`${basePath}/itemId`, "coverage_overlap", "a Skill cannot be both ready and blocked"));
    }
  }
  return issues;
}

function validateCanonicalLocale(issues, locale, instancePath) {
  if (typeof locale !== "string") {
    return;
  }
  let canonical;
  try {
    canonical = Intl.getCanonicalLocales(locale)[0];
  } catch {
    issues.push(issue(instancePath, "locale_format", "must be a valid BCP 47 language tag"));
    return;
  }
  if (canonical !== locale) {
    issues.push(issue(instancePath, "locale_canonical", `must use canonical BCP 47 form ${canonical}`));
  }
}

function validateProjectedFieldValue(value, type) {
  if (type === "integer") {
    return Number.isInteger(value);
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "text" || type === "enum") {
    return typeof value === "string";
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  if (type === "string_list") {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  }
  if (type === "record_list") {
    return Array.isArray(value) && value.every(isPlainObject);
  }
  return false;
}

function validateNewGamePreset(value) {
  const issues = [];
  const required = Array.isArray(value.skills) ? value.skills : [];
  const optional = Array.isArray(value.optionalSkills) ? value.optionalSkills : [];
  const refKey = (ref) => `${ref?.packId || ""}:${ref?.itemId || ""}`;
  pushDuplicateIssues(issues, required, refKey, "/skills", "required Skill reference");
  pushDuplicateIssues(issues, optional, refKey, "/optionalSkills", "optional Skill reference");
  const requiredRefs = new Set(required.map(refKey));
  for (const [index, ref] of optional.entries()) {
    if (requiredRefs.has(refKey(ref))) {
      issues.push(issue(`/optionalSkills/${index}`, "skill_selection_overlap", "cannot also be a required Skill"));
    }
  }
  return issues;
}

function validateStoryFinaleCandidate(value) {
  const issues = [];
  pushNormalizedDuplicateIssues(issues, value.closedThreads, (item) => item, "/closedThreads", "closed thread");
  pushNormalizedDuplicateIssues(issues, value.intentionalOpenThreads, (item) => item, "/intentionalOpenThreads", "intentional open thread");
  const closed = new Set((Array.isArray(value.closedThreads) ? value.closedThreads : []).map(normalizedLookupText));
  for (const [index, thread] of arrayEntries(value.intentionalOpenThreads)) {
    if (closed.has(normalizedLookupText(thread))) {
      issues.push(issue(`/intentionalOpenThreads/${index}`, "thread_overlap", "cannot also be declared closed"));
    }
  }
  return issues;
}

function validateStoryFinaleDecision(value) {
  const issues = [];
  if (normalizedText(value.playerTextExcerpt).length === 0) {
    issues.push(issue("/playerTextExcerpt", "player_decision", "must preserve a bounded player-visible response excerpt"));
  }
  return issues;
}

function validateStoryFinaleLedger(value) {
  const issues = [];
  if (typeof value.createdAt === "string" && typeof value.updatedAt === "string"
    && Date.parse(value.createdAt) > Date.parse(value.updatedAt)) {
    issues.push(issue("/updatedAt", "timestamp_order", "must be greater than or equal to createdAt"));
  }
  pushDuplicateIssues(issues, value.declinedFingerprints, (item) => item, "/declinedFingerprints", "declined candidate fingerprint");
  if (value.candidate && value.lastDecision && value.candidate.candidateId !== value.lastDecision.candidateId) {
    issues.push(issue("/lastDecision/candidateId", "candidate_identity", "must reference the current candidate"));
  }

  const hasCandidate = isPlainObject(value.candidate);
  const hasDecision = isPlainObject(value.lastDecision);
  const hasTransaction = typeof value.activeTransactionId === "string";
  const hasClosedFinale = isPlainObject(value.closedFinale);
  if (value.phase === "idle") {
    if (hasCandidate || hasTransaction || hasClosedFinale) {
      issues.push(issue("/phase", "finale_phase", "idle cannot retain a current candidate, transaction, or closed finale"));
    }
    if (hasDecision && value.lastDecision.kind !== "continue") {
      issues.push(issue("/lastDecision/kind", "finale_phase", "idle can only retain a continue decision"));
    }
  }
  if (value.phase === "candidate_pending" && (!hasCandidate || hasTransaction || hasClosedFinale)) {
    issues.push(issue("/phase", "finale_phase", "candidate_pending requires one candidate and no transaction or closed finale"));
  }
  if (value.phase === "candidate_pending" && hasDecision && value.lastDecision.kind === "finish") {
    issues.push(issue("/lastDecision/kind", "finale_phase", "a finish decision must advance to finalizing"));
  }
  if (value.phase === "finalizing" || value.phase === "recovery_required") {
    if (!hasCandidate || !hasDecision || value.lastDecision?.kind !== "finish" || !hasTransaction || hasClosedFinale) {
      issues.push(issue("/phase", "finale_phase", `${value.phase} requires a finish decision, candidate, and active transaction`));
    }
  }
  if (value.phase === "closed") {
    if (!hasCandidate || !hasDecision || value.lastDecision?.kind !== "finish" || hasTransaction || !hasClosedFinale) {
      issues.push(issue("/phase", "finale_phase", "closed requires the final candidate, finish decision, and closed finale without an active transaction"));
    }
    const finaleSource = value.closedFinale?.finaleSource || "story";
    const sourceOperationId = value.closedFinale?.sourceOperationId ?? null;
    const continuationPolicy = value.closedFinale?.continuationPolicy || "allowed";
    if (finaleSource === "easter" && (typeof sourceOperationId !== "string" || continuationPolicy !== "forbidden")) {
      issues.push(issue("/closedFinale", "finale_source", "Easter finales require a bound source operation and forbidden continuation policy"));
    }
    if (finaleSource === "story" && (sourceOperationId !== null || continuationPolicy !== "allowed")) {
      issues.push(issue("/closedFinale", "finale_source", "ordinary Story finales cannot inherit an external operation or forbidden continuation policy"));
    }
  } else if (hasClosedFinale) {
    issues.push(issue("/closedFinale", "finale_phase", "is only available after the ledger is closed"));
  }
  return issues;
}

function validateStoryFinaleProjection(value) {
  const issues = [];
  const expectedMode = {
    idle: "active",
    candidate_pending: "pending",
    finalizing: "finalizing",
    recovery_required: "recovery",
    closed: "archive",
  }[value.phase];
  if (expectedMode && value.mode !== expectedMode) {
    issues.push(issue("/mode", "projection_phase", "must match the Finale lifecycle phase"));
  }
  const expectedInput = value.phase === "idle" || value.phase === "candidate_pending";
  if (value.inputAllowed !== expectedInput) {
    issues.push(issue("/inputAllowed", "projection_phase", "must be enabled only while the player can answer or continue the active story"));
  }
  const candidateRequired = value.phase !== "idle";
  if (Boolean(value.candidate) !== candidateRequired) {
    issues.push(issue("/candidate", "projection_phase", "must be present for pending, finalizing, recovery, and archive phases"));
  }
  const closedRequired = value.phase === "closed";
  if (Boolean(value.closedFinale) !== closedRequired) {
    issues.push(issue("/closedFinale", "projection_phase", "must be present exactly in archive mode"));
  }
  if (!closedRequired && (value.actions?.exportStory || value.actions?.continueAsChild)) {
    issues.push(issue("/actions", "projection_phase", "archive actions cannot be exposed before the Adventure is closed"));
  }
  if (value.closedFinale?.continuationPolicy === "forbidden" && value.actions?.continueAsChild) {
    issues.push(issue("/actions/continueAsChild", "continuation_policy", "a forbidden Finale archive cannot expose continuation"));
  }
  return issues;
}

function validateStoryFinaleTransaction(value) {
  const issues = [];
  const finaleSource = value.finaleSource || "story";
  const sourceOperationId = value.sourceOperationId ?? null;
  const continuationPolicy = value.continuationPolicy || "allowed";
  if (finaleSource === "easter" && (typeof sourceOperationId !== "string" || continuationPolicy !== "forbidden")) {
    issues.push(issue("/finaleSource", "finale_source", "Easter transactions require a bound source operation and forbidden continuation policy"));
  }
  if (finaleSource === "story" && (sourceOperationId !== null || continuationPolicy !== "allowed")) {
    issues.push(issue("/finaleSource", "finale_source", "ordinary Story transactions cannot inherit an external operation or forbidden continuation policy"));
  }
  if (typeof value.startedAt === "string" && typeof value.updatedAt === "string"
    && Date.parse(value.startedAt) > Date.parse(value.updatedAt)) {
    issues.push(issue("/updatedAt", "timestamp_order", "must be greater than or equal to startedAt"));
  }
  const artifacts = value.artifacts || {};
  const hasTranscript = typeof artifacts.transcriptTurnId === "string";
  const hasChapter = typeof artifacts.chapterId === "string";
  const hasFinale = typeof artifacts.finaleId === "string";
  const normalPhase = !new Set(["recovery_required", "aborted"]).has(value.phase);
  if (normalPhase && value.errorCode !== null) {
    issues.push(issue("/errorCode", "transaction_phase", "normal transaction phases cannot carry an error"));
  }
  if (new Set(["recovery_required", "aborted"]).has(value.phase) && typeof value.errorCode !== "string") {
    issues.push(issue("/errorCode", "transaction_phase", "failure phases require a stable error code"));
  }
  const expectedArtifacts = {
    staged: [false, false, false],
    transcript_committed: [true, false, false],
    chapter_committed: [true, true, false],
    ledger_committed: [true, true, true],
    close_committed: [true, true, true],
  }[value.phase];
  if (expectedArtifacts && [hasTranscript, hasChapter, hasFinale].some((present, index) => present !== expectedArtifacts[index])) {
    issues.push(issue("/artifacts", "transaction_phase", "committed artifacts must match the transaction phase"));
  }
  return issues;
}

function validateExtremeEndingEasterCandidate(value) {
  const issues = [];
  if (normalizedText(value.intentSummary).length === 0) {
    issues.push(issue("/intentSummary", "easter_candidate", "must preserve a bounded fictional intent summary"));
  }
  if (normalizedText(value.sceneAnchor).length === 0) {
    issues.push(issue("/sceneAnchor", "easter_candidate", "must preserve a bounded current-scene anchor"));
  }
  return issues;
}

function validateExtremeEndingEasterConfirmation(value) {
  const issues = [];
  if (normalizedText(value.playerTextExcerpt).length === 0) {
    issues.push(issue("/playerTextExcerpt", "easter_confirmation", "must preserve a bounded player response excerpt"));
  }
  return issues;
}

function validateExtremeEndingEasterReceipt(value) {
  const issues = [];
  if (Number.isInteger(value.drawBasisPoints) && Number.isInteger(value.chanceBasisPoints)) {
    const expectedOutcome = value.drawBasisPoints < value.chanceBasisPoints
      ? "grey_crow_view"
      : "standard_extreme_ending";
    if (value.outcome !== expectedOutcome) {
      issues.push(issue("/outcome", "easter_outcome", "must match the one-shot basis-point draw"));
    }
  }
  return issues;
}

function validateExtremeEndingEasterLedger(value) {
  const issues = [];
  if (typeof value.createdAt === "string" && typeof value.updatedAt === "string"
    && Date.parse(value.createdAt) > Date.parse(value.updatedAt)) {
    issues.push(issue("/updatedAt", "timestamp_order", "must be greater than or equal to createdAt"));
  }

  const candidate = isPlainObject(value.candidate) ? value.candidate : null;
  const confirmations = Array.isArray(value.confirmations) ? value.confirmations : [];
  const receipt = isPlainObject(value.outcomeReceipt) ? value.outcomeReceipt : null;
  const hasTerminalOperation = typeof value.terminalOperationId === "string";
  const hasFinaleOperation = typeof value.finaleOperationId === "string";
  const hasClosedFinale = isPlainObject(value.closedFinale);
  const expectedSkillHash = isPlainObject(value.skillIdentity) ? hashCanonical(value.skillIdentity) : null;

  if (candidate && expectedSkillHash && candidate.skillIdentityHash !== expectedSkillHash) {
    issues.push(issue("/candidate/skillIdentityHash", "easter_skill_identity", "must bind the ledger's locked built-in Skill identity"));
  }
  for (const [index, confirmation] of confirmations.entries()) {
    if (confirmation?.stage !== index + 1) {
      issues.push(issue(`/confirmations/${index}/stage`, "confirmation_order", "must form the exact one, two, three sequence"));
    }
    if (candidate && confirmation?.candidateId !== candidate.candidateId) {
      issues.push(issue(`/confirmations/${index}/candidateId`, "candidate_identity", "must reference the current Easter candidate"));
    }
    const previousTurn = index === 0 ? candidate?.proposedTurn : confirmations[index - 1]?.playerTurn;
    if (Number.isSafeInteger(previousTurn) && Number.isSafeInteger(confirmation?.playerTurn)
      && confirmation.playerTurn <= previousTurn) {
      issues.push(issue(`/confirmations/${index}/playerTurn`, "confirmation_order", "must come from a later player turn"));
    }
  }
  if (receipt) {
    if (!candidate || receipt.candidateId !== candidate.candidateId) {
      issues.push(issue("/outcomeReceipt/candidateId", "candidate_identity", "must reference the committed Easter candidate"));
    }
    if (!hasTerminalOperation || receipt.operationId !== value.terminalOperationId) {
      issues.push(issue("/outcomeReceipt/operationId", "terminal_identity", "must reference the committed terminal operation"));
    }
  }

  const phase = value.phase;
  if (phase === "idle") {
    if (candidate || confirmations.length || hasTerminalOperation || receipt || hasFinaleOperation || hasClosedFinale) {
      issues.push(issue("/phase", "easter_phase", "idle cannot retain a candidate, confirmations, operations, receipt, or closed finale"));
    }
  }
  const pendingCounts = {
    confirmation_1_pending: 0,
    confirmation_2_pending: 1,
    confirmation_3_pending: 2,
  };
  if (Object.prototype.hasOwnProperty.call(pendingCounts, phase)) {
    if (!candidate || confirmations.length !== pendingCounts[phase]
      || hasTerminalOperation || receipt || hasFinaleOperation || hasClosedFinale) {
      issues.push(issue("/phase", "easter_phase", `${phase} requires one candidate and the exact committed confirmation prefix`));
    }
  }
  if (phase === "terminal_committed") {
    if (!candidate || confirmations.length !== 3 || !hasTerminalOperation || !receipt || hasFinaleOperation || hasClosedFinale) {
      issues.push(issue("/phase", "easter_phase", "terminal_committed requires three confirmations and one outcome receipt"));
    }
  }
  if (phase === "finalizing" || phase === "recovery_required") {
    if (!candidate || confirmations.length !== 3 || !hasTerminalOperation || !receipt || !hasFinaleOperation || hasClosedFinale) {
      issues.push(issue("/phase", "easter_phase", `${phase} requires the committed terminal proof and one Finale operation`));
    }
  }
  if (phase === "closed") {
    if (!candidate || confirmations.length !== 3 || !hasTerminalOperation || !receipt || !hasFinaleOperation || !hasClosedFinale) {
      issues.push(issue("/phase", "easter_phase", "closed requires the committed terminal proof, Finale operation, and closed artifact identity"));
    }
  } else if (hasClosedFinale) {
    issues.push(issue("/closedFinale", "easter_phase", "is only available after the Easter ledger is closed"));
  }
  return issues;
}

function validateExtremeEndingEasterProjection(value) {
  const issues = [];
  const expectedMode = {
    idle: "active",
    confirming: "confirming",
    terminal_committed: "terminalizing",
    finalizing: "terminalizing",
    recovery_required: "recovery",
    closed: "archive",
  }[value.phase];
  if (expectedMode && value.mode !== expectedMode) {
    issues.push(issue("/mode", "projection_phase", "must match the Easter lifecycle phase"));
  }
  const expectedInput = value.phase === "idle" || value.phase === "confirming";
  if (value.inputAllowed !== expectedInput) {
    issues.push(issue("/inputAllowed", "projection_phase", "must be disabled after the third confirmation commits"));
  }
  if (value.awaitingPlayerResponse !== (value.phase === "confirming")) {
    issues.push(issue("/awaitingPlayerResponse", "projection_phase", "must be true only during the hidden confirmation chain"));
  }
  if (value.easterDiscovered && !new Set(["terminal_committed", "finalizing", "recovery_required", "closed"]).has(value.phase)) {
    issues.push(issue("/easterDiscovered", "projection_phase", "cannot be revealed before a terminal outcome is committed"));
  }
  if (value.phase !== "closed" && value.actions?.exportStory) {
    issues.push(issue("/actions/exportStory", "projection_phase", "cannot be exposed before the Adventure is closed"));
  }
  if (value.actions?.continueAsChild) {
    issues.push(issue("/actions/continueAsChild", "continuation_policy", "must remain forbidden for every Easter phase"));
  }
  return issues;
}

function validateAdventureLineage(value) {
  const issues = [];
  if (value.parentAdventureId && value.parentAdventureId === value.childAdventureId) {
    issues.push(issue("/childAdventureId", "lineage_identity", "must differ from the parent Adventure"));
  }
  return issues;
}

function pushDuplicateIssues(issues, values, selector, instancePath, label) {
  const seen = new Set();
  for (const [index, value] of arrayEntries(values)) {
    const key = selector(value);
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      issues.push(issue(`${instancePath}/${index}`, "duplicate_id", `${label} must be unique`));
    }
    seen.add(key);
  }
}

function pushNormalizedDuplicateIssues(issues, values, selector, instancePath, label) {
  pushDuplicateIssues(issues, values, (value) => normalizedLookupText(selector(value)), instancePath, label);
}

function arrayEntries(values) {
  return Array.isArray(values) ? values.entries() : [];
}

function hasAnyOwn(value, fields) {
  return Boolean(value) && fields.some((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedText(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizedLookupText(value) {
  return normalizedText(value).toLowerCase();
}

function unicodeLength(value) {
  return Array.from(String(value || "")).length;
}

function issue(instancePath, keyword, message) {
  return { instancePath, keyword, message };
}

module.exports = {
  validateSemanticContract,
};
