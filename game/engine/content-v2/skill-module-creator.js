"use strict";

const crypto = require("node:crypto");
const { validateContract } = require("../contracts/v2");

const CREATOR_DRAFT_VERSION = "grey-crow-skill-module-creator-draft-v1";
const CREATOR_FACADE_DRAFT_VERSION = "grey-crow-skill-module-creator-draft-v2";
const DEFINITION_VERSION = "grey-crow-skill-module-definition-v1";
const SKILL_IO_VERSION = "grey-crow-skill-io-companion-v1";
const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_TYPES = new Set(["integer", "number", "text", "boolean", "enum", "string_list", "record_list"]);
const ITEM_FIELD_TYPES = new Set(["integer", "number", "text", "boolean", "enum"]);
const RESERVED_RECORD_FIELDS = new Set(["entry_id", "created_turn", "created_at"]);
const READ_VIEW_IDS = new Set(["overview", "recent", "lookup"]);
const ACTION_BEHAVIORS = new Set(["set_value", "adjust_number", "append_record", "change_list_item", "choose_enum"]);
const ACTION_BEHAVIORS_BY_TYPE = Object.freeze({
  integer: new Set(["set_value", "adjust_number"]),
  number: new Set(["set_value", "adjust_number"]),
  text: new Set(["set_value"]),
  boolean: new Set(["set_value"]),
  enum: new Set(["choose_enum"]),
  string_list: new Set(["change_list_item"]),
  record_list: new Set(["append_record"]),
});
const ACTION_TOOL_PREFIX = Object.freeze({
  set_value: "set_skill_value",
  adjust_number: "adjust_skill_number",
  append_record: "append_skill_record",
  change_list_item: "change_skill_list",
  choose_enum: "choose_skill_stage",
});
const ACTION_OPERATION = Object.freeze({
  set_value: "set",
  adjust_number: "set",
  append_record: "append",
  change_list_item: "set",
  choose_enum: "set",
});
const WIDGETS = Object.freeze({
  integer: new Set(["number", "progress", "meter"]),
  number: new Set(["number", "progress", "meter"]),
  text: new Set(["text", "multiline"]),
  boolean: new Set(["indicator"]),
  enum: new Set(["badge", "text"]),
  string_list: new Set(["chips", "list"]),
  record_list: new Set(["cards", "timeline", "table"]),
});
const DEFAULT_WIDGET = Object.freeze({
  integer: "progress",
  number: "meter",
  text: "text",
  boolean: "indicator",
  enum: "badge",
  string_list: "chips",
  record_list: "cards",
});

function normalizeSkillModuleCreatorDraft(value, options = {}) {
  const draft = requirePlainObject(value, "CONTENT_MODULE_DRAFT_INVALID");
  const facadeEnabled = draft.schemaVersion === CREATOR_FACADE_DRAFT_VERSION;
  assertOnlyKeys(draft, facadeEnabled
    ? ["schemaVersion", "enabled", "skillIOEnabled", "namespace", "fields"]
    : ["schemaVersion", "enabled", "fields"], "CONTENT_MODULE_DRAFT_INVALID");
  if ((!facadeEnabled && draft.schemaVersion !== CREATOR_DRAFT_VERSION) || typeof draft.enabled !== "boolean"
    || (facadeEnabled && typeof draft.skillIOEnabled !== "boolean")) {
    throw creatorError("CONTENT_MODULE_DRAFT_INVALID", "Skill module Creator draft is invalid.");
  }
  const skillIOEnabled = facadeEnabled && draft.skillIOEnabled === true;
  const namespace = skillIOEnabled ? normalizeSkillIONamespace(draft.namespace, options.identitySeed) : null;
  if (!draft.enabled) {
    if (draft.fields !== undefined && (!Array.isArray(draft.fields) || draft.fields.length > 0)) {
      throw creatorError("CONTENT_MODULE_DRAFT_INVALID", "A disabled Skill module cannot keep field definitions.");
    }
    const companion = skillIOEnabled ? compileSkillIOCompanion([], null, namespace) : null;
    const normalizedDraft = facadeEnabled
      ? { schemaVersion: CREATOR_FACADE_DRAFT_VERSION, enabled: false, skillIOEnabled, namespace, fields: [] }
      : { schemaVersion: CREATOR_DRAFT_VERSION, enabled: false, fields: [] };
    return deepFreeze({
      draft: normalizedDraft,
      definition: null,
      companion,
      previewValues: {},
      panelSurface: "guide",
    });
  }
  if (!Array.isArray(draft.fields) || draft.fields.length < 1 || draft.fields.length > 32) {
    throw creatorError("CONTENT_MODULE_FIELDS_INVALID", "An enabled Skill module requires 1 to 32 fields.");
  }

  const usedFieldIds = new Set();
  const usedActionIds = new Set();
  const normalizedFields = draft.fields.map((field, index) => normalizeField(field, index, usedFieldIds, {
    facadeEnabled,
    skillIOEnabled,
    usedActionIds,
  }));
  validateReadViewOwnership(normalizedFields);
  const definition = {
    schemaVersion: DEFINITION_VERSION,
    stateVersion: 1,
    visibility: "visible",
    summaryFields: normalizedFields.filter((field) => field.showInSummary).map((field) => field.id),
    fields: normalizedFields.map((field) => field.definition),
  };
  try {
    validateContract("skill-module-definition-v1", definition);
  } catch (error) {
    throw creatorError("CONTENT_MODULE_DEFINITION_INVALID", "Skill module fields do not form a valid v1 definition.", {
      issue: stableIssue(error),
      issues: stableIssues(error),
    });
  }
  const normalizedDraft = {
    schemaVersion: facadeEnabled ? CREATOR_FACADE_DRAFT_VERSION : CREATOR_DRAFT_VERSION,
    enabled: true,
    ...(facadeEnabled ? { skillIOEnabled, namespace } : {}),
    fields: normalizedFields.map((field) => field.draft),
  };
  const companion = skillIOEnabled ? compileSkillIOCompanion(normalizedFields, definition, namespace) : null;
  const previewValues = Object.fromEntries(normalizedFields.map((field) => [field.id, field.previewValue]));
  if (options.requireRoundTrip === true) {
    const roundTrip = createSkillModuleCreatorDraft(definition, previewValues, companion);
    if (JSON.stringify(roundTrip) !== JSON.stringify(normalizedDraft)) {
      throw creatorError("CONTENT_MODULE_DRAFT_INVALID", "Skill module Creator draft could not be normalized deterministically.");
    }
  }
  return deepFreeze({
    draft: normalizedDraft,
    definition,
    companion,
    previewValues,
    panelSurface: selectCreatorPanelSurface(definition),
  });
}

