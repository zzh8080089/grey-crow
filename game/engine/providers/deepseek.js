"use strict";

const { createOpenAICompatibleProvider } = require("./openai-compatible");

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";

function createDeepSeekProvider(config = {}) {
  return createOpenAICompatibleProvider({
    ...config,
    providerName: "deepseek",
    baseUrl: config.baseUrl || DEEPSEEK_BASE_URL,
    model: config.model || DEEPSEEK_DEFAULT_MODEL,
    omitResponseFormatWithTools: config.omitResponseFormatWithTools !== false,
  });
}

module.exports = {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  createDeepSeekProvider,
};
