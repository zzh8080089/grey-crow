"use strict";

const { validateContract } = require("../contracts/v2");

const RESOLVED_SKILL_LOCALE_VERSION = "grey-crow-resolved-skill-locale-v1";
const DEFAULT_REVISION_PREFIX = "skill_locale_";
const MAX_TRACKED_REVISIONS = 32;

function createSkillLocaleResolver(options = {}) {
  const snapshotLoader = requireMethod(options.snapshotLoader, "snapshotLoader");
  const localeProvider = typeof options.localeProvider === "function" ? options.localeProvider : null;
  const revisionLocales = new Map();
  let activeRevision = null;
  let cache = null;

  async function preflight(input = {}, context = {}) {
    const snapshot = await loadSnapshot(snapshotLoader);
    const localeState = normalizeLocaleState(input, snapshot);
    return buildSkillLocaleCoverage(snapshot, localeState);
  }

  async function resolveCurrent(context = {}) {
    const snapshot = await loadSnapshot(snapshotLoader);
    const provided = localeProvider
      ? await localeProvider(Object.freeze({
          adventureId: context.adventureId || context.saveId || null,
          sourceLocale: snapshot.profile.language,
          snapshotHash: snapshot.lock.overallHash,
        }))
      : {};
    const localeState = normalizeLocaleState(provided, snapshot);
    rememberRevisionLocale(revisionLocales, localeState);
    if (activeRevision !== localeState.localeRevision) {
      cache = null;
      activeRevision = localeState.localeRevision;
    }
    const cacheKey = `${snapshot.lock.overallHash}:${localeState.localeRevision}:${localeState.gameLocale}`;
    if (cache?.key === cacheKey) return cache.value;
    const coverage = buildSkillLocaleCoverage(snapshot, localeState);
    if (coverage.status !== "ready") {
      throw localeError("SKILL_LOCALE_COVERAGE_BLOCKED", "The requested Skill locale is not complete for this Adventure.", {
        requested_locale: localeState.gameLocale,
        locale_revision: localeState.localeRevision,
        blocker_count: coverage.blockers.length,
      }, coverage);
    }
    const resolved = resolveSkillLocaleView(snapshot, localeState, coverage);
    cache = { key: cacheKey, value: resolved };
    return resolved;
  }

  function invalidate(input = {}) {
    const revision = input.localeRevision === undefined
      ? null
      : requireStableRevision(input.localeRevision);
    if (revision === null || revision === activeRevision) {
      cache = null;
      activeRevision = null;
    }
    return Object.freeze({ ok: true, invalidated: revision || "all" });
  }

  function inspectCache() {
    return Object.freeze({
      activeLocaleRevision: activeRevision,
      cached: Boolean(cache),
      trackedRevisionCount: revisionLocales.size,
    });
  }

  return Object.freeze({ preflight, resolveCurrent, invalidate, inspectCache });
}

function buildSkillLocaleCoverage(snapshot, localeState) {
  requireSnapshot(snapshot);
  const requestedLocale = requireCanonicalLocale(localeState.gameLocale);
  const localeRevision = requireStableRevision(localeState.localeRevision);
  const catalog = collectSkillLocaleCatalog(snapshot);
  const readySkillIds = [];
  const blockers = [];
  for (const skill of catalog) {
    const availableLocales = skill.locales.map((entry) => entry.locale);
    if (availableLocales.includes(requestedLocale)) {
      readySkillIds.push(skill.itemId);
      continue;
    }
    blockers.push({
      packId: skill.packId,
      itemId: skill.itemId,
      ownership: skill.ownership,
      reason: snapshot.content?.skillLocaleResources ? "missing_locale" : "source_only_snapshot",
      sourceLocale: skill.sourceLocale,
      availableLocales,
    });
  }
  const coverage = {
    schemaVersion: "grey-crow-skill-locale-coverage-v1",
    requestedLocale,
    localeRevision,
    status: blockers.length === 0 ? "ready" : "blocked",
    readySkillIds: readySkillIds.sort(),
    blockers: blockers.sort(compareSkillIdentity),
  };
  validateContract("skill-locale-coverage-v1", coverage);
  return deepFreeze(coverage);
}

