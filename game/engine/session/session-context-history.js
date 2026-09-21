"use strict";

const { createHash } = require("node:crypto");
const { COMPACTION_QUOTE_FORMAT, createCompactionQuotes, validateCompactionQuotes } = require("./session-compaction-quotes");

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const fail = (code = "CONTEXT_SOURCE_UNAVAILABLE") => { throw Object.assign(new Error(code), { code }); };
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const identifier = (value) => typeof value === "string" && ID.test(value);
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function copyData(value) {
  let nodes = 0;
  const ancestors = new Set();
  function copy(item, depth) {
    if (++nodes > 1_000_000 || depth > 48) fail();
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || ancestors.has(item)
      || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) fail();
    ancestors.add(item);
    const result = Array.isArray(item) ? [] : {};
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === "length") continue;
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
        || !field?.enumerable || !Object.hasOwn(field, "value")) fail();
      result[key] = copy(field.value, depth + 1);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length) fail();
    ancestors.delete(item);
    return result;
  }
  const result = copy(value, 0);
  const serialized = JSON.stringify(result);
  if (serialized.length > 8_000_000 || Buffer.byteLength(serialized) > 8_384_512) fail("CONTEXT_HISTORY_TOO_LARGE");
  return result;
}

function fields(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) fail();
}

function contextSourceRef(source) {
  return { adventureId: source.adventureId, revision: source.revision, segmentId: source.segmentId,
      ...(source.experienceId === undefined ? {} : { experienceId: source.experienceId }) };
}
function contextSourceKey(source) { return JSON.stringify(contextSourceRef(source)); }
function summaryData(value, systemRevisions) {
  if (value === null) return null;
  fields(value, ["summaryId", "fromRevision", "throughRevision", "format", "items"]);
  if (!identifier(value.summaryId) || value.fromRevision !== 1 || !integer(value.throughRevision, 1)
    || value.format !== COMPACTION_QUOTE_FORMAT) fail();
  let quotes;
  try { quotes = validateCompactionQuotes({ format: value.format, items: value.items }); }
  catch { fail(); }
  for (const { source } of quotes.items) {
    if (source.revision < value.fromRevision || source.revision > value.throughRevision
      || systemRevisions.has(source.revision)) fail();
  }
  return { summaryId: value.summaryId, fromRevision: value.fromRevision, throughRevision: value.throughRevision, ...quotes };
}

function normalizeHistory(value, prefix = null) {
  const history = copyData(value);
  fields(history, ["adventureId", "revision", "viewerId", "contextGeneration", "materializationId", "sourceHash", "summary",
    "summaryValidity", "turns", "timeline"], ["continuation"]);
  if (!identifier(history.adventureId) || !integer(history.revision) || !integer(history.contextGeneration)
    || (history.viewerId !== null && !identifier(history.viewerId)) || !digest(history.materializationId)
    || !digest(history.sourceHash) || !["none", "valid", "invalidated"].includes(history.summaryValidity)
    || (history.summaryValidity === "valid") !== (history.summary !== null) || !Array.isArray(history.turns)) fail();
  fields(history.timeline, ["systemRevisions", "storyTurnCount"]);
  const revisions = history.timeline.systemRevisions;
  if (!Array.isArray(revisions) || revisions.some((revision, index) => !integer(revision, 1)
    || revision > history.revision || (index && revisions[index - 1] >= revision))
    || history.timeline.storyTurnCount !== history.revision - revisions.length) fail();
  const systems = new Set(revisions);
  history.summary = summaryData(history.summary, systems);
  if (history.summary && history.summary.throughRevision > history.revision) fail();
  let expected = (prefix?.throughRevision ?? history.summary?.throughRevision ?? 0) + 1;
  for (const turn of history.turns) {
    while (systems.has(expected)) expected++;
    fields(turn, ["revision", "actionId", "input", "narration"], ["source", "storyTurn"]);
    if (turn.revision !== expected || !identifier(turn.actionId) || typeof turn.input !== "string"
      || !Array.isArray(turn.narration) || !turn.narration.length) fail();
    if (turn.source !== undefined) {
      fields(turn.source, ["adventureId", "revision"]);
      if (!identifier(turn.source.adventureId) || turn.source.revision !== turn.revision) fail();
    }
    if (turn.storyTurn !== undefined && turn.storyTurn !== turn.revision - revisions.filter((r) => r <= turn.revision).length) fail();
    const seen = new Set();
    for (const segment of turn.narration) {
      fields(segment, ["id", "text"]);
      if (!identifier(segment.id) || seen.has(segment.id) || typeof segment.text !== "string" || !segment.text.trim()) fail();
      seen.add(segment.id);
    }
    expected++;
  }
  while (systems.has(expected)) expected++;
  if (expected !== history.revision + 1) fail();
  return history;
}

