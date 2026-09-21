"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { validateContract } = require("../contracts/v2");
const { resolveContentPlan } = require("./generated/pack-resolver.cjs");
const { validatePackV2 } = require("./pack-validator");

const BUILT_IN_PACK_ID = "grey-crow-default";

async function loadBuiltInContentPack(options = {}) {
  if (typeof options.contentRoot !== "string" || !path.isAbsolute(options.contentRoot)) {
    throw builtInError("BUILT_IN_CONTENT_ROOT_INVALID", "Built-in contentRoot must be absolute.");
  }
  const packsRoot = path.join(path.resolve(options.contentRoot), "packs");
  const packRoot = path.join(packsRoot, BUILT_IN_PACK_ID);
  const validatedPack = await validatePackV2(packRoot, {
    trustedRoot: packsRoot,
    engineVersion: options.engineVersion,
    ownership: "built_in",
  });
  const preset = await readDefaultPreset(packRoot);
  const defaultSkills = [
    ...preset.skills,
    ...preset.optionalSkills.filter((skill) => skill.defaultEnabled).map(freezeRef),
  ];
  const defaultPlan = resolveContentPlan({
    packs: [validatedPack],
    selection: { host: preset.host, world: preset.world, newGameSkill: preset.newGameSkill, skills: defaultSkills },
    engineVersion: options.engineVersion,
  });
  return Object.freeze({
    schemaVersion: "grey-crow-built-in-content-v2",
    sourceKind: "normalized_pack",
    pack: validatedPack,
    defaultPreset: preset,
    defaultPlan,
  });
}

async function readDefaultPreset(packRoot) {
  const presetPath = path.join(packRoot, "presets", "default.json");
  let value;
  try {
    value = JSON.parse(await fs.readFile(presetPath, "utf8"));
  } catch {
    throw builtInError("BUILT_IN_PRESET_INVALID", "Built-in default preset is missing or invalid.");
  }
  try {
    validateContract("new-game-preset-v2", value);
  } catch {
    throw builtInError("BUILT_IN_PRESET_INVALID", "Built-in default preset failed contract validation.");
  }
  if (value.id !== BUILT_IN_PACK_ID) {
    throw builtInError("BUILT_IN_PRESET_INVALID", "Built-in default preset has the wrong schema or id.");
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    id: value.id,
    language: String(value.language || ""),
    locales: Object.freeze([...(value.locales || [value.language])]),
    host: freezeRef(value.host),
    world: freezeRef(value.world),
    newGameSkill: freezeRef(value.newGameSkill),
    skills: Object.freeze(value.skills.map(freezeRef)),
    optionalSkills: Object.freeze((value.optionalSkills || []).map(freezeOptionalRef)),
  });
}

function freezeRef(value) {
  return Object.freeze({ packId: value.packId, itemId: value.itemId });
}

function freezeOptionalRef(value) {
  return Object.freeze({ ...freezeRef(value), defaultEnabled: value.defaultEnabled === true });
}

function builtInError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

module.exports = { BUILT_IN_PACK_ID, loadBuiltInContentPack };
