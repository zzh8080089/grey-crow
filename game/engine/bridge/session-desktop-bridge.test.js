"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const { createSessionDesktopBridge } = require("./session-desktop-bridge");
const { createSessionProcess } = require("../session/session-process");
const { loadBuiltInContentPack } = require("../content-v2/built-in-pack");
const { compileContentSnapshot } = require("../content-v2/snapshot-compiler");
const { readContentSnapshot } = require("../content-v2/snapshot-reader");
const { makeTreeWritable, hashCanonical } = require("../content-v2/snapshot-utils");
const { initialState, borrowBundle } = require("../session/test-fixtures/turn-samples");

const contentRoot = path.resolve(__dirname, "../../content");
const builtIn = loadBuiltInContentPack({ contentRoot });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function response(bundle) { return { text: JSON.stringify(bundle), usage: { input_tokens: 50, output_tokens: 60 }, model: "synthetic-local", finishReason: "stop" }; }
function emptyTurn(text = "请说说你的身份、唯一保留的东西和起点。") {
  return { narration: [{ id: "opening-question", text }], events: [], experiences: [] };
}
function proposal() {
  return { narration: [{ id: "summary", text: "你叫林安，留着母亲的记忆，来到陈姨所在的楼道。请确认这个开局。" }],
    events: [{ id: "proposal-event", type: "opening.propose", sourceSegmentIds: ["summary"],
      data: { proposalId: "opening-one", initialState: initialState() } }], experiences: [] };
}
function confirmation() {
  return { narration: [{ id: "confirmed", text: "你确认这个开局。陈姨在楼道那边向你点头。" }],
    events: [{ id: "confirmation-event", type: "opening.confirm", sourceSegmentIds: ["confirmed"], data: { proposalId: "opening-one" } }], experiences: [] };
}

for (const failedExactReads of [0, 2]) {
  test(`terminal resume recovers a lost committed view with ${failedExactReads} failed exact reads, without replaying story or chapter`, async (t) => {
    const { createTurnStore } = require("../session/turn-store");
    const environment = await setup(t);
    await environment.compile();
    const adventureId = "test-adventure";
    const snapshot = await readContentSnapshot({ adventuresRoot: environment.adventuresRoot, adventureId });
    const identity = { databasePath: path.join(environment.adventuresRoot, adventureId, "session.sqlite"),
      adventureId, locale: "zh-CN", contentVersion: snapshot.lock.overallHash };
    const store = createTurnStore({ ...identity, initialState: initialState(), terminalRandomInt: () => 9999 });
    const closing = { narration: [{ id: "terminal-source", text: "你最后回望楼道。这一段虚构旅程结束了。" }],
      events: [{ id: "third", type: "extreme.confirm", sourceSegmentIds: ["terminal-source"], data: { candidateId: "terminal-candidate" } }], experiences: [] };
    const playerInput = "这是第三次明确确认虚构角色的选择。";
    try {
      for (let revision = 1; revision <= 3; revision++) {
        const action = store.beginAction({ actionId: `terminal-recovery-${revision}`, baseRevision: revision - 1,
          input: `这段合成游戏中的第 ${revision} 个回应。`, locale: identity.locale, contentVersion: identity.contentVersion });
        const turn = structuredClone(closing);
        turn.narration[0].text = "这是虚构角色的选择；请自然回应。";
        if (revision === 1) {
          turn.events[0].type = "extreme.propose";
          turn.events[0].data = { candidateId: "terminal-candidate", characterId: "p",
            intentReason: "PRIVATE_TERMINAL_REASON", fictionalContext: "PRIVATE_TERMINAL_CONTEXT" };
        }
        store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: turn });
      }
      const action = store.beginAction({ actionId: "terminal-recovery-4", baseRevision: 3, input: playerInput,
        locale: identity.locale, contentVersion: identity.contentVersion });
      store.reserveTerminal({ actionId: action.actionId, attemptId: action.attemptId, candidateId: "terminal-candidate" });
    } finally { store.close(); }
    let modelCalls = 0;
    let failuresRemaining = failedExactReads;
    let exactReads = 0;
    let droppedView = false;
    const bridge = environment.bridge({ generate() {
      modelCalls++;
      if (modelCalls === 1) return response(closing);
      if (modelCalls === 2) return response({ title: "回望", summary: "这段虚构旅程结束了。",
        keyEvents: [{ text: "角色最后回望楼道。", sources: [{ revision: 4, segmentId: "terminal-source" }] }], openThreads: [] });
      throw new Error("recovery must never call a model again");
    } }, { createSessionProcess: async (options) => {
      const client = await createSessionProcess(options);
      return { ...client,
        async runAction(...args) {
          const result = await client.runAction(...args);
          if (result.status === "committed" && !droppedView) { droppedView = true; const { view, ...receipt } = result; return receipt; }
          return result;
        },
        async readView(options = {}) {
          if (options.revision === 4) {
            exactReads++;
            if (failuresRemaining > 0) { failuresRemaining--; throw Object.assign(new Error("private synthetic diagnostic"), { code: "VIEW_UNAVAILABLE" }); }
          }
          return client.readView(options);
        },
      };
    } });
    const request = { save_id: adventureId, revision: 3 };
    let restored;
    for (let read = 0; read <= failedExactReads; read++) {
      restored = await bridge.resumeFinalization(request);
      assert.equal(restored.actionResult.status, "committed");
      assert.equal(restored.actionResult.revision, 4);
      assert.equal(restored.terminalAction.input, playerInput);
      assert.equal(modelCalls, 1, "recovering the committed story must not start its chapter");
      assert.doesNotMatch(JSON.stringify(restored), /PRIVATE_TERMINAL|intentReason|fictionalContext|"outcome"|"draw"|"threshold"|private synthetic/);
      if (read < failedExactReads) {
        assert.equal(restored.ok, false); assert.equal(restored.projection, null);
        assert.equal(restored.error.code, "VIEW_UNAVAILABLE"); assert.equal(restored.recoveryRequired, true);
      }
    }
    assert.equal(restored.ok, true); assert.equal(restored.projection.revision, 4);
    assert.equal(restored.storyFinale.projection.phase, "recovery_required"); assert.equal(restored.storyFinale.projection.inputAllowed, false);
    assert.equal(restored.projection.history.filter((turn) => turn.actionId === "terminal-recovery-4").length, 1);
    assert.equal(restored.projection.history.at(-1).player, playerInput);
    assert.equal(restored.projection.history.at(-1).host, closing.narration[0].text);
    assert.equal(restored.envelope.meta.autoSpeak, false); assert.deepEqual(restored.envelope.segments, []);
    assert.equal(exactReads, failedExactReads + 1);
    if (failedExactReads === 0) {
      assert.deepEqual(restored.derivedWork, { kind: "finale", actionId: "terminal-recovery-4", revision: 4, trigger: "finale" });
      const completed = await bridge.completeTurnDerived({ save_id: adventureId, ...restored.derivedWork });
      assert.equal(completed.finalization.status, "closed");
      assert.equal(completed.autoSpeak, false); assert.deepEqual(completed.projection.envelope.segments, []);
    } else {
      assert.equal(restored.derivedWork, undefined, "a later receipt-only recovery cannot schedule fresh work");
      assert.equal((await bridge.resumeFinalization({ save_id: adventureId, revision: 4 })).finalization.status, "closed");
    }
    const again = await bridge.resumeFinalization(request);
    assert.equal(again.actionResult.modelCalls, 0); assert.equal(again.projection.revision, 4);
    assert.equal(again.storyFinale.projection.phase, "closed"); assert.equal(modelCalls, 2);
    await assert.rejects(bridge.resumeFinalization({ ...request, revision: 2 }), { code: "REVISION_CONFLICT" });
    assert.equal(modelCalls, 2);
  });
}

