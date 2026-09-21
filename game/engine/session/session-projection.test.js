"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { projectSessionView, projectSessionPanel, projectSessionHistory, projectSessionChapters, projectSessionFinale } = require("./session-projection");
const { validateContract } = require("../contracts/v2");
const { applyTurnBundle, validateInitialState } = require("./turn-model");
const { emptyConditionRecords, conditionRecordId, validateConditionRecords } = require("./session-character-conditions");

function fixture(language = "zh-CN") {
  const entity = (id, kind, name, attributes = {}, visibility = "player") => ({ id, kind, name, aliases: [], visibility, attributes });
  const narration = [{ id: "s2a", text: "你把两袋米交回陈姨手中。" }, { id: "s2b", text: "她点了点头，这笔约定已经履行。" }];
  return {
    adventureId: "adventure-a", revision: 2, actionId: "action-2", locale: language, contentVersion: "story-v1", narration,
    state: {
      entities: {
        p: entity("p", "character", "玩家", { status: "疲惫", localizedStatus: { "en-US": "Tired", "ja-JP": "疲れている" }, occupation: "护工" }),
        npc: { ...entity("npc", "character", "陈姨", { relationship: "值得信任", description: "住在隔壁的邻居。" }), aliases: ["隔壁邻居"] },
        home: entity("home", "location", "楼道", { localizedNames: { "en-US": "Hallway", "ja-JP": "廊下" } }),
        rice: entity("rice", "item", "袋装米", { condition: "干燥", internal_record_key: "do-not-render-implementation" }),
        secret: entity("secret", "character", "秘密访客", {}, "hidden"),
        hidden_key: entity("hidden_key", "item", "隐藏钥匙", {}, "hidden"),
      },
      inventory: [{ ownerId: "p", itemId: "rice", quantity: 2 }, { ownerId: "npc", itemId: "rice", quantity: 3 }, { ownerId: "p", itemId: "hidden_key", quantity: 1 }],
      commitments: {
        promise: { id: "promise", debtorId: "p", creditorId: "npc", itemId: "rice", quantity: 2, due: "第十一天", status: "fulfilled" },
        hidden: { id: "hidden", debtorId: "p", creditorId: "secret", itemId: "hidden_key", quantity: 1, due: "今晚", status: "open" },
      },
      situation: { playerId: "p", locationId: "home", day: 11 },
    },
    history: [
      { revision: 1, actionId: "action-1", input: "借两袋米。", narration: [{ id: "s1", text: "陈姨递来两袋米，你答应归还。" }] },
      { revision: 2, actionId: "action-2", input: "把米还给陈姨。", narration },
    ],
  };
}

function setConditions(view, entityId, entries) {
  const entity = view.state.entities[entityId];
  const source = view.narration[0];
  entity.conditionRecords = { format: "body-conditions-1", items: entries.map(({ text, basis = "observed" }, index) => {
    const record = { characterId: entityId, basis, text,
      sources: [{ adventureId: view.adventureId, revision: view.revision, segmentId: source.id,
        quote: source.text, start: 0, end: source.text.length, totalCharacters: source.text.length }],
      ...(index === 0 ? { predecessor: { adventureId: view.adventureId, revision: 1, recordId: "private-condition-predecessor" } } : {}) };
    return { id: conditionRecordId(record), ...record };
  }) };
  // These tests exercise display of already-validated records, not whether a
  // source's meaning supports a condition. The store owns the historical proof.
  validateConditionRecords(entity.conditionRecords, { characterId: entityId });
}

function characterDetail(view, entityName, displayLocale = "zh-CN") {
  const list = projectSessionPanel(view, { panelRef: "session_characters", view: "list", fieldId: "characters", displayLocale });
  const item = list.panel.items.find(entry => entry.title === entityName);
  assert(item);
  const detail = projectSessionPanel(view, { panelRef: "session_characters", view: "detail", fieldId: "characters", itemRef: item.ref, displayLocale });
  return { list, item, detail, fields: detail.panel.detail.sections.flatMap(section => section.fields) };
}

test("continuation boundaries preserve formal revisions and source identity without inventing a player turn or speech", () => {
  const view = fixture();
  view.adventureId = "child";
  view.revision = 3;
  view.actionId = null;
  view.narration = [];
  view.timeline = { storyTurnCount: 2, systemRevisions: [3] };
  view.continuation = { requestId: "fork-request", lineageId: "fork-lineage", parentAdventureId: "parent", childAdventureId: "child",
    parentRevision: 2, boundaryRevision: 3, sourceFinaleId: "finale-2", createdAt: "2026-09-10T11:00:00.000Z", title: "楼道 · 续篇",
    parentArchive: { privateReason: "DO_NOT_PROJECT_PARENT_REASON" } };
  view.history = view.history.map((turn) => ({ ...turn, source: { adventureId: "parent", revision: turn.revision }, storyTurn: turn.revision }));
  const result = projectSessionView(view, { delivery: "commit" });
  assert.equal(result.revision, 3);
  assert.equal(result.save.turn, 2);
  assert.equal(result.state_hint.time.turn, 2);
  assert.equal(result.save.title, "楼道 · 续篇");
  assert.deepEqual(result.envelope.segments, []);
  assert.equal(result.envelope.meta.autoSpeak, false);
  const restored = projectSessionView(view);
  assert.equal(restored.history.length, 2);
  assert.deepEqual(restored.history.map((turn) => [turn.source.adventureId, turn.storyTurn, turn.seq]), [["parent", 1, 1], ["parent", 2, 2]]);
  assert.doesNotMatch(JSON.stringify(restored), /DO_NOT_PROJECT_PARENT_REASON|parentArchive/);
  view.revision = 4;
  view.actionId = "child-action";
  view.timeline.storyTurnCount = 3;
  view.narration = [{ id: "child-s", text: "你离开楼道，旧日的约定仍然有效。" }];
  view.history.push({ revision: 4, actionId: "child-action", input: "走出去。", narration: view.narration,
    source: { adventureId: "child", revision: 4 }, storyTurn: 3 });
  const child = projectSessionView(view);
  assert.equal(child.save.turn, 3);
  assert.deepEqual(child.history.map((turn) => turn.revision), [1, 2, 4]);
  assert.equal(child.history[2].seq, 3);
  assert.equal(child.history[2].source.adventureId, "child");
  view.adventureId = "grandchild";
  const inherited = projectSessionView(view);
  assert.equal(inherited.adventureId, "grandchild");
  assert.equal(inherited.continuation.childAdventureId, "child");
  assert.equal(inherited.history[2].source.adventureId, "child");
});

test("projection rejects invalid continuation counts, sources and boundary identities", () => {
  const view = fixture();
  for (const timeline of [{ storyTurnCount: 1, systemRevisions: [] }, { storyTurnCount: 0, systemRevisions: [1, 1] },
    { storyTurnCount: 1, systemRevisions: [3] }]) {
    assert.throws(() => projectSessionView({ ...view, timeline }), { code: "SESSION_PROJECTION_INVALID" });
  }
  assert.throws(() => projectSessionHistory({ ...view, timeline: { storyTurnCount: 1, systemRevisions: [2] }, complete: true }),
    { code: "SESSION_PROJECTION_INVALID" });
  view.history[0].source = { adventureId: "parent", revision: 7 };
  assert.throws(() => projectSessionView(view), { code: "SESSION_PROJECTION_INVALID" });
});

test("commit delivery exposes each narrative segment once and all state consumers share its identity", () => {
  const view = fixture();
  const projected = projectSessionView(view, { delivery: "commit" });
  assert.deepEqual(projected.envelope.segments.map((segment) => segment.content), view.narration.map((segment) => segment.text));
  assert.deepEqual(projected.history, []);
  assert.equal(projected.envelope.meta.autoSpeak, true);
  assert.equal(projected.envelope.error, null);
  assert.equal(projected.state_hint.scene.location_name, "楼道");
  assert.equal(projected.state_hint.player.status, "疲惫");
  assert.deepEqual(projected.state_hint.time, { turn: 2, day: 11 });
  assert.deepEqual(projected.state_hint.inventory, { count: 1 });
  assert.deepEqual(projected.state_hint.active_events, { count: 0 });
  assert.equal(projected.save.turn, 2);
  assert.equal(projected.save.createdAt, null);
  assert.equal(projected.save.updatedAt, null);
  for (const value of [projected, projected.envelope, projected.state_hint, projected.save, projected.panels, projected.characterPanel]) {
    assert.equal(value.adventureId, "adventure-a");
    assert.equal(value.revision, 2);
    assert.equal(value.actionId, "action-2");
  }
  assert.deepEqual(projected.envelope.state_hint, projected.save.state_hint);
  assert.equal(JSON.stringify(projected).includes("秘密访客"), false);
  assert.equal(JSON.stringify(projected).includes("隐藏钥匙"), false);
});

