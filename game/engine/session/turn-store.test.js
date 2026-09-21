'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createTurnStore } = require('./turn-store');
const { projectSessionView } = require('./session-projection');
const samples = require('./test-fixtures/turn-samples');
const { createOpeningState } = require('./session-opening');

function sandbox(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grey-crow-turn-store-'));
  const stores = [];
  t.after(() => {
    for (const store of stores.reverse()) store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    databasePath: path.join(directory, 'adventure.sqlite'),
    open(overrides = {}) {
      const store = createTurnStore({ ...samples.identity(this.databasePath), ...overrides });
      stores.push(store);
      return store;
    },
  };
}

function code(expected) {
  return (error) => {
    assert.equal(error.code, expected, error.stack);
    return true;
  };
}

test('location flow preserves scene identity, historical states and projection across reopening', (t) => {
  const env = sandbox(t);
  const initialState = samples.initialState();
  initialState.entities.home.name = '后屋';
  const originalRoom = structuredClone(initialState.entities.home);
  let store = env.open({ initialState });
  const snapshots = [store.readModelState({ revision: 0 })];
  const courtyard = { id: 'courtyard', kind: 'location', name: '门外小院', aliases: [],
    visibility: 'player', attributes: { description: '后屋门外、围墙内的小院。' } };

  // The live R10 failure omitted a movement event despite crossing a threshold.
  // These authored events test persistence and projection, not model adjudication.
  function commit(actionId, input, narration, events) {
    const baseRevision = store.readView().revision;
    const action = store.beginAction(samples.request({ actionId, baseRevision, input }));
    const committed = store.commitAction({ actionId, attemptId: action.attemptId,
      bundle: { narration, events, experiences: [] } });
    assert.equal(committed.status, 'committed');
    assert.equal(committed.view.revision, baseRevision + 1);
    assert.deepEqual(committed.view.narration, narration);
    for (const [revision, state] of snapshots.entries()) {
      assert.deepEqual(store.readModelState({ revision }), state, `revision ${revision} remains unchanged`);
    }
    snapshots.push(store.readModelState({ revision: baseRevision + 1 }));
    return projectSessionView(committed.view, { delivery: 'commit' });
  }

  const outside = commit('step-outside', '我跨过后屋门槛，走进门外的小院。',
    [{ id: 'outside', text: '你跨过门槛，走进后屋门外、围墙内的小院，在院内停住。' }], [
      { id: 'create-courtyard', type: 'entity.create', sourceSegmentIds: ['outside'], data: { entity: courtyard } },
      { id: 'enter-courtyard', type: 'situation.update', sourceSegmentIds: ['outside'], data: { locationId: 'courtyard' } },
    ]);
  assert.equal(snapshots[1].situation.locationId, 'courtyard');
  assert.deepEqual(snapshots[1].entities.courtyard, courtyard);
  assert.deepEqual(snapshots[1].entities.home, originalRoom);
  assert.equal(outside.state_hint.scene.location_name, '门外小院');
  assert.equal(outside.envelope.state_hint.scene.location_name, '门外小院');

  const observed = commit('observe-from-courtyard', '我留在小院里，看看围墙外那条街。',
    [{ id: 'observe', text: '你仍站在小院里，朝围墙外望去，只看见街边的树梢，没有走出院门。' }], []);
  assert.deepEqual(snapshots[2], snapshots[1], 'observation alone leaves the entire current state unchanged');
  assert.equal(observed.state_hint.scene.location_name, '门外小院');

  const returned = commit('return-to-room', '我回到刚才的后屋。',
    [{ id: 'return', text: '你原路跨过门槛，回到刚才的后屋，在屋内停下。' }], [
      { id: 'return-home', type: 'situation.update', sourceSegmentIds: ['return'], data: { locationId: 'home' } },
    ]);
  assert.equal(snapshots[3].situation.locationId, 'home');
  assert.deepEqual(snapshots[3].entities.home, originalRoom, 'returning does not rename or replace the original place');
  assert.deepEqual(snapshots[3].entities.courtyard, courtyard);
  assert.deepEqual(Object.values(snapshots[3].entities).filter(entity => entity.kind === 'location')
    .map(entity => entity.id).sort(), ['courtyard', 'home']);
  assert.equal(returned.state_hint.scene.location_name, '后屋');

  store.close();
  store = env.open();
  const recovered = projectSessionView(store.readView(), { delivery: 'recovery' });
  assert.equal(recovered.revision, 3);
  assert.equal(recovered.state_hint.scene.location_name, '后屋');
  for (const [revision, state] of snapshots.entries()) {
    assert.deepEqual(store.readModelState({ revision }), state, `reopened revision ${revision} preserves its own state`);
    const projected = projectSessionView(store.readView({ revision }), { delivery: 'recovery' });
    assert.equal(projected.state_hint.scene.location_name, [0, 3].includes(revision) ? '后屋' : '门外小院');
  }
});

test('pending input survives reopening at the current revision without reviving superseded actions', (t) => {
  const env = sandbox(t);
  let store = env.open({ initialState: samples.initialState() });
  assert.equal(store.readPendingAction(), null);
  const input = samples.request({ actionId: 'pending-original', input: '我轻轻敲门，等对方回应。' });
  const started = store.beginAction(input);
  const pending = store.readPendingAction({ revision: 0 });
  assert.deepEqual(pending, { adventureId: 'test-adventure', ...input, status: 'running', attemptId: started.attemptId });
  pending.input = 'cannot modify the stored input';
  assert.equal(store.readPendingAction().input, input.input);
  store.close(); store = env.open();
  assert.deepEqual(store.readPendingAction(), { adventureId: 'test-adventure', ...input, status: 'interrupted',
    attemptId: started.attemptId, error: { code: 'PROCESS_INTERRUPTED', retryable: true } });
  const before = fs.readFileSync(env.databasePath);
  store.readPendingAction(); store.readDiagnostics();
  assert.deepEqual(fs.readFileSync(env.databasePath), before, 'readers do not change the database');
  const retried = store.beginAction(input, { retry: true });
  assert.notEqual(retried.attemptId, started.attemptId);
  store.failAction({ actionId: input.actionId, attemptId: retried.attemptId, code: 'TURN_TIMEOUT', retryable: true });
  assert.equal(store.readPendingAction().status, 'failed');
  const cancelled = store.beginAction(samples.request({ actionId: 'newer-cancelled' }));
  store.cancelAction(cancelled.actionId);
  assert.equal(store.readPendingAction(), null, 'latest cancellation cannot expose an earlier failed action');
  const permanent = store.beginAction(samples.request({ actionId: 'newer-permanent' }));
  store.failAction({ actionId: permanent.actionId, attemptId: permanent.attemptId, code: 'TURN_OUTPUT_INVALID', retryable: false });
  assert.equal(store.readPendingAction(), null);
  const current = store.beginAction(samples.request({ actionId: 'newer-current' }));
  assert.equal(store.readPendingAction().actionId, current.actionId);
  store.commitAction({ actionId: current.actionId, attemptId: current.attemptId, bundle: samples.borrowBundle() });
  assert.equal(store.readPendingAction(), null);
  for (const revision of [0, 2]) assert.throws(() => store.readPendingAction({ revision }), code('REVISION_CONFLICT'));
  assert.throws(() => store.readPendingAction({ input: 'not accepted' }), code('ACTION_INPUT_INVALID'));
});

test('diagnostics report retained attempts and safe state only, with bounded pages and no source text', (t) => {
  const env = sandbox(t);
  const store = env.open({ initialState: samples.initialState() });
  const secret = 'sk-synthetic-diagnostic-secret-123456';
  const original = samples.request({ actionId: 'diagnostic-first', input: secret });
  const first = store.beginAction(original);
  store.failAction({ actionId: first.actionId, attemptId: first.attemptId, code: 'TURN_TIMEOUT', retryable: true });
  const retry = store.beginAction(original, { retry: true });
  const bundle = samples.borrowBundle(); bundle.narration[0].text += secret;
  store.commitAction({ actionId: retry.actionId, attemptId: retry.attemptId, bundle });
  const second = store.beginAction(samples.request({ actionId: 'diagnostic-cancel', baseRevision: 1, input: secret }));
  store.cancelAction(second.actionId);
  const third = store.beginAction(samples.request({ actionId: 'diagnostic-fail', baseRevision: 1, input: secret }));
  store.failAction({ actionId: third.actionId, attemptId: third.attemptId, code: 'PRIVATE_SECRET_UPSTREAM_TOKEN', retryable: true });
  const bytes = fs.readFileSync(env.databasePath);
  const result = store.readDiagnostics({ limit: 2 });
  assert.deepEqual(result.counts, { actions: 3, retainedAttempts: 3,
    byStatus: { running: 0, committed: 1, cancelled: 1, failed: 1, interrupted: 0 } });
  assert.equal(result.attemptHistoryComplete, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.entries.map((entry) => entry.actionId), [second.actionId, third.actionId]);
  assert.deepEqual(result.entries[1].error, { code: 'ACTION_FAILED', retryable: true });
  assert.deepEqual(store.readPendingAction().error, result.entries[1].error);
  const all = store.readDiagnostics();
  assert.equal(all.complete, true); assert.equal(all.entries[0].attemptId, retry.attemptId);
  assert.equal(all.entries[0].baseRevision, 0); assert.equal(all.entries[0].committedRevision, 1);
  assert.match(all.entries[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(all), /synthetic-diagnostic|PRIVATE_SECRET|尚未露面|request_json|owner_|prompt|narration|events|input"|\/Users\//);
  assert.deepEqual(fs.readFileSync(env.databasePath), bytes);
  for (const limit of [null, 0, -1, 101, 1.5, '10', Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => store.readDiagnostics({ limit }), code('ACTION_INPUT_INVALID'));
  }
  assert.throws(() => store.readDiagnostics({ limit: 1, includeInput: true }), code('ACTION_INPUT_INVALID'));
  let getter = 0;
  assert.throws(() => store.readDiagnostics({ get limit() { getter++; return 1; } }), code('ACTION_INPUT_INVALID'));
  assert.equal(getter, 0);
});

test('terminal reservations remain solely recoverable through their terminal protocol', (t) => {
  const env = sandbox(t), store = env.open({ initialState: samples.initialState(), terminalRandomInt: () => 5000 });
  for (let revision = 1; revision <= 3; revision++) {
    const action = store.beginAction(samples.request({ actionId: `extreme-${revision}`, baseRevision: revision - 1 }));
    const type = revision === 1 ? 'extreme.propose' : 'extreme.confirm';
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: {
      narration: [{ id: 's', text: '虚构角色明确回应这个选择。' }], experiences: [],
      events: [{ id: 'decision', type, sourceSegmentIds: ['s'], data: revision === 1
        ? { candidateId: 'special-choice', characterId: 'p', intentReason: '角色主动提出结束旅程。', fictionalContext: '合成游戏中的虚构角色选择。' }
        : { candidateId: 'special-choice' } }] } });
  }
  const ending = store.beginAction(samples.request({ actionId: 'third-confirmation', baseRevision: 3 }));
  assert.equal(store.readPendingAction().actionId, ending.actionId);
  store.reserveTerminal({ actionId: ending.actionId, attemptId: ending.attemptId, candidateId: 'special-choice' });
  assert.equal(store.readPendingAction(), null);
  store.cancelAction(ending.actionId);
  assert.equal(store.readPendingAction(), null);
  assert.equal(store.getTerminal().status, 'reserved');
  assert.doesNotMatch(JSON.stringify(store.readDiagnostics()), /standard_extreme|grey_crow_view|draw|threshold|candidateId/);
});

test('角色摘要跨重开保留；确认与第一幕必须整轮生效，候选隐藏事实不投影', (t) => {
  const context = sandbox(t);
  let store = context.open({ initialState: createOpeningState({ day: 10 }) });
  const proposal = { narration: [{ id: 'summary', text: '你是一名住在楼道旁的幸存者。唯一留下的是回家的执念。确认这些开局设定吗？' }],
    events: [{ id: 'propose', type: 'opening.propose', sourceSegmentIds: ['summary'],
      data: { proposalId: 'role-one', initialState: samples.initialState() } }], experiences: [] };
  const requested = store.beginAction(samples.request({ actionId: 'show-summary', input: '请总结一下，准备开始。' }));
  const summary = store.commitAction({ actionId: requested.actionId, attemptId: requested.attemptId, bundle: proposal });
  assert.equal(summary.view.state.opening.phase, 'awaiting_confirmation');
  assert.deepEqual(summary.view.state.entities, {});
  assert.equal(summary.view.state.situation.playerId, null);
  assert.doesNotMatch(JSON.stringify(summary.view.state), /未发现的钥匙|尚未露面的访客|initialState/);
  store.close();
  store = context.open();
  assert.deepEqual(store.readView(), summary.view);
  const confirming = store.beginAction(samples.request({ actionId: 'confirm-role', baseRevision: 1, input: '确认，就用这个设定开始。' }));
  const bundle = { narration: [{ id: 'first-scene', text: '你站在楼道里，门后传来一声轻响。' }],
    events: [{ id: 'confirm', type: 'opening.confirm', sourceSegmentIds: ['first-scene'], data: { proposalId: 'role-one' } }], experiences: [] };
  const invalid = structuredClone(bundle);
  invalid.events.push({ id: 'impossible-transfer', type: 'inventory.transfer', sourceSegmentIds: ['first-scene'],
    data: { fromId: 'npc', toId: 'p', itemId: 'rice', quantity: 999 } });
  assert.throws(() => store.commitAction({ actionId: confirming.actionId, attemptId: confirming.attemptId, bundle: invalid }), code('TURN_VALIDATION_FAILED'));
  assert.deepEqual(store.readView(), summary.view);
  const committed = store.commitAction({ actionId: confirming.actionId, attemptId: confirming.attemptId, bundle });
  assert.equal(committed.view.revision, 2);
  assert.equal(committed.view.state.opening.phase, 'ready');
  assert.equal(committed.view.state.situation.playerId, 'p');
  assert.deepEqual(committed.view.narration, bundle.narration);
  assert.equal(committed.view.state.opening.confirmation.summaryRevision, 1);
  assert.equal(store.readView({ revision: 1 }).state.opening.phase, 'awaiting_confirmation');
});

test('摘要和确认不能同轮越级；未确认对话不能写入正式经历或实体', (t) => {
  const store = sandbox(t).open({ initialState: createOpeningState({ day: 10 }) });
  const action = store.beginAction(samples.request({ actionId: 'early-start', input: '开始吧。' }));
  const source = ['s'];
  const propose = { id: 'propose', type: 'opening.propose', sourceSegmentIds: source,
    data: { proposalId: 'role-one', initialState: samples.initialState() } };
  const confirm = { id: 'confirm', type: 'opening.confirm', sourceSegmentIds: source, data: { proposalId: 'role-one' } };
  const base = { narration: [{ id: 's', text: '开局摘要。' }], events: [], experiences: [] };
  for (const candidate of [
    { ...base, events: [propose, confirm] },
    { ...base, events: [{ id: 'entity', type: 'entity.create', sourceSegmentIds: source, data: { entity: samples.initialState().entities.p } }] },
    { ...base, experiences: [{ id: 'premature', text: '未确认经历', kind: 'claim', knownBy: [], entityIds: [], eventIds: [], sourceSegmentIds: source }] },
  ]) {
    assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: candidate }), code('TURN_VALIDATION_FAILED'));
    assert.equal(store.readView().revision, 0);
    assert.deepEqual(store.readModelState().entities, {});
  }
});