function createSkillModuleCreatorDraft(definition, previewValues = {}, companion = null) {
  if (companion) {
    assertSkillIOCompanionMatchesDefinition(companion, definition);
  }
  if (!definition) {
    return deepFreeze(companion
      ? { schemaVersion: CREATOR_FACADE_DRAFT_VERSION, enabled: false, skillIOEnabled: true, namespace: companion.namespace, fields: [] }
      : { schemaVersion: CREATOR_DRAFT_VERSION, enabled: false, fields: [] });
  }
  try {
    validateContract("skill-module-definition-v1", definition);
  } catch {
    throw creatorError("CONTENT_MODULE_VERSION_UNSUPPORTED", "This Skill module cannot be edited by the v1 Creator.");
  }
  if (definition.schemaVersion !== DEFINITION_VERSION || definition.visibility !== "visible") {
    throw creatorError("CONTENT_MODULE_VERSION_UNSUPPORTED", "This Skill module is read-only in the current Creator.");
  }
  const summaryIds = new Set(definition.summaryFields || []);
  const actionByField = new Map((companion?.actions || []).map((action) => [action.runtimeMapping.targetFieldId, action]));
  const viewsByField = new Map();
  for (const view of companion?.readViews || []) {
    if (view.id === "guide") continue;
    for (const fieldId of view.targetFieldIds) {
      if (!viewsByField.has(fieldId)) viewsByField.set(fieldId, []);
      viewsByField.get(fieldId).push(view.id);
    }
  }
  return deepFreeze({
    schemaVersion: companion ? CREATOR_FACADE_DRAFT_VERSION : CREATOR_DRAFT_VERSION,
    enabled: true,
    ...(companion ? { skillIOEnabled: true, namespace: companion.namespace } : {}),
    fields: definition.fields.map((field) => {
      const draft = definitionFieldToDraft(field, previewValues[field.id], summaryIds.has(field.id));
      if (!companion) return draft;
      const action = actionByField.get(field.id) || null;
      const { id, label, type, widget, modelWritable, showInSummary, ...details } = draft;
      return {
        id,
        label,
        type,
        widget,
        modelWritable,
        showInSummary,
        views: viewsByField.get(field.id) || [],
        hostAction: action ? { id: action.id, label: action.label, behavior: action.archetype } : null,
        ...details,
      };
    }),
  });
}

