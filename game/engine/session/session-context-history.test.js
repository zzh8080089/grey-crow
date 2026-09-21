"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeContextHistory, projectContextHistory, projectAutomaticRelated, contextMaterializationId, planContextHistory, previewContextHistory,
  normalizeCompactionManifest, planStreamedContext } = require("./session-context-history");
const { COMPACTION_QUOTE_FORMAT, createCompactionQuotes } = require("./session-compaction-quotes");
const { normalizeSessionContextOptions, estimateSessionContext, countSessionContext } = require("./session-context");

function history(count = 8) {
  return { adventureId: "story", revision: count, viewerId: "p", contextGeneration: 0, materializationId: "a".repeat(64),
    sourceHash: "b".repeat(64), summary: null, summaryValidity: "none",
    turns: Array.from({ length: count }, (_, index) => ({ revision: index + 1, actionId: `action-${index + 1}`,
      input: `玩家的选择 ${index + 1}`, narration: [{ id: "passage", text: `${index + 1}：` + "原文的细节。".repeat(150) }],
      source: { adventureId: "story", revision: index + 1 }, storyTurn: index + 1 })),
    timeline: { systemRevisions: [], storyTurnCount: count }, continuation: null };
}
function measured(options = {}) {
  const settings = normalizeSessionContextOptions({ contextPolicy: { configuredContextWindow: 64000 } });
  return { binding: { currentInput: options.input ?? "再看看", settingsIdentity: settings.settingsIdentity },
    estimate: (data) => estimateSessionContext({ messages: [{ role: "system", content: options.fixed ?? "真实固定状态" },
      { role: "user", content: JSON.stringify(data) }, { role: "user", content: options.input ?? "再看看" }],
    settings, identity: { adventureId: "story", revision: options.revision ?? 8, actionId: null } }) };
}
function quotesFor(turn, adventureId = "story") {
  return turn.narration.flatMap((segment) => createCompactionQuotes({ adventureId: turn.source?.adventureId ?? adventureId,
    revision: turn.revision, segmentId: segment.id, text: segment.text }));
}
function inputQuotesFor(turn, adventureId = "story") {
  return createCompactionQuotes({ adventureId: turn.source?.adventureId ?? adventureId,
    revision: turn.revision, kind: "player_input", text: turn.input });
}
function summary(throughRevision = 6, { source = history(), items = quotesFor(source.turns[0]), summaryId = "recap-one" } = {}) {
  return { summaryId, fromRevision: 1, throughRevision, format: COMPACTION_QUOTE_FORMAT, items };
}

test("continuous history retains all turns and complete multilingual paragraphs without modifying input", () => {
  const source = history();
  source.turns[0].narration[0].text = "中文 English 日本語 ".repeat(1000);
  const before = structuredClone(source);
  const result = projectContextHistory(normalizeContextHistory(source));
  assert.equal(result.turns.length, 8);
  assert.equal(result.turns[0].narration[0].text, source.turns[0].narration[0].text);
  assert.equal(result.coverage.omittedBeforeRevision, null);
  result.turns[0].input = "changed";
  assert.deepEqual(source, before);
});

test("story projection omits selection hashes while preserving every quotation character, source and range", () => {
  const source = history();
  source.summary = summary();
  source.summaryValidity = "valid";
  source.contextGeneration = 1;
  source.turns = source.turns.slice(-2);
  const before = structuredClone(source);
  const projected = projectContextHistory(source);
  const item = source.summary.items[0];
  assert.deepEqual(projected.summary, { ...source.summary,
    items: [{ text: item.text, source: item.source, range: item.range }] });
  assert.doesNotMatch(JSON.stringify(projected), /quoteId|quote-[a-f0-9]{64}/);
  assert.deepEqual(source, before);
  projected.summary.items[0].source.adventureId = "changed";
  projected.summary.items[0].range.start++;
  assert.deepEqual(source, before, "model projection must not mutate the internal source handles");
});

