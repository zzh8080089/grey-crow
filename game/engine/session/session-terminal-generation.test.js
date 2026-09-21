"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAdventureSession } = require("./adventure-session");
const { createTurnStore } = require("./turn-store");
const { createTurnGenerator } = require("./turn-generator");
const { createTurnCoordinator } = require("./turn-coordinator");
const { createTurnMemory } = require("./turn-memory");
const samples = require("./test-fixtures/turn-samples");

const EXTREME_TEXT = "合成游戏规则：虚构角色的明确意图，经后续三个独立回答确认后，才完成对应结尾。";
const offerData = { candidateId: "extreme1", characterId: "p", intentReason: "PRIVATE_SYNTHETIC_CHARACTER_INTENT",
  fictionalContext: "这是合成游戏角色在虚构世界中的选择。" };
function bundle(type, segmentId = "source", text = "角色继续交谈，等待新的回答。") {
  return { narration: [{ id: segmentId, text }], events: [...(type ? [{ id: "decision", type,
    sourceSegmentIds: [segmentId], data: type === "extreme.propose" ? { ...offerData } : { candidateId: "extreme1" } }] : [])], experiences: [] };
}
const intent = { terminalIntent: { candidateId: "extreme1" } };
const chapter = { title: "虚构旅程的回望", summary: "角色经过几次对话，选择让这段旅程结束。",
  keyEvents: [{ text: "这段虚构旅程结束。", sources: [{ revision: 4, segmentId: "last" }] }], openThreads: [] };
