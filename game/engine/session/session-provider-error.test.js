"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { projectProviderError, providerFailure } = require("./session-provider-error");
const { createUpstreamError, normalizeProviderError } = require("../providers/provider-errors");
const { _sessionWire } = require("./session-process");

test("HTTP failure categories survive without carrying service diagnostics", () => {
  for (const [status, code, retryable] of [
    [401, "UPSTREAM_AUTH_ERROR", false], [403, "UPSTREAM_ACCESS_DENIED", false],
    [402, "UPSTREAM_BALANCE_ERROR", false], [404, "UPSTREAM_MODEL_NOT_FOUND", false],
    [408, "API_TIMEOUT", true], [429, "UPSTREAM_RATE_LIMIT", true],
    [503, "UPSTREAM_SERVER_ERROR", true], [400, "UPSTREAM_BAD_RESPONSE", false],
  ]) {
    const error = createUpstreamError(status, { error: { message: "private-key", code: "private-upstream" } },
      { "retry-after": "60" }, { provider: "fixture", requestId: "private-request" });
    assert.deepEqual(projectProviderError(error), { code, retryable });
    assert.equal(providerFailure(error).message, code);
  }
});

test("unknown errors and accessors cannot leak or grant an arbitrary error category", () => {
  let reads = 0;
  const error = { get code() { reads++; return "API_TIMEOUT"; }, get retryable() { reads++; return true; },
    get message() { reads++; return "private"; } };
  assert.deepEqual(projectProviderError(error), { code: "TURN_GENERATION_FAILED", retryable: true });
  assert.deepEqual(_sessionWire.safeError(error), { code: "SESSION_REQUEST_FAILED" });
  assert.equal(reads, 0);
  assert.deepEqual(projectProviderError(Object.create({ code: "API_TIMEOUT" })),
    { code: "TURN_GENERATION_FAILED", retryable: true });
  assert.deepEqual(projectProviderError(new Error("private-key"), "CHAPTER_MODEL_FAILED"),
    { code: "CHAPTER_MODEL_FAILED", retryable: true });
  assert.equal(projectProviderError({ code: "private-key" }, "private-fallback").code, "TURN_GENERATION_FAILED");
  const limited = { code: "API_TIMEOUT", get retryable() { reads++; return true; } };
  assert.deepEqual(projectProviderError(limited), { code: "API_TIMEOUT", retryable: true });
  assert.equal(reads, 0);
  assert.deepEqual(projectProviderError({ code: "UPSTREAM_AUTH_ERROR", retryable: true }),
    { code: "UPSTREAM_AUTH_ERROR", retryable: false });
  assert.deepEqual(projectProviderError({ code: "UPSTREAM_ACCESS_DENIED", retryable: true }),
    { code: "UPSTREAM_ACCESS_DENIED", retryable: false });
  assert.deepEqual(projectProviderError({ code: "PROVIDER_FAILED", retryable: false }),
    { code: "PROVIDER_FAILED", retryable: false });
  assert.deepEqual(_sessionWire.safeError({ code: "API_TIMEOUT", retryable: false, message: "private" }),
    { code: "API_TIMEOUT", retryable: false });
});

test("network and transport timeout codes become stable retryable categories", () => {
  for (const code of ["ENOTFOUND", "ECONNRESET", "UND_ERR_SOCKET", "EAI_AGAIN", "private-network-code"]) {
    const normalized = normalizeProviderError(Object.assign(new Error("private network details"), { code }),
      { code: "PROVIDER_FAILED", provider: "fixture", retryable: true });
    assert.deepEqual(projectProviderError(normalized), { code: "PROVIDER_FAILED", retryable: true });
  }
  for (const code of ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]) {
    const normalized = normalizeProviderError(Object.assign(new Error("private timeout details"), { code }));
    assert.deepEqual(projectProviderError(normalized), { code: "API_TIMEOUT", retryable: true });
  }
});
