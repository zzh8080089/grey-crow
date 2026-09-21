"use strict";

// Shared Provider and desktop error handling, independent of turn execution.
const crypto = require("node:crypto");

const ERROR_CODES = Object.freeze({
  MISSING_API_KEY: "MISSING_API_KEY",
  INVALID_PROVIDER_CONFIG: "INVALID_PROVIDER_CONFIG",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  API_TIMEOUT: "API_TIMEOUT",
  REQUEST_ABORTED: "REQUEST_ABORTED",
  UPSTREAM_AUTH_ERROR: "UPSTREAM_AUTH_ERROR",
  UPSTREAM_ACCESS_DENIED: "UPSTREAM_ACCESS_DENIED",
  UPSTREAM_BALANCE_ERROR: "UPSTREAM_BALANCE_ERROR",
  UPSTREAM_RATE_LIMIT: "UPSTREAM_RATE_LIMIT",
  UPSTREAM_SERVER_ERROR: "UPSTREAM_SERVER_ERROR",
  UPSTREAM_BAD_RESPONSE: "UPSTREAM_BAD_RESPONSE",
  PROVIDER_FAILED: "PROVIDER_FAILED",
  MODEL_CAPABILITY_UNSUPPORTED: "MODEL_CAPABILITY_UNSUPPORTED",
  UPSTREAM_MODEL_NOT_FOUND: "UPSTREAM_MODEL_NOT_FOUND",
  CONTEXT_WINDOW_EXCEEDED: "CONTEXT_WINDOW_EXCEEDED",
  INVALID_TURN_INPUT: "INVALID_TURN_INPUT",
  PARSE_FAILED: "PARSE_FAILED",
  FACT_GATE_REJECTED: "FACT_GATE_REJECTED",
  FACT_GATE_NOT_CONFIGURED: "FACT_GATE_NOT_CONFIGURED",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_FORBIDDEN: "TOOL_FORBIDDEN",
  TOOL_INVALID_ARGS: "TOOL_INVALID_ARGS",
  TOOL_NOT_CONFIGURED: "TOOL_NOT_CONFIGURED",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  CONTRACT_INVALID: "CONTRACT_INVALID",
  CONTRACT_UNKNOWN_SCHEMA: "CONTRACT_UNKNOWN_SCHEMA",
  INVALID_SAVE_ID: "INVALID_SAVE_ID",
  STORE_READ_FAILED: "STORE_READ_FAILED",
  STORE_WRITE_FAILED: "STORE_WRITE_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

class GreyCrowError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "GreyCrowError";
    this.code = code || ERROR_CODES.INTERNAL_ERROR;
    this.retryable = Boolean(options.retryable);
    this.status = options.status;
    if (options.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
    this.meta = sanitizeMeta(options.meta || {});
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.status ? { status: this.status } : {}),
      ...(Object.keys(this.meta).length ? { meta: this.meta } : {}),
    };
  }
}

function createRequestId(prefix = "turn") {
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex");
  return `${prefix}_${id}`;
}

function normalizeError(error, fallback = {}) {
  if (error instanceof GreyCrowError) {
    return error;
  }

  if (error && typeof error === "object" && error.code && error.message) {
    return new GreyCrowError(error.code, redactSecrets(error.message), {
      retryable: Boolean(error.retryable),
      status: error.status,
      cause: error.cause,
      meta: error.meta,
    });
  }

  return new GreyCrowError(
    fallback.code || ERROR_CODES.INTERNAL_ERROR,
    redactSecrets(error?.message || fallback.message || "Grey Crow Agent failed."),
    {
      retryable: Boolean(fallback.retryable),
      status: fallback.status,
      cause: error,
      meta: fallback.meta,
    }
  );
}

