"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { validateContract } = require("../contracts/v2");
const { assertModuleLockMatchesDefinition, assertSkillIOLockMatchesCompanion } = require("./skill-module-snapshot");
const { assertSkillIOCompanionMatchesDefinition } = require("./skill-module-creator");
const { assertBuiltInDomainSkillBundle } = require("./built-in-domain-skill-io");
const {
  assertSnapshotByteLimit,
  hashBuffer,
  hashCanonical,
  readJsonBounded,
  safeChild,
  snapshotError,
} = require("./snapshot-utils");

async function readContentSnapshot(options = {}) {
  const adventuresRoot = requireAbsolute(options.adventuresRoot, "adventuresRoot");
  const adventureId = requireStableRef(options.adventureId, "adventureId");
  const adventureRoot = safeChild(adventuresRoot, adventureId);
  await requireRealDirectory(adventureRoot, "SNAPSHOT_ADVENTURE_INVALID");
  const snapshotRoot = safeChild(adventureRoot, "content-snapshot");
  await requireRealDirectory(snapshotRoot, "SNAPSHOT_ROOT_INVALID");
  const profile = await readJsonBounded(safeChild(adventureRoot, "content-profile.json"));
  const lock = await readJsonBounded(safeChild(snapshotRoot, "manifest.lock.json"));
  if (
    profile?.schemaVersion === "grey-crow-content-profile-v2"
    && !Object.prototype.hasOwnProperty.call(profile, "newGameSkill")
  ) {
    throw snapshotError(
      "SNAPSHOT_NEW_GAME_SKILL_REQUIRED",
      "This adventure predates the required New Game Skill snapshot and cannot be continued.",
    );
  }
  validateContract("content-profile-v2", profile);
  validateContract("snapshot-lock-v2", lock);
  assertSnapshotByteLimit(lock.files);
  if (profile.adventureId !== adventureId || profile.profileId !== lock.profileId || profile.snapshotLockId !== lock.lockId) {
    throw snapshotError("SNAPSHOT_REFERENCE_MISMATCH", "Snapshot metadata references do not match.");
  }
  const expected = new Set(["manifest.lock.json"]);
  const verifiedFiles = new Map();
  for (const file of lock.files) {
    expected.add(file.relativePath);
    const target = safeChild(snapshotRoot, file.relativePath);
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== file.sizeBytes) {
      throw snapshotError("SNAPSHOT_FILE_INVALID", "Snapshot file is missing or invalid.", { relative_path: file.relativePath });
    }
    const content = await fs.readFile(target);
    const actualHash = hashBuffer(content);
    if (actualHash !== file.sha256) throw snapshotError("SNAPSHOT_HASH_MISMATCH", "Snapshot file integrity check failed.", { relative_path: file.relativePath });
    verifiedFiles.set(file.relativePath, content);
  }
  const actualPaths = await listSnapshotPaths(snapshotRoot, snapshotRoot);
  if (actualPaths.length !== expected.size || actualPaths.some((relativePath) => !expected.has(relativePath))) {
    throw snapshotError("SNAPSHOT_FILE_SET_MISMATCH", "Snapshot contains untracked files.");
  }
  if (hashCanonical(snapshotLockHashBasis(lock)) !== lock.overallHash) {
    throw snapshotError("SNAPSHOT_LOCK_HASH_MISMATCH", "Snapshot lock integrity check failed.");
  }
  assertProfileItemsMatchLock(profile, lock);
  assertProfileFeaturesMatchLock(profile, lock);
  const presentation = loadSkillPanelPresentation(profile, verifiedFiles);
  const presentationV2 = loadSkillPanelPresentationV2(profile, verifiedFiles);
  const localization = loadSkillLocalization(profile, verifiedFiles);
  const builtInDomainSkills = loadBuiltInDomainSkills(profile, verifiedFiles);
  assertLocalizationCoversSkills(profile, localization?.lock || null);
  const content = await loadNormalizedContent(
    profile,
    presentation,
    presentationV2,
    localization,
    builtInDomainSkills,
    verifiedFiles
  );
  return deepFreeze({ ok: true, profile, lock, content });
}