function commitBorrow(store, overrides = {}) {
  const request = samples.request(overrides);
  const action = store.beginAction(request);
  return store.commitAction({
    actionId: request.actionId,
    attemptId: action.attemptId,
    bundle: samples.borrowBundle(),
  });
}

test('记忆分页固定版本；SQL按玩家知识筛选后分页并提供同轮原文', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const action = store.beginAction(samples.request());
  const bundle = samples.borrowBundle();
  bundle.experiences.unshift({ ...bundle.experiences[0], id: 'private-memory', text: '只有陈姨知道的前情', knownBy: ['npc'] });
  bundle.experiences.push({ ...bundle.experiences[1], id: 'second-memory' });
  store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
  const first = store.listExperienceRecords({ viewerId: 'p', limit: 1 });
  assert.equal(first.revision, 1);
  assert.equal(first.records[0].experience.id, 'borrow-memory');
  assert.deepEqual(first.records[0].passages, bundle.narration);
  assert.equal(first.records[0].adventureId, 'test-adventure');
  assert.equal(typeof first.nextCursor, 'number');
  const returning = store.beginAction(samples.request({ actionId: 'return', baseRevision: 1 }));
  store.commitAction({ actionId: returning.actionId, attemptId: returning.attemptId, bundle: samples.returnBundle() });
  const second = store.listExperienceRecords({ revision: first.revision, viewerId: 'p', cursor: first.nextCursor, limit: 1 });
  assert.equal(second.revision, 1);
  assert.equal(second.records[0].experience.id, 'second-memory');
  assert.equal(second.nextCursor, null);
  for (const viewerId of ['npc', 'secret', 'host', undefined]) {
    assert.throws(() => store.listExperienceRecords({ viewerId }), code('MEMORY_VIEWER_INVALID'));
  }
});

