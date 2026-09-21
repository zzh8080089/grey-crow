"use strict";

const crypto = require("node:crypto");
const net = require("node:net");

const CUSTOM_PROVIDER_ID = "openai-compatible";
const CUSTOM_CONNECTION_SCHEMA_VERSION = "grey-crow-custom-connection-v1";
const CUSTOM_CONNECTION_LIMIT = 5;
const CUSTOM_CONTEXT_WINDOW_DEFAULT = 64_000;
const CUSTOM_CONTEXT_WINDOW_MAX = 1_000_000;
const PROVIDER_COMPATIBILITY_CONTRACT_VERSION = "grey-crow-provider-probe-v1";

const MODEL_HELP_ENTRIES = Object.freeze([
  {
    id: "deepseek",
    label: "DeepSeek",
    summary: "内置模型只需要 DeepSeek API Key。Flash 为默认，Pro 为高级档。",
    url: "https://api-docs.deepseek.com/",
  },
  {
    id: "openai",
    label: "OpenAI",
    summary: "使用 OpenAI Chat Completions 兼容地址，并填写模型 ID。",
    url: "https://developers.openai.com/api/docs/models",
  },
  {
    id: "gemini",
    label: "Gemini OpenAI compatibility",
    summary: "Gemini 需要使用官方 OpenAI compatibility 地址，不是网页聊天地址。",
    url: "https://ai.google.dev/gemini-api/docs/openai",
  },
  {
    id: "qwen",
    label: "Qwen",
    summary: "百炼兼容接口需要 API Base URL、模型 ID 和对应区域的 Key。",
    url: "https://help.aliyun.com/en/model-studio/qwen-function-calling",
  },
  {
    id: "claude",
    label: "Claude compatibility",
    summary: "Claude compatibility 可能存在参数和工具限制；必须通过灰鸦连接测试。",
    url: "https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    summary: "请求会经过第三方路由；填写 OpenRouter Base URL、模型 ID 和 Key。",
    url: "https://openrouter.ai/docs/guides/features/tool-calling",
  },
]);

// Tutorial links are fixed IDs too, but are not additional model providers.
const TUTORIAL_HELP_URLS = Object.freeze({
  "deepseek-platform": "https://platform.deepseek.com/",
  "deepseek-keys": "https://platform.deepseek.com/api_keys",
  "deepseek-billing": "https://platform.deepseek.com/top_up",
  "deepseek-pricing": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
  "deepseek-errors": "https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/",
});

function normalizeCustomConnections(value) {
  const source = Array.isArray(value) ? value : [];
  const result = [];
  const ids = new Set();
  for (const item of source.slice(0, CUSTOM_CONNECTION_LIMIT)) {
    const connection = normalizeCustomConnection(item);
    if (connection && !ids.has(connection.id)) {
      ids.add(connection.id);
      result.push(connection);
    }
  }
  return result;
}

function normalizeCustomConnection(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeConnectionId(value.id);
  const name = normalizeConnectionName(value.name);
  const baseUrl = normalizeCustomBaseUrl(value.baseUrl);
  const modelId = normalizeModelId(value.modelId || value.model);
  if (!id || !name || !baseUrl || !modelId) {
    return null;
  }
  const expectedFingerprint = createConnectionFingerprint({ id, baseUrl, modelId });
  const verifiedAt = normalizeIsoTime(value.verifiedAt);
  const fingerprint = normalizeFingerprint(value.fingerprint);
  const verified = Boolean(
    verifiedAt &&
    fingerprint === expectedFingerprint &&
    value.contractVersion === PROVIDER_COMPATIBILITY_CONTRACT_VERSION
  );
  return {
    schemaVersion: CUSTOM_CONNECTION_SCHEMA_VERSION,
    id,
    name,
    provider: CUSTOM_PROVIDER_ID,
    baseUrl,
    modelId,
    contextWindowTokens: CUSTOM_CONTEXT_WINDOW_DEFAULT,
    status: "custom",
    verifiedAt: verified ? verifiedAt : null,
    fingerprint: verified ? fingerprint : null,
    contractVersion: verified ? PROVIDER_COMPATIBILITY_CONTRACT_VERSION : null,
  };
}

function createCustomConnection(input = {}, { id = createConnectionId() } = {}) {
  return requireValidConnection({ ...input, id });
}

function upsertCustomConnection(connections, input = {}) {
  const current = normalizeCustomConnections(connections);
  const id = normalizeConnectionId(input.id) || createConnectionId();
  const candidate = requireValidConnection({ ...input, id });
  const index = current.findIndex((item) => item.id === id);
  if (index < 0 && current.length >= CUSTOM_CONNECTION_LIMIT) {
    throw connectionError("CUSTOM_CONNECTION_LIMIT", `最多只能保存 ${CUSTOM_CONNECTION_LIMIT} 个自定义连接。`);
  }
  const previous = index >= 0 ? current[index] : null;
  if (previous && previous.fingerprint === createConnectionFingerprint(candidate)) {
    candidate.verifiedAt = previous.verifiedAt;
    candidate.fingerprint = previous.fingerprint;
    candidate.contractVersion = previous.contractVersion;
  }
  if (index >= 0) {
    current[index] = candidate;
  } else {
    current.push(candidate);
  }
  return { connections: current, connection: candidate };
}

