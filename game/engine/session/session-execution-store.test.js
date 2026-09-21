'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createTurnStore } = require('./turn-store');
const samples = require('./test-fixtures/turn-samples');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grey-crow-execution-store-'));
  const databasePath = path.join(directory, 'session.sqlite');
  const stores = [];
  t.after(() => { for (const store of stores.reverse()) store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { databasePath, open(extra = {}) {
    const store = createTurnStore({ ...samples.identity(databasePath), ...options, ...extra });
    stores.push(store); return store;
  } };
}

function trace(action, extra = {}) {
  return { format: 'session-execution-1', phase: 'story_generation', adventureId: action.adventureId,
    actionId: action.actionId, attemptId: action.attemptId, baseRevision: action.request.baseRevision,
    startedAt: '2026-09-11T00:00:00.000Z', lastSequence: 0, truncated: false, steps: [], ...extra };
}

test('execution records retain a failed attempt before retry, and sealed or superseded attempts reject late writes', (t) => {
  const env = fixture(t);
  let store = env.open({ initialState: samples.initialState() });
  const request = samples.request({ actionId: 'retry-trace' });
  const first = store.beginAction(request);
  assert.equal(typeof store.recordExecution, 'function');
  assert.equal(store.recordExecution(trace(first)), true);
  store.failAction({ actionId: first.actionId, attemptId: first.attemptId, code: 'TURN_TIMEOUT', retryable: true });
  const retried = store.beginAction(request, { retry: true });
  assert.equal(store.recordExecution(trace(first, { lastSequence: 999 })), false);
  assert.equal(store.recordExecution(trace(retried)), true);
  store.commitAction({ actionId: retried.actionId, attemptId: retried.attemptId, bundle: samples.refusedBundle() });
  const before = store.readDiagnostics().execution;
  assert.equal(before.records.length, 2);
  const failed = before.records.find(record => record.attemptId === first.attemptId);
  assert.equal(failed.status, 'failed'); assert.equal(failed.error.code, 'TURN_TIMEOUT');
  const committed = before.records.find(record => record.attemptId === retried.attemptId);
  assert.equal(committed.status, 'committed'); assert.equal(committed.committedRevision, 1);
  assert.equal(store.recordExecution(trace(retried, { lastSequence: 1000 })), false);
  store.close(); store = env.open();
  assert.deepEqual(store.readDiagnostics().execution, before);
});

function sql(env, operation) {
  const db = new DatabaseSync(env.databasePath);
  try { return operation(db); } finally { db.close(); }
}
function digest(file) { return require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function invoked(seq) {
  return { seq, kind: 'model', outcome: 'invoked', elapsedMs: seq, callIndex: seq,
    request: { sha256: 'a'.repeat(64), characters: 1000, bytes: 2000, estimatedInputTokens: 800,
      safetyInputTokens: 1000, contextGeneration: 0, maxOutputTokens: 8192, settingsIdentity: 'b'.repeat(64) } };
}

test('opening, reads and closing without an action never create diagnostics or mutate an existing database', (t) => {
  const env = fixture(t); let store = env.open({ initialState: samples.initialState() }); store.close();
  const before = digest(env.databasePath); store = env.open();
  assert.equal(store.readDiagnostics().execution.available, false);
  store.readView(); store.readModelState(); store.close();
  assert.equal(digest(env.databasePath), before);
  assert.equal(sql(env, db => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='execution_attempts'").get().n), 0);
});

test('execution snapshots enforce current owner, base, monotonic immutable steps and safe shape', (t) => {
  const env = fixture(t); const store = env.open({ initialState: samples.initialState() });
  const action = store.beginAction(samples.request()); const other = env.open();
  const first = trace(action, { lastSequence: 1, steps: [invoked(1)] });
  assert.equal(other.recordExecution(first), false);
  assert.equal(store.recordExecution({ ...first, adventureId: 'another' }), false);
  assert.equal(store.recordExecution({ ...first, baseRevision: 1 }), false);
  assert.equal(store.recordExecution({ ...first, secret: 'must-not-store' }), false);
  assert.equal(store.recordExecution({ ...first, get steps() { throw new Error('no accessor'); } }), false);
  assert.equal(store.recordExecution(first), true);
  assert.equal(store.recordExecution(first), true);
  assert.equal(store.recordExecution(trace(action)), false);
  assert.equal(store.recordExecution({ ...first, steps: [{ ...invoked(1), elapsedMs: 999 }] }), false);
  const result = store.readDiagnostics().execution.records[0];
  assert.equal(result.incomplete, true); assert.deepEqual(result.steps, first.steps);
  store.cancelAction(action.actionId);
  assert.equal(store.recordExecution(first), false);
  assert.equal(store.readDiagnostics().execution.records[0].status, 'cancelled');
});

for (const stage of ['execution_before_write', 'execution_before_commit']) {
  test(`${stage} failure cannot change commit, cancellation, retry or recovery`, (t) => {
    let fail = true;
    const env = fixture(t, { faultInjector(point) { if (fail && point === stage) throw new Error('secret diagnostic failure'); } });
    let store = env.open({ initialState: samples.initialState() });
    const first = store.beginAction(samples.request({ actionId: 'failure' }));
    assert.equal(first.started, true); assert.equal(store.recordExecution(trace(first)), false);
    store.failAction({ actionId: first.actionId, attemptId: first.attemptId, code: 'TURN_TIMEOUT', retryable: true });
    const second = store.beginAction(first.request, { retry: true });
    const committed = store.commitAction({ actionId: second.actionId, attemptId: second.attemptId, bundle: samples.refusedBundle() });
    assert.equal(committed.status, 'committed'); assert.equal(committed.revision, 1);
    const cancelled = store.beginAction(samples.request({ actionId: 'cancel', baseRevision: 1 }));
    assert.equal(store.cancelAction(cancelled.actionId).status, 'cancelled');
    const pending = store.beginAction(samples.request({ actionId: 'close', baseRevision: 1 }));
    store.close(); fail = false; store = env.open();
    assert.equal(store.readAction(pending.actionId).status, 'interrupted');
    assert.equal(store.readAction(second.actionId).status, 'committed');
    assert.equal(store.readDiagnostics().execution.available, false, 'failed auxiliary DDL rolled back');
  });
}

test('sealing failure projects durable status on read and preserves it before a new retry attempt', (t) => {
  let fail = false;
  const env = fixture(t, { faultInjector(point) { if (fail && point === 'execution_before_commit') throw new Error('aux'); } });
  const store = env.open({ initialState: samples.initialState() });
  const first = store.beginAction(samples.request()); store.recordExecution(trace(first)); fail = true;
  store.failAction({ actionId: first.actionId, attemptId: first.attemptId, code: 'TURN_TIMEOUT', retryable: true });
  assert.equal(store.readDiagnostics().execution.records[0].status, 'failed');
  fail = false; store.beginAction(first.request, { retry: true });
  const previous = store.readDiagnostics().execution.records.find(record => record.attemptId === first.attemptId);
  assert.equal(previous.status, 'failed'); assert.equal(previous.error.code, 'TURN_TIMEOUT');
});

test('an acknowledgement failure occurs after a sealed commit, and repeating the action creates no attempt', (t) => {
  const env = fixture(t, { faultInjector(point) { if (point === 'after_commit') throw new Error('lost acknowledgement'); } });
  const store = env.open({ initialState: samples.initialState() }); const action = store.beginAction(samples.request());
  assert.throws(() => store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.refusedBundle() }), /lost acknowledgement/);
  const before = store.readDiagnostics();
  assert.equal(before.execution.records[0].status, 'committed');
  assert.equal(store.beginAction(action.request).started, false);
  assert.equal(store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: null }).revision, 1);
  assert.deepEqual(store.readDiagnostics(), before);
});