test('纠正引用不存在或同轮经历时整轮拒绝，不能留下正文或状态', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  commitBorrow(store);
  const action = store.beginAction(samples.request({ actionId: 'correction', baseRevision: 1 }));
  const before = store.readView();
  for (const target of [{ revision: 1, experienceId: 'missing' }, { revision: 2, experienceId: 'return-memory' }]) {
    const bundle = samples.returnBundle();
    bundle.experiences[0].supersedes = [target];
    assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle }), code('TURN_VALIDATION_FAILED'));
    assert.deepEqual(store.readView(), before);
    assert.equal(store.readAction(action.actionId).status, 'running');
  }
});

test('experience time ranges seek beyond 4096 older records before bounded paging and stay fixed after reopen', (t) => {
  const context = sandbox(t);
  let store = context.open({ initialState: samples.initialState() });
  const commit = (revision, count) => {
    const action = store.beginAction(samples.request({ actionId: `range-${revision}`, baseRevision: revision - 1, input: `原始询问 ${revision}` }));
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: {
      narration: [{ id: 's', text: `第 ${revision} 轮的完整原文。` }], events: [],
      experiences: Array.from({ length: count }, (_, index) => ({ id: `entry-${index}`, kind: 'event', knownBy: ['p'],
        entityIds: ['p'], eventIds: [], sourceSegmentIds: ['s'] })),
    } });
  };
  for (let revision = 1; revision <= 16; revision += 1) commit(revision, 256);
  commit(17, 2); commit(18, 1);
  const request = { revision: 18, viewerId: 'p', afterRevision: 16, beforeRevision: 18, limit: 1 };
  const first = store.listExperienceRecords(request);
  assert.deepEqual(first.records.map((entry) => [entry.revision, entry.experience.id]), [[17, 'entry-0']]);
  assert.equal(first.scannedRecords, 1, 'the 4096 out-of-range records do not consume the requested scan budget');
  assert.equal(first.records[0].playerInput, '原始询问 17');
  assert.deepEqual(first.records[0].passages, [{ id: 's', text: '第 17 轮的完整原文。' }]);
  assert.equal(typeof first.nextCursor, 'number');
  commit(19, 1);
  const second = store.listExperienceRecords({ ...request, cursor: first.nextCursor });
  assert.equal(second.revision, 18);
  assert.deepEqual(second.records.map((entry) => [entry.revision, entry.experience.id]), [[17, 'entry-1']]);
  assert.equal(second.scannedRecords, 1); assert.equal(second.nextCursor, null);
  const through18 = store.listExperienceRecords({ revision: 18, viewerId: 'p', afterRevision: 16, limit: 4 });
  assert.deepEqual(through18.records.map((entry) => entry.revision), [17, 17, 18]);
  assert.equal(through18.scannedRecords, 3); assert.equal(through18.nextCursor, null);
  store.close(); store = context.open();
  assert.deepEqual(store.listExperienceRecords(request), first);
  assert.deepEqual(store.listExperienceRecords({ ...request, cursor: first.nextCursor }), second);
});

