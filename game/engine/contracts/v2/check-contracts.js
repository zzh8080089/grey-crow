"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { ERROR_CODES } = require("../../providers/provider-contracts");
const {
  validateContract,
  detectContractVersion,
  listContracts,
} = require("./index");
const staticSamples = require("./fixtures/static-contract-samples.v2.json");
const {
  createBuiltInDomainContractSamples,
} = require("./fixtures/built-in-domain-contract-samples");
const {
  createGenericSkillPanelContractSamples,
} = require("./fixtures/generic-skill-panel-contract-samples");
const samples = {
  cases: [
    ...staticSamples.cases,
    ...createBuiltInDomainContractSamples(),
    ...createGenericSkillPanelContractSamples(),
  ],
};

async function runContractChecks() {
  const variantsByContract = new Map();
  let passed = 0;

  for (const sample of samples.cases) {
    const variants = variantsByContract.get(sample.contractId) || new Set();
    variants.add(sample.variant);
    variantsByContract.set(sample.contractId, variants);

    if (sample.expectValid) {
      const result = validateContract(sample.contractId, sample.value);
      assert.equal(result.ok, true, `${sample.name} should validate`);
    } else {
      assertContractInvalid(sample.contractId, sample.value, sample.name);
    }
    passed += 1;
  }

  for (const contract of listContracts()) {
    assert.deepEqual(
      [...(variantsByContract.get(contract.contract_id) || [])].sort(),
      ["boundary", "invalid", "valid"],
      `${contract.contract_id} must have valid, invalid and boundary static samples`
    );
  }

  runTargetedBoundaryChecks();
  runDiscriminatorChecks();

  return {
    name: "p2-23-contracts",
    ok: true,
    contracts: listContracts().length,
    static_samples: passed,
    targeted_boundaries: 50,
  };
}

