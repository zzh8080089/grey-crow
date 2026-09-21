"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { createTurnStore } = require("./turn-store");
const { appendContinuationBoundary } = require("./session-lineage");
const { createOpeningState } = require("./session-opening");
const { COMPACTION_LIMITS } = require("./session-compaction-store");
const { COMPACTION_QUOTE_FORMAT, COMPACTION_QUOTE_MAX_ITEMS, createCompactionQuotes } = require("./session-compaction-quotes");
const samples = require("./test-fixtures/turn-samples");

const settingsIdentity = "a".repeat(64);
function textBundle(text = "楼道里仍然安静。", id = "s") {
  return { narration: [{ id, text }], events: [], experiences: [] };
}
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-compaction-store-"));
  const databasePath = path.join(root, "story.sqlite");
  const stores = [];
  const identity = samples.identity(databasePath);
  function open(extra = {}) {
    const store = createTurnStore({ ...identity, ...extra }); stores.push(store); return store;
  }
  const store = open({ initialState: samples.initialState(), ...options });
  t.after(() => { for (const entry of stores) entry.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, databasePath, identity, store, open, stores };
}
function commit(store, bundle = textBundle(), input = "我留意身边的情况。") {
  const revision = store.readPlayerState().revision;
  const action = store.beginAction(samples.request({ actionId: `action-${revision + 1}`, baseRevision: revision, input }));
  try { return store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle }); }
  catch (error) {
    if (error.code !== "HISTORY_PAGE_TOO_LARGE") throw error;
    assert.equal(store.readAction(action.actionId).status, "committed");
    return store.readAction(action.actionId);
  }
}
function seed(store, count = 4) {
  commit(store, samples.borrowBundle());
  for (let i = 1; i < count; i++) commit(store, textBundle(`第${i + 1}次查看，借米约定还没有履行。`));
}
function optionsFor(store, overrides = {}) {
  const state = store.readCompactionState();
  return { requestId: "compact-1", revision: state.revision, input: "我去找陈姨。", viewerId: store.readPlayerState().state.situation.playerId,
    settingsIdentity, sourceHash: state.sourceHash, throughRevision: Math.max(1, state.revision - 2), contextGeneration: state.contextGeneration, ...overrides };
}
function quoteSummary(text, { adventureId = "test-adventure", revision = 1, segmentId = "borrow-text" } = {}) {
  return { format: COMPACTION_QUOTE_FORMAT, items: createCompactionQuotes({ adventureId, revision, segmentId, text }).slice(0, 1) };
}
function summary(adventureId = "test-adventure") {
  return quoteSummary(samples.borrowBundle().narration[0].text, { adventureId });
}
function rehash(quote) {
  quote.quoteId = "quote-" + createHash("sha256").update(JSON.stringify({ source: quote.source, range: quote.range, text: quote.text })).digest("hex");
  return quote;
}
function metrics(job, before = 10000, after = 2000, fits = true) {
  const usage = (value) => ({ adventureId: job.adventureId, revision: job.revision, actionId: null, scope: "next_request",
    settingsIdentity: job.settingsIdentity, contextGeneration: job.contextGeneration,
    latestEstimate: { inputTokens: value, safetyInputTokens: value, characters: value, bytes: value, callIndex: 0 }, fits });
  return { before: usage(before), after: usage(after), savedSafetyInputTokens: before - after };
}
function adopt(store, job, candidate = summary()) {
  return store.commitCompaction({ requestId: job.requestId, attemptId: job.attemptId, outcome: "reduced", summary: candidate, metrics: metrics(job) });
}
function fileHash(filename) { return createHash("sha256").update(fs.readFileSync(filename)).digest("hex"); }

test("48 original quotes survive adoption and reopen; expanded count never permits a forged final source", (t) => {
  const { store, open } = fixture(t);
  const narration = Array.from({ length: 48 }, (_, index) => ({ id: `s-${index}`, text: `第${index + 1}处的门仍没有打开。` }));
  commit(store, { narration, events: [], experiences: [] }); commit(store); commit(store);
  const before = store.readModelState(), original = store.readTurn(1);
  const candidate = { format: COMPACTION_QUOTE_FORMAT, items: narration.map(segment => createCompactionQuotes({
    adventureId: "test-adventure", revision: 1, segmentId: segment.id, text: segment.text })[0]) };
  assert.equal(COMPACTION_LIMITS.items, COMPACTION_QUOTE_MAX_ITEMS);
  const job = store.beginCompaction(optionsFor(store));
  const wrong = structuredClone(candidate);
  wrong.items.at(-1).source.segmentId = "not-in-the-story"; rehash(wrong.items.at(-1));
  assert.throws(() => adopt(store, job, wrong), { code: "COMPACTION_VALIDATION_FAILED" });
  assert.equal(store.readContextHistory().summary, null);
  adopt(store, job, candidate); store.close();
  const reopened = open();
  assert.deepEqual(reopened.readContextHistory().summary.items, candidate.items);
  assert.deepEqual(reopened.readModelState(), before); assert.deepEqual(reopened.readTurn(1), original);
});