function recalled(turn, { adventureId = "story", experienceId = "account", kind = "claim" } = {}) {
  return { source: { adventureId, revision: turn.revision, actionId: turn.actionId,
    experienceId, segmentIds: turn.narration.map(segment => segment.id) },
  experience: { id: experienceId, kind, entityIds: ["p", "npc"], eventIds: [], knownBy: ["p"],
    sourceSegmentIds: turn.narration.map(segment => segment.id), supersedes: [{ revision: 1, experienceId: "earlier-account" }] },
  playerInput: { kind: "player_input", text: turn.input, start: 0, end: turn.input.length, truncated: false },
  passages: turn.narration.map(segment => ({ id: segment.id, text: segment.text, start: 0, end: segment.text.length, truncated: false })) };
}
function automatic(records, revision = 8) { return { revision, results: records, truncated: false }; }

test("automatic related references complete continuous sources without removing attribution or mutating either input", () => {
  const source = history();
  source.turns[4].input = "我只想听清她原先的说法，没有确认它是真的。\n🌧️ ".repeat(30);
  source.turns[4].narration[0].text = "她说：\"我也不能确定\"。日语では、まだ分かりません。\\\n".repeat(30);
  const related = automatic([recalled(source.turns[4]), recalled(source.turns[5], { experienceId: "later-account", kind: "belief" })]);
  const data = projectContextHistory(normalizeContextHistory(source));
  const before = structuredClone({ related, data });
  const result = projectAutomaticRelated({ related, history: data, adventureId: "story" });
  assert.equal(result.revision, related.revision);
  assert.equal(result.truncated, false, "deduplication is not an omitted-source budget truncation");
  assert.deepEqual(result.results.map(record => record.experience), related.results.map(record => record.experience));
  assert.deepEqual(result.results.map(record => record.source), related.results.map(record => record.source));
  const record = result.results[0];
  assert.equal(Object.hasOwn(record.playerInput, "text"), false);
  assert.deepEqual(record.playerInput, { kind: "player_input", start: 0, end: source.turns[4].input.length,
    truncated: false, historyRef: true });
  assert.deepEqual(record.passages[0], { id: "passage", start: 0, end: source.turns[4].narration[0].text.length,
    truncated: false, historyRef: true });
  assert.ok(JSON.stringify(result).length < JSON.stringify(related).length);
  assert.deepEqual({ related, data }, before);
  result.results[0].experience.knownBy.push("changed");
  result.results[0].source.revision = 99;
  assert.deepEqual({ related, data }, before);
});

test("actual adjacent quote ranges cover a recalled interval; a missing qualification or range gap preserves the whole source", () => {
  const source = history();
  source.turns[0].narration[0].text = "她继续讲述那天的情况。🌧️\n".repeat(280) + "但是她并不能确定时间，也没有确认门已经打开。";
  const original = source.turns[0].narration[0].text;
  const units = quotesFor(source.turns[0]);
  assert.ok(units.length >= 4);
  const related = automatic([recalled(source.turns[0])]);
  const data = (items) => projectContextHistory({ ...source, summary: summary(6, { items }), turns: source.turns.slice(-2) });
  const project = (items, input = related) => projectAutomaticRelated({ related: input, history: data(items), adventureId: "story" });
  for (const items of [units.slice(0, -1), units.filter((_, index) => index !== 1), []]) {
    const result = project(items);
    assert.equal(result.results[0].passages[0].text, original);
    assert.equal(result.results[0].passages[0].historyRef, undefined);
    assert.deepEqual(result.results[0].playerInput, related.results[0].playerInput);
  }
  const complete = project([...units].reverse());
  assert.equal(complete.results[0].passages[0].text, undefined);
  assert.equal(complete.results[0].passages[0].historyRef, true);
  assert.equal(complete.results[0].passages[0].end, original.length);
  // Recall itself may have returned a bounded slice: only that exact interval
  // must be present, and its existing truncated flag remains truthful.
  const slice = structuredClone(related);
  const start = units[1].range.start + 2, end = units[2].range.end - 2;
  slice.results[0].passages[0] = { id: "passage", text: original.slice(start, end), start, end, truncated: true };
  const coveredSlice = project([units[1], units[2]], slice).results[0].passages[0];
  assert.equal(coveredSlice.text, undefined);
  assert.equal(coveredSlice.truncated, true);
  assert.deepEqual(coveredSlice, { id: "passage", start, end, truncated: true, historyRef: true });
  const changed = structuredClone(units);
  changed[1].text = "改" + changed[1].text.slice(1);
  assert.equal(project(changed).results[0].passages[0].text, original, "matching coordinates cannot excuse different source text");
});

