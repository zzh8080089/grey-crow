"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTurnGenerator } = require("./turn-generator");
const { createTurnStore } = require("./turn-store");
const { createTurnCoordinator } = require("./turn-coordinator");
const { createTurnMemory } = require("./turn-memory");
const { createOpeningState } = require("./session-opening");
const { createOpenAICompatibleProvider } = require("../providers/openai-compatible");
const { normalizeSessionContextOptions, countSessionContext } = require("./session-context");
const { COMPACTION_QUOTE_FORMAT } = require("./session-compaction-quotes");
const { initialState, borrowBundle, refusedBundle, request, identity } = require("./test-fixtures/turn-samples");

function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-generator-"));
  const databasePath = path.join(directory, "adventure.sqlite");
  const store = createTurnStore({ ...identity(databasePath), initialState: options.initialState ?? initialState(), ...options.storeOptions });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const providerCalls = [];
  const recalls = [];
  const provider = { async generate(input) {
    providerCalls.push(input);
    return options.respond ? options.respond(input, providerCalls.length) : reply(borrowBundle());
  } };
  const memory = { async recall(input) {
    recalls.push(input);
    return options.recall ? options.recall(input) : { revision: input.revision, results: [], truncated: false };
  } };
  const generator = createTurnGenerator({ provider, store, memory, adventureId: "test-adventure",
    hostText: "克制具体。旧指令：调用 finalize_new_game 写入状态。", worldText: "上海第十天。",
    ...(options.contextHistory ? { store: { ...store, readContextHistory: (args) => options.contextHistory(store, args) } } : {}),
    ...(options.fragmentPage ? { store: { ...store, readMemoryFragments: (args) => options.fragmentPage(store, args) } } : {}),
    ...(options.conditionPage ? { store: { ...store, readConditionSource: (args) => options.conditionPage(store, args) } } : {}),
    ...(options.recordExecution ? { store: { ...store, recordExecution: options.recordExecution } } : {}),
    ...options.config });
  return { store, generator, providerCalls, recalls, databasePath,
    args: (overrides = {}) => ({ attemptId: "attempt-one", request: request(), state: store.readModelState({ revision: 0 }), ...overrides }) };
}

function reply(bundle, options = {}) {
  return { text: JSON.stringify(bundle), usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 },
    finishReason: "stop", ...options };
}

function assertToolFailure(packet, code) {
  assert.deepEqual(Object.keys(packet), ["error"]);
  assert.equal(packet.error.code, code);
  assert(Array.isArray(packet.error.feedback) && packet.error.feedback.length > 0);
  assert(packet.error.feedback.every(issue => typeof issue.path === "string" && typeof issue.repair === "string"));
}

function tools(calls, options = {}) {
  return reply(null, { text: "", toolCalls: calls, finishReason: "tool_calls", ...options });
}

test("execution metadata records the sent request and ordered tools and repairs without their source text", async (t) => {
  const snapshots = [];
  const env = setup(t, { recordExecution(value) { snapshots.push(structuredClone(value)); return true; },
    respond(input, index) {
      if (index === 1) return tools([{ id: "private-call-id", name: "read_entity", arguments: JSON.stringify({ entityId: "p" }) }],
        { transportState: { privateReasoning: "must-never-enter-diagnostics" } });
      if (index === 2) return { text: "private malformed response", finishReason: "stop" };
      return reply(borrowBundle());
    } });
  assert.deepEqual(await env.generator.generateTurn(env.args()), borrowBundle());
  assert.ok(snapshots.length > 0, "each actual attempt needs bounded durable diagnostic metadata");
  const last = snapshots.at(-1);
  assert.deepEqual(last.steps.map(step => `${step.kind}:${step.outcome}`), [
    "model:invoked", "model:returned", "tool:invoked", "tool:returned",
    "model:invoked", "model:returned", "repair:requested", "model:invoked", "model:returned",
  ]);
  const { signal, ...sent } = env.providerCalls[0];
  const serialized = JSON.stringify(sent);
  assert.equal(last.steps[0].request.sha256, require("node:crypto").createHash("sha256").update(serialized).digest("hex"));
  assert.equal(last.steps[0].request.characters, serialized.length);
  assert.equal(last.steps[0].request.bytes, Buffer.byteLength(serialized));
  assert.equal(last.steps[5].usageComplete, false);
  assert.equal(last.steps[5].usage, null);
  assert.doesNotMatch(JSON.stringify(last), /private-call-id|must-never-enter-diagnostics|private malformed response|messages|transportState|arguments/);
  env.generator.releaseAttempt("attempt-one");
  assert.equal(env.generator.readUsage("attempt-one"), null);
});

test("execution metadata ignores cancelled late responses and diagnostic failures do not change a candidate", async (t) => {
  const snapshots = [];
  let complete, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const env = setup(t, { recordExecution(value) { snapshots.push(structuredClone(value)); return true; },
    respond() { entered(); return new Promise(resolve => { complete = resolve; }); } });
  const controller = new AbortController();
  const pending = env.generator.generateTurn(env.args({ signal: controller.signal }));
  await started;
  assert.deepEqual(snapshots.at(-1).steps.map(step => step.outcome), ["invoked"]);
  controller.abort();
  await assert.rejects(pending, error => error.code === "TURN_CANCELLED");
  assert.equal(env.generator.readUsage("attempt-one").usageComplete, false);
  env.generator.releaseAttempt("attempt-one");
  const ended = structuredClone(snapshots);
  complete(reply(borrowBundle()));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(snapshots, ended, "late usage cannot add execution steps after cancellation/release");

  const faulty = setup(t, { recordExecution() { throw new Error("private diagnostic filesystem error"); } });
  assert.deepEqual(await faulty.generator.generateTurn(faulty.args()), borrowBundle());
  assert.equal(faulty.providerCalls.length, 1);
  assert.deepEqual(faulty.generator.readUsage("attempt-one").usage, { input_tokens: 100, output_tokens: 80, total_tokens: 180 });
});

function assertDeliveredEstimate(input, estimate, preview) {
  const counts = countSessionContext(input);
  assert.deepEqual({ inputTokens: estimate.inputTokens, safetyInputTokens: estimate.safetyInputTokens,
    characters: estimate.characters, bytes: estimate.bytes }, {
    inputTokens: Math.ceil(counts.ascii / 4) + counts.other, safetyInputTokens: counts.bytes,
    characters: counts.characters, bytes: counts.bytes,
  }, "measure the complete delivered messages, tools and response format at their real JSON encoding layer");
  if (preview) for (const key of ["inputTokens", "safetyInputTokens", "characters", "bytes"]) {
    assert.equal(estimate[key], preview[key], `preview and actual delivery agree on ${key}`);
  }
}

test("the story host can commit and recall a sourced experience without generating a synopsis", async (t) => {
  const bundle = borrowBundle();
  delete bundle.experiences[0].text;
  const env = setup(t, { respond(input) {
    assert.match(input.messages[0].content, /experiences: 0\.\.256 objects \{id,entityIds,eventIds,sourceSegmentIds,kind,knownBy,supersedes\?\}/);
    return reply(bundle);
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const action = request({ actionId: "source-only-borrow", input: "我想借两袋米，约好明天归还。" });
  const committed = await coordinator.runAction(action);
  assert.equal(committed.status, "committed");
  assert.equal(committed.view.revision, 1);
  const turn = env.store.readTurn(1);
  assert.deepEqual(turn.experiences, bundle.experiences);
  assert.deepEqual(turn.narration, bundle.narration);
  const memory = createTurnMemory({ store: env.store }).recall({ query: "两袋米", revision: 1, viewerId: "p", outputMode: "model" });
  assert.equal(memory.results.length, 1);
  assert.equal(Object.hasOwn(memory.results[0].experience, "text"), false);
  assert.equal(memory.results[0].passages[0].text, bundle.narration[0].text);
  assert.equal(memory.results[0].playerInput.text, action.input);
  await coordinator.runAction(action);
  assert.equal(env.providerCalls.length, 1, "receipt recovery must not generate the remembered action again");
});

async function unindexedSourceFixture(t, { protectedSources = false } = {}) {
  const { createSessionCompaction } = require("./session-compaction");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-unindexed-generator-"));
  const databaseIdentity = identity(path.join(directory, "session.sqlite"));
  const stores = [];
  const open = () => {
    const store = createTurnStore({ ...databaseIdentity, ...(stores.length ? {} : { initialState: initialState() }) });
    stores.push(store);
    return store;
  };
  const store = open();
  let service;
  t.after(async () => {
    await service?.shutdown();
    for (const database of stores.reverse()) database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const contextPolicy = { configuredContextWindow: 128000 };
  const createGenerator = (database, provider) => createTurnGenerator({ store: database,
    memory: createTurnMemory({ store: database }), provider, adventureId: databaseIdentity.adventureId,
    hostText: "叙事保持具体、克制。", worldText: "上海，爆发后的第十天。", contextPolicy, compactionAvailable: true });
  const originalInput = "我只问铜哨有几声，没有把它当作有人求救。";
  const originalNarration = [
    { id: "whistle", text: "铜哨隔了两拍响了两声，方向并不确定。陈姨没有认出吹哨的人，也没有说这是求救信号。" },
    { id: "window", text: "窗边的灰布仍然垂着。" },
  ];
  const commit = (revision, narration, input, experiences = []) => {
    const action = store.beginAction(request({ actionId: `unindexed-${revision}`, baseRevision: revision - 1, input }));
    return store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
      bundle: { narration, events: [], experiences } });
  };
  commit(1, originalNarration, originalInput);
  for (let revision = 2; revision <= 8; revision++) {
    const protectedKind = protectedSources && ({ 3: "private", 4: "hidden", 5: "old", 6: "correction" })[revision];
    if (protectedKind) {
      const marker = { private: "PRIVATE_UNSELECTED", hidden: "HIDDEN_UNSELECTED", old: "SUPERSEDED_UNSELECTED", correction: "PUBLIC_CORRECTION" }[protectedKind];
      commit(revision, [{ id: "indexed", text: `花篮记录 ${marker}。` },
        { id: "unindexed", text: `花篮旁另有原文 ${marker}，这一段没有经历引用。` }], `询问花篮 ${marker}_INPUT。`, [{
        id: `${protectedKind}-memory`, kind: "claim", knownBy: protectedKind === "private" ? ["npc"] : ["p"],
        entityIds: protectedKind === "hidden" ? ["secret"] : ["npc"], eventIds: [], sourceSegmentIds: ["indexed"],
        ...(protectedKind === "correction" ? { supersedes: [{ revision: 5, experienceId: "old-memory" }] } : {}),
      }]);
    } else commit(revision, [{ id: `quiet-${revision}`, text: `风掠过檐角，第${revision}次停顿。` + "远处街灯照着空路。".repeat(100) }], "我留意街灯。");
  }
  const originals = Array.from({ length: 8 }, (_, index) => store.readTurn(index + 1));
  assert.deepEqual(originals[0].experiences, [], "The target source has no experience index to make recall succeed accidentally");
  const planner = createGenerator(store, { generate() { throw new Error("Planning must not generate a story"); } });
  let compactionCalls = 0;
  service = createSessionCompaction({ store, generator: planner, contextPolicy,
    provider: { generate(input) {
      compactionCalls += 1;
      const data = JSON.parse(input.messages[1].content);
      const selected = data.quoteCandidates.find(quote => quote.source.revision === 2 && quote.source.kind === "narration");
      assert(selected, "The compaction source must contain a real unrelated quotation");
      return reply({ selectedQuoteIds: [selected.quoteId] });
    } } });
  const compacted = await service.compact({ requestId: "unindexed-history-selection", revision: 8, input: "稍等片刻，整理思绪。" });
  assert.equal(compacted.status, "reduced");
  assert.equal(compactionCalls, 1);
  assert.ok(compacted.savedSafetyInputTokens > 0);
  const history = store.readContextHistory({ revision: 8 });
  assert.equal(history.summaryValidity, "valid");
  assert.deepEqual(history.turns.map(turn => turn.revision), [7, 8]);
  assert.equal(history.summary.items.some(quote => quote.source.revision === 1), false);
  assert.doesNotMatch(JSON.stringify(history), /铜哨|吹哨|求救|PRIVATE_UNSELECTED|HIDDEN_UNSELECTED|SUPERSEDED_UNSELECTED/);
  const sourceHash = history.sourceHash;
  store.close();
  const reopened = open();
  assert.equal(reopened.readContextHistory({ revision: 8 }).sourceHash, sourceHash);
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => reopened.readTurn(index + 1)), originals);
  return { store: reopened, open, createGenerator, originalInput, originalNarration, originals, sourceHash };
}

function assertUnindexedWhistle(packet, env) {
  const record = packet.results.find(entry => entry.recordType === "story_source" && entry.source.revision === 1);
  assert(record, "recall_memory must recover the persisted source even though no experience selected it");
  assert.equal(packet.revision, 8);
  assert.deepEqual(record.source, { adventureId: "test-adventure", revision: 1, actionId: "unindexed-1",
    segmentIds: record.passages.map(passage => passage.id) });
  assert.equal(Object.hasOwn(record, "experience"), false);
  assert.equal(Object.hasOwn(record, "currentFacts"), false);
  assert.deepEqual(record.playerInput, { kind: "player_input", text: env.originalInput,
    start: 0, end: env.originalInput.length, truncated: false });
  const passage = record.passages.find(entry => entry.id === "whistle");
  assert.deepEqual(passage, { id: "whistle", text: env.originalNarration[0].text,
    start: 0, end: env.originalNarration[0].text.length, truncated: false });
  for (const entry of record.passages) {
    const original = env.originalNarration.find(source => source.id === entry.id);
    assert(original);
    assert.equal(entry.text, original.text.slice(entry.start, entry.end));
  }
  return record;
}

test("unindexed original exits context, survives compaction and reopen, then recall_memory supplies one committed response", async (t) => {
  const env = await unindexedSourceFixture(t);
  const calls = [];
  const action = request({ actionId: "revisit-unindexed", baseRevision: 8, input: "稍等片刻，整理思绪。" });
  const generator = env.createGenerator(env.store, { generate(input) {
    calls.push(structuredClone(input.messages));
    if (calls.length === 1) return tools([{ id: "whistle-source", name: "recall_memory", arguments: JSON.stringify({ query: "铜哨" }) }]);
    const packet = JSON.parse(input.messages.find(message => message.role === "tool").content);
    const original = packet.results.find(entry => entry.recordType === "story_source" && entry.source.revision === 1);
    // The fake provider derives its candidate from the actual tool reply. This
    // proves source delivery and committing, not a model's semantic judgment.
    return reply({ narration: [{ id: "recalled", text: original?.passages.find(passage => passage.id === "whistle")?.text || "没有读到对应来源。" }], events: [], experiences: [] });
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: generator.generateTurn });
  const result = await coordinator.runAction(action);
  assert.equal(result.status, "committed");
  assert.equal(result.revision, 9);
  assert.equal(calls.length, 2);
  const usage = generator.readUsage(result.executionAttemptId);
  assert.equal(usage.modelCalls, 2);
  assert.equal(usage.toolCalls, 1);
  assert.doesNotMatch(JSON.stringify(calls[0]), /铜哨|吹哨|求救/, "The original must be absent from every first-request message, not only the history slot");
  assertUnindexedWhistle(JSON.parse(calls[1].find(message => message.role === "tool").content), env);
  assert.deepEqual(env.store.readTurn(9).narration, [{ id: "recalled", text: env.originalNarration[0].text }]);
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => env.store.readTurn(index + 1)), env.originals);
  assert.equal((await coordinator.runAction(action)).status, "committed");
  assert.equal(calls.length, 2);
  env.store.close();
  const finalStore = env.open();
  let recoveryCalls = 0;
  const recovery = createTurnCoordinator({ store: finalStore, generateTurn() { recoveryCalls += 1; throw new Error("A committed action must not regenerate"); } });
  assert.equal((await recovery.runAction(action)).revision, 9);
  assert.equal(recoveryCalls, 0);
  assert.deepEqual(finalStore.readTurn(9).narration, [{ id: "recalled", text: env.originalNarration[0].text }]);
  assert.equal(finalStore.readContextHistory({ revision: 8 }).sourceHash, env.sourceHash);
});

test("unindexed original can be supplied by automatic recall after compaction without an unnecessary tool call", async (t) => {
  const env = await unindexedSourceFixture(t);
  const calls = [];
  const generator = env.createGenerator(env.store, { generate(input) {
    calls.push(structuredClone(input.messages));
    const related = JSON.parse(input.messages[2].content.split("\n").slice(1).join("\n"));
    const source = related.results.find(entry => entry.recordType === "story_source" && entry.source.revision === 1);
    return reply({ narration: [{ id: "recalled", text: source?.passages.find(passage => passage.id === "whistle")?.text || "没有读到对应来源。" }], events: [], experiences: [] });
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: generator.generateTurn });
  const result = await coordinator.runAction(request({ actionId: "automatic-unindexed", baseRevision: 8,
    input: "我想起铜哨，确认当时是否知道它来自哪一边。" }));
  assert.equal(result.status, "committed");
  assert.equal(calls.length, 1);
  assert.equal(generator.readUsage(result.executionAttemptId).toolCalls, 0);
  assert.doesNotMatch(calls[0][1].content + calls[0][3].content, /铜哨|吹哨|求救/);
  assertUnindexedWhistle(JSON.parse(calls[0][2].content.split("\n").slice(1).join("\n")), env);
  assert.equal(calls[0].some(message => message.role === "tool"), false);
  assert.deepEqual(env.store.readTurn(9).narration, [{ id: "recalled", text: env.originalNarration[0].text }]);
});

test("recall_memory cannot bypass mixed private, hidden or superseded source exclusions through unindexed prose", async (t) => {
  const env = await unindexedSourceFixture(t, { protectedSources: true });
  const calls = [];
  const generator = env.createGenerator(env.store, { generate(input) {
    calls.push(structuredClone(input.messages));
    return calls.length === 1 ? tools([{ id: "all-source-kinds", name: "recall_memory",
      arguments: JSON.stringify({ query: "铜哨 花篮" }) }])
      : reply({ narration: [{ id: "pause", text: "你仍停在原地。" }], events: [], experiences: [] });
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: generator.generateTurn });
  const result = await coordinator.runAction(request({ actionId: "protected-unindexed", baseRevision: 8, input: "稍等片刻，整理思绪。" }));
  assert.equal(result.status, "committed");
  assert.equal(calls.length, 2);
  const packet = JSON.parse(calls[1].find(message => message.role === "tool").content);
  assertUnindexedWhistle(packet, env);
  assert.doesNotMatch(JSON.stringify(packet), /PRIVATE_UNSELECTED|HIDDEN_UNSELECTED|SUPERSEDED_UNSELECTED/);
  assert.ok(packet.results.some(entry => entry.experience?.id === "correction-memory"), "The visible correction remains accessible through the original experience path");
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => env.store.readTurn(index + 1)), env.originals);
});