test('experience time ranges retain current knowledge and corrections outside the selected revisions', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const experience = (id, fields = {}) => ({ id, kind: 'claim', knownBy: ['p'], entityIds: ['p', 'npc'],
    eventIds: [], sourceSegmentIds: ['s'], ...fields });
  const commit = (revision, experiences) => {
    const action = store.beginAction(samples.request({ actionId: `correction-range-${revision}`, baseRevision: revision - 1 }));
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
      bundle: { narration: [{ id: 's', text: '陈姨谈及那段经历及后来核对的情况。' }], events: [], experiences } });
  };
  commit(1, [experience('public-old'), experience('private-correction-old'), experience('hidden-correction-old'),
    experience('hidden-old', { entityIds: ['p', 'secret'] })]);
  commit(2, [
    experience('public-new', { supersedes: [{ revision: 1, experienceId: 'public-old' }] }),
    experience('private-new', { knownBy: ['npc'], supersedes: [{ revision: 1, experienceId: 'private-correction-old' }] }),
    experience('hidden-new', { entityIds: ['p', 'secret'], supersedes: [{ revision: 1, experienceId: 'hidden-correction-old' }] }),
  ]);
  commit(3, []);
  const request = { revision: 3, viewerId: 'p', afterRevision: 0, beforeRevision: 2, limit: 2 };
  const first = store.listExperienceRecords(request);
  assert.deepEqual(first.records.map((entry) => entry.experience.id), ['private-correction-old']);
  assert.equal(first.scannedRecords, 2, 'superseded in-range records still count as inspected candidates');
  const second = store.listExperienceRecords({ ...request, cursor: first.nextCursor });
  assert.deepEqual(second.records.map((entry) => entry.experience.id), ['hidden-correction-old']);
  assert.equal(second.scannedRecords, 2, 'hidden in-range records still count as inspected candidates');
  assert.equal(second.nextCursor, null, 'out-of-range corrections must not add pages');
  assert.deepEqual(store.listExperienceRecords({ revision: 1, viewerId: 'p' }).records.map((entry) => entry.experience.id),
    ['public-old', 'private-correction-old', 'hidden-correction-old']);
  for (const viewerId of ['npc', 'secret']) assert.throws(() => store.listExperienceRecords({ ...request, viewerId }), code('MEMORY_VIEWER_INVALID'));
});

test('experience time ranges validate exclusive bounds against the fixed revision', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  commitBorrow(store);
  for (const bounds of [{ beforeRevision: 0 }, { beforeRevision: -1 }, { beforeRevision: 1.5 }, { beforeRevision: '1' },
    { beforeRevision: 2 }, { beforeRevision: NaN }, { afterRevision: -1 }, { afterRevision: '0' }, { afterRevision: Infinity },
    { afterRevision: 0.5 }, { afterRevision: 2 }, { afterRevision: 1, beforeRevision: 1 }]) {
    assert.throws(() => store.listExperienceRecords({ revision: 1, viewerId: 'p', ...bounds }), code('ACTION_INPUT_INVALID'));
  }
  for (const bounds of [{ beforeRevision: 1 }, { afterRevision: 1 }, { afterRevision: 0, beforeRevision: 1 }]) {
    assert.deepEqual(store.listExperienceRecords({ revision: 1, viewerId: 'p', ...bounds }),
      { revision: 1, records: [], scannedRecords: 0, nextCursor: null });
  }
  assert.deepEqual(store.listExperienceRecords({ revision: 0, viewerId: 'p', afterRevision: 0 }),
    { revision: 0, records: [], scannedRecords: 0, nextCursor: null });
});

test('纠正只对知道纠正的玩家生效；历史原文与过去版本仍可核对', (t) => {
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  commitBorrow(store);
  function correct(actionId, knownBy, revision) {
    const action = store.beginAction(samples.request({ actionId, baseRevision: revision - 1 }));
    const bundle = { narration: [{ id: 's', text: '陈姨确认了那段前情的更正。' }], events: [],
      experiences: [{ id: 'corrected', text: '修正后的记录', kind: 'claim', knownBy,
        entityIds: ['p', 'npc'], eventIds: [], sourceSegmentIds: ['s'],
        supersedes: [{ revision: 1, experienceId: 'borrow-memory' }] }] };
    store.commitAction({ actionId, attemptId: action.attemptId, bundle });
  }
  correct('private-correction', ['npc'], 2);
  assert.deepEqual(store.listExperienceRecords({ viewerId: 'p' }).records.map((r) => r.experience.id), ['borrow-memory']);
  correct('public-correction', ['p', 'npc'], 3);
  assert.deepEqual(store.listExperienceRecords({ viewerId: 'p' }).records.map((r) => [r.revision, r.experience.id]), [[3, 'corrected']]);
  assert.deepEqual(store.readTurn(1).experiences, samples.borrowBundle().experiences);
  assert.equal(store.listExperienceRecords({ viewerId: 'p', revision: 1 }).records[0].experience.id, 'borrow-memory');
  store.close();
  assert.deepEqual(context.open().listExperienceRecords({ viewerId: 'p' }).records.map((r) => r.revision), [3]);
});

test('近期上下文查询在SQL限制回合数，保持原始输入并冻结目标版本', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  for (let index = 0; index < 8; index++) {
    const action = store.beginAction(samples.request({ actionId: `idle-${index}`, baseRevision: index, input: `原始输入${index}` }));
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.refusedBundle() });
  }
  const recent = store.readRecentTurns({ revision: 7, limit: 2 });
  assert.equal(recent.revision, 7);
  assert.deepEqual(recent.turns.map((turn) => [turn.revision, turn.input]), [[6, '原始输入5'], [7, '原始输入6']]);
  assert.deepEqual(store.readRecentTurns({ limit: 0 }).turns, []);
  assert.throws(() => store.readRecentTurns({ limit: 100 }), code('ACTION_INPUT_INVALID'));
});