function runTargetedBoundaryChecks() {
  const transcript = cloneSample("transcript-turn-valid");
  transcript.user.text = "x".repeat(65537);
  assertContractInvalid("transcript-turn-v2", transcript, "transcript overlong body");

  const finaleTranscript = cloneSample("transcript-turn-valid");
  finaleTranscript.entryKind = "story_finale";
  finaleTranscript.chapterId = "chapter-finale-0123456789abcdef01234567";
  assert.equal(validateContract("transcript-turn-v2", finaleTranscript).ok, true, "Finale transcript marker should validate");

  const invalidTranscriptKind = cloneSample("transcript-turn-valid");
  invalidTranscriptKind.entryKind = "provider_internal";
  assertContractInvalid("transcript-turn-v2", invalidTranscriptKind, "unknown transcript entry kind");

  const extension = cloneSample("extension-pack-valid");
  extension.provides.push({ ...extension.provides[0] });
  assertContractInvalid("extension-pack-v2", extension, "duplicate provide id");

  const adventure = cloneSample("adventure-valid-active");
  adventure.promptBody = "must not be accepted";
  assertContractInvalid("adventure-save-v2", adventure, "unknown adventure field");

  const snapshot = cloneSample("snapshot-lock-valid");
  snapshot.files.push({ ...snapshot.files[0] });
  assertContractInvalid("snapshot-lock-v2", snapshot, "duplicate snapshot path");

  const missingSkillClass = cloneSample("extension-pack-valid");
  delete missingSkillClass.provides.find((item) => item.id === "map-skill").skillClass;
  assertContractInvalid("extension-pack-v2", missingSkillClass, "Skill class is required");

  const missingLifecycleTrigger = cloneSample("extension-pack-valid");
  missingLifecycleTrigger.provides.find((item) => item.skillClass === "new_game").triggers = ["new game"];
  assertContractInvalid("extension-pack-v2", missingLifecycleTrigger, "New Game lifecycle trigger is required");

  const shortSkillDescription = cloneSample("extension-pack-valid");
  shortSkillDescription.provides.find((item) => item.id === "map-skill").description = "地图";
  assertContractInvalid("extension-pack-v2", shortSkillDescription, "Skill description must explain its purpose and applicability");

  const normalizedDuplicateTriggers = cloneSample("extension-pack-valid");
  normalizedDuplicateTriggers.provides.find((item) => item.id === "map-skill").triggers = ["Map", " map "];
  assertContractInvalid("extension-pack-v2", normalizedDuplicateTriggers, "normalized Skill trigger duplicates");

  const escapedSkillTemplate = cloneSample("extension-pack-valid");
  escapedSkillTemplate.provides.find((item) => item.id === "map-skill").templates = ["skills/shared/templates/map.md"];
  assertContractInvalid("extension-pack-v2", escapedSkillTemplate, "Skill template must remain inside its own template directory");

  const missingWritePermission = cloneSample("extension-pack-valid");
  missingWritePermission.permissions = missingWritePermission.permissions.filter((item) => item !== "write_current_saveRoot_via_tools");
  assertContractInvalid("extension-pack-v2", missingWritePermission, "Skill write scopes require the Pack write permission");

  const wrongProfileClass = cloneSample("content-profile-valid");
  wrongProfileClass.newGameSkill.skillClass = "ordinary";
  assertContractInvalid("content-profile-v2", wrongProfileClass, "profile New Game Skill class");

  const missingSnapshotNewGame = cloneSample("snapshot-lock-valid");
  missingSnapshotNewGame.items = missingSnapshotNewGame.items.filter((item) => item.skillClass !== "new_game");
  assertContractInvalid("snapshot-lock-v2", missingSnapshotNewGame, "snapshot New Game Skill count");

  const extensionWithModule = cloneSample("extension-pack-valid");
  const ordinarySkill = extensionWithModule.provides.find((item) => item.id === "map-skill");
  ordinarySkill.playerGuide = "Open this panel to review known routes and module state.";
  ordinarySkill.module = {
    schemaVersion: "grey-crow-skill-module-ref-v1",
    path: "skills/map/module.json",
  };
  assert.equal(validateContract("extension-pack-v2", extensionWithModule).ok, true, "ordinary Skill module ref should validate");

  const lifecycleModule = cloneSample("extension-pack-valid");
  lifecycleModule.provides.find((item) => item.skillClass === "new_game").module = {
    schemaVersion: "grey-crow-skill-module-ref-v1",
    path: "skills/new-game/module.json",
  };
  assertContractInvalid("extension-pack-v2", lifecycleModule, "New Game Skill module ref");

  const escapedModule = cloneSample("extension-pack-valid");
  escapedModule.provides.find((item) => item.id === "map-skill").module = {
    schemaVersion: "grey-crow-skill-module-ref-v1",
    path: "skills/shared/module.json",
  };
  assertContractInvalid("extension-pack-v2", escapedModule, "Skill module must remain beside its Skill entry");

  const unknownSummary = cloneSample("skill-module-definition-valid-memory-fragments");
  unknownSummary.summaryFields = ["missing_field"];
  assertContractInvalid("skill-module-definition-v1", unknownSummary, "module summary field reference");

  const duplicateOptions = cloneSample("skill-module-definition-valid-memory-fragments");
  const dimension = duplicateOptions.fields[0].itemFields.find((field) => field.id === "dimension");
  dimension.options.push({ ...dimension.options[0] });
  assertContractInvalid("skill-module-definition-v1", duplicateOptions, "module enum option uniqueness");

  const reservedRecordField = cloneSample("skill-module-definition-valid-memory-fragments");
  reservedRecordField.fields[0].itemFields[0].id = "entry_id";
  assertContractInvalid("skill-module-definition-v1", reservedRecordField, "Engine-owned record metadata field id");

  const duplicateOptionalSkill = cloneSample("new-game-preset-valid-optional-skills");
  duplicateOptionalSkill.optionalSkills.push({ ...duplicateOptionalSkill.optionalSkills[0] });
  assertContractInvalid("new-game-preset-v2", duplicateOptionalSkill, "optional Skill reference uniqueness");

  const duplicateGrantField = cloneSample("skill-module-grant-valid-append-only");
  duplicateGrantField.writableFields.push({ ...duplicateGrantField.writableFields[0] });
  assertContractInvalid("skill-module-grant-v1", duplicateGrantField, "module grant field uniqueness");

  const invalidPagination = cloneSample("skill-module-projection-valid");
  invalidPagination.pagination.hasMore = true;
  assertContractInvalid("skill-module-projection-v1", invalidPagination, "module projection pagination cursor");

  const panelOnlyProfile = cloneSample("content-profile-boundary-no-optional-skill");
  panelOnlyProfile.features = ["skill-panel-presentation-v1"];
  panelOnlyProfile.skillPanelPresentation = {
    relativePath: "skill-panels.lock.json",
    sha256: "f".repeat(64),
  };
  assert.equal(validateContract("content-profile-v2", panelOnlyProfile).ok, true, "stateless panel presentation should remain valid");

  const missingPanelFeature = cloneSample("content-profile-valid");
  missingPanelFeature.features = missingPanelFeature.features.filter((feature) => feature !== "skill-panel-presentation-v1");
  assertContractInvalid("content-profile-v2", missingPanelFeature, "profile panel descriptor feature consistency");

  const missingModuleReview = cloneSample("content-profile-valid");
  delete missingModuleReview.moduleReviewHash;
  assertContractInvalid("content-profile-v2", missingModuleReview, "profile module review consistency");

  const readOnlyModuleProfile = cloneSample("content-profile-valid");
  readOnlyModuleProfile.skills[0].skillModule.grant.writableFields = [];
  delete readOnlyModuleProfile.moduleReviewHash;
  assert.equal(validateContract("content-profile-v2", readOnlyModuleProfile).ok, true, "read-only module should not require a capability review");

  const unnecessaryModuleReview = cloneSample("content-profile-valid");
  unnecessaryModuleReview.skills[0].skillModule.grant.writableFields = [];
  assertContractInvalid("content-profile-v2", unnecessaryModuleReview, "read-only module must not claim a write capability review");

  const mismatchedProfileGrant = cloneSample("content-profile-valid");
  mismatchedProfileGrant.skills[0].skillModule.grant.moduleRef = "module_other_01";
  assertContractInvalid("content-profile-v2", mismatchedProfileGrant, "profile locked module grant identity");

  const hostWithModule = cloneSample("content-profile-valid");
  hostWithModule.host.skillModule = JSON.parse(JSON.stringify(hostWithModule.skills[0].skillModule));
  assertContractInvalid("content-profile-v2", hostWithModule, "profile Host cannot lock a Skill module");

  const mismatchedPanelFile = cloneSample("snapshot-lock-valid");
  mismatchedPanelFile.files.find((file) => file.relativePath === "skill-panels.lock.json").sha256 = "0".repeat(64);
  assertContractInvalid("snapshot-lock-v2", mismatchedPanelFile, "snapshot panel descriptor must match the tracked file");

  const missingSnapshotModuleFeature = cloneSample("snapshot-lock-valid");
  missingSnapshotModuleFeature.features = missingSnapshotModuleFeature.features.filter((feature) => feature !== "skill-module-v1");
  assertContractInvalid("snapshot-lock-v2", missingSnapshotModuleFeature, "snapshot module descriptor feature consistency");

  const newGameWithModule = cloneSample("snapshot-lock-valid");
  const lockedModule = newGameWithModule.items.find((item) => item.skillClass === "ordinary").skillModule;
  newGameWithModule.items.find((item) => item.skillClass === "new_game").skillModule = JSON.parse(JSON.stringify(lockedModule));
  assertContractInvalid("snapshot-lock-v2", newGameWithModule, "snapshot New Game Skill cannot lock a module");

  const moduleFeatureWithoutItem = cloneSample("snapshot-lock-valid");
  delete moduleFeatureWithoutItem.items.find((item) => item.skillClass === "ordinary").skillModule;
  assertContractInvalid("snapshot-lock-v2", moduleFeatureWithoutItem, "snapshot module feature requires a locked ordinary Skill module");

  const normalizedDuplicateClosedThread = cloneSample("story-finale-candidate-valid");
  normalizedDuplicateClosedThread.closedThreads.push(" 找到失踪的同伴 ");
  assertContractInvalid("story-finale-candidate-v1", normalizedDuplicateClosedThread, "Finale candidate normalized closed thread uniqueness");

  const decisionWithPath = cloneSample("story-finale-decision-valid-finish");
  decisionWithPath.savePath = "/tmp/forbidden";
  assertContractInvalid("story-finale-decision-v1", decisionWithPath, "Finale decision cannot carry a path");

  const closedLedgerWithoutFinale = cloneSample("story-finale-ledger-valid-pending");
  closedLedgerWithoutFinale.phase = "closed";
  assertContractInvalid("story-finale-ledger-v1", closedLedgerWithoutFinale, "closed Finale ledger requires committed finale identity");

  const mismatchedLedgerDecision = cloneSample("story-finale-ledger-valid-pending");
  mismatchedLedgerDecision.phase = "finalizing";
  mismatchedLedgerDecision.lastDecision = cloneSample("story-finale-decision-valid-finish");
  mismatchedLedgerDecision.lastDecision.candidateId = "finale_candidate_other";
  mismatchedLedgerDecision.activeTransactionId = "finale_operation_001";
  assertContractInvalid("story-finale-ledger-v1", mismatchedLedgerDecision, "Finale decision must match the pending candidate");

  const pendingProjectionWithoutInput = cloneSample("story-finale-projection-valid-pending");
  pendingProjectionWithoutInput.inputAllowed = false;
  assertContractInvalid("story-finale-projection-v1", pendingProjectionWithoutInput, "pending natural-language Finale must keep player input available");

  const chapterTransactionWithoutTranscript = cloneSample("story-finale-transaction-valid-ledger-committed");
  chapterTransactionWithoutTranscript.phase = "chapter_committed";
  chapterTransactionWithoutTranscript.artifacts.transcriptTurnId = null;
  chapterTransactionWithoutTranscript.artifacts.finaleId = null;
  assertContractInvalid("story-finale-transaction-v1", chapterTransactionWithoutTranscript, "Finale chapter cannot commit before transcript");

  const recoveryWithoutError = cloneSample("story-finale-transaction-boundary-recovery");
  recoveryWithoutError.errorCode = null;
  assertContractInvalid("story-finale-transaction-v1", recoveryWithoutError, "Finale recovery requires a stable error code");

  const easterTransactionWithContinuation = cloneSample("story-finale-transaction-boundary-easter");
  easterTransactionWithContinuation.continuationPolicy = "allowed";
  assertContractInvalid("story-finale-transaction-v1", easterTransactionWithContinuation, "Easter Finale transaction must permanently forbid continuation");

  const easterCandidateWithPath = cloneSample("extreme-ending-easter-candidate-valid-fictional");
  easterCandidateWithPath.savePath = "/tmp/forbidden";
  assertContractInvalid("extreme-ending-easter-candidate-v1", easterCandidateWithPath, "Easter candidate cannot carry a path");

  const easterConfirmationStageOverflow = cloneSample("extreme-ending-easter-confirmation-valid-second");
  easterConfirmationStageOverflow.stage = 4;
  assertContractInvalid("extreme-ending-easter-confirmation-v1", easterConfirmationStageOverflow, "Easter confirmation cannot exceed stage three");

  const easterReceiptWrongChance = cloneSample("extreme-ending-easter-receipt-valid-grey-crow");
  easterReceiptWrongChance.chanceBasisPoints = 500;
  assertContractInvalid("extreme-ending-easter-receipt-v1", easterReceiptWrongChance, "Easter receipt must lock the confirmed 44.4 percent policy");

  const easterReceiptWrongOutcome = cloneSample("extreme-ending-easter-receipt-valid-grey-crow");
  easterReceiptWrongOutcome.outcome = "standard_extreme_ending";
  assertContractInvalid("extreme-ending-easter-receipt-v1", easterReceiptWrongOutcome, "Easter receipt outcome must match its one-shot draw");

  const easterLedgerWrongSkill = cloneSample("extreme-ending-easter-ledger-valid-first-confirmation-pending");
  easterLedgerWrongSkill.candidate.skillIdentityHash = "9".repeat(64);
  assertContractInvalid("extreme-ending-easter-ledger-v1", easterLedgerWrongSkill, "Easter candidate must bind the locked built-in Skill identity");

  const easterTerminalWithoutProof = cloneSample("extreme-ending-easter-ledger-valid-first-confirmation-pending");
  easterTerminalWithoutProof.phase = "terminal_committed";
  assertContractInvalid("extreme-ending-easter-ledger-v1", easterTerminalWithoutProof, "Easter terminal phase requires all three confirmations and one receipt");

  const easterProjectionEarlyDiscovery = cloneSample("extreme-ending-easter-projection-valid-confirming");
  easterProjectionEarlyDiscovery.easterDiscovered = true;
  assertContractInvalid("extreme-ending-easter-projection-v1", easterProjectionEarlyDiscovery, "Easter discovery cannot leak before terminal commit");

  const easterProjectionContinuation = cloneSample("extreme-ending-easter-projection-boundary-idle");
  easterProjectionContinuation.actions.continueAsChild = true;
  assertContractInvalid("extreme-ending-easter-projection-v1", easterProjectionContinuation, "Easter projection can never expose continuation");

  const selfLineage = cloneSample("adventure-lineage-valid-continuation");
  selfLineage.childAdventureId = selfLineage.parentAdventureId;
  assertContractInvalid("adventure-lineage-v1", selfLineage, "continuation lineage cannot point to itself");
}