function response(value) { return { text: JSON.stringify(value), usage: { input_tokens: 20, output_tokens: 30 }, finishReason: "stop" }; }
function request(revision = 4, overrides = {}) {
  return samples.request({ actionId: `terminal-action-${revision}`, baseRevision: revision - 1,
    input: `我在这段合成故事的第 ${revision} 个回答中明确继续虚构角色的选择。`, ...overrides });
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function reservationIn(input) {
  const message = input.messages.find((item) => item.role === "system" && item.content.startsWith("ENGINE TERMINAL RESERVATION: "));
  return message ? JSON.parse(message.content.match(/^ENGINE TERMINAL RESERVATION: (\{[^}]*\})/)[1]) : null;
}
function closing(reservation) {
  return bundle("extreme.confirm", "last", reservation.outcome === "grey_crow_view"
    ? "风掠过灰鸦的羽毛，楼道的声音渐渐远去。这段虚构旅程到此结束。"
    : "楼道里的声音渐渐远去。这段虚构旅程到此结束。");
}
function isChapter(input) { return JSON.parse(input.messages[1].content).task === "summarize_chapter"; }

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-terminal-generation-"));
  const identity = samples.identity(path.join(directory, "session.sqlite"));
  const sessions = [];
  const stores = [];
  const coordinators = [];
  function store(options = {}) { const value = createTurnStore({ ...identity, ...options }); stores.push(value); return value; }
  function seed(options = {}, count = 3) {
    const value = store({ initialState: samples.initialState(), ...options });
    for (let revision = 1; revision <= count; revision++) {
      const action = value.beginAction(request(revision));
      value.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
        bundle: bundle(revision === 1 ? "extreme.propose" : "extreme.confirm", `source${revision}`) });
    }
    return value;
  }
  function open(provider, options = {}) {
    const session = createAdventureSession({ ...identity, hostText: "克制的合成主持人。", worldText: "虚构世界的楼道。",
      extremeText: EXTREME_TEXT, provider, ...options });
    sessions.push(session);
    return session;
  }
  function inspect() {
    const value = store();
    try { return { terminal: value.getTerminal(), state: value.readModelState(), history: value.readHistory({ revision: value.readView().revision }).history }; }
    finally { value.close(); }
  }
  function kit(value, provider, options = {}) {
    const generator = createTurnGenerator({ store: value, memory: createTurnMemory({ store: value }), provider,
      hostText: "合成主持人。", worldText: "虚构楼道。", extremeText: EXTREME_TEXT,
      ...(options.maxModelCalls === undefined ? {} : { maxModelCalls: options.maxModelCalls }) });
    const coordinator = createTurnCoordinator({ store: value, generateTurn: generator.generateTurn,
      maxAttempts: options.maxAttempts ?? 2, timeoutMs: options.timeoutMs ?? 1000 });
    coordinators.push(coordinator);
    return { generator, coordinator };
  }
  t.after(async () => {
    for (const session of sessions) await session.close();
    for (const value of stores) value.close();
    for (const coordinator of coordinators) coordinator.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { identity, store, seed, open, inspect, kit };
}

test("factory commits proposal and three replies once; terminal intent is internal and chapter work is separate", async (t) => {
  const env = fixture(t);
  const calls = [];
  let selected;
  const session = env.open({ generate(input) {
    calls.push(input);
    if (isChapter(input)) return response(chapter);
    const data = JSON.parse(input.messages[1].content);
    if (!data.canonicalState.finale) return response(bundle("extreme.propose", "source1"));
    const count = data.canonicalState.finale.candidate.confirmations.length;
    if (count < 2) return response(bundle("extreme.confirm", `source${count + 2}`));
    const reserved = reservationIn(input);
    if (!reserved) return response(intent);
    selected = reserved;
    return response(closing(reserved));
  } }, { initialState: samples.initialState() });
  for (const revision of [1, 2, 3]) {
    const result = await session.runAction(request(revision));
    assert.equal(result.status, "committed");
    assert.equal(result.modelCalls, 1);
    assert.equal(result.view.revision, revision);
    assert.equal(result.finalization, undefined);
  }
  const final = await session.runAction(request());
  assert.equal(final.status, "committed");
  assert.equal(final.revision, 4);
  assert.equal(final.modelCalls, 2, "intent and closing share one actual Provider budget");
  assert.equal(final.generationPasses, 1);
  assert.deepEqual(final.usage, { input_tokens: 40, output_tokens: 60 });
  assert.equal(final.usageComplete, true);
  assert.equal(final.finalization, undefined);
  assert.equal(final.view.finale.archive.status, "pending");
  assert.equal(final.view.finale.chapterJob, null);
  assert.equal(calls.length, 5, "the committed closing narration is delivered before any chapter call");
  const storyReceipt = structuredClone(final);
  const persisted = env.inspect();
  assert.deepEqual(persisted.state.entities.p, samples.initialState().entities.p,
    "the terminal choice does not invent a character condition");
  assert.equal(persisted.terminal.status, "committed");
  assert.equal(persisted.terminal.outcome, selected.outcome);
  assert.equal(persisted.state.finale.confirmation.outcome, selected.outcome);
  assert.equal(persisted.state.finale.candidate.confirmations.length, 3);
  assert.equal(persisted.history.length, 4);
  assert.deepEqual(persisted.history.map((turn) => turn.actionId), [1, 2, 3, 4].map((revision) => request(revision).actionId));
  assert.deepEqual(final.view.narration, closing(selected).narration);
  assert.doesNotMatch(JSON.stringify(persisted.history), /terminalIntent|ENGINE TERMINAL RESERVATION|PRIVATE_SYNTHETIC_CHARACTER_INTENT/);
  const duplicate = await session.runAction(request(), { retry: true });
  assert.equal(duplicate.status, "committed");
  assert.equal(duplicate.modelCalls, 0);
  assert.equal(duplicate.finalization, undefined);
  assert.equal(calls.length, 5, "a duplicate story receipt does not start derived work");
  const finalized = await session.finalize({ revision: 4 });
  assert.equal(finalized.status, "closed");
  assert.equal(finalized.chapterWork.modelCalls, 1);
  assert.deepEqual(finalized.chapterWork.usage, { input_tokens: 20, output_tokens: 30 });
  assert.equal(finalized.chapterWork.usageComplete, true);
  assert.equal(session.readView().finale.archive.status, "closed");
  assert.equal(session.readView().revision, 4);
  assert.deepEqual(env.inspect(), persisted, "derived finalization must not rewrite the story or terminal outcome");
  assert.deepEqual(final, storyReceipt, "derived usage does not mutate the delivered story receipt");
  assert.equal((await session.finalize({ revision: 4 }, { retry: true })).chapterWork, null);
  assert.equal(calls.length, 6);
  await session.close();
  const restored = env.open({ generate() { throw new Error("recovery or duplicate must not generate"); } });
  assert.equal(restored.recoverFinale().status, "closed");
  assert.equal((await restored.runAction(request(), { retry: true })).modelCalls, 0);
  assert.deepEqual(restored.readView().narration, closing(selected).narration);
});

test("intent, invalid final output and structural repair cannot exceed one shared call budget", async (t) => {
  const env = fixture(t); env.seed().close();
  let calls = 0;
  const session = env.open({ generate(input) {
    calls++;
    if (!reservationIn(input)) return response(intent);
    const invalid = closing(reservationIn(input));
    invalid.events.find((event) => event.type === "extreme.confirm").data.outcome = "grey_crow_view";
    return response(invalid);
  } }, { maxModelCalls: 2, maxAttempts: 3 });
  const result = await session.runAction(request());
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "MODEL_CALL_BUDGET_EXCEEDED");
  assert.equal(result.modelCalls, 2);
  assert.equal(calls, 2);
  assert.equal(result.generationPasses, 2);
  assert.equal(result.usageComplete, true);
  const persisted = env.inspect();
  assert.equal(persisted.history.length, 3);
  assert.equal(persisted.state.finale.phase, "candidate_pending");
  assert.equal(persisted.terminal.status, "reserved");
});