function subprocess(databasePath, phase, { large = false } = {}) {
  const source = `
    const { createTurnStore } = require(${JSON.stringify(require.resolve('./turn-store'))});
    const samples = require(${JSON.stringify(require.resolve('./test-fixtures/turn-samples'))});
    const phase = process.argv[2];
    const store = createTurnStore({
      ...samples.identity(process.argv[1]),
      initialState: samples.initialState(),
      faultInjector(stage) { if (stage === phase) process.exit(73); },
    });
    const action = store.beginAction(samples.request());
    if (phase === 'after_begin') process.exit(73);
    const bundle = samples.borrowBundle();
    if (${large}) {
      for (let index = 0; index < 24; index++) bundle.narration.push({ id: 'long-' + index, text: 'x'.repeat(100000) });
    }
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle });
    process.exit(74);
  `;
  const result = spawnSync(process.execPath, ['-e', source, databasePath, phase], {
    encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 73, result.stderr);
}

test('借米和承诺共同提交；归还同时更新库存与承诺，历史版本保持不变', (t) => {
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  assert.equal(store.readView().revision, 0);
  const borrowed = commitBorrow(store);
  assert.equal(borrowed.status, 'committed');
  assert.equal(borrowed.view.revision, 1);
  samples.assertBorrowed(assert, borrowed.view);
  assert.deepEqual(store.readTurn(1), { revision: 1, actionId: 'borrow-rice', ...samples.borrowBundle() });
  assert.equal(store.readModelState().inventory.find((entry) => entry.ownerId === 'npc' && entry.itemId === 'rice').quantity, 1);
  const firstView = store.readView();
  const returnRequest = samples.request({ actionId: 'return-rice', baseRevision: 1, input: '我按约把米还给陈姨。' });
  const returning = store.beginAction(returnRequest);
  const returned = store.commitAction({ actionId: returning.actionId, attemptId: returning.attemptId, bundle: samples.returnBundle() });
  assert.equal(returned.view.revision, 2);
  samples.assertReturned(assert, returned.view);
  assert.deepEqual(store.readTurn(2), { revision: 2, actionId: 'return-rice', ...samples.returnBundle() });
  assert.equal(store.readModelState().inventory.find((entry) => entry.ownerId === 'npc' && entry.itemId === 'rice').quantity, 3);
  assert.equal(returned.view.history.length, 2);
  assert.deepEqual(store.readView({ revision: 1 }), firstView);
  store.close();
  const reopened = context.open();
  assert.deepEqual(reopened.readView(), returned.view);
  assert.deepEqual(reopened.readView({ revision: reopened.readAction('borrow-rice').revision }), firstView);
  assert.deepEqual(reopened.readTurn(1).experiences, samples.borrowBundle().experiences);
});

test('只是借米请求被拒绝：可以形成正式叙事，但物品与承诺不凭空发生', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const before = store.readView().state;
  const action = store.beginAction(samples.request());
  const result = store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.refusedBundle() });
  assert.equal(result.view.revision, 1);
  const expected = structuredClone(before);
  assert.deepEqual(result.view.state, expected);
  assert.equal(result.view.history.length, 1);
});

test('库存不足使整个结果包无效，正文、承诺和版本均不落盘', (t) => {
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  const before = store.readView();
  const action = store.beginAction(samples.request());
  const bundle = samples.borrowBundle({ quantity: 99 });
  assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle }), code('TURN_VALIDATION_FAILED'));
  assert.deepEqual(store.readView(), before);
  assert.equal(store.readAction(action.actionId).status, 'running');
  store.close();
  assert.deepEqual(context.open().readView(), before);
});

test('执行中和已提交的重复请求复用原行动与尝试，不产生第二轮', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const request = samples.request();
  const first = store.beginAction(request);
  assert.equal(first.started, true);
  const duplicateRunning = store.beginAction(request);
  assert.equal(duplicateRunning.started, false);
  assert.equal(duplicateRunning.attemptId, first.attemptId);
  const result = store.commitAction({ actionId: first.actionId, attemptId: first.attemptId, bundle: samples.borrowBundle() });
  const duplicateCommitted = store.beginAction(request);
  assert.equal(duplicateCommitted.started, false);
  assert.equal(duplicateCommitted.status, 'committed');
  assert.deepEqual(store.readView({ revision: duplicateCommitted.revision }), result.view);
  assert.equal(store.readView().history.length, 1);
  assert.equal(store.readView().revision, 1);
});

test('相同 ID 不允许换输入、起始版本、语言或内容版本', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  store.beginAction(samples.request());
  for (const changed of [{ input: '我要借两袋米。' }, { baseRevision: 1 }]) {
    assert.throws(() => store.beginAction(samples.request(changed)), code('ACTION_INPUT_CONFLICT'));
  }
  for (const changed of [{ locale: 'en-US' }, { contentVersion: 'other-version' }]) {
    assert.throws(() => store.beginAction(samples.request(changed)), code('SAVE_IDENTITY_MISMATCH'));
  }
  assert.equal(store.readView().revision, 0);
});

test('提交前取消是终态，新尝试不能重开；提交后的取消返回已经提交', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const action = store.beginAction(samples.request());
  assert.equal(store.cancelAction(action.actionId).status, 'cancelled');
  assert.equal(store.cancelAction(action.actionId).status, 'cancelled');
  const retry = store.beginAction(samples.request(), { retry: true });
  assert.equal(retry.status, 'cancelled');
  assert.equal(retry.started, false);
  assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.borrowBundle() }), code('ACTION_NOT_RUNNING'));
  assert.equal(store.readView().revision, 0);
  commitBorrow(store, { actionId: 'borrow-again' });
  assert.equal(store.cancelAction('borrow-again').status, 'committed');
  samples.assertBorrowed(assert, store.readView());
});

test('可重试失败必须显式 retry 才获取新尝试，旧结果和旧失败不能结束新尝试', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const action = store.beginAction(samples.request());
  store.failAction({ actionId: action.actionId, attemptId: action.attemptId, code: 'MODEL_TIMEOUT', retryable: true });
  assert.deepEqual(store.readAction(action.actionId).error, { code: 'MODEL_TIMEOUT', retryable: true });
  const noRetry = store.beginAction(samples.request());
  assert.equal(noRetry.status, 'failed');
  assert.equal(noRetry.started, false);
  const retry = store.beginAction(samples.request(), { retry: true });
  assert.equal(retry.started, true);
  assert.notEqual(retry.attemptId, action.attemptId);
  assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.borrowBundle() }), code('ATTEMPT_STALE'));
  assert.throws(() => store.failAction({ actionId: action.actionId, attemptId: action.attemptId, code: 'LATE_FAILURE', retryable: true }), code('ATTEMPT_STALE'));
  assert.equal(store.readAction(action.actionId).status, 'running');
  store.commitAction({ actionId: retry.actionId, attemptId: retry.attemptId, bundle: samples.borrowBundle() });
  assert.equal(store.readView().revision, 1);
});