async function setup(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-desktop-session-")));
  const adventuresRoot = path.join(directory, "saves");
  await fs.mkdir(adventuresRoot);
  const bridges = [];
  const children = [];
  let processStarts = 0;
  t.after(async () => {
    await Promise.all(bridges.map((bridge) => bridge.close()));
    for (const child of children) assert.notEqual(child.exitCode === null && child.signalCode === null, true, "bridge close must await actual child exit");
    await makeTreeWritable(directory);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, adventuresRoot, children,
    get processStarts() { return processStarts; },
    async compile(adventureId = "test-adventure", language = "zh-CN", { memoryFragments = true } = {}) {
      const source = await builtIn;
      const plan = memoryFragments ? source.defaultPlan : require("../content-v2/generated/pack-resolver.cjs").resolveContentPlan({
        packs: [source.pack], selection: { host: source.defaultPreset.host, world: source.defaultPreset.world,
          newGameSkill: source.defaultPreset.newGameSkill, skills: source.defaultPreset.skills } });
      return compileContentSnapshot({ adventuresRoot, adventureId, language, plan,
        requiredSkillRefs: source.defaultPreset.skills, builtInDomainSkillIds: ["characters"],
        resolvePackRoot: (packId) => path.join(contentRoot, "packs", packId) });
    },
    bridge(provider = { generate: async () => response(emptyTurn()) }, options = {}) {
      const bridge = createSessionDesktopBridge({ adventuresRoot, provider, ...options,
        createSessionProcess: options.createSessionProcess || ((settings) => {
          processStarts += 1;
          return createSessionProcess({ ...settings, spawn(modulePath, args, spawnOptions) {
            const child = fork(modulePath, args, spawnOptions); children.push(child); return child;
          } });
        }) });
      bridges.push(bridge); return bridge;
    },
  };
}

test("unselected memory-fragment content stays disabled through actual snapshot, child, candidate and panel reads", async (t) => {
  const env = await setup(t);
  await env.compile("no-fragments", "zh-CN", { memoryFragments: false });
  const calls = [];
  const bad = { narration: [{ id: "fragment-source", text: "一个未经证实的片段闪过。" }], events: [{ id: "fragment", type: "memory_fragment.record", sourceSegmentIds: ["fragment-source"],
      data: { discoveryMode: "active_recall", dimension: "body", trigger: "合成气味", content: "手指似乎记得一种触感。画面仍不清晰。" } },
  ], experiences: [] };
  const queue = [emptyTurn(), proposal(), confirmation(), bad];
  const bridge = env.bridge({ generate(request) { calls.push(request); return response(queue.shift()); } },
    { sessionOptions: { maxModelCalls: 1 } });
  const id = { save_id: "no-fragments" };
  await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
  await bridge.startNewGameLifecycle(id);
  await bridge.runTurn({ ...id, actionId: "role", baseRevision: 1, text: "我是林安，在楼道开始。" });
  await bridge.runTurn({ ...id, actionId: "confirm", baseRevision: 2, text: "确认开局。" });
  const result = await bridge.runTurn({ ...id, actionId: "recollect", baseRevision: 3, text: "我试着回忆。" });
  assert.equal(result.actionResult.status, "failed");
  assert.equal((await bridge.readView(id)).revision, 3);
  assert.equal(calls.length, 4);
  const fixed = JSON.parse(calls.at(-1).messages[1].content);
  assert.equal(fixed.memoryFragments, undefined);
  assert.equal(fixed.quotedNarrativeSources.memoryFragmentText, undefined);
  assert.equal(calls.at(-1).tools.some((tool) => tool.function.name === "read_memory_fragments"), false);
  assert.deepEqual((await bridge.listCurrentSkillModules(id)).modules, []);
  assert.equal((await bridge.listCurrentSkillPanels(id)).panels.some((panel) => panel.panelRef === "session-memory-fragments"), false);
  await assert.rejects(bridge.getCurrentSkillPanel({ ...id, revision: 3, panel_ref: "session-memory-fragments" }), { code: "SKILL_PANEL_NOT_SELECTED" });
});

test("real bridge exposes next-request context at the projected revision and keeps invocation usage separate", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  let calls = 0;
  let contextReads = 0;
  const settings = { maxCompactionModelCalls: 2, narrationPreferences: { lengthPreset: "custom", customTargetChars: 180 },
    contextPolicy: { configuredContextWindow: 256000, providerContextLimit: 128000, autoCompactRatio: 0.7 } };
  const bridge = environment.bridge({ generate(request) {
    calls++;
    assert.match(request.messages[0].content, /"targetCharacters":180/);
    return { ...response(emptyTurn()), usage: { input_tokens: 9000, output_tokens: 100, total_tokens: 9100 } };
  } }, { sessionOptions: settings, createSessionProcess: async (options) => {
    assert.equal(options.sessionOptions.maxCompactionModelCalls, 2);
    const client = await createSessionProcess(options);
    return { ...client, readContextUsage(options) { contextReads++; return client.readContextUsage(options); } };
  } });
  settings.narrationPreferences.customTargetChars = 800;
  const id = { save_id: "test-adventure", session_id: "current-ui" };
  await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
  const initial = await bridge.recoverCurrentAdventure(id);
  assert.equal(initial.contextUsage.adventureId, id.save_id); assert.equal(initial.contextUsage.revision, 0);
  assert.equal(initial.contextUsage.scope, "next_request"); assert.equal(initial.contextUsage.latestActual, null);
  assert.deepEqual(initial.projection.envelope.contextUsage, initial.contextUsage);
  const draft = await bridge.readContextUsage({ ...id, revision: 0,
    narrationPreferences: { lengthPreset: "short" }, contextPolicy: { configuredContextWindow: 32000 } });
  assert.notEqual(draft.settingsIdentity, initial.contextUsage.settingsIdentity);
  assert.deepEqual({ ...await bridge.readContextUsage({ ...id, revision: 0 }), lastInvocation: null }, initial.contextUsage);
  assert.equal(calls, 0);
  const request = { ...id, actionId: "context-first-turn", baseRevision: 0, text: "请询问开局信息。" };
  const turn = await bridge.runTurn(request);
  assert.equal(turn.actionResult.status, "committed"); assert.equal(turn.revision, 1);
  assert.equal(turn.contextUsage.revision, 1); assert.equal(turn.contextUsage.scope, "next_request");
  assert.equal(turn.contextUsage.latestActual, null); assert.equal(turn.meta.session_id, id.session_id);
  assert.deepEqual(turn.projection.contextUsage, turn.contextUsage);
  assert.deepEqual(turn.projection.envelope.contextUsage, turn.contextUsage);
  assert.equal(turn.actionResult.contextUsage.revision, 0);
  assert.equal(turn.actionResult.contextUsage.actionId, request.actionId);
  assert.equal(turn.actionResult.contextUsage.latestActual.inputTokens, 9000);
  assert.deepEqual(turn.contextUsage.lastInvocation, turn.actionResult.contextUsage);
  const readsBeforePanels = contextReads;
  await bridge.listCurrentSkillPanels(id);
  await bridge.getCurrentCharacterPanelEntry(id);
  assert.equal(contextReads, readsBeforePanels, "opening panels must not rebuild the model context");
  const duplicate = await bridge.runTurn(request);
  assert.equal(duplicate.actionResult.modelCalls, 0); assert.equal(duplicate.actionResult.contextUsage, null);
  assert.deepEqual(duplicate.contextUsage, { ...turn.contextUsage, lastInvocation: null }); assert.equal(calls, 1);
  await bridge.close(id);
  const restored = await bridge.recoverCurrentAdventure(id);
  assert.deepEqual(restored.contextUsage, duplicate.contextUsage); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(restored.contextUsage), /quotedNarrativeSources|messages|apiKey|请询问开局/);
});

for (const unavailable of ["view", "context"]) {
  test(`committed story survives unavailable ${unavailable}, with correctly bound context or explicit unknown`, async (t) => {
    const environment = await setup(t);
    await environment.compile();
    let committed = false;
    let calls = 0;
    const bridge = environment.bridge({ generate() { calls++; return response(emptyTurn()); } }, {
      createSessionProcess: async (options) => {
        const client = await createSessionProcess(options);
        return { ...client,
          async runAction(...args) {
            const result = await client.runAction(...args); committed = result.status === "committed";
            if (unavailable === "view") { const { view, ...receipt } = result; return receipt; }
            return result;
          },
          readContextUsage(options) {
            if (committed && unavailable === "context") throw Object.assign(new Error("PRIVATE_CONTEXT_READ_FAILURE"), { code: "CONTEXT_SOURCE_UNAVAILABLE" });
            return client.readContextUsage(options);
          },
        };
      },
    });
    const id = { save_id: "test-adventure" };
    await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
    const result = await bridge.runTurn({ ...id, actionId: "lost-context-view", baseRevision: 0, text: "开始询问吧。" });
    assert.equal(result.actionResult.status, "committed"); assert.equal(calls, 1);
    assert.equal(result.actionResult.contextUsage.scope, "invocation");
    if (unavailable === "view") {
      assert.equal(result.projection, null); assert.equal(result.meta.recoveryRequired, true);
      assert.equal(result.contextUsage.scope, "next_request"); assert.equal(result.contextUsage.revision, 1);
      assert.equal(result.contextUsage.adventureId, id.save_id);
      assert.deepEqual(result.contextUsage.lastInvocation, result.actionResult.contextUsage);
    } else {
      assert.equal(result.revision, 1); assert.equal(result.meta.ok, true);
      assert.equal(result.contextUsage, null); assert.equal(result.projection.contextUsage, null);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CONTEXT_READ_FAILURE/);
    }
    assert.equal((await bridge.readAction({ ...id, actionId: "lost-context-view" })).revision, 1);
  });
}

test("actual content snapshot and child serve opening, confirmation, ordinary play, exact receipts, panels and recovery", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  const bundles = [emptyTurn(), proposal(), confirmation(), borrowBundle()];
  const modelInputs = [];
  const bridge = environment.bridge({ async generate(request) {
    assert.equal(request.signal instanceof AbortSignal, true);
    modelInputs.push(request);
    return response(bundles.shift());
  } });
  const id = { save_id: "test-adventure" };
  const inspected = await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
  assert.equal(inspected.schemaKind, "session");
  assert.equal(inspected.phase, "creating");
  assert.equal(inspected.adventureLocale, "zh-CN");
  assert.equal(inspected.projection.state_hint.scene.location, null);
  const initialized = await bridge.initializeNewGame(id);
  assert.equal(initialized.initialized, false);
  assert.equal(environment.processStarts, 1);
  const started = await bridge.startNewGameLifecycle({ ...id, session_id: "desktop-one" });
  assert.equal(started.actionResult.status, "committed", JSON.stringify(started.error));
  assert.equal(started.revision, 1);
  assert.equal(started.meta.session_id, "desktop-one");
  assert.equal(started.segments[0].meta.autoSpeak, true);
  assert.equal(started.state_hint.scene.location, null);
  const duplicateStart = await bridge.startNewGameLifecycle(id);
  assert.equal(duplicateStart.actionResult.modelCalls, 0);
  assert.deepEqual(duplicateStart.segments, []);
  assert.equal(modelInputs.length, 1);
  const proposed = await bridge.runTurn({ ...id, actionId: "describe-opening", baseRevision: 1, text: "我是林安，只留着母亲的记忆，在陈姨所在楼道开始。" });
  assert.equal(proposed.state_hint.opening.phase, "awaiting_confirmation");
  assert.equal(proposed.state_hint.opening.proposal.summary.revision, 2);
  assert.equal(proposed.state_hint.scene.location, null);
  assert.equal(JSON.stringify(proposed.projection).includes("hidden_key"), false);
  await bridge.close({ save_id: id.save_id });
  assert.equal(environment.children[0].exitCode, 0);
  const recoveredProposal = await bridge.recoverCurrentAdventure(id);
  assert.equal(recoveredProposal.projection.revision, 2);
  assert.equal(recoveredProposal.state_hint.opening.phase, "awaiting_confirmation");
  const confirmed = await bridge.runTurn({ ...id, actionId: "confirm-opening", baseRevision: 2, text: "确认，开始吧。" });
  assert.equal(confirmed.state_hint.opening.phase, "ready");
  assert.equal(confirmed.state_hint.scene.location, "楼道");
  const input = { ...id, actionId: "borrow-rice", baseRevision: 3, text: "向陈姨借两袋米，答应明天归还。" };
  const borrowed = await bridge.runTurn(input);
  assert.equal(borrowed.actionResult.status, "committed");
  assert.equal(borrowed.revision, 4);
  assert.equal(borrowed.projection.revision, borrowed.state_hint.revision);
  assert.equal(borrowed.projection.panels.revision, borrowed.revision);
  assert.equal(borrowed.projection.characterPanel.revision, borrowed.revision);
  assert.equal(borrowed.state_hint.inventory.count, 1);
  assert.equal(borrowed.state_hint.active_events.count, 1);
  const repeated = await bridge.runTurn(input, { retry: true });
  assert.equal(repeated.actionResult.modelCalls, 0);
  assert.equal(repeated.meta.autoSpeak, false);
  assert.equal(repeated.history, undefined);
  assert.equal(repeated.projection.history.length, 4);
  assert.equal(modelInputs.length, 4);
  const panel = await bridge.getCurrentSkillPanel({ ...id, revision: 4, panel_ref: "session_inventory", view: "list", field_id: "inventory" });
  assert.equal(panel.revision, 4);
  assert.equal(panel.panel.items[0].title, "袋装米");
  const character = await bridge.getCurrentCharacterPanelEntry({ ...id, revision: 4 });
  assert.equal(character.panel.panelRef, "session_characters");
  const receipt = await bridge.readAction({ ...id, actionId: input.actionId });
  assert.equal(receipt.status, "committed");
  assert.equal(receipt.revision, 4);
  const recovered = await bridge.recoverCurrentAdventure(id);
  assert.equal(recovered.history.length, 4);
  assert.equal(recovered.historyComplete, true);
  assert.equal(recovered.projection.envelope.segments.length, 0);
  assert.equal(recovered.history.every((turn) => turn.autoSpeak === false), true);
  assert.equal(recovered.locked_content.skills.find((skill) => skill.itemId === "story-finale").implementation, "session_finale");
  assert.equal(recovered.locked_content.skills.find((skill) => skill.itemId === "memory-fragment").implementation, "session_memory_fragments");
  const modules = await bridge.listCurrentSkillModules(id);
  assert.equal(modules.modules.length, 1);
  assert.equal(modules.modules[0].hasModule, true);
  assert.equal(modules.modules[0].fields.some((field) => field.id === "fragments"), true);
  assert.equal(modules.pendingCapabilities.some((skill) => skill.itemId === "memory-fragment"), false);
  assert.equal(modules.pendingCapabilities.some((skill) => skill.itemId === "story-finale"), false);
  assert.equal(JSON.stringify(modules).includes("extreme-ending-easter"), false);
  const entries = await fs.readdir(path.join(environment.adventuresRoot, id.save_id));
  assert.equal(entries.includes("session.sqlite"), true);
  assert.equal(entries.some((name) => ["state.json", "meta.json", "save-schema.json", "transcript", "memory"].includes(name)), false);
  const whole = JSON.stringify(modelInputs);
  assert.match(whole, /唯一/);
  await bridge.close();
  await assert.rejects(bridge.readView(id), { code: "SESSION_PROCESS_CLOSED" });
  const resumed = environment.bridge({ generate() { throw new Error("recovery must not call model"); } });
  const view = await resumed.readView(id);
  assert.deepEqual(view.state_hint, recovered.state_hint);
  assert.deepEqual(view.history, recovered.history);
});