function normalizeField(value, index, usedIds, context = {}) {
  const field = requirePlainObject(value, "CONTENT_MODULE_FIELD_INVALID");
  assertOnlyKeys(field, [
    "id", "label", "type", "widget", "modelWritable", "showInSummary", "minimum", "maximum",
    "maxLength", "maxItems", "itemMaxLength", "default", "preview", "options", "defaultOptionIndex",
    "previewOptionIndex", "collectionMode", "itemFields", "previewRecordEnabled", "summaryMode",
    "summaryTarget", "milestones", "groupCountItemIndex",
    ...(context.facadeEnabled ? ["views", "hostAction"] : []),
  ], "CONTENT_MODULE_FIELD_INVALID");
  const label = normalizeLabel(field.label, "CONTENT_MODULE_FIELD_INVALID");
  const type = requireEnum(field.type, FIELD_TYPES, "CONTENT_MODULE_FIELD_INVALID");
  const id = allocateId(field.id, label, `field-${index + 1}`, usedIds);
  const widget = requireWidget(type, field.widget);
  const modelWritable = requireBoolean(field.modelWritable, "CONTENT_MODULE_FIELD_INVALID");
  const showInSummary = requireBoolean(field.showInSummary, "CONTENT_MODULE_FIELD_INVALID");
  const views = context.facadeEnabled ? normalizeReadViews(field.views, type) : [];
  const hostAction = context.facadeEnabled
    ? normalizeHostAction(field.hostAction, type, id, context.usedActionIds)
    : null;
  if (context.facadeEnabled && !context.skillIOEnabled && (views.length > 0 || hostAction)) {
    throw creatorError("CONTENT_SKILL_IO_DRAFT_INVALID", "Disabled Skill I/O cannot keep read views or host actions.");
  }
  if (context.facadeEnabled && context.skillIOEnabled && modelWritable !== Boolean(hostAction)) {
    throw creatorError("CONTENT_SKILL_IO_ACTION_COVERAGE", "Every writable field requires exactly one simple host action.");
  }
  const common = { id, label, type, modelWritable, allowedOperations: operationsFor(field, type, modelWritable), display: { widget } };
  const draft = {
    id, label, type, widget, modelWritable, showInSummary,
    ...(context.facadeEnabled ? { views, hostAction } : {}),
  };
  let definition;
  let previewValue;

  if (type === "integer" || type === "number") {
    const integer = type === "integer";
    const minimum = requireFinite(field.minimum, integer, "CONTENT_MODULE_FIELD_INVALID");
    const maximum = requireFinite(field.maximum, integer, "CONTENT_MODULE_FIELD_INVALID");
    const defaultValue = requireFinite(field.default, integer, "CONTENT_MODULE_FIELD_INVALID");
    const preview = requireFinite(field.preview, integer, "CONTENT_MODULE_FIELD_INVALID");
    if (minimum > maximum || defaultValue < minimum || defaultValue > maximum || preview < minimum || preview > maximum) {
      throw creatorError("CONTENT_MODULE_FIELD_INVALID", "Numeric module values must remain inside their finite range.");
    }
    definition = { ...common, default: defaultValue, minimum, maximum };
    Object.assign(draft, { minimum, maximum, default: defaultValue, preview });
    previewValue = preview;
  } else if (type === "text") {
    const maxLength = requireInteger(field.maxLength, 1, 2000, "CONTENT_MODULE_FIELD_INVALID");
    const defaultValue = normalizeBoundedString(field.default, maxLength, "CONTENT_MODULE_FIELD_INVALID");
    const preview = normalizeBoundedString(field.preview, maxLength, "CONTENT_MODULE_FIELD_INVALID");
    definition = { ...common, default: defaultValue, maxLength };
    Object.assign(draft, { maxLength, default: defaultValue, preview });
    previewValue = preview;
  } else if (type === "boolean") {
    const defaultValue = requireBoolean(field.default, "CONTENT_MODULE_FIELD_INVALID");
    const preview = requireBoolean(field.preview, "CONTENT_MODULE_FIELD_INVALID");
    definition = { ...common, default: defaultValue };
    Object.assign(draft, { default: defaultValue, preview });
    previewValue = preview;
  } else if (type === "enum") {
    const options = normalizeOptions(field.options, `${id}-option`);
    const defaultOptionIndex = requireInteger(field.defaultOptionIndex, 0, options.length - 1, "CONTENT_MODULE_FIELD_INVALID");
    const previewOptionIndex = requireInteger(field.previewOptionIndex, 0, options.length - 1, "CONTENT_MODULE_FIELD_INVALID");
    definition = { ...common, default: options[defaultOptionIndex].id, options: options.map(projectDefinitionOption) };
    Object.assign(draft, { options, defaultOptionIndex, previewOptionIndex });
    previewValue = options[previewOptionIndex].id;
  } else if (type === "string_list") {
    const maxItems = requireInteger(field.maxItems, 1, 64, "CONTENT_MODULE_FIELD_INVALID");
    const itemMaxLength = requireInteger(field.itemMaxLength, 1, 240, "CONTENT_MODULE_FIELD_INVALID");
    const defaultValue = normalizeStringList(field.default, maxItems, itemMaxLength);
    const preview = normalizeStringList(field.preview, maxItems, itemMaxLength);
    definition = { ...common, default: defaultValue, maxItems, itemMaxLength };
    Object.assign(draft, { maxItems, itemMaxLength, default: defaultValue, preview });
    previewValue = preview;
  } else {
    const maxItems = requireInteger(field.maxItems, 1, 100, "CONTENT_MODULE_FIELD_INVALID");
    const itemFields = normalizeItemFields(field.itemFields, id);
    const previewRecordEnabled = requireBoolean(field.previewRecordEnabled, "CONTENT_MODULE_FIELD_INVALID");
    const summary = normalizeRecordSummary(field, itemFields, maxItems);
    if (summary.displaySummary) common.display.summary = summary.displaySummary;
    if (summary.groupCountBy) common.display.groupCountBy = summary.groupCountBy;
    definition = { ...common, default: [], maxItems, itemFields: itemFields.map((item) => item.definition) };
    Object.assign(draft, {
      maxItems,
      collectionMode: requireEnum(field.collectionMode, new Set(["append_only", "maintain", "maintain_clear"]), "CONTENT_MODULE_FIELD_INVALID"),
      itemFields: itemFields.map((item) => item.draft),
      previewRecordEnabled,
      summaryMode: summary.mode,
      summaryTarget: summary.target,
      milestones: summary.milestones,
      groupCountItemIndex: summary.groupCountItemIndex,
    });
    previewValue = previewRecordEnabled
      ? [Object.fromEntries(itemFields.map((item) => [item.id, item.previewValue]))]
      : [];
  }
  return { id, label, type, showInSummary, views, hostAction, definition, draft, previewValue };
}

