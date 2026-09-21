#!/usr/bin/env node
"use strict";

// Production settings controller functions, with isolated DOM and IPC fixtures.
// Real Electron rendering and persistence are exercised by --suite=player-settings.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { normalizeDesktopSettings, mergeDesktopSettings } = require("../settings-store");
const source = fs.readFileSync(path.join(__dirname, "../renderer/app.js"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function install(context, names) {
  new vm.Script(names.map(name => {
    const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert(start, name);
    const next = /\n(?:async )?function \w+\(/.exec(source.slice(start.index + 1));
    return source.slice(start.index, next ? start.index + 1 + next.index : undefined);
  }).join("\n")).runInContext(context);
}
function fixture() {
  let disk = normalizeDesktopSettings();
  let form = clone(disk);
  let rendered = clone(disk);
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const state = { ...disk.api, busy: false, settingsPendingGroups: new Set(), settingsSaveTask: null,
    settingsDirty: false, settingsAutosaveTimer: null, connectionDraft: null };
  const ui = { settingsDialog: { open: true }, settingsStatus: { textContent: "" },
    connectionStatus: { textContent: "" }, apiKeyInput: { value: "" }, menuMessage: { textContent: "" },
    customConnectionSelect: { value: "" }, customConnectionNameInput: { value: "Candidate" },
    customBaseUrlInput: { value: "https://candidate.example/v1" }, customModelIdInput: { value: "candidate-model" } };
  const context = vm.createContext({ state, ui,
    PERSISTED_SETTINGS_CONTROL_IDS: new Set(["gameVolumeInput", "narrationLengthPresetSelect", "contextWindowCustomInput"]),
    window: { setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); },
      confirm: () => true, greyCrow: { async updateSettings(patch) {
        calls.push(clone(patch)); disk = normalizeDesktopSettings(mergeDesktopSettings(disk, patch));
        return { ok: true, settings: clone(disk), status: {} };
      } } },
    t: (key, values = {}) => `${key}${values.name ? ":" + values.name : ""}`,
    formatError: (_error, fallback) => fallback, modelFailureExplanation: code => ({
      UPSTREAM_AUTH_ERROR: ["auth"], UPSTREAM_ACCESS_DENIED: ["access"],
    })[code] || null,
    collectSettingsFromUi: () => clone(form), collectSettingsFromState: () => clone(rendered),
    applySettings(settings) { rendered = clone(settings); state.settingsDirty = false; },
    applyStatus() {}, applySettingsCatalog() {}, renderCredentialSettings() {},
    renderShellState() { form = clone(rendered); },
    renderSettingsStatus() {}, setSettingsSaving(value) { state.settingsSaving = value; },
    promptContextCompactionForSettings() {}, refreshTtsCacheStatus: async () => {},
    clearApiKeyInput() { ui.apiKeyInput.value = ""; }, setBusy(value) { state.busy = value; },
    formatMenuMessage: () => "menu", formatModelStatusText: () => "Current model",
    applyProviderSettings(api) { Object.assign(state, api); rendered.api = clone(api); form.api = clone(api); },
  });
  install(context, ["serializeSettingsSnapshot", "preferenceGroupForControl", "schedulePreferenceSave", "markSettingsDirty",
    "refreshSettingsDirtyState", "saveSettings", "performSettingsSave", "getConnectionDraft", "readCustomConnectionDraft",
    "setConnectionStatus", "testApiKey", "formatConnectionFailure", "clearStoredApiKey"]);
  state.persistedSettingsSnapshot = context.serializeSettingsSnapshot(disk);
  return { context, state, ui, calls, timers,
    get disk() { return disk; }, get form() { return form; },
    change(section, fields) { form[section] = { ...form[section], ...fields }; rendered[section] = clone(form[section]); },
    async flushTimer() { const ready = [...timers.values()]; timers.clear(); for (const timer of ready) timer();
      if (state.settingsSaveTask) await state.settingsSaveTask; await Promise.resolve(); },
  };
}

test("ordinary preferences save once, with a clean baseline despite disk property order", async () => {
  const app = fixture();
  // Renderer collection intentionally orders save before audio, unlike normalized disk settings.
  app.change("audio", { gameVolume: 31 });
  app.context.markSettingsDirty({ id: "gameVolumeInput" });
  await app.flushTimer();
  assert.equal(app.calls.length, 1);
  assert.deepEqual(Object.keys(app.calls[0]), ["audio"]);
  assert.equal(app.disk.audio.gameVolume, 31);
  assert.equal(app.state.settingsDirty, false);
  assert.equal(app.ui.settingsStatus.textContent, "settings.status.autoSaved");
  await app.context.saveSettings();
  assert.equal(app.calls.length, 1, "closing or backup save must not resend unchanged settings");
});

test("unsaved model candidate never enters an ordinary preference patch", async () => {
  const app = fixture();
  app.state.connectionDraft = { provider: "openai-compatible", model: "invalid", custom: { baseUrl: "invalid" } };
  app.change("audio", { gameVolume: 42 });
  await app.context.saveSettings({ groups: ["audio"] });
  assert.equal(app.disk.api.provider, "deepseek");
  assert.equal(app.state.connectionDraft.custom.baseUrl, "invalid");
  assert.equal("api" in app.calls[0], false);
});

test("rapid changes coalesce and a late save reply cannot erase a newer choice", async () => {
  const app = fixture();
  app.change("audio", { gameVolume: 20 }); app.context.markSettingsDirty({ id: "gameVolumeInput" });
  app.change("audio", { gameVolume: 40 }); app.context.markSettingsDirty({ id: "gameVolumeInput" });
  assert.equal(app.timers.size, 1);
  const reply = deferred(); const original = app.context.window.greyCrow.updateSettings;
  let first = true;
  app.context.window.greyCrow.updateSettings = async patch => { const saved = await original(patch);
    if (first) { first = false; await reply.promise; } return saved; };
  const pending = app.flushTimer();
  app.change("audio", { gameVolume: 62 }); app.context.markSettingsDirty({ id: "gameVolumeInput" });
  reply.resolve(); await pending;
  assert.equal(app.form.audio.gameVolume, 62);
  await app.flushTimer();
  assert.equal(app.disk.audio.gameVolume, 62);
  assert.equal(app.calls.length, 2);
  assert.equal(app.state.settingsDirty, false);
});

test("saving audio leaves pending advanced changes queued instead of silently discarding them", async () => {
  const app = fixture();
  app.change("agent", { context: { configuredContextWindow: 64000, autoCompactRatio: 0.8 } });
  app.context.markSettingsDirty({ id: "contextWindowCustomInput" });
  app.change("audio", { gameVolume: 44 });
  await app.context.saveSettings({ groups: ["audio"] });
  assert.equal(app.form.agent.context.configuredContextWindow, 64000);
  assert.equal(app.state.settingsDirty, true);
  await app.flushTimer();
  assert.equal(app.disk.agent.context.configuredContextWindow, 64000);
  assert.equal(app.state.settingsDirty, false);
});

test("failed preference persistence remains unsaved and does not retry forever", async () => {
  const app = fixture();
  app.context.window.greyCrow.updateSettings = async () => ({ ok: false, error: { code: "WRITE_FAILED" } });
  app.change("audio", { gameVolume: 15 }); app.context.markSettingsDirty({ id: "gameVolumeInput" });
  await app.flushTimer();
  assert.equal(app.state.settingsDirty, true);
  assert.equal(app.ui.settingsStatus.textContent, "settings.error.saveFailed");
  assert.equal(app.timers.size, 0);
  assert.equal(app.disk.audio.gameVolume, 80);
});

test("a failed candidate keeps the active connection, editable fields and simple error", async () => {
  const app = fixture();
  const initial = clone(app.disk.api);
  app.state.connectionDraft = { provider: "openai-compatible", model: "candidate-model" };
  app.ui.apiKeyInput.value = "synthetic-test-key";
  let payload;
  app.context.window.greyCrow.testProviderConnection = async request => {
    payload = clone(request); return { ok: false, error: { code: "UPSTREAM_AUTH_ERROR", message: "private upstream details" } };
  };
  await app.context.testApiKey();
  assert.equal(payload.connection.modelId, "candidate-model");
  assert.equal(payload.apiKey, "synthetic-test-key");
  assert.equal(app.state.provider, initial.provider);
  assert.equal(app.state.model, initial.model);
  assert.equal(app.ui.apiKeyInput.value, "synthetic-test-key");
  assert.equal(app.ui.connectionStatus.textContent, "game.turn.failure.reason.auth");
});

test("a denied connection is not presented as an API-key authentication failure", async () => {
  const app = fixture();
  app.context.window.greyCrow.testProviderConnection = async () => ({
    ok: false, error: { code: "UPSTREAM_ACCESS_DENIED", message: "private upstream details" },
  });
  await app.context.testApiKey();
  assert.equal(app.ui.connectionStatus.textContent, "game.turn.failure.reason.access");
});

test("test and use applies successful candidates and handles a saved connection requiring restart", async () => {
  for (const ok of [true, false]) {
    const app = fixture(); app.ui.apiKeyInput.value = "synthetic-test-key";
    app.state.connectionDraft = { provider: "deepseek", model: "deepseek-v4-pro" };
    app.context.window.greyCrow.testProviderConnection = async () => ({ ok, applied: true,
      settings: { api: { ...app.disk.api, model: "deepseek-v4-pro" } }, status: {},
      ...(ok ? {} : { error: { code: "MODEL_CONNECTION_ACTIVATION_FAILED" } }) });
    await app.context.testApiKey();
    assert.equal(app.state.model, "deepseek-v4-pro");
    assert.equal(app.state.connectionDraft, null);
    assert.equal(app.ui.apiKeyInput.value, "");
    assert.equal(app.ui.connectionStatus.textContent, ok ? "settings.connection.testPassed" : "settings.connection.savedNeedsRestart");
  }
});

test("remove current targets the active identity; clear all requires confirmation and reports failure", async () => {
  const app = fixture();
  app.state.connectionDraft = { provider: "openai-compatible", connectionId: "not-the-active-connection" };
  let received; let confirmedText;
  app.context.window.confirm = message => { confirmedText = message; return false; };
  app.context.window.greyCrow.clearProviderCredential = async input => { received = clone(input); return { ok: true }; };
  await app.context.clearStoredApiKey(); assert.equal(received, undefined);
  assert.match(confirmedText, /Current model/);
  app.context.window.confirm = () => true;
  app.ui.apiKeyInput.value = "synthetic-test-key";
  await app.context.clearStoredApiKey();
  assert.deepEqual(received, { provider: "deepseek" });
  assert.equal(app.ui.apiKeyInput.value, "");
  app.context.window.greyCrow.clearAllProviderCredentials = async input => { received = clone(input); return { ok: false }; };
  await app.context.clearStoredApiKey({ all: true });
  assert.deepEqual(received, { confirmed: true });
  assert.equal(app.ui.connectionStatus.textContent, "settings.credentials.clearAllFailed");
});


test("rendering disabled narration preserves the stored voice and never dirties preferences", () => {
  const app = fixture();
  app.state.ttsProvider = "disabled"; app.state.ttsVoiceId = "zm_010";
  app.ui.ttsVoiceSelect = { value: "", children: [], set innerHTML(_value) { this.children = []; },
    appendChild(item) { this.children.push(item); } };
  app.context.document = { createElement: () => ({}) };
  app.context.getCurrentTtsProviderConfig = () => ({ id: "disabled", voices: [] });
  app.context.canUseTtsProvider = () => false;
  app.context.localizeTtsVoiceLabel = item => item.id;
  install(app.context, ["renderTtsVoiceOptions", "replaceSelectOptions"]);
  app.context.renderTtsVoiceOptions();
  assert.equal(app.ui.ttsVoiceSelect.value, "");
  assert.equal(app.state.ttsVoiceId, "zm_010");
  assert.equal(app.ui.ttsVoiceSelect.disabled, true);
});

test("read-aloud modes retain intent when local resources are missing and stop active audio when turned off", () => {
  const state = { ttsEnabled: false, ttsAuto: false, ttsProvider: "disabled", gameVolume: 80, busy: false };
  const ui = { ttsProviderSelect: { value: "disabled" }, ttsReadingModeSelect: { value: "off" },
    gameVolumeInput: {}, gameVolumeValue: {}, ttsRateInput: {}, ttsPitchInput: {}, ttsCacheLimitSelect: {},
    ttsTestButton: {}, clearTtsCacheButton: {}, ttsStatus: {} };
  const context = vm.createContext({ state, ui, Array, Number, document: { querySelector: () => null },
    speechInputController: null, t: key => key, renderTtsVoiceOptions() {}, renderTtsCacheStatus() {}, renderSimpleSettingsVisibility() {},
    localizeTtsProviderLabel: provider => provider.label || provider.id,
    cancelTtsPlayback() { context.cancelCount = (context.cancelCount || 0) + 1; },
  });
  install(context, ["getTtsReadingMode", "applyTtsReadingMode", "getCurrentTtsProviderConfig", "getDefaultEnabledTtsProvider", "canUseTtsProvider", "renderAudioSettings"]);
  state.settingsCatalog = { audio: { ttsProviders: [
    { id: "disabled", enabled: true }, { id: "kokoro-original-local", enabled: false, label: "Kokoro" },
  ], ttsDefaults: { cacheUtteranceLimit: 20 } } };
  context.applyTtsReadingMode("auto");
  assert.equal(state.ttsProvider, "kokoro-original-local");
  assert.equal(state.ttsEnabled, true);
  assert.equal(state.ttsAuto, true);
  assert.equal(context.getTtsReadingMode(), "auto");
  assert.equal(context.canUseTtsProvider(), false);
  context.renderAudioSettings();
  assert.equal(ui.ttsReadingModeSelect.value, "auto");
  assert.equal(ui.ttsTestButton.disabled, true);
  assert.equal(ui.ttsStatus.textContent, "settings.audio.status.resourceMissing");
  context.applyTtsReadingMode("manual");
  assert.equal(state.ttsEnabled, true);
  assert.equal(state.ttsAuto, false);
  context.applyTtsReadingMode("off");
  assert.equal(state.ttsEnabled, false);
  assert.equal(state.ttsAuto, false);
  assert.equal(context.cancelCount, 1);
});

test("voice preview waits for audio preference persistence and does not synthesize after a failed save", async () => {
  const state = { busy: false, settingsSaveTask: null, settingsDirty: true };
  const calls = [];
  const context = vm.createContext({ state, ui: {},
    saveSettings: async () => { calls.push("save"); state.settingsDirty = false; return true; },
    synthesizeAndPlayTts: async () => { calls.push("synthesize"); },
  });
  install(context, ["testTtsVoice"]);
  await context.testTtsVoice();
  assert.deepEqual(calls, ["save", "synthesize"]);
  state.settingsDirty = true;
  context.saveSettings = async () => { calls.push("failed-save"); return false; };
  await context.testTtsVoice();
  assert.deepEqual(calls, ["save", "synthesize", "failed-save"]);
});

test("localization refresh preserves the current speech status and its control label", () => {
  const state = { ttsPlaybackPhase: "paused", currentAudio: {}, ttsPlaybackError: "" };
  const ui = { operationTtsStatus: {}, ttsPlaybackIcon: {},
    ttsPlaybackToggleButton: { dataset: {}, setAttribute(name, value) { this[name] = value; } } };
  const context = vm.createContext({ state, ui, speechAudioFocus: false, t: key => key,
    getUiLocale: () => "en-US", UI_I18N: { setLocale(locale) {
      ui.operationTtsStatus.textContent = "game.operations.standby";
      ui.ttsPlaybackToggleButton["aria-label"] = "game.tts.pause";
      return locale;
    } } });
  install(context, ["syncUiLocale", "renderTtsPlaybackStatus"]);
  assert.equal(context.syncUiLocale(), "en-US");
  assert.equal(ui.operationTtsStatus.textContent, "tts.phase.paused");
  assert.equal(ui.ttsPlaybackToggleButton["aria-label"], "tts.resume");
  state.ttsPlaybackPhase = "error";
  state.currentAudio = null;
  state.ttsPlaybackError = "tts.error.resourceMissing";
  context.syncUiLocale();
  assert.equal(ui.operationTtsStatus.textContent, "tts.error.resourceMissing");
  assert.equal(ui.ttsPlaybackToggleButton["aria-label"], "tts.openSettings");
});


test("finishing an automatic save releases connection controls disabled by its intermediate render", () => {
  const app = fixture();
  app.ui.settingsForm = { inert: false, setAttribute() {} }; app.ui.saveSettingsButton = {};
  app.ui.testKeyButton = {};
  app.context.renderCredentialSettings = () => { app.ui.testKeyButton.disabled = app.state.busy || app.state.settingsSaving; };
  install(app.context, ["setSettingsSaving"]);
  app.context.setSettingsSaving(true);
  assert.equal(app.ui.settingsForm.inert, true); assert.equal(app.ui.testKeyButton.disabled, true);
  app.context.setSettingsSaving(false);
  assert.equal(app.ui.settingsForm.inert, false); assert.equal(app.ui.testKeyButton.disabled, false);
});


test("connection feedback explains local validation, storage and context failures without upstream text", () => {
  const app = fixture();
  for (const [code, key] of Object.entries({ INVALID_CUSTOM_CONNECTION: "settings.connection.validationRequired",
    CUSTOM_CONNECTION_LIMIT: "settings.connection.limitReached", CREDENTIAL_READ_FAILED: "settings.credentials.readFailed",
    CREDENTIAL_WRITE_FAILED: "settings.credentials.saveFailed", CONTEXT_SETTINGS_STALE: "settings.context.changed" })) {
    assert.equal(app.context.formatConnectionFailure({ code, message: "untrusted private text" }), key);
  }
});
