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
const { readSessionTimeline, mapSessionSource, readLineageFinale, appendContinuationBoundary } = require("./session-lineage");
const samples = require("./test-fixtures/turn-samples");

function bundle(type, data, id = "s", text = "合成故事中的对话。") {
  return { narration: [{ id, text }], events: [...(type ? [{ id: "e", type, sourceSegmentIds: [id], data }] : [])], experiences: [] };
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-lineage-"));
  const stores = [];
  const databasePath = (adventureId) => path.join(root, `${adventureId}.sqlite`);
  function open(adventureId, initialState, options = {}) {
    const store = createTurnStore({ ...samples.identity(databasePath(adventureId)), adventureId,
      ...(initialState === undefined ? {} : { initialState }), ...options });
    stores.push(store); return store;
  }
  function commit(store, adventureId, candidate) {
    const revision = store.readView().revision + 1;
    const action = store.beginAction(samples.request({ actionId: `${adventureId}-action-${revision}`, baseRevision: revision - 1,
      input: `合成故事第 ${revision} 个版本的玩家回答。` }));
    return store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: candidate });
  }
  function seal(store, adventureId) {
    const candidateId = `${adventureId}-ending`;
    commit(store, adventureId, bundle("finale.propose", { candidateId, closureReason: "PRIVATE_LINEAGE_PARENT_REASON",
      closedThreads: ["这段旅程暂时结束。"], intentionalOpenThreads: ["借米承诺继续保留其真实状态。"], finaleTone: "平静" }, "ask"));
    const last = commit(store, adventureId, bundle("finale.confirm", { candidateId }, "last", "这段旅程在晨光中结束。"));
    const job = store.beginChapter({ targetRevision: last.revision });
    store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: {
      title: "晨光", summary: "这段旅程结束，仍未解决的事情保持原状。", keyEvents: [{ text: "旅程结束。", sources: [{ revision: last.revision, segmentId: "last" }] }],
      openThreads: [], mode: "excerpt", fallbackReason: "CHAPTER_MODEL_UNAVAILABLE",
    } });
    store.sealFinale({ finaleId: `finale-${last.revision}`, chapterId: job.chapterId });
    return last.revision;
  }
  function seed() {
    const store = open("parent", createOpeningState());
    commit(store, "parent", bundle("opening.propose", { proposalId: "role", initialState: samples.initialState() }, "opening-summary"));
    commit(store, "parent", bundle("opening.confirm", { proposalId: "role" }, "first-scene"));
    const borrowed = samples.borrowBundle();
    borrowed.narration.push({ id: "claim", text: "陈姨声称箱子是蓝色，但这件事还没有证实。" });
    borrowed.experiences.push({ id: "box-claim", text: "陈姨声称箱子是蓝色。", entityIds: ["npc"], eventIds: [], sourceSegmentIds: ["claim"], kind: "claim", knownBy: ["p"] },
      { id: "private", text: "箱子密码是PRIVATE_NPC_SECRET。", entityIds: ["npc"], eventIds: [], sourceSegmentIds: ["claim"], kind: "belief", knownBy: ["npc"] },
      { id: "hidden", text: "PRIVATE_HIDDEN_VISITOR知道箱子。", entityIds: ["secret"], eventIds: [], sourceSegmentIds: ["claim"], kind: "belief", knownBy: ["p"] });
    commit(store, "parent", borrowed);
    seal(store, "parent");
    store.close();
    return store;
  }
  function fork(parentAdventureId = "parent", childAdventureId = "child", requestId = `${childAdventureId}-fork`) {
    fs.copyFileSync(databasePath(parentAdventureId), databasePath(childAdventureId));
    const db = new DatabaseSync(databasePath(childAdventureId));
    try {
      const parentRevision = db.prepare("SELECT revision FROM session").get().revision;
      const options = { parentAdventureId, childAdventureId, parentRevision, sourceFinaleId: `finale-${parentRevision}`,
        requestId, createdAt: "2026-09-10T12:00:00.000Z", title: `${childAdventureId} · 续篇` };
      return { options, timeline: appendContinuationBoundary(db, options) };
    } finally { db.close(); }
  }
  t.after(() => { for (const store of stores) store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, databasePath, open, commit, seal, seed, fork };
}
function digest(filename) { return createHash("sha256").update(fs.readFileSync(filename)).digest("hex"); }

