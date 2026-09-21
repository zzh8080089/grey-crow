"use strict";

const {
  ERROR_CODES,
  createRequestId,
  sanitizeMeta,
} = require("./provider-contracts");
const {
  assertProviderConfig,
  createProviderError,
  createUpstreamError,
  normalizeOpenAICompatibleBaseUrl,
  normalizeProviderError,
} = require("./provider-errors");

const { MODEL_REQUEST_TIMEOUT_MS } = require("../runtime/model-time-policy");
const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const MAX_THOUGHT_SIGNATURE_BYTES = 256 * 1024;

function createOpenAICompatibleProvider(config = {}) {
  const providerName = config.providerName || "openai-compatible";
  const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl);
  const model = config.model;
  const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : MODEL_REQUEST_TIMEOUT_MS;
  const requestImpl = typeof config.requestImpl === "function" ? config.requestImpl : null;
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  const includeRaw = shouldIncludeRawProviderData(config);
  const omitResponseFormatWithTools = Boolean(config.omitResponseFormatWithTools);
  const maxOutputTokens = normalizeMaxOutputTokens(config.maxOutputTokens || config.maxTokens || config.max_tokens);
  const tokenEstimator = typeof config.tokenEstimator === "function" ? config.tokenEstimator : null;
  const enforcePublicDns = Boolean(config.enforcePublicDns);
  const maxResponseBytes = normalizeMaxResponseBytes(config.maxResponseBytes);

  assertProviderConfig({
    provider: providerName,
    model,
    baseUrl,
    transportImpl: requestImpl || fetchImpl,
  });

  return {
    name: providerName,
    model,
    ...(tokenEstimator ? {
      estimateRequestTokens(payload = {}) {
        return tokenEstimator({ ...payload, model: payload.model || model });
      },
    } : {}),
    async generate(request = {}) {
      const apiKey = config.apiKey;
      if (!apiKey) {
        throw createProviderError(
          ERROR_CODES.MISSING_API_KEY,
          `${providerName} provider is missing an API key.`,
          { provider: providerName, model, retryable: false }
        );
      }

      if (request.signal?.aborted) {
        throw createProviderError(ERROR_CODES.REQUEST_ABORTED, `${providerName} request was aborted.`, {
          provider: providerName,
          model,
          retryable: false,
        });
      }

      const requestId = createRequestId(providerName.replace(/[^a-z0-9_-]/gi, "-"));
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const externalAbort = () => controller.abort();
      request.signal?.addEventListener?.("abort", externalAbort, { once: true });

      try {
        const response = await (requestImpl || fetchImpl)(`${baseUrl}/chat/completions`, {
          method: "POST",
          redirect: "error",
          maxRedirections: 0,
          // Undici's shorter defaults must not interrupt an otherwise active
          // model request before this request's explicit absolute deadline.
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
          enforcePublicDns,
          provider: providerName,
          model,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(buildChatCompletionBody(model, request, {
            providerName,
            baseUrl,
            omitResponseFormatWithTools,
            maxOutputTokens,
          })),
          signal: controller.signal,
        });
        const status = normalizeResponseStatus(response);
        const headers = response?.headers;
        const bodyText = await readLimitedResponseText(response, {
          maxBytes: maxResponseBytes,
          provider: providerName,
          model,
          requestId,
          status,
        });

        if (status < 200 || status >= 300) {
          const body = parseMaybeJsonBody(bodyText);
          throw createUpstreamError(status, body, headers, {
            provider: providerName,
            model,
            requestId,
          });
        }

        const body = parseJsonBody(bodyText, status, {
          provider: providerName,
          model,
          requestId,
        });
        const choice = extractChatCompletionChoice(body, status, {
          provider: providerName,
          model,
          requestId,
        });
        const text = choice.message?.content || choice.text || "";
        const toolCalls = normalizeToolCalls(choice.message?.tool_calls || choice.tool_calls);
        const transportState = createOpenAIChatTransportState(choice.message, { baseUrl, model });

        return {
          text,
          ...(toolCalls.length ? { toolCalls } : {}),
          ...(transportState ? { transportState } : {}),
          usage: normalizeUsage(body.usage),
          model: body.model || model,
          finishReason: choice.finish_reason || choice.finishReason || null,
          meta: sanitizeMeta({
            provider: providerName,
            request_id: requestId,
            upstream_id: body.id,
            status,
          }),
          ...(includeRaw ? { raw: sanitizeMeta(body) } : {}),
        };
      } catch (error) {
        if (error?.name === "AbortError") {
          if (timedOut) {
            throw createProviderError(ERROR_CODES.API_TIMEOUT, `${providerName} request timed out.`, {
              provider: providerName,
              model,
              requestId,
              retryable: true,
              cause: error,
            });
          }

          throw createProviderError(ERROR_CODES.REQUEST_ABORTED, `${providerName} request was aborted.`, {
            provider: providerName,
            model,
            requestId,
            retryable: false,
            cause: error,
          });
        }

        throw normalizeProviderError(error, {
          code: ERROR_CODES.PROVIDER_FAILED,
          message: `${providerName} request failed.`,
          provider: providerName,
          model,
          requestId,
          retryable: true,
        });
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener?.("abort", externalAbort);
      }
    },
  };
}

