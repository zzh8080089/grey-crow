#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { deepStrictEqual } = require("node:assert/strict");
const {
  createSettingsStore,
  getSettingsCatalog,
  mergeDesktopSettings,
  normalizeDesktopSettings,
  settingsAffectProvider,
} = require("../settings-store");
const {
  createCustomConnection,
  markCustomConnectionVerified,
} = require("../model-connections");
const {
  projectRestoredContextUsage,
  selectCurrentContextUsage,
  validateActiveContextPolicy,
} = require("../context-settings-policy");
const { normalizeContextWindowPolicy } = require(path.resolve(__dirname, "../../../..", "engine/runtime/context-window-policy"));
const { createBuiltinProviderRegistry } = require(path.resolve(__dirname, "../../../..", "engine/providers/provider-registry"));

const secret = "TEST_SECRET_SHOULD_NOT_PERSIST_1234567890";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-settings-"));
const store = createSettingsStore({ dataRoot: tmp });
const defaults = store.load();
assert(defaults.localization.preferredLocale === "zh-CN", "a fresh settings store must default to Simplified Chinese.");
assert(defaults.ui.windowMode === "standard", "a fresh settings store must default to the standard 1600x900 window mode.");
assert(defaults.ui.gameUiLayout === "story-notebook-v1", "a fresh settings store must default to the notebook interface.");
assert(defaults.ui.storyNotebookTheme === "light", "a fresh settings store must default notebook paper to the light theme.");
assert(defaults.narration.lengthPreset === "standard", "a fresh settings store must retain the standard narration preference.");
assert(defaults.api.model === "deepseek-flash", "fresh settings must use the current official Flash ID.");
deepStrictEqual(defaults.audio.input, { enabled: false, language: "zh", deviceId: "default" },
  "speech input must remain disabled on first launch with independent Chinese recognition defaults.");
assert(defaults.audio.tts.enabled === false && defaults.audio.tts.autoPlay === true,
  "first launch must keep optional narration off while making newly enabled narration read fresh turns automatically.");
assert(normalizeDesktopSettings(mergeDesktopSettings(defaults, { audio: { tts: { autoPlay: false } } })).audio.tts.autoPlay === false,
  "an explicit existing choice to keep narration manual must not be changed by the new default.");
const disabledAutomaticNarration = normalizeDesktopSettings({ audio: { tts: {
  enabled: false, autoPlay: true, provider: "kokoro-original-local",
} } });
assert(disabledAutomaticNarration.audio.tts.enabled === false && disabledAutomaticNarration.audio.tts.autoPlay === true,
  "turning narration off must retain the previously selected automatic playback mode.");
assert(fs.existsSync(store.path), "first-launch defaults must be persisted immediately.");

for (const fixture of [
  { name: "legacy-null", settings: { localization: { preferredLocale: null } } },
  { name: "legacy-missing", settings: {} },
  { name: "invalid-stored", settings: { localization: { preferredLocale: "fr-FR" } } },
]) {
  const migrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), `grey-crow-settings-${fixture.name}-`));
  const migrationPath = path.join(migrationRoot, "settings.json");
  fs.writeFileSync(migrationPath, JSON.stringify(fixture.settings));
  const migrated = createSettingsStore({ dataRoot: migrationRoot }).load();
  const migratedOnDisk = JSON.parse(fs.readFileSync(migrationPath, "utf8"));
  assert(migrated.localization.preferredLocale === "zh-CN", `${fixture.name} must normalize to Simplified Chinese.`);
  assert(migratedOnDisk.localization.preferredLocale === "zh-CN", `${fixture.name} migration must persist across restart.`);
  assert(migrated.ui.gameUiLayout === "story-notebook-v1", `${fixture.name} must normalize to the notebook interface.`);
  assert(migratedOnDisk.ui.gameUiLayout === "story-notebook-v1", `${fixture.name} interface migration must persist across restart.`);
}

const classicLayoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-settings-classic-layout-"));
for (const oldVoice of [undefined, "", "zf_001"]) {
  const voiceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-settings-old-voice-"));
  fs.writeFileSync(path.join(voiceRoot, "settings.json"), JSON.stringify({
    ui: { storyNotebookTheme: "light" }, audio: { tts: { enabled: false, provider: "disabled", voiceId: oldVoice } },
  }));
  const voiceStore = createSettingsStore({ dataRoot: voiceRoot });
  const loaded = voiceStore.load();
  const accepted = voiceStore.save(mergeDesktopSettings(loaded, { ui: { storyNotebookTheme: "dark" } }));
  assert(accepted.audio.tts.voiceId === (oldVoice || "zm_010"), "missing voices normalize without replacing an explicit voice");
  assert(!accepted.audio.tts.enabled, "normalizing a voice must not enable narration");
  deepStrictEqual(createSettingsStore({ dataRoot: voiceRoot }).load(), accepted,
    "theme-only save must return the same canonical preferences that reload after restart");
  fs.rmSync(voiceRoot, { recursive: true, force: true });
}
const classicLayoutPath = path.join(classicLayoutRoot, "settings.json");
fs.writeFileSync(classicLayoutPath, JSON.stringify({ ui: { gameUiLayout: "classic" } }));
const classicLayoutMigrated = createSettingsStore({ dataRoot: classicLayoutRoot }).load();
assert(classicLayoutMigrated.ui.gameUiLayout === "story-notebook-v1", "a saved Classic preference must migrate to the notebook interface.");
assert(JSON.parse(fs.readFileSync(classicLayoutPath, "utf8")).ui.gameUiLayout === "story-notebook-v1",
  "the migrated Classic preference must persist across restart.");