function resolveSkillLocaleView(snapshot, localeState, coverage = null) {
  requireSnapshot(snapshot);
  const requestedLocale = requireCanonicalLocale(localeState.gameLocale);
  const localeRevision = requireStableRevision(localeState.localeRevision);
  const checkedCoverage = coverage || buildSkillLocaleCoverage(snapshot, { gameLocale: requestedLocale, localeRevision });
  if (checkedCoverage.status !== "ready") {
    throw localeError("SKILL_LOCALE_COVERAGE_BLOCKED", "The requested Skill locale is not complete for this Adventure.", {
      requested_locale: requestedLocale,
      locale_revision: localeRevision,
      blocker_count: checkedCoverage.blockers.length,
    }, checkedCoverage);
  }
  const originalPanels = new Map((snapshot.content?.skillPanels?.panels || [])
    .map((panel) => [`${panel.packId}:${panel.itemId}`, panel]));
  const catalog = collectSkillLocaleCatalog(snapshot);
  const resolvedSkills = catalog.map((skill) => {
    const locale = skill.locales.find((entry) => entry.locale === requestedLocale);
    const originalPanel = originalPanels.get(`${skill.packId}:${skill.itemId}`) || null;
    return deepFreeze({
      packId: skill.packId,
      packVersion: skill.packVersion,
      itemId: skill.itemId,
      ownership: skill.ownership,
      skillClass: skill.skillClass,
      danger: skill.danger,
      sourceLocale: skill.sourceLocale,
      resolvedLocale: requestedLocale,
      title: locale.title,
      description: locale.description,
      triggers: [...locale.triggers],
      playerGuide: locale.playerGuide,
      body: locale.body,
      templates: locale.templates.map((template) => ({ ...template })),
      modulePresentation: locale.modulePresentation,
      panel: originalPanel ? {
        ...originalPanel,
        title: locale.title,
        language: requestedLocale,
        description: locale.description,
        triggers: [...locale.triggers],
        playerGuide: locale.playerGuide,
      } : null,
    });
  });
  const newGameSkill = resolvedSkills.find((skill) => skill.skillClass === "new_game");
  if (!newGameSkill) throw localeError("SKILL_LOCALE_SNAPSHOT_INVALID", "Resolved Skill locale is missing the New Game Skill.");
  const skills = resolvedSkills.filter((skill) => skill.skillClass === "ordinary").sort(compareSkillIdentity);
  const panels = skills.map((skill) => skill.panel).filter(Boolean);
  return deepFreeze({
    schemaVersion: RESOLVED_SKILL_LOCALE_VERSION,
    gameLocale: requestedLocale,
    localeRevision,
    snapshotHash: snapshot.lock.overallHash,
    coverage: checkedCoverage,
    newGameSkill,
    skills,
    skillPanels: {
      schemaVersion: "grey-crow-skill-panel-presentation-v1",
      panels,
    },
  });
}

function collectSkillLocaleCatalog(snapshot) {
  const resources = snapshot.content?.skillLocaleResources?.skills;
  if (Array.isArray(resources)) {
    return resources.map((skill) => deepFreeze({
      packId: skill.packId,
      packVersion: skill.packVersion,
      itemId: skill.itemId,
      ownership: normalizeOwnership(skill.ownership, skill.packId),
      skillClass: skill.skillClass,
      danger: skill.danger,
      sourceLocale: requireCanonicalLocale(skill.sourceLocale),
      locales: skill.locales.map(normalizeLocaleResource),
    })).sort(compareSkillIdentity);
  }
  return collectLegacySourceCatalog(snapshot);
}