function normalizeResponseStatus(response) {
  const status = Number(response?.status ?? response?.statusCode);
  return Number.isFinite(status) ? Math.floor(status) : 0;
}

function normalizeMaxResponseBytes(value) {
  return Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), DEFAULT_MAX_RESPONSE_BYTES)
    : DEFAULT_MAX_RESPONSE_BYTES;
}

async function readLimitedResponseText(response, context = {}) {
  const maxBytes = context.maxBytes || DEFAULT_MAX_RESPONSE_BYTES;
  const declaredBytes = parseContentLength(response?.headers);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    terminateResponseBody(response?.body);
    throw responseTooLargeError(context);
  }

  if (response?.body && typeof response.body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    let total = 0;
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > maxBytes) {
          terminateResponseBody(response.body);
          throw responseTooLargeError(context);
        }
        chunks.push(buffer);
      }
    } catch (error) {
      if (error?.code === ERROR_CODES.UPSTREAM_BAD_RESPONSE) {
        throw error;
      }
      throw error;
    }
    return Buffer.concat(chunks, total).toString("utf8");
  }

  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const buffer = Buffer.from(value);
        total += buffer.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw responseTooLargeError(context);
        }
        chunks.push(buffer);
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks, total).toString("utf8");
  }

  if (typeof response?.text === "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      terminateResponseBody(response?.body);
      throw responseTooLargeError(context);
    }
    return text;
  }

  throw createProviderError(
    ERROR_CODES.UPSTREAM_BAD_RESPONSE,
    `${context.provider || "provider"} returned an unreadable upstream response.`,
    {
      provider: context.provider,
      model: context.model,
      requestId: context.requestId,
      status: context.status,
      retryable: false,
    }
  );
}