const saved = store.save({
  localization: {
    preferredLocale: "en-US",
  },
  api: {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: secret,
  },
  narration: {
    lengthPreset: "custom",
    customTargetChars: 9999,
    apiKey: secret,
  },
  agent: {
    context: {
      configuredContextWindow: 2_000_000,
      autoCompactRatio: 0.99,
      apiKey: secret,
    },
  },
  ui: {
    narrationTextSize: "large",
    sidePanelTextSize: "small",
    windowMode: "large",
    gameUiLayout: "story-notebook-v1",
    storyNotebookTheme: "dark",
    apiKey: secret,
  },
  audio: {
    gameVolume: 500,
    tts: {
      enabled: true,
      autoPlay: true,
      provider: "disabled",
      voiceId: "voice-a",
      rate: "+0%",
      pitch: "+0Hz",
      cacheUtteranceLimit: 999,
      apiKey: secret,
    },
  },
  developer: {
    debugPanelEnabled: true,
    apiKey: secret,
  },
  save: {
    chapterLog: {
      intervalTurns: 999,
      onManualSave: false,
      onAutoSave: true,
      onCompaction: false,
      secretValue: secret,
    },
  },
  apiKey: secret,
});
const raw = fs.readFileSync(store.path, "utf8");

assert(saved.audio.gameVolume === 100, "gameVolume should be clamped.");
assert(saved.localization.preferredLocale === "en-US", "menu locale preference should persist independently of Adventure saves.");
assert(saved.narration.lengthPreset === "custom", "custom narration preset should persist.");
assert(saved.narration.customTargetChars === 800, "custom narration target should clamp to maximum.");
assert(saved.agent.context.configuredContextWindow === 1_000_000, "context window should not exceed the configured provider profile.");
assert(saved.agent.context.autoCompactRatio === 0.85, "auto compact ratio should not exceed the safe configurable maximum.");
assert(saved.ui.narrationTextSize === "large", "narration text size should persist.");
assert(saved.ui.sidePanelTextSize === "small", "side-panel text size should persist.");
assert(saved.ui.windowMode === "large", "bounded window modes should persist.");
assert(saved.ui.gameUiLayout === "story-notebook-v1", "the selected game UI layout should persist.");
assert(saved.ui.storyNotebookTheme === "dark", "the selected notebook paper theme should persist.");
assert(saved.audio.tts.enabled === false, "disabled TTS provider should disable TTS.");
assert(saved.audio.tts.cacheUtteranceLimit === 20, "unsupported TTS cache limits should fall back to 20 utterances.");
assert(saved.developer.debugPanelEnabled === true, "developer debug panel preference should persist.");
assert(!Object.hasOwn(saved.save, "autoSave"), "normalized save preferences must not imply that durable story commits can be disabled.");
assert(saved.save.chapterLog.intervalTurns === 300, "automatic chapter interval should clamp to the supported maximum.");
assert(saved.save.chapterLog.onManualSave === false, "manual save chapter-log preference should persist.");
assert(saved.save.chapterLog.onAutoSave === true, "auto save chapter-log preference should persist.");
assert(saved.save.chapterLog.onCompaction === false, "compaction chapter-log preference should persist.");
assert(!raw.includes(secret), "settings.json must not persist API keys.");
assert(!raw.includes("apiKey") && !raw.includes("api_key") && !raw.includes("secretValue"), "settings.json must not persist key fields.");

const reloaded = createSettingsStore({ dataRoot: tmp }).load();
assert(JSON.stringify(reloaded) === JSON.stringify(saved), "saved settings should reload cleanly.");
assert(!fs.readdirSync(tmp).some((name) => name.endsWith(".tmp")), "atomic settings writes must not leave temporary files behind.");

const recoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-settings-recovery-"));
const recoveryStore = createSettingsStore({ dataRoot: recoveryRoot });
const firstValid = recoveryStore.save({ narration: { lengthPreset: "short" } });
const secondValid = recoveryStore.save({ narration: { lengthPreset: "detailed" } });
assert(secondValid.narration.lengthPreset === "detailed", "second settings write should become current.");
assert(
  JSON.parse(fs.readFileSync(recoveryStore.backupPath, "utf8")).narration.lengthPreset === firstValid.narration.lengthPreset,
  "settings backup should contain the previous valid configuration."
);
const vaultPath = path.join(recoveryRoot, "provider-vault.bin");
const savePath = path.join(recoveryRoot, "saves", "save-1", "state.json");
fs.mkdirSync(path.dirname(savePath), { recursive: true });
fs.writeFileSync(vaultPath, "encrypted-provider-vault");
fs.writeFileSync(savePath, '{"turn":7}');
fs.writeFileSync(recoveryStore.path, "{broken-current");
const recoveredStore = createSettingsStore({ dataRoot: recoveryRoot });
const recovered = recoveredStore.load();
assert(recovered.narration.lengthPreset === "short", "a damaged current file should recover the last valid backup.");
assert(recoveredStore.status().status === "recovered_from_backup", "backup recovery should expose an explicit persistence status.");
assert(recoveredStore.consumeStatus().noticeRequired === true, "backup recovery should request one player warning.");
assert(recoveredStore.consumeStatus().noticeRequired === false, "the recovery warning should be consumed only once.");
assert(JSON.parse(fs.readFileSync(recoveredStore.path, "utf8")).narration.lengthPreset === "short", "backup recovery should atomically repair settings.json.");
assert(fs.readFileSync(vaultPath, "utf8") === "encrypted-provider-vault", "settings recovery must not alter the provider vault.");
assert(fs.readFileSync(savePath, "utf8") === '{"turn":7}', "settings recovery must not alter saveRoot content.");

fs.writeFileSync(recoveredStore.path, "{broken-current-again");
fs.writeFileSync(recoveredStore.backupPath, "{broken-backup");
const defaultedStore = createSettingsStore({ dataRoot: recoveryRoot });
const defaulted = defaultedStore.load();
assert(defaulted.narration.lengthPreset === "standard", "two damaged settings files should restore defaults.");
assert(defaulted.localization.preferredLocale === "zh-CN", "settings recovery must restore the Simplified Chinese default.");
assert(defaultedStore.status().status === "reset_to_defaults", "default recovery should expose an explicit persistence status.");
assert(JSON.parse(fs.readFileSync(defaultedStore.path, "utf8")).api.provider === "deepseek", "default recovery should repair settings.json.");
assert(fs.readFileSync(vaultPath, "utf8") === "encrypted-provider-vault", "default recovery must preserve the provider vault.");
assert(fs.readFileSync(savePath, "utf8") === '{"turn":7}', "default recovery must preserve saveRoot content.");

const previous = normalizeDesktopSettings({ api: { provider: "deepseek", model: "deepseek-v4-flash" } });
const merged = normalizeDesktopSettings(
  mergeDesktopSettings(previous, {
    localization: {
      preferredLocale: "ja-JP",
    },
    narration: {
      lengthPreset: "detailed",
      customTargetChars: 500,
    },
    agent: {
      context: {
        configuredContextWindow: 512_000,
        autoCompactRatio: 0.65,
      },
    },
    ui: {
      narrationTextSize: "small",
      sidePanelTextSize: "large",
      windowMode: "compact",
      gameUiLayout: "story-notebook-v1",
    },
    audio: {
      gameVolume: 42,
      tts: {
        enabled: true,
        provider: "kokoro-original-local",
        voiceId: "zf_006",
        cacheUtteranceLimit: 40,
      },
    },
    developer: {
      debugPanelEnabled: false,
    },
    save: {
      chapterLog: {
        intervalTurns: 40,
        onAutoSave: false,
        onCompaction: false,
      },
    },
  })
);
assert(merged.localization.preferredLocale === "ja-JP", "locale preference patches should merge through the desktop settings contract.");
assert(normalizeDesktopSettings({ localization: { preferredLocale: "fr-FR" } }).localization.preferredLocale === "zh-CN", "unsupported stored locale values must recover to the safe Simplified Chinese default.");
assert(normalizeDesktopSettings({ localization: { preferredLocale: null } }).localization.preferredLocale === "zh-CN", "legacy null locale values must migrate to Simplified Chinese.");
assert(getSettingsCatalog().localization.options.map((item) => item.id).join(",") === "zh-CN,en-US,ja-JP", "settings catalog must reuse the canonical three-locale registry.");
assert(merged.narration.lengthPreset === "detailed", "merged narration preset should persist.");
assert(merged.narration.customTargetChars === null, "non-custom narration presets should clear custom target.");
assert(merged.audio.gameVolume === 42, "merged audio settings should persist.");
assert(merged.agent.context.configuredContextWindow === 512_000, "agent context window should merge independently.");
assert(merged.agent.context.autoCompactRatio === 0.65, "agent auto compact ratio should merge independently.");
assert(merged.ui.narrationTextSize === "small", "narration text size should merge independently.");
assert(merged.ui.sidePanelTextSize === "large", "side-panel text size should merge independently.");
assert(merged.ui.windowMode === "compact", "window mode should merge independently.");
assert(merged.ui.gameUiLayout === "story-notebook-v1", "game UI layout should merge independently.");
assert(normalizeDesktopSettings({ ui: { windowMode: "freeform" } }).ui.windowMode === "standard", "unknown window modes must recover to the standard preset.");
assert(normalizeDesktopSettings({ ui: { gameUiLayout: "immersive-freeform" } }).ui.gameUiLayout === "story-notebook-v1", "unknown game UI layouts must recover to the notebook interface.");
assert(merged.audio.tts.enabled === true && merged.audio.tts.provider === "kokoro-original-local", "enabled original Kokoro TTS should persist as active.");
assert(merged.audio.tts.voiceId === "zf_006", "enabled TTS voice should persist.");
assert(merged.audio.tts.cacheUtteranceLimit === 40, "bounded TTS cache limit should persist.");
assert(merged.developer.debugPanelEnabled === false, "developer settings should merge independently from provider settings.");
assert(merged.save.chapterLog.onAutoSave === false, "automatic chapter preferences should merge independently from provider settings.");
assert(merged.save.chapterLog.intervalTurns === 40, "preset automatic chapter intervals should persist.");
assert(merged.save.chapterLog.onManualSave === true, "omitted chapter-log settings should keep previous/default values.");
assert(merged.save.chapterLog.onCompaction === false, "chapter-log settings should persist.");
assert(settingsAffectProvider(previous, merged) === false, "non-provider settings should not invalidate provider bridge.");
checkSpeechInputSettings(merged);

