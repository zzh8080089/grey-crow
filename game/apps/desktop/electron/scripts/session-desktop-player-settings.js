"use strict";

// Main, preload, preference persistence and credential operations run normally.
// Only connection probes and confirmation answers use isolated test fixtures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PHASES = ["player_settings_core", "player_settings_layout", "player_settings_restart"];
const TABS = ["display", "audio", "narration", "ai", "save", "developer"];
const handlesPhase = phase => PHASES.includes(phase);

async function runCoordinator({ runPhase, createSettingsFixture, rootEnv }) {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
    XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [rootEnv]: tempRoot,
    GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
    GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
  await createSettingsFixture(tempRoot, "zh-CN");
  process.stdout.write(`Player settings artifacts: ${tempRoot}\n`);
  const runs = [];
  for (const phase of PHASES) runs.push(await runPhase(require("electron"), phase, env));
  assert(runs.every(run => run.modelCalls === 0 && run.chapterModelCalls === 0 && run.ttsRequests === 0));
  const result = { ok: true, suite: "player-settings", tempRoot, runs,
    evidence: "Actual Electron settings UI, Main preference and credential transactions, isolated disk persistence and restart. Synthetic connection probes only.",
    limitations: ["No real provider or microphone, speech quality, native-language acceptance, Windows validation or release validation.",
      "The confirmation dialog answer is controlled only inside this test renderer. Layout assertions establish reachability and overflow bounds; visual quality still requires inspection."] };
  fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify({ ok: result.ok, suite: result.suite, tempRoot,
    phases: runs.map(run => ({ phase: run.phase, probes: run.probeCalls, screenshots: run.screenshots.length })),
    layoutCases: runs.find(run => run.layouts)?.layouts.length ?? 0,
    evidenceFile: path.join(tempRoot, "results", "result.json") }, null, 2) + "\n");
}

function probe(_options, evidence) {
  if (evidence.nextProbeFailure) {
    evidence.nextProbeFailure = false;
    throw Object.assign(new Error("SYNTHETIC_AUTH_MESSAGE_MUST_NOT_APPEAR"), { code: "UPSTREAM_AUTH_ERROR", retryable: false });
  }
  return { ok: true, contractVersion: "grey-crow-provider-probe-v1", provider: "synthetic-local",
    model: "synthetic-local", toolCallRoundTrip: true, providerCalls: 0, usage: {} };
}

function observeResult(channel, result, evidence) {
  if (!handlesPhase(evidence.phase)) return;
  if (channel === "grey-crow:update-settings") (evidence.preferenceWrites ||= []).push({ ok: result?.ok,
    error: result?.error?.code, provider: result?.settings?.api?.provider, model: result?.settings?.api?.model });
  if (["grey-crow:test-provider-connection", "grey-crow:clear-provider-credential", "grey-crow:clear-all-provider-credentials"].includes(channel)) {
    (evidence.connectionReceipts ||= []).push({ channel, ok: result?.ok, error: result?.error?.code,
      keyVerified: result?.status?.keyVerified, provider: result?.settings?.api?.provider, model: result?.settings?.api?.model });
  }
}