function normalizeContextHistory(value) { return normalizeHistory(value); }

function normalizeCompactionManifest(value) {
  const manifest = copyData(value);
  fields(manifest, ["kind", "history", "range", "replacedCount", "fullHistoryCounts"], ["candidateHistory"]);
  if (manifest.kind !== "streamed_context" || !integer(manifest.replacedCount)) fail();
  const range = manifest.range;
  if (range !== null) {
    fields(range, ["fromRevision", "throughRevision"]);
    if (range.fromRevision !== 1 || !integer(range.throughRevision, 1) || range.throughRevision > manifest.history.revision) fail();
  }
  manifest.history = normalizeHistory(manifest.history, range);
  const history = manifest.history;
  const nativeFrom = history.summary?.throughRevision ?? 0;
  const total = history.revision - nativeFrom - history.timeline.systemRevisions.filter((revision) => revision > nativeFrom).length;
  const retained = history.turns.length;
  if (retained !== Math.min(2, total) || manifest.replacedCount !== total - retained
    || (range !== null) !== (manifest.replacedCount > 0)) fail();
  fields(manifest.fullHistoryCounts, ["ascii", "other", "characters", "bytes"]);
  if (Object.values(manifest.fullHistoryCounts).some((value) => !integer(value))) fail();
  if (manifest.candidateHistory) manifest.candidateHistory = normalizeContextHistory(manifest.candidateHistory);
  return manifest;
}

function planStreamedContext({ manifest: raw, estimate, estimateFull, binding }) {
  const manifest = normalizeCompactionManifest(raw), history = manifest.history;
  const before = estimateFull(manifest);
  const first = history.turns[0]?.revision ?? null;
  const baseline = estimate({ coverage: { fromRevision: first, throughRevision: history.revision,
    omittedBeforeRevision: first, systemRevisions: history.timeline.systemRevisions }, summary: null, turns: history.turns });
  return { adventureId: history.adventureId, revision: history.revision, viewerId: history.viewerId,
    sourceHash: history.sourceHash, contextGeneration: history.contextGeneration, materializationId: history.materializationId,
    settingsIdentity: before.settingsIdentity, planId: contextMaterializationId({ manifest, binding }),
    status: !baseline.fits ? "baseline_too_large" : !manifest.range ? "not_needed" : "ready",
    before, baseline, range: manifest.range, previousSummary: history.summary, streamed: true, turns: [],
    retainedTurnRevisions: history.turns.map((turn) => turn.revision) };
}

function contextMaterializationId(history) {
  return createHash("sha256").update(JSON.stringify(history)).digest("hex");
}

function projectContextHistory(history) {
  // Quote IDs are compactor selection handles, not information needed by the
  // story host. Keep them in the validated history and subsequent plans only.
  const summary = history.summary === null ? null : { ...history.summary,
    items: history.summary.items.map(({ text, source, range }) => ({ text, source: { ...source }, range: { ...range } })) };
  return { coverage: { fromRevision: history.revision ? 1 : null, throughRevision: history.revision,
    omittedBeforeRevision: null, systemRevisions: history.timeline.systemRevisions },
  summary, turns: history.turns };
}