function markCustomConnectionVerified(connections, connectionId, verifiedAt = new Date().toISOString()) {
  const current = normalizeCustomConnections(connections);
  const index = current.findIndex((item) => item.id === normalizeConnectionId(connectionId));
  if (index < 0) {
    throw connectionError("CUSTOM_CONNECTION_NOT_FOUND", "没有找到需要验证的自定义连接。");
  }
  const connection = current[index];
  current[index] = {
    ...connection,
    verifiedAt: normalizeIsoTime(verifiedAt) || new Date().toISOString(),
    fingerprint: createConnectionFingerprint(connection),
    contractVersion: PROVIDER_COMPATIBILITY_CONTRACT_VERSION,
  };
  return { connections: current, connection: current[index] };
}

function deleteCustomConnection(connections, connectionId) {
  const id = normalizeConnectionId(connectionId);
  const current = normalizeCustomConnections(connections);
  const removed = current.find((item) => item.id === id) || null;
  return {
    connections: current.filter((item) => item.id !== id),
    removed,
  };
}

function getCustomConnection(connections, connectionId) {
  const id = normalizeConnectionId(connectionId);
  return normalizeCustomConnections(connections).find((item) => item.id === id) || null;
}

function createConnectionFingerprint(value = {}) {
  const id = normalizeConnectionId(value.id);
  const baseUrl = normalizeCustomBaseUrl(value.baseUrl);
  const modelId = normalizeModelId(value.modelId || value.model);
  if (!id || !baseUrl || !modelId) {
    return "";
  }
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      id,
      baseUrl,
      modelId,
      contractVersion: PROVIDER_COMPATIBILITY_CONTRACT_VERSION,
    }))
    .digest("hex");
}

function normalizeCustomBaseUrl(value) {
  const raw = typeof value === "string" ? value.trim().slice(0, 2048) : "";
  if (!raw) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(raw.replace(/\/+$/, "").replace(/\/chat\/completions$/i, ""));
  } catch (_error) {
    return "";
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return "";
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || net.isIP(host)) {
    return "";
  }
  return parsed.toString().replace(/\/+$/, "");
}

function getModelHelpCatalog(locale = "zh-CN") {
  return {
    schemaVersion: "grey-crow-model-help-v1",
    locale: locale === "en-US" ? "en-US" : "zh-CN",
    localGuide: {
      title: "自定义模型连接",
      body: "请填写供应商提供的 API Base URL、API Key 和 Model ID。网页聊天地址不能作为 API 地址。连接测试会产生少量 API 消耗，并验证两步工具调用。",
      compatibilityNotice: "测试成功只表示该连接能够运行灰鸦工具协议，不代表灰鸦维护其价格、质量或长期可用性。",
    },
    entries: MODEL_HELP_ENTRIES.map(({ url: _url, ...entry }) => ({ ...entry })),
  };
}

function getModelHelpUrl(helpId) {
  const id = typeof helpId === "string" ? helpId.trim() : "";
  return MODEL_HELP_ENTRIES.find((entry) => entry.id === id)?.url
    || (Object.hasOwn(TUTORIAL_HELP_URLS, id) ? TUTORIAL_HELP_URLS[id] : "");
}

function requireValidConnection(value) {
  const connection = normalizeCustomConnection(value);
  if (connection) {
    return connection;
  }
  throw connectionError("INVALID_CUSTOM_CONNECTION", "请填写有效的连接名称、公共 HTTPS API 地址和 Model ID。");
}

function createConnectionId() {
  return `custom_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeConnectionId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^custom_[a-f0-9]{16}$/.test(text) ? text : "";
}

function normalizeConnectionName(value) {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  return text.slice(0, 40);
}

function normalizeModelId(value) {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  return text.slice(0, 256);
}

function normalizeFingerprint(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

function normalizeIsoTime(value) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function connectionError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

module.exports = {
  CUSTOM_CONNECTION_LIMIT,
  CUSTOM_CONNECTION_SCHEMA_VERSION,
  CUSTOM_CONTEXT_WINDOW_DEFAULT,
  CUSTOM_CONTEXT_WINDOW_MAX,
  CUSTOM_PROVIDER_ID,
  PROVIDER_COMPATIBILITY_CONTRACT_VERSION,
  createConnectionFingerprint,
  createCustomConnection,
  deleteCustomConnection,
  getCustomConnection,
  getModelHelpCatalog,
  getModelHelpUrl,
  markCustomConnectionVerified,
  normalizeCustomBaseUrl,
  normalizeCustomConnections,
  upsertCustomConnection,
};