test("recovery supplies committed history only, with explicit speech suppression and stable utterance identities", () => {
  const view = fixture();
  const restored = projectSessionView(view);
  const committed = projectSessionView(view, { delivery: "commit" });
  assert.deepEqual(restored.envelope.segments, []);
  assert.equal(restored.envelope.meta.delivery, "recovery");
  assert.equal(restored.envelope.meta.autoSpeak, false);
  assert.deepEqual(restored.history.map((entry) => entry.player), ["借两袋米。", "把米还给陈姨。"]);
  assert.equal(restored.history[1].host, "你把两袋米交回陈姨手中。\n\n她点了点头，这笔约定已经履行。");
  assert.equal(restored.history.every((entry) => entry.autoSpeak === false), true);
  assert.equal(restored.history[1].utteranceId, committed.envelope.meta.utteranceId);
  assert.deepEqual(projectSessionView(view).history, restored.history);
  assert.throws(() => projectSessionView({ ...view, history: [...view.history, view.history[1]] }));
  const mixed = structuredClone(view);
  mixed.history[1].narration = [{ id: "s2a", text: "不同版本的正文" }, mixed.history[1].narration[1]];
  assert.throws(() => projectSessionView(mixed));
});

test("partial recovery and later history pages preserve a bound snapshot and never claim completion early", () => {
  const view = fixture();
  const cursor = { adventureId: view.adventureId, revision: 2, beforeRevision: 2 };
  const projected = projectSessionView({ ...view, history: [view.history[1]], historyComplete: false, historyNextBeforeRevision: cursor });
  assert.equal(projected.historyComplete, false);
  assert.deepEqual(projected.historyNextBeforeRevision, cursor);
  assert.equal(projected.history.length, 1);
  const older = projectSessionHistory({ adventureId: view.adventureId, revision: 2, history: [view.history[0]], nextBeforeRevision: null, complete: true });
  assert.equal(older.complete, true);
  assert.equal(older.history[0].revision, 1);
  assert.equal(older.history[0].host, view.history[0].narration[0].text);
  assert.equal(older.autoSpeak, false);
  assert.throws(() => projectSessionHistory({ adventureId: view.adventureId, revision: 2, history: [], complete: false,
    nextBeforeRevision: { ...cursor, adventureId: "other-adventure" } }));
});

test("character and inventory descriptors and all three views satisfy the existing desktop panel schemas", () => {
  const view = fixture();
  const projected = projectSessionView(view);
  assert.doesNotThrow(() => validateContract("skill-panel-presentation-v2", { schemaVersion: projected.panels.schemaVersion, panels: projected.panels.panels }));
  assert.doesNotThrow(() => validateContract("skill-panel-presentation-v2", { schemaVersion: projected.panels.schemaVersion, panels: [projected.characterPanel.panel] }));
  for (const [panelRef, fieldId, total] of [[projected.characterPanel.panel.panelRef, "characters", 2], [projected.panels.panels[0].panelRef, "inventory", 1]]) {
    const overview = projectSessionPanel(view, { panelRef, view: "overview" });
    const list = projectSessionPanel(view, { panelRef, view: "list", fieldId });
    const detail = projectSessionPanel(view, { panelRef, view: "detail", fieldId, itemRef: list.panel.items[0].ref });
    assert.equal(list.panel.pagination.totalItems, total);
    for (const result of [overview, list, detail]) {
      assert.doesNotThrow(() => validateContract("skill-panel-view-projection-v1", result.panel));
      assert.equal(result.adventureId, view.adventureId);
      assert.equal(result.revision, view.revision);
      assert.equal(result.actionId, view.actionId);
      assert.equal(JSON.stringify(result).includes("秘密访客"), false);
      assert.equal(JSON.stringify(result).includes("internal_record_key"), false);
    }
    assert.equal(list.panel.items.every((item) => item.updatedTurn === null), true);
    if (fieldId === "inventory") {
      assert.equal(detail.panel.detail.sections[0].fields.find((field) => field.id === "quantity").value, 2);
      assert.equal(detail.panel.detail.sections.find((section) => section.id === "commitments_history").records[0].label, "已履行");
    }
  }
});

test("paging tokens reject another adventure or revision and never concatenate different snapshots", () => {
  const view = fixture();
  const first = projectSessionPanel(view, { panelRef: "session_characters", view: "list", fieldId: "characters", limit: 1 });
  assert.equal(first.panel.pagination.hasMore, true);
  const cursor = first.panel.pagination.nextCursor;
  const second = projectSessionPanel(view, { panelRef: "session_characters", view: "list", fieldId: "characters", limit: 1, cursor });
  assert.notEqual(first.panel.items[0].ref, second.panel.items[0].ref);
  assert.equal(second.panel.pagination.hasMore, false);
  for (const changed of [{ ...view, revision: 3 }, { ...view, adventureId: "another-adventure" }]) {
    assert.throws(() => projectSessionPanel(changed, { panelRef: "session_characters", view: "list", fieldId: "characters", cursor }), { code: "SKILL_PANEL_CURSOR_INVALID" });
  }
  assert.throws(() => projectSessionPanel(view, { panelRef: "session_inventory", view: "detail", fieldId: "inventory", itemRef: first.panel.items[0].ref }), { code: "SKILL_PANEL_ITEM_NOT_FOUND" });
});

function withCommitments(view, count, due = (index) => `约定-${index}`) {
  view.state.commitments = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const id = `promise-${index + 1}`;
    return [id, { id, debtorId: "p", creditorId: "npc", itemId: "rice", quantity: 1,
      due: due(index + 1), status: index === count - 1 ? "open" : "fulfilled" }];
  }));
  validateInitialState(view.state);
  return view;
}

function detailTarget(view, panelRef, displayLocale = "zh-CN") {
  const fieldId = panelRef === "session_characters" ? "characters" : "inventory";
  const list = projectSessionPanel(view, { panelRef, view: "list", fieldId, displayLocale });
  const item = list.panel.items.find((entry) => entry.title === (fieldId === "characters" ? "陈姨" : "袋装米"));
  return { panelRef, fieldId, itemRef: item.ref, displayLocale, view: "detail" };
}

function commitmentRecords(projection) {
  return projection.panel.detail.sections.filter((section) => ["commitments_open", "commitments_history"].includes(section.id))
    .flatMap((section) => section.records);
}

test("当前约定首屏先交付完整身份与期限，长文字和历史交替而不阻塞任何一组", () => {
  const view = withCommitments(fixture(), 25, (index) => index === 25 ? `${"待核实条件。".repeat(600)}尚未同意替代方案。` : `旧期限-${index}`);
  const description = "先前观察尚未确定。".repeat(18000) + "最后限定仍然保留。";
  view.state.entities.npc.attributes.description = description;
  view.state.entities.rice.attributes.description = description;
  const original = structuredClone(view);
  for (const language of ["zh-CN", "en-US", "ja-JP"]) for (const panelRef of ["session_characters", "session_inventory"]) {
    const target = detailTarget(view, panelRef, language);
    const first = projectSessionPanel(view, target);
    assert.equal(first.panel.detail.sections[0].id, "commitments_open", "当前约定不能排在超长属性和24条已履行记录之后");
    const current = first.panel.detail.sections[0];
    assert.equal(current.fields.find((field) => field.id === "record_count").value, 1);
    assert.equal(current.records.length, 1);
    assert.equal(current.records[0].heading, "玩家 → 陈姨 · 袋装米 × 1");
    assert.equal(current.records[0].text, `${{ "zh-CN": "期限", "en-US": "Due", "ja-JP": "期限" }[language]}: ${view.state.commitments["promise-25"].due}`);
    assert.ok(first.panel.detail.sections.find((section) => section.id === "attribute_text").records.length > 0);
    assert.ok(first.panel.detail.sections.find((section) => section.id === "commitments_history").records.length > 0);
    const rows = { commitments_open: [], attribute_text: [], commitments_history: [] };
    const seen = new Set();
    let page = first;
    while (true) {
      assert.deepEqual(page.panel.detail.sections.map((section) => section.id), ["commitments_open", "identity", "attribute_text", "commitments_history"]);
      assert.deepEqual(page.panel.detail.sections.map((section) => section.fields), first.panel.detail.sections.map((section) => section.fields));
      const records = page.panel.detail.sections.flatMap((section) => section.records);
      assert.equal(records.length, page.panel.pagination.returnedItems);
      assert.ok(records.length > 0 && records.length <= 24);
      assert.ok(JSON.stringify(page).length <= 128_000);
      assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 384_000);
      validateContract("skill-panel-view-projection-v1", page.panel);
      for (const section of page.panel.detail.sections) for (const record of section.records) {
        assert.equal(seen.has(record.id), false); seen.add(record.id); rows[section.id].push(record);
      }
      if (!page.panel.pagination.hasMore) break;
      page = projectSessionPanel(view, { ...target, cursor: page.panel.pagination.nextCursor });
    }
    assert.equal(rows.commitments_open.length, 1);
    assert.equal(rows.commitments_history.length, 24);
    rows.commitments_history.forEach((record, index) => assert.ok(record.text.endsWith(view.state.commitments[`promise-${index + 1}`].due)));
    assert.equal(rows.attribute_text.map((record) => record.text).join(""), description);
  }
  assert.deepEqual(view, original);
});