function conditionSourceFixture(t, options = {}) {
  let memory;
  const reads = [];
  const env = setup(t, { ...options, recall: input => memory.recall(input),
    conditionPage(store, args) {
      reads.push(structuredClone(args));
      return options.conditionPage ? options.conditionPage(store, args) : store.readConditionSource(args);
    }, config: { contextPolicy: { configuredContextWindow: 128000 }, maxModelCalls: 8, ...options.config } });
  const originalInput = "我不扶她走，也不让她试跑，只问她先前的感觉。" + "窗外雨声很轻。".repeat(140) + "我没有要求任何能力测试。";
  const originalNarration = [{ id: "body", text: "陈姨说右脚踩实仍疼。" + "窗外滴水，屋里没人催促。".repeat(1150)
    + "她最后补充：我从没试过跑，不知道能不能跑；别把扶着能走说成不扶也能走。" },
  { id: "other", text: "她指着窗边的绳子说那是晾衣用的，不是医疗用品。" }];
  function commit(revision, input, narration, events = []) {
    const action = env.store.beginAction(request({ actionId: `body-source-${revision}`, baseRevision: revision - 1, input }));
    env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: { narration, events, experiences: [] } });
  }
  const event = (type, data, id = "condition") => ({ id, type: `condition.${type}`, sourceSegmentIds: ["body"], data });
  commit(1, originalInput, originalNarration, [event("add", { characterId: "npc", basis: "self_report", text: "右脚踩实仍疼",
    evidence: [{ segmentId: "body", quote: "右脚踩实仍疼。" }] }),
  event("add", { characterId: "npc", basis: "self_report", text: "另一项待纠正解释",
    evidence: [{ segmentId: "body", quote: "陈姨说右脚踩实仍疼。" }] }, "later-retracted")]);
  const [ancestor, unrelated] = env.store.readModelState().entities.npc.conditionRecords.items;
  commit(2, "我只问坐着是否好些，不要求她站起来。", [{ id: "body", text: "她说坐着比先前轻一点；此前另一项说法收回。" }], [
    event("replace", { characterId: "npc", recordId: ancestor.id, basis: "self_report", text: "坐着疼痛较轻",
      evidence: [{ segmentId: "body", quote: "坐着比先前轻一点" }] }),
    event("remove", { characterId: "npc", recordId: unrelated.id, reason: "retracted", evidence: [{ segmentId: "body", quote: "此前另一项说法收回。" }] }, "retract"),
  ]);
  const predecessor = env.store.readModelState().entities.npc.conditionRecords.items[0];
  commit(3, "我再确认她现在坐着的感受。", [{ id: "body", text: "她说坐着仍会疼，和刚才一样。" }], [
    event("replace", { characterId: "npc", recordId: predecessor.id, basis: "self_report", text: "坐着仍疼",
      evidence: [{ segmentId: "body", quote: "坐着仍会疼，和刚才一样。" }] }),
  ]);
  for (let revision = 4; revision <= 6; revision++) commit(revision, "我留意窗外。", [{ id: "quiet", text: `第${revision}次观察，窗外仍有雨声。` }]);
  const active = env.store.readModelState().entities.npc.conditionRecords.items[0];
  memory = createTurnMemory({ store: env.store });
  return { ...env, reads, commit, ancestor, unrelated, predecessor, active, originalInput, originalNarration,
    fixedArgs: () => env.args({ request: request({ actionId: "body-evidence-read", baseRevision: 6, input: "我想准确回想陈姨身体情况的原话和条件。" }),
      state: env.store.readModelState({ revision: 6 }) }) };
}

async function compactConditionFixture(env) {
  const { createCompactionQuotes } = require("./session-compaction-quotes");
  const args = env.fixedArgs(); const options = { revision: 6, input: args.request.input };
  const plan = await env.generator.readCompactionPlan(options);
  assert.equal(plan.status, "ready"); assert.equal(plan.range.throughRevision, 4);
  const passage = env.store.readTurn(4).narration[0];
  const summary = { summaryId: "body-source-compact", fromRevision: 1, throughRevision: 4, format: COMPACTION_QUOTE_FORMAT,
    items: createCompactionQuotes({ adventureId: "test-adventure", revision: 4, segmentId: passage.id, text: passage.text }) };
  const preview = await env.generator.previewCompaction({ ...options, planId: plan.planId, summary });
  assert.equal(preview.status, "reduced"); assert.ok(preview.savedSafetyInputTokens > 0);
  const job = env.store.beginCompaction({ requestId: summary.summaryId, revision: 6, input: options.input, viewerId: "p",
    settingsIdentity: preview.before.settingsIdentity, sourceHash: plan.sourceHash, throughRevision: 4, contextGeneration: plan.contextGeneration });
  env.store.commitCompaction({ requestId: job.requestId, attemptId: job.attemptId, outcome: "reduced",
    summary: { format: summary.format, items: summary.items },
    metrics: { before: preview.before, after: preview.after, savedSafetyInputTokens: preview.savedSafetyInputTokens } });
  const history = env.store.readContextHistory({ revision: 6 });
  assert.deepEqual(history.turns.map(turn => turn.revision), [5, 6]);
  assert.doesNotMatch(JSON.stringify(history), /从没试过跑|不扶也能走|没有要求任何能力测试/);
  return args;
}

test("condition source tools recover complete input and prose without experiences after real compaction, paging fixed history and predecessor links", async (t) => {
  const pages = [];
  let afterAdvance;
  const env = conditionSourceFixture(t, { respond(input, number) {
    const read = (id, recordId, sourceCursor) => ({ id, name: "read_entity", arguments: JSON.stringify({ entityId: "npc", conditionRecordId: recordId,
      ...(sourceCursor ? { sourceCursor } : {}) }) });
    if (number === 1) {
      const history = JSON.parse(input.messages[3].content.slice(input.messages[3].content.indexOf("\n") + 1));
      assert.doesNotMatch(JSON.stringify(history), /从没试过跑|不扶也能走|没有要求任何能力测试/);
      const related = JSON.parse(input.messages[2].content.slice(input.messages[2].content.indexOf("\n") + 1));
      assert.ok(related.results.some(record => record.recordType === "story_source"));
      for (const record of related.results) {
        assert.equal(record.experience, undefined);
        const original = env.store.readTurn(record.source.revision);
        for (const passage of record.passages) assert.equal(passage.text,
          original.narration.find(segment => segment.id === passage.id).text.slice(passage.start, passage.end));
      }
      env.commit(7, "我等在原地。", [{ id: "hide", text: "陈姨已经离开玩家能看见的范围。" }],
        [{ id: "hide", type: "entity.update", sourceSegmentIds: ["hide"], data: { id: "npc", visibility: "hidden" } }]);
      afterAdvance = env.store.readView();
      return tools([read("premature-ancestor", env.ancestor.id), read("active", env.active.id), read("predecessor", env.predecessor.id)]);
    }
    const packets = input.messages.filter(message => message.role === "tool").map(message => JSON.parse(message.content));
    if (number === 2) {
      assertToolFailure(packets[0], "CONDITION_RECORD_NOT_AVAILABLE");
      assert.equal(packets[1].record.id, env.active.id); assert.equal(packets[1].source.revision, 3);
      assert.equal(packets[2].record.id, env.predecessor.id); assert.deepEqual(packets[2].record.predecessor, env.predecessor.predecessor);
      return tools([read("ancestor-first", env.ancestor.id)]);
    }
    const page = packets.at(-1); pages.push(page);
    assert.equal(page.revision, 6); assert.equal(page.entityId, "npc"); assert.equal(page.record.id, env.ancestor.id);
    assert.deepEqual(page.source, { adventureId: "test-adventure", revision: 1, actionId: "body-source-1" });
    assert.ok(JSON.stringify(page).length <= 12000);
    if (page.nextCursor) return tools([read(`ancestor-page-${number}`, env.ancestor.id, page.nextCursor)]);
    return reply(refusedBundle());
  } });
  const args = await compactConditionFixture(env);
  assert.deepEqual(await env.generator.generateTurn(args), refusedBundle());
  assert.ok(pages.length > 1, "the old complete prose must require real source paging");
  const reconstructed = new Map();
  for (const page of pages) for (const passage of page.passages) {
    const key = passage.kind === "player_input" ? "input" : passage.segmentId;
    const original = key === "input" ? env.originalInput : env.originalNarration.find(segment => segment.id === key).text;
    assert.equal(passage.text, original.slice(passage.start, passage.end)); assert.equal(passage.totalCharacters, original.length);
    assert.equal(passage.start, (reconstructed.get(key) || "").length);
    reconstructed.set(key, (reconstructed.get(key) || "") + passage.text);
  }
  assert.equal(reconstructed.get("input"), env.originalInput);
  for (const segment of env.originalNarration) assert.equal(reconstructed.get(segment.id), segment.text);
  assert.equal(env.reads.some(read => read.recordId === env.unrelated.id), false);
  assert.ok(env.reads.every(read => read.revision === 6 && read.entityId === "npc"));
  assert.deepEqual(env.store.readView(), afterAdvance, "tool reads never commit a new story or body state");
  assert.deepEqual(env.store.listExperienceRecords({ revision: 6, viewerId: "p" }).records, []);
});

test("condition source tool arguments cannot change the fixed view or bypass visible reachable records", async (t) => {
  const invalid = [{ sourceCursor: "cursor-without-record" }, { conditionRecordId: null },
    { conditionRecordId: "" }, { conditionRecordId: "record", sourceCursor: {} },
    { conditionRecordId: "record", sourceCursor: "" }, { conditionRecordId: "record", revision: 1 },
    { conditionRecordId: "record", viewerId: "npc" }];
  const env = conditionSourceFixture(t, { config: { maxToolCalls: 16 }, respond(input, number) {
    const read = (id, args) => ({ id, name: "read_entity", arguments: JSON.stringify(args) });
    if (number === 1) return tools([
      ...invalid.map((args, i) => read(`invalid-${i}`, { entityId: "npc", ...args })),
      read("hidden", { entityId: "secret", conditionRecordId: env.active.id }),
      read("wrong-character", { entityId: "p", conditionRecordId: env.active.id }),
      read("retracted", { entityId: "npc", conditionRecordId: env.unrelated.id }),
      read("unknown", { entityId: "npc", conditionRecordId: "unknown-record" }),
      read("bad-cursor", { entityId: "npc", conditionRecordId: env.active.id, sourceCursor: "wrong-cursor" }),
      read("ordinary", { entityId: "npc" }),
    ]);
    const results = input.messages.filter(message => message.role === "tool").map(message => JSON.parse(message.content));
    assert.equal(results.slice(0, invalid.length).length, invalid.length);
    for (const result of results.slice(0, invalid.length)) assertToolFailure(result, "TOOL_ARGUMENTS_INVALID");
    assert.deepEqual(results.slice(invalid.length, -1).map(result => result.error.code),
      ["ENTITY_NOT_AVAILABLE", "CONDITION_RECORD_NOT_AVAILABLE", "CONDITION_RECORD_NOT_AVAILABLE",
        "CONDITION_RECORD_NOT_AVAILABLE", "TOOL_ARGUMENTS_INVALID"]);
    assert.equal(results.at(-1).revision, 6); assert.equal(results.at(-1).entity.id, "npc");
    assert.equal(results.at(-1).entity.attributes, undefined);
    return reply(refusedBundle());
  } });
  const before = env.store.readView();
  await env.generator.generateTurn(env.fixedArgs());
  assert.deepEqual(env.reads, [{ revision: 6, entityId: "npc", recordId: env.active.id, cursor: "wrong-cursor" }]);
  assert.equal(env.providerCalls.length, 2); assert.deepEqual(env.store.readView(), before);
});

test("condition source tools reject mismatched or malformed store pages without exposing source errors", async (t) => {
  const changes = {
    "fixed revision": page => { page.revision = 5; },
    "record owner": page => { page.record.characterId = "p"; },
    "active display text": page => { page.record.text = "伪造的正常结论"; },
    "original adventure": page => { page.source.adventureId = "another-adventure"; },
    "original revision": page => { page.source.revision = 2; },
    "invalid passage coordinates": page => { page.passages[0].end += 1; },
    "player input pretending narration": page => { page.passages[0].segmentId = "body"; },
    "empty evidence": page => { page.evidenceRanges = []; },
    "evidence coordinates differing from the known active source": page => { page.evidenceRanges[0].start -= 1; },
    "future predecessor": page => { page.record.predecessor.revision = 6; },
    "oversized page": page => { page.passages[0].text = "x".repeat(12000); page.passages[0].start = 0;
      page.passages[0].end = 12000; page.passages[0].totalCharacters = 12000; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async (t) => {
    const env = conditionSourceFixture(t, { conditionPage(store, args) {
      const page = store.readConditionSource(args); change(page); return page;
    }, respond() { return tools([{ id: "source", name: "read_entity", arguments: JSON.stringify({ entityId: "npc", conditionRecordId: env.active.id }) }]); } });
    const before = env.store.readView();
    await assert.rejects(env.generator.generateTurn(env.fixedArgs()), { code: "MEMORY_SOURCE_UNAVAILABLE" });
    assert.equal(env.providerCalls.length, 1); assert.deepEqual(env.store.readView(), before);
  });
  await t.test("reader exception keeps its raw details private", async (t) => {
    const env = conditionSourceFixture(t, { conditionPage() {
      throw Object.assign(new Error("sk-secret-source-and-private-file-path"), { code: "CONDITION_SOURCE_UNAVAILABLE" });
    }, respond() { return tools([{ id: "source", name: "read_entity", arguments: JSON.stringify({ entityId: "npc", conditionRecordId: env.active.id }) }]); } });
    await assert.rejects(env.generator.generateTurn(env.fixedArgs()), error => {
      assert.equal(error.code, "MEMORY_SOURCE_UNAVAILABLE");
      assert.doesNotMatch(error.stack + JSON.stringify(error), /sk-secret|private-file-path/); return true;
    });
    assert.equal(env.providerCalls.length, 1);
    assert.doesNotMatch(JSON.stringify(env.generator.readUsage("attempt-one")), /sk-secret|private-file-path/);
  });
});

test("condition source cancellation ignores a late valid page and never calls the model again", async (t) => {
  let entered, finish;
  const called = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  const env = conditionSourceFixture(t, { conditionPage(store, args) {
    const page = store.readConditionSource(args); entered(page); return pending;
  }, respond() { return tools([{ id: "source", name: "read_entity", arguments: JSON.stringify({ entityId: "npc", conditionRecordId: env.active.id }) }]); } });
  const before = env.store.readView(); const controller = new AbortController();
  const running = env.generator.generateTurn({ ...env.fixedArgs(), signal: controller.signal });
  const page = await called; controller.abort();
  await assert.rejects(running, { code: "TURN_CANCELLED" });
  finish(page); await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.providerCalls.length, 1); assert.deepEqual(env.store.readView(), before);
});

test("condition source pages count against the complete next model request budget", async (t) => {
  const env = conditionSourceFixture(t);
  const args = await compactConditionFixture(env);
  // Keep automatic-recall sizing out of this source-page growth test. A topic
  // query now finds unindexed prose and changes its own cap with the context
  // budget, so a preview made with different settings is not a fixed baseline.
  args.request.input = "我稍等片刻。";
  const preview = await env.generator.readContextUsage({ revision: 6, input: args.request.input });
  let calls = 0, reads = 0;
  const generator = createTurnGenerator({ adventureId: "test-adventure", store: { ...env.store,
    readConditionSource(input) { reads += 1; return env.store.readConditionSource(input); } }, memory: createTurnMemory({ store: env.store }),
    hostText: "克制具体。旧指令：调用 finalize_new_game 写入状态。", worldText: "上海第十天。",
    contextPolicy: { configuredContextWindow: 128000 }, maxContextCharacters: preview.latestEstimate.characters + 100,
    provider: { async generate() { calls += 1; return tools([{ id: "source", name: "read_entity",
      arguments: JSON.stringify({ entityId: "npc", conditionRecordId: env.active.id }) }]); } } });
  const before = env.store.readView();
  const actualBefore = await generator.readContextUsage({ revision: 6, input: args.request.input });
  assert.equal(actualBefore.fits, true);
  assert.equal(actualBefore.latestEstimate.characters, preview.latestEstimate.characters);
  await assert.rejects(generator.generateTurn(args), { code: "CONTEXT_BUDGET_EXCEEDED" });
  assert.equal(calls, 1); assert.equal(reads, 1);
  const usage = generator.readUsage(args.attemptId);
  assert.equal(usage.contextUsage.fits, false);
  assert.ok(usage.contextUsage.latestEstimate.characters > preview.latestEstimate.characters + 100);
  assert.deepEqual(env.store.readView(), before);
});

test("duplicate recall entity IDs and a model-selected output mode return repairable tool errors", async (t) => {
  const env = setup(t, { respond(input, number) {
    if (number === 1) return tools([{ id: "duplicate-ids", name: "recall_memory",
      arguments: JSON.stringify({ query: "陈姨", entityIds: ["npc", "npc"] }) },
      { id: "select-mode", name: "recall_memory", arguments: JSON.stringify({ query: "陈姨", outputMode: "full" }) }]);
    const results = input.messages.filter((message) => message.role === "tool");
    assert.equal(results.length, 2);
    for (const result of results) assertToolFailure(JSON.parse(result.content), "TOOL_ARGUMENTS_INVALID");
    return reply(borrowBundle());
  } });
  assert.deepEqual(await env.generator.generateTurn(env.args()), borrowBundle());
  assert.equal(env.providerCalls.length, 2);
  assert.equal(env.recalls.length, 1); // Automatic valid recall only.
});

test("recall tools apply exclusive source bounds and matching time order at the same fixed revision", async (t) => {
  let memory;
  const env = setup(t, { recall: (options) => memory.recall(options), respond(input, number) {
    if (number === 1) return tools([
      { id: "early", name: "recall_memory", arguments: JSON.stringify({ query: "钟声", order: "earliest", beforeRevision: 3, afterRevision: 0 }) },
      { id: "latest", name: "recall_memory", arguments: JSON.stringify({ query: "钟声", order: "latest" }) },
      { id: "entity-only", name: "recall_memory", arguments: JSON.stringify({ query: "", entityIds: ["p"], order: "earliest" }) },
    ]);
    const packets = input.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
    assert.deepEqual(packets.map((packet) => packet.revision), [3, 3, 3]);
    assert.deepEqual(packets.map((packet) => packet.results.map((x) => x.source.revision)), [[1], [3, 1], [1, 2, 3]]);
    assert.equal(packets[0].results[0].passages[0].text, "钟声从远处传来，方向不明。" );
    assert.equal(packets[0].results[0].experience.text, undefined);
    assert.equal(packets[0].results[0].currentFacts, undefined);
    return reply(refusedBundle());
  } });
  for (const [i, text] of ["钟声从远处传来，方向不明。", "窗外正在下雨。", "钟声又响了一次。"].entries()) {
    const action = env.store.beginAction(request({ actionId: `past-${i}`, baseRevision: i, input: "我停下来听着。" }));
    env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: {
      narration: [{ id: "source", text }], events: [],
      experiences: [{ id: `heard-${i}`, text, entityIds: ["p"], kind: "event", knownBy: ["p"], eventIds: [], sourceSegmentIds: ["source"] }],
    } });
  }
  memory = createTurnMemory({ store: env.store });
  const before = env.store.readModelState();
  await env.generator.generateTurn(env.args({ request: request({ actionId: "remember-order", baseRevision: 3, input: "我回想先前的钟声。" }), state: before }));
  assert.equal(env.providerCalls.length, 2); assert.equal(env.recalls.length, 4);
  for (const read of env.recalls) {
    assert.equal(read.viewerId, "p"); assert.equal(read.revision, 3); assert.equal(read.limit, 6);
    assert.equal(read.outputMode, "model"); assert.ok(read.maxCharacters <= 8000);
  }
  assert.deepEqual(env.store.readModelState(), before);
});

test("recall time parameters reject future or invalid ranges without forwarding them to memory", async (t) => {
  const invalid = [{ order: "oldest" }, { beforeRevision: 1 }, { afterRevision: 1 }, { beforeRevision: 0 },
    { afterRevision: -1 }, { afterRevision: 0.5 }, { beforeRevision: 2, afterRevision: 2 }, { afterRevision: "0" }];
  const env = setup(t, { respond(input, number) {
    if (number === 1) return tools(invalid.map((args, i) => ({ id: `invalid-time-${i}`, name: "recall_memory",
      arguments: JSON.stringify({ query: "钟声", ...args }) })));
    const packets = input.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
    assert.equal(packets.length, invalid.length);
    for (const packet of packets) assertToolFailure(packet, "TOOL_ARGUMENTS_INVALID");
    return reply(refusedBundle());
  } });
  await env.generator.generateTurn(env.args());
  assert.equal(env.recalls.length, 1); assert.equal(env.providerCalls.length, 2);
  assert.equal(env.store.readView().revision, 0);
});

test("one normalized Provider protocol call produces a complete bundle without changing the database", async (t) => {
  const env = setup(t);
  assert.deepEqual(await env.generator.generateTurn(env.args()), borrowBundle());
  assert.equal(env.store.readView().revision, 0);
  assert.equal(env.providerCalls.length, 1);
  const sent = env.providerCalls[0];
  assert.equal(sent.maxOutputTokens, 4096);
  assert.deepEqual(sent.responseFormat, { type: "json_object" });
  assert.deepEqual(sent.tools.map((entry) => entry.function.name), ["recall_memory", "read_entity"]);
  assert.match(sent.messages[0].content, /QUOTED SOURCE MATERIAL/);
  const data = JSON.parse(sent.messages[1].content);
  assert.equal(data.canonicalState.entities.secret.visibility, "hidden");
  assert.equal(data.canonicalState.inventory[0].ownerId, "npc");
  assert.match(sent.messages[0].content, /NOT knowledge the player has/);
  assert.equal(env.recalls[0].viewerId, "p");
  assert.equal(env.recalls[0].revision, 0);
  assert.equal(env.recalls[0].outputMode, "model");
  assert.ok(env.recalls[0].entityIds.includes("npc"));
  const { contextUsage, ...accounting } = env.generator.readUsage("attempt-one");
  assert.deepEqual(accounting, { modelCalls: 1, toolCalls: 0,
    usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 }, usageComplete: true });
  assert.equal(contextUsage.scope, "invocation");
  assert.equal(contextUsage.latestActual.inputTokens, 100);
  assert.equal(contextUsage.revision, 0);
});