test("the complete R1 history is replaced atomically with mixed textless and legacy experiences preserved on reopen", (t) => {
  const { store, databasePath, open } = fixture(t);
  const withoutText = samples.borrowBundle();
  delete withoutText.experiences[0].text;
  commit(store, withoutText);
  const oldExperience = { id: "old-observation", text: "  借米的约定尚未履行。\n", entityIds: ["p", "npc"],
    eventIds: [], sourceSegmentIds: ["s"], kind: "event", knownBy: ["p"] };
  commit(store, { ...textBundle("你没有归还借来的米，陈姨也没有催促。"), experiences: [oldExperience] });
  commit(store); commit(store);
  const rawExperiences = () => {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try { return db.prepare("SELECT revision,experience_id,body_json FROM experiences ORDER BY revision,experience_id").all(); }
    finally { db.close(); }
  };
  const originalRows = rawExperiences();
  assert.equal(Object.hasOwn(JSON.parse(originalRows[0].body_json), "text"), false);
  assert.deepEqual(JSON.parse(originalRows[1].body_json), oldExperience);
  const before = store.readContextHistory();
  assert.deepEqual(before.turns.map((turn) => turn.revision), [1, 2, 3, 4]);
  assert.equal(before.contextGeneration, 0); assert.equal(before.summary, null);
  const story = store.readView(); const facts = store.readModelState();
  const job = store.beginCompaction(optionsFor(store));
  assert.equal(job.started, true); assert.equal(job.status, "running"); assert.equal(job.summaryId, job.requestId);
  const candidate = summary(); const result = adopt(store, job, candidate);
  candidate.items[0].text = "caller mutation";
  const after = store.readContextHistory();
  assert.equal(result.outcome, "reduced"); assert.equal(result.status, "committed");
  assert.equal(after.contextGeneration, 1); assert.equal(after.sourceHash, before.sourceHash);
  assert.notEqual(after.materializationId, before.materializationId);
  assert.equal(after.summaryValidity, "valid");
  assert.deepEqual(Object.keys(after.summary).sort(), ["summaryId", "fromRevision", "throughRevision", "format", "items"].sort());
  assert.deepEqual(after.turns.map((turn) => turn.revision), [3, 4]);
  assert.doesNotMatch(JSON.stringify(after.summary), /caller mutation/);
  assert.deepEqual(store.readView(), story); assert.deepEqual(store.readModelState(), facts);
  assert.deepEqual(rawExperiences(), originalRows, "compaction does not synthesize or rewrite experience text");
  const digest = fileHash(databasePath);
  store.readContextHistory(); store.readCompactionState(); store.readCompactionJob(job.requestId);
  assert.equal(fileHash(databasePath), digest, "reads never adopt a summary or change an anchor");
  assert.doesNotMatch(JSON.stringify(after), /hidden_key|尚未露面的访客/);
  store.close();
  const restored = open();
  assert.deepEqual(restored.readContextHistory(), after);
  assert.equal(restored.readCompactionState().sourceHash, before.sourceHash);
  assert.deepEqual(rawExperiences(), originalRows);
  assert.deepEqual(restored.readModelState(), facts);
  const records = restored.listExperienceRecords({ revision: 4, viewerId: "p" }).records;
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].experience, withoutText.experiences[0]);
  assert.equal(Object.hasOwn(records[0].experience, "text"), false);
  assert.deepEqual(records[0].passages, withoutText.narration);
  assert.equal(records[0].playerInput, "我留意身边的情况。");
  assert.deepEqual(records[0].source, { adventureId: "test-adventure", revision: 1 });
  assert.deepEqual(records[1].experience, oldExperience);
});

test("opening questions are part of contiguous history, including while no player entity is confirmed", (t) => {
  const { store } = fixture(t, { initialState: createOpeningState() });
  commit(store, { narration: [{ id: "s", text: "在故事开始前，你叫什么名字？" }], events: [], experiences: [] }, "我想开始这段故事。");
  const history = store.readContextHistory();
  assert.equal(history.viewerId, null); assert.equal(history.summary, null);
  assert.equal(history.turns[0].revision, 1); assert.equal(history.turns[0].input, "我想开始这段故事。");
  assert.match(history.turns[0].narration[0].text, /叫什么名字/);
});

test("same request has immutable intent but a committed duplicate does not compare obsolete plan fields", (t) => {
  const { store } = fixture(t); seed(store);
  const original = optionsFor(store); const job = store.beginCompaction(original); adopt(store, job);
  const again = store.beginCompaction({ ...original, sourceHash: "0".repeat(64), contextGeneration: 99, throughRevision: 1, retry: true });
  assert.equal(again.started, false); assert.equal(again.status, "committed"); assert.equal(again.attemptId, job.attemptId);
  assert.throws(() => store.beginCompaction({ ...original, input: "偷偷换了输入" }), { code: "COMPACTION_INPUT_CONFLICT" });
  assert.throws(() => store.beginCompaction({ ...original, settingsIdentity: "b".repeat(64) }), { code: "COMPACTION_INPUT_CONFLICT" });
  const coercion = { toString() { throw new Error("must not coerce untrusted input"); } };
  assert.throws(() => store.beginCompaction({ ...original, settingsIdentity: coercion }), { code: "COMPACTION_INPUT_INVALID" });
  assert.throws(() => store.beginCompaction({ ...original, sourceHash: coercion }), { code: "COMPACTION_INPUT_INVALID" });
  assert.equal(store.readContextHistory().contextGeneration, 1);
});

test("manual compaction and actions exclude each other, while automatic compaction requires the exact active owner", (t) => {
  const env = fixture(t); seed(env.store);
  const oldAction = env.store.readAction("action-1");
  const plan = optionsFor(env.store); const manual = env.store.beginCompaction(plan);
  assert.throws(() => env.store.beginAction(samples.request({ actionId: "new", baseRevision: 4 })), { code: "COMPACTION_BUSY" });
  assert.equal(env.store.beginAction(oldAction.request).status, "committed", "a duplicate receipt is readable during compaction");
  env.store.cancelCompaction(manual.requestId);
  const action = env.store.beginAction(samples.request({ actionId: "new", baseRevision: 4 }));
  assert.throws(() => env.store.beginCompaction({ ...plan, requestId: "manual-2" }), { code: "COMPACTION_BUSY" });
  assert.throws(() => env.store.beginCompaction({ ...plan, requestId: "automatic", ownerActionId: action.actionId, ownerAttemptId: "wrong" }), { code: "COMPACTION_OWNER_MISMATCH" });
  const other = env.open();
  assert.throws(() => other.beginCompaction({ ...plan, requestId: "automatic", ownerActionId: action.actionId, ownerAttemptId: action.attemptId }), { code: "COMPACTION_OWNER_MISMATCH" });
  const automatic = env.store.beginCompaction({ ...plan, requestId: "automatic", ownerActionId: action.actionId, ownerAttemptId: action.attemptId });
  env.store.cancelAction(action.actionId);
  assert.throws(() => adopt(env.store, automatic), { code: "COMPACTION_OWNER_MISMATCH" });
  assert.equal(env.store.readContextHistory().contextGeneration, 0);
});

