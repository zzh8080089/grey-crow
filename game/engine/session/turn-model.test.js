"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateInitialState, applyTurnBundle, projectPlayerState } = require("./turn-model");
const { playerConditionEvent } = require("./test-fixtures/turn-samples");

function playerCondition(status, segmentId = "s", eventId = "player-condition") {
  return playerConditionEvent(status, [{ segmentId, quote: "邻居把两袋米递给你，你答应明天归还。" }], "player", eventId);
}

function seed() {
  const entities = Object.fromEntries([
    ["player", "character", "旅人"],
    ["neighbor", "character", "邻居"],
    ["courtyard", "location", "庭院"],
    ["rice", "item", "米"],
  ].map(([id, kind, name]) => [id, { id, kind, name, aliases: [], visibility: "player", attributes: {} }]));
  return { entities, inventory: [{ ownerId: "neighbor", itemId: "rice", quantity: 3 }], commitments: {}, situation: { playerId: "player", locationId: "courtyard", day: 10 } };
}

function borrow() {
  return {
    narration: [{ id: "paragraph", text: "邻居把两袋米递给你，你答应明天归还。" }],
    events: [
      { id: "transfer", type: "inventory.transfer", sourceSegmentIds: ["paragraph"], data: { fromId: "neighbor", toId: "player", itemId: "rice", quantity: 2 } },
      { id: "promise", type: "commitment.create", sourceSegmentIds: ["paragraph"], data: { commitment: { id: "debt", debtorId: "player", creditorId: "neighbor", itemId: "rice", quantity: 2, due: "第十一天", status: "open" } } },
    ],
    experiences: [{ id: "memory", text: "邻居借给你两袋米；你答应次日归还。", entityIds: ["player", "neighbor", "rice"], eventIds: ["transfer", "promise"], sourceSegmentIds: ["paragraph"], kind: "event", knownBy: ["player", "neighbor"] }],
  };
}

function failure(run) {
  assert.throws(run, (error) => error.code === "TURN_VALIDATION_FAILED" && Array.isArray(error.issues));
}

test("shared borrowing, returning and refusal do not change bodily condition", () => {
  const samples = require("./test-fixtures/turn-samples");
  const start = samples.initialState(); start.entities.p.attributes = { status: "疲惫，右臂擦伤已包扎", occupation: "维修工" };
  const borrowed = applyTurnBundle(start, samples.borrowBundle());
  const returned = applyTurnBundle(borrowed.state, samples.returnBundle());
  const refused = applyTurnBundle(start, samples.refusedBundle());
  for (const result of [borrowed, returned, refused]) {
    assert.deepEqual(result.state.entities, start.entities);
    assert.equal(result.bundle.events.some(e => e.type === "entity.update"), false);
  }
  assert.deepEqual(samples.playerConditionEvent("右臂擦伤，已止血", [{ segmentId: "wound", quote: "右臂擦伤，已止血。" }]).data,
    { characterId: "p", basis: "observed", text: "右臂擦伤，已止血", evidence: [{ segmentId: "wound", quote: "右臂擦伤，已止血。" }] });
});

test("borrowing and returning preserve inventory and update one current commitment", () => {
  const initial = seed();
  const input = borrow();
  const beforeState = structuredClone(initial);
  const beforeBundle = structuredClone(input);
  const result = applyTurnBundle(initial, input);
  assert.deepEqual(initial, beforeState);
  assert.deepEqual(input, beforeBundle);
  assert.deepEqual(result.state.inventory, [
    { ownerId: "neighbor", itemId: "rice", quantity: 1 },
    { ownerId: "player", itemId: "rice", quantity: 2 },
  ]);
  assert.equal(result.state.commitments.debt.status, "open");
  assert.deepEqual(projectPlayerState(result.state).inventory, [{ ownerId: "player", itemId: "rice", quantity: 2 }]);
  const returned = applyTurnBundle(result.state, {
    narration: [{ id: "returnParagraph", text: "你把两袋米交回邻居手中，兑现了昨天的承诺。" }],
    events: [
      { id: "returnTransfer", type: "inventory.transfer", sourceSegmentIds: ["returnParagraph"], data: { fromId: "player", toId: "neighbor", itemId: "rice", quantity: 2 } },
      { id: "closePromise", type: "commitment.resolve", sourceSegmentIds: ["returnParagraph"], data: { id: "debt", status: "fulfilled" } },
      { id: "advanceDay", type: "situation.update", sourceSegmentIds: ["returnParagraph"], data: { day: 11 } },
    ],
    experiences: [],
  });
  assert.deepEqual(returned.state.inventory, [{ ownerId: "neighbor", itemId: "rice", quantity: 3 }]);
  assert.equal(returned.state.commitments.debt.status, "fulfilled");
  assert.equal(returned.state.situation.day, 11);
  assert.equal(result.state.commitments.debt.status, "open");
});

