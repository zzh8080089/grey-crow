"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const RUNTIME_ROOT = resolveRuntimeRoot();
const {
  DEFAULT_GAME_LOCALE,
  getLocaleRegistry,
  normalizeStoredPreferredLocale,
} = require(path.join(RUNTIME_ROOT, "engine/localization"));
const {
  CUSTOM_CONTEXT_WINDOW_DEFAULT,
  CUSTOM_CONTEXT_WINDOW_MAX,
  CUSTOM_PROVIDER_ID,
  getCustomConnection,
  getModelHelpCatalog,
  normalizeCustomConnections,
} = require("./model-connections");
const {
  DEFAULT_WINDOW_MODE,
  listWindowModeSpecs,
  normalizeWindowMode,
} = require("./window-modes");
const {
  DEFAULT_SPEECH_INPUT_SETTINGS,
  normalizeSpeechInputSettings,
  mergeSpeechInputSettings,
  getSpeechInputSettingsCatalog,
} = require("./speech-input/settings");

const SAVE_SETTINGS_SCHEMA_VERSION = "grey-crow-save-settings-v2";
const AUTO_SAVE_INTERVAL_PRESETS = Object.freeze([40, 60, 80, 100]);
const AUTO_SAVE_INTERVAL_MIN = 20;
const AUTO_SAVE_INTERVAL_MAX = 300;
const SKILL_INDEX_PATH = path.resolve(__dirname, "..", "..", "..", "content", "skills", "index.v1.json");
const SKILL_DISPLAY_LABELS = Object.freeze({
  "new-game": "新游戏",
  "delete-game": "删档",
  "game-state": "状态",
  "map": "地点",
  "entity-memory": "记忆",
  "game-save": "存档",
  "summarize": "摘要",
});
const NARRATION_LENGTH_PRESETS = Object.freeze({
  short: Object.freeze({ id: "short", label: "简短", targetChars: 200, paragraphGuide: "1 到 2 段" }),
  standard: Object.freeze({ id: "standard", label: "标准", targetChars: 300, paragraphGuide: "2 到 3 段" }),
  detailed: Object.freeze({ id: "detailed", label: "细节", targetChars: 400, paragraphGuide: "3 到 4 段" }),
  adaptive: Object.freeze({ id: "adaptive", label: "智能", targetChars: 600, paragraphGuide: "按场景自然收放；复杂行动最多约 800 字" }),
  custom: Object.freeze({ id: "custom", label: "自定义", targetChars: 300, paragraphGuide: "按目标长度推导" }),
});
const NARRATION_CUSTOM_TARGET_MIN = 120;
const NARRATION_CUSTOM_TARGET_MAX = 800;
const CONTEXT_WINDOW_PRESETS = Object.freeze([64_000, 128_000, 256_000, 512_000, 1_000_000]);
const CONTEXT_WINDOW_MIN = 64_000;
const CONTEXT_WINDOW_MAX = 1_000_000;
const AUTO_COMPACT_RATIO_PRESETS = Object.freeze([0.65, 0.75, 0.85]);
const AUTO_COMPACT_RATIO_MIN = 0.5;
const AUTO_COMPACT_RATIO_MAX = 0.85;
const EMERGENCY_GUARD_RATIO = 0.9;
const UI_TEXT_SIZE_PRESETS = Object.freeze(["small", "medium", "large"]);
const SUPPORTED_UI_TEXT_SIZES = new Set(UI_TEXT_SIZE_PRESETS);
const GAME_UI_LAYOUT_PRESETS = Object.freeze(["story-notebook-v1"]);
const SUPPORTED_GAME_UI_LAYOUTS = new Set(GAME_UI_LAYOUT_PRESETS);
const STORY_NOTEBOOK_THEME_PRESETS = Object.freeze(["light", "dark"]);
const SUPPORTED_STORY_NOTEBOOK_THEMES = new Set(STORY_NOTEBOOK_THEME_PRESETS);
const TTS_CACHE_UTTERANCE_PRESETS = Object.freeze([10, 20, 40]);
const SUPPORTED_TTS_CACHE_UTTERANCE_LIMITS = new Set(TTS_CACHE_UTTERANCE_PRESETS);
const TTS_CACHE_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_SETTINGS = Object.freeze({
  localization: Object.freeze({
    preferredLocale: DEFAULT_GAME_LOCALE,
  }),
  api: Object.freeze({
    provider: "deepseek",
    model: "deepseek-flash",
    connectionId: null,
    customConnections: Object.freeze([]),
  }),
  narration: Object.freeze({
    lengthPreset: "standard",
    customTargetChars: null,
  }),
  agent: Object.freeze({
    context: Object.freeze({
      configuredContextWindow: 256_000,
      autoCompactRatio: 0.75,
    }),
  }),
  ui: Object.freeze({
    narrationTextSize: "medium",
    sidePanelTextSize: "medium",
    windowMode: DEFAULT_WINDOW_MODE,
    gameUiLayout: "story-notebook-v1",
    storyNotebookTheme: "light",
  }),
  audio: Object.freeze({
    gameVolume: 80,
    input: DEFAULT_SPEECH_INPUT_SETTINGS,
    tts: Object.freeze({
      enabled: false,
      autoPlay: true,
      provider: "disabled",
      voiceId: "zm_010",
      rate: "+0%",
      pitch: "+0Hz",
      cacheUtteranceLimit: 20,
    }),
  }),
  developer: Object.freeze({
    debugPanelEnabled: false,
  }),
  save: Object.freeze({
    chapterLog: Object.freeze({
      onManualSave: true,
      onAutoSave: true,
      onCompaction: true,
      intervalTurns: 60,
    }),
  }),
});
const SETTINGS_CATALOG = deepFreeze({
  schemaVersion: "desktop-settings-runtime-v1",
  localization: getLocaleRegistry(),
  api: {
    providers: [
      {
        id: "deepseek",
        label: "DeepSeek",
        enabled: true,
        keyLabel: "DeepSeek API Key",
        credentialMode: "secure-storage",
        models: [
          {
            id: "deepseek-flash",
            label: "DeepSeek V4.1 Flash",
            enabled: true,
            contextLimit: 1_000_000,
            tier: "default",
            status: "experimental",
          },
          {
            id: "deepseek-v4-flash",
            label: "deepseek-v4-flash",
            aliasOf: "deepseek-flash",
            enabled: true,
            contextLimit: 1_000_000,
            status: "experimental",
          },
          {
            id: "deepseek-v4-pro",
            label: "deepseek-v4-pro（高级）",
            enabled: true,
            contextLimit: 1_000_000,
            tier: "advanced",
            status: "experimental",
          },
        ],
      },
      {
        id: "openai-compatible",
        label: "自定义连接",
        enabled: true,
        custom: true,
        keyLabel: "API Key",
        credentialMode: "secure-storage",
        models: [],
      },
    ],
  },
  narration: {
    lengthPresets: Object.values(NARRATION_LENGTH_PRESETS).map((preset) => ({ ...preset, enabled: true })),
    customTargetChars: {
      min: NARRATION_CUSTOM_TARGET_MIN,
      max: NARRATION_CUSTOM_TARGET_MAX,
      default: NARRATION_LENGTH_PRESETS.standard.targetChars,
    },
    defaultPreset: DEFAULT_SETTINGS.narration.lengthPreset,
  },
  agent: {
    context: {
      configuredContextWindowDefault: DEFAULT_SETTINGS.agent.context.configuredContextWindow,
      contextWindowPresets: [...CONTEXT_WINDOW_PRESETS],
      customContextWindow: {
        min: CONTEXT_WINDOW_MIN,
        max: CONTEXT_WINDOW_MAX,
        step: 1_000,
      },
      autoCompactRatioDefault: DEFAULT_SETTINGS.agent.context.autoCompactRatio,
      autoCompactRatioPresets: [...AUTO_COMPACT_RATIO_PRESETS],
      customAutoCompactRatio: {
        min: AUTO_COMPACT_RATIO_MIN,
        max: AUTO_COMPACT_RATIO_MAX,
        step: 0.01,
      },
      emergencyGuardRatio: EMERGENCY_GUARD_RATIO,
    },
  },
  ui: {
    textSizePresets: [
      { id: "small", label: "小" },
      { id: "medium", label: "中" },
      { id: "large", label: "大" },
    ],
    narrationTextSizeDefault: DEFAULT_SETTINGS.ui.narrationTextSize,
    sidePanelTextSizeDefault: DEFAULT_SETTINGS.ui.sidePanelTextSize,
    windowModeDefault: DEFAULT_SETTINGS.ui.windowMode,
    windowModes: listWindowModeSpecs(),
    gameUiLayoutDefault: DEFAULT_SETTINGS.ui.gameUiLayout,
    gameUiLayouts: [...GAME_UI_LAYOUT_PRESETS],
    storyNotebookThemeDefault: DEFAULT_SETTINGS.ui.storyNotebookTheme,
    storyNotebookThemes: [...STORY_NOTEBOOK_THEME_PRESETS],
  },
  audio: {
    input: getSpeechInputSettingsCatalog(),
    gameVolume: {
      min: 0,
      max: 100,
      default: DEFAULT_SETTINGS.audio.gameVolume,
    },
    ttsProviders: [
      {
        id: "disabled",
        label: "关闭",
        enabled: true,
      },
      {
        id: "kokoro-original-local",
        label: "Kokoro 高质量中文（实验）",
        enabled: true,
        experimental: true,
        online: false,
        bundled: false,
        supportsPitch: false,
        resourceNotice: "当前开发版使用私有本地运行时；首次朗读需要加载约 3.8 GB 内存。",
        voices: [
          { id: "zm_010", label: "中文男声 10（默认）" },
          { id: "zm_009", label: "中文男声 09" },
          { id: "zf_001", label: "中文女声 01" },
          { id: "zf_006", label: "中文女声 06" },
        ],
      },
      {
        id: "minimax",
        label: "MiniMax",
        enabled: false,
        disabledReason: "TTS 后端尚未接入桌面壳。",
      },
    ],
    ttsDefaults: {
      voiceId: DEFAULT_SETTINGS.audio.tts.voiceId,
      rate: DEFAULT_SETTINGS.audio.tts.rate,
      pitch: DEFAULT_SETTINGS.audio.tts.pitch,
      cacheUtteranceLimit: DEFAULT_SETTINGS.audio.tts.cacheUtteranceLimit,
      cacheUtterancePresets: [...TTS_CACHE_UTTERANCE_PRESETS],
      cacheMaxBytes: TTS_CACHE_MAX_BYTES,
    },
  },
  security: {
    credentialPersistence: "secure-storage",
    requiresRetestAfterRestart: false,
    persistentCredentialAvailable: true,
    secureStorageNotice: "测试成功后会使用系统安全凭据存储记住 API Key。",
    fallbackNotice: "如果系统安全存储不可用，Key 只在当前运行期有效，退出后需要重新输入。",
    secureStorage: {
      enabled: true,
      macOS: "Electron safeStorage / Keychain",
      Windows: "Electron safeStorage / DPAPI",
    },
  },
  developer: {
    debugPanel: {
      defaultEnabled: DEFAULT_SETTINGS.developer.debugPanelEnabled,
      maxRecentEntries: 20,
      playerVisibleByDefault: false,
    },
  },
  save: {
    schemaVersion: SAVE_SETTINGS_SCHEMA_VERSION,
    durableEveryTurn: true,
    chapterLog: {
      intervalDefault: DEFAULT_SETTINGS.save.chapterLog.intervalTurns,
      intervalPresets: [...AUTO_SAVE_INTERVAL_PRESETS],
      customInterval: {
        min: AUTO_SAVE_INTERVAL_MIN,
        max: AUTO_SAVE_INTERVAL_MAX,
      },
      onManualSaveDefault: DEFAULT_SETTINGS.save.chapterLog.onManualSave,
      onAutoSaveDefault: DEFAULT_SETTINGS.save.chapterLog.onAutoSave,
      onCompactionDefault: DEFAULT_SETTINGS.save.chapterLog.onCompaction,
    },
  },
});
const SUPPORTED_API_PROVIDERS = new Set(
  SETTINGS_CATALOG.api.providers.filter((provider) => provider.enabled).map((provider) => provider.id)
);
const SUPPORTED_TTS_PROVIDERS = new Set(
  SETTINGS_CATALOG.audio.ttsProviders.filter((provider) => provider.enabled).map((provider) => provider.id)
);
const SUPPORTED_NARRATION_PRESETS = new Set(Object.keys(NARRATION_LENGTH_PRESETS));

