"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { readContentSnapshot: defaultReadContentSnapshot } = require("../content-v2/snapshot-reader");
const { createSkillLocaleResolver } = require("../content-v2/skill-locale-resolver");
const { createSessionProcess: defaultCreateSessionProcess, _sessionWire } = require("../session/session-process");
const { createOpeningState } = require("../session/session-opening");
const { projectSessionView, projectSessionPanel, projectSessionHistory, projectSessionChapters,
  resolveSessionMemoryFragmentSkill, projectMemoryFragmentModule } = require("../session/session-projection");

const FORMAT = "grey-crow-session-1";
const BUDGET_KEYS = new Set(["maxAttempts", "timeoutMs", "maxModelCalls", "maxToolCalls", "maxContextCharacters", "maxOutputTokens", "maxChapterModelCalls", "maxCompactionModelCalls",
  "narrationPreferences", "contextPolicy"]);
const LEGACY_MARKERS = ["save-schema.json", "state.json", "meta.json", "memory.jsonl", "world.json", "generated-files.json",
  "summary.json", "lineage.json", "transcript", "audit", "memory", "chapters", "index", "modules", "finale"];
const START_TEXT = { "zh-CN": "开始新冒险", "en-US": "Begin a new Adventure.", "ja-JP": "新しい物語を始める。" };

function failure(code) { const error = new Error(code); error.code = code; return error; }
function identifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)) throw failure("SESSION_PAYLOAD_INVALID");
  return value;
}
function saveId(request) { return identifier(request?.save_id); }
function selected(input, keys) {
  return Object.fromEntries(keys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}
function finalizationReceipt(value) {
  // The internal result includes the narrator's private candidate reasoning.
  // Desktop receives progress and accounting; storyFinale owns its public view.
  const receipt = selected(value, ["status", "error"]);
  if (value.chapterWork) receipt.chapterWork = { ...selected(value.chapterWork,
    ["saved", "savedRevision", "chapterStatus", "error", "modelCalls", "usage", "usageComplete"]),
    ...selected(value.chapterWork.chapter || {}, ["mode", "fallbackReason"]) };
  return receipt;
}
function derivedRequest(value) {
  const keys = ["save_id", "kind", "actionId", "revision", "trigger"];
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw failure("SESSION_PAYLOAD_INVALID");
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!keys.includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw failure("SESSION_PAYLOAD_INVALID");
    result[key] = descriptor.value;
  }
  identifier(result.save_id); identifier(result.actionId);
  if (!Number.isSafeInteger(result.revision) || result.revision < 1
    || (result.kind === "finale" ? result.trigger !== "finale"
      : result.kind !== "chapter" || !["interval", "compaction", "interval+compaction"].includes(result.trigger))) throw failure("SESSION_PAYLOAD_INVALID");
  return result;
}
async function statIfPresent(target) {
  try { return await fs.lstat(target); }
  catch (error) { if (error.code === "ENOENT") return null; throw failure("SAVE_PATH_INVALID"); }
}
function heading(body, fallback) { return /^#\s+(.+)$/m.exec(body || "")?.[1]?.trim() || fallback; }

function normalizeSaveSettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => key !== "chapterLog")) throw failure("SAVE_SETTINGS_INVALID");
  const source = value.chapterLog ?? {};
  const defaults = { onManualSave: true, onAutoSave: true, onCompaction: true, intervalTurns: 60 };
  if (!source || typeof source !== "object" || Array.isArray(source)
    || Object.keys(source).some((key) => !Object.hasOwn(defaults, key))) throw failure("SAVE_SETTINGS_INVALID");
  const chapterLog = { ...defaults, ...source };
  if (["onManualSave", "onAutoSave", "onCompaction"].some((key) => typeof chapterLog[key] !== "boolean")
    || !Number.isSafeInteger(chapterLog.intervalTurns) || chapterLog.intervalTurns < 20 || chapterLog.intervalTurns > 300) {
    throw failure("SAVE_SETTINGS_INVALID");
  }
  return Object.freeze(chapterLog);
}

