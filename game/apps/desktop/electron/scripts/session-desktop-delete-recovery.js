"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const PHASES = ["delete_recovery_failure", "delete_recovery_restart"];
const handlesPhase = phase => PHASES.includes(phase);

async function runCoordinator({ runPhase, createSettingsFixture, rootEnv }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(root, name));
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TMPDIR: path.join(root, "tmp"), [rootEnv]: root,
    XDG_CONFIG_HOME: path.join(root, "home", "config"), XDG_CACHE_HOME: path.join(root, "home", "cache"),
    GREY_CROW_DATA_ROOT: path.join(root, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(root, "provider-check"),
    GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(root, "kokoro-fixture") });
  await createSettingsFixture(root, "zh-CN");
  process.stdout.write(`Deletion recovery artifacts: ${root}\n`);
  const runs = [];
  for (const phase of PHASES) runs.push(await runPhase(require("electron"), phase, env));
  assert(runs.every(run => run.modelCalls === 0 && run.chapterModelCalls === 0 && run.ttsRequests === 0));
  const result = { ok: true, suite: "delete-recovery", root, runs,
    evidence: "Real Electron, Main/preload and temporary save: partial deletion fault, honest UI, restart discovery, confirmed retry and token consumption.",
    limitations: ["EBUSY is injected after deleting the temporary database; not real Windows file sharing.", "No real provider, user saves or release validation."] };
  fs.writeFileSync(path.join(root, "results", "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, root, evidenceFile: path.join(root, "results", "result.json") }) + "\n");
}

function installFailure(root, evidence) {
  if (evidence.phase !== PHASES[0]) return;
  const promises = require("node:fs/promises");
  const original = promises.rm;
  promises.rm = async function (target, options) {
    if (!evidence.partialDeleteInjected && path.dirname(String(target)) === path.join(root, "data", "saves")
      && path.basename(String(target)).startsWith(".delete-intent-")) {
      const database = path.join(target, "session.sqlite");
      assert(fs.existsSync(database), "fault must happen after a real saved database exists");
      fs.rmSync(database);
      // The durable directory name must survive even if recursive rm removed
      // the marker before encountering a locked file.
      fs.rmSync(path.join(target, ".delete-intent.json"), { force: true });
      evidence.partialDeleteInjected = true;
      throw Object.assign(new Error("SYNTHETIC_LOCKED_SAVE_FILE"), { code: "EBUSY" });
    }
    return original.call(this, target, options);
  };
}

async function runPhase(win, evidence, root, ui) {
  const { click, change, evaluate, waitFor, screenshot, connectSyntheticModel } = ui;
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "results", "settings-fixture.json"), "utf8"));
  await waitFor(win, "save list loaded", "Boolean(state.settingsCatalog) && !state.busy");
  if (evidence.phase === PHASES[0]) {
    await connectSyntheticModel(win);
    await click(win, "#closeSettingsButton"); await click(win, "#continueGameButton");
    await waitFor(win, "active adventure ready", "notebookBookController?.getState().phase==='reading' && state.gameStarted && !state.busy");
    await click(win, "#gameSettingsButton"); await click(win, "#settingsTabSave"); await click(win, "#saveMaintenanceButton");
    await click(win, "#maintenanceClearButton");
  } else {
    await waitFor(win, "pending deletion restored after restart", "state.pendingDeletes.length===1 && document.querySelector('.pending-delete')");
    assert.equal(await evaluate(win, "state.saves.length"), 0, "partial save must never be listed as playable");
    const pending = await evaluate(win, "state.pendingDeletes[0]");
    assert.deepEqual(Object.keys(pending).sort(), ["deletionId", "saveId", "state"]);
    const forged = await evaluate(win, "window.greyCrow.requestSaveMaintenance('clear',{deletionId:'../../settings.json'})");
    assert.equal(forged.ok, false);
    await screenshot(win, root, "delete-pending-after-restart", evidence);
    await click(win, ".pending-delete");
    await waitFor(win, "pending-only confirmation", "state.pendingMaintenance?.scope==='delete_pending'");
  }
  await waitFor(win, "delete confirmation ready", "Boolean(state.pendingMaintenance) && !state.busy");
  const confirmation = await evaluate(win, "state.pendingMaintenance");
  await change(win, "#maintenanceConfirmInput", confirmation.confirmationText, "input");
  await click(win, "#maintenanceConfirmButton");
  await waitFor(win, "delete operation settles", "!state.busy");
  if (evidence.phase === PHASES[0]) {
    assert.equal(evidence.partialDeleteInjected, true);
    await waitFor(win, "pending deletion surfaced", "state.pendingDeletes.length===1 && !state.gameStarted && !state.activeSaveId");
    assert.equal(await evaluate(win, "ui.maintenanceStatus.textContent"), await evaluate(win, "t('maintenance.deletePending')"));
    assert.equal(await evaluate(win, "state.pendingMaintenance"), null, "failed deletion consumed its confirmation");
    assert.equal(fs.existsSync(path.join(root, "data", "saves", fixture.adventureId)), false);
    await screenshot(win, root, "delete-partial-failure", evidence);
    await click(win, "#closeMaintenanceButton");
    await waitFor(win, "cleanup entry reachable without a playable save", "document.querySelector('.pending-delete') && !ui.menuView.classList.contains('hidden')");
  } else {
    await waitFor(win, "cleanup removes pending menu entry", "state.pendingDeletes.length===0 && !document.querySelector('.pending-delete') && !ui.maintenanceDialog.open");
    const replay = await evaluate(win, `window.greyCrow.confirmSaveMaintenance(${JSON.stringify(confirmation.confirmationToken)},${JSON.stringify(confirmation.confirmationText)})`);
    assert.equal(replay.ok, false, "consumed cleanup confirmation cannot be replayed");
    assert.equal(fs.readdirSync(path.join(root, "data", "saves")).length, 0);
    await screenshot(win, root, "delete-cleanup-complete", evidence);
  }
  assert.equal(fs.existsSync(path.join(root, "data", "settings.json")), true);
  return { ...evidence, revision: null };
}

module.exports = { handlesPhase, runCoordinator, installFailure, runPhase };
