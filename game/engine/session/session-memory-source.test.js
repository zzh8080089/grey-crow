"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { createTurnStore } = require("./turn-store");
const { createStorySourceReader } = require("./session-memory-source");
const { readSessionTimeline } = require("./session-lineage");
const samples = require("./test-fixtures/turn-samples");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-story-source-"));
  const databasePath = path.join(directory, "session.sqlite");
  const identity = samples.identity(databasePath);
  const store = createTurnStore({ ...identity, initialState: samples.initialState() });
  const handles = [];
  const statements = [];
  function open(overrides = {}) {
    const db = new DatabaseSync(databasePath, { readOnly: true }); handles.push(db);
    const reader = createStorySourceReader({ ...identity,
      db: { prepare(sql) { statements.push(sql); return db.prepare(sql); } },
      snapshot(revision) {
        const target = revision ?? db.prepare("SELECT revision FROM session WHERE singleton=1").get().revision;
        const row = db.prepare("SELECT revision,state_json FROM turns WHERE revision=?").get(target);
        if (!row) throw Object.assign(new Error("VIEW_REVISION_UNAVAILABLE"), { code: "VIEW_REVISION_UNAVAILABLE" });
        return row;
      },
      timelineAt: revision => readSessionTimeline(db, { adventureId: identity.adventureId, revision }), ...overrides });
    return { read: reader.listUnindexedStoryRecords, db };
  }
  function commit(bundle, input = "我留意楼道里的情况。") {
    const baseRevision = store.readPlayerState().revision;
    const action = store.beginAction(samples.request({ actionId: `source-${baseRevision + 1}`, baseRevision, input }));
    return store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
  }
  function mutate(callback) {
    const db = new DatabaseSync(databasePath);
    try { callback(db); } finally { db.close(); }
  }
  t.after(() => { for (const db of handles) db.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, commit, open, mutate, statements, databasePath, identity };
}