test('不可重试失败不因重复请求而重开', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const action = store.beginAction(samples.request());
  store.failAction({ actionId: action.actionId, attemptId: action.attemptId, code: 'INVALID_ACTION', retryable: false });
  const retry = store.beginAction(samples.request(), { retry: true });
  assert.equal(retry.started, false);
  assert.equal(retry.status, 'failed');
  assert.equal(store.readView().revision, 0);
});

test('起始版本过期的新行动以及失败后过期的重试不能覆写当前世界', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const stale = store.beginAction(samples.request({ actionId: 'stale-action' }));
  store.failAction({ actionId: stale.actionId, attemptId: stale.attemptId, code: 'TIMEOUT', retryable: true });
  commitBorrow(store);
  assert.throws(() => store.beginAction(samples.request({ actionId: 'new-stale-action' })), code('REVISION_CONFLICT'));
  assert.throws(() => store.beginAction(samples.request({ actionId: 'stale-action' }), { retry: true }), code('REVISION_CONFLICT'));
  assert.equal(store.readView().revision, 1);
});

test('每个冒险同时只有一个有效行动，另一连接不能恢复或抢占活进程', (t) => {
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  const action = store.beginAction(samples.request());
  const observer = context.open();
  assert.equal(observer.recoverInterruptedActions(), 0);
  assert.equal(observer.readAction(action.actionId).status, 'running');
  assert.throws(() => observer.beginAction(samples.request({ actionId: 'competing-action' })), code('ADVENTURE_BUSY'));
  observer.close();
  assert.equal(store.readAction(action.actionId).status, 'running');
  store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.borrowBundle() });
  assert.equal(store.readView().revision, 1);
});

test('可查询的创建身份不匹配时，行动、章节和整理都恢复为中断', (t) => {
  if (!require('./session-process-owner').processIdentity) {
    t.skip('OS process creation identity unavailable; unknown-identity preservation is covered by the verifier unit test');
    return;
  }
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  const action = store.beginAction(samples.request());
  store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.borrowBundle() });
  const chapter = store.beginChapter({ targetRevision: 1 });
  const db = new DatabaseSync(context.databasePath);
  const now = new Date().toISOString();
  db.prepare("UPDATE actions SET status='running',owner_pid=?,owner_generation=?,owner_process_identity=?,updated_at=? WHERE action_id=?")
    .run(process.pid, 'old-runtime', 'different-creation', now, action.actionId);
  db.prepare("UPDATE chapter_jobs SET owner_pid=?,owner_generation=?,owner_process_identity=?,updated_at=? WHERE chapter_id=?")
    .run(process.pid, 'old-runtime', 'different-creation', now, chapter.chapterId);
  db.prepare("INSERT INTO context_compactions (adventure_id,request_id,request_json,input_hash,viewer_id,settings_identity,target_revision,source_hash,through_revision,start_generation,status,attempt_id,owner_id,owner_pid,owner_generation,owner_process_identity,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'running',?,?,?,?,?,?,?)")
    .run('test-adventure', 'pid-reused-compaction', JSON.stringify({ input: 'x' }), 'a'.repeat(64), 'p', 'b'.repeat(64), 1, 'c'.repeat(64), 1, 0,
      'old-attempt', 'old-owner', process.pid, 'old-runtime', 'different-creation', now, now);
  db.close();
  const observer = context.open();
  assert.equal(observer.readAction(action.actionId).status, 'interrupted');
  assert.equal(observer.readChapterJob(chapter.chapterId).status, 'interrupted');
  assert.equal(observer.readCompactionJob('pid-reused-compaction').status, 'interrupted');
});

test('独立观察进程也不能把仍活着的持有者标成中断', (t) => {
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  store.beginAction(samples.request());
  const source = `
    const assert = require('node:assert/strict');
    const { createTurnStore } = require(${JSON.stringify(require.resolve('./turn-store'))});
    const samples = require(${JSON.stringify(require.resolve('./test-fixtures/turn-samples'))});
    const store = createTurnStore(samples.identity(process.argv[1]));
    assert.equal(store.recoverInterruptedActions(), 0);
    assert.equal(store.readAction('borrow-rice').status, 'running');
    assert.throws(() => store.beginAction(samples.request({ actionId: 'child-competing-action' })), { code: 'ADVENTURE_BUSY' });
    store.close();
  `;
  const observed = spawnSync(process.execPath, ['-e', source, context.databasePath], { encoding: 'utf8', timeout: 15000 });
  assert.equal(observed.error, undefined, observed.error?.message);
  assert.equal(observed.status, 0, observed.stderr);
  assert.equal(store.readAction('borrow-rice').status, 'running');
});

test('有序关闭遗留行动成为中断，重开只在显式重试时启动新尝试', (t) => {
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  const action = store.beginAction(samples.request());
  store.close();
  const reopened = context.open();
  assert.equal(reopened.readAction(action.actionId).status, 'interrupted');
  assert.equal(reopened.beginAction(samples.request()).started, false);
  const retried = reopened.beginAction(samples.request(), { retry: true });
  assert.equal(retried.started, true);
  assert.notEqual(retried.attemptId, action.attemptId);
});

test('查询不存在的行动不会创建行动；初始和历史视图均不暴露隐藏实体', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  assert.equal(store.readAction('not-created'), null);
  samples.assertHidden(assert, store.readView());
  commitBorrow(store);
  samples.assertHidden(assert, store.readView());
  samples.assertHidden(assert, store.readView({ revision: 0 }));
});

for (const phase of ['after_turn', 'after_experiences', 'after_revision', 'after_action']) {
  test(`注入 ${phase} 写入错误：整轮回滚，仍可用同一有效尝试重新提交`, (t) => {
    const context = sandbox(t);
    let fail = true;
    const store = context.open({
      initialState: samples.initialState(),
      faultInjector(stage) { if (fail && stage === phase) throw new Error(`injected:${phase}`); },
    });
    const before = store.readView();
    const action = store.beginAction(samples.request());
    assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.borrowBundle() }), new RegExp(`injected:${phase}`));
    assert.deepEqual(store.readView(), before);
    assert.deepEqual(store.readTurn(0).experiences, []);
    assert.throws(() => store.readTurn(1), code('VIEW_REVISION_UNAVAILABLE'));
    assert.equal(store.readAction(action.actionId).status, 'running');
    fail = false;
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.borrowBundle() });
    assert.equal(store.readView().history.length, 1);
    samples.assertBorrowed(assert, store.readView());
    assert.deepEqual(store.readTurn(1), { revision: 1, actionId: action.actionId, ...samples.borrowBundle() });
  });
}

