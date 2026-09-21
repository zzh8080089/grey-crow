"use strict";

const CONTEXT_WINDOW_POLICY_VERSION = "p2-16-context-window-policy-v1";
const DEFAULT_CONTEXT_WINDOW = 256_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
const DEFAULT_PROTOCOL_SAFETY_MARGIN = 1_024;
const DEFAULT_COMPACTION_HEADROOM = 2_048;
const DEFAULT_WARNING_RATIO = 0.65;
const DEFAULT_AUTO_COMPACT_RATIO = 0.75;
const DEFAULT_HARD_COMPACT_RATIO = 0.85;
const DEFAULT_EMERGENCY_GUARD_RATIO = 0.9;
const MAX_CONTEXT_WINDOW = 4_000_000;

function normalizeContextWindowPolicy(input = {}) {
  const configuredContextWindow = normalizePositiveInteger(
    firstDefined(input.configuredContextWindow, input.configured_context_window, input.contextWindow, input.context_window),
    DEFAULT_CONTEXT_WINDOW
  );
  const providerContextLimit = normalizeOptionalPositiveInteger(
    firstDefined(input.providerContextLimit, input.provider_context_limit)
  );
  const requestedEffectiveWindow = normalizeOptionalPositiveInteger(
    firstDefined(input.effectiveContextWindow, input.effective_context_window, input.window)
  );
  const effectiveContextWindow = Math.min(
    configuredContextWindow,
    providerContextLimit || configuredContextWindow,
    requestedEffectiveWindow || configuredContextWindow
  );
  const providerInputLimit = normalizeOptionalPositiveInteger(
    firstDefined(input.providerInputLimit, input.provider_input_limit)
  );
  const maxOutputTokens = normalizePositiveInteger(
    firstDefined(input.maxOutputTokens, input.max_output_tokens, input.outputReserve, input.output_reserve),
    DEFAULT_MAX_OUTPUT_TOKENS
  );
  const protocolSafetyMargin = normalizeNonNegativeInteger(
    firstDefined(input.protocolSafetyMargin, input.protocol_safety_margin),
    DEFAULT_PROTOCOL_SAFETY_MARGIN
  );
  const compactionHeadroom = normalizeNonNegativeInteger(
    firstDefined(input.compactionHeadroom, input.compaction_headroom, input.summaryTokenHardCap, input.summary_token_hard_cap),
    DEFAULT_COMPACTION_HEADROOM
  );
  const warningRatio = normalizeRatio(
    firstDefined(input.warningTriggerRatio, input.warning_trigger_ratio, input.warningRatio, input.warning_ratio),
    DEFAULT_WARNING_RATIO,
    0.5,
    0.84
  );
  const autoCompactRatio = normalizeRatio(
    firstDefined(input.autoCompactRatio, input.auto_compact_ratio, input.compactTriggerRatio, input.compact_trigger_ratio),
    DEFAULT_AUTO_COMPACT_RATIO,
    0.5,
    0.85
  );
  const hardCompactRatio = normalizeRatio(
    firstDefined(input.hardCompactRatio, input.hard_compact_ratio, input.hardTriggerRatio, input.hard_trigger_ratio),
    DEFAULT_HARD_COMPACT_RATIO,
    0.51,
    0.89
  );
  const emergencyGuardRatio = normalizeRatio(
    firstDefined(input.emergencyGuardRatio, input.emergency_guard_ratio, input.emergencyTriggerRatio, input.emergency_trigger_ratio),
    DEFAULT_EMERGENCY_GUARD_RATIO,
    0.9,
    0.9
  );
  const ratios = normalizeOrderedRatios({
    warningRatio,
    autoCompactRatio,
    hardCompactRatio,
    emergencyGuardRatio,
  });

  const hardInputLimit = Math.max(1, Math.min(
    providerInputLimit || providerContextLimit || effectiveContextWindow,
    effectiveContextWindow - maxOutputTokens - protocolSafetyMargin
  ));
  const emergencyLimit = Math.max(1, Math.min(
    Math.floor(effectiveContextWindow * ratios.emergencyGuardRatio),
    hardInputLimit
  ));
  const autoCompactLimit = Math.max(1, Math.min(
    Math.floor(effectiveContextWindow * ratios.autoCompactRatio),
    Math.max(1, hardInputLimit - compactionHeadroom)
  ));
  const warningLimit = Math.max(1, Math.min(
    Math.floor(effectiveContextWindow * ratios.warningRatio),
    Math.max(1, autoCompactLimit - 1)
  ));
  const hardCompactLimit = Math.max(autoCompactLimit, Math.min(
    Math.floor(effectiveContextWindow * ratios.hardCompactRatio),
    Math.max(autoCompactLimit, emergencyLimit - 1),
    hardInputLimit
  ));

  return Object.freeze({
    schema_version: CONTEXT_WINDOW_POLICY_VERSION,
    configuredContextWindow,
    providerContextLimit,
    effectiveContextWindow,
    providerInputLimit,
    maxOutputTokens,
    protocolSafetyMargin,
    compactionHeadroom,
    hardInputLimit,
    warningRatio: ratios.warningRatio,
    autoCompactRatio: ratios.autoCompactRatio,
    hardCompactRatio: ratios.hardCompactRatio,
    emergencyGuardRatio: ratios.emergencyGuardRatio,
    warningLimit,
    autoCompactLimit,
    hardCompactLimit,
    emergencyLimit,
  });
}

