#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { createDebugTraceSummary } = require("../debug-trace-summary");

const repeatedFailure = {
  name: "inspect_skill",
  ok: false,
  error_code: "TOOL_INVALID_ARGS",
  validation: {
    stage: "tool_schema",
    reason_code: "TYPE_MISMATCH",
  },
  failure_fingerprint: "abc123def456",
  args: {
    raw_story_value: "must-not-be-exported",
    local_path: "/Users/example/private-save",
  },
};

const summary = createDebugTraceSummary([
  {
    tools: {
      calls: [
        {
          name: "record_memory_fragment",
          ok: true,
          write_receipt: { attempted: true, committed: true },
        },
      ],
    },
    parser: { parse_error: false, non_contract_response: false },
  },
  {
    tools: {
      calls: [
        {
          name: "update_current_location",
          ok: true,
          write_receipt: { attempted: true, committed: true },
        },
      ],
    },
    parser: { parse_error: true, non_contract_response: false },
  },
  {
    tools: {
      calls: [
        repeatedFailure,
        { ...repeatedFailure },
        { name: "inspect_skill", ok: true },
      ],
    },
    parser: { parse_error: false, non_contract_response: false },
  },
  {
    failed_stage: "provider_generate",
    error_code: "API_TIMEOUT",
  },
  {
    failed_stage: "commit_events",
    error_code: "STORE_WRITE_FAILED",
  },
  {
    failed_stage: "execute_tool_calls",
    error_code: "UPSTREAM_RATE_LIMIT",
  },
  {
    parser: { parse_error: false, non_contract_response: true },
  },
]);

assert.equal(summary.summary_schema_version, "grey-crow-debug-summary-v2");
assert.equal(summary.entry_count, 7);
assert.equal(summary.failed_turn_count, 4, "all top-level failures and parser no-result must count as failed turns.");
assert.equal(summary.top_level_request_failure_count, 3, "top-level failures must retain a provider-neutral count.");
assert.equal(summary.provider_request_failure_count, 2, "provider failures must include initial and follow-up requests without counting Store failures.");
assert.equal(summary.parser_contract_failure_count, 1);
assert.equal(summary.contract_fallback_count, 1, "usable non-contract narration must be visible without being mislabeled as parser failure.");
assert.equal(summary.player_visible_no_result_count, 1, "parser failure must count even when a write committed in the same turn.");
assert.equal(summary.recovered_turn_count, 1, "same-turn tool failures followed by a usable result must be visible as recovered.");
assert.equal(summary.tool_call_count, 5);
assert.equal(summary.tool_error_count, 2, "tool error calls must not be confused with grouped errors.");
assert.equal(summary.tool_error_group_count, 1, "identical safe mechanical failures should form one error group.");
assert.equal(summary.error_groups.length, 1);
assert.equal(summary.error_groups[0].count, 2);
assert.equal(summary.write_attempt_count, 2);
assert.equal(summary.write_commit_count, 2);

const serialized = JSON.stringify(summary);
assert(!serialized.includes("must-not-be-exported"));
assert(!serialized.includes("/Users/"));
assert(!serialized.includes("private-save"));
assert.equal(
  summary.count_definitions.failed_turn_count,
  "entry_has_top_level_failure_or_parser_parse_error",
  "legacy failed_turn_count must have one explicit additive-v2 definition."
);
assert.equal(
  summary.count_definitions.top_level_request_failure_count,
  "entry_has_failed_stage_or_error_code",
  "all top-level failures must retain an explicit provider-neutral definition."
);
assert.equal(
  summary.count_definitions.provider_request_failure_count,
  "entry_failed_in_provider_request_stage_or_has_stable_provider_error_code",
  "provider failures must use mechanical Provider evidence instead of any top-level failure."
);

const boundedGroups = createDebugTraceSummary([
  {
    parser: { parse_error: false, non_contract_response: false },
    tools: {
      calls: Array.from({ length: 55 }, (_value, index) => ({
        name: `tool_${index}`,
        ok: false,
        error_code: `ERROR_${index}`,
      })),
    },
  },
]);
assert.equal(boundedGroups.tool_error_count, 55);
assert.equal(boundedGroups.tool_error_group_count, 55, "group count must describe all safe groups, not only the exported sample.");
assert.equal(boundedGroups.error_groups.length, 50, "error group details must remain bounded.");

const nativeSummary = createDebugTraceSummary([
  { kind: "session_action", session_action: { status: "committed" } },
  { kind: "session_action", error_code: "ACTION_INTERRUPTED", session_action: { status: "interrupted" } },
]);
assert.deepEqual(nativeSummary.statuses, { committed: 1, interrupted: 1 });
assert.equal(nativeSummary.write_commit_count, 1);
assert.equal(nativeSummary.failed_turn_count, 1);
assert.equal(nativeSummary.attempt_history_complete, false);
assert.equal(nativeSummary.model_usage, null, "missing model measurement must remain unknown");
assert.equal(nativeSummary.tool_error_count, null, "action diagnostics do not record complete tool history");
assert.equal(nativeSummary.write_attempt_count, null);

process.stdout.write("debug trace summary checks passed\n");