async function loadNormalizedContent(
  profile,
  presentation,
  presentationV2,
  localization,
  builtInDomainSkills,
  verifiedFiles
) {
  const panelBySkill = new Map((presentation?.panels || []).map((panel) => [`${panel.packId}:${panel.itemId}`, panel]));
  const newGameSkill = loadSkill(profile.newGameSkill, null, verifiedFiles);
  const skills = [];
  for (const item of profile.skills) {
    skills.push(loadSkill(item, panelBySkill.get(`${item.packId}:${item.itemId}`) || null, verifiedFiles));
  }
  assertPresentationCoversSkills(profile, presentation);
  assertPresentationV2CoversSources(profile, presentation, presentationV2);
  return {
    host: requireVerifiedFile(verifiedFiles, "host/host.md").toString("utf8"),
    world: requireVerifiedFile(verifiedFiles, "world/world.md").toString("utf8"),
    newGameSkill,
    skills,
    skillPanels: presentation,
    skillPanelsV2: presentationV2,
    skillLocalizations: localization?.lock || null,
    skillLocaleResources: localization?.resources || null,
    builtInDomainSkills,
  };
}

function loadSkill(item, panel, verifiedFiles) {
  const root = `skills/${item.itemId}`;
  const templates = [...verifiedFiles.keys()]
    .filter((relativePath) => relativePath.startsWith(`${root}/templates/`))
    .sort()
    .map((relativePath) => ({
      name: path.basename(relativePath),
      body: requireVerifiedFile(verifiedFiles, relativePath).toString("utf8"),
    }));
  const module = item.skillModule
    ? loadSkillModule(root, item, panel, verifiedFiles)
    : null;
  const skillIO = item.skillIO
    ? loadSkillIO(root, item, module, verifiedFiles)
    : null;
  if (!item.skillModule && panel && (panel.hasModule || panel.moduleRef !== null || panel.visibility !== null)) {
    throw snapshotError("SNAPSHOT_PRESENTATION_MISMATCH", "Skill panel module identity does not match the content profile.", { item_id: item.itemId });
  }
  return {
    id: item.itemId,
    skillClass: item.skillClass,
    body: requireVerifiedFile(verifiedFiles, `${root}/SKILL.md`).toString("utf8"),
    templates,
    module,
    skillIO,
  };
}

function loadSkillModule(root, item, panel, verifiedFiles) {
  const raw = requireVerifiedFile(verifiedFiles, `${root}/module.json`);
  if (hashBuffer(raw) !== item.skillModule.definitionHash) {
    throw snapshotError("SNAPSHOT_MODULE_HASH_MISMATCH", "Locked Skill module definition failed its identity check.", { item_id: item.itemId });
  }
  let definition;
  try {
    definition = JSON.parse(raw.toString("utf8"));
  } catch {
    throw snapshotError("SNAPSHOT_MODULE_INVALID", "Locked Skill module definition is invalid.", { item_id: item.itemId });
  }
  validateContract("skill-module-definition-v1", definition);
  if (definition.schemaVersion !== item.skillModule.definitionSchemaVersion
    || definition.stateVersion !== item.skillModule.stateVersion) {
    throw snapshotError("SNAPSHOT_MODULE_IDENTITY_MISMATCH", "Locked Skill module version metadata does not match its definition.", { item_id: item.itemId });
  }
  const grant = assertModuleLockMatchesDefinition({
    packId: item.packId,
    packVersion: item.packVersion,
    id: item.itemId,
  }, definition, item.skillModule);
  if (!panel || panel.hasModule !== true || panel.moduleRef !== item.skillModule.moduleRef
    || panel.visibility !== definition.visibility) {
    throw snapshotError("SNAPSHOT_PRESENTATION_MISMATCH", "Skill panel identity does not match its locked module.", { item_id: item.itemId });
  }
  return {
    moduleRef: item.skillModule.moduleRef,
    definitionHash: item.skillModule.definitionHash,
    definition,
    grant,
  };
}