function normalizeItemFields(value, parentId) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw creatorError("CONTENT_MODULE_RECORD_INVALID", "Record fields require 1 to 12 item fields.");
  }
  const usedIds = new Set();
  return value.map((entry, index) => {
    const field = requirePlainObject(entry, "CONTENT_MODULE_RECORD_INVALID");
    assertOnlyKeys(field, ["id", "label", "type", "minimum", "maximum", "maxLength", "options", "preview", "previewOptionIndex"], "CONTENT_MODULE_RECORD_INVALID");
    const label = normalizeLabel(field.label, "CONTENT_MODULE_RECORD_INVALID");
    const type = requireEnum(field.type, ITEM_FIELD_TYPES, "CONTENT_MODULE_RECORD_INVALID");
    const id = allocateId(field.id, label, `${parentId}-item-${index + 1}`, usedIds, RESERVED_RECORD_FIELDS);
    const definition = { id, label, type };
    const draft = { id, label, type };
    let previewValue;
    if (type === "integer" || type === "number") {
      const integer = type === "integer";
      const minimum = requireFinite(field.minimum, integer, "CONTENT_MODULE_RECORD_INVALID");
      const maximum = requireFinite(field.maximum, integer, "CONTENT_MODULE_RECORD_INVALID");
      const preview = requireFinite(field.preview, integer, "CONTENT_MODULE_RECORD_INVALID");
      if (minimum > maximum || preview < minimum || preview > maximum) throw creatorError("CONTENT_MODULE_RECORD_INVALID", "Record number preview is outside its range.");
      Object.assign(definition, { minimum, maximum });
      Object.assign(draft, { minimum, maximum, preview });
      previewValue = preview;
    } else if (type === "text") {
      const maxLength = requireInteger(field.maxLength, 1, 2000, "CONTENT_MODULE_RECORD_INVALID");
      const preview = normalizeBoundedString(field.preview, maxLength, "CONTENT_MODULE_RECORD_INVALID");
      Object.assign(definition, { maxLength });
      Object.assign(draft, { maxLength, preview });
      previewValue = preview;
    } else if (type === "boolean") {
      const preview = requireBoolean(field.preview, "CONTENT_MODULE_RECORD_INVALID");
      draft.preview = preview;
      previewValue = preview;
    } else {
      const options = normalizeOptions(field.options, `${parentId}-${id}-option`);
      const previewOptionIndex = requireInteger(field.previewOptionIndex, 0, options.length - 1, "CONTENT_MODULE_RECORD_INVALID");
      definition.options = options.map(projectDefinitionOption);
      Object.assign(draft, { options, previewOptionIndex });
      previewValue = options[previewOptionIndex].id;
    }
    return { id, definition, draft, previewValue };
  });
}

function normalizeRecordSummary(field, itemFields, maxItems) {
  const mode = requireEnum(field.summaryMode, new Set(["none", "count", "count_progress"]), "CONTENT_MODULE_RECORD_INVALID");
  const milestones = normalizeMilestones(field.milestones, maxItems);
  const groupCountItemIndex = field.groupCountItemIndex === null || field.groupCountItemIndex === undefined
    ? null
    : requireInteger(field.groupCountItemIndex, 0, itemFields.length - 1, "CONTENT_MODULE_RECORD_INVALID");
  const grouped = groupCountItemIndex === null ? null : itemFields[groupCountItemIndex];
  if (grouped && grouped.definition.type !== "enum") {
    throw creatorError("CONTENT_MODULE_RECORD_INVALID", "Record group counts must use an enum item field.");
  }
  if (mode === "none" && milestones.length) {
    throw creatorError("CONTENT_MODULE_RECORD_INVALID", "Record milestones require a count summary.");
  }
  const target = mode === "count_progress"
    ? requireInteger(field.summaryTarget, 1, maxItems, "CONTENT_MODULE_RECORD_INVALID")
    : null;
  const limit = target || maxItems;
  if (milestones.some((milestone) => milestone.minimum > limit)) {
    throw creatorError("CONTENT_MODULE_RECORD_INVALID", "Record milestones cannot exceed their count limit.");
  }
  return {
    mode,
    target,
    milestones,
    groupCountItemIndex,
    groupCountBy: grouped?.id || null,
    displaySummary: mode === "none" ? null : {
      mode,
      ...(target ? { target } : {}),
      ...(milestones.length ? { milestones } : {}),
    },
  };
}