const providerChanged = normalizeDesktopSettings({ api: { provider: "deepseek", model: "other" } });
assert(providerChanged.api.model === "deepseek-flash", "unsupported builtin models should use the current default.");
const removedKokoro = normalizeDesktopSettings({
  audio: {
    tts: {
      enabled: true,
      provider: "kokoro-local",
      voiceId: "zm_010",
      rate: "+15%",
      cacheUtteranceLimit: 40,
    },
  },
});
assert(removedKokoro.audio.tts.enabled === false && removedKokoro.audio.tts.provider === "disabled", "removed sherpa settings should migrate to disabled TTS.");
assert(removedKokoro.audio.tts.voiceId === "zm_010" && removedKokoro.audio.tts.rate === "+15%" && removedKokoro.audio.tts.cacheUtteranceLimit === 40, "legacy migration should preserve reusable audio preferences.");
const proProvider = normalizeDesktopSettings({ api: { provider: "deepseek", model: "deepseek-v4-pro" } });
assert(proProvider.api.model === "deepseek-v4-pro", "DeepSeek Pro should be selectable with the provider-scoped credential.");
const customDraft = createCustomConnection({
  name: "My OpenAI-compatible model",
  baseUrl: "https://api.example.com/v1/chat/completions",
  modelId: "vendor/model-a",
}, { id: "custom_0123456789abcdef" });
const verifiedCustom = markCustomConnectionVerified([customDraft], customDraft.id, "2026-07-12T00:00:00.000Z").connection;
const customProvider = normalizeDesktopSettings({
  api: {
    provider: "openai-compatible",
    connectionId: verifiedCustom.id,
    customConnections: [verifiedCustom],
  },
  agent: { context: { configuredContextWindow: 128_000 } },
});
assert(customProvider.api.provider === "openai-compatible" && customProvider.api.model === "vendor/model-a", "a valid custom connection should own its model ID.");
assert(customProvider.agent.context.configuredContextWindow === 128_000, "advanced settings should allow a custom connection above its 64K default.");
const missingCustom = normalizeDesktopSettings({ api: { provider: "openai-compatible", model: "custom" } });
assert(missingCustom.api.provider === "deepseek", "custom provider selection without a saved connection should fall back safely.");
const invalidNarration = normalizeDesktopSettings({
  narration: {
    lengthPreset: "verbose",
    customTargetChars: "900",
  },
});
assert(invalidNarration.narration.lengthPreset === "standard", "unknown narration preset should fall back to standard.");
assert(invalidNarration.narration.customTargetChars === null, "standard narration should not keep custom target.");
const shortCustomNarration = normalizeDesktopSettings({
  narration: {
    lengthPreset: "custom",
    customTargetChars: 40,
  },
});
assert(shortCustomNarration.narration.customTargetChars === 120, "custom narration target should clamp to minimum.");
const adaptiveNarration = normalizeDesktopSettings({ narration: { lengthPreset: "adaptive", customTargetChars: 700 } });
assert(adaptiveNarration.narration.lengthPreset === "adaptive" && adaptiveNarration.narration.customTargetChars === null,
  "adaptive narration must persist independently of the custom character target.");

