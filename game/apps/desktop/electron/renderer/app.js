"use strict";

const ui = {
  menuView: document.querySelector("#menuView"),
  gameStageViewport: document.querySelector("#gameStageViewport"),
  gameStageCanvas: document.querySelector("#gameStageCanvas"),
  gameView: document.querySelector("#gameView"),
  brandLogo: document.querySelector("#brandLogo"),
  localeTransitionCurtain: document.querySelector("#localeTransitionCurtain"),
  runtimeStatus: document.querySelector("#runtimeStatus"),
  menuMessage: document.querySelector("#menuMessage"),
  newGameButton: document.querySelector("#newGameButton"),
  continueGameButton: document.querySelector("#continueGameButton"),
  contentCreatorButton: document.querySelector("#contentCreatorButton"),
  saveList: document.querySelector("#saveList"),
  settingsButton: document.querySelector("#settingsButton"),
  exitGameButton: document.querySelector("#exitGameButton"),
  menuLanguageSwitcher: document.querySelector("#menuLanguageSwitcher"),
  menuLanguageToggle: document.querySelector("#menuLanguageToggle"),
  menuLanguageOptions: document.querySelector("#menuLanguageOptions"),
  menuLanguageButtons: Array.from(document.querySelectorAll("[data-menu-locale]")),
  menuLanguageStatus: document.querySelector("#menuLanguageStatus"),
  gameSettingsButton: document.querySelector("#gameSettingsButton"),
  manualSaveButton: document.querySelector("#manualSaveButton"),
  chapterLogButton: document.querySelector("#chapterLogButton"),
  saveMaintenanceButton: document.querySelector("#saveMaintenanceButton"),
  debugPanelButton: document.querySelector("#debugPanelButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsTabs: Array.from(document.querySelectorAll("[data-settings-tab]")),
  settingsPanels: Array.from(document.querySelectorAll("[data-settings-panel]")),
  settingsContent: document.querySelector("#settingsContent"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  settingsStatus: document.querySelector("#settingsStatus"),
  exportProblemReportButton: document.querySelector("#exportProblemReportButton"),
  problemReportStatus: document.querySelector("#problemReportStatus"),
  connectionStatus: document.querySelector("#connectionStatus"),
  currentConnectionSummary: document.querySelector("#currentConnectionSummary"),
  clearAllKeysButton: document.querySelector("#clearAllKeysButton"),
  settingsPersistenceWarning: document.querySelector("#settingsPersistenceWarning"),
  providerPresetSelect: document.querySelector("#providerPresetSelect"),
  modelPresetSelect: document.querySelector("#modelPresetSelect"),
  customConnectionPanel: document.querySelector("#customConnectionPanel"),
  customConnectionSelect: document.querySelector("#customConnectionSelect"),
  customConnectionNameInput: document.querySelector("#customConnectionNameInput"),
  customBaseUrlInput: document.querySelector("#customBaseUrlInput"),
  customModelIdInput: document.querySelector("#customModelIdInput"),
  customConnectionStatus: document.querySelector("#customConnectionStatus"),
  saveCustomConnectionButton: document.querySelector("#saveCustomConnectionButton"),
  deleteCustomConnectionButton: document.querySelector("#deleteCustomConnectionButton"),
  contextWindowPresetSelect: document.querySelector("#contextWindowPresetSelect"),
  contextWindowCustomInput: document.querySelector("#contextWindowCustomInput"),
  autoCompactRatioSelect: document.querySelector("#autoCompactRatioSelect"),
  autoCompactRatioCustomInput: document.querySelector("#autoCompactRatioCustomInput"),
  contextPolicyStatus: document.querySelector("#contextPolicyStatus"),
  settingsCompactContextButton: document.querySelector("#settingsCompactContextButton"),
  narrationLengthPresetSelect: document.querySelector("#narrationLengthPresetSelect"),
  narrationCustomTargetInput: document.querySelector("#narrationCustomTargetInput"),
  narrationLengthStatus: document.querySelector("#narrationLengthStatus"),
  narrationTextSizeSelect: document.querySelector("#narrationTextSizeSelect"),
  sidePanelTextSizeSelect: document.querySelector("#sidePanelTextSizeSelect"),
  storyNotebookThemeSelect: document.querySelector("#storyNotebookThemeSelect"),
  windowModeSelect: document.querySelector("#windowModeSelect"),
  windowModeStatus: document.querySelector("#windowModeStatus"),
  gameLanguageSelect: document.querySelector("#gameLanguageSelect"),
  gameLanguageStatus: document.querySelector("#gameLanguageStatus"),
  autoSaveEnabledSelect: document.querySelector("#autoSaveEnabledSelect"),
  autoSaveIntervalSelect: document.querySelector("#autoSaveIntervalSelect"),
  autoSaveIntervalCustomInput: document.querySelector("#autoSaveIntervalCustomInput"),
  autoSaveStatus: document.querySelector("#autoSaveStatus"),
  manualChapterSelect: document.querySelector("#manualChapterSelect"),
  compactionChapterSelect: document.querySelector("#compactionChapterSelect"),
  contentLibraryStatus: document.querySelector("#contentLibraryStatus"),
  contentPackSelect: document.querySelector("#contentPackSelect"),
  contentPackDetails: document.querySelector("#contentPackDetails"),
  refreshContentLibraryButton: document.querySelector("#refreshContentLibraryButton"),
  cloneContentPackIdInput: document.querySelector("#cloneContentPackIdInput"),
  cloneContentPackTitleInput: document.querySelector("#cloneContentPackTitleInput"),
  cloneContentPackAuthorInput: document.querySelector("#cloneContentPackAuthorInput"),
  cloneContentPackButton: document.querySelector("#cloneContentPackButton"),
  exportContentPackButton: document.querySelector("#exportContentPackButton"),
  deleteContentPackButton: document.querySelector("#deleteContentPackButton"),
  openContentCreatorButton: document.querySelector("#openContentCreatorButton"),
  contentCreatorDialog: document.querySelector("#contentCreatorDialog"),
  contentCreatorWarning: document.querySelector("#contentCreatorWarning"),
  contentCreatorWorkspace: document.querySelector("#contentCreatorWorkspace"),
  closeContentCreatorWarningButton: document.querySelector("#closeContentCreatorWarningButton"),
  acknowledgeContentCreatorButton: document.querySelector("#acknowledgeContentCreatorButton"),
  cancelContentCreatorButton: document.querySelector("#cancelContentCreatorButton"),
  closeContentCreatorButton: document.querySelector("#closeContentCreatorButton"),
  contentCreatorModeContent: document.querySelector("#contentCreatorModeContent"),
  contentCreatorModePreset: document.querySelector("#contentCreatorModePreset"),
  contentCreatorPackSelect: document.querySelector("#contentCreatorPackSelect"),
  manageContentPacksButton: document.querySelector("#manageContentPacksButton"),
  contentEditorStatus: document.querySelector("#contentEditorStatus"),
  contentEditorItemLabel: document.querySelector("#contentEditorItemLabel"),
  contentEditorItemSelect: document.querySelector("#contentEditorItemSelect"),
  loadContentEditorButton: document.querySelector("#loadContentEditorButton"),
  newBlankContentButton: document.querySelector("#newBlankContentButton"),
  newContentPresetButton: document.querySelector("#newContentPresetButton"),
  blankContentPicker: document.querySelector("#blankContentPicker"),
  closeBlankContentPickerButton: document.querySelector("#closeBlankContentPickerButton"),
  blankContentKindButtons: Array.from(document.querySelectorAll("[data-blank-content-kind]")),
  contentEditorForm: document.querySelector("#contentEditorForm"),
  contentEditorTitleInput: document.querySelector("#contentEditorTitleInput"),
  contentEditorLanguageInput: document.querySelector("#contentEditorLanguageInput"),
  contentEditorMarkdownInput: document.querySelector("#contentEditorMarkdownInput"),
  contentSkillEditorFields: document.querySelector("#contentSkillEditorFields"),
  contentEditorTriggersInput: document.querySelector("#contentEditorTriggersInput"),
  contentModuleOrdinaryFields: document.querySelector("#contentModuleOrdinaryFields"),
  contentEditorPlayerGuideInput: document.querySelector("#contentEditorPlayerGuideInput"),
  contentModuleEnabledInput: document.querySelector("#contentModuleEnabledInput"),
  contentModuleSupportStatus: document.querySelector("#contentModuleSupportStatus"),
  contentModuleFieldList: document.querySelector("#contentModuleFieldList"),
  addContentModuleFieldButton: document.querySelector("#addContentModuleFieldButton"),
  contentEditorPermissionPanel: document.querySelector("#contentEditorPermissionPanel"),
  contentPermissionReadAdventure: document.querySelector("#contentPermissionReadAdventure"),
  contentPermissionPrivateState: document.querySelector("#contentPermissionPrivateState"),
  contentPermissionUpdateAdventure: document.querySelector("#contentPermissionUpdateAdventure"),
  contentEditorExistingCapabilitySummary: document.querySelector("#contentEditorExistingCapabilitySummary"),
  contentNewGameBoundary: document.querySelector("#contentNewGameBoundary"),
  contentEditorTypeSummary: document.querySelector("#contentEditorTypeSummary"),
  toggleContentAdvancedInfoButton: document.querySelector("#toggleContentAdvancedInfoButton"),
  contentAdvancedInfoPanel: document.querySelector("#contentAdvancedInfoPanel"),
  contentAdvancedInfoList: document.querySelector("#contentAdvancedInfoList"),
  contentEditorPreview: document.querySelector("#contentEditorPreview"),
  contentModulePreview: document.querySelector("#contentModulePreview"),
  contentModulePreviewSummary: document.querySelector("#contentModulePreviewSummary"),
  contentModulePreviewFields: document.querySelector("#contentModulePreviewFields"),
  previewContentEditorButton: document.querySelector("#previewContentEditorButton"),
  saveContentEditorButton: document.querySelector("#saveContentEditorButton"),
  cancelBlankContentButton: document.querySelector("#cancelBlankContentButton"),
  contentPresetForm: document.querySelector("#contentPresetForm"),
  contentPresetTitleInput: document.querySelector("#contentPresetTitleInput"),
  contentPresetLanguageInput: document.querySelector("#contentPresetLanguageInput"),
  contentPresetDescriptionInput: document.querySelector("#contentPresetDescriptionInput"),
  contentPresetHostSelect: document.querySelector("#contentPresetHostSelect"),
  contentPresetWorldSelect: document.querySelector("#contentPresetWorldSelect"),
  contentPresetNewGameSkillSelect: document.querySelector("#contentPresetNewGameSkillSelect"),
  contentPresetSkillList: document.querySelector("#contentPresetSkillList"),
  contentPresetPreview: document.querySelector("#contentPresetPreview"),
  previewContentPresetButton: document.querySelector("#previewContentPresetButton"),
  saveContentPresetButton: document.querySelector("#saveContentPresetButton"),
  playerProfileStatus: document.querySelector("#playerProfileStatus"),
  playerProfileLanguageInput: document.querySelector("#playerProfileLanguageInput"),
  playerProfileNameInput: document.querySelector("#playerProfileNameInput"),
  playerProfilePronounsInput: document.querySelector("#playerProfilePronounsInput"),
  playerProfileNarrativeInput: document.querySelector("#playerProfileNarrativeInput"),
  playerProfileBoundariesInput: document.querySelector("#playerProfileBoundariesInput"),
  playerProfileNotesInput: document.querySelector("#playerProfileNotesInput"),
  savePlayerProfileButton: document.querySelector("#savePlayerProfileButton"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  apiKeyLabel: document.querySelector("#apiKeyLabel"),
  providerRiskNote: document.querySelector("#providerRiskNote"),
  credentialStatus: document.querySelector("#credentialStatus"),
  testKeyButton: document.querySelector("#testKeyButton"),
  clearKeyButton: document.querySelector("#clearKeyButton"),
  modelHelpTitle: document.querySelector("#modelHelpTitle"),
  modelHelpBody: document.querySelector("#modelHelpBody"),
  modelHelpNotice: document.querySelector("#modelHelpNotice"),
  modelHelpLinks: document.querySelector("#modelHelpLinks"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  gameVolumeInput: document.querySelector("#gameVolumeInput"),
  gameVolumeValue: document.querySelector("#gameVolumeValue"),
  speechInputEnabledSelect: document.querySelector("#speechInputEnabledSelect"),
  speechInputLanguageSelect: document.querySelector("#speechInputLanguageSelect"),
  speechInputDeviceSelect: document.querySelector("#speechInputDeviceSelect"),
  ttsReadingModeSelect: document.querySelector("#ttsReadingModeSelect"),
  ttsProviderSelect: document.querySelector("#ttsProviderSelect"),
  ttsVoiceSelect: document.querySelector("#ttsVoiceSelect"),
  ttsRateInput: document.querySelector("#ttsRateInput"),
  ttsPitchInput: document.querySelector("#ttsPitchInput"),
  ttsCacheLimitSelect: document.querySelector("#ttsCacheLimitSelect"),
  ttsCacheStatus: document.querySelector("#ttsCacheStatus"),
  clearTtsCacheButton: document.querySelector("#clearTtsCacheButton"),
  ttsTestButton: document.querySelector("#ttsTestButton"),
  ttsStatus: document.querySelector("#ttsStatus"),
  debugPanelEnabledSelect: document.querySelector("#debugPanelEnabledSelect"),
  advancedMetricsStatus: document.querySelector("#advancedMetricsStatus"),
  advancedMetricsGrid: document.querySelector("#advancedMetricsGrid"),
  refreshAdvancedMetricsButton: document.querySelector("#refreshAdvancedMetricsButton"),
  maintenanceDialog: document.querySelector("#maintenanceDialog"),
  maintenanceForm: document.querySelector("#maintenanceForm"),
  closeMaintenanceButton: document.querySelector("#closeMaintenanceButton"),
  maintenanceStatus: document.querySelector("#maintenanceStatus"),
  maintenanceRepairButton: document.querySelector("#maintenanceRepairButton"),
  maintenanceClearButton: document.querySelector("#maintenanceClearButton"),
  maintenanceConfirmPanel: document.querySelector("#maintenanceConfirmPanel"),
  maintenanceConfirmTitle: document.querySelector("#maintenanceConfirmTitle"),
  maintenanceConfirmSummary: document.querySelector("#maintenanceConfirmSummary"),
  maintenanceConfirmInputLabel: document.querySelector("#maintenanceConfirmInputLabel"),
  maintenanceConfirmInput: document.querySelector("#maintenanceConfirmInput"),
  maintenanceConfirmButton: document.querySelector("#maintenanceConfirmButton"),
  maintenanceCancelButton: document.querySelector("#maintenanceCancelButton"),
  newGameConfirmDialog: document.querySelector("#newGameConfirmDialog"),
  newGameConfirmForm: document.querySelector("#newGameConfirmForm"),
  closeNewGameConfirmButton: document.querySelector("#closeNewGameConfirmButton"),
  newGameConfirmStatus: document.querySelector("#newGameConfirmStatus"),
  newGameConfirmTitle: document.querySelector("#newGameConfirmTitle"),
  newGameConfirmSummary: document.querySelector("#newGameConfirmSummary"),
  newGameConfirmInput: document.querySelector("#newGameConfirmInput"),
  confirmNewGameRestartButton: document.querySelector("#confirmNewGameRestartButton"),
  cancelNewGameRestartButton: document.querySelector("#cancelNewGameRestartButton"),
  newGameSetupDialog: document.querySelector("#newGameSetupDialog"),
  closeNewGameSetupButton: document.querySelector("#closeNewGameSetupButton"),
  newGameSetupStatus: document.querySelector("#newGameSetupStatus"),
  newGamePresetSelect: document.querySelector("#newGamePresetSelect"),
  newGamePresetDescription: document.querySelector("#newGamePresetDescription"),
  newGamePresetContents: document.querySelector("#newGamePresetContents"),
  newGameOptionalSection: document.querySelector("#newGameOptionalSection"),
  newGameOptionalSkillList: document.querySelector("#newGameOptionalSkillList"),
  newGameCapabilityList: document.querySelector("#newGameCapabilityList"),
  newGameReviewPanel: document.querySelector("#newGameReviewPanel"),
  newGameReview: document.querySelector("#newGameReview"),
  newGameModuleReview: document.querySelector("#newGameModuleReview"),
  newGameModuleReviewList: document.querySelector("#newGameModuleReviewList"),
  newGameModuleLimits: document.querySelector("#newGameModuleLimits"),
  prepareNewGameButton: document.querySelector("#prepareNewGameButton"),
  cancelNewGameSetupButton: document.querySelector("#cancelNewGameSetupButton"),
  skillModuleDialog: document.querySelector("#skillModuleDialog"),
  skillModuleForm: document.querySelector("#skillModuleForm"),
  skillModuleTitle: document.querySelector("#skillModuleTitle"),
  skillModuleStatus: document.querySelector("#skillModuleStatus"),
  skillModuleGuide: document.querySelector("#skillModuleGuide"),
  skillModuleFields: document.querySelector("#skillModuleFields"),
  closeSkillModuleButton: document.querySelector("#closeSkillModuleButton"),
  doneSkillModuleButton: document.querySelector("#doneSkillModuleButton"),
  backToMenuButton: document.querySelector("#backToMenuButton"),
  gameStatus: document.querySelector("#gameStatus"),
  narrationPanel: document.querySelector("#narrationPanel"),
  stateGrid: document.querySelector("#stateGrid"),
  modelStatusText: document.querySelector("#modelStatusText"),
  storyNotebookWorldCard: document.querySelector("#storyNotebookWorldCard"),
  storyNotebookWorldTitle: document.querySelector("#storyNotebookWorldTitle"),
  storyNotebookHostStatus: document.querySelector("#storyNotebookHostStatus"),
  storyNotebookLive: document.querySelector("#storyNotebookLive"),
  storyNotebookModelStatusText: document.querySelector("#storyNotebookModelStatusText"),
  storyNotebookRailButtons: Array.from(document.querySelectorAll("[data-notebook-panel]")),
  storyNotebookStateButton: document.querySelector("#storyNotebookStateButton"),
  storyNotebookCharactersButton: document.querySelector("#storyNotebookCharactersButton"),
  storyNotebookModulesButton: document.querySelector("#storyNotebookModulesButton"),
  storyNotebookChaptersButton: document.querySelector("#storyNotebookChaptersButton"),
  storyNotebookModuleCount: document.querySelector("#storyNotebookModuleCount"),
  storyNotebookDrawer: document.querySelector("#storyNotebookDrawer"),
  storyNotebookDrawerBackButton: document.querySelector("#storyNotebookDrawerBackButton"),
  storyNotebookDrawerRefreshButton: document.querySelector("#storyNotebookDrawerRefreshButton"),
  storyNotebookDrawerCloseButton: document.querySelector("#storyNotebookDrawerCloseButton"),
  storyNotebookDrawerEyebrow: document.querySelector("#storyNotebookDrawerEyebrow"),
  storyNotebookDrawerTitle: document.querySelector("#storyNotebookDrawerTitle"),
  storyNotebookDrawerStatus: document.querySelector("#storyNotebookDrawerStatus"),
  storyNotebookDrawerBody: document.querySelector("#storyNotebookDrawerBody"),
  turnForm: document.querySelector("#turnForm"),
  storyArchiveFooter: document.querySelector("#storyArchiveFooter"),
  storyArchiveTitle: document.querySelector("#storyArchiveTitle"),
  storyArchiveNotice: document.querySelector("#storyArchiveNotice"),
  storyContinueButton: document.querySelector("#storyContinueButton"),
  storyExportHtmlButton: document.querySelector("#storyExportHtmlButton"),
  storyExportMarkdownButton: document.querySelector("#storyExportMarkdownButton"),
  storyArchiveBackButton: document.querySelector("#storyArchiveBackButton"),
  storyResumeFinaleButton: document.querySelector("#storyResumeFinaleButton"),
  turnStatus: document.querySelector("#turnStatus"),
  turnFailureDetailsButton: document.querySelector("#turnFailureDetailsButton"),
  modSlotKicker: document.querySelector("#modSlotKicker"),
  modSlots: document.querySelector("#modSlots"),
  turnInput: document.querySelector("#turnInput"),
  sendTurnButton: document.querySelector("#sendTurnButton"),
  cancelTurnButton: document.querySelector("#cancelTurnButton"),
  observeCommandButton: document.querySelector("#observeCommandButton"),
  listenCommandButton: document.querySelector("#listenCommandButton"),
  mapCommandButton: document.querySelector("#mapCommandButton"),
  backpackCommandButton: document.querySelector("#backpackCommandButton"),
  compactContextButton: document.querySelector("#compactContextButton"),
  contextMeter: document.querySelector("#contextMeter"),
  contextMeterBloodFill: document.querySelector("#contextMeterBloodFill"),
  contextUsagePercent: document.querySelector("#contextUsagePercent"),
  contextUsageDetail: document.querySelector("#contextUsageDetail"),
  contextUsageStatus: document.querySelector("#contextUsageStatus"),
  operationOutputStatus: document.querySelector("#operationOutputStatus"),
  operationToolStatus: document.querySelector("#operationToolStatus"),
  operationContextStatus: document.querySelector("#operationContextStatus"),
  operationTtsStatus: document.querySelector("#operationTtsStatus"),
  ttsPlaybackToggleButton: document.querySelector("#ttsPlaybackToggleButton"),
  ttsPlaybackIcon: document.querySelector("#ttsPlaybackIcon"),
  compactDialog: document.querySelector("#compactDialog"),
  closeCompactButton: document.querySelector("#closeCompactButton"),
  cancelCompactButton: document.querySelector("#cancelCompactButton"),
  confirmCompactButton: document.querySelector("#confirmCompactButton"),
  compactStatus: document.querySelector("#compactStatus"),
  chapterDialog: document.querySelector("#chapterDialog"),
  closeChapterButton: document.querySelector("#closeChapterButton"),
  chapterRefreshButton: document.querySelector("#chapterRefreshButton"),
  chapterStatus: document.querySelector("#chapterStatus"),
  chapterLogList: document.querySelector("#chapterLogList"),
  debugDialog: document.querySelector("#debugDialog"),
  closeDebugButton: document.querySelector("#closeDebugButton"),
  debugRefreshButton: document.querySelector("#debugRefreshButton"),
  debugExportButton: document.querySelector("#debugExportButton"),
  debugStatus: document.querySelector("#debugStatus"),
  debugTraceList: document.querySelector("#debugTraceList"),
};

const state = {
  keyVerified: false,
  gameStarted: false,
  gameUiLayout: "story-notebook-v1",
  activeSaveId: null,
  activeSave: null,
  runtimeProtocol: "session-1",
  runtimeSessionId: null,
  sessionContextSettingsIdentity: null,
  sessionContextGeneration: null,
  sessionContextCompactionAvailable: false,
  busyRevision: 0,
  turnBusyRevision: null,
  pendingSessionAction: null,
  turnFailureNotice: null,
  sessionDerivedWork: new Map(),
  pendingSessionCompaction: null,
  compactionBusyRevision: null,
  sessionRecoveryRequired: false,
  sessionRecoveryAttempted: null,
  sessionRecoveryCompleted: null,
  retiredRuntimeSessions: new Set(),
  renderedSessionActions: new Set(),
  historyCursor: null,
  sessionChapterLogs: [],
  chapterCursor: null,
  chapterReadRevision: 0,
  chapterReadBusy: false,
  saves: [],
  pendingDeletes: [],
  provider: "deepseek",
  model: "deepseek-flash",
  connectionId: null,
  customConnections: [],
  preferredLocale: null,
  adventureLocale: null,
  effectiveLocale: null,
  localeRevision: "locale_000000",
  localePreferenceBusy: false,
  localePreferenceNotice: "",
  narrationLengthPreset: "standard",
  narrationCustomTargetChars: null,
  configuredContextWindow: 256000,
  autoCompactRatio: 0.75,
  narrationTextSize: "medium",
  sidePanelTextSize: "medium",
  storyNotebookTheme: "light",
  windowMode: "standard",
  autoSaveEnabled: true,
  autoSaveIntervalTurns: 60,
  manualChapterEnabled: true,
  compactionChapterEnabled: true,
  gameVolume: 80,
  speechInput: { enabled: false, language: "zh", deviceId: "default" },
  ttsEnabled: false,
  ttsAuto: false,
  ttsProvider: "disabled",
  ttsVoiceId: "zm_010",
  ttsRate: "+0%",
  ttsPitch: "+0Hz",
  ttsCacheUtteranceLimit: 20,
  ttsCacheUsage: null,
  debugPanelEnabled: false,
  activeSettingsTab: "display",
  connectionDraft: null,
  settingsAutosaveTimer: null,
  settingsSaveTask: null,
  settingsPendingGroups: new Set(),
  debugTraceExport: null,
  debugTraceEntries: [],
  debugTraceExecution: null,
  debugTraceRequestId: 0,
  debugTraceSummary: null,
  debugTraceFilter: "all",
  advancedMetrics: null,
  settingsCatalog: null,
  settingsPersistenceWarning: "",
  contentLibrary: null,
  selectedContentPackId: null,
  editableContentItem: null,
  editableContentPreset: null,
  contentCreatorMode: "content",
  blankContentPickerOpen: false,
  contentAdvancedInfoOpen: false,
  contentModuleDraft: null,
  contentModuleSuspendedDraft: null,
  contentModulePreviewProjection: null,
  contentModulePreviewPanelProjection: null,
  contentModulePreviewListProjection: null,
  contentModulePreviewDetailProjection: null,
  contentModulePreviewSurface: null,
  contentCreatorAcknowledged: false,
  playerProfile: null,
  contentManagementBusy: false,
  settingsDirty: false,
  settingsSaving: false,
  persistedSettingsSnapshot: "",
  credential: null,
  contextUsage: null,
  operationStatus: {
    output: "",
    tool: "",
    context: "",
  },
  busy: false,
  busyLabel: "",
  busyStartedAt: null,
  busyTimer: null,
  hostIdleLineKey: "",
  pendingMaintenance: null,
  pendingNewGameRestart: null,
  newGameCatalog: null,
  pendingNewGameCreation: null,
  lockedContent: null,
  storyFinale: null,
  storyArchive: null,
  archiveChapters: [],
  storyExportBusy: false,
  storyExportStatus: "",
  storyContinuationBusy: false,
  storyContinuationStatus: "",
  pendingContinuationRequest: null,
  renderedFinaleId: null,
  skillModules: [],
  skillModuleRefreshError: "",
  activeSkillModule: null,
  skillModulePages: new Map(),
  skillModuleOpener: null,
  skillPanels: [],
  skillPanelSupported: null,
  skillPanelRefreshError: "",
  skillPanelRefreshBusy: false,
  skillPanelListRequestRevision: 0,
  skillPanelViewRequestRevision: 0,
  characterPanelEntry: null,
  characterPanelSupported: null,
  characterPanelRefreshError: "",
  characterPanelRefreshBusy: false,
  characterPanelRequestRevision: 0,
  activeSkillPanel: null,
  skillPanelOverviewProjection: null,
  skillPanelListProjection: null,
  activeSkillPanelProjection: null,
  skillPanelRecordFieldIds: [],
  skillPanelViewError: "",
  notebookDrawerSelectedPanelRef: null,
  notebookDrawerSelectedFieldId: null,
  notebookDrawerSelectedItemRef: null,
  notebookDrawerPanel: null,
  notebookDrawerView: "root",
  notebookDrawerOpener: null,
  notebookDrawerSelectedModuleRef: null,
  notebookDrawerFocusTimer: null,
  notebookNavigationRevision: 0,
  typewriterTimers: new Set(),
  narrationDeliveryEpoch: 0,
  narrationDelivery: null,
  currentAudio: null,
  ttsUtteranceId: null,
  ttsRequestId: 0,
  ttsPlaybackPhase: "idle",
  ttsPlaybackSegmentIndex: null,
  ttsPlaybackSegmentCount: null,
  ttsPlaybackPrefetching: false,
  ttsPlaybackCacheHit: false,
  ttsPlaybackError: "",
  ttsStatusResetTimer: null,
};
const rendererPreview = createRendererPreviewMode();
const DISPLAY_INTERNAL_SECTION_PATTERN = /(?:^|\b)(candidate_events|candidateEvents|soft_writes|softWrites|soft_records|softRecords|soft_canon|player_claim|playerClaim|narrative_event|narrativeEvent|hard_state_proposals|hardStateProposals|memory_notes|memoryNotes|uncertainties|operation_trace|operationTrace|Runtime tool|tool_call|function_call|raw provider|provider raw|Hard Commit Validator|State Store|Memory Store|Context Assembler|Fact Gate)(?:\b|\s*:)/i;
const DISPLAY_INTERNAL_SECTION_START_PATTERN = /^\s*(?:[-*]\s*)?(candidate_events|candidateEvents|soft_writes|softWrites|soft_records|softRecords|soft_canon|player_claim|playerClaim|attempt|proposal|narrative_event|narrativeEvent|hard_state_proposals|hardStateProposals|memory_notes|memoryNotes|uncertainties|operation_trace|operationTrace|Runtime tool|tool_call|function_call|raw provider|provider raw|Hard Commit Validator|State Store|Memory Store|Context Assembler|Fact Gate|软记录|候选事件|硬状态提案|玩家声称|叙事事件|记忆备注|工具调用|工具实现|运行时|状态存储|上下文组装|事实闸门|不确定性)\s*[:：]?\s*$/i;
const DISPLAY_STRUCTURED_LINE_PATTERN = /^\s*(?:[-*]\s*)?(?:[{[\]}]|\{?\s*"(?:candidate_events|candidateEvents|soft_writes|softWrites|soft_records|softRecords|soft_canon|player_claim|playerClaim|attempt|proposal|narrative_event|narrativeEvent|hard_state_proposals|hardStateProposals|memory_notes|memoryNotes|uncertainties)"\s*:|"(?:type|summary|evidence|risk|meta|id|authority|source)"\s*:)/i;
const DEFAULT_DISPLAY_LOCALE = "zh-CN";
const UI_I18N = globalThis.GreyCrowI18n;
if (!UI_I18N || UI_I18N.schemaVersion !== "grey-crow-ui-localization-v1") {
  throw new Error("Grey Crow UI localization runtime is unavailable.");
}
const BRAND_LOGO_BY_LOCALE = Object.freeze({
  "zh-CN": "assets/branding/grey-crow-ai-logo-zh-CN.png",
  "en-US": "assets/branding/grey-crow-ai-logo-en-US.png",
  "ja-JP": "assets/branding/grey-crow-ai-logo-ja-JP.png",
});
const LOCALE_TRANSITION_TIMING = Object.freeze({ cover: 380, hold: 110, reveal: 560 });
const GAME_UI_LAYOUTS = Object.freeze(["story-notebook-v1"]);
const DEFAULT_GAME_UI_LAYOUT = "story-notebook-v1";
const GAME_STAGE_LOGICAL_WIDTH = 1600;
const GAME_STAGE_LOGICAL_HEIGHT = 900;
const WINDOW_MODE_IDS = Object.freeze(["compact", "standard", "large", "qhd", "fullscreen"]);
const HOST_IDLE_LINE_KEYS = Object.freeze([
  "game.turn.waiting",
  "game.turn.waitingAlt1",
  "game.turn.waitingAlt2",
  "game.turn.waitingAlt3",
  "game.turn.waitingAlt4",
]);

function getUiLocale() {
  const candidate = state.effectiveLocale || state.adventureLocale || state.preferredLocale || DEFAULT_DISPLAY_LOCALE;
  return UI_I18N.supportedLocales.includes(candidate) ? candidate : DEFAULT_DISPLAY_LOCALE;
}

function t(key, params = {}, options = {}) {
  return UI_I18N.t(key, params, options);
}

function formatUiList(values) {
  const items = Array.isArray(values) ? values.filter(Boolean).map(String) : [];
  if (!items.length) return "";
  try {
    return new Intl.ListFormat(getUiLocale(), { style: "short", type: "conjunction" }).format(items);
  } catch (_error) {
    return items.join(", ");
  }
}

function syncUiLocale() {
  const locale = UI_I18N.setLocale(getUiLocale(), { announce: false });
  // Static translation bindings must not replace the live speech state with
  // their initial "standby" text during an ordinary status refresh.
  renderTtsPlaybackStatus();
  return locale;
}

function normalizeGameUiLayout(value) {
  return GAME_UI_LAYOUTS.includes(value) ? value : DEFAULT_GAME_UI_LAYOUT;
}

function normalizeStoryNotebookTheme(value) {
  return ["light", "dark"].includes(value) ? value : "light";
}

function renderGameUiLayout() {
  const layout = normalizeGameUiLayout(state.gameUiLayout);
  state.gameUiLayout = layout;
  ui.gameView.dataset.uiLayout = layout;
  ui.gameView.dataset.notebookTheme = normalizeStoryNotebookTheme(state.storyNotebookTheme);
  document.body.dataset.gameUiLayout = layout;
  document.body.dataset.storyNotebookTheme = normalizeStoryNotebookTheme(state.storyNotebookTheme);
  renderStoryNotebookMetadata();
  syncNotebookPresentation();
}

function renderStoryNotebookMetadata() {
  const worldTitle = normalizeReadableDisplayText(state.lockedContent?.world?.title, getUiLocale());
  ui.storyNotebookWorldTitle.textContent = worldTitle;
  ui.storyNotebookWorldCard.hidden = !worldTitle;

  const modelLabel = formatModelStatusText();
  ui.storyNotebookModelStatusText.textContent = modelLabel;
  const liveLabel = t("game.notebook.liveModel", { model: modelLabel });
  ui.storyNotebookLive.setAttribute("aria-label", liveLabel);
  ui.storyNotebookLive.removeAttribute("title");
  renderStoryNotebookModuleCount();
  if (isStoryNotebookDrawerOpen("state")) {
    renderStoryNotebookDrawer({ preserveScroll: true });
  }
}

// Kept as a compatibility seam for existing desktop fixtures. All values now
// normalize to the one supported notebook presentation.
function setGameUiLayout(value) {
  state.gameUiLayout = normalizeGameUiLayout(value);
  renderGameUiLayout();
  return state.gameUiLayout;
}

const STORY_NOTEBOOK_DRAWER_PANELS = new Set(["state", "characters", "modules", "chapters", "directory"]);
function isStoryNotebookDrawerOpen(panel = null) {
  const open = Boolean(
    ui.storyNotebookDrawer?.classList.contains("is-open")
    && state.notebookDrawerPanel
  );
  return panel ? open && state.notebookDrawerPanel === panel : open;
}

function isStoryNotebookPanelDrawerOpen() {
  return isStoryNotebookDrawerOpen("modules") || isStoryNotebookDrawerOpen("characters");
}

function renderStoryNotebookCharacterAvailability() {
  if (!ui.storyNotebookCharactersButton) return;
  const available = Boolean(state.characterPanelEntry?.panelRef);
  const resolving = !available
    && state.characterPanelSupported === null
    && state.characterPanelRefreshBusy
    && state.gameStarted
    && Boolean(state.activeSaveId);
  const retryable = !available
    && Boolean(state.characterPanelRefreshError)
    && state.gameStarted
    && Boolean(state.activeSaveId);
  const visible = available || retryable || resolving;
  const label = t(retryable
    ? "game.notebook.charactersRetry"
    : "game.notebook.charactersOpen");
  ui.gameView.classList.toggle("has-character-panel", visible);
  ui.storyNotebookCharactersButton.hidden = !visible;
  ui.storyNotebookCharactersButton.disabled = state.busy
    || state.characterPanelRefreshBusy
    || !visible
    || !state.gameStarted
    || !state.activeSaveId;
  ui.storyNotebookCharactersButton.setAttribute("aria-label", label);
  ui.storyNotebookCharactersButton.title = label;
  renderLoadedSkillSlots();
}

function invalidateStoryNotebookNavigation() {
  return ++state.notebookNavigationRevision;
}

function invalidateStoryNotebookPanelViewRequests() {
  state.skillPanelViewRequestRevision += 1;
  state.skillPanelRefreshBusy = false;
}

function captureRuntimeViewBinding() {
  return { adventureId: state.activeSaveId, sessionId: state.runtimeSessionId,
    sessionMode: state.runtimeProtocol === "session-1", revision: state.activeSave?.revision ?? null };
}

function isRuntimeViewBindingCurrent(binding, { includeRevision = true } = {}) {
  return state.activeSaveId === binding.adventureId && state.runtimeSessionId === binding.sessionId
    && (state.runtimeProtocol === "session-1") === binding.sessionMode
    && (!binding.sessionMode || !includeRevision || (state.activeSave?.revision ?? null) === binding.revision);
}

function isRuntimePanelResultCurrent(binding, result) {
  if (!isRuntimeViewBindingCurrent(binding) || !result || result.stale) return false;
  if (!binding.sessionMode) return true;
  return result.adventureId === binding.adventureId && result.revision === binding.revision
    && result.status?.runtimeSessionId === binding.sessionId
    && result.status?.activeSaveId === binding.adventureId
    && result.status?.activeSave?.revision === binding.revision;
}

function renderStoryNotebookModuleCount() {
  if (!ui.storyNotebookModuleCount) return;
  const source = state.skillPanelSupported === true || (state.skillPanelSupported === null && state.skillPanelRefreshError)
    ? state.skillPanels
    : state.skillModules;
  const count = Array.isArray(source) ? source.length : 0;
  ui.storyNotebookModuleCount.textContent = String(count);
  ui.storyNotebookModuleCount.hidden = count === 0;
}

function syncStoryNotebookRailState() {
  const open = isStoryNotebookDrawerOpen();
  for (const button of ui.storyNotebookRailButtons) {
    const active = open && state.notebookDrawerPanel === button.dataset.notebookPanel;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-expanded", String(active));
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

function setStoryNotebookDrawerHeader({ eyebrow = "", title = "", status = "", back = false, refresh = false } = {}) {
  ui.storyNotebookDrawerEyebrow.textContent = eyebrow;
  ui.storyNotebookDrawerTitle.textContent = title;
  ui.storyNotebookDrawerStatus.textContent = status;
  ui.storyNotebookDrawerBackButton.hidden = !back;
  ui.storyNotebookDrawerRefreshButton.hidden = !refresh;
}

function createStoryNotebookDrawerSection(title, note = "") {
  const section = document.createElement("section");
  section.className = "story-notebook-drawer-section";
  if (title) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    section.appendChild(heading);
  }
  if (note) {
    const help = document.createElement("p");
    help.className = "story-notebook-drawer-help";
    help.textContent = note;
    section.appendChild(help);
  }
  return section;
}

function readStoryNotebookStateValue(key) {
  const value = ui.stateGrid.querySelector(`[data-state-key="${key}"][data-state-role="value"]`)?.textContent;
  return typeof value === "string" && value.trim() ? value : t("game.unknown");
}

function renderStoryNotebookStateDrawer() {
  setStoryNotebookDrawerHeader({
    eyebrow: t("game.notebook.stateEyebrow"),
    title: t("game.notebook.stateTitle"),
    status: t("game.notebook.stateStatus"),
  });
  const section = createStoryNotebookDrawerSection(t("game.notebook.stateSnapshot"));
  const list = document.createElement("dl");
  list.className = "story-notebook-state-list";
  const rows = [
    [t("game.notebook.world"), ui.storyNotebookWorldTitle.textContent?.trim() || t("game.unknown")],
    [t("game.location"), readStoryNotebookStateValue("location")],
    [t("game.state"), readStoryNotebookStateValue("player")],
    [t("game.currentGameDay"), readStoryNotebookStateValue("gameDay")],
    [t("game.turn"), readStoryNotebookStateValue("turn")],
    [t("game.hostStatus"), ui.turnStatus.textContent?.trim() || t("game.turn.waiting")],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    row.append(term, detail);
    list.appendChild(row);
  }
  section.appendChild(list);
  ui.storyNotebookDrawerBody.appendChild(section);
}

function renderStoryNotebookDirectoryDrawer() {
  setStoryNotebookDrawerHeader({
    eyebrow: t("game.notebook.directoryEyebrow"),
    title: t("game.notebook.directoryTitle"),
    status: t("game.notebook.directoryStatus"),
  });
  const section = createStoryNotebookDrawerSection(t("game.notebook.directoryActions"));
  const list = document.createElement("div");
  list.className = "story-notebook-module-list story-notebook-panel-list story-notebook-directory-list";
  const routes = [
    ["settings", "settings", ui.gameSettingsButton],
    ["chapters", "chapters", ui.storyNotebookChaptersButton],
    ["records", "modules", ui.storyNotebookModulesButton],
    ["save", "index", ui.manualSaveButton],
    ["return", "index", ui.backToMenuButton],
  ];
  for (const [key, iconName, source] of routes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-notebook-module-card story-notebook-panel-card";
    button.dataset.storyNotebookDirectoryTarget = source?.id || "";
    button.disabled = !source?.isConnected || Boolean(source.disabled || source.hidden);

    const icon = document.createElement("span");
    icon.className = "notebook-icon-art";
    icon.innerHTML = window.NotebookLabIcons?.objectMarkup(iconName, {
      size: 42,
      className: "lab-object-icon",
    }) || "";
    const copy = document.createElement("span");
    copy.className = "story-notebook-module-copy";
    const title = document.createElement("strong");
    title.textContent = t(`game.notebook.directory.${key}`);
    copy.appendChild(title);
    button.append(icon, copy);
    button.addEventListener("click", () => {
      if (button.disabled || !source?.isConnected || source.disabled || source.hidden) return;
      closeStoryNotebookDrawer({ restoreFocus: false, onSettled: () => source.click() });
    });
    list.appendChild(button);
  }
  section.appendChild(list);
  ui.storyNotebookDrawerBody.appendChild(section);
}

function getStoryNotebookModuleKey(module = {}) {
  return module.moduleRef || `${module.packTitle || ""}\u0000${module.title || ""}`;
}

function renderStoryNotebookModuleList() {
  if (state.skillPanelSupported === true || (state.skillPanelSupported === null && state.skillPanelRefreshError)) {
    renderStoryNotebookPanelList();
    return;
  }
  const modules = Array.isArray(state.skillModules) ? state.skillModules : [];
  setStoryNotebookDrawerHeader({
    eyebrow: t("game.notebook.modulesEyebrow"),
    title: t("game.notebook.modulesTitle"),
    status: state.skillModuleRefreshError
      ? t("skillPanel.refreshRetaining")
      : t("skillPanel.lockedCount", { count: modules.length }),
    refresh: true,
  });
  ui.storyNotebookDrawerRefreshButton.disabled = state.skillPanelRefreshBusy;

  const intro = createStoryNotebookDrawerSection(
    t("game.notebook.modulesEnabled", { count: modules.length }),
    t("game.notebook.modulesIntro")
  );
  ui.storyNotebookDrawerBody.appendChild(intro);
  const listSection = createStoryNotebookDrawerSection("");
  const list = document.createElement("div");
  list.className = "story-notebook-module-list";
  if (!modules.length) {
    const empty = document.createElement("p");
    empty.className = "skill-module-empty";
    empty.textContent = state.skillModuleRefreshError
      ? t("skillPanel.retainFailed")
      : t("skillPanel.noSkills");
    list.appendChild(empty);
  }
  modules.forEach((module, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-notebook-module-card";
    button.dataset.moduleIndex = String(index);
    const icon = document.createElement("span");
    icon.className = "notebook-icon-art";
    icon.innerHTML = window.NotebookLabIcons?.objectMarkup("modules", {
      size: 42,
      className: "lab-object-icon",
    }) || "";
    const copy = document.createElement("span");
    copy.className = "story-notebook-module-copy";
    const kicker = document.createElement("small");
    kicker.textContent = module.packTitle || t("game.notebook.skillEyebrow");
    const title = document.createElement("strong");
    title.textContent = module.title || "Skill";
    const summary = document.createElement("span");
    summary.textContent = (module.summary || []).map((entry) => entry.text).filter(Boolean).join(" / ")
      || module.description
      || t("skillPanel.noGuide");
    copy.append(kicker, title, summary);
    const moduleState = document.createElement("span");
    moduleState.className = "story-notebook-module-state";
    moduleState.textContent = t(module.visibility === "hidden_until_active"
      ? "skillPanel.identity.activated"
      : "skillPanel.identity.visible");
    button.append(icon, copy, moduleState);
    button.setAttribute("aria-label", t("skillPanel.openAria", { title: module.title || "Skill" }));
    button.addEventListener("click", () => openStoryNotebookModuleDetail(module));
    list.appendChild(button);
  });
  listSection.appendChild(list);
  ui.storyNotebookDrawerBody.appendChild(listSection);
}

const STORY_NOTEBOOK_PANEL_GROUPS = Object.freeze([
  "story_records",
  "adventure_gameplay",
  "player_extensions",
]);

function renderStoryNotebookPanelList() {
  const panels = Array.isArray(state.skillPanels) ? state.skillPanels : [];
  setStoryNotebookDrawerHeader({
    eyebrow: t("game.notebook.modulesEyebrow"),
    title: t("game.notebook.modulesTitle"),
    status: state.skillPanelRefreshError
      ? t("game.notebook.panelRefreshRetaining")
      : t("game.notebook.panelCount", { count: panels.length }),
    refresh: true,
  });
  ui.storyNotebookDrawerRefreshButton.disabled = state.skillPanelRefreshBusy;

  const intro = createStoryNotebookDrawerSection(
    t("game.notebook.modulesEnabled", { count: panels.length }),
    t("game.notebook.panelIntro")
  );
  ui.storyNotebookDrawerBody.appendChild(intro);

  const groups = new Map(STORY_NOTEBOOK_PANEL_GROUPS.map((group) => [group, []]));
  for (const panel of panels) {
    if (groups.has(panel.group)) groups.get(panel.group).push(panel);
  }
  let rendered = 0;
  for (const group of STORY_NOTEBOOK_PANEL_GROUPS) {
    const groupPanels = groups.get(group);
    if (!groupPanels?.length) continue;
    const section = createStoryNotebookDrawerSection(
      t(`game.notebook.panelGroup.${group}`),
      t(`game.notebook.panelGroupNote.${group}`)
    );
    section.classList.add("story-notebook-panel-group");
    const list = document.createElement("div");
    list.className = "story-notebook-module-list story-notebook-panel-list";
    for (const panel of groupPanels) {
      const index = rendered;
      rendered += 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "story-notebook-module-card story-notebook-panel-card";
      button.dataset.panelIndex = String(index);
      button.dataset.panelRef = panel.panelRef;
      const icon = document.createElement("span");
      icon.className = "notebook-icon-art";
      icon.innerHTML = window.NotebookLabIcons?.objectMarkup("modules", {
        size: 42,
        className: "lab-object-icon",
      }) || "";
      const copy = document.createElement("span");
      copy.className = "story-notebook-module-copy";
      const title = document.createElement("strong");
      title.textContent = panel.title || t("game.notebook.skillEyebrow");
      const summary = document.createElement("span");
      summary.textContent = panel.playerGuide || panel.description || t("skillPanel.noGuide");
      copy.append(title, summary);
      button.append(icon, copy);
      button.setAttribute("aria-label", t("game.notebook.panelOpenAria", {
        title: panel.title || t("game.notebook.skillEyebrow"),
        group: t(`game.notebook.panelGroup.${panel.group}`),
      }));
      button.addEventListener("click", () => openStoryNotebookPanelDetail(panel));
      list.appendChild(button);
    }
    section.appendChild(list);
    ui.storyNotebookDrawerBody.appendChild(section);
  }

  if (!rendered) {
    const empty = document.createElement("p");
    empty.className = "skill-module-empty story-notebook-panel-empty";
    empty.textContent = state.skillPanelRefreshError
      ? t("game.notebook.panelRefreshFailed")
      : t("game.notebook.panelEmpty");
    ui.storyNotebookDrawerBody.appendChild(empty);
  }
}

function renderStoryNotebookModuleDetail() {
  if (state.notebookDrawerView.startsWith("panel-")) {
    renderStoryNotebookPanelDetail();
    return;
  }
  const module = state.activeSkillModule;
  if (!module) {
    state.notebookDrawerView = "module-list";
    renderStoryNotebookModuleList();
    return;
  }
  setStoryNotebookDrawerHeader({
    eyebrow: module.packTitle || t("game.notebook.skillEyebrow"),
    title: module.title || t("game.notebook.skillEyebrow"),
    status: state.skillModuleRefreshError ? t("skillPanel.refreshRetaining") : t("skillPanel.status"),
    back: true,
    refresh: true,
  });

  const guide = createStoryNotebookDrawerSection(t("skillPanel.guideTitle"));
  const guideBody = document.createElement("div");
  guideBody.className = "skill-module-guide";
  guide.appendChild(guideBody);
  renderSafeSkillGuide(module.playerGuide || module.description || t("skillPanel.noGuide"), guideBody);

  const fields = createStoryNotebookDrawerSection(t("game.notebook.panelStateTitle"));
  const fieldBody = document.createElement("div");
  fieldBody.className = "skill-module-fields";
  fields.appendChild(fieldBody);
  renderSkillModuleFields(module, { container: fieldBody, pages: state.skillModulePages, showWidgetLabel: false });
  ui.storyNotebookDrawerBody.append(guide, fields);
}

function renderStoryNotebookPanelDetail() {
  const panel = state.activeSkillPanel;
  const projection = state.activeSkillPanelProjection;
  if (!panel) {
    if (isStoryNotebookDrawerOpen("characters")) {
      setStoryNotebookDrawerHeader({
        eyebrow: t("game.notebook.charactersEyebrow"),
        title: t("game.notebook.charactersTitle"),
        status: t("game.notebook.charactersUnavailable"),
        refresh: true,
      });
      appendSkillModuleEmpty(t("game.notebook.charactersUnavailable"), ui.storyNotebookDrawerBody);
      return;
    }
    state.notebookDrawerView = "module-list";
    renderStoryNotebookModuleList();
    return;
  }
  if (state.notebookDrawerView === "panel-list") {
    renderStoryNotebookPanelRecordList(panel, projection);
    return;
  }
  if (state.notebookDrawerView === "panel-item-detail") {
    renderStoryNotebookPanelRecordDetail(panel, projection);
    return;
  }

  setStoryNotebookDrawerHeader({
    eyebrow: t(`game.notebook.panelGroup.${panel.group}`),
    title: panel.title || t("game.notebook.skillEyebrow"),
    status: state.skillPanelViewError
      ? t("game.notebook.panelViewRetaining")
      : "",
    back: true,
    refresh: true,
  });
  ui.storyNotebookDrawerRefreshButton.disabled = state.skillPanelRefreshBusy;
  appendStoryNotebookPanelError();

  const guide = createStoryNotebookDrawerSection(t("skillPanel.guideTitle"));
  const guideBody = document.createElement("div");
  guideBody.className = "skill-module-guide";
  guide.appendChild(guideBody);
  renderSafeSkillGuide(panel.playerGuide || panel.description || t("skillPanel.noGuide"), guideBody);
  ui.storyNotebookDrawerBody.appendChild(guide);

  if (!projection) {
    appendStoryNotebookPanelLoading();
    return;
  }
  appendStoryNotebookPanelSummary(projection.summary);
  if (panel.surface !== "guide" || projection.fields?.length) {
    const fields = createStoryNotebookDrawerSection(t("game.notebook.panelStateTitle"));
    const fieldBody = document.createElement("div");
    fieldBody.className = "skill-module-fields story-notebook-panel-fields";
    renderStoryNotebookPanelFields(projection.fields, fieldBody, { showWidgetLabel: false });
    fields.appendChild(fieldBody);
    ui.storyNotebookDrawerBody.appendChild(fields);
  }

  if (["list_detail", "timeline"].includes(panel.surface)) {
    const records = createStoryNotebookDrawerSection(
      t(panel.surface === "timeline"
        ? "game.notebook.panelTimelineTitle"
        : "game.notebook.panelRecordsTitle"),
      t("game.notebook.panelRecordsNote")
    );
    const actions = document.createElement("div");
    actions.className = "story-notebook-panel-list-actions";
    for (const field of projection.fields.filter((entry) =>
      state.skillPanelRecordFieldIds.includes(entry.id))) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-button story-notebook-panel-list-action";
      button.dataset.fieldId = field.id;
      button.textContent = t("game.notebook.panelBrowseField", { label: field.label });
      button.addEventListener("click", () => openStoryNotebookPanelList(field.id));
      actions.appendChild(button);
    }
    if (!actions.childElementCount) {
      appendSkillModuleEmpty(t("game.notebook.panelNoRecordView"), actions);
    }
    records.appendChild(actions);
    ui.storyNotebookDrawerBody.appendChild(records);
  }
}

function appendStoryNotebookPanelLoading() {
  const loading = document.createElement("p");
  loading.className = "skill-module-empty story-notebook-panel-loading";
  loading.textContent = state.skillPanelViewError
    ? t("game.notebook.panelViewFailed")
    : t("game.notebook.panelLoading");
  ui.storyNotebookDrawerBody.appendChild(loading);
}

function appendStoryNotebookPanelError() {
  if (!state.skillPanelViewError) return;
  const error = document.createElement("p");
  error.className = "story-notebook-panel-error";
  error.setAttribute("role", "status");
  error.textContent = state.skillPanelViewError;
  ui.storyNotebookDrawerBody.appendChild(error);
}

function appendStoryNotebookPanelSummary(summary = []) {
  if (!Array.isArray(summary) || !summary.length) return;
  const section = createStoryNotebookDrawerSection(t("game.notebook.panelSummary"));
  const list = document.createElement("dl");
  list.className = "story-notebook-panel-summary";
  for (const entry of summary) {
    const row = document.createElement("div");
    const label = document.createElement("dt");
    label.textContent = entry.label;
    const value = document.createElement("dd");
    value.textContent = entry.text;
    row.append(label, value);
    list.appendChild(row);
  }
  section.appendChild(list);
  ui.storyNotebookDrawerBody.appendChild(section);
}

function renderStoryNotebookPanelFields(fields = [], container, options = {}) {
  container.replaceChildren();
  if (!Array.isArray(fields) || !fields.length) {
    appendSkillModuleEmpty(t("skillPanel.noFields"), container);
    return;
  }
  for (const field of fields) {
    const card = renderSkillModuleField(
      {},
      storyNotebookPanelFieldAsModuleField(field, options),
      { interactive: false, showWidgetLabel: options.showWidgetLabel }
    );
    if (options.detailSectionId && isNativeStoryNotebookDetail(options.panelRef)) {
      const key = `field:${options.detailSectionId}:${field.id}`;
      if (typeof field.value === "string" && isLongStoryNotebookDetailText(field.value)) {
        const full = document.createElement("p");
        full.className = "story-notebook-detail-full-text";
        full.dataset.detailReadingKey = `text:${key}`;
        full.textContent = field.value;
        const details = createStoryNotebookDetailText(key, t("game.notebook.detailReadField", { label: field.label }));
        details.appendChild(full);
        container.appendChild(details);
        continue;
      }
      card.dataset.detailReadingKey = key;
    }
    container.appendChild(card);
  }
}

function isNativeStoryNotebookDetail(panelRef = state.activeSkillPanel?.panelRef) {
  return panelRef === "session_characters" || panelRef === "session_inventory";
}

function isLongStoryNotebookDetailText(text) {
  const limit = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text) ? 240 : 600;
  return Array.from(text).length > limit;
}

function createStoryNotebookDetailText(key, label) {
  const details = document.createElement("details");
  details.className = "story-notebook-detail-text";
  details.dataset.detailReadingKey = key;
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.appendChild(summary);
  return details;
}

function storyNotebookDetailReadingBinding() {
  if (state.notebookDrawerView !== "panel-item-detail" || !isNativeStoryNotebookDetail()) return null;
  return JSON.stringify([state.activeSaveId, state.runtimeSessionId, state.activeSave?.revision,
    state.activeSkillPanel.panelRef, state.notebookDrawerSelectedFieldId,
    state.notebookDrawerSelectedItemRef, state.localeRevision]);
}

function captureStoryNotebookDetailReadingState(container) {
  const binding = storyNotebookDetailReadingBinding();
  const empty = { binding, opened: new Set(), scrollTop: 0, anchor: null, focusKey: null };
  if (!binding || container.detailReadingBinding !== binding) return empty;
  const cards = Array.from(container.querySelectorAll("[data-detail-reading-key]"));
  const bounds = container.getBoundingClientRect();
  const anchor = cards.find(card => {
    if (card.tagName === "DETAILS" && card.open) return false;
    const rect = card.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > bounds.top;
  });
  const focused = cards.find(card => card === document.activeElement
    || (card.tagName === "DETAILS" && card.querySelector("summary") === document.activeElement));
  return { binding, scrollTop: container.scrollTop,
    opened: new Set(cards.filter(card => card.tagName === "DETAILS" && card.open).map(card => card.dataset.detailReadingKey)),
    anchor: anchor ? { key: anchor.dataset.detailReadingKey, offset: getChapterScrollOffset(container, anchor) } : null,
    focusKey: focused?.dataset.detailReadingKey || null };
}

function restoreStoryNotebookDetailReadingState(container, reading) {
  if (!reading.binding || container.detailReadingBinding !== reading.binding) return;
  const cards = Array.from(container.querySelectorAll("[data-detail-reading-key]"));
  for (const card of cards) if (card.tagName === "DETAILS") card.open = reading.opened.has(card.dataset.detailReadingKey);
  container.scrollTop = reading.scrollTop;
  const anchor = cards.find(card => card.dataset.detailReadingKey === reading.anchor?.key);
  if (anchor) container.scrollTop += getChapterScrollOffset(container, anchor) - reading.anchor.offset;
  if (!document.activeElement || document.activeElement === document.body || container.contains(document.activeElement)) {
    const focused = cards.find(card => card.dataset.detailReadingKey === reading.focusKey);
    (focused?.tagName === "DETAILS" ? focused.querySelector("summary") : focused)?.focus({ preventScroll: true });
  }
}

function storyNotebookPanelFieldAsModuleField(field = {}, options = {}) {
  const typeByKind = {
    text: "string",
    number: "number",
    boolean: "boolean",
    badge: "string",
    chips: "string_list",
    progress: "number",
  };
  const widgetByKind = {
    text: "text",
    number: "number",
    boolean: "indicator",
    badge: "badge",
    chips: "chips",
    progress: "progress",
  };
  return {
    id: field.id,
    label: field.label,
    type: typeByKind[field.kind] || "string",
    widget: options.panelRef === "session_characters" && field.id === "status" && field.kind === "chips"
      ? "list" : widgetByKind[field.kind] || "text",
    value: field.value,
    derivedSummary: null,
    minimum: field.minimum,
    maximum: field.maximum,
    options: [],
    itemFields: [],
  };
}

function renderStoryNotebookPanelRecordList(panel, projection) {
  const characterPage = isStoryNotebookDrawerOpen("characters");
  setStoryNotebookDrawerHeader({
    eyebrow: characterPage
      ? t("game.notebook.charactersEyebrow")
      : (panel.title || t("game.notebook.skillEyebrow")),
    title: characterPage
      ? t("game.notebook.charactersTitle")
      : t(panel.surface === "timeline"
        ? "game.notebook.panelTimelineTitle"
        : "game.notebook.panelRecordsTitle"),
    status: state.skillPanelViewError
      ? t("game.notebook.panelViewRetaining")
      : (projection
        ? t("game.notebook.panelListCount", {
          shown: projection?.items?.length || 0,
          total: projection?.pagination?.totalItems || 0,
        })
        : t("game.notebook.charactersStatus")),
    back: !characterPage,
    refresh: true,
  });
  ui.storyNotebookDrawerRefreshButton.disabled = state.skillPanelRefreshBusy;
  appendStoryNotebookPanelError();
  if (!projection) {
    appendStoryNotebookPanelLoading();
    return;
  }
  const section = createStoryNotebookDrawerSection(
    t(characterPage ? "game.notebook.charactersIndex" : "game.notebook.panelRecordIndex"),
    t(characterPage ? "game.notebook.charactersIndexNote" : "game.notebook.panelRecordIndexNote")
  );
  const list = document.createElement("div");
  list.className = `story-notebook-panel-record-list${panel.surface === "timeline" ? " is-timeline" : ""}`;
  for (const [index, item] of projection.items.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-notebook-panel-record";
    button.dataset.itemIndex = String(index);
    button.dataset.itemRef = item.ref;
    const title = document.createElement("strong");
    title.textContent = item.title;
    const subtitle = document.createElement("span");
    subtitle.textContent = item.subtitle || t("game.notebook.panelNoSubtitle");
    button.append(title, subtitle);
    if (item.statusLabel || Number.isInteger(item.updatedTurn)) {
      const meta = document.createElement("small");
      meta.textContent = [
        item.statusLabel,
        Number.isInteger(item.updatedTurn)
          ? t("game.notebook.panelUpdatedTurn", { turn: item.updatedTurn })
          : "",
      ].filter(Boolean).join(" · ");
      button.appendChild(meta);
    }
    button.setAttribute("aria-label", t("game.notebook.panelRecordOpenAria", { title: item.title }));
    button.addEventListener("click", () => openStoryNotebookPanelItem(item));
    list.appendChild(button);
  }
  if (!projection.items.length) {
    appendSkillModuleEmpty(t("game.notebook.panelNoRecords"), list);
  }
  section.appendChild(list);
  if (projection.pagination?.hasMore) {
    const loadMore = document.createElement("button");
    loadMore.type = "button";
    loadMore.className = "menu-button story-notebook-panel-load-more";
    loadMore.textContent = t("skillPanel.loadMore");
    loadMore.disabled = state.skillPanelRefreshBusy;
    loadMore.addEventListener("click", () => loadMoreStoryNotebookPanelRecords());
    section.appendChild(loadMore);
  }
  ui.storyNotebookDrawerBody.appendChild(section);
}

function renderStoryNotebookPanelRecordDetail(panel, projection) {
  const detail = projection?.detail;
  const nativeDetail = isNativeStoryNotebookDetail(projection?.panelRef);
  ui.storyNotebookDrawerBody.detailReadingBinding = nativeDetail ? storyNotebookDetailReadingBinding() : null;
  setStoryNotebookDrawerHeader({
    eyebrow: panel.title || t("game.notebook.skillEyebrow"),
    title: detail?.title || t("game.notebook.panelRecordDetail"),
    status: state.skillPanelViewError
      ? t("game.notebook.panelViewRetaining")
      : (detail?.subtitle || t("game.notebook.panelReadOnly")),
    back: true,
    refresh: true,
  });
  ui.storyNotebookDrawerRefreshButton.disabled = state.skillPanelRefreshBusy;
  appendStoryNotebookPanelError();
  if (!detail) {
    appendStoryNotebookPanelLoading();
    return;
  }
  for (const detailSection of detail.sections) {
    // Page structure stays stable for merging, but an unloaded native section
    // is not an assertion that the character or item has no such information.
    if (nativeDetail && detailSection.id !== "attribute_text"
      && !detailSection.fields.length && !detailSection.records.length) continue;
    const section = createStoryNotebookDrawerSection(detailSection.title);
    section.dataset.detailSectionId = detailSection.id;
    const fullTextSection = nativeDetail && detailSection.id === "attribute_text";
    const openCommitments = nativeDetail && detailSection.id === "commitments_open";
    const historyCommitments = nativeDetail && detailSection.id === "commitments_history";
    const total = detailSection.fields.find(field => field.id === "record_count")?.value;
    const shown = detailSection.records.length;
    let recordContainer = section;
    if (fullTextSection || historyCommitments) {
      const details = createStoryNotebookDetailText(`section:${detailSection.id}`,
        t(fullTextSection ? "game.notebook.detailTextLoaded" : "game.notebook.detailCommitmentHistory", { shown, total }));
      section.appendChild(details);
      recordContainer = details;
    } else if (openCommitments) {
      const count = document.createElement("p");
      count.className = "story-notebook-detail-count";
      count.textContent = t("game.notebook.panelListCount", { shown, total });
      section.appendChild(count);
    } else if (detailSection.fields.length || !detailSection.records.length) {
      const fields = document.createElement("div");
      fields.className = "skill-module-fields story-notebook-panel-fields";
      renderStoryNotebookPanelFields(detailSection.fields, fields, { showWidgetLabel: false,
        panelRef: projection.panelRef, detailSectionId: detailSection.id });
      section.appendChild(fields);
    }
    if ((fullTextSection || openCommitments || historyCommitments) && shown < total) {
      const incomplete = document.createElement("p");
      incomplete.className = "story-notebook-detail-incomplete";
      incomplete.textContent = t(fullTextSection ? "game.notebook.detailTextIncomplete" : "game.notebook.detailCommitmentsIncomplete");
      section.appendChild(incomplete);
    }
    if (detailSection.records.length) {
      const records = document.createElement("div");
      records.className = "story-notebook-panel-detail-records";
      for (const record of detailSection.records) {
        const article = document.createElement("article");
        article.className = "story-notebook-panel-detail-record";
        article.dataset.detailRecordId = record.id;
        if (nativeDetail) article.dataset.detailReadingKey = `record:${record.id}`;
        article.tabIndex = -1;
        const label = document.createElement("strong");
        label.className = "story-notebook-detail-record-label";
        label.textContent = record.label || t("game.notebook.panelRecord");
        article.appendChild(label);
        if ((openCommitments || historyCommitments) && typeof record.heading === "string") {
          const heading = document.createElement("p");
          heading.className = "story-notebook-commitment-heading";
          heading.textContent = record.heading;
          article.appendChild(heading);
        }
        const text = document.createElement("p");
        text.className = "story-notebook-detail-record-text";
        text.textContent = record.text;
        if (openCommitments && isLongStoryNotebookDetailText(record.text)) {
          const terms = createStoryNotebookDetailText(`terms:${record.id}`, t("game.notebook.detailReadCommitmentTerms"));
          terms.appendChild(text);
          article.appendChild(terms);
        } else article.appendChild(text);
        if (Number.isInteger(record.turn)) {
          const turn = document.createElement("small");
          turn.textContent = t("game.notebook.panelUpdatedTurn", { turn: record.turn });
          article.appendChild(turn);
        }
        records.appendChild(article);
      }
      recordContainer.appendChild(records);
    }
    ui.storyNotebookDrawerBody.appendChild(section);
  }
  if (projection.pagination?.hasMore) {
    const loadMore = document.createElement("button");
    loadMore.type = "button";
    loadMore.className = "menu-button story-notebook-panel-load-more";
    loadMore.textContent = t("skillPanel.loadMore");
    loadMore.disabled = state.skillPanelRefreshBusy;
    loadMore.addEventListener("click", () => loadMoreStoryNotebookPanelDetail());
    ui.storyNotebookDrawerBody.appendChild(loadMore);
  }
}

function renderStoryNotebookChapterDrawer() {
  setStoryNotebookDrawerHeader({
    eyebrow: t("game.notebook.chaptersEyebrow"),
    title: t("chapter.title"),
    status: t("chapter.loading"),
    refresh: true,
  });
  ui.storyNotebookDrawerBody.classList.add("chapter-log-list");
  renderChapterLogs([], ui.storyNotebookDrawerBody);
}

function renderStoryNotebookDrawer({ preserveScroll = false } = {}) {
  if (!state.notebookDrawerPanel) return;
  const detailReading = captureStoryNotebookDetailReadingState(ui.storyNotebookDrawerBody);
  const previousScrollTop = preserveScroll ? ui.storyNotebookDrawerBody.scrollTop : 0;
  if (state.notebookDrawerPanel === "chapters") {
    ui.storyNotebookDrawerBody.chapterReadingState = captureChapterReadingState(ui.storyNotebookDrawerBody);
  }
  ui.storyNotebookDrawerBody.className = "story-notebook-drawer-body";
  ui.storyNotebookDrawerBody.replaceChildren();
  if (state.notebookDrawerPanel === "state") renderStoryNotebookStateDrawer();
  else if (state.notebookDrawerPanel === "directory") renderStoryNotebookDirectoryDrawer();
  else if (state.notebookDrawerPanel === "characters") renderStoryNotebookPanelDetail();
  else if (state.notebookDrawerPanel === "modules") {
    if (state.notebookDrawerView === "module-detail" || state.notebookDrawerView.startsWith("panel-")) {
      renderStoryNotebookModuleDetail();
    }
    else renderStoryNotebookModuleList();
  } else if (state.notebookDrawerPanel === "chapters") renderStoryNotebookChapterDrawer();
  ui.storyNotebookDrawerBody.scrollTop = previousScrollTop;
  restoreStoryNotebookDetailReadingState(ui.storyNotebookDrawerBody, detailReading);
}

function focusStoryNotebookDrawerTitle() {
  if (state.notebookDrawerFocusTimer !== null) window.clearTimeout(state.notebookDrawerFocusTimer);
  state.notebookDrawerFocusTimer = window.setTimeout(() => {
    state.notebookDrawerFocusTimer = null;
    if (isStoryNotebookDrawerOpen()) ui.storyNotebookDrawerTitle.focus({ preventScroll: true });
  }, 0);
}

function openStoryNotebookDrawer(panel, opener = null) {
  if (!STORY_NOTEBOOK_DRAWER_PANELS.has(panel)) return;
  const navigationRevision = invalidateStoryNotebookNavigation();
  if (panel === "characters" && !state.characterPanelEntry?.panelRef) {
    if (!state.characterPanelRefreshError || state.characterPanelRefreshBusy) return;
    const binding = captureRuntimeViewBinding();
    const retryOpener = opener || document.activeElement;
    void refreshStoryNotebookCharacterPanelEntry().then((refreshed) => {
      // The catalog may still refresh, but an old retry no longer owns the
      // player's destination after another navigation or runtime change.
      if (refreshed && state.characterPanelEntry?.panelRef
        && state.notebookNavigationRevision === navigationRevision
        && isRuntimeViewBindingCurrent(binding)) {
        openStoryNotebookDrawer("characters", retryOpener);
      }
    });
    return;
  }
  if (isStoryNotebookDrawerOpen(panel)) {
    if ((panel === "modules" && state.notebookDrawerView !== "module-list")
      || (panel === "characters" && state.notebookDrawerView === "panel-item-detail")) {
      returnStoryNotebookDrawer();
    } else {
      closeStoryNotebookDrawer();
    }
    return;
  }
  if (isStoryNotebookDrawerOpen()) invalidateStoryNotebookPanelViewRequests();
  state.notebookDrawerPanel = panel;
  state.notebookDrawerView = panel === "modules"
    ? "module-list"
    : panel === "characters" ? "panel-list" : "root";
  state.notebookDrawerOpener = opener || document.activeElement;
  state.notebookDrawerSelectedModuleRef = null;
  state.notebookDrawerSelectedPanelRef = null;
  state.notebookDrawerSelectedFieldId = null;
  state.notebookDrawerSelectedItemRef = null;
  state.activeSkillPanel = panel === "characters" ? state.characterPanelEntry : null;
  state.notebookDrawerSelectedPanelRef = state.activeSkillPanel?.panelRef || null;
  state.skillPanelOverviewProjection = null;
  state.skillPanelListProjection = null;
  state.activeSkillPanelProjection = null;
  state.skillPanelRecordFieldIds = [];
  state.skillPanelViewError = "";
  if (!ui.skillModuleDialog.open) state.activeSkillModule = null;
  state.skillModulePages.clear();
  renderStoryNotebookDrawer();
  ui.gameView.dataset.notebookPage = panel;
  ui.storyNotebookDrawer.classList.add("is-open");
  ui.storyNotebookDrawer.setAttribute("aria-hidden", "false");
  ui.storyNotebookDrawer.removeAttribute("inert");
  syncStoryNotebookRailState();
  focusStoryNotebookDrawerTitle();
  if (panel === "characters") void loadStoryNotebookCharacterDirectory();
  if (panel === "modules") void refreshStoryNotebookSkillPanels();
  if (panel === "chapters") void refreshChapterLogs();
}

function closeStoryNotebookDrawer({ restoreFocus = true, onSettled = null } = {}) {
  invalidateStoryNotebookNavigation();
  if (!ui.storyNotebookDrawer) return;
  if (!isStoryNotebookDrawerOpen()) {
    if (typeof onSettled === "function") onSettled();
    return;
  }
  if (state.notebookDrawerFocusTimer !== null) {
    window.clearTimeout(state.notebookDrawerFocusTimer);
    state.notebookDrawerFocusTimer = null;
  }
  invalidateStoryNotebookPanelViewRequests();
  const opener = state.notebookDrawerOpener;
  ui.storyNotebookDrawer.classList.remove("is-open");
  ui.storyNotebookDrawer.setAttribute("aria-hidden", "true");
  ui.storyNotebookDrawer.setAttribute("inert", "");
  const completeClose = () => {
    delete ui.gameView.dataset.notebookPage;
    state.notebookDrawerPanel = null;
    state.notebookDrawerView = "root";
    state.notebookDrawerOpener = null;
    state.notebookDrawerSelectedModuleRef = null;
    state.notebookDrawerSelectedPanelRef = null;
    state.notebookDrawerSelectedFieldId = null;
    state.notebookDrawerSelectedItemRef = null;
    state.activeSkillPanel = null;
    state.skillPanelOverviewProjection = null;
    state.skillPanelListProjection = null;
    state.activeSkillPanelProjection = null;
    state.skillPanelRecordFieldIds = [];
    state.skillPanelViewError = "";
    if (!ui.skillModuleDialog.open) {
      state.activeSkillModule = null;
      state.skillModulePages.clear();
    }
    syncStoryNotebookRailState();
    if (restoreFocus && opener?.isConnected && typeof opener.focus === "function") {
      opener.focus({ preventScroll: true });
    }
    if (typeof onSettled === "function") onSettled();
  };
  completeClose();
}

function openStoryNotebookModuleDetail(module) {
  if (!module || !isStoryNotebookDrawerOpen("modules")) return;
  invalidateStoryNotebookNavigation();
  state.activeSkillModule = module;
  state.notebookDrawerSelectedModuleRef = getStoryNotebookModuleKey(module);
  state.notebookDrawerView = "module-detail";
  state.skillModulePages.clear();
  renderStoryNotebookDrawer();
  ui.storyNotebookDrawerTitle.focus({ preventScroll: true });
}

function openStoryNotebookPanelDetail(panel) {
  if (!panel || !isStoryNotebookDrawerOpen("modules")) return;
  invalidateStoryNotebookNavigation();
  state.activeSkillPanel = panel;
  state.notebookDrawerSelectedPanelRef = panel.panelRef;
  state.notebookDrawerSelectedFieldId = null;
  state.notebookDrawerSelectedItemRef = null;
  state.skillPanelOverviewProjection = null;
  state.skillPanelListProjection = null;
  state.activeSkillPanelProjection = null;
  state.skillPanelRecordFieldIds = [];
  state.skillPanelViewError = "";
  state.notebookDrawerView = "panel-overview";
  renderStoryNotebookDrawer();
  ui.storyNotebookDrawerTitle.focus({ preventScroll: true });
  void loadStoryNotebookPanelView({ view: "overview" });
}

function openStoryNotebookPanelList(fieldId) {
  if (!state.activeSkillPanel || !fieldId || !isStoryNotebookPanelDrawerOpen()) return;
  invalidateStoryNotebookNavigation();
  state.notebookDrawerSelectedFieldId = fieldId;
  state.notebookDrawerSelectedItemRef = null;
  state.skillPanelListProjection = null;
  state.activeSkillPanelProjection = null;
  state.skillPanelViewError = "";
  state.notebookDrawerView = "panel-list";
  renderStoryNotebookDrawer();
  ui.storyNotebookDrawerTitle.focus({ preventScroll: true });
  void loadStoryNotebookPanelView({ view: "list", fieldId, limit: 12 });
}

function openStoryNotebookPanelItem(item) {
  if (!state.activeSkillPanel || !item?.ref || !state.notebookDrawerSelectedFieldId) return;
  invalidateStoryNotebookNavigation();
  state.notebookDrawerSelectedItemRef = item.ref;
  state.activeSkillPanelProjection = null;
  state.skillPanelViewError = "";
  state.notebookDrawerView = "panel-item-detail";
  renderStoryNotebookDrawer();
  ui.storyNotebookDrawerTitle.focus({ preventScroll: true });
  void loadStoryNotebookPanelView({
    view: "detail",
    fieldId: state.notebookDrawerSelectedFieldId,
    itemRef: item.ref,
  });
}

async function refreshStoryNotebookSkillPanels() {
  const binding = captureRuntimeViewBinding();
  const requestRevision = ++state.skillPanelListRequestRevision;
  const isCurrentRequest = () => state.skillPanelListRequestRevision === requestRevision
    && isRuntimeViewBindingCurrent(binding);
  if (!state.gameStarted || !state.activeSaveId || typeof window.greyCrow?.listSkillPanels !== "function") {
    state.skillPanelSupported = false;
    state.skillPanels = [];
    state.skillPanelRefreshError = "";
    renderStoryNotebookModuleCount();
    if (isStoryNotebookDrawerOpen("modules")) renderStoryNotebookDrawer({ preserveScroll: true });
    return false;
  }
  const selectedPanelRef = state.notebookDrawerSelectedPanelRef;
  state.skillPanelRefreshBusy = true;
  if (isStoryNotebookDrawerOpen("modules")) {
    ui.storyNotebookDrawerRefreshButton.disabled = true;
  }
  try {
    const result = await window.greyCrow.listSkillPanels();
    if (!isCurrentRequest() || !isRuntimePanelResultCurrent(binding, result)) return false;
    if (result.status) applyStatus(result.status);
    if (!isCurrentRequest()) return false;
    if (!result?.ok) {
      state.skillPanelRefreshError = formatError(result?.error, t("game.notebook.panelRefreshFailed"));
      return false;
    }
    if (result.supported === false) {
      state.skillPanelSupported = false;
      state.skillPanels = [];
      state.skillPanelRefreshError = "";
      if (!binding.sessionMode) await refreshSkillModules();
      return isCurrentRequest();
    }
    if (result.supported !== true || !Array.isArray(result.panels)) {
      state.skillPanelRefreshError = t("game.notebook.panelRefreshFailed");
      return false;
    }
    state.skillPanelSupported = true;
    state.skillPanels = result.panels;
    state.skillPanelRefreshError = "";
    return true;
  } catch (error) {
    if (!isCurrentRequest()) return false;
    state.skillPanelRefreshError = formatError(error, t("game.notebook.panelRefreshFailed"));
    return false;
  } finally {
    if (isCurrentRequest()) {
      state.skillPanelRefreshBusy = false;
      renderStoryNotebookModuleCount();
      if (isStoryNotebookDrawerOpen("modules") && state.notebookDrawerView === "module-list") {
        renderStoryNotebookDrawer({ preserveScroll: true });
        if (selectedPanelRef) focusStoryNotebookPanelCard(selectedPanelRef, { fallbackToTitle: false });
      }
    }
  }
}

async function refreshStoryNotebookCharacterPanelEntry() {
  const binding = captureRuntimeViewBinding();
  const requestedSaveId = state.activeSaveId;
  const requestRevision = state.characterPanelRequestRevision + 1;
  state.characterPanelRequestRevision = requestRevision;
  const isCurrentRequest = () =>
    state.characterPanelRequestRevision === requestRevision
    && isRuntimeViewBindingCurrent(binding);
  if (!state.gameStarted
    || !requestedSaveId
    || typeof window.greyCrow?.getCharacterPanelEntry !== "function") {
    state.characterPanelEntry = null;
    state.characterPanelSupported = false;
    state.characterPanelRefreshError = "";
    state.characterPanelRefreshBusy = false;
    renderStoryNotebookCharacterAvailability();
    return false;
  }
  state.characterPanelRefreshBusy = true;
  renderStoryNotebookCharacterAvailability();
  try {
    const result = await window.greyCrow.getCharacterPanelEntry();
    if (!isCurrentRequest() || !isRuntimePanelResultCurrent(binding, result)) return false;
    if (result.status) applyStatus(result.status);
    if (!isCurrentRequest()) return false;
    if (!result?.ok) {
      state.characterPanelRefreshError = formatError(
        result?.error,
        t("game.notebook.charactersUnavailable")
      );
      return false;
    }
    if (result.supported === false || !result.panel) {
      state.characterPanelEntry = null;
      state.characterPanelSupported = result.supported === false ? false : true;
      state.characterPanelRefreshError = "";
      return true;
    }
    if (result.supported !== true || typeof result.panel.panelRef !== "string") {
      state.characterPanelRefreshError = t("game.notebook.charactersUnavailable");
      return false;
    }
    state.characterPanelEntry = result.panel;
    state.characterPanelSupported = true;
    state.characterPanelRefreshError = "";
    return true;
  } catch (error) {
    if (!isCurrentRequest()) return false;
    state.characterPanelRefreshError = formatError(
      error,
      t("game.notebook.charactersUnavailable")
    );
    return false;
  } finally {
    if (isCurrentRequest()) {
      state.characterPanelRefreshBusy = false;
      renderStoryNotebookCharacterAvailability();
    }
  }
}

async function loadStoryNotebookPanelView(
  options = {},
  { append = false, renderOnComplete = true } = {}
) {
  const panel = state.activeSkillPanel;
  if (!panel?.panelRef || typeof window.greyCrow?.getSkillPanel !== "function") {
    state.skillPanelViewError = t("game.notebook.panelViewFailed");
    renderStoryNotebookDrawer({ preserveScroll: true });
    return false;
  }
  const binding = captureRuntimeViewBinding();
  const requestedDrawerPanel = state.notebookDrawerPanel;
  const requestRevision = state.skillPanelViewRequestRevision + 1;
  state.skillPanelViewRequestRevision = requestRevision;
  const isCurrentRequest = () =>
    state.skillPanelViewRequestRevision === requestRevision
    && isRuntimeViewBindingCurrent(binding)
    && state.notebookDrawerPanel === requestedDrawerPanel
    && state.activeSkillPanel?.panelRef === panel.panelRef
    && (options.view !== "detail" || (state.notebookDrawerSelectedItemRef === options.itemRef
      && state.notebookDrawerSelectedFieldId === options.fieldId))
    && isStoryNotebookDrawerOpen(requestedDrawerPanel);
  const previousDetail = append && options.view === "detail" ? state.activeSkillPanelProjection : null;
  if (append && options.view === "detail" && (!previousDetail?.pagination?.hasMore
    || previousDetail.detail?.ref !== options.itemRef || previousDetail.pagination.nextCursor !== options.cursor)) return false;
  const refreshButton = ui.storyNotebookDrawerRefreshButton;
  const hadRefreshFocus = document.activeElement === refreshButton;
  let refreshFocusMoved = false;
  const trackRefreshFocus = (event) => {
    if (event.target !== refreshButton && !refreshButton.contains(event.target)
      && (event.type !== "focusin" || event.target !== document.body)) refreshFocusMoved = true;
  };
  if (hadRefreshFocus) {
    document.addEventListener("focusin", trackRefreshFocus, true);
    document.addEventListener("pointerdown", trackRefreshFocus, true);
  }
  state.skillPanelRefreshBusy = true;
  ui.storyNotebookDrawerRefreshButton.disabled = true;
  try {
    const result = await window.greyCrow.getSkillPanel(panel.panelRef, options);
    if (!isCurrentRequest() || !isRuntimePanelResultCurrent(binding, result)) return false;
    if (result.status) applyStatus(result.status);
    if (!isCurrentRequest()) return false;
    if (!result?.ok || result.supported !== true || !result.panel) {
      state.skillPanelViewError = formatError(result?.error, t("game.notebook.panelViewFailed"));
      return false;
    }
    const projection = result.panel;
    if (projection.panelRef !== panel.panelRef || projection.view !== options.view) {
      state.skillPanelViewError = t("game.notebook.panelViewFailed");
      return false;
    }
    if (options.view === "overview") {
      state.skillPanelOverviewProjection = projection;
      state.activeSkillPanelProjection = projection;
      if (!await discoverStoryNotebookPanelRecordFields(panel, projection, isCurrentRequest, binding)) {
        return false;
      }
    } else if (options.view === "list") {
      const previous = append ? state.skillPanelListProjection : null;
      const items = previous ? [...previous.items, ...projection.items] : projection.items;
      state.skillPanelListProjection = { ...projection, items };
      state.activeSkillPanelProjection = state.skillPanelListProjection;
    } else if (options.view === "detail") {
      if (projection.detail?.ref !== options.itemRef) {
        state.skillPanelViewError = t("game.notebook.panelViewFailed");
        return false;
      }
      const detail = previousDetail ? mergeStoryNotebookPanelDetail(previousDetail, projection) : projection;
      if (!detail) {
        state.skillPanelViewError = t("game.notebook.panelViewFailed");
        return false;
      }
      state.activeSkillPanelProjection = detail;
    } else {
      state.activeSkillPanelProjection = projection;
    }
    if (!isCurrentRequest()) return false;
    state.skillPanelViewError = "";
    return true;
  } catch (error) {
    if (!isCurrentRequest()) return false;
    state.skillPanelViewError = formatError(error, t("game.notebook.panelViewFailed"));
    return false;
  } finally {
    if (hadRefreshFocus) {
      document.removeEventListener("focusin", trackRefreshFocus, true);
      document.removeEventListener("pointerdown", trackRefreshFocus, true);
    }
    if (isCurrentRequest()) {
      state.skillPanelRefreshBusy = false;
      if (renderOnComplete
        && isStoryNotebookPanelDrawerOpen()
        && state.notebookDrawerView.startsWith("panel-")) {
        renderStoryNotebookDrawer({ preserveScroll: append });
      }
      // Disabling the focused native button blurs it to body. Return that
      // keyboard position only if the player did not choose another control.
      if (hadRefreshFocus && !refreshFocusMoved && !refreshButton.disabled && !refreshButton.hidden
        && (!document.activeElement || document.activeElement === document.body)) {
        refreshButton.focus({ preventScroll: true });
      }
    }
  }
}

function mergeStoryNotebookPanelDetail(previous, next) {
  if (previous.panelRef !== next.panelRef || previous.view !== "detail" || next.view !== "detail"
    || previous.detail?.ref !== next.detail?.ref || !previous.pagination?.hasMore
    || !next.pagination || previous.pagination.totalItems !== next.pagination.totalItems
    || (next.pagination.hasMore && next.pagination.nextCursor === previous.pagination.nextCursor)) return null;
  const priorSections = previous.detail.sections;
  if (!Array.isArray(next.detail.sections) || priorSections.length !== next.detail.sections.length) return null;
  const seen = new Set(priorSections.flatMap((section) => section.records.map((record) => record.id)));
  const incoming = next.detail.sections.flatMap((section) => section.records);
  if (!incoming.length || incoming.length !== next.pagination.returnedItems
    || seen.size + incoming.length > next.pagination.totalItems) return null;
  for (const record of incoming) {
    if (seen.has(record.id)) return null;
    seen.add(record.id);
  }
  const sections = [];
  for (const [index, section] of next.detail.sections.entries()) {
    const prior = priorSections[index];
    if (prior.id !== section.id || JSON.stringify(prior.fields) !== JSON.stringify(section.fields)) return null;
    sections.push({ ...section, records: [...prior.records, ...section.records] });
  }
  return { ...next, detail: { ...next.detail, sections } };
}

async function loadStoryNotebookCharacterDirectory() {
  if (!isStoryNotebookDrawerOpen("characters") || !state.activeSkillPanel?.panelRef) return false;
  const binding = captureRuntimeViewBinding();
  const panelRef = state.activeSkillPanel.panelRef;
  const overviewLoaded = await loadStoryNotebookPanelView(
    { view: "overview" },
    { renderOnComplete: false }
  );
  if (!isRuntimeViewBindingCurrent(binding) || state.activeSkillPanel?.panelRef !== panelRef) return false;
  if (!overviewLoaded) {
    if (isStoryNotebookDrawerOpen("characters")) {
      renderStoryNotebookDrawer({ preserveScroll: true });
    }
    return false;
  }
  if (!isStoryNotebookDrawerOpen("characters")) return false;
  const fieldId = state.skillPanelRecordFieldIds[0] || null;
  if (!fieldId) {
    state.skillPanelViewError = t("game.notebook.panelNoRecordView");
    renderStoryNotebookDrawer({ preserveScroll: true });
    return false;
  }
  state.notebookDrawerSelectedFieldId = fieldId;
  state.notebookDrawerSelectedItemRef = null;
  state.skillPanelListProjection = null;
  state.activeSkillPanelProjection = null;
  state.notebookDrawerView = "panel-list";
  renderStoryNotebookDrawer();
  return loadStoryNotebookPanelView({ view: "list", fieldId, limit: 12 });
}

async function discoverStoryNotebookPanelRecordFields(panel, projection, isCurrentRequest = () => true,
  binding = captureRuntimeViewBinding()) {
  if (!isCurrentRequest()) return false;
  if (!["list_detail", "timeline"].includes(panel.surface)) {
    state.skillPanelRecordFieldIds = [];
    return true;
  }
  const candidates = projection.fields.filter((field) => field.kind === "progress");
  const discovered = [];
  for (const field of candidates) {
    try {
      const result = await window.greyCrow.getSkillPanel(panel.panelRef, {
        view: "list",
        fieldId: field.id,
        limit: 1,
      });
      if (!isCurrentRequest() || !isRuntimePanelResultCurrent(binding, result)) return false;
      if (result.status) applyStatus(result.status);
      if (!isCurrentRequest()) return false;
      if (result?.ok && result.supported === true && result.panel?.view === "list") {
        discovered.push(field.id);
        continue;
      }
      if (["SKILL_PANEL_VIEW_INVALID", "SKILL_PANEL_FIELD_UNKNOWN"].includes(result?.error?.code)) {
        continue;
      }
      state.skillPanelViewError = formatError(result?.error, t("game.notebook.panelViewFailed"));
      return false;
    } catch (error) {
      if (!isCurrentRequest()) return false;
      state.skillPanelViewError = formatError(error, t("game.notebook.panelViewFailed"));
      return false;
    }
  }
  if (!isCurrentRequest()) return false;
  state.skillPanelRecordFieldIds = discovered;
  return true;
}

async function loadMoreStoryNotebookPanelRecords() {
  const pagination = state.skillPanelListProjection?.pagination;
  if (!pagination?.hasMore || !pagination.nextCursor || !state.notebookDrawerSelectedFieldId) return;
  const previousCount = state.skillPanelListProjection.items.length;
  const loaded = await loadStoryNotebookPanelView({
    view: "list",
    fieldId: state.notebookDrawerSelectedFieldId,
    cursor: pagination.nextCursor,
    limit: 12,
  }, { append: true });
  if (!loaded || !isStoryNotebookPanelDrawerOpen()) return;
  const next = ui.storyNotebookDrawerBody.querySelector(`[data-item-index="${previousCount}"]`);
  (next || ui.storyNotebookDrawerTitle).focus({ preventScroll: true });
}

async function loadMoreStoryNotebookPanelDetail() {
  const previous = state.activeSkillPanelProjection;
  const pagination = previous?.pagination;
  if (state.skillPanelRefreshBusy || state.notebookDrawerView !== "panel-item-detail"
    || !pagination?.hasMore || !pagination.nextCursor || !state.notebookDrawerSelectedFieldId
    || previous.detail?.ref !== state.notebookDrawerSelectedItemRef) return;
  const previousIds = new Set(previous.detail.sections.flatMap(section => section.records.map(record => record.id)));
  const priorFocus = document.activeElement;
  const loaded = await loadStoryNotebookPanelView({ view: "detail",
    fieldId: state.notebookDrawerSelectedFieldId, itemRef: state.notebookDrawerSelectedItemRef,
    cursor: pagination.nextCursor, limit: 24 }, { append: true });
  if (!loaded || !isStoryNotebookPanelDrawerOpen()) return;
  const nextRecord = state.activeSkillPanelProjection.detail.sections.flatMap((section) => section.records)
    .find(record => !previousIds.has(record.id));
  const target = nextRecord && ui.storyNotebookDrawerBody.querySelector(`[data-detail-record-id="${nextRecord.id}"]`);
  // Do not focus a paragraph hidden by a closed native disclosure, or steal
  // focus if the player left the drawer while its next page was loading.
  if (document.activeElement && document.activeElement !== document.body
    && document.activeElement !== priorFocus && !ui.storyNotebookDrawerBody.contains(document.activeElement)) return;
  const disclosure = target?.closest("details.story-notebook-detail-text");
  const visibleTarget = disclosure && !disclosure.open ? disclosure.querySelector("summary") : target;
  (visibleTarget || ui.storyNotebookDrawerTitle).focus({ preventScroll: true });
}

function refreshActiveStoryNotebookPanelView() {
  const view = state.notebookDrawerView;
  if (view === "panel-list") {
    return loadStoryNotebookPanelView({
      view: "list",
      fieldId: state.notebookDrawerSelectedFieldId,
      limit: 12,
    });
  }
  if (view === "panel-item-detail") {
    return loadStoryNotebookPanelView({
      view: "detail",
      fieldId: state.notebookDrawerSelectedFieldId,
      itemRef: state.notebookDrawerSelectedItemRef,
    });
  }
  return loadStoryNotebookPanelView({ view: "overview" });
}

function focusStoryNotebookPanelCard(panelRef, { fallbackToTitle = true } = {}) {
  const target = Array.from(ui.storyNotebookDrawerBody.querySelectorAll(".story-notebook-panel-card"))
    .find((button) => button.dataset.panelRef === panelRef);
  if (target) target.focus({ preventScroll: true });
  else if (fallbackToTitle) ui.storyNotebookDrawerTitle.focus({ preventScroll: true });
}

function focusStoryNotebookPanelRecord(itemRef) {
  const target = Array.from(ui.storyNotebookDrawerBody.querySelectorAll(".story-notebook-panel-record"))
    .find((button) => button.dataset.itemRef === itemRef);
  (target || ui.storyNotebookDrawerTitle).focus({ preventScroll: true });
}

function returnStoryNotebookDrawer() {
  invalidateStoryNotebookNavigation();
  invalidateStoryNotebookPanelViewRequests();
  if (isStoryNotebookDrawerOpen("characters")) {
    if (state.notebookDrawerView === "panel-item-detail") {
      state.activeSkillPanelProjection = state.skillPanelListProjection;
      state.notebookDrawerView = "panel-list";
      renderStoryNotebookDrawer();
      focusStoryNotebookPanelRecord(state.notebookDrawerSelectedItemRef);
      return;
    }
    closeStoryNotebookDrawer();
    return;
  }
  if (!isStoryNotebookDrawerOpen("modules")) return;
  if (state.notebookDrawerView === "panel-item-detail") {
    state.activeSkillPanelProjection = state.skillPanelListProjection;
    state.notebookDrawerView = "panel-list";
    renderStoryNotebookDrawer();
    focusStoryNotebookPanelRecord(state.notebookDrawerSelectedItemRef);
    return;
  }
  if (state.notebookDrawerView === "panel-list") {
    state.activeSkillPanelProjection = state.skillPanelOverviewProjection;
    state.notebookDrawerView = "panel-overview";
    renderStoryNotebookDrawer();
    const target = ui.storyNotebookDrawerBody.querySelector(
      `[data-field-id="${state.notebookDrawerSelectedFieldId || ""}"]`
    );
    (target || ui.storyNotebookDrawerTitle).focus({ preventScroll: true });
    return;
  }
  if (state.notebookDrawerView === "panel-overview") {
    const selectedPanelRef = state.notebookDrawerSelectedPanelRef;
    state.activeSkillPanel = null;
    state.skillPanelOverviewProjection = null;
    state.skillPanelListProjection = null;
    state.activeSkillPanelProjection = null;
    state.skillPanelRecordFieldIds = [];
    state.skillPanelViewError = "";
    state.notebookDrawerView = "module-list";
    renderStoryNotebookDrawer();
    focusStoryNotebookPanelCard(selectedPanelRef);
    return;
  }
  const selectedKey = state.notebookDrawerSelectedModuleRef;
  const modules = Array.isArray(state.skillModules) ? state.skillModules : [];
  const selectedIndex = modules.findIndex((module) => getStoryNotebookModuleKey(module) === selectedKey);
  state.activeSkillModule = null;
  state.skillModulePages.clear();
  state.notebookDrawerView = "module-list";
  renderStoryNotebookDrawer();
  const target = selectedIndex >= 0
    ? ui.storyNotebookDrawerBody.querySelector(`[data-module-index="${selectedIndex}"]`)
    : ui.storyNotebookDrawerBody.querySelector(".story-notebook-module-card");
  (target || ui.storyNotebookDrawerTitle).focus({ preventScroll: true });
}

function refreshStoryNotebookDrawer() {
  if (isStoryNotebookDrawerOpen("characters")) {
    if (state.activeSkillPanel && state.notebookDrawerView.startsWith("panel-")) {
      return refreshActiveStoryNotebookPanelView();
    }
    return refreshStoryNotebookCharacterPanelEntry();
  }
  if (isStoryNotebookDrawerOpen("modules")) {
    if (state.notebookDrawerView.startsWith("panel-")) return refreshActiveStoryNotebookPanelView();
    if (state.skillPanelSupported === false) return refreshSkillModules();
    return refreshStoryNotebookSkillPanels();
  }
  if (isStoryNotebookDrawerOpen("chapters")) return refreshChapterLogs();
  if (isStoryNotebookDrawerOpen("state")) renderStoryNotebookDrawer({ preserveScroll: true });
  return Promise.resolve();
}

function openGameSettingsFromStoryRail() {
  if (isStoryNotebookDrawerOpen()) {
    closeStoryNotebookDrawer({ restoreFocus: false, onSettled: () => openSettings() });
    return;
  }
  openSettings();
}

function getBrandLogoSource(locale = getUiLocale()) {
  return BRAND_LOGO_BY_LOCALE[locale] || BRAND_LOGO_BY_LOCALE[DEFAULT_DISPLAY_LOCALE];
}

function renderLocalizedBrandLogo(locale = getUiLocale()) {
  const source = getBrandLogoSource(locale);
  if (ui.brandLogo.getAttribute("src") !== source) {
    ui.brandLogo.setAttribute("src", source);
  }
  ui.brandLogo.dataset.brandLocale = locale;
  return source;
}

function preloadBrandLogo(locale) {
  const source = getBrandLogoSource(locale);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(source), { once: true });
    image.addEventListener("error", () => reject(new Error(`Unable to load bundled brand asset: ${source}`)), { once: true });
    image.src = source;
  });
}

function waitForUiMilliseconds(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitForNextUiPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

function prefersReducedUiMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

async function coverLocaleTransition() {
  const curtain = ui.localeTransitionCurtain;
  curtain.dataset.phase = "covering";
  curtain.classList.add("is-transitioning", "is-covering");
  await waitForNextUiPaint();
  curtain.classList.add("is-covered");
  await waitForUiMilliseconds(prefersReducedUiMotion() ? 1 : LOCALE_TRANSITION_TIMING.cover);
  curtain.classList.remove("is-covering");
  curtain.dataset.phase = "covered";
  await waitForUiMilliseconds(prefersReducedUiMotion() ? 1 : LOCALE_TRANSITION_TIMING.hold);
}

async function revealLocaleTransition() {
  const curtain = ui.localeTransitionCurtain;
  curtain.dataset.phase = "revealing";
  curtain.classList.remove("is-covering", "is-covered");
  await waitForUiMilliseconds(prefersReducedUiMotion() ? 1 : LOCALE_TRANSITION_TIMING.reveal);
  curtain.classList.remove("is-transitioning");
  curtain.dataset.phase = "idle";
}

const PERSISTED_SETTINGS_CONTROL_IDS = new Set([
  "contextWindowPresetSelect",
  "contextWindowCustomInput",
  "autoCompactRatioSelect",
  "autoCompactRatioCustomInput",
  "narrationLengthPresetSelect",
  "narrationCustomTargetInput",
  "narrationTextSizeSelect",
  "sidePanelTextSizeSelect",
  "storyNotebookThemeSelect",
  "windowModeSelect",
  "gameLanguageSelect",
  "autoSaveEnabledSelect",
  "autoSaveIntervalSelect",
  "autoSaveIntervalCustomInput",
  "manualChapterSelect",
  "compactionChapterSelect",
  "gameVolumeInput",
  "speechInputEnabledSelect",
  "speechInputLanguageSelect",
  "speechInputDeviceSelect",
  "ttsReadingModeSelect",
  "ttsProviderSelect",
  "ttsVoiceSelect",
  "ttsRateInput",
  "ttsPitchInput",
  "ttsCacheLimitSelect",
  "debugPanelEnabledSelect",
]);
const DISPLAY_LABELS = {
  "zh-CN": {
    unknownLocation: "未确认地点",
    unknownStatus: "未确认",
  },
  "en-US": {
    unknownLocation: "Unknown location",
    unknownStatus: "Unknown",
  },
  "ja-JP": {
    unknownLocation: "場所未確定",
    unknownStatus: "未確定",
  },
};
const INTERNAL_DISPLAY_SLUG_HINT_RE =
  /(gate|station|market|street|road|lane|bridge|square|park|tower|dock|harbou?r|port|terminal|platform|hall|room|house|building|district|zone|area|city|town|village|warehouse|factory|store|shop|school|hospital|airport|metro|subway|tunnel|exit|entrance|north|south|east|west|central|old|new|unknown|slug)/i;
const LOCATION_DISPLAY_NAMES = {
  "shanghai-south-station": {
    "zh-CN": "上海南站",
    "en-US": "Shanghai South Railway Station",
  },
  "grey-haven-station": {
    "zh-CN": "灰泊站",
    "en-US": "Grey Haven Station",
  },
  north_gate: {
    "zh-CN": "北门",
    "en-US": "North Gate",
  },
};
if (rendererPreview.enabled) {
  installRendererPreviewBridge();
}

document.addEventListener("DOMContentLoaded", boot);

let speechInputController = null;
let gameTourLifecycle = null;
let speechDraftVersion = 0;
let speechAudioFocus = false;
let speechAudioFocusRevision = 0;
let speechAudioUserRevision = 0;

function isSpeechInputBusy() { return speechInputController?.snapshot().busy === true; }

function initializeSpeechInput() {
  if (!window.GreyCrowSpeechInput?.mount || !window.greyCrow) return;
  speechInputController = window.GreyCrowSpeechInput.mount({
    api: window.greyCrow, t,
    getContext: () => ({ ...captureRuntimeViewBinding(),
      ready: state.keyVerified && state.gameStarted && Boolean(state.activeSaveId) && !state.busy && !isStoryInputLocked() && !isNotebookPresentationBlocked() }),
    getDraft: () => ({ text: ui.turnInput.value, version: speechDraftVersion }),
    setDraft: text => { ui.turnInput.value = text; speechDraftVersion++; ui.turnInput.focus(); },
    getSettings: () => state.speechInput,
    hasSettingsChanges: () => state.settingsDirty,
    onSettingsInput: (value, control) => { state.speechInput = value; renderSimpleSettingsVisibility(); markSettingsDirty(control); },
    saveSettings: () => saveSettings({ groups: ["audio"] }),
    openSettings: () => openSettings(t("speech.setup"), { tab: "audio" }),
    canShortcut: () => document.hasFocus() && !document.hidden && !ui.gameView.classList.contains("hidden")
      && !document.querySelector("dialog[open]") && state.gameStarted && !isNotebookPresentationBlocked(),
    acquireAudioFocus: acquireSpeechAudioFocus,
    onChange: () => { renderTurnInputState(); renderTtsPlaybackStatus(); },
  });
  ui.turnInput.addEventListener("input", () => { speechDraftVersion++; });
}

function acquireSpeechAudioFocus() {
  const audio = state.currentAudio;
  const wasPlaying = Boolean(audio && state.ttsPlaybackPhase === "playing");
  const requestId = state.ttsRequestId;
  const userRevision = speechAudioUserRevision;
  const focusRevision = ++speechAudioFocusRevision;
  // The formal game currently sends audio through this TTS player. Pause its
  // exact current position; pending generations must not begin playing later.
  if (wasPlaying) { pauseTtsAudioPlayback(audio); setTtsPlaybackPhase("paused"); }
  if (!audio && ["generating", "playing", "paused"].includes(state.ttsPlaybackPhase)) cancelTtsPlayback();
  speechAudioFocus = true;
  const muted = audio?.muted;
  if (audio) audio.muted = true;
  renderTtsPlaybackStatus();
  let released = false;
  return () => {
    if (released || speechAudioFocusRevision !== focusRevision) return;
    released = true; speechAudioFocus = false;
    if (audio && state.currentAudio === audio) {
      if (audio.muted === true) audio.muted = Boolean(muted);
      audio.volume = Math.max(0, Math.min(1, state.gameVolume / 100));
    }
    if (wasPlaying && state.currentAudio === audio && state.ttsRequestId === requestId
      && state.ttsPlaybackPhase === "paused" && state.ttsEnabled && speechAudioUserRevision === userRevision) {
      audio.volume = Math.max(0, Math.min(1, state.gameVolume / 100));
      const playAttempt = startTtsAudioPlayback(audio);
      setTtsPlaybackPhase("playing");
      playAttempt.promise.catch((error) => {
        if (state.currentAudio !== audio || state.ttsRequestId !== requestId
          || audio._greyCrowPlaybackAttempt !== playAttempt.id) return;
        const label = getTtsPlaybackFailureLabel(error);
        ui.ttsStatus.textContent = label;
        cancelTtsPlayback();
        state.ttsPlaybackError = label;
        setTtsPlaybackPhase("error");
      });
    }
    renderTtsPlaybackStatus();
  };
}

async function boot() {
  initializeMenuIntro();
  initializeGameStage();
  initializeSpeechInput();
  bindEvents();
  installNotebookObjectIcons();
  initializeWritingQuill();
  renderGameUiLayout();
  if (!window.greyCrow) {
    renderMissingDesktopBridge();
    return;
  }
  await refreshSettings();
  await refreshStatus();
  await refreshSaves();
  renderShellState();
  gameTourLifecycle = window.GreyCrowGameTourLifecycle?.mount?.({
    getLocale: getUiLocale, bridge: window.greyCrow, closeSettings,
    getContext: () => ({
      inGame: state.gameStarted && Boolean(state.activeSaveId) && !ui.gameView.classList.contains("hidden"),
      ready: !state.busy && !isSpeechInputBusy() && !isStoryInputLocked() && !isNotebookPresentationBlocked(),
      settled: !state.narrationDelivery && state.typewriterTimers.size === 0,
      binding: `${state.activeSaveId}:${state.runtimeSessionId}`,
      drawerOpen: ui.storyNotebookDrawer.getAttribute("aria-hidden") !== "true",
    }),
  });
  window.GreyCrowPlayerGuide?.mount?.({ locale: () => getUiLocale(), bridge: window.greyCrow,
    openModelHelp: (helpId) => window.greyCrow.openModelHelp(helpId), openSettings: (tab) => openSettings("", { tab }),
    resetGameTour: () => gameTourLifecycle?.reset() ?? false });
  if (rendererPreview.enabled && rendererPreview.openGame) {
    state.lockedContent = createPreviewNewGameReview({ preset: createPreviewNewGameCatalog().defaultPreset });
    state.skillModules = createPreviewSkillModules();
    renderLoadedSkillSlots();
    renderStoryNotebookMetadata();
    showGame(getCurrentAdventure() || createPreviewSave(), createPreviewHistory());
    applyPreviewContextUsage();
    ui.gameStatus.textContent = t("preview.game.status");
    ui.turnStatus.textContent = t("preview.game.turnStatus");
  }
}

let gameStageResizeObserver = null;

function initializeGameStage() {
  if (!ui.gameStageViewport || !ui.gameStageCanvas) {
    return;
  }
  const render = () => renderGameStageScale();
  if (typeof ResizeObserver === "function") {
    gameStageResizeObserver = new ResizeObserver(render);
    gameStageResizeObserver.observe(ui.gameStageViewport);
  } else {
    window.addEventListener("resize", render);
  }
  render();
}

function renderGameStageScale() {
  if (!ui.gameStageViewport || !ui.gameStageCanvas) {
    return 1;
  }
  const width = ui.gameStageViewport.clientWidth;
  const height = ui.gameStageViewport.clientHeight;
  if (width <= 0 || height <= 0) {
    return 1;
  }
  const scale = Math.min(
    width / GAME_STAGE_LOGICAL_WIDTH,
    height / GAME_STAGE_LOGICAL_HEIGHT
  );
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  ui.gameStageCanvas.style.setProperty("--gc-game-stage-scale", String(safeScale));
  ui.gameStageCanvas.dataset.stageScale = safeScale.toFixed(6);
  ui.gameStageViewport.dataset.stageAspect = Math.abs(width / height - 16 / 9) < 0.001
    ? "16:9"
    : "letterbox";
  return safeScale;
}

let menuIntroTimer = null;
let removeMenuIntroSkipListeners = () => {};

function initializeMenuIntro() {
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reducedMotion) {
    finishMenuIntro();
    return;
  }
  const skip = () => finishMenuIntro();
  window.addEventListener("pointerdown", skip, { capture: true });
  window.addEventListener("keydown", skip, { capture: true });
  removeMenuIntroSkipListeners = () => {
    window.removeEventListener("pointerdown", skip, { capture: true });
    window.removeEventListener("keydown", skip, { capture: true });
    removeMenuIntroSkipListeners = () => {};
  };
  menuIntroTimer = window.setTimeout(finishMenuIntro, 4000);
}

function finishMenuIntro() {
  if (menuIntroTimer !== null) {
    window.clearTimeout(menuIntroTimer);
    menuIntroTimer = null;
  }
  removeMenuIntroSkipListeners();
  ui.menuView.classList.remove("menu-intro-active");
  ui.menuView.classList.add("menu-intro-complete");
}

async function quitDesktopApp() {
  finishMenuIntro();
  ui.exitGameButton.disabled = true;
  ui.menuMessage.textContent = t("menu.exit.pending");
  try {
    const result = await window.greyCrow.quitApp();
    if (!result?.ok) {
      throw new Error(result?.error?.message || t("menu.exit.incomplete"));
    }
    if (result.preview) {
      ui.exitGameButton.disabled = false;
      ui.menuMessage.textContent = t("menu.exit.preview");
    }
  } catch (error) {
    ui.exitGameButton.disabled = false;
    ui.menuMessage.textContent = t("menu.exit.failed", { message: formatError(error, t("menu.exit.incomplete")) });
  }
}

function createRendererPreviewMode() {
  if (window.greyCrow) {
    return { enabled: false, openGame: false };
  }
  const params = new URLSearchParams(window.location.search || "");
  const preview = String(params.get("preview") || "").trim().toLowerCase();
  if (preview === "off" || preview === "false") {
    return { enabled: false, openGame: false };
  }
  if (preview === "menu") {
    return { enabled: true, openGame: false };
  }
  if (preview === "game" || window.location.hash === "#preview=game") {
    return { enabled: true, openGame: true };
  }
  return {
    enabled: window.location.protocol === "file:",
    openGame: window.location.protocol === "file:",
  };
}

function installRendererPreviewBridge() {
  let previewSave = createPreviewSave();
  let previewTurn = previewSave.turn;
  let previewSettings = createPreviewSettings();
  let previewContentLibrary = createPreviewContentLibrary();
  let previewPlayerProfile = createPreviewPlayerProfile();
  let previewBlankCounter = 0;
  const previewEditableItems = new Map();
  let previewKeyReady = true;
  const status = () => {
    const current = createPreviewStatus(previewSave, previewSettings);
    current.keyVerified = previewKeyReady;
    current.credential.hasVerifiedCredential = previewKeyReady;
    return current;
  };
  window.greyCrow = {
    async getStatus() {
      return status();
    },
    async getSettings() {
      return {
        settings: previewSettings,
        catalog: createPreviewSettingsCatalog(),
      };
    },
    async updateSettings(settings) {
      previewSettings = mergePreviewSettings(previewSettings, settings);
      return {
        ok: true,
        settings: previewSettings,
        status: status(),
      };
    },
    async listSaveSlots() {
      return {
        ok: true,
        saves: [previewSave],
        status: status(),
      };
    },
    async upsertCustomConnection(connection) {
      const id = connection.id || "custom_0123456789abcdef";
      const normalized = {
        ...connection,
        id,
        provider: "openai-compatible",
        contextWindowTokens: 64000,
        status: "custom",
        verifiedAt: null,
      };
      const others = previewSettings.api.customConnections.filter((item) => item.id !== id);
      previewSettings = mergePreviewSettings(previewSettings, {
        api: { customConnections: [...others, normalized] },
      });
      return {
        ok: true,
        connection: normalized,
        settings: previewSettings,
        catalog: createPreviewSettingsCatalog(),
        status: status(),
      };
    },
    async deleteCustomConnection(connectionId) {
      const customConnections = previewSettings.api.customConnections.filter((item) => item.id !== connectionId);
      const deletingActive = previewSettings.api.connectionId === connectionId;
      previewSettings = mergePreviewSettings(previewSettings, {
        api: {
          customConnections,
          ...(deletingActive ? { provider: "deepseek", model: "deepseek-flash", connectionId: null } : {}),
        },
      });
      return { ok: true, settings: previewSettings, catalog: createPreviewSettingsCatalog(), status: status() };
    },
    async testProviderConnection(payload = {}) {
      if (payload.provider === "openai-compatible") {
        const candidate = payload.connection || previewSettings.api.customConnections.find(item => item.id === payload.connectionId);
        const connection = { ...candidate, id: candidate?.id || "custom_0123456789abcdef", provider: "openai-compatible",
          verifiedAt: new Date().toISOString(), fingerprint: "preview", contractVersion: "grey-crow-provider-probe-v1" };
        const customConnections = [...previewSettings.api.customConnections.filter(item => item.id !== connection.id), connection];
        previewSettings = mergePreviewSettings(previewSettings, {
          api: {
            provider: "openai-compatible",
            model: connection?.modelId || "preview-model",
            connectionId: connection.id,
            customConnections,
          },
        });
      } else {
        previewSettings = mergePreviewSettings(previewSettings, {
          api: { provider: "deepseek", model: payload.model || "deepseek-flash", connectionId: null },
        });
      }
      previewKeyReady = true;
      return {
        ok: true,
        applied: true,
        settings: previewSettings,
        catalog: createPreviewSettingsCatalog(),
        status: status(),
      };
    },
    async clearProviderCredential() {
      previewKeyReady = false;
      return {
        ok: true,
        status: status(),
      };
    },
    async clearAllProviderCredentials({ confirmed } = {}) {
      if (!confirmed) return { ok: false };
      previewKeyReady = false;
      return { ok: true, status: status() };
    },
    async openModelHelp() {
      return { ok: true };
    },
    async listContentLibrary() {
      return { ok: true, library: previewContentLibrary };
    },
    async cloneContentPack(input = {}) {
      const itemId = `${input.newPackId}-host`.slice(0, 64);
      const pack = {
        id: input.newPackId,
        title: input.title,
        version: "1.0.0",
        languages: ["zh-CN"],
        ownership: "player_owned",
        activation: "active",
        status: "valid",
        editable: true,
        itemCount: 1,
        items: [{
          id: itemId,
          type: "host",
          title: "玩家主持人",
          language: "zh-CN",
          description: "预览编辑内容。",
          danger: "low",
          triggers: [],
          readScopes: [],
          writeScopes: [],
        }],
      };
      previewEditableItems.set(`${input.newPackId}:${itemId}`, createPreviewEditableItem(input.newPackId, itemId));
      previewContentLibrary = upsertPreviewContentPack(previewContentLibrary, pack);
      return { ok: true, pack, library: previewContentLibrary };
    },
    async createBlankContent(input = {}) {
      previewBlankCounter += 1;
      const token = String(previewBlankCounter).padStart(2, "0");
      const packId = `player-content-preview-${token}`;
      const isSkill = input.kind === "ordinary_skill" || input.kind === "new_game_skill";
      const type = isSkill ? "skill" : input.kind;
      const skillClass = input.kind === "new_game_skill" ? "new_game" : isSkill ? "ordinary" : null;
      const itemId = `${input.kind.replaceAll("_", "-")}-preview-${token}`;
      const triggers = skillClass === "new_game" ? ["ui_start_new_game"] : [...(input.triggers || [])];
      const item = {
        schemaVersion: "grey-crow-content-editor-item-v2",
        packId,
        packVersion: "1.0.0",
        itemId,
        type,
        skillClass,
        title: input.title,
        language: input.language,
        description: input.description,
        danger: "low",
        triggers,
        readScopes: [],
        writeScopes: [],
        markdown: input.markdown,
        templates: [],
        revision: "d".repeat(64),
      };
      const pack = {
        id: packId,
        title: item.title,
        version: item.packVersion,
        languages: [item.language],
        ownership: "player_owned",
        activation: "active",
        status: "valid",
        editable: true,
        itemCount: 1,
        items: [{
          id: item.itemId,
          type: item.type,
          skillClass: item.skillClass,
          title: item.title,
          language: item.language,
          description: item.description,
          danger: item.danger,
          triggers: item.triggers,
          readScopes: [],
          writeScopes: [],
          replaces: null,
        }],
      };
      previewEditableItems.set(`${packId}:${itemId}`, item);
      previewContentLibrary = upsertPreviewContentPack(previewContentLibrary, pack);
      return { ok: true, item, library: previewContentLibrary, localPathsExposed: false };
    },
    async exportContentPack(packId) {
      return { ok: true, packId, files: 3, destinationExposed: false };
    },
    async deleteContentPack(packId) {
      previewContentLibrary = {
        ...previewContentLibrary,
        packs: previewContentLibrary.packs.filter((item) => item.id !== packId),
      };
      return { ok: true, packId, library: previewContentLibrary };
    },
    async loadEditableContent(packId, itemId) {
      const item = previewEditableItems.get(`${packId}:${itemId}`);
      return item ? { ok: true, item } : { ok: false, error: { code: "CONTENT_ITEM_NOT_FOUND", message: "未找到可编辑内容。" } };
    },
    async saveEditableContent(input = {}) {
      const key = `${input.packId}:${input.itemId}`;
      const item = { ...previewEditableItems.get(key), ...input, packVersion: "1.0.1", revision: "b".repeat(64) };
      previewEditableItems.set(key, item);
      previewContentLibrary = {
        ...previewContentLibrary,
        packs: previewContentLibrary.packs.map((pack) => pack.id === input.packId
          ? { ...pack, version: item.packVersion, items: pack.items.map((entry) => entry.id === input.itemId ? { ...entry, title: item.title, language: item.language, description: item.description, danger: item.danger } : entry) }
          : pack),
      };
      return { ok: true, item, library: previewContentLibrary, localPathsExposed: false };
    },
    async saveContentPreset(input = {}) {
      const existing = previewContentLibrary.presets.find((preset) => preset.packId === input.packId && preset.itemId === input.itemId);
      const preset = {
        packId: input.packId,
        packTitle: previewContentLibrary.packs.find((pack) => pack.id === input.packId)?.title || input.packId,
        packVersion: "1.0.1",
        ownership: "player_owned",
        itemId: existing?.itemId || "preset-preview-local",
        title: input.title,
        language: input.language,
        description: input.description,
        revision: "c".repeat(64),
        selection: input.selection,
      };
      previewContentLibrary = {
        ...previewContentLibrary,
        packs: previewContentLibrary.packs.map((pack) => pack.id === input.packId ? { ...pack, version: "1.0.1" } : pack),
        presets: [...previewContentLibrary.presets.filter((item) => !(item.packId === preset.packId && item.itemId === preset.itemId)), preset],
      };
      return { ok: true, preset, library: previewContentLibrary };
    },
    async getPlayerProfile() {
      return { ok: true, profile: previewPlayerProfile, explicitFields: [] };
    },
    async savePlayerProfile(fields) {
      previewPlayerProfile = { ...previewPlayerProfile, ...fields, updatedAt: new Date().toISOString() };
      return { ok: true, profile: previewPlayerProfile, explicitFields: Object.keys(fields) };
    },
    async startNewGame() {
      return { ok: false, error: { code: "NEW_GAME_SELECTION_REQUIRED", message: "请先选择内容。" }, status: status() };
    },
    async getNewGameCatalog() {
      return { ok: true, catalog: createPreviewNewGameCatalog(), status: status() };
    },
    async prepareNewGame(selection) {
      return {
        ok: true,
        confirmationToken: "0123456789abcdef0123456789abcdef",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        review: createPreviewNewGameReview(selection),
        status: status(),
      };
    },
    async confirmNewGameCreation() {
      previewTurn = 0;
      previewSave.turn = 0;
      previewSave.updatedAt = new Date().toISOString();
      previewSave.schemaKind = "v2";
      return {
        ok: true,
        save: previewSave,
        saves: [previewSave],
        lockedContent: createPreviewNewGameReview({ preset: createPreviewNewGameCatalog().defaultPreset }),
        skillModules: createPreviewSkillModules(),
        status: status(),
      };
    },
    async requestNewGameRestart() {
      return {
        ok: true,
        confirmation: {
          action: "new_game_restart",
          label: "删除当前冒险并开始新游戏",
          confirmationToken: "preview-new-game-restart",
          confirmationText: "DELETE",
          requiresText: true,
          danger: "critical",
          save: previewSave,
        },
        saves: [previewSave],
        status: status(),
      };
    },
    async confirmNewGameRestart() {
      previewTurn = 0;
      previewSave.turn = 0;
      previewSave.updatedAt = new Date().toISOString();
      previewSave.state_hint = createPreviewStateHint(0);
      return { ok: true, openNewGameSelection: true, saves: [], deletedSaveId: previewSave.id, status: status() };
    },
    async continueGame() {
      return {
        ok: true,
        save: previewSave,
        saves: [previewSave],
        history: createPreviewHistory(),
        lockedContent: createPreviewNewGameReview({ preset: createPreviewNewGameCatalog().defaultPreset }),
        skillModules: createPreviewSkillModules(),
        status: status(),
      };
    },
    async openStoryArchive() {
      const finale = createPreviewStoryFinale();
      return {
        ok: true,
        mode: "archive",
        archive: { mode: "archive", read_only: true, input_allowed: false, actions: { export_story: true, continue_as_child: true } },
        save: previewSave,
        saves: [previewSave],
        history: [...createPreviewHistory(), { kind: "finale", seq: previewTurn + 1, host: finale.finale.narration }],
        lockedContent: createPreviewNewGameReview({ preset: createPreviewNewGameCatalog().defaultPreset }),
        chapters: [],
        storyFinale: finale,
        status: status(),
      };
    },
    async exportStoryArchive(format) {
      const extension = format === "html" ? "html" : "md";
      return {
        ok: true,
        format,
        filename: `Grey Crow Story.${extension}`,
        turn_count: previewTurn + 1,
        chapter_count: 0,
        bytes: 1024,
        not_model_visible: true,
        status: status(),
      };
    },
    async continueStoryArchive() {
      previewSave = {
        ...previewSave,
        id: "preview-continuation",
        title: "灰鸦预览 · 续篇",
        compatibility: { status: "active", playerContinuable: true, deleteAllowed: true, errorCode: null },
        catalogRole: "active",
      };
      return {
        ok: true,
        mode: "continuation",
        continuation: { notice: "续篇开始", parent_adventure_id: "preview-save", child_adventure_id: previewSave.id },
        save: previewSave,
        saves: [previewSave],
        lockedContent: null,
        skillModules: createPreviewSkillModules(),
        storyFinale: { ok: true, status: "ready", projection: { phase: "idle", inputAllowed: true, actions: { exportStory: false, continueAsChild: false } }, finale: null },
        contextUsage: { meter_status: "unavailable" },
        status: status(),
      };
    },
    async listSkillModules() {
      return { ok: true, modules: createPreviewSkillModules(), status: status() };
    },
    async getSkillModule(moduleRef, options = {}) {
      const module = createPreviewSkillModules().find((entry) => entry.moduleRef === moduleRef);
      if (!module) return { ok: false, error: { code: "SKILL_MODULE_NOT_SELECTED", message: "模块不可用。" }, status: status() };
      const field = module.fields.find((entry) => entry.id === options.fieldId);
      const detail = JSON.parse(JSON.stringify(module));
      detail.fields = field ? [{ ...field, value: createPreviewSkillModuleRecords() }] : detail.fields;
      detail.summary = detail.summary.filter((entry) => !field || entry.fieldId === field.id);
      detail.pagination = field ? { fieldId: field.id, nextCursor: null, hasMore: false, returnedItems: detail.fields[0].value.length, totalItems: detail.fields[0].value.length } : null;
      return { ok: true, module: detail, status: status() };
    },
    async runTurn(text) {
      previewTurn += 1;
      previewSave.turn = previewTurn;
      previewSave.updatedAt = new Date().toISOString();
      previewSave.state_hint = createPreviewStateHint(previewTurn);
      return createPreviewTurnResult(
        previewSave,
        `这是浏览器 UI 预览回应。你刚才输入了：“${String(text || "").slice(0, 80)}”。\n\n正式桌面 App 会走真实 Grey Crow runtime；这里仅用于确认第二层界面、输入框、右侧状态栏和上下文血滴的位置。`,
        status()
      );
    },
    async requestManualSave() {
      return {
        ok: true,
        save: previewSave,
        saves: [previewSave],
        result: {
          save_commit: { commit_id: "preview-commit" },
          chapter_generated: true,
          chapter_log: { title: "UI 预览保存节点" },
        },
        status: status(),
      };
    },
    async getChapterLogs() {
      return {
        ok: true,
        result: {
          chapters: [
            {
              title: "UI 预览章节",
              createdAt: new Date().toISOString(),
              turn_range: { start: 1, end: previewTurn },
              summary: "你在预览模式中检查输出框、输入框和右侧状态板的布局。",
              key_events: ["你：检查新的输入框位置。", "灰鸦：确认这只是浏览器预览。"],
              open_threads: ["正式接入后复测真实存档与压缩。"],
            },
          ],
        },
        status: status(),
      };
    },
    async requestContextCompaction() {
      return {
        ok: true,
        result: {
          compacted: true,
          reason: "manual_preview",
          metrics: {
            trigger_reason: "manual_preview",
            source_estimated_tokens: 64000,
            summary_estimated_tokens: 1800,
            next_input_estimate_tokens: 46000,
            after_usage_ratio: 0.23,
            summary_token_hard_cap: 4096,
            summary_hash: "preview-summary",
            summary_version: "preview-v1",
            sourceRange: { start: 1, end: previewTurn },
          },
        },
        status: status(),
      };
    },
    async getDebugTrace() {
      return {
        ok: true,
        result: {
          entries: [createPreviewDebugTrace(previewTurn)],
        },
        export: {
          filename: "grey-crow-preview-debug.json",
          mimeType: "application/json",
          content: JSON.stringify([createPreviewDebugTrace(previewTurn)], null, 2),
        },
        status: status(),
      };
    },
    async requestSaveMaintenance(action) {
      return {
        ok: true,
        action,
        confirmation: {
          action,
          label: action === "clear" ? "删除当前冒险" : "修复当前存档",
          confirmationToken: `preview-${action}`,
          confirmationText: action === "clear" ? "删除当前冒险" : "",
          requiresText: action === "clear",
          danger: action === "clear" ? "critical" : "normal",
        },
        status: status(),
      };
    },
    async confirmSaveMaintenance() {
      return {
        ok: true,
        action: "repair",
        save: previewSave,
        saves: [previewSave],
        result: {
          created_entries: [],
          state_hint: previewSave.state_hint,
        },
        status: status(),
      };
    },
    async synthesizeTts() {
      return {
        ok: false,
        error: { code: "PREVIEW_TTS_DISABLED", message: "浏览器预览模式不生成语音。" },
      };
    },
    async startTtsUtterance() {
      return {
        ok: false,
        error: { code: "PREVIEW_TTS_DISABLED", message: "浏览器预览模式不生成语音。" },
      };
    },
    async continueTtsUtterance() {
      return {
        ok: false,
        error: { code: "PREVIEW_TTS_DISABLED", message: "浏览器预览模式不生成语音。" },
      };
    },
    async cancelTtsUtterance() {
      return { ok: true, canceled: false, not_model_visible: true };
    },
    async getTtsCacheStatus() {
      return {
        ok: true,
        result: {
          utteranceCount: 0,
          bytes: 0,
          utteranceLimit: 20,
          byteLimit: 524288000,
          not_model_visible: true,
        },
      };
    },
    async clearTtsCache() {
      return {
        ok: true,
        result: {
          utteranceCount: 0,
          bytes: 0,
          utteranceLimit: 20,
          byteLimit: 524288000,
          not_model_visible: true,
        },
      };
    },
    async leaveAdventure() {
      return { ok: true, status: status() };
    },
    async quitApp() {
      return { ok: true, preview: true };
    },
  };
}

function renderMissingDesktopBridge() {
  ui.runtimeStatus.textContent = "BROWSER PREVIEW";
  ui.gameStatus.textContent = t("preview.browser.disconnected");
  ui.menuMessage.textContent = t("preview.browser.instructions");
  ui.newGameButton.disabled = true;
  ui.continueGameButton.disabled = true;
  ui.settingsButton.disabled = false;
  ui.exitGameButton.disabled = true;
}

function createPreviewSettings() {
  return {
    localization: {
      preferredLocale: "zh-CN",
    },
    api: {
      provider: "deepseek",
      model: "deepseek-flash",
      connectionId: null,
      customConnections: [],
    },
    narration: {
      lengthPreset: "standard",
      customTargetChars: null,
    },
    agent: {
      context: {
        configuredContextWindow: 256000,
        autoCompactRatio: 0.75,
      },
    },
    ui: {
      narrationTextSize: "medium",
      sidePanelTextSize: "medium",
      windowMode: "standard",
      gameUiLayout: "story-notebook-v1",
    },
    audio: {
      gameVolume: 80,
      tts: {
        enabled: false,
        autoPlay: false,
        provider: "disabled",
        voiceId: "zm_010",
        rate: "+0%",
        pitch: "+0Hz",
        cacheUtteranceLimit: 20,
      },
    },
    developer: {
      debugPanelEnabled: true,
    },
  };
}

function createPreviewContentLibrary() {
  const catalog = createPreviewNewGameCatalog();
  const items = [...catalog.hosts, ...catalog.worlds, ...catalog.newGameSkills, ...catalog.skills].map((item) => ({
    id: item.itemId,
    type: item.type,
    skillClass: item.skillClass || (item.type === "skill" ? "ordinary" : null),
    title: item.title,
    language: item.language,
    description: item.description,
    danger: item.danger,
    triggers: [],
    readScopes: [],
    writeScopes: [],
    replaces: null,
  }));
  return {
    schemaVersion: "grey-crow-content-library-v2",
    localPathsExposed: false,
    packs: [{
      id: "grey-crow-default",
      title: "Grey Crow Default Content",
      version: "2.0.0",
      languages: ["zh-CN"],
      ownership: "built_in",
      activation: "active",
      status: "valid",
      editable: false,
      itemCount: items.length + 1,
      items,
    }],
    presets: catalog.presets.map((preset) => ({ ...preset, revision: "a".repeat(64) })),
  };
}

function upsertPreviewContentPack(library, pack) {
  return {
    ...library,
    packs: [...library.packs.filter((item) => item.id !== pack.id), pack].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function createPreviewEditableItem(packId, itemId) {
  return {
    schemaVersion: "grey-crow-content-editor-item-v2",
    packId,
    packVersion: "1.0.0",
    itemId,
    type: "host",
    title: "玩家主持人",
    language: "zh-CN",
    description: "预览编辑内容。",
    danger: "low",
    triggers: [],
    readScopes: [],
    writeScopes: [],
    markdown: "# 玩家主持人\n\n这是预览内容。\n",
    templates: [],
    revision: "a".repeat(64),
  };
}

function createPreviewPlayerProfile() {
  return {
    schemaVersion: "grey-crow-player-profile-v2",
    playerProfileId: "player_preview_profile",
    preferredLanguage: "zh-CN",
    displayName: "",
    pronouns: "",
    narrativePreferences: [],
    contentBoundaries: [],
    notes: "",
    updatedAt: new Date().toISOString(),
  };
}

function createPreviewSettingsCatalog() {
  return {
    schemaVersion: "desktop-settings-runtime-preview",
    localization: {
      schemaVersion: "grey-crow-locale-registry-v1",
      supportedLocales: ["zh-CN", "en-US", "ja-JP"],
      options: [
        { id: "zh-CN", nativeLabel: "简体中文", englishLabel: "Simplified Chinese" },
        { id: "en-US", nativeLabel: "English", englishLabel: "English" },
        { id: "ja-JP", nativeLabel: "日本語", englishLabel: "Japanese" },
      ],
    },
    api: {
      providers: [
        {
          id: "deepseek",
          label: "DeepSeek",
          enabled: true,
          keyLabel: "DeepSeek API Key",
          credentialMode: "secure-storage",
          models: [
            { id: "deepseek-flash", label: "DeepSeek V4.1 Flash", enabled: true, contextLimit: 1000000 },
            { id: "deepseek-v4-pro", label: "deepseek-v4-pro（高级）", enabled: true, contextLimit: 1000000 },
          ],
        },
        {
          id: "openai-compatible",
          label: "自定义连接",
          enabled: true,
          custom: true,
          models: [],
        },
      ],
    },
    narration: {
      lengthPresets: [
        { id: "adaptive", label: "智能", targetChars: null, paragraphGuide: "随当前场景调整", enabled: true },
        { id: "short", label: "简短", targetChars: 200, paragraphGuide: "1 到 2 段", enabled: true },
        { id: "standard", label: "标准", targetChars: 300, paragraphGuide: "2 到 3 段", enabled: true },
        { id: "detailed", label: "细节", targetChars: 400, paragraphGuide: "3 到 4 段", enabled: true },
        { id: "custom", label: "自定义", targetChars: 300, paragraphGuide: "按目标长度推导", enabled: true },
      ],
      customTargetChars: { min: 120, max: 800, default: 300 },
      defaultPreset: "standard",
    },
    agent: {
      context: {
        contextWindowPresets: [64000, 128000, 256000, 512000, 1000000],
        customContextWindow: { min: 64000, max: 1000000, step: 1000 },
        autoCompactRatioPresets: [0.65, 0.75, 0.85],
        customAutoCompactRatio: { min: 0.5, max: 0.85, step: 0.01 },
        emergencyGuardRatio: 0.9,
      },
    },
    ui: {
      textSizePresets: [
        { id: "small", label: "小" },
        { id: "medium", label: "中" },
        { id: "large", label: "大" },
      ],
      narrationTextSizeDefault: "medium",
      sidePanelTextSizeDefault: "medium",
      windowModeDefault: "standard",
      currentWindowMode: "standard",
      gameUiLayoutDefault: "story-notebook-v1",
      gameUiLayouts: ["story-notebook-v1"],
      windowModes: [
        { id: "compact", kind: "windowed", contentWidth: 1280, contentHeight: 720, enabled: true },
        { id: "standard", kind: "windowed", contentWidth: 1600, contentHeight: 900, enabled: true },
        { id: "large", kind: "windowed", contentWidth: 1920, contentHeight: 1080, enabled: true },
        { id: "qhd", kind: "windowed", contentWidth: 2560, contentHeight: 1440, enabled: true },
        { id: "fullscreen", kind: "fullscreen", contentWidth: null, contentHeight: null, enabled: true },
      ],
    },
    audio: {
      ttsProviders: [
        { id: "disabled", label: "关闭", enabled: true },
        {
          id: "kokoro-original-local",
          label: "Kokoro 高质量中文（实验）",
          enabled: true,
          experimental: true,
          online: false,
          supportsPitch: false,
          resourceNotice: "首次朗读需要加载高质量本地中文模型。",
          voices: [
            { id: "zm_010", label: "中文男声 10（默认）" },
            { id: "zm_009", label: "中文男声 09" },
            { id: "zf_001", label: "中文女声 01" },
            { id: "zf_006", label: "中文女声 06" },
          ],
        },
      ],
      ttsDefaults: {
        cacheUtteranceLimit: 20,
        cacheUtterancePresets: [10, 20, 40],
        cacheMaxBytes: 524288000,
      },
    },
    security: {
      credentialPersistence: "preview-only",
      secureStorageNotice: "预览模式不保存 API Key。",
      fallbackNotice: "预览模式不保存 API Key。",
      secureStorage: { enabled: false },
    },
    modelHelp: {
      schemaVersion: "grey-crow-model-help-v1",
      locale: "zh-CN",
      localGuide: {
        title: "自定义模型连接",
        body: "请填写供应商提供的 API Base URL、API Key 和 Model ID。网页聊天地址不能作为 API 地址。连接测试会产生少量 API 消耗，并验证两步工具调用。",
        compatibilityNotice: "测试成功只表示该连接能够运行灰鸦工具协议，不代表灰鸦维护其价格、质量或长期可用性。",
      },
      entries: [
        { id: "deepseek", label: "DeepSeek", summary: "内置模型说明" },
        { id: "openai", label: "OpenAI", summary: "OpenAI 模型说明" },
        { id: "gemini", label: "Gemini", summary: "OpenAI compatibility 说明" },
        { id: "qwen", label: "Qwen", summary: "工具调用说明" },
        { id: "claude", label: "Claude", summary: "兼容层说明" },
        { id: "openrouter", label: "OpenRouter", summary: "工具调用说明" },
      ],
    },
    skills: {
      schemaVersion: "grey-crow-skill-index-v1",
      source: "preview-base-content",
      loadedCount: 7,
      loaded: [
        { id: "new-game", label: "新游戏", title: "New Game", kind: "lifecycle", danger: "medium", userMenuCommand: true },
        { id: "delete-game", label: "删档", title: "Delete Game", kind: "system-dangerous", danger: "critical", userMenuCommand: true },
        { id: "game-state", label: "状态", title: "游戏状态", kind: "read-write", danger: "medium", userMenuCommand: true },
        { id: "map", label: "地点", title: "Map", kind: "read", danger: "low", userMenuCommand: true },
        { id: "entity-memory", label: "记忆", title: "Entity / World Memory", kind: "read-write", danger: "medium", userMenuCommand: false },
        { id: "game-save", label: "存档", title: "Game Save / Auto Save", kind: "read-write", danger: "medium", userMenuCommand: true },
        { id: "summarize", label: "摘要", title: "Summarize / Compaction", kind: "maintenance", danger: "medium", userMenuCommand: true },
      ],
    },
  };
}

function mergePreviewSettings(previous, patch = {}) {
  return {
    ...previous,
    ...patch,
    localization: { ...previous.localization, ...(patch.localization || {}) },
    api: { ...previous.api, ...(patch.api || {}) },
    narration: { ...previous.narration, ...(patch.narration || {}) },
    agent: {
      ...previous.agent,
      ...(patch.agent || {}),
      context: { ...previous.agent?.context, ...(patch.agent?.context || {}) },
    },
    ui: { ...previous.ui, ...(patch.ui || {}) },
    audio: {
      ...previous.audio,
      ...(patch.audio || {}),
      tts: { ...previous.audio.tts, ...(patch.audio?.tts || {}) },
    },
    developer: { ...previous.developer, ...(patch.developer || {}) },
  };
}

function createPreviewSave() {
  return {
    id: "preview-save",
    title: "UI 预览冒险",
    adventureLocale: "zh-CN",
    turn: 12,
    updatedAt: new Date().toISOString(),
    state_hint: createPreviewStateHint(12),
  };
}

function createPreviewStateHint(turn) {
  return {
    scene: {
      localized_names: { "zh-CN": "旧棚门后", "en-US": "Behind the Old Shed Door" },
    },
    player: {
      localized_status: { "zh-CN": "可行动", "en-US": "Ready" },
    },
    time: { turn },
  };
}

function createPreviewStatus(save, settings) {
  return {
    provider: settings.api.provider,
    model: settings.api.model,
    keyVerified: true,
    gameStarted: true,
    activeSaveId: save.id,
    activeSave: save,
    locale: {
      schemaVersion: "grey-crow-locale-state-v1",
      preferredLocale: settings.localization?.preferredLocale || "zh-CN",
      adventureLocale: save.adventureLocale || "zh-CN",
      effectiveLocale: save.adventureLocale || settings.localization?.preferredLocale || "zh-CN",
      localeRevision: "locale_000001",
      selectionRequired: false,
      activeAdventure: true,
      activeAdventureId: save.id,
      adventureLocaleSource: "save_metadata",
    },
    credential: {
      schemaVersion: "desktop-credential-preview",
      credentialPersistence: "preview-only",
      hasVerifiedCredential: true,
      provider: settings.api.provider,
      model: settings.api.model,
      requiresRetestAfterRestart: true,
      persistentCredentialAvailable: false,
      secureStorageEnabled: false,
      secureStorageAvailable: false,
      platform: "browser-preview",
    },
    settings,
  };
}

function createPreviewHistory() {
  return [
    {
      kind: "continuation_summary",
      host: "预览模式：这里只展示正式游戏第二层 UI 的布局，不读取真实存档。",
    },
    {
      kind: "player",
      content: "我把门后的声音记住，先不靠近，沿着墙边继续听。",
    },
    {
      kind: "host",
      content: "雨声压在旧棚顶上，像一层脏玻璃。你停在阴影里，右侧通道传来的金属拖地声变慢了一点，随后又被风吹散。\n\n门把手上挂着一只空水瓶，瓶口朝下。它没有再响，但你知道，只要门被推开，它会敲到地面。",
    },
  ];
}

function createPreviewStoryFinale() {
  return {
    ok: true,
    status: "closed",
    projection: {
      phase: "closed",
      mode: "archive",
      inputAllowed: false,
      engineNotice: "故事已完结 · 完整记录已保存",
      actions: { exportStory: true, continueAsChild: true },
    },
    finale: {
      finale_id: "finale_preview",
      narration: "门后的回声终于安静下来。你没有得到所有答案，却已经为这段旅程选择了属于自己的结尾。",
      review: { title: "门后的余音", summary: "故事在旧棚门后收束。", key_events: [], open_threads: [] },
    },
  };
}

function createPreviewTurnResult(save, content, status) {
  return {
    ok: true,
    save,
    saves: [save],
    status,
    envelope: {
      segments: [{ type: "host", content }],
      state_hint: save.state_hint,
      meta: {
        operation_trace: {
          anchor_summary: {
            context_budget: createPreviewContextBudget(),
          },
        },
      },
    },
  };
}

function createPreviewContextBudget() {
  return {
    window: 256000,
    budget_input_limit: 196000,
    full_context_estimate: 58000,
    usage_ratio: 0.296,
    item_count: 8,
    itemization: [
      { name: "host", prompt_tokens: 3200 },
      { name: "state", prompt_tokens: 700 },
      { name: "rolling_handoff", prompt_tokens: 1600 },
      { name: "recent_transcript", prompt_tokens: 18000, records: 16 },
      { name: "pending_memory", prompt_tokens: 4200, records: 12 },
      { name: "skill_index", prompt_tokens: 1300 },
      { name: "tool_schemas", prompt_tokens: 2600 },
      { name: "full_context", prompt_tokens: 58000 },
    ],
  };
}

function createPreviewDebugTrace(turn) {
  return {
    createdAt: new Date().toISOString(),
    request_id: "preview-trace",
    provider: {
      provider: "deepseek",
      model: "deepseek-flash",
      status: "preview",
      finish_reason: "stop",
      usage: { input_tokens: 58000, output_tokens: 260, total_tokens: 58260 },
      call_count: 1,
    },
    anchor_summary: {
      context_budget: createPreviewContextBudget(),
      memory: {
        recent_transcript_count: 16,
        recent_transcript_range: { start: Math.max(1, turn - 15), end: turn },
        summary_version: "preview-v1",
      },
      redactions: { redacted_values: 0, local_path_values: 0 },
    },
    tools: {
      executed: 0,
      ok_count: 0,
      error_count: 0,
      repair_attempts: 0,
      tool_names: [],
    },
    memory: {
      audit_write_count: 0,
      compaction: { skipped: true, reason: "preview" },
    },
    duration_ms: 12,
  };
}

function applyPreviewContextUsage() {
  state.contextUsage = normalizeContextUsageFromBudget(createPreviewContextBudget(), {
    source: "browser_preview",
    trigger: "preview",
  });
  renderContextUsage();
}

function createPreviewNewGameCatalog() {
  const packId = "grey-crow-default";
  const host = { packId, packTitle: "Grey Crow", packVersion: "2.0.0", ownership: "built_in", itemId: "grey-crow-host", type: "host", title: "灰鸦主持人", language: "zh-CN", description: "冷静、克制、具体的主持风格。", danger: "low" };
  const world = { packId, packTitle: "Grey Crow", packVersion: "2.0.0", ownership: "built_in", itemId: "shanghai-day10", type: "world", title: "上海·爆发后第十天", language: "zh-CN", description: "城市正在失效，但还没有彻底死去。", danger: "medium" };
  const skills = [
    ["game-state", "游戏状态"],
    ["map", "地图"],
    ["entity-memory", "实体与世界记忆"],
  ].map(([itemId, title]) => ({ packId, packTitle: "Grey Crow", packVersion: "2.0.0", ownership: "built_in", itemId, type: "skill", title, language: "zh-CN", description: `${title} Skill`, danger: "medium" }));
  const newGameSkill = { packId, packTitle: "Grey Crow", packVersion: "2.0.0", ownership: "built_in", itemId: "new-game-default", type: "skill", skillClass: "new_game", title: "灰鸦默认开局", language: "zh-CN", description: "通过多轮对话确认本局开局锚点。", danger: "medium" };
  const preset = {
    packId,
    packTitle: "Grey Crow",
    packVersion: "2.0.0",
    ownership: "built_in",
    itemId: "grey-crow-default",
    title: "灰鸦·上海末日",
    language: "zh-CN",
    description: "灰鸦主持人与上海爆发后第十天世界的专用内容组合。",
    danger: "low",
    selection: {
      host: { packId, itemId: host.itemId },
      world: { packId, itemId: world.itemId },
      newGameSkill: { packId, itemId: newGameSkill.itemId },
      skills: skills.map((item) => ({ packId, itemId: item.itemId })),
    },
  };
  return {
    schemaVersion: "grey-crow-new-game-catalog-v2",
    hosts: [host],
    worlds: [world],
    newGameSkills: [newGameSkill],
    skills,
    presets: [preset],
    defaultPreset: { packId, itemId: preset.itemId },
    defaultSelection: {
      host: { packId, itemId: host.itemId },
      world: { packId, itemId: world.itemId },
      newGameSkill: { packId, itemId: newGameSkill.itemId },
      skills: skills.map((item) => ({ packId, itemId: item.itemId })),
    },
    engineCapabilities: ["base-state", "new-game", "delete-game", "transcript", "memory", "compaction"].map((id) => ({ id, required: true, disableAllowed: false })),
    packCount: 1,
    quarantinedPackCount: 0,
    invalidPackCount: 0,
  };
}

function createPreviewNewGameReview(selection = {}) {
  const catalog = createPreviewNewGameCatalog();
  const preset = catalog.presets.find((item) => newGameRefKey(item) === newGameRefKey(selection.preset || catalog.defaultPreset)) || catalog.presets[0];
  const resolvedSelection = preset.selection;
  const host = catalog.hosts.find((item) => item.itemId === resolvedSelection.host?.itemId) || catalog.hosts[0];
  const world = catalog.worlds.find((item) => item.itemId === resolvedSelection.world?.itemId) || catalog.worlds[0];
  const newGameSkill = catalog.newGameSkills.find((item) => item.itemId === resolvedSelection.newGameSkill?.itemId) || catalog.newGameSkills[0];
  const selected = new Set((resolvedSelection.skills || []).map((item) => `${item.packId}:${item.itemId}`));
  const skills = catalog.skills.filter((item) => selected.has(`${item.packId}:${item.itemId}`));
  const project = (item) => ({ packId: item.packId, packVersion: item.packVersion, itemId: item.itemId, type: item.type, title: item.title, language: item.language, description: item.description, danger: item.danger });
  return {
    schemaVersion: "grey-crow-new-game-review-v2",
    preset: project(preset),
    selection: resolvedSelection,
    host: project(host),
    world: project(world),
    newGameSkill: project(newGameSkill),
    skills: skills.map(project),
    activePacks: [{ id: "grey-crow-default", title: "Grey Crow Default Content", version: "2.1.0" }],
    engineCapabilities: catalog.engineCapabilities,
    replacements: [],
    language: "zh-CN",
    languageStatus: "matched",
    dependencyStatus: "resolved",
    integrityStatus: "ready_to_lock",
  };
}

function createPreviewSkillModules() {
  const stateless = ["游戏状态", "地图", "实体与世界记忆"].map((title) => ({
    schemaVersion: "grey-crow-skill-module-projection-v1",
    packTitle: "Grey Crow",
    title,
    description: `${title}的本局玩法说明。`,
    triggers: [`需要使用${title}时`],
    playerGuide: `主持人会在相关场景中使用${title}，玩家不需要输入固定命令。`,
    hasModule: false,
    moduleRef: null,
    visibility: null,
    activated: false,
    stateVersion: null,
    revision: null,
    summary: [],
    fields: [],
    pagination: null,
  }));
  const records = createPreviewSkillModuleRecords();
  return [...stateless, {
    schemaVersion: "grey-crow-skill-module-projection-v1",
    packTitle: "Grey Crow UI Preview",
    title: "旅程线索",
    description: "用于验证通用 Skill Module 只读界面，不属于正式玩法内容。",
    triggers: ["发现能够延续本局调查的明确线索时"],
    playerGuide: "主持人会记录本局旅程中的关键线索；你可以在扩展槽中查看进度和已经记录的条目。",
    hasModule: true,
    moduleRef: "module_11111111111111111111111111111111",
    visibility: "visible",
    activated: true,
    stateVersion: 1,
    revision: 2,
    summary: [
      { fieldId: "progress", text: "调查进度 · 4/10" },
      { fieldId: "clues", text: "线索 · 2 · 初见端倪" },
    ],
    fields: [
      {
        id: "progress", label: "调查进度", type: "integer", widget: "progress", value: 4,
        derivedSummary: null, minimum: 0, maximum: 10, options: [], itemFields: [],
      },
      {
        id: "mood", label: "当前氛围", type: "enum", widget: "badge", value: "tense",
        derivedSummary: null, minimum: null, maximum: null,
        options: [{ value: "quiet", label: "平静" }, { value: "tense", label: "紧张" }], itemFields: [],
      },
      {
        id: "clues", label: "旅程线索", type: "record_list", widget: "timeline", value: [],
        derivedSummary: { count: records.length, target: 10, milestoneLabel: "初见端倪", groupCounts: [{ value: "place", label: "地点", count: 1 }, { value: "person", label: "人物", count: 1 }] },
        minimum: null, maximum: null, options: [],
        itemFields: [
          { id: "kind", label: "类型", type: "enum", options: [{ value: "place", label: "地点" }, { value: "person", label: "人物" }] },
          { id: "note", label: "线索", type: "text", options: [] },
        ],
      },
    ],
    pagination: null,
  }];
}

function createPreviewSkillModuleRecords() {
  return [
    { entry_id: "entry_11111111111111111111111111111111", created_turn: 2, created_at: "2026-07-16T09:00:00.000Z", kind: "place", note: "废弃站台留下了新鲜脚印。" },
    { entry_id: "entry_22222222222222222222222222222222", created_turn: 4, created_at: "2026-07-16T09:02:00.000Z", kind: "person", note: "戴灰色围巾的人认出了旧地图。" },
  ];
}

function bindEvents() {
  ui.exportProblemReportButton.addEventListener("click", async () => {
    if (ui.exportProblemReportButton.disabled) return;
    ui.exportProblemReportButton.disabled = true;
    ui.problemReportStatus.textContent = t("settings.report.saving");
    try {
      const result = await window.greyCrow.exportProblemReport();
      ui.problemReportStatus.textContent = result?.cancelled ? t("settings.report.cancelled")
        : result?.ok ? t("settings.report.saved", { filename: result.filename }) : t("settings.report.failed");
    } catch { ui.problemReportStatus.textContent = t("settings.report.failed"); }
    finally { ui.exportProblemReportButton.disabled = false; }
  });
  ui.menuLanguageToggle.addEventListener("click", () => {
    const shouldOpen = ui.menuLanguageOptions.hidden;
    setMenuLanguagePickerOpen(shouldOpen);
    if (shouldOpen && !ui.menuLanguageOptions.hidden) {
      ui.menuLanguageButtons.find((button) => button.getAttribute("aria-checked") === "true")?.focus();
    }
  });
  ui.menuLanguageButtons.forEach((button) => {
    button.addEventListener("click", () => chooseMainMenuLanguage(button.dataset.menuLocale));
  });
  document.addEventListener("pointerdown", (event) => {
    if (!ui.menuLanguageSwitcher.contains(event.target)) setMenuLanguagePickerOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || ui.menuLanguageOptions.hidden) return;
    setMenuLanguagePickerOpen(false);
    ui.menuLanguageToggle.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isStoryNotebookDrawerOpen()) return;
    if (document.querySelector("dialog[open]")) return;
    event.preventDefault();
    closeStoryNotebookDrawer();
  });
  ui.settingsButton.addEventListener("click", () => openSettings());
  ui.exitGameButton.addEventListener("click", () => quitDesktopApp());
  ui.gameSettingsButton.addEventListener("click", () => openGameSettingsFromStoryRail());
  ui.storyNotebookRailButtons.forEach((button) => {
    button.addEventListener("click", () => openStoryNotebookDrawer(button.dataset.notebookPanel, button));
  });
  ui.storyNotebookDrawerBackButton.addEventListener("click", () => returnStoryNotebookDrawer());
  ui.storyNotebookDrawerRefreshButton.addEventListener("click", () => refreshStoryNotebookDrawer());
  ui.storyNotebookDrawerCloseButton.addEventListener("click", () => closeStoryNotebookDrawer());
  ui.contentCreatorButton.addEventListener("click", () => openContentCreator());
  ui.openContentCreatorButton.addEventListener("click", () => openContentCreator());
  ui.closeContentCreatorWarningButton.addEventListener("click", () => closeContentCreator());
  ui.cancelContentCreatorButton.addEventListener("click", () => closeContentCreator());
  ui.closeContentCreatorButton.addEventListener("click", () => closeContentCreator());
  ui.acknowledgeContentCreatorButton.addEventListener("click", () => acknowledgeContentCreatorWarning());
  ui.manageContentPacksButton.addEventListener("click", () => openContentPackSettings());
  ui.contentCreatorModeContent.addEventListener("click", () => setContentCreatorMode("content"));
  ui.contentCreatorModePreset.addEventListener("click", () => setContentCreatorMode("preset"));
  ui.settingsTabs.forEach((button) => {
    button.addEventListener("click", () => switchSettingsTab(button.dataset.settingsTab));
    button.addEventListener("keydown", (event) => handleSettingsTabKeydown(event, button));
  });
  ui.manualSaveButton.addEventListener("click", () => requestManualSave());
  ui.chapterLogButton.addEventListener("click", () => openChapterLogs());
  ui.saveMaintenanceButton.addEventListener("click", () => openMaintenanceFromSettings());
  ui.contentPackSelect.addEventListener("change", () => {
    state.selectedContentPackId = ui.contentPackSelect.value || null;
    state.editableContentItem = null;
    state.blankContentPickerOpen = false;
    state.contentAdvancedInfoOpen = false;
    renderContentLibrary();
  });
  ui.contentCreatorPackSelect.addEventListener("change", () => {
    state.selectedContentPackId = ui.contentCreatorPackSelect.value || null;
    state.editableContentItem = null;
    state.editableContentPreset = null;
    state.blankContentPickerOpen = false;
    state.contentAdvancedInfoOpen = false;
    ui.contentEditorStatus.textContent = t(state.selectedContentPackId
      ? "creator.status.selectThenOpen"
      : "creator.status.noEditablePackCreateBlank");
    renderContentLibrary();
  });
  ui.refreshContentLibraryButton.addEventListener("click", () => refreshContentManagement());
  ui.cloneContentPackButton.addEventListener("click", () => cloneContentPack());
  ui.exportContentPackButton.addEventListener("click", () => exportContentPack());
  ui.deleteContentPackButton.addEventListener("click", () => deleteContentPack());
  ui.contentEditorItemSelect.addEventListener("change", () => {
    state.editableContentItem = null;
    state.editableContentPreset = null;
    state.blankContentPickerOpen = false;
    state.contentAdvancedInfoOpen = false;
    ui.contentEditorStatus.textContent = t("creator.status.openBeforeEdit");
    renderContentEditor();
  });
  ui.loadContentEditorButton.addEventListener("click", () => state.contentCreatorMode === "preset" ? loadEditableContentPreset() : loadEditableContentItem());
  ui.newBlankContentButton.addEventListener("click", () => openBlankContentPicker());
  ui.closeBlankContentPickerButton.addEventListener("click", () => closeBlankContentPicker());
  ui.blankContentKindButtons.forEach((button) => button.addEventListener("click", () => beginBlankContent(button.dataset.blankContentKind)));
  ui.cancelBlankContentButton.addEventListener("click", () => cancelBlankContent());
  ui.toggleContentAdvancedInfoButton.addEventListener("click", () => toggleContentAdvancedInfo());
  ui.newContentPresetButton.addEventListener("click", () => beginNewContentPreset());
  ui.contentModuleEnabledInput.addEventListener("change", () => toggleContentModuleDraft());
  ui.addContentModuleFieldButton.addEventListener("click", () => addContentModuleField());
  ui.previewContentEditorButton.addEventListener("click", () => previewContentEditor());
  ui.saveContentEditorButton.addEventListener("click", () => saveEditableContentItem());
  ui.previewContentPresetButton.addEventListener("click", () => renderContentPresetPreview());
  ui.saveContentPresetButton.addEventListener("click", () => saveEditableContentPreset());
  ui.contentPresetLanguageInput.addEventListener("change", () => renderContentPresetChoices());
  for (const control of [ui.contentPresetHostSelect, ui.contentPresetWorldSelect, ui.contentPresetNewGameSkillSelect, ui.contentPresetSkillList]) {
    control.addEventListener("change", () => renderContentPresetPreview());
  }
  ui.savePlayerProfileButton.addEventListener("click", () => savePlayerProfile());
  ui.debugPanelButton.addEventListener("click", () => openDebugPanel());
  ui.closeSettingsButton.addEventListener("click", () => void closeSettings());
  ui.closeMaintenanceButton.addEventListener("click", () => closeMaintenance());
  ui.closeDebugButton.addEventListener("click", () => closeDebugPanel());
  ui.debugRefreshButton.addEventListener("click", () => refreshDebugTrace());
  ui.debugExportButton.addEventListener("click", () => exportDebugTrace());
  ui.maintenanceRepairButton.addEventListener("click", () => requestSaveMaintenance("repair"));
  ui.maintenanceClearButton.addEventListener("click", () => requestSaveMaintenance("clear"));
  ui.maintenanceForm.addEventListener("submit", (event) => event.preventDefault());
  ui.maintenanceConfirmButton.addEventListener("click", () => confirmSaveMaintenance());
  ui.maintenanceCancelButton.addEventListener("click", () => clearMaintenanceConfirmation());
  ui.newGameConfirmForm.addEventListener("submit", (event) => event.preventDefault());
  ui.closeNewGameConfirmButton.addEventListener("click", () => closeNewGameRestartDialog());
  ui.confirmNewGameRestartButton.addEventListener("click", () => confirmNewGameRestart());
  ui.cancelNewGameRestartButton.addEventListener("click", () => closeNewGameRestartDialog());
  ui.closeNewGameSetupButton.addEventListener("click", () => closeNewGameSetupDialog());
  ui.cancelNewGameSetupButton.addEventListener("click", () => closeNewGameSetupDialog());
  ui.prepareNewGameButton.addEventListener("click", () => prepareOrConfirmNewGame());
  ui.newGamePresetSelect.addEventListener("change", () => invalidateNewGameReview());
  ui.closeSkillModuleButton.addEventListener("click", () => closeSkillModuleDialog());
  ui.doneSkillModuleButton.addEventListener("click", () => closeSkillModuleDialog());
  ui.skillModuleDialog.addEventListener("close", () => restoreSkillModuleFocus());
  ui.newGameButton.addEventListener("click", () => startNewGame());
  ui.continueGameButton.addEventListener("click", () => continueLatestGame());
  ui.providerPresetSelect.addEventListener("change", () => {
    const draft = getConnectionDraft();
    state.connectionDraft = { ...draft, provider: ui.providerPresetSelect.value, model: state.model,
      connectionId: state.customConnections[0]?.id || null };
    setConnectionStatus("");
    renderModelOptions();
    renderCustomConnectionSettings({ populateFields: true });
    renderCredentialSettings();
  });
  ui.modelPresetSelect.addEventListener("change", () => {
    state.connectionDraft = { ...getConnectionDraft(), model: ui.modelPresetSelect.value };
    renderCredentialSettings();
  });
  ui.customConnectionSelect.addEventListener("change", () => {
    state.connectionDraft = { ...getConnectionDraft(), connectionId: ui.customConnectionSelect.value || null };
    delete state.connectionDraft.custom;
    renderCustomConnectionSettings({ populateFields: true });
    renderModelOptions();
    renderCredentialSettings();
  });
  for (const control of [ui.customConnectionNameInput, ui.customBaseUrlInput, ui.customModelIdInput]) {
    control.addEventListener("input", () => {
      state.connectionDraft = { ...getConnectionDraft(), custom: readCustomConnectionDraft() };
      setConnectionStatus("");
    });
  }
  ui.saveCustomConnectionButton.addEventListener("click", () => saveCustomConnection());
  ui.deleteCustomConnectionButton.addEventListener("click", () => deleteCustomConnection());
  ui.narrationLengthPresetSelect.addEventListener("change", () => {
    state.narrationLengthPreset = ui.narrationLengthPresetSelect.value;
    renderNarrationSettings();
  });
  ui.narrationCustomTargetInput.addEventListener("input", () => {
    state.narrationCustomTargetChars = Number.parseInt(ui.narrationCustomTargetInput.value, 10);
    renderNarrationStatus();
  });
  ui.narrationTextSizeSelect.addEventListener("change", () => {
    state.narrationTextSize = normalizeUiTextSize(ui.narrationTextSizeSelect.value);
    renderUiDisplaySettings();
  });
  ui.sidePanelTextSizeSelect.addEventListener("change", () => {
    state.sidePanelTextSize = normalizeUiTextSize(ui.sidePanelTextSizeSelect.value);
    renderUiDisplaySettings();
  });
  ui.storyNotebookThemeSelect.addEventListener("change", () => {
    state.storyNotebookTheme = normalizeStoryNotebookTheme(ui.storyNotebookThemeSelect.value);
    renderGameUiLayout();
    syncNotebookPresentation();
    markSettingsDirty(ui.storyNotebookThemeSelect);
  });
  ui.windowModeSelect.addEventListener("change", () => {
    state.windowMode = normalizeWindowMode(ui.windowModeSelect.value);
    renderUiDisplaySettings();
  });
  ui.gameLanguageSelect.addEventListener("change", () => {
    state.preferredLocale = ui.gameLanguageSelect.value;
    renderUiDisplaySettings();
  });
  ui.autoSaveEnabledSelect.addEventListener("change", () => {
    state.autoSaveEnabled = ui.autoSaveEnabledSelect.value === "true";
    renderSaveSettings();
  });
  ui.autoSaveIntervalSelect.addEventListener("change", () => {
    state.autoSaveIntervalTurns = collectAutoSaveSettingsFromUi().intervalTurns;
    ui.autoSaveIntervalCustomInput.disabled = ui.autoSaveIntervalSelect.value !== "custom" || !state.autoSaveEnabled;
    renderSaveSettingsStatus();
  });
  ui.autoSaveIntervalCustomInput.addEventListener("input", () => {
    state.autoSaveIntervalTurns = collectAutoSaveSettingsFromUi().intervalTurns;
    renderSaveSettingsStatus();
  });
  ui.manualChapterSelect.addEventListener("change", () => { state.manualChapterEnabled = ui.manualChapterSelect.value === "true"; });
  ui.compactionChapterSelect.addEventListener("change", () => { state.compactionChapterEnabled = ui.compactionChapterSelect.value === "true"; });
  ui.testKeyButton.addEventListener("click", () => testApiKey());
  ui.clearKeyButton.addEventListener("click", () => clearStoredApiKey());
  ui.clearAllKeysButton?.addEventListener("click", () => clearStoredApiKey({ all: true }));
  ui.modelHelpLinks.addEventListener("click", (event) => openModelHelp(event));
  ui.saveSettingsButton.addEventListener("click", () => void saveSettings());
  ui.backToMenuButton.addEventListener("click", () => void returnToMainMenuFromSettings());
  ui.storyExportHtmlButton.addEventListener("click", () => exportStoryArchive("html"));
  ui.storyExportMarkdownButton.addEventListener("click", () => exportStoryArchive("markdown"));
  ui.storyContinueButton.addEventListener("click", () => continueStoryArchive());
  ui.storyArchiveBackButton.addEventListener("click", () => showMenu());
  ui.storyResumeFinaleButton.addEventListener("click", () => resumeSessionFinale());
  ui.gameVolumeInput.addEventListener("input", () => {
    speechAudioUserRevision++;
    state.gameVolume = Number.parseInt(ui.gameVolumeInput.value, 10);
    renderAudioSettings();
  });
  ui.ttsReadingModeSelect.addEventListener("change", () => {
    applyTtsReadingMode(ui.ttsReadingModeSelect.value);
    renderAudioSettings();
  });
  ui.ttsProviderSelect.addEventListener("change", () => {
    state.ttsProvider = ui.ttsProviderSelect.value;
    state.ttsEnabled = state.ttsProvider !== "disabled";
    renderTtsVoiceOptions();
    renderAudioSettings();
  });
  ui.ttsVoiceSelect.addEventListener("change", () => {
    state.ttsVoiceId = ui.ttsVoiceSelect.value;
  });
  ui.ttsRateInput.addEventListener("input", () => {
    state.ttsRate = ui.ttsRateInput.value;
  });
  ui.ttsPitchInput.addEventListener("input", () => {
    state.ttsPitch = ui.ttsPitchInput.value;
  });
  ui.ttsCacheLimitSelect.addEventListener("change", () => {
    state.ttsCacheUtteranceLimit = normalizeTtsCacheUtteranceLimit(ui.ttsCacheLimitSelect.value);
    renderTtsCacheStatus();
  });
  ui.clearTtsCacheButton.addEventListener("click", () => clearTtsCache());
  ui.ttsTestButton.addEventListener("click", () => testTtsVoice());
  ui.ttsPlaybackToggleButton.addEventListener("click", () => toggleTtsPlayback());
  ui.debugPanelEnabledSelect.addEventListener("change", () => {
    state.debugPanelEnabled = ui.debugPanelEnabledSelect.value === "true";
    renderDeveloperSettings();
  });
  ui.contextWindowPresetSelect.addEventListener("change", () => {
    ui.contextWindowCustomInput.disabled = ui.contextWindowPresetSelect.value !== "custom";
    renderContextPolicyStatus();
  });
  ui.contextWindowCustomInput.addEventListener("input", () => renderContextPolicyStatus());
  ui.autoCompactRatioSelect.addEventListener("change", () => {
    ui.autoCompactRatioCustomInput.disabled = ui.autoCompactRatioSelect.value !== "custom";
    renderContextPolicyStatus();
  });
  ui.autoCompactRatioCustomInput.addEventListener("input", () => renderContextPolicyStatus());
  ui.refreshAdvancedMetricsButton.addEventListener("click", () => refreshAdvancedMetrics());
  ui.turnForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runTurn();
  });
  ui.cancelTurnButton.addEventListener("click", () => requestSessionTurnCancellation());
  ui.turnInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    if (event.isComposing) {
      return;
    }
    if (event.shiftKey) {
      return;
    }
    event.preventDefault();
    runTurn();
  });
  ui.observeCommandButton.addEventListener("click", () => runCommandTurn("observe"));
  ui.listenCommandButton.addEventListener("click", () => runCommandTurn("listen"));
  ui.mapCommandButton.addEventListener("click", () => runCommandTurn("map"));
  ui.backpackCommandButton.addEventListener("click", () => runCommandTurn("backpack"));
  ui.compactContextButton.addEventListener("click", () => openCompactDialog());
  ui.settingsCompactContextButton.addEventListener("click", async () => {
    if (state.busy || state.settingsDirty || !(await closeSettings())) return;
    openCompactDialog();
  });
  ui.closeCompactButton.addEventListener("click", () => closeCompactDialog());
  ui.cancelCompactButton.addEventListener("click", () => closeCompactDialog());
  ui.confirmCompactButton.addEventListener("click", () => confirmContextCompaction());
  ui.closeChapterButton.addEventListener("click", () => closeChapterLogs());
  ui.chapterRefreshButton.addEventListener("click", () => refreshChapterLogs());
  ui.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  ui.settingsForm.addEventListener("input", (event) => markSettingsDirty(event.target));
  ui.settingsForm.addEventListener("change", (event) => markSettingsDirty(event.target));
  ui.settingsDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    void closeSettings();
  });
  ui.settingsDialog.addEventListener("close", () => {
    clearApiKeyInput();
    state.settingsPersistenceWarning = "";
    renderSettingsPersistenceWarning();
  });
  ui.contentCreatorDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeContentCreator();
  });
  ui.contentCreatorDialog.addEventListener("close", () => {
    if (!ui.contentCreatorDialog.open) resetContentCreatorEntry();
  });
  ui.maintenanceDialog.addEventListener("close", () => {
    clearMaintenanceConfirmation();
  });
  ui.debugDialog.addEventListener("close", () => {
    state.debugTraceExport = null;
  });
  ui.chapterDialog.addEventListener("close", () => {
    ui.chapterStatus.textContent = t("chapter.initial");
  });
}

async function refreshStatus() {
  const result = await window.greyCrow.getStatus();
  applyStatus(result);
  if (result.settings) {
    applySettings(result.settings);
  }
}

async function refreshSettings() {
  const result = await window.greyCrow.getSettings();
  if (result?.catalog) {
    applySettingsCatalog(result.catalog);
  }
  if (result?.settings) {
    applySettings(result.settings);
  }
  applySettingsPersistence(result?.settingsPersistence);
}

function applySettingsPersistence(persistence = {}) {
  if (!persistence?.noticeRequired) {
    return;
  }
  state.settingsPersistenceWarning = persistence.status === "recovered_from_backup"
    ? "recovered_from_backup"
    : "defaults_restored";
  renderSettingsPersistenceWarning();
}

function renderSettingsPersistenceWarning() {
  if (!ui.settingsPersistenceWarning) {
    return;
  }
  ui.settingsPersistenceWarning.textContent = state.settingsPersistenceWarning
    ? t(state.settingsPersistenceWarning === "recovered_from_backup"
      ? "settings.persistence.recovered"
      : "settings.persistence.defaults")
    : "";
  ui.settingsPersistenceWarning.hidden = !state.settingsPersistenceWarning;
}

function applySettingsCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    return;
  }
  state.settingsCatalog = catalog;
  renderProviderOptions();
  renderModelHelp();
  renderNarrationSettings();
  renderAgentContextSettings();
  renderUiDisplaySettings();
  renderSaveSettings();
  renderTtsProviderOptions();
  renderLoadedSkillSlots();
}

function applyStatus(status = {}) {
  const previousKeyVerified = state.keyVerified;
  const previousActiveSaveId = state.activeSaveId;
  const previousSessionId = state.runtimeSessionId;
  const previousContextSettingsIdentity = state.sessionContextSettingsIdentity;
  const previousContextGeneration = state.sessionContextGeneration;
  const previousRevision = state.activeSave?.revision;
  const nextSessionId = Object.prototype.hasOwnProperty.call(status, "runtimeSessionId")
    ? status.runtimeSessionId : state.runtimeSessionId;
  const nextRecoveryKey = JSON.stringify([status.activeSaveId, nextSessionId]);
  if (state.runtimeProtocol === "session-1" && (state.retiredRuntimeSessions.has(nextSessionId)
    || (status.sessionRecoveryRequired && state.sessionRecoveryCompleted === nextRecoveryKey))) return false;
  // A late status response must not roll back even the menus or panel caches
  // before its originating request has had a chance to reject it.
  if (state.runtimeProtocol === "session-1" && !status.sessionRecoveryRequired
    && status.activeSaveId === previousActiveSaveId
    && nextSessionId === previousSessionId && Number.isSafeInteger(previousRevision)
    && (!Number.isSafeInteger(status.activeSave?.revision) || status.activeSave.revision < previousRevision)) return false;
  if (state.runtimeProtocol === "session-1" && status.activeSaveId === previousActiveSaveId
    && nextSessionId === previousSessionId && Number.isSafeInteger(previousContextGeneration)
    && Number.isSafeInteger(status.sessionContextGeneration)
    && status.sessionContextGeneration < previousContextGeneration) return false;
  state.keyVerified = Boolean(status.keyVerified);
  state.gameStarted = Boolean(status.gameStarted);
  state.activeSaveId = status.activeSaveId || null;
  state.activeSave = status.activeSave || null;
  // A draft belongs to one adventure. A settings-only session replacement
  // keeps it, but opening another adventure must not submit the former text.
  if (previousActiveSaveId !== state.activeSaveId) ui.turnInput.value = "";
  state.runtimeProtocol = status.runtimeProtocol || state.runtimeProtocol;
  state.runtimeSessionId = nextSessionId;
  speechInputController?.contextChanged();
  if (Object.hasOwn(status, "sessionContextSettingsIdentity")) {
    state.sessionContextSettingsIdentity = status.sessionContextSettingsIdentity;
    state.sessionContextCompactionAvailable = status.sessionContextCompactionAvailable === true;
  }
  if (Object.hasOwn(status, "sessionContextGeneration")) {
    state.sessionContextGeneration = Number.isSafeInteger(status.sessionContextGeneration) && status.sessionContextGeneration >= 0
      ? status.sessionContextGeneration : null;
  } else if (previousActiveSaveId !== state.activeSaveId || previousSessionId !== state.runtimeSessionId) {
    state.sessionContextGeneration = null;
  }
  state.sessionRecoveryRequired = status.sessionRecoveryRequired === true;
  if (state.sessionRecoveryRequired) state.gameStarted = false;
  if (previousSessionId !== state.runtimeSessionId || previousActiveSaveId !== state.activeSaveId) {
    clearTypewriterTimers();
    if (state.turnBusyRevision !== null && state.busyRevision === state.turnBusyRevision) setBusy(false);
    state.turnBusyRevision = null;
    if (state.compactionBusyRevision !== null && state.busyRevision === state.compactionBusyRevision) setBusy(false);
    state.compactionBusyRevision = null;
    if (state.pendingSessionCompaction?.adventureId !== state.activeSaveId) state.pendingSessionCompaction = null;
    else if (state.pendingSessionCompaction) {
      state.pendingSessionCompaction.sessionId = state.runtimeSessionId;
      state.pendingSessionCompaction.canRetry = false;
      state.pendingSessionCompaction.recoveryRequired = false;
      if (!["reduced", "no_benefit", "not_needed", "baseline_too_large"].includes(state.pendingSessionCompaction.status)) {
        state.pendingSessionCompaction.status = "unknown";
      }
    }
    if (state.runtimeProtocol === "session-1" && previousSessionId != null && previousSessionId !== nextSessionId) {
      state.retiredRuntimeSessions.add(previousSessionId);
    }
    state.pendingSessionAction = null;
    state.sessionDerivedWork.clear();
    state.historyCursor = null;
    state.renderedSessionActions.clear();
  }
  for (const [ticketId, work] of state.sessionDerivedWork) {
    if (!work.pending && work.binding.revision < state.activeSave?.revision) state.sessionDerivedWork.delete(ticketId);
  }
  if (previousActiveSaveId !== state.activeSaveId || previousSessionId !== state.runtimeSessionId
    || (state.runtimeProtocol === "session-1" && previousRevision !== state.activeSave?.revision)) {
    invalidateRuntimeNotebookProjection();
  }
  if (state.runtimeProtocol === "session-1" && (previousActiveSaveId !== state.activeSaveId
    || previousSessionId !== state.runtimeSessionId || previousRevision !== state.activeSave?.revision
    || previousContextSettingsIdentity !== state.sessionContextSettingsIdentity
    || previousContextGeneration !== state.sessionContextGeneration)) {
    state.contextUsage = null;
    renderContextUsage();
  }
  if (!state.activeSaveId) {
    state.lockedContent = null;
    state.skillModules = [];
    state.skillModuleRefreshError = "";
  }
  state.provider = status.provider || state.provider;
  state.model = status.model || state.model;
  state.credential = status.credential || null;
  const locale = status.locale && typeof status.locale === "object" ? status.locale : {};
  if (Object.prototype.hasOwnProperty.call(locale, "preferredLocale")) {
    state.preferredLocale = locale.preferredLocale;
  }
  state.adventureLocale = locale.adventureLocale || null;
  state.effectiveLocale = locale.effectiveLocale || state.adventureLocale || state.preferredLocale || null;
  state.localeRevision = locale.localeRevision || state.localeRevision;
  syncUiLocale();
  if (ui.settingsDialog.open) {
    renderContextPolicyStatus();
    if (previousKeyVerified !== state.keyVerified && !state.settingsSaving) renderSettingsStatus();
  }
  renderStoryNotebookMetadata();
  renderSessionCompactionControls();
  if (state.sessionRecoveryRequired) {
    renderTurnInputState();
    scheduleSessionRecovery();
  }
  return true;
}

function scheduleSessionRecovery() {
  const binding = captureRuntimeViewBinding();
  if (!binding.sessionMode || !binding.adventureId || binding.sessionId == null) return;
  const key = JSON.stringify([binding.adventureId, binding.sessionId]);
  if (state.sessionRecoveryAttempted === key) return;
  state.sessionRecoveryAttempted = key;
  queueMicrotask(async () => {
    if (!state.sessionRecoveryRequired || !isRuntimeViewBindingCurrent(binding, { includeRevision: false })) return;
    try {
      const restored = await continueGame(binding.adventureId, { recoveryBinding: binding });
      if (!restored && isRuntimeViewBindingCurrent(binding, { includeRevision: false })) {
        appendNarration("warning", ui.menuMessage.textContent || t("game.error.continue"));
        renderTurnInputState();
      }
    } catch (error) {
      if (!isRuntimeViewBindingCurrent(binding, { includeRevision: false })) return;
      ui.menuMessage.textContent = formatError(error, t("game.error.continue"));
      appendNarration("warning", ui.menuMessage.textContent);
      renderTurnInputState();
    }
  });
}

function resetStoryNotebookPanelState() {
  invalidateStoryNotebookNavigation();
  state.skillPanelListRequestRevision += 1;
  state.skillPanelViewRequestRevision += 1;
  state.characterPanelRequestRevision += 1;
  state.skillPanels = [];
  state.skillPanelSupported = null;
  state.skillPanelRefreshError = "";
  state.skillPanelRefreshBusy = false;
  state.characterPanelEntry = null;
  state.characterPanelSupported = null;
  state.characterPanelRefreshError = "";
  state.characterPanelRefreshBusy = false;
  state.activeSkillPanel = null;
  state.skillPanelOverviewProjection = null;
  state.skillPanelListProjection = null;
  state.activeSkillPanelProjection = null;
  state.skillPanelRecordFieldIds = [];
  state.skillPanelViewError = "";
  state.notebookDrawerSelectedPanelRef = null;
  state.notebookDrawerSelectedFieldId = null;
  state.notebookDrawerSelectedItemRef = null;
  renderStoryNotebookCharacterAvailability();
}

function invalidateRuntimeNotebookProjection() {
  resetStoryNotebookPanelState();
  if (state.runtimeProtocol !== "session-1") return;
  state.chapterReadRevision += 1;
  state.chapterReadBusy = false;
  state.chapterCursor = null;
  state.sessionChapterLogs = [];
  state.skillModules = [];
  state.activeSkillModule = null;
  state.skillModulePages.clear();
  if (isStoryNotebookDrawerOpen("characters")) state.notebookDrawerView = "panel-list";
  if (isStoryNotebookDrawerOpen("modules")) state.notebookDrawerView = "module-list";
  if (isStoryNotebookDrawerOpen()) renderStoryNotebookDrawer();
  const binding = captureRuntimeViewBinding();
  // Erase the old DOM synchronously. Only then request data for the new
  // committed version; old request finally blocks no longer own these caches.
  queueMicrotask(async () => {
    if (!isRuntimeViewBindingCurrent(binding) || !state.gameStarted || !binding.adventureId) return;
    if (await refreshStoryNotebookCharacterPanelEntry() && isRuntimeViewBindingCurrent(binding)
      && isStoryNotebookDrawerOpen("characters") && state.characterPanelEntry?.panelRef) {
      state.activeSkillPanel = state.characterPanelEntry;
      state.notebookDrawerSelectedPanelRef = state.activeSkillPanel.panelRef;
      await loadStoryNotebookCharacterDirectory();
    }
    if (isRuntimeViewBindingCurrent(binding) && isStoryNotebookDrawerOpen("modules")) {
      await refreshStoryNotebookSkillPanels();
    }
    if (isRuntimeViewBindingCurrent(binding) && hasOpenChapterSurface()) await refreshChapterLogs();
  });
}

function getCurrentAdventure() {
  const active = getActiveAdventure();
  const current = active || (state.activeSave?.id ? state.activeSave : null)
    || state.saves.find((save) => save.id === state.activeSaveId) || state.saves[0] || null;
  // Menu availability comes from the latest inspection. Keep the committed
  // activeSave intact: an unavailable read has no replacement state or revision.
  const inspected = current && state.saves.find((save) => save.id === current.id);
  return inspected?.compatibility?.errorCode === "STORE_BUSY" ? inspected : current;
}

function getActiveAdventure() {
  if (state.activeSave?.id && getAdventureCompatibility(state.activeSave).playerContinuable === true) return state.activeSave;
  if (state.activeSaveId) {
    const selected = state.saves.find((save) => save.id === state.activeSaveId);
    if (selected && getAdventureCompatibility(selected).playerContinuable === true) return selected;
  }
  return state.saves.find((save) => getAdventureCompatibility(save).playerContinuable === true) || null;
}

function isUnsupportedSave(save) {
  return getAdventureCompatibility(save).errorCode === "SAVE_FORMAT_UNSUPPORTED";
}

function getAdventureCompatibility(save = {}) {
  const compatibility = save?.compatibility && typeof save.compatibility === "object"
    ? save.compatibility
    : null;
  return compatibility || {
    status: "legacy_unspecified",
    playerContinuable: true,
    deleteAllowed: true,
    errorCode: null,
  };
}

async function refreshSaves() {
  const result = await window.greyCrow.listSaveSlots();
  if (result?.ok && Array.isArray(result.saves)) {
    state.saves = result.saves;
    state.pendingDeletes = Array.isArray(result.pendingDeletes) ? result.pendingDeletes : [];
  }
  if (result?.status) {
    applyStatus(result.status);
  }
}

function applySettings(settings = {}) {
  const previousTtsRuntime = getTtsRuntimeStateKey();
  const api = settings.api || {};
  const narration = settings.narration || {};
  const context = settings.agent?.context || {};
  const display = settings.ui || {};
  const chapterLog = settings.save?.chapterLog || {};
  const audio = settings.audio || {};
  const tts = audio.tts || {};
  const developer = settings.developer || {};
  const localization = settings.localization || {};
  state.preferredLocale = localization.preferredLocale || null;
  state.provider = api.provider || state.provider;
  state.model = api.model || state.model;
  state.connectionId = api.connectionId || null;
  state.customConnections = Array.isArray(api.customConnections) ? api.customConnections : [];
  state.narrationLengthPreset = narration.lengthPreset || state.narrationLengthPreset;
  state.narrationCustomTargetChars = Number.isFinite(narration.customTargetChars)
    ? narration.customTargetChars
    : null;
  state.configuredContextWindow = Number.isFinite(context.configuredContextWindow)
    ? context.configuredContextWindow
    : state.configuredContextWindow;
  state.autoCompactRatio = Number.isFinite(context.autoCompactRatio)
    ? context.autoCompactRatio
    : state.autoCompactRatio;
  state.narrationTextSize = normalizeUiTextSize(display.narrationTextSize || state.narrationTextSize);
  state.sidePanelTextSize = normalizeUiTextSize(display.sidePanelTextSize || state.sidePanelTextSize);
  // Keep this normalization local: renderer boundary fixtures lift applySettings
  // without the UI helper functions, and settings data must stay tolerant of
  // old or malformed preference files.
  state.storyNotebookTheme = ["light", "dark"].includes(display.storyNotebookTheme)
    ? display.storyNotebookTheme
    : (["light", "dark"].includes(state.storyNotebookTheme) ? state.storyNotebookTheme : "light");
  state.windowMode = normalizeWindowMode(display.windowMode || state.windowMode);
  state.gameUiLayout = normalizeGameUiLayout(display.gameUiLayout || state.gameUiLayout);
  state.autoSaveEnabled = chapterLog.onAutoSave === undefined ? state.autoSaveEnabled : Boolean(chapterLog.onAutoSave);
  state.manualChapterEnabled = chapterLog.onManualSave === undefined ? state.manualChapterEnabled : Boolean(chapterLog.onManualSave);
  state.compactionChapterEnabled = chapterLog.onCompaction === undefined ? state.compactionChapterEnabled : Boolean(chapterLog.onCompaction);
  state.autoSaveIntervalTurns = Number.isFinite(chapterLog.intervalTurns)
    ? chapterLog.intervalTurns
    : state.autoSaveIntervalTurns;
  state.gameVolume = Number.isFinite(audio.gameVolume) ? audio.gameVolume : state.gameVolume;
  const input = audio.input || {};
  state.speechInput = { enabled: input.enabled === true, language: ["zh", "en", "ja"].includes(input.language) ? input.language : "zh",
    deviceId: typeof input.deviceId === "string" && input.deviceId ? input.deviceId : "default" };
  speechInputController?.applySettings(state.speechInput);
  state.ttsEnabled = Boolean(tts.enabled);
  state.ttsAuto = Boolean(tts.autoPlay);
  state.ttsProvider = tts.provider || "disabled";
  state.ttsVoiceId = tts.voiceId || state.ttsVoiceId;
  state.ttsRate = tts.rate || "+0%";
  state.ttsPitch = tts.pitch || "+0Hz";
  state.ttsCacheUtteranceLimit = normalizeTtsCacheUtteranceLimit(tts.cacheUtteranceLimit);
  if (previousTtsRuntime !== getTtsRuntimeStateKey() && state.ttsPlaybackPhase !== "idle") {
    cancelTtsPlayback();
  }
  state.debugPanelEnabled = Boolean(developer.debugPanelEnabled);
  state.persistedSettingsSnapshot = serializeSettingsSnapshot(collectSettingsFromState());
  state.settingsDirty = false;
}

function getTtsRuntimeStateKey() {
  return JSON.stringify({
    enabled: state.ttsEnabled,
    provider: state.ttsProvider,
    voiceId: state.ttsVoiceId,
    rate: state.ttsRate,
    pitch: state.ttsPitch,
  });
}

function applyProviderSettings(api = {}) {
  state.provider = api.provider || state.provider;
  state.model = api.model || state.model;
  state.connectionId = api.connectionId || null;
  state.customConnections = Array.isArray(api.customConnections) ? api.customConnections : state.customConnections;
  let persisted = {};
  try {
    persisted = JSON.parse(state.persistedSettingsSnapshot || "{}") || {};
  } catch (_error) {
    persisted = {};
  }
  state.persistedSettingsSnapshot = serializeSettingsSnapshot({
    ...persisted,
    api: {
      provider: state.provider,
      model: state.model,
      connectionId: state.connectionId,
      customConnections: state.customConnections,
    },
  });
  state.settingsDirty = serializeSettingsSnapshot(collectSettingsFromState()) !== state.persistedSettingsSnapshot;
}

function renderShellState() {
  syncUiLocale();
  renderGameUiLayout();
  const currentAdventure = getCurrentAdventure();
  const activeAdventure = getActiveAdventure();
  const currentCompatibility = getAdventureCompatibility(currentAdventure);
  const currentSaveBusy = currentCompatibility.errorCode === "STORE_BUSY";
  const isClosedArchive = currentCompatibility.status === "closed";
  const unsupportedSave = isUnsupportedSave(currentAdventure);
  renderProviderOptions();
  renderTtsProviderOptions();
  ui.providerPresetSelect.value = getConnectionDraft().provider;
  renderCustomConnectionSettings({ populateFields: true });
  renderModelOptions();
  renderAgentContextSettings();
  ui.runtimeStatus.textContent = state.keyVerified
    ? `MODEL READY / ${state.model}`
    : "MODEL NOT CONFIGURED";
  ui.gameStatus.textContent = state.keyVerified
    ? `Provider: ${state.provider} / ${state.model}`
    : t("game.offline");
  ui.modelStatusText.textContent = formatModelStatusText();
  renderStoryNotebookMetadata();
  ui.menuMessage.textContent = formatMenuMessage(currentAdventure);
  renderSettingsStatus();
  renderSettingsPersistenceWarning();
  renderCredentialSettings();
  const newGameNeedsProvider = !state.keyVerified && !activeAdventure;
  ui.newGameButton.classList.toggle("locked", newGameNeedsProvider);
  ui.newGameButton.title = currentSaveBusy ? t("save.busy.notice") : activeAdventure
    ? t("menu.newGame.title.deleteFirst")
    : (state.keyVerified ? (isClosedArchive ? t("menu.newGame.title.archiveKept") : "") : t("menu.connectionRequired"));
  ui.continueGameButton.disabled = !currentAdventure;
  ui.continueGameButton.textContent = unsupportedSave ? t("save.unsupported.title") : isClosedArchive ? t("menu.viewStory") : t("menu.continue");
  ui.continueGameButton.classList.toggle(
    "locked",
    !state.keyVerified && Boolean(currentAdventure) && !currentSaveBusy && !isClosedArchive && !unsupportedSave && currentCompatibility.status !== "incompatible_v1"
  );
  ui.continueGameButton.title = currentAdventure
    ? (currentSaveBusy ? t("save.busy.notice") : unsupportedSave ? t("save.unsupported.notice") : currentCompatibility.status === "incompatible_v1"
      ? t("menu.continue.title.legacy")
      : (isClosedArchive
        ? t("menu.continue.title.archive")
        : (state.keyVerified ? "" : t("menu.connectionRequired"))))
    : t("menu.continue.title.missing");
  renderSaveList();
  renderNarrationSettings();
  renderUiDisplaySettings();
  renderSaveSettings();
  renderAudioSettings();
  renderDeveloperSettings();
  if (state.contentLibrary) renderContentLibrary();
  renderMaintenanceState();
  renderTurnInputState();
  renderContextUsage();
  renderOperationStatus();
  renderLoadedSkillSlots();
}

function formatModelStatusText() {
  if (!state.keyVerified) {
    return t("game.offline");
  }
  const provider = state.provider === "deepseek" ? "DeepSeek" : state.provider;
  return `${provider} / ${state.model}`;
}

function formatMenuMessage(currentAdventure = getCurrentAdventure()) {
  const compatibility = getAdventureCompatibility(currentAdventure);
  if (compatibility.errorCode === "STORE_BUSY") return t("save.busy.notice");
  if (isUnsupportedSave(currentAdventure)) return t("save.unsupported.notice");
  if (currentAdventure && compatibility.status === "closed") {
    return t("menu.message.closed");
  }
  if (!state.keyVerified) {
    return t("menu.message.needsProvider");
  }
  if (!currentAdventure) {
    return t("menu.message.readyForNew");
  }

  if (compatibility.playerContinuable === false) {
    return t("menu.message.incomplete");
  }
  return t("menu.message.continue");
}

function getConnectionDraft() {
  return state.connectionDraft || { provider: state.provider, model: state.model, connectionId: state.connectionId };
}

function readCustomConnectionDraft() {
  return { ...(ui.customConnectionSelect.value ? { id: ui.customConnectionSelect.value } : {}),
    name: ui.customConnectionNameInput.value.trim(), baseUrl: ui.customBaseUrlInput.value.trim(),
    modelId: ui.customModelIdInput.value.trim() };
}

function setConnectionStatus(message) {
  const node = ui.connectionStatus || ui.settingsStatus;
  node.textContent = message;
}

function renderSimpleSettingsVisibility() {
  const reading = document.querySelector("#ttsReadingOptions");
  const speech = document.querySelector("#speechInputOptions");
  if (reading) reading.hidden = !state.ttsEnabled;
  if (speech) speech.hidden = !state.speechInput?.enabled;
  const pitch = document.querySelector("#ttsPitchSettingRow");
  if (pitch) pitch.hidden = !state.ttsEnabled || getCurrentTtsProviderConfig()?.supportsPitch === false;
}

function getTtsReadingMode() {
  if (!state.ttsEnabled || state.ttsProvider === "disabled") return "off";
  return state.ttsAuto ? "auto" : "manual";
}

function applyTtsReadingMode(mode) {
  const nextMode = ["off", "manual", "auto"].includes(mode) ? mode : "off";
  if (nextMode === "off") {
    state.ttsEnabled = false;
    cancelTtsPlayback();
    return;
  }
  state.ttsEnabled = true;
  state.ttsAuto = nextMode === "auto";
  if (state.ttsProvider === "disabled") {
    state.ttsProvider = getDefaultEnabledTtsProvider();
    ui.ttsProviderSelect.value = state.ttsProvider;
  }
}

function renderProviderOptions() {
  const catalog = state.settingsCatalog;
  const providers = Array.isArray(catalog?.api?.providers)
    ? catalog.api.providers.filter((provider) => provider.enabled !== false)
    : [];
  if (!providers.length) {
    return;
  }
  ui.providerPresetSelect.value = getConnectionDraft().provider;
  replaceSelectOptions(ui.providerPresetSelect, providers.map((provider) => ({
    ...provider,
    label: localizeProviderLabel(provider),
  })), getConnectionDraft().provider);
  renderModelOptions();
}

function localizeProviderLabel(provider = {}) {
  const keys = {
    deepseek: "settings.model.provider.deepseek",
    "openai-compatible": "settings.model.provider.openaiCompatible",
  };
  const key = keys[provider.id];
  return key ? t(key) : String(provider.id || provider.label || "");
}

function localizeModelLabel(model = {}, { custom = false } = {}) {
  const modelId = String(model.id || model.label || "");
  if (custom) return t("settings.model.model.custom", { model: modelId });
  if (model.aliasOf) return t("settings.model.model.alias", { model: modelId });
  if (model.tier === "default") return t("settings.model.model.default", { model: modelId });
  if (model.tier === "advanced") {
    return t("settings.model.model.advanced", { model: modelId });
  }
  return modelId;
}

function renderModelOptions() {
  const catalog = state.settingsCatalog;
  const providers = Array.isArray(catalog?.api?.providers)
    ? catalog.api.providers.filter((candidate) => candidate.enabled !== false)
    : [];
  const provider = providers.find((candidate) => candidate.id === ui.providerPresetSelect.value) ||
    providers.find((candidate) => candidate.id === state.provider);
  const draft = getConnectionDraft();
  const activeConnection = draft.custom || getSelectedCustomConnection();
  const models = provider?.id === "openai-compatible" && activeConnection
    ? [{ id: activeConnection.modelId, label: localizeModelLabel({ id: activeConnection.modelId }, { custom: true }), enabled: true }]
    : (Array.isArray(provider?.models) && provider.models.length
      ? provider.models.filter((model) => model.enabled !== false).map((model) => ({
          ...model,
          label: localizeModelLabel(model),
        }))
      : [{
          id: "",
          label: t(draft.provider === "openai-compatible"
            ? "settings.model.model.saveConnectionFirst"
            : "settings.model.model.unavailable"),
          enabled: false,
        }]);
  // State includes restored settings and explicit dropdown changes; an older
  // rendered option must not replace the saved selection during startup.
  ui.modelPresetSelect.value = draft.model || "";
  replaceSelectOptions(ui.modelPresetSelect, models, draft.model);
  if (state.connectionDraft) state.connectionDraft.model = ui.modelPresetSelect.value;
}

function getSelectedCustomConnection() {
  const id = getConnectionDraft().connectionId;
  return state.customConnections.find((connection) => connection.id === id) || null;
}

function renderCustomConnectionSettings({ populateFields = false } = {}) {
  const draft = getConnectionDraft();
  const isCustom = draft.provider === "openai-compatible";
  ui.customConnectionPanel.hidden = !isCustom;
  if (!isCustom) {
    return;
  }

  const options = [
    {
      id: "",
      label: t(state.customConnections.length ? "settings.connection.new" : "settings.connection.newFirst"),
      enabled: true,
    },
    ...state.customConnections.map((connection) => ({
      id: connection.id,
      label: `${connection.name} (${t(connection.verifiedAt
        ? "settings.connection.testedSuffix"
        : "settings.connection.pendingSuffix")})`,
      enabled: true,
    })),
  ];
  ui.customConnectionSelect.value = draft.connectionId || "";
  replaceSelectOptions(ui.customConnectionSelect, options, draft.connectionId || "");
  const connection = draft.custom || getSelectedCustomConnection();
  if (populateFields) {
    ui.customConnectionNameInput.value = connection?.name || "";
    ui.customBaseUrlInput.value = connection?.baseUrl || "";
    ui.customModelIdInput.value = connection?.modelId || "";
  }
  ui.deleteCustomConnectionButton.disabled = state.busy || !connection;
  ui.customConnectionStatus.textContent = connection?.verifiedAt
    ? t("settings.connection.verifiedStatus", { date: formatSaveDate(connection.verifiedAt) })
    : t("settings.connection.unverifiedStatus");
}

function renderCredentialSettings() {
  const isCustom = getConnectionDraft().provider === "openai-compatible";
  const connection = isCustom ? getSelectedCustomConnection() : null;
  ui.apiKeyLabel.textContent = t(isCustom ? "settings.credentials.customKey" : "settings.credentials.deepseekKey");
  ui.apiKeyInput.placeholder = isCustom ? t("settings.credentials.customPlaceholder") : "sk-...";
  ui.providerRiskNote.textContent = isCustom
    ? t("settings.credentials.riskCustom")
    : t("settings.credentials.riskDeepseek");
  const draft = getConnectionDraft();
  const sameConnection = draft.provider === state.provider && draft.model === state.model
    && (draft.connectionId || null) === (state.connectionId || null) && !draft.custom;
  ui.credentialStatus.textContent = sameConnection ? formatCredentialStatus({ connection })
    : t("settings.connection.candidateNote");
  ui.modelPresetSelect.hidden = isCustom;
  const modelLabel = document.querySelector('label[for="modelPresetSelect"]');
  if (modelLabel) modelLabel.hidden = isCustom;
  ui.clearKeyButton.disabled = state.busy || !state.credential?.hasVerifiedCredential;
  if (ui.clearAllKeysButton) ui.clearAllKeysButton.disabled = state.busy;
  ui.testKeyButton.disabled = state.busy || state.settingsSaving;
  if (ui.currentConnectionSummary) ui.currentConnectionSummary.textContent = state.keyVerified
    ? t("settings.connection.current", { name: formatModelStatusText() }) : t("settings.connection.currentNone");
}

function renderModelHelp() {
  const help = state.settingsCatalog?.modelHelp;
  if (!help) {
    return;
  }
  ui.modelHelpTitle.textContent = t("settings.section.modelHelp");
  ui.modelHelpBody.textContent = t("settings.modelHelp.body");
  ui.modelHelpNotice.textContent = t("settings.modelHelp.notice");
  ui.modelHelpLinks.replaceChildren();
  for (const entry of Array.isArray(help.entries) ? help.entries : []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button compact";
    button.dataset.modelHelpId = entry.id;
    button.textContent = entry.label;
    button.title = t("settings.modelHelp.openOfficial", { label: entry.label });
    ui.modelHelpLinks.appendChild(button);
  }
}

function renderTtsProviderOptions() {
  const providers = state.settingsCatalog?.audio?.ttsProviders;
  if (!Array.isArray(providers) || !providers.length) {
    return;
  }
  replaceSelectOptions(ui.ttsProviderSelect, providers.map((provider) => ({
    ...provider,
    label: localizeTtsProviderLabel(provider),
  })), state.ttsProvider);
  // Catalog rendering may have populated the hidden settings form before the
  // saved audio settings arrived. That old selection must not disable playback.
  if (providers.some((provider) => provider.id === state.ttsProvider)) {
    ui.ttsProviderSelect.value = state.ttsProvider;
  }
  state.ttsProvider = ui.ttsProviderSelect.value;
  renderTtsVoiceOptions();
}

function renderTtsVoiceOptions() {
  const provider = getCurrentTtsProviderConfig();
  const voices = Array.isArray(provider?.voices) && provider.voices.length
    ? provider.voices.map((voice) => ({ ...voice, label: localizeTtsVoiceLabel(voice) }))
    : [{ id: "", label: t("settings.audio.voice.unavailable"), enabled: false }];
  replaceSelectOptions(ui.ttsVoiceSelect, voices, state.ttsVoiceId);
  if (voices.some((voice) => voice.id === state.ttsVoiceId && voice.enabled !== false)) {
    ui.ttsVoiceSelect.value = state.ttsVoiceId;
  }
  // Rendering an unavailable/off provider must not erase the saved voice.
  ui.ttsVoiceSelect.disabled = !canUseTtsProvider(provider);
}

function localizeTtsProviderLabel(provider = {}) {
  const keys = {
    disabled: "settings.audio.provider.disabled",
    "kokoro-original-local": "settings.audio.provider.kokoro",
    minimax: "settings.audio.provider.minimax",
  };
  const key = keys[provider.id];
  return key ? t(key) : String(provider.id || provider.label || "");
}

function localizeTtsVoiceLabel(voice = {}) {
  const keys = {
    zm_010: "settings.audio.voice.zm010",
    zm_009: "settings.audio.voice.zm009",
    zf_001: "settings.audio.voice.zf001",
    zf_006: "settings.audio.voice.zf006",
  };
  const key = keys[voice.id];
  return key ? t(key) : String(voice.id || voice.label || "");
}

function renderNarrationSettings() {
  const presets = getNarrationPresetOptions();
  replaceSelectOptions(ui.narrationLengthPresetSelect, presets, state.narrationLengthPreset);
  const supportedPresetIds = presets.filter((preset) => preset.enabled !== false).map((preset) => preset.id);
  if (supportedPresetIds.includes(state.narrationLengthPreset)) {
    ui.narrationLengthPresetSelect.value = state.narrationLengthPreset;
  } else {
    state.narrationLengthPreset = ui.narrationLengthPresetSelect.value || "standard";
  }

  const range = getNarrationCustomRange();
  ui.narrationCustomTargetInput.min = String(range.min);
  ui.narrationCustomTargetInput.max = String(range.max);
  ui.narrationCustomTargetInput.step = "10";
  const customTarget = normalizeNarrationCustomTarget(state.narrationCustomTargetChars, range);
  state.narrationCustomTargetChars = customTarget;
  ui.narrationCustomTargetInput.value = String(customTarget);
  ui.narrationCustomTargetInput.disabled = state.narrationLengthPreset !== "custom";
  renderNarrationStatus();
}

function renderAgentContextSettings() {
  const catalog = state.settingsCatalog?.agent?.context || {};
  const windowPresets = Array.isArray(catalog.contextWindowPresets)
    ? catalog.contextWindowPresets
    : [128000, 256000, 512000];
  const modelLimit = getCurrentModelContextLimit();
  const windowOptions = windowPresets
    .filter((value) => Number.isFinite(value) && value <= modelLimit)
    .map((value) => ({
      id: String(value),
      label: value === modelLimit ? t("settings.context.modelLimitValue", { value: formatTokenCount(value) }) : formatTokenCount(value),
      enabled: true,
    }));
  windowOptions.push({ id: "custom", label: t("common.custom"), enabled: true });
  const selectedWindow = windowOptions.some((option) => option.id === String(state.configuredContextWindow))
    ? String(state.configuredContextWindow) : "custom";
  replaceSelectOptions(ui.contextWindowPresetSelect, windowOptions, selectedWindow);
  ui.contextWindowPresetSelect.value = selectedWindow;
  ui.contextWindowCustomInput.min = String(catalog.customContextWindow?.min || 128000);
  ui.contextWindowCustomInput.max = String(Math.min(catalog.customContextWindow?.max || modelLimit, modelLimit));
  ui.contextWindowCustomInput.step = String(catalog.customContextWindow?.step || 1000);
  ui.contextWindowCustomInput.value = String(state.configuredContextWindow);
  ui.contextWindowCustomInput.disabled = ui.contextWindowPresetSelect.value !== "custom";

  const ratios = Array.isArray(catalog.autoCompactRatioPresets) ? catalog.autoCompactRatioPresets : [0.65, 0.75, 0.85];
  const ratioOptions = ratios.map((value) => ({ id: String(value), label: `${Math.round(value * 100)}%`, enabled: true }));
  ratioOptions.push({ id: "custom", label: t("common.custom"), enabled: true });
  const ratioPreset = ratios.find((value) => Math.abs(value - state.autoCompactRatio) < 0.0001);
  const selectedRatio = ratioPreset === undefined ? "custom" : String(ratioPreset);
  replaceSelectOptions(ui.autoCompactRatioSelect, ratioOptions, selectedRatio);
  ui.autoCompactRatioSelect.value = selectedRatio;
  ui.autoCompactRatioCustomInput.min = String(Math.round((catalog.customAutoCompactRatio?.min || 0.5) * 100));
  ui.autoCompactRatioCustomInput.max = String(Math.round((catalog.customAutoCompactRatio?.max || 0.85) * 100));
  ui.autoCompactRatioCustomInput.value = String(Math.round(state.autoCompactRatio * 100));
  ui.autoCompactRatioCustomInput.disabled = ui.autoCompactRatioSelect.value !== "custom";
  renderContextPolicyStatus();
}

function getSupportedLocaleOptions() {
  const localeOptions = state.settingsCatalog?.localization?.options;
  return Array.isArray(localeOptions) && localeOptions.length
    ? localeOptions.map((option) => ({ id: option.id, label: option.nativeLabel || option.id, enabled: true }))
    : [
        { id: "zh-CN", label: "简体中文", enabled: true },
        { id: "en-US", label: "English", enabled: true },
        { id: "ja-JP", label: "日本語", enabled: true },
      ];
}

function getLocaleNativeLabel(locale, options = getSupportedLocaleOptions()) {
  return options.find((option) => option.id === locale)?.label || locale;
}

function setMenuLanguagePickerOpen(open) {
  const canOpen = Boolean(open) && !ui.menuLanguageToggle.disabled;
  ui.menuLanguageOptions.hidden = !canOpen;
  ui.menuLanguageToggle.setAttribute("aria-expanded", canOpen ? "true" : "false");
}

function renderUiDisplaySettings() {
  const supportedLocaleOptions = getSupportedLocaleOptions();
  const selectedLocale = state.preferredLocale || supportedLocaleOptions[0].id;
  renderLocalizedBrandLogo();
  replaceSelectOptions(ui.gameLanguageSelect, supportedLocaleOptions, selectedLocale);
  ui.gameLanguageSelect.value = selectedLocale;
  const localeLocked = state.gameStarted || Boolean(state.adventureLocale);
  ui.gameLanguageSelect.disabled = localeLocked || state.localePreferenceBusy;
  ui.menuLanguageButtons.forEach((button) => {
    const selected = button.dataset.menuLocale === selectedLocale;
    const nativeLabel = getLocaleNativeLabel(button.dataset.menuLocale, supportedLocaleOptions);
    button.setAttribute("aria-label", nativeLabel);
    button.removeAttribute("title");
    button.setAttribute("aria-checked", selected ? "true" : "false");
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.classList.toggle("is-selected", selected);
    button.disabled = localeLocked || state.localePreferenceBusy;
  });
  const selectedLocaleLabel = getLocaleNativeLabel(selectedLocale, supportedLocaleOptions);
  const selectedMenuButton = ui.menuLanguageButtons.find((button) => button.dataset.menuLocale === selectedLocale);
  const selectedFlag = selectedMenuButton?.querySelector(".menu-language-flag");
  if (selectedFlag) ui.menuLanguageToggle.replaceChildren(selectedFlag.cloneNode(true));
  ui.menuLanguageToggle.dataset.currentLocale = selectedLocale;
  ui.menuLanguageToggle.setAttribute("aria-label", `${t("menu.language.title")}: ${selectedLocaleLabel}`);
  ui.menuLanguageToggle.disabled = localeLocked || state.localePreferenceBusy;
  if (ui.menuLanguageToggle.disabled) setMenuLanguagePickerOpen(false);
  if (state.localePreferenceBusy) {
    ui.menuLanguageStatus.textContent = t("menu.language.saving");
  } else if (state.localePreferenceNotice) {
    ui.menuLanguageStatus.textContent = state.localePreferenceNotice;
  } else if (localeLocked) {
    ui.menuLanguageStatus.textContent = t("menu.language.locked", { locale: state.adventureLocale || state.effectiveLocale });
  } else {
    ui.menuLanguageStatus.textContent = t("menu.language.default", { locale: selectedLocaleLabel });
  }
  ui.gameLanguageStatus.textContent = ui.gameLanguageSelect.disabled
    ? t("settings.language.locked", { locale: state.adventureLocale || state.effectiveLocale })
    : t("settings.language.description");
  const presets = state.settingsCatalog?.ui?.textSizePresets;
  const options = Array.isArray(presets) && presets.length
    ? presets.map((preset) => ({ id: preset.id, label: t(`settings.size.${preset.id}`), enabled: true }))
    : [
        { id: "small", label: t("settings.size.small"), enabled: true },
        { id: "medium", label: t("settings.size.medium"), enabled: true },
        { id: "large", label: t("settings.size.large"), enabled: true },
      ];
  state.narrationTextSize = normalizeUiTextSize(state.narrationTextSize);
  state.sidePanelTextSize = normalizeUiTextSize(state.sidePanelTextSize);
  replaceSelectOptions(ui.narrationTextSizeSelect, options, state.narrationTextSize);
  replaceSelectOptions(ui.sidePanelTextSizeSelect, options, state.sidePanelTextSize);
  ui.narrationTextSizeSelect.value = state.narrationTextSize;
  ui.sidePanelTextSizeSelect.value = state.sidePanelTextSize;
  const notebookThemes = Array.isArray(state.settingsCatalog?.ui?.storyNotebookThemes)
    ? state.settingsCatalog.ui.storyNotebookThemes
    : ["light", "dark"];
  replaceSelectOptions(ui.storyNotebookThemeSelect, notebookThemes.map((id) => ({
    id,
    label: t(`settings.notebookTheme.${id}`),
    enabled: true,
  })), state.storyNotebookTheme);
  state.storyNotebookTheme = normalizeStoryNotebookTheme(state.storyNotebookTheme);
  ui.storyNotebookThemeSelect.value = state.storyNotebookTheme;
  const catalogWindowModes = state.settingsCatalog?.ui?.windowModes;
  const windowModes = Array.isArray(catalogWindowModes) && catalogWindowModes.length
    ? catalogWindowModes
    : WINDOW_MODE_IDS.map((id) => ({ id, enabled: true }));
  const windowModeOptions = windowModes.map((mode) => ({
    id: mode.id,
    label: t(`settings.windowMode.${mode.id}`),
    enabled: mode.enabled !== false,
    disabledReason: mode.enabled === false ? t("settings.windowMode.unavailable") : "",
  }));
  state.windowMode = normalizeWindowMode(state.windowMode);
  replaceSelectOptions(ui.windowModeSelect, windowModeOptions, state.windowMode);
  const selectedWindowModeEnabled = windowModeOptions.some(
    (mode) => mode.id === state.windowMode && mode.enabled !== false
  );
  if (selectedWindowModeEnabled) {
    ui.windowModeSelect.value = state.windowMode;
  } else {
    state.windowMode = normalizeWindowMode(ui.windowModeSelect.value);
  }
  ui.windowModeStatus.textContent = t("settings.display.windowModeActive", {
    mode: t(`settings.windowMode.${state.windowMode}`),
  });
  document.documentElement.dataset.narrationTextSize = state.narrationTextSize;
  document.documentElement.dataset.sidePanelTextSize = state.sidePanelTextSize;
}

function normalizeUiTextSize(value) {
  return ["small", "medium", "large"].includes(value) ? value : "medium";
}

function normalizeWindowMode(value) {
  return WINDOW_MODE_IDS.includes(value) ? value : "standard";
}

function renderSaveSettings() {
  const catalog = state.settingsCatalog?.save?.chapterLog || {};
  const presets = Array.isArray(catalog.intervalPresets) ? catalog.intervalPresets : [40, 60, 80, 100];
  const options = presets.map((value) => ({ id: String(value), label: t("settings.autoSave.intervalOption", { turns: value }), enabled: true }));
  options.push({ id: "custom", label: t("common.custom"), enabled: true });
  const isPreset = presets.includes(state.autoSaveIntervalTurns);
  replaceSelectOptions(ui.autoSaveIntervalSelect, options, isPreset ? String(state.autoSaveIntervalTurns) : "custom");
  ui.autoSaveIntervalSelect.value = isPreset ? String(state.autoSaveIntervalTurns) : "custom";
  ui.autoSaveEnabledSelect.value = String(state.autoSaveEnabled);
  ui.manualChapterSelect.value = String(state.manualChapterEnabled);
  ui.compactionChapterSelect.value = String(state.compactionChapterEnabled);
  ui.autoSaveIntervalCustomInput.min = String(catalog.customInterval?.min || 20);
  ui.autoSaveIntervalCustomInput.max = String(catalog.customInterval?.max || 300);
  ui.autoSaveIntervalCustomInput.value = String(state.autoSaveIntervalTurns);
  ui.autoSaveIntervalSelect.disabled = !state.autoSaveEnabled;
  ui.autoSaveIntervalCustomInput.disabled = !state.autoSaveEnabled || ui.autoSaveIntervalSelect.value !== "custom";
  renderSaveSettingsStatus();
}

function renderSaveSettingsStatus() {
  if (!state.autoSaveEnabled) {
    ui.autoSaveStatus.textContent = t("settings.autoSave.statusOff");
    return;
  }
  const interval = collectAutoSaveSettingsFromUi().intervalTurns;
  ui.autoSaveStatus.textContent = t("settings.autoSave.statusOn", { turns: interval });
}

function collectAutoSaveSettingsFromUi() {
  const value = ui.autoSaveIntervalSelect.value === "custom"
    ? Number.parseInt(ui.autoSaveIntervalCustomInput.value, 10)
    : Number.parseInt(ui.autoSaveIntervalSelect.value, 10);
  const catalog = state.settingsCatalog?.save?.chapterLog?.customInterval || {};
  const min = Number.isFinite(catalog.min) ? catalog.min : 20;
  const max = Number.isFinite(catalog.max) ? catalog.max : 300;
  return {
    onAutoSave: ui.autoSaveEnabledSelect.value === "true",
    onManualSave: ui.manualChapterSelect.value === "true",
    onCompaction: ui.compactionChapterSelect.value === "true",
    intervalTurns: Math.min(max, Math.max(min, Number.isFinite(value) ? value : 60)),
  };
}

function renderContextPolicyStatus() {
  const settings = collectAgentContextSettingsFromUi();
  const autoLimit = Math.floor(settings.configuredContextWindow * settings.autoCompactRatio);
  ui.contextPolicyStatus.textContent = t(state.runtimeProtocol === "session-1"
    ? (state.sessionContextCompactionAvailable ? "settings.context.sessionReady" : "settings.context.sessionStatus") : "settings.context.status", {
    window: formatTokenCount(settings.configuredContextWindow),
    limit: formatTokenCount(autoLimit),
    ratio: Math.round(settings.autoCompactRatio * 100),
  });
}

function getCurrentModelContextLimit() {
  const providers = state.settingsCatalog?.api?.providers || [];
  const provider = providers.find((item) => item.id === state.provider);
  const model = provider?.models?.find((item) => item.id === state.model);
  return Number.isFinite(model?.contextLimit) ? model.contextLimit : 256000;
}

function collectAgentContextSettingsFromUi() {
  const windowValue = ui.contextWindowPresetSelect.value === "custom"
    ? Number.parseInt(ui.contextWindowCustomInput.value, 10)
    : Number.parseInt(ui.contextWindowPresetSelect.value, 10);
  const ratio = ui.autoCompactRatioSelect.value === "custom"
    ? Number.parseInt(ui.autoCompactRatioCustomInput.value, 10) / 100
    : Number(ui.autoCompactRatioSelect.value);
  return {
    configuredContextWindow: Number.isFinite(windowValue) ? windowValue : 256000,
    autoCompactRatio: Number.isFinite(ratio) ? ratio : 0.75,
  };
}

function renderNarrationStatus() {
  if (state.narrationLengthPreset === "adaptive") {
    ui.narrationLengthStatus.textContent = t("settings.narration.statusAdaptive");
    return;
  }
  const preset = getCurrentNarrationPreset();
  const range = getNarrationCustomRange();
  const customTarget = normalizeNarrationCustomTarget(state.narrationCustomTargetChars, range);
  if (state.narrationLengthPreset === "custom") {
    ui.narrationLengthStatus.textContent = t("settings.narration.statusCustom", { target: customTarget });
    return;
  }
  ui.narrationLengthStatus.textContent = t("settings.narration.statusPreset", {
    target: preset.targetChars || range.default,
    guide: preset.paragraphGuide || t("settings.narration.guide.custom"),
  });
}

function getNarrationPresetOptions() {
  const presets = state.settingsCatalog?.narration?.lengthPresets;
  if (Array.isArray(presets) && presets.length) {
    return presets.map((preset) => ({
      ...preset,
      label: preset.id === "custom" ? t("common.custom") : t(`settings.narration.${preset.id}`),
      paragraphGuide: t(`settings.narration.guide.${preset.id}`),
    }));
  }
  return [
    { id: "adaptive", label: t("settings.narration.adaptive"), targetChars: null, paragraphGuide: t("settings.narration.guide.adaptive"), enabled: true },
    { id: "short", label: t("settings.narration.short"), targetChars: 200, paragraphGuide: t("settings.narration.guide.short"), enabled: true },
    { id: "standard", label: t("settings.narration.standard"), targetChars: 300, paragraphGuide: t("settings.narration.guide.standard"), enabled: true },
    { id: "detailed", label: t("settings.narration.detailed"), targetChars: 400, paragraphGuide: t("settings.narration.guide.detailed"), enabled: true },
    { id: "custom", label: t("common.custom"), targetChars: 300, paragraphGuide: t("settings.narration.guide.custom"), enabled: true },
  ];
}

function getCurrentNarrationPreset() {
  const presets = getNarrationPresetOptions();
  return presets.find((preset) => preset.id === state.narrationLengthPreset) ||
    presets.find((preset) => preset.id === "standard") ||
    presets[0] ||
    {};
}

function getNarrationCustomRange() {
  const range = state.settingsCatalog?.narration?.customTargetChars || {};
  return {
    min: Number.isFinite(range.min) ? range.min : 120,
    max: Number.isFinite(range.max) ? range.max : 800,
    default: Number.isFinite(range.default) ? range.default : 300,
  };
}

function normalizeNarrationCustomTarget(value, range = getNarrationCustomRange()) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return range.default;
  }
  return Math.min(range.max, Math.max(range.min, parsed));
}

function replaceSelectOptions(select, options, selectedValue) {
  const previous = select.value || selectedValue;
  select.innerHTML = "";
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.id;
    node.textContent = option.label || option.id;
    node.disabled = option.enabled === false;
    if (option.disabledReason) {
      node.title = option.disabledReason;
    }
    select.appendChild(node);
  }
  const enabledValues = options.filter((option) => option.enabled !== false).map((option) => option.id);
  select.value = enabledValues.includes(previous) ? previous : enabledValues[0] || options[0]?.id || "";
}

function getCurrentTtsProviderConfig() {
  const providers = state.settingsCatalog?.audio?.ttsProviders;
  if (!Array.isArray(providers)) {
    return null;
  }
  return providers.find((provider) => provider.id === state.ttsProvider) ||
    providers.find((provider) => provider.id === ui.ttsProviderSelect.value) ||
    null;
}

function getDefaultEnabledTtsProvider() {
  const providers = state.settingsCatalog?.audio?.ttsProviders;
  if (!Array.isArray(providers)) {
    return "disabled";
  }
  const provider = providers.find((candidate) => candidate.id !== "disabled" && candidate.enabled !== false)
    || providers.find((candidate) => candidate.id !== "disabled");
  return provider?.id || "disabled";
}

function canUseTtsProvider(provider = getCurrentTtsProviderConfig()) {
  return Boolean(provider && provider.id !== "disabled" && provider.enabled !== false);
}

function renderSaveList() {
  ui.saveList.innerHTML = "";
  const saves = Array.isArray(state.saves) ? state.saves : [];
  const pendingDeletes = Array.isArray(state.pendingDeletes) ? state.pendingDeletes : [];
  for (const pending of pendingDeletes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "save-slot pending-delete";
    button.dataset.deletionId = pending.deletionId;
    button.disabled = state.busy;
    const title = document.createElement("span");
    title.className = "save-title";
    title.textContent = t("save.deletePending.title");
    const description = document.createElement("span");
    description.className = "save-meta";
    description.textContent = t("save.deletePending.notice");
    button.append(title, description);
    button.addEventListener("click", () => openPendingDelete(pending.deletionId));
    ui.saveList.appendChild(button);
  }
  if (!saves.length && !pendingDeletes.length) {
    const empty = document.createElement("p");
    empty.className = "save-empty";
    empty.textContent = t("save.empty");
    ui.saveList.appendChild(empty);
    return;
  }

  for (const save of saves) {
    const button = document.createElement("button");
    button.className = "save-slot";
    button.type = "button";
    button.dataset.saveId = save.id;
    const compatibility = getAdventureCompatibility(save);
    const saveBusy = compatibility.errorCode === "STORE_BUSY";
    const isClosedArchive = compatibility.status === "closed";
    const unsupportedSave = isUnsupportedSave(save);
    const isActive = compatibility.playerContinuable === true;
    button.classList.toggle("current-adventure", isActive);
    button.classList.toggle("story-archive-slot", isClosedArchive);
    button.classList.toggle("locked", !state.keyVerified && !saveBusy && !isClosedArchive && !unsupportedSave && compatibility.status !== "incompatible_v1");
    button.title = saveBusy ? t("save.busy.notice") : unsupportedSave ? t("save.unsupported.title") : compatibility.status === "incompatible_v1"
      ? t("save.title.legacy")
      : (isClosedArchive ? t("save.title.archive") : (state.keyVerified ? t("save.title.continue") : t("menu.connectionRequired")));
    const title = document.createElement("span");
    title.className = "save-title";
    const role = saveBusy ? t("save.busy.title") : unsupportedSave ? t("save.unsupported.title") : compatibility.status === "incompatible_v1" ? t("save.role.legacy") : (isClosedArchive ? t("save.role.archive") : t("save.role.active"));
    title.textContent = unsupportedSave ? role : `${role} · ${save.title || t("save.untitled")}`;
    const meta = document.createElement("span");
    meta.className = "save-meta";
    meta.textContent = saveBusy ? t("save.busy.notice") : unsupportedSave ? t("save.unsupported.notice")
      : t("save.meta", { location: formatLocationDisplay(save.state_hint?.scene), turn: resolveSaveDisplayTurn(save), date: formatSaveDate(save.updatedAt) });
    button.append(title, meta);
    button.addEventListener("click", () => isClosedArchive ? openStoryArchive(save.id) : continueGame(save.id));
    ui.saveList.appendChild(button);
  }
}

function renderAudioSettings() {
  speechInputController?.applySettings(state.speechInput);
  renderTtsVoiceOptions();
  const volume = Number.isFinite(state.gameVolume) ? state.gameVolume : 80;
  ui.gameVolumeInput.value = String(volume);
  ui.gameVolumeValue.textContent = `${volume}%`;
  ui.ttsReadingModeSelect.value = getTtsReadingMode();
  ui.ttsProviderSelect.value = state.ttsProvider || "disabled";
  const customRate = document.querySelector("#ttsRateCustomOption");
  if (customRate) {
    const value = state.ttsRate || "+0%";
    const isPreset = Array.from(ui.ttsRateInput.options).some(option => option !== customRate && option.value === value);
    customRate.hidden = isPreset;
    customRate.value = isPreset ? "" : value;
    customRate.textContent = isPreset ? "" : t("settings.audio.rate.custom", { value });
  }
  ui.ttsRateInput.value = state.ttsRate || "+0%";
  ui.ttsPitchInput.value = state.ttsPitch || "+0Hz";
  ui.ttsCacheLimitSelect.value = String(state.ttsCacheUtteranceLimit);
  const provider = getCurrentTtsProviderConfig();
  const active = canUseTtsProvider(provider) && state.ttsEnabled;
  ui.ttsTestButton.disabled = state.busy || !active;
  ui.ttsRateInput.disabled = !active;
  ui.ttsPitchInput.disabled = !active || provider?.supportsPitch === false;
  ui.clearTtsCacheButton.disabled = state.busy;
  renderTtsCacheStatus();
  renderSimpleSettingsVisibility();
  if (state.ttsEnabled && provider?.id !== "disabled" && provider?.enabled === false) {
    ui.ttsStatus.textContent = t("settings.audio.status.resourceMissing");
  } else if (!active) {
    ui.ttsStatus.textContent = t("settings.audio.status.off");
  } else if (provider?.online) {
    ui.ttsStatus.textContent = t("settings.audio.status.online", { provider: localizeTtsProviderLabel(provider) });
  } else if (provider?.id === "kokoro-original-local") {
    ui.ttsStatus.textContent = t("settings.audio.status.kokoroLocal");
  } else {
    ui.ttsStatus.textContent = t("settings.audio.status.local", { provider: localizeTtsProviderLabel(provider) });
  }
}

function normalizeTtsCacheUtteranceLimit(value) {
  const parsed = Number(value);
  const presets = state.settingsCatalog?.audio?.ttsDefaults?.cacheUtterancePresets;
  const supported = Array.isArray(presets) && presets.length ? presets : [10, 20, 40];
  const fallback = Number(state.settingsCatalog?.audio?.ttsDefaults?.cacheUtteranceLimit) || 20;
  return supported.includes(parsed) ? parsed : fallback;
}

function renderTtsCacheStatus(message = "") {
  if (message) {
    ui.ttsCacheStatus.textContent = message;
    return;
  }
  const usage = state.ttsCacheUsage;
  const selectedLimit = normalizeTtsCacheUtteranceLimit(state.ttsCacheUtteranceLimit);
  const byteLimit = Number(usage?.byteLimit) || Number(state.settingsCatalog?.audio?.ttsDefaults?.cacheMaxBytes) || 500 * 1024 * 1024;
  if (!usage) {
    ui.ttsCacheStatus.textContent = t("settings.audio.cache.empty", {
      limit: selectedLimit,
      size: formatTtsCacheBytes(byteLimit),
    });
    return;
  }
  ui.ttsCacheStatus.textContent = t("settings.audio.cache.usage", {
    count: usage.utteranceCount || 0,
    used: formatTtsCacheBytes(usage.bytes || 0),
    limit: selectedLimit,
    size: formatTtsCacheBytes(byteLimit),
  });
}

function formatTtsCacheBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KiB`;
  }
  return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MiB`;
}

async function refreshTtsCacheStatus({ silent = false } = {}) {
  try {
    const result = await window.greyCrow.getTtsCacheStatus();
    if (!result?.ok) {
      if (!silent) {
        renderTtsCacheStatus(formatError(result?.error, t("settings.audio.cache.readFailed")));
      }
      return;
    }
    state.ttsCacheUsage = result.result || null;
    renderTtsCacheStatus();
  } catch (error) {
    if (!silent) {
      renderTtsCacheStatus(getUiLocale() === "zh-CN" && error?.message
        ? error.message
        : t("settings.audio.cache.readFailed"));
    }
  }
}

async function clearTtsCache() {
  if (state.busy) {
    return;
  }
  cancelTtsPlayback();
  ui.clearTtsCacheButton.disabled = true;
  renderTtsCacheStatus(t("settings.audio.cache.clearing"));
  try {
    const result = await window.greyCrow.clearTtsCache();
    if (!result?.ok) {
      renderTtsCacheStatus(formatError(result?.error, t("settings.audio.cache.clearFailed")));
      return;
    }
    state.ttsCacheUsage = result.result || null;
    renderTtsCacheStatus(t("settings.audio.cache.cleared"));
  } catch (error) {
    renderTtsCacheStatus(getUiLocale() === "zh-CN" && error?.message
      ? error.message
      : t("settings.audio.cache.clearFailed"));
  } finally {
    ui.clearTtsCacheButton.disabled = state.busy;
  }
}

function renderDeveloperSettings() {
  ui.debugPanelEnabledSelect.value = String(Boolean(state.debugPanelEnabled));
  ui.debugPanelButton.classList.toggle("hidden", !state.debugPanelEnabled);
  ui.debugPanelButton.disabled = state.busy || !state.gameStarted || !state.activeSaveId;
  ui.refreshAdvancedMetricsButton.disabled = state.busy || !state.debugPanelEnabled;
  renderAdvancedMetrics();
}

function formatCredentialStatus({ connection = null } = {}) {
  const credential = state.credential || {};
  const runtime = state.settingsCatalog?.security || {};
  if (connection?.verifiedAt && !credential.hasVerifiedCredential) {
    return t("settings.credentials.status.connectionVerified");
  }
  if (credential.hasVerifiedCredential && credential.credentialPersistence === "secure-storage") {
    return t("settings.credentials.status.secure");
  }
  if (credential.hasVerifiedCredential) {
    return t("settings.credentials.status.sessionOnly");
  }
  if (credential.secureStorageAvailable || runtime.secureStorage?.enabled) {
    return t("settings.credentials.status.secureAvailable");
  }
  return t("settings.credentials.status.secureUnavailable");
}

function renderSettingsStatus(message = "") {
  ui.saveSettingsButton.disabled = state.settingsSaving || !state.settingsDirty;
  renderSessionCompactionControls();
  if (message) {
    ui.settingsStatus.textContent = message;
    return;
  }
  if (state.settingsDirty) {
    ui.settingsStatus.textContent = t("settings.status.dirty");
    return;
  }
  ui.settingsStatus.textContent = t(state.settingsSaving ? "settings.status.autoSaving" : "settings.status.autoSaved");
}

function markSettingsDirty(target) {
  if (!target?.id || !PERSISTED_SETTINGS_CONTROL_IDS.has(target.id)) {
    return;
  }
  const currentSnapshot = serializeSettingsSnapshot(collectSettingsFromUi());
  state.settingsDirty = !state.persistedSettingsSnapshot || currentSnapshot !== state.persistedSettingsSnapshot;
  renderSettingsStatus();
  const group = preferenceGroupForControl(target.id);
  if (group && state.settingsDirty) {
    (state.settingsPendingGroups ||= new Set()).add(group);
    schedulePreferenceSave();
  }
}

function refreshSettingsDirtyState() {
  const currentSnapshot = serializeSettingsSnapshot(collectSettingsFromUi());
  state.settingsDirty = !state.persistedSettingsSnapshot || currentSnapshot !== state.persistedSettingsSnapshot;
  renderSettingsStatus();
  return state.settingsDirty;
}

function setSettingsSaving(saving) {
  state.settingsSaving = Boolean(saving);
  ui.settingsForm.inert = state.settingsSaving;
  ui.settingsForm.setAttribute("aria-busy", String(state.settingsSaving));
  ui.saveSettingsButton.disabled = state.settingsSaving || !state.settingsDirty;
  // Saving can render connection controls while the form is inert. Release
  // their own disabled state as well when the preference receipt arrives.
  renderCredentialSettings();
}

function preferenceGroupForControl(id) {
  if (/^(tts|gameVolume|speechInput)/.test(id)) return "audio";
  if (id === "gameLanguageSelect") return "localization";
  if (/^(narrationLength|narrationCustom)/.test(id)) return "narration";
  if (/^(contextWindow|autoCompact)/.test(id)) return "agent";
  if (/^(autoSave|manualChapter|compactionChapter)/.test(id)) return "save";
  if (id === "debugPanelEnabledSelect") return "developer";
  return "ui";
}

function schedulePreferenceSave() {
  if (!ui.settingsDialog.open) return;
  if (state.settingsAutosaveTimer) window.clearTimeout(state.settingsAutosaveTimer);
  state.settingsAutosaveTimer = window.setTimeout(() => {
    state.settingsAutosaveTimer = null;
    const groups = [...(state.settingsPendingGroups || [])];
    state.settingsPendingGroups?.clear();
    if (groups.length) void saveSettings({ groups });
  }, 350);
}

function saveSettings(options = {}) {
  if (state.settingsAutosaveTimer) window.clearTimeout(state.settingsAutosaveTimer);
  state.settingsAutosaveTimer = null;
  if (state.settingsSaveTask) return state.settingsSaveTask.then(() => saveSettings(options));
  const task = performSettingsSave(options);
  state.settingsSaveTask = task;
  const complete = () => {
    if (state.settingsSaveTask === task) state.settingsSaveTask = null;
    if (state.settingsPendingGroups?.size) schedulePreferenceSave();
  };
  task.then(complete, complete);
  return task;
}

async function performSettingsSave({ groups = null } = {}) {
  const settings = collectSettingsFromUi();
  let previous = {};
  try { previous = JSON.parse(state.persistedSettingsSnapshot || "{}"); } catch { /* Initial load. */ }
  const changed = Object.keys(settings).filter(key => key !== "api"
    && (!groups || groups.includes(key)) && serializeSettingsSnapshot(settings[key]) !== serializeSettingsSnapshot(previous[key]));
  for (const group of changed) state.settingsPendingGroups?.delete(group);
  if (!changed.length) { refreshSettingsDirtyState(); renderSettingsStatus(); return true; }
  const patch = Object.fromEntries(changed.map(key => [key, settings[key]]));
  setSettingsSaving(true);
  ui.settingsStatus.textContent = t("settings.status.autoSaving");
  try {
    const result = await window.greyCrow.updateSettings(patch);
    if (!result.ok) {
      if (["CONTEXT_SETTINGS_TOO_SMALL", "CONTEXT_SETTINGS_STALE"].includes(result.error?.code)) {
        ui.settingsStatus.textContent = t(result.error.code === "CONTEXT_SETTINGS_STALE"
          ? "settings.context.changed" : "settings.context.tooSmall");
      } else if (result.error?.code === "CONTEXT_SETTINGS_REQUIRE_COMPACTION") {
        promptContextCompactionForSettings();
      } else ui.settingsStatus.textContent = formatError(result.error, t("settings.error.saveFailed"));
      return false;
    }
    const accepted = result.settings;
    const latest = collectSettingsFromUi();
    const pending = Object.fromEntries(Object.keys(latest).filter(key => key !== "api"
      && (changed.includes(key) ? serializeSettingsSnapshot(latest[key]) !== serializeSettingsSnapshot(settings[key])
        : serializeSettingsSnapshot(latest[key]) !== serializeSettingsSnapshot(previous[key])))
      .map(key => [key, latest[key]]));
    for (const key of Object.keys(pending)) {
      if (changed.includes(key)) state.settingsPendingGroups?.add(key);
    }
    if (result.catalog) applySettingsCatalog(result.catalog);
    applyStatus(result.status);
    applySettings({ ...accepted, ...pending });
    state.persistedSettingsSnapshot = serializeSettingsSnapshot(accepted);
    state.settingsDirty = serializeSettingsSnapshot(collectSettingsFromState()) !== state.persistedSettingsSnapshot;
    renderShellState();
    ui.settingsStatus.textContent = t(state.settingsDirty ? "settings.status.dirty" : "settings.status.autoSaved");
    void refreshTtsCacheStatus({ silent: true });
    return true;
  } catch (error) {
    ui.settingsStatus.textContent = formatError(error, t("settings.error.saveFailed"));
    return false;
  } finally { setSettingsSaving(false); }
}

function promptContextCompactionForSettings() {
  const message = t("settings.context.requiresCompaction");
  ui.settingsStatus.textContent = message;
  if (ui.settingsDialog.open) {
    forceCloseSettings();
  }
  openCompactDialog();
  ui.compactStatus.textContent = message;
}

function collectSettingsFromUi() {
  const narrationPreset = ui.narrationLengthPresetSelect.value || "standard";
  return {
    localization: {
      preferredLocale: ui.gameLanguageSelect.value,
    },
    api: {
      provider: state.provider,
      model: state.model,
      connectionId: state.connectionId,
      customConnections: state.customConnections,
    },
    narration: {
      lengthPreset: narrationPreset,
      customTargetChars: narrationPreset === "custom"
        ? Number.parseInt(ui.narrationCustomTargetInput.value, 10)
        : null,
    },
    agent: {
      context: collectAgentContextSettingsFromUi(),
    },
    ui: {
      narrationTextSize: normalizeUiTextSize(ui.narrationTextSizeSelect.value),
      sidePanelTextSize: normalizeUiTextSize(ui.sidePanelTextSizeSelect.value),
      storyNotebookTheme: normalizeStoryNotebookTheme(ui.storyNotebookThemeSelect.value),
      windowMode: normalizeWindowMode(ui.windowModeSelect.value),
      gameUiLayout: normalizeGameUiLayout(state.gameUiLayout),
    },
    save: {
      chapterLog: collectAutoSaveSettingsFromUi(),
    },
    audio: {
      gameVolume: Number.parseInt(ui.gameVolumeInput.value, 10),
      input: { enabled: ui.speechInputEnabledSelect.value === "true", language: ui.speechInputLanguageSelect.value || "zh",
        deviceId: ui.speechInputDeviceSelect.value || "default" },
      tts: {
        enabled: ui.ttsReadingModeSelect.value !== "off",
        // "Off" only stops delivery. Preserve the last active mode so turning
        // narration back on does not silently change automatic playback.
        autoPlay: ui.ttsReadingModeSelect.value === "off"
          ? Boolean(state.ttsAuto)
          : ui.ttsReadingModeSelect.value === "auto",
        provider: ui.ttsProviderSelect.value,
        voiceId: ui.ttsVoiceSelect.value || state.ttsVoiceId,
        rate: ui.ttsRateInput.value,
        pitch: ui.ttsPitchInput.value,
        cacheUtteranceLimit: normalizeTtsCacheUtteranceLimit(ui.ttsCacheLimitSelect.value),
      },
    },
    developer: {
      debugPanelEnabled: ui.debugPanelEnabledSelect.value === "true",
    },
  };
}

function collectSettingsFromState() {
  return {
    localization: {
      preferredLocale: state.preferredLocale,
    },
    api: {
      provider: state.provider,
      model: state.model,
      connectionId: state.connectionId,
      customConnections: state.customConnections,
    },
    narration: {
      lengthPreset: state.narrationLengthPreset,
      customTargetChars: state.narrationLengthPreset === "custom"
        ? state.narrationCustomTargetChars
        : null,
    },
    agent: {
      context: {
        configuredContextWindow: state.configuredContextWindow,
        autoCompactRatio: state.autoCompactRatio,
      },
    },
    ui: {
      narrationTextSize: state.narrationTextSize,
      sidePanelTextSize: state.sidePanelTextSize,
      storyNotebookTheme: normalizeStoryNotebookTheme(state.storyNotebookTheme),
      windowMode: state.windowMode,
      gameUiLayout: normalizeGameUiLayout(state.gameUiLayout),
    },
    save: {
      chapterLog: {
        onAutoSave: state.autoSaveEnabled,
        onManualSave: state.manualChapterEnabled,
        onCompaction: state.compactionChapterEnabled,
        intervalTurns: state.autoSaveIntervalTurns,
      },
    },
    audio: {
      gameVolume: state.gameVolume,
      input: { ...state.speechInput },
      tts: {
        enabled: state.ttsEnabled,
        autoPlay: state.ttsAuto,
        provider: state.ttsProvider,
        voiceId: state.ttsVoiceId,
        rate: state.ttsRate,
        pitch: state.ttsPitch,
        cacheUtteranceLimit: state.ttsCacheUtteranceLimit,
      },
    },
    developer: {
      debugPanelEnabled: state.debugPanelEnabled,
    },
  };
}

function serializeSettingsSnapshot(settings) {
  // Disk normalization and renderer collection use different property orders.
  // Compare values so a successful save does not immediately become dirty again.
  return JSON.stringify(settings || {}, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

function switchSettingsTab(tabId, options = {}) {
  if (tabId === "content") tabId = "save";
  const nextTab = ui.settingsPanels.some((panel) => panel.dataset.settingsPanel === tabId)
    ? tabId
    : "display";
  state.activeSettingsTab = nextTab;
  ui.settingsTabs.forEach((button) => {
    const active = button.dataset.settingsTab === nextTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  ui.settingsPanels.forEach((panel) => {
    const active = panel.dataset.settingsPanel === nextTab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  if (ui.settingsContent) {
    ui.settingsContent.scrollTop = 0;
  }
  if (options.focusTab) {
    focusActiveSettingsTab();
  }
  if (nextTab === "audio") {
    void refreshTtsCacheStatus({ silent: true });
  }
  if (["save", "narration"].includes(nextTab)) {
    void refreshContentManagement({ silent: Boolean(state.contentLibrary && state.playerProfile) });
  }
}

function inferSettingsTabFromMessage(message) {
  void message;
  return state.activeSettingsTab || "display";
}

function focusActiveSettingsTab() {
  const tab = ui.settingsTabs.find((item) => item.dataset.settingsTab === state.activeSettingsTab);
  (tab || ui.closeSettingsButton).focus();
}

function handleSettingsTabKeydown(event, currentButton) {
  const handledKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);
  if (!handledKeys.has(event.key)) return;
  event.preventDefault();
  const currentIndex = Math.max(0, ui.settingsTabs.indexOf(currentButton));
  let nextIndex = currentIndex;
  if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = ui.settingsTabs.length - 1;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + ui.settingsTabs.length) % ui.settingsTabs.length;
  } else {
    nextIndex = (currentIndex + 1) % ui.settingsTabs.length;
  }
  switchSettingsTab(ui.settingsTabs[nextIndex].dataset.settingsTab, { focusTab: true });
}

async function refreshContentManagement(options = {}) {
  if (state.contentManagementBusy) return;
  setContentManagementBusy(true);
  if (!options.silent) ui.contentLibraryStatus.textContent = t("settings.content.status.loading");
  try {
    const [libraryResult, profileResult] = await Promise.all([
      window.greyCrow.listContentLibrary(),
      window.greyCrow.getPlayerProfile(),
    ]);
    if (!libraryResult?.ok) {
      ui.contentLibraryStatus.textContent = formatContentOperationError(
        libraryResult?.error,
        "settings.content.status.readFailed"
      );
    } else {
      applyContentLibrary(libraryResult.library);
      ui.contentLibraryStatus.textContent = t("settings.content.status.validated", {
        count: state.contentLibrary?.packs?.length || 0,
      });
    }
    if (!profileResult?.ok) {
      ui.playerProfileStatus.textContent = formatContentOperationError(
        profileResult?.error,
        "settings.content.status.profileReadFailed"
      );
    } else {
      applyPlayerProfile(profileResult.profile, profileResult.persistence);
    }
  } catch (error) {
    ui.contentLibraryStatus.textContent = t("settings.content.status.readFailed");
  } finally {
    setContentManagementBusy(false);
  }
}

function applyContentLibrary(library = {}) {
  state.contentLibrary = {
    schemaVersion: library.schemaVersion || "grey-crow-content-library-v2",
    packs: Array.isArray(library.packs) ? library.packs : [],
    presets: Array.isArray(library.presets) ? library.presets : [],
  };
  if (!state.contentLibrary.packs.some((item) => item.id === state.selectedContentPackId)) {
    state.selectedContentPackId = state.contentLibrary.packs[0]?.id || null;
  }
  if (ui.contentCreatorDialog.open && state.contentCreatorAcknowledged) {
    const selected = state.contentLibrary.packs.find((item) => item.id === state.selectedContentPackId);
    if (!selected?.editable || selected.status !== "valid") {
      state.selectedContentPackId = state.contentLibrary.packs.find((item) => item.editable && item.status === "valid")?.id || null;
    }
  }
  renderContentLibrary();
}

function renderContentLibrary() {
  const packs = state.contentLibrary?.packs || [];
  const selectedId = state.selectedContentPackId || packs[0]?.id || "";
  replaceContentPackOptions(ui.contentPackSelect, packs, t("settings.content.none"));
  ui.contentPackSelect.value = selectedId;
  state.selectedContentPackId = ui.contentPackSelect.value || null;
  const selected = packs.find((item) => item.id === state.selectedContentPackId) || null;
  const editablePacks = packs.filter((item) => item.editable && item.status === "valid");
  replaceContentPackOptions(ui.contentCreatorPackSelect, editablePacks, t("settings.content.nonePlayer"));
  const creatorSelectedId = editablePacks.some((item) => item.id === state.selectedContentPackId)
    ? state.selectedContentPackId
    : editablePacks[0]?.id || "";
  ui.contentCreatorPackSelect.value = creatorSelectedId;
  ui.contentCreatorPackSelect.disabled = state.contentManagementBusy || !editablePacks.length;
  ui.contentPackDetails.replaceChildren();
  const lines = selected
    ? [
        t("settings.content.details.version", {
          title: selected.title || selected.id,
          id: selected.id,
          version: selected.version || "?",
        }),
        t("settings.content.details.status", {
          ownership: contentOwnershipLabel(selected.ownership, selected.activation),
          status: selected.status === "valid" ? t("settings.content.details.valid") : contentErrorLabel(selected.errorCode),
        }),
        t("settings.content.details.inventory", {
          languages: selected.languages?.join(", ") || t("settings.content.details.languagesMissing"),
          count: selected.itemCount || 0,
        }),
      ]
    : [t("settings.content.notLoaded")];
  for (const [index, line] of lines.entries()) {
    const row = document.createElement(index === 0 ? "strong" : "div");
    row.textContent = line;
    ui.contentPackDetails.append(row);
  }
  ui.cloneContentPackButton.disabled = state.contentManagementBusy || !selected || selected.status !== "valid" || selected.activation === "quarantined";
  ui.exportContentPackButton.disabled = state.contentManagementBusy || !selected || selected.status !== "valid";
  ui.deleteContentPackButton.disabled = state.contentManagementBusy || !selected || selected.ownership === "built_in";
  renderContentEditor();
}

function replaceContentPackOptions(select, packs, emptyLabel) {
  select.replaceChildren();
  if (!packs.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
    return;
  }
  for (const pack of packs) {
    const option = document.createElement("option");
    option.value = pack.id;
    option.textContent = `${pack.title || pack.id} / ${contentOwnershipLabel(pack.ownership, pack.activation)}`;
    select.append(option);
  }
}

function renderContentEditor() {
  const presetMode = state.contentCreatorMode === "preset";
  const blankDraft = !presetMode && state.editableContentItem?.isNew === true;
  ui.contentCreatorModeContent.classList.toggle("is-active", !presetMode);
  ui.contentCreatorModeContent.setAttribute("aria-selected", String(!presetMode));
  ui.contentCreatorModePreset.classList.toggle("is-active", presetMode);
  ui.contentCreatorModePreset.setAttribute("aria-selected", String(presetMode));
  ui.contentEditorItemLabel.textContent = t(presetMode ? "creator.library.existingPresets" : "creator.library.item");
  ui.newBlankContentButton.classList.toggle("hidden", presetMode);
  ui.newContentPresetButton.classList.toggle("hidden", !presetMode);
  ui.blankContentPicker.classList.toggle("hidden", presetMode || !state.blankContentPickerOpen);
  ui.cancelBlankContentButton.classList.toggle("hidden", !blankDraft);
  ui.saveContentEditorButton.textContent = t(blankDraft
    ? "creator.action.validateCreate"
    : "creator.action.validateSave");
  renderContentAdvancedInfo();
  if (presetMode) {
    ui.blankContentPicker.classList.add("hidden");
    ui.contentEditorForm.classList.add("hidden");
    renderContentPresetComposer();
    return;
  }
  ui.contentPresetForm.classList.add("hidden");
  ui.contentPresetPreview.textContent = t("creator.preview.empty");
  if (blankDraft) {
    ui.contentCreatorPackSelect.disabled = true;
    ui.contentEditorItemSelect.disabled = true;
    ui.loadContentEditorButton.disabled = true;
    ui.contentEditorForm.classList.remove("hidden");
    return;
  }
  const pack = selectedContentPack();
  const items = pack?.editable && pack.status === "valid"
    ? (pack.items || []).filter((item) => ["host", "world", "skill"].includes(item.type))
    : [];
  const previous = state.editableContentItem?.packId === pack?.id
    ? state.editableContentItem.itemId
    : ui.contentEditorItemSelect.value;
  ui.contentEditorItemSelect.replaceChildren();
  if (!items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t(pack?.editable
      ? "creator.library.noEditableKinds"
      : "creator.library.canCreateBlank");
    ui.contentEditorItemSelect.append(option);
  } else {
    for (const item of items) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${contentItemTypeLabel(item.type)} · ${item.title || item.id}`;
      ui.contentEditorItemSelect.append(option);
    }
    ui.contentEditorItemSelect.value = items.some((item) => item.id === previous) ? previous : items[0].id;
  }
  const selectedItemId = ui.contentEditorItemSelect.value;
  const loadedMatches = Boolean(
    state.editableContentItem &&
    state.editableContentItem.packId === pack?.id &&
    state.editableContentItem.itemId === selectedItemId
  );
  ui.loadContentEditorButton.disabled = state.contentManagementBusy || !pack?.editable || !selectedItemId;
  ui.contentEditorItemSelect.disabled = state.contentManagementBusy || !items.length;
  ui.contentEditorForm.classList.toggle("hidden", state.blankContentPickerOpen || !loadedMatches);
  if (!loadedMatches) {
    ui.contentEditorPreview.textContent = t("creator.preview.empty");
    ui.contentEditorTypeSummary.textContent = items.length
      ? t("creator.preview.initial")
      : t("creator.library.noEditableSummary");
  }
}

function setContentCreatorMode(mode) {
  state.contentCreatorMode = mode === "preset" ? "preset" : "content";
  state.editableContentItem = null;
  state.editableContentPreset = null;
  state.blankContentPickerOpen = false;
  state.contentAdvancedInfoOpen = false;
  ui.contentEditorStatus.textContent = state.contentCreatorMode === "preset"
    ? t("creator.status.modePreset")
    : t("creator.status.modeContent");
  renderContentLibrary();
}

function openBlankContentPicker() {
  if (state.contentManagementBusy) return;
  state.contentCreatorMode = "content";
  state.editableContentItem = null;
  state.editableContentPreset = null;
  state.blankContentPickerOpen = true;
  state.contentAdvancedInfoOpen = false;
  ui.contentEditorStatus.textContent = t("creator.status.chooseBlankKind");
  renderContentEditor();
  ui.blankContentKindButtons[0]?.focus();
}

function closeBlankContentPicker() {
  state.blankContentPickerOpen = false;
  ui.contentEditorStatus.textContent = t("creator.status.modeContent");
  renderContentEditor();
  ui.newBlankContentButton.focus();
}

function beginBlankContent(kind) {
  const definitions = {
    host: { type: "host", skillClass: null },
    world: { type: "world", skillClass: null },
    ordinary_skill: { type: "skill", skillClass: "ordinary" },
    new_game_skill: { type: "skill", skillClass: "new_game" },
  };
  const definition = definitions[kind];
  if (!definition || state.contentManagementBusy) return;
  state.blankContentPickerOpen = false;
  state.contentAdvancedInfoOpen = false;
  const item = {
    schemaVersion: "grey-crow-content-editor-item-v2",
    isNew: true,
    blankKind: kind,
    packId: null,
    packVersion: null,
    itemId: null,
    type: definition.type,
    skillClass: definition.skillClass,
    title: "",
    language: state.playerProfile?.preferredLanguage || "zh-CN",
    description: "",
    danger: "low",
    triggers: definition.skillClass === "new_game" ? ["ui_start_new_game"] : [],
    readScopes: [],
    writeScopes: [],
    markdown: "",
    templates: [],
    ...(definition.skillClass === "ordinary" ? {
      playerGuide: "",
      module: {
        enabled: false,
        definitionSchemaVersion: null,
        creatorSupport: "available_v2",
        draft: emptyContentModuleDraft(),
      },
    } : {}),
    revision: null,
  };
  applyEditableContentItem(item);
  ui.contentEditorStatus.textContent = t("creator.status.creatingKind", { kind: blankContentKindLabel(kind) });
  ui.contentEditorTitleInput.focus();
}

function cancelBlankContent() {
  if (state.editableContentItem?.isNew !== true || state.contentManagementBusy) return;
  state.editableContentItem = null;
  state.contentAdvancedInfoOpen = false;
  ui.contentEditorStatus.textContent = t("creator.status.blankCanceled");
  renderContentLibrary();
  ui.newBlankContentButton.focus();
}

function blankContentKindLabel(kind) {
  if (kind === "host") return t("creator.blank.host.title");
  if (kind === "world") return t("creator.blank.world.title");
  if (kind === "ordinary_skill") return t("creator.blank.skill.title");
  return t("creator.blank.newGame.title");
}

function renderContentPresetComposer() {
  const pack = selectedContentPack();
  const presets = pack?.editable && pack.status === "valid"
    ? (state.contentLibrary?.presets || []).filter((preset) => preset.packId === pack.id && preset.ownership === "player_owned")
    : [];
  const previous = state.editableContentPreset?.packId === pack?.id
    ? state.editableContentPreset.itemId
    : ui.contentEditorItemSelect.value;
  ui.contentEditorItemSelect.replaceChildren();
  if (!presets.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t(pack?.editable ? "creator.preset.noneInPack" : "creator.preset.cloneFirst");
    ui.contentEditorItemSelect.append(option);
  } else {
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.itemId;
      option.textContent = preset.title || t("creator.preset.untitled");
      ui.contentEditorItemSelect.append(option);
    }
    ui.contentEditorItemSelect.value = presets.some((preset) => preset.itemId === previous) ? previous : presets[0].itemId;
  }
  const selectedPresetId = ui.contentEditorItemSelect.value;
  const loadedMatches = Boolean(
    state.editableContentPreset &&
    state.editableContentPreset.packId === pack?.id &&
    (state.editableContentPreset.itemId === selectedPresetId || state.editableContentPreset.itemId === null)
  );
  ui.loadContentEditorButton.disabled = state.contentManagementBusy || !pack?.editable || !selectedPresetId;
  ui.contentEditorItemSelect.disabled = state.contentManagementBusy || !presets.length;
  ui.newContentPresetButton.disabled = state.contentManagementBusy || !pack?.editable;
  ui.contentEditorForm.classList.add("hidden");
  ui.contentPresetForm.classList.toggle("hidden", !loadedMatches);
  if (loadedMatches) renderContentPresetChoices();
  else ui.contentPresetPreview.textContent = t("creator.preview.empty");
}

function beginNewContentPreset() {
  const pack = selectedContentPack();
  if (!pack?.editable || state.contentManagementBusy) return;
  state.editableContentPreset = {
    packId: pack.id,
    itemId: null,
    expectedRevision: null,
    title: "",
    description: "",
    language: pack.languages?.[0] || state.playerProfile?.preferredLanguage || "zh-CN",
    selection: { host: null, world: null, newGameSkill: null, skills: [], optionalSkills: [] },
  };
  ui.contentPresetTitleInput.value = "";
  ui.contentPresetDescriptionInput.value = "";
  ui.contentPresetLanguageInput.value = state.editableContentPreset.language;
  ui.contentPresetHostSelect.value = "";
  ui.contentPresetWorldSelect.value = "";
  ui.contentPresetNewGameSkillSelect.value = "";
  ui.contentPresetSkillList.replaceChildren();
  ui.contentEditorStatus.textContent = t("creator.preset.creating");
  renderContentPresetComposer();
  renderContentPresetPreview();
  ui.contentPresetTitleInput.focus();
}

function loadEditableContentPreset() {
  const pack = selectedContentPack();
  const itemId = ui.contentEditorItemSelect.value;
  if (!pack?.editable || !itemId || state.contentManagementBusy) return;
  const preset = (state.contentLibrary?.presets || []).find((item) => item.packId === pack.id && item.itemId === itemId && item.ownership === "player_owned");
  if (!preset) {
    ui.contentEditorStatus.textContent = t("creator.preset.notFound");
    return;
  }
  applyEditableContentPreset(preset);
  ui.contentEditorStatus.textContent = t("creator.preset.opened", {
    title: preset.title || t("creator.preset.untitled"),
    version: preset.packVersion,
  });
}

function applyEditableContentPreset(preset = {}) {
  state.editableContentPreset = preset;
  ui.contentPresetTitleInput.value = preset.title || "";
  ui.contentPresetLanguageInput.value = preset.language || "zh-CN";
  ui.contentPresetDescriptionInput.value = preset.description || "";
  ui.contentPresetHostSelect.value = "";
  ui.contentPresetWorldSelect.value = "";
  ui.contentPresetNewGameSkillSelect.value = "";
  ui.contentPresetSkillList.replaceChildren();
  renderContentPresetComposer();
  renderContentPresetPreview();
}

function renderContentPresetChoices() {
  const preset = state.editableContentPreset;
  if (!preset) return;
  const language = ui.contentPresetLanguageInput.value.trim() || preset.language || "zh-CN";
  const items = composableContentItems().filter((item) => item.language === language && !item.replaces);
  const current = {
    host: parseNewGameRef(ui.contentPresetHostSelect.value || newGameRefKey(preset.selection?.host || {})),
    world: parseNewGameRef(ui.contentPresetWorldSelect.value || newGameRefKey(preset.selection?.world || {})),
    newGameSkill: parseNewGameRef(ui.contentPresetNewGameSkillSelect.value || newGameRefKey(preset.selection?.newGameSkill || {})),
    skillModes: ui.contentPresetSkillList.querySelectorAll("select[data-pack-id]").length
      ? new Map([...ui.contentPresetSkillList.querySelectorAll("select[data-pack-id]")].map((select) => [
          newGameRefKey({ packId: select.dataset.packId || "", itemId: select.dataset.itemId || "" }),
          select.value,
        ]))
      : new Map([
          ...(preset.selection?.skills || []).map((ref) => [newGameRefKey(ref), "required"]),
          ...(preset.selection?.optionalSkills || []).map((ref) => [newGameRefKey(ref), ref.defaultEnabled === false ? "optional_off" : "optional_on"]),
        ]),
  };
  replaceComposableOptions(ui.contentPresetHostSelect, items.filter((item) => item.type === "host"), current.host, t("creator.preset.noCompatibleHost"));
  replaceComposableOptions(ui.contentPresetWorldSelect, items.filter((item) => item.type === "world"), current.world, t("creator.preset.noCompatibleWorld"));
  replaceComposableOptions(ui.contentPresetNewGameSkillSelect, items.filter((item) => item.type === "skill" && item.skillClass === "new_game"), current.newGameSkill, t("creator.preset.noCompatibleOpening"));
  ui.contentPresetSkillList.replaceChildren();
  for (const item of items.filter((entry) => entry.type === "skill" && entry.skillClass === "ordinary")) {
    const label = document.createElement("label");
    label.className = "new-game-skill-option content-preset-skill-option";
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = item.title;
    const detail = document.createElement("small");
    detail.textContent = `${item.packTitle} / ${item.description || t("creator.preset.noDescription")}`;
    text.append(title, detail);
    const mode = document.createElement("select");
    mode.className = "settings-select content-preset-skill-mode";
    mode.dataset.packId = item.packId;
    mode.dataset.itemId = item.itemId;
    for (const [value, labelText] of [
      ["excluded", t("creator.preset.mode.excluded")],
      ["required", t("creator.preset.mode.required")],
      ["optional_on", t("creator.preset.mode.optionalOn")],
      ["optional_off", t("creator.preset.mode.optionalOff")],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = labelText;
      mode.append(option);
    }
    mode.value = current.skillModes.get(newGameRefKey(item)) || "excluded";
    mode.disabled = state.contentManagementBusy;
    label.append(text, mode);
    ui.contentPresetSkillList.append(label);
  }
  if (!ui.contentPresetSkillList.children.length) {
    const empty = document.createElement("p");
    empty.className = "field-help";
    empty.textContent = t("creator.preset.noRules");
    ui.contentPresetSkillList.append(empty);
  }
}

function composableContentItems() {
  return (state.contentLibrary?.packs || [])
    .filter((pack) => pack.status === "valid" && pack.activation === "active")
    .flatMap((pack) => (pack.items || []).map((item) => ({
      ...item,
      packId: pack.id,
      packTitle: pack.title || pack.id,
      itemId: item.id,
    })));
}

function replaceComposableOptions(select, items, selectedRef, emptyLabel) {
  select.replaceChildren();
  if (!items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
    select.disabled = true;
    return;
  }
  for (const item of items) {
    const option = document.createElement("option");
    option.value = newGameRefKey(item);
    option.textContent = `${item.title} / ${item.packTitle}`;
    select.append(option);
  }
  const selectedKey = newGameRefKey(selectedRef || {});
  select.value = items.some((item) => newGameRefKey(item) === selectedKey) ? selectedKey : newGameRefKey(items[0]);
  select.disabled = state.contentManagementBusy;
}

function readContentPresetSelection() {
  const choices = [...ui.contentPresetSkillList.querySelectorAll("select[data-pack-id]")].map((select) => ({
    packId: select.dataset.packId || "",
    itemId: select.dataset.itemId || "",
    mode: select.value,
  }));
  return {
    host: parseNewGameRef(ui.contentPresetHostSelect.value),
    world: parseNewGameRef(ui.contentPresetWorldSelect.value),
    newGameSkill: parseNewGameRef(ui.contentPresetNewGameSkillSelect.value),
    skills: choices.filter((item) => item.mode === "required").map(({ packId, itemId }) => ({ packId, itemId })),
    optionalSkills: choices.filter((item) => item.mode === "optional_on" || item.mode === "optional_off").map(({ packId, itemId, mode }) => ({
      packId,
      itemId,
      defaultEnabled: mode === "optional_on",
    })),
  };
}

function renderContentPresetPreview() {
  if (!state.editableContentPreset) {
    ui.contentPresetPreview.textContent = t("creator.preview.empty");
    return;
  }
  const selection = readContentPresetSelection();
  const findItem = (ref) => composableContentItems().find((item) => newGameRefKey(item) === newGameRefKey(ref));
  const skillNames = selection.skills.map(findItem).filter(Boolean).map((item) => item.title);
  const optionalSkillNames = selection.optionalSkills.map((ref) => {
    const title = findItem(ref)?.title;
    return title ? t("creator.preset.optionalName", {
      title,
      state: t(ref.defaultEnabled ? "common.on" : "common.off"),
    }) : null;
  }).filter(Boolean);
  ui.contentPresetPreview.textContent = [
    t("creator.preset.previewHeading", { title: ui.contentPresetTitleInput.value.trim() || t("creator.preset.untitled") }),
    t("creator.preset.previewLanguage", { value: ui.contentPresetLanguageInput.value.trim() || t("creator.preset.languageUnset") }),
    t("creator.preset.previewHost", { value: findItem(selection.host)?.title || t("creator.preset.notSelected") }),
    t("creator.preset.previewWorld", { value: findItem(selection.world)?.title || t("creator.preset.notSelected") }),
    t("creator.preset.previewOpening", { value: findItem(selection.newGameSkill)?.title || t("creator.preset.notSelected") }),
    t("creator.preset.previewRequired", { value: formatUiList(skillNames) || t("creator.preset.none") }),
    t("creator.preset.previewOptional", { value: formatUiList(optionalSkillNames) || t("creator.preset.none") }),
    "",
    ui.contentPresetDescriptionInput.value.trim() || t("creator.preset.descriptionMissing"),
  ].join("\n");
}

async function saveEditableContentPreset() {
  const pack = selectedContentPack();
  const preset = state.editableContentPreset;
  if (!pack?.editable || !preset || preset.packId !== pack.id || state.contentManagementBusy) return;
  const payload = {
    packId: pack.id,
    itemId: preset.itemId || null,
    expectedRevision: preset.revision || null,
    title: ui.contentPresetTitleInput.value.trim(),
    description: ui.contentPresetDescriptionInput.value.trim(),
    language: ui.contentPresetLanguageInput.value.trim(),
    selection: readContentPresetSelection(),
  };
  if (!payload.title || !payload.description || !payload.language
    || !payload.selection.host.packId || !payload.selection.world.packId || !payload.selection.newGameSkill.packId) {
    ui.contentEditorStatus.textContent = t("creator.preset.invalid");
    return;
  }
  setContentManagementBusy(true);
  ui.contentEditorStatus.textContent = t("creator.preset.saving");
  try {
    const result = await window.greyCrow.saveContentPreset(payload);
    if (!result?.ok) {
      ui.contentEditorStatus.textContent = formatContentOperationError(result?.error, "creator.preset.saveFailed");
      return;
    }
    state.selectedContentPackId = result.preset.packId;
    applyContentLibrary(result.library);
    applyEditableContentPreset(result.preset);
    ui.contentEditorStatus.textContent = t("creator.preset.saved", { version: result.preset.packVersion });
  } catch (error) {
    ui.contentEditorStatus.textContent = t("creator.preset.saveFailed");
  } finally {
    setContentManagementBusy(false);
  }
}

async function loadEditableContentItem() {
  const pack = selectedContentPack();
  const itemId = ui.contentEditorItemSelect.value;
  if (!pack?.editable || !itemId || state.contentManagementBusy) return;
  setContentManagementBusy(true);
  ui.contentEditorStatus.textContent = t("creator.content.loading");
  try {
    const result = await window.greyCrow.loadEditableContent(pack.id, itemId);
    if (!result?.ok) {
      ui.contentEditorStatus.textContent = formatContentOperationError(result?.error, "creator.content.loadFailed");
      return;
    }
    applyEditableContentItem(result.item);
    ui.contentEditorStatus.textContent = t("creator.content.opened", {
      title: result.item.title || result.item.itemId,
      version: result.item.packVersion,
    });
  } catch (error) {
    ui.contentEditorStatus.textContent = t("creator.content.loadFailed");
  } finally {
    setContentManagementBusy(false);
  }
}

function applyEditableContentItem(item = {}) {
  state.editableContentItem = item;
  ui.contentEditorTitleInput.value = item.title || "";
  ui.contentEditorLanguageInput.value = item.language || "zh-CN";
  ui.contentEditorMarkdownInput.value = item.markdown || "";
  const isSkill = item.type === "skill";
  const isNewGameSkill = isSkill && item.skillClass === "new_game";
  const isOrdinarySkill = isSkill && item.skillClass === "ordinary";
  state.contentModuleDraft = isOrdinarySkill
    ? cloneContentModuleDraft(item.module?.draft || emptyContentModuleDraft())
    : null;
  state.contentModuleSuspendedDraft = null;
  clearContentModulePanelPreview();
  ui.contentSkillEditorFields.classList.toggle("hidden", !isSkill);
  ui.contentModuleOrdinaryFields.classList.toggle("hidden", !isOrdinarySkill);
  ui.contentEditorPermissionPanel.classList.toggle("hidden", !isSkill || isNewGameSkill);
  ui.contentNewGameBoundary.classList.toggle("hidden", !isNewGameSkill);
  ui.contentEditorTriggersInput.disabled = isNewGameSkill;
  ui.contentEditorTriggersInput.value = isNewGameSkill
    ? t("creator.skill.fixedTrigger")
    : formatSkillTrigger(item);
  ui.contentEditorPlayerGuideInput.value = isOrdinarySkill ? item.playerGuide || "" : "";
  ui.contentEditorMarkdownInput.placeholder = contentEditorPlaceholder(item.type);
  ui.contentPermissionReadAdventure.checked = false;
  ui.contentPermissionPrivateState.checked = false;
  ui.contentPermissionUpdateAdventure.checked = false;
  const inheritedCapabilities = [];
  if ((item.readScopes || []).length) inheritedCapabilities.push(t("creator.capability.read"));
  if ((item.writeScopes || []).length) inheritedCapabilities.push(t("creator.capability.update"));
  ui.contentEditorExistingCapabilitySummary.textContent = inheritedCapabilities.length
    ? t("creator.capability.inherited", { capabilities: formatUiList(inheritedCapabilities) })
    : t("creator.capability.none");
  ui.contentEditorTypeSummary.textContent = isNewGameSkill
    ? t("creator.summary.newGame")
    : item.type === "skill"
      ? t("creator.summary.skill")
      : item.type === "host"
        ? t("creator.summary.host")
        : t("creator.summary.world");
  renderContentEditorPreview();
  renderContentModuleEditor();
  renderContentModulePreview();
  renderContentEditor();
}

function toggleContentAdvancedInfo() {
  if (!state.editableContentItem || state.contentCreatorMode !== "content" || state.contentManagementBusy) return;
  state.contentAdvancedInfoOpen = !state.contentAdvancedInfoOpen;
  renderContentAdvancedInfo();
}

function renderContentAdvancedInfo() {
  const item = state.contentCreatorMode === "content" ? state.editableContentItem : null;
  const available = Boolean(item);
  if (!available) state.contentAdvancedInfoOpen = false;
  const expanded = available && state.contentAdvancedInfoOpen;
  ui.toggleContentAdvancedInfoButton.classList.toggle("hidden", !available);
  ui.toggleContentAdvancedInfoButton.textContent = t(expanded ? "creator.advanced.hide" : "creator.preview.technical");
  ui.toggleContentAdvancedInfoButton.setAttribute("aria-expanded", String(expanded));
  ui.contentAdvancedInfoPanel.classList.toggle("hidden", !expanded);
  ui.contentAdvancedInfoList.replaceChildren();
  if (!expanded) return;

  const technical = resolveContentTechnicalProjection(item);
  const detail = technical.item;
  const pack = technical.pack;
  const rows = [
    [t("creator.advanced.label.packId"), pack.id || t("creator.advanced.generatedAfterSave")],
    [t("creator.advanced.label.contentId"), detail.id || t("creator.advanced.generatedAfterSave")],
    [t("creator.advanced.label.packVersion"), pack.version || t("creator.advanced.notInstalled")],
    [t("creator.advanced.label.packStatus"), `${pack.ownership} / ${pack.activation} / ${pack.validationStatus}`],
    [t("creator.advanced.label.manifest"), t("creator.advanced.engineReadOnly")],
    [t("creator.advanced.label.contentType"), detail.skillClass ? `${detail.type} / ${detail.skillClass}` : detail.type],
    [t("creator.advanced.label.language"), detail.language || t("creator.advanced.unset")],
    [t("creator.advanced.label.danger"), formatContentDanger(detail.danger)],
    [t("creator.advanced.label.trigger"), formatContentTechnicalList(detail.triggers, t("creator.advanced.none"))],
    [t("creator.advanced.label.readScope"), formatContentTechnicalList(detail.readScopes, t("creator.advanced.noneDeclared"))],
    [t("creator.advanced.label.writeScope"), formatContentTechnicalList(detail.writeScopes, t("creator.advanced.noneDeclared"))],
    [t("creator.advanced.label.templates"), formatContentTechnicalTemplates(detail.templates)],
    [t("creator.advanced.label.module"), item.type === "skill" && item.skillClass === "ordinary"
      ? detail.module?.enabled
        ? `${detail.module.definitionSchemaVersion || t("creator.advanced.unknownDefinition")} / ${detail.module.creatorSupport || "read_only"}`
        : t("creator.advanced.moduleAvailable")
      : t("creator.advanced.notApplicable")],
    [t("creator.advanced.label.replaces"), detail.replaces
      ? `${detail.replaces.packId}:${detail.replaces.itemId}`
      : t("creator.advanced.none")],
    [t("creator.advanced.label.revision"), detail.revision || t("creator.advanced.generatedAfterValidation")],
    [t("creator.advanced.label.localPath"), t("creator.advanced.pathHidden")],
    [t("creator.advanced.label.permissionChanges"), technical.policy?.permissionsEditable === true
      ? t("creator.advanced.permissionsEditable")
      : t("creator.advanced.permissionsReadOnly")],
  ];
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    ui.contentAdvancedInfoList.append(term, description);
  }
}

function resolveContentTechnicalProjection(item = {}) {
  if (item.technical?.schemaVersion === "grey-crow-content-technical-v1") return item.technical;
  const selectedPack = (state.contentLibrary?.packs || []).find((pack) => pack.id === item.packId) || null;
  const selectedItem = selectedPack?.items?.find((entry) => entry.id === item.itemId) || null;
  const draft = item.isNew === true;
  return {
    schemaVersion: "grey-crow-content-technical-v1",
    pack: {
      id: item.packId || "",
      version: item.packVersion || "",
      ownership: selectedPack?.ownership || "player_owned",
      activation: selectedPack?.activation || (draft ? "pending_install" : "active"),
      validationStatus: selectedPack?.status || (draft ? "draft" : "valid"),
    },
    item: {
      id: item.itemId || "",
      type: item.type || "unknown",
      skillClass: item.skillClass || null,
      language: item.language || "",
      danger: item.danger || "medium",
      triggers: [...(item.triggers || [])],
      readScopes: [...(item.readScopes || [])],
      writeScopes: [...(item.writeScopes || [])],
      templates: (item.templates || []).map((template) => ({ templateId: template.templateId, title: template.title })),
      replaces: item.replaces || selectedItem?.replaces || null,
      revision: item.revision || null,
    },
    policy: {
      manifestEditable: false,
      permissionsEditable: false,
      localPathsExposed: false,
    },
  };
}

function formatContentDanger(value) {
  const keys = {
    low: "creator.advanced.danger.low",
    medium: "creator.advanced.danger.medium",
    high: "creator.advanced.danger.high",
    critical: "creator.advanced.danger.critical",
  };
  const danger = keys[value] ? value : "medium";
  return `${danger} (${t(keys[danger])})`;
}

function formatContentTechnicalList(values, emptyLabel) {
  return Array.isArray(values) && values.length ? values.join("；") : emptyLabel;
}

function formatContentTechnicalTemplates(templates) {
  if (!Array.isArray(templates) || !templates.length) return t("creator.advanced.none");
  return templates.map((template) => template.title
    ? `${template.templateId}（${template.title}）`
    : template.templateId).join("；");
}

const CONTENT_MODULE_WIDGET_DEFINITIONS = Object.freeze({
  integer: [["number", "creator.module.widget.number"], ["progress", "creator.module.widget.progress"], ["meter", "creator.module.widget.meter"]],
  number: [["number", "creator.module.widget.number"], ["progress", "creator.module.widget.progress"], ["meter", "creator.module.widget.meter"]],
  text: [["text", "creator.module.widget.text"], ["multiline", "creator.module.widget.multiline"]],
  boolean: [["indicator", "creator.module.widget.indicator"]],
  enum: [["badge", "creator.module.widget.badge"], ["text", "creator.module.type.text"]],
  string_list: [["chips", "creator.module.widget.chips"], ["list", "creator.module.widget.list"]],
  record_list: [["cards", "creator.module.widget.cards"], ["timeline", "creator.module.widget.timeline"], ["table", "creator.module.widget.table"]],
});

const CONTENT_MODULE_FIELD_TYPE_DEFINITIONS = Object.freeze([
  ["integer", "creator.module.type.integer"],
  ["number", "creator.module.type.number"],
  ["text", "creator.module.type.text"],
  ["boolean", "creator.module.type.boolean"],
  ["enum", "creator.module.type.enum"],
  ["string_list", "creator.module.type.stringList"],
  ["record_list", "creator.module.type.recordList"],
]);

const CONTENT_MODULE_PANEL_SURFACES = Object.freeze([
  ["fields", "creator.module.surface.fields"],
  ["progress", "creator.module.surface.progress"],
  ["list_detail", "creator.module.surface.listDetail"],
  ["timeline", "creator.module.surface.timeline"],
]);

function contentModuleWidgetOptions(type) {
  return (CONTENT_MODULE_WIDGET_DEFINITIONS[type] || []).map(([value, key]) => [value, t(key)]);
}

function contentModuleFieldTypeOptions({ itemOnly = false } = {}) {
  return CONTENT_MODULE_FIELD_TYPE_DEFINITIONS
    .filter(([type]) => !itemOnly || !["string_list", "record_list"].includes(type))
    .map(([value, key]) => [value, t(key)]);
}

function contentModulePanelSurface(value = state.contentModuleDraft) {
  const fields = Array.isArray(value?.fields) ? value.fields : [];
  if (!value?.enabled || fields.length === 0) return "fields";
  const recordFields = fields.filter((field) => field.type === "record_list");
  if (recordFields.some((field) => field.widget === "timeline")) return "timeline";
  if (recordFields.length > 0) return "list_detail";
  if (fields.some((field) =>
    ["integer", "number"].includes(field.type)
    && ["progress", "meter"].includes(field.widget))) {
    return "progress";
  }
  return "fields";
}

function canSelectContentModulePanelSurface(surface, value = state.contentModuleDraft) {
  const fields = Array.isArray(value?.fields) ? value.fields : [];
  const hasRecord = fields.some((field) => field.type === "record_list");
  if (surface === "fields") return !hasRecord;
  if (surface === "progress") {
    const hasNumeric = fields.some((field) => ["integer", "number"].includes(field.type));
    return !hasRecord && (hasNumeric || fields.length < 32);
  }
  return hasRecord || fields.length < 32;
}

function applyContentModulePanelSurface(surface) {
  const draft = state.contentModuleDraft;
  if (!draft?.enabled || !CONTENT_MODULE_PANEL_SURFACES.some(([value]) => value === surface)
    || !canSelectContentModulePanelSurface(surface, draft)) {
    return;
  }
  if (surface === "fields") {
    for (const field of draft.fields) {
      if (["integer", "number"].includes(field.type) && ["progress", "meter"].includes(field.widget)) {
        field.widget = "number";
      }
    }
  } else if (surface === "progress") {
    let numeric = draft.fields.find((field) => ["integer", "number"].includes(field.type));
    if (!numeric && draft.fields.length < 32) {
      numeric = createDefaultContentModuleField("integer", isContentModuleFacadeDraft());
      draft.fields.push(numeric);
    }
    if (numeric) numeric.widget = "progress";
  } else {
    let record = draft.fields.find((field) => field.type === "record_list");
    if (!record && draft.fields.length < 32) {
      record = createDefaultContentModuleField("record_list", isContentModuleFacadeDraft());
      draft.fields.push(record);
    }
    if (record) {
      record.widget = surface === "timeline" ? "timeline" : "cards";
      if (surface === "list_detail") {
        for (const field of draft.fields) {
          if (field.type === "record_list" && field.widget === "timeline") field.widget = "cards";
        }
      }
    }
  }
  clearContentModulePanelPreview();
  renderContentModuleEditor();
  renderContentModulePreview();
}

function contentModulePanelSurfaceSelect(value, onValue, disabled, draft) {
  const select = document.createElement("select");
  select.className = "settings-select";
  for (const [surface, key] of CONTENT_MODULE_PANEL_SURFACES) {
    const option = document.createElement("option");
    option.value = surface;
    option.textContent = t(key);
    option.disabled = !canSelectContentModulePanelSurface(surface, draft);
    select.appendChild(option);
  }
  select.value = value;
  select.disabled = disabled;
  select.addEventListener("change", () => onValue(select.value));
  return select;
}

function clearContentModulePanelPreview() {
  state.contentModulePreviewProjection = null;
  state.contentModulePreviewPanelProjection = null;
  state.contentModulePreviewListProjection = null;
  state.contentModulePreviewDetailProjection = null;
  state.contentModulePreviewSurface = null;
}

function emptyContentModuleDraft() {
  return {
    schemaVersion: "grey-crow-skill-module-creator-draft-v2",
    enabled: false,
    skillIOEnabled: true,
    namespace: null,
    fields: [],
  };
}

function emptyContentModuleDraftFor(value) {
  return value?.schemaVersion === "grey-crow-skill-module-creator-draft-v1"
    ? { schemaVersion: "grey-crow-skill-module-creator-draft-v1", enabled: false, fields: [] }
    : emptyContentModuleDraft();
}

function cloneContentModuleDraft(value) {
  return JSON.parse(JSON.stringify(value || emptyContentModuleDraft()));
}

function createDefaultContentModuleField(type = "integer", facade = isContentModuleFacadeDraft()) {
  const defaultWidget = type === "integer"
    ? "progress"
    : type === "number"
      ? "meter"
      : CONTENT_MODULE_WIDGET_DEFINITIONS[type]?.[0]?.[0] || "text";
  const base = {
    id: null,
    label: t("creator.module.default.newField"),
    type,
    widget: defaultWidget,
    modelWritable: true,
    showInSummary: false,
    ...(facade ? {
      views: type === "record_list" ? ["overview", "recent", "lookup"] : ["overview"],
      hostAction: defaultContentModuleHostAction(type),
    } : {}),
  };
  if (type === "integer" || type === "number") return { ...base, minimum: 0, maximum: 10, default: 0, preview: 4 };
  if (type === "text") return { ...base, maxLength: 240, default: "", preview: t("creator.module.default.sampleState") };
  if (type === "boolean") return { ...base, default: false, preview: true };
  if (type === "enum") return {
    ...base,
    options: [
      { id: null, label: t("creator.module.default.notFound") },
      { id: null, label: t("creator.module.default.found") },
    ],
    defaultOptionIndex: 0,
    previewOptionIndex: 1,
  };
  if (type === "string_list") {
    return { ...base, maxItems: 8, itemMaxLength: 120, default: [], preview: [t("creator.module.default.firstClue")] };
  }
  return {
    ...base,
    maxItems: 20,
    collectionMode: "append_only",
    itemFields: [createDefaultContentModuleItemField("text")],
    previewRecordEnabled: true,
    summaryMode: "count",
    summaryTarget: null,
    milestones: [],
    groupCountItemIndex: null,
  };
}

function isContentModuleFacadeDraft(value = state.contentModuleDraft) {
  return value?.schemaVersion === "grey-crow-skill-module-creator-draft-v2";
}

function defaultContentModuleHostAction(type) {
  const behavior = type === "integer" || type === "number" ? "adjust_number"
    : type === "enum" ? "choose_enum"
      : type === "string_list" ? "change_list_item"
        : type === "record_list" ? "append_record" : "set_value";
  return { id: null, label: t("creator.module.facade.defaultAction"), behavior };
}

function createDefaultContentModuleItemField(type = "text") {
  const base = { id: null, label: t("creator.module.default.recordContent"), type };
  if (type === "integer" || type === "number") return { ...base, minimum: 0, maximum: 100, preview: 1 };
  if (type === "text") return { ...base, maxLength: 240, preview: t("creator.module.default.sampleRecord") };
  if (type === "boolean") return { ...base, preview: true };
  return {
    ...base,
    options: [
      { id: null, label: t("creator.module.default.clue") },
      { id: null, label: t("creator.module.default.character") },
    ],
    previewOptionIndex: 0,
  };
}

function toggleContentModuleDraft() {
  const item = state.editableContentItem;
  if (item?.type !== "skill" || item.skillClass !== "ordinary" || item.module?.creatorSupport === "read_only") return;
  if (ui.contentModuleEnabledInput.checked) {
    if (state.contentModuleSuspendedDraft) {
      state.contentModuleDraft = { ...cloneContentModuleDraft(state.contentModuleSuspendedDraft), enabled: true };
      state.contentModuleSuspendedDraft = null;
    } else {
      const facade = isContentModuleFacadeDraft();
      state.contentModuleDraft = {
        ...(facade ? {
          schemaVersion: "grey-crow-skill-module-creator-draft-v2",
          skillIOEnabled: true,
          namespace: state.contentModuleDraft?.namespace || null,
        } : { schemaVersion: "grey-crow-skill-module-creator-draft-v1" }),
        enabled: true,
        fields: [createDefaultContentModuleField("integer", facade)],
      };
    }
  } else {
    state.contentModuleSuspendedDraft = cloneContentModuleDraft(state.contentModuleDraft);
    state.contentModuleDraft = emptyContentModuleDraftFor(state.contentModuleDraft);
    clearContentModulePanelPreview();
  }
  renderContentModuleEditor();
  renderContentModulePreview();
}

function addContentModuleField() {
  if (!state.contentModuleDraft?.enabled || state.contentModuleDraft.fields.length >= 32 || state.contentManagementBusy) return;
  state.contentModuleDraft.fields.push(createDefaultContentModuleField("integer", isContentModuleFacadeDraft()));
  renderContentModuleEditor();
}

function renderContentModuleEditor() {
  const item = state.editableContentItem;
  const ordinary = item?.type === "skill" && item.skillClass === "ordinary";
  ui.contentModuleOrdinaryFields.classList.toggle("hidden", !ordinary);
  ui.contentModuleFieldList.parentElement
    ?.querySelector(".content-module-panel-surface-editor")
    ?.remove();
  if (!ordinary) {
    ui.contentModuleFieldList.replaceChildren();
    return;
  }
  const support = item.module?.creatorSupport || "available_v1";
  const readOnly = !["available_v1", "available_v2", "editable_v1", "editable_v2"].includes(support);
  const draft = state.contentModuleDraft || emptyContentModuleDraft();
  ui.contentModuleEnabledInput.checked = draft.enabled === true;
  ui.contentModuleEnabledInput.disabled = readOnly || state.contentManagementBusy;
  ui.contentModuleSupportStatus.textContent = readOnly
    ? t("creator.module.support.readOnly")
    : draft.enabled
      ? t("creator.module.support.enabled", { count: draft.fields.length })
      : t("creator.module.support.disabled");
  ui.contentModuleFieldList.replaceChildren();
  if (draft.enabled) {
    ui.contentModuleFieldList.before(renderContentModulePanelSurfaceEditor(draft, readOnly));
    draft.fields.forEach((field, index) => ui.contentModuleFieldList.append(renderContentModuleFieldEditor(field, index, readOnly)));
  }
  ui.addContentModuleFieldButton.classList.toggle("hidden", !draft.enabled || readOnly);
  ui.addContentModuleFieldButton.disabled = state.contentManagementBusy || draft.fields.length >= 32;
}

function renderContentModulePanelSurfaceEditor(draft, readOnly) {
  const card = document.createElement("article");
  card.className = "content-module-field-editor content-module-panel-surface-editor";
  const header = document.createElement("div");
  header.className = "content-module-field-editor-header";
  const surface = contentModulePanelSurface(draft);
  header.append(
    contentModuleLabeledControl(
      t("creator.module.surface.label"),
      contentModulePanelSurfaceSelect(
        surface,
        applyContentModulePanelSurface,
        readOnly || state.contentManagementBusy,
        draft
      )
    )
  );
  const note = document.createElement("p");
  note.className = "settings-hint";
  note.textContent = t(
    draft.fields.some((field) => field.type === "record_list")
      ? "creator.module.surface.recordLockedNote"
      : "creator.module.surface.note"
  );
  card.append(header, note);
  return card;
}

function renderContentModuleFieldEditor(field, index, readOnly) {
  const card = document.createElement("article");
  card.className = "content-module-field-editor";
  const header = document.createElement("div");
  header.className = "content-module-field-editor-header";
  header.append(
    contentModuleLabeledControl(t("creator.module.control.fieldName"), contentModuleTextInput(field.label, 120, (value) => { field.label = value; }, readOnly)),
    contentModuleLabeledControl(t("creator.module.control.fieldType"), contentModuleSelect(contentModuleFieldTypeOptions(), field.type, (value) => {
      state.contentModuleDraft.fields[index] = {
        ...createDefaultContentModuleField(value, isContentModuleFacadeDraft()),
        id: field.id || null,
        label: field.label || t("creator.module.default.newField"),
        modelWritable: field.modelWritable,
        showInSummary: field.showInSummary,
      };
      renderContentModuleEditor();
    }, readOnly)),
    contentModuleButton(t("creator.module.control.remove"), () => {
      state.contentModuleDraft.fields.splice(index, 1);
      if (!state.contentModuleDraft.fields.length) state.contentModuleDraft.fields.push(createDefaultContentModuleField());
      renderContentModuleEditor();
    }, readOnly)
  );
  card.append(header);

  const flags = document.createElement("div");
  flags.className = "content-module-flag-row";
  flags.append(
    contentModuleCheckbox(t("creator.module.control.modelWritable"), field.modelWritable, (checked) => {
      field.modelWritable = checked;
      if (isContentModuleFacadeDraft()) field.hostAction = checked ? (field.hostAction || defaultContentModuleHostAction(field.type)) : null;
      renderContentModuleEditor();
    }, readOnly),
    contentModuleCheckbox(t("creator.module.control.showSummary"), field.showInSummary, (checked, input) => {
      const selected = state.contentModuleDraft.fields.filter((entry) => entry.showInSummary).length;
      if (checked && selected >= 3) {
        input.checked = false;
        ui.contentModuleSupportStatus.textContent = t("creator.module.support.summaryLimit");
        return;
      }
      field.showInSummary = checked;
      renderContentModuleEditor();
    }, readOnly)
  );
  const widget = contentModuleSelect(contentModuleWidgetOptions(field.type), field.widget, (value) => {
    field.widget = value;
    clearContentModulePanelPreview();
    renderContentModuleEditor();
    renderContentModulePreview();
  }, readOnly);
  flags.append(contentModuleLabeledControl(t("creator.module.control.widget"), widget));
  card.append(flags);

  if (isContentModuleFacadeDraft()) card.append(renderContentModuleFacadeControls(field, readOnly));

  const details = document.createElement("div");
  details.className = "content-module-field-editor-grid";
  if (field.type === "integer" || field.type === "number") {
    const integer = field.type === "integer";
    details.append(
      contentModuleLabeledControl(t("creator.module.control.minimum"), contentModuleNumberInput(field.minimum, integer, (value) => { field.minimum = value; }, readOnly)),
      contentModuleLabeledControl(t("creator.module.control.maximum"), contentModuleNumberInput(field.maximum, integer, (value) => { field.maximum = value; }, readOnly)),
      contentModuleLabeledControl(t("creator.module.control.defaultNumber"), contentModuleNumberInput(field.default, integer, (value) => { field.default = value; }, readOnly)),
      contentModuleLabeledControl(t("creator.module.control.previewNumber"), contentModuleNumberInput(field.preview, integer, (value) => { field.preview = value; }, readOnly))
    );
  } else if (field.type === "text") {
    details.append(
      contentModuleLabeledControl(t("creator.module.control.maxLength"), contentModuleNumberInput(field.maxLength, true, (value) => { field.maxLength = value; }, readOnly, 1, 2000)),
      document.createElement("span"),
      contentModuleLabeledControl(t("creator.module.control.defaultText"), contentModuleTextarea(field.default, 4, (value) => { field.default = value; }, readOnly)),
      contentModuleLabeledControl(t("creator.module.control.previewText"), contentModuleTextarea(field.preview, 4, (value) => { field.preview = value; }, readOnly))
    );
  } else if (field.type === "boolean") {
    details.append(
      contentModuleLabeledControl(t("creator.module.control.defaultState"), contentModuleBooleanSelect(field.default, (value) => { field.default = value; }, readOnly)),
      contentModuleLabeledControl(t("creator.module.control.previewState"), contentModuleBooleanSelect(field.preview, (value) => { field.preview = value; }, readOnly))
    );
  } else if (field.type === "enum") {
    details.append(
      contentModuleLabeledControl(t("creator.module.control.options"), contentModuleTextarea(field.options.map((option) => option.label).join("\n"), 4, (value) => {
        field.options = mergeContentModuleOptions(field.options, value);
        field.defaultOptionIndex = clampContentModuleIndex(field.defaultOptionIndex, field.options.length);
        field.previewOptionIndex = clampContentModuleIndex(field.previewOptionIndex, field.options.length);
        renderContentModuleEditor();
      }, readOnly, "change")),
      document.createElement("span"),
      contentModuleLabeledControl(t("creator.module.control.defaultOption"), contentModuleOptionIndexSelect(field.options, field.defaultOptionIndex, (value) => { field.defaultOptionIndex = value; }, readOnly)),
      contentModuleLabeledControl(t("creator.module.control.previewOption"), contentModuleOptionIndexSelect(field.options, field.previewOptionIndex, (value) => { field.previewOptionIndex = value; }, readOnly))
    );
  } else if (field.type === "string_list") {
    details.append(
      contentModuleLabeledControl(t("creator.module.control.maxItems"), contentModuleNumberInput(field.maxItems, true, (value) => { field.maxItems = value; }, readOnly, 1, 64)),
      contentModuleLabeledControl(t("creator.module.control.itemMaxLength"), contentModuleNumberInput(field.itemMaxLength, true, (value) => { field.itemMaxLength = value; }, readOnly, 1, 240)),
      contentModuleLabeledControl(t("creator.module.control.defaultList"), contentModuleTextarea(field.default.join("\n"), 4, (value) => { field.default = contentModuleLines(value); }, readOnly)),
      contentModuleLabeledControl(t("creator.module.control.previewList"), contentModuleTextarea(field.preview.join("\n"), 4, (value) => { field.preview = contentModuleLines(value); }, readOnly))
    );
  } else {
    renderContentModuleRecordControls(details, field, index, readOnly);
  }
  card.append(details);

  const actions = document.createElement("div");
  actions.className = "content-module-field-actions";
  if (index > 0) actions.append(contentModuleButton(t("creator.module.control.moveUp"), () => moveContentModuleField(index, index - 1), readOnly));
  if (index < state.contentModuleDraft.fields.length - 1) actions.append(contentModuleButton(t("creator.module.control.moveDown"), () => moveContentModuleField(index, index + 1), readOnly));
  card.append(actions);
  return card;
}

function renderContentModuleFacadeControls(field, readOnly) {
  const controls = document.createElement("div");
  controls.className = "content-module-flag-row";
  const availableViews = field.type === "record_list" ? ["overview", "recent", "lookup"] : ["overview"];
  for (const view of availableViews) {
    controls.append(contentModuleCheckbox(t(`creator.module.facade.view.${view}`), (field.views || []).includes(view), (checked) => {
      const next = new Set(field.views || []);
      if (checked) next.add(view); else next.delete(view);
      field.views = availableViews.filter((entry) => next.has(entry));
    }, readOnly));
  }
  if (field.modelWritable) {
    const behaviors = field.type === "integer" || field.type === "number"
      ? ["set_value", "adjust_number"]
      : [defaultContentModuleHostAction(field.type).behavior];
    const action = field.hostAction || defaultContentModuleHostAction(field.type);
    field.hostAction = action;
    controls.append(
      contentModuleLabeledControl(t("creator.module.facade.actionBehavior"), contentModuleSelect(
        behaviors.map((behavior) => [behavior, t(`creator.module.facade.action.${behavior}`)]),
        action.behavior,
        (value) => { action.behavior = value; },
        readOnly
      )),
      contentModuleLabeledControl(t("creator.module.facade.actionLabel"), contentModuleTextInput(
        action.label,
        120,
        (value) => { action.label = value; },
        readOnly
      ))
    );
  }
  return controls;
}

function renderContentModuleRecordControls(container, field, fieldIndex, readOnly) {
  container.append(
    contentModuleLabeledControl(t("creator.module.record.maxItems"), contentModuleNumberInput(field.maxItems, true, (value) => { field.maxItems = value; }, readOnly, 1, 100)),
    contentModuleLabeledControl(t("creator.module.record.operations"), contentModuleSelect([
      ["append_only", t("creator.module.record.appendOnly")],
      ["maintain", t("creator.module.record.maintain")],
      ["maintain_clear", t("creator.module.record.maintainClear")],
    ], field.collectionMode, (value) => { field.collectionMode = value; }, readOnly)),
    contentModuleLabeledControl(t("creator.module.record.summary"), contentModuleSelect([
      ["none", t("creator.module.record.noCount")],
      ["count", t("creator.module.record.count")],
      ["count_progress", t("creator.module.record.countProgress")],
    ], field.summaryMode, (value) => { field.summaryMode = value; renderContentModuleEditor(); }, readOnly)),
    contentModuleLabeledControl(t("creator.module.record.target"), contentModuleNumberInput(field.summaryTarget || Math.min(field.maxItems, 10), true, (value) => { field.summaryTarget = value; }, readOnly || field.summaryMode !== "count_progress", 1, 100)),
    contentModuleLabeledControl(t("creator.module.record.milestones"), contentModuleTextarea(formatContentModuleMilestones(field.milestones), 3, (value) => { field.milestones = parseContentModuleMilestones(value); }, readOnly)),
    contentModuleLabeledControl(t("creator.module.record.group"), contentModuleRecordGroupSelect(field, (value) => { field.groupCountItemIndex = value; }, readOnly)),
    contentModuleCheckbox(t("creator.module.record.preview"), field.previewRecordEnabled, (checked) => { field.previewRecordEnabled = checked; }, readOnly)
  );

  const itemList = document.createElement("div");
  itemList.className = "content-module-item-list";
  field.itemFields.forEach((item, itemIndex) => itemList.append(renderContentModuleItemEditor(field, item, fieldIndex, itemIndex, readOnly)));
  const addItem = contentModuleButton(t("creator.module.record.addField"), () => {
    if (field.itemFields.length >= 12) return;
    field.itemFields.push(createDefaultContentModuleItemField());
    renderContentModuleEditor();
  }, readOnly || field.itemFields.length >= 12);
  itemList.append(addItem);
  container.append(itemList);
}

function renderContentModuleItemEditor(parent, item, fieldIndex, itemIndex, readOnly) {
  const wrapper = document.createElement("div");
  wrapper.className = "content-module-item-editor";
  const header = document.createElement("div");
  header.className = "content-module-item-header";
  header.append(
    contentModuleLabeledControl(t("creator.module.record.fieldName"), contentModuleTextInput(item.label, 120, (value) => { item.label = value; }, readOnly)),
    contentModuleLabeledControl(t("creator.module.control.fieldType"), contentModuleSelect(contentModuleFieldTypeOptions({ itemOnly: true }), item.type, (value) => {
      parent.itemFields[itemIndex] = {
        ...createDefaultContentModuleItemField(value),
        id: item.id || null,
        label: item.label || t("creator.module.default.recordContent"),
      };
      parent.groupCountItemIndex = null;
      renderContentModuleEditor();
    }, readOnly)),
    contentModuleButton(t("creator.module.control.remove"), () => {
      parent.itemFields.splice(itemIndex, 1);
      parent.groupCountItemIndex = null;
      if (!parent.itemFields.length) parent.itemFields.push(createDefaultContentModuleItemField());
      renderContentModuleEditor();
    }, readOnly)
  );
  wrapper.append(header);
  const details = document.createElement("div");
  details.className = "content-module-field-editor-grid";
  if (item.type === "integer" || item.type === "number") {
    const integer = item.type === "integer";
    details.append(
      contentModuleLabeledControl(t("creator.module.control.minimum"), contentModuleNumberInput(item.minimum, integer, (value) => { item.minimum = value; }, readOnly)),
      contentModuleLabeledControl(t("creator.module.control.maximum"), contentModuleNumberInput(item.maximum, integer, (value) => { item.maximum = value; }, readOnly)),
      contentModuleLabeledControl(t("creator.module.control.previewNumber"), contentModuleNumberInput(item.preview, integer, (value) => { item.preview = value; }, readOnly))
    );
  } else if (item.type === "text") {
    details.append(
      contentModuleLabeledControl(t("creator.module.control.maxLength"), contentModuleNumberInput(item.maxLength, true, (value) => { item.maxLength = value; }, readOnly, 1, 2000)),
      contentModuleLabeledControl(t("creator.module.control.previewText"), contentModuleTextarea(item.preview, 3, (value) => { item.preview = value; }, readOnly))
    );
  } else if (item.type === "boolean") {
    details.append(contentModuleLabeledControl(t("creator.module.control.previewState"), contentModuleBooleanSelect(item.preview, (value) => { item.preview = value; }, readOnly)));
  } else {
    details.append(
      contentModuleLabeledControl(t("creator.module.control.options"), contentModuleTextarea(item.options.map((option) => option.label).join("\n"), 3, (value) => {
        item.options = mergeContentModuleOptions(item.options, value);
        item.previewOptionIndex = clampContentModuleIndex(item.previewOptionIndex, item.options.length);
        renderContentModuleEditor();
      }, readOnly, "change")),
      contentModuleLabeledControl(t("creator.module.control.previewOption"), contentModuleOptionIndexSelect(item.options, item.previewOptionIndex, (value) => { item.previewOptionIndex = value; }, readOnly))
    );
  }
  wrapper.append(details);
  const order = document.createElement("div");
  order.className = "content-module-field-actions";
  const role = document.createElement("span");
  role.className = "settings-hint";
  role.textContent = t(itemIndex === 0
    ? "creator.module.record.roleTitle"
    : "creator.module.record.roleDetail", { order: itemIndex + 1 });
  order.appendChild(role);
  if (itemIndex > 0) {
    order.append(contentModuleButton(
      t("creator.module.control.moveUp"),
      () => moveContentModuleItemField(parent, itemIndex, itemIndex - 1),
      readOnly
    ));
  }
  if (itemIndex < parent.itemFields.length - 1) {
    order.append(contentModuleButton(
      t("creator.module.control.moveDown"),
      () => moveContentModuleItemField(parent, itemIndex, itemIndex + 1),
      readOnly
    ));
  }
  wrapper.append(order);
  return wrapper;
}

function moveContentModuleField(from, to) {
  const [field] = state.contentModuleDraft.fields.splice(from, 1);
  state.contentModuleDraft.fields.splice(to, 0, field);
  renderContentModuleEditor();
}

function moveContentModuleItemField(parent, from, to) {
  const groupedFieldId = Number.isInteger(parent.groupCountItemIndex)
    ? parent.itemFields[parent.groupCountItemIndex]?.id || null
    : null;
  const [field] = parent.itemFields.splice(from, 1);
  parent.itemFields.splice(to, 0, field);
  parent.groupCountItemIndex = groupedFieldId
    ? parent.itemFields.findIndex((entry) => entry.id === groupedFieldId)
    : null;
  if (parent.groupCountItemIndex < 0) parent.groupCountItemIndex = null;
  clearContentModulePanelPreview();
  renderContentModuleEditor();
  renderContentModulePreview();
}

function contentModuleLabeledControl(text, control) {
  const label = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = text;
  label.append(title, control);
  return label;
}

function contentModuleTextInput(value, maxLength, onValue, disabled) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-input";
  input.value = value ?? "";
  input.maxLength = maxLength;
  input.disabled = disabled;
  input.addEventListener("input", () => onValue(input.value));
  return input;
}

function contentModuleTextarea(value, rows, onValue, disabled, eventName = "input") {
  const input = document.createElement("textarea");
  input.className = "settings-textarea";
  input.rows = rows;
  input.value = value ?? "";
  input.disabled = disabled;
  input.addEventListener(eventName, () => onValue(input.value));
  return input;
}

function contentModuleNumberInput(value, integer, onValue, disabled, minimum = -1_000_000_000, maximum = 1_000_000_000) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "settings-input";
  input.value = Number.isFinite(value) ? String(value) : "";
  input.step = integer ? "1" : "any";
  input.min = String(minimum);
  input.max = String(maximum);
  input.disabled = disabled;
  input.addEventListener("input", () => {
    if (Number.isFinite(input.valueAsNumber)) onValue(integer ? Math.trunc(input.valueAsNumber) : input.valueAsNumber);
  });
  return input;
}

function contentModuleSelect(options, value, onValue, disabled) {
  const select = document.createElement("select");
  select.className = "settings-select";
  for (const [optionValue, label] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.append(option);
  }
  select.value = value;
  select.disabled = disabled;
  select.addEventListener("change", () => onValue(select.value));
  return select;
}

function contentModuleBooleanSelect(value, onValue, disabled) {
  return contentModuleSelect(
    [["false", t("common.off")], ["true", t("common.on")]],
    String(value === true),
    (next) => onValue(next === "true"),
    disabled
  );
}

function contentModuleOptionIndexSelect(options, value, onValue, disabled) {
  const select = contentModuleSelect(options.map((option, index) => [String(index), option.label]), String(clampContentModuleIndex(value, options.length)), (next) => onValue(Number.parseInt(next, 10)), disabled);
  return select;
}

function contentModuleRecordGroupSelect(field, onValue, disabled) {
  const options = [
    ["-1", t("creator.module.record.noGroup")],
    ...field.itemFields.flatMap((item, index) => item.type === "enum" ? [[String(index), item.label]] : []),
  ];
  return contentModuleSelect(options, field.groupCountItemIndex === null ? "-1" : String(field.groupCountItemIndex), (value) => onValue(value === "-1" ? null : Number.parseInt(value, 10)), disabled);
}

function contentModuleCheckbox(text, checked, onValue, disabled) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked === true;
  input.disabled = disabled;
  input.addEventListener("change", () => onValue(input.checked, input));
  const title = document.createElement("span");
  title.textContent = text;
  label.append(input, title);
  return label;
}

function contentModuleButton(text, onClick, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button compact";
  button.textContent = text;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function contentModuleLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function mergeContentModuleOptions(previous, value) {
  return contentModuleLines(value).slice(0, 32).map((label, index) => ({
    id: previous[index]?.label === label ? previous[index].id || null : null,
    label,
  }));
}

function clampContentModuleIndex(value, length) {
  if (!length) return 0;
  return Math.max(0, Math.min(length - 1, Number.isInteger(value) ? value : 0));
}

function parseContentModuleMilestones(value) {
  return contentModuleLines(value).slice(0, 16).map((line) => {
    const match = line.match(/^(\d+)\s*[:：]\s*(.+)$/);
    return match ? { minimum: Number.parseInt(match[1], 10), label: match[2].trim() } : { minimum: -1, label: line };
  });
}

function formatContentModuleMilestones(value) {
  return (value || []).map((item) => `${item.minimum}: ${item.label}`).join("\n");
}

function contentEditorPlaceholder(type) {
  if (type === "host") return t("creator.editor.placeholder.host");
  if (type === "world") return t("creator.editor.placeholder.world");
  return t("creator.editor.placeholder.skill");
}

function formatSkillTrigger(item) {
  return (item.triggers || []).join("；");
}

function renderContentEditorPreview() {
  const item = state.editableContentItem;
  if (!item) {
    ui.contentEditorPreview.textContent = t("creator.preview.empty");
    return;
  }
  const title = ui.contentEditorTitleInput.value.trim() || t("creator.preview.untitled");
  const language = ui.contentEditorLanguageInput.value.trim() || t("creator.preview.languageUnset");
  const trigger = item.type === "skill" && item.skillClass !== "new_game"
    ? ui.contentEditorTriggersInput.value.trim()
    : "";
  const parts = [
    t("creator.preview.heading", { type: contentItemTypeLabel(item.type), title }),
    t("creator.preview.language", { language }),
  ];
  if (trigger) parts.push(t("creator.preview.trigger", { trigger }));
  parts.push("", ui.contentEditorMarkdownInput.value || t("creator.preview.bodyMissing"));
  ui.contentEditorPreview.textContent = parts.join("\n");
}

async function previewContentEditor() {
  renderContentEditorPreview();
  const item = state.editableContentItem;
  const ordinary = item?.type === "skill" && item.skillClass === "ordinary";
  if (!ordinary) {
    clearContentModulePanelPreview();
    renderContentModulePreview();
    return;
  }
  if (!state.contentModuleDraft?.enabled) {
    clearContentModulePanelPreview();
    renderContentModulePreview();
    ui.contentEditorStatus.textContent = t("creator.preview.noModule");
    return;
  }
  if (item.module?.creatorSupport === "read_only") {
    ui.contentEditorStatus.textContent = t("creator.preview.readOnlyModule");
    return;
  }
  ui.contentModulePreview.classList.remove("hidden");
  ui.contentModulePreviewSummary.textContent = t("creator.preview.moduleChecking");
  ui.contentModulePreviewFields.replaceChildren();
  try {
    const markdown = ui.contentEditorMarkdownInput.value;
    const trigger = ui.contentEditorTriggersInput.value.trim();
    const result = await window.greyCrow.previewSkillModule({
      title: ui.contentEditorTitleInput.value.trim() || t("creator.preview.untitledSkill"),
      language: ui.contentEditorLanguageInput.value.trim() || item.language || "en-US",
      description: deriveContentDescription(markdown, item.description) || t("creator.preview.localModule"),
      playerGuide: ui.contentEditorPlayerGuideInput.value,
      triggers: trigger ? [trigger] : [],
      moduleDraft: cloneContentModuleDraft(state.contentModuleDraft),
    });
    if (!result?.ok) {
      clearContentModulePanelPreview();
      ui.contentModulePreviewSummary.textContent = formatContentOperationError(
        result?.error,
        "creator.preview.moduleInvalid"
      );
      return;
    }
    state.contentModuleDraft = cloneContentModuleDraft(result.draft);
    state.contentModulePreviewProjection = result.projection || null;
    state.contentModulePreviewPanelProjection = result.panelProjection || null;
    state.contentModulePreviewListProjection = result.panelListProjection || null;
    state.contentModulePreviewDetailProjection = result.panelDetailProjection || null;
    state.contentModulePreviewSurface = result.panelSurface || null;
    renderContentModuleEditor();
    renderContentModulePreview();
    ui.contentEditorStatus.textContent = t("creator.preview.updated");
  } catch (error) {
    clearContentModulePanelPreview();
    ui.contentModulePreviewSummary.textContent = t("creator.preview.moduleFailed");
  }
}

function renderContentModulePreview() {
  const item = state.editableContentItem;
  const ordinary = item?.type === "skill" && item.skillClass === "ordinary";
  const enabled = ordinary && state.contentModuleDraft?.enabled;
  ui.contentModulePreview.classList.toggle("hidden", !enabled);
  ui.contentModulePreviewFields.replaceChildren();
  if (!enabled) return;
  const projection = state.contentModulePreviewProjection;
  if (!projection) {
    ui.contentModulePreviewSummary.textContent = t("creator.preview.moduleInitial");
    return;
  }
  const panelProjection = state.contentModulePreviewPanelProjection;
  const summary = panelProjection?.summary?.length
    ? panelProjection.summary.map((entry) => entry.text).join(" · ")
    : t("creator.preview.noSummary");
  const facade = projection.skillIO?.enabled
    ? t("creator.preview.facadeSummary", {
        views: formatUiList(projection.skillIO.readViews),
        actions: projection.skillIO.actions.length,
      })
    : t("creator.preview.facadeDisabled");
  const surface = state.contentModulePreviewSurface || contentModulePanelSurface();
  ui.contentModulePreviewSummary.textContent = [
    t("creator.preview.panelSurface", { surface: t(`creator.module.surface.${surface === "list_detail" ? "listDetail" : surface}`) }),
    summary,
    facade,
  ].join("\n");
  if (panelProjection) {
    renderStoryNotebookPanelFields(panelProjection.fields, ui.contentModulePreviewFields);
    renderContentModulePanelRecordPreview(
      state.contentModulePreviewListProjection,
      state.contentModulePreviewDetailProjection,
      ui.contentModulePreviewFields
    );
  } else {
    renderSkillModuleFields(projection, {
      container: ui.contentModulePreviewFields,
      pages: new Map(),
      interactive: false,
    });
  }
}

function renderContentModulePanelRecordPreview(listProjection, detailProjection, container) {
  if (!listProjection) return;
  const records = document.createElement("div");
  records.className = `story-notebook-panel-record-list${state.contentModulePreviewSurface === "timeline" ? " is-timeline" : ""}`;
  for (const item of listProjection.items || []) {
    const card = document.createElement("article");
    card.className = "story-notebook-panel-record";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const subtitle = document.createElement("span");
    subtitle.textContent = item.subtitle || t("game.notebook.panelNoSubtitle");
    card.append(title, subtitle);
    if (item.statusLabel || Number.isInteger(item.updatedTurn)) {
      const meta = document.createElement("small");
      meta.textContent = [
        item.statusLabel,
        Number.isInteger(item.updatedTurn)
          ? t("game.notebook.panelUpdatedTurn", { turn: item.updatedTurn })
          : "",
      ].filter(Boolean).join(" · ");
      card.appendChild(meta);
    }
    records.appendChild(card);
  }
  container.appendChild(records);
  const detailFields = detailProjection?.detail?.sections?.flatMap((section) => section.fields || []) || [];
  if (!detailFields.length) return;
  const detail = document.createElement("div");
  detail.className = "skill-module-fields story-notebook-panel-fields";
  renderStoryNotebookPanelFields(detailFields, detail);
  container.appendChild(detail);
}

async function saveEditableContentItem() {
  const pack = selectedContentPack();
  const item = state.editableContentItem;
  const creatingBlank = item?.isNew === true;
  if (!item || state.contentManagementBusy) return;
  if (!creatingBlank && (!pack?.editable || item.packId !== pack.id)) return;
  const markdown = ui.contentEditorMarkdownInput.value;
  const triggerText = item.type === "skill" && item.skillClass !== "new_game"
    ? ui.contentEditorTriggersInput.value.trim()
    : "";
  const originalTriggerText = formatSkillTrigger(item);
  const payload = {
    packId: item.packId,
    itemId: item.itemId,
    expectedRevision: item.revision,
    title: ui.contentEditorTitleInput.value.trim(),
    language: ui.contentEditorLanguageInput.value.trim(),
    description: deriveContentDescription(markdown, item.description),
    danger: item.danger || "medium",
    markdown,
    triggers: item.type !== "skill"
      ? []
      : item.skillClass === "new_game" || triggerText === originalTriggerText
        ? [...(item.triggers || [])]
        : triggerText ? [triggerText] : [],
    readScopes: item.type === "skill" ? [...(item.readScopes || [])] : [],
    writeScopes: item.type === "skill" ? [...(item.writeScopes || [])] : [],
    templates: item.type === "skill"
      ? (item.templates || []).map((template) => ({ templateId: template.templateId, markdown: template.markdown }))
      : [],
  };
  if (item.type === "skill" && item.skillClass === "ordinary") {
    payload.playerGuide = ui.contentEditorPlayerGuideInput.value;
    if (item.module?.creatorSupport !== "read_only") payload.moduleDraft = cloneContentModuleDraft(state.contentModuleDraft);
  }
  if (!payload.title || !payload.language || !payload.description || !payload.markdown.trim()) {
    ui.contentEditorStatus.textContent = t("creator.content.invalid");
    return;
  }
  if (triggerText.length > 120) {
    ui.contentEditorStatus.textContent = t("creator.content.triggerTooLong");
    return;
  }
  setContentManagementBusy(true);
  ui.contentEditorStatus.textContent = creatingBlank
    ? t("creator.content.creating")
    : t("creator.content.saving");
  try {
    const result = creatingBlank
      ? await window.greyCrow.createBlankContent({
          kind: item.blankKind,
          title: payload.title,
          language: payload.language,
          description: payload.description,
          markdown: payload.markdown,
          triggers: item.skillClass === "ordinary" ? payload.triggers : [],
          ...(item.skillClass === "ordinary" ? {
            playerGuide: payload.playerGuide,
            moduleDraft: payload.moduleDraft,
          } : {}),
        })
      : await window.greyCrow.saveEditableContent(payload);
    if (!result?.ok) {
      ui.contentEditorStatus.textContent = formatContentOperationError(
        result?.error,
        creatingBlank ? "creator.content.createFailed" : "creator.content.saveFailed"
      );
      return;
    }
    state.selectedContentPackId = result.item.packId;
    applyContentLibrary(result.library);
    applyEditableContentItem(result.item);
    ui.contentEditorStatus.textContent = creatingBlank
      ? t("creator.content.created")
      : t("creator.content.saved", { version: result.item.packVersion });
  } catch (error) {
    ui.contentEditorStatus.textContent = t(creatingBlank
      ? "creator.content.createFailed"
      : "creator.content.saveFailed");
  } finally {
    setContentManagementBusy(false);
  }
}

function deriveContentDescription(markdown, fallback) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let inFrontmatter = lines[0]?.trim() === "---";
  const paragraph = [];
  for (let index = inFrontmatter ? 1 : 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (inFrontmatter) {
      if (trimmed === "---") inFrontmatter = false;
      continue;
    }
    if (!trimmed) {
      if (paragraph.length) break;
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed) || /^```/.test(trimmed)) continue;
    const plain = trimmed
      .replace(/^[-*>+]\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
    if (plain) paragraph.push(plain);
  }
  return (paragraph.join(" ").trim() || String(fallback || "").trim()).slice(0, 1200);
}

function contentItemTypeLabel(value) {
  return value === "host"
    ? t("creator.preset.host")
    : value === "world"
      ? t("creator.preset.world")
      : value === "skill"
        ? "Skill"
        : t("creator.library.item");
}

function applyPlayerProfile(profile = {}, persistence = {}) {
  state.playerProfile = profile;
  ui.playerProfileLanguageInput.value = profile.preferredLanguage || "zh-CN";
  ui.playerProfileNameInput.value = profile.displayName || "";
  ui.playerProfilePronounsInput.value = profile.pronouns || "";
  ui.playerProfileNarrativeInput.value = (profile.narrativePreferences || []).join("\n");
  ui.playerProfileBoundariesInput.value = (profile.contentBoundaries || []).join("\n");
  ui.playerProfileNotesInput.value = profile.notes || "";
  ui.playerProfileStatus.textContent = persistence?.warning
    ? t("settings.content.profile.recovered", { reason: contentErrorLabel(persistence.warning) })
    : t("settings.content.profile.loaded", {
        id: profile.playerProfileId || t("settings.content.profile.notCreated"),
      });
}

async function cloneContentPack() {
  const source = selectedContentPack();
  if (!source || state.contentManagementBusy) return;
  if (source.activation === "quarantined") {
    ui.contentLibraryStatus.textContent = t("settings.content.clone.quarantined");
    return;
  }
  const input = {
    packId: source.id,
    newPackId: ui.cloneContentPackIdInput.value.trim(),
    title: ui.cloneContentPackTitleInput.value.trim(),
    author: ui.cloneContentPackAuthorInput.value.trim() || "Player",
  };
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(input.newPackId) || !input.title) {
    ui.contentLibraryStatus.textContent = t("settings.content.clone.invalid");
    return;
  }
  setContentManagementBusy(true);
  ui.contentLibraryStatus.textContent = t("settings.content.clone.creating");
  try {
    const result = await window.greyCrow.cloneContentPack(input);
    if (!result?.ok) {
      ui.contentLibraryStatus.textContent = formatContentOperationError(result?.error, "settings.content.clone.failed");
      return;
    }
    applyContentLibrary(result.library);
    state.selectedContentPackId = result.pack?.id || input.newPackId;
    renderContentLibrary();
    ui.contentLibraryStatus.textContent = t("settings.content.clone.created", {
      title: result.pack?.title || input.title,
    });
  } catch (error) {
    ui.contentLibraryStatus.textContent = t("settings.content.clone.failed");
  } finally {
    setContentManagementBusy(false);
  }
}

async function exportContentPack() {
  const selected = selectedContentPack();
  if (!selected || state.contentManagementBusy) return;
  setContentManagementBusy(true);
  ui.contentLibraryStatus.textContent = t("settings.content.export.choose");
  try {
    const result = await window.greyCrow.exportContentPack(selected.id);
    if (!result?.ok) {
      ui.contentLibraryStatus.textContent = formatContentOperationError(result?.error, "settings.content.export.failed");
      return;
    }
    ui.contentLibraryStatus.textContent = result.canceled
      ? t("settings.content.export.canceled")
      : t("settings.content.export.done", {
          title: selected.title || selected.id,
          count: result.files || 0,
        });
  } catch (error) {
    ui.contentLibraryStatus.textContent = t("settings.content.export.failed");
  } finally {
    setContentManagementBusy(false);
  }
}

async function deleteContentPack() {
  const selected = selectedContentPack();
  if (!selected || selected.ownership === "built_in" || state.contentManagementBusy) return;
  if (!window.confirm(t("settings.content.delete.confirm", { title: selected.title || selected.id }))) return;
  setContentManagementBusy(true);
  try {
    const result = await window.greyCrow.deleteContentPack(selected.id);
    if (!result?.ok) {
      ui.contentLibraryStatus.textContent = formatContentOperationError(result?.error, "settings.content.delete.failed");
      return;
    }
    state.selectedContentPackId = null;
    applyContentLibrary(result.library);
    ui.contentLibraryStatus.textContent = t("settings.content.delete.done", { title: selected.title || selected.id });
  } catch (error) {
    ui.contentLibraryStatus.textContent = t("settings.content.delete.failed");
  } finally {
    setContentManagementBusy(false);
  }
}

async function savePlayerProfile() {
  if (state.contentManagementBusy) return;
  const fields = {
    preferredLanguage: ui.playerProfileLanguageInput.value.trim() || "zh-CN",
    displayName: ui.playerProfileNameInput.value.trim(),
    pronouns: ui.playerProfilePronounsInput.value.trim(),
    narrativePreferences: parseProfileList(ui.playerProfileNarrativeInput.value),
    contentBoundaries: parseProfileList(ui.playerProfileBoundariesInput.value),
    notes: ui.playerProfileNotesInput.value.trim(),
  };
  setContentManagementBusy(true);
  ui.playerProfileStatus.textContent = t("settings.content.profile.saving");
  try {
    const result = await window.greyCrow.savePlayerProfile(fields);
    if (!result?.ok) {
      ui.playerProfileStatus.textContent = formatContentOperationError(result?.error, "settings.content.profile.saveFailed");
      return;
    }
    applyPlayerProfile(result.profile, result.persistence);
    ui.playerProfileStatus.textContent = t("settings.content.profile.saved");
  } catch (error) {
    ui.playerProfileStatus.textContent = t("settings.content.profile.saveFailed");
  } finally {
    setContentManagementBusy(false);
  }
}

function setContentManagementBusy(value) {
  state.contentManagementBusy = Boolean(value);
  for (const control of [
    ui.contentPackSelect,
    ui.contentCreatorPackSelect,
    ui.contentCreatorModeContent,
    ui.contentCreatorModePreset,
    ui.refreshContentLibraryButton,
    ui.cloneContentPackButton,
    ui.exportContentPackButton,
    ui.deleteContentPackButton,
    ui.contentEditorItemSelect,
    ui.loadContentEditorButton,
    ui.newBlankContentButton,
    ui.closeBlankContentPickerButton,
    ...ui.blankContentKindButtons,
    ui.cancelBlankContentButton,
    ui.toggleContentAdvancedInfoButton,
    ui.newContentPresetButton,
    ui.previewContentEditorButton,
    ui.saveContentEditorButton,
    ui.previewContentPresetButton,
    ui.saveContentPresetButton,
    ui.contentPresetTitleInput,
    ui.contentPresetLanguageInput,
    ui.contentPresetDescriptionInput,
    ui.contentPresetHostSelect,
    ui.contentPresetWorldSelect,
    ui.contentPresetNewGameSkillSelect,
    ui.savePlayerProfileButton,
  ]) {
    control.disabled = state.contentManagementBusy;
  }
  if (!state.contentManagementBusy) renderContentLibrary();
  renderContentModuleEditor();
}

function selectedContentPack() {
  return (state.contentLibrary?.packs || []).find((item) => item.id === state.selectedContentPackId) || null;
}

function parseProfileList(value) {
  return [...new Set(String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].slice(0, 20);
}

function contentOwnershipLabel(value, activation) {
  if (value === "built_in") return t("settings.content.ownership.builtIn");
  if (value === "player_owned") return t("settings.content.ownership.playerOwned");
  return activation === "quarantined"
    ? t("settings.content.ownership.quarantined")
    : t("settings.content.ownership.imported");
}

function contentErrorLabel(code) {
  const keys = {
    PACK_SYMLINK_FORBIDDEN: "settings.content.error.PACK_SYMLINK_FORBIDDEN",
    PACK_MANIFEST_MISSING: "settings.content.error.PACK_MANIFEST_MISSING",
    PACK_MANIFEST_INVALID_JSON: "settings.content.error.PACK_MANIFEST_INVALID_JSON",
    CONTENT_IMPORT_DISABLED: "settings.content.error.CONTENT_IMPORT_DISABLED",
    CONTENT_PACK_QUARANTINED: "settings.content.error.CONTENT_PACK_QUARANTINED",
    CONTENT_PRESET_STALE: "settings.content.error.CONTENT_PRESET_STALE",
    CONTENT_PRESET_LANGUAGE_MISMATCH: "settings.content.error.CONTENT_PRESET_LANGUAGE_MISMATCH",
    CONTENT_PRESET_SELECTION_INVALID: "settings.content.error.CONTENT_PRESET_SELECTION_INVALID",
    CONTENT_PRESET_NOT_FOUND: "settings.content.error.CONTENT_PRESET_NOT_FOUND",
    PLAYER_PROFILE_RECOVERED_DEFAULT: "settings.content.error.PLAYER_PROFILE_RECOVERED_DEFAULT",
    PLAYER_PROFILE_METADATA_RECOVERED: "settings.content.error.PLAYER_PROFILE_METADATA_RECOVERED",
  };
  return keys[code] ? t(keys[code]) : code || t("settings.content.validation.failed");
}

function formatContentOperationError(error, fallbackKey) {
  const code = error?.code ? String(error.code) : "";
  const knownMessage = code && UI_I18N.has(`settings.content.error.${code}`)
    ? t(`settings.content.error.${code}`)
    : t(fallbackKey);
  return code ? `[${code}] ${knownMessage}` : knownMessage;
}

function openSettings(message, options = {}) {
  invalidateStoryNotebookNavigation();
  if (!ui.settingsDialog.open) {
    state.connectionDraft = { provider: state.provider, model: state.model, connectionId: state.connectionId };
    renderProviderOptions(); renderCustomConnectionSettings({ populateFields: true }); renderCredentialSettings();
  }
  if (message) {
    ui.settingsStatus.textContent = message;
  } else {
    renderSettingsStatus();
  }
  renderAudioSettings();
  renderContextPolicyStatus();
  switchSettingsTab(options.tab || inferSettingsTabFromMessage(message));
  ui.settingsDialog.showModal();
  speechInputController?.settingsOpened();
  focusActiveSettingsTab();
  if (state.debugPanelEnabled && state.keyVerified && state.gameStarted && state.activeSaveId) {
    refreshAdvancedMetrics({ silent: true });
  } else {
    renderAdvancedMetrics();
  }
}

async function openContentCreator() {
  if (ui.settingsDialog.open && !(await closeSettings())) return;
  resetContentCreatorEntry();
  ui.contentCreatorDialog.showModal();
  ui.acknowledgeContentCreatorButton.focus();
  if (!state.contentLibrary || !state.playerProfile) {
    void refreshContentManagement();
  }
}

function acknowledgeContentCreatorWarning() {
  state.contentCreatorAcknowledged = true;
  ui.contentCreatorWarning.classList.add("hidden");
  ui.contentCreatorWorkspace.classList.remove("hidden");
  const editablePacks = (state.contentLibrary?.packs || []).filter((item) => item.editable && item.status === "valid");
  if (!editablePacks.some((item) => item.id === state.selectedContentPackId)) {
    state.selectedContentPackId = editablePacks[0]?.id || null;
    state.editableContentItem = null;
    state.editableContentPreset = null;
  }
  renderContentLibrary();
  ui.contentEditorStatus.textContent = editablePacks.length
    ? t("creator.status.chooseEditable")
    : t("creator.status.noPlayerPacks");
  (editablePacks.length ? ui.contentEditorItemSelect : ui.newBlankContentButton).focus();
}

function closeContentCreator() {
  if (ui.contentCreatorDialog.open) ui.contentCreatorDialog.close();
}

function resetContentCreatorEntry() {
  state.contentCreatorAcknowledged = false;
  state.editableContentItem = null;
  state.editableContentPreset = null;
  state.contentCreatorMode = "content";
  state.blankContentPickerOpen = false;
  state.contentAdvancedInfoOpen = false;
  ui.contentEditorStatus.textContent = t("creator.status.initial");
  ui.contentCreatorWarning.classList.remove("hidden");
  ui.contentCreatorWorkspace.classList.add("hidden");
  ui.blankContentPicker.classList.add("hidden");
  ui.contentAdvancedInfoPanel.classList.add("hidden");
  ui.contentAdvancedInfoList.replaceChildren();
  ui.contentEditorForm.classList.add("hidden");
  ui.contentPresetForm.classList.add("hidden");
  ui.contentEditorPreview.textContent = t("creator.preview.empty");
  ui.contentPresetPreview.textContent = t("creator.preview.empty");
}

function openContentPackSettings() {
  closeContentCreator();
  openSettings(t("creator.status.managePacks"), { tab: "content" });
}

function forceCloseSettings() {
  clearApiKeyInput();
  state.connectionDraft = null;
  if (state.settingsAutosaveTimer) window.clearTimeout(state.settingsAutosaveTimer);
  state.settingsAutosaveTimer = null;
  if (ui.settingsDialog.open) {
    ui.settingsDialog.close();
  }
}

async function closeSettings() {
  if (!ui.settingsDialog.open) return true;
  if (state.settingsSaveTask) await state.settingsSaveTask;
  if (refreshSettingsDirtyState()) {
    const saved = await saveSettings();
    if (!saved) return false;
  }
  forceCloseSettings();
  return true;
}

async function returnToMainMenuFromSettings() {
  if (!(await closeSettings())) return;
  await showMenu();
}

function openMaintenance(message) {
  if (!getCurrentAdventure()) {
    appendNarration("warning", t("maintenance.noAdventure"));
    return;
  }
  if (message) {
    ui.maintenanceStatus.textContent = message;
  } else {
    ui.maintenanceStatus.textContent = t("maintenance.initial");
  }
  clearMaintenanceConfirmation();
  ui.maintenanceDialog.showModal();
}

async function openMaintenanceFromSettings() {
  if (ui.settingsDialog.open && !(await closeSettings())) return;
  openMaintenance();
}

function closeMaintenance() {
  clearMaintenanceConfirmation();
  ui.maintenanceDialog.close();
}

function renderNewGameRestartConfirmation(confirmation) {
  if (!confirmation) {
    closeNewGameRestartDialog();
    return;
  }
  const save = confirmation.save || {};
  const turn = resolveSaveDisplayTurn(save);
  ui.newGameConfirmTitle.textContent = t("newGame.restart.title");
  ui.newGameConfirmSummary.textContent = t("newGame.restart.summary", {
    title: redactDisplaySecrets(save.title || t("newGame.restart.currentAdventure")),
    turn,
  });
  ui.newGameConfirmInput.value = "";
  ui.newGameConfirmInput.placeholder = confirmation.confirmationText || "DELETE";
  ui.newGameConfirmStatus.textContent = t("newGame.restart.prompt", {
    phrase: confirmation.confirmationText || "DELETE",
  });
  ui.confirmNewGameRestartButton.disabled = false;
  ui.newGameConfirmDialog.showModal();
  ui.newGameConfirmInput.focus();
}

function closeNewGameRestartDialog() {
  state.pendingNewGameRestart = null;
  ui.newGameConfirmInput.value = "";
  if (ui.newGameConfirmDialog.open) {
    ui.newGameConfirmDialog.close();
  }
}

async function openNewGameSetup() {
  setBusy(true, t("newGame.busy.loadingCatalog"));
  try {
    const result = await window.greyCrow.getNewGameCatalog();
    if (result.status) applyStatus(result.status);
    if (!result.ok) {
      ui.menuMessage.textContent = formatError(result.error, t("newGame.error.catalog"));
      return;
    }
    state.newGameCatalog = result.catalog || null;
    state.pendingNewGameCreation = null;
    renderNewGameCatalog();
    ui.newGameSetupDialog.showModal();
    ui.newGamePresetSelect.focus();
  } catch (error) {
    ui.menuMessage.textContent = formatError(error, t("newGame.error.catalog"));
  } finally {
    setBusy(false);
  }
}

function closeNewGameSetupDialog() {
  state.newGameCatalog = null;
  state.pendingNewGameCreation = null;
  ui.newGameReviewPanel.classList.add("hidden");
  ui.newGameReview.innerHTML = "";
  ui.newGameModuleReview.classList.add("hidden");
  ui.newGameModuleReviewList.replaceChildren();
  ui.newGameOptionalSkillList.replaceChildren();
  if (ui.newGameSetupDialog.open) ui.newGameSetupDialog.close();
}

function renderNewGameCatalog() {
  const catalog = state.newGameCatalog || {};
  renderNewGameSelect(ui.newGamePresetSelect, catalog.presets, catalog.defaultPreset);
  ui.newGameCapabilityList.innerHTML = "";
  for (const capability of catalog.engineCapabilities || []) {
    const item = document.createElement("span");
    item.className = "new-game-capability";
    item.textContent = engineCapabilityLabel(capability.id);
    item.title = t("newGame.capability.title", { id: capability.id });
    ui.newGameCapabilityList.appendChild(item);
  }
  const catalogNotices = [];
  if (catalog.quarantinedPackCount > 0) catalogNotices.push(t("newGame.catalog.quarantined", { count: catalog.quarantinedPackCount }));
  if (catalog.invalidPackCount > 0) catalogNotices.push(t("newGame.catalog.invalid", { count: catalog.invalidPackCount }));
  ui.newGameSetupStatus.textContent = catalogNotices.length
    ? t("newGame.catalog.loadedWithNotices", { count: catalog.packCount || 0, notices: formatUiList(catalogNotices) })
    : t("newGame.catalog.loaded", { count: catalog.packCount || 0 });
  invalidateNewGameReview();
}

function renderNewGameSelect(select, items = [], selectedRef = null) {
  select.innerHTML = "";
  for (const item of items || []) {
    const option = document.createElement("option");
    option.value = newGameRefKey(item);
    option.textContent = `${item.title} / ${item.packTitle} / ${item.language}`;
    option.selected = newGameRefKey(item) === newGameRefKey(selectedRef || {});
    select.appendChild(option);
  }
  select.disabled = select.options.length === 0;
}

function invalidateNewGameReview() {
  state.pendingNewGameCreation = null;
  ui.newGameReviewPanel.classList.add("hidden");
  ui.newGameReview.innerHTML = "";
  ui.newGameModuleReview.classList.add("hidden");
  ui.newGameModuleReviewList.replaceChildren();
  ui.prepareNewGameButton.textContent = t("newGame.setup.prepare");
  ui.prepareNewGameButton.classList.remove("danger");
  renderNewGameItemDescriptions();
}

function renderNewGameItemDescriptions() {
  const catalog = state.newGameCatalog || {};
  const preset = (catalog.presets || []).find((item) => newGameRefKey(item) === ui.newGamePresetSelect.value);
  ui.newGamePresetDescription.textContent = preset
    ? `${preset.description || ""} / ${preset.language}`
    : t("newGame.catalog.noPreset");
  ui.newGamePresetContents.replaceChildren();
  ui.newGameOptionalSkillList.replaceChildren();
  ui.newGameOptionalSection.classList.add("hidden");
  if (!preset) return;
  const findItem = (collection, ref) => (collection || []).find((item) => newGameRefKey(item) === newGameRefKey(ref));
  const rows = [
    [t("newGame.row.host"), findItem(catalog.hosts, preset.selection?.host)?.title],
    [t("newGame.row.world"), findItem(catalog.worlds, preset.selection?.world)?.title],
    [t("newGame.row.opening"), findItem(catalog.newGameSkills, preset.selection?.newGameSkill)?.title],
    [t("newGame.row.rules"), formatUiList((preset.selection?.skills || []).map((ref) => findItem(catalog.skills, ref)?.title).filter(Boolean)) || t("common.none")],
  ];
  for (const [label, value] of rows) {
    const key = document.createElement("span");
    key.textContent = label;
    const detail = document.createElement("strong");
    detail.textContent = value || t("common.unavailable");
    ui.newGamePresetContents.append(key, detail);
  }
  renderNewGameOptionalSkills(catalog, preset, findItem);
}

function renderNewGameOptionalSkills(catalog, preset, findItem) {
  const optionalSkills = Array.isArray(preset.selection?.optionalSkills) ? preset.selection.optionalSkills : [];
  if (!optionalSkills.length) return;
  ui.newGameOptionalSection.classList.remove("hidden");
  for (const declaration of optionalSkills) {
    const skill = findItem(catalog.skills, declaration);
    if (!skill) continue;
    const label = document.createElement("label");
    label.className = "new-game-skill-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = declaration.defaultEnabled === true;
    input.dataset.packId = declaration.packId;
    input.dataset.itemId = declaration.itemId;
    input.addEventListener("change", () => invalidatePreparedNewGameOnly());
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = skill.title;
    const description = document.createElement("small");
    description.textContent = skill.description || t("newGame.optional.fallbackDescription");
    copy.append(title, description);
    label.append(input, copy);
    ui.newGameOptionalSkillList.appendChild(label);
  }
}

function invalidatePreparedNewGameOnly() {
  state.pendingNewGameCreation = null;
  ui.newGameReviewPanel.classList.add("hidden");
  ui.newGameReview.replaceChildren();
  ui.newGameModuleReview.classList.add("hidden");
  ui.newGameModuleReviewList.replaceChildren();
  ui.prepareNewGameButton.textContent = t("newGame.setup.prepare");
  ui.newGameSetupStatus.textContent = t("newGame.optional.changed");
}

async function prepareOrConfirmNewGame() {
  if (state.busy) {
    return;
  }
  if (state.pendingNewGameCreation?.confirmationToken) {
    await confirmNewGameCreation();
    return;
  }
  setBusy(true, t("newGame.busy.validating"));
  try {
    const result = await window.greyCrow.prepareNewGame(readNewGameSelection());
    if (result.status) applyStatus(result.status);
    if (!result.ok) {
      ui.newGameSetupStatus.textContent = formatError(result.error, t("newGame.error.validation"));
      return;
    }
    state.pendingNewGameCreation = {
      confirmationToken: result.confirmationToken,
      expiresAt: result.expiresAt,
      review: result.review,
    };
    renderNewGameReview(result.review);
    const hasModuleReview = Boolean(result.review?.moduleCapabilityReview?.modules?.length);
    ui.newGameSetupStatus.textContent = hasModuleReview
      ? t("newGame.validation.passedWithModules")
      : t("newGame.validation.passed");
    ui.prepareNewGameButton.textContent = t(hasModuleReview
      ? "newGame.action.confirmCapabilities"
      : "newGame.action.confirmCreate");
  } catch (error) {
    ui.newGameSetupStatus.textContent = formatError(error, t("newGame.error.validation"));
  } finally {
    setBusy(false);
  }
}

async function confirmNewGameCreation() {
  const pending = state.pendingNewGameCreation;
  if (!pending?.confirmationToken || state.busy) return;
  setBusy(true, t("newGame.busy.creating"));
  try {
    const result = await window.greyCrow.confirmNewGameCreation(pending.confirmationToken);
    if (result.status) applyStatus(result.status);
    if (!result.ok) {
      state.pendingNewGameCreation = null;
      ui.prepareNewGameButton.textContent = t("newGame.action.revalidate");
      ui.newGameSetupStatus.textContent = formatError(result.error, t("newGame.error.create"));
      return;
    }
    closeNewGameSetupDialog();
    applySaveResult(result);
    renderShellState();
    showGame(result.save, [], { deferOpening: true });
    if (!Array.isArray(result.skillModules)) await refreshSkillModules();
    appendNarration("muted", t("newGame.narration.created"));
    if (hasRenderableEnvelope(result.openingEnvelope)) {
      renderEnvelope(result.openingEnvelope);
      updateOperationStatusFromEnvelope(result.openingEnvelope);
    } else if (result.openingEnvelope?.ok === false) {
      appendNarration("warning", t("newGame.narration.openingIncomplete"));
    }
  } catch (error) {
    ui.newGameSetupStatus.textContent = formatError(error, t("newGame.error.create"));
  } finally {
    startReadingOpening();
    setBusy(false);
  }
}

function readNewGameSelection() {
  return {
    preset: parseNewGameRef(ui.newGamePresetSelect.value),
    optionalSkillChoices: Array.from(ui.newGameOptionalSkillList.querySelectorAll("input[type='checkbox']"), (input) => ({
      packId: input.dataset.packId || "",
      itemId: input.dataset.itemId || "",
      enabled: input.checked,
    })),
  };
}

function parseNewGameRef(value) {
  const [packId = "", itemId = ""] = String(value || "").split(":", 2);
  return { packId, itemId };
}

function newGameRefKey(value = {}) {
  return `${value.packId || ""}:${value.itemId || ""}`;
}

function renderNewGameReview(review = {}) {
  ui.newGameReview.innerHTML = "";
  const rows = [
    [t("newGame.review.preset"), review.preset?.title],
    [t("newGame.row.host"), review.host?.title],
    [t("newGame.row.world"), review.world?.title],
    [t("newGame.review.openingSkill"), review.newGameSkill?.title],
    [t("newGame.review.skills"), formatUiList((review.skills || []).map((item) => item.title)) || t("newGame.review.noOptionalSkills")],
    [t("newGame.review.language"), review.language],
    [t("newGame.review.compatibility"), t(review.dependencyStatus === "resolved" ? "common.passed" : "common.needsAttention")],
    [t("newGame.review.replacements"), (review.replacements || []).length
      ? t("newGame.review.replacementCount", { count: review.replacements.length })
      : t("common.none")],
  ];
  for (const [label, value] of rows) {
    const key = document.createElement("span");
    key.textContent = label;
    const detail = document.createElement("strong");
    detail.textContent = value || t("game.unknown");
    ui.newGameReview.append(key, detail);
  }
  renderNewGameModuleReview(review.moduleCapabilityReview);
  ui.newGameReviewPanel.classList.remove("hidden");
}

function renderNewGameModuleReview(review) {
  ui.newGameModuleReviewList.replaceChildren();
  if (!review || !Array.isArray(review.modules) || !review.modules.length) {
    ui.newGameModuleReview.classList.add("hidden");
    ui.newGameModuleLimits.textContent = "";
    return;
  }
  for (const module of review.modules) {
    const item = document.createElement("div");
    item.className = "new-game-module-review-item";
    const title = document.createElement("strong");
    title.textContent = t(module.required ? "newGame.module.required" : "newGame.module.optionalEnabled", { title: module.title });
    const summary = document.createElement("span");
    summary.textContent = module.writeSummary;
    item.append(title, summary);
    ui.newGameModuleReviewList.appendChild(item);
  }
  ui.newGameModuleLimits.textContent = review.limitsSummary || t("newGame.module.defaultLimits");
  ui.newGameModuleReview.classList.remove("hidden");
}

function engineCapabilityLabel(id) {
  const keys = {
    "base-state": "newGame.capability.baseState",
    compaction: "newGame.capability.compaction",
    "delete-game": "newGame.capability.deleteGame",
    "game-save": "newGame.capability.gameSave",
    memory: "newGame.capability.memory",
    "new-game": "newGame.capability.newGame",
    summarize: "newGame.capability.summarize",
    transcript: "newGame.capability.transcript",
  };
  return keys[id] ? t(keys[id]) : String(id || t("newGame.capability.unknown"));
}

async function openDebugPanel() {
  if (!state.debugPanelEnabled) {
    openSettings(t("debug.enableInSettings"), { tab: "developer" });
    return;
  }
  if (!state.gameStarted || !state.activeSaveId) {
    appendNarration("warning", t("game.error.startOrContinue"));
    return;
  }
  if (ui.settingsDialog.open && !(await closeSettings())) return;
  ui.debugStatus.textContent = t("debug.loading");
  ui.debugTraceList.innerHTML = "";
  state.debugTraceExport = null;
  state.debugTraceEntries = [];
  state.debugTraceExecution = null;
  state.debugTraceSummary = null;
  state.debugTraceFilter = "all";
  ui.debugDialog.showModal();
  refreshDebugTrace();
}

function closeDebugPanel() {
  state.debugTraceExport = null;
  state.debugTraceEntries = [];
  state.debugTraceExecution = null;
  state.debugTraceSummary = null;
  state.debugTraceFilter = "all";
  ui.debugDialog.close();
}

async function refreshAdvancedMetrics(options = {}) {
  if (!state.debugPanelEnabled) {
    state.advancedMetrics = null;
    renderAdvancedMetrics(t("debug.metrics.enableFirst"));
    return;
  }
  if (!state.keyVerified) {
    state.advancedMetrics = null;
    renderAdvancedMetrics(t("debug.metrics.needsConnection"));
    return;
  }
  if (!state.gameStarted || !state.activeSaveId) {
    state.advancedMetrics = null;
    renderAdvancedMetrics(t("debug.metrics.afterTurn"));
    return;
  }

  if (!options.silent) {
    ui.advancedMetricsStatus.textContent = t("debug.metrics.loading");
  }
  ui.refreshAdvancedMetricsButton.disabled = true;
  try {
    const result = await window.greyCrow.getDebugTrace();
    if (result.status) {
      applyStatus(result.status);
    }
    if (!result.ok) {
      state.advancedMetrics = null;
      renderAdvancedMetrics(formatError(result.error, t("debug.metrics.readFailed")));
      return;
    }
    const entries = Array.isArray(result.result?.entries) ? result.result.entries : [];
    state.advancedMetrics = summarizeAdvancedMetrics(entries);
    renderAdvancedMetrics();
  } catch (error) {
    state.advancedMetrics = null;
    renderAdvancedMetrics(formatError(error, t("debug.metrics.readFailed")));
  } finally {
    ui.refreshAdvancedMetricsButton.disabled = state.busy || !state.debugPanelEnabled;
  }
}

function renderAdvancedMetrics(statusOverride) {
  ui.advancedMetricsGrid.innerHTML = "";
  if (!state.debugPanelEnabled) {
    ui.advancedMetricsStatus.textContent = statusOverride || t("debug.metrics.enableFirstShort");
    addAdvancedMetricRow(t("debug.metrics.window"), t("debug.metrics.afterTurn"));
    addAdvancedMetricRow(t("debug.metrics.currentTurn"), t("debug.metrics.waitingTrace"));
    return;
  }
  if (statusOverride) {
    ui.advancedMetricsStatus.textContent = statusOverride;
  }

  const metrics = state.advancedMetrics;
  if (!metrics) {
    ui.advancedMetricsStatus.textContent = statusOverride || t("debug.metrics.aggregateOnly");
    addAdvancedMetricRow(t("debug.metrics.window"), formatContextUsageForAdvancedMetrics(state.contextUsage));
    addAdvancedMetricRow(t("debug.metrics.currentTurn"), t("debug.metrics.noTrace"));
    return;
  }

  ui.advancedMetricsStatus.textContent = t("debug.metrics.recentSummary", { count: metrics.entryCount });
  addAdvancedMetricRow(t("debug.metrics.window"), metrics.contextText);
  addAdvancedMetricRow(t("debug.metrics.windowPolicy"), metrics.windowPolicyText);
  addAdvancedMetricRow(t("debug.metrics.compactionThreshold"), metrics.compactionPolicyText);
  addAdvancedMetricRow(t("debug.metrics.latestActual"), metrics.latestActualText);
  addAdvancedMetricRow(t("debug.metrics.nextEstimate"), metrics.nextEstimateText);
  addAdvancedMetricRow(t("debug.metrics.requestPeak"), metrics.requestPeakText);
  addAdvancedMetricRow(t("debug.metrics.turnApi"), metrics.lastProviderText);
  addAdvancedMetricRow(t("debug.metrics.turnCalls"), metrics.lastCallText);
  addAdvancedMetricRow(t("debug.metrics.recentTotal"), metrics.recentTotalText);
  addAdvancedMetricRow(t("debug.metrics.recentCost"), metrics.recentCostText);
}

function addAdvancedMetricRow(label, value) {
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = redactDisplaySecrets(value || "-");
  ui.advancedMetricsGrid.append(labelNode, valueNode);
}

function summarizeAdvancedMetrics(entries = []) {
  const safeEntries = Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === "object") : [];
  if (!safeEntries.length) {
    return null;
  }
  const latest = safeEntries[safeEntries.length - 1] || {};
  const latestProvider = latest.provider || {};
  const latestUsage = latestProvider.usage || {};
  const latestTools = latest.tools || {};
  const latestBudget = latest.anchor_summary?.context_budget || {};
  const recentTotals = safeEntries.reduce((totals, entry) => {
    const usage = entry.provider?.usage || {};
    const tools = entry.tools || {};
    totals.input += safeMetricNumber(usage.input_tokens);
    totals.output += safeMetricNumber(usage.output_tokens);
    totals.total += safeMetricNumber(usage.total_tokens);
    totals.providerCalls += safeMetricNumber(entry.provider?.call_count);
    totals.toolCalls += safeMetricNumber(tools.executed);
    totals.toolErrors += safeMetricNumber(tools.error_count);
    totals.cost += safeMetricNumber(usage.cost_usd);
    return totals;
  }, {
    input: 0,
    output: 0,
    total: 0,
    providerCalls: 0,
    toolCalls: 0,
    toolErrors: 0,
    cost: 0,
  });
  const contextUsage = normalizeContextUsageFromBudget(latestBudget) || state.contextUsage;
  const providerCalls = safeMetricNumber(latestProvider.call_count);
  const toolCalls = safeMetricNumber(latestTools.executed);
  const toolErrors = safeMetricNumber(latestTools.error_count);
  return {
    entryCount: safeEntries.length,
    contextText: formatContextUsageForAdvancedMetrics(contextUsage),
    windowPolicyText: formatContextWindowPolicyForAdvancedMetrics(latestBudget),
    compactionPolicyText: formatCompactionPolicyForAdvancedMetrics(latestBudget),
    latestActualText: Number.isFinite(latestBudget.latest_actual_input_tokens)
      ? formatTokenCount(latestBudget.latest_actual_input_tokens)
      : t("debug.metrics.providerMissing"),
    nextEstimateText: Number.isFinite(latestBudget.next_prompt_estimate_tokens)
      ? formatTokenCount(latestBudget.next_prompt_estimate_tokens)
      : t("debug.metrics.waitingAssembly"),
    requestPeakText: t("debug.metrics.requestCount", {
      tokens: formatTokenCount(firstFiniteNumber(latestBudget.turn_peak_actual_input_tokens, latestBudget.turn_peak_safety_input_tokens, latestBudget.latest_request_input_tokens) || 0),
      count: safeMetricNumber(latestBudget.request_count),
    }),
    lastProviderText: formatProviderUsageForAdvancedMetrics(latestUsage),
    lastCallText: t("debug.metrics.calls", { providers: providerCalls, tools: toolCalls, errors: toolErrors }),
    recentTotalText: t("debug.metrics.totalCalls", {
      tokens: formatTokenCount(recentTotals.total), providers: recentTotals.providerCalls,
      tools: recentTotals.toolCalls, errors: recentTotals.toolErrors,
    }),
    recentCostText: recentTotals.cost > 0
      ? t("debug.metrics.estimatedCost", { cost: recentTotals.cost.toFixed(4) })
      : t("debug.metrics.costMissing"),
  };
}

function formatContextWindowPolicyForAdvancedMetrics(budget = {}) {
  const configured = firstFiniteNumber(budget.configured_context_window, state.configuredContextWindow);
  const provider = firstFiniteNumber(budget.provider_context_limit);
  const effective = firstFiniteNumber(budget.effective_context_window, budget.window, configured);
  return t("debug.metrics.windowPolicyValue", {
    configured: formatTokenCount(configured),
    provider: provider ? formatTokenCount(provider) : t("game.unknown"),
    effective: formatTokenCount(effective),
  });
}

function formatCompactionPolicyForAdvancedMetrics(budget = {}) {
  const ratio = firstFiniteNumber(budget.auto_compact_ratio, state.autoCompactRatio);
  const limit = firstFiniteNumber(budget.auto_compact_limit, budget.budget_input_limit);
  const emergency = firstFiniteNumber(budget.emergency_limit);
  return t("debug.metrics.compactionPolicyValue", {
    ratio: Math.round((ratio || 0.75) * 100),
    limit: limit ? formatTokenCount(limit) : t("debug.metrics.waitingEstimate"),
    emergency: emergency ? formatTokenCount(emergency) : "90%",
  });
}

function safeMetricNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function formatProviderUsageForAdvancedMetrics(usage = {}) {
  const input = safeMetricNumber(usage.input_tokens);
  const output = safeMetricNumber(usage.output_tokens);
  const total = safeMetricNumber(usage.total_tokens) || input + output;
  if (!input && !output && !total) {
    return t("debug.metrics.usageMissing");
  }
  return t("debug.metrics.usageValue", {
    total: formatTokenCount(total), input: formatTokenCount(input), output: formatTokenCount(output),
  });
}

function formatContextUsageForAdvancedMetrics(usage) {
  if (!usage) {
    return t("debug.metrics.afterTurn");
  }
  const ratio = Number.isFinite(usage.ratio)
    ? usage.ratio
    : (usage.used && usage.cap ? usage.used / usage.cap : null);
  const percent = Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : t("debug.metrics.estimated");
  if (usage.cap) {
    return t("debug.metrics.contextWithCap", { percent, used: formatTokenCount(usage.used), cap: formatTokenCount(usage.cap) });
  }
  return t("debug.metrics.contextWithoutCap", { percent, used: formatTokenCount(usage.used) });
}

function clearApiKeyInput() {
  ui.apiKeyInput.value = "";
}

async function saveCustomConnection({ quiet = false } = {}) {
  const connection = {
    id: ui.customConnectionSelect.value || undefined,
    name: ui.customConnectionNameInput.value.trim(),
    baseUrl: ui.customBaseUrlInput.value.trim(),
    modelId: ui.customModelIdInput.value.trim(),
  };
  if (!connection.name || !connection.baseUrl || !connection.modelId) {
    (ui.connectionStatus || ui.settingsStatus).textContent = t("settings.connection.validationRequired");
    return null;
  }

  setBusy(true, t("settings.connection.busySaving"));
  try {
    const result = await window.greyCrow.upsertCustomConnection(connection);
    if (!result.ok) {
      (ui.connectionStatus || ui.settingsStatus).textContent = formatError(result.error, t("settings.connection.saveFailed"));
      return null;
    }
    if (result.catalog) {
      applySettingsCatalog(result.catalog);
    }
    applyProviderSettings(result.settings?.api || {});
    applyStatus(result.status);
    state.connectionDraft = { provider: "openai-compatible", connectionId: result.connection.id, model: result.connection.modelId };
    refreshSettingsDirtyState();
    ui.providerPresetSelect.value = getConnectionDraft().provider;
    renderCustomConnectionSettings({ populateFields: true });
    renderModelOptions();
    renderCredentialSettings();
    if (!quiet) {
      (ui.connectionStatus || ui.settingsStatus).textContent = result.connection.verifiedAt
        ? t("settings.connection.savedDone")
        : t("settings.connection.savedNeedsTest");
    }
    return result.connection;
  } catch (error) {
    (ui.connectionStatus || ui.settingsStatus).textContent = formatError(error, t("settings.connection.saveFailed"));
    return null;
  } finally {
    setBusy(false);
  }
}

async function deleteCustomConnection() {
  const connection = getSelectedCustomConnection();
  if (!connection) {
    return;
  }
  if (!window.confirm(t("settings.connection.deleteConfirm", { name: connection.name }))) {
    return;
  }
  setBusy(true, t("settings.connection.busyDeleting"));
  try {
    const result = await window.greyCrow.deleteCustomConnection(connection.id);
    if (!result.ok) {
      (ui.connectionStatus || ui.settingsStatus).textContent = formatError(result.error, t("settings.connection.deleteFailed"));
      return;
    }
    if (result.catalog) {
      applySettingsCatalog(result.catalog);
    }
    applyProviderSettings(result.settings?.api || {});
    applyStatus(result.status);
    state.connectionDraft = { provider: state.provider, model: state.model, connectionId: state.connectionId };
    clearApiKeyInput();
    renderShellState();
    setConnectionStatus(t("settings.connection.deleted"));
  } catch (error) {
    (ui.connectionStatus || ui.settingsStatus).textContent = formatError(error, t("settings.connection.deleteFailed"));
  } finally {
    setBusy(false);
  }
}

async function testApiKey() {
  if (state.busy) return;
  if (state.settingsSaveTask) await state.settingsSaveTask;
  if (state.busy) return;
  const draft = getConnectionDraft();
  const payload = { provider: draft.provider, model: draft.model, apiKey: ui.apiKeyInput.value.trim(),
    ...(draft.provider === "openai-compatible" ? { connection: readCustomConnectionDraft() } : {}) };
  setBusy(true, t("settings.connection.busyTesting"));
  setConnectionStatus(t("settings.connection.busyTesting"));
  try {
    const result = await window.greyCrow.testProviderConnection(payload);
    if (!result.ok && !result.applied) {
      // Failed candidates remain editable; the active connection is unchanged.
      if (result.status) applyStatus(result.status);
      renderCredentialSettings();
      setConnectionStatus(formatConnectionFailure(result.error));
      return;
    }
    clearApiKeyInput();
    state.connectionDraft = null;
    if (result.catalog) applySettingsCatalog(result.catalog);
    if (result.settings) applyProviderSettings(result.settings.api || {});
    applyStatus(result.status);
    renderShellState();
    setConnectionStatus(t(result.ok ? "settings.connection.testPassed" : "settings.connection.savedNeedsRestart"));
    ui.menuMessage.textContent = formatMenuMessage();
  } catch (error) {
    setConnectionStatus(formatConnectionFailure(error));
  } finally {
    // Do not retain the request's second in-memory reference after the test.
    payload.apiKey = "";
    setBusy(false);
  }
}

function formatConnectionFailure(error) {
  const messages = {
    ADVENTURE_BUSY: "settings.connection.waitForTurn",
    CUSTOM_CONNECTION_LIMIT: "settings.connection.limitReached",
    CONTEXT_SETTINGS_TOO_SMALL: "settings.context.tooSmall",
    CONTEXT_SETTINGS_REQUIRE_COMPACTION: "settings.context.requiresCompaction",
    CONTEXT_SETTINGS_STALE: "settings.context.changed",
    MODEL_CONNECTION_REQUIRES_TEST: "settings.connection.savedNeedsTest",
    CREDENTIAL_WRITE_FAILED: "settings.credentials.saveFailed",
    CREDENTIAL_READ_FAILED: "settings.credentials.readFailed",
    CREDENTIAL_COMMIT_ROLLBACK_FAILED: "settings.credentials.recoveryFailed",
    MODEL_CONNECTION_ACTIVATION_FAILED: "settings.connection.savedNeedsRestart",
  };
  if (messages[error?.code]) return t(messages[error.code]);
  if (["INVALID_CUSTOM_CONNECTION", "CUSTOM_CONNECTION_NOT_FOUND", "CUSTOM_CONNECTION_INVALID", "CUSTOM_CONNECTION_NAME_INVALID", "CUSTOM_CONNECTION_URL_INVALID",
    "CUSTOM_CONNECTION_MODEL_INVALID", "INVALID_PROVIDER_CONFIG"].includes(error?.code)) return t("settings.connection.validationRequired");
  const explanation = modelFailureExplanation(error?.code);
  if (explanation) return t(`game.turn.failure.reason.${explanation[0]}`);
  return t("settings.connection.testFailed");
}

async function clearStoredApiKey({ all = false } = {}) {
  if (state.busy) return;
  if (!window.confirm(t(all ? "settings.credentials.clearAllConfirm" : "settings.credentials.clearCurrentConfirm",
    { name: formatModelStatusText() }))) return;
  setBusy(true, t("settings.credentials.busyClearing"));
  clearApiKeyInput();
  try {
    const result = all ? await window.greyCrow.clearAllProviderCredentials({ confirmed: true })
      : await window.greyCrow.clearProviderCredential({ provider: state.provider,
        ...(state.provider === "openai-compatible" ? { connectionId: state.connectionId } : {}) });
    if (result.catalog) applySettingsCatalog(result.catalog);
    if (result.settings) applyProviderSettings(result.settings.api || {});
    if (result.status) applyStatus(result.status);
    renderShellState();
    setConnectionStatus(t(result.ok ? (all ? "settings.credentials.clearAllDone" : "settings.credentials.cleared")
      : (all ? "settings.credentials.clearAllFailed" : "settings.credentials.clearFailed")));
  } catch (_error) {
    setConnectionStatus(t(all ? "settings.credentials.clearAllFailed" : "settings.credentials.clearFailed"));
  } finally { setBusy(false); }
}

async function openModelHelp(event) {
  const button = event.target.closest("[data-model-help-id]");
  if (!button) {
    return;
  }
  try {
    const result = await window.greyCrow.openModelHelp(button.dataset.modelHelpId);
    if (!result?.ok) {
      setConnectionStatus(t("settings.modelHelp.openFailed"));
    }
  } catch (error) {
    setConnectionStatus(t("settings.modelHelp.openFailed"));
  }
}

async function startNewGame() {
  const blockingAdventure = getActiveAdventure();
  if (blockingAdventure) {
    await requestNewGameRestart(blockingAdventure);
    return;
  }
  if (!state.keyVerified) {
    openSettings(t("menu.connectionRequired"), { tab: "ai" });
    return;
  }

  await openNewGameSetup();
}

async function requestNewGameRestart(currentAdventure) {
  setBusy(true, t("newGame.busy.preparingRestart"));
  try {
    const result = await window.greyCrow.requestNewGameRestart(currentAdventure?.id);
    if (result.status) {
      applyStatus(result.status);
    }
    if (!result.ok) {
      ui.menuMessage.textContent = formatError(result.error, t("newGame.error.restartPrepare"));
      await refreshSaves();
      renderShellState();
      return;
    }
    state.pendingNewGameRestart = result.confirmation || null;
    renderNewGameRestartConfirmation(result.confirmation);
  } catch (error) {
    ui.menuMessage.textContent = formatError(error, t("newGame.error.restartPrepare"));
  } finally {
    setBusy(false);
  }
}

async function confirmNewGameRestart() {
  const confirmation = state.pendingNewGameRestart;
  if (!confirmation || state.busy) {
    return;
  }

  setBusy(true, t("newGame.busy.deletingRestart"));
  try {
    const result = await window.greyCrow.confirmNewGameRestart(
      confirmation.save?.id,
      confirmation.confirmationToken,
      ui.newGameConfirmInput.value
    );
    if (result.status) {
      applyStatus(result.status);
    }
    if (!result.ok) {
      ui.newGameConfirmStatus.textContent = formatError(result.error, t("newGame.error.restart"));
      return;
    }

    closeNewGameRestartDialog();
    clearGameTranscript();
    state.activeSaveId = null;
    state.activeSave = null;
    applySaveResult(result);
    renderShellState();
    if (result.openNewGameSelection) {
      if (state.keyVerified) {
        await openNewGameSetup();
      } else {
        openSettings(t("newGame.restart.deletedNeedsConnection"), { tab: "ai" });
      }
    }
  } catch (error) {
    ui.newGameConfirmStatus.textContent = formatError(error, t("newGame.error.restart"));
  } finally {
    setBusy(false);
  }
}





















async function continueLatestGame() {
  const currentAdventure = getCurrentAdventure();
  if (!currentAdventure) {
    ui.menuMessage.textContent = t("menu.continue.title.missing");
    return;
  }
  await continueGame(currentAdventure.id);
}

async function continueGame(saveId, { recoveryBinding = null } = {}) {
  const save = state.saves.find((entry) => entry.id === saveId) || (state.activeSave?.id === saveId ? state.activeSave : null);
  const compatibility = getAdventureCompatibility(save);
  if (isUnsupportedSave(save)) {
    ui.menuMessage.textContent = t("save.unsupported.notice");
    return false;
  }

  if (compatibility.status === "closed") {
    await openStoryArchive(saveId);
    return;
  }
  if (!state.keyVerified && compatibility.errorCode !== "STORE_BUSY") {
    if (recoveryBinding) return false;
    openSettings(t("menu.connectionRequired"), { tab: "ai" });
    return;
  }

  const result = await window.greyCrow.continueGame(saveId);
  // Recovery can finish an already committed final chapter without a model.
  // Main then opens the sealed archive with a fresh read-only view generation.
  const recoveredArchive = recoveryBinding && result?.ok && result.mode === "archive"
    && result.archive?.read_only === true && result.save?.id === recoveryBinding.adventureId
    && result.projection?.adventureId === recoveryBinding.adventureId
    && result.storyFinale?.projection?.phase === "closed";
  if (recoveryBinding && (!isRuntimeViewBindingCurrent(recoveryBinding, { includeRevision: false })
    || result?.stale || (result?.status && ((!recoveredArchive && result.status.runtimeSessionId !== recoveryBinding.sessionId)
      || result.status.activeSaveId !== recoveryBinding.adventureId)))) return false;
  if (!result.ok) {
    ui.menuMessage.textContent = formatError(result.error, t("game.error.continue"));
    return false;
  }

  if (applyStatus(result.status) === false || applySaveResult(result) === false) return false;
  if (state.runtimeProtocol === "session-1" && !state.sessionRecoveryRequired) {
    state.sessionRecoveryCompleted = JSON.stringify([state.activeSaveId, state.runtimeSessionId]);
  }
  state.storyArchive = result.mode === "archive" ? (result.archive || { mode: "archive", read_only: true }) : null;
  state.archiveChapters = Array.isArray(result.chapters) ? result.chapters : [];
  state.storyFinale = result.storyFinale || null;
  renderShellState();
  showGame(result.save, result.history);
  applyStoryFinaleResult(result.storyFinale);
  renderTerminalPlayerAction(result.terminalAction);
  renderPendingPlayerAction(result.pendingAction);
  if (state.runtimeProtocol !== "session-1" && result.mode !== "archive"
    && !Array.isArray(result.skillModules)) await refreshSkillModules();
  restoreContextUsage(result.contextUsage);
  return true;
}

async function openStoryArchive(saveId) {
  if (!saveId || state.busy) return;
  setBusy(true, t("archive.busy.opening"));
  try {
    const result = await window.greyCrow.openStoryArchive(saveId);
    if (!result?.ok) {
      ui.menuMessage.textContent = formatError(result?.error, t("archive.error.open"));
      return;
    }
    if (result.status) applyStatus(result.status);
    applySaveResult(result);
    state.storyArchive = result.archive || { mode: "archive", read_only: true };
    state.archiveChapters = Array.isArray(result.chapters) ? result.chapters : [];
    state.storyFinale = result.storyFinale || null;
    state.skillModules = [];
    state.skillModuleRefreshError = "";
    resetStoryNotebookPanelState();
    if (state.runtimeProtocol === "session-1" && applySaveResult(result) === false) return;
    renderShellState();
    showGame(result.save, result.history);
    applyStoryFinaleResult(result.storyFinale);
    restoreContextUsage({ meter_status: "unavailable" });
  } catch (error) {
    ui.menuMessage.textContent = formatError(error, t("archive.error.open"));
  } finally {
    setBusy(false);
  }
}

async function exportStoryArchive(format) {
  if (getStoryFinalePhase() !== "closed" || state.storyExportBusy) return;
  const binding = captureRuntimeViewBinding();
  state.storyExportBusy = true;
  state.storyExportStatus = t(format === "html" ? "archive.export.preparingHtml" : "archive.export.preparingMarkdown");
  renderStoryFinaleState();
  renderTurnInputState();
  try {
    const result = await window.greyCrow.exportStoryArchive(format, binding.sessionMode
      ? { adventureId: binding.adventureId, sessionId: binding.sessionId, revision: binding.revision } : {});
    if (binding.sessionMode && (result?.stale || !isRuntimeViewBindingCurrent(binding))) return;
    if (result?.status) applyStatus(result.status);
    if (!result?.ok) {
      state.storyExportStatus = formatError(result?.error, t("archive.export.failed"));
    } else if (result.canceled) {
      state.storyExportStatus = t("archive.export.canceled");
    } else {
      state.storyExportStatus = Number.isInteger(result.turn_count)
        ? t("archive.export.doneWithCount", { filename: result.filename || t("archive.export.defaultFilename"), count: result.turn_count })
        : t("archive.export.done", { filename: result.filename || t("archive.export.defaultFilename") });
    }
  } catch (error) {
    if (!binding.sessionMode || isRuntimeViewBindingCurrent(binding)) state.storyExportStatus = formatError(error, t("archive.export.failed"));
  } finally {
    state.storyExportBusy = false;
    renderStoryFinaleState();
    renderTurnInputState();
  }
}

async function continueStoryArchive() {
  if (state.runtimeProtocol === "session-1") return continueSessionStoryArchive();
  const canContinue = getStoryFinalePhase() === "closed"
    && (state.storyArchive?.actions?.continue_as_child === true
      || state.storyFinale?.projection?.actions?.continueAsChild === true);
  if (!canContinue || state.storyContinuationBusy || state.busy) return;
  if (!state.keyVerified) {
    state.storyContinuationStatus = t("archive.continuation.needsConnection");
    renderStoryFinaleState();
    return;
  }
  state.storyContinuationBusy = true;
  state.storyContinuationStatus = t("archive.continuation.preparing");
  setBusy(true, t("archive.continuation.busy"));
  try {
    const result = await window.greyCrow.continueStoryArchive();
    if (result?.status) applyStatus(result.status);
    if (!result?.ok) {
      state.storyContinuationStatus = formatError(result?.error, t("archive.continuation.failed"));
      return;
    }
    applySaveResult(result);
    state.storyArchive = null;
    state.archiveChapters = [];
    state.storyFinale = result.storyFinale || null;
    state.storyExportBusy = false;
    state.storyExportStatus = "";
    state.renderedFinaleId = null;
    state.storyContinuationStatus = "";
    if (result.save?.state_hint) renderStateHint(result.save.state_hint);
    appendContinuationDivider(result.continuation?.notice || t("archive.continuation.started"));
    renderShellState();
    applyStoryFinaleResult(result.storyFinale);
    restoreContextUsage(result.contextUsage);
    ui.turnInput.focus();
  } catch (error) {
    state.storyContinuationStatus = formatError(error, t("archive.continuation.failed"));
  } finally {
    state.storyContinuationBusy = false;
    setBusy(false);
    renderStoryFinaleState();
    renderTurnInputState();
  }
}

function isPendingContinuationChild(request) {
  const value = state.activeSave?.continuation;
  return state.runtimeProtocol === "session-1" && request && value && value.requestId === request.requestId
    && value.parentAdventureId === request.adventureId && value.parentRevision === request.revision
    && value.sourceFinaleId === request.sourceFinaleId && value.childAdventureId === state.activeSaveId
    && value.boundaryRevision === request.revision + 1 && state.activeSave.revision === value.boundaryRevision;
}

async function continueSessionStoryArchive() {
  const previous = state.pendingContinuationRequest;
  const recoveringChild = isPendingContinuationChild(previous);
  if ((!recoveringChild && (getStoryFinalePhase() !== "closed" || state.storyFinale?.projection?.actions?.continueAsChild !== true))
    || state.storyContinuationBusy || state.busy) return;
  if (!state.keyVerified) {
    state.storyContinuationStatus = t("archive.continuation.needsConnection");
    renderStoryFinaleState();
    return;
  }
  const currentBinding = captureRuntimeViewBinding();
  const binding = recoveringChild ? { ...currentBinding, adventureId: previous.adventureId,
    sessionId: previous.sessionId, revision: previous.revision } : currentBinding;
  const sourceFinaleId = recoveringChild ? previous.sourceFinaleId : state.storyFinale.projection.closedFinale?.finaleId;
  const request = previous && previous.adventureId === binding.adventureId && previous.sessionId === binding.sessionId
    && previous.revision === binding.revision && previous.sourceFinaleId === sourceFinaleId ? previous
    : { adventureId: binding.adventureId, sessionId: binding.sessionId, revision: binding.revision,
      requestId: crypto.randomUUID(), sourceFinaleId };
  state.pendingContinuationRequest = request;
  state.storyContinuationBusy = true;
  state.storyContinuationStatus = t("archive.continuation.preparing");
  const busyRevision = setBusy(true, t("archive.continuation.busy"));
  renderStoryFinaleState();
  try {
    const result = await window.greyCrow.continueStoryArchive(request);
    if (result?.stale) return;
    const next = result?.continuation;
    const validChild = result?.ok && next?.requestId === request.requestId && next.parentAdventureId === binding.adventureId
      && next.parentRevision === binding.revision && next.sourceFinaleId === sourceFinaleId
      && next.childAdventureId === result.save?.id && next.childAdventureId === result.projection?.adventureId
      && result.save.revision === result.projection.revision && result.projection.revision === next.boundaryRevision
      && result.status?.activeSaveId === next.childAdventureId && result.status?.activeSave?.revision === result.projection.revision;
    const childAlreadySelected = validChild && state.activeSaveId === next.childAdventureId
      && state.runtimeSessionId === result.status.runtimeSessionId && state.activeSave?.revision === result.projection.revision;
    if (!isRuntimeViewBindingCurrent(binding) && !childAlreadySelected) return;
    if (!result?.ok) {
      state.storyContinuationStatus = formatError(result?.error, t("archive.continuation.failed"));
      return;
    }
    if (!validChild) {
      state.storyContinuationStatus = t("archive.continuation.failed");
      return;
    }
    if (applyStatus(result.status) === false || applySaveResult(result) === false) return;
    state.pendingContinuationRequest = null;
    state.storyArchive = null;
    state.archiveChapters = [];
    state.storyFinale = result.storyFinale;
    renderShellState();
    showGame(result.save, result.history);
    applyStoryFinaleResult(result.storyFinale);
    restoreContextUsage(result.contextUsage);
  } catch (error) {
    if (isPendingContinuationChild(request)) {
      const recoveryBinding = captureRuntimeViewBinding();
      try {
        if (await continueGame(recoveryBinding.adventureId, { recoveryBinding })) {
          if (state.pendingContinuationRequest === request) state.pendingContinuationRequest = null;
        } else if (isRuntimeViewBindingCurrent(recoveryBinding)) {
          state.storyContinuationStatus = formatError(error, t("archive.continuation.failed"));
        }
      } catch (recoveryError) {
        if (isRuntimeViewBindingCurrent(recoveryBinding)) state.storyContinuationStatus = formatError(recoveryError, t("archive.continuation.failed"));
      }
    } else if (isRuntimeViewBindingCurrent(binding)) state.storyContinuationStatus = formatError(error, t("archive.continuation.failed"));
  } finally {
    if (state.busyRevision === busyRevision) {
      state.storyContinuationBusy = false;
      setBusy(false);
      renderStoryFinaleState();
      renderTurnInputState();
    }
  }
}



function restoreContextUsage(restored = {}) {
  if (state.runtimeProtocol === "session-1") {
    const usage = normalizeSessionContextUsage(restored);
    // A foreign or late result cannot replace a current meter. A missing
    // current estimate stays unknown after the binding change cleared it.
    if (usage) {
      state.contextUsage = usage;
      adoptSessionCompaction(restored);
    }
    renderContextUsage();
    return;
  }
  if (restored?.meter_status !== "ready") {
    state.contextUsage = null;
    renderContextUsage();
    return;
  }
  state.contextUsage = normalizeContextUsage({
    used: restored.used,
    cap: restored.effective_context_window,
    window: restored.effective_context_window,
    ratio: restored.used / restored.effective_context_window,
    autoCompactRatio: restored.auto_compact_ratio,
    autoCompactLimit: restored.auto_compact_limit,
    source: restored.source || "restored_trace",
  });
  renderContextUsage();
}

async function runCommandTurn(commandId) {
  if (state.busy || isSpeechInputBusy() || isStoryInputLocked() || isNotebookPresentationBlocked()) {
    return;
  }
  const commandKeys = {
    observe: "game.commands.intent.observe",
    listen: "game.commands.intent.listen",
    map: "game.commands.intent.map",
    backpack: "game.commands.intent.backpack",
  };
  const text = commandKeys[commandId] ? t(commandKeys[commandId]) : "";
  if (!text) return;
  ui.turnInput.value = text;
  await runTurn(text);
}

async function runTurn(inputOverride) {
  const text = typeof inputOverride === "string" ? inputOverride.trim() : ui.turnInput.value.trim();
  if (!text || state.busy || isSpeechInputBusy() || isStoryInputLocked() || isNotebookPresentationBlocked()) {
    return;
  }
  if (!state.keyVerified) {
    openSettings(t("menu.connectionRequired"), { tab: "ai" });
    return;
  }
  if (!state.gameStarted || !state.activeSaveId) {
    appendNarration("warning", t("game.error.startOrContinue"));
    return;
  }

  // A player may act before the previous committed reply finishes animating.
  // Preserve that reply's exact order, then put the new action after it.
  state.turnFailureNotice = null;
  flushNarrationDelivery();

  const sessionMode = state.runtimeProtocol === "session-1";
  const viewBinding = captureRuntimeViewBinding();
  const binding = { adventureId: state.activeSaveId, sessionId: state.runtimeSessionId };
  const previous = state.pendingSessionAction;
  const retry = sessionMode && previous?.text === text && previous.adventureId === binding.adventureId
    && previous.sessionId === binding.sessionId;
  const action = retry ? previous : { ...binding, actionId: crypto.randomUUID(),
    baseRevision: state.activeSave?.revision, text };
  action.invocationId = crypto.randomUUID();
  if (!retry || !action.line?.isConnected) action.line = appendNarration("player", text);
  if (sessionMode) {
    state.pendingSessionAction = action;
    action.line.dataset.actionId = action.actionId;
    action.line.dataset.actionStatus = "pending";
    action.line.setAttribute("aria-busy", "true");
    action.line.style.opacity = "0.6";
  }
  if (typeof inputOverride !== "string") {
    ui.turnInput.value = "";
  } else if (ui.turnInput.value.trim() === text) {
    ui.turnInput.value = "";
  }
  const busyRevision = setBusy(true, t("game.busy.hostProcessing"));
  state.turnBusyRevision = busyRevision;
  action.cancelPending = false;
  action.cancelRequested = false;
  renderSessionTurnCancel();
  try {
    const result = await window.greyCrow.runTurn(text, sessionMode ? { ...binding,
      actionId: action.actionId, baseRevision: action.baseRevision, invocationId: action.invocationId, retry } : {});
    if (sessionMode && (result.stale || !isRuntimeViewBindingCurrent(viewBinding, { includeRevision: false })
      || result.status?.runtimeSessionId !== binding.sessionId
      || result.status?.activeSaveId !== binding.adventureId)) return;
    if (result.status) {
      if (applyStatus(result.status) === false) return;
    }
    if (sessionMode) restoreContextUsage(result.contextUsage ?? result.envelope?.contextUsage);

    if (!result.ok) {
      if (sessionMode) {
        action.line.dataset.actionStatus = result.actionResult?.status || "unresolved";
        action.line.setAttribute("aria-busy", "false");
        if (result.actionResult?.status === "cancelled"
          || [result.error?.code, result.envelope?.error?.code, result.actionResult?.error?.code]
            .includes("REVISION_CONFLICT")) state.pendingSessionAction = null;
        ui.turnInput.value = text;
      }
      applyStoryFinaleResult(result.storyFinale);
      if (hasRenderableEnvelope(result.envelope)) {
        renderEnvelope(result.envelope);
      }
      appendNarration("warning", sessionMode ? formatPlayerTurnFailure(result, {
        canRetry: state.pendingSessionAction === action && state.gameStarted && state.keyVerified && !isStoryInputLocked(),
      }) : t("game.error.turn"), { autoSpeak: false, turnFailure: true });
      return;
    }

    if (applySaveResult(result) === false) return;
    if (sessionMode) {
      state.pendingSessionAction = null;
      action.line.dataset.actionStatus = "committed";
      action.line.setAttribute("aria-busy", "false");
      action.line.style.opacity = "";
    }
    if (result.mode === "archive") {
      state.storyArchive = result.archive || { mode: "archive", read_only: true };
      state.archiveChapters = Array.isArray(result.chapters) ? result.chapters : [];
    }
    if (sessionMode && !hasRenderableEnvelope(result.envelope) && result.actionResult?.status === "committed") {
      const restored = result.projection?.history?.find((record) => record.actionId === action.actionId);
      if (restored?.adventureId === binding.adventureId && restored.revision === result.projection.revision
        && !state.renderedSessionActions.has(action.actionId)) {
        appendNarration("host", restored.host, { autoSpeak: false, animate: false });
        state.renderedSessionActions.add(action.actionId);
      }
      renderStateHint(result.projection?.state_hint || result.save?.state_hint);
    } else renderEnvelope(result.envelope);
    applyStoryFinaleResult(result.storyFinale);
    updateOperationStatusFromEnvelope(result.envelope);
    if (result.skillModulesRefreshRequired) void refreshSkillModules();
    if (!sessionMode) await refreshSaves();
    renderShellState();
    if (sessionMode && result.derivedWork) void completeSessionDerivedWork(result.derivedWork);
  } catch (error) {
    if (sessionMode) {
      if (state.activeSaveId !== binding.adventureId || state.runtimeSessionId !== binding.sessionId) return;
      action.line.dataset.actionStatus = "unresolved";
      action.line.setAttribute("aria-busy", "false");
      ui.turnInput.value = text;
    }
    appendNarration("warning", sessionMode ? formatPlayerTurnFailure({ error }, { outcomeUnknown: true })
      : t("game.error.turn"), { autoSpeak: false, turnFailure: true });
  } finally {
    if (state.turnBusyRevision === busyRevision) state.turnBusyRevision = null;
    if (state.busyRevision === busyRevision
      && isRuntimeViewBindingCurrent(viewBinding, { includeRevision: false })) setBusy(false);
  }
}

function renderSessionTurnCancel() {
  if (!ui.cancelTurnButton) return;
  const action = state.pendingSessionAction;
  const active = state.runtimeProtocol === "session-1" && state.busy
    && state.turnBusyRevision !== null && state.turnBusyRevision === state.busyRevision
    && action?.adventureId === state.activeSaveId && action.sessionId === state.runtimeSessionId;
  ui.cancelTurnButton.hidden = !active;
  ui.cancelTurnButton.disabled = !active || Boolean(action?.cancelPending || action?.cancelRequested);
  ui.cancelTurnButton.textContent = t(action?.cancelPending || action?.cancelRequested
    ? "game.turn.cancelling" : "game.turn.cancel");
}

async function requestSessionTurnCancellation() {
  const action = state.pendingSessionAction;
  if (state.runtimeProtocol !== "session-1" || !state.busy || state.turnBusyRevision === null
    || state.turnBusyRevision !== state.busyRevision || !action || action.cancelPending || action.cancelRequested
    || action.adventureId !== state.activeSaveId || action.sessionId !== state.runtimeSessionId) return;
  const binding = captureRuntimeViewBinding();
  const busyRevision = state.busyRevision;
  const invocationId = action.invocationId;
  const isCurrent = () => state.pendingSessionAction === action && state.busy
    && state.turnBusyRevision === busyRevision && state.busyRevision === busyRevision
    && action.invocationId === invocationId && isRuntimeViewBindingCurrent(binding, { includeRevision: false });
  action.cancelPending = true;
  renderSessionTurnCancel();
  try {
    const result = await window.greyCrow.cancelTurn({ actionId: action.actionId, baseRevision: action.baseRevision,
      adventureId: action.adventureId, sessionId: action.sessionId, invocationId });
    if (!isCurrent()) return;
    if (result?.ok) action.cancelRequested = true;
    else appendNarration("warning", t("game.turn.cancelUnconfirmed"), { autoSpeak: false });
  } catch (_error) {
    if (isCurrent()) appendNarration("warning", t("game.turn.cancelUnconfirmed"), { autoSpeak: false });
  } finally {
    // A cancellation acknowledgement never settles the action. The original
    // runTurn receipt still decides committed, cancelled, or unknown outcome.
    if (isCurrent()) { action.cancelPending = false; renderSessionTurnCancel(); renderTurnStatus(); }
  }
}

function formatPlayerTurnFailure(result = {}, { canRetry = false, outcomeUnknown = false } = {}) {
  const receipt = result.actionResult;
  const codes = [result.error?.code, result.envelope?.error?.code, receipt?.error?.code];
  // Only the durable receipt authorizes a claim about the action's outcome.
  // Transport failures and missing displays cannot establish non-commit.
  if (receipt?.status === "committed") return t("game.turn.failure.saved");
  if (outcomeUnknown || receipt?.status === "unknown"
    || codes.some(code => ["COMMIT_OUTCOME_UNKNOWN", "CANCEL_OUTCOME_UNKNOWN", "ACTION_STATE_UNAVAILABLE"].includes(code))) {
    return t("game.turn.failure.unknown");
  }
  if (codes.includes("REVISION_CONFLICT")) return t("game.turn.failure.changed");
  if (receipt?.status === "cancelled") return t("game.turn.failure.cancelled");
  if (result.status?.sessionRecoveryRequired || result.envelope?.meta?.recoveryRequired
    || codes.includes("SESSION_RECOVERY_REQUIRED")) return t("game.turn.failure.reopen");
  if (receipt?.status === "running" || codes.includes("ADVENTURE_BUSY")) return t("game.turn.failure.wait");
  if (codes.includes("STORE_BUSY")) return t("save.busy.notice");
  if (codes.includes("PROVIDER_NOT_READY")) return t("menu.connectionRequired");
  const retryAllowed = ["failed", "interrupted"].includes(receipt?.status)
    && receipt.error?.retryable === true && canRetry;
  // Classify only safe codes, never upstream prose. A durable non-retryable
  // failure needs a configuration change or recovery before another attempt.
  const explanation = [receipt?.error?.code, ...codes].map(code => modelFailureExplanation(code)).find(Boolean);
  if (explanation) {
    const [reason, suggestedNext] = explanation;
    const next = ["retry", "retryLater", "network"].includes(suggestedNext) && !retryAllowed ? "reopen" : suggestedNext;
    return t("game.turn.failure.details", { reason: t(`game.turn.failure.reason.${reason}`),
      next: t(`game.turn.failure.next.${next}`, { action: t("game.notebook.continueStory") }) });
  }
  if (retryAllowed) return t("game.turn.failure.retry", { action: t("game.notebook.continueStory") });
  return t("game.turn.failure.reopen");
}

function modelFailureExplanation(code) {
  const explanations = {
    API_TIMEOUT: ["timeout", "retry"], TURN_TIMEOUT: ["timeout", "retry"],
    UPSTREAM_AUTH_ERROR: ["auth", "connection"], MISSING_API_KEY: ["auth", "connection"],
    UPSTREAM_ACCESS_DENIED: ["access", "connection"],
    UPSTREAM_BALANCE_ERROR: ["balance", "balance"],
    UPSTREAM_MODEL_NOT_FOUND: ["model", "connection"],
    UPSTREAM_RATE_LIMIT: ["rateLimit", "retryLater"],
    PROVIDER_FAILED: ["network", "network"], UPSTREAM_SERVER_ERROR: ["server", "retryLater"],
    UPSTREAM_BAD_RESPONSE: ["response", "retry"], TURN_OUTPUT_INVALID: ["response", "retry"],
    REPAIR_BUDGET_EXCEEDED: ["repairLimit", "retry"],
    MODEL_CALL_BUDGET_EXCEEDED: ["processingLimit", "retry"], TOOL_CALL_BUDGET_EXCEEDED: ["processingLimit", "retry"],
    INVALID_PROVIDER_CONFIG: ["configuration", "connection"],
    MODEL_CAPABILITY_UNSUPPORTED: ["capability", "connection"],
    CONTEXT_WINDOW_EXCEEDED: ["context", "context"], CONTEXT_BUDGET_EXCEEDED: ["context", "context"],
    OUTPUT_BUDGET_EXCEEDED: ["output", "output"], REQUEST_ABORTED: ["interrupted", "retry"],
  };
  return Object.hasOwn(explanations, code) ? explanations[code] : null;
}

function formatDerivedModelFailure(error, kind) {
  const explanation = modelFailureExplanation(error?.code);
  if (!explanation) return null;
  const [reason, suggestedNext] = explanation;
  const retryNext = ["retry", "retryLater", "network"].includes(suggestedNext);
  return t("game.failure.derivedDetails", {
    outcome: t(kind === "compaction" ? "compact.session.incomplete" : "game.save.chapterIncomplete"),
    reason: t(`game.turn.failure.reason.${reason}`),
    next: retryNext && error.retryable === true ? t(kind === "compaction"
      ? "compact.session.retryLater" : "game.save.chapterRetryLater")
      : t(`game.turn.failure.next.${retryNext ? "reopen" : suggestedNext}`),
  });
}

function isSessionDerivedBusy() {
  return [...state.sessionDerivedWork.values()].some((work) => work.pending
    && isRuntimeViewBindingCurrent(work.binding, { includeRevision: false }));
}

async function completeSessionDerivedWork(ticket) {
  const binding = captureRuntimeViewBinding();
  if (!binding.sessionMode || !ticket || ticket.adventureId !== binding.adventureId
    || ticket.sessionId !== binding.sessionId || ticket.revision !== binding.revision
    || typeof ticket.ticketId !== "string" || !ticket.ticketId
    || !["finale", "chapter"].includes(ticket.kind)
    || ticket.actionId !== state.activeSave?.actionId
    || !state.renderedSessionActions.has(ticket.actionId)
    || state.sessionDerivedWork.has(ticket.ticketId)) return;
  const work = { binding, kind: ticket.kind, pending: true };
  state.sessionDerivedWork.set(ticket.ticketId, work);
  const incomplete = () => appendNarration("warning", t(ticket.kind === "finale"
    ? "archive.resumeFailed" : "game.save.autoChapterIncomplete"), { autoSpeak: false, animate: false });
  try {
    renderStoryFinaleState();
    // Let the committed story reach a paint before acknowledging delivery.
    // This acknowledgement starts no new story action or renderer-owned job.
    if (!(await waitForNotebookReading(binding))) return;
    if (!(await waitForCommittedNarrationDelivery(ticket.actionId, binding))) return;
    await waitForNextUiPaint();
    if (!isRuntimeViewBindingCurrent(binding)) return;
    const result = await window.greyCrow.completeTurnDerived(ticket);
    if (result?.stale || !isRuntimeViewBindingCurrent(binding)) return;
    if (!result) { incomplete(); return; }
    if (result.adventureId !== ticket.adventureId || result.sessionId !== ticket.sessionId
      || result.actionId !== ticket.actionId || result.revision !== ticket.revision
      || result.kind !== ticket.kind) return;
    if (result.status && (result.status.runtimeSessionId !== binding.sessionId
      || result.status.activeSaveId !== binding.adventureId
      || result.status.activeSave?.revision !== binding.revision)) return;
    if (result.status && applyStatus(result.status) === false) return;
    if (applySaveResult(result) === false) return;
    applyStoryFinaleResult(result.storyFinale);
    // The first receipt owns narration and speech. A later chapter receipt
    // updates only derived views, even if it happens to contain an envelope.
    if (result.chapterSummary) renderDerivedChapterSummary(result.chapterSummary);
    if ((!result.ok && !result.chapterSummary)
      || (ticket.kind === "finale" && getStoryFinalePhase() !== "closed")) incomplete();
    if (ticket.kind === "finale" && hasOpenChapterSurface()) void refreshChapterLogs();
    renderShellState();
  } catch (_error) {
    if (isRuntimeViewBindingCurrent(binding)) incomplete();
  } finally {
    // A late completion cannot release another action's busy state, or a job
    // belonging to the replacement session. Keep consumed tickets deduplicated.
    if (state.sessionDerivedWork.get(ticket.ticketId) === work) {
      work.pending = false;
      if (!isRuntimeViewBindingCurrent(binding)) state.sessionDerivedWork.delete(ticket.ticketId);
    }
    if (isRuntimeViewBindingCurrent(binding, { includeRevision: false })) renderStoryFinaleState();
  }
}

async function requestManualSave() {
  if (state.busy) {
    return;
  }
  if (!state.keyVerified) {
    openSettings(t("menu.connectionRequired"), { tab: "ai" });
    return;
  }
  if (!state.gameStarted || !state.activeSaveId) {
    appendNarration("warning", t("game.error.startOrContinue"));
    return;
  }

  const binding = captureRuntimeViewBinding();
  const busyRevision = setBusy(true, t("game.busy.saving"));
  try {
    const result = await window.greyCrow.requestManualSave(binding.sessionMode
      ? { adventureId: binding.adventureId, sessionId: binding.sessionId, revision: binding.revision } : {});
    if (binding.sessionMode && (result.stale || !isRuntimeViewBindingCurrent(binding))) return;
    if (result.status) {
      applyStatus(result.status);
    }
    if (!result.ok) {
      appendNarration("warning", formatError(result.error, t("game.error.save")));
      return;
    }
    applySaveResult(result);
    renderShellState();
    setOperationStatus({ tool: t("game.operations.saveComplete") });
    appendNarration(["failed", "interrupted", "unknown"].includes(result.result?.chapterStatus) ? "warning" : "muted",
      formatManualSaveResult(result.result));
    if (binding.sessionMode && hasOpenChapterSurface()) await refreshChapterLogs();
  } catch (error) {
    if (!binding.sessionMode || isRuntimeViewBindingCurrent(binding)) appendNarration("warning", formatError(error, t("game.error.save")));
  } finally {
    if (state.busyRevision === busyRevision) setBusy(false);
  }
}

function openChapterLogs() {
  const archiveReadable = getStoryFinalePhase() === "closed" && Array.isArray(state.archiveChapters);
  if (!state.keyVerified && !archiveReadable) {
    openSettings(t("menu.connectionRequired"), { tab: "ai" });
    return;
  }
  if (!state.gameStarted || !state.activeSaveId) {
    appendNarration("warning", t("game.error.startOrContinue"));
    return;
  }
  ui.chapterStatus.textContent = t("chapter.loading");
  renderChapterLogs([]);
  ui.chapterDialog.showModal();
  refreshChapterLogs();
}

function closeChapterLogs() {
  ui.chapterDialog.close();
}

function hasOpenChapterSurface() {
  return ui.chapterDialog.open || isStoryNotebookDrawerOpen("chapters");
}

function setOpenChapterSurfaceStatus(message) {
  if (ui.chapterDialog.open) ui.chapterStatus.textContent = message;
  if (isStoryNotebookDrawerOpen("chapters")) ui.storyNotebookDrawerStatus.textContent = message;
}

function renderOpenChapterSurfaces(chapters = []) {
  if (ui.chapterDialog.open) renderChapterLogs(chapters, ui.chapterLogList);
  if (isStoryNotebookDrawerOpen("chapters")) renderChapterLogs(chapters, ui.storyNotebookDrawerBody);
}

async function refreshChapterLogs() {
  if (!hasOpenChapterSurface()) {
    return;
  }
  if (state.runtimeProtocol === "session-1") return refreshSessionChapterLogs();
  ui.chapterRefreshButton.disabled = true;
  if (isStoryNotebookDrawerOpen("chapters")) ui.storyNotebookDrawerRefreshButton.disabled = true;
  try {
    if (getStoryFinalePhase() === "closed") {
      const chapters = Array.isArray(state.archiveChapters) ? state.archiveChapters : [];
      setOpenChapterSurfaceStatus(chapters.length
        ? t("chapter.archiveCount", { count: chapters.length })
        : t("chapter.archiveEmpty"));
      renderOpenChapterSurfaces(chapters);
      return;
    }
    const result = await window.greyCrow.getChapterLogs();
    if (result.status) {
      applyStatus(result.status);
    }
    if (!result.ok) {
      setOpenChapterSurfaceStatus(formatError(result.error, t("chapter.readFailed")));
      renderOpenChapterSurfaces([]);
      return;
    }
    const chapters = Array.isArray(result.result?.chapters) ? result.result.chapters : [];
    setOpenChapterSurfaceStatus(chapters.length
      ? t("chapter.loadedCount", { count: chapters.length })
      : t("chapter.currentEmpty"));
    renderOpenChapterSurfaces(chapters);
  } catch (error) {
    setOpenChapterSurfaceStatus(formatError(error, t("chapter.readFailed")));
    renderOpenChapterSurfaces([]);
  } finally {
    ui.chapterRefreshButton.disabled = false;
    ui.storyNotebookDrawerRefreshButton.disabled = false;
  }
}

async function refreshSessionChapterLogs({ append = false } = {}) {
  if (!hasOpenChapterSurface() || (append && !state.chapterCursor)) return;
  const binding = captureRuntimeViewBinding();
  const readRevision = ++state.chapterReadRevision;
  const cursor = append ? state.chapterCursor : null;
  state.chapterReadBusy = true;
  if (!append) {
    state.sessionChapterLogs = [];
    state.chapterCursor = null;
    renderOpenChapterSurfaces([]);
  }
  setOpenChapterSurfaceStatus(t("chapter.loading"));
  ui.chapterRefreshButton.disabled = true;
  ui.storyNotebookDrawerRefreshButton.disabled = true;
  renderSessionChapterButtons();
  try {
    const result = await window.greyCrow.getChapterLogs({ adventureId: binding.adventureId,
      sessionId: binding.sessionId, revision: binding.revision,
      ...(cursor ? { cursor } : {}), limit: 12 });
    if (readRevision !== state.chapterReadRevision || !isRuntimeViewBindingCurrent(binding) || result.stale) return;
    if (!result.ok) throw new Error(formatError(result.error, t("chapter.readFailed")));
    const page = result.result;
    if (result.adventureId !== binding.adventureId || result.revision !== binding.revision
      || page?.adventureId !== binding.adventureId || page.revision !== binding.revision
      || !Array.isArray(page.chapters)) throw new Error(t("chapter.readFailed"));
    if (result.status && applyStatus(result.status) === false) return;
    const combined = append ? state.sessionChapterLogs.concat(page.chapters) : page.chapters;
    state.sessionChapterLogs = [...new Map(combined.map((chapter) => [chapter.chapter_id, chapter])).values()];
    state.chapterCursor = page.nextCursor || null;
    setOpenChapterSurfaceStatus(state.sessionChapterLogs.length
      ? t("chapter.readCount", { count: state.sessionChapterLogs.length }) : t("chapter.currentEmpty"));
    renderOpenChapterSurfaces(state.sessionChapterLogs);
  } catch (error) {
    if (readRevision !== state.chapterReadRevision || !isRuntimeViewBindingCurrent(binding)) return;
    setOpenChapterSurfaceStatus(formatError(error, t("chapter.readFailed")));
    renderOpenChapterSurfaces(state.sessionChapterLogs);
  } finally {
    if (readRevision === state.chapterReadRevision && isRuntimeViewBindingCurrent(binding)) {
      state.chapterReadBusy = false;
      ui.chapterRefreshButton.disabled = false;
      ui.storyNotebookDrawerRefreshButton.disabled = false;
      renderSessionChapterButtons();
    }
  }
}

function openCompactDialog() {
  if (!state.keyVerified) {
    openSettings(t("menu.connectionRequired"), { tab: "ai" });
    return;
  }
  if (!state.gameStarted || !state.activeSaveId) {
    appendNarration("warning", t("game.error.startOrContinue"));
    return;
  }
  const unavailable = state.runtimeProtocol === "session-1" && !state.sessionContextCompactionAvailable;
  if (state.runtimeProtocol === "session-1") renderSessionCompactionControls();
  else {
    ui.compactStatus.textContent = t("compact.initial");
    ui.confirmCompactButton.textContent = t("compact.confirm");
    ui.confirmCompactButton.disabled = state.busy || unavailable;
  }
  ui.compactDialog.showModal();
}

function closeCompactDialog() {
  ui.compactDialog.close();
}

async function confirmContextCompaction() {
  if (state.runtimeProtocol === "session-1") return confirmSessionContextCompaction();
  if (state.busy || (state.runtimeProtocol === "session-1" && !state.sessionContextCompactionAvailable)) {
    return;
  }
  setBusy(true, t("compact.busy"));
  ui.confirmCompactButton.disabled = true;
  try {
    const result = await window.greyCrow.requestContextCompaction();
    if (result.status) {
      applyStatus(result.status);
    }
    if (!result.ok) {
      ui.compactStatus.textContent = formatError(result.error, t("compact.failed"));
      return;
    }
    const message = formatContextCompactionResult(result.result);
    updateContextUsageFromCompaction(result.result);
    setOperationStatus({
      context: t(result.result?.compacted ? "game.operations.contextCompacted" : "game.operations.contextChecked"),
      tool: t("game.operations.compactionComplete"),
    });
    ui.compactStatus.textContent = message;
    appendNarration("muted", message);
    closeCompactDialog();
  } catch (error) {
    ui.compactStatus.textContent = formatError(error, t("compact.failed"));
  } finally {
    setBusy(false);
    ui.confirmCompactButton.disabled = false;
  }
}

function sessionCompactionFinished(status) {
  return ["reduced", "no_benefit", "not_needed", "baseline_too_large"].includes(status);
}

function sessionCompactionIsStale(pending) {
  return Boolean(pending && (pending.adventureId !== state.activeSaveId || pending.revision !== state.activeSave?.revision
    || pending.settingsIdentity !== state.sessionContextSettingsIdentity));
}

function sessionCompactionCanRetry(pending) {
  return pending?.status === "unknown" && pending.canRetry === true && pending.recoveryRequired === true;
}

function sessionCompactionProviderFailureCanRetry(pending) {
  // The player may repair a key, balance or connection without changing the
  // context identity. Only a known failed Provider call permits that explicit
  // retry; uncertain commits and structural failures keep their existing gate.
  return ["failed", "interrupted"].includes(pending?.status) && [
    "API_TIMEOUT", "UPSTREAM_AUTH_ERROR", "UPSTREAM_ACCESS_DENIED", "UPSTREAM_BALANCE_ERROR", "UPSTREAM_MODEL_NOT_FOUND",
    "UPSTREAM_RATE_LIMIT", "PROVIDER_FAILED", "UPSTREAM_SERVER_ERROR", "UPSTREAM_BAD_RESPONSE",
    "MISSING_API_KEY", "INVALID_PROVIDER_CONFIG", "MODEL_CAPABILITY_UNSUPPORTED",
    "CONTEXT_WINDOW_EXCEEDED", "REQUEST_ABORTED",
  ].includes(pending?.error?.code);
}

function sessionCompactionMessage(pending) {
  if (!state.sessionContextCompactionAvailable) return t("game.context.compactionPending");
  if (!pending) return t("compact.initial");
  if (sessionCompactionIsStale(pending)) return t("compact.session.stale");
  if (sessionCompactionCanRetry(pending)) return t("compact.session.retryReady");
  if (["failed", "interrupted"].includes(pending.status)) {
    const detail = formatDerivedModelFailure(pending.error, "compaction");
    if (detail) return detail;
  }
  const keys = { reduced: "compact.result.compacted", no_benefit: "compact.result.noBenefit", not_needed: "compact.result.skipped",
    baseline_too_large: "compact.session.baselineTooLarge", failed: "compact.session.failed", interrupted: "compact.session.interrupted",
    running: "compact.session.running", unknown: "compact.session.unknown" };
  return t(keys[pending.status] || "compact.session.unknown");
}

function renderSessionCompactionControls() {
  if (!ui.settingsCompactContextButton) return;
  const ready = state.gameStarted && Boolean(state.activeSaveId) && state.keyVerified && !isStoryInputLocked();
  ui.settingsCompactContextButton.disabled = state.busy || state.settingsSaving || state.settingsDirty || !ready
    || (state.runtimeProtocol === "session-1" && !state.sessionContextCompactionAvailable);
  ui.settingsCompactContextButton.title = state.settingsDirty ? t("compact.session.saveSettingsFirst") : "";
  if (state.runtimeProtocol !== "session-1") return;
  const pending = state.pendingSessionCompaction;
  const stale = sessionCompactionIsStale(pending);
  const confirmedRetry = sessionCompactionCanRetry(pending);
  const check = !stale && pending && !confirmedRetry && ["unknown", "running"].includes(pending.status);
  const retry = !stale && pending && (confirmedRetry || ["failed", "interrupted"].includes(pending.status));
  const unchangedBaseline = !stale && pending?.status === "baseline_too_large" && pending.input === ui.turnInput.value;
  ui.confirmCompactButton.textContent = t(check ? "compact.session.check" : retry ? "compact.session.retry" : "compact.confirm");
  ui.confirmCompactButton.disabled = state.busy || !ready || !state.sessionContextCompactionAvailable || unchangedBaseline
    || (retry && pending.error?.retryable === false && !sessionCompactionProviderFailureCanRetry(pending));
  ui.compactStatus.textContent = sessionCompactionMessage(pending);
}

function adoptSessionCompaction(context) {
  const pending = context?.pendingCompaction;
  if (!pending || typeof pending.requestId !== "string" || !Number.isSafeInteger(pending.revision)
    || typeof pending.input !== "string" || typeof pending.settingsIdentity !== "string"
    || !["failed", "interrupted", "running", "unknown"].includes(pending.status)) {
    renderSessionCompactionControls();
    return;
  }
  const previous = state.pendingSessionCompaction;
  const sameRequest = previous?.requestId === pending.requestId && previous.adventureId === context.adventureId
    && previous.revision === pending.revision && previous.settingsIdentity === pending.settingsIdentity
    && previous.sessionId === state.runtimeSessionId;
  const confirmedRetry = sameRequest && sessionCompactionCanRetry(previous) && ["running", "unknown"].includes(pending.status);
  state.pendingSessionCompaction = { ...pending, adventureId: context.adventureId, sessionId: state.runtimeSessionId,
    canRetry: confirmedRetry, recoveryRequired: confirmedRetry,
    ...(confirmedRetry ? { status: "unknown" } : {}), ...(sameRequest ? { notified: previous.notified } : {}) };
  // Recover a lost draft without overwriting text the player has already typed.
  if (pending.revision === state.activeSave?.revision && !ui.turnInput.value && pending.input) ui.turnInput.value = pending.input;
  renderSessionCompactionControls();
}

async function confirmSessionContextCompaction() {
  if (state.busy || !state.sessionContextCompactionAvailable || !state.gameStarted || !state.keyVerified || isStoryInputLocked()) return;
  const binding = captureRuntimeViewBinding();
  let pending = state.pendingSessionCompaction;
  const stale = sessionCompactionIsStale(pending);
  if (!pending || stale || sessionCompactionFinished(pending.status)) {
    if (!stale && pending?.status === "baseline_too_large" && pending.input === ui.turnInput.value) return;
    pending = { adventureId: binding.adventureId, sessionId: binding.sessionId, revision: binding.revision,
      settingsIdentity: state.sessionContextSettingsIdentity, requestId: crypto.randomUUID(), input: ui.turnInput.value,
      status: "new", notified: false };
    state.pendingSessionCompaction = pending;
  }
  const confirmedRetry = sessionCompactionCanRetry(pending);
  const checking = !confirmedRetry && ["running", "unknown"].includes(pending.status);
  const retry = confirmedRetry || ["failed", "interrupted"].includes(pending.status);
  if (retry && pending.error?.retryable === false && !sessionCompactionProviderFailureCanRetry(pending)) return;
  const request = { adventureId: binding.adventureId, sessionId: binding.sessionId, revision: pending.revision,
    requestId: pending.requestId, input: pending.input, retry };
  const busyRevision = setBusy(true, t(checking ? "compact.session.checking" : "compact.busy"));
  state.compactionBusyRevision = busyRevision;
  pending.status = checking ? pending.status : "running";
  if (!checking) { pending.canRetry = false; pending.recoveryRequired = false; }
  renderSessionCompactionControls();
  try {
    const result = checking ? await window.greyCrow.readContextCompaction({ adventureId: request.adventureId,
      sessionId: request.sessionId, revision: request.revision, requestId: request.requestId })
      : await window.greyCrow.requestContextCompaction(request);
    if (!isRuntimeViewBindingCurrent(binding) || state.pendingSessionCompaction?.requestId !== request.requestId) return;
    if (result?.stale) {
      pending.settingsIdentity = null;
      return;
    }
    if (result?.status?.runtimeSessionId !== binding.sessionId || result?.status?.activeSaveId !== binding.adventureId
      || result?.status?.activeSave?.revision !== binding.revision) {
      pending.status = "unknown";
      return;
    }
    if (applyStatus(result.status) === false) return;
    const receipt = result.compaction;
    if (!receipt || receipt.requestId !== request.requestId || receipt.revision !== request.revision
      || !["reduced", "no_benefit", "not_needed", "baseline_too_large", "failed", "interrupted", "running", "unknown"].includes(receipt.status)) {
      pending.status = "unknown";
      return;
    }
    Object.assign(pending, { status: receipt.status, error: receipt.error || null, contextGeneration: receipt.contextGeneration,
      canRetry: checking && receipt.status === "unknown" && receipt.canRetry === true && receipt.recoveryRequired === true,
      recoveryRequired: checking && receipt.status === "unknown" && receipt.canRetry === true && receipt.recoveryRequired === true });
    restoreContextUsage(result.contextUsage);
    if (["reduced", "no_benefit", "not_needed"].includes(receipt.status)) {
      setOperationStatus({ context: t(receipt.status === "reduced" ? "game.operations.contextCompacted" : "game.operations.contextChecked"),
        tool: t("game.operations.compactionComplete") });
      if (!pending.notified) {
        appendNarration("muted", sessionCompactionMessage(pending), { autoSpeak: false });
        pending.notified = true;
      }
      closeCompactDialog();
    }
    if (result.chapterSummary) renderDerivedChapterSummary(result.chapterSummary);
  } catch {
    if (isRuntimeViewBindingCurrent(binding) && state.pendingSessionCompaction?.requestId === request.requestId) pending.status = "unknown";
  } finally {
    if (state.compactionBusyRevision === busyRevision) state.compactionBusyRevision = null;
    if (state.busyRevision === busyRevision && isRuntimeViewBindingCurrent(binding)) setBusy(false);
    renderSessionCompactionControls();
  }
}

async function refreshDebugTrace() {
  if (!state.debugPanelEnabled || !ui.debugDialog.open) {
    return;
  }
  ui.debugRefreshButton.disabled = true;
  ui.debugExportButton.disabled = true;
  const binding = captureRuntimeViewBinding();
  const requestId = ++state.debugTraceRequestId;
  const isCurrent = () => requestId === state.debugTraceRequestId && ui.debugDialog.open
    && state.debugPanelEnabled && isRuntimeViewBindingCurrent(binding);
  try {
    const result = await window.greyCrow.getDebugTrace();
    if (result.stale || !isCurrent()) return;
    if (result.status) {
      if (applyStatus(result.status) === false) return;
    }
    if (!result.ok) {
      ui.debugStatus.textContent = formatError(result.error, t("debug.readFailed"));
      renderDebugTraceEntries([]);
      return;
    }
    const entries = Array.isArray(result.result?.entries) ? result.result.entries : [];
    const selection = result.result?.selection || {};
    state.debugTraceExport = result.export || null;
    state.debugTraceEntries = entries;
    state.debugTraceExecution = result.result?.execution || null;
    state.debugTraceSummary = result.result?.summary || null;
    ui.debugStatus.textContent = entries.length
      ? `${t("debug.loadedCount", { count: entries.length })} / errors ${selection.selected_error_entry_count || 0} / available ${selection.available_entry_count || entries.length}${selection.truncated ? " / truncated" : ""}`
      : state.debugTraceExecution?.records?.length
        ? t("debug.execution.count", { returned: state.debugTraceExecution.returnedAttempts,
          retained: state.debugTraceExecution.retainedAttempts })
        : t("debug.emptyCurrent");
    renderDebugTraceEntries(entries, state.debugTraceSummary, state.debugTraceExecution);
  } catch (error) {
    if (isCurrent()) {
      ui.debugStatus.textContent = formatError(error, t("debug.readFailed"));
      renderDebugTraceEntries([]);
    }
  } finally {
    if (isCurrent()) {
      ui.debugRefreshButton.disabled = false;
      ui.debugExportButton.disabled = !state.debugTraceExport;
      renderDeveloperSettings();
    }
  }
}

function renderDebugTraceExecution(execution) {
  if (!execution || execution.format !== "session-execution-1") return;
  const section = document.createElement("section");
  section.className = "debug-execution";
  const heading = document.createElement("h3");
  heading.textContent = t("debug.execution.title");
  const scope = document.createElement("p");
  scope.className = "debug-execution-note";
  scope.textContent = t("debug.execution.scope");
  section.append(heading, scope);
  const count = document.createElement("p");
  count.className = "debug-execution-note";
  count.textContent = execution.available
    ? t("debug.execution.count", { returned: execution.returnedAttempts, retained: execution.retainedAttempts })
    : t("debug.execution.unavailable");
  section.appendChild(count);
  if (execution.truncated) {
    const warning = document.createElement("p");
    warning.className = "debug-execution-note";
    warning.textContent = t("debug.execution.truncated");
    section.appendChild(warning);
  }
  // Main supplies a bounded, strictly projected metadata object. Keep it out of
  // the action summary and never interpret its values as markup or story text.
  for (const record of Array.isArray(execution.records) ? execution.records : []) {
    if (record.phase !== "story_generation") continue;
    const card = document.createElement("details");
    card.className = "debug-trace-card debug-execution-card";
    card.setAttribute("data-execution-attempt-id", record.attemptId);
    const title = document.createElement("summary");
    title.className = "debug-trace-title";
    const status = ["running", "committed", "failed", "interrupted", "cancelled"].includes(record.status)
      ? record.status : "unknown";
    title.textContent = t("debug.execution.attempt", { status: t(`debug.native.status.${status}`),
      action: record.actionId, attempt: record.attemptId });
    card.appendChild(title);
    if (record.incomplete || record.truncated) {
      const warning = document.createElement("p");
      warning.className = "debug-execution-note";
      warning.textContent = t("debug.execution.incomplete");
      card.appendChild(warning);
    }
    const metadata = document.createElement("pre");
    metadata.className = "debug-execution-json";
    metadata.textContent = JSON.stringify(record, null, 2);
    card.appendChild(metadata);
    section.appendChild(card);
  }
  ui.debugTraceList.appendChild(section);
}

function renderDebugTraceEntries(entries = [], summary = null, execution = null) {
  ui.debugTraceList.innerHTML = "";
  renderDebugTraceExecution(execution);
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "debug-trace-empty";
    empty.textContent = t("debug.emptyDisplay");
    ui.debugTraceList.appendChild(empty);
    return;
  }

  const overview = document.createElement("div");
  overview.className = "debug-trace-overview";
  const overviewText = document.createElement("strong");
  overviewText.textContent = formatDebugTraceOverview(summary, entries);
  const filter = document.createElement("select");
  filter.className = "debug-trace-filter";
  filter.setAttribute("aria-label", "Filter debug traces");
  for (const option of buildDebugTraceFilterOptions(entries)) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === state.debugTraceFilter;
    filter.appendChild(node);
  }
  if (!Array.from(filter.options).some((option) => option.value === state.debugTraceFilter)) {
    state.debugTraceFilter = "all";
    filter.value = "all";
  }
  filter.addEventListener("change", () => {
    state.debugTraceFilter = filter.value;
    renderDebugTraceEntries(state.debugTraceEntries, state.debugTraceSummary, state.debugTraceExecution);
  });
  overview.append(overviewText, filter);
  ui.debugTraceList.appendChild(overview);

  for (const entry of filterDebugTraceEntries(entries, state.debugTraceFilter).reverse()) {
    const card = document.createElement("details");
    const hasError = debugTraceEntryHasError(entry);
    card.className = `debug-trace-card${hasError ? " is-error" : ""}`;
    card.open = hasError;
    const title = document.createElement("summary");
    title.className = "debug-trace-title";
    title.textContent = formatDebugTraceTitle(entry);
    const grid = document.createElement("div");
    grid.className = "debug-trace-grid";
    if (entry.kind === "session_action") {
      const action = entry.session_action || {};
      addDebugTraceRow(grid, t("debug.native.status"), t(`debug.native.status.${action.status}`));
      addDebugTraceRow(grid, t("debug.native.baseRevision"), String(action.baseRevision ?? "-"));
      addDebugTraceRow(grid, t("debug.native.committedRevision"), String(action.committedRevision ?? "-"));
      addDebugTraceRow(grid, t("debug.native.attempt"), action.attemptId || "-");
      addDebugTraceRow(grid, t("debug.native.updated"), action.updatedAt || "-");
      addDebugTraceRow(grid, t("debug.native.measurement"), t("debug.native.unavailable"));
      card.append(title, grid);
      ui.debugTraceList.appendChild(card);
      continue;
    }
    addDebugTraceRow(grid, "provider", formatDebugTraceProvider(entry.provider));
    addDebugTraceRow(grid, "context", formatDebugTraceContext(entry.anchor_summary));
    addDebugTraceRow(grid, "context items", formatDebugTraceContextItems(entry.anchor_summary));
    addDebugTraceRow(grid, "summary", formatDebugTraceSummary(entry));
    addDebugTraceRow(grid, "redactions", formatDebugTraceRedactions(entry.anchor_summary));
    addDebugTraceRow(grid, "tools", formatDebugTraceTools(entry.tools));
    addDebugTraceRow(grid, "developer", formatDebugTraceDeveloper(entry.developer_summary));
    addDebugTraceRow(grid, "parser", formatDebugTraceParser(entry.parser));
    addDebugTraceRow(grid, "commit", formatDebugTraceCommit(entry));
    addDebugTraceRow(grid, "memory", formatDebugTraceMemory(entry.memory));
    addDebugTraceRow(grid, "save node", formatDebugTraceSaveNode(entry.save_node));
    addDebugTraceRow(grid, "duration", `${Number.isFinite(entry.duration_ms) ? entry.duration_ms : 0}ms`);
    card.append(title, grid);
    ui.debugTraceList.appendChild(card);
  }
}

function formatDebugTraceOverview(summary = {}, entries = []) {
  const source = summary && typeof summary === "object" ? summary : {};
  if (source.summary_schema_version === "grey-crow-session-summary-v1") {
    return t("debug.native.overview", { count: source.entry_count, committed: source.statuses?.committed || 0,
      failed: source.failed_turn_count || 0 });
  }
  const groups = Array.isArray(source.error_groups) ? source.error_groups.slice(0, 5) : [];
  const grouped = groups.length
    ? ` / groups ${groups.map((group) => `${group.tool || "unknown"}:${group.reason || group.code || "unknown"} x${group.count || 0}`).join(", ")}`
    : "";
  return `${source.entry_count || entries.length} entries / ${source.tool_error_count || 0} tool errors / writes ${source.write_commit_count || 0}/${source.write_attempt_count || 0}${grouped}`;
}

function buildDebugTraceFilterOptions(entries = []) {
  const tools = new Set();
  const reasons = new Set();
  const fingerprints = new Set();
  for (const entry of entries) {
    for (const call of Array.isArray(entry?.tools?.calls) ? entry.tools.calls : []) {
      if (call?.name) tools.add(call.name);
      if (call?.validation?.reason_code && call.validation.reason_code !== "ACCEPTED") reasons.add(call.validation.reason_code);
      if (call?.failure_fingerprint) fingerprints.add(call.failure_fingerprint);
    }
  }
  return [
    { value: "all", label: "Latest 30 + errors" },
    { value: "errors", label: "Errors only" },
    ...[...tools].sort().map((value) => ({ value: `tool:${value}`, label: `Tool: ${value}` })),
    ...[...reasons].sort().map((value) => ({ value: `reason:${value}`, label: `Reason: ${value}` })),
    ...[...fingerprints].sort().map((value) => ({ value: `fingerprint:${value}`, label: `Failure: ${value}` })),
  ];
}

function filterDebugTraceEntries(entries = [], filter = "all") {
  if (filter === "all") return selectVisibleDebugTraceEntries(entries);
  if (filter === "errors") return entries.filter(debugTraceEntryHasError).slice(-100);
  const separator = filter.indexOf(":");
  const mode = separator > 0 ? filter.slice(0, separator) : "";
  const value = separator > 0 ? filter.slice(separator + 1) : "";
  return entries.filter((entry) => (Array.isArray(entry?.tools?.calls) ? entry.tools.calls : []).some((call) => {
    if (mode === "tool") return call?.name === value;
    if (mode === "reason") return call?.validation?.reason_code === value;
    if (mode === "fingerprint") return call?.failure_fingerprint === value;
    return false;
  })).slice(-100);
}

function selectVisibleDebugTraceEntries(entries = []) {
  const indexed = entries.map((entry, index) => ({ entry, index }));
  const recent = indexed.slice(-30);
  const errors = indexed.filter(({ entry }) => debugTraceEntryHasError(entry)).slice(-50);
  return [...new Map([...errors, ...recent].map((item) => [item.index, item])).values()]
    .sort((left, right) => left.index - right.index)
    .map(({ entry }) => entry);
}

function debugTraceEntryHasError(entry = {}) {
  if (entry.failed_stage || entry.error_code || Number(entry.tools?.error_count) > 0) return true;
  return Array.isArray(entry.tools?.calls) && entry.tools.calls.some((call) => call?.ok === false);
}

function formatDebugTraceSaveNode(saveNode = {}) {
  if (!saveNode || !saveNode.status) {
    return "-";
  }
  const generation = saveNode.generation || {};
  const usage = generation.usage || {};
  const range = saveNode.source_range
    ? ` / seq ${saveNode.source_range.start}-${saveNode.source_range.end}`
    : "";
  const hash = saveNode.source_hash_prefix ? ` / ${saveNode.source_hash_prefix}` : "";
  const tokens = Number.isFinite(usage.total_tokens) ? ` / ${usage.total_tokens} tokens` : "";
  const chapter = saveNode.chapter_generated
    ? ` / ${t("debug.trace.chapterWritten")}`
    : ` / ${saveNode.chapter_decision || t("debug.trace.noChapter")}`;
  return `${saveNode.reason || "save_node"} / ${saveNode.status}${chapter} / ${generation.mode || "-"}${range}${hash}${tokens}`;
}

function addDebugTraceRow(grid, label, value) {
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = redactDisplaySecrets(value || "-");
  grid.append(labelNode, valueNode);
}

function formatDebugTraceTitle(entry = {}) {
  const when = typeof entry.createdAt === "string" ? entry.createdAt.replace("T", " ").replace("Z", "") : "unknown";
  const request = entry.request_id ? ` / ${entry.request_id}` : "";
  const errorCode = entry.error_code || entry.tools?.calls?.find((call) => call?.ok === false)?.error_code;
  const error = entry.kind === "session_action"
    ? ` / ${t(`debug.native.status.${entry.session_action?.status || "unknown"}`)}${errorCode ? ` / ${errorCode}` : ""}`
    : errorCode ? ` / ERROR ${errorCode}` : " / OK";
  return `${when}${request}${error}`;
}

function formatDebugTraceProvider(provider = {}) {
  const usage = provider.usage || {};
  const tokens = Number.isFinite(usage.total_tokens)
    ? ` / ${usage.total_tokens} tokens`
    : "";
  return `${provider.provider || "-"} ${provider.model || ""} / ${provider.status || "-"} / ${provider.finish_reason || "-"}${tokens}`;
}

function formatDebugTraceContext(anchor = {}) {
  const budget = anchor?.context_budget || {};
  const memory = anchor?.memory || {};
  if (!budget || typeof budget !== "object") {
    return "-";
  }
  const used = firstFiniteNumber(budget.full_context_estimate, budget.prompt_tokens);
  const ratio = firstFiniteNumber(budget.usage_ratio);
  const recentTranscript = findContextBudgetItem(budget.itemization, "recent_transcript");
  const pendingMemory = findContextBudgetItem(budget.itemization, "pending_memory");
  const skillIndex = findContextBudgetItem(budget.itemization, "skill_index");
  const full = Number.isFinite(used) ? `prompt ${formatTokenCount(used)}t` : "prompt -";
  const recentRange = memory.recent_transcript_range
    ? ` seq ${memory.recent_transcript_range.start}-${memory.recent_transcript_range.end}`
    : "";
  const recent = recentTranscript
    ? ` / recent transcript ${formatTokenCount(recentTranscript.prompt_tokens)}t / ${recentTranscript.records || memory.recent_transcript_count || 0} turns${recentRange}`
    : "";
  const memoryAudit = pendingMemory
    ? ` / memory ${formatTokenCount(pendingMemory.prompt_tokens)}t / ${pendingMemory.records || 0} records`
    : "";
  const skills = skillIndex ? ` / skill index ${formatTokenCount(skillIndex.prompt_tokens)}t` : "";
  return `${full} / ratio ${formatRatio(ratio)} / items ${budget.item_count || 0}${recent}${memoryAudit}${skills}`;
}

function formatDebugTraceContextItems(anchor = {}) {
  const budget = anchor?.context_budget || {};
  const items = Array.isArray(budget.itemization) ? budget.itemization : [];
  if (!items.length) {
    return "-";
  }
  const requiredOrder = [
    "engine",
    "host",
    "world",
    "profile",
    "output",
    "lifecycle",
    "state",
    "memory_index",
    "skill_index",
    "handoff",
    "compact_summary",
    "rolling_handoff",
    "recent_transcript",
    "pending_memory",
    "skill_index",
    "selected_skills",
    "selected_skill_body",
    "retrieved_memory_search",
    "retrieved_memory_body",
    "retrieved_transcript_body",
    "retrieved_world_body",
    "retrieved_skill_body",
    "retrieved_skill_template_body",
    "tool_schemas",
    "map_snippets",
    "tools",
    "user_turn",
    "full_context",
  ];
  const seen = new Set();
  const parts = [];
  for (const name of requiredOrder) {
    const item = findContextBudgetItem(items, name);
    if (item) {
      seen.add(name);
      parts.push(formatContextBudgetItem(item));
    }
  }
  for (const item of items) {
    if (item?.name && !seen.has(item.name)) {
      parts.push(formatContextBudgetItem(item));
    }
  }
  return parts.join(" / ");
}

function formatContextBudgetItem(item = {}) {
  const name = String(item.name || "unknown");
  const tokens = Number.isFinite(item.prompt_tokens) ? `${formatTokenCount(item.prompt_tokens)}t` : "-";
  const count = Number.isFinite(item.records) ? `:${item.records}` : "";
  return `${name}${count} ${tokens}`;
}

function formatDebugTraceSummary(entry = {}) {
  const memory = entry.memory || {};
  const compaction = memory.compaction || {};
  const metrics = compaction.metrics || {};
  const anchorMemory = entry.anchor_summary?.memory || {};
  const parts = [];
  if (anchorMemory.summary_version) {
    parts.push(`live ${anchorMemory.summary_version}`);
  }
  if (metrics.summary_version) {
    parts.push(`summary ${metrics.summary_version}`);
  }
  if (metrics.summary_hash) {
    parts.push(`hash ${clipDebugTraceValue(metrics.summary_hash, 18)}`);
  }
  const sourceRange = metrics.sourceRange || compaction.sourceRange || null;
  if (sourceRange) {
    parts.push(`source ${sourceRange.start}-${sourceRange.end}`);
  }
  if (Number.isFinite(metrics.source_estimated_tokens) || Number.isFinite(metrics.summary_estimated_tokens)) {
    parts.push(`compact ${formatTokenCount(metrics.source_estimated_tokens || 0)}t -> ${formatTokenCount(metrics.summary_estimated_tokens || 0)}t`);
  }
  if (Number.isFinite(metrics.next_input_estimate_tokens)) {
    parts.push(`next ${formatTokenCount(metrics.next_input_estimate_tokens)}t`);
  }
  if (Number.isFinite(metrics.reduction_ratio)) {
    parts.push(`reduction ${formatRatio(metrics.reduction_ratio)}`);
  }
  if (Number.isFinite(metrics.summary_token_hard_cap)) {
    parts.push(`cap ${formatTokenCount(metrics.summary_token_hard_cap)}t`);
  }
  if (metrics.summary_clipped) {
    parts.push("clipped");
  }
  if (compaction.compacted || compaction.skipped || compaction.reason) {
    parts.push(`status ${compaction.compacted ? "compacted" : (compaction.skipped ? "skipped" : "checked")}`);
    if (compaction.reason) {
      parts.push(`reason ${compaction.reason}`);
    }
  }
  return parts.length ? parts.join(" / ") : "-";
}

function formatDebugTraceRedactions(anchor = {}) {
  const redactions = anchor?.redactions || {};
  const redacted = Number.isFinite(redactions.redacted_values) ? redactions.redacted_values : 0;
  const localPaths = Number.isFinite(redactions.local_path_values) ? redactions.local_path_values : 0;
  if (!redacted && !localPaths) {
    return "none";
  }
  return `redacted values ${redacted} / local paths ${localPaths}`;
}

function findContextBudgetItem(items, name) {
  return Array.isArray(items) ? items.find((item) => item?.name === name) : null;
}

function formatDebugTraceTools(tools = {}) {
  const names = Array.isArray(tools.tool_names) && tools.tool_names.length
    ? ` / ${tools.tool_names.join(", ")}`
    : "";
  const errors = formatToolErrorSamples(tools.error_samples);
  const calls = formatDebugTraceToolCalls(tools.calls);
  return `${tools.executed || 0} calls / ok ${tools.ok_count || 0} / err ${tools.error_count || 0} / repair ${tools.repair_attempts || 0}${names}${errors}${calls ? ` / detail ${calls}` : ""}`;
}

function formatDebugTraceToolCalls(calls = []) {
  if (!Array.isArray(calls) || !calls.length) return "";
  return calls.slice(0, 16).map((call) => {
    const validation = call.validation || {};
    const retry = call.retry_observation || {};
    const receipt = call.write_receipt || null;
    const status = call.ok ? "ok" : `${call.error_code || "error"}:${validation.stage || "unknown"}:${validation.reason_code || "unknown"}`;
    const invalidPath = validation.invalid_arg_path ? `@${validation.invalid_arg_path}` : "";
    const fingerprint = call.failure_fingerprint ? `#${call.failure_fingerprint}` : "";
    const attempt = retry.attempt ? ` attempt=${retry.attempt}${retry.same_failure_as_previous ? ":same" : ""}` : "";
    const write = receipt ? ` write=${receipt.committed ? "committed" : "not_committed"}${Number.isFinite(receipt.before_revision) || Number.isFinite(receipt.after_revision) ? `:${receipt.before_revision ?? "?"}->${receipt.after_revision ?? "?"}` : ""}` : "";
    const action = call.model_surface?.action_id ? ` action=${call.model_surface.action_id}` : "";
    const translation = call.runtime_translation?.target_field
      ? ` runtime=${call.runtime_translation.target_field}${Array.isArray(call.runtime_translation.operation_types) ? `:${call.runtime_translation.operation_types.join("+")}` : ""}`
      : "";
    const mode = call.interface_mode ? ` mode=${call.interface_mode}` : "";
    return `${call.name || "unknown"}[${status}${invalidPath}${fingerprint}${attempt}${write}${action}${translation}${mode}]`;
  }).join(", ");
}

function formatDebugTraceDeveloper(summary = {}) {
  if (!summary || typeof summary !== "object") {
    return "-";
  }
  const parts = [];
  if (summary.adventure?.adventure_id) {
    parts.push(`adventure ${summary.adventure.adventure_id}`);
  }
  if (Array.isArray(summary.context_items) && summary.context_items.length) {
    parts.push(`context ${summary.context_items.slice(0, 12).map((item) => `${item.name || "item"}:${item.estimated_tokens || 0}t`).join(", ")}`);
  }
  if (summary.retrieved_content) {
    parts.push(`retrieved ${summary.retrieved_content.estimated_tokens || 0}/${summary.retrieved_content.limit_tokens || 0}t`);
  }
  const v2Calls = formatDebugTraceToolCalls(summary.tool_calls);
  if (v2Calls) {
    parts.push(`tool calls ${v2Calls}`);
  }
  const allowed = Array.isArray(summary.allowed_tools) && summary.allowed_tools.length
    ? summary.allowed_tools.slice(0, 8).join(", ")
    : "";
  if (allowed) {
    parts.push(`allowed ${allowed}`);
  }
  const routed = Array.isArray(summary.routed_tools) && summary.routed_tools.length
    ? summary.routed_tools.slice(0, 8).join(", ")
    : "";
  if (routed) {
    parts.push(`routed ${routed}`);
  }
  const hints = formatDeveloperRouteHints(summary.route_hints);
  if (hints) {
    parts.push(`hints ${hints}`);
  }
  const skills = formatDeveloperSkillReads(summary.skill_reads);
  if (skills) {
    parts.push(`skills ${skills}`);
  }
  const templates = formatDeveloperTemplateReads(summary.template_reads);
  if (templates) {
    parts.push(`templates ${templates}`);
  }
  const writes = formatDeveloperSaveWrites(summary.save_writes);
  if (writes) {
    parts.push(`writes ${writes}`);
  }
  const failures = formatDeveloperToolFailures(summary.tool_failures);
  if (failures) {
    parts.push(`failures ${failures}`);
  }
  return parts.length ? parts.join(" / ") : "-";
}

function formatDeveloperRouteHints(hints = []) {
  if (!Array.isArray(hints) || !hints.length) {
    return "";
  }
  return hints
    .slice(0, 6)
    .map((hint) => {
      const tool = hint.tool || "unknown";
      const reason = hint.reason ? `:${clipDebugTraceValue(hint.reason, 48)}` : "";
      return `${tool}${reason}`;
    })
    .join(", ");
}

function formatDeveloperSkillReads(reads = []) {
  if (!Array.isArray(reads) || !reads.length) {
    return "";
  }
  return reads.slice(0, 6).map((read) => `${read.id || "unknown"}:${read.ok ? "ok" : (read.error_code || "err")}`).join(", ");
}

function formatDeveloperTemplateReads(reads = []) {
  if (!Array.isArray(reads) || !reads.length) {
    return "";
  }
  return reads
    .slice(0, 6)
    .map((read) => `${read.skill_id || "unknown"}/${read.template_id || "unknown"}:${read.ok ? "ok" : (read.error_code || "err")}`)
    .join(", ");
}

function formatDeveloperSaveWrites(writes = []) {
  if (!Array.isArray(writes) || !writes.length) {
    return "";
  }
  return writes
    .slice(0, 6)
    .map((write) => {
      const id = write.record_id ? `#${write.record_id}` : "";
      const targets = Array.isArray(write.patch_targets) && write.patch_targets.length
        ? `(${write.patch_targets.join(",")})`
        : "";
      return `${write.record_type || write.tool || "unknown"}${id}${targets}:${write.ok ? "ok" : (write.error_code || "err")}`;
    })
    .join(", ");
}

function formatDeveloperToolFailures(failures = []) {
  if (!Array.isArray(failures) || !failures.length) {
    return "";
  }
  return failures.slice(0, 6).map((failure) => `${failure.tool || "unknown"}:${failure.code || "UNKNOWN"}`).join(", ");
}

function formatToolErrorSamples(samples = []) {
  if (!Array.isArray(samples) || !samples.length) {
    return "";
  }
  const parts = samples.slice(0, 4).map((sample) => {
    const name = sample?.name || "unknown";
    const code = sample?.code || "UNKNOWN_TOOL_ERROR";
    const round = Number.isFinite(sample?.round) ? `r${sample.round}` : "r?";
    const retryable = sample?.retryable ? "retryable" : "final";
    return `${name}:${code}:${round}:${retryable}`;
  });
  return ` / errors ${parts.join(", ")}`;
}

function formatDebugTraceParser(parser = {}) {
  return `${parser.parser_mode || "-"} / candidates ${parser.candidate_count || 0} / soft ${parser.soft_write_count || 0} / notes ${parser.memory_note_count || 0} / side ${parser.side_channel_error_code || "-"}`;
}

function formatDebugTraceCommit(entry = {}) {
  const validator = entry.hard_commit_validator || {};
  const commit = entry.commit || {};
  const rejected = Array.isArray(validator.rejected_codes) && validator.rejected_codes.length
    ? ` / rejected ${validator.rejected_codes.join(", ")}`
    : "";
  return `accepted ${validator.accepted_count || 0} / rejected ${validator.rejected_count || 0} / committed ${commit.committed_count || 0} / skipped ${commit.commit_skipped ? (commit.skip_reason || "yes") : "no"}${rejected}`;
}

function formatDebugTraceMemory(memory = {}) {
  const compaction = memory.compaction || {};
  const metrics = compaction.metrics || {};
  const metricText = metrics.summary_estimated_tokens
    ? ` / source ${metrics.source_estimated_tokens || 0}t -> summary ${metrics.summary_estimated_tokens || 0}t / next ${metrics.next_input_estimate_tokens || 0}t / ratio ${formatRatio(metrics.after_usage_ratio)}`
    : "";
  const benefitText = metrics.no_benefit
    ? ` / no-benefit ${metrics.no_benefit_reason || "yes"}`
    : "";
  const clipped = metrics.summary_clipped ? " / clipped" : "";
  return `audit ${memory.audit_write_count || 0} / compaction ${compaction.compacted ? "done" : (compaction.skipped ? "skipped" : "none")} / ${compaction.reason || memory.audit_error_code || "-"}${metricText}${benefitText}${clipped}`;
}

function formatRatio(value) {
  return Number.isFinite(value) ? `${Math.round(value * 1000) / 10}%` : "-";
}

function clipDebugTraceValue(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function exportDebugTrace() {
  const payload = state.debugTraceExport;
  if (!payload?.content) {
    ui.debugStatus.textContent = t("debug.nothingToExport");
    return;
  }
  const blob = new Blob([payload.content], { type: payload.mimeType || "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.filename || "grey-crow-debug-export.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  ui.debugStatus.textContent = t("debug.exportReady");
}

async function openPendingDelete(deletionId) {
  if (state.busy) return;
  clearMaintenanceConfirmation();
  ui.maintenanceStatus.textContent = t("save.deletePending.notice");
  ui.maintenanceDialog.showModal();
  await requestSaveMaintenance("clear", { deletionId });
}

async function requestSaveMaintenance(action, options = {}) {
  if (state.busy) {
    return;
  }
  const compatibilityDelete = options.compatibilityDelete === true && Boolean(options.saveId);
  const currentAdventure = getCurrentAdventure();
  const requestedSaveId = options.saveId || (action === "clear" ? currentAdventure?.id : null);
  if (action === "clear" && !requestedSaveId && !options.deletionId) {
    appendNarration("warning", t("maintenance.nothingToDelete"));
    return;
  }
  if (action !== "clear" && !compatibilityDelete && (!state.gameStarted || !state.activeSaveId)) {
    appendNarration("warning", t("game.error.startOrContinue"));
    return;
  }

  setBusy(true);
  try {
    const result = await window.greyCrow.requestSaveMaintenance(action, {
      saveId: requestedSaveId,
      deletionId: options.deletionId,
      compatibilityDelete,
    });
    if (result.status) {
      applyStatus(result.status);
    }
    if (!result.ok) {
      ui.maintenanceStatus.textContent = formatMaintenanceFailure(result.error, t("maintenance.prepareFailed"));
      return;
    }
    state.pendingMaintenance = result.confirmation || null;
    renderMaintenanceConfirmation(result.confirmation);
  } catch (error) {
    ui.maintenanceStatus.textContent = formatMaintenanceFailure(error, t("maintenance.prepareFailed"));
  } finally {
    setBusy(false);
  }
}

async function confirmSaveMaintenance() {
  const confirmation = state.pendingMaintenance;
  if (!confirmation || state.busy) {
    return;
  }

  setBusy(true, t("maintenance.busy"));
  try {
    const result = await window.greyCrow.confirmSaveMaintenance(
      confirmation.confirmationToken,
      ui.maintenanceConfirmInput.value
    );
    if (result.status) {
      applyStatus(result.status);
    }
    if (!result.ok) {
      if (result.error?.code === "SAVE_DELETE_PENDING") {
        clearMaintenanceConfirmation();
        await refreshSaves();
        renderShellState();
        if (!state.gameStarted) {
          cancelReadingOpening();
          clearGameTranscript();
          ui.gameView.classList.add("hidden");
          ui.gameStageViewport.classList.add("hidden");
          ui.menuView.classList.remove("hidden");
        }
      }
      ui.maintenanceStatus.textContent = formatMaintenanceFailure(result.error, t("maintenance.actionFailed"));
      renderMaintenanceState();
      return;
    }

    applySaveResult(result);
    clearMaintenanceConfirmation();
    ui.maintenanceStatus.textContent = formatMaintenanceResult(result);
    if (result.result?.state_hint) {
      renderStateHint(result.result.state_hint);
    } else if (result.save?.state_hint) {
      renderStateHint(result.save.state_hint);
    }
    await refreshSaves();
    renderShellState();
    if (result.action === "clear") {
      if (confirmation.scope === "delete_pending") {
        ui.maintenanceDialog.close();
        ui.menuMessage.textContent = t("maintenance.result.cleanupComplete");
        return;
      }
      await finishClearCurrentAdventure(result);
      return;
    }
    appendNarration("muted", formatMaintenanceResult(result));
  } catch (error) {
    ui.maintenanceStatus.textContent = formatMaintenanceFailure(error, t("maintenance.currentFailed"));
  } finally {
    setBusy(false);
  }
}

async function finishClearCurrentAdventure(result = {}) {
  cancelReadingOpening();
  clearGameTranscript();
  state.contextUsage = null;
  renderContextUsage();
  if (ui.maintenanceDialog.open) {
    ui.maintenanceDialog.close();
  }
  ui.menuMessage.textContent = formatMaintenanceResult(result);
  ui.gameView.classList.add("hidden");
  ui.gameStageViewport.classList.add("hidden");
  ui.menuView.classList.remove("hidden");
}

function renderMaintenanceState() {
  const hasAdventure = Boolean(getCurrentAdventure());
  const repairReady = state.gameStarted && Boolean(state.activeSaveId) && !state.busy;
  const clearReady = hasAdventure && !state.busy;
  ui.backToMenuButton.disabled = state.busy || !state.gameStarted;
  ui.saveMaintenanceButton.disabled = !clearReady;
  ui.maintenanceRepairButton.disabled = !repairReady;
  ui.maintenanceClearButton.disabled = !clearReady;
  ui.maintenanceConfirmButton.disabled = state.busy || !state.pendingMaintenance;
}

function renderMaintenanceConfirmation(confirmation) {
  if (!confirmation) {
    clearMaintenanceConfirmation();
    return;
  }
  ui.maintenanceConfirmPanel.classList.remove("hidden");
  ui.maintenanceConfirmTitle.textContent = t(confirmation.action === "clear"
    ? "maintenance.confirmDeleteTitle"
    : "maintenance.confirmRepairTitle");
  ui.maintenanceConfirmSummary.textContent = confirmation.scope === "delete_pending"
    ? t("maintenance.confirmPendingDeleteSummary")
    : confirmation.scope === "incompatible_v1"
    ? t("maintenance.confirmLegacySummary")
    : confirmation.action === "clear"
    ? t("maintenance.confirmDeleteSummary")
    : t("maintenance.confirmRepairSummary");
  ui.maintenanceConfirmInput.value = "";
  ui.maintenanceConfirmInput.placeholder = confirmation.requiresText ? confirmation.confirmationText : "";
  ui.maintenanceConfirmInput.classList.toggle("hidden", !confirmation.requiresText);
  ui.maintenanceConfirmInputLabel.classList.toggle("hidden", !confirmation.requiresText);
  ui.maintenanceConfirmButton.classList.toggle("danger", confirmation.danger === "critical");
  ui.maintenanceConfirmButton.disabled = false;
  ui.maintenanceStatus.textContent = confirmation.requiresText
    ? t("maintenance.confirmDeletePrompt", { phrase: confirmation.confirmationText })
    : t("maintenance.confirmRepairPrompt");
  if (confirmation.requiresText) {
    ui.maintenanceConfirmInput.focus();
  }
}

function clearMaintenanceConfirmation() {
  state.pendingMaintenance = null;
  ui.maintenanceConfirmPanel.classList.add("hidden");
  ui.maintenanceConfirmTitle.textContent = t("common.confirm");
  ui.maintenanceConfirmSummary.textContent = "";
  ui.maintenanceConfirmInput.value = "";
  ui.maintenanceConfirmInput.placeholder = "";
  ui.maintenanceConfirmInput.classList.add("hidden");
  ui.maintenanceConfirmInputLabel.classList.add("hidden");
  ui.maintenanceConfirmButton.classList.remove("danger");
  renderMaintenanceState();
}

function formatMaintenanceResult(result = {}) {
  const action = result.action;
  const runtimeResult = result.result || {};
  if (action === "repair") {
    const entries = Array.isArray(runtimeResult.created_entries) ? runtimeResult.created_entries : [];
    if (entries.length === 0) {
      return t("maintenance.result.noRepairNeeded");
    }
    return t("maintenance.result.repaired", { entries: formatMaintenanceEntryList(entries) });
  }
  if (action === "clear") {
    if (runtimeResult.deleted === true || runtimeResult.operation === "delete_current_adventure") {
      return t("maintenance.result.deleted");
    }
    const count = Array.isArray(runtimeResult.removed_entries) ? runtimeResult.removed_entries.length : 0;
    return t("maintenance.result.deletedLegacy", { count });
  }
  return t("maintenance.result.done");
}

function formatMaintenanceEntryList(entries) {
  const visibleEntries = entries
    .map((entry) => String(entry || "").replace(/\\/g, "/").trim())
    .filter((entry) => entry && !entry.startsWith("/") && !/^[A-Za-z]:\//.test(entry))
    .map((entry) => redactDisplaySecrets(entry))
    .slice(0, 5);
  if (!visibleEntries.length) return t("maintenance.entryCount", { count: entries.length });
  const list = formatUiList(visibleEntries);
  return entries.length > visibleEntries.length
    ? t("maintenance.entryListTruncated", { entries: list, count: entries.length })
    : list;
}

function formatMaintenanceFailure(error, fallback) {
  if (error?.code === "SAVE_DELETE_PENDING") return t("maintenance.deletePending");
  return t("maintenance.failureDetail", {
    fallback,
    code: error?.code ? ` [${error.code}]` : "",
  });
}

function formatManualSaveResult(result = {}) {
  if (result.saved === true) {
    if (result.chapterStatus === "disabled") return t("game.save.chapterDisabled");
    if (result.error?.code === "CHAPTER_NOT_READY") return t("game.save.chapterNotReady");
    if (result.chapterStatus === "unknown") return t("game.save.chapterUnknown");
    if (["failed", "interrupted"].includes(result.chapterStatus)) return formatDerivedModelFailure(result.error, "chapter")
      || t("game.save.chapterFailed");
    if (result.chapterStatus === "running") return t("game.save.chapterRunning");
    if (result.chapterStatus === "unchanged") return t("game.save.chapterUnchanged");
    if (result.chapter_log?.generation?.mode === "excerpt") return t("game.save.chapterExcerpt");
  }
  const commit = result.save_commit || {};
  if (result.chapter_generated && result.chapter_log?.title) {
    return t("game.save.chapterGenerated", { title: redactDisplaySecrets(result.chapter_log.title) });
  }
  if (commit.commit_id) {
    return t("game.save.done");
  }
  return t("game.save.operationDone");
}

function applySaveResult(result = {}) {
  const previousActiveSaveId = state.activeSaveId;
  const previousRevision = state.activeSave?.revision;
  if (state.runtimeProtocol === "session-1") {
    if (result.status && result.status.runtimeSessionId !== state.runtimeSessionId) return false;
    if (result.save && (result.save.id !== state.activeSaveId
      || (Number.isSafeInteger(previousRevision) && (!Number.isSafeInteger(result.save.revision)
        || result.save.revision < previousRevision)))) return false;
    if (result.projection && (result.projection.adventureId !== state.activeSaveId
      || result.projection.revision !== (result.save || state.activeSave)?.revision)) return false;
  }
  if (Array.isArray(result.saves)) {
    state.saves = result.saves;
  }
  if (result.save) {
    state.activeSaveId = result.save.id || state.activeSaveId;
    state.activeSave = result.save;
  }
  if (previousActiveSaveId !== state.activeSaveId
    || (state.runtimeProtocol === "session-1" && previousRevision !== state.activeSave?.revision)) {
    if (previousActiveSaveId !== state.activeSaveId) clearTypewriterTimers();
    invalidateRuntimeNotebookProjection();
  }
  if (result.lockedContent) {
    state.lockedContent = result.lockedContent;
  }
  if (Array.isArray(result.skillModules)) {
    state.skillModules = result.skillModules;
    state.skillModuleRefreshError = "";
  }
  if (result.projection && result.projection.adventureId === state.activeSaveId
    && result.projection.revision === state.activeSave?.revision) {
    state.skillPanels = result.projection.panels?.panels || [];
    state.skillPanelSupported = result.projection.panels?.supported ?? null;
    state.characterPanelEntry = result.projection.characterPanel?.panel || null;
    state.characterPanelSupported = result.projection.characterPanel?.supported ?? null;
    if (Array.isArray(result.history)) state.historyCursor = result.projection.historyNextBeforeRevision || null;
  }
  renderStoryNotebookMetadata();
  return true;
}

function renderChapterLogs(chapters = [], container = ui.chapterLogList) {
  const reading = captureChapterReadingState(container);
  container.chapterReadingState = reading;
  container.replaceChildren();
  container.scrollTop = reading.scrollTop;
  if (state.runtimeProtocol === "session-1" && getStoryFinalePhase() !== "closed") {
    const actions = document.createElement("div");
    actions.className = "story-notebook-panel-list-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "menu-button";
    save.dataset.sessionChapterSave = "true";
    save.textContent = t("game.manualSave");
    save.addEventListener("click", requestManualSave);
    actions.appendChild(save);
    container.appendChild(actions);
    renderSessionChapterButtons();
  }
  if (!chapters.length) {
    const empty = document.createElement("p");
    empty.className = "chapter-log-empty";
    empty.textContent = t("chapter.emptyDisplay");
    container.appendChild(empty);
    return;
  }

  for (const chapter of chapters.slice().reverse()) {
    const card = document.createElement("article");
    card.className = "chapter-card";

    const title = document.createElement("h3");
    title.textContent = chapter.generation?.mode === "excerpt" ? t("chapter.excerptTitle")
      : cleanPlayerVisibleDisplayText(chapter.title || "") || t("chapter.untitled");
    card.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "chapter-meta";
    const range = chapter.legacy_source_range || chapter.story_turn_range || chapter.turn_range || {};
    card.dataset.chapterId = chapter.chapter_id || "";
    card.dataset.chapterKey = JSON.stringify([chapter.source?.adventureId || state.activeSaveId,
      chapter.chapter_id || null, chapter.createdAt || null, range.start ?? null, range.end ?? null]);
    const rangeText = Number.isFinite(range.start) && Number.isFinite(range.end)
      ? t("chapter.turnRange", { start: range.start, end: range.end })
      : t("chapter.turnUnknown");
    meta.textContent = `${chapter.kind === "legacy_chapter" ? `${t("chapter.legacyLabel")} / ` : ""}${rangeText} / ${formatSaveDate(chapter.createdAt)}`;
    card.appendChild(meta);
    if (chapter.generation?.mode === "excerpt") {
      const note = document.createElement("p");
      note.className = "chapter-meta";
      note.textContent = t("chapter.excerptLabel");
      card.appendChild(note);
    }

    const review = getChapterReviewContent(chapter);
    if (review.showSummary) {
      const summary = document.createElement("p");
      summary.className = "chapter-summary";
      summary.textContent = review.summary;
      card.appendChild(summary);
    }

    if ((!review.showSummary && review.summary) || review.keyEvents.length || review.openThreads.length) {
      const counts = document.createElement("p");
      counts.className = "chapter-overview-counts";
      counts.textContent = review.keyEvents.length || review.openThreads.length
        ? t("chapter.reviewCounts", { events: review.keyEvents.length, threads: review.openThreads.length })
        : t("chapter.reviewSummaryOnly");
      card.appendChild(counts);
      const details = document.createElement("details");
      details.className = "chapter-details";
      details.dataset.chapterReview = "true";
      const label = document.createElement("summary");
      label.textContent = t("chapter.fullReview");
      details.appendChild(label);
      if (review.summary && !review.showSummary) {
        const summary = document.createElement("p");
        summary.className = "chapter-full-summary";
        summary.textContent = review.summary;
        details.appendChild(summary);
      }
      const list = document.createElement("ul");
      list.className = "chapter-events";
      for (const [key, items] of [["chapter.review.keyEvent", review.keyEvents], ["chapter.review.openThreads", review.openThreads]]) {
        for (const text of items) {
          const item = document.createElement("li");
          item.textContent = t(key, { value: text });
          list.appendChild(item);
        }
      }
      if (list.children.length) details.appendChild(list);
      card.appendChild(details);
    }

    container.appendChild(card);
  }
  if (state.runtimeProtocol === "session-1" && state.chapterCursor) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "menu-button";
    more.dataset.sessionChapterMore = "true";
    more.textContent = t("skillPanel.loadMore");
    more.addEventListener("click", () => refreshSessionChapterLogs({ append: true }));
    container.appendChild(more);
    renderSessionChapterButtons();
  }
  restoreChapterReadingState(container, reading);
}

function renderSessionChapterButtons() {
  const reading = state.gameStarted && state.activeSaveId && (state.keyVerified || getStoryFinalePhase() === "closed");
  for (const button of document.querySelectorAll("[data-session-chapter-save], [data-session-chapter-more]")) {
    const ready = button.dataset.sessionChapterSave ? reading && state.keyVerified && !isStoryInputLocked() : reading;
    button.disabled = state.busy || state.chapterReadBusy || !ready;
  }
}

function getChapterReviewContent(chapter = {}) {
  const summary = cleanPlayerVisibleDisplayText(chapter.summary || "");
  const keyEvents = Array.isArray(chapter.key_events)
    ? chapter.key_events.map((event) => cleanPlayerVisibleDisplayText(event)).filter(Boolean)
    : [];
  const openThreads = Array.isArray(chapter.open_threads)
    ? chapter.open_threads.map((thread) => cleanPlayerVisibleDisplayText(thread)).filter(Boolean)
    : [];

  // This chooses presentation only. Never cut a claim before its qualification,
  // and do not let changing interface language change the same story's budget.
  const limit = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(summary) ? 240 : 600;
  return { summary, keyEvents, openThreads, showSummary: Boolean(summary) && Array.from(summary).length <= limit };
}

function captureChapterReadingState(container) {
  const adventureId = state.activeSaveId;
  const previous = container.chapterReadingState;
  if (!previous || previous.adventureId !== adventureId) {
    return { adventureId, opened: new Set(), scrollTop: 0, anchor: null, focusKey: null };
  }
  const cards = Array.from(container.querySelectorAll("[data-chapter-key]"));
  // Refresh briefly renders an empty/loading surface. Retain the reading place
  // until the replacement page arrives, but never carry it to another adventure.
  if (!cards.length) return previous;
  const bounds = container.getBoundingClientRect();
  const anchor = cards.find(card => card.getBoundingClientRect().bottom > bounds.top);
  const focused = cards.find(card => card.querySelector("summary") === document.activeElement);
  return { adventureId, scrollTop: container.scrollTop,
    opened: new Set(cards.filter(card => card.querySelector("details.chapter-details")?.open).map(card => card.dataset.chapterKey)),
    anchor: anchor ? { key: anchor.dataset.chapterKey, offset: getChapterScrollOffset(container, anchor) } : null,
    focusKey: focused?.dataset.chapterKey || null };
}

function restoreChapterReadingState(container, reading) {
  const cards = Array.from(container.querySelectorAll("[data-chapter-key]"));
  for (const card of cards) {
    const details = card.querySelector("details.chapter-details");
    if (details) details.open = reading.opened.has(card.dataset.chapterKey);
  }
  container.scrollTop = reading.scrollTop;
  const anchor = cards.find(card => card.dataset.chapterKey === reading.anchor?.key);
  if (anchor) container.scrollTop += getChapterScrollOffset(container, anchor) - reading.anchor.offset;
  const focused = cards.find(card => card.dataset.chapterKey === reading.focusKey);
  // A refresh may finish after the player moved to another control. Restore
  // focus lost with the replaced DOM, not focus they deliberately moved away.
  if (!document.activeElement || document.activeElement === document.body || container.contains(document.activeElement)) {
    focused?.querySelector("summary")?.focus({ preventScroll: true });
  }
}

function getChapterScrollOffset(container, card) {
  const bounds = container.getBoundingClientRect();
  // DOM rectangles include the game's canvas transform; scrollTop does not.
  // Keep the stored anchor and its correction in the same unscaled CSS units.
  const scale = container.offsetHeight > 0 ? bounds.height / container.offsetHeight : 1;
  return (card.getBoundingClientRect().top - bounds.top) / (Number.isFinite(scale) && scale > 0 ? scale : 1);
}

function renderEnvelope(envelope = {}) {
  if (state.runtimeProtocol === "session-1" && (envelope.adventureId !== state.activeSaveId
    || envelope.revision !== state.activeSave?.revision || envelope.actionId !== state.activeSave?.actionId)) return;
  if (envelope.adventureId && (envelope.adventureId !== state.activeSaveId
    || (Number.isSafeInteger(state.activeSave?.revision) && envelope.revision < state.activeSave.revision))) return;
  if (envelope.actionId && state.renderedSessionActions.has(envelope.actionId)) {
    renderStateHint(envelope.state_hint);
    return;
  }
  updateContextUsageFromEnvelope(envelope);
  const segments = Array.isArray(envelope.segments) ? envelope.segments : [];
  if (!segments.length) {
    appendNarration("warning", t("game.error.noDisplayContent"));
  }

  const deliverySegments = [];
  const speech = [];
  const autoSpeak = state.ttsAuto && envelope.meta?.autoSpeak !== false;
  for (const segment of segments) {
    const type = segment.type === "warning" ? "warning" : "host";
    const content = type === "host" ? cleanPlayerVisibleDisplayText(segment.content || "") : segment.content || "";
    // A wholly internal committed segment has no player-visible or speakable
    // content. Do not leave a blank paragraph in the sequential delivery.
    if (type === "host" && !content) continue;
    deliverySegments.push({ type, content });
    if (type === "host" && autoSpeak) {
      const text = normalizeTtsDisplayText(content);
      if (text) speech.push(text);
    }
  }
  if (envelope.actionId && segments.length) state.renderedSessionActions.add(envelope.actionId);
  const blockedNotebook = isNotebookPresentationBlocked();
  const speechText = speech.join("\n\n");
  queueCommittedNarrationSegments(deliverySegments, envelope.actionId || null, blockedNotebook ? {
    binding: captureRuntimeViewBinding(),
    onStarted: () => { if (speechText) void synthesizeAndPlayTts(speechText, { manual: false }); },
  } : null);
  // A new utterance cancels the previous one; submit the whole turn once.
  if (!blockedNotebook && speechText) void synthesizeAndPlayTts(speechText, { manual: false });
  renderStateHint(envelope.state_hint);
  if (envelope.chapterSummary) renderDerivedChapterSummary(envelope.chapterSummary);
}

function renderDerivedChapterSummary(summary) {
  if (summary?.revision !== state.activeSave?.revision) return;
  const failed = ["failed", "interrupted", "unknown", "running"].includes(summary.chapterStatus);
  if (summary.chapterStatus === "created" || failed) {
    const detail = ["failed", "interrupted"].includes(summary.chapterStatus) ? formatDerivedModelFailure(summary.error, "chapter") : null;
    appendNarration(failed ? "warning" : "muted", detail || t(failed ? "game.save.autoChapterIncomplete"
      : summary.mode === "excerpt" ? "game.save.autoChapterExcerpt" : "game.save.autoChapterCreated"), { autoSpeak: false });
  }
  if (hasOpenChapterSurface()) void refreshChapterLogs();
}

function hasRenderableEnvelope(envelope = {}) {
  return Array.isArray(envelope.segments) && envelope.segments.some((segment) => {
    return typeof segment?.content === "string" && segment.content.trim();
  });
}

function renderStateHint(hint = {}) {
  if (state.runtimeProtocol === "session-1" && Number.isSafeInteger(state.activeSave?.revision)
    && (hint?.adventureId !== state.activeSaveId || hint?.revision !== state.activeSave.revision
      || hint?.actionId !== state.activeSave.actionId)) return;
  if (!hint || typeof hint !== "object") hint = {};
  const scene = hint.scene || {};
  const player = hint.player || {};
  ui.stateGrid.innerHTML = "";
  addStateCell(t("game.location"), formatLocationDisplay(scene), { key: "location" });
  addStateCell(t("game.state"), formatPlayerStatusDisplay(player, getDisplayLocale(), {
    preserveSourceText: state.runtimeProtocol === "session-1",
  }), { key: "player" });
  addStateCell(t("game.currentGameDay"), resolveDisplayGameDay(hint), { key: "gameDay" });
  addStateCell(t("game.turn"), String(resolveDisplayTurn(hint)), { key: "turn" });
  addStateCell(t("game.model"), formatModelStatusText(), { id: "modelStatusText", key: "model" });
}

function resolveDisplayGameDay(hint = {}) {
  const day = hint.time?.day;
  return Number.isInteger(day) && day >= 0 ? String(day) : t("game.unknown");
}

function resolveDisplayTurn(hint = {}) {
  const time = hint.time || {};
  if (hint.adventureId || state.activeSave?.schemaKind === "session") {
    return Number.isSafeInteger(time.turn) && time.turn >= 0 ? time.turn : t("game.unknown");
  }
  return Math.max(
    normalizeDisplayTurn(time.turn),
    normalizeDisplayTurn(state.activeSave?.turn),
    normalizeDisplayTurn(getCurrentAdventure()?.turn)
  );
}

function resolveSaveDisplayTurn(save = {}) {
  if (save.schemaKind === "session") {
    return Number.isSafeInteger(save.turn) && save.turn >= 0 ? save.turn : t("game.unknown");
  }
  return Number.isFinite(save.turn) ? save.turn : 0;
}

function normalizeDisplayTurn(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function updateContextUsageFromEnvelope(envelope = {}) {
  if (state.runtimeProtocol === "session-1") {
    restoreContextUsage(envelope.contextUsage);
    return;
  }
  const usage = extractContextUsageFromEnvelope(envelope);
  if (!usage) {
    return;
  }
  state.contextUsage = usage;
  renderContextUsage();
}

function updateContextUsageFromCompaction(result = {}) {
  if (result?.meter_status === "reestimating") {
    state.contextUsage = {
      ...(state.contextUsage || {}),
      reestimating: true,
      source: "manual_compaction",
      updatedAt: new Date().toISOString(),
    };
    renderContextUsage();
    return;
  }
  const metrics = result?.metrics || {};
  const noBenefit = Boolean(metrics.no_benefit || result.no_benefit || result.reason === "summary_no_benefit");
  if (noBenefit && !result.compacted) {
    updateContextUsageAfterNoBenefitCompaction(result);
    return;
  }
  const used = firstFiniteNumber(
    metrics.next_input_estimate_tokens,
    metrics.nextInputEstimateTokens,
    metrics.next_input_estimate,
    metrics.summary_estimated_tokens
  );
  const ratio = firstFiniteNumber(metrics.after_usage_ratio, metrics.usage_ratio);
  const previous = state.contextUsage || {};
  const cap = firstFiniteNumber(
    previous.cap,
    previous.inputLimit,
    ratio && used ? Math.round(used / ratio) : null
  );
  if (!used && !ratio) {
    return;
  }
  state.contextUsage = normalizeContextUsage({
    used,
    cap,
    ratio,
    source: "manual_compaction",
    trigger: metrics.trigger_reason || result.reason || "manual",
    modelAssisted: metrics.model_assisted_ok ?? metrics.model_assisted_attempted,
    compacted: Boolean(result.compacted),
    noBenefit,
  });
  renderContextUsage();
}

function updateContextUsageAfterNoBenefitCompaction(result = {}) {
  const previous = state.contextUsage;
  const metrics = result?.metrics || {};
  if (previous) {
    state.contextUsage = {
      ...previous,
      source: "manual_compaction_check",
      trigger: metrics.trigger_reason || result.reason || previous.trigger || "manual",
      modelAssisted: metrics.model_assisted_ok ?? metrics.model_assisted_attempted ?? previous.modelAssisted,
      compacted: false,
      noBenefit: true,
      updatedAt: new Date().toISOString(),
    };
    renderContextUsage();
    return;
  }

  const used = firstFiniteNumber(
    metrics.before_input_estimate_tokens,
    metrics.source_estimated_tokens,
    metrics.full_context_estimate,
    metrics.next_input_estimate_tokens
  );
  const ratio = firstFiniteNumber(metrics.before_usage_ratio);
  const usage = normalizeContextUsage({
    used,
    ratio,
    source: "manual_compaction_check",
    trigger: metrics.trigger_reason || result.reason || "manual",
    modelAssisted: metrics.model_assisted_ok ?? metrics.model_assisted_attempted,
    compacted: false,
    noBenefit: true,
  });
  if (usage) {
    state.contextUsage = usage;
    renderContextUsage();
  }
}

function extractContextUsageFromEnvelope(envelope = {}) {
  if (state.runtimeProtocol === "session-1") return normalizeSessionContextUsage(envelope.contextUsage);
  const meta = envelope.meta || {};
  const anchorBudget = meta.operation_trace?.anchor_summary?.context_budget;
  const compactionBudget = meta.compaction?.budget?.context_budget || meta.compaction?.budget;
  const budget = anchorBudget || compactionBudget;
  const usage = normalizeContextUsageFromBudget(budget, {
    source: anchorBudget ? "turn_context" : "compaction_budget",
    trigger: meta.compaction?.reason || meta.compaction?.metrics?.trigger_reason,
  });
  if (usage) {
    return usage;
  }

  const metrics = meta.compaction?.metrics || {};
  if (!metrics || typeof metrics !== "object") {
    return null;
  }
  const used = firstFiniteNumber(metrics.next_input_estimate_tokens, metrics.next_input_estimate);
  const ratio = firstFiniteNumber(metrics.after_usage_ratio, metrics.usage_ratio);
  return normalizeContextUsage({
    used,
    cap: ratio && used ? Math.round(used / ratio) : null,
    ratio,
    source: "compaction_metrics",
    trigger: metrics.trigger_reason || meta.compaction?.reason,
    noBenefit: Boolean(metrics.no_benefit || meta.compaction?.no_benefit || meta.compaction?.reason === "summary_no_benefit"),
  });
}

function normalizeSessionContextUsage(value) {
  if (!value || value.scope !== "next_request" || value.adventureId !== state.activeSaveId
    || value.revision !== state.activeSave?.revision || value.sessionId !== state.runtimeSessionId
    || typeof value.settingsIdentity !== "string" || value.settingsIdentity !== state.sessionContextSettingsIdentity
    || !Number.isSafeInteger(value.contextGeneration) || value.contextGeneration < 0
    || value.contextGeneration !== state.sessionContextGeneration
    || value.actionId !== null || typeof value.fits !== "boolean") return null;
  const used = value.latestEstimate?.safetyInputTokens;
  const policy = value.policy;
  if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(policy?.effectiveContextWindow)
    || policy.effectiveContextWindow < 1 || !Number.isSafeInteger(policy.hardInputLimit) || policy.hardInputLimit < 1) return null;
  const usage = normalizeContextUsage({ used, cap: policy.effectiveContextWindow, window: policy.effectiveContextWindow,
    inputLimit: policy.hardInputLimit, autoCompactLimit: policy.autoCompactLimit,
    autoCompactRatio: policy.autoCompactRatio, ratio: used / policy.effectiveContextWindow,
    source: "next_prompt_estimate", fits: value.fits });
  if (!usage) return null;
  const previous = value.lastInvocation;
  const actual = previous?.adventureId === value.adventureId && previous.settingsIdentity === value.settingsIdentity
    && previous.contextGeneration === value.contextGeneration
    && previous.scope === "invocation" && previous.revision >= value.revision - 1 && previous.revision <= value.revision
    ? previous.latestActual?.inputTokens : null;
  return { ...usage, sessionContext: true, settingsIdentity: value.settingsIdentity,
    contextGeneration: value.contextGeneration,
    includesPlayerInput: value.includesPlayerInput === true, compactionAvailable: value.compactionAvailable === true,
    latestActualInputTokens: Number.isSafeInteger(actual) && actual >= 0 ? actual : null };
}

function normalizeContextUsageFromBudget(budget = null, extra = {}) {
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
    return null;
  }
  const meterUsed = firstFiniteNumber(budget.context_meter_tokens);
  const nextEstimate = firstFiniteNumber(budget.next_prompt_estimate_tokens);
  const actualUsed = firstFiniteNumber(budget.latest_actual_input_tokens);
  const used = firstFiniteNumber(
    meterUsed,
    nextEstimate,
    actualUsed,
    budget.latest_request_input_tokens,
    budget.full_context_estimate,
    budget.prompt_tokens,
    budget.pending_estimate
  );
  const cap = firstFiniteNumber(budget.effective_context_window, budget.window, budget.context_window);
  const ratio = firstFiniteNumber(budget.context_meter_ratio, used && cap ? used / cap : null, budget.usage_ratio);
  return normalizeContextUsage({
    used,
    cap,
    window: firstFiniteNumber(budget.effective_context_window, budget.window, budget.context_window, cap),
    inputLimit: firstFiniteNumber(budget.budget_input_limit, budget.input_limit, cap),
    autoCompactRatio: firstFiniteNumber(budget.auto_compact_ratio),
    autoCompactLimit: firstFiniteNumber(budget.auto_compact_limit, budget.budget_input_limit),
    ratio,
    source: meterUsed
      ? (budget.context_meter_source || "next_prompt_estimate")
      : nextEstimate
        ? "next_prompt_estimate"
        : actualUsed
          ? "provider_actual"
          : (budget.context_usage_source || extra.source || "runtime_estimate"),
    trigger: extra.trigger,
    fits: typeof budget.fits === "boolean" ? budget.fits : null,
  });
}

function normalizeContextUsage({ used, cap, window, inputLimit, ratio, autoCompactRatio, autoCompactLimit, source, trigger, fits, modelAssisted, compacted, noBenefit } = {}) {
  const safeUsed = firstFiniteNumber(used);
  const safeCap = firstFiniteNumber(cap, inputLimit, window);
  const safeRatio = firstFiniteNumber(ratio, safeUsed && safeCap ? safeUsed / safeCap : null);
  if (!safeUsed && !safeRatio) {
    return null;
  }
  return {
    used: Math.max(0, Math.round(safeUsed || 0)),
    cap: safeCap ? Math.max(1, Math.round(safeCap)) : null,
    window: window ? Math.max(1, Math.round(window)) : null,
    inputLimit: inputLimit ? Math.max(1, Math.round(inputLimit)) : null,
    autoCompactRatio: Number.isFinite(autoCompactRatio) ? autoCompactRatio : state.autoCompactRatio,
    autoCompactLimit: Number.isFinite(autoCompactLimit)
      ? Math.max(1, Math.round(autoCompactLimit))
      : (safeCap ? Math.floor(safeCap * state.autoCompactRatio) : null),
    ratio: Number.isFinite(safeRatio) ? Math.max(0, safeRatio) : null,
    source: source || "unknown",
    trigger: trigger || null,
    fits,
    modelAssisted,
    compacted,
    noBenefit: Boolean(noBenefit),
    updatedAt: new Date().toISOString(),
  };
}

function renderContextUsage() {
  const usage = state.contextUsage;
  ui.contextMeter.classList.remove("normal", "warning", "high", "critical", "unknown");
  if (!usage) {
    ui.contextMeter.classList.add("unknown");
    setContextMeterBloodFill(0);
    ui.contextUsagePercent.textContent = "--";
    ui.contextUsageDetail.textContent = t("game.context.afterTurn");
    ui.contextUsageStatus.textContent = t("game.context.notStarted");
    ui.contextMeter.setAttribute("aria-label", t("game.context.meterAria"));
    ui.contextMeter.title = t("game.context.waitingTitle");
    return;
  }
  if (usage.reestimating) {
    ui.contextMeter.classList.add("unknown");
    ui.contextUsagePercent.textContent = "…";
    ui.contextUsageDetail.textContent = t("game.context.reestimating");
    ui.contextUsageStatus.textContent = t("game.context.compactedWaitingBaseline");
    ui.contextMeter.setAttribute("aria-label", t("game.context.reestimatingAria"));
    ui.contextMeter.title = t("game.context.reestimatingTitle");
    return;
  }

  const ratio = Number.isFinite(usage.ratio) ? usage.ratio : (usage.used && usage.cap ? usage.used / usage.cap : null);
  const level = contextUsageLevel(ratio, usage);
  ui.contextMeter.classList.add(level.className);
  const percent = Number.isFinite(ratio) ? Math.max(0, Math.round(ratio * 100)) : null;
  setContextMeterBloodFill(ratio);
  ui.contextUsagePercent.textContent = Number.isFinite(ratio)
    ? `${percent}%`
    : "OK";
  ui.contextUsageDetail.textContent = usage.cap
    ? t(usage.sessionContext ? "game.context.estimatedWithCap" : "game.context.usageWithCap",
      { used: formatTokenCount(usage.used), cap: formatTokenCount(usage.cap) })
    : t("game.context.usageWithoutCap", { used: formatTokenCount(usage.used) });
  const autoCompactText = usage.sessionContext && !usage.compactionAvailable ? t("game.context.compactionPending") : usage.autoCompactLimit
    ? t("game.context.autoCompact", {
        limit: formatTokenCount(usage.autoCompactLimit),
        ratio: Math.round((usage.autoCompactRatio || state.autoCompactRatio) * 100),
      })
    : t("game.context.autoCompactWaiting");
  const sourceText = usage.sessionContext && !usage.includesPlayerInput ? t("game.context.sourceBaseline") : usage.source === "next_prompt_estimate"
    ? t("game.context.sourceNext")
    : t(usage.source === "provider_actual" ? "game.context.sourceActual" : "game.context.sourceRuntime");
  ui.contextUsageStatus.textContent = `${level.label} · ${autoCompactText} · ${sourceText}`;
  if (usage.sessionContext && usage.latestActualInputTokens !== null) {
    ui.contextUsageStatus.textContent += ` · ${t("game.context.lastActual", { tokens: formatTokenCount(usage.latestActualInputTokens) })}`;
  }
  if (usage.noBenefit) {
    ui.contextUsageStatus.textContent = t("game.context.noBenefit");
  }
  const labelDetail = `${ui.contextUsageDetail.textContent} · ${ui.contextUsageStatus.textContent}`;
  const meterLabel = t("game.context.usageAria", {
    percent: Number.isFinite(percent) ? `${percent}%` : t("debug.metrics.estimated"),
    detail: labelDetail,
  });
  ui.contextMeter.setAttribute("aria-label", meterLabel);
  ui.contextMeter.title = meterLabel;
}

function setOperationStatus(patch = {}) {
  state.operationStatus = {
    ...state.operationStatus,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => typeof value === "string" && value.trim())
    ),
  };
  renderOperationStatus();
}

function renderOperationStatus() {
  if (ui.operationOutputStatus) {
    ui.operationOutputStatus.textContent = state.operationStatus.output || t("game.operations.standby");
  }
  if (ui.operationToolStatus) {
    ui.operationToolStatus.textContent = state.operationStatus.tool || t("game.operations.noAction");
  }
  if (ui.operationContextStatus) {
    ui.operationContextStatus.textContent = state.operationStatus.context || t("game.operations.notMaintained");
  }
}

function renderLoadedSkillSlots() {
  renderStoryNotebookModuleCount();
  if (!ui.modSlots) {
    return;
  }
  const modules = Array.isArray(state.skillModules) ? state.skillModules : [];
  const characterAvailable = Boolean(state.characterPanelEntry?.panelRef);
  const characterResolving = !characterAvailable
    && state.characterPanelSupported === null
    && state.characterPanelRefreshBusy
    && state.gameStarted
    && Boolean(state.activeSaveId);
  const characterRetryable = !characterAvailable
    && Boolean(state.characterPanelRefreshError)
    && state.gameStarted
    && Boolean(state.activeSaveId);
  const showCharacterSlot = characterAvailable || characterResolving || characterRetryable;
  ui.modSlots.replaceChildren();
  ui.modSlots.classList.toggle("empty", modules.length === 0 && !showCharacterSlot);
  if (ui.modSlotKicker) {
    ui.modSlotKicker.textContent = state.skillModuleRefreshError
      ? t("skillPanel.refreshUnavailableShort")
      : (state.gameStarted ? t("skillPanel.lockedCount", { count: modules.length }) : t("skillPanel.notLoaded"));
  }
  if (showCharacterSlot) {
    const characterChip = document.createElement("button");
    characterChip.type = "button";
    characterChip.className = "mod-slot-chip character-slot-chip";
    characterChip.textContent = t("game.characterSlot.title");
    const label = t(characterRetryable
      ? "game.notebook.charactersRetry"
      : "game.notebook.charactersOpen");
    characterChip.title = label;
    characterChip.setAttribute("aria-label", label);
    characterChip.disabled = state.busy || state.characterPanelRefreshBusy;
    characterChip.addEventListener("click", () => openStoryNotebookDrawer("characters", characterChip));
    ui.modSlots.appendChild(characterChip);
  }
  if (!modules.length && !showCharacterSlot) {
    const empty = document.createElement("span");
    empty.className = "mod-slot-empty";
    empty.textContent = state.skillModuleRefreshError
      ? t("skillPanel.retainFailed")
      : t("skillPanel.noSkills");
    ui.modSlots.appendChild(empty);
  }
  for (const module of modules) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "mod-slot-chip ok";
    const summaryText = (module.summary || []).map((entry) => entry.text).join(" / ");
    chip.textContent = [module.title, summaryText].filter(Boolean).join(" · ");
    chip.title = summaryText ? `${module.title} / ${summaryText}` : module.title;
    chip.setAttribute("aria-label", summaryText
      ? t("skillPanel.openAriaWithSummary", { title: module.title, summary: summaryText })
      : t("skillPanel.openAria", { title: module.title }));
    chip.addEventListener("click", () => openSkillModuleDialog(module, chip));
    ui.modSlots.appendChild(chip);
  }
}

async function refreshSkillModules() {
  if (!state.gameStarted || !state.activeSaveId || typeof window.greyCrow?.listSkillModules !== "function") {
    state.skillModules = [];
    state.skillModuleRefreshError = "";
    renderLoadedSkillSlots();
    if (isStoryNotebookDrawerOpen("modules")) renderStoryNotebookDrawer({ preserveScroll: true });
    return false;
  }
  const binding = captureRuntimeViewBinding();
  try {
    const result = await window.greyCrow.listSkillModules();
    if (!isRuntimePanelResultCurrent(binding, result)) return false;
    if (result.status && applyStatus(result.status) === false) return false;
    if (!result.ok || !Array.isArray(result.modules)) {
      state.skillModuleRefreshError = formatError(result.error, t("skillPanel.refreshUnavailable"));
      renderLoadedSkillSlots();
      renderOpenSkillModuleRefreshError();
      if (isStoryNotebookDrawerOpen("modules")) renderStoryNotebookDrawer({ preserveScroll: true });
      return false;
    }
    state.skillModules = result.modules;
    state.skillModuleRefreshError = "";
    renderLoadedSkillSlots();
    const moduleDetailOpen = isStoryNotebookDrawerOpen("modules") && state.notebookDrawerView === "module-detail";
    if ((ui.skillModuleDialog.open || moduleDetailOpen) && state.activeSkillModule) {
      const refreshed = findMatchingSkillModule(state.activeSkillModule);
      if (!refreshed) {
        if (ui.skillModuleDialog.open) closeSkillModuleDialog();
        if (moduleDetailOpen) {
          state.activeSkillModule = null;
          state.skillModulePages.clear();
          state.notebookDrawerView = "module-list";
          renderStoryNotebookDrawer();
        }
      } else {
        if (refreshed.revision !== state.activeSkillModule.revision) state.skillModulePages.clear();
        state.activeSkillModule = refreshed;
        renderActiveSkillModuleSurfaces();
      }
    } else if (isStoryNotebookDrawerOpen("modules")) {
      renderStoryNotebookDrawer({ preserveScroll: true });
    }
    return true;
  } catch (error) {
    if (!isRuntimeViewBindingCurrent(binding)) return false;
    state.skillModuleRefreshError = formatError(error, t("skillPanel.refreshUnavailable"));
    renderLoadedSkillSlots();
    renderOpenSkillModuleRefreshError();
    if (isStoryNotebookDrawerOpen("modules")) renderStoryNotebookDrawer({ preserveScroll: true });
    return false;
  }
}

function findMatchingSkillModule(module) {
  if (module.moduleRef) return state.skillModules.find((entry) => entry.moduleRef === module.moduleRef) || null;
  return state.skillModules.find((entry) => !entry.moduleRef && entry.title === module.title && entry.packTitle === module.packTitle) || null;
}

function openSkillModuleDialog(module, opener) {
  state.activeSkillModule = module;
  state.skillModulePages.clear();
  state.skillModuleOpener = opener || document.activeElement;
  renderSkillModuleDialog();
  ui.skillModuleDialog.showModal();
  ui.closeSkillModuleButton.focus();
}

function closeSkillModuleDialog() {
  if (ui.skillModuleDialog.open) ui.skillModuleDialog.close();
}

function restoreSkillModuleFocus() {
  const opener = state.skillModuleOpener;
  state.activeSkillModule = null;
  state.skillModulePages.clear();
  state.skillModuleOpener = null;
  if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
}

function renderOpenSkillModuleRefreshError() {
  if (ui.skillModuleDialog.open && state.skillModuleRefreshError) {
    ui.skillModuleStatus.textContent = t("skillPanel.refreshRetaining");
  }
}

function renderSkillModuleDialog() {
  const module = state.activeSkillModule;
  if (!module) return;
  ui.skillModuleTitle.textContent = module.title || t("game.notebook.skillEyebrow");
  ui.skillModuleStatus.textContent = state.skillModuleRefreshError
    ? t("skillPanel.refreshRetaining")
    : t("skillPanel.status");
  renderSafeSkillGuide(module.playerGuide || module.description || t("skillPanel.noGuide"));
  renderSkillModuleFields(module, { showWidgetLabel: false });
}

function renderActiveSkillModuleSurfaces({ preserveScroll = true } = {}) {
  if (ui.skillModuleDialog.open && state.activeSkillModule) renderSkillModuleDialog();
  if (isStoryNotebookDrawerOpen("modules") && state.notebookDrawerView === "module-detail") {
    renderStoryNotebookDrawer({ preserveScroll });
  }
}

function renderSafeSkillGuide(value, container = ui.skillModuleGuide) {
  container.replaceChildren();
  const lines = String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s{0,3}(?:#{1,6}|[-*])\s*/, "").replace(/[*_`]/g, "").trim())
    .filter(Boolean);
  for (const line of lines.length ? lines : [t("skillPanel.noGuide")]) {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    container.appendChild(paragraph);
  }
}

function renderSkillModuleFields(module, options = {}) {
  const container = options.container || ui.skillModuleFields;
  container.replaceChildren();
  if (!module.hasModule) {
    appendSkillModuleEmpty(t("skillPanel.noStateModule"), container);
    return;
  }
  if (!Array.isArray(module.fields) || !module.fields.length) {
    appendSkillModuleEmpty(t("skillPanel.noFields"), container);
    return;
  }
  for (const field of module.fields) container.appendChild(renderSkillModuleField(module, field, options));
}

function appendSkillModuleEmpty(message, container = ui.skillModuleFields) {
  const empty = document.createElement("p");
  empty.className = "skill-module-empty";
  empty.textContent = message;
  container.appendChild(empty);
}

function renderSkillModuleField(module, field, options = {}) {
  const card = document.createElement("article");
  card.className = "skill-module-field";
  const header = document.createElement("div");
  header.className = "skill-module-field-header";
  const label = document.createElement("strong");
  label.textContent = field.label;
  header.appendChild(label);
  if (options.showWidgetLabel !== false) {
    const kind = document.createElement("span");
    kind.textContent = skillModuleWidgetLabel(field.widget);
    header.appendChild(kind);
  }
  card.appendChild(header);

  if ((field.type === "integer" || field.type === "number") && ["progress", "meter"].includes(field.widget)) {
    card.appendChild(renderSkillModuleProgress(field));
  } else if (field.type === "string_list") {
    card.appendChild(renderSkillModuleStringList(field));
  } else if (field.type === "record_list") {
    card.appendChild(renderSkillModuleRecordField(module, field, options));
  } else {
    const value = document.createElement("div");
    value.className = "skill-module-value";
    value.textContent = formatSkillModuleValue(field, field.value);
    card.appendChild(value);
  }
  return card;
}

function renderSkillModuleProgress(field) {
  const row = document.createElement("div");
  row.className = "skill-module-progress";
  const minimum = Number.isFinite(field.minimum) ? field.minimum : 0;
  const maximum = Number.isFinite(field.maximum) ? field.maximum : Math.max(minimum + 1, Number(field.value) || 1);
  const value = Math.min(maximum, Math.max(minimum, Number(field.value) || 0));
  const track = document.createElement("div");
  track.className = "skill-module-progress-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", field.label);
  track.setAttribute("aria-valuemin", String(minimum));
  track.setAttribute("aria-valuemax", String(maximum));
  track.setAttribute("aria-valuenow", String(value));
  track.setAttribute("aria-valuetext", `${value} / ${maximum}`);
  const fill = document.createElement("div");
  fill.className = "skill-module-progress-fill";
  fill.style.width = `${Math.max(0, Math.min(100, ((value - minimum) / (maximum - minimum)) * 100))}%`;
  track.appendChild(fill);
  const text = document.createElement("strong");
  text.textContent = `${value} / ${maximum}`;
  row.append(track, text);
  return row;
}

function renderSkillModuleStringList(field) {
  const list = document.createElement("div");
  list.className = field.widget === "chips" ? "skill-module-chips" : "skill-module-records";
  const values = Array.isArray(field.value) ? field.value : [];
  if (!values.length) {
    const empty = document.createElement("span");
    empty.className = "skill-module-empty";
    empty.textContent = t("skillPanel.noRecords");
    list.appendChild(empty);
    return list;
  }
  for (const item of values) {
    const entry = document.createElement(field.widget === "chips" ? "span" : "div");
    entry.className = field.widget === "chips" ? "skill-module-chip" : "skill-module-value";
    entry.textContent = String(item);
    list.appendChild(entry);
  }
  return list;
}

function renderSkillModuleRecordField(module, field, options = {}) {
  const wrapper = document.createElement("div");
  const derived = field.derivedSummary || {};
  const summary = document.createElement("p");
  summary.className = "skill-module-derived";
  summary.textContent = [
    Number.isFinite(derived.target) ? `${derived.count || 0}/${derived.target}` : t("skillPanel.recordCount", { count: derived.count || 0 }),
    derived.milestoneLabel,
  ].filter(Boolean).join(" · ");
  wrapper.appendChild(summary);
  if (Array.isArray(derived.groupCounts) && derived.groupCounts.length) {
    const groups = document.createElement("div");
    groups.className = "skill-module-group-counts";
    for (const group of derived.groupCounts) {
      const chip = document.createElement("span");
      chip.className = "skill-module-chip";
      chip.textContent = t("skillPanel.groupCount", { label: group.label, count: group.count });
      groups.appendChild(chip);
    }
    wrapper.appendChild(groups);
  }
  const interactive = options.interactive !== false;
  const pages = options.pages || state.skillModulePages;
  const page = pages.get(field.id);
  const projectedRecords = !interactive && Array.isArray(field.value) ? field.value : null;
  const records = document.createElement("div");
  records.className = "skill-module-records";
  if (projectedRecords?.length || page?.items?.length) {
    for (const item of projectedRecords || page.items) records.appendChild(renderSkillModuleRecordCard(field, item));
  } else {
    const empty = document.createElement("p");
    empty.className = "skill-module-empty";
    empty.textContent = t((derived.count || 0) > 0 ? "skillPanel.recordsNotLoaded" : "skillPanel.noRecords");
    records.appendChild(empty);
  }
  wrapper.appendChild(records);
  if (interactive && (derived.count || 0) > 0 && (!page || page.hasMore)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-button skill-module-load-button";
    button.textContent = t(page ? "skillPanel.loadMore" : "skillPanel.viewRecords");
    button.disabled = page?.loading === true;
    button.addEventListener("click", () => loadSkillModuleFieldPage(module, field, Boolean(page)));
    wrapper.appendChild(button);
  }
  if (interactive && page?.error) {
    const status = document.createElement("p");
    status.className = "skill-module-page-status";
    status.textContent = page.error;
    wrapper.appendChild(status);
  } else if (interactive && page) {
    const status = document.createElement("p");
    status.className = "skill-module-page-status";
    status.textContent = t("skillPanel.recordsShown", { shown: page.items.length, total: page.total });
    wrapper.appendChild(status);
  }
  return wrapper;
}

function renderSkillModuleRecordCard(field, item) {
  const card = document.createElement("div");
  card.className = "skill-module-record-card";
  for (const meta of field.itemFields || []) {
    const label = document.createElement("span");
    label.textContent = meta.label;
    const value = document.createElement("strong");
    value.textContent = formatSkillModuleItemValue(meta, item?.[meta.id]);
    card.append(label, value);
  }
  return card;
}

async function loadSkillModuleFieldPage(module, field, append) {
  if (!module.moduleRef || typeof window.greyCrow?.getSkillModule !== "function") return;
  const binding = captureRuntimeViewBinding();
  const isCurrentModule = () => isRuntimeViewBindingCurrent(binding) && state.activeSkillModule?.moduleRef === module.moduleRef
    && state.activeSkillModule?.revision === module.revision;
  const previous = state.skillModulePages.get(field.id) || { items: [], cursor: null, hasMore: true, total: field.derivedSummary?.count || 0 };
  state.skillModulePages.set(field.id, { ...previous, loading: true, error: "" });
  renderActiveSkillModuleSurfaces();
  try {
    const result = await window.greyCrow.getSkillModule(module.moduleRef, {
      fieldId: field.id,
      cursor: append ? previous.cursor : null,
      limit: 12,
    });
    if (!isCurrentModule() || !isRuntimePanelResultCurrent(binding, result)) return;
    if (result.status && applyStatus(result.status) === false) return;
    if (!result.ok || !result.module?.pagination) {
      state.skillModulePages.set(field.id, { ...previous, loading: false, error: formatError(result.error, t("skillPanel.recordsUnavailable")) });
      renderActiveSkillModuleSurfaces();
      return;
    }
    if (binding.sessionMode && (result.module.moduleRef !== module.moduleRef || result.module.revision !== binding.revision)) return;
    const projectedField = result.module.fields?.[0];
    const items = append ? [...previous.items, ...(projectedField?.value || [])] : [...(projectedField?.value || [])];
    state.skillModulePages.set(field.id, {
      items,
      cursor: result.module.pagination.nextCursor,
      hasMore: result.module.pagination.hasMore,
      total: result.module.pagination.totalItems,
      loading: false,
      error: "",
    });
    renderActiveSkillModuleSurfaces();
  } catch (error) {
    if (!isCurrentModule()) return;
    state.skillModulePages.set(field.id, { ...previous, loading: false, error: formatError(error, t("skillPanel.recordsUnavailable")) });
    renderActiveSkillModuleSurfaces();
  }
}

function formatSkillModuleValue(field, value) {
  if (field.type === "boolean") return t(value ? "skillPanel.value.enabled" : "skillPanel.value.disabled");
  if (field.type === "enum") return field.options?.find((option) => option.value === value)?.label || String(value ?? t("game.unknown"));
  return value === "" || value === null || value === undefined ? t("skillPanel.value.empty") : String(value);
}

function formatSkillModuleItemValue(meta, value) {
  if (meta.type === "boolean") return t(value ? "common.yes" : "common.no");
  if (meta.type === "enum") return meta.options?.find((option) => option.value === value)?.label || String(value ?? t("game.unknown"));
  return value === "" || value === null || value === undefined ? t("skillPanel.value.empty") : String(value);
}

function skillModuleWidgetLabel(widget) {
  const keys = {
    number: "creator.module.widget.number", progress: "creator.module.widget.progress", meter: "creator.module.widget.meter",
    text: "creator.module.widget.text", multiline: "creator.module.widget.multiline", indicator: "creator.module.widget.indicator",
    badge: "creator.module.widget.badge", chips: "creator.module.widget.chips", list: "creator.module.widget.list",
    cards: "creator.module.widget.cards", timeline: "creator.module.widget.timeline", table: "creator.module.widget.table",
  };
  return t(keys[widget] || "creator.module.widget.indicator");
}

function updateOperationStatusFromEnvelope(envelope = {}) {
  const meta = envelope.meta || {};
  const trace = meta.operation_trace || {};
  const tools = trace.tools || meta.tools || {};
  const developer = trace.developer_summary || {};
  const toolCalls = firstFiniteNumber(tools.executed, tools.ok_count, tools.error_count) || 0;
  const toolErrors = firstFiniteNumber(tools.error_count) || 0;
  const writeCount = Array.isArray(developer.save_writes) ? developer.save_writes.length : 0;
  const compaction = meta.compaction || trace.memory?.compaction || {};
  const saveNode = meta.save_node || {};
  const contextText = compaction.compacted
    ? t("game.operations.autoCompacted")
    : (compaction.skipped || compaction.reason ? t("game.operations.contextChecked") : state.operationStatus.context);
  setOperationStatus({
    output: t("game.operations.returned"),
    tool: (saveNode.chapter_generated || envelope.chapterSummary?.chapterStatus === "created")
      ? t("game.operations.autoSaveChapter")
      : formatOperationToolStatus({ toolCalls, writeCount, toolErrors }),
    context: contextText,
  });
}

function formatOperationToolStatus({ toolCalls = 0, writeCount = 0, toolErrors = 0 } = {}) {
  const parts = [];
  if (writeCount) {
    parts.push(t("game.operations.writeCount", { count: writeCount }));
  }
  if (toolCalls) {
    parts.push(t("game.operations.callCount", { count: toolCalls }));
  }
  if (toolErrors) {
    parts.push(t("game.operations.errorCount", { count: toolErrors }));
  }
  return parts.length ? parts.join(" / ") : t("game.operations.noWrites");
}

function setContextMeterBloodFill(ratio) {
  if (!ui.contextMeterBloodFill) {
    return;
  }
  const safeRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const viewBoxHeight = 64;
  const fillHeight = safeRatio * viewBoxHeight;
  ui.contextMeterBloodFill.setAttribute("y", formatSvgNumber(viewBoxHeight - fillHeight));
  ui.contextMeterBloodFill.setAttribute("height", formatSvgNumber(fillHeight));
}

function formatSvgNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function contextUsageLevel(ratio, usage = {}) {
  if (!Number.isFinite(ratio)) {
    return { className: "unknown", label: t("game.context.levelUnknown") };
  }
  const autoRatio = Number.isFinite(usage.autoCompactRatio) ? usage.autoCompactRatio : state.autoCompactRatio;
  const warningRatio = Math.max(0.5, autoRatio - 0.1);
  if (ratio >= 0.9) {
    return { className: "critical", label: t("game.context.levelCritical") };
  }
  if (ratio >= autoRatio) {
    return { className: "high", label: t("game.context.levelHigh") };
  }
  if (ratio >= warningRatio) {
    return { className: "warning", label: t("game.context.levelWarning") };
  }
  return { className: "normal", label: t("game.context.levelNormal") };
}

function formatTokenCount(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value >= 1000) {
    const rounded = Math.round(value / 100) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}k`;
  }
  return String(Math.round(value));
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return null;
}

function getDisplayLocale() {
  const raw = document.documentElement?.lang || DEFAULT_DISPLAY_LOCALE;
  const locale = String(raw || "").trim();
  if (/^en\b/i.test(locale)) {
    return "en-US";
  }
  if (/^ja\b/i.test(locale)) {
    return "ja-JP";
  }
  return "zh-CN";
}

function getDisplayLabel(key, locale = getDisplayLocale()) {
  return DISPLAY_LABELS[locale]?.[key] || DISPLAY_LABELS[DEFAULT_DISPLAY_LOCALE][key] || "";
}

function formatLocationDisplay(scene = {}, locale = getDisplayLocale()) {
  const source = scene && typeof scene === "object" ? scene : {};
  const directLabel = selectLocalizedLabel(
    source.localized_names ||
      source.localizedNames ||
      source.location_names ||
      source.locationNames ||
      source.location_label ||
      source.locationLabel ||
      source.location_name ||
      source.locationName ||
      source.name,
    locale
  );
  if (directLabel) {
    return directLabel;
  }

  const rawLocation = source.location ?? source.id;
  const mapped = selectLocalizedLabel(LOCATION_DISPLAY_NAMES[normalizeDisplayKey(rawLocation)], locale);
  if (mapped) {
    return mapped;
  }

  return formatUnmappedDisplayText(rawLocation, "unknownLocation", locale);
}

function formatPlayerStatusDisplay(player = {}, locale = getDisplayLocale(), { preserveSourceText = false } = {}) {
  const source = player && typeof player === "object" ? player : {};
  // A Session status is the formal character condition, not an internal label to interpret.
  // Keep qualifications and whitespace; secrets still use the display redactor.
  if (preserveSourceText && typeof source.status === "string" && source.status.trim()
    && normalizeDisplayKey(source.status) !== "unknown") return redactDisplaySecrets(source.status);
  const directLabel = selectLocalizedLabel(
    source.localized_status ||
      source.localizedStatus ||
      source.status_label ||
      source.statusLabel ||
      source.status_name ||
      source.statusName,
    locale
  );
  if (directLabel) {
    return directLabel;
  }

  const rawStatus = source.status;
  if (normalizeDisplayKey(rawStatus) === "unknown") {
    return getDisplayLabel("unknownStatus", locale);
  }

  return formatUnmappedDisplayText(rawStatus, "unknownStatus", locale);
}

function selectLocalizedLabel(value, locale = getDisplayLocale()) {
  if (typeof value === "string") {
    return normalizeReadableDisplayText(value, locale);
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const candidates = [
    value[locale],
    value[locale.toLowerCase()],
    value[locale.replace("-", "_")],
    value[locale.split("-")[0]],
    value[DEFAULT_DISPLAY_LOCALE],
    value[DEFAULT_DISPLAY_LOCALE.toLowerCase()],
    value.default,
    value.name,
    value.label,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeReadableDisplayText(candidate, locale);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function formatUnmappedDisplayText(value, fallbackKey, locale = getDisplayLocale()) {
  const normalized = normalizeReadableDisplayText(value, locale);
  if (normalized) {
    return normalized;
  }
  return getDisplayLabel(fallbackKey, locale);
}

function normalizeReadableDisplayText(value, locale = getDisplayLocale()) {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.trim();
  if (!text) {
    return "";
  }
  const stripped = stripInternalDisplayRefs(text);
  if (stripped && stripped !== text) {
    return stripped;
  }
  if (isInternalDisplaySlug(text)) {
    return "";
  }
  return text;
}

function normalizeDisplayKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isInternalDisplaySlug(value) {
  const text = String(value || "").trim();
  return (
    /^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(text) ||
    /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/.test(text) ||
    isLowerKebabInternalSlug(text) ||
    /[（(]\s*[A-Za-z][A-Za-z0-9_-]{2,}\s*[）)]/.test(text) ||
    /\b[a-z]{3,}[A-Z][A-Za-z0-9]*\b/.test(text)
  );
}

function stripInternalDisplayRefs(value) {
  const stripped = String(value || "")
    .replace(/[（(]\s*[A-Za-z][A-Za-z0-9_-]{2,}\s*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped && !isInternalDisplaySlug(stripped) ? stripped : "";
}

function isLowerKebabInternalSlug(value) {
  const text = String(value || "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(text)) {
    return false;
  }
  return INTERNAL_DISPLAY_SLUG_HINT_RE.test(text);
}

function addStateCell(label, value, options = {}) {
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  if (options.key) {
    labelNode.dataset.stateKey = options.key;
    labelNode.dataset.stateRole = "label";
    valueNode.dataset.stateKey = options.key;
    valueNode.dataset.stateRole = "value";
  }
  if (options.id) {
    valueNode.id = options.id;
    ui.modelStatusText = valueNode;
  }
  valueNode.textContent = value;
  if (options.key === "player") valueNode.title = value;
  ui.stateGrid.append(labelNode, valueNode);
}

function appendNarration(kind, content, { autoSpeak = true, animate = true, deferTypewriter = false, preserveDelivery = false, turnFailure = false } = {}) {
  if (!preserveDelivery) flushNarrationDelivery();
  const followTail = narrationPanelNearBottom();
  const displayContent = kind === "host" ? stripInternalDisplayBlocks(content) : content;
  const safeContent = redactDisplaySecrets(displayContent);
  const ttsContent = normalizeTtsDisplayText(safeContent);
  const line = document.createElement("p");
  line.className = `narration-line ${kind}`;
  const textNode = document.createElement("span");
  textNode.className = "narration-text";
  line.narrationTextNode = textNode;
  if (kind === "host" && safeContent.length > 0) {
    if (!animate) textNode.textContent = safeContent;
    line.appendChild(textNode);
    if (ttsContent) {
      const ttsButton = document.createElement("button");
      ttsButton.className = "tts-line-button";
      ttsButton.type = "button";
      ttsButton.textContent = ">";
      ttsButton.title = t("tts.readSegment");
      ttsButton.setAttribute("aria-label", t("tts.readSegment"));
      ttsButton.addEventListener("click", () => synthesizeAndPlayTts(ttsContent, { manual: true }));
      line.appendChild(ttsButton);
      if (state.ttsAuto && autoSpeak) {
        synthesizeAndPlayTts(ttsContent, { manual: false });
      }
    }
  } else {
    textNode.textContent = safeContent;
    line.appendChild(textNode);
  }
  ui.narrationPanel.appendChild(line);
  if (turnFailure) {
    state.turnFailureNotice = { line, adventureId: state.activeSaveId, sessionId: state.runtimeSessionId };
    renderTurnStatus();
  }
  if (followTail) ui.narrationPanel.scrollTop = ui.narrationPanel.scrollHeight;
  if (kind === "host" && safeContent.length > 0 && animate && !deferTypewriter) {
    renderTypewriterText(textNode, safeContent);
  }
  return line;
}

function renderTypewriterText(node, text, onComplete = null) {
  const value = String(text || "");
  const units = typewriterUnits(value);
  if (!units.length || prefersReducedUiMotion()) {
    node.textContent = value;
    onComplete?.();
    return;
  }
  // A fixed, legible rate gives longer passages proportionally more reading
  // time instead of making every paragraph finish in roughly two seconds.
  const chunkSize = 1;
  let index = 0;
  const timer = window.setInterval(() => {
    const followTail = narrationPanelNearBottom();
    const stop = Math.min(units.length, index + chunkSize);
    let chunk = "";
    while (index < stop) chunk += units[index++];
    node.textContent += chunk;
    if (followTail) ui.narrationPanel.scrollTop = ui.narrationPanel.scrollHeight;
    if (index >= units.length) {
      window.clearInterval(timer);
      state.typewriterTimers.delete(timer);
      onComplete?.();
    }
  }, 24);
  state.typewriterTimers.add(timer);
}

function narrationPanelNearBottom() {
  const panel = ui.narrationPanel;
  const scrollHeight = Number(panel?.scrollHeight);
  const clientHeight = Number(panel?.clientHeight);
  const scrollTop = Number(panel?.scrollTop);
  if (![scrollHeight, clientHeight, scrollTop].every(Number.isFinite)) return true;
  return scrollTop >= scrollHeight - clientHeight - 24;
}

function typewriterUnits(value) {
  const text = String(value || "");
  if (typeof Intl?.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

function queueCommittedNarrationSegments(segments = [], actionId = null, deferred = null) {
  const visible = Array.isArray(segments) ? segments.filter((segment) =>
    typeof segment?.content === "string" && (segment.type !== "host" || segment.content.trim())) : [];
  if (!visible.length) return;
  // A later committed receipt cannot silently discard an earlier committed tail.
  flushNarrationDelivery();
  let settle;
  const delivery = { epoch: ++state.narrationDeliveryEpoch, actionId, segments: visible, index: 0,
    current: null, completion: new Promise((resolve) => { settle = resolve; }), settle };
  state.narrationDelivery = delivery;
  if (!deferred) {
    deliverNextNarrationSegment(delivery);
    return;
  }
  void beginDeferredNarrationDelivery(delivery, deferred);
}

async function beginDeferredNarrationDelivery(delivery, { binding, onStarted } = {}) {
  const readable = await waitForNotebookReading(binding);
  if (!readable || state.narrationDelivery !== delivery || state.narrationDeliveryEpoch !== delivery.epoch
    || !isRuntimeViewBindingCurrent(binding)) {
    finishNarrationDelivery(delivery, false);
    return;
  }
  onStarted?.();
  deliverNextNarrationSegment(delivery);
}

function deliverNextNarrationSegment(delivery) {
  if (state.narrationDelivery !== delivery || state.narrationDeliveryEpoch !== delivery.epoch) return;
  const segment = delivery.segments[delivery.index++];
  if (!segment) {
    finishNarrationDelivery(delivery, true);
    return;
  }
  const next = () => deliverNextNarrationSegment(delivery);
  if (segment.type === "host") {
    const line = appendNarration("host", segment.content, { autoSpeak: false, deferTypewriter: true, preserveDelivery: true });
    delivery.current = { line, textNode: line.narrationTextNode, content: segment.content };
    renderTypewriterText(delivery.current.textNode, segment.content, () => {
      if (state.narrationDelivery !== delivery || state.narrationDeliveryEpoch !== delivery.epoch) return;
      delivery.current = null;
      next();
    });
  } else {
    appendNarration(segment.type, segment.content, { autoSpeak: false, animate: false, preserveDelivery: true });
    next();
  }
}

function flushNarrationDelivery() {
  const delivery = state.narrationDelivery;
  if (!delivery) return;
  clearTypewriterTimers({ preserveDelivery: true });
  // The active host line is completed from the committed text before any new
  // player action; remaining segments follow without animation in source order.
  if (delivery.current?.textNode) delivery.current.textNode.textContent = delivery.current.content;
  while (delivery.index < delivery.segments.length) {
    const segment = delivery.segments[delivery.index++];
    appendNarration(segment.type, segment.content, { autoSpeak: false, animate: false, preserveDelivery: true });
  }
  finishNarrationDelivery(delivery, true);
}

function clearTypewriterTimers({ preserveDelivery = false } = {}) {
  for (const timer of state.typewriterTimers) {
    window.clearInterval(timer);
  }
  state.typewriterTimers.clear();
  if (!preserveDelivery) {
    const delivery = state.narrationDelivery;
    state.narrationDeliveryEpoch += 1;
    if (delivery) finishNarrationDelivery(delivery, false);
  }
}

function finishNarrationDelivery(delivery, delivered) {
  if (!delivery || delivery.finished) return;
  delivery.finished = true;
  if (state.narrationDelivery === delivery) state.narrationDelivery = null;
  delivery.settle(Boolean(delivered));
}

function waitForCommittedNarrationDelivery(actionId, binding) {
  const delivery = state.narrationDelivery;
  if (!delivery || delivery.actionId !== actionId) return Promise.resolve(true);
  return delivery.completion.then((delivered) => Boolean(delivered) && isRuntimeViewBindingCurrent(binding));
}

async function testTtsVoice() {
  if (state.busy) {
    return;
  }
  if (state.settingsSaveTask) await state.settingsSaveTask;
  if (state.settingsDirty && !(await saveSettings({ groups: ["audio"] }))) return;
  await synthesizeAndPlayTts("灰鸦正在测试朗读。", { manual: true, test: true });
}

async function synthesizeAndPlayTts(text, { manual = true, test = false } = {}) {
  if (speechAudioFocus) return;
  if (!state.ttsEnabled || state.ttsProvider === "disabled") {
    if (manual) {
      ui.ttsStatus.textContent = t("tts.enableFirst");
      openSettings(t("tts.enableAndSave"), { tab: "audio" });
    }
    return;
  }
  const ttsText = normalizeTtsDisplayText(text);
  if (!ttsText) {
    if (manual) {
      ui.ttsStatus.textContent = t("tts.noText");
    }
    return;
  }
  cancelTtsPlayback({ invalidate: false });
  const requestId = ++state.ttsRequestId;
  try {
    ui.ttsStatus.textContent = t(test ? "tts.generatingTest" : "tts.generating");
    state.ttsPlaybackError = "";
    setTtsPlaybackPhase("generating");
    const result = await window.greyCrow.startTtsUtterance(ttsText);
    if (requestId !== state.ttsRequestId) {
      cancelRemoteTtsUtterance(result?.result?.utteranceId);
      return;
    }
    if (!result.ok || !isPlayableTtsSegment(result.result, null, 0)) {
      const label = getTtsPlaybackFailureLabel(result.error);
      ui.ttsStatus.textContent = label;
      state.ttsPlaybackError = label;
      setTtsPlaybackPhase("error");
      return;
    }

    const utteranceId = result.result.utteranceId;
    state.ttsUtteranceId = utteranceId;
    let segment = result.result;
    let allCacheHits = Boolean(segment.cacheHit);

    while (segment) {
      const nextSegmentPromise = segment.hasMore
        ? Promise.resolve(window.greyCrow.continueTtsUtterance(utteranceId)).catch((error) => ({
            ok: false,
            error: { code: error?.code || "TTS_NEXT_SEGMENT_FAILED" },
          }))
        : null;
      ui.ttsStatus.textContent = t("tts.phase.playing");
      setTtsPlaybackPhase("playing", {
        segmentIndex: segment.segmentIndex,
        segmentCount: segment.segmentCount,
        prefetching: Boolean(nextSegmentPromise),
        cacheHit: Boolean(segment.cacheHit),
      });
      await playTtsAudio(segment.dataUrl);
      if (requestId !== state.ttsRequestId) {
        return;
      }
      if (!nextSegmentPromise) {
        break;
      }

      const next = await nextSegmentPromise;
      const expectedIndex = segment.segmentIndex + 1;
      if (requestId !== state.ttsRequestId) {
        cancelRemoteTtsUtterance(utteranceId);
        return;
      }
      if (!next.ok || !isPlayableTtsSegment(next.result, utteranceId, expectedIndex)) {
        throw new Error(formatError(next.error, t("tts.nextSegmentFailed")));
      }
      segment = next.result;
      allCacheHits = allCacheHits && Boolean(segment.cacheHit);
    }

    if (state.ttsUtteranceId === utteranceId) {
      state.ttsUtteranceId = null;
    }
    ui.ttsStatus.textContent = t(allCacheHits ? "tts.playedCache" : "tts.playedGenerated");
    setTtsPlaybackPhase("completed");
    scheduleTtsIdle(requestId);
  } catch (error) {
    if (requestId === state.ttsRequestId) {
      const label = getTtsPlaybackFailureLabel(error);
      ui.ttsStatus.textContent = label;
      cancelTtsPlayback({ invalidate: false });
      state.ttsPlaybackError = label;
      setTtsPlaybackPhase("error");
    }
  }
}

function setTtsPlaybackPhase(phase, detail = {}) {
  clearTtsStatusResetTimer();
  state.ttsPlaybackPhase = phase;
  if (phase !== "error") state.ttsPlaybackError = "";
  if (phase === "idle" || phase === "generating" || phase === "completed" || phase === "error") {
    state.ttsPlaybackSegmentIndex = null;
    state.ttsPlaybackSegmentCount = null;
    state.ttsPlaybackPrefetching = false;
    state.ttsPlaybackCacheHit = false;
  }
  if (Number.isInteger(detail.segmentIndex)) {
    state.ttsPlaybackSegmentIndex = detail.segmentIndex;
  }
  if (Number.isInteger(detail.segmentCount)) {
    state.ttsPlaybackSegmentCount = detail.segmentCount;
  }
  if (Object.prototype.hasOwnProperty.call(detail, "prefetching")) {
    state.ttsPlaybackPrefetching = Boolean(detail.prefetching);
  }
  if (Object.prototype.hasOwnProperty.call(detail, "cacheHit")) {
    state.ttsPlaybackCacheHit = Boolean(detail.cacheHit);
  }
  renderTtsPlaybackStatus();
}

function renderTtsPlaybackStatus() {
  if (!ui.operationTtsStatus || !ui.ttsPlaybackToggleButton || !ui.ttsPlaybackIcon) {
    return;
  }
  let label = t("game.operations.standby");
  if (state.ttsPlaybackPhase === "generating") {
    label = t("tts.phase.generating");
  } else if (state.ttsPlaybackPhase === "playing") {
    label = t("tts.phase.playing");
  } else if (state.ttsPlaybackPhase === "paused") {
    label = t("tts.phase.paused");
  } else if (state.ttsPlaybackPhase === "completed") {
    label = t("tts.phase.completed");
  } else if (state.ttsPlaybackPhase === "error") {
    label = state.ttsPlaybackError || t("tts.phase.failed");
  }
  ui.operationTtsStatus.textContent = label;
  ui.operationTtsStatus.title = label;
  ui.ttsPlaybackToggleButton.dataset.phase = state.ttsPlaybackPhase;
  const paused = state.ttsPlaybackPhase === "paused";
  const canToggle = (Boolean(state.currentAudio) && (state.ttsPlaybackPhase === "playing" || paused))
    || state.ttsPlaybackPhase === "error";
  ui.ttsPlaybackToggleButton.disabled = speechAudioFocus || !canToggle;
  ui.ttsPlaybackIcon.textContent = paused
    ? "▶"
    : state.ttsPlaybackPhase === "playing" ? "⏸"
      : state.ttsPlaybackPhase === "generating" ? "…"
        : state.ttsPlaybackPhase === "error" ? "!" : "·";
  const actionLabel = state.ttsPlaybackPhase === "error" ? t("tts.openSettings") : t(paused ? "tts.resume" : "game.tts.pause");
  ui.ttsPlaybackToggleButton.setAttribute("aria-label", actionLabel);
  ui.ttsPlaybackToggleButton.title = actionLabel;
}

function toggleTtsPlayback() {
  speechAudioUserRevision++;
  if (speechAudioFocus) return;
  if (state.ttsPlaybackPhase === "error") {
    openSettings("", { tab: "audio" });
    return;
  }
  const audio = state.currentAudio;
  if (!audio || !["playing", "paused"].includes(state.ttsPlaybackPhase)) {
    return;
  }
  if (state.ttsPlaybackPhase === "paused") {
    const playAttempt = startTtsAudioPlayback(audio);
    // `play()` can remain pending while the media pipeline opens.  Mark the
    // intent immediately so a second click can pause that pending resume.
    setTtsPlaybackPhase("playing", {
      segmentIndex: state.ttsPlaybackSegmentIndex,
      segmentCount: state.ttsPlaybackSegmentCount,
      prefetching: state.ttsPlaybackPrefetching,
      cacheHit: state.ttsPlaybackCacheHit,
    });
    playAttempt.promise.catch((error) => {
      if (state.currentAudio !== audio || audio._greyCrowPlaybackAttempt !== playAttempt.id) return;
      const label = getTtsPlaybackFailureLabel(error);
      ui.ttsStatus.textContent = label;
      cancelTtsPlayback();
      state.ttsPlaybackError = label;
      setTtsPlaybackPhase("error");
    });
    return;
  }
  pauseTtsAudioPlayback(audio);
  setTtsPlaybackPhase("paused", {
    segmentIndex: state.ttsPlaybackSegmentIndex,
    segmentCount: state.ttsPlaybackSegmentCount,
    prefetching: state.ttsPlaybackPrefetching,
    cacheHit: state.ttsPlaybackCacheHit,
  });
}

function getTtsPlaybackFailureLabel(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (["KOKORO_MODEL_MISSING", "KOKORO_DEPENDENCY_MISSING"].includes(code)) return t("tts.error.resourceMissing");
  if (code === "TTS_TEXT_TOO_LONG") return t("tts.error.textTooLong");
  if (code === "TTS_PROVIDER_DISABLED") return t("tts.error.disabled");
  if (code === "KOKORO_WORKER_READY_TIMEOUT") return t("tts.error.loadingTimedOut");
  return t("tts.phase.failed");
}

function scheduleTtsIdle(requestId) {
  clearTtsStatusResetTimer();
  state.ttsStatusResetTimer = window.setTimeout(() => {
    state.ttsStatusResetTimer = null;
    if (requestId === state.ttsRequestId && !state.currentAudio) {
      setTtsPlaybackPhase("idle");
    }
  }, 1200);
}

function clearTtsStatusResetTimer() {
  if (state.ttsStatusResetTimer) {
    window.clearTimeout(state.ttsStatusResetTimer);
    state.ttsStatusResetTimer = null;
  }
}

function isPlayableTtsSegment(segment, utteranceId, expectedIndex) {
  return Boolean(
    segment &&
    typeof segment.utteranceId === "string" &&
    (!utteranceId || segment.utteranceId === utteranceId) &&
    segment.segmentIndex === expectedIndex &&
    Number.isInteger(segment.segmentCount) &&
    segment.segmentCount >= 1 &&
    typeof segment.dataUrl === "string" &&
    segment.dataUrl.startsWith("data:audio/")
  );
}

function normalizeTtsDisplayText(value) {
  if (typeof value !== "string") {
    return "";
  }
  let normalized = redactDisplaySecrets(stripInternalDisplayBlocks(normalizeLiteralNewlines(value)))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  for (const controlLabel of [
    t("tts.readSegment"), t("common.refresh"), t("chapter.close"), t("debug.close"), t("compact.close"),
  ]) {
    normalized = normalized.replaceAll(controlLabel, "");
  }
  return normalized.replace(/\s+/g, " ").trim();
}

function startTtsAudioPlayback(audio) {
  const id = (audio._greyCrowPlaybackAttempt || 0) + 1;
  const pauseRevision = Number.isInteger(audio._greyCrowPauseRevision) ? audio._greyCrowPauseRevision : 0;
  audio._greyCrowPauseRevision = pauseRevision;
  audio._greyCrowPlaybackAttempt = id;
  let playResult;
  try {
    playResult = audio.play();
  } catch (error) {
    return { id, pauseRevision, promise: Promise.reject(error) };
  }
  const promise = Promise.resolve(playResult).then(
    () => ({ started: true, id, pauseRevision }),
    (error) => {
      // Browsers reject a pending play() with AbortError when the player
      // intentionally pauses it.  That media element remains the active
      // playback and can be resumed; a decode/device failure does not change
      // this revision and is still propagated to the caller.
      if (audio._greyCrowPauseRevision !== pauseRevision && error?.name === "AbortError") {
        return { started: false, id, pauseRevision };
      }
      throw error;
    },
  );
  return { id, pauseRevision, promise };
}

function pauseTtsAudioPlayback(audio) {
  audio._greyCrowPauseRevision = (audio._greyCrowPauseRevision || 0) + 1;
  audio.pause();
}

function playTtsAudio(dataUrl) {
  // A prefetched segment can arrive after the previous audio element ended.
  // The capture focus owns silence even across that asynchronous handoff.
  if (speechAudioFocus) {
    cancelTtsPlayback();
    return Promise.resolve();
  }
  stopCurrentTtsAudio();
  return new Promise((resolve, reject) => {
    const audio = new Audio(dataUrl);
    const configuredVolume = Number(state.gameVolume);
    const gameVolume = Number.isFinite(configuredVolume) ? configuredVolume : 80;
    audio.volume = Math.max(0, Math.min(1, gameVolume / 100));
    state.currentAudio = audio;
    renderTtsPlaybackStatus();
    let settled = false;

    const release = () => {
      if (state.currentAudio === audio) {
        state.currentAudio = null;
        renderTtsPlaybackStatus();
      }
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.src = "";
    };
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      release();
      callback(value);
    };
    const onEnded = () => settle(resolve);
    const onError = () => {
      Promise.resolve(window.greyCrow.recordProblem?.("TTS_AUDIO_ERROR")).catch(() => {});
      settle(reject, new Error(t("tts.playbackFailed")));
    };
    audio._greyCrowCancel = () => settle(resolve);
    audio.addEventListener("ended", onEnded, { once: true });
    audio.addEventListener("error", onError, { once: true });
    const playAttempt = startTtsAudioPlayback(audio);
    playAttempt.promise.catch((error) => {
      if (state.currentAudio === audio && audio._greyCrowPlaybackAttempt === playAttempt.id) {
        settle(reject, error);
      }
    });
  });
}

function stopCurrentTtsAudio() {
  const audio = state.currentAudio;
  if (!audio) {
    return;
  }
  pauseTtsAudioPlayback(audio);
  if (typeof audio._greyCrowCancel === "function") {
    audio._greyCrowCancel();
  } else {
    audio.src = "";
    state.currentAudio = null;
  }
}

function cancelRemoteTtsUtterance(utteranceId) {
  if (typeof utteranceId !== "string" || !utteranceId) {
    return;
  }
  Promise.resolve(window.greyCrow.cancelTtsUtterance(utteranceId)).catch(() => {});
}

function cancelTtsPlayback({ invalidate = true } = {}) {
  clearTtsStatusResetTimer();
  if (invalidate) {
    state.ttsRequestId += 1;
  }
  const utteranceId = state.ttsUtteranceId;
  state.ttsUtteranceId = null;
  stopCurrentTtsAudio();
  cancelRemoteTtsUtterance(utteranceId);
  setTtsPlaybackPhase("idle");
}

async function showMenu() {
  cancelReadingOpening();
  clearTypewriterTimers();
  cancelTtsPlayback();
  speechInputController?.cancel();
  closeStoryNotebookDrawer({ restoreFocus: false });
  try {
    const result = await window.greyCrow.leaveAdventure();
    if (result?.status) applyStatus(result.status);
  } catch (_error) {
    // The renderer still returns to the menu; the next status refresh will reconcile state.
  }
  closeSkillModuleDialog();
  state.storyFinale = null;
  state.storyArchive = null;
  state.archiveChapters = [];
  state.storyExportBusy = false;
  state.storyExportStatus = "";
  state.storyContinuationBusy = false;
  state.storyContinuationStatus = "";
  state.renderedFinaleId = null;
  state.skillModules = [];
  state.skillModuleRefreshError = "";
  resetStoryNotebookPanelState();
  await refreshSaves();
  renderShellState();
  ui.gameView.classList.add("hidden");
  ui.gameStageViewport.classList.add("hidden");
  ui.menuView.classList.remove("hidden");
}

async function chooseMainMenuLanguage(locale) {
  setMenuLanguagePickerOpen(false);
  if (!locale || state.localePreferenceBusy || state.gameStarted || state.adventureLocale) return;
  const selectedButton = ui.menuLanguageButtons.find((button) => button.dataset.menuLocale === locale);
  if (!selectedButton) return;
  const selectedLocaleLabel = getLocaleNativeLabel(locale);
  if (locale === state.preferredLocale) {
    state.localePreferenceNotice = t("menu.language.already", { locale: selectedLocaleLabel });
    renderUiDisplaySettings();
    return;
  }

  const previousLocale = state.preferredLocale;
  let transitionStarted = false;
  state.localePreferenceBusy = true;
  state.localePreferenceNotice = "";
  renderUiDisplaySettings();
  try {
    transitionStarted = true;
    const [coverResult, logoResult] = await Promise.allSettled([
      coverLocaleTransition(),
      preloadBrandLogo(locale),
    ]);
    if (coverResult.status === "rejected") throw coverResult.reason;
    if (logoResult.status === "rejected") throw logoResult.reason;
    const result = await window.greyCrow.updateSettings({ localization: { preferredLocale: locale } });
    if (!result?.ok) {
      state.preferredLocale = previousLocale;
      state.localePreferenceNotice = formatError(result?.error, t("menu.language.saveFailed"));
      return;
    }
    if (result.catalog) applySettingsCatalog(result.catalog);
    if (result.settings) applySettings(result.settings);
    if (result.status) applyStatus(result.status);
    syncUiLocale();
    state.localePreferenceNotice = t("menu.language.changed", { locale: selectedLocaleLabel });
    renderShellState();
    await waitForNextUiPaint();
  } catch (error) {
    state.preferredLocale = previousLocale;
    state.localePreferenceNotice = error?.message || t("menu.language.saveFailed");
    syncUiLocale();
    renderLocalizedBrandLogo();
  } finally {
    state.localePreferenceBusy = false;
    renderUiDisplaySettings();
    if (transitionStarted || ui.localeTransitionCurtain.classList.contains("is-transitioning")) {
      await waitForNextUiPaint();
      await revealLocaleTransition();
    }
  }
}

function initializeWritingQuill() {
  const host = ui.storyNotebookHostStatus;
  const sprite = host?.querySelector(".writing-quill");
  const data = window.NotebookWritingQuillData;
  if (!host || !sprite || !data) return;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let animationFrame = null, lastPaint = null, elapsed = 0, frameClock = 0;
  const isActive = () => ["busy", "finale"].includes(host.dataset.hostPhase)
    && !document.hidden
    && !ui.gameView.classList.contains("hidden");
  const paint = (frame) => {
    const index = Math.max(0, Math.min(data.frames - 1, frame));
    const x = -(index % data.columns) * 64;
    const y = -Math.floor(index / data.columns) * (200 / 3);
    sprite.style.backgroundPosition = `${x}px ${y}px`;
  };
  const resetMotion = () => {
    for (const name of ["--quill-motion-x", "--quill-motion-y", "--quill-motion-angle"]) sprite.style.removeProperty(name);
  };
  const stop = () => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null; lastPaint = null;
  };
  const tick = (now) => {
    animationFrame = null;
    if (!isActive() || reducedMotion?.matches) { sync(); return; }
    const delta = lastPaint === null ? 0 : Math.min((now - lastPaint) / 1000, .1);
    lastPaint = now; elapsed += delta;
    // The atlas has a matching cyclic endpoint. Vary the pace and a tiny
    // resting-hand motion continuously, without restarting on status ticks.
    frameClock += delta * (1 + .08 * Math.sin(elapsed / .9) + .06 * Math.sin(elapsed / 1.7));
    paint(Math.floor(frameClock * data.fps) % data.frames);
    sprite.style.setProperty("--quill-motion-x", `${(.7 * Math.sin(elapsed * 1.1) + .4 * Math.sin(elapsed * 1.8)).toFixed(3)}px`);
    sprite.style.setProperty("--quill-motion-y", `${(.45 * Math.sin(elapsed * 1.3)).toFixed(3)}px`);
    sprite.style.setProperty("--quill-motion-angle", `${(1.4 * Math.sin(elapsed * .8) + .6 * Math.sin(elapsed * 1.4)).toFixed(3)}deg`);
    animationFrame = requestAnimationFrame(tick);
  };
  const sync = () => {
    if (!isActive() || reducedMotion?.matches) {
      stop();
      if (reducedMotion?.matches || !["busy", "finale"].includes(host.dataset.hostPhase)) {
        elapsed = 0; frameClock = 0; paint(0); resetMotion();
      }
      return;
    }
    // Repeated writes of the same busy attribute must not reset the clock.
    if (animationFrame === null) animationFrame = requestAnimationFrame(tick);
  };
  new MutationObserver(sync).observe(host, { attributes: true, attributeFilter: ["data-host-phase"] });
  new MutationObserver(sync).observe(ui.gameView, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", sync);
  reducedMotion?.addEventListener?.("change", sync);
  sync();
}

function installNotebookObjectIcons() {
  const iconApi = window.NotebookLabIcons;
  if (!iconApi?.objectMarkup) return;
  const names = new Map([
    ["gameSettingsButton", "settings"], ["storyNotebookStateButton", "state"],
    ["storyNotebookCharactersButton", "characters"], ["storyNotebookModulesButton", "modules"],
    ["storyNotebookChaptersButton", "chapters"], ["storyNotebookDirectoryButton", "index"],
    ["observeCommandButton", "observe"],
    ["mapCommandButton", "map"], ["backpackCommandButton", "backpack"],
  ]);
  for (const [id, name] of names) {
    const button = document.getElementById(id);
    const holder = button?.querySelector(".notebook-icon-art");
    if (!holder || holder.dataset.objectIconInstalled === "true") continue;
    holder.insertAdjacentHTML("beforeend", iconApi.objectMarkup(name, { size: 48, className: "lab-object-icon" }));
    holder.dataset.objectIconInstalled = "true";
  }
}

// Integrated into app.js, where formal state and binding checks remain owned.
let notebookBookController = null;
let notebookEntryActive = false;

function ensureNotebookBook() {
  if (notebookBookController || !window.GreyCrowNotebookBook) return notebookBookController;
  notebookBookController = window.GreyCrowNotebookBook.create({
    game: ui.gameView,
    host: ui.gameStageCanvas,
    getTheme: () => normalizeStoryNotebookTheme(state.storyNotebookTheme),
    getLocale: getUiLocale,
    isCurrent: binding => notebookEntryActive
      && isRuntimeViewBindingCurrent(binding, { includeRevision: false }),
    onPhaseChange: () => renderTurnInputState(),
    onReading: ({ binding, focus }) => {
      renderTurnInputState();
      if (focus && notebookEntryActive && isRuntimeViewBindingCurrent(binding, { includeRevision: false })
        && !isStoryInputLocked() && !document.hidden && document.hasFocus()
        && !document.querySelector("dialog[open]") && !ui.gameView.classList.contains("hidden")) {
        ui.turnInput.focus({ preventScroll: true });
      }
    },
  });
  return notebookBookController;
}

function isNotebookPresentationBlocked() {
  const phase = notebookBookController?.getState().phase;
  return notebookEntryActive
    && phase && !["idle", "reading"].includes(phase);
}

function syncNotebookPresentation() {
  if (!notebookEntryActive || ui.gameView.classList.contains("hidden")) return;
  const book = ensureNotebookBook();
  if (!book) return;
  const view = book.getState();
  if (view.phase === "idle") {
    const binding = captureRuntimeViewBinding();
    book.prepare(binding);
    book.finish({ focus: false });
  } else if (!isRuntimeViewBindingCurrent(view.binding, { includeRevision: false })) {
    if (!book.rebindReading(captureRuntimeViewBinding())) book.cancel();
  } else {
    book.sync();
  }
}

function cancelReadingOpening() {
  notebookEntryActive = false;
  notebookBookController?.cancel();
}

function startReadingOpening() {
  if (!notebookEntryActive) return false;
  const book = ensureNotebookBook();
  if (!book || book.getState().phase !== "prepared") return false;
  void book.open(captureRuntimeViewBinding());
  return true;
}

function waitForNotebookReading(binding) {
  if (!notebookBookController) return Promise.resolve(true);
  return notebookBookController.whenReadable(binding);
}

function showGame(save, history = [], { deferOpening = false } = {}) {
  const previous = notebookBookController?.getState();
  const continuingVisiblePage = notebookEntryActive && !ui.gameView.classList.contains("hidden")
    && previous?.binding && isRuntimeViewBindingCurrent(previous.binding, { includeRevision: false });
  notebookEntryActive = true;
  const book = ensureNotebookBook();
  if (book && !continuingVisiblePage) book.prepare(captureRuntimeViewBinding());
  finishMenuIntro();
  ui.menuView.classList.add("hidden");
  ui.gameStageViewport.classList.remove("hidden");
  ui.gameView.classList.remove("hidden");
  renderGameStageScale();
  resetGameView(save, history);
  void refreshStoryNotebookCharacterPanelEntry();
  if (book && !continuingVisiblePage) {
    if (!deferOpening) startReadingOpening();
  } else if (!isStoryInputLocked() && !isNotebookPresentationBlocked()) {
    ui.turnInput.focus();
  }
}

function resetGameView(save, history = []) {
  cancelTtsPlayback();
  clearTypewriterTimers();
  clearGameTranscript();
  state.renderedSessionActions.clear();
  state.renderedFinaleId = null;
  state.storyExportBusy = false;
  state.storyExportStatus = "";
  state.storyContinuationBusy = false;
  state.storyContinuationStatus = "";
  state.contextUsage = null;
  renderContextUsage();
  if (save) {
    appendNarration("muted", t("game.narration.loaded"));
    renderStateHint(save.state_hint);
    renderContinueHistory(history);
    if (state.runtimeProtocol === "session-1" && save.continuation?.boundaryRevision === save.revision) {
      appendContinuationDivider(t("archive.continuation.started"));
    }
    renderSessionHistoryButton();
  } else {
    appendNarration("muted", t("game.narration.initial"));
  }
  renderStoryFinaleState();
}

function clearGameTranscript() {
  clearTypewriterTimers();
  state.turnFailureNotice = null;
  ui.narrationPanel.innerHTML = "";
}

function sessionHistoryRecordKey(record, adventureId, revision) {
  if (!record || record.adventureId !== adventureId || record.autoSpeak !== false) return null;
  if (record.revision === null && record.actionId === null) {
    const imported = state.activeSave?.legacyHistory;
    if (!imported || !/^legacy_[a-f0-9]{32}$/.test(record.historyId || "")
      || !Number.isSafeInteger(record.seq) || record.seq < 1 || record.seq > imported.storyTurns
      || !["turn", "finale"].includes(record.kind)) return null;
    for (const field of ["user", "assistant"]) {
      const source = record.legacySources?.[field];
      if (source?.kind !== "legacy_transcript" || source.importId !== imported.importId
        || source.sourceAdventureId !== imported.sourceAdventureId || source.sequence !== record.seq
        || source.field !== field || typeof source.turnId !== "string" || !source.turnId.length
        || !/^[a-f0-9]{64}$/.test(source.textHash || "")) return null;
    }
    if (record.legacySources.user.turnId !== record.legacySources.assistant.turnId) return null;
    return `history:${record.historyId}`;
  }
  return Number.isSafeInteger(record.revision) && record.revision >= 1 && record.revision <= revision
    && typeof record.actionId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(record.actionId)
    ? record.actionId : null;
}

function renderContinueHistory(history = []) {
  const records = Array.isArray(history) ? history : [];
  if (!records.length) {
    return;
  }

  const continuation = records
    .filter((record) => record?.kind === "continuation_summary" && typeof record.host === "string" && record.host.trim())
    .slice(-1);
  const visibleRecords = records.filter((record) => record?.kind !== "continuation_summary");
  const turns = state.storyArchive || state.runtimeProtocol === "session-1" ? visibleRecords : visibleRecords.slice(-6);

  if (continuation.length) {
    appendNarration("muted", t("archive.history.continuationSummary"));
    appendNarration("host", continuation[0].host, { autoSpeak: false, animate: false });
  }

  if (!turns.length) {
    return;
  }

  appendNarration("muted", t("archive.history.recent"));
  for (const record of turns) {
    const historyKey = state.runtimeProtocol === "session-1" ? sessionHistoryRecordKey(record, state.activeSaveId, state.activeSave?.revision) : null;
    if (state.runtimeProtocol === "session-1" && (!historyKey || state.renderedSessionActions.has(historyKey))) continue;
    if (state.runtimeProtocol === "session-1" && record.continuationBefore) appendContinuationDivider(t("archive.continuation.started"));
    if (record?.kind === "finale") {
      if (typeof record.host === "string" && record.host.trim()) appendNarration("host", record.host, { autoSpeak: false, animate: false });
      state.renderedFinaleId = state.storyFinale?.finale?.finale_id || `finale-history-${record.seq || "closed"}`;
      appendFinaleDivider(state.storyFinale?.projection?.engineNotice || t("archive.finale.divider"));
      if (historyKey) state.renderedSessionActions.add(historyKey);
      continue;
    }
    if (typeof record.player === "string" && record.player.trim()) {
      appendNarration("player", t("archive.history.playerLine", { content: record.player }));
    }
    if (typeof record.host === "string" && record.host.trim()) {
      appendNarration("host", record.host, { autoSpeak: false, animate: false });
    }
    if (historyKey) state.renderedSessionActions.add(historyKey);
  }
}

function renderSessionHistoryButton() {
  document.getElementById("sessionHistoryMore")?.remove();
  if (state.runtimeProtocol !== "session-1" || !state.historyCursor) return;
  const button = document.createElement("button");
  button.id = "sessionHistoryMore";
  button.type = "button";
  button.className = "menu-button story-notebook-panel-load-more";
  button.textContent = t("skillPanel.loadMore");
  button.addEventListener("click", async () => {
    const cursor = state.historyCursor;
    const sessionId = state.runtimeSessionId;
    if (!cursor) return;
    button.disabled = true;
    try {
      const page = await window.greyCrow.readSessionHistory({ adventureId: cursor.adventureId,
        sessionId, revision: cursor.revision, beforeRevision: cursor });
      if (page.stale || state.runtimeSessionId !== sessionId || state.activeSaveId !== cursor.adventureId
        || state.historyCursor !== cursor) return;
      if (!page.ok) throw page.error;
      if (page.adventureId !== cursor.adventureId || page.revision !== cursor.revision) return;
      const fragment = document.createDocumentFragment();
      const priorHeight = ui.narrationPanel.scrollHeight;
      const priorTop = ui.narrationPanel.scrollTop;
      for (const record of page.history || []) {
        const historyKey = sessionHistoryRecordKey(record, cursor.adventureId, cursor.revision);
        if (!historyKey || state.renderedSessionActions.has(historyKey)) continue;
        if (record.continuationBefore) fragment.appendChild(appendContinuationDivider(t("archive.continuation.started")));
        if (record.kind !== "finale" && record.player) fragment.appendChild(appendNarration("player", t("archive.history.playerLine", { content: record.player })));
        if (record.host) fragment.appendChild(appendNarration("host", record.host, { autoSpeak: false, animate: false }));
        if (record.kind === "finale") fragment.appendChild(appendFinaleDivider(t("archive.finale.divider")));
        state.renderedSessionActions.add(historyKey);
      }
      button.after(fragment);
      state.historyCursor = page.nextBeforeRevision || null;
      renderSessionHistoryButton();
      ui.narrationPanel.scrollTop = priorTop + ui.narrationPanel.scrollHeight - priorHeight;
    } catch (error) {
      if (state.runtimeSessionId === sessionId && state.activeSaveId === cursor.adventureId) {
        appendNarration("warning", formatError(error, t("game.error.turn")));
      }
    } finally { button.disabled = false; }
  });
  ui.narrationPanel.prepend(button);
}

function getStoryFinalePhase() {
  const phase = state.storyFinale?.projection?.phase;
  // A durable ending can need recovery before its derived job has started.
  // The local in-flight receipt changes presentation only, never saved state.
  if (phase === "recovery_required" && [...state.sessionDerivedWork.values()].some((work) => work.pending
    && work.kind === "finale" && isRuntimeViewBindingCurrent(work.binding))) return "finalizing";
  if (["finalizing", "recovery_required", "closed"].includes(phase)) return phase;
  return getAdventureCompatibility(state.activeSave).status === "closed" ? "closed" : null;
}

function isStoryInputLocked() {
  return ["finalizing", "recovery_required", "closed"].includes(getStoryFinalePhase());
}

async function resumeSessionFinale() {
  if (state.busy || isSessionDerivedBusy() || state.runtimeProtocol !== "session-1"
    || state.storyFinale?.projection?.actions?.resumeFinalization !== true) return;
  if (!state.keyVerified) { openSettings(t("menu.connectionRequired"), { tab: "ai" }); return; }
  const binding = captureRuntimeViewBinding();
  const busyRevision = setBusy(true, t("archive.resumeBusy"));
  renderStoryFinaleState();
  try {
    const result = await window.greyCrow.resumeSessionFinale({ adventureId: binding.adventureId,
      sessionId: binding.sessionId, revision: binding.revision });
    if (result.stale || !isRuntimeViewBindingCurrent(binding, { includeRevision: false })) return;
    if (result.status && applyStatus(result.status) === false) return;
    restoreContextUsage(result.contextUsage ?? result.envelope?.contextUsage);
    if (!result.ok) {
      renderTerminalPlayerAction(result.terminalAction);
      applyStoryFinaleResult(result.storyFinale);
      appendNarration("warning", formatError(result.error || result.envelope?.error, t("archive.resumeFailed")));
      return;
    }
    if (applySaveResult(result) === false) return;
    if (result.terminalAction) {
      const committed = result.actionResult?.status === "committed";
      renderTerminalPlayerAction(result.terminalAction, { committed });
      if (committed && hasRenderableEnvelope(result.envelope)) renderEnvelope(result.envelope);
      else if (committed && !state.renderedSessionActions.has(result.terminalAction.actionId)) {
        const record = result.projection?.history?.find((turn) => turn.actionId === result.terminalAction.actionId);
        if (record?.adventureId === binding.adventureId && record.revision === result.projection.revision) {
          appendNarration("host", record.host, { autoSpeak: false, animate: false });
          state.renderedSessionActions.add(record.actionId);
        }
      }
    }
    applyStoryFinaleResult(result.storyFinale);
    if (result.derivedWork) void completeSessionDerivedWork(result.derivedWork);
    else if (result.storyFinale?.projection?.phase !== "closed") appendNarration("warning", t("archive.resumeFailed"));
    if (hasOpenChapterSurface()) await refreshChapterLogs();
  } catch (error) {
    if (isRuntimeViewBindingCurrent(binding, { includeRevision: false })) appendNarration("warning", formatError(error, t("archive.resumeFailed")));
  } finally {
    if (state.busyRevision === busyRevision) setBusy(false);
    if (isRuntimeViewBindingCurrent(binding, { includeRevision: false })) renderStoryFinaleState();
  }
}

function renderTerminalPlayerAction(value, { committed = false } = {}) {
  if (state.runtimeProtocol !== "session-1" || !value || value.adventureId !== state.activeSaveId
    || typeof value.actionId !== "string" || typeof value.input !== "string"
    || value.baseRevision + (committed ? 1 : 0) !== state.activeSave?.revision
    || state.renderedSessionActions.has(value.actionId)) return;
  const existing = state.pendingSessionAction;
  const action = existing?.actionId === value.actionId && existing.adventureId === value.adventureId
    && existing.sessionId === state.runtimeSessionId ? existing : { actionId: value.actionId,
      baseRevision: value.baseRevision, text: value.input, adventureId: value.adventureId, sessionId: state.runtimeSessionId };
  if (!action.line?.isConnected) action.line = appendNarration("player", value.input);
  action.line.dataset.actionId = action.actionId;
  action.line.dataset.actionStatus = committed ? "committed" : "interrupted";
  action.line.setAttribute("aria-busy", "false");
  action.line.style.opacity = committed ? "" : "0.6";
  state.pendingSessionAction = committed ? null : action;
}

function renderPendingPlayerAction(value) {
  if (!value || !["failed", "interrupted", "running"].includes(value.status)
    || value.adventureId !== state.activeSaveId || value.baseRevision !== state.activeSave?.revision
    || state.storyArchive || isStoryInputLocked()) return;
  renderTerminalPlayerAction(value);
  const action = state.pendingSessionAction;
  if (action?.actionId !== value.actionId) return;
  action.line.dataset.actionStatus = value.status;
  // Recovery restores the submitted draft and its identity. It never sends it.
  // Keep any newer text the player has already typed during a settings change.
  if (!ui.turnInput.value.trim()) ui.turnInput.value = value.input;
  renderTurnInputState();
}

function applyStoryFinaleResult(value) {
  if (state.runtimeProtocol === "session-1" && value && (value.adventureId !== state.activeSaveId
    || value.revision !== state.activeSave?.revision)) return;
  if (value && typeof value === "object" && !Array.isArray(value)) state.storyFinale = value;
  const phase = getStoryFinalePhase();
  const finale = state.storyFinale?.finale;
  if (state.runtimeProtocol !== "session-1" && phase === "closed" && finale?.narration) {
    const finaleId = finale.finale_id || "closed-finale";
    if (state.renderedFinaleId !== finaleId) {
      appendNarration("host", finale.narration);
      appendFinaleDivider(state.storyFinale?.projection?.engineNotice || t("archive.finale.divider"));
      state.renderedFinaleId = finaleId;
    }
  } else if (phase === "closed" && !state.renderedFinaleId) {
    appendFinaleDivider(state.storyFinale?.projection?.engineNotice || t("archive.finale.divider"));
    state.renderedFinaleId = state.storyFinale?.projection?.closedFinale?.finaleId || "closed-finale";
  }
  renderStoryFinaleState();
  renderTurnInputState();
}

function appendFinaleDivider(content) {
  const line = document.createElement("p");
  line.className = "narration-line finale-divider";
  line.textContent = redactDisplaySecrets(String(content || t("archive.finale.divider")));
  ui.narrationPanel.appendChild(line);
  ui.narrationPanel.scrollTop = ui.narrationPanel.scrollHeight;
  return line;
}

function appendContinuationDivider(content) {
  const line = document.createElement("p");
  line.className = "narration-line continuation-divider";
  line.textContent = redactDisplaySecrets(String(content || t("archive.continuation.started")));
  ui.narrationPanel.appendChild(line);
  ui.narrationPanel.scrollTop = ui.narrationPanel.scrollHeight;
  return line;
}

function renderStoryFinaleState() {
  const phase = getStoryFinalePhase();
  const locked = ["finalizing", "recovery_required", "closed"].includes(phase);
  const specialEnding = state.storyFinale?.projection?.closedFinale?.finaleSource === "easter"
    || state.storyFinale?.projection?.closedFinale?.continuationPolicy === "forbidden";
  ui.turnForm.hidden = locked;
  ui.storyArchiveFooter.hidden = !locked;
  ui.storyResumeFinaleButton.hidden = state.runtimeProtocol !== "session-1"
    || state.storyFinale?.projection?.actions?.resumeFinalization !== true;
  ui.storyResumeFinaleButton.disabled = state.busy || isSessionDerivedBusy() || !state.keyVerified;
  if (!locked) return;
  const notice = phase === "finalizing" && state.storyFinale?.projection?.phase === "recovery_required"
    ? null : state.storyFinale?.projection?.engineNotice;
  if (phase === "closed") {
    ui.storyArchiveTitle.textContent = t(specialEnding ? "archive.specialEnding" : "archive.closed");
    ui.storyArchiveNotice.textContent = state.storyContinuationStatus
      || state.storyExportStatus
      || notice
      || t(specialEnding ? "archive.specialEndingNotice" : "archive.savedLocal");
  } else if (phase === "recovery_required") {
    ui.storyArchiveTitle.textContent = t("archive.recovery.title");
    ui.storyArchiveNotice.textContent = notice || t("archive.recovery.notice");
  } else {
    ui.storyArchiveTitle.textContent = t("archive.finalizing.title");
    ui.storyArchiveNotice.textContent = notice || t("archive.finalizing.notice");
  }
  const canExport = phase === "closed" && (state.runtimeProtocol !== "session-1"
    || state.storyFinale?.projection?.actions?.exportStory === true);
  const canContinue = phase === "closed"
    && !specialEnding
    && (state.storyArchive?.actions?.continue_as_child === true
      || state.storyFinale?.projection?.actions?.continueAsChild === true);
  ui.storyContinueButton.hidden = !canContinue;
  ui.storyContinueButton.disabled = state.storyContinuationBusy || state.storyExportBusy || !state.keyVerified;
  ui.storyExportHtmlButton.hidden = !canExport;
  ui.storyExportMarkdownButton.hidden = !canExport;
  ui.storyExportHtmlButton.disabled = state.storyExportBusy;
  ui.storyExportMarkdownButton.disabled = state.storyExportBusy;
}

function setBusy(isBusy, label) {
  const busyRevision = ++state.busyRevision;
  state.busy = Boolean(isBusy);
  if (state.busy) {
    state.busyLabel = label || state.busyLabel || t("game.busy.processing");
    state.busyStartedAt = Date.now();
    updateOperationStatusForBusyLabel(state.busyLabel);
    startBusyTimer();
  } else {
    stopBusyTimer();
    state.busyLabel = "";
    state.busyStartedAt = null;
  }
  renderCustomConnectionSettings();
  renderCredentialSettings();
  renderAudioSettings();
  renderDeveloperSettings();
  renderTurnInputState();
  renderMaintenanceState();
  ui.prepareNewGameButton.disabled = state.busy;
  ui.prepareNewGameButton.setAttribute("aria-busy", state.busy ? "true" : "false");
  if (label) {
    ui.menuMessage.textContent = label;
  }
  renderTurnStatus();
  return busyRevision;
}

function updateOperationStatusForBusyLabel() {
  setOperationStatus({
    output: t("game.operations.working"),
    tool: t("game.operations.waitingResult"),
  });
}

function renderTurnInputState() {
  const finaleLocked = isStoryInputLocked();
  const contentReady = state.keyVerified && state.gameStarted && Boolean(state.activeSaveId) && !finaleLocked;
  const turnReady = contentReady && !isNotebookPresentationBlocked();
  const archiveReadable = getStoryFinalePhase() === "closed" && state.gameStarted && Boolean(state.activeSaveId);
  ui.turnInput.disabled = state.busy || !turnReady;
  ui.sendTurnButton.disabled = state.busy || isSpeechInputBusy() || !turnReady;
  renderSessionTurnCancel();
  ui.manualSaveButton.disabled = state.busy || !turnReady;
  renderSessionChapterButtons();
  ui.chapterLogButton.disabled = state.busy || (!turnReady && !archiveReadable);
  renderStoryNotebookCharacterAvailability();
  ui.storyNotebookModulesButton.disabled = !state.gameStarted || !state.activeSaveId;
  ui.storyNotebookChaptersButton.disabled = state.busy || (!turnReady && !archiveReadable);
  ui.observeCommandButton.disabled = state.busy || isSpeechInputBusy() || !turnReady;
  ui.listenCommandButton.disabled = state.busy || isSpeechInputBusy() || !turnReady;
  ui.mapCommandButton.disabled = state.busy || !turnReady;
  ui.backpackCommandButton.disabled = state.busy || !turnReady;
  ui.compactContextButton.disabled = state.busy || !turnReady;
  renderSessionCompactionControls();
  ui.storyExportHtmlButton.disabled = state.storyExportBusy;
  ui.storyExportMarkdownButton.disabled = state.storyExportBusy;
  ui.storyContinueButton.disabled = state.storyContinuationBusy || state.storyExportBusy || !state.keyVerified;
  speechInputController?.render();
  ui.turnInput.placeholder = finaleLocked
    ? t("game.input.readOnly")
    : t(contentReady ? "game.input.placeholder" : "game.input.notReady");
  renderStoryFinaleState();
  renderTurnStatus();
  gameTourLifecycle?.sync();
}

function startBusyTimer() {
  stopBusyTimer();
  state.busyTimer = window.setInterval(renderTurnStatus, 1000);
}

function stopBusyTimer() {
  if (state.busyTimer) {
    window.clearInterval(state.busyTimer);
    state.busyTimer = null;
  }
}

function resolveHostIdleLine() {
  const enteringIdle = ui.storyNotebookHostStatus.dataset.hostPhase !== "idle";
  if (!state.hostIdleLineKey || enteringIdle) {
    const candidates = HOST_IDLE_LINE_KEYS.filter((key) => key !== state.hostIdleLineKey);
    state.hostIdleLineKey = candidates[Math.floor(Math.random() * candidates.length)] || HOST_IDLE_LINE_KEYS[0];
  }
  return t(state.hostIdleLineKey);
}

function renderTurnStatus() {
  if (!ui.turnStatus) {
    return;
  }
  const phase = getStoryFinalePhase();
  const turnReady = state.keyVerified && state.gameStarted && Boolean(state.activeSaveId) && !isStoryInputLocked();
  const notice = state.turnFailureNotice;
  const showFailure = !state.busy && notice?.line?.isConnected
    && notice.adventureId === state.activeSaveId && notice.sessionId === state.runtimeSessionId;
  if (ui.turnFailureDetailsButton) {
    ui.turnFailureDetailsButton.hidden = !showFailure;
    ui.turnFailureDetailsButton.onclick = showFailure ? () => {
      notice.line.setAttribute("tabindex", "-1");
      notice.line.scrollIntoView({ block: "nearest", behavior: "instant" });
      notice.line.focus({ preventScroll: true });
    } : null;
  }
  ui.storyNotebookHostStatus.dataset.turnFailure = showFailure ? "true" : "false";
  if (state.busy) {
    const elapsed = state.busyStartedAt ? Math.max(0, Math.floor((Date.now() - state.busyStartedAt) / 1000)) : 0;
    const tail = t(elapsed >= 10 ? "game.turn.waitingModel" : "game.turn.pleaseWait");
    const longStoryWait = state.runtimeProtocol === "session-1" && state.turnBusyRevision === state.busyRevision && elapsed >= 30;
    const cancelling = state.pendingSessionAction?.cancelRequested && state.turnBusyRevision === state.busyRevision;
    ui.turnStatus.textContent = t("game.turn.busy", {
      label: cancelling ? t("game.turn.cancelling") : longStoryWait ? t(elapsed >= 90 ? "game.turn.delayed" : "game.turn.longWait")
        : state.busyLabel || t("game.turn.defaultBusy"), elapsed, tail,
    });
    ui.turnStatus.classList.add("active");
    ui.storyNotebookHostStatus.dataset.hostPhase = "busy";
    return;
  }
  ui.turnStatus.classList.remove("active");
  if (showFailure) {
    ui.turnStatus.textContent = t("game.turn.failure.notice");
    ui.storyNotebookHostStatus.dataset.hostPhase = "error";
  } else if (phase === "closed") {
    ui.turnStatus.textContent = t("game.turn.closed");
    ui.storyNotebookHostStatus.dataset.hostPhase = "closed";
  } else if (phase === "recovery_required") {
    ui.turnStatus.textContent = t("game.turn.recoveryRequired");
    ui.storyNotebookHostStatus.dataset.hostPhase = "error";
  } else if (phase === "finalizing") {
    ui.turnStatus.textContent = t("game.turn.finalizing");
    ui.storyNotebookHostStatus.dataset.hostPhase = "finale";
  } else {
    ui.turnStatus.textContent = turnReady ? resolveHostIdleLine() : t("game.turn.notReady");
    ui.storyNotebookHostStatus.dataset.hostPhase = turnReady ? "idle" : "unavailable";
  }
}

function formatContextCompactionResult(result = {}) {
  const metrics = result.metrics || {};
  if (result.compacted) {
    return t("compact.result.compacted");
  }
  if (result.skipped && (result.reason === "summary_no_benefit" || metrics.no_benefit)) {
    return t("compact.result.noBenefit");
  }
  if (result.skipped) {
    return t("compact.result.skipped");
  }
  return t("compact.result.done");
}

function formatSaveDate(value) {
  if (!value) {
    return t("save.date.missing");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return t("save.date.missing");
  }
  return parsed.toLocaleString(getUiLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatError(error, fallback) {
  if (!error) {
    return fallback;
  }
  const code = error.code ? `[${error.code}] ` : "";
  if (error.code === "STORE_BUSY") return `${code}${t("save.busy.notice")}`;
  const trustedMessage = getUiLocale() === "zh-CN" && typeof error.message === "string" && error.message.trim()
    ? error.message.trim()
    : fallback;
  return `${code}${trustedMessage || t("common.error")}`;
}

function redactDisplaySecrets(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "ghp_[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "github_pat_[redacted]")
    .replace(/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "glpat-[redacted]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, "xoxb-[redacted]")
    .replace(/\bya29\.[A-Za-z0-9_-]{20,}\b/g, "ya29.[redacted]")
    .replace(/\bA[SK]IA[0-9A-Z]{16}\b/g, "AKIA[redacted]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[jwt-redacted]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[hex-redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:api[_-]?key|key|token|secret)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(
      /(^|[^A-Za-z0-9])((?:api[_-]?key|key|token|secret|password)\s*[:=]\s*)([^\s,;，；]+)/gi,
      "$1$2[redacted]"
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[redacted]");
}

function cleanPlayerVisibleDisplayText(value) {
  return redactDisplaySecrets(stripInternalDisplayBlocks(normalizeLiteralNewlines(value))).trim();
}

function stripInternalDisplayBlocks(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalizedValue = normalizeLiteralNewlines(value);
  const withoutFencedInternals = normalizedValue.replace(/```(?:json|JSON)?\s*[\s\S]*?```/g, (block) =>
    DISPLAY_INTERNAL_SECTION_PATTERN.test(block) ? "" : block
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

    if (DISPLAY_INTERNAL_SECTION_START_PATTERN.test(trimmed) || DISPLAY_INTERNAL_SECTION_PATTERN.test(trimmed)) {
      droppingInternalBlock = true;
      continue;
    }

    if (droppingInternalBlock && (DISPLAY_STRUCTURED_LINE_PATTERN.test(trimmed) || /^[-*]\s+/.test(trimmed))) {
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
