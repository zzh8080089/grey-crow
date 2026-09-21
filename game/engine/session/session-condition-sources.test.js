"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { createTurnStore } = require("./turn-store");
const { createOpeningState } = require("./session-opening");
const { conditionRecordId } = require("./session-character-conditions");
const { validateConditionSources } = require("./session-condition-sources");
const { readSessionTimeline } = require("./session-lineage");
const { initialState } = require("./test-fixtures/turn-samples");

const SOURCE_ERROR = { code: "CHARACTER_CONDITION_SOURCE_INVALID" };
const observed = "左臂仍酸痛，手指没有麻木。";
function change(type = "add", options = {}) {
  const { characterId = "p", text = observed, quote = text, recordId, basis = "observed", reason = "resolved" } = options;
  return { id: "body-change", type: `condition.${type}`, sourceSegmentIds: ["body"], data: { characterId,
    ...(type === "remove" ? { recordId, reason } : { basis, text, ...(recordId ? { recordId } : {}) }),
    evidence: [{ segmentId: "body", quote }] } };
}
function wholeChange(type = "add", options = {}) {
  const event = change(type, options);
  delete event.data.evidence;
  return event;
}
function bundle(event = change(), narration = [{ id: "body", text: observed }]) {
  return { narration, events: event ? [event] : [], experiences: [] };
}
async function fixture(t, options = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-condition-source-")));
  const identity = { databasePath: path.join(root, "session.sqlite"), adventureId: "conditions", locale: "zh-CN", contentVersion: "test-v1" };
  const stores = [];
  const open = (extra = {}) => { const store = createTurnStore({ ...identity, ...extra }); stores.push(store); return store; };
  t.after(async () => { stores.forEach(store => store.close()); await fs.rm(root, { recursive: true, force: true }); });
  return { identity, open, store: open({ initialState: initialState(), ...options }) };
}
function commit(store, identity, value, actionId) {
  const baseRevision = store.readView().revision;
  const request = { actionId: actionId || `action-${baseRevision + 1}`, baseRevision, input: "我留意现在的身体情况。",
    locale: identity.locale, contentVersion: identity.contentVersion };
  const action = store.beginAction(request);
  return store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: value });
}
function edit(identity, operation) {
  const db = new DatabaseSync(identity.databasePath);
  try { operation(db); } finally { db.close(); }
}
function mutateState(db, revision, operation) {
  const state = JSON.parse(db.prepare("SELECT state_json FROM turns WHERE revision=?").get(revision).state_json);
  operation(state);
  db.prepare("UPDATE turns SET state_json=? WHERE revision=?").run(JSON.stringify(state), revision);
}

test("whole paragraphs and legacy excerpts share a persistent replacement chain without rewriting prior evidence", async t => {
  const { store, identity, open } = await fixture(t);
  const originalNarration = [{ id: "body", text: `她说：${observed} 原因还不清楚。` }];
  const first = commit(store, identity, bundle(change("add", { basis: "self_report" }), originalNarration))
    .view.state.entities.p.conditionRecords.items[0];
  assert.equal(first.sources[0].start, 3, "legacy source retains its original excerpt coordinates");
  const paragraphs = [{ id: "body", text: '她说："疼痛比刚才轻了。"\n🪶' },
    { id: "qualification", text: "但负重时仍疼；还没试过搬东西。" }];
  const update = wholeChange("replace", { recordId: first.id, basis: "self_report", text: "疼痛减轻，负重时仍疼" });
  update.sourceSegmentIds = paragraphs.map(segment => segment.id);
  const candidate = bundle(update, paragraphs), before = structuredClone(candidate);
  const second = commit(store, identity, candidate).view.state.entities.p.conditionRecords.items[0];
  assert.deepEqual(candidate, before);
  assert.deepEqual(second.sources, paragraphs.map(segment => ({ adventureId: identity.adventureId,
    revision: 2, segmentId: segment.id, start: 0, end: segment.text.length,
    totalCharacters: segment.text.length, quote: segment.text })));
  assert.deepEqual(second.predecessor, { adventureId: identity.adventureId, revision: 1, recordId: first.id });
  const legacyText = "左臂负重时仍有酸痛。";
  const third = commit(store, identity, bundle(change("replace", { recordId: second.id, basis: "self_report", text: legacyText }),
    [{ id: "body", text: `她补充说：${legacyText} 暂时没有再试。` }])).view.state.entities.p.conditionRecords.items[0];
  assert.ok(third.sources[0].start > 0);
  assert.deepEqual(third.predecessor, { adventureId: identity.adventureId, revision: 2, recordId: second.id });
  store.close();
  const reopened = open();
  assert.deepEqual(reopened.readModelState().entities.p.conditionRecords.items, [third]);
  assert.deepEqual(reopened.readModelState({ revision: 1 }).entities.p.conditionRecords.items, [first]);
  assert.deepEqual(reopened.readModelState({ revision: 2 }).entities.p.conditionRecords.items, [second]);
  const page = reopened.readConditionSource({ revision: 3, entityId: "p", recordId: second.id });
  assert.deepEqual(page.evidenceRanges, second.sources.map(({ segmentId, start, end, totalCharacters }) => ({ segmentId, start, end, totalCharacters })));
  assert.deepEqual(page.passages.filter(passage => passage.kind === "narration").map(passage => passage.text), paragraphs.map(segment => segment.text));
  const resolved = [{ id: "body", text: "她说左臂酸痛已消失。" }];
  commit(reopened, identity, bundle(wholeChange("remove", { recordId: third.id }), resolved));
  assert.deepEqual(open().readModelState().entities.p.conditionRecords.items, []);
  assert.deepEqual(open().readModelState({ revision: 3 }).entities.p.conditionRecords.items, [third]);
  edit(identity, db => {
    const events = JSON.parse(db.prepare("SELECT events_json FROM turns WHERE revision=2").get().events_json);
    assert.deepEqual(events, before.events, "full quote compilation does not modify the original committed event");
    const legacy = JSON.parse(db.prepare("SELECT events_json FROM turns WHERE revision=1").get().events_json);
    assert.equal(legacy[0].data.evidence[0].quote, observed);
  });
});