function normalizeOptions(value, basis) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw creatorError("CONTENT_MODULE_OPTIONS_INVALID", "Enum fields require 1 to 32 options.");
  }
  const usedIds = new Set();
  const labels = new Set();
  return value.map((entry, index) => {
    const option = requirePlainObject(entry, "CONTENT_MODULE_OPTIONS_INVALID");
    assertOnlyKeys(option, ["id", "label"], "CONTENT_MODULE_OPTIONS_INVALID");
    const label = normalizeLabel(option.label, "CONTENT_MODULE_OPTIONS_INVALID");
    const normalizedLabel = label.normalize("NFKC").toLowerCase();
    if (labels.has(normalizedLabel)) throw creatorError("CONTENT_MODULE_OPTIONS_INVALID", "Enum option labels must be unique.");
    labels.add(normalizedLabel);
    const id = allocateId(option.id, label, `${basis}-${index + 1}`, usedIds);
    return { id, label };
  });
}

function normalizeMilestones(value, maximum) {
  if (!Array.isArray(value) || value.length > 16) throw creatorError("CONTENT_MODULE_RECORD_INVALID", "Record milestones are invalid.");
  let previous = -1;
  return value.map((entry) => {
    const milestone = requirePlainObject(entry, "CONTENT_MODULE_RECORD_INVALID");
    assertOnlyKeys(milestone, ["minimum", "label"], "CONTENT_MODULE_RECORD_INVALID");
    const minimum = requireInteger(milestone.minimum, 0, maximum, "CONTENT_MODULE_RECORD_INVALID");
    const label = normalizeLabel(milestone.label, "CONTENT_MODULE_RECORD_INVALID");
    if (minimum <= previous) throw creatorError("CONTENT_MODULE_RECORD_INVALID", "Record milestone counts must increase.");
    previous = minimum;
    return { minimum, label };
  });
}

function definitionFieldToDraft(field, previewValue, showInSummary) {
  const base = {
    id: field.id,
    label: field.label,
    type: field.type,
    widget: field.display.widget,
    modelWritable: field.modelWritable,
    showInSummary,
  };
  if (field.type === "integer" || field.type === "number") {
    return { ...base, minimum: field.minimum, maximum: field.maximum, default: field.default, preview: numericPreview(previewValue, field.default, field) };
  }
  if (field.type === "text") {
    return { ...base, maxLength: field.maxLength, default: field.default, preview: validStringPreview(previewValue, field.default, field.maxLength) };
  }
  if (field.type === "boolean") {
    return { ...base, default: field.default, preview: typeof previewValue === "boolean" ? previewValue : field.default };
  }
  if (field.type === "enum") {
    const options = field.options.map((option) => ({ id: option.value, label: option.label }));
    const defaultOptionIndex = Math.max(0, field.options.findIndex((option) => option.value === field.default));
    const previewOptionIndex = Math.max(0, field.options.findIndex((option) => option.value === previewValue));
    return { ...base, options, defaultOptionIndex, previewOptionIndex };
  }
  if (field.type === "string_list") {
    const preview = Array.isArray(previewValue) ? previewValue : field.default;
    return { ...base, maxItems: field.maxItems, itemMaxLength: field.itemMaxLength, default: [...field.default], preview: [...preview] };
  }
  const previewRecord = Array.isArray(previewValue) && previewValue.length ? previewValue[0] : null;
  const itemFields = field.itemFields.map((item) => definitionItemFieldToDraft(item, previewRecord?.[item.id]));
  const collectionMode = field.allowedOperations.includes("clear")
    ? "maintain_clear"
    : field.allowedOperations.includes("remove_by_id") ? "maintain" : "append_only";
  const groupCountItemIndex = field.display.groupCountBy
    ? field.itemFields.findIndex((item) => item.id === field.display.groupCountBy)
    : null;
  return {
    ...base,
    maxItems: field.maxItems,
    collectionMode,
    itemFields,
    previewRecordEnabled: Boolean(previewRecord),
    summaryMode: field.display.summary?.mode || "none",
    summaryTarget: field.display.summary?.target || null,
    milestones: (field.display.summary?.milestones || []).map((item) => ({ ...item })),
    groupCountItemIndex: groupCountItemIndex >= 0 ? groupCountItemIndex : null,
  };
}

function definitionItemFieldToDraft(field, previewValue) {
  const base = { id: field.id, label: field.label, type: field.type };
  if (field.type === "integer" || field.type === "number") {
    const fallback = Math.min(field.maximum, Math.max(field.minimum, 0));
    return { ...base, minimum: field.minimum, maximum: field.maximum, preview: numericPreview(previewValue, fallback, field) };
  }
  if (field.type === "text") return { ...base, maxLength: field.maxLength, preview: validStringPreview(previewValue, "示例", field.maxLength) };
  if (field.type === "boolean") return { ...base, preview: typeof previewValue === "boolean" ? previewValue : false };
  const options = field.options.map((option) => ({ id: option.value, label: option.label }));
  const previewOptionIndex = Math.max(0, field.options.findIndex((option) => option.value === previewValue));
  return { ...base, options, previewOptionIndex };
}

function normalizeSkillIONamespace(value, identitySeed) {
  if (typeof value === "string" && FIELD_ID_PATTERN.test(value)) return value;
  if (value !== null && value !== undefined && value !== "") {
    throw creatorError("CONTENT_SKILL_IO_NAMESPACE_INVALID", "Skill I/O namespace is invalid.");
  }
  const entropy = identitySeed === undefined || identitySeed === null || identitySeed === ""
    ? crypto.randomBytes(24).toString("hex")
    : stableHash(`skill-io:${String(identitySeed)}`);
  return `skillio_${entropy.slice(0, 24)}`;
}