const catalog = getSettingsCatalog();
const catalogRaw = JSON.stringify(catalog);
const deepseekCatalog = catalog.api.providers.find((provider) => provider.id === "deepseek");
const flashOption = deepseekCatalog.models.find((model) => model.id === "deepseek-flash");
assert(flashOption?.enabled === true && flashOption.status === "experimental" && flashOption.contextLimit === 1_000_000,
  "the new Flash model must be selectable with its bounded context and experimental status.");
const registry = createBuiltinProviderRegistry();
const flashProfile = registry.getModelProfile("deepseek", "deepseek-flash");
assert(flashProfile.id === "deepseek-flash" && flashProfile.status === "experimental",
  "the new Flash model must have an explicit experimental profile rather than fall back to a custom model.");
assert(flashProfile.limits.contextTokens === 1_000_000 && flashProfile.limits.providerMaxOutputTokens === 384_000
  && flashProfile.limits.adapterRequestCapTokens === 32_768 && flashProfile.limits.defaultOutputTokens === 2_048,
  "the advertised Flash capacity must not raise the adapter cap or default output budget.");
assert(registry.getProviderProfile("deepseek").defaultModel === "deepseek-flash",
  "the registry default must agree with fresh desktop settings.");
const legacyFlash = deepseekCatalog.models.find((model) => model.id === "deepseek-v4-flash");
assert(legacyFlash?.aliasOf === "deepseek-flash" && legacyFlash.status === "experimental",
  "the accepted legacy alias must not imply the retired V4 model remains verified.");
assert(registry.getModelProfile("deepseek", "deepseek-v4-flash").aliasOf === "deepseek-flash",
  "desktop and engine catalogs must agree on the legacy alias without rewriting its ID.");
for (const model of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"]) {
  const modelRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-settings-model-"));
  try {
    const modelStore = createSettingsStore({ dataRoot: modelRoot });
    const selected = modelStore.save({ api: { provider: "deepseek", model } });
    assert(selected.api.model === model, "selecting a supported model must preserve its exact ID.");
    const provider = registry.create({ ...selected.api, maxOutputTokens: 8_192,
      requestImpl: () => { throw new Error("This settings check must not call a provider."); } });
    assert(provider.model === model, "constructing the provider must preserve the selected model ID.");
    assert(createSettingsStore({ dataRoot: modelRoot }).load().api.model === model,
      "reopening settings must preserve both new and existing model IDs.");
  } finally {
    fs.rmSync(modelRoot, { recursive: true, force: true });
  }
}
assert(settingsAffectProvider(previous, normalizeDesktopSettings({ api: { provider: "deepseek", model: "deepseek-flash" } })),
  "switching to the new Flash ID must invalidate the old provider selection.");
assert(catalog.schemaVersion === "desktop-settings-runtime-v1", "settings catalog should expose schema version.");
assert(catalog.api.providers.some((provider) => provider.id === "deepseek" && provider.enabled === true), "DeepSeek should be enabled in catalog.");
assert(catalog.api.providers.some((provider) => provider.id === "deepseek" && provider.models.some((model) => model.id === "deepseek-v4-pro" && model.tier === "advanced")), "DeepSeek catalog should expose the advanced Pro model.");
assert(catalog.api.providers.some((provider) => provider.id === "openai-compatible" && provider.enabled === true && provider.custom === true), "custom OpenAI-compatible connections should be enabled without placeholder models.");
assert(!catalog.api.providers.some((provider) => provider.enabled === false), "ordinary model settings should not expose unusable provider placeholders.");
assert(catalog.modelHelp?.entries?.length >= 6 && !JSON.stringify(catalog.modelHelp).includes("https://"), "renderer model help should be local and URL-free.");
assert(!catalog.audio.ttsProviders.some((provider) => provider.id === "kokoro-local"), "removed sherpa Kokoro must not remain in the player catalog.");
assert(catalog.audio.ttsProviders.some((provider) => provider.id === "kokoro-original-local" && provider.enabled === true && provider.experimental === true && provider.online === false), "original Kokoro candidate should be visible as an experimental local provider.");
assert(catalog.audio.ttsProviders.some((provider) => provider.id === "minimax" && provider.enabled === false), "future external TTS providers should remain disabled.");
assert(catalog.audio.ttsDefaults.voiceId === "zm_010", "the curated male apocalypse voice should be the default TTS voice.");
assert(catalog.audio.ttsProviders.find((provider) => provider.id === "kokoro-original-local")?.voices?.[0]?.id === "zm_010", "the default male voice should appear first in the player catalog.");
assert(JSON.stringify(catalog.audio.ttsDefaults.cacheUtterancePresets) === JSON.stringify([10, 20, 40]), "TTS cache catalog should expose only 10/20/40 utterance presets.");
assert(catalog.audio.ttsDefaults.cacheUtteranceLimit === 20 && catalog.audio.ttsDefaults.cacheMaxBytes === 500 * 1024 * 1024, "TTS cache catalog should expose the 20 utterance / 500 MiB defaults.");
assert(catalog.narration.defaultPreset === "standard", "narration catalog should expose default preset.");
assert(catalog.narration.lengthPresets.some((preset) => preset.id === "short" && preset.targetChars === 200), "narration catalog should expose short preset.");
assert(catalog.narration.lengthPresets.some((preset) => preset.id === "adaptive" && preset.targetChars === 600),
  "narration catalog should expose the adaptive preset without changing the standard default.");
