"use strict";

const { validateContract } = require("../contracts/v2");
const { hashCanonical } = require("./snapshot-utils");

const CHARACTER_SKILL_ID = "characters";
const CHARACTER_NAMESPACE = "builtin_characters_v1";
const CHARACTER_CAPABILITY = "character_records";

const CHARACTER_READ_VIEWS = Object.freeze([
  Object.freeze({ id: "guide", operation: "read_character_guide", query: false, limit: 1 }),
  Object.freeze({ id: "overview", operation: "read_character_overview", query: false, limit: 5 }),
  Object.freeze({ id: "recent", operation: "read_recent_characters", query: false, limit: 5 }),
  Object.freeze({ id: "lookup", operation: "lookup_characters", query: true, limit: 5 }),
]);

const CHARACTER_ACTIONS = Object.freeze([
  action("remember_new_character", "create_character", [
    textInput("description", 800),
    textInput("encounter", 800),
  ]),
  action("record_character_encounter", "append_encounter", [
    textInput("character", 80),
    textInput("encounter", 800),
  ]),
  action("identify_character", "record_identity", [
    textInput("character", 80),
    textInput("name", 160),
    enumInput("basis", ["self_reported", "observed", "alias", "rumor"]),
  ]),
  action("record_character_fact", "append_fact", [
    textInput("character", 80),
    textInput("fact", 800),
    enumInput("authority", [
      "observed",
      "self_reported",
      "player_claim",
      "rumor",
      "narrative_event",
      "disputed",
    ]),
  ]),
  action("update_character_relationship", "set_relationship", [
    textInput("character", 80),
    textInput("relationship", 400),
  ]),
]);

function compileCharacterDomainSkillIO() {
  const companion = {
    schemaVersion: "grey-crow-built-in-domain-skill-io-v1",
    skillId: CHARACTER_SKILL_ID,
    namespace: CHARACTER_NAMESPACE,
    target: {
      kind: "built_in_domain",
      capability: CHARACTER_CAPABILITY,
      canonicalOwner: "runtime",
    },
    identityPolicy: {
      stableRefOwner: "runtime",
      candidateDecisionOwner: "model",
      automaticMerge: "forbidden",
    },
    defaultView: "overview",
    readViews: CHARACTER_READ_VIEWS.map((view) => ({ ...view })),
    actions: CHARACTER_ACTIONS.map((spec) => ({
      id: spec.id,
      toolName: spec.id,
      descriptionKey: `skill.characters.action.${spec.id}`,
      modelInput: {
        fields: spec.inputs.map((field) => ({
          name: field.name,
          type: "string",
          descriptionKey: `skill.characters.input.${field.name}`,
          ...(field.maxLength ? { maxLength: field.maxLength } : {}),
          ...(field.enum ? { enum: [...field.enum] } : {}),
        })),
        required: spec.inputs.map((field) => field.name),
      },
      runtimeMapping: {
        capability: CHARACTER_CAPABILITY,
        operation: spec.operation,
      },
    })),
    transactionPolicy: {
      commit: "revisioned_atomic",
      idempotency: "action_identity",
      expectedRevision: "runtime_supplied_for_existing_record",
    },
    tracePolicy: {
      argumentValues: "redacted",
      argumentShape: "retained",
      stages: ["state_precondition", "canonical_commit"],
      receipt: "bounded",
    },
  };
  validateContract("built-in-domain-skill-io-v1", companion);
  return deepFreeze(companion);
}

function compileBuiltInDomainSkillGrant(companion = compileCharacterDomainSkillIO()) {
  validateContract("built-in-domain-skill-io-v1", companion);
  const grant = {
    schemaVersion: "grey-crow-built-in-domain-skill-grant-v1",
    skillId: companion.skillId,
    namespace: companion.namespace,
    companionHash: hashCanonical(companion),
    capability: companion.target.capability,
    readViewIds: companion.readViews.map((view) => view.id),
    actions: companion.actions.map((item) => ({
      id: item.id,
      toolName: item.toolName,
      operation: item.runtimeMapping.operation,
      inputNames: item.modelInput.fields.map((field) => field.name),
    })),
    writePolicy: {
      canonicalOwner: "runtime",
      expectedRevision: "runtime_supplied_for_existing_record",
      idempotency: "action_identity",
      automaticMerge: "forbidden",
    },
  };
  validateContract("built-in-domain-skill-grant-v1", grant);
  assertCompanionGrantMatch(companion, grant);
  return deepFreeze(grant);
}

