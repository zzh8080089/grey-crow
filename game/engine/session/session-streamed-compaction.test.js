"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createTurnStore } = require("./turn-store");
const { createAdventureSession } = require("./adventure-session");
const { createTurnGenerator } = require("./turn-generator");
const { createTurnMemory } = require("./turn-memory");
const { createTurnCoordinator } = require("./turn-coordinator");
const { createSessionCompaction } = require("./session-compaction");
const { projectContextHistory, normalizeCompactionManifest } = require("./session-context-history");
const { COMPACTION_QUOTE_FORMAT, createCompactionQuotes } = require("./session-compaction-quotes");
const { countContextText, countSessionContext, estimateSessionContext, normalizeSessionContextOptions } = require("./session-context");
const samples = require("./test-fixtures/turn-samples");

const policy = { contextPolicy: { configuredContextWindow: 4_000_000 } };
const input = "我继续观察楼道。";
const bundle = (text, id = "s") => ({ narration: [{ id, text }], events: [], experiences: [] });
const reply = (value) => ({ text: JSON.stringify(value), toolCalls: [], finishReason: "stop",
  usage: { input_tokens: 100, output_tokens: 80 } });
function commit(store, revision, text, playerInput = input) {
  const action = store.beginAction(samples.request({ actionId: `native-${revision}`, baseRevision: revision - 1, input: playerInput }));
  store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle(text, `s-${revision}`) });
}
function candidate(data) {
  const quotes = data.quoteCandidates || data.parts?.flatMap((part) => part.items);
  assert.ok(quotes?.length, "the model may select only engine-provided original quote IDs");
  return { selectedQuoteIds: [quotes[0].quoteId] };
}
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-streamed-context-"));
  const resources = [];
  t.after(async () => { for (const resource of resources) await resource.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, resources, identity: samples.identity(path.join(directory, "seed.sqlite")) };
}

test("native manifest counts equal full double-encoded history, and owned pages reject stale sources", (t) => {
  const { identity, resources } = fixture(t);
  const store = createTurnStore({ ...identity, initialState: samples.initialState() });
  resources.push(store);
  for (let revision = 1; revision <= 6; revision++) commit(store, revision, `第${revision}轮：引号\"、反斜线\\、换行\n、😀、é、\ud800。`);
  const history = store.readContextHistory({ revision: 6 });
  const manifest = normalizeCompactionManifest(store.readContextCompaction({ revision: 6 }));
  assert.deepEqual(manifest.fullHistoryCounts, countContextText(JSON.stringify(JSON.stringify(projectContextHistory(history)))));
  assert.deepEqual(manifest.history.turns.map((turn) => turn.revision), [5, 6]);
  assert.deepEqual(manifest.range, { fromRevision: 1, throughRevision: 4 });
  const job = store.beginCompaction({ requestId: "stream-owned", revision: 6, input,
    viewerId: "p", settingsIdentity: "a".repeat(64), sourceHash: history.sourceHash,
    throughRevision: 4, contextGeneration: 0 });
  const page = store.readCompactionSources({ requestId: job.requestId, attemptId: job.attemptId, limit: 2 });
  assert.deepEqual(page.records, history.turns.slice(0, 2));
  assert.equal(page.complete, false);
  assert.throws(() => store.readCompactionSources({ requestId: job.requestId, attemptId: "wrong" }), { code: "COMPACTION_ATTEMPT_STALE" });
  assert.throws(() => store.readCompactionSources({ requestId: job.requestId, attemptId: job.attemptId,
    cursor: { ...page.nextCursor, sourceHash: "b".repeat(64) } }), { code: "COMPACTION_PLAN_STALE" });
  let getter = 0;
  const malformed = { ...page.nextCursor };
  Object.defineProperty(malformed, "afterRevision", { enumerable: true, get() { getter++; return 2; } });
  assert.throws(() => store.readCompactionSources({ requestId: job.requestId, attemptId: job.attemptId, cursor: malformed }));
  assert.equal(getter, 0);
  const second = store.readCompactionSources({ requestId: job.requestId, attemptId: job.attemptId, cursor: page.nextCursor });
  assert.deepEqual(second.records, history.turns.slice(2, 4));
  assert.equal(second.complete, true);
  const db = new DatabaseSync(identity.databasePath);
  db.prepare("UPDATE turns SET narration_json=? WHERE revision=1").run(JSON.stringify(bundle("临时故障修改来源。").narration));
  db.close();
  assert.throws(() => store.readCompactionSources({ requestId: job.requestId, attemptId: job.attemptId, cursor: page.nextCursor }), { code: "COMPACTION_PLAN_STALE" });
});