function sanitizeMeta(meta) {
  if (Array.isArray(meta)) {
    return meta.map((item) =>
      item && typeof item === "object" ? sanitizeMeta(item) : redactSecrets(String(item))
    );
  }

  if (!meta || typeof meta !== "object") {
    return {};
  }

  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (isSensitiveKey(key, value)) {
      out[key] = "[redacted]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = sanitizeMeta(value);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === "object" ? sanitizeMeta(item) : redactSecrets(String(item))
      );
    } else if (typeof value === "string") {
      out[key] = isSafeHashField(key, value) ? value.toLowerCase() : redactSecrets(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isSafeHashField(key, value) {
  return /(?:^|_)(?:hash|hash_prefix)$/i.test(key) && /^[a-f0-9]{12,128}$/i.test(String(value || "").trim());
}

function isSensitiveKey(key, value) {
  if (/^(input_estimate_source|request_input_source|safety_input_source|pre_send_estimate_source|latest_request_input_source|latest_request_safety_source|turn_peak_input_source|next_prompt_estimate_source|context_usage_source|usage_source)$/i.test(key)) {
    return false;
  }
  if (/^(input|output|total|prompt|completion)_?tokens?$/i.test(key)) {
    return false;
  }
  if (/^(source_estimated|summary_estimated|previous_summary_estimated|next_input_estimate|before_input_estimate|full_context_estimate|pending_estimate|summary)_?tokens?$/i.test(key)) {
    return false;
  }
  if (/^(input_estimate|request_input|actual_input|safety_input|pre_send_estimate|estimate_error|latest_actual_input|latest_pre_send_estimate|latest_request_input|latest_request_safety|turn_peak_input|turn_peak_safety_input|turn_peak_actual_input|next_prompt_estimate|next_prompt_safety|heuristic_input|conservative_input|reported_input|message_estimate|tool_schema_estimate|response_format_estimate|latest_message_estimate|latest_tool_schema_estimate|latest_response_format_estimate|peak_message_estimate|peak_tool_schema_estimate|peak_response_format_estimate|max_reported_input|max_absolute_estimate_error|irreducible_baseline|safety_prompt)_?tokens?$/i.test(key)) {
    return false;
  }
  if (/^(prompt_cache_hit_tokens|prompt_cache_miss_tokens|reasoning_tokens|cached_tokens|cache_write_tokens|audio_tokens|accepted_prediction_tokens|rejected_prediction_tokens|prompt_tokens_details|completion_tokens_details|input_tokens_details|output_tokens_details)$/i.test(key)) {
    return false;
  }
  if (/^(summary_token_hard_cap|context_window|input_limit|budget_input_limit|output_reserve|reserved)$/i.test(key)) {
    return false;
  }
  if (/^(summaryTokenHardCap|contextWindow|inputLimit|budgetInputLimit|outputReserve)$/i.test(key)) {
    return false;
  }
  if (
    Number.isFinite(value) &&
    /(?:^|_)(?:tokens|token_count|tokens_count)$/i.test(key) &&
    !/api[_-]?key|authorization|cookie|secret|password|session/i.test(key)
  ) {
    return false;
  }
  return /api[_-]?key|authorization|cookie|token|secret|password|session|openclaw|raw|prompt|messages|cause|body_?text|response_?body|upstream_?body/i.test(key);
}

function redactSecrets(text) {
  if (typeof text !== "string") {
    return text;
  }

  return text
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "ghp_[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "github_pat_[redacted]")
    .replace(/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "glpat-[redacted]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, "xoxb-[redacted]")
    .replace(/\bya29\.[A-Za-z0-9_-]{20,}\b/g, "ya29.[redacted]")
    .replace(/\bA[SK]IA[0-9A-Z]{16}\b/g, "AKIA[redacted]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[jwt-redacted]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[hex-redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:api[_-]?key|key|token|secret)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(
      /(^|[^A-Za-z0-9])((?:api[_-]?key|key|token|secret|password)\s*[:=]\s*)([^\s,;，；]+)/gi,
      "$1$2[redacted]"
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[redacted]")
    .replace(/~\/\.openclaw[^\s"'`,;，；]*/g, "[local-path-redacted]")
    .replace(/\/(?:private\/tmp|tmp|var\/folders|Volumes|opt|usr|Users)\/[^\s"'`,;，；]*/g, "[local-path-redacted]")
    .replace(/\/Users\/[^\s"'`,;，；]+/g, "[local-path-redacted]")
    .replace(/\b[A-Za-z]:\\[^\s"'`,;，；]+/g, "[local-path-redacted]");
}

module.exports = { ERROR_CODES, GreyCrowError, createRequestId, normalizeError, sanitizeMeta, redactSecrets };
