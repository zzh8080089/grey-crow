#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

require("./check-debug-trace-summary");

const root = path.resolve(__dirname, "..");
const rendererDir = path.join(root, "renderer");
const files = {
  html: read("renderer/index.html"),
  app: read("renderer/app.js"),
  localeZh: read("renderer/locales/zh-CN.js"),
  css: [read("renderer/styles.css"), read("renderer/notebook.css")].join("\n"),
  notebookCss: read("renderer/notebook.css"),
  notebookManifest: JSON.parse(read("renderer/assets/story-notebook-v2/asset-manifest.json")),
  fontManifest: JSON.parse(read("renderer/assets/fonts/manifest.json")),
  thirdPartyNotices: read("THIRD_PARTY_NOTICES.md"),
  preload: read("preload.js"),
  main: read("main.js"),
  appData: read("app-data.js"),
  credentialStore: read("credential-store.js"),
  contentManagement: read("content-management.js"),
  modelConnections: read("model-connections.js"),
  settingsStore: read("settings-store.js"),
  providerTransport: read("provider-https-transport.js"),
  saveSlots: read("save-slots.js"),
  status: read("desktop-status.js"),
  runtimeSession: read("runtime-session.js"),
  ttsKokoroOriginalProvider: read("tts-kokoro-original-provider.js"),
  ttsKokoroOriginalWorker: read("tts-kokoro-original-worker.py"),
  desktopBridge: read("../../../engine/bridge/session-desktop-bridge.js"),
  sessionContext: read("../../../engine/session/session-context.js"),
  turnGenerator: read("../../../engine/session/turn-generator.js"),
  localeRegistry: read("../../../engine/localization/locale-registry.js"),
};

assert(files.html.includes("Content-Security-Policy"), "renderer HTML must define a CSP.");
assert(files.html.includes("connect-src 'none'"), "renderer CSP must block direct network access.");
assert(files.html.includes("media-src 'self' data:"), "renderer CSP must allow only bundled/data audio playback.");
assert(files.html.includes('id="brandLogo"')
  && files.html.includes('src="assets/branding/grey-crow-ai-logo-zh-CN.png"')
  && files.app.includes('"en-US": "assets/branding/grey-crow-ai-logo-en-US.png"')
  && files.app.includes('"ja-JP": "assets/branding/grey-crow-ai-logo-ja-JP.png"'), "renderer logo must use the bundled locale-specific Grey Crow AI assets.");
assert(files.css.includes('url("assets/branding/grey-crow-ai-main-menu-bg.png")'), "renderer background must use the bundled Grey Crow AI cover asset.");
assert(files.css.includes('url("assets/ui/worn_paper.png")'), "renderer panel texture must use bundled assets.");
assert(files.fontManifest.schemaVersion === "grey-crow-font-bundle-v1"
  && files.fontManifest.source?.repository === "https://github.com/google/fonts"
  && /^[a-f0-9]{40}$/.test(files.fontManifest.source?.commit || "")
  && files.fontManifest.fonts?.length === 6, "renderer font manifest must pin the six-file commercial typography bundle.");
const fontContracts = new Set();
for (const font of files.fontManifest.fonts) {
  const contractKey = `${font.locale}:${font.role}`;
  assert(!fontContracts.has(contractKey), `duplicate bundled font contract: ${contractKey}`);
  fontContracts.add(contractKey);
  assert(new Set(["en-US", "zh-CN", "ja-JP"]).has(font.locale)
    && new Set(["ui", "story"]).has(font.role), `unsupported bundled font contract: ${contractKey}`);
  assert(/^[a-z0-9-]+\/[A-Za-z0-9-]+\.ttf$/.test(font.file)
    && /^[a-z0-9-]+\/OFL\.txt$/.test(font.licenseFile), `font manifest paths must stay bounded: ${font.id}`);
  const fontPath = path.join(rendererDir, "assets", "fonts", font.file);
  const licensePath = path.join(rendererDir, "assets", "fonts", font.licenseFile);
  assert(fs.existsSync(fontPath) && fs.statSync(fontPath).isFile(), `missing bundled font: ${font.file}`);
  assert(fs.statSync(fontPath).size === font.bytes, `bundled font size changed: ${font.file}`);
  assert(
    crypto.createHash("sha256").update(fs.readFileSync(fontPath)).digest("hex") === font.sha256,
    `bundled font digest changed: ${font.file}`
  );
  const license = fs.readFileSync(licensePath, "utf8");
  assert(license.includes("SIL OPEN FONT LICENSE Version 1.1")
    && license.includes("Copyright"), `bundled font must retain its complete OFL notice: ${font.file}`);
  assert(files.css.includes(`font-family: "${font.cssFamily}";`)
    && files.css.includes(`url("assets/fonts/${font.file}")`), `renderer CSS must load its pinned font face: ${font.id}`);
}
for (const locale of ["en-US", "zh-CN", "ja-JP"]) {
  assert(fontContracts.has(`${locale}:ui`) && fontContracts.has(`${locale}:story`), `missing locale font pair: ${locale}`);
}
assert(files.css.includes("--font-story:")
  && files.css.includes("--font-data:")
  && files.css.includes("--font-code:")
  && !files.css.includes("var(--font-mono)")
  && !/font-size:\s*(?:9|10)px/.test(files.css), "renderer typography must use semantic font roles and keep compact CJK text at 11px or above.");
assert(files.thirdPartyNotices.includes(files.fontManifest.source.commit)
  && files.thirdPartyNotices.includes("renderer/assets/fonts/*/OFL.txt")
  && files.thirdPartyNotices.includes("SIL Open Font License 1.1"), "desktop third-party notices must inventory the bundled font source and licenses.");
assert(files.html.includes('id="gameSettingsButton"'), "game screen must expose Settings.");
assert(!files.html.includes('id="uiArtStyleToggleButton"')
  && files.html.includes('data-ui-layout="story-notebook-v1"')
  && files.html.includes('class="story-notebook-scene-layer"')
  && files.html.includes('class="story-notebook-material-layer"'), "game screen must expose the notebook shell as its HTML default.");
assert(files.app.includes('const DEFAULT_GAME_UI_LAYOUT = "story-notebook-v1"')
  && !files.app.includes('function toggleGameUiLayout()')
  && files.app.includes('ui.gameView.dataset.uiLayout = layout')
  && files.app.includes('gameUiLayout: normalizeGameUiLayout(state.gameUiLayout)'), "renderer must normalize persisted layouts to the notebook-only display setting.");
assert(files.html.includes('href="notebook.css"')
  && files.html.indexOf('href="notebook.css"') > files.html.indexOf('href="styles.css"'), "the notebook composition stylesheet must load after the shared renderer styles.");
