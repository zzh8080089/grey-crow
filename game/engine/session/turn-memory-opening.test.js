"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { createTurnStore } = require("./turn-store");
const { createTurnMemory } = require("./turn-memory");
const { createOpeningState } = require("./session-opening");
const { appendContinuationBoundary } = require("./session-lineage");
const samples = require("./test-fixtures/turn-samples");

const SUMMARY = "你叫林安，过去做水电维修。随身留着父亲的活动扳手，柄上缠着红色电工胶布；从物业小屋开始。";
function digest(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function bundle(type, data, id, text) {
  return { narration: [{ id, text }], events: [...(type ? [{ id: `${id}-event`, type, sourceSegmentIds: [id], data }] : [])], experiences: [] };
}
function fixture(t, { summary = [SUMMARY], knownBy = ["p"], entityIds = ["p", "wrench"], initialConditions } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-opening-memory-"));
  const stores = [];
  const databasePath = (adventureId = "parent") => path.join(root, `${adventureId}.sqlite`);
  function open(adventureId = "parent", initialState) {
    const store = createTurnStore({ ...samples.identity(databasePath(adventureId)), adventureId,
      ...(initialState ? { initialState } : {}) });
    stores.push(store); return store;
  }
  function commit(store, revision, candidate) {
    const action = store.beginAction(samples.request({ actionId: `action-${revision + 1}`, baseRevision: revision,
      input: revision === 4 ? "对，就这样开始。" : "自然对话中的开局选择。" }));
    return store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: candidate });
  }
  const entity = (id, kind, name, visibility = "player") => ({ id, kind, name, aliases: [], visibility, attributes: {} });
  const initialState = { entities: {
    p: entity("p", "character", "林安"), home: entity("home", "location", "物业小屋"),
    wrench: entity("wrench", "item", "旧扳手"), npc: entity("npc", "character", "陈姨"),
    secret: entity("secret", "character", "隐藏访客", "hidden"),
  }, inventory: [{ ownerId: "p", itemId: "wrench", quantity: 1 }], commitments: {},
  situation: { playerId: "p", locationId: "home", day: 10 } };
  const store = open("parent", createOpeningState());
  commit(store, 0, bundle("opening.propose", { proposalId: "discarded", initialState }, "old-summary", "尚未确认的铜色罗盘方案。"));
  commit(store, 1, bundle("opening.draft", { draft: { name: "林安" } }, "draft", "你决定重新说明留下的东西。"));
  const proposal = { narration: summary.map((text, index) => ({ id: `summary-${index}`, text })),
    events: [{ id: "opening-proposal", type: "opening.propose", sourceSegmentIds: summary.map((_, index) => `summary-${index}`),
      data: { proposalId: "chosen", initialState, ...(initialConditions ? { initialConditions } : {}) } }], experiences: [] };
  proposal.narration.push({ id: "unrelated", text: "未被摘要引用的其他对白。" });
  commit(store, 2, proposal);
  commit(store, 3, bundle(null, null, "uncertain", "你暂时没有确认这个摘要。"));
  function confirm() {
    const turn = bundle("opening.confirm", { proposalId: "chosen" }, "first-scene", "光线从门缝里落下来。你站在物业小屋里。");
    turn.experiences.push({ id: "confirmed-identity", text: "你确认了身份和随身之物。", kind: "event", knownBy, entityIds,
      eventIds: ["first-scene-event"], sourceSegmentIds: ["first-scene"] });
    turn.experiences.push({ id: "scene-only", text: "清晨光线落在屋内。", kind: "event", knownBy: ["p"], entityIds: [],
      eventIds: [], sourceSegmentIds: ["first-scene"] });
    return commit(store, 4, turn);
  }
  function recall(connection = store, options = {}) {
    return createTurnMemory({ store: connection }).recall({ query: "红色电工胶布", viewerId: "p", ...options });
  }
  function mutate(revision, column, change) {
    const db = new DatabaseSync(databasePath());
    try {
      const original = JSON.parse(db.prepare(`SELECT ${column} AS value FROM turns WHERE revision=?`).get(revision).value);
      db.prepare(`UPDATE turns SET ${column}=? WHERE revision=?`).run(JSON.stringify(change(original)), revision);
    } finally { db.close(); }
  }
  t.after(() => { for (const connection of stores) connection.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, open, commit, confirm, recall, mutate, databasePath, summary };
}