test("约定身份完整容纳三个长名字，超长本地化名回退正式名且heading不扩展其他模块", () => {
  const view = withCommitments(fixture(), 1);
  view.state.entities.p.name = "甲".repeat(512);
  view.state.entities.npc.name = "乙".repeat(512);
  view.state.entities.rice.name = "米".repeat(512);
  view.state.entities.p.attributes.localizedNames = { "en-US": "P".repeat(513) };
  view.state.entities.npc.attributes.localizedNames = { "en-US": "N".repeat(512) };
  validateInitialState(view.state);
  const original = structuredClone(view);
  const list = projectSessionPanel(view, { panelRef: "session_inventory", view: "list", fieldId: "inventory", displayLocale: "en-US" });
  const detail = projectSessionPanel(view, { panelRef: "session_inventory", view: "detail", fieldId: "inventory", itemRef: list.panel.items[0].ref, displayLocale: "en-US" });
  const record = detail.panel.detail.sections[0].records[0];
  assert.equal(record.heading, `${view.state.entities.p.name} → ${"N".repeat(512)} · ${view.state.entities.rice.name} × 1`);
  assert.ok(record.heading.length > 1000 && record.heading.length <= 2000);
  assert.equal(record.text, "Due: 约定-1");
  validateContract("skill-panel-view-projection-v1", detail.panel);
  const tooLong = structuredClone(detail.panel);
  tooLong.detail.sections[0].records[0].heading = "x".repeat(2001);
  assert.throws(() => validateContract("skill-panel-view-projection-v1", tooLong));
  const ordinary = structuredClone(detail.panel);
  Object.assign(ordinary, { panelRef: "ordinary", sourceKind: "ordinary_skill", group: "adventure_gameplay", pagination: null });
  assert.throws(() => validateContract("skill-panel-view-projection-v1", ordinary), "heading is restricted to native character/item detail records");
  delete ordinary.detail.sections[0].records[0].heading;
  validateContract("skill-panel-view-projection-v1", ordinary);
  assert.deepEqual(view, original);
});

test("当前约定跨页仍全部优先，正式履行或取消后才进入历史且旧版详情不变", () => {
  const view = withCommitments(fixture(), 27);
  for (const entry of Object.values(view.state.commitments)) entry.status = "open";
  const target = detailTarget(view, "session_characters");
  const first = projectSessionPanel(view, target);
  assert.equal(first.panel.detail.sections[0].records.length, 24);
  assert.equal(first.panel.detail.sections.some((section) => section.id === "commitments_history"), false);
  const next = projectSessionPanel(view, { ...target, cursor: first.panel.pagination.nextCursor });
  assert.equal(next.panel.detail.sections[0].records.length, 3);
  const prior = structuredClone(first);
  const changed = applyTurnBundle(view.state, {
    narration: [{ id: "settled", text: "你完成了第一笔约定，与陈姨商量后取消了第二笔。" }],
    events: [{ id: "paid", type: "commitment.resolve", sourceSegmentIds: ["settled"], data: { id: "promise-1", status: "fulfilled" } },
      { id: "cancelled", type: "commitment.resolve", sourceSegmentIds: ["settled"], data: { id: "promise-2", status: "cancelled" } }], experiences: [],
  }, { adventureId: view.adventureId, baseRevision: view.revision });
  const later = { ...view, state: changed.state, revision: view.revision + 1, actionId: "settled-action" };
  const laterTarget = detailTarget(later, "session_characters");
  const page1 = projectSessionPanel(later, laterTarget);
  const page2 = projectSessionPanel(later, { ...laterTarget, cursor: page1.panel.pagination.nextCursor });
  assert.equal(page1.panel.detail.sections[0].fields[0].value, 25);
  assert.deepEqual(page2.panel.detail.sections.find((section) => section.id === "commitments_history").records.map((record) => record.label), ["已履行", "已取消"]);
  assert.equal(page1.panel.detail.sections[0].records[0].id, first.panel.detail.sections[0].records[2].id);
  assert.equal(page2.panel.detail.sections.find((section) => section.id === "commitments_history").records[0].id, first.panel.detail.sections[0].records[0].id);
  assert.throws(() => projectSessionPanel(later, { ...laterTarget, cursor: first.panel.pagination.nextCursor }), { code: "SKILL_PANEL_CURSOR_INVALID" });
  assert.deepEqual(projectSessionPanel(view, target), prior);
});

test("完整详情分段保留长描述末尾限定，人物物品三语跨页不重复也不覆盖旧约定", () => {
  const source = `前段观察：${"尚未确定。\n".repeat(1100)}末尾限定：并未确认已经归还。🙂\\\"`;
  const view = withCommitments(fixture(), 25);
  view.state.entities.npc.attributes.description = source;
  view.state.entities.rice.attributes.description = source;
  const original = structuredClone(view);
  for (const language of ["zh-CN", "en-US", "ja-JP"]) for (const panelRef of ["session_characters", "session_inventory"]) {
    const target = detailTarget(view, panelRef, language);
    const pages = [], seen = new Set();
    let cursor;
    do {
      const page = projectSessionPanel(view, { ...target, ...(cursor ? { cursor } : {}) });
      const longText = page.panel.detail.sections.find((section) => section.id === "attribute_text");
      assert.ok(longText, "超长描述必须进入完整分段区，不能仍只保留前2000字");
      const count = longText.fields.find((field) => field.id === "record_count").value;
      assert.equal(page.panel.pagination.totalItems, count + 25);
      assert.deepEqual(page.panel.detail.sections.map((section) => section.id), ["commitments_open", "identity", "attribute_text", "commitments_history"]);
      if (pages.length) assert.deepEqual(page.panel.detail.sections.map((section) => section.fields), pages[0].panel.detail.sections.map((section) => section.fields));
      const records = page.panel.detail.sections.flatMap((section) => section.records);
      assert.equal(page.panel.pagination.returnedItems, records.length);
      assert.ok(records.length > 0 && records.length <= 24);
      for (const record of records) { assert.equal(seen.has(record.id), false); seen.add(record.id); }
      assert.ok(JSON.stringify(page).length <= 128_000);
      assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 384_000);
      validateContract("skill-panel-view-projection-v1", page.panel);
      pages.push(page);
      cursor = page.panel.pagination.nextCursor;
    } while (cursor);
    const chunks = pages.flatMap((page) => page.panel.detail.sections.find((section) => section.id === "attribute_text").records);
    assert.ok(chunks.every((record) => record.text.length <= 6000 && record.text.isWellFormed()));
    assert.equal(chunks.map((record) => record.text).join(""), source);
    const promises = pages.flatMap(commitmentRecords);
    assert.equal(promises.length, 25);
    assert.ok(promises[0].text.endsWith(view.state.commitments["promise-25"].due));
    assert.equal(pages[0].panel.detail.sections.find((section) => section.id === "attribute_text").fields.find((field) => field.id === "character_count").value, source.length);
  }
  assert.deepEqual(view, original);
});

test("长数组与别名保留所有条目、空白和原顺序，Unicode长句无损且短字段不改", () => {
  const view = fixture();
  const description = `${"字".repeat(5999)}🙂${"文".repeat(6100)}\r\n末尾保留：尚未确定。`;
  const aliases = ["别".repeat(256), "第二别名"];
  const relationships = Array.from({ length: 65 }, (_, index) => index === 1 ? "" : index === 2 ? " \n"
    : index === 4 ? `${"long\\\"🙂".repeat(1700)}最后条件未变` : `关系条目-${index}`);
  Object.assign(view.state.entities.npc, { aliases });
  Object.assign(view.state.entities.npc.attributes, { description, relationship: relationships, mood: ["安静", "谨慎"] });
  const original = structuredClone(view);
  for (const language of ["zh-CN", "en-US", "ja-JP"]) {
    const target = detailTarget(view, "session_characters", language), records = [];
    const list = projectSessionPanel(view, { panelRef: "session_characters", view: "list", fieldId: "characters", displayLocale: language });
    assert.equal(list.panel.items.find((item) => item.ref === target.itemRef).subtitle,
      { "zh-CN": "查看完整详情", "en-US": "View full details", "ja-JP": "詳細をすべて見る" }[language]);
    let cursor;
    do {
      const page = projectSessionPanel(view, { ...target, ...(cursor ? { cursor } : {}) });
      validateContract("skill-panel-view-projection-v1", page.panel);
      const fields = page.panel.detail.sections[0].fields;
      assert.deepEqual(fields.find((field) => field.id === "mood").value, ["安静", "谨慎"]);
      for (const key of ["aliases", "description", "relationship"]) assert.equal(fields.some((field) => field.id === key), false);
      records.push(...page.panel.detail.sections.find((section) => section.id === "attribute_text").records);
      cursor = page.panel.pagination.nextCursor;
    } while (cursor);
    let at = 0;
    // Reconstruction follows the known source array positions; it does not
    // parse localized labels or infer source values from opaque record IDs.
    for (const source of [...aliases, description, ...relationships]) {
      if (!source.length) {
        assert.equal(records[at++].text, { "zh-CN": "空白项", "en-US": "Blank entry", "ja-JP": "空白の項目" }[language]);
        continue;
      }
      let reconstructed = "";
      while (reconstructed.length < source.length) {
        const part = records[at++];
        assert.ok(part.text.isWellFormed());
        assert.ok(part.text.length <= 6000);
        reconstructed += part.text;
      }
      assert.equal(reconstructed, source);
    }
    assert.equal(at, records.length);
    assert.equal(new Set(records.map((record) => record.id)).size, records.length);
    const qualified = "仍然需要进一步核实。".repeat(24) + "；没有作出承诺。";
    for (const key of ["relationship", "status"]) {
      const metadataView = structuredClone(view);
      delete metadataView.state.entities.npc.attributes.relationship;
      metadataView.state.entities.npc.attributes[key] = qualified;
      const listed = projectSessionPanel(metadataView, { panelRef: "session_characters", view: "list", fieldId: "characters", displayLocale: language });
      const card = listed.panel.items.find((item) => item.ref === target.itemRef);
      assert.equal(card.statusLabel, null, "long legacy metadata must not turn into a truncated factual sentence");
      const hint = { "zh-CN": "查看完整详情", "en-US": "View full details", "ja-JP": "詳細をすべて見る" }[language];
      assert.equal(JSON.stringify(card).split(hint).length - 1, 1, "the existing description hint is not repeated in statusLabel");
      const detail = projectSessionPanel(metadataView, target);
      assert.equal(detail.panel.detail.sections[0].fields.find((field) => field.id === key).value, qualified,
        "the normal detail entry still provides the entire qualification");
      metadataView.state.entities.npc.attributes[key] = "尚未确认";
      const short = projectSessionPanel(metadataView, { panelRef: "session_characters", view: "list", fieldId: "characters", displayLocale: language });
      assert.equal(short.panel.items.find((item) => item.ref === target.itemRef).statusLabel, "尚未确认");
    }
  }
  assert.deepEqual(view, original);
});