function evaluateContextWindowPressure(inputTokens, policyInput = {}) {
  const policy = isNormalizedPolicy(policyInput)
    ? policyInput
    : normalizeContextWindowPolicy(policyInput);
  const tokens = Number.isFinite(inputTokens) ? Math.max(0, Math.floor(inputTokens)) : 0;
  const overHardInput = tokens > policy.hardInputLimit;
  const emergency = overHardInput || tokens >= policy.emergencyLimit;
  const hard = emergency || tokens >= policy.hardCompactLimit;
  const auto = hard || tokens >= policy.autoCompactLimit;
  const warning = auto || tokens >= policy.warningLimit;
  return {
    input_tokens: tokens,
    usage_ratio: Number((tokens / policy.effectiveContextWindow).toFixed(4)),
    warning,
    auto_compact: auto,
    hard_compact: hard,
    emergency_guard: emergency,
    over_hard_input_limit: overHardInput,
    reason: emergency
      ? (overHardInput ? "hard_input_limit_exceeded" : "emergency_guard_reached")
      : hard
        ? "hard_compact_limit_reached"
        : auto
          ? "auto_compact_limit_reached"
          : warning
            ? "context_warning_limit_reached"
            : "context_below_warning_limit",
    policy,
  };
}

function isNormalizedPolicy(value) {
  return value?.schema_version === CONTEXT_WINDOW_POLICY_VERSION;
}

function normalizeOrderedRatios({ warningRatio, autoCompactRatio, hardCompactRatio, emergencyGuardRatio }) {
  const emergency = DEFAULT_EMERGENCY_GUARD_RATIO;
  const auto = Math.min(autoCompactRatio, 0.85);
  const warning = Math.min(warningRatio, Math.max(0.5, auto - 0.01));
  const hard = Math.min(Math.max(hardCompactRatio, auto), emergency - 0.01);
  return {
    warningRatio: roundRatio(warning),
    autoCompactRatio: roundRatio(auto),
    hardCompactRatio: roundRatio(hard),
    emergencyGuardRatio: roundRatio(emergencyGuardRatio === emergency ? emergencyGuardRatio : emergency),
  };
}

function normalizePositiveInteger(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), MAX_CONTEXT_WINDOW);
}

function normalizeOptionalPositiveInteger(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(Math.floor(value), MAX_CONTEXT_WINDOW);
}

function normalizeNonNegativeInteger(value, fallback) {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), MAX_CONTEXT_WINDOW);
}

function normalizeRatio(value, fallback, min, max) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Number(value.toFixed(4)), min), max);
}

function roundRatio(value) {
  return Number(value.toFixed(4));
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

module.exports = {
  CONTEXT_WINDOW_POLICY_VERSION,
  DEFAULT_AUTO_COMPACT_RATIO,
  DEFAULT_COMPACTION_HEADROOM,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_EMERGENCY_GUARD_RATIO,
  DEFAULT_HARD_COMPACT_RATIO,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_PROTOCOL_SAFETY_MARGIN,
  DEFAULT_WARNING_RATIO,
  evaluateContextWindowPressure,
  normalizeContextWindowPolicy,
};
