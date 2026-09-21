"use strict";

const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { PROVIDER_ERROR_CODES } = require("./session-provider-error");

const EXECUTION_FORMAT = "session-execution-1";
const EXECUTION_MAX_BYTES = 65536;
const EXECUTION_MAX_STEPS = 256;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const HASH = /^[a-f0-9]{64}$/;
const TOKENS = ["input_tokens", "output_tokens", "total_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens", "reasoning_tokens"];
const TOOLS = ["read_entity", "recall_memory", "read_memory_fragments", "read_narrative_module", "unknown"];
const FINISH = ["stop", "length", "tool_calls", "content_filter", "insufficient_system_resource", "unknown"];
const REPAIRS = ["json_syntax", "validation", "tool_feedback", "terminal_intent", "fragment_unavailable", "fragment_guide_missing", "detached_fragment", "finale_unavailable", "extreme_unavailable"];
const TOOL_CODES = ["TOOL_NOT_AVAILABLE", "TOOL_ARGUMENTS_INVALID", "ENTITY_NOT_AVAILABLE", "CONDITION_RECORD_NOT_AVAILABLE", "MEMORY_SOURCE_UNAVAILABLE", "TOOL_FAILED"];

function fields(value, allowed, required = allowed) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !allowed.includes(key)
    || !Object.hasOwn(descriptors[key], "value")) || required.some(key => !Object.hasOwn(descriptors, key))) throw new Error();
  return Object.fromEntries(Object.entries(descriptors).map(([key, item]) => [key, item.value]));
}
function integer(value, min = 0) { if (!Number.isSafeInteger(value) || value < min) throw new Error(); return value; }
function oneOf(value, values) { if (!values.includes(value)) throw new Error(); return value; }
function boolean(value) { if (typeof value !== "boolean") throw new Error(); return value; }
function identifier(value) { if (typeof value !== "string" || !ID.test(value)) throw new Error(); return value; }
function hash(value) { if (typeof value !== "string" || !HASH.test(value)) throw new Error(); return value; }
function usage(value) {
  if (value === null) return null;
  const selected = fields(value, TOKENS, []);
  for (const key of Object.keys(selected)) integer(selected[key]);
  return selected;
}
function request(value) {
  const out = fields(value, ["sha256", "characters", "bytes", "estimatedInputTokens", "safetyInputTokens", "contextGeneration", "maxOutputTokens", "settingsIdentity"]);
  hash(out.sha256); hash(out.settingsIdentity);
  for (const key of ["characters", "bytes", "estimatedInputTokens", "safetyInputTokens", "contextGeneration"]) integer(out[key]);
  integer(out.maxOutputTokens, 1);
  return out;
}
function step(value) {
  const base = ["seq", "kind", "outcome", "elapsedMs"];
  const out = fields(value, [...base, "callIndex", "toolIndex", "toolName", "request", "usage", "usageComplete", "finishReason", "durationMs", "resultCode", "resultCharacters", "reason"], base);
  integer(out.seq, 1); integer(out.elapsedMs);
  const extra = [];
  if (out.kind === "model") {
    oneOf(out.outcome, ["invoked", "returned", "failed"]); integer(out.callIndex, 1); extra.push("callIndex");
    if (out.outcome === "invoked") { out.request = request(out.request); extra.push("request"); }
    else {
      integer(out.durationMs); extra.push("durationMs");
      if (out.outcome === "returned") {
        out.usage = usage(out.usage); boolean(out.usageComplete);
        if (out.usageComplete && (!out.usage || !Object.hasOwn(out.usage, "input_tokens") || !Object.hasOwn(out.usage, "output_tokens"))) throw new Error();
        if (out.finishReason !== null) oneOf(out.finishReason, FINISH);
        extra.push("usage", "usageComplete", "finishReason");
      } else if (Object.hasOwn(out, "resultCode")) {
        oneOf(out.resultCode, [...PROVIDER_ERROR_CODES, "TURN_GENERATION_FAILED"]);
        extra.push("resultCode");
      }
    }
  } else if (out.kind === "tool") {
    oneOf(out.outcome, ["invoked", "returned", "failed"]);
    integer(out.callIndex, 1); integer(out.toolIndex, 1); oneOf(out.toolName, TOOLS);
    extra.push("callIndex", "toolIndex", "toolName");
    if (out.outcome !== "invoked") {
      integer(out.durationMs); extra.push("durationMs", "resultCode");
      if (out.resultCode !== null) oneOf(out.resultCode, TOOL_CODES);
      if (out.outcome === "returned") { integer(out.resultCharacters); extra.push("resultCharacters"); }
    }
  } else if (out.kind === "repair") {
    oneOf(out.outcome, ["requested"]); oneOf(out.reason, REPAIRS); integer(out.callIndex, 1);
    extra.push("reason", "callIndex");
  } else if (out.kind === "context_recovery") {
    oneOf(out.outcome, ["requested", "reduced", "not_reduced", "failed"]); integer(out.callIndex, 1);
    extra.push("callIndex");
    if (out.outcome !== "requested") { integer(out.durationMs); extra.push("durationMs"); }
  } else throw new Error();
  if (Object.keys(out).some(key => !base.includes(key) && !extra.includes(key))) throw new Error();
  return out;
}