assert(catalog.narration.lengthPresets.some((preset) => preset.id === "custom"), "narration catalog should expose custom preset.");
assert(catalog.narration.customTargetChars.min === 120 && catalog.narration.customTargetChars.max === 800, "narration catalog should expose custom target range.");
assert(catalog.agent.context.configuredContextWindowDefault === 256_000, "agent context catalog should expose the safe default window.");
assert(catalog.agent.context.autoCompactRatioDefault === 0.75, "agent context catalog should expose the default compact ratio.");
assert(catalog.agent.context.emergencyGuardRatio === 0.9, "agent context catalog should keep the emergency guard fixed.");
assert(catalog.ui.narrationTextSizeDefault === "medium", "UI catalog should expose the narration text default.");
assert(catalog.ui.sidePanelTextSizeDefault === "medium", "UI catalog should expose the side-panel text default.");
assert(catalog.ui.textSizePresets.map((preset) => preset.id).join(",") === "small,medium,large", "UI catalog should expose only bounded text-size presets.");
assert(catalog.ui.windowModeDefault === "standard", "UI catalog should expose the standard window default.");
assert(catalog.ui.gameUiLayoutDefault === "story-notebook-v1", "UI catalog should expose the notebook as the fresh-install interface default.");
assert(catalog.ui.gameUiLayouts.join(",") === "story-notebook-v1", "UI catalog should expose only the notebook layout.");
assert(
  catalog.ui.windowModes.map((mode) => mode.id).join(",") === "compact,standard,large,qhd,fullscreen",
  "UI catalog should expose only the five controlled window modes."
);
assert(
  catalog.ui.windowModes.filter((mode) => mode.kind === "windowed").every((mode) => mode.contentWidth / mode.contentHeight === 16 / 9),
  "all windowed presets must preserve the fixed 16:9 composition."
);
assert(catalog.developer.debugPanel.defaultEnabled === false, "debug panel should remain hidden by default.");
assert(catalog.save.durableEveryTurn === true && !Object.hasOwn(catalog.save, "autoSave"), "save catalog must distinguish durable turns from optional chapter generation.");
assert(catalog.save.chapterLog.intervalDefault === 60, "chapter catalog must retain the configured 60-turn default.");
assert(JSON.stringify(catalog.save.chapterLog.intervalPresets) === JSON.stringify([40, 60, 80, 100]), "chapter catalog must expose the player interval choices.");
assert(catalog.save.chapterLog.customInterval.min === 20 && catalog.save.chapterLog.customInterval.max === 300, "chapter catalog must keep the bounded custom interval.");
assert(catalog.save.chapterLog.onManualSaveDefault === true && catalog.save.chapterLog.onAutoSaveDefault === true && catalog.save.chapterLog.onCompactionDefault === true, "chapter log generation should default to enabled for save/auto/compaction nodes.");
assert(catalog.security.credentialPersistence === "secure-storage", "API key persistence should prefer secure storage.");
assert(catalog.security.requiresRetestAfterRestart === false, "settings catalog should allow secure credential restore after restart.");
assert(catalog.security.persistentCredentialAvailable === true, "settings catalog should expose remember-key availability through safeStorage.");
assert(catalog.security.secureStorageNotice.includes("系统安全凭据存储"), "settings catalog should explain secure credential storage.");
assert(catalog.security.fallbackNotice.includes("系统安全存储不可用"), "settings catalog should explain session-only fallback.");
assert(catalog.security.secureStorage.macOS.includes("Keychain") && catalog.security.secureStorage.Windows.includes("DPAPI"), "settings catalog should name OS secure storage backends.");
assert(!catalogRaw.includes(secret) && !/apiKey|api_key/.test(catalogRaw), "settings catalog must not contain key material.");

const originalKokoroSettings = normalizeDesktopSettings({
  audio: {
    tts: {
      enabled: true,
      provider: "kokoro-original-local",
      voiceId: "zm_010",
      cacheUtteranceLimit: 40,
    },
  },
});
assert(
  originalKokoroSettings.audio.tts.enabled === true &&
    originalKokoroSettings.audio.tts.provider === "kokoro-original-local" &&
    originalKokoroSettings.audio.tts.voiceId === "zm_010",
  "original Kokoro provider and curated voice should persist as ordinary player settings."
);
const unavailableTtsCatalog = getSettingsCatalog({ kokoroOriginalAvailable: false });
const unavailableKokoro = unavailableTtsCatalog.audio.ttsProviders.find((provider) => provider.id === "kokoro-original-local");
assert(unavailableKokoro?.enabled === false && unavailableKokoro.disabledReason === "未安装语音包", "missing Kokoro resources should disable the player option with a clear reason.");

