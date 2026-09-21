"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay, setImmediate: nextTick } = require("node:timers/promises");
const { createTurnStore } = require("./turn-store");
const { createTurnCoordinator } = require("./turn-coordinator");
const { initialState, borrowBundle, request, identity } = require("./test-fixtures/turn-samples");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function narrationOnly(text = "你留意到走廊的脚步声。") {
  return { narration: [{ id: "s1", text }], events: [], experiences: [] };
}

function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-coordinator-"));
  const databasePath = path.join(directory, "adventure.sqlite");
  const stores = [];
  const store = createTurnStore({ ...identity(databasePath), initialState: initialState(), ...options });
  stores.push(store);
  t.after(() => {
    for (const opened of stores.reverse()) opened.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, databasePath, reopen() {
    const reopened = createTurnStore(identity(databasePath));
    stores.push(reopened);
    return reopened;
  } };
}

test("one borrowed-rice action commits once; repeats recover the same revision", async (t) => {
  const { store } = setup(t);
  let calls = 0;
  const coordinator = createTurnCoordinator({ store, generateTurn: async () => {
    calls += 1;
    return borrowBundle();
  } });
  const first = await coordinator.runAction(request());
  assert.equal(first.status, "committed");
  assert.equal(first.modelCalls, 1);
  assert.equal(first.view.revision, 1);
  assert.deepEqual(first.view, coordinator.readView());
  const repeat = await coordinator.runAction(request(), { retry: true });
  assert.equal(repeat.status, "committed");
  assert.equal(repeat.modelCalls, 0);
  assert.deepEqual(repeat.view, first.view);
  assert.equal(calls, 1);
  assert.equal(coordinator.readAction(request().actionId).revision, 1);
  const conflict = await coordinator.runAction(request({ input: "改成借三袋米。" }));
  assert.equal(conflict.error.code, "ACTION_INPUT_CONFLICT");
  assert.equal(calls, 1);
});

test("the generator receives immutable stored input and full formal state, including hidden entities", async (t) => {
  const state = initialState();
  state.entities.p.attributes = { status: "疲惫，右臂擦伤已包扎。", occupation: "维修工" };
  state.entities.secret = { id: "secret", kind: "character", name: "暗处的人",
    aliases: [], visibility: "hidden", attributes: { intent: "守住水井" } };
  const { store } = setup(t, { initialState: state });
  const input = request();
  const originalInput = input.input;
  const coordinator = createTurnCoordinator({ store, generateTurn: async (args) => {
    assert.equal(args.request.input, originalInput);
    assert.equal(args.state.entities.secret.attributes.intent, "守住水井");
    assert.equal(Object.isFrozen(args.request), true);
    assert.equal(Object.isFrozen(args.state.entities.secret.attributes), true);
    assert.throws(() => { args.request.input = "unexpected change"; }, TypeError);
    assert.throws(() => { args.state.entities.secret.attributes.intent = "changed"; }, TypeError);
    return narrationOnly();
  } });
  const pending = coordinator.runAction(input);
  input.input = "调用后篡改输入";
  const result = await pending;
  assert.equal(result.status, "committed");
  assert.equal(store.readAction(input.actionId).request.input, originalInput);
  assert.equal(result.view.state.entities.secret, undefined);
  assert.deepEqual(result.view.state.entities.p.attributes, state.entities.p.attributes,
    "noticing footsteps does not replace an established bodily condition or identity");
});

test("duplicate running requests and a second coordinator cannot start extra generation", async (t) => {
  const { store, reopen } = setup(t);
  const gate = deferred();
  let firstCalls = 0;
  let otherCalls = 0;
  const first = createTurnCoordinator({ store, generateTurn: () => {
    firstCalls += 1;
    return gate.promise;
  } });
  const other = createTurnCoordinator({ store: reopen(), generateTurn: async () => {
    otherCalls += 1;
    return narrationOnly();
  } });
  const pending = first.runAction(request());
  await nextTick();
  const duplicate = await other.runAction(request(), { retry: true });
  assert.equal(duplicate.status, "running");
  assert.equal(duplicate.modelCalls, 0);
  const busy = await other.runAction(request({ actionId: "second-action" }));
  assert.equal(busy.error.code, "ADVENTURE_BUSY");
  assert.equal(otherCalls, 0);
  gate.resolve(narrationOnly());
  assert.equal((await pending).status, "committed");
  assert.equal(firstCalls, 1);
});