test("opening without copied quotes preserves both whole proposal paragraphs and attribution after confirmation", async t => {
  const { store, identity, open } = await fixture(t, { initialState: createOpeningState() });
  const paragraphs = [{ id: "body", text: "你说左臂酸痛，但手指没有麻木。" },
    { id: "qualification", text: "你还未尝试搬东西，原因未明；身旁来人的右手有一道浅擦伤。" }];
  const proposal = { id: "proposal", type: "opening.propose", sourceSegmentIds: paragraphs.map(segment => segment.id),
    data: { proposalId: "whole-start", initialState: initialState(), initialConditions: [
      wholeChange("add", { basis: "self_report" }).data,
      wholeChange("add", { characterId: "npc", text: "右手浅擦伤", basis: "observed" }).data,
    ] } };
  commit(store, identity, bundle(proposal, paragraphs));
  const proposed = store.readModelState().opening.proposal.initialState;
  for (const characterId of ["p", "npc"]) {
    const record = proposed.entities[characterId].conditionRecords.items[0];
    assert.deepEqual(record.sources.map(source => source.quote), paragraphs.map(segment => segment.text));
    assert.ok(record.sources.every(source => source.revision === 1 && source.start === 0));
  }
  assert.equal(proposed.entities.p.conditionRecords.items[0].basis, "self_report");
  assert.equal(proposed.entities.npc.conditionRecords.items[0].basis, "observed");
  store.close();
  const reopened = open();
  commit(reopened, identity, bundle({ id: "confirm", type: "opening.confirm", sourceSegmentIds: ["body"], data: { proposalId: "whole-start" } },
    [{ id: "body", text: "你接受了这份开局设定，第一步仍由你选择。" }]));
  for (const characterId of ["p", "npc"]) {
    const original = proposed.entities[characterId].conditionRecords.items[0];
    assert.deepEqual(reopened.readModelState().entities[characterId].conditionRecords.items, [original]);
    const page = reopened.readConditionSource({ revision: 2, entityId: characterId, recordId: original.id });
    assert.deepEqual(page.source, { adventureId: identity.adventureId, revision: 1, actionId: "action-1" });
    assert.deepEqual(page.passages.filter(passage => passage.kind === "narration").map(passage => passage.text), paragraphs.map(segment => segment.text));
  }
  reopened.close();
  assert.deepEqual(open().readModelState().entities, proposed.entities);
});

test("reopened whole-paragraph records reject altered surrounding text and malformed explicit evidence", async t => {
  const { store, identity, open } = await fixture(t);
  const paragraphs = [{ id: "body", text: `她说：${observed} 但还未尝试搬东西。` }];
  const value = bundle(wholeChange("add", { basis: "self_report" }), paragraphs);
  commit(store, identity, value);
  store.close();
  const reopened = open();
  for (const evidence of [null, {}, [], [{ segmentId: "body", quote: "酸痛已经消失" }]]) {
    edit(identity, db => {
      const events = structuredClone(value.events); events[0].data.evidence = evidence;
      db.prepare("UPDATE turns SET events_json=? WHERE revision=1").run(JSON.stringify(events));
    });
    assert.throws(() => reopened.readModelState(), SOURCE_ERROR);
  }
  edit(identity, db => {
    db.prepare("UPDATE turns SET events_json=? WHERE revision=1").run(JSON.stringify(value.events));
    const changed = structuredClone(paragraphs); changed[0].text = changed[0].text.replace("还未尝试", "已经尝试");
    db.prepare("UPDATE turns SET narration_json=? WHERE revision=1").run(JSON.stringify(changed));
  });
  assert.throws(() => reopened.readModelState(), SOURCE_ERROR, "full paragraph proof includes the qualification outside the old short quote");
});

