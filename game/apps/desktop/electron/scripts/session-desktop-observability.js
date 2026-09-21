"use strict";

// Only the synthetic Provider is controlled. Main, preload, renderer, the real
// session child, SQLite recovery and the diagnostics download execute normally.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PHASES = ["observability_pending", "observability_retry", "observability_committed"];
const INPUT = "我查看门边的纸条，暂不触碰。OBS_PRIVATE_PLAYER_INPUT";
const REPLY = "陈姨仍站在门边，纸条也留在原处。OBS_PRIVATE_COMMITTED_STORY";
const LATE_REPLY = "这份迟到的回答不得进入故事。OBS_PRIVATE_LATE_STORY";
const pendingProviders = new Map();
const handlesPhase = (phase) => PHASES.includes(phase);
const fixturePath = (root) => path.join(root, "results", "observability-fixture.json");
const readFixture = (root) => JSON.parse(fs.readFileSync(fixturePath(root), "utf8"));

async function runCoordinator({ runPhase, createSettingsFixture, rootEnv }) {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const directory of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, directory));
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
    XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [rootEnv]: tempRoot,
    GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
    GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
  const otherAdventure = await createSettingsFixture(tempRoot, "en-US");
  const fixture = { ...await createSettingsFixture(tempRoot, "zh-CN"), otherAdventure };
  fs.writeFileSync(fixturePath(tempRoot), JSON.stringify(fixture, null, 2));
  process.stdout.write(`Observability artifacts: ${tempRoot}\n`);
  const runs = [];
  for (const phase of PHASES) runs.push(await runPhase(require("electron"), phase, env));
  const [pending, retry, committed] = runs;
  assert.deepEqual(runs.map((run) => run.revision), [0, 1, 1]);
  assert.deepEqual(runs.map((run) => run.modelCalls), [1, 1, 0]);
  assert.ok(runs.every((run) => run.chapterModelCalls === 0 && run.ttsRequests === 0));
  assert.equal(pending.actionId, retry.actionId); assert.equal(retry.actionId, committed.actionId);
  assert.notEqual(pending.attemptId, retry.attemptId); assert.equal(retry.attemptId, committed.attemptId);
  const stored = readDatabase(fixture);
  assert.equal(stored.revision, 1); assert.equal(stored.actions.length, 1); assert.equal(stored.turns.length, 1);
  assert.equal(stored.actions[0].request.input, INPUT);
  assert.equal(stored.actions[0].action_id, pending.actionId);
  assert.equal(stored.turns[0].narration[0].text, REPLY);
  const otherStored = readDatabase(fixture.otherAdventure);
  assert.equal(otherStored.revision, 0); assert.equal(otherStored.actions.length, 0);
  const result = { ok: true, suite: "observability", tempRoot, runs,
    evidence: "Actual desktop settings, persisted pending action, session-child retry and diagnostics download; only Provider results are synthetic.",
    limitations: ["No real Provider, TTS voice quality, player acceptance or release validation.", "Diagnostics retain the latest attempt, not a complete lifetime retry or model-call ledger."] };
  fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function observeRequest(channel, request, evidence) {
  if (!handlesPhase(evidence.phase)) return;
  if (channel === "grey-crow:run-turn") (evidence.actionRequests ||= []).push(structuredClone(request));
}
function observeResult(channel, result, evidence) {
  if (!handlesPhase(evidence.phase)) return;
  if (channel === "grey-crow:run-turn") (evidence.actionReceipts ||= []).push({ ok: result?.ok, stale: result?.stale,
    actionResult: result?.actionResult, error: result?.error });
  if (channel === "grey-crow:continue-game") (evidence.pendingRecoveries ||= []).push({ ok: result?.ok,
    pendingAction: result?.pendingAction ?? null, revision: result?.save?.revision });
}

async function generate(request, evidence, tempRoot) {
  assert.ok(evidence.phase !== "observability_committed", "recovery must not invoke the Provider");
  evidence.modelCalls++;
  assert.equal(evidence.modelCalls, 1, "no repair, auto-retry or automatic chapter call is expected");
  const messages = request.messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } });
  assert.ok(!messages.some((item) => item?.task), "observability must not run chapter or compaction models");
  const fixed = messages.find((item) => item?.canonicalState);
  assert.equal(fixed?.baseRevision, 0);
  const input = request.messages.find((message) => message.content?.startsWith("Current player action:\n"))?.content.slice("Current player action:\n".length);
  assert.equal(input, INPUT);
  evidence.modelInputs.push({ input, revision: fixed.baseRevision });
  const response = (text) => ({ text: JSON.stringify({ narration: [{ id: "observed-doorway", text }], events: [], experiences: [] }),
    toolCalls: [], usage: { input_tokens: 120, output_tokens: 90 }, model: "synthetic-local", finishReason: "stop" });
  if (evidence.phase === "observability_pending") {
    request.signal.addEventListener("abort", () => { evidence.oldProviderAborted = true; }, { once: true });
    return new Promise((resolve) => pendingProviders.set(tempRoot, () => {
      evidence.oldProviderReleased = true; resolve(response(LATE_REPLY));
    }));
  }
  return response(REPLY);
}