test("saving a covered historical revision succeeds without projecting the later chapter into it", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  const bundles = [proposal(), confirmation(), emptyTurn("你在楼道停了一会儿。")];
  let modelCalls = 0;
  const bridge = environment.bridge({ generate(request) {
    modelCalls += 1;
    if (request.messages[0].content.includes("retrospective chapter")) {
      return response({ title: "楼道中的开端", summary: "林安确认身份和起点，开始冒险。",
        keyEvents: [{ text: "林安在楼道开始冒险。", sources: [{ revision: 2, segmentId: "confirmed" }] }], openThreads: [] });
    }
    return response(bundles.shift());
  } });
  const id = { save_id: "test-adventure" };
  await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
  for (const [baseRevision, text] of ["整理我的开局。", "明确确认这份开局。", "站在原地等一会儿。"].entries()) {
    const result = await bridge.runTurn({ ...id, actionId: `turn-${baseRevision}`, baseRevision, text });
    assert.equal(result.actionResult.status, "committed");
  }
  const current = await bridge.commitCurrentSave({ ...id, revision: 3 });
  assert.equal(current.result.chapterStatus, "created");
  assert.deepEqual(current.result.chapter_log.turn_range, { start: 2, end: 3 });
  const past = await bridge.commitCurrentSave({ ...id, revision: 2 });
  assert.equal(past.ok, true);
  assert.equal(past.revision, 2);
  assert.equal(past.result.savedRevision, 2);
  assert.equal(past.result.chapterStatus, "unchanged");
  assert.equal(past.result.chapter_log, null);
  assert.equal(past.result.modelCalls, 0);
  assert.equal(past.result.autoSpeak, false);
  assert.equal(modelCalls, 4);
  assert.deepEqual((await bridge.readChapterLogs({ ...id, revision: 2 })).result.chapters, []);
  assert.equal((await bridge.readChapterLogs({ ...id, revision: 3 })).result.chapters.length, 1);
  assert.equal((await bridge.readView(id)).revision, 3);
});

test("initialization rejects old/mixed formats, existing databases and locale mismatch without overwriting", async (t) => {
  const environment = await setup(t);
  const bridge = environment.bridge();
  for (const marker of ["state.json", "meta.json", "save-schema.json"]) {
    const adventureId = marker.replaceAll(".", "-");
    await environment.compile(adventureId);
    await fs.writeFile(path.join(environment.adventuresRoot, adventureId, marker), "synthetic legacy marker, do not parse");
    await assert.rejects(bridge.initializeFromContentSnapshot({ adventureId, adventureLocale: "zh-CN" }), { code: "SAVE_FORMAT_UNSUPPORTED" });
  }
  await environment.compile();
  await assert.rejects(bridge.initializeFromContentSnapshot({ adventureId: "test-adventure", adventureLocale: "en-US" }), { code: "SAVE_IDENTITY_MISMATCH" });
  const databasePath = path.join(environment.adventuresRoot, "test-adventure", "session.sqlite");
  await assert.rejects(fs.stat(databasePath), { code: "ENOENT" });
  await assert.rejects(bridge.readView({ save_id: "test-adventure" }), { code: "INITIAL_STATE_REQUIRED" });
  assert.equal(environment.processStarts, 0);
  await bridge.initializeFromContentSnapshot({ adventureId: "test-adventure", adventureLocale: "zh-CN" });
  const before = await fs.stat(databasePath);
  await assert.rejects(bridge.initializeFromContentSnapshot({ adventureId: "test-adventure", adventureLocale: "zh-CN" }), { code: "SAVE_ALREADY_EXISTS" });
  assert.equal((await fs.stat(databasePath)).ino, before.ino);
  await bridge.close({ save_id: "test-adventure" });
  await assert.rejects(bridge.initializeFromContentSnapshot({ adventureId: "test-adventure", adventureLocale: "zh-CN" }), { code: "SAVE_ALREADY_EXISTS" });
});

test("concurrent reads share a single owner; close during delayed startup awaits that child and prevents escape", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  const first = environment.bridge();
  await first.initializeFromContentSnapshot({ adventureId: "test-adventure", adventureLocale: "zh-CN" });
  await first.close();
  const reader = environment.bridge();
  const count = environment.processStarts;
  const views = await Promise.all(Array.from({ length: 12 }, () => reader.readView({ save_id: "test-adventure" })));
  assert.equal(views.every((view) => view.revision === 0), true);
  assert.equal(environment.processStarts, count + 1);
  await reader.close();
  const started = deferred();
  const release = deferred();
  let child;
  const delayed = environment.bridge(undefined, { createSessionProcess: async (settings) => {
    const client = await createSessionProcess({ ...settings, spawn(modulePath, args, spawnOptions) {
      child = fork(modulePath, args, spawnOptions); environment.children.push(child); return child;
    } });
    started.resolve();
    await release.promise;
    return client;
  } });
  const opening = delayed.readView({ save_id: "test-adventure" });
  const rejected = assert.rejects(opening, { code: "SESSION_PROCESS_CLOSED" });
  await started.promise;
  const closing = delayed.close();
  await assert.rejects(delayed.readView({ save_id: "test-adventure" }), { code: "SESSION_PROCESS_CLOSED" });
  release.resolve();
  await closing;
  await rejected;
  assert.equal(child.exitCode, 0);
});

test("late recovery cleanup cannot close a child claimed by a newer in-flight desktop recovery", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  const entered = [deferred(), deferred()];
  const release = [deferred(), deferred()];
  let recoveries = 0;
  let starts = 0;
  let closes = 0;
  let modelCalls = 0;
  const bridge = environment.bridge({ generate() { modelCalls++; return response(emptyTurn()); } }, {
    createSessionProcess: async (settings) => {
      starts++;
      const client = await createSessionProcess({ ...settings, spawn(modulePath, args, options) {
        const child = fork(modulePath, args, options); environment.children.push(child); return child;
      } });
      return { ...client,
        async recoverFinale(request) {
          const index = recoveries++;
          if (index < 2) { entered[index].resolve(); await release[index].promise; }
          return client.recoverFinale(request);
        },
        async close() { closes++; await client.close(); },
      };
    },
  });
  const request = { save_id: "test-adventure" };
  await bridge.initializeFromContentSnapshot({ adventureId: request.save_id, adventureLocale: "zh-CN" });
  const abandonedOwner = {};
  const abandoned = bridge.recoverCurrentAdventure({ ...request, recoveryOwner: abandonedOwner });
  await entered[0].promise;
  // A normal Continue Game call supplies no token, but immediately takes its
  // own ownership before awaiting recovery on the same cached real process.
  const newer = bridge.recoverCurrentAdventure(request);
  await entered[1].promise;
  release[0].resolve();
  assert.equal((await abandoned).projection.revision, 0);
  await bridge.close({ ...request, recoveryOwner: abandonedOwner });
  assert.equal(closes, 0);
  assert.equal((await bridge.readView(request)).revision, 0);
  release[1].resolve();
  assert.equal((await newer).projection.revision, 0);
  await bridge.close({ ...request, recoveryOwner: abandonedOwner });
  assert.equal(closes, 0);
  assert.equal(starts, 1);
  assert.equal(modelCalls, 0);
  assert.equal((await bridge.startNewGameLifecycle(request)).actionResult.status, "committed");
  assert.equal(modelCalls, 1);
  // A recovery that still owns the process can clean up its abandoned work.
  const lastOwner = {};
  await bridge.recoverCurrentAdventure({ ...request, recoveryOwner: lastOwner });
  await bridge.close({ ...request, recoveryOwner: lastOwner });
  assert.equal(closes, 1);
  assert.equal(starts, 1);
});

test("failed recovery retains its cleanup ownership and closing first rejects a later recovery", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  let closes = 0;
  const bridge = environment.bridge({ generate() { throw new Error("recovery must not generate"); } }, {
    createSessionProcess: async (settings) => {
      const client = await createSessionProcess(settings);
      return { ...client,
        async recoverFinale() { throw Object.assign(new Error("synthetic failed read"), { code: "VIEW_UNAVAILABLE" }); },
        async close() { closes++; await client.close(); },
      };
    },
  });
  const request = { save_id: "test-adventure" };
  await bridge.initializeFromContentSnapshot({ adventureId: request.save_id, adventureLocale: "zh-CN" });
  const owner = {};
  await assert.rejects(bridge.recoverCurrentAdventure({ ...request, recoveryOwner: owner }), { code: "VIEW_UNAVAILABLE" });
  const closing = bridge.close({ ...request, recoveryOwner: owner });
  await assert.rejects(bridge.recoverCurrentAdventure(request), { code: "SESSION_PROCESS_CLOSED" });
  await closing;
  assert.equal(closes, 1);
});

