"use strict";

// Pure creator preview. No adventure store or gameplay runtime is loaded.
const { validateContract } = require("../contracts/v2");

function projectSkillModulePreview(input = {}) {
  const definition = cloneJson(input.definition);
  validateContract("skill-module-definition-v1", definition);
  if (definition.visibility !== "visible" || definition.fields.length === 0) {
    throw projectionError("SKILL_MODULE_PROJECTION_INVALID", "Creator preview supports visible stateful v1 modules only.");
  }
  const values = Object.fromEntries(definition.fields.map((field) => [
    field.id,
    Object.prototype.hasOwnProperty.call(input.values || {}, field.id)
      ? cloneJson(input.values[field.id])
      : cloneJson(field.default),
  ]));
  const panel = {
    packTitle: String(input.packTitle || "本地创作预览").trim().slice(0, 240) || "本地创作预览",
    title: String(input.title || "未命名 Skill").trim().slice(0, 240) || "未命名 Skill",
    description: String(input.description || "本地 Skill 模块预览").trim().slice(0, 1200) || "本地 Skill 模块预览",
    triggers: (Array.isArray(input.triggers) ? input.triggers : []).slice(0, 32).map((item) => String(item).trim().slice(0, 120)).filter(Boolean),
    playerGuide: typeof input.playerGuide === "string" && input.playerGuide.trim()
      ? input.playerGuide.trim().slice(0, 2000)
      : null,
    hasModule: true,
    moduleRef: "module_00000000000000000000000000000000",
    visibility: "visible",
  };
  const state = {
    activated: true,
    stateVersion: 1,
    revision: 0,
    values,
  };
  return validateProjection(projectModule(panel, definition, state, {
    fields: definition.fields,
    values: new Map(Object.entries(values)),
    pagination: null,
  }));
}

function projectModule(panel, definition, state, options = {}) {
  const fields = Array.isArray(options.fields) ? options.fields : definition.fields;
  const values = options.values instanceof Map ? options.values : null;
  const projectedFields = fields.map((field) => projectField(
    field,
    values?.has(field.id) ? values.get(field.id) : overviewValue(field, state.values[field.id]),
    state.values[field.id]
  ));
  const projectedIds = new Set(projectedFields.map((field) => field.id));
  return {
    schemaVersion: "grey-crow-skill-module-projection-v1",
    packTitle: panel.packTitle,
    title: panel.title,
    description: panel.description,
    triggers: [...panel.triggers],
    playerGuide: panel.playerGuide,
    hasModule: true,
    moduleRef: panel.moduleRef,
    visibility: panel.visibility,
    activated: state.activated === true,
    stateVersion: state.stateVersion,
    revision: state.revision,
    summary: definition.summaryFields
      .filter((fieldId) => projectedIds.has(fieldId))
      .map((fieldId) => ({
        fieldId,
        text: projectSummaryText(definition.fields.find((field) => field.id === fieldId), state.values[fieldId]),
      })),
    fields: projectedFields,
    pagination: options.pagination || null,
  };
}

function projectField(field, value, canonicalValue) {
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    widget: field.display.widget,
    value: cloneJson(value),
    derivedSummary: deriveSummary(field, canonicalValue),
    minimum: Number.isFinite(field.minimum) ? field.minimum : null,
    maximum: Number.isFinite(field.maximum) ? field.maximum : null,
    options: (field.options || []).map((option) => ({ value: option.value, label: option.label })),
    itemFields: (field.itemFields || []).map((item) => ({
      id: item.id,
      label: item.label,
      type: item.type,
      options: (item.options || []).map((option) => ({ value: option.value, label: option.label })),
    })),
  };
}

function overviewValue(field, value) {
  return field.type === "record_list" ? [] : cloneJson(value);
}

function deriveSummary(field, value) {
  if (field.type !== "record_list" || !Array.isArray(value)) return null;
  const count = value.length;
  const summary = field.display?.summary || null;
  const milestone = (summary?.milestones || [])
    .filter((entry) => entry.minimum <= count)
    .sort((left, right) => right.minimum - left.minimum)[0] || null;
  const groupFieldId = field.display?.groupCountBy;
  const groupField = (field.itemFields || []).find((entry) => entry.id === groupFieldId && entry.type === "enum");
  const counts = new Map((groupField?.options || []).map((option) => [option.value, 0]));
  if (groupField) {
    for (const item of value) {
      if (counts.has(item[groupFieldId])) counts.set(item[groupFieldId], counts.get(item[groupFieldId]) + 1);
    }
  }
  return {
    count,
    target: summary?.mode === "count_progress" ? summary.target : null,
    milestoneLabel: milestone?.label || null,
    groupCounts: (groupField?.options || []).map((option) => ({
      value: option.value,
      label: option.label,
      count: counts.get(option.value) || 0,
    })),
  };
}

function projectSummaryText(field, value) {
  if (!field) return "状态未确认";
  if (field.type === "record_list" || field.type === "string_list") {
    const count = Array.isArray(value) ? value.length : 0;
    const derived = deriveSummary(field, value);
    const progress = derived?.target ? `${count}/${derived.target}` : `${count}`;
    return [field.label, progress, derived?.milestoneLabel].filter(Boolean).join(" · ").slice(0, 160);
  }
  if (field.type === "enum") {
    const label = field.options.find((option) => option.value === value)?.label || String(value);
    return `${field.label} · ${label}`.slice(0, 160);
  }
  if (field.type === "boolean") return `${field.label} · ${value ? "已开启" : "未开启"}`;
  if ((field.type === "integer" || field.type === "number") && field.display.widget !== "number") {
    return `${field.label} · ${value}/${field.maximum}`.slice(0, 160);
  }
  return `${field.label} · ${String(value)}`.slice(0, 160);
}

function validateProjection(value) {
  try {
    validateContract("skill-module-projection-v1", value);
  } catch {
    throw projectionError("SKILL_MODULE_PROJECTION_INVALID", "Skill module Renderer projection is invalid.");
  }
  return deepFreeze(value);
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
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

module.exports = { projectSkillModulePreview };