function loadSkillIO(root, item, module, verifiedFiles) {
  const raw = requireVerifiedFile(verifiedFiles, `${root}/skill-io.json`);
  if (hashBuffer(raw) !== item.skillIO.companionHash) {
    throw snapshotError("SNAPSHOT_SKILL_IO_HASH_MISMATCH", "Locked Skill I/O companion failed its identity check.", { item_id: item.itemId });
  }
  let companion;
  try {
    companion = JSON.parse(raw.toString("utf8"));
  } catch {
    throw snapshotError("SNAPSHOT_SKILL_IO_INVALID", "Locked Skill I/O companion is invalid.", { item_id: item.itemId });
  }
  assertSkillIOLockMatchesCompanion(companion, item.skillIO, module?.moduleRef || null);
  try {
    assertSkillIOCompanionMatchesDefinition(companion, module?.definition || null);
  } catch {
    throw snapshotError("SNAPSHOT_SKILL_IO_DEFINITION_MISMATCH", "Locked Skill I/O companion does not match its Skill module.", { item_id: item.itemId });
  }
  return {
    namespace: companion.namespace,
    companionHash: item.skillIO.companionHash,
    companion,
  };
}

function assertProfileItemsMatchLock(profile, lock) {
  const profileItems = [profile.host, profile.world, profile.newGameSkill, ...profile.skills];
  if (hashCanonical(profileItems) !== hashCanonical(lock.items)) {
    throw snapshotError("SNAPSHOT_ITEM_MISMATCH", "Content profile items do not match the snapshot lock.");
  }
}

function assertProfileFeaturesMatchLock(profile, lock) {
  const profileMetadata = {
    features: profile.features || null,
    skillPanelPresentation: profile.skillPanelPresentation || null,
    skillPanelPresentationV2: profile.skillPanelPresentationV2 || null,
    moduleReviewHash: profile.moduleReviewHash || null,
    skillLocalization: profile.skillLocalization || null,
    builtInDomainSkills: profile.builtInDomainSkills || null,
  };
  const lockMetadata = {
    features: lock.features || null,
    skillPanelPresentation: lock.skillPanelPresentation || null,
    skillPanelPresentationV2: lock.skillPanelPresentationV2 || null,
    moduleReviewHash: lock.moduleReviewHash || null,
    skillLocalization: lock.skillLocalization || null,
    builtInDomainSkills: lock.builtInDomainSkills || null,
  };
  if (hashCanonical(profileMetadata) !== hashCanonical(lockMetadata)) {
    throw snapshotError("SNAPSHOT_FEATURE_MISMATCH", "Content profile features do not match the snapshot lock.");
  }
}

function loadBuiltInDomainSkills(profile, verifiedFiles) {
  const loaded = [];
  for (const descriptor of profile.builtInDomainSkills || []) {
    const bundle = {};
    for (const resourceName of ["companion", "grant", "lock"]) {
      try {
        bundle[resourceName] = JSON.parse(requireVerifiedFile(
          verifiedFiles,
          descriptor[resourceName].relativePath
        ).toString("utf8"));
      } catch (error) {
        if (error?.code) throw error;
        throw snapshotError(
          "SNAPSHOT_BUILT_IN_DOMAIN_SKILL_INVALID",
          "Built-in domain Skill metadata is not valid JSON.",
          { skill_id: descriptor.skillId, resource: resourceName }
        );
      }
    }
    try {
      assertBuiltInDomainSkillBundle(bundle);
    } catch {
      throw snapshotError(
        "SNAPSHOT_BUILT_IN_DOMAIN_SKILL_MISMATCH",
        "Built-in domain Skill companion, grant, and lock do not match.",
        { skill_id: descriptor.skillId }
      );
    }
    if (bundle.companion.skillId !== descriptor.skillId
      || bundle.companion.target.capability !== descriptor.capability) {
      throw snapshotError(
        "SNAPSHOT_BUILT_IN_DOMAIN_SKILL_IDENTITY_MISMATCH",
        "Built-in domain Skill identity does not match the snapshot descriptor.",
        { skill_id: descriptor.skillId }
      );
    }
    loaded.push({
      skillId: descriptor.skillId,
      capability: descriptor.capability,
      companion: bundle.companion,
      grant: bundle.grant,
      lock: bundle.lock,
    });
  }
  return loaded;
}

