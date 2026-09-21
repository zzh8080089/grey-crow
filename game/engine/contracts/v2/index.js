"use strict";

const { ERROR_CODES, GreyCrowError, sanitizeMeta } = require("../../providers/provider-contracts");
const registry = require("./schema-registry.json");
const generated = require("./generated/validators.cjs");
const { validateSemanticContract } = require("./semantic-checks");

const CONTRACTS = new Map();
const CONTRACTS_BY_SCHEMA_VERSION = new Map();

for (const entry of registry.contracts) {
  const validator = generated[entry.exportName];
  if (typeof validator !== "function") {
    throw new Error(`Generated contract validator ${entry.exportName} is missing.`);
  }
  const contract = Object.freeze({ ...entry, validator });
  CONTRACTS.set(entry.contractId, contract);
  CONTRACTS_BY_SCHEMA_VERSION.set(entry.schemaVersion, contract);
}

function validateContract(contractId, value) {
  const normalizedContractId = String(contractId || "").trim();
  const contract = CONTRACTS.get(normalizedContractId);
  if (!contract) {
    throw new GreyCrowError(
      ERROR_CODES.CONTRACT_UNKNOWN_SCHEMA,
      "The requested Grey Crow contract is not registered.",
      {
        retryable: false,
        meta: { contract_id: normalizedContractId || "unknown" },
      }
    );
  }

  const structurallyValid = contract.validator(value);
  const issues = structurallyValid
    ? []
    : sanitizeValidationIssues(contract.validator.errors);
  issues.push(...validateSemanticContract(normalizedContractId, value));

  if (issues.length > 0) {
    throw new GreyCrowError(
      ERROR_CODES.CONTRACT_INVALID,
      "The Grey Crow contract failed validation.",
      {
        retryable: false,
        meta: {
          contract_id: normalizedContractId,
          issue_count: issues.length,
          issues: issues.slice(0, 32),
        },
      }
    );
  }

  return sanitizeMeta({
    ok: true,
    contract_id: normalizedContractId,
    schema_version: contract.schemaVersion,
  });
}

function detectContractVersion(value) {
  const schemaVersion = readSchemaVersion(value);
  const known = CONTRACTS_BY_SCHEMA_VERSION.get(schemaVersion);
  if (known) {
    const version = readContractMajorVersion(schemaVersion);
    return sanitizeMeta({
      kind: version ? `v${version}` : "known",
      version,
      contract_id: known.contractId,
      schema_version: schemaVersion,
    });
  }
  if (schemaVersion === 1 || (typeof schemaVersion === "string" && /(?:^|-)v1$/.test(schemaVersion))) {
    return sanitizeMeta({
      kind: "v1",
      version: 1,
      schema_version: schemaVersion,
    });
  }
  return sanitizeMeta({
    kind: "unknown",
    version: null,
    schema_version: schemaVersion || "unknown",
  });
}

function readContractMajorVersion(schemaVersion) {
  const match = typeof schemaVersion === "string" ? schemaVersion.match(/(?:^|-)v([1-9][0-9]*)$/) : null;
  return match ? Number(match[1]) : null;
}

function listContracts() {
  return registry.contracts.map((entry) => sanitizeMeta({
    contract_id: entry.contractId,
    schema_version: entry.schemaVersion,
  }));
}

function readSchemaVersion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value.schemaVersion ?? value.schema_version ?? null;
}

function sanitizeValidationIssues(errors) {
  return (Array.isArray(errors) ? errors : []).map((error) => ({
    instance_path: sanitizeIssueText(error?.instancePath || "/", 240),
    keyword: sanitizeIssueText(error?.keyword || "invalid", 80),
    message: sanitizeIssueText(error?.message || "contract validation failed", 240),
  }));
}

function sanitizeIssueText(value, maxLength) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, maxLength);
}

module.exports = {
  validateContract,
  detectContractVersion,
  listContracts,
};
