"use strict";

function createGenericSkillPanelContractSamples() {
  const presentation = createPanelPresentationV2Fixture();
  const invalidPresentation = clone(presentation);
  invalidPresentation.panels[1].ownership = "player_owned";
  invalidPresentation.panels[1].group = "player_extensions";

  const view = createOrdinaryPanelViewFixture();
  const invalidView = clone(view);
  invalidView.ownership = "player_owned";
  invalidView.group = "story_records";

  return [
    contractCase(
      "skill-panel-presentation-v2-valid-mixed-sources",
      "skill-panel-presentation-v2",
      "valid",
      true,
      presentation
    ),
    contractCase(
      "skill-panel-presentation-v2-invalid-player-domain",
      "skill-panel-presentation-v2",
      "invalid",
      false,
      invalidPresentation
    ),
    contractCase(
      "skill-panel-presentation-v2-boundary-player-stateless",
      "skill-panel-presentation-v2",
      "boundary",
      true,
      createPlayerStatelessPanelPresentationFixture()
    ),
    contractCase(
      "skill-panel-view-projection-v1-valid-ordinary-progress",
      "skill-panel-view-projection-v1",
      "valid",
      true,
      view
    ),
    contractCase(
      "skill-panel-view-projection-v1-invalid-player-group",
      "skill-panel-view-projection-v1",
      "invalid",
      false,
      invalidView
    ),
    contractCase(
      "skill-panel-view-projection-v1-boundary-character-list",
      "skill-panel-view-projection-v1",
      "boundary",
      true,
      createCharacterPanelViewFixture()
    ),
  ];
}

function createPanelPresentationV2Fixture() {
  return {
    schemaVersion: "grey-crow-skill-panel-presentation-v2",
    panels: [
      {
        panelRef: "panel_builtin_survival",
        sourceKind: "ordinary_skill",
        ownership: "built_in",
        group: "adventure_gameplay",
        sortOrder: 100,
        title: "生存状态",
        language: "zh-CN",
        description: "展示由通用 Skill 模块维护的玩家生存状态。",
        triggers: ["状态", "伤势", "补给"],
        playerGuide: "打开面板查看当前状态；写入仍由既有 Skill 工具负责。",
        surface: "progress",
        ordinarySource: {
          packId: "grey-crow-core",
          itemId: "survival-status",
          hasModule: true,
          moduleRef: "module_survival_status",
          visibility: "visible",
        },
        domainSource: null,
      },
      {
        panelRef: "panel_builtin_characters",
        sourceKind: "built_in_domain",
        ownership: "built_in",
        group: "story_records",
        sortOrder: 200,
        title: "角色记录",
        language: "zh-CN",
        description: "查看运行时维护的角色卡索引与只读详情投影。",
        triggers: ["角色", "人物", "名字"],
        playerGuide: "先浏览角色列表，再按稳定引用打开角色详情。",
        surface: "list_detail",
        ordinarySource: null,
        domainSource: {
          skillId: "characters",
          capability: "character_cards",
          defaultView: "recent",
        },
      },
    ],
  };
}

function createPlayerStatelessPanelPresentationFixture() {
  return {
    schemaVersion: "grey-crow-skill-panel-presentation-v2",
    panels: [
      {
        panelRef: "panel_player_weather_guide",
        sourceKind: "ordinary_skill",
        ownership: "player_owned",
        group: "player_extensions",
        sortOrder: 100000,
        title: "荒野天气指南",
        language: "zh-CN",
        description: "玩家自制的无状态通用 Skill，只展示使用说明。",
        triggers: [],
        playerGuide: null,
        surface: "guide",
        ordinarySource: {
          packId: "player-weather-pack",
          itemId: "weather-guide",
          hasModule: false,
          moduleRef: null,
          visibility: null,
        },
        domainSource: null,
      },
    ],
  };
}

function createOrdinaryPanelViewFixture() {
  return {
    schemaVersion: "grey-crow-skill-panel-view-projection-v1",
    panelRef: "panel_builtin_survival",
    sourceKind: "ordinary_skill",
    ownership: "built_in",
    group: "adventure_gameplay",
    surface: "progress",
    view: "overview",
    title: "生存状态",
    status: "ready",
    summary: [
      { id: "health_summary", label: "生命", text: "72 / 100" },
      { id: "condition_summary", label: "状态", text: "轻伤" },
    ],
    fields: [
      {
        id: "health",
        label: "生命",
        kind: "progress",
        value: 72,
        minimum: 0,
        maximum: 100,
      },
      {
        id: "condition",
        label: "状态",
        kind: "badge",
        value: "轻伤",
        minimum: null,
        maximum: null,
      },
    ],
    items: [],
    detail: null,
    pagination: null,
  };
}

function createCharacterPanelViewFixture() {
  return {
    schemaVersion: "grey-crow-skill-panel-view-projection-v1",
    panelRef: "panel_builtin_characters",
    sourceKind: "built_in_domain",
    ownership: "built_in",
    group: "story_records",
    surface: "list_detail",
    view: "list",
    title: "角色记录",
    status: "ready",
    summary: [
      { id: "known_characters", label: "已记录", text: "3" },
    ],
    fields: [],
    items: [
      {
        ref: "character_zhou",
        title: "周岚",
        subtitle: "在雪地哨站遇见的医生",
        statusLabel: "可信",
        updatedTurn: 18,
      },
      {
        ref: "character_mika",
        title: "ミカ",
        subtitle: "地下通路で出会った整備士",
        statusLabel: null,
        updatedTurn: 21,
      },
    ],
    detail: null,
    pagination: {
      nextCursor: "cursor_characters_002",
      hasMore: true,
      returnedItems: 2,
      totalItems: 3,
    },
  };
}

function createPlayerStatelessPanelViewFixture() {
  return {
    schemaVersion: "grey-crow-skill-panel-view-projection-v1",
    panelRef: "panel_player_weather_guide",
    sourceKind: "ordinary_skill",
    ownership: "player_owned",
    group: "player_extensions",
    surface: "guide",
    view: "overview",
    title: "荒野天气指南",
    status: "empty",
    summary: [],
    fields: [],
    items: [],
    detail: null,
    pagination: null,
  };
}

function contractCase(name, contractId, variant, expectValid, value) {
  return { name, contractId, variant, expectValid, value: clone(value) };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  createGenericSkillPanelContractSamples,
  createPanelPresentationV2Fixture,
  createPlayerStatelessPanelPresentationFixture,
  createOrdinaryPanelViewFixture,
  createCharacterPanelViewFixture,
  createPlayerStatelessPanelViewFixture,
};