/** The desktop boundary owns process lifetime, never a second gameplay store. */
function createSessionDesktopBridge(config = {}) {
  if (typeof config.adventuresRoot !== "string" || !path.isAbsolute(config.adventuresRoot)
    || typeof config.provider?.generate !== "function") throw failure("SESSION_OPTIONS_INVALID");
  const adventuresRoot = path.resolve(config.adventuresRoot);
  const readContentSnapshot = config.readContentSnapshot || defaultReadContentSnapshot;
  const createSessionProcess = config.createSessionProcess || defaultCreateSessionProcess;
  const sessionOptions = config.sessionOptions || {};
  if (typeof readContentSnapshot !== "function" || typeof createSessionProcess !== "function"
    || !sessionOptions || typeof sessionOptions !== "object" || Array.isArray(sessionOptions)
    || Object.keys(sessionOptions).some((key) => !BUDGET_KEYS.has(key))
    || (config.displayLocale !== undefined && typeof config.displayLocale !== "string" && typeof config.displayLocale !== "function")) {
    throw failure("SESSION_OPTIONS_INVALID");
  }
  // Copy and validate settings once. Identity, content and the opening draft cannot
  // be overridden by a caller or a later mutation of their options object.
  const budgets = _sessionWire.sessionOptionsCopy(sessionOptions);
  let saveSettings = normalizeSaveSettings(config.saveSettings);
  const sessions = new Map();
  const closingSaves = new Map();
  const recoveryOwners = new Map();
  let closed = false;
  let closePromise;

  function requireOpen(id) {
    if (closed || closingSaves.has(id)) throw failure("SESSION_PROCESS_CLOSED");
  }

  async function inspectFiles(id) {
    const adventureRoot = path.join(adventuresRoot, id);
    for (const directory of [adventuresRoot, adventureRoot]) {
      const stat = await statIfPresent(directory);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) {
        throw failure("SAVE_PATH_INVALID");
      }
    }
    const legacy = await Promise.all(LEGACY_MARKERS.map((name) => statIfPresent(path.join(adventureRoot, name))));
    if (legacy.some(Boolean)) throw failure("SAVE_FORMAT_UNSUPPORTED");
    const databasePath = path.join(adventureRoot, "session.sqlite");
    const database = await statIfPresent(databasePath);
    if (database && (!database.isFile() || database.isSymbolicLink() || database.nlink !== 1)) throw failure("SAVE_PATH_INVALID");
    return { databasePath, database };
  }

  async function loadSnapshot(id) {
    const files = await inspectFiles(id);
    const snapshot = await readContentSnapshot({ adventuresRoot, adventureId: id });
    if (snapshot?.profile?.adventureId !== id || !START_TEXT[snapshot.profile.language]
      || typeof snapshot?.lock?.overallHash !== "string" || !snapshot.lock.overallHash) throw failure("SAVE_IDENTITY_MISMATCH");
    return { ...files, snapshot };
  }

  async function verifyCached(id, session) {
    const current = await loadSnapshot(id);
    if (!current.database) throw failure("INITIAL_STATE_REQUIRED");
    if (current.snapshot.profile.language !== session.snapshot.profile.language
      || current.snapshot.lock.overallHash !== session.snapshot.lock.overallHash
      || current.database.dev !== session.database.dev || current.database.ino !== session.database.ino) {
      throw failure("SAVE_IDENTITY_MISMATCH");
    }
    requireOpen(id);
    return session;
  }

  async function getSession(id, initialization = null) {
    requireOpen(id);
    const cached = sessions.get(id);
    if (cached) {
      if (initialization) throw failure("SAVE_ALREADY_EXISTS");
      return verifyCached(id, await cached);
    }
    // Install the promise before the first filesystem await: concurrent UI
    // reads and startup requests can never fork two owners of one save.
    const opening = (async () => {
      const { databasePath, database, snapshot } = await loadSnapshot(id);
      requireOpen(id);
      if (initialization) {
        if (database) throw failure("SAVE_ALREADY_EXISTS");
        if (initialization.adventureLocale !== snapshot.profile.language) throw failure("SAVE_IDENTITY_MISMATCH");
      } else if (!database) throw failure("INITIAL_STATE_REQUIRED");
      const localeResolver = createSkillLocaleResolver({ snapshotLoader: async () => snapshot });
      const resolved = await localeResolver.resolveCurrent({ adventureId: id });
      requireOpen(id);
      const client = await createSessionProcess({ provider: config.provider, sessionOptions: {
        ...budgets, databasePath, adventureId: id, locale: snapshot.profile.language,
        contentVersion: snapshot.lock.overallHash, hostText: snapshot.content.host, worldText: snapshot.content.world,
        openingText: resolved.newGameSkill.body,
        finaleText: resolved.skills.find((skill) => skill.itemId === "story-finale")?.body || "",
        extremeText: resolved.skills.find((skill) => skill.itemId === "extreme-ending-easter")?.body || "",
        memoryFragmentText: resolved.skills.find((skill) => skill.packId === "grey-crow-default" && skill.itemId === "memory-fragment")?.body || "",
        ...(initialization ? { initialState: createOpeningState({ day: snapshot.profile.world.itemId === "shanghai-day10" ? 10 : 1 }) } : {}),
      } });
      try {
        requireOpen(id);
        const created = await inspectFiles(id);
        if (!created.database) throw failure("INITIAL_STATE_REQUIRED");
        requireOpen(id);
        return { client, snapshot, resolved, localeResolver, database: created.database };
      } catch (error) {
        await client.close();
        throw error;
      }
    })();
    sessions.set(id, opening);
    try { return await opening; }
    catch (error) { if (sessions.get(id) === opening) sessions.delete(id); throw error; }
  }

  async function displayLocale(session) {
    return typeof config.displayLocale === "function"
      ? config.displayLocale({ adventureId: session.snapshot.profile.adventureId, adventureLocale: session.snapshot.profile.language })
      : config.displayLocale || session.snapshot.profile.language;
  }

  async function projection(session, raw, request = {}, delivery = "recovery", { includeContextUsage = false, lastInvocation = null } = {}) {
    const language = await displayLocale(session);
    const result = projectSessionView(raw, { delivery, displayLocale: language,
      memoryFragmentSkill: resolveSessionMemoryFragmentSkill(session.snapshot, language),
      ...(discoverySkill(session) ? { discoverySkill: discoverySkill(session) } : {}) });
    if (request.session_id !== undefined) {
      const sessionId = identifier(request.session_id);
      result.envelope.meta.session_id = sessionId;
    }
    if (includeContextUsage) {
      result.contextUsage = withInvocation(await nextContextUsage(session, raw.revision), lastInvocation);
      result.envelope.contextUsage = result.contextUsage;
    }
    return result;
  }

  function withInvocation(usage, lastInvocation = null) {
    return usage ? { ...usage, lastInvocation } : null;
  }

  async function readContextUsage(session, options) {
    const usage = await session.client.readContextUsage(options);
    if (usage?.adventureId !== session.snapshot.profile.adventureId || usage.revision !== options.revision
      || usage.scope !== "next_request" || usage.actionId !== null) throw failure("CONTEXT_SOURCE_UNAVAILABLE");
    return usage;
  }

  async function nextContextUsage(session, revision) {
    try {
      if (revision === undefined) {
        const state = await session.client.readPlayerState();
        if (state.adventureId !== session.snapshot.profile.adventureId) return null;
        revision = state.revision;
      }
      return await readContextUsage(session, { revision });
    } catch {
      // Missing accounting cannot revoke a committed story or masquerade as
      // zero context. The next explicit read can recover the same formal view.
      return null;
    }
  }

  function discoverySkill(session) {
    const skill = session.resolved.skills.find((item) => item.itemId === "extreme-ending-easter");
    const moduleRef = skill?.panel?.moduleRef ?? skill?.panel?.ordinarySource?.moduleRef;
    return skill && typeof moduleRef === "string" ? { packId: skill.packId, moduleRef, title: skill.title } : null;
  }

  async function pendingTerminalAction(session, raw) {
    const terminal = raw.finale?.terminal;
    if (!terminal || terminal.status !== "reserved") return null;
    const action = await session.client.readAction(terminal.actionId);
    const stored = action?.request;
    if (terminal.baseRevision !== raw.revision || !stored || stored.actionId !== terminal.actionId
      || stored.baseRevision !== terminal.baseRevision || typeof stored.input !== "string"
      || stored.locale !== session.snapshot.profile.language || stored.contentVersion !== session.snapshot.lock.overallHash) {
      throw failure("TERMINAL_IDENTITY_MISMATCH");
    }
    return { adventureId: raw.adventureId, actionId: terminal.actionId, baseRevision: terminal.baseRevision, input: stored.input };
  }

  async function recoverCommittedTerminal(session, request, terminalAction, actionResult) {
    if (actionResult.status !== "committed" || actionResult.actionId !== terminalAction.actionId
      || actionResult.revision !== terminalAction.baseRevision + 1) throw failure("TERMINAL_IDENTITY_MISMATCH");
    try {
      // Read exactly the durable receipt's revision once. A display failure
      // cannot become permission to rerun either the ending or its chapter.
      const raw = await session.client.readView({ revision: actionResult.revision });
      if (raw.adventureId !== terminalAction.adventureId || raw.revision !== actionResult.revision
        || raw.actionId !== terminalAction.actionId) throw failure("TERMINAL_IDENTITY_MISMATCH");
      const projected = await projection(session, raw, request, "recovery", { includeContextUsage: true, lastInvocation: actionResult.contextUsage ?? null });
      const derivedWork = planTurnDerived(raw, actionResult);
      return { ok: true, adventureId: raw.adventureId, revision: raw.revision, projection: projected,
        storyFinale: projected.storyFinale, contextUsage: projected.contextUsage, actionResult, envelope: projected.envelope, terminalAction,
        ...(derivedWork ? { derivedWork } : {}) };
    } catch {
      return { ok: false, adventureId: terminalAction.adventureId, revision: actionResult.revision,
        projection: null, actionResult, terminalAction, error: { code: "VIEW_UNAVAILABLE", retryable: true },
        contextUsage: withInvocation(await nextContextUsage(session, actionResult.revision), actionResult.contextUsage ?? null),
        recoveryRequired: true };
    }
  }

  async function recoverAdvancedTerminal(session, request, latest) {
    const terminal = latest.terminal;
    if (latest.adventureId !== session.snapshot.profile.adventureId || terminal?.status !== "committed"
      || terminal.baseRevision !== request.revision || terminal.committedRevision !== latest.revision
      || latest.revision !== request.revision + 1) throw failure("REVISION_CONFLICT");
    const action = await session.client.readAction(terminal.actionId);
    const stored = action?.request;
    if (action?.status !== "committed" || action.actionId !== terminal.actionId || action.revision !== latest.revision
      || stored?.actionId !== terminal.actionId || stored.baseRevision !== terminal.baseRevision
      || typeof stored.input !== "string" || stored.locale !== session.snapshot.profile.language
      || stored.contentVersion !== session.snapshot.lock.overallHash) throw failure("TERMINAL_IDENTITY_MISMATCH");
    const terminalAction = { adventureId: latest.adventureId, actionId: terminal.actionId,
      baseRevision: terminal.baseRevision, input: stored.input };
    const receipt = { status: "committed", actionId: action.actionId, attemptId: action.attemptId,
      revision: action.revision, generationPasses: 0, modelCalls: 0, toolCalls: 0, usage: null, usageComplete: true };
    return recoverCommittedTerminal(session, request, terminalAction, receipt);
  }

  function lockedContent(session) {
    const { snapshot, resolved } = session;
    const item = (source, title, implementation) => ({
      ...selected(source, ["packId", "packVersion", "itemId", "itemType", "skillClass", "language"]), title, implementation,
    });
    const visibleSkills = resolved.skills.filter((skill) => skill.panel?.visibility !== "hidden_until_active");
    return {
      integrityStatus: "locked", language: snapshot.profile.language,
      contentProfileId: snapshot.profile.profileId, snapshotLockId: snapshot.lock.lockId, overallHash: snapshot.lock.overallHash,
      host: item(snapshot.profile.host, snapshot.profile.host.title || heading(snapshot.content.host, snapshot.profile.host.itemId), "narrative_reference"),
      world: item(snapshot.profile.world, snapshot.profile.world.title || heading(snapshot.content.world, snapshot.profile.world.itemId), "world_reference"),
      newGameSkill: item(snapshot.profile.newGameSkill, resolved.newGameSkill.title, "session_opening"),
      skills: visibleSkills.map((skill) => item(snapshot.profile.skills.find((ref) => ref.packId === skill.packId && ref.itemId === skill.itemId),
        skill.title, skill.itemId === "story-finale" ? "session_finale"
          : skill.itemId === "extreme-ending-easter" ? "session_extreme"
            : skill.packId === "grey-crow-default" && skill.itemId === "memory-fragment" ? "session_memory_fragments" : "pending")),
    };
  }

  async function readProjected(request, { includeContextUsage = false } = {}) {
    const id = saveId(request);
    const session = await getSession(id);
    const raw = await session.client.readView(selected(request, ["revision", "maxCharacters"]));
    return { session, raw, projection: await projection(session, raw, request, "recovery", { includeContextUsage }) };
  }

  async function withSessionSignal(session, options, operation) {
    const id = session.snapshot.profile.adventureId;
    requireOpen(id);
    const callerSignal = options.signal;
    if (callerSignal !== undefined && !(callerSignal instanceof AbortSignal)) throw failure("SESSION_PAYLOAD_INVALID");
    const controller = new AbortController();
    const forwardAbort = () => {
      // Closing an adventure is infrastructure interruption. Once close() has
      // synchronously claimed it, a later UI abort must not become a durable
      // player cancellation before the child processes its shutdown message.
      if (!closed && !closingSaves.has(id)) controller.abort(callerSignal.reason);
    };
    if (callerSignal?.aborted) forwardAbort();
    else callerSignal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      return await operation({ ...options, signal: controller.signal });
    } finally { callerSignal?.removeEventListener("abort", forwardAbort); }
  }

  async function runInSession(session, request, options) {
    identifier(request.actionId);
    if (!Number.isSafeInteger(request.baseRevision) || request.baseRevision < 0 || typeof request.text !== "string" || !request.text.trim()) {
      throw failure("ACTION_INPUT_INVALID");
    }
    if (request.session_id !== undefined) identifier(request.session_id);
    const actionResult = await withSessionSignal(session, options, (controls) => session.client.runAction({
      actionId: request.actionId, baseRevision: request.baseRevision, input: request.text,
      locale: session.snapshot.profile.language, contentVersion: session.snapshot.lock.overallHash }, controls));
    const { view: internalView, finalization, ...receipt } = actionResult;
    if (finalization) receipt.finalization = finalizationReceipt(finalization);
    // A committed receipt already carries its exact view. Never join it to a
    // later latest-state read, and never replay speech on a duplicate receipt.
    let raw = internalView;
    if (!raw && actionResult.status !== "committed") {
      try { raw = await session.client.readView({ revision: request.baseRevision }); }
      catch { /* Preserve the durable outcome even when its display cannot be read. */ }
    }
    if (!raw) {
      return { adventureId: session.snapshot.profile.adventureId, actionId: request.actionId,
        request_id: request.actionId, segments: [], state_hint: null, projection: null, actionResult: receipt,
        contextUsage: withInvocation(await nextContextUsage(session, actionResult.status === "committed" ? actionResult.revision : undefined), receipt.contextUsage ?? null),
        meta: { ok: false, autoSpeak: false, delivery: "recovery", recoveryRequired: true,
          actionStatus: actionResult.status, ...(request.session_id ? { session_id: request.session_id } : {}) },
        error: { code: actionResult.error?.code || "VIEW_UNAVAILABLE" } };
    }
    const derivedWork = planTurnDerived(raw, actionResult);
    const projected = await projection(session, raw, request,
      actionResult.status === "committed" && actionResult.generationPasses > 0 ? "commit" : "recovery",
      { includeContextUsage: true, lastInvocation: receipt.contextUsage ?? null });
    if (actionResult.status !== "committed") {
      projected.envelope.request_id = request.actionId;
      projected.envelope.meta.ok = false;
      projected.envelope.meta.actionStatus = actionResult.status;
      projected.envelope.error = { code: actionResult.error?.code || `ACTION_${String(actionResult.status).toUpperCase()}` };
    }
    return { ...projected.envelope, projection: projected, actionResult: receipt,
      ...(derivedWork ? { derivedWork } : {}) };
  }

  function planTurnDerived(raw, actionResult) {
    if (actionResult.status !== "committed" || !(actionResult.generationPasses > 0)) return null;
    const identity = { actionId: actionResult.actionId, revision: raw.revision };
    if (raw.finale?.decision?.phase === "confirmed" && raw.finale.archive?.confirmationRevision === raw.revision) {
      return { kind: "finale", ...identity, trigger: "finale" };
    }
    if ((raw.state.opening && raw.state.opening.phase !== "ready")
      || raw.state.finale?.phase === "confirmed" || raw.finale?.archive || raw.finale?.terminal) return null;
    const triggers = [];
    if (saveSettings.onAutoSave && raw.timeline?.storyTurnCount > 0
      && raw.timeline.storyTurnCount % saveSettings.intervalTurns === 0) triggers.push("interval");
    if (saveSettings.onCompaction && actionResult.compaction?.status === "reduced"
      && actionResult.compaction.modelCalls > 0) triggers.push("compaction");
    return triggers.length ? { kind: "chapter", ...identity, trigger: triggers.join("+") } : null;
  }

  async function completeTurnDerived(input, options = {}) {
    const request = derivedRequest(input);
    const session = await getSession(request.save_id);
    // This internal entry consumes Main's one-use plan. Verify only durable
    // action identity here; no recovery path may replay the player action.
    const action = await session.client.readAction(request.actionId);
    const stored = action?.request;
    if (action?.status !== "committed" || action.adventureId !== request.save_id
      || action.actionId !== request.actionId || action.revision !== request.revision
      || stored?.actionId !== request.actionId || stored.baseRevision !== request.revision - 1
      || stored.locale !== session.snapshot.profile.language || stored.contentVersion !== session.snapshot.lock.overallHash) {
      throw failure("SAVE_IDENTITY_MISMATCH");
    }
    const raw = await session.client.readView({ revision: request.revision });
    if (raw.adventureId !== request.save_id || raw.revision !== request.revision || raw.actionId !== request.actionId) throw failure("SAVE_IDENTITY_MISMATCH");
    const receipt = { adventureId: request.save_id, actionId: request.actionId, revision: request.revision,
      kind: request.kind, autoSpeak: false };
    if (request.kind === "chapter") {
      if ((raw.state.opening && raw.state.opening.phase !== "ready")
        || raw.state.finale?.phase === "confirmed" || raw.finale?.archive || raw.finale?.terminal) throw failure("SESSION_PAYLOAD_INVALID");
      return { ...receipt, chapterSummary: await generateChapter(session, request.revision, request.trigger, options) };
    }
    if (raw.finale?.decision?.phase !== "confirmed" || raw.finale.archive?.confirmationRevision !== request.revision
      || raw.finale.archive?.confirmationActionId !== request.actionId) throw failure("SAVE_IDENTITY_MISMATCH");
    let finalized;
    try {
      finalized = await withSessionSignal(session, options, (controls) => session.client.finalize(
        { revision: request.revision }, { ...controls, retry: false }));
    } catch {
      finalized = { status: "unknown", error: { code: "FINALE_OUTCOME_UNKNOWN", retryable: true },
        chapterWork: { modelCalls: null, usage: null, usageComplete: false } };
    }
    const finalization = finalizationReceipt(finalized);
    try {
      const updated = await session.client.readView({ revision: request.revision });
      if (updated.adventureId !== request.save_id || updated.revision !== request.revision || updated.actionId !== request.actionId) throw failure("SAVE_IDENTITY_MISMATCH");
      const projected = await projection(session, updated, {}, "recovery", { includeContextUsage: true });
      return { ...receipt, finalization, projection: projected, storyFinale: projected.storyFinale, contextUsage: projected.contextUsage };
    } catch {
      return { ...receipt, finalization, projection: null, error: { code: "VIEW_UNAVAILABLE", retryable: true } };
    }
  }

  async function generateChapter(session, revision, trigger, options = {}) {
    let outcome;
    try {
      outcome = await withSessionSignal(session, { ...options, retry: false }, (controls) => session.client.saveChapter({ targetRevision: revision }, controls));
    } catch {
      // Story durability is independent of derived work. Transport loss cannot
      // prove whether a chapter was saved; only an explicit query/retry may check.
      outcome = { chapterStatus: "unknown", modelCalls: null, usage: null, usageComplete: false,
        error: { code: "CHAPTER_RESULT_UNKNOWN", retryable: true } };
    }
    return { trigger, revision, ...selected(outcome, ["chapterStatus", "modelCalls", "usage", "usageComplete", "error"]),
      ...selected(outcome.chapter || {}, ["mode", "fallbackReason"]), autoSpeak: false };
  }

  function closeSave(id, recoveryOwner) {
    // An abandoned desktop recovery may finish after a newer recovery has
    // claimed the same cached process. Check and claim closing synchronously.
    if (recoveryOwner !== undefined && recoveryOwners.get(id) !== recoveryOwner) return Promise.resolve();
    if (closingSaves.has(id)) return closingSaves.get(id);
    const existing = sessions.get(id);
    const owner = recoveryOwners.get(id);
    const closing = Promise.resolve().then(async () => {
      if (!existing) return;
      // An opening process sees closingSaves and closes itself before rejecting.
      const session = await existing.catch(() => null);
      if (session) await session.client.close();
    }).finally(() => {
      if (sessions.get(id) === existing) sessions.delete(id);
      if (recoveryOwners.get(id) === owner) recoveryOwners.delete(id);
      closingSaves.delete(id);
    });
    closingSaves.set(id, closing);
    return closing;
  }

  return Object.freeze({
    protocolVersion: "desktop-bridge-session-v1",
    async initializeFromContentSnapshot(request = {}) {
      const id = identifier(request.adventureId);
      const session = await getSession(id, { adventureLocale: request.adventureLocale });
      const raw = await session.client.readView();
      const projected = await projection(session, raw, {}, "recovery", { includeContextUsage: true });
      return { ...projected.save, exists: true, phase: raw.state.opening?.phase || "ready", format: FORMAT,
        schemaVersion: FORMAT, playerContinuable: true, projection: projected };
    },
    async initializeNewGame(request = {}) {
      const result = await readProjected(request);
      return { ok: true, save_id: saveId(request), initialized: false,
        state_hint: result.projection.state_hint, projection: result.projection,
        new_game_skill_id: result.session.snapshot.profile.newGameSkill.itemId, warnings: [] };
    },
    async startNewGameLifecycle(request = {}, options = {}) {
      const session = await getSession(saveId(request));
      return runInSession(session, { ...request, actionId: "opening-start", baseRevision: 0,
        text: START_TEXT[session.snapshot.profile.language] }, options);
    },
    async runTurn(request = {}, options = {}) {
      return runInSession(await getSession(saveId(request)), request, options);
    },
    completeTurnDerived,
    updateSaveSettings(value) {
      if (closed) throw failure("SESSION_PROCESS_CLOSED");
      saveSettings = normalizeSaveSettings(value);
      return { chapterLog: { ...saveSettings } };
    },
    async readView(request = {}) { return (await readProjected(request, { includeContextUsage: true })).projection; },
    async readHistory(request = {}) {
      const session = await getSession(saveId(request));
      const page = await session.client.readHistory(selected(request, ["revision", "beforeRevision", "limit", "maxCharacters"]));
      return projectSessionHistory(page);
    },
    async readAction(request = {}) { return (await getSession(saveId(request))).client.readAction(identifier(request.actionId)); },
    async readContextUsage(request = {}) {
      const session = await getSession(saveId(request));
      return readContextUsage(session, selected(request, ["revision", "input", "narrationPreferences", "contextPolicy"]));
    },
    async compactCurrentContext(request = {}, options = {}) {
      const session = await getSession(saveId(request));
      const compaction = await withSessionSignal(session, options, (controls) => session.client.compactContext(
        selected(request, ["requestId", "revision", "input"]), controls));
      const chapterSummary = saveSettings.onCompaction && compaction.status === "reduced" && compaction.modelCalls > 0
        ? await generateChapter(session, request.revision, "compaction", options) : null;
      return { ok: ["reduced", "no_benefit", "not_needed", "baseline_too_large"].includes(compaction.status), compaction,
        ...(chapterSummary ? { chapterSummary } : {}),
        contextUsage: await nextContextUsage(session, request.revision) };
    },
    async readContextCompaction(request = {}) {
      const session = await getSession(saveId(request));
      const compaction = await session.client.readContextCompaction({ requestId: identifier(request.requestId) })
        || { requestId: request.requestId, revision: request.revision, status: "failed", modelCalls: 0,
          error: { code: "COMPACTION_NOT_FOUND", retryable: true } };
      if (compaction && compaction.revision !== request.revision) throw failure("COMPACTION_INPUT_CONFLICT");
      return { ok: Boolean(compaction && ["reduced", "no_benefit", "not_needed", "baseline_too_large"].includes(compaction.status)), compaction,
        contextUsage: await nextContextUsage(session, request.revision) };
    },
    async cancelAction(request = {}) { return (await getSession(saveId(request))).client.cancelAction(identifier(request.actionId)); },
    async recoverCurrentAdventure(request = {}) {
      const id = saveId(request);
      requireOpen(id);
      // This token stays inside the desktop bridge; it is never sent to the
      // model or child process. Even an in-flight newer recovery owns its use.
      recoveryOwners.set(id, request.recoveryOwner ?? {});
      const session = await getSession(id);
      await session.client.recoverFinale(selected(request, ["revision"]));
      const result = await readProjected(request, { includeContextUsage: true });
      const terminalAction = await pendingTerminalAction(result.session, result.raw);
      const pendingAction = terminalAction ? null : await result.session.client.readPendingAction({ revision: result.raw.revision });
      const language = await displayLocale(result.session);
      const memoryFragmentSkill = resolveSessionMemoryFragmentSkill(result.session.snapshot, language);
      return { ok: true, save_id: saveId(request), projection: result.projection, state_hint: result.projection.state_hint,
        modules: memoryFragmentSkill ? [projectMemoryFragmentModule(result.raw, { memoryFragmentSkill, displayLocale: language }).module] : [],
        storyFinale: result.projection.storyFinale, contextUsage: result.projection.contextUsage,
        ...(terminalAction ? { terminalAction } : {}),
        ...(pendingAction ? { pendingAction } : {}),
        history: result.projection.history, historyComplete: result.projection.historyComplete,
        historyNextBeforeRevision: result.projection.historyNextBeforeRevision,
        locked_content: lockedContent(result.session), recovery: { source: FORMAT, snapshot_status: "verified", revision: result.raw.revision },
        pendingCapabilities: lockedContent(result.session).skills.filter((skill) => skill.implementation === "pending")
          .map((skill) => skill.itemId), not_model_visible: true };
    },
    async loadRecentTranscript(request = {}) {
      const result = await readProjected(request);
      return { ok: true, save_id: saveId(request), adventureId: result.raw.adventureId, revision: result.raw.revision,
        history: result.projection.history, historyComplete: result.projection.historyComplete,
        historyNextBeforeRevision: result.projection.historyNextBeforeRevision, not_model_visible: true };
    },
    async listCurrentSkillModules(request = {}) {
      const { session, raw } = await readProjected(request);
      const language = await displayLocale(session);
      const memoryFragmentSkill = resolveSessionMemoryFragmentSkill(session.snapshot, language);
      const modules = memoryFragmentSkill ? [projectMemoryFragmentModule(raw, { memoryFragmentSkill, displayLocale: language }).module] : [];
      return { ok: true, save_id: saveId(request), adventureId: raw.adventureId, revision: raw.revision, actionId: raw.actionId,
        modules, locked_content: lockedContent(session),
        pendingCapabilities: lockedContent(session).skills.filter((skill) => skill.implementation === "pending")
          .map((skill) => ({ ...skill, status: "pending" })), not_model_visible: true };
    },
    async getCurrentSkillModule(request = {}) {
      const { session, raw } = await readProjected(request);
      const language = await displayLocale(session);
      const memoryFragmentSkill = resolveSessionMemoryFragmentSkill(session.snapshot, language);
      if (!memoryFragmentSkill || (request.moduleRef ?? request.module_ref) !== memoryFragmentSkill.moduleRef) throw failure("SKILL_MODULE_NOT_SELECTED");
      const input = selected(request, ["cursor", "limit"]);
      if ((request.fieldId ?? request.field_id) != null) input.fieldId = request.fieldId ?? request.field_id;
      return { ok: true, save_id: saveId(request), ...projectMemoryFragmentModule(raw,
        { ...input, memoryFragmentSkill, displayLocale: language }), not_model_visible: true };
    },
    async listCurrentSkillPanels(request = {}) {
      const result = await readProjected(request);
      return { ok: true, save_id: saveId(request), ...result.projection.panels, not_model_visible: true };
    },
    async getCurrentCharacterPanelEntry(request = {}) {
      const result = await readProjected(request);
      return { ok: true, save_id: saveId(request), ...result.projection.characterPanel, not_model_visible: true };
    },
    async getCurrentSkillPanel(request = {}) {
      const result = await readProjected(request);
      const input = selected(request, ["view", "cursor", "limit"]);
      for (const [target, camel, snake] of [["panelRef", "panelRef", "panel_ref"], ["fieldId", "fieldId", "field_id"], ["itemRef", "itemRef", "item_ref"]]) {
        const value = request[camel] ?? request[snake];
        if (value !== undefined) input[target] = value;
      }
      const language = await displayLocale(result.session);
      return { ok: true, save_id: saveId(request), ...projectSessionPanel(result.raw,
        { ...input, displayLocale: language,
          memoryFragmentSkill: resolveSessionMemoryFragmentSkill(result.session.snapshot, language),
          ...(discoverySkill(result.session) ? { discoverySkill: discoverySkill(result.session) } : {}) }), not_model_visible: true };
    },
    async inspectCurrentSave(request = {}) {
      const result = await readProjected(request);
      return { ok: true, save_id: saveId(request), ...result.projection.save, exists: true,
        format: FORMAT, schemaVersion: FORMAT, phase: result.raw.state.opening?.phase || "ready", playerContinuable: true };
    },
    async commitCurrentSave(request = {}, options = {}) {
      const session = await getSession(saveId(request));
      const state = await session.client.readPlayerState(selected(request, ["revision"]));
      if (!saveSettings.onManualSave) return { ok: true, adventureId: state.adventureId, revision: state.revision,
        result: { saved: true, savedRevision: state.revision, chapterStatus: "disabled", modelCalls: 0, usage: {},
          usageComplete: true, chapter_generated: false, chapter_log: null, not_hard_state: true, autoSpeak: false } };
      const outcome = await withSessionSignal(session, options, (controls) => session.client.saveChapter({
        targetRevision: state.revision }, controls));
      // A later chapter can already cover this earlier saved target. Its
      // receipt proves no work is needed, but its text belongs to that later view.
      const chapter = outcome.chapter && outcome.chapter.toRevision <= state.revision ? projectSessionChapters({ adventureId: state.adventureId,
        revision: state.revision, timeline: state.timeline, chapters: [outcome.chapter], nextCursor: null, complete: true }).chapters[0] : null;
      const { chapter: savedChapter, ...chapterOutcome } = outcome;
      return { ok: outcome.saved === true, adventureId: state.adventureId, revision: state.revision,
        result: { ...chapterOutcome, chapter_generated: outcome.chapterStatus === "created",
          chapter_log: chapter, not_hard_state: true, autoSpeak: false } };
    },
    async readChapterLogs(request = {}) {
      const session = await getSession(saveId(request));
      const result = projectSessionChapters(await session.client.readChapters(selected(request, ["revision", "cursor", "limit"])));
      return { ok: true, adventureId: result.adventureId, revision: result.revision,
        result: { ...result, not_model_visible: true } };
    },
    async resumeFinalization(request = {}, options = {}) {
      const session = await getSession(saveId(request));
      const latest = await session.client.readFinale();
      if (request.revision !== undefined && latest.revision !== request.revision) {
        return recoverAdvancedTerminal(session, request, latest);
      }
      const before = await session.client.readView(selected(request, ["revision"]));
      const terminalAction = await pendingTerminalAction(session, before);
      if (terminalAction) {
        const delivered = await runInSession(session, { ...request, actionId: terminalAction.actionId,
          baseRevision: terminalAction.baseRevision, text: terminalAction.input }, { ...options, retry: true });
        const { projection: projected, actionResult, derivedWork, ...envelope } = delivered;
        if (!projected && actionResult?.status === "committed") {
          return recoverCommittedTerminal(session, request, terminalAction, actionResult);
        }
        return { ok: !envelope.error, adventureId: before.adventureId,
          revision: projected?.revision ?? before.revision, projection: projected,
          storyFinale: projected?.storyFinale, contextUsage: envelope.contextUsage, actionResult, envelope, terminalAction,
          ...(derivedWork ? { derivedWork } : {}) };
      }
      const finalized = await withSessionSignal(session, options, (controls) => session.client.finalize(
        selected(request, ["revision"]), { ...controls, retry: true }));
      const raw = await session.client.readView(selected(request, ["revision"]));
      const projected = await projection(session, raw, request, "recovery", { includeContextUsage: true });
      return { ok: true, adventureId: raw.adventureId, revision: raw.revision,
        projection: projected, storyFinale: projected.storyFinale, contextUsage: projected.contextUsage, finalization: finalizationReceipt(finalized) };
    },
    async preflightSkillLocale(request = {}) {
      const session = await getSession(saveId(request));
      const coverage = await session.localeResolver.preflight({ gameLocale: request.gameLocale ?? request.game_locale,
        localeRevision: request.localeRevision ?? request.locale_revision });
      return { ok: coverage.status === "ready", save_id: saveId(request), coverage, not_model_visible: true };
    },
    async loadDebugTrace(request = {}) {
      const session = await getSession(saveId(request));
      const diagnostics = await session.client.readDiagnostics({ limit: request.limit ?? 100 });
      return { ok: true, save_id: diagnostics.adventureId,
        scope: { type: "active_adventure", adventure_id: diagnostics.adventureId },
        selection: { policy: "recent_only", recent_limit: request.limit ?? 100,
          available_entry_count: diagnostics.counts.actions,
          available_error_entry_count: (diagnostics.counts.byStatus.failed || 0) + (diagnostics.counts.byStatus.interrupted || 0),
          selected_error_entry_count: diagnostics.entries.filter((entry) => entry.error).length,
          truncated: !diagnostics.complete },
        diagnostics: { revision: diagnostics.revision, ...diagnostics.counts,
          attemptHistoryComplete: diagnostics.attemptHistoryComplete },
        execution: diagnostics.execution,
        entries: diagnostics.entries.map((entry) => ({ schema_version: "grey-crow-session-diagnostics-v1",
          record_id: entry.actionId, request_id: entry.actionId, createdAt: entry.createdAt,
          error_code: entry.error?.code || "", session_action: entry })), not_model_visible: true };
    },
    close(request = {}) {
      if (request.save_id !== undefined) return closeSave(saveId(request), request.recoveryOwner);
      if (closePromise) return closePromise;
      closed = true;
      closePromise = Promise.allSettled([...new Set([...sessions.keys(), ...closingSaves.keys()])].map((id) => closeSave(id))).then((results) => {
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected) throw rejected.reason;
      });
      return closePromise;
    },
  });
}

module.exports = { createSessionDesktopBridge };