function readDatabase(fixture) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(fixture.databasePath, { readOnly: true });
  try {
    db.exec("BEGIN");
    const revision = db.prepare("SELECT revision FROM session WHERE singleton=1").get().revision;
    const actions = db.prepare("SELECT action_id,attempt_id,status,revision,error_code,request_json FROM actions ORDER BY rowid").all()
      .map(({ request_json, ...row }) => ({ ...row, request: JSON.parse(request_json) }));
    const turns = db.prepare("SELECT revision,action_id,narration_json FROM turns WHERE action_id IS NOT NULL ORDER BY revision").all()
      .map(({ narration_json, ...row }) => ({ ...row, narration: JSON.parse(narration_json) }));
    return { revision, actions, turns };
  } finally { try { db.exec("ROLLBACK"); } catch {} db.close(); }
}

async function runPhase(win, evidence, tempRoot, ui) {
  const { click, change, evaluate, readStatus, waitFor, waitUntil, delay, screenshot, connectSyntheticModel, submit, syntheticKey } = ui;
  const fixture = readFixture(tempRoot);
  const initialPhase = evidence.phase === "observability_pending";
  const completedPhase = evidence.phase === "observability_committed";
  if (!(await readStatus(win)).keyVerified) { await connectSyntheticModel(win); await click(win, "#closeSettingsButton"); }
  await waitFor(win, "native synthetic adventure available", "!document.querySelector('#continueGameButton').disabled");
  assert.equal(await evaluate(win, `continueGame(${JSON.stringify(fixture.adventureId)})`), true);
  await waitFor(win, "read-only adventure recovered", `(async () => { const s=await window.greyCrow.getStatus(); return s.activeSaveId===${JSON.stringify(fixture.adventureId)} && s.gameStarted && !s.sessionRecoveryRequired && s.activeSave?.revision===${completedPhase ? 1 : 0} && !state.busy; })()`);
  if (await evaluate(win, "notebookBookController?.getState()?.phase === 'opening'")) {
    await evaluate(win, "notebookBookController.skip()");
    await waitFor(win, "notebook opening skipped for observability controls", "notebookBookController?.getState()?.phase === 'reading' && !ui.gameView.inert");
  }
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0);
  if (initialPhase) {
    await click(win, "#gameSettingsButton"); await click(win, "#settingsTabDeveloper");
    await change(win, "#debugPanelEnabledSelect", "true");
    await waitFor(win, "diagnostics enabled", "!state.settingsSaving && state.debugPanelEnabled && !state.settingsDirty");
    await click(win, "#closeSettingsButton");
    const before = await readStatus(win);
    await submit(win, INPUT);
    await waitUntil("first Provider request held", () => pendingProviders.has(tempRoot));
    const registered = readDatabase(fixture);
    assert.equal(registered.actions.length, 1); assert.equal(registered.actions[0].status, "running");
    evidence.actionId = registered.actions[0].action_id; evidence.attemptId = registered.actions[0].attempt_id;
    await click(win, "#gameSettingsButton"); await click(win, "#settingsTabDeveloper");
    const nextWindow = before.settings.agent.context.configuredContextWindow === 192000 ? 224000 : 192000;
    await change(win, "#contextWindowPresetSelect", "custom"); await change(win, "#contextWindowCustomInput", String(nextWindow), "input");
    await waitFor(win, "replacement session restored original pending action", `(async () => { const s=await window.greyCrow.getStatus(); return s.runtimeSessionId!==${JSON.stringify(before.runtimeSessionId)} && s.activeSave?.revision===0 && !s.sessionRecoveryRequired && s.gameStarted && !state.settingsSaving && !state.busy && state.pendingSessionAction?.actionId===${JSON.stringify(evidence.actionId)}; })()`);
    await click(win, "#closeSettingsButton");
    await assertPending(win, fixture, evidence.actionId, ui);
    assert.equal(evidence.modelCalls, 1);
    await waitUntil("closed request signal aborted", () => evidence.oldProviderAborted === true);
    pendingProviders.get(tempRoot)(); pendingProviders.delete(tempRoot);
    await waitUntil("old invocation returned", () => evidence.actionReceipts?.length === 1);
    await delay(500);
    assert.equal((await readStatus(win)).activeSave.revision, 0);
    assert.equal(readDatabase(fixture).turns.length, 0);
    assert.equal(evidence.modelCalls, 1);
    assert.equal((await evaluate(win, "document.querySelector('#narrationPanel').textContent")).includes(LATE_REPLY), false);
    await assertPending(win, fixture, evidence.actionId, ui);
    await screenshot(win, tempRoot, "observability-pending-restored", evidence);
  } else {
    const prior = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "observability_pending.json"), "utf8"));
    evidence.actionId = prior.actionId;
    evidence.readonlyRecoveryModelCalls = evidence.modelCalls;
    if (!completedPhase) {
      await assertPending(win, fixture, prior.actionId, ui);
      assert.equal(readDatabase(fixture).actions[0].attempt_id, prior.attemptId);
      await inspectDiagnostics(win, evidence, tempRoot, fixture, "interrupted", ui);
      await screenshot(win, tempRoot, "observability-restarted-pending", evidence);
      assert.equal(evidence.modelCalls, 0);
      await switchAdventure(win, fixture.otherAdventure.adventureId, ui);
      const foreignDraft = "This unfinished draft belongs only to the other adventure.";
      await change(win, "#turnInput", foreignDraft, "input");
      assert.equal(await evaluate(win, "document.querySelector('#turnInput').value"), foreignDraft);
      await switchAdventure(win, fixture.adventureId, ui);
      await assertPending(win, fixture, prior.actionId, ui);
      assert.equal(evidence.modelCalls, 0);
      evidence.crossAdventureDraftIsolation = true;
      await click(win, "#sendTurnButton");
      await waitFor(win, "explicit retry committed exactly once", `(async () => { const s=await window.greyCrow.getStatus(); return s.activeSave?.revision===1 && !state.busy && !state.pendingSessionAction && document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(REPLY)}); })()`);
      assert.equal(evidence.modelCalls, 1);
      assert.equal(evidence.actionRequests.length, 1);
      assert.equal(evidence.actionRequests[0].actionId, prior.actionId);
      assert.equal(evidence.actionRequests[0].retry, true);
      const stored = readDatabase(fixture);
      assert.equal(stored.actions.length, 1); assert.equal(stored.turns.length, 1);
      evidence.attemptId = stored.actions[0].attempt_id;
      assert.notEqual(evidence.attemptId, prior.attemptId);
      await inspectDiagnostics(win, evidence, tempRoot, fixture, "committed", ui);
    } else {
      const stored = readDatabase(fixture); evidence.attemptId = stored.actions[0].attempt_id;
      assert.equal(await evaluate(win, "state.pendingSessionAction"), null);
      assert.equal(await evaluate(win, "document.querySelector('#turnInput').value"), "");
      assert.ok(evidence.pendingRecoveries?.every((item) => item.pendingAction === null));
      assert.equal(evidence.modelCalls, 0);
      await inspectDiagnostics(win, evidence, tempRoot, fixture, "committed", ui);
    }
    await waitFor(win, "committed narration fully rendered once", `Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text')).filter(node => node.textContent===${JSON.stringify(REPLY)}).length===1`);
    await screenshot(win, tempRoot, `${evidence.phase}-story`, evidence);
  }
  assert.equal(evidence.ttsRequests, 0); assert.equal(evidence.chapterModelCalls, 0);
  assert.equal(evidence.audioGenerations, 0);
  assert.ok(!(await evaluate(win, "document.body.innerText")).includes(syntheticKey));
  const final = readDatabase(fixture);
  assert.equal(final.actions.length, 1);
  if (initialPhase) {
    assert.equal(final.actions[0].status, "interrupted");
    assert.equal(final.actions[0].error_code, "PROCESS_INTERRUPTED");
  }
  return { ...evidence, adventureId: fixture.adventureId, revision: final.revision,
    actionId: evidence.actionId, attemptId: evidence.attemptId };
}