test("a later invalid event leaves every caller-owned value unchanged", () => {
  const state = seed();
  const bundle = borrow();
  bundle.events.push({ id: "overspend", type: "inventory.adjust", sourceSegmentIds: ["paragraph"], data: { ownerId: "player", itemId: "rice", delta: -3 } });
  const before = structuredClone({ state, bundle });
  failure(() => applyTurnBundle(state, bundle));
  assert.deepEqual({ state, bundle }, before);
});

test("inventory shortages have a fixed safe diagnostic without weakening transfer or removal checks", () => {
  for (const event of [
    { id: "transfer", type: "inventory.transfer", sourceSegmentIds: ["s"], data: { fromId: "neighbor", toId: "player", itemId: "rice", quantity: 4 } },
    { id: "remove", type: "inventory.adjust", sourceSegmentIds: ["s"], data: { ownerId: "neighbor", itemId: "rice", delta: -4 } },
  ]) {
    const state = seed();
    const bundle = { narration: [{ id: "s", text: "邻居拿出米。" }], events: [event], experiences: [] };
    const before = structuredClone({ state, bundle });
    assert.throws(() => applyTurnBundle(state, bundle), (error) => {
      assert.equal(error.code, "TURN_VALIDATION_FAILED");
      assert.equal(error.reason, "INSUFFICIENT_INVENTORY");
      assert.deepEqual(error.issues, ["bundle.events[0].data: insufficient inventory"]);
      assert.doesNotMatch(error.message, /neighbor|player|rice|quantity.*4|delta.*4/);
      return true;
    });
    assert.deepEqual({ state, bundle }, before);
  }
});

test("destination overflow cannot debit the sender or partially resolve a promise", () => {
  const state = applyTurnBundle(seed(), borrow()).state;
  state.inventory.find((entry) => entry.ownerId === "neighbor").quantity = 1_000_000_000;
  const before = structuredClone(state);
  failure(() => applyTurnBundle(state, {
    narration: [{ id: "s", text: "你把米归还。" }],
    events: [
      { id: "resolve", type: "commitment.resolve", sourceSegmentIds: ["s"], data: { id: "debt", status: "fulfilled" } },
      { id: "transfer", type: "inventory.transfer", sourceSegmentIds: ["s"], data: { fromId: "player", toId: "neighbor", itemId: "rice", quantity: 2 } },
    ],
    experiences: [],
  }));
  assert.deepEqual(state, before);
});

test("a resolved commitment cannot be resolved a second time", () => {
  const state = applyTurnBundle(seed(), borrow()).state;
  const cancellation = {
    narration: [{ id: "s", text: "邻居免除了你的归还承诺。" }],
    events: [{ id: "cancel", type: "commitment.resolve", sourceSegmentIds: ["s"], data: { id: "debt", status: "cancelled" } }],
    experiences: [],
  };
  const cancelled = applyTurnBundle(state, cancellation).state;
  assert.equal(cancelled.commitments.debt.status, "cancelled");
  failure(() => applyTurnBundle(cancelled, cancellation));
});

test("claim-only narration cannot grant an item by itself", () => {
  const state = seed();
  state.entities.player.attributes.status = "疲惫";
  const result = applyTurnBundle(state, {
    narration: [{ id: "s", text: "邻居声称明天有米，但拒绝了你今天的请求。" }],
    events: [],
    experiences: [{ id: "claim", text: "邻居声称明天有米。", entityIds: ["neighbor", "rice"], eventIds: [], sourceSegmentIds: ["s"], kind: "claim", knownBy: ["player"] }],
  });
  assert.deepEqual(result.state, state);
  assert.deepEqual(projectPlayerState(result.state).inventory, []);
});

test("new entities may be referenced by later events and experiences only after creation", () => {
  const bundle = {
    narration: [{ id: "s", text: "你捡起钥匙，随后得知它叫银匙。" }],
    events: [
      { id: "create", type: "entity.create", sourceSegmentIds: ["s"], data: { entity: { id: "key", kind: "item", name: "钥匙", aliases: [], visibility: "player", attributes: { condition: "完整" } } } },
      { id: "gain", type: "inventory.adjust", sourceSegmentIds: ["s"], data: { ownerId: "player", itemId: "key", delta: 1 } },
      { id: "rename", type: "entity.update", sourceSegmentIds: ["s"], data: { id: "key", name: "银匙", aliases: ["钥匙"], attributes: { condition: "划痕", weight: 0.1 } } },
    ],
    experiences: [{ id: "x", text: "你捡起一把后来被称为银匙的钥匙。", entityIds: ["key"], eventIds: ["create", "gain", "rename"], sourceSegmentIds: ["s"], kind: "event", knownBy: ["player"] }],
  };
  const result = applyTurnBundle(seed(), bundle);
  assert.equal(result.state.entities.key.name, "银匙");
  assert.deepEqual(result.state.entities.key.aliases, ["钥匙"]);
  assert.deepEqual(result.state.entities.key.attributes, { condition: "划痕", weight: 0.1 });
  result.bundle.events[0].data.entity.attributes.condition = "改写候选";
  result.bundle.events[2].data.attributes.condition = "改写更新";
  assert.equal(result.state.entities.key.attributes.condition, "划痕");
  const outOfOrder = structuredClone(bundle);
  [outOfOrder.events[0], outOfOrder.events[1]] = [outOfOrder.events[1], outOfOrder.events[0]];
  failure(() => applyTurnBundle(seed(), outOfOrder));
});