function runDiscriminatorChecks() {
  const v2 = detectContractVersion(cloneSample("adventure-valid-active"));
  assert.equal(v2.kind, "v2");
  assert.equal(v2.contract_id, "adventure-save-v2");

  const v1 = detectContractVersion({ schemaVersion: "grey-crow-extension-pack-v1" });
  assert.equal(v1.kind, "v1");

  const registeredV1 = detectContractVersion(cloneSample("skill-module-definition-valid-memory-fragments"));
  assert.equal(registeredV1.kind, "v1");
  assert.equal(registeredV1.contract_id, "skill-module-definition-v1");

  const finaleV1 = detectContractVersion(cloneSample("story-finale-candidate-valid"));
  assert.equal(finaleV1.kind, "v1");
  assert.equal(finaleV1.contract_id, "story-finale-candidate-v1");

  const easterV1 = detectContractVersion(cloneSample("extreme-ending-easter-receipt-valid-grey-crow"));
  assert.equal(easterV1.kind, "v1");
  assert.equal(easterV1.contract_id, "extreme-ending-easter-receipt-v1");

  const unknown = detectContractVersion({ schemaVersion: "not-registered" });
  assert.equal(unknown.kind, "unknown");

  assert.throws(
    () => validateContract("not-registered", {}),
    (error) => error?.code === ERROR_CODES.CONTRACT_UNKNOWN_SCHEMA
  );
}

function assertContractInvalid(contractId, value, label) {
  let captured;
  try {
    validateContract(contractId, value);
  } catch (error) {
    captured = error;
  }
  assert.equal(captured?.code, ERROR_CODES.CONTRACT_INVALID, `${label} should return CONTRACT_INVALID`);
  const serialized = JSON.stringify(captured?.toJSON?.() || captured || {});
  assert.equal(serialized.includes(process.cwd()), false, `${label} must not expose cwd`);
  assert.equal(serialized.includes(path.sep + "Users" + path.sep), false, `${label} must not expose absolute paths`);
  assert.equal(serialized.includes("rawProviderBody"), false, `${label} must not expose rejected values`);
}

function cloneSample(name) {
  const sample = samples.cases.find((item) => item.name === name);
  assert.ok(sample, `missing static sample ${name}`);
  return JSON.parse(JSON.stringify(sample.value));
}

if (require.main === module) {
  runContractChecks()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  runContractChecks,
};