test("automatic and tool recall send original qualifications instead of contaminated retrieval synopses", async (t) => {
  let memory, preview;
  const rawRecalls = [];
  const env = setup(t, { initialState: createOpeningState(), recall(input) {
    assert.equal(input.outputMode, "model");
    const result = memory.recall(input);
    rawRecalls.push(structuredClone(result));
    return result;
  }, respond(_input, call) {
    if (call === 1) {
      assert.equal(env.generator.readUsage("attempt-one").contextUsage.latestEstimate.bytes, preview.latestEstimate.bytes,
        "the preview measures the same projected recall as the actual request");
      return tools([{ id: "remember", name: "recall_memory", arguments: JSON.stringify({
        query: "陈姨说的回应时间和阀门情况", entityIds: ["p", "npc"],
      }) }]);
    }
    return reply(refusedBundle());
  } });
  const commit = (revision, bundle) => {
    const action = env.store.beginAction(request({ actionId: `source-${revision}`, baseRevision: revision - 1, input: "继续听她说。" }));
    env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
  };
  commit(1, { narration: [{ id: "summary", text: "你穿着旧蓝外套，隔壁住着陈姨。这样开始吗？" }], events: [
    { id: "propose", type: "opening.propose", sourceSegmentIds: ["summary"], data: { proposalId: "role", initialState: initialState() } },
  ], experiences: [] });
  commit(2, { narration: [{ id: "scene", text: "你在楼道里听见陈姨屋里传来滴水声。" }], events: [
    { id: "confirm", type: "opening.confirm", sourceSegmentIds: ["scene"], data: { proposalId: "role" } },
  ], experiences: [{ id: "opening-account", text: "你穿着红色制服听见滴水。", entityIds: ["p", "npc"],
    eventIds: ["confirm"], sourceSegmentIds: ["scene"], kind: "event", knownBy: ["p", "npc"] }] });
  const time = (id, text, supersedes) => ({ id, text, entityIds: ["p", "npc"], eventIds: [],
    sourceSegmentIds: ["time"], kind: "claim", knownBy: ["p", "npc"], ...(supersedes ? { supersedes } : {}) });
  commit(3, { narration: [{ id: "time", text: "陈姨说：大前天……下午？我记不准了。" }], events: [],
    experiences: [time("time-old", "陈姨确认回应发生在大前天下午。旧条目。") ] });
  commit(4, { narration: [{ id: "valve", text: "阀门转起来死沉。你没有使劲，也没有判断它卡住的原因。" }], events: [],
    experiences: [{ id: "valve-account", text: "闸阀锈死在轴上。", entityIds: ["p", "npc"], eventIds: [],
      sourceSegmentIds: ["valve"], kind: "event", knownBy: ["p", "npc"] }] });
  commit(5, { narration: [{ id: "time", text: "陈姨再次说明：大前天……下午？我可记不准，别把这当成准确时间。" }], events: [],
    experiences: [time("time-correction", "陈姨确认回应发生在大前天下午。", [{ revision: 3, experienceId: "time-old" }])] });
  memory = createTurnMemory({ store: env.store });
  const fixedInput = "陈姨说的回应时间和阀门情况，我再回想一下。";
  const before = fs.readFileSync(env.databasePath);
  preview = await env.generator.readContextUsage({ revision: 5, input: fixedInput });
  await env.generator.generateTurn(env.args({ request: request({ actionId: "recall-sources", baseRevision: 5, input: fixedInput }),
    state: env.store.readModelState({ revision: 5 }) }));
  assert.equal(env.providerCalls.length, 2);
  assert.equal(rawRecalls.length, 3, "preview, automatic recall and explicit recall each use the real memory reader");
  const automatic = JSON.parse(env.providerCalls[0].messages[2].content.split("\n").slice(1).join("\n"));
  const recalled = JSON.parse(env.providerCalls[1].messages.find((message) => message.role === "tool").content);
  const history = JSON.parse(env.providerCalls[0].messages[3].content.split("\n").slice(1).join("\n"));
  const resolvedAutomatic = structuredClone(automatic);
  function resolve(value, source, segmentId) {
    if (!Object.hasOwn(value, "historyRef")) return value;
    assert.equal(value.historyRef, true);
    const turn = history.turns.find(turn => turn.revision === source.revision
      && (turn.source?.adventureId ?? "test-adventure") === source.adventureId);
    assert.ok(turn, "each reference points to source text actually sent in this request");
    const original = segmentId === undefined ? turn.input : turn.narration.find(segment => segment.id === segmentId)?.text;
    assert.equal(typeof original, "string");
    const { historyRef, ...metadata } = value;
    return { ...metadata, text: original.slice(value.start, value.end) };
  }
  for (const record of resolvedAutomatic.results) {
    if (record.playerInput) record.playerInput = resolve(record.playerInput, record.source);
    record.passages = record.passages.map(passage => resolve(passage, record.source, passage.id));
    if (record.supportingPassages) record.supportingPassages = record.supportingPassages.map(passage => resolve(passage, passage, passage.segmentId));
  }
  for (const [projected, raw] of [[resolvedAutomatic, rawRecalls[1]], [recalled, rawRecalls[2]]]) {
    assert.equal(projected.revision, 5);
    assert.deepEqual(projected.results.map((record) => record.source), raw.results.map((record) => record.source));
    assert.equal(projected.results.some((record) => record.experience.id === "time-old"), false, "superseded accounts remain filtered");
    assert.deepEqual(projected.results.find((record) => record.experience.id === "time-correction").experience.supersedes,
      [{ revision: 3, experienceId: "time-old" }]);
    for (let index = 0; index < raw.results.length; index++) {
      const { text, textRange, textTruncated, ...metadata } = raw.results[index].experience;
      assert.equal(text, undefined, "the producer removes its index synopsis before budgeting this model packet");
      assert.deepEqual(projected.results[index].experience, metadata);
      assert.deepEqual(projected.results[index].passages, raw.results[index].passages);
      assert.deepEqual(projected.results[index].supportingPassages, raw.results[index].supportingPassages);
      assert.equal(Object.hasOwn(raw.results[index], "currentFacts"), false);
      assert.equal(Object.hasOwn(projected.results[index], "currentFacts"), false);
    }
    assert.match(JSON.stringify(projected), /大前天……下午？我可记不准/);
    assert.match(JSON.stringify(projected), /转起来死沉。你没有使劲/);
    const support = projected.results.find((record) => record.experience.id === "opening-account").supportingPassages;
    assert.equal(support[0].revision, 1);
    assert.equal(support[0].adventureId, "test-adventure");
    assert.match(support[0].text, /旧蓝外套/);
  }
  for (const sent of env.providerCalls) {
    assert.doesNotMatch(JSON.stringify(sent), /锈死在轴上|确认回应发生在大前天下午|红色制服/);
  }
  assert.equal(env.store.readTurn(4).experiences[0].text, "闸阀锈死在轴上。", "stored history is not rewritten");
  assert.deepEqual(fs.readFileSync(env.databasePath), before);
});

test("stored descriptions appear once as quoted data while recall and entity tools preserve structure and original wording", async (t) => {
  const locales = [
    { locale: "zh-CN", identity: "做过机修的独居老人", status: "曾把下午的猜测记成了确定时间", original: "她想了想：大前天……下午？我记不准。" },
    { locale: "en", identity: "A retired machinist living alone", status: "An afternoon estimate was recorded as certain", original: "She hesitated: three days ago… afternoon? I am not sure." },
    { locale: "ja", identity: "一人暮らしの元機械工", status: "午後という推測を確かな時刻として記した", original: "彼女は考えた。「三日前……午後？　よく覚えていない。」" },
  ];
  for (const sample of locales) await t.test(sample.locale, async (t) => {
    const start = initialState();
    start.entities.p.attributes = { age: 74, occupation: sample.identity, condition: { knee: "stiff", fatigue: 2 } };
    start.entities.npc.attributes = { status: sample.status, description: "independent-character-description" };
    start.entities.home.attributes = { description: "independent-location-description" };
    start.entities.rice.attributes = { description: "independent-item-description" };
    start.entities.secret.attributes = { description: "independent-hidden-description" };
    start.commitments = { promise: { id: "promise", debtorId: "p", creditorId: "npc", itemId: "rice", quantity: 1,
      due: "eleventh day", status: "fulfilled" } };
    const raw = { revision: 0, results: [1, 2].map((index) => ({
      source: { adventureId: "test-adventure", revision: 0, actionId: `prior-${index}`, experienceId: `claim-${index}`, segmentIds: ["speech"] },
      experience: { id: `claim-${index}`, text: "retrieval-synopsis-must-not-be-sent", entityIds: ["p", "npc"], eventIds: [],
        sourceSegmentIds: ["speech"], kind: "claim", knownBy: ["p"] },
      passages: [{ id: "speech", text: `${sample.original}\n"quoted" \\ 😀 é`, start: 0,
        end: `${sample.original}\n"quoted" \\ 😀 é`.length, truncated: false }],
      currentFacts: { entities: { p: structuredClone(start.entities.p), npc: structuredClone(start.entities.npc) },
        inventory: structuredClone(start.inventory), commitments: structuredClone(start.commitments),
        omitted: { entities: 0, inventory: 0, commitments: 0 } },
    })), truncated: false };
    const beforeStart = structuredClone(start), beforeRaw = structuredClone(raw);
    let preview;
    const env = setup(t, { initialState: start, storeOptions: { locale: sample.locale }, recall: () => raw,
      respond(input, call) {
        const measured = env.generator.readUsage("attempt-one").contextUsage.latestEstimate;
        assertDeliveredEstimate(input, measured, call === 1 ? preview.latestEstimate : undefined);
        if (call === 1) {
          return tools([
            { id: "entity", name: "read_entity", arguments: '{"entityId":"npc"}' },
            { id: "recall", name: "recall_memory", arguments: '{"query":"陈姨","entityIds":["npc"]}' },
            { id: "hidden", name: "read_entity", arguments: '{"entityId":"secret"}' },
          ]);
        }
        return reply(refusedBundle());
      } });
    const playerRequest = request({ locale: sample.locale, input: `${sample.original}\n请保留 "也许"、反斜线 \\ 与 😀。` });
    const args = env.args({ request: playerRequest });
    const beforeArgs = structuredClone(args), beforeDatabase = fs.readFileSync(env.databasePath);
    preview = await env.generator.readContextUsage({ revision: 0, input: playerRequest.input });
    assert.equal(preview.fits, true);
    await env.generator.generateTurn(args);
    assert.equal(env.providerCalls.length, 2);
    for (const sent of env.providerCalls) {
      const fixed = JSON.parse(sent.messages[1].content);
      assert.deepEqual(fixed.canonicalState.inventory, start.inventory);
      assert.deepEqual(fixed.canonicalState.commitments, start.commitments);
      assert.deepEqual(fixed.canonicalState.situation, start.situation);
      assert.deepEqual(Object.keys(fixed.canonicalState.entities), Object.keys(start.entities));
      for (const [id, entity] of Object.entries(start.entities)) {
        const { attributes, ...structure } = entity;
        assert.deepEqual(fixed.canonicalState.entities[id], structure);
        assert.deepEqual(fixed.quotedEntityDescriptions[id], attributes);
      }
      for (const marker of [sample.identity, sample.status, "independent-character-description", "independent-location-description",
        "independent-item-description", "independent-hidden-description"]) {
        assert.equal(JSON.stringify(sent.messages).split(marker).length - 1, 1, "stored descriptions occur once even after tool continuation");
      }
      assert.doesNotMatch(JSON.stringify(sent), /retrieval-synopsis-must-not-be-sent/);
      assert.equal(JSON.stringify(sent.messages).split("eleventh day").length - 1, 1, "current commitments are supplied once in canonicalState");
    }
    const automatic = JSON.parse(env.providerCalls[0].messages[2].content.split("\n").slice(1).join("\n"));
    const toolResults = env.providerCalls[1].messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
    assert.deepEqual(toolResults[0], { revision: 0, entity: { id: "npc", kind: "character", name: "陈姨", aliases: ["隔壁邻居"], visibility: "player" } });
    assertToolFailure(toolResults[2], "ENTITY_NOT_AVAILABLE");
    for (const result of [automatic, toolResults[1]]) for (let index = 0; index < raw.results.length; index++) {
      assert.deepEqual(result.results[index].passages, raw.results[index].passages);
      assert.deepEqual(result.results[index].source, raw.results[index].source);
      assert.equal(Object.hasOwn(result.results[index], "currentFacts"), false, "custom readers cannot duplicate or override canonicalState facts");
    }
    assert.deepEqual(args, beforeArgs);
    assert.deepEqual(start, beforeStart);
    assert.deepEqual(raw, beforeRaw);
    assert.deepEqual(env.store.readModelState({ revision: 0 }), beforeArgs.state);
    assert.deepEqual(fs.readFileSync(env.databasePath), beforeDatabase);

    // The same localized, escaped first-request path must retain the opening
    // boundary even when later narrative capabilities exist in the snapshot.
    const openingText = `OPENING "${sample.locale}"\\\n😀`;
    let openingEstimate;
    const opening = setup(t, { initialState: createOpeningState(), storeOptions: { locale: sample.locale, memoryFragmentsEnabled: true },
      config: { openingText, finaleText: "UNAVAILABLE_FINALE_SOURCE", extremeText: "UNAVAILABLE_EXTREME_SOURCE",
        memoryFragmentText: "UNAVAILABLE_FRAGMENT_SOURCE" }, recall() { assert.fail("opening cannot perform automatic recall"); },
      respond() {
        openingEstimate = opening.generator.readUsage("attempt-one").contextUsage.latestEstimate;
        return reply(refusedBundle());
      } });
    const openingPreview = await opening.generator.readContextUsage({ revision: 0, input: playerRequest.input });
    await opening.generator.generateTurn(opening.args({ request: playerRequest }));
    assert.equal(opening.providerCalls.length, 1);
    const openingInput = opening.providerCalls[0], fixed = JSON.parse(openingInput.messages[1].content);
    assertDeliveredEstimate(openingInput, openingEstimate, openingPreview.latestEstimate);
    assert.equal(fixed.locale, sample.locale);
    assert.equal(fixed.canonicalState.opening.phase, "creating");
    assert.equal(fixed.quotedNarrativeSources.openingText, openingText);
    assert.equal(openingInput.messages[4].content, `Current player action:\n${playerRequest.input}`);
    assert.deepEqual(openingInput.tools, [], "opening cannot acquire narrative tools through request assembly");
    assert.doesNotMatch(JSON.stringify(openingInput.messages), /UNAVAILABLE_(FINALE|EXTREME|FRAGMENT)_SOURCE/);
    assert.deepEqual(opening.recalls, []);
    assert.equal(opening.store.readView().revision, 0);
  });
});

test("omitted original passages stay empty while synopsis truncation metadata is removed without mutating the reader", async (t) => {
  const raw = { revision: 0, results: [{ source: { experienceId: "bounded-account" },
    experience: { id: "bounded-account", text: "不能拿这段概括填补原文缺口", textRange: { start: 2, end: 20 }, textTruncated: true,
      entityIds: ["p"], eventIds: [], sourceSegmentIds: ["omitted"], kind: "belief", knownBy: ["p"] },
    passages: [], supportingPassages: [], supportingPassagesOmitted: 1,
    currentFacts: { entities: {}, inventory: [], commitments: {}, omitted: { entities: 1, inventory: 0, commitments: 0 } },
  }], truncated: true };
  const before = structuredClone(raw);
  const env = setup(t, { recall() { return raw; }, respond(_input, call) {
    return call === 1 ? tools([{ id: "empty-source", name: "recall_memory", arguments: '{"query":"原文呢"}' }]) : reply(refusedBundle());
  } });
  await env.generator.generateTurn(env.args());
  const output = JSON.parse(env.providerCalls[1].messages.find((message) => message.role === "tool").content);
  assert.deepEqual(output.results[0].passages, []);
  assert.deepEqual(output.results[0].supportingPassages, []);
  assert.equal(output.results[0].supportingPassagesOmitted, 1);
  assert.equal(output.truncated, true);
  assert.doesNotMatch(JSON.stringify(env.providerCalls), /不能拿这段概括填补原文缺口|textRange|textTruncated/);
  assert.match(env.providerCalls[0].messages[0].content, /Empty or omitted passages supply no substitute account/);
  assert.deepEqual(raw, before);
});

test("tool continuation preserves call IDs and opaque transport state only within the model loop", async (t) => {
  const transportState = { protocolFamily: "openai-chat", reasoningContent: 'opaque "provider" continuation\\\n😀',
    opaque: { values: ["untouched"] } };
  const originalTransport = structuredClone(transportState);
  const repairTransport = { protocolFamily: "openai-chat", reasoningContent: "opaque repair continuation" };
  const captured = [];
  let preview;
  const env = setup(t, { respond(input, number) {
    captured.push(structuredClone({ messages: input.messages, tools: input.tools, responseFormat: input.responseFormat }));
    assertDeliveredEstimate(input, env.generator.readUsage("attempt-one").contextUsage.latestEstimate,
      number === 1 ? preview.latestEstimate : undefined);
    if (number === 1) {
      input.messages[0].content = "PROVIDER_MUTATED_SYSTEM";
      input.messages[1].content = "PROVIDER_MUTATED_FACTS";
      input.messages[4].content = "PROVIDER_MUTATED_PLAYER_INPUT";
      input.tools[0].function.name = "PROVIDER_MUTATED_TOOL_SCHEMA";
      input.responseFormat.type = "PROVIDER_MUTATED_FORMAT";
      return tools([
        { id: "call-recall", name: "recall_memory", arguments: JSON.stringify({ query: "上次和邻居的约定", entityIds: ["npc"] }) },
        { id: "call-person", name: "read_entity", arguments: '{"entityId":"npc"}' },
      ], { transportState });
    }
    assert.deepEqual(input.messages.slice(0, 5), captured[0].messages, "a consumer cannot overwrite fixed request materials");
    assert.deepEqual(input.tools, captured[0].tools);
    assert.deepEqual(input.responseFormat, captured[0].responseFormat);
    if (number === 2) {
      const assistant = input.messages.find(message => message.toolCalls);
      assistant.transportState.opaque.values[0] = "PROVIDER_MUTATED_OPAQUE";
      assistant.toolCalls[0].id = "PROVIDER_MUTATED_CALL_ID";
      input.messages.find(message => message.role === "tool").content = "PROVIDER_MUTATED_RESULT";
      return reply(null, { text: "{broken", transportState: repairTransport });
    }
    assert.equal(number, 3);
    assert.deepEqual(input.messages.slice(0, captured[1].messages.length), captured[1].messages,
      "a subsequent repair receives the original ordered tool exchange, including nested opaque transport data");
    assert.deepEqual(input.messages.slice(-2).map(message => message.role), ["assistant", "system"]);
    assert.deepEqual(input.messages.at(-2).transportState, repairTransport);
    assert.doesNotMatch(JSON.stringify(input), /PROVIDER_MUTATED/);
    return reply(borrowBundle());
  } });
  preview = await env.generator.readContextUsage({ revision: 0, input: request().input });
  const beforeDatabase = fs.readFileSync(env.databasePath);
  const result = await env.generator.generateTurn(env.args());
  assert.deepEqual(result, borrowBundle());
  assert.equal(captured.length, 3);
  const followup = captured[1];
  const assistant = followup.messages.find((message) => message.toolCalls);
  assert.deepEqual(assistant.transportState, originalTransport);
  assert.deepEqual(assistant.toolCalls.map((call) => call.id), ["call-recall", "call-person"]);
  const outputs = followup.messages.filter((message) => message.role === "tool");
  assert.deepEqual(outputs.map((message) => message.toolCallId), ["call-recall", "call-person"]);
  assert.equal(JSON.parse(outputs[1].content).entity.name, "陈姨");
  assert.equal(env.recalls[1].viewerId, "p");
  assert.equal(env.recalls[1].revision, 0);
  assert.equal(env.generator.readUsage("attempt-one").toolCalls, 2);
  assert.equal(env.generator.readUsage("attempt-one").modelCalls, 3);
  assert.deepEqual(transportState, originalTransport);
  assert.deepEqual(fs.readFileSync(env.databasePath), beforeDatabase);
  assert.doesNotMatch(JSON.stringify(env.generator.readUsage("attempt-one")), /opaque provider continuation/);
  assert.doesNotMatch(JSON.stringify(result), /transportState|opaque provider continuation/);
});