function entityUpdates(...changes) {
  return { narration: [{ id: "s", text: "人物、物品和周围环境的当前情况发生了变化。" }],
    events: changes.map((data, index) => ({ id: `update-${index}`, type: "entity.update", sourceSegmentIds: ["s"], data })), experiences: [] };
}

function sourcedUpdates(text, ...changes) {
  const candidate = entityUpdates(...changes);
  candidate.narration[0].text = text;
  return candidate;
}


function statusFailure(run, path, reason) {
  assert.throws(run, (error) => {
    assert.equal(error.code, "TURN_VALIDATION_FAILED");
    assert.equal(error.reason, "INVALID_TURN_STRUCTURE");
    assert.deepEqual(error.issues, [`${path}: ${reason}`]);
    return true;
  });
}

test("ordinary observation and other changes need no condition event and preserve the previous condition", () => {
  const state = seed(); state.entities.player.attributes = { status: "疲惫，右手已包扎", occupation: "面点工" };
  const observed = { narration: [{ id: "s", text: "你站起来，望向邻居；没有喝汤，也没走出庭院。" }], events: [], experiences: [] };
  assert.deepEqual(applyTurnBundle(state, observed).state, state);
  const changed = applyTurnBundle(state, entityUpdates({ id: "neighbor", attributes: { description: "仍坐在门旁。" } })).state;
  assert.deepEqual(changed.entities.player, state.entities.player);
  const noCondition = seed();
  assert.deepEqual(applyTurnBundle(noCondition, observed).state, noCondition, "absence does not invent a normal or infection state");
});

test("legacy condition snapshots remain readable while all new character body attributes are forbidden", () => {
  const keys = ["status", "condition", "health", "injuries", "hunger", "thirst", "fatigue", "localizedStatus", "localized_status"];
  for (const key of keys) for (const value of [null, "", "疲惫", { old: true }]) {
    const state = seed(); state.entities.player.attributes[key] = value;
    assert.deepEqual(validateInitialState(state), state);
    assert.deepEqual(applyTurnBundle(state, { narration: [{ id: "s", text: "你看向庭院。" }], events: [], experiences: [] }).state, state);
    for (const target of ["player", "neighbor"]) statusFailure(() => applyTurnBundle(state, entityUpdates({ id: target, attributes: { [key]: value } })),
      `bundle.events[0].data.attributes.${key}`, "character conditions must be written through condition events");
  }
  for (const kind of ["item", "location"]) {
    const target = kind === "item" ? "rice" : "courtyard";
    assert.equal(applyTurnBundle(seed(), entityUpdates({ id: target, attributes: { condition: "潮湿", status: "完好" } })).state.entities[target].attributes.condition, "潮湿");
    statusFailure(() => applyTurnBundle(seed(), entityUpdates({ id: target, attributes: { status: "" } })),
      "bundle.events[0].data.attributes.status", "must be nonempty text of at most 512 characters");
  }
  let invoked = false; const attrs = {};
  Object.defineProperty(attrs, "status", { enumerable: true, get() { invoked = true; return "疲惫"; } });
  failure(() => applyTurnBundle(seed(), entityUpdates({ id: "player", attributes: attrs })));
  assert.equal(invoked, false);
});

test("new characters receive empty engine records while statusFrom and model-supplied records stay forbidden", () => {
  const candidate = { narration: [{ id: "s", text: "一名邻居走进庭院。" }], experiences: [], events: [
    { id: "create", type: "entity.create", sourceSegmentIds: ["s"], data: { entity: {
      id: "visitor", kind: "character", name: "来客", aliases: [], visibility: "player", attributes: { description: "一位邻居。", mood: "谨慎" },
    } } },
  ] };
  const result = applyTurnBundle(seed(), candidate);
  assert.deepEqual(result.state.entities.visitor.conditionRecords, { format: "body-conditions-1", items: [] });
  assert.deepEqual(result.state.entities.visitor.attributes, candidate.events[0].data.entity.attributes);
  for (const key of ["status", "health", "fatigue"]) {
    const invalid = structuredClone(candidate); invalid.events[0].data.entity.attributes[key] = "不允许旧写入口";
    failure(() => applyTurnBundle(seed(), invalid));
  }
  const supplied = structuredClone(candidate); supplied.events[0].data.entity.conditionRecords = { format: "body-conditions-1", items: [] };
  failure(() => applyTurnBundle(seed(), supplied));
  statusFailure(() => applyTurnBundle(seed(), entityUpdates({ id: "player", statusFrom: { segmentId: "s" } })),
    "bundle.events[0].data.statusFrom", "unknown field");
});