function parseContentLength(headers) {
  let raw = "";
  if (typeof headers?.get === "function") {
    raw = headers.get("content-length") || "";
  } else if (headers && typeof headers === "object") {
    const key = Object.keys(headers).find((name) => name.toLowerCase() === "content-length");
    raw = key ? headers[key] : "";
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function terminateResponseBody(body) {
  try {
    if (typeof body?.destroy === "function") {
      body.destroy();
      return;
    }
    if (typeof body?.cancel === "function") {
      void body.cancel().catch?.(() => {});
    }
  } catch (_error) {
    // The public provider error below is authoritative; transport cleanup is best effort.
  }
}

function responseTooLargeError(context = {}) {
  return createProviderError(
    ERROR_CODES.UPSTREAM_BAD_RESPONSE,
    `${context.provider || "provider"} returned an oversized upstream response.`,
    {
      provider: context.provider,
      model: context.model,
      requestId: context.requestId,
      status: context.status,
      retryable: false,
    }
  );
}

function buildChatCompletionBody(model, request, options = {}) {
  const body = {
    model,
    messages: normalizeOpenAIChatMessages(request.messages, { ...options, model }),
  };

  const hasTools = Array.isArray(request.tools) && request.tools.length > 0;
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = request.tools;
  }

  const responseFormat = normalizeResponseFormat(request.responseFormat);
  if (responseFormat && !(options.omitResponseFormatWithTools && hasTools)) {
    body.response_format = responseFormat;
  }

  if (Number.isFinite(request.temperature)) {
    body.temperature = request.temperature;
  }
  // Official OpenAI uses max_completion_tokens, including reasoning tokens.
  // Unknown compatible servers retain their existing protocol; model names
  // alone never identify a service. https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
  const tokenParameter = options.baseUrl === "https://api.openai.com/v1" ? "max_completion_tokens" : "max_tokens";
  body[tokenParameter] = normalizeMaxOutputTokens(request.maxOutputTokens || request.max_tokens || options.maxOutputTokens);
  // This is a per-request DeepSeek option. Other compatible endpoints retain
  // their existing protocol, and an omitted option keeps the provider default.
  if (options.providerName === "deepseek" && request.thinkingMode !== undefined) {
    if (!["enabled", "disabled"].includes(request.thinkingMode)) {
      throw createProviderError(ERROR_CODES.INVALID_PROVIDER_CONFIG, "Unsupported DeepSeek request thinking mode.", {
        provider: options.providerName, model, retryable: false,
      });
    }
    body.thinking = { type: request.thinkingMode };
  }
  if (options.providerName === "deepseek" && request.reasoningEffort !== undefined) {
    if (!["low", "high", "max"].includes(request.reasoningEffort) || request.thinkingMode === "disabled") {
      throw createProviderError(ERROR_CODES.INVALID_PROVIDER_CONFIG, "Unsupported DeepSeek request reasoning effort or thinking mode combination.", {
        provider: options.providerName, model, retryable: false,
      });
    }
    body.reasoning_effort = request.reasoningEffort;
  }

  return body;
}

function normalizeOpenAIChatMessages(messages = [], options = {}) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    if (message?.role === "assistant") {
      const normalized = Array.isArray(message.toolCalls) ? {
        role: "assistant",
        content: typeof message.content === "string" ? message.content : "",
        tool_calls: message.toolCalls.map((call, index) => ({
          id: normalizeToolCallId(call?.id, index),
          type: "function",
          function: {
            name: String(call?.name || "").trim(),
            arguments: typeof call?.arguments === "string" ? call.arguments : "{}",
          },
        })),
      } : { ...message };
      // A repaired ordinary candidate is also a continuation. Keep the
      // Provider's reasoning field on the wire, never its internal container.
      delete normalized.transportState;
      const reasoningContent = readOpenAIChatReasoningContent(message.transportState);
      if (reasoningContent) {
        normalized.reasoning_content = reasoningContent;
      }
      const gemini = message.transportState?.gemini;
      if (options.baseUrl === GEMINI_OPENAI_BASE_URL
        && message.transportState?.protocolFamily === "openai-chat"
        && gemini?.baseUrl === options.baseUrl && gemini.model === options.model
        && Array.isArray(gemini.toolSignatures) && Array.isArray(normalized.tool_calls)) {
        normalized.tool_calls = normalized.tool_calls.map((call) => ({ ...call }));
        for (const call of normalized.tool_calls) {
          const signature = gemini.toolSignatures.find((entry) => entry?.id === call.id)?.signature;
          if (validThoughtSignature(signature)) {
            call.extra_content = { google: { thought_signature: signature } };
          }
        }
      }
      return normalized;
    }
    if (message?.role === "tool" && typeof message.toolCallId === "string") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: typeof message.content === "string" ? message.content : "",
      };
    }
    return message;
  });
}

function createOpenAIChatTransportState(message = {}, options = {}) {
  const state = { protocolFamily: "openai-chat" };
  if (typeof message?.reasoning_content === "string" && message.reasoning_content.trim()) {
    state.reasoningContent = message.reasoning_content;
  }
  // Gemini requires exact replay on the corresponding function call. Keep
  // only this documented opaque field, outside gameplay tools and prose.
  // https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures
  if (options.baseUrl === GEMINI_OPENAI_BASE_URL && Array.isArray(message.tool_calls)) {
    const toolSignatures = [];
    message.tool_calls.forEach((call, index) => {
      const signature = call?.extra_content?.google?.thought_signature;
      if (signature === undefined) return;
      if (!validThoughtSignature(signature)) throw malformedUpstreamResponse(200, { provider: "openai-compatible", model: options.model });
      toolSignatures.push({ id: normalizeToolCallId(call.id, index), signature });
    });
    if (toolSignatures.length) state.gemini = { baseUrl: options.baseUrl, model: options.model, toolSignatures };
  }
  return Object.keys(state).length > 1 ? state : null;
}