test("paused invocation budgets belong to the exact action and survive reopen without changing story state", (t) => {
  const { store, open } = fixture(t); seed(store);
  const state = store.readModelState();
  const action = store.beginAction(samples.request({ actionId: "with-tools", baseRevision: 4 }));
  const job = store.beginCompaction(optionsFor(store, { ownerActionId: action.actionId, ownerAttemptId: action.attemptId }));
  const complete = metrics(job);
  for (const usage of [complete.before, complete.after]) {
    usage.scope = "invocation"; usage.actionId = action.actionId; usage.latestEstimate.callIndex = 2;
  }
  const save = (value) => store.commitCompaction({ requestId: job.requestId, attemptId: job.attemptId,
    outcome: "reduced", summary: summary(), metrics: value });
  for (const change of [
    value => { value.before.actionId = value.after.actionId = "another-action"; },
    value => { value.after.scope = "next_request"; value.after.actionId = null; },
    value => { value.after.latestEstimate.callIndex = 3; },
    value => { value.before.latestEstimate.callIndex = value.after.latestEstimate.callIndex = 0; },
  ]) {
    const wrong = structuredClone(complete); change(wrong);
    assert.throws(() => save(wrong), { code: "COMPACTION_VALIDATION_FAILED" });
    assert.equal(store.readContextHistory().contextGeneration, 0);
  }
  assert.deepEqual(save(complete).metrics, complete);
  assert.deepEqual(store.readModelState(), state);
  store.close();
  const reopened = open();
  assert.deepEqual(reopened.readCompactionJob(job.requestId).metrics, complete);
  assert.equal(reopened.readContextHistory().contextGeneration, 1);
  assert.deepEqual(reopened.readModelState(), state);
});

test("manual compaction cannot claim another invocation's budget identity", (t) => {
  const { store } = fixture(t); seed(store);
  const job = store.beginCompaction(optionsFor(store));
  const wrong = metrics(job);
  for (const usage of [wrong.before, wrong.after]) {
    usage.scope = "invocation"; usage.actionId = "unowned-action"; usage.latestEstimate.callIndex = 2;
  }
  assert.throws(() => store.commitCompaction({ requestId: job.requestId, attemptId: job.attemptId,
    outcome: "reduced", summary: summary(), metrics: wrong }), { code: "COMPACTION_VALIDATION_FAILED" });
  assert.equal(store.readContextHistory().contextGeneration, 0);
});

test("explicit retry replaces only the failed attempt; cancellation is terminal and another request cannot bypass unresolved work", (t) => {
  const { store } = fixture(t); seed(store);
  const plan = optionsFor(store); const first = store.beginCompaction(plan);
  store.failCompaction({ requestId: first.requestId, attemptId: first.attemptId, code: "COMPACTION_TIMEOUT", retryable: true });
  const pending = store.readCompactionState().pendingJob;
  assert.equal(pending.input, plan.input); assert.equal(pending.inputHash, createHash("sha256").update(plan.input).digest("hex"));
  assert.equal(store.beginCompaction(plan).started, false);
  assert.throws(() => store.beginCompaction({ ...plan, requestId: "bypass" }), { code: "COMPACTION_BUSY" });
  const retry = store.beginCompaction({ ...plan, retry: true });
  assert.notEqual(retry.attemptId, first.attemptId);
  assert.throws(() => adopt(store, first), { code: "COMPACTION_ATTEMPT_STALE" });
  assert.equal(store.cancelCompaction(retry.requestId).status, "cancelled");
  assert.equal(store.beginCompaction({ ...plan, retry: true }).started, false);
  assert.throws(() => adopt(store, retry), { code: "COMPACTION_NOT_RUNNING" });
  assert.equal(store.readCompactionState().pendingJob, null);
});

test("close leaves interrupted work and a reopened store must explicitly retry; another live store cannot commit it", (t) => {
  const env = fixture(t); seed(env.store);
  const plan = optionsFor(env.store); const job = env.store.beginCompaction(plan);
  const other = env.open();
  assert.equal(other.readCompactionJob(job.requestId).status, "running");
  assert.throws(() => adopt(other, job), { code: "COMPACTION_OWNER_MISMATCH" });
  env.store.close();
  assert.equal(other.readCompactionJob(job.requestId).status, "interrupted");
  assert.equal(other.beginCompaction(plan).started, false);
  const retry = other.beginCompaction({ ...plan, retry: true }); adopt(other, retry);
  assert.equal(other.readContextHistory().contextGeneration, 1);
});

test("an actual exited process leaves a recoverable receipt and no adopted summary", (t) => {
  const env = fixture(t); seed(env.store); env.store.close();
  const source = `const {createTurnStore}=require(${JSON.stringify(require.resolve("./turn-store"))});
    const store=createTurnStore(${JSON.stringify(env.identity)});
    const state=store.readCompactionState();
    const job=store.beginCompaction({requestId:'crashed',revision:4,input:'继续',viewerId:'p',settingsIdentity:'${settingsIdentity}',sourceHash:state.sourceHash,throughRevision:2,contextGeneration:0});
    process.stdout.write(JSON.stringify(job)); process.exit(0);`;
  const job = JSON.parse(execFileSync(process.execPath, ["-e", source], { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] }));
  const reopened = env.open();
  assert.equal(reopened.readCompactionJob(job.requestId).status, "interrupted");
  assert.equal(reopened.readContextHistory().summary, null);
  const retried = reopened.beginCompaction(optionsFor(reopened, { requestId: job.requestId, input: "继续", retry: true }));
  assert.notEqual(retried.attemptId, job.attemptId); adopt(reopened, retried);
  assert.equal(reopened.readContextHistory().contextGeneration, 1);
});