function createSettingsStore({ dataRoot, logger = null } = {}) {
  if (typeof dataRoot !== "string" || !dataRoot.trim()) {
    throw new Error("settings store requires dataRoot");
  }
  const settingsPath = path.join(dataRoot, "settings.json");
  const backupPath = `${settingsPath}.bak`;

  let cached = null;
  let persistenceState = createSettingsPersistenceState("ok", false);
  return {
    path: settingsPath,
    backupPath,
    load() {
      if (cached) {
        return cached;
      }
      try {
        cached = readNormalizedSettings(settingsPath);
        persistNormalizedSettingsMigration(settingsPath, cached, { dataRoot });
      } catch (error) {
        if (error?.code === "ENOENT") {
          cached = normalizeDesktopSettings(DEFAULT_SETTINGS);
          atomicWriteJson(settingsPath, cached, { dataRoot });
          return cached;
        }

        logger?.warn?.("Grey Crow desktop settings recovery started", error.message);
        try {
          cached = readNormalizedSettings(backupPath);
          atomicWriteJson(settingsPath, cached, { dataRoot });
          persistenceState = createSettingsPersistenceState("recovered_from_backup", true);
        } catch (backupError) {
          logger?.warn?.("Grey Crow desktop settings backup unavailable", backupError.message);
          cached = normalizeDesktopSettings(DEFAULT_SETTINGS);
          atomicWriteJson(settingsPath, cached, { dataRoot });
          persistenceState = createSettingsPersistenceState("reset_to_defaults", true);
        }
      }
      return cached;
    },
    save(settings) {
      const normalized = normalizeDesktopSettings(settings);
      fs.mkdirSync(dataRoot, { recursive: true });
      try {
        const previous = readNormalizedSettings(settingsPath);
        atomicWriteJson(backupPath, previous, { dataRoot });
      } catch (_error) {
        // Never rotate an unreadable current file over a known-good backup.
      }
      atomicWriteJson(settingsPath, normalized, { dataRoot });
      cached = normalized;
      return cached;
    },
    snapshot(settings = cached || this.load()) {
      return JSON.parse(JSON.stringify(settings));
    },
    status() {
      return { ...persistenceState };
    },
    consumeStatus() {
      const current = { ...persistenceState };
      if (persistenceState.noticeRequired) {
        persistenceState = createSettingsPersistenceState("ok", false);
      }
      return current;
    },
  };
}