function collectLegacySourceCatalog(snapshot) {
  const panels = new Map((snapshot.content?.skillPanels?.panels || [])
    .map((panel) => [`${panel.packId}:${panel.itemId}`, panel]));
  const contents = new Map([
    [snapshot.profile.newGameSkill.itemId, snapshot.content.newGameSkill],
    ...(snapshot.profile.skills || []).map((item) => [
      item.itemId,
      snapshot.content.skills.find((skill) => skill.id === item.itemId),
    ]),
  ]);
  return [snapshot.profile.newGameSkill, ...snapshot.profile.skills].map((item) => {
    const content = contents.get(item.itemId);
    const panel = panels.get(`${item.packId}:${item.itemId}`) || null;
    const sourceLocale = requireCanonicalLocale(item.language);
    return deepFreeze({
      packId: item.packId,
      packVersion: item.packVersion,
      itemId: item.itemId,
      ownership: normalizeOwnership(item.ownership, item.packId),
      skillClass: item.skillClass,
      danger: null,
      sourceLocale,
      locales: [{
        locale: sourceLocale,
        title: panel?.title || titleFromMarkdown(content?.body) || item.itemId,
        description: panel?.description || null,
        triggers: Array.isArray(panel?.triggers) ? [...panel.triggers] : [],
        playerGuide: panel?.playerGuide || null,
        body: String(content?.body || ""),
        templates: (content?.templates || []).map((template) => ({
          templateId: normalizeTemplateId(template.name),
          body: String(template.body || ""),
        })),
        modulePresentation: null,
      }],
    });
  }).sort(compareSkillIdentity);
}

function normalizeLocaleResource(locale) {
  return deepFreeze({
    locale: requireCanonicalLocale(locale.locale),
    title: String(locale.title || ""),
    description: locale.description === null ? null : String(locale.description || ""),
    triggers: Array.isArray(locale.triggers) ? [...locale.triggers] : [],
    playerGuide: locale.playerGuide === null ? null : String(locale.playerGuide || ""),
    body: String(locale.body || ""),
    templates: (Array.isArray(locale.templates) ? locale.templates : []).map((template) => ({
      templateId: String(template.templateId || ""),
      body: String(template.body || ""),
    })),
    modulePresentation: locale.modulePresentation || null,
  });
}

function applySkillModulePresentation(definition, overlay) {
  validateContract("skill-module-definition-v1", definition);
  if (!overlay) return definition;
  validateContract("skill-module-presentation-overlay-v1", overlay);
  const translatedFields = new Map(overlay.fields.map((field) => [field.fieldId, field]));
  const translatedActions = new Map((overlay.actions || []).map((action) => [action.actionId, action]));
  const localized = cloneJson(definition);
  for (const action of localized.actions || []) {
    const translated = translatedActions.get(action.id);
    if (!translated) throw localeError("SKILL_LOCALE_OVERLAY_MISMATCH", "Localized module presentation is missing a stable action identity.", { action_id: action.id });
    action.description = translated.description;
  }
  for (const field of localized.fields) {
    const translated = translatedFields.get(field.id);
    if (!translated) throw localeError("SKILL_LOCALE_OVERLAY_MISMATCH", "Localized module presentation is missing a stable field identity.", { field_id: field.id });
    field.label = translated.label;
    const options = new Map(translated.options.map((option) => [option.value, option.label]));
    for (const option of field.options || []) {
      if (!options.has(option.value)) throw localeError("SKILL_LOCALE_OVERLAY_MISMATCH", "Localized module presentation is missing a stable option identity.", { field_id: field.id, option_value: option.value });
      option.label = options.get(option.value);
    }
    const itemFields = new Map(translated.itemFields.map((item) => [item.fieldId, item]));
    for (const itemField of field.itemFields || []) {
      const translatedItem = itemFields.get(itemField.id);
      if (!translatedItem) throw localeError("SKILL_LOCALE_OVERLAY_MISMATCH", "Localized module presentation is missing a stable record field identity.", { field_id: field.id, item_field_id: itemField.id });
      itemField.label = translatedItem.label;
      const itemOptions = new Map(translatedItem.options.map((option) => [option.value, option.label]));
      for (const option of itemField.options || []) {
        if (!itemOptions.has(option.value)) throw localeError("SKILL_LOCALE_OVERLAY_MISMATCH", "Localized module presentation is missing a stable record option identity.", { field_id: field.id, option_value: option.value });
        option.label = itemOptions.get(option.value);
      }
    }
    const milestones = new Map(translated.milestones.map((milestone) => [milestone.minimum, milestone.label]));
    for (const milestone of field.display?.summary?.milestones || []) {
      if (!milestones.has(milestone.minimum)) throw localeError("SKILL_LOCALE_OVERLAY_MISMATCH", "Localized module presentation is missing a stable milestone identity.", { field_id: field.id, minimum: milestone.minimum });
      milestone.label = milestones.get(milestone.minimum);
    }
  }
  validateContract("skill-module-definition-v1", localized);
  return deepFreeze(localized);
}