test("already saved opening candidates confirm without inventing or converting condition evidence", () => {
  const { createOpeningState } = require("./session-opening");
  const initial = seed(); initial.entities.player.attributes = { status: "旧值".repeat(300), localizedStatus: { en: "Tired" }, fatigue: "疲劳", occupation: "面点工" };
  const pending = createOpeningState();
  pending.opening = { phase: "awaiting_confirmation", draft: {}, proposal: {
    proposalId: "chosen", initialState: initial, summary: { revision: 1, segmentIds: ["old-summary"] },
  } };
  assert.deepEqual(validateInitialState(pending), pending);
  const confirmation = { narration: [{ id: "s", text: "你听见邻居敲门。" }], experiences: [], events: [
    { id: "confirm", type: "opening.confirm", sourceSegmentIds: ["s"], data: { proposalId: "chosen" } },
  ] };
  const ready = applyTurnBundle(pending, confirmation, { baseRevision: 1 }).state;
  assert.deepEqual(ready.entities, initial.entities);
  assert.deepEqual(applyTurnBundle(ready, { narration: [{ id: "s", text: "你没有开门。" }], events: [], experiences: [] }, { baseRevision: 2 }).state, ready);
  failure(() => applyTurnBundle(ready, entityUpdates({ id: "player", attributes: { status: "新值" }, removeAttributes: ["fatigue", "localizedStatus"] })));
  assert.deepEqual(ready.entities, initial.entities);
});

test("a new free turn keeps its protagonist player-visible without changing other entities or old snapshots", () => {
  const state = seed();
  const patch = { id: "player", visibility: "hidden" };
  statusFailure(() => applyTurnBundle(state, entityUpdates(patch)), "bundle.events[0].data.visibility",
    "current player must remain player-visible");
  // player/hidden are the only actual enum values; these aliases never grant
  // another visibility policy or bypass the ordinary event schema.
  for (const visibility of ["world", "knowledge-only"]) failure(() => applyTurnBundle(state, entityUpdates({ ...patch, visibility })));
  const late = entityUpdates({ id: "player", attributes: { occupation: "维修工" } }, { id: "player", visibility: "hidden" });
  statusFailure(() => applyTurnBundle(state, late), "bundle.events[1].data.visibility", "current player must remain player-visible");
  const restored = applyTurnBundle(state, entityUpdates(patch, { id: "player", visibility: "player" }, { id: "neighbor", visibility: "hidden" })).state;
  assert.equal(restored.entities.player.visibility, "player", "the final state is checked, not a temporary intermediate patch");
  assert.equal(restored.entities.neighbor.visibility, "hidden", "world information still uses its existing visibility rules");
  const old = structuredClone(state); old.entities.player.visibility = "hidden";
  assert.deepEqual(validateInitialState(old), old);
  assert.equal(projectPlayerState(old).situation.playerId, null, "reading an existing snapshot does not rewrite it");
  statusFailure(() => applyTurnBundle(old, entityUpdates({ id: "player", attributes: {} })),
    "bundle.events", "current player must remain player-visible");
  assert.equal(applyTurnBundle(old, entityUpdates({ ...patch, visibility: "player" })).state.entities.player.visibility, "player");
});

test("ordinary and extreme endings need no forced condition update but retain final visibility and ordering", () => {
  const decision = (type, data) => ({ id: "decision", type, data, sourceSegmentIds: ["s"] });
  const candidate = event => ({ narration: [{ id: "s", text: "你回应了旅程的去向。" }], events: [event], experiences: [] });
  const initial = seed(); initial.entities.player.attributes.status = "疲惫";
  const ordinary = applyTurnBundle(initial, candidate(decision("finale.propose", { candidateId: "ending", closureReason: "旅程已告一段落。", closedThreads: ["已告别"], intentionalOpenThreads: [], finaleTone: "平静" })), { baseRevision: 0 }).state;
  let special = applyTurnBundle(initial, candidate(decision("extreme.propose", { candidateId: "ending", characterId: "player", intentReason: "虚构角色明确提出结束自己的旅程。", fictionalContext: "本合成游戏角色的明确决定。" })), { baseRevision: 0 }).state;
  for (const baseRevision of [1, 2]) special = applyTurnBundle(special, candidate(decision("extreme.confirm", { candidateId: "ending" })), { baseRevision }).state;
  for (const outcome of [null, "standard_extreme_ending", "grey_crow_view"]) {
    const prior = outcome ? special : ordinary;
    const bundle = candidate(decision(outcome ? "extreme.confirm" : "finale.confirm", { candidateId: "ending" }));
    const options = outcome ? { baseRevision: 3, terminalReservation: { actionId: "end", baseRevision: 3, candidateId: "ending", outcome } } : { baseRevision: 1 };
    const late = structuredClone(bundle); late.events.push({ id: "late", type: "situation.update", sourceSegmentIds: ["s"], data: { day: 11 } });
    failure(() => applyTurnBundle(prior, late, options));
    const hidden = structuredClone(bundle); hidden.events.unshift({ id: "hide", type: "entity.update", sourceSegmentIds: ["s"], data: { id: "player", visibility: "hidden" } });
    statusFailure(() => applyTurnBundle(prior, hidden, options), "bundle.events[0].data.visibility", "current player must remain player-visible");
    const closed = applyTurnBundle(prior, bundle, options).state;
    assert.equal(closed.finale.phase, "confirmed"); assert.equal(closed.entities.player.attributes.status, "疲惫");
    failure(() => applyTurnBundle(closed, bundle, options));
  }
});

