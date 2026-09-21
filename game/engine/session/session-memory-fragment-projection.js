"use strict";

const { createHash } = require("node:crypto");
const { validateContract } = require("../contracts/v2");
const { validateMemoryFragments } = require("./session-memory-fragments");

const MEMORY_FRAGMENT_PANEL = "session-memory-fragments";
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const LOCALES = ["zh-CN", "en-US", "ja-JP"];
const RECORD_FIELDS = ["game_day", "discovery_mode", "dimension", "trigger", "content", "certainty"];
function fail(code = "MEMORY_FRAGMENT_PROJECTION_INVALID") { throw Object.assign(new Error(code), { code }); }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32); }
function identity(view) { return { adventureId: view.adventureId, revision: view.revision, actionId: view.actionId ?? null }; }
function field(id, label, kind, value, minimum = null, maximum = null) { return { id, label, kind, value, minimum, maximum }; }
function check(contract, value) { try { validateContract(contract, value); } catch { fail(); } return value; }
function option(meta, value) { const found = meta.options?.find((entry) => entry.value === value); if (!found) fail(); return found.label; }

function readContext(view, input) {
  const metadata = input.memoryFragmentSkill;
  if (metadata == null) return null;
  if (!view || !ID.test(view.adventureId || "") || !Number.isSafeInteger(view.revision) || view.revision < 0
    || !view.state || (view.actionId != null && !ID.test(view.actionId))) fail();
  const language = input.displayLocale ?? view.locale;
  if (!LOCALES.includes(language) || metadata.language !== language || metadata.itemId !== "memory-fragment"
    || !/^[a-z][a-z0-9-]{1,63}$/.test(metadata.packId || "") || !ID.test(metadata.moduleRef || "")) fail();
  const definition = check("skill-module-definition-v1", metadata.definition);
  const fragments = definition.fields.find((entry) => entry.id === "fragments");
  const resolution = definition.fields.find((entry) => entry.id === "revelation_status");
  if (fragments?.type !== "record_list" || fragments.maxItems !== 30 || resolution?.type !== "enum") fail();
  const itemFields = RECORD_FIELDS.map((id) => fragments.itemFields?.find((entry) => entry.id === id));
  if (itemFields.some((entry) => !entry)) fail();
  const context = { view, metadata, language, fragments, resolution, itemFields };
  Object.assign(context, readRecords(view));
  context.values = context.records.map((record) => ({ game_day: record.day, discovery_mode: record.mode,
    dimension: record.dimension, trigger: record.trigger, content: record.content, certainty: "uncertain" }));
  context.count = context.records.length;
  const milestones = fragments.display?.summary?.milestones;
  if (!Array.isArray(milestones) || !milestones.length) fail();
  context.milestone = [...milestones].reverse().find((entry) => entry.minimum <= context.count)?.label;
  if (!context.milestone) fail();
  context.choice = option(resolution, context.revelationStatus);
  context.uncertain = option(itemFields.find((entry) => entry.id === "certainty"), "uncertain");
  context.groups = itemFields.find((entry) => entry.id === "dimension").options.map((entry) => ({
    value: entry.value, label: entry.label, count: context.values.filter((record) => record.dimension === entry.value).length,
  }));
  context.summary = [
    { id: "fragments", label: fragments.label, text: `${context.count}/30 · ${context.milestone}` },
    { id: "revelation_status", label: resolution.label, text: context.choice },
  ];
  return context;
}