test("streamed input quotes retain a self-introduction alongside distinct narration through adoption and restart", async (t) => {
  const { identity, resources } = fixture(t);
  const seed = createTurnStore({ ...identity, initialState: samples.initialState() });
  const introduction = "我叫沈禾，叫我小沈就好。我想先把这锅水烧开。";
  const answer = "你问了一句。她看了你一眼：“小沈？”锅里的水还没有开。";
  for (let revision = 1; revision <= 8; revision++) commit(seed, revision,
    revision === 6 ? answer : `第${revision}轮：` + "楼道里传来细小的雨声。".repeat(80), revision === 6 ? introduction : input);
  seed.close();
  let calls = 0, retained;
  const options = { ...identity, hostText: "克制具体地回应玩家。", worldText: "上海，第十天。", ...policy,
    provider: { async generate(request) {
      calls++;
      const data = JSON.parse(request.messages[1].content);
      assert.equal(data.task, "summarize_context");
      assert.ok(data.quoteCandidates.every((quote) => !Object.hasOwn(quote, "playerInput")), "input is a selectable typed source, not temporary side data");
      retained = data.quoteCandidates.filter((quote) => quote.source.revision === 6 && (quote.source.kind === "player_input" || quote.source.segmentId === "s-6"));
      assert.deepEqual(retained.map((quote) => quote.source.kind), ["narration", "player_input"]);
      assert.equal(retained[0].text, answer);
      assert.equal(retained[1].text, introduction);
      assert.equal(Object.hasOwn(retained[1].source, "segmentId"), false);
      return reply({ selectedQuoteIds: retained.map((quote) => quote.quoteId) });
    } } };
  const session = createAdventureSession(options); resources.push(session);
  const result = await session.compactContext({ requestId: "retain-introduction", revision: 8, input });
  assert.equal(result.status, "reduced", JSON.stringify(result.error));
  assert.equal(calls, 1);
  assert.equal(session.readView().revision, 8);
  await session.close();
  const reopened = createTurnStore(identity); resources.push(reopened);
  const history = reopened.readContextHistory({ revision: 8 });
  assert.equal(history.summary.format, COMPACTION_QUOTE_FORMAT);
  const canonical = [
    ...createCompactionQuotes({ adventureId: identity.adventureId, revision: 6, segmentId: "s-6", text: answer }),
    ...createCompactionQuotes({ adventureId: identity.adventureId, revision: 6, kind: "player_input", text: introduction }),
  ];
  assert.ok(retained.every(quote => /^q[1-9][0-9]*$/.test(quote.quoteId)));
  assert.deepEqual(history.summary.items, canonical);
  const projected = projectContextHistory(history);
  assert.deepEqual(projected.summary.items, retained.map(({ text, source, range }) => ({ text, source, range })));
  assert.doesNotMatch(JSON.stringify(projected), /quoteId|quote-[a-f0-9]{64}/);
  const manifest = reopened.readContextCompaction({ revision: 8 });
  assert.deepEqual(manifest.history.summary.items, canonical);
  assert.deepEqual(manifest.fullHistoryCounts, countContextText(JSON.stringify(JSON.stringify(projected))));
  assert.equal(calls, 1, "read-only restart and accounting do not generate a story or another selection");
});

