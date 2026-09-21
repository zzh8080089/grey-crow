#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");

const {
  normalizeSkillModuleCreatorDraft,
} = require("../../../../engine/content-v2");

const AUTHOR_SCHEMA_VERSION = "grey-crow-skill-creator-semantics-experiment-v1";
const COMPANION_SCHEMA_VERSION = "grey-crow-skill-io-companion-experiment-v1";
const REPORT_SCHEMA_VERSION = "grey-crow-skill-creator-facade-experiment-report-v1";
const CREATOR_DRAFT_VERSION = "grey-crow-skill-module-creator-draft-v1";
const VIEW_IDS = new Set(["overview", "recent", "lookup"]);
const FIELD_TYPES = new Set(["integer", "number", "text", "boolean", "enum", "string_list", "record_list"]);
const ITEM_FIELD_TYPES = new Set(["integer", "number", "text", "boolean", "enum"]);
const BEHAVIORS_BY_TYPE = Object.freeze({
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
const OPERATION_BY_BEHAVIOR = Object.freeze({
  set_value: "set",
  adjust_number: "set",
  append_record: "append",
  change_list_item: "set",
  choose_enum: "set",
});
const INTERNAL_KEY_NAMES = new Set([
  "toolName",
  "fieldId",
  "targetField",
  "targetFieldId",
  "modelFields",
  "runtimeFields",
  "constantFields",
  "operation",
  "permission",
  "revision",
  "moduleRef",
  "namedPolicy",
  "namedTransition",
]);
const MODEL_SURFACE_FORBIDDEN = /(?:module[_-]?ref|field[_-]?id|target[_-]?field|operation|permission|revision|runtime[_-]?field|constant[_-]?field|named[_-]?(?:policy|transition)|path|schema[_-]?body)/i;

main();

function main() {
  const fixtures = createPositiveFixtures();
  const compiled = fixtures.map((fixture) => compileCreatorDraft(fixture.author, fixture.engine));

  for (let index = 0; index < fixtures.length; index += 1) {
    const again = compileCreatorDraft(fixtures[index].author, fixtures[index].engine);
    assert(canonicalJson(compiled[index]) === canonicalJson(again), `fixture ${fixtures[index].name} did not compile deterministically`);
    assertPublicBoundary(fixtures[index].author, compiled[index]);
  }

  const clueFixtures = fixtures.filter((fixture) => fixture.family === "clue-ledger");
  const clueCompiled = clueFixtures.map((fixture) => compileCreatorDraft(fixture.author, fixture.engine));
  const clueShape = structuralSignature(clueCompiled[0]);
  assert(clueCompiled.every((entry) => structuralSignature(entry) === clueShape), "localized clue fixtures did not share one compiler shape");

  const rejectionCases = runRejectionCases();
  const burden = fixtures.map((fixture, index) => measureAuthorBoundary(fixture, compiled[index]));
  const report = deepFreeze({
    schema_version: REPORT_SCHEMA_VERSION,
    experiment_date: "2026-07-21",
    scope: "isolated_creator_form_to_runtime_owned_skill_io_compiler",
    provider_calls: 0,
    production_creator_changed: false,
    production_router_changed: false,
    production_store_writes: 0,
    compiled_cases: fixtures.map((fixture, index) => ({
      name: fixture.name,
      language: fixture.author.language,
      state_fields: fixture.author.fields.length,
      read_views: compiled[index].companion.readViews.map((view) => view.id),
      actions: compiled[index].companion.actions.map((action) => action.archetype),
      module_definition: Boolean(compiled[index].moduleDefinition),
      round_trip_definition_v1: compiled[index].roundTripDefinitionV1,
    })),
    rejection_cases: rejectionCases,
    language_neutrality: {
      compared_locales: clueFixtures.map((fixture) => fixture.author.language),
      identical_structural_signature: true,
      compiler_locale_or_label_semantic_branches: 0,
      exact_enum_label_mapping_is_engine_generated_data: true,
    },
    author_boundary: burden,
    decision: {
      selected_input: "field-attached views and one fixed semantic action chosen from a form",
      selected_output: "Definition v1 plus an immutable Skill I/O companion contract",
      read_surface: "inspect_skill with compiled guide/overview/recent/lookup availability",
      write_surface: "one generated flat tool per declared action",
      production_recommendation: "keep Definition v1 unchanged; add a separately versioned companion contract before F2-E4 migration",
    },
    limitations: [
      "This is an isolated deterministic compiler experiment, not a production Creator UI implementation.",
      "It proves form shape, v1 field compatibility, generated model schemas, language-neutral structure, and stable rejection only.",
      "Production editing must reuse the current D6 hidden persisted field, item, and option identities; recompiling identities from labels or list positions would make rename or reorder unsafe.",
      "It does not prove real player usability, Pack save/reopen, Adventure snapshot locking, Provider tool choice, Router execution, or restart durability.",
    ],
  });

  assert(report.compiled_cases.length === fixtures.length, "compiled case count changed");
  assert(report.rejection_cases.length === 13 && report.rejection_cases.every((entry) => entry.rejected), "rejection coverage changed");
  assert(report.author_boundary.every((entry) => entry.author_internal_protocol_keys === 0), "author input leaked protocol fields");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function compileCreatorDraft(value, engineContext) {
  const author = normalizeAuthorDraft(value);
  const engine = normalizeEngineContext(engineContext);
  const compiledFields = author.fields.map((field, index) => compileField(field, engine.skillId, index));
  validateViewOwnership(compiledFields);
  if (compiledFields.filter((field) => field.action).length > 8) {
    throw creatorError("CREATOR_ACTION_LIMIT", "A Skill cannot expose more than 8 host actions.");
  }

  const moduleDraft = compiledFields.length
    ? {
      schemaVersion: CREATOR_DRAFT_VERSION,
      enabled: true,
      fields: compiledFields.map((field) => field.moduleDraft),
    }
    : { schemaVersion: CREATOR_DRAFT_VERSION, enabled: false, fields: [] };
  const normalizedModule = normalizeSkillModuleCreatorDraft(moduleDraft, { requireRoundTrip: true });
  const definitionFields = normalizedModule.definition?.fields || [];
  const readViews = compileReadViews(compiledFields, definitionFields);
  const actions = compiledFields.flatMap((field, index) => field.action
    ? [compileAction(field, definitionFields[index], engine.skillId, index)]
    : []);
  const companion = deepFreeze({
    schemaVersion: COMPANION_SCHEMA_VERSION,
    skillId: engine.skillId,
    language: author.language,
    defaultView: readViews.some((view) => view.id === "overview") ? "overview" : "guide",
    readViews,
    actions,
    moduleGrant: {
      readViewIds: readViews.map((view) => view.id),
      fieldOperations: actions.map((action) => ({
        actionId: action.id,
        fieldId: action.runtimeMapping.targetFieldId,
        operations: [action.runtimeMapping.operation],
      })),
    },
  });
  const publicPreview = deepFreeze({
    language: author.language,
    title: author.title,
    trigger: author.trigger,
    player: {
      guide: author.guide,
      state: compiledFields.map((field) => ({
        label: field.author.label,
        type: field.author.type,
        appearsInSummary: field.author.showInSummary,
      })),
    },
    host: {
      reads: readViews.map((view) => ({
        kind: publicViewKind(view.id),
        fields: view.publicFieldLabels,
      })),
      actions: compiledFields.filter((field) => field.action).map((field) => ({
        label: field.action.label,
        behavior: publicBehaviorKind(field.action.behavior),
        target: field.author.label,
        inputs: publicActionInputs(field),
      })),
    },
  });

  return deepFreeze({
    normalizedAuthor: author,
    moduleDefinition: normalizedModule.definition,
    companion,
    providerTools: actions.map((action) => action.providerTool),
    publicPreview,
    roundTripDefinitionV1: true,
  });
}

function normalizeAuthorDraft(value) {
  const draft = requirePlainObject(value, "CREATOR_DRAFT_INVALID");
  assertOnlyKeys(draft, ["schemaVersion", "language", "title", "trigger", "guide", "fields"], "CREATOR_INPUT_UNSUPPORTED");
  if (draft.schemaVersion !== AUTHOR_SCHEMA_VERSION) throw creatorError("CREATOR_DRAFT_INVALID", "Creator semantic draft version is invalid.");
  const language = requireLanguage(draft.language);
  const title = requireText(draft.title, 120, "CREATOR_TITLE_INVALID");
  const trigger = requireText(draft.trigger, 240, "CREATOR_TRIGGER_INVALID");
  const guide = requireText(draft.guide, 1200, "CREATOR_GUIDE_INVALID");
  if (!Array.isArray(draft.fields) || draft.fields.length > 12) throw creatorError("CREATOR_FIELDS_INVALID", "Creator fields are invalid.");
  const labels = new Set();
  const fields = draft.fields.map((field, index) => normalizeAuthorField(field, index, labels));
  return deepFreeze({ schemaVersion: AUTHOR_SCHEMA_VERSION, language, title, trigger, guide, fields });
}

function normalizeAuthorField(value, index, usedLabels) {
  const field = requirePlainObject(value, "CREATOR_FIELD_INVALID");
  assertOnlyKeys(field, [
    "label", "type", "showInSummary", "views", "default", "minimum", "maximum", "maxLength",
    "maxItems", "itemMaxLength", "options", "defaultOptionIndex", "itemFields", "hostAction",
  ], "CREATOR_INPUT_UNSUPPORTED");
  const label = requireText(field.label, 120, "CREATOR_FIELD_INVALID");
  const normalizedLabel = label.normalize("NFKC").toLocaleLowerCase("und");
  if (usedLabels.has(normalizedLabel)) throw creatorError("CREATOR_FIELD_DUPLICATE", "Creator field labels must be unique.");
  usedLabels.add(normalizedLabel);
  const type = requireEnum(field.type, FIELD_TYPES, "CREATOR_FIELD_INVALID");
  const showInSummary = requireBoolean(field.showInSummary, "CREATOR_FIELD_INVALID");
  const views = normalizeViews(field.views, type);
  const hostAction = field.hostAction === null || field.hostAction === undefined
    ? null
    : normalizeHostAction(field.hostAction, type);
  const common = { label, type, showInSummary, views, hostAction };

  if (type === "integer" || type === "number") {
    const integer = type === "integer";
    const minimum = requireFinite(field.minimum, integer, "CREATOR_FIELD_INVALID");
    const maximum = requireFinite(field.maximum, integer, "CREATOR_FIELD_INVALID");
    const defaultValue = requireFinite(field.default, integer, "CREATOR_FIELD_INVALID");
    if (minimum > maximum || defaultValue < minimum || defaultValue > maximum) throw creatorError("CREATOR_FIELD_INVALID", "Numeric field range is invalid.");
    return deepFreeze({ ...common, minimum, maximum, default: defaultValue });
  }
  if (type === "text") {
    const maxLength = requireInteger(field.maxLength, 1, 2000, "CREATOR_FIELD_INVALID");
    return deepFreeze({ ...common, maxLength, default: requireOptionalText(field.default, maxLength, "CREATOR_FIELD_INVALID") });
  }
  if (type === "boolean") {
    return deepFreeze({ ...common, default: requireBoolean(field.default, "CREATOR_FIELD_INVALID") });
  }
  if (type === "enum") {
    const options = normalizeOptionLabels(field.options, "CREATOR_FIELD_INVALID");
    const defaultOptionIndex = requireInteger(field.defaultOptionIndex, 0, options.length - 1, "CREATOR_FIELD_INVALID");
    return deepFreeze({ ...common, options, defaultOptionIndex });
  }
  if (type === "string_list") {
    const maxItems = requireInteger(field.maxItems, 1, 64, "CREATOR_FIELD_INVALID");
    const itemMaxLength = requireInteger(field.itemMaxLength, 1, 240, "CREATOR_FIELD_INVALID");
    const defaultValue = normalizeStringList(field.default, maxItems, itemMaxLength);
    return deepFreeze({ ...common, maxItems, itemMaxLength, default: defaultValue });
  }
  const maxItems = requireInteger(field.maxItems, 1, 100, "CREATOR_FIELD_INVALID");
  if (!Array.isArray(field.itemFields) || field.itemFields.length < 1 || field.itemFields.length > 6) {
    throw creatorError("CREATOR_RECORD_INVALID", "Record fields require 1 to 6 simple item fields.");
  }
  const itemLabels = new Set();
  const itemFields = field.itemFields.map((item, itemIndex) => normalizeItemField(item, itemIndex, itemLabels));
  return deepFreeze({ ...common, maxItems, itemFields });
}

function normalizeItemField(value, index, usedLabels) {
  const field = requirePlainObject(value, "CREATOR_RECORD_INVALID");
  assertOnlyKeys(field, ["label", "type", "minimum", "maximum", "maxLength", "options"], "CREATOR_INPUT_UNSUPPORTED");
  const label = requireText(field.label, 120, "CREATOR_RECORD_INVALID");
  const normalizedLabel = label.normalize("NFKC").toLocaleLowerCase("und");
  if (usedLabels.has(normalizedLabel)) throw creatorError("CREATOR_RECORD_INVALID", "Record item labels must be unique.");
  usedLabels.add(normalizedLabel);
  const type = requireEnum(field.type, ITEM_FIELD_TYPES, "CREATOR_RECORD_INVALID");
  if (type === "integer" || type === "number") {
    const integer = type === "integer";
    const minimum = requireFinite(field.minimum, integer, "CREATOR_RECORD_INVALID");
    const maximum = requireFinite(field.maximum, integer, "CREATOR_RECORD_INVALID");
    if (minimum > maximum) throw creatorError("CREATOR_RECORD_INVALID", "Record numeric range is invalid.");
    return deepFreeze({ label, type, minimum, maximum });
  }
  if (type === "text") {
    return deepFreeze({ label, type, maxLength: requireInteger(field.maxLength, 1, 2000, "CREATOR_RECORD_INVALID") });
  }
  if (type === "enum") return deepFreeze({ label, type, options: normalizeOptionLabels(field.options, "CREATOR_RECORD_INVALID") });
  return deepFreeze({ label, type });
}

function normalizeHostAction(value, fieldType) {
  const action = requirePlainObject(value, "CREATOR_ACTION_INVALID");
  assertOnlyKeys(action, ["label", "behavior"], "CREATOR_INPUT_UNSUPPORTED");
  const label = requireText(action.label, 120, "CREATOR_ACTION_INVALID");
  const behavior = requireEnum(action.behavior, new Set(Object.keys(OPERATION_BY_BEHAVIOR)), "CREATOR_ACTION_INVALID");
  if (!BEHAVIORS_BY_TYPE[fieldType].has(behavior)) throw creatorError("CREATOR_ACTION_INCOMPATIBLE", "The selected action does not match this field type.");
  return deepFreeze({ label, behavior });
}

function normalizeViews(value, fieldType) {
  if (!Array.isArray(value) || value.length > 3) throw creatorError("CREATOR_VIEWS_INVALID", "Creator views are invalid.");
  const views = value.map((view) => requireEnum(view, VIEW_IDS, "CREATOR_VIEWS_INVALID"));
  if (new Set(views).size !== views.length) throw creatorError("CREATOR_VIEWS_INVALID", "Creator views must be unique.");
  if (fieldType !== "record_list" && views.some((view) => view === "recent" || view === "lookup")) {
    throw creatorError("CREATOR_VIEW_INCOMPATIBLE", "Recent and lookup views require a record field.");
  }
  return deepFreeze(views);
}

function compileField(author, skillId, index) {
  const id = stableId("field", skillId, index);
  const action = author.hostAction;
  const base = {
    id,
    label: author.label,
    type: author.type,
    modelWritable: Boolean(action),
    showInSummary: author.showInSummary,
  };
  let moduleDraft;
  let itemFields = [];
  if (author.type === "integer" || author.type === "number") {
    moduleDraft = { ...base, widget: "progress", minimum: author.minimum, maximum: author.maximum, default: author.default, preview: author.default };
  } else if (author.type === "text") {
    moduleDraft = { ...base, widget: "text", maxLength: author.maxLength, default: author.default, preview: author.default };
  } else if (author.type === "boolean") {
    moduleDraft = { ...base, widget: "indicator", default: author.default, preview: author.default };
  } else if (author.type === "enum") {
    moduleDraft = {
      ...base,
      widget: "badge",
      options: author.options.map((label, optionIndex) => ({ id: stableId("option", skillId, index, optionIndex), label })),
      defaultOptionIndex: author.defaultOptionIndex,
      previewOptionIndex: author.defaultOptionIndex,
    };
  } else if (author.type === "string_list") {
    moduleDraft = {
      ...base,
      widget: "chips",
      maxItems: author.maxItems,
      itemMaxLength: author.itemMaxLength,
      default: author.default,
      preview: author.default,
    };
  } else {
    itemFields = author.itemFields.map((item, itemIndex) => compileItemField(item, skillId, index, itemIndex));
    moduleDraft = {
      ...base,
      widget: "cards",
      maxItems: author.maxItems,
      collectionMode: "append_only",
      itemFields: itemFields.map((item) => item.moduleDraft),
      previewRecordEnabled: false,
      summaryMode: author.showInSummary ? "count" : "none",
      summaryTarget: null,
      milestones: [],
      groupCountItemIndex: null,
    };
  }
  return deepFreeze({ author, action, moduleDraft, itemFields });
}

function compileItemField(author, skillId, fieldIndex, itemIndex) {
  const id = stableId("item", skillId, fieldIndex, itemIndex);
  const base = { id, label: author.label, type: author.type };
  if (author.type === "integer" || author.type === "number") {
    return deepFreeze({ author, moduleDraft: { ...base, minimum: author.minimum, maximum: author.maximum, preview: clampZero(author.minimum, author.maximum) } });
  }
  if (author.type === "text") return deepFreeze({ author, moduleDraft: { ...base, maxLength: author.maxLength, preview: "示例" } });
  if (author.type === "boolean") return deepFreeze({ author, moduleDraft: { ...base, preview: false } });
  return deepFreeze({
    author,
    moduleDraft: {
      ...base,
      options: author.options.map((label, optionIndex) => ({ id: stableId("item_option", skillId, fieldIndex, itemIndex, optionIndex), label })),
      previewOptionIndex: 0,
    },
  });
}

function validateViewOwnership(fields) {
  for (const view of ["recent", "lookup"]) {
    const owners = fields.filter((field) => field.author.views.includes(view));
    if (owners.length > 1) throw creatorError("CREATOR_VIEW_AMBIGUOUS", `Only one record field can own ${view}.`);
  }
}

function compileReadViews(fields, definitionFields) {
  const views = [{
    id: "guide",
    projection: "guide",
    targetFieldIds: [],
    query: false,
    limit: 1,
    publicFieldLabels: [],
  }];
  const overview = fields.map((field, index) => ({ field, definition: definitionFields[index] }))
    .filter(({ field }) => field.author.views.includes("overview"));
  if (overview.length) {
    views.push({
      id: "overview",
      projection: "summary",
      targetFieldIds: overview.map(({ definition }) => definition.id),
      query: false,
      limit: Math.min(12, overview.length),
      publicFieldLabels: overview.map(({ field }) => field.author.label),
    });
  }
  for (const view of ["recent", "lookup"]) {
    const index = fields.findIndex((field) => field.author.views.includes(view));
    if (index >= 0) {
      views.push({
        id: view,
        projection: view === "recent" ? "recent_records" : "record_lookup",
        targetFieldIds: [definitionFields[index].id],
        query: view === "lookup",
        limit: 5,
        publicFieldLabels: [fields[index].author.label],
      });
    }
  }
  return deepFreeze(views.map((view) => deepFreeze(view)));
}

function compileAction(field, definitionField, skillId, index) {
  const actionId = stableId("action", skillId, index, field.action.behavior);
  const toolName = `${ACTION_TOOL_PREFIX[field.action.behavior]}_${stableHash(skillId, index).slice(0, 10)}`;
  const model = buildActionModel(field, definitionField);
  const providerTool = deepFreeze({
    type: "function",
    function: {
      name: toolName,
      description: `${field.action.label}: ${field.author.label}`,
      parameters: {
        type: "object",
        properties: model.properties,
        required: model.required,
        additionalProperties: false,
      },
    },
  });
  assertFlatProviderTool(providerTool);
  return deepFreeze({
    id: actionId,
    toolName,
    label: field.action.label,
    archetype: field.action.behavior,
    providerTool,
    runtimeMapping: {
      targetFieldId: definitionField.id,
      operation: OPERATION_BY_BEHAVIOR[field.action.behavior],
      bindings: model.bindings,
      policy: "none",
    },
  });
}

function buildActionModel(field, definitionField) {
  const behavior = field.action.behavior;
  if (behavior === "adjust_number") {
    const span = Math.max(Math.abs(definitionField.minimum), Math.abs(definitionField.maximum), Math.abs(definitionField.maximum - definitionField.minimum));
    return {
      properties: { amount: numericSchema(definitionField.type, -span, span, field.author.label) },
      required: ["amount"],
      bindings: [{ argument: "amount", mode: "numeric_delta" }],
    };
  }
  if (behavior === "change_list_item") {
    return {
      properties: {
        change: { type: "string", enum: ["add", "remove"], description: field.action.label },
        item: { type: "string", maxLength: definitionField.itemMaxLength, description: field.author.label },
      },
      required: ["change", "item"],
      bindings: [{ argument: "change", mode: "list_change" }, { argument: "item", mode: "opaque_value" }],
    };
  }
  if (behavior === "append_record") return buildRecordModel(field, definitionField);
  if (behavior === "choose_enum") {
    const valueMap = Object.fromEntries(definitionField.options.map((option) => [option.label, option.value]));
    return {
      properties: { choice: { type: "string", enum: definitionField.options.map((option) => option.label), description: field.author.label } },
      required: ["choice"],
      bindings: [{ argument: "choice", mode: "exact_enum_label", valueMap }],
    };
  }
  const property = schemaForDefinitionField(definitionField, field.author.label);
  const binding = definitionField.type === "enum"
    ? {
      argument: "value",
      mode: "exact_enum_label",
      valueMap: Object.fromEntries(definitionField.options.map((option) => [option.label, option.value])),
    }
    : { argument: "value", mode: "opaque_value" };
  return { properties: { value: property }, required: ["value"], bindings: [binding] };
}

function buildRecordModel(field, definitionField) {
  const used = new Map();
  const properties = {};
  const required = [];
  const bindings = [];
  definitionField.itemFields.forEach((item, index) => {
    const base = item.type === "enum" ? "choice"
      : item.type === "boolean" ? "enabled"
        : item.type === "integer" || item.type === "number" ? "amount" : "text";
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    const argument = count === 1 ? base : `${base}_${count}`;
    properties[argument] = schemaForItemField(item, field.itemFields[index].author.label);
    required.push(argument);
    bindings.push(item.type === "enum"
      ? {
        argument,
        itemFieldId: item.id,
        mode: "exact_enum_label",
        valueMap: Object.fromEntries(item.options.map((option) => [option.label, option.value])),
      }
      : { argument, itemFieldId: item.id, mode: "opaque_value" });
  });
  return { properties, required, bindings };
}

function schemaForDefinitionField(field, description) {
  if (field.type === "integer" || field.type === "number") return numericSchema(field.type, field.minimum, field.maximum, description);
  if (field.type === "boolean") return { type: "boolean", description };
  if (field.type === "enum") return { type: "string", enum: field.options.map((option) => option.label), description };
  return { type: "string", maxLength: field.maxLength, description };
}

function schemaForItemField(field, description) {
  if (field.type === "integer" || field.type === "number") return numericSchema(field.type, field.minimum, field.maximum, description);
  if (field.type === "boolean") return { type: "boolean", description };
  if (field.type === "enum") return { type: "string", enum: field.options.map((option) => option.label), description };
  return { type: "string", maxLength: field.maxLength, description };
}

function numericSchema(type, minimum, maximum, description) {
  return { type: type === "integer" ? "integer" : "number", minimum, maximum, description };
}

function publicActionInputs(field) {
  if (field.action.behavior === "append_record") return field.itemFields.map((item) => ({ label: item.author.label, type: item.author.type }));
  if (field.action.behavior === "change_list_item") return [{ label: field.author.label, type: "list_item" }];
  if (field.action.behavior === "adjust_number") return [{ label: field.author.label, type: "number_delta" }];
  return [{ label: field.author.label, type: field.author.type }];
}

function publicViewKind(view) {
  return ({ guide: "guide", overview: "summary", recent: "recent_records", lookup: "record_search" })[view];
}

function publicBehaviorKind(behavior) {
  return ({
    set_value: "set",
    adjust_number: "adjust",
    append_record: "append",
    change_list_item: "add_or_remove",
    choose_enum: "choose",
  })[behavior];
}

function assertPublicBoundary(author, compiled) {
  const authorKeys = collectInternalKeys(author);
  const previewKeys = collectInternalKeys(compiled.publicPreview);
  assert(authorKeys.length === 0, `author input exposed internal keys: ${authorKeys.join(",")}`);
  assert(previewKeys.length === 0, `public preview exposed internal keys: ${previewKeys.join(",")}`);
  for (const tool of compiled.providerTools) {
    assert(!MODEL_SURFACE_FORBIDDEN.test(JSON.stringify(tool)), "model surface exposed Runtime protocol");
  }
  const hasState = author.fields.length > 0;
  assert(hasState === Boolean(compiled.moduleDefinition), "stateless/module compilation boundary changed");
}

function assertFlatProviderTool(tool) {
  const parameters = tool.function.parameters;
  assert(parameters.type === "object" && parameters.additionalProperties === false, "action schema must be a closed object");
  assert(Object.values(parameters.properties).every((property) => property.type !== "object" && property.type !== "array"), "action schema must stay flat");
  assert(Object.keys(parameters.properties).length >= 1 && Object.keys(parameters.properties).length <= 6, "action schema field count changed");
}

function structuralSignature(compiled) {
  return canonicalJson({
    module: compiled.moduleDefinition
      ? compiled.moduleDefinition.fields.map((field) => ({
        type: field.type,
        summary: compiled.moduleDefinition.summaryFields.includes(field.id),
        itemTypes: (field.itemFields || []).map((item) => item.type),
      }))
      : null,
    views: compiled.companion.readViews.map((view) => ({ id: view.id, projection: view.projection, query: view.query, targets: view.targetFieldIds.length })),
    actions: compiled.companion.actions.map((action) => ({
      archetype: action.archetype,
      operation: action.runtimeMapping.operation,
      args: Object.values(action.providerTool.function.parameters.properties).map((property) => ({
        type: property.type,
        enumSize: property.enum?.length || 0,
      })),
    })),
  });
}

function measureAuthorBoundary(fixture, compiled) {
  const authorText = JSON.stringify(fixture.author);
  const hiddenText = JSON.stringify({ moduleDefinition: compiled.moduleDefinition, companion: compiled.companion });
  return deepFreeze({
    name: fixture.name,
    author_controls: countLeaves(fixture.author) - 1,
    author_json_chars: authorText.length,
    author_internal_protocol_keys: collectInternalKeys(fixture.author).length,
    engine_generated_protocol_keys: collectInternalKeys({ moduleDefinition: compiled.moduleDefinition, companion: compiled.companion }).length,
    hidden_compiled_chars: hiddenText.length,
    public_preview_internal_protocol_keys: collectInternalKeys(compiled.publicPreview).length,
    model_action_fields: compiled.providerTools.map((tool) => Object.keys(tool.function.parameters.properties).length),
    model_action_max_depth: compiled.providerTools.length ? 1 : 0,
  });
}

function runRejectionCases() {
  const base = createClueFixture("zh-CN", "线索簿", "线索", "类别", "内容", "记录线索", ["人物", "地点"], "creator-negative");
  const cases = [
    ["author_tool_name", "CREATOR_INPUT_UNSUPPORTED", (draft) => { draft.toolName = "unsafe_tool"; }],
    ["author_field_id", "CREATOR_INPUT_UNSUPPORTED", (draft) => { draft.fields[0].fieldId = "private_field"; }],
    ["author_custom_code", "CREATOR_INPUT_UNSUPPORTED", (draft) => { draft.fields[0].hostAction.code = "return state"; }],
    ["author_runtime_mapping", "CREATOR_INPUT_UNSUPPORTED", (draft) => { draft.fields[0].hostAction.runtimeMapping = { path: "/tmp" }; }],
    ["recent_on_scalar", "CREATOR_VIEW_INCOMPATIBLE", (draft) => { draft.fields[0] = scalarTextField(["recent"]); }],
    ["lookup_on_scalar", "CREATOR_VIEW_INCOMPATIBLE", (draft) => { draft.fields[0] = scalarTextField(["lookup"]); }],
    ["wrong_action_for_record", "CREATOR_ACTION_INCOMPATIBLE", (draft) => { draft.fields[0].hostAction.behavior = "adjust_number"; }],
    ["duplicate_view", "CREATOR_VIEWS_INVALID", (draft) => { draft.fields[0].views = ["overview", "recent", "recent"]; }],
    ["duplicate_field_label", "CREATOR_FIELD_DUPLICATE", (draft) => { draft.fields.push(clone(draft.fields[0])); }],
    ["ambiguous_recent", "CREATOR_VIEW_AMBIGUOUS", (draft) => { draft.fields.push({ ...clone(draft.fields[0]), label: "第二组线索" }); }],
    ["empty_action_label", "CREATOR_ACTION_INVALID", (draft) => { draft.fields[0].hostAction.label = ""; }],
    ["unsupported_expression", "CREATOR_INPUT_UNSUPPORTED", (draft) => { draft.fields[0].expression = "count + 1"; }],
    ["too_many_actions", "CREATOR_ACTION_LIMIT", (draft) => {
      draft.fields = Array.from({ length: 9 }, (_, index) => ({
        ...scalarTextField(["overview"]),
        label: `状态 ${index + 1}`,
        hostAction: { label: `更新状态 ${index + 1}`, behavior: "set_value" },
      }));
    }],
  ];
  return deepFreeze(cases.map(([name, code, mutate]) => {
    const draft = clone(base.author);
    mutate(draft);
    let caught = null;
    try {
      compileCreatorDraft(draft, base.engine);
    } catch (error) {
      caught = error;
    }
    assert(caught?.code === code, `${name} expected ${code}, got ${caught?.code || "success"}`);
    return deepFreeze({ name, code, rejected: true });
  }));
}

function createPositiveFixtures() {
  return deepFreeze([
    {
      name: "zh_stateless_guide",
      family: "stateless",
      engine: { skillId: "weather-guide-zh" },
      author: {
        schemaVersion: AUTHOR_SCHEMA_VERSION,
        language: "zh-CN",
        title: "天气征兆",
        trigger: "当玩家观察天气时",
        guide: "主持人描述已经显现的天气征兆，不创建私有状态。",
        fields: [],
      },
    },
    createClueFixture("zh-CN", "线索簿", "线索", "类别", "内容", "记录线索", ["人物", "地点"], "clue-ledger-zh"),
    createClueFixture("en-US", "Clue Ledger", "Clues", "Category", "Detail", "Record clue", ["Person", "Place"], "clue-ledger-en"),
    createClueFixture("ja-JP", "手がかり帳", "手がかり", "分類", "内容", "手がかりを記録", ["人物", "場所"], "clue-ledger-ja"),
    {
      name: "en_numeric_adjust",
      family: "numeric",
      engine: { skillId: "danger-meter-en" },
      author: baseAuthor("en-US", "Danger Meter", "When danger materially changes", "Track the current bounded danger level.", [{
        label: "Danger",
        type: "integer",
        showInSummary: true,
        views: ["overview"],
        minimum: 0,
        maximum: 10,
        default: 0,
        hostAction: { label: "Adjust danger", behavior: "adjust_number" },
      }]),
    },
    {
      name: "ja_enum_choose",
      family: "enum",
      engine: { skillId: "quest-stage-ja" },
      author: baseAuthor("ja-JP", "調査段階", "調査の段階が変わる時", "現在の調査段階を記録します。", [{
        label: "段階",
        type: "enum",
        showInSummary: true,
        views: ["overview"],
        options: ["未着手", "調査中", "完了"],
        defaultOptionIndex: 0,
        hostAction: { label: "段階を選ぶ", behavior: "choose_enum" },
      }]),
    },
    {
      name: "zh_text_set",
      family: "text",
      engine: { skillId: "mood-note-zh" },
      author: baseAuthor("zh-CN", "情绪记录", "角色的当前情绪明确变化时", "保存一句当前情绪说明。", [{
        label: "当前情绪",
        type: "text",
        showInSummary: true,
        views: ["overview"],
        maxLength: 120,
        default: "平静",
        hostAction: { label: "更新情绪", behavior: "set_value" },
      }]),
    },
    {
      name: "zh_list_change",
      family: "list",
      engine: { skillId: "known-signs-zh" },
      author: baseAuthor("zh-CN", "已知征兆", "发现或排除一个征兆时", "维护当前已知的短征兆列表。", [{
        label: "征兆",
        type: "string_list",
        showInSummary: true,
        views: ["overview"],
        maxItems: 12,
        itemMaxLength: 80,
        default: [],
        hostAction: { label: "增删征兆", behavior: "change_list_item" },
      }]),
    },
  ]);
}

function createClueFixture(language, title, fieldLabel, categoryLabel, detailLabel, actionLabel, categoryOptions, skillId) {
  return {
    name: `${language}_record_append`,
    family: "clue-ledger",
    engine: { skillId },
    author: baseAuthor(language, title, `${title} trigger`, `${title} guide`, [{
      label: fieldLabel,
      type: "record_list",
      showInSummary: true,
      views: ["overview", "recent", "lookup"],
      maxItems: 30,
      itemFields: [
        { label: categoryLabel, type: "enum", options: categoryOptions },
        { label: detailLabel, type: "text", maxLength: 240 },
      ],
      hostAction: { label: actionLabel, behavior: "append_record" },
    }]),
  };
}

function baseAuthor(language, title, trigger, guide, fields) {
  return { schemaVersion: AUTHOR_SCHEMA_VERSION, language, title, trigger, guide, fields };
}

function scalarTextField(views) {
  return {
    label: "状态",
    type: "text",
    showInSummary: true,
    views,
    maxLength: 120,
    default: "",
    hostAction: { label: "更新状态", behavior: "set_value" },
  };
}

function normalizeEngineContext(value) {
  const context = requirePlainObject(value, "CREATOR_ENGINE_CONTEXT_INVALID");
  assertOnlyKeys(context, ["skillId"], "CREATOR_ENGINE_CONTEXT_INVALID");
  if (typeof context.skillId !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(context.skillId)) {
    throw creatorError("CREATOR_ENGINE_CONTEXT_INVALID", "Engine Skill identity is invalid.");
  }
  return context;
}

function normalizeOptionLabels(value, code) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw creatorError(code, "Creator options are invalid.");
  const used = new Set();
  return deepFreeze(value.map((entry) => {
    const label = requireText(entry, 120, code);
    const normalized = label.normalize("NFKC").toLocaleLowerCase("und");
    if (used.has(normalized)) throw creatorError(code, "Creator option labels must be unique.");
    used.add(normalized);
    return label;
  }));
}

function normalizeStringList(value, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) throw creatorError("CREATOR_FIELD_INVALID", "Creator list default is invalid.");
  return deepFreeze(value.map((item) => requireOptionalText(item, maxLength, "CREATOR_FIELD_INVALID")));
}

function stableId(prefix, ...parts) {
  return `${prefix}_${stableHash(...parts).slice(0, 16)}`;
}

function stableHash(...parts) {
  return crypto.createHash("sha256").update(parts.map(String).join("\n")).digest("hex");
}

function collectInternalKeys(value, found = new Set()) {
  if (!value || typeof value !== "object") return [...found].sort();
  if (Array.isArray(value)) {
    value.forEach((entry) => collectInternalKeys(entry, found));
    return [...found].sort();
  }
  for (const [key, child] of Object.entries(value)) {
    if (INTERNAL_KEY_NAMES.has(key)) found.add(key);
    collectInternalKeys(child, found);
  }
  return [...found].sort();
}

function countLeaves(value) {
  if (Array.isArray(value)) return value.reduce((total, entry) => total + countLeaves(entry), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((total, entry) => total + countLeaves(entry), 0);
  return 1;
}

function clampZero(minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, 0));
}