function story(text = "陈姨说归还的米放在窗边的小凳上。", experiences = [], extra = {}) {
  return { narration: [{ id: "indexed", text: "陈姨解释了先前的安排。" }, { id: "unindexed", text }],
    events: [], experiences, ...extra };
}
function experience(id = "record", options = {}) {
  return { id, kind: "claim", knownBy: ["p"], entityIds: ["npc"], eventIds: [], sourceSegmentIds: ["indexed"], ...options };
}
function hash(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

test("unindexed prose and matching player input survive a cold read without inventing an experience", (t) => {
  const env = fixture(t);
  const input = "我问归还时放在哪里，先不动她的东西。";
  env.commit(story(), input);
  env.commit(story("只剩这一段没有经历引用。", [experience()]));
  env.commit(story("所有正文都已有记录。", [experience("all", { sourceSegmentIds: ["indexed", "unindexed"] })]));
  env.store.close();
  const before = hash(env.databasePath);
  for (let round = 0; round < 2; round++) {
    const { read } = env.open();
    const page = read({ revision: 3, viewerId: "p" });
    assert.equal(page.revision, 3); assert.equal(page.scannedRecords, 2); assert.equal(page.nextCursor, null);
    assert.deepEqual(page.records.map(record => record.revision), [1, 2]);
    assert.deepEqual(page.records[0], { adventureId: "test-adventure", revision: 1, actionId: "source-1",
      source: { adventureId: "test-adventure", revision: 1 }, passages: story().narration,
      playerInput: input, recordType: "story_source" });
    assert.deepEqual(page.records[1].passages, [{ id: "unindexed", text: "只剩这一段没有经历引用。" }]);
    assert.ok(page.records.every(record => !Object.hasOwn(record, "experience")));
  }
  assert.equal(hash(env.databasePath), before);
  assert.ok(env.statements.every(sql => !/SELECT\s+\*/i.test(sql)), "candidate reads must not fetch full state snapshots");
});

test("any inaccessible or superseded experience blocks the mixed turn including its unindexed input", (t) => {
  const env = fixture(t);
  env.commit(story("private-extra", [experience("private", { knownBy: ["npc"] })]), "PRIVATE_INPUT");
  env.commit(story("hidden-extra", [experience("hidden", { entityIds: ["secret"] })]), "HIDDEN_INPUT");
  env.commit(story("old-extra", [experience("old")]), "OLD_INPUT");
  env.commit(story("private correction", [experience("private-fix", { knownBy: ["npc"], sourceSegmentIds: ["indexed", "unindexed"],
    supersedes: [{ revision: 3, experienceId: "old" }] })]));
  env.commit(story("hidden correction", [experience("hidden-fix", { entityIds: ["secret"], sourceSegmentIds: ["indexed", "unindexed"],
    supersedes: [{ revision: 3, experienceId: "old" }] })]));
  const { read } = env.open();
  assert.deepEqual(read({ revision: 5, viewerId: "p" }).records.map(record => record.revision), [3]);
  env.commit(story("public correction", [experience("public-fix", { sourceSegmentIds: ["indexed", "unindexed"],
    supersedes: [{ revision: 3, experienceId: "old" }] })]));
  const blocked = read({ revision: 6, viewerId: "p", beforeRevision: 4 });
  assert.equal(blocked.scannedRecords, 3); assert.deepEqual(blocked.records, []);
  assert.doesNotMatch(JSON.stringify(blocked), /PRIVATE_INPUT|HIDDEN_INPUT|OLD_INPUT|extra/);
  assert.deepEqual(read({ revision: 5, viewerId: "p" }).records.map(record => record.revision), [3], "future correction cannot rewrite a fixed historical view");
  env.commit(story("访客来到门前。", [], { events: [{ id: "reveal", type: "entity.update", sourceSegmentIds: ["unindexed"],
    data: { id: "secret", visibility: "player" } }] }));
  assert.deepEqual(read({ revision: 7, viewerId: "p", beforeRevision: 4 }).records.map(record => record.revision), [2]);
});

test("source bounds apply before the candidate limit and empty permission pages advance", (t) => {
  const env = fixture(t);
  for (let index = 1; index <= 8; index++) env.commit(story(`source-${index}`, index % 2 ? [experience(`hidden-${index}`, { knownBy: ["npc"] })] : []));
  const { read } = env.open();
  const first = read({ revision: 8, viewerId: "p", afterRevision: 4, beforeRevision: 8, limit: 1 });
  assert.deepEqual(first, { revision: 8, records: [], scannedRecords: 1, nextCursor: 5 });
  const second = read({ revision: 8, viewerId: "p", afterRevision: 4, beforeRevision: 8, cursor: first.nextCursor, limit: 1 });
  assert.equal(second.records[0].revision, 6); assert.equal(second.nextCursor, 6);
  const last = read({ revision: 8, viewerId: "p", afterRevision: 4, beforeRevision: 8, cursor: second.nextCursor, limit: 1 });
  assert.deepEqual(last, { revision: 8, records: [], scannedRecords: 1, nextCursor: null });
  env.commit(story("future prose"));
  assert.deepEqual(read({ revision: 8, viewerId: "p", afterRevision: 7 }).records.map(record => record.revision), [8]);
  assert.equal(read({ revision: 8, viewerId: "p", afterRevision: 8 }).scannedRecords, 0);
});

test("fully indexed turns do not consume the raw source candidate budget", (t) => {
  const env = fixture(t);
  for (let index = 0; index < 9; index++) env.commit(story("already indexed", [experience(`full-${index}`, { sourceSegmentIds: ["indexed", "unindexed"] })]));
  env.commit(story("last unindexed source"));
  const page = env.open().read({ revision: 10, viewerId: "p", limit: 1 });
  assert.equal(page.scannedRecords, 1); assert.equal(page.records[0].revision, 10); assert.equal(page.nextCursor, null);
});

test("only ready opening sources are eligible, and system revisions are never passages", (t) => {
  const env = fixture(t);
  for (let index = 0; index < 4; index++) env.commit(story(`opening-${index}`));
  env.mutate(db => {
    for (const [revision, opening] of [[1, { phase: "proposal" }], [2, { phase: "summary" }], [3, { phase: "ready" }]]) {
      db.prepare("UPDATE turns SET state_json=json_set(state_json,'$.opening',json(?)) WHERE revision=?").run(JSON.stringify(opening), revision);
    }
    db.prepare("INSERT INTO turns SELECT 5,NULL,'[]','[]',state_json FROM turns WHERE revision=4").run();
    db.prepare("UPDATE session SET revision=5").run();
  });
  // The injected timeline isolates the source-reader boundary; this fixture is
  // not a complete continuation archive. Real lineage validation lives there.
  const { read } = env.open({ timelineAt: revision => ({ adventureId: "test-adventure", revision, systemRevisions: [5],
    lineage: [{ parentAdventureId: "parent-adventure", boundaryRevision: 5 }] }) });
  const page = read({ revision: 5, viewerId: "p" });
  assert.equal(page.scannedRecords, 4); assert.deepEqual(page.records.map(record => record.revision), [3, 4]);
  assert.deepEqual(page.records.map(record => record.source), [
    { adventureId: "parent-adventure", revision: 3 }, { adventureId: "parent-adventure", revision: 4 },
  ]);
  assert.ok(page.records.every(record => record.adventureId === "test-adventure"));
});

test("arguments cannot select another viewer, future revision or unbound source fields", (t) => {
  const env = fixture(t); env.commit(story()); const { read } = env.open();
  for (const options of [{ limit: 0 }, { limit: 513 }, { cursor: -1 }, { cursor: 2 }, { beforeRevision: 0 },
    { beforeRevision: 2 }, { afterRevision: 2 }, { afterRevision: 1, beforeRevision: 1 }, { revision: -1 },
    { revision: 0.5 }, { adventureId: "elsewhere" }]) {
    assert.throws(() => read({ revision: 1, viewerId: "p", ...options }), { code: "ACTION_INPUT_INVALID" });
  }
  for (const viewerId of ["npc", "secret", undefined]) assert.throws(() => read({ revision: 1, viewerId }), { code: "MEMORY_VIEWER_INVALID" });
  assert.throws(() => read({ revision: 2, viewerId: "p" }), { code: "VIEW_REVISION_UNAVAILABLE" });
  assert.deepEqual(read({ revision: 0, viewerId: "p" }), { revision: 0, records: [], scannedRecords: 0, nextCursor: null });
});

test("damaged committed source identities fail without delivering mismatched input", async (t) => {
  for (const [field, value] of [["actionId", "another-action"], ["baseRevision", 91], ["locale", "ja-JP"], ["contentVersion", "wrong"], ["input", null]]) {
    await t.test(field, t => {
      const env = fixture(t); env.commit(story());
      env.mutate(db => db.prepare("UPDATE actions SET request_json=json_set(request_json,?,json(?)) WHERE action_id='source-1'").run(`$.${field}`, JSON.stringify(value)));
      assert.throws(() => env.open().read({ revision: 1, viewerId: "p" }), { code: "MEMORY_SOURCE_UNAVAILABLE" });
    });
  }
});