// Shared with the durable diagnostic reader/writer. Reject unknown fields,
// accessors and raw strings rather than trusting a generic secret scrubber.
function sanitizeExecutionSnapshot(value) {
  try {
    const out = fields(value, ["format", "phase", "adventureId", "actionId", "attemptId", "baseRevision", "startedAt", "lastSequence", "truncated", "steps"]);
    if (out.format !== EXECUTION_FORMAT || out.phase !== "story_generation") return null;
    if (out.adventureId !== null) identifier(out.adventureId);
    identifier(out.actionId); identifier(out.attemptId); integer(out.baseRevision); integer(out.lastSequence); boolean(out.truncated);
    if (typeof out.startedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(out.startedAt)
      || !Number.isFinite(Date.parse(out.startedAt)) || !Array.isArray(out.steps) || out.steps.length > EXECUTION_MAX_STEPS) return null;
    const descriptors = Object.getOwnPropertyDescriptors(out.steps);
    if (Reflect.ownKeys(descriptors).length !== out.steps.length + 1) return null;
    out.steps = Array.from({ length: out.steps.length }, (_, index) => {
      if (!Object.hasOwn(descriptors[index] || {}, "value")) throw new Error();
      return step(descriptors[index].value);
    });
    let previous = 0;
    for (const item of out.steps) { if (item.seq <= previous || item.seq > out.lastSequence) return null; previous = item.seq; }
    if (!out.truncated && (out.steps.length !== out.lastSequence || previous !== out.lastSequence)) return null;
    return Buffer.byteLength(JSON.stringify(out)) <= EXECUTION_MAX_BYTES ? out : null;
  } catch { return null; }
}

function executionRequest(payload, context) {
  const serialized = JSON.stringify(payload);
  return { sha256: createHash("sha256").update(serialized).digest("hex"), characters: serialized.length,
    bytes: Buffer.byteLength(serialized), estimatedInputTokens: context.latestEstimate.inputTokens,
    safetyInputTokens: context.latestEstimate.safetyInputTokens, contextGeneration: context.contextGeneration ?? 0,
    maxOutputTokens: payload.maxOutputTokens, settingsIdentity: context.settingsIdentity };
}

function executionUsage(value) {
  const out = {};
  for (const key of TOKENS) if (Number.isSafeInteger(value?.[key]) && value[key] >= 0) out[key] = value[key];
  return { usage: Object.keys(out).length ? out : null,
    usageComplete: Object.hasOwn(out, "input_tokens") && Object.hasOwn(out, "output_tokens") };
}

function createSessionExecution(identity, write) {
  const started = performance.now();
  let snapshot = { format: EXECUTION_FORMAT, phase: "story_generation", ...identity,
    startedAt: new Date().toISOString(), lastSequence: 0, truncated: false, steps: [] };
  let stopped = false;
  return Object.freeze({
    record(kind, outcome, details = {}) {
      if (stopped) return;
      try {
        const next = { ...snapshot, lastSequence: snapshot.lastSequence + 1,
          steps: [...snapshot.steps, { seq: snapshot.lastSequence + 1, kind, outcome,
            elapsedMs: Math.max(0, Math.floor(performance.now() - started)), ...details }] };
        let checked = sanitizeExecutionSnapshot(next);
        if (!checked) checked = sanitizeExecutionSnapshot({ ...snapshot, lastSequence: next.lastSequence, truncated: true });
        if (!checked) return;
        snapshot = checked;
        if (typeof write === "function") write(sanitizeExecutionSnapshot(snapshot));
      } catch { /* Diagnostics cannot change generation or commit decisions. */ }
    },
    stop() { stopped = true; },
    read() { return sanitizeExecutionSnapshot(snapshot); },
  });
}

module.exports = { EXECUTION_FORMAT, EXECUTION_MAX_BYTES, EXECUTION_MAX_STEPS, sanitizeExecutionSnapshot, createSessionExecution,
  executionRequest, executionUsage, EXECUTION_TOOL_NAMES: TOOLS, EXECUTION_TOOL_CODES: TOOL_CODES, EXECUTION_FINISH_REASONS: FINISH };