// Only automatic related-memory presentation uses this projection. Its input
// has already passed the memory reader's fixed-view knowledge/correction checks.
// Never infer coverage from a summary's revision span or a streamed manifest.
function projectAutomaticRelated({ related, history, adventureId }) {
  const projected = copyData(related);
  const coverage = new Map();
  function sourceKey(source) {
    if (!source || !identifier(source.adventureId) || !integer(source.revision, 1)
      || !["player_input", "narration"].includes(source.kind)
      || (source.kind === "narration" ? !identifier(source.segmentId) : Object.hasOwn(source, "segmentId"))) return null;
    return JSON.stringify([source.adventureId, source.revision, source.kind, source.segmentId ?? null]);
  }
  function rangeMatches(value) {
    return typeof value?.text === "string" && integer(value.start) && integer(value.end, 1)
      && value.end > value.start && value.text.length === value.end - value.start;
  }
  function add(source, value) {
    const key = sourceKey(source);
    if (key === null || !rangeMatches(value)) return;
    if (!coverage.has(key)) coverage.set(key, []);
    coverage.get(key).push(value);
  }
  for (const turn of history?.turns ?? []) {
    if (!integer(turn?.revision, 1) || (turn.source !== undefined
      && (!identifier(turn.source?.adventureId) || turn.source.revision !== turn.revision))) continue;
    const origin = { adventureId: turn.source?.adventureId ?? adventureId, revision: turn.revision };
    if (typeof turn.input === "string") add({ ...origin, kind: "player_input" }, { text: turn.input, start: 0, end: turn.input.length });
    for (const segment of turn.narration ?? []) {
      if (typeof segment?.text === "string") add({ ...origin, kind: "narration", segmentId: segment.id },
        { text: segment.text, start: 0, end: segment.text.length });
    }
  }
  if (history?.summary?.format === COMPACTION_QUOTE_FORMAT) {
    for (const item of history.summary.items ?? []) {
      if (!integer(item?.range?.totalCharacters, 1) || item.range.end > item.range.totalCharacters) continue;
      add(item.source, { ...item.range, text: item.text });
    }
  }
  for (const ranges of coverage.values()) ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  function reference(value, source) {
    if (!rangeMatches(value) || Object.hasOwn(value, "historyRef")) return value;
    const ranges = coverage.get(sourceKey(source));
    if (!ranges) return value;
    let next = value.start;
    for (const range of ranges) {
      if (range.end <= next) continue;
      if (range.start > next) break;
      const end = Math.min(range.end, value.end);
      // Identity and offsets establish the match; exact text is a defensive
      // consistency check, never a way to merge different roles or adventures.
      if (range.text.slice(next - range.start, end - range.start) !== value.text.slice(next - value.start, end - value.start)) return value;
      next = end;
      if (next === value.end) {
        const { text, ...metadata } = value;
        // The existing record/slot already carries its origin, role, segment
        // and range. A marker refers to that source without repeating its IDs.
        const replacement = { ...metadata, historyRef: true };
        // Related JSON is itself serialized inside message.content. Count both
        // layers: reference keys add escaped quotes to the complete request.
        return JSON.stringify(JSON.stringify(replacement)).length < JSON.stringify(JSON.stringify(value)).length ? replacement : value;
      }
    }
    return value;
  }
  for (const record of projected.results ?? []) {
    if (!record || typeof record !== "object") continue;
    const origin = { adventureId: record.source?.adventureId, revision: record.source?.revision };
    if (record.playerInput?.kind === "player_input") {
      record.playerInput = reference(record.playerInput, { ...origin, kind: "player_input" });
    }
    if (Array.isArray(record.passages)) record.passages = record.passages.map((passage) =>
      reference(passage, { ...origin, kind: "narration", segmentId: passage?.id }));
    if (Array.isArray(record.supportingPassages)) record.supportingPassages = record.supportingPassages.map((passage) =>
      passage?.kind === "opening_summary" ? reference(passage, { adventureId: passage.adventureId,
        revision: passage.revision, kind: "narration", segmentId: passage.segmentId }) : passage);
  }
  return projected;
}