test("confirmed opening memory recalls the earlier accepted summary after reopening, without replacing its own source", (t) => {
  const env = fixture(t); env.confirm();
  for (let revision = 5; revision < 18; revision++) env.commit(env.store, revision, bundle(null, null, "later", "你继续整理屋里的东西。"));
  assert.deepEqual(env.store.readModelState().entities.p.attributes, {},
    "ordinary later activity must not invent a bodily condition");
  assert.doesNotMatch(JSON.stringify(env.store.readRecentTurns({ limit: 12 })), /红色电工胶布/);
  assert.doesNotMatch(JSON.stringify(env.store.readModelState()), /红色电工胶布/);
  const before = digest(env.databasePath());
  env.store.close(); const reopened = env.open();
  const result = env.recall(reopened);
  assert.equal(result.revision, 18);
  assert.equal(result.results.length, 1, "the distinctive query appears only in the supporting summary");
  const memory = result.results[0];
  assert.deepEqual(memory.source, { adventureId: "parent", revision: 5, actionId: "action-5",
    experienceId: "confirmed-identity", segmentIds: ["first-scene"] });
  assert.deepEqual(memory.passages, [{ id: "first-scene", text: "光线从门缝里落下来。你站在物业小屋里。", start: 0, end: 19, truncated: false }]);
  assert.deepEqual(memory.supportingPassages, [{ kind: "opening_summary", adventureId: "parent", revision: 3,
    actionId: "action-3", segmentId: "summary-0", text: SUMMARY, start: 0, end: SUMMARY.length, truncated: false }]);
  assert.equal(memory.supportingPassagesOmitted, 0);
  assert.equal(result.truncated, false);
  assert.doesNotMatch(JSON.stringify(result), /铜色罗盘|其他对白|隐藏访客/);
  assert.equal(digest(env.databasePath()), before, "reopening and source recall do not change the save");
  const scene = env.recall(reopened, { query: "清晨光线" }).results.find((entry) => entry.experience.id === "scene-only");
  assert.equal(scene.supportingPassages, undefined, "an unrelated first-scene experience does not acquire the proposal source");
});

test("opening recall verifies engine-compiled initial conditions rather than comparing the raw model state", (t) => {
  const condition = "左臂酸痛，手指没有麻木。";
  const env = fixture(t, { summary: [SUMMARY + condition], initialConditions: [{ characterId: "p", basis: "observed", text: condition,
    evidence: [{ segmentId: "summary-0", quote: condition }] }] });
  const proposed = env.store.readModelState().opening.proposal.initialState.entities.p.conditionRecords.items[0];
  env.confirm(); env.store.close();
  const reopened = env.open();
  assert.deepEqual(reopened.readModelState().entities.p.conditionRecords.items, [proposed]);
  assert.equal(proposed.sources[0].revision, 3);
  assert.equal(env.recall(reopened).results[0].supportingPassages[0].text, SUMMARY + condition);
  // An exact quote alone is insufficient if the original proposal's compiled
  // display differs from the immutable record that confirmation accepted.
  env.mutate(3, "events_json", events => { events[0].data.initialConditions[0].text = "左臂没有酸痛。"; return events; });
  assert.throws(() => env.recall(reopened), { code: "MEMORY_SOURCE_UNAVAILABLE" });
});

test("an old pending opening without condition containers still confirms and recalls without migration", (t) => {
  const env = fixture(t);
  for (let revision = 1; revision <= 4; revision++) env.mutate(revision, "state_json", state => {
    for (const entity of Object.values(state.opening?.proposal?.initialState?.entities || {})) delete entity.conditionRecords;
    return state;
  });
  const oldPending = env.store.readModelState().opening.proposal.initialState;
  assert.equal(oldPending.entities.p.conditionRecords, undefined);
  env.confirm(); env.store.close();
  const reopened = env.open();
  assert.equal(reopened.readModelState().entities.p.conditionRecords, undefined);
  assert.equal(env.recall(reopened).results[0].supportingPassages[0].text, SUMMARY);
});

test("unconfirmed and future opening sources are unavailable, and only the fixed player's visible experiences acquire support", (t) => {
  const env = fixture(t);
  assert.throws(() => env.recall(), { code: "MEMORY_VIEWER_INVALID" });
  env.confirm();
  for (const revision of [0, 1, 3, 4]) assert.throws(() => env.recall(env.store, { revision }), { code: "MEMORY_VIEWER_INVALID" });
  assert.throws(() => env.recall(env.store, { viewerId: "npc" }), { code: "MEMORY_VIEWER_INVALID" });
  assert.equal(env.recall(env.store, { revision: 5 }).results[0].supportingPassages[0].revision, 3);
  for (const options of [{ knownBy: ["npc"] }, { entityIds: ["secret"] }]) {
    const hidden = fixture(t, options); hidden.confirm();
    // This damaged source would fail a visible lookup. Filtering happens first.
    hidden.mutate(3, "narration_json", () => []);
    assert.deepEqual(hidden.recall().results, []);
  }
});

for (const [name, revision, column, damage] of [
  ["missing summary text", 3, "narration_json", () => []],
  ["duplicate source segment", 3, "narration_json", (value) => [...value, value[0]]],
  ["missing confirming event", 5, "events_json", () => []],
  ["different pending proposal", 4, "state_json", (value) => { value.opening.proposal.proposalId = "changed"; return value; }],
  ["changed original proposal", 3, "events_json", (value) => { value[0].data.initialState.entities.p.name = "另一人"; return value; }],
  ["redirected confirmation metadata", 5, "state_json", (value) => {
    value.opening.confirmation.summaryRevision = 1; value.opening.confirmation.summarySegmentIds = ["old-summary"]; return value;
  }],
]) test(`opening support fails explicitly for ${name}`, (t) => {
  const env = fixture(t); env.confirm(); env.mutate(revision, column, damage);
  assert.throws(() => env.recall(), { code: "MEMORY_SOURCE_UNAVAILABLE" });
});