test("转义长文字按完整响应预算缩小分页，首到末每个原字符都可达", () => {
  const view = fixture();
  const source = `${"\n\\\"🙂".repeat(36000)}末尾限定：没有同意。`;
  view.state.entities.rice.attributes.description = source;
  const target = detailTarget(view, "session_inventory");
  const records = [];
  let cursor, pages = 0;
  do {
    const page = projectSessionPanel(view, { ...target, ...(cursor ? { cursor } : {}) });
    const serialized = JSON.stringify(page);
    assert.ok(serialized.length <= 128_000);
    assert.ok(Buffer.byteLength(serialized, "utf8") <= 384_000);
    validateContract("skill-panel-view-projection-v1", page.panel);
    if (page.panel.pagination.hasMore) assert.ok(page.panel.pagination.returnedItems < 24, "escaped text must consume the real serialized budget");
    records.push(...page.panel.detail.sections.find((section) => section.id === "attribute_text").records);
    cursor = page.panel.pagination.nextCursor;
    pages++;
  } while (cursor);
  assert.ok(pages > 1);
  assert.equal(records.map((record) => record.text).join(""), source);
  assert.ok(records.every((record) => record.text.isWellFormed()));
});

test("人物和物品第25条未完成约定优先可见，三语历史页保持原顺序与完整期限", () => {
  const view = withCommitments(fixture(), 25, (index) => index === 25 ? `最后期限${"明".repeat(3992)}结尾` : `旧约定-${index}`);
  const original = structuredClone(view);
  for (const language of ["zh-CN", "en-US", "ja-JP"]) {
    for (const panelRef of ["session_characters", "session_inventory"]) {
      const target = detailTarget(view, panelRef, language);
      const first = projectSessionPanel(view, target);
      const firstRecords = commitmentRecords(first);
      assert.equal(firstRecords.length, 24);
      assert.deepEqual(first.panel.pagination, { hasMore: true, nextCursor: first.panel.pagination.nextCursor,
        returnedItems: 24, totalItems: 25 });
      const next = projectSessionPanel(view, { ...target, cursor: first.panel.pagination.nextCursor });
      const nextRecords = commitmentRecords(next);
      assert.equal(nextRecords.length, 1);
      assert.equal(firstRecords[0].label, { "zh-CN": "尚待履行", "en-US": "Open", "ja-JP": "未履行" }[language]);
      assert.ok(firstRecords[0].text.endsWith(view.state.commitments["promise-25"].due));
      assert.ok(nextRecords[0].text.endsWith(view.state.commitments["promise-24"].due));
      [...firstRecords.slice(1), ...nextRecords].forEach((record, index) => assert.ok(record.text.endsWith(view.state.commitments[`promise-${index + 1}`].due)));
      assert.equal(new Set([...firstRecords, ...nextRecords].map((record) => record.id)).size, 25);
      assert.deepEqual(next.panel.pagination, { hasMore: false, nextCursor: null, returnedItems: 1, totalItems: 25 });
      for (const page of [first, next]) {
        assert.equal(page.revision, view.revision);
        validateContract("skill-panel-view-projection-v1", page.panel);
      }
    }
  }
  assert.deepEqual(view, original, "Reading a later page cannot change the fixed state or prior result");
});

test("约定详情游标绑定冒险、固定版本、面板、人物物品与语言，不能作为普通列表游标", () => {
  const view = withCommitments(fixture(), 25);
  const target = detailTarget(view, "session_characters");
  const first = projectSessionPanel(view, target);
  const cursor = first.panel.pagination.nextCursor;
  const oldSignature = require("node:crypto").createHash("sha256").update(JSON.stringify([
    view.adventureId, view.revision, target.panelRef, target.fieldId, "npc", "zh-CN", 24])).digest("hex").slice(0, 32);
  assert.throws(() => projectSessionPanel(view, { ...target, cursor: `detail_24_${oldSignature}` }),
    { code: "SKILL_PANEL_CURSOR_INVALID" }, "a same-revision cursor from the old ordering must not skip different records");
  for (const changed of [{ ...view, revision: 3 }, { ...view, adventureId: "elsewhere" }]) {
    assert.throws(() => projectSessionPanel(changed, { ...detailTarget(changed, "session_characters"), cursor }), { code: "SKILL_PANEL_CURSOR_INVALID" });
  }
  for (const changed of [{ ...target, displayLocale: "en-US" }, detailTarget(view, "session_inventory"),
    { ...target, itemRef: projectSessionPanel(view, { panelRef: "session_characters", view: "list", fieldId: "characters" }).panel.items.find((item) => item.title === "玩家").ref }]) {
    assert.throws(() => projectSessionPanel(view, { ...changed, cursor }), { code: "SKILL_PANEL_CURSOR_INVALID" });
  }
  assert.throws(() => projectSessionPanel(view, { panelRef: "session_characters", view: "list", fieldId: "characters", cursor }), { code: "SKILL_PANEL_CURSOR_INVALID" });
  for (const limit of [0, 25, 1.5]) assert.throws(() => projectSessionPanel(view, { ...target, limit }), { code: "SKILL_PANEL_VIEW_INVALID" });
  const malformed = structuredClone(first.panel);
  malformed.pagination.returnedItems -= 1;
  assert.throws(() => validateContract("skill-panel-view-projection-v1", malformed));
  const ordinary = structuredClone(first.panel);
  Object.assign(ordinary, { panelRef: "ordinary", sourceKind: "ordinary_skill", group: "adventure_gameplay" });
  assert.throws(() => validateContract("skill-panel-view-projection-v1", ordinary), "Other modules do not silently gain detail pagination");
});

test("约定详情按完整JSON预算缩小页而不裁条款，合计过长的chips进入全文分页", () => {
  const view = withCommitments(fixture(), 25, (index) => `${"\\\n\"".repeat(1300)}末尾-${index}`);
  const target = detailTarget(view, "session_inventory");
  const records = [];
  let cursor;
  do {
    const page = projectSessionPanel(view, { ...target, ...(cursor ? { cursor } : {}) });
    const serialized = JSON.stringify(page);
    assert.ok(serialized.length <= 128_000);
    assert.ok(Buffer.byteLength(serialized, "utf8") <= 384_000);
    assert.ok(page.panel.pagination.returnedItems > 0 && page.panel.pagination.returnedItems < 24);
    records.push(...commitmentRecords(page));
    validateContract("skill-panel-view-projection-v1", page.panel);
    cursor = page.panel.pagination.nextCursor;
  } while (cursor);
  assert.equal(records.length, 25);
  [25, ...Array.from({ length: 24 }, (_, index) => index + 1)].forEach((revision, index) =>
    assert.ok(records[index].text.endsWith(view.state.commitments[`promise-${revision}`].due)));
  const longChips = withCommitments(fixture(), 1);
  for (const key of ["status", "description", "relationship", "occupation", "age", "condition", "health", "injuries", "hunger", "thirst", "fatigue", "mood"]) {
    longChips.state.entities.npc.attributes[key] = Array(64).fill("\\".repeat(240));
  }
  const chipRecords = [];
  cursor = undefined;
  do {
    const page = projectSessionPanel(longChips, { ...detailTarget(longChips, "session_characters"), ...(cursor ? { cursor } : {}) });
    assert.ok(JSON.stringify(page).length <= 128_000);
    validateContract("skill-panel-view-projection-v1", page.panel);
    chipRecords.push(...page.panel.detail.sections.find((section) => section.id === "attribute_text").records);
    cursor = page.panel.pagination.nextCursor;
  } while (cursor);
  assert.equal(chipRecords.length, 12 * 64);
  assert.ok(chipRecords.every((record) => record.text === "\\".repeat(240)));
});