test("same words do not merge player input, narration, segment identities or independent ancestor sources", () => {
  const source = history();
  const same = "这只是我说的话，还没有得到独立确认。".repeat(30);
  const turn = { revision: 2, actionId: "ancestor-turn", input: same, narration: [{ id: "one", text: same }, { id: "two", text: same }] };
  const related = automatic([recalled(turn, { adventureId: "grandparent" }), recalled(turn, { adventureId: "parent", experienceId: "parent-account" }),
    recalled(turn, { adventureId: "child", experienceId: "child-account" })]);
  const units = createCompactionQuotes({ adventureId: "grandparent", revision: 2, kind: "player_input", text: same });
  const data = projectContextHistory({ ...source, summary: summary(6, { items: units }), turns: [] });
  const result = projectAutomaticRelated({ related, history: data, adventureId: "child" });
  assert.equal(result.results[0].playerInput.text, undefined);
  assert.deepEqual(result.results[0].passages, related.results[0].passages);
  assert.deepEqual(result.results.slice(1), related.results.slice(1));
  data.summary.items = createCompactionQuotes({ adventureId: "parent", revision: 2, segmentId: "one", text: same });
  const parent = projectAutomaticRelated({ related, history: data, adventureId: "child" });
  assert.deepEqual(parent.results[0], related.results[0]);
  assert.equal(parent.results[1].passages[0].text, undefined);
  assert.equal(parent.results[1].passages[0].historyRef, true);
  assert.equal(parent.results[1].source.adventureId, "parent");
  assert.equal(parent.results[1].passages[1].text, same);
  assert.equal(parent.results[1].playerInput.text, same);
  assert.deepEqual(parent.results[2], related.results[2]);
  // A retained inherited turn also carries its original adventure identity.
  data.summary = null;
  data.turns = [{ ...turn, source: { adventureId: "grandparent", revision: 2 } }];
  const continuous = projectAutomaticRelated({ related, history: data, adventureId: "child" });
  assert.equal(continuous.results[0].passages[0].historyRef, true);
  assert.equal(continuous.results[0].source.adventureId, "grandparent");
  assert.deepEqual(continuous.results.slice(1), related.results.slice(1));
});

test("opening supporting passages use their proposal revision and retain their separate evidentiary role", () => {
  const source = history();
  const text = "你穿着旧外套，还没有确认这个开局设定。".repeat(30);
  const record = recalled(source.turns[3], { adventureId: "parent", kind: "event" });
  record.supportingPassages = [{ kind: "opening_summary", adventureId: "parent", revision: 1, actionId: "proposal-action",
    segmentId: "summary", text, start: 0, end: text.length, truncated: false }];
  record.supportingPassagesOmitted = 0;
  const related = automatic([record]);
  const data = projectContextHistory({ ...source, summary: null, turns: [{ revision: 4, actionId: "confirm-action", input: "",
    source: { adventureId: "parent", revision: 4 }, narration: [{ id: "summary", text }] }] });
  assert.deepEqual(projectAutomaticRelated({ related, history: data, adventureId: "child" }).results[0].supportingPassages,
    record.supportingPassages, "identical confirmation text is not the earlier proposal's source");
  data.turns[0].revision = 1; data.turns[0].source.revision = 1; data.turns[0].actionId = "proposal-action";
  const result = projectAutomaticRelated({ related, history: data, adventureId: "child" }).results[0];
  const { text: omitted, ...metadata } = record.supportingPassages[0];
  assert.deepEqual(result.supportingPassages[0], { ...metadata, historyRef: true });
  assert.deepEqual(result.source, record.source);
  assert.equal(result.supportingPassagesOmitted, 0);
  assert.deepEqual(result.passages, record.passages);
});

