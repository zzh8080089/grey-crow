"use strict";

// The dialog picker is synthetic only; Main, preload, renderer, settings and
// report-file write all execute in Electron against an isolated data root.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PHASES = ["player_report_core", "player_report_restart"];
const handlesPhase = phase => PHASES.includes(phase);

async function runCoordinator({ runPhase, createSettingsFixture, rootEnv }) {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
    XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [rootEnv]: tempRoot, GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"),
    GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"), GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture"),
    GREY_CROW_SPEECH_INPUT_RUNTIME_ROOT: path.join(tempRoot, "missing-speech-runtime") });
  await createSettingsFixture(tempRoot, "zh-CN");
  const runs = [];
  for (const phase of PHASES) runs.push(await runPhase(require("electron"), phase, env));
  assert(runs.every(run => run.modelCalls === 0 && run.chapterModelCalls === 0 && run.ttsRequests === 0));
  const result = { ok: true, suite: "player-report", tempRoot, runs,
    evidence: "Actual Electron Main/preload/renderer export, isolated report file persistence and restart; only the OS destination picker is stubbed.",
    limitations: ["The save-picker outcome is stubbed to an isolated path, so this is not native OS dialog acceptance.", "No real Provider, player story, microphone, packaged build or release validation."] };
  fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, suite: result.suite, tempRoot, phases: runs.map(run => run.phase) }, null, 2) + "\n");
}

function probe(_options, evidence) {
  if (evidence.nextProbeFailure) {
    evidence.nextProbeFailure = false;
    throw Object.assign(new Error("SYNTHETIC_403_MUST_NOT_EXPORT"), { code: "UPSTREAM_ACCESS_DENIED", retryable: false });
  }
  return { ok: true, contractVersion: "grey-crow-provider-probe-v1", provider: "synthetic-local", model: "synthetic-local", toolCallRoundTrip: true, providerCalls: 0, usage: {} };
}

function observeResult(channel, result, evidence) {
  if (!handlesPhase(evidence.phase)) return;
  if (["grey-crow:export-problem-report", "grey-crow:record-renderer-problem", "grey-crow:speech-input-status", "grey-crow:test-provider-connection"].includes(channel)) {
    (evidence.reportReceipts ||= []).push({ channel, ok: result?.ok, cancelled: result?.cancelled, error: result?.error?.code, ignored: result?.ignored });
  }
}