test("the original deadline covers both intent interpretation and closing narration", async (t) => {
  const env = fixture(t); env.seed().close();
  // Control elapsed action time after explicit Provider entry. Real SQLite and
  // request preparation can exceed a short deadline under parallel test load.
  let now = 0;
  t.mock.method(require("node:perf_hooks").performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const intentEntered = deferred(), closingEntered = deferred();
  const intentAnswer = deferred(), lateClosing = deferred();
  let calls = 0; let reserved;
  const session = env.open({ generate(input) {
    calls++;
    const token = reservationIn(input);
    if (!token) { intentEntered.resolve(input.signal); return intentAnswer.promise; }
    reserved = token; closingEntered.resolve(input.signal); return lateClosing.promise;
  } }, { timeoutMs: 150 });
  const pending = session.runAction(request());
  const endedEarly = pending.then(() => assert.fail("the action ended before the expected Provider entry"));
  const intentSignal = await Promise.race([intentEntered.promise, endedEarly]);
  now = 100; t.mock.timers.tick(100);
  assert.equal(intentSignal.aborted, false);
  intentAnswer.resolve(response(intent));
  const closingSignal = await Promise.race([closingEntered.promise, endedEarly]);
  assert.equal(calls, 2);
  assert.equal(closingSignal.aborted, false);
  now = 149; t.mock.timers.tick(49);
  assert.equal(closingSignal.aborted, false);
  // Closing has used only 50 ms at this point. Giving it a fresh 150 ms
  // deadline after the durable reservation would fail this assertion.
  now = 150; t.mock.timers.tick(1);
  assert.equal(closingSignal.aborted, true);
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "TURN_TIMEOUT");
  assert.equal(result.modelCalls, 2);
  assert.equal(result.usageComplete, false);
  assert.equal(calls, 2);
  const beforeLate = env.inspect();
  assert.equal(beforeLate.terminal.outcome, reserved.outcome);
  assert.equal(beforeLate.terminal.status, "reserved");
  assert.equal(beforeLate.history.length, 3);
  // Each Provider returns after 100 ms, but the combined 200 ms exceeds the
  // original action deadline. A valid late response must remain uncommitted.
  now = 200; t.mock.timers.tick(50);
  lateClosing.resolve(response(closing(reserved)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.inspect(), beforeLate, "late valid closing text must not change the story or reservation");
  assert.equal(calls, 2);
});

test("cancelling while intent is still pending never reserves a result from its late response", async (t) => {
  const env = fixture(t); env.seed().close();
  const started = deferred(); const late = deferred(); let calls = 0;
  const session = env.open({ generate(input) { calls++; started.resolve(input.signal); return late.promise; } });
  const pending = session.runAction(request());
  const signal = await started.promise;
  assert.equal(session.cancelAction(request().actionId).status, "cancelled");
  assert.equal(signal.aborted, true);
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(result.modelCalls, 1);
  late.resolve(response(intent));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(env.inspect().terminal, null);
  assert.equal(env.inspect().history.length, 3);
  assert.equal((await session.runAction(request(), { retry: true })).modelCalls, 0);
});

for (const stop of ["provider_failure", "cancel", "timeout", "close"]) {
  test(`reserved final generation ${stop} reopens on the original action/input/outcome without another intent`, async (t) => {
    const env = fixture(t); env.seed().close();
    const entered = deferred(); const late = deferred(); let calls = 0; let original;
    const session = env.open({ generate(input) {
      calls++;
      if (!reservationIn(input)) return response(intent);
      original = reservationIn(input);
      entered.resolve(input.signal);
      if (stop === "provider_failure") throw new Error("PRIVATE_FAKE_PROVIDER_FAILURE");
      return late.promise;
    } }, { timeoutMs: stop === "timeout" ? 100 : 2000 });
    const running = session.runAction(request());
    const providerSignal = await entered.promise;
    if (stop === "cancel") assert.equal(session.cancelAction(request().actionId).status, "interrupted");
    if (stop === "close") await session.close();
    const result = await running;
    assert.equal(calls, 2);
    assert.equal(result.modelCalls, 2);
    assert.equal(result.usageComplete, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FAKE_PROVIDER_FAILURE/);
    if (stop === "close") {
      assert.equal(result.status, "unknown");
      assert.equal(result.error.code, "PROCESS_INTERRUPTED");
    } else if (stop === "cancel") {
      assert.equal(result.status, "interrupted");
      assert.equal(result.error.code, "TERMINAL_INTERRUPTED");
    } else {
      assert.equal(result.status, "failed");
      assert.equal(result.error.code, stop === "timeout" ? "TURN_TIMEOUT" : "TURN_GENERATION_FAILED");
    }
    if (stop !== "provider_failure") assert.equal(providerSignal.aborted, true);
    await session.close();
    const before = env.inspect();
    assert.equal(before.history.length, 3);
    assert.equal(before.terminal.status, "reserved");
    assert.equal(before.terminal.outcome, original.outcome);
    late.resolve(response(closing(original)));
    await new Promise((resolve) => setImmediate(resolve));
    let resumedCalls = 0;
    const resumed = env.open({ generate(input) {
      resumedCalls++;
      if (isChapter(input)) return response(chapter);
      assert.deepEqual(reservationIn(input), original, "reopened attempt starts with its already durable result");
      assert.equal(input.messages.filter((item) => item.role === "assistant").length, 0, "no old intent/model output is replayed as a new decision");
      assert.equal(input.messages.find((item) => item.content.startsWith("Current player action:\n")).content, `Current player action:\n${request().input}`);
      return response(closing(original));
    } });
    // The story decision is not yet confirmed; its separate reservation is the
    // recovery lock. Reading either receipt must not restart model execution.
    assert.equal(resumed.recoverFinale().status, "not_confirmed");
    assert.equal(resumed.readFinale().terminal.status, "reserved");
    assert.equal(resumed.readFinale().terminal.actionId, request().actionId);
    const waitForRetry = await resumed.runAction(request());
    assert.equal(waitForRetry.modelCalls, 0);
    assert.equal(resumedCalls, 0);
    const changed = await resumed.runAction(request(4, { input: "换掉原来的行动。" }), { retry: true });
    assert.equal(changed.error.code, "ACTION_INPUT_CONFLICT");
    const another = await resumed.runAction(request(4, { actionId: "new-action" }), { retry: true });
    assert.equal(another.error.code, "TERMINAL_LOCKED");
    assert.equal(resumedCalls, 0);
    const complete = await resumed.runAction(request(), { retry: true });
    assert.equal(complete.status, "committed");
    assert.equal(complete.modelCalls, 1);
    assert.equal(complete.finalization, undefined);
    assert.equal(complete.view.revision, 4);
    assert.deepEqual(complete.view.narration, closing(original).narration);
    assert.equal(complete.view.finale.archive.status, "pending");
    assert.equal(complete.view.finale.chapterJob, null);
    assert.deepEqual(complete.usage, { input_tokens: 20, output_tokens: 30 });
    assert.equal(complete.usageComplete, true);
    assert.equal(resumedCalls, 1, "explicit story retry resumes closing only, without generating its chapter");
    const storyReceipt = structuredClone(complete);
    const after = env.inspect();
    assert.equal(after.terminal.terminalId, before.terminal.terminalId);
    assert.equal(after.terminal.outcome, before.terminal.outcome);
    assert.equal(after.terminal.status, "committed");
    assert.equal(after.history.length, 4);
    assert.equal(after.history.filter((row) => row.actionId === request().actionId).length, 1);
    assert.equal((await resumed.runAction(request(), { retry: true })).modelCalls, 0);
    assert.equal(resumedCalls, 1);
    assert.equal(resumed.recoverFinale().status, "recovery_required");
    assert.equal(resumedCalls, 1, "reading pending finalization does not resume model work");
    const finalized = await resumed.finalize({ revision: 4 });
    assert.equal(finalized.status, "closed");
    assert.equal(finalized.chapterWork.modelCalls, 1);
    assert.deepEqual(finalized.chapterWork.usage, { input_tokens: 20, output_tokens: 30 });
    assert.equal(finalized.chapterWork.usageComplete, true);
    assert.equal(resumed.readView().revision, 4);
    assert.equal(resumed.readView().finale.archive.status, "closed");
    assert.deepEqual(env.inspect(), after);
    assert.deepEqual(complete, storyReceipt);
    assert.equal((await resumed.finalize({ revision: 4 }, { retry: true })).chapterWork, null);
    assert.equal(resumedCalls, 2);
  });
}

test("a lost durable reservation receipt is read back before the closing model call without drawing twice", async (t) => {
  const env = fixture(t); let draws = 0; let readbacks = 0; let lost = false; let calls = 0;
  const real = env.seed({ terminalRandomInt() { draws++; return 0; },
    faultInjector(stage) { if (stage === "after_terminal_reserve_commit") { lost = true; throw new Error("lost terminal return"); } } });
  const wrapped = { ...real, getTerminal(args) { if (lost) readbacks++; return real.getTerminal(args); } };
  const { coordinator, generator } = env.kit(wrapped, { generate(input) {
    calls++;
    if (!reservationIn(input)) return response(intent);
    assert.equal(readbacks, 1, "must establish a durable result before narration");
    return response(closing(reservationIn(input)));
  } });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "committed");
  assert.equal(generator.readUsage(result.executionAttemptId).modelCalls, 2);
  assert.equal(calls, 2); assert.equal(draws, 1);
  assert.equal(real.getTerminal().outcome, "grey_crow_view");
  assert.equal(real.readHistory({ revision: 4 }).history.length, 4);
});

