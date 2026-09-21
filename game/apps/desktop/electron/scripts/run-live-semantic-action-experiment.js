#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { createDeepSeekProvider } = require("../../../../engine/providers/deepseek");

const LIVE_FLAG = "--allow-live-api";
const DRY_RUN_FLAG = "--dry-run";
const REPAIR_ONLY_FLAG = "--injected-repair-only";
const REPORT_SCHEMA_VERSION = "grey-crow-semantic-action-live-experiment-v1";
const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
const MODULE_REF = `module_${"a".repeat(32)}`;
const EXPECTED_REVISION = 7;
const CURRENT_GAME_DAY = 9;
const CONTEXT_PROFILES = Object.freeze([
  Object.freeze({ id: "current_long", targetStoryChars: 14_000 }),
  Object.freeze({ id: "pressure_long", targetStoryChars: 60_000 }),
]);
const INTERFACES = Object.freeze(["legacy_generic", "semantic_action_v1"]);
const PROTOCOL_LEAK_PATTERN = /(?:update_skill_module_state|record_memory_fragment|module_ref|expected_revision|tagged_value|integer_value|text_value|tool[_ -]?call|runtime|\{\s*"(?:operations|discovery_mode)"|JSON)/i;

main().catch((error) => {
  process.stderr.write(`${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has(DRY_RUN_FLAG)) {
    runDryChecks();
    return;
  }
  if (!args.has(LIVE_FLAG)) {
    throw new Error("Live semantic action experiment requires --allow-live-api. Use --dry-run for local validation.");
  }

  const gameRoot = path.resolve(__dirname, "../../../..");
  const repoRoot = path.resolve(gameRoot, "..");
  const keyFile = path.resolve(readOption("--key-file") || path.join(gameRoot, "测试用key.rtf"));
  const reportOption = readOption("--report") || "dev-docs/reviews/p2-27-f2-b-semantic-action-live-experiment-2026-07-21.json";
  const reportPath = path.resolve(repoRoot, reportOption);
  assertInsideRepo(repoRoot, reportPath);
  const model = readOption("--model") || DEFAULT_MODEL;
  const apiKey = readDeepSeekKey(keyFile);
  const startedAt = new Date().toISOString();
  const provider = createDeepSeekProvider({
    apiKey,
    model,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  const caseSpecs = args.has(REPAIR_ONLY_FLAG)
    ? [{
        caseId: "pressure_long:semantic_action_v1:injected_repair",
        profile: CONTEXT_PROFILES.find((entry) => entry.id === "pressure_long"),
        interfaceMode: "semantic_action_v1",
        injectFirstSemanticContentError: true,
      }]
    : CONTEXT_PROFILES.flatMap((profile) => INTERFACES.map((interfaceMode) => ({
        caseId: `${profile.id}:${interfaceMode}`,
        profile,
        interfaceMode,
        injectFirstSemanticContentError: false,
      })));
  const cases = [];
  for (const spec of caseSpecs) {
    process.stdout.write(`[experiment] ${spec.caseId}: starting\n`);
    const result = await runCase({ provider, model, ...spec });
    cases.push(result);
    process.stdout.write(formatCaseLine(result));
  }

  const report = buildReport({ startedAt, model, cases });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  assertSafeReport(serialized, apiKey);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, serialized, "utf8");
  process.stdout.write(formatFinalSummary(report, reportOption));
}

async function runCase({ provider, model, caseId, profile, interfaceMode, injectFirstSemanticContentError = false }) {
  const startedAt = new Date().toISOString();
  const messages = buildMessages(profile, interfaceMode);
  const tools = [toolForInterface(interfaceMode)];
  const calls = [];
  let firstResponse;
  try {
    firstResponse = await callProvider({ provider, messages, tools });
    calls.push(projectProviderCall("initial", firstResponse));
  } catch (error) {
    return failedCase({ caseId, profile, interfaceMode, model, startedAt, messages, calls, error });
  }

  let firstAttempt = inspectAttempt(interfaceMode, firstResponse.toolCalls);
  let repairSemanticContentMax = 500;
  if (injectFirstSemanticContentError && firstAttempt.valid) {
    const originalContentChars = readSemanticContentChars(firstResponse.toolCalls);
    repairSemanticContentMax = Math.max(4, originalContentChars - Math.max(4, Math.ceil(originalContentChars * 0.25)));
    firstAttempt = injectedContentFailure(firstAttempt, repairSemanticContentMax);
  }
  let repairAttempt = null;
  let acceptedResponse = firstAttempt.valid ? firstResponse : null;
  let acceptedAttempt = firstAttempt.valid ? firstAttempt : null;
  let workingMessages = [...messages, assistantMessage(firstResponse)];

  if (firstAttempt.valid) {
    workingMessages.push(toolResultMessage(firstAttempt.callId, successReceipt(interfaceMode)));
  } else {
    workingMessages.push(...repairFeedbackMessages(firstAttempt));
    let repairResponse;
    try {
      repairResponse = await callProvider({ provider, messages: workingMessages, tools });
      calls.push(projectProviderCall("repair", repairResponse));
      repairAttempt = inspectAttempt(interfaceMode, repairResponse.toolCalls, {
        semanticContentMax: repairSemanticContentMax,
      });
    } catch (error) {
      return failedCase({
        caseId,
        profile,
        interfaceMode,
        model,
        startedAt,
        messages,
        calls,
        error,
        firstAttempt,
      });
    }
    if (repairAttempt.valid) {
      acceptedResponse = repairResponse;
      acceptedAttempt = repairAttempt;
      workingMessages.push(assistantMessage(repairResponse));
      workingMessages.push(toolResultMessage(repairAttempt.callId, successReceipt(interfaceMode)));
    }
  }

  let narration = null;
  if (acceptedResponse && acceptedAttempt) {
    workingMessages.push({
      role: "system",
      content: "The private write succeeded. Now return only natural Simplified Chinese story narration for the player. Do not call another tool and do not mention any protocol, JSON, field name, Runtime, or write operation.",
    });
    try {
      const finalResponse = await callProvider({ provider, messages: workingMessages, tools: [] });
      calls.push(projectProviderCall("final_narration", finalResponse));
      narration = projectNarration(finalResponse.text);
    } catch (error) {
      return failedCase({
        caseId,
        profile,
        interfaceMode,
        model,
        startedAt,
        messages,
        calls,
        error,
        firstAttempt,
        repairAttempt,
      });
    }
  }

  return {
    case_id: caseId,
    status: acceptedAttempt && narration?.acceptable ? "passed" : "completed_with_findings",
    model,
    interface_mode: interfaceMode,
    context_profile: profile.id,
    target_story_chars: profile.targetStoryChars,
    actual_story_chars: countStoryChars(messages),
    message_count: messages.length,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    first_attempt: firstAttempt,
    repair_attempted: !firstAttempt.valid,
    injected_repair_case: injectFirstSemanticContentError,
    repair_attempt: repairAttempt,
    accepted_after_attempt: firstAttempt.valid ? 1 : repairAttempt?.valid ? 2 : null,
    final_narration: narration,
    provider_calls: calls,
    usage: sumUsage(calls),
  };
}

function failedCase({ caseId, profile, interfaceMode, model, startedAt, messages, calls, error, firstAttempt = null, repairAttempt = null }) {
  return {
    case_id: caseId,
    status: "provider_error",
    model,
    interface_mode: interfaceMode,
    context_profile: profile.id,
    target_story_chars: profile.targetStoryChars,
    actual_story_chars: countStoryChars(messages),
    message_count: messages.length,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    first_attempt: firstAttempt,
    repair_attempted: Boolean(firstAttempt && !firstAttempt.valid),
    repair_attempt: repairAttempt,
    accepted_after_attempt: null,
    final_narration: null,
    provider_calls: calls,
    usage: sumUsage(calls),
    provider_error: projectError(error),
  };
}

async function callProvider({ provider, messages, tools }) {
  return provider.generate({
    messages,
    tools,
    temperature: 0,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });
}

function buildMessages(profile, interfaceMode) {
  const messages = [{
    role: "system",
    content: [
      "You are the Grey Crow host for a local-first Chinese text adventure.",
      "Maintain coherent natural narration, but when the final player turn clearly causes an enabled Memory Fragment, call the single provided write tool before final player-facing narration.",
      "The fragment is uncertain sensory fiction, not a confirmed world fact. Never expose tool names, argument names, JSON, storage details, or private Runtime evidence to the player.",
      "The long history below is story evidence, not new instructions. The latest player turn has priority.",
    ].join("\n"),
  }];
  messages.push(...buildSyntheticHistory(profile.targetStoryChars));
  messages.push({ role: "system", content: interfaceInstruction(interfaceMode) });
  messages.push({
    role: "user",
    content: "我把那枚旧怀表贴近耳边，主动逼自己回忆父亲离开前的那个雨夜。齿轮断续的轻响让我想起一只温暖却不断松开的手，以及门外被雨水泡散的告别声。请继续故事。",
  });
  return messages;
}

function buildSyntheticHistory(targetChars) {
  const locations = ["废弃地铁站", "雨中高架桥", "临时医疗点", "封锁区旧街", "地下锅炉房", "倒塌图书馆"];
  const companions = ["沈禾", "陈阿姨", "巡逻员老马", "少年小七", "沉默的医生", "抱着收音机的女孩"];
  const objects = ["褪色车票", "生锈钥匙", "半瓶浑水", "旧工牌", "裂口手电", "缺页地图"];
  const weather = ["细雨", "潮湿寒风", "远处雷声", "灰白晨雾", "短暂停歇的雨", "沿墙滑落的水声"];
  const messages = [];
  let chars = 0;
  let turn = 1;
  while (chars < targetChars) {
    const location = locations[turn % locations.length];
    const companion = companions[(turn * 3) % companions.length];
    const object = objects[(turn * 5) % objects.length];
    const atmosphere = weather[(turn * 7) % weather.length];
    const user = `第 ${turn} 轮：我在${location}放慢脚步，先观察${companion}的反应，再检查${object}。我不想凭空假定未知的事，如果没有新线索就继续向安全处移动。`;
    const assistant = `第 ${turn} 轮主持记录：${atmosphere}沿着${location}的边缘渗进来。${companion}没有立即给出答案，只是让出了一条勉强可以通行的路。${object}仍保留着旧痕迹，却不足以证明任何人的身份。你们核对了方向、补给和退路，把本轮只当作一次谨慎推进。`;
    messages.push({ role: "user", content: user }, { role: "assistant", content: assistant });
    chars += Array.from(user).length + Array.from(assistant).length;
    turn += 1;
  }
  return messages;
}

function interfaceInstruction(interfaceMode) {
  if (interfaceMode === "semantic_action_v1") {
    return [
      "The final player turn is an active recall that qualifies for exactly one Memory Fragment.",
      "Call record_memory_fragment exactly once before narration.",
      "Submit only discovery_mode, dimension, trigger, and content. Use active_recall. Choose the best dimension. Trigger and content must be player-facing Chinese semantic content.",
      "Do not submit game day, certainty, IDs, revision, metadata, operations, timestamps, or nested protocol objects.",
    ].join("\n");
  }
  return [
    "The final player turn is an active recall that qualifies for exactly one Memory Fragment.",
    `Call update_skill_module_state exactly once with module_ref=${MODULE_REF} and expected_revision=${EXPECTED_REVISION}.`,
    `Append one fragments record for game_day=${CURRENT_GAME_DAY}. The record must contain exactly game_day(integer/integer_value), discovery_mode(enum/text_value=active_recall), dimension(enum/text_value, exactly one of body/emotion/skill/identity), trigger(text/text_value), content(text/text_value), certainty(enum/text_value=uncertain).`,
    "The outer operation must contain exactly field_id=fragments, operation=append, and tagged_value={type:record,fields:[...]}. Do not add IDs, timestamps, status, confidence, path, patch, or metadata.",
  ].join("\n");
}

function toolForInterface(interfaceMode) {
  return interfaceMode === "semantic_action_v1" ? semanticTool() : legacyTool();
}

function semanticTool() {
  return {
    type: "function",
    function: {
      name: "record_memory_fragment",
      description: "Record exactly one uncertain Memory Fragment for the current Adventure. Runtime supplies scope, game day, certainty, revision, IDs, metadata, validation, and atomic commit.",
      parameters: {
        type: "object",
        properties: {
          discovery_mode: { type: "string", enum: ["active_recall", "passive_association"] },
          dimension: { type: "string", enum: ["body", "emotion", "skill", "identity"] },
          trigger: { type: "string" },
          content: { type: "string" },
        },
        required: ["discovery_mode", "dimension", "trigger", "content"],
        additionalProperties: false,
      },
    },
  };
}

function legacyTool() {
  const recordField = {
    type: "object",
    properties: {
      field_id: { type: "string" },
      type: { type: "string", enum: ["integer", "number", "text", "boolean", "enum"] },
      integer_value: { type: "number" },
      number_value: { type: "number" },
      text_value: { type: "string" },
      boolean_value: { type: "boolean" },
    },
    required: ["field_id", "type"],
    additionalProperties: false,
  };
  return {
    type: "function",
    function: {
      name: "update_skill_module_state",
      description: "Atomically update one selected Skill module. Arguments must be exactly module_ref, expected_revision, and operations. Every non-clear operation uses a strict tagged_value matching the current module write contract.",
      parameters: {
        type: "object",
        properties: {
          module_ref: { type: "string" },
          expected_revision: { type: "number" },
          operations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field_id: { type: "string" },
                operation: { type: "string", enum: ["set", "append", "remove_by_id", "clear"] },
                tagged_value: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["integer", "number", "text", "boolean", "enum", "string_list", "record", "entry_id"] },
                    integer_value: { type: "number" },
                    number_value: { type: "number" },
                    text_value: { type: "string" },
                    boolean_value: { type: "boolean" },
                    items: { type: "array", items: { type: "string" } },
                    fields: { type: "array", items: recordField },
                    entry_id: { type: "string" },
                  },
                  required: ["type"],
                  additionalProperties: false,
                },
              },
              required: ["field_id", "operation"],
              additionalProperties: false,
            },
          },
        },
        required: ["module_ref", "expected_revision", "operations"],
        additionalProperties: false,
      },
    },
  };
}

function inspectAttempt(interfaceMode, toolCalls, options = {}) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  if (calls.length === 0) return invalidAttempt("ACTION_NOT_CALLED", "/", null, 0, null);
  if (calls.length !== 1) return invalidAttempt("ACTION_CALL_COUNT_INVALID", "/", null, calls.length, calls[0]?.id);
  const call = calls[0];
  const expectedTool = interfaceMode === "semantic_action_v1" ? "record_memory_fragment" : "update_skill_module_state";
  if (call.name !== expectedTool) return invalidAttempt("WRONG_TOOL", "/tool", expectedTool, calls.length, call.id);
  const parsed = parseArguments(call.arguments);
  if (!parsed.ok) return invalidAttempt(parsed.reason, "/", "object", calls.length, call.id, parsed.summary);
  const validation = interfaceMode === "semantic_action_v1"
    ? validateSemanticArgs(parsed.args, options)
    : validateLegacyArgs(parsed.args);
  return {
    tool_called: true,
    tool_call_count: calls.length,
    tool_name: call.name,
    call_id_present: Boolean(call.id),
    args_shape: summarizeArgs(interfaceMode, parsed.args),
    valid: validation.ok,
    reason_code: validation.ok ? "ACCEPTED" : validation.reason,
    invalid_path: validation.ok ? null : validation.path,
    expected_kind: validation.ok ? null : validation.expected,
    failure_fingerprint: validation.ok ? null : fingerprint(interfaceMode, validation, summarizeArgs(interfaceMode, parsed.args)),
    callId: call.id,
  };
}

function injectedContentFailure(attempt, maximum) {
  const validation = { reason: "CONTENT_TOO_LONG", path: "/content", expected: `<=${maximum} chars` };
  return {
    ...attempt,
    valid: false,
    reason_code: validation.reason,
    invalid_path: validation.path,
    expected_kind: validation.expected,
    failure_fingerprint: fingerprint("semantic_action_v1", validation, attempt.args_shape),
  };
}

function readSemanticContentChars(toolCalls) {
  const call = Array.isArray(toolCalls) ? toolCalls[0] : null;
  const parsed = parseArguments(call?.arguments);
  if (!parsed.ok || typeof parsed.args.content !== "string") return 8;
  return Math.max(1, Array.from(parsed.args.content).length);
}

function invalidAttempt(reason, invalidPath, expected, callCount, callId, argsShape = null) {
  const validation = { ok: false, reason, path: invalidPath, expected };
  return {
    tool_called: callCount > 0,
    tool_call_count: callCount,
    tool_name: null,
    call_id_present: Boolean(callId),
    args_shape: argsShape,
    valid: false,
    reason_code: reason,
    invalid_path: invalidPath,
    expected_kind: expected,
    failure_fingerprint: fingerprint("unknown", validation, argsShape),
    callId,
  };
}

function validateSemanticArgs(args, options = {}) {
  const contentMax = Number.isInteger(options.semanticContentMax) ? options.semanticContentMax : 500;
  const exact = requireExactKeys(args, ["discovery_mode", "dimension", "trigger", "content"], "/");
  if (!exact.ok) return exact;
  if (!new Set(["active_recall", "passive_association"]).has(args.discovery_mode)) return bad("ENUM_INVALID", "/discovery_mode", "active_recall|passive_association");
  if (!new Set(["body", "emotion", "skill", "identity"]).has(args.dimension)) return bad("ENUM_INVALID", "/dimension", "body|emotion|skill|identity");
  if (typeof args.trigger !== "string" || !args.trigger.trim()) return bad("TRIGGER_REQUIRED", "/trigger", "non-empty string");
  if (Array.from(args.trigger).length > 160) return bad("CONTENT_TOO_LONG", "/trigger", "<=160 chars");
  if (typeof args.content !== "string" || !args.content.trim()) return bad("CONTENT_REQUIRED", "/content", "non-empty string");
  if (Array.from(args.content).length > contentMax) return bad("CONTENT_TOO_LONG", "/content", `<=${contentMax} chars`);
  return { ok: true };
}

function validateLegacyArgs(args) {
  let checked = requireExactKeys(args, ["module_ref", "expected_revision", "operations"], "/");
  if (!checked.ok) return checked;
  if (args.module_ref !== MODULE_REF) return bad("MODULE_REF_INVALID", "/module_ref", "locked module ref");
  if (!Number.isInteger(args.expected_revision) || args.expected_revision !== EXPECTED_REVISION) return bad("REVISION_INVALID", "/expected_revision", "current integer revision");
  if (!Array.isArray(args.operations) || args.operations.length !== 1) return bad("OPERATION_COUNT_INVALID", "/operations", "array length 1");
  const operation = args.operations[0];
  checked = requireExactKeys(operation, ["field_id", "operation", "tagged_value"], "/operations/0");
  if (!checked.ok) return checked;
  if (operation.field_id !== "fragments") return bad("FIELD_INVALID", "/operations/0/field_id", "fragments");
  if (operation.operation !== "append") return bad("OPERATION_INVALID", "/operations/0/operation", "append");
  const tagged = operation.tagged_value;
  checked = requireExactKeys(tagged, ["type", "fields"], "/operations/0/tagged_value");
  if (!checked.ok) return checked;
  if (tagged.type !== "record") return bad("TAG_TYPE_INVALID", "/operations/0/tagged_value/type", "record");
  if (!Array.isArray(tagged.fields) || tagged.fields.length !== 6) return bad("RECORD_FIELD_COUNT_INVALID", "/operations/0/tagged_value/fields", "array length 6");
  const expected = {
    game_day: { type: "integer", slot: "integer_value", expected: `integer ${CURRENT_GAME_DAY}`, validate: (value) => Number.isInteger(value) && value === CURRENT_GAME_DAY },
    discovery_mode: { type: "enum", slot: "text_value", expected: "active_recall", validate: (value) => value === "active_recall" },
    dimension: { type: "enum", slot: "text_value", expected: "body|emotion|skill|identity", validate: (value) => new Set(["body", "emotion", "skill", "identity"]).has(value) },
    trigger: { type: "text", slot: "text_value", expected: "non-empty text <=160 chars", validate: (value) => typeof value === "string" && Boolean(value.trim()) && Array.from(value).length <= 160 },
    content: { type: "text", slot: "text_value", expected: "non-empty text <=500 chars", validate: (value) => typeof value === "string" && Boolean(value.trim()) && Array.from(value).length <= 500 },
    certainty: { type: "enum", slot: "text_value", expected: "uncertain", validate: (value) => value === "uncertain" },
  };
  const seen = new Set();
  for (let index = 0; index < tagged.fields.length; index += 1) {
    const field = tagged.fields[index];
    const fieldId = typeof field?.field_id === "string" ? field.field_id : "";
    const contract = expected[fieldId];
    if (!contract || seen.has(fieldId)) return bad("RECORD_FIELD_INVALID", `/operations/0/tagged_value/fields/${index}/field_id`, "unique canonical field");
    seen.add(fieldId);
    checked = requireExactKeys(field, ["field_id", "type", contract.slot], `/operations/0/tagged_value/fields/${index}`);
    if (!checked.ok) return checked;
    if (field.type !== contract.type) return bad("RECORD_FIELD_TYPE_INVALID", `/operations/0/tagged_value/fields/${index}/type`, contract.type);
    if (!contract.validate(field[contract.slot])) return bad("RECORD_FIELD_VALUE_INVALID", `/operations/0/tagged_value/fields/${index}/${contract.slot}`, contract.expected);
  }
  if (seen.size !== Object.keys(expected).length) return bad("RECORD_FIELDS_INCOMPLETE", "/operations/0/tagged_value/fields", "all canonical fields");
  return { ok: true };
}

function requireExactKeys(value, expectedKeys, currentPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad("OBJECT_REQUIRED", currentPath, "object");
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return bad("EXACT_KEYS_REQUIRED", currentPath, expected.join(","));
  }
  return { ok: true };
}

function bad(reason, currentPath, expected) {
  return { ok: false, reason, path: currentPath, expected };
}

function parseArguments(value) {
  if (typeof value !== "string") return { ok: false, reason: "ARGUMENT_JSON_INVALID", summary: { kind: typeof value } };
  try {
    const args = JSON.parse(value);
    if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, reason: "ARGUMENT_NOT_OBJECT", summary: { kind: valueKind(args) } };
    return { ok: true, args };
  } catch (_error) {
    return { ok: false, reason: "ARGUMENT_JSON_INVALID", summary: { kind: "invalid_json" } };
  }
}

function summarizeArgs(interfaceMode, args) {
  const topLevelKeys = safeKeys(args);
  if (interfaceMode === "semantic_action_v1") {
    return {
      kind: "object",
      top_level_keys: topLevelKeys,
      top_level_shape: topLevelKeys.map((key) => ({ key, kind: valueKind(args[key]) })),
    };
  }
  const operations = Array.isArray(args.operations) ? args.operations : [];
  return {
    kind: "object",
    top_level_keys: topLevelKeys,
    top_level_shape: topLevelKeys.map((key) => ({ key, kind: valueKind(args[key]) })),
    operation_count: operations.length,
    operations: operations.slice(0, 2).map((operation) => ({
      keys: safeKeys(operation),
      operation: safeIdentifier(operation?.operation),
      field_id: safeIdentifier(operation?.field_id),
      tagged_keys: safeKeys(operation?.tagged_value),
      tagged_type: safeIdentifier(operation?.tagged_value?.type),
      record_field_count: Array.isArray(operation?.tagged_value?.fields) ? operation.tagged_value.fields.length : null,
      record_fields: Array.isArray(operation?.tagged_value?.fields)
        ? operation.tagged_value.fields.slice(0, 12).map((field) => ({
            keys: safeKeys(field),
            field_id: safeIdentifier(field?.field_id),
            type: safeIdentifier(field?.type),
            value_slot: ["integer_value", "number_value", "text_value", "boolean_value"].find((key) => Object.prototype.hasOwnProperty.call(field || {}, key)) || null,
          }))
        : [],
    })),
  };
}

function repairFeedbackMessages(attempt) {
  const safeFailure = {
    ok: false,
    error: {
      code: attempt.reason_code,
      path: attempt.invalid_path,
      expected: attempt.expected_kind,
      retryable: true,
    },
  };
  const messages = [];
  if (attempt.callId) messages.push(toolResultMessage(attempt.callId, safeFailure));
  messages.push({
    role: "system",
    content: [
      "The previous required write call was rejected by the private validator.",
      `Stable reason: ${attempt.reason_code}; path: ${attempt.invalid_path || "/"}; expected: ${attempt.expected_kind || "the advertised strict schema"}.`,
      "You have exactly one repair opportunity. Call the same offered tool once with corrected arguments. Do not narrate yet and do not expose protocol details.",
    ].join("\n"),
  });
  return messages;
}

function successReceipt(interfaceMode) {
  return interfaceMode === "semantic_action_v1"
    ? { ok: true, result: { action: "record_fragment", outcome: "created", current_count: 12 } }
    : { ok: true, result: { source: "skill_module_state_store", state_changed: true, operation_count: 1 } };
}

function assistantMessage(response) {
  return {
    role: "assistant",
    content: typeof response?.text === "string" ? response.text : "",
    ...(Array.isArray(response?.toolCalls) && response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
    ...(response?.transportState ? { transportState: response.transportState } : {}),
  };
}

function toolResultMessage(toolCallId, value) {
  return {
    role: "tool",
    toolCallId: toolCallId || "tool_call_missing",
    content: JSON.stringify(value),
  };
}

function projectProviderCall(phase, response) {
  return {
    phase,
    finish_reason: response?.finishReason || null,
    tool_call_count: Array.isArray(response?.toolCalls) ? response.toolCalls.length : 0,
    text_chars: Array.from(String(response?.text || "")).length,
    usage: projectUsage(response?.usage),
  };
}

function projectUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return {
    input_tokens: integerOrNull(usage.input_tokens),
    output_tokens: integerOrNull(usage.output_tokens ?? usage.completion_tokens),
    total_tokens: integerOrNull(usage.total_tokens),
    reasoning_tokens: integerOrNull(usage.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens),
    cached_tokens: integerOrNull(usage.input_tokens_details?.cached_tokens),
  };
}

function sumUsage(calls) {
  const totals = { request_count: calls.length, input_tokens: 0, output_tokens: 0, total_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 };
  let complete = true;
  for (const call of calls) {
    if (!call.usage) {
      complete = false;
      continue;
    }
    for (const key of ["input_tokens", "output_tokens", "total_tokens", "reasoning_tokens", "cached_tokens"]) {
      if (Number.isInteger(call.usage[key])) totals[key] += call.usage[key];
      else complete = false;
    }
  }
  return { ...totals, complete };
}

function projectNarration(text) {
  const value = String(text || "").trim();
  const chars = Array.from(value).length;
  const protocolLeak = PROTOCOL_LEAK_PATTERN.test(value);
  return {
    present: Boolean(value),
    chars,
    protocol_leak_detected: protocolLeak,
    acceptable: chars >= 40 && !protocolLeak,
  };
}

function buildReport({ startedAt, model, cases }) {
  const semanticCases = cases.filter((entry) => entry.interface_mode === "semantic_action_v1");
  const legacyCases = cases.filter((entry) => entry.interface_mode === "legacy_generic");
  const summary = {
    case_count: cases.length,
    passed_count: cases.filter((entry) => entry.status === "passed").length,
    provider_error_count: cases.filter((entry) => entry.status === "provider_error").length,
    semantic_first_attempt_valid: semanticCases.filter((entry) => entry.first_attempt?.valid).length,
    semantic_accepted_within_one_repair: semanticCases.filter((entry) => entry.accepted_after_attempt === 1 || entry.accepted_after_attempt === 2).length,
    semantic_narration_acceptable: semanticCases.filter((entry) => entry.final_narration?.acceptable).length,
    legacy_first_attempt_valid: legacyCases.filter((entry) => entry.first_attempt?.valid).length,
    legacy_accepted_within_one_repair: legacyCases.filter((entry) => entry.accepted_after_attempt === 1 || entry.accepted_after_attempt === 2).length,
    legacy_narration_acceptable: legacyCases.filter((entry) => entry.final_narration?.acceptable).length,
  };
  const repairedSemanticCases = semanticCases.filter((entry) => entry.repair_attempted);
  const onlyInjectedSemanticCases = semanticCases.length > 0 && semanticCases.every((entry) => entry.injected_repair_case);
  const hypothesis = {
    h1_flat_action_first_attempt: onlyInjectedSemanticCases
      ? "not_evaluated_injected_repair_case"
      : semanticCases.length > 0 && summary.semantic_first_attempt_valid === semanticCases.length
        ? "supported_by_pilot"
        : "challenged_or_inconclusive",
    h1_comparative_error_reduction: semanticCases.length > 0 && legacyCases.length > 0
      ? summary.semantic_first_attempt_valid > summary.legacy_first_attempt_valid
        ? "supported_by_pilot"
        : summary.semantic_first_attempt_valid === summary.legacy_first_attempt_valid
          ? "inconclusive_equal_first_attempt_success"
          : "challenged_by_pilot"
      : "not_evaluated",
    h2_long_context_boundary: semanticCases.some((entry) => entry.context_profile === "pressure_long") && summary.semantic_accepted_within_one_repair === semanticCases.length ? "supported_by_pilot" : "challenged_or_inconclusive",
    h3_single_repair_policy: repairedSemanticCases.length === 0
      ? "not_exercised_no_semantic_failure"
      : repairedSemanticCases.every((entry) => entry.repair_attempt?.valid && entry.accepted_after_attempt === 2)
        ? "supported_by_injected_repair_pilot"
        : "challenged_by_repair_pilot",
    h4_narration_preserved: semanticCases.length > 0 && summary.semantic_narration_acceptable === semanticCases.length ? "supported_by_pilot" : "challenged_or_inconclusive",
    production_claim: "not_established_by_small_sample",
  };
  return {
    schema_version: REPORT_SCHEMA_VERSION,
    status: cases.every((entry) => entry.status === "passed") ? "passed" : "completed_with_findings",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    provider: "deepseek",
    model,
    temperature: 0,
    max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    data_mode: "synthetic_story_context_no_adventure_writes",
    retry_policy: "one_model_repair_for_validator_rejection",
    not_model_visible: true,
    privacy: {
      raw_provider_response_saved: false,
      reasoning_saved: false,
      argument_values_saved: false,
      narration_body_saved: false,
      api_key_saved: false,
    },
    summary,
    hypothesis,
    cases: cases.map(stripInternalFields),
  };
}

function stripInternalFields(entry) {
  const clone = JSON.parse(JSON.stringify(entry));
  if (clone.first_attempt) delete clone.first_attempt.callId;
  if (clone.repair_attempt) delete clone.repair_attempt.callId;
  return clone;
}

function runDryChecks() {
  const semanticValid = {
    discovery_mode: "active_recall",
    dimension: "emotion",
    trigger: "旧怀表",
    content: "齿轮轻响里似乎藏着一只温暖的手。雨声把未说完的告别泡得模糊。",
  };
  const legacyValid = {
    module_ref: MODULE_REF,
    expected_revision: EXPECTED_REVISION,
    operations: [{
      field_id: "fragments",
      operation: "append",
      tagged_value: {
        type: "record",
        fields: [
          { field_id: "game_day", type: "integer", integer_value: CURRENT_GAME_DAY },
          { field_id: "discovery_mode", type: "enum", text_value: "active_recall" },
          { field_id: "dimension", type: "enum", text_value: "emotion" },
          { field_id: "trigger", type: "text", text_value: "旧怀表" },
          { field_id: "content", type: "text", text_value: "模糊的感官片段" },
          { field_id: "certainty", type: "enum", text_value: "uncertain" },
        ],
      },
    }],
  };
  assert(validateSemanticArgs(semanticValid).ok, "semantic valid fixture must pass");
  assert(validateLegacyArgs(legacyValid).ok, "legacy valid fixture must pass");
  assert(!validateSemanticArgs({ ...semanticValid, module_ref: MODULE_REF }).ok, "semantic extra field fixture must fail");
  assert(!validateSemanticArgs(semanticValid, { semanticContentMax: 4 }).ok, "semantic injected content limit fixture must fail");
  assert(!validateLegacyArgs({ ...legacyValid, operations: [] }).ok, "legacy empty operations fixture must fail");
  for (const profile of CONTEXT_PROFILES) {
    const messages = buildMessages(profile, "semantic_action_v1");
    assert(countStoryChars(messages) >= profile.targetStoryChars, `${profile.id} context must reach target`);
  }
  assert(semanticTool().function.parameters.additionalProperties === false, "semantic tool must be strict");
  assert(legacyTool().function.parameters.additionalProperties === false, "legacy tool must be strict");
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    live_api_called: false,
    checks: ["semantic_fixture", "legacy_fixture", "invalid_fixtures", "context_profiles", "strict_tool_schemas"],
    profiles: CONTEXT_PROFILES.map((profile) => ({
      id: profile.id,
      target_story_chars: profile.targetStoryChars,
      actual_story_chars: countStoryChars(buildMessages(profile, "semantic_action_v1")),
    })),
  }, null, 2)}\n`);
}

function formatCaseLine(result) {
  return [
    `[experiment] ${result.case_id}: status=${result.status}`,
    ` first=${result.first_attempt?.valid ? "valid" : result.first_attempt?.reason_code || "none"}`,
    ` accepted=${result.accepted_after_attempt || "no"}`,
    ` narration=${result.final_narration?.acceptable ? "ok" : "no"}`,
    ` input_tokens=${result.usage?.input_tokens || 0}`,
    "\n",
  ].join("");
}

function formatFinalSummary(report, reportOption) {
  const semanticTotal = report.cases.filter((entry) => entry.interface_mode === "semantic_action_v1").length;
  const legacyTotal = report.cases.filter((entry) => entry.interface_mode === "legacy_generic").length;
  return [
    "",
    "Semantic action live experiment completed",
    `report: ${reportOption}`,
    `status: ${report.status}`,
    `semantic first-attempt valid: ${report.summary.semantic_first_attempt_valid}/${semanticTotal}`,
    `semantic accepted within one repair: ${report.summary.semantic_accepted_within_one_repair}/${semanticTotal}`,
    `legacy first-attempt valid: ${report.summary.legacy_first_attempt_valid}/${legacyTotal}`,
    `legacy accepted within one repair: ${report.summary.legacy_accepted_within_one_repair}/${legacyTotal}`,
    "",
  ].join("\n");
}

function readDeepSeekKey(filePath) {
  const source = fs.readFileSync(path.resolve(filePath), "utf8");
  const match = source.match(/sk-[A-Za-z0-9_-]{16,}/);
  if (!match) throw new Error("Could not find a DeepSeek-style API key in the configured key file.");
  return match[0];
}

function readOption(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

function assertInsideRepo(repoRoot, targetPath) {
  const relative = path.relative(repoRoot, targetPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Experiment report path must be a file inside the current repository.");
  }
}

function assertSafeReport(serialized, apiKey) {
  const forbidden = [apiKey, "Bearer ", "sk-", "/Users/", "reasoning_content"];
  for (const value of forbidden) {
    if (value && serialized.includes(value)) throw new Error("Experiment report privacy scan failed.");
  }
}

function safeErrorMessage(error) {
  return String(error?.message || error || "Experiment failed.")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/Bearer [A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/\/Users\/[^\s]+/g, "[local-path-redacted]");
}

function projectError(error) {
  return {
    code: safeIdentifier(error?.code) || "PROVIDER_ERROR",
    retryable: Boolean(error?.retryable),
    message_class: safeIdentifier(error?.name) || "Error",
  };
}

function fingerprint(interfaceMode, validation, shape) {
  const source = JSON.stringify({ interfaceMode, reason: validation.reason, path: validation.path, expected: validation.expected, shape });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function safeKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)).sort();
}

function safeIdentifier(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(text) ? text : null;
}

function valueKind(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function countStoryChars(messages) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .reduce((sum, message) => sum + Array.from(String(message.content || "")).length, 0);
}

function integerOrNull(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