test("condition source pages recover an entire unindexed opening turn, across restart and a later fixed head", async t => {
  const { store, identity, open } = await fixture(t, { initialState: createOpeningState() });
  const input = '我说："左臂酸痛"，没有尝试搬东西。\n🪶'.repeat(1000);
  const narration = [{ id: "body", text: observed + '\n旁边的灯还亮着，"🪶"。'.repeat(1800) },
    { id: "other", text: '你没有尝试搬东西。\n🪶"'.repeat(1100) }];
  const request = { actionId: "opening-long", baseRevision: 0, input, locale: identity.locale, contentVersion: identity.contentVersion };
  const action = store.beginAction(request);
  store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
    bundle: bundle({ id: "proposal", type: "opening.propose", sourceSegmentIds: ["body"],
      data: { proposalId: "start", initialState: initialState(), initialConditions: [change().data] } }, narration) });
  const original = store.readModelState().opening.proposal.initialState.entities.p.conditionRecords.items[0];
  assert.throws(() => store.readConditionSource({ revision: 1, entityId: "p", recordId: original.id }), { code: "CONDITION_RECORD_NOT_AVAILABLE" });
  commit(store, identity, bundle({ id: "confirm", type: "opening.confirm", sourceSegmentIds: ["body"], data: { proposalId: "start" } }));
  const text = "左臂酸痛比刚才轻些，手指仍无麻木。";
  const current = commit(store, identity, bundle(change("replace", { text, recordId: original.id }), [{ id: "body", text }]))
    .view.state.entities.p.conditionRecords.items[0];
  const options = { revision: 3, entityId: "p", recordId: original.id };
  let page = store.readConditionSource(options);
  assert.ok(page.nextCursor);
  const firstPage = structuredClone(page);
  const cursor = page.nextCursor;
  const changedCursor = fields => Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cursor, "base64url")), ...fields })).toString("base64url");
  for (const invalid of ["not-a-cursor", changedCursor({ adventureId: "elsewhere" }), changedCursor({ revision: 2 }),
    changedCursor({ entityId: "npc" }), changedCursor({ sourceHash: "0".repeat(64) }),
    changedCursor({ index: 0, offset: input.indexOf("🪶") + 1 })]) {
    assert.throws(() => store.readConditionSource({ ...options, cursor: invalid }), { code: "CONDITION_SOURCE_CURSOR_INVALID" });
  }
  assert.throws(() => store.readConditionSource({ ...options, recordId: current.id, cursor }), { code: "CONDITION_SOURCE_CURSOR_INVALID" });
  let invoked = false;
  assert.throws(() => store.readConditionSource({ ...options, get cursor() { invoked = true; return cursor; } }), { code: "CONDITION_SOURCE_INPUT_INVALID" });
  assert.equal(invoked, false);
  for (const invalid of [{ ...options, sourceAdventureId: identity.adventureId }, { ...options, revision: undefined },
    { ...options, cursor: null }, { ...options, cursor: "a".repeat(2049) }]) {
    assert.throws(() => store.readConditionSource(invalid), { code: "CONDITION_SOURCE_INPUT_INVALID" });
  }
  assert.throws(() => store.readConditionSource({ ...options, revision: 99 }), { code: "VIEW_REVISION_UNAVAILABLE" });
  store.close();
  const reopened = open();
  assert.deepEqual(reopened.readConditionSource(options), firstPage);
  commit(reopened, identity, bundle(null, [{ id: "body", text: "你继续等待，没有新的身体变化。" }]));
  assert.throws(() => reopened.readConditionSource({ ...options, revision: 4, cursor }), { code: "CONDITION_SOURCE_CURSOR_INVALID" });
  const before = await fs.readFile(identity.databasePath);
  const expected = [{ kind: "player_input", text: input }, ...narration.map(({ id, text }) => ({ kind: "narration", segmentId: id, text }))];
  const actual = expected.map(() => "");
  let index = 0, pages = 0;
  do {
    assert.ok(JSON.stringify(page).length <= 12000);
    assert.ok(page.passages.length > 0 && page.passages.every(passage => passage.text.length > 0));
    assert.deepEqual(page.source, { adventureId: identity.adventureId, revision: 1, actionId: request.actionId });
    assert.equal(page.revision, 3);
    assert.deepEqual(page.record, { id: original.id, characterId: "p", basis: original.basis, text: original.text });
    assert.deepEqual(page.evidenceRanges, [{ segmentId: "body", start: 0, end: observed.length, totalCharacters: narration[0].text.length }]);
    assert.deepEqual(Object.keys(page).sort(), ["revision", "entityId", "record", "source", "evidenceRanges", "passages", "nextCursor"].sort());
    for (const passage of page.passages) {
      assert.equal(passage.kind, expected[index].kind);
      assert.equal(passage.segmentId, expected[index].segmentId);
      assert.equal(passage.totalCharacters, expected[index].text.length);
      assert.equal(passage.start, actual[index].length);
      assert.equal(passage.end, passage.start + passage.text.length);
      assert.equal(passage.text, expected[index].text.slice(passage.start, passage.end));
      assert.equal(passage.text.isWellFormed(), true);
      actual[index] += passage.text;
      if (passage.end === passage.totalCharacters) index++;
    }
    pages++;
    page = page.nextCursor === null ? null : reopened.readConditionSource({ ...options, cursor: page.nextCursor });
    assert.ok(pages < 30, "every page advances through the finite source");
  } while (page);
  assert.ok(pages > 5);
  assert.deepEqual(actual, expected.map(value => value.text));
  edit(identity, db => assert.equal(db.prepare("SELECT count(*) AS n FROM experiences").get().n, 0));
  assert.deepEqual(await fs.readFile(identity.databasePath), before, "source reads do not change the database");
});