test("streamed recall estimates never undercount full history and restore omitted sources in the adopted candidate request", async (t) => {
  const { identity, resources } = fixture(t);
  const store = createTurnStore({ ...identity, initialState: samples.initialState() }); resources.push(store);
  const escaped = '她指着"等候"字样，反斜线\\旁有水痕。\n😀é，时间还不能确定。';
  for (let revision = 1; revision <= 6; revision++) {
    const recalled = revision === 1 || revision === 5;
    const action = store.beginAction(samples.request({ actionId: `recall-source-${revision}`, baseRevision: revision - 1,
      input: recalled ? `quartzsignal，第${revision}次我只询问原话。\n` + '不要把"也许"说成确定。\\😀'.repeat(12) : input }));
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: {
      narration: [{ id: `s-${revision}`, text: recalled ? `quartzsignal，第${revision}次听见：` + escaped.repeat(24)
        : `第${revision}轮窗外仍在下雨。` + escaped.repeat(90) }], events: [],
      experiences: recalled ? [{ id: `account-${revision}`, entityIds: ["p", "npc"], eventIds: [],
        sourceSegmentIds: [`s-${revision}`], kind: "claim", knownBy: ["p", "npc"] }] : [],
    } });
  }
  const options = { revision: 6, input: "我想回忆 quartzsignal 的原话。" };
  const originalHistory = store.readContextHistory({ revision: 6 });
  const originalState = store.readModelState({ revision: 6 });
  const memory = createTurnMemory({ store });
  const raw = memory.recall({ query: options.input, entityIds: [], revision: 6, viewerId: "p", limit: 6,
    outputMode: "model", maxCharacters: 8000 });
  assert.deepEqual(raw.results.map(record => record.source.revision).sort((a, b) => a - b), [1, 5]);
  for (const record of raw.results) {
    assert.ok(record.passages[0].text.length > 500);
    assert.match(record.passages[0].text, /"等候".*\\.*\n😀/);
    assert.equal(record.passages[0].truncated, false);
    assert.equal(record.playerInput.truncated, false);
  }
  const storyRequests = [];
  const provider = { async generate(request) {
    storyRequests.push(structuredClone({ messages: request.messages, tools: request.tools, responseFormat: request.responseFormat }));
    return reply(bundle("你仍留在楼道里，仔细回想她的原话。"));
  } };
  const config = { adventureId: identity.adventureId, memory, provider, hostText: "克制具体地回应玩家。",
    worldText: "上海，第十天。", compactionAvailable: true, ...policy };
  const normal = createTurnGenerator({ ...config, store });
  let boundedReads = 0, manifestReads = 0;
  // The same real SQLite sources fit this small test. A bounded reader facade
  // forces only the materialization limit, exercising the production fallback
  // without inventing a manifest or requiring another multi-megabyte fixture.
  const limited = { ...store, readContextHistory() {
    boundedReads++;
    throw Object.assign(new Error("bounded test reader"), { code: "CONTEXT_HISTORY_TOO_LARGE" });
  }, readContextCompaction(args) { manifestReads++; return store.readContextCompaction(args); } };
  const streamed = createTurnGenerator({ ...config, store: limited });
  const before = await normal.readContextUsage(options);
  const streamedBefore = await streamed.readContextUsage(options);
  const plan = await streamed.readCompactionPlan(options);
  assert.equal(plan.streamed, true);
  assert.deepEqual(plan.retainedTurnRevisions, [5, 6]);
  await normal.generateTurn({ attemptId: "full-history-measurement", request: samples.request({ actionId: "full-history-measurement",
    baseRevision: 6, input: options.input }), state: originalState });
  const fullRequest = storyRequests[0];
  const readPacket = (request, index) => JSON.parse(request.messages[index].content.split("\n").slice(1).join("\n"));
  const setPacket = (request, index, value) => { request.messages[index].content = request.messages[index].content.split("\n")[0] + "\n" + JSON.stringify(value); };
  const automatic = readPacket(fullRequest, 2);
  assert.deepEqual(readPacket(fullRequest, 3), projectContextHistory(originalHistory));
  for (const record of automatic.results) {
    assert.equal(record.passages[0].historyRef, true);
    assert.equal(record.playerInput.historyRef, true);
    assert.equal(Object.hasOwn(record.passages[0], "text"), false);
  }
  const exact = request => estimateSessionContext({ ...request, settings: normalizeSessionContextOptions(policy),
    identity: { adventureId: identity.adventureId, revision: 6, actionId: null }, includesPlayerInput: true });
  assert.deepEqual(before.latestEstimate, exact(fullRequest).latestEstimate);
  const limitedRelated = structuredClone(automatic);
  limitedRelated.results = limitedRelated.results.map(record => record.source.revision === 1
    ? raw.results.find(source => source.source.revision === 1) : record);
  const conservativeFull = structuredClone(fullRequest);
  setPacket(conservativeFull, 2, limitedRelated);
  assert.deepEqual(streamedBefore.latestEstimate, exact(conservativeFull).latestEstimate,
    "unread prefix coverage cannot remove recall; all escaping must be counted at the actual message encoding layer");
  assert.deepEqual(plan.before.latestEstimate, streamedBefore.latestEstimate);
  for (const key of ["inputTokens", "safetyInputTokens", "characters", "bytes"]) {
    assert.ok(streamedBefore.latestEstimate[key] >= before.latestEstimate[key], key);
  }
  assert.ok(streamedBefore.latestEstimate.bytes > before.latestEstimate.bytes + 500);

  let candidateSummary, preview, compactionCalls = 0;
  const service = createSessionCompaction({ store: limited, generator: { ...streamed, async previewCompaction(args) {
    candidateSummary = structuredClone(args.summary);
    preview = await streamed.previewCompaction(args);
    return preview;
  } }, ...policy, provider: { async generate(request) {
    compactionCalls++;
    const data = JSON.parse(request.messages[1].content);
    assert.equal(data.task, "summarize_context");
    const selected = data.quoteCandidates.find(quote => quote.source.revision === 2 && quote.source.kind === "narration");
    assert.ok(selected);
    return reply({ selectedQuoteIds: [selected.quoteId] });
  } } });
  t.after(() => service.shutdown());
  const result = await service.compact({ requestId: "streamed-recall-pair", ...options });
  assert.equal(result.status, "reduced", JSON.stringify(result.error));
  assert.equal(compactionCalls, 1);
  assert.ok(boundedReads > 0 && manifestReads >= boundedReads);
  assert.deepEqual(store.readModelState({ revision: 6 }), originalState);
  const adopted = store.readContextHistory({ revision: 6 });
  assert.deepEqual(adopted.turns, originalHistory.turns.slice(-2));
  assert.deepEqual(adopted.summary, candidateSummary);
  assert.equal(adopted.summary.items.some(quote => quote.source.revision === 1), false);
  const expectedCandidate = structuredClone(fullRequest);
  setPacket(expectedCandidate, 2, limitedRelated);
  setPacket(expectedCandidate, 3, projectContextHistory(adopted));
  assert.deepEqual(preview.after.latestEstimate, exact(expectedCandidate).latestEstimate,
    "the candidate that discards the old recalled source must restore its input and prose before measuring");
  assert.deepEqual((await normal.readContextUsage(options)).latestEstimate, preview.after.latestEstimate);
  assert.deepEqual((await streamed.readContextUsage(options)).latestEstimate, preview.after.latestEstimate,
    "after adoption the manifest and full reader contain the same effective history");
  const coordinator = createTurnCoordinator({ store, generateTurn: normal.generateTurn });
  const action = await coordinator.runAction(samples.request({ actionId: "after-streamed-recall", baseRevision: 6, input: options.input }));
  assert.equal(action.status, "committed", JSON.stringify(action.error));
  assert.equal(storyRequests.length, 2);
  assert.deepEqual(storyRequests[1], expectedCandidate);
  assert.equal(countSessionContext(storyRequests[1]).bytes, preview.after.latestEstimate.bytes);
  assert.deepEqual(readPacket(storyRequests[1], 2).results.find(record => record.source.revision === 1),
    raw.results.find(record => record.source.revision === 1));
  t.diagnostic(JSON.stringify({ fullBytes: before.latestEstimate.bytes, streamedBytes: streamedBefore.latestEstimate.bytes,
    candidateBytes: preview.after.latestEstimate.bytes, compactionCalls }));
});