test("an unreadable reservation outcome stops generation and retries only after the same record can be read", async (t) => {
  const env = fixture(t); let draws = 0; let unavailable = false; let calls = 0; let reserves = 0;
  const real = env.seed({ terminalRandomInt() { draws++; return 9999; } });
  const wrapped = { ...real,
    reserveTerminal(args) { reserves++; real.reserveTerminal(args); unavailable = true; throw new Error("lost return"); },
    getTerminal(args) { if (unavailable) throw new Error("read unavailable"); return real.getTerminal(args); } };
  const { coordinator, generator } = env.kit(wrapped, { generate(input) {
    calls++;
    return response(reservationIn(input) ? closing(reservationIn(input)) : intent);
  } });
  const first = await coordinator.runAction(request());
  assert.equal(first.status, "failed"); assert.equal(first.error.code, "TERMINAL_STATE_UNAVAILABLE");
  assert.equal(generator.readUsage(first.executionAttemptId).modelCalls, 1);
  assert.equal(calls, 1); assert.equal(reserves, 1); assert.equal(draws, 1);
  const record = real.getTerminal();
  assert.equal(record.status, "reserved"); assert.equal(record.outcome, "standard_extreme_ending");
  assert.equal(real.readView().revision, 3);
  assert.equal((await coordinator.runAction(request())).modelCalls, 0);
  const unreadableRetry = await coordinator.runAction(request(), { retry: true });
  assert.equal(unreadableRetry.status, "failed"); assert.equal(unreadableRetry.error.code, "TERMINAL_STATE_UNAVAILABLE");
  assert.equal(generator.readUsage(unreadableRetry.executionAttemptId).modelCalls, 0);
  assert.equal(calls, 1); assert.equal(reserves, 1); assert.equal(draws, 1);
  unavailable = false;
  const resumed = await coordinator.runAction(request(), { retry: true });
  assert.equal(resumed.status, "committed");
  assert.equal(generator.readUsage(resumed.executionAttemptId).modelCalls, 1);
  assert.equal(calls, 2); assert.equal(reserves, 1); assert.equal(draws, 1);
  assert.equal(real.getTerminal().terminalId, record.terminalId);
  assert.equal(real.readView().revision, 4);
});