test('crash recovery keeps the unfinished invocation and marks its outcome incomplete', (t) => {
  const env = fixture(t);
  const script = `const {createTurnStore}=require(${JSON.stringify(require.resolve('./turn-store'))});
    const samples=require(${JSON.stringify(require.resolve('./test-fixtures/turn-samples'))});
    const store=createTurnStore({...samples.identity(${JSON.stringify(env.databasePath)}),initialState:samples.initialState()});
    const action=store.beginAction(samples.request());
    store.recordExecution({...${JSON.stringify(trace({ adventureId: 'test-adventure', actionId: 'a', attemptId: 'b', request: { baseRevision: 0 } }))},
      actionId:action.actionId,attemptId:action.attemptId,lastSequence:1,steps:[${JSON.stringify(invoked(1))}]});`;
  const child = require('node:child_process').spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  assert.equal(child.status, 0, child.stderr);
  const store = env.open(); const record = store.readDiagnostics().execution.records[0];
  assert.equal(record.status, 'interrupted'); assert.equal(record.error.code, 'PROCESS_INTERRUPTED');
  assert.equal(record.incomplete, true); assert.equal(record.steps[0].outcome, 'invoked');
  assert.equal(store.readView().revision, 0);
});

test('retention is 100 ended attempts plus active; whole diagnostics and each returned record stay bounded', (t) => {
  const env = fixture(t); const store = env.open({ initialState: samples.initialState() });
  const steps = Array.from({ length: 150 }, (_, index) => invoked(index + 1));
  for (let index = 0; index < 103; index++) {
    const action = store.beginAction(samples.request({ actionId: `retained-${index}` }));
    assert.equal(store.recordExecution(trace(action, { lastSequence: steps.length, steps })), true);
    store.cancelAction(action.actionId);
  }
  const active = store.beginAction(samples.request({ actionId: 'active' }));
  const diagnostics = store.readDiagnostics({ limit: 100 });
  assert.equal(diagnostics.counts.actions, 104); assert.equal(diagnostics.entries.length, 100);
  assert.equal(diagnostics.execution.retainedAttempts, 101); assert.equal(diagnostics.execution.truncated, true);
  assert.equal(diagnostics.execution.records[0].attemptId, active.attemptId);
  assert.ok(diagnostics.execution.returnedAttempts < 101); assert.equal(diagnostics.execution.historyComplete, false);
  assert.ok(Buffer.byteLength(JSON.stringify(diagnostics)) <= 512 * 1024);
  assert.ok(diagnostics.execution.records.every(record => Buffer.byteLength(JSON.stringify(record)) <= 65536));
  assert.equal(sql(env, db => db.prepare('SELECT count(*) AS n FROM execution_attempts').get().n), 101);
  assert.equal(sql(env, db => db.prepare("SELECT count(*) AS n FROM execution_attempts WHERE action_id='retained-0'").get().n), 0);
});