function loadSkillPanelPresentation(profile, verifiedFiles) {
  if (!profile.skillPanelPresentation) return null;
  let presentation;
  try {
    presentation = JSON.parse(requireVerifiedFile(
      verifiedFiles,
      profile.skillPanelPresentation.relativePath
    ).toString("utf8"));
  } catch (error) {
    if (error?.code) throw error;
    throw snapshotError("SNAPSHOT_METADATA_INVALID", "Skill panel presentation is not valid JSON.");
  }
  validateContract("skill-panel-presentation-v1", presentation);
  return presentation;
}

function loadSkillPanelPresentationV2(profile, verifiedFiles) {
  if (!profile.skillPanelPresentationV2) return null;
  let presentation;
  try {
    presentation = JSON.parse(requireVerifiedFile(
      verifiedFiles,
      profile.skillPanelPresentationV2.relativePath
    ).toString("utf8"));
  } catch (error) {
    if (error?.code) throw error;
    throw snapshotError("SNAPSHOT_METADATA_INVALID", "Skill panel presentation v2 is not valid JSON.");
  }
  validateContract("skill-panel-presentation-v2", presentation);
  return presentation;
}

function loadSkillLocalization(profile, verifiedFiles) {
  if (!profile.skillLocalization) return null;
  let localization;
  try {
    localization = JSON.parse(requireVerifiedFile(
      verifiedFiles,
      profile.skillLocalization.relativePath
    ).toString("utf8"));
  } catch (error) {
    if (error?.code) throw error;
    throw snapshotError("SNAPSHOT_METADATA_INVALID", "Skill localization lock is not valid JSON.");
  }
  validateContract("skill-localization-lock-v1", localization);
  const profileSkills = new Map([profile.newGameSkill, ...profile.skills]
    .map((item) => [`${item.packId}:${item.itemId}`, item]));
  const resourceSkills = [];
  for (const skill of localization.skills) {
    const resourceLocales = [];
    for (const locale of skill.locales) {
      const body = assertLocalizationDescriptor(locale.body, verifiedFiles).toString("utf8");
      const templates = locale.templates.map((template) => ({
        templateId: template.templateId,
        body: assertLocalizationDescriptor(template, verifiedFiles).toString("utf8"),
      }));
      let overlay = null;
      if (locale.modulePresentation) {
        const raw = assertLocalizationDescriptor(locale.modulePresentation, verifiedFiles);
        try {
          overlay = JSON.parse(raw.toString("utf8"));
        } catch {
          throw snapshotError("SNAPSHOT_LOCALIZATION_INVALID", "Localized Skill module presentation is not valid JSON.", { item_id: skill.itemId, locale: locale.locale });
        }
        validateContract("skill-module-presentation-overlay-v1", overlay);
        if (overlay.itemId !== skill.itemId || overlay.locale !== locale.locale) {
          throw snapshotError("SNAPSHOT_LOCALIZATION_MISMATCH", "Localized Skill module presentation identity does not match its lock.", { item_id: skill.itemId, locale: locale.locale });
        }
      }
      resourceLocales.push({
        locale: locale.locale,
        title: locale.title,
        description: locale.description,
        triggers: [...locale.triggers],
        playerGuide: locale.playerGuide,
        body,
        templates,
        modulePresentation: overlay,
      });
    }
    resourceSkills.push({
      packId: skill.packId,
      packVersion: skill.packVersion,
      itemId: skill.itemId,
      ownership: skill.ownership
        || profileSkills.get(`${skill.packId}:${skill.itemId}`)?.ownership
        || "imported_readonly",
      skillClass: skill.skillClass,
      danger: skill.danger,
      sourceLocale: skill.sourceLocale,
      locales: resourceLocales,
    });
  }
  return {
    lock: localization,
    resources: {
      schemaVersion: "grey-crow-skill-locale-resources-v1",
      skills: resourceSkills,
    },
  };
}