// The source adapter is deliberately separate from the existing module's
// display field names. Its values never become independently mutable module state.
function readRecords(view) {
  try { validateMemoryFragments(view.state); } catch { fail(); }
  const state = view.state.memoryFragments;
  if (state == null) return { records: [], revelationStatus: "collecting", resolutionSources: { unlockedAt: null, decision: null } };
  if (!Array.isArray(state.fragments) || state.fragments.length > 30
    || !["collecting", "available", "deferred", "accepted", "sealed"].includes(state.revelationStatus)) fail();
  const records = state.fragments.map((record) => {
    if (!record || !/^fragment-([1-9]|[12][0-9]|30)$/.test(record.id || "")
      || !Number.isSafeInteger(record.gameDay) || record.gameDay < 0 || record.gameDay > 1000000000
      || !["active_recall", "passive_association"].includes(record.discoveryMode)
      || !["body", "emotion", "skill", "identity"].includes(record.dimension)
      || typeof record.trigger !== "string" || !record.trigger.trim() || [...record.trigger].length > 160
      || typeof record.content !== "string" || !record.content.trim() || [...record.content].length > 500 || record.certainty !== "uncertain") fail();
    return { id: record.id, day: record.gameDay, mode: record.discoveryMode, dimension: record.dimension,
      trigger: record.trigger, content: record.content, source: safeSource(record.source, view.revision) };
  });
  if (new Set(records.map((record) => record.id)).size !== records.length) fail();
  const unlockedAt = state.unlockedAt == null ? null : safeSource(state.unlockedAt, view.revision);
  const decision = state.decision == null ? null : { choice: state.decision.choice, source: safeSource(state.decision.source, view.revision) };
  if (decision && !["deferred", "accepted", "sealed"].includes(decision.choice)) fail();
  if ((records.length < 30 && (state.revelationStatus !== "collecting" || unlockedAt || decision))
    || (records.length === 30 && (state.revelationStatus === "collecting" || !unlockedAt))
    || (["deferred", "accepted", "sealed"].includes(state.revelationStatus) && decision?.choice !== state.revelationStatus)) fail();
  return { records, revelationStatus: state.revelationStatus, resolutionSources: { unlockedAt, decision } };
}
function safeSource(value, revision) {
  if (!value || !ID.test(value.adventureId || "") || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > revision
    || !ID.test(value.eventId || "") || !Array.isArray(value.sourceSegmentIds) || !value.sourceSegmentIds.length
    || value.sourceSegmentIds.length > 256 || value.sourceSegmentIds.some((id) => !ID.test(id || ""))) fail();
  return { adventureId: value.adventureId, revision: value.revision, eventId: value.eventId, sourceSegmentIds: [...value.sourceSegmentIds] };
}

