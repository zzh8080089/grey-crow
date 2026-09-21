"use strict";

const { test } = require("node:test");
const checks = [
  ["pack validation and deterministic resolution", "check-pack-validator", "runPackValidatorResolverChecks"],
  ["official content selection and retained gameplay rules", "check-pack-validator", "runBuiltInPackChecks"],
  ["snapshot compilation, source hashes and read-only content", "check-snapshot-compiler", "runSnapshotCompilerChecks"],
  ["locked locale coverage, cache identity and source preservation", "check-skill-locale-resolver", "runSkillLocaleResolverChecks"],
  ["official Chinese, English and Japanese content", "check-built-in-skill-localizations", "runBuiltInSkillLocalizationChecks"],
  ["player profile persists independently of story files", "check-player-profile", "runPlayerProfileChecks"],
  ["content library import, editor and deletion boundaries", "check-content-library", "runContentLibraryChecks"],
];
for (const [name, moduleName, method] of checks) {
  test(name, async () => {
    const result = await require(`./${moduleName}`)[method]();
    if (!result?.ok) throw new Error(`Content check failed: ${name}`);
  });
}