test("unclear coordinates and short text stay intact, and every new history projection starts from the unchanged related packet", () => {
  const source = history();
  const record = recalled(source.turns[0]);
  const related = automatic([record]);
  const full = projectContextHistory(source);
  assert.equal(projectAutomaticRelated({ related, history: full, adventureId: "story" }).results[0].passages[0].text, undefined);
  const retained = projectContextHistory({ ...source, summary: summary(6, { items: quotesFor(source.turns[1]) }), turns: source.turns.slice(-2) });
  assert.deepEqual(projectAutomaticRelated({ related, history: retained, adventureId: "story" }), related,
    "a candidate summary which drops this source restores its automatic original text");
  // Streamed coverage/count metadata has no source text and cannot authorize omission.
  retained.coverage = { fromRevision: 1, throughRevision: 8, omittedBeforeRevision: null, systemRevisions: [] };
  assert.deepEqual(projectAutomaticRelated({ related, history: retained, adventureId: "story" }), related);
  for (const change of [value => { delete value.start; }, value => { value.end++; }, value => { value.start = -1; }]) {
    const unclear = structuredClone(related); change(unclear.results[0].passages[0]);
    assert.deepEqual(projectAutomaticRelated({ related: unclear, history: full, adventureId: "story" }).results[0].passages[0],
      unclear.results[0].passages[0]);
  }
  const short = { revision: 1, actionId: "short", input: "好", narration: [{ id: "short", text: "你点头。" }] };
  const shortRelated = automatic([recalled(short)]);
  assert.deepEqual(projectAutomaticRelated({ related: shortRelated, history: { summary: null, turns: [short] }, adventureId: "story" }), shortRelated,
    "references must not cost more than the original short text");
  assert.deepEqual(related, automatic([recalled(source.turns[0])]));
});

test("automatic related references must reduce the serialized message budget, including escaped JSON at the threshold", () => {
  for (const [length, expectedDifference] of [[5, 1], [6, 0], [7, -1], [91, -85]]) {
    const text = "x".repeat(length);
    const passage = { id: "s", text, start: 0, end: length, truncated: false };
    const related = automatic([{ source: { adventureId: "a", revision: 1, actionId: "t", experienceId: "e", segmentIds: ["s"] },
      experience: { id: "e", kind: "event", knownBy: ["p"], entityIds: ["p"], eventIds: [], sourceSegmentIds: ["s"] },
      passages: [passage] }], 1);
    const data = { summary: null, turns: [{ revision: 1, actionId: "t", input: "", narration: [{ id: "s", text }] }] };
    const before = structuredClone({ related, data });
    const { text: omitted, ...metadata } = passage;
    const marker = { ...metadata, historyRef: true };
    const forced = structuredClone(related); forced.results[0].passages[0] = marker;
    const counts = value => countSessionContext({ messages: [
      { role: "user", content: JSON.stringify(value) }, { role: "user", content: JSON.stringify(data) },
    ] });
    if (length === 7) assert.ok(JSON.stringify(forced).length > JSON.stringify(related).length,
      "the true message threshold differs from the inner object's length");
    assert.equal(counts(forced).characters - counts(related).characters, expectedDifference);
    const projected = projectAutomaticRelated({ related, history: data, adventureId: "a" });
    if (expectedDifference >= 0) assert.deepEqual(projected, related, "a reference which does not reduce the actual message stays as original text");
    else assert.deepEqual(projected, forced);
    const originalCounts = counts(related), projectedCounts = counts(projected);
    for (const key of ["characters", "bytes", "ascii", "other"]) assert.ok(projectedCounts[key] <= originalCounts[key]);
    assert.deepEqual({ related, data }, before);
  }
});