test("the existing Provider adapter serializes tool continuation and output caps correctly without network access", async (t) => {
  const wireRequests = [];
  const provider = createOpenAICompatibleProvider({ model: "synthetic-model", apiKey: "synthetic-key",
    baseUrl: "https://model.example/v1", async requestImpl(_url, options) {
      wireRequests.push(JSON.parse(options.body));
      const message = wireRequests.length === 1
        ? { role: "assistant", content: "", reasoning_content: "continuation-marker", tool_calls: [
          { id: "wire-call", type: "function", function: { name: "read_entity", arguments: '{"entityId":"npc"}' } },
        ] } : { role: "assistant", content: JSON.stringify(borrowBundle()) };
      return new Response(JSON.stringify({ model: "synthetic-model", choices: [{ message,
        finish_reason: wireRequests.length === 1 ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 90, total_tokens: 190,
        completion_tokens_details: { reasoning_tokens: 10 } } }), { status: 200 });
    } });
  const env = setup(t, { config: { provider, maxOutputTokens: 1234 } });
  assert.deepEqual(await env.generator.generateTurn(env.args()), borrowBundle());
  assert.equal(wireRequests.length, 2);
  assert.equal(wireRequests[0].max_tokens, 1234);
  assert.deepEqual(wireRequests[0].response_format, { type: "json_object" });
  const assistant = wireRequests[1].messages.find((message) => message.tool_calls);
  assert.equal(assistant.reasoning_content, "continuation-marker");
  assert.equal(assistant.tool_calls[0].function.name, "read_entity");
  const tool = wireRequests[1].messages.find((message) => message.role === "tool");
  assert.equal(tool.tool_call_id, "wire-call");
  assert.equal(JSON.parse(tool.content).entity.name, "陈姨");
  assert.equal(env.generator.readUsage("attempt-one").usage.reasoning_tokens, 20);
});

test("ordinary candidate repair preserves private reasoning on the actual DeepSeek wire without persisting it", async (t) => {
  const { createDeepSeekProvider } = require("../providers/deepseek");
  for (const malformed of [false, true]) await t.test(malformed ? "JSON syntax repair" : "store validation repair", async (t) => {
    const marker = "synthetic-private-candidate-reasoning";
    const wireRequests = [];
    let env;
    const provider = createDeepSeekProvider({ apiKey: "synthetic-key", async requestImpl(_url, options) {
      const body = JSON.parse(options.body);
      wireRequests.push(body);
      if (wireRequests.length === 2) {
        assert.equal(env.store.readView().revision, 0, "the rejected candidate is not committed");
        const previous = body.messages.find((message) => message.role === "assistant");
        assert.equal(previous.reasoning_content, marker);
        assert.equal(Object.hasOwn(previous, "transportState"), false);
        assert.equal(Object.hasOwn(previous, "tool_calls"), false);
        assert.match(body.messages.at(-1).content, /^The previous/);
      }
      assert.ok(body.tools.length > 0);
      assert.equal(Object.hasOwn(body, "response_format"), false, "preserve the DeepSeek tools/JSON-mode policy");
      assert.equal(body.max_tokens, 4096);
      const text = wireRequests.length === 1
        ? (malformed ? "not valid JSON" : JSON.stringify(borrowBundle({ quantity: 30 })))
        : JSON.stringify(borrowBundle());
      return new Response(JSON.stringify({ model: "synthetic-model", choices: [{ message: {
        role: "assistant", content: text, reasoning_content: marker,
      }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 90, total_tokens: 190 } }), { status: 200 });
    } });
    env = setup(t, { config: { provider } });
    const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
    const result = await coordinator.runAction(request());
    assert.equal(result.status, "committed");
    assert.equal(result.view.revision, 1);
    assert.equal(wireRequests.length, 2);
    assert.deepEqual(result.view.narration, borrowBundle().narration);
    const usage = env.generator.readUsage(result.attemptId);
    assert.equal(usage.modelCalls, 2);
    assert.equal(usage.toolCalls, 0);
    assert.doesNotMatch(JSON.stringify({ result, usage, view: env.store.readView(), action: env.store.readAction(request().actionId) }),
      /synthetic-private-candidate-reasoning|transportState|reasoning_content|reasoningContent/);
  });
});

test("ordinary no-tools requests keep their existing assistant message without invented reasoning fields", async () => {
  const messages = [{ role: "user", content: "Return a JSON answer." }, { role: "assistant", content: '{"answer":"unchanged"}' }];
  const original = structuredClone(messages);
  let body;
  const provider = createOpenAICompatibleProvider({ model: "synthetic-model", apiKey: "synthetic-key",
    baseUrl: "https://model.example/v1", async requestImpl(_url, options) {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: '{"answer":"done"}' },
        finish_reason: "stop" }] }), { status: 200 });
    } });
  const result = await provider.generate({ messages, tools: [], responseFormat: { type: "json_object" }, maxOutputTokens: 1234 });
  assert.deepEqual(body.messages, original);
  assert.deepEqual(messages, original);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_tokens, 1234);
  assert.equal(result.text, '{"answer":"done"}');
  assert.doesNotMatch(JSON.stringify(body), /reasoning_content|transportState/);
});

test("ordinary candidate reasoning counts toward the next repair request budget before another Provider call", async (t) => {
  const baseline = setup(t);
  const before = await baseline.generator.readContextUsage({ revision: 0, input: request().input });
  const maxContextCharacters = before.latestEstimate.characters + 1000;
  const env = setup(t, { config: { maxContextCharacters }, respond() {
    return reply(null, { text: "not valid JSON", transportState: {
      protocolFamily: "openai-chat", reasoningContent: "synthetic-private-budget-marker" + "r".repeat(4000),
    } });
  } });
  await assert.rejects(env.generator.generateTurn(env.args()), { code: "CONTEXT_BUDGET_EXCEEDED" });
  assert.equal(env.providerCalls.length, 1);
  assert.equal(env.store.readView().revision, 0);
  const usage = env.generator.readUsage("attempt-one");
  assert.equal(usage.modelCalls, 1);
  assert.equal(usage.contextUsage.fits, false);
  assert.ok(usage.contextUsage.latestEstimate.characters > maxContextCharacters);
  assert.doesNotMatch(JSON.stringify(usage), /synthetic-private-budget-marker|reasoningContent/);
});

test("read tools cannot switch viewer/revision, request hidden entities, or call old state writers", async (t) => {
  const env = setup(t, { respond(_input, number) {
    return number === 1 ? tools([
      { id: "a", name: "recall_memory", arguments: '{"query":"秘密","viewerId":"secret","revision":99}' },
      { id: "b", name: "read_entity", arguments: '{"entityId":"secret"}' },
      { id: "c", name: "finalize_new_game", arguments: '{}' },
      { id: "d", name: "recall_memory", arguments: '{"query":"秘密","entityIds":["secret"]}' },
    ]) : reply(refusedBundle());
  } });
  await env.generator.generateTurn(env.args());
  assert.equal(env.recalls.length, 1, "only the automatic player-scoped recall ran");
  const outputs = env.providerCalls[1].messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
  assert.deepEqual(outputs.map((value) => value.error.code), ["TOOL_ARGUMENTS_INVALID", "ENTITY_NOT_AVAILABLE", "TOOL_NOT_AVAILABLE", "TOOL_ARGUMENTS_INVALID"]);
  assert.equal(env.store.readView().revision, 0);
});

test("malformed JSON is repaired inside the same actual-call budget", async (t) => {
  const env = setup(t, { respond(_input, number) {
    return number === 1 ? reply(null, { text: "```json broken" }) : reply(borrowBundle());
  } });
  assert.deepEqual(await env.generator.generateTurn(env.args()), borrowBundle());
  assert.equal(env.generator.readUsage("attempt-one").modelCalls, 2);
  assert.match(env.providerCalls[1].messages.at(-1).content, /not a JSON object/);
});