const desktopNormalized = normalizeDesktopSettings({ save: {
  autoSave: { enabled: false, intervalTurns: 5 },
  chapterLog: { onManualSave: false, onAutoSave: false, onCompaction: false },
} }).save;
assert(!Object.hasOwn(desktopNormalized, "autoSave") && desktopNormalized.chapterLog.intervalTurns === 20,
  "old save preferences must map once to bounded chapter preferences.");
assert(["onManualSave", "onAutoSave", "onCompaction"].every((field) => desktopNormalized.chapterLog[field] === false),
  "desktop settings must preserve each chapter opt-out.");
assert(normalizeDesktopSettings({ save: { autoSave: { enabled: false }, chapterLog: { onAutoSave: true } } })
  .save.chapterLog.onAutoSave === false, "disabled old automatic saves must not silently enable automatic chapter calls.");

const contextPolicy = normalizeContextWindowPolicy({
  configuredContextWindow: 256_000,
  providerContextLimit: 1_000_000,
  autoCompactRatio: 0.75,
});
const contextEntry = {
  createdAt: "2026-07-11T10:00:00.000Z",
  provider: { provider: "deepseek", model: "deepseek-v4-flash" },
  anchor_summary: {
    context_budget: {
      configured_context_window: 256_000,
      effective_context_window: 256_000,
      auto_compact_ratio: 0.75,
      latest_actual_input_tokens: 90_000,
      next_prompt_estimate_tokens: 120_000,
      irreducible_baseline_tokens: 12_000,
    },
  },
};
assert(selectCurrentContextUsage(contextEntry.anchor_summary.context_budget).used === 120_000, "idle context meter should prefer the next prompt estimate over previous request actual usage.");
assert(validateActiveContextPolicy({ entries: [contextEntry], policy: contextPolicy }).ok === true, "valid context policy should pass active trace validation.");
const compactedValidation = validateActiveContextPolicy({
  entries: [{
    ...contextEntry,
    anchor_summary: {
      context_budget: {
        ...contextEntry.anchor_summary.context_budget,
        next_prompt_estimate_tokens: 220_000,
      },
    },
  }],
  policy: contextPolicy,
  compactUpdatedAt: "2026-07-11T10:01:00.000Z",
});
assert(compactedValidation.ok === true && compactedValidation.used === null, "a newer compact summary should invalidate stale usage while retaining baseline validation.");
const restoredContext = projectRestoredContextUsage({
  entries: [contextEntry],
  policy: contextPolicy,
  provider: "deepseek",
  model: "deepseek-v4-flash",
});
assert(restoredContext.meter_status === "ready" && restoredContext.used === 120_000, "continue should restore the next prompt estimate from a matching trace.");
assert(projectRestoredContextUsage({
  entries: [contextEntry],
  policy: contextPolicy,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  compactUpdatedAt: "2026-07-11T10:01:00.000Z",
}).meter_status === "pending", "a compact summary newer than the trace should invalidate restored meter data.");
assert(projectRestoredContextUsage({
  entries: [contextEntry],
  policy: normalizeContextWindowPolicy({ configuredContextWindow: 128_000, autoCompactRatio: 0.65 }),
  provider: "deepseek",
  model: "deepseek-v4-flash",
}).meter_status === "pending", "policy mismatch should restore the meter as pending.");
const incompleteTrace = JSON.parse(JSON.stringify(contextEntry));
delete incompleteTrace.anchor_summary.context_budget.auto_compact_ratio;
assert(projectRestoredContextUsage({
  entries: [incompleteTrace],
  policy: contextPolicy,
  provider: "deepseek",
  model: "deepseek-v4-flash",
}).meter_status === "pending", "legacy traces without complete policy identity must restore as pending.");

process.stdout.write("settings store checks passed\n");

