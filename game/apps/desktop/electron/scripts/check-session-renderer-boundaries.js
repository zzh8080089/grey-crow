#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { redactSecrets, normalizeError } = require("../../../../engine/providers/provider-contracts");
const { createDebugTraceSummary } = require("../debug-trace-summary");
const { projectSessionView, projectSessionPanel } = require("../../../../engine/session/session-projection");
const { projectProviderError } = require("../../../../engine/session/session-provider-error");
const { applyTurnBundle } = require("../../../../engine/session/turn-model");
const { initialState } = require("../../../../engine/session/test-fixtures/turn-samples");
const { getSettingsCatalog, normalizeDesktopSettings, mergeDesktopSettings } = require("../settings-store");
const { createDesktopStatus } = require("../desktop-status");
const { CUSTOM_PROVIDER_ID, CUSTOM_CONTEXT_WINDOW_DEFAULT, getCustomConnection,
  createConnectionFingerprint, createCustomConnection } = require("../model-connections");

const rendererPath = path.join(__dirname, "../renderer/app.js");
const mainPath = path.join(__dirname, "../main.js");
const rendererSource = fs.readFileSync(rendererPath, "utf8");
const mainSource = fs.readFileSync(mainPath, "utf8");

// Execute the current production functions without starting Electron. Only DOM
// effects and IPC transport are synthetic; binding and projection logic are not.
function extractFunction(source, name) {
  const declaration = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
  assert(declaration, `Missing production function ${name}`);
  const tail = source.slice(declaration.index + 1);
  const next = /\n(?:(?:async )?function \w+\(|const lock = app\.requestSingleInstanceLock\(\);)/.exec(tail);
  assert(next || /\n}\s*$/.test(tail), `Cannot delimit production function ${name}`);
  return source.slice(declaration.index, next ? declaration.index + 1 + next.index : undefined);
}

function install(context, source, names, filename) {
  new vm.Script(names.map((name) => extractFunction(source, name)).join("\n"), { filename })
    .runInContext(context);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function status(adventureId, sessionId, revision) {
  return { runtimeProtocol: "session-1", activeSaveId: adventureId,
    activeSave: { id: adventureId, revision }, runtimeSessionId: sessionId,
    keyVerified: true, gameStarted: true };
}

function createRenderer() {
  const effects = { rows: [], debugEntries: [], debugWrites: 0, developerWrites: 0, locked: false };
  const requests = [];
  const state = { runtimeProtocol: "session-1", activeSaveId: "a", activeSave: { id: "a", revision: 4 },
    runtimeSessionId: 1, retiredRuntimeSessions: new Set(), renderedSessionActions: new Set(),
    narrationDeliveryEpoch: 0, narrationDelivery: null, typewriterTimers: new Set(),
    turnBusyRevision: null, compactionBusyRevision: null, pendingSessionCompaction: null,
    pendingSessionAction: null, sessionDerivedWork: new Map(), sessionContextGeneration: 0, storyArchive: null,
    debugPanelEnabled: true, debugTraceRequestId: 0, debugTraceExport: null,
    debugTraceEntries: [], debugTraceSummary: null };
  const ui = { turnInput: { value: "" }, settingsDialog: { open: false },
    debugDialog: { open: true }, debugRefreshButton: { disabled: false },
    debugExportButton: { disabled: true }, debugStatus: { textContent: "" } };
  const context = vm.createContext({ state, ui, notebookEntryActive: false, notebookBookController: null,
    speechInputController: null, speechAudioFocus: false, speechAudioUserRevision: 0, speechAudioFocusRevision: 0,
    window: { greyCrow: { getDebugTrace: () => {
      const request = requests.shift();
      assert(request, "Unexpected diagnostic IPC request");
      return request.promise;
    } } },
    t: (key) => key,
    formatError: (error) => error?.message || "read failed",
    isStoryInputLocked: () => effects.locked,
    appendNarration: (kind, text) => {
      const line = { isConnected: true, dataset: {}, style: {}, setAttribute() {} };
      effects.rows.push({ kind, text, line });
      return line;
    },
    renderDebugTraceEntries: (entries) => { effects.debugEntries = entries; effects.debugWrites += 1; },
    renderDeveloperSettings: () => { effects.developerWrites += 1; },
  });
  for (const name of ["setBusy", "invalidateRuntimeNotebookProjection", "renderContextUsage", "syncUiLocale",
    "renderContextPolicyStatus", "renderSettingsStatus", "renderStoryNotebookMetadata",
    "renderSessionCompactionControls", "renderTurnInputState", "scheduleSessionRecovery", "clearTypewriterTimers"]) {
    context[name] = () => {};
  }
  install(context, rendererSource, ["isSpeechInputBusy", "captureRuntimeViewBinding", "isRuntimeViewBindingCurrent", "applyStatus",
    "isNotebookPresentationBlocked", "waitForNotebookReading",
    "refreshDebugTrace", "renderTerminalPlayerAction", "renderPendingPlayerAction"], rendererPath);
  return { context, state, ui, effects,
    startRead() {
      const request = deferred();
      requests.push(request);
      return { ...request, finished: context.refreshDebugTrace() };
    },
    snapshot() {
      return JSON.stringify({ ui, debugEntries: effects.debugEntries, debugWrites: effects.debugWrites,
        developerWrites: effects.developerWrites, entries: state.debugTraceEntries,
        summary: state.debugTraceSummary, export: state.debugTraceExport });
    },
  };
}

function diagnosticResult(id) {
  return { ok: true, result: { entries: [{ id }], summary: { id },
    selection: { available_entry_count: 1, selected_error_entry_count: 0 } },
  export: { content: `diagnostic-${id}` } };
}

function createSpeechRenderer() {
  const app = createRenderer();
  const { context, state, ui } = app;
  const starts = [];
  const continued = [];
  const played = [];
  const cancelled = [];
  const element = () => ({ children: [], listeners: {}, dataset: {}, style: {}, attributes: {},
    textContent: "", isConnected: true,
    appendChild(node) { this.children.push(node); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
  });
  Object.assign(state, { ttsEnabled: true, ttsProvider: "kokoro", ttsAuto: true,
    ttsRequestId: 0, ttsUtteranceId: null, currentAudio: null });
  state.activeSave.actionId = "spoken-action";
  ui.narrationPanel = element();
  ui.ttsStatus = { textContent: "" };
  context.document = { createElement: element };
  context.window.greyCrow.startTtsUtterance = (text) => {
    const request = deferred();
    starts.push({ text, ...request });
    return request.promise;
  };
  context.window.greyCrow.continueTtsUtterance = async (utteranceId) => {
    continued.push(utteranceId);
    return { ok: true, result: { utteranceId, segmentIndex: 1, segmentCount: 2,
      hasMore: false, dataUrl: "data:audio/wav;base64,c3ludGhldGljLWxhc3Q=" } };
  };
  context.window.greyCrow.cancelTtsUtterance = async (id) => { cancelled.push(id); };
  // Use the real append, normalization, request ownership and segmented speech
  // loop. Only the DOM, IPC result and audio sink are synthetic; no audio plays.
  context.playTtsAudio = async (dataUrl) => { played.push(dataUrl); };
  context.renderTypewriterText = (node, text, onComplete) => { node.textContent = text; onComplete?.(); };
  context.scheduleTtsIdle = () => {};
  context.openSettings = () => { throw new Error("Unexpected TTS settings request"); };
  for (const name of ["renderStateHint", "updateContextUsageFromEnvelope", "renderDerivedChapterSummary",
    "appendContinuationDivider", "appendFinaleDivider"]) context[name] = () => {};
  const patterns = ["DISPLAY_INTERNAL_SECTION_PATTERN", "DISPLAY_INTERNAL_SECTION_START_PATTERN",
    "DISPLAY_STRUCTURED_LINE_PATTERN"].map((name) => {
    const match = rendererSource.match(new RegExp(`^const ${name} = .*;$`, "m"));
    assert(match, `Missing display pattern ${name}`);
    return match[0];
  }).join("\n");
  new vm.Script(patterns, { filename: rendererPath }).runInContext(context);
  install(context, rendererSource, ["renderEnvelope", "appendNarration", "synthesizeAndPlayTts",
    "normalizeTtsDisplayText", "stripInternalDisplayBlocks", "redactDisplaySecrets", "normalizeLiteralNewlines",
    "cancelTtsPlayback", "cancelRemoteTtsUtterance", "stopCurrentTtsAudio", "clearTtsStatusResetTimer",
    "setTtsPlaybackPhase", "renderTtsPlaybackStatus", "isPlayableTtsSegment", "getTtsPlaybackFailureLabel", "renderContinueHistory",
    "sessionHistoryRecordKey", "cleanPlayerVisibleDisplayText", "queueCommittedNarrationSegments",
    "beginDeferredNarrationDelivery", "deliverNextNarrationSegment", "flushNarrationDelivery", "clearTypewriterTimers", "finishNarrationDelivery",
    "waitForCommittedNarrationDelivery", "narrationPanelNearBottom"], rendererPath);
  return { ...app, starts, continued, played, cancelled,
    envelope(segments, extra = {}) { return { adventureId: "a", revision: 4, actionId: "spoken-action", segments, ...extra }; },
    async finish(index = 0) {
      starts[index].resolve({ ok: true, result: { utteranceId: `utterance-${index}`, segmentIndex: 0,
        segmentCount: 2, hasMore: true, dataUrl: "data:audio/wav;base64,c3ludGhldGljLWZpcnN0" } });
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function createTtsPlaybackRenderer() {
  const state = { ttsEnabled: true, ttsRequestId: 8, ttsUtteranceId: "pending-utterance", currentAudio: null,
    ttsPlaybackPhase: "playing", ttsPlaybackError: "", ttsPlaybackSegmentIndex: 0,
    ttsPlaybackSegmentCount: 1, ttsPlaybackPrefetching: false, ttsPlaybackCacheHit: false,
    ttsStatusResetTimer: null, gameVolume: 80 };
  const control = () => ({ dataset: {}, disabled: false, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; } });
  const ui = { ttsStatus: { textContent: "" }, operationTtsStatus: { textContent: "", title: "" },
    ttsPlaybackToggleButton: control(), ttsPlaybackIcon: { textContent: "" } };
  const audios = [];
  class PendingAudio {
    constructor(dataUrl) {
      this.src = dataUrl; this.paused = true; this.volume = 1; this.listeners = new Map(); this.playRequests = [];
      audios.push(this);
    }
    addEventListener(type, listener) {
      const entries = this.listeners.get(type) || []; entries.push(listener); this.listeners.set(type, entries);
    }
    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener));
    }
    play() {
      this.paused = false;
      const request = deferred(); this.playRequests.push(request);
      return request.promise;
    }
    pause() {
      this.paused = true;
      const request = this.playRequests.at(-1);
      request?.reject(Object.assign(new Error("The play() request was interrupted by pause()."), { name: "AbortError" }));
    }
    emit(type) {
      if (type === "ended") this.paused = true;
      for (const listener of this.listeners.get(type) || []) listener();
    }
  }
  const context = vm.createContext({ state, ui, Audio: PendingAudio, Promise, speechAudioFocus: false,
    speechAudioFocusRevision: 0, speechAudioUserRevision: 0, window: { setTimeout, clearTimeout, greyCrow: { cancelTtsUtterance: async () => {} } },
    t: (key) => key, formatError: (error, fallback) => error?.message || fallback, openSettings: () => {} });
  install(context, rendererSource, ["acquireSpeechAudioFocus", "startTtsAudioPlayback", "pauseTtsAudioPlayback", "playTtsAudio", "toggleTtsPlayback",
    "stopCurrentTtsAudio", "cancelTtsPlayback", "cancelRemoteTtsUtterance", "clearTtsStatusResetTimer",
    "setTtsPlaybackPhase", "renderTtsPlaybackStatus", "getTtsPlaybackFailureLabel"], rendererPath);
  return { context, state, ui, audios };
}

function createDerivedRenderer() {
  const app = createSpeechRenderer();
  const { context, state, ui, effects } = app;
  Object.assign(state, { keyVerified: true, gameStarted: true, busy: false, busyRevision: 0 });
  state.activeSave.actionId = "prior-action";
  for (const name of ["storyResumeFinaleButton", "turnForm", "storyArchiveFooter", "storyArchiveTitle",
    "storyArchiveNotice", "storyContinueButton", "storyExportHtmlButton", "storyExportMarkdownButton"]) ui[name] = {};
  const paint = deferred();
  const derivedRequests = [];
  const pendingRequests = [];
  context.window.greyCrow.completeTurnDerived = (ticket) => {
    derivedRequests.push(ticket);
    const request = pendingRequests.shift();
    assert(request, "Unexpected derived IPC request");
    return request.promise;
  };
  context.waitForNextUiPaint = () => paint.promise;
  context.crypto = { randomUUID: () => "new-action" };
  context.getAdventureCompatibility = (save) => save?.compatibility || {};
  context.hasOpenChapterSurface = () => false;
  context.appendFinaleDivider = () => { effects.dividers = (effects.dividers || 0) + 1; };
  const appendNarration = context.appendNarration;
  context.appendNarration = (kind, text, options = {}) => {
    const line = appendNarration(kind, text, options);
    effects.rows.push({ kind, text, options, line });
    return line;
  };
  Object.defineProperty(effects, "speech", { get: () => app.starts.length });
  context.setBusy = (value) => {
    state.busy = value;
    const revision = ++state.busyRevision;
    context.renderStoryFinaleState();
    context.renderSessionTurnCancel?.();
    return revision;
  };
  for (const name of ["restoreContextUsage", "renderShellState", "updateOperationStatusFromEnvelope",
    "updateContextUsageFromEnvelope", "renderStateHint", "refreshChapterLogs"]) context[name] = () => {};
  install(context, rendererSource, ["runTurn", "formatPlayerTurnFailure", "modelFailureExplanation", "formatDerivedModelFailure",
    "renderSessionTurnCancel", "requestSessionTurnCancellation", "renderTurnStatus", "resolveHostIdleLine",
    "applySaveResult", "renderEnvelope", "hasRenderableEnvelope",
    "renderDerivedChapterSummary", "isSessionDerivedBusy", "completeSessionDerivedWork",
    "getStoryFinalePhase", "isStoryInputLocked", "applyStoryFinaleResult", "renderStoryFinaleState",
    "resumeSessionFinale"], rendererPath);
  const ticket = { ticketId: "ticket-a", actionId: "new-action", revision: 5,
    kind: "finale", adventureId: "a", sessionId: 1 };
  const projection = (work = ticket, phase = "recovery_required") => ({ adventureId: work.adventureId, revision: work.revision,
    actionId: work.actionId, save: { id: work.adventureId, revision: work.revision, actionId: work.actionId },
    storyFinale: { adventureId: work.adventureId, revision: work.revision,
      projection: { phase, actions: { resumeFinalization: phase !== "closed" } } } });
  const receipt = (work = ticket, phase = "recovery_required") => {
    const view = projection(work, phase);
    return { ok: true, ...work, projection: view, save: view.save, storyFinale: view.storyFinale,
      status: { ...status(work.adventureId, work.sessionId, work.revision), activeSave: view.save } };
  };
  const committed = { ...receipt(), actionResult: { status: "committed", revision: 5 }, derivedWork: ticket,
    envelope: { adventureId: "a", revision: 5, actionId: "new-action",
      segments: [{ type: "host", content: "门轻轻合上，你把保温杯放在桌边。" }] } };
  context.window.greyCrow.runTurn = async () => committed;
  return { ...app, ticket, committed, receipt, derivedRequests,
    startDerived() { const request = deferred(); pendingRequests.push(request); return request; },
    paint() { paint.resolve(); },
    async flush() { await new Promise((resolve) => setImmediate(resolve)); },
  };
}

function createStateHintRenderer(language) {
  const element = () => ({ children: [], dataset: {}, textContent: "",
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); },
    set innerHTML(value) { assert.equal(value, "", "Story text must never be assigned as HTML"); this.children = []; },
    querySelector(selector) {
      const key = /data-state-key="([^"]+)"/.exec(selector)?.[1];
      return this.children.find((node) => node.dataset.stateKey === key && node.dataset.stateRole === "value");
    },
  });
  const ui = { stateGrid: element(), storyNotebookDrawerBody: element(),
    storyNotebookWorldTitle: { textContent: "Test world" }, turnStatus: { textContent: "" } };
  const state = { runtimeProtocol: "session-1", activeSaveId: "status-adventure",
    activeSave: { id: "status-adventure", revision: 4, actionId: "status-action", schemaKind: "session" } };
  const context = vm.createContext({ state, ui, document: { createElement: element },
    t: (key) => key, getDisplayLocale: () => language, getDisplayLabel: (key) => key,
    DEFAULT_DISPLAY_LOCALE: "zh-CN", LOCATION_DISPLAY_NAMES: {}, INTERNAL_DISPLAY_SLUG_HINT_RE: /_internal_/,
    formatModelStatusText: () => "Synthetic", setStoryNotebookDrawerHeader() {},
  });
  install(context, rendererSource, ["renderStateHint", "addStateCell", "resolveDisplayGameDay", "resolveDisplayTurn",
    "formatLocationDisplay", "formatPlayerStatusDisplay", "selectLocalizedLabel", "formatUnmappedDisplayText",
    "normalizeReadableDisplayText", "normalizeDisplayKey", "isInternalDisplaySlug", "stripInternalDisplayRefs",
    "isLowerKebabInternalSlug", "redactDisplaySecrets", "readStoryNotebookStateValue",
    "renderStoryNotebookStateDrawer", "createStoryNotebookDrawerSection"], rendererPath);
  return { context, ui,
    value() { return ui.stateGrid.querySelector('[data-state-key="player"][data-state-role="value"]'); },
    drawerValue() {
      ui.storyNotebookDrawerBody.children = [];
      context.renderStoryNotebookStateDrawer();
      const list = ui.storyNotebookDrawerBody.children[0].children.find((node) => node.className === "story-notebook-state-list");
      return list.children.find((row) => row.children[0].textContent === "game.state").children[1].textContent;
    },
  };
}

function projectedStateHint(language, attributes) {
  const state = initialState();
  state.entities.p.attributes = attributes;
  return { adventureId: "status-adventure", revision: 4, actionId: "status-action", locale: language,
    state, narration: [{ id: "status-source", text: attributes.status || "Observed condition is unknown." }], history: [] };
}

function pending(overrides = {}) {
  return { adventureId: "a", actionId: "pending-a", baseRevision: 4,
    input: "归还借来的米。", status: "interrupted", ...overrides };
}

function busySave() {
  return { id: "busy-a", revision: null, turn: null, state_hint: null, compatibility: {
    status: "unavailable", errorCode: "STORE_BUSY", playerContinuable: false, retryable: true } };
}

