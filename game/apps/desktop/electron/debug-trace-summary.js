"use strict";

const DEBUG_TRACE_SUMMARY_SCHEMA_VERSION = "grey-crow-debug-summary-v2";
const PROVIDER_REQUEST_FAILURE_STAGES = new Set(["provider", "provider_generate"]);
const PROVIDER_REQUEST_ERROR_CODES = new Set([
  "API_TIMEOUT",
  "REQUEST_ABORTED",
  "UPSTREAM_AUTH_ERROR",
  "UPSTREAM_RATE_LIMIT",
  "UPSTREAM_SERVER_ERROR",
  "UPSTREAM_BAD_RESPONSE",
  "UPSTREAM_MODEL_NOT_FOUND",
  "PROVIDER_FAILED",
]);
const DEBUG_TRACE_COUNT_DEFINITIONS = Object.freeze({
  failed_turn_count: "entry_has_top_level_failure_or_parser_parse_error",
  top_level_request_failure_count: "entry_has_failed_stage_or_error_code",
  provider_request_failure_count: "entry_failed_in_provider_request_stage_or_has_stable_provider_error_code",
  parser_contract_failure_count: "entry_has_parser_parse_error_or_side_channel_error",
  contract_fallback_count: "entry_uses_non_contract_response_fallback",
  tool_error_count: "tool_calls_with_ok_false",
  tool_error_group_count: "distinct_safe_tool_error_groups",
  recovered_turn_count: "entry_has_tool_error_and_no_top_level_or_parser_contract_failure",
  player_visible_no_result_count: "entry_has_parser_parse_error",
  write_attempt_count: "tool_calls_with_write_receipt_attempted",
  write_commit_count: "attempted_write_receipts_with_committed_true",
});

function createDebugTraceSummary(entries = [], normalizeIdentifier = normalizeStableIdentifier) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  if (safeEntries.length && safeEntries.every((entry) => entry?.kind === "session_action")) {
    const statuses = {};
    for (const entry of safeEntries) {
      const status = entry.session_action?.status || "unknown";
      statuses[status] = (statuses[status] || 0) + 1;
    }
    return { summary_schema_version: "grey-crow-session-summary-v1", entry_count: safeEntries.length,
      scope: "selected_actions", statuses,
      failed_turn_count: safeEntries.filter((entry) => entry.error_code).length,
      attempt_history_complete: false, model_usage: null, tool_error_count: null,
      write_attempt_count: null, write_commit_count: statuses.committed || 0,
      count_definitions: { statuses: "latest_persisted_status_per_selected_player_action",
        write_commit_count: "selected_actions_with_confirmed_story_commit" } };
  }
  const normalize = typeof normalizeIdentifier === "function" ? normalizeIdentifier : normalizeStableIdentifier;
  const groups = new Map();
  let failedTurnCount = 0;
  let topLevelRequestFailureCount = 0;
  let providerRequestFailureCount = 0;
  let parserContractFailureCount = 0;
  let contractFallbackCount = 0;
  let recoveredTurnCount = 0;
  let playerVisibleNoResultCount = 0;
  let toolCallCount = 0;
  let toolErrorCount = 0;
  let writeAttemptCount = 0;
  let writeCommitCount = 0;

  for (const entry of safeEntries) {
    const topLevelRequestFailed = hasTopLevelRequestFailure(entry);
    const providerRequestFailed = hasProviderRequestFailure(entry);
    const parserFailed = entry?.parser?.parse_error === true;
    const parserContractFailed = Boolean(
      parserFailed ||
      entry?.parser?.side_channel_error_code
    );
    const usedContractFallback = entry?.parser?.non_contract_response === true;
    let entryHasToolError = false;

    if (topLevelRequestFailed) topLevelRequestFailureCount += 1;
    if (providerRequestFailed) providerRequestFailureCount += 1;
    if (parserContractFailed) parserContractFailureCount += 1;
    if (usedContractFallback) contractFallbackCount += 1;
    if (parserFailed) playerVisibleNoResultCount += 1;
    if (topLevelRequestFailed || parserFailed) failedTurnCount += 1;

    for (const call of Array.isArray(entry?.tools?.calls) ? entry.tools.calls : []) {
      toolCallCount += 1;
      if (call?.write_receipt?.attempted) {
        writeAttemptCount += 1;
        if (call.write_receipt.committed) writeCommitCount += 1;
      }
      if (call?.ok !== false) continue;

      entryHasToolError = true;
      toolErrorCount += 1;
      const name = normalize(call.name || "unknown") || "unknown";
      const code = normalize(call.error_code || "UNKNOWN_TOOL_ERROR") || "UNKNOWN_TOOL_ERROR";
      const stage = normalize(call.validation?.stage || "unknown") || "unknown";
      const reason = normalize(call.validation?.reason_code || "unknown") || "unknown";
      const fingerprint = normalize(call.failure_fingerprint || "") || null;
      const key = [name, code, stage, reason, fingerprint || "none"].join("|");
      const current = groups.get(key) || { tool: name, code, stage, reason, fingerprint, count: 0 };
      current.count += 1;
      groups.set(key, current);
    }

    if (entryHasToolError && !topLevelRequestFailed && !parserContractFailed) {
      recoveredTurnCount += 1;
    }
  }

  const errorGroups = [...groups.values()]
    .sort((left, right) => right.count - left.count || left.tool.localeCompare(right.tool, "en"))
    .slice(0, 50);

  return {
    summary_schema_version: DEBUG_TRACE_SUMMARY_SCHEMA_VERSION,
    count_definitions: DEBUG_TRACE_COUNT_DEFINITIONS,
    entry_count: safeEntries.length,
    failed_turn_count: failedTurnCount,
    top_level_request_failure_count: topLevelRequestFailureCount,
    provider_request_failure_count: providerRequestFailureCount,
    parser_contract_failure_count: parserContractFailureCount,
    contract_fallback_count: contractFallbackCount,
    recovered_turn_count: recoveredTurnCount,
    player_visible_no_result_count: playerVisibleNoResultCount,
    tool_call_count: toolCallCount,
    tool_error_count: toolErrorCount,
    tool_error_group_count: groups.size,
    write_attempt_count: writeAttemptCount,
    write_commit_count: writeCommitCount,
    error_groups: errorGroups,
  };
}

function hasTopLevelRequestFailure(entry = {}) {
  return Boolean(entry?.failed_stage || entry?.error_code);
}

function hasProviderRequestFailure(entry = {}) {
  const stage = normalizeStableIdentifier(entry?.failed_stage);
  const errorCode = normalizeStableIdentifier(entry?.error_code);
  return PROVIDER_REQUEST_FAILURE_STAGES.has(stage) || PROVIDER_REQUEST_ERROR_CODES.has(errorCode);
}

function normalizeStableIdentifier(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9_.:-]/g, "_")
    .slice(0, 128);
}

module.exports = {
  DEBUG_TRACE_SUMMARY_SCHEMA_VERSION,
  createDebugTraceSummary,
};
