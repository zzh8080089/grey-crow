"use strict";

const { ERROR_CODES, GreyCrowError, sanitizeMeta } = require("./provider-contracts");
const { createDeepSeekProvider } = require("./deepseek");
const { createMockProvider } = require("./mock");
const { createOpenAICompatibleProvider } = require("./openai-compatible");
const {
  getBuiltinModelProfile,
  getBuiltinProviderProfile,
  listBuiltinProviderProfiles,
} = require("./model-catalog");

const PROVIDER_REGISTRY_VERSION = "grey-crow-provider-registry-v1";
const SAFE_PROVIDER_ID = /^[A-Za-z0-9_.-]{1,128}$/;

function createBuiltinProviderRegistry() {
  return createProviderRegistry({
    definitions: [
      {
        id: "deepseek",
        create(config) {
          return createDeepSeekProvider(pickProviderConfig(config));
        },
      },
      {
        id: "openai-compatible",
        create(config) {
          return createOpenAICompatibleProvider({
            ...pickProviderConfig(config),
            providerName: "openai-compatible",
            enforcePublicDns: config.enforcePublicDns !== false,
          });
        },
      },
      {
        id: "mock",
        create(config) {
          return createMockProvider({
            mode: config.mode,
            response: config.response,
            model: config.model,
            delayMs: config.delayMs,
          });
        },
      },
    ],
    getProviderProfile: getBuiltinProviderProfile,
    getModelProfile: getBuiltinModelProfile,
    listProviderProfiles: listBuiltinProviderProfiles,
  });
}

function createProviderRegistry({
  definitions = [],
  getProviderProfile = () => null,
  getModelProfile = () => null,
  listProviderProfiles = () => [],
} = {}) {
  const factories = new Map();
  for (const definition of definitions) {
    registerDefinition(factories, definition);
  }

  return Object.freeze({
    version: PROVIDER_REGISTRY_VERSION,

    create(config = {}) {
      const providerId = normalizeProviderId(config.provider || config.providerName);
      const factory = factories.get(providerId);
      if (!factory) {
        throw invalidProviderConfig("Unsupported provider.", { provider: providerId || null });
      }
      return factory({ ...config, provider: providerId, providerName: providerId });
    },

    has(providerId) {
      return factories.has(normalizeProviderId(providerId));
    },

    getProviderProfile(providerId) {
      return cloneProfile(getProviderProfile(normalizeProviderId(providerId)));
    },

    getModelProfile(providerId, modelId) {
      return cloneProfile(getModelProfile(normalizeProviderId(providerId), normalizeModelId(modelId)));
    },

    listProviderProfiles(options = {}) {
      return cloneProfile(listProviderProfiles(options)) || [];
    },
  });
}

function registerDefinition(factories, definition = {}) {
  const id = normalizeProviderId(definition.id);
  if (!id || typeof definition.create !== "function") {
    throw invalidProviderConfig("Provider registry definitions require a safe id and factory.", { provider: id || null });
  }
  if (factories.has(id)) {
    throw invalidProviderConfig("Provider registry contains a duplicate provider id.", { provider: id });
  }
  factories.set(id, definition.create);
}

function pickProviderConfig(config = {}) {
  return {
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens || config.maxTokens,
    fetchImpl: config.fetchImpl,
    requestImpl: config.requestImpl,
    tokenEstimator: config.tokenEstimator,
    enforcePublicDns: config.enforcePublicDns,
    dnsLookup: config.dnsLookup,
  };
}

function normalizeProviderId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return SAFE_PROVIDER_ID.test(normalized) ? normalized : "";
}

function normalizeModelId(value) {
  return typeof value === "string" ? value.trim().slice(0, 256) : "";
}

function cloneProfile(value) {
  return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function invalidProviderConfig(message, meta = {}) {
  return new GreyCrowError(ERROR_CODES.INVALID_PROVIDER_CONFIG, message, {
    retryable: false,
    meta: sanitizeMeta(meta),
  });
}

module.exports = {
  PROVIDER_REGISTRY_VERSION,
  createBuiltinProviderRegistry,
  createProviderRegistry,
};
