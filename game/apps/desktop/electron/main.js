"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, shell, net } = require("electron");
const { registerSpeechInput, installSpeechInputPermissions } = require("./speech-input/desktop");
const { createProblemRecorder, createReportingIpc, createPlayerProblemReport, savePlayerProblemReport, RENDERER_CODES } = require("./problem-report");
const { createBuildIdentity } = require("./build-identity");

const RUNTIME_ROOT = resolveRuntimeRoot();
const { MODEL_REQUEST_TIMEOUT_MS, CONNECTION_TEST_TIMEOUT_MS } = require(path.join(RUNTIME_ROOT, "engine/runtime/model-time-policy"));
const { createNewGameLifecycle } = require(path.join(RUNTIME_ROOT, "engine/session/session-new-game-lifecycle"));
const { EXECUTION_FORMAT, EXECUTION_MAX_BYTES, sanitizeExecutionSnapshot } = require(path.join(RUNTIME_ROOT, "engine/session/session-execution"));
const { EXECUTION_ACTION_CODES } = require(path.join(RUNTIME_ROOT, "engine/session/session-execution-store"));
const {
  createBuiltinProviderRegistry,
  isUnsafeProviderHost,
  runProviderCompatibilityProbe,
} = require(path.join(RUNTIME_ROOT, "engine/providers"));
const { normalizeError, redactSecrets, ERROR_CODES: PROVIDER_DIAGNOSTIC_CODES } = require(path.join(RUNTIME_ROOT, "engine/providers/provider-contracts"));
const { createTtsService } = require(path.join(RUNTIME_ROOT, "engine/tts/tts-service"));
const {
  createAppDataLayout,
  ensureAppDataLayout,
  projectAppDataFailureStatus,
  projectAppDataStatus,
} = require("./app-data");
const { createCredentialStore, inspectSecureStorage } = require("./credential-store");
const { createTutorialStore } = require("./tutorial-store");
const { createDesktopContentManagement } = require("./content-management");
const {
  CUSTOM_CONTEXT_WINDOW_DEFAULT,
  CUSTOM_CONTEXT_WINDOW_MAX,
  CUSTOM_PROVIDER_ID,
  createConnectionFingerprint,
  deleteCustomConnection,
  getCustomConnection,
  getModelHelpUrl,
  markCustomConnectionVerified,
  upsertCustomConnection,
} = require("./model-connections");
const { createDesktopStatus } = require("./desktop-status");
const { createProviderHttpsTransport } = require("./provider-https-transport");
const { createRuntimeOperationRegistry, resetRuntimeSessionState } = require("./runtime-session");
const {
  createSettingsStore,
  getSettingsCatalog,
  mergeDesktopSettings,
  normalizeDesktopSettings,
  settingsAffectProvider,
} = require("./settings-store");
const {
  canonicalizeGameLocale,
  createLocaleCoordinator,
} = require(path.join(RUNTIME_ROOT, "engine/localization"));
const { createSaveSlotStore } = require("./save-slots");
const {
  createKokoroOriginalProvider,
  inspectOriginalBundle,
} = require("./tts-kokoro-original-provider");
const {
  DEFAULT_WINDOW_MODE,
  getWindowModeSpec,
  normalizeWindowMode,
  resolveAvailableWindowMode,
} = require("./window-modes");
const { createDebugTraceSummary: summarizeDebugTraceEntries } = require("./debug-trace-summary");

const CHANNELS = Object.freeze({
  QUIT_APP: "grey-crow:quit-app",
  GET_STATUS: "grey-crow:get-status",
  GET_SETTINGS: "grey-crow:get-settings",
  GET_TUTORIAL_PROGRESS: "grey-crow:get-tutorial-progress",
  SET_TUTORIAL_DISMISSED: "grey-crow:set-tutorial-dismissed",
  UPDATE_SETTINGS: "grey-crow:update-settings",
  LIST_SAVE_SLOTS: "grey-crow:list-save-slots",

  OPEN_STORY_ARCHIVE: "grey-crow:open-story-archive",
  EXPORT_STORY_ARCHIVE: "grey-crow:export-story-archive",
  CONTINUE_STORY_ARCHIVE: "grey-crow:continue-story-archive",
  TEST_PROVIDER_CONNECTION: "grey-crow:test-provider-connection",
  UPSERT_CUSTOM_CONNECTION: "grey-crow:upsert-custom-connection",
  DELETE_CUSTOM_CONNECTION: "grey-crow:delete-custom-connection",
  CLEAR_PROVIDER_CREDENTIAL: "grey-crow:clear-provider-credential",
  CLEAR_ALL_PROVIDER_CREDENTIALS: "grey-crow:clear-all-provider-credentials",
  OPEN_MODEL_HELP: "grey-crow:open-model-help",
  LIST_CONTENT_LIBRARY: "grey-crow:list-content-library",
  CLONE_CONTENT_PACK: "grey-crow:clone-content-pack",
  CREATE_BLANK_CONTENT: "grey-crow:create-blank-content",
  EXPORT_CONTENT_PACK: "grey-crow:export-content-pack",
  DELETE_CONTENT_PACK: "grey-crow:delete-content-pack",
  LOAD_EDITABLE_CONTENT: "grey-crow:load-editable-content",
  SAVE_EDITABLE_CONTENT: "grey-crow:save-editable-content",
  SAVE_CONTENT_PRESET: "grey-crow:save-content-preset",
  PREVIEW_SKILL_MODULE: "grey-crow:preview-skill-module",
  GET_PLAYER_PROFILE: "grey-crow:get-player-profile",
  SAVE_PLAYER_PROFILE: "grey-crow:save-player-profile",
  START_NEW_GAME: "grey-crow:start-new-game",
  GET_NEW_GAME_CATALOG: "grey-crow:get-new-game-catalog",
  PREPARE_NEW_GAME: "grey-crow:prepare-new-game",
  CONFIRM_NEW_GAME_CREATION: "grey-crow:confirm-new-game-creation",
  REQUEST_NEW_GAME_RESTART: "grey-crow:request-new-game-restart",
  CONFIRM_NEW_GAME_RESTART: "grey-crow:confirm-new-game-restart",
  CONTINUE_GAME: "grey-crow:continue-game",
  LIST_SKILL_MODULES: "grey-crow:list-skill-modules",
  GET_SKILL_MODULE: "grey-crow:get-skill-module",
  LIST_SKILL_PANELS: "grey-crow:list-skill-panels",
  GET_CHARACTER_PANEL_ENTRY: "grey-crow:get-character-panel-entry",
  GET_SKILL_PANEL: "grey-crow:get-skill-panel",
  REQUEST_SAVE_MAINTENANCE: "grey-crow:request-save-maintenance",
  CONFIRM_SAVE_MAINTENANCE: "grey-crow:confirm-save-maintenance",
  REQUEST_CONTEXT_COMPACTION: "grey-crow:request-context-compaction",
  READ_CONTEXT_COMPACTION: "grey-crow:read-context-compaction",
  REQUEST_MANUAL_SAVE: "grey-crow:request-manual-save",
  RESUME_SESSION_FINALE: "grey-crow:resume-session-finale",
  GET_CHAPTER_LOGS: "grey-crow:get-chapter-logs",
  GET_DEBUG_TRACE: "grey-crow:get-debug-trace",
  EXPORT_PROBLEM_REPORT: "grey-crow:export-problem-report",
  RECORD_RENDERER_PROBLEM: "grey-crow:record-renderer-problem",
  SYNTHESIZE_TTS: "grey-crow:synthesize-tts",
  START_TTS_UTTERANCE: "grey-crow:start-tts-utterance",
  CONTINUE_TTS_UTTERANCE: "grey-crow:continue-tts-utterance",
  CANCEL_TTS_UTTERANCE: "grey-crow:cancel-tts-utterance",
  GET_TTS_CACHE_STATUS: "grey-crow:get-tts-cache-status",
  CLEAR_TTS_CACHE: "grey-crow:clear-tts-cache",
  RUN_TURN: "grey-crow:run-turn",
  CANCEL_TURN: "grey-crow:cancel-turn",
  COMPLETE_TURN_DERIVED: "grey-crow:complete-turn-derived",
  READ_SESSION_HISTORY: "grey-crow:read-session-history",
  LEAVE_ADVENTURE: "grey-crow:leave-adventure",
  RESET_SESSION: "grey-crow:reset-session",
});

const PROVIDER_TEST_SAVE_ID = "provider-check";
const PROVIDER_TEST_SESSION_ID = "provider-check";
const MAX_PLAYER_INPUT_CHARS = 4000;
const PROVIDER_REGISTRY = createBuiltinProviderRegistry();
const PROVIDER_HTTPS_REQUEST = createProviderHttpsTransport({
  isUnsafeAddress: isUnsafeProviderHost,
});
const MAINTENANCE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const CLEAR_CURRENT_SAVE_CONFIRMATION_TEXT = "DELETE";
const DEBUG_TRACE_EXPORT_ENTRY_LIMIT = 200;
const DEBUG_TRACE_EXPORT_RECENT_LIMIT = 100;
const DEBUG_TRACE_EXPORT_ERROR_LIMIT = 100;
const TTS_INTERNAL_SECTION_PATTERN = /(?:candidate_events|candidateEvents|soft_writes|softWrites|hard_state_proposals|hardStateProposals|memory_notes|memoryNotes|uncertainties|operation_trace|operationTrace|Runtime tool|tool_call|function_call|raw provider|provider raw|Hard Commit Validator|State Store|Memory Store|Context Assembler|Fact Gate|工具调用|运行时|状态存储|上下文组装|事实闸门|不确定性)(?:\b|\s*:|：)/i;
const TTS_INTERNAL_SECTION_START_PATTERN = /^\s*(?:[-*]\s*)?(?:candidate_events|candidateEvents|soft_writes|softWrites|hard_state_proposals|hardStateProposals|memory_notes|memoryNotes|uncertainties|operation_trace|operationTrace|Runtime tool|tool_call|function_call|raw provider|provider raw|Hard Commit Validator|State Store|Memory Store|Context Assembler|Fact Gate|工具调用|运行时|状态存储|上下文组装|事实闸门|不确定性)\s*[:：]?\s*$/i;
const TTS_STRUCTURED_LINE_PATTERN = /^\s*(?:[-*]\s*)?(?:[{[\]}]|\{?\s*"(?:candidate_events|candidateEvents|soft_writes|softWrites|hard_state_proposals|hardStateProposals|memory_notes|memoryNotes|uncertainties|type|summary|evidence|risk|meta|id)"\s*:)/i;
const SAVE_MAINTENANCE_ACTIONS = Object.freeze({
  repair: Object.freeze({
    danger: "medium",
    label: "修复当前存档",
    requiresText: false,
    reason: "desktop_manual_repair",
  }),
  clear: Object.freeze({
    danger: "critical",
    label: "删除当前冒险",
    requiresText: true,
    confirmationText: CLEAR_CURRENT_SAVE_CONFIRMATION_TEXT,
    reason: "desktop_manual_delete_game",
  }),
});
const ADVENTURE_QUIESCE_OPERATION_KINDS = Object.freeze([
  "run-turn",
  "turn-derived",
  "context-compaction",
  "manual-save",
  "adventure-lifecycle",
]);
const ADVENTURE_WRITE_QUIESCE_TIMEOUT_MS = 10_000;
const WINDOW_FRAME_ALLOWANCE = Object.freeze({
  width: 32,
  height: 72,
});

let mainWindow = null;
let currentWindowMode = null;
let lastWindowedMode = DEFAULT_WINDOW_MODE;
let windowModeTransitioning = false;
let trustedRendererUrl = null;
let activeBridge = null;
let desktopSessionGeneration = crypto.randomBytes(8).toString("hex");
let desktopContextBinding = null;
let sessionDisposal = Promise.resolve();
let sessionContinuationFlight = null;
let lastSessionContinuation = null;
let turnDerivedQueue = null;
let activePlayerTurn = null;
const turnDerivedTickets = new Map();
let sessionShutdownComplete = false;
let sessionShutdownStarted = false;
let sessionRecoveryRequired = false;
let keyVerified = false;
let gameStarted = false;
let settingsStore = null;
let saveSlotStore = null;
let appDataLayout = null;
let appDataStatus = null;
let credentialStore = null;
let contentManagement = null;
let ttsService = null;
let speechInput = null;
let newGameLifecycle = null;
let localeCoordinator = null;
let activeSaveId = null;
let activeSaveSummary = null;
let problemRecorder = null;
let desktopBuildIdentity = null;
let problemExporting = false;
const runtimeOperations = createRuntimeOperationRegistry();
const saveMaintenanceConfirmations = new Map();
const newGameCreationConfirmations = new Map();

function resolveRuntimeRoot() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../..");
}


function getDataRoot() {
  return getAppDataLayout().dataRoot;
}


function settingsAffectNarration(previous, next) {
  return JSON.stringify(previous?.narration || {}) !== JSON.stringify(next?.narration || {});
}

function settingsAffectAgentContext(previous, next) {
  return JSON.stringify(previous?.agent?.context || {}) !== JSON.stringify(next?.agent?.context || {});
}

function settingsAffectSavePolicy(previous, next) {
  return JSON.stringify(previous?.save || {}) !== JSON.stringify(next?.save || {});
}

function settingsAffectTts(previous, next) {
  return JSON.stringify(selectTtsRuntimeSettings(previous)) !== JSON.stringify(selectTtsRuntimeSettings(next));
}

function settingsAffectTtsCache(previous, next) {
  return previous?.audio?.tts?.cacheUtteranceLimit !== next?.audio?.tts?.cacheUtteranceLimit;
}

function selectTtsRuntimeSettings(settings = {}) {
  const tts = settings?.audio?.tts || {};
  return {
    enabled: Boolean(tts.enabled),
    provider: tts.provider || "disabled",
    voiceId: tts.voiceId || "",
    rate: tts.rate || "+0%",
    pitch: tts.pitch || "+0Hz",
  };
}

function refreshActiveBridgeSettings(settings) {
  if (!activeBridge || !keyVerified) {
    return;
  }
  resetRuntimeSession("runtime_settings_changed", { clearCredential: false, preserveAdventure: true });
  return;
}

function getWindowDisplay(window = mainWindow) {
  if (window && !window.isDestroyed()) {
    return screen.getDisplayMatching(window.getBounds());
  }
  return screen.getPrimaryDisplay();
}

function canDisplayWindowMode(mode, window = mainWindow) {
  const spec = typeof mode === "string" ? getWindowModeSpec(mode) : mode;
  if (!spec || spec.kind === "fullscreen") {
    return true;
  }
  const workArea = getWindowDisplay(window)?.workAreaSize;
  if (!workArea) {
    return false;
  }
  return spec.contentWidth + WINDOW_FRAME_ALLOWANCE.width <= workArea.width
    && spec.contentHeight + WINDOW_FRAME_ALLOWANCE.height <= workArea.height;
}

function resolveEffectiveWindowMode(requested, window = mainWindow) {
  return resolveAvailableWindowMode(
    requested,
    (mode) => canDisplayWindowMode(mode, window)
  );
}

function waitForFullScreenState(window, enabled) {
  if (window.isFullScreen() === enabled) {
    return Promise.resolve();
  }
  const eventName = enabled ? "enter-full-screen" : "leave-full-screen";
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeListener(eventName, finish);
      resolve();
    };
    const timer = setTimeout(finish, 2_000);
    window.once(eventName, finish);
    window.setFullScreen(enabled);
  });
}

async function applyWindowMode(requested, { allowFallback = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  const normalized = normalizeWindowMode(requested);
  const effective = allowFallback
    ? resolveEffectiveWindowMode(normalized, mainWindow)
    : normalized;
  if (effective !== "fullscreen" && !canDisplayWindowMode(effective, mainWindow)) {
    const error = new Error("The selected window mode does not fit on the current display.");
    error.code = "WINDOW_MODE_UNAVAILABLE";
    error.retryable = false;
    throw error;
  }

  windowModeTransitioning = true;
  try {
    if (effective === "fullscreen") {
      if (currentWindowMode && currentWindowMode !== "fullscreen") {
        lastWindowedMode = currentWindowMode;
      }
      mainWindow.setAspectRatio(0);
      await waitForFullScreenState(mainWindow, true);
    } else {
      await waitForFullScreenState(mainWindow, false);
      const spec = getWindowModeSpec(effective);
      mainWindow.setResizable(true);
      mainWindow.setContentSize(spec.contentWidth, spec.contentHeight, false);
      mainWindow.setAspectRatio(spec.contentWidth / spec.contentHeight);
      mainWindow.center();
      mainWindow.setResizable(false);
      mainWindow.setMaximizable(false);
      lastWindowedMode = effective;
    }
    currentWindowMode = effective;
    return effective;
  } finally {
    windowModeTransitioning = false;
  }
}

function createWindow() {
  const rendererPath = path.join(__dirname, "renderer", "index.html");
  trustedRendererUrl = pathToFileURL(rendererPath).href;
  const storedSettings = loadDesktopSettings();
  const requestedWindowMode = normalizeWindowMode(storedSettings.ui?.windowMode);
  const effectiveWindowMode = resolveEffectiveWindowMode(requestedWindowMode, null);
  const initialMode = effectiveWindowMode === "fullscreen" ? "compact" : effectiveWindowMode;
  const initialSpec = getWindowModeSpec(initialMode);
  if (effectiveWindowMode !== requestedWindowMode) {
    saveDesktopSettings(normalizeDesktopSettings(mergeDesktopSettings(storedSettings, {
      ui: { windowMode: effectiveWindowMode },
    })));
  }
  currentWindowMode = effectiveWindowMode;
  lastWindowedMode = initialMode;

  mainWindow = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: initialSpec.contentWidth,
    height: initialSpec.contentHeight,
    resizable: false,
    maximizable: false,
    backgroundColor: "#0a0c0b",
    title: "Grey Crow",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", async () => {
    if (!mainWindow) {
      return;
    }
    try {
      await applyWindowMode(effectiveWindowMode, { allowFallback: true });
    } catch (error) {
      console.warn("Grey Crow window mode fallback failed:", error.message);
    }
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  installSpeechInputPermissions({ webContents: mainWindow.webContents, trustedUrl: trustedRendererUrl, getSettings: loadDesktopSettings });
  mainWindow.webContents.on("render-process-gone", () => {
    problemRecorder?.record("interface", "RENDERER_GONE");
    void speechInput?.dispose();
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== trustedRendererUrl) {
      event.preventDefault();
    }
  });
  mainWindow.on("leave-full-screen", () => {
    if (windowModeTransitioning || currentWindowMode !== "fullscreen") {
      return;
    }
    const fallbackMode = resolveEffectiveWindowMode(lastWindowedMode, mainWindow);
    const stored = loadDesktopSettings();
    saveDesktopSettings(normalizeDesktopSettings(mergeDesktopSettings(stored, {
      ui: { windowMode: fallbackMode },
    })));
    void applyWindowMode(fallbackMode, { allowFallback: true }).catch((error) => {
      console.warn("Grey Crow could not restore the previous window mode:", error.message);
    });
  });
  mainWindow.on("closed", () => {
    runtimeOperations.abortAll("window_closed");
    void disposeTtsService();
    void speechInput?.dispose();
    mainWindow = null;
    currentWindowMode = null;
    lastWindowedMode = DEFAULT_WINDOW_MODE;
    windowModeTransitioning = false;
  });

  mainWindow.loadFile(rendererPath);
}