test("acquisition tokens identify only the attempt actually started, without letting a duplicate caller claim it", (t) => {
  const env = fixture(t); seed(env.store);
  const plan = optionsFor(env.store);
  const first = env.store.beginCompaction({ ...plan, acquisitionId: "service-one-token" });
  assert.equal(first.acquisitionId, "service-one-token"); assert.equal(first.ownedHere, true);
  const sameStoreOtherService = env.store.beginCompaction({ ...plan, acquisitionId: "service-two-token" });
  assert.equal(sameStoreOtherService.started, false); assert.equal(sameStoreOtherService.ownedHere, true);
  assert.equal(sameStoreOtherService.acquisitionId, "service-one-token", "another service cannot overwrite the active acquisition");
  const otherStore = env.open();
  assert.equal(otherStore.readCompactionJob(plan.requestId).ownedHere, false);
  assert.equal(otherStore.readCompactionJob(plan.requestId).acquisitionId, "service-one-token");
  env.store.failCompaction({ requestId: first.requestId, attemptId: first.attemptId, code: "COMPACTION_INTERRUPTED" });
  const retried = env.store.beginCompaction({ ...plan, acquisitionId: "service-one-retry", retry: true });
  assert.notEqual(retried.attemptId, first.attemptId); assert.equal(retried.acquisitionId, "service-one-retry");
  assert.throws(() => adopt(env.store, first), { code: "COMPACTION_ATTEMPT_STALE" });
  adopt(env.store, retried);
  const duplicate = env.store.beginCompaction({ ...plan, acquisitionId: "later-token", retry: true });
  assert.equal(duplicate.acquisitionId, "service-one-retry"); assert.equal(duplicate.status, "committed");
});

test("existing summary receipts survive the narrow acquisition-column upgrade", (t) => {
  const env = fixture(t); seed(env.store);
  const job = env.store.beginCompaction(optionsFor(env.store)); adopt(env.store, job);
  const before = env.store.readContextHistory(); env.store.close();
  const db = new DatabaseSync(env.databasePath);
  try { db.exec("ALTER TABLE context_compactions DROP COLUMN acquisition_id"); } finally { db.close(); }
  const reopened = env.open();
  assert.deepEqual(reopened.readContextHistory(), before);
  const receipt = reopened.readCompactionJob(job.requestId);
  assert.equal(receipt.status, "committed"); assert.equal(receipt.acquisitionId, null); assert.equal(receipt.ownedHere, false);
});

test("old generated summaries invalidate their coverage without rewriting the old receipt or original story", (t) => {
  const env = fixture(t); seed(env.store);
  const originalTurns = env.store.readContextHistory().turns;
  const job = env.store.beginCompaction(optionsFor(env.store)); adopt(env.store, job); env.store.close();
  const db = new DatabaseSync(env.databasePath);
  let oldSummary;
  try {
    const body = JSON.parse(db.prepare("SELECT result_json FROM context_compactions WHERE request_id=?").get(job.requestId).result_json);
    oldSummary = { summaryId: job.requestId, fromRevision: 1, throughRevision: 2, items: [{ text: "旧的模型概括，不是原话。",
      kind: "event", entityIds: ["p"], sources: [{ adventureId: "test-adventure", revision: 1, segmentId: "borrow-text" }] }] };
    body.summary = oldSummary; delete body.format;
    db.prepare("UPDATE context_compactions SET result_json=? WHERE request_id=?").run(JSON.stringify(body), job.requestId);
  } finally { db.close(); }
  const store = env.open(), digest = fileHash(env.databasePath);
  const history = store.readContextHistory();
  assert.equal(history.summaryValidity, "invalidated"); assert.equal(history.summary, null);
  assert.deepEqual(history.turns, originalTurns);
  assert.deepEqual(store.readCompactionJob(job.requestId).summary, oldSummary);
  assert.equal(fileHash(env.databasePath), digest, "invalidation is a read-only materialization, not migration");
  const fresh = store.beginCompaction(optionsFor(store, { requestId: "new-quotes" }));
  adopt(store, fresh);
  assert.equal(store.readContextHistory().summary.format, COMPACTION_QUOTE_FORMAT);
  assert.deepEqual(store.readCompactionJob(job.requestId).summary, oldSummary);
});

test("narration-only source-quotes-1 invalidates on reopen and restores omitted original player inputs without rewriting its receipt", (t) => {
  const env = fixture(t); seed(env.store);
  const originalTurns = env.store.readContextHistory().turns;
  const job = env.store.beginCompaction(optionsFor(env.store)); adopt(env.store, job); env.store.close();
  const db = new DatabaseSync(env.databasePath);
  let oldSummary;
  try {
    const body = JSON.parse(db.prepare("SELECT result_json FROM context_compactions WHERE request_id=?").get(job.requestId).result_json);
    body.format = "source-quotes-1"; body.summary.format = "source-quotes-1";
    for (const quote of body.summary.items) { delete quote.source.kind; rehash(quote); }
    oldSummary = body.summary;
    db.prepare("UPDATE context_compactions SET result_json=? WHERE request_id=?").run(JSON.stringify(body), job.requestId);
  } finally { db.close(); }
  const store = env.open(), digest = fileHash(env.databasePath);
  const history = store.readContextHistory();
  assert.equal(history.summaryValidity, "invalidated"); assert.equal(history.summary, null);
  assert.deepEqual(history.turns, originalTurns);
  assert.equal(history.turns[0].input, "我留意身边的情况。");
  assert.deepEqual(store.readCompactionJob(job.requestId).summary, oldSummary);
  assert.equal(fileHash(env.databasePath), digest);
});