test("cached sessions remain bound to snapshot identity and the actual database inode", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  let changed = false;
  const bridge = environment.bridge(undefined, { readContentSnapshot: async (options) => {
    const snapshot = await readContentSnapshot(options);
    return changed ? { ...snapshot, lock: { ...snapshot.lock, overallHash: "different-snapshot" } } : snapshot;
  } });
  const id = { save_id: "test-adventure" };
  await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
  changed = true;
  await assert.rejects(bridge.readView(id), { code: "SAVE_IDENTITY_MISMATCH" });
  changed = false;
  const databasePath = path.join(environment.adventuresRoot, id.save_id, "session.sqlite");
  await fs.rename(databasePath, `${databasePath}.held`);
  await assert.rejects(bridge.readView(id), { code: "INITIAL_STATE_REQUIRED" });
  await fs.copyFile(`${databasePath}.held`, databasePath);
  await assert.rejects(bridge.readView(id), { code: "SAVE_IDENTITY_MISMATCH" });
  await fs.rm(databasePath);
  await fs.rename(`${databasePath}.held`, databasePath);
});

test("action IDs stay explicit, failures do not become story, cancellation aborts the real child Provider", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  const begun = deferred();
  const late = deferred();
  let signal;
  let fail = true;
  let calls = 0;
  const bridge = environment.bridge({ generate(request) {
    calls += 1;
    if (fail) throw new Error("fixture-private-key and private stack must never surface");
    signal = request.signal; begun.resolve(); return late.promise;
  } });
  const id = { save_id: "test-adventure" };
  await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
  await assert.rejects(bridge.runTurn({ ...id, text: "开始" }), { code: "SESSION_PAYLOAD_INVALID" });
  await assert.rejects(bridge.runTurn({ ...id, actionId: "start", text: "开始" }), { code: "ACTION_INPUT_INVALID" });
  assert.equal(calls, 0);
  const failed = await bridge.startNewGameLifecycle(id);
  assert.equal(failed.actionResult.status, "failed");
  assert.equal(failed.error.code, "TURN_GENERATION_FAILED");
  assert.equal(failed.meta.ok, false);
  assert.deepEqual(failed.segments, []);
  assert.equal(failed.projection.revision, 0);
  assert.equal(JSON.stringify(failed).includes("fixture-private-key"), false);
  fail = false;
  const running = bridge.runTurn({ ...id, actionId: "cancel-test", baseRevision: 0, text: "继续开局" });
  await begun.promise;
  assert.equal((await bridge.cancelAction({ ...id, actionId: "cancel-test" })).status, "cancelled");
  const cancelled = await running;
  assert.equal(cancelled.actionResult.status, "cancelled");
  assert.equal(signal.aborted, true);
  assert.equal(cancelled.projection.revision, 0);
  late.resolve(response(emptyTurn()));
});

test("history is explicitly paged at one revision and recovery never claims a truncated page is complete", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  const bridge = environment.bridge();
  const id = { save_id: "test-adventure" };
  await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
  for (let revision = 0; revision < 23; revision += 1) {
    const result = await bridge.runTurn({ ...id, actionId: `opening-${revision}`, baseRevision: revision, text: `继续讨论开局 ${revision}` });
    assert.equal(result.actionResult.status, "committed");
  }
  const view = await bridge.readView(id);
  assert.equal(view.history.length, 20);
  assert.equal(view.history[0].revision, 4);
  assert.equal(view.historyComplete, false);
  assert.deepEqual(view.historyNextBeforeRevision, { adventureId: id.save_id, revision: 23, beforeRevision: 4 });
  const page = await bridge.readHistory({ ...id, revision: 23, beforeRevision: view.historyNextBeforeRevision, limit: 2 });
  assert.deepEqual(page.history.map((turn) => turn.revision), [2, 3]);
  assert.equal(page.complete, false);
  assert.equal(page.history.every((turn) => turn.autoSpeak === false), true);
  const first = await bridge.readHistory({ ...id, revision: 23, beforeRevision: page.nextBeforeRevision });
  assert.deepEqual(first.history.map((turn) => turn.revision), [1]);
  assert.equal(first.complete, true);
  const recent = await bridge.loadRecentTranscript(id);
  assert.equal(recent.historyComplete, false);
  await assert.rejects(bridge.readHistory({ ...id, revision: 22, beforeRevision: page.nextBeforeRevision }), { code: "HISTORY_CURSOR_MISMATCH" });
  await assert.rejects(bridge.readView({ ...id, maxCharacters: 1 }), { code: "HISTORY_PAGE_TOO_LARGE" });
  assert.equal((await bridge.readView({ ...id, maxCharacters: 2_000_000 })).revision, 23);
});

test("content story locale stays bound across display locale changes and pending capabilities fail explicitly", async (t) => {
  const environment = await setup(t);
  await environment.compile("english-adventure", "en-US");
  let currentDisplayLocale = "ja-JP";
  let modelRequest;
  const bridge = environment.bridge({ generate(request) { modelRequest = request; return response(emptyTurn("Tell me about your character.")); } },
    { displayLocale: () => currentDisplayLocale });
  const id = { save_id: "english-adventure" };
  await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "en-US" });
  const opening = await bridge.startNewGameLifecycle(id);
  assert.equal(opening.actionResult.status, "committed");
  assert.equal(opening.projection.save.adventureLocale, "en-US");
  assert.equal(opening.projection.characterPanel.panel.title, "人物");
  assert.equal(opening.projection.history.length, 0);
  assert.match(JSON.stringify(modelRequest.messages), /Begin a new Adventure\./);
  currentDisplayLocale = "en-US";
  assert.equal((await bridge.getCurrentCharacterPanelEntry(id)).panel.title, "Characters");
  assert.equal((await bridge.readView(id)).history[0].host, "Tell me about your character.");
  const beforeSave = modelRequest;
  const saved = await bridge.commitCurrentSave({ ...id, revision: 1 });
  assert.equal(saved.ok, true);
  assert.equal(saved.revision, 1);
  assert.equal(saved.result.saved, true);
  assert.equal(saved.result.error.code, "CHAPTER_NOT_READY");
  assert.equal(saved.result.modelCalls, 0);
  assert.equal(saved.result.autoSpeak, false);
  assert.equal(modelRequest, beforeSave);
  const chapters = await bridge.readChapterLogs({ ...id, revision: 1 });
  assert.deepEqual(chapters.result.chapters, []);
  assert.equal(chapters.result.complete, true);
  assert.equal(chapters.result.autoSpeak, false);
  const compact = await bridge.compactCurrentContext({ ...id, requestId: "nothing-to-compact", revision: 1 });
  assert.equal(compact.compaction.status, "not_needed");
  assert.equal(compact.compaction.modelCalls, 0);
  assert.equal(modelRequest, beforeSave);
  const modules = await bridge.listCurrentSkillModules(id);
  const module = await bridge.getCurrentSkillModule({ ...id, revision: 1, module_ref: modules.modules[0].moduleRef });
  assert.equal(module.revision, 1);
  assert.equal(module.module.hasModule, true);
  assert.equal(modelRequest, beforeSave);
  assert.equal(bridge.repairCurrentSave, undefined, "retired repair execution is not exposed by the session bridge");
  assert.throws(() => createSessionDesktopBridge({ adventuresRoot: environment.adventuresRoot, provider: { generate() {} },
    sessionOptions: { databasePath: "/forbidden/override.sqlite" } }), { code: "SESSION_OPTIONS_INVALID" });
});

test("a committed result with unavailable projection stays committed and never displays its old base state", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  let calls = 0;
  const bridge = environment.bridge({ generate() { calls += 1; return response(emptyTurn()); } }, {
    createSessionProcess: async (settings) => {
      const client = await createSessionProcess(settings);
      return { ...client, async runAction(request, options) {
        const outcome = await client.runAction(request, options);
        const { view, ...receipt } = outcome;
        return { ...receipt, error: { code: "VIEW_UNAVAILABLE" } };
      } };
    },
  });
  const id = { save_id: "test-adventure" };
  await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
  const result = await bridge.startNewGameLifecycle(id);
  assert.equal(result.actionResult.status, "committed");
  assert.equal(result.error.code, "VIEW_UNAVAILABLE");
  assert.equal(result.meta.recoveryRequired, true);
  assert.equal(result.projection, null);
  assert.equal(result.state_hint, null);
  assert.deepEqual(result.segments, []);
  const receipt = await bridge.readAction({ ...id, actionId: "opening-start" });
  assert.equal(receipt.revision, 1);
  const recovered = await bridge.readView({ ...id, revision: receipt.revision });
  assert.equal(recovered.revision, 1);
  assert.equal(recovered.history[0].host, emptyTurn().narration[0].text);
  assert.equal(calls, 1);
});

test("new snapshots retain the reviewed host and world titles across Chinese, English and Japanese recovery", async (t) => {
  const environment = await setup(t);
  const titles = {
    "zh-CN": ["灰鸦主持人", "上海·爆发后第十天"],
    "en-US": ["Grey Crow Host", "Shanghai · Day Ten After the Outbreak"],
    "ja-JP": ["灰鴉ホスト", "上海・感染爆発から十日目"],
  };
  const bridge = environment.bridge({ generate() { throw new Error("metadata recovery must not call a model"); } }, { displayLocale: "ja-JP" });
  for (const [language, [hostTitle, worldTitle]] of Object.entries(titles)) {
    const adventureId = `titles-${language}`;
    await environment.compile(adventureId, language);
    const snapshot = await readContentSnapshot({ adventuresRoot: environment.adventuresRoot, adventureId });
    assert.equal(snapshot.profile.host.title, hostTitle);
    assert.equal(snapshot.profile.world.title, worldTitle);
    assert.equal(snapshot.lock.items.find((item) => item.itemType === "world").title, worldTitle);
    await bridge.initializeFromContentSnapshot({ adventureId, adventureLocale: language });
    await bridge.close({ save_id: adventureId });
    const recovered = await bridge.recoverCurrentAdventure({ save_id: adventureId });
    assert.equal(recovered.locked_content.host.title, hostTitle);
    assert.equal(recovered.locked_content.world.title, worldTitle);
    assert.equal(recovered.locked_content.language, language);
  }
});