function validThoughtSignature(value) {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_THOUGHT_SIGNATURE_BYTES;
}

function readOpenAIChatReasoningContent(transportState) {
  if (transportState?.protocolFamily !== "openai-chat") {
    return "";
  }
  return typeof transportState.reasoningContent === "string" ? transportState.reasoningContent : "";
}

function normalizeToolCallId(value, index) {
  return typeof value === "string" && value.trim() ? value.trim() : `tool_call_${index + 1}`;
}

function normalizeMaxOutputTokens(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }
  return Math.min(Math.max(Math.floor(value), 1), 32_768);
}

function normalizeResponseFormat(responseFormat) {
  if (!responseFormat) {
    return null;
  }

  if (typeof responseFormat === "object") {
    return responseFormat;
  }

  if (responseFormat === "json_object" || responseFormat === "grey-crow-turn-json") {
    return { type: "json_object" };
  }

  return null;
}

function shouldIncludeRawProviderData(config = {}) {
  if (!config.includeRaw) {
    return false;
  }

  return Boolean(config.allowRawProviderDebug || config.rawProviderDebug);
}

function parseJsonBody(bodyText, status, context) {
  if (!bodyText) {
    throw createProviderError(
      ERROR_CODES.UPSTREAM_BAD_RESPONSE,
      `${context.provider} returned an empty upstream response.`,
      {
        provider: context.provider,
        model: context.model,
        requestId: context.requestId,
        status,
        retryable: status >= 500,
      }
    );
  }

  try {
    return JSON.parse(bodyText);
  } catch (error) {
    throw createProviderError(
      ERROR_CODES.UPSTREAM_BAD_RESPONSE,
      `${context.provider} returned a malformed upstream response.`,
      {
        provider: context.provider,
        model: context.model,
        requestId: context.requestId,
        status,
        retryable: status >= 500,
        cause: error,
      }
    );
  }
}

function parseMaybeJsonBody(bodyText) {
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch (_error) {
    return {};
  }
}

function extractChatCompletionChoice(body, status, context) {
  if (!body || typeof body !== "object" || !Array.isArray(body.choices) || !body.choices.length) {
    throw malformedUpstreamResponse(status, context);
  }

  const choice = body.choices[0];
  if ((choice?.finish_reason || choice?.finishReason) === "aborted") {
    throw createProviderError(ERROR_CODES.UPSTREAM_SERVER_ERROR, "The upstream service interrupted generation.", {
      provider: context.provider, model: context.model, requestId: context.requestId, status, retryable: true,
    });
  }
  const text = choice?.message?.content || choice?.text;
  const toolCalls = choice?.message?.tool_calls || choice?.tool_calls;
  const message = choice?.message;
  // Empty/nullable assistant content is a valid transport response. Preserve
  // its stop reason and usage; domain callers still require a usable answer.
  // An absent/malformed message or reasoning text alone is not final prose.
  const emptyAssistantCompletion = message && typeof message === "object" && !Array.isArray(message)
    && message.role === "assistant" && (message.content === "" || message.content === null)
    && ["stop", "length", "tool_calls", "content_filter", "insufficient_system_resource"].includes(choice.finish_reason || choice.finishReason)
    && (message.reasoning_content == null || typeof message.reasoning_content === "string")
    && (message.tool_calls == null || Array.isArray(message.tool_calls));
  if (typeof text !== "string" && !Array.isArray(toolCalls) && !emptyAssistantCompletion) {
    throw malformedUpstreamResponse(status, context);
  }

  return choice;
}