// The estimate callback assembles the complete request for each candidate
// history, including its matching automatic-recall coverage projection. State,
// tools and the current input remain fixed; history and recall slots can vary.
function planContextHistory({ history: raw, estimate, binding }) {
  const history = normalizeContextHistory(raw);
  const chronological = history.turns;
  const retainedAll = chronological.slice(-2);
  const replacedAll = chronological.slice(0, Math.max(0, chronological.length - 2));
  const retained = retainedAll.filter((turn) => turn.revision !== undefined);
  const replaced = replacedAll.filter((turn) => turn.revision !== undefined);
  const before = estimate(projectContextHistory(history));
  const baseline = estimate({ coverage: { fromRevision: retained[0]?.revision ?? null,
    throughRevision: history.revision, omittedBeforeRevision: retained[0]?.revision ?? null,
    systemRevisions: history.timeline.systemRevisions }, summary: null, turns: retained });
  const range = replacedAll.length ? { fromRevision: 1, throughRevision: replaced.at(-1).revision } : null;
  const planId = contextMaterializationId({ history, binding });
  return { adventureId: history.adventureId, revision: history.revision,
    viewerId: history.viewerId, sourceHash: history.sourceHash,
    contextGeneration: history.contextGeneration, materializationId: history.materializationId,
    settingsIdentity: before.settingsIdentity, planId,
    status: !baseline.fits ? "baseline_too_large" : !range ? "not_needed" : "ready",
    before, baseline, range, previousSummary: history.summary, turns: replaced,
    retainedTurnRevisions: retained.map((turn) => turn.revision) };
}

function previewContextHistory({ history: raw, estimate, binding, planId, summary: candidate }) {
  const history = normalizeContextHistory(raw);
  const plan = planContextHistory({ history, estimate, binding });
  if (plan.planId !== planId) fail("CONTEXT_PLAN_STALE");
  if (!plan.range) fail("CONTEXT_PLAN_INVALID");
  const summary = summaryData(copyData(candidate), new Set(history.timeline.systemRevisions));
  if (!summary || summary.fromRevision !== plan.range.fromRevision || summary.throughRevision !== plan.range.throughRevision
    || summary.summaryId === history.summary?.summaryId) fail("CONTEXT_PLAN_INVALID");
  // Earlier source-validated quotes may survive another compaction. New quotes
  // must exactly match program-selected ranges of the committed prefix; a
  // plausible source ID does not authorize rewritten text or arbitrary slices.
  const allowedQuotes = new Map((history.summary?.items ?? []).map((quote) => [quote.quoteId, quote]));
  for (const turn of plan.turns) {
    const origin = { adventureId: turn.source?.adventureId ?? history.adventureId, revision: turn.revision };
    for (const segment of turn.narration) {
      for (const quote of createCompactionQuotes({ ...origin, segmentId: segment.id, text: segment.text })) allowedQuotes.set(quote.quoteId, quote);
    }
    // Preserve what the player actually supplied even when the host did not
    // repeat it. Its distinct source kind never turns an intention into a result.
    if (turn.input.length) for (const quote of createCompactionQuotes({ ...origin, kind: "player_input", text: turn.input })) {
      allowedQuotes.set(quote.quoteId, quote);
    }
  }
  try { validateCompactionQuotes({ format: summary.format, items: summary.items }, allowedQuotes); }
  catch { fail("CONTEXT_PLAN_INVALID"); }
  const after = estimate(projectContextHistory({ ...history, summary,
    turns: history.turns.filter((turn) => plan.retainedTurnRevisions.includes(turn.revision)) }));
  const savedSafetyInputTokens = plan.before.latestEstimate.safetyInputTokens - after.latestEstimate.safetyInputTokens;
  return { adventureId: history.adventureId, revision: history.revision, planId,
    contextGeneration: history.contextGeneration, materializationId: plan.materializationId,
    settingsIdentity: plan.settingsIdentity, status: plan.status === "baseline_too_large" ? plan.status
      : after.fits && savedSafetyInputTokens > 0 ? "reduced" : "no_benefit",
    before: plan.before, after, savedSafetyInputTokens };
}

module.exports = { normalizeContextHistory, projectContextHistory, projectAutomaticRelated, contextMaterializationId, planContextHistory, previewContextHistory,
  contextSourceKey, contextSourceRef, normalizeCompactionManifest, planStreamedContext };
