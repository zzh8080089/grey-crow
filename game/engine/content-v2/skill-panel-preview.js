"use strict";

// Creator-only projection over explicitly supplied data, with no filesystem
// reader, writable state store or character-gameplay adapter.
const { validateContract } = require("../contracts/v2");
const { applySkillModulePresentation } = require("./skill-locale-resolver");
const SKILL_PANEL_PRESENTATION_V2_FEATURE = "skill-panel-presentation-v2";

function createSkillPanelPreviewService(options = {}) {
  if (typeof options.snapshotLoader !== "function" || typeof options.stateStore?.read !== "function"
    || typeof options.moduleProjection?.getCurrentSkillModule !== "function") {
    throw projectionError("SKILL_PANEL_SOURCE_UNSUPPORTED", "Creator preview requires explicit in-memory sources.");
  }
  const adventureId = "creator-preview";
  const snapshotLoader = options.snapshotLoader;
  const stateStore = options.stateStore;
  const moduleProjection = options.moduleProjection;
  const localeResolver = optionalLocaleResolver(options.localeResolver);
  const characterPanelProjection = null;

  async function listCurrentSkillPanels() {
    const snapshot = await loadSnapshot(snapshotLoader);
    if (!supportsSkillPanelV2(snapshot)) return unsupportedList();
    const resolvedLocale = await loadResolvedLocale(localeResolver, adventureId);
    const panels = [];
    for (const lockedPanel of snapshot.content.skillPanelsV2.panels) {
      if (lockedPanel.sourceKind !== "ordinary_skill") continue;
      const panel = localizePanel(lockedPanel, resolvedLocale);
      if (panel.ordinarySource.hasModule && panel.ordinarySource.visibility === "hidden_until_active") {
        const state = await stateStore.read(panel.ordinarySource.moduleRef);
        if (state.activated !== true) continue;
      }
      panels.push(panel);
    }
    panels.sort((left, right) =>
      left.sortOrder - right.sortOrder || left.panelRef.localeCompare(right.panelRef));
    validateContract("skill-panel-presentation-v2", {
      schemaVersion: "grey-crow-skill-panel-presentation-v2",
      panels,
    });
    return deepFreeze({
      supported: true,
      schemaVersion: "grey-crow-skill-panel-presentation-v2",
      panels,
    });
  }

  async function getCurrentCharacterPanelEntry() {
    const snapshot = await loadSnapshot(snapshotLoader);
    if (!supportsSkillPanelV2(snapshot)) {
      return deepFreeze({ supported: false, panel: null });
    }
    if (!characterPanelProjection) {
      return deepFreeze({ supported: true, panel: null });
    }
    const matchingPanels = snapshot.content.skillPanelsV2.panels
      .filter((entry) => characterPanelProjection.supportsPanel(entry));
    if (matchingPanels.length === 0) {
      return deepFreeze({ supported: true, panel: null });
    }
    if (matchingPanels.length !== 1) {
      throw projectionError(
        "SKILL_PANEL_CHARACTER_DESCRIPTOR_INVALID",
        "Adventure contains an ambiguous Character panel descriptor."
      );
    }
    const panel = cloneJson(matchingPanels[0]);
    validateContract("skill-panel-presentation-v2", {
      schemaVersion: "grey-crow-skill-panel-presentation-v2",
      panels: [panel],
    });
    return deepFreeze({ supported: true, panel });
  }

  async function getCurrentSkillPanel(input = {}) {
    assertOnlyKeys(input, ["panelRef", "view", "fieldId", "itemRef", "cursor", "limit"]);
    const snapshot = await loadSnapshot(snapshotLoader);
    if (!supportsSkillPanelV2(snapshot)) {
      return deepFreeze({ supported: false, panel: null });
    }
    const panelRef = requirePanelRef(input.panelRef);
    const lockedPanel = snapshot.content.skillPanelsV2.panels
      .find((entry) => entry.panelRef === panelRef);
    if (!lockedPanel) {
      throw projectionError("SKILL_PANEL_NOT_SELECTED", "Skill panel is not selected in this Adventure.");
    }
    if (lockedPanel.sourceKind !== "ordinary_skill") {
      if (characterPanelProjection?.supportsPanel(lockedPanel)) {
        const projection = await characterPanelProjection.getPanel(lockedPanel, input);
        return deepFreeze({ supported: true, panel: validateViewProjection(projection) });
      }
      throw projectionError(
        "SKILL_PANEL_SOURCE_UNSUPPORTED",
        "This panel source is reserved for a later adapter."
      );
    }
    const resolvedLocale = await loadResolvedLocale(localeResolver, adventureId);
    const panel = localizePanel(lockedPanel, resolvedLocale);
    const view = normalizeView(input.view);
    if (!panel.ordinarySource.hasModule) {
      if (view !== "overview") {
        throw projectionError(
          "SKILL_PANEL_VIEW_INVALID",
          "Stateless Skill panels only expose an overview."
        );
      }
      return deepFreeze({
        supported: true,
        panel: validateViewProjection(emptyOverview(panel)),
      });
    }
    const module = requireModule(snapshot, panel.ordinarySource.moduleRef);
    const definition = localizedDefinition(module.definition, panel, resolvedLocale);
    const state = await stateStore.read(module.moduleRef);
    if (panel.ordinarySource.visibility === "hidden_until_active" && state.activated !== true) {
      throw projectionError("SKILL_PANEL_FORBIDDEN", "Hidden Skill panel is not active.");
    }

    let projection;
    if (view === "overview") {
      assertAbsentDetailInput(input);
      const legacy = await moduleProjection.getCurrentSkillModule({ moduleRef: module.moduleRef });
      projection = projectOverview(panel, definition, legacy);
    } else if (view === "list") {
      const fieldId = requireFieldId(input.fieldId);
      const field = requireRecordField(definition, fieldId);
      if (input.itemRef !== undefined && input.itemRef !== null && input.itemRef !== "") {
        throw projectionError("SKILL_PANEL_VIEW_INVALID", "List view does not accept an item reference.");
      }
      const legacy = await moduleProjection.getCurrentSkillModule({
        moduleRef: module.moduleRef,
        fieldId,
        cursor: input.cursor,
        limit: input.limit,
      });
      projection = projectList(panel, field, legacy);
    } else {
      const fieldId = requireFieldId(input.fieldId);
      const field = requireRecordField(definition, fieldId);
      if (input.cursor !== undefined || input.limit !== undefined) {
        throw projectionError("SKILL_PANEL_VIEW_INVALID", "Detail view does not accept pagination.");
      }
      const itemRef = requireItemRef(input.itemRef);
      const record = state.values[fieldId].find((entry) => entry.entry_id === itemRef);
      if (!record) {
        throw projectionError("SKILL_PANEL_ITEM_NOT_FOUND", "Skill panel record was not found.");
      }
      projection = projectDetail(panel, field, record);
    }
    return deepFreeze({ supported: true, panel: validateViewProjection(projection) });
  }

  return Object.freeze({
    listCurrentSkillPanels,
    getCurrentCharacterPanelEntry,
    getCurrentSkillPanel,
  });
}