test("a stored quote with rewritten text and a matching self-generated hash still invalidates on source verification", (t) => {
  const env = fixture(t); seed(env.store);
  const job = env.store.beginCompaction(optionsFor(env.store)); adopt(env.store, job); env.store.close();
  const db = new DatabaseSync(env.databasePath);
  try {
    const body = JSON.parse(db.prepare("SELECT result_json FROM context_compactions WHERE request_id=?").get(job.requestId).result_json);
    body.summary.items[0] = quoteSummary("陈姨从未借米，这一句不在原文里。").items[0];
    db.prepare("UPDATE context_compactions SET result_json=? WHERE request_id=?").run(JSON.stringify(body), job.requestId);
  } finally { db.close(); }
  const store = env.open(), digest = fileHash(env.databasePath);
  const history = store.readContextHistory();
  assert.equal(history.summaryValidity, "invalidated"); assert.equal(history.summary, null);
  assert.equal(history.turns.length, 4);
  assert.equal(history.turns[0].narration[0].text, samples.borrowBundle().narration[0].text);
  assert.equal(fileHash(env.databasePath), digest);
});

for (const stage of ["after_compaction_result", "after_compaction_job", "after_compaction_commit"]) {
  test(`a fault at ${stage} preserves atomic coverage and supports receipt readback`, (t) => {
    let injected = false;
    const { store } = fixture(t, { faultInjector(name) { if (name === stage && !injected) { injected = true; throw new Error("synthetic fault"); } } });
    seed(store); const before = store.readContextHistory(); const job = store.beginCompaction(optionsFor(store));
    assert.throws(() => adopt(store, job), /synthetic fault/);
    const persisted = store.readCompactionJob(job.requestId);
    if (stage === "after_compaction_commit") {
      assert.equal(persisted.status, "committed"); assert.equal(store.readContextHistory().contextGeneration, 1);
      assert.equal(adopt(store, job).status, "committed");
    } else {
      assert.equal(persisted.status, "running"); assert.equal(persisted.metrics, undefined);
      assert.deepEqual(store.readContextHistory(), before);
      adopt(store, job); assert.equal(store.readContextHistory().contextGeneration, 1);
    }
    assert.equal(store.readPlayerState().revision, 4);
  });
}

test("no-benefit receipts do not adopt coverage, and suppress only the same source/settings/input", (t) => {
  const { store } = fixture(t); seed(store);
  const plan = optionsFor(store); const before = store.readContextHistory(); const job = store.beginCompaction(plan);
  const result = store.commitCompaction({ requestId: job.requestId, attemptId: job.attemptId, outcome: "no_benefit", metrics: metrics(job, 2000, 2500) });
  assert.equal(result.metrics.savedSafetyInputTokens, -500); assert.equal(result.outcome, "no_benefit");
  assert.equal(result.format, COMPACTION_QUOTE_FORMAT);
  assert.equal(store.readCompactionState().lastCompleted.format, COMPACTION_QUOTE_FORMAT);
  assert.deepEqual(store.readContextHistory(), before);
  assert.equal(store.beginCompaction(plan).started, false);
  assert.throws(() => store.beginCompaction({ ...plan, requestId: "repeat-cost" }), { code: "COMPACTION_ALREADY_EVALUATED" });
  const next = store.beginCompaction({ ...plan, requestId: "new-input", input: "短输入" });
  store.cancelCompaction(next.requestId);
  const settings = store.beginCompaction({ ...plan, requestId: "new-settings", settingsIdentity: "b".repeat(64) });
  assert.equal(settings.started, true);
  const last = store.readCompactionState().lastCompleted;
  assert.equal(last.settingsIdentity, plan.settingsIdentity); assert.equal(last.inputHash, job.inputHash);
});

test("old no-benefit receipts allow the source-selection format to be evaluated while current-format receipts still suppress duplicates", (t) => {
  for (const previousFormat of [undefined, "source-quotes-1"]) {
  const env = fixture(t); seed(env.store);
  const job = env.store.beginCompaction(optionsFor(env.store));
  env.store.commitCompaction({ requestId: job.requestId, attemptId: job.attemptId, outcome: "no_benefit", metrics: metrics(job, 2000, 2500) });
  env.store.close();
  const db = new DatabaseSync(env.databasePath);
  let oldBody;
  try {
    oldBody = JSON.parse(db.prepare("SELECT result_json FROM context_compactions WHERE request_id=?").get(job.requestId).result_json);
    if (previousFormat === undefined) delete oldBody.format;
    else oldBody.format = previousFormat;
    db.prepare("UPDATE context_compactions SET result_json=? WHERE request_id=?").run(JSON.stringify(oldBody), job.requestId);
  } finally { db.close(); }
  const store = env.open();
  assert.equal(store.readCompactionState().lastCompleted.format, previousFormat ?? null);
  const fresh = store.beginCompaction(optionsFor(store, { requestId: "quotes-reconsider" }));
  assert.equal(fresh.started, true);
  store.commitCompaction({ requestId: fresh.requestId, attemptId: fresh.attemptId, outcome: "no_benefit", metrics: metrics(fresh, 2000, 2500) });
  assert.throws(() => store.beginCompaction(optionsFor(store, { requestId: "quotes-repeat" })), { code: "COMPACTION_ALREADY_EVALUATED" });
  const old = store.readCompactionJob(job.requestId);
  assert.equal(old.format, previousFormat); assert.deepEqual(old.metrics, oldBody.metrics);
  }
});

