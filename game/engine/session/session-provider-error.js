"use strict";

// Only these fixed categories may cross the Provider/session boundary. Never
// copy messages, causes, HTTP bodies, credentials, arbitrary keys or accessors.
const RETRYABLE = Object.freeze({
  API_TIMEOUT: true,
  UPSTREAM_AUTH_ERROR: false,
  UPSTREAM_ACCESS_DENIED: false,
  UPSTREAM_BALANCE_ERROR: false,
  UPSTREAM_MODEL_NOT_FOUND: false,
  UPSTREAM_RATE_LIMIT: true,
  PROVIDER_FAILED: true,
  UPSTREAM_SERVER_ERROR: true,
  UPSTREAM_BAD_RESPONSE: true,
  MISSING_API_KEY: false,
  INVALID_PROVIDER_CONFIG: false,
  MODEL_CAPABILITY_UNSUPPORTED: false,
  CONTEXT_WINDOW_EXCEEDED: false,
  REQUEST_ABORTED: false,
});
const PROVIDER_ERROR_CODES = Object.freeze(Object.keys(RETRYABLE));
const FALLBACK_CODES = new Set(["TURN_GENERATION_FAILED", "COMPACTION_MODEL_FAILED", "CHAPTER_MODEL_FAILED"]);

function ownValue(value, key) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}

function projectProviderError(error, fallbackCode = "TURN_GENERATION_FAILED") {
  const code = ownValue(error, "code");
  if (!PROVIDER_ERROR_CODES.includes(code)) {
    return { code: FALLBACK_CODES.has(fallbackCode) ? fallbackCode : "TURN_GENERATION_FAILED", retryable: true };
  }
  // Configuration/authentication failures need player intervention. A Provider
  // may further restrict a transient failure, but cannot make those retryable.
  return { code, retryable: RETRYABLE[code] && ownValue(error, "retryable") !== false };
}

function providerFailure(error, fallbackCode) {
  const projected = projectProviderError(error, fallbackCode);
  return Object.assign(new Error(projected.code), projected);
}

module.exports = { PROVIDER_ERROR_CODES, projectProviderError, providerFailure };
