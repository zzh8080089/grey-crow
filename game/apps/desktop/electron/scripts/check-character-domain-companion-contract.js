#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertBuiltInDomainSkillBundle,
  compileCharacterDomainSkillBundle,
} = require("../../../../engine/content-v2/built-in-domain-skill-io");
const {
  validateContract,
} = require("../../../../engine/contracts/v2");
const { canonicalStringify } = require("../../../../engine/content-v2/snapshot-utils");

const EXPECTED_ACTION_FIELDS = Object.freeze({
  remember_new_character: ["description", "encounter"],
  record_character_encounter: ["character", "encounter"],
  identify_character: ["character", "name", "basis"],
  record_character_fact: ["character", "fact", "authority"],
  update_character_relationship: ["character", "relationship"],
});

main();

function main() {
  const first = compileCharacterDomainSkillBundle();
  const second = compileCharacterDomainSkillBundle();
  assert.equal(canonicalStringify(first), canonicalStringify(second), "Character domain bundle must compile deterministically.");

  assert.equal(validateContract("built-in-domain-skill-io-v1", first.companion).ok, true);
  assert.equal(validateContract("built-in-domain-skill-grant-v1", first.grant).ok, true);
  assert.equal(validateContract("built-in-domain-skill-lock-v1", first.lock).ok, true);
  assert.equal(assertBuiltInDomainSkillBundle(first), true);

  const modelSurface = Object.fromEntries(first.companion.actions.map((action) => [
    action.id,
    action.modelInput.fields.map((field) => field.name),
  ]));
  assert.deepEqual(modelSurface, EXPECTED_ACTION_FIELDS, "Model must see only the five fixed flat action shapes.");
  assert.deepEqual(
    first.companion.actions.find((action) => action.id === "identify_character")
      .modelInput.fields.find((field) => field.name === "basis").enum,
    ["self_reported", "observed", "alias", "rumor"]
  );
  assert.deepEqual(
    first.companion.actions.find((action) => action.id === "record_character_fact")
      .modelInput.fields.find((field) => field.name === "authority").enum,
    ["observed", "self_reported", "player_claim", "rumor", "narrative_event", "disputed"]
  );
  assert.equal(first.companion.identityPolicy.candidateDecisionOwner, "model");
  assert.equal(first.companion.identityPolicy.automaticMerge, "forbidden");
  assert.equal(first.companion.tracePolicy.argumentValues, "redacted");

  assertThrowsInvalid(() => validateContract("skill-io-companion-v1", first.companion),
    "Ordinary companion v1 must reject a privileged domain companion.");

  const reordered = clone(first.companion);
  [reordered.actions[0], reordered.actions[1]] = [reordered.actions[1], reordered.actions[0]];
  assertThrowsInvalid(() => validateContract("built-in-domain-skill-io-v1", reordered),
    "Character action order and identity must be fixed.");

  const extraModelField = clone(first.companion);
  extraModelField.actions[0].modelInput.fields.push({
    name: "path",
    type: "string",
    descriptionKey: "skill.characters.input.path",
    maxLength: 80,
  });
  extraModelField.actions[0].modelInput.required.push("path");
  assertThrowsInvalid(() => validateContract("built-in-domain-skill-io-v1", extraModelField),
    "Path and other bottom-layer fields must not enter the model surface.");

  const grantHashTamper = clone(first);
  grantHashTamper.grant.companionHash = "0".repeat(64);
  assert.equal(validateContract("built-in-domain-skill-grant-v1", grantHashTamper.grant).ok, true,
    "A standalone grant hash is structurally valid before cross-contract comparison.");
  assertThrowsCode(() => assertBuiltInDomainSkillBundle(grantHashTamper), "CONTENT_BUILT_IN_DOMAIN_SKILL_INVALID");

  const lockHashTamper = clone(first);
  lockHashTamper.lock.grant.sha256 = "f".repeat(64);
  assert.equal(validateContract("built-in-domain-skill-lock-v1", lockHashTamper.lock).ok, true,
    "A standalone lock hash is structurally valid before bundle comparison.");
  assertThrowsCode(() => assertBuiltInDomainSkillBundle(lockHashTamper), "CONTENT_BUILT_IN_DOMAIN_SKILL_INVALID");

  const contractRoot = path.resolve(__dirname, "../../../../engine/contracts/v2");
  const snapshotSchema = fs.readFileSync(path.join(contractRoot, "schemas/snapshot-lock.v2.schema.json"), "utf8");
  assert.equal(snapshotSchema.includes("grey-crow-built-in-domain-skill-lock-v1"), false,
    "C2-A must not attach the new lock to production snapshot-lock-v2.");

  const report = {
    schema_version: "grey-crow-character-domain-companion-contract-check-v1",
    status: "passed",
    scope: "c2_a_contract_compiler_and_isolated_fixture",
    contracts: [
      first.companion.schemaVersion,
      first.grant.schemaVersion,
      first.lock.schemaVersion,
    ],
    read_views: first.companion.readViews.map((view) => view.id),
    model_surface: first.companion.actions.map((action) => ({
      action: action.id,
      fields: action.modelInput.fields.map((field) => field.name),
      runtime_operation: action.runtimeMapping.operation,
    })),
    policies: {
      semantic_identity_decision: "model",
      stable_ref_and_commit: "runtime",
      automatic_merge: "forbidden",
      trace_argument_values: "redacted",
    },
    checks: [
      "deterministic_compilation",
      "three_registered_contracts",
      "five_fixed_flat_actions",
      "basis_and_authority_enums",
      "ordinary_companion_separation",
      "action_order_and_extra_field_rejection",
      "grant_hash_cross_validation",
      "lock_hash_cross_validation",
      "snapshot_v2_not_attached",
    ],
    production_attachment: {
      pack: false,
      snapshot_v2: false,
      router: false,
      provider: false,
      character_store: false,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function assertThrowsInvalid(callback, message) {
  assert.throws(callback, (error) => error?.code === "CONTRACT_INVALID", message);
}

function assertThrowsCode(callback, code) {
  assert.throws(callback, (error) => error?.code === code);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
