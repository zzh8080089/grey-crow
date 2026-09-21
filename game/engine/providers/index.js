"use strict";

const { createMockProvider } = require("./mock");
const providerErrors = require("./provider-errors");
const { createOpenAICompatibleProvider } = require("./openai-compatible");
const {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  createDeepSeekProvider,
} = require("./deepseek");
const modelCatalog = require("./model-catalog");
const providerRegistry = require("./provider-registry");
const connectionProbe = require("./connection-probe");

module.exports = {
  createMockProvider,
  createOpenAICompatibleProvider,
  createDeepSeekProvider,
  ...connectionProbe,
  ...modelCatalog,
  ...providerRegistry,
  ...providerErrors,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
};
