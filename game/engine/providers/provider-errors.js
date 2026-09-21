"use strict";

const net = require("node:net");
const dns = require("node:dns");
const {
  ERROR_CODES,
  GreyCrowError,
  normalizeError,
  redactSecrets,
  sanitizeMeta,
} = require("./provider-contracts");

const PROVIDER_ERROR_PROTOCOL_VERSION = "p1-provider-error-v1";
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429]);

function createProviderError(code, message, options = {}) {
  return new GreyCrowError(code, redactSecrets(message), {
    retryable: Boolean(options.retryable),
    status: options.status,
    cause: shouldKeepRawProviderCause(options) ? options.cause : undefined,
    meta: buildProviderErrorMeta(options),
  });
}

function normalizeProviderError(error, fallback = {}) {
  if (error instanceof GreyCrowError) {
    const meta = {
      ...fallback,
      ...(error.meta || {}),
      retryAfterMs: error.meta?.retry_after_ms,
    };
    return createProviderError(error.code, error.message, {
      ...meta,
      retryable: error.retryable,
      status: error.status,
      cause: error.cause || error,
    });
  }

  const normalized = normalizeError(error, {
    code: fallback.code || ERROR_CODES.PROVIDER_FAILED,
    message: fallback.message || `${fallback.provider || "provider"} request failed.`,
    retryable: fallback.retryable !== false,
    meta: {
      provider: fallback.provider,
      model: fallback.model,
      request_id: fallback.requestId,
    },
  });

  // Node/Undici transport exceptions carry their own codes (for example
  // ENOTFOUND). Keep application categories stable instead of exporting those
  // arbitrary transport codes and accidentally marking network loss permanent.
  const transportTimeout = ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(normalized.code);
  const knownCode = Object.values(ERROR_CODES).includes(normalized.code);
  const code = transportTimeout ? ERROR_CODES.API_TIMEOUT : knownCode ? normalized.code : fallback.code || ERROR_CODES.PROVIDER_FAILED;
  return createProviderError(code, fallback.message || normalized.message, {
    provider: fallback.provider,
    model: fallback.model,
    requestId: fallback.requestId,
    retryable: transportTimeout || (knownCode ? normalized.retryable : fallback.retryable !== false),
    status: normalized.status,
    cause: error,
  });
}

function createUpstreamError(status, body, headers, context = {}) {
  const code = isMissingModelError(status, body)
    ? ERROR_CODES.UPSTREAM_MODEL_NOT_FOUND
    : errorCodeForStatus(status);
  const retryAfter = retryAfterFromHeaders(headers);
  return createProviderError(code, code === ERROR_CODES.UPSTREAM_MODEL_NOT_FOUND
    ? `${context.provider || "provider"} could not find the requested model.`
    : upstreamMessageForStatus(status, context.provider), {
    provider: context.provider,
    model: context.model,
    requestId: context.requestId,
    status,
    retryable: isRetryableStatus(status),
    retryAfterMs: retryAfter.ms,
    retryAfterSource: retryAfter.source,
    upstreamCode: body?.error?.code || body?.code,
    upstreamType: body?.error?.type || body?.type,
  });
}

function isMissingModelError(status, body) {
  const code = String(body?.error?.code || body?.code || "").toLowerCase();
  const type = String(body?.error?.type || body?.type || "").toLowerCase();
  return status === 404 || /(?:model_not_found|invalid_model|unknown_model)/.test(`${code} ${type}`);
}

function assertProviderConfig(config = {}) {
  const provider = config.provider || "openai-compatible";
  if (!config.model) {
    throw createProviderError(
      ERROR_CODES.INVALID_PROVIDER_CONFIG,
      `${provider} provider requires a model.`,
      { provider, retryable: false }
    );
  }

  if (typeof config.transportImpl !== "function") {
    throw createProviderError(
      ERROR_CODES.INVALID_PROVIDER_CONFIG,
      `${provider} provider requires HTTPS transport support.`,
      { provider, model: config.model, retryable: false }
    );
  }

  validateBaseUrl(config.baseUrl, provider, config.model);
}

function validateBaseUrl(baseUrl, provider, model) {
  const raw = String(baseUrl || "").trim();
  if (!raw) {
    throw createProviderError(ERROR_CODES.INVALID_PROVIDER_CONFIG, `${provider} provider requires an explicit baseUrl.`, {
      provider,
      model,
      retryable: false,
    });
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw createProviderError(ERROR_CODES.INVALID_PROVIDER_CONFIG, `${provider} baseUrl is invalid.`, {
      provider,
      model,
      retryable: false,
      cause: error,
    });
  }

  if (parsed.protocol !== "https:") {
    throw createProviderError(
      ERROR_CODES.INVALID_PROVIDER_CONFIG,
      `${provider} baseUrl must use https.`,
      { provider, model, retryable: false }
    );
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw createProviderError(
      ERROR_CODES.INVALID_PROVIDER_CONFIG,
      `${provider} baseUrl must not include credentials, query, or fragment.`,
      { provider, model, retryable: false }
    );
  }

  const host = normalizeProviderHost(parsed.hostname);
  if (isUnsafeProviderHost(host)) {
    throw createProviderError(
      ERROR_CODES.INVALID_PROVIDER_CONFIG,
      `${provider} baseUrl host is not allowed.`,
      { provider, model, retryable: false }
    );
  }
}

function normalizeOpenAICompatibleBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  return raw.replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
}