test("合法一万条约定加长描述仍按24条可读至末页，只有内置详情允许扩大总数", () => {
  const view = withCommitments(fixture(), 10_000);
  const description = `${"全文".repeat(1000)}尚未决定。`;
  view.state.entities.rice.attributes.description = description;
  const target = detailTarget(view, "session_inventory");
  let cursor;
  let count = 0;
  const ids = new Set();
  let last;
  const textRecords = [];
  let first;
  do {
    const page = projectSessionPanel(view, { ...target, ...(cursor ? { cursor } : {}) });
    first ??= page;
    assert.equal(page.panel.pagination.totalItems, 10_001);
    validateContract("skill-panel-view-projection-v1", page.panel);
    textRecords.push(...page.panel.detail.sections.find((section) => section.id === "attribute_text").records);
    const records = commitmentRecords(page);
    assert.ok(records.length > 0 && records.length <= 24);
    assert.ok(JSON.stringify(page).length < 12_000);
    for (const record of records) { assert.equal(ids.has(record.id), false); ids.add(record.id); }
    count += records.length;
    last = records.at(-1);
    cursor = page.panel.pagination.nextCursor;
  } while (cursor);
  assert.equal(count, 10_000);
  assert.ok(first.panel.detail.sections[0].records[0].text.endsWith("约定-10000"));
  assert.equal(first.panel.detail.sections[0].records[0].label, "尚待履行");
  assert.ok(last.text.endsWith("约定-9999"));
  assert.equal(last.label, "已履行");
  assert.equal(textRecords.map((record) => record.text).join(""), description);
  const tooMany = structuredClone(first.panel);
  tooMany.pagination.totalItems = 250_001;
  assert.throws(() => validateContract("skill-panel-view-projection-v1", tooMany));
  const list = projectSessionPanel(view, { panelRef: "session_inventory", view: "list", fieldId: "inventory" }).panel;
  list.pagination.totalItems = 10_001;
  assert.throws(() => validateContract("skill-panel-view-projection-v1", list), "native list counts retain the previous bound");
});

test("three interface languages use existing fields while authoritative narration stays unchanged", () => {
  for (const [language, location, status, inventory] of [
    ["zh-CN", "楼道", "疲惫", "物品"], ["en-US", "Hallway", "疲惫", "Items"], ["ja-JP", "廊下", "疲惫", "所持品"],
  ]) {
    const view = fixture();
    const result = projectSessionView(view, { delivery: "commit", displayLocale: language });
    assert.equal(result.state_hint.scene.location_name, location);
    assert.equal(result.state_hint.player.status_label, status);
    assert.equal(result.panels.panels[0].title, inventory);
    assert.equal(result.save.adventureLocale, "zh-CN");
    assert.deepEqual(result.envelope.segments.map((entry) => entry.content), view.narration.map((entry) => entry.text));
    const panel = projectSessionPanel(view, { panelRef: "session_inventory", view: "overview", displayLocale: language });
    assert.equal(panel.panel.title, inventory);
  }
});

test("the current player status reaches every delivery and panel without an older localized label overriding it", () => {
  for (const language of ["zh-CN", "en-US", "ja-JP"]) {
    const view = fixture();
    view.state.entities.p.attributes.status = "右臂擦伤，已经止血；仍然疲惫。";
    view.state.entities.p.attributes.localizedStatus = { "zh-CN": "正常", "en-US": "Uninjured", "ja-JP": "けがなし" };
    const before = structuredClone(view);
    for (const delivery of ["commit", "recovery"]) {
      const projected = projectSessionView(view, { delivery, displayLocale: language });
      for (const hint of [projected.state_hint, projected.envelope.state_hint, projected.save.state_hint]) {
        assert.deepEqual(hint.player, { status: "右臂擦伤，已经止血；仍然疲惫。", status_label: "右臂擦伤，已经止血；仍然疲惫。" });
      }
    }
    const list = projectSessionPanel(view, { panelRef: "session_characters", view: "list", fieldId: "characters", displayLocale: language });
    const player = list.panel.items.find((item) => item.title === "玩家");
    const detail = projectSessionPanel(view, { panelRef: "session_characters", view: "detail", fieldId: "characters", itemRef: player.ref, displayLocale: language });
    const status = detail.panel.detail.sections.flatMap((section) => section.fields).find((field) => field.id === "status");
    assert.equal(status.value, "右臂擦伤，已经止血；仍然疲惫。");
    assert.deepEqual(view, before);
  }
});

test("a condition event reaches HUD and character details while preserving mood, identity and item condition", () => {
  const prior = fixture();
  delete prior.state.entities.p.attributes.status;
  delete prior.state.entities.p.attributes.localizedStatus;
  prior.state.entities.p.attributes.mood = "紧张";
  prior.state.entities.p.conditionRecords = emptyConditionRecords();
  const original = structuredClone(prior);
  const narration = [{ id: "drink", text: "你喝了两口水，口渴稍缓；右臂擦伤已经止血，疲惫没有消退。" }];
  const status = "口渴稍缓，右臂擦伤已止血；仍然疲惫。";
  const applied = applyTurnBundle(prior.state, { narration, events: [{ id: "body", type: "condition.add",
    sourceSegmentIds: ["drink"], data: { characterId: "p", basis: "observed", text: status,
      evidence: [{ segmentId: "drink", quote: narration[0].text }] } }], experiences: [] },
  { adventureId: prior.adventureId, baseRevision: prior.revision });
  const current = { ...prior, revision: 3, actionId: "drink-action", narration, state: applied.state,
    history: [...prior.history, { revision: 3, actionId: "drink-action", input: "喝两口水。", narration }] };
  for (const displayLocale of ["zh-CN", "en-US", "ja-JP"]) {
    for (const delivery of ["commit", "recovery"]) {
      const projected = projectSessionView(current, { displayLocale, delivery });
      assert.equal(projected.state_hint.player.status_label, status);
      assert.equal(projected.save.state_hint.player.status, status);
      const list = projectSessionPanel(current, { panelRef: "session_characters", view: "list", fieldId: "characters", displayLocale });
      const itemRef = list.panel.items.find(item => item.title === "玩家").ref;
      const detail = projectSessionPanel(current, { panelRef: "session_characters", view: "detail", fieldId: "characters", itemRef, displayLocale });
      const fields = detail.panel.detail.sections.flatMap(section => section.fields || []);
      assert.deepEqual(fields.find(field => field.id === "status").value, [status]);
      assert.equal(fields.find(field => field.id === "mood").value, "紧张");
      assert.equal(fields.find(field => field.id === "occupation").value, "护工");
      assert.equal(fields.some(field => ["condition", "health", "injuries", "hunger", "thirst", "fatigue"].includes(field.id)), false);
    }
  }
  assert.deepEqual(applied.state.entities.rice, prior.state.entities.rice);
  assert.deepEqual(prior, original);
});

test("condition records are the shared three-language authority for player and other character displays", () => {
  const view = fixture();
  const playerText = "右臂不痛（病因未确认）。\nNo fever (not diagnosed).";
  const npcText = "立つ時だけ足に力が入らない（原因不明）。";
  Object.assign(view.state.entities.p.attributes, { condition: "OLD_CONDITION", fatigue: "OLD_FATIGUE", mood: "警觉" });
  view.state.entities.npc.attributes.status = "OLD_NPC_ACTION";
  setConditions(view, "p", [{ text: playerText }, { text: "仍然疲惫（并非已经恢复）", basis: "self_report" }]);
  setConditions(view, "npc", [{ text: npcText, basis: "self_report" }]);
  setConditions(view, "secret", [{ text: "HIDDEN_BODILY_MARKER" }]);
  const original = structuredClone(view);
  for (const [displayLocale, prefix] of [["zh-CN", "自述："], ["en-US", "Self-reported: "], ["ja-JP", "本人申告："]]) {
    const expectedPlayer = [playerText, prefix + "仍然疲惫（并非已经恢复）"];
    for (const delivery of ["commit", "recovery"]) {
      const projected = projectSessionView(view, { displayLocale, delivery });
      for (const hint of [projected.state_hint, projected.envelope.state_hint, projected.save.state_hint]) {
        assert.deepEqual(hint.player, { status: expectedPlayer.join("；"), status_label: expectedPlayer.join("；") });
      }
      assert.doesNotMatch(JSON.stringify(projected), /OLD_CONDITION|OLD_FATIGUE|HIDDEN_BODILY_MARKER|private-condition-predecessor|condition_[a-f0-9]{64}/);
    }
    const player = characterDetail(view, "玩家", displayLocale);
    const npc = characterDetail(view, "陈姨", displayLocale);
    assert.equal(player.item.statusLabel, expectedPlayer.join("；"));
    assert.deepEqual(player.fields.find(field => field.id === "status").value, expectedPlayer);
    assert.equal(player.fields.find(field => field.id === "occupation").value, "护工");
    assert.equal(player.fields.find(field => field.id === "mood").value, "警觉");
    assert.equal(npc.item.statusLabel, prefix + npcText);
    assert.deepEqual(npc.fields.find(field => field.id === "status").value, [prefix + npcText]);
    assert.equal(npc.fields.find(field => field.id === "relationship").value, "值得信任");
    assert.equal(npc.fields.find(field => field.id === "description").value, "住在隔壁的邻居。");
    for (const result of [player.list, player.detail, npc.detail]) {
      validateContract("skill-panel-view-projection-v1", result.panel);
      assert.doesNotMatch(JSON.stringify(result), /OLD_CONDITION|OLD_FATIGUE|OLD_NPC_ACTION|HIDDEN_BODILY_MARKER|private-condition-predecessor|condition_[a-f0-9]{64}|"sources"|"predecessor"/);
    }
  }
  assert.deepEqual(view, original);
});

