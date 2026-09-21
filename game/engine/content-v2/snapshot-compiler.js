"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { validateContract } = require("../contracts/v2");
const { validatePackV2 } = require("./pack-validator");
const {
  SKILL_PANEL_PRESENTATION_V2_FEATURE,
  prepareSkillModuleSnapshot,
  prepareSkillPanelPresentationV2,
} = require("./skill-module-snapshot");
const {
  CHARACTER_SKILL_ID,
  compileCharacterDomainSkillBundle,
} = require("./built-in-domain-skill-io");
const {
  assertNoSecret,
  assertSnapshotByteLimit,
  hashBuffer,
  hashCanonical,
  makeTreeReadOnly,
  makeTreeWritable,
  safeChild,
  snapshotError,
  writeJsonExclusive,
} = require("./snapshot-utils");

const SKILL_LOCALIZATION_FEATURE = "skill-localization-v1";
const GENERAL_SKILL_CORE_FACADE_FEATURE = "general-skill-core-facade-v1";

async function compileContentSnapshot(options = {}) {
  const adventuresRoot = requireAbsolute(options.adventuresRoot, "adventuresRoot");
  const adventureId = requireStableRef(options.adventureId, "adventureId");
  const plan = requireLoadPlan(options.plan);
  const skillModulePrepare = prepareSkillModuleSnapshot(plan, {
    requiredSkillRefs: options.requiredSkillRefs,
  });
  const builtInDomainSkillPrepare = prepareBuiltInDomainSkills(options, skillModulePrepare);
  const localizationEnabled = [plan.newGameSkill, ...plan.skills].some((item) => Boolean(item.localization));
  assertPreparedModuleExpectation(options, skillModulePrepare);
  const createdAt = normalizeTimestamp(options.clock ? options.clock() : new Date().toISOString());
  const language = String(options.language || plan.host.language).trim();
  const skillPanelPresentationV2Prepare = prepareSkillPanelPresentationV2(
    plan,
    skillModulePrepare,
    builtInDomainSkillPrepare,
    { language }
  );
  const adventureRoot = safeChild(adventuresRoot, adventureId);
  const parent = await requireRealDirectory(adventuresRoot);
  if (await exists(adventureRoot)) throw snapshotError("SNAPSHOT_ADVENTURE_EXISTS", "Adventure content destination already exists.");
  const staging = await fs.mkdtemp(path.join(parent, `.${adventureId}-content-`));

  try {
    const snapshotRoot = path.join(staging, "content-snapshot");
    await fs.mkdir(snapshotRoot, { recursive: true });
    const items = [];
    const files = [];
    const localizationSkills = [];
    const moduleByItem = new Map(skillModulePrepare.modules.map((entry) => [`${entry.packId}:${entry.itemId}`, entry]));
    const skillIOByItem = new Map(skillModulePrepare.skillIOCompanions.map((entry) => [`${entry.packId}:${entry.itemId}`, entry]));
    for (const item of [plan.host, plan.world, plan.newGameSkill, ...plan.skills]) {
      const compiled = await compileItem({ item, plan, options, snapshotRoot, moduleByItem, skillIOByItem });
      items.push(compiled.itemRef);
      files.push(...compiled.files);
      if (compiled.skillLocalizationLock) localizationSkills.push(compiled.skillLocalizationLock);
      assertSnapshotByteLimit(files);
    }
    const presentationBuffer = jsonBuffer(skillModulePrepare.presentation);
    assertNoSecret(presentationBuffer);
    const presentationRelativePath = "skill-panels.lock.json";
    await fs.writeFile(safeChild(snapshotRoot, presentationRelativePath), presentationBuffer, { flag: "wx", mode: 0o600 });
    const skillPanelPresentation = {
      relativePath: presentationRelativePath,
      sha256: hashBuffer(presentationBuffer),
    };
    files.push({
      relativePath: presentationRelativePath,
      sha256: skillPanelPresentation.sha256,
      sizeBytes: presentationBuffer.length,
    });
    assertSnapshotByteLimit(files);
    const presentationV2Buffer = jsonBuffer(skillPanelPresentationV2Prepare);
    assertNoSecret(presentationV2Buffer);
    const presentationV2RelativePath = "skill-panels-v2.lock.json";
    await fs.writeFile(
      safeChild(snapshotRoot, presentationV2RelativePath),
      presentationV2Buffer,
      { flag: "wx", mode: 0o600 }
    );
    const skillPanelPresentationV2 = {
      relativePath: presentationV2RelativePath,
      sha256: hashBuffer(presentationV2Buffer),
    };
    files.push({
      relativePath: presentationV2RelativePath,
      sha256: skillPanelPresentationV2.sha256,
      sizeBytes: presentationV2Buffer.length,
    });
    assertSnapshotByteLimit(files);
    let skillLocalization = null;
    if (localizationEnabled) {
      const localizationLock = {
        schemaVersion: "grey-crow-skill-localization-lock-v1",
        skills: localizationSkills.sort(compareLocalizationSkills),
      };
      validateContract("skill-localization-lock-v1", localizationLock);
      const localizationBuffer = jsonBuffer(localizationLock);
      assertNoSecret(localizationBuffer);
      const localizationRelativePath = "skill-localizations.lock.json";
      await fs.writeFile(safeChild(snapshotRoot, localizationRelativePath), localizationBuffer, { flag: "wx", mode: 0o600 });
      skillLocalization = {
        relativePath: localizationRelativePath,
        sha256: hashBuffer(localizationBuffer),
      };
      files.push({
        relativePath: localizationRelativePath,
        sha256: skillLocalization.sha256,
        sizeBytes: localizationBuffer.length,
      });
      assertSnapshotByteLimit(files);
    }
    const builtInDomainSkills = await writeBuiltInDomainSkills(
      snapshotRoot,
      builtInDomainSkillPrepare,
      files
    );
    assertSnapshotByteLimit(files);
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const sortedItems = [items[0], items[1], items[2], ...items.slice(3).sort(compareItemRefs)];
    const featureMetadata = {
      features: [
        ...skillModulePrepare.features,
        SKILL_PANEL_PRESENTATION_V2_FEATURE,
        ...(skillLocalization ? [SKILL_LOCALIZATION_FEATURE] : []),
        ...(builtInDomainSkills.length > 0 ? ["built-in-domain-skill-io-v1"] : []),
        GENERAL_SKILL_CORE_FACADE_FEATURE,
      ],
      skillPanelPresentation,
      skillPanelPresentationV2,
      ...(skillModulePrepare.moduleReviewHash ? { moduleReviewHash: skillModulePrepare.moduleReviewHash } : {}),
      ...(skillLocalization ? { skillLocalization } : {}),
      ...(builtInDomainSkills.length > 0 ? { builtInDomainSkills } : {}),
    };
    const contentProfileId = requireStableRef(
      options.contentProfileId || `content_${hashCanonical({ adventureId, createdAt, items: sortedItems, files }).slice(0, 24)}`,
      "contentProfileId"
    );
    const snapshotLockId = requireStableRef(
      options.snapshotLockId || `snapshot_${hashCanonical({ adventureId, contentProfileId, createdAt, files }).slice(0, 24)}`,
      "snapshotLockId"
    );
    const lock = {
      schemaVersion: "grey-crow-snapshot-lock-v2",
      lockId: snapshotLockId,
      profileId: contentProfileId,
      createdAt,
      ...featureMetadata,
      overallHash: hashCanonical({ ...featureMetadata, items: sortedItems, files }),
      items: sortedItems,
      files,
    };
    const profile = {
      schemaVersion: "grey-crow-content-profile-v2",
      profileId: contentProfileId,
      adventureId,
      language,
      createdAt,
      ...featureMetadata,
      host: sortedItems[0],
      world: sortedItems[1],
      newGameSkill: sortedItems[2],
      skills: sortedItems.slice(3),
      replacements: plan.replacements.map((item) => ({
        replacedItemId: item.replacedItemId,
        replacementItemId: item.replacementItemId,
        confirmedByUser: true,
      })),
      snapshotLockId,
    };
    validateContract("snapshot-lock-v2", lock);
    validateContract("content-profile-v2", profile);
    await writeJsonExclusive(path.join(snapshotRoot, "manifest.lock.json"), lock);
    await writeJsonExclusive(path.join(staging, "content-profile.json"), profile);
    await makeTreeReadOnly(snapshotRoot);
    await fs.chmod(path.join(staging, "content-profile.json"), 0o400);
    await fs.rename(staging, adventureRoot);
    return deepFreeze({ ok: true, profile, lock });
  } catch (error) {
    await makeTreeWritable(staging);
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function compileItem({ item, plan, options, snapshotRoot, moduleByItem, skillIOByItem }) {
  const packRoot = await resolvePackRoot(item.packId, options);
  const trustedRoot = path.dirname(packRoot);
  const validated = await validatePackV2(packRoot, {
    trustedRoot,
    engineVersion: plan.engineVersion,
    ownership: item.ownership,
  });
  if (validated.manifest.id !== item.packId || validated.manifest.version !== item.packVersion) {
    throw snapshotError("SNAPSHOT_PACK_VERSION_CHANGED", "Selected Pack identity changed before snapshot compilation.", { pack_id: item.packId });
  }
  const manifestItem = validated.manifest.provides.find((candidate) => candidate.id === item.id && candidate.type === item.type);
  if (
    !manifestItem
    || manifestItem.path !== item.path
    || manifestItem.language !== item.language
    || manifestItem.title !== item.title
    || manifestItem.description !== item.description
    || manifestItem.danger !== item.danger
    || (item.type === "skill" && manifestItem.skillClass !== item.skillClass)
    || hashCanonical(manifestItem.triggers || []) !== hashCanonical(item.triggers || [])
    || (manifestItem.playerGuide || null) !== (item.playerGuide || null)
    || hashCanonical(manifestItem.module || null) !== hashCanonical(item.module
      ? { schemaVersion: item.module.schemaVersion, path: item.module.path }
      : null)
    || hashCanonical(manifestItem.skillIO || null) !== hashCanonical(item.skillIO
      ? { schemaVersion: item.skillIO.schemaVersion, path: item.skillIO.path }
      : null)
    || hashCanonical(manifestItem.localization || null) !== hashCanonical(item.localization
      ? { schemaVersion: item.localization.schemaVersion, path: item.localization.path }
      : null)
  ) {
    throw snapshotError("SNAPSHOT_ITEM_CHANGED", "Selected content item changed before snapshot compilation.", { item_id: item.id });
  }
  const validatedFiles = new Map(validated.files.map((file) => [file.relativePath, file]));
  const localizationResources = item.type === "skill"
    ? validated.resources?.skillLocalizations
    : validated.resources?.narrativeLocalizations;
  const validatedLocalization = localizationResources?.find((entry) => entry.itemId === item.id) || null;
  if (hashCanonical(projectLocalizationResource(validatedLocalization))
    !== hashCanonical(projectLocalizationResource(item.localization))) {
    throw snapshotError("SNAPSHOT_LOCALIZATION_CHANGED", "Selected content localization changed before snapshot compilation.", { item_id: item.id });
  }
  const resolvedSourcePaths = sourcePathsForItem(manifestItem, validatedLocalization);
  assertResolvedSourceFiles(item, resolvedSourcePaths, validatedFiles);
  const selected = selectSnapshotSources(item, manifestItem, validatedLocalization, options.language);
  const sourcePaths = selected.sourcePaths;
  const destinationPaths = destinationPathsForItem(item, manifestItem, validatedLocalization);
  const validatedModule = validated.resources?.skillModules?.find((entry) => entry.itemId === item.id) || null;
  if (item.module && (
    !validatedModule
    || validatedModule.path !== item.module.path
    || validatedModule.sha256 !== item.module.sha256
    || validatedModule.sizeBytes !== item.module.sizeBytes
    || hashCanonical(validatedModule.definition) !== hashCanonical(item.module.definition)
  )) {
    throw snapshotError("SNAPSHOT_MODULE_CHANGED", "Selected Skill module changed before snapshot compilation.", { item_id: item.id });
  }
  const validatedSkillIO = validated.resources?.skillIOCompanions?.find((entry) => entry.itemId === item.id) || null;
  if (item.skillIO && (
    !validatedSkillIO
    || validatedSkillIO.path !== item.skillIO.path
    || validatedSkillIO.sha256 !== item.skillIO.sha256
    || validatedSkillIO.sizeBytes !== item.skillIO.sizeBytes
    || hashCanonical(validatedSkillIO.companion) !== hashCanonical(item.skillIO.companion)
  )) {
    throw snapshotError("SNAPSHOT_SKILL_IO_CHANGED", "Selected Skill I/O companion changed before snapshot compilation.", { item_id: item.id });
  }
  const files = [];
  for (let index = 0; index < sourcePaths.length; index += 1) {
    const sourceRelative = sourcePaths[index];
    const sourceRecord = validatedFiles.get(sourceRelative);
    if (!sourceRecord) throw snapshotError("SNAPSHOT_SOURCE_MISSING", "Selected content source is missing.", { item_id: item.id });
    const source = safeChild(packRoot, sourceRelative);
    const content = await readVerifiedSource(source, sourceRecord);
    const relativePath = destinationPaths[index];
    const destination = safeChild(snapshotRoot, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, { flag: "wx", mode: 0o600 });
    files.push({ relativePath, sha256: sourceRecord.sha256, sizeBytes: sourceRecord.sizeBytes });
  }
  // A narrative document's heading need not be its player-facing title. Keep
  // the reviewed title in the selected story language inside the same lock.
  const narrativeTitle = item.type === "host" || item.type === "world"
    ? validatedLocalization?.locales?.find((entry) => entry.locale === selected.language)?.title || manifestItem.title
    : null;
  const itemRef = {
    packId: item.packId,
    packVersion: item.packVersion,
    itemId: item.id,
    itemType: item.type,
    ...(narrativeTitle ? { title: narrativeTitle } : {}),
    ...(item.type === "skill" ? { skillClass: item.skillClass } : {}),
    language: selected.language,
    ...(moduleByItem.get(`${item.packId}:${item.id}`)
      ? { skillModule: moduleByItem.get(`${item.packId}:${item.id}`).lock }
      : {}),
    ...(skillIOByItem.get(`${item.packId}:${item.id}`)
      ? { skillIO: skillIOByItem.get(`${item.packId}:${item.id}`).lock }
      : {}),
    sha256: hashCanonical({
      packId: item.packId,
      packVersion: item.packVersion,
      itemId: item.id,
      itemType: item.type,
      ...(narrativeTitle ? { title: narrativeTitle } : {}),
      skillClass: item.skillClass,
      language: selected.language,
      files,
      skillModule: moduleByItem.get(`${item.packId}:${item.id}`)?.lock || null,
      skillIO: skillIOByItem.get(`${item.packId}:${item.id}`)?.lock || null,
    }),
  };
  return {
    itemRef,
    files,
    skillLocalizationLock: item.type === "skill"
      ? buildSkillLocalizationLock(item, manifestItem, validatedLocalization, sourcePaths, destinationPaths, files)
      : null,
  };
}

function projectLocalizationResource(value) {
  if (!value) return null;
  return {
    itemId: value.itemId,
    itemType: value.itemType || null,
    path: value.path,
    sourceLocale: value.sourceLocale,
    bundle: value.bundle,
    sha256: value.sha256,
    sizeBytes: value.sizeBytes,
    locales: value.locales,
  };
}

function sourcePathsForItem(manifestItem, localization) {
  return [
    manifestItem.path,
    ...(manifestItem.templates || []),
    ...(manifestItem.module ? [manifestItem.module.path] : []),
    ...(manifestItem.skillIO ? [manifestItem.skillIO.path] : []),
    ...(localization ? [
      localization.path,
      ...localization.locales.flatMap((locale) => [
        locale.body.path,
        ...(locale.templates || []).map((template) => template.path),
        ...(locale.modulePresentation ? [locale.modulePresentation.path] : []),
      ]),
    ] : []),
  ];
}

function selectSnapshotSources(item, manifestItem, localization, requestedLanguage) {
  if (item.type === "skill") {
    return { sourcePaths: sourcePathsForItem(manifestItem, localization), language: item.language };
  }
  if (item.type !== "host" && item.type !== "world") {
    throw snapshotError("SNAPSHOT_ITEM_TYPE_INVALID", "Snapshot compiler received an unsupported item type.");
  }
  const target = String(requestedLanguage || item.language).trim();
  if (target === item.language) {
    return { sourcePaths: [manifestItem.path], language: target };
  }
  const localized = localization?.locales?.find((entry) => entry.locale === target);
  if (!localized) {
    throw snapshotError(
      "SNAPSHOT_LOCALE_UNAVAILABLE",
      "Selected Host or World does not provide the Adventure language.",
      { item_id: item.id, language: target }
    );
  }
  return { sourcePaths: [localized.body.path], language: target };
}

function destinationPathsForItem(item, manifestItem, localization) {
  if (item.type === "host") return ["host/host.md"];
  if (item.type === "world") return ["world/world.md"];
  if (item.type !== "skill") throw snapshotError("SNAPSHOT_ITEM_TYPE_INVALID", "Snapshot compiler received an unsupported item type.");
  const names = new Set();
  const destinations = [`skills/${item.id}/SKILL.md`];
  for (const sourcePath of manifestItem.templates || []) {
    const name = path.basename(sourcePath);
    const key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) throw snapshotError("SNAPSHOT_TEMPLATE_COLLISION", "Skill templates have colliding file names.", { item_id: item.id });
    names.add(key);
    destinations.push(`skills/${item.id}/templates/${name}`);
  }
  if (manifestItem.module) destinations.push(`skills/${item.id}/module.json`);
  if (manifestItem.skillIO) destinations.push(`skills/${item.id}/skill-io.json`);
  if (localization) {
    destinations.push(`skills/${item.id}/localization.bundle.json`);
    for (const locale of localization.locales) {
      const localeRoot = `skills/${item.id}/locales/${locale.locale}`;
      destinations.push(`${localeRoot}/SKILL.md`);
      const localeNames = new Set();
      for (const template of locale.templates) {
        const name = path.basename(template.path);
        const key = name.toLocaleLowerCase("en-US");
        if (localeNames.has(key)) {
          throw snapshotError("SNAPSHOT_TEMPLATE_COLLISION", "Localized Skill templates have colliding file names.", { item_id: item.id, locale: locale.locale });
        }
        localeNames.add(key);
        destinations.push(`${localeRoot}/templates/${name}`);
      }
      if (locale.modulePresentation) destinations.push(`${localeRoot}/module-presentation.json`);
    }
  }
  return destinations;
}

function buildSkillLocalizationLock(item, manifestItem, localization, sourcePaths, destinationPaths, files) {
  const destinationBySource = new Map(sourcePaths.map((sourcePath, index) => [sourcePath, destinationPaths[index]]));
  const fileByDestination = new Map(files.map((file) => [file.relativePath, file]));
  const descriptor = (sourcePath) => {
    const relativePath = destinationBySource.get(sourcePath);
    const file = fileByDestination.get(relativePath);
    if (!relativePath || !file) {
      throw snapshotError("SNAPSHOT_LOCALIZATION_LOCK_INVALID", "Localized Skill file is missing from the compiled snapshot.", { item_id: item.id });
    }
    return { relativePath, sha256: file.sha256 };
  };
  const locales = [{
    locale: item.language,
    title: item.title,
    description: item.description,
    triggers: [...item.triggers],
    playerGuide: item.playerGuide || null,
    body: descriptor(manifestItem.path),
    templates: (manifestItem.templates || []).map((templatePath) => ({
      templateId: templateIdFromPath(templatePath),
      ...descriptor(templatePath),
    })),
    modulePresentation: null,
  }];
  for (const locale of localization?.locales || []) {
    locales.push({
      locale: locale.locale,
      title: locale.title,
      description: locale.description,
      triggers: [...locale.triggers],
      playerGuide: locale.playerGuide,
      body: descriptor(locale.body.path),
      templates: locale.templates.map((template) => ({
        templateId: template.templateId,
        ...descriptor(template.path),
      })),
      modulePresentation: locale.modulePresentation
        ? descriptor(locale.modulePresentation.path)
        : null,
    });
  }
  return {
    packId: item.packId,
    packVersion: item.packVersion,
    itemId: item.id,
    ownership: item.ownership || "imported_readonly",
    skillClass: item.skillClass,
    danger: item.danger,
    sourceLocale: item.language,
    locales,
  };
}

function templateIdFromPath(templatePath) {
  return `template:${path.posix.basename(templatePath).replace(/\.md$/i, "")}`;
}

function assertResolvedSourceFiles(item, sourcePaths, validatedFiles) {
  const expected = Array.isArray(item.sourceFiles) ? item.sourceFiles : [];
  if (expected.length === 0) return;
  if (expected.length !== sourcePaths.length) {
    throw snapshotError("SNAPSHOT_SOURCE_CHANGED", "Selected content source set changed before snapshot compilation.", { item_id: item.id });
  }
  for (let index = 0; index < sourcePaths.length; index += 1) {
    const prior = expected[index];
    const current = validatedFiles.get(sourcePaths[index]);
    if (!prior || prior.relativePath !== sourcePaths[index] || !current
      || prior.sha256 !== current.sha256 || prior.sizeBytes !== current.sizeBytes) {
      throw snapshotError("SNAPSHOT_SOURCE_CHANGED", "Selected content source changed before snapshot compilation.", { item_id: item.id });
    }
  }
}

function assertPreparedModuleExpectation(options, prepared) {
  if (Object.prototype.hasOwnProperty.call(options, "expectedSkillModuleContentHash")
    && options.expectedSkillModuleContentHash !== prepared.contentHash) {
    throw snapshotError("SNAPSHOT_PREPARE_STALE", "Skill module content changed after New Game confirmation.");
  }
  if (Object.prototype.hasOwnProperty.call(options, "expectedModuleReviewHash")
    && (options.expectedModuleReviewHash || null) !== (prepared.moduleReviewHash || null)) {
    throw snapshotError("SNAPSHOT_PREPARE_STALE", "Skill module capability review changed after New Game confirmation.");
  }
}

function prepareBuiltInDomainSkills(options, skillModulePrepare) {
  const requested = Array.isArray(options.builtInDomainSkillIds)
    ? options.builtInDomainSkillIds.map((value) => String(value || "").trim())
    : [];
  if (new Set(requested).size !== requested.length || requested.some((id) => id !== CHARACTER_SKILL_ID)) {
    throw snapshotError(
      "SNAPSHOT_BUILT_IN_DOMAIN_SKILL_INVALID",
      "Requested built-in domain Skills are invalid or duplicated."
    );
  }
  if (requested.length === 0) return [];
  const bundle = compileCharacterDomainSkillBundle();
  const ordinaryToolNames = new Set((skillModulePrepare.skillIOCompanions || [])
    .flatMap((entry) => entry.companion.actions.map((action) => action.toolName)));
  for (const action of bundle.companion.actions) {
    if (ordinaryToolNames.has(action.toolName)) {
      throw snapshotError(
        "SNAPSHOT_BUILT_IN_DOMAIN_TOOL_COLLISION",
        "A built-in domain Skill action collides with an ordinary Skill action.",
        { tool_name: action.toolName }
      );
    }
  }
  return [{ skillId: CHARACTER_SKILL_ID, capability: bundle.companion.target.capability, bundle }];
}

async function writeBuiltInDomainSkills(snapshotRoot, prepared, files) {
  const descriptors = [];
  for (const entry of prepared) {
    const resources = {};
    for (const [resourceName, value] of Object.entries(entry.bundle)) {
      const buffer = jsonBuffer(value);
      assertNoSecret(buffer);
      const relativePath = `built-in-skills/${entry.skillId}/${resourceName}.json`;
      const sha256 = hashBuffer(buffer);
      const destination = safeChild(snapshotRoot, relativePath);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, buffer, { flag: "wx", mode: 0o600 });
      files.push({ relativePath, sha256, sizeBytes: buffer.length });
      resources[resourceName] = { relativePath, sha256 };
    }
    descriptors.push({
      skillId: entry.skillId,
      capability: entry.capability,
      companion: resources.companion,
      grant: resources.grant,
      lock: resources.lock,
    });
  }
  return descriptors;
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readVerifiedSource(source, expected) {
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.sizeBytes) {
    throw snapshotError("SNAPSHOT_SOURCE_CHANGED", "Content source changed during compilation.");
  }
  const content = await fs.readFile(source);
  if (hashBuffer(content) !== expected.sha256) throw snapshotError("SNAPSHOT_SOURCE_CHANGED", "Content source changed during compilation.");
  assertNoSecret(content);
  return content;
}