test("condition source access is limited to a currently visible character's reachable records", async t => {
  const { store, identity } = await fixture(t);
  const first = commit(store, identity, bundle()).view.state.entities.p.conditionRecords.items[0];
  const npc = commit(store, identity, bundle(change("add", { characterId: "npc" }))).view.state.entities.npc.conditionRecords.items[0];
  commit(store, identity, bundle(change("add", { characterId: "secret" })));
  const hidden = store.readModelState().entities.secret.conditionRecords.items[0];
  const options = { revision: 3, entityId: "p", recordId: first.id };
  for (const invalid of [{ ...options, recordId: npc.id }, { ...options, recordId: "unrelated-record" },
    { ...options, entityId: "rice" }, { ...options, entityId: "secret", recordId: hidden.id }]) {
    assert.throws(() => store.readConditionSource(invalid), { code: "CONDITION_RECORD_NOT_AVAILABLE" });
  }
  const removedText = "你再次检查，左臂已不酸痛。";
  commit(store, identity, bundle(change("remove", { recordId: first.id, quote: removedText }), [{ id: "body", text: removedText }]));
  assert.throws(() => store.readConditionSource({ ...options, revision: 4 }), { code: "CONDITION_RECORD_NOT_AVAILABLE" });
  assert.equal(store.readConditionSource(options).source.revision, 1, "later removal does not alter a fixed earlier view");
  commit(store, identity, bundle({ id: "hide", type: "entity.update", sourceSegmentIds: ["body"],
    data: { id: "npc", visibility: "hidden" } }));
  assert.throws(() => store.readConditionSource({ revision: 5, entityId: "npc", recordId: npc.id }), { code: "CONDITION_RECORD_NOT_AVAILABLE" });
  assert.equal(store.readConditionSource({ revision: 4, entityId: "npc", recordId: npc.id }).source.revision, 2);
});

test("source reads reject changed evidence and cursors reject changed unquoted creation text", async t => {
  const { store, identity } = await fixture(t);
  const narration = [{ id: "body", text: observed + "甲".repeat(20000) }];
  const record = commit(store, identity, bundle(change(), narration)).view.state.entities.p.conditionRecords.items[0];
  const options = { revision: 1, entityId: "p", recordId: record.id };
  const { nextCursor } = store.readConditionSource(options);
  assert.ok(nextCursor);
  edit(identity, db => {
    const changed = structuredClone(narration); changed[0].text = observed + "乙".repeat(20000);
    db.prepare("UPDATE turns SET narration_json=? WHERE revision=1").run(JSON.stringify(changed));
  });
  assert.throws(() => store.readConditionSource({ ...options, cursor: nextCursor }), { code: "CONDITION_SOURCE_CURSOR_INVALID" });
  edit(identity, db => db.prepare("UPDATE turns SET narration_json=? WHERE revision=1").run(JSON.stringify([{ id: "body", text: "证据被改动。" }])));
  assert.throws(() => store.readConditionSource(options), SOURCE_ERROR);
});

