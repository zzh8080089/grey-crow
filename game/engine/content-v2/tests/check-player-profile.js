"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createPlayerProfileStore } = require("..");
const { withTempFixture } = require("./test-fixtures/temp-workspace");

async function runPlayerProfileChecks() {
  return withTempFixture(async (workspace) => {
    const profileRoot = workspace.resolve("app-data/player-profile");
    const options = {
      profileRoot,
      defaultLanguage: "zh-CN",
      idFactory: () => "player_profile_stable",
      clock: () => "2026-07-14T00:00:00.000Z",
    };
    const store = createPlayerProfileStore(options);
    const created = await store.load();
    assert(created.profile.playerProfileId === "player_profile_stable", "profile id must be stable and system generated");
    assert(created.persistence.status === "created", "missing profile must be created explicitly");
    const emptyProjection = await store.projectForModel();
    assert(Object.keys(emptyProjection).sort().join(",") === "playerProfileId,schemaVersion", "system defaults must not become model-visible player claims");

    const saved = await store.save({
      displayName: "小灰",
      narrativePreferences: ["叙事保持简洁"],
      contentBoundaries: ["不描写过度血腥细节"],
      notes: "玩家明确填写的短备注。",
    });
    assert(saved.explicitFields.includes("displayName") && !saved.explicitFields.includes("pronouns"), "only explicitly saved fields may be projected");
    const projection = await store.projectForModel();
    assert(projection.displayName === "小灰" && projection.preferredLanguage === undefined, "projection must exclude unsaved defaults");

    await workspace.writeText("adventures/current/transcript.jsonl", "story survives profile operations\n");
    await workspace.writeText("app-data/secure-storage/provider-key.bin", "encrypted-key-marker\n");
    await fs.rm(workspace.resolve("adventures"), { recursive: true, force: true });
    const restarted = createPlayerProfileStore(options);
    const afterDeleteGame = await restarted.load();
    assert(afterDeleteGame.profile.playerProfileId === "player_profile_stable", "Delete Game must not change the global profile id");
    assert(afterDeleteGame.profile.displayName === "小灰", "Delete Game must not delete explicitly saved profile fields");

    await fs.writeFile(path.join(profileRoot, "profile.json"), "{broken profile\n", "utf8");
    const recovered = await restarted.load();
    assert(recovered.persistence.status === "recovered_default", "corrupt profile must recover to an empty projection");
    assert(recovered.persistence.warning === "PLAYER_PROFILE_RECOVERED_DEFAULT", "profile recovery must produce a stable warning");
    assert(recovered.profile.playerProfileId === "player_profile_stable", "profile corruption must not replace the stable identity");
    assert(recovered.profile.displayName === "" && recovered.explicitFields.length === 0, "corrupt profile must not leak stale claims into the model projection");
    assert(await fs.readFile(workspace.resolve("app-data/secure-storage/provider-key.bin"), "utf8") === "encrypted-key-marker\n", "profile recovery must not touch Key Vault data");

    await assertRejects("PLAYER_PROFILE_SECRET_REJECTED", () => restarted.save({ notes: "sk-secret-value-123456" }));
    await assertRejects("CONTRACT_INVALID", () => restarted.save({ notes: "x".repeat(2001) }));
    await assertRejects("PLAYER_PROFILE_FIELD_FORBIDDEN", () => restarted.save({ oldStorySummary: "must not be accepted" }));

    return {
      name: "p2-23-player-profile",
      ok: true,
      details: {
        stable_id: true,
        explicit_fields_only: true,
        delete_game_preserves_profile: true,
        corruption_recovers_empty_projection: true,
        key_vault_untouched: true,
        story_fields_forbidden: true,
        limits_enforced: true,
      },
    };
  }, { prefix: "p2-23-player-profile" });
}

async function assertRejects(code, callback) {
  try {
    await callback();
  } catch (error) {
    assert(error?.code === code, `expected ${code}, received ${error?.code || "unknown"}`);
    return;
  }
  throw new Error(`expected ${code}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

module.exports = { runPlayerProfileChecks };