test("opening support shares the response budget and retains exact excerpt ranges and omitted-source counts", (t) => {
  const env = fixture(t, { summary: [SUMMARY + "你仔细回想自己作出的开局选择。".repeat(200)] }); env.confirm();
  const result = env.recall(env.store, { maxCharacters: 2000 });
  assert.ok(JSON.stringify(result).length <= 2000);
  assert.equal(result.truncated, true);
  const supporting = result.results[0].supportingPassages[0];
  assert.equal(supporting.truncated, true);
  assert.equal(supporting.text, env.summary[0].slice(supporting.start, supporting.end));
  assert.equal(supporting.revision, 3); assert.equal(supporting.actionId, "action-3");
  const many = fixture(t, { summary: Array.from({ length: 16 }, (_, index) => `红色电工胶布，第${index + 1}段已确认的选择。`) }); many.confirm();
  const limited = many.recall(many.store, { maxCharacters: 1800 });
  assert.ok(JSON.stringify(limited).length <= 1800);
  assert.equal(limited.truncated, true);
  const entry = limited.results[0];
  assert.ok(entry.supportingPassagesOmitted > 0);
  assert.equal(entry.supportingPassages.length + entry.supportingPassagesOmitted, 16);
  assert.equal(entry.source.revision, 5);
  for (const maxCharacters of [256, 600, 1199, 1799]) {
    const bounded = many.recall(many.store, { maxCharacters });
    assert.ok(JSON.stringify(bounded).length <= maxCharacters);
    assert.equal(bounded.truncated, true);
  }
});

test("a caller cannot inject a future or foreign supporting source through the memory adapter", (t) => {
  const env = fixture(t); env.confirm();
  for (const patch of [{ revision: 6 }, { adventureId: "another-adventure" }]) {
    const source = { ...env.store, listExperienceRecords(input) {
      const page = env.store.listExperienceRecords(input);
      Object.assign(page.records[0].supportingPassages[0], patch); return page;
    } };
    assert.throws(() => env.recall(source), { code: "MEMORY_SOURCE_UNAVAILABLE" });
  }
});

test("an independent continuation recalls the inherited opening from its copied database with the original adventure identity", (t) => {
  const env = fixture(t); env.confirm();
  env.commit(env.store, 5, bundle("finale.propose", { candidateId: "ending", closureReason: "这次值班告一段落。",
    closedThreads: ["已完成的值班"], intentionalOpenThreads: [], finaleTone: "平静" }, "ending-offer", "这段故事可以在这里结束，你愿意吗？"));
  env.commit(env.store, 6, bundle("finale.confirm", { candidateId: "ending" }, "last", "你结束了这次值班。"));
  const job = env.store.beginChapter({ targetRevision: 7 });
  env.store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: { title: "值班结束", summary: "这次值班告一段落。",
    keyEvents: [{ text: "值班结束。", sources: [{ revision: 7, segmentId: "last" }] }], openThreads: [], mode: "excerpt", fallbackReason: "CHAPTER_MODEL_UNAVAILABLE" } });
  env.store.sealFinale({ finaleId: "finale-7", chapterId: job.chapterId }); env.store.close();
  fs.copyFileSync(env.databasePath(), env.databasePath("child"));
  const childDatabase = new DatabaseSync(env.databasePath("child"));
  try { appendContinuationBoundary(childDatabase, { parentAdventureId: "parent", childAdventureId: "child", parentRevision: 7,
    sourceFinaleId: "finale-7", requestId: "child-copy", createdAt: "2026-09-10T01:00:00.000Z" }); }
  finally { childDatabase.close(); }
  fs.rmSync(env.databasePath());
  const child = env.open("child");
  env.commit(child, 8, bundle(null, null, "next", "你开始新一天的值班。"));
  child.close(); const reopened = env.open("child");
  assert.deepEqual(reopened.readModelState().entities.p.attributes, {},
    "an ending and an independent continuation preserve the confirmed character attributes");
  const result = env.recall(reopened);
  assert.equal(result.revision, 9);
  assert.equal(result.results[0].source.adventureId, "parent");
  assert.equal(result.results[0].source.revision, 5);
  assert.deepEqual(result.results[0].playerInput, { kind: "player_input", text: "对，就这样开始。", start: 0, end: 8, truncated: false });
  const model = env.recall(reopened, { outputMode: "model" });
  assert.deepEqual(model.results[0].playerInput, result.results[0].playerInput);
  assert.equal(model.results[0].source.adventureId, "parent");
  assert.equal(result.results[0].supportingPassages[0].adventureId, "parent");
  assert.equal(result.results[0].supportingPassages[0].actionId, "action-3");
  assert.equal(result.results[0].supportingPassages[0].text, SUMMARY);
});