test("a private boundary changes only the copied identity and current finale, with no player action or narration", (t) => {
  const env = fixture(t); env.seed();
  const parentHash = digest(env.databasePath("parent"));
  const parent = env.open("parent");
  const beforeState = parent.readModelState(); const beforeTurn = parent.readTurn(5); const parentFinale = parent.readFinale();
  parent.close();
  const { options, timeline } = env.fork();
  assert.equal(timeline.revision, 6); assert.equal(timeline.storyTurnCount, 5);
  assert.deepEqual(timeline.systemRevisions, [6]);
  assert.deepEqual(Object.keys(timeline.continuation).sort(), ["requestId", "lineageId", "parentAdventureId", "childAdventureId", "parentRevision", "boundaryRevision", "sourceFinaleId", "createdAt", "title"].sort());
  assert.equal(timeline.continuation.parentRevision, 5);
  assert.doesNotMatch(JSON.stringify(timeline), /PRIVATE_LINEAGE_PARENT_REASON|parent_archive|decision|closedThreads/);
  const child = env.open("child");
  assert.deepEqual(child.readModelState(), { ...beforeState, finale: { phase: "idle", candidate: null, lastDeclined: null, confirmation: null } });
  assert.deepEqual(child.readModelState().opening.confirmation, beforeState.opening.confirmation);
  assert.deepEqual(child.readTurn(5), beforeTurn);
  assert.deepEqual(child.readView().narration, []);
  assert.equal(child.readView().actionId, null);
  assert.deepEqual(child.readView().timeline, { storyTurnCount: 5, systemRevisions: [6] });
  assert.equal(child.readView().history.length, 5);
  assert.deepEqual(child.readRecentTurns({ limit: 6 }).turns.map((row) => row.revision), [1, 2, 3, 4, 5]);
  assert.equal(child.readRecentTurns({ limit: 0 }).continuation.requestId, options.requestId);
  const db = new DatabaseSync(env.databasePath("child"));
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM actions").get().n, 5);
    assert.deepEqual(appendContinuationBoundary(db, options), timeline, "same creation request is idempotent");
    const inherited = readLineageFinale(db, { adventureId: "child", revision: 5 });
    assert.deepEqual(inherited.decision, parentFinale.decision);
    assert.deepEqual(inherited.archive, parentFinale.archive);
    assert.equal(inherited.chapterJob.adventureId, "child");
    assert.equal(readLineageFinale(db, { adventureId: "child", revision: 4 }), null);
    assert.deepEqual(mapSessionSource(readSessionTimeline(db, { adventureId: "child", revision: 3 }), 3), { adventureId: "parent", revision: 3 });
  } finally { db.close(); }
  assert.equal(digest(env.databasePath("parent")), parentHash);
});