test("six ordinary short sources use compact markers while existing metadata still resolves every input and passage", () => {
  // Representative short-turn sizes, not a model-semantic acceptance fixture.
  const source = history(6);
  for (let index = 0; index < source.turns.length; index++) {
    source.turns[index].input = "我先看看眼前的情况，不急着作决定。".repeat(5).slice(0, [37, 43, 50, 57, 64, 71][index]);
    source.turns[index].narration[0].text = "你站在原地听着，没有再碰门边的物品。".repeat(6).slice(0, 32 + index * 11);
  }
  const related = automatic(source.turns.map((turn, index) => recalled(turn, { experienceId: `account-${index}` })), 6);
  const data = projectContextHistory(normalizeContextHistory(source));
  const result = projectAutomaticRelated({ related, history: data, adventureId: "story" });
  assert.equal(result.results.length, 6);
  for (const [index, record] of result.results.entries()) {
    assert.deepEqual(record.source, related.results[index].source);
    assert.deepEqual(record.experience, related.results[index].experience);
    const turn = data.turns.find(value => (value.source?.adventureId ?? "story") === record.source.adventureId
      && value.revision === record.source.revision);
    assert.equal(record.playerInput.historyRef, true);
    assert.equal(record.playerInput.kind, "player_input");
    assert.equal(record.playerInput.text, undefined);
    assert.equal(turn.input.slice(record.playerInput.start, record.playerInput.end), related.results[index].playerInput.text);
    for (const [position, passage] of record.passages.entries()) {
      assert.equal(passage.historyRef, true);
      assert.equal(passage.text, undefined);
      assert.equal(turn.narration.find(value => value.id === passage.id).text.slice(passage.start, passage.end),
        related.results[index].passages[position].text);
    }
  }
  const count = value => countSessionContext({ messages: [{ role: "user", content: JSON.stringify(value) },
    { role: "user", content: JSON.stringify(data) }] });
  const before = count(related), after = count(result);
  assert.ok(after.characters < before.characters);
  assert.ok(after.bytes < before.bytes);
  assert.ok(after.ascii / 4 + after.other < before.ascii / 4 + before.other);
  assert.deepEqual(related, automatic(source.turns.map((turn, index) => recalled(turn, { experienceId: `account-${index}` })), 6));
});

test("a plan replaces an actual prefix and compares the same full request with its last two turns retained", () => {
  const source = history();
  const inputs = { history: source, ...measured() };
  const plan = planContextHistory(inputs);
  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.range, { fromRevision: 1, throughRevision: 6 });
  assert.deepEqual(plan.turns.map((turn) => turn.revision), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(plan.retainedTurnRevisions, [7, 8]);
  const preview = previewContextHistory({ ...inputs, planId: plan.planId, summary: summary() });
  assert.equal(preview.status, "reduced");
  assert.deepEqual(preview.before, plan.before);
  assert.equal(preview.savedSafetyInputTokens, plan.before.latestEstimate.bytes - preview.after.latestEstimate.bytes);
  assert.ok(preview.savedSafetyInputTokens > 0);
  assert.deepEqual(source, history());
});

test("only registered continuation boundaries explain gaps and rolling summaries preserve earlier sources", () => {
  const source = history(9);
  source.timeline = { systemRevisions: [4], storyTurnCount: 8 };
  source.turns = source.turns.filter((turn) => turn.revision !== 4);
  for (const turn of source.turns) {
    if (turn.revision > 4) turn.storyTurn--;
    else turn.source.adventureId = "parent";
  }
  source.summary = summary(3, { source });
  source.summaryValidity = "valid";
  source.turns = source.turns.filter((turn) => turn.revision > 3);
  source.contextGeneration = 1;
  const inputs = { history: source, ...measured({ revision: 9 }) };
  const plan = planContextHistory(inputs);
  assert.deepEqual(plan.turns.map((turn) => turn.revision), [5, 6, 7]);
  assert.deepEqual(plan.retainedTurnRevisions, [8, 9]);
  const next = summary(7, { items: [...source.summary.items, ...quotesFor(source.turns[0])], summaryId: "recap-two" });
  assert.equal(previewContextHistory({ ...inputs, planId: plan.planId, summary: next }).status, "reduced");
  const missing = structuredClone(source); missing.turns.shift();
  assert.throws(() => normalizeContextHistory(missing), { code: "CONTEXT_SOURCE_UNAVAILABLE" });
  const forged = structuredClone(source); forged.timeline.systemRevisions = [4, 5];
  assert.throws(() => normalizeContextHistory(forged), { code: "CONTEXT_SOURCE_UNAVAILABLE" });
});