function descriptor(context) {
  const { metadata, language } = context;
  return check("skill-panel-presentation-v2", { schemaVersion: "grey-crow-skill-panel-presentation-v2", panels: [{
    panelRef: MEMORY_FRAGMENT_PANEL, sourceKind: "ordinary_skill", ownership: metadata.ownership ?? "built_in", group: "adventure_gameplay",
    sortOrder: 3, title: metadata.title, language, description: metadata.description, triggers: [...(metadata.triggers || [])],
    playerGuide: metadata.playerGuide, surface: "timeline", ordinarySource: { packId: metadata.packId, itemId: "memory-fragment",
      hasModule: true, moduleRef: metadata.moduleRef, visibility: "visible" }, domainSource: null,
  }] }).panels[0];
}
function projectMemoryFragmentDescriptor(view, input = {}) {
  const context = readContext(view, input);
  return context ? descriptor(context) : null;
}
function recordRef(context, record) { return `fragment_${hash([context.view.adventureId, record.id])}`; }
function paginate(context, input) {
  const limit = input.limit ?? 12;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 24) fail("SKILL_PANEL_VIEW_INVALID");
  const cursor = (offset) => `page_${offset}_${hash([context.view.adventureId, context.view.revision, MEMORY_FRAGMENT_PANEL, context.language, offset])}`;
  let offset = 0;
  if (input.cursor != null) {
    const match = /^page_([0-9]{1,2})_[a-f0-9]{32}$/.exec(input.cursor);
    if (!match) fail("SKILL_PANEL_CURSOR_INVALID");
    offset = Number(match[1]);
    if (input.cursor !== cursor(offset) || offset >= context.count) fail("SKILL_PANEL_CURSOR_INVALID");
  }
  const records = context.records.slice(offset, offset + limit);
  const next = offset + records.length;
  return { records, values: context.values.slice(offset, next), pagination: {
    nextCursor: next < context.count ? cursor(next) : null, hasMore: next < context.count,
    returnedItems: records.length, totalItems: context.count,
  } };
}
function sources(context, records) {
  return records.map((record) => ({ itemRef: recordRef(context, record), fragmentId: record.id,
    source: structuredClone(record.source) }));
}
function displayRecord(context, record) {
  const value = context.values[context.records.indexOf(record)];
  // Reading a fragment starts with its complete prose; metadata follows it.
  const displayOrder = ["content", "trigger", "game_day", "discovery_mode", "dimension", "certainty"];
  return displayOrder.map((id) => context.itemFields.find((meta) => meta.id === id)).map((meta) => field(meta.id, meta.label,
    meta.type === "enum" ? "badge" : meta.type === "integer" ? "number" : "text",
    meta.type === "enum" ? option(meta, value[meta.id]) : value[meta.id],
    meta.type === "integer" ? 0 : null, meta.type === "integer" ? 1000000000 : null));
}
function recordTitle(context, record) {
  return `${context.fragments.label} · ${context.records.indexOf(record) + 1}`;
}
function projectMemoryFragmentPanel(view, input = {}) {
  const context = readContext(view, input);
  if (!context || input.panelRef !== MEMORY_FRAGMENT_PANEL) fail("SKILL_PANEL_NOT_SELECTED");
  const info = descriptor(context);
  const requested = input.view ?? "overview";
  if (!["overview", "list", "detail"].includes(requested)) fail("SKILL_PANEL_VIEW_INVALID");
  const panel = { schemaVersion: "grey-crow-skill-panel-view-projection-v1", panelRef: info.panelRef,
    sourceKind: info.sourceKind, ownership: info.ownership, group: info.group, surface: "timeline", view: requested,
    title: info.title, status: context.count ? "ready" : "empty", summary: context.summary,
    fields: [], items: [], detail: null, pagination: null };
  let records = [];
  if (requested === "overview") {
    if (input.fieldId != null || input.itemRef != null || input.cursor != null || input.limit !== undefined) fail("SKILL_PANEL_VIEW_INVALID");
    panel.fields = [field("fragments", context.fragments.label, "progress", context.count, 0, 30),
      field("revelation_status", context.resolution.label, "badge", context.choice),
      field("dimensions", context.itemFields.find((entry) => entry.id === "dimension").label, "chips", context.groups.map((entry) => `${entry.label}: ${entry.count}`)),
      field("certainty", context.itemFields.find((entry) => entry.id === "certainty").label, "badge", context.uncertain)];
  } else {
    if (input.fieldId !== "fragments") fail("SKILL_PANEL_FIELD_UNKNOWN");
    if (requested === "list") {
      if (input.itemRef != null) fail("SKILL_PANEL_VIEW_INVALID");
      const page = paginate(context, input); records = page.records; panel.pagination = page.pagination;
      panel.items = records.map((record) => ({ ref: recordRef(context, record), title: recordTitle(context, record),
        subtitle: record.trigger,
        statusLabel: `${option(context.itemFields.find((entry) => entry.id === "dimension"), record.dimension)} · ${context.uncertain}`, updatedTurn: null }));
    } else {
      if (input.cursor != null || input.limit !== undefined) fail("SKILL_PANEL_VIEW_INVALID");
      const record = context.records.find((entry) => recordRef(context, entry) === input.itemRef);
      if (!record) fail("SKILL_PANEL_ITEM_NOT_FOUND");
      records = [record];
      panel.detail = { ref: recordRef(context, record), title: recordTitle(context, record), subtitle: context.uncertain,
        sections: [{ id: "fragment", title: context.fragments.label, fields: displayRecord(context, record), records: [] }] };
    }
  }
  return { ...identity(view), supported: true, panel: check("skill-panel-view-projection-v1", panel), sources: sources(context, records), resolutionSources: structuredClone(context.resolutionSources) };
}
function moduleField(meta, value, derivedSummary = null) {
  return { id: meta.id, label: meta.label, type: meta.type, widget: meta.display.widget, value, derivedSummary,
    minimum: meta.minimum ?? null, maximum: meta.maximum ?? null, options: structuredClone(meta.options || []),
    itemFields: (meta.itemFields || []).map((entry) => ({ id: entry.id, label: entry.label, type: entry.type, options: structuredClone(entry.options || []) })) };
}
function projectMemoryFragmentModule(view, input = {}) {
  const context = readContext(view, input);
  if (!context) fail("SKILL_PANEL_NOT_SELECTED");
  descriptor(context);
  const { metadata } = context;
  let records = []; let values = []; let pagination = null;
  if (input.fieldId !== undefined) {
    if (input.fieldId !== "fragments") fail("SKILL_PANEL_FIELD_UNKNOWN");
    const page = paginate(context, input); records = page.records; values = page.values;
    pagination = { fieldId: "fragments", ...page.pagination };
  } else if (input.cursor != null || input.limit !== undefined) fail("SKILL_PANEL_VIEW_INVALID");
  const fragments = moduleField(context.fragments, values, { count: context.count, target: 30, milestoneLabel: context.milestone, groupCounts: context.groups });
  const module = { schemaVersion: "grey-crow-skill-module-projection-v1", packTitle: metadata.packTitle, title: metadata.title,
    description: metadata.description, triggers: [...(metadata.triggers || [])], playerGuide: metadata.playerGuide,
    hasModule: true, moduleRef: metadata.moduleRef, visibility: "visible", activated: true, stateVersion: 1, revision: view.revision,
    summary: context.summary.filter((entry) => !input.fieldId || entry.id === input.fieldId).map((entry) => ({ fieldId: entry.id, text: entry.text })),
    fields: input.fieldId ? [fragments] : [fragments, moduleField(context.resolution, context.revelationStatus)], pagination };
  return { ...identity(view), module: check("skill-module-projection-v1", module), sources: sources(context, records), resolutionSources: structuredClone(context.resolutionSources) };
}

module.exports = { MEMORY_FRAGMENT_PANEL, projectMemoryFragmentDescriptor, projectMemoryFragmentPanel, projectMemoryFragmentModule };