function checkSpeechInputSettings(baseline) {
  const defaultInput = { enabled: false, language: "zh", deviceId: "default" };
  const baselineSnapshot = JSON.stringify(baseline);
  const inputCatalog = getSettingsCatalog().audio.input;
  deepStrictEqual(inputCatalog.defaults, defaultInput, "the input catalog must expose safe defaults.");
  deepStrictEqual(inputCatalog.languages.map((item) => item.id), ["zh", "en", "ja"],
    "recognition languages must be independent of story locale identifiers.");
  assert(inputCatalog.deviceIdMaxLength === 512, "opaque device IDs must have a bounded size.");

  for (const input of [undefined, null, false, "enabled", 1, []]) {
    deepStrictEqual(normalizeDesktopSettings({ audio: { input } }).audio.input, defaultInput,
      "missing or invalid input domains must not silently enable the microphone.");
  }
  for (const enabled of ["true", "false", 1, {}, []]) {
    assert(normalizeDesktopSettings({ audio: { input: { enabled } } }).audio.input.enabled === false,
      "only an explicit boolean true may enable speech input.");
  }
  for (const language of ["zh", "en", "ja"]) {
    const next = normalizeDesktopSettings(mergeDesktopSettings(baseline, {
      audio: { input: { enabled: true, language, deviceId: "opaque/device\\identifier " } },
    }));
    deepStrictEqual(next.audio.input, { enabled: true, language, deviceId: "opaque/device\\identifier " },
      "supported language and opaque device IDs must survive without path or whitespace normalization.");
    deepStrictEqual({ ...next, audio: { ...next.audio, input: baseline.audio.input } }, baseline,
      "speech input changes must preserve TTS, volume, story locale, provider, narration and agent settings.");
    assert(settingsAffectProvider(baseline, next) === false,
      "speech input changes must not invalidate the story provider session.");
  }
  for (const language of ["auto", "zh-CN", "fr", "en\n", null, 1, {}]) {
    assert(normalizeDesktopSettings({ audio: { input: { language } } }).audio.input.language === "zh",
      "unsupported recognition languages must recover to the declared Chinese default.");
  }
  for (const deviceId of ["", null, 1, false, {}, [], "x".repeat(513), "mic\nother", "mic\u0000", "mic\u007f", "mic\u0085"]) {
    assert(normalizeDesktopSettings({ audio: { input: { deviceId } } }).audio.input.deviceId === "default",
      "invalid device identifiers must recover to the default microphone.");
  }
  assert(normalizeDesktopSettings({ audio: { input: { deviceId: "x".repeat(512) } } })
    .audio.input.deviceId.length === 512, "the declared device-ID length boundary must remain usable.");

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-settings-speech-input-"));
  try {
    const settingsPath = path.join(fixtureRoot, "settings.json");
    const legacy = JSON.parse(baselineSnapshot);
    delete legacy.audio.input;
    fs.writeFileSync(settingsPath, JSON.stringify(legacy));
    const credentialFixture = path.join(fixtureRoot, "credentials", "provider.enc.json");
    const storyFixture = path.join(fixtureRoot, "saves", "isolated-fixture.json");
    fs.mkdirSync(path.dirname(credentialFixture), { recursive: true });
    fs.mkdirSync(path.dirname(storyFixture), { recursive: true });
    fs.writeFileSync(credentialFixture, "isolated-encrypted-credential-fixture");
    fs.writeFileSync(storyFixture, '{"locale":"ja-JP","revision":9}');
    const inputStore = createSettingsStore({ dataRoot: fixtureRoot });
    const migrated = inputStore.load();
    deepStrictEqual(migrated, baseline, "legacy settings migration must add only the disabled input defaults.");
    deepStrictEqual(JSON.parse(fs.readFileSync(settingsPath, "utf8")).audio.input, defaultInput,
      "migration of the missing input domain must persist across restart.");
    const configured = inputStore.save(mergeDesktopSettings(migrated, {
      audio: { input: { enabled: true, language: "en", deviceId: "usb-microphone-opaque-id", apiKey: secret } },
    }));
    const languageOnly = inputStore.save(mergeDesktopSettings(configured, { audio: { input: { language: "ja" } } }));
    deepStrictEqual(languageOnly.audio.input, { enabled: true, language: "ja", deviceId: "usb-microphone-opaque-id" },
      "a partial speech input patch must retain the enabled state and selected microphone.");
    const ttsOnly = inputStore.save(mergeDesktopSettings(languageOnly, { audio: { tts: { rate: "+10%" } } }));
    deepStrictEqual(ttsOnly.audio.input, languageOnly.audio.input, "a later TTS-only patch must retain speech input settings.");
    deepStrictEqual(ttsOnly.audio.tts, { ...baseline.audio.tts, rate: "+10%" }, "TTS settings must still merge normally.");
    const disabled = inputStore.save(mergeDesktopSettings(ttsOnly, { audio: { input: { enabled: false } } }));
    deepStrictEqual(disabled.audio.input, { enabled: false, language: "ja", deviceId: "usb-microphone-opaque-id" },
      "turning speech input off must preserve its language and microphone preferences.");
    deepStrictEqual(createSettingsStore({ dataRoot: fixtureRoot }).load(), disabled,
      "speech input and existing TTS preferences must survive saving and reopening together.");
    assert(!fs.readFileSync(settingsPath, "utf8").includes(secret), "input settings must not retain unrecognized credential fields.");
    assert(fs.readFileSync(credentialFixture, "utf8") === "isolated-encrypted-credential-fixture",
      "speech settings migration and save must not alter credentials.");
    assert(fs.readFileSync(storyFixture, "utf8") === '{"locale":"ja-JP","revision":9}',
      "speech settings migration and save must not alter adventure state or language.");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  assert(JSON.stringify(baseline) === baselineSnapshot, "speech input normalization and merging must not mutate prior settings.");
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