test("no source prefix, oversized fixed state and a larger summary have honest different results", () => {
  assert.equal(planContextHistory({ history: history(2), ...measured({ revision: 2 }) }).status, "not_needed");
  const source = history();
  assert.equal(planContextHistory({ history: source, ...measured({ fixed: "固定事实".repeat(10000) }) }).status, "baseline_too_large");
  const short = history(3); short.turns.forEach((turn) => { turn.input = "好"; turn.narration[0].text = "他点头。"; });
  const inputs = { history: short, ...measured({ revision: 3 }) };
  const plan = planContextHistory(inputs);
  const candidate = summary(1, { source: short });
  const preview = previewContextHistory({ ...inputs, planId: plan.planId, summary: candidate });
  assert.equal(preview.status, "no_benefit");
  assert.ok(preview.savedSafetyInputTokens < 0);
  const actualAfter = inputs.estimate(projectContextHistory({ ...short, summary: candidate, turns: short.turns.slice(-2) }));
  assert.deepEqual(preview.after, actualAfter, "benefit must use the actual ID-free story request, including its metadata");
});

test("changed input, settings binding and materialization cannot reuse an earlier plan", () => {
  const source = history();
  const inputs = { history: source, ...measured() };
  const plan = planContextHistory(inputs);
  const preview = (changes) => previewContextHistory({ ...inputs, planId: plan.planId, summary: summary(), ...changes });
  assert.throws(() => preview(measured({ input: "另一个行动" })), { code: "CONTEXT_PLAN_STALE" });
  assert.throws(() => preview({ binding: { changedSetting: true } }), { code: "CONTEXT_PLAN_STALE" });
  const changed = structuredClone(source); changed.contextGeneration++;
  assert.notEqual(contextMaterializationId(changed), contextMaterializationId(source));
  assert.throws(() => preview({ history: changed }), { code: "CONTEXT_PLAN_STALE" });
});

test("candidate ranges and citations cannot include retained turns, missing paragraphs or fabricated history", () => {
  const source = history();
  const inputs = { history: source, ...measured() };
  const plan = planContextHistory(inputs);
  for (const mutate of [
    (candidate) => { candidate.throughRevision = 7; },
    (candidate) => { candidate.items = createCompactionQuotes({ ...candidate.items[0].source, segmentId: "missing", text: candidate.items[0].text }); },
    (candidate) => { candidate.items = quotesFor(source.turns[6]); },
    (candidate) => { candidate.items = createCompactionQuotes({ ...candidate.items[0].source, adventureId: "another-story", text: candidate.items[0].text }); },
    (candidate) => { candidate.items = createCompactionQuotes({ ...candidate.items[0].source, text: "原文没说过的确定结论。" }); },
    (candidate) => { candidate.fromRevision = 2; },
  ]) {
    const candidate = summary(); mutate(candidate);
    assert.throws(() => previewContextHistory({ ...inputs, planId: plan.planId, summary: candidate }));
  }
  const sourceCopy = structuredClone(source); sourceCopy.turns[0].narration[0].id = "alternate";
  assert.throws(() => previewContextHistory({ ...inputs, history: sourceCopy, planId: plan.planId, summary: summary() }), { code: "CONTEXT_PLAN_STALE" });
});

test("a player's self-introduction can be retained from input without pretending the narration repeated it", () => {
  const source = history();
  source.turns[5].input = "我叫沈禾，叫我小沈就好。我想先把这锅水烧开。";
  source.turns[5].narration = [{ id: "reply", text: "你问了一句。她看了你一眼：“小沈？”锅里的水还没有开。" }];
  const inputs = { history: source, ...measured() }, plan = planContextHistory(inputs);
  const candidate = summary(6, { items: inputQuotesFor(source.turns[5]) });
  assert.equal(previewContextHistory({ ...inputs, planId: plan.planId, summary: candidate }).status, "reduced");
  const projected = projectContextHistory({ ...source, summary: candidate, turns: source.turns.slice(-2) });
  assert.equal(projected.summary.items[0].text, source.turns[5].input);
  assert.deepEqual(projected.summary.items[0].source, { adventureId: "story", revision: 6, kind: "player_input" });
  assert.deepEqual(projected.summary.items[0].range, { start: 0, end: source.turns[5].input.length,
    totalCharacters: source.turns[5].input.length });
  assert.equal(Object.hasOwn(projected.summary.items[0], "quoteId"), false);
  assert.doesNotMatch(source.turns[5].narration[0].text, /沈禾|我想/);
  for (const items of [
    createCompactionQuotes({ adventureId: "story", revision: 6, segmentId: "reply", text: source.turns[5].input }),
    createCompactionQuotes({ adventureId: "other", revision: 6, kind: "player_input", text: source.turns[5].input }),
    createCompactionQuotes({ adventureId: "story", revision: 6, kind: "player_input", text: "我已经把水烧开了。" }),
  ]) assert.throws(() => previewContextHistory({ ...inputs, planId: plan.planId, summary: { ...candidate, items } }),
    { code: "CONTEXT_PLAN_INVALID" });
  assert.throws(() => previewContextHistory({ ...inputs, planId: plan.planId,
    summary: { ...candidate, items: inputQuotesFor(source.turns[6]) } }), { code: "CONTEXT_SOURCE_UNAVAILABLE" });
});