function normalizeLocaleState(input, snapshot) {
  const sourceLocale = requireCanonicalLocale(snapshot.profile.language);
  const gameLocale = requireCanonicalLocale(input?.gameLocale || input?.requestedLocale || sourceLocale);
  const localeRevision = requireStableRevision(input?.localeRevision
    || `${DEFAULT_REVISION_PREFIX}${snapshot.lock.overallHash.slice(0, 24)}`);
  return Object.freeze({ gameLocale, localeRevision });
}

function rememberRevisionLocale(revisions, localeState) {
  const previous = revisions.get(localeState.localeRevision);
  if (previous && previous !== localeState.gameLocale) {
    throw localeError("SKILL_LOCALE_REVISION_CONFLICT", "One locale revision cannot identify two different game locales.", {
      locale_revision: localeState.localeRevision,
    });
  }
  revisions.set(localeState.localeRevision, localeState.gameLocale);
  while (revisions.size > MAX_TRACKED_REVISIONS) revisions.delete(revisions.keys().next().value);
}

async function loadSnapshot(loader) {
  const snapshot = await loader();
  requireSnapshot(snapshot);
  return snapshot;
}

function requireSnapshot(snapshot) {
  if (!snapshot?.profile || !snapshot?.lock || !snapshot?.content || !Array.isArray(snapshot.profile.skills)) {
    throw localeError("SKILL_LOCALE_SNAPSHOT_INVALID", "A verified Adventure content snapshot is required.");
  }
}

function requireCanonicalLocale(value) {
  const locale = String(value || "").trim();
  let canonical;
  try {
    canonical = Intl.getCanonicalLocales(locale)[0];
  } catch {
    throw localeError("SKILL_LOCALE_INVALID", "Skill locale must be a valid canonical BCP 47 language tag.");
  }
  if (canonical !== locale) {
    throw localeError("SKILL_LOCALE_INVALID", `Skill locale must use canonical BCP 47 form ${canonical}.`);
  }
  return locale;
}

function requireStableRevision(value) {
  const revision = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(revision)) {
    throw localeError("SKILL_LOCALE_REVISION_INVALID", "Skill locale revision is invalid.");
  }
  return revision;
}

function normalizeOwnership(value, packId) {
  if (["built_in", "player_owned", "imported_readonly"].includes(value)) return value;
  return packId === "grey-crow-default" ? "built_in" : "imported_readonly";
}

function normalizeTemplateId(name) {
  return `template:${String(name || "").replace(/\.md$/i, "")}`;
}

function titleFromMarkdown(value) {
  const match = String(value || "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim().slice(0, 240) : "";
}

function compareSkillIdentity(left, right) {
  return left.itemId.localeCompare(right.itemId) || left.packId.localeCompare(right.packId);
}

function requireMethod(value, label) {
  if (typeof value !== "function") throw localeError("SKILL_LOCALE_CONFIG_INVALID", `${label} is required.`);
  return value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function localeError(code, message, meta = {}, coverage = null) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  error.meta = Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, String(value).slice(0, 160)]));
  if (coverage) error.coverage = coverage;
  return error;
}

module.exports = {
  RESOLVED_SKILL_LOCALE_VERSION,
  applySkillModulePresentation,
  buildSkillLocaleCoverage,
  createSkillLocaleResolver,
  resolveSkillLocaleView,
};