async function validatePublicProviderDns(baseUrl, context = {}) {
  const provider = context.provider || "openai-compatible";
  const model = context.model;
  validateBaseUrl(baseUrl, provider, model);
  const parsed = new URL(baseUrl);
  const host = normalizeProviderHost(parsed.hostname);
  if (net.isIP(host)) {
    return [{ address: host, family: net.isIP(host) }];
  }
  const lookup = typeof context.lookup === "function" ? context.lookup : dns.promises.lookup;
  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw createProviderError(ERROR_CODES.INVALID_PROVIDER_CONFIG, `${provider} host could not be resolved.`, {
      provider,
      model,
      retryable: false,
      cause: error,
    });
  }
  const list = Array.isArray(records) ? records : [records];
  if (!list.length || list.some((record) => isUnsafeProviderHost(normalizeProviderHost(record?.address)))) {
    throw createProviderError(ERROR_CODES.INVALID_PROVIDER_CONFIG, `${provider} resolved to a host that is not allowed.`, {
      provider,
      model,
      retryable: false,
    });
  }
  return list.map((record) => ({ address: String(record.address), family: Number(record.family) || net.isIP(record.address) }));
}

function normalizeProviderHost(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isUnsafeProviderHost(host) {
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    return isUnsafeIpv4(host);
  }
  if (ipVersion === 6) {
    return isUnsafeIpv6(host);
  }

  return false;
}

function isUnsafeIpv4(host) {
  const parts = host.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && parts[2] === 100))) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function isUnsafeIpv6(host) {
  const normalized = host.toLowerCase();
  const mappedIpv4 = mappedIpv4FromIpv6(normalized);
  if (mappedIpv4) {
    return isUnsafeIpv4(mappedIpv4);
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89a-f]/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

function mappedIpv4FromIpv6(host) {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (match) {
    return match[1];
  }

  const hexMatch = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!hexMatch) {
    return null;
  }

  const high = Number.parseInt(hexMatch[1], 16);
  const low = Number.parseInt(hexMatch[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low) || high > 0xffff || low > 0xffff) {
    return null;
  }

  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".");
}

function errorCodeForStatus(status) {
  if (status === 408) {
    return ERROR_CODES.API_TIMEOUT;
  }
  if (status === 401) {
    return ERROR_CODES.UPSTREAM_AUTH_ERROR;
  }
  if (status === 403) {
    return ERROR_CODES.UPSTREAM_ACCESS_DENIED;
  }
  if (status === 402) {
    return ERROR_CODES.UPSTREAM_BALANCE_ERROR;
  }
  if (status === 429) {
    return ERROR_CODES.UPSTREAM_RATE_LIMIT;
  }
  if (status >= 500) {
    return ERROR_CODES.UPSTREAM_SERVER_ERROR;
  }
  return ERROR_CODES.UPSTREAM_BAD_RESPONSE;
}

function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(status) || status >= 500;
}

function upstreamMessageForStatus(status, provider = "provider") {
  if (status === 408) {
    return `${provider} request timed out at upstream.`;
  }
  if (status === 401) {
    return `${provider} authentication failed at upstream.`;
  }
  if (status === 403) {
    return `${provider} denied access at upstream.`;
  }
  if (status === 402) {
    return `${provider} account requires payment at upstream.`;
  }
  if (status === 429) {
    return `${provider} rate limit was reached.`;
  }
  if (status >= 500) {
    return `${provider} upstream service failed.`;
  }
  return `${provider} returned an invalid upstream response.`;
}

function retryAfterFromHeaders(headers) {
  const retryAfterMs = getHeader(headers, "retry-after-ms");
  if (retryAfterMs) {
    const parsed = Number.parseInt(retryAfterMs, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return { ms: parsed, source: "retry-after-ms" };
    }
  }

  const retryAfter = getHeader(headers, "retry-after");
  if (!retryAfter) {
    return { ms: null, source: null };
  }

  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return { ms: Math.round(seconds * 1000), source: "retry-after" };
  }

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) {
    return { ms: Math.max(0, dateMs - Date.now()), source: "retry-after-date" };
  }

  return { ms: null, source: null };
}

function getHeader(headers, name) {
  if (!headers) {
    return "";
  }
  if (typeof headers.get === "function") {
    return headers.get(name) || headers.get(name.toLowerCase()) || "";
  }
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? String(headers[match] || "") : "";
}

function buildProviderErrorMeta(options = {}) {
  return sanitizeMeta({
    provider_error_protocol: PROVIDER_ERROR_PROTOCOL_VERSION,
    provider: options.provider,
    model: options.model,
    request_id: options.requestId || options.request_id,
    status: options.status,
    retry_after_ms: normalizeRetryAfterMs(options.retryAfterMs ?? options.retry_after_ms),
    retry_after_source: options.retryAfterSource || options.retry_after_source,
    upstream_code: options.upstreamCode || options.upstream_code,
    upstream_type: options.upstreamType || options.upstream_type,
    cause: summarizeProviderCause(options.cause),
  });
}

function normalizeRetryAfterMs(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function summarizeProviderCause(cause) {
  if (!cause || typeof cause !== "object") {
    return undefined;
  }

  return sanitizeMeta({
    name: typeof cause.name === "string" ? cause.name : undefined,
    code: typeof cause.code === "string" || typeof cause.code === "number" ? cause.code : undefined,
    status: Number.isFinite(cause.status) ? cause.status : undefined,
  });
}

function shouldKeepRawProviderCause(options = {}) {
  return Boolean(options.includeRawCause && options.allowRawProviderDebug);
}

module.exports = {
  PROVIDER_ERROR_PROTOCOL_VERSION,
  assertProviderConfig,
  createProviderError,
  createUpstreamError,
  errorCodeForStatus,
  isUnsafeProviderHost,
  isRetryableStatus,
  normalizeOpenAICompatibleBaseUrl,
  normalizeProviderError,
  retryAfterFromHeaders,
  validateBaseUrl,
  validatePublicProviderDns,
};