async function switchAdventure(win, adventureId, { click, evaluate, waitFor }) {
  await click(win, "#gameSettingsButton");
  await click(win, "#backToMenuButton");
  await waitFor(win, "leave the active adventure before selecting another", "!state.gameStarted && !state.busy && !document.querySelector('#settingsDialog').open");
  assert.equal(await evaluate(win, `continueGame(${JSON.stringify(adventureId)})`), true);
  if (await evaluate(win, "notebookBookController?.getState()?.phase === 'opening'")) {
    await evaluate(win, "notebookBookController.skip()");
    await waitFor(win, "switched notebook opening skipped", "notebookBookController?.getState()?.phase === 'reading' && !ui.gameView.inert");
  }
}

async function assertPending(win, fixture, actionId, { evaluate, waitFor }) {
  await waitFor(win, "original pending input is visible and editable", `state.pendingSessionAction?.actionId===${JSON.stringify(actionId)} && state.pendingSessionAction?.baseRevision===0 && state.pendingSessionAction?.adventureId===${JSON.stringify(fixture.adventureId)} && state.pendingSessionAction?.sessionId===state.runtimeSessionId && document.querySelector('#turnInput').value===${JSON.stringify(INPUT)} && !document.querySelector('#sendTurnButton').disabled`);
  const visible = await evaluate(win, `Array.from(document.querySelectorAll('#narrationPanel .narration-line.player')).filter(node => node.dataset.actionId===${JSON.stringify(actionId)}).map(node => ({text:node.textContent,status:node.dataset.actionStatus}))`);
  assert.equal(visible.length, 1); assert.ok(visible[0].text.includes(INPUT)); assert.equal(visible[0].status, "interrupted");
}