function registerIpcHandlers() {
  const ipcMain = createReportingIpc({ ipcMain: require("electron").ipcMain, recorder: problemRecorder });
  speechInput = registerSpeechInput({ ipcMain, assertTrustedSender, getSettings: loadDesktopSettings, getDataRoot,
    getContext: () => ({ adventureId: activeSaveId, sessionId: desktopSessionGeneration,
      ready: Boolean(gameStarted && activeBridge && activeSaveId && !sessionRecoveryRequired
        && !runtimeOperations.has("run-turn") && !runtimeOperations.has("context-compaction")) }),
    runtimeRoot: process.env.GREY_CROW_SPEECH_INPUT_RUNTIME_ROOT || (app.isPackaged
      ? path.join(process.resourcesPath, "speech-input")
      : path.join(__dirname, "speech-input", ".runtime", `${process.platform}-${process.arch}`)),
    bundledModelRoot: process.env.GREY_CROW_SPEECH_INPUT_MODEL_ROOT || (app.isPackaged
      ? path.join(process.resourcesPath, "speech-input-model")
      : path.join(__dirname, "speech-input", ".model")),
    fetchImpl: (url, options) => net.fetch(url, options),
  });
  ipcMain.handle(CHANNELS.QUIT_APP, (event) => {
    assertTrustedSender(event);
    setImmediate(() => app.quit());
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.GET_STATUS, (event) => {
    assertTrustedSender(event);
    return createStatus();
  });

  ipcMain.handle(CHANNELS.RECORD_RENDERER_PROBLEM, (event, payload = {}) => {
    assertTrustedSender(event);
    if (!RENDERER_CODES.has(payload?.code)) return { ok: true, ignored: true };
    const area = payload.code.startsWith("SPEECH_") ? "speech-input" : payload.code.startsWith("TTS_") ? "speech-output" : "interface";
    problemRecorder?.record(area, payload.code);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.EXPORT_PROBLEM_REPORT, async (event) => {
    assertTrustedSender(event);
    if (problemExporting) return { ok: true, cancelled: true };
    problemExporting = true;
    try {
      let settings;
      try { settings = loadDesktopSettings(); } catch { settings = {}; }
      const report = createPlayerProblemReport({ build: desktopBuildIdentity, recorder: problemRecorder,
        settings, state: { keyVerified, gameStarted } });
      return await savePlayerProblemReport({ dialog, window: mainWindow, documentsPath: app.getPath("documents"),
        locale: settings.localization?.preferredLocale, report });
    } catch {
      return { ok: false, error: { code: "REPORT_WRITE_FAILED", retryable: true } };
    } finally { problemExporting = false; }
  });

  ipcMain.handle(CHANNELS.GET_SETTINGS, (event) => {
    assertTrustedSender(event);
    return {
      ok: true,
      settings: getSettingsSnapshot(),
      catalog: getDesktopSettingsCatalog(),
      status: createStatus(),
      settingsPersistence: getSettingsStore().consumeStatus(),
    };
  });

  ipcMain.handle(CHANNELS.GET_TUTORIAL_PROGRESS, (event, payload = {}) => {
    assertTrustedSender(event);
    const topic = payload?.topic ?? "intro";
    if (!["intro", "game-ui"].includes(topic)) return { ok: false, error: { code: "INVALID_TUTORIAL_PROGRESS", retryable: false } };
    try {
      return { ok: true, progress: createTutorialStore({ dataRoot: getDataRoot(), topic }).read() };
    } catch {
      return { ok: false, error: { code: "TUTORIAL_READ_FAILED", retryable: true } };
    }
  });

  ipcMain.handle(CHANNELS.SET_TUTORIAL_DISMISSED, (event, payload = {}) => {
    assertTrustedSender(event);
    const topic = payload?.topic ?? "intro";
    if (typeof payload?.dismissed !== "boolean" || !["intro", "game-ui"].includes(topic)) {
      return { ok: false, error: { code: "INVALID_TUTORIAL_PROGRESS", retryable: false } };
    }
    try {
      return { ok: true, progress: createTutorialStore({ dataRoot: getDataRoot(), topic }).setDismissed(payload.dismissed) };
    } catch {
      return { ok: false, error: { code: "TUTORIAL_WRITE_FAILED", retryable: true } };
    }
  });

  ipcMain.handle(CHANNELS.UPDATE_SETTINGS, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const previous = loadDesktopSettings();
      const coordinator = getLocaleCoordinator(previous.localization?.preferredLocale || null);
      const settingsPatch = payload.settings || payload;
      const requestedPreferredLocale = readRequestedPreferredLocale(settingsPatch);
      const next = normalizeDesktopSettings(mergeDesktopSettings(previous, settingsPatch));
      if (JSON.stringify(previous.api) !== JSON.stringify(next.api)) {
        return createFailure("MODEL_CONNECTION_REQUIRES_TEST", "请在模型连接页测试并使用新的连接。", false);
      }
      if (requestedPreferredLocale.provided) {
        next.localization.preferredLocale = canonicalizeGameLocale(requestedPreferredLocale.value);
      }
      if (previous.localization?.preferredLocale !== next.localization.preferredLocale
        && (gameStarted || activeSaveId)) {
        return createFailure(
          "GAME_LOCALE_LOCKED_BY_ADVENTURE",
          "当前冒险期间不能切换语言。返回主菜单后再修改。",
          false
        );
      }
      if (next.api.provider === CUSTOM_PROVIDER_ID && settingsAffectProvider(previous, next)) {
        const connection = getCustomConnection(next.api.customConnections, next.api.connectionId);
        const identity = getCredentialIdentity(next);
        if (!connection?.verifiedAt || !getCredentialStore().isVerified(identity)) {
          return createFailure(
            "CUSTOM_CONNECTION_NOT_VERIFIED",
            "请先完成自定义连接的工具兼容性测试。",
            false
          );
        }
      }
      if (previous.ui?.windowMode !== next.ui.windowMode
        && next.ui.windowMode !== "fullscreen"
        && !canDisplayWindowMode(next.ui.windowMode, mainWindow)) {
        return createFailure(
          "WINDOW_MODE_UNAVAILABLE",
          "当前显示器工作区无法完整容纳这个窗口档位，请选择更小的窗口或全屏。",
          false
        );
      }
      const contextValidation = await validateActiveContextSettings(previous, next);
      if (!contextValidation.ok) {
        return createFailure(contextValidation.errorCode || "CONTEXT_SETTINGS_TOO_SMALL",
          "当前故事所需上下文不能放入这个窗口，请选择更大的窗口后重试。", true);

      }
      if (JSON.stringify(loadDesktopSettings()) !== JSON.stringify(previous)) {
        return createFailure("CONTEXT_SETTINGS_STALE", "设置在保存期间发生了变化，请再保存一次。", true);
      }
      saveDesktopSettings(next);
      await speechInput?.settingsChanged(previous, next);
      if (previous.ui?.windowMode !== next.ui.windowMode) {
        try {
          await applyWindowMode(next.ui.windowMode);
        } catch (error) {
          const latest = loadDesktopSettings();
          const windowMode = latest.ui.windowMode === next.ui.windowMode
            ? previous.ui.windowMode : latest.ui.windowMode;
          saveDesktopSettings(mergeDesktopSettings(latest, { ui: { windowMode } }));
          try {
            await applyWindowMode(windowMode, { allowFallback: true });
          } catch (_rollbackError) {
            // The persisted rollback remains authoritative even if the OS rejects a window transition.
          }
          throw error;
        }
      }
      if (previous.localization?.preferredLocale !== next.localization.preferredLocale) {
        coordinator.setPreferredLocale(next.localization.preferredLocale);
      }

      if (settingsAffectTts(previous, next)) {
        await disposeTtsService();
      }
      if (settingsAffectTtsCache(previous, next)) {
        try {
          getTtsService().applyCachePolicy(next);
        } catch (_error) {
          // Cache maintenance is optional and must not make settings persistence fail.
        }
      }

      if (settingsAffectProvider(previous, next)) {
        resetRuntimeSession("settings_changed", { clearCredential: false, preserveAdventure: true });
      } else if (
        settingsAffectNarration(previous, next) ||
        settingsAffectAgentContext(previous, next)
      ) {
        refreshActiveBridgeSettings(next);
      }
      if (settingsAffectSavePolicy(previous, next) && activeBridge) activeBridge.updateSaveSettings(next.save);

      return {
        ok: true,
        settings: getSettingsSnapshot(),
        catalog: getDesktopSettingsCatalog(),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.LIST_SAVE_SLOTS, async (event) => {
    assertTrustedSender(event);
    try {
      return {
        ok: true,
        saves: await listSaveSlots(),
        pendingDeletes: await getSaveSlotStore().listPendingDeletes(),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.OPEN_STORY_ARCHIVE, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (runtimeOperations.has("save-maintenance")) {
      return createFailure("SAVE_MAINTENANCE_BUSY", "当前冒险正在执行维护，请稍后重试。", true);
    }
    const operation = runtimeOperations.begin("adventure-lifecycle");
    try {
      const save = await loadSaveSlot(payload.saveId);
      if (!save) return createFailure("SAVE_NOT_FOUND", "没有找到故事档案。", false);
      const result = await openStoryArchivePayload(save, operation);
      if (!operation.isCurrent()) {
        return createFailure("REQUEST_ABORTED", "打开故事档案的操作已取消。", false);
      }
      return result;
    } catch (error) {
      return createFailureFromError(error);
    } finally {
      operation.finish();
    }
  });

  ipcMain.handle(CHANNELS.EXPORT_STORY_ARCHIVE, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (!isDesktopProjectionRequestCurrent(payload)) return { ok: false, stale: true };
    const binding = captureDesktopProjectionBinding();
    try {
      const format = normalizeStoryExportRequest(payload);
      const save = activeSaveId ? await loadSaveSlot(activeSaveId) : null;
      if (!save || save.compatibility?.status !== "closed") {
        return createFailure("STORY_EXPORT_NOT_CLOSED", "只有已经封存的故事可以导出。", false);
      }
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      const outputPath = await chooseStoryExportTarget(save, format);
      if (!outputPath) return { ok: true, canceled: true };
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      const exporter = (require(path.join(RUNTIME_ROOT, "engine/session/session-story-export")).createSessionStoryExporter({ reader: getSessionArchiveReader() }));
      const result = await exporter.exportStory({
        adventureId: save.id,
        format,
        outputPath,
        storyTitle: save.title,
      });
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return { ...result, status: createStatus() };
    } catch (error) {
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.CONTINUE_STORY_ARCHIVE, async (event, payload = {}) => {
    assertTrustedSender(event);

    return continueSessionStoryArchive(payload);

  });

  ipcMain.handle(CHANNELS.UPSERT_CUSTOM_CONNECTION, (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const previous = loadDesktopSettings();
      const before = getCustomConnection(previous.api.customConnections, payload.connection?.id || payload.id);
      const updated = upsertCustomConnection(previous.api.customConnections, payload.connection || payload);
      const changedIdentity = Boolean(before && createConnectionFingerprint(before) !== createConnectionFingerprint(updated.connection));
      if (changedIdentity && (before.verifiedAt || previous.api.connectionId === before.id
        || getCredentialStore().status({ connectionId: before.id }).hasVerifiedCredential)) {
        return createFailure("MODEL_CONNECTION_REQUIRES_TEST", "编辑已有连接后，请测试并使用；当前连接会保留到测试成功。", false);
      }
      runtimeOperations.abort("provider-test", "custom_connection_edited");
      const next = normalizeDesktopSettings(mergeDesktopSettings(previous, {
        api: { customConnections: updated.connections },
      }));
      saveDesktopSettings(next);
      if (previous.api.connectionId === updated.connection.id && changedIdentity) {
        resetRuntimeSession("custom_connection_changed", { clearCredential: false, preserveAdventure: true });
      }
      return {
        ok: true,
        connection: updated.connection,
        settings: getSettingsSnapshot(),
        catalog: getDesktopSettingsCatalog(),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.DELETE_CUSTOM_CONNECTION, (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const previous = loadDesktopSettings();
      if (providerConnectionChangeBusy()) return providerConnectionBusyFailure();
      const deleted = deleteCustomConnection(previous.api.customConnections, payload.connectionId);
      if (!deleted.removed) {
        return createFailure("CUSTOM_CONNECTION_NOT_FOUND", "没有找到需要删除的自定义连接。", false);
      }
      runtimeOperations.abort("provider-test", "custom_connection_deleted");
      const deletingActive = previous.api.provider === CUSTOM_PROVIDER_ID && previous.api.connectionId === deleted.removed.id;
      const next = normalizeDesktopSettings(mergeDesktopSettings(previous, {
        api: {
          customConnections: deleted.connections,
          ...(deletingActive ? {
            provider: "deepseek",
            model: normalizeDesktopSettings().api.model,
            connectionId: null,
          } : {}),
        },
      }));
      try {
        getCredentialStore().clear({ connectionId: deleted.removed.id });
        saveDesktopSettings(next);
      } finally {
        if (deletingActive) resetRuntimeSession("custom_connection_deleted", { clearCredential: false, preserveAdventure: true });
      }
      return {
        ok: true,
        settings: getSettingsSnapshot(),
        catalog: getDesktopSettingsCatalog(),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.TEST_PROVIDER_CONNECTION, async (event, payload = {}) => {
    assertTrustedSender(event);
    return testAndUseProviderConnection(payload);
  });

  ipcMain.handle(CHANNELS.CLEAR_PROVIDER_CREDENTIAL, (event, payload = {}) => {
    assertTrustedSender(event);
    return clearSavedProviderCredentials(payload);
  });

  ipcMain.handle(CHANNELS.CLEAR_ALL_PROVIDER_CREDENTIALS, (event, payload = {}) => {
    assertTrustedSender(event);
    if (payload.confirmed !== true) {
      return createFailure("CREDENTIAL_CLEAR_CONFIRMATION_REQUIRED", "请先确认清除本设备保存的全部模型密钥。", false);
    }
    return clearSavedProviderCredentials(payload, { all: true });
  });

  ipcMain.handle(CHANNELS.OPEN_MODEL_HELP, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const url = getModelHelpUrl(payload.helpId);
      if (!url) {
        return createFailure("MODEL_HELP_NOT_FOUND", "没有找到该模型的官方文档。", false);
      }
      await shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.LIST_CONTENT_LIBRARY, async (event) => {
    assertTrustedSender(event);
    try {
      return { ok: true, library: await getContentManagement().listContent() };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.CLONE_CONTENT_PACK, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const result = await getContentManagement().cloneContent(payload);
      invalidateNewGameContentSelections();
      return result;
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.CREATE_BLANK_CONTENT, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const result = await getContentManagement().createBlankContent(payload);
      invalidateNewGameContentSelections();
      return result;
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.EXPORT_CONTENT_PACK, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const destinationRoot = await chooseContentExportRoot();
      if (!destinationRoot) return { ok: true, canceled: true };
      return await getContentManagement().exportContent({ packId: payload.packId, destinationRoot });
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.DELETE_CONTENT_PACK, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const result = await getContentManagement().deleteContent({ packId: payload.packId });
      invalidateNewGameContentSelections();
      return result;
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.LOAD_EDITABLE_CONTENT, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      return await getContentManagement().loadEditableContent({
        packId: payload.packId,
        itemId: payload.itemId,
      });
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.SAVE_EDITABLE_CONTENT, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const result = await getContentManagement().saveEditableContent(payload);
      invalidateNewGameContentSelections();
      return result;
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.SAVE_CONTENT_PRESET, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const result = await getContentManagement().saveContentPreset(payload);
      invalidateNewGameContentSelections();
      return result;
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.PREVIEW_SKILL_MODULE, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      return await getContentManagement().previewSkillModule({
        title: payload.title,
        description: payload.description,
        playerGuide: payload.playerGuide,
        triggers: payload.triggers,
        moduleDraft: payload.moduleDraft,
      });
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.GET_PLAYER_PROFILE, async (event) => {
    assertTrustedSender(event);
    try {
      return await getContentManagement().loadPlayerProfile();
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.SAVE_PLAYER_PROFILE, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      return await getContentManagement().savePlayerProfile({ fields: payload.fields });
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.START_NEW_GAME, async (event) => {
    assertTrustedSender(event);
    if (!keyVerified || !activeBridge) {
      return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
    }
    return createFailure("NEW_GAME_SELECTION_REQUIRED", "请先选择剧本组合与普通 Skill，再确认创建新冒险。", false);
  });

  ipcMain.handle(CHANNELS.GET_NEW_GAME_CATALOG, async (event) => {
    assertTrustedSender(event);
    if (!keyVerified || !activeBridge) {
      return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
    }
    try {
      if (await hasActiveAdventure()) {
        return createFailure("ADVENTURE_ALREADY_EXISTS", "当前已有冒险，请先通过确认流程删除后再开始新游戏。", false);
      }
      newGameCreationConfirmations.clear();
      return {
        ok: true,
        catalog: await getNewGameLifecycle().catalog(),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.PREPARE_NEW_GAME, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (!keyVerified || !activeBridge) {
      return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
    }
    try {
      if (await hasActiveAdventure()) {
        return createFailure("ADVENTURE_ALREADY_EXISTS", "当前已有冒险，不能直接覆盖。", false);
      }
      const prepared = await getNewGameLifecycle().prepare({
        preset: payload.selection?.preset,
        optionalSkillChoices: payload.selection?.optionalSkillChoices,
        adventureLocale: requirePreferredLocale(),
      });
      const confirmation = issueNewGameCreationConfirmation(prepared);
      return {
        ok: true,
        review: prepared.review,
        confirmationToken: confirmation.confirmationToken,
        expiresAt: confirmation.expiresAt,
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.CONFIRM_NEW_GAME_CREATION, async (event, payload = {}) => {
    assertTrustedSender(event);

    if (runtimeOperations.has("save-maintenance")) {
      return createFailure("SAVE_MAINTENANCE_BUSY", "当前冒险正在执行维护，请稍后重试。", true);
    }
    if (!keyVerified || !activeBridge) {
      return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
    }
    const operation = runtimeOperations.begin("adventure-lifecycle");
    try {
      if (await hasActiveAdventure()) {
        return createFailure("ADVENTURE_ALREADY_EXISTS", "当前已有冒险，不能直接覆盖。", false);
      }
      const confirmation = takeNewGameCreationConfirmation(payload.confirmationToken);
      if (!confirmation) {
        return createFailure("NEW_GAME_CONFIRMATION_EXPIRED", "新游戏确认已失效，请重新校验内容组合。", false);
      }
      if (confirmation.createRequest.adventureLocale !== requirePreferredLocale()) {
        return createFailure("NEW_GAME_CONFIRMATION_STALE", "主菜单语言已改变，请重新校验内容组合。", false);
      }
      const created = await getNewGameLifecycle().create(confirmation.createRequest);
      getLocaleCoordinator().enterAdventure({
        adventureId: created.adventureId,
        adventureLocale: created.inspection.adventureLocale,
      });
      try {
        await activeBridge.initializeNewGame({
          save_id: created.adventureId,
          preset_id: created.lockedContent.preset?.itemId || "default",
        });
      } catch (error) {
        getLocaleCoordinator().leaveAdventure({ adventureId: created.adventureId });
        await removeFailedAdventureCreation(created.adventureId).catch((cleanupError) => {
          console.warn("Grey Crow failed New Game cleanup deferred", normalizeUiErrorMessage(cleanupError?.message || cleanupError));
        });
        throw error;
      }
      const save = await loadSaveSlot(created.adventureId);
      if (!save) {
        getLocaleCoordinator().leaveAdventure({ adventureId: created.adventureId });
        return createFailure("NEW_GAME_CREATED_SAVE_MISSING", "新冒险创建后无法读取，请保留数据并查看修复说明。", false);
      }
      if (!operation.isCurrent()) {
        getLocaleCoordinator().leaveAdventure({ adventureId: created.adventureId });
        return createFailure("REQUEST_ABORTED", "创建新冒险的操作已取消。", false);
      }
      const openingEnvelope = await activeBridge.startNewGameLifecycle({
        save_id: created.adventureId,
      });
      const openingProjection = (openingEnvelope.projection);
      const openedSave = openingProjection?.save || save;
      sessionRecoveryRequired = false;
      const skillModules = await activeBridge.listCurrentSkillModules({ save_id: created.adventureId });
      const saves = await listSaveSlots();
      if (!operation.isCurrent()) {
        getLocaleCoordinator().leaveAdventure({ adventureId: created.adventureId });
        return createFailure("REQUEST_ABORTED", "创建新冒险的操作已取消。", false);
      }
      activeSaveId = openedSave.id;
      activeSaveSummary = openedSave;
      gameStarted = true;
      return {
        ok: true,
        save: openedSave,
        projection: openingProjection,
        lockedContent: created.lockedContent,
        openingEnvelope: ({ ...openingEnvelope, ok: !openingEnvelope.error,
          contextUsage: bindSessionContextUsage(openingEnvelope.contextUsage) }),
        skillModules: skillModules.modules,
        saves,
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    } finally {
      operation.finish();
    }
  });

  ipcMain.handle(CHANNELS.REQUEST_NEW_GAME_RESTART, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const save = await resolveExistingSaveForNewGameRestart(payload.saveId);
      if (!save) {
        return createFailure("SAVE_NOT_FOUND", "没有找到当前冒险，可以直接开始新游戏。", false);
      }
      const compatibility = await getAdventureCompatibilityGate().inspect(save.id);
      assertSaveNotBusy(compatibility);
      saveMaintenanceConfirmations.clear();
      const confirmation = issueSaveMaintenanceConfirmation({
        action: "clear",
        saveId: save.id,
        save,
        inspection: compatibility,
        scope: "active_adventure",
      });
      if (!confirmation?.confirmationToken) {
        return createFailure("NEW_GAME_RESTART_CONFIRMATION_FAILED", "无法准备新游戏确认。", false);
      }
      return {
        ok: true,
        confirmation: projectNewGameRestartConfirmation(confirmation),
        saves: await listSaveSlots(),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.CONFIRM_NEW_GAME_RESTART, async (event, payload = {}) => {
    assertTrustedSender(event);

    try {
      const confirmationToken = normalizeConfirmationToken(payload.confirmationToken);
      const confirmation = getSaveMaintenanceConfirmation(confirmationToken);
      if (!confirmation || confirmation.action !== "clear") {
        return createFailure("INVALID_CONFIRMATION_TOKEN", "新游戏删档确认已失效，请重新发起。", false);
      }
      const confirmationText = String(payload.confirmationText || "").trim();
      if (confirmationText !== confirmation.confirmationText) {
        return createFailure(
          "CONFIRMATION_TEXT_REQUIRED",
          `请输入 ${confirmation.confirmationText} 后再确认。`,
          false
        );
      }
      const requestedSaveId = typeof payload.saveId === "string" ? payload.saveId.trim() : "";
      if (requestedSaveId && confirmation.saveId !== requestedSaveId) {
        return createFailure("SAVE_CONFIRMATION_MISMATCH", "当前冒险已变化，请重新确认。", false);
      }
      if (runtimeOperations.has("save-maintenance")) {
        return createFailure("SAVE_MAINTENANCE_BUSY", "当前冒险正在执行维护，请稍后重试。", true);
      }

      const operation = runtimeOperations.begin("save-maintenance");
      try {
        const quiescence = await quiesceAdventureWrites("new_game_restart_confirmed");
        if (!operation.isCurrent()) {
          return createFailure("REQUEST_ABORTED", "新游戏删档操作已取消。", false);
        }
        if (!quiescence.settled) {
          return createFailure("SAVE_DELETE_BUSY", "当前冒险仍有写入正在收尾，尚未删除。请稍后重新确认。", true);
        }

        saveMaintenanceConfirmations.delete(confirmationToken);
        const deleted = await executeSaveMaintenanceAction(confirmation);
        if (!deleted?.deleted) {
          return createFailure("NEW_GAME_RESTART_DELETE_FAILED", "删除当前冒险失败，请重新确认。", false);
        }

        if (activeSaveId === confirmation.saveId) {
          gameStarted = false;
          activeSaveId = null;
          activeSaveSummary = null;
          getLocaleCoordinator().leaveAdventure({ adventureId: confirmation.saveId });
        }

        return {
          ok: true,
          openNewGameSelection: true,
          saves: await listSaveSlots(),
          status: createStatus(),
          deletedSaveId: confirmation.saveId,
        };
      } finally {
        operation.finish();
      }
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.CONTINUE_GAME, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (runtimeOperations.has("save-maintenance")) {
      return createFailure("SAVE_MAINTENANCE_BUSY", "当前冒险正在执行维护，请稍后重试。", true);
    }
    const operation = runtimeOperations.begin("adventure-lifecycle");
    try {
      saveMaintenanceConfirmations.clear();
      const save = await loadSaveSlot(payload.saveId);
      if (!save) {
        return createFailure("SAVE_NOT_FOUND", "没有找到当前冒险。", false);
      }
      const compatibility = await getAdventureCompatibilityGate().inspect(save.id);

      assertSaveNotBusy(compatibility);
      if (compatibility.status === "closed") {
        const result = await openStoryArchivePayload(save, operation);
        if (!operation.isCurrent()) {
          return createFailure("REQUEST_ABORTED", "打开故事档案的操作已取消。", false);
        }
        return result;
      }
      if (compatibility.schemaKind !== "session" || !compatibility.playerContinuable) {
        return createFailure(
          compatibility.errorCode || "ADVENTURE_NOT_CONTINUABLE",
          "当前冒险结构不完整，不能继续。请保留存档并查看修复说明，或确认删除后开始新游戏。",
          false
        );
      }
      if (!keyVerified || !activeBridge) {
        return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
      }
      await getAdventureCompatibilityGate().openForPlayer(save.id);
      getLocaleCoordinator().enterAdventure({
        adventureId: save.id,
        adventureLocale: compatibility.adventureLocale,
      });
      const recoveryBridge = activeBridge;
      let recovered;
      try {
        await sessionDisposal;
        recovered = await recoveryBridge.recoverCurrentAdventure({ save_id: save.id, limit: 20 });
      } catch (error) {
        getLocaleCoordinator().leaveAdventure({ adventureId: save.id });
        throw error;
      }
      if (!operation.isCurrent() || recoveryBridge !== activeBridge) return { ok: false, stale: true };
      if (recovered.projection.save.compatibility?.status === "closed") {
        await recoveryBridge.close({ save_id: save.id });
        if (!operation.isCurrent() || recoveryBridge !== activeBridge) return { ok: false, stale: true };
        return await openStoryArchivePayload({ ...save, ...recovered.projection.save }, operation);
      }
      activeSaveId = save.id;
      activeSaveSummary = recovered.projection.save;
      sessionRecoveryRequired = false;
      gameStarted = true;
      return { ok: true, save: activeSaveSummary, projection: recovered.projection,
        history: recovered.history, historyComplete: recovered.historyComplete,
        historyNextBeforeRevision: recovered.historyNextBeforeRevision,
        lockedContent: recovered.locked_content, skillModules: recovered.modules || [], recovery: recovered.recovery,
        storyFinale: recovered.projection.storyFinale,
        ...(recovered.terminalAction ? { terminalAction: recovered.terminalAction } : {}),
        ...(recovered.pendingAction ? { pendingAction: recovered.pendingAction } : {}),
        contextUsage: bindSessionContextUsage(recovered.contextUsage), status: createStatus() };

    } catch (error) {
      return createFailureFromError(error);
    } finally {
      operation.finish();
    }
  });

  ipcMain.handle(CHANNELS.LIST_SKILL_MODULES, async (event) => {
    assertTrustedSender(event);
    if (!gameStarted || !activeSaveId || (!activeBridge && !canReadSessionArchive())) {
      return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
    }
    const binding = captureDesktopProjectionBinding();
    try {
      const opened = canReadSessionArchive() ? await getSessionArchiveReader().open({ adventureId: binding.adventureId,
        displayLocale: currentArchiveLocale() }) : null;
      const result = opened ? { ...opened.projection, modules: opened.modules }
        : await binding.bridge.listCurrentSkillModules({ save_id: binding.adventureId,
          revision: binding.revision });
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return { ok: true, ...sessionProjectionIdentity(result), modules: result.modules, status: createStatus() };
    } catch (error) {
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return { ...createFailureFromError(error), ...sessionProjectionIdentity(binding) };
    }
  });

  ipcMain.handle(CHANNELS.GET_SKILL_MODULE, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (!gameStarted || !activeSaveId || (!activeBridge && !canReadSessionArchive())) {
      return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
    }
    const binding = captureDesktopProjectionBinding();
    try {
      const result = canReadSessionArchive() ? await getSessionArchiveReader().readModule({
        adventureId: binding.adventureId, revision: binding.revision, displayLocale: currentArchiveLocale(),
        moduleRef: payload.moduleRef, fieldId: payload.fieldId, cursor: payload.cursor, limit: payload.limit,
      }) : await binding.bridge.getCurrentSkillModule({
        save_id: binding.adventureId,
        revision: binding.revision,
        module_ref: payload.moduleRef,
        field_id: payload.fieldId,
        cursor: payload.cursor,
        limit: payload.limit,
      });
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return { ok: true, ...sessionProjectionIdentity(result), module: result.module,
        ...(result.sources ? { sources: result.sources, resolutionSources: result.resolutionSources } : {}), status: createStatus() };
    } catch (error) {
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return { ...createFailureFromError(error), ...sessionProjectionIdentity(binding) };
    }
  });

  ipcMain.handle(CHANNELS.LIST_SKILL_PANELS, async (event) => {
    assertTrustedSender(event);
    if (!gameStarted || !activeSaveId || (!activeBridge && !canReadSessionArchive())) {
      return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
    }
    const binding = captureDesktopProjectionBinding();
    try {
      const result = canReadSessionArchive()
        ? (await getSessionArchiveReader().open({ adventureId: binding.adventureId, displayLocale: currentArchiveLocale() })).projection.panels
        : await binding.bridge.listCurrentSkillPanels({ save_id: binding.adventureId,
          revision: binding.revision });
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return {
        ok: true,
        ...sessionProjectionIdentity(result),
        supported: result.supported,
        schemaVersion: result.schemaVersion,
        panels: result.panels,
        status: createStatus(),
      };
    } catch (error) {
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return { ...createFailureFromError(error), ...sessionProjectionIdentity(binding) };
    }
  });

  ipcMain.handle(CHANNELS.GET_CHARACTER_PANEL_ENTRY, async (event) => {
    assertTrustedSender(event);
    if (!gameStarted || !activeSaveId || (!activeBridge && !canReadSessionArchive())) {
      return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
    }
    const binding = captureDesktopProjectionBinding();
    try {
      const result = canReadSessionArchive()
        ? (await getSessionArchiveReader().open({ adventureId: binding.adventureId, displayLocale: currentArchiveLocale() })).projection.characterPanel
        : await binding.bridge.getCurrentCharacterPanelEntry({ save_id: binding.adventureId,
          revision: binding.revision });
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return {
        ok: true,
        ...sessionProjectionIdentity(result),
        supported: result.supported,
        panel: result.panel,
        status: createStatus(),
      };
    } catch (error) {
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return { ...createFailureFromError(error), ...sessionProjectionIdentity(binding) };
    }
  });

  ipcMain.handle(CHANNELS.GET_SKILL_PANEL, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (!gameStarted || !activeSaveId || (!activeBridge && !canReadSessionArchive())) {
      return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
    }
    const binding = captureDesktopProjectionBinding();
    try {
      const result = canReadSessionArchive() ? await getSessionArchiveReader().readPanel({
        adventureId: binding.adventureId, revision: binding.revision, displayLocale: currentArchiveLocale(),
        panelRef: payload.panelRef, view: payload.view, fieldId: payload.fieldId,
        itemRef: payload.itemRef, cursor: payload.cursor, limit: payload.limit,
      }) : await binding.bridge.getCurrentSkillPanel({
        save_id: binding.adventureId,
        revision: binding.revision,
        panel_ref: payload.panelRef,
        view: payload.view,
        field_id: payload.fieldId,
        item_ref: payload.itemRef,
        cursor: payload.cursor,
        limit: payload.limit,
      });
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return {
        ok: true,
        ...sessionProjectionIdentity(result),
        supported: result.supported,
        panel: result.panel,
        ...(result.sources ? { sources: result.sources, resolutionSources: result.resolutionSources } : {}),
        status: createStatus(),
      };
    } catch (error) {
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return { ...createFailureFromError(error), ...sessionProjectionIdentity(binding) };
    }
  });

  ipcMain.handle(CHANNELS.REQUEST_SAVE_MAINTENANCE, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const action = normalizeSaveMaintenanceAction(payload.action);
      const requestedSaveId = typeof payload.saveId === "string" ? payload.saveId.trim() : "";
      const deletionId = typeof payload.deletionId === "string" ? payload.deletionId.trim() : "";

      if (action === "clear") {
        if (deletionId) {
          const pending = (await getSaveSlotStore().listPendingDeletes()).find(item => item.deletionId === deletionId);
          if (!pending) return createFailure("SAVE_DELETE_PENDING_NOT_FOUND", "待清理的删除残留已不存在。", false);
          const confirmation = issueSaveMaintenanceConfirmation({ action, saveId: pending.saveId, deletionId: pending.deletionId,
            save: { id: pending.saveId, title: "待清理的删除残留" }, inspection: {}, scope: "delete_pending" });
          return { ok: true, confirmation, pendingDelete: { deletionId: pending.deletionId, saveId: pending.saveId, state: "delete_pending" }, status: createStatus() };
        }
        const save = await resolveExistingSaveForNewGameRestart(requestedSaveId);
        if (!save) {
          return createFailure("SAVE_NOT_FOUND", "没有找到可删除的当前冒险。", false);
        }
        const compatibility = await getAdventureCompatibilityGate().inspect(save.id);
        const confirmation = issueSaveMaintenanceConfirmation({
          action,
          saveId: save.id,
          save,
          inspection: compatibility,
          scope: "active_adventure",
        });
        return {
          ok: true,
          confirmation,
          inspection: projectSaveMaintenanceInspection(compatibility),
          status: createStatus(),
        };
      }
      if (!keyVerified || !activeBridge) {
        return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
      }
      if (!gameStarted || !activeSaveId) {
        return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
      }
      const save = activeSaveSummary || await loadSaveSlot(activeSaveId);
      const inspection = await activeBridge.inspectCurrentSave({ save_id: activeSaveId });
      const confirmation = issueSaveMaintenanceConfirmation({
        action,
        saveId: activeSaveId,
        save,
        inspection,
      });
      return {
        ok: true,
        confirmation,
        inspection: projectSaveMaintenanceInspection(inspection),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.CONFIRM_SAVE_MAINTENANCE, async (event, payload = {}) => {
    assertTrustedSender(event);

    try {
      const confirmationToken = normalizeConfirmationToken(payload.confirmationToken);
      const confirmation = getSaveMaintenanceConfirmation(confirmationToken);
      if (!confirmation) {
        return createFailure("INVALID_CONFIRMATION_TOKEN", "维护操作确认已失效，请重新发起。", false);
      }
      const localDelete = confirmation.action === "clear";

      if (!localDelete && (!keyVerified || !activeBridge)) {
        return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
      }
      if (!localDelete && (!gameStarted || !activeSaveId || confirmation.saveId !== activeSaveId)) {
        return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
      }

      if (confirmation.requiresText && String(payload.confirmationText || "").trim() !== confirmation.confirmationText) {
        return createFailure(
          "CONFIRMATION_TEXT_REQUIRED",
          `请输入 ${confirmation.confirmationText} 后再确认。`,
          false,
          { phrase: confirmation.confirmationText }
        );
      }
      if (runtimeOperations.has("save-maintenance")) {
        return createFailure("SAVE_MAINTENANCE_BUSY", "当前冒险正在执行维护，请稍后重试。", true);
      }

      const operation = runtimeOperations.begin("save-maintenance");
      try {
        const quiescence = confirmation.scope === "delete_pending" ? { settled: true } : await quiesceAdventureWrites("save_maintenance_confirmed");
        if (!operation.isCurrent()) {
          return createFailure("REQUEST_ABORTED", "维护操作已取消。", false);
        }
        if (!quiescence.settled) {
          return createFailure("SAVE_DELETE_BUSY", "当前冒险仍有写入正在收尾，尚未执行维护。请稍后重新确认。", true);
        }

        saveMaintenanceConfirmations.delete(confirmationToken);
        const result = await executeSaveMaintenanceAction(confirmation);
        if (!operation.isCurrent()) {
          return createFailure("REQUEST_ABORTED", "维护操作已取消。", false);
        }

        if (confirmation.action === "clear" && confirmation.scope !== "delete_pending" && (result?.deleted || result?.errorCode === "SAVE_DELETE_PENDING") && activeSaveId === confirmation.saveId) {
          gameStarted = false;
          activeSaveId = null;
          activeSaveSummary = null;
          getLocaleCoordinator().leaveAdventure({ adventureId: confirmation.saveId });
        } else if (activeSaveId) {
          activeSaveSummary = await loadSaveSlot(activeSaveId);
        }
        if (result?.errorCode === "SAVE_DELETE_PENDING") {
          return { ...createFailure("SAVE_DELETE_PENDING", "部分文件暂时无法清理，可在存档列表重试。", true),
            pendingDeletes: await getSaveSlotStore().listPendingDeletes() };
        }
        return {
          ok: true,
          action: confirmation.action,
          result: projectSaveMaintenanceResult(confirmation.action, result),
          save: activeSaveSummary,
          saves: await listSaveSlots(),
          status: createStatus(),
        };
      } finally {
        operation.finish();
      }
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.READ_CONTEXT_COMPACTION, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (!isDesktopProjectionRequestCurrent(payload)) return { ok: false, stale: true };
    return compactSessionContext(payload, { readOnly: true });
  });

  ipcMain.handle(CHANNELS.REQUEST_CONTEXT_COMPACTION, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (!isDesktopProjectionRequestCurrent(payload)) return { ok: false, stale: true };
    return compactSessionContext(payload);

  });

  ipcMain.handle(CHANNELS.REQUEST_MANUAL_SAVE, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (!isDesktopProjectionRequestCurrent(payload)) return { ok: false, stale: true };
    if (runtimeOperations.has("save-maintenance")) {
      return createFailure("SAVE_MAINTENANCE_BUSY", "当前冒险正在执行维护，请稍后重试。", true);
    }
    if (!keyVerified || !activeBridge) {
      return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
    }
    if (!gameStarted || !activeSaveId) {
      return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
    }
    if (activeSaveSummary?.compatibility?.status === "closed") {
      return createFailure("ADVENTURE_ARCHIVED", "故事已经封存，只能查看，不能再次保存。", false);
    }
    return saveSessionChapter();

  });

  ipcMain.handle(CHANNELS.RESUME_SESSION_FINALE, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (!isDesktopProjectionRequestCurrent(payload)) return { ok: false, stale: true };
    if (!keyVerified || !activeBridge || !gameStarted) return createFailure("PROVIDER_NOT_READY", "请先恢复当前冒险和模型连接。", false);
    if (runtimeOperations.has("manual-save") || runtimeOperations.has("run-turn") || runtimeOperations.has("turn-derived") || runtimeOperations.has("save-maintenance")) {
      return createFailure("ADVENTURE_BUSY", "上一项操作仍在处理。", true);
    }
    const binding = captureDesktopProjectionBinding();
    const operation = runtimeOperations.begin("manual-save");
    try {
      const result = await binding.bridge.resumeFinalization({ save_id: binding.adventureId, revision: binding.revision },
        { signal: operation.signal });
      if (!operation.isCurrent() || !isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      if (!result.projection) return { ...bindSessionContextResult(result), save: activeSaveSummary, status: createStatus() };
      const expectedRevision = result.terminalAction && result.actionResult?.status === "committed"
        ? binding.revision + 1 : binding.revision;
      if (result.projection.adventureId !== binding.adventureId || result.projection.revision !== expectedRevision) {
        return createFailure("TERMINAL_IDENTITY_MISMATCH", "恢复结果与当前冒险不一致，请重新打开冒险。", true);
      }
      activeSaveSummary = result.projection.save;
      const completedBinding = { ...binding, revision: expectedRevision };
      if (activeSaveSummary.compatibility?.status === "closed") await binding.bridge.close({ save_id: binding.adventureId });
      if (!operation.isCurrent() || !isDesktopProjectionBindingCurrent(completedBinding)) return { ok: false, stale: true };
      return { ...bindSessionContextResult(result),
        derivedWork: issueTurnDerivedTicket(result.derivedWork, result.actionResult, completedBinding),
        save: activeSaveSummary, status: createStatus() };
    } catch (error) {
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return createFailureFromError(error);
    } finally { operation.finish(); }
  });

  ipcMain.handle(CHANNELS.GET_CHAPTER_LOGS, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (!isDesktopProjectionRequestCurrent(payload)) return { ok: false, stale: true };
    if ((!keyVerified || !activeBridge) && !canReadSessionArchive()) {
      return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
    }
    if (!gameStarted || !activeSaveId) {
      return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
    }

    const binding = captureDesktopProjectionBinding();
    try {
      const request = { revision: binding.revision, ...(payload.cursor === undefined ? {} : { cursor: payload.cursor }),
        ...(payload.limit === undefined ? { limit: 12 } : { limit: payload.limit }) };
      const page = canReadSessionArchive() ? await getSessionArchiveReader().readChapters({ adventureId: binding.adventureId, ...request }) : null;
      const chapterPage = page ? { ok: true, adventureId: binding.adventureId, revision: binding.revision, result: page }
        : await binding.bridge.readChapterLogs({ save_id: binding.adventureId, ...request });
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return { ...chapterPage, status: createStatus() };

    } catch (error) {
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.GET_DEBUG_TRACE, async (event) => {
    assertTrustedSender(event);
    if (!loadDesktopSettings().developer?.debugPanelEnabled) {
      return createFailure("DEBUG_PANEL_DISABLED", "开发者调试面板尚未启用。", false);
    }
    if (!keyVerified || !activeBridge) {
      return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
    }
    if (!gameStarted || !activeSaveId) {
      return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
    }

    const binding = captureDesktopProjectionBinding();
    try {
      const bridgeResult = await binding.bridge.loadDebugTrace({
        save_id: binding.adventureId, limit: DEBUG_TRACE_EXPORT_RECENT_LIMIT,
      });
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      const result = projectDebugTraceResult(bridgeResult);
      return {
        ok: true,
        result,
        export: createDebugTraceExport(result),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.SYNTHESIZE_TTS, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const text = normalizeTtsText(payload.text);
      if (!text) {
        return createFailure("INVALID_TTS_INPUT", "没有可朗读文本。", false);
      }
      const result = await getTtsService().synthesize({
        text,
        settings: loadDesktopSettings(),
      });
      return {
        ok: true,
        result: projectTtsResult(result),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.START_TTS_UTTERANCE, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const text = normalizeTtsText(payload.text);
      if (!text) {
        return createFailure("INVALID_TTS_INPUT", "没有可朗读文本。", false);
      }
      const result = await getTtsService().startUtterance({
        text,
        settings: loadDesktopSettings(),
      });
      return {
        ok: true,
        result: projectTtsResult(result),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.CONTINUE_TTS_UTTERANCE, async (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      const result = await getTtsService().continueUtterance({
        utteranceId: payload.utteranceId,
      });
      return {
        ok: true,
        result: projectTtsResult(result),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.CANCEL_TTS_UTTERANCE, (event, payload = {}) => {
    assertTrustedSender(event);
    try {
      return getTtsService().cancelUtterance({ utteranceId: payload.utteranceId });
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.GET_TTS_CACHE_STATUS, (event) => {
    assertTrustedSender(event);
    try {
      return {
        ok: true,
        result: projectTtsCacheStatus(getTtsService().getCacheStatus(loadDesktopSettings())),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.CLEAR_TTS_CACHE, async (event) => {
    assertTrustedSender(event);
    try {
      await disposeTtsService();
      fs.rmSync(getTtsCacheRoot(), { recursive: true, force: true });
      return {
        ok: true,
        result: projectTtsCacheStatus(getTtsService().getCacheStatus(loadDesktopSettings())),
        status: createStatus(),
      };
    } catch (error) {
      return createFailureFromError(error);
    }
  });

  ipcMain.handle(CHANNELS.RUN_TURN, async (event, payload = {}) => {
    assertTrustedSender(event);
    if (runtimeOperations.has("save-maintenance")) {
      return createFailure("SAVE_MAINTENANCE_BUSY", "当前冒险正在执行维护，请稍后重试。", true);
    }
    if (!keyVerified || !activeBridge) {
      return createFailure("PROVIDER_NOT_READY", "请先在设置中完成模型连接测试。", false);
    }
    if (!gameStarted || !activeSaveId) {
      return createFailure("GAME_NOT_STARTED", "请先开始新游戏或继续当前冒险。", false);
    }
    if (activeSaveSummary?.compatibility?.status === "closed") {
      return createFailure("ADVENTURE_ARCHIVED", "故事已经封存，只能查看，不能再提交新的行动。", false);
    }

    const text = normalizePlayerText(payload.text);
    if (!text) {
      return createFailure("INVALID_TURN_INPUT", "请输入行动或回应。", false);
    }

    return runSessionDesktopTurn(payload, text);

  });

  ipcMain.handle(CHANNELS.CANCEL_TURN, (event, payload = {}) => {
    assertTrustedSender(event);
    const turn = activePlayerTurn;
    if (!turn || turn.bridge !== activeBridge || turn.sessionId !== desktopSessionGeneration
      || turn.adventureId !== activeSaveId || payload.sessionId !== turn.sessionId
      || payload.adventureId !== turn.adventureId || payload.actionId !== turn.actionId
      || payload.baseRevision !== turn.baseRevision || payload.invocationId !== turn.invocationId) {
      return createFailure("ACTION_NOT_RUNNING", "当前行动已经结束或会话已变化。", false);
    }
    // Keep the original runTurn delivery alive. Its durable receipt, not this
    // acknowledgement, decides whether cancellation or commit won the race.
    turn.controller.abort();
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.RESET_SESSION, (event) => {
    assertTrustedSender(event);
    resetRuntimeSession("manual_reset");
    return {
      ok: true,
      status: createStatus(),
    };
  });

  ipcMain.handle(CHANNELS.COMPLETE_TURN_DERIVED, async (event, payload = {}) => {
    assertTrustedSender(event);
    return completeSessionTurnDerived(payload);
  });

  ipcMain.handle(CHANNELS.READ_SESSION_HISTORY, async (event, payload = {}) => {
    assertTrustedSender(event);
    if ((!activeBridge && !canReadSessionArchive()) || !activeSaveId || payload.adventureId !== activeSaveId
      || payload.sessionId !== desktopSessionGeneration) return createFailure("ACTION_INPUT_INVALID", "当前冒险已变化。", false);
    const bridge = activeBridge;
    const saveId = activeSaveId;
    const generation = desktopSessionGeneration;
    try {
      const request = { revision: payload.revision, beforeRevision: payload.beforeRevision,
        limit: payload.limit, maxCharacters: payload.maxCharacters };
      const page = canReadSessionArchive() ? await getSessionArchiveReader().readHistory({ adventureId: saveId, ...request })
        : await bridge.readHistory({ save_id: saveId, ...request });
      if (bridge !== activeBridge || saveId !== activeSaveId || generation !== desktopSessionGeneration) return { ok: false, stale: true };
      return { ok: true, ...page };
    } catch (error) { return createFailureFromError(error); }
  });

  ipcMain.handle(CHANNELS.LEAVE_ADVENTURE, async (event) => {
    assertTrustedSender(event);
    await speechInput?.cancel();
    const leavingAdventureId = activeSaveId;
    const close = (activeBridge) && leavingAdventureId ? activeBridge.close({ save_id: leavingAdventureId }) : null;
    desktopSessionGeneration = crypto.randomBytes(8).toString("hex");
    runtimeOperations.abort("run-turn", "leave_adventure");
    runtimeOperations.abort("turn-derived", "leave_adventure");
    turnDerivedTickets.clear();
    gameStarted = false;
    activeSaveId = null;
    activeSaveSummary = null;
    sessionRecoveryRequired = false;
    if (leavingAdventureId) {
      getLocaleCoordinator().leaveAdventure({ adventureId: leavingAdventureId });
    }
    if (close) await close;
    return { ok: true, status: createStatus() };
  });
}

async function validateActiveContextSettings(previous, next) {
  const contextChanged = (sessionContextSettingsIdentity(previous) !== sessionContextSettingsIdentity(next));
  if (!contextChanged || !activeBridge || !gameStarted || !activeSaveId) {
    return { ok: true };
  }
  if (activeSaveSummary?.compatibility?.status === "closed") return { ok: true };
  const binding = captureDesktopProjectionBinding();
  const options = sessionContextOptions(next);
  const preview = await binding.bridge.readContextUsage({ save_id: binding.adventureId, revision: binding.revision,
    contextPolicy: options.contextPolicy, narrationPreferences: options.narrationPreferences });
  if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, errorCode: "CONTEXT_SETTINGS_STALE" };
  // Preview uses the proposed window and its own bounded recent context.
  // The old window's meter cannot decide whether this new configuration fits.
  return { ok: preview?.fits === true && preview.settingsIdentity === sessionContextSettingsIdentity(next)
    && preview.adventureId === binding.adventureId
    && preview.revision === binding.revision, errorCode: "CONTEXT_SETTINGS_TOO_SMALL" };
}

function captureDesktopProjectionBinding() {
  return { bridge: activeBridge, adventureId: activeSaveId,
    generation: desktopSessionGeneration, revision: activeSaveSummary?.revision };
}

function isDesktopProjectionRequestCurrent(request) {
  return request !== null && typeof request === "object"
    && typeof request.adventureId === "string" && request.adventureId === activeSaveId
    && request.sessionId === desktopSessionGeneration
    && Number.isSafeInteger(request.revision) && request.revision >= 0
    && request.revision === activeSaveSummary?.revision;
}

async function saveSessionChapter() {
  if (runtimeOperations.has("manual-save") || runtimeOperations.has("run-turn") || runtimeOperations.has("turn-derived")) {
    return createFailure("ADVENTURE_BUSY", "上一项操作仍在处理。", true);
  }
  const binding = captureDesktopProjectionBinding();
  const operation = runtimeOperations.begin("manual-save");
  try {
    await sessionDisposal;
    if (!operation.isCurrent() || !isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
    const result = await binding.bridge.commitCurrentSave({ save_id: binding.adventureId, revision: binding.revision },
      { retry: true, signal: operation.signal });
    if (!operation.isCurrent() || !isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
    return { ...result, save: activeSaveSummary, status: createStatus() };
  } catch (error) {
    if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
    return createFailureFromError(error);
  } finally { operation.finish(); }
}

function isDesktopProjectionBindingCurrent(binding) {
  return (binding.bridge === activeBridge && binding.adventureId === activeSaveId
    && binding.generation === desktopSessionGeneration && binding.revision === activeSaveSummary?.revision);
}

function sessionProjectionIdentity(result) {
  return ({ adventureId: result.adventureId, revision: result.revision, actionId: result.actionId });
}

function bindSessionContextUsage(value) {
  if (!value || typeof value !== "object") return null;
  if (value.adventureId === activeSaveId && value.revision === activeSaveSummary?.revision
    && Number.isSafeInteger(value.contextGeneration) && value.contextGeneration >= 0) {
    const prior = currentDesktopContext();
    if (prior && value.contextGeneration < prior.contextGeneration) return null;
    desktopContextBinding = { sessionId: desktopSessionGeneration, adventureId: activeSaveId,
      contextGeneration: value.contextGeneration, available: value.compactionAvailable === true };
  }
  return { ...value, sessionId: desktopSessionGeneration };
}

function currentDesktopContext() {
  return desktopContextBinding?.sessionId === desktopSessionGeneration && desktopContextBinding?.adventureId === activeSaveId
    ? desktopContextBinding : null;
}

function adoptCompactionGeneration(receipt) {
  if (receipt?.status !== "reduced" || !Number.isSafeInteger(receipt.contextGeneration) || receipt.contextGeneration < 1) return;
  const current = currentDesktopContext();
  if (current && receipt.contextGeneration <= current.contextGeneration) return;
  // A durable summary receipt is enough to invalidate an older estimate. It is
  // not enough to invent a fresh estimate when the subsequent read has failed.
  desktopContextBinding = { sessionId: desktopSessionGeneration, adventureId: activeSaveId,
    contextGeneration: receipt.contextGeneration, available: true };
}

async function compactSessionContext(payload, { readOnly = false } = {}) {
  if (typeof payload.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(payload.requestId)
    || (payload.input !== undefined && (typeof payload.input !== "string" || payload.input.length > 12000))
    || (payload.retry !== undefined && typeof payload.retry !== "boolean")) return createFailure("COMPACTION_INPUT_INVALID", "整理请求已失效。", false);
  if (!activeBridge || !gameStarted || !activeSaveId || (!readOnly && !keyVerified)) return createFailure("PROVIDER_NOT_READY", "请先打开冒险并完成模型连接测试。", false);
  if (!readOnly && (runtimeOperations.has("run-turn") || runtimeOperations.has("context-compaction")
    || runtimeOperations.has("manual-save") || runtimeOperations.has("turn-derived") || runtimeOperations.has("save-maintenance"))) return createFailure("ADVENTURE_BUSY", "上一项操作仍在处理。", true);
  const binding = captureDesktopProjectionBinding();
  const operation = readOnly ? null : runtimeOperations.begin("context-compaction");
  try {
    await sessionDisposal;
    if (!isDesktopProjectionBindingCurrent(binding) || (operation && !operation.isCurrent())) return { ok: false, stale: true };
    const request = { save_id: binding.adventureId, revision: binding.revision, requestId: payload.requestId,
      ...(payload.input === undefined ? {} : { input: payload.input }) };
    const result = readOnly ? await binding.bridge.readContextCompaction(request)
      : await binding.bridge.compactCurrentContext(request, { retry: payload.retry === true, signal: operation.signal });
    if (!isDesktopProjectionBindingCurrent(binding) || (operation && !operation.isCurrent())) return { ok: false, stale: true };
    const bound = bindSessionContextResult(result);
    return { ...bound, status: createStatus() };
  } catch (error) {
    if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
    return { ...createFailureFromError(error), status: createStatus() };
  } finally { operation?.finish(); }
}

function bindSessionContextResult(result) {
  adoptCompactionGeneration(result.compaction ?? result.actionResult?.compaction ?? result.envelope?.actionResult?.compaction);
  const contextUsage = bindSessionContextUsage(result.contextUsage ?? result.envelope?.contextUsage ?? result.projection?.contextUsage);
  return { ...result, contextUsage,
    ...(result.envelope ? { envelope: { ...result.envelope, contextUsage } } : {}) };
}

async function runSessionDesktopTurn(payload, text) {
  if (typeof payload.actionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(payload.actionId)
    || (payload.invocationId !== undefined && (typeof payload.invocationId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(payload.invocationId)))
    || !Number.isSafeInteger(payload.baseRevision) || payload.baseRevision < 0
    || payload.sessionId !== desktopSessionGeneration || payload.adventureId !== activeSaveId) {
    return createFailure("ACTION_INPUT_INVALID", "行动对应的冒险或会话已变化，请恢复当前冒险后重试。", false);
  }
  if (runtimeOperations.has("run-turn") || runtimeOperations.has("context-compaction")) return createFailure("ADVENTURE_BUSY", "上一项操作仍在处理。", true);
  const bridge = activeBridge;
  const adventureId = activeSaveId;
  const generation = desktopSessionGeneration;
  const operation = runtimeOperations.begin("run-turn");
  const turn = { bridge, adventureId, sessionId: generation, actionId: payload.actionId,
    baseRevision: payload.baseRevision, invocationId: payload.invocationId ?? crypto.randomUUID(), controller: new AbortController() };
  activePlayerTurn = turn;
  try {
    await sessionDisposal;
    if (bridge !== activeBridge || generation !== desktopSessionGeneration || adventureId !== activeSaveId) {
      return { ok: false, stale: true };
    }
    let delivered = await bridge.runTurn({ save_id: adventureId, actionId: payload.actionId,
      baseRevision: payload.baseRevision, text, session_id: createSessionId(adventureId) },
    { retry: payload.retry === true, signal: AbortSignal.any([operation.signal, turn.controller.signal]) });
    if (!delivered.projection && delivered.actionResult?.status === "committed"
      && Number.isSafeInteger(delivered.actionResult.revision)) {
      try {
        const recovered = await bridge.readView({ save_id: adventureId, revision: delivered.actionResult.revision });
        delivered = { ...delivered, ...recovered.envelope, contextUsage: delivered.contextUsage ?? recovered.envelope.contextUsage,
          projection: recovered, actionResult: delivered.actionResult };
      } catch { /* The durable receipt remains available; never rerun to recover a display. */ }
    }
    const { projection, actionResult, derivedWork, ...envelope } = delivered;
    const { view: ignoredView, ...receipt } = actionResult || {};
    if (bridge !== activeBridge || generation !== desktopSessionGeneration || adventureId !== activeSaveId) {
      return { ok: false, stale: true, actionResult: receipt };
    }
    const currentRevision = activeSaveSummary?.revision;
    const deliveredRevision = projection?.revision ?? (receipt.status === "committed" ? receipt.revision : undefined);
    if (Number.isSafeInteger(currentRevision) && Number.isSafeInteger(deliveredRevision)
      && (deliveredRevision < currentRevision || (deliveredRevision === currentRevision
        && activeSaveSummary.compatibility?.status === "closed" && projection?.save?.compatibility?.status !== "closed"))) {
      // The store may return an older action's exact receipt. Consume that
      // outcome without replacing today's view or undoing same-version sealing.
      // Do not mark the whole result stale: Renderer must still settle pending
      // input on commit, or restore it with the original failure/retry details.
      return { ok: receipt.status === "committed", actionResult: receipt,
        ...(receipt.status !== "committed" && (envelope.error || receipt.error)
          ? { error: envelope.error || receipt.error } : {}),
        projection: null, derivedWork: null, skillModulesRefreshRequired: false,
        save: activeSaveSummary, status: createStatus() };
    }
    if (projection) activeSaveSummary = projection.save;
    if (projection?.save.compatibility?.status === "closed") await bridge.close({ save_id: adventureId });
    if (bridge !== activeBridge || generation !== desktopSessionGeneration || adventureId !== activeSaveId) return { ok: false, stale: true };
    adoptCompactionGeneration(receipt.compaction);
    const contextUsage = bindSessionContextUsage(envelope.contextUsage);
    return { ok: !envelope.error, envelope: { ...envelope, contextUsage }, contextUsage,
      projection, actionResult: receipt, storyFinale: projection?.storyFinale,
      derivedWork: projection ? issueTurnDerivedTicket(derivedWork, receipt,
        { bridge, adventureId, generation, revision: projection.revision }) : null,
      skillModulesRefreshRequired: Boolean(projection && receipt.status === "committed"),
      save: activeSaveSummary, status: createStatus() };
  } catch (error) {
    if (bridge !== activeBridge || generation !== desktopSessionGeneration || adventureId !== activeSaveId) {
      return { ok: false, stale: true };
    }
    return createFailureFromError(error);
  } finally {
    if (activePlayerTurn === turn) activePlayerTurn = null;
    operation.finish();
  }
}

function issueTurnDerivedTicket(work, receipt, binding) {
  if (!work || receipt?.status !== "committed" || !(receipt.generationPasses > 0)
    || !["chapter", "finale"].includes(work.kind) || work.actionId !== receipt.actionId
    || work.revision !== receipt.revision || work.revision !== binding.revision
    || !isDesktopProjectionBindingCurrent(binding)) return null;
  // Only a fresh committed delivery may authorize this separate stage. Tickets
  // are ephemeral: reopening a save only reads its existing durable jobs.
  for (const [id, entry] of turnDerivedTickets) {
    if (entry.binding.bridge !== activeBridge || entry.binding.generation !== desktopSessionGeneration
      || entry.binding.adventureId !== activeSaveId) turnDerivedTickets.delete(id);
  }
  while (turnDerivedTickets.size >= 32) turnDerivedTickets.delete(turnDerivedTickets.keys().next().value);
  const ticketId = crypto.randomUUID();
  const ticket = { ticketId, adventureId: binding.adventureId, sessionId: binding.generation,
    actionId: work.actionId, revision: work.revision, kind: work.kind };
  turnDerivedTickets.set(ticketId, { ticket, binding: { ...binding }, work: { ...work } });
  return ticket;
}

async function completeSessionTurnDerived(payload) {
  const entry = payload && typeof payload.ticketId === "string" ? turnDerivedTickets.get(payload.ticketId) : null;
  if (!entry || Object.keys(entry.ticket).some((key) => payload[key] !== entry.ticket[key])) {
    return { ok: false, stale: true, autoSpeak: false };
  }
  // Claim before waiting. Duplicate IPC, repeated action receipts and late UI
  // confirmations cannot start a second job or regenerate committed narration.
  turnDerivedTickets.delete(payload.ticketId);
  const { binding, work, ticket } = entry;
  const currentSession = () => binding.bridge === activeBridge && binding.generation === desktopSessionGeneration
    && binding.adventureId === activeSaveId && gameStarted;
  if (!currentSession() || !keyVerified || !Number.isSafeInteger(activeSaveSummary?.revision)
    || binding.revision > activeSaveSummary.revision) return { ok: false, stale: true, autoSpeak: false };
  if (runtimeOperations.has("manual-save") || runtimeOperations.has("context-compaction")
    || runtimeOperations.has("save-maintenance")) return { ...createFailure("ADVENTURE_BUSY", "章节处理尚未开始，可稍后保存或恢复。", true),
      ...ticket, autoSpeak: false };

  // Serialize derived jobs with one lifecycle-owned operation. Story actions
  // remain independent; chapter sources are fixed at each committed revision.
  let queue = turnDerivedQueue;
  if (!queue || !queue.operation.isCurrent() || queue.bridge !== binding.bridge
    || queue.generation !== binding.generation || queue.adventureId !== binding.adventureId) {
    queue = { bridge: binding.bridge, generation: binding.generation, adventureId: binding.adventureId,
      operation: runtimeOperations.begin("turn-derived"), tail: Promise.resolve(), pending: 0 };
    turnDerivedQueue = queue;
  }
  queue.pending += 1;
  const task = queue.tail.then(async () => {
    if (!queue.operation.isCurrent() || !currentSession()) return { ok: false, stale: true, autoSpeak: false };
    try {
      const result = await binding.bridge.completeTurnDerived({ save_id: binding.adventureId, ...work },
        { signal: queue.operation.signal });
      const identity = { adventureId: ticket.adventureId, sessionId: ticket.sessionId,
        actionId: ticket.actionId, revision: ticket.revision, kind: ticket.kind, autoSpeak: false };
      if (!queue.operation.isCurrent() || !currentSession()) return { ...identity, ok: false, stale: true };
      if (result.adventureId !== binding.adventureId || result.actionId !== work.actionId
        || result.revision !== binding.revision || result.kind !== work.kind) {
        return { ...identity, ...createFailure("DERIVED_IDENTITY_MISMATCH", "章节结果与已提交的故事不一致，请重新打开冒险查看。", true) };
      }
      // A completed older chapter can be retained in storage while a newer
      // story is visible. Never return an old save/status to overwrite its HUD.
      if (!isDesktopProjectionBindingCurrent(binding)) {
        return { ...result, ...identity, ok: true, stale: true, projection: null, storyFinale: null };
      }
      if (result.projection) {
        if (result.projection.adventureId !== binding.adventureId || result.projection.revision !== binding.revision
          || result.projection.save?.revision !== binding.revision) {
          return { ...identity, ...createFailure("DERIVED_IDENTITY_MISMATCH", "章节结果与当前冒险不一致，请重新打开冒险查看。", true) };
        }
        activeSaveSummary = result.projection.save;
        if (activeSaveSummary.compatibility?.status === "closed") await binding.bridge.close({ save_id: binding.adventureId });
      }
      if (!queue.operation.isCurrent() || !isDesktopProjectionBindingCurrent(binding)) return { ...identity, ok: false, stale: true };
      return { ...result, ...identity, ok: true, save: activeSaveSummary, status: createStatus() };
    } catch (error) {
      if (!queue.operation.isCurrent() || !currentSession()) return { ok: false, stale: true, autoSpeak: false };
      return { ...createFailureFromError(error), ...ticket, autoSpeak: false };
    }
  });
  // All task failures are converted above. Keep the queue usable even if an
  // unexpected presentation error occurs; quiescence still waits for its tail.
  queue.tail = task.catch(() => undefined);
  try { return await task; }
  finally {
    queue.pending -= 1;
    if (queue.pending === 0) {
      queue.operation.finish();
      if (turnDerivedQueue === queue) turnDerivedQueue = null;
    }
  }
}

function sessionContextOptions(settings) {
  // DeepSeek's reported completion budget includes reasoning. A real ordinary
  // action exhausted 4096 before its state/experience bundle was complete.
  // Reserve the same bounded cap in both generation and context accounting.
  return { narrationPreferences: settings.narration, maxOutputTokens: settings.api?.provider === "deepseek" ? 8192 : 4096,
    contextPolicy: { configuredContextWindow: settings.agent?.context?.configuredContextWindow,
      providerContextLimit: getProviderModelProfile(settings)?.contextLimit,
      autoCompactRatio: settings.agent?.context?.autoCompactRatio } };
}

function sessionContextSettingsIdentity(settings) {
  const { normalizeSessionContextOptions } = require(path.join(RUNTIME_ROOT, "engine/session/session-context"));
  return normalizeSessionContextOptions(sessionContextOptions(settings)).settingsIdentity;
}

function createBridge(apiKey, dataRoot = getDataRoot(), settings = loadDesktopSettings()) {
  ensureDesktopAppData();
  fs.mkdirSync(dataRoot, { recursive: true });
  const layout = getAppDataLayout();
  desktopSessionGeneration = crypto.randomBytes(8).toString("hex");
  const { createSessionDesktopBridge } = require(path.join(RUNTIME_ROOT, "engine/bridge/session-desktop-bridge"));
  return createSessionDesktopBridge({
    adventuresRoot: layout.savesRoot,
    provider: createProviderForSettings(settings, apiKey),
    saveSettings: settings.save,
    displayLocale: ({ adventureId, adventureLocale }) => {
      const locale = getLocaleCoordinator(settings.localization?.preferredLocale || null).snapshot();
      return locale.activeAdventureId === adventureId ? (locale.effectiveLocale || adventureLocale) : adventureLocale;
    },
    sessionOptions: { maxModelCalls: 8, maxToolCalls: 8, ...sessionContextOptions(settings) },
  });
}

function createProviderForSettings(settings, apiKey, timeoutMs = MODEL_REQUEST_TIMEOUT_MS) {
  return PROVIDER_REGISTRY.create(createProviderConfig(settings, apiKey, timeoutMs));
}

function createProviderConfig(settings, apiKey, timeoutMs = MODEL_REQUEST_TIMEOUT_MS) {
  const config = {
    provider: settings.api.provider,
    apiKey,
    model: settings.api.model,
    timeoutMs,
    requestImpl: PROVIDER_HTTPS_REQUEST,
  };
  if (settings.api.provider === CUSTOM_PROVIDER_ID) {
    const connection = getCustomConnection(settings.api.customConnections, settings.api.connectionId);
    if (!connection) {
      throw Object.assign(new Error("没有找到当前自定义连接。"), {
        code: "CUSTOM_CONNECTION_NOT_FOUND",
        retryable: false,
      });
    }
    config.baseUrl = connection.baseUrl;
    config.model = connection.modelId;
    config.enforcePublicDns = true;
  }
  return config;
}

function providerConnectionChangeBusy() {
  return ["run-turn", "turn-derived", "context-compaction", "manual-save", "adventure-lifecycle", "save-maintenance"]
    .some((kind) => runtimeOperations.has(kind));
}

function providerConnectionBusyFailure() {
  return createFailure("ADVENTURE_BUSY", "当前故事仍在处理。请等本次操作结束，或先停止生成，再测试并使用连接。", true);
}

async function testAndUseProviderConnection(payload = {}) {
  if (providerConnectionChangeBusy()) return providerConnectionBusyFailure();
  let operation;
  let applied = false;
  try {
    const current = loadDesktopSettings();
    const candidate = resolveProviderTestCandidate(current, payload);
    const credentialIdentity = getCredentialIdentity(candidate.settings);
    // Check access before charging a probe or treating an unreadable stored key
    // as missing. Explicit retries can re-request OS vault access here.
    getCredentialStore().assertWritable();
    const previousConnection = candidate.connection && getCustomConnection(current.api.customConnections, candidate.connection.id);
    // A stored key may be reused at its original endpoint, never silently sent
    // to an edited URL. Entering a key explicitly authorizes the new endpoint.
    const canReuseCredential = !candidate.connection || (previousConnection?.baseUrl === candidate.connection.baseUrl
      && getCredentialStore().isVerified({ provider: CUSTOM_PROVIDER_ID, connectionId: previousConnection.id,
        fingerprint: createConnectionFingerprint(previousConnection) }));
    const apiKey = normalizeApiKey(payload.apiKey)
      || (canReuseCredential ? getCredentialStore().getSecret(credentialIdentity) : "");
    if (!apiKey) return createFailure("MISSING_API_KEY", "请先输入这个连接使用的 API Key。", false);
    operation = runtimeOperations.begin("provider-test");
    const provider = createProviderForSettings(candidate.settings, apiKey, CONNECTION_TEST_TIMEOUT_MS);
    const probe = await runProviderCompatibilityProbe({ provider, signal: operation.signal });
    if (!operation.isCurrent() || operation.signal.aborted) {
      return createFailure("REQUEST_ABORTED", "模型连接测试已取消，当前连接未切换。", false);
    }
    if (providerConnectionChangeBusy()) return providerConnectionBusyFailure();
    // Retain unrelated preferences changed while the asynchronous probe ran.
    const latest = loadDesktopSettings();
    const refreshed = resolveProviderTestCandidate(latest, candidate.connection
      ? { provider: CUSTOM_PROVIDER_ID, connection: candidate.connection }
      : { provider: candidate.settings.api.provider, model: candidate.settings.api.model });
    let verifiedSettings = refreshed.settings;
    if (refreshed.connection) {
      const verified = markCustomConnectionVerified(verifiedSettings.api.customConnections, refreshed.connection.id);
      verifiedSettings = normalizeDesktopSettings(mergeDesktopSettings(verifiedSettings,
        { api: { customConnections: verified.connections } }));
    }
    const contextValidation = await validateActiveContextSettings(latest, verifiedSettings);
    if (!operation.isCurrent() || operation.signal.aborted) {
      return createFailure("REQUEST_ABORTED", "模型连接测试已取消，当前连接未切换。", false);
    }
    if (providerConnectionChangeBusy()) return providerConnectionBusyFailure();
    if (!contextValidation.ok) {
      return createFailure(contextValidation.errorCode || "CONTEXT_SETTINGS_TOO_SMALL",
        "连接测试已通过，但当前故事无法放入这个连接的上下文范围；当前连接未切换。", true);
    }
    // Context preview can yield too. A later preferences save must not be lost.
    const atCommit = loadDesktopSettings();
    if (JSON.stringify(atCommit) !== JSON.stringify(latest)) {
      return createFailure("CONTEXT_SETTINGS_STALE", "测试期间设置发生了变化，请重新测试并使用；当前连接未切换。", true);
    }
    getCredentialStore().setVerifiedCredential({
      ...getCredentialIdentity(verifiedSettings),
      model: verifiedSettings.api.model,
      secretValue: apiKey,
    }, { commit: () => saveDesktopSettings(verifiedSettings) });
    applied = true;
    operation.finish();
    resetRuntimeSession("provider_test_succeeded", { clearCredential: false, preserveAdventure: true });
    return { ok: true, applied: true, probe, settings: getSettingsSnapshot(),
      catalog: getDesktopSettingsCatalog(), status: createStatus() };
  } catch (error) {
    if (applied) return { ...createFailure("MODEL_CONNECTION_ACTIVATION_FAILED",
      "新连接已保存，但当前冒险未能恢复，请返回主菜单后继续冒险。", true), applied: true,
      settings: getSettingsSnapshot(), catalog: getDesktopSettingsCatalog() };
    if (operation && (!operation.isCurrent() || operation.signal.aborted)) {
      return createFailure("REQUEST_ABORTED", "模型连接测试已取消，当前连接未切换。", false);
    }
    return createFailureFromError(error);
  } finally {
    operation?.finish();
  }
}

function clearSavedProviderCredentials(payload = {}, { all = false } = {}) {
  let resetting = all;
  let failure = null;
  runtimeOperations.abort("provider-test", "provider_credentials_cleared");
  if (all) {
    try { getCredentialStore().clear(); } catch (error) { failure = error; }
  }
  try {
    const current = loadDesktopSettings();
    let identity = getCredentialIdentity(current);
    if (!all && payload.connectionId) {
      if (!getCustomConnection(current.api.customConnections, payload.connectionId)) {
        return createFailure("CUSTOM_CONNECTION_NOT_FOUND", "没有找到这个自定义连接。", false);
      }
      identity = { provider: CUSTOM_PROVIDER_ID, connectionId: payload.connectionId };
    } else if (!all && payload.provider) {
      if (payload.provider !== "deepseek") return createFailure("INVALID_PROVIDER_CONFIG", "请指定要清除密钥的连接。", false);
      identity = { provider: "deepseek" };
    }
    resetting = all || resolveCredentialIdentityKey(identity) === resolveCredentialIdentityKey(getCredentialIdentity(current));
    if (!all) {
      try { getCredentialStore().clear(identity); } catch (error) { failure = error; }
    }
    const next = normalizeDesktopSettings(mergeDesktopSettings(current, { api: {
      customConnections: current.api.customConnections.map((connection) => all || connection.id === identity.connectionId
        ? { ...connection, verifiedAt: null, fingerprint: null, contractVersion: null } : connection),
    } }));
    try { saveDesktopSettings(next); } catch (error) { failure ||= error; }
  } catch (error) {
    failure = error;
  } finally {
    if (resetting) {
      try { resetRuntimeSession("credential_cleared", { clearCredential: false, preserveAdventure: true }); }
      catch (error) { failure ||= error; }
    }
  }
  if (failure) return createFailure("CREDENTIAL_CLEAR_FAILED",
    "无法确认本设备的密钥已经完整清除，请重试清除操作。", true);
  return { ok: true, cleared: all ? "all" : "connection", settings: getSettingsSnapshot(),
    catalog: getDesktopSettingsCatalog(), status: createStatus() };
}

function resolveProviderTestCandidate(current, payload = {}) {
  const provider = payload.provider || current.api.provider;
  if (provider !== "deepseek" && provider !== CUSTOM_PROVIDER_ID) {
    throw Object.assign(new Error("请选择受支持的模型连接类型。"), { code: "INVALID_PROVIDER_CONFIG", retryable: false });
  }
  if (provider === CUSTOM_PROVIDER_ID) {
    const updated = payload.connection ? upsertCustomConnection(current.api.customConnections, payload.connection) : null;
    const connection = updated?.connection || getCustomConnection(current.api.customConnections, payload.connectionId);
    if (!connection) {
      throw Object.assign(new Error("请填写或选择需要测试的自定义连接。"), {
        code: "CUSTOM_CONNECTION_NOT_FOUND",
        retryable: false,
      });
    }
    const settings = normalizeDesktopSettings(mergeDesktopSettings(current, {
      api: {
        provider: CUSTOM_PROVIDER_ID,
        model: connection.modelId,
        connectionId: connection.id,
        customConnections: updated?.connections || current.api.customConnections,
      },
      agent: {
        context: {
          configuredContextWindow: current.api.provider === CUSTOM_PROVIDER_ID && current.api.connectionId === connection.id
            ? current.agent?.context?.configuredContextWindow
            : CUSTOM_CONTEXT_WINDOW_DEFAULT,
        },
      },
    }));
    return { settings, connection };
  }
  const models = getSettingsCatalog().api.providers.find((item) => item.id === "deepseek")?.models || [];
  const model = payload.model || (current.api.provider === "deepseek" ? current.api.model : normalizeDesktopSettings().api.model);
  if (!models.some((item) => item.enabled !== false && item.id === model)) {
    throw Object.assign(new Error("请选择受支持的模型。"), { code: "INVALID_PROVIDER_CONFIG", retryable: false });
  }
  const settings = normalizeDesktopSettings(mergeDesktopSettings(current, {
    api: { provider: "deepseek", model, connectionId: null },
  }));
  return { settings, connection: null };
}

function getCredentialIdentity(settings = loadDesktopSettings()) {
  if (settings.api?.provider === CUSTOM_PROVIDER_ID) {
    const connection = getCustomConnection(settings.api.customConnections, settings.api.connectionId);
    return {
      provider: CUSTOM_PROVIDER_ID,
      connectionId: connection?.id || settings.api.connectionId,
      fingerprint: connection ? createConnectionFingerprint(connection) : "",
    };
  }
  return { provider: settings.api?.provider || "deepseek", model: settings.api?.model || "" };
}

function resolveCredentialIdentityKey(identity = {}) {
  if (typeof identity.connectionId === "string" && identity.connectionId) {
    return `connection:${identity.connectionId}`;
  }
  return `provider:${identity.provider || ""}`;
}

function getProviderModelProfile(settings = loadDesktopSettings()) {
  if (settings.api?.provider === CUSTOM_PROVIDER_ID) {
    const connection = getCustomConnection(settings.api.customConnections, settings.api.connectionId);
    return connection ? {
      id: connection.modelId,
      contextLimit: CUSTOM_CONTEXT_WINDOW_MAX,
      status: "custom",
    } : null;
  }
  const catalog = getDesktopSettingsCatalog();
  const provider = catalog.api?.providers?.find((item) => item.id === settings.api?.provider);
  return provider?.models?.find((item) => item.id === settings.api?.model) || null;
}

function createBridgeFromStoredCredential(settings = loadDesktopSettings()) {
  const secretValue = getCredentialStore().getSecret(getCredentialIdentity(settings));
  if (!secretValue) {
    throw new Error("Provider credential is not available.");
  }
  return createBridge(secretValue, getDataRoot(), settings);
}

function createStatus() {
  let appData = getSafeAppDataStatus();
  let settings = null;
  try {
    settings = loadDesktopSettings();
  } catch (error) {
    appData = projectAppDataFailureStatus(error);
    settings = normalizeDesktopSettings();
  }
  const credentialIdentity = getCredentialIdentity(settings);
  const credentialStatus = getCredentialStore().status(credentialIdentity);
  const verified = keyVerified && getCredentialStore().isVerified(credentialIdentity);
  return { ...createDesktopStatus({
    settings,
    keyVerified: verified,
    gameStarted,
    activeSaveId,
    activeSave: activeSaveSummary,
    platform: process.platform,
    appDataStatus: appData,
    credentialStatus,
    localeState: getLocaleCoordinator(settings.localization?.preferredLocale || null).snapshot(),
  }), runtimeProtocol: "session-1",
    runtimeSessionId: desktopSessionGeneration, sessionRecoveryRequired,
    sessionContextSettingsIdentity: sessionContextSettingsIdentity(settings),
    sessionContextGeneration: currentDesktopContext()?.contextGeneration ?? 0,
    sessionContextCompactionAvailable: currentDesktopContext()?.available === true
      && activeSaveSummary?.compatibility?.status !== "closed" };
}

function loadDesktopSettings() {
  return getSettingsStore().load();
}

function saveDesktopSettings(settings) {
  return getSettingsStore().save(settings);
}

function getSettingsSnapshot(settings = loadDesktopSettings()) {
  return getSettingsStore().snapshot(settings);
}

function getSettingsStore() {
  if (!settingsStore) {
    ensureDesktopAppData();
    settingsStore = createSettingsStore({
      dataRoot: getDataRoot(),
      logger: {
        warn: (_message, detail) => console.warn("Grey Crow desktop settings ignored", normalizeUiErrorMessage(detail)),
      },
    });
  }
  return settingsStore;
}

function getLocaleCoordinator(initialPreferredLocale) {
  if (!localeCoordinator) {
    let preferredLocale = initialPreferredLocale;
    if (preferredLocale === undefined) {
      try {
        preferredLocale = loadDesktopSettings().localization?.preferredLocale || null;
      } catch (_error) {
        preferredLocale = null;
      }
    }
    localeCoordinator = createLocaleCoordinator({
      preferredLocale,
    });
  }
  return localeCoordinator;
}

function requirePreferredLocale() {
  const localeState = getLocaleCoordinator().snapshot();
  if (!localeState.preferredLocale) {
    const error = new Error("Choose a game language before starting a new Adventure.");
    error.code = "GAME_LOCALE_SELECTION_REQUIRED";
    error.retryable = false;
    throw error;
  }
  return localeState.preferredLocale;
}

function readRequestedPreferredLocale(settingsPatch = {}) {
  const localization = settingsPatch?.localization;
  const provided = Boolean(localization && typeof localization === "object"
    && Object.prototype.hasOwnProperty.call(localization, "preferredLocale"));
  return { provided, value: provided ? localization.preferredLocale : null };
}

function getSaveSlotStore() {
  if (!saveSlotStore) {
    ensureDesktopAppData();
    saveSlotStore = createSaveSlotStore({
      dataRoot: getDataRoot(),
    });
  }
  return saveSlotStore;
}

function getAdventureCompatibilityGate() {
  return getSaveSlotStore().compatibilityGate;
}

function getTtsService() {
  if (!ttsService) {
    ensureDesktopAppData();
    const availability = inspectKokoroOriginalAvailability();
    const providers = {};
    const unavailableProviders = {};
    if (availability.available) {
      providers["kokoro-original-local"] = createKokoroOriginalProvider({
        runtimeRoot: resolveKokoroOriginalRuntimeRoot(),
        outputRoot: getTtsCacheRoot(),
      });
    } else {
      unavailableProviders["kokoro-original-local"] = {
        code: "KOKORO_MODEL_MISSING",
        message: "未安装高质量中文语音包。文字游戏仍可正常游玩。",
      };
    }
    ttsService = createTtsService({
      cacheRoot: getTtsCacheRoot(),
      providers,
      unavailableProviders,
      cacheLimit: 40,
    });
  }
  return ttsService;
}

function inspectKokoroOriginalAvailability() {
  return inspectOriginalBundle({
    runtimeRoot: resolveKokoroOriginalRuntimeRoot(),
  });
}

function getDesktopSettingsCatalog() {
  const catalog = getSettingsCatalog({
    kokoroOriginalAvailable: inspectKokoroOriginalAvailability().available,
  });
  if (Array.isArray(catalog.ui?.windowModes)) {
    catalog.ui.windowModes = catalog.ui.windowModes.map((mode) => ({
      ...mode,
      enabled: mode.kind === "fullscreen" || canDisplayWindowMode(mode, mainWindow),
    }));
    catalog.ui.currentWindowMode = currentWindowMode
      || normalizeWindowMode(loadDesktopSettings().ui?.windowMode);
  }
  return catalog;
}

function getTtsCacheRoot() {
  return path.join(getDataRoot(), "cache", "tts");
}

async function disposeTtsService() {
  const service = ttsService;
  ttsService = null;
  if (service) {
    await service.dispose();
  }
}

function resolveKokoroOriginalRuntimeRoot() {
  const configured = typeof process.env.GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT === "string"
    ? process.env.GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT.trim()
    : "";
  if (configured && path.isAbsolute(configured)) {
    return path.resolve(configured);
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "tts", "kokoro-original-zh");
  }
  const platformLabel = process.platform === "win32" ? "windows"
    : process.platform === "darwin" ? "macos" : process.platform;
  return path.resolve(__dirname, "../../../vendor/tts/.runtime/kokoro-original",
    `stage-${platformLabel}-${process.arch}-minimal`);
}

function resetRuntimeSession(reason = "runtime_session_reset", { clearCredential = false, preserveAdventure = false } = {}) {
  void speechInput?.cancel();
  const previousBridge = activeBridge;
  if (previousBridge) {
    const closing = previousBridge.close();
    sessionDisposal = Promise.all([sessionDisposal, closing]).then(() => undefined).catch((error) => {
      console.warn("Grey Crow session close failed", error?.code || "SESSION_CLOSE_FAILED");
    });
  }
  const previousAdventure = preserveAdventure && activeSaveId
    ? { activeSaveId, activeSaveSummary, gameStarted: gameStarted || sessionRecoveryRequired }
    : null;
  sessionRecoveryRequired = false;
  runtimeOperations.abortAll(reason, { excludeKinds: ["save-maintenance"] });
  turnDerivedTickets.clear();
  saveMaintenanceConfirmations.clear();
  newGameCreationConfirmations.clear();
  ({
    activeBridge,
    keyVerified,
    gameStarted,
    activeSaveId,
    activeSaveSummary,
  } = resetRuntimeSessionState({
    activeBridge,
    keyVerified,
    gameStarted,
    activeSaveId,
    activeSaveSummary,
  }));
  if (clearCredential) {
    getCredentialStore().clear();
  }
  keyVerified = false;
  if (!clearCredential) {
    restoreStoredCredentialSession();
  }
  if (previousAdventure) {
    activeSaveId = previousAdventure.activeSaveId;
    activeSaveSummary = null;
    gameStarted = false;
    sessionRecoveryRequired = (Boolean(keyVerified && previousAdventure.gameStarted));
  } else if (localeCoordinator) {
    localeCoordinator.leaveAdventure();
  }
}

function restoreStoredCredentialSession() {
  try {
    const settings = loadDesktopSettings();
    if (!getCredentialStore().isVerified(getCredentialIdentity(settings))) {
      activeBridge = null;
      keyVerified = false;
      return false;
    }
    activeBridge = createBridgeFromStoredCredential(settings);
    keyVerified = true;
    return true;
  } catch (error) {
    activeBridge = null;
    keyVerified = false;
    console.warn("Grey Crow credential restore skipped", normalizeUiErrorMessage(error?.message || error));
    return false;
  }
}

function listSaveSlots() {
  return getSaveSlotStore().list();
}

function canReadSessionArchive() {
  return (gameStarted) && activeSaveId && activeSaveSummary?.compatibility?.status === "closed";
}

function currentArchiveLocale() {
  return getLocaleCoordinator().snapshot().effectiveLocale || activeSaveSummary?.adventureLocale || "zh-CN";
}

function getSessionArchiveReader() {
  const { createSessionArchiveReader } = require(path.join(RUNTIME_ROOT, "engine/session/session-archive"));
  return createSessionArchiveReader({ adventuresRoot: getAppDataLayout().savesRoot });
}

async function continueSessionStoryArchive(request) {
  const keys = ["adventureId", "sessionId", "revision", "requestId", "sourceFinaleId"];
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some((key) => !keys.includes(key))
    || typeof request.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(request.requestId)
    || typeof request.sourceFinaleId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(request.sourceFinaleId)) {
    return createFailure("CONTINUATION_INPUT_INVALID", "续篇请求不完整，请重新打开档案。", false);
  }
  const sameRequest = (record) => record && keys.every((key) => record.request[key] === request[key]);
  // Retrying a lost UI receipt may arrive after Main has selected the child.
  // Reuse only this exact request and the unchanged child view, never a later story.
  if (sameRequest(lastSessionContinuation) && isDesktopProjectionBindingCurrent(lastSessionContinuation.binding)) {
    return { ...lastSessionContinuation.result, status: createStatus() };
  }
  if (sameRequest(sessionContinuationFlight)) return sessionContinuationFlight.promise;
  if (!isDesktopProjectionRequestCurrent(request)) return { ok: false, stale: true };
  if (runtimeOperations.has("adventure-lifecycle") || runtimeOperations.has("save-maintenance")
    || runtimeOperations.has("manual-save") || runtimeOperations.has("run-turn")) {
    return createFailure("ADVENTURE_BUSY", "上一项操作仍在处理。", true);
  }
  const binding = captureDesktopProjectionBinding();
  const operation = runtimeOperations.begin("adventure-lifecycle");
  const flight = { request: { ...request }, promise: null };
  sessionContinuationFlight = flight;
  flight.promise = (async () => {
    let created;
    let childOpened = false;
    const recoveryOwner = {};
    try {
      if (activeSaveSummary?.compatibility?.status !== "closed") {
        return createFailure("ADVENTURE_CONTINUATION_PARENT_NOT_CLOSED", "请先打开一个已经封存的故事。", false);
      }
      const archive = await getSessionArchiveReader().open({ adventureId: binding.adventureId });
      if (!operation.isCurrent() || !isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      const finale = archive.storyFinale?.projection?.closedFinale;
      if (archive.projection.adventureId !== binding.adventureId || archive.projection.revision !== binding.revision
        || finale?.finaleId !== request.sourceFinaleId) {
        return createFailure("ARCHIVE_REVISION_MISMATCH", "故事版本已变化，请重新打开档案。", true);
      }
      if (finale.continuationPolicy === "forbidden") {
        return createFailure("ADVENTURE_CONTINUATION_FORBIDDEN", "这个故事已经永久封存，无法开启续篇。", false);
      }
      if (!keyVerified || !binding.bridge) return createFailure("PROVIDER_NOT_READY", "请先完成模型连接，再进入续篇。", false);
      const { createSessionContinuationService } = require(path.join(RUNTIME_ROOT, "engine/session/session-continuation"));
      created = await createSessionContinuationService({ adventuresRoot: getAppDataLayout().savesRoot }).fork({
        requestId: request.requestId, parentAdventureId: binding.adventureId,
        parentRevision: binding.revision, sourceFinaleId: request.sourceFinaleId,
      });
      if (!operation.isCurrent() || !isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      if (created.revision !== created.boundaryRevision) {
        return { ...createFailure("ADVENTURE_CONTINUATION_ALREADY_ADVANCED", "这个续篇已经有新的进展，请从菜单打开已有续篇。", false),
          continuation: { status: created.status, requestId: request.requestId, childAdventureId: created.childAdventureId } };
      }
      await sessionDisposal;
      if (!operation.isCurrent() || !isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      childOpened = true;
      const recovered = await binding.bridge.recoverCurrentAdventure({ save_id: created.childAdventureId, limit: 20, recoveryOwner });
      if (!operation.isCurrent() || !isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      const projected = recovered.projection;
      if (projected?.adventureId !== created.childAdventureId || projected.revision !== created.revision
        || projected.continuation?.requestId !== request.requestId
        || projected.continuation?.parentAdventureId !== binding.adventureId
        || projected.continuation?.sourceFinaleId !== request.sourceFinaleId
        || projected.storyFinale?.projection?.inputAllowed !== true) {
        return createFailure("CONTINUATION_IDENTITY_MISMATCH", "续篇已建立，但读取结果不一致，请从菜单重新打开。", true);
      }
      const saves = await listSaveSlots();
      if (!operation.isCurrent() || !isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      getLocaleCoordinator().leaveAdventure({ adventureId: binding.adventureId });
      getLocaleCoordinator().enterAdventure({ adventureId: created.childAdventureId, adventureLocale: projected.save.adventureLocale });
      desktopSessionGeneration = crypto.randomBytes(8).toString("hex");
      activeSaveId = created.childAdventureId;
      activeSaveSummary = projected.save;
      gameStarted = true;
      sessionRecoveryRequired = false;
      childOpened = false; // Ownership has transferred to the active desktop session.
      const result = { ok: true, mode: "continuation", continuation: { ...projected.continuation, status: created.status },
        save: activeSaveSummary, projection: projected, history: recovered.history,
        historyComplete: recovered.historyComplete, historyNextBeforeRevision: recovered.historyNextBeforeRevision,
        lockedContent: recovered.locked_content, skillModules: recovered.modules || [], recovery: recovered.recovery,
        storyFinale: projected.storyFinale, contextUsage: bindSessionContextUsage(recovered.contextUsage), saves, status: createStatus() };
      lastSessionContinuation = { request: { ...request }, binding: captureDesktopProjectionBinding(), result };
      return result;
    } catch (error) {
      if (!isDesktopProjectionBindingCurrent(binding)) return { ok: false, stale: true };
      return { ...createFailureFromError(error), ...(created ? { continuation: {
        status: created.status, requestId: request.requestId, childAdventureId: created.childAdventureId } } : {}) };
    } finally {
      if (childOpened && created) await binding.bridge.close({ save_id: created.childAdventureId, recoveryOwner }).catch(() => {});
      operation.finish();
      if (sessionContinuationFlight === flight) sessionContinuationFlight = null;
    }
  })();
  return flight.promise;
}

async function openSessionArchivePayload(save, operation) {
  const generation = desktopSessionGeneration;
  const bridge = activeBridge;
  const opened = await getSessionArchiveReader().open({ adventureId: save.id, displayLocale: save.adventureLocale });
  const saves = await listSaveSlots();
  if ((operation && !operation.isCurrent()) || generation !== desktopSessionGeneration || bridge !== activeBridge) return { ok: false, stale: true };
  if (bridge && activeSaveId) await bridge.close({ save_id: activeSaveId });
  if ((operation && !operation.isCurrent()) || generation !== desktopSessionGeneration || bridge !== activeBridge) return { ok: false, stale: true };
  desktopSessionGeneration = crypto.randomBytes(8).toString("hex");
  if (activeSaveId && activeSaveId !== save.id) getLocaleCoordinator().leaveAdventure({ adventureId: activeSaveId });
  getLocaleCoordinator().enterAdventure({ adventureId: save.id, adventureLocale: save.adventureLocale });
  const projected = opened.projection;
  if (saves.some((item) => item.id !== save.id && item.compatibility?.playerContinuable === true)) {
    projected.storyFinale.projection.actions.continueAsChild = false;
  }
  activeSaveId = save.id;
  activeSaveSummary = { ...projected.save, title: save.title || projected.save.title };
  gameStarted = true;
  sessionRecoveryRequired = false;
  return { ok: true, mode: "archive", archive: opened.archive, save: activeSaveSummary,
    projection: projected, history: projected.history, historyComplete: projected.historyComplete,
    historyNextBeforeRevision: projected.historyNextBeforeRevision,
    chapters: opened.chapterPage.chapters, chapterPage: opened.chapterPage,
    storyFinale: projected.storyFinale, lockedContent: opened.lockedContent, skillModules: opened.modules || [], saves, status: createStatus() };
}

async function openStoryArchivePayload(save, operation) {
  if (!save?.id || save.compatibility?.status !== "closed") {
    return createFailure("ADVENTURE_ARCHIVE_NOT_CLOSED", "当前记录还不是已封存的故事。", false);
  }
  return openSessionArchivePayload(save, operation);
}

function loadSaveSlot(saveId) {
  return getSaveSlotStore().get(saveId);
}


async function resolveExistingSaveForNewGameRestart(saveId) {
  const requestedId = typeof saveId === "string" ? saveId.trim() : "";
  if (requestedId) {
    const requested = await loadSaveSlot(requestedId);
    assertSaveNotBusy(requested?.compatibility);
    if (requested && requested.compatibility?.playerContinuable === true) return requested;
  }
  if (activeSaveId) {
    const active = await loadSaveSlot(activeSaveId);
    assertSaveNotBusy(active?.compatibility);
    if (active && active.compatibility?.playerContinuable === true) {
      return active;
    }
  }
  const saves = await listSaveSlots();
  for (const save of Array.isArray(saves) ? saves : []) assertSaveNotBusy(save.compatibility);
  return Array.isArray(saves) ? saves.find((save) => save.compatibility?.playerContinuable === true) || null : null;
}

function assertSaveNotBusy(compatibility) {
  if (compatibility?.errorCode === "STORE_BUSY") {
    throw Object.assign(new Error("存档暂时繁忙，请稍后重试。"), { code: "STORE_BUSY", retryable: true });
  }
}

async function hasActiveAdventure() {
  const saves = await listSaveSlots();
  // Unknown availability cannot authorize creation or a deletion confirmation.
  for (const save of Array.isArray(saves) ? saves : []) assertSaveNotBusy(save.compatibility);
  return Array.isArray(saves) && saves.some((save) => save.compatibility?.playerContinuable === true);
}

function getNewGameLifecycle() {
  if (!newGameLifecycle) {
    ensureDesktopAppData();
    const layout = getAppDataLayout();
    newGameLifecycle = createNewGameLifecycle({
      adventuresRoot: layout.savesRoot,
      contentRoot: path.join(RUNTIME_ROOT, "content"),
      libraryRoot: layout.contentLibraryRoot,
      profileRoot: layout.playerProfileRoot,
      adventureStore: {
        async initializeFromContentSnapshot(request) {
          await sessionDisposal;
          if (!activeBridge) throw Object.assign(new Error("PROVIDER_NOT_READY"), { code: "PROVIDER_NOT_READY" });
          return activeBridge.initializeFromContentSnapshot(request);
        },
      },
    });
  }
  return newGameLifecycle;
}

function getContentManagement() {
  if (!contentManagement) {
    ensureDesktopAppData();
    const layout = getAppDataLayout();
    contentManagement = createDesktopContentManagement({
      dataRoot: layout.dataRoot,
      contentRoot: path.join(RUNTIME_ROOT, "content"),
      engineRoot: path.join(RUNTIME_ROOT, "engine"),
    });
  }
  return contentManagement;
}

async function chooseContentExportRoot() {
  const result = await showOpenDialog({
    title: "选择内容包导出位置",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0];
}

async function chooseStoryExportTarget(save, format) {
  const extension = format === "html" ? "html" : "md";
  const formatLabel = format === "html" ? "HTML 网页" : "Markdown 文档";
  const result = await showSaveDialog({
    title: `导出故事为 ${formatLabel}`,
    defaultPath: createStoryExportFilename(save?.title, extension),
    filters: [{ name: formatLabel, extensions: [extension] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (result.canceled || typeof result.filePath !== "string" || !result.filePath) return null;
  return path.extname(result.filePath) ? path.resolve(result.filePath) : path.resolve(`${result.filePath}.${extension}`);
}

function createStoryExportFilename(title, extension) {
  let base = String(title || "Grey Crow Story")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  base = Array.from(base || "Grey Crow Story").slice(0, 72).join("").replace(/[. ]+$/g, "");
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(base)) base = `Grey Crow ${base}`;
  return `${base || "Grey Crow Story"}.${extension}`;
}

function normalizeStoryExportRequest(payload) {
  const allowed = (["format", "adventureId", "sessionId", "revision"]);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((key) => !allowed.includes(key))) {
    const error = new Error("Story export request contains unsupported fields.");
    error.code = "STORY_EXPORT_REQUEST_INVALID";
    error.retryable = false;
    throw error;
  }
  const format = String(payload.format || "").trim().toLowerCase();
  if (!["html", "markdown"].includes(format)) {
    const error = new Error("Story export format is invalid.");
    error.code = "STORY_EXPORT_FORMAT_INVALID";
    error.retryable = false;
    throw error;
  }
  return format;
}

function showOpenDialog(options) {
  return mainWindow && !mainWindow.isDestroyed()
    ? dialog.showOpenDialog(mainWindow, options)
    : dialog.showOpenDialog(options);
}

function showSaveDialog(options) {
  return mainWindow && !mainWindow.isDestroyed()
    ? dialog.showSaveDialog(mainWindow, options)
    : dialog.showSaveDialog(options);
}

function invalidateNewGameContentSelections() {
  newGameCreationConfirmations.clear();
}

async function removeFailedAdventureCreation(adventureId) {
  const normalized = String(adventureId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(normalized)) return;
  await getSaveSlotStore().deleteConfirmed(normalized);
}

function issueNewGameCreationConfirmation(prepared) {
  pruneExpiredNewGameCreationConfirmations();
  newGameCreationConfirmations.clear();
  const confirmationToken = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + MAINTENANCE_CONFIRMATION_TTL_MS).toISOString();
  const confirmation = {
    confirmationToken,
    expiresAt,
    createRequest: prepared.createRequest,
  };
  newGameCreationConfirmations.set(confirmationToken, confirmation);
  return confirmation;
}

function takeNewGameCreationConfirmation(value) {
  pruneExpiredNewGameCreationConfirmations();
  const token = normalizeConfirmationToken(value);
  const confirmation = newGameCreationConfirmations.get(token) || null;
  if (confirmation) newGameCreationConfirmations.delete(token);
  return confirmation;
}

function pruneExpiredNewGameCreationConfirmations() {
  const now = Date.now();
  for (const [token, confirmation] of newGameCreationConfirmations.entries()) {
    const expiresMs = Date.parse(confirmation.expiresAt || "");
    if (!Number.isFinite(expiresMs) || expiresMs <= now) newGameCreationConfirmations.delete(token);
  }
}



function quiesceAdventureWrites(reason) {
  turnDerivedTickets.clear();
  return runtimeOperations.abortAndWaitAll(
    ADVENTURE_QUIESCE_OPERATION_KINDS,
    reason,
    { timeoutMs: ADVENTURE_WRITE_QUIESCE_TIMEOUT_MS }
  );
}

async function executeSaveMaintenanceAction(confirmation) {
  const definition = SAVE_MAINTENANCE_ACTIONS[confirmation.action] || {};
  const request = {
    save_id: confirmation.saveId,
    reason: definition.reason || "desktop_manual_maintenance",
  };
  if (confirmation.action === "repair") {
    const recovered = await activeBridge.recoverCurrentAdventure(request);
    if (!recovered?.projection) throw Object.assign(new Error("SESSION_RECOVERY_REQUIRED"), { code: "SESSION_RECOVERY_REQUIRED" });
    activeSaveSummary = recovered.projection.save;
    sessionRecoveryRequired = true;
    return { ok: true, save_id: confirmation.saveId, repaired: false, recovered: true, canonical_sources_untouched: true };
  }
  if (confirmation.action === "clear") {
    if (confirmation.scope === "delete_pending") {
      return await getSaveSlotStore().retryPendingDelete(confirmation.deletionId)
        || { ok: true, deleted: true, saveId: confirmation.saveId, recoveredDelete: true };
    }
    if (activeBridge) await activeBridge.close({ save_id: confirmation.saveId });
    let result;
    try { result = await getSaveSlotStore().deleteConfirmed(confirmation.saveId); }
    catch (error) { if (error?.code === "SAVE_DELETE_PENDING") return { ok: false, deleted: false, saveId: confirmation.saveId, errorCode: error.code }; throw error; }
    if (!result) throw Object.assign(new Error("SAVE_NOT_FOUND"), { code: "SAVE_NOT_FOUND", retryable: false });
    return {
      ok: result?.ok === true,
      deleted: result?.deleted === true,
      saveId: result?.saveId || confirmation.saveId,
      removed_entries: ["adventure_root"],
      preserved: {
        global_profile: true,
        provider_vault: true,
        settings: true,
        installed_packs: true,
      },
      not_model_visible: true,
    };
  }
  throw new Error("Unsupported save maintenance action.");
}

function issueSaveMaintenanceConfirmation(details = {}) {
  pruneExpiredMaintenanceConfirmations();
  const action = normalizeSaveMaintenanceAction(details.action);
  const definition = SAVE_MAINTENANCE_ACTIONS[action];
  const confirmationToken = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + MAINTENANCE_CONFIRMATION_TTL_MS).toISOString();
  const save = details.save && typeof details.save === "object" ? details.save : {};
  const confirmation = {
    action,
    saveId: details.saveId,
    confirmationToken,
    expiresAt,
    danger: definition.danger,
    label: definition.label,
    requiresText: Boolean(definition.requiresText),
    confirmationText: definition.confirmationText || null,
    save: {
      id: String(save.id || details.saveId || ""),
      title: String(save.title || "当前冒险"),
      turn: Number.isFinite(save.turn) ? save.turn : null,
    },
    inspection: projectSaveMaintenanceInspection(details.inspection),
    scope: details.scope === "delete_pending" ? "delete_pending" : "active_adventure",
    deletionId: details.scope === "delete_pending" ? details.deletionId : null,
  };
  saveMaintenanceConfirmations.set(confirmationToken, confirmation);
  return projectSaveMaintenanceConfirmation(confirmation);
}

function getSaveMaintenanceConfirmation(token) {
  pruneExpiredMaintenanceConfirmations();
  const confirmationToken = normalizeConfirmationToken(token);
  return saveMaintenanceConfirmations.get(confirmationToken) || null;
}

function pruneExpiredMaintenanceConfirmations() {
  const now = Date.now();
  for (const [token, confirmation] of saveMaintenanceConfirmations.entries()) {
    const expiresMs = Date.parse(confirmation.expiresAt || "");
    if (!Number.isFinite(expiresMs) || expiresMs <= now) {
      saveMaintenanceConfirmations.delete(token);
    }
  }
}

function normalizeSaveMaintenanceAction(value) {
  const action = typeof value === "string" ? value.trim() : "";
  if (!Object.prototype.hasOwnProperty.call(SAVE_MAINTENANCE_ACTIONS, action)) {
    throw new Error("Unsupported save maintenance action.");
  }
  return action;
}

function normalizeConfirmationToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  return /^[A-Fa-f0-9]{32}$/.test(token) ? token : "";
}

function projectSaveMaintenanceConfirmation(confirmation = {}) {
  return {
    action: confirmation.action,
    confirmationToken: confirmation.confirmationToken,
    expiresAt: confirmation.expiresAt,
    danger: confirmation.danger,
    label: confirmation.label,
    requiresText: Boolean(confirmation.requiresText),
    confirmationText: confirmation.requiresText ? confirmation.confirmationText : null,
    save: confirmation.save,
    inspection: projectSaveMaintenanceInspection(confirmation.inspection),
    scope: confirmation.scope === "delete_pending" ? "delete_pending" : "active_adventure",
    deletionId: confirmation.scope === "delete_pending" ? confirmation.deletionId : null,
  };
}

function projectNewGameRestartConfirmation(confirmation = {}) {
  const save = confirmation.save && typeof confirmation.save === "object" ? confirmation.save : {};
  return {
    action: "new_game_restart",
    confirmationToken: typeof confirmation.confirmationToken === "string" ? confirmation.confirmationToken : "",
    expiresAt: confirmation.expiresAt || null,
    danger: "critical",
    label: "删除当前冒险并开始新游戏",
    requiresText: true,
    confirmationText: confirmation.confirmationText || CLEAR_CURRENT_SAVE_CONFIRMATION_TEXT,
    save: {
      id: String(save.id || ""),
      title: String(save.title || "当前冒险"),
      turn: Number.isFinite(save.turn) ? save.turn : null,
    },
  };
}

function projectSaveMaintenanceInspection(inspection = {}) {
  return {
    ok: Boolean(inspection.ok),
    exists: Boolean(inspection.exists),
    missing_entries: Array.isArray(inspection.missing_entries) ? inspection.missing_entries.map(String).slice(0, 64) : [],
    present_entries: Array.isArray(inspection.present_entries) ? inspection.present_entries.map(String).slice(0, 64) : [],
  };
}

function projectSaveMaintenanceResult(action, result = {}) {
  if (action === "repair") {
    return {
      ok: Boolean(result.ok),
      operation: "repair_current_save",
      created_entries: Array.isArray(result.created_entries) ? result.created_entries.map(String).slice(0, 64) : [],
      initialized_state: Boolean(result.initialized_state),
      warnings: Array.isArray(result.warnings) ? result.warnings.map(String).slice(0, 16) : [],
      state_hint: result.state_hint || null,
      content_repair: result.content_repair || null,
      memory_repair: result.memory_repair || null,
      not_model_visible: true,
    };
  }
  if (action === "clear") {
    if (result.deleted === true) {
      return {
        ok: Boolean(result.ok),
        operation: "delete_current_adventure",
        deleted: Boolean(result.deleted),
        save_id: normalizeDebugTraceIdentifier(result.saveId || result.save_id || ""),
        removed_entries: Array.isArray(result.removed_entries) ? result.removed_entries.map(String).slice(0, 32) : [],
        preserved: result.preserved && typeof result.preserved === "object" ? {
          global_profile: result.preserved.global_profile === true,
          provider_vault: result.preserved.provider_vault === true,
          settings: result.preserved.settings === true,
          installed_packs: result.preserved.installed_packs === true,
        } : null,
        not_model_visible: true,
      };
    }
    return {
      ok: Boolean(result.ok),
      operation: "clear_current_save",
      automatic_backup: result.automatic_backup === true,
      restore_available: result.restore_available === true,
      removed_entries: Array.isArray(result.removed_entries) ? result.removed_entries.map(String).slice(0, 64) : [],
      repaired_entries: Array.isArray(result.repaired_entries) ? result.repaired_entries.map(String).slice(0, 64) : [],
      state_hint: result.state_hint || null,
      not_model_visible: true,
    };
  }
  return {
    ok: Boolean(result.ok),
    operation: "unknown_save_maintenance",
    not_model_visible: true,
  };
}



function projectMemoryConsolidation(value = null) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const range = source.source_range && typeof source.source_range === "object" ? source.source_range : {};
  return {
    status: normalizeDebugTraceIdentifier(source.status || ""),
    reason: normalizeDebugTraceIdentifier(source.reason || ""),
    stage: normalizeDebugTraceIdentifier(source.stage || ""),
    error_code: normalizeDebugTraceIdentifier(source.error_code || ""),
    retryable: Boolean(source.retryable),
    source_range: {
      start: Number.isFinite(range.start_turn) ? range.start_turn : undefined,
      end: Number.isFinite(range.end_turn) ? range.end_turn : undefined,
    },
    operation_count: Number.isFinite(source.operation_count) ? source.operation_count : 0,
    writes_completed: Number.isFinite(source.writes_completed) ? source.writes_completed : 0,
    last_consolidated_turn: Number.isFinite(source.last_consolidated_turn) ? source.last_consolidated_turn : 0,
    remaining: Boolean(source.remaining),
    provider: normalizeDebugTraceIdentifier(source.provider || ""),
    model: redactSecrets(String(source.model || "")).replace(/\s+/g, " ").trim().slice(0, 120),
    usage: projectSimpleProviderUsage(source.usage),
  };
}

function projectSimpleProviderUsage(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    input_tokens: normalizeDebugTraceNumber(source.input_tokens ?? source.prompt_tokens),
    output_tokens: normalizeDebugTraceNumber(source.output_tokens ?? source.completion_tokens),
    total_tokens: normalizeDebugTraceNumber(source.total_tokens),
  };
}




function projectCompactionMetrics(metrics = {}) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return null;
  }
  return {
    trigger_reason: normalizeDebugTraceIdentifier(metrics.trigger_reason || ""),
    source_records: Number.isFinite(metrics.source_records) ? metrics.source_records : null,
    source_estimated_tokens: Number.isFinite(metrics.source_estimated_tokens) ? metrics.source_estimated_tokens : null,
    previous_summary_estimated_tokens: Number.isFinite(metrics.previous_summary_estimated_tokens) ? metrics.previous_summary_estimated_tokens : null,
    summary_estimated_tokens: Number.isFinite(metrics.summary_estimated_tokens) ? metrics.summary_estimated_tokens : null,
    recent_kept: Number.isFinite(metrics.recent_kept) ? metrics.recent_kept : null,
    next_input_estimate_tokens: Number.isFinite(metrics.next_input_estimate_tokens) ? metrics.next_input_estimate_tokens : null,
    before_input_estimate_tokens: Number.isFinite(metrics.before_input_estimate_tokens) ? metrics.before_input_estimate_tokens : null,
    before_usage_ratio: Number.isFinite(metrics.before_usage_ratio) ? metrics.before_usage_ratio : null,
    after_usage_ratio: Number.isFinite(metrics.after_usage_ratio) ? metrics.after_usage_ratio : null,
    source_summary_reduction_ratio: Number.isFinite(metrics.source_summary_reduction_ratio)
      ? metrics.source_summary_reduction_ratio
      : null,
    min_summary_reduction_ratio: Number.isFinite(metrics.min_summary_reduction_ratio)
      ? metrics.min_summary_reduction_ratio
      : null,
    reduction_ratio: Number.isFinite(metrics.reduction_ratio) ? metrics.reduction_ratio : null,
    no_benefit: Boolean(metrics.no_benefit),
    no_benefit_reason: normalizeDebugTraceIdentifier(metrics.no_benefit_reason || ""),
    skipped_save: Boolean(metrics.skipped_save),
    model_assisted_attempted: Boolean(metrics.model_assisted_attempted),
    model_assisted_ok: Boolean(metrics.model_assisted_ok),
    model_assisted: typeof metrics.model_assisted === "boolean" ? metrics.model_assisted : undefined,
    model_assisted_usage: projectSimpleProviderUsage(metrics.model_assisted_usage),
    summary_hash: typeof metrics.summary_hash === "string" ? metrics.summary_hash : null,
    summary_version: normalizeDebugTraceIdentifier(metrics.summary_version || ""),
    summary_token_hard_cap: Number.isFinite(metrics.summary_token_hard_cap) ? metrics.summary_token_hard_cap : null,
    summary_clipped: Boolean(metrics.summary_clipped),
    sourceRange: projectDebugTraceRange(metrics.sourceRange || metrics.source_range),
  };
}

function projectDebugTraceResult(result = {}) {
  const entries = Array.isArray(result.entries)
    ? result.entries.slice(-DEBUG_TRACE_EXPORT_ENTRY_LIMIT).map(projectDebugTraceEntry)
    : [];
  return {
    ok: Boolean(result.ok),
    save_id: normalizeDebugTraceIdentifier(result.save_id || activeSaveId || ""),
    scope: projectDebugTraceScope(result.scope, result.save_id || activeSaveId || ""),
    selection: projectDebugTraceSelection(result.selection, entries.length),
    summary: createDebugTraceSummary(entries),
    entries,
    entry_count: entries.length,
    execution: projectDebugExecution(result.execution),
    not_model_visible: true,
  };
}

function projectDebugExecution(value) {
  // Execution metadata has its own whitelist. A child process's JSON envelope
  // alone does not authorize arbitrary request, response or service fields.
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = Object.getOwnPropertyDescriptors(value);
  const read = key => Object.hasOwn(data[key] || {}, "value") ? data[key].value : undefined;
  if (read("format") !== EXECUTION_FORMAT) return null;
  const count = number => Number.isSafeInteger(number) && number >= 0 ? number : null;
  const timestamp = text => typeof text === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)
    && Number.isFinite(Date.parse(text)) ? text : null;
  const result = { available: read("available") === true, format: EXECUTION_FORMAT,
    records: [], retainedAttempts: count(read("retainedAttempts")), returnedAttempts: 0,
    truncated: read("truncated") === true, historyComplete: false,
    maxRecordBytes: EXECUTION_MAX_BYTES, maxEndedAttempts: 100 };
  const records = read("records");
  if (!Array.isArray(records)) return result;
  const descriptors = Object.getOwnPropertyDescriptors(records);
  if (records.length > 101) result.truncated = true;
  for (let index = 0; index < Math.min(records.length, 101); index++) {
    const record = descriptors[index]?.value;
    if (!record || typeof record !== "object" || Array.isArray(record)) { result.truncated = true; continue; }
    const props = Object.getOwnPropertyDescriptors(record);
    const get = key => Object.hasOwn(props[key] || {}, "value") ? props[key].value : undefined;
    const snapshot = sanitizeExecutionSnapshot(Object.fromEntries([
      "format", "phase", "adventureId", "actionId", "attemptId", "baseRevision", "startedAt", "lastSequence", "truncated", "steps",
    ].map(key => [key, get(key)])));
    if (!snapshot) { result.truncated = true; continue; }
    const status = ["running", "committed", "cancelled", "failed", "interrupted"].includes(get("status")) ? get("status") : "unknown";
    const error = get("error");
    const errorFields = error && typeof error === "object" ? Object.getOwnPropertyDescriptors(error) : {};
    const code = errorFields.code?.value;
    const safe = { ...snapshot, status, committedRevision: count(get("committedRevision")),
      endedAt: timestamp(get("endedAt")), incomplete: get("incomplete") !== false || snapshot.truncated
        || ["running", "interrupted", "unknown"].includes(status) || snapshot.steps.length === 0,
      ...(error ? { error: { code: EXECUTION_ACTION_CODES.includes(code) ? code : "ACTION_FAILED",
        retryable: errorFields.retryable?.value === true } } : {}) };
    if (Buffer.byteLength(JSON.stringify(safe)) > EXECUTION_MAX_BYTES) { result.truncated = true; continue; }
    result.records.push(safe);
    result.returnedAttempts = result.records.length;
    if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024) {
      result.records.pop(); result.returnedAttempts = result.records.length; result.truncated = true; break;
    }
  }
  // This codec allows only identifiers, hashes, fixed enums and measurements.
  // Generic string redaction would destroy SHA256 fingerprints; the legacy
  // key scrubber would also remove numeric prompt-cache usage measurements.
  return result;
}

function projectDebugTraceScope(scope = {}, fallbackSaveId = "") {
  const source = scope && typeof scope === "object" && !Array.isArray(scope) ? scope : {};
  return {
    type: normalizeDebugTraceIdentifier(source.type || "active_adventure"),
    adventure_id: normalizeDebugTraceIdentifier(source.adventure_id || fallbackSaveId),
    save_id: normalizeDebugTraceIdentifier(source.save_id || source.adventure_id || fallbackSaveId),
  };
}

function projectDebugTraceSelection(selection = {}, selectedCount = 0) {
  const source = selection && typeof selection === "object" && !Array.isArray(selection) ? selection : {};
  return {
    policy: normalizeDebugTraceIdentifier(source.policy || "recent_only"),
    recent_limit: normalizeDebugTraceNumber(source.recent_limit),
    older_error_limit: normalizeDebugTraceNumber(source.older_error_limit),
    available_entry_count: normalizeDebugTraceNumber(source.available_entry_count || selectedCount),
    available_error_entry_count: normalizeDebugTraceNumber(source.available_error_entry_count),
    error_entry_count: normalizeDebugTraceNumber(source.available_error_entry_count),
    selected_entry_count: selectedCount,
    selected_error_entry_count: normalizeDebugTraceNumber(source.selected_error_entry_count),
    truncated: Boolean(source.truncated),
  };
}

function projectDebugTraceEntry(entry = {}) {
  const source = entry && typeof entry === "object" ? entry : {};
  if (source.schema_version === "grey-crow-session-diagnostics-v1" && source.session_action) {
    const action = source.session_action;
    const status = ["running", "committed", "failed", "interrupted", "cancelled"].includes(action.status) ? action.status : "unknown";
    return sanitizeDebugTraceValue({ schema_version: source.schema_version, trace_schema_version: source.schema_version, kind: "session_action",
      record_id: normalizeDebugTraceIdentifier(source.record_id), request_id: normalizeDebugTraceIdentifier(source.request_id),
      createdAt: typeof action.createdAt === "string" ? action.createdAt : null,
      error_code: normalizeDebugTraceIdentifier(source.error_code || ""),
      session_action: { status, baseRevision: Number.isSafeInteger(action.baseRevision) ? action.baseRevision : null,
        committedRevision: Number.isSafeInteger(action.committedRevision) ? action.committedRevision : null,
        attemptId: normalizeDebugTraceIdentifier(action.attemptId),
        updatedAt: typeof action.updatedAt === "string" ? action.updatedAt : null,
        attemptHistoryComplete: false, modelUsage: null }, not_model_visible: true });
  }
  return sanitizeDebugTraceValue({
    schema_version: normalizeDebugTraceIdentifier(source.schema_version || ""),
    kind: source.kind === "operation_trace_summary" ? source.kind : "operation_trace_summary",
    record_id: normalizeDebugTraceIdentifier(source.record_id || ""),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : null,
    trace_schema_version: normalizeDebugTraceIdentifier(source.schemaVersion || source.trace_schema_version || ""),
    request_id: normalizeDebugTraceIdentifier(source.request_id || ""),
    turn_id: normalizeDebugTraceIdentifier(source.turn_id || ""),
    failed_stage: typeof source.failed_stage === "string" ? source.failed_stage : null,
    error_code: normalizeDebugTraceIdentifier(source.error_code || source.error?.code || ""),
    provider: projectDebugTraceProvider(source.provider),
    anchor_summary: projectDebugTraceAnchorSummary(source.anchor_summary),
    tools: projectDebugTraceTools(source.tools),
    developer_summary: projectDebugTraceDeveloperSummary(source.developer_summary),
    parser: projectDebugTraceParser(source.parser),
    hard_commit_validator: projectDebugTraceValidator(source.hard_commit_validator),
    commit: projectDebugTraceCommit(source.commit),
    memory: projectDebugTraceMemory(source.memory),
    player_turn: projectDebugTracePlayerTurn(source.player_turn),
    projection: projectDebugTraceProjection(source.projection),
    save_node: projectDebugTraceSaveNode(source.save_node),
    duration_ms: Number.isFinite(source.duration_ms) ? source.duration_ms : 0,
    not_model_visible: true,
  });
}

function projectDebugTraceSaveNode(saveNode = {}) {
  const source = saveNode && typeof saveNode === "object" && !Array.isArray(saveNode) ? saveNode : {};
  if (!source.status) {
    return null;
  }
  const generation = source.generation && typeof source.generation === "object" ? source.generation : {};
  const usage = generation.usage && typeof generation.usage === "object" ? generation.usage : {};
  return {
    status: normalizeDebugTraceIdentifier(source.status || ""),
    reason: normalizeDebugTraceIdentifier(source.reason || ""),
    error_code: normalizeDebugTraceIdentifier(source.error_code || ""),
    chapter_generated: Boolean(source.chapter_generated),
    chapter_decision: normalizeDebugTraceIdentifier(source.chapter_decision || ""),
    source_range: projectDebugTraceRange(source.source_range),
    source_hash_prefix: normalizeDebugTraceIdentifier(source.source_hash_prefix || ""),
    generation: {
      mode: normalizeDebugTraceIdentifier(generation.mode || ""),
      attempted: Boolean(generation.attempted),
      ok: generation.ok === null || generation.ok === undefined ? null : Boolean(generation.ok),
      usage: {
        input_tokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : undefined,
        output_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : undefined,
        total_tokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : undefined,
      },
    },
  };
}

function projectDebugTraceAnchorSummary(anchor = {}) {
  const source = anchor && typeof anchor === "object" ? anchor : {};
  const memory = source.memory && typeof source.memory === "object" ? source.memory : {};
  return {
    memory: {
      recent_count: Number.isFinite(memory.recent_count) ? memory.recent_count : 0,
      recent_transcript_count: Number.isFinite(memory.recent_transcript_count) ? memory.recent_transcript_count : 0,
      recent_transcript_range: projectDebugTraceRange(memory.recent_transcript_range),
    },
    redactions: projectDebugTraceRedactions(source.redactions),
    context_budget: projectDebugTraceContextBudget(source.context_budget),
  };
}

function projectDebugTraceRedactions(redactions = {}) {
  const source = redactions && typeof redactions === "object" && !Array.isArray(redactions) ? redactions : {};
  return {
    redacted_values: Number.isFinite(source.redacted_values) ? source.redacted_values : 0,
    local_path_values: Number.isFinite(source.local_path_values) ? source.local_path_values : 0,
  };
}

function projectDebugTraceContextBudget(budget = {}) {
  const source = budget && typeof budget === "object" && !Array.isArray(budget) ? budget : {};
  return {
    window: Number.isFinite(source.window) ? source.window : 0,
    configured_context_window: Number.isFinite(source.configured_context_window) ? source.configured_context_window : null,
    provider_context_limit: Number.isFinite(source.provider_context_limit) ? source.provider_context_limit : null,
    effective_context_window: Number.isFinite(source.effective_context_window) ? source.effective_context_window : null,
    input_limit: Number.isFinite(source.input_limit) ? source.input_limit : 0,
    budget_input_limit: Number.isFinite(source.budget_input_limit) ? source.budget_input_limit : 0,
    auto_compact_ratio: Number.isFinite(source.auto_compact_ratio) ? source.auto_compact_ratio : null,
    auto_compact_limit: Number.isFinite(source.auto_compact_limit) ? source.auto_compact_limit : null,
    emergency_guard_ratio: Number.isFinite(source.emergency_guard_ratio) ? source.emergency_guard_ratio : null,
    emergency_limit: Number.isFinite(source.emergency_limit) ? source.emergency_limit : null,
    next_prompt_estimate_tokens: Number.isFinite(source.next_prompt_estimate_tokens) ? source.next_prompt_estimate_tokens : null,
    prompt_tokens: Number.isFinite(source.prompt_tokens) ? source.prompt_tokens : 0,
    full_context_estimate: Number.isFinite(source.full_context_estimate) ? source.full_context_estimate : 0,
    irreducible_baseline_tokens: Number.isFinite(source.irreducible_baseline_tokens) ? source.irreducible_baseline_tokens : null,
    latest_request_input_tokens: Number.isFinite(source.latest_request_input_tokens) ? source.latest_request_input_tokens : null,
    latest_actual_input_tokens: Number.isFinite(source.latest_actual_input_tokens) ? source.latest_actual_input_tokens : null,
    latest_pre_send_estimate_tokens: Number.isFinite(source.latest_pre_send_estimate_tokens) ? source.latest_pre_send_estimate_tokens : null,
    latest_pre_send_estimate_source: normalizeDebugTraceIdentifier(source.latest_pre_send_estimate_source || ""),
    latest_estimate_error_tokens: Number.isFinite(source.latest_estimate_error_tokens) ? source.latest_estimate_error_tokens : null,
    latest_estimate_error_ratio: Number.isFinite(source.latest_estimate_error_ratio) ? source.latest_estimate_error_ratio : null,
    actual_usage_request_count: Number.isFinite(source.actual_usage_request_count) ? source.actual_usage_request_count : 0,
    turn_peak_safety_input_tokens: Number.isFinite(source.turn_peak_safety_input_tokens) ? source.turn_peak_safety_input_tokens : null,
    turn_peak_actual_input_tokens: Number.isFinite(source.turn_peak_actual_input_tokens) ? source.turn_peak_actual_input_tokens : null,
    request_count: Number.isFinite(source.request_count) ? source.request_count : 0,
    payload_evaluation_count: Number.isFinite(source.payload_evaluation_count) ? source.payload_evaluation_count : 0,
    usage_ratio: Number.isFinite(source.usage_ratio) ? source.usage_ratio : null,
    fits: typeof source.fits === "boolean" ? source.fits : null,
    item_count: Number.isFinite(source.item_count) ? source.item_count : 0,
    itemization: Array.isArray(source.itemization)
      ? source.itemization.slice(0, 24).map(projectDebugTraceContextBudgetItem).filter(Boolean)
      : [],
  };
}

function projectDebugTraceContextBudgetItem(item = {}) {
  const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const name = normalizeDebugTraceIdentifier(source.name || "");
  if (!name) {
    return null;
  }
  return {
    name,
    prompt_tokens: Number.isFinite(source.prompt_tokens) ? source.prompt_tokens : undefined,
    records: Number.isFinite(source.records) ? source.records : undefined,
  };
}

function projectDebugTraceRange(range = {}) {
  const source = range && typeof range === "object" && !Array.isArray(range) ? range : {};
  const start = Number(source.start);
  const end = Number(source.end);
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

function projectDebugTraceProvider(provider = {}) {
  const source = provider && typeof provider === "object" ? provider : {};
  const usage = source.usage && typeof source.usage === "object" ? source.usage : {};
  return {
    provider: normalizeDebugTraceIdentifier(source.provider || ""),
    model: normalizeDebugTraceIdentifier(source.model || ""),
    finish_reason: normalizeDebugTraceIdentifier(source.finish_reason || ""),
    status: normalizeDebugTraceIdentifier(source.status || ""),
    call_count: Number.isFinite(source.call_count) ? source.call_count : 0,
    tool_followup: Boolean(source.tool_followup),
    usage: {
      input_tokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : undefined,
      output_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : undefined,
      prompt_tokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : undefined,
      completion_tokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : undefined,
      total_tokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : undefined,
      prompt_cache_hit_tokens: Number.isFinite(usage.prompt_cache_hit_tokens) ? usage.prompt_cache_hit_tokens : undefined,
      prompt_cache_miss_tokens: Number.isFinite(usage.prompt_cache_miss_tokens) ? usage.prompt_cache_miss_tokens : undefined,
      reasoning_tokens: Number.isFinite(usage.reasoning_tokens) ? usage.reasoning_tokens : undefined,
      cost_usd: Number.isFinite(usage.cost_usd) ? usage.cost_usd : undefined,
      usage_request_count: Number.isFinite(usage.usage_request_count) ? usage.usage_request_count : undefined,
      reported_total_request_count: Number.isFinite(usage.reported_total_request_count) ? usage.reported_total_request_count : undefined,
      inferred_total_request_count: Number.isFinite(usage.inferred_total_request_count) ? usage.inferred_total_request_count : undefined,
      total_complete: typeof usage.total_complete === "boolean" ? usage.total_complete : undefined,
      input_tokens_details: projectDebugTraceUsageDetails(usage.input_tokens_details || usage.prompt_tokens_details),
      output_tokens_details: projectDebugTraceUsageDetails(usage.output_tokens_details || usage.completion_tokens_details),
    },
    request_usage_entries: Array.isArray(source.request_usage_entries)
      ? source.request_usage_entries.slice(0, 16).map(projectDebugTraceRequestUsageEntry).filter(Boolean)
      : [],
  };
}

function projectDebugTraceRequestUsageEntry(entry = {}) {
  const source = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  if (!Number.isFinite(source.call_index)) {
    return null;
  }
  const usage = source.actual_usage && typeof source.actual_usage === "object" ? source.actual_usage : {};
  return {
    call_index: source.call_index,
    phase: normalizeDebugTraceIdentifier(source.phase || ""),
    sent: source.sent !== false,
    pre_send_estimate_tokens: Number.isFinite(source.pre_send_estimate_tokens) ? source.pre_send_estimate_tokens : null,
    pre_send_estimate_source: normalizeDebugTraceIdentifier(source.pre_send_estimate_source || ""),
    actual_input_tokens: Number.isFinite(source.actual_input_tokens) ? source.actual_input_tokens : null,
    estimate_error_tokens: Number.isFinite(source.estimate_error_tokens) ? source.estimate_error_tokens : null,
    estimate_error_ratio: Number.isFinite(source.estimate_error_ratio) ? source.estimate_error_ratio : null,
    safety_input_tokens: Number.isFinite(source.safety_input_tokens) ? source.safety_input_tokens : null,
    actual_usage: {
      input_tokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : undefined,
      output_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : undefined,
      prompt_tokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : undefined,
      completion_tokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : undefined,
      total_tokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : undefined,
      prompt_cache_hit_tokens: Number.isFinite(usage.prompt_cache_hit_tokens) ? usage.prompt_cache_hit_tokens : undefined,
      prompt_cache_miss_tokens: Number.isFinite(usage.prompt_cache_miss_tokens) ? usage.prompt_cache_miss_tokens : undefined,
      reasoning_tokens: Number.isFinite(usage.reasoning_tokens) ? usage.reasoning_tokens : undefined,
      cost_usd: Number.isFinite(usage.cost_usd) ? usage.cost_usd : undefined,
      prompt_tokens_details: projectDebugTraceUsageDetails(usage.prompt_tokens_details || usage.input_tokens_details),
      completion_tokens_details: projectDebugTraceUsageDetails(usage.completion_tokens_details || usage.output_tokens_details),
    },
  };
}

function projectDebugTraceUsageDetails(details = {}) {
  const source = details && typeof details === "object" && !Array.isArray(details) ? details : {};
  const out = {};
  for (const key of [
    "cached_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "audio_tokens",
    "accepted_prediction_tokens",
    "rejected_prediction_tokens",
  ]) {
    if (Number.isFinite(source[key])) {
      out[key] = source[key];
    }
  }
  return Object.keys(out).length ? out : null;
}

function projectDebugTraceTools(tools = {}) {
  const source = tools && typeof tools === "object" ? tools : {};
  return {
    executed: Number.isFinite(source.executed) ? source.executed : 0,
    ok_count: Number.isFinite(source.ok_count) ? source.ok_count : 0,
    error_count: Number.isFinite(source.error_count) ? source.error_count : 0,
    rounds_used: Number.isFinite(source.rounds_used) ? source.rounds_used : 0,
    stopped_reason: normalizeDebugTraceIdentifier(source.stopped_reason || ""),
    tool_names: Array.isArray(source.tool_names)
      ? source.tool_names.slice(0, 16).map((name) => normalizeDebugTraceIdentifier(String(name || ""))).filter(Boolean)
      : [],
    calls: Array.isArray(source.calls)
      ? source.calls.slice(0, 48).map(projectDebugTraceToolCall).filter(Boolean)
      : [],
    error_samples: Array.isArray(source.error_samples)
      ? source.error_samples.slice(0, 8).map(projectDebugTraceToolErrorSample).filter(Boolean)
      : [],
    repair_attempts: Number.isFinite(source.repair_attempts) ? source.repair_attempts : 0,
  };
}

function projectDebugTraceToolCall(call = {}) {
  const source = call && typeof call === "object" && !Array.isArray(call) ? call : {};
  const name = normalizeDebugTraceIdentifier(source.name || "");
  if (!name) return null;
  return sanitizeDebugTraceValue({
    id: normalizeDebugTraceIdentifier(source.id || ""),
    name,
    round: Number.isFinite(source.round) ? source.round : undefined,
    index: Number.isFinite(source.index) ? source.index : undefined,
    permission: normalizeDebugTraceIdentifier(source.permission || ""),
    permission_decision: normalizeDebugTraceIdentifier(source.permission_decision || ""),
    interface_mode: normalizeDebugTraceIdentifier(source.interface_mode || ""),
    model_surface: projectDebugTraceModelSurface(source.model_surface),
    runtime_translation: projectDebugTraceRuntimeTranslation(source.runtime_translation),
    ok: Boolean(source.ok),
    error_code: normalizeDebugTraceIdentifier(source.error_code || ""),
    error_retryable: Boolean(source.error_retryable ?? source.retryable),
    error_status: normalizeDebugTraceIdentifier(String(source.error_status || "")),
    args_summary: projectDebugTraceArgsSummary(source.args_summary),
    validation: projectDebugTraceValidation(source.validation),
    retry_observation: projectDebugTraceRetry(source.retry_observation),
    failure_fingerprint: normalizeDebugTraceIdentifier(source.failure_fingerprint || ""),
    write_receipt: projectDebugTraceWriteReceipt(source.write_receipt),
    result_summary: source.result_summary,
  });
}

function projectDebugTraceModelSurface(surface = null) {
  if (!surface || typeof surface !== "object" || Array.isArray(surface)) return null;
  return sanitizeDebugTraceValue({
    action_id: normalizeDebugTraceIdentifier(surface.action_id || ""),
    tool_name: normalizeDebugTraceIdentifier(surface.tool_name || ""),
    result: normalizeDebugTraceIdentifier(surface.result || ""),
    error_code: normalizeDebugTraceIdentifier(surface.error_code || ""),
  });
}

function projectDebugTraceRuntimeTranslation(translation = null) {
  if (!translation || typeof translation !== "object" || Array.isArray(translation)) return null;
  return sanitizeDebugTraceValue({
    skill_id: normalizeDebugTraceIdentifier(translation.skill_id || ""),
    module_ref: normalizeDebugTraceIdentifier(translation.module_ref || ""),
    target_field: normalizeDebugTraceIdentifier(translation.target_field || ""),
    archetype: normalizeDebugTraceIdentifier(translation.archetype || ""),
    named_policy: normalizeDebugTraceIdentifier(translation.named_policy || ""),
    named_transition: normalizeDebugTraceIdentifier(translation.named_transition || ""),
    validation_stage: normalizeDebugTraceIdentifier(translation.validation_stage || ""),
    internal_error_code: normalizeDebugTraceIdentifier(translation.internal_error_code || ""),
    translation_attempt: Number.isFinite(translation.translation_attempt)
      ? translation.translation_attempt
      : undefined,
    operation_types: projectDebugTraceStringList(translation.operation_types, 8),
    translated_field_ids: projectDebugTraceStringList(translation.translated_field_ids, 16),
    runtime_sources: projectDebugTraceStringList(translation.runtime_sources, 16),
  });
}

function projectDebugTraceArgsSummary(summary = {}) {
  const source = summary && typeof summary === "object" && !Array.isArray(summary) ? summary : {};
  return sanitizeDebugTraceValue({
    parsed: Boolean(source.parsed),
    chars: normalizeDebugTraceNumber(source.chars),
    key_count: normalizeDebugTraceNumber(source.key_count),
    top_level_keys: projectDebugTraceStringList(source.top_level_keys, 24),
    top_level_shape: Array.isArray(source.top_level_shape) ? source.top_level_shape.slice(0, 24).map((item) => ({
      key: normalizeDebugTraceIdentifier(item?.key || ""),
      kind: normalizeDebugTraceIdentifier(item?.kind || ""),
    })) : [],
    safe_args: source.safe_args,
  });
}

function projectDebugTraceValidation(validation = {}) {
  const source = validation && typeof validation === "object" && !Array.isArray(validation) ? validation : {};
  return {
    stage: normalizeDebugTraceIdentifier(source.stage || ""),
    ok: typeof source.ok === "boolean" ? source.ok : undefined,
    error_code: normalizeDebugTraceIdentifier(source.error_code || ""),
    retryable: Boolean(source.retryable),
    reason_code: normalizeDebugTraceIdentifier(source.reason_code || ""),
    invalid_arg_path: normalizeDebugTraceArgumentPath(source.invalid_arg_path),
    expected_kind: normalizeDebugTraceIdentifier(source.expected_kind || ""),
    actual_kind: normalizeDebugTraceIdentifier(source.actual_kind || ""),
    field_id: normalizeDebugTraceIdentifier(source.field_id || ""),
    minimum: Number.isFinite(source.minimum) ? source.minimum : undefined,
    maximum: Number.isFinite(source.maximum) ? source.maximum : undefined,
    max_items: Number.isFinite(source.max_items) ? source.max_items : undefined,
    max_chars: Number.isFinite(source.max_chars) ? source.max_chars : undefined,
  };
}

function projectDebugTracePlayerTurn(playerTurn = {}) {
  const source = playerTurn && typeof playerTurn === "object" && !Array.isArray(playerTurn) ? playerTurn : {};
  return {
    counted: Boolean(source.counted),
    recorded: Boolean(source.recorded),
    turn: Number.isFinite(source.turn) ? source.turn : null,
    state_version: Number.isFinite(source.state_version) ? source.state_version : null,
  };
}

function projectDebugTraceProjection(projection = {}) {
  const source = projection && typeof projection === "object" && !Array.isArray(projection) ? projection : {};
  return {
    warning_count: normalizeDebugTraceNumber(source.warning_count),
    withheld_rejected_details: Boolean(source.withheld_rejected_details),
  };
}

function projectDebugTraceRetry(retry = {}) {
  const source = retry && typeof retry === "object" && !Array.isArray(retry) ? retry : {};
  return {
    attempt: normalizeDebugTraceNumber(source.attempt),
    previous_failure_same_tool: Boolean(source.previous_failure_same_tool),
    same_failure_as_previous: Boolean(source.same_failure_as_previous),
    same_safe_shape_as_previous: Boolean(source.same_safe_shape_as_previous),
  };
}

function projectDebugTraceWriteReceipt(receipt = null) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
  return {
    attempted: Boolean(receipt.attempted),
    committed: Boolean(receipt.committed),
    atomic: typeof receipt.atomic === "boolean" ? receipt.atomic : undefined,
    state_changed: Boolean(receipt.state_changed),
    expected_revision: Number.isFinite(receipt.expected_revision) ? receipt.expected_revision : undefined,
    before_revision: Number.isFinite(receipt.before_revision) ? receipt.before_revision : undefined,
    after_revision: Number.isFinite(receipt.after_revision) ? receipt.after_revision : undefined,
    operation_count: normalizeDebugTraceNumber(receipt.operation_count),
    updated_field_ids: projectDebugTraceStringList(receipt.updated_field_ids, 16),
  };
}

function normalizeDebugTraceArgumentPath(value) {
  const text = String(value || "").trim();
  return /^\/(?:[A-Za-z_][A-Za-z0-9_]*|\d+)(?:\/(?:[A-Za-z_][A-Za-z0-9_]*|\d+))*$|^\/$/.test(text)
    ? text.slice(0, 240)
    : null;
}

function projectDebugTraceDeveloperSummary(summary = {}) {
  const source = summary && typeof summary === "object" && !Array.isArray(summary) ? summary : {};
  return {
    adventure: source.adventure && typeof source.adventure === "object" ? {
      adventure_id: normalizeDebugTraceIdentifier(source.adventure.adventure_id || ""),
      content_profile_id: normalizeDebugTraceIdentifier(source.adventure.content_profile_id || ""),
      snapshot_lock_id: normalizeDebugTraceIdentifier(source.adventure.snapshot_lock_id || ""),
      snapshot_hash: normalizeDebugTraceIdentifier(source.adventure.snapshot_hash || ""),
    } : null,
    context_items: Array.isArray(source.context_items)
      ? source.context_items.slice(0, 40).map((item) => sanitizeDebugTraceValue(item))
      : [],
    retrieved_content: source.retrieved_content && typeof source.retrieved_content === "object"
      ? sanitizeDebugTraceValue(source.retrieved_content)
      : null,
    tool_calls: Array.isArray(source.tool_calls)
      ? source.tool_calls.slice(0, 48).map(projectDebugTraceToolCall).filter(Boolean)
      : [],
    route_hints: Array.isArray(source.route_hints)
      ? source.route_hints.slice(0, 16).map(projectDebugTraceRouteHint).filter(Boolean)
      : [],
    allowed_tools: projectDebugTraceStringList(source.allowed_tools, 40),
    routed_tools: projectDebugTraceStringList(source.routed_tools, 40),
    skill_reads: Array.isArray(source.skill_reads)
      ? source.skill_reads.slice(0, 16).map(projectDebugTraceSkillRead).filter(Boolean)
      : [],
    template_reads: Array.isArray(source.template_reads)
      ? source.template_reads.slice(0, 16).map(projectDebugTraceTemplateRead).filter(Boolean)
      : [],
    save_writes: Array.isArray(source.save_writes)
      ? source.save_writes.slice(0, 16).map(projectDebugTraceSaveWrite).filter(Boolean)
      : [],
    tool_failures: Array.isArray(source.tool_failures)
      ? source.tool_failures.slice(0, 12).map(projectDebugTraceToolFailure).filter(Boolean)
      : [],
  };
}

function projectDebugTraceRouteHint(hint = {}) {
  const source = hint && typeof hint === "object" && !Array.isArray(hint) ? hint : {};
  const tool = normalizeDebugTraceIdentifier(source.tool || "");
  const reason = normalizeDebugTraceIdentifier(source.reason || "");
  if (!tool && !reason) {
    return null;
  }
  return { tool, reason };
}

function projectDebugTraceSkillRead(read = {}) {
  const source = read && typeof read === "object" && !Array.isArray(read) ? read : {};
  const id = normalizeDebugTraceIdentifier(source.id || "");
  const errorCode = normalizeDebugTraceIdentifier(source.error_code || "");
  if (!id && !errorCode) {
    return null;
  }
  return {
    id,
    ok: Boolean(source.ok),
    round: Number.isFinite(source.round) ? source.round : undefined,
    source: normalizeDebugTraceIdentifier(source.source || ""),
    error_code: errorCode,
  };
}

function projectDebugTraceTemplateRead(read = {}) {
  const source = read && typeof read === "object" && !Array.isArray(read) ? read : {};
  const skillId = normalizeDebugTraceIdentifier(source.skill_id || "");
  const templateId = normalizeDebugTraceIdentifier(source.template_id || "");
  const errorCode = normalizeDebugTraceIdentifier(source.error_code || "");
  if (!skillId && !templateId && !errorCode) {
    return null;
  }
  return {
    skill_id: skillId,
    template_id: templateId,
    ok: Boolean(source.ok),
    round: Number.isFinite(source.round) ? source.round : undefined,
    source: normalizeDebugTraceIdentifier(source.source || ""),
    error_code: errorCode,
  };
}

function projectDebugTraceSaveWrite(write = {}) {
  const source = write && typeof write === "object" && !Array.isArray(write) ? write : {};
  const tool = normalizeDebugTraceIdentifier(source.tool || "");
  const recordType = normalizeDebugTraceIdentifier(source.record_type || "");
  const recordId = normalizeDebugTraceIdentifier(source.record_id || "");
  const errorCode = normalizeDebugTraceIdentifier(source.error_code || "");
  if (!tool && !recordType && !recordId && !errorCode) {
    return null;
  }
  return {
    tool,
    record_type: recordType,
    record_id: recordId,
    action: normalizeDebugTraceIdentifier(source.action || ""),
    patch_targets: projectDebugTraceStringList(source.patch_targets, 12),
    ok: Boolean(source.ok),
    round: Number.isFinite(source.round) ? source.round : undefined,
    error_code: errorCode,
  };
}

function projectDebugTraceToolFailure(failure = {}) {
  const source = failure && typeof failure === "object" && !Array.isArray(failure) ? failure : {};
  const tool = normalizeDebugTraceIdentifier(source.tool || "");
  const code = normalizeDebugTraceIdentifier(source.code || "");
  if (!tool && !code) {
    return null;
  }
  return {
    tool: tool || "unknown",
    code: code || "UNKNOWN_TOOL_ERROR",
    round: Number.isFinite(source.round) ? source.round : undefined,
    retryable: Boolean(source.retryable),
    status: normalizeDebugTraceIdentifier(source.status || ""),
    permission: normalizeDebugTraceIdentifier(source.permission || ""),
    permission_decision: normalizeDebugTraceIdentifier(source.permission_decision || ""),
  };
}

function projectDebugTraceStringList(values = [], limit = 32) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .slice(0, limit)
    .map((value) => normalizeDebugTraceIdentifier(String(value || "")))
    .filter(Boolean);
}

function projectDebugTraceToolErrorSample(sample = {}) {
  const source = sample && typeof sample === "object" && !Array.isArray(sample) ? sample : {};
  const name = normalizeDebugTraceIdentifier(source.name || "");
  const code = normalizeDebugTraceIdentifier(source.code || "");
  if (!name && !code) {
    return null;
  }
  return {
    name: name || "unknown",
    code: code || "UNKNOWN_TOOL_ERROR",
    round: Number.isFinite(source.round) ? source.round : undefined,
    index: Number.isFinite(source.index) ? source.index : undefined,
    retryable: Boolean(source.retryable),
    status: typeof source.status === "string" || Number.isFinite(source.status) ? source.status : null,
    permission: normalizeDebugTraceIdentifier(source.permission || ""),
    permission_decision: normalizeDebugTraceIdentifier(source.permission_decision || ""),
    interface_mode: normalizeDebugTraceIdentifier(source.interface_mode || ""),
    model_surface: projectDebugTraceModelSurface(source.model_surface),
    runtime_translation: projectDebugTraceRuntimeTranslation(source.runtime_translation),
    validation: projectDebugTraceValidation(source.validation),
    retry_observation: projectDebugTraceRetry(source.retry_observation),
    failure_fingerprint: normalizeDebugTraceIdentifier(source.failure_fingerprint || ""),
    args_summary: projectDebugTraceArgsSummary(source.args_summary),
    write_receipt: projectDebugTraceWriteReceipt(source.write_receipt),
  };
}

function projectDebugTraceParser(parser = {}) {
  const source = parser && typeof parser === "object" ? parser : {};
  return {
    parser_mode: normalizeDebugTraceIdentifier(source.parser_mode || ""),
    parse_error: Boolean(source.parse_error),
    non_contract_response: Boolean(source.non_contract_response),
    side_channel_error_code: normalizeDebugTraceIdentifier(
      source.side_channel_error_code || source.side_channel_error?.code || ""
    ),
    candidate_count: Number.isFinite(source.candidate_count) ? source.candidate_count : 0,
    soft_write_count: Number.isFinite(source.soft_write_count) ? source.soft_write_count : 0,
    memory_note_count: Number.isFinite(source.memory_note_count) ? source.memory_note_count : 0,
  };
}

function projectDebugTraceValidator(validator = {}) {
  const source = validator && typeof validator === "object" ? validator : {};
  return {
    accepted_count: Number.isFinite(source.accepted_count) ? source.accepted_count : 0,
    rejected_count: Number.isFinite(source.rejected_count) ? source.rejected_count : 0,
    rejected_codes: Array.isArray(source.rejected_codes)
      ? source.rejected_codes.slice(0, 8).map((code) => normalizeDebugTraceIdentifier(String(code || ""))).filter(Boolean)
      : [],
  };
}

function projectDebugTraceCommit(commit = {}) {
  const source = commit && typeof commit === "object" ? commit : {};
  return {
    committed_count: Number.isFinite(source.committed_count) ? source.committed_count : 0,
    uncommitted_count: Number.isFinite(source.uncommitted_count) ? source.uncommitted_count : 0,
    commit_skipped: Boolean(source.commit_skipped),
    skip_reason: normalizeDebugTraceIdentifier(source.skip_reason || ""),
  };
}

function projectDebugTraceMemory(memory = {}) {
  const source = memory && typeof memory === "object" ? memory : {};
  const compaction = source.compaction && typeof source.compaction === "object" ? source.compaction : null;
  const chapterSave = source.chapter_save && typeof source.chapter_save === "object" ? source.chapter_save : null;
  return {
    audit_write_count: Number.isFinite(source.audit_write_count) ? source.audit_write_count : 0,
    audit_error_code: normalizeDebugTraceIdentifier(source.audit_error_code || ""),
    compaction: compaction
      ? {
          checked: Boolean(compaction.checked),
          compacted: Boolean(compaction.compacted),
          skipped: Boolean(compaction.skipped),
          reason: normalizeDebugTraceIdentifier(compaction.reason || ""),
          source_records: Number.isFinite(compaction.source_records) ? compaction.source_records : 0,
          full_context_estimate: Number.isFinite(compaction.full_context_estimate) ? compaction.full_context_estimate : 0,
          budget: projectDebugTraceCompactionBudget(compaction.budget),
          metrics: projectCompactionMetrics(compaction.metrics),
      }
      : null,
    chapter_save: chapterSave
      ? {
          generated: Boolean(chapterSave.generated),
          reason: normalizeDebugTraceIdentifier(chapterSave.reason || ""),
          source_range: projectDebugTraceRange(chapterSave.source_range),
        }
      : null,
    consolidation: projectMemoryConsolidation(source.consolidation),
  };
}

function projectDebugTraceCompactionBudget(budget = {}) {
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
    return null;
  }
  return {
    mode: normalizeDebugTraceIdentifier(budget.mode || ""),
    source: normalizeDebugTraceIdentifier(budget.source || ""),
    warning_threshold: Number.isFinite(budget.warning_threshold) ? budget.warning_threshold : 0,
    threshold: Number.isFinite(budget.threshold) ? budget.threshold : 0,
    hard_threshold: Number.isFinite(budget.hard_threshold) ? budget.hard_threshold : 0,
    emergency_threshold: Number.isFinite(budget.emergency_threshold) ? budget.emergency_threshold : 0,
    full_context_estimate: Number.isFinite(budget.full_context_estimate) ? budget.full_context_estimate : 0,
    warning_ratio: Number.isFinite(budget.warning_ratio) ? budget.warning_ratio : null,
    trigger_ratio: Number.isFinite(budget.trigger_ratio) ? budget.trigger_ratio : null,
    hard_trigger_ratio: Number.isFinite(budget.hard_trigger_ratio) ? budget.hard_trigger_ratio : null,
    emergency_trigger_ratio: Number.isFinite(budget.emergency_trigger_ratio) ? budget.emergency_trigger_ratio : null,
    recent_turns_keep: Number.isFinite(budget.recent_turns_keep) ? budget.recent_turns_keep : 0,
  };
}

function createDebugTraceExport(result = {}) {
  const exportedAt = new Date().toISOString();
  const entries = Array.isArray(result.entries) ? result.entries : [];
  const payload = {
    schema_version: "grey-crow-debug-export-v2",
    exported_at: exportedAt,
    save_id: normalizeDebugTraceIdentifier(result.save_id || activeSaveId || ""),
    scope: projectDebugTraceScope(result.scope, result.save_id || activeSaveId || ""),
    trace_schema_version: entries.findLast?.((entry) => entry?.trace_schema_version)?.trace_schema_version || "unknown",
    build: createDebugTraceBuildInfo(),
    selection: projectDebugTraceSelection(result.selection, entries.length),
    summary: createDebugTraceSummary(entries),
    entry_count: entries.length,
    entries,
    not_model_visible: true,
  };
  const safePayload = sanitizeDebugTraceValue(payload);
  safePayload.execution = projectDebugExecution(result.execution);
  return {
    filename: `grey-crow-debug-${payload.save_id || "save"}-${exportedAt.replace(/[:.]/g, "-")}.json`,
    content: JSON.stringify(safePayload, null, 2),
    mimeType: "application/json",
    not_model_visible: true,
  };
}

function createDebugTraceBuildInfo() {
  const appVersion = normalizeDebugTraceIdentifier(app.getVersion?.() || "unknown");
  const identity = typeof desktopBuildIdentity === "object" && desktopBuildIdentity;
  return {
    app_version: identity?.appVersion || appVersion,
    build_id: identity?.buildId || "unknown",
    source_checkpoint: identity?.sourceFingerprint || "unknown",
    runtime_mode: app.isPackaged ? "packaged" : "development",
    build_mode: app.isPackaged ? "packaged" : "development",
    platform: normalizeDebugTraceIdentifier(process.platform),
    arch: normalizeDebugTraceIdentifier(process.arch),
    electron_version: normalizeDebugTraceIdentifier(process.versions.electron || ""),
    node_version: normalizeDebugTraceIdentifier(process.versions.node || ""),
  };
}

function createDebugTraceSummary(entries = []) {
  return summarizeDebugTraceEntries(entries, normalizeDebugTraceIdentifier);
}

function normalizeDebugTraceIdentifier(value) {
  if (typeof value !== "string") {
    return "";
  }
  return redactSecrets(value).replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 128);
}

function normalizeDebugTraceNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.floor(number));
}

function sanitizeDebugTraceValue(value) {
  try {
    return stripSensitiveDebugKeys(JSON.parse(redactSecrets(JSON.stringify(value ?? null))));
  } catch (_error) {
    return {};
  }
}

function stripSensitiveDebugKeys(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 256).map(stripSensitiveDebugKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenDebugTraceKey(key)) {
      continue;
    }
    out[key] = stripSensitiveDebugKeys(child);
  }
  return out;
}

function isForbiddenDebugTraceKey(key) {
  if (["invalid_arg_path", "schema_path"].includes(key)) {
    return false;
  }
  return /api[_-]?key|authorization|cookie|secret|password|raw|prompt|messages|cause|body|path|root|dataRoot|settingsPath|savesRoot|providerCheckRoot|secretValue|getSecret/i.test(key);
}

function projectTtsResult(result = {}) {
  return {
    ok: Boolean(result.ok),
    utteranceId: normalizeProjectedIdentifier(result.utteranceId, 80),
    segmentId: normalizeProjectedIdentifier(result.segmentId, 80),
    segmentIndex: Number.isInteger(result.segmentIndex) && result.segmentIndex >= 0
      ? result.segmentIndex
      : null,
    segmentCount: Number.isInteger(result.segmentCount) && result.segmentCount >= 1
      ? result.segmentCount
      : null,
    segmentKind: ["lead-1", "lead-2", "tail"].includes(result.segmentKind)
      ? result.segmentKind
      : null,
    hasMore: Boolean(result.hasMore),
    provider: typeof result.provider === "string" ? result.provider : null,
    voiceId: typeof result.voiceId === "string" ? result.voiceId : null,
    cacheHit: Boolean(result.cacheHit),
    mimeType: typeof result.mimeType === "string" ? result.mimeType : "audio/mpeg",
    dataUrl: typeof result.dataUrl === "string" && result.dataUrl.startsWith("data:audio/")
      ? result.dataUrl
      : null,
    not_model_visible: true,
  };
}

function projectTtsCacheStatus(result = {}) {
  return {
    utteranceCount: Number.isInteger(result.utteranceCount) && result.utteranceCount >= 0
      ? result.utteranceCount
      : 0,
    bytes: Number.isFinite(result.bytes) && result.bytes >= 0 ? Math.floor(result.bytes) : 0,
    utteranceLimit: [10, 20, 40].includes(result.utteranceLimit) ? result.utteranceLimit : 20,
    byteLimit: Number.isFinite(result.byteLimit) && result.byteLimit >= 0
      ? Math.floor(result.byteLimit)
      : 500 * 1024 * 1024,
    not_model_visible: true,
  };
}

function normalizeProjectedIdentifier(value, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9-]+$/.test(text) ? text.slice(0, maxLength) : null;
}




function assertTrustedSender(event) {
  const frameUrl = event.senderFrame?.url || event.sender?.getURL?.();
  if (!trustedRendererUrl || frameUrl !== trustedRendererUrl) {
    throw new Error("Untrusted renderer.");
  }
}

function normalizeApiKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePlayerText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, MAX_PLAYER_INPUT_CHARS);
}

function normalizeTtsText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return redactSecrets(stripTtsInternalBlocks(value))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/(?:朗读本段|刷新|关闭章节日志|关闭调试面板|关闭上下文维护)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTtsInternalBlocks(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalizedValue = normalizeLiteralNewlines(value);
  const withoutFencedInternals = normalizedValue.replace(/```(?:json|JSON)?\s*[\s\S]*?```/g, (block) =>
    TTS_INTERNAL_SECTION_PATTERN.test(block) ? "" : block
  );
  const lines = withoutFencedInternals.split(/\r?\n/);
  const kept = [];
  let droppingInternalBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      droppingInternalBlock = false;
      if (kept.length && kept[kept.length - 1] !== "") {
        kept.push("");
      }
      continue;
    }

    if (TTS_INTERNAL_SECTION_START_PATTERN.test(trimmed) || TTS_INTERNAL_SECTION_PATTERN.test(trimmed)) {
      droppingInternalBlock = true;
      continue;
    }

    if (droppingInternalBlock && (TTS_STRUCTURED_LINE_PATTERN.test(trimmed) || /^[-*]\s+/.test(trimmed))) {
      continue;
    }

    droppingInternalBlock = false;
    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeLiteralNewlines(value) {
  return String(value || "").replace(/\\r\\n|\\n|\\r/g, "\n");
}

function createSessionId(saveId) {
  return (`${saveId}_${desktopSessionGeneration}`);
}

function getAppDataLayout() {
  if (!appDataLayout) {
    appDataLayout = createAppDataLayout({
      userDataPath: app.getPath("userData"),
      tempPath: app.getPath("temp"),
      env: process.env,
    });
  }
  return appDataLayout;
}

function ensureDesktopAppData() {
  if (!appDataStatus) {
    appDataStatus = ensureAppDataLayout(getAppDataLayout());
  }
  return appDataStatus;
}

function prepareDesktopAppData() {
  try {
    return ensureDesktopAppData();
  } catch (error) {
    appDataStatus = projectAppDataFailureStatus(error);
    return appDataStatus;
  }
}

function getSafeAppDataStatus() {
  try {
    if (appDataStatus) {
      return projectAppDataStatus(getAppDataLayout(), appDataStatus);
    }
    return ensureDesktopAppData();
  } catch (error) {
    return projectAppDataFailureStatus(error);
  }
}

function getCredentialStore() {
  if (!credentialStore) {
    credentialStore = createCredentialStore({
      platform: process.platform,
      safeStorage,
      secureStorageAvailable: inspectSecureStorage(safeStorage),
      credentialPath: path.join(getDataRoot(), "credentials", "provider.enc.json"),
    });
  }
  return credentialStore;
}

function createFailure(code, message, retryable, params = {}) {
  return {
    ok: false,
    error: {
      code,
      params: normalizeUiErrorParams(params),
      message,
      retryable: Boolean(retryable),
    },
    status: createStatus(),
  };
}


function createFailureFromError(error) {
  const normalized = normalizeError(error, {
    code: "INTERNAL_ERROR",
    message: "桌面壳内部错误。",
    retryable: false,
  });
  const failure = createFailure(
    normalizeUiErrorCode(normalized.code),
    normalizeUiErrorMessage(normalized.message, normalized.code),
    Boolean(normalized.retryable),
    error?.params
  );
  if (error?.coverage && typeof error.coverage === "object") {
    failure.error.coverage = JSON.parse(JSON.stringify(error.coverage));
  }
  return failure;
}

function normalizeUiErrorCode(code) {
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "INTERNAL_ERROR";
}

function normalizeUiErrorParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};
  const projected = {};
  for (const [key, value] of Object.entries(params).slice(0, 16)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) continue;
    if (typeof value === "string") projected[key] = redactSecrets(value).slice(0, 240);
    else if (typeof value === "number" && Number.isFinite(value)) projected[key] = value;
    else if (typeof value === "boolean" || value === null) projected[key] = value;
  }
  return projected;
}

function normalizeUiErrorMessage(message, code = "") {
  const known = {
    STORE_BUSY: "存档暂时繁忙，请稍后重试。",
    UPSTREAM_AUTH_ERROR: "API Key 鉴权失败，请检查 Key 是否属于当前连接。",
    UPSTREAM_ACCESS_DENIED: "模型服务拒绝了这个连接的访问；这不一定是 API Key 问题。",
    UPSTREAM_MODEL_NOT_FOUND: "没有找到填写的 Model ID，请按供应商文档核对。",
    MODEL_CAPABILITY_UNSUPPORTED: "该模型没有完成灰鸦所需的两步工具调用，暂时不能用于正式游戏。",
    API_TIMEOUT: "模型连接测试超时，请稍后重试。",
    PROVIDER_FAILED: "模型连接发生网络错误，请检查网络和 API 地址。",
    INVALID_PROVIDER_CONFIG: "模型连接配置无效；只允许公共 HTTPS API 地址。",
    REQUEST_ABORTED: "模型连接测试已取消。",
    KOKORO_MODEL_MISSING: "高质量 Kokoro 中文语音资源尚未安装完整，请切换其他语音或重新准备本地语音包。",
    KOKORO_WORKER_READY_TIMEOUT: "高质量 Kokoro 首次加载超时，请稍后重试；文字游戏不会受到影响。",
    KOKORO_CHUNK_TIMEOUT: "本段语音生成超时，请缩短朗读内容或稍后重试。",
    KOKORO_QUEUE_FULL: "本地朗读队列已满，请等待当前语音完成。",
    KOKORO_CIRCUIT_OPEN: "本地语音连续失败，已暂时停止重启，请稍后重试。",
    WINDOW_MODE_UNAVAILABLE: "当前显示器工作区无法完整容纳这个窗口档位，请选择更小的窗口或全屏。",
    CONTENT_PACK_EXISTS: "同名内容包已经存在。请先删除旧内容包，或使用新的 Pack ID。",
    CONTENT_PACK_NOT_FOUND: "没有找到该内容包，请刷新内容库后重试。",
    CONTENT_BUILT_IN_READ_ONLY: "内置内容包是只读资源，不能删除或直接编辑。请先克隆。",
    CONTENT_IMPORT_DISABLED: "首个公开版本尚未开放第三方内容导入。",
    CONTENT_PACK_QUARANTINED: "该历史导入内容已隔离，只能导出或删除。",
    CONTENT_PACK_READ_ONLY: "该内容包不属于玩家本地副本，不能直接编辑。",
    CONTENT_ITEM_NOT_FOUND: "没有找到该内容项，请刷新内容库后重试。",
    CONTENT_EDIT_STALE: "内容包已在其他操作中更新。请重新打开内容项，再保存修改。",
    CONTENT_EDIT_MARKDOWN_INVALID: "Markdown 正文为空、过长或包含不支持的控制字符。",
    CONTENT_EDIT_TEMPLATES_INVALID: "Skill 模板不完整，请重新打开内容项后再保存。",
    CONTENT_EDIT_READ_SCOPE_INVALID: "Skill 包含不允许的读取范围。",
    CONTENT_EDIT_WRITE_SCOPE_INVALID: "Skill 包含不允许的写入范围。",
    CONTENT_EDIT_LANGUAGE_INVALID: "内容语言格式无效，例如应使用 zh-CN 或 en-US。",
    CONTENT_EXPORT_EXISTS: "导出位置中已经存在同名文件夹，请更换位置或移走旧文件夹。",
    CONTENT_PACK_ID_INVALID: "Pack ID 只能使用小写英文字母、数字和短横线，并以字母开头。",
    CONTENT_LIBRARY_REGISTRY_INVALID: "内容库索引损坏，暂时不能修改内容包。",
    PLAYER_PROFILE_SECRET_REJECTED: "玩家档案不能包含 API Key 或其他凭据。",
    PLAYER_PROFILE_FIELD_FORBIDDEN: "玩家档案包含不可编辑字段，请刷新后重试。",
    CONTRACT_INVALID: "填写内容不符合灰鸦内容合同，请检查长度、语言和必填字段。",
  };
  if (known[code]) {
    return known[code];
  }
  const redacted = redactSecrets(typeof message === "string" && message.trim() ? message : "桌面壳内部错误。");
  if (/\[local-path-redacted\]/i.test(redacted) || /ENOENT|EACCES|EPERM|mkdir|open|spawn/i.test(redacted)) {
    return "桌面壳访问本地应用数据失败，请检查安装位置或文件权限。";
  }
  return redacted;
}

const lock = app.requestSingleInstanceLock();

if (!lock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    prepareDesktopAppData();
    let diagnosticRoot = null;
    try { diagnosticRoot = getDataRoot(); } catch {}
    desktopBuildIdentity = createBuildIdentity({ appRoot: __dirname, runtimeRoot: RUNTIME_ROOT, packaged: app.isPackaged });
    problemRecorder = createProblemRecorder({ root: diagnosticRoot, buildId: desktopBuildIdentity.buildId,
      codes: [...Object.values(PROVIDER_DIAGNOSTIC_CODES), ...EXECUTION_ACTION_CODES] });
    problemRecorder.start();
    process.on("uncaughtExceptionMonitor", () => { problemRecorder.record("application", "MAIN_PROCESS_ERROR"); });
    app.on("child-process-gone", () => { problemRecorder.record("application", "CHILD_PROCESS_GONE"); });
    restoreStoredCredentialSession();
    registerIpcHandlers();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if ((!sessionShutdownStarted) && process.platform === "darwin") {
      resetRuntimeSession("window_all_closed");
    } else
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {

    if (!sessionShutdownComplete) {
      event.preventDefault();
      if (sessionShutdownStarted) return;
      sessionShutdownStarted = true;
      // Close first: unfinished actions are interrupted, not player cancellations.
      const closing = activeBridge ? activeBridge.close() : Promise.resolve();
      activeBridge = null;
      runtimeOperations.abortAll("before_quit");
      Promise.allSettled([sessionDisposal, closing, disposeTtsService(), speechInput?.dispose()]).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") console.warn("Grey Crow shutdown failed", result.reason?.code || "SESSION_CLOSE_FAILED");
        }
        sessionShutdownComplete = true;
        app.quit();
      });
      return;
    }
    runtimeOperations.abortAll("before_quit");
    void disposeTtsService();
    problemRecorder?.close();
  });
}