test("snapshot title metadata is integrity checked while earlier snapshots without titles still open", async (t) => {
  const environment = await setup(t);
  const adventureId = "title-integrity";
  await environment.compile(adventureId);
  const root = path.join(environment.adventuresRoot, adventureId);
  const profilePath = path.join(root, "content-profile.json");
  const lockPath = path.join(root, "content-snapshot", "manifest.lock.json");
  const originalProfile = JSON.parse(await fs.readFile(profilePath, "utf8"));
  const originalLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  const write = async (target, value) => {
    await fs.chmod(target, 0o600);
    await fs.writeFile(target, JSON.stringify(value));
    await fs.chmod(target, 0o400);
  };
  const profile = structuredClone(originalProfile);
  profile.world.title = "an unconfirmed replacement title";
  await write(profilePath, profile);
  await assert.rejects(readContentSnapshot({ adventuresRoot: environment.adventuresRoot, adventureId }), { code: "SNAPSHOT_ITEM_MISMATCH" });
  await write(profilePath, originalProfile);
  const lock = structuredClone(originalLock);
  lock.items.find((item) => item.itemType === "world").title = "an unconfirmed replacement title";
  await write(lockPath, lock);
  await assert.rejects(readContentSnapshot({ adventuresRoot: environment.adventuresRoot, adventureId }), { code: "SNAPSHOT_LOCK_HASH_MISMATCH" });

  // Construct the previous optional-field shape in this temporary fixture. The
  // reader compares complete item metadata; title absence is not corruption.
  const oldProfile = structuredClone(originalProfile);
  const oldLock = structuredClone(originalLock);
  for (const item of [oldProfile.host, oldProfile.world, oldProfile.newGameSkill, ...oldProfile.skills, ...oldLock.items]) delete item.title;
  const { schemaVersion, lockId, profileId, createdAt, overallHash, ...basis } = oldLock;
  oldLock.overallHash = hashCanonical(basis);
  await write(profilePath, oldProfile);
  await write(lockPath, oldLock);
  assert.equal((await readContentSnapshot({ adventuresRoot: environment.adventuresRoot, adventureId })).profile.world.title, undefined);
  const bridge = environment.bridge();
  await bridge.initializeFromContentSnapshot({ adventureId, adventureLocale: "zh-CN" });
  await bridge.close({ save_id: adventureId });
  const recovered = await bridge.recoverCurrentAdventure({ save_id: adventureId });
  assert.equal(recovered.projection.revision, 0);
  assert.equal(recovered.locked_content.world.title, "Shanghai Day 10 World Card");
});

for (const wholeBridge of [false, true]) {
  test(`${wholeBridge ? "bridge" : "adventure"} close wins over a following UI abort and preserves explicit interrupted retry`, async (t) => {
    const environment = await setup(t);
    await environment.compile();
    const begun = deferred();
    const late = deferred();
    let calls = 0;
    let providerSignal;
    const provider = { generate(request) {
      calls += 1;
      if (calls !== 1) return response(emptyTurn("重试之后继续讨论开局。"));
      providerSignal = request.signal;
      begun.resolve();
      return late.promise;
    } };
    const bridge = environment.bridge(provider);
    const id = { save_id: "test-adventure" };
    await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
    const input = { ...id, actionId: "close-before-abort", baseRevision: 0, text: "继续讨论开局。" };
    const controller = new AbortController();
    const stopped = assert.rejects(bridge.runTurn(input, { signal: controller.signal }), { code: "SESSION_PROCESS_CLOSED" });
    await begun.promise;
    const closing = wholeBridge ? bridge.close() : bridge.close(id);
    controller.abort("settings_changed");
    await closing;
    await stopped;
    assert.equal(providerSignal.aborted, true);
    assert.equal(environment.children[0].exitCode, 0);
    const reader = wholeBridge ? environment.bridge(provider) : bridge;
    const interrupted = await reader.readAction({ ...id, actionId: input.actionId });
    assert.equal(interrupted.status, "interrupted");
    assert.equal(interrupted.error.code, "PROCESS_INTERRUPTED");
    assert.equal((await reader.readView(id)).revision, 0);
    assert.equal(calls, 1);
    const withoutRetry = await reader.runTurn(input);
    assert.equal(withoutRetry.actionResult.status, "interrupted");
    assert.equal(withoutRetry.actionResult.modelCalls, 0);
    const retried = await reader.runTurn(input, { retry: true });
    assert.equal(retried.actionResult.status, "committed");
    assert.equal(retried.revision, 1);
    assert.notEqual(retried.actionResult.attemptId, interrupted.attemptId);
    assert.equal(calls, 2);
    late.resolve(response(emptyTurn("旧尝试的迟到结果不能保存。")));
    const final = await reader.readView(id);
    assert.equal(final.revision, 1);
    assert.equal(final.history.length, 1);
    assert.equal(final.history[0].host, "重试之后继续讨论开局。");
  });
}

test("a player abort before close remains terminal cancellation after reopening", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  const begun = deferred();
  const late = deferred();
  let calls = 0;
  const bridge = environment.bridge({ generate() { calls += 1; begun.resolve(); return late.promise; } });
  const id = { save_id: "test-adventure" };
  await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
  const input = { ...id, actionId: "abort-before-close", baseRevision: 0, text: "这轮不继续了。" };
  const controller = new AbortController();
  const stopped = assert.rejects(bridge.runTurn(input, { signal: controller.signal }), { code: "SESSION_PROCESS_CLOSED" });
  await begun.promise;
  controller.abort("player_cancelled");
  await bridge.close(id);
  await stopped;
  assert.equal((await bridge.readAction({ ...id, actionId: input.actionId })).status, "cancelled");
  const repeated = await bridge.runTurn(input, { retry: true });
  assert.equal(repeated.actionResult.status, "cancelled");
  assert.equal(repeated.actionResult.modelCalls, 0);
  assert.equal(calls, 1);
  late.resolve(response(emptyTurn()));
  assert.equal((await bridge.readView(id)).revision, 0);
});

test("a signal aborted before invocation cancels without any Provider call", async (t) => {
  const environment = await setup(t);
  await environment.compile();
  let calls = 0;
  const bridge = environment.bridge({ generate() { calls += 1; return response(emptyTurn()); } });
  const id = { save_id: "test-adventure" };
  await bridge.initializeFromContentSnapshot({ adventureId: id.save_id, adventureLocale: "zh-CN" });
  const controller = new AbortController();
  controller.abort("player_cancelled");
  const result = await bridge.runTurn({ ...id, actionId: "already-cancelled", baseRevision: 0, text: "不执行这次行动。" },
    { signal: controller.signal });
  assert.equal(result.actionResult.status, "cancelled");
  assert.equal(result.actionResult.modelCalls, 0);
  assert.equal(result.projection.revision, 0);
  assert.equal(calls, 0);
});

test("recovery seals an already committed final chapter without a model, then opens the same story through the readonly reader", async (t) => {
  const { createTurnStore } = require("../session/turn-store");
  const { createOpeningState } = require("../session/session-opening");
  const { createSessionArchiveReader } = require("../session/session-archive");
  const environment = await setup(t);
  await environment.compile();
  const adventureId = "test-adventure";
  const snapshot = await readContentSnapshot({ adventuresRoot: environment.adventuresRoot, adventureId });
  const adventureRoot = path.join(environment.adventuresRoot, adventureId);
  const databasePath = path.join(adventureRoot, "session.sqlite");
  const store = createTurnStore({ databasePath, adventureId, locale: "zh-CN", contentVersion: snapshot.lock.overallHash,
    initialState: createOpeningState() });
  const offer = { narration: [{ id: "ask-finale", text: "旅程可以暂告结束。你愿意让故事停在这里吗？" }],
    events: [{ id: "offer-finale", type: "finale.propose", sourceSegmentIds: ["ask-finale"], data: {
      candidateId: "ending-one", closureReason: "PRIVATE_FINALE_REASON_PRESEAL", closedThreads: ["同行者已经道别。"],
      intentionalOpenThreads: ["归还两袋米的约定仍然开放。"], finaleTone: "克制" } }], experiences: [] };
  const ending = { narration: [{ id: "last", text: "你确认在这里结束这段故事，向陈姨道别；归还米的约定依然留在心里。" }],
    events: [{ id: "confirm-finale", type: "finale.confirm", sourceSegmentIds: ["last"], data: { candidateId: "ending-one" } }], experiences: [] };
  const bundles = [proposal(), confirmation(), borrowBundle(), offer, ending];
  const inputs = ["我是林安，记住母亲，在楼道开始。", "我确认这个开局。", "借两袋米，明天归还。", "大家在这里道别。", "是的，让故事在这里结束。"];
  let committedChapter;
  try {
    for (const [index, bundle] of bundles.entries()) {
      const action = store.beginAction({ actionId: `preseal-${index + 1}`, baseRevision: index,
        input: inputs[index], locale: "zh-CN", contentVersion: snapshot.lock.overallHash });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
    }
    const job = store.beginChapter({ targetRevision: 5 });
    const receipt = store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: {
      title: "道别之后", summary: "你选择结束这一段旅程，归还两袋米的约定仍待履行。",
      keyEvents: [{ text: "你向陈姨道别。", sources: [{ revision: 5, segmentId: "last" }] }],
      openThreads: [{ text: "归还米的约定仍待履行。", sources: [{ revision: 3, segmentId: "borrow-text" }] }], mode: "model",
    } });
    committedChapter = receipt.chapter;
    assert.equal(store.readFinale().archive.status, "pending");
    assert.equal(store.readFinale().chapterJob.status, "committed");
    assert.equal(store.readView().revision, 5);
    assert.equal(store.readAction("preseal-5").status, "committed");
  } finally { store.close(); }

  const reader = createSessionArchiveReader({ adventuresRoot: environment.adventuresRoot });
  await assert.rejects(reader.open({ adventureId }), { code: "ARCHIVE_NOT_CLOSED" });
  let modelCalls = 0;
  const bridge = environment.bridge({ generate() { modelCalls++; throw new Error("recovery must not generate a chapter or repeat a turn"); } });
  const recovered = await bridge.recoverCurrentAdventure({ save_id: adventureId });
  assert.equal(recovered.storyFinale.projection.phase, "closed");
  assert.equal(recovered.storyFinale.projection.inputAllowed, false);
  assert.equal(recovered.projection.revision, 5);
  assert.equal(recovered.historyComplete, true);
  assert.equal(recovered.history.length, 5);
  assert.deepEqual(recovered.history.map((turn) => turn.player), inputs);
  assert.deepEqual(recovered.history.map((turn) => turn.host), bundles.map((bundle) => bundle.narration.map((segment) => segment.text).join("\n\n")));
  assert.deepEqual(recovered.projection.envelope.segments, []);
  assert.equal(recovered.history.every((turn) => turn.autoSpeak === false), true);
  const recoveredAgain = await bridge.recoverCurrentAdventure({ save_id: adventureId });
  assert.deepEqual(recoveredAgain.history, recovered.history);
  assert.doesNotMatch(JSON.stringify([recovered, recoveredAgain]), /PRIVATE_FINALE_REASON_PRESEAL|closureReason/);
  assert.equal(modelCalls, 0);
  assert.equal(environment.processStarts, 1);
  await bridge.close();

  // This direct bridge test does not exercise Main's CONTINUE_GAME branch. It
  // checks the handoff only after explicitly closing the bridge ourselves.
  const beforeBytes = await fs.readFile(databasePath);
  const beforeStat = await fs.stat(databasePath);
  const beforeEntries = (await fs.readdir(adventureRoot)).sort();
  const archived = await reader.open({ adventureId });
  assert.deepEqual(archived.archive, { mode: "archive", read_only: true });
  assert.equal(archived.storyFinale.projection.phase, "closed");
  assert.equal(archived.projection.revision, 5);
  assert.deepEqual(archived.projection.history, recovered.history);
  assert.equal(archived.projection.historyComplete, true);
  assert.deepEqual(archived.projection.envelope.segments, []);
  assert.equal(archived.chapterPage.complete, true);
  assert.equal(archived.chapterPage.chapters.length, 1);
  const chapter = archived.chapterPage.chapters[0];
  assert.equal(chapter.chapter_id, committedChapter.chapterId);
  assert.equal(chapter.createdAt, committedChapter.createdAt);
  assert.equal(chapter.title, committedChapter.title);
  assert.equal(chapter.summary, committedChapter.summary);
  assert.deepEqual(chapter.turn_range, { start: 2, end: 5 });
  assert.deepEqual(chapter.sources.open_threads, committedChapter.openThreads);
  assert.equal(archived.projection.state_hint.inventory.count, 1);
  assert.equal(archived.projection.state_hint.active_events.count, 1);
  assert.doesNotMatch(JSON.stringify(archived), /hidden_key|尚未露面的访客|closureReason|PRIVATE_FINALE_REASON_PRESEAL/);
  assert.equal(modelCalls, 0);
  assert.equal(environment.processStarts, 1, "the readonly archive reader never opens another runtime");
  assert.deepEqual(await fs.readFile(databasePath), beforeBytes);
  const afterStat = await fs.stat(databasePath);
  assert.deepEqual([afterStat.ino, afterStat.mode, afterStat.size, afterStat.mtimeMs],
    [beforeStat.ino, beforeStat.mode, beforeStat.size, beforeStat.mtimeMs]);
  assert.deepEqual((await fs.readdir(adventureRoot)).sort(), beforeEntries);
  assert.equal(hashCanonical(await readContentSnapshot({ adventuresRoot: environment.adventuresRoot, adventureId })), hashCanonical(snapshot));
});

