"use strict";

const PROVIDER_CATALOG_VERSION = "grey-crow-provider-catalog-v1";
const MODEL_PROFILE_VERSION = "grey-crow-model-profile-v1";

const PROTOCOL_FAMILIES = Object.freeze({
  OPENAI_CHAT: "openai-chat",
  INTERNAL_MOCK: "internal-mock",
});

const MODEL_STATUSES = Object.freeze({
  VERIFIED: "verified",
  EXPERIMENTAL: "experimental",
  CUSTOM: "custom",
  INTERNAL: "internal",
});
const CAPABILITY_SUPPORT = Object.freeze({
  VERIFIED: "verified",
  UNSUPPORTED: "unsupported",
  UNVERIFIED: "unverified",
});

const BUILTIN_PROVIDER_PROFILES = deepFreeze([
  {
    id: "deepseek",
    label: "DeepSeek",
    visibility: "player",
    protocolFamily: PROTOCOL_FAMILIES.OPENAI_CHAT,
    // Official catalog checked 2026-09-20: legacy Flash IDs now route to V4.1.
    // Documentation availability does not certify Grey Crow gameplay quality.
    // https://api-docs.deepseek.com/
    defaultModel: "deepseek-flash",
    requiresApiKey: true,
    requiresBaseUrl: false,
    allowCustomModels: true,
    models: [
      {
        schemaVersion: MODEL_PROFILE_VERSION,
        providerId: "deepseek",
        id: "deepseek-flash",
        label: "DeepSeek V4.1 Flash",
        status: MODEL_STATUSES.EXPERIMENTAL,
        limits: {
          contextTokens: 1_000_000,
          providerMaxOutputTokens: 384_000,
          adapterRequestCapTokens: 32_768,
          defaultOutputTokens: 2_048,
          maxTools: 128,
        },
        capabilities: {
          text: CAPABILITY_SUPPORT.VERIFIED,
          toolCalling: CAPABILITY_SUPPORT.VERIFIED,
          parallelToolCalls: CAPABILITY_SUPPORT.UNVERIFIED,
          jsonObject: CAPABILITY_SUPPORT.VERIFIED,
          jsonObjectWithTools: CAPABILITY_SUPPORT.UNSUPPORTED,
          streaming: CAPABILITY_SUPPORT.UNSUPPORTED,
          usageReporting: CAPABILITY_SUPPORT.UNVERIFIED,
          reasoningReplay: CAPABILITY_SUPPORT.UNVERIFIED,
          temperature: CAPABILITY_SUPPORT.UNVERIFIED,
        },
      },
      {
        schemaVersion: MODEL_PROFILE_VERSION,
        providerId: "deepseek",
        id: "deepseek-v4-flash",
        label: "deepseek-v4-flash",
        aliasOf: "deepseek-flash",
        status: MODEL_STATUSES.EXPERIMENTAL,
        limits: {
          contextTokens: 1_000_000,
          providerMaxOutputTokens: 384_000,
          adapterRequestCapTokens: 32_768,
          defaultOutputTokens: 2_048,
          maxTools: 128,
        },
        capabilities: {
          text: CAPABILITY_SUPPORT.VERIFIED,
          toolCalling: CAPABILITY_SUPPORT.VERIFIED,
          parallelToolCalls: CAPABILITY_SUPPORT.UNVERIFIED,
          jsonObject: CAPABILITY_SUPPORT.VERIFIED,
          jsonObjectWithTools: CAPABILITY_SUPPORT.UNSUPPORTED,
          streaming: CAPABILITY_SUPPORT.UNSUPPORTED,
          usageReporting: CAPABILITY_SUPPORT.UNVERIFIED,
          reasoningReplay: CAPABILITY_SUPPORT.UNVERIFIED,
          temperature: CAPABILITY_SUPPORT.UNVERIFIED,
        },
      },
      {
        schemaVersion: MODEL_PROFILE_VERSION,
        providerId: "deepseek",
        id: "deepseek-v4-pro",
        label: "deepseek-v4-pro",
        status: MODEL_STATUSES.EXPERIMENTAL,
        limits: {
          contextTokens: 1_000_000,
          providerMaxOutputTokens: 384_000,
          adapterRequestCapTokens: 32_768,
          defaultOutputTokens: 2_048,
          maxTools: 128,
        },
        capabilities: {
          text: CAPABILITY_SUPPORT.VERIFIED,
          toolCalling: CAPABILITY_SUPPORT.VERIFIED,
          parallelToolCalls: CAPABILITY_SUPPORT.UNVERIFIED,
          jsonObject: CAPABILITY_SUPPORT.VERIFIED,
          jsonObjectWithTools: CAPABILITY_SUPPORT.UNSUPPORTED,
          streaming: CAPABILITY_SUPPORT.UNSUPPORTED,
          usageReporting: CAPABILITY_SUPPORT.VERIFIED,
          reasoningReplay: CAPABILITY_SUPPORT.VERIFIED,
          temperature: CAPABILITY_SUPPORT.UNVERIFIED,
        },
      },
    ],
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    visibility: "advanced",
    protocolFamily: PROTOCOL_FAMILIES.OPENAI_CHAT,
    defaultModel: null,
    requiresApiKey: true,
    requiresBaseUrl: true,
    allowCustomModels: true,
    models: [],
  },
  {
    id: "mock",
    label: "Mock",
    visibility: "internal",
    protocolFamily: PROTOCOL_FAMILIES.INTERNAL_MOCK,
    defaultModel: "mock",
    requiresApiKey: false,
    requiresBaseUrl: false,
    allowCustomModels: true,
    models: [
      {
        schemaVersion: MODEL_PROFILE_VERSION,
        providerId: "mock",
        id: "mock",
        label: "mock",
        status: MODEL_STATUSES.INTERNAL,
        limits: {
          contextTokens: null,
          providerMaxOutputTokens: null,
          adapterRequestCapTokens: null,
          defaultOutputTokens: null,
          maxTools: null,
        },
        capabilities: {
          text: CAPABILITY_SUPPORT.VERIFIED,
          toolCalling: CAPABILITY_SUPPORT.UNSUPPORTED,
          parallelToolCalls: CAPABILITY_SUPPORT.UNSUPPORTED,
          jsonObject: CAPABILITY_SUPPORT.VERIFIED,
          jsonObjectWithTools: CAPABILITY_SUPPORT.UNSUPPORTED,
          streaming: CAPABILITY_SUPPORT.UNSUPPORTED,
          usageReporting: CAPABILITY_SUPPORT.VERIFIED,
          reasoningReplay: CAPABILITY_SUPPORT.UNSUPPORTED,
          temperature: CAPABILITY_SUPPORT.UNSUPPORTED,
        },
      },
    ],
  },
]);