test("tool arguments, JSON and state corrections share three rounds while a failed tool batch counts once", async (t) => {
  const snapshots = [];
  const env = setup(t, { recordExecution(value) { snapshots.push(value); }, respond(input, call) {
    assert.equal(env.store.readView().revision, 0, "No failed candidate or successful lookup commits a partial turn");
    if (call === 1) return tools([
      { id: "bad-entity", name: "read_entity", arguments: '{"entityId":7}' },
      { id: "bad-recall", name: "recall_memory", arguments: '{"query":""}' },
    ]);
    if (call === 2) {
      const errors = input.messages.filter(message => message.role === "tool").map(message => JSON.parse(message.content).error);
      assert.equal(errors.length, 2);
      assert(errors.every(error => error.code === "TOOL_ARGUMENTS_INVALID" && error.feedback.length));
      assert(errors.every(error => error.feedback.every(issue => typeof issue.path === "string" && typeof issue.repair === "string")));
      return reply(null, { text: "{broken" });
    }
    if (call === 3) return reply(borrowBundle({ quantity: 30 }));
    assert.equal(call, 4);
    return reply(borrowBundle());
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "committed");
  assert.equal(env.providerCalls.length, 4);
  assert.equal(env.generator.readUsage(result.attemptId).toolCalls, 2);
  assert.deepEqual(snapshots.at(-1).steps.filter(step => step.kind === "repair").map(step => step.reason),
    ["tool_feedback", "json_syntax", "validation"]);
  assert.equal(env.store.readView().revision, 1);
});

test("a fourth correction cannot bypass the shared limit by changing error category", async (t) => {
  const snapshots = [];
  const env = setup(t, { recordExecution(value) { snapshots.push(value); }, respond(_input, call) {
    if (call === 1) return reply(null, { text: "{broken" });
    if (call === 2) return reply({ narration: [{ id: "s", text: "未被接受的片段。" }],
      events: [{ id: "e", type: "memory_fragment.record", sourceSegmentIds: ["s"], data: {} }], experiences: [] });
    if (call === 3) return reply(borrowBundle({ quantity: 30 }));
    if (call === 4) return tools([{ id: "bad", name: "read_entity", arguments: '{}' }]);
    throw new Error("A fourth correction must not call the Provider");
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "REPAIR_BUDGET_EXCEEDED");
  assert.equal(env.providerCalls.length, 4);
  assert.equal(snapshots.at(-1).steps.filter(step => step.kind === "repair").length, 3);
  assert.equal(env.store.readView().revision, 0);
  assert.equal((await coordinator.runAction(request())).error.code, "REPAIR_BUDGET_EXCEEDED");
  assert.equal(env.providerCalls.length, 4, "Restoring failure never silently starts another attempt");
});

test("successful tools consume no correction rounds and the eighth model call is reserved for a final bundle", async (t) => {
  for (const ignoresFinalInstruction of [false, true]) await t.test(ignoresFinalInstruction ? "late tool rejected" : "final bundle", async (t) => {
    const snapshots = [];
    const env = setup(t, { recordExecution(value) { snapshots.push(value); }, respond(input, call) {
      if (call < 8) {
        assert(input.tools.some(tool => tool.function.name === "read_entity"));
        return tools([{ id: `read-${call}`, name: "read_entity", arguments: '{"entityId":"p"}' }]);
      }
      assert.equal(call, 8);
      assert.deepEqual(input.tools, []);
      assert.match(input.messages.at(-1).content, /complete final JSON result/);
      assert.match(input.messages.at(-1).content, /preserve uncertainty/);
      return ignoresFinalInstruction ? tools([{ id: "unusable-read", name: "read_entity", arguments: '{"entityId":"p"}' }])
        : reply(refusedBundle());
    } });
    if (ignoresFinalInstruction) await assert.rejects(env.generator.generateTurn(env.args()), { code: "MODEL_CALL_BUDGET_EXCEEDED" });
    else assert.deepEqual(await env.generator.generateTurn(env.args()), refusedBundle());
    assert.equal(env.providerCalls.length, 8);
    assert.equal(env.generator.readUsage("attempt-one").toolCalls, 7, "The final response cannot start an unusable lookup");
    assert.equal(snapshots.at(-1).steps.filter(step => step.kind === "repair").length, 0);
    assert.equal(env.store.readView().revision, 0);
  });
});

test("four semantic failures exhaust three corrections even when a caller requests more candidates", async (t) => {
  const env = setup(t, { respond() { return reply(borrowBundle({ quantity: 30 })); } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn, maxAttempts: 8 });
  const result = await coordinator.runAction(request());
  assert.equal(result.error.code, "REPAIR_BUDGET_EXCEEDED");
  assert.equal(env.providerCalls.length, 4);
  assert.equal(result.modelCalls, 4);
  assert.equal(env.store.readView().revision, 0);
});

test("Provider failures during correction terminate without spending the remaining model or repair budget", async (t) => {
  for (const code of ["UPSTREAM_AUTH_ERROR", "PROVIDER_FAILED", "API_TIMEOUT"]) await t.test(code, async (t) => {
    const snapshots = [];
    const env = setup(t, { recordExecution(value) { snapshots.push(value); }, respond(_input, call) {
      if (call === 1) return reply(null, { text: "{broken" });
      throw Object.assign(new Error("PRIVATE_PROVIDER_MESSAGE"), { code, retryable: true });
    } });
    const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
    const result = await coordinator.runAction(request());
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, code);
    assert.equal(env.providerCalls.length, 2);
    assert.equal(snapshots.at(-1).steps.filter(step => step.kind === "repair").length, 1);
    assert.equal(env.store.readView().revision, 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_MESSAGE/);
  });
});

test("a newly revealed lender holding must be recorded before transfer, with safe repair and atomic commitments", async (t) => {
  const start = initialState();
  start.entities.kept_tool = { id: "kept_tool", kind: "item", name: "旧夹钳", aliases: [], visibility: "player", attributes: {} };
  start.inventory.push({ ownerId: "p", itemId: "kept_tool", quantity: 1 });
  const invalid = {
    narration: [{ id: "deposit", text: "你把旧夹钳托付邻居保管。" },
      { id: "reveal", text: "邻居从自己的包里拿出一个量杯。" },
      { id: "lend", text: "她把量杯递给你，你答应测量后归还。" }],
    events: [
      { id: "create", type: "entity.create", sourceSegmentIds: ["reveal"], data: { entity: {
        id: "borrowed_cup", kind: "item", name: "量杯", aliases: [], visibility: "player", attributes: {} } } },
      { id: "deposit", type: "inventory.transfer", sourceSegmentIds: ["deposit"], data: { fromId: "p", toId: "npc", itemId: "kept_tool", quantity: 1 } },
      { id: "lend", type: "inventory.transfer", sourceSegmentIds: ["lend"], data: { fromId: "npc", toId: "p", itemId: "borrowed_cup", quantity: 1 } },
      { id: "promise", type: "commitment.create", sourceSegmentIds: ["lend"], data: { commitment: {
        id: "cup_return", debtorId: "p", creditorId: "npc", itemId: "borrowed_cup", quantity: 1, due: "测量后", status: "open" } } },
    ], experiences: [],
  };
  const repaired = structuredClone(invalid);
  repaired.events.splice(2, 0, { id: "reveal-holding", type: "inventory.adjust", sourceSegmentIds: ["reveal"],
    data: { ownerId: "npc", itemId: "borrowed_cup", delta: 1 } });
  const returned = { narration: [{ id: "return", text: "测量后，你把量杯归还邻居，兑现承诺。" }], events: [
    { id: "return", type: "inventory.transfer", sourceSegmentIds: ["return"], data: { fromId: "p", toId: "npc", itemId: "borrowed_cup", quantity: 1 } },
    { id: "fulfill", type: "commitment.resolve", sourceSegmentIds: ["return"], data: { id: "cup_return", status: "fulfilled" } },
  ], experiences: [] };
  const env = setup(t, { initialState: start, respond(input, call) {
    if (call === 1) {
      assert.match(input.messages[0].content, /Creating an item entity does NOT give anyone inventory/);
      assert.match(input.messages[0].content, /Do not register stock again/);
      return reply(invalid);
    }
    if (call === 2) {
      assert.equal(env.store.readView().revision, 0);
      assert.deepEqual(env.store.readModelState(), start, "item creation, earlier transfer and promise were not partially committed");
      const feedback = input.messages.at(-1).content;
      assert.match(feedback, /"path":"bundle\.events\[2\]\.data","issue":"insufficient inventory"/);
      assert.doesNotMatch(feedback, /borrowed_cup|kept_tool|cup_return|量杯|邻居/);
      return reply(repaired);
    }
    return reply(returned);
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const action = request({ actionId: "borrow-cup", input: "帮我保管夹钳，借一个量杯，测完就还。" });
  const result = await coordinator.runAction(action);
  assert.equal(result.status, "committed"); assert.equal(result.view.revision, 1);
  let state = env.store.readModelState();
  assert.deepEqual(state.inventory.filter((holding) => holding.itemId === "kept_tool"), [{ ownerId: "npc", itemId: "kept_tool", quantity: 1 }]);
  assert.deepEqual(state.inventory.filter((holding) => holding.itemId === "borrowed_cup"), [{ ownerId: "p", itemId: "borrowed_cup", quantity: 1 }]);
  assert.equal(state.commitments.cup_return.status, "open");
  assert.equal(env.providerCalls.length, 2);
  await coordinator.runAction(action);
  assert.equal(env.providerCalls.length, 2, "a repeated receipt does not reveal or transfer the holding again");
  const giveBack = await coordinator.runAction(request({ actionId: "return-cup", baseRevision: 1, input: "我归还借来的量杯。" }));
  assert.equal(giveBack.status, "committed"); assert.equal(giveBack.view.revision, 2);
  state = env.store.readModelState();
  assert.deepEqual(state.inventory.filter((holding) => holding.itemId === "borrowed_cup"), [{ ownerId: "npc", itemId: "borrowed_cup", quantity: 1 }]);
  assert.equal(state.commitments.cup_return.status, "fulfilled");
  assert.equal(env.providerCalls.length, 3);
});

test("repair feedback preserves only bounded event positions and fixed categories", async (t) => {
  const env = setup(t);
  await env.generator.generateTurn(env.args({ validationError: { code: "TURN_VALIDATION_FAILED", issues: [
    "bundle.events[8].data: insufficient inventory",
    "state.entities.private_inventory_73421.attributes.secret_token: secret-value-98261",
    "bundle.events[9007199254740992].data: insufficient inventory",
  ] } }));
  const feedback = env.providerCalls[0].messages.at(-1).content;
  assert.match(feedback, /"path":"bundle\.events\[8\]\.data","issue":"insufficient inventory"/);
  assert.match(feedback, /"path":"bundle\.events\[\]\.data"/);
  assert.doesNotMatch(feedback, /private_inventory|73421|secret_token|secret-value|98261|9007199254740992/);
});

test("observation and recollection preserve existing personal conditions without mandatory status events", async (t) => {
  for (const [locale, input, text, condition] of [
    ["zh-CN", "我先听清她说什么，不贸然行动。", "你听完她的话，仍未弄清事情的来龙去脉。", "疲惫，右臂旧伤未愈"],
    ["en", "I decline and try to recall what happened.", "You decline and try to recall it; the details remain uncertain.", "Tired; the old arm wound has not healed"],
    ["ja", "今は断って、前の話を思い出してみます。", "あなたは断り、以前の話を思い出そうとするが、まだはっきりしない。", "疲労があり、腕の傷はまだ治っていない"],
  ]) await t.test(locale, async (t) => {
    const start = initialState(); start.entities.p.attributes = { occupation: "prior identity", status: condition };
    const candidate = { narration: [{ id: "observation", text }], events: [], experiences: [] };
    const env = setup(t, { initialState: start, storeOptions: { locale }, respond() { return reply(candidate); } });
    const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
    const action = request({ actionId: `condition-preserved-${locale}`, input, locale });
    const result = await coordinator.runAction(action);
    assert.equal(result.status, "committed"); assert.equal(env.providerCalls.length, 1);
    assert.deepEqual(env.store.readModelState(), start);
    assert.deepEqual(env.store.readTurn(1).events, []);
    assert.equal(result.view.state.entities.p.attributes.status, condition);
    assert.equal((await coordinator.runAction(action)).status, "committed");
    assert.equal(env.providerCalls.length, 1);
  });
});

test("malformed condition events repair with fixed feedback and the original transport state", async (t) => {
  const cases = [
    { locale: "zh-CN", mode: "empty", text: "锋利的边缘划破你的右前臂，留下一道浅伤。", condition: "右前臂浅表划伤" },
    { locale: "en", mode: "object", text: "A sharp edge scratches your forearm, leaving a shallow cut.", condition: "Shallow cut on the forearm" },
    { locale: "ja", mode: "oversized", text: "鋭い縁が前腕をかすめ、浅い切り傷ができる。", condition: "前腕に浅い切り傷" },
    { locale: "zh-CN", mode: "hidden", text: "锋利的边缘划破你的右前臂，留下一道浅伤。", condition: "右前臂浅表划伤" },
    { locale: "en", mode: "obsolete-source", text: "A sharp edge scratches your forearm, leaving a shallow cut.", condition: "Shallow cut on the forearm" },
    { locale: "zh-CN", mode: "false-quote", text: "你的左手有一道浅划伤。", condition: "左手浅划伤" },
  ];
  for (const sample of cases) await t.test(sample.mode, async (t) => {
    const start = initialState();
    start.entities.p.attributes = { occupation: "prior identity", description: "unchanged description" };
    const repaired = { narration: [{ id: "injury", text: sample.text }, { id: "neighbour-view", text: "The neighbour's face is visible in the light." }], events: [
      { id: "neighbour", type: "entity.update", sourceSegmentIds: ["neighbour-view"], data: { id: "npc", attributes: { description: "Face visible in the light" } } },
      { id: "condition-change", type: "condition.add", sourceSegmentIds: ["injury"], data: { characterId: "p", basis: "observed", text: sample.condition, evidence: [{ segmentId: "injury", quote: sample.text }] } },
    ], experiences: [] };
    const invalid = structuredClone(repaired);
    if (sample.mode === "empty") invalid.events[1].data.text = " ";
    else if (sample.mode === "object") invalid.events[1].data.text = { "private-model-key": "private-model-value" };
    else if (sample.mode === "oversized") invalid.events[1].data.text = "x".repeat(121);
    else if (sample.mode === "obsolete-source") invalid.events[1].data.statusFrom = { segmentId: "injury" };
    else if (sample.mode === "false-quote") invalid.events[1].data.evidence[0].quote = "private-model-invented-quote";
    else invalid.events.splice(1, 0, { id: "hide-player", type: "entity.update", sourceSegmentIds: ["injury"], data: { id: "p", visibility: "hidden" } });
    const expectedReason = sample.mode === "hidden" ? "current player must remain player-visible"
      : sample.mode === "obsolete-source" ? "unknown or non-data field"
        : sample.mode === "false-quote" ? "condition quote must match current narration exactly once"
          : "must be nonempty well-formed text of at most 120 characters";
    const transportState = { protocolFamily: "openai-chat", reasoningContent: "private-status-continuation" };
    const env = setup(t, { initialState: start, storeOptions: { locale: sample.locale }, config: { maxModelCalls: 2 },
      respond(input, call) {
        if (call === 1) return reply(invalid, { transportState });
        assert.equal(call, 2);
        assert.deepEqual(env.store.readModelState(), start, "an earlier NPC update in the rejected bundle cannot commit alone");
        assert.equal(env.store.readView().revision, 0);
        assert.equal(env.store.readView().history.length, 0);
        assert.deepEqual(input.messages.slice(0, 5), env.providerCalls[0].messages, "repair keeps the same input and fixed sources");
        assert.equal(input.signal, env.providerCalls[0].signal);
        assert.equal(input.maxOutputTokens, 4096);
        const previous = input.messages.at(-2);
        assert.equal(previous.content, JSON.stringify(invalid));
        assert.deepEqual(previous.transportState, transportState);
        const feedback = JSON.parse(input.messages.at(-1).content.split("Structural feedback: ")[1]);
        assert.equal(feedback.length, 1); assert.equal(feedback[0].issue, expectedReason);
        assert.ok(feedback[0].path.startsWith("bundle.events[1].data"));
        assert.doesNotMatch(JSON.stringify(feedback), /private-model|private-status|prior identity|unchanged description/);
        return reply(repaired);
      } });
    const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
    const action = request({ actionId: `condition-${sample.mode}`, input: sample.text, locale: sample.locale });
    const result = await coordinator.runAction(action);
    assert.equal(result.status, "committed"); assert.equal(result.view.revision, 1);
    assert.equal(env.providerCalls.length, 2);
    assert.deepEqual(env.store.readModelState().entities.p.attributes, start.entities.p.attributes);
    assert.equal(result.view.state.entities.p.visibility, "player");
    const record = result.view.state.entities.p.conditionRecords.items[0];
    assert.equal(record.text, sample.condition);
    assert.deepEqual(record.sources, [{ adventureId: "test-adventure", revision: 1, segmentId: "injury", start: 0, end: sample.text.length, totalCharacters: sample.text.length, quote: sample.text }]);
    assert.deepEqual(env.store.readTurn(1).events[1].data, repaired.events[1].data);
    assert.deepEqual(result.view.narration, repaired.narration);
    assert.deepEqual(env.store.readAction(action.actionId).request, action);
    const usage = env.generator.readUsage(result.attemptId);
    assert.equal(usage.modelCalls, 2); assert.equal(usage.toolCalls, 0); assert.equal(usage.usageComplete, true);
    assert.deepEqual(usage.usage, { input_tokens: 200, output_tokens: 160, total_tokens: 360 });
    assert.doesNotMatch(JSON.stringify({ result, usage, turn: env.store.readTurn(1) }), /private-model|private-status|transportState|reasoningContent/);
    assert.equal((await coordinator.runAction(action)).status, "committed");
    assert.equal(env.providerCalls.length, 2, "an already committed action never repeats its repair");
  });
});

test("legacy body descriptions remain readable but cannot be silently converted through generated events", async (t) => {
  const initial = initialState();
  initial.entities.p.attributes = { status: "疲劳，右手包扎", condition: "尚未恢复", occupation: "面点工", mood: "担忧" };
  initial.entities.rice.attributes.condition = "包装受潮";
  const checked = "你的右手包扎仍然干燥，没有新的出血。";
  const attempted = { narration: [{ id: "checked", text: checked }], experiences: [], events: [
    { id: "seen", type: "entity.update", sourceSegmentIds: ["checked"], data: { id: "npc", attributes: { mood: "担忧" } } },
    { id: "convert", type: "condition.add", sourceSegmentIds: ["checked"], data: { characterId: "p", basis: "observed", text: "右手包扎干燥，无新出血", evidence: [{ segmentId: "checked", quote: checked }] } },
  ] };
  const env = setup(t, { initialState: initial, config: { maxModelCalls: 2 }, respond(input, call) {
    const fixed = JSON.parse(input.messages[1].content);
    assert.deepEqual(fixed.quotedEntityDescriptions.p, initial.entities.p.attributes);
    assert.equal(fixed.quotedEntityDescriptions.rice.condition, "包装受潮");
    if (call === 1) return reply(attempted);
    assert.deepEqual(env.store.readModelState(), initial);
    const feedback = JSON.parse(input.messages.at(-1).content.split("Structural feedback: ")[1]);
    assert(feedback.every(issue => typeof issue.code === "string" && typeof issue.repair === "string"));
    assert.deepEqual(feedback.map(({ path, issue }) => ({ path, issue })), [{ path: "bundle.events[1]", issue: "legacy character conditions cannot be converted by condition events" }]);
    return reply({ narration: [{ id: "wait", text: "你听完了邻居的话。" }], events: [], experiences: [] });
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request({ actionId: "legacy-condition", input: "我继续听邻居说话。" }));
  assert.equal(result.status, "committed"); assert.equal(result.view.revision, 1);
  assert.equal(env.providerCalls.length, 2);
  assert.deepEqual(env.store.readModelState(), initial);
  assert.deepEqual(env.store.readTurn(1).events, []);
});

test("a new character's legacy bodily field repairs into a sourced condition event", async (t) => {
  const text = "一位右手已经包扎的来客在门口停下，神情谨慎。";
  const created = { narration: [{ id: "person", text }], experiences: [], events: [
    { id: "new-person", type: "entity.create", sourceSegmentIds: ["person"], data: { entity: {
      id: "visitor", kind: "character", name: "来客", aliases: [], visibility: "player", attributes: { condition: "private-generated-condition", mood: "谨慎" },
    } } },
  ] };
  const revised = structuredClone(created); revised.events[0].data.entity.attributes = { mood: "谨慎" };
  revised.events.push({ id: "body", type: "condition.add", sourceSegmentIds: ["person"], data: { characterId: "visitor", basis: "observed", text: "右手已包扎" } });
  const env = setup(t, { respond(input, call) {
    if (call === 1) return reply(created);
    const feedback = JSON.parse(input.messages.at(-1).content.split("Structural feedback: ")[1]);
    assert(feedback.every(issue => typeof issue.code === "string" && typeof issue.repair === "string"));
    assert.deepEqual(feedback.map(({ path, issue }) => ({ path, issue })), [{ path: "bundle.events[0].data.entity.attributes.condition", issue: "character conditions must be written through condition events" }]);
    assert.doesNotMatch(JSON.stringify(feedback), /private-generated-condition/);
    assert.equal(env.store.readModelState().entities.visitor, undefined);
    return reply(revised);
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "committed"); assert.equal(env.providerCalls.length, 2);
  assert.deepEqual(result.view.state.entities.visitor.attributes, { mood: "谨慎" });
  assert.equal(result.view.state.entities.visitor.conditionRecords.items[0].text, "右手已包扎");
  assert.equal(result.view.state.entities.visitor.conditionRecords.items[0].sources[0].quote, text);
  assert.equal(result.view.state.entities.visitor.conditionRecords.items[0].sources[0].start, 0);
});

test("optional personal-condition repair cannot exceed model or coordinator budgets or invent a partial result", async (t) => {
  for (const maxModelCalls of [1, 4]) await t.test(`model limit ${maxModelCalls}`, async (t) => {
    const invalid = borrowBundle();
    invalid.events.push({ id: "invalid-condition", type: "entity.update", sourceSegmentIds: ["borrow-text"], data: { id: "p", attributes: { status: "" } } });
    let fix = false;
    const env = setup(t, { config: { maxModelCalls }, respond() { return reply(fix ? borrowBundle() : invalid); } });
    const initial = env.store.readModelState();
    const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn, maxAttempts: 2 });
    const action = request();
    const result = await coordinator.runAction(action);
    const expectedCalls = maxModelCalls === 1 ? 1 : 2;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, maxModelCalls === 1 ? "MODEL_CALL_BUDGET_EXCEEDED" : "TURN_VALIDATION_FAILED");
    assert.equal(env.providerCalls.length, expectedCalls);
    assert.deepEqual(env.store.readModelState(), initial);
    assert.equal(env.store.readView().revision, 0); assert.equal(env.store.readView().history.length, 0);
    assert.equal(env.generator.readUsage(result.attemptId).modelCalls, expectedCalls);
    assert.equal((await coordinator.runAction(action)).status, "failed");
    assert.equal(env.providerCalls.length, expectedCalls, "failure requires an explicit retry");
    fix = true;
    const retried = await coordinator.runAction(action, { retry: true });
    assert.equal(retried.status, "committed"); assert.equal(retried.view.revision, 1);
    assert.notEqual(retried.attemptId, result.attemptId);
    assert.deepEqual(env.store.readAction(action.actionId).request, action);
    assert.equal(env.providerCalls.length, expectedCalls + 1);
  });
});

test("cancelling an optional personal-condition repair rejects the late valid bundle without committing an earlier change", async (t) => {
  const invalid = borrowBundle();
  invalid.events.push({ id: "invalid-condition", type: "entity.update", sourceSegmentIds: ["borrow-text"], data: { id: "p", attributes: { status: "" } } });
  let entered, finish;
  const repairStarted = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { finish = resolve; });
  const env = setup(t, { config: { maxModelCalls: 2 }, respond(_input, call) {
    if (call === 1) return reply(invalid);
    entered(); return pending;
  } });
  const before = env.store.readModelState();
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const controller = new AbortController();
  const action = request();
  const running = coordinator.runAction(action, { signal: controller.signal });
  await repairStarted; controller.abort();
  const result = await running;
  assert.equal(result.status, "cancelled"); assert.equal(env.providerCalls.length, 2);
  assert.equal(env.providerCalls[1].signal.aborted, true);
  const usage = env.generator.readUsage(result.attemptId);
  assert.equal(usage.modelCalls, 2); assert.equal(usage.usageComplete, false);
  assert.equal(usage.usage.input_tokens, 100, "the unfinished repair has no invented token usage");
  finish(reply(borrowBundle()));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.store.readAction(action.actionId).status, "cancelled");
  assert.deepEqual(env.store.readModelState(), before);
  assert.equal(env.store.readView().revision, 0); assert.equal(env.store.readView().history.length, 0);
  assert.equal((await coordinator.runAction(action, { retry: true })).status, "cancelled");
  assert.equal(env.providerCalls.length, 2);
});

test("a malformed nested opening proposal is repaired without partial facts, then confirmation projects its physical possession", async (t) => {
  const { projectSessionPanel, projectSessionView } = require("./session-projection");
  const entity = (id, kind, name, attributes = {}) => ({ id, kind, name, aliases: [], visibility: "player", attributes });
  const proposedState = { entities: {
    p: entity("p", "character", "旅人", { occupation: "邮差", description: "留下的是家传的铜铃。" }),
    home: entity("home", "location", "门廊"), bell: entity("bell", "item", "铜铃", { description: "家传的小铜铃。" }),
  }, inventory: [{ ownerId: "p", itemId: "bell", quantity: 1 }], commitments: {},
  situation: { playerId: "p", locationId: "home", day: 10 } };
  const proposal = { narration: [{ id: "summary", text: "你是疲惫的邮差，带着家传的铜铃，从门廊开始。这样开始吗？" }],
    events: [{ id: "propose", type: "opening.propose", sourceSegmentIds: ["summary"],
      data: { proposalId: "chosen", initialState: proposedState, initialConditions: [{ characterId: "p", basis: "observed", text: "疲惫" }] } }], experiences: [] };
  // The live failure closed initialState immediately after its entities map.
  const malformed = JSON.stringify(proposal).replace('},"inventory":', '}},"inventory":');
  assert.throws(() => JSON.parse(malformed), SyntaxError);
  const env = setup(t, { initialState: createOpeningState(), respond(input, number) {
    if (number === 1) return reply(null, { text: malformed });
    if (number === 2) {
      assert.equal(env.store.readView().revision, 0);
      assert.deepEqual(env.store.readView().state.inventory, []);
      const diagnostic = JSON.parse(input.messages.at(-1).content.split(" Safe syntax feedback: ")[1].split(" Regenerate the entire result")[0]);
      assert.equal(diagnostic.code, "JSON_SYNTAX");
      assert(Number.isSafeInteger(diagnostic.position) && diagnostic.position >= 0);
      assert(Number.isSafeInteger(diagnostic.line) && diagnostic.line >= 1);
      assert(Number.isSafeInteger(diagnostic.column) && diagnostic.column >= 1);
      assert.match(input.messages.at(-1).content, /Regenerate the entire result/);
      return reply(proposal);
    }
    return reply({ narration: [{ id: "scene", text: "铜铃碰着你的掌心，你站在门廊中。" }],
      events: [{ id: "confirm", type: "opening.confirm", sourceSegmentIds: ["scene"], data: { proposalId: "chosen" } }], experiences: [] });
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const pending = await coordinator.runAction(request({ actionId: "propose", input: "从门廊开始。" }));
  assert.equal(pending.status, "committed");
  assert.equal(pending.view.state.opening.phase, "awaiting_confirmation");
  assert.deepEqual(pending.view.state.inventory, []);
  const ready = await coordinator.runAction(request({ actionId: "confirm", baseRevision: 1, input: "对，就这样开始。" }));
  assert.equal(ready.status, "committed");
  assert.deepEqual(ready.view.state.inventory, proposedState.inventory);
  assert.equal(env.providerCalls.length, 3);
  assert.equal(projectSessionView(ready.view).state_hint.player.status_label, "疲惫");
  const bodySource = ready.view.state.entities.p.conditionRecords.items[0].sources[0];
  assert.equal(bodySource.quote, proposal.narration[0].text);
  assert.equal(bodySource.revision, 1, "confirmation keeps the proposal's full source instead of relabeling it");
  const inventory = projectSessionPanel(ready.view, { panelRef: "session_inventory", view: "list", fieldId: "inventory" });
  assert.equal(inventory.panel.items.length, 1);
  assert.equal(inventory.panel.items[0].title, "铜铃");
  assert.equal(inventory.panel.items[0].statusLabel, "数量: 1");
  assert.doesNotMatch(env.providerCalls[1].messages.at(-1).content, /旅人|邮差|铜铃/);
});

test("JSON syntax feedback never quotes model-created secrets or parser excerpts", async (t) => {
  const env = setup(t, { respond(_input, number) {
    return number === 1 ? reply(null, { text: '{"sk-private-secret-token":}' }) : reply(refusedBundle());
  } });
  await env.generator.generateTurn(env.args());
  const feedback = env.providerCalls[1].messages.at(-1).content;
  assert.doesNotMatch(feedback, /sk-private|token|Unexpected token/);
  assert.match(feedback, /indented JSON object/);
});

test("coordinator structural repair cannot reset the actual Provider-call budget", async (t) => {
  const env = setup(t, { config: { maxModelCalls: 2 }, respond() { return reply(borrowBundle({ quantity: 30 })); } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn, maxAttempts: 8 });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "MODEL_CALL_BUDGET_EXCEEDED");
  assert.equal(env.providerCalls.length, 2);
  assert.equal(env.store.readView().revision, 0);
  assert.equal(env.generator.readUsage(result.attemptId).modelCalls, 2);
  assert.match(env.providerCalls[1].messages.at(-1).content, /Structural feedback/);
});

test("tool budget spans coordinator repairs and refuses an over-budget batch before executing it", async (t) => {
  const env = setup(t, { config: { maxToolCalls: 1 }, respond(_input, number) {
    if (number === 1 || number === 3) return tools([{ id: `tool-${number}`, name: "read_entity", arguments: '{"entityId":"npc"}' }]);
    return reply(borrowBundle({ quantity: 30 }));
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn, maxAttempts: 4 });
  const result = await coordinator.runAction(request());
  assert.equal(result.error.code, "TOOL_CALL_BUDGET_EXCEEDED");
  assert.equal(env.providerCalls.length, 3);
  assert.equal(env.generator.readUsage(result.attemptId).toolCalls, 1);
  assert.equal(env.store.readView().revision, 0);
});

test("continuous history retains the first original and excludes future revisions", async (t) => {
  const env = setup(t);
  for (let revision = 0; revision < 9; revision += 1) {
    const input = request({ actionId: `walk-${revision}`, baseRevision: revision, input: `第${revision}次行走` });
    const started = env.store.beginAction(input);
    env.store.commitAction({ actionId: input.actionId, attemptId: started.attemptId,
      bundle: { narration: [{ id: "s", text: revision === 0 ? "FIRST_SOURCE_MUST_REMAIN" : `走廊第${revision}段` }], events: [], experiences: [] } });
  }
  const input = request({ actionId: "later", baseRevision: 8 });
  await env.generator.generateTurn(env.args({ request: input, state: env.store.readModelState({ revision: 8 }) }));
  const prompt = JSON.stringify(env.providerCalls[0].messages);
  assert.match(prompt, /FIRST_SOURCE_MUST_REMAIN/);
  assert.doesNotMatch(prompt, /走廊第8段/);
  assert.match(prompt, /走廊第7段/);
  assert.equal(env.recalls[0].revision, 8);
});

test("continuous prose and canonical facts are never silently shortened", async (t) => {
  const env = setup(t, { config: { contextPolicy: { configuredContextWindow: 128000 } } });
  const started = env.store.beginAction(request());
  env.store.commitAction({ actionId: request().actionId, attemptId: started.attemptId,
    bundle: { narration: [{ id: "s", text: "往事".repeat(12000) }], events: [], experiences: [] } });
  await env.generator.generateTurn(env.args({ request: request({ actionId: "next", baseRevision: 1 }), state: env.store.readModelState({ revision: 1 }) }));
  const history = JSON.parse(env.providerCalls[0].messages[3].content.split("\n").slice(1).join("\n"));
  assert.deepEqual(history.turns[0].narration, [{ id: "s", text: "往事".repeat(12000) }]);
  const largeState = initialState();
  largeState.entities.p.attributes.description = "事实".repeat(25000);
  await assert.rejects(env.generator.generateTurn(env.args({ attemptId: "large-state", state: largeState })), { code: "CONTEXT_BUDGET_EXCEEDED" });
  assert.equal(env.providerCalls.length, 1);
});

test("context includes tool continuation and refuses oversized remembered content before another model call", async (t) => {
  const env = setup(t, { recall(input) { return { revision: input.revision,
    results: input.query === "excess" ? [{ passage: "x".repeat(50000) }] : [], truncated: false }; },
  respond() { return tools([{ id: "recall", name: "recall_memory", arguments: '{"query":"excess"}' }]); } });
  await assert.rejects(env.generator.generateTurn(env.args()), { code: "CONTEXT_BUDGET_EXCEEDED" });
  assert.equal(env.providerCalls.length, 1);
});

test("output token truncation and malformed oversized replies are explicit budget failures", async (t) => {
  for (const response of [reply(refusedBundle(), { finishReason: "length" }), reply(refusedBundle(), { usage: { input_tokens: 2, output_tokens: 5000 } }), reply(null, { text: "x".repeat(33000), usage: {} })]) {
    const env = setup(t, { respond() { return response; } });
    await assert.rejects(env.generator.generateTurn(env.args()), { code: "OUTPUT_BUDGET_EXCEEDED" });
    assert.equal(env.providerCalls.length, 1);
  }
});

test("pre-cancelled requests make no model call and cancellation stops a Provider that ignores signal", async (t) => {
  const pre = setup(t);
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(pre.generator.generateTurn(pre.args({ signal: alreadyAborted.signal })), { code: "TURN_CANCELLED" });
  assert.equal(pre.providerCalls.length, 0);
  let entered;
  const called = new Promise((resolve) => { entered = resolve; });
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const env = setup(t, { respond() { entered(); return pending; } });
  const controller = new AbortController();
  const result = env.generator.generateTurn(env.args({ signal: controller.signal }));
  await called; controller.abort();
  await assert.rejects(result, { code: "TURN_CANCELLED" });
  assert.equal(env.generator.readUsage("attempt-one").usageComplete, false);
  finish(reply(borrowBundle()));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.providerCalls.length, 1);
  assert.equal(env.store.readView().revision, 0);
});

test("Provider and memory exceptions expose only stable application errors", async (t) => {
  const secret = "sk-private-key-and-https://private.example/credential";
  for (const options of [{ respond() { throw Object.assign(new Error(secret), { code: secret, meta: { secret } }); } },
    { recall() { throw new Error(secret); } }]) {
    const env = setup(t, options);
    await assert.rejects(env.generator.generateTurn(env.args()), (error) => {
      assert.ok(["TURN_GENERATION_FAILED", "MEMORY_SOURCE_UNAVAILABLE"].includes(error.code));
      assert.doesNotMatch(error.stack + JSON.stringify(error), /sk-private|private\.example/);
      return true;
    });
    assert.doesNotMatch(JSON.stringify(env.generator.readUsage("attempt-one")), /sk-private|private\.example/);
  }
});

test("structural repair feedback does not echo arbitrary model-created keys or exception text", async (t) => {
  const env = setup(t);
  await env.generator.generateTurn(env.args());
  await env.generator.generateTurn(env.args({ validationError: { code: "TURN_VALIDATION_FAILED",
    issues: ["bundle.sk-private-secret: unknown field", "private://credential: leaked error", "bundle.events[0].data.quantity: must be an integer from 1 to 1000000000"],
    cause: "sk-private-secret" } }));
  const feedback = env.providerCalls[1].messages.at(-1).content;
  assert.match(feedback, /bundle.field/);
  assert.doesNotMatch(feedback, /sk-private-secret|credential|leaked error/);
});

test("missing token usage remains incomplete rather than zero-priced or fabricated", async (t) => {
  const env = setup(t, { respond() { return reply(borrowBundle(), { usage: { input_tokens: 100, arbitrary_secret: "secret" } }); } });
  await env.generator.generateTurn(env.args());
  const { contextUsage, ...accounting } = env.generator.readUsage("attempt-one");
  assert.deepEqual(accounting, { modelCalls: 1, toolCalls: 0,
    usage: { input_tokens: 100 }, usageComplete: false });
  assert.equal(contextUsage.latestActual.outputTokens, null);
  env.generator.releaseAttempt("attempt-one");
  assert.equal(env.generator.readUsage("attempt-one"), null);
});

test("read-only context previews bind the formal revision and never create attempts or Provider calls", async (t) => {
  const env = setup(t);
  const before = fs.readFileSync(env.databasePath);
  const baseline = await env.generator.readContextUsage({ revision: 0 });
  assert.equal(baseline.adventureId, "test-adventure");
  assert.equal(baseline.actionId, null);
  assert.equal(baseline.revision, 0);
  assert.equal(baseline.scope, "next_request");
  assert.equal(baseline.includesPlayerInput, false);
  assert.equal(baseline.latestActual, null);
  assert.equal(baseline.compactionAvailable, false);
  assert.equal(baseline.settingsIdentity, normalizeSessionContextOptions().settingsIdentity);
  const withInput = await env.generator.readContextUsage({ revision: 0, input: request().input });
  assert.equal(withInput.includesPlayerInput, true);
  assert.ok(withInput.latestEstimate.bytes > baseline.latestEstimate.bytes);
  assert.equal(env.providerCalls.length, 0);
  assert.equal(env.store.readAction(request().actionId), null);
  assert.equal(env.generator.readUsage("attempt-one"), null);
  assert.deepEqual(fs.readFileSync(env.databasePath), before);
  await env.generator.generateTurn(env.args());
  assert.equal(env.generator.readUsage("attempt-one").contextUsage.latestEstimate.bytes, withInput.latestEstimate.bytes);
});

test("a smaller context setting previews the complete history without changing active defaults", async (t) => {
  const env = setup(t, { config: { contextPolicy: { configuredContextWindow: 128000 }, narrationPreferences: { lengthPreset: "short" } } });
  for (let index = 0; index < 6; index++) {
    const action = env.store.beginAction(request({ actionId: `recent-${index}`, baseRevision: index }));
    env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
      bundle: { narration: [{ id: "history", text: "h".repeat(3000) }], events: [], experiences: [] } });
  }
  const before = await env.generator.readContextUsage({ revision: 6 });
  const preview = await env.generator.readContextUsage({ revision: 6, contextPolicy: { configuredContextWindow: 16000 },
    narrationPreferences: { lengthPreset: "custom", customTargetChars: 700 } });
  assert.equal(preview.fits, false, "settings cannot discard older continuous history");
  assert.ok(preview.latestEstimate.bytes > 18000);
  assert.ok(Math.abs(preview.latestEstimate.bytes - before.latestEstimate.bytes) < 200);
  assert.notEqual(preview.settingsIdentity, before.settingsIdentity);
  assert.deepEqual(await env.generator.readContextUsage({ revision: 6 }), before);
  const blocked = await env.generator.readContextUsage({ revision: 6, contextPolicy: { configuredContextWindow: 6000 } });
  assert.equal(blocked.fits, false);
  assert.equal(blocked.limitingReason, "CONTEXT_CHARACTER_LIMIT");
  assert.ok(blocked.latestEstimate.inputTokens > 0);
  assert.equal(env.providerCalls.length, 0);
});

test("narration preference reaches generation without trimming its complete formal bundle", async (t) => {
  for (const [lengthPreset, targetCharacters] of [["short", 200], ["standard", 300], ["detailed", 400], ["adaptive", null], ["custom", 760]]) {
    const candidate = borrowBundle(); candidate.narration[0].text += "。正文保持完整".repeat(150);
    const env = setup(t, { config: { narrationPreferences: { lengthPreset, ...(lengthPreset === "custom" ? { customTargetChars: targetCharacters } : {}) } },
      respond: () => reply(candidate) });
    assert.deepEqual(await env.generator.generateTurn(env.args()), candidate);
    const systemPrompt = env.providerCalls[0].messages[0].content;
    if (lengthPreset === "adaptive") {
      assert.match(systemPrompt, /"lengthPreset":"adaptive"/);
      assert.match(systemPrompt, /never from the player's input length/);
      assert.match(systemPrompt, /never minimums or hard cutoffs/);
    } else {
      assert.ok(systemPrompt.includes(`"targetCharacters":${targetCharacters}`));
    }
    assert.equal(env.providerCalls.length, 1);
  }
});

test("single-request context and actual peaks remain separate from invocation token totals", async (t) => {
  const env = setup(t, { respond(_input, index) {
    return index === 1 ? tools([{ id: "read", name: "read_entity", arguments: '{"entityId":"npc"}' }],
      { usage: { input_tokens: 9000, output_tokens: 200, total_tokens: 9200 } })
      : reply(borrowBundle(), { usage: { input_tokens: 11000, output_tokens: 300, total_tokens: 11300 } });
  } });
  await env.generator.generateTurn(env.args());
  const result = env.generator.readUsage("attempt-one");
  assert.equal(result.usage.input_tokens, 20000);
  assert.equal(result.contextUsage.latestActual.inputTokens, 11000);
  assert.equal(result.contextUsage.latestActual.callIndex, 2);
  assert.equal(result.contextUsage.latestEstimate.callIndex, 2);
  assert.equal(result.contextUsage.peak.actualInputTokens, 11000);
  assert.equal(result.contextUsage.adventureId, "test-adventure");
  assert.equal(result.contextUsage.actionId, request().actionId);
  result.contextUsage.policy.effectiveContextWindow = 1;
  assert.notEqual(env.generator.readUsage("attempt-one").contextUsage.policy.effectiveContextWindow, 1);
});

test("an actual Provider input over the guarded window stops a subsequent tool continuation", async (t) => {
  const env = setup(t, { config: { contextPolicy: { configuredContextWindow: 64000 } }, respond() {
    return tools([{ id: "read", name: "read_entity", arguments: '{"entityId":"npc"}' }], { usage: { input_tokens: 60000, output_tokens: 100 } });
  } });
  assert.equal((await env.generator.readContextUsage({ revision: 0, input: request().input })).fits, true,
    "the initial estimate must fit so the measured Provider usage is the reason continuation stops");
  await assert.rejects(env.generator.generateTurn(env.args()), { code: "CONTEXT_BUDGET_EXCEEDED" });
  assert.equal(env.providerCalls.length, 1);
  const { contextUsage, usage } = env.generator.readUsage("attempt-one");
  assert.equal(contextUsage.fits, false);
  assert.equal(contextUsage.limitingReason, "CONTEXT_ACTUAL_INPUT_LIMIT");
  assert.equal(contextUsage.latestActual.inputTokens, 60000);
  assert.equal(usage.input_tokens, 60000);
});

test("blocked and cancelled requests retain their last safe estimates without inventing actual token reports", async (t) => {
  const blocked = setup(t, { config: { maxContextCharacters: 100 } });
  await assert.rejects(blocked.generator.generateTurn(blocked.args()), { code: "CONTEXT_BUDGET_EXCEEDED" });
  assert.equal(blocked.generator.readUsage("attempt-one").contextUsage.fits, false);
  assert.equal(blocked.generator.readUsage("attempt-one").contextUsage.latestActual, null);
  assert.equal(blocked.providerCalls.length, 0);
  let started; const called = new Promise((resolve) => { started = resolve; });
  const cancelled = setup(t, { respond() { started(); return new Promise(() => {}); } });
  const controller = new AbortController();
  const running = cancelled.generator.generateTurn(cancelled.args({ signal: controller.signal }));
  await called; controller.abort();
  await assert.rejects(running, { code: "TURN_CANCELLED" });
  const result = cancelled.generator.readUsage("attempt-one");
  assert.ok(result.contextUsage.latestEstimate.bytes > 0);
  assert.equal(result.contextUsage.latestActual, null);
  assert.equal(result.usageComplete, false);
});

test("preview inputs and nested configuration reject accessors without executing them", async (t) => {
  const env = setup(t); let reads = 0;
  const input = { revision: 0 }; Object.defineProperty(input, "input", { enumerable: true, get() { reads++; return "secret"; } });
  await assert.rejects(env.generator.readContextUsage(input), { code: "CONTEXT_INPUT_INVALID" });
  await assert.rejects(env.generator.readContextUsage({ revision: 0, provider: "fake" }), { code: "CONTEXT_INPUT_INVALID" });
  await assert.rejects(env.generator.readContextUsage({ revision: 0, contextPolicy: null }), { code: "CONTEXT_OPTIONS_INVALID" });
  await assert.rejects(env.generator.readContextUsage({ revision: 999 }), { code: "CONTEXT_SOURCE_UNAVAILABLE" });
  assert.equal(reads, 0);
  assert.equal(env.providerCalls.length, 0);
});

test("one attempt cannot be rebound to different input or a different state", async (t) => {
  const env = setup(t);
  await env.generator.generateTurn(env.args());
  await assert.rejects(env.generator.generateTurn(env.args({ request: request({ input: "不同输入" }) })), { code: "ACTION_INPUT_CONFLICT" });
  const changed = initialState(); changed.situation.day = 11;
  await assert.rejects(env.generator.generateTurn(env.args({ state: changed })), { code: "ACTION_INPUT_CONFLICT" });
  assert.equal(env.providerCalls.length, 1);
});

test("unavailable memory revision refuses generation and exhausted malformed JSON has a bounded failure", async (t) => {
  const wrong = setup(t, { recall() { return { revision: 99, results: [] }; } });
  await assert.rejects(wrong.generator.generateTurn(wrong.args()), { code: "MEMORY_SOURCE_UNAVAILABLE" });
  assert.equal(wrong.providerCalls.length, 0);
  const malformed = setup(t, { config: { maxModelCalls: 2 }, respond() { return reply(null, { text: "{broken" }); } });
  await assert.rejects(malformed.generator.generateTurn(malformed.args()), { code: "TURN_OUTPUT_INVALID" });
  assert.equal(malformed.providerCalls.length, 2);
});

function continuousHistory(store, revision, overrides = {}) {
  const snapshot = store.readPlayerState({ revision });
  const page = store.readHistory({ revision, limit: 100, maxCharacters: 2000000 });
  assert.equal(page.complete, true);
  return { adventureId: snapshot.adventureId, revision, viewerId: snapshot.state.situation.playerId,
    contextGeneration: 0, materializationId: "a".repeat(64), sourceHash: "b".repeat(64),
    summary: null, summaryValidity: "none", turns: page.history, timeline: page.timeline,
    continuation: snapshot.continuation, ...overrides };
}

function commitHistory(store, count = 8, text = (revision) => `第${revision}轮：` + "连续发生的事情。".repeat(100)) {
  for (let revision = 1; revision <= count; revision++) {
    const action = store.beginAction(request({ actionId: `continuous-${revision}`, baseRevision: revision - 1, input: `选择 ${revision}` }));
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
      bundle: { narration: [{ id: "paragraph", text: text(revision) }], events: [], experiences: [] } });
  }
}

test("the continuous reader includes the full fixed-revision history and never evicts it to fit new settings", async (t) => {
  const env = setup(t, { config: { contextPolicy: { configuredContextWindow: 128000 } } });
  assert.equal(typeof env.store.readContextHistory, "function");
  commitHistory(env.store, 9, (revision) => `原始轮次 ${revision}：` + "n".repeat(3500));
  const input = request({ baseRevision: 8, actionId: "read-eight" });
  await env.generator.generateTurn(env.args({ request: input, state: env.store.readModelState({ revision: 8 }) }));
  const data = JSON.parse(env.providerCalls[0].messages[3].content.split("\n").slice(1).join("\n"));
  assert.deepEqual(data.turns.map((turn) => turn.revision), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(data.turns[0].narration[0].text, "原始轮次 1：" + "n".repeat(3500));
  assert.equal(data.coverage.omittedBeforeRevision, null);
  const smaller = await env.generator.readContextUsage({ revision: 8, contextPolicy: { configuredContextWindow: 16000 } });
  assert.equal(smaller.fits, false);
  assert.ok(smaller.latestEstimate.bytes > 28000, "all eight complete turns remain in the preview");
  assert.equal(env.providerCalls.length, 1);
  assert.equal(env.generator.readUsage("attempt-one").contextUsage.materializationId,
    env.store.readContextHistory({ revision: 8 }).materializationId);
});

test("a same-input compaction preview is read-only and the committed summary replaces exactly the planned prefix", async (t) => {
  const { createCompactionQuotes } = require("./session-compaction-quotes");
  let selected = null;
  let generation = 0;
  const env = setup(t, { config: { contextPolicy: { configuredContextWindow: 128000 }, compactionAvailable: true },
    contextHistory(store, args) {
      const source = continuousHistory(store, args.revision);
      return { ...source, contextGeneration: generation, materializationId: String(generation + 1).repeat(64),
        summary: selected, summaryValidity: selected ? "valid" : "none",
        turns: source.turns.filter((turn) => turn.revision > (selected?.throughRevision ?? 0)) };
    }, recall(input) { return { revision: input.revision, results: [{ originalPassage: "旧时红绳放在凳子上。" }], truncated: false }; } });
  commitHistory(env.store, 8, (revision) => (revision === 1 ? "旧时红绳放在凳子上。" : `往事 ${revision}。`) + "连续事件。".repeat(150));
  const options = { revision: 8, input: "回到院子，看看上次留下的东西。" };
  const beforeFile = fs.readFileSync(env.databasePath);
  const before = await env.generator.readContextUsage(options);
  const plan = await env.generator.readCompactionPlan(options);
  assert.deepEqual(plan.before, before);
  assert.equal(plan.sourceHash, "b".repeat(64));
  assert.equal(plan.status, "ready");
  assert.equal(plan.range.throughRevision, 6);
  assert.deepEqual(plan.retainedTurnRevisions, [7, 8]);
  const source = env.store.readTurn(2).narration[0];
  const summary = { summaryId: "compact-request", fromRevision: 1, throughRevision: 6, format: COMPACTION_QUOTE_FORMAT,
    items: createCompactionQuotes({ adventureId: "test-adventure", revision: 2, segmentId: source.id, text: source.text }) };
  const preview = await env.generator.previewCompaction({ ...options, planId: plan.planId, summary });
  assert.equal(preview.status, "reduced");
  assert.ok(preview.savedSafetyInputTokens > 0);
  assert.deepEqual(fs.readFileSync(env.databasePath), beforeFile);
  assert.equal(env.providerCalls.length, 0);
  assert.equal(env.generator.readUsage("attempt-one"), null);
  selected = summary; generation++;
  const after = await env.generator.readContextUsage(options);
  assert.equal(after.latestEstimate.bytes, preview.after.latestEstimate.bytes);
  assert.equal(after.contextGeneration, 1);
  assert.notEqual(after.materializationId, before.materializationId);
  assert.equal((await env.generator.readCompactionPlan(options)).status, "not_needed");
  await assert.rejects(env.generator.previewCompaction({ ...options, planId: plan.planId, summary }), { code: "CONTEXT_PLAN_STALE" });
  await env.generator.generateTurn(env.args({ request: request({ baseRevision: 8, input: options.input }), state: env.store.readModelState({ revision: 8 }) }));
  const messages = env.providerCalls[0].messages;
  const history = JSON.parse(messages[3].content.split("\n").slice(1).join("\n"));
  assert.deepEqual(history.turns.map((turn) => turn.revision), [7, 8]);
  assert.equal(history.summary.summaryId, "compact-request");
  assert.doesNotMatch(messages[3].content, /红绳|凳子/);
  assert.match(messages[2].content, /红绳.*凳子/);
  assert.equal(env.generator.readUsage("attempt-one").contextUsage.contextGeneration, 1);
});

test("automatic recall follows actual history coverage across compaction while explicit recall keeps its sources", async (t) => {
  const { createCompactionQuotes } = require("./session-compaction-quotes");
  let selected = null, memory, changedAttribution = false;
  const rawRecalls = [];
  const env = setup(t, { config: { contextPolicy: { configuredContextWindow: 128000 }, compactionAvailable: true },
    contextHistory(store, { revision }) {
      const history = store.readContextHistory({ revision });
      return { ...history, summary: selected, summaryValidity: selected ? "valid" : "none",
        turns: history.turns.filter((turn) => turn.revision > (selected?.throughRevision ?? 0)) };
    }, recall(input) {
      const result = memory.recall(input);
      if (changedAttribution) result.results[0].experience.kind = "belief";
      rawRecalls.push(structuredClone(result));
      return result;
    }, respond(_input, call) {
      return call === 1 ? tools([{ id: "source-reader", name: "recall_memory", arguments: JSON.stringify({ query: "陈姨", entityIds: ["npc"] }) }])
        : reply(refusedBundle());
    } });
  for (let revision = 1; revision <= 4; revision++) {
    const action = env.store.beginAction(request({ actionId: `coverage-${revision}`, baseRevision: revision - 1,
      input: `第${revision}次问陈姨：` + "我只是问过去，不把这个说法当作确认。".repeat(12) }));
    env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: {
      narration: [{ id: "account", text: `陈姨第${revision}次说：` + '时间还不能确定。门上写着"等候"。\\\n'.repeat(24) }], events: [],
      experiences: [{ id: `account-${revision}`, entityIds: ["p", "npc"], eventIds: [], sourceSegmentIds: ["account"], kind: "claim", knownBy: ["p", "npc"] }],
    } });
  }
  memory = createTurnMemory({ store: env.store });
  const options = { revision: 4, input: "我想想陈姨之前是怎么说的。" };
  const beforeFile = fs.readFileSync(env.databasePath);
  const before = await env.generator.readContextUsage(options);
  const plan = await env.generator.readCompactionPlan(options);
  await env.generator.generateTurn(env.args({ request: request({ baseRevision: 4, input: options.input }), state: env.store.readModelState({ revision: 4 }) }));
  const sent = env.providerCalls[0], automatic = JSON.parse(sent.messages[2].content.split("\n").slice(1).join("\n"));
  const full = rawRecalls[0];
  assert.equal(automatic.results.length, 4);
  assert.equal(countSessionContext(sent).bytes, before.latestEstimate.bytes);
  assert.equal(plan.before.latestEstimate.bytes, before.latestEstimate.bytes);
  for (const record of automatic.results) {
    assert.equal(Object.hasOwn(record.passages[0], "text"), false);
    assert.equal(Object.hasOwn(record.playerInput, "text"), false);
    assert.equal(record.passages[0].historyRef, true);
    assert.deepEqual(record.experience, full.results.find((source) => source.source.revision === record.source.revision).experience);
  }
  const explicit = JSON.parse(env.providerCalls[1].messages.find((message) => message.role === "tool").content);
  assert.deepEqual(explicit, full, "explicit recall retains exact source text even when the history already includes it");
  const unprojected = structuredClone(sent);
  unprojected.messages[2].content = sent.messages[2].content.split("\n")[0] + "\n" + JSON.stringify(full);
  assert.ok(countSessionContext(unprojected).bytes > before.latestEstimate.bytes + 2000);

  const baseline = structuredClone(sent);
  const history = JSON.parse(sent.messages[3].content.split("\n").slice(1).join("\n"));
  history.turns = history.turns.slice(-2);
  history.coverage.fromRevision = history.coverage.omittedBeforeRevision = 3;
  baseline.messages[3].content = sent.messages[3].content.split("\n")[0] + "\n" + JSON.stringify(history);
  const baselineRelated = structuredClone(automatic);
  baselineRelated.results = baselineRelated.results.map((record) => record.source.revision <= 2
    ? full.results.find((source) => source.source.revision === record.source.revision) : record);
  baseline.messages[2].content = sent.messages[2].content.split("\n")[0] + "\n" + JSON.stringify(baselineRelated);
  assert.equal(plan.baseline.latestEstimate.bytes, countSessionContext(baseline).bytes,
    "dropping the old prefix must also restore its automatic recall sources before estimating");

  const passage = env.store.readTurn(2).narration[0];
  const summary = { summaryId: "coverage-summary", fromRevision: 1, throughRevision: 2, format: COMPACTION_QUOTE_FORMAT,
    items: createCompactionQuotes({ adventureId: "test-adventure", revision: 2, segmentId: passage.id, text: passage.text }) };
  const preview = await env.generator.previewCompaction({ ...options, planId: plan.planId, summary });
  changedAttribution = true;
  await assert.rejects(env.generator.previewCompaction({ ...options, planId: plan.planId, summary }), { code: "CONTEXT_PLAN_STALE" });
  changedAttribution = false;
  selected = summary;
  const after = await env.generator.readContextUsage(options);
  assert.equal(after.latestEstimate.bytes, preview.after.latestEstimate.bytes);
  await env.generator.generateTurn(env.args({ attemptId: "covered-after-compaction", request: request({ actionId: "covered-after", baseRevision: 4, input: options.input }), state: env.store.readModelState({ revision: 4 }) }));
  const compactedRequest = env.providerCalls[2];
  const compacted = JSON.parse(compactedRequest.messages[2].content.split("\n").slice(1).join("\n"));
  assert.equal(countSessionContext(compactedRequest).bytes, after.latestEstimate.bytes);
  assert.deepEqual(compacted.results.find((record) => record.source.revision === 1), full.results.find((record) => record.source.revision === 1));
  assert.ok(compacted.results.find((record) => record.source.revision === 2).passages[0].historyRef,
    "complete retained quotes can cover the source while its removed player input is restored");
  assert.equal(compacted.results.find((record) => record.source.revision === 2).playerInput.text,
    full.results.find((record) => record.source.revision === 2).playerInput.text);
  assert.deepEqual(fs.readFileSync(env.databasePath), beforeFile);
});

test("a baseline too large cannot be repaired by dropping the protected last two turns or actual facts", async (t) => {
  const env = setup(t, { config: { contextPolicy: { configuredContextWindow: 64000 }, compactionAvailable: true },
    contextHistory: (store, args) => continuousHistory(store, args.revision) });
  commitHistory(env.store, 4, (revision) => revision > 2 ? "不可丢的最近正文。".repeat(2500) : "早先发生的小事。");
  const plan = await env.generator.readCompactionPlan({ revision: 4 });
  assert.equal(plan.status, "baseline_too_large");
  assert.equal(plan.baseline.fits, false);
  assert.deepEqual(plan.retainedTurnRevisions, [3, 4]);
  assert.equal(env.providerCalls.length, 0);
  assert.equal(env.store.readView().revision, 4);
});

test("invalidated summaries, history hard limits and compaction capability are explicit", async (t) => {
  let unavailable = false;
  const env = setup(t, { contextHistory(store, args) {
    if (unavailable) throw Object.assign(new Error("bounded source"), { code: "CONTEXT_HISTORY_TOO_LARGE" });
    return continuousHistory(store, args.revision, { summaryValidity: "invalidated", contextGeneration: 2, materializationId: "c".repeat(64) });
  } });
  commitHistory(env.store, 3, () => "当前纠正已经公开：旧说法是误认。");
  const usage = await env.generator.readContextUsage({ revision: 3 });
  assert.equal(usage.contextGeneration, 2);
  assert.equal(usage.compactionAvailable, false, "a reader alone does not promise the service and UI capability");
  const plan = await env.generator.readCompactionPlan({ revision: 3 });
  assert.equal(plan.previousSummary, null);
  assert.deepEqual(plan.turns.map((turn) => turn.revision), [1]);
  unavailable = true;
  const restored = await env.generator.readContextUsage({ revision: 3 });
  assert.equal(restored.revision, 3);
  assert.equal(restored.contextGeneration, 0, "bounded preview reads the actual store manifest");
  assert.equal(restored.compactionAvailable, false);
  assert.equal((await env.generator.readCompactionPlan({ revision: 3 })).streamed, true);
  await assert.rejects(env.generator.generateTurn(env.args({ request: request({ baseRevision: 3 }), state: env.store.readModelState({ revision: 3 }) })), { code: "CONTEXT_HISTORY_TOO_LARGE" });
  assert.equal(env.providerCalls.length, 0);
});

const FRAGMENT_SOURCE = "LOCKED_FRAGMENT_SOURCE：记忆碎片只是尚未证实的感官片段，不是完整身世。旧流程曾要求 record_memory_fragment；只保留叙事意图。";
function loadFragmentGuide(id = "load-fragment-guide") {
  return { id, name: "read_narrative_module", arguments: '{"module":"memory_fragments"}' };
}
function fragmentBundle(index, { mode = index % 2 ? "active_recall" : "passive_association", day, content } = {}) {
  const sensory = content ?? `第${index}道微光在湿冷的指尖闪过。耳边响起陌生的短促节奏，余下的画面仍然模糊。`;
  return { narration: [{ id: "ordinary", text: "你站在楼道窗边，留意眼前的动静。" }, { id: "sensory", text: sensory }],
    events: [...(day === undefined ? [] : [{ id: "day", type: "situation.update", sourceSegmentIds: ["ordinary"], data: { day } }]),
      { id: "fragment", type: "memory_fragment.record", sourceSegmentIds: ["sensory"],
        data: { discoveryMode: mode, dimension: ["body", "emotion", "skill", "identity"][(index - 1) % 4], trigger: `第${index}件不同的触发物`, content: sensory } }], experiences: [] };
}
function commitFragmentFixture(store, bundle, input = "我留意这个自然浮现的感官片段。") {
  const revision = store.readPlayerState().revision;
  const action = store.beginAction(request({ actionId: `fragment-seed-${revision + 1}`, baseRevision: revision, input }));
  return store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
}
function seedFragments(store, count) {
  for (let index = 1; index <= count; index++) {
    commitFragmentFixture(store, fragmentBundle(index, { day: 10 + Math.floor((index - 1) / 2) }));
  }
}
function currentGeneratorArgs(env, input = "我想回顾这些尚未证实的片段。") {
  const revision = env.store.readPlayerState().revision;
  return env.args({ state: env.store.readModelState({ revision }), request: request({ baseRevision: revision, input }) });
}

test("an unloaded fragment candidate cannot commit by dropping its event while retaining the same passage", async (t) => {
  const candidate = fragmentBundle(1);
  const ordinary = { narration: candidate.narration.slice(0, 1), events: [], experiences: [] };
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE },
    respond(_input, call) { return reply(call === 1 ? candidate : call === 2 ? { ...candidate, events: [] } : ordinary); } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "committed");
  assert.deepEqual(result.view.narration, ordinary.narration);
  assert.equal(env.providerCalls.length, 3);
  assert.match(env.providerCalls[1].messages.at(-1).content, /guide has not been loaded in this attempt/);
  assert.match(env.providerCalls[2].messages.at(-1).content, /kept an unchanged passage/);
  assert.equal(env.store.readMemoryFragments({ revision: 1 }).progress.count, 0);
  assert.deepEqual(env.store.readTurn(1).events, []);
});

test("an unloaded candidate may load the guide then resubmit its complete sourced fragment in the same attempt", async (t) => {
  const candidate = fragmentBundle(1);
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE },
    respond(_input, call) { return call === 2 ? tools([loadFragmentGuide()]) : reply(candidate); } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "committed"); assert.equal(result.view.revision, 1);
  assert.deepEqual(env.store.readTurn(1).narration, candidate.narration);
  assert.deepEqual(env.store.readTurn(1).events, candidate.events);
  assert.equal(env.providerCalls.length, 3);
  assert.equal(env.generator.readUsage(result.attemptId).toolCalls, 1);
  assert.equal(env.store.readMemoryFragments({ revision: 1 }).progress.count, 1);
});