test("fresh confirmation, duplicate receipt and explicit finale resume never expose private candidate reasoning", async (t) => {
  const { createTurnStore } = require("../session/turn-store");
  const { createOpeningState } = require("../session/session-opening");
  const environment = await setup(t);
  await environment.compile();
  const adventureId = "test-adventure";
  const snapshot = await readContentSnapshot({ adventuresRoot: environment.adventuresRoot, adventureId });
  const store = createTurnStore({ databasePath: path.join(environment.adventuresRoot, adventureId, "session.sqlite"),
    adventureId, locale: "zh-CN", contentVersion: snapshot.lock.overallHash, initialState: createOpeningState() });
  const offer = { narration: [{ id: "ask", text: "你愿意让故事在这里结束吗？" }],
    events: [{ id: "offer", type: "finale.propose", sourceSegmentIds: ["ask"], data: { candidateId: "private-ending",
      closureReason: "PRIVATE_FINALE_REASON_RECEIPT", closedThreads: ["PRIVATE_FINALE_THREAD_RECEIPT"],
      intentionalOpenThreads: [], finaleTone: "PRIVATE_FINALE_TONE_RECEIPT" } }], experiences: [] };
  try {
    for (const [index, bundle] of [proposal(), confirmation(), offer].entries()) {
      const action = store.beginAction({ actionId: `private-seed-${index + 1}`, baseRevision: index,
        input: ["我描述自己的身份与起点。", "我确认这个开局。", "这段旅程已经抵达终点。 "][index],
        locale: "zh-CN", contentVersion: snapshot.lock.overallHash });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
    }
    assert.equal(store.readModelState().finale.candidate.closureReason, "PRIVATE_FINALE_REASON_RECEIPT");
  } finally { store.close(); }
  const ending = { narration: [{ id: "last", text: "你向陈姨道别，让这一段故事在晨光中结束。" }],
    events: [{ id: "confirm", type: "finale.confirm", sourceSegmentIds: ["last"], data: { candidateId: "private-ending" } }], experiences: [] };
  const chapter = { title: "晨光中的道别", summary: "你选择在道别后结束故事。",
    keyEvents: [{ text: "你向陈姨道别。", sources: [{ revision: 4, segmentId: "last" }] }], openThreads: [] };
  let modelCalls = 0;
  const bridge = environment.bridge({ generate() { return response([ending, chapter][modelCalls++]); } });
  const input = { save_id: adventureId, actionId: "private-confirm", baseRevision: 3, text: "我愿意，让故事在这里结束。" };
  const fresh = await bridge.runTurn(input);
  assert.equal(fresh.actionResult.status, "committed");
  assert.equal(fresh.actionResult.finalization, undefined);
  assert.deepEqual(fresh.derivedWork, { kind: "finale", actionId: input.actionId, revision: 4, trigger: "finale" });
  assert.equal(modelCalls, 1);
  assert.equal(fresh.actionResult.view, undefined);
  assert.deepEqual(fresh.segments.map((segment) => segment.content), [ending.narration[0].text]);
  const duplicate = await bridge.runTurn(input, { retry: true });
  assert.equal(duplicate.actionResult.status, "committed");
  assert.equal(duplicate.actionResult.modelCalls, 0);
  assert.equal(duplicate.actionResult.view, undefined);
  assert.deepEqual(duplicate.segments, []);
  assert.equal(duplicate.derivedWork, undefined);
  const derived = await bridge.completeTurnDerived({ save_id: adventureId, ...fresh.derivedWork });
  assert.equal(derived.finalization.status, "closed");
  assert.equal(derived.finalization.chapterWork.modelCalls, 1);
  assert.equal(derived.finalization.chapterWork.mode, "model");
  assert.deepEqual(derived.finalization.chapterWork.usage, { input_tokens: 50, output_tokens: 60 });
  assert.equal(derived.finalization.chapterWork.usageComplete, true);
  assert.equal(derived.envelope, undefined); assert.equal(derived.autoSpeak, false);
  assert.deepEqual(derived.projection.envelope.segments, []);
  const resumed = await bridge.resumeFinalization({ save_id: adventureId, revision: 4 });
  assert.equal(resumed.finalization.status, "closed");
  assert.equal(resumed.finalization.finale, undefined);
  assert.equal(resumed.storyFinale.projection.phase, "closed");
  assert.deepEqual(resumed.projection.envelope.segments, []);
  // Inspect the entire IPC-facing response, not only the visible projection:
  // raw actionResult.view/finalization used to bypass the projection boundary.
  for (const result of [fresh, duplicate, derived, resumed]) {
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FINALE_|closureReason|closedThreads|intentionalOpenThreads|finaleTone/);
  }
  assert.equal(modelCalls, 2, "only the new confirmation and its chapter used the synthetic Provider");
});

async function seedChapterSettings(t, turns = 19, repetitions = 1) {
  const env = await setup(t);
  await env.compile();
  const adventureId = "test-adventure";
  const snapshot = await readContentSnapshot({ adventuresRoot: env.adventuresRoot, adventureId });
  const identity = { databasePath: path.join(env.adventuresRoot, adventureId, "session.sqlite"), adventureId,
    locale: "zh-CN", contentVersion: snapshot.lock.overallHash };
  const { createTurnStore } = require("../session/turn-store");
  const store = createTurnStore({ ...identity, initialState: initialState() });
  try {
    for (let revision = 1; revision <= turns; revision++) {
      const action = store.beginAction({ actionId: `seed-${revision}`, baseRevision: revision - 1, input: "我观察楼道。",
        locale: identity.locale, contentVersion: identity.contentVersion });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
        bundle: { narration: [{ id: "seen", text: "林安站在楼道中，观察窗边和屋门，没有改变任何物品。".repeat(repetitions) }], events: [], experiences: [] } });
    }
  } finally { store.close(); }
  const calls = { story: 0, chapter: 0, compaction: 0 };
  const provider = { async generate(request) {
    let data;
    try { data = JSON.parse(request.messages[1].content); } catch { /* Story context is quoted in its own messages. */ }
    if (["summarize_chapter", "merge_chapter"].includes(data?.task)) {
      calls.chapter++;
      const source = data.sources?.[0] || data.parts?.[0]?.keyEvents?.[0]?.sources?.[0];
      return response({ title: "楼道里的片刻", summary: "林安观察了楼道。", keyEvents: [{ text: "林安观察了楼道。",
        sources: [{ revision: source.revision, segmentId: source.segmentId }] }], openThreads: [] });
    }
    if (data?.task?.includes("context")) {
      calls.compaction++;
      const quote = data.quoteCandidates?.[0] || data.parts?.[0]?.items?.[0];
      assert.ok(quote?.quoteId, "compaction must supply a program-generated source quote");
      return response({ selectedQuoteIds: [quote.quoteId] });
    }
    calls.story++;
    return response(emptyTurn("林安再望了一眼楼道。"));
  } };
  return { ...env, get processStarts() { return env.processStarts; }, identity, calls, provider, id: { save_id: adventureId },
    request: { save_id: adventureId, actionId: `next-${turns + 1}`, baseRevision: turns, text: "我再看一眼。" } };
}
const chapterPreferences = (patch = {}) => ({ chapterLog: { onManualSave: true, onAutoSave: true, onCompaction: true, intervalTurns: 20, ...patch } });
// These cases exercise chapter scheduling with the complete locked content and
// 19 uncompressed turns, not the legacy default 48k character safety cap.
const chapterStoryOptions = { contextPolicy: { configuredContextWindow: 128000, autoCompactRatio: 0.75 } };
async function assertChapterStoryFits(bridge, env) {
  const usage = await bridge.readContextUsage({ ...env.id, revision: env.request.baseRevision, input: env.request.text });
  assert.equal(usage.fits, true, JSON.stringify({ reason: usage.limitingReason, estimate: usage.latestEstimate }));
  assert.ok(usage.latestEstimate.safetyInputTokens < usage.policy.autoCompactLimit, "this scheduling fixture must not trigger automatic compaction");
  assert.equal(env.calls.story, 0); assert.equal(env.calls.compaction, 0);
}

async function measureAutomaticChapterContext(env, options) {
  const { createTurnStore } = require("../session/turn-store");
  const { createTurnMemory } = require("../session/turn-memory");
  const { createTurnGenerator } = require("../session/turn-generator");
  const { createSkillLocaleResolver } = require("../content-v2/skill-locale-resolver");
  const snapshot = await readContentSnapshot({ adventuresRoot: env.adventuresRoot, adventureId: env.identity.adventureId });
  const resolved = await createSkillLocaleResolver({ snapshotLoader: async () => snapshot }).resolveCurrent({ adventureId: env.identity.adventureId });
  const store = createTurnStore(env.identity);
  try {
    const generator = createTurnGenerator({ ...env.identity, ...options, store, memory: createTurnMemory({ store }),
      provider: { generate() { throw new Error("Context planning must not call a Provider"); } }, compactionAvailable: true,
      hostText: snapshot.content.host, worldText: snapshot.content.world, openingText: resolved.newGameSkill.body,
      finaleText: resolved.skills.find((skill) => skill.itemId === "story-finale")?.body || "",
      extremeText: resolved.skills.find((skill) => skill.itemId === "extreme-ending-easter")?.body || "",
      memoryFragmentText: resolved.skills.find((skill) => skill.packId === "grey-crow-default" && skill.itemId === "memory-fragment")?.body || "" });
    return await generator.readCompactionPlan({ revision: env.request.baseRevision, input: env.request.text });
  } finally { store.close(); }
}