test("timeout returns without waiting for an uncooperative generator; old results cannot overwrite a retry", async (t) => {
  const { store } = setup(t);
  const late = deferred();
  let calls = 0;
  let firstSignal;
  const coordinator = createTurnCoordinator({ store, timeoutMs: 30, generateTurn: ({ signal }) => {
    calls += 1;
    if (calls === 1) { firstSignal = signal; return late.promise; }
    return narrationOnly("你决定先听清门外的声音。");
  } });
  const failed = await coordinator.runAction(request());
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "TURN_TIMEOUT");
  assert.equal(failed.error.retryable, true);
  assert.equal(failed.modelCalls, 1);
  assert.equal(firstSignal.aborted, true);
  assert.equal(store.readView().revision, 0);
  const retried = await coordinator.runAction(request(), { retry: true });
  assert.equal(retried.status, "committed");
  assert.notEqual(retried.attemptId, failed.attemptId);
  late.resolve(borrowBundle());
  await nextTick();
  assert.equal(store.readView().revision, 1);
  assert.deepEqual(store.readView(), retried.view);
  assert.equal(calls, 2);
});

test("explicit cancellation is terminal and does not await a late generator", async (t) => {
  const { store } = setup(t);
  const late = deferred();
  let signal;
  let calls = 0;
  const coordinator = createTurnCoordinator({ store, generateTurn: (args) => {
    signal = args.signal;
    calls += 1;
    return late.promise;
  } });
  const pending = coordinator.runAction(request());
  await nextTick();
  assert.equal(coordinator.cancelAction(request().actionId).status, "cancelled");
  const cancelled = await pending;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(signal.aborted, true);
  assert.equal((await coordinator.runAction(request(), { retry: true })).status, "cancelled");
  late.resolve(borrowBundle());
  await nextTick();
  assert.equal(calls, 1);
  assert.equal(store.readView().revision, 0);
});

test("caller AbortSignal cancels durably both before and during generation", async (t) => {
  const { store } = setup(t);
  const late = deferred();
  let calls = 0;
  const coordinator = createTurnCoordinator({ store, generateTurn: () => {
    calls += 1;
    return late.promise;
  } });
  const before = new AbortController();
  before.abort();
  assert.equal((await coordinator.runAction(request(), { signal: before.signal })).status, "cancelled");
  assert.equal(calls, 0);
  const during = new AbortController();
  const second = request({ actionId: "abort-during" });
  const pending = coordinator.runAction(second, { signal: during.signal });
  await nextTick();
  during.abort(new Error("private caller reason must not escape"));
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(calls, 1);
  assert.equal(store.readAction(second.actionId).status, "cancelled");
  late.resolve(narrationOnly());
  await nextTick();
  assert.equal(store.readView().revision, 0);
});

test("a failed durable cancellation is unknown even though the generator was aborted", async (t) => {
  const { store, reopen } = setup(t);
  const late = deferred();
  let signal;
  const coordinator = createTurnCoordinator({ store, generateTurn: (args) => {
    signal = args.signal;
    return late.promise;
  } });
  const pending = coordinator.runAction(request());
  await nextTick();
  store.close();
  const result = coordinator.cancelAction(request().actionId);
  assert.equal(result.status, "unknown");
  assert.equal(result.error.code, "CANCEL_OUTCOME_UNKNOWN");
  assert.equal(signal.aborted, true);
  assert.equal((await pending).status, "unknown");
  const reopened = reopen();
  assert.equal(reopened.readAction(request().actionId).status, "interrupted");
  late.resolve(borrowBundle());
  await nextTick();
  assert.equal(reopened.readView().revision, 0);
});