test("the store rejects invalid condition or hidden player atomically while unchanged conditions survive restart", (t) => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { createTurnStore } = require("./turn-store");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-player-condition-"));
  const options = { databasePath: path.join(directory, "session.sqlite"), adventureId: "condition-adventure", locale: "zh-CN", contentVersion: "test-v1" };
  let store; t.after(() => { store?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const oldState = seed(); oldState.entities.player.attributes.status = "疲惫，右手已包扎";
  store = createTurnStore({ ...options, initialState: oldState }); store.close(); store = createTurnStore(options);
  assert.deepEqual(store.readModelState(), oldState);
  const request = { actionId: "borrow", baseRevision: 0, input: "向邻居借两袋米。", locale: options.locale, contentVersion: options.contentVersion };
  const action = store.beginAction(request);
  const invalid = borrow(); invalid.events.push(playerCondition("")); invalid.events.at(-1).sourceSegmentIds = ["paragraph"];
  failure(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: invalid }));
  assert.equal(store.readView().revision, 0); assert.deepEqual(store.readView().history, []); assert.deepEqual(store.readModelState(), oldState);
  const hidden = borrow(); hidden.events.push({ id: "hide", type: "entity.update", sourceSegmentIds: ["paragraph"], data: { id: "player", visibility: "hidden" } });
  statusFailure(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: hidden }),
    "bundle.events[2].data.visibility", "current player must remain player-visible");
  assert.deepEqual(store.readModelState(), oldState); assert.equal(store.readAction(action.actionId).status, "running");
  store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: borrow() }); store.close(); store = createTurnStore(options);
  const view = store.readView(); assert.equal(view.revision, 1); assert.equal(view.history.length, 1);
  assert.deepEqual(store.readModelState().entities.player.attributes, oldState.entities.player.attributes);
  assert.deepEqual(store.readModelState({ revision: 0 }), oldState);
  assert.equal(store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: invalid }).status, "committed");
  assert.deepEqual(store.readView().history, view.history);
});

test("single-attribute updates preserve identity and descriptions for characters, items and locations", () => {
  const state = seed();
  state.entities.player.attributes = { status: "疲惫", occupation: "维修工", description: "在街区里生活多年。", age: 41, height: 170 };
  state.entities.neighbor.attributes = { status: "警惕", description: "住在隔壁的老人。" };
  state.entities.rice.attributes = { status: "封口完好", description: "印着蓝色商标的米袋。" };
  state.entities.courtyard.attributes = { status: "安静", description: "中央有一棵老树。" };
  const current = { player: { occupation: "钳工" }, neighbor: { mood: "谨慎" }, rice: { condition: "包装受潮" }, courtyard: { condition: "积水" } };
  const bundle = { narration: [{ id: "s", text: "你的右手擦伤已止血，邻居疲惫地包好脚踝；雨水漫进庭院，米袋包装受潮。" }],
    events: Object.keys(current).map((id) => ({ id: `update-${id}`, type: "entity.update", sourceSegmentIds: ["s"], data: { id, attributes: current[id] } })), experiences: [] };
  const original = structuredClone({ state, bundle });
  const result = applyTurnBundle(state, bundle);
  for (const id of Object.keys(state.entities)) {
    assert.deepEqual(result.state.entities[id].attributes, { ...state.entities[id].attributes, ...current[id] });
  }
  assert.deepEqual(projectPlayerState(result.state).entities.player.attributes,
    { status: "疲惫", occupation: current.player.occupation, description: "在街区里生活多年。", age: 41, height: 170 });
  assert.deepEqual({ state, bundle }, original);
  result.bundle.events[0].data.attributes.occupation = "修改返回的候选";
  result.bundle.narration[0].text = "修改返回的候选";
  assert.equal(result.state.entities.player.attributes.occupation, current.player.occupation);
});