function supportsSkillPanelV2(snapshot) {
  return (snapshot.profile?.features || []).includes(SKILL_PANEL_PRESENTATION_V2_FEATURE)
    && (snapshot.lock?.features || []).includes(SKILL_PANEL_PRESENTATION_V2_FEATURE)
    && snapshot.content?.skillPanelsV2?.schemaVersion === "grey-crow-skill-panel-presentation-v2"
    && Array.isArray(snapshot.content.skillPanelsV2.panels);
}

function localizePanel(lockedPanel, resolvedLocale) {
  const panel = cloneJson(lockedPanel);
  const source = panel.ordinarySource;
  const localized = (resolvedLocale?.skillPanels?.panels || [])
    .find((entry) => entry.packId === source.packId && entry.itemId === source.itemId);
  if (!localized) return panel;
  return {
    ...panel,
    title: localized.title,
    language: localized.language,
    description: localized.description,
    triggers: [...localized.triggers],
    playerGuide: localized.playerGuide,
  };
}

function localizedDefinition(definition, panel, resolvedLocale) {
  const source = panel.ordinarySource;
  const localized = (resolvedLocale?.skills || [])
    .find((entry) => entry.packId === source.packId && entry.itemId === source.itemId);
  return applySkillModulePresentation(definition, localized?.modulePresentation || null);
}