test("structural repair shares an attempt and fixes the entire bundle within the call budget", async (t) => {
  const { store } = setup(t);
  const received = [];
  const coordinator = createTurnCoordinator({ store, maxAttempts: 2, generateTurn: async (args) => {
    received.push(args);
    return received.length === 1 ? { narration: [], events: [], experiences: [] } : borrowBundle();
  } });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "committed");
  assert.equal(result.modelCalls, 2);
  assert.equal(received[0].attemptId, received[1].attemptId);
  assert.deepEqual(received.map((args) => args.retry), [false, false]);
  assert.equal(received[0].request, received[1].request);
  assert.equal(received[1].validationError.code, "TURN_VALIDATION_FAILED");
  assert.match(received[1].validationError.issues[0], /narration/);
  assert.equal(result.view.revision, 1);
});

test("failed repairs stop at maxAttempts without any partial turn", async (t) => {
  const { store } = setup(t);
  let calls = 0;
  const coordinator = createTurnCoordinator({ store, maxAttempts: 2, generateTurn: async () => {
    calls += 1;
    return { narration: [], events: [], experiences: [] };
  } });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "TURN_VALIDATION_FAILED");
  assert.equal(result.modelCalls, 2);
  assert.equal(calls, 2);
  assert.equal(store.readView().revision, 0);
  assert.deepEqual(store.readView().history, []);
});

test("repair calls share the original overall deadline", async (t) => {
  const { store } = setup(t);
  // Real timer delivery and SQLite work can exceed 100 ms under parallel test
  // load before repair begins. Control elapsed time after each explicit entry.
  let now = 0;
  t.mock.method(require("node:perf_hooks").performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const firstEntered = deferred(), secondEntered = deferred();
  const invalidAnswer = deferred(), lateAnswer = deferred();
  let calls = 0;
  const coordinator = createTurnCoordinator({ store, timeoutMs: 100, generateTurn: ({ signal }) => {
    calls += 1;
    if (calls === 1) {
      firstEntered.resolve(signal);
      return invalidAnswer.promise;
    }
    secondEntered.resolve(signal);
    return lateAnswer.promise;
  } });
  const pending = coordinator.runAction(request());
  const endedEarly = pending.then(() => assert.fail("the action ended before the expected generation entry"));
  const firstSignal = await Promise.race([firstEntered.promise, endedEarly]);
  now = 40; t.mock.timers.tick(40);
  assert.equal(firstSignal.aborted, false);
  invalidAnswer.resolve({ narration: [], events: [], experiences: [] });
  const secondSignal = await Promise.race([secondEntered.promise, endedEarly]);
  assert.equal(calls, 2);
  now = 99; t.mock.timers.tick(59);
  assert.equal(secondSignal.aborted, false);
  // Repair has used only 60 ms. Giving it a fresh 100 ms deadline would fail.
  now = 100; t.mock.timers.tick(1);
  assert.equal(secondSignal.aborted, true);
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "TURN_TIMEOUT");
  assert.equal(result.modelCalls, 2);
  const beforeLate = store.readView(), receipt = store.readAction(request().actionId);
  assert.equal(beforeLate.revision, 0);
  assert.deepEqual(beforeLate.history, []);
  // The valid repair arrives after 80 ms of its own work, within a wrongly
  // reset deadline but outside the original action's total time allowance.
  now = 120; t.mock.timers.tick(20);
  lateAnswer.resolve(borrowBundle());
  await nextTick();
  assert.deepEqual(store.readView(), beforeLate);
  assert.deepEqual(store.readAction(request().actionId), receipt);
  assert.equal(calls, 2);
});

test("generator exceptions do not expose service messages or authorize extra repair calls", async (t) => {
  const { store } = setup(t);
  let calls = 0;
  const coordinator = createTurnCoordinator({ store, generateTurn: async () => {
    calls += 1;
    const error = new Error("fixture-api-key-secret /Users/private/provider/path");
    error.code = "TURN_VALIDATION_FAILED";
    throw error;
  } });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "TURN_GENERATION_FAILED");
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes("fixture-api-key-secret"), false);
  assert.equal(store.readView().revision, 0);
});