test("only explicit invalidation clears obsolete unresolved work after the story advances", (t) => {
  const { store } = fixture(t); seed(store);
  const plan = optionsFor(store); const job = store.beginCompaction(plan);
  store.failCompaction({ requestId: job.requestId, attemptId: job.attemptId, code: "COMPACTION_MODEL_FAILED" });
  commit(store);
  assert.equal(store.readCompactionState().pendingJob.revision, 4);
  assert.throws(() => store.beginCompaction({ ...plan, retry: true }), { code: "COMPACTION_PLAN_STALE" });
  assert.throws(() => store.beginCompaction(optionsFor(store, { requestId: "new-plan" })), { code: "COMPACTION_BUSY" });
  store.invalidateCompaction({ requestId: job.requestId });
  assert.equal(store.readCompactionState().pendingJob, null);
  assert.equal(store.beginCompaction(optionsFor(store, { requestId: "new-plan" })).started, true);
  assert.throws(() => store.invalidateCompaction({ requestId: "new-plan" }), { code: "COMPACTION_BUSY" });
});

test("provider failures retain pending recovery and permit explicit invalidation after settings change", (t) => {
  const { store } = fixture(t); seed(store);
  const job = store.beginCompaction(optionsFor(store));
  store.failCompaction({ requestId: job.requestId, attemptId: job.attemptId, code: "UPSTREAM_AUTH_ERROR", retryable: false });
  assert.equal(store.readCompactionState().pendingJob.requestId, job.requestId);
  assert.throws(() => store.beginCompaction(optionsFor(store, { requestId: "unrelated-new-job" })), { code: "COMPACTION_BUSY" });
  assert.throws(() => store.invalidateCompaction({ requestId: job.requestId }), { code: "COMPACTION_INPUT_CONFLICT" });
  store.invalidateCompaction({ requestId: job.requestId, settingsIdentity: "b".repeat(64) });
  assert.equal(store.readCompactionState().pendingJob, null);
  assert.equal(store.beginCompaction(optionsFor(store, { requestId: "reconfigured-job", settingsIdentity: "b".repeat(64) })).started, true);
});

test("manual invalidation accepts changed normalized settings but cannot discard a live or still-current plan", (t) => {
  const { store } = fixture(t); seed(store);
  const plan = optionsFor(store); const job = store.beginCompaction(plan);
  assert.throws(() => store.invalidateCompaction({ requestId: job.requestId, settingsIdentity: "b".repeat(64) }), { code: "COMPACTION_BUSY" });
  store.failCompaction({ requestId: job.requestId, attemptId: job.attemptId, code: "COMPACTION_MODEL_FAILED" });
  assert.throws(() => store.invalidateCompaction({ requestId: job.requestId }), { code: "COMPACTION_INPUT_CONFLICT" });
  assert.throws(() => store.invalidateCompaction({ requestId: job.requestId, settingsIdentity }), { code: "COMPACTION_INPUT_CONFLICT" });
  assert.throws(() => store.invalidateCompaction({ requestId: job.requestId, settingsIdentity: "untrusted" }), { code: "COMPACTION_INPUT_INVALID" });
  const old = store.invalidateCompaction({ requestId: job.requestId, settingsIdentity: "b".repeat(64) });
  assert.deepEqual(old.error, { code: "COMPACTION_PLAN_STALE", retryable: false });
  const next = store.beginCompaction(optionsFor(store, { requestId: "new-settings-plan", settingsIdentity: "b".repeat(64) }));
  assert.equal(next.started, true); adopt(store, next);
});

test("summary quotes must match actual committed source text, original ranges and adventure identity even with a recomputed hash", (t) => {
  const { store } = fixture(t); seed(store);
  const job = store.beginCompaction(optionsFor(store));
  const changes = [
    (candidate) => { candidate.items[0].source.adventureId = "other"; rehash(candidate.items[0]); },
    (candidate) => { candidate.items[0].source.revision = 3; rehash(candidate.items[0]); },
    (candidate) => { candidate.items[0].source.segmentId = "missing"; rehash(candidate.items[0]); },
    (candidate) => { candidate.items[0].source.experienceId = "missing"; },
    (candidate) => { candidate.items[0].kind = "belief"; },
    (candidate) => { candidate.items[0].entityIds = ["secret"]; },
    (candidate) => { candidate.items.push(structuredClone(candidate.items[0])); },
    (candidate) => { candidate.items[0] = quoteSummary("陈姨肯定借了二十袋米。").items[0]; },
    (candidate) => { const item = candidate.items[0]; item.text = item.text.slice(1); item.range.start = 1; rehash(item); },
    (candidate) => { candidate.items[0].range.totalCharacters++; rehash(candidate.items[0]); },
    (candidate) => { candidate.items[0].text = "x".repeat(COMPACTION_LIMITS.itemCharacters + 1); },
    (candidate) => { Object.defineProperty(candidate.items[0], "text", { get() { throw new Error("getter must never run"); } }); },
  ];
  for (const change of changes) {
    const candidate = summary(); change(candidate);
    assert.throws(() => adopt(store, job, candidate), { code: "COMPACTION_VALIDATION_FAILED" });
    assert.equal(store.readContextHistory().summary, null);
  }
  adopt(store, job); assert.equal(store.readContextHistory().summaryValidity, "valid");
});

test("private experience text cannot be substituted for the publicly narrated source", (t) => {
  const { store } = fixture(t);
  const bundle = samples.borrowBundle();
  bundle.experiences.push({ id: "private", text: "PRIVATE_NPC_MEMORY", entityIds: ["npc"], eventIds: [], sourceSegmentIds: ["borrow-text"], kind: "belief", knownBy: ["npc"] });
  commit(store, bundle); commit(store); commit(store); commit(store);
  const job = store.beginCompaction(optionsFor(store));
  const candidate = quoteSummary("PRIVATE_NPC_MEMORY");
  assert.throws(() => adopt(store, job, candidate), { code: "COMPACTION_VALIDATION_FAILED" });
  assert.doesNotMatch(JSON.stringify(store.readContextHistory()), /PRIVATE_NPC_MEMORY/);
});

