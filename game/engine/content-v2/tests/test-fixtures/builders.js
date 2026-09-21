"use strict";

// Only the deterministic content-pack builder is retained.
function createDeterministicFixtureBuilders() {
  function buildPack(overrides = {}) {
    const language = overrides.language || "zh-CN";
    return {
      schemaVersion: "grey-crow-extension-pack-v2",
      id: overrides.id || "fixture-pack",
      title: overrides.title || "Fixture Pack",
      version: overrides.version || "2.0.0",
      author: overrides.author || "Grey Crow Tests",
      engineCompatibility: overrides.engineCompatibility || ">=2 <3",
      languages: [language],
      provides: overrides.provides || [
        {
          type: "host",
          id: "fixture-host",
          title: "Fixture Host",
          path: "host/FIXTURE.md",
          language,
          description: "Deterministic host fixture.",
          danger: "low",
        },
        {
          type: "skill",
          skillClass: "ordinary",
          id: "fixture-memory-skill",
          title: "Fixture Memory Skill",
          path: "skills/memory/SKILL.md",
          language,
          description: "Deterministic on-demand memory fixture.",
          danger: "low",
          triggers: ["memory"],
          templates: [],
          readScopes: ["memory", "transcript"],
          writeScopes: ["memory"],
        },
      ],
      permissions: overrides.permissions || ["read_base_content", "write_current_saveRoot_via_tools"],
      conflicts: overrides.conflicts || [],
    };
  }

  return Object.freeze({ buildPack });
}
module.exports = { createDeterministicFixtureBuilders };