test('copied ancestor diagnostics are hidden on read and physically removed on the next local action', (t) => {
  const env = fixture(t); const store = env.open({ initialState: samples.initialState() });
  const first = store.beginAction(samples.request()); store.cancelAction(first.actionId);
  sql(env, db => db.prepare("UPDATE execution_attempts SET adventure_id='ancestor'").run());
  const before = digest(env.databasePath);
  assert.equal(store.readDiagnostics().execution.records.length, 0); assert.equal(digest(env.databasePath), before);
  store.beginAction(samples.request({ actionId: 'child' }));
  assert.equal(sql(env, db => db.prepare("SELECT count(*) AS n FROM execution_attempts WHERE adventure_id<>'test-adventure'").get().n), 0);
});

test('corrupt execution data and read faults cannot hide ordinary action diagnostics or leak fields', (t) => {
  let failRead = false;
  const env = fixture(t, { faultInjector(point) { if (failRead && point === 'execution_read') throw new Error('private failure'); } });
  const store = env.open({ initialState: samples.initialState() }); const action = store.beginAction(samples.request());
  store.failAction({ actionId: action.actionId, attemptId: action.attemptId, code: 'PRIVATE_MODEL_OUTPUT', retryable: true });
  const baseline = store.readDiagnostics();
  assert.equal(baseline.execution.records[0].error.code, 'ACTION_FAILED');
  failRead = true; const failed = store.readDiagnostics(); failRead = false;
  assert.deepEqual(failed.entries, baseline.entries); assert.deepEqual(failed.counts, baseline.counts);
  assert.equal(failed.execution.available, false);
  sql(env, db => db.prepare("UPDATE execution_attempts SET committed_revision='private source payload'").run());
  const corrupt = store.readDiagnostics(); assert.equal(corrupt.execution.available, false);
  assert.ok(!JSON.stringify(corrupt).includes('private'));
  sql(env, db => db.prepare("UPDATE execution_attempts SET committed_revision=NULL,snapshot_json='not JSON private'").run());
  assert.equal(store.readDiagnostics().execution.available, false);
  assert.deepEqual(store.readDiagnostics().entries, baseline.entries);
});