test("an empty authoritative collection shows unconfirmed and cannot revive any legacy bodily field", () => {
  const view = fixture();
  for (const id of ["p", "npc"]) {
    view.state.entities[id].conditionRecords = emptyConditionRecords();
    Object.assign(view.state.entities[id].attributes, { status: "OLD_STATUS", localized_status: { "en-US": "OLD_TRANSLATION" },
      condition: "OLD_CONDITION", health: "OLD_HEALTH", injuries: ["OLD_INJURY"], hunger: true, thirst: 5, fatigue: "OLD_FATIGUE" });
  }
  for (const [displayLocale, unknown] of [["zh-CN", "尚未确认"], ["en-US", "Not yet confirmed"], ["ja-JP", "未確認"]]) {
    assert.deepEqual(projectSessionView(view, { displayLocale }).state_hint.player, { status: "unknown", status_label: unknown });
    for (const name of ["玩家", "陈姨"]) {
      const { item, detail, fields } = characterDetail(view, name, displayLocale);
      assert.equal(item.statusLabel, unknown);
      assert.equal(fields.find(field => field.id === "status").value, unknown);
      assert.equal(fields.some(field => ["condition", "health", "injuries", "hunger", "thirst", "fatigue"].includes(field.id)), false);
      assert.doesNotMatch(JSON.stringify(detail), /OLD_/);
    }
  }
});

test("32 maximum-length bodily records retain every qualifier in HUD and details with an explicit short directory notice", () => {
  const view = fixture();
  const entries = Array.from({ length: 32 }, (_, index) => {
    const prefix = `${index + 1}:🙂`, suffix = "（未确诊，并非已经恢复）";
    return { text: prefix + "症".repeat(120 - prefix.length - suffix.length) + suffix, basis: "self_report" };
  });
  setConditions(view, "p", entries);
  for (const [displayLocale, prefix, notice] of [["zh-CN", "自述：", "32 项身体状况，查看详情"],
    ["en-US", "Self-reported: ", "32 bodily conditions; see details"], ["ja-JP", "本人申告：", "32件の身体状態。詳細を確認"]]) {
    const expected = entries.map(entry => prefix + entry.text);
    const projected = projectSessionView(view, { displayLocale });
    assert.equal(projected.state_hint.player.status, expected.join("；"));
    assert(projected.state_hint.player.status.length > 3840);
    const { item, detail, fields } = characterDetail(view, "玩家", displayLocale);
    assert.equal(item.statusLabel, notice);
    const status = fields.find(field => field.id === "status");
    assert.equal(status.kind, "chips"); assert.deepEqual(status.value, expected);
    assert.equal(status.value.length, 32);
    assert(status.value.every(value => value.endsWith("（未确诊，并非已经恢复）") && value.isWellFormed()));
    validateContract("skill-panel-view-projection-v1", detail.panel);
    const list = characterDetail(view, "玩家", displayLocale).list;
    validateContract("skill-panel-view-projection-v1", list.panel);
  }
});

test("malformed present condition authority never falls back, while hidden character records remain inaccessible", () => {
  for (const invalid of [null, undefined, {}, { format: "wrong", items: [] }, { format: "body-conditions-1", items: [{}] }]) {
    const view = fixture();
    view.state.entities.p.conditionRecords = invalid;
    assert.throws(() => projectSessionView(view), { code: "SESSION_PROJECTION_INVALID" });
    assert.throws(() => characterDetail(view, "玩家"), { code: "SESSION_PROJECTION_INVALID" });
  }
  const view = fixture();
  view.state.entities.secret.conditionRecords = { format: "hidden-malformed", items: [{ text: "PRIVATE_HIDDEN_CONDITION" }] };
  const projected = projectSessionView(view);
  const list = characterDetail(view, "玩家").list;
  assert.doesNotMatch(JSON.stringify([projected, list]), /PRIVATE_HIDDEN_CONDITION|秘密访客/);
  const hiddenRef = "entity_" + require("node:crypto").createHash("sha256").update(JSON.stringify([view.adventureId, "secret"])).digest("hex").slice(0, 32);
  assert.throws(() => projectSessionPanel(view, { panelRef: "session_characters", view: "detail", fieldId: "characters", itemRef: hiddenRef }),
    { code: "SKILL_PANEL_ITEM_NOT_FOUND" });
});

test("reading a prior snapshot keeps unresolved bodily descriptions visible without rewriting the record", () => {
  const view = fixture();
  view.state.entities.p.attributes.condition = "疲惫，尚未喝水";
  const before = structuredClone(view);
  const list = projectSessionPanel(view, { panelRef: "session_characters", view: "list", fieldId: "characters" });
  const itemRef = list.panel.items.find(item => item.title === "玩家").ref;
  const detail = projectSessionPanel(view, { panelRef: "session_characters", view: "detail", fieldId: "characters", itemRef });
  const fields = detail.panel.detail.sections.flatMap(section => section.fields || []);
  assert.equal(fields.find(field => field.id === "condition").value, "疲惫，尚未喝水");
  assert.equal(fields.find(field => field.id === "status").value, "疲惫");
  assert.deepEqual(view, before);
});

test("older localized status remains a fallback when a snapshot has no current status", () => {
  const view = fixture();
  delete view.state.entities.p.attributes.status;
  for (const [language, label] of [["en-US", "Tired"], ["ja-JP", "疲れている"], ["zh-CN", null]]) {
    assert.deepEqual(projectSessionView(view, { displayLocale: language }).state_hint.player, { status: "unknown", status_label: label });
  }
  delete view.state.entities.p.attributes.localizedStatus;
  view.state.entities.p.attributes.localized_status = { "en-US": "Tired" };
  assert.equal(projectSessionView(view, { displayLocale: "en-US" }).state_hint.player.status_label, "Tired");
});

test("opening drafts remain explicitly unconfirmed and never become player or location state", () => {
  for (const phase of ["creating", "awaiting_confirmation"]) {
    const view = fixture();
    view.state = { entities: {}, inventory: [], commitments: {}, situation: { playerId: null, locationId: null, day: null },
      opening: { phase, draft: { identity: "医生", keepsake: "旧大衣" }, proposal: phase === "awaiting_confirmation" ? {
        proposalId: "proposal-1", initialState: { privateWorld: "不应进入前端的候选世界" }, summary: { revision: 2, segmentIds: ["s2a", "s2b"] },
      } : null } };
    const result = projectSessionView(view, { delivery: "commit" });
    assert.equal(result.state_hint.lifecycle.phase, "new_game_creation");
    assert.equal(result.state_hint.scene.location, null);
    assert.equal(result.state_hint.player.status, "unknown");
    assert.equal(result.state_hint.time.day, null);
    assert.deepEqual(result.state_hint.opening.draft, { identity: "医生", keepsake: "旧大衣" });
    assert.equal(JSON.stringify(result).includes("privateWorld"), false);
    assert.equal(JSON.stringify(result).includes("不应进入前端"), false);
    const panel = projectSessionPanel(view, { panelRef: "session_characters", view: "list", fieldId: "characters" });
    assert.equal(panel.panel.status, "empty");
    assert.deepEqual(panel.panel.items, []);
  }
});

test("projection does not mutate inputs or invent missing status, day, or dates", () => {
  const view = fixture();
  delete view.state.entities.p.attributes.status;
  delete view.state.entities.p.attributes.localizedStatus;
  view.state.situation.day = 0;
  const before = structuredClone(view);
  const result = projectSessionView(view);
  assert.equal(result.state_hint.player.status, "unknown");
  assert.equal(result.state_hint.time.day, 0);
  assert.equal(result.save.updatedAt, null);
  assert.deepEqual(view, before);
  result.save.state_hint.player.status = "caller mutation";
  assert.equal(result.envelope.state_hint.player.status, "unknown");
  assert.deepEqual(view, before);
});

function chapterPage() {
  return { adventureId: "adventure-1", revision: 4, chapters: [{ chapterId: "chapter-1", fromRevision: 1, toRevision: 4,
    createdAt: "2026-09-10T10:00:00.000Z", title: "楼道里的两袋米", summary: "陈姨借给林安两袋米，林安答应明天归还。",
    keyEvents: [{ text: "林安收下两袋米。", sources: [{ revision: 4, segmentId: "borrowed" }] }],
    openThreads: [{ text: "明天向陈姨归还两袋米。", sources: [{ revision: 4, segmentId: "borrowed" }] }],
    mode: "model" }], nextCursor: null, complete: true };
}

test("chapters adapt to existing string-based reading surfaces and preserve source references", () => {
  const page = chapterPage();
  const original = structuredClone(page);
  const result = projectSessionChapters(page);
  assert.equal(result.adventureId, page.adventureId);
  assert.equal(result.revision, 4);
  assert.equal(result.chapter_count, 1);
  const chapter = result.chapters[0];
  assert.equal(chapter.chapter_id, "chapter-1");
  assert.deepEqual(chapter.turn_range, { start: 1, end: 4 });
  assert.deepEqual(chapter.key_events, ["林安收下两袋米。"]);
  assert.deepEqual(chapter.open_threads, ["明天向陈姨归还两袋米。"]);
  assert.deepEqual(chapter.sources.key_events, page.chapters[0].keyEvents);
  assert.deepEqual(chapter.sources.open_threads, page.chapters[0].openThreads);
  assert.deepEqual(chapter.generation, { mode: "model" });
  assert.equal(result.autoSpeak, false);
  assert.equal(chapter.autoSpeak, false);
  assert.equal(chapter.not_hard_state, true);
  assert.equal("segments" in result || "history" in result || "actionId" in chapter || "author" in chapter, false);
  chapter.sources.key_events[0].sources[0].revision = 99;
  assert.deepEqual(page, original);
});