function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .map((toolCall, index) => {
      const name = toolCall?.function?.name || toolCall?.name;
      if (typeof name !== "string" || !name.trim()) {
        return null;
      }
      return sanitizeMeta({
        id: typeof toolCall.id === "string" && toolCall.id.trim() ? toolCall.id : `tool_call_${index + 1}`,
        type: toolCall.type || "function",
        name,
        arguments:
          typeof toolCall.function?.arguments === "string"
            ? toolCall.function.arguments
            : typeof toolCall.arguments === "string"
              ? toolCall.arguments
              : "{}",
      });
    })
    .filter(Boolean)
    .slice(0, 8);
}

function malformedUpstreamResponse(status, context) {
  return createProviderError(
    ERROR_CODES.UPSTREAM_BAD_RESPONSE,
    `${context.provider} returned an unsupported upstream response shape.`,
    {
      provider: context.provider,
      model: context.model,
      requestId: context.requestId,
      status,
      retryable: status >= 500,
    }
  );
}

function normalizeUsage(usage = {}) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const promptTokens = firstUsageNumber(usage.prompt_tokens, usage.input_tokens);
  const completionTokens = firstUsageNumber(usage.completion_tokens, usage.output_tokens);
  const totalTokens = normalizeUsageNumber(usage.total_tokens);
  const promptCacheHitTokens = normalizeUsageNumber(usage.prompt_cache_hit_tokens);
  const promptCacheMissTokens = normalizeUsageNumber(usage.prompt_cache_miss_tokens);
  const promptDetails = normalizeUsageDetails(
    usage.prompt_tokens_details || usage.input_tokens_details,
    ["cached_tokens", "audio_tokens"]
  );
  const completionDetails = normalizeUsageDetails(
    usage.completion_tokens_details || usage.output_tokens_details,
    ["reasoning_tokens", "audio_tokens", "accepted_prediction_tokens", "rejected_prediction_tokens"]
  );
  const reasoningTokens = firstUsageNumber(
    usage.reasoning_tokens,
    completionDetails?.reasoning_tokens
  );
  const cacheBreakdownConsistent = Number.isFinite(promptTokens) &&
    Number.isFinite(promptCacheHitTokens) &&
    Number.isFinite(promptCacheMissTokens)
    ? promptCacheHitTokens + promptCacheMissTokens === promptTokens
    : null;
  const hasUsage = [
    promptTokens,
    completionTokens,
    totalTokens,
    promptCacheHitTokens,
    promptCacheMissTokens,
    reasoningTokens,
  ].some(Number.isFinite) || Boolean(promptDetails) || Boolean(completionDetails);

  if (!hasUsage) {
    return null;
  }

  return {
    ...(Number.isFinite(promptTokens) ? {
      prompt_tokens: promptTokens,
      input_tokens: promptTokens,
    } : {}),
    ...(Number.isFinite(completionTokens) ? {
      completion_tokens: completionTokens,
      output_tokens: completionTokens,
    } : {}),
    ...(Number.isFinite(totalTokens) ? { total_tokens: totalTokens } : {}),
    ...(Number.isFinite(promptCacheHitTokens) ? { prompt_cache_hit_tokens: promptCacheHitTokens } : {}),
    ...(Number.isFinite(promptCacheMissTokens) ? { prompt_cache_miss_tokens: promptCacheMissTokens } : {}),
    ...(Number.isFinite(reasoningTokens) ? { reasoning_tokens: reasoningTokens } : {}),
    ...(typeof cacheBreakdownConsistent === "boolean" ? {
      cache_breakdown_consistent: cacheBreakdownConsistent,
    } : {}),
    ...(promptDetails ? { prompt_tokens_details: promptDetails } : {}),
    ...(completionDetails ? { completion_tokens_details: completionDetails } : {}),
    usage_source: "provider_reported",
  };
}

function normalizeUsageDetails(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const details = {};
  for (const key of allowedKeys) {
    const normalized = normalizeUsageNumber(value[key]);
    if (Number.isFinite(normalized)) {
      details[key] = normalized;
    }
  }
  return Object.keys(details).length ? details : null;
}

function firstUsageNumber(...values) {
  for (const value of values) {
    const normalized = normalizeUsageNumber(value);
    if (Number.isFinite(normalized)) {
      return normalized;
    }
  }
  return null;
}

function normalizeUsageNumber(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  createOpenAICompatibleProvider,
  readLimitedResponseText,
};