test("save preferences hot-update without a new child; disabled manual saves and reads perform zero chapter calls", async (t) => {
  const env = await seedChapterSettings(t, 2);
  const bridge = env.bridge(env.provider, { saveSettings: chapterPreferences({ onManualSave: false, onAutoSave: false }) });
  assert.equal((await bridge.commitCurrentSave({ ...env.id, revision: 2 })).result.chapterStatus, "disabled");
  assert.equal(env.processStarts, 1);
  const config = chapterPreferences();
  assert.deepEqual(bridge.updateSaveSettings(config), config);
  config.chapterLog.onManualSave = false;
  const saved = await bridge.commitCurrentSave({ ...env.id, revision: 2 });
  assert.equal(saved.result.chapterStatus, "created"); assert.equal(env.calls.chapter, 1);
  assert.equal((await bridge.commitCurrentSave({ ...env.id, revision: 2 })).result.chapterStatus, "unchanged");
  bridge.updateSaveSettings(chapterPreferences({ onManualSave: false }));
  assert.equal((await bridge.commitCurrentSave({ ...env.id, revision: 2 })).result.modelCalls, 0);
  await bridge.recoverCurrentAdventure(env.id);
  assert.equal(env.calls.chapter, 1); assert.equal(env.calls.story, 0); assert.equal(env.processStarts, 1);
  assert.throws(() => bridge.updateSaveSettings({ autoSave: { enabled: false } }), { code: "SAVE_SETTINGS_INVALID" });
  assert.throws(() => bridge.updateSaveSettings(chapterPreferences({ intervalTurns: 1 })), { code: "SAVE_SETTINGS_INVALID" });
});

test("a fresh interval commit returns before the separate chapter; duplicate delivery and restart never repeat derived model work", async (t) => {
  const env = await seedChapterSettings(t);
  const started = deferred(), release = deferred();
  t.after(() => release.resolve());
  const bridge = env.bridge({ async generate(request) {
    if (request.messages[1]?.content.includes('"summarize_chapter"')) { started.resolve(); await release.promise; }
    return env.provider.generate(request);
  } }, { saveSettings: chapterPreferences(), sessionOptions: chapterStoryOptions });
  await assertChapterStoryFits(bridge, env);
  const first = await bridge.runTurn(env.request);
  assert.equal(first.actionResult.status, "committed", JSON.stringify(first.actionResult.error)); assert.equal(first.projection.revision, 20);
  assert.deepEqual(first.derivedWork, { kind: "chapter", actionId: env.request.actionId, revision: 20, trigger: "interval" });
  assert.equal(first.chapterSummary, undefined); assert.equal(env.calls.chapter, 0);
  assert.equal(first.segments[0].content, "林安再望了一眼楼道。");
  const pending = bridge.completeTurnDerived({ ...env.id, ...first.derivedWork });
  await Promise.race([started.promise, pending.then(() => assert.fail("chapter must wait for the synthetic response"))]);
  assert.equal((await bridge.recoverCurrentAdventure(env.id)).projection.revision, 20);
  release.resolve();
  const completed = await pending;
  assert.equal(completed.chapterSummary.trigger, "interval"); assert.equal(completed.chapterSummary.chapterStatus, "created");
  assert.equal(completed.chapterSummary.autoSpeak, false); assert.equal(env.calls.chapter, 1);
  assert.equal(completed.autoSpeak, false); assert.equal(completed.envelope, undefined); assert.equal(completed.segments, undefined);
  const repeated = await bridge.runTurn(env.request);
  assert.equal(repeated.actionResult.modelCalls, 0); assert.equal(repeated.chapterSummary, undefined);
  assert.equal(repeated.derivedWork, undefined);
  assert.equal(repeated.meta.autoSpeak, false); assert.equal(env.calls.story, 1); assert.equal(env.calls.chapter, 1);
  await bridge.close();
  const restarted = env.bridge(env.provider, { saveSettings: chapterPreferences(), sessionOptions: chapterStoryOptions });
  assert.equal((await restarted.recoverCurrentAdventure(env.id)).projection.revision, 20);
  assert.equal((await restarted.readChapterLogs({ ...env.id, revision: 20 })).result.chapters.length, 1);
  assert.equal(env.calls.story, 1); assert.equal(env.calls.chapter, 1);
  const checkedAgain = await restarted.completeTurnDerived({ ...env.id, ...first.derivedWork });
  assert.equal(checkedAgain.chapterSummary.chapterStatus, "unchanged");
  assert.equal(checkedAgain.chapterSummary.modelCalls, 0); assert.equal(env.calls.chapter, 1);
});

test("automatic chapter failure preserves the exact committed story and is not retried by duplicate delivery", async (t) => {
  const env = await seedChapterSettings(t);
  const bridge = env.bridge({ generate(request) {
    if (request.messages[1]?.content.includes('"summarize_chapter"')) {
      env.calls.chapter++;
      return new Promise((resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("PRIVATE_CHAPTER_PROVIDER_ERROR")), { once: true }));
    }
    return env.provider.generate(request);
  } }, { saveSettings: chapterPreferences(), sessionOptions: { ...chapterStoryOptions, timeoutMs: 150 } });
  await assertChapterStoryFits(bridge, env);
  const first = await bridge.runTurn(env.request);
  assert.equal(first.actionResult.status, "committed"); assert.equal(first.meta.ok, true); assert.equal(first.projection.revision, 20);
  assert.equal(first.segments[0].content, "林安再望了一眼楼道。");
  assert.equal(env.calls.chapter, 0);
  const derived = await bridge.completeTurnDerived({ ...env.id, ...first.derivedWork });
  assert.ok(["failed", "interrupted"].includes(derived.chapterSummary.chapterStatus));
  assert.doesNotMatch(JSON.stringify(derived), /PRIVATE_CHAPTER_PROVIDER_ERROR/);
  const calls = env.calls.chapter;
  const again = await bridge.runTurn(env.request);
  assert.equal(again.projection.revision, 20); assert.equal(again.chapterSummary, undefined);
  assert.equal(again.derivedWork, undefined);
  await bridge.recoverCurrentAdventure(env.id);
  assert.equal(env.calls.chapter, calls); assert.equal(env.calls.story, 1);
});

test("an unstarted derived plan survives an explicit completion after restart and rejects mismatched or accessor identities", async (t) => {
  const env = await seedChapterSettings(t);
  const options = { saveSettings: chapterPreferences(), sessionOptions: chapterStoryOptions };
  const bridge = env.bridge(env.provider, options);
  const first = await bridge.runTurn(env.request);
  assert.equal(first.actionResult.status, "committed"); assert.equal(env.calls.chapter, 0);
  await bridge.close();
  const reader = env.bridge(env.provider, options);
  const recovered = await reader.recoverCurrentAdventure(env.id);
  assert.equal(recovered.projection.revision, 20);
  assert.deepEqual((await reader.readChapterLogs({ ...env.id, revision: 20 })).result.chapters, []);
  assert.equal(env.calls.chapter, 0); assert.equal(env.calls.story, 1);
  const work = { ...env.id, ...first.derivedWork };
  for (const invalid of [
    { ...work, actionId: "not-committed" }, { ...work, revision: 19 },
    { ...work, actionId: "seed-19" }, { ...work, kind: "finale", trigger: "finale" },
  ]) await assert.rejects(reader.completeTurnDerived(invalid), { code: "SAVE_IDENTITY_MISMATCH" });
  for (const invalid of [
    { ...work, revision: 0 }, { ...work, trigger: "manual" }, { ...work, retry: true },
    { ...work, kind: "unknown" }, { ...work, input: "do not execute" },
  ]) await assert.rejects(reader.completeTurnDerived(invalid), { code: "SESSION_PAYLOAD_INVALID" });
  let getterCalls = 0;
  const accessor = { ...work };
  Object.defineProperty(accessor, "actionId", { enumerable: true, get() { getterCalls++; return work.actionId; } });
  await assert.rejects(reader.completeTurnDerived(accessor), { code: "SESSION_PAYLOAD_INVALID" });
  assert.equal(getterCalls, 0); assert.equal(env.calls.chapter, 0); assert.equal(env.calls.story, 1);
  const duplicate = await reader.runTurn(env.request);
  assert.equal(duplicate.derivedWork, undefined); assert.equal(duplicate.actionResult.modelCalls, 0);
  const completed = await reader.completeTurnDerived(work);
  assert.equal(completed.chapterSummary.chapterStatus, "created");
  assert.equal(completed.actionId, work.actionId); assert.equal(completed.revision, work.revision);
  assert.equal(env.calls.chapter, 1); assert.equal(env.calls.story, 1);
});

for (const onCompaction of [false, true]) {
  test(`manual compaction with chapter preference ${onCompaction} uses exact revision and never repeats the chapter on query or restart`, async (t) => {
    const env = await seedChapterSettings(t, 24, 25);
    // This chapter-policy case needs the adopted summary to fit the complete
    // locked-content request, rather than exercise the implicit 48k fallback.
    const bridgeOptions = { saveSettings: chapterPreferences({ onAutoSave: false, onCompaction }), sessionOptions: chapterStoryOptions };
    const bridge = env.bridge(env.provider, bridgeOptions);
    const request = { ...env.id, revision: 24, requestId: "manual-settings-compact" };
    const compact = await bridge.compactCurrentContext(request);
    const { before, after, savedSafetyInputTokens } = compact.compaction;
    t.diagnostic(JSON.stringify({ manualCompaction: { onCompaction, status: compact.compaction.status,
      window: after.policy.effectiveContextWindow, characterLimit: after.limits.maxContextCharacters,
      beforeCharacters: before.latestEstimate.characters, afterCharacters: after.latestEstimate.characters,
      beforeSafety: before.latestEstimate.safetyInputTokens, afterSafety: after.latestEstimate.safetyInputTokens,
      afterFits: after.fits, afterReason: after.limitingReason, savedSafetyInputTokens } }));
    assert.equal(after.fits, true, "a derived chapter may follow only a usable compacted context");
    assert.ok(savedSafetyInputTokens > 0, "the summary must actually reduce the complete story request");
    assert.equal(savedSafetyInputTokens, before.latestEstimate.safetyInputTokens - after.latestEstimate.safetyInputTokens);
    assert.equal(compact.compaction.status, "reduced"); assert.equal(compact.compaction.modelCalls, 1);
    assert.equal(env.calls.chapter, onCompaction ? 1 : 0); assert.equal(env.calls.compaction, 1);
    if (onCompaction) { assert.equal(compact.chapterSummary.trigger, "compaction"); assert.equal(compact.chapterSummary.revision, 24); }
    else assert.equal(compact.chapterSummary, undefined);
    await bridge.readContextCompaction(request);
    const repeated = await bridge.compactCurrentContext(request);
    assert.equal(repeated.compaction.modelCalls, 0); assert.equal(repeated.chapterSummary, undefined);
    await bridge.close();
    const restarted = env.bridge(env.provider, bridgeOptions);
    assert.equal((await restarted.recoverCurrentAdventure(env.id)).projection.revision, 24);
    assert.equal((await restarted.readContextCompaction(request)).compaction.modelCalls, 0);
    assert.equal(env.calls.chapter, onCompaction ? 1 : 0); assert.equal(env.calls.story, 0);
  });
}

