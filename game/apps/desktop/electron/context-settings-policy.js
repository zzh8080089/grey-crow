"use strict";

function selectCurrentContextUsage(budget = {}) {
  const candidates = [
    [budget.context_meter_tokens, budget.context_meter_source || "next_prompt_estimate"],
    [budget.next_prompt_estimate_tokens, "next_prompt_estimate"],
    [budget.latest_actual_input_tokens, "provider_actual"],
    [budget.latest_request_input_tokens, "runtime_request_estimate"],
    [budget.full_context_estimate, "runtime_estimate"],
  ];
  for (const [value, source] of candidates) {
    if (Number.isFinite(value) && value >= 0) {
      return { used: value, source };
    }
  }
  return null;
}

function validateActiveContextPolicy({ entries = [], policy, compactUpdatedAt } = {}) {
  const selected = findLatestContextBudget(entries);
  if (!selected || !policy) {
    return { ok: true };
  }
  const traceTime = parseTime(selected.entry.createdAt);
  const compactTime = parseTime(compactUpdatedAt);
  const usage = compactTime && (!traceTime || compactTime > traceTime)
    ? null
    : selectCurrentContextUsage(selected.budget);
  const baseline = Number(selected.budget.irreducible_baseline_tokens);
  return {
    ok: (!usage || usage.used < policy.autoCompactLimit)
      && (!Number.isFinite(baseline) || baseline + policy.compactionHeadroom < policy.autoCompactLimit),
    used: usage?.used ?? null,
    usageSource: usage?.source ?? null,
    irreducibleBaseline: Number.isFinite(baseline) ? baseline : null,
    autoCompactLimit: policy.autoCompactLimit,
    effectiveContextWindow: policy.effectiveContextWindow,
  };
}

function projectRestoredContextUsage({ entries = [], policy, provider, model, compactUpdatedAt } = {}) {
  const selected = findLatestContextBudget(entries);
  if (!selected || !policy) {
    return { meter_status: "pending" };
  }
  const { entry, budget } = selected;
  if (!matchesRuntimeIdentity(entry, budget, { policy, provider, model })) {
    return { meter_status: "pending" };
  }
  const traceTime = parseTime(entry.createdAt);
  const compactTime = parseTime(compactUpdatedAt);
  if (compactTime && (!traceTime || compactTime > traceTime)) {
    return { meter_status: "pending" };
  }
  const usage = selectCurrentContextUsage(budget);
  if (!usage) {
    return { meter_status: "pending" };
  }
  return {
    meter_status: "ready",
    used: usage.used,
    effective_context_window: policy.effectiveContextWindow,
    auto_compact_ratio: policy.autoCompactRatio,
    auto_compact_limit: policy.autoCompactLimit,
    source: usage.source,
  };
}

function findLatestContextBudget(entries) {
  const list = Array.isArray(entries) ? entries : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index];
    const budget = entry?.anchor_summary?.context_budget;
    if (budget && typeof budget === "object" && !Array.isArray(budget)) {
      return { entry, budget };
    }
  }
  return null;
}

function matchesRuntimeIdentity(entry, budget, { policy, provider, model }) {
  if (!entry?.provider?.provider || !entry?.provider?.model
    || !Number.isFinite(budget.configured_context_window)
    || !Number.isFinite(budget.effective_context_window)
    || !Number.isFinite(budget.auto_compact_ratio)) {
    return false;
  }
  if (provider && entry.provider.provider !== provider) {
    return false;
  }
  if (model && entry.provider.model !== model) {
    return false;
  }
  if (budget.configured_context_window !== policy.configuredContextWindow) {
    return false;
  }
  if (budget.effective_context_window !== policy.effectiveContextWindow) {
    return false;
  }
  if (Math.abs(budget.auto_compact_ratio - policy.autoCompactRatio) > 0.0001) {
    return false;
  }
  return true;
}

function parseTime(value) {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

module.exports = {
  projectRestoredContextUsage,
  selectCurrentContextUsage,
  validateActiveContextPolicy,
};