test("conditions preserve exact current quotes, fixed versions and predecessor sources across reopen", async t => {
  const { store, identity, open } = await fixture(t);
  const first = commit(store, identity, bundle()).view.state.entities.p.conditionRecords.items[0];
  assert.deepEqual(first.sources, [{ adventureId: identity.adventureId, revision: 1, segmentId: "body",
    start: 0, end: observed.length, totalCharacters: observed.length, quote: observed }]);
  const nextText = "左臂比刚才缓解些，手指仍没有麻木。";
  const second = commit(store, identity, bundle(change("replace", { text: nextText, recordId: first.id }),
    [{ id: "body", text: nextText }])).view.state.entities.p.conditionRecords.items[0];
  assert.deepEqual(second.predecessor, { adventureId: identity.adventureId, revision: 1, recordId: first.id });
  assert.equal(second.sources[0].revision, 2);
  assert.deepEqual(store.readModelState({ revision: 1 }).entities.p.conditionRecords.items, [first]);
  store.close();
  const reopened = open();
  assert.deepEqual(reopened.readModelState().entities.p.conditionRecords.items, [second]);
  assert.deepEqual(reopened.readPlayerState().state.entities.p.conditionRecords.items, [second]);
  assert.deepEqual(reopened.readTurn(1).narration, [{ id: "body", text: observed }]);
});

test("hidden characters keep their private condition sources and self-report attribution", async t => {
  const { store, identity, open } = await fixture(t);
  commit(store, identity, bundle(change("add", { characterId: "secret", text: "自觉头晕。", quote: "我觉得头晕。", basis: "self_report" }),
    [{ id: "body", text: "来人说：我觉得头晕。" }]));
  store.close();
  const reopened = open();
  assert.equal(reopened.readModelState().entities.secret.conditionRecords.items[0].basis, "self_report");
  assert.equal(reopened.readPlayerState().state.entities.secret, undefined);
  assert.equal(reopened.readView().state.entities.secret, undefined);
});

test("a source failure after the inserted turn and committed action rolls back the entire transaction", async t => {
  const { store, identity } = await fixture(t);
  edit(identity, db => db.exec(`CREATE TRIGGER corrupt_condition_narration AFTER INSERT ON turns WHEN NEW.revision=1 BEGIN
    UPDATE turns SET narration_json='[{"id":"body","text":"只是远处的脚步声。"}]' WHERE revision=NEW.revision; END;`));
  const action = store.beginAction({ actionId: "same-action", baseRevision: 0, input: "查看手臂。", locale: identity.locale, contentVersion: identity.contentVersion });
  assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle() }), SOURCE_ERROR);
  assert.equal(store.readView().revision, 0);
  assert.equal(store.readAction(action.actionId).status, "running");
  edit(identity, db => {
    assert.equal(db.prepare("SELECT count(*) AS n FROM turns").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM experiences").get().n, 0);
    db.exec("DROP TRIGGER corrupt_condition_narration");
  });
  const success = store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle() });
  const duplicate = store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: null });
  assert.equal(success.revision, 1);
  assert.deepEqual(duplicate.view, success.view);
});

test("cancelled or failed attempts cannot half-save conditions; retry commits one original action", async t => {
  let shouldFail = true;
  const env = await fixture(t, { faultInjector(stage) { if (shouldFail && stage === "after_action") throw new Error("synthetic crash"); } });
  const request = { actionId: "retry-body", baseRevision: 0, input: "看看左臂。", locale: env.identity.locale, contentVersion: env.identity.contentVersion };
  let action = env.store.beginAction(request);
  assert.throws(() => env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle() }), /synthetic crash/);
  env.store.failAction({ actionId: action.actionId, attemptId: action.attemptId, code: "TURN_GENERATION_FAILED", retryable: true });
  assert.equal(env.store.readView().revision, 0);
  shouldFail = false; env.store.close();
  const reopened = env.open();
  action = reopened.beginAction(request, { retry: true });
  const result = reopened.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle() });
  assert.equal(result.revision, 1);
  assert.equal(result.view.state.entities.p.conditionRecords.items.length, 1);
  const cancelled = reopened.beginAction({ ...request, actionId: "cancel-body", baseRevision: 1 });
  reopened.cancelAction(cancelled.actionId);
  assert.throws(() => reopened.commitAction({ actionId: cancelled.actionId, attemptId: cancelled.attemptId, bundle: bundle() }), { code: "ACTION_NOT_RUNNING" });
  assert.equal(reopened.readView().revision, 1);
});