test("two successive compactions carry exact older quotes forward and keep the newest two original turns", () => {
  const firstHistory = history();
  const firstInputs = { history: firstHistory, ...measured() };
  const firstPlan = planContextHistory(firstInputs);
  const firstSummary = summary(6, { items: [...quotesFor(firstHistory.turns[0]), ...inputQuotesFor(firstHistory.turns[5])] });
  assert.equal(previewContextHistory({ ...firstInputs, planId: firstPlan.planId, summary: firstSummary }).status, "reduced");

  const later = history(12);
  later.summary = firstSummary;
  later.summaryValidity = "valid";
  later.contextGeneration = 1;
  later.materializationId = "c".repeat(64);
  later.turns = later.turns.filter((turn) => turn.revision > 6);
  const secondInputs = { history: later, ...measured({ revision: 12 }) };
  const secondPlan = planContextHistory(secondInputs);
  assert.deepEqual(secondPlan.previousSummary.items, firstSummary.items);
  assert.equal(secondPlan.previousSummary.items.at(-1).source.kind, "player_input");
  assert.match(secondPlan.previousSummary.items[0].quoteId, /^quote-[a-f0-9]{64}$/);
  const secondSummary = summary(10, { summaryId: "recap-two", items: [...firstSummary.items, ...quotesFor(later.turns[0])] });
  assert.deepEqual(secondPlan.turns.map((turn) => turn.revision), [7, 8, 9, 10]);
  assert.deepEqual(secondPlan.retainedTurnRevisions, [11, 12]);
  const secondPreview = previewContextHistory({ ...secondInputs, planId: secondPlan.planId, summary: secondSummary });
  assert.equal(secondPreview.status, "reduced");
  const adopted = normalizeContextHistory({ ...later, summary: secondSummary, contextGeneration: 2,
    turns: later.turns.filter((turn) => turn.revision > 10) });
  assert.deepEqual(adopted.summary.items[0], firstSummary.items[0]);
  assert.deepEqual(adopted.summary.items[1], firstSummary.items[1]);
  assert.deepEqual(adopted.turns, history(12).turns.slice(-2));
  assert.equal(projectContextHistory(adopted).summary.format, COMPACTION_QUOTE_FORMAT);
  assert.doesNotMatch(JSON.stringify(projectContextHistory(adopted).summary), /quoteId|quote-[a-f0-9]{64}/);
  assert.equal(firstHistory.summary, null);
});