test("invalid module arguments never unlock fragment writing", async (t) => {
  const invalid = [{}, { module: "other" }, { module: "memory_fragments", revision: 0 }, { module: ["memory_fragments"] }];
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE, maxModelCalls: 3 },
    respond(input, call) {
      if (call === 1) return tools(invalid.map((args, index) => ({ id: `bad-module-${index}`, name: "read_narrative_module", arguments: JSON.stringify(args) })));
      if (call === 2) {
        const results = input.messages.filter(message => message.role === "tool").map(message => JSON.parse(message.content));
        assert.equal(results.length, invalid.length);
        for (const result of results) assertToolFailure(result, "TOOL_ARGUMENTS_INVALID");
        return reply(fragmentBundle(1));
      }
      assert.match(input.messages.at(-1).content, /guide has not been loaded in this attempt/);
      return reply(refusedBundle());
    } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "committed"); assert.deepEqual(result.view.narration, refusedBundle().narration);
  assert.equal(env.providerCalls.length, 3);
  assert.equal(env.store.readMemoryFragments({ revision: 1 }).progress.count, 0);
  assert.doesNotMatch(JSON.stringify(env.providerCalls), /LOCKED_FRAGMENT_SOURCE/);
});

test("locked fragments initially expose only a module catalog and progress, and read-only restoration never loads the guide", async (t) => {
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE } });
  assert.equal(env.store.readModelState().memoryFragments, undefined, "the selected old save needs no invented preexisting fragments");
  const before = env.store.readView();
  await env.generator.readContextUsage({ revision: 0 });
  await env.generator.readCompactionPlan({ revision: 0 });
  assert.equal(env.providerCalls.length, 0);
  assert.equal(env.generator.readUsage("attempt-one"), null);
  assert.deepEqual(env.store.readView(), before);
  await env.generator.generateTurn(env.args());
  const sent = env.providerCalls[0];
  assert.deepEqual(sent.tools.map((tool) => tool.function.name), ["recall_memory", "read_entity", "read_narrative_module", "read_memory_fragments"]);
  assert.doesNotMatch(sent.messages[0].content, /memory_fragment\.record data|Every fragment remains uncertain|30th fragment unlocks a later choice/);
  assert.doesNotMatch(JSON.stringify(sent), /LOCKED_FRAGMENT_SOURCE/);
  const fixed = JSON.parse(sent.messages[1].content);
  assert.equal(fixed.quotedNarrativeSources.memoryFragmentText, undefined);
  assert.equal(fixed.canonicalState.memoryFragments, undefined);
  assert.deepEqual(fixed.memoryFragments, { count: 0, maxCount: 30, phase: "collecting", choice: null,
    dimensions: { body: 0, emotion: 0, skill: 0, identity: 0 }, today: { day: 10, activeRecallRemaining: 1, passiveAssociationRemaining: 1 } });
  assert.equal(env.store.readPlayerState().revision, 0);
});

