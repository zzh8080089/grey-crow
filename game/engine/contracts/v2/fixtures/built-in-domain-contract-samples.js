"use strict";

const {
  compileCharacterDomainSkillBundle,
} = require("../../../content-v2/built-in-domain-skill-io");

function createBuiltInDomainContractSamples() {
  const bundle = compileCharacterDomainSkillBundle();
  const invalidCompanion = clone(bundle.companion);
  invalidCompanion.skillId = "characters_other";
  const invalidGrant = clone(bundle.grant);
  invalidGrant.actions[0].operation = "append_fact";
  const invalidLock = clone(bundle.lock);
  invalidLock.readViewIds = ["overview", "guide", "recent", "lookup"];

  return [
    contractCase("built-in-domain-skill-io-valid-character", "built-in-domain-skill-io-v1", "valid", true, bundle.companion),
    contractCase("built-in-domain-skill-io-invalid-skill-id", "built-in-domain-skill-io-v1", "invalid", false, invalidCompanion),
    contractCase("built-in-domain-skill-io-boundary-fixed-surface", "built-in-domain-skill-io-v1", "boundary", true, bundle.companion),
    contractCase("built-in-domain-skill-grant-valid-character", "built-in-domain-skill-grant-v1", "valid", true, bundle.grant),
    contractCase("built-in-domain-skill-grant-invalid-operation", "built-in-domain-skill-grant-v1", "invalid", false, invalidGrant),
    contractCase("built-in-domain-skill-grant-boundary-fixed-surface", "built-in-domain-skill-grant-v1", "boundary", true, bundle.grant),
    contractCase("built-in-domain-skill-lock-valid-character", "built-in-domain-skill-lock-v1", "valid", true, bundle.lock),
    contractCase("built-in-domain-skill-lock-invalid-view-order", "built-in-domain-skill-lock-v1", "invalid", false, invalidLock),
    contractCase("built-in-domain-skill-lock-boundary-fixed-surface", "built-in-domain-skill-lock-v1", "boundary", true, bundle.lock),
  ];
}

function contractCase(name, contractId, variant, expectValid, value) {
  return { name, contractId, variant, expectValid, value: clone(value) };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  createBuiltInDomainContractSamples,
};