test("multiple generations retain source identities and history paging skips only validated boundaries", (t) => {
  const env = fixture(t); env.seed(); env.fork();
  const child = env.open("child");
  env.commit(child, "child", samples.returnBundle());
  assert.equal(env.seal(child, "child"), 9); child.close();
  env.fork("child", "grandchild");
  const grandchild = env.open("grandchild");
  env.commit(grandchild, "grandchild", bundle(null, null, "new-day", "你望向新一天的楼道。"));
  assert.deepEqual(grandchild.readView().timeline, { storyTurnCount: 9, systemRevisions: [6, 10] });
  let cursor; const pages = [];
  do {
    const page = grandchild.readHistory({ revision: 11, ...(cursor ? { beforeRevision: cursor } : {}), limit: 2 });
    pages.unshift(page.history); cursor = page.nextBeforeRevision;
  } while (cursor);
  const history = pages.flat();
  assert.deepEqual(history.map((row) => row.revision), [1, 2, 3, 4, 5, 7, 8, 9, 11]);
  assert.deepEqual(history.map((row) => row.storyTurn), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(history.map((row) => row.source.adventureId), ["parent", "parent", "parent", "parent", "parent", "child", "child", "child", "grandchild"]);
  assert.deepEqual(grandchild.readFinale({ revision: 5 }).archive.confirmationRevision, 5);
  assert.deepEqual(grandchild.readFinale({ revision: 9 }).archive.confirmationRevision, 9);
  assert.equal(grandchild.readView({ revision: 5 }).continuation, null);
  const historical = grandchild.readView({ revision: 9 });
  assert.equal(historical.adventureId, "grandchild");
  assert.equal(historical.continuation.childAdventureId, "child");
  assert.equal(historical.continuation.boundaryRevision, 6);
  assert.deepEqual(historical.timeline, { storyTurnCount: 8, systemRevisions: [6] });
  assert.equal(grandchild.readView().continuation.childAdventureId, "grandchild");
  assert.equal(grandchild.readFinale().decision.phase, "idle");
  assert.doesNotMatch(JSON.stringify(grandchild.readRecentTurns({ limit: 12 }).turns), /continuation.start/);
});

test("inherited local memories retain original sources, current child facts, privacy and visible corrections after reopen", (t) => {
  const env = fixture(t); env.seed(); env.fork();
  let child = env.open("child");
  env.commit(child, "child", samples.returnBundle());
  let memory = createTurnMemory({ store: child });
  const borrowed = memory.recall({ query: "陈姨借米承诺", viewerId: "p" }).results.find((row) => row.experience.id === "borrow-memory");
  assert.equal(borrowed.source.adventureId, "parent"); assert.equal(borrowed.source.revision, 3);
  assert.equal(borrowed.currentFacts.commitments["rice-promise"].status, "fulfilled");
  assert.equal(borrowed.experience.kind, "event");
  const correction = bundle(null, null, "correct", "你和陈姨确认：箱子其实是黑色，先前说法有误。");
  correction.experiences.push({ id: "corrected-box", text: "箱子是黑色。", entityIds: ["npc"], eventIds: [], sourceSegmentIds: ["correct"], kind: "event", knownBy: ["p"],
    supersedes: [{ revision: 3, experienceId: "box-claim" }] });
  env.commit(child, "child", correction);
  child.close(); fs.unlinkSync(env.databasePath("parent"));
  child = env.open("child"); memory = createTurnMemory({ store: child });
  const recalled = memory.recall({ query: "陈姨箱子", viewerId: "p" });
  assert.equal(recalled.results.some((row) => row.experience.id === "box-claim"), false);
  assert.equal(recalled.results.find((row) => row.experience.id === "corrected-box").source.adventureId, "child");
  assert.doesNotMatch(JSON.stringify(recalled), /PRIVATE_NPC_SECRET|PRIVATE_HIDDEN_VISITOR/);
  assert.equal(memory.recall({ query: "箱子", viewerId: "p", revision: 5 }).results.find((row) => row.experience.id === "box-claim").source.adventureId, "parent");
  assert.equal(child.readTurn(3).experiences.find((row) => row.id === "box-claim").kind, "claim");
  assert.throws(() => memory.recall({ query: "箱子", viewerId: "npc" }));
});

test("missing revisions, unregistered empty rows and altered lineage cannot masquerade as inherited history", (t) => {
  const env = fixture(t); env.seed(); env.fork();
  const corruptions = [
    "DELETE FROM turns WHERE revision=3",
    "DELETE FROM turns WHERE revision=6",
    "DROP TABLE session_lineage",
    "UPDATE turns SET action_id=NULL WHERE revision=3",
    "UPDATE actions SET status='cancelled' WHERE revision=3",
    "UPDATE turns SET events_json='[]' WHERE revision=6",
    "UPDATE turns SET state_json=json_set(state_json,'$.situation.day',999) WHERE revision=6",
    "UPDATE session_lineage SET parent_adventure_id='wrong'",
    "UPDATE session_lineage SET content_version='wrong'",
    "UPDATE session_lineage SET parent_archive_json=json_set(parent_archive_json,'$.confirmationActionId','invented')",
    "UPDATE turns SET narration_json='{}' WHERE revision=4",
  ];
  for (const [index, sql] of corruptions.entries()) {
    const filename = path.join(env.root, `bad-${index}.sqlite`); fs.copyFileSync(env.databasePath("child"), filename);
    const db = new DatabaseSync(filename);
    try {
      db.exec("PRAGMA foreign_keys=OFF"); db.exec(sql);
      const before = digest(filename);
      assert.throws(() => readSessionTimeline(db, { adventureId: "child", revision: 6 }), { code: "SESSION_LINEAGE_INVALID" }, sql);
      assert.equal(digest(filename), before);
    } finally { db.close(); }
  }
});

test("boundary write failure rolls back identity, archive and all new rows; model output cannot create a boundary", (t) => {
  const env = fixture(t); env.seed();
  fs.copyFileSync(env.databasePath("parent"), env.databasePath("child"));
  const db = new DatabaseSync(env.databasePath("child"));
  try {
    db.exec("CREATE TRIGGER fail_boundary BEFORE INSERT ON turns WHEN NEW.revision=6 BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    assert.throws(() => appendContinuationBoundary(db, { parentAdventureId: "parent", childAdventureId: "child", parentRevision: 5,
      sourceFinaleId: "finale-5", requestId: "fork", createdAt: "2026-09-10T12:00:00Z" }));
    assert.equal(db.prepare("SELECT adventure_id FROM session").get().adventure_id, "parent");
    assert.equal(db.prepare("SELECT max(revision) AS r FROM turns").get().r, 5);
    assert.equal(db.prepare("SELECT status FROM finale_archives").get().status, "closed");
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_lineage'").get(), undefined);
  } finally { db.close(); }
  fs.unlinkSync(env.databasePath("child")); env.fork();
  const child = env.open("child");
  assert.throws(() => env.commit(child, "child", bundle("continuation.start", { parentAdventureId: "parent" })), { code: "TURN_VALIDATION_FAILED" });
  assert.equal(child.readView().revision, 6);
});