function assertLocalizationDescriptor(descriptor, verifiedFiles) {
  const raw = requireVerifiedFile(verifiedFiles, descriptor.relativePath);
  if (hashBuffer(raw) !== descriptor.sha256) {
    throw snapshotError("SNAPSHOT_LOCALIZATION_HASH_MISMATCH", "Localized Skill resource does not match its localization lock.", { relative_path: descriptor.relativePath });
  }
  return raw;
}

function requireVerifiedFile(verifiedFiles, relativePath) {
  const value = verifiedFiles.get(relativePath);
  if (!value) {
    throw snapshotError("SNAPSHOT_FILE_INVALID", "Snapshot file is missing from the verified file set.", { relative_path: relativePath });
  }
  return value;
}

function assertPresentationCoversSkills(profile, presentation) {
  if (!presentation) {
    if (profile.skills.some((item) => item.skillModule)) {
      throw snapshotError("SNAPSHOT_PRESENTATION_REQUIRED", "Locked Skill modules require a Skill panel presentation.");
    }
    return;
  }
  const expected = profile.skills.map((item) => `${item.packId}:${item.itemId}`).sort();
  const actual = presentation.panels.map((panel) => `${panel.packId}:${panel.itemId}`).sort();
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw snapshotError("SNAPSHOT_PRESENTATION_MISMATCH", "Skill panel presentation does not match the selected Skills.");
  }
}

function assertPresentationV2CoversSources(profile, presentation, presentationV2) {
  if (!presentationV2) return;
  if (!presentation) {
    throw snapshotError(
      "SNAPSHOT_PRESENTATION_MISMATCH",
      "Skill panel presentation v2 requires the compatible v1 presentation."
    );
  }
  const ordinaryPanels = presentationV2.panels.filter((panel) => panel.sourceKind === "ordinary_skill");
  const expectedOrdinary = profile.skills.map((item) => `${item.packId}:${item.itemId}`).sort();
  const actualOrdinary = ordinaryPanels
    .map((panel) => `${panel.ordinarySource.packId}:${panel.ordinarySource.itemId}`)
    .sort();
  if (expectedOrdinary.length !== actualOrdinary.length
    || expectedOrdinary.some((key, index) => key !== actualOrdinary[index])) {
    throw snapshotError(
      "SNAPSHOT_PRESENTATION_MISMATCH",
      "Skill panel presentation v2 does not match the selected ordinary Skills."
    );
  }
  const legacyPanelByIdentity = new Map(presentation.panels
    .map((panel) => [`${panel.packId}:${panel.itemId}`, panel]));
  for (const panel of ordinaryPanels) {
    const identity = `${panel.ordinarySource.packId}:${panel.ordinarySource.itemId}`;
    const legacy = legacyPanelByIdentity.get(identity);
    if (!legacy
      || legacy.hasModule !== panel.ordinarySource.hasModule
      || legacy.moduleRef !== panel.ordinarySource.moduleRef
      || legacy.visibility !== panel.ordinarySource.visibility) {
      throw snapshotError(
        "SNAPSHOT_PRESENTATION_MISMATCH",
        "Skill panel presentation v2 ordinary source does not match the compatible v1 presentation.",
        { item_id: panel.ordinarySource.itemId }
      );
    }
  }
  const domainPanels = presentationV2.panels.filter((panel) => panel.sourceKind === "built_in_domain");
  const expectedDomains = (profile.builtInDomainSkills || [])
    .map((item) => `${item.skillId}:${item.capability}`)
    .sort();
  const actualDomains = domainPanels
    .map((panel) => `${panel.domainSource.skillId}:${panel.domainSource.capability}`)
    .sort();
  if (expectedDomains.length !== actualDomains.length
    || expectedDomains.some((key, index) => key !== actualDomains[index])) {
    throw snapshotError(
      "SNAPSHOT_PRESENTATION_MISMATCH",
      "Skill panel presentation v2 does not match the selected built-in domain Skills."
    );
  }
}