test("selected long-source quotes remain explicit exact excerpts and cannot authorize rewritten text or arbitrary ranges", () => {
  const source = history();
  const original = "阿婆说：大前天……下午？她也不能确定。🌧️\n".repeat(180);
  source.turns[0].narration[0].text = original;
  const quotes = quotesFor(source.turns[0]);
  assert.ok(quotes.length > 2);
  const candidate = summary(6, { items: [quotes[1]] });
  const inputs = { history: source, ...measured() };
  const plan = planContextHistory(inputs);
  assert.equal(previewContextHistory({ ...inputs, planId: plan.planId, summary: candidate }).status, "reduced");
  const adopted = normalizeContextHistory({ ...source, contextGeneration: 1, summary: candidate, summaryValidity: "valid",
    turns: source.turns.slice(-2) });
  const quote = projectContextHistory(adopted).summary.items[0];
  assert.ok(quote.range.start > 0 && quote.range.end < quote.range.totalCharacters);
  assert.equal(quote.range.totalCharacters, original.length);
  assert.equal(quote.text, original.slice(quote.range.start, quote.range.end));
  assert.deepEqual(quote.source, { adventureId: "story", revision: 1, kind: "narration", segmentId: "passage" });
  for (const mutate of [
    (item) => { item.text += "因此时间已经确定。"; },
    (item) => { item.range.start++; },
    (item) => { item.source.segmentId = "different"; },
    (item) => { item.quoteId = "quote-" + "0".repeat(64); },
  ]) {
    const changed = structuredClone(candidate); mutate(changed.items[0]);
    assert.throws(() => previewContextHistory({ ...inputs, planId: plan.planId, summary: changed }));
  }
  const sliced = summary(6, { items: createCompactionQuotes({ ...quote.source, text: quote.text.slice(1) }) });
  assert.throws(() => previewContextHistory({ ...inputs, planId: plan.planId, summary: sliced }), { code: "CONTEXT_PLAN_INVALID" });
  assert.equal(source.turns[0].narration[0].text, original);
});

test("unmarked summaries, out-of-range quotes and system-boundary sources are unavailable", () => {
  const source = history();
  source.summaryValidity = "valid";
  source.summary = summary();
  source.turns = source.turns.slice(-2);
  for (const mutate of [
    (value) => { delete value.summary.format; },
    (value) => { value.summary.format = "source-quotes-1"; },
    (value) => { value.summary.format = "model-summary"; },
    (value) => { value.summary = { summaryId: "old", fromRevision: 1, throughRevision: 6,
      items: [{ text: "改写的旧摘要", kind: "claim", entityIds: [], sources: [{ adventureId: "story", revision: 1, segmentId: "passage" }] }] }; },
    (value) => { value.summary.items = quotesFor(history().turns[6]); },
    (value) => { value.timeline.systemRevisions = [1]; value.timeline.storyTurnCount--;
      value.turns.forEach((turn) => turn.storyTurn--); },
  ]) {
    const changed = structuredClone(source); mutate(changed);
    assert.throws(() => normalizeContextHistory(changed), { code: "CONTEXT_SOURCE_UNAVAILABLE" });
  }
  assert.equal(normalizeContextHistory(history()).summary, null, "a store's full-original fallback still normalizes normally");
});

test("streamed planning preserves source-quote metadata while estimating the complete history and newest two turns", () => {
  const source = history(10);
  source.summary = summary(4);
  source.summaryValidity = "valid";
  source.contextGeneration = 1;
  source.turns = source.turns.filter((turn) => turn.revision > 4);
  const inputs = measured({ revision: 10 });
  const before = inputs.estimate(projectContextHistory(source));
  const manifest = { kind: "streamed_context", history: { ...source, turns: source.turns.slice(-2) },
    range: { fromRevision: 1, throughRevision: 8 }, replacedCount: 4,
    fullHistoryCounts: { ascii: 10, other: 20, characters: 30, bytes: 70 } };
  const plan = planStreamedContext({ manifest, ...inputs, estimateFull: () => before });
  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.before, before);
  assert.deepEqual(plan.previousSummary, source.summary);
  assert.deepEqual(plan.retainedTurnRevisions, [9, 10]);
  const candidate = summary(8, { items: [...source.summary.items, ...quotesFor(source.turns[0])], summaryId: "recap-two" });
  const checked = normalizeCompactionManifest({ ...manifest, candidateHistory: { ...source,
    summary: candidate, turns: source.turns.slice(-2) } });
  assert.deepEqual(checked.candidateHistory.summary, candidate);
  assert.deepEqual(checked.history.summary.items, source.summary.items);
});

test("history getters and unsafe JSON are rejected without executing application code", () => {
  const source = history(); let called = false;
  Object.defineProperty(source.turns[0], "input", { enumerable: true, get() { called = true; return "unsafe"; } });
  assert.throws(() => normalizeContextHistory(source), { code: "CONTEXT_SOURCE_UNAVAILABLE" });
  assert.equal(called, false);
  assert.throws(() => normalizeContextHistory({ ...history(), extra: true }), { code: "CONTEXT_SOURCE_UNAVAILABLE" });
});