test("a malformed or repeated fork request cannot change an existing child identity", (t) => {
  const env = fixture(t); env.seed(); const { options } = env.fork();
  const db = new DatabaseSync(env.databasePath("child")); let invoked = 0;
  try {
    const hostile = { ...options }; Object.defineProperty(hostile, "childAdventureId", { enumerable: true, get() { invoked++; return "elsewhere"; } });
    for (const input of [hostile, { ...options, childAdventureId: "other" }, { ...options, extra: true }, { ...options, title: "different" }]) {
      assert.throws(() => appendContinuationBoundary(db, input), { code: "SESSION_LINEAGE_INPUT_INVALID" });
    }
    assert.equal(invoked, 0);
    assert.equal(db.prepare("SELECT adventure_id FROM session").get().adventure_id, "child");
    assert.equal(db.prepare("SELECT count(*) AS n FROM session_lineage").get().n, 1);
  } finally { db.close(); }
});

test("an unfinished parent and both closed extreme outcomes cannot create a continuation boundary", (t) => {
  const env = fixture(t);
  for (const [adventureId, draw] of [["unfinished", null], ["extreme-grey", 0], ["extreme-standard", 9999]]) {
    const store = env.open(adventureId, samples.initialState(), draw === null ? {} : { terminalRandomInt: () => draw });
    if (draw === null) {
      env.commit(store, adventureId, bundle(null, null));
    } else {
      env.commit(store, adventureId, bundle("extreme.propose", { candidateId: "extreme", characterId: "p",
        intentReason: "虚构角色明确提出这个选择。", fictionalContext: "仅合成故事中的角色处境。" }));
      for (let index = 0; index < 2; index++) env.commit(store, adventureId, bundle("extreme.confirm", { candidateId: "extreme" }));
      const action = store.beginAction(samples.request({ actionId: "third-confirm", baseRevision: 3 }));
      store.reserveTerminal({ actionId: action.actionId, attemptId: action.attemptId, candidateId: "extreme" });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle("extreme.confirm", { candidateId: "extreme" }) });
      const job = store.beginChapter({ targetRevision: 4 });
      store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: {
        title: "回望", summary: "这段合成故事已经结束。", keyEvents: [{ text: "最后的回应。", sources: [{ revision: 4, segmentId: "s" }] }],
        openThreads: [], mode: "excerpt", fallbackReason: "CHAPTER_MODEL_UNAVAILABLE",
      } });
      store.sealFinale({ finaleId: "finale-4", chapterId: job.chapterId });
    }
    const revision = store.readView().revision;
    store.close();
    const filename = env.databasePath(adventureId);
    const before = digest(filename);
    const db = new DatabaseSync(filename);
    try {
      assert.throws(() => appendContinuationBoundary(db, { parentAdventureId: adventureId, childAdventureId: "forbidden-child",
        parentRevision: revision, sourceFinaleId: `finale-${revision}`, requestId: "forbidden-fork", createdAt: "2026-09-10T12:00:00Z" }),
      { code: draw === null ? "ADVENTURE_CONTINUATION_PARENT_NOT_CLOSED" : "ADVENTURE_CONTINUATION_FORBIDDEN" });
      assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='session_lineage'").get(), undefined);
      assert.equal(db.prepare("SELECT adventure_id FROM session").get().adventure_id, adventureId);
    } finally { db.close(); }
    assert.equal(digest(filename), before);
  }
});