test("entity attributes merge only top-level keys while nested values and aliases remain explicit replacements", () => {
  const state = seed();
  state.entities.player.attributes = { occupation: "维修工", profile: { height: 170, note: "旧记录" }, tags: ["谨慎", "安静"], status: "疲惫" };
  state.entities.player.aliases = ["阿林", "师傅"];
  const changed = applyTurnBundle(state, sourcedUpdates("清醒", { id: "player", attributes: { profile: { note: "新记录" }, tags: ["谨慎"], mood: null }, aliases: [] })).state;
  assert.deepEqual(changed.entities.player.attributes, { occupation: "维修工", profile: { note: "新记录" }, tags: ["谨慎"], mood: null, status: "疲惫" });
  assert.deepEqual(changed.entities.player.aliases, []);
  assert.deepEqual(applyTurnBundle(changed, sourcedUpdates("清醒", { id: "player", attributes: {} })).state, changed);
});

test("explicit attribute removal can delete selected or all existing keys without persisting the command", () => {
  const state = seed();
  state.entities.player.attributes = { age: 41, description: "待纠正的旧记录", status: "疲惫", "身份备注": "尚未确认" };
  state.entities.neighbor.attributes = { age: 41, description: "待纠正的旧记录", "身份备注": "尚未确认" };
  const changed = applyTurnBundle(state, sourcedUpdates("清醒", { id: "player", removeAttributes: ["age", "description", "身份备注"] })).state;
  assert.deepEqual(changed.entities.player.attributes, { status: "疲惫" });
  assert.equal(Object.hasOwn(changed.entities.player, "removeAttributes"), false);
  const cleared = applyTurnBundle(state, sourcedUpdates("疲惫", { id: "neighbor", removeAttributes: Object.keys(state.entities.neighbor.attributes) })).state;
  assert.deepEqual(cleared.entities.neighbor.attributes, {});
  const replaced = applyTurnBundle(state, sourcedUpdates("疲惫", { id: "neighbor", attributes: { occupation: "医生" }, removeAttributes: Object.keys(state.entities.neighbor.attributes) })).state;
  assert.deepEqual(replaced.entities.neighbor.attributes, { occupation: "医生" });
  const sequential = applyTurnBundle(state, sourcedUpdates("疲惫", { id: "player", attributes: { temporary: true } }, { id: "player", removeAttributes: ["temporary"] })).state;
  assert.deepEqual(sequential, state);
});

test("entity attribute deletion rejects unknown, conflicting, duplicate, unsafe and oversized keys atomically", () => {
  const state = seed();
  state.entities.player.attributes = { age: 41, status: "疲惫" };
  for (const patch of [
    { removeAttributes: ["missing"] }, { removeAttributes: ["age", "age"] },
    { attributes: { age: 42 }, removeAttributes: ["age"] },
    { removeAttributes: ["__proto__"] }, { removeAttributes: ["constructor"] }, { removeAttributes: ["prototype"] },
    { removeAttributes: ["x".repeat(513)] }, { removeAttributes: Array.from({ length: 129 }, (_, index) => `key-${index}`) },
    { removeAttributes: null }, { removeAttributes: "age" }, { removeAttributes: [42] },
    { unknownField: true },
  ]) {
    const bundle = sourcedUpdates("先发生的更新", { id: "player", attributes: { occupation: "已确认" } }, { id: "player", ...patch });
    const before = structuredClone({ state, bundle });
    failure(() => applyTurnBundle(state, bundle));
    assert.deepEqual({ state, bundle }, before);
  }
});

test("entity attribute limits apply to the final merged set and allow bounded explicit replacement", () => {
  const state = seed();
  state.entities.player.attributes = { status: "疲惫", ...Object.fromEntries(Array.from({ length: 127 }, (_, index) => [`key-${index}`, index])) };
  failure(() => applyTurnBundle(state, entityUpdates({ id: "player", attributes: { newKey: true } })));
  const updated = applyTurnBundle(state, sourcedUpdates("疲惫", { id: "player", attributes: { newKey: true }, removeAttributes: ["key-0"] })).state;
  assert.equal(Object.keys(updated.entities.player.attributes).length, 128);
  assert.equal(Object.hasOwn(updated.entities.player.attributes, "key-0"), false);
  assert.equal(updated.entities.player.attributes.newKey, true);
  const noStatus = seed();
  noStatus.entities.player.attributes = Object.fromEntries(Array.from({ length: 128 }, (_, index) => [`key-${index}`, index]));
  statusFailure(() => applyTurnBundle(noStatus, sourcedUpdates("你仍然疲惫。", { id: "player", attributes: { newKey: true } })),
    "bundle.events[0].data.attributes", "too many attributes");
});

test("hidden entities, their holdings, and player commitments to them do not leak in the view", () => {
  const state = applyTurnBundle(seed(), borrow()).state;
  state.entities.neighbor.visibility = "hidden";
  state.entities.courtyard.visibility = "hidden";
  state.entities.secret = { id: "secret", kind: "item", name: "秘密物品", aliases: [], visibility: "hidden", attributes: {} };
  state.inventory.push({ ownerId: "player", itemId: "secret", quantity: 1 });
  const view = projectPlayerState(state);
  assert.deepEqual(Object.keys(view.entities), ["player", "rice"]);
  assert.deepEqual(view.inventory, [{ ownerId: "player", itemId: "rice", quantity: 2 }]);
  assert.deepEqual(view.commitments, {});
  assert.deepEqual(view.situation, { playerId: "player", locationId: null, day: 10 });
  view.entities.player.name = "改名";
  assert.equal(state.entities.player.name, "旅人");
});