test('提交完成但交付抛错：重查找到已提交结果，重启后仍只有一轮', (t) => {
  const context = sandbox(t);
  const store = context.open({
    initialState: samples.initialState(),
    faultInjector(stage) { if (stage === 'after_commit') throw new Error('reply-lost'); },
  });
  assert.throws(() => commitBorrow(store), /reply-lost/);
  assert.equal(store.readAction('borrow-rice').status, 'committed');
  samples.assertBorrowed(assert, store.readView());
  const before = store.readView();
  store.close();
  const reopened = context.open();
  const replayed = reopened.beginAction(samples.request(), { retry: true });
  assert.equal(replayed.started, false);
  assert.deepEqual(reopened.readView({ revision: replayed.revision }), before);
  assert.equal(reopened.readView().history.length, 1);
  assert.deepEqual(reopened.readTurn(1), { revision: 1, actionId: 'borrow-rice', ...samples.borrowBundle() });
});

for (const phase of ['after_begin', 'after_turn', 'after_experiences', 'after_revision', 'after_action', 'after_commit']) {
  test(`进程在 ${phase} 真实退出，新进程恢复的正式故事只能全有或全无`, (t) => {
    const context = sandbox(t);
    subprocess(context.databasePath, phase);
    const reopened = context.open();
    const action = reopened.readAction('borrow-rice');
    const view = reopened.readView();
    if (phase === 'after_commit') {
      assert.equal(action.status, 'committed');
      assert.equal(view.revision, 1);
      assert.equal(view.history.length, 1);
      samples.assertBorrowed(assert, view);
      assert.deepEqual(reopened.readTurn(1), { revision: 1, actionId: 'borrow-rice', ...samples.borrowBundle() });
      assert.equal(reopened.beginAction(samples.request(), { retry: true }).started, false);
    } else {
      assert.equal(action.status, 'interrupted');
      assert.equal(view.revision, 0);
      assert.equal(view.history.length, 0);
      assert.deepEqual(reopened.readTurn(0).experiences, []);
      assert.throws(() => reopened.readTurn(1), code('VIEW_REVISION_UNAVAILABLE'));
      const retried = reopened.beginAction(samples.request(), { retry: true });
      assert.equal(retried.started, true);
      assert.notEqual(retried.attemptId, action.attemptId);
      reopened.commitAction({ actionId: retried.actionId, attemptId: retried.attemptId, bundle: samples.borrowBundle() });
      samples.assertBorrowed(assert, reopened.readView());
      assert.equal(reopened.readView().history.length, 1);
      assert.deepEqual(reopened.readTurn(1), { revision: 1, actionId: 'borrow-rice', ...samples.borrowBundle() });
    }
  });
}

test('大事务写出有效恢复日志后进程退出：重开完成回滚且允许原行动重试', (t) => {
  const context = sandbox(t);
  subprocess(context.databasePath, 'after_experiences', { large: true });
  const journal = fs.readFileSync(`${context.databasePath}-journal`);
  assert.ok(journal.length > 512, 'must leave an on-disk rollback journal');
  assert.notDeepEqual(journal.subarray(0, 8), Buffer.alloc(8), 'must exercise a live recovery header, not only cached transaction writes');
  const reopened = context.open();
  assert.equal(reopened.readAction('borrow-rice').status, 'interrupted');
  assert.equal(reopened.readView().revision, 0);
  assert.deepEqual(reopened.readTurn(0).experiences, []);
  assert.throws(() => reopened.readTurn(1), code('VIEW_REVISION_UNAVAILABLE'));
  const retry = reopened.beginAction(samples.request(), { retry: true });
  reopened.commitAction({ actionId: retry.actionId, attemptId: retry.attemptId, bundle: samples.borrowBundle() });
  samples.assertBorrowed(assert, reopened.readView());
  assert.deepEqual(reopened.readTurn(1), { revision: 1, actionId: 'borrow-rice', ...samples.borrowBundle() });
});

test('已有冒险不能被新初始状态覆盖，身份、语言和内容版本不匹配时拒绝打开', (t) => {
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  commitBorrow(store);
  const expected = store.readView();
  store.close();
  assert.throws(() => context.open({ initialState: samples.initialState() }), code('SAVE_ALREADY_EXISTS'));
  for (const mismatch of [{ adventureId: 'other-adventure' }, { locale: 'en-US' }, { contentVersion: 'test-v2' }]) {
    assert.throws(() => context.open(mismatch), code('SAVE_IDENTITY_MISMATCH'));
  }
  assert.deepEqual(context.open().readView(), expected);
});