function requireLanguage(value) {
  if (typeof value !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) {
    throw creatorError("CREATOR_LANGUAGE_INVALID", "Creator language tag is invalid.");
  }
  return value;
}

function requireText(value, maximum, code) {
  const text = requireOptionalText(value, maximum, code).normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!text) throw creatorError(code, "Creator text is required.");
  return text;
}

function requireOptionalText(value, maximum, code) {
  if (typeof value !== "string" || Array.from(value).length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    throw creatorError(code, "Creator text is invalid.");
  }
  return value;
}

function requireFinite(value, integer, code) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000 || (integer && !Number.isInteger(value))) {
    throw creatorError(code, "Creator number is invalid.");
  }
  return value;
}

function requireInteger(value, minimum, maximum, code) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw creatorError(code, "Creator integer is invalid.");
  return value;
}

function requireBoolean(value, code) {
  if (typeof value !== "boolean") throw creatorError(code, "Creator boolean is invalid.");
  return value;
}

function requireEnum(value, allowed, code) {
  if (!allowed.has(value)) throw creatorError(code, "Creator option is invalid.");
  return value;
}

function requirePlainObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw creatorError(code, "Creator input is invalid.");
  return value;
}

function assertOnlyKeys(value, allowed, code) {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) throw creatorError(code, "Creator input contains unsupported properties.");
}

function creatorError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