test("mechanical chapter excerpts remain labelled and missing dates are not invented", () => {
  const page = chapterPage();
  Object.assign(page.chapters[0], { mode: "excerpt", fallbackReason: "CHAPTER_MODEL_FAILED" });
  delete page.chapters[0].createdAt;
  const chapter = projectSessionChapters(page).chapters[0];
  assert.deepEqual(chapter.generation, { mode: "excerpt", fallbackReason: "CHAPTER_MODEL_FAILED" });
  assert.equal(chapter.createdAt, null);
  assert.equal(chapter.summary, page.chapters[0].summary);
});

test("chapter paging preserves fixed adventure, story revision, and archive upper bound", () => {
  const page = chapterPage();
  page.revision = 12;
  page.nextCursor = { adventureId: page.adventureId, revision: 12, afterToRevision: 4, throughToRevision: 8 };
  page.complete = false;
  const first = projectSessionChapters(page);
  assert.deepEqual(first.nextCursor, page.nextCursor);
  assert.equal(first.complete, false);
  const next = chapterPage();
  next.revision = 12;
  Object.assign(next.chapters[0], { chapterId: "chapter-2", fromRevision: 5, toRevision: 8,
    keyEvents: [{ text: "约定仍待履行。", sources: [{ revision: 8, segmentId: "return" }] }], openThreads: [] });
  assert.equal(projectSessionChapters(next).chapters[0].turn_range.start, 5);
  assert.deepEqual(projectSessionChapters({ adventureId: page.adventureId, revision: 0, chapters: [], nextCursor: null, complete: true }).chapters, []);
  for (const change of [
    (value) => { value.nextCursor.adventureId = "different"; },
    (value) => { value.nextCursor.revision = 13; },
    (value) => { value.nextCursor.throughToRevision = 13; },
    (value) => { value.nextCursor.afterToRevision = 3; },
    (value) => { value.complete = true; },
  ]) {
    const invalid = structuredClone(page);
    change(invalid);
    assert.throws(() => projectSessionChapters(invalid), { code: "SESSION_PROJECTION_INVALID" });
  }
});

test("invalid chapter sources, overlap, or internal diagnostic text never become visible recaps", () => {
  for (const change of [
    (page) => { page.chapters[0].keyEvents[0].sources[0].revision = 5; },
    (page) => { page.chapters[0].openThreads[0].sources = []; },
    (page) => { page.chapters[0].keyEvents[0].sources.push({ revision: 4, segmentId: "borrowed" }); },
    (page) => { page.chapters.push(structuredClone(page.chapters[0])); },
    (page) => { page.chapters[0].createdAt = "unknown"; },
    (page) => { page.chapters[0].mode = "excerpt"; page.chapters[0].fallbackReason = "secret provider diagnostic"; },
  ]) {
    const page = chapterPage();
    change(page);
    assert.throws(() => projectSessionChapters(page), (error) => error.code === "SESSION_PROJECTION_INVALID"
      && !error.message.includes("secret provider diagnostic"));
  }
});

function finaleMeta() {
  return { adventureId: "adventure-a", revision: 2,
    decision: { phase: "confirmed", candidate: { candidateId: "ending-1", closureReason: "隐藏的主持人说明不应投影",
      closedThreads: [], intentionalOpenThreads: ["未归还的约定仍然存在"], finaleTone: "quiet",
      proposal: { revision: 1, segmentIds: ["proposal"] } }, lastDeclined: null,
    confirmation: { candidateId: "ending-1", proposalRevision: 1, proposalSegmentIds: ["proposal"], revision: 2, sourceSegmentIds: ["confirmed"] } },
    archive: { finaleId: "finale-2", candidateId: "ending-1", confirmationRevision: 2, confirmationActionId: "action-2",
      status: "pending", chapterId: null, closedAt: null }, chapterJob: null };
}

test("finale proposals remain playable and declined decisions do not close the story", () => {
  const meta = finaleMeta();
  meta.archive = null;
  meta.decision.confirmation = null;
  meta.decision.phase = "candidate_pending";
  const candidate = projectSessionFinale(meta);
  assert.equal(candidate.projection.phase, "candidate_pending");
  assert.equal(candidate.projection.inputAllowed, true);
  assert.equal(candidate.actionId, null);
  meta.decision = { phase: "idle", candidate: null, confirmation: null,
    lastDeclined: { candidate: meta.decision.candidate, decision: { revision: 2, sourceSegmentIds: ["declined"] } } };
  const declined = projectSessionFinale(meta);
  assert.equal(declined.projection.phase, "idle");
  assert.equal(declined.projection.inputAllowed, true);
  assert.equal(JSON.stringify(declined).includes("隐藏"), false);
});

test("confirmed finales lock input until archive closure and never replay ending narration", () => {
  for (const [status, expected] of [[null, "recovery_required"], ["running", "finalizing"],
    ["failed", "recovery_required"], ["interrupted", "recovery_required"], ["committed", "recovery_required"]]) {
    const meta = finaleMeta();
    meta.chapterJob = status ? { adventureId: meta.adventureId, chapterId: "chapter-2", fromRevision: 1, toRevision: 2,
      status, error: { message: "private provider detail" } } : null;
    const result = projectSessionFinale(meta);
    assert.equal(result.projection.phase, expected);
    assert.equal(result.projection.inputAllowed, false);
    assert.equal(result.projection.actions.resumeFinalization, true, "running or unresolved jobs remain explicitly inspectable without replaying the story");
    assert.equal(result.projection.actions.exportStory, false);
    assert.equal(result.projection.actions.continueAsChild, false);
    assert.equal(result.projection.closedFinale, null);
    assert.equal(result.actionId, "action-2");
    assert.equal(result.autoSpeak, false);
    assert.equal("narration" in result || "finale" in result || "history" in result || "segments" in result, false);
    assert.equal(JSON.stringify(result).includes("隐藏") || JSON.stringify(result).includes("private provider"), false);
  }
  const missingArchive = finaleMeta();
  missingArchive.archive = null;
  const pending = projectSessionFinale(missingArchive);
  assert.equal(pending.projection.phase, "recovery_required");
  assert.equal(pending.actionId, null);
  const closed = finaleMeta();
  Object.assign(closed.archive, { status: "closed", chapterId: "chapter-2", closedAt: "2026-09-10T10:00:00.000Z" });
  const result = projectSessionFinale(closed);
  assert.equal(result.projection.phase, "closed");
  assert.deepEqual(result.projection.closedFinale, { finaleId: "finale-2", finaleSource: "normal", continuationPolicy: "allowed" });
  assert.deepEqual(result.projection.actions, { resumeFinalization: false, exportStory: true, continueAsChild: true });
});

test("finale recovery notices support all interface locales without exposing host-only decisions", () => {
  const meta = finaleMeta();
  const before = structuredClone(meta);
  for (const [displayLocale, expected] of [["zh-CN", "结局已确认"], ["en-US", "ending is confirmed"], ["ja-JP", "結末は確認済み"]]) {
    const result = projectSessionFinale(meta, { displayLocale });
    assert.ok(result.projection.engineNotice.includes(expected));
    assert.equal(result.projection.phase, "recovery_required");
    assert.equal(JSON.stringify(result).includes("隐藏"), false);
  }
  assert.deepEqual(meta, before);
});

test("same-view finale state protects menu recovery and archive compatibility", () => {
  const view = fixture();
  const meta = finaleMeta();
  view.state.finale = meta.decision;
  // Missing archive metadata must not silently reopen a confirmed story.
  const pending = projectSessionView(view);
  assert.equal(pending.storyFinale.projection.phase, "recovery_required");
  assert.equal(pending.save.compatibility.status, "recovery_required");
  assert.equal(pending.save.compatibility.playerContinuable, true, "menu can open the recovery flow");
  assert.equal(pending.storyFinale.projection.inputAllowed, false, "opening recovery does not authorize another action");
  view.finale = meta;
  Object.assign(meta.archive, { status: "closed", chapterId: "chapter-2", closedAt: "2026-09-10T10:00:00.000Z" });
  const closed = projectSessionView(view);
  assert.equal(closed.save.compatibility.status, "closed");
  assert.equal(closed.save.compatibility.playerContinuable, false);
  assert.equal(closed.save.catalogRole, "archive");
  assert.equal(closed.storyFinale.projection.phase, "closed");
  assert.deepEqual(closed.envelope.segments, []);
  assert.equal(closed.history.length, view.history.length);
});

test("finale identity contradictions are rejected instead of relabelling another archive", () => {
  for (const change of [
    (meta) => { meta.decision = "not a decision"; },
    (meta) => { meta.decision.phase = "idle"; },
    (meta) => { meta.decision.candidate.candidateId = "different"; },
    (meta) => { meta.archive.candidateId = "different"; },
    (meta) => { meta.archive.confirmationRevision = 1; },
    (meta) => { meta.archive.status = "closed"; },
    (meta) => { meta.chapterJob = { chapterId: "another-chapter", status: "running" }; },
    (meta) => { meta.chapterJob = { adventureId: "another-adventure", chapterId: "chapter-2", fromRevision: 1, toRevision: 2, status: "running" }; },
    (meta) => { meta.chapterJob = { adventureId: meta.adventureId, chapterId: "chapter-2", fromRevision: 1, toRevision: 1, status: "running" }; },
  ]) {
    const meta = finaleMeta();
    change(meta);
    assert.throws(() => projectSessionFinale(meta), { code: "SESSION_PROJECTION_INVALID" });
  }
  for (const change of [(meta) => { meta.adventureId = "another-adventure"; }, (meta) => { meta.revision = 3; }]) {
    const view = fixture();
    view.finale = finaleMeta();
    change(view.finale);
    assert.throws(() => projectSessionView(view), { code: "SESSION_PROJECTION_INVALID" });
  }
});

