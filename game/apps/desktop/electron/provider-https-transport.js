"use strict";

const dns = require("node:dns");
const net = require("node:net");
const { Agent, request } = require("undici");

function createProviderHttpsTransport(options = {}) {
  const requestFn = options.requestFn || request;
  const AgentClass = options.AgentClass || Agent;
  const lookup = options.lookup || dns.lookup;
  const isUnsafeAddress = options.isUnsafeAddress;
  const restrictedAgents = new Map();

  if (typeof isUnsafeAddress !== "function") {
    throw new TypeError("provider HTTPS transport requires an address safety predicate");
  }

  const requestImpl = async (url, requestOptions = {}) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw transportError("INVALID_PROVIDER_CONFIG", "Provider transport requires HTTPS.");
    }

    const dispatcher = requestOptions.enforcePublicDns
      ? getRestrictedAgent(parsed.origin)
      : undefined;
    const {
      enforcePublicDns: _enforcePublicDns,
      provider: _provider,
      model: _model,
      redirect: _redirect,
      ...undiciOptions
    } = requestOptions;

    return requestFn(parsed, {
      ...undiciOptions,
      maxRedirections: 0,
      ...(dispatcher ? { dispatcher } : {}),
    });
  };

  requestImpl.close = async () => {
    await Promise.all([...restrictedAgents.values()].map((agent) => agent.close?.()));
    restrictedAgents.clear();
  };

  return requestImpl;

  function getRestrictedAgent(origin) {
    if (!restrictedAgents.has(origin)) {
      restrictedAgents.set(origin, new AgentClass({
        connect: {
          lookup: createPublicOnlyLookup({ lookup, isUnsafeAddress }),
        },
      }));
    }
    return restrictedAgents.get(origin);
  }
}

function createPublicOnlyLookup({ lookup = dns.lookup, isUnsafeAddress } = {}) {
  if (typeof lookup !== "function" || typeof isUnsafeAddress !== "function") {
    throw new TypeError("public-only lookup requires lookup and address predicate functions");
  }

  return (hostname, options, callback) => {
    const normalizedOptions = typeof options === "object" && options ? options : {};
    resolveAll(hostname, lookup)
      .then((records) => {
        if (!records.length || records.some((record) => isUnsafeAddress(record.address))) {
          throw transportError(
            "INVALID_PROVIDER_CONFIG",
            "Provider host resolved to an address that is not allowed."
          );
        }

        const family = Number(normalizedOptions.family) || 0;
        const eligible = family ? records.filter((record) => record.family === family) : records;
        if (!eligible.length) {
          throw transportError("INVALID_PROVIDER_CONFIG", "Provider host has no usable public address.");
        }
        if (normalizedOptions.all) {
          callback(null, eligible);
          return;
        }
        callback(null, eligible[0].address, eligible[0].family);
      })
      .catch((error) => callback(normalizeLookupError(error)));
  };
}

function resolveAll(hostname, lookup) {
  if (net.isIP(hostname)) {
    return Promise.resolve([{ address: hostname, family: net.isIP(hostname) }]);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, records, family) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve(normalizeLookupRecords(records, family));
    };

    try {
      const returned = lookup(hostname, { all: true, verbatim: true }, finish);
      if (returned && typeof returned.then === "function") {
        returned.then((records) => finish(null, records)).catch(finish);
      }
    } catch (error) {
      finish(error);
    }
  });
}

function normalizeLookupRecords(records, family) {
  const source = Array.isArray(records) ? records : [{ address: records, family }];
  return source
    .map((record) => {
      const address = typeof record === "string" ? record : String(record?.address || "");
      const resolvedFamily = Number(typeof record === "string" ? family : record?.family) || net.isIP(address);
      return { address, family: resolvedFamily };
    })
    .filter((record) => record.address && (record.family === 4 || record.family === 6));
}

function normalizeLookupError(error) {
  if (error?.code === "INVALID_PROVIDER_CONFIG") {
    return error;
  }
  return transportError("INVALID_PROVIDER_CONFIG", "Provider host could not be resolved.");
}

function transportError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

module.exports = {
  createProviderHttpsTransport,
  createPublicOnlyLookup,
};