test("invalid quantities, dangling provenance, and mutable experience fields are rejected", () => {
  for (const change of [
    (bundle) => { bundle.events[0].data.quantity = 4; },
    (bundle) => { bundle.events[0].data.quantity = 0.5; },
    (bundle) => { bundle.events[0].data.quantity = 0; },
    (bundle) => { bundle.events[0].data.toId = "missing"; },
    (bundle) => { bundle.events[0].data.itemId = "courtyard"; },
    (bundle) => { bundle.events[0].sourceSegmentIds = []; },
    (bundle) => { bundle.events[0].sourceSegmentIds = ["yesterday"]; },
    (bundle) => { bundle.events[1].id = "transfer"; },
    (bundle) => { bundle.experiences[0].eventIds = ["yesterday"]; },
    (bundle) => { bundle.experiences[0].knownBy = ["rice"]; },
    (bundle) => { bundle.experiences[0].status = "open"; },
    (bundle) => { bundle.events[0].type = "arbitrary.write"; },
  ]) {
    const bundle = borrow();
    change(bundle);
    failure(() => applyTurnBundle(seed(), bundle));
  }
});

test("JSON validation rejects unsafe objects without invoking their getters", () => {
  let getterCalled = false;
  const getterState = seed();
  Object.defineProperty(getterState.entities.player.attributes, "secret", {
    enumerable: true,
    get() { getterCalled = true; throw new Error("must not run"); },
  });
  const dangerousKey = seed();
  dangerousKey.entities.player.attributes = JSON.parse('{"__proto__":{"polluted":true}}');
  const cyclic = seed();
  cyclic.entities.player.attributes.cycle = cyclic;
  const sparse = seed();
  sparse.inventory = Array(1);
  const date = seed();
  date.entities.player.attributes.timestamp = new Date();
  const nonfinite = seed();
  nonfinite.entities.player.attributes.number = Infinity;
  const symbol = seed();
  symbol[Symbol("private")] = "secret";
  for (const state of [getterState, dangerousKey, cyclic, sparse, date, nonfinite, symbol]) {
    failure(() => validateInitialState(state));
  }
  assert.equal(getterCalled, false);
  assert.equal({}.polluted, undefined);
});

test("initial state needs a real player/location and rejects ambiguous duplicate holdings", () => {
  failure(() => validateInitialState({ entities: {}, inventory: [], commitments: {}, situation: { playerId: "player", locationId: "courtyard", day: 10 } }));
  for (const change of [
    (state) => { state.situation.playerId = "rice"; },
    (state) => { state.situation.locationId = "neighbor"; },
    (state) => { state.situation.day = -1; },
    (state) => { state.entities.player.id = "someoneElse"; },
    (state) => { state.inventory.push({ ownerId: "neighbor", itemId: "rice", quantity: 1 }); },
  ]) {
    const state = seed();
    change(state);
    failure(() => validateInitialState(state));
  }
  const state = seed();
  state.inventory.push({ ownerId: "player", itemId: "rice", quantity: 0 });
  assert.equal(validateInitialState(state).inventory.length, 1);
  assert.equal(state.inventory.length, 2);
});

test("long narration remains intact rather than being truncated into a different story", () => {
  const narration = "你留在庭院里观察。" + "这是长篇叙述。".repeat(10_000);
  const result = applyTurnBundle(seed(), { narration: [{ id: "long", text: narration }], events: [], experiences: [] });
  assert.equal(result.bundle.narration[0].text, narration);
});

test("experience corrections preserve source references and reject ambiguous replacements", () => {
  const bundle = borrow();
  bundle.experiences[0].supersedes = [{ revision: 1, experienceId: "earlier-claim" }];
  const corrected = applyTurnBundle(seed(), bundle);
  assert.deepEqual(corrected.bundle.experiences[0].supersedes, [{ revision: 1, experienceId: "earlier-claim" }]);
  // Whether revision 1 exists or predates this turn belongs to the store.
  for (const supersedes of [
    [{ revision: 0, experienceId: "earlier-claim" }],
    [{ revision: 1.5, experienceId: "earlier-claim" }],
    [{ revision: 1, experienceId: "bad id" }],
    [{ revision: 1, experienceId: "earlier-claim", status: "retracted" }],
    [{ revision: 1, experienceId: "earlier-claim" }, { revision: 1, experienceId: "earlier-claim" }],
  ]) {
    bundle.experiences[0].supersedes = supersedes;
    failure(() => applyTurnBundle(seed(), bundle));
  }
});