for (const corrupt of ["quote", "coordinate", "adventure", "text", "predecessor", "event", "narration", "request"]) {
  test(`reopened condition proof rejects tampered ${corrupt}, including a recomputed record hash`, async t => {
    const { store, identity, open } = await fixture(t);
    const first = commit(store, identity, bundle()).view.state.entities.p.conditionRecords.items[0];
    const nextText = "左臂仍酸痛，但比刚才轻些。";
    commit(store, identity, bundle(change("replace", { text: nextText, recordId: first.id }), [{ id: "body", text: nextText }]));
    store.close();
    edit(identity, db => {
      if (corrupt === "event") db.prepare("UPDATE turns SET events_json='[]' WHERE revision=2").run();
      else if (corrupt === "narration") db.prepare("UPDATE turns SET narration_json=? WHERE revision=2")
        .run(JSON.stringify([{ id: "body", text: nextText + nextText }]));
      else if (corrupt === "request") {
        const row = db.prepare("SELECT request_json FROM actions WHERE revision=2").get();
        const request = JSON.parse(row.request_json); request.baseRevision = 0;
        db.prepare("UPDATE actions SET request_json=? WHERE revision=2").run(JSON.stringify(request));
      } else mutateState(db, 2, state => {
        const record = state.entities.p.conditionRecords.items[0];
        if (corrupt === "quote") record.sources[0].quote = "左臂已经恢复正常，无任何不适。";
        if (corrupt === "coordinate") record.sources[0].start = 1;
        if (corrupt === "adventure") record.sources[0].adventureId = "unrelated";
        if (corrupt === "text") record.text = "左臂完全恢复。";
        if (corrupt === "predecessor") record.predecessor.recordId = "not-the-prior-record";
        record.id = conditionRecordId(record);
      });
    });
    const reopened = open();
    for (const read of [() => reopened.readModelState(), () => reopened.readPlayerState(), () => reopened.readView()]) {
      assert.throws(read, SOURCE_ERROR);
    }
    assert.deepEqual(reopened.readModelState({ revision: 1 }).entities.p.conditionRecords.items, [first]);
  });
}

test("the original predecessor proof is rechecked, even when only the replacement remains active", async t => {
  const { store, identity, open } = await fixture(t);
  const first = commit(store, identity, bundle()).view.state.entities.p.conditionRecords.items[0];
  const text = "左臂酸痛减轻，手指仍无麻木。";
  commit(store, identity, bundle(change("replace", { text, recordId: first.id }), [{ id: "body", text }]));
  store.close();
  edit(identity, db => db.prepare("UPDATE turns SET events_json='[]' WHERE revision=1").run());
  assert.throws(() => open().readModelState(), SOURCE_ERROR);
});

test("opening conditions originate in the proposal, survive confirmation, and remain valid predecessors", async t => {
  const { store, identity, open } = await fixture(t, { initialState: createOpeningState() });
  const proposed = commit(store, identity, bundle({ id: "proposal", type: "opening.propose", sourceSegmentIds: ["body"],
    data: { proposalId: "first-scene", initialState: initialState(), initialConditions: [change().data] } })).view;
  assert.deepEqual(proposed.state.entities, {});
  const original = store.readModelState().opening.proposal.initialState.entities.p.conditionRecords.items[0];
  assert.equal(original.sources[0].revision, 1);
  store.close();
  const reopened = open();
  commit(reopened, identity, bundle({ id: "confirm", type: "opening.confirm", sourceSegmentIds: ["body"], data: { proposalId: "first-scene" } },
    [{ id: "body", text: "你确认了身份和身体情况，这段故事开始。" }]));
  assert.deepEqual(reopened.readModelState().entities.p.conditionRecords.items, [original]);
  const text = "左臂酸痛减轻，手指仍无麻木。";
  const next = commit(reopened, identity, bundle(change("replace", { text, recordId: original.id }), [{ id: "body", text }])).view.state.entities.p.conditionRecords.items[0];
  assert.deepEqual(next.predecessor, { adventureId: identity.adventureId, revision: 1, recordId: original.id });
  reopened.close();
  assert.deepEqual(open().readModelState().entities.p.conditionRecords.items, [next]);
});

test("resolved records disappear without a fabricated normal status; original evidence stays readable", async t => {
  const { store, identity, open } = await fixture(t);
  const original = commit(store, identity, bundle()).view.state.entities.p.conditionRecords.items[0];
  const text = "你再次检查，左臂酸痛已消失，手指仍无麻木。";
  commit(store, identity, bundle(change("remove", { recordId: original.id, quote: text }), [{ id: "body", text }]));
  store.close();
  const current = open().readModelState().entities.p;
  assert.deepEqual(current.conditionRecords.items, []);
  assert.equal(current.attributes.status, undefined);
  assert.deepEqual(open().readModelState({ revision: 1 }).entities.p.conditionRecords.items, [original]);
});

test("old states without condition records remain readable without rewriting their legacy attributes", async t => {
  const initial = initialState(); initial.entities.p.attributes = { status: "旧身体描述", fatigue: "旧详细说明" };
  const { store, identity, open } = await fixture(t, { initialState: initial }); store.close();
  const before = await fs.readFile(identity.databasePath);
  const reopened = open();
  assert.deepEqual(reopened.readModelState(), initial);
  assert.deepEqual(reopened.readPlayerState().state.entities.p.attributes, initial.entities.p.attributes);
  reopened.close();
  assert.deepEqual(await fs.readFile(identity.databasePath), before);
});