function normalizeReadViews(value, fieldType) {
  if (!Array.isArray(value) || value.length > 3) {
    throw creatorError("CONTENT_SKILL_IO_VIEW_INVALID", "Skill I/O read views are invalid.");
  }
  const views = value.map((view) => requireEnum(view, READ_VIEW_IDS, "CONTENT_SKILL_IO_VIEW_INVALID"));
  if (new Set(views).size !== views.length) {
    throw creatorError("CONTENT_SKILL_IO_VIEW_INVALID", "Skill I/O read views must be unique.");
  }
  if (fieldType !== "record_list" && views.some((view) => view === "recent" || view === "lookup")) {
    throw creatorError("CONTENT_SKILL_IO_VIEW_INCOMPATIBLE", "Recent and lookup views require a record list field.");
  }
  const order = new Map([["overview", 0], ["recent", 1], ["lookup", 2]]);
  return views.sort((left, right) => order.get(left) - order.get(right));
}

function normalizeHostAction(value, fieldType, fieldId, usedActionIds) {
  if (value === null || value === undefined) return null;
  const action = requirePlainObject(value, "CONTENT_SKILL_IO_ACTION_INVALID");
  assertOnlyKeys(action, ["id", "label", "behavior"], "CONTENT_SKILL_IO_ACTION_INVALID");
  const behavior = requireEnum(action.behavior, ACTION_BEHAVIORS, "CONTENT_SKILL_IO_ACTION_INVALID");
  if (!ACTION_BEHAVIORS_BY_TYPE[fieldType]?.has(behavior)) {
    throw creatorError("CONTENT_SKILL_IO_ACTION_INCOMPATIBLE", "The selected host action does not match this field type.");
  }
  const label = normalizeLabel(action.label, "CONTENT_SKILL_IO_ACTION_INVALID");
  const id = allocateActionId(action.id, fieldId, usedActionIds || new Set());
  return { id, label, behavior };
}

function allocateActionId(candidate, fieldId, usedIds) {
  const submitted = candidate === null || candidate === undefined || candidate === "" ? null : String(candidate);
  if (submitted && !FIELD_ID_PATTERN.test(submitted)) {
    throw creatorError("CONTENT_SKILL_IO_ACTION_INVALID", "Skill I/O action identity is invalid.");
  }
  const seed = submitted || `action_${stableHash(`field:${fieldId}`).slice(0, 16)}`;
  if (usedIds.has(seed)) {
    throw creatorError("CONTENT_SKILL_IO_ACTION_INVALID", "Skill I/O action identities must be unique.");
  }
  usedIds.add(seed);
  return seed;
}

function validateReadViewOwnership(fields) {
  for (const viewId of ["recent", "lookup"]) {
    if (fields.filter((field) => field.views.includes(viewId)).length > 1) {
      throw creatorError("CONTENT_SKILL_IO_VIEW_AMBIGUOUS", `Only one record field can own the ${viewId} view.`);
    }
  }
}

function compileSkillIOCompanion(fields, definition, namespace) {
  const readViews = [{
    id: "guide",
    projection: "guide",
    targetFieldIds: [],
    query: false,
    limit: 1,
  }];
  const overviewTargets = fields.filter((field) => field.views.includes("overview")).map((field) => field.id);
  if (overviewTargets.length > 0) {
    readViews.push({
      id: "overview",
      projection: "summary",
      targetFieldIds: overviewTargets,
      query: false,
      limit: Math.min(12, overviewTargets.length),
    });
  }
  for (const viewId of ["recent", "lookup"]) {
    const field = fields.find((entry) => entry.views.includes(viewId));
    if (field) {
      readViews.push({
        id: viewId,
        projection: viewId === "recent" ? "recent_records" : "record_lookup",
        targetFieldIds: [field.id],
        query: viewId === "lookup",
        limit: 5,
      });
    }
  }
  const fieldById = new Map((definition?.fields || []).map((field) => [field.id, field]));
  const companion = {
    schemaVersion: SKILL_IO_VERSION,
    namespace,
    defaultView: readViews.some((view) => view.id === "overview") ? "overview" : "guide",
    readViews,
    actions: fields.filter((field) => field.hostAction).map((field) => compileHostAction(
      fieldById.get(field.id),
      field.hostAction,
      namespace
    )),
  };
  assertSkillIOCompanionMatchesDefinition(companion, definition);
  return companion;
}

function compileHostAction(field, hostAction, namespace) {
  if (!field || !hostAction) {
    throw creatorError("CONTENT_SKILL_IO_ACTION_INVALID", "Skill I/O action target is missing.");
  }
  const model = buildActionModel(field, hostAction);
  return {
    id: hostAction.id,
    toolName: `${ACTION_TOOL_PREFIX[hostAction.behavior]}_${stableHash(`action:${namespace}:${hostAction.id}`).slice(0, 10)}`,
    label: hostAction.label,
    archetype: hostAction.behavior,
    modelInput: {
      fields: model.fields,
      required: model.fields.map((entry) => entry.name),
    },
    runtimeMapping: {
      targetFieldId: field.id,
      operation: ACTION_OPERATION[hostAction.behavior],
      bindings: model.bindings,
      policy: "none",
    },
  };
}

