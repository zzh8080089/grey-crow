"use strict";

const assert = require("node:assert/strict");
const { ERROR_CODES } = require("../../../../engine/providers/provider-contracts");
const {
  validateContract,
  detectContractVersion,
} = require("../../../../engine/contracts/v2");
const staticSamples = require("../../../../engine/contracts/v2/fixtures/static-contract-samples.v2.json");
const {
  createPanelPresentationV2Fixture,
  createPlayerStatelessPanelPresentationFixture,
  createOrdinaryPanelViewFixture,
  createCharacterPanelViewFixture,
  createPlayerStatelessPanelViewFixture,
} = require("../../../../engine/contracts/v2/fixtures/generic-skill-panel-contract-samples");

const PROHIBITED_PROJECTION_KEYS = new Set([
  "path",
  "grant",
  "permission",
  "operation",
  "url",
  "html",
  "script",
]);

function run() {
  const presentationV2 = createPanelPresentationV2Fixture();
  const ordinaryView = createOrdinaryPanelViewFixture();
  const characterList = createCharacterPanelViewFixture();
  const playerPresentation = createPlayerStatelessPanelPresentationFixture();
  const playerView = createPlayerStatelessPanelViewFixture();
  const presentationV1 = clone(
    staticSamples.cases.find((sample) => sample.name === "skill-panel-presentation-valid")?.value
  );

  assert.ok(presentationV1, "the sealed v1 panel fixture must remain available");
  assertValid("skill-panel-presentation-v2", presentationV2);
  assertValid("skill-panel-presentation-v2", playerPresentation);
  assertValid("skill-panel-view-projection-v1", ordinaryView);
  assertValid("skill-panel-view-projection-v1", characterList);
  assertValid("skill-panel-view-projection-v1", playerView);

  const serializedPlayerPresentation = JSON.stringify(playerPresentation);
  const reopenedPlayerPresentation = clone(playerPresentation);
  assertValid("skill-panel-presentation-v2", reopenedPlayerPresentation);
  assert.equal(
    JSON.stringify(reopenedPlayerPresentation),
    serializedPlayerPresentation,
    "player-owned no-op open/save fixture must preserve identity and bytes"
  );

  const serializedV1 = JSON.stringify(presentationV1);
  assertValid("skill-panel-presentation-v1", presentationV1);
  assert.equal(JSON.stringify(presentationV1), serializedV1, "v1 validation must not mutate the sealed payload");
  assertInvalid("skill-panel-presentation-v1", presentationV2, "v1 must reject v2 payloads");
  assertInvalid("skill-panel-presentation-v2", presentationV1, "v2 must reject v1 payloads");

  const playerDomain = clone(presentationV2);
  playerDomain.panels[1].ownership = "player_owned";
  playerDomain.panels[1].group = "player_extensions";
  assertInvalid("skill-panel-presentation-v2", playerDomain, "player-owned built-in domain spoof");

  const playerStoryGroup = clone(presentationV2);
  playerStoryGroup.panels[0].ownership = "player_owned";
  playerStoryGroup.panels[0].group = "story_records";
  assertInvalid("skill-panel-presentation-v2", playerStoryGroup, "player-owned reserved group");

  const fakeOrdinaryDomain = clone(presentationV2);
  fakeOrdinaryDomain.panels[1].ordinarySource = clone(presentationV2.panels[0].ordinarySource);
  assertInvalid("skill-panel-presentation-v2", fakeOrdinaryDomain, "built-in domain fake ordinary source");

  const duplicatePanel = clone(presentationV2);
  duplicatePanel.panels[1].panelRef = duplicatePanel.panels[0].panelRef;
  assertInvalid("skill-panel-presentation-v2", duplicatePanel, "duplicate panel ref");

  const customSurface = clone(presentationV2);
  customSurface.panels[0].surface = "custom_renderer";
  assertInvalid("skill-panel-presentation-v2", customSurface, "custom renderer surface");

  const customGroup = clone(presentationV2);
  customGroup.panels[0].group = "custom_group";
  assertInvalid("skill-panel-presentation-v2", customGroup, "free-form group");

  for (const key of PROHIBITED_PROJECTION_KEYS) {
    const injectedPanel = clone(presentationV2);
    injectedPanel.panels[0][key] = "must-not-pass";
    assertInvalid("skill-panel-presentation-v2", injectedPanel, `presentation key ${key}`);

    const injectedView = clone(ordinaryView);
    injectedView[key] = "must-not-pass";
    assertInvalid("skill-panel-view-projection-v1", injectedView, `view key ${key}`);
  }

  const badViewOwnership = clone(ordinaryView);
  badViewOwnership.ownership = "player_owned";
  badViewOwnership.group = "story_records";
  assertInvalid("skill-panel-view-projection-v1", badViewOwnership, "player-owned view reserved group");

  const badCursor = clone(characterList);
  badCursor.pagination.hasMore = false;
  assertInvalid("skill-panel-view-projection-v1", badCursor, "pagination cursor mismatch");

  const duplicateItem = clone(characterList);
  duplicateItem.items[1].ref = duplicateItem.items[0].ref;
  assertInvalid("skill-panel-view-projection-v1", duplicateItem, "duplicate list item ref");

  const listWithDetail = clone(characterList);
  listWithDetail.detail = createCharacterDetail();
  assertInvalid("skill-panel-view-projection-v1", listWithDetail, "list view carrying detail");

  const overviewWithItems = clone(ordinaryView);
  overviewWithItems.items = clone(characterList.items);
  assertInvalid("skill-panel-view-projection-v1", overviewWithItems, "overview carrying list items");

  const wrongReturnedCount = clone(characterList);
  wrongReturnedCount.pagination.returnedItems = 1;
  assertInvalid("skill-panel-view-projection-v1", wrongReturnedCount, "list pagination count mismatch");

  const overlongList = clone(characterList);
  overlongList.items = Array.from({ length: 25 }, (_, index) => ({
    ref: `character_boundary_${String(index).padStart(2, "0")}`,
    title: `Character ${index}`,
    subtitle: null,
    statusLabel: null,
    updatedTurn: null,
  }));
  overlongList.pagination = null;
  assertInvalid("skill-panel-view-projection-v1", overlongList, "list item limit");

  const validDetail = clone(characterList);
  validDetail.view = "detail";
  validDetail.items = [];
  validDetail.detail = createCharacterDetail();
  validDetail.pagination = null;
  assertValid("skill-panel-view-projection-v1", validDetail);

  assert.deepEqual(findProhibitedKeys(presentationV2), [], "presentation must expose display metadata only");
  assert.deepEqual(findProhibitedKeys(playerPresentation), [], "player presentation must expose display metadata only");
  assert.deepEqual(findProhibitedKeys(ordinaryView), [], "ordinary view must expose projection data only");
  assert.deepEqual(findProhibitedKeys(characterList), [], "domain view must expose projection data only");
  assert.deepEqual(findProhibitedKeys(playerView), [], "player view must expose projection data only");
  assert.deepEqual(findProhibitedKeys(validDetail), [], "detail view must expose projection data only");

  const detectedPresentation = detectContractVersion(presentationV2);
  assert.equal(detectedPresentation.kind, "v2");
  assert.equal(detectedPresentation.contract_id, "skill-panel-presentation-v2");
  const detectedView = detectContractVersion(ordinaryView);
  assert.equal(detectedView.kind, "v1");
  assert.equal(detectedView.contract_id, "skill-panel-view-projection-v1");

  process.stdout.write(`${JSON.stringify({
    name: "p2-29-a-generic-skill-panel-contract",
    ok: true,
    valid_shapes: 6,
    compatibility_checks: 4,
    rejected_shapes: 29,
  }, null, 2)}\n`);
}