test("source-only experiences retain knowledge and correction links without rewriting legacy candidates", () => {
  const candidate = borrow();
  delete candidate.experiences[0].text;
  candidate.experiences[0].kind = "claim";
  candidate.experiences[0].supersedes = [{ revision: 1, experienceId: "earlier-account" }];
  const before = structuredClone(candidate);
  const result = applyTurnBundle(seed(), candidate);
  assert.deepEqual(result.bundle, before);
  assert.deepEqual(candidate, before);
  assert.equal(Object.hasOwn(result.bundle.experiences[0], "text"), false);
  const legacy = borrow();
  assert.deepEqual(applyTurnBundle(seed(), legacy).bundle, legacy);
  for (const value of [null, undefined, 42, "", "   ", "x".repeat(16001)]) {
    const invalid = structuredClone(candidate);
    invalid.experiences[0].text = value;
    failure(() => applyTurnBundle(seed(), invalid));
  }
  for (const change of [
    experience => { experience.sourceSegmentIds = []; },
    experience => { experience.sourceSegmentIds = ["not-in-this-turn"]; },
    experience => { experience.knownBy = ["rice"]; },
    experience => { experience.eventIds = ["earlier-action"]; },
  ]) {
    const invalid = structuredClone(candidate);
    change(invalid.experiences[0]);
    failure(() => applyTurnBundle(seed(), invalid));
  }
});

test("fragment and world changes are one candidate: quota failure cannot keep its inventory effect", () => {
  const fragment = (number) => ({ id: `fragment-event-${number}`, type: "memory_fragment.record", sourceSegmentIds: ["paragraph"], data: {
    discoveryMode: "active_recall", dimension: "body", trigger: `触发物${number}`, content: `片段${number}，并不能确认真实过去。`,
  } });
  const opts = { adventureId: "adventure", baseRevision: 0, memoryFragmentsEnabled: true };
  const state = applyTurnBundle(seed(), { narration: [{ id: "paragraph", text: fragment(1).data.content }],
    events: [fragment(1)], experiences: [] }, opts).state;
  const candidate = borrow(); candidate.events.push(fragment(2));
  candidate.narration[0].text += fragment(2).data.content;
  const before = structuredClone({ state, candidate });
  failure(() => applyTurnBundle(state, candidate, { ...opts, baseRevision: 1 }));
  assert.deepEqual({ state, candidate }, before);
  assert.equal(state.commitments.debt, undefined);
  assert.equal(state.memoryFragments.fragments.length, 1);
});

test("opening creation, model proposals and confirmation's first scene cannot prefill fragments", () => {
  const { createOpeningState } = require("./session-opening");
  const { createEmptyMemoryFragments } = require("./session-memory-fragments");
  const opts = { adventureId: "adventure", baseRevision: 0, memoryFragmentsEnabled: true };
  const opening = createOpeningState(); opening.memoryFragments = createEmptyMemoryFragments();
  const fragment = { id: "fragment", type: "memory_fragment.record", sourceSegmentIds: ["s"], data: {
    discoveryMode: "passive_association", dimension: "emotion", trigger: "旧铃声", content: "铃声像曾在某处听过，无法确定。",
  } };
  const turn = (events) => ({ narration: [{ id: "s", text: "角色和开场情况供你确认。"
    + (events.includes(fragment) ? fragment.data.content : "") }], events, experiences: [] });
  assert.equal(applyTurnBundle(opening, turn([]), opts).state.opening.phase, "creating");
  failure(() => applyTurnBundle(opening, turn([fragment]), opts));
  for (const value of [createEmptyMemoryFragments(), null, false]) {
    failure(() => applyTurnBundle(opening, turn([{ id: "proposal", type: "opening.propose", sourceSegmentIds: ["s"], data: {
      proposalId: "proposal-1", initialState: { ...seed(), memoryFragments: value },
    } }]), opts));
  }
  const proposed = applyTurnBundle(opening, turn([{ id: "proposal", type: "opening.propose", sourceSegmentIds: ["s"], data: { proposalId: "proposal-1", initialState: seed() } }]), opts).state;
  const confirmation = { id: "confirm", type: "opening.confirm", sourceSegmentIds: ["s"], data: { proposalId: "proposal-1" } };
  failure(() => applyTurnBundle(proposed, turn([confirmation, fragment]), { ...opts, baseRevision: 1 }));
  const confirmed = applyTurnBundle(proposed, turn([confirmation]), { ...opts, baseRevision: 1 }).state;
  assert.equal(confirmed.opening.phase, "ready");
  assert.deepEqual(confirmed.memoryFragments, createEmptyMemoryFragments());
  assert.deepEqual(applyTurnBundle(confirmed, turn([]), { ...opts, baseRevision: 2 }).state, confirmed);
  const played = applyTurnBundle(confirmed, turn([fragment]), { ...opts, baseRevision: 2 });
  assert.equal(played.state.memoryFragments.fragments.length, 1);
  assert.equal(played.state.memoryFragments.fragments[0].source.revision, 3);
  const backdated = structuredClone(played.state);
  backdated.memoryFragments.fragments[0].source.revision = 2;
  failure(() => validateInitialState(backdated));
});