function readNormalizedSettings(filePath) {
  return normalizeDesktopSettings(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function persistNormalizedSettingsMigration(filePath, normalized, { dataRoot }) {
  const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
    atomicWriteJson(filePath, normalized, { dataRoot });
  }
}

function atomicWriteJson(filePath, value, { dataRoot = path.dirname(filePath) } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  let fd = null;
  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
    fsyncDirectory(dataRoot);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_error) {
        // Best-effort cleanup after a failed atomic write.
      }
    }
    try {
      fs.unlinkSync(tempPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function fsyncDirectory(directoryPath) {
  let fd = null;
  try {
    fd = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } catch (_error) {
    // Some Windows filesystems do not allow directory fsync; rename remains atomic.
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
    }
  }
}

function createSettingsPersistenceState(status, noticeRequired) {
  return {
    status,
    noticeRequired: Boolean(noticeRequired),
  };
}

function mergeDesktopSettings(previous, patch) {
  const source = patch && typeof patch === "object" ? patch : {};
  return {
    localization: {
      ...(previous.localization || {}),
      ...(source.localization && typeof source.localization === "object" ? source.localization : {}),
    },
    api: {
      ...(previous.api || {}),
      ...(source.api && typeof source.api === "object" ? source.api : {}),
    },
    narration: {
      ...(previous.narration || {}),
      ...(source.narration && typeof source.narration === "object" ? source.narration : {}),
    },
    agent: {
      context: {
        ...(previous.agent?.context || {}),
        ...(source.agent?.context && typeof source.agent.context === "object" ? source.agent.context : {}),
      },
    },
    ui: {
      ...(previous.ui || {}),
      ...(source.ui && typeof source.ui === "object" ? source.ui : {}),
    },
    audio: {
      ...(previous.audio || {}),
      ...(source.audio && typeof source.audio === "object" ? source.audio : {}),
      input: mergeSpeechInputSettings(previous.audio?.input, source.audio?.input),
      tts: {
        ...(previous.audio?.tts || {}),
        ...(source.audio?.tts && typeof source.audio.tts === "object" ? source.audio.tts : {}),
      },
    },
    developer: {
      ...(previous.developer || {}),
      ...(source.developer && typeof source.developer === "object" ? source.developer : {}),
    },
    save: mergeSaveSettings(previous.save, source.save),
  };
}

function normalizeDesktopSettings(settings = {}) {
  const api = settings.api && typeof settings.api === "object" ? settings.api : {};
  const customConnections = normalizeCustomConnections(api.customConnections);
  const provider = normalizeEnum(api.provider, SUPPORTED_API_PROVIDERS, DEFAULT_SETTINGS.api.provider);
  const selectedConnection = provider === CUSTOM_PROVIDER_ID
    ? getCustomConnection(customConnections, api.connectionId)
    : null;
  const normalizedApi = {
    provider: selectedConnection ? CUSTOM_PROVIDER_ID : (provider === CUSTOM_PROVIDER_ID ? DEFAULT_SETTINGS.api.provider : provider),
    model: selectedConnection ? selectedConnection.modelId : normalizeModel(api.model, provider),
    connectionId: selectedConnection?.id || null,
    customConnections,
  };
  const audio = settings.audio && typeof settings.audio === "object" ? settings.audio : {};
  const tts = audio.tts && typeof audio.tts === "object" ? audio.tts : {};
  const narration = normalizeNarrationSettings(settings.narration);
  const agent = normalizeAgentSettings(settings.agent, normalizedApi);
  const ui = settings.ui && typeof settings.ui === "object" ? settings.ui : {};
  const developer = settings.developer && typeof settings.developer === "object" ? settings.developer : {};
  const save = normalizeSaveSettings(settings.save);
  const ttsProvider = normalizeEnum(
    tts.provider,
    getSupportedTtsProviders(),
    DEFAULT_SETTINGS.audio.tts.provider
  );

  return {
    localization: {
      preferredLocale: normalizeStoredPreferredLocale(settings.localization?.preferredLocale),
    },
    api: normalizedApi,
    narration,
    agent,
    ui: {
      narrationTextSize: normalizeEnum(
        ui.narrationTextSize,
        SUPPORTED_UI_TEXT_SIZES,
        DEFAULT_SETTINGS.ui.narrationTextSize
      ),
      sidePanelTextSize: normalizeEnum(
        ui.sidePanelTextSize,
        SUPPORTED_UI_TEXT_SIZES,
        DEFAULT_SETTINGS.ui.sidePanelTextSize
      ),
      windowMode: normalizeWindowMode(ui.windowMode),
      gameUiLayout: normalizeEnum(
        ui.gameUiLayout,
        SUPPORTED_GAME_UI_LAYOUTS,
        DEFAULT_SETTINGS.ui.gameUiLayout
      ),
      storyNotebookTheme: normalizeEnum(
        ui.storyNotebookTheme,
        SUPPORTED_STORY_NOTEBOOK_THEMES,
        DEFAULT_SETTINGS.ui.storyNotebookTheme
      ),
    },
    audio: {
      gameVolume: clampInteger(audio.gameVolume, 0, 100, DEFAULT_SETTINGS.audio.gameVolume),
      input: normalizeSpeechInputSettings(audio.input),
      tts: {
        enabled: ttsProvider !== "disabled" && Boolean(tts.enabled),
        autoPlay: Boolean(tts.autoPlay),
        provider: ttsProvider,
        voiceId: normalizeShortSetting(tts.voiceId, 80) || DEFAULT_SETTINGS.audio.tts.voiceId,
        rate: normalizeShortSetting(tts.rate, 16) || DEFAULT_SETTINGS.audio.tts.rate,
        pitch: normalizeShortSetting(tts.pitch, 16) || DEFAULT_SETTINGS.audio.tts.pitch,
        cacheUtteranceLimit: SUPPORTED_TTS_CACHE_UTTERANCE_LIMITS.has(Number(tts.cacheUtteranceLimit))
          ? Number(tts.cacheUtteranceLimit)
          : DEFAULT_SETTINGS.audio.tts.cacheUtteranceLimit,
      },
    },
    developer: {
      debugPanelEnabled: Boolean(developer.debugPanelEnabled),
    },
    save,
  };
}

function normalizeAgentSettings(agent = {}, api = {}) {
  const source = agent && typeof agent === "object" ? agent : {};
  const context = source.context && typeof source.context === "object" ? source.context : {};
  const provider = SETTINGS_CATALOG.api.providers.find((item) => item.id === api.provider)
    || SETTINGS_CATALOG.api.providers.find((item) => item.id === DEFAULT_SETTINGS.api.provider);
  const model = provider?.models?.find((item) => item.id === api.model)
    || provider?.models?.find((item) => item.id === DEFAULT_SETTINGS.api.model);
  const providerLimit = api.provider === CUSTOM_PROVIDER_ID
    ? CUSTOM_CONTEXT_WINDOW_MAX
    : (Number.isFinite(model?.contextLimit) ? model.contextLimit : DEFAULT_SETTINGS.agent.context.configuredContextWindow);
  return {
    context: {
      configuredContextWindow: clampInteger(
        context.configuredContextWindow,
        CONTEXT_WINDOW_MIN,
        Math.min(CONTEXT_WINDOW_MAX, providerLimit),
        DEFAULT_SETTINGS.agent.context.configuredContextWindow
      ),
      autoCompactRatio: clampNumber(
        context.autoCompactRatio,
        AUTO_COMPACT_RATIO_MIN,
        AUTO_COMPACT_RATIO_MAX,
        DEFAULT_SETTINGS.agent.context.autoCompactRatio
      ),
    },
  };
}

function normalizeNarrationSettings(narration = {}) {
  const source = narration && typeof narration === "object" ? narration : {};
  const lengthPreset = normalizeEnum(
    source.lengthPreset,
    SUPPORTED_NARRATION_PRESETS,
    DEFAULT_SETTINGS.narration.lengthPreset
  );
  const customTargetChars = lengthPreset === "custom"
    ? clampInteger(
      source.customTargetChars,
      NARRATION_CUSTOM_TARGET_MIN,
      NARRATION_CUSTOM_TARGET_MAX,
      NARRATION_LENGTH_PRESETS.standard.targetChars
    )
    : null;
  return {
    lengthPreset,
    customTargetChars,
  };
}

function settingsAffectProvider(previous, next) {
  return previous.api?.provider !== next.api.provider ||
    previous.api?.model !== next.api.model ||
    previous.api?.connectionId !== next.api.connectionId ||
    activeConnectionIdentity(previous.api) !== activeConnectionIdentity(next.api);
}

function activeConnectionIdentity(api = {}) {
  if (api.provider !== CUSTOM_PROVIDER_ID) {
    return "";
  }
  const connection = getCustomConnection(api.customConnections, api.connectionId);
  return connection ? `${connection.id}|${connection.baseUrl}|${connection.modelId}` : "";
}

function normalizeEnum(value, supported, fallback) {
  return typeof value === "string" && supported.has(value) ? value : fallback;
}

function normalizeModel(value, providerId) {
  const provider = SETTINGS_CATALOG.api.providers.find(
    (candidate) => candidate.id === providerId && candidate.enabled
  ) || SETTINGS_CATALOG.api.providers.find((candidate) => candidate.id === DEFAULT_SETTINGS.api.provider);
  const supported = new Set((provider?.models || []).filter((model) => model.enabled).map((model) => model.id));
  return normalizeEnum(value, supported, DEFAULT_SETTINGS.api.model);
}

function normalizeShortSetting(value, maxChars) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxChars);
}