function createCharacterDetail() {
  return {
    ref: "character_zhou",
    title: "周岚",
    subtitle: "在雪地哨站遇见的医生",
    sections: [
      {
        id: "identity",
        title: "身份",
        fields: [
          {
            id: "relationship",
            label: "关系",
            kind: "badge",
            value: "可信",
            minimum: null,
            maximum: null,
          },
        ],
        records: [],
      },
      {
        id: "encounters",
        title: "相遇记录",
        fields: [],
        records: [
          {
            id: "encounter_018",
            label: "雪地哨站",
            text: "她为玩家处理了伤口。",
            turn: 18,
          },
        ],
      },
    ],
  };
}

function assertValid(contractId, value) {
  assert.equal(validateContract(contractId, value).ok, true, `${contractId} should validate`);
}

function assertInvalid(contractId, value, label) {
  assert.throws(
    () => validateContract(contractId, value),
    (error) => error?.code === ERROR_CODES.CONTRACT_INVALID,
    `${label} should return CONTRACT_INVALID`
  );
}

function findProhibitedKeys(value, currentPath = "$", matches = []) {
  if (!value || typeof value !== "object") {
    return matches;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findProhibitedKeys(item, `${currentPath}[${index}]`, matches));
    return matches;
  }
  for (const [key, item] of Object.entries(value)) {
    if (PROHIBITED_PROJECTION_KEYS.has(key.toLowerCase())) {
      matches.push(`${currentPath}.${key}`);
    }
    findProhibitedKeys(item, `${currentPath}.${key}`, matches);
  }
  return matches;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
};
