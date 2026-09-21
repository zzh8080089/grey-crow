"use strict";

const { validatePackV2 } = require("./pack-validator");
const { BUILT_IN_PACK_ID, loadBuiltInContentPack } = require("./built-in-pack");
const { LIBRARY_SCHEMA_VERSION, createContentLibrary } = require("./content-library");
const { compileContentSnapshot } = require("./snapshot-compiler");
const { readContentSnapshot } = require("./snapshot-reader");
const {
  RESOLVED_SKILL_LOCALE_VERSION,
  applySkillModulePresentation,
  buildSkillLocaleCoverage,
  createSkillLocaleResolver,
  resolveSkillLocaleView,
} = require("./skill-locale-resolver");
const { createPlayerProfileStore } = require("./player-profile-store");
const { prepareSkillModuleSnapshot } = require("./skill-module-snapshot");
const {
  CREATOR_DRAFT_VERSION,
  CREATOR_FACADE_DRAFT_VERSION,
  SKILL_IO_VERSION,
  assertSkillIOCompanionMatchesDefinition,
  createSkillModuleCreatorDraft,
  normalizeSkillModuleCreatorDraft,
} = require("./skill-module-creator");
const resolver = require("./generated/pack-resolver.cjs");

module.exports = {
  ...resolver,
  BUILT_IN_PACK_ID,
  LIBRARY_SCHEMA_VERSION,
  CREATOR_DRAFT_VERSION,
  CREATOR_FACADE_DRAFT_VERSION,
  SKILL_IO_VERSION,
  RESOLVED_SKILL_LOCALE_VERSION,
  applySkillModulePresentation,
  buildSkillLocaleCoverage,
  compileContentSnapshot,
  createContentLibrary,
  createPlayerProfileStore,
  createSkillLocaleResolver,
  createSkillModuleCreatorDraft,
  assertSkillIOCompanionMatchesDefinition,
  loadBuiltInContentPack,
  prepareSkillModuleSnapshot,
  normalizeSkillModuleCreatorDraft,
  readContentSnapshot,
  resolveSkillLocaleView,
  validatePackV2,
};