function listBuiltinProviderProfiles({ includeInternal = false } = {}) {
  return clone(BUILTIN_PROVIDER_PROFILES.filter((profile) => includeInternal || profile.visibility !== "internal"));
}

function getBuiltinProviderProfile(providerId) {
  const profile = BUILTIN_PROVIDER_PROFILES.find((candidate) => candidate.id === providerId);
  return profile ? clone(profile) : null;
}

function getBuiltinModelProfile(providerId, modelId) {
  const provider = BUILTIN_PROVIDER_PROFILES.find((candidate) => candidate.id === providerId);
  const model = provider?.models?.find((candidate) => candidate.id === modelId);
  if (model) {
    return clone(model);
  }
  return provider?.allowCustomModels && modelId ? createCustomModelProfile(provider, modelId) : null;
}

function createCustomModelProfile(provider, modelId) {
  return {
    schemaVersion: MODEL_PROFILE_VERSION,
    providerId: provider.id,
    id: modelId,
    label: modelId,
    status: MODEL_STATUSES.CUSTOM,
    limits: {
      contextTokens: null,
      providerMaxOutputTokens: null,
      adapterRequestCapTokens: 32_768,
      defaultOutputTokens: 2_048,
      maxTools: null,
    },
    capabilities: {
      text: CAPABILITY_SUPPORT.UNVERIFIED,
      toolCalling: CAPABILITY_SUPPORT.UNVERIFIED,
      parallelToolCalls: CAPABILITY_SUPPORT.UNVERIFIED,
      jsonObject: CAPABILITY_SUPPORT.UNVERIFIED,
      jsonObjectWithTools: CAPABILITY_SUPPORT.UNVERIFIED,
      streaming: CAPABILITY_SUPPORT.UNSUPPORTED,
      usageReporting: CAPABILITY_SUPPORT.UNVERIFIED,
      reasoningReplay: CAPABILITY_SUPPORT.UNVERIFIED,
      temperature: CAPABILITY_SUPPORT.UNVERIFIED,
    },
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

module.exports = {
  CAPABILITY_SUPPORT,
  MODEL_PROFILE_VERSION,
  MODEL_STATUSES,
  PROTOCOL_FAMILIES,
  PROVIDER_CATALOG_VERSION,
  getBuiltinModelProfile,
  getBuiltinProviderProfile,
  listBuiltinProviderProfiles,
};