test("disabled capability and premature or outcome-bearing intent cannot reserve a terminal result", async (t) => {
  const cases = [
    { count: 0, extremeText: "", value: bundle("extreme.propose", "ask") },
    { count: 0, extremeText: "", value: intent },
    { count: 1, value: intent },
    { count: 2, value: intent },
    { count: 3, value: { terminalIntent: { candidateId: "extreme1", outcome: "grey_crow_view" } } },
    { count: 3, value: { ...intent, ...bundle(null) } },
    { count: 3, value: bundle("extreme.confirm", "last") },
  ];
  for (const [index, entry] of cases.entries()) {
    await t.test(`invalid stage ${index + 1}`, async (subtest) => {
      const env = fixture(subtest); env.seed({}, entry.count).close(); let calls = 0;
      const session = env.open({ generate() { calls++; return response(entry.value); } }, {
        maxModelCalls: 1, maxAttempts: 1, ...(entry.extremeText === undefined ? {} : { extremeText: entry.extremeText }),
      });
      const result = await session.runAction(request(entry.count + 1));
      assert.equal(result.status, "failed");
      assert.equal(calls, 1); assert.equal(result.modelCalls, 1);
      const persisted = env.inspect();
      assert.equal(persisted.terminal, null);
      assert.equal(persisted.history.length, entry.count);
    });
  }
});