for (const layer of ["scene", "lighting", "paper", "texture", "edge", "binding"]) {
  assert(files.html.includes(`data-notebook-layer="${layer}"`), `notebook composition must retain a separate ${layer} layer.`);
}
assert(files.notebookCss.includes("pointer-events: none")
  && files.notebookCss.includes(".notebook-paper-grain")
  && files.notebookCss.includes(".notebook-page-frame")
  && files.notebookCss.includes(".notebook-binding i")
  && files.notebookCss.includes("font-family: var(--font-story)")
  && /dark-paper-grain\.png"\)[^;]*\brepeat\s*;/.test(files.notebookCss), "notebook materials must repeat beneath separately rendered typography, borders and binding.");
assert(files.html.includes('id="storyNotebookWorldCard"')
  && files.html.includes('id="storyNotebookWorldTitle"')
  && files.html.includes('id="storyNotebookHostStatus"')
  && files.html.includes('id="storyNotebookLive"')
  && files.html.includes('id="storyNotebookModelStatusText"'), "story-notebook D2-C must project the trusted world, Host, and model state through real Renderer nodes.");
for (const key of ["location", "player", "turn", "model"]) {
  assert(files.html.includes(`data-state-key="${key}"`), `story-notebook D2-C must retain a semantic ${key} state projection.`);
}
assert(files.html.includes('class="send-button story-action-key"')
  && files.html.includes('class="tts-playback-toggle story-action-key"')
  && files.html.includes('id="ttsPlaybackIcon"')
  && files.html.includes('data-i18n="game.notebook.continueStory"'), "story-notebook D2-C must keep Continue Story and TTS as one visually unified real action pair.");
assert(files.app.includes("function renderStoryNotebookMetadata()")
  && files.app.includes("state.lockedContent?.world?.title")
  && files.app.includes('ui.storyNotebookLive.removeAttribute("title")')
  && files.app.includes("state.lockedContent = createPreviewNewGameReview({ preset: createPreviewNewGameCatalog().defaultPreset })")
  && files.app.includes("lockedContent: createPreviewNewGameReview({ preset: createPreviewNewGameCatalog().defaultPreset })")
  && files.app.includes('dataset.hostPhase = "busy"')
  && files.app.includes("ui.ttsPlaybackToggleButton.dataset.phase"), "story-notebook D2-C must derive its HUD and transient states from trusted Renderer state.");
assert(files.notebookCss.includes(".notebook-status-strip")
  && files.css.includes('.state-grid > [data-state-key="model"]')
  && files.css.includes(".story-action-key")
  && files.css.includes('.turn-form[hidden]')
  && files.css.includes(":has(.turn-form[hidden]) .operation-tts-status"), "story-notebook D2-C must retain the real HUD, unified actioner, and inline closed-story layout contract.");
assert(!files.html.includes("上海封锁区")
  && !files.html.includes("DeepSeek V4 Flash")
  && !files.html.includes(">23%<"), "formal story-notebook HTML must not ship prototype-only fake HUD values.");
assert(files.css.includes("--gc-system-surface")
  && files.css.includes("--gc-system-control")
  && files.css.includes("--gc-system-text-dim")
  && files.css.includes("--gc-system-focus"), "renderer must define neutral app-level system colors before Settings adopts the new shell.");
assert(files.css.includes("--text: var(--gc-system-text);")
  && files.css.includes("--muted: var(--gc-system-text-muted);")
  && files.css.includes("--dim: var(--gc-system-text-dim);")
  && files.css.includes("--accent: var(--gc-system-accent);")
  && files.css.includes("--accent-strong: var(--gc-system-focus);"), "Settings must scope legacy inner components onto the shared neutral system palette.");
const referencedNotebookAssets = new Set(joinedRenderer().match(/assets\/story-notebook-v[12]\/[A-Za-z0-9._-]+\.png/g));
for (const asset of referencedNotebookAssets) {
  assert(fs.existsSync(path.join(rendererDir, asset)), `missing referenced notebook asset: ${asset}`);
}
assert(referencedNotebookAssets.has("assets/story-notebook-v1/scene-rain-night-v1.png")
  && referencedNotebookAssets.has("assets/story-notebook-v2/dark-paper-grain.png")
  && !referencedNotebookAssets.has("assets/story-notebook-v2/scene-rain-night.png"), "the notebook must retain its original scene and use the selected grain without shipping the rejected low-resolution scene.");
assert(files.notebookManifest.schemaVersion === "grey-crow-renderer-art-manifest-v1"
  && files.notebookManifest.assets.length === 1
  && files.notebookManifest.assets[0].id === "dark-paper-grain"
  && files.notebookManifest.assets[0].usageStatus === "production", "notebook production material inventory must select only the paper grain.");
for (const asset of files.notebookManifest.assets) {
  assert(/^[a-z0-9-]+\.png$/.test(asset.file), `notebook material path must remain bounded: ${asset.file}`);
  assert(referencedNotebookAssets.has(`assets/story-notebook-v2/${asset.file}`), `selected notebook material is not referenced: ${asset.file}`);
  verifyPngAsset(path.join(rendererDir, "assets/story-notebook-v2", asset.file), asset);
}
const inheritedBackground = files.notebookManifest.inheritedBackground;
assert(inheritedBackground.file === "../story-notebook-v1/scene-rain-night-v1.png"
  && inheritedBackground.usageStatus === "production-existing", "notebook manifest must identify the retained decorative background.");
verifyPngAsset(path.join(rendererDir, "assets/story-notebook-v2", inheritedBackground.file), inheritedBackground);
assert(
  files.html.includes('id="storyNotebookCharactersButton"') &&
  files.html.includes('src="assets/story-notebook-v1/icon-character-records-night-v1.png"'),
  "the Character rail entry must use its dedicated records icon instead of the generic Observe eye."
);
assert(files.html.includes('id="storyNotebookDrawer"')
  && files.html.includes('id="storyNotebookStateButton"')
  && files.html.includes('id="storyNotebookModulesButton"')
  && files.html.includes('id="storyNotebookChaptersButton"')
  && files.html.includes('aria-controls="storyNotebookDrawer"'), "story-notebook D2-D must expose one shared overlay drawer through real rail controls.");
assert(files.app.includes("function openStoryNotebookDrawer(")
  && files.app.includes("function renderStoryNotebookModuleList(")
  && files.app.includes("function renderStoryNotebookModuleDetail(")
  && files.app.includes("return refreshSkillModules()")
  && files.app.includes("return refreshChapterLogs()")
  && files.app.includes("renderSkillModuleFields(module, { container: fieldBody"), "story-notebook D2-D must reuse the existing Skill and chapter read paths instead of branching by Skill ID.");
const notebookDrawerRule = readNotebookCssRule(".story-notebook-drawer");
const notebookDrawerOpenRule = readNotebookCssRule(".story-notebook-drawer.is-open");
const notebookIndexRule = readNotebookCssRule(".story-notebook-rail-navigation");
assert(/position:\s*absolute\s*;/.test(notebookDrawerRule)
  && /width:\s*var\(--nb-drawer-width\)\s*;/.test(notebookDrawerRule)
  && !/(?:width|height|inset|padding|grid-template)[\w-]*\s*:/.test(notebookDrawerOpenRule)
  && /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.test(files.notebookCss), "notebook drawer must overlay the fixed composition without changing geometry and retain reduced-motion support.");
assert(!files.html.includes('class="settings-ui-layout-preview"'), "display settings must not offer the retired Classic interface.");
assert(/position:\s*absolute\s*;/.test(notebookIndexRule)
  && files.html.includes('class="notebook-tab-label"')
  && files.app.includes("function syncStoryNotebookRailState()")
  && files.app.includes('button.setAttribute("aria-expanded", String(active))')
  && files.app.includes('button.setAttribute("aria-current", "page")')
  && !files.app.includes("mountStoryNotebookRailButton")
  && !files.app.includes("returnStoryNotebookRailButtonToRail")
  && !files.app.includes("notebookPageTransition"), "notebook index buttons must remain fixed while their semantic active state follows the shared drawer.");
const notebookDrawerClose = files.app.slice(files.app.indexOf("function closeStoryNotebookDrawer("), files.app.indexOf("function openStoryNotebookModuleDetail("));
assert(notebookDrawerClose.includes('ui.storyNotebookDrawer.setAttribute("inert", "")')
  && notebookDrawerClose.includes('opener.focus({ preventScroll: true })')
  && notebookDrawerClose.includes("completeClose();")
  && !notebookDrawerClose.includes("setTimeout("), "closing the notebook drawer must release semantic state and restore focus without waiting for the retired page animation.");
assert(files.html.includes('id="exitGameButton"'), "main menu must expose Exit Game.");
assert(!files.html.includes('id="languageSelectionDialog"')
  && !files.app.includes("ensureLanguageSelection")
  && files.settingsStore.includes('preferredLocale: DEFAULT_GAME_LOCALE')
  && files.localeRegistry.includes('firstLaunchSelectionRequired: false'), "first launch must default to Simplified Chinese without a blocking language dialog.");
assert(files.html.includes('id="menuLanguageSwitcher"')
  && files.html.includes('id="menuLanguageToggle"')
  && files.html.includes('id="menuLanguageOptions"')
  && files.html.includes('data-menu-locale="zh-CN"')
  && files.html.includes('data-menu-locale="en-US"')
  && files.html.includes('data-menu-locale="ja-JP"')
  && files.html.includes('class="menu-language-flag"')
  && files.html.includes('id="localeTransitionCurtain"')
  && files.app.includes("coverLocaleTransition")
  && files.app.includes("revealLocaleTransition")
  && files.app.includes("chooseMainMenuLanguage"), "main menu must expose a compact current-flag language picker with three choices.");
assert(files.html.includes('src="localization-runtime.js"')
  && files.html.includes('src="locales/zh-CN.js"')
  && files.html.includes('src="locales/en-US.js"')
  && files.html.includes('src="locales/ja-JP.js"')
  && files.app.includes('UI_I18N.setLocale'), "renderer must load the strict three-language UI localization runtime before app.js.");
assert(files.html.includes('id="gameLanguageSelect"') && files.app.includes("const localeLocked = state.gameStarted"), "menu settings must retain language preference while active Adventure switching stays disabled.");
assert(files.preload.includes("quitApp: () => ipcRenderer.invoke(CHANNELS.QUIT_APP)"), "preload must expose a narrow quit API.");
assert(files.main.includes("ipcMain.handle(CHANNELS.QUIT_APP") && files.main.includes("setImmediate(() => app.quit())"), "main process must handle trusted quit requests.");
assert(files.html.includes('id="manualSaveButton"'), "game screen must expose Manual Save.");
assert(files.html.includes('id="chapterLogButton"'), "game screen must expose Chapter Log.");
assert(files.html.includes('id="chapterDialog"'), "renderer must include a chapter log dialog.");
assert(files.html.includes('id="storyArchiveFooter"') && files.html.includes('id="storyArchiveBackButton"'), "game screen must include the inline Story archive footer.");
assert(files.html.includes('id="storyExportHtmlButton"') && files.html.includes('id="storyExportMarkdownButton"'), "closed Story archive must expose HTML and Markdown export actions.");
assert(files.html.includes('id="backpackCommandButton"'), "game screen must expose Backpack command.");
assert(files.html.includes('id="saveMaintenanceButton"'), "settings must expose Save Maintenance.");
assert(files.html.includes('id="backToMenuButton"'), "settings navigation must expose Back To Main Menu.");
const saveSettingsPanel = extractHtmlRegion(files.html, 'id="settingsPanelSave"', 'id="settingsPanelContent"');
assert(/saveMaintenanceButton[\s\S]*<\/div>\s*<p class="risk-note"[^>]*>/.test(saveSettingsPanel), "save maintenance tab must focus on save maintenance actions.");
assert(!saveSettingsPanel.includes('id="backToMenuButton"'), "Back To Main Menu must not live inside the Save Maintenance tab.");
assert(/settings-header-actions[\s\S]*closeSettingsButton/.test(files.html), "Settings must keep Close reachable in the fixed header.");
assert(/settings-sidebar[\s\S]*settings-navigation-actions[\s\S]*backToMenuButton/.test(files.html), "Back To Main Menu must live in the fixed game-navigation area.");
assert(files.html.includes('class="settings-shell-body"')
  && files.html.includes('class="settings-sidebar"')
  && files.html.includes('id="settingsContent"'), "Settings must use the shared fixed-header/sidebar/content shell.");
assert(files.html.includes('data-settings-tab="ai"') && files.html.includes('data-settings-panel="developer"'), "settings must expose categorized tabs and panels.");
for (const label of ["显示与阅读", "声音与语音", "故事偏好", "模型连接", "存档与内容", "高级"]) {
  assert(files.html.includes(`>${label}</button>`), `settings must expose the player-facing category: ${label}.`);
}
const aiSettingsPanel = extractHtmlRegion(files.html, 'id="settingsPanelAi"', 'id="settingsPanelSave"');
const advancedSettingsPanel = extractHtmlRegion(files.html, 'id="settingsPanelDeveloper"', 'id="contentCreatorDialog"');
assert(!aiSettingsPanel.includes('id="contextWindowPresetSelect"'), "model and connection settings must not contain advanced context policy controls.");
assert(advancedSettingsPanel.includes('id="contextWindowPresetSelect"'), "advanced settings must contain the context limit control.");
assert(advancedSettingsPanel.includes('id="autoCompactRatioSelect"'), "advanced settings must contain the automatic compaction threshold.");
assert(advancedSettingsPanel.includes('id="debugPanelEnabledSelect"'), "advanced settings must contain developer tools.");
assert(files.html.includes('id="maintenanceDialog"'), "renderer must include a save maintenance confirmation dialog.");
assert(files.html.includes('id="maintenanceConfirmInput"'), "save maintenance reset must have a typed confirmation input.");
assert(files.html.includes('id="newGameConfirmDialog"'), "renderer must include a typed confirmation dialog for replacing an existing adventure with New Game.");
assert(files.html.includes('id="newGameConfirmInput"') && files.html.includes('placeholder="DELETE"'), "New Game replacement must use the same uppercase DELETE confirmation phrase as save maintenance.");
assert(files.app.includes('ui.maintenanceForm.addEventListener("submit"') && files.app.includes('ui.newGameConfirmForm.addEventListener("submit"'), "typed delete confirmation forms must block implicit Enter submission.");
assert(files.app.includes("ui.prepareNewGameButton.disabled = state.busy")
  && files.app.includes("async function prepareOrConfirmNewGame() {\n  if (state.busy)")
  && files.app.includes("if (!pending?.confirmationToken || state.busy) return;"), "New Game creation must lock its action button and reject duplicate submission while busy.");
assert(files.main.includes("confirmationText: confirmation.confirmationText || CLEAR_CURRENT_SAVE_CONFIRMATION_TEXT"), "New Game restart must preserve the canonical save-maintenance confirmation phrase.");
assert(files.html.includes('id="newGameSetupDialog"') && files.html.includes('id="newGamePresetSelect"'), "New Game must expose a locked story-bundle selection in a dedicated dialog.");
assert(!files.html.includes('id="newGameHostSelect"') && !files.html.includes('id="newGameWorldSelect"'), "New Game must not allow ordinary players to mix Host and World outside a declared story bundle.");
assert(files.html.includes('id="newGamePresetContents"') && files.html.includes('id="newGameCapabilityList"'), "New Game must show the selected story bundle separately from non-disableable Engine capabilities.");
assert(!files.html.includes('id="newGameSkillList"') && !files.app.includes("ui.newGameSkillList"), "ordinary players must not override the Skills declared by a story bundle.");
assert(files.html.includes('id="observeCommandButton"'), "game screen must expose Observe command.");
assert(files.html.includes('id="listenCommandButton"'), "game screen must expose Listen command.");
assert(files.html.includes('id="mapCommandButton"'), "game screen must expose Map command.");
assert(files.html.includes('id="compactContextButton"'), "game screen must expose Context Maintenance command.");
assert(files.html.includes('id="compactDialog"'), "context maintenance must require a confirmation dialog.");
assert(files.html.includes('id="debugPanelButton"'), "settings must include a gated developer debug button.");
assert(files.html.includes('id="debugPanelEnabledSelect"'), "settings must expose the developer debug panel preference.");
assert(files.html.includes('id="debugDialog"'), "renderer must include the developer debug panel dialog.");
assert(files.html.includes('id="continueGameButton"'), "main menu must expose Continue Game.");
assert(files.html.includes("继续当前冒险"), "main menu must expose Continue Current Adventure wording.");
assert(files.html.includes('id="saveList"'), "main menu must expose the current adventure summary.");
assert(files.html.includes('id="providerPresetSelect"'), "settings must expose API preset controls.");
assert(files.html.includes('id="modelPresetSelect"'), "settings must expose model preset controls.");
assert(files.html.includes('id="narrationLengthPresetSelect"'), "settings must expose narration length preset controls.");
assert(files.html.includes('id="narrationCustomTargetInput"'), "settings must expose narration custom target controls.");
assert(files.html.includes('id="narrationLengthStatus"'), "settings must explain narration length without developer noise.");
assert(files.html.includes('id="gameVolumeInput"'), "settings must expose game volume.");
assert(files.html.includes('id="ttsProviderSelect"'), "settings must keep the TTS provider slot.");
assert(!files.html.includes("Kokoro 轻量本地朗读") && files.html.includes("Kokoro 高质量中文（实验）"), "settings must expose only the high-quality local Kokoro provider.");
assert(files.html.includes('id="ttsRateInput"'), "settings must keep the TTS rate slot.");
assert(files.html.includes('id="ttsPitchInput"'), "settings must keep the TTS pitch slot.");
assert(files.html.includes('id="ttsCacheLimitSelect"') && files.html.includes('id="clearTtsCacheButton"'), "settings must expose bounded TTS cache policy and clear-cache action.");
assert(files.html.includes('id="operationTtsStatus"') && files.html.includes('id="ttsPlaybackToggleButton"'), "game actioner must expose global TTS state and playback control.");
assert(files.css.includes(".tts-playback-toggle") && files.css.includes("border: 0"), "Classic TTS control must retain its compact fallback while the notebook layout promotes the same node into a full action key.");
assert(files.html.includes('id="saveSettingsButton"'), "settings must persist non-secret preferences through main process.");
assert(!files.html.includes('id="settingsSavedDialog"')
  && !files.app.includes("openSettingsSavedDialog")
  && files.app.includes("returnToMainMenuFromSettings")
  && files.app.includes('ui.settingsDialog.addEventListener("cancel"'), "Settings must use inline save feedback and one safe close path instead of a second acknowledgement dialog.");
assert(files.html.includes('id="credentialStatus"'), "settings must disclose credential persistence state.");
assert(files.html.includes('id="clearKeyButton"'), "settings must expose an explicit clear API Key action.");
assert(files.html.includes('id="customConnectionPanel"') && files.html.includes('id="customBaseUrlInput"') && files.html.includes('id="customModelIdInput"'), "settings must expose the custom connection form.");
assert(files.html.includes('id="modelHelpLinks"'), "settings must expose local model connection help.");
assert(files.html.includes('id="settingsPanelContent"') && files.html.includes('id="contentPackSelect"'), "settings must expose the v2 Content Library panel.");
assert(!files.html.includes('id="importContentFolderButton"') && !files.html.includes('id="importContentZipButton"') && files.html.includes("第三方文件夹、ZIP 和 Workshop 导入尚未开放"), "public Content Library UI must keep third-party import closed.");
assert(files.html.includes('id="contentCreatorButton"') && files.html.includes('id="contentCreatorDialog"'), "main menu must expose the independent Content Creator.");
assert(files.html.includes('id="contentEditorItemSelect"') && files.html.includes('id="saveContentEditorButton"'), "Content Creator must expose bounded player-owned editing.");
assert(files.html.includes('id="contentCreatorModePreset"') && files.html.includes('id="contentPresetForm"') && files.html.includes('id="saveContentPresetButton"'), "Content Creator must expose the player-owned story bundle composer.");
assert(files.html.includes('id="newBlankContentButton"') && files.html.includes('id="blankContentPicker"') && files.html.includes('id="cancelBlankContentButton"'), "Content Creator must expose true blank content creation and draft cancellation.");
for (const kind of ["host", "world", "ordinary_skill", "new_game_skill"]) {
  assert(files.html.includes(`data-blank-content-kind="${kind}"`), `blank content picker must expose ${kind}.`);
}
const blankContentPicker = extractHtmlRegion(files.html, 'id="blankContentPicker"', 'id="contentEditorForm"');
assert(!blankContentPicker.includes("<input") && !blankContentPicker.includes("<select"), "blank content picker must not ask players for Pack IDs, item IDs, paths, or permissions.");
assert(files.html.includes('id="toggleContentAdvancedInfoButton"') && files.html.includes('id="contentAdvancedInfoPanel"') && files.html.includes('id="contentAdvancedInfoList"'), "Content Creator must expose an optional read-only technical information panel.");
const contentAdvancedPanel = extractHtmlRegion(files.html, 'id="contentAdvancedInfoPanel"', 'id="contentEditorPreview"');
assert(contentAdvancedPanel.includes("只读技术信息") && contentAdvancedPanel.includes("不能在这里修改 manifest、路径或权限"), "advanced content information must explain its read-only boundary.");
assert(!contentAdvancedPanel.includes("<input") && !contentAdvancedPanel.includes("<select") && !contentAdvancedPanel.includes("<textarea"), "advanced content information must not expose editable technical controls.");
assert(files.html.includes('id="contentEditorMarkdownInput"') && files.html.includes('id="contentEditorTriggersInput"'), "Content Creator must expose free Markdown and the two-layer Skill trigger field.");
assert(files.html.includes('id="contentModuleEnabledInput"')
  && files.html.includes('id="contentModuleFieldList"')
  && files.html.includes('id="addContentModuleFieldButton"')
  && files.html.includes('id="contentModulePreviewFields"'), "ordinary Skill Creator must expose the bounded v1 field builder and Runtime-component preview.");
assert(files.html.includes('id="contentEditorPlayerGuideInput"') && !files.html.includes('id="contentModuleRawJsonInput"'), "module Creator must expose player guidance without exposing raw definition JSON.");
assert(files.html.includes('id="contentPermissionReadAdventure"') && files.html.includes('id="contentPermissionPrivateState"') && files.html.includes('id="contentPermissionUpdateAdventure"'), "Content Creator must disclose the three future Skill permissions.");
assert(/id="contentPermissionReadAdventure"[^>]*disabled/.test(files.html) && /id="contentPermissionPrivateState"[^>]*disabled/.test(files.html) && /id="contentPermissionUpdateAdventure"[^>]*disabled/.test(files.html), "future Skill permissions must remain disabled until runtime authorization is implemented.");
assert(!files.html.includes('id="contentEditorReadScopesSelect"') && !files.html.includes('id="contentEditorWriteScopesSelect"'), "ordinary Content Creator must not expose raw scope selectors.");
assert(files.html.includes("请勿粘贴或导入来源不明") && files.html.includes('id="acknowledgeContentCreatorButton"'), "Content Creator must show a per-entry source warning before editing.");
assert(files.html.includes('id="playerProfileNameInput"') && files.html.includes('id="savePlayerProfileButton"'), "settings must expose the global player profile form.");
assert(files.app.includes('settings.credentials.status.secure"'), "settings UI must explain secure credential persistence through the locale catalog.");
assert(files.app.includes('settings.credentials.status.sessionOnly"')
  && files.app.includes('settings.credentials.status.secureUnavailable"'), "settings UI must explain the session-only fallback through the locale catalog.");
assert(!joinedRenderer().includes("legacy/openclaw-web-ui"), "renderer must not depend on legacy OpenClaw asset paths.");
assert(!/localStorage|indexedDB|IndexedDB/i.test(joinedRenderer()), "renderer must not persist API keys in browser storage.");
assert(!/\b(require|import)\s*(?:\(|["'])/.test(joinedRenderer()), "renderer must not import Node or engine modules.");
for (const forbidden of ["dataRoot", "settingsPath", "savesRoot", "providerCheckRoot", "secretValue", "getSecret"]) {
  assert(!new RegExp(`\\b${forbidden}\\b`).test(`${files.preload}\n${joinedRenderer()}`), `renderer/preload must not expose ${forbidden}.`);
}
assert(files.preload.includes('contextBridge.exposeInMainWorld("greyCrow"'), "preload must expose the narrow greyCrow API.");
assert(files.preload.includes("updateSettings"), "preload must expose a narrow non-secret settings API.");
assert(files.preload.includes("leaveAdventure: () => ipcRenderer.invoke(CHANNELS.LEAVE_ADVENTURE)"), "preload must expose a narrow Adventure exit boundary.");
assert(files.main.includes("createLocaleCoordinator") && files.main.includes("displayLocale:"), "main process must own locale lifecycle and Skill locale projection.");
assert(files.main.includes("normalizeUiErrorParams")
  && /function createFailure\(code, message, retryable, params = \{\}\)[\s\S]*?code,[\s\S]*?params: normalizeUiErrorParams\(params\)/.test(files.main), "Main IPC failures must expose stable code + bounded params for renderer localization.");
assert(/function formatError\(error, fallback\)[\s\S]*?getUiLocale\(\) === "zh-CN"[\s\S]*?fallback/.test(files.app), "non-Chinese UI errors must use localized renderer fallbacks instead of raw Main messages.");
assert(files.localeRegistry.includes('["zh-CN", "en-US", "ja-JP"]'), "Engine locale registry must define exactly the three v1 locales.");
assert(files.preload.includes("clearProviderCredential"), "preload must expose a narrow clear-key API.");
assert(files.preload.includes("testProviderConnection") && files.preload.includes("upsertCustomConnection") && files.preload.includes("deleteCustomConnection"), "preload must expose narrow custom connection APIs.");
assert(files.preload.includes("openModelHelp"), "preload must expose a fixed-id model help API.");
assert(files.preload.includes("listContentLibrary") && files.preload.includes("cloneContentPack"), "preload must expose narrow active Content Library APIs.");
assert(!files.preload.includes("importContentPack") && !files.main.includes("grey-crow:import-content-pack"), "third-party import must not be exposed through preload or main IPC.");
assert(files.preload.includes("loadEditableContent") && files.preload.includes("saveEditableContent"), "preload must expose narrow item editor APIs without file paths.");
assert(files.preload.includes("createBlankContent"), "preload must expose narrow blank content creation.");
assert(files.preload.includes("saveContentPreset"), "preload must expose a narrow story bundle save API.");
assert(files.preload.includes("previewSkillModule"), "preload must expose a narrow local-only module preview API.");
assert(files.preload.includes("getPlayerProfile") && files.preload.includes("savePlayerProfile"), "preload must expose narrow player profile APIs.");
assert(files.preload.includes("listSaveSlots"), "preload must expose a narrow save list API.");
assert(files.preload.includes("continueGame"), "preload must expose a narrow continue game API.");
assert(files.preload.includes("requestNewGameRestart") && files.preload.includes("confirmNewGameRestart"), "preload must expose narrow New Game restart request/confirm APIs.");
assert(files.preload.includes("requestSaveMaintenance") && files.preload.includes("confirmSaveMaintenance"), "preload must expose narrow save maintenance request/confirm APIs.");
assert(files.preload.includes("requestContextCompaction"), "preload must expose a narrow context maintenance API.");
assert(files.preload.includes("requestManualSave"), "preload must expose a narrow manual save API.");
assert(files.preload.includes("getChapterLogs"), "preload must expose a narrow chapter log API.");
assert(files.preload.includes("getDebugTrace"), "preload must expose a narrow debug trace API.");
assert(files.preload.includes("openStoryArchive: (saveId) => ipcRenderer.invoke(CHANNELS.OPEN_STORY_ARCHIVE"), "preload must expose a narrow Story archive read API.");
assert(files.preload.includes("exportStoryArchive: (format, options = {}) => ipcRenderer.invoke(CHANNELS.EXPORT_STORY_ARCHIVE, { format,")
  && files.main.includes('["format", "adventureId", "sessionId", "revision"]'),
  "Story archive export must accept only a format and optional view identity; Main owns the output path dialog.");
assert(/continueStoryArchive:\s*\(/.test(files.preload), "preload must expose the Story continuation action; view identity and retry behavior are checked through the actual desktop flow.");
assert(files.preload.includes("startTtsUtterance") && files.preload.includes("continueTtsUtterance") && files.preload.includes("cancelTtsUtterance"), "preload must expose narrow segmented TTS session APIs.");
assert(files.preload.includes("getTtsCacheStatus") && files.preload.includes("clearTtsCache"), "preload must expose narrow TTS cache status and clear APIs.");
assert(!/exposeInMainWorld\([^,]+,\s*ipcRenderer/.test(files.preload), "preload must not expose raw ipcRenderer.");
assert(files.main.includes("createSessionDesktopBridge"), "main process must own the native session desktop bridge.");
assert(files.main.includes("createAppDataLayout") && files.main.includes("ensureDesktopAppData"), "main process must use the app data layout boundary.");
assert(files.main.includes("createCredentialStore"), "main process must use the secure credential store boundary.");
assert(files.main.includes("getSettingsCatalog"), "main process must expose main-owned settings catalog.");
assert(files.main.includes("resetRuntimeSession") && files.main.includes("resetRuntimeSessionState"), "provider/model changes must reset runtime session.");
assert(files.main.includes("preserveAdventure: true") && files.main.includes("previousAdventure"), "provider/model changes must preserve the selected current adventure while rebuilding the bridge.");
assert(files.main.includes("restoreStoredCredentialSession"), "main process must restore verified credentials after restart or provider setting changes.");
assert(/app\.whenReady\(\)\.then\(\(\)\s*=>\s*{[\s\S]*prepareDesktopAppData\(\);[\s\S]*restoreStoredCredentialSession\(\);[\s\S]*registerIpcHandlers\(\);[\s\S]*createWindow\(\);/.test(files.main), "main process must restore secure credentials before creating the first renderer window.");
assert(files.main.includes("CLEAR_PROVIDER_CREDENTIAL"), "main process must expose an explicit clear credential IPC.");
assert(files.main.includes("runProviderCompatibilityProbe"), "main process must require the isolated two-step provider probe.");
assert(files.main.includes("getModelHelpUrl") && files.main.includes("shell.openExternal"), "main process must own the fixed allowlist for official model documentation.");
assert(files.main.includes("createSettingsStore"), "main process must own non-secret settings persistence.");
assert(files.main.includes("createDesktopContentManagement") && files.main.includes("chooseContentExportRoot"), "main process must own active Content Library management and export selection.");
assert(files.contentManagement.includes("localPathsExposed: false") && files.contentManagement.includes("createPlayerProfileStore"), "content management projections must hide paths and use the v2 profile store.");
assert(files.contentManagement.includes("loadEditableContent") && files.contentManagement.includes("saveEditableContent"), "content management must own bounded player content editing.");
assert(files.contentManagement.includes("createBlankContent") && files.contentManagement.includes("normalizeBlankContentKind"), "content management must own normalized blank content creation.");
assert(files.contentManagement.includes('schemaVersion: "grey-crow-content-technical-v1"')
  && files.contentManagement.includes("manifestEditable: false")
  && files.contentManagement.includes("permissionsEditable: false")
  && files.contentManagement.includes("localPathsExposed: false"), "content management must project structured, read-only, path-free technical information.");
assert(files.main.includes("createSaveSlotStore"), "main process must own save slot summaries.");
assert(files.main.includes("createSessionArchiveReader") && files.main.includes("OPEN_STORY_ARCHIVE"), "main process must own read-only Story archive opening.");
assert(files.main.includes("createSessionStoryExporter") && files.main.includes("EXPORT_STORY_ARCHIVE") && files.main.includes("showSaveDialog"), "main process must own Story archive export and the native save dialog.");
assert(files.main.includes("COM[1-9]") && files.main.includes("LPT[1-9]") && files.main.includes('replace(/[<>:"') && files.main.includes("replace(/[. ]+$/g"), "Story export filename must handle Windows reserved names, forbidden characters, and trailing dots or spaces.");
const storyExportHandler = extractIpcHandler(files.main, "EXPORT_STORY_ARCHIVE");
const storyContinuationHandler = extractIpcHandler(files.main, "CONTINUE_STORY_ARCHIVE");
assert(storyContinuationHandler.includes("continueSessionStoryArchive(payload)") && files.main.includes("parentAdventureId: binding.adventureId") && files.main.includes("parentRevision: binding.revision"), "main process must own the currently opened closed parent identity for Story continuation.");
assert(!storyContinuationHandler.includes("payload.saveId") && !storyContinuationHandler.includes("payload.path"), "Story continuation IPC must not accept renderer-owned save ids or paths.");
assert(files.app.includes("appendContinuationDivider") && files.html.includes("续写这个故事"), "renderer must keep Story continuation in the existing story view.");
assert(!storyExportHandler.includes("payload.saveId") && !storyExportHandler.includes("payload.outputPath") && !storyExportHandler.includes("payload.path"), "Story export renderer payload must not select a save or filesystem path.");
assert(storyExportHandler.includes("activeSaveId") && storyExportHandler.includes("chooseStoryExportTarget"), "Story export must use the active closed save and a main-owned destination.");
assert(files.main.includes("createNewGameLifecycle") && files.main.includes("PREPARE_NEW_GAME") && files.main.includes("CONFIRM_NEW_GAME_CREATION"), "main process must create v2 Adventures through the validated two-step lifecycle boundary.");
assert(files.main.includes("newGameCreationConfirmations") && files.main.includes("takeNewGameCreationConfirmation"), "main process must own one-time New Game creation confirmations.");
assert(files.main.includes("REQUEST_NEW_GAME_RESTART") && files.main.includes("CONFIRM_NEW_GAME_RESTART"), "main process must own New Game restart request/confirm IPC.");
assert(files.main.includes("getSaveSlotStore().deleteConfirmed") && files.main.includes("executeSaveMaintenanceAction"), "New Game restart must use the confirmed native save deletion boundary.");
assert(/async function removeFailedAdventureCreation[\s\S]*getSaveSlotStore\(\)\.deleteConfirmed/.test(files.main), "failed New Game creation must roll back through atomic Adventure maintenance.");
assert(files.main.includes("REQUEST_SAVE_MAINTENANCE") && files.main.includes("CONFIRM_SAVE_MAINTENANCE"), "main process must own save maintenance IPC request/confirm.");
assert(files.main.includes("activeBridge.recoverCurrentAdventure") && files.main.includes("getSaveSlotStore().deleteConfirmed"), "main process must recover through the native bridge and delete through confirmed save maintenance.");
assert(!extractIpcHandler(files.main, "REQUEST_NEW_GAME_RESTART").includes("PROVIDER_NOT_READY") && !extractIpcHandler(files.main, "CONFIRM_NEW_GAME_RESTART").includes("PROVIDER_NOT_READY"), "New Game deletion must not require a model connection.");
assert(!files.main.includes("activeBridge.backupCurrentSave") && !files.main.includes("activeBridge.restoreCurrentSave"), "Demo maintenance UI must not expose backup or restore lifecycle methods.");
assert(files.main.includes("REQUEST_CONTEXT_COMPACTION") && files.main.includes("binding.bridge.compactCurrentContext"), "main process must own context maintenance IPC and bridge calls.");
assert(files.main.includes("REQUEST_MANUAL_SAVE") && files.main.includes("binding.bridge.commitCurrentSave"), "main process must own manual save IPC and bridge call.");
assert(files.main.includes("GET_CHAPTER_LOGS") && files.main.includes("binding.bridge.readChapterLogs"), "main process must own chapter log IPC and bridge call.");
assert(files.main.includes("GET_DEBUG_TRACE") && files.main.includes("binding.bridge.loadDebugTrace"), "main process must own debug trace IPC and bridge calls.");
assert(files.main.includes("projectDebugTraceResult") && files.main.includes("createDebugTraceExport"), "main process must project debug trace before renderer exposure.");
assert(files.main.includes('schema_version: "grey-crow-debug-export-v2"')
  && files.main.includes('selection: projectDebugTraceSelection(result.selection, entries.length)')
  && files.main.includes("createDebugTraceBuildInfo")
  && files.main.includes("createDebugTraceSummary"), "debug export must expose build, scope, actual selection policy, and measured summaries.");
assert(files.main.includes('if (["invalid_arg_path", "schema_path"].includes(key))')
  && files.main.includes("isForbiddenDebugTraceKey"), "debug projection must preserve bounded validation paths while retaining the denylist.");
assert(files.main.includes("START_TTS_UTTERANCE") && files.main.includes("CONTINUE_TTS_UTTERANCE") && files.main.includes("CANCEL_TTS_UTTERANCE") && files.main.includes("createTtsService"), "main process must own segmented TTS session IPC and service.");
assert(files.main.includes("GET_TTS_CACHE_STATUS") && files.main.includes("CLEAR_TTS_CACHE") && files.main.includes("projectTtsCacheStatus"), "main process must own and project TTS cache maintenance.");
assert(files.main.includes("projectTtsResult"), "main process must project TTS result before renderer exposure.");
assert(files.main.includes("stripTtsInternalBlocks") && files.main.includes("TTS_INTERNAL_SECTION_PATTERN"), "main process must strip internal protocol blocks before TTS synthesis.");
assert(files.main.includes("normalizeLiteralNewlines"), "main process TTS normalization must treat literal newline escapes as line breaks.");
assert(files.app.includes("normalizeTtsDisplayText") && files.app.includes("stripInternalDisplayBlocks(normalizeLiteralNewlines(value))"), "renderer must normalize narration text before TTS synthesis.");
assert(files.app.includes("ttsRequestId") && files.app.includes("nextSegmentPromise") && files.app.includes('addEventListener("ended", onEnded'), "renderer TTS playback must be latest-request-wins, prefetch one segment, and wait for completed audio.");
assert(files.app.includes("toggleTtsPlayback") && files.app.includes("audio.pause()") && files.app.includes('setTtsPlaybackPhase("paused"'), "renderer must pause the current audio without canceling the utterance.");
assert(files.app.includes('setTtsPlaybackPhase("generating"') && files.app.includes('setTtsPlaybackPhase("completed"') && files.app.includes('setTtsPlaybackPhase("error"'), "renderer must project TTS generation, completion, and failure states.");
assert(files.app.includes("cancelTtsPlayback") && files.app.includes("cancelTtsUtterance"), "renderer must stop playback and cancel stale TTS sessions.");
assert(files.main.includes("createKokoroOriginalProvider") && files.main.includes("resolveKokoroOriginalRuntimeRoot"), "main process must register the original Kokoro candidate behind a private runtime root.");
assert(files.main.includes("inspectOriginalBundle") && files.main.includes("availability.available"), "main process must inspect the complete Kokoro bundle before registering its worker provider.");
assert(files.main.includes("KOKORO_MODEL_MISSING") && files.main.includes("unavailableProviders"), "main process must expose a stable missing-language-pack state without spawning Kokoro.");
assert(!files.main.includes("createKokoroLocalProvider") && !files.settingsStore.includes('id: "kokoro-local"'), "legacy sherpa Kokoro must not remain in the runtime or player settings.");
assert(files.ttsKokoroOriginalProvider.includes("spawn") && files.ttsKokoroOriginalProvider.includes("kokoro-original-local"), "original Kokoro must stay isolated behind a child-process provider.");
assert(files.ttsKokoroOriginalProvider.includes("inspectOriginalBundle") && files.ttsKokoroOriginalProvider.includes("missingCount"), "original Kokoro provider must expose a side-effect-free resource integrity probe.");
assert(files.ttsKokoroOriginalWorker.includes("HF_HUB_OFFLINE") && files.ttsKokoroOriginalWorker.includes("sys.stdout"), "original Kokoro worker must remain offline and use the stdio protocol.");
assert(files.main.includes("CLEAR_CURRENT_SAVE_CONFIRMATION_TEXT") && files.main.includes("saveMaintenanceConfirmations"), "clear-current-save maintenance must be token and phrase gated.");
assert(files.main.includes("projectSaveMaintenanceResult") && files.main.includes("projectSaveMaintenanceInspection"), "main process must project maintenance results before renderer exposure.");
assert(
  extractIpcHandler(files.main, "REQUEST_SAVE_MAINTENANCE").includes("resolveExistingSaveForNewGameRestart(requestedSaveId)") && files.main.includes("requested.compatibility?.playerContinuable === true"),
  "save deletion must select a main-verified playable native save; incompatible old files are not deletion targets."
);
assert(!extractIpcHandler(files.main, "REQUEST_SAVE_MAINTENANCE").includes("payload.path"), "maintenance requests must not accept renderer paths.");
assert(!extractIpcHandler(files.main, "CONFIRM_SAVE_MAINTENANCE").includes("payload.saveId"), "maintenance confirmation must use active save, not renderer save ids.");
assert(!extractIpcHandler(files.main, "CONFIRM_SAVE_MAINTENANCE").includes("payload.path"), "maintenance confirmation must not accept renderer paths.");
assert(!extractIpcHandler(files.main, "REQUEST_CONTEXT_COMPACTION").includes("payload.saveId"), "context maintenance must use active save, not renderer save ids.");
assert(!extractIpcHandler(files.main, "REQUEST_CONTEXT_COMPACTION").includes("payload.path"), "context maintenance must not accept renderer paths.");
assert(!extractIpcHandler(files.main, "REQUEST_MANUAL_SAVE").includes("payload.saveId"), "manual save must use active save, not renderer save ids.");
assert(!extractIpcHandler(files.main, "REQUEST_MANUAL_SAVE").includes("payload.path"), "manual save must not accept renderer paths.");
assert(!extractIpcHandler(files.main, "GET_CHAPTER_LOGS").includes("payload.saveId"), "chapter log reads must use active save, not renderer save ids.");
assert(!extractIpcHandler(files.main, "GET_CHAPTER_LOGS").includes("payload.path"), "chapter log reads must not accept renderer paths.");
assert(!extractIpcHandler(files.main, "GET_DEBUG_TRACE").includes("payload.saveId"), "debug trace requests must use active save, not renderer save ids.");
assert(!extractIpcHandler(files.main, "GET_DEBUG_TRACE").includes("payload.path"), "debug trace requests must not accept renderer paths.");
assert(files.main.includes("projectDebugTraceModelSurface")
  && files.main.includes("projectDebugTraceRuntimeTranslation"), "debug trace projection must preserve safe semantic Action surface and Runtime translation metadata.");
assert(!extractIpcHandler(files.main, "EXPORT_CONTENT_PACK").includes("payload.path") && !extractIpcHandler(files.main, "EXPORT_CONTENT_PACK").includes("payload.destinationRoot"), "content export must use a main-owned directory dialog, not renderer paths.");
assert(!extractIpcHandler(files.main, "LOAD_EDITABLE_CONTENT").includes("payload.path") && !extractIpcHandler(files.main, "SAVE_EDITABLE_CONTENT").includes("payload.path"), "content editor IPC must address stable Pack/item IDs, not renderer paths.");
assert(!extractIpcHandler(files.main, "CREATE_BLANK_CONTENT").includes("payload.path"), "blank content IPC must not accept renderer paths.");
const blankContentManagement = files.contentManagement.slice(
  files.contentManagement.indexOf("async function createBlankContent"),
  files.contentManagement.indexOf("async function exportContent")
);
for (const forbidden of ["input.packId", "input.itemId", "input.path", "input.danger", "input.readScopes", "input.writeScopes", "input.permissions"]) {
  assert(!blankContentManagement.includes(forbidden), `blank content creation must discard renderer-owned field: ${forbidden}.`);
}
assert(!extractIpcHandler(files.main, "SAVE_CONTENT_PRESET").includes("payload.path"), "story bundle IPC must never accept renderer paths.");
const previewSkillModuleHandler = extractIpcHandler(files.main, "PREVIEW_SKILL_MODULE");
assert(previewSkillModuleHandler.includes("previewSkillModule"), "main must route Creator previews through Engine-owned normalization and Runtime projection.");
for (const forbidden of ["payload.path", "payload.saveId", "payload.definition", "payload.operations", "payload.value"]) {
  assert(!previewSkillModuleHandler.includes(forbidden), `module Creator preview IPC must discard authority-bearing input: ${forbidden}.`);
}
assert(files.contentManagement.includes("normalizeSkillModuleCreatorDraft")
  && files.contentManagement.includes("projectSkillModulePreview"), "desktop content management must normalize Creator drafts before using the shared Runtime projection.");
assert(files.app.includes("optionalSkills") && files.app.includes("optional_off") && files.app.includes("defaultEnabled"), "story bundle Creator must preserve required/optional/default-on/default-off Skill selection state.");
const prepareNewGameHandler = extractIpcHandler(files.main, "PREPARE_NEW_GAME");
assert(prepareNewGameHandler.includes("preset: payload.selection?.preset")
  && prepareNewGameHandler.includes("optionalSkillChoices: payload.selection?.optionalSkillChoices"), "New Game IPC must accept only the preset root and its bounded optional choices.");
for (const forbidden of ["payload.selection?.host", "payload.selection?.world", "payload.selection?.newGameSkill", "payload.selection?.skills", "payload.selection?.moduleGrant"]) {
  assert(!prepareNewGameHandler.includes(forbidden), `New Game IPC must discard renderer-owned selection field: ${forbidden}.`);
}
assert(!files.main.includes("SKILL_MODULE_RUNTIME_NOT_READY"), "completed Runtime UI must not retain the temporary module Adventure creation gate.");
assert(extractIpcHandler(files.main, "LIST_SKILL_MODULES").includes("binding.bridge.listCurrentSkillModules"), "main must own the captured Adventure Skill-module list read.");
const getSkillModuleHandler = extractIpcHandler(files.main, "GET_SKILL_MODULE");
assert(getSkillModuleHandler.includes("binding.bridge.getCurrentSkillModule"), "main must own the narrow captured Adventure Skill-module detail read.");
for (const forbidden of ["payload.path", "payload.saveId", "payload.definition", "payload.operations", "payload.value"]) {
  assert(!getSkillModuleHandler.includes(forbidden), `Skill-module Renderer IPC must reject write or authority-bearing input: ${forbidden}.`);
}
assert(files.preload.includes("listSkillModules: () => ipcRenderer.invoke(CHANNELS.LIST_SKILL_MODULES)"), "preload must expose the narrow Skill-module list read.");
assert(files.preload.includes("getSkillModule: (moduleRef, options = {}) => ipcRenderer.invoke(CHANNELS.GET_SKILL_MODULE"), "preload must expose the narrow Skill-module detail read.");
assert(extractIpcHandler(files.main, "LIST_SKILL_PANELS").includes("binding.bridge.listCurrentSkillPanels"), "main must own the captured Adventure generic panel list read.");
const getCharacterPanelEntryHandler = extractIpcHandler(files.main, "GET_CHARACTER_PANEL_ENTRY");
assert(getCharacterPanelEntryHandler.includes("binding.bridge.getCurrentCharacterPanelEntry"), "main must own the dedicated Character panel navigation descriptor read.");
for (const forbidden of ["payload", "saveId", "path", "skillId", "capability", "panelRef"]) {
  assert(!getCharacterPanelEntryHandler.includes(forbidden), `Character navigation descriptor IPC must not accept Renderer authority: ${forbidden}.`);
}
const getSkillPanelHandler = extractIpcHandler(files.main, "GET_SKILL_PANEL");
assert(getSkillPanelHandler.includes("binding.bridge.getCurrentSkillPanel"), "main must own the narrow generic panel view read.");
for (const forbidden of ["payload.saveId", "payload.path", "payload.definition", "payload.grant", "payload.operation", "payload.value", "payload.modelWritable"]) {
  assert(!getSkillPanelHandler.includes(forbidden), `Generic panel Renderer IPC must reject authority-bearing input: ${forbidden}.`);
}
assert(files.preload.includes("listSkillPanels: () => ipcRenderer.invoke(CHANNELS.LIST_SKILL_PANELS)"), "preload must expose the narrow generic panel list read.");
assert(files.preload.includes("getCharacterPanelEntry: () => ipcRenderer.invoke(CHANNELS.GET_CHARACTER_PANEL_ENTRY)"), "preload must expose the dedicated Character panel navigation descriptor read.");
assert(files.preload.includes("getSkillPanel: (panelRef, options = {}) => ipcRenderer.invoke(CHANNELS.GET_SKILL_PANEL"), "preload must expose the narrow generic panel view read.");
assert(!files.preload.includes("updateSkillModule") && !files.app.includes("updateSkillModule"), "v1 Renderer must not expose a player Skill-module write surface.");
assert(/confirmation\.requiresText[\s\S]+payload\.confirmationText[\s\S]+return\s+createFailure\(\s*"CONFIRMATION_TEXT_REQUIRED"/.test(extractIpcHandler(files.main, "CONFIRM_SAVE_MAINTENANCE")), "main process must reject wrong clear-current-save confirmation text before bridge calls.");
assert(files.main.includes("getNewGameLifecycle") && files.main.includes("getSaveSlotStore().deleteConfirmed"), "main process must own save lifecycle actions.");
assert(files.main.includes("process.resourcesPath") && files.main.includes("RUNTIME_ROOT"), "main process must resolve packaged runtime resources.");
assert(files.main.includes('runtimeOperations.begin("provider-test")'), "main process must own abort controller for provider key tests.");
assert(files.main.includes('runtimeOperations.begin("run-turn")'), "main process must own abort controller for player turns.");
assert(!files.main.includes('resetRuntimeSession("provider_test_started"'), "A candidate connection probe must not reset an existing adventure.");
assert(files.main.includes("providerConnectionChangeBusy()") && files.main.includes('runtimeOperations.abortAll(reason'), "Connection activation must guard active work; runtime reset retains cancellation support.");
assert(files.main.includes("{ signal: operation.signal }"), "main process must pass operation abort signals into bridge calls.");
assert(files.main.includes("runtimeOperations.abortAll"), "main process must abort runtime operations on reset/window lifecycle.");
assert(files.saveSlots.includes("requestDelete") && files.saveSlots.includes("confirmationToken"), "destructive save lifecycle actions must require confirmation tokens.");
assert(files.saveSlots.includes("deleteConfirmed"), "main-owned maintenance confirmation must be able to delete the active save slot without exposing raw delete to the renderer.");
assert(files.saveSlots.includes("removeSaveDirectoryAtomically") && files.saveSlots.includes("makeWritable"), "native save deletion must atomically handle read-only snapshot content.");
assert(!files.saveSlots.includes("requestOverwrite") && !files.saveSlots.includes("overwrite_executor_not_enabled"), "native saves must not retain the retired overwrite workflow.");

assert(!files.preload.includes("deleteSaveSlot") && !joinedRenderer().includes("deleteSaveSlot"), "delete save must not be exposed to renderer before UI confirmation flow exists.");
assert(files.appData.includes("GREY_CROW_DATA_ROOT"), "app data boundary must support external dataRoot override.");
assert(files.appData.includes("localPathsExposed: false"), "app data status must not expose local paths.");
assert(files.credentialStore.includes('SECURE_CREDENTIAL_PERSISTENCE = "secure-storage"'), "credential store must support secure-storage persistence.");
assert(files.credentialStore.includes("safeStorage.encryptString") && files.credentialStore.includes("safeStorage.decryptString"), "credential store must encrypt and decrypt through Electron safeStorage.");
assert(files.credentialStore.includes("requiresRetestAfterRestart: !secureStorageEnabled"), "credential store must disclose restart semantics from secure storage availability.");
assert(files.credentialStore.includes("secureStorageEnabled"), "credential store must project secure storage state.");
assert(files.credentialStore.includes("desktop-credential-vault-v2") && files.credentialStore.includes("connection:"), "credential store must support provider and connection scoped vault entries.");
assert(files.modelConnections.includes("CUSTOM_CONNECTION_LIMIT = 5"), "custom connection metadata must enforce the five-connection limit.");
assert(files.modelConnections.includes('parsed.protocol !== "https:"') && files.modelConnections.includes("net.isIP(host)"), "custom connection metadata must reject unsafe URL schemes and literal IP hosts.");
assert(files.settingsStore.includes("settings.json"), "desktop settings must persist through the main-owned store.");
assert(files.settingsStore.includes("fs.fsyncSync") && files.settingsStore.includes("fs.renameSync") && files.settingsStore.includes("`${settingsPath}.bak`"), "desktop settings must use atomic writes and a last-known-good backup.");
assert(files.providerTransport.includes('require("undici")') && files.providerTransport.includes("maxRedirections: 0"), "Electron must own the bounded Undici provider transport.");
assert(files.providerTransport.includes("createPublicOnlyLookup") && files.main.includes("requestImpl: PROVIDER_HTTPS_REQUEST"), "custom provider DNS checks must be injected into the actual desktop request path.");
assert(files.settingsStore.includes("SETTINGS_CATALOG"), "settings store must own settings runtime catalog.");
assert(files.settingsStore.includes("getLoadedSkillCatalog") && files.settingsStore.includes("SKILL_INDEX_PATH"), "settings catalog must project the loaded Skill manifest without renderer file access.");
assert(files.settingsStore.includes("credentialPersistence") && files.settingsStore.includes("secure-storage"), "settings catalog must state secure API key handling.");
assert(files.settingsStore.includes("系统安全凭据存储"), "settings catalog must disclose secure credential behavior.");
assert(files.settingsStore.includes("DPAPI"), "settings catalog must reserve Windows secure storage behavior.");
assert(files.settingsStore.includes("debugPanelEnabled"), "desktop settings must persist the developer debug panel preference.");
assert(files.settingsStore.includes("NARRATION_LENGTH_PRESETS") && files.settingsStore.includes("customTargetChars"), "desktop settings must persist narration length preferences.");
assert(files.settingsStore.includes("durableEveryTurn: true"), "desktop settings must disclose that every committed story turn is durably saved.");
assert(files.settingsStore.includes("TTS_CACHE_UTTERANCE_PRESETS") && files.settingsStore.includes("cacheUtteranceLimit"), "desktop settings must persist bounded TTS cache policy.");
assert(["chapterLog", "onManualSave", "onAutoSave", "onCompaction", "intervalTurns"].every((field) => files.settingsStore.includes(field)), "desktop settings must persist chapter generation triggers and cadence.");
assert(files.main.includes("narrationPreferences: settings.narration"), "main process must pass safe narration settings into bridge.");
assert(files.main.includes("settingsAffectNarration") && files.main.includes("refreshActiveBridgeSettings"), "narration changes must refresh the active bridge without provider retest.");
assert(files.main.includes("settingsAffectSavePolicy") && files.main.includes("refreshActiveBridgeSettings(next)"), "persisted save preferences must refresh the active desktop settings.");
assert(files.desktopBridge.includes("narrationPreferences"), "desktop bridge must pass narration preferences into context assembler.");
assert(files.turnGenerator.includes("narrationPreferenceMessage(entry.settings)"), "context assembler must inject narration preference as a prompt section.");
assert(files.sessionContext.includes("countSessionContext") && files.sessionContext.includes("narrationPreferenceMessage"), "context budget must include narration preference itemization.");
assert(files.sessionContext.includes("targetCharacters") && !files.sessionContext.includes("apiKey"), "narration preference metadata must stay safe and non-secret.");
assert(files.saveSlots.includes("SAVE_ID_PATTERN"), "save slots must enforce safe ASCII ids.");
assert(files.status.includes("normalizeDesktopSettings"), "desktop status must normalize settings before exposing status.");
assert(files.runtimeSession.includes("activeBridge: null") && files.runtimeSession.includes("activeSaveId: null"), "runtime session helper must clear bridge and active save.");
assert(files.runtimeSession.includes("createRuntimeOperationRegistry") && files.runtimeSession.includes("AbortController"), "runtime session helper must own operation abort registry.");
assert(files.runtimeSession.includes("abortAndWaitAll") && files.runtimeSession.includes("pendingCount"), "runtime operation registry must retain aborted writers until their handlers finish.");
assert(files.main.includes("quiesceAdventureWrites")
  && files.main.includes('runtimeOperations.has("save-maintenance")')
  && files.main.includes('runtimeOperations.begin("adventure-lifecycle")')
  && files.main.includes("SAVE_DELETE_BUSY"), "Adventure deletion must block new writers and lifecycle switches, then wait for current operations to settle before removing the save root.");
assert(files.app.includes("if (!state.keyVerified)") && files.app.includes("openSettings("), "New Game must be gated by key verification.");
assert(/async function continueGame\(saveId(?:,[^)]*)?\)[\s\S]*?if \(!state\.keyVerified && compatibility\.errorCode !== "STORE_BUSY"\) \{[\s\S]*?openSettings\(t\("menu\.connectionRequired"\), \{ tab: "ai" \}\);[\s\S]*?window\.greyCrow\.continueGame\(saveId\)/.test(files.app), "Only a busy save may request a read-only retry before model verification; normal continuation still opens connection settings.");
assert(files.app.includes("renderTurnInputState") && files.app.includes("!state.gameStarted"), "turn input must stay locked until a verified game is active.");
const runTurnHandler = extractIpcHandler(files.main, "RUN_TURN");
assert(
  /if\s*\(\s*!keyVerified\s*\|\|\s*!activeBridge\s*\)\s*{\s*return\s+createFailure\("PROVIDER_NOT_READY"/.test(runTurnHandler),
  "main process runTurn must reject unverified provider sessions before bridge calls."
);
assert(files.app.includes("window.greyCrow.continueGame") && files.app.includes("window.greyCrow.listSaveSlots"), "renderer must use preload save APIs.");
assert(files.app.includes("window.greyCrow.clearProviderCredential"), "renderer must use preload clear API key API.");
assert(files.app.includes("window.greyCrow.testProviderConnection") && files.app.includes("window.greyCrow.upsertCustomConnection"), "renderer must use the custom provider management APIs.");
assert(files.app.includes("window.greyCrow.listContentLibrary") && files.app.includes("window.greyCrow.savePlayerProfile"), "renderer must use narrow content and player profile APIs.");
assert(files.app.includes("window.greyCrow.loadEditableContent") && files.app.includes("window.greyCrow.saveEditableContent"), "renderer must use the narrow Content Editor API.");
assert(files.app.includes("window.greyCrow.createBlankContent"), "renderer must use the narrow blank content creation API.");
assert(files.app.includes("renderContentAdvancedInfo") && files.app.includes("resolveContentTechnicalProjection")
  && files.app.includes("ui.contentAdvancedInfoList.append(term, description)"), "renderer must render technical information through bounded text nodes.");
assert(files.app.includes("window.greyCrow.requestSaveMaintenance") && files.app.includes("window.greyCrow.confirmSaveMaintenance"), "renderer must use preload save maintenance APIs.");
assert(files.app.includes("window.greyCrow.requestContextCompaction"), "renderer must use preload context maintenance API.");
assert(files.app.includes("window.greyCrow.requestManualSave") && files.app.includes("window.greyCrow.getChapterLogs"), "renderer must use preload manual save and chapter log APIs.");
assert(files.app.includes("window.greyCrow.getDebugTrace") && files.app.includes("renderDebugTraceEntries"), "renderer must use preload debug trace API and render projected entries.");
assert(files.app.includes("buildDebugTraceFilterOptions")
  && files.app.includes("filterDebugTraceEntries")
  && files.app.includes('document.createElement("details")'), "debug trace UI must keep entries collapsible and filterable by safe failure dimensions.");
assert(files.app.includes("maintenanceConfirmInput") && files.app.includes("confirmation.confirmationText"), "renderer clear-current-save flow must expose typed confirmation state.");
assert(files.app.includes('t("save.empty")')
  && files.app.includes('t("maintenance.result.noRepairNeeded")')
  && files.app.includes('t("maintenance.result.repaired"')
  && files.localeZh.includes("当前存档结构完整")
  && files.localeZh.includes("已补齐当前存档缺失项"), "renderer player-facing save wording must use localized current-save repair wording.");
const deletePromptLiteral = files.localeZh.match(/"maintenance\.confirmDeletePrompt":\s*("(?:\\.|[^"\\])*")/)?.[1];
const deletePrompt = deletePromptLiteral ? JSON.parse(deletePromptLiteral) : "";
assert(files.app.includes('t("maintenance.confirmDeletePrompt"')
  && deletePrompt.includes("删除当前冒险后不可恢复")
  && !/restore/i.test(deletePrompt), "clear-current-adventure wording must state irreversible delete without Restore wording.");
assert(files.app.includes("redactDisplaySecrets") && files.app.includes("sk-[redacted]"), "renderer must redact secret-like player-visible text.");
assert(files.app.includes("stripInternalDisplayBlocks") && files.app.includes("soft_writes"), "renderer must strip internal side-channel blocks from host-visible text.");

for (const asset of [
  "renderer/assets/branding/grey-crow-ai-main-menu-bg.png",
  "renderer/assets/branding/grey-crow-ai-logo-zh-CN.png",
  "renderer/assets/branding/grey-crow-ai-logo-en-US.png",
  "renderer/assets/branding/grey-crow-ai-logo-ja-JP.png",
  "renderer/assets/ui/worn_paper.png",
]) {
  assert(fs.existsSync(path.join(root, asset)), `missing bundled asset: ${asset}`);
}

process.stdout.write("desktop static checks passed\n");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function joinedRenderer() {
  return [
    files.html,
    files.app,
    files.css,
  ].join("\n");
}

function readNotebookCssRule(selector) {
  const fullSelector = `#gameView[data-ui-layout="story-notebook-v1"] ${selector}`;
  const escaped = fullSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = files.notebookCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert(match, `missing notebook composition rule: ${selector}`);
  return match[1];
}

function verifyPngAsset(assetPath, asset) {
  const bytes = fs.readFileSync(assetPath);
  assert(bytes.length >= 33
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString("ascii", 12, 16) === "IHDR", `invalid notebook PNG: ${asset.file}`);
  assert(bytes.readUInt32BE(16) === asset.width
    && bytes.readUInt32BE(20) === asset.height, `notebook PNG dimensions changed: ${asset.file}`);
  assert(bytes.length === asset.bytes, `notebook PNG byte size changed: ${asset.file}`);
  assert(crypto.createHash("sha256").update(bytes).digest("hex") === asset.sha256,
    `notebook PNG digest changed: ${asset.file}`);
}

function extractIpcHandler(source, channelName) {
  const start = source.indexOf(`ipcMain.handle(CHANNELS.${channelName}`);
  assert(start >= 0, `missing IPC handler: ${channelName}`);
  const end = source.indexOf("\n  });", start);
  assert(end > start, `could not isolate IPC handler: ${channelName}`);
  return source.slice(start, end);
}

function extractHtmlRegion(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, `missing HTML region start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, `missing HTML region end: ${endMarker}`);
  return source.slice(start, end);
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