test("committed action proof is checked independently of a previously obtained timeline", async t => {
  const { store, identity } = await fixture(t);
  commit(store, identity, bundle()); store.close();
  edit(identity, db => {
    const timeline = readSessionTimeline(db, { adventureId: identity.adventureId, revision: 1 });
    const state = JSON.parse(db.prepare("SELECT state_json FROM turns WHERE revision=1").get().state_json);
    db.prepare("UPDATE actions SET status='failed' WHERE revision=1").run();
    assert.throws(() => validateConditionSources(db, state, timeline), SOURCE_ERROR);
  });
});

test("a reopened long replacement chain checks original evidence with linearly bounded source queries", async t => {
  const { store, identity, open } = await fixture(t);
  const length = 120;
  let record = commit(store, identity, bundle()).view.state.entities.p.conditionRecords.items[0];
  for (let revision = 2; revision <= length; revision++) {
    const text = `第${revision}次检查：左臂酸痛减轻，手指仍无麻木。`;
    record = commit(store, identity, bundle(change("replace", { recordId: record.id, text }), [{ id: "body", text }])).view.state.entities.p.conditionRecords.items[0];
  }
  store.close();
  const reopened = open();
  assert.deepEqual(reopened.readModelState().entities.p.conditionRecords.items, [record]);
  reopened.close();
  edit(identity, db => {
    const timeline = readSessionTimeline(db, { adventureId: identity.adventureId, revision: length });
    const state = JSON.parse(db.prepare("SELECT state_json FROM turns WHERE revision=?").get(length).state_json);
    let queries = 0;
    const counted = { prepare(sql) { queries++; return db.prepare(sql); } };
    const started = performance.now();
    validateConditionSources(counted, state, timeline);
    const elapsedMs = performance.now() - started;
    assert.ok(queries <= 3 * length + 1, "proof traversal is linear in distinct predecessor records, not recursive duplication");
    t.diagnostic(JSON.stringify({ chainRecords: length, activeRecords: 1, sourceQueries: queries, elapsedMs }));
    db.prepare("UPDATE turns SET events_json='[]' WHERE revision=1").run();
    assert.throws(() => validateConditionSources(db, state, timeline), SOURCE_ERROR,
      "a distant predecessor remains part of the proof after restart");
  });
});