test('a lost later snapshot cannot turn a closed prefix into a complete trace after commit and reopen', (t) => {
  let fail = false;
  const env = fixture(t, { faultInjector(stage) { if (fail && stage === 'execution_before_write') throw new Error('lost diagnostic'); } });
  let store = env.open({ initialState: samples.initialState() }); const action = store.beginAction(samples.request());
  const steps = [invoked(1), { seq: 2, kind: 'model', outcome: 'returned', elapsedMs: 2, callIndex: 1,
    durationMs: 1, usage: { input_tokens: 100, output_tokens: 20 }, usageComplete: true, finishReason: 'stop' }];
  assert.equal(store.recordExecution(trace(action, { steps, lastSequence: 2 })), true);
  fail = true;
  assert.equal(store.recordExecution(trace(action, { steps: [...steps, { ...invoked(3), callIndex: 2 }], lastSequence: 3 })), false);
  fail = false;
  store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.refusedBundle() });
  const record = store.readDiagnostics().execution.records[0];
  assert.equal(record.status, 'committed'); assert.equal(record.steps.length, 2); assert.equal(record.incomplete, true);
  store.close(); store = env.open(); assert.deepEqual(store.readDiagnostics().execution.records[0], record);
});

test('a committed action whose auxiliary seal failed remains explicitly incomplete even after a read-only reopen', (t) => {
  let fail = false;
  const env = fixture(t, { faultInjector(stage) { if (fail && stage === 'execution_before_write') throw new Error('lost seal'); } });
  let store = env.open({ initialState: samples.initialState() }); const action = store.beginAction(samples.request());
  const steps = [invoked(1), { seq: 2, kind: 'model', outcome: 'returned', elapsedMs: 2, callIndex: 1,
    durationMs: 1, usage: { input_tokens: 1, output_tokens: 1 }, usageComplete: true, finishReason: 'stop' }];
  assert.equal(store.recordExecution(trace(action, { lastSequence: 2, steps })), true);
  fail = true; store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: samples.refusedBundle() });
  const record = store.readDiagnostics().execution.records[0];
  assert.equal(record.status, 'committed'); assert.equal(record.incomplete, true);
  store.close(); fail = false; store = env.open();
  assert.equal(store.readDiagnostics().execution.records[0].incomplete, true, 'recovery seal must preserve uncertainty');
});

test('retrying after both a lost later snapshot and failed seal preserves the old closed prefix as incomplete', (t) => {
  let fail = false;
  const env = fixture(t, { faultInjector(stage) { if (fail && stage === 'execution_before_write') throw new Error('lost auxiliary write'); } });
  let store = env.open({ initialState: samples.initialState() });
  const first = store.beginAction(samples.request());
  const steps = [invoked(1), { seq: 2, kind: 'model', outcome: 'returned', elapsedMs: 2, callIndex: 1,
    durationMs: 1, usage: { input_tokens: 100, output_tokens: 20 }, usageComplete: true, finishReason: 'stop' }];
  assert.equal(store.recordExecution(trace(first, { lastSequence: 2, steps })), true);
  fail = true;
  assert.equal(store.recordExecution(trace(first, { lastSequence: 3, steps: [...steps, { ...invoked(3), callIndex: 2 }] })), false);
  const failure = store.failAction({ actionId: first.actionId, attemptId: first.attemptId, code: 'TURN_TIMEOUT', retryable: true });
  assert.equal(failure.status, 'failed');
  assert.equal(store.readDiagnostics().execution.records[0].incomplete, true, 'an unsealed row is uncertain before retry');
  fail = false;
  const retry = store.beginAction(first.request, { retry: true });
  assert.equal(retry.started, true); assert.notEqual(retry.attemptId, first.attemptId);
  const previous = store.readDiagnostics().execution.records.find(record => record.attemptId === first.attemptId);
  assert.deepEqual(previous.steps, steps, 'the persisted closed prefix remains unchanged');
  assert.equal(previous.status, 'failed'); assert.equal(previous.error.code, 'TURN_TIMEOUT');
  assert.equal(previous.incomplete, true, 'retry cannot establish that a closed prefix includes every invocation');
  store.cancelAction(retry.actionId); store.close(); store = env.open();
  assert.deepEqual(store.readDiagnostics().execution.records.find(record => record.attemptId === first.attemptId), previous);
});