function buildBuiltInDomainSkillLock(companion = compileCharacterDomainSkillIO(), grant = null) {
  const resolvedGrant = grant || compileBuiltInDomainSkillGrant(companion);
  assertCompanionGrantMatch(companion, resolvedGrant);
  const lock = {
    schemaVersion: "grey-crow-built-in-domain-skill-lock-v1",
    skillId: companion.skillId,
    namespace: companion.namespace,
    capability: companion.target.capability,
    companion: {
      schemaVersion: companion.schemaVersion,
      sha256: hashCanonical(companion),
    },
    grant: {
      schemaVersion: resolvedGrant.schemaVersion,
      sha256: hashCanonical(resolvedGrant),
    },
    readViewIds: companion.readViews.map((view) => view.id),
    actions: companion.actions.map((item) => ({ id: item.id, toolName: item.toolName })),
  };
  validateContract("built-in-domain-skill-lock-v1", lock);
  assertBuiltInDomainSkillBundle({ companion, grant: resolvedGrant, lock });
  return deepFreeze(lock);
}

function compileCharacterDomainSkillBundle() {
  const companion = compileCharacterDomainSkillIO();
  const grant = compileBuiltInDomainSkillGrant(companion);
  const lock = buildBuiltInDomainSkillLock(companion, grant);
  return deepFreeze({ companion, grant, lock });
}

function assertBuiltInDomainSkillBundle(bundle) {
  const companion = bundle?.companion;
  const grant = bundle?.grant;
  const lock = bundle?.lock;
  validateContract("built-in-domain-skill-io-v1", companion);
  validateContract("built-in-domain-skill-grant-v1", grant);
  validateContract("built-in-domain-skill-lock-v1", lock);
  assertCompanionGrantMatch(companion, grant);
  const expectedActionIds = companion.actions.map((item) => item.id);
  const expectedToolNames = companion.actions.map((item) => item.toolName);
  if (lock.skillId !== companion.skillId
    || lock.namespace !== companion.namespace
    || lock.capability !== companion.target.capability
    || lock.companion.sha256 !== hashCanonical(companion)
    || lock.grant.sha256 !== hashCanonical(grant)
    || !sameStrings(lock.readViewIds, companion.readViews.map((view) => view.id))
    || !sameStrings(lock.actions.map((item) => item.id), expectedActionIds)
    || !sameStrings(lock.actions.map((item) => item.toolName), expectedToolNames)) {
    throw contractError("Built-in domain Skill lock does not match its companion and grant.");
  }
  return true;
}

function assertCompanionGrantMatch(companion, grant) {
  validateContract("built-in-domain-skill-io-v1", companion);
  validateContract("built-in-domain-skill-grant-v1", grant);
  const companionInputs = companion.actions.map((item) => item.modelInput.fields.map((field) => field.name).join(":"));
  const grantInputs = grant.actions.map((item) => item.inputNames.join(":"));
  if (grant.skillId !== companion.skillId
    || grant.namespace !== companion.namespace
    || grant.capability !== companion.target.capability
    || grant.companionHash !== hashCanonical(companion)
    || !sameStrings(grant.readViewIds, companion.readViews.map((view) => view.id))
    || !sameStrings(grant.actions.map((item) => item.id), companion.actions.map((item) => item.id))
    || !sameStrings(grant.actions.map((item) => item.toolName), companion.actions.map((item) => item.toolName))
    || !sameStrings(grant.actions.map((item) => item.operation), companion.actions.map((item) => item.runtimeMapping.operation))
    || !sameStrings(grantInputs, companionInputs)) {
    throw contractError("Built-in domain Skill grant does not match its companion.");
  }
  return true;
}

function action(id, operation, inputs) {
  return Object.freeze({ id, operation, inputs: Object.freeze(inputs) });
}

function textInput(name, maxLength) {
  return Object.freeze({ name, maxLength });
}

function enumInput(name, values) {
  return Object.freeze({ name, enum: Object.freeze(values) });
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function contractError(message) {
  const error = new Error(message);
  error.code = "CONTENT_BUILT_IN_DOMAIN_SKILL_INVALID";
  error.retryable = false;
  return error;
}

module.exports = {
  CHARACTER_ACTIONS,
  CHARACTER_CAPABILITY,
  CHARACTER_NAMESPACE,
  CHARACTER_READ_VIEWS,
  CHARACTER_SKILL_ID,
  assertBuiltInDomainSkillBundle,
  buildBuiltInDomainSkillLock,
  compileBuiltInDomainSkillGrant,
  compileCharacterDomainSkillBundle,
  compileCharacterDomainSkillIO,
};