test("archive and two copied continuations validate original and proposal sources without parent files", async t => {
  const { loadBuiltInContentPack } = require("../content-v2/built-in-pack");
  const { compileContentSnapshot } = require("../content-v2/snapshot-compiler");
  const { readContentSnapshot } = require("../content-v2/snapshot-reader");
  const { makeTreeWritable } = require("../content-v2/snapshot-utils");
  const { createSessionArchiveReader } = require("./session-archive");
  const { createSessionContinuationService } = require("./session-continuation");
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-condition-copy-")));
  const adventuresRoot = path.join(root, "saves"); await fs.mkdir(adventuresRoot);
  const stores = [];
  t.after(async () => { stores.forEach(store => store.close()); await makeTreeWritable(root); await fs.rm(root, { recursive: true, force: true }); });
  const contentRoot = path.resolve(__dirname, "../../content");
  const pack = await loadBuiltInContentPack({ contentRoot });
  await compileContentSnapshot({ adventuresRoot, adventureId: "parent", language: "zh-CN", plan: pack.defaultPlan,
    requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"], resolvePackRoot: id => path.join(contentRoot, "packs", id) });
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId: "parent" });
  const identity = { databasePath: path.join(adventuresRoot, "parent/session.sqlite"), adventureId: "parent", locale: "zh-CN", contentVersion: snapshot.lock.overallHash };
  const open = info => { const store = createTurnStore(info); stores.push(store); return store; };
  const parent = open({ ...identity, initialState: createOpeningState() });
  commit(parent, identity, bundle({ id: "proposal", type: "opening.propose", sourceSegmentIds: ["body"],
    data: { proposalId: "start", initialState: initialState(), initialConditions: [change().data] } }));
  commit(parent, identity, bundle({ id: "confirmed", type: "opening.confirm", sourceSegmentIds: ["body"], data: { proposalId: "start" } }, [{ id: "body", text: "你确认，开始这段故事。" }]));
  const original = parent.readModelState().entities.p.conditionRecords.items[0];
  function closeStory(store, info) {
    commit(store, info, bundle({ id: "propose-end", type: "finale.propose", sourceSegmentIds: ["body"], data: { candidateId: "end",
      closureReason: "本阶段结束", closedThreads: ["已作出阶段选择"], intentionalOpenThreads: [], finaleTone: "平静" } }, [{ id: "body", text: "这一段可以暂告结束，你愿意吗？" }]));
    const result = commit(store, info, bundle({ id: "confirm-end", type: "finale.confirm", sourceSegmentIds: ["body"], data: { candidateId: "end" } }, [{ id: "body", text: "你确认结束本篇。" }]));
    const chapter = store.beginChapter({ targetRevision: result.revision });
    store.commitChapter({ chapterId: chapter.chapterId, attemptId: chapter.attemptId, chapter: { title: "本篇", summary: "阶段结束，身体状况没有在此自动消失。",
      keyEvents: [{ text: "结束本篇", sources: [{ revision: result.revision, segmentId: "body" }] }], openThreads: [], mode: "model" } });
    store.sealFinale({ finaleId: `finale-${result.revision}`, chapterId: chapter.chapterId }); store.close();
    return result.revision;
  }
  const parentRevision = closeStory(parent, identity);
  const before = createHash("sha256").update(await fs.readFile(identity.databasePath)).digest("hex");
  const reader = createSessionArchiveReader({ adventuresRoot });
  for (const displayLocale of ["zh-CN", "en-US", "ja-JP"]) {
    const opened = await reader.open({ adventureId: identity.adventureId, displayLocale });
    assert.equal(opened.archive.read_only, true);
  }
  const service = createSessionContinuationService({ adventuresRoot });
  const child = await service.fork({ requestId: "child", parentAdventureId: "parent", parentRevision, sourceFinaleId: `finale-${parentRevision}` });
  const childIdentity = { ...identity, adventureId: child.childAdventureId, databasePath: path.join(adventuresRoot, child.childAdventureId, "session.sqlite") };
  const childStore = open(childIdentity);
  assert.deepEqual(childStore.readModelState().entities.p.conditionRecords.items, [original]);
  const text = "左臂酸痛减轻，手指仍没有麻木。";
  const next = commit(childStore, childIdentity, bundle(wholeChange("replace", { recordId: original.id, text }), [{ id: "body", text }])).view.state.entities.p.conditionRecords.items[0];
  assert.equal(next.sources[0].adventureId, child.childAdventureId);
  assert.deepEqual(next.predecessor, { adventureId: "parent", revision: 1, recordId: original.id });
  const childRevision = closeStory(childStore, childIdentity);
  const grandchild = await service.fork({ requestId: "grandchild", parentAdventureId: child.childAdventureId, parentRevision: childRevision, sourceFinaleId: `finale-${childRevision}` });
  assert.equal(createHash("sha256").update(await fs.readFile(identity.databasePath)).digest("hex"), before);
  await makeTreeWritable(path.dirname(identity.databasePath)); await fs.rm(path.dirname(identity.databasePath), { recursive: true });
  await makeTreeWritable(path.dirname(childIdentity.databasePath)); await fs.rm(path.dirname(childIdentity.databasePath), { recursive: true });
  const finalIdentity = { ...identity, adventureId: grandchild.childAdventureId, databasePath: path.join(adventuresRoot, grandchild.childAdventureId, "session.sqlite") };
  const finalStore = open(finalIdentity);
  assert.deepEqual(finalStore.readModelState().entities.p.conditionRecords.items, [next]);
  assert.deepEqual(finalStore.readModelState({ revision: 1 }).opening.proposal.initialState.entities.p.conditionRecords.items, [original]);
  const finalRevision = finalStore.readView().revision;
  const ancestorSource = finalStore.readConditionSource({ revision: finalRevision, entityId: "p", recordId: original.id });
  assert.deepEqual(ancestorSource.source, { adventureId: "parent", revision: 1, actionId: "action-1" });
  assert.equal(ancestorSource.passages.find(passage => passage.kind === "narration").text, observed);
  const childSource = finalStore.readConditionSource({ revision: finalRevision, entityId: "p", recordId: next.id });
  assert.equal(childSource.source.adventureId, child.childAdventureId);
  assert.equal(childSource.source.revision, next.sources[0].revision);
  assert.deepEqual(childSource.record.predecessor, { adventureId: "parent", revision: 1, recordId: original.id });
  assert.equal(childSource.passages.find(passage => passage.kind === "narration").text, text);
  assert.equal(ancestorSource.nextCursor, null);
  closeStory(finalStore, finalIdentity);
  await reader.open({ adventureId: finalIdentity.adventureId });
  edit(finalIdentity, db => db.prepare("UPDATE turns SET events_json='[]' WHERE revision=1").run());
  const corrupted = open(finalIdentity);
  assert.throws(() => corrupted.readConditionSource({ revision: finalRevision, entityId: "p", recordId: original.id }), SOURCE_ERROR);
  corrupted.close();
  await assert.rejects(reader.open({ adventureId: finalIdentity.adventureId }), SOURCE_ERROR);
  await assert.rejects(service.fork({ requestId: "grandchild", parentAdventureId: child.childAdventureId,
    parentRevision: childRevision, sourceFinaleId: `finale-${childRevision}` }), SOURCE_ERROR,
  "an existing-copy receipt must not claim success when its inherited body proof is unreadable");
});