test('外部 SQLite 格式被拒绝且文件内容不变，不会被初始化为本冒险', (t) => {
  const context = sandbox(t);
  const database = new DatabaseSync(context.databasePath);
  database.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('keep-me')");
  database.close();
  const digest = () => createHash('sha256').update(fs.readFileSync(context.databasePath)).digest('hex');
  const before = digest();
  assert.throws(() => context.open({ initialState: samples.initialState() }), code('SAVE_FORMAT_UNSUPPORTED'));
  assert.equal(digest(), before);
  const observer = new DatabaseSync(context.databasePath, { readOnly: true });
  assert.equal(observer.prepare('SELECT value FROM sentinel').get().value, 'keep-me');
  assert.equal(observer.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type='table'").get().total, 1);
  observer.close();
});

test('数据库与恢复文件不接受链接，防止别名绕过文件保护或恢复到另一条路径', (t) => {
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  store.close();
  const directory = path.dirname(context.databasePath);
  const alias = path.join(directory, 'alias.sqlite');
  fs.linkSync(context.databasePath, alias);
  assert.throws(() => createTurnStore(samples.identity(alias)), code('SAVE_PATH_INVALID'));
  fs.unlinkSync(alias);
  fs.symlinkSync(context.databasePath, alias);
  assert.throws(() => createTurnStore(samples.identity(alias)), code('SAVE_PATH_INVALID'));
  fs.unlinkSync(alias);
  const sentinel = path.join(directory, 'sentinel');
  fs.writeFileSync(sentinel, 'preserve');
  fs.symlinkSync(sentinel, context.databasePath + '-journal');
  assert.throws(() => context.open(), code('SAVE_PATH_INVALID'));
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
});

test('行动输入校验不调用访问器或接受非数据字段', (t) => {
  const context = sandbox(t);
  const store = context.open({ initialState: samples.initialState() });
  const request = samples.request();
  let getterCalled = false;
  Object.defineProperty(request, 'input', { enumerable: true, get() { getterCalled = true; return 'unexpected'; } });
  assert.throws(() => store.beginAction(request), code('ACTION_INPUT_INVALID'));
  assert.equal(getterCalled, false);
  assert.equal(store.readAction(request.actionId), null);
});

test('线程共享 PID 不能作为可恢复存储执行者，启动即明确拒绝且不创建数据库', async (t) => {
  const context = sandbox(t);
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { createTurnStore } = require(workerData.module);
    const samples = require(workerData.samples);
    try {
      const store = createTurnStore({ ...samples.identity(workerData.databasePath), initialState: samples.initialState() });
      store.close(); parentPort.postMessage('unexpected-success');
    } catch (error) { parentPort.postMessage(error.code); }
  `;
  const worker = new Worker(source, { eval: true, workerData: {
    module: require.resolve('./turn-store'), samples: require.resolve('./test-fixtures/turn-samples'), databasePath: context.databasePath,
  } });
  const message = await new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  await worker.terminate();
  assert.equal(message, 'STORE_REQUIRES_PROCESS_SCOPE');
  assert.equal(fs.existsSync(context.databasePath), false);
});

function commitNarration(store, revision, text) {
  const request = samples.request({ actionId: `history-${revision}`, baseRevision: revision - 1, input: `第${revision}次观察` });
  const action = store.beginAction(request);
  const narration = [{ id: `passage-${revision}`, text }];
  const result = store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
    bundle: { narration, events: [], experiences: [] } });
  return { result, item: { revision, actionId: action.actionId, input: request.input, narration,
    source: { adventureId: 'test-adventure', revision }, storyTurn: revision } };
}

test('历史默认只含最近20轮；绑定旧版本游标完整恢复55轮且不混入新提交', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const expected = [];
  for (let revision = 1; revision <= 55; revision += 1) expected.push(commitNarration(store, revision, `第${revision}轮的完整故事。\n保留第二段。`).item);
  const view = store.readView();
  assert.equal(view.revision, 55);
  assert.deepEqual(view.history, expected.slice(-20));
  assert.equal(view.historyComplete, false);
  assert.deepEqual(view.historyNextBeforeRevision, { adventureId: 'test-adventure', revision: 55, beforeRevision: 36 });
  commitNarration(store, 56, '这段新故事不能进入旧版本的历史。');
  let collected = view.history;
  let cursor = view.historyNextBeforeRevision;
  let pages = 1;
  while (cursor) {
    const page = store.readHistory({ revision: view.revision, beforeRevision: cursor });
    assert.equal(page.revision, 55);
    assert.ok(page.history.length > 0);
    assert.ok(page.history.at(-1).revision < cursor.beforeRevision);
    collected = [...page.history, ...collected];
    cursor = page.nextBeforeRevision;
    assert.equal(page.complete, cursor === null);
    pages += 1;
  }
  assert.equal(pages, 3);
  assert.deepEqual(collected, expected);
  assert.equal(new Set(collected.map((row) => row.revision)).size, 55);
  assert.throws(() => store.readHistory({ revision: 56, beforeRevision: view.historyNextBeforeRevision }), code('HISTORY_CURSOR_MISMATCH'));
  assert.throws(() => store.readHistory({ revision: 55,
    beforeRevision: { ...view.historyNextBeforeRevision, adventureId: 'other-adventure' } }), code('HISTORY_CURSOR_MISMATCH'));
  assert.deepEqual(store.readRecentTurns({ revision: 55, limit: 6 }).turns, expected.slice(-6), 'model recent context remains independently bounded');
});

test('历史页预算不截正文；小页前进到大段后明确报错，提高预算即可续读', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const older = commitNarration(store, 1, '完整旧正文'.repeat(6000)).item;
  const newer = commitNarration(store, 2, '短的新正文').item;
  const page = store.readHistory({ revision: 2, maxCharacters: 1000 });
  assert.deepEqual(page.history, [newer]);
  assert.equal(page.complete, false);
  assert.equal(page.nextBeforeRevision.beforeRevision, 2);
  assert.throws(() => store.readHistory({ revision: 2, beforeRevision: page.nextBeforeRevision, maxCharacters: 1000 }), code('HISTORY_PAGE_TOO_LARGE'));
  const recovered = store.readHistory({ revision: 2, beforeRevision: page.nextBeforeRevision, maxCharacters: 100000 });
  assert.deepEqual(recovered.history, [older]);
  assert.equal(recovered.complete, true);
  assert.equal(recovered.nextBeforeRevision, null);
  assert.ok(JSON.stringify(recovered).length <= 100000);
});

test('单轮超过默认历史预算时仍已完整提交，并可提高视图预算取回同一版本', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  const request = samples.request();
  const action = store.beginAction(request);
  const narration = [{ id: 'long-one', text: '长正文一'.repeat(30000) }, { id: 'long-two', text: '长正文二'.repeat(30000) }];
  assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
    bundle: { narration, events: [], experiences: [] } }), code('HISTORY_PAGE_TOO_LARGE'));
  assert.equal(store.readAction(request.actionId).status, 'committed');
  assert.throws(() => store.readView(), code('HISTORY_PAGE_TOO_LARGE'));
  const view = store.readView({ revision: 1, maxCharacters: 500000 });
  assert.equal(view.revision, 1);
  assert.deepEqual(view.narration, narration);
  assert.deepEqual(view.history[0].narration, narration);
  assert.equal(view.historyComplete, true);
  assert.equal(view.historyNextBeforeRevision, null);
});

test('历史分页拒绝无效页大小、游标与访问器；空冒险只有明确完成的一页', (t) => {
  const store = sandbox(t).open({ initialState: samples.initialState() });
  assert.deepEqual(store.readHistory({ revision: 0 }), { adventureId: 'test-adventure', revision: 0,
    timeline: { storyTurnCount: 0, systemRevisions: [] }, history: [], nextBeforeRevision: null, complete: true });
  for (const options of [{}, { revision: 0, limit: 0 }, { revision: 0, limit: 101 },
    { revision: 0, limit: null }, { revision: 0, maxCharacters: 2000001 },
    { revision: 0, beforeRevision: 0 }, { revision: 0, extra: 'field' }]) {
    assert.throws(() => store.readHistory(options), code('ACTION_INPUT_INVALID'));
  }
  assert.throws(() => store.readHistory({ revision: 1 }), code('VIEW_REVISION_UNAVAILABLE'));
  assert.throws(() => store.readHistory({ revision: 0, maxCharacters: 1 }), code('HISTORY_PAGE_TOO_LARGE'));
  let evaluated = false;
  const options = { revision: 0 };
  Object.defineProperty(options, 'limit', { enumerable: true, get() { evaluated = true; return 1; } });
  assert.throws(() => store.readHistory(options), code('ACTION_INPUT_INVALID'));
  assert.equal(evaluated, false);
});
