"use strict";

const { ERROR_CODES, GreyCrowError, sanitizeMeta } = require("./provider-contracts");
const { isObviousLocaleMismatch } = require("./locale-check");

const PROVIDER_COMPATIBILITY_CONTRACT_VERSION = "grey-crow-provider-probe-v1";
const PROBE_TOOL_NAME = "grey_crow_connection_probe";
const PROVIDER_LOCALE_QUALITY_CONTRACT_VERSION = "grey-crow-provider-locale-probe-v1";
const LOCALE_PROBES = Object.freeze([
  { locale: "zh-CN", language: "Simplified Chinese", prompt: "雨停后的旧车站里，一只手电筒忽明忽暗。" },
  { locale: "en-US", language: "English", prompt: "An old flashlight flickers in the station after the rain." },
  { locale: "ja-JP", language: "Japanese", prompt: "雨上がりの古い駅で、懐中電灯が明滅している。" },
]);

async function runProviderCompatibilityProbe({ provider, signal } = {}) {
  if (!provider || typeof provider.generate !== "function") {
    throw compatibilityError("Provider compatibility test requires a provider.");
  }
  const initialMessages = [
    {
      role: "system",
      content: "This is an isolated compatibility test. Call grey_crow_connection_probe exactly once. Do not narrate a story.",
    },
    { role: "user", content: "Run the compatibility probe now." },
  ];
  const first = await provider.generate({
    messages: initialMessages,
    tools: [createProbeToolSchema()],
    maxOutputTokens: 128,
    signal,
  });
  const call = Array.isArray(first?.toolCalls) && first.toolCalls.length === 1
    ? first.toolCalls[0]
    : null;
  if (!isValidProbeCall(call) || hasFailedCompletion(first)) {
    throw compatibilityError("The model did not complete the required tool call.", {
      provider: provider.name,
      model: provider.model,
      phase: "tool_call",
    });
  }
  const callId = call.id;
  const second = await provider.generate({
    messages: [
      ...initialMessages,
      {
        role: "assistant",
        content: typeof first.text === "string" ? first.text : "",
        toolCalls: [{
          id: callId,
          name: PROBE_TOOL_NAME,
          arguments: call.arguments,
        }],
        ...(first.transportState && typeof first.transportState === "object"
          ? { transportState: first.transportState }
          : {}),
      },
      {
        role: "tool",
        toolCallId: callId,
        content: JSON.stringify({ ok: true, contract: PROVIDER_COMPATIBILITY_CONTRACT_VERSION }),
      },
      { role: "system", content: "Return a short plain-text confirmation. Do not call another tool." },
    ],
    tools: [],
    maxOutputTokens: 128,
    signal,
  });
  if (second?.toolCalls !== undefined
    && (!Array.isArray(second.toolCalls) || second.toolCalls.length)) {
    throw compatibilityError("The model continued calling tools after the probe result.", {
      provider: provider.name,
      model: provider.model,
      phase: "final_response",
    });
  }
  if (hasFailedCompletion(second) || typeof second?.text !== "string" || !second.text.trim()) {
    throw compatibilityError("The model did not return a final response after the tool result.", {
      provider: provider.name,
      model: provider.model,
      phase: "final_response",
    });
  }
  return {
    ok: true,
    contractVersion: PROVIDER_COMPATIBILITY_CONTRACT_VERSION,
    provider: provider.name || null,
    model: provider.model || null,
    toolCallRoundTrip: true,
    providerCalls: 2,
    usage: sanitizeMeta({ first: first.usage, second: second.usage }),
  };
}

async function runProviderLocaleQualityProbe({ provider, signal } = {}) {
  if (!provider || typeof provider.generate !== "function") {
    throw compatibilityError("Provider locale quality test requires a provider.");
  }
  const results = [];
  for (const probe of LOCALE_PROBES) {
    const response = await provider.generate({
      messages: [
        {
          role: "system",
          content: `This is an isolated language-quality test. Reply in ${probe.language} only. Write one restrained sensory sentence. Do not mention testing, translation, tools, or policy.`,
        },
        { role: "user", content: probe.prompt },
      ],
      tools: [],
      maxOutputTokens: 160,
      signal,
    });
    const text = typeof response?.text === "string" ? response.text.trim() : "";
    if (!text || text.length > 1200 || isObviousLocaleMismatch(text, probe.locale)
      || (Array.isArray(response?.toolCalls) && response.toolCalls.length > 0)) {
      throw compatibilityError("The model did not pass the Adventure language quality probe.", {
        provider: provider.name,
        model: provider.model,
        locale: probe.locale,
        phase: "locale_quality",
      });
    }
    results.push({ locale: probe.locale, ok: true, usage: response.usage || null });
  }
  return {
    ok: true,
    contractVersion: PROVIDER_LOCALE_QUALITY_CONTRACT_VERSION,
    provider: provider.name || null,
    model: provider.model || null,
    providerCalls: LOCALE_PROBES.length,
    locales: results.map(({ locale, ok }) => ({ locale, ok })),
    usage: sanitizeMeta(Object.fromEntries(results.map((entry) => [entry.locale, entry.usage]))),
  };
}

function createProbeToolSchema() {
  return {
    type: "function",
    function: {
      name: PROBE_TOOL_NAME,
      description: "Confirms that this model can call and resume from a Grey Crow runtime tool.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  };
}

function isValidProbeCall(call) {
  if (!call || typeof call !== "object" || Array.isArray(call)
    || call.name !== PROBE_TOOL_NAME
    || typeof call.id !== "string" || !call.id.trim()
    || typeof call.arguments !== "string") return false;
  try {
    const args = JSON.parse(call.arguments);
    return args !== null && typeof args === "object" && !Array.isArray(args)
      && Object.keys(args).length === 0;
  } catch {
    return false;
  }
}

function hasFailedCompletion(response) {
  return ["length", "content_filter", "insufficient_system_resource"].includes(response?.finishReason);
}

function compatibilityError(message, meta = {}) {
  return new GreyCrowError(ERROR_CODES.MODEL_CAPABILITY_UNSUPPORTED, message, {
    retryable: false,
    meta: sanitizeMeta(meta),
  });
}

module.exports = {
  PROBE_TOOL_NAME,
  PROVIDER_COMPATIBILITY_CONTRACT_VERSION,
  PROVIDER_LOCALE_QUALITY_CONTRACT_VERSION,
  runProviderCompatibilityProbe,
  runProviderLocaleQualityProbe,
};