async function inspectDiagnostics(win, evidence, tempRoot, fixture, expectedStatus, ui) {
  const { click, evaluate, waitFor, waitUntil, screenshot, syntheticKey } = ui;
  const calls = evidence.modelCalls;
  await click(win, "#gameSettingsButton"); await click(win, "#settingsTabDeveloper"); await click(win, "#debugPanelButton");
  await waitFor(win, "persistent native action diagnostics", `document.querySelector('#debugDialog').open && !document.querySelector('#debugRefreshButton').disabled && state.debugTraceEntries.length===1 && state.debugTraceEntries[0].kind==='session_action' && state.debugTraceEntries[0].session_action?.status===${JSON.stringify(expectedStatus)}`);
  const payload = await evaluate(win, "({entries:structuredClone(state.debugTraceEntries),summary:structuredClone(state.debugTraceSummary),export:structuredClone(state.debugTraceExport),text:document.querySelector('#debugTraceList').textContent})");
  const row = readDatabase(fixture).actions[0], entry = payload.entries[0];
  assert.equal(entry.record_id, row.action_id); assert.equal(entry.request_id, row.action_id);
  assert.equal(entry.session_action.status, expectedStatus); assert.equal(entry.session_action.baseRevision, 0);
  assert.equal(entry.session_action.committedRevision, expectedStatus === "committed" ? 1 : null);
  assert.equal(entry.session_action.attemptId, row.attempt_id);
  assert.equal(entry.session_action.attemptHistoryComplete, false); assert.equal(entry.session_action.modelUsage, null);
  assert.equal(entry.error_code, row.error_code || "");
  assert.ok(payload.text.includes(row.attempt_id), "the UI must show the retained attempt identity");
  assert.equal(payload.summary.summary_schema_version, "grey-crow-session-summary-v1");
  assert.equal(payload.summary.attempt_history_complete, false); assert.equal(payload.summary.model_usage, null);
  for (const secret of [INPUT, REPLY, LATE_REPLY, syntheticKey, tempRoot, fixture.databasePath]) assert.equal(payload.export.content.includes(secret), false);
  assert.doesNotMatch(payload.export.content, /"(?:input|narration|request_json|state_json|owner_pid|owner_id)"\s*:/);
  const filename = path.join(tempRoot, "results", `${evidence.phase}-${expectedStatus}-diagnostics.json`);
  let downloaded = false, downloadError;
  win.webContents.session.once("will-download", (_event, item) => {
    item.setSavePath(filename);
    item.once("done", (_done, state) => { if (state !== "completed") downloadError = state; downloaded = true; });
  });
  await click(win, "#debugExportButton");
  await waitUntil("actual diagnostics JSON download", () => downloaded);
  assert.equal(downloadError, undefined);
  const exported = fs.readFileSync(filename, "utf8");
  assert.deepEqual(JSON.parse(exported), JSON.parse(payload.export.content));
  assert.equal(evidence.modelCalls, calls);
  (evidence.diagnostics ||= []).push({ status: expectedStatus, entry, summary: payload.summary, filename, exportBytes: Buffer.byteLength(exported) });
  await screenshot(win, tempRoot, `${evidence.phase}-${expectedStatus}-diagnostics`, evidence);
  await click(win, "#closeDebugButton");
  if (await evaluate(win, "document.querySelector('#settingsDialog').open")) await click(win, "#closeSettingsButton");
}

module.exports = { handlesPhase, runCoordinator, runPhase, generate, observeRequest, observeResult };