test("a fresh native story above 8 MiB can restore, compact in bounded requests, continue and reopen", async (t) => {
  const { directory, identity, resources } = fixture(t);
  const seed = createTurnStore({ ...identity, initialState: samples.initialState() });
  const text = "雨".repeat(30_000) + "引号\"\\\n😀é";
  for (let revision = 1; revision <= 100; revision++) commit(seed, revision, `原文-${revision}：${text}`);
  assert.throws(() => seed.readContextHistory({ revision: 100 }), { code: "CONTEXT_HISTORY_TOO_LARGE" });
  const manifest = seed.readContextCompaction({ revision: 100 });
  const originals = [];
  let beforeRevision;
  do {
    const page = seed.readHistory({ revision: 100, ...(beforeRevision ? { beforeRevision } : {}), limit: 20, maxCharacters: 1_000_000 });
    originals.unshift(...page.history); beforeRevision = page.nextBeforeRevision;
  } while (beforeRevision);
  const completeHistory = { ...manifest.history, turns: originals };
  assert.equal(originals.length, 100);
  const expectedHistory = JSON.stringify(projectContextHistory(completeHistory));
  assert.ok(Buffer.byteLength(expectedHistory) > 8 * 1024 * 1024);
  assert.deepEqual(manifest.fullHistoryCounts, countContextText(JSON.stringify(expectedHistory)));
  const originalState = seed.readPlayerState().state;
  seed.close();
  const open = (name, provider, extra = {}) => {
    const databasePath = path.join(directory, name + ".sqlite");
    fs.copyFileSync(identity.databasePath, databasePath);
    const options = { ...identity, databasePath, provider, hostText: "克制具体地回应玩家。", worldText: "上海，第十天。",
      ...policy, timeoutMs: 120_000, ...extra };
    const session = createAdventureSession(options);
    resources.push(session);
    return { session, options };
  };
  await t.test("manual compaction preserves complete originals and exact next-request accounting", async () => {
    const covered = []; let largestRequest = 0; let storyRequest; let calls = 0;
    const provider = { async generate(request) {
      calls++;
      largestRequest = Math.max(largestRequest, Buffer.byteLength(JSON.stringify({ messages: request.messages, tools: request.tools, responseFormat: request.responseFormat })));
      const data = JSON.parse(request.messages[1].content);
      if (data.task) {
        if (!data.parts) covered.push(...data.quoteCandidates);
        return reply(candidate(data));
      }
      storyRequest = structuredClone({ messages: request.messages, tools: request.tools, responseFormat: request.responseFormat });
      return reply(bundle("你继续留意楼道的声响。"));
    } };
    const { session, options } = open("success", provider);
    assert.equal(session.readView().revision, 100);
    const before = await session.readContextUsage({ revision: 100, input });
    assert.equal(before.compactionAvailable, true); assert.equal(before.fits, false); assert.equal(calls, 0);
    const started = performance.now();
    const result = await session.compactContext({ requestId: "compact-large", revision: 100, input });
    assert.equal(result.status, "reduced", JSON.stringify(result.error));
    assert.ok(result.modelCalls > 1 && result.modelCalls <= 8);
    assert.deepEqual([...new Set(covered.map((quote) => quote.source.revision))], Array.from({ length: 98 }, (_, index) => index + 1));
    assert.equal(new Set(covered.map(({ source, range }) => JSON.stringify({ source, range }))).size, covered.length,
      "all canonical source windows are covered once even when request-local option IDs restart per chunk");
    for (let revision = 1; revision <= 98; revision++) {
      for (const original of originals[revision - 1].narration) {
        const quotes = covered.filter((quote) => quote.source.revision === revision
          && quote.source.kind === "narration" && quote.source.segmentId === original.id);
        let end = 0;
        for (const quote of quotes) {
          assert.deepEqual(quote.source, { adventureId: identity.adventureId, revision, kind: "narration", segmentId: original.id });
          assert.equal(quote.range.start, end);
          assert.equal(quote.range.totalCharacters, original.text.length);
          assert.ok(quote.text.length > 0 && quote.text.length <= 1200);
          assert.equal(quote.text, original.text.slice(quote.range.start, quote.range.end));
          end = quote.range.end;
        }
        assert.equal(end, original.text.length);
        assert.equal(quotes.map((quote) => quote.text).join(""), original.text);
      }
      const inputs = covered.filter((quote) => quote.source.revision === revision && quote.source.kind === "player_input");
      const originalInput = originals[revision - 1].input;
      let end = 0;
      for (const quote of inputs) {
        assert.deepEqual(quote.source, { adventureId: identity.adventureId, revision, kind: "player_input" });
        assert.equal(quote.range.start, end);
        assert.equal(quote.range.totalCharacters, originalInput.length);
        assert.ok(quote.text.length > 0 && quote.text.length <= 1200);
        assert.equal(quote.text, originalInput.slice(quote.range.start, quote.range.end));
        end = quote.range.end;
      }
      assert.equal(end, originalInput.length);
      assert.equal(inputs.map((quote) => quote.text).join(""), originalInput);
    }
    assert.ok(largestRequest < 8_000_000);
    assert.deepEqual(session.readPlayerState().state, originalState);
    assert.equal(session.readView().revision, 100);
    const after = await session.readContextUsage({ revision: 100, input });
    assert.equal(after.fits, true); assert.equal(after.contextGeneration, 1);
    assert.deepEqual(after.latestEstimate, result.after.latestEstimate);
    const request = samples.request({ actionId: "after-large", baseRevision: 100, input });
    const action = await session.runAction(request);
    assert.equal(action.status, "committed", JSON.stringify(action.error));
    const materialized = JSON.parse(storyRequest.messages[3].content.split("\n").slice(1).join("\n"));
    assert.equal(materialized.summary.throughRevision, 98);
    assert.equal(materialized.summary.format, COMPACTION_QUOTE_FORMAT);
    for (const item of materialized.summary.items) {
      const original = covered.find((quote) => JSON.stringify(quote.source) === JSON.stringify(item.source)
        && JSON.stringify(quote.range) === JSON.stringify(item.range));
      assert.ok(original);
      assert.deepEqual(item, { text: original.text, source: original.source, range: original.range });
      assert.equal(Object.hasOwn(item, "quoteId"), false);
    }
    assert.deepEqual(materialized.turns, originals.slice(-2));
    const reconstructed = structuredClone(storyRequest);
    reconstructed.messages[3].content = storyRequest.messages[3].content.split("\n")[0] + "\n" + expectedHistory;
    const exact = estimateSessionContext({ ...reconstructed, settings: normalizeSessionContextOptions(policy),
      identity: { adventureId: identity.adventureId, revision: 100, actionId: null }, includesPlayerInput: true });
    assert.deepEqual(before.latestEstimate, exact.latestEstimate, "streamed preview must equal the complete serialized request");
    const completedCalls = calls;
    await session.close();
    const restarted = createAdventureSession(options);
    try {
      assert.equal(restarted.readView().revision, 101);
      assert.equal((await restarted.readContextUsage({ revision: 101 })).contextGeneration, 1);
      assert.equal((await restarted.runAction(request)).modelCalls, 0);
      assert.equal(calls, completedCalls);
    } finally { await restarted.close(); }
    t.diagnostic(JSON.stringify({ originalBytes: Buffer.byteLength(expectedHistory), summaryModelCalls: result.modelCalls,
      largestRequestBytes: largestRequest, elapsedMs: Math.round(performance.now() - started), observedRssBytes: process.memoryUsage().rss }));
  });
  await t.test("a call budget too small rejects before spending any model call", async () => {
    let calls = 0;
    const { session } = open("budget", { async generate() { calls++; throw new Error("must not generate"); } }, { maxCompactionModelCalls: 1 });
    const result = await session.compactContext({ requestId: "small-budget", revision: 100, input });
    assert.equal(result.error.code, "COMPACTION_MODEL_BUDGET_EXCEEDED"); assert.equal(calls, 0);
    assert.equal(session.readView().revision, 100);
  });
  await t.test("automatic compaction precedes the first resumed action without dropping the older prefix", async () => {
    const kinds = [];
    const { session } = open("automatic", { async generate(request) {
      const data = JSON.parse(request.messages[1].content); kinds.push(data.task || "story");
      if (data.task) return reply(candidate(data));
      const history = JSON.parse(request.messages[3].content.split("\n").slice(1).join("\n"));
      assert.equal(history.summary.throughRevision, 98);
      assert.deepEqual(history.turns, originals.slice(-2));
      return reply(bundle("你听着窗外的雨声，继续观察。"));
    } });
    const result = await session.runAction(samples.request({ actionId: "auto-after-large", baseRevision: 100, input }));
    assert.equal(result.status, "committed", JSON.stringify(result.error));
    assert.equal(kinds.at(-1), "story"); assert.equal(kinds.filter((kind) => kind === "story").length, 1);
    assert.ok(kinds.includes("merge_context"));
  });
  await t.test("closing during streamed generation keeps an interrupted receipt and ignores a late answer", async () => {
    const entered = deferred(), delayed = deferred(); let calls = 0;
    const { session, options } = open("interrupted", { async generate(request) {
      calls++; entered.resolve(JSON.parse(request.messages[1].content)); return delayed.promise;
    } });
    const running = session.compactContext({ requestId: "restart-large", revision: 100, input });
    const data = await entered.promise;
    await session.close();
    const closingReceipt = await running;
    assert.equal(closingReceipt.status, "unknown");
    assert.equal(closingReceipt.error.code, "COMPACTION_OUTCOME_UNKNOWN");
    delayed.resolve(reply(candidate(data)));
    await new Promise((resolve) => setImmediate(resolve));
    const reopened = createAdventureSession({ ...options, provider: { async generate(request) { calls++; return reply(candidate(JSON.parse(request.messages[1].content))); } } });
    try {
      const readback = reopened.readContextCompaction({ requestId: "restart-large" });
      assert.equal(readback.status, "interrupted");
      assert.equal((await reopened.compactContext({ requestId: "restart-large", revision: 100, input })).modelCalls, 0);
      assert.equal(calls, 1); assert.equal((await reopened.readContextUsage({ revision: 100 })).contextGeneration, 0);
      const retried = await reopened.compactContext({ requestId: "restart-large", revision: 100, input }, { retry: true });
      assert.equal(retried.status, "reduced", JSON.stringify(retried.error));
      assert.equal(reopened.readView().revision, 100);
    } finally { await reopened.close(); }
  });
});