async function runPhase(win, evidence, tempRoot, ui) {
  const { click, change, evaluate, readStatus, waitFor, screenshot } = ui;
  const selectTab = tab => click(win, `[data-settings-tab="${tab}"]`);
  await waitFor(win, "settings catalog ready", "Boolean(state.settingsCatalog) && !state.busy");
  assert.equal((await readStatus(win)).keyVerified, false, "problem reports must be reachable before a model is connected");
  assert.equal((await readStatus(win)).gameStarted, false, "problem reports must be reachable before an adventure opens");
  await click(win, "#settingsButton");
  await waitFor(win, "problem-report footer visible", "document.querySelector('#exportProblemReportButton')?.checkVisibility({checkVisibilityCSS:true})");

  if (evidence.phase === "player_report_core") {
    evidence.problemReportDialogMode = "success";
    await click(win, "#exportProblemReportButton");
    await waitFor(win, "problem-report saved feedback", "document.querySelector('#problemReportStatus').textContent.includes('player-problem-player_report_core.json')");
    const reportFile = path.join(tempRoot, "results", "player-problem-player_report_core.json");
    const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    assert.equal(report.build.platform, process.platform); assert.match(report.build.sourceFingerprint, /^[a-f0-9]{64}$/);
    assert.match(report.build.buildId, /^dev-[a-f0-9]{16}$/); assert.equal(report.context.modelConnected, false); assert.equal(report.context.adventureOpen, false);
    const body = JSON.stringify(report);
    for (const forbidden of [tempRoot, "sk-synthetic-session-desktop-never-a-real-credential", "synthetic-report-key", "SYNTHETIC_403_MUST_NOT_EXPORT"]) {
      assert.equal(body.includes(forbidden), false, `player report must omit ${forbidden}`);
    }
    assert.deepEqual(report.privacy, { storyText: false, playerInput: false, credentials: false, audio: false, localPaths: false, automaticallyUploaded: false });
    const speech = await evaluate(win, "window.greyCrow.getSpeechInputStatus()");
    assert.equal(speech.ok, true, "the actual missing-runtime speech status IPC must remain available");
    assert.equal(speech.status?.errorCode, "SPEECH_RUNTIME_MISSING", "the isolated runtime root must exercise the actual missing-runtime path");
    await evaluate(win, "Promise.all([window.greyCrow.recordProblem('RENDERER_SCRIPT_ERROR'), window.greyCrow.recordProblem('SPEECH_PERMISSION_DENIED')])");
    evidence.nextProbeFailure = true;
    const failedProbe = await evaluate(win, "window.greyCrow.testProviderConnection({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-report-key'})");
    assert.equal(failedProbe.ok, false, "the synthetic 403 must remain a failed normal connection result");
    const reportBeforeCancel = fs.readFileSync(reportFile, "utf8");
    evidence.problemReportDialogMode = "cancel"; await click(win, "#exportProblemReportButton");
    await waitFor(win, "problem-report cancellation feedback", "document.querySelector('#problemReportStatus').textContent===t('settings.report.cancelled') && !document.querySelector('#exportProblemReportButton').disabled");
    assert.equal(fs.readFileSync(reportFile, "utf8"), reportBeforeCancel, "cancelled picker must not alter the earlier saved report");
    evidence.problemReportDialogMode = "fail"; await click(win, "#exportProblemReportButton");
    await waitFor(win, "problem-report write failure feedback", "document.querySelector('#problemReportStatus').textContent===t('settings.report.failed') && !document.querySelector('#exportProblemReportButton').disabled");
    await selectTab("narration"); await change(win, "#narrationLengthPresetSelect", "adaptive");
    await waitFor(win, "adaptive preference persisted", "!state.settingsSaving && !state.settingsDirty && state.narrationLengthPreset==='adaptive'");
    await screenshot(win, tempRoot, "player-report-adaptive-narration", evidence);
    for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
      await selectTab("display"); await change(win, "#gameLanguageSelect", locale);
      await waitFor(win, "locale rendered", `document.documentElement.lang===${JSON.stringify(locale)} && !state.settingsSaving`);
      for (const [width, height] of [[1280, 720], [1600, 900]]) {
        win.setAspectRatio(0); win.setContentSize(width, height, false); win.center();
        await waitFor(win, "report viewport", `innerWidth===${width} && innerHeight===${height}`);
        const layout = await evaluate(win, `(() => { const footer=document.querySelector('.settings-report-footer'), dialog=document.querySelector('#settingsDialog'), content=document.querySelector('#settingsContent'); const a=footer.getBoundingClientRect(), b=dialog.getBoundingClientRect(); const tabs=[...document.querySelectorAll('[data-settings-tab]')]; const actions=document.querySelector('.settings-report-footer'); return {footerVisible:!!footer.getClientRects().length, footerInside:a.left>=b.left&&a.right<=b.right&&a.bottom<=b.bottom, overflow:content.scrollWidth-content.clientWidth, tabsUsable:tabs.length===6&&tabs.every(node=>node.scrollWidth<=node.clientWidth+2), actionFits:actions.scrollWidth<=actions.clientWidth+2}; })()`);
        assert(layout.footerVisible && layout.footerInside && layout.overflow <= 1 && layout.tabsUsable && layout.actionFits, JSON.stringify({ locale, width, height, layout }));
        await screenshot(win, tempRoot, `player-report-${locale}-${width}`, evidence);
      }
    }
    await selectTab("display"); await change(win, "#storyNotebookThemeSelect", "dark");
    await waitFor(win, "dark theme persisted", "!state.settingsSaving && !state.settingsDirty && !state.settingsSaveTask && !state.settingsAutosaveTimer && state.storyNotebookTheme==='dark'");
    await screenshot(win, tempRoot, "player-report-dark-theme", evidence);
    return { ...evidence, revision: 0, reportFile, reportBuild: report.build };
  }

  assert.equal((await evaluate(win, "state.narrationLengthPreset")), "adaptive", "adaptive preference must survive the isolated restart");
  evidence.problemReportDialogMode = "success";
  await click(win, "#exportProblemReportButton");
  await waitFor(win, "restarted problem report saved", "document.querySelector('#problemReportStatus').textContent.includes('player-problem-player_report_restart.json')");
  const report = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "player-problem-player_report_restart.json"), "utf8"));
  assert.equal(report.context.narration, "adaptive");
  assert.equal(report.context.theme, "dark");
  assert.ok(report.diagnostics.events.length > 0, "the restarted report must retain isolated diagnostic events");
  for (const event of report.diagnostics.events) {
    assert.match(event.buildId, /^(?:dev-[a-f0-9]{16}|build-\d{13}-[a-f0-9]{16})$/,
      "each persisted diagnostic must retain only a validated development or packaged build identity");
  }
  assert.ok(report.diagnostics.events.some(item => item.code === "SPEECH_RUNTIME_MISSING"), "actual missing-runtime status must persist after restart");
  assert.ok(report.diagnostics.events.some(item => item.code === "UPSTREAM_ACCESS_DENIED"), "synthetic 403 code must persist after restart");
  assert.ok(report.diagnostics.events.some(item => item.code === "RENDERER_SCRIPT_ERROR"), "fixed renderer code must persist after restart");
  assert.ok(report.diagnostics.events.some(item => item.code === "SPEECH_PERMISSION_DENIED"), "fixed speech renderer code must persist after restart");
  await screenshot(win, tempRoot, "player-report-restart", evidence);
  return { ...evidence, revision: 0, persistedCodes: report.diagnostics.events.map(item => item.code) };
}

module.exports = { handlesPhase, runCoordinator, runPhase, probe, observeResult };