test("self-introduction and attempted actions remain exact player input, distinct from an NPC reply and without creating facts", (t) => {
  const env = fixture(t), { store } = env;
  const input = "我是食堂的小沈。我不开门，试着问能不能拿一袋米，没有自己伸手。";
  const narration = "你隔着门问了一句。门外的人很哑地回了一声“小沈？”，并没有递东西。";
  commit(store, textBundle(narration, "front"), input); commit(store); commit(store); commit(store);
  const originalState = store.readModelState(), originalTurn = store.readTurn(1);
  const job = store.beginCompaction(optionsFor(store));
  const playerQuote = createCompactionQuotes({ adventureId: "test-adventure", revision: 1, kind: "player_input", text: input })[0];
  const narrativeQuote = createCompactionQuotes({ adventureId: "test-adventure", revision: 1, segmentId: "front", text: narration })[0];
  const candidate = { format: COMPACTION_QUOTE_FORMAT, items: [narrativeQuote, playerQuote] };
  const falseQuotes = [
    createCompactionQuotes({ ...playerQuote.source, text: "我已经拿到了一袋米。" })[0],
    createCompactionQuotes({ ...narrativeQuote.source, text: input })[0],
    createCompactionQuotes({ ...playerQuote.source, text: narration })[0],
    createCompactionQuotes({ ...narrativeQuote.source, segmentId: "missing", text: narration })[0],
    createCompactionQuotes({ ...playerQuote.source, adventureId: "another-story", text: input })[0],
  ];
  for (const quote of falseQuotes) {
    assert.throws(() => adopt(store, job, { format: COMPACTION_QUOTE_FORMAT, items: [quote] }), { code: "COMPACTION_VALIDATION_FAILED" });
  }
  adopt(store, job, candidate);
  assert.deepEqual(store.readModelState(), originalState);
  assert.deepEqual(store.readTurn(1), originalTurn);
  assert.deepEqual(store.readContextHistory().summary.items, candidate.items);
  assert.deepEqual(candidate.items[1].source, { adventureId: "test-adventure", revision: 1, kind: "player_input" });
  store.close();
  const restored = env.open();
  assert.deepEqual(restored.readContextHistory().summary.items, candidate.items);
  assert.deepEqual(restored.readModelState(), originalState);
});

test("visible corrections invalidate the entire summary prefix, while private corrections and historical reads do not", (t) => {
  const { store } = fixture(t);
  const first = samples.borrowBundle();
  first.narration.push({ id: "claim", text: "陈姨说箱子是蓝色的，尚未核实。" });
  first.experiences.push({ id: "box", text: "箱子据说是蓝色。", kind: "claim", knownBy: ["p"], entityIds: ["npc"], eventIds: [], sourceSegmentIds: ["claim"] });
  commit(store, first); commit(store); commit(store); commit(store);
  const job = store.beginCompaction(optionsFor(store));
  // The item refers only to the borrowing segment. Corrections elsewhere in
  // the covered prefix must still invalidate its adopted coverage.
  adopt(store, job); const old = store.readContextHistory();
  const correction = (knownBy, id) => ({ ...textBundle("箱子的颜色有了新的说法。", "correct"), experiences: [{ id, text: "箱子实际是黑色。",
    kind: "event", knownBy, entityIds: ["npc"], eventIds: [], sourceSegmentIds: ["correct"], supersedes: [{ revision: 1, experienceId: "box" }] }] });
  commit(store, correction(["npc"], "private-correction"));
  assert.equal(store.readContextHistory().summaryValidity, "valid");
  commit(store, correction(["p"], "public-correction"));
  const corrected = store.readContextHistory();
  assert.equal(corrected.summaryValidity, "invalidated"); assert.equal(corrected.summary, null);
  assert.deepEqual(corrected.turns.map((turn) => turn.revision), [1, 2, 3, 4, 5, 6]);
  assert.equal(corrected.contextGeneration, old.contextGeneration);
  assert.notEqual(corrected.materializationId, old.materializationId);
  assert.deepEqual(store.readContextHistory({ revision: 4 }), old);
  const rebuild = store.beginCompaction(optionsFor(store, { requestId: "rebuild" }));
  const falseOld = quoteSummary("箱子是蓝色。", { segmentId: "claim" });
  assert.throws(() => adopt(store, rebuild, falseOld), { code: "COMPACTION_VALIDATION_FAILED" });
  adopt(store, rebuild); assert.equal(store.readContextHistory().contextGeneration, 2);
});

test("adoption validates actual metric identity and measured reduction without advancing coverage on false claims", (t) => {
  const { store } = fixture(t); seed(store); const job = store.beginCompaction(optionsFor(store));
  const mutations = [
    (value) => { value.after.adventureId = "wrong"; }, (value) => { value.after.revision++; },
    (value) => { value.before.settingsIdentity = "b".repeat(64); }, (value) => { value.after.contextGeneration++; },
    (value) => { value.after.latestEstimate.bytes = -1; }, (value) => { value.after.latestEstimate.safetyInputTokens = 10000; value.savedSafetyInputTokens = 0; },
    (value) => { value.after.fits = false; }, (value) => { value.savedSafetyInputTokens = 99999; },
  ];
  for (const mutate of mutations) {
    const value = metrics(job); mutate(value);
    assert.throws(() => store.commitCompaction({ requestId: job.requestId, attemptId: job.attemptId, outcome: "reduced", summary: summary(), metrics: value }), { code: "COMPACTION_VALIDATION_FAILED" });
  }
  assert.equal(store.readContextHistory().summary, null); adopt(store, job);
});