test("disabled fragments emit no module prompt, source, tool or fixed module state, and old writers stay unavailable", async (t) => {
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, respond(_input, call) {
    if (call === 1) return tools([
      { id: "new-reader", name: "read_memory_fragments", arguments: "{}" },
      { id: "old-writer", name: "record_memory_fragment", arguments: "{}" },
      loadFragmentGuide(),
    ]);
    return reply(refusedBundle());
  } });
  seedFragments(env.store, 1);
  await env.generator.generateTurn(currentGeneratorArgs(env));
  const sent = env.providerCalls[0]; const fixed = JSON.parse(sent.messages[1].content);
  assert.doesNotMatch(sent.messages[0].content, /memory.fragment|read_memory_fragments|memoryFragments/i);
  assert.equal(fixed.memoryFragments, undefined); assert.equal(fixed.canonicalState.memoryFragments, undefined);
  assert.equal(fixed.quotedNarrativeSources.memoryFragmentText, undefined);
  assert.deepEqual(sent.tools.map((tool) => tool.function.name), ["recall_memory", "read_entity"]);
  const deniedTools = env.providerCalls[1].messages.filter(message => message.role === "tool");
  assert.equal(deniedTools.length, 3);
  for (const message of deniedTools) assertToolFailure(JSON.parse(message.content), "TOOL_NOT_AVAILABLE");
  assert.equal(env.store.readModelState().memoryFragments.fragments.length, 1);
});

test("creating and confirming the opening expose no fragment capability, and repair removes only the invalid module passage", async (t) => {
  for (const confirming of [false, true]) await t.test(confirming ? "confirmation turn" : "creation turn", async (subtest) => {
    let normal;
    const env = setup(subtest, { initialState: createOpeningState(), storeOptions: { memoryFragmentsEnabled: true },
      config: { memoryFragmentText: FRAGMENT_SOURCE, maxModelCalls: 3 }, respond(_input, call) {
        if (call === 1) return reply({ narration: [...normal.narration, ...fragmentBundle(1).narration.slice(1)],
          events: [...normal.events, fragmentBundle(1).events[0]], experiences: [] });
        if (call === 2) return reply({ ...normal, narration: [...normal.narration, ...fragmentBundle(1).narration.slice(1)] });
        return reply(normal);
      } });
    if (confirming) {
      commitFragmentFixture(env.store, { narration: [{ id: "proposal", text: "你是楼道中的林安，保留了一个承诺。确认这个身份和起点吗？" }],
        events: [{ id: "propose", type: "opening.propose", sourceSegmentIds: ["proposal"], data: { proposalId: "role", initialState: initialState() } }], experiences: [] });
      normal = { narration: [{ id: "scene", text: "你睁开眼，窗外的晨光照进熟悉的楼道。" }],
        events: [{ id: "confirm", type: "opening.confirm", sourceSegmentIds: ["scene"], data: { proposalId: "role" } }], experiences: [] };
    } else normal = { narration: [{ id: "question", text: "在故事开始前，你希望别人怎样称呼你？" }], events: [], experiences: [] };
    const before = env.store.readPlayerState().revision;
    const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
    const result = await coordinator.runAction(request({ baseRevision: before, input: confirming ? "我确认这个身份和起点，开始吧。" : "我想开始这段故事。" }));
    assert.equal(result.status, "committed"); assert.equal(env.providerCalls.length, 3);
    for (const input of env.providerCalls) {
      assert.deepEqual(input.tools, []);
      const fixed = JSON.parse(input.messages[1].content);
      assert.equal(fixed.memoryFragments, undefined); assert.equal(fixed.quotedNarrativeSources.memoryFragmentText, undefined);
      assert.equal(fixed.canonicalState.memoryFragments, undefined);
    }
    assert.deepEqual(result.view.narration, normal.narration);
    assert.equal(env.store.readModelState().memoryFragments, undefined);
    assert.equal(env.store.readMemoryFragments({ revision: before + 1 }).progress.count, 0);
    assert.equal(env.recalls.length, 0);
  });
});

test("one ordinary fragment passage, progress and engine provenance commit together", async (t) => {
  const candidate = fragmentBundle(1);
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE }, respond(input, call) {
    if (call === 1) return tools([loadFragmentGuide()]);
    const loaded = JSON.parse(input.messages.at(-1).content);
    assert.deepEqual(Object.keys(loaded).sort(), ["instructions", "module", "quotedNarrativeSources", "revision"]);
    assert.equal(loaded.module, "memory_fragments"); assert.equal(loaded.revision, 0);
    assert.match(loaded.instructions, /memory_fragment\.record data/);
    assert.equal(loaded.quotedNarrativeSources.memoryFragmentText, FRAGMENT_SOURCE);
    return reply(candidate);
  } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request({ input: "我试着回忆这个声响曾在何处出现。" }));
  assert.equal(result.status, "committed");
  assert.deepEqual(result.view.narration, candidate.narration);
  const fragment = env.store.readMemoryFragments({ revision: 1 }).fragments[0];
  assert.equal(fragment.content, candidate.narration[1].text); assert.equal(fragment.certainty, "uncertain");
  assert.deepEqual(fragment.source, { adventureId: "test-adventure", revision: 1, eventId: "fragment", sourceSegmentIds: ["sensory"] });
  const before = await env.generator.readContextUsage({ revision: 1 });
  assert.equal(before.revision, 1); assert.equal(env.providerCalls.length, 2, "preview does not generate another fragment");
  await coordinator.runAction(request({ input: "我试着回忆这个声响曾在何处出现。" }));
  assert.equal(env.providerCalls.length, 2, "recovering the committed receipt neither reloads the guide nor repeats the story");
  const reopened = createTurnStore({ ...identity(env.databasePath), memoryFragmentsEnabled: true });
  t.after(() => reopened.close());
  const restored = createTurnGenerator({ store: reopened, memory: createTurnMemory({ store: reopened }), adventureId: "test-adventure",
    memoryFragmentText: FRAGMENT_SOURCE, provider: { generate() { assert.fail("read-only restore called the Provider"); } } });
  await restored.readContextUsage({ revision: 1 });
  assert.deepEqual(reopened.readMemoryFragments({ revision: 1 }).fragments, [fragment]);
  assert.equal(restored.readUsage(result.attemptId), null);
});