function createBusyMain() {
  const handlers = {};
  const effects = { takes: 0, creates: 0, confirmations: 0, clears: 0, opens: 0, inspections: 0 };
  const context = vm.createContext({ redactSecrets, normalizeError, activeSaveId: null,
    keyVerified: true, activeBridge: {}, saves: [busySave()], selected: busySave(),
    inspected: busySave().compatibility,
    createStatus: () => ({}), assertTrustedSender() {},
    runtimeOperations: { has: () => false, begin: () => ({ finish() {}, isCurrent: () => true }) },
    newGameCreationConfirmations: { clear() { effects.clears += 1; } },
    saveMaintenanceConfirmations: { clear() { effects.clears += 1; } },
    takeNewGameCreationConfirmation() { effects.takes += 1; return null; },
    issueSaveMaintenanceConfirmation() { effects.confirmations += 1; return {}; },
    issueNewGameCreationConfirmation() { effects.confirmations += 1; return {}; },
    getNewGameLifecycle: () => ({ create() { effects.creates += 1; }, prepare() { effects.creates += 1; }, catalog() { effects.creates += 1; } }),
    ipcMain: { handle(name, fn) { handlers[name] = fn; } },
    CHANNELS: Object.fromEntries(["GET_NEW_GAME_CATALOG", "PREPARE_NEW_GAME", "CONFIRM_NEW_GAME_CREATION",
      "REQUEST_NEW_GAME_RESTART", "CONTINUE_GAME"].map((name) => [name, name])),
  });
  context.loadSaveSlot = async () => context.selected;
  context.listSaveSlots = async () => context.saves;
  context.getAdventureCompatibilityGate = () => ({
    inspect: async () => { effects.inspections += 1; return context.inspected; },
    openForPlayer: async () => { effects.opens += 1;
      throw Object.assign(new Error("private upstream lock detail"), { code: "STORE_BUSY", retryable: true }); },
  });
  install(context, mainSource, ["assertSaveNotBusy", "hasActiveAdventure", "resolveExistingSaveForNewGameRestart",
    "createFailure", "createFailureFromError", "normalizeUiErrorCode", "normalizeUiErrorParams", "normalizeUiErrorMessage"], mainPath);
  for (const name of Object.keys(context.CHANNELS)) {
    const start = mainSource.indexOf(`  ipcMain.handle(CHANNELS.${name},`);
    const end = mainSource.indexOf("\n  ipcMain.handle(", start + 1);
    assert(start >= 0 && end > start, `Missing Main handler ${name}`);
    new vm.Script(mainSource.slice(start, end), { filename: mainPath }).runInContext(context);
  }
  return { context, handlers, effects };
}

function createDerivedMain() {
  const { createRuntimeOperationRegistry } = require("../runtime-session");
  const calls = [];
  const bridge = { close: async () => calls.push("close") };
  const context = vm.createContext({ activeBridge: bridge, activeSaveId: "a", desktopSessionGeneration: "s1",
    activeSaveSummary: { id: "a", revision: 4, actionId: "action-4" }, gameStarted: true, keyVerified: true,
    runtimeOperations: createRuntimeOperationRegistry(), turnDerivedTickets: new Map(), turnDerivedQueue: null,
    crypto: require("node:crypto"), AbortController, AbortSignal, activePlayerTurn: null, sessionDisposal: Promise.resolve(),
    createFailure: (code) => ({ ok: false, error: { code } }),
    createFailureFromError: (error) => ({ ok: false, error: { code: error.code || "DERIVED_FAILED" } }),
    adoptCompactionGeneration() {}, bindSessionContextUsage: (value) => value,
    createSessionId: (id) => id,
    ADVENTURE_QUIESCE_OPERATION_KINDS: ["run-turn", "turn-derived", "manual-save", "context-compaction", "adventure-lifecycle"],
    ADVENTURE_WRITE_QUIESCE_TIMEOUT_MS: 1000 });
  context.createStatus = () => ({ runtimeSessionId: context.desktopSessionGeneration,
    activeSaveId: context.activeSaveId, activeSave: context.activeSaveSummary });
  install(context, mainSource, ["runSessionDesktopTurn", "issueTurnDerivedTicket", "completeSessionTurnDerived",
    "isDesktopProjectionBindingCurrent", "quiesceAdventureWrites"], mainPath);
  function ticket(revision = context.activeSaveSummary.revision, kind = "chapter") {
    const actionId = `action-${revision}`;
    return context.issueTurnDerivedTicket({ actionId, revision, kind, trigger: kind === "chapter" ? "interval" : "finale" },
      { actionId, revision, status: "committed", generationPasses: 1 },
      { bridge, adventureId: "a", generation: "s1", revision });
  }
  return { context, bridge, calls, ticket };
}

function createDetailRenderer(panelRef = "session_characters", language = "zh-CN", configureSource = () => {}) {
  const app = createRenderer();
  const { context, state, ui } = app;
  const source = initialState();
  configureSource(source);
  source.inventory.push({ ownerId: "p", itemId: "rice", quantity: 1 });
  for (let index = 1; index <= 25; index++) source.commitments[`promise-${index}`] = {
    id: `promise-${index}`, debtorId: "p", creditorId: "npc", itemId: "rice", quantity: 1,
    due: index === 25 ? `${"明".repeat(3996)}完整尾条` : `旧约定-${index}`, status: index === 25 ? "open" : "fulfilled" };
  const view = { adventureId: "a", revision: 4, actionId: "action-4", locale: language,
    contentVersion: "v1", state: source, narration: [], history: [] };
  const fieldId = panelRef === "session_characters" ? "characters" : "inventory";
  const list = projectSessionPanel(view, { panelRef, view: "list", fieldId, displayLocale: language });
  const item = list.panel.items.find((entry) => entry.title === (fieldId === "characters" ? "陈姨" : "袋装米"));
  Object.assign(state, { activeSkillPanel: { panelRef, title: panelRef }, notebookDrawerPanel: fieldId === "characters" ? "characters" : "modules",
    notebookDrawerView: "panel-item-detail", notebookDrawerSelectedFieldId: fieldId, notebookDrawerSelectedItemRef: item.ref,
    skillPanelViewRequestRevision: 0, skillPanelRefreshBusy: false, skillPanelViewError: "", activeSkillPanelProjection: null });
  const requests = [];
  const effects = { renders: 0, focused: null };
  const descendants = (node) => [node, ...node.children.flatMap(descendants)];
  const matches = (node, selector) => selector === "summary" ? node.tagName === "SUMMARY"
    : selector === "[data-detail-reading-key]" ? node.dataset.detailReadingKey !== undefined
    : selector === "details.story-notebook-detail-text" ? node.tagName === "DETAILS" && node.className === "story-notebook-detail-text"
    : /data-detail-record-id="([^"]+)"/.test(selector) ? node.dataset.detailRecordId === /data-detail-record-id="([^"]+)"/.exec(selector)[1]
    : false;
  const element = (tag = "div") => ({ tagName: tag.toUpperCase(), children: [], dataset: {}, listeners: {}, ownText: "", className: "", open: false,
    parentNode: null, scrollTop: 0, offsetHeight: 600, nativeDisabled: false,
    get disabled() { return this.nativeDisabled; },
    set disabled(value) {
      this.nativeDisabled = value;
      if (value && context.document?.activeElement === this) context.document.activeElement = context.document.body;
    },
    get textContent() { return this.ownText + this.children.map(node => node.textContent).join(""); },
    set textContent(value) { this.ownText = value; this.children = []; },
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } },
    appendChild(node) { this.append(node); },
    replaceChildren(...nodes) {
      if (this.contains(context.document.activeElement)) context.document.activeElement = context.document.body;
      this.children = []; this.ownText = ""; this.append(...nodes);
    },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    querySelectorAll(selector) { return descendants(this).slice(1).filter(node => matches(node, selector)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    closest(selector) { return matches(this, selector) ? this : this.parentNode?.closest(selector) || null; },
    contains(node) { return descendants(this).includes(node); },
    focus() { effects.focused = this; context.document.activeElement = this;
      for (const handler of context.document.listeners.get("focusin") || []) handler({ type: "focusin", target: this }); },
    getBoundingClientRect() { return { top: 0, bottom: 600, height: 600 }; },
  });
  context.document = { createElement: element, activeElement: null, body: element("body"), listeners: new Map(),
    addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); },
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); },
  };
  ui.storyNotebookDrawerBody = element();
  ui.storyNotebookDrawerTitle = element();
  ui.storyNotebookDrawerRefreshButton = element();
  context.createStoryNotebookDrawerSection = element;
  context.setStoryNotebookDrawerHeader = () => {};
  context.appendStoryNotebookPanelError = () => {};
  context.appendStoryNotebookPanelLoading = () => {};
  context.renderStoryNotebookPanelFields = () => {};
  context.isStoryNotebookDrawerOpen = (panel) => state.notebookDrawerPanel === panel;
  context.isStoryNotebookPanelDrawerOpen = () => ["characters", "modules"].includes(state.notebookDrawerPanel);
  context.applyStatus = () => true;
  context.renderStoryNotebookDrawer = () => {
    effects.renders += 1;
    const reading = context.captureStoryNotebookDetailReadingState(ui.storyNotebookDrawerBody);
    ui.storyNotebookDrawerBody.replaceChildren();
    context.renderStoryNotebookPanelRecordDetail(state.activeSkillPanel, state.activeSkillPanelProjection);
    context.restoreStoryNotebookDetailReadingState(ui.storyNotebookDrawerBody, reading);
  };
  context.window.greyCrow.getSkillPanel = (ref, options) => {
    const request = deferred();
    requests.push({ ...request, ref, options: { ...options }, result: { ok: true,
      ...projectSessionPanel(view, { ...options, panelRef: ref, displayLocale: language }), status: status("a", 1, 4) } });
    return request.promise;
  };
  install(context, rendererSource, ["isRuntimePanelResultCurrent", "loadStoryNotebookPanelView", "mergeStoryNotebookPanelDetail",
    "loadMoreStoryNotebookPanelDetail", "renderStoryNotebookPanelRecordDetail", "isNativeStoryNotebookDetail",
    "createStoryNotebookDetailText", "storyNotebookDetailReadingBinding", "captureStoryNotebookDetailReadingState",
    "restoreStoryNotebookDetailReadingState", "getChapterScrollOffset", "isLongStoryNotebookDetailText"], rendererPath);
  return { ...app, requests, effects, view,
    disclosure: key => descendants(ui.storyNotebookDrawerBody).find(node => node.tagName === "DETAILS" && node.dataset.detailReadingKey === key),
    visibleText: () => {
      const read = node => node.tagName === "DETAILS" && !node.open
        ? node.children.filter(child => child.tagName === "SUMMARY").map(read).join("")
        : node.ownText + node.children.map(read).join("");
      return read(ui.storyNotebookDrawerBody);
    },
    target: { view: "detail", fieldId, itemRef: item.ref },
    records: () => descendants(ui.storyNotebookDrawerBody).filter((node) => node.className === "story-notebook-panel-detail-record"),
    buttons: () => descendants(ui.storyNotebookDrawerBody).filter((node) => node.className.includes("story-notebook-panel-load-more")),
    async firstPage() {
      const loading = context.loadStoryNotebookPanelView({ view: "detail", fieldId, itemRef: item.ref });
      requests[0].resolve(requests[0].result);
      assert.equal(await loading, true);
    },
  };
}

function createNotebookNavigationRenderer() {
  const state = { ...status("a", 1, 4), gameUiLayout: "story-notebook-v1", notebookNavigationRevision: 0,
    notebookDrawerPanel: null, notebookDrawerFocusTimer: null, notebookDrawerView: "root",
    characterPanelEntry: null, characterPanelRefreshError: "retry available", characterPanelRefreshBusy: false,
    characterPanelRequestRevision: 0, skillPanelListRequestRevision: 0, skillPanelViewRequestRevision: 0,
    skillModulePages: new Map() };
  const document = { activeElement: null };
  const effects = { characterLoads: 0, focuses: 0 };
  const node = () => {
    const classes = new Set();
    const attributes = new Map();
    return { dataset: {}, isConnected: true, open: false,
      classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key),
        toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key) },
      setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
      appendChild(child) { child.parentNode = this; },
      focus() { document.activeElement = this; effects.focuses += 1; },
      showModal() { this.open = true; }, close() { this.open = false; } };
  };
  const home = node();
  const ui = { gameView: node(), storyNotebookDrawer: node(), storyNotebookDrawerTitle: node(),
    skillModuleDialog: node(),
    settingsDialog: node(), settingsStatus: node(), storyNotebookRailButtons: [] };
  home.appendChild(ui.storyNotebookDrawer);
  const timers = new Map();
  let timerId = 0;
  const request = deferred();
  const context = vm.createContext({ state, ui, document, speechInputController: null,
    STORY_NOTEBOOK_DRAWER_PANELS: new Set(["state", "characters", "modules", "chapters"]),
    window: { greyCrow: { getCharacterPanelEntry: () => request.promise },
      setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
      clearTimeout(id) { timers.delete(id); } },
    t: key => key, applyStatus: () => true, formatError: () => "synthetic read failure",
    renderStoryNotebookDrawer() {}, renderStoryNotebookCharacterAvailability() {},
    loadStoryNotebookCharacterDirectory() { effects.characterLoads += 1; },
    refreshStoryNotebookSkillPanels() {}, refreshChapterLogs() {},
    renderSettingsStatus() {}, renderAudioSettings() {}, renderContextPolicyStatus() {}, switchSettingsTab() {},
    renderProviderOptions() {}, renderCustomConnectionSettings() {}, renderCredentialSettings() {},
    inferSettingsTabFromMessage: () => "display", renderAdvancedMetrics() {},
    focusActiveSettingsTab() { ui.settingsDialog.focus(); },
  });
  install(context, rendererSource, ["invalidateStoryNotebookNavigation", "invalidateStoryNotebookPanelViewRequests",
    "captureRuntimeViewBinding", "isRuntimeViewBindingCurrent", "isRuntimePanelResultCurrent",
    "isStoryNotebookDrawerOpen", "syncStoryNotebookRailState", "focusStoryNotebookDrawerTitle",
    "openStoryNotebookDrawer", "closeStoryNotebookDrawer", "refreshStoryNotebookCharacterPanelEntry",
    "openGameSettingsFromStoryRail",
    "openSettings", "resetStoryNotebookPanelState", "openStoryNotebookModuleDetail", "getStoryNotebookModuleKey"], rendererPath);
  return { state, ui, context, document, effects, node, home,
    startRetry() { context.openStoryNotebookDrawer("characters", node()); },
    flushFocus() { for (const [id, callback] of timers) { timers.delete(id); callback(); } },
    async completeRetry() {
      request.resolve({ ok: true, supported: true, panel: { panelRef: "session_characters" },
        adventureId: "a", revision: 4, status: status("a", 1, 4) });
      await new Promise(resolve => setImmediate(resolve));
      this.flushFocus();
    },
  };
}