test("a thrown acknowledgement after COMMIT recovers the committed view without regeneration", async (t) => {
  const { store } = setup(t, { faultInjector(stage) {
    if (stage === "after_commit") throw new Error("lost acknowledgement fixture");
  } });
  let calls = 0;
  const coordinator = createTurnCoordinator({ store, generateTurn: async () => {
    calls += 1;
    return borrowBundle();
  } });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "committed");
  assert.equal(result.view.revision, 1);
  assert.deepEqual((await coordinator.runAction(request())).view, result.view);
  assert.equal(coordinator.cancelAction(request().actionId).status, "committed");
  assert.equal(calls, 1);
});

test("a rolled-back storage fault returns retryable failure, without automatic model retries", async (t) => {
  let inject = true;
  const { store } = setup(t, { faultInjector(stage) {
    if (inject && stage === "after_turn") throw new Error("private sqlite path fixture");
  } });
  let calls = 0;
  const coordinator = createTurnCoordinator({ store, generateTurn: async () => {
    calls += 1;
    return borrowBundle();
  } });
  const failed = await coordinator.runAction(request());
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "STORE_OPERATION_FAILED");
  assert.equal(failed.modelCalls, 1);
  assert.equal(calls, 1);
  assert.equal(store.readView().revision, 0);
  inject = false;
  assert.equal((await coordinator.runAction(request(), { retry: true })).status, "committed");
  assert.equal(calls, 2);
});

test("an unreadable committed view retains its exact revision for display-only recovery", async (t) => {
  const { store } = setup(t, { faultInjector(stage) {
    if (stage === "after_commit") throw new Error("lost acknowledgement fixture");
  } });
  let calls = 0;
  const coordinator = createTurnCoordinator({ store: { ...store,
    readView() { throw new Error("temporary projection failure"); },
  }, generateTurn: async () => { calls += 1; return borrowBundle(); } });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "committed");
  assert.equal(result.revision, 1);
  assert.equal(result.error.code, "VIEW_UNAVAILABLE");
  assert.equal(result.view, undefined);
  assert.equal(store.readView({ revision: result.revision }).state.inventory[0].quantity, 2);
  const repeated = await coordinator.runAction(request(), { retry: true });
  assert.equal(repeated.revision, 1);
  assert.equal(repeated.status, "committed");
  assert.equal(calls, 1);
});

test("unknown commit outcome stays unknown until a fresh store reads the durable receipt", async (t) => {
  let store;
  const environment = setup(t, { faultInjector(stage) {
    if (stage === "after_commit") {
      store.close();
      throw new Error("connection lost after commit fixture");
    }
  } });
  store = environment.store;
  let calls = 0;
  const coordinator = createTurnCoordinator({ store, generateTurn: async () => {
    calls += 1;
    return borrowBundle();
  } });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "unknown");
  assert.equal(result.error.code, "COMMIT_OUTCOME_UNKNOWN");
  const reopened = environment.reopen();
  assert.equal(reopened.readAction(request().actionId).status, "committed");
  const recovery = createTurnCoordinator({ store: reopened, generateTurn: async () => {
    calls += 1;
    return borrowBundle();
  } });
  assert.equal((await recovery.runAction(request(), { retry: true })).status, "committed");
  assert.equal(calls, 1);
});