test("loading the guide and reading thirty fragments through three pages permits one resolution within four model calls", async (t) => {
  const all = [];
  const resolved = { narration: [{ id: "choice", text: "你暂不为这些片段下结论，让选择保持开放。" }],
    events: [{ id: "resolve", type: "memory_fragment.resolve", sourceSegmentIds: ["choice"], data: { choice: "deferred" } }], experiences: [] };
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE, contextPolicy: { configuredContextWindow: 128000 } },
    respond(input, call) {
      if (call > 1) {
        const page = JSON.parse(input.messages.at(-1).content);
        assert.equal(page.revision, 30); assert.equal(page.adventureId, "test-adventure");
        all.push(...page.fragments);
        if (page.nextCursor) return tools([{ id: `fragment-page-${call}`, name: "read_memory_fragments", arguments: JSON.stringify({ cursor: page.nextCursor }) }]);
        assert.equal(page.complete, true); return reply(resolved);
      }
      return tools([loadFragmentGuide(), { id: "fragment-page-1", name: "read_memory_fragments", arguments: "{}" }]);
    } });
  seedFragments(env.store, 30);
  const canonical = env.store.readModelState();
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request({ baseRevision: 30, input: "回顾这些片段后，我还是暂缓决定。" }));
  assert.equal(result.status, "committed"); assert.equal(result.view.revision, 31);
  assert.deepEqual(result.view.narration, resolved.narration);
  assert.deepEqual(env.store.readTurn(31).events, resolved.events);
  assert.deepEqual(all, canonical.memoryFragments.fragments);
  assert.equal(new Set(all.map((fragment) => fragment.id)).size, 30);
  const fixed = JSON.parse(env.providerCalls[0].messages[1].content);
  assert.deepEqual(fixed.memoryFragments, { count: 30, maxCount: 30, phase: "available", choice: null,
    dimensions: { body: 8, emotion: 8, skill: 7, identity: 7 }, today: { day: 24, activeRecallRemaining: 0, passiveAssociationRemaining: 0 } });
  assert.equal(fixed.canonicalState.memoryFragments, undefined);
  assert.doesNotMatch(JSON.stringify(fixed), /第1道微光|第30道微光|第30件不同的触发物/);
  const contextUsage = env.generator.readUsage(result.attemptId).contextUsage;
  assert.equal(contextUsage.fits, true);
  assert.ok(env.providerCalls.every(sent => countSessionContext(sent).bytes <= contextUsage.policy.hardInputLimit));
  assert.equal(env.providerCalls.length, 4); assert.equal(env.generator.readUsage(result.attemptId).toolCalls, 4);
  assert.equal(env.store.readModelState({ revision: 30 }).memoryFragments.revelationStatus, "available");
  assert.equal(env.store.readModelState().memoryFragments.revelationStatus, "deferred");
  assert.deepEqual(env.store.readModelState().memoryFragments.fragments, canonical.memoryFragments.fragments);
});

test("fragment pagination rejects arbitrary viewer/revision changes and forged cursors before calling the reader", async (t) => {
  let reads = 0;
  const bad = [{ revision: 99 }, { viewerId: "secret" }, { limit: 11 },
    { cursor: { adventureId: "other", revision: 2, afterIndex: 1 } },
    { cursor: { adventureId: "test-adventure", revision: 1, afterIndex: 1 } },
    { cursor: { adventureId: "test-adventure", revision: 2, afterIndex: 2 } },
    { cursor: { adventureId: "test-adventure", revision: 2, afterIndex: 0 } }];
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE },
    fragmentPage(store, args) { reads++; return store.readMemoryFragments(args); }, respond(_input, call) {
      return call === 1 ? tools([...bad.map((args, index) => ({ id: `bad-${index}`, name: "read_memory_fragments", arguments: JSON.stringify(args) })),
        { id: "old-resolver", name: "resolve_memory_fragment", arguments: '{"choice":"accepted"}' }]) : reply(refusedBundle());
    } });
  seedFragments(env.store, 2);
  await env.generator.generateTurn(currentGeneratorArgs(env));
  const outputs = env.providerCalls[1].messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
  assert.deepEqual(outputs.map((output) => output.error.code), [...bad.map(() => "TOOL_ARGUMENTS_INVALID"), "TOOL_NOT_AVAILABLE"]);
  assert.equal(reads, 0); assert.equal(env.store.readPlayerState().revision, 2);
});

test("a guessed fragment cursor can be repaired to the first page without losing its only record", async (t) => {
  let reads = 0;
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE },
    fragmentPage(store, args) { reads++; return store.readMemoryFragments(args); }, respond(input, call) {
      if (call === 1) return tools([{ id: "guessed-page", name: "read_memory_fragments",
        arguments: '{"cursor":{"adventureId":"test-adventure","revision":1,"afterIndex":1},"limit":10}' }]);
      if (call === 2) {
        assertToolFailure(JSON.parse(input.messages.at(-1).content), "TOOL_ARGUMENTS_INVALID");
        assert.equal(reads, 0);
        assert.match(input.tools.find((tool) => tool.function.name === "read_memory_fragments").function.description, /OMIT cursor for the first page/);
        return tools([{ id: "first-page", name: "read_memory_fragments", arguments: "{}" }]);
      }
      const page = JSON.parse(input.messages.at(-1).content);
      assert.equal(page.fragments.length, 1);
      assert.equal(page.fragments[0].source.revision, 1);
      assert.equal(page.complete, true); assert.equal(page.nextCursor, null);
      return reply(refusedBundle());
    } });
  seedFragments(env.store, 1);
  assert.deepEqual(await env.generator.generateTurn(currentGeneratorArgs(env)), refusedBundle());
  assert.equal(reads, 1); assert.equal(env.providerCalls.length, 3);
  assert.equal(env.store.readPlayerState().revision, 1);
  assert.doesNotMatch(JSON.stringify(env.providerCalls), /LOCKED_FRAGMENT_SOURCE/,
    "existing fragment pages are readable without loading the writing guide");
});

test("a mismatched fragment reader result never reaches the model or changes progression", async (t) => {
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE },
    fragmentPage(store, args) { return { ...store.readMemoryFragments(args), adventureId: "other", privateExtra: "DO_NOT_FORWARD" }; },
    respond: () => tools([{ id: "read", name: "read_memory_fragments", arguments: "{}" }]) });
  seedFragments(env.store, 1);
  await assert.rejects(env.generator.generateTurn(currentGeneratorArgs(env)), { code: "MEMORY_SOURCE_UNAVAILABLE" });
  assert.equal(env.providerCalls.length, 1); assert.doesNotMatch(JSON.stringify(env.providerCalls), /DO_NOT_FORWARD/);
  assert.equal(env.store.readModelState().memoryFragments.fragments.length, 1);
});

test("quota repair cannot retain an unchanged unrecorded fragment passage, but unrelated normal prose can still commit", async (t) => {
  const invalid = fragmentBundle(2, { mode: "active_recall" });
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE },
    respond(_input, call) {
      if (call === 1) return tools([loadFragmentGuide()]);
      if (call === 2) return reply(invalid);
      if (call === 3) return reply({ ...invalid, events: [] });
      return reply({ narration: invalid.narration.slice(0, 1), events: [], experiences: [] });
    } });
  seedFragments(env.store, 1);
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request({ baseRevision: 1, input: "我再次试着回忆，随后看看窗外。" }));
  assert.equal(result.status, "committed"); assert.equal(env.providerCalls.length, 4);
  assert.deepEqual(result.view.narration, invalid.narration.slice(0, 1));
  assert.equal(env.store.readModelState().memoryFragments.fragments.length, 1);
  assert.match(env.providerCalls[2].messages.at(-1).content, /Structural feedback/);
  assert.match(env.providerCalls[3].messages.at(-1).content, /kept an unchanged passage/);
  assert.equal(env.generator.readUsage(result.attemptId).toolCalls, 1);
});

test("an exhausted fragment repair budget fails the entire turn without lost progress or partial prose", async (t) => {
  const invalid = fragmentBundle(2, { mode: "active_recall" });
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE, maxModelCalls: 2 },
    respond(_input, call) { return call === 1 ? tools([loadFragmentGuide()]) : reply(invalid); } });
  seedFragments(env.store, 1); const before = env.store.readView();
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request({ baseRevision: 1 }));
  assert.equal(result.status, "failed"); assert.equal(result.error.code, "MODEL_CALL_BUDGET_EXCEEDED");
  assert.equal(env.providerCalls.length, 2); assert.deepEqual(env.store.readView(), before);
});

test("repair may keep its sensory passage when the corrected event validly records it with the same story commit", async (t) => {
  const candidate = fragmentBundle(2, { mode: "active_recall" });
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE },
    respond(_input, call) {
      if (call === 1) return tools([loadFragmentGuide()]);
      if (call === 2) return reply(null, { text: "{malformed" });
      const bundle = structuredClone(candidate);
      if (call === 4) bundle.events[0].data.discoveryMode = "passive_association";
      return reply(bundle);
    } });
  seedFragments(env.store, 1);
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request({ baseRevision: 1, input: "窗外的气味让某个画面自行浮现。" }));
  assert.equal(result.status, "committed"); assert.equal(env.providerCalls.length, 4);
  assert.equal(env.generator.readUsage(result.attemptId).toolCalls, 1, "JSON and quota repairs both reuse the successful load in this attempt");
  assert.deepEqual(result.view.narration, candidate.narration);
  const page = env.store.readMemoryFragments({ revision: 2 });
  assert.equal(page.progress.count, 2); assert.equal(page.fragments[1].content, candidate.narration[1].text);
});

test("fragment tools and compact module state share the complete request estimate before and after a real compaction", async (t) => {
  const { createCompactionQuotes } = require("./session-compaction-quotes");
  const { countContextText } = require("./session-context");
  const { projectContextHistory } = require("./session-context-history");
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE, compactionAvailable: true } });
  seedFragments(env.store, 10);
  const input = "我继续留意这些不完整的感官线索。";
  const before = await env.generator.readContextUsage({ revision: 10, input });
  const plan = await env.generator.readCompactionPlan({ revision: 10, input });
  assert.equal(plan.status, "ready"); assert.deepEqual(plan.before.latestEstimate, before.latestEstimate);
  const source = env.store.readTurn(1).narration.find((segment) => segment.id === "sensory");
  const summary = { summaryId: "compact-fragments", fromRevision: 1, throughRevision: plan.range.throughRevision,
    format: COMPACTION_QUOTE_FORMAT, items: createCompactionQuotes({ adventureId: "test-adventure", revision: 1,
      segmentId: source.id, text: source.text }) };
  const compared = await env.generator.previewCompaction({ revision: 10, input, planId: plan.planId, summary });
  assert.equal(compared.status, "reduced");
  const job = env.store.beginCompaction({ requestId: summary.summaryId, revision: 10, input, viewerId: "p",
    settingsIdentity: before.settingsIdentity, sourceHash: plan.sourceHash, throughRevision: summary.throughRevision,
    contextGeneration: plan.contextGeneration });
  env.store.commitCompaction({ requestId: job.requestId, attemptId: job.attemptId, outcome: "reduced", summary: { format: summary.format, items: summary.items },
    metrics: { before: compared.before, after: compared.after, savedSafetyInputTokens: compared.savedSafetyInputTokens } });
  const after = await env.generator.readContextUsage({ revision: 10, input });
  assert.deepEqual(after.latestEstimate, compared.after.latestEstimate);
  assert.equal(after.contextGeneration, 1); assert.equal(env.store.readModelState().memoryFragments.fragments.length, 10);
  const storedHistory = env.store.readContextHistory({ revision: 10 });
  assert.deepEqual(storedHistory.summary.items, summary.items, "stored selection handles remain available after adoption");
  const manifest = env.store.readContextCompaction({ revision: 10 });
  assert.deepEqual(manifest.fullHistoryCounts,
    countContextText(JSON.stringify(JSON.stringify(projectContextHistory(storedHistory)))),
    "streamed accounting includes the same ID-free adopted summary as the full story request");
  const nextPlan = await env.generator.readCompactionPlan({ revision: 10, input });
  assert.deepEqual(nextPlan.previousSummary.items, summary.items, "future compaction still receives the full selection handles");
  await env.generator.generateTurn(currentGeneratorArgs(env, input));
  const sent = env.providerCalls[0];
  const conversation = JSON.parse(sent.messages[3].content.slice(sent.messages[3].content.indexOf("\n") + 1));
  assert.deepEqual(conversation.summary.items, summary.items.map(({ text, source, range }) => ({ text, source, range })));
  assert.doesNotMatch(JSON.stringify(conversation), /quoteId|quote-[a-f0-9]{64}/);
  assert.equal(sent.tools.at(-1).function.name, "read_memory_fragments");
  assert.equal(JSON.parse(sent.messages[1].content).memoryFragments.count, 10);
  assert.doesNotMatch(JSON.stringify(JSON.parse(sent.messages[1].content)), /第1道微光|第10道微光/);
  assert.equal(env.generator.readUsage("attempt-one").contextUsage.latestEstimate.safetyInputTokens, after.latestEstimate.safetyInputTokens);
});

test("an explicit retry must reload the fragment guide instead of inheriting a failed attempt's authorization", async (t) => {
  const candidate = fragmentBundle(1);
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE, maxModelCalls: 4 },
    respond(input, call) {
      if (call === 1 || call === 6) return tools([loadFragmentGuide()]);
      if (call <= 4) return reply(null, { text: "{incomplete" });
      if (call === 5) {
        assert.doesNotMatch(JSON.stringify(input.messages), /LOCKED_FRAGMENT_SOURCE/);
        return reply(candidate);
      }
      assert.equal(JSON.parse(input.messages.at(-1).content).quotedNarrativeSources.memoryFragmentText, FRAGMENT_SOURCE);
      return reply(candidate);
    } });
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const action = request(); const before = env.store.readView();
  const failed = await coordinator.runAction(action);
  assert.equal(failed.status, "failed"); assert.equal(failed.error.code, "TURN_OUTPUT_INVALID");
  assert.equal(env.providerCalls.length, 4); assert.deepEqual(env.store.readView(), before);
  await coordinator.runAction(action);
  assert.equal(env.providerCalls.length, 4, "restoring the failure is read-only");
  const result = await coordinator.runAction(action, { retry: true });
  assert.equal(result.status, "committed"); assert.notEqual(result.attemptId, failed.attemptId);
  assert.equal(result.view.revision, 1); assert.equal(env.providerCalls.length, 7);
  assert.match(env.providerCalls[5].messages.at(-1).content, /guide has not been loaded in this attempt/);
  assert.equal(env.generator.readUsage(result.attemptId).modelCalls, 3);
  assert.equal(env.generator.readUsage(result.attemptId).toolCalls, 1);
  assert.deepEqual(env.store.readTurn(1).events, candidate.events);
});

test("loading the actual fragment guide can exhaust context before another Provider call without losing measured usage or committing", async (t) => {
  const baseline = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE } });
  const preview = await baseline.generator.readContextUsage({ revision: 0, input: request().input });
  const maximum = preview.latestEstimate.characters + 200;
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true },
    config: { memoryFragmentText: FRAGMENT_SOURCE, maxContextCharacters: maximum },
    respond() { return tools([loadFragmentGuide()]); } });
  assert.equal((await env.generator.readContextUsage({ revision: 0, input: request().input })).fits, true);
  const before = env.store.readView();
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const result = await coordinator.runAction(request());
  assert.equal(result.status, "failed"); assert.equal(result.error.code, "CONTEXT_BUDGET_EXCEEDED");
  assert.equal(env.providerCalls.length, 1); assert.deepEqual(env.store.readView(), before);
  const measured = env.generator.readUsage(result.attemptId);
  assert.equal(measured.modelCalls, 1); assert.equal(measured.toolCalls, 1);
  assert.equal(measured.contextUsage.fits, false);
  assert.ok(measured.contextUsage.latestEstimate.characters > maximum);
  assert.deepEqual(measured.usage, { input_tokens: 100, output_tokens: 80, total_tokens: 180 });
  assert.equal(measured.usageComplete, true);
  assert.doesNotMatch(JSON.stringify(measured), /LOCKED_FRAGMENT_SOURCE/);
});

test("compaction plans bind the unloaded locked fragment source even when initial request sizes and content versions match", async (t) => {
  const { createCompactionQuotes } = require("./session-compaction-quotes");
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE } });
  seedFragments(env.store, 4);
  const other = createTurnGenerator({ store: env.store, memory: { recall: async input => ({ revision: input.revision, results: [], truncated: false }) },
    adventureId: "test-adventure", hostText: "克制具体。旧指令：调用 finalize_new_game 写入状态。", worldText: "上海第十天。",
    memoryFragmentText: FRAGMENT_SOURCE + "锁定规则的另一版本。",
    provider: { generate() { assert.fail("a plan preview must not call the Provider"); } } });
  const options = { revision: 4, input: "我留意窗外。" };
  const first = await env.generator.readCompactionPlan(options);
  const second = await other.readCompactionPlan(options);
  assert.equal(first.status, "ready"); assert.equal(second.status, "ready");
  assert.deepEqual(first.before.latestEstimate, second.before.latestEstimate);
  assert.equal(first.sourceHash, second.sourceHash);
  assert.equal(first.settingsIdentity, second.settingsIdentity);
  assert.notEqual(first.planId, second.planId, "unloaded source identity remains part of the plan binding");
  const passage = env.store.readTurn(1).narration[0];
  const summary = { summaryId: "locked-guide-plan", fromRevision: 1, throughRevision: first.range.throughRevision,
    format: COMPACTION_QUOTE_FORMAT, items: createCompactionQuotes({ adventureId: "test-adventure", revision: 1, segmentId: passage.id, text: passage.text }) };
  await assert.rejects(other.previewCompaction({ ...options, planId: first.planId, summary }), { code: "CONTEXT_PLAN_STALE" });
  assert.equal(env.providerCalls.length, 0); assert.equal(env.store.readPlayerState().revision, 4);
});

test("a completed fragment track exposes deferred and later accepted choices without treating the personal narrative as core identity", async (t) => {
  const env = setup(t, { storeOptions: { memoryFragmentsEnabled: true }, config: { memoryFragmentText: FRAGMENT_SOURCE },
    respond(input, call) {
      const deferring = call <= 2;
      const fixed = JSON.parse(input.messages[1].content);
      assert.equal(fixed.memoryFragments.count, 30);
      assert.equal(fixed.memoryFragments.phase, deferring ? "available" : "deferred");
      assert.equal(fixed.memoryFragments.choice, deferring ? null : "deferred");
      assert.equal(fixed.canonicalState.memoryFragments, undefined);
      assert.match(input.messages[0].content, /not proof of absolute history/);
      if (call === 1 || call === 3) {
        assert.doesNotMatch(JSON.stringify(input.messages), /LOCKED_FRAGMENT_SOURCE/);
        return tools([loadFragmentGuide()]);
      }
      const guide = JSON.parse(input.messages.at(-1).content);
      assert.equal(guide.revision, deferring ? 30 : 31);
      return reply({ narration: [{ id: "choice", text: deferring ? "你暂时放下这些模糊的画面，让选择保持开放。"
        : "你决定接纳这些不完整的感受，把它们作为自己愿意面对的故事。" }],
      events: [{ id: "resolve", type: "memory_fragment.resolve", sourceSegmentIds: ["choice"], data: { choice: deferring ? "deferred" : "accepted" } }], experiences: [] });
    } });
  seedFragments(env.store, 30); const character = env.store.readModelState().entities.p;
  const coordinator = createTurnCoordinator({ store: env.store, generateTurn: env.generator.generateTurn });
  const deferred = await coordinator.runAction(request({ actionId: "defer-fragments", baseRevision: 30, input: "这些片段我还不想下定论，暂缓决定。" }));
  assert.equal(deferred.status, "committed"); assert.equal(env.store.readModelState().memoryFragments.revelationStatus, "deferred");
  assert.deepEqual(env.store.readModelState().entities.p, character);
  const accepted = await coordinator.runAction(request({ actionId: "accept-fragments", baseRevision: 31, input: "我愿意接纳这些过去的感受，但不把模糊画面当作证据。" }));
  assert.equal(accepted.status, "committed"); assert.equal(env.store.readModelState().memoryFragments.revelationStatus, "accepted");
  assert.deepEqual(env.store.readModelState().entities.p, character,
    "accepting uncertain fragments does not rewrite personal condition or identity");
  assert.equal(env.store.readModelState().finale, undefined); assert.equal(env.providerCalls.length, 4);
  assert.equal(env.generator.readUsage(deferred.attemptId).toolCalls, 1);
  assert.equal(env.generator.readUsage(accepted.attemptId).toolCalls, 1);
});