function createChapterRenderer(language = "zh-CN", { scaleY = 1 } = {}) {
  const state = { runtimeProtocol: "session-1", activeSaveId: "chapter-a", chapterCursor: null };
  const document = { activeElement: null };
  const descendants = (node) => node.children.flatMap(child => [child, ...descendants(child)]);
  const matches = (node, selector) => selector === "[data-chapter-key]" ? node.dataset.chapterKey !== undefined
    : selector === "details.chapter-details" ? node.tagName === "details" && node.className === "chapter-details"
    : selector === "summary" ? node.tagName === "summary" : false;
  const element = (tagName) => ({ tagName, children: [], dataset: {}, listeners: {}, className: "", open: false,
    scrollTop: 0, offsetHeight: 600, ownText: "", parentNode: null,
    get textContent() { return this.ownText + this.children.map(node => node.textContent).join(""); },
    set textContent(value) { this.ownText = value; this.children = []; },
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } },
    appendChild(node) { this.append(node); },
    replaceChildren(...nodes) {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      this.children = []; this.ownText = ""; this.append(...nodes);
    },
    classList: { add() {} },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    querySelectorAll(selector) { return descendants(this).filter(node => matches(node, selector)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    contains(node) { return this === node || descendants(this).includes(node); },
    focus() { document.activeElement = this; },
    getBoundingClientRect() {
      if (this.dataset.chapterKey !== undefined) {
        const index = this.parentNode.children.filter(node => node.dataset.chapterKey !== undefined).indexOf(this);
        const top = 100 + (index * 200 - this.parentNode.scrollTop) * scaleY;
        return { top, bottom: top + 200 * scaleY, height: 200 * scaleY };
      }
      return { top: 100, bottom: 100 + 600 * scaleY, height: 600 * scaleY };
    },
  });
  document.createElement = element;
  document.body = element("body");
  const ui = { chapterLogList: element("div") };
  ui.storyNotebookDrawerBody = ui.chapterLogList;
  let strings;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../renderer/locales/${language}.js`), "utf8"),
    { GreyCrowI18n: { register: (_locale, messages) => { strings = messages; } } });
  const context = vm.createContext({ state, ui, document, getUiLocale: () => language,
    t: (key, params = {}) => (strings[key] || key).replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? "")),
    cleanPlayerVisibleDisplayText: value => typeof value === "string" ? value.trim() : "",
    getStoryFinalePhase: () => "closed", formatSaveDate: () => "2026-09-11", renderSessionChapterButtons: () => {},
    setStoryNotebookDrawerHeader: () => {},
  });
  const names = ["renderChapterLogs", "getChapterReviewContent", "captureChapterReadingState", "restoreChapterReadingState",
    "getChapterScrollOffset", "renderStoryNotebookDrawer", "renderStoryNotebookChapterDrawer", "isNativeStoryNotebookDetail",
    "storyNotebookDetailReadingBinding", "captureStoryNotebookDetailReadingState", "restoreStoryNotebookDetailReadingState"];
  install(context, rendererSource, names, rendererPath);
  const find = (node, className) => descendants(node).filter(child => child.className === className);
  const visibleText = (node) => node.tagName === "details" && !node.open
    ? node.children.filter(child => child.tagName === "summary").map(visibleText).join("")
    : node.ownText + node.children.map(visibleText).join("");
  return { state, ui, document, context, find, visibleText,
    render(chapters) { context.renderChapterLogs(chapters); return ui.chapterLogList; },
    cards() { return find(ui.chapterLogList, "chapter-card"); },
    details(card) { return card.querySelector("details.chapter-details"); },
  };
}

const checks = [
  ["pending deletion confirmation cannot close or delete a rebuilt active adventure", async () => {
    const app = createDerivedMain(), { context, calls } = app;
    const handlers = {};
    const pending = { deletionId: ".a.deleting-0123456789abcdef", saveId: "a", state: "delete_pending" };
    const store = { listPendingDeletes: async () => [pending],
      retryPendingDelete: async id => { assert.equal(id, pending.deletionId); calls.push("cleanup"); return { ok: true, deleted: true, saveId: "a" }; },
      deleteConfirmed: async () => { throw new Error("must not delete rebuilt adventure"); } };
    Object.assign(context, { getSaveSlotStore: () => store, ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
      CHANNELS: { REQUEST_SAVE_MAINTENANCE: "request", CONFIRM_SAVE_MAINTENANCE: "confirm" },
      assertTrustedSender() {}, SAVE_MAINTENANCE_ACTIONS: { clear: { requiresText: true, confirmationText: "DELETE" } },
      saveMaintenanceConfirmations: new Map(), MAINTENANCE_CONFIRMATION_TTL_MS: 120000,
      loadSaveSlot: async () => ({ id: "a", revision: 4 }), listSaveSlots: async () => [{ id: "a", revision: 4 }],
      normalizeDebugTraceIdentifier: value => value });
    install(context, mainSource, ["executeSaveMaintenanceAction", "issueSaveMaintenanceConfirmation", "getSaveMaintenanceConfirmation",
      "pruneExpiredMaintenanceConfirmations", "normalizeSaveMaintenanceAction", "normalizeConfirmationToken",
      "projectSaveMaintenanceConfirmation", "projectSaveMaintenanceInspection", "projectSaveMaintenanceResult"], mainPath);
    const start = mainSource.indexOf("  ipcMain.handle(CHANNELS.REQUEST_SAVE_MAINTENANCE,");
    const end = mainSource.indexOf("  ipcMain.handle(CHANNELS.READ_CONTEXT_COMPACTION,", start);
    new vm.Script(mainSource.slice(start, end)).runInContext(context);
    assert.equal((await handlers.request({}, { action: "clear", deletionId: "../../settings.json" })).ok, false);
    const prepared = await handlers.request({}, { action: "clear", deletionId: pending.deletionId });
    assert.equal(prepared.ok, true); assert.equal(prepared.confirmation.scope, "delete_pending");
    const payload = { confirmationToken: prepared.confirmation.confirmationToken, confirmationText: "DELETE" };
    assert.equal((await handlers.confirm({}, { ...payload, confirmationText: "wrong" })).ok, false);
    assert.equal((await handlers.confirm({}, payload)).ok, true);
    assert.deepEqual(calls, ["cleanup"], "cleanup must not close or quiesce the normal adventure");
    assert.equal(context.activeSaveId, "a"); assert.equal(context.gameStarted, true);
    assert.equal((await handlers.confirm({}, payload)).ok, false, "confirmation is consumed");
  }],
  ["access denial survives session normalization into distinct Main and Renderer guidance", () => {
    const safe = projectProviderError({ code: "UPSTREAM_ACCESS_DENIED", retryable: true });
    assert.deepEqual(safe, { code: "UPSTREAM_ACCESS_DENIED", retryable: false });
    const main = createBusyMain();
    const message = main.context.normalizeUiErrorMessage("PRIVATE_UPSTREAM_DETAIL", safe.code);
    assert.match(message, /拒绝/);
    assert.doesNotMatch(message, /鉴权失败|PRIVATE_UPSTREAM_DETAIL/);
    const renderer = createRenderer();
    install(renderer.context, rendererSource, ["modelFailureExplanation"], rendererPath);
    assert.deepEqual([...renderer.context.modelFailureExplanation(safe.code)], ["access", "connection"]);
  }],
  ["chapter readability keeps short summaries whole and every long review qualifier reachable in three languages", () => {
    for (const language of ["zh-CN", "en-US", "ja-JP"]) {
      const short = "你尚未决定" + "，仍在观察".repeat(35) + "；并未答应归还。";
      const long = "她提到旧约定。".repeat(45) + "但这只是一种猜测，并未得到证实。";
      const events = Array.from({ length: 9 }, (_, index) => `事件${index + 1}：${"保留条件".repeat(40)}；尚未完成。`);
      const threads = ["这是待核实的线索，并非已经接受的任务。", "只有对方同意后才能继续。"];
      for (const sources of [undefined, { key_events: [] }]) {
        const app = createChapterRenderer(language);
        const chapters = [{ chapter_id: "internal-short-id", title: "短回顾", summary: short, key_events: events, open_threads: threads, sources },
          { chapter_id: "internal-long-id", title: "长回顾", summary: long, key_events: events, open_threads: threads, sources }];
        const original = JSON.stringify(chapters);
        const container = app.render(chapters);
        const [longCard, shortCard] = app.cards();
        assert.equal(app.find(shortCard, "chapter-summary")[0]?.textContent, short, "short summaries must remain complete, including their final qualifier");
        assert.equal(app.visibleText(shortCard).includes(events[0]), false, "events belong in the full review, not a repeated default overview");
        assert.equal(app.find(longCard, "chapter-summary").length, 0, "long summaries must not become a mechanically shortened claim");
        assert.equal(app.visibleText(longCard).includes(long.slice(0, 30)), false);
        assert.ok(app.find(longCard, "chapter-overview-counts")[0].textContent.includes("9"));
        for (const card of [shortCard, longCard]) {
          const details = app.details(card);
          assert(details && !details.open && details.children[0].tagName === "summary");
          details.open = true;
          for (const value of [...events, ...threads]) assert.ok(app.visibleText(card).includes(value));
          assert.equal(app.find(card, "chapter-review").length, 0);
        }
        assert.ok(app.visibleText(longCard).includes(long));
        assert.equal(container.textContent.includes("internal-short-id"), false);
        assert.equal(JSON.stringify(chapters), original, "presentation must not rewrite the saved chapter");
      }
      const untitled = createChapterRenderer(language).render([{ chapter_id: "internal-fallback-id", summary: short }]);
      assert.equal(untitled.textContent.includes("internal-fallback-id"), false, "internal identifiers are not player titles");
    }
  }],
  ["chapter readability thresholds follow the story script and never split a sentence or code point", () => {
    for (const language of ["zh-CN", "en-US", "ja-JP"]) {
      const app = createChapterRenderer(language);
      for (const [summary, shown] of [["中".repeat(240), true], ["中".repeat(241), false],
        ["あ".repeat(241), false], ["a".repeat(600), true], ["a".repeat(601), false], ["中" + "🙂".repeat(239), true]]) {
        app.render([{ chapter_id: "threshold", title: "Threshold", summary }]);
        const card = app.cards()[0];
        assert.equal(app.find(card, "chapter-summary").length === 1, shown, `${language}: ${Array.from(summary).length} code points`);
        assert.equal(card.textContent.includes(summary), true);
      }
    }
  }],
  ["chapter readability preserves expanded reviews and reading anchors through refresh and pagination only within one adventure", () => {
    const app = createChapterRenderer();
    const chapter = id => ({ chapter_id: id, title: id, summary: "长".repeat(300), key_events: ["未完成"] });
    app.render([chapter("one"), chapter("two")]);
    app.details(app.cards()[1]).open = true;
    app.details(app.cards()[1]).querySelector("summary").focus();
    app.ui.chapterLogList.scrollTop = 250;
    app.state.notebookDrawerPanel = "chapters";
    app.context.renderStoryNotebookDrawer(); // Outer drawer reset also precedes a refreshed page.
    app.render([chapter("one"), chapter("two")]);
    assert.equal(app.details(app.cards()[1]).open, true);
    assert.equal(app.ui.chapterLogList.scrollTop, 250);
    assert.equal(app.document.activeElement, app.details(app.cards()[1]).querySelector("summary"));
    app.render([]);
    const input = app.document.createElement("button");
    input.focus();
    app.render([chapter("one"), chapter("two")]);
    assert.equal(app.document.activeElement, input, "late refresh must not steal focus from another control");
    app.render([chapter("one"), chapter("two"), chapter("three")]);
    assert.equal(app.details(app.cards()[2]).open, true);
    assert.equal(app.ui.chapterLogList.scrollTop, 450, "preserve the visible chapter offset when rendering inserts another card above it");
    app.state.activeSaveId = "chapter-b";
    app.render([chapter("one"), chapter("two")]);
    assert.equal(app.cards().some(card => app.details(card).open), false);
    assert.equal(app.ui.chapterLogList.scrollTop, 0);
  }],
  ["chapter readability preserves anchors in a scaled game canvas without mixing screen and scroll pixels", () => {
    for (const scaleY of [0.7875, 0.8, 1.25]) {
      const app = createChapterRenderer("zh-CN", { scaleY });
      const chapter = id => ({ chapter_id: id, title: id, summary: "长".repeat(300), key_events: ["尚未确认"] });
      app.render([chapter("one"), chapter("two")]);
      app.details(app.cards()[1]).open = true;
      app.ui.chapterLogList.scrollTop = 250;
      const before = app.cards()[1].getBoundingClientRect().top;
      app.render([chapter("one"), chapter("two"), chapter("three")]);
      assert.equal(app.cards()[2].getBoundingClientRect().top, before, `the same visible chapter must stay at the same screen position at scale ${scaleY}`);
      assert.equal(app.ui.chapterLogList.scrollTop, 450, "scroll changes use unscaled CSS pixels");
    }
  }],
  ["current commitments are readable before history and retain complete terms through paging in three languages", async () => {
    for (const language of ["zh-CN", "en-US", "ja-JP"]) for (const panelRef of ["session_characters", "session_inventory"]) {
      const app = createDetailRenderer(panelRef, language);
      await app.firstPage();
      assert.equal(app.records().length, 24);
      const first = app.state.activeSkillPanelProjection;
      assert.equal(first.detail.sections[0].id, "commitments_open", "pending obligations lead the reading view");
      const current = first.detail.sections[0].records[0];
      assert(current.heading.includes("陈姨") && current.heading.includes("袋装米") && current.heading.includes("1"));
      assert.ok(app.visibleText().includes(current.heading), "participants, item and quantity are visible without opening long terms");
      assert.equal(app.visibleText().includes("完整尾条"), false);
      assert.equal(app.visibleText().includes("旧约定-1"), false, "history is not dumped into the default reading view");
      const previousRecords = new Map(first.detail.sections.map(section => [section.id, JSON.stringify(section.records)]));
      assert.equal(app.buttons().length, 1);
      const loading = app.buttons()[0].listeners.click();
      const ignoredDoubleClick = app.buttons()[0].listeners.click();
      assert.equal(app.requests.length, 2, "A double click cannot fetch the same page twice");
      assert.equal(app.requests[1].options.cursor, first.pagination.nextCursor);
      assert.equal(app.requests[1].options.limit, 24);
      app.requests[1].resolve(app.requests[1].result);
      await loading; await ignoredDoubleClick;
      assert.equal(app.records().length, 25);
      assert.equal(app.buttons().length, 0);
      for (const section of app.state.activeSkillPanelProjection.detail.sections) {
        const prior = JSON.parse(previousRecords.get(section.id));
        assert.equal(JSON.stringify(section.records.slice(0, prior.length)), JSON.stringify(prior));
      }
      const history = app.disclosure("section:commitments_history");
      assert(history && !history.open);
      assert.equal(app.effects.focused, history.querySelector("summary"), "new history focuses the closed group's visible entry");
      history.open = true;
      assert.ok(app.visibleText().includes("旧约定-24"));
      assert.equal(app.visibleText().includes("完整尾条"), false, "opening history does not also open current long terms");
      const article = app.records().find(record => record.dataset.detailRecordId === current.id);
      const terms = article.querySelector("details.story-notebook-detail-text");
      assert(terms && !terms.open);
      terms.open = true;
      assert.ok(app.visibleText().includes(app.view.state.commitments["promise-25"].due));
      terms.querySelector("summary").focus();
      const refresh = app.context.loadStoryNotebookPanelView(app.target);
      app.requests.at(-1).resolve(app.requests.at(-1).result);
      assert.equal(await refresh, true);
      const refreshedCurrent = app.records().find(record => record.dataset.detailRecordId === current.id);
      assert.equal(refreshedCurrent.querySelector("details.story-notebook-detail-text").open, true);
      assert.equal(app.disclosure("section:commitments_history").open, true);
      assert.equal(app.context.document.activeElement, refreshedCurrent.querySelector("summary"));
      assert.equal(app.state.activeSave.revision, 4);
    }
  }],
  ["long native detail text is disclosed whole across pages and focuses only visible content", async () => {
    const visibleText = node => node.tagName === "DETAILS" && !node.open
      ? node.children.filter(child => child.tagName === "SUMMARY").map(visibleText).join("")
      : node.ownText + node.children.map(visibleText).join("");
    for (const language of ["zh-CN", "en-US", "ja-JP"]) for (const panelRef of ["session_characters", "session_inventory"]) {
      const phrase = { "zh-CN": "她只是转述门外的声音，仍不能确认来源。", "en-US": "She only described the sound outside and could not confirm its source. ",
        "ja-JP": "外から聞こえた音を伝えただけで、出所はまだ確認できていない。" }[language];
      const tail = { "zh-CN": "她没有确认对方身份，也没有承诺开门。", "en-US": "She did not confirm the visitor's identity or promise to open the door.",
        "ja-JP": "相手の身元は確認しておらず、戸を開けるとも約束していない。" }[language];
      const description = phrase.repeat(Math.ceil(145000 / phrase.length)) + tail;
      const entityId = panelRef === "session_characters" ? "npc" : "rice";
      const app = createDetailRenderer(panelRef, language, source => { source.entities[entityId].attributes.description = description; });
      const original = JSON.stringify(app.view.state);
      const body = app.ui.storyNotebookDrawerBody;
      const disclosure = () => app.disclosure("section:attribute_text");
      const textSection = () => app.state.activeSkillPanelProjection.detail.sections.find(section => section.id === "attribute_text");
      await app.firstPage();
      assert.ok(textSection());
      assert.ok(textSection().records.length < textSection().fields.find(field => field.id === "record_count").value);
      assert.equal(disclosure().open, false);
      assert.equal(visibleText(body).includes(phrase), false, "closed text does not burden the default reading view");
      disclosure().querySelector("summary").focus();
      const second = app.buttons()[0].listeners.click();
      app.requests.at(-1).resolve(app.requests.at(-1).result);
      await second;
      assert.equal(disclosure().open, false);
      assert.equal(app.effects.focused, disclosure().querySelector("summary"), "a closed text region receives focus on its visible summary");
      disclosure().open = true;
      assert.ok(visibleText(body).includes(phrase));
      let pages = 2;
      while (app.state.activeSkillPanelProjection.pagination.hasMore) {
        assert.ok(++pages < 20);
        const next = app.buttons()[0].listeners.click();
        app.requests.at(-1).resolve(app.requests.at(-1).result);
        await next;
        assert.equal(disclosure().open, true, "loaded text remains open when another page is appended");
      }
      assert.equal(textSection().records.map(record => record.text).join(""), description);
      assert.ok(visibleText(body).includes(tail));
      assert.equal(textSection().records.length, textSection().fields.find(field => field.id === "record_count").value);
      assert.equal(JSON.stringify(app.view.state), original, "rendering and paging never rewrite stored facts");
      assert.equal(app.buttons().length, 0);
    }
  }],
  ["native refresh focus survives disabling but never follows a stale request or overrides another choice", async () => {
    for (const choice of ["stay", "outside", "back-to-body", "new-revision"]) {
      const app = createDetailRenderer();
      await app.firstPage();
      const document = app.context.document;
      const refresh = app.ui.storyNotebookDrawerRefreshButton;
      refresh.focus();
      const loading = app.context.loadStoryNotebookPanelView(app.target);
      assert.equal(document.activeElement, document.body, "native disabled buttons lose focus while waiting");
      const outside = document.createElement("button");
      if (choice === "outside" || choice === "back-to-body") outside.focus();
      if (choice === "back-to-body") document.body.focus();
      if (choice === "new-revision") app.state.activeSave = { id: "a", revision: 5 };
      app.requests.at(-1).resolve(app.requests.at(-1).result);
      assert.equal(await loading, choice !== "new-revision");
      assert.equal(document.activeElement, choice === "stay" ? refresh : choice === "outside" ? outside : document.body);
      assert.ok([...document.listeners.values()].every(handlers => handlers.size === 0), "request-local focus listeners are always removed");
    }
  }],
  ["character retry opens its still-current notebook destination and closes back to its opener", async () => {
    const app = createNotebookNavigationRenderer();
    app.startRetry();
    await app.completeRetry();
    assert.equal(app.state.notebookDrawerPanel, "characters");
    assert.equal(app.effects.characterLoads, 1);
    assert.equal(app.document.activeElement, app.ui.storyNotebookDrawerTitle);
    assert.equal(app.ui.storyNotebookDrawer.parentNode, app.home);
    const opener = app.state.notebookDrawerOpener;
    app.context.closeStoryNotebookDrawer();
    assert.equal(app.document.activeElement, opener);
    assert.equal(app.ui.storyNotebookDrawer.parentNode, app.home);
  }],
  ["late character retry never overrides newer navigation, settings, or an adventure binding", async () => {
    const scenarios = [
      ["another tab", app => app.context.openStoryNotebookDrawer("chapters", app.node()), true],
      ["close before any drawer opens", app => app.context.closeStoryNotebookDrawer(), true],
      ["settings opened and closed", app => { app.context.openGameSettingsFromStoryRail(); app.ui.settingsDialog.close(); }, true],
      ["same tab closed and reopened", app => {
        app.context.openStoryNotebookDrawer("state", app.node());
        app.context.closeStoryNotebookDrawer();
        app.context.openStoryNotebookDrawer("state", app.node());
      }, true],
      ["detail navigation inside the existing page", app => app.context.openStoryNotebookModuleDetail({ moduleRef: "chosen" }), true],
      ["runtime reset", app => app.context.resetStoryNotebookPanelState(), false],
      ["another adventure", app => { app.state.activeSaveId = "b"; }, false],
      ["replacement session", app => { app.state.runtimeSessionId = 2; }, false],
      ["new committed revision", app => { app.state.activeSave = { id: "a", revision: 5 }; }, false],
    ];
    for (const [label, navigate, cacheMayRefresh] of scenarios) {
      const app = createNotebookNavigationRenderer();
      if (label === "detail navigation inside the existing page") {
        app.context.openStoryNotebookDrawer("modules", app.node());
      }
      app.startRetry();
      navigate(app);
      app.flushFocus();
      const destination = app.state.notebookDrawerPanel;
      const view = app.state.notebookDrawerView;
      const chosenFocus = app.document.activeElement;
      const focuses = app.effects.focuses;
      await app.completeRetry();
      assert.equal(app.state.notebookDrawerPanel, destination, label);
      assert.equal(app.state.notebookDrawerView, view, label);
      assert.equal(app.document.activeElement, chosenFocus, label);
      assert.equal(app.effects.focuses, focuses, `${label}: late retry must not steal focus`);
      assert.equal(app.effects.characterLoads, 0, `${label}: late retry must not open the directory`);
      assert.equal(Boolean(app.state.characterPanelEntry), cacheMayRefresh,
        `${label}: navigation and runtime cache ownership remain separate`);
    }
  }],
  ["late detail pages cannot append after another item, revision, session or closed drawer becomes current", async () => {
    for (const change of [
      (app) => { app.state.notebookDrawerSelectedItemRef = "another-item"; },
      (app) => { app.state.activeSave = { id: "a", revision: 5 }; },
      (app) => { app.state.runtimeSessionId = 2; },
      (app) => { app.state.notebookDrawerPanel = null; },
    ]) {
      const app = createDetailRenderer();
      await app.firstPage();
      const loading = app.buttons()[0].listeners.click();
      change(app);
      const newer = { currentView: "must not be replaced" };
      app.state.activeSkillPanelProjection = newer;
      app.state.skillPanelRefreshBusy = true;
      const renders = app.effects.renders;
      app.requests[1].resolve(app.requests[1].result);
      await loading;
      assert.equal(app.state.activeSkillPanelProjection, newer);
      assert.equal(app.state.skillPanelRefreshBusy, true, "An old request cannot clear a newer operation's busy state");
      assert.equal(app.effects.renders, renders);
    }
  }],
  ["detail page failure or duplicate records keep the complete previous page available for retry", async () => {
    for (const kind of ["failure", "duplicate", "wrong-total", "wrong-item"]) {
      const app = createDetailRenderer();
      await app.firstPage();
      const original = app.state.activeSkillPanelProjection;
      const loading = app.buttons()[0].listeners.click();
      const result = structuredClone(app.requests[1].result);
      if (kind === "failure") Object.assign(result, { ok: false, error: { message: "page unavailable" } });
      if (kind === "duplicate") {
        const incomingSection = result.panel.detail.sections.find(section => section.records.length);
        const priorSection = original.detail.sections.find(section => section.id === incomingSection.id);
        incomingSection.records[0] = structuredClone(priorSection.records[0]);
      }
      if (kind === "wrong-total") result.panel.pagination.totalItems += 1;
      if (kind === "wrong-item") result.panel.detail.ref = "different-item";
      app.requests[1].resolve(result);
      await loading;
      assert.equal(app.state.activeSkillPanelProjection, original);
      assert.equal(app.records().length, 24);
      assert.equal(app.buttons().length, 1);
      assert.equal(app.state.skillPanelRefreshBusy, false);
      assert.ok(app.state.skillPanelViewError);
      const retry = app.buttons()[0].listeners.click();
      assert.equal(app.requests[2].options.cursor, original.pagination.nextCursor);
      app.requests[2].resolve(app.requests[2].result);
      await retry;
      assert.equal(app.records().length, 25);
      assert.equal(app.state.skillPanelViewError, "");
    }
  }],
  ["multi-paragraph committed narration reaches one speech request from first paragraph to last", async () => {
    const app = createSpeechRenderer();
    app.context.renderEnvelope(app.envelope([
      { type: "host", content: "门外传来雨声。" },
      { type: "warning", content: "内部警告不应朗读。" },
      { type: "host", content: '桌上有张卡片，key=synthetic-private-value\n\n```json\n{"candidate_events":["internal payload"]}\n```\n\n你把卡片翻过来。' },
      { type: "host", content: '```json\n{"operation_trace":"internal-only"}\n```' },
      { type: "host", content: "最后，你听见钟声。" },
    ]));
    assert.equal(app.starts.length, 1, "Paragraphs must not cancel one another through separate start requests");
    assert.equal(app.starts[0].text, "门外传来雨声。 桌上有张卡片，key=[redacted] 你把卡片翻过来。 最后，你听见钟声。");
    assert.equal(app.ui.narrationPanel.children.length, 4, "Visible paragraphs and warnings remain separate");
    assert.equal(app.ui.narrationPanel.children.filter((line) => line.children.some((child) => child.className === "tts-line-button")).length, 3);
    await app.finish();
    assert.deepEqual(app.continued, ["utterance-0"]);
    assert.deepEqual(app.played, ["data:audio/wav;base64,c3ludGhldGljLWZpcnN0", "data:audio/wav;base64,c3ludGhldGljLWxhc3Q="]);
    assert.deepEqual(app.cancelled, []);
    assert.equal(app.state.ttsPlaybackPhase, "completed");
  }],
  ["committed narration reveals one host segment at a time, preserves warnings, and settles its delivery", async () => {
    const app = createSpeechRenderer();
    const steps = [];
    app.context.renderTypewriterText = (node, text, onComplete) => {
      node.textContent = text.slice(0, 1);
      steps.push(() => { node.textContent = text; onComplete?.(); });
    };
    app.context.renderEnvelope(app.envelope([
      { type: "host", content: "第一段完整正文。" },
      { type: "warning", content: "第二项是警告。" },
      { type: "host", content: "第三段完整正文。" },
    ]));
    assert.equal(app.ui.narrationPanel.children.length, 1);
    assert.equal(app.starts.length, 1, "Automatic speech remains one whole-turn request");
    const delivery = app.state.narrationDelivery;
    assert(delivery);
    steps.shift()();
    assert.equal(app.ui.narrationPanel.children.length, 3, "The warning follows its prior host before the next host begins");
    assert.equal(app.ui.narrationPanel.children[1].className, "narration-line warning");
    assert.equal(app.ui.narrationPanel.children[2].children[0].textContent, "第");
    steps.shift()();
    assert.equal(await delivery.completion, true);
    assert.equal(app.state.narrationDelivery, null);
  }],
  ["new player input fast-forwards a committed tail, while clear cancels a pending delivery", async () => {
    const app = createSpeechRenderer();
    const steps = [];
    app.context.renderTypewriterText = (node, text, onComplete) => {
      node.textContent = text.slice(0, 1);
      steps.push(() => { node.textContent = text; onComplete?.(); });
    };
    app.context.renderEnvelope(app.envelope([
      { type: "host", content: "已提交的第一段。" },
      { type: "host", content: "已提交的尾段。" },
    ]));
    const delivery = app.state.narrationDelivery;
    app.context.appendNarration("warning", "派生提示必须在已提交正文之后。");
    assert.equal(app.ui.narrationPanel.children.length, 3);
    assert.equal(app.ui.narrationPanel.children[0].children[0].textContent, "已提交的第一段。");
    assert.equal(app.ui.narrationPanel.children[1].children[0].textContent, "已提交的尾段。");
    assert.equal(app.ui.narrationPanel.children[2].children[0].textContent, "派生提示必须在已提交正文之后。");
    assert.equal(await delivery.completion, true);
    app.state.activeSave.actionId = "another-action";
    app.context.renderEnvelope(app.envelope([{ type: "host", content: "会在清空前取消。" }], { actionId: "another-action" }));
    const cancelled = app.state.narrationDelivery;
    app.context.clearTypewriterTimers();
    assert.equal(await cancelled.completion, false);
    assert.equal(app.state.narrationDelivery, null);
  }],
  ["typewriter respects a reader scrolling away from and back to the narration tail", () => {
    const ticks = [];
    const panel = { scrollHeight: 200, clientHeight: 100, scrollTop: 100 };
    const context = vm.createContext({
      state: { typewriterTimers: new Set() }, ui: { narrationPanel: panel }, Intl,
      window: {
        matchMedia: () => ({ matches: false }),
        setInterval: (callback) => { const timer = { callback }; ticks.push(timer); return timer; },
        clearInterval: () => {},
      },
    });
    install(context, rendererSource, ["prefersReducedUiMotion", "narrationPanelNearBottom", "typewriterUnits", "renderTypewriterText"], rendererPath);
    const node = { textContent: "" };
    context.renderTypewriterText(node, "甲乙丙");
    ticks[0].callback();
    assert.equal(panel.scrollTop, 200, "Readers already at the tail follow the next grapheme");
    panel.scrollTop = 10;
    ticks[0].callback();
    assert.equal(panel.scrollTop, 10, "Scrolling upward during animation is preserved");
    panel.scrollTop = 100;
    ticks[0].callback();
    assert.equal(panel.scrollTop, 200, "Returning to the tail resumes following");
  }],
  ["opening notebook defers committed narration and whole-turn speech until the reading page is ready", async () => {
    const app = createSpeechRenderer();
    const readable = deferred();
    app.state.gameUiLayout = "story-notebook-v1";
    app.context.notebookEntryActive = true;
    app.context.notebookBookController = { getState: () => ({ phase: "opening" }), whenReadable: () => readable.promise };
    app.context.renderEnvelope(app.envelope([{ type: "host", content: "开书期间不可提前显现。" }]));
    assert.equal(app.ui.narrationPanel.children.length, 0);
    assert.equal(app.starts.length, 0);
    readable.resolve(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(app.ui.narrationPanel.children.length, 1);
    assert.equal(app.starts.length, 1, "Automatic speech starts with the readable page, once for the whole turn");

    const cancelled = createSpeechRenderer();
    const cancelledReadable = deferred();
    cancelled.state.gameUiLayout = "story-notebook-v1";
    cancelled.context.notebookEntryActive = true;
    cancelled.context.notebookBookController = { getState: () => ({ phase: "opening" }), whenReadable: () => cancelledReadable.promise };
    cancelled.context.renderEnvelope(cancelled.envelope([{ type: "host", content: "取消后不能显现。" }]));
    const delivery = cancelled.state.narrationDelivery;
    cancelled.context.clearTypewriterTimers();
    assert.equal(await delivery.completion, false);
    cancelledReadable.resolve(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancelled.ui.narrationPanel.children.length, 0);
    assert.equal(cancelled.starts.length, 0);
  }],
  ["duplicate, stale and restored story deliveries never restart automatic speech", async () => {
    const app = createSpeechRenderer();
    const segments = [{ type: "host", content: "第一段原文。" }, { type: "host", content: "最后一段原文。" }];
    const envelope = app.envelope(segments);
    app.context.renderEnvelope(envelope);
    await app.finish();
    const rows = app.ui.narrationPanel.children.length;
    app.context.renderEnvelope(envelope);
    app.context.renderEnvelope({ ...envelope, revision: 3, actionId: "older-action" });
    app.context.renderEnvelope({ ...envelope, adventureId: "another-adventure" });
    assert.equal(app.starts.length, 1);
    assert.equal(app.ui.narrationPanel.children.length, rows);

    const restored = createSpeechRenderer();
    restored.context.renderContinueHistory([{ adventureId: "a", revision: 4, actionId: "spoken-action",
      autoSpeak: false, kind: "turn", player: "查看门外。", host: "第一段原文。\n\n最后一段原文。" }]);
    assert(restored.ui.narrationPanel.children.some((line) => line.children.some((child) => child.textContent.includes("最后一段原文"))));
    restored.context.renderEnvelope(restored.envelope(segments));
    assert.equal(restored.starts.length, 0, "A restored action ID also deduplicates a late committed envelope");
    const silentReceipt = createSpeechRenderer();
    silentReceipt.context.renderEnvelope(silentReceipt.envelope(segments, { meta: { autoSpeak: false } }));
    assert.equal(silentReceipt.starts.length, 0, "Read-only delivery may display text without speaking");
  }],
  ["manual paragraph controls still read exactly one visible segment when automatic speech is off", async () => {
    const app = createSpeechRenderer();
    app.state.ttsAuto = false;
    app.context.renderEnvelope(app.envelope([
      { type: "host", content: "第一段，门还关着。" },
      { type: "host", content: '最后一段，雨停了。\n\n```json\n{"candidate_events":["not spoken"]}\n```' },
    ]));
    assert.equal(app.starts.length, 0);
    const buttons = app.ui.narrationPanel.children.map((line) => line.children.find((child) => child.className === "tts-line-button"));
    assert(buttons.every(Boolean));
    const first = buttons[0].listeners.click();
    assert.equal(app.starts[0].text, "第一段，门还关着。");
    await app.finish(0);
    await first;
    const last = buttons[1].listeners.click();
    assert.equal(app.starts[1].text, "最后一段，雨停了。");
    await app.finish(1);
    await last;
    assert.equal(app.played.length, 4);
    assert.equal(app.starts.length, 2);
  }],
  ["cancelled speech replies cannot play later or replace a newer manual read", async () => {
    const app = createSpeechRenderer();
    app.context.renderEnvelope(app.envelope([{ type: "host", content: "这一轮完整正文。" }]));
    app.context.cancelTtsPlayback();
    const button = app.ui.narrationPanel.children[0].children.find((child) => child.className === "tts-line-button");
    const manual = button.listeners.click();
    assert.equal(app.starts.length, 2);
    await app.finish(0);
    assert.deepEqual(app.played, []);
    assert.deepEqual(app.cancelled, ["utterance-0"]);
    assert.equal(app.state.ttsPlaybackPhase, "generating", "The cancelled response must not reset the new request");
    await app.finish(1);
    await manual;
    assert.equal(app.played.length, 2);
    assert.deepEqual(app.continued, ["utterance-1"]);
    assert.equal(app.state.ttsPlaybackPhase, "completed");
  }],
  ["recording focus acquired between narration segments suppresses the delayed segment and never restarts it on release", async () => {
    const app = createSpeechRenderer();
    install(app.context, rendererSource, ["acquireSpeechAudioFocus", "getTtsRuntimeStateKey"], rendererPath);
    const next = deferred();
    app.context.window.greyCrow.continueTtsUtterance = () => next.promise;
    const speaking = app.context.synthesizeAndPlayTts("完整朗读正文。", { manual: true });
    app.starts[0].resolve({ ok: true, result: { utteranceId: "waiting-between-segments", segmentIndex: 0,
      segmentCount: 2, hasMore: true, dataUrl: "data:audio/wav;base64,Zmlyc3Q=" } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.played.length, 1);
    assert.equal(app.state.currentAudio, null);
    assert.equal(app.state.ttsPlaybackPhase, "playing", "the first segment finished while the next one is still pending");
    const release = app.context.acquireSpeechAudioFocus();
    next.resolve({ ok: true, result: { utteranceId: "waiting-between-segments", segmentIndex: 1,
      segmentCount: 2, hasMore: false, dataUrl: "data:audio/wav;base64,bGF0ZQ==" } });
    await speaking;
    assert.equal(app.played.length, 1, "a delayed segment must not begin while the microphone owns audio focus");
    assert.ok(app.cancelled.includes("waiting-between-segments"));
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.played.length, 1, "releasing focus must not restart the retired utterance");
  }],
  ["whole-turn speech exceeding the existing 8000-character limit fails explicitly without losing story paragraphs", async () => {
    const app = createSpeechRenderer();
    const { createTtsService } = require("../../../../engine/tts/tts-service");
    const cacheRoot = path.join(require("node:os").tmpdir(), `grey-crow-tts-limit-no-cache-${process.pid}`);
    assert(!fs.existsSync(cacheRoot));
    let synthesisCalls = 0;
    const service = createTtsService({ cacheRoot, providers: { "kokoro-original-local": {
      async synthesize() { synthesisCalls += 1; throw new Error("Oversized speech must never reach synthesis"); },
    } } });
    let requests = 0;
    let requestText;
    app.context.formatError = (error) => error.code;
    app.context.window.greyCrow.startTtsUtterance = async (text) => {
      requests += 1;
      requestText = text;
      try {
        return { ok: true, result: await service.startUtterance({ text,
          settings: { audio: { tts: { enabled: true, provider: "kokoro-original-local" } } } }) };
      } catch (error) {
        return { ok: false, error: { code: error.code } };
      }
    };
    const first = "甲".repeat(4000);
    const last = "乙".repeat(4000);
    app.context.renderEnvelope(app.envelope([{ type: "host", content: first }, { type: "host", content: last }]));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);
    assert.equal(requestText, `${first} ${last}`, "The combined text is neither clipped nor silently split into new utterances");
    assert.equal(app.state.ttsPlaybackPhase, "error");
    assert.equal(app.ui.ttsStatus.textContent, "tts.error.textTooLong");
    assert.equal(app.ui.narrationPanel.children[0].children[0].textContent, first);
    assert.equal(app.ui.narrationPanel.children[1].children[0].textContent, last);
    assert.equal(synthesisCalls, 0);
    assert.equal(app.played.length, 0);
    assert(!fs.existsSync(cacheRoot), "Rejected text must not write an audio cache");
  }],
  ["opening notebook blocks a new turn before any session IPC", async () => {
    const app = createDerivedRenderer();
    let calls = 0;
    app.state.gameUiLayout = "story-notebook-v1";
    app.context.notebookEntryActive = true;
    app.context.notebookBookController = { getState: () => ({ phase: "opening" }) };
    app.context.window.greyCrow.runTurn = async () => { calls += 1; return app.committed; };
    await app.context.runTurn("在翻页时不应提交这一行动。");
    assert.equal(calls, 0);
    assert.equal(app.state.pendingSessionAction, null);
    assert.equal(app.state.busy, false);
  }],
  ["derived delivery waits for readable notebook and never IPCs a cancelled or revised binding", async () => {
    const configure = (app, readable) => {
      Object.assign(app.state, { gameUiLayout: "story-notebook-v1", activeSave: { id: "a", revision: 5, actionId: "new-action" } });
      app.context.notebookBookController = { whenReadable: () => readable.promise };
      app.state.renderedSessionActions.add("new-action");
      app.context.waitForNextUiPaint = async () => {};
    };
    const cancelled = createDerivedRenderer();
    const cancelledReadable = deferred(); configure(cancelled, cancelledReadable);
    const cancelledWork = cancelled.context.completeSessionDerivedWork(cancelled.ticket);
    await cancelled.flush();
    assert.equal(cancelled.derivedRequests.length, 0, "derived IPC waits for readable notebook");
    cancelledReadable.resolve(false); await cancelledWork;
    assert.equal(cancelled.derivedRequests.length, 0, "cancelled opening must not acknowledge derived work");

    const revised = createDerivedRenderer();
    const revisedReadable = deferred(); configure(revised, revisedReadable);
    const revisedWork = revised.context.completeSessionDerivedWork(revised.ticket);
    await revised.flush();
    revisedReadable.resolve(true);
    revised.state.activeSave.revision = 6;
    await revisedWork;
    assert.equal(revised.derivedRequests.length, 0, "revision changed after readability must not acknowledge derived work");
  }],
  ["derived acknowledgement waits for the committed narration delivery, but a fast-forward may release it", async () => {
    const app = createDerivedRenderer();
    Object.assign(app.state, { activeSave: { id: "a", revision: 5, actionId: "new-action" }, narrationDeliveryEpoch: 1 });
    app.state.renderedSessionActions.add("new-action");
    app.context.waitForNextUiPaint = async () => {};
    const gate = deferred();
    app.state.narrationDelivery = { actionId: "new-action", completion: gate.promise };
    const request = app.startDerived();
    const work = app.context.completeSessionDerivedWork(app.ticket);
    await app.flush();
    assert.equal(app.derivedRequests.length, 0, "The durable receipt is visible but its tail is still animating");
    app.state.narrationDelivery = null;
    gate.resolve(true);
    await app.flush();
    assert.equal(app.derivedRequests.length, 1, "Completing or fast-forwarding the committed tail permits acknowledgement");
    request.resolve(app.receipt());
    await work;
  }],
  ["stop generation waits for the original action receipt and ignores late cancellation acknowledgements", async () => {
    for (const outcome of ["cancelled", "committed", "cancel-failed", "session-replaced"]) {
      const app = createDerivedRenderer();
      app.ui.cancelTurnButton = { hidden: true, disabled: true, textContent: "" };
      app.ui.turnInput.value = "我停下来，等他回答。";
      const turn = deferred(), cancellation = deferred(), requests = [];
      app.context.window.greyCrow.runTurn = () => turn.promise;
      app.context.window.greyCrow.cancelTurn = request => { requests.push(request); return cancellation.promise; };
      const running = app.context.runTurn();
      assert.equal(app.ui.cancelTurnButton.hidden, false);
      assert.equal(app.ui.cancelTurnButton.disabled, false);
      const pending = app.state.pendingSessionAction;
      const stopping = app.context.requestSessionTurnCancellation();
      await app.context.requestSessionTurnCancellation();
      assert.equal(requests.length, 1, "Repeated clicks cannot send concurrent cancellation requests");
      assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { actionId: pending.actionId, baseRevision: 4,
        adventureId: "a", sessionId: 1, invocationId: pending.invocationId });
      assert.equal(app.ui.cancelTurnButton.disabled, true);
      const cancelled = { ok: false, status: status("a", 1, 4),
        actionResult: { status: "cancelled", error: { code: "ACTION_CANCELLED", retryable: false } } };
      if (outcome === "committed") {
        turn.resolve({ ok: true, status: status("a", 1, 5), save: { id: "a", revision: 5, actionId: pending.actionId },
          actionResult: { status: "committed", revision: 5 }, envelope: { adventureId: "a", revision: 5,
            actionId: pending.actionId, meta: { autoSpeak: false }, segments: [{ type: "host", content: "他终于开口。" }] } });
        await running;
        cancellation.resolve({ ok: false, error: { code: "ACTION_NOT_RUNNING", message: "PRIVATE_CANCEL_DETAIL" } });
        await stopping;
        assert.equal(app.state.activeSave.revision, 5);
        assert.equal(app.state.pendingSessionAction, null);
        assert.equal(app.effects.rows.filter(row => row.kind === "warning").length, 0);
        assert.equal(app.effects.rows.filter(row => row.kind === "host").length, 1);
      } else if (outcome === "session-replaced") {
        app.state.runtimeSessionId = 2;
        app.state.pendingSessionAction = null;
        app.state.busy = false;
        app.state.busyRevision += 1;
        app.context.renderSessionTurnCancel();
        cancellation.reject(new Error("PRIVATE_CANCEL_DETAIL"));
        await stopping;
        turn.resolve(cancelled);
        await running;
        assert.equal(app.state.runtimeSessionId, 2);
        assert.equal(app.state.busy, false);
        assert.equal(app.effects.rows.filter(row => row.kind === "warning").length, 0);
      } else {
        cancellation.resolve(outcome === "cancel-failed" ? { ok: false,
          error: { code: "SESSION_PROCESS_CLOSED", message: "PRIVATE_CANCEL_DETAIL" } } : { ok: true });
        await stopping;
        assert.equal(app.state.busy, true, "The acknowledgement cannot release the original request");
        assert.equal(app.state.pendingSessionAction, pending);
        assert.equal(pending.line.dataset.actionStatus, "pending");
        assert.equal(app.state.activeSave.revision, 4);
        assert.equal(app.ui.cancelTurnButton.disabled, outcome !== "cancel-failed");
        if (outcome === "cancel-failed") assert.equal(app.effects.rows.at(-1).text, "game.turn.cancelUnconfirmed");
        else assert.equal(app.effects.rows.filter(row => row.kind === "warning").length, 0);
        turn.resolve(cancelled);
        await running;
        assert.equal(app.ui.turnInput.value, "我停下来，等他回答。");
        assert.equal(app.state.pendingSessionAction, null);
        assert.equal(app.effects.rows.at(-1).text, "game.turn.failure.cancelled");
      }
      assert.equal(app.ui.cancelTurnButton.hidden, true);
      assert(!JSON.stringify(app.effects.rows.map(row => row.text)).includes("PRIVATE_CANCEL_DETAIL"));
    }
  }],
  ["late stop replies cannot change a new retry of the same player action", async () => {
    for (const lateOutcome of ["accepted", "refused", "rejected"]) {
      const app = createDerivedRenderer();
      let serial = 0;
      app.context.crypto = { randomUUID: () => `invocation-test-${++serial}` };
      app.ui.cancelTurnButton = { hidden: true, disabled: true, textContent: "" };
      app.ui.turnInput.value = "我等他把话说完。";
      const turns = [deferred(), deferred()], cancellations = [deferred(), deferred()];
      const requests = [], stopRequests = [];
      app.context.window.greyCrow.runTurn = (_input, request) => { requests.push(request); return turns[requests.length - 1].promise; };
      app.context.window.greyCrow.cancelTurn = request => { stopRequests.push(request); return cancellations[stopRequests.length - 1].promise; };
      const first = app.context.runTurn();
      const action = app.state.pendingSessionAction;
      const oldStop = app.context.requestSessionTurnCancellation();
      turns[0].resolve({ ok: false, status: status("a", 1, 4),
        actionResult: { status: "failed", error: { code: "API_TIMEOUT", retryable: true } } });
      await first;
      const warningCount = app.effects.rows.filter(row => row.kind === "warning").length;
      const second = app.context.runTurn();
      assert.equal(app.state.pendingSessionAction, action, "An explicit retry retains its durable action identity");
      assert.equal(requests[0].actionId, requests[1].actionId);
      assert.notEqual(requests[0].invocationId, requests[1].invocationId, "Each in-flight call has its own cancellation identity");
      const currentStop = app.context.requestSessionTurnCancellation();
      assert.equal(action.cancelPending, true);
      if (lateOutcome === "rejected") cancellations[0].reject(new Error("PRIVATE_LATE_CANCEL"));
      else cancellations[0].resolve({ ok: lateOutcome === "accepted" });
      await oldStop;
      assert.equal(action.cancelPending, true, "An old finally cannot clear the new pending cancellation");
      assert.equal(action.cancelRequested, false, "An old acknowledgement cannot mark the new request cancelled");
      assert.equal(app.state.busy, true);
      assert.equal(app.effects.rows.filter(row => row.kind === "warning").length, warningCount);
      assert.equal(stopRequests[0].invocationId, requests[0].invocationId);
      assert.equal(stopRequests[1].invocationId, requests[1].invocationId);
      cancellations[1].resolve({ ok: true });
      await currentStop;
      assert.equal(action.cancelRequested, true);
      assert.equal(action.cancelPending, false);
      turns[1].resolve({ ok: false, status: status("a", 1, 4), actionResult: { status: "cancelled" } });
      await second;
      assert.equal(app.ui.turnInput.value, "我等他把话说完。");
      assert.equal(app.state.busy, false);
      assert.equal(app.state.pendingSessionAction, null);
    }
  }],
  ["manual compaction permits explicit repaired-provider retries through both UI and dispatch without relaxing unknown or structural failures", async () => {
    const { PROVIDER_ERROR_CODES } = require("../../../../engine/session/session-provider-error");
    const scenarios = [
      ...PROVIDER_ERROR_CODES.flatMap(code => ["failed", "interrupted"].map(status => ({ code, status, mode: "retry" }))),
      ...["COMPACTION_PLAN_STALE", "COMPACTION_SELECTION_INVALID", "TURN_OUTPUT_INVALID", "TURN_TIMEOUT", "constructor"]
        .map(code => ({ code, status: "failed", mode: "blocked" })),
      { code: "UPSTREAM_AUTH_ERROR", status: "unknown", mode: "check" },
      { code: "UPSTREAM_AUTH_ERROR", status: "unknown", confirmed: true, mode: "blocked" },
    ];
    for (const scenario of scenarios) {
      const app = createDerivedRenderer();
      Object.assign(app.state, { busy: false, sessionContextCompactionAvailable: true,
        sessionContextSettingsIdentity: "unchanged-settings", settingsSaving: false, settingsDirty: false });
      app.ui.settingsCompactContextButton = { disabled: false, title: "" };
      app.ui.confirmCompactButton = { disabled: false, textContent: "" };
      app.ui.compactStatus = { textContent: "" };
      app.ui.turnInput.value = "我等他解释。";
      const pending = { adventureId: "a", sessionId: 1, revision: 4,
        settingsIdentity: "unchanged-settings", requestId: "same-compaction-request", input: app.ui.turnInput.value,
        status: scenario.status, error: { code: scenario.code, retryable: false },
        canRetry: Boolean(scenario.confirmed), recoveryRequired: Boolean(scenario.confirmed) };
      app.state.pendingSessionCompaction = pending;
      const calls = [], response = deferred();
      app.context.window.greyCrow.requestContextCompaction = request => { calls.push({ type: "retry", request }); return response.promise; };
      app.context.window.greyCrow.readContextCompaction = request => { calls.push({ type: "check", request }); return response.promise; };
      install(app.context, rendererSource, ["sessionCompactionFinished", "sessionCompactionIsStale",
        "sessionCompactionCanRetry", "sessionCompactionProviderFailureCanRetry", "sessionCompactionMessage",
        "renderSessionCompactionControls", "confirmSessionContextCompaction"], rendererPath);
      app.context.renderSessionCompactionControls();
      assert.equal(app.ui.confirmCompactButton.disabled, scenario.mode === "blocked", JSON.stringify(scenario));
      if (["UPSTREAM_AUTH_ERROR", "UPSTREAM_BALANCE_ERROR"].includes(scenario.code) && scenario.status === "failed") {
        assert.equal(app.context.modelFailureExplanation(scenario.code)[1], scenario.code === "UPSTREAM_AUTH_ERROR" ? "connection" : "balance",
          "Enabling an explicit retry does not replace the repair guidance with a blind retry instruction");
      }
      const attempt = app.context.confirmSessionContextCompaction();
      assert.equal(calls.length, scenario.mode === "blocked" ? 0 : 1, JSON.stringify(scenario));
      if (scenario.mode !== "blocked") {
        assert.equal(calls[0].type, scenario.mode);
        assert.equal(calls[0].request.requestId, "same-compaction-request");
        assert.equal(calls[0].request.revision, 4);
        if (scenario.mode === "retry") {
          assert.equal(calls[0].request.retry, true);
          assert.equal(calls[0].request.input, "我等他解释。");
        } else assert.equal(Object.hasOwn(calls[0].request, "retry"), false);
        assert.equal(pending.settingsIdentity, "unchanged-settings");
        response.resolve({ stale: true });
      }
      await attempt;
      assert.equal(app.ui.turnInput.value, "我等他解释。");
    }
  }],
  ["long story waits and derived model failures explain the situation in each locale", async () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
      let strings;
      new vm.Script(fs.readFileSync(path.join(__dirname, "../renderer/locales", `${locale}.js`), "utf8"))
        .runInNewContext({ GreyCrowI18n: { register(_locale, entries) { strings = entries; } } });
      const app = createDerivedRenderer();
      app.context.t = (key, values = {}) => {
        assert.equal(typeof strings[key], "string", key);
        return strings[key].replace(/\{(\w+)\}/g, (_match, name) => String(values[name]));
      };
      app.ui.turnStatus = { textContent: "", classList: { add() {}, remove() {} } };
      app.ui.storyNotebookHostStatus = { dataset: {} };
      Object.assign(app.state, { busy: true, busyStartedAt: Date.now() - 30_000,
        busyRevision: 8, turnBusyRevision: 8, busyLabel: strings["game.busy.hostProcessing"] });
      app.context.renderTurnStatus();
      assert(app.ui.turnStatus.textContent.includes(strings["game.turn.longWait"]));
      app.state.busyStartedAt = Date.now() - 90_000;
      app.context.renderTurnStatus();
      assert(app.ui.turnStatus.textContent.includes(strings["game.turn.delayed"]));
      assert.equal(app.effects.rows.length, 0, "waiting feedback stays out of the story");
      app.state.pendingSessionAction = { cancelRequested: true };
      app.context.renderTurnStatus();
      assert(app.ui.turnStatus.textContent.includes(strings["game.turn.cancelling"]));
      app.state.turnBusyRevision = null;
      app.context.renderTurnStatus();
      assert(!app.ui.turnStatus.textContent.includes(strings["game.turn.longWait"]));
      assert(!app.ui.turnStatus.textContent.includes(strings["game.turn.delayed"]));
      for (const kind of ["chapter", "compaction"]) {
        const message = app.context.formatDerivedModelFailure({ code: "UPSTREAM_AUTH_ERROR", retryable: false,
          message: "PRIVATE_UPSTREAM_DETAIL" }, kind);
        assert(message.includes(strings[kind === "chapter" ? "game.save.chapterIncomplete" : "compact.session.incomplete"]));
        assert(message.includes(strings["game.turn.failure.reason.auth"]));
        assert(message.includes(strings["game.turn.failure.next.connection"]));
        assert(!message.includes(strings[kind === "chapter" ? "game.save.chapterRetryLater" : "compact.session.retryLater"]));
        assert(!message.includes("PRIVATE_UPSTREAM_DETAIL"));
      }
      assert.equal(app.context.formatDerivedModelFailure({ code: "constructor" }, "chapter"), null);
    }
  }],
  ["player action failures use localized outcome-aware messages and keep the existing retry identity", async () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
      let strings;
      new vm.Script(fs.readFileSync(path.join(__dirname, "../renderer/locales", `${locale}.js`), "utf8"))
        .runInNewContext({ GreyCrowI18n: { register(_locale, entries) { strings = entries; } } });
      const scenarios = [
        { name: "retry", actionStatus: "failed", code: "TURN_GENERATION_FAILED", retryable: true, key: "retry" },
        { name: "unknown", actionStatus: "unknown", code: "COMMIT_OUTCOME_UNKNOWN", retryable: true, key: "unknown" },
        { name: "saved-view", actionStatus: "committed", code: "VIEW_UNAVAILABLE", key: "saved" },
        { name: "recovery", actionStatus: "failed", code: "TURN_GENERATION_FAILED", retryable: true, recovery: true, key: "reopen" },
        { name: "not-retryable", actionStatus: "failed", code: "TURN_GENERATION_FAILED", retryable: false, key: "reopen" },
        { name: "cancelled", actionStatus: "cancelled", code: "ACTION_CANCELLED", key: "cancelled", cleared: true },
        { name: "newer-state", actionStatus: "failed", code: "REVISION_CONFLICT", retryable: true, key: "changed", cleared: true },
        { name: "lost-ipc", code: "SESSION_PROCESS_CLOSED", reject: true, key: "unknown" },
        { name: "request-timeout", actionStatus: "failed", code: "API_TIMEOUT", retryable: true, reason: "timeout", next: "retry" },
        { name: "turn-timeout", actionStatus: "failed", code: "TURN_TIMEOUT", retryable: true, reason: "timeout", next: "retry" },
        { name: "repair-limit", actionStatus: "failed", code: "REPAIR_BUDGET_EXCEEDED", retryable: true, reason: "repairLimit", next: "retry" },
        { name: "model-call-limit", actionStatus: "failed", code: "MODEL_CALL_BUDGET_EXCEEDED", retryable: true, reason: "processingLimit", next: "retry" },
        { name: "tool-call-limit", actionStatus: "failed", code: "TOOL_CALL_BUDGET_EXCEEDED", retryable: true, reason: "processingLimit", next: "retry" },
        { name: "auth", actionStatus: "failed", code: "UPSTREAM_AUTH_ERROR", retryable: false, reason: "auth", next: "connection" },
        { name: "access-denied", actionStatus: "failed", ...projectProviderError({ code: "UPSTREAM_ACCESS_DENIED", retryable: true }), reason: "access", next: "connection" },
        { name: "missing-key", actionStatus: "failed", code: "MISSING_API_KEY", retryable: false, reason: "auth", next: "connection" },
        { name: "balance", actionStatus: "failed", code: "UPSTREAM_BALANCE_ERROR", retryable: false, reason: "balance", next: "balance" },
        { name: "model", actionStatus: "failed", code: "UPSTREAM_MODEL_NOT_FOUND", retryable: false, reason: "model", next: "connection" },
        { name: "rate-limit", actionStatus: "failed", code: "UPSTREAM_RATE_LIMIT", retryable: true, reason: "rateLimit", next: "retryLater" },
        { name: "network", actionStatus: "failed", code: "PROVIDER_FAILED", retryable: true, reason: "network", next: "network" },
        { name: "server", actionStatus: "failed", code: "UPSTREAM_SERVER_ERROR", retryable: true, reason: "server", next: "retryLater" },
        { name: "response", actionStatus: "failed", code: "UPSTREAM_BAD_RESPONSE", retryable: true, reason: "response", next: "retry" },
        { name: "non-retryable-response", actionStatus: "failed", code: "UPSTREAM_BAD_RESPONSE", retryable: false, reason: "response", next: "reopen" },
        { name: "configuration", actionStatus: "failed", code: "INVALID_PROVIDER_CONFIG", retryable: false, reason: "configuration", next: "connection" },
        { name: "capability", actionStatus: "failed", code: "MODEL_CAPABILITY_UNSUPPORTED", retryable: false, reason: "capability", next: "connection" },
        { name: "context", actionStatus: "failed", code: "CONTEXT_WINDOW_EXCEEDED", retryable: false, reason: "context", next: "context" },
        { name: "output", actionStatus: "failed", code: "OUTPUT_BUDGET_EXCEEDED", retryable: false, reason: "output", next: "output" },
        { name: "aborted", actionStatus: "failed", code: "REQUEST_ABORTED", retryable: true, reason: "interrupted", next: "retry" },
        { name: "saved-before-timeout", actionStatus: "committed", code: "API_TIMEOUT", retryable: true, key: "saved" },
        { name: "unknown-after-timeout", actionStatus: "unknown", code: "API_TIMEOUT", retryable: true, key: "unknown" },
        { name: "running-before-timeout", actionStatus: "running", code: "API_TIMEOUT", retryable: true, key: "wait" },
      ];
      for (const scenario of scenarios) {
        const app = createDerivedRenderer();
        app.context.getUiLocale = () => locale;
        app.context.t = (key, values = {}) => {
          assert.equal(typeof strings[key], "string", key);
          return strings[key].replace(/\{(\w+)\}/g, (_match, name) => String(values[name]));
        };
        install(app.context, rendererSource, ["formatError"], rendererPath);
        const text = "我等他说明白，再碰车。";
        app.ui.turnInput.value = text;
        const requests = [];
        app.context.window.greyCrow.runTurn = async (input, request) => {
          requests.push({ input, ...request });
          if (scenario.reject) throw Object.assign(new Error("PRIVATE_BACKEND_DETAIL"), { code: scenario.code });
          return { ok: false, status: { ...status("a", 1, 4), sessionRecoveryRequired: Boolean(scenario.recovery) },
            actionResult: { status: scenario.actionStatus, error: { code: scenario.code, retryable: scenario.retryable } },
            envelope: { error: { code: scenario.code, message: "PRIVATE_BACKEND_DETAIL" } } };
        };
        await app.context.runTurn();
        const warnings = app.effects.rows.filter(row => row.kind === "warning");
        assert.equal(warnings.length, 1);
        assert.equal(app.state.turnFailureNotice?.line, warnings[0].line, "fixed notice points to the failure details");
        assert.doesNotMatch(warnings[0].text, /TURN_GENERATION_FAILED|COMMIT_OUTCOME_UNKNOWN|VIEW_UNAVAILABLE|REVISION_CONFLICT|SESSION_PROCESS_CLOSED|ACTION_CANCELLED|PRIVATE_BACKEND_DETAIL/);
        assert(!warnings[0].text.includes(scenario.code));
        assert.equal(warnings[0].text, scenario.reason ? app.context.t("game.turn.failure.details", {
          reason: strings[`game.turn.failure.reason.${scenario.reason}`],
          next: app.context.t(`game.turn.failure.next.${scenario.next}`, { action: strings["game.notebook.continueStory"] }),
        }) : app.context.t(`game.turn.failure.${scenario.key}`, { action: strings["game.notebook.continueStory"] }));
        assert.equal(app.ui.turnInput.value, text);
        assert.equal(app.state.activeSave.revision, 4);
        assert.equal(app.state.pendingSessionAction === null, Boolean(scenario.cleared));
        assert.equal(app.starts.length, 0);
        // Diagnostic formatting still exposes the internal code in its own UI.
        assert.match(app.context.formatError({ code: scenario.code }, "diagnostic"), new RegExp(`\\[${scenario.code}\\]`));
        if (scenario.name === "retry") {
          app.context.window.greyCrow.runTurn = async (input, request) => {
            requests.push({ input, ...request });
            return { ok: true, status: status("a", 1, 5), save: { id: "a", revision: 5, actionId: request.actionId },
              actionResult: { status: "committed", revision: 5 },
              envelope: { adventureId: "a", revision: 5, actionId: request.actionId,
                meta: { autoSpeak: false }, segments: [{ type: "host", content: "他继续说明，你仍未动手。" }] } };
          };
          await app.context.runTurn();
          assert.equal(requests.length, 2); assert.equal(requests[0].retry, false); assert.equal(requests[1].retry, true);
          assert.equal(requests[0].actionId, requests[1].actionId); assert.equal(requests[0].baseRevision, requests[1].baseRevision);
          assert.equal(app.state.pendingSessionAction, null); assert.equal(app.ui.turnInput.value, "");
          assert.equal(app.state.turnFailureNotice, null, "an explicit retry clears the former fixed failure notice");
          assert.equal(app.state.activeSave.revision, 5);
          assert.equal(app.effects.rows.filter(row => row.kind === "player").length, 1);
          assert.equal(app.effects.rows.filter(row => row.kind === "host").length, 1);
        }
      }
    }
  }],
  ["Main keeps newer state while an older action receipt still settles the Renderer pending input", async () => {
    for (const mode of ["committed", "failed", "unreadable-committed", "recovered-committed"]) {
      const committed = mode !== "failed";
      const unreadable = mode.endsWith("-committed");
      const main = createDerivedMain();
      main.context.activeSaveSummary = { id: "a", revision: 6, actionId: "action-6" };
      const renderer = createDerivedRenderer();
      Object.assign(renderer.state, { runtimeSessionId: "s1", activeSave: main.context.activeSaveSummary });
      const text = "我先前已提交的行动。";
      const line = renderer.context.appendNarration("player", text);
      renderer.state.pendingSessionAction = { adventureId: "a", sessionId: "s1", actionId: "action-5",
        baseRevision: 4, text, line };
      renderer.ui.turnInput.value = text;
      const receipt = { actionId: "action-5", attemptId: "attempt-5", status: committed ? "committed" : "failed",
        generationPasses: 0, modelCalls: 0, ...(committed ? { revision: 5 } : { error: { code: "REVISION_CONFLICT", retryable: true } }),
        ...(unreadable ? { error: { code: "VIEW_UNAVAILABLE" } } : {}) };
      const revision = committed ? 5 : 4;
      const oldProjection = { adventureId: "a", revision, save: { id: "a", revision, actionId: "action-5" } };
      main.bridge.runTurn = async () => ({ actionResult: receipt,
        adventureId: "a", revision, actionId: "action-5", segments: [{ content: "旧正文不可再次交付。" }],
        projection: unreadable ? null : oldProjection,
        contextUsage: { adventureId: "a", revision, contextGeneration: 0 },
        ...(receipt.error ? { error: receipt.error } : {}) });
      main.bridge.readView = async () => {
        if (mode !== "recovered-committed") throw Object.assign(new Error("unavailable view"), { code: "VIEW_UNAVAILABLE" });
        return { ...oldProjection, envelope: { adventureId: "a", revision, segments: [] } };
      };
      let result;
      renderer.context.window.greyCrow.runTurn = async (input, payload) => {
        result = await main.context.runSessionDesktopTurn(payload, input);
        return result;
      };
      await renderer.context.runTurn();
      assert.equal(main.context.activeSaveSummary.revision, 6, "Old receipt must not regress Main before Renderer rejects it");
      assert.equal(renderer.state.activeSave.revision, 6);
      assert.equal(result.ok, committed);
      assert.notEqual(result.stale, true, "The caller must consume the durable receipt and settle its pending input");
      assert.deepEqual(JSON.parse(JSON.stringify(result.actionResult)), receipt);
      assert.equal(result.projection, null);
      assert.equal(result.derivedWork, null);
      assert.equal(result.envelope, undefined);
      assert.equal(result.contextUsage, undefined);
      assert.equal(result.storyFinale, undefined);
      assert.equal(result.save.revision, 6);
      assert.equal(result.status.activeSave.revision, 6);
      assert.equal(renderer.state.pendingSessionAction, null);
      assert.equal(line.dataset.actionStatus, committed ? "committed" : "failed");
      assert.equal(renderer.ui.turnInput.value, committed ? "" : text);
      if (!committed) assert.deepEqual(result.error, receipt.error);
      else assert.equal(result.error, undefined, "An unavailable old view does not turn its committed action into failure");
      assert.equal(renderer.effects.rows.filter((row) => row.kind === "host").length, 0);
      assert.equal(renderer.starts.length, 0);
      assert.equal(main.context.turnDerivedTickets.size, 0);
    }
  }],
  ["Main preserves current-version duplicate recovery and ordinary progression without reopening a sealed finale", async () => {
    for (const mode of ["duplicate", "next", "sealed"]) {
      const app = createDerivedMain();
      const current = { id: "a", revision: 6, actionId: "action-6",
        ...(mode === "sealed" ? { compatibility: { status: "closed" } } : {}) };
      app.context.activeSaveSummary = current;
      const revision = mode === "next" ? 7 : 6;
      const receipt = { actionId: `action-${revision}`, revision, status: "committed",
        generationPasses: mode === "next" ? 1 : 0, modelCalls: mode === "next" ? 1 : 0 };
      const projection = { adventureId: "a", revision,
        save: { id: "a", revision, actionId: receipt.actionId, compatibility: { status: "ready" } } };
      app.bridge.runTurn = async () => ({ actionResult: receipt, projection,
        adventureId: "a", revision, actionId: receipt.actionId,
        segments: [{ content: "该版本的完整正文。" }], meta: { autoSpeak: mode === "next" },
        derivedWork: { actionId: receipt.actionId, revision, kind: "chapter", trigger: "interval" } });
      const result = await app.context.runSessionDesktopTurn({ actionId: receipt.actionId,
        baseRevision: revision - 1, adventureId: "a", sessionId: "s1" }, "我继续。 ");
      assert.equal(result.ok, true);
      assert.deepEqual(JSON.parse(JSON.stringify(result.actionResult)), receipt);
      assert.equal(app.context.activeSaveSummary.revision, revision);
      if (mode === "sealed") {
        assert.equal(app.context.activeSaveSummary, current);
        assert.equal(result.save.compatibility.status, "closed");
        assert.equal(result.projection, null);
        assert.equal(result.envelope, undefined);
      } else {
        assert.equal(result.projection, projection);
        assert.equal(result.envelope.segments[0].content, "该版本的完整正文。");
        assert.equal(result.envelope.meta.autoSpeak, mode === "next");
      }
      assert.equal(app.context.turnDerivedTickets.size, mode === "next" ? 1 : 0);
      assert.equal(app.calls.length, 0);
    }
  }],
  ["Main delivers the committed turn before derived work and consumes its ticket exactly once", async () => {
    const app = createDerivedMain();
    const done = deferred();
    let derivedCalls = 0;
    const receipt = { actionId: "action-5", revision: 5, status: "committed", generationPasses: 1, modelCalls: 1 };
    app.bridge.runTurn = async () => ({ actionResult: receipt,
      adventureId: "a", revision: 5, actionId: "action-5", segments: [{ content: "正文已经保存。" }],
      projection: { adventureId: "a", revision: 5, save: { id: "a", revision: 5, actionId: "action-5" } },
      derivedWork: { kind: "chapter", revision: 5, actionId: "action-5", trigger: "interval" } });
    app.bridge.completeTurnDerived = async (request) => { derivedCalls += 1; await done.promise;
      return { adventureId: "a", revision: request.revision, actionId: request.actionId, kind: request.kind,
        chapterSummary: { revision: request.revision, chapterStatus: "created", modelCalls: 1 } }; };
    const delivered = await app.context.runSessionDesktopTurn({ actionId: "action-5", baseRevision: 4,
      adventureId: "a", sessionId: "s1" }, "我把事情说完，站在门边。 ");
    assert.equal(delivered.ok, true);
    assert.equal(delivered.save.revision, 5);
    assert.equal(delivered.envelope.segments[0].content, "正文已经保存。");
    assert.equal(derivedCalls, 0, "The first IPC is already resolved before any derived model task starts");
    assert.equal(delivered.envelope.derivedWork, undefined);
    const ticket = delivered.derivedWork;
    assert(ticket.ticketId);
    assert.equal((await app.context.completeSessionTurnDerived({ ...ticket, sessionId: "wrong" })).stale, true);
    const finishing = app.context.completeSessionTurnDerived(ticket);
    await Promise.resolve();
    assert.equal(derivedCalls, 1);
    assert.equal((await app.context.completeSessionTurnDerived(ticket)).stale, true);
    receipt.generationPasses = 0;
    const duplicate = await app.context.runSessionDesktopTurn({ actionId: "action-5", baseRevision: 4,
      adventureId: "a", sessionId: "s1" }, "我把事情说完，站在门边。 ");
    assert.equal(duplicate.derivedWork, null);
    app.bridge.runTurn = async () => ({ actionResult: { actionId: "action-6", revision: 6, status: "committed", generationPasses: 1 },
      projection: { adventureId: "a", revision: 6, save: { id: "a", revision: 6, actionId: "action-6" } }, segments: [{ content: "新的行动。" }] });
    const next = await app.context.runSessionDesktopTurn({ actionId: "action-6", baseRevision: 5,
      adventureId: "a", sessionId: "s1" }, "我继续向前走。");
    assert.equal(next.ok, true, "A new story action is not blocked by the earlier chapter");
    assert.equal(next.save.revision, 6);
    done.resolve();
    const late = await finishing;
    assert.equal(late.stale, true);
    assert.equal(late.save, undefined);
    assert.equal(late.status, undefined);
    assert.equal(late.projection, null);
    assert.equal(app.context.activeSaveSummary.revision, 6);
    assert.equal(derivedCalls, 1);
  }],
  ["Main serializes derived jobs and quiescence cancels queued work without touching the story", async () => {
    const app = createDerivedMain();
    const started = deferred();
    let calls = 0;
    app.bridge.completeTurnDerived = async (request, { signal }) => {
      calls += 1; started.resolve();
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return { adventureId: "a", revision: request.revision, actionId: request.actionId, kind: request.kind,
        chapterSummary: { chapterStatus: "interrupted", modelCalls: 1 } };
    };
    const first = app.context.completeSessionTurnDerived(app.ticket());
    await started.promise;
    app.context.activeSaveSummary = { id: "a", revision: 5, actionId: "action-5" };
    const second = app.context.completeSessionTurnDerived(app.ticket(5, "finale"));
    assert.equal(calls, 1);
    const stopped = await app.context.quiesceAdventureWrites("test_leave");
    assert.equal(stopped.settled, true);
    assert.equal((await first).stale, true);
    assert.equal((await second).stale, true);
    assert.equal(calls, 1, "The cancelled queued finale must never invoke a model");
    assert.equal(app.context.activeSaveSummary.revision, 5);
    assert.equal(app.context.runtimeOperations.pendingCount(), 0);
    assert.equal(app.context.turnDerivedTickets.size, 0);
  }],
  ["Main seals same-version finale separately and derived errors cannot undo committed state", async () => {
    const app = createDerivedMain();
    app.bridge.completeTurnDerived = async () => { throw Object.assign(new Error("chapter only"), { code: "CHAPTER_INTERRUPTED" }); };
    const failed = await app.context.completeSessionTurnDerived(app.ticket(4, "finale"));
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, "CHAPTER_INTERRUPTED");
    assert.equal(app.context.activeSaveSummary.revision, 4);
    assert.equal(app.context.runtimeOperations.pendingCount(), 0);
    app.bridge.completeTurnDerived = async () => ({ adventureId: "a", actionId: "action-4", revision: 4, kind: "finale",
      projection: { adventureId: "a", revision: 4, save: { id: "a", revision: 4, compatibility: { status: "closed" } } },
      finalization: { status: "closed", chapterWork: { mode: "excerpt", fallbackReason: "CHAPTER_OUTPUT_BUDGET_EXCEEDED" } } });
    const sealed = await app.context.completeSessionTurnDerived(app.ticket(4, "finale"));
    assert.equal(sealed.ok, true);
    assert.equal(sealed.save.compatibility.status, "closed");
    assert.equal(sealed.finalization.chapterWork.mode, "excerpt");
    assert.equal(sealed.autoSpeak, false);
    assert.deepEqual(app.calls, ["close"]);
  }],
  ["committed story paints before derived IPC and completion never replays narration or speech", async () => {
    const app = createDerivedRenderer();
    app.committed.storyFinale.projection.engineNotice = "old recovery instruction";
    const chapter = app.startDerived();
    await app.context.runTurn("我关好门，把杯子放下，就在这里结束这一段故事。");
    assert.equal(app.state.activeSave.revision, 5);
    assert.equal(app.state.pendingSessionAction, null);
    assert.equal(app.state.busy, false);
    assert.equal(app.effects.rows.filter((row) => row.kind === "host").length, 1);
    assert.equal(app.effects.speech, 1);
    assert.equal(app.derivedRequests.length, 0, "Acknowledgement waits for the story's paint");
    assert.equal(app.ui.storyResumeFinaleButton.disabled, true);
    assert.equal(app.context.isStoryInputLocked(), true);
    assert.equal(app.context.getStoryFinalePhase(), "finalizing");
    assert.equal(app.state.storyFinale.projection.phase, "recovery_required", "The pending label does not rewrite saved phase");
    assert.equal(app.ui.storyArchiveNotice.textContent, "archive.finalizing.notice");
    app.paint();
    await app.flush();
    assert.equal(app.derivedRequests.length, 1);
    await app.context.completeSessionDerivedWork(app.ticket);
    assert.equal(app.derivedRequests.length, 1, "Repeated delivery cannot start another derived request");
    app.ui.turnInput.value = "尚未提交的新草稿";
    chapter.resolve({ ...app.receipt(app.ticket, "closed"), envelope: app.committed.envelope,
      chapterSummary: { revision: 5, chapterStatus: "created", mode: "excerpt" } });
    await app.flush();
    assert.equal(app.context.getStoryFinalePhase(), "closed");
    assert.equal(app.effects.rows.filter((row) => row.kind === "host").length, 1);
    assert.equal(app.effects.speech, 1);
    assert.equal(app.effects.rows.filter((row) => row.text === "game.save.autoChapterExcerpt").length, 1);
    assert.equal(app.ui.turnInput.value, "尚未提交的新草稿");
    assert.equal(app.context.isSessionDerivedBusy(), false);
    await app.context.completeSessionDerivedWork(app.ticket);
    assert.equal(app.derivedRequests.length, 1, "A consumed ticket remains deduplicated");
    app.context.applyStatus({ ...status("a", 1, 6), activeSave: { id: "a", revision: 6, actionId: "later" } });
    assert.equal(app.state.sessionDerivedWork.size, 0, "Older completed tickets do not accumulate during long play");
  }],
  ["derived failure preserves the committed action and a newer action's busy state and draft", async () => {
    const app = createDerivedRenderer();
    app.ticket.kind = "chapter";
    app.committed.storyFinale.projection.phase = "playing";
    const chapter = app.startDerived();
    await app.context.runTurn("我把杯子放下。");
    assert.equal(app.context.isStoryInputLocked(), false);
    app.paint();
    await app.flush();
    const newer = { actionId: "next-action", text: "新的行动" };
    app.state.pendingSessionAction = newer;
    app.state.busy = true;
    app.state.busyRevision = 41;
    app.ui.turnInput.value = "玩家正在修改的新草稿";
    chapter.reject(new Error("private chapter failure"));
    await app.flush();
    assert.equal(app.state.activeSave.revision, 5);
    assert.equal(app.state.pendingSessionAction, newer);
    assert.equal(app.state.busy, true);
    assert.equal(app.state.busyRevision, 41);
    assert.equal(app.ui.turnInput.value, "玩家正在修改的新草稿");
    assert.equal(app.effects.rows[0].line.dataset.actionStatus, "committed");
    assert.equal(app.effects.rows.filter((row) => row.kind === "host").length, 1);
    assert.equal(app.effects.rows.at(-1).text, "game.save.autoChapterIncomplete");
    assert.equal(app.effects.rows.at(-1).options.autoSpeak, false);
    assert(!JSON.stringify(app.effects.rows).includes("private chapter failure"));
  }],
  ["late derived replies cannot roll back a newer version or release replacement-session work", async () => {
    for (const switchSession of [false, true]) {
      const app = createDerivedRenderer();
      const chapter = app.startDerived();
      await app.context.runTurn("我把杯子放下。");
      app.paint();
      await app.flush();
      const nextTicket = { ...app.ticket, ticketId: "ticket-b", actionId: "next-action", kind: "chapter",
        adventureId: switchSession ? "b" : "a", sessionId: switchSession ? 2 : 1, revision: switchSession ? 2 : 6 };
      const nextReceipt = app.receipt(nextTicket, "playing");
      app.context.applyStatus(nextReceipt.status);
      app.context.applyStoryFinaleResult(nextReceipt.storyFinale);
      app.state.renderedSessionActions.add(nextTicket.actionId);
      const nextChapter = app.startDerived();
      const nextFinished = app.context.completeSessionDerivedWork(nextTicket);
      await app.flush();
      assert.equal(app.derivedRequests.length, 2);
      const rows = app.effects.rows.length;
      app.ui.turnInput.value = "当前会话的新草稿";
      chapter.resolve({ ...app.receipt(app.ticket, "closed"), chapterSummary: { revision: 5, chapterStatus: "failed" } });
      await app.flush();
      assert.equal(app.effects.rows.length, rows);
      assert.equal(app.state.activeSave.revision, nextTicket.revision);
      assert.equal(app.state.activeSaveId, nextTicket.adventureId);
      assert.equal(app.state.runtimeSessionId, nextTicket.sessionId);
      assert.equal(app.ui.turnInput.value, "当前会话的新草稿");
      assert.equal(app.context.isSessionDerivedBusy(), true);
      nextChapter.resolve({ ...nextReceipt, stale: true });
      await nextFinished;
      assert.equal(app.context.isSessionDerivedBusy(), false);
    }
  }],
  ["terminal recovery delivers committed narration before its derived finalization", async () => {
    const app = createDerivedRenderer();
    app.state.storyFinale = { adventureId: "a", revision: 4,
      projection: { phase: "recovery_required", actions: { resumeFinalization: true } } };
    app.committed.terminalAction = { adventureId: "a", actionId: "new-action", baseRevision: 4, input: "我确认。" };
    app.context.window.greyCrow.resumeSessionFinale = async () => app.committed;
    const chapter = app.startDerived();
    await app.context.resumeSessionFinale();
    assert.equal(app.state.activeSave.revision, 5);
    assert.equal(app.state.pendingSessionAction, null);
    assert.equal(app.state.busy, false);
    assert.equal(app.effects.rows.filter((row) => row.kind === "host").length, 1);
    assert.equal(app.effects.rows.filter((row) => row.kind === "warning").length, 0);
    assert.equal(app.context.isSessionDerivedBusy(), true);
    app.paint();
    await app.flush();
    assert.equal(app.derivedRequests.length, 1);
    chapter.resolve({ ...app.receipt(app.ticket, "recovery_required"), ok: false });
    await app.flush();
    assert.equal(app.effects.rows.at(-1).text, "archive.resumeFailed");
    assert.equal(app.effects.speech, 1);
    assert.equal(app.ui.storyResumeFinaleButton.disabled, false);
  }],
  ["preload derived acknowledgement forwards only the issued ticket identity", async () => {
    let api;
    const calls = [];
    const listeners = new Map();
    const window = { addEventListener: (type, callback) => listeners.set(type, callback) };
    const context = vm.createContext({ window, require: (name) => {
      assert.equal(name, "electron");
      return { contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); return { ok: true }; } } };
    } });
    new vm.Script(fs.readFileSync(path.join(__dirname, "../preload.js"), "utf8")).runInContext(context);
    const ticket = { ticketId: "issued", actionId: "action", revision: 3, kind: "chapter", adventureId: "a", sessionId: "session" };
    await api.completeTurnDerived({ ...ticket, text: "must not become another action", retry: true });
    assert.equal(calls[0][0], "grey-crow:complete-turn-derived");
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), ticket);
    listeners.get("error")({ target: window, message: "sk-private", filename: "/Users/player/private.js", error: { stack: "private-story" } });
    listeners.get("unhandledrejection")({ reason: "private-player-input" });
    assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(1))), [
      ["grey-crow:record-renderer-problem", { code: "RENDERER_SCRIPT_ERROR" }],
      ["grey-crow:record-renderer-problem", { code: "RENDERER_PROMISE_ERROR" }],
    ]);
  }],
  ["startup catalog then saved settings keeps the persisted model despite an older dropdown value", () => {
    for (const model of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"]) {
      const select = () => ({ value: "", children: [],
        set innerHTML(value) { assert.equal(value, ""); this.children = []; }, appendChild(node) { this.children.push(node); } });
      const ui = { providerPresetSelect: select(), modelPresetSelect: select() };
      const state = { provider: "deepseek", model: "deepseek-v4-flash", ttsPlaybackPhase: "idle" };
      const context = vm.createContext({ ui, state, speechInputController: null,
        document: { createElement: () => ({}) }, t: (key) => key,
        getSelectedCustomConnection: () => null, getTtsRuntimeStateKey: () => "unchanged",
        normalizeUiTextSize: (value) => value, normalizeWindowMode: (value) => value,
        normalizeGameUiLayout: (value) => value, normalizeTtsCacheUtteranceLimit: (value) => value,
        collectSettingsFromState: () => ({ api: { provider: state.provider, model: state.model } }),
        serializeSettingsSnapshot: JSON.stringify });
      for (const name of ["renderModelHelp", "renderNarrationSettings", "renderAgentContextSettings", "renderUiDisplaySettings",
        "renderSaveSettings", "renderTtsProviderOptions", "renderLoadedSkillSlots"]) context[name] = () => {};
      install(context, rendererSource, ["applySettingsCatalog", "applySettings", "renderProviderOptions", "localizeProviderLabel",
        "localizeModelLabel", "getConnectionDraft", "renderModelOptions", "replaceSelectOptions", "formatModelStatusText"], rendererPath);
      context.applySettingsCatalog(getSettingsCatalog());
      assert.equal(ui.modelPresetSelect.value, "deepseek-v4-flash", "Catalog arrives before saved settings at startup");
      context.applySettings(normalizeDesktopSettings({ api: { provider: "deepseek", model } }));
      state.keyVerified = true;
      context.renderProviderOptions();
      context.renderModelOptions();
      assert.equal(state.model, model);
      assert.equal(ui.modelPresetSelect.value, model);
      assert.equal(context.formatModelStatusText(), `DeepSeek / ${model}`);
      ui.modelPresetSelect.value = "deepseek-v4-pro";
      state.model = ui.modelPresetSelect.value;
      context.renderModelOptions();
      assert.equal(state.model, "deepseek-v4-pro", "An explicit dropdown change remains selected when rendered again");
    }
    const custom = createCustomConnection({ name: "Test connection", baseUrl: "https://example.com/v1", modelId: "vendor/test-model" });
    const customSelect = { value: "deepseek-v4-flash", children: [],
      set innerHTML(value) { assert.equal(value, ""); this.children = []; }, appendChild(node) { this.children.push(node); } };
    const customState = { settingsCatalog: getSettingsCatalog(), provider: CUSTOM_PROVIDER_ID, model: custom.modelId };
    const customContext = vm.createContext({ state: customState,
      ui: { providerPresetSelect: { value: CUSTOM_PROVIDER_ID }, modelPresetSelect: customSelect },
      document: { createElement: () => ({}) }, getSelectedCustomConnection: () => custom, t: (key) => key });
    install(customContext, rendererSource, ["localizeModelLabel", "getConnectionDraft", "renderModelOptions", "replaceSelectOptions"], rendererPath);
    customContext.renderModelOptions();
    assert.equal(customSelect.value, custom.modelId);
    assert.equal(customState.model, custom.modelId);
  }],
  ["Main model test candidates and restored provider credentials retain the selected model and custom identity", () => {
    const context = vm.createContext({ getSettingsCatalog, normalizeDesktopSettings, mergeDesktopSettings,
      CUSTOM_PROVIDER_ID, CUSTOM_CONTEXT_WINDOW_DEFAULT, getCustomConnection, createConnectionFingerprint });
    install(context, mainSource, ["resolveProviderTestCandidate", "getCredentialIdentity"], mainPath);
    const previous = normalizeDesktopSettings({ api: { provider: "deepseek", model: "deepseek-v4-flash" } });
    for (const model of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"]) {
      const candidate = context.resolveProviderTestCandidate(previous, { provider: "deepseek", model });
      assert.equal(candidate.settings.api.model, model);
      assert.equal(candidate.connection, null);
      const identity = context.getCredentialIdentity(candidate.settings);
      assert.deepEqual(JSON.parse(JSON.stringify(identity)), { provider: "deepseek", model });
      const status = createDesktopStatus({ settings: candidate.settings, keyVerified: true,
        credentialStatus: { credentialId: "provider:deepseek", provider: "deepseek", model: "deepseek-v4-flash", hasVerifiedCredential: true } });
      assert.equal(status.model, model);
      assert.equal(status.credential.model, model);
      assert.equal(status.keyVerified, true);
    }
    assert.throws(() => context.resolveProviderTestCandidate(previous, { model: "unlisted-model" }),
      error => error.code === "INVALID_PROVIDER_CONFIG");
    const custom = createCustomConnection({ name: "Test connection", baseUrl: "https://example.com/v1", modelId: "vendor/test-model" });
    const customSettings = normalizeDesktopSettings({ api: { provider: CUSTOM_PROVIDER_ID,
      connectionId: custom.id, customConnections: [custom] } });
    const candidate = context.resolveProviderTestCandidate(customSettings, { provider: CUSTOM_PROVIDER_ID,
      connectionId: custom.id, model: "deepseek-flash" });
    assert.equal(candidate.settings.api.model, custom.modelId);
    assert.equal(candidate.connection.id, custom.id);
    assert.deepEqual(JSON.parse(JSON.stringify(context.getCredentialIdentity(candidate.settings))),
      { provider: CUSTOM_PROVIDER_ID, connectionId: custom.id, fingerprint: createConnectionFingerprint(custom) });
    assert.throws(() => context.resolveProviderTestCandidate(customSettings, { provider: CUSTOM_PROVIDER_ID, connectionId: "missing" }),
      (error) => error.code === "CUSTOM_CONNECTION_NOT_FOUND");
    let bridgeSettings;
    const restoredSettings = normalizeDesktopSettings({ api: { provider: "deepseek", model: "deepseek-flash" } });
    Object.assign(context, { loadDesktopSettings: () => restoredSettings, getDataRoot: () => "/synthetic/no-io",
      getCredentialStore: () => ({ isVerified: (identity) => identity.provider === "deepseek", getSecret: () => "synthetic-key" }),
      createBridge: (_secret, _root, settings) => { bridgeSettings = settings; return { model: settings.api.model }; } });
    install(context, mainSource, ["createBridgeFromStoredCredential", "restoreStoredCredentialSession"], mainPath);
    assert.equal(context.restoreStoredCredentialSession(), true);
    assert.equal(bridgeSettings.api.model, "deepseek-flash");
    assert.equal(context.activeBridge.model, "deepseek-flash");
    assert.equal(context.keyVerified, true);
  }],
  ["model labels show the current Flash default, retain the legacy alias, and localize Pro", () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
      let strings;
      const language = vm.createContext({ GreyCrowI18n: { register(_locale, entries) { strings = entries; } } });
      new vm.Script(fs.readFileSync(path.join(__dirname, "../renderer/locales", `${locale}.js`), "utf8")).runInContext(language);
      const select = { value: "deepseek-flash", children: [],
        set innerHTML(value) { assert.equal(value, ""); this.children = []; },
        appendChild(node) { this.children.push(node); } };
      const ui = { providerPresetSelect: { value: "deepseek" }, modelPresetSelect: select };
      const state = { settingsCatalog: getSettingsCatalog(), provider: "deepseek", model: "deepseek-flash" };
      const context = vm.createContext({ ui, state, document: { createElement: () => ({}) },
        getSelectedCustomConnection: () => null,
        t: (key, { model } = {}) => { assert.equal(typeof strings[key], "string", key); return strings[key].replace("{model}", model); } });
      install(context, rendererSource, ["localizeModelLabel", "getConnectionDraft", "renderModelOptions", "replaceSelectOptions"], rendererPath);
      context.renderModelOptions();
      const labels = Object.fromEntries(select.children.map((option) => [option.value, option.textContent]));
      assert.equal(labels["deepseek-flash"], strings["settings.model.model.default"].replace("{model}", "deepseek-flash"));
      assert.equal(labels["deepseek-v4-flash"], strings["settings.model.model.alias"].replace("{model}", "deepseek-v4-flash"));
      assert.equal(labels["deepseek-v4-pro"], strings["settings.model.model.advanced"].replace("{model}", "deepseek-v4-pro"));
      assert.equal(select.value, "deepseek-flash");
      assert.equal(state.model, "deepseek-flash");
      assert.equal(state.settingsCatalog.api.providers[0].models.find((model) => model.id === "deepseek-flash").status, "experimental");
    }
  }],
  ["native character condition preserves qualifications and line breaks through projection, header and state drawer", () => {
    for (const [language, value] of [
      ["zh-CN", "\n双臂酸痛（原因尚不明确）。\n没有可见出血，感染尚未证实。\n"],
      ["en-US", "\nChilled (possibly from wet clothes), but infection is (not) confirmed.\nNo visible bleeding; mild fatigue.\n"],
      ["ja-JP", "\n両腕に痛みがある（原因はまだ不明）。\n目に見える出血はない。感染は確認されていない。\n"],
    ]) {
      const view = projectedStateHint(language, { status: value, localizedStatus: { [language]: "Obsolete state" } });
      const before = JSON.stringify(view);
      for (const delivery of ["commit", "recovery"]) {
        const projected = projectSessionView(view, { delivery, displayLocale: language });
        const app = createStateHintRenderer(language);
        app.context.renderStateHint(projected.state_hint);
        assert.equal(app.value().textContent, value);
        assert.equal(app.drawerValue(), value);
        assert.equal(app.value().children.length, 0);
        app.context.renderStateHint({ ...projected.state_hint, revision: 3, player: { status: "Stale replacement" } });
        assert.equal(app.value().textContent, value, "An older hint cannot replace the bound original");
      }
      assert.equal(JSON.stringify(view), before, "Display does not rewrite saved attributes");
    }
  }],
  ["native status still redacts secrets and missing status keeps localized and label fallbacks", () => {
    const app = createStateHintRenderer("en-US");
    const value = "Chilled (possibly from wet clothes), (not) a confirmed infection.\nBearer synthetic-token-123 <em>not proof</em>";
    const expected = "Chilled (possibly from wet clothes), (not) a confirmed infection.\nBearer [redacted] <em>not proof</em>";
    const view = projectedStateHint("en-US", { status: value });
    app.context.renderStateHint(projectSessionView(view).state_hint);
    assert.equal(app.value().textContent, expected);
    assert.equal(app.drawerValue(), expected);
    assert.equal(app.value().children.length, 0);
    for (const language of ["zh-CN", "en-US", "ja-JP"]) {
      const fallback = { "zh-CN": "疲惫", "en-US": "Tired", "ja-JP": "疲れている" };
      const source = projectedStateHint(language, { localizedStatus: fallback });
      const renderer = createStateHintRenderer(language);
      renderer.context.renderStateHint(projectSessionView(source, { displayLocale: language }).state_hint);
      assert.equal(renderer.value().textContent, fallback[language]);
      assert.equal(renderer.drawerValue(), fallback[language]);
      assert.equal(renderer.context.formatPlayerStatusDisplay({ status: "old-code", status_label: fallback[language] }, language), fallback[language]);
      assert.equal(renderer.context.formatPlayerStatusDisplay({ status: "old-code", localized_status: fallback }, language), fallback[language]);
    }
  }],
  ["character condition details use readable lists without truncation or changing aliases and author previews", () => {
    const values = Array.from({ length: 32 }, (_, index) => {
      const start = `${index + 1}:🙂`, end = "（未确诊，并非已经恢复）";
      return start + "症".repeat(120 - start.length - end.length) + end;
    });
    const before = initialState();
    before.entities.p.aliases = ["阿默"];
    const description = "这只是当时的转述，仍未确认。".repeat(40) + "她没有承诺同行。";
    before.entities.p.attributes.description = description;
    const narration = values.map((text, index) => ({ id: `body-${index}`, text }));
    const events = values.map((text, index) => ({ id: `condition-${index}`, type: "condition.add", sourceSegmentIds: [`body-${index}`],
      data: { characterId: "p", basis: "self_report", text, evidence: [{ segmentId: `body-${index}`, quote: text }] } }));
    const applied = applyTurnBundle(before, { narration, events, experiences: [] }, { adventureId: "status-adventure", baseRevision: 3 });
    for (const language of ["zh-CN", "en-US", "ja-JP"]) {
      const view = { ...projectedStateHint(language, {}), state: applied.state, narration };
      const list = projectSessionPanel(view, { panelRef: "session_characters", view: "list", fieldId: "characters", displayLocale: language });
      const player = list.panel.items.find(item => item.title === "玩家");
      const detail = projectSessionPanel(view, { panelRef: "session_characters", view: "detail", fieldId: "characters", itemRef: player.ref, displayLocale: language });
      const sourceFields = detail.panel.detail.sections.flatMap(section => section.fields);
      const sourceStatus = sourceFields.find(field => field.id === "status");
      assert.equal(sourceStatus.kind, "chips");
      const unchanged = JSON.stringify(detail);
      const app = createStateHintRenderer(language);
      const createElement = app.context.document.createElement;
      app.context.document.createElement = (tag) => {
        const node = createElement(tag);
        node.replaceChildren = (...children) => { node.children = children; };
        node.tagName = tag.toUpperCase();
        if (tag === "details") node.open = false;
        return node;
      };
      app.ui.storyNotebookDrawerRefreshButton = { disabled: false };
      app.context.appendStoryNotebookPanelError = () => {};
      app.context.skillModuleWidgetLabel = widget => widget;
      install(app.context, rendererSource, ["renderStoryNotebookPanelRecordDetail", "renderStoryNotebookPanelFields",
        "storyNotebookPanelFieldAsModuleField", "renderSkillModuleField", "renderSkillModuleStringList", "formatSkillModuleValue",
        "isNativeStoryNotebookDetail", "isLongStoryNotebookDetailText", "createStoryNotebookDetailText",
        "storyNotebookDetailReadingBinding"], rendererPath);
      const mapped = app.context.storyNotebookPanelFieldAsModuleField(sourceStatus, { panelRef: "session_characters" });
      assert.equal(mapped.type, "string_list"); assert.equal(mapped.widget, "list");
      assert.strictEqual(mapped.value, sourceStatus.value);
      app.context.renderStoryNotebookPanelRecordDetail({}, detail.panel);
      const descendants = node => [node, ...node.children.flatMap(descendants)];
      const nodes = descendants(app.ui.storyNotebookDrawerBody);
      const longField = nodes.find(node => node.dataset.detailReadingKey === "field:identity:description");
      assert.equal(longField.tagName, "DETAILS");
      assert.equal(longField.open, false);
      assert.equal(longField.children[0].tagName, "SUMMARY");
      assert.equal(longField.children[1].textContent, description, "a long in-contract field retains its complete qualifier behind a native disclosure");
      const cards = nodes.filter(node => node.className === "skill-module-field");
      const cardFor = id => cards.find(node => node.children[0].children[0].textContent === sourceFields.find(field => field.id === id).label);
      const statusList = cardFor("status").children[1];
      assert.equal(statusList.className, "skill-module-records");
      assert.equal(statusList.children.length, 32);
      assert(statusList.children.every(node => node.className === "skill-module-value"));
      assert.deepEqual(statusList.children.map(node => node.textContent), sourceStatus.value);
      const aliases = cardFor("aliases").children[1];
      assert.equal(aliases.className, "skill-module-chips");
      assert.equal(aliases.children[0].className, "skill-module-chip");
      for (const options of [{}, { panelRef: "custom-panel" }]) {
        const container = app.context.document.createElement("div");
        app.context.renderStoryNotebookPanelFields([sourceStatus], container, options);
        const originalList = container.children[0].children[1];
        assert.equal(originalList.className, "skill-module-chips", "Author previews and unrelated modules keep their requested chips");
        assert.deepEqual(originalList.children.map(node => node.textContent), sourceStatus.value);
      }
      assert.equal(JSON.stringify(detail), unchanged, "Rendering must not rewrite projected conditions");
    }
  }],
  ["busy Main creation guards preserve confirmations and never create or propose deleting a save", async () => {
    for (const name of ["GET_NEW_GAME_CATALOG", "PREPARE_NEW_GAME", "CONFIRM_NEW_GAME_CREATION", "REQUEST_NEW_GAME_RESTART"]) {
      const app = createBusyMain();
      const result = await app.handlers[name]({}, { saveId: "busy-a", confirmationToken: "keep-this" });
      assert.equal(result.error?.code, "STORE_BUSY", name);
      assert.equal(result.error.retryable, true);
      assert.equal(result.ok, false);
      for (const key of ["takes", "creates", "confirmations", "clears", "opens"]) assert.equal(app.effects[key], 0, `${name}/${key}`);
      assert.doesNotMatch(result.error.message, /删除|不完整|可直接|private/);
    }
    const app = createBusyMain();
    app.context.selected = null;
    await assert.rejects(app.context.resolveExistingSaveForNewGameRestart(), { code: "STORE_BUSY", retryable: true });
    app.context.activeSaveId = "busy-a";
    app.context.selected = busySave();
    await assert.rejects(app.context.resolveExistingSaveForNewGameRestart(), { code: "STORE_BUSY", retryable: true });
    // A second inspection can become busy after selection succeeded.
    app.context.selected = { id: "busy-a", compatibility: { playerContinuable: true } };
    const raced = await app.handlers.REQUEST_NEW_GAME_RESTART({}, { saveId: "busy-a" });
    assert.equal(raced.error.code, "STORE_BUSY");
    assert.equal(app.effects.confirmations, 0);
    assert.equal(app.effects.clears, 0);
    app.context.saves = [];
    assert.equal(await app.context.hasActiveAdventure(), false);
    app.context.saves = [{ id: "ready", compatibility: { playerContinuable: true } }];
    assert.equal(await app.context.hasActiveAdventure(), true);
    app.context.saves.push(busySave());
    await assert.rejects(app.context.hasActiveAdventure(), { code: "STORE_BUSY", retryable: true });
  }],
  ["busy Main continue is retryable before provider or incomplete checks, including a later lock race", async () => {
    const app = createBusyMain();
    app.context.keyVerified = false;
    app.context.activeBridge = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await app.handlers.CONTINUE_GAME({}, { saveId: "busy-a" });
      assert.equal(result.error.code, "STORE_BUSY");
      assert.equal(result.error.retryable, true);
      assert.doesNotMatch(result.error.message, /不完整|删除|private/);
    }
    assert.equal(app.effects.inspections, 2);
    assert.equal(app.effects.opens, 0);
    app.context.inspected = { schemaKind: "session", playerContinuable: true, status: "ready" };
    assert.equal((await app.handlers.CONTINUE_GAME({}, { saveId: "busy-a" })).error.code, "PROVIDER_NOT_READY");
    assert.equal(app.effects.opens, 0);
    app.context.keyVerified = true;
    app.context.activeBridge = {};
    const raced = await app.handlers.CONTINUE_GAME({}, { saveId: "busy-a" });
    assert.equal(raced.error.code, "STORE_BUSY");
    assert.equal(raced.error.retryable, true);
    assert.doesNotMatch(raced.error.message, /private/);
    assert.equal(app.effects.opens, 1);
  }],
  ["busy menu and save row stay retryable with localized messages and no fabricated state", async () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
      let strings;
      const language = vm.createContext({ GreyCrowI18n: { register(_locale, entries) { strings = entries; } } });
      new vm.Script(fs.readFileSync(path.join(__dirname, "../renderer/locales", `${locale}.js`), "utf8")).runInContext(language);
      const element = () => ({ children: [], dataset: {}, classList: { toggle() {} },
        append(...nodes) { this.children.push(...nodes); }, appendChild(node) { this.children.push(node); },
        addEventListener(name, fn) { this[name] = fn; } });
      const ui = new Proxy({}, { get(target, key) { return target[key] ||= element(); } });
      const state = { saves: [busySave()], activeSave: null, activeSaveId: null, keyVerified: false };
      const calls = [];
      const context = vm.createContext({ ui, state, document: { createElement: element },
        t: (key) => { assert.equal(typeof strings[key], "string", key); return strings[key]; },
        getUiLocale: () => locale,
        window: { greyCrow: { continueGame: async (saveId) => { calls.push(saveId);
          return { ok: false, error: { code: "STORE_BUSY", message: "wrong-language-or-private", retryable: true } }; } } },
        openSettings: () => assert.fail("Busy retry must inspect before requiring a provider"),
        formatLocationDisplay: () => assert.fail("Busy metadata must not invent a location"),
        resolveSaveDisplayTurn: () => assert.fail("Busy metadata must not invent a turn"),
      });
      for (const name of ["syncUiLocale", "renderGameUiLayout", "renderProviderOptions", "renderTtsProviderOptions",
        "renderCustomConnectionSettings", "renderModelOptions", "renderAgentContextSettings", "renderStoryNotebookMetadata",
        "renderSettingsStatus", "renderSettingsPersistenceWarning", "renderCredentialSettings", "renderNarrationSettings",
        "renderUiDisplaySettings", "renderSaveSettings", "renderAudioSettings", "renderDeveloperSettings", "renderMaintenanceState",
        "renderTurnInputState", "renderContextUsage", "renderOperationStatus", "renderLoadedSkillSlots"]) context[name] = () => {};
      install(context, rendererSource, ["getCurrentAdventure", "getActiveAdventure", "getAdventureCompatibility", "isUnsupportedSave",
        "getConnectionDraft", "formatMenuMessage", "formatError", "formatModelStatusText", "renderSaveList", "renderShellState", "continueGame",
        "refreshSaves", "requestNewGameRestart"], rendererPath);
      context.renderShellState();
      assert.equal(ui.menuMessage.textContent, strings["save.busy.notice"]);
      assert.equal(ui.continueGameButton.disabled, false);
      assert.equal(ui.continueGameButton.title, strings["save.busy.notice"]);
      assert.equal(ui.newGameButton.title, strings["save.busy.notice"]);
      const row = ui.saveList.children[0];
      assert.equal(row.dataset.saveId, "busy-a");
      assert.equal(row.children[1].textContent, strings["save.busy.notice"]);
      assert(row.children[0].textContent.startsWith(strings["save.busy.title"]));
      await row.click();
      await row.click();
      assert.deepEqual(calls, ["busy-a", "busy-a"]);
      assert.equal(ui.menuMessage.textContent, `[STORE_BUSY] ${strings["save.busy.notice"]}`);
      assert.equal(state.saves[0].revision, null);
      assert.equal(state.saves[0].compatibility.playerContinuable, false);
      const cachedReady = { id: "busy-a", revision: 7, state_hint: { player: { status: "仍在楼道" } },
        compatibility: { status: "ready", playerContinuable: true } };
      const committed = JSON.stringify(cachedReady);
      state.activeSave = cachedReady;
      state.activeSaveId = cachedReady.id;
      state.keyVerified = true;
      context.setBusy = () => {};
      context.window.greyCrow.requestNewGameRestart = async () => ({ ok: false, error: { code: "STORE_BUSY", retryable: true } });
      context.window.greyCrow.listSaveSlots = async () => ({ ok: true, saves: [busySave()] });
      await context.requestNewGameRestart(cachedReady);
      assert.equal(ui.menuMessage.textContent, strings["save.busy.notice"], "Refresh must not overwrite busy with cached ready");
      assert.equal(ui.newGameButton.title, strings["save.busy.notice"]);
      assert.equal(state.pendingNewGameRestart, undefined);
      assert.equal(context.getCurrentAdventure().revision, null);
      assert.equal(state.activeSave, cachedReady);
      assert.equal(JSON.stringify(state.activeSave), committed, "Menu inspection cannot replace committed state or revision");
      // Releasing the lock supplies a fresh ready inspection. Only the menu
      // changes back; the committed session remains the same object and version.
      context.window.greyCrow.listSaveSlots = async () => ({ ok: true, saves: [{ ...cachedReady }] });
      await context.refreshSaves();
      context.formatLocationDisplay = () => "楼道";
      context.resolveSaveDisplayTurn = () => 7;
      context.formatSaveDate = () => "";
      context.renderShellState();
      assert.equal(ui.menuMessage.textContent, strings["menu.message.continue"]);
      assert.equal(ui.continueGameButton.title, "");
      assert.equal(JSON.stringify(state.activeSave), committed);
      assert.equal(calls.length, 2, "Inspecting or rendering availability cannot start a session");
      state.keyVerified = false;
      state.saves[0].compatibility = { status: "ready", playerContinuable: true };
      let settingsOpened = 0;
      context.openSettings = () => { settingsOpened += 1; };
      await context.continueGame("busy-a");
      assert.equal(settingsOpened, 1);
      assert.equal(calls.length, 2, "Normal unconnected continuation cannot make an IPC request");
    }
  }],
  ["late failure from another view cannot replace current diagnostics or change its controls", async () => {
    const app = createRenderer();
    const old = app.startRead();
    app.context.applyStatus(status("b", 2, 0));
    const current = app.startRead();
    const loading = app.snapshot();
    old.reject(new Error("old-view-failed"));
    await old.finished;
    assert.equal(app.snapshot(), loading);
    assert.equal(app.ui.debugRefreshButton.disabled, true);
    current.resolve(diagnosticResult("b-current"));
    await current.finished;
    assert.equal(app.effects.debugEntries[0].id, "b-current");
    assert.equal(app.state.debugTraceExport.content, "diagnostic-b-current");
    assert.equal(app.ui.debugRefreshButton.disabled, false);
  }],
  ["same-view close and reopen gives only the newest request ownership", async () => {
    const app = createRenderer();
    const old = app.startRead();
    app.ui.debugDialog.open = false;
    app.state.debugTraceExport = null;
    app.ui.debugDialog.open = true;
    const current = app.startRead();
    current.resolve(diagnosticResult("new-dialog"));
    await current.finished;
    const snapshot = app.snapshot();
    old.resolve(diagnosticResult("old-dialog"));
    await old.finished;
    assert.equal(app.snapshot(), snapshot);
    assert.equal(app.state.debugTraceExport.content, "diagnostic-new-dialog");
  }],
  ["closed dialog ignores late failure including catch and finally effects", async () => {
    const app = createRenderer();
    const request = app.startRead();
    app.ui.debugDialog.open = false;
    const snapshot = app.snapshot();
    request.reject(new Error("closed-dialog-failed"));
    await request.finished;
    assert.equal(app.snapshot(), snapshot);
  }],
  ["disabled diagnostics ignore late success", async () => {
    const app = createRenderer();
    const request = app.startRead();
    app.state.debugPanelEnabled = false;
    const snapshot = app.snapshot();
    request.resolve(diagnosticResult("disabled"));
    await request.finished;
    assert.equal(app.snapshot(), snapshot);
  }],
  ["pending recovery preserves identity and input, deduplicates rows, and rejects wrong bindings", () => {
    const app = createRenderer();
    const action = pending();
    app.context.renderPendingPlayerAction(action);
    assert.equal(app.ui.turnInput.value, action.input);
    assert.equal(app.state.pendingSessionAction.actionId, action.actionId);
    assert.equal(app.state.pendingSessionAction.baseRevision, 4);
    assert.equal(app.state.pendingSessionAction.sessionId, 1);
    assert.equal(app.effects.rows.length, 1);
    assert.equal(app.effects.rows[0].kind, "player", "Recovery must not produce host narration or speech");
    app.ui.turnInput.value = "玩家后来写的新草稿";
    app.context.renderPendingPlayerAction(action);
    assert.equal(app.effects.rows.length, 1);
    assert.equal(app.ui.turnInput.value, "玩家后来写的新草稿");
    for (const invalid of [{ adventureId: "other" }, { baseRevision: 3 }, { status: "cancelled" }, { status: "committed" }]) {
      app.context.renderPendingPlayerAction(pending({ actionId: "wrong", ...invalid }));
    }
    app.effects.locked = true;
    app.context.renderPendingPlayerAction(pending({ actionId: "locked" }));
    assert.equal(app.effects.rows.length, 1);
    assert.equal(app.state.pendingSessionAction.actionId, action.actionId);
  }],
  ["adventure switch clears the former draft and restores the selected pending action", () => {
    const app = createRenderer();
    app.ui.turnInput.value = "A 冒险尚未提交的草稿";
    assert.equal(app.context.applyStatus(status("b", 2, 2)), true);
    assert.equal(app.ui.turnInput.value, "");
    const action = pending({ adventureId: "b", actionId: "pending-b", baseRevision: 2, input: "B 冒险的待重试输入" });
    app.context.renderPendingPlayerAction(action);
    assert.equal(app.ui.turnInput.value, action.input);
    assert.equal(app.state.pendingSessionAction.actionId, "pending-b");
    assert.equal(app.effects.rows.length, 1);
  }],
  ["same-adventure runtime replacement keeps a newer draft and rebinds pending identity", () => {
    const app = createRenderer();
    app.context.renderPendingPlayerAction(pending());
    app.ui.turnInput.value = "设置切换期间的新草稿";
    assert.equal(app.context.applyStatus(status("a", 2, 4)), true);
    assert.equal(app.ui.turnInput.value, "设置切换期间的新草稿");
    app.context.renderPendingPlayerAction(pending());
    assert.equal(app.ui.turnInput.value, "设置切换期间的新草稿");
    assert.equal(app.state.pendingSessionAction.actionId, "pending-a");
    assert.equal(app.state.pendingSessionAction.sessionId, 2);
  }],
  ["retired-session and older-revision statuses cannot clear the current draft", () => {
    const app = createRenderer();
    app.context.applyStatus(status("b", 2, 2));
    app.ui.turnInput.value = "B 的当前草稿";
    assert.equal(app.context.applyStatus(status("a", 1, 4)), false);
    assert.equal(app.context.applyStatus(status("b", 2, 1)), false);
    assert.equal(app.ui.turnInput.value, "B 的当前草稿");
    assert.equal(app.state.activeSaveId, "b");
    assert.equal(app.state.runtimeSessionId, 2);
    assert.equal(app.state.activeSave.revision, 2);
  }],
  ["execution records render independently of action entries and remain available after filtering in three languages", () => {
    for (const language of ["zh-CN", "en-US", "ja-JP"]) {
      const element = (tagName = "div") => ({ tagName, children: [], ownText: "", className: "", open: false, listeners: {}, attrs: {},
        append(...nodes) { this.children.push(...nodes); }, appendChild(node) { this.children.push(node); },
        setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(key, fn) { this.listeners[key] = fn; },
        get options() { return this.children; },
        get textContent() { return this.ownText + this.children.map(node => node.textContent).join(""); },
        set textContent(value) { this.ownText = value; this.children = []; },
        set innerHTML(value) { assert.equal(value, "", "diagnostic values must never become HTML"); this.children = []; },
      });
      let strings;
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../renderer/locales/${language}.js`), "utf8"),
        { GreyCrowI18n: { register: (_locale, value) => { strings = value; } } });
      const ui = { debugTraceList: element() };
      const state = { debugTraceFilter: "all", debugTraceEntries: [{ kind: "session_action" }], debugTraceSummary: null };
      const context = vm.createContext({ ui, state, document: { createElement: element },
        t: (key, params = {}) => (strings[key] || key).replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? "")),
        formatDebugTraceOverview: () => "", buildDebugTraceFilterOptions: () => [{ value: "all", label: "All" }, { value: "errors", label: "Errors" }],
        filterDebugTraceEntries: () => [],
      });
      install(context, rendererSource, ["renderDebugTraceEntries", "renderDebugTraceExecution"], rendererPath);
      const record = { phase: "story_generation", actionId: "action-a", attemptId: "attempt-a", status: "failed", incomplete: true,
        steps: [{ kind: "model", outcome: "returned", usage: null, usageComplete: false }] };
      state.debugTraceExecution = { format: "session-execution-1", available: true, retainedAttempts: 2, returnedAttempts: 2,
        historyComplete: false, truncated: true, records: [record, { ...record, phase: "another_phase", attemptId: "hidden-phase" }] };
      const saved = JSON.stringify(state.debugTraceExecution);
      const descend = node => [node, ...node.children.flatMap(descend)];
      const cards = () => descend(ui.debugTraceList).filter(node => node.className.includes("debug-execution-card"));
      context.renderDebugTraceEntries([], null, state.debugTraceExecution);
      assert.equal(cards().length, 1, "execution is independent of an empty action page and ignores unknown phases");
      assert.equal(cards()[0].open, false);
      const json = descend(cards()[0]).find(node => node.tagName === "pre");
      assert.deepEqual(JSON.parse(json.textContent), record);
      assert.equal(JSON.parse(json.textContent).steps[0].usage, null);
      assert.equal(ui.debugTraceList.textContent.includes("debug.execution."), false, "all new developer copy is localized");
      context.renderDebugTraceEntries(state.debugTraceEntries, null, state.debugTraceExecution);
      const select = descend(ui.debugTraceList).find(node => node.tagName === "select");
      select.value = "errors"; select.listeners.change();
      assert.equal(state.debugTraceFilter, "errors"); assert.equal(cards().length, 1);
      assert.equal(JSON.stringify(state.debugTraceExecution), saved);
    }
  }],
  ["execution fingerprints and numeric cache usage survive Main projection and exported JSON", () => {
    const helperPath = path.join(__dirname, "../../../../engine/session/session-execution.js");
    const context = vm.createContext({ require: require("node:module").createRequire(helperPath), module: { exports: {} }, Buffer, redactSecrets,
      EXECUTION_ACTION_CODES: require("../../../../engine/session/session-execution-store").EXECUTION_ACTION_CODES,
      DEBUG_TRACE_EXPORT_ENTRY_LIMIT: 200, activeSaveId: "adventure-a",
      summarizeDebugTraceEntries: createDebugTraceSummary, app: { getVersion: () => "test", isPackaged: false }, process });
    new vm.Script(fs.readFileSync(helperPath, "utf8"), { filename: helperPath }).runInContext(context);
    install(context, mainSource, ["projectDebugExecution", "projectDebugTraceResult", "projectDebugTraceEntry",
      "projectDebugTraceScope", "projectDebugTraceSelection", "createDebugTraceSummary", "createDebugTraceExport",
      "createDebugTraceBuildInfo", "normalizeDebugTraceIdentifier", "normalizeDebugTraceNumber",
      "sanitizeDebugTraceValue", "stripSensitiveDebugKeys", "isForbiddenDebugTraceKey"], mainPath);
    new vm.Script(`
      const journal = createSessionExecution({ adventureId: "adventure-a", actionId: "action-a", attemptId: "attempt-a", baseRevision: 0 });
      journal.record("model", "invoked", { callIndex: 1, request: {
        sha256: "a".repeat(64), settingsIdentity: "b".repeat(64), characters: 120, bytes: 150,
        estimatedInputTokens: 30, safetyInputTokens: 40, contextGeneration: 0, maxOutputTokens: 100 } });
      journal.record("model", "returned", { callIndex: 1, durationMs: 10, finishReason: "stop", usageComplete: true,
        usage: { input_tokens: 20, output_tokens: 0, prompt_cache_hit_tokens: 15, prompt_cache_miss_tokens: 5 } });
      globalThis.executionSample = { available: true, format: EXECUTION_FORMAT, retainedAttempts: 1,
        returnedAttempts: 1, historyComplete: true, truncated: false, records: [{ ...journal.read(),
          status: "committed", committedRevision: 1, endedAt: "2026-09-11T00:00:00.000Z", incomplete: false,
          raw: "PRIVATE_RAW_RESPONSE", apiKey: "PRIVATE_KEY" }] };
    `).runInContext(context);
    const result = context.projectDebugTraceResult({ ok: true, save_id: "adventure-a", entries: [], execution: context.executionSample });
    assert.equal(result.execution.records.length, 1);
    const record = result.execution.records[0];
    assert.equal(record.steps[0].request.sha256, "a".repeat(64));
    assert.equal(record.steps[0].request.settingsIdentity, "b".repeat(64));
    assert.equal(record.steps[1].usage.prompt_cache_hit_tokens, 15);
    assert.equal(record.steps[1].usage.output_tokens, 0);
    assert.equal(result.execution.historyComplete, false);
    const exported = JSON.parse(context.createDebugTraceExport(result).content);
    assert.equal(exported.execution.records.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(exported.execution)), JSON.parse(JSON.stringify(result.execution)));
    assert.doesNotMatch(JSON.stringify(exported), /PRIVATE_|hex-redacted/);
    new vm.Script(`
      globalThis.getterReads = 0;
      Object.defineProperty(executionSample.records[0], "steps", { get() { getterReads++; return []; } });
    `).runInContext(context);
    const invalid = context.projectDebugExecution(context.executionSample);
    assert.equal(invalid.records.length, 0); assert.equal(invalid.truncated, true);
    assert.equal(context.getterReads, 0);
  }],
  ["native Main projection redacts private fields and summary retains unknown measurements", () => {
    const context = vm.createContext({ redactSecrets });
    install(context, mainSource, ["projectDebugTraceEntry", "normalizeDebugTraceIdentifier",
      "sanitizeDebugTraceValue", "stripSensitiveDebugKeys", "isForbiddenDebugTraceKey"], mainPath);
    const projected = context.projectDebugTraceEntry({ schema_version: "grey-crow-session-diagnostics-v1",
      record_id: "action-1", request_id: "action-1", error_code: "TURN_GENERATION_FAILED",
      prompt: "private-prompt-777", input: "private-input-777", session_action: {
        actionId: "action-1", status: "interrupted", baseRevision: 4, committedRevision: null,
        createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:01.000Z",
        attemptId: "attempt-1", input: "private-input-777", narration: "private-story-777",
        path: "/private/private-777", apiKey: "sk-private-777", modelUsage: { inputTokens: 99 } } });
    assert.equal(projected.kind, "session_action");
    assert.equal(projected.session_action.status, "interrupted");
    assert.equal(projected.session_action.baseRevision, 4);
    assert.equal(projected.session_action.committedRevision, null);
    assert.equal(projected.session_action.modelUsage, null);
    assert.equal(projected.session_action.attemptHistoryComplete, false);
    assert.equal(projected.session_action.attemptId, "attempt-1");
    assert.equal(projected.error_code, "TURN_GENERATION_FAILED");
    assert(!JSON.stringify(projected).includes("private"));
    const summary = createDebugTraceSummary([projected]);
    assert.equal(summary.summary_schema_version, "grey-crow-session-summary-v1");
    assert.equal(summary.scope, "selected_actions");
    assert.equal(summary.statuses.interrupted, 1);
    assert.equal(summary.failed_turn_count, 1);
    assert.equal(summary.model_usage, null);
    assert.equal(summary.tool_error_count, null);
    assert.equal(summary.write_attempt_count, null);
    assert.equal(summary.attempt_history_complete, false);
  }],
  ["pending TTS play survives pause and repeated resume/pause, while a real play failure still propagates", async () => {
    const app = createTtsPlaybackRenderer();
    const completion = app.context.playTtsAudio("data:audio/wav;base64,pending");
    const audio = app.audios[0];
    assert.equal(app.state.currentAudio, audio);
    assert.equal(audio.playRequests.length, 1);

    app.context.toggleTtsPlayback();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(app.state.currentAudio, audio, "pausing an initial pending play keeps its media element");
    assert.equal(app.state.ttsPlaybackPhase, "paused");

    app.context.toggleTtsPlayback();
    assert.equal(app.state.ttsPlaybackPhase, "playing", "a pending resume remains pausable");
    assert.equal(audio.playRequests.length, 2);
    app.context.toggleTtsPlayback();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(app.state.currentAudio, audio, "a second intentional abort keeps the same media element");
    assert.equal(app.state.ttsPlaybackPhase, "paused");

    app.context.toggleTtsPlayback();
    assert.equal(audio.playRequests.length, 3);
    audio.playRequests[2].resolve();
    await Promise.resolve(); await Promise.resolve();
    audio.emit("ended");
    assert.equal(app.state.currentAudio, null);
    await completion;

    const failed = createTtsPlaybackRenderer();
    const failedCompletion = failed.context.playTtsAudio("data:audio/wav;base64,broken");
    failed.audios[0].playRequests[0].reject(new Error("decoder unavailable"));
    await assert.rejects(failedCompletion, /decoder unavailable/);
    assert.equal(failed.state.currentAudio, null, "a genuine media failure is not mistaken for an intentional pause");

    const pausedFailure = createTtsPlaybackRenderer();
    const pausedFailureCompletion = pausedFailure.context.playTtsAudio("data:audio/wav;base64,broken-after-pause");
    pausedFailure.audios[0]._greyCrowPauseRevision += 1;
    pausedFailure.audios[0].paused = true;
    pausedFailure.audios[0].playRequests[0].reject(new Error("device unavailable after pause"));
    await assert.rejects(pausedFailureCompletion, /device unavailable after pause/);
    assert.equal(pausedFailure.state.currentAudio, null, "a non-AbortError after a pause is still reported");
  }],
  ["speech capture focus pauses pending TTS and a later focus keeps a pending resume muted", async () => {
    const app = createTtsPlaybackRenderer();
    app.context.playTtsAudio("data:audio/wav;base64,pending-focus");
    const audio = app.audios[0];
    const releaseFirstFocus = app.context.acquireSpeechAudioFocus();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(app.context.speechAudioFocus, true);
    assert.equal(app.state.currentAudio, audio);
    assert.equal(app.state.ttsPlaybackPhase, "paused");

    releaseFirstFocus();
    assert.equal(app.context.speechAudioFocus, false);
    assert.equal(app.state.ttsPlaybackPhase, "playing", "releasing focus begins a protected pending resume");
    assert.equal(audio.playRequests.length, 2);

    app.context.acquireSpeechAudioFocus();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(app.context.speechAudioFocus, true);
    assert.equal(app.state.currentAudio, audio);
    assert.equal(app.state.ttsPlaybackPhase, "paused", "a later recording focus cannot be overwritten by the prior resume");
  }],
];

async function main() {
  const filter = process.argv.find(argument => argument.startsWith("--filter="))?.slice("--filter=".length);
  const selected = filter ? checks.filter(([name]) => name.includes(filter)) : checks;
  assert(selected.length, `No renderer checks match ${filter}`);
  for (const [name, check] of selected) {
    await check();
    console.log(`PASS ${name}`);
  }
  console.log(`Session renderer boundaries: ${selected.length}/${selected.length} checks passed (VM, synthetic DOM/IPC; no Electron or Provider).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