test("history limits apply to returned summary and suffix, not the already summarized original bytes", (t) => {
  const { store } = fixture(t);
  const huge = { narration: [...Array.from({ length: 15 }, (_, index) => ({ id: `long-${index}`, text: "x".repeat(200000) }))], events: [], experiences: [] };
  for (let i = 0; i < 3; i++) commit(store, huge);
  commit(store); commit(store);
  assert.throws(() => store.readContextHistory(), { code: "CONTEXT_HISTORY_TOO_LARGE" });
  const job = store.beginCompaction(optionsFor(store, { throughRevision: 3 }));
  adopt(store, job, quoteSummary(huge.narration[0].text, { segmentId: "long-0" }));
  const after = store.readContextHistory({ maxCharacters: 4000 });
  assert.equal(after.summaryValidity, "valid"); assert.deepEqual(after.turns.map((turn) => turn.revision), [4, 5]);
  assert.ok(JSON.stringify(after).length < 4000);
  assert.throws(() => store.readContextHistory({ maxCharacters: 10 }), { code: "CONTEXT_HISTORY_TOO_LARGE" });
  assert.throws(() => store.readContextHistory({ revision: 3 }), { code: "CONTEXT_HISTORY_TOO_LARGE" });
});

test("a summary is inherited by child and grandchild with original sources; controller receipts are local to each adventure", (t) => {
  const env = fixture(t); const parent = env.store; seed(parent);
  const parentSummary = summary();
  parentSummary.items.push(...createCompactionQuotes({ adventureId: env.identity.adventureId, revision: 1, kind: "player_input", text: "我留意身边的情况。" }));
  const job = parent.beginCompaction(optionsFor(parent, { requestId: "shared-id" })); adopt(parent, job, parentSummary);
  const ending = (store, name) => {
    const ask = textBundle("这段旅程可以在这里结束。", "ask");
    ask.events.push({ id: "offer", type: "finale.propose", sourceSegmentIds: ["ask"], data: { candidateId: name, closureReason: "故事暂告段落。", closedThreads: ["这段旅程的选择已经落定。"], intentionalOpenThreads: [], finaleTone: "平静" } });
    commit(store, ask);
    const last = textBundle("你合上了这段旅程。", "last");
    last.events.push({ id: "confirm", type: "finale.confirm", sourceSegmentIds: ["last"], data: { candidateId: name } });
    commit(store, last); const revision = store.readPlayerState().revision;
    const chapter = store.beginChapter({ targetRevision: revision });
    store.commitChapter({ chapterId: chapter.chapterId, attemptId: chapter.attemptId, chapter: { title: "暂别", summary: "这段旅程告一段落。",
      keyEvents: [{ text: "你结束了这段旅程。", sources: [{ revision, segmentId: "last" }] }], openThreads: [], mode: "excerpt", fallbackReason: "CHAPTER_MODEL_UNAVAILABLE" } });
    store.sealFinale({ finaleId: `finale-${revision}`, chapterId: chapter.chapterId }); return revision;
  };
  const parentRevision = ending(parent, "parent-end"); parent.close(); const digest = fileHash(env.databasePath);
  function fork(fromPath, parentAdventureId, childAdventureId, parentRevision) {
    const databasePath = path.join(env.root, `${childAdventureId}.sqlite`); fs.copyFileSync(fromPath, databasePath);
    const db = new DatabaseSync(databasePath);
    try { appendContinuationBoundary(db, { parentAdventureId, childAdventureId, parentRevision, sourceFinaleId: `finale-${parentRevision}`,
      requestId: `fork-${childAdventureId}`, createdAt: "2026-09-10T12:00:00.000Z" }); } finally { db.close(); }
    const store = createTurnStore({ ...env.identity, databasePath, adventureId: childAdventureId }); env.stores.push(store);
    return { store, databasePath };
  }
  const child = fork(env.databasePath, env.identity.adventureId, "child", parentRevision);
  const inherited = child.store.readContextHistory();
  assert.equal(inherited.summaryValidity, "valid"); assert.equal(inherited.contextGeneration, 1);
  assert.equal(inherited.summary.items[0].source.adventureId, env.identity.adventureId);
  assert.deepEqual(inherited.summary.items[1].source, { adventureId: env.identity.adventureId, revision: 1, kind: "player_input" });
  assert.equal(child.store.readCompactionJob("shared-id"), null); assert.equal(child.store.readCompactionState().lastCompleted, null);
  assert.deepEqual(inherited.timeline.systemRevisions, [7]);
  commit(child.store, samples.returnBundle()); commit(child.store);
  const local = child.store.beginCompaction(optionsFor(child.store, { requestId: "shared-id" }));
  const merged = summary();
  merged.items.push(...createCompactionQuotes({ adventureId: "child", revision: 8, segmentId: "return-text", text: samples.returnBundle().narration[0].text }));
  // throughRevision defaults to R-2 (the boundary), so it cannot cite R8 yet.
  assert.throws(() => adopt(child.store, local, merged), { code: "COMPACTION_VALIDATION_FAILED" });
  const impersonated = { format: COMPACTION_QUOTE_FORMAT, items: createCompactionQuotes({ adventureId: "child", revision: 1, kind: "player_input", text: "我留意身边的情况。" }) };
  assert.throws(() => adopt(child.store, local, impersonated), { code: "COMPACTION_VALIDATION_FAILED" });
  adopt(child.store, local, parentSummary);
  assert.equal(child.store.readContextHistory().contextGeneration, 2);
  const childRevision = ending(child.store, "child-end"); child.store.close();
  const grandchild = fork(child.databasePath, "child", "grandchild", childRevision);
  const history = grandchild.store.readContextHistory();
  assert.equal(history.summaryValidity, "valid"); assert.equal(history.contextGeneration, 2);
  assert.deepEqual(history.summary.items, parentSummary.items);
  assert.deepEqual(history.timeline.systemRevisions, [7, 12]);
  assert.equal(history.turns.find((turn) => turn.revision === 8).source.adventureId, "child");
  assert.equal(grandchild.store.readCompactionJob("shared-id"), null);
  fs.unlinkSync(child.databasePath);
  assert.equal(grandchild.store.readContextHistory().summaryValidity, "valid");
  assert.equal(fileHash(env.databasePath), digest, "the parent remains unchanged");
});
