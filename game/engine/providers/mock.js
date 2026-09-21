"use strict";

const { ERROR_CODES, createRequestId } = require("./provider-contracts");
const { createProviderError } = require("./provider-errors");

function createMockProvider(config = {}) {
  const mode = config.mode || "json";
  const model = config.model || "mock";
  const delayMs = Number.isFinite(config.delayMs) ? config.delayMs : 0;
  const calls = [];

  const provider = {
    name: "mock",
    model,
    calls,
    async generate(request = {}) {
      calls.push({
        messages: request.messages,
        tools: request.tools,
        responseFormat: request.responseFormat,
        hasSignal: Boolean(request.signal),
      });

      if (delayMs > 0) {
        await delay(delayMs, request.signal);
      }

      if (mode === "error") {
        throw createProviderError(
          config.errorCode || ERROR_CODES.PROVIDER_FAILED,
          config.errorMessage || "Mock provider failed.",
          { provider: "mock", model, retryable: Boolean(config.retryable) }
        );
      }

      const text = resolveMockText(mode, config, request);
      return {
        text,
        usage: {
          input_tokens: estimateTokens(request.messages),
          output_tokens: estimateTokens(text),
        },
        model,
        finishReason: "stop",
        meta: {
          provider: "mock",
          request_id: createRequestId("mock"),
          mode,
        },
      };
    },
  };

  return provider;
}

function resolveMockText(mode, config, request) {
  if (typeof config.response === "function") {
    return String(config.response(request) || "");
  }

  if (typeof config.response === "string") {
    return config.response;
  }

  if (mode === "text") {
    return "你停在原地，先把周围的动静记下来。";
  }

  if (mode === "bad-json") {
    return '{"narration":"破损的门后传来风声","candidate_events":[';
  }

  const playerInput = latestUserContent(request.messages);
  return JSON.stringify({
    narration: `你压低呼吸，先处理眼前的行动：${playerInput}`,
    candidate_events: [
      {
        type: "no_state_change",
        summary: "本轮只生成叙事，不提交状态变化。",
        evidence: ["player_input"],
        risk: "low",
      },
    ],
    memory_notes: [],
    uncertainties: [],
  });
}

function latestUserContent(messages = []) {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser || typeof lastUser.content !== "string") {
    return "玩家观察周围";
  }
  return lastUser.content.slice(0, 80);
}

function estimateTokens(value) {
  const text = Array.isArray(value) ? JSON.stringify(value) : String(value || "");
  return Math.max(1, Math.ceil(text.length / 4));
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(createProviderError(ERROR_CODES.API_TIMEOUT, "Mock provider aborted.", {
            provider: "mock",
            retryable: true,
          }));
        },
        { once: true }
      );
    }
  });
}

module.exports = {
  createMockProvider,
};