function buildActionModel(field, hostAction) {
  if (hostAction.behavior === "adjust_number") {
    const span = Math.max(Math.abs(field.minimum), Math.abs(field.maximum), Math.abs(field.maximum - field.minimum));
    return {
      fields: [numericInput("amount", field.type, -span, span, field.label)],
      bindings: [{ argument: "amount", mode: "numeric_delta" }],
    };
  }
  if (hostAction.behavior === "change_list_item") {
    return {
      fields: [
        { name: "change", type: "string", description: hostAction.label, enum: ["add", "remove"] },
        { name: "item", type: "string", description: field.label, maxLength: field.itemMaxLength },
      ],
      bindings: [
        { argument: "change", mode: "list_change" },
        { argument: "item", mode: "opaque_value" },
      ],
    };
  }
  if (hostAction.behavior === "append_record") return buildRecordActionModel(field);
  if (hostAction.behavior === "choose_enum") {
    return {
      fields: [{ name: "choice", type: "string", description: field.label, enum: field.options.map((option) => option.label) }],
      bindings: [{
        argument: "choice",
        mode: "exact_enum_label",
        valueMap: field.options.map((option) => ({ input: option.label, value: option.value })),
      }],
    };
  }
  return {
    fields: [inputForField("value", field, field.label)],
    bindings: [{ argument: "value", mode: "opaque_value" }],
  };
}

function buildRecordActionModel(field) {
  const counts = new Map();
  const fields = [];
  const bindings = [];
  for (const item of field.itemFields) {
    const base = item.type === "enum" ? "choice"
      : item.type === "boolean" ? "enabled"
        : item.type === "integer" || item.type === "number" ? "amount" : "text";
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    const argument = count === 1 ? base : `${base}_${count}`;
    fields.push(inputForField(argument, item, item.label));
    bindings.push(item.type === "enum"
      ? {
        argument,
        itemFieldId: item.id,
        mode: "exact_enum_label",
        valueMap: item.options.map((option) => ({ input: option.label, value: option.value })),
      }
      : { argument, itemFieldId: item.id, mode: "opaque_value" });
  }
  return { fields, bindings };
}

function inputForField(name, field, description) {
  if (field.type === "integer" || field.type === "number") {
    return numericInput(name, field.type, field.minimum, field.maximum, description);
  }
  if (field.type === "boolean") return { name, type: "boolean", description };
  if (field.type === "enum") {
    return { name, type: "string", description, enum: field.options.map((option) => option.label) };
  }
  return { name, type: "string", description, maxLength: field.maxLength };
}

function numericInput(name, type, minimum, maximum, description) {
  return { name, type: type === "integer" ? "integer" : "number", description, minimum, maximum };
}

function assertSkillIOCompanionMatchesDefinition(companion, definition) {
  try {
    validateContract("skill-io-companion-v1", companion);
    if (definition) validateContract("skill-module-definition-v1", definition);
  } catch (error) {
    throw creatorError("CONTENT_SKILL_IO_INVALID", "Skill I/O companion failed contract validation.", {
      issue: stableIssue(error),
      issues: stableIssues(error),
    });
  }
  const fieldById = new Map((definition?.fields || []).map((field) => [field.id, field]));
  for (const view of companion.readViews) {
    for (const fieldId of view.targetFieldIds) {
      const field = fieldById.get(fieldId);
      if (!field || ((view.id === "recent" || view.id === "lookup") && field.type !== "record_list")) {
        throw creatorError("CONTENT_SKILL_IO_VIEW_INCOMPATIBLE", "Skill I/O view targets do not match the module definition.");
      }
    }
  }
  const targets = new Set();
  for (const action of companion.actions) {
    const field = fieldById.get(action.runtimeMapping.targetFieldId);
    if (!field || !field.modelWritable || targets.has(field.id)
      || !ACTION_BEHAVIORS_BY_TYPE[field.type]?.has(action.archetype)) {
      throw creatorError("CONTENT_SKILL_IO_ACTION_INCOMPATIBLE", "Skill I/O actions do not match writable module fields.");
    }
    targets.add(field.id);
    const expected = compileHostAction(field, { id: action.id, label: action.label, behavior: action.archetype }, companion.namespace);
    if (canonicalJson(expected) !== canonicalJson(action)) {
      throw creatorError("CONTENT_SKILL_IO_MAPPING_INVALID", "Skill I/O Runtime mapping must be generated from the locked module definition.");
    }
  }
  const writable = [...fieldById.values()].filter((field) => field.modelWritable).map((field) => field.id).sort();
  if (canonicalJson(writable) !== canonicalJson([...targets].sort())) {
    throw creatorError("CONTENT_SKILL_IO_ACTION_COVERAGE", "Skill I/O actions must cover every writable field exactly once.");
  }
  return true;
}

function operationsFor(field, type, writable) {
  if (!writable) return [];
  if (type === "text" || type === "string_list") return ["set", "clear"];
  if (type !== "record_list") return ["set"];
  const mode = requireEnum(field.collectionMode, new Set(["append_only", "maintain", "maintain_clear"]), "CONTENT_MODULE_FIELD_INVALID");
  if (mode === "append_only") return ["append"];
  if (mode === "maintain") return ["append", "remove_by_id"];
  return ["append", "remove_by_id", "clear"];
}