test("auto compaction and periodic chapter preferences combine into one derived chapter after the story commits", async (t) => {
  const env = await seedChapterSettings(t, 19, 80);
  const sessionOptions = { maxContextCharacters: 200000, contextPolicy: { configuredContextWindow: 128000, autoCompactRatio: 0.6 } };
  const plan = await measureAutomaticChapterContext(env, sessionOptions);
  const bridge = env.bridge(env.provider, { saveSettings: chapterPreferences(), sessionOptions });
  const result = await bridge.runTurn(env.request);
  t.diagnostic(JSON.stringify({ window: sessionOptions.contextPolicy.configuredContextWindow, baseline: plan.baseline.latestEstimate.safetyInputTokens,
    baselineFits: plan.baseline.fits, baselineReason: plan.baseline.limitingReason, fullHistory: plan.before.latestEstimate.safetyInputTokens,
    autoLimit: plan.before.policy.autoCompactLimit, action: result.actionResult.status, error: result.actionResult.error,
    compaction: result.actionResult.compaction?.status }));
  assert.equal(plan.baseline.fits, true, "fixed context and the required final two turns must fit");
  assert.ok(plan.baseline.latestEstimate.safetyInputTokens < plan.before.policy.autoCompactLimit, "fixed context alone must not require automatic compaction");
  assert.ok(plan.before.latestEstimate.safetyInputTokens >= plan.before.policy.autoCompactLimit, "complete history must trigger automatic compaction");
  assert.equal(result.actionResult.status, "committed"); assert.equal(result.actionResult.compaction.status, "reduced");
  assert.equal(result.derivedWork.trigger, "interval+compaction"); assert.equal(env.calls.chapter, 0);
  const derived = await bridge.completeTurnDerived({ ...env.id, ...result.derivedWork });
  assert.equal(derived.chapterSummary.chapterStatus, "created");
  assert.equal(env.calls.story, 1); assert.ok(env.calls.compaction >= 1); assert.ok(env.calls.chapter >= 1);
  assert.equal(derived.chapterSummary.modelCalls, env.calls.chapter);
  assert.equal((await bridge.readChapterLogs({ ...env.id, revision: 20 })).result.chapters.length, 1);
});

test("disabled periodic reviews never run at an interval boundary while the story still commits", async (t) => {
  const env = await seedChapterSettings(t);
  const bridge = env.bridge(env.provider, { saveSettings: chapterPreferences({ onAutoSave: false }), sessionOptions: chapterStoryOptions });
  await assertChapterStoryFits(bridge, env);
  const result = await bridge.runTurn(env.request);
  assert.equal(result.actionResult.status, "committed"); assert.equal(result.projection.revision, 20);
  assert.equal(result.chapterSummary, undefined); assert.equal(result.derivedWork, undefined);
  assert.equal(env.calls.chapter, 0); assert.equal(env.calls.story, 1);
});

for (const stop of ["cancel", "close"]) {
  test(`automatic chapter ${stop} does not undo a committed action or generate again on recovery`, async (t) => {
    const env = await seedChapterSettings(t);
    const started = deferred();
    const controller = new AbortController();
    const bridge = env.bridge({ generate(request) {
      if (request.messages[1]?.content.includes('"summarize_chapter"')) {
        env.calls.chapter++; started.resolve();
        return new Promise((resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("private aborted chapter")), { once: true }));
      }
      return env.provider.generate(request);
    } }, { saveSettings: chapterPreferences(), sessionOptions: chapterStoryOptions });
    await assertChapterStoryFits(bridge, env);
    const result = await bridge.runTurn(env.request);
    assert.equal(result.actionResult.status, "committed"); assert.equal(result.projection.revision, 20);
    assert.equal(env.calls.chapter, 0);
    const running = bridge.completeTurnDerived({ ...env.id, ...result.derivedWork }, { signal: controller.signal });
    await Promise.race([started.promise, running.then(derived => assert.fail(`Chapter ended before provider entry: ${JSON.stringify(derived.chapterSummary?.error)}`))]);
    if (stop === "cancel") controller.abort(); else await bridge.close();
    const derived = await running;
    assert.equal(derived.chapterSummary.chapterStatus, stop === "close" ? "unknown" : "interrupted"); assert.equal(env.calls.chapter, 1);
    const resumed = stop === "close" ? env.bridge(env.provider, { saveSettings: chapterPreferences(), sessionOptions: chapterStoryOptions }) : bridge;
    const recovered = await resumed.recoverCurrentAdventure(env.id);
    assert.equal(recovered.projection.revision, 20); assert.equal(recovered.projection.envelope.meta.autoSpeak, false);
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(env.identity.databasePath, { readOnly: true });
    try { assert.equal(db.prepare("SELECT status FROM chapter_jobs WHERE chapter_id='chapter-20'").get().status, "interrupted"); }
    finally { db.close(); }
    assert.equal(env.calls.chapter, 1); assert.equal(env.calls.story, 1);
  });
}

for (const excerpt of [false, true]) test(`finale sealing separately prepares its required ${excerpt ? "fallback excerpt" : "model chapter"} with optional chapter preferences disabled`, async (t) => {
  const env = await seedChapterSettings(t, 0);
  const offer = { narration: [{ id: "offer", text: "这段故事可以停在楼道中，你愿意在这里结束吗？" }], experiences: [],
    events: [{ id: "offered", type: "finale.propose", sourceSegmentIds: ["offer"], data: { candidateId: "settings-ending",
      closureReason: "PRIVATE_SETTINGS_FINALE_REASON", closedThreads: ["观察告一段落"], intentionalOpenThreads: [], finaleTone: "平静" } }] };
  const confirm = { narration: [{ id: "end", text: "你确认这次告别，故事在楼道里结束。" }], experiences: [],
    events: [{ id: "confirmed", type: "finale.confirm", sourceSegmentIds: ["end"], data: { candidateId: "settings-ending" } }] };
  let storyCalls = 0, outputLimit;
  const bridge = env.bridge({ generate(request) {
    if (request.messages[1]?.content.includes('"summarize_chapter"')) {
      if (!excerpt) return env.provider.generate(request);
      env.calls.chapter++; outputLimit = request.maxOutputTokens;
      return { text: "", finishReason: "length", usage: { input_tokens: 73, output_tokens: outputLimit } };
    }
    return response(storyCalls++ === 0 ? offer : confirm);
  } }, { saveSettings: chapterPreferences({ onAutoSave: false, onManualSave: false, onCompaction: false }) });
  await bridge.runTurn({ ...env.id, actionId: "ending-offer", baseRevision: 0, text: "先提议结局。" });
  const closed = await bridge.runTurn({ ...env.id, actionId: "ending-confirm", baseRevision: 1, text: "我明确确认结束。" });
  assert.equal(closed.actionResult.status, "committed"); assert.equal(closed.projection.storyFinale.projection.phase, "recovery_required");
  assert.equal(env.calls.chapter, 0); assert.equal(closed.chapterSummary, undefined);
  const derived = await bridge.completeTurnDerived({ ...env.id, ...closed.derivedWork });
  assert.equal(derived.storyFinale.projection.phase, "closed"); assert.equal(env.calls.chapter, 1);
  assert.equal(derived.finalization.chapterWork.mode, excerpt ? "excerpt" : "model");
  assert.equal(derived.finalization.chapterWork.fallbackReason, excerpt ? "CHAPTER_OUTPUT_BUDGET_EXCEEDED" : undefined);
  assert.deepEqual(derived.finalization.chapterWork.usage,
    excerpt ? { input_tokens: 73, output_tokens: outputLimit } : { input_tokens: 50, output_tokens: 60 });
  assert.equal(derived.finalization.chapterWork.usageComplete, true);
  assert.equal(derived.finalization.chapterWork.modelCalls, 1);
  assert.equal(derived.autoSpeak, false); assert.equal(derived.envelope, undefined);
  assert.deepEqual(derived.projection.envelope.segments, []);
  assert.equal((await bridge.completeTurnDerived({ ...env.id, ...closed.derivedWork })).finalization.status, "closed");
  assert.equal(env.calls.chapter, 1); assert.equal(storyCalls, 2);
  assert.doesNotMatch(JSON.stringify(closed), /PRIVATE_SETTINGS_FINALE_REASON/);
});

test("successful automatic compaction followed by failed story does not run an optional chapter", async (t) => {
  const env = await seedChapterSettings(t, 19, 80);
  const sessionOptions = { maxContextCharacters: 200000, contextPolicy: { configuredContextWindow: 128000, autoCompactRatio: 0.6 } };
  const plan = await measureAutomaticChapterContext(env, sessionOptions);
  const bridge = env.bridge({ generate(request) {
    if (request.messages[1]?.content.includes('"summarize_context"') || request.messages[1]?.content.includes('"merge_context"')) return env.provider.generate(request);
    env.calls.story++; throw new Error("private story generation failure after compaction");
  } }, { saveSettings: chapterPreferences({ onAutoSave: false }), sessionOptions });
  const result = await bridge.runTurn(env.request);
  t.diagnostic(JSON.stringify({ window: sessionOptions.contextPolicy.configuredContextWindow, baseline: plan.baseline.latestEstimate.safetyInputTokens,
    baselineFits: plan.baseline.fits, baselineReason: plan.baseline.limitingReason, fullHistory: plan.before.latestEstimate.safetyInputTokens,
    autoLimit: plan.before.policy.autoCompactLimit, action: result.actionResult.status, error: result.actionResult.error,
    compaction: result.actionResult.compaction?.status }));
  assert.equal(plan.baseline.fits, true, "fixed context and the required final two turns must fit");
  assert.ok(plan.baseline.latestEstimate.safetyInputTokens < plan.before.policy.autoCompactLimit, "fixed context alone must not require automatic compaction");
  assert.ok(plan.before.latestEstimate.safetyInputTokens >= plan.before.policy.autoCompactLimit, "complete history must trigger automatic compaction");
  assert.equal(result.actionResult.status, "failed"); assert.equal(result.actionResult.compaction.status, "reduced");
  assert.ok(env.calls.compaction >= 1); assert.equal(env.calls.story, 1);
  assert.equal(result.projection.revision, 19); assert.equal(result.chapterSummary, undefined); assert.equal(env.calls.chapter, 0);
  assert.equal((await bridge.readChapterLogs({ ...env.id, revision: 19 })).result.chapters.length, 0);
});
