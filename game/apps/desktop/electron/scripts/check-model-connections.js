#!/usr/bin/env node
"use strict";

const {
  CUSTOM_CONNECTION_LIMIT,
  PROVIDER_COMPATIBILITY_CONTRACT_VERSION,
  createConnectionFingerprint,
  deleteCustomConnection,
  getModelHelpCatalog,
  getModelHelpUrl,
  markCustomConnectionVerified,
  normalizeCustomBaseUrl,
  normalizeCustomConnections,
  upsertCustomConnection,
} = require("../model-connections");

assert(normalizeCustomBaseUrl("https://api.example.com/v1/chat/completions") === "https://api.example.com/v1", "full chat completions URLs should normalize to the API base.");
assert(normalizeCustomBaseUrl("https://api.example.com/v1/") === "https://api.example.com/v1", "API base URLs should normalize trailing slashes.");
for (const unsafe of [
  "http://api.example.com/v1",
  "https://localhost/v1",
  "https://127.0.0.1/v1",
  "https://[::1]/v1",
  "https://user:pass@api.example.com/v1",
  "https://api.example.com/v1?key=secret",
  "https://api.example.com/v1#fragment",
]) {
  assert(normalizeCustomBaseUrl(unsafe) === "", `unsafe URL should be rejected: ${unsafe}`);
}

let connections = [];
for (let index = 0; index < CUSTOM_CONNECTION_LIMIT; index += 1) {
  connections = upsertCustomConnection(connections, {
    name: `Connection ${index + 1}`,
    baseUrl: `https://api${index + 1}.example.com/v1`,
    modelId: `model-${index + 1}`,
  }).connections;
}
assert(connections.length === 5, "five custom connections should be accepted.");
assertThrowsCode(() => upsertCustomConnection(connections, {
  name: "Connection 6",
  baseUrl: "https://api6.example.com/v1",
  modelId: "model-6",
}), "CUSTOM_CONNECTION_LIMIT");

const first = connections[0];
let verified = markCustomConnectionVerified(connections, first.id, "2026-07-12T00:00:00.000Z");
assert(verified.connection.contractVersion === PROVIDER_COMPATIBILITY_CONTRACT_VERSION, "verification should bind the adapter contract version.");
assert(verified.connection.fingerprint === createConnectionFingerprint(verified.connection), "verification should bind connection identity fields.");

const renamed = upsertCustomConnection(verified.connections, { ...verified.connection, name: "Renamed" });
assert(Boolean(renamed.connection.verifiedAt), "renaming should preserve a valid compatibility test.");
const changedModel = upsertCustomConnection(renamed.connections, { ...renamed.connection, modelId: "different-model" });
assert(changedModel.connection.verifiedAt === null, "changing Model ID should invalidate compatibility verification.");
const changedUrl = upsertCustomConnection(verified.connections, { ...verified.connection, baseUrl: "https://different.example.com/v1" });
assert(changedUrl.connection.verifiedAt === null, "changing Base URL should invalidate compatibility verification.");

const deleted = deleteCustomConnection(connections, first.id);
assert(deleted.removed?.id === first.id && deleted.connections.length === 4, "deleting a custom connection should remove only that entry.");
assert(normalizeCustomConnections([{ ...first, id: "invalid" }]).length === 0, "invalid connection IDs should not survive normalization.");

const help = getModelHelpCatalog("zh-CN");
assert(help.entries.length >= 6, "local help should cover the initial provider documentation set.");
assert(!JSON.stringify(help).includes("https://"), "renderer help catalog must not expose external URLs.");
assert(getModelHelpUrl("deepseek").startsWith("https://api-docs.deepseek.com/"), "main process allowlist should resolve known help IDs.");
assert(getModelHelpUrl("https://evil.example.com") === "", "arbitrary help URLs must be rejected.");

process.stdout.write("model connection checks passed\n");

function assertThrowsCode(callback, expectedCode) {
  try {
    callback();
  } catch (error) {
    assert(error?.code === expectedCode, `expected ${expectedCode}, received ${error?.code || "unknown"}.`);
    return;
  }
  assert(false, `expected ${expectedCode} to be thrown.`);
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