function requireModule(snapshot, moduleRef) {
  const skill = (snapshot.content?.skills || [])
    .find((entry) => entry.module?.moduleRef === moduleRef);
  if (!skill?.module?.definition) {
    throw projectionError("SKILL_PANEL_DEFINITION_MISSING", "Locked Skill module definition is missing.");
  }
  return skill.module;
}

function projectOverview(panel, definition, legacy) {
  const fieldsById = new Map(definition.fields.map((field) => [field.id, field]));
  return baseProjection(panel, {
    view: "overview",
    status: "ready",
    summary: legacy.summary.slice(0, 3).map((entry) => ({
      id: entry.fieldId,
      label: fieldsById.get(entry.fieldId)?.label || entry.fieldId,
      text: entry.text,
    })),
    fields: legacy.fields.map((field) =>
      projectOverviewField(fieldsById.get(field.id), field)),
  });
}

function projectOverviewField(definition, legacy) {
  if (!definition) {
    throw projectionError("SKILL_PANEL_PROJECTION_INVALID", "Skill panel field definition is missing.");
  }
  if (definition.type === "record_list") {
    const count = legacy.derivedSummary?.count || 0;
    const target = legacy.derivedSummary?.target || definition.maxItems;
    return displayField(definition.id, definition.label, "progress", count, 0, target);
  }
  if (definition.type === "integer" || definition.type === "number") {
    const kind = ["progress", "meter"].includes(definition.display.widget) ? "progress" : "number";
    return displayField(
      definition.id,
      definition.label,
      kind,
      legacy.value,
      definition.minimum,
      definition.maximum
    );
  }
  if (definition.type === "boolean") {
    return displayField(definition.id, definition.label, "boolean", legacy.value);
  }
  if (definition.type === "enum") {
    const selected = definition.options.find((option) => option.value === legacy.value);
    return displayField(definition.id, definition.label, "badge", selected?.label || String(legacy.value));
  }
  if (definition.type === "string_list") {
    return displayField(definition.id, definition.label, "chips", legacy.value);
  }
  return displayField(definition.id, definition.label, "text", legacy.value);
}

function projectList(panel, field, legacy) {
  const projected = legacy.fields.find((entry) => entry.id === field.id);
  if (!projected || !Array.isArray(projected.value) || !legacy.pagination) {
    throw projectionError("SKILL_PANEL_PROJECTION_INVALID", "Skill panel list projection is invalid.");
  }
  return baseProjection(panel, {
    view: "list",
    status: projected.value.length > 0 ? "ready" : "empty",
    items: projected.value.map((record) => projectListItem(field, record)),
    pagination: {
      nextCursor: legacy.pagination.nextCursor,
      hasMore: legacy.pagination.hasMore,
      returnedItems: legacy.pagination.returnedItems,
      totalItems: legacy.pagination.totalItems,
    },
  });
}

function projectListItem(field, record) {
  const [titleField, ...rest] = field.itemFields;
  const title = shortText(formatItemValue(titleField, record[titleField.id]), "记录");
  const subtitleParts = rest
    .map((itemField) => `${itemField.label}：${formatItemValue(itemField, record[itemField.id])}`)
    .filter(Boolean);
  return {
    ref: record.entry_id,
    title,
    subtitle: subtitleParts.length > 0 ? shortText(subtitleParts.join(" · "), null) : null,
    statusLabel: null,
    updatedTurn: Number.isInteger(record.created_turn) ? record.created_turn : null,
  };
}

function projectDetail(panel, field, record) {
  const titleField = field.itemFields[0];
  const title = shortText(formatItemValue(titleField, record[titleField.id]), "记录");
  return baseProjection(panel, {
    view: "detail",
    status: "ready",
    detail: {
      ref: record.entry_id,
      title,
      subtitle: shortText(field.label, null),
      sections: [{
        id: field.id,
        title: field.label,
        fields: field.itemFields.map((itemField) =>
          projectRecordField(itemField, record[itemField.id])),
        records: [],
      }],
    },
  });
}

function projectRecordField(field, value) {
  if (field.type === "integer" || field.type === "number") {
    return displayField(field.id, field.label, "number", value, field.minimum, field.maximum);
  }
  if (field.type === "boolean") {
    return displayField(field.id, field.label, "boolean", value);
  }
  if (field.type === "enum") {
    const selected = field.options.find((option) => option.value === value);
    return displayField(field.id, field.label, "badge", selected?.label || String(value));
  }
  return displayField(field.id, field.label, "text", value);
}