function allocateId(candidate, label, basis, used, reserved = new Set()) {
  const submitted = candidate === null || candidate === undefined || candidate === "" ? null : String(candidate);
  if (submitted && (!FIELD_ID_PATTERN.test(submitted) || reserved.has(submitted))) {
    throw creatorError("CONTENT_MODULE_FIELD_INVALID", "Skill module field identity is invalid.");
  }
  const seed = submitted || suggestedId(label, basis);
  let id = seed;
  for (let suffix = 2; used.has(id) || reserved.has(id); suffix += 1) {
    const tail = `_${suffix}`;
    id = `${seed.slice(0, 64 - tail.length)}${tail}`;
  }
  used.add(id);
  return id;
}

function suggestedId(label, basis) {
  const ascii = String(label || "").normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "").slice(0, 48);
  if (ascii && FIELD_ID_PATTERN.test(ascii)) return ascii;
  return `field_${crypto.createHash("sha256").update(`${basis}\n${label}`).digest("hex").slice(0, 12)}`;
}

function requireWidget(type, value) {
  const widget = value || DEFAULT_WIDGET[type];
  if (!WIDGETS[type]?.has(widget)) throw creatorError("CONTENT_MODULE_FIELD_INVALID", "Skill module display component is invalid.");
  return widget;
}

function selectCreatorPanelSurface(definition) {
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  if (fields.length === 0) return "guide";
  const recordFields = fields.filter((field) => field.type === "record_list");
  if (recordFields.some((field) => field.display?.widget === "timeline")) return "timeline";
  if (recordFields.length > 0) return "list_detail";
  if (fields.some((field) =>
    (field.type === "integer" || field.type === "number")
    && (field.display?.widget === "progress" || field.display?.widget === "meter"))) {
    return "progress";
  }
  return "fields";
}

function normalizeStringList(value, maximumItems, maximumLength) {
  if (!Array.isArray(value) || value.length > maximumItems) throw creatorError("CONTENT_MODULE_FIELD_INVALID", "Skill module list is too large.");
  return value.map((item) => normalizeBoundedString(item, maximumLength, "CONTENT_MODULE_FIELD_INVALID"));
}

function normalizeBoundedString(value, maximum, code) {
  if (typeof value !== "string" || Array.from(value).length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    throw creatorError(code, "Skill module text is invalid.");
  }
  return value;
}

function normalizeLabel(value, code) {
  const label = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!label || label.length > 120 || /[\u0000-\u001F\u007F]/.test(label)) throw creatorError(code, "Skill module label is invalid.");
  return label;
}

function requireFinite(value, integer, code) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000 || (integer && !Number.isInteger(value))) {
    throw creatorError(code, "Skill module number is invalid.");
  }
  return value;
}

function requireInteger(value, minimum, maximum, code) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw creatorError(code, "Skill module integer is invalid.");
  return value;
}

function requireBoolean(value, code) {
  if (typeof value !== "boolean") throw creatorError(code, "Skill module boolean is invalid.");
  return value;
}

function requireEnum(value, allowed, code) {
  if (!allowed.has(value)) throw creatorError(code, "Skill module option is invalid.");
  return value;
}

function requirePlainObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw creatorError(code, "Skill module Creator input is invalid.");
  return value;
}

function assertOnlyKeys(value, allowed, code) {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) throw creatorError(code, "Skill module Creator input contains unsupported properties.");
}

function numericPreview(value, fallback, field) {
  return typeof value === "number" && Number.isFinite(value) && value >= field.minimum && value <= field.maximum
    && (field.type !== "integer" || Number.isInteger(value)) ? value : fallback;
}

function validStringPreview(value, fallback, maximum) {
  return typeof value === "string" && Array.from(value).length <= maximum ? value : fallback;
}

function projectDefinitionOption(option) {
  return { value: option.id, label: option.label };
}

function stableIssue(error) {
  const issues = Array.isArray(error?.issues)
    ? error.issues
    : Array.isArray(error?.meta?.issues) ? error.meta.issues : [];
  const first = issues[0] || null;
  return first
    ? `${String(first.instancePath || first.instance_path || "").slice(0, 120)}:${String(first.keyword || "invalid").slice(0, 64)}`
    : "invalid";
}

function stableIssues(error) {
  const issues = Array.isArray(error?.issues)
    ? error.issues
    : Array.isArray(error?.meta?.issues) ? error.meta.issues : [];
  return JSON.stringify(issues.slice(0, 6).map((issue) => ({
    path: issue.instancePath || issue.instance_path || "",
    keyword: issue.keyword || "invalid",
    message: issue.message || "",
  })));
}

function creatorError(code, message, meta = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  error.meta = Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, String(value).slice(0, 160)]));
  return error;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

module.exports = {
  CREATOR_DRAFT_VERSION,
  CREATOR_FACADE_DRAFT_VERSION,
  SKILL_IO_VERSION,
  assertSkillIOCompanionMatchesDefinition,
  createSkillModuleCreatorDraft,
  normalizeSkillModuleCreatorDraft,
};
