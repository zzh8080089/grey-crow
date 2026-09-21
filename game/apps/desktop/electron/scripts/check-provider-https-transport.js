#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { isUnsafeProviderHost } = require(path.resolve(__dirname, "../../../..", "engine/providers"));
const { MODEL_REQUEST_TIMEOUT_MS, CONNECTION_TEST_TIMEOUT_MS } = require(path.resolve(__dirname, "../../../..", "engine/runtime/model-time-policy"));
const {
  createProviderHttpsTransport,
  createPublicOnlyLookup,
} = require("../provider-https-transport");

async function main() {
  let lookupCount = 0;
  const publicRecords = [
    { address: "8.8.8.8", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ];
  const agents = [];
  const requests = [];
  class FakeAgent {
    constructor(options) {
      this.options = options;
      this.closed = false;
      agents.push(this);
    }
    async close() {
      this.closed = true;
    }
  }
  const transport = createProviderHttpsTransport({
    AgentClass: FakeAgent,
    isUnsafeAddress: isUnsafeProviderHost,
    lookup: async (_hostname, options) => {
      lookupCount += 1;
      assert(options.all === true, "restricted lookup should resolve the complete A/AAAA batch.");
      return publicRecords;
    },
    requestFn: async (url, options) => {
      requests.push({ url: String(url), options });
      return { statusCode: 200, headers: {}, body: emptyBody() };
    },
  });

  await transport("https://provider.test/v1/chat/completions", {
    method: "POST",
    enforcePublicDns: true,
    redirect: "follow",
    headersTimeout: MODEL_REQUEST_TIMEOUT_MS,
    bodyTimeout: MODEL_REQUEST_TIMEOUT_MS,
  });
  assert(agents.length === 1 && requests[0].options.dispatcher === agents[0], "custom HTTPS requests should use the restricted Undici Agent.");
  assert(requests[0].options.maxRedirections === 0, "provider transport must disable redirects.");
  assert(!Object.prototype.hasOwnProperty.call(requests[0].options, "enforcePublicDns"), "internal DNS flags must not leak into Undici options.");
  assert(requests[0].options.headersTimeout === MODEL_REQUEST_TIMEOUT_MS && requests[0].options.bodyTimeout === MODEL_REQUEST_TIMEOUT_MS,
    "the model request's explicit budget must reach Undici instead of its defaults.");

  const actualRecords = await invokeLookup(agents[0].options.connect.lookup, "provider.test", { all: true });
  assert(lookupCount === 1, "socket lookup should perform exactly one DNS resolution.");
  assert(JSON.stringify(actualRecords) === JSON.stringify(publicRecords), "the validated A/AAAA batch should be handed directly to the connector.");

  await transport("https://provider.test/v1/chat/completions", { method: "POST", enforcePublicDns: true });
  assert(agents.length === 1, "restricted agents should be reused by HTTPS origin.");
  await transport("https://api.deepseek.com/chat/completions", { method: "POST", enforcePublicDns: false,
    headersTimeout: CONNECTION_TEST_TIMEOUT_MS, bodyTimeout: CONNECTION_TEST_TIMEOUT_MS });
  assert(!requests[2].options.dispatcher, "built-in provider requests should not receive the custom-connection dispatcher.");
  assert(requests[2].options.headersTimeout === CONNECTION_TEST_TIMEOUT_MS && requests[2].options.bodyTimeout === CONNECTION_TEST_TIMEOUT_MS,
    "the connection probe must keep its independent shorter request budget.");

  for (const records of [
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "192.168.1.3", family: 4 }],
    [{ address: "fe80::1", family: 6 }],
    [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.3", family: 4 }],
    [],
  ]) {
    const restrictedLookup = createPublicOnlyLookup({
      isUnsafeAddress: isUnsafeProviderHost,
      lookup: async () => records,
    });
    const error = await captureLookupError(restrictedLookup, "provider.test");
    assert(error?.code === "INVALID_PROVIDER_CONFIG", "private, mixed, or empty DNS results must be rejected.");
  }

  await transport.close();
  assert(agents[0].closed === true, "transport close should release cached Undici agents.");
  process.stdout.write("Provider HTTPS transport check passed.\n");
}

function invokeLookup(lookup, hostname, options = {}) {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (error, records, family) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(options.all ? records : [{ address: records, family }]);
    });
  });
}

async function captureLookupError(lookup, hostname) {
  try {
    await invokeLookup(lookup, hostname, { all: true });
    return null;
  } catch (error) {
    return error;
  }
}

function emptyBody() {
  return {
    async *[Symbol.asyncIterator]() {},
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