function displayField(id, label, kind, value, minimum = null, maximum = null) {
  return { id, label, kind, value: cloneJson(value), minimum, maximum };
}

function baseProjection(panel, overrides) {
  return {
    schemaVersion: "grey-crow-skill-panel-view-projection-v1",
    panelRef: panel.panelRef,
    sourceKind: panel.sourceKind,
    ownership: panel.ownership,
    group: panel.group,
    surface: panel.surface,
    view: overrides.view,
    title: panel.title,
    status: overrides.status,
    summary: overrides.summary || [],
    fields: overrides.fields || [],
    items: overrides.items || [],
    detail: overrides.detail || null,
    pagination: overrides.pagination || null,
  };
}

function emptyOverview(panel) {
  return baseProjection(panel, {
    view: "overview",
    status: "empty",
  });
}

function requireRecordField(definition, fieldId) {
  const field = definition.fields.find((entry) => entry.id === fieldId);
  if (!field) {
    throw projectionError("SKILL_PANEL_FIELD_UNKNOWN", "Skill panel field is not defined.");
  }
  if (field.type !== "record_list") {
    throw projectionError("SKILL_PANEL_VIEW_INVALID", "Only record fields expose list and detail views.");
  }
  return field;
}

function formatItemValue(field, value) {
  if (field.type === "enum") {
    return field.options.find((option) => option.value === value)?.label || String(value);
  }
  if (field.type === "boolean") return value ? "是" : "否";
  return String(value ?? "");
}

function shortText(value, fallback) {
  const normalized = String(value || "").trim().slice(0, 240);
  return normalized || fallback;
}

function validateViewProjection(value) {
  try {
    validateContract("skill-panel-view-projection-v1", value);
  } catch {
    throw projectionError("SKILL_PANEL_PROJECTION_INVALID", "Safe Skill panel projection is invalid.");
  }
  return deepFreeze(value);
}

function unsupportedList() {
  return deepFreeze({ supported: false, schemaVersion: null, panels: [] });
}

function normalizeView(value) {
  const normalized = String(value || "overview").trim();
  if (!["overview", "list", "detail"].includes(normalized)) {
    throw projectionError("SKILL_PANEL_VIEW_INVALID", "Skill panel view is invalid.");
  }
  return normalized;
}

function requirePanelRef(value) {
  const normalized = String(value || "").trim();
  if (!/^panel_[a-f0-9]{32}$/.test(normalized)) {
    throw projectionError("SKILL_PANEL_NOT_SELECTED", "Skill panel reference is invalid.");
  }
  return normalized;
}

function requireFieldId(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) {
    throw projectionError("SKILL_PANEL_FIELD_UNKNOWN", "Skill panel field identifier is invalid.");
  }
  return normalized;
}

function requireItemRef(value) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(normalized)) {
    throw projectionError("SKILL_PANEL_ITEM_NOT_FOUND", "Skill panel item reference is invalid.");
  }
  return normalized;
}

function assertAbsentDetailInput(input) {
  if (input.fieldId !== undefined || input.itemRef !== undefined
    || input.cursor !== undefined || input.limit !== undefined) {
    throw projectionError("SKILL_PANEL_VIEW_INVALID", "Overview does not accept list or detail inputs.");
  }
}

function assertOnlyKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw projectionError("SKILL_PANEL_REQUEST_INVALID", "Skill panel projection request is invalid.");
  }
}

function optionalLocaleResolver(value) {
  if (value === undefined || value === null) return null;
  if (typeof value?.resolveCurrent !== "function") {
    throw projectionError("SKILL_PANEL_LOCALE_RESOLVER_INVALID", "localeResolver.resolveCurrent is required.");
  }
  return value;
}

async function loadResolvedLocale(localeResolver, adventureId) {
  return localeResolver ? localeResolver.resolveCurrent({ adventureId }) : null;
}

async function loadSnapshot(loader) {
  try {
    return await loader();
  } catch (error) {
    if (error?.code) throw error;
    throw projectionError("SKILL_PANEL_SNAPSHOT_INVALID", "Locked Skill panel snapshot could not be read.");
  }
}

function projectionError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

module.exports = { createSkillPanelPreviewService };