async function resolvePackRoot(packId, options) {
  let value;
  if (typeof options.resolvePackRoot === "function") value = await options.resolvePackRoot(packId);
  else if (options.packRoots instanceof Map) value = options.packRoots.get(packId);
  else if (options.packRoots && typeof options.packRoots === "object") value = options.packRoots[packId];
  const root = requireAbsolute(value, "packRoot");
  const stat = await fs.lstat(root).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw snapshotError("SNAPSHOT_PACK_UNAVAILABLE", "Selected Pack is unavailable.", { pack_id: packId });
  return root;
}

function requireLoadPlan(value) {
  if (!value || value.schemaVersion !== "grey-crow-content-load-plan-v2" || !value.host || !value.world || !value.newGameSkill || !Array.isArray(value.skills) || !Array.isArray(value.replacements)) {
    throw snapshotError("SNAPSHOT_PLAN_INVALID", "A resolved content load plan is required.");
  }
  return value;
}

async function requireRealDirectory(value) {
  await fs.mkdir(value, { recursive: true });
  const stat = await fs.lstat(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw snapshotError("SNAPSHOT_ROOT_INVALID", "Adventure root must be a real directory.");
  return path.resolve(value);
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

function normalizeTimestamp(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(normalized)) throw snapshotError("SNAPSHOT_TIMESTAMP_INVALID", "Snapshot timestamp is invalid.");
  return normalized;
}

function compareItemRefs(left, right) {
  return left.itemId.localeCompare(right.itemId) || left.packId.localeCompare(right.packId);
}

function compareLocalizationSkills(left, right) {
  return left.itemId.localeCompare(right.itemId) || left.packId.localeCompare(right.packId);
}

async function exists(target) {
  return Boolean(await fs.lstat(target).catch(() => null));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

module.exports = { compileContentSnapshot };