function mergeSaveSettings(previous = DEFAULT_SETTINGS.save, patch = {}) {
  const safePrevious = normalizeSaveSettings(previous);
  const source = patch && typeof patch === "object" ? patch : {};
  const legacy = source.autoSave && typeof source.autoSave === "object" ? source.autoSave : {};
  return normalizeSaveSettings({
    chapterLog: {
      ...safePrevious.chapterLog,
      ...(legacy.enabled === undefined ? {} : { onAutoSave: Boolean(legacy.enabled) }),
      ...(legacy.intervalTurns === undefined ? {} : { intervalTurns: legacy.intervalTurns }),
      ...(source.chapterLog && typeof source.chapterLog === "object" ? source.chapterLog : {}),
    },
  });
}

function normalizeSaveSettings(save = {}) {
  const source = save && typeof save === "object" ? save : {};
  const autoSave = source.autoSave && typeof source.autoSave === "object" ? source.autoSave : {};
  const chapterLog = source.chapterLog && typeof source.chapterLog === "object" ? source.chapterLog : {};
  return {
    chapterLog: {
      intervalTurns: clampInteger(chapterLog.intervalTurns ?? autoSave.intervalTurns,
        AUTO_SAVE_INTERVAL_MIN, AUTO_SAVE_INTERVAL_MAX, DEFAULT_SETTINGS.save.chapterLog.intervalTurns),
      onManualSave: chapterLog.onManualSave === undefined
        ? DEFAULT_SETTINGS.save.chapterLog.onManualSave
        : Boolean(chapterLog.onManualSave),
      onAutoSave: (chapterLog.intervalTurns === undefined && autoSave.enabled === false) ? false : chapterLog.onAutoSave === undefined
        ? DEFAULT_SETTINGS.save.chapterLog.onAutoSave
        : Boolean(chapterLog.onAutoSave),
      onCompaction: chapterLog.onCompaction === undefined
        ? DEFAULT_SETTINGS.save.chapterLog.onCompaction
        : Boolean(chapterLog.onCompaction),
    },
  };
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Number(Math.min(max, Math.max(min, parsed)).toFixed(4));
}