test("an ended unknown attempt can be explicitly retried after a rolled-back commit and transient read failure", async (t) => {
  let inject = true;
  let unreadable = false;
  const { store } = setup(t, { faultInjector(stage) {
    if (inject && stage === "after_turn") {
      inject = false;
      unreadable = true;
      throw new Error("rollback fixture");
    }
  } });
  // All persistence operations still use the real SQLite store. This wrapper
  // injects transport/read availability failure, never a fabricated state.
  const connection = { ...store, readAction(actionId) {
    if (unreadable) throw new Error("temporarily unavailable read fixture");
    return store.readAction(actionId);
  } };
  let calls = 0;
  const coordinator = createTurnCoordinator({ store: connection, generateTurn: async () => {
    calls += 1;
    return borrowBundle();
  } });
  const unknown = await coordinator.runAction(request());
  assert.equal(unknown.error.code, "COMMIT_OUTCOME_UNKNOWN");
  assert.equal(store.readAction(request().actionId).status, "running");
  assert.equal(store.readView().revision, 0);
  const stillUnknown = await coordinator.runAction(request(), { retry: true });
  assert.equal(stillUnknown.status, "unknown");
  assert.equal(stillUnknown.modelCalls, 0);
  assert.equal(calls, 1);
  unreadable = false;
  assert.equal(coordinator.readAction(request().actionId).recoveryRequired, true);
  assert.equal(store.readAction(request().actionId).status, "running", "readAction must stay read-only");
  const query = await coordinator.runAction(request());
  assert.equal(query.status, "running");
  assert.equal(query.recoveryRequired, true);
  assert.equal(query.modelCalls, 0);
  const conflict = await coordinator.runAction(request({ input: "different immutable request" }), { retry: true });
  assert.equal(conflict.error.code, "ACTION_INPUT_CONFLICT");
  assert.equal(store.readAction(request().actionId).status, "running");
  const retried = await coordinator.runAction(request(), { retry: true });
  assert.equal(retried.status, "committed");
  assert.notEqual(retried.attemptId, unknown.attemptId);
  assert.equal(retried.modelCalls, 1);
  assert.equal(calls, 2);
  assert.equal(store.readView().revision, 1);
});

test("reconciling an unknown attempt returns a committed receipt without generating again", async (t) => {
  let unreadable = false;
  const { store } = setup(t, { faultInjector(stage) {
    if (stage === "after_commit") {
      unreadable = true;
      throw new Error("acknowledgement fixture");
    }
  } });
  const connection = { ...store, readAction(actionId) {
    if (unreadable) throw new Error("temporarily unavailable read fixture");
    return store.readAction(actionId);
  } };
  let calls = 0;
  const coordinator = createTurnCoordinator({ store: connection, generateTurn: async () => {
    calls += 1;
    return borrowBundle();
  } });
  assert.equal((await coordinator.runAction(request())).status, "unknown");
  unreadable = false;
  const receipt = coordinator.readAction(request().actionId);
  assert.equal(receipt.status, "committed");
  assert.equal(receipt.recoveryRequired, undefined);
  const repeat = await coordinator.runAction(request(), { retry: true });
  assert.equal(repeat.status, "committed");
  assert.equal(repeat.modelCalls, 0);
  assert.equal(calls, 1);
});

test("a previous unknown attempt cannot reclaim a newer live attempt in another coordinator", async (t) => {
  let firstRead = true;
  let inject = true;
  const { store, reopen } = setup(t, { faultInjector(stage) {
    if (inject && stage === "after_turn") {
      inject = false;
      throw new Error("rollback fixture");
    }
  } });
  const connection = { ...store, readAction(actionId) {
    if (firstRead) { firstRead = false; throw new Error("transient read fixture"); }
    return store.readAction(actionId);
  } };
  let firstCalls = 0;
  const first = createTurnCoordinator({ store: connection, generateTurn: async () => {
    firstCalls += 1;
    return borrowBundle();
  } });
  const unknown = await first.runAction(request());
  assert.equal(unknown.status, "unknown");
  // Another authorized recovery has settled the old attempt and begun a new
  // one. The first coordinator's stale ownership marker must not stop it.
  store.failAction({ actionId: request().actionId, attemptId: unknown.attemptId,
    code: "PROCESS_INTERRUPTED", retryable: true });
  const gate = deferred();
  const otherStore = reopen();
  const other = createTurnCoordinator({ store: otherStore, generateTurn: () => gate.promise });
  const pending = other.runAction(request(), { retry: true });
  await nextTick();
  const otherAttempt = otherStore.readAction(request().actionId).attemptId;
  assert.notEqual(otherAttempt, unknown.attemptId);
  const observed = await first.runAction(request(), { retry: true });
  assert.equal(observed.status, "running");
  assert.equal(observed.attemptId, otherAttempt);
  assert.equal(observed.recoveryRequired, undefined);
  assert.equal(observed.modelCalls, 0);
  assert.equal(firstCalls, 1);
  gate.resolve(borrowBundle());
  assert.equal((await pending).status, "committed");
});