function extremeMeta({ outcome = "grey_crow_view", reserved = false, closed = false } = {}) {
  const revision = reserved ? 3 : 4;
  const confirmation = { candidateId: "extreme-ending", proposalRevision: 1, proposalSegmentIds: ["extreme-proposed"],
    revision: 4, sourceSegmentIds: ["extreme-complete"], outcome };
  return { adventureId: "adventure-a", revision,
    decision: { phase: reserved ? "candidate_pending" : "confirmed", candidate: {
      kind: "extreme", candidateId: "extreme-ending", characterId: "p", intentReason: "PRIVATE_INTENT_REASON",
      fictionalContext: "PRIVATE_FICTIONAL_CONTEXT", proposal: { revision: 1, segmentIds: ["extreme-proposed"] },
      confirmations: Array.from({ length: reserved ? 2 : 3 }, (_, index) => ({ revision: index + 2, sourceSegmentIds: [`confirmation-${index + 2}`] })),
    }, lastDeclined: null, confirmation: reserved ? null : confirmation },
    terminal: { terminalId: "terminal-4", actionId: "action-4", baseRevision: 3, candidateId: "extreme-ending",
      status: reserved ? "reserved" : "committed", committedRevision: reserved ? null : 4 },
    archive: reserved ? null : { finaleId: "finale-4", candidateId: "extreme-ending", confirmationRevision: 4,
      confirmationActionId: "action-4", status: closed ? "closed" : "pending", chapterId: closed ? "chapter-4" : null,
      closedAt: closed ? "2026-09-10T10:00:00.000Z" : null, source: "extreme", outcome, continuationPolicy: "forbidden" },
    chapterJob: null };
}

function extremeView(options = {}) {
  const view = fixture();
  view.finale = extremeMeta(options);
  view.revision = view.finale.revision;
  view.actionId = `action-${view.revision}`;
  view.narration = [{ id: options.reserved ? "confirmation-3" : "extreme-complete", text: options.reserved ? "这是最后一次确认。" : "这段故事在这里收束。" }];
  view.state.finale = structuredClone(view.finale.decision);
  view.history = [{ revision: view.revision, actionId: view.actionId, input: "仅限当前虚构角色的决定。", narration: view.narration }];
  view.historyComplete = false;
  view.historyNextBeforeRevision = { adventureId: view.adventureId, revision: view.revision, beforeRevision: view.revision };
  return view;
}

test("reserved terminal intentions lock the unchanged story and expose only its recoverable action identity", () => {
  for (const language of ["zh-CN", "en-US", "ja-JP"]) {
    const meta = extremeMeta({ reserved: true });
    const result = projectSessionFinale(meta, { displayLocale: language });
    assert.equal(result.revision, 3);
    assert.equal(result.actionId, "action-4");
    assert.equal(result.projection.phase, "recovery_required");
    assert.equal(result.projection.inputAllowed, false);
    assert.deepEqual(result.projection.actions, { resumeFinalization: true, exportStory: false, continueAsChild: false });
    assert.equal(result.projection.closedFinale, null);
    assert.equal(Object.hasOwn(result.projection, "easterDiscovered"), false);
    assert.equal(result.autoSpeak, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|confirmations|grey_crow_view|standard_extreme_ending|terminalId|baseRevision/);
    assert.ok(result.projection.engineNotice.length > 10);
    if (language === "zh-CN") assert.ok(result.projection.engineNotice.includes("结局正文尚未完成"));
  }
  const view = extremeView({ reserved: true });
  const result = projectSessionView(view);
  assert.equal(result.save.compatibility.status, "recovery_required");
  assert.equal(result.save.compatibility.playerContinuable, true);
  assert.equal(result.save.catalogRole, "active");
  assert.deepEqual(result.envelope.segments, []);
  assert.equal(result.history[0].actionId, "action-3", "reserved action is not yet a story/history row");
});

test("both committed extreme endings forbid continuation; only a committed crow ending exposes discovery", () => {
  for (const outcome of ["grey_crow_view", "standard_extreme_ending"]) {
    const pending = projectSessionFinale(extremeMeta({ outcome }));
    assert.equal(pending.projection.phase, "recovery_required");
    assert.equal(pending.projection.closedFinale, null);
    assert.equal(Object.hasOwn(pending.projection, "easterDiscovered"), outcome === "grey_crow_view");
    const closed = projectSessionFinale(extremeMeta({ outcome, closed: true }));
    assert.deepEqual(closed.projection.closedFinale, { finaleId: "finale-4", finaleSource: "easter", continuationPolicy: "forbidden" });
    assert.deepEqual(closed.projection.actions, { resumeFinalization: false, exportStory: true, continueAsChild: false });
    assert.equal(closed.autoSpeak, false);
    assert.doesNotMatch(JSON.stringify(closed), /PRIVATE_|confirmations|grey_crow_view|standard_extreme_ending|outcome|probability|random/);
  }
});

test("discovered guide uses verified snapshot titles in all three languages and satisfies existing panel schemas", () => {
  for (const [displayLocale, title, expected] of [["zh-CN", "灰鸦余响", "听见灰鸦"],
    ["en-US", "Grey Crow Echo", "heard the Grey Crow"], ["ja-JP", "灰鴉の残響", "灰鴉の残響を聞き"]]) {
    const discoverySkill = { packId: "grey-crow-default", moduleRef: "module_0123456789abcdef0123456789abcdef", title };
    const view = extremeView({ closed: true });
    const projection = projectSessionView(view, { displayLocale, discoverySkill });
    const info = projection.panels.panels.find((panel) => panel.panelRef === "session_grey_crow_echo");
    assert.equal(info.title, title);
    assert.equal(info.surface, "guide");
    assert.ok(info.playerGuide.includes(expected));
    assert.deepEqual(info.triggers, []);
    validateContract("skill-panel-presentation-v2", { schemaVersion: projection.panels.schemaVersion, panels: projection.panels.panels });
    const response = projectSessionPanel(view, { panelRef: info.panelRef, displayLocale, discoverySkill });
    validateContract("skill-panel-view-projection-v1", response.panel);
    assert.equal(response.panel.title, title);
    assert.deepEqual(response.panel.fields, []);
    assert.deepEqual(response.panel.items, []);
    assert.equal(response.panel.status, "ready");
    assert.doesNotMatch(JSON.stringify(projection), /PRIVATE_|confirmations|probability|random|灰鸦分支|三次|3 confirmations/);
    assert.equal(projectSessionView(view, { displayLocale }).panels.panels.length, 1, "missing title provenance never invents a discovery panel");
  }
});

test("reserved, standard, cancelled and player-state-only projections cannot reveal the hidden guide", () => {
  const discoverySkill = { packId: "grey-crow-default", moduleRef: "module_verified", title: "灰鸦余响" };
  const reserved = extremeView({ reserved: true });
  const standard = extremeView({ outcome: "standard_extreme_ending", closed: true });
  const cancelled = fixture();
  cancelled.state.finale = { phase: "idle", candidate: null, confirmation: null };
  const stateOnly = extremeView();
  delete stateOnly.finale;
  for (const view of [reserved, standard, cancelled, stateOnly]) {
    const projection = projectSessionView(view, { discoverySkill });
    assert.equal(projection.panels.panels.length, 1);
    assert.equal(Object.hasOwn(projection.storyFinale.projection, "easterDiscovered"), false);
    assert.throws(() => projectSessionPanel(view, { panelRef: "session_grey_crow_echo", discoverySkill }), { code: "SKILL_PANEL_NOT_SELECTED" });
  }
  const view = extremeView();
  assert.throws(() => projectSessionPanel(view, { panelRef: "session_grey_crow_echo" }), { code: "SKILL_PANEL_NOT_SELECTED" });
  for (const extra of [{ view: "list" }, { view: "detail" }, { fieldId: "hidden" }, { cursor: "private" }, { limit: 1 }]) {
    assert.throws(() => projectSessionPanel(view, { panelRef: "session_grey_crow_echo", discoverySkill, ...extra }), { code: "SKILL_PANEL_VIEW_INVALID" });
  }
});

test("terminal and extreme archive identity contradictions fail instead of unlocking or revealing another result", () => {
  for (const change of [
    (meta) => { meta.terminal.actionId = "invalid action"; },
    (meta) => { meta.terminal.baseRevision = 2; },
    (meta) => { meta.terminal.candidateId = "other"; },
    (meta) => { meta.terminal.committedRevision = 5; },
    (meta) => { meta.archive.source = "normal"; },
    (meta) => { meta.archive.outcome = "standard_extreme_ending"; },
    (meta) => { meta.archive.continuationPolicy = "allowed"; },
    (meta) => { meta.archive.confirmationActionId = "another-action"; },
  ]) {
    const meta = extremeMeta({ closed: true });
    change(meta);
    assert.throws(() => projectSessionFinale(meta), { code: "SESSION_PROJECTION_INVALID" });
  }
  for (const change of [(meta) => { meta.terminal.baseRevision = 2; }, (meta) => { meta.terminal.committedRevision = 4; },
    (meta) => { meta.decision.phase = "idle"; }, (meta) => { delete meta.decision.candidate.kind; }]) {
    const meta = extremeMeta({ reserved: true });
    change(meta);
    assert.throws(() => projectSessionFinale(meta), { code: "SESSION_PROJECTION_INVALID" });
  }
});