function getSettingsCatalog(options = {}) {
  const catalog = JSON.parse(JSON.stringify(SETTINGS_CATALOG));
  if (options.kokoroOriginalAvailable === false) {
    const kokoro = catalog.audio.ttsProviders.find((provider) => provider.id === "kokoro-original-local");
    if (kokoro) {
      kokoro.enabled = false;
      kokoro.disabledReason = "未安装语音包";
      kokoro.resourceNotice = "当前设备未安装高质量中文语音包；文字游戏不受影响。";
    }
  }
  catalog.modelHelp = getModelHelpCatalog("zh-CN");
  catalog.skills = getLoadedSkillCatalog();
  return catalog;
}

function resolveRuntimeRoot() {
  if (typeof process.resourcesPath === "string") {
    const packagedRoot = path.resolve(process.resourcesPath);
    if (fs.existsSync(path.join(packagedRoot, "engine", "localization"))) return packagedRoot;
  }
  return path.resolve(__dirname, "../../..");
}

function getSupportedTtsProviders() {
  return new Set(SUPPORTED_TTS_PROVIDERS);
}

function getLoadedSkillCatalog() {
  try {
    const manifest = JSON.parse(fs.readFileSync(SKILL_INDEX_PATH, "utf8"));
    const loaded = Array.isArray(manifest.skills)
      ? manifest.skills.map(projectLoadedSkillForCatalog).filter(Boolean)
      : [];
    return {
      schemaVersion: manifest.schemaVersion || "unknown",
      source: "base-content",
      loaded,
      loadedCount: loaded.length,
      extensionPackSkillCount: 0,
      saveRootSkillOverridesAllowed: false,
    };
  } catch (_error) {
    return {
      schemaVersion: "unknown",
      source: "unavailable",
      loaded: [],
      loadedCount: 0,
      errorCode: "skill_catalog_unavailable",
    };
  }
}

function projectLoadedSkillForCatalog(skill = {}) {
  if (!skill || typeof skill !== "object") {
    return null;
  }
  const id = normalizeCatalogSkillId(skill.id);
  if (!id) {
    return null;
  }
  const title = typeof skill.title === "string" ? skill.title.trim().slice(0, 80) : "";
  return {
    id,
    label: SKILL_DISPLAY_LABELS[id] || title || id,
    title: title || id,
    kind: normalizeCatalogSkillKind(skill.kind),
    userMenuCommand: Boolean(skill.userMenuCommand),
    danger: normalizeCatalogSkillDanger(skill.danger),
    sourceLayer: "base",
  };
}

function normalizeCatalogSkillId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{1,63}$/.test(text) ? text : "";
}

function normalizeCatalogSkillKind(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9_-]{0,63}$/.test(text) ? text : "unknown";
}

function normalizeCatalogSkillDanger(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return ["low", "medium", "high", "critical"].includes(text) ? text : "unknown";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

module.exports = {
  DEFAULT_SETTINGS,
  createSettingsStore,
  getSettingsCatalog,
  mergeDesktopSettings,
  normalizeDesktopSettings,
  settingsAffectProvider,
};