function assertLocalizationCoversSkills(profile, localization) {
  if (!localization) return;
  const expected = [profile.newGameSkill, ...profile.skills]
    .map((item) => `${item.packId}:${item.itemId}`)
    .sort();
  const actual = localization.skills
    .map((item) => `${item.packId}:${item.itemId}`)
    .sort();
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw snapshotError("SNAPSHOT_LOCALIZATION_MISMATCH", "Skill localization lock does not match the selected Skills.");
  }
  const profileByIdentity = new Map([profile.newGameSkill, ...profile.skills]
    .map((item) => [`${item.packId}:${item.itemId}`, item]));
  for (const skill of localization.skills) {
    const item = profileByIdentity.get(`${skill.packId}:${skill.itemId}`);
    if (!item || item.packVersion !== skill.packVersion || item.skillClass !== skill.skillClass
      || item.language !== skill.sourceLocale) {
      throw snapshotError("SNAPSHOT_LOCALIZATION_MISMATCH", "Skill localization identity does not match the content profile.", { item_id: skill.itemId });
    }
  }
}

function snapshotLockHashBasis(lock) {
  if (!Object.prototype.hasOwnProperty.call(lock, "features")) {
    return { items: lock.items, files: lock.files };
  }
  return {
    features: lock.features,
    skillPanelPresentation: lock.skillPanelPresentation,
    ...(lock.skillPanelPresentationV2
      ? { skillPanelPresentationV2: lock.skillPanelPresentationV2 }
      : {}),
    ...(lock.moduleReviewHash ? { moduleReviewHash: lock.moduleReviewHash } : {}),
    ...(lock.skillLocalization ? { skillLocalization: lock.skillLocalization } : {}),
    ...(lock.builtInDomainSkills ? { builtInDomainSkills: lock.builtInDomainSkills } : {}),
    items: lock.items,
    files: lock.files,
  };
}

async function listSnapshotPaths(root, current, options = {}) {
  const stat = await fs.lstat(current).catch(() => null);
  if (!stat && options.allowMissing) return [];
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw snapshotError("SNAPSHOT_DIRECTORY_INVALID", "Snapshot directory is invalid.");
  const paths = [];
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(current, entry.name);
    const targetStat = await fs.lstat(target);
    if (targetStat.isSymbolicLink()) throw snapshotError("SNAPSHOT_SYMLINK_FORBIDDEN", "Snapshot contains a symbolic link.");
    if (targetStat.isDirectory()) paths.push(...await listSnapshotPaths(root, target));
    else if (targetStat.isFile()) paths.push(path.relative(root, target).split(path.sep).join("/"));
    else throw snapshotError("SNAPSHOT_SPECIAL_FILE", "Snapshot contains a non-regular file.");
  }
  return paths;
}

async function requireRealDirectory(value, code) {
  const stat = await fs.lstat(value).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw snapshotError(code, "Snapshot directory is missing or invalid.");
}

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw snapshotError("SNAPSHOT_PATH_INVALID", `${label} must be absolute.`);
  return path.resolve(value);
}

function requireStableRef(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(normalized)) throw snapshotError("SNAPSHOT_ID_INVALID", `${label} is invalid.`);
  return normalized;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

module.exports = { readContentSnapshot };