async function runPhase(win, evidence, tempRoot, ui) {
  const { click, change, evaluate, readStatus, waitFor, screenshot, connectSyntheticModel, syntheticKey } = ui;
  const preferences = () => evaluate(win, "window.greyCrow.getSettings().then(result => result.settings)");
  const idle = async () => {
    try { await waitFor(win, "ordinary preferences durably saved", "!state.settingsSaving && !state.settingsDirty && !state.settingsSaveTask && !state.settingsAutosaveTimer"); }
    catch (error) {
      evidence.preferenceFailure = await evaluate(win, `(() => {
        const persisted=JSON.parse(state.persistedSettingsSnapshot || '{}'), current=collectSettingsFromUi();
        return { dirty:state.settingsDirty, saving:state.settingsSaving, task:!!state.settingsSaveTask,
          timer:!!state.settingsAutosaveTimer, pending:[...(state.settingsPendingGroups || [])],
          groups:Object.keys(current).filter(key=>key!=='api').map(key=>({key, persisted:persisted[key], current:current[key]})) };
      })()`);
      throw error;
    }
  };
  const selectTab = name => click(win, `[data-settings-tab="${name}"]`);
  const visible = selector => evaluate(win, `(() => {
    const node=document.querySelector(${JSON.stringify(selector)});
    if (!node?.getClientRects().length || !node.checkVisibility({checkVisibilityCSS:true})) return false;
    // Chromium can retain descendant layout boxes inside a closed disclosure.
    for (let parent=node.parentElement;parent;parent=parent.parentElement) {
      if (parent.tagName==='DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(node)) return false;
    }
    return true;
  })()`);
  await waitFor(win, "settings catalog loaded", "Boolean(state.settingsCatalog) && !state.busy");

  if (evidence.phase === "player_settings_restart") {
    const status = await readStatus(win), saved = await preferences();
    assert.equal(status.keyVerified, false, "cleared keys must not return on restart");
    assert.equal(saved.audio.gameVolume, 37); assert.equal(saved.narration.lengthPreset, "detailed");
    assert.equal(saved.localization.preferredLocale, "zh-CN");
    assert.equal(saved.audio.tts.enabled, false); assert.equal(saved.audio.input.enabled, false);
    await click(win, "#settingsButton"); await selectTab("ai");
    assert.equal(await evaluate(win, "document.querySelector('#apiKeyInput').value"), "");
    await screenshot(win, tempRoot, "player-settings-restart-no-keys", evidence);
    assert.equal(evidence.probeCalls, 0);
    return { ...evidence, revision: 0, restoredWithoutCredentials: true };
  }

  if (evidence.phase === "player_settings_layout") {
    await click(win, "#settingsButton");
    const layouts = [];
    for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
      await selectTab("display"); await change(win, "#gameLanguageSelect", locale); await idle();
      await waitFor(win, "selected locale rendered", `document.documentElement.lang === ${JSON.stringify(locale)}`);
      for (const [width, height] of [[1280, 720], [1600, 900]]) {
        win.setAspectRatio(0); win.setContentSize(width, height, false); win.center();
        await waitFor(win, "requested viewport", `innerWidth === ${width} && innerHeight === ${height}`);
        for (const tab of TABS) {
          await selectTab(tab);
          const layout = await evaluate(win, `(() => {
            const dialog = document.querySelector('#settingsDialog'), content = document.querySelector('#settingsContent');
            const panel = document.querySelector('[data-settings-panel="${tab}"]');
            const tabs = [...document.querySelectorAll('[data-settings-tab]')];
            const rect = dialog.getBoundingClientRect();
            const navigation = tabs.map(node => { const r=node.getBoundingClientRect(); return { label:node.textContent.trim(),
              visible:!!node.getClientRects().length, fits:node.scrollWidth<=node.clientWidth+2,
              inDialog:r.left>=rect.left && r.right<=rect.right && r.top>=rect.top && r.bottom<=rect.bottom }; });
            return { locale:document.documentElement.lang, tab:${JSON.stringify(tab)}, width:innerWidth, height:innerHeight,
              layout:document.body.dataset.gameUiLayout, panelVisible:!!panel.getClientRects().length,
              dialogFits:rect.left>=0 && rect.top>=0 && rect.right<=innerWidth+1 && rect.bottom<=innerHeight+1,
              horizontalOverflow:content.scrollWidth-content.clientWidth, navigation };
          })()`);
          assert(layout.dialogFits && layout.panelVisible, JSON.stringify(layout));
          assert.equal(layout.layout, "story-notebook-v1");
          assert.equal(await evaluate(win, "document.querySelector('#uiArtStyleToggleButton')"), null);
          assert(layout.horizontalOverflow <= 2, JSON.stringify(layout));
          assert.equal(layout.navigation.length, 6);
          assert(layout.navigation.every(item => item.visible && item.fits && item.inDialog), JSON.stringify(layout));
          assert(layout.navigation.every(item => !/settings\.|\{\w+\}/.test(item.label)));
          layouts.push(layout);
          await screenshot(win, tempRoot, `player-settings-notebook-${locale}-${width}-${tab}`, evidence);
        }
      }
    }
    await selectTab("display"); await change(win, "#gameLanguageSelect", "zh-CN"); await idle();
    return { ...evidence, revision: 0, layouts };
  }

  await connectSyntheticModel(win); await idle();
  const original = (await preferences()).api;
  await selectTab("audio");
  await change(win, "#gameVolumeInput", "37", "input"); await idle();
  assert.equal((await preferences()).audio.gameVolume, 37);
  await change(win, "#ttsReadingModeSelect", "off"); await idle();
  assert.equal(await visible("#ttsReadingOptions"), false);
  await change(win, "#ttsReadingModeSelect", "manual"); await idle();
  assert.equal(await visible("#ttsReadingOptions"), true);
  assert.equal(await evaluate(win, "document.querySelector('#ttsTestButton').disabled"), false);
  await change(win, "#ttsRateInput", "+10%", "input"); await idle();
  assert.equal((await preferences()).audio.tts.rate, "+10%");
  await change(win, "#ttsReadingModeSelect", "off"); await idle();
  assert.equal(await visible("#ttsReadingOptions"), false);
  assert.equal(await visible('[data-i18n="speech.memoryBrief"]'), true, "resource notice is available before enabling speech input");
  await change(win, "#speechInputEnabledSelect", "true"); await idle();
  assert.equal(await visible("#speechInputOptions"), true);
  await change(win, "#speechInputEnabledSelect", "false"); await idle();
  assert.equal(await visible("#speechInputOptions"), false);
  await selectTab("narration");
  assert.equal(await visible("#playerProfileNameInput"), false);
  await change(win, "#narrationLengthPresetSelect", "detailed"); await idle();
  assert.equal((await preferences()).narration.lengthPreset, "detailed");
  await selectTab("display"); await change(win, "#gameLanguageSelect", "en-US"); await idle();
  assert.equal((await preferences()).localization.preferredLocale, "en-US");
  await change(win, "#gameLanguageSelect", "zh-CN"); await idle();
  await screenshot(win, tempRoot, "player-settings-ordinary-autosaved", evidence);

  await selectTab("ai"); await change(win, "#providerPresetSelect", "openai-compatible");
  await change(win, "#customConnectionSelect", "");
  await change(win, "#customConnectionNameInput", "合成候选连接", "input");
  await change(win, "#customBaseUrlInput", "not-an-api-address", "input");
  await change(win, "#customModelIdInput", "synthetic-player-model", "input");
  assert.deepEqual((await preferences()).api, original, "candidate edits never activate a model");
  await selectTab("audio"); await change(win, "#gameVolumeInput", "38", "input"); await idle();
  assert.equal((await preferences()).audio.gameVolume, 38, "invalid connection drafts cannot block unrelated preferences");
  assert.deepEqual((await preferences()).api, original);
  await change(win, "#gameVolumeInput", "37", "input"); await idle();
  await selectTab("ai");
  assert.equal(await evaluate(win, "document.querySelector('#customBaseUrlInput').value"), "not-an-api-address");
  await change(win, "#customBaseUrlInput", "https://example.invalid/v1", "input");
  await change(win, "#apiKeyInput", syntheticKey, "input");
  evidence.nextProbeFailure = true;
  await click(win, "#testKeyButton");
  await waitFor(win, "failed candidate feedback", "!state.busy && document.querySelector('#connectionStatus').textContent.trim().length > 0");
  assert.equal(evidence.connectionReceipts.at(-1).ok, false);
  assert.deepEqual((await preferences()).api, original, "failed test keeps the previous working connection");
  assert.equal((await readStatus(win)).keyVerified, true);
  assert.doesNotMatch(await evaluate(win, "document.querySelector('#settingsDialog').innerText"), /SYNTHETIC_AUTH_MESSAGE/);
  await screenshot(win, tempRoot, "player-settings-candidate-failed", evidence);
  await click(win, "#testKeyButton");
  await waitFor(win, "tested candidate active", "!state.busy && state.provider === 'openai-compatible' && state.keyVerified && document.querySelector('#apiKeyInput').value === ''");
  const custom = (await preferences()).api;
  assert.equal(custom.provider, "openai-compatible"); assert.equal(custom.model, "synthetic-player-model");
  assert.equal(custom.customConnections.length, 1);
  assert.equal(evidence.probeCalls, 3);
  assert.equal(evidence.connectionReceipts.at(-1).ok, true);

  await change(win, "#providerPresetSelect", "deepseek");
  assert.deepEqual((await preferences()).api, custom,
    "editing another provider before key removal must leave the actual connection unchanged");

  // Synthetic confirmation answers are local to this fixture renderer.
  await evaluate(win, "window.__settingsConfirmations = []; window.__settingsConfirmAnswer = false; window.confirm = message => { window.__settingsConfirmations.push(message); return window.__settingsConfirmAnswer; }; true;");
  await click(win, "#modelPrivacyDetails > summary");
  await click(win, "#clearKeyButton");
  assert.equal((await readStatus(win)).keyVerified, true, "cancelled confirmation must keep the key");
  await evaluate(win, "window.__settingsConfirmAnswer = true");
  await change(win, "#apiKeyInput", syntheticKey, "input");
  await click(win, "#clearKeyButton");
  await waitFor(win, "current key removed", "!state.busy && !state.keyVerified && document.querySelector('#apiKeyInput').value === ''");
  assert.equal(evidence.connectionReceipts.at(-1).channel, "grey-crow:clear-provider-credential");
  assert.equal(evidence.connectionReceipts.at(-1).ok, true);
  const confirmation = await evaluate(win, "window.__settingsConfirmations.at(-1)");
  assert.doesNotMatch(confirmation, /\{name\}/);
  assert.match(confirmation, /合成候选连接|synthetic-player-model/);
  await screenshot(win, tempRoot, "player-settings-current-key-removed", evidence);

  await change(win, "#providerPresetSelect", "deepseek");
  await change(win, "#apiKeyInput", syntheticKey, "input");
  await click(win, "#testKeyButton");
  await waitFor(win, "built-in reconnected", "!state.busy && state.provider === 'deepseek' && state.keyVerified");
  await change(win, "#apiKeyInput", syntheticKey, "input");
  await click(win, "#clearAllKeysButton");
  await waitFor(win, "all keys removed", "!state.busy && !state.keyVerified && document.querySelector('#apiKeyInput').value === ''");
  assert.equal(evidence.connectionReceipts.at(-1).channel, "grey-crow:clear-all-provider-credentials");
  assert.equal(evidence.connectionReceipts.at(-1).ok, true);
  assert.equal((await readStatus(win)).keyVerified, false);
  assert.equal(await evaluate(win, "document.querySelector('#connectionStatus').textContent"), await evaluate(win, "t('settings.credentials.clearAllDone')"));
  assert.equal(await evaluate(win, "document.querySelector('#settingsStatus').textContent"), await evaluate(win, "t('settings.status.autoSaved')"));
  await screenshot(win, tempRoot, "player-settings-all-keys-removed", evidence);
  await click(win, "#closeSettingsButton");
  return { ...evidence, revision: 0, originalModel: original.model, testedCustomModel: custom.model,
    confirmationCount: await evaluate(win, "window.__settingsConfirmations.length") };
}

module.exports = { handlesPhase, runCoordinator, runPhase, probe, observeResult };
