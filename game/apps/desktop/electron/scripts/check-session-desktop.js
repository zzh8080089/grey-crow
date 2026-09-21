#!/usr/bin/env node
"use strict";

// Real Main -> preload -> renderer -> Session child -> SQLite. Only the model
// provider/probe and the optional audio generator are synthetic local fixtures.
// The real bridge receives a shorter supported timeout for the finale fault test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const observability = require("./session-desktop-observability");
const chapterReadability = require("./session-desktop-chapter-readability");
const narrationDelivery = require("./session-desktop-narration-delivery");
const playerSettings = require("./session-desktop-player-settings");
const playerReport = require("./session-desktop-player-report");
const playerGuide = require("./session-desktop-player-guide");
const gameTour = require("./session-desktop-game-tour");
const notebookLayout = require("./check-notebook-layout");
const deleteRecovery = require("./session-desktop-delete-recovery");
const PHASE_TIMEOUT_MS = 120_000;
const UI_TIMEOUT_MS = 20_000;
const SYNTHETIC_KEY = "sk-synthetic-session-desktop-never-a-real-credential";
const ROOT_ENV = "GREY_CROW_SESSION_CHECK_ROOT";
const QUESTION = "先告诉我你的身份、唯一留下的东西，以及你想从哪里开始。";
const SUMMARY = "开局摘要：你叫林安，是社区志愿者；唯一留下的是母亲的一段记忆。上海爆发后第十天，你在陈姨家门外的楼道。请确认这些设定。";
const CONFIRMED = "你确认了这个身份与起点。陈姨在楼道那头向你点点头，冒险从这里开始。";
const BORROWED = "陈姨递给你两袋米。你接过米，答应明天把两袋米还给她。";
const BORROWED_TAIL = "陈姨松开手，楼道里的灯光落在米袋上。";
const BORROWED_COMPLETE = `${BORROWED}\n\n${BORROWED_TAIL}`;
const PLAYER_DESCRIPTION = "我叫林安，是社区志愿者，唯一留下母亲的一段记忆。起点在陈姨家门外的楼道。请整理开局摘要，先不要开始。";
const PLAYER_CONFIRMATION = "我明确确认这份开局摘要，开始吧。";
const PLAYER_BORROW = "我向陈姨借两袋米，答应明天把两袋米还给她。";
const CHAPTER_TITLE = "楼道里的两袋米";
const CHAPTER_SUMMARY = "林安在楼道中开始冒险，从陈姨手中接过两袋米，并答应第十一天归还。";
const FINALE_INPUTS = [
  "我想把故事在借米的这一刻告一段落。先提议一个结局，等我确认。",
  "先不要结束。我拒绝这个结局，故事继续。",
  "现在重新提出一个结局，仍保留明天归还的约定，等我确认。",
  "我明确确认这个结局，就在这里结束。",
];
const FINALE_TEXTS = [
  "你拎稳两袋米。故事可以停在楼道的这一刻，明天归还的约定仍然保留。要在这里结束吗？",
  "故事还没有结束。你仍站在陈姨门外，明天归还两袋米的约定依然有效。",
  "楼道的灯光落在米袋上。这一段求助已有回应，明天归还的约定可以留在故事之外。你确认在这里结束吗？",
  "你向陈姨道了声谢，拎稳两袋米。故事在楼道昏黄的灯下收束，明天的归还之约仍属于这片世界。",
];
const FINALE_CHAPTER_TITLE = "灯下的告别";
const FINALE_CHAPTER_SUMMARY = "林安先拒绝在楼道收束，随后确认新的结局；两袋米仍由他持有，次日归还的约定保留。";
const SPECIAL_INPUTS = [
  "这是当前虚构故事中林安的选择，与现实中的我无关。我让林安选择结束自己的生命，请先确认。",
  "我还拿不定主意，先不要推进这个虚构选择。",
  "我撤回刚才的虚构角色选择，让林安继续与陈姨交谈。",
  "仍只针对当前故事中的林安，与现实中的我无关。我重新选择让这个角色走向不可逆的自身终末，请先确认。",
  "仅限当前虚构角色林安，我明确确认这个不可逆选择。",
  "仅限林安在故事里的选择，我仍明确确认，不是一般的危险行动。",
  "这是对当前虚构角色的最后明确确认，我没有改变刚才的选择。",
];
const SPECIAL_TEXTS = [
  "林安的选择只属于这段虚构故事。对于眼前这个人物，它不可逆转；你仍要继续吗？",
  "你还没有决定。楼道里安静下来，这个选择暂时停在原处。",
  "林安放下刚才的决定，重新望向陈姨，故事继续。",
  "这个选择只发生在林安的虚构故事里。它将不可逆地结束他眼下的道路，你确定仍要继续吗？",
  "这不是一次普通的冒险或危险行动，而是林安自身的终末选择。你仍然确定吗？",
  "楼道的声音渐渐远去。这是最后一次确认：对于林安这个虚构人物，你仍坚持刚才的选择吗？",
];
const SPECIAL_ENDINGS = {
  grey: "林安的最后动作被赶来的陈姨打断，灯下的人影渐渐模糊。风从羽毛间穿过，楼道退到很远的下方；你听见灰鸦的翼声，望着有人赶来救援。这段故事在夜色中收束。",
  standard: "陈姨及时赶到，打断了林安的最后动作。救援的声音穿过楼道，他在灯下失去意识，之后的结果留在尚未到来的清晨。这段故事到这里结束。",
};
const SPECIAL_PLAYER_CONDITION = { standard: "失去意识", grey: "意识模糊" };
const CONTINUATION_OLD_MEMORY = "陈姨说，明天归还两袋米时，把米放到门边系着红绳的凳子上，她就知道是林安来过。";
const CONTINUATION_INPUTS = [
  "我回到陈姨那里，按她当时的叮嘱归还借来的两袋米，履行约定。",
  "归还已经完成，请提议在此结束这段续篇，等我确认。",
  "我明确确认结束这段续篇。",
];
const CONTINUATION_TEXTS = [
  "你把两袋米放回系着红绳的凳子上。陈姨接过米，认出了你留下的约定；这一次，归还已经完成。",
  "红绳仍系在凳脚上，借来的米已经归还。这段续篇可以停在此刻，你愿意就此结束吗？",
  "你向陈姨告别，轻轻带上楼道的门。曾经借来的两袋米已回到她手中，这段续篇在平静中结束。",
];
const CONTINUATION_CHAPTER = { title: "红绳凳子上的归还", summary: "林安记得陈姨关于红绳凳子的叮嘱，归还两袋米并履行约定，随后确认结束这一段续篇。" };
const SETTINGS_TEXT = {
  "zh-CN": { short: "我看看楼道。", custom: "我再看看门口。", tools: "我仔细看看陈姨现在的情况。", late: "我等一会儿再观察。",
    replies: ["楼道里安静下来，门缝透出一点灯光。", "你停在门口，陈姨仍在原处。", "陈姨站在门边，抬头与你对视。"], lateReply: "不应提交的迟到观察。" },
  "en-US": { short: "I look along the hallway.", custom: "I look at the doorway again.",
    replies: ["The hallway grows quiet. A little light spills through the doorway.", "You pause at the doorway. Chen remains where she was."] },
  "ja-JP": { short: "廊下を見渡す。", custom: "もう一度戸口を見る。",
    replies: ["廊下が静まり、戸口からかすかな明かりが漏れる。", "あなたは戸口で足を止める。陳さんは同じ場所にいる。"] },
};
const settingsPendingResponses = new Map();
const compactionDeferredResponses = new Map();

if (process.versions.electron) {
  runElectronPhase().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    require("electron").app.exit(1);
  });
} else {
  runCoordinator().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}

async function runCoordinator() {
  if (process.argv.length === 3 && process.argv[2] === "--suite=delete-recovery") {
    return deleteRecovery.runCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV });
  }
  if (process.argv.length === 3 && process.argv[2] === "--suite=player-settings") {
    return playerSettings.runCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV });
  }
  if (process.argv.length === 3 && process.argv[2] === "--suite=player-report") {
    return playerReport.runCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV });
  }
  if (process.argv.length === 3 && process.argv[2] === "--suite=player-guide") return playerGuide.runCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV });
  if (process.argv.length === 3 && process.argv[2] === "--suite=game-tour") return gameTour.runCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV });
  if (process.argv.length === 3 && ["--suite=notebook-layout", "--suite=notebook-layout-before", "--suite=notebook-layout-display", "--suite=notebook-layout-feedback"].includes(process.argv[2])) {
    return notebookLayout.runCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV,
      before: process.argv[2].endsWith("-before"), display: process.argv[2].endsWith("-display"), feedback: process.argv[2].endsWith("-feedback") });
  }
  if (process.argv.length === 3 && process.argv[2] === "--suite=chapter-readability") {
    return chapterReadability.runCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV });
  }
  if (process.argv.length === 3 && process.argv[2] === "--suite=narration-delivery") {
    return narrationDelivery.runCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV });
  }
  if (process.argv.length === 3 && process.argv[2] === "--suite=narration-delivery-missing") {
    return narrationDelivery.runMissingResourcesCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV });
  }
  if (process.argv.length === 3 && process.argv[2] === "--suite=notebook-legacy-layout") return runNotebookLegacyLayoutCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=narration-delivery-locales") {
    return narrationDelivery.runLocalesCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV });
  }
  if (process.argv.length === 3 && process.argv[2] === "--suite=save-policy") return runSavePolicyCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=execution") return runExecutionCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=action-errors") return runActionErrorsCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=observability") {
    return observability.runCoordinator({ runPhase, createSettingsFixture, rootEnv: ROOT_ENV });
  }
  if (process.argv.length === 3 && process.argv[2] === "--suite=default-entry") return runDefaultEntryCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=notebook-entry") return runDefaultEntryCoordinator({ notebookEntry: true });
  if (process.argv.length === 3 && process.argv[2] === "--suite=fragments") return runFragmentsCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=fragments-remaining") return runFragmentsCoordinator({ startAt: 1 });
  if (process.argv.length === 3 && process.argv[2] === "--suite=compaction-renderer") {
    process.stdout.write(JSON.stringify(await checkCompactionRendererBoundaries(), null, 2) + "\n"); return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--suite=compaction") return runCompactionCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=compaction-boundaries") return runCompactionCoordinator({ boundariesOnly: true });
  if (process.argv.length === 3 && process.argv[2] === "--suite=settings") return runSettingsCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=detail-pagination") return runDetailPaginationCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=special") return runSpecialCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=continuation") return runContinuationCoordinator();
  if (process.argv.length === 3 && process.argv[2] === "--suite=continuation-lost-receipt") return runContinuationCoordinator({ loseReceipt: true });
  if (process.argv.length > 2) throw new Error("This isolated check takes no external data or credential arguments.");
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) {
    fs.mkdirSync(path.join(tempRoot, name));
  }
  // No inherited API keys, NODE_OPTIONS, provider endpoints or real save roots.
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"),
    XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"), XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"),
    [ROOT_ENV]: tempRoot,
    GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
    GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
  process.stdout.write(`Isolated desktop artifacts: ${tempRoot}\n`);
  const electronBin = require("electron");
  const setup = await runPhase(electronBin, "setup", env);
  const restore = await runPhase(electronBin, "restore", env);
  assert.equal(setup.revision, 4);
  assert.equal(restore.revision, setup.revision);
  assert.equal(restore.adventureId, setup.adventureId);
  assert.equal(setup.modelCalls, 4);
  assert.equal(restore.modelCalls, 0);
  assert.equal(setup.chapterModelCalls, 1);
  assert.equal(restore.chapterModelCalls, 0);
  assert.deepEqual(restore.chapter, setup.chapter);
  assert.equal(setup.chapterSaveTtsRequests, 0);
  assert.equal(setup.repeatChapterSaveModelCalls, 0);
  assert.equal(setup.staleChapterRequests.length, 6);
  assert.ok(setup.staleChapterRequests.every((request) => request.stale));
  assert.equal(setup.automaticNarrationTtsRequests, 4, "each fresh committed turn must trigger automatic speech exactly once");
  assert.equal(setup.manualSegmentTtsRequests, 1);
  assert.equal(setup.ttsRequests, 5, "four automatic turns plus one explicitly requested single-paragraph replay");
  assert.equal(setup.repeatedEnvelopeTtsRequests, 0);
  assert.equal(setup.sameProcessRecoveryTtsRequests, 0);
  assert.equal(setup.settingsRecoveryTtsRequests, 0);
  assert.equal(setup.settingsRecoveryModelCalls, 0);
  assert.equal(setup.runtimeGenerationChanged, true);
  assert.equal(setup.leaveRuntimeGenerationChanged, true);
  assert.equal(restore.ttsRequests, 0);
  const finale = await runPhase(electronBin, "finale", env);
  const pending = readLocalFinale(tempRoot, setup.adventureId);
  assert.equal(pending.revision, 8);
  assert.equal(pending.archive.status, "pending");
  assert.equal(pending.chapter.status, "failed");
  assert.equal(pending.chapter.error_code, "CHAPTER_TIMEOUT");
  assert.equal(pending.chapterCount, 1);
  const finaleRestore = await runPhase(electronBin, "finale_restore", env);
  const closed = readLocalFinale(tempRoot, setup.adventureId);
  assert.equal(closed.revision, 8);
  assert.equal(closed.archive.status, "closed");
  assert.equal(closed.archive.confirmation_action_id, pending.archive.confirmation_action_id);
  assert.equal(closed.chapter.status, "committed");
  assert.equal(closed.chapterCount, 2);
  assert.equal(finale.modelCalls, 4);
  assert.equal(finale.chapterModelCalls, 1);
  assert.equal(finale.ttsRequests, 4);
  assert.equal(finale.finaleTimeoutObserved, true);
  assert.equal(finaleRestore.modelCalls, 0);
  assert.equal(finaleRestore.chapterModelCalls, 1);
  assert.equal(finaleRestore.ttsRequests, 0);
  assert.equal(finaleRestore.credentialCleared, true);
  const closedRestore = await runPhase(electronBin, "closed_restore", env);
  assert.equal(closedRestore.modelCalls, 0);
  assert.equal(closedRestore.chapterModelCalls, 0);
  assert.equal(closedRestore.ttsRequests, 0);
  assert.equal(closedRestore.keyVerified, false);
  assert.deepEqual(readLocalFinale(tempRoot, setup.adventureId), closed, "read-only archive opening cannot rewrite the final chapter or seal");
  const longFixture = await createLongArchiveFixture(tempRoot);
  const archiveExport = await runPhase(electronBin, "archive_export", env);
  assert.equal(archiveExport.modelCalls, 0);
  assert.equal(archiveExport.chapterModelCalls, 0);
  assert.equal(archiveExport.ttsRequests, 0);
  assert.equal(archiveExport.keyVerified, false);
  assert.deepEqual(readLocalFinale(tempRoot, setup.adventureId), closed);
  assert.equal(databaseDigest(longFixture.databasePath), longFixture.databaseDigest, "pagination/export cannot rewrite the source archive");
  const result = { ok: true, evidence: "actual Electron Main/preload/renderer, real Session child and SQLite; synthetic model and silent WAV audio",
    limitations: ["No real model, spoken voice, narrative quality or release acceptance was tested."],
    tempRoot, setup, restore, finale, finaleRestore, closedRestore, archiveExport, pendingArchive: pending, closedArchive: closed };
  fs.writeFileSync(path.join(tempRoot, "results", "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runNotebookLegacyLayoutCoordinator() {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) if (process.env[name] !== undefined) env[name] = process.env[name];
  Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"), XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot,
    GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"), GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
  const fixture = await createSettingsFixture(tempRoot, "zh-CN");
  const { readContentSnapshot } = require("../../../../engine/content-v2/snapshot-reader");
  const { createTurnStore } = require("../../../../engine/session/turn-store");
  const snapshot = await readContentSnapshot({ adventuresRoot: path.join(tempRoot, "data", "saves"), adventureId: fixture.adventureId });
  const store = createTurnStore({ ...fixture, contentVersion: snapshot.lock.overallHash });
  try {
    const action = store.beginAction({ actionId: "legacy-layout-observe", baseRevision: 0, input: "我看看楼道。", locale: fixture.locale, contentVersion: snapshot.lock.overallHash });
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle("legacy-layout-scene", "楼道里很安静。陈姨站在门边，朝你点了点头。") });
  } finally { store.close(); }
  const { DEFAULT_SETTINGS } = require("../settings-store");
  const legacySettings = structuredClone(DEFAULT_SETTINGS);
  legacySettings.ui.gameUiLayout = "classic";
  delete legacySettings.audio.tts.voiceId;
  fs.writeFileSync(path.join(tempRoot, "data", "settings.json"), JSON.stringify(legacySettings));
  const first = await runPhase(require("electron"), "notebook_legacy_layout", env);
  const persisted = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "settings.json"), "utf8"));
  assert.equal(persisted.ui.gameUiLayout, "story-notebook-v1");
  assert.equal(persisted.audio.tts.voiceId, "zm_010", "old settings with no voice persist the canonical default");
  const restart = await runPhase(require("electron"), "notebook_legacy_layout_restart", env);
  assert.equal(first.modelCalls, 0); assert.equal(first.ttsRequests, 0); assert.equal(restart.modelCalls, 0); assert.equal(restart.ttsRequests, 0);
  const result = { ok: true, suite: "notebook-legacy-layout", tempRoot, fixture, first, restart, persisted,
    evidence: "Isolated legacy settings.json loaded through Main/preload/renderer, then persisted as the sole notebook layout; committed synthetic history restored through the real Session.", limitations: ["Synthetic connection probe only; no story model, TTS, gameplay quality or release acceptance."] };
  fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2)); process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function runNotebookLegacyLayoutPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "settings-fixture.json"), "utf8"));
  assert.equal((await readStatus(win)).settings.ui.gameUiLayout, "story-notebook-v1");
  assert.equal(await evaluate(win, "document.querySelector('#gameView').dataset.uiLayout"), "story-notebook-v1");
  assert.equal(await evaluate(win, "document.querySelector('#uiArtStyleToggleButton')"), null);
  const restarting = evidence.phase === "notebook_legacy_layout_restart";
  const voice = await evaluate(win, "({current:state.ttsVoiceId,persisted:JSON.parse(state.persistedSettingsSnapshot).audio.tts.voiceId,dirty:state.settingsDirty,saving:state.settingsSaving})");
  assert.deepEqual(voice, { current: "zm_010", persisted: "zm_010", dirty: false, saving: false });
  evidence.legacyVoice = voice;
  if (!(await readStatus(win)).keyVerified) {
    await connectSyntheticModel(win);
    await click(win, "#closeSettingsButton");
  }
  await click(win, "#continueGameButton");
  await waitFor(win, "legacy setting opens notebook game", `state.activeSaveId===${JSON.stringify(fixture.adventureId)} && !ui.gameView.classList.contains('hidden') && document.querySelector('#gameView').dataset.uiLayout==='story-notebook-v1'`);
  await waitFor(win, "notebook opening reaches readable story", "notebookBookController?.getState().phase==='reading' && !ui.gameView.inert && document.querySelector('#narrationPanel').innerText.includes('楼道里很安静。陈姨站在门边，朝你点了点头。') && !ui.turnInput.disabled");
  if (restarting) {
    assert.equal(await evaluate(win, "document.querySelector('#gameView').dataset.notebookTheme"), "dark");
    await screenshot(win, tempRoot, "notebook-legacy-layout-restart", evidence);
    return { ...evidence, adventureId: fixture.adventureId, revision: 1, restarted: true };
  }
  await change(win, "#turnInput", "保留的输入草稿", "input");
  await screenshot(win, tempRoot, "notebook-legacy-layout-light", evidence);
  await click(win, "#storyNotebookStateButton");
  await waitFor(win, "notebook drawer opens", "document.querySelector('#storyNotebookDrawer').classList.contains('is-open')");
  await closeNotebookDrawer(win);
  await click(win, "#storyNotebookCharactersButton");
  await waitFor(win, "characters remain available in notebook", "state.notebookDrawerPanel==='characters' && !state.skillPanelRefreshBusy && document.querySelectorAll('#storyNotebookDrawerBody .story-notebook-panel-record').length>0");
  assert.equal(await evaluate(win, "document.querySelector('#classicCharacterDialog')"), null);
  await screenshot(win, tempRoot, "notebook-legacy-layout-characters", evidence);
  await closeNotebookDrawer(win);
  await click(win, "#gameSettingsButton"); await click(win, "#settingsTabDisplay"); await change(win, "#storyNotebookThemeSelect", "dark");
  await waitFor(win, "dark notebook persisted", "!state.settingsSaving && !state.settingsDirty && document.querySelector('#gameView').dataset.notebookTheme==='dark'");
  await click(win, "#closeSettingsButton");
  assert.equal(await evaluate(win, "ui.turnInput.value"), "保留的输入草稿");
  await screenshot(win, tempRoot, "notebook-legacy-layout-dark", evidence);
  return { ...evidence, adventureId: fixture.adventureId, revision: 1, normalized: true };
}

async function runActionErrorsCoordinator() {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
    XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot,
    GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
    GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
  const fixture = { ...await createSettingsFixture(tempRoot, "zh-CN"),
    input: "我等陈姨说明白，再碰门边的东西。", reply: "陈姨接着说明，你留在原处，还没有碰门边的东西。" };
  fs.writeFileSync(path.join(tempRoot, "results", "action-errors-fixture.json"), JSON.stringify(fixture, null, 2));
  process.stdout.write(`Action error artifacts: ${tempRoot}\n`);
  const run = await runPhase(require("electron"), "action_errors", env);
  const stored = readExecutionDatabase(fixture);
  assert.equal(stored.revision, 4); assert.equal(stored.actions.length, 5); assert.equal(stored.turns.length, 4);
  assert.equal(stored.actions[0].action_id, run.actionId); assert.equal(stored.turns[0].narration[0].text, fixture.reply);
  assert.equal(run.modelCalls, 12); assert.equal(run.chapterModelCalls, 0); assert.equal(run.ttsRequests, 0);
  const result = { ok: true, suite: "action-errors", tempRoot, run, stored,
    realModelCalls: 0, seedModelCalls: 0, desktopSyntheticModelCalls: 12,
    evidence: "Actual Electron Main/preload/session child: classified timeout/auth/rate errors, explicit recovery, cancellation, two 35s waits and three shared corrections (JSON, tool arguments, validated candidate) with production action time budget. Normal tool continuation does not consume a correction.",
    limitations: ["Providers are controlled local fixtures, including the two real 35s waits. No real network/model, narrative, speech or release acceptance."] };
  fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function generateActionErrorFixture(request, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "action-errors-fixture.json"), "utf8"));
  evidence.modelCalls += 1;
  assert(evidence.modelCalls <= 12, "failure must not cause an unbounded invocation");
  const call = evidence.modelCalls;
  if (call <= 2) assert(request.messages.some(message => message.content === `Current player action:\n${fixture.input}`));
  if (evidence.modelCalls === 1) throw Object.assign(new Error("SYNTHETIC_PRIVATE_API_TIMEOUT"), { code: "API_TIMEOUT" });
  if (call === 3) {
    await new Promise(resolve => request.signal.addEventListener("abort", () => {
      evidence.cancelReachedProvider = true;
      setTimeout(resolve, 75); // Deliberately return late after cancellation.
    }, { once: true }));
    evidence.lateCancellationReply = true;
  }
  if (call === 4 || call === 5) {
    await new Promise(resolve => setTimeout(resolve, 35_000));
    if (call === 4) return { text: "{invalid story JSON", finishReason: "stop" };
    assert(request.messages.some(message => message.content?.includes("{invalid story JSON")), "correction sees the prior invalid output");
    assert(request.messages.at(-1).content.includes('"code":"JSON_SYNTAX"'));
    return { text: "", toolCalls: [{ id: "invalid-order", name: "recall_memory",
      arguments: JSON.stringify({ query: "陈姨门口", order: "oldest" }) }], finishReason: "tool_calls" };
  }
  if (call === 6) {
    const feedback = JSON.parse(request.messages.filter(message => message.role === "tool").at(-1).content);
    assert.equal(feedback.error.code, "TOOL_ARGUMENTS_INVALID");
    assert(feedback.error.feedback.some(issue => issue.path === "arguments.order" && issue.code === "ENUM_VALUE"));
    evidence.toolCorrectionFeedback = feedback;
    return { text: "", toolCalls: [{ id: "correct-order", name: "recall_memory",
      arguments: JSON.stringify({ query: "陈姨门口", order: "earliest" }) }], finishReason: "tool_calls" };
  }
  if (call === 7) {
    const result = JSON.parse(request.messages.filter(message => message.role === "tool").at(-1).content);
    assert.equal(result.error, undefined, "corrected tool arguments succeed before generating the candidate");
    return { text: JSON.stringify({ narration: [{ id: "empty-prose", text: "" }], events: [], experiences: [] }), finishReason: "stop" };
  }
  if (call === 8) {
    assert.match(request.messages.at(-1).content, /"path":"bundle.narration\[0\].text"/);
    assert.match(request.messages.at(-1).content, /"code":"TEXT_CONSTRAINT"/);
    evidence.candidateCorrectionFeedback = request.messages.at(-1).content;
  }
  if (call === 9 || call === 11) throw Object.assign(new Error("SYNTHETIC_PRIVATE_FAILURE"), {
    code: call === 9 ? "UPSTREAM_AUTH_ERROR" : "UPSTREAM_RATE_LIMIT", retryable: call === 11,
  });
  return { text: JSON.stringify({ narration: [{ id: "patient-wait", text: fixture.reply }], events: [], experiences: [] }),
    toolCalls: [], finishReason: "stop", usage: { input_tokens: 120, output_tokens: 40 } };
}

async function runActionErrorsPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "action-errors-fixture.json"), "utf8"));
  await connectSyntheticModel(win);
  await click(win, "#settingsTabAudio"); await change(win, "#ttsReadingModeSelect", "manual");
  await waitFor(win, "silent synthetic action test autosaved", "!state.settingsSaving && !state.settingsDirty && !state.settingsSaveTask && !state.settingsAutosaveTimer");
  await click(win, "#closeSettingsButton"); await click(win, "#continueGameButton");
  await waitSettingsRevision(win, fixture.adventureId, 0);
  await submit(win, fixture.input);
  await waitUntil("actual failed action receipt", () => evidence.actionErrorReceipts?.length === 1);
  await waitSettingsRevision(win, fixture.adventureId, 0);
  const failed = evidence.actionErrorReceipts[0];
  assert.equal(failed.actionResult.status, "failed"); assert.equal(failed.actionResult.error.code, "API_TIMEOUT");
  assert.equal(failed.actionResult.error.retryable, true);
  const failureUi = await evaluate(win, `(() => {const node=Array.from(document.querySelectorAll('.narration-line.warning')).at(-1);
    node.scrollIntoView({block:'nearest',behavior:'instant'});const rect=node.getBoundingClientRect(),bounds=document.querySelector('#narrationPanel').getBoundingClientRect();
    return {text:node.innerText,expected:formatPlayerTurnFailure(${JSON.stringify(failed)},{canRetry:true}),
      visible:node.checkVisibility()&&rect.height>0&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom,
      input:document.querySelector('#turnInput').value,pendingId:state.pendingSessionAction?.actionId,
      enabled:!document.querySelector('#sendTurnButton').disabled};})()`);
  const failedStory = readExecutionDatabase(fixture);
  evidence.failedOutcome = { receipt: failed, ui: failureUi, stored: failedStory };
  fs.writeFileSync(path.join(tempRoot, "results", "action-errors-first-failure.json"), JSON.stringify(evidence.failedOutcome, null, 2));
  assert.equal(failureUi.text, failureUi.expected); assert.equal(failureUi.visible, true); assert.equal(failureUi.enabled, true);
  assert.doesNotMatch(failureUi.text, /TURN_GENERATION_FAILED|API_TIMEOUT|SYNTHETIC_PRIVATE|\[[A-Z_]+\]/);
  assert.equal(failureUi.input, fixture.input); assert.equal(failureUi.pendingId, failed.actionResult.actionId);
  assert.equal(await evaluate(win, "!ui.turnFailureDetailsButton.hidden && ui.turnStatus.textContent===t('game.turn.failure.notice')"), true);
  assert.equal(failedStory.revision, 0); assert.equal(failedStory.turns.length, 0); assert.equal(evidence.modelCalls, 1);
  await screenshot(win, tempRoot, "action-errors-failed-readable", evidence);
  // The player's existing button reuses the unchanged draft and action ID.
  await click(win, "#sendTurnButton");
  await waitSettingsRevision(win, fixture.adventureId, 1, fixture.reply);
  await waitUntil("explicit retry receipt", () => evidence.actionErrorReceipts.length === 2);
  const committed = evidence.actionErrorReceipts[1];
  assert.equal(committed.actionResult.status, "committed");
  assert.equal(committed.actionResult.actionId, failed.actionResult.actionId);
  assert.notEqual(committed.actionResult.attemptId, failed.actionResult.attemptId);
  assert.equal(evidence.actionErrorRequests[0].retry, false); assert.equal(evidence.actionErrorRequests[1].retry, true);
  assert.equal(evidence.actionErrorRequests[0].actionId, evidence.actionErrorRequests[1].actionId);
  const settled = await evaluate(win, `({input:document.querySelector('#turnInput').value,pending:state.pendingSessionAction,
    playerLines:document.querySelectorAll('[data-action-id="${committed.actionResult.actionId}"]').length,
    warning:Array.from(document.querySelectorAll('.narration-line.warning')).at(-1).innerText})`);
  assert.equal(settled.input, ""); assert.equal(settled.pending, null); assert.equal(settled.playerLines, 1);
  assert.equal(await evaluate(win, "ui.turnFailureDetailsButton.hidden && state.turnFailureNotice===null"), true);
  assert.equal(settled.warning, failureUi.text); assert.equal(evidence.modelCalls, 2); assert.equal(evidence.ttsRequests, 0);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(fixture.databasePath, { readOnly: true });
  try {
    evidence.retainedAttempts = db.prepare("SELECT action_id,attempt_id,status,error_code FROM execution_attempts ORDER BY rowid").all();
    assert.equal(evidence.retainedAttempts.length, 2);
    assert.equal(evidence.retainedAttempts[0].error_code, "API_TIMEOUT", "safe cause remains available to diagnostics");
    assert.equal(evidence.retainedAttempts[1].status, "committed");
  } finally { db.close(); }
  await screenshot(win, tempRoot, "action-errors-explicit-retry-committed", evidence);
  await submit(win, "我先等一等，听陈姨接下来怎么说。");
  await waitUntil("cancellable model call", () => evidence.modelCalls === 3);
  const cancelling = await evaluate(win, `(() => { const a=state.pendingSessionAction;
    return {actionId:a.actionId,baseRevision:a.baseRevision,adventureId:a.adventureId,sessionId:a.sessionId,invocationId:a.invocationId}; })()`);
  const wrong = await evaluate(win, `window.greyCrow.cancelTurn({...${JSON.stringify(cancelling)},actionId:'wrong-action'})`);
  assert.equal(wrong.ok, false); assert.equal(evidence.cancelReachedProvider, undefined);
  const staleInvocation = await evaluate(win, `window.greyCrow.cancelTurn({...${JSON.stringify(cancelling)},invocationId:'old-invocation'})`);
  assert.equal(staleInvocation.ok, false); assert.equal(evidence.cancelReachedProvider, undefined);
  await click(win, "#cancelTurnButton");
  await waitFor(win, "cancelled action settles", "!state.busy && !state.pendingSessionAction");
  await waitUntil("discarded late reply", () => evidence.lateCancellationReply === true);
  assert.equal(readExecutionDatabase(fixture).revision, 1);
  const cancelledUi = await evaluate(win, `({input:ui.turnInput.value,text:Array.from(document.querySelectorAll('.narration-line.warning')).at(-1).innerText,
    expected:t('game.turn.failure.cancelled'),cancelHidden:ui.cancelTurnButton.hidden})`);
  assert.equal(cancelledUi.input, "我先等一等，听陈姨接下来怎么说。");
  assert.equal(cancelledUi.text, cancelledUi.expected); assert.equal(cancelledUi.cancelHidden, true);
  await screenshot(win, tempRoot, "action-errors-cancelled-input-kept", evidence);
  const started = Date.now();
  await click(win, "#sendTurnButton");
  await waitUntil("correction after first 35s response", () => evidence.modelCalls === 5, 50_000);
  const waiting = await evaluate(win, `({busy:state.busy,cancelVisible:!ui.cancelTurnButton.hidden,
    status:document.querySelector('#turnStatus')?.innerText,expected:t('game.turn.longWait')})`);
  assert.equal(waiting.busy, true); assert.equal(waiting.cancelVisible, true);
  assert(waiting.status.includes(waiting.expected));
  await screenshot(win, tempRoot, "action-errors-correcting-after-long-wait", evidence);
  // Only the display clock and locale are controlled here. The actual action
  // retains its production deadline and two real 35-second provider waits.
  const displayBefore = await evaluate(win, `({effectiveLocale:state.effectiveLocale,busyStartedAt:state.busyStartedAt,gameUiLayout:state.gameUiLayout,
    storyRows:document.querySelector('#narrationPanel').textContent})`);
  evidence.waitingLayouts = [];
  for (const gameUiLayout of ["story-notebook-v1"]) {
    for (const [locale, width, height] of [["zh-CN",1260,820],["en-US",1280,720],["ja-JP",1280,720]]) {
      win.setContentSize(width, height, false);
      await waitFor(win, "waiting layout viewport", `innerWidth === ${width} && innerHeight === ${height}`);
      await evaluate(win, `state.effectiveLocale=${JSON.stringify(locale)};syncUiLocale();setGameUiLayout(${JSON.stringify(gameUiLayout)});state.busyStartedAt=Date.now()-90_000;renderTurnStatus()`);
      await screenshot(win, tempRoot, `action-errors-delayed-${gameUiLayout}-${locale}-${width}`, evidence);
      const layout = await evaluate(win, `(() => {
        const node=ui.turnStatus, host=ui.storyNotebookHostStatus, box=host.getBoundingClientRect();
        const range=document.createRange();range.selectNodeContents(node);
        const glyphs=Array.from(range.getClientRects());
        return {locale:${JSON.stringify(locale)},gameUiLayout:state.gameUiLayout,width:innerWidth,height:innerHeight,text:node.innerText,
          expected:t('game.turn.delayed'),visible:node.checkVisibility(),
          fits:glyphs.every(rect=>rect.left>=box.left-1&&rect.right<=box.right+1&&rect.top>=box.top-1&&rect.bottom<=box.bottom+1),
          storyRows:document.querySelector('#narrationPanel').textContent};})()`);
      assert.equal(layout.visible, true); assert.equal(layout.fits, true, JSON.stringify(layout));
      assert(layout.text.includes(layout.expected));
      assert.equal(layout.storyRows, displayBefore.storyRows, "processing and correction details never enter the story");
      delete layout.storyRows;
      evidence.waitingLayouts.push({ ...layout, controlledElapsedSeconds: 90 });
    }
  }
  await evaluate(win, `state.effectiveLocale=${JSON.stringify(displayBefore.effectiveLocale)};syncUiLocale();setGameUiLayout(${JSON.stringify(displayBefore.gameUiLayout)});state.busyStartedAt=${displayBefore.busyStartedAt};renderTurnStatus()`);
  await resize(win);
  await waitFor(win, "long correction commits", "!state.busy && state.activeSave?.revision === 2", 50_000);
  evidence.correctionElapsedMs = Date.now() - started;
  assert(evidence.correctionElapsedMs >= 70_000);
  assert.equal(readExecutionDatabase(fixture).revision, 2);
  assert.equal(evidence.modelCalls, 8, "three corrections and a normal tool continuation commit once");
  evidence.classifiedErrors = [];
  for (const [revision, expectedCalls, code, word] of [[2,9,"UPSTREAM_AUTH_ERROR","密钥"],[3,11,"UPSTREAM_RATE_LIMIT","频率"]]) {
    const input = `我留在门口，等陈姨把第${revision}件事说明白。`;
    await submit(win, input);
    await waitFor(win, "classified provider failure", "!state.busy && !!state.pendingSessionAction");
    const receipt = evidence.actionErrorReceipts.at(-1);
    assert.equal(receipt.actionResult.error.code, code);
    assert.equal(evidence.modelCalls, expectedCalls, "upstream error is not blindly retried");
    const uiState = await evaluate(win, `({text:Array.from(document.querySelectorAll('.narration-line.warning')).at(-1).innerText,
      input:ui.turnInput.value,canSend:!ui.sendTurnButton.disabled})`);
    assert(uiState.text.includes(word)); assert.equal(uiState.input, input); assert.equal(uiState.canSend, true);
    assert.doesNotMatch(uiState.text, /UPSTREAM_|SYNTHETIC_PRIVATE/);
    assert.equal(readExecutionDatabase(fixture).revision, revision);
    evidence.classifiedErrors.push({code,...uiState});
    await screenshot(win, tempRoot, `action-errors-${code.toLowerCase()}`, evidence);
    await click(win, "#sendTurnButton"); // Fixture now represents the repaired service.
    await waitSettingsRevision(win, fixture.adventureId, revision + 1, fixture.reply);
    assert.equal(evidence.actionErrorReceipts.at(-1).actionResult.actionId, receipt.actionResult.actionId);
  }
  return { ...evidence, actionId: committed.actionResult.actionId, adventureId: fixture.adventureId, revision: 4 };
}

async function runExecutionCoordinator() {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
    XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot,
    GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
    GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
  process.stdout.write(`Execution diagnostics artifacts: ${tempRoot}\n`);
  const fixture = await createExecutionFixture(tempRoot);
  const runs = [];
  for (const phase of ["execution_read", "execution_restart"]) {
    const before = databaseDigest(fixture.databasePath);
    assert.equal(before, fixture.databaseHash);
    const run = await runPhase(require("electron"), phase, env);
    assert.equal(databaseDigest(fixture.databasePath), before, "desktop diagnostics and restart must leave the entire seeded database unchanged");
    assert.deepEqual(readExecutionDatabase(fixture), fixture.savedStory);
    assert.equal(run.modelCalls, 0); assert.equal(run.chapterModelCalls, 0); assert.equal(run.ttsRequests, 0);
    runs.push({ ...run, databaseHashAfterExit: before });
  }
  const result = { ok: true, suite: "execution", tempRoot, seedSyntheticModelCalls: fixture.seedSyntheticModelCalls,
    desktopModelCalls: 0, realModelCalls: 0, runs,
    evidence: "Synthetic Provider responses pass through the real adventure session during seed only. Actual Electron Main/preload/session child, debug dialog and JSON download read both persisted attempts.",
    limitations: ["No natural gameplay, real Provider, audio quality or release acceptance.", "Chinese desktop in two sizes; other locales use the separate locale-key checks."] };
  fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function createExecutionFixture(tempRoot) {
  const fixture = await createSettingsFixture(tempRoot, "zh-CN");
  const gameRoot = path.resolve(__dirname, "../../../..");
  const { createAdventureSession } = require(path.join(gameRoot, "engine/session/adventure-session"));
  const { readContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-reader"));
  const { createHash } = require("node:crypto");
  const content = await readContentSnapshot({ adventuresRoot: path.join(tempRoot, "data", "saves"), adventureId: fixture.adventureId });
  const input = "我看一眼楼道里的灯，暂不移动。EXEC_PRIVATE_INPUT";
  const reply = "灯仍亮着，你留在原处。EXEC_PRIVATE_STORY";
  const invalid = "EXEC_PRIVATE_INVALID_RESPONSE";
  const measuredUsage = { input_tokens: 120, output_tokens: 40, total_tokens: 160,
    prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 40, reasoning_tokens: 10 };
  const requests = [];
  const session = createAdventureSession({ ...fixture, contentVersion: content.lock.overallHash,
    hostText: "仅用于本地合成诊断测试，保持事实与行动边界。", worldText: "上海爆发后第十天的楼道。",
    maxModelCalls: 1, maxAttempts: 1, maxOutputTokens: 2048,
    provider: { async generate({ signal, ...request }) {
      assert(signal instanceof AbortSignal);
      const serialized = JSON.stringify(request);
      requests.push({ sha256: createHash("sha256").update(serialized).digest("hex"),
        characters: serialized.length, bytes: Buffer.byteLength(serialized), maxOutputTokens: request.maxOutputTokens });
      assert(requests.length <= 2, "only one failed invocation and its explicit retry are seeded");
      if (requests.length === 1) return { text: invalid, toolCalls: [], finishReason: "stop" };
      return { text: JSON.stringify({ narration: [{ id: "execution-observation", text: reply }], events: [], experiences: [] }),
        toolCalls: [], finishReason: "stop", usage: measuredUsage };
    } } });
  try {
    const request = { actionId: "execution-retry", baseRevision: 0, input, locale: fixture.locale, contentVersion: content.lock.overallHash };
    const failed = await session.runAction(request);
    assert.equal(failed.status, "failed"); assert.equal(failed.error.code, "TURN_OUTPUT_INVALID");
    assert.equal(failed.error.retryable, true); assert.equal(session.readView().revision, 0);
    // Keep the failed outcome before any retry, even if a later assertion fails.
    fs.writeFileSync(path.join(tempRoot, "results", "execution-seed-failed.json"), JSON.stringify({ failed, diagnostics: session.readDiagnostics() }, null, 2));
    const committed = await session.runAction(request, { retry: true });
    assert.equal(committed.status, "committed"); assert.equal(committed.view.revision, 1);
    assert.notEqual(committed.attemptId, failed.attemptId); assert.equal(requests.length, 2);
    const diagnostics = session.readDiagnostics({ limit: 100 });
    assert.equal(diagnostics.counts.actions, 1); assert.equal(diagnostics.counts.retainedAttempts, 1);
    assert.equal(diagnostics.attemptHistoryComplete, false); assert.equal(diagnostics.execution.records.length, 2);
    assert.equal(Buffer.byteLength(JSON.stringify(diagnostics)) <= 512 * 1024, true);
    for (const [index, attempt] of [failed, committed].entries()) {
      const record = diagnostics.execution.records.find(record => record.attemptId === attempt.attemptId);
      assert.equal(record.status, index ? "committed" : "failed");
      const invoked = record.steps.find(step => step.kind === "model" && step.outcome === "invoked");
      const returned = record.steps.find(step => step.kind === "model" && step.outcome === "returned");
      for (const key of ["sha256", "characters", "bytes", "maxOutputTokens"]) assert.equal(invoked.request[key], requests[index][key]);
      assert.deepEqual(returned.usage, index ? measuredUsage : null);
      assert.equal(returned.usageComplete, Boolean(index));
    }
    Object.assign(fixture, { input, reply, invalid, measuredUsage, requests, diagnostics,
      actionId: request.actionId, failedAttemptId: failed.attemptId, committedAttemptId: committed.attemptId, seedSyntheticModelCalls: requests.length });
  } finally { await session.close(); }
  fixture.savedStory = readExecutionDatabase(fixture);
  assert.equal(fixture.savedStory.revision, 1); assert.equal(fixture.savedStory.actions.length, 1); assert.equal(fixture.savedStory.turns.length, 1);
  assert.equal(fixture.savedStory.actions[0].request.input, input);
  assert.equal(fixture.savedStory.turns[0].narration[0].text, reply);
  fixture.databaseHash = databaseDigest(fixture.databasePath);
  fs.writeFileSync(path.join(tempRoot, "results", "execution-fixture.json"), JSON.stringify(fixture, null, 2));
  return fixture;
}

function readExecutionDatabase(fixture) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(fixture.databasePath, { readOnly: true });
  try {
    return { revision: db.prepare("SELECT revision FROM session WHERE singleton=1").get().revision,
      actions: db.prepare("SELECT action_id,attempt_id,status,revision,request_json FROM actions ORDER BY rowid").all()
        .map(({ request_json, ...row }) => ({ ...row, request: JSON.parse(request_json) })),
      turns: db.prepare("SELECT revision,action_id,narration_json FROM turns WHERE action_id IS NOT NULL ORDER BY revision").all()
        .map(({ narration_json, ...row }) => ({ ...row, narration: JSON.parse(narration_json) })) };
  } finally { db.close(); }
}

async function runExecutionPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "execution-fixture.json"), "utf8"));
  assert.equal(databaseDigest(fixture.databasePath), fixture.databaseHash);
  if (!(await readStatus(win)).keyVerified) { await connectSyntheticModel(win); await click(win, "#closeSettingsButton"); }
  await click(win, "#continueGameButton");
  await waitSettingsRevision(win, fixture.adventureId, 1, fixture.reply);
  await click(win, "#gameSettingsButton"); await click(win, "#settingsTabDeveloper");
  if (!await evaluate(win, "state.debugPanelEnabled")) {
    await change(win, "#debugPanelEnabledSelect", "true"); await click(win, "#saveSettingsButton");
    await waitFor(win, "execution diagnostics enabled", "!state.settingsSaving && !state.settingsDirty && state.debugPanelEnabled");
  }
  await click(win, "#closeSettingsButton");
  evidence.executionCases = [];
  const readPayload = async () => {
    await waitFor(win, "both persisted attempts in diagnostics", "document.querySelector('#debugDialog').open && !document.querySelector('#debugRefreshButton').disabled && state.debugTraceExecution?.records.length===2");
    const payload = await evaluate(win, "({execution:structuredClone(state.debugTraceExecution),entries:structuredClone(state.debugTraceEntries),summary:structuredClone(state.debugTraceSummary),export:structuredClone(state.debugTraceExport)})");
    assert.deepEqual(payload.execution, fixture.diagnostics.execution, "Main and Renderer preserve the exact bounded metadata, including fingerprints and unknown usage");
    assert.equal(payload.entries.length, 1); assert.equal(payload.entries[0].session_action.attemptId, fixture.committedAttemptId);
    assert.equal(payload.summary.attempt_history_complete, false); assert.equal(payload.summary.model_usage, null);
    assert.deepEqual(JSON.parse(payload.export.content).execution, payload.execution);
    for (const privateText of [fixture.input, fixture.reply, fixture.invalid, SYNTHETIC_KEY, tempRoot, fixture.databasePath]) {
      assert.equal(JSON.stringify(payload).includes(privateText), false, "diagnostics must not include private source or paths");
    }
    assert.doesNotMatch(payload.export.content, /"(?:input|narration|request_json|state_json|owner_pid|owner_id|messages|arguments)"\s*:/);
    assert.equal((await readStatus(win)).activeSave.revision, 1);
    return payload;
  };
  for (const [width, height] of [[1280, 720], [1260, 820]]) {
    win.setAspectRatio(0); win.setContentSize(width, height, false); win.center();
    await waitFor(win, "execution diagnostic viewport", `innerWidth===${width} && innerHeight===${height}`);
    await click(win, "#gameSettingsButton"); await click(win, "#settingsTabDeveloper"); await click(win, "#debugPanelButton");
    const payload = await readPayload();
    const defaults = await evaluate(win, `Array.from(document.querySelectorAll('.debug-execution-card')).map(card=>({id:card.dataset.executionAttemptId,
      open:card.open,hiddenText:!card.querySelector('pre').checkVisibility()}))`);
    assert.equal(defaults.length, 2); assert(defaults.every(card => !card.open && card.hiddenText));
    await screenshot(win, tempRoot, `${evidence.phase}-${width}-collapsed`, evidence);
    const visibleAttempts = [];
    for (const record of payload.execution.records) {
      const selector = `.debug-execution-card[data-execution-attempt-id="${record.attemptId}"]`;
      await click(win, `${selector} > summary`);
      for (const field of ["fingerprint", "usage"]) {
        const visible = await evaluate(win, `(() => { const card=document.querySelector(${JSON.stringify(selector)}),pre=card.querySelector('pre');
          const node=pre.firstChild,start=pre.textContent.indexOf(${JSON.stringify(field === "fingerprint" ? '"sha256"' : '"usage"')}),range=document.createRange();
          range.setStart(node,start);range.setEnd(node,${field === "fingerprint" ? "start+75" : "pre.textContent.indexOf('\"finishReason\"',start)"});
          pre.scrollIntoView({block:'start',behavior:'instant'});
          const list=document.querySelector('#debugTraceList'),offset=range.getBoundingClientRect().top-list.getBoundingClientRect().top;
          list.scrollTop+=offset/(list.getBoundingClientRect().height/list.offsetHeight)-24;
          const rect=range.getBoundingClientRect(),bounds=list.getBoundingClientRect(),style=getComputedStyle(pre);
          return {open:card.open,text:pre.textContent,visible:rect.height>0&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom,
            whiteSpace:style.whiteSpace,fontWeight:style.fontWeight,overflow:pre.scrollWidth>pre.clientWidth+1}; })()`);
        assert.equal(visible.open, true); assert.equal(visible.visible, true, `${field} must actually be within the clipped viewport`);
        assert.equal(visible.whiteSpace, "pre-wrap"); assert.equal(visible.fontWeight, "400"); assert.equal(visible.overflow, false);
        assert.deepEqual(JSON.parse(visible.text), record);
        await screenshot(win, tempRoot, `${evidence.phase}-${width}-${record.status}-${field}`, evidence);
      }
      visibleAttempts.push({ attemptId: record.attemptId, fingerprintVisible: true, usageVisible: true });
      await click(win, `${selector} > summary`);
    }
    await click(win, "#debugRefreshButton"); await readPayload();
    const filename = path.join(tempRoot, "results", `${evidence.phase}-${width}-download.json`);
    let downloaded = false, downloadError;
    win.webContents.session.once("will-download", (_event, item) => {
      item.setSavePath(filename); item.once("done", (_done, state) => { downloadError = state === "completed" ? null : state; downloaded = true; });
    });
    const refreshed = await readPayload();
    await click(win, "#debugExportButton"); await waitUntil("execution metadata JSON download", () => downloaded);
    assert.equal(downloadError, null);
    assert.deepEqual(JSON.parse(fs.readFileSync(filename, "utf8")), JSON.parse(refreshed.export.content));
    await click(win, "#closeDebugButton");
    await click(win, "#gameSettingsButton"); await click(win, "#settingsTabDeveloper"); await click(win, "#debugPanelButton");
    await readPayload(); await click(win, "#closeDebugButton");
    evidence.executionCases.push({ width, height, defaults, visibleAttempts, refreshPreserved: true, reopenPreserved: true, filename });
  }
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.chapterModelCalls, 0); assert.equal(evidence.ttsRequests, 0);
  assert.equal(databaseDigest(fixture.databasePath), fixture.databaseHash);
  assert.deepEqual(readExecutionDatabase(fixture), fixture.savedStory);
  assert(evidence.executionReads.length >= 6);
  for (const read of evidence.executionReads) assert.deepEqual(read.execution, fixture.diagnostics.execution);
  return { ...evidence, adventureId: fixture.adventureId, revision: 1, databaseHash: fixture.databaseHash,
    seedSyntheticModelCalls: fixture.seedSyntheticModelCalls, desktopReadOnly: true };
}

async function runDefaultEntryCoordinator({ notebookEntry = false } = {}) {
  const results = [];
  for (const locale of notebookEntry ? ["zh-CN"] : ["zh-CN", "en-US", "ja-JP"]) {
    const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
    for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
    const env = {};
    for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
      XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot,
      GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
      GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
    const oldRoot = path.join(tempRoot, "data", "saves", "old-incompatible");
    fs.mkdirSync(oldRoot, { recursive: true });
    // Deliberately unreadable legacy contents: format detection must not parse
    // narration, inspect a legacy database or turn these records into new facts.
    const files = { "state.json": "unreadable SYNTHETIC_PRIVATE_OLD_STATE", "meta.json": "unreadable SYNTHETIC_PRIVATE_OLD_TITLE" };
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(oldRoot, name), content);
    fs.writeFileSync(path.join(tempRoot, "results", "default-entry-fixture.json"), JSON.stringify({ locale, oldId: "old-incompatible", files, notebookEntry }));
    const phase = notebookEntry ? "notebook_entry" : "default_entry";
    process.stdout.write(`${notebookEntry ? "Notebook entry" : "Default entry"} ${locale} artifacts: ${tempRoot}\n`);
    const entry = await runPhase(require("electron"), phase, env);
    const restore = locale === "zh-CN" ? await runPhase(require("electron"), `${phase}_restore`, env) : null;
    for (const [name, content] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(oldRoot, name), "utf8"), content);
    assert.deepEqual(fs.readdirSync(oldRoot).sort(), Object.keys(files).sort());
    const result = { ok: true, locale, tempRoot, entry, restore, originalPreserved: true,
      evidence: "Ordinary startup without an engine feature flag; real Main/preload/renderer and Session child. Only isolated synthetic provider, credentials and source files are used." };
    fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2));
    results.push(result);
  }
  process.stdout.write(JSON.stringify({ ok: true, suite: notebookEntry ? "notebook-entry" : "default-entry", results }, null, 2) + "\n");
}

async function runDefaultEntryPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "default-entry-fixture.json"), "utf8"));
  const notebookEntry = fixture.notebookEntry === true;
  const phase = notebookEntry ? "notebook_entry" : "default_entry";
  const restoring = evidence.phase === `${phase}_restore`;
  const oldRoot = path.join(tempRoot, "data", "saves", fixture.oldId);
  const initial = await readStatus(win);
  assert.equal(initial.runtimeProtocol, "session-1");
  assert.equal(await evaluate(win, `['inspectLegacyMigration','migrateLegacySave','readLegacyMigration'].every(key => window.greyCrow[key] === undefined)`), true);
  assert.equal(await evaluate(win, "document.querySelector('#legacyMigrationDialog') === null"), true);
  if (restoring) {
    const previous = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", `${phase}.json`), "utf8"));
    await click(win, `[data-save-id="${previous.adventureId}"]`);
    await waitFor(win, "default session resumes without a model", `(async () => { const status=await window.greyCrow.getStatus();
      return status.gameStarted && status.activeSaveId===${JSON.stringify(previous.adventureId)} && status.activeSave?.revision===1
        && document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(QUESTION)}); })()`);
    await delay(600);
    assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0);
    if (notebookEntry) {
      await waitFor(win, "restored notebook becomes readable without a model or speech", `(() => {
        const view=notebookBookController?.getState();
        return view?.phase==='reading' && !ui.gameView.inert && document.body.dataset.bookPhase==='reading'
          && document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(QUESTION)});
      })()`);
      assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0);
    }
    await screenshot(win, tempRoot, "default-entry-restored", evidence);
    return { ok: true, adventureId: previous.adventureId, revision: 1, modelCalls: 0, chapterModelCalls: 0, ttsRequests: 0,
      ...(notebookEntry ? { realModelCalls: 0, desktopSyntheticModelCalls: 0, syntheticTtsRequests: 0 } : {}), screenshots: evidence.screenshots };
  }
  assert.equal(initial.keyVerified, false);
  await click(win, "#menuLanguageToggle");
  await click(win, { "zh-CN": "#mainMenuLocaleZh", "en-US": "#mainMenuLocaleEn", "ja-JP": "#mainMenuLocaleJa" }[fixture.locale]);
  await waitFor(win, "localized default menu", `document.documentElement.lang===${JSON.stringify(fixture.locale)} && document.querySelector('#localeTransitionCurtain').dataset.phase==='idle'`);
  await click(win, `[data-save-id="${fixture.oldId}"]`);
  assert.equal(await evaluate(win, "document.querySelector('#menuMessage').textContent === t('save.unsupported.notice')"), true);
  assert.equal(await evaluate(win, "document.querySelector('#settingsDialog').open"), false);
  assert.ok(!(await evaluate(win, "document.body.innerText")).includes("SYNTHETIC_PRIVATE_OLD"));
  const listed = await evaluate(win, "window.greyCrow.listSaveSlots()");
  assert.equal(listed.saves[0].compatibility.errorCode, "SAVE_FORMAT_UNSUPPORTED");
  assert.equal(listed.saves[0].compatibility.playerContinuable, false);
  assert.equal((await evaluate(win, `window.greyCrow.continueGame(${JSON.stringify(fixture.oldId)})`)).ok, false);
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0);
  await screenshot(win, tempRoot, `default-unsupported-${fixture.locale}`, evidence);
  await connectSyntheticModel(win);
  if (notebookEntry) {
    await click(win, "#settingsTabDisplay");
    assert.equal(await evaluate(win, "document.querySelector('#uiArtStyleToggleButton')"), null);
    await waitFor(win, "notebook layout persisted", "!state.settingsSaving && !state.settingsDirty && state.gameUiLayout==='story-notebook-v1'");
    assert.equal(await evaluate(win, "document.body.dataset.gameUiLayout"), "story-notebook-v1");
  }
  await click(win, "#closeSettingsButton");
  await click(win, "#newGameButton");
  await waitFor(win, "new adventure beside untouched incompatible source", `document.querySelector('#newGameSetupDialog').open && Boolean(document.querySelector('#newGamePresetSelect').value)`);
  assert.equal(await evaluate(win, "document.querySelector('#newGameConfirmDialog').open"), false, "old files never demand deletion to start a new adventure");
  let current = await readStatus(win);
  if (fixture.locale === "zh-CN") {
    await click(win, "#prepareNewGameButton");
    await waitFor(win, "new content review", "!document.querySelector('#newGameReviewPanel').classList.contains('hidden')");
    assert.equal(evidence.modelCalls, 0);
    await click(win, "#prepareNewGameButton");
    if (notebookEntry) {
      // New narration waits for the book to become readable. Observe the
      // opening first: waiting for QUESTION before this loses the whole phase.
      await waitFor(win, "new opening projects the notebook before narration delivery", `(() => {
        const view=notebookBookController?.getState();
        return view?.phase==='opening' && ui.gameView.inert && document.body.dataset.bookProjection==='true';
      })()`);
      assert.equal(await evaluate(win, `document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(QUESTION)})`), false);
      await evaluate(win, `(() => {
        window.__notebookEntryVideoEnded=false;
        document.querySelector('#themeOpeningVideo').addEventListener('ended', () => { window.__notebookEntryVideoEnded=true; }, {once:true});
      })()`);
      await waitFor(win, "new notebook opening naturally reaches reading", `(() => {
        const view=notebookBookController?.getState();
        return window.__notebookEntryVideoEnded===true && view?.phase==='reading'
          && !ui.gameView.inert && !document.querySelector('#themeOpeningVideo')?.getAttribute('src');
      })()`);
    }
    await waitFor(win, "ordinary startup uses the real new opening session", `(async () => { const status=await window.greyCrow.getStatus();
      return status.activeSave?.revision===1 && status.activeSave.state_hint.opening.phase==='creating'
        && document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(QUESTION)}); })()`);
    current = await readStatus(win);
    assert.equal(evidence.modelCalls, 1); assert.equal(current.activeSave.schemaKind, "session");
    if (notebookEntry) {
      assert.equal(evidence.openingEnvelope?.revision, 1, "new notebook entry must render the real synthetic opening envelope");
      assert.ok(evidence.openingEnvelope?.segments?.some((segment) => segment.content === QUESTION));
    }
    assert.equal(fs.existsSync(path.join(tempRoot, "data", "saves", current.activeSaveId, "state.json")), false);
    await screenshot(win, tempRoot, "default-new-opening", evidence);
    if (notebookEntry) {
      await screenshot(win, tempRoot, "notebook-entry-natural-reading", evidence);
      const beforeMenuModel = evidence.modelCalls, beforeMenuTts = evidence.ttsRequests;
      await click(win, "#gameSettingsButton"); await waitFor(win, "notebook settings before real menu return", "document.querySelector('#settingsDialog').open");
      await click(win, "#backToMenuButton");
      await waitFor(win, "notebook menu return clears presentation", "!document.querySelector('#menuView').classList.contains('hidden') && !document.querySelector('#settingsDialog').open");
      // #bookStage may remain mounted for reuse, but cancel must hide it and
      // remove every active presentation attribute and media source.
      assert.deepEqual(await evaluate(win, `(() => {const video=document.querySelector('#themeOpeningVideo');return {
        stageHidden:document.querySelector('#bookStage')?.hidden===true,src:video?.getAttribute('src')||'',
        material:document.body.hasAttribute('data-material-study'),phase:document.body.hasAttribute('data-book-phase'),
        renderer:document.body.hasAttribute('data-book-renderer'),ready:document.body.classList.contains('book-reading-ready')};})()`),
        { stageHidden: true, src: "", material: false, phase: false, renderer: false, ready: false });
      await click(win, "#continueGameButton");
      await waitFor(win, "same-process notebook opening restarts from saved question", "notebookBookController?.getState()?.phase==='opening' && document.querySelector('#narrationPanel').textContent.includes(" + JSON.stringify(QUESTION) + ")");
      await evaluate(win, "notebookBookController.skip()");
      await waitFor(win, "skipped notebook reopening unlocks", "notebookBookController?.getState()?.phase==='reading' && !ui.gameView.inert");
      assert.equal(evidence.modelCalls, beforeMenuModel); assert.equal(evidence.ttsRequests, beforeMenuTts);
    }
  }
  for (const [name, content] of Object.entries(fixture.files)) assert.equal(fs.readFileSync(path.join(oldRoot, name), "utf8"), content);
  assert.equal(evidence.ttsRequests, 0); assert.equal(evidence.chapterModelCalls, 0);
  return { ok: true, locale: fixture.locale, adventureId: current.activeSaveId, revision: current.activeSave?.revision ?? null,
    modelCalls: evidence.modelCalls, chapterModelCalls: evidence.chapterModelCalls, ttsRequests: evidence.ttsRequests,
    ...(notebookEntry ? { realModelCalls: 0, desktopSyntheticModelCalls: evidence.modelCalls, syntheticTtsRequests: evidence.ttsRequests } : {}),
    originalPreserved: true, noConversionApi: true, screenshots: evidence.screenshots };
}

const COMPACTION_DRAFT = "我仔细听听门外的动静，先留着这句话。";
const COMPACTION_MEMORY_INPUT = "陈姨当时叮嘱我明天把两袋米放在哪里？我照她说的地方归还。";
const COMPACTION_MEMORY_REPLY = "你想起陈姨当时的叮嘱，把两袋米放回门边系着红绳的凳子上。陈姨点头收下，明天归还的约定提前履行了。";
const COMPACTION_ACTION = "我继续观察楼道，不改变手中的物品。";
const COMPACTION_REPLY = "你停在门边，听见楼道尽头的脚步声。两袋米仍在手里，归还的约定仍然保留。";

async function checkCompactionRendererBoundaries() {
  const vm = require("node:vm");
  const source = fs.readFileSync(path.resolve(__dirname, "../renderer/app.js"), "utf8");
  const names = ["sessionCompactionFinished", "sessionCompactionIsStale", "sessionCompactionCanRetry", "sessionCompactionMessage",
    "renderSessionCompactionControls", "adoptSessionCompaction", "confirmSessionContextCompaction", "normalizeSessionContextUsage"];
  const snippets = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`)); assert.ok(start >= 0);
    const end = source.indexOf("\n}", start) + 2; assert.ok(end > start);
    return source.slice(start, end);
  }).join("\n");
  const pending = { adventureId: "synthetic", sessionId: "session-one", revision: 24, settingsIdentity: "settings-one",
    requestId: "original-request", input: "保留原输入", status: "unknown" };
  const state = { runtimeProtocol: "session-1", activeSaveId: pending.adventureId, activeSave: { revision: 24 },
    gameStarted: true, keyVerified: true, runtimeSessionId: pending.sessionId, sessionContextSettingsIdentity: pending.settingsIdentity,
    sessionContextGeneration: 2, sessionContextCompactionAvailable: true, busy: false, busyRevision: 0,
    pendingSessionCompaction: { ...pending } };
  const ui = { turnInput: { value: pending.input }, settingsCompactContextButton: {}, confirmCompactButton: {}, compactStatus: {} };
  const calls = [];
  const contextUsage = { adventureId: pending.adventureId, sessionId: pending.sessionId, revision: 24, actionId: null,
    settingsIdentity: pending.settingsIdentity, scope: "next_request", contextGeneration: 2, fits: true,
    latestEstimate: { safetyInputTokens: 400 }, policy: { effectiveContextWindow: 128000, hardInputLimit: 122880, autoCompactLimit: 83200, autoCompactRatio: 0.65 },
    pendingCompaction: { requestId: pending.requestId, revision: 24, settingsIdentity: pending.settingsIdentity, input: pending.input, status: "running" } };
  const result = (extra) => ({ ok: false, status: { runtimeSessionId: pending.sessionId, activeSaveId: pending.adventureId, activeSave: { revision: 24 } },
    compaction: { requestId: pending.requestId, revision: 24, status: "unknown", ...extra }, contextUsage });
  let readResult = result({ recoveryRequired: true, canRetry: true });
  const sandbox = { state, ui, crypto: { randomUUID: () => "must-not-create-new-id" }, t: (key) => key,
    isStoryInputLocked: () => false, captureRuntimeViewBinding: () => ({ adventureId: state.activeSaveId, sessionId: state.runtimeSessionId, revision: state.activeSave.revision }),
    isRuntimeViewBindingCurrent: () => true, setBusy: (busy) => { state.busy = busy; return ++state.busyRevision; }, applyStatus: () => true,
    setOperationStatus: () => {}, appendNarration: () => {}, closeCompactDialog: () => {}, normalizeContextUsage: (value) => value,
    window: { greyCrow: {
      readContextCompaction: async (request) => { calls.push({ method: "read", request }); return readResult; },
      requestContextCompaction: async (request) => { calls.push({ method: "request", request });
        assert.equal(state.pendingSessionCompaction.canRetry, false, "retry consumes the previously checked inactive-attempt permission");
        return result({ status: "running" }); },
    } } };
  const context = vm.createContext(sandbox);
  vm.runInContext(snippets + "\nfunction restoreContextUsage(value) { adoptSessionCompaction(value); }", context);
  await vm.runInContext("confirmSessionContextCompaction()", context);
  assert.equal(calls.length, 1); assert.equal(calls[0].method, "read");
  assert.equal(state.pendingSessionCompaction.status, "unknown"); assert.equal(state.pendingSessionCompaction.canRetry, true);
  assert.equal(ui.confirmCompactButton.textContent, "compact.session.retry");
  assert.equal(ui.compactStatus.textContent, "compact.session.retryReady");
  await vm.runInContext("confirmSessionContextCompaction()", context);
  assert.equal(calls.length, 2); assert.equal(calls[1].method, "request");
  assert.equal(calls[1].request.requestId, pending.requestId); assert.equal(calls[1].request.input, pending.input); assert.equal(calls[1].request.retry, true);
  assert.equal(state.pendingSessionCompaction.canRetry, false); assert.equal(ui.confirmCompactButton.textContent, "compact.session.check");
  readResult = result({ status: "running", canRetry: false });
  await vm.runInContext("confirmSessionContextCompaction()", context);
  assert.equal(calls[2].method, "read"); assert.equal(state.pendingSessionCompaction.canRetry, false);
  state.pendingSessionCompaction = { ...pending, recoveryRequired: true, canRetry: true };
  state.runtimeSessionId = "session-two";
  vm.runInContext("adoptSessionCompaction(" + JSON.stringify(contextUsage) + ")", context);
  assert.equal(state.pendingSessionCompaction.canRetry, false, "inactive-attempt proof does not survive a changed runtime identity");
  state.runtimeSessionId = pending.sessionId;
  assert.equal(vm.runInContext("normalizeSessionContextUsage(" + JSON.stringify({ ...contextUsage, contextGeneration: 1 }) + ")", context), null);
  assert.equal(vm.runInContext("normalizeSessionContextUsage(" + JSON.stringify({ ...contextUsage, contextGeneration: 3 }) + ")", context), null);
  const current = vm.runInContext("normalizeSessionContextUsage(" + JSON.stringify(contextUsage) + ")", context);
  assert.equal(current.used, 400); assert.equal(current.contextGeneration, 2);
  return { ok: true, scope: "actual Renderer functions in a VM, isolated input/output adapters", checks: [
    "unknown only reads", "read-only inactive-attempt proof enables explicit same-request retry", "DB running does not erase verified same-attempt proof",
    "retry consumes proof", "live running stays query-only", "new runtime clears proof", "old and unannounced future generations cannot replace current estimate",
  ] };
}

const FRAGMENT_STRINGS = {
  "zh-CN": { title: "记忆碎片", uncertain: "未经证实", collecting: "收集中", available: "可以拼合", deferred: "暂缓决定",
    accepted: "接受过去 · 恢复记忆者", sealed: "不接受过去 · 选择新的自己", trigger: "楼梯口的焦糖气味",
    sensory: "甜味从喉间一闪而过，指尖似乎碰到纸杯。画面里有人笑了，却看不清脸。",
    collect: "楼梯口传来焦糖味，我停下来，让这气味自然唤起一段尚未证实的感官片段。",
    collectReply: "甜味从喉间一闪而过，指尖似乎碰到纸杯。画面里有人笑了，却看不清脸。这些仍只是未经证实的片段，你愿意如何面对拼合出的过去？",
    ambiguous: "我有点犹豫，再看看这些片段，先别替我决定。", ambiguousReply: "你把这些画面暂时放在眼前，还没有作出选择。楼道里的风依旧吹过。",
    defer: "我明确选择暂缓面对拼合出的过去，以后再决定。", deferReply: "你把这份过去留待以后面对，片段仍然保留，决定并未封死。",
    accept: "我明确接受这份可能的过去作为自己的叙事，但不把它当作已经证实的历史。", acceptReply: "你愿意带着这些不确定的片段继续生活，接受这份关于自己的叙事。恢复记忆者是你选择的称谓，而这些画面仍未得到独立证实。",
    seal: "我明确选择不接受这份过去，我要塑造新的自己。", sealReply: "你把片段好好收起，选择塑造新的自己。这不是失败，它们仍然保留，而眼前的道路属于你。" },
  "en-US": { title: "Memory Fragments", uncertain: "Unverified", collecting: "Collecting", available: "Ready to Reconstruct", deferred: "Decision Deferred",
    accepted: "Accept the Past · Memory Restorer", sealed: "Reject the Past · Choose a New Self", trigger: "The caramel smell by the stairs",
    sensory: "Sweetness briefly catches in your throat, and your fingertips seem to touch a paper cup. Someone laughs in the image, but their face remains unclear.",
    collect: "I pause at the caramel smell by the stairs and let it bring up an unverified sensory fragment.",
    collectReply: "Sweetness briefly catches in your throat, and your fingertips seem to touch a paper cup. Someone laughs in the image, but their face remains unclear. These fragments are still unverified; how would you face this possible past?",
    accept: "I clearly choose to accept this possible past as my own narrative, without treating it as proven history.",
    acceptReply: "You choose to carry these uncertain images as part of your personal narrative. Memory Restorer names that choice; it does not prove the images are historical facts." },
  "ja-JP": { title: "記憶の欠片", uncertain: "未確認", collecting: "収集中", available: "再構成できる", deferred: "決定を保留",
    accepted: "過去を受け入れる・記憶を取り戻した者", sealed: "過去を受け入れない・新しい自分を選ぶ", trigger: "階段のそばのカラメルの匂い",
    sensory: "甘さが一瞬喉をかすめ、指先が紙コップに触れたように感じる。誰かが笑う映像が浮かぶが、顔ははっきりしない。",
    collect: "階段のそばのカラメルの匂いに足を止め、未確認の感覚の欠片が自然に浮かぶのを待つ。",
    collectReply: "甘さが一瞬喉をかすめ、指先が紙コップに触れたように感じる。誰かが笑う映像が浮かぶが、顔ははっきりしない。欠片はまだ未確認だ。この可能性のある過去に、どう向き合いたいだろう。",
    accept: "証明された歴史とは扱わず、可能性のある過去を自分の物語として受け入れると明確に選ぶ。",
    acceptReply: "あなたは曖昧な映像を、自分の物語の一部として受け入れる。記憶を取り戻した者という呼び名はその選択を表し、歴史的事実を証明するものではない。" },
};
const FRAGMENT_SEEDS = [
  ["冷钥匙", "cold key", "冷たい鍵"], ["旧铃声", "old bell", "古い鐘"], ["雨水", "rainwater", "雨水"], ["纸箱", "cardboard box", "段ボール"],
  ["盐味", "salt", "塩の味"], ["布纹", "woven cloth", "布の織り目"], ["柴烟", "wood smoke", "薪の煙"], ["水汽", "steam", "湯気"],
  ["玻璃", "glass", "ガラス"], ["墨迹", "ink", "墨の跡"], ["松针", "pine needles", "松葉"], ["砂粒", "grains of sand", "砂粒"],
  ["铜扣", "brass button", "真鍮のボタン"], ["书页", "book pages", "本のページ"], ["石阶", "stone steps", "石段"], ["柑橘", "citrus peel", "柑橘の皮"],
  ["木屑", "wood shavings", "木くず"], ["风笛", "distant pipe music", "遠い笛の音"], ["灯影", "lamplight", "灯りの影"], ["瓷杯", "porcelain cup", "磁器のカップ"],
  ["海风", "sea breeze", "海風"], ["粉笔", "chalk", "チョーク"], ["旧绳", "old rope", "古い縄"], ["麦穗", "wheat", "麦の穂"],
  ["铁轨", "railway tracks", "線路"], ["羽毛", "feather", "羽根"], ["树皮", "tree bark", "木の皮"], ["雪地", "snow", "雪"], ["旧琴", "old piano", "古いピアノ"],
];

async function runFragmentsCoordinator({ startAt = 0 } = {}) {
  const results = [];
  for (const [locale, choice] of [["zh-CN", "accepted"], ["zh-CN", "sealed"], ["en-US", "accepted"], ["ja-JP", "accepted"]].slice(startAt)) {
    const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
    for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
    const env = {};
    for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) if (process.env[name] !== undefined) env[name] = process.env[name];
    Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
      XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot,
      GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
      GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
    const fixture = await createFragmentsFixture(tempRoot, locale, choice);
    process.stdout.write(`Fragments ${locale}/${choice} artifacts: ${tempRoot}\n`);
    const play = await runPhase(require("electron"), "fragments_play", env);
    const restore = await runPhase(require("electron"), "fragments_restore", env);
    assert.equal(restore.modelCalls, 0); assert.equal(restore.ttsRequests, 0);
    assert.equal(restore.revision, play.revision); assert.deepEqual(restore.fragments, play.fragments);
    const result = { ok: true, fixture, tempRoot, play, restore,
      evidence: "Actual Electron Main/preload/renderer, Session child and SQLite; 29 explicitly synthetic precommitted fragments, fresh model responses and silent audio remain local mocks.",
      limitations: ["Natural triggers, semantic similarity, literary quality and native-language acceptance are not established by these synthetic fixtures."] };
    fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2));
    results.push({ locale, choice, tempRoot, revision: play.revision, playCalls: play.modelCalls, restoreCalls: restore.modelCalls, restoreSpeech: restore.ttsRequests });
  }
  process.stdout.write(JSON.stringify({ ok: true, suite: "fragments", results }, null, 2) + "\n");
}
async function createFragmentsFixture(tempRoot, locale, choice) {
  const fixture = await createSettingsFixture(tempRoot, locale);
  const gameRoot = path.resolve(__dirname, "../../../..");
  const { createTurnStore } = require(path.join(gameRoot, "engine/session/turn-store"));
  const { readContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-reader"));
  const snapshot = await readContentSnapshot({ adventuresRoot: path.join(tempRoot, "data", "saves"), adventureId: fixture.adventureId });
  const store = createTurnStore({ databasePath: fixture.databasePath, adventureId: fixture.adventureId, locale,
    contentVersion: snapshot.lock.overallHash, memoryFragmentsEnabled: true });
  try {
    for (let index = 0; index < 29; index++) {
      const revision = index + 1; const day = 10 + Math.floor(index / 2);
      const trigger = FRAGMENT_SEEDS[index][["zh-CN", "en-US", "ja-JP"].indexOf(locale)];
      const content = locale === "zh-CN" ? `关于${trigger}的触感一闪而过。画面没有完整名字，只有一段未经证实的联想。`
        : locale === "en-US" ? `A sensation associated with ${trigger} briefly surfaces. The image has no complete name and remains an unverified association.`
          : `${trigger}に結びついた感覚が一瞬浮かぶ。映像には確かな名前がなく、未確認の連想にすぎない。`;
      const id = `seed-fragment-${revision}`;
      const action = store.beginAction({ actionId: id, baseRevision: index, input: trigger, locale, contentVersion: snapshot.lock.overallHash });
      store.commitAction({ actionId: id, attemptId: action.attemptId, bundle: bundle(id, content, [
        { id: `${id}-day`, type: "situation.update", sourceSegmentIds: [id], data: { day } },
        { id: `${id}-record`, type: "memory_fragment.record", sourceSegmentIds: [id], data: {
          discoveryMode: index % 2 ? "passive_association" : "active_recall", dimension: ["body", "emotion", "skill", "identity"][index % 4], trigger, content } },
      ]) });
    }
  } finally { store.close(); }
  Object.assign(fixture, { choice, initialRevision: 29 });
  fs.writeFileSync(path.join(tempRoot, "results", "fragments-fixture.json"), JSON.stringify(fixture, null, 2));
  return fixture;
}
function readFragmentsFixture(fixture) {
  const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(fixture.databasePath, { readOnly: true });
  try { const row = db.prepare("SELECT revision,state_json FROM turns ORDER BY revision DESC LIMIT 1").get();
    const state = JSON.parse(row.state_json); return { revision: row.revision, fragments: state.memoryFragments, state }; } finally { db.close(); }
}
function generateFragmentsFixture(request, evidence, tempRoot) {
  assert.equal(evidence.phase, "fragments_play", "reading fragment panels or restoring must not call a model");
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "fragments-fixture.json"), "utf8"));
  const strings = FRAGMENT_STRINGS[fixture.locale];
  const parsed = request.messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } });
  assert.equal(parsed.some((entry) => entry?.task), false);
  const canonical = parsed.find((entry) => entry?.canonicalState); assert.ok(canonical); assert.equal(canonical.locale, fixture.locale);
  assert.equal(canonical.quotedNarrativeSources.memoryFragmentText, undefined, "ordinary context carries only the optional module catalog");
  const guide = parsed.find((entry) => entry?.module === "memory_fragments");
  const input = request.messages.find((message) => message.content.startsWith("Current player action:\n"))?.content.slice("Current player action:\n".length);
  evidence.modelCalls++;
  let text; let events = []; let marker;
  if (input === strings.collect) {
    assert.equal(canonical.baseRevision, 29); text = strings.collectReply; marker = "collected";
    events = [{ id: "ui-fragment-thirtieth", type: "memory_fragment.record", sourceSegmentIds: [marker], data: {
      discoveryMode: "passive_association", dimension: "emotion", trigger: strings.trigger, content: strings.sensory } }];
  } else if (input === strings.ambiguous) { text = strings.ambiguousReply; marker = "ambiguous"; }
  else {
    const choice = input === strings.defer ? "deferred" : input === strings.accept ? "accepted" : input === strings.seal ? "sealed" : null;
    assert.ok(choice); text = choice === "deferred" ? strings.deferReply : choice === "accepted" ? strings.acceptReply : strings.sealReply; marker = `choice-${choice}`;
    events = [{ id: `ui-fragment-${choice}`, type: "memory_fragment.resolve", sourceSegmentIds: [marker], data: { choice } }];
  }
  if (events.length && !guide) {
    assert.ok(request.tools.some((tool) => tool.function.name === "read_narrative_module"));
    evidence.moduleLoads = (evidence.moduleLoads || 0) + 1;
    return { text: "", finishReason: "tool_calls", toolCalls: [{ id: `load-module-${canonical.baseRevision}`,
      name: "read_narrative_module", arguments: '{"module":"memory_fragments"}' }],
      usage: { input_tokens: 50, output_tokens: 30 } };
  }
  if (guide) {
    assert.equal(guide.revision, canonical.baseRevision);
    assert.match(guide.instructions, /memory_fragment\.record data/);
    assert.ok(guide.quotedNarrativeSources.memoryFragmentText.length > 0);
  }
  evidence.modelInputs.push({ input, revision: canonical.baseRevision, choice: marker });
  return { text: JSON.stringify(bundle(marker, text, events)), toolCalls: [], usage: { input_tokens: 240, output_tokens: 130 }, finishReason: "stop", model: "synthetic-local" };
}
async function closeFragmentDrawer(win) {
  await click(win, "#storyNotebookDrawerCloseButton");
  await waitFor(win, "fragment drawer fully closed", "!document.querySelector('#storyNotebookDrawer').classList.contains('is-open') && document.querySelector('#gameView').dataset.notebookPageTransition!=='true'");
}
async function checkFragmentsPanel(win, evidence, tempRoot, fixture, expectedPhase, count, label, details = false) {
  const strings = FRAGMENT_STRINGS[fixture.locale]; const calls = evidence.modelCalls; const tts = evidence.ttsRequests;
  await click(win, "#storyNotebookModulesButton");
  await waitFor(win, "selected fragment panel is listed", "Boolean(document.querySelector('[data-panel-ref=\"session-memory-fragments\"]'))");
  assert.doesNotMatch(await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent"), /Runtime|可信来源|read-only projections|信頼済み/);
  if (details) await screenshot(win, tempRoot, `${label}-directory`, evidence);
  await click(win, '[data-panel-ref="session-memory-fragments"]');
  await waitFor(win, "fragment overview settled", "!state.skillPanelRefreshBusy && state.activeSkillPanelProjection?.view==='overview' && Boolean(document.querySelector('.story-notebook-panel-list-action[data-field-id=\"fragments\"]'))");
  const overview = await evaluate(win, "structuredClone(state.activeSkillPanelProjection)");
  assert.equal(overview.fields.find((entry) => entry.id === "fragments").value, count);
  assert.equal(overview.fields.find((entry) => entry.id === "revelation_status").value, strings[expectedPhase]);
  const uiText = await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent");
  assert.ok(uiText.includes(strings.uncertain)); assert.ok(uiText.includes(strings.title));
  assert.doesNotMatch(uiText, /read_narrative_module|record_memory_fragment|resolve_memory_fragment|memory_fragment\.|sourceSegmentIds/);
  assert.equal(await evaluate(win, "document.querySelectorAll('#storyNotebookDrawerBody .skill-module-field-header > span, #storyNotebookDrawerBody .skill-module-trigger-list, #storyNotebookDrawerBody .story-notebook-skill-identity').length"), 0);
  if (evidence.phase === "fragments_overview" || details) {
    await evaluate(win, "document.querySelector('#storyNotebookDrawerBody .story-notebook-panel-fields').scrollIntoView({block:'start',behavior:'instant'})");
    await screenshot(win, tempRoot, `${label}-progress`, evidence);
  }
  if (details) {
    await screenshot(win, tempRoot, `${label}-overview`, evidence);
    await click(win, '.story-notebook-panel-list-action[data-field-id="fragments"]');
    await waitFor(win, "first twelve fragment records", "!state.skillPanelRefreshBusy && state.activeSkillPanelProjection?.view==='list' && document.querySelectorAll('.story-notebook-panel-record').length===12");
    while (await evaluate(win, "Boolean(state.activeSkillPanelProjection?.pagination?.hasMore)")) {
      const previous = await evaluate(win, "state.activeSkillPanelProjection.items.length");
      await click(win, "#storyNotebookDrawerBody .story-notebook-panel-load-more");
      await waitFor(win, "fragment next page appended", `!state.skillPanelRefreshBusy && state.activeSkillPanelProjection.items.length>${previous}`);
    }
    assert.equal(await evaluate(win, "document.querySelectorAll('.story-notebook-panel-record').length"), count);
    await click(win, ".story-notebook-panel-record:last-child");
    await waitFor(win, "full latest fragment detail", `!state.skillPanelRefreshBusy && state.activeSkillPanelProjection?.view==='detail' && document.querySelector('#storyNotebookDrawerBody').textContent.includes(${JSON.stringify(strings.sensory)})`);
    assert.ok((await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent")).includes(strings.uncertain));
    assert.equal(await evaluate(win, "state.activeSkillPanelProjection.detail.title"), `${strings.title} · ${count}`);
    const fragmentFields = await evaluate(win, "state.activeSkillPanelProjection.detail.sections[0].fields");
    assert.equal(fragmentFields[0].id, "content");
    assert.ok((await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent")).includes(fragmentFields.find(field => field.id === "trigger").value));
    await screenshot(win, tempRoot, `${label}-detail`, evidence);
  }
  await closeFragmentDrawer(win);
  assert.equal(evidence.modelCalls, calls); assert.equal(evidence.ttsRequests, tts);
  (evidence.panelChecks ||= []).push({ label, count, expectedPhase, language: fixture.locale, zeroModelAndSpeech: true, details });
}
async function runFragmentsPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "fragments-fixture.json"), "utf8"));
  const strings = FRAGMENT_STRINGS[fixture.locale]; const restore = evidence.phase !== "fragments_play";
  if (!restore) {
    await click(win, "#menuLanguageToggle"); await click(win, { "zh-CN": "#mainMenuLocaleZh", "en-US": "#mainMenuLocaleEn", "ja-JP": "#mainMenuLocaleJa" }[fixture.locale]);
    await waitFor(win, "fragment interface locale settled", `document.documentElement.lang===${JSON.stringify(fixture.locale)} && document.querySelector('#localeTransitionCurtain').dataset.phase==='idle'`);
    await connectSyntheticModel(win); await click(win, "#settingsTabDisplay");
    if (fixture.locale === "zh-CN") { await click(win, "#settingsTabAudio"); await change(win, "#ttsProviderSelect", "kokoro-original-local"); await change(win, "#ttsReadingModeSelect", "auto"); }
    await click(win, "#saveSettingsButton"); await waitFor(win, "fragment settings persisted", "!state.settingsSaving && !state.settingsDirty"); await click(win, "#closeSettingsButton");
  }
  const initial = readFragmentsFixture(fixture);
  await waitFor(win, "fragment fixture available", "!document.querySelector('#continueGameButton').disabled"); await click(win, "#continueGameButton");
  await waitSettingsRevision(win, fixture.adventureId, initial.revision, "");
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0);
  if (restore) {
    const before = JSON.stringify(initial);
    await checkFragmentsPanel(win, evidence, tempRoot, fixture, fixture.choice, 30, `fragments-${fixture.locale}-${fixture.choice}-restored`, evidence.phase !== "fragments_overview");
    assert.equal(JSON.stringify(readFragmentsFixture(fixture)), before);
  } else {
    await checkFragmentsPanel(win, evidence, tempRoot, fixture, "collecting", 29, "fragments-collecting");
    const submitFragment = async (input, reply, phase) => {
      const revision = readFragmentsFixture(fixture).revision + 1; const speech = evidence.ttsRequests;
      const calls = evidence.modelCalls, loads = evidence.moduleLoads || 0;
      await submit(win, input); await waitSettingsRevision(win, fixture.adventureId, revision, reply);
      const writesModule = input !== strings.ambiguous;
      assert.equal(evidence.modelCalls - calls, writesModule ? 2 : 1, "writing loads its guide once; ordinary replies need no guide");
      assert.equal((evidence.moduleLoads || 0) - loads, writesModule ? 1 : 0);
      if (fixture.locale === "zh-CN") await waitUntil("fresh fragment narration speech", () => evidence.ttsRequests === speech + 1);
      const read = readFragmentsFixture(fixture); assert.equal(read.fragments.fragments.length, 30); assert.equal(read.fragments.revelationStatus, phase);
      assert.deepEqual(read.state.entities, initial.state.entities); assert.deepEqual(read.state.inventory, initial.state.inventory);
      assert.equal(read.state.finale, undefined, "fragment choices do not become story finales");
      await checkFragmentsPanel(win, evidence, tempRoot, fixture, phase, 30, `fragments-${fixture.locale}-${phase}`, phase === fixture.choice);
    };
    await submitFragment(strings.collect, strings.collectReply, "available");
    if (fixture.locale === "zh-CN" && fixture.choice === "accepted") {
      await submitFragment(strings.ambiguous, strings.ambiguousReply, "available");
      await submitFragment(strings.defer, strings.deferReply, "deferred");
    }
    await submitFragment(fixture.choice === "accepted" ? strings.accept : strings.seal, fixture.choice === "accepted" ? strings.acceptReply : strings.sealReply, fixture.choice);
  }
  const result = readFragmentsFixture(fixture);
  assert.equal(result.fragments.fragments.every((fragment) => fragment.certainty === "uncertain"), true);
  return { ...evidence, adventureId: fixture.adventureId, revision: result.revision, fragments: result.fragments };
}

async function runCompactionCoordinator({ boundariesOnly = false } = {}) {
  await checkCompactionRendererBoundaries();
  const runs = [];
  for (const kind of boundariesOnly ? ["boundaries"] : ["manual", "auto", "timeout"]) {
    const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
    for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
    const env = {};
    for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
      XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot,
      GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
      GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
    const fixture = await createCompactionFixture(tempRoot, kind);
    process.stdout.write(`Compaction ${kind} artifacts: ${tempRoot}\n`);
    const phases = kind === "boundaries" ? ["compact_boundaries"] : kind === "manual" ? ["compact_manual", "compact_restart"] : kind === "timeout" ? ["compact_timeout", "compact_timeout_restart"] : ["compact_auto"];
    const evidence = [];
    for (const phase of phases) evidence.push(await runPhase(require("electron"), phase, env));
    const result = { ok: true, kind, tempRoot, fixture, phases: evidence,
      evidence: "Real Electron Main/preload/renderer, real child, SQLite, compaction planner and recalled original passages. Local synthetic provider and silent WAV only.",
      limitations: ["Synthetic summary and story meaning were hand authored; no real Provider, speech quality or player acceptance was tested."] };
    fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2));
    runs.push({ kind, tempRoot, phases: evidence.map(({ phase, revision, modelCalls, compactionModelCalls, ttsRequests }) => ({ phase, revision, modelCalls, compactionModelCalls, ttsRequests })) });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, suite: "compaction", runs }, null, 2)}\n`);
}

async function createCompactionFixture(tempRoot, kind) {
  const fixture = await createSettingsFixture(tempRoot, "zh-CN");
  const gameRoot = path.resolve(__dirname, "../../../..");
  const { createTurnStore } = require(path.join(gameRoot, "engine/session/turn-store"));
  const { readContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-reader"));
  const snapshot = await readContentSnapshot({ adventuresRoot: path.join(tempRoot, "data", "saves"), adventureId: fixture.adventureId });
  const store = createTurnStore({ databasePath: fixture.databasePath, adventureId: fixture.adventureId, locale: "zh-CN", contentVersion: snapshot.lock.overallHash });
  const repetitions = ["manual", "boundaries"].includes(kind) ? 25 : 75;
  try {
    for (let revision = 1; revision <= 24; revision++) {
      let generated;
      if (revision === 1) {
        generated = generateFixture({ baseRevision: 3, canonicalState: { ...readyState(), opening: { phase: "ready" } } }, PLAYER_BORROW);
        generated.narration[0].text += CONTINUATION_OLD_MEMORY;
      } else generated = bundle(`compact-source-${revision}`, `第${revision}次观察：` + "林安站在楼梯间，观察窗外。".repeat(repetitions));
      const action = store.beginAction({ actionId: `compact-seed-${revision}`, baseRevision: revision - 1,
        input: revision === 1 ? PLAYER_BORROW : `我第${revision}次观察楼道。`, locale: "zh-CN", contentVersion: snapshot.lock.overallHash });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: generated });
    }
  } finally { store.close(); }
  Object.assign(fixture, { kind, revision: 24, repetitions, lastText: "第24次观察：" + "林安站在楼梯间，观察窗外。".repeat(repetitions) });
  fs.writeFileSync(path.join(tempRoot, "results", "compaction-fixture.json"), JSON.stringify(fixture, null, 2));
  return fixture;
}

function compactionDatabase(fixture) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(fixture.databasePath, { readOnly: true });
  try {
    return { revision: db.prepare("SELECT revision FROM session WHERE singleton=1").get().revision,
      turns: db.prepare("SELECT revision,action_id,narration_json,state_json FROM turns ORDER BY revision").all(),
      jobs: db.prepare("SELECT * FROM context_compactions ORDER BY created_at").all() };
  } finally { db.close(); }
}

async function generateCompactionFixture(request, evidence) {
  const data = request.messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } });
  const compact = data.find((value) => ["summarize_context", "merge_context"].includes(value?.task));
  const response = (value) => ({ text: JSON.stringify(value), toolCalls: [], usage: { input_tokens: 220, output_tokens: 120 }, finishReason: "stop", model: "synthetic-local" });
  if (compact) {
    evidence.compactionModelCalls = (evidence.compactionModelCalls || 0) + 1;
    (evidence.compactionInputs ||= []).push(compact);
    assert.equal(compact.locale, "zh-CN"); assert.equal(compact.range.fromRevision, 1);
    assert.doesNotMatch(JSON.stringify(compact.currentState), /隐藏访客|隐藏钥匙/);
    if (evidence.phase === "compact_timeout") return new Promise((resolve, reject) => request.signal.addEventListener("abort", () => {
      evidence.compactionTimeoutObserved = true;
      reject(Object.assign(new Error("SYNTHETIC_COMPACTION_DEADLINE"), { code: "ABORT_ERR" }));
    }, { once: true }));
    if (evidence.phase === "compact_boundaries") await new Promise((resolve) => compactionDeferredResponses.set("compaction", resolve));
    const quote = (compact.quoteCandidates || compact.parts.flatMap((part) => part.items))
      .find((item) => item.source.revision > 1);
    assert.ok(quote, "the synthetic selection leaves the older placement detail for the separate recall check");
    return response({ selectedQuoteIds: [quote.quoteId] });
  }
  evidence.modelCalls++;
  assert.notEqual(evidence.phase, "compact_timeout", "an automatic compaction failure must not call the story provider");
  const canonical = data.find((value) => value?.canonicalState); assert.ok(canonical);
  const input = request.messages.find((message) => message.content?.startsWith("Current player action:\n"))?.content.slice("Current player action:\n".length);
  const historyMessage = request.messages.find((message) => message.content?.startsWith("Continuous conversation and retained original quotations (quoted data):\n"));
  assert.ok(historyMessage); const history = JSON.parse(historyMessage.content.split("\n").slice(1).join("\n"));
  assert.ok(history.summary); assert.equal(history.summary.throughRevision, 22);
  assert.deepEqual(history.turns.map((turn) => turn.revision), [23, 24]);
  evidence.modelInputs.push({ input, revision: canonical.baseRevision, history });
  if (input === COMPACTION_MEMORY_INPUT) {
    const memoryMessage = request.messages.find((message) => message.content?.startsWith("Player-known related experiences and original passages:\n"));
    assert.ok(memoryMessage); const memory = JSON.parse(memoryMessage.content.split("\n").slice(1).join("\n"));
    const retrieved = memory.results.find((entry) => entry.source.revision === 1 && entry.passages.some((passage) => passage.text.includes("红绳")));
    assert.ok(retrieved, "the old original placement must be recovered from persisted memory");
    for (const message of request.messages) if (message !== memoryMessage) assert.doesNotMatch(message.content, /红绳|凳子/);
    evidence.memoryIsolation = { originalSource: retrieved.source, summaryThroughRevision: history.summary.throughRevision,
      remainingTurns: history.turns.map((turn) => turn.revision), clueOnlyInRecall: true };
    return response(bundle("compact-memory-return", COMPACTION_MEMORY_REPLY, [
      { id: "compact-return-rice", type: "inventory.transfer", sourceSegmentIds: ["compact-memory-return"], data: { fromId: "lin-an", toId: "chen", itemId: "rice", quantity: 2 } },
      { id: "compact-resolve-rice", type: "commitment.resolve", sourceSegmentIds: ["compact-memory-return"], data: { id: "rice-return", status: "fulfilled" } },
    ], [{ id: "compact-return-memory", text: "林安按陈姨早先的叮嘱归还两袋米，约定已经履行。", kind: "event", knownBy: ["lin-an", "chen"],
      entityIds: ["lin-an", "chen", "rice"], eventIds: ["compact-return-rice", "compact-resolve-rice"], sourceSegmentIds: ["compact-memory-return"] }]));
  }
  assert.equal(input, COMPACTION_ACTION);
  if (evidence.phase === "compact_boundaries") await new Promise((resolve, reject) => compactionDeferredResponses.set("story", () => reject(new Error("SYNTHETIC_BOUNDARY_STORY_FAILURE"))));
  return response(bundle("compact-after-auto", COMPACTION_REPLY));
}

async function openCompactionControl(win) {
  await click(win, "#gameSettingsButton"); await click(win, "#settingsTabDeveloper");
  await click(win, "#settingsCompactContextButton");
  await waitFor(win, "actual compaction dialog open", "document.querySelector('#compactDialog').open && !document.querySelector('#confirmCompactButton').disabled");
}

async function runCompactionPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "compaction-fixture.json"), "utf8"));
  const restarting = evidence.phase.endsWith("restart");
  if (!restarting) {
    await click(win, "#menuLanguageToggle"); await click(win, "#mainMenuLocaleZh");
    await waitFor(win, "Chinese interface settled", "document.documentElement.lang==='zh-CN' && document.querySelector('#localeTransitionCurtain').dataset.phase==='idle'");
    await connectSyntheticModel(win);
    await click(win, "#settingsTabDisplay");
    await click(win, "#settingsTabAudio"); await change(win, "#ttsProviderSelect", "kokoro-original-local"); await change(win, "#ttsReadingModeSelect", "auto");
    await click(win, "#settingsTabDeveloper"); await change(win, "#contextWindowPresetSelect", "128000"); await change(win, "#autoCompactRatioSelect", "0.65");
    // This suite isolates compaction, source recall and receipt recovery.
    // Optional chapter policies have their own real desktop suite.
    await click(win, "#settingsTabSave"); await change(win, "#compactionChapterSelect", "false");
    await click(win, "#saveSettingsButton");
    await waitFor(win, "synthetic compaction preferences saved", "!state.settingsSaving && !state.settingsDirty");
    await click(win, "#closeSettingsButton");
  }
  await waitFor(win, "synthetic long adventure available", "!document.querySelector('#continueGameButton').disabled");
  await click(win, "#continueGameButton"); await waitSettingsRevision(win, fixture.adventureId, 24, "第24次观察：");
  assert.equal((await readStatus(win)).settings.save.chapterLog.onCompaction, false);
  await waitUntil("compaction zero-model initial recovery", () => evidence.contextRecoveries?.length > 0);
  const initial = evidence.contextRecoveries.at(-1);
  assert.equal(initial.latestActual, null); assert.equal(initial.compactionAvailable, true);
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.compactionModelCalls || 0, 0); assert.equal(evidence.ttsRequests, 0);
  await assertSettingsMeter(win, initial, 24, evidence, "initial");
  const before = compactionDatabase(fixture);
  evidence.initialContext = initial;
  if (evidence.phase === "compact_boundaries") {
    const status = await readStatus(win);
    const binding = { adventureId: fixture.adventureId, sessionId: status.runtimeSessionId, revision: 24 };
    await change(win, "#turnInput", COMPACTION_DRAFT, "input"); await openCompactionControl(win); await click(win, "#confirmCompactButton");
    await waitUntil("compaction model held while actual Main operation runs", () => compactionDeferredResponses.has("compaction"));
    const request = await evaluate(win, "structuredClone(state.pendingSessionCompaction)");
    const rejectedAction = await evaluate(win, `window.greyCrow.runTurn(${JSON.stringify(COMPACTION_ACTION)}, ${JSON.stringify({ ...binding, actionId: "must-not-start-during-compaction", baseRevision: 24 })})`);
    assert.equal(rejectedAction.ok, false); assert.equal(rejectedAction.error.code, "ADVENTURE_BUSY");
    const activeReceipt = await evaluate(win, `window.greyCrow.readContextCompaction(${JSON.stringify({ ...binding, requestId: request.requestId })})`);
    assert.equal(activeReceipt.compaction.status, "running"); assert.notEqual(activeReceipt.compaction.canRetry, true);
    assert.equal(evidence.compactionModelCalls, 1); assert.equal(evidence.modelCalls, 0);
    assert.deepEqual(compactionDatabase(fixture).turns, before.turns);
    compactionDeferredResponses.get("compaction")(); compactionDeferredResponses.delete("compaction");
    await waitFor(win, "held compaction commits once", "!state.busy && state.pendingSessionCompaction?.status==='reduced'");
    assert.equal((await readStatus(win)).activeSave.revision, 24);
    const meter = await evaluate(win, "structuredClone(state.contextUsage)"); assert.equal(meter.contextGeneration, 1);
    // A real earlier read supplied this stale payload; invoke the same production
    // normalizer without inventing a provider response or replacing an IPC method.
    const staleAccepted = await evaluate(win, `normalizeSessionContextUsage(${JSON.stringify(activeReceipt.contextUsage)})`);
    assert.equal(staleAccepted, null); assert.deepEqual(await evaluate(win, "structuredClone(state.contextUsage)"), meter);
    await submit(win, COMPACTION_ACTION);
    await waitUntil("story provider held while actual Main operation runs", () => compactionDeferredResponses.has("story"));
    const rejectedCompaction = await evaluate(win, `window.greyCrow.requestContextCompaction(${JSON.stringify({ ...binding, requestId: "must-not-start-during-story", input: COMPACTION_ACTION })})`);
    assert.equal(rejectedCompaction.ok, false); assert.equal(rejectedCompaction.error.code, "ADVENTURE_BUSY");
    assert.equal(evidence.compactionModelCalls, 1);
    compactionDeferredResponses.get("story")(); compactionDeferredResponses.delete("story");
    await waitFor(win, "synthetic story failure preserves draft", `!state.busy && document.querySelector('#turnInput').value===${JSON.stringify(COMPACTION_ACTION)}`);
    assert.equal((await readStatus(win)).activeSave.revision, 24); assert.equal(evidence.ttsRequests, 0);
    const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try { assert.equal(db.prepare("SELECT count(*) AS count FROM actions WHERE action_id='must-not-start-during-compaction'").get().count, 0);
      assert.equal(db.prepare("SELECT count(*) AS count FROM context_compactions WHERE request_id='must-not-start-during-story'").get().count, 0); } finally { db.close(); }
    evidence.mutualExclusion = { storyWhileCompacting: rejectedAction.error.code, compactionWhileStory: rejectedCompaction.error.code,
      rejectedRequestsCreatedNoJobs: true, activeReadModelCalls: 0, oldGenerationRejected: true };
    await screenshot(win, tempRoot, "compact-mutual-exclusion", evidence);
  } else if (evidence.phase === "compact_manual") {
    assert.equal(initial.contextGeneration, 0);
    await change(win, "#turnInput", COMPACTION_DRAFT, "input");
    await openCompactionControl(win);
    await screenshot(win, tempRoot, "compact-manual-before", evidence);
    await click(win, "#confirmCompactButton");
    await waitFor(win, "lost receipt remains explicitly unknown", "state.pendingSessionCompaction?.status==='unknown' && !state.busy && !document.querySelector('#confirmCompactButton').disabled");
    assert.equal(evidence.compactionModelCalls, 1); assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0);
    assert.equal((await readStatus(win)).activeSave.revision, 24);
    const requestId = evidence.lostCompactionReceipt.request.requestId;
    await screenshot(win, tempRoot, "compact-receipt-unknown", evidence);
    await click(win, "#confirmCompactButton");
    await waitFor(win, "query resolves the committed summary", "state.pendingSessionCompaction?.status==='reduced' && !state.busy && !document.querySelector('#compactDialog').open");
    assert.equal(evidence.compactionReceipts.length, 2);
    assert.equal(evidence.compactionReceipts[1].channel, "grey-crow:read-context-compaction");
    assert.equal(evidence.compactionReceipts[1].request.requestId, requestId);
    assert.equal(evidence.compactionModelCalls, 1);
    const result = evidence.compactionReceipts[1].result;
    assert.equal(result.contextUsage.contextGeneration, 1); assert.equal(result.compaction.before.contextGeneration, 0);
    assert.ok(result.contextUsage.latestEstimate.safetyInputTokens < initial.latestEstimate.safetyInputTokens);
    await assertSettingsMeter(win, result.contextUsage, 24, evidence, "manualCommitted");
    assert.equal(await evaluate(win, "document.querySelector('#turnInput').value"), COMPACTION_DRAFT);
    const after = compactionDatabase(fixture); assert.deepEqual(after.turns, before.turns);
    assert.equal(after.jobs.length, 1); assert.equal(after.jobs[0].status, "committed");
    evidence.requestId = requestId; evidence.storyUnchanged = true; evidence.readOnlyReceiptCalls = 0;
    await screenshot(win, tempRoot, "compact-manual-recovered", evidence);
  } else if (evidence.phase === "compact_restart") {
    assert.equal(initial.contextGeneration, 1); assert.equal(initial.pendingCompaction, null);
    const prior = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "compact_manual.json"), "utf8"));
    assert.equal(initial.latestEstimate.safetyInputTokens, prior.compactionReceipts.at(-1).result.contextUsage.latestEstimate.safetyInputTokens);
    await screenshot(win, tempRoot, "compact-restarted-summary", evidence);
    await submit(win, COMPACTION_MEMORY_INPUT); await waitSettingsRevision(win, fixture.adventureId, 25, COMPACTION_MEMORY_REPLY);
    await waitUntil("fresh recalled story speech", () => evidence.ttsRequests === 1);
    assert.equal(evidence.modelCalls, 1); assert.equal(evidence.compactionModelCalls || 0, 0);
    const after = compactionDatabase(fixture); const state = JSON.parse(after.turns.at(-1).state_json);
    assert.equal(state.commitments["rice-return"].status, "fulfilled");
    assert.equal(state.inventory.some((entry) => entry.ownerId === "lin-an" && entry.itemId === "rice"), false);
    await screenshot(win, tempRoot, "compact-memory-return", evidence);
  } else if (evidence.phase === "compact_auto" || evidence.phase === "compact_timeout") {
    assert.equal(initial.contextGeneration, 0);
    assert.ok(initial.latestEstimate.safetyInputTokens >= initial.policy.autoCompactLimit, "fixture crosses the automatic threshold");
    assert.ok(initial.latestEstimate.safetyInputTokens < initial.policy.emergencyLimit, "fixture remains below the 90% capacity safeguard");
    await submit(win, COMPACTION_ACTION);
    if (evidence.phase === "compact_timeout") {
      await waitFor(win, "automatic failure returns original input", `!state.busy && document.querySelector('#turnInput').value===${JSON.stringify(COMPACTION_ACTION)}`);
      assert.equal(evidence.compactionTimeoutObserved, true); assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0);
      assert.equal((await readStatus(win)).activeSave.revision, 24);
      const after = compactionDatabase(fixture); assert.deepEqual(after.turns, before.turns);
      assert.equal(after.jobs.length, 1); assert.ok(["failed", "interrupted"].includes(after.jobs[0].status));
      evidence.pendingRequestId = after.jobs[0].request_id;
      await screenshot(win, tempRoot, "compact-timeout-input-preserved", evidence);
    } else {
      await waitSettingsRevision(win, fixture.adventureId, 25, COMPACTION_REPLY);
      await waitUntil("fresh auto-compacted story speech", () => evidence.ttsRequests === 1);
      assert.equal(evidence.modelCalls, 1); assert.equal(evidence.compactionModelCalls, 1);
      const after = compactionDatabase(fixture); assert.equal(after.jobs.length, 1); assert.ok(after.jobs[0].owner_action_id);
      assert.equal(after.jobs[0].status, "committed");
      const receipt = evidence.turnReceipts.at(-1); assert.equal(receipt.contextUsage.contextGeneration, 1);
      await assertSettingsMeter(win, receipt.contextUsage, 25, evidence, "autoCommitted");
      await screenshot(win, tempRoot, "compact-auto-action", evidence);
    }
  } else {
    const prior = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "compact_timeout.json"), "utf8"));
    assert.equal(initial.pendingCompaction.requestId, prior.pendingRequestId);
    assert.equal(initial.pendingCompaction.input, COMPACTION_ACTION);
    assert.equal(await evaluate(win, "document.querySelector('#turnInput').value"), COMPACTION_ACTION);
    await openCompactionControl(win);
    await screenshot(win, tempRoot, "compact-timeout-restart-pending", evidence);
    await click(win, "#confirmCompactButton");
    await waitFor(win, "same persistent compaction explicitly retried", "!state.busy && state.pendingSessionCompaction?.status==='reduced'");
    assert.equal(evidence.compactionReceipts[0].request.requestId, prior.pendingRequestId);
    assert.equal(evidence.compactionReceipts[0].request.input, COMPACTION_ACTION);
    assert.equal(evidence.compactionReceipts[0].request.retry, true);
    assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0); assert.equal(evidence.compactionModelCalls, 1);
    assert.equal((await readStatus(win)).activeSave.revision, 24);
    assert.equal(compactionDatabase(fixture).jobs.length, 1);
    await submit(win, COMPACTION_ACTION); await waitSettingsRevision(win, fixture.adventureId, 25, COMPACTION_REPLY);
    await waitUntil("fresh story after explicit compaction retry speech", () => evidence.ttsRequests === 1);
    assert.equal(evidence.modelCalls, 1); assert.equal(evidence.compactionModelCalls, 1);
    await screenshot(win, tempRoot, "compact-retry-then-action", evidence);
  }
  return { ...evidence, adventureId: fixture.adventureId, revision: (await readStatus(win)).activeSave.revision };
}

async function runSettingsCoordinator() {
  const results = [];
  for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
    const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
    for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
    const env = {};
    for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
      XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot,
      GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
      GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
    const fixture = await createSettingsFixture(tempRoot, locale);
    process.stdout.write(`Settings ${locale} artifacts: ${tempRoot}\n`);
    const phases = locale === "zh-CN" ? ["settings_setup", "settings_change", "settings_restore"] : ["settings_locale"];
    const runs = [];
    for (const phase of phases) runs.push(await runPhase(require("electron"), phase, env));
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(fixture.databasePath, { readOnly: true });
    try {
      const expectedRevision = locale === "zh-CN" ? 3 : 2;
      assert.equal(db.prepare("SELECT revision FROM session WHERE singleton=1").get().revision, expectedRevision);
      assert.equal(db.prepare("SELECT count(*) AS count FROM turns WHERE revision>0").get().count, expectedRevision);
      assert.equal(db.prepare("SELECT count(*) AS count FROM turns WHERE narration_json LIKE ?").get(`%${SETTINGS_TEXT[locale].lateReply || "NO_LATE_REPLY"}%`).count, 0);
    } finally { db.close(); }
    const result = { ok: true, locale, tempRoot, phases: runs,
      evidence: "Real Electron Main/preload/renderer, real Session child and SQLite; synthetic provider responses and optional silent WAV audio.",
      limitations: ["No real Provider or spoken voice quality was tested. Narration targets are soft prompt preferences, not measured model quality."] };
    fs.writeFileSync(path.join(tempRoot, "results", "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    results.push(result);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, suite: "settings", results }, null, 2)}\n`);
}

async function runDetailPaginationCoordinator() {
  const results = [];
  for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
    const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
    for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
    const env = {};
    for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
      XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot,
      GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
      GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
    const fixture = await createDetailPaginationFixture(tempRoot, locale);
    process.stdout.write(`Detail pagination ${locale} artifacts: ${tempRoot}\n`);
    const phases = [];
    for (const phase of locale === "zh-CN" ? ["detail_pagination", "detail_pagination_restore"] : ["detail_pagination"]) {
      phases.push(await runPhase(require("electron"), phase, env));
      assert.equal(databaseDigest(fixture.databasePath), fixture.databaseHash, "read-only detail and old action receipts must not rewrite the database");
      const { DatabaseSync } = require("node:sqlite");
      const database = new DatabaseSync(fixture.databasePath, { readOnly: true });
      try {
        const saved = JSON.parse(database.prepare("SELECT state_json FROM turns WHERE revision=?").get(2).state_json);
        assert.equal(saved.entities["lin-an"].attributes.description, fixture.descriptions.characters);
        assert.equal(saved.entities["lin-an"].attributes.relationship, fixture.relationship);
        assert.equal(saved.entities.rice.attributes.description, fixture.descriptions.inventory);
        assert.equal(saved.commitments["detail-promise-25"].due, fixture.due);
      } finally { database.close(); }
      assert.equal(databaseDigest(fixture.databasePath), fixture.databaseHash, "the independent source check must also be read-only");
    }
    const result = { ok: true, locale, tempRoot, revision: 2, phases,
      evidence: "Actual Electron Main/preload/renderer and Session child; two fixture turns committed through the production store, no model generation.",
      limitations: ["Synthetic localized descriptions and obligations at two window sizes; only Chinese also covers a cold restart. Screenshots still require visual review. No real Provider, narrative quality, native-language acceptance, spoken voice or release acceptance is implied."] };
    fs.writeFileSync(path.join(tempRoot, "results", "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    results.push(result);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, suite: "detail-pagination", results }, null, 2)}\n`);
}

async function createDetailPaginationFixture(tempRoot, locale) {
  const fixture = await createSettingsFixture(tempRoot, locale);
  const strings = {
    "zh-CN": { player: "林安", item: "袋装米", fulfilled: "已履行", open: "尚待履行", due: "期限",
      input: "我和陈姨核对借米的约定。", first: "你和陈姨逐一确认，先前二十四次借米都已归还。她又交给你一袋米；这第二十五项归还约定仍待履行，详细期限记在下文。",
      last: "你仍在楼道，带着这一袋米。先前二十四项约定已履行，最后一项仍有效。",
      clause: "应在双方确认的交接时段归还同样一袋米，并按约再次核对日期。", marker: "完整期限末尾核对点",
      characterClause: "林安记得楼道里几扇门的颜色，把能够确认的来往记在本子里。\n",
      itemClause: "米袋的纸签写着借出日期，封口处留着折痕，外侧能看见淡蓝色的印记。\n",
      characterTail: "林安没有答应替陌生人开门，也尚未确认对方的身份。",
      itemTail: "这袋米尚未归还；纸签上的名字可能是旧主人，仍未确认。" },
    "en-US": { player: "Lin An", item: "Bags of rice", fulfilled: "Fulfilled", open: "Open", due: "Due",
      input: "I check the rice agreements with Chen.", first: "You and Chen confirm that all twenty-four earlier rice loans were returned. She hands you one more bag; this twenty-fifth return agreement remains open, with its full due terms below.",
      last: "You remain in the hallway holding one bag of rice. The first twenty-four agreements are fulfilled; the last remains open.",
      clause: "Return the same quantity at the agreed handover time and confirm the date together. ", marker: "END OF THE COMPLETE DUE TERM",
      characterClause: "Lin An remembers the colors of several hallway doors and writes only confirmed visits in a notebook.\n",
      itemClause: "The paper label carries a lending date. There is a fold at the sealed edge and a pale blue mark outside.\n",
      characterTail: "Lin An has not agreed to open the door for the stranger, whose identity remains unconfirmed.",
      itemTail: "This bag has not been returned; the name on its label may belong to an earlier owner and is still unconfirmed." },
    "ja-JP": { player: "林安", item: "袋入りの米", fulfilled: "履行済み", open: "未履行", due: "期限",
      input: "陳さんと米を返す約束を確認する。", first: "あなたと陳さんは、以前の二十四件の米がすべて返されたことを確認する。新たに一袋を受け取った。二十五件目の返却はまだで、詳しい期限は次に記してある。",
      last: "あなたは米を一袋持って廊下にいる。以前の二十四件は履行済みで、最後の約束は今も有効だ。",
      clause: "互いに確認した受け渡しの時間に同じ一袋の米を返し、日付をもう一度確かめる。", marker: "期限全文の末尾確認点",
      characterClause: "林安は廊下にある数枚の扉の色を覚えており、確認できた往来だけを手帳に記している。\n",
      itemClause: "米袋の紙札には貸出日が書かれ、封じ目には折り跡があり、外側には薄い青色の印が見える。\n",
      characterTail: "林安は見知らぬ相手のために扉を開けるとは約束しておらず、その身元もまだ確認していない。",
      itemTail: "この米袋はまだ返していない。紙札の名前は以前の持ち主のものかもしれず、未確認である。" },
  }[locale];
  const due = strings.clause.repeat(200).slice(0, 4000 - strings.marker.length) + strings.marker;
  assert.equal(due.length, 4000);
  // More than 24 maximum-sized pieces ensures that the description itself
  // crosses a page, independently of the 25 existing commitment records.
  const descriptions = Object.fromEntries([
    ["characters", strings.characterClause, strings.characterTail], ["inventory", strings.itemClause, strings.itemTail],
  ].map(([kind, clause, tail]) => [kind, clause.repeat(Math.ceil(145000 / clause.length)) + tail]));
  for (const text of Object.values(descriptions)) assert.ok(text.length > 144000 && text.length < 150000);
  const relationship = strings.characterClause.repeat(Math.ceil((locale === "en-US" ? 1000 : 400) / strings.characterClause.length)) + strings.characterTail;
  assert.ok(relationship.length > (locale === "en-US" ? 600 : 240) && relationship.length <= 2000);
  const gameRoot = path.resolve(__dirname, "../../../..");
  const { readContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-reader"));
  const { createTurnStore } = require(path.join(gameRoot, "engine/session/turn-store"));
  const snapshot = await readContentSnapshot({ adventuresRoot: path.join(tempRoot, "data", "saves"), adventureId: fixture.adventureId });
  const store = createTurnStore({ ...fixture, contentVersion: snapshot.lock.overallHash });
  const requests = [1, 2].map((revision) => ({ actionId: `detail-action-${revision}`, baseRevision: revision - 1,
    input: strings.input, locale, contentVersion: snapshot.lock.overallHash }));
  try {
    const source = "detail-agreements";
    const events = [];
    for (let index = 1; index <= 25; index += 1) {
      const id = `detail-promise-${String(index).padStart(2, "0")}`;
      events.push({ id: `create-${id}`, type: "commitment.create", sourceSegmentIds: [source], data: { commitment: {
        id, debtorId: "lin-an", creditorId: "chen", itemId: "rice", quantity: 1,
        due: index === 25 ? due : `${strings.due} ${index}`, status: "open" } } });
      if (index < 25) events.push({ id: `fulfill-${id}`, type: "commitment.resolve", sourceSegmentIds: [source], data: { id, status: "fulfilled" } });
    }
    events.push({ id: "detail-new-bag", type: "inventory.transfer", sourceSegmentIds: [source], data: { fromId: "chen", toId: "lin-an", itemId: "rice", quantity: 1 } });
    for (const [id, kind] of [["lin-an", "characters"], ["rice", "inventory"]]) events.push({
      id: `detail-description-${id}`, type: "entity.update", sourceSegmentIds: [source], data: { id,
        attributes: { description: descriptions[kind], ...(kind === "characters" ? { relationship } : {}) } },
    });
    for (const [index, request] of requests.entries()) {
      const action = store.beginAction(request);
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
        bundle: index === 0 ? bundle(source, `${strings.first}\n${due}\n${strings.characterTail}\n${strings.itemTail}`, events) : bundle("detail-unchanged", strings.last) });
    }
    const view = store.readView({ revision: 2 });
    assert.equal(Object.values(view.state.commitments).filter((entry) => entry.status === "fulfilled").length, 24);
    assert.equal(view.state.commitments["detail-promise-25"].status, "open");
    assert.equal(view.state.commitments["detail-promise-25"].due, due);
    assert.equal(view.state.inventory.find((entry) => entry.ownerId === "lin-an" && entry.itemId === "rice").quantity, 1);
    assert.equal(view.state.entities["lin-an"].attributes.description, descriptions.characters);
    assert.equal(view.state.entities["lin-an"].attributes.relationship, relationship);
    assert.equal(view.state.entities.rice.attributes.description, descriptions.inventory);
  } finally { store.close(); }
  Object.assign(fixture, { strings, due, descriptions, relationship, requests, databaseHash: databaseDigest(fixture.databasePath) });
  fs.writeFileSync(path.join(tempRoot, "results", "detail-pagination-fixture.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

async function runDetailPaginationPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "detail-pagination-fixture.json"), "utf8"));
  const { locale, strings } = fixture;
  if (evidence.phase === "detail_pagination") {
    await click(win, "#menuLanguageToggle");
    await click(win, { "zh-CN": "#mainMenuLocaleZh", "en-US": "#mainMenuLocaleEn", "ja-JP": "#mainMenuLocaleJa" }[locale]);
    await waitFor(win, "detail locale settled", `document.documentElement.lang === ${JSON.stringify(locale)} && document.querySelector('#localeTransitionCurtain').dataset.phase === 'idle'`);
    await connectSyntheticModel(win);
    await click(win, "#settingsTabDisplay");
    assert.equal(await evaluate(win, "state.gameUiLayout"), "story-notebook-v1");
    await click(win, "#settingsTabAudio"); await change(win, "#ttsReadingModeSelect", "manual");
    await click(win, "#saveSettingsButton");
    await waitFor(win, "detail settings persisted", `!state.settingsSaving && !state.settingsDirty`);
    await click(win, "#closeSettingsButton");
  } else if (!(await readStatus(win)).keyVerified) {
    await connectSyntheticModel(win); await click(win, "#closeSettingsButton");
  }
  await click(win, "#continueGameButton");
  await waitSettingsRevision(win, fixture.adventureId, 2, strings.last);
  assert.equal(await evaluate(win, "document.documentElement.lang"), locale);
  evidence.detailPages = [];
  evidence.detailListChecks = [];
  const body = "#storyNotebookDrawerBody";
  const disclosure = `${body} details.story-notebook-detail-text[data-detail-reading-key="section:attribute_text"]`;
  const historyDisclosure = `${body} details.story-notebook-detail-text[data-detail-reading-key="section:commitments_history"]`;
  const more = `${body} > .story-notebook-panel-load-more`;
  const records = `Array.from(document.querySelectorAll('${body} .story-notebook-panel-detail-record'))`;
  const readRecords = `${records}.map(node => ({ id:node.dataset.detailRecordId,label:node.querySelector('.story-notebook-detail-record-label').textContent,
    heading:node.querySelector('.story-notebook-commitment-heading')?.textContent ?? null,
    text:node.querySelector('.story-notebook-detail-record-text').textContent,
    section:node.closest('[data-detail-section-id]').dataset.detailSectionId }))`;
  for (const [width, height] of [[1280, 720], [1260, 820]]) {
    win.setAspectRatio(0); win.setContentSize(width, height, false); win.center();
    await waitFor(win, "detail reading viewport", `innerWidth === ${width} && innerHeight === ${height}`);
    for (const kind of ["characters", "inventory"]) {
      if (kind === "characters") await click(win, "#storyNotebookCharactersButton");
      else {
        await click(win, "#storyNotebookModulesButton");
        await waitFor(win, "detail inventory card", `Boolean(document.querySelector('[data-panel-ref="session_inventory"]'))`);
        await click(win, '[data-panel-ref="session_inventory"]');
        await waitFor(win, "detail inventory list entry", `Boolean(document.querySelector('.story-notebook-panel-list-action[data-field-id="inventory"]'))`);
        await click(win, '.story-notebook-panel-list-action[data-field-id="inventory"]');
      }
      const name = kind === "characters" ? strings.player : strings.item;
      await waitFor(win, "detail list item", `Array.from(document.querySelectorAll('.story-notebook-panel-record')).some(node => node.querySelector('strong')?.textContent === ${JSON.stringify(name)})`);
      const itemRef = await evaluate(win, `Array.from(document.querySelectorAll('.story-notebook-panel-record')).find(node => node.querySelector('strong')?.textContent === ${JSON.stringify(name)}).dataset.itemRef`);
      const listed = await evaluate(win, `(() => {const node=document.querySelector('.story-notebook-panel-record[data-item-ref="${itemRef}"]');
        node.scrollIntoView({block:'nearest',behavior:'instant'});const rect=node.getBoundingClientRect(),bounds=document.querySelector('${body}').getBoundingClientRect();
        return {subtitle:node.querySelector('span').textContent,metadata:node.querySelector('small')?.textContent ?? null,
          visible:node.checkVisibility()&&rect.height>0&&rect.top>=Math.max(0,bounds.top)&&rect.bottom<=Math.min(innerHeight,bounds.bottom)};})()`);
      assert.equal(listed.visible, true);
      assert.equal(listed.subtitle, { "zh-CN":"查看完整详情", "en-US":"View full details", "ja-JP":"詳細をすべて見る" }[locale],
        "a long description with a final denial must offer the full detail, not display a severed factual prefix");
      if (kind === "characters") {
        assert.ok(fixture.relationship.endsWith(strings.characterTail));
        assert.equal(listed.metadata, null, "do not turn the long relationship into a list assertion by dropping its final denial and uncertainty");
        if (locale === "zh-CN") assert.equal(await evaluate(win, `Array.from(document.querySelectorAll('.story-notebook-panel-record')).find(node=>node.querySelector('strong')?.textContent==='陈姨').querySelector('small').textContent`), "邻居",
          "short relationship metadata remains visible");
      } else assert.equal(listed.metadata, `${{ "zh-CN":"数量", "en-US":"Quantity", "ja-JP":"数量" }[locale]}: 1`, "short inventory quantity remains visible");
      evidence.detailListChecks.push({kind,width,height,...listed});
      if (locale === "zh-CN" && width === 1280 && kind === "characters") await screenshot(win, tempRoot, `${evidence.phase}-${locale}-${width}-characters-directory`, evidence);
      await click(win, `.story-notebook-panel-record[data-item-ref="${itemRef}"]`);
      await waitFor(win, "first bounded detail page", `${records}.length > 0 && Boolean(document.querySelector('${more}')) && !state.skillPanelRefreshBusy`);
      const first = await evaluate(win, readRecords);
      assert.ok(first.length <= 24 && first.every(entry => entry.text.length <= 6000));
      const initialPage = evidence.detailResponses.at(-1);
      const metadata = Object.fromEntries(initialPage.attributeFields.map(field => [field.id, field.value]));
      assert.deepEqual(initialPage.sectionFields.map(section => section.id), ["commitments_open", "identity", "attribute_text", "commitments_history"]);
      const sectionCount = id => initialPage.sectionFields.find(section => section.id === id).fields.find(field => field.id === "record_count").value;
      assert.equal(sectionCount("commitments_open"), 1); assert.equal(sectionCount("commitments_history"), 24);
      const firstOpen = first.filter(entry => entry.section === "commitments_open");
      const firstHistory = first.filter(entry => entry.section === "commitments_history");
      const firstText = first.filter(entry => entry.section === "attribute_text");
      assert.equal(firstOpen.length, 1); assert.ok(firstHistory.length > 0 && firstText.length > 0);
      const current = firstOpen[0];
      const creditor = { "zh-CN":"陈姨", "en-US":"Chen", "ja-JP":"陳さん" }[locale];
      const expectedHeading = `${strings.player} → ${creditor} · ${strings.item} × 1`;
      assert.equal(current.heading, expectedHeading); assert.equal(current.label, strings.open);
      assert.equal(current.text, `${strings.due}: ${fixture.due}`);
      const currentSelector = `${body} [data-detail-record-id="${current.id}"]`;
      const termsDisclosure = `${currentSelector} details[data-detail-reading-key="terms:${current.id}"]`;
      // Read the untouched first viewport. Scrolling to this card would hide
      // the exact regression this check is meant to detect.
      const firstViewport = await evaluate(win, `(() => {const drawer=document.querySelector('${body}'),bounds=drawer.getBoundingClientRect();
        const nodes=['${currentSelector} .story-notebook-detail-record-label','${currentSelector} .story-notebook-commitment-heading','${termsDisclosure} > summary'];
        return {scrollTop:drawer.scrollTop,items:nodes.map(selector=>{const node=document.querySelector(selector),rect=node.getBoundingClientRect();
          return {selector,text:node.textContent,visible:node.checkVisibility()&&rect.width>0&&rect.height>0
            &&rect.top>=Math.max(0,bounds.top)&&rect.bottom<=Math.min(innerHeight,bounds.bottom)
            &&rect.left>=Math.max(0,bounds.left)&&rect.right<=Math.min(innerWidth,bounds.right)};})};})()`);
      assert.ok(firstViewport.scrollTop <= 1, "a newly opened detail starts at its first viewport");
      assert.ok(firstViewport.items.every(item => item.visible), `current agreement must be identifiable without scrolling: ${JSON.stringify(firstViewport)}`);
      assert.equal(await evaluate(win, `document.querySelector('${termsDisclosure}').open`), false);
      assert.equal(await evaluate(win, `document.querySelector('${currentSelector} .story-notebook-detail-record-text').checkVisibility()`), false);
      assert.equal(await evaluate(win, `document.querySelector('${historyDisclosure}').open`), false);
      assert.equal(await evaluate(win, `Array.from(document.querySelectorAll('${historyDisclosure} .story-notebook-detail-record-text')).every(node=>!node.checkVisibility())`), true);
      const historySummary = await evaluate(win, `document.querySelector('${historyDisclosure} > summary').textContent`);
      assert.ok(historySummary.includes(String(firstHistory.length)) && historySummary.includes("24"), historySummary);
      assert.ok(metadata.record_count > 24, "the attribute itself must span pages, independently of obligations");
      assert.equal(metadata.character_count, fixture.descriptions[kind].length);
      assert.equal(initialPage.pagination.totalItems, metadata.record_count + 25);
      assert.ok(firstText.length < metadata.record_count);
      assert.equal(await evaluate(win, `document.querySelector('${disclosure}').open`), false);
      assert.equal(await evaluate(win, `document.querySelector('${disclosure} p').checkVisibility()`), false);
      assert.equal(await evaluate(win, `document.querySelector('${body} .story-notebook-detail-incomplete').checkVisibility()`), true);
      const summary = await evaluate(win, `document.querySelector('${disclosure} > summary').textContent`);
      assert.ok(summary.includes(String(firstText.length)) && summary.includes(String(metadata.record_count)), summary);
      const shortField = `${body} [data-detail-reading-key="field:identity:${kind === "characters" ? "status" : "quantity"}"]`;
      const shortState = await evaluate(win, `(() => {const field=document.querySelector('${shortField}');return {
        visible:field?.checkVisibility(),disclosure:field?.tagName==='DETAILS',text:field?.textContent};})()`);
      assert.equal(shortState.visible, true); assert.equal(shortState.disclosure, false);
      assert.ok(shortState.text.includes(kind === "characters" ? ({ "zh-CN":"清醒", "en-US":"Awake", "ja-JP":"意識は明瞭" }[locale]) : "1"));
      const relationshipDisclosure = `${body} details[data-detail-reading-key="field:identity:relationship"]`;
      if (kind === "characters") {
        assert.equal(await evaluate(win, `document.querySelector('${relationshipDisclosure}').open`), false);
        assert.equal(await evaluate(win, `document.querySelector('${relationshipDisclosure} p').checkVisibility()`), false);
      }
      await screenshot(win, tempRoot, `${evidence.phase}-${locale}-${width}-${kind}-collapsed`, evidence);
      const readsBeforeExpand = evidence.detailResponses.length;
      await click(win, `${termsDisclosure} > summary`);
      await waitFor(win, "complete current agreement terms expanded", `document.querySelector('${termsDisclosure}').open && document.querySelector('${currentSelector} .story-notebook-detail-record-text').checkVisibility()`);
      assert.equal(await evaluate(win, `document.querySelector('${currentSelector} .story-notebook-detail-record-text').textContent`), `${strings.due}: ${fixture.due}`);
      if (kind === "characters") {
        await click(win, `${relationshipDisclosure} > summary`);
        await waitFor(win, "ordinary long field expanded", `document.querySelector('${relationshipDisclosure}').open && document.querySelector('${relationshipDisclosure} p').checkVisibility()`);
        assert.equal(await evaluate(win, `document.querySelector('${relationshipDisclosure} p').textContent`), fixture.relationship);
        assert.equal(evidence.detailResponses.length, readsBeforeExpand, "ordinary field expansion is local presentation only");
      }
      const keyboard = evidence.phase === "detail_pagination_restore" && width === 1280 && kind === "characters";
      if (width === 1280 && keyboard) {
        win.show(); win.focus(); win.webContents.focus();
        await evaluate(win, `document.querySelector('${historyDisclosure} > summary').focus()`);
        await waitFor(win, "history summary receives native keyboard focus", `document.hasFocus() && document.activeElement === document.querySelector('${historyDisclosure} > summary')`);
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
        win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      } else if (width === 1280) await click(win, `${historyDisclosure} > summary`);
      if (width === 1280) await waitFor(win, "history explicitly expanded", `document.querySelector('${historyDisclosure}').open`);
      await click(win, `${disclosure} > summary`);
      await waitFor(win, "detail text expanded", `document.querySelector('${disclosure}').open && document.querySelector('${disclosure} p').checkVisibility()`);
      assert.equal(evidence.detailResponses.length, readsBeforeExpand, "native expansion must not trigger a new panel read");
      await screenshot(win, tempRoot, `${evidence.phase}-${locale}-${width}-${kind}-expanded`, evidence);

      // Refresh an existing first-page passage while the full text is open.
      // The refresh button is outside the body; it must retain keyboard focus.
      const anchor = `${disclosure} .story-notebook-panel-detail-record`;
      await evaluate(win, `document.querySelector('${anchor}').scrollIntoView({block:'start',behavior:'instant'})`);
      const beforeRefresh = await evaluate(win, `document.querySelector('${anchor}').getBoundingClientRect().top`);
      await evaluate(win, "document.querySelector('#storyNotebookDrawerRefreshButton').focus({preventScroll:true})");
      const readsBeforeRefresh = evidence.detailResponses.length;
      await click(win, "#storyNotebookDrawerRefreshButton");
      await waitUntil("fresh detail response", () => evidence.detailResponses.length > readsBeforeRefresh);
      await waitFor(win, "refreshed open detail", `!state.skillPanelRefreshBusy && document.querySelector('${disclosure}')?.open && ${records}.length === ${first.length}`);
      assert.deepEqual(await evaluate(win, readRecords), first, "refresh keeps first-page text and identities intact");
      if (kind === "characters") assert.equal(await evaluate(win, `document.querySelector('${relationshipDisclosure}').open`), true);
      assert.equal(await evaluate(win, `document.querySelector('${termsDisclosure}').open`), true);
      assert.equal(await evaluate(win, `document.querySelector('${historyDisclosure}').open`), width === 1280);
      const afterRefresh = await evaluate(win, `document.querySelector('${anchor}').getBoundingClientRect().top`);
      assert.ok(Math.abs(afterRefresh - beforeRefresh) < 4, `refresh reading position: ${beforeRefresh} -> ${afterRefresh}`);
      assert.equal(await evaluate(win, "document.activeElement.id"), "storyNotebookDrawerRefreshButton");
      const paginationStart = evidence.detailResponses.length - 1;
      // The second size also covers loading an attribute page while disclosure
      // is closed: keyboard focus must go to its visible summary, not hidden prose.
      if (width === 1260) await click(win, `${disclosure} > summary`);
      let complete = first;
      const focusChecks = [];
      for (let page = 0; await evaluate(win, `Boolean(document.querySelector('${more}'))`); page += 1) {
        assert.ok(page < 64, "bounded detail pagination must make progress");
        const previous = complete;
        const wasOpen = await evaluate(win, `document.querySelector('${disclosure}').open`);
        const historyWasOpen = await evaluate(win, `document.querySelector('${historyDisclosure}').open`);
        await click(win, more);
        await waitFor(win, "detail page appended", `${records}.length > ${previous.length} && !state.skillPanelRefreshBusy`);
        complete = await evaluate(win, readRecords);
        for (const section of ["commitments_open", "attribute_text", "commitments_history"]) {
          const priorRecords = previous.filter(entry => entry.section === section);
          assert.deepEqual(complete.filter(entry => entry.section === section).slice(0, priorRecords.length), priorRecords,
            `appending keeps the earlier ${section} records verbatim and in group order`);
        }
        assert.equal(new Set(complete.map(entry => entry.id)).size, complete.length);
        assert.equal(await evaluate(win, `document.querySelector('${disclosure}').open`), wasOpen);
        assert.equal(await evaluate(win, `document.querySelector('${historyDisclosure}').open`), historyWasOpen);
        assert.equal(await evaluate(win, `document.querySelector('${termsDisclosure}').open`), true);
        const priorIds = new Set(previous.map(entry => entry.id));
        const added = complete.find(entry => !priorIds.has(entry.id));
        const focused = await evaluate(win, `({id:document.activeElement.dataset.detailRecordId || null,
          summary:document.activeElement === document.querySelector('${disclosure} > summary'),
          historySummary:document.activeElement === document.querySelector('${historyDisclosure} > summary'),visible:document.activeElement.checkVisibility()})`);
        if (added.section === "attribute_text" && !wasOpen) assert.equal(focused.summary, true, "closed text must focus its visible summary");
        else if (added.section === "commitments_history" && !historyWasOpen) assert.equal(focused.historySummary, true, "closed history must focus its visible summary");
        else assert.equal(focused.id, added.id, "opened text or obligations focus the first appended record");
        assert.equal(focused.visible, true);
        focusChecks.push({ page: page + 1, wasOpen, historyWasOpen, firstAddedId: added.id, focused });
        if (!wasOpen) {
          const reads = evidence.detailResponses.length;
          await click(win, `${disclosure} > summary`);
          await waitFor(win, "appended detail text expanded", `document.querySelector('${disclosure}').open`);
          assert.equal(evidence.detailResponses.length, reads);
        }
      }
      const attributeRecords = complete.filter(entry => entry.section === "attribute_text");
      assert.equal(attributeRecords.length, metadata.record_count);
      assert.equal(attributeRecords.map(entry => entry.text).join(""), fixture.descriptions[kind], "all source characters, including final qualifications, must survive paging");
      assert.ok(attributeRecords.every(entry => entry.text.length > 0 && entry.text.length <= 6000));
      assert.equal(await evaluate(win, `document.querySelector('${body} .story-notebook-detail-incomplete') === null`), true);
      const obligations = complete.filter(entry => entry.section === "commitments_open" || entry.section === "commitments_history");
      assert.equal(obligations.length, 25);
      assert.deepEqual(obligations.filter(entry => entry.section === "commitments_open"), [current], "the current agreement stays unique and unchanged through all pages");
      const historyRecords = obligations.filter(entry => entry.section === "commitments_history");
      assert.equal(historyRecords.length, 24);
      for (const [index, record] of historyRecords.entries()) {
        assert.equal(record.label, strings.fulfilled); assert.equal(record.heading, expectedHeading);
        assert.equal(record.text, `${strings.due}: ${strings.due} ${index + 1}`);
      }
      if (width === 1260) {
        assert.equal(await evaluate(win, `document.querySelector('${historyDisclosure}').open`), false);
        assert.equal(await evaluate(win, `Array.from(document.querySelectorAll('${historyDisclosure} .story-notebook-detail-record-text')).every(node=>!node.checkVisibility())`), true);
        const reads = evidence.detailResponses.length;
        await click(win, `${historyDisclosure} > summary`);
        await waitFor(win, "complete history explicitly expanded", `document.querySelector('${historyDisclosure}').open`);
        assert.equal(evidence.detailResponses.length, reads);
      }
      assert.equal(await evaluate(win, `Array.from(document.querySelectorAll('${historyDisclosure} .story-notebook-detail-record-text')).every(node=>node.checkVisibility())`), true);
      const tail = kind === "characters" ? strings.characterTail : strings.itemTail;
      const layouts = [];
      const tailChecks = [["description-tail", `${body} [data-detail-record-id="${attributeRecords.at(-1).id}"] .story-notebook-detail-record-text`, tail],
        ["due-tail", `${currentSelector} .story-notebook-detail-record-text`, strings.marker],
        ["history-last", `${body} [data-detail-record-id="${historyRecords.at(-1).id}"] .story-notebook-detail-record-text`, `${strings.due}: ${strings.due} 24`]];
      if (kind === "characters") tailChecks.push(["ordinary-field-tail", `${relationshipDisclosure} p`, strings.characterTail]);
      for (const [label, selector, expectedTail] of tailChecks) {
        await evaluate(win, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'end',behavior:'instant'})`);
        const layout = await evaluate(win, `(() => { const p=document.querySelector(${JSON.stringify(selector)}), tail=${JSON.stringify(expectedTail)};
          const range=document.createRange(),start=p.textContent.lastIndexOf(tail);
          if(start<0 || !p.firstChild || p.firstChild.nodeType!==Node.TEXT_NODE) throw new Error('Missing complete qualification');
          range.setStart(p.firstChild,start);range.setEnd(p.firstChild,start+tail.length);
          const drawer=document.querySelector('${body}'),bounds=drawer.getBoundingClientRect(),rects=Array.from(range.getClientRects());
          return {width:innerWidth,height:innerHeight,visible:p.checkVisibility(),tail,rectCount:rects.length,
            noHorizontalClip:p.scrollWidth<=p.clientWidth+1 && drawer.scrollWidth<=drawer.clientWidth+1,
            completeTailVisible:rects.length>0 && rects.every(rect=>rect.width>0&&rect.height>0
              && rect.top>=Math.max(0,bounds.top)&&rect.bottom<=Math.min(innerHeight,bounds.bottom)
              && rect.left>=Math.max(0,bounds.left)&&rect.right<=Math.min(innerWidth,bounds.right))}; })()`);
        assert.equal(layout.visible, true); assert.equal(layout.noHorizontalClip, true); assert.equal(layout.completeTailVisible, true);
        await screenshot(win, tempRoot, `${evidence.phase}-${locale}-${width}-${kind}-${label}`, evidence);
        layouts.push({ label, ...layout });
      }
      const pages = evidence.detailResponses.slice(paginationStart);
      assert.ok(pages.length >= 2);
      for (const [index, entry] of pages.entries()) {
        assert.equal(entry.request.fieldId, kind); assert.equal(entry.request.itemRef, itemRef);
        assert.equal(entry.pagination.totalItems, metadata.record_count + 25);
        assert.deepEqual(entry.attributeFields, initialPage.attributeFields, "attribute totals remain stable across pages");
        assert.deepEqual(entry.sectionFields, initialPage.sectionFields, "current and historical totals stay fixed across pages");
        assert.ok(entry.pagination.returnedItems > 0 && entry.pagination.returnedItems <= 24);
        if (index > 0) assert.equal(pages[index - 1].pagination.nextCursor, entry.request.cursor);
      }
      assert.equal(pages.at(-1).pagination.nextCursor, null);
      assert.equal(pages.reduce((sum, entry) => sum + entry.pagination.returnedItems, 0), complete.length);
      evidence.detailPages.push({ kind, itemRef, width, height, keyboard, firstCount:first.length, finalCount:complete.length,
        metadata, sourceCharacters:fixture.descriptions[kind].length, refreshOffset:afterRefresh-beforeRefresh, focusChecks, layouts,
        firstViewport, currentAgreement:current, firstHistoryCount:firstHistory.length, historicalCount:historyRecords.length,
        shortState, ordinaryFieldCharacters:kind === "characters" ? fixture.relationship.length : null,
        obligationCount:obligations.length, openObligationId:current.id, pages:pages.map(entry=>entry.pagination) });
      await closeNotebookDrawer(win);
    }
  }
  const receipts = await evaluate(win, `(async () => { const s=await window.greyCrow.getStatus(); const request=${JSON.stringify(fixture.requests[0])};
    const binding={adventureId:s.activeSaveId,sessionId:s.runtimeSessionId,baseRevision:0};
    const duplicate=await window.greyCrow.runTurn(request.input,{...binding,actionId:request.actionId});
    const conflict=await window.greyCrow.runTurn(request.input,{...binding,actionId:'detail-stale-new-action'});
    return {duplicate,conflict,current:await window.greyCrow.getStatus()}; })()`);
  assert.equal(receipts.duplicate.ok, true); assert.equal(receipts.duplicate.actionResult.status, "committed");
  assert.equal(receipts.duplicate.actionResult.actionId, fixture.requests[0].actionId);
  assert.equal(receipts.duplicate.actionResult.revision, 1); assert.equal(receipts.duplicate.actionResult.generationPasses, 0);
  assert.equal(receipts.duplicate.projection, null); assert.equal(receipts.duplicate.envelope, undefined);
  assert.equal(receipts.conflict.ok, false); assert.equal(receipts.conflict.error.code, "REVISION_CONFLICT");
  for (const result of [receipts.duplicate, receipts.conflict]) {
    assert.equal(result.save.revision, 2); assert.equal(result.status.activeSave.revision, 2);
    assert.equal(result.derivedWork, null);
  }
  assert.equal(receipts.current.activeSave.revision, 2);
  evidence.oldActionReceipts = { duplicate: receipts.duplicate.actionResult, conflict: receipts.conflict.actionResult, currentRevision: 2 };
  for (const key of ["modelCalls", "chapterModelCalls", "ttsRequests", "audioGenerations"]) assert.equal(evidence[key], 0, key);
  assert.ok(evidence.detailResponses.length >= 16);
  for (const response of evidence.detailResponses) {
    assert.equal(response.revision, 2); assert.equal(response.adventureId, fixture.adventureId);
    assert.ok(response.projectionCharacters <= 128000 && response.projectionBytes <= 384000,
      "the bounded session projection, before Main adds desktop status, must fit its contract");
    assert.ok(response.characters >= response.projectionCharacters && response.bytes >= response.projectionBytes);
    assert.equal(response.statusAdventureId, fixture.adventureId); assert.equal(response.statusRevision, 2);
  }
  return { ...evidence, locale, adventureId: fixture.adventureId, revision: 2, viewport: await viewport(win) };
}

async function createSettingsFixture(tempRoot, locale) {
  const gameRoot = path.resolve(__dirname, "../../../..");
  const { loadBuiltInContentPack } = require(path.join(gameRoot, "engine/content-v2/built-in-pack"));
  const { compileContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-compiler"));
  const { readContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-reader"));
  const { createTurnStore } = require(path.join(gameRoot, "engine/session/turn-store"));
  const contentRoot = path.join(gameRoot, "content");
  const adventuresRoot = path.join(tempRoot, "data", "saves");
  fs.mkdirSync(adventuresRoot, { recursive: true });
  const adventureId = `settings-${locale.toLowerCase()}`;
  const pack = await loadBuiltInContentPack({ contentRoot });
  await compileContentSnapshot({ adventuresRoot, adventureId, language: locale, plan: pack.defaultPlan,
    requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"],
    resolvePackRoot: (packId) => path.join(contentRoot, "packs", packId) });
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId });
  const state = readyState();
  if (locale !== "zh-CN") {
    const names = locale === "en-US" ? ["Lin An", "Chen", "The hallway outside Chen's door", "Bags of rice"] : ["林安", "陳さん", "陳さんの戸口の廊下", "袋入りの米"];
    for (const [index, id] of ["lin-an", "chen", "hallway", "rice"].entries()) state.entities[id].name = names[index];
    state.entities["lin-an"].attributes = locale === "en-US" ? { occupation: "Community volunteer", keepsake: "A memory of my mother", status: "Awake" }
      : { occupation: "地域のボランティア", keepsake: "母の記憶", status: "意識は明瞭" };
    state.entities.chen.attributes = {};
  }
  const databasePath = path.join(adventuresRoot, adventureId, "session.sqlite");
  const store = createTurnStore({ databasePath, adventureId, locale, contentVersion: snapshot.lock.overallHash, initialState: state });
  store.close();
  const fixture = { adventureId, databasePath, locale };
  fs.writeFileSync(path.join(tempRoot, "results", "settings-fixture.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

async function generateSettingsFixture(request, evidence, tempRoot) {
  assert.ok(!["settings_restore", "settings_controls", "settings_controls_roundtrip"].includes(evidence.phase), "read-only restart/settings verification must not call the model");
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "settings-fixture.json"), "utf8"));
  const strings = SETTINGS_TEXT[fixture.locale];
  const json = request.messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } });
  assert.equal(json.some((value) => value?.task), false, "settings do not generate chapters");
  const fixed = json.find((value) => value?.canonicalState);
  assert.ok(fixed); assert.equal(fixed.locale, fixture.locale);
  const input = request.messages.find((message) => message.content?.startsWith("Current player action:\n"))?.content.slice("Current player action:\n".length);
  const match = request.messages[0].content.match(/PLAYER NARRATION PREFERENCE: (\{[^\n]+?\})/);
  assert.ok(match, "the actual provider system message must carry the player's narration preference");
  const preference = JSON.parse(match[1]);
  const expected = input === strings.short ? { lengthPreset: "short", targetCharacters: 200 }
    : { lengthPreset: "custom", targetCharacters: 360 };
  assert.deepEqual(preference, { ...expected, unit: "characters", scope: "player_narration_only" });
  assert.match(request.messages[0].content, /soft prose preference/);
  evidence.modelCalls++;
  const toolOutputs = request.messages.filter((message) => message.role === "tool");
  evidence.modelInputs.push({ locale: fixed.locale, revision: fixed.baseRevision, input, preference, toolOutputs: toolOutputs.length });
  const response = (generated, usage) => ({ text: JSON.stringify(generated), toolCalls: [], usage, model: "synthetic-local", finishReason: "stop" });
  if (input === strings.late) {
    assert.equal(evidence.phase, "settings_change"); assert.equal(fixed.baseRevision, 2);
    request.signal.addEventListener("abort", () => { evidence.lateProviderAborted = true; }, { once: true });
    return new Promise((resolve) => settingsPendingResponses.set(tempRoot, () => {
      evidence.lateProviderReleased = true;
      resolve(response(bundle("settings-late", strings.lateReply), { input_tokens: 120000, output_tokens: 90 }));
    }));
  }
  if (input === strings.tools) {
    assert.equal(fixed.baseRevision, 2);
    if (toolOutputs.length === 0) return { text: "", toolCalls: [{ id: "settings-read-chen", name: "read_entity", arguments: '{"entityId":"chen"}' }],
      transportState: { protocolFamily: "openai-chat", reasoningContent: "synthetic continuation token" },
      usage: { input_tokens: 9000, output_tokens: 70 }, model: "synthetic-local", finishReason: "tool_calls" };
    assert.equal(toolOutputs.length, 1); assert.equal(toolOutputs[0].toolCallId, "settings-read-chen");
    assert.equal(JSON.parse(toolOutputs[0].content).entity.name, "陈姨");
    return response(bundle("settings-tools", strings.replies[2]), { input_tokens: 11000, output_tokens: 90 });
  }
  const index = input === strings.short ? 0 : input === strings.custom ? 1 : -1;
  assert.ok(index >= 0); assert.equal(fixed.baseRevision, index);
  return response(bundle(`settings-${index + 1}`, strings.replies[index]), { input_tokens: 120, output_tokens: 90 });
}

function readLocalFinale(tempRoot, adventureId) {
  // Inspect only this script's synthetic database after Electron has exited.
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(tempRoot, "data", "saves", adventureId, "session.sqlite"), { readOnly: true });
  try {
    return { revision: db.prepare("SELECT max(revision) AS revision FROM turns").get().revision,
      archive: { ...db.prepare("SELECT finale_id,candidate_id,confirmation_revision,confirmation_action_id,status,chapter_id,closed_at FROM finale_archives").get() },
      chapter: { ...db.prepare("SELECT status,error_code FROM chapter_jobs WHERE chapter_id='chapter-8'").get() },
      chapterCount: db.prepare("SELECT count(*) AS count FROM chapters").get().count };
  } finally { db.close(); }
}

function databaseDigest(databasePath) {
  return require("node:crypto").createHash("sha256").update(fs.readFileSync(databasePath)).digest("hex");
}

function fileEvidence(filePath) {
  const stat = fs.statSync(filePath);
  return { digest: databaseDigest(filePath), size: stat.size, mode: stat.mode, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
}

async function runContinuationCoordinator({ loseReceipt = false } = {}) {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
    XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot,
    GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
    GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
  if (loseReceipt) env.GREY_CROW_CONTINUATION_CHECK_LOST_RECEIPT = "1";
  const fixture = await createContinuationFixture(tempRoot);
  process.stdout.write(`Continuation artifacts: ${tempRoot}\n`);
  const created = await runPhase(require("electron"), "continuation_create", env);
  assert.equal(created.revision, 46); assert.equal(created.modelCalls, 0); assert.equal(created.chapterModelCalls, 0); assert.equal(created.ttsRequests, 0);
  assert.deepEqual(fileEvidence(fixture.databasePath), fixture.databaseEvidence);
  const childPath = path.join(tempRoot, "data", "saves", created.adventureId, "session.sqlite");
  const beforePlay = readContinuationStore(childPath);
  assert.equal(beforePlay.revision, 46); assert.equal(beforePlay.storyTurns, 45); assert.equal(beforePlay.chapters, 15);
  assert.equal(beforePlay.state.commitments["rice-return"].status, "open");
  assert.equal(beforePlay.state.finale.phase, "idle");
  if (loseReceipt) {
    assert.equal(created.lostContinuationReceipt.count, 1);
    assert.equal(created.recoveryRequests.length, 1);
    assert.equal(created.recoveryRequests[0].saveId, created.adventureId);
    assert.equal(created.recoveryRequests[0].ok, true);
    const saves = fs.readdirSync(path.join(tempRoot, "data", "saves"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(tempRoot, "data", "saves", entry.name, "session.sqlite"))).map((entry) => entry.name).sort();
    assert.deepEqual(saves, [fixture.adventureId, created.adventureId].sort(), "a lost receipt cannot create a second child");
    const result = { ok: true, suite: "continuation-lost-receipt", tempRoot, created, childCount: 1,
      evidence: "real continuation IPC completed, real getStatus/applyStatus selected its child, then its reply was deliberately lost; renderer recovered through real continueGame with zero story/chapter/speech calls" };
    fs.writeFileSync(path.join(tempRoot, "results", "continuation-lost-receipt-result.json"), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const played = await runPhase(require("electron"), "continuation_play", env);
  assert.equal(played.revision, 49); assert.equal(played.modelCalls, 3); assert.equal(played.chapterModelCalls, 1); assert.equal(played.ttsRequests, 3);
  assert.equal(played.compactionModelCalls, 1);
  assert.equal(played.compaction.status, "reduced"); assert.ok(played.compaction.savedSafetyInputTokens > 0);
  const child = readContinuationStore(childPath);
  assert.equal(child.storyTurns, 48); assert.equal(child.chapters, 16); assert.equal(child.archive.status, "closed");
  assert.equal(child.state.commitments["rice-return"].status, "fulfilled");
  assert.equal(child.state.inventory.some((item) => item.ownerId === "lin-an" && item.itemId === "rice"), false);
  assert.deepEqual(fileEvidence(fixture.databasePath), fixture.databaseEvidence);
  const childEvidence = fileEvidence(childPath);
  const archive = await runPhase(require("electron"), "continuation_archive", env);
  assert.equal(archive.modelCalls, 0); assert.equal(archive.chapterModelCalls, 0); assert.equal(archive.ttsRequests, 0);
  assert.equal(archive.compactionModelCalls || 0, 0);
  assert.deepEqual(fileEvidence(childPath), childEvidence);
  assert.deepEqual(fileEvidence(fixture.databasePath), fixture.databaseEvidence);
  const result = { ok: true, suite: "continuation", tempRoot, created, played, archive,
    evidence: "actual Electron Main/preload/renderer, real Session child and SQLite; isolated synthetic model and silent WAV audio",
    limitations: ["The synthetic compaction deliberately selects an unrelated original quotation so the older clue must come from recall; this proves the source and recovery path, not real model selection or semantic memory quality.",
      "No real model, spoken voice, narrative quality or release acceptance was tested."] };
  fs.writeFileSync(path.join(tempRoot, "results", "continuation-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function createContinuationFixture(tempRoot) {
  const gameRoot = path.resolve(__dirname, "../../../..");
  const { loadBuiltInContentPack } = require(path.join(gameRoot, "engine/content-v2/built-in-pack"));
  const { compileContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-compiler"));
  const { readContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-reader"));
  const { createTurnStore } = require(path.join(gameRoot, "engine/session/turn-store"));
  const contentRoot = path.join(gameRoot, "content");
  const adventuresRoot = path.join(tempRoot, "data", "saves");
  fs.mkdirSync(adventuresRoot);
  const adventureId = "continuation-parent";
  const pack = await loadBuiltInContentPack({ contentRoot });
  await compileContentSnapshot({ adventuresRoot, adventureId, language: "zh-CN", plan: pack.defaultPlan,
    requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"],
    resolvePackRoot: (packId) => path.join(contentRoot, "packs", packId) });
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId });
  const databasePath = path.join(adventuresRoot, adventureId, "session.sqlite");
  const store = createTurnStore({ databasePath, adventureId, locale: "zh-CN", contentVersion: snapshot.lock.overallHash, initialState: readyState() });
  const history = []; const chapters = [];
  try {
    for (let revision = 1; revision <= 45; revision++) {
      const host = revision === 1 ? BORROWED : revision === 2 ? CONTINUATION_OLD_MEMORY
        : revision === 44 ? FINALE_TEXTS[2] : revision === 45 ? FINALE_TEXTS[3] : `父篇第${revision}次交谈：你留意楼道里的光线，陈姨点头回应。`;
      const player = revision === 1 ? PLAYER_BORROW : revision === 2 ? "我记住陈姨关于归还米的红绳凳子叮嘱。"
        : revision === 44 ? FINALE_INPUTS[2] : revision === 45 ? FINALE_INPUTS[3] : `我观察楼道，第${revision}次交谈。`;
      const segmentId = `parent-segment-${revision}`;
      const events = revision === 1 ? [
        { id: "borrow-rice", type: "inventory.transfer", sourceSegmentIds: [segmentId], data: { fromId: "chen", toId: "lin-an", itemId: "rice", quantity: 2 } },
        { id: "promise-rice", type: "commitment.create", sourceSegmentIds: [segmentId], data: { commitment: {
          id: "rice-return", debtorId: "lin-an", creditorId: "chen", itemId: "rice", quantity: 2, due: "第十一天", status: "open" } } },
      ] : revision === 44 ? [{ id: "parent-offer", type: "finale.propose", sourceSegmentIds: [segmentId], data: {
        candidateId: "parent-ending", closureReason: "PRIVATE_FINALE_REASON", closedThreads: ["求助已经得到回应。"],
        intentionalOpenThreads: ["归还米的约定仍保留。"], finaleTone: "平静" } }]
        : revision === 45 ? [{ id: "parent-confirm", type: "finale.confirm", sourceSegmentIds: [segmentId], data: { candidateId: "parent-ending" } }] : [];
      const experiences = revision <= 2 ? [{ id: revision === 1 ? "parent-borrowing" : "parent-red-cord", text: host,
        kind: "event", knownBy: ["lin-an", "chen"], entityIds: ["lin-an", "chen", "rice"], eventIds: events.map((event) => event.id), sourceSegmentIds: [segmentId] }] : [];
      const action = store.beginAction({ actionId: `parent-action-${revision}`, baseRevision: revision - 1, input: player,
        locale: "zh-CN", contentVersion: snapshot.lock.overallHash });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: bundle(segmentId, host, events, experiences) });
      history.push({ revision, host, player });
      if (revision % 3 === 0) {
        const chapter = { title: `父篇第${revision / 3}章`, summary: `第${revision - 2}至${revision}次交谈已经留下记录。` };
        const job = store.beginChapter({ targetRevision: revision });
        store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: { ...chapter, mode: "model",
          keyEvents: [{ text: `楼道里的第${revision}次交谈。`, sources: [{ revision, segmentId }] }], openThreads: [] } });
        chapters.push(chapter);
      }
    }
    store.sealFinale({ finaleId: "finale-45", chapterId: "chapter-45" });
  } finally { store.close(); }
  const fixture = { adventureId, databasePath, databaseEvidence: fileEvidence(databasePath), history, chapters, revision: 45 };
  fs.writeFileSync(path.join(tempRoot, "results", "continuation-fixture.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

function readContinuationStore(databasePath) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db.prepare("SELECT t.* FROM turns t JOIN session s ON s.revision=t.revision").get();
    return { revision: row.revision, state: JSON.parse(row.state_json),
      storyDigest: require("node:crypto").createHash("sha256").update(JSON.stringify(db.prepare("SELECT * FROM turns ORDER BY revision").all())).digest("hex"),
      storyTurns: db.prepare("SELECT count(*) AS n FROM turns WHERE action_id IS NOT NULL").get().n,
      chapters: db.prepare("SELECT count(*) AS n FROM chapters").get().n,
      archive: db.prepare("SELECT * FROM finale_archives").get() || null };
  } finally { db.close(); }
}

async function runSpecialCoordinator() {
  const results = [];
  for (const branch of ["standard", "grey"]) {
    const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
    for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
    const env = {};
    for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
      XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot,
      GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
      GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
    // A fixed process-local random source for this synthetic test only. The
    // durable production reservation still chooses and stores the branch once.
    const randomCallsPath = path.join(tempRoot, "terminal-random-calls.txt");
    fs.writeFileSync(path.join(tempRoot, "terminal-random-hook.cjs"), `"use strict";\nconst crypto=require("node:crypto");\ncrypto.randomInt=(maximum)=>{if(maximum!==10000)throw new Error("unexpected random range");require("node:fs").appendFileSync(${JSON.stringify(randomCallsPath)},"draw\\n");return ${branch === "grey" ? 0 : 9999};};\n`);
    const fixture = await createSpecialFixture(tempRoot, branch);
    process.stdout.write(`Special ${branch} artifacts: ${tempRoot}\n`);
    const setup = await runPhase(require("electron"), `special_${branch}`, env);
    const pending = readSpecialStore(fixture.databasePath);
    assert.equal(pending.revision, 6);
    assert.equal(pending.terminal.status, "reserved");
    assert.equal(pending.terminal.outcome, branch === "grey" ? "grey_crow_view" : "standard_extreme_ending");
    assert.equal(pending.chapterCount, 0);
    assert.equal(pending.playerAttributes.status, "清醒", "an uncommitted closing scene cannot change the formal player state");
    assert.equal(fs.readFileSync(randomCallsPath, "utf8"), "draw\n", "first terminal intent makes exactly one engine draw");
    const restore = await runPhase(require("electron"), `special_${branch}_restore`, env);
    const closed = readSpecialStore(fixture.databasePath);
    assert.equal(closed.revision, 7);
    assert.equal(closed.terminal.status, "committed");
    assert.equal(closed.terminal.action_id, pending.terminal.action_id);
    assert.equal(closed.terminal.draw, pending.terminal.draw);
    assert.equal(closed.terminal.outcome, pending.terminal.outcome);
    assert.equal(closed.finalAction.input, SPECIAL_INPUTS[6]);
    assert.equal(closed.finalAction.actionId, pending.terminal.action_id);
    assert.equal(closed.chapterCount, 1);
    assert.deepEqual(closed.playerAttributes, { ...readyState().entities["lin-an"].attributes, status: SPECIAL_PLAYER_CONDITION[branch] },
      "closing persists the narrated player condition and retains the other attributes");
    assert.equal(fs.readFileSync(randomCallsPath, "utf8"), "draw\n", "process restart and retry cannot draw the outcome again");
    const before = databaseDigest(fixture.databasePath);
    const archive = await runPhase(require("electron"), `special_${branch}_archive`, env);
    assert.equal(databaseDigest(fixture.databasePath), before);
    assert.deepEqual(readSpecialStore(fixture.databasePath).playerAttributes, closed.playerAttributes);
    const result = { ok: true, branch, tempRoot, evidence: "actual Electron, Session child and SQLite; local synthetic narration/audio and process-local test random hook",
      setup, pending, restore, closed, archive, engineRandomCalls: 1, limitations: ["No real model, spoken audio, narrative quality or release acceptance was tested."] };
    fs.writeFileSync(path.join(tempRoot, "results", "special-result.json"), `${JSON.stringify(result, null, 2)}\n`);
    results.push({ branch, tempRoot, setupCalls: setup.modelCalls, restoredCalls: restore.modelCalls, chapterCalls: restore.chapterModelCalls,
      recoverySpeech: restore.ttsRequests, archiveCalls: archive.modelCalls, archiveSpeech: archive.ttsRequests });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, suite: "special", results }, null, 2)}\n`);
}

async function createSpecialFixture(tempRoot, branch) {
  const gameRoot = path.resolve(__dirname, "../../../..");
  const { loadBuiltInContentPack } = require(path.join(gameRoot, "engine/content-v2/built-in-pack"));
  const { compileContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-compiler"));
  const { readContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-reader"));
  const { createTurnStore } = require(path.join(gameRoot, "engine/session/turn-store"));
  const contentRoot = path.join(gameRoot, "content");
  const adventuresRoot = path.join(tempRoot, "data", "saves");
  fs.mkdirSync(adventuresRoot);
  const adventureId = `special-${branch}`;
  const pack = await loadBuiltInContentPack({ contentRoot });
  await compileContentSnapshot({ adventuresRoot, adventureId, language: "zh-CN", plan: pack.defaultPlan,
    requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"],
    resolvePackRoot: (packId) => path.join(contentRoot, "packs", packId) });
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId });
  const databasePath = path.join(adventuresRoot, adventureId, "session.sqlite");
  const state = readyState();
  state.inventory = [{ ownerId: "lin-an", itemId: "rice", quantity: 2 }];
  state.commitments["rice-return"] = { id: "rice-return", debtorId: "lin-an", creditorId: "chen", itemId: "rice", quantity: 2, due: "第十一天", status: "open" };
  const store = createTurnStore({ databasePath, adventureId, locale: "zh-CN", contentVersion: snapshot.lock.overallHash, initialState: state });
  store.close();
  const fixture = { adventureId, databasePath, branch };
  fs.writeFileSync(path.join(tempRoot, "results", "special-fixture.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

function readSpecialStore(databasePath) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const last = db.prepare("SELECT revision,action_id,state_json FROM turns ORDER BY revision DESC LIMIT 1").get();
    const action = db.prepare("SELECT request_json FROM actions WHERE action_id=?").get(last.action_id);
    return { revision: last.revision, terminal: { ...db.prepare("SELECT action_id,status,outcome,draw FROM terminal_reservations").get() },
      finalAction: action ? JSON.parse(action.request_json) : null, playerAttributes: JSON.parse(last.state_json).entities["lin-an"].attributes,
      chapterCount: db.prepare("SELECT count(*) AS count FROM chapters").get().count };
  } finally { db.close(); }
}

async function createLongArchiveFixture(tempRoot) {
  // A second, explicitly synthetic archive exercises actual read-only UI paging.
  // It is built only after the end-to-end new-game fixture has completed.
  const gameRoot = path.resolve(__dirname, "../../../..");
  const { loadBuiltInContentPack } = require(path.join(gameRoot, "engine/content-v2/built-in-pack"));
  const { compileContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-compiler"));
  const { readContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-reader"));
  const { createTurnStore } = require(path.join(gameRoot, "engine/session/turn-store"));
  const { initialState } = require(path.join(gameRoot, "engine/session/test-fixtures/turn-samples"));
  const contentRoot = path.join(gameRoot, "content");
  const adventuresRoot = path.join(tempRoot, "data", "saves");
  const adventureId = "isolated-long-archive";
  const pack = await loadBuiltInContentPack({ contentRoot });
  await compileContentSnapshot({ adventuresRoot, adventureId, language: "zh-CN", plan: pack.defaultPlan,
    requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"],
    resolvePackRoot: (packId) => path.join(contentRoot, "packs", packId) });
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId });
  const databasePath = path.join(adventuresRoot, adventureId, "session.sqlite");
  const store = createTurnStore({ databasePath, adventureId, locale: "zh-CN", contentVersion: snapshot.lock.overallHash,
    initialState: initialState() });
  const history = [];
  const chapters = [];
  try {
    for (let revision = 1; revision <= 45; revision += 1) {
      const host = `长档案正文第${revision}段。楼道里留下这一次交谈的记录。`;
      const player = `长档案行动第${revision}次。`;
      const events = revision === 44 ? [{ id: "long-offer", type: "finale.propose", sourceSegmentIds: [`long-segment-${revision}`],
        data: { candidateId: "long-ending", closureReason: "PRIVATE_FINALE_REASON_MUST_NOT_LEAK", closedThreads: ["这一段同行已经完成。"],
          intentionalOpenThreads: [], finaleTone: "平静" } }]
        : revision === 45 ? [{ id: "long-confirm", type: "finale.confirm", sourceSegmentIds: [`long-segment-${revision}`], data: { candidateId: "long-ending" } }]
          : [];
      const action = store.beginAction({ actionId: `long-turn-${revision}`, baseRevision: revision - 1, input: player,
        locale: "zh-CN", contentVersion: snapshot.lock.overallHash });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
        bundle: { narration: [{ id: `long-segment-${revision}`, text: host }], events, experiences: [] } });
      history.push({ revision, host, player });
      if (revision % 3 === 0) {
        const title = `长档案章节第${revision / 3}章`;
        const summary = `第${revision - 2}至${revision}次交谈已记录。`;
        const job = store.beginChapter({ targetRevision: revision });
        store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId,
          chapter: { title, summary, keyEvents: [{ text: `记录第${revision}次交谈。`, sources: [{ revision, segmentId: `long-segment-${revision}` }] }],
            openThreads: [], mode: "model" } });
        chapters.push({ title, summary });
      }
    }
    store.sealFinale({ finaleId: "finale-45", chapterId: "chapter-45" });
  } finally { store.close(); }
  const fixture = { adventureId, databasePath, databaseDigest: databaseDigest(databasePath), history, chapters, revision: 45 };
  fs.writeFileSync(path.join(tempRoot, "results", "long-fixture.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

function runPhase(electronBin, phase, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronBin, [__filename, `--phase=${phase}`], {
      cwd: path.resolve(__dirname, ".."), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, PHASE_TIMEOUT_MS);
    child.stdout.on("data", (data) => { stdout = (stdout + data).slice(-100_000); });
    child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-100_000); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      fs.writeFileSync(path.join(env[ROOT_ENV], "results", `${phase}-stdout.txt`), stdout);
      fs.writeFileSync(path.join(env[ROOT_ENV], "results", `${phase}-stderr.txt`), stderr);
      if (code !== 0 || timedOut) {
        reject(new Error(`Isolated desktop ${phase} failed (${timedOut ? "timeout" : code || signal}).\n${stdout}\n${stderr}`));
      } else {
        const result = JSON.parse(fs.readFileSync(path.join(env[ROOT_ENV], "results", `${phase}.json`), "utf8"));
        process.stdout.write(`Desktop ${phase}: revision ${result.revision}, story model calls ${result.modelCalls}, chapter model calls ${result.chapterModelCalls}, speech requests ${result.ttsRequests}\n`);
        resolve(result);
      }
    });
  });
}

async function runElectronPhase() {
  const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8);
  assert.ok(["setup", "restore", "finale", "finale_restore", "closed_restore", "archive_export", "continuation_boundary",
    "continuation_create", "continuation_play", "continuation_archive"].includes(phase)
    || /^special_(grey|standard)(?:_restore|_archive)?$/.test(phase)
    || ["fragments_play", "fragments_restore", "fragments_overview", "default_entry", "default_entry_restore", "notebook_entry", "notebook_entry_restore"].includes(phase)
    || ["compact_manual", "compact_restart", "compact_auto", "compact_timeout", "compact_timeout_restart", "compact_boundaries"].includes(phase)
    || ["settings_setup", "settings_change", "settings_restore", "settings_locale", "settings_controls", "settings_controls_roundtrip"].includes(phase)
    || ["detail_pagination", "detail_pagination_restore"].includes(phase)
    || ["execution_read", "execution_restart"].includes(phase)
    || phase === "action_errors" || deleteRecovery.handlesPhase(phase)
    || ["save_policy_play", "save_policy_restart", "save_policy_timeout", "save_policy_controls"].includes(phase)
    || ["notebook_legacy_layout", "notebook_legacy_layout_restart"].includes(phase)
    || observability.handlesPhase(phase) || chapterReadability.handlesPhase(phase) || narrationDelivery.handlesPhase(phase) || notebookLayout.handlesPhase(phase) || playerSettings.handlesPhase(phase) || playerReport.handlesPhase(phase) || playerGuide.handlesPhase(phase) || gameTour.handlesPhase(phase));
  const tempRoot = process.env[ROOT_ENV];
  assert.ok(path.isAbsolute(tempRoot || ""));
  assert.ok(path.basename(tempRoot).startsWith("grey-crow-session-desktop-"));
  assert.equal(process.env.GREY_CROW_REBUILD_SESSION, undefined);
  assert.equal(process.env.GREY_CROW_DATA_ROOT, path.join(tempRoot, "data"));
  assert.equal(process.env.GREY_CROW_PROVIDER_CHECK_ROOT, path.join(tempRoot, "provider-check"));
  if (!playerGuide.handlesPhase(phase) && !gameTour.handlesPhase(phase)) {
    // Existing suites exercise returning-player flows; first-run tour behavior
    // is covered separately without silently clicking through it for a player.
    require("../tutorial-store").createTutorialStore({ dataRoot: process.env.GREY_CROW_DATA_ROOT, topic: "game-ui" }).setDismissed(true);
  }
  const { app, BrowserWindow, ipcMain } = require("electron");
  app.setPath("userData", path.join(tempRoot, "electron-user-data"));
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  const evidence = { phase, sessionTimeoutMs: observability.handlesPhase(phase) ? 60000 : (phase.startsWith("settings_") || phase.startsWith("compact_") || phase.startsWith("fragments_") || phase.startsWith("save_policy_") || playerReport.handlesPhase(phase) || playerGuide.handlesPhase(phase)) && !["compact_timeout", "save_policy_timeout"].includes(phase) ? 15000 : 1000, modelCalls: 0, modelInputs: [], chapterModelCalls: 0, chapterInputs: [], ttsRequests: 0, audioGenerations: 0, probeCalls: 0,
    continuationRequests: [], manualSaves: [], recoveryRequests: [], ttsUtteranceTexts: [],
    rendererErrors: [], screenshots: [], detailResponses: [] };
  if (phase === "finale") evidence.sessionTimeoutMs = 3000;
  if (phase === "action_errors") evidence.sessionTimeoutMs = 15000;
  installLocalFixtures(tempRoot, evidence, phase);
  deleteRecovery.installFailure(tempRoot, evidence);
  // Observe only the existing speech handlers; all handlers still execute Main.
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (...args) => {
    if (gameTour.handlesPhase(phase) && channel === "grey-crow:run-turn") (evidence.tourActionRequests ||= []).push(channel);
    if (["grey-crow:start-tts-utterance", "grey-crow:synthesize-tts"].includes(channel)) evidence.ttsRequests += 1;
    if (channel === "grey-crow:start-tts-utterance") evidence.ttsUtteranceTexts.push(args[1]?.text);
    observability.observeRequest(channel, args[1], evidence);
    if (phase === "action_errors" && channel === "grey-crow:run-turn") (evidence.actionErrorRequests ||= []).push(structuredClone(args[1]));
    const result = await handler(...args);
    if (phase === "notebook_entry" && channel === "grey-crow:confirm-new-game-creation") {
      evidence.openingEnvelope = structuredClone(result?.openingEnvelope);
    }
    if (phase === "action_errors" && channel === "grey-crow:run-turn") {
      (evidence.actionErrorReceipts ||= []).push({ ok: result?.ok, actionResult: structuredClone(result?.actionResult),
        error: structuredClone(result?.error || result?.envelope?.error), revision: result?.status?.activeSave?.revision });
    }
    if (phase.startsWith("execution_") && channel === "grey-crow:get-debug-trace" && result?.ok) {
      (evidence.executionReads ||= []).push({ execution: structuredClone(result.result?.execution),
        ipcBytes: Buffer.byteLength(JSON.stringify(result)), exportBytes: Buffer.byteLength(result.export?.content || "") });
    }
    if (chapterReadability.handlesPhase(phase) && channel === "grey-crow:get-chapter-logs") {
      (evidence.chapterReads ||= []).push({ request: structuredClone(args[1]), ok: result?.ok,
        adventureId: result?.adventureId, revision: result?.revision, page: structuredClone(result?.result) });
    }
    if (phase.startsWith("detail_pagination") && channel === "grey-crow:get-skill-panel" && args[1]?.view === "detail") {
      // Match detailPageFits' Session boundary exactly. Main wraps that result
      // with ok/status; keep measuring the full IPC reply separately rather
      // than applying the projection-only ceiling to an unrelated envelope.
      const projection = { adventureId: result?.adventureId, revision: result?.revision,
        actionId: result?.actionId, supported: result?.supported, panel: result?.panel };
      const serialized = JSON.stringify(result);
      const serializedProjection = JSON.stringify(projection);
      const serializedStatus = JSON.stringify(result?.status);
      evidence.detailResponses.push({ request: structuredClone(args[1]), adventureId: projection?.adventureId,
        revision: projection?.revision, pagination: projection?.panel?.pagination,
        attributeFields: structuredClone(projection?.panel?.detail?.sections?.find(section => section.id === "attribute_text")?.fields || []),
        sectionFields: (projection?.panel?.detail?.sections || []).map(section => ({id:section.id,fields:structuredClone(section.fields)})),
        characters: serialized?.length, bytes: serialized ? Buffer.byteLength(serialized) : null,
        projectionCharacters: serializedProjection.length, projectionBytes: Buffer.byteLength(serializedProjection),
        statusCharacters: serializedStatus?.length ?? null, statusBytes: serializedStatus ? Buffer.byteLength(serializedStatus) : null,
        statusAdventureId: result?.status?.activeSaveId, statusRevision: result?.status?.activeSave?.revision });
    }
    if (phase === "setup" && channel === "grey-crow:run-turn" && result?.envelope?.revision === 4) {
      evidence.borrowedEnvelope = structuredClone(result.envelope);
    }
    if (channel === "grey-crow:complete-turn-derived") {
      (evidence.derivedReceipts ||= []).push({ request: structuredClone(args[1]), result });
    }
    observability.observeResult(channel, result, evidence);
    playerSettings.observeResult(channel, result, evidence);
    playerReport.observeResult(channel, result, evidence);
    if (phase.startsWith("save_policy_") && ["grey-crow:run-turn", "grey-crow:request-context-compaction", "grey-crow:read-context-compaction"].includes(channel)) {
      (evidence.policyReceipts ||= []).push({ channel, request: structuredClone(args[1]), result });
    }

    if (phase.startsWith("settings_") || phase.startsWith("compact_")) {
      if (channel === "grey-crow:run-turn") (evidence.turnReceipts ||= []).push({ ok: result?.ok, stale: result?.stale,
        error: result?.error?.code, contextUsage: result?.contextUsage, actionResult: result?.actionResult });
      if (channel === "grey-crow:continue-game") (evidence.contextRecoveries ||= []).push(result?.contextUsage);
      if (channel === "grey-crow:update-settings") (evidence.settingsSaves ||= []).push({ ok: result?.ok,
        error: result?.error?.code, runtimeSessionId: result?.status?.runtimeSessionId,
        settingsIdentity: result?.status?.sessionContextSettingsIdentity });
    }
    if (phase.startsWith("compact_") && ["grey-crow:request-context-compaction", "grey-crow:read-context-compaction"].includes(channel)) {
      (evidence.compactionReceipts ||= []).push({ channel, request: structuredClone(args[1]), result });
      if (phase === "compact_manual" && channel === "grey-crow:request-context-compaction"
        && result?.compaction?.status === "reduced" && !evidence.lostCompactionReceipt) {
        evidence.lostCompactionReceipt = { request: structuredClone(args[1]), result };
        throw new Error("SYNTHETIC_COMPACTION_RECEIPT_LOST");
      }
    }
    if (channel === "grey-crow:continue-story-archive") evidence.continuationRequests.push({ request: structuredClone(args[1]),
      ok: result?.ok, stale: result?.stale === true, error: result?.error?.code, childAdventureId: result?.continuation?.childAdventureId });
    if (channel === "grey-crow:continue-game") evidence.recoveryRequests.push({ saveId: args[1]?.saveId, ok: result?.ok, adventureId: result?.save?.id });
    if (channel === "grey-crow:request-manual-save") evidence.manualSaves.push({ request: structuredClone(args[1]), result });
    if (channel === "grey-crow:continue-story-archive" && result?.ok && !evidence.lostContinuationReceipt
      && phase === "continuation_create" && process.env.GREY_CROW_CONTINUATION_CHECK_LOST_RECEIPT === "1") {
      evidence.lostContinuationReceipt = { count: 1, request: structuredClone(args[1]), childAdventureId: result.continuation.childAdventureId };
      const selected = await args[0].sender.executeJavaScript(`(async () => { const current = await window.greyCrow.getStatus();
        applyStatus(current); return { activeSaveId: state.activeSaveId, revision: state.activeSave?.revision,
          sessionId: state.runtimeSessionId, pendingRequest: state.pendingContinuationRequest }; })()`, true);
      assert.equal(selected.activeSaveId, result.continuation.childAdventureId);
      assert.equal(selected.revision, result.continuation.boundaryRevision);
      assert.equal(selected.sessionId, result.status.runtimeSessionId);
      assert.deepEqual(selected.pendingRequest, args[1]);
      evidence.lostContinuationReceipt.selected = selected;
      throw new Error("SYNTHETIC_CONTINUATION_RECEIPT_LOST");
    }
    return result;
  });
  require("../main.js");
  await app.whenReady();
  const win = await waitForWindow(BrowserWindow);
  win.webContents.on("console-message", (...args) => {
    const event = args[0];
    const level = typeof event?.level === "string" ? event.level : args[1];
    const message = typeof event?.message === "string" ? event.message : args[2];
    if (level === "error" || level === 3) evidence.rendererErrors.push(String(message).slice(0, 2000));
  });
  try {
    await waitFor(win, "real renderer boot", `Boolean(window.greyCrow) && document.readyState === 'complete' && Boolean(document.querySelector('#settingsDialog'))`);
    await resize(win);
    const status = await evaluate(win, "window.greyCrow.getStatus()");
    assert.equal(status.runtimeProtocol, "session-1");
    assert.equal(status.appData.mode, "override");
    const runners = { setup: runSetup, restore: runRestore, finale: runFinale, finale_restore: runFinaleRestore, closed_restore: runClosedRestore, archive_export: runArchiveExport, continuation_boundary: runContinuationBoundary };
    const runner = gameTour.handlesPhase(phase) ? (win, evidence, tempRoot) => gameTour.runPhase(win, evidence, tempRoot, { click, change, evaluate, readStatus, waitFor, waitUntil, screenshot, connectSyntheticModel, submit, syntheticKey: SYNTHETIC_KEY }) : playerGuide.handlesPhase(phase) ? (win, evidence, tempRoot) => playerGuide.runPhase(win, evidence, tempRoot, { click, change, evaluate, readStatus, waitFor, waitUntil, screenshot, connectSyntheticModel, submit, syntheticKey: SYNTHETIC_KEY }) : deleteRecovery.handlesPhase(phase) ? (win, evidence, tempRoot) => deleteRecovery.runPhase(win, evidence, tempRoot,
      { click, change, evaluate, waitFor, screenshot, connectSyntheticModel })
      : playerReport.handlesPhase(phase) ? (win, evidence, tempRoot) => playerReport.runPhase(win, evidence, tempRoot,
      { click, change, evaluate, readStatus, waitFor, waitUntil, delay, screenshot, syntheticKey: SYNTHETIC_KEY })
      : playerSettings.handlesPhase(phase) ? (win, evidence, tempRoot) => playerSettings.runPhase(win, evidence, tempRoot,
      { click, change, evaluate, readStatus, waitFor, screenshot, connectSyntheticModel, syntheticKey: SYNTHETIC_KEY })
      : notebookLayout.handlesPhase(phase) ? (win, evidence, tempRoot) => notebookLayout.runPhase(win, evidence, tempRoot,
      { click, change, evaluate, readStatus, waitFor, screenshot, connectSyntheticModel, waitSettingsRevision })
      : chapterReadability.handlesPhase(phase) ? (win, evidence, tempRoot) => chapterReadability.runPhase(win, evidence, tempRoot,
      { click, change, evaluate, readStatus, waitFor, screenshot, connectSyntheticModel, waitSettingsRevision })
      : narrationDelivery.handlesPhase(phase) ? (win, evidence, tempRoot) => narrationDelivery.runPhase(win, evidence, tempRoot,
      { click, change, evaluate, readStatus, waitFor, waitUntil, delay, screenshot, connectSyntheticModel, submit, syntheticKey: SYNTHETIC_KEY })
      : observability.handlesPhase(phase) ? (win, evidence, tempRoot) => observability.runPhase(win, evidence, tempRoot,
      { click, change, evaluate, readStatus, waitFor, waitUntil, delay, screenshot, connectSyntheticModel, submit, syntheticKey: SYNTHETIC_KEY })
      : phase.startsWith("notebook_legacy_layout") ? runNotebookLegacyLayoutPhase : phase === "action_errors" ? runActionErrorsPhase : phase.startsWith("execution_") ? runExecutionPhase : phase.startsWith("detail_pagination") ? runDetailPaginationPhase : phase.startsWith("save_policy_") ? runSavePolicyPhase : phase.startsWith("default_entry") || phase.startsWith("notebook_entry") ? runDefaultEntryPhase : phase.startsWith("fragments_") ? runFragmentsPhase : phase.startsWith("compact_") ? runCompactionPhase : phase.startsWith("settings_controls") ? runSettingsControls : phase.startsWith("settings_") ? runSettingsPhase : phase.startsWith("special_") ? runSpecialPhase
      : ["continuation_create", "continuation_play", "continuation_archive"].includes(phase) ? runContinuationPhase : runners[phase];
    const result = await runner(win, evidence, tempRoot);
    result.rendererErrors = evidence.rendererErrors;
    assert.deepEqual(evidence.rendererErrors, [], "renderer must not log runtime errors");
    fs.writeFileSync(path.join(tempRoot, "results", `${phase}.json`), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`Real desktop ${phase} passed.\n`);
    app.quit();
  } catch (error) {
    try {
      await screenshot(win, tempRoot, `${phase}-failure`, evidence);
      fs.writeFileSync(path.join(tempRoot, "results", `${phase}-failure.json`), JSON.stringify({ evidence, ui: await snapshot(win) }, null, 2));
    } catch { /* Keep the first failing UI or model assertion. */ }
    throw error;
  }
}

function installLocalFixtures(tempRoot, evidence, phase) {
  if (playerGuide.handlesPhase(phase)) {
    evidence.guideExternalUrls = [];
    require("electron").shell.openExternal = async (url) => { evidence.guideExternalUrls.push(url); };
  }
  if (playerReport.handlesPhase(phase)) {
    evidence.problemReportDialogs = [];
    require("electron").dialog.showSaveDialog = async (...args) => {
      const options = args.at(-1);
      evidence.problemReportDialogs.push({ title: options.title, defaultPath: options.defaultPath, mode: evidence.problemReportDialogMode });
      if (evidence.problemReportDialogMode === "cancel") return { canceled: true };
      if (evidence.problemReportDialogMode === "fail") return { canceled: false, filePath: path.join(tempRoot, "missing-report-directory", "report.json") };
      return { canceled: false, filePath: path.join(tempRoot, "results", `player-problem-${evidence.phase}.json`) };
    };
  }
  if (phase === "archive_export" || phase === "continuation_archive" || /^special_(grey|standard)_archive$/.test(phase)) {
    evidence.exportDialogs = [];
    // Only the destination picker is synthetic; real renderer/Main export IPC,
    // archive reader and filesystem exporter must execute for each UI click.
    require("electron").dialog.showSaveDialog = async (...args) => {
      const options = args.at(-1);
      const extension = options.filters?.[0]?.extensions?.[0];
      assert.ok(["html", "md"].includes(extension));
      assert.ok(evidence.exportTarget, "export target is chosen by this isolated test");
      const filePath = path.join(fs.realpathSync(tempRoot), "results", `${evidence.exportTarget}.${extension}`);
      evidence.exportDialogs.push({ extension, filePath });
      return { canceled: false, filePath };
    };
  }
  const gameRoot = path.resolve(__dirname, "../../../..");
  const bridgePath = require.resolve(path.join(gameRoot, "engine/bridge/session-desktop-bridge"));
  const bridgeModule = require(bridgePath);
  require.cache[bridgePath].exports = { ...bridgeModule, createSessionDesktopBridge(config) {
    const testConfig = phase === "action_errors" ? config
      : { ...config, sessionOptions: { ...config.sessionOptions, timeoutMs: evidence.sessionTimeoutMs } };
    if (phase.startsWith("special_")) {
      const { createSessionProcess } = require(path.join(gameRoot, "engine/session/session-process"));
      const { fork } = require("node:child_process");
      testConfig.createSessionProcess = (options) => createSessionProcess({ ...options, spawn(childPath, args, spawnOptions) {
        return fork(childPath, args, { ...spawnOptions, execArgv: [...spawnOptions.execArgv, "--require", path.join(tempRoot, "terminal-random-hook.cjs")] });
      } });
    }
    return bridgeModule.createSessionDesktopBridge(testConfig);
  } };
  const providersPath = require.resolve(path.join(gameRoot, "engine/providers"));
  const actual = require(providersPath);
  require.cache[providersPath].exports = { ...actual,
    createBuiltinProviderRegistry() {
      const registry = actual.createBuiltinProviderRegistry();
      return { ...registry, create(config) { return { name: "synthetic-local", model: config.model, async generate(request) {


        assert.equal(request.signal instanceof AbortSignal, true);
        if (phase === "action_errors") return generateActionErrorFixture(request, evidence, tempRoot);
        if (phase.startsWith("execution_")) {
          evidence.modelCalls += 1;
          throw new Error("Read-only execution diagnostics must not generate a model response");
        }
        if (chapterReadability.handlesPhase(phase) || notebookLayout.handlesPhase(phase) || playerSettings.handlesPhase(phase) || playerReport.handlesPhase(phase)) {
          evidence.modelCalls += 1;
          throw new Error("Read-only chapter readability must not generate a model response");
        }
        if (observability.handlesPhase(phase)) return observability.generate(request, evidence, tempRoot);
        if (narrationDelivery.handlesPhase(phase)) return narrationDelivery.generate(request, evidence, tempRoot);
        if (phase.startsWith("detail_pagination")) {
          evidence.modelCalls += 1;
          throw new Error("Read-only detail pagination must not generate a model response");
        }
        if (phase.startsWith("save_policy_")) return generateSavePolicyFixture(request, evidence);
        if (phase.startsWith("fragments_")) return generateFragmentsFixture(request, evidence, tempRoot);
        if (phase.startsWith("compact_")) return generateCompactionFixture(request, evidence, tempRoot);
        if (phase.startsWith("settings_")) return generateSettingsFixture(request, evidence, tempRoot);
        if (phase.startsWith("special_")) return generateSpecialFixture(request, evidence, phase);
        if (["continuation_create", "continuation_play", "continuation_archive"].includes(phase)) return generateContinuationFixture(request, evidence, phase);
        const inputs = request.messages.map((message) => {
          try { return JSON.parse(message.content); } catch { return null; }
        });
        const chapterInput = inputs.find((value) => ["summarize_chapter", "merge_chapter"].includes(value?.task));
        if (chapterInput) {
          assert.ok(["setup", "finale", "finale_restore"].includes(phase), "read-only recovery may not generate a chapter");
          evidence.chapterModelCalls += 1;
          evidence.chapterInputs.push({ task: chapterInput.task, range: chapterInput.range,
            sources: chapterInput.sources?.map(({ revision, segmentId }) => ({ revision, segmentId })) });
          assert.equal(evidence.chapterModelCalls, 1, "manual saving the same revision cannot regenerate the chapter");
          if (phase === "finale") {
            assert.deepEqual(chapterInput.range, { fromRevision: 5, toRevision: 8 });
            return new Promise((resolve, reject) => request.signal.addEventListener("abort", () => {
              evidence.finaleTimeoutObserved = true;
              reject(Object.assign(new Error("Synthetic final chapter interrupted at the real service deadline"), { code: "ABORT_ERR" }));
            }, { once: true }));
          }
          return { text: JSON.stringify(generateChapterFixture(chapterInput)), toolCalls: [],
            usage: { input_tokens: 180, output_tokens: 100 }, model: "synthetic-local", finishReason: "stop" };
        }
        assert.ok(["setup", "finale", "default_entry", "notebook_entry"].includes(phase) || playerGuide.handlesPhase(phase), "recovery may not generate a new story");
        const source = inputs.find((value) => value?.canonicalState);
        const playerInput = request.messages.find((message) => message.content?.startsWith("Current player action:\n"))?.content.slice("Current player action:\n".length);
        assert.ok(source, "new canonical Session prompt must reach the registered provider");
        assert.equal(source.locale, "zh-CN");
        evidence.modelCalls += 1;
        evidence.modelInputs.push({ revision: source.baseRevision, phase: source.canonicalState.opening?.phase || "ready", input: playerInput });
        const generated = source.baseRevision < 4 ? generateFixture(source, playerInput) : generateFinaleFixture(source, playerInput);
        return { text: JSON.stringify(generated), toolCalls: [], usage: { input_tokens: 120, output_tokens: 90 },
          model: "synthetic-local", finishReason: "stop" };
      } }; } };
    },
    async runProviderCompatibilityProbe(options) {
      evidence.probeCalls += 1;
      if (playerSettings.handlesPhase(phase)) return playerSettings.probe(options, evidence);
      if (playerReport.handlesPhase(phase)) return playerReport.probe(options, evidence);
      return { ok: true, contractVersion: "grey-crow-provider-probe-v1", provider: "synthetic-local",
        model: "synthetic-local", toolCallRoundTrip: true, providerCalls: 0, usage: {} };
    },
  };
  const audioPath = require.resolve("../tts-kokoro-original-provider");
  const audioModule = require(audioPath);
  require.cache[audioPath].exports = { ...audioModule,
    inspectOriginalBundle: narrationDelivery.isMissingResourcesPhase(phase)
      ? audioModule.inspectOriginalBundle
      : () => ({ available: true, fixture: true }),
    createKokoroOriginalProvider: () => ({ id: "kokoro-original-local", cacheVersion: "synthetic-silence-v1",
      online: false, experimental: true, fileExtension: "wav", mimeType: "audio/wav", defaultVoiceId: "zm_010",
      async synthesizeToFile({ outputFile, signal }) {
        assert.equal(path.relative(tempRoot, outputFile).startsWith(".."), false);
        assert.equal(signal?.aborted, false);
        evidence.audioGenerations += 1;
        fs.writeFileSync(outputFile, narrationDelivery.handlesPhase(phase) ? narrationDelivery.validWav() : silentWav());
      }, async dispose() {} }),
  };
}

function generateContinuationFixture(request, evidence, phase) {
  assert.equal(phase, "continuation_play", "creating and offline reading a child cannot call a model");
  const json = request.messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } });
  const compact = json.find((value) => ["summarize_context", "merge_context"].includes(value?.task));
  if (compact) {
    evidence.compactionModelCalls = (evidence.compactionModelCalls || 0) + 1;
    assert.equal(evidence.compactionModelCalls, 1); assert.equal(compact.task, "summarize_context");
    assert.deepEqual(compact.range, { fromRevision: 1, throughRevision: 43 });
    assert.equal(compact.locale, "zh-CN");
    const candidates = compact.quoteCandidates;
    assert.ok(candidates.some((quote) => quote.source.revision === 2 && quote.source.kind === "narration"
      && quote.source.adventureId === "continuation-parent" && quote.text === CONTINUATION_OLD_MEMORY),
    "the real compaction service must review the old clue before the synthetic selector omits it");
    assert.deepEqual([...new Set(candidates.map((quote) => quote.source.revision))], Array.from({ length: 43 }, (_, index) => index + 1));
    assert.ok(candidates.every((quote) => quote.source.adventureId === "continuation-parent"));
    assert.doesNotMatch(JSON.stringify(compact.currentState), /隐藏访客|隐藏钥匙/);
    const selected = candidates.find((quote) => quote.source.kind === "narration" && quote.source.revision === 43);
    assert.ok(selected); assert.doesNotMatch(selected.text, /红绳|凳子/);
    evidence.compactionSource = { range: compact.range, reviewedRevisions: 43, selected: { source: selected.source, text: selected.text } };
    return { text: JSON.stringify({ selectedQuoteIds: [selected.quoteId] }), toolCalls: [],
      usage: { input_tokens: 220, output_tokens: 120 }, model: "synthetic-local", finishReason: "stop" };
  }
  const chapter = json.find((value) => value?.task === "summarize_chapter" || value?.task === "merge_chapter");
  if (chapter) {
    evidence.chapterModelCalls++;
    assert.equal(evidence.chapterModelCalls, 1); assert.equal(chapter.task, "summarize_chapter");
    assert.deepEqual(chapter.range, { fromRevision: 47, toRevision: 49 });
    assert.equal(chapter.coverage, "complete");
    assert.deepEqual(chapter.sources.map((source) => source.revision), [47, 48, 49]);
    assert.equal(chapter.currentState.commitments["rice-return"].status, "fulfilled");
    assert.doesNotMatch(JSON.stringify(chapter.currentState), /隐藏访客|隐藏钥匙/);
    const childAdventureId = chapter.adventureId;
    assert.ok(chapter.sources.every((source) => source.source?.adventureId === childAdventureId && source.source.revision === source.revision));
    evidence.chapterInputs.push({ range: chapter.range, sources: chapter.sources.map(({ revision, source, storyTurn }) => ({ revision, source, storyTurn })) });
    return { text: JSON.stringify({ ...CONTINUATION_CHAPTER,
      keyEvents: [{ text: "林安归还两袋米并履行原约定。", sources: [{ revision: 47, segmentId: "continuation-return" }] },
        { text: "林安确认结束这段续篇。", sources: [{ revision: 49, segmentId: "continuation-confirm" }] }], openThreads: [] }),
      toolCalls: [], usage: { input_tokens: 180, output_tokens: 100 }, model: "synthetic-local", finishReason: "stop" };
  }
  const fixed = json.find((value) => value?.canonicalState);
  assert.ok(fixed);
  const index = fixed.baseRevision - 46;
  assert.ok(index >= 0 && index < 3, "only the three fresh continuation inputs may generate story");
  const input = request.messages.find((message) => message.content?.startsWith("Current player action:\n"))?.content.slice("Current player action:\n".length);
  assert.equal(input, CONTINUATION_INPUTS[index]);
  assert.equal(fixed.locale, "zh-CN");
  assert.equal(fixed.continuation.parentAdventureId, "continuation-parent");
  assert.equal(fixed.continuation.parentRevision, 45); assert.equal(fixed.continuation.boundaryRevision, 46);
  assert.equal(fixed.continuation.sourceFinaleId, "finale-45");
  assert.equal(fixed.canonicalState.situation.playerId, "lin-an");
  assert.equal(fixed.canonicalState.situation.day, 10);
  const memoryMessages = request.messages.filter((message) => message.content.startsWith("Player-known related experiences and original passages:\n"));
  assert.equal(memoryMessages.length, 1);
  const related = JSON.parse(memoryMessages[0].content.split("\n").slice(1).join("\n"));
  const historyMessage = request.messages.find((message) => message.content.startsWith("Continuous conversation and retained original quotations (quoted data):\n"));
  assert.ok(historyMessage);
  const recent = JSON.parse(historyMessage.content.split("\n").slice(1).join("\n"));
  assert.equal(recent.summary?.format, "source-quotes-2"); assert.equal(recent.summary.throughRevision, 43);
  assert.deepEqual(recent.turns.map((turn) => turn.revision), [44, 45, ...Array.from({ length: index }, (_, offset) => 47 + offset)]);
  assert.ok(recent.turns.some((turn) => turn.revision === 45 && turn.source?.adventureId === "continuation-parent"
    && turn.narration.some((segment) => segment.text === FINALE_TEXTS[3])));
  assert.deepEqual(recent.coverage, { fromRevision: 1, throughRevision: fixed.baseRevision, omittedBeforeRevision: null, systemRevisions: [46] });
  assert.doesNotMatch(JSON.stringify(related), /隐藏访客|隐藏钥匙/);
  if (index === 0) {
    const otherMessages = request.messages.filter((message) => message !== memoryMessages[0]);
    for (const [messageIndex, message] of otherMessages.entries()) {
      assert.doesNotMatch(message.content, /红绳|凳子/, `message ${messageIndex} outside retrieved memory must not disclose the old placement clue`);
      assert.equal(message.content.includes(CONTINUATION_OLD_MEMORY), false, "the old original passage must come only from retrieved memory");
    }
    assert.equal(fixed.canonicalState.finale.phase, "idle");
    assert.equal(fixed.canonicalState.commitments["rice-return"].status, "open");
    assert.equal(fixed.canonicalState.inventory.find((item) => item.ownerId === "lin-an" && item.itemId === "rice").quantity, 2);
    const old = related.results.find((result) => result.source.revision === 2 && result.source.adventureId === "continuation-parent");
    assert.ok(old, "old parent memory must be recalled from the independent child copy, beyond recent context");
    assert.ok(old.passages.some((passage) => passage.text === CONTINUATION_OLD_MEMORY));
    evidence.memoryIsolation = { nonMemoryMessagesChecked: otherMessages.length, clueOutsideRecall: false,
      originalPassageRetrieved: true, source: old.source, input, summaryFormat: recent.summary.format,
      summaryThroughRevision: recent.summary.throughRevision, remainingRevisions: recent.turns.map((turn) => turn.revision) };
  } else {
    assert.equal(fixed.canonicalState.commitments["rice-return"].status, "fulfilled");
    assert.equal(fixed.canonicalState.inventory.some((item) => item.ownerId === "lin-an" && item.itemId === "rice"), false);
  }
  evidence.modelCalls++; assert.equal(evidence.modelCalls, index + 1);
  evidence.modelInputs.push({ revision: fixed.baseRevision, input, continuation: fixed.continuation,
    recalledSources: related.results.map((result) => result.source), recentSources: recent.turns.map(({ revision, source }) => ({ revision, source })) });
  const id = ["continuation-return", "continuation-offer", "continuation-confirm"][index];
  const events = index === 0 ? [
    { id: "return-rice", type: "inventory.transfer", sourceSegmentIds: [id], data: { fromId: "lin-an", toId: "chen", itemId: "rice", quantity: 2 } },
    { id: "fulfill-rice", type: "commitment.resolve", sourceSegmentIds: [id], data: { id: "rice-return", status: "fulfilled" } },
  ] : index === 1 ? [{ id: "offer-child-ending", type: "finale.propose", sourceSegmentIds: [id], data: {
    candidateId: "continuation-ending", closureReason: "PRIVATE_FINALE_REASON", closedThreads: ["借米与归还的约定已经完成。"], intentionalOpenThreads: [], finaleTone: "平静" } }]
    : [{ id: "confirm-child-ending", type: "finale.confirm", sourceSegmentIds: [id], data: { candidateId: "continuation-ending" } }];
  return { text: JSON.stringify(bundle(id, CONTINUATION_TEXTS[index], events)), toolCalls: [],
    usage: { input_tokens: 120, output_tokens: 90 }, model: "synthetic-local", finishReason: "stop" };
}

function generateChapterFixture(source) {
  assert.equal(source.task, "summarize_chapter", "the confirmed opening and borrowing fit one bounded chapter request");
  assert.equal(source.locale, "zh-CN");
  assert.equal(source.coverage, "complete");
  assert.ok(!JSON.stringify(source.currentState).includes("隐藏访客") && !JSON.stringify(source.currentState).includes("隐藏钥匙"));
  if (source.range.toRevision === 8) {
    assert.deepEqual(source.range, { fromRevision: 5, toRevision: 8 });
    const last = source.sources.find((item) => item.revision === 8 && item.text === FINALE_TEXTS[3]);
    assert.ok(last);
    assert.equal(source.currentState.commitments["rice-return"].status, "open");
    const sources = [{ revision: last.revision, segmentId: last.segmentId }];
    return { title: FINALE_CHAPTER_TITLE, summary: FINALE_CHAPTER_SUMMARY,
      keyEvents: [{ text: "林安确认在楼道中结束这一段故事。", sources }],
      openThreads: [{ text: "林安次日归还两袋米的约定仍待履行。", sources }] };
  }
  assert.deepEqual(source.range, { fromRevision: 3, toRevision: 4 });
  const borrowed = source.sources.find((item) => item.revision === 4 && item.text === BORROWED);
  assert.ok(borrowed, "chapter must read the actual committed borrowing passage");
  const sources = [{ revision: borrowed.revision, segmentId: borrowed.segmentId }];
  return { title: CHAPTER_TITLE, summary: CHAPTER_SUMMARY,
    keyEvents: [{ text: "陈姨借给林安两袋米。", sources }],
    openThreads: [{ text: "林安答应第十一天向陈姨归还两袋米。", sources }] };
}

function generateFinaleFixture(source, playerInput) {
  const offset = source.baseRevision - 4;
  assert.ok(offset >= 0 && offset < 4, "finale recovery must not replay a confirmed story action");
  assert.equal(playerInput, FINALE_INPUTS[offset]);
  const state = source.canonicalState;
  assert.equal(state.inventory.find((entry) => entry.ownerId === "lin-an" && entry.itemId === "rice").quantity, 2);
  assert.equal(state.commitments["rice-return"].status, "open");
  if (offset === 1) assert.equal(state.finale.candidate.candidateId, "desktop-ending-1");
  if (offset === 2) {
    assert.equal(state.finale.phase, "idle");
    assert.equal(state.finale.lastDeclined.candidate.candidateId, "desktop-ending-1");
  }
  if (offset === 3) {
    assert.equal(state.finale.phase, "candidate_pending");
    assert.equal(state.finale.candidate.candidateId, "desktop-ending-2");
  }
  const id = ["finale-proposed-1", "finale-declined", "finale-proposed-2", "finale-confirmed"][offset];
  const type = offset === 1 ? "finale.decline" : offset === 3 ? "finale.confirm" : "finale.propose";
  const candidateId = offset < 2 ? "desktop-ending-1" : "desktop-ending-2";
  const data = type === "finale.propose" ? { candidateId, closureReason: "玩家希望在借米后收束这一段故事，并要求先确认。",
    closedThreads: ["这一段求助已经得到回应，两袋米已借到。"],
    intentionalOpenThreads: ["次日向陈姨归还两袋米的约定仍保留。"], finaleTone: "平静而留有余地" } : { candidateId };
  return bundle(id, FINALE_TEXTS[offset], [{ id: `${id}-event`, type, sourceSegmentIds: [id], data }]);
}

function generateSpecialFixture(request, evidence, phase) {
  assert.ok(!phase.endsWith("_archive"), "offline archive viewing cannot call a model");
  const branch = phase.startsWith("special_grey") ? "grey" : "standard";
  const jsonMessages = request.messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } });
  const chapter = jsonMessages.find((value) => value?.task === "summarize_chapter" || value?.task === "merge_chapter");
  if (chapter) {
    assert.ok(phase.endsWith("_restore"));
    evidence.chapterModelCalls += 1;
    assert.equal(evidence.chapterModelCalls, 1);
    assert.deepEqual(chapter.range, { fromRevision: 1, toRevision: 7 });
    const source = chapter.sources.find((entry) => entry.revision === 7 && entry.text === SPECIAL_ENDINGS[branch]);
    assert.ok(source);
    const sources = [{ revision: source.revision, segmentId: source.segmentId }];
    return { text: JSON.stringify({ title: "楼道里的终章", summary: "林安曾撤回一次决定，重新作出虚构角色的选择后，这段故事在楼道里收束。",
      keyEvents: [{ text: "这段故事已经收束。", sources }], openThreads: [{ text: "原先归还两袋米的约定仍未履行。", sources }] }),
      toolCalls: [], usage: { input_tokens: 100, output_tokens: 100 }, finishReason: "stop", model: "synthetic-local" };
  }
  const source = jsonMessages.find((value) => value?.canonicalState);
  assert.ok(source);
  const playerInput = request.messages.find((message) => message.content?.startsWith("Current player action:\n"))?.content.slice("Current player action:\n".length);
  evidence.modelCalls += 1;
  const reservationMessage = request.messages.find((message) => message.content?.startsWith("ENGINE TERMINAL RESERVATION: "));
  const state = source.canonicalState;
  assert.equal(state.inventory.find((entry) => entry.ownerId === "lin-an" && entry.itemId === "rice").quantity, 2);
  assert.equal(state.commitments["rice-return"].status, "open");
  let generated;
  if (reservationMessage) {
    const reservation = JSON.parse(reservationMessage.content.slice("ENGINE TERMINAL RESERVATION: ".length).split(". This outcome")[0]);
    assert.deepEqual(reservation, { candidateId: "special-choice-2", outcome: branch === "grey" ? "grey_crow_view" : "standard_extreme_ending" });
    assert.equal(source.baseRevision, 6);
    assert.equal(playerInput, SPECIAL_INPUTS[6]);
    evidence.terminalClosingCalls = (evidence.terminalClosingCalls || 0) + 1;
    if (!phase.endsWith("_restore")) {
      evidence.terminalFailureInjected = true;
      throw new Error("PRIVATE_TERMINAL_PROVIDER_FAILURE");
    }
    assert.equal(evidence.modelCalls, 1, "resuming a reserved terminal may not reinterpret the third confirmation");
    generated = bundle("special-closed", SPECIAL_ENDINGS[branch], [
      { id: "special-player-condition", type: "entity.update", sourceSegmentIds: ["special-closed"],
        data: { id: "lin-an", attributes: { status: SPECIAL_PLAYER_CONDITION[branch] } } },
      { id: "special-final-confirm", type: "extreme.confirm", sourceSegmentIds: ["special-closed"], data: { candidateId: "special-choice-2" } },
    ]);
  } else {
    assert.ok(!phase.endsWith("_restore"), "a restored reservation must already accompany the first model request");
    const index = source.baseRevision;
    assert.ok(index >= 0 && index <= 6);
    assert.equal(playerInput, SPECIAL_INPUTS[index]);
    if (index === 6) {
      assert.equal(state.finale.candidate.confirmations.length, 2);
      generated = { terminalIntent: { candidateId: "special-choice-2" } };
      evidence.terminalIntentCalls = (evidence.terminalIntentCalls || 0) + 1;
    } else {
      const candidateId = index <= 2 ? "special-choice-1" : "special-choice-2";
      const id = `special-step-${index + 1}`;
      let events = [];
      if ([0, 3].includes(index)) events = [{ id: `${id}-event`, type: "extreme.propose", sourceSegmentIds: [id],
        data: { candidateId, characterId: "lin-an", intentReason: "PRIVATE_SPECIAL_INTENT", fictionalContext: "PRIVATE_FICTIONAL_CONTEXT" } }];
      if ([2, 4, 5].includes(index)) events = [{ id: `${id}-event`, type: index === 2 ? "extreme.cancel" : "extreme.confirm", sourceSegmentIds: [id], data: { candidateId } }];
      if (index === 1 || index === 2) assert.equal(state.finale.candidate.confirmations.length, 0, "ambiguity does not count as confirmation");
      if (index === 3) assert.equal(state.finale.phase, "idle", "withdrawal returns to free play");
      if (index === 5) assert.equal(state.finale.candidate.confirmations.length, 1);
      generated = bundle(id, SPECIAL_TEXTS[index], events);
    }
  }
  return { text: JSON.stringify(generated), toolCalls: [], usage: { input_tokens: 120, output_tokens: 90 }, finishReason: "stop", model: "synthetic-local" };
}

function generateFixture(source, playerInput) {
  const state = source.canonicalState;
  const opening = state.opening;
  if (source.baseRevision === 0) {
    assert.equal(opening.phase, "creating");
    assert.deepEqual(state.entities, {});
    assert.equal(state.situation.playerId, null);
    assert.equal(playerInput, "开始新冒险");
    return bundle("question", QUESTION);
  }
  if (source.baseRevision === 1) {
    assert.equal(opening.phase, "creating");
    assert.equal(playerInput, PLAYER_DESCRIPTION);
    const proposed = readyState();
    // New proposals use sourced body records; the old fixture-only status is
    // neither supported by this summary nor part of the player's setup.
    delete proposed.entities["lin-an"].attributes.status;
    return bundle("summary", SUMMARY, [{ id: "propose-opening", type: "opening.propose", sourceSegmentIds: ["summary"],
      data: { proposalId: "desktop-opening", initialState: proposed } }]);
  }
  if (source.baseRevision === 2) {
    assert.equal(opening.phase, "awaiting_confirmation");
    assert.equal(opening.proposal.proposalId, "desktop-opening");
    assert.equal(opening.proposal.summary.revision, 2);
    assert.equal(state.situation.playerId, null);
    assert.equal(playerInput, PLAYER_CONFIRMATION);
    return bundle("confirmed", CONFIRMED, [{ id: "confirm-opening", type: "opening.confirm", sourceSegmentIds: ["confirmed"],
      data: { proposalId: "desktop-opening" } }]);
  }
  assert.equal(source.baseRevision, 3, "unexpected extra model turn or structural repair");
  assert.equal(opening.phase, "ready");
  assert.equal(playerInput, PLAYER_BORROW);
  assert.equal(state.situation.playerId, "lin-an");
  const borrowed = bundle("borrowed", BORROWED, [
    { id: "give-rice", type: "inventory.transfer", sourceSegmentIds: ["borrowed"], data: { fromId: "chen", toId: "lin-an", itemId: "rice", quantity: 2 } },
    { id: "promise-rice", type: "commitment.create", sourceSegmentIds: ["borrowed"], data: { commitment: {
      id: "rice-return", debtorId: "lin-an", creditorId: "chen", itemId: "rice", quantity: 2, due: "第十一天", status: "open" } } },
  ], [{ id: "rice-experience", text: "陈姨借给林安两袋米，林安约定次日归还。", kind: "event", knownBy: ["lin-an", "chen"],
    entityIds: ["lin-an", "chen", "rice"], eventIds: ["give-rice", "promise-rice"], sourceSegmentIds: ["borrowed"] }]);
  borrowed.narration.push({ id: "borrowed-tail", text: BORROWED_TAIL });
  return borrowed;
}

function bundle(id, text, events = [], experiences = []) { return { narration: [{ id, text }], events, experiences }; }
function readyState() {
  const entity = (id, kind, name, visibility = "player", attributes = {}) => ({ id, kind, name, visibility, attributes, aliases: [] });
  return { entities: {
    "lin-an": entity("lin-an", "character", "林安", "player", { occupation: "社区志愿者", keepsake: "母亲的一段记忆", status: "清醒" }),
    chen: entity("chen", "character", "陈姨", "player", { relationship: "邻居" }),
    hallway: entity("hallway", "location", "陈姨家门外的楼道"), rice: entity("rice", "item", "袋装米"),
    unseen: entity("unseen", "character", "隐藏访客", "hidden"), "hidden-key": entity("hidden-key", "item", "隐藏钥匙", "hidden"),
  }, inventory: [{ ownerId: "chen", itemId: "rice", quantity: 3 }, { ownerId: "lin-an", itemId: "hidden-key", quantity: 1 }],
  commitments: {}, situation: { playerId: "lin-an", locationId: "hallway", day: 10 } };
}

async function runSettingsControls(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "settings-fixture.json"), "utf8"));
  const { adventureId, locale } = fixture;
  const revision = locale === "zh-CN" ? 3 : 2;
  const contextWindow = locale === "zh-CN" ? 224000 : 128000;
  await waitFor(win, "persisted verified synthetic connection ready", `(async () => (await window.greyCrow.getStatus()).keyVerified && !document.querySelector('#continueGameButton').disabled)()`);
  const originalPolicy = (await readStatus(win)).settings.agent.context;
  assert.equal(originalPolicy.configuredContextWindow, contextWindow);
  await click(win, "#continueGameButton");
  await waitSettingsRevision(win, adventureId, revision, SETTINGS_TEXT[locale].replies[revision - 1]);
  assert.equal((await readStatus(win)).keyVerified, true);
  if (evidence.phase === "settings_controls_roundtrip") {
    assert.equal(locale, "zh-CN");
    await saveSettingsSelection(win, evidence, { preset: "short" }, revision);
    await click(win, "#closeSettingsButton");
    await saveSettingsSelection(win, evidence, { preset: "custom", target: 360 }, revision);
    await click(win, "#closeSettingsButton");
  }
  await click(win, "#gameSettingsButton"); await click(win, "#settingsTabNarration");
  await waitFor(win, "verified connection caption agrees with status", `document.querySelector('#settingsStatus').textContent === t('settings.status.verified')`);
  const narrationControls = await evaluate(win, `({locale:document.documentElement.lang,
    caption:document.querySelector('#settingsStatus').textContent,
    captionHasStaticTranslation:document.querySelector('#settingsStatus').hasAttribute('data-i18n'),
    preset:document.querySelector('#narrationLengthPresetSelect').value,
    target:document.querySelector('#narrationCustomTargetInput').value,
    targetLabel:document.querySelector('label[for="narrationCustomTargetInput"]').textContent})`);
  assert.equal(narrationControls.locale, locale); assert.equal(narrationControls.preset, "custom");
  assert.equal(narrationControls.target, "360"); assert.equal(narrationControls.captionHasStaticTranslation, false);
  if (locale === "en-US") assert.equal(narrationControls.targetLabel, "Target characters");
  evidence.narrationControls = narrationControls;
  await screenshot(win, tempRoot, `${evidence.phase.replaceAll("_", "-")}-${locale}-narration`, evidence);
  await click(win, "#settingsTabDeveloper");
  await waitFor(win, "developer settings tab visible", `!document.querySelector('#settingsPanelDeveloper').hidden`);
  const contextControls = await evaluate(win, `({text:document.querySelector('#contextPolicyStatus').textContent,
    hasStaticTranslation:document.querySelector('#contextPolicyStatus').hasAttribute('data-i18n'),
    window:state.configuredContextWindow,customWindow:document.querySelector('#contextWindowCustomInput').value,
    selected:document.querySelector('#contextWindowPresetSelect').value,ratio:state.autoCompactRatio,
    selectedRatio:document.querySelector('#autoCompactRatioSelect').value})`);
  evidence.contextControls = contextControls;
  assert.equal(contextControls.window, contextWindow); assert.equal(contextControls.customWindow, String(contextWindow));
  assert.equal(contextControls.selected, contextWindow === 128000 ? "128000" : "custom",
    "the persisted context window must select the matching control after restarting");
  assert.equal(contextControls.ratio, originalPolicy.autoCompactRatio);
  assert.equal(contextControls.selectedRatio, [0.65, 0.75, 0.85].includes(originalPolicy.autoCompactRatio) ? String(originalPolicy.autoCompactRatio) : "custom");
  assert.equal(contextControls.hasStaticTranslation, false);
  assert.ok(contextControls.text.includes(`${contextWindow / 1000}k`), `current context policy: ${contextControls.text}`);
  assert.match(contextControls.text, { "zh-CN": /行动前.*自动整理/, "en-US": /before an action/i, "ja-JP": /行動前/ }[locale]);
  await screenshot(win, tempRoot, `${evidence.phase.replaceAll("_", "-")}-${locale}-context`, evidence);
  await click(win, "#closeSettingsButton");
  const status = await readStatus(win);
  assert.equal(status.activeSave.revision, revision); assert.equal(status.keyVerified, true);
  assert.equal(status.settings.agent.context.configuredContextWindow, contextWindow);
  assert.equal(status.settings.agent.context.autoCompactRatio, originalPolicy.autoCompactRatio);
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0); assert.equal(evidence.chapterModelCalls, 0);
  assert.equal(evidence.probeCalls, 0); assert.equal(evidence.settingsSaves?.length || 0, evidence.phase === "settings_controls_roundtrip" ? 2 : 0);
  assert.equal(evidence.contextRecoveries.at(-1).latestActual, null);
  return { ...evidence, adventureId, locale, revision, originalPolicy, narrationControls, contextControls, viewport: await viewport(win) };
}

async function runSettingsPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "settings-fixture.json"), "utf8"));
  const { locale, adventureId } = fixture;
  const strings = SETTINGS_TEXT[locale];
  const first = ["settings_setup", "settings_locale"].includes(evidence.phase);
  if (first) {
    await click(win, "#menuLanguageToggle");
    await click(win, { "zh-CN": "#mainMenuLocaleZh", "en-US": "#mainMenuLocaleEn", "ja-JP": "#mainMenuLocaleJa" }[locale]);
    await waitFor(win, "selected interface locale settled", `document.documentElement.lang === ${JSON.stringify(locale)} && document.querySelector('#localeTransitionCurtain').dataset.phase === 'idle'`);
    await connectSyntheticModel(win);
    await click(win, "#settingsTabDisplay");
    if (locale === "zh-CN") {
      await click(win, "#settingsTabAudio");
      await change(win, "#ttsProviderSelect", "kokoro-original-local"); await change(win, "#ttsReadingModeSelect", "auto");
    }
    await click(win, "#settingsTabNarration"); await change(win, "#narrationLengthPresetSelect", "short");
    await click(win, "#settingsTabDeveloper"); await change(win, "#contextWindowPresetSelect", "128000");
    await click(win, "#saveSettingsButton");
    await waitFor(win, "initial settings persisted", `(async () => { const s=await window.greyCrow.getStatus();
      return s.settings.narration.lengthPreset === 'short' && s.settings.agent.context.configuredContextWindow === 128000 && !state.settingsSaving; })()`);
    await screenshot(win, tempRoot, `settings-${locale}-initial-controls`, evidence);
    await click(win, "#closeSettingsButton");
  } else if (!(await readStatus(win)).keyVerified) {
    await connectSyntheticModel(win); await click(win, "#closeSettingsButton");
  }
  await waitFor(win, "settings fixture is continuable", `!document.querySelector('#continueGameButton').disabled`);
  await click(win, "#continueGameButton");
  const startingRevision = first ? 0 : evidence.phase === "settings_change" ? 2 : 3;
  await waitSettingsRevision(win, adventureId, startingRevision, startingRevision ? strings.replies[startingRevision - 1] : "");
  await waitUntil("read-only context recovery receipt", () => evidence.contextRecoveries?.length > 0);
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0);
  const initialContext = evidence.contextRecoveries.at(-1);
  assert.equal(initialContext.latestActual, null);
  assert.equal(initialContext.lastInvocation ?? null, null, "fresh runtime does not present persisted billing as this request's actual context");
  await assertSettingsMeter(win, initialContext, startingRevision, evidence, "initialRecovery");
  await assertPersistedContextControls(win, (await readStatus(win)).settings.agent.context, evidence, "initialRecovery");
  if (locale === "zh-CN") {
    assert.deepEqual(await evaluate(win, `({provider:document.querySelector('#ttsProviderSelect').value,
      enabled:state.ttsEnabled,auto:state.ttsAuto})`), { provider: "kokoro-original-local", enabled: true, auto: true });
  }
  if (first) {
    await submitSettingsTurn(win, evidence, fixture, strings.short, strings.replies[0], 1);
    await saveSettingsSelection(win, evidence, { preset: "custom", target: 360 }, 1);
    await click(win, "#settingsTabNarration");
    assert.equal(await evaluate(win, "document.querySelector('#narrationLengthPresetSelect').value"), "custom");
    assert.equal(await evaluate(win, "document.querySelector('#narrationCustomTargetInput').value"), "360");
    assert.equal(await evaluate(win, "document.documentElement.lang"), locale);
    await screenshot(win, tempRoot, `settings-${locale}-custom-controls`, evidence);
    await click(win, "#closeSettingsButton");
    await submitSettingsTurn(win, evidence, fixture, strings.custom, strings.replies[1], 2);
    assert.equal(evidence.modelCalls, 2);
    assert.equal(evidence.ttsRequests, locale === "zh-CN" ? 2 : 0);
  } else if (evidence.phase === "settings_change") {
    await saveSettingsSelection(win, evidence, { window: 192000 }, 2);
    await click(win, "#closeSettingsButton");
    const oldSession = await readStatus(win);
    const oldMeter = await evaluate(win, "structuredClone(state.contextUsage)");
    await submit(win, strings.late);
    await waitUntil("synthetic old provider request waiting", () => settingsPendingResponses.has(tempRoot));
    assert.equal(evidence.modelCalls, 1);
    await saveSettingsSelection(win, evidence, { window: 224000 }, 2);
    await click(win, "#closeSettingsButton");
    const replacement = await readStatus(win);
    assert.notEqual(replacement.runtimeSessionId, oldSession.runtimeSessionId);
    assert.notEqual(replacement.sessionContextSettingsIdentity, oldSession.sessionContextSettingsIdentity);
    const currentMeter = await evaluate(win, "structuredClone(state.contextUsage)");
    assert.equal(currentMeter.cap, 224000); assert.notEqual(currentMeter.cap, oldMeter.cap);
    settingsPendingResponses.get(tempRoot)(); settingsPendingResponses.delete(tempRoot);
    await waitUntil("old request returned without committing", () => (evidence.turnReceipts || []).length >= 1);
    await delay(500);
    assert.equal(evidence.lateProviderReleased, true); assert.equal(evidence.lateProviderAborted, true);
    assert.equal((await readStatus(win)).activeSave.revision, 2);
    assert.deepEqual(await evaluate(win, "structuredClone(state.contextUsage)"), currentMeter,
      "a delayed response from the closed runtime must not replace the current settings estimate");
    assert.equal((await evaluate(win, "document.querySelector('#narrationPanel').textContent")).includes(strings.lateReply), false);
    assert.equal(evidence.ttsRequests, 0);
    evidence.lateUsageIsolation = { revision: 2, priorSession: oldSession.runtimeSessionId,
      currentSession: replacement.runtimeSessionId, meterUnchanged: true, modelCalls: evidence.modelCalls, ttsRequests: evidence.ttsRequests };
    await submitSettingsTurn(win, evidence, fixture, strings.tools, strings.replies[2], 3);
    const receipt = evidence.turnReceipts.findLast((entry) => entry.actionResult?.status === "committed");
    assert.equal(receipt.actionResult.usage.input_tokens, 20000);
    assert.equal(receipt.actionResult.modelCalls, 2);
    assert.equal(receipt.actionResult.contextUsage.scope, "invocation");
    assert.equal(receipt.actionResult.contextUsage.revision, 2);
    assert.equal(receipt.actionResult.contextUsage.latestActual.inputTokens, 11000);
    assert.equal(receipt.actionResult.contextUsage.peak.actualInputTokens, 11000);
    assert.notEqual((await evaluate(win, "state.contextUsage.used")), 20000);
    assert.equal(evidence.modelCalls, 3); assert.equal(evidence.ttsRequests, 1);
    evidence.twoCallUsage = { cumulative: receipt.actionResult.usage, invocation: receipt.actionResult.contextUsage,
      nextRequest: receipt.contextUsage, displayed: await evaluate(win, "structuredClone(state.contextUsage)") };
  } else {
    assert.equal(evidence.phase, "settings_restore");
    const status = await readStatus(win);
    assert.equal(status.settings.narration.lengthPreset, "custom"); assert.equal(status.settings.narration.customTargetChars, 360);
    assert.equal(status.settings.agent.context.configuredContextWindow, 224000);
    assert.equal(await evaluate(win, "state.contextUsage.latestActualInputTokens"), null);
    await delay(500); assert.equal(evidence.modelCalls, 0); assert.equal(evidence.ttsRequests, 0);
    evidence.restartedEstimateHasNoActual = true;
  }
  assert.equal(evidence.chapterModelCalls, 0);
  const status = await readStatus(win);
  const narration = await evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'), node => node.textContent)");
  for (const expected of strings.replies.slice(0, status.activeSave.revision)) assert.equal(narration.filter((text) => text === expected).length, 1);
  await evaluate(win, "document.querySelector('#contextMeter').focus()");
  await screenshot(win, tempRoot, `${evidence.phase}-${locale}-meter`, evidence);
  return { ...evidence, locale, adventureId, revision: status.activeSave.revision, viewport: await viewport(win) };
}

async function waitSettingsRevision(win, adventureId, revision, text = "") {
  await waitFor(win, `settings adventure revision ${revision}`, `(async () => { const s=await window.greyCrow.getStatus();
    return s.activeSaveId === ${JSON.stringify(adventureId)} && s.activeSave?.revision === ${revision} && s.gameStarted && !s.sessionRecoveryRequired
      && !document.querySelector('#sendTurnButton').disabled && document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(text)}); })()`);
}

async function submitSettingsTurn(win, evidence, fixture, input, text, revision) {
  const beforeTts = evidence.ttsRequests;
  await submit(win, input);
  await waitSettingsRevision(win, fixture.adventureId, revision, text);
  await waitUntil("settings turn receipt", () => evidence.turnReceipts?.some((entry) => entry.actionResult?.revision === revision));
  if (fixture.locale === "zh-CN") await waitUntil("fresh settings story automatically read", () => evidence.ttsRequests === beforeTts + 1);
  const receipt = evidence.turnReceipts.findLast((entry) => entry.actionResult?.revision === revision);
  assert.equal(receipt.actionResult.status, "committed");
  await assertSettingsMeter(win, receipt.contextUsage, revision, evidence, `turn${revision}`);
}

async function saveSettingsSelection(win, evidence, selection, revision) {
  const before = await readStatus(win);
  const calls = evidence.modelCalls; const speech = evidence.ttsRequests; const recoveries = evidence.contextRecoveries.length;
  await click(win, "#gameSettingsButton");
  if (selection.preset) {
    await click(win, "#settingsTabNarration"); await change(win, "#narrationLengthPresetSelect", selection.preset);
    if (selection.target) await change(win, "#narrationCustomTargetInput", String(selection.target), "input");
  }
  if (selection.window) {
    await click(win, "#settingsTabDeveloper"); await change(win, "#contextWindowPresetSelect", "custom");
    await change(win, "#contextWindowCustomInput", String(selection.window), "input");
  }
  await click(win, "#saveSettingsButton");
  await waitFor(win, "settings applied through current Session context", `(async () => { const s=await window.greyCrow.getStatus();
    return s.runtimeSessionId !== ${JSON.stringify(before.runtimeSessionId)} && s.activeSave?.revision === ${revision}
      && !s.sessionRecoveryRequired && !state.settingsSaving && ${selection.preset ? `s.settings.narration.lengthPreset === ${JSON.stringify(selection.preset)}` : `s.settings.agent.context.configuredContextWindow === ${selection.window}`}; })()`);
  await waitUntil("settings rebuild read-only recovery receipt", () => evidence.contextRecoveries.length > recoveries);
  const next = evidence.contextRecoveries.at(-1);
  await assertSettingsMeter(win, next, revision, evidence, `settingsSave${evidence.settingsSaves.length}`);
  assert.equal(next.latestActual, null); assert.equal(next.lastInvocation ?? null, null);
  assert.equal(evidence.modelCalls, calls); assert.equal(evidence.ttsRequests, speech);
  assert.equal(evidence.settingsSaves.at(-1).ok, true);
  const after = await readStatus(win);
  assert.equal(after.settings.agent.context.configuredContextWindow,
    selection.window ?? before.settings.agent.context.configuredContextWindow,
    "saving narration preferences cannot change the persisted context window");
  assert.equal(after.settings.agent.context.autoCompactRatio, before.settings.agent.context.autoCompactRatio,
    "saving narration or a context window cannot change the existing compaction ratio");
  await assertPersistedContextControls(win, after.settings.agent.context, evidence, `settingsSave${evidence.settingsSaves.length}`);
  evidence.settingsRecoveryZeroCalls = (evidence.settingsRecoveryZeroCalls || 0) + 1;
}

async function assertPersistedContextControls(win, policy, evidence, label) {
  const controls = await evaluate(win, `({window:state.configuredContextWindow,
    selected:document.querySelector('#contextWindowPresetSelect').value,
    windows:Array.from(document.querySelector('#contextWindowPresetSelect').options, option => option.value),
    customWindow:document.querySelector('#contextWindowCustomInput').value,
    ratio:state.autoCompactRatio,selectedRatio:document.querySelector('#autoCompactRatioSelect').value,
    ratios:Array.from(document.querySelector('#autoCompactRatioSelect').options, option => option.value)})`);
  assert.equal(controls.window, policy.configuredContextWindow);
  assert.equal(controls.customWindow, String(policy.configuredContextWindow));
  assert.equal(controls.selected, controls.windows.includes(String(policy.configuredContextWindow)) ? String(policy.configuredContextWindow) : "custom",
    "a fresh renderer and settings rebuild must show the persisted context window");
  assert.equal(controls.ratio, policy.autoCompactRatio);
  assert.equal(controls.selectedRatio, controls.ratios.includes(String(policy.autoCompactRatio)) ? String(policy.autoCompactRatio) : "custom",
    "the selected compaction ratio must agree with its persisted value");
  (evidence.persistedContextControls ||= []).push({ label, policy, controls });
}

async function assertSettingsMeter(win, context, revision, evidence, label) {
  assert.equal(context.scope, "next_request"); assert.equal(context.actionId, null); assert.equal(context.revision, revision);
  assert.equal(context.latestActual, null); assert.equal(context.compactionAvailable, true); assert.equal(context.fits, true);
  const status = await readStatus(win);
  assert.equal(context.settingsIdentity, status.sessionContextSettingsIdentity);
  assert.equal(context.sessionId, status.runtimeSessionId);
  await waitFor(win, "single next request conservative estimate displayed", `state.contextUsage?.used === ${context.latestEstimate.safetyInputTokens}
    && state.contextUsage.cap === ${context.policy.effectiveContextWindow} && state.contextUsage.settingsIdentity === ${JSON.stringify(context.settingsIdentity)}`);
  const meter = await evaluate(win, `({usage:structuredClone(state.contextUsage),percent:document.querySelector('#contextUsagePercent').textContent,
    detail:document.querySelector('#contextUsageDetail').textContent,status:document.querySelector('#contextUsageStatus').textContent,
    fill:document.querySelector('#contextMeterBloodFill').getAttribute('height')})`);
  assert.equal(meter.usage.reestimating, undefined);
  assert.equal(meter.usage.ratio, context.latestEstimate.safetyInputTokens / context.policy.effectiveContextWindow);
  assert.equal(meter.percent, `${Math.round(meter.usage.ratio * 100)}%`);
  assert.ok(Number(meter.fill) > 0, "the rendered blood drop contains its current estimate");
  assert.ok(!/pending|处理中|重新估算|reestimating/i.test(meter.detail));
  (evidence.contextChecks ||= []).push({ label, context, meter });
}

async function runSetup(win, evidence, tempRoot) {
  const initialSessionId = (await readStatus(win)).runtimeSessionId;
  await click(win, "#menuLanguageToggle");
  await click(win, "#mainMenuLocaleZh");
  await waitFor(win, "Chinese menu", `document.documentElement.lang === 'zh-CN' && document.querySelector('#localeTransitionCurtain').dataset.phase === 'idle'`);
  await connectSyntheticModel(win);
  await click(win, "#settingsTabDisplay");
  assert.equal(await evaluate(win, "state.gameUiLayout"), "story-notebook-v1");
  await click(win, "#settingsTabAudio");
  await change(win, "#ttsReadingModeSelect", "auto");
  await click(win, "#saveSettingsButton");
  await waitFor(win, "audio and notebook settings saved", `(async () => {
    const status = await window.greyCrow.getStatus();
    return status.settings.audio.tts.enabled && status.settings.audio.tts.autoPlay &&
      status.settings.ui.gameUiLayout === 'story-notebook-v1'; })()`);
  await click(win, "#closeSettingsButton");
  await resize(win);
  await click(win, "#newGameButton");
  await waitFor(win, "content catalog", `document.querySelector('#newGameSetupDialog').open && Boolean(document.querySelector('#newGamePresetSelect').value)`);
  assert.equal(evidence.modelCalls, 0);
  await click(win, "#prepareNewGameButton");
  await waitFor(win, "review content before creation", `!document.querySelector('#newGameReviewPanel').classList.contains('hidden') && /确认.*创建/.test(document.querySelector('#prepareNewGameButton').textContent)`);
  assert.equal(evidence.modelCalls, 0, "menu content confirmation is separate from model opening confirmation");
  await click(win, "#prepareNewGameButton");
  await expectTurn(win, QUESTION, 1, "creating", evidence, 1);
  const first = await readStatus(win);
  assert.equal(first.activeSave.state_hint.scene.location, null);
  evidence.worldTitle = await evaluate(win, "document.querySelector('#storyNotebookWorldTitle').textContent.trim()");
  assert.ok(evidence.worldTitle.includes("上海"));
  await screenshot(win, tempRoot, "opening-question", evidence);
  await submit(win, PLAYER_DESCRIPTION);
  await expectTurn(win, SUMMARY, 2, "awaiting_confirmation", evidence, 2);
  const proposed = await readStatus(win);
  assert.equal(proposed.activeSave.state_hint.scene.location, null);
  assert.equal(proposed.activeSave.state_hint.opening.proposal.summary.revision, 2);
  assert.equal(JSON.stringify(proposed).includes("隐藏访客"), false);
  await screenshot(win, tempRoot, "opening-summary", evidence);
  await submit(win, PLAYER_CONFIRMATION);
  await expectTurn(win, CONFIRMED, 3, "ready", evidence, 3);
  await submit(win, PLAYER_BORROW);
  await expectTurn(win, BORROWED, 4, "ready", evidence, 4);
  await waitFor(win, "both committed borrowing paragraphs remain separately visible", `(() => {
    const paragraphs = Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'), node => node.textContent);
    return paragraphs.includes(${JSON.stringify(BORROWED)}) && paragraphs.includes(${JSON.stringify(BORROWED_TAIL)});
  })()`);
  assert.deepEqual(evidence.borrowedEnvelope.segments.map((segment) => segment.content), [BORROWED, BORROWED_TAIL]);
  assert.deepEqual(evidence.ttsUtteranceTexts, [QUESTION, SUMMARY, CONFIRMED, `${BORROWED} ${BORROWED_TAIL}`],
    "the actual start-tts-utterance request must contain the whole turn in original paragraph order");
  evidence.automaticNarrationTtsRequests = evidence.ttsRequests;
  const paragraphsBeforeRepeat = await evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-text'), node => node.textContent)");
  await evaluate(win, `renderEnvelope(${JSON.stringify(evidence.borrowedEnvelope)})`);
  await delay(200);
  evidence.repeatedEnvelopeTtsRequests = evidence.ttsRequests - evidence.automaticNarrationTtsRequests;
  assert.equal(evidence.repeatedEnvelopeTtsRequests, 0);
  assert.deepEqual(await evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-text'), node => node.textContent)"), paragraphsBeforeRepeat);
  assert.equal(await evaluate(win, "document.querySelector('#narrationPanel .narration-line.host:last-child .narration-text').textContent"), BORROWED_TAIL);
  await click(win, "#narrationPanel .narration-line.host:last-child .tts-line-button");
  await waitUntil("explicit single-paragraph replay", () => evidence.ttsRequests > evidence.automaticNarrationTtsRequests);
  evidence.manualSegmentTtsRequests = evidence.ttsRequests - evidence.automaticNarrationTtsRequests;
  assert.equal(evidence.manualSegmentTtsRequests, 1);
  assert.deepEqual(evidence.ttsUtteranceTexts.slice(4), [BORROWED_TAIL], "manual replay must read only the clicked paragraph");
  const borrowed = await readStatus(win);
  assert.equal(borrowed.activeSave.state_hint.inventory.count, 1);
  assert.equal(borrowed.activeSave.state_hint.active_events.count, 1);
  assert.equal(borrowed.activeSave.state_hint.scene.location, "陈姨家门外的楼道");
  await screenshot(win, tempRoot, "borrowed-story", evidence);
  await checkManualChapterSave(win, evidence, tempRoot, initialSessionId);
  const beforeSettingsTts = evidence.ttsRequests;
  const beforeSettingsModel = evidence.modelCalls;
  await click(win, "#gameSettingsButton");
  await waitFor(win, "settings during active adventure", `document.querySelector('#settingsDialog').open`);
  await click(win, "#settingsTabNarration");
  await change(win, "#narrationLengthPresetSelect", "detailed");
  await click(win, "#saveSettingsButton");
  await waitFor(win, "settings replace runtime and restore committed view", `(async () => {
    const status = await window.greyCrow.getStatus();
    return status.runtimeSessionId !== ${JSON.stringify(borrowed.runtimeSessionId)} && status.activeSave?.revision === 4 &&
      status.settings.narration.lengthPreset === 'detailed' && status.sessionRecoveryRequired === false;
  })()`);
  await click(win, "#closeSettingsButton");
  await expectRecovered(win, borrowed.activeSaveId, evidence);
  evidence.settingsRecoveryTtsRequests = evidence.ttsRequests - beforeSettingsTts;
  evidence.settingsRecoveryModelCalls = evidence.modelCalls - beforeSettingsModel;
  evidence.runtimeGenerationChanged = (await readStatus(win)).runtimeSessionId !== borrowed.runtimeSessionId;
  assert.equal(evidence.settingsRecoveryTtsRequests, 0);
  assert.equal(evidence.settingsRecoveryModelCalls, 0);
  assert.equal(evidence.runtimeGenerationChanged, true);
  await screenshot(win, tempRoot, "settings-recovery", evidence);
  await checkPanels(win, evidence, tempRoot, "setup");
  const before = evidence.ttsRequests;
  const beforeLeaveSession = (await readStatus(win)).runtimeSessionId;
  await click(win, "#gameSettingsButton");
  await waitFor(win, "settings before leaving", `document.querySelector('#settingsDialog').open`);
  await click(win, "#backToMenuButton");
  await waitFor(win, "leave back to menu", `!document.querySelector('#menuView').classList.contains('hidden') && !document.querySelector('#settingsDialog').open`);
  assert.equal((await readStatus(win)).gameStarted, false);
  evidence.leaveRuntimeGenerationChanged = (await readStatus(win)).runtimeSessionId !== beforeLeaveSession;
  assert.equal(evidence.leaveRuntimeGenerationChanged, true);
  await click(win, "#continueGameButton");
  await expectRecovered(win, borrowed.activeSaveId, evidence);
  evidence.sameProcessRecoveryTtsRequests = evidence.ttsRequests - before;
  assert.equal(evidence.sameProcessRecoveryTtsRequests, 0);
  const saves = await evaluate(win, "window.greyCrow.listSaveSlots()");
  assert.equal(saves.saves.length, 1);
  assert.equal(saves.saves[0].schemaKind, "session");
  const saveRoot = path.join(tempRoot, "data", "saves", borrowed.activeSaveId);
  const names = fs.readdirSync(saveRoot);
  assert.ok(names.includes("session.sqlite"));
  assert.ok(!names.some((name) => ["state.json", "meta.json", "save-schema.json", "transcript", "memory", "modules"].includes(name)));
  await screenshot(win, tempRoot, "same-process-recovery", evidence);
  return { ...evidence, adventureId: borrowed.activeSaveId, revision: 4, viewport: await viewport(win), legacyFilesWritten: false };
}

async function runRestore(win, evidence, tempRoot) {
  const setup = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "setup.json"), "utf8"));
  evidence.worldTitle = setup.worldTitle;
  await waitFor(win, "restored save catalog", `(async () => (await window.greyCrow.listSaveSlots()).saves?.length === 1)()`);
  if (!(await readStatus(win)).keyVerified) {
    await connectSyntheticModel(win);
    await click(win, "#closeSettingsButton");
  }
  await resize(win);
  const before = evidence.ttsRequests;
  await click(win, "#continueGameButton");
  await expectRecovered(win, setup.adventureId, evidence);
  await checkPanels(win, evidence, tempRoot, "restored");
  await checkSavedChapter(win, evidence, tempRoot, "restored");
  assert.deepEqual(evidence.chapter, setup.chapter);
  assert.equal(evidence.ttsRequests - before, 0);
  assert.equal(evidence.modelCalls, 0);
  assert.equal(evidence.chapterModelCalls, 0);
  await screenshot(win, tempRoot, "restarted-story", evidence);
  return { ...evidence, adventureId: setup.adventureId, revision: 4, viewport: await viewport(win) };
}

async function openExistingAdventure(win, evidence, tempRoot) {
  const setup = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "setup.json"), "utf8"));
  evidence.worldTitle = setup.worldTitle;
  await waitFor(win, "existing synthetic adventure catalog", `(async () => (await window.greyCrow.listSaveSlots()).saves?.length === 1)()`);
  if (!(await readStatus(win)).keyVerified) {
    await connectSyntheticModel(win);
    await click(win, "#closeSettingsButton");
  }
  await resize(win);
  await click(win, "#continueGameButton");
  return setup.adventureId;
}

async function runFinale(win, evidence, tempRoot) {
  const adventureId = await openExistingAdventure(win, evidence, tempRoot);
  await expectRecovered(win, adventureId, evidence);
  const audio = await evaluate(win, `({provider:state.ttsProvider,
    enabled:state.ttsEnabled,autoPlay:state.ttsAuto,runtimeProvider:state.ttsProvider})`);
  assert.deepEqual(audio, { provider: "kokoro-original-local", enabled: true, autoPlay: true, runtimeProvider: "kokoro-original-local" },
    "a fresh renderer must retain the persisted speech settings before the next committed turn");
  evidence.restoredAudio = audio;
  assert.equal(evidence.modelCalls, 0);
  assert.equal(evidence.chapterModelCalls, 0);
  assert.equal(evidence.ttsRequests, 0);
  for (let index = 0; index < 3; index += 1) {
    await submit(win, FINALE_INPUTS[index]);
    await expectTurn(win, FINALE_TEXTS[index], index + 5, "ready", evidence, index + 1);
    assert.equal(evidence.chapterModelCalls, 0, "a proposed or declined ending cannot start final archiving");
  }
  await screenshot(win, tempRoot, "finale-reproposed", evidence);
  await submit(win, FINALE_INPUTS[3]);
  await waitFor(win, "committed ending visible while derived chapter is pending", `state.activeSave?.revision === 8
    && !state.busy && isSessionDerivedBusy() && getStoryFinalePhase() === 'finalizing'
    && document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(FINALE_TEXTS[3])})`);
  assert.equal(evidence.finaleTimeoutObserved, undefined, "The story must arrive before the chapter timeout");
  evidence.committedBeforeChapterSettled = await evaluate(win, `({ revision: state.activeSave.revision, busy: state.busy,
    derivedBusy: isSessionDerivedBusy(), phase: getStoryFinalePhase(), resumeDisabled: document.querySelector('#storyResumeFinaleButton').disabled,
    endingRows: [...document.querySelectorAll('.narration-line')].filter(row => row.textContent.includes(${JSON.stringify(FINALE_TEXTS[3])})).length })`);
  assert.equal(evidence.committedBeforeChapterSettled.resumeDisabled, true);
  assert.equal(evidence.committedBeforeChapterSettled.endingRows, 1);
  await screenshot(win, tempRoot, "finale-committed-chapter-pending", evidence);
  await expectFinaleLocked(win, "recovery_required", adventureId);
  await waitUntil("fresh confirmed ending spoken once", () => evidence.ttsRequests >= 4);
  assert.equal(evidence.modelCalls, 4);
  assert.equal(evidence.chapterModelCalls, 1);
  assert.equal(evidence.finaleTimeoutObserved, true);
  assert.equal(evidence.ttsRequests, 4);
  await assertFinaleNarration(win);
  const status = await readStatus(win);
  assert.equal(status.activeSave.state_hint.inventory.count, 1);
  assert.equal(status.activeSave.state_hint.active_events.count, 1);
  await screenshot(win, tempRoot, "finale-timeout-recovery", evidence);
  return { ...evidence, adventureId, revision: 8, viewport: await viewport(win) };
}

async function runFinaleRestore(win, evidence, tempRoot) {
  const adventureId = await openExistingAdventure(win, evidence, tempRoot);
  await expectFinaleLocked(win, "recovery_required", adventureId);
  await delay(800);
  assert.equal(evidence.modelCalls, 0);
  assert.equal(evidence.chapterModelCalls, 0, "opening an unfinished archive cannot make a paid request automatically");
  assert.equal(evidence.ttsRequests, 0);
  await assertFinaleNarration(win);
  await screenshot(win, tempRoot, "finale-pending-restart", evidence);
  await click(win, "#storyResumeFinaleButton");
  await expectFinaleLocked(win, "closed", adventureId);
  assert.equal(evidence.modelCalls, 0);
  assert.equal(evidence.chapterModelCalls, 1, "resuming archiving generates only the unfinished chapter");
  assert.equal(evidence.ttsRequests, 0);
  await assertFinaleNarration(win);
  const status = await readStatus(win);
  const response = await evaluate(win, `window.greyCrow.getChapterLogs(${JSON.stringify({
    adventureId, sessionId: status.runtimeSessionId, revision: 8 })})`);
  assert.equal(response.ok, true);
  assert.equal(response.result.revision, 8);
  assert.equal(response.result.chapters.length, 2);
  const finalChapter = response.result.chapters.find((chapter) => chapter.chapter_id === "chapter-8");
  assert.equal(finalChapter.title, FINALE_CHAPTER_TITLE);
  assert.equal(finalChapter.summary, FINALE_CHAPTER_SUMMARY);
  assert.equal(finalChapter.generation.mode, "model");
  assert.deepEqual(finalChapter.turn_range, { start: 5, end: 8 });
  assert.deepEqual(finalChapter.sources.open_threads[0].sources, [{ revision: 8, segmentId: "finale-confirmed" }]);
  evidence.finalChapter = finalChapter;
  const slots = await evaluate(win, "window.greyCrow.listSaveSlots()");
  assert.equal(slots.saves[0].compatibility.status, "closed");
  assert.equal(slots.saves[0].compatibility.playerContinuable, false);
  assert.equal(slots.saves[0].catalogRole, "archive");
  await screenshot(win, tempRoot, "finale-closed", evidence);
  await click(win, "#storyNotebookChaptersButton");
  await waitFor(win, "final archived chapter readable", `document.querySelectorAll('#storyNotebookDrawerBody .chapter-card').length === 2 &&
    document.querySelector('#storyNotebookDrawerBody').textContent.includes(${JSON.stringify(FINALE_CHAPTER_TITLE)})`);
  await screenshot(win, tempRoot, "finale-chapters", evidence);
  await closeNotebookDrawer(win);
  await click(win, "#gameSettingsButton");
  await waitFor(win, "settings before opening the closed archive", `document.querySelector('#settingsDialog').open`);
  await click(win, "#backToMenuButton");
  await waitFor(win, "closed story appears in the menu archive", `!document.querySelector('#menuView').classList.contains('hidden') &&
    !document.querySelector('#settingsDialog').open && Boolean(document.querySelector('.save-slot.story-archive-slot'))`);
  await click(win, `.save-slot.story-archive-slot[data-save-id="${adventureId}"]`);
  await expectFinaleLocked(win, "closed", adventureId);
  await assertFinaleNarration(win);
  assert.equal(evidence.modelCalls, 0);
  assert.equal(evidence.chapterModelCalls, 1);
  evidence.closedArchiveReopened = true;
  await screenshot(win, tempRoot, "finale-menu-archive", evidence);
  await click(win, "#gameSettingsButton");
  await waitFor(win, "settings for clearing this synthetic credential", `document.querySelector('#settingsDialog').open`);
  await click(win, "#settingsTabAi");
  await click(win, "#clearKeyButton");
  await waitFor(win, "synthetic credential removed through the real settings flow", `(async () => !(await window.greyCrow.getStatus()).keyVerified)()`);
  await click(win, "#closeSettingsButton");
  evidence.credentialCleared = true;
  assert.equal(evidence.ttsRequests, 0);
  return { ...evidence, adventureId, revision: 8, viewport: await viewport(win) };
}

async function runClosedRestore(win, evidence, tempRoot) {
  const saved = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "finale_restore.json"), "utf8"));
  evidence.worldTitle = saved.worldTitle;
  await waitFor(win, "closed archive available without credentials", `(async () => {
    const status = await window.greyCrow.getStatus();
    return !status.keyVerified && (await window.greyCrow.listSaveSlots()).saves?.[0]?.compatibility.status === 'closed'; })()`);
  await resize(win);
  await click(win, `.save-slot.story-archive-slot[data-save-id="${saved.adventureId}"]`);
  await expectFinaleLocked(win, "closed", saved.adventureId);
  await assertFinaleNarration(win);
  assert.equal((await readStatus(win)).keyVerified, false);
  await click(win, "#storyNotebookChaptersButton");
  await waitFor(win, "both archived chapters readable without a model credential", `document.querySelectorAll('#storyNotebookDrawerBody .chapter-card').length === 2 &&
    document.querySelector('#storyNotebookDrawerBody').textContent.includes(${JSON.stringify(FINALE_CHAPTER_TITLE)})`);
  await screenshot(win, tempRoot, "finale-closed-no-credential", evidence);
  await closeNotebookDrawer(win);
  assert.equal(evidence.modelCalls, 0);
  assert.equal(evidence.chapterModelCalls, 0);
  assert.equal(evidence.ttsRequests, 0);
  return { ...evidence, adventureId: saved.adventureId, revision: 8, keyVerified: false, viewport: await viewport(win) };
}

async function runContinuationPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "continuation-fixture.json"), "utf8"));
  if (evidence.phase === "continuation_create") {
    await click(win, "#menuLanguageToggle"); await click(win, "#mainMenuLocaleZh");
    await waitFor(win, "Chinese continuation interface", `document.documentElement.lang === 'zh-CN' && document.querySelector('#localeTransitionCurtain').dataset.phase === 'idle'`);
    await connectSyntheticModel(win);
    await click(win, "#settingsTabDisplay");
    await click(win, "#settingsTabAudio");
    await change(win, "#ttsProviderSelect", "kokoro-original-local"); await change(win, "#ttsReadingModeSelect", "auto");
    await click(win, "#settingsTabDeveloper"); await change(win, "#contextWindowPresetSelect", "128000");
    await click(win, "#settingsTabSave"); await change(win, "#compactionChapterSelect", "false");
    await click(win, "#saveSettingsButton");
    await waitFor(win, "continuation audio configuration", `(async () => {const s=await window.greyCrow.getStatus();return s.settings.audio.tts.enabled && s.settings.audio.tts.autoPlay && s.settings.ui.gameUiLayout === 'story-notebook-v1';})()`);
    await click(win, "#closeSettingsButton");
    await openContinuationArchive(win, fixture.adventureId, 45);
    const parent = await readStatus(win);
    assert.equal(parent.activeSave.state_hint.time.turn, 45);
    await waitFor(win, "real ordinary continuation button", `!document.querySelector('#storyContinueButton').hidden && !document.querySelector('#storyContinueButton').disabled`);
    const beforeRequest = evidence.continuationRequests.length;
    await click(win, "#storyContinueButton");
    await waitFor(win, "new child at system boundary", `(async () => {const s=await window.greyCrow.getStatus();return s.activeSaveId !== ${JSON.stringify(fixture.adventureId)} && s.activeSave?.revision === 46 && !document.querySelector('#sendTurnButton').disabled;})()`);
    await waitUntil("real continuation receipt observed", () => evidence.continuationRequests.length > beforeRequest);
    const automatic = evidence.continuationRequests.slice(beforeRequest).find((entry) => entry.ok);
    assert.ok(automatic);
    assert.match(automatic.request.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(automatic.request.adventureId, fixture.adventureId);
    assert.equal(automatic.request.sessionId, parent.runtimeSessionId);
    assert.equal(automatic.request.revision, 45);
    assert.equal(automatic.request.sourceFinaleId, "finale-45");
    const child = await readStatus(win);
    assert.equal(child.activeSave.state_hint.time.turn, 45, "the system boundary is not a player turn");
    assert.equal(child.activeSave.state_hint.inventory.count, 1);
    assert.equal(child.activeSave.state_hint.active_events.count, 1);
    if (process.env.GREY_CROW_CONTINUATION_CHECK_LOST_RECEIPT === "1") {
      assert.equal(evidence.lostContinuationReceipt.count, 1);
      assert.equal(evidence.recoveryRequests.length, 1);
      assert.equal(evidence.continuationRequests.length, 1, "recovery reads the existing child instead of forking again");
      assert.deepEqual(evidence.lostContinuationReceipt.request, automatic.request);
      assert.equal(child.activeSave.continuation.requestId, automatic.request.requestId);
      assert.equal(await evaluate(win, "state.pendingContinuationRequest === null"), true);
      evidence.recoveredSameChild = true;
    } else {
      const replay = await evaluate(win, `window.greyCrow.continueStoryArchive(${JSON.stringify(automatic.request)})`);
      assert.equal(replay.ok, true); assert.equal(replay.continuation.childAdventureId, child.activeSaveId);
      evidence.replayedSameChild = true;
    }
    for (const changes of [{ requestId: "different-request" }, { sessionId: "old-session" }, { revision: 44 }, { sourceFinaleId: "finale-44" }]) {
      const rejected = await evaluate(win, `window.greyCrow.continueStoryArchive(${JSON.stringify({ ...automatic.request, ...changes })})`);
      assert.equal(rejected.ok, false); assert.ok(rejected.stale || rejected.error);
    }
    assert.deepEqual(await continuationHosts(win), fixture.history.slice(-20).map((entry) => entry.host));
    assert.equal(await evaluate(win, "document.querySelectorAll('#narrationPanel .narration-line.player').length"), 20);
    assert.equal(await evaluate(win, "document.querySelectorAll('#narrationPanel .continuation-divider').length"), 1);
    await click(win, "#storyNotebookChaptersButton");
    await waitFor(win, "empty continuation manual save", `Boolean(document.querySelector('[data-session-chapter-save]:not(:disabled)'))`);
    const beforeSave = evidence.manualSaves.length;
    await click(win, "[data-session-chapter-save]");
    await waitUntil("real manual save receipt", () => evidence.manualSaves.length > beforeSave);
    const save = evidence.manualSaves.at(-1).result;
    assert.equal(save.ok, true); assert.equal(save.result.chapterStatus, "unchanged");
    assert.equal(save.result.chapter_generated, false);
    await waitFor(win, "manual save returns input control", `!document.querySelector('#sendTurnButton').disabled && Boolean(document.querySelector('[data-session-chapter-save]:not(:disabled)'))`);
    await closeNotebookDrawer(win);
    assert.equal((await readStatus(win)).activeSave.revision, 46);
    assert.deepEqual(fileEvidence(fixture.databasePath), fixture.databaseEvidence);
    assertContinuationCalls(evidence, 0, 0, 0);
    await screenshot(win, tempRoot, "continuation-created-no-story", evidence);
    return { ...evidence, adventureId: child.activeSaveId, revision: 46, request: automatic.request, viewport: await viewport(win) };
  }
  const created = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "continuation_create.json"), "utf8"));
  if (evidence.phase === "continuation_play") {
    assert.equal((await readStatus(win)).keyVerified, true);
    await waitFor(win, "independent child listed after restart", `(async () => (await window.greyCrow.listSaveSlots()).saves.some(save=>save.id===${JSON.stringify(created.adventureId)} && save.compatibility.status !== 'closed'))()`);
    await click(win, "#continueGameButton");
    await waitFor(win, "child restored without generating", `(async () => {const s=await window.greyCrow.getStatus();return s.activeSaveId===${JSON.stringify(created.adventureId)} && s.activeSave.revision===46 && !document.querySelector('#sendTurnButton').disabled;})()`);
    assert.equal((await readStatus(win)).activeSave.state_hint.time.turn, 45);
    assertContinuationCalls(evidence, 0, 0, 0);
    const childPath = path.join(tempRoot, "data", "saves", created.adventureId, "session.sqlite");
    const beforeCompaction = readContinuationStore(childPath);
    await openCompactionControl(win); await click(win, "#confirmCompactButton");
    await waitFor(win, "continuation original prefix compacted through the real service", "!state.busy && state.pendingSessionCompaction?.status==='reduced' && !document.querySelector('#compactDialog').open");
    const requestId = await evaluate(win, "state.pendingSessionCompaction.requestId");
    const status = await readStatus(win);
    const compact = await evaluate(win, `window.greyCrow.readContextCompaction(${JSON.stringify({ adventureId: created.adventureId,
      sessionId: status.runtimeSessionId, revision: 46, requestId })})`);
    assert.equal(compact.ok, true); assert.equal(compact.compaction.status, "reduced");
    assert.equal(compact.compaction.revision, 46); assert.equal(compact.compaction.modelCalls, 0);
    assert.ok(compact.compaction.savedSafetyInputTokens > 0);
    assert.equal(compact.contextUsage.contextGeneration, 1); assert.equal(compact.contextUsage.revision, 46);
    assert.equal(evidence.compactionModelCalls, 1); assertContinuationCalls(evidence, 0, 0, 0);
    assert.deepEqual(readContinuationStore(childPath), beforeCompaction, "compaction cannot rewrite any story turn, fact or chapter");
    assert.deepEqual(fileEvidence(fixture.databasePath), fixture.databaseEvidence);
    evidence.compaction = { requestId, status: compact.compaction.status, revision: 46, contextGeneration: compact.contextUsage.contextGeneration,
      savedSafetyInputTokens: compact.compaction.savedSafetyInputTokens, storyUnchanged: true, readbackModelCalls: 0 };
    await screenshot(win, tempRoot, "continuation-prefix-compacted", evidence);
    await waitFor(win, "continuation input restored after compaction", "!document.querySelector('#settingsDialog').open && !document.querySelector('#sendTurnButton').disabled");
    for (let index = 0; index < 3; index++) {
      await submit(win, CONTINUATION_INPUTS[index]);
      await waitFor(win, `continuation story commit ${47 + index}`, `(async () => {const s=await window.greyCrow.getStatus();return s.activeSave?.revision===${47 + index} &&
        document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(CONTINUATION_TEXTS[index])}) &&
        ${index === 2 ? "s.activeSave.compatibility.status==='closed' && document.querySelector('#turnForm').hidden" : "!document.querySelector('#sendTurnButton').disabled"};})()`);
      await waitUntil(`new continuation speech ${index + 1}`, () => evidence.ttsRequests >= index + 1);
      assert.equal(evidence.ttsRequests, index + 1);
      const current = await readStatus(win);
      assert.equal(current.activeSave.state_hint.time.turn, 46 + index);
      assert.equal(current.activeSave.state_hint.inventory.count, 0);
      assert.equal(current.activeSave.state_hint.active_events.count, 0);
      if (index === 0) {
        await checkContinuationInventory(win, false);
        await screenshot(win, tempRoot, "continuation-rice-returned", evidence);
      }
    }
    const hosts = await continuationHosts(win);
    for (const text of CONTINUATION_TEXTS) assert.equal(hosts.filter((value) => value === text).length, 1);
    const players = await evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-line.player .narration-text'),node=>node.textContent)");
    for (const input of CONTINUATION_INPUTS) assert.equal(players.filter((value) => value.includes(input)).length, 1);
    await checkContinuationChapters(win, fixture.chapters.concat(CONTINUATION_CHAPTER), evidence);
    assertContinuationCalls(evidence, 3, 1, 3);
    await screenshot(win, tempRoot, "continuation-closed", evidence);
    await click(win, "#gameSettingsButton"); await click(win, "#settingsTabAi"); await click(win, "#clearKeyButton");
    await waitFor(win, "synthetic credential removed before offline restart", `(async () => !(await window.greyCrow.getStatus()).keyVerified)()`);
    await click(win, "#closeSettingsButton");
    return { ...evidence, adventureId: created.adventureId, revision: 49, keyVerified: false, viewport: await viewport(win) };
  }
  assert.equal((await readStatus(win)).keyVerified, false);
  await openContinuationArchive(win, created.adventureId, 49);
  assert.equal((await readStatus(win)).activeSave.state_hint.time.turn, 48);
  const history = fixture.history.concat(CONTINUATION_TEXTS.map((host, index) => ({ host, player: CONTINUATION_INPUTS[index] })));
  evidence.historyPageCounts = [(await continuationHosts(win)).length];
  while (await evaluate(win, "Boolean(document.querySelector('#sessionHistoryMore'))")) {
    const before = (await continuationHosts(win)).length;
    await click(win, "#sessionHistoryMore");
    await waitFor(win, "older original continuation history page", `document.querySelectorAll('#narrationPanel .narration-line.host').length > ${before} && (!document.querySelector('#sessionHistoryMore') || !document.querySelector('#sessionHistoryMore').disabled)`);
    evidence.historyPageCounts.push((await continuationHosts(win)).length);
  }
  assert.deepEqual(await continuationHosts(win), history.map((turn) => turn.host));
  assert.equal(await evaluate(win, "document.querySelectorAll('#narrationPanel .narration-line.player').length"), 48);
  assert.equal(await evaluate(win, "document.querySelectorAll('#narrationPanel .continuation-divider').length"), 1);
  const bindingStatus = await readStatus(win);
  const historyBinding = { adventureId: created.adventureId, sessionId: bindingStatus.runtimeSessionId, revision: 49, limit: 20 };
  const records = []; let beforeRevision;
  do {
    const page = await evaluate(win, `window.greyCrow.readSessionHistory(${JSON.stringify({ ...historyBinding, ...(beforeRevision ? { beforeRevision } : {}) })})`);
    assert.equal(page.ok, true); assert.equal(page.revision, 49);
    records.unshift(...page.history); beforeRevision = page.nextBeforeRevision;
    assert.equal(page.complete, beforeRevision === null);
  } while (beforeRevision);
  assert.equal(records.length, 48);
  assert.equal(records.some((record) => record.revision === 46), false);
  assert.deepEqual(records.map((record) => record.storyTurn), Array.from({ length: 48 }, (_, index) => index + 1));
  assert.ok(records.slice(0, 45).every((record) => record.source.adventureId === fixture.adventureId));
  assert.ok(records.slice(45).every((record) => record.source.adventureId === created.adventureId));
  evidence.historySources = records.map(({ revision, storyTurn, source }) => ({ revision, storyTurn, source }));
  await checkContinuationChapters(win, fixture.chapters.concat(CONTINUATION_CHAPTER), evidence);
  evidence.exports = await exportCurrentStory(win, evidence, tempRoot, "continuation-child", { history, chapters: fixture.chapters.concat(CONTINUATION_CHAPTER) });
  for (const output of evidence.exports) {
    const body = fs.readFileSync(output.outputPath, "utf8");
    assert.equal((body.match(/续篇开始/g) || []).length, 1);
    assert.doesNotMatch(body, /parent-segment-|continuation-return|continuation-confirm/);
  }
  await screenshot(win, tempRoot, "continuation-offline-export", evidence);
  await click(win, "#storyArchiveBackButton");
  await openContinuationArchive(win, fixture.adventureId, 45);
  const parent = await readStatus(win);
  assert.equal(parent.activeSave.state_hint.time.turn, 45);
  assert.equal(parent.activeSave.state_hint.inventory.count, 1); assert.equal(parent.activeSave.state_hint.active_events.count, 1);
  await checkContinuationInventory(win, true);
  await checkContinuationBlocked(win, evidence, "PROVIDER_NOT_READY");
  assertContinuationCalls(evidence, 0, 0, 0);
  assert.deepEqual(fileEvidence(fixture.databasePath), fixture.databaseEvidence);
  await screenshot(win, tempRoot, "continuation-parent-still-independent", evidence);
  return { ...evidence, adventureId: created.adventureId, revision: 49, parentVerified: true, keyVerified: false, viewport: await viewport(win) };
}

function assertContinuationCalls(evidence, story, chapter, speech) {
  assert.equal(evidence.modelCalls, story); assert.equal(evidence.chapterModelCalls, chapter); assert.equal(evidence.ttsRequests, speech);
}

async function continuationHosts(win) {
  return evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'),node=>node.textContent)");
}

async function openContinuationArchive(win, adventureId, revision) {
  await waitFor(win, "ordinary archive listed", `Boolean(document.querySelector(${JSON.stringify(`.save-slot.story-archive-slot[data-save-id="${adventureId}"]`)}))`);
  await click(win, `.save-slot.story-archive-slot[data-save-id="${adventureId}"]`);
  await waitFor(win, "ordinary archive opened at fixed revision", `(async () => {const s=await window.greyCrow.getStatus();return s.activeSaveId===${JSON.stringify(adventureId)} && s.activeSave?.revision===${revision} && s.activeSave.compatibility.status==='closed' && document.querySelector('#turnForm').hidden && !document.querySelector('#storyArchiveFooter').hidden;})()`);
}

async function checkContinuationInventory(win, hasRice) {
  await click(win, "#storyNotebookModulesButton");
  await waitFor(win, "continuation inventory card", `Boolean(document.querySelector('[data-panel-ref="session_inventory"]'))`);
  await click(win, '[data-panel-ref="session_inventory"]');
  await waitFor(win, "continuation inventory listing", `Boolean(document.querySelector('.story-notebook-panel-list-action[data-field-id="inventory"]'))`);
  await click(win, '.story-notebook-panel-list-action[data-field-id="inventory"]');
  await waitFor(win, "inventory records loaded", `!document.querySelector('#storyNotebookDrawerStatus').textContent.includes('读取')`);
  if (hasRice) {
    await waitFor(win, "parent still owns two borrowed bags", `document.querySelector('#storyNotebookDrawerBody').textContent.includes('数量: 2')`);
    await click(win, ".story-notebook-panel-record");
    await waitFor(win, "parent promise still open", `document.querySelector('#storyNotebookDrawerBody').textContent.includes('尚待履行') && document.querySelector('#storyNotebookDrawerBody').textContent.includes('陈姨')`);
  } else {
    await waitFor(win, "returned rice no longer in player inventory", `document.querySelectorAll('#storyNotebookDrawerBody .story-notebook-panel-record').length === 0`);
    assert.ok(!(await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent")).includes("数量: 2"));
  }
  assert.doesNotMatch(await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent"), /隐藏访客|隐藏钥匙/);
  await closeNotebookDrawer(win);
}

async function checkContinuationChapters(win, expected, evidence) {
  await click(win, "#storyNotebookChaptersButton");
  await waitFor(win, "first twelve continuation chapters", `document.querySelectorAll('#storyNotebookDrawerBody .chapter-card').length === 12 && Boolean(document.querySelector('[data-session-chapter-more]:not(:disabled)'))`);
  await click(win, "[data-session-chapter-more]");
  await waitFor(win, "all independent continuation chapters", `document.querySelectorAll('#storyNotebookDrawerBody .chapter-card').length === ${expected.length} && !document.querySelector('[data-session-chapter-more]')`);
  const text = await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent");
  for (const chapter of expected) assert.ok(text.includes(chapter.title));
  const status = await readStatus(win);
  const binding = { adventureId: status.activeSaveId, sessionId: status.runtimeSessionId, revision: status.activeSave.revision };
  const chapters = []; let cursor;
  do {
    const response = await evaluate(win, `window.greyCrow.getChapterLogs(${JSON.stringify({ ...binding, ...(cursor ? { cursor } : {}), limit: 12 })})`);
    assert.equal(response.ok, true); assert.equal(response.result.revision, binding.revision);
    chapters.push(...response.result.chapters); cursor = response.result.nextCursor;
    assert.equal(response.result.complete, cursor === null);
  } while (cursor);
  assert.equal(chapters.length, expected.length);
  for (const chapter of chapters.slice(0, 15)) assert.equal(chapter.source.adventureId, "continuation-parent");
  const last = chapters.at(-1);
  assert.deepEqual(last.turn_range, { start: 47, end: 49 });
  assert.deepEqual(last.story_turn_range, { start: 46, end: 48 });
  assert.equal(last.source.adventureId, binding.adventureId);
  assert.ok(last.sources.key_events.every((event) => event.sources.every((source) => source.source.adventureId === binding.adventureId)));
  evidence.chapterPageCounts = [12, chapters.length];
  evidence.chapterSources = chapters.map(({ chapter_id, source, turn_range, story_turn_range }) => ({ chapter_id, source, turn_range, story_turn_range }));
  await closeNotebookDrawer(win);
}

async function runSpecialPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "special-fixture.json"), "utf8"));
  const { adventureId, branch } = fixture;
  const archived = evidence.phase.endsWith("_archive");
  const restoring = evidence.phase.endsWith("_restore");
  if (!archived && !restoring) {
    await click(win, "#menuLanguageToggle");
    await click(win, "#mainMenuLocaleZh");
    await waitFor(win, "special Chinese interface", `document.documentElement.lang === 'zh-CN' && document.querySelector('#localeTransitionCurtain').dataset.phase === 'idle'`);
    await connectSyntheticModel(win);
    await click(win, "#settingsTabDisplay");
    assert.equal(await evaluate(win, "state.gameUiLayout"), "story-notebook-v1");
    await click(win, "#settingsTabAudio");
    await change(win, "#ttsProviderSelect", "kokoro-original-local");
    await change(win, "#ttsReadingModeSelect", "auto");
    await click(win, "#saveSettingsButton");
    await waitFor(win, "special audio configuration saved", `(async () => {const s=await window.greyCrow.getStatus(); return s.settings.audio.tts.enabled && s.settings.audio.tts.autoPlay && s.settings.ui.gameUiLayout === 'story-notebook-v1';})()`);
    await click(win, "#closeSettingsButton");
  }
  await resize(win);
  await waitFor(win, "special synthetic save listed", `(async () => (await window.greyCrow.listSaveSlots()).saves?.some(save => save.id === ${JSON.stringify(adventureId)}))()`);
  if (archived) {
    assert.equal((await readStatus(win)).keyVerified, false);
    await click(win, `.save-slot.story-archive-slot[data-save-id="${adventureId}"]`);
    await expectSpecialClosed(win, adventureId, branch);
    await checkContinuationBlocked(win, evidence, "ADVENTURE_CONTINUATION_FORBIDDEN");
    await checkSpecialDiscovery(win, evidence, tempRoot, branch, "offline");
    evidence.exports = await exportCurrentStory(win, evidence, tempRoot, `special-${branch}`, {
      history: [...SPECIAL_TEXTS, SPECIAL_ENDINGS[branch]].map((host) => ({ host })),
      chapters: [{ title: "楼道里的终章", summary: "林安曾撤回一次决定，重新作出虚构角色的选择后，这段故事在楼道里收束。" }],
    });
    assert.equal(evidence.modelCalls, 0); assert.equal(evidence.chapterModelCalls, 0); assert.equal(evidence.ttsRequests, 0);
    await screenshot(win, tempRoot, `special-${branch}-offline-export`, evidence);
    return { ...evidence, adventureId, revision: 7, keyVerified: false, viewport: await viewport(win) };
  }
  await waitFor(win, "special persisted connection and continue entry ready", `(async () => (await window.greyCrow.getStatus()).keyVerified && !document.querySelector('#continueGameButton').disabled)()`);
  await click(win, "#continueGameButton");
  await waitFor(win, "special adventure restored without generation", `(async () => {const s=await window.greyCrow.getStatus();return s.activeSaveId === ${JSON.stringify(adventureId)} && s.activeSave?.revision === ${restoring ? 6 : 0};})()`);
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.chapterModelCalls, 0); assert.equal(evidence.ttsRequests, 0);
  if (!restoring) {
    for (let index = 0; index < 6; index += 1) {
      await submit(win, SPECIAL_INPUTS[index]);
      await waitFor(win, `special confirmation stage ${index + 1} committed`, `(async () => {const s=await window.greyCrow.getStatus();return s.activeSave?.revision === ${index + 1} && !document.querySelector('#sendTurnButton').disabled && document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(SPECIAL_TEXTS[index])});})()`);
      await waitUntil("one automatic speech request for this confirmed narration", () => evidence.ttsRequests === index + 1);
      assert.equal(evidence.modelCalls, index + 1);
      assert.equal(evidence.chapterModelCalls, 0);
      await assertNoSpecialDiscovery(win);
    }
    await screenshot(win, tempRoot, `special-${branch}-final-question`, evidence);
    await submit(win, SPECIAL_INPUTS[6]);
    await expectSpecialReserved(win, adventureId);
    assert.equal(evidence.terminalIntentCalls, 1);
    assert.equal(evidence.terminalFailureInjected, true);
    assert.equal(evidence.modelCalls, 8);
    assert.equal(evidence.ttsRequests, 6);
    assert.equal(evidence.chapterModelCalls, 0);
    await assertNoSpecialDiscovery(win);
    assert.ok(!(await evaluate(win, "document.querySelector('#narrationPanel').textContent")).includes(SPECIAL_ENDINGS[branch]));
    await screenshot(win, tempRoot, `special-${branch}-reserved-failure`, evidence);
    return { ...evidence, adventureId, revision: 6, viewport: await viewport(win) };
  }
  await expectSpecialReserved(win, adventureId);
  await assertNoSpecialDiscovery(win);
  await delay(700);
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.chapterModelCalls, 0); assert.equal(evidence.ttsRequests, 0);
  await screenshot(win, tempRoot, `special-${branch}-reserved-restart`, evidence);
  await click(win, "#storyResumeFinaleButton");
  await expectSpecialClosed(win, adventureId, branch);
  await checkContinuationBlocked(win, evidence, "ADVENTURE_CONTINUATION_FORBIDDEN");
  await waitUntil("new recovered terminal narration spoken once", () => evidence.ttsRequests === 1);
  assert.equal(evidence.modelCalls, 1);
  assert.equal(evidence.terminalClosingCalls, 1);
  assert.equal(evidence.terminalIntentCalls || 0, 0);
  assert.equal(evidence.chapterModelCalls, 1);
  await checkSpecialDiscovery(win, evidence, tempRoot, branch, "committed");
  await screenshot(win, tempRoot, `special-${branch}-closed`, evidence);
  await click(win, "#gameSettingsButton");
  await waitFor(win, "special synthetic credential settings", `document.querySelector('#settingsDialog').open`);
  await click(win, "#settingsTabAi");
  await click(win, "#clearKeyButton");
  await waitFor(win, "special synthetic credential cleared", `(async () => !(await window.greyCrow.getStatus()).keyVerified)()`);
  await click(win, "#closeSettingsButton");
  return { ...evidence, adventureId, revision: 7, credentialCleared: true, viewport: await viewport(win) };
}

async function expectSpecialReserved(win, adventureId) {
  await waitFor(win, "durable terminal intent remains explicitly recoverable", `(async () => {const s=await window.greyCrow.getStatus();return s.activeSaveId === ${JSON.stringify(adventureId)} && s.activeSave?.revision === 6 && s.activeSave.compatibility.status === 'recovery_required' && document.querySelector('#turnForm').hidden && !document.querySelector('#storyResumeFinaleButton').hidden && !document.querySelector('#storyResumeFinaleButton').disabled;})()`);
  assert.equal(await evaluate(win, "document.querySelector('#storyArchiveTitle').textContent"), "终章尚未完成保存");
  assert.ok((await evaluate(win, "document.querySelector('#storyArchiveNotice').textContent")).includes("结局正文尚未完成"));
  assert.equal(await evaluate(win, "document.querySelector('#storyExportHtmlButton').hidden && document.querySelector('#storyContinueButton').hidden"), true);
  assert.doesNotMatch(await evaluate(win, "document.body.innerText"), /PRIVATE_|grey_crow_view|standard_extreme_ending|terminalIntent/);
}

async function checkContinuationBlocked(win, evidence, expectedCode) {
  const slotsBefore = await evaluate(win, "window.greyCrow.listSaveSlots()");
  const before = { story: evidence.modelCalls, chapter: evidence.chapterModelCalls, speech: evidence.ttsRequests };
  const result = await evaluate(win, `(async () => { const s = await window.greyCrow.getStatus();
    return window.greyCrow.continueStoryArchive({ adventureId: s.activeSaveId, sessionId: s.runtimeSessionId,
      revision: s.activeSave.revision, requestId: crypto.randomUUID(),
      sourceFinaleId: state.storyFinale.projection.closedFinale.finaleId }); })()`);
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, expectedCode);
  const slotsAfter = await evaluate(win, "window.greyCrow.listSaveSlots()");
  assert.deepEqual(slotsAfter.saves.map((save) => save.id).sort(), slotsBefore.saves.map((save) => save.id).sort());
  assert.deepEqual({ story: evidence.modelCalls, chapter: evidence.chapterModelCalls, speech: evidence.ttsRequests }, before);
  evidence.continuationDenied = expectedCode;
}

async function runContinuationBoundary(win, evidence, tempRoot) {
  const specialPath = path.join(tempRoot, "results", "special-fixture.json");
  const isSpecial = fs.existsSync(specialPath);
  const fixture = JSON.parse(fs.readFileSync(isSpecial ? specialPath : path.join(tempRoot, "results", "finale_restore.json"), "utf8"));
  await waitFor(win, "offline archive for continuation boundary", `(async () => !(await window.greyCrow.getStatus()).keyVerified && (await window.greyCrow.listSaveSlots()).saves?.some(save => save.id === ${JSON.stringify(fixture.adventureId)}))()`);
  await click(win, `.save-slot.story-archive-slot[data-save-id="${fixture.adventureId}"]`);
  if (isSpecial) {
    await expectSpecialClosed(win, fixture.adventureId, fixture.branch);
    await checkSpecialDiscovery(win, evidence, tempRoot, fixture.branch, "stable");
  }
  else await expectFinaleLocked(win, "closed", fixture.adventureId);
  await checkContinuationBlocked(win, evidence, isSpecial ? "ADVENTURE_CONTINUATION_FORBIDDEN" : "PROVIDER_NOT_READY");
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.chapterModelCalls, 0); assert.equal(evidence.ttsRequests, 0);
  assert.equal((await readStatus(win)).keyVerified, false);
  return { ...evidence, adventureId: fixture.adventureId, revision: isSpecial ? 7 : 8, keyVerified: false };
}

async function expectSpecialClosed(win, adventureId, branch) {
  await waitFor(win, "special ending completely archived", `(async () => {const s=await window.greyCrow.getStatus();return s.activeSaveId === ${JSON.stringify(adventureId)} && s.activeSave?.revision === 7 && s.activeSave.compatibility.status === 'closed' && document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(SPECIAL_ENDINGS[branch])}) && document.querySelector('#storyResumeFinaleButton').hidden;})()`);
  assert.equal(await evaluate(win, "document.querySelector('#storyArchiveTitle').textContent"), "特殊结局已收录");
  assert.equal(await evaluate(win, "document.querySelector('#turnForm').hidden && document.querySelector('#storyContinueButton').hidden && !document.querySelector('#storyExportHtmlButton').hidden"), true);
  const hosts = await evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'), node => node.textContent)");
  for (const text of [...SPECIAL_TEXTS, SPECIAL_ENDINGS[branch]]) assert.equal(hosts.filter((value) => value === text).length, 1);
  const players = await evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-line.player .narration-text'), node => node.textContent)");
  assert.equal(players.filter((text) => text.includes(SPECIAL_INPUTS[6])).length, 1, "recovered original action must add its player line only once");
  const status = await readStatus(win);
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE_|grey_crow_view|standard_extreme_ending|confirmations|terminalIntent/);
  assert.equal(status.activeSave.state_hint.active_events.count, 1);
  assert.equal(status.activeSave.state_hint.player.status, SPECIAL_PLAYER_CONDITION[branch]);
  assert.equal(status.activeSave.state_hint.player.status_label, SPECIAL_PLAYER_CONDITION[branch]);
  const hud = await evaluate(win, `(() => {const node=document.querySelector('#stateGrid [data-state-key="player"][data-state-role="value"]');return {text:node?.textContent?.trim(),visible:Boolean(node?.getClientRects().length)};})()`);
  assert.deepEqual(hud, { text: SPECIAL_PLAYER_CONDITION[branch], visible: true }, "visible player status must match the final narrative and formal projection, including offline recovery");
}

async function assertNoSpecialDiscovery(win) {
  const response = await evaluate(win, "window.greyCrow.listSkillPanels()");
  assert.equal(response.ok, true);
  assert.doesNotMatch(JSON.stringify(response), /session_grey_crow_echo|灰鸦余响|PRIVATE_|grey_crow_view|standard_extreme_ending|confirmations/);
  assert.ok(!(await evaluate(win, "document.body.innerText")).includes("灰鸦余响"));
}

async function checkSpecialDiscovery(win, evidence, tempRoot, branch, stage) {
  await click(win, "#storyNotebookModulesButton");
  await waitFor(win, "special archive notebook panels readable", `document.querySelector('#storyNotebookDrawer').classList.contains('is-open') && Boolean(document.querySelector('[data-panel-ref="session_inventory"]'))`);
  if (branch === "grey") {
    await waitFor(win, "crow discovery appears only after committed narration", `Boolean(document.querySelector('[data-panel-ref="session_grey_crow_echo"]'))`);
    await click(win, '[data-panel-ref="session_grey_crow_echo"]');
    await waitFor(win, "safe discovered guide fully loaded", `state.activeSkillPanelProjection?.panelRef === 'session_grey_crow_echo' && state.activeSkillPanelProjection.status === 'ready' && !state.skillPanelRefreshBusy && !state.skillPanelViewError && document.querySelector('#storyNotebookDrawerBody').textContent.includes('你已在这段故事中听见灰鸦的余响。') && !document.querySelector('#storyNotebookDrawerBody').textContent.includes('正在读取安全面板')`);
    const text = await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent");
    assert.doesNotMatch(text, /确认阶段|概率|三次|PRIVATE_|这个模块当前没有可展示字段/);
  } else {
    assert.equal(await evaluate(win, "Boolean(document.querySelector('[data-panel-ref=\"session_grey_crow_echo\"]'))"), false);
    await assertNoSpecialDiscovery(win);
  }
  await screenshot(win, tempRoot, `special-${branch}-${stage}-discovery`, evidence);
  await closeNotebookDrawer(win);
}

async function runArchiveExport(win, evidence, tempRoot) {
  const saved = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "finale_restore.json"), "utf8"));
  const long = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "long-fixture.json"), "utf8"));
  await waitFor(win, "both synthetic archives available offline", `(async () => !(await window.greyCrow.getStatus()).keyVerified &&
    (await window.greyCrow.listSaveSlots()).saves?.filter(save => save.compatibility.status === 'closed').length === 2)()`);
  await click(win, `.save-slot.story-archive-slot[data-save-id="${saved.adventureId}"]`);
  await expectFinaleLocked(win, "closed", saved.adventureId);
  await assertFinaleNarration(win);
  evidence.exports = await exportCurrentStory(win, evidence, tempRoot, "short-archive", {
    history: [QUESTION, SUMMARY, CONFIRMED, BORROWED_COMPLETE, ...FINALE_TEXTS].map((host) => ({ host })),
    chapters: [{ title: CHAPTER_TITLE, summary: CHAPTER_SUMMARY }, { title: FINALE_CHAPTER_TITLE, summary: FINALE_CHAPTER_SUMMARY }],
  });
  await click(win, "#storyArchiveBackButton");
  await waitFor(win, "menu for independent long archive", `!document.querySelector('#menuView').classList.contains('hidden')`);
  await click(win, `.save-slot.story-archive-slot[data-save-id="${long.adventureId}"]`);
  await waitFor(win, "long archive at its fixed final revision", `(async () => {
    const status = await window.greyCrow.getStatus();
    return status.activeSaveId === ${JSON.stringify(long.adventureId)} && status.activeSave?.revision === 45 &&
      status.activeSave.compatibility.status === 'closed' && document.querySelector('#storyArchiveTitle').textContent === '故事已封存'; })()`);
  assert.equal((await readStatus(win)).keyVerified, false);
  await waitFor(win, "latest twenty archived turns", `document.querySelectorAll('#narrationPanel .narration-line.host .narration-text').length === 20`);
  for (const count of [40, 45]) {
    await click(win, "#sessionHistoryMore");
    await waitFor(win, `archived history page to ${count}`, `document.querySelectorAll('#narrationPanel .narration-line.host .narration-text').length === ${count}`);
  }
  assert.equal(await evaluate(win, "Boolean(document.querySelector('#sessionHistoryMore'))"), false);
  assert.deepEqual(await evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'), node => node.textContent)"),
    long.history.map((entry) => entry.host), "history pages must be complete, ordered and never duplicated");
  await click(win, "#storyNotebookChaptersButton");
  await waitFor(win, "first twelve closed chapters", `document.querySelectorAll('#storyNotebookDrawerBody .chapter-card').length === 12 &&
    Boolean(document.querySelector('[data-session-chapter-more]')) && !document.querySelector('[data-session-chapter-more]').disabled`);
  evidence.chapterPageCounts = [12];
  await screenshot(win, tempRoot, "long-archive-first-chapter-page", evidence);
  await click(win, "[data-session-chapter-more]");
  await waitFor(win, "all fifteen closed chapters", `document.querySelectorAll('#storyNotebookDrawerBody .chapter-card').length === 15 &&
    !document.querySelector('[data-session-chapter-more]')`);
  evidence.chapterPageCounts.push(15);
  const chapterText = await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent");
  for (const chapter of long.chapters) assert.ok(chapterText.includes(chapter.title));
  await evaluate(win, "document.querySelector('#storyNotebookDrawerBody .chapter-card:last-child').scrollIntoView({block:'end',behavior:'instant'})");
  await screenshot(win, tempRoot, "long-archive-last-chapter-page", evidence);
  await closeNotebookDrawer(win);
  evidence.exports.push(...await exportCurrentStory(win, evidence, tempRoot, "long-archive", long));
  await screenshot(win, tempRoot, "long-archive-exported-offline", evidence);
  const status = await readStatus(win);
  assert.equal(status.activeSave.revision, 45);
  assert.equal(evidence.modelCalls, 0);
  assert.equal(evidence.chapterModelCalls, 0);
  assert.equal(evidence.ttsRequests, 0);
  assert.equal(evidence.exportDialogs.length, 4);
  assert.equal(databaseDigest(long.databasePath), long.databaseDigest);
  await renderExportedHtml(tempRoot, evidence, long);
  return { ...evidence, adventureId: long.adventureId, revision: 45, keyVerified: false, viewport: await viewport(win) };
}

async function exportCurrentStory(win, evidence, tempRoot, target, expected) {
  evidence.exportTarget = target;
  const results = [];
  for (const [extension, selector] of [["html", "#storyExportHtmlButton"], ["md", "#storyExportMarkdownButton"]]) {
    const outputPath = path.join(tempRoot, "results", `${target}.${extension}`);
    assert.equal(fs.existsSync(outputPath), false);
    await click(win, selector);
    await waitUntil(`real ${extension} export written`, () => fs.existsSync(outputPath));
    await waitFor(win, `${extension} export success displayed`, `!document.querySelector(${JSON.stringify(selector)}).disabled &&
      document.querySelector('#storyArchiveNotice').textContent.includes(${JSON.stringify(path.basename(outputPath))}) &&
      document.querySelector('#storyArchiveNotice').textContent.includes(${JSON.stringify(String(expected.history.length))})`);
    const body = fs.readFileSync(outputPath, "utf8");
    let prior = -1;
    for (const turn of expected.history) {
      // Markdown encodes each source newline as a hard break. Keep every
      // character and paragraph boundary in this comparison, without trimming.
      const exportedHost = extension === "md" ? turn.host.replace(/\n/g, "  \n") : turn.host;
      const at = body.indexOf(exportedHost, prior + 1);
      assert.ok(at > prior, `${extension} export must include every complete original passage in order`);
      assert.equal(body.indexOf(exportedHost, at + exportedHost.length), -1, "export cannot duplicate original narration");
      if (turn.player) assert.ok(body.includes(turn.player));
      prior = at;
    }
    for (const chapter of expected.chapters) { assert.ok(body.includes(chapter.title)); assert.ok(body.includes(chapter.summary)); }
    assert.doesNotMatch(body, /PRIVATE_FINALE_REASON|尚未露面的访客|未发现的钥匙|hidden_key|hidden-key|sk-synthetic-session/);
    assert.doesNotMatch(body, /long-segment-\d+|finale-confirmed/, "player exports show source turn numbers without internal segment identifiers");
    if (extension === "html") assert.equal((body.match(/<article id="turn-\d+">/g) || []).length, expected.history.length);
    results.push({ outputPath, turnCount: expected.history.length, chapterCount: expected.chapters.length, bytes: Buffer.byteLength(body) });
    assert.equal(evidence.modelCalls, 0);
    assert.equal(evidence.chapterModelCalls, 0);
    assert.equal(evidence.ttsRequests, 0);
  }
  return results;
}

async function renderExportedHtml(tempRoot, evidence, expected) {
  const { BrowserWindow } = require("electron");
  const preview = new BrowserWindow({ width: 1260, height: 820, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  const externalRequests = [];
  preview.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    externalRequests.push(details.url); callback({ cancel: true });
  });
  try {
    await preview.loadFile(path.join(tempRoot, "results", "long-archive.html"));
    const rendered = await preview.webContents.executeJavaScript(`({turns:document.querySelectorAll('article[id^="turn-"]').length,
      chapters:document.querySelectorAll('main > section:last-child article').length,
      text:document.body.textContent,overflow:document.documentElement.scrollWidth > innerWidth})`);
    assert.equal(rendered.turns, 45); assert.equal(rendered.chapters, 15); assert.equal(rendered.overflow, false);
    for (const { host } of expected.history) assert.ok(rendered.text.includes(host));
    assert.doesNotMatch(rendered.text, /PRIVATE_FINALE_REASON|尚未露面的访客|未发现的钥匙/);
    assert.deepEqual(externalRequests, []);
    await screenshot(preview, tempRoot, "long-archive-html-rendered", evidence);
    await preview.webContents.executeJavaScript("document.querySelector('main > section:last-child').scrollIntoView({block:'start',behavior:'instant'})");
    await screenshot(preview, tempRoot, "long-archive-html-chapters-rendered", evidence);
    evidence.htmlRendered = { turns: rendered.turns, chapters: rendered.chapters, externalRequests: 0, horizontalOverflow: false };
  } finally {
    preview.webContents.session.webRequest.onBeforeRequest(null);
    preview.destroy();
  }
}

async function expectFinaleLocked(win, phase, adventureId) {
  await waitFor(win, `ending ${phase} at the same committed revision`, `(async () => {
    const status = await window.greyCrow.getStatus();
    return status.activeSaveId === ${JSON.stringify(adventureId)} && status.activeSave?.revision === 8 &&
      status.activeSave.compatibility.status === ${JSON.stringify(phase)} && document.querySelector('#turnForm').hidden &&
      !document.querySelector('#storyArchiveFooter').hidden &&
      document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(FINALE_TEXTS[3])}) &&
      ${phase === "closed" ? "document.querySelector('#storyResumeFinaleButton').hidden" : "!document.querySelector('#storyResumeFinaleButton').hidden && !document.querySelector('#storyResumeFinaleButton').disabled"};
  })()`);
  const footer = await evaluate(win, `({title:document.querySelector('#storyArchiveTitle').textContent,
    notice:document.querySelector('#storyArchiveNotice').textContent,
    continueHidden:document.querySelector('#storyContinueButton').hidden})`);
  assert.equal(footer.title, phase === "closed" ? "故事已封存" : "终章尚未完成保存");
  if (phase !== "closed") {
    assert.ok(footer.notice.includes("章节封存尚未完成"), "an unfinished archive must keep its real recovery notice after localization/rendering");
    assert.ok(!footer.notice.includes("完整记录已安全保存在本机"));
  }
  assert.equal(footer.continueHidden, phase !== "closed", "only a fully archived ordinary story offers an independent continuation");
  for (const selector of ["#storyExportHtmlButton", "#storyExportMarkdownButton"]) {
    assert.equal(await evaluate(win, `document.querySelector(${JSON.stringify(selector)}).hidden`), phase !== "closed");
  }
}

async function assertFinaleNarration(win) {
  const narration = await evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'), node => node.textContent)");
  for (const expected of [QUESTION, SUMMARY, CONFIRMED, BORROWED_COMPLETE, ...FINALE_TEXTS]) {
    assert.equal(narration.filter((text) => text === expected).length, 1, "each committed ending or story passage appears once");
  }
}

async function connectSyntheticModel(win) {
  await click(win, "#settingsButton");
  await waitFor(win, "connection settings", `document.querySelector('#settingsDialog').open`);
  await click(win, "#settingsTabAi");
  await change(win, "#apiKeyInput", SYNTHETIC_KEY, "input");
  await click(win, "#testKeyButton");
  await waitFor(win, "synthetic connection verified by real credential flow", `(async () => {
    const status = await window.greyCrow.getStatus();
    return status.keyVerified && document.querySelector('#apiKeyInput').value === ''; })()`);
  assert.ok(!(await evaluate(win, "document.body.innerText")).includes(SYNTHETIC_KEY));
}

async function expectTurn(win, text, revision, phase, evidence, calls) {
  await waitFor(win, `committed revision ${revision}`, `(async () => {
    const status = await window.greyCrow.getStatus();
    return status.activeSave?.revision === ${revision} && status.activeSave.state_hint.opening.phase === ${JSON.stringify(phase)} &&
      !document.querySelector('#gameView').classList.contains('hidden') && !document.querySelector('#sendTurnButton').disabled &&
      document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(text)}); })()`);
  await waitUntil(`automatic speech for commit ${revision}`, () => evidence.ttsRequests >= calls);
  assert.equal(evidence.modelCalls, calls);
  assert.equal(evidence.ttsRequests, calls);
  const textContent = await evaluate(win, "document.querySelector('#narrationPanel').textContent");
  assert.ok(!textContent.includes("隐藏访客") && !textContent.includes("隐藏钥匙"));
  assert.ok(!textContent.includes("本轮处理失败"));
}

async function expectRecovered(win, adventureId, evidence) {
  const calls = evidence.modelCalls;
  await waitFor(win, "same saved revision and complete recovered narration", `(async () => {
    const status = await window.greyCrow.getStatus();
    return status.activeSaveId === ${JSON.stringify(adventureId)} && status.activeSave?.revision === 4 && status.gameStarted &&
      !document.querySelector('#sendTurnButton').disabled && document.querySelector('#narrationPanel').textContent.includes(${JSON.stringify(BORROWED)});
  })()`);
  // Recovery typewriter and queued speech work must have had time to execute.
  await delay(800);
  assert.equal(evidence.modelCalls, calls);
  assert.equal(await evaluate(win, "document.querySelector('#storyNotebookWorldTitle').textContent.trim()"), evidence.worldTitle,
    "restoring the adventure must preserve its confirmed localized world title");
  const narration = await evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'), node => node.textContent)");
  for (const expected of [QUESTION, SUMMARY, CONFIRMED, BORROWED_COMPLETE]) {
    assert.equal(narration.filter((text) => text === expected).length, 1, "each committed narrative appears exactly once on recovery");
  }
}

async function checkPanels(win, evidence, tempRoot, prefix) {
  await waitFor(win, "character entry", `!document.querySelector('#storyNotebookCharactersButton').hidden && !document.querySelector('#storyNotebookCharactersButton').disabled`);
  await click(win, "#storyNotebookCharactersButton");
  await waitFor(win, "known character directory", `document.querySelector('#storyNotebookDrawerBody').textContent.includes('陈姨') && document.querySelector('#storyNotebookDrawerBody').textContent.includes('林安')`);
  assert.ok(!(await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent")).includes("隐藏访客"));
  await screenshot(win, tempRoot, `${prefix}-characters`, evidence);
  await click(win, "#storyNotebookDrawerCloseButton");
  await waitFor(win, "character drawer closed", `!document.querySelector('#storyNotebookDrawer').classList.contains('is-open') && document.querySelector('#gameView').dataset.notebookPageTransition !== 'true'`);
  await click(win, "#storyNotebookModulesButton");
  await waitFor(win, "inventory panel card", `Boolean(document.querySelector('[data-panel-ref="session_inventory"]'))`);
  await click(win, '[data-panel-ref="session_inventory"]');
  await waitFor(win, "inventory record view", `Boolean(document.querySelector('.story-notebook-panel-list-action[data-field-id="inventory"]'))`);
  await click(win, '.story-notebook-panel-list-action[data-field-id="inventory"]');
  await waitFor(win, "two bags in inventory", `document.querySelector('#storyNotebookDrawerBody').textContent.includes('袋装米') && document.querySelector('#storyNotebookDrawerBody').textContent.includes('数量: 2')`);
  const panelText = await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent");
  assert.ok(!panelText.includes("隐藏钥匙"));
  await click(win, ".story-notebook-panel-record");
  await waitFor(win, "inventory detail and promise", `document.querySelector('#storyNotebookDrawerBody').textContent.includes('第十一天') && document.querySelector('#storyNotebookDrawerBody').textContent.includes('陈姨')`);
  assert.ok(!(await evaluate(win, "document.querySelector('#storyNotebookDrawerBody').textContent")).includes("这个模块当前没有可展示字段"));
  await screenshot(win, tempRoot, `${prefix}-inventory-detail`, evidence);
  await click(win, "#storyNotebookDrawerCloseButton");
  await waitFor(win, "inventory drawer closed", `!document.querySelector('#storyNotebookDrawer').classList.contains('is-open') && document.querySelector('#gameView').dataset.notebookPageTransition !== 'true'`);
  assert.equal((await readStatus(win)).activeSave.revision, 4);
}

async function readChapter(win) {
  const status = await readStatus(win);
  const binding = { adventureId: status.activeSaveId, sessionId: status.runtimeSessionId, revision: status.activeSave.revision };
  const response = await evaluate(win, `window.greyCrow.getChapterLogs(${JSON.stringify(binding)})`);
  assert.equal(response.ok, true);
  const page = response.result;
  assert.equal(page.adventureId, (await readStatus(win)).activeSaveId);
  assert.equal(page.revision, 4);
  assert.equal(page.complete, true);
  assert.equal(page.nextCursor, null);
  assert.equal(page.chapters.length, 1);
  const chapter = page.chapters[0];
  assert.equal(chapter.title, CHAPTER_TITLE);
  assert.equal(chapter.summary, CHAPTER_SUMMARY);
  assert.equal(chapter.generation.mode, "model");
  assert.deepEqual(chapter.turn_range, { start: 3, end: 4 });
  assert.deepEqual(chapter.sources.key_events[0].sources, [{ revision: 4, segmentId: "borrowed" }]);
  assert.deepEqual(chapter.sources.open_threads[0].sources, [{ revision: 4, segmentId: "borrowed" }]);
  assert.equal(chapter.autoSpeak, false);
  assert.ok(!JSON.stringify(chapter).includes("隐藏"));
  return chapter;
}

async function checkStaleChapterRequests(win, evidence, oldSessionId) {
  const current = await readStatus(win);
  const binding = { adventureId: current.activeSaveId, sessionId: current.runtimeSessionId, revision: current.activeSave.revision };
  assert.equal(binding.revision, 4);
  assert.equal(typeof oldSessionId, "string");
  assert.notEqual(oldSessionId, binding.sessionId, "the earlier menu session must be superseded before saving");
  const counts = { story: evidence.modelCalls, chapter: evidence.chapterModelCalls, speech: evidence.ttsRequests };
  evidence.staleChapterRequests = [];
  for (const [kind, changes] of [
    ["wrong_adventure", { adventureId: "save_not_current" }],
    ["old_session", { sessionId: oldSessionId }],
    ["old_revision", { revision: binding.revision - 1 }],
  ]) {
    for (const method of ["requestManualSave", "getChapterLogs"]) {
      const response = await evaluate(win, `window.greyCrow.${method}(${JSON.stringify({ ...binding, ...changes })})`);
      assert.equal(response.stale, true, `${method} must reject ${kind} at Main's boundary`);
      evidence.staleChapterRequests.push({ method, kind, stale: response.stale });
      assert.equal(evidence.modelCalls, counts.story);
      assert.equal(evidence.chapterModelCalls, counts.chapter);
      assert.equal(evidence.ttsRequests, counts.speech);
      const after = await readStatus(win);
      assert.equal(after.activeSaveId, binding.adventureId);
      assert.equal(after.runtimeSessionId, binding.sessionId);
      assert.equal(after.activeSave.revision, binding.revision);
      assert.deepEqual(after.activeSave.state_hint, current.activeSave.state_hint);
    }
  }
  const unchanged = await evaluate(win, `window.greyCrow.getChapterLogs(${JSON.stringify(binding)})`);
  assert.equal(unchanged.ok, true);
  assert.deepEqual(unchanged.result.chapters, [], "rejected saves may not create an archive");
}

async function clickManualSave(win) {
  const previousMessages = await evaluate(win, "document.querySelectorAll('#narrationPanel .narration-line.muted').length");
  await click(win, "#storyNotebookDrawerBody [data-session-chapter-save]");
  await waitFor(win, "manual save visibly completed", `document.querySelectorAll('#narrationPanel .narration-line.muted').length > ${previousMessages} &&
    !document.querySelector('#sendTurnButton').disabled && Boolean(document.querySelector('#storyNotebookDrawerBody [data-session-chapter-save]:not(:disabled)'))`);
  assert.equal((await readStatus(win)).activeSave.revision, 4);
}

async function checkManualChapterSave(win, evidence, tempRoot, oldSessionId) {
  await checkStaleChapterRequests(win, evidence, oldSessionId);
  const beforeSpeech = evidence.ttsRequests;
  await click(win, "#storyNotebookChaptersButton");
  await waitFor(win, "visible notebook save action", `Boolean(document.querySelector('#storyNotebookDrawerBody [data-session-chapter-save]:not(:disabled)'))`);
  await clickManualSave(win);
  await waitFor(win, "saved chapter rendered", `document.querySelector('#storyNotebookDrawerBody .chapter-card')?.textContent.includes(${JSON.stringify(CHAPTER_TITLE)})`);
  const chapter = await readChapter(win);
  assert.equal(evidence.chapterModelCalls, 1);
  const beforeModels = evidence.chapterModelCalls;
  await clickManualSave(win);
  evidence.repeatChapterSaveModelCalls = evidence.chapterModelCalls - beforeModels;
  assert.equal(evidence.repeatChapterSaveModelCalls, 0);
  assert.deepEqual(await readChapter(win), chapter, "repeat save returns the identical archived chapter");
  evidence.chapter = chapter;
  evidence.chapterSaveTtsRequests = evidence.ttsRequests - beforeSpeech;
  assert.equal(evidence.chapterSaveTtsRequests, 0);
  assert.equal(evidence.modelCalls, 4);
  await screenshot(win, tempRoot, "saved-chapter", evidence);
  await closeNotebookDrawer(win);
}

async function checkSavedChapter(win, evidence, tempRoot, prefix) {
  await click(win, "#storyNotebookChaptersButton");
  await waitFor(win, "archived chapter restored", `document.querySelectorAll('#storyNotebookDrawerBody .chapter-card').length === 1 &&
    document.querySelector('#storyNotebookDrawerBody .chapter-card').textContent.includes(${JSON.stringify(CHAPTER_TITLE)})`);
  evidence.chapter = await readChapter(win);
  await screenshot(win, tempRoot, `${prefix}-chapter`, evidence);
  await closeNotebookDrawer(win);
}

async function closeNotebookDrawer(win) {
  await click(win, "#storyNotebookDrawerCloseButton");
  await waitFor(win, "notebook drawer closed", `!document.querySelector('#storyNotebookDrawer').classList.contains('is-open') &&
    document.querySelector('#gameView').dataset.notebookPageTransition !== 'true'`);
}

async function waitForWindow(BrowserWindow) {
  let window;
  await waitUntil("Electron BrowserWindow", () => { window = BrowserWindow.getAllWindows()[0]; return Boolean(window); });
  return window;
}
async function evaluate(win, expression) { return win.webContents.executeJavaScript(expression, true); }
async function readStatus(win) { return evaluate(win, "window.greyCrow.getStatus()"); }
async function click(win, selector) {
  if (await evaluate(win, `Boolean(document.querySelector(${JSON.stringify(selector)})?.closest('#gameView'))`)) {
    await waitFor(win, "notebook ready for player interaction", "!isNotebookPresentationBlocked() && !ui.gameView.inert");
  }
  if (selector === "#clearKeyButton") {
    await evaluate(win, "window.confirm = () => true; true");
    if (!(await evaluate(win, "document.querySelector('#modelPrivacyDetails').open"))) {
      await click(win, "#modelPrivacyDetails > summary");
    }
  }
  if (selector === "#saveSettingsButton") {
    await waitFor(win, "automatic settings save completed", "!state.settingsSaving && !state.settingsSaveTask && !state.settingsAutosaveTimer");
    assert.equal(await evaluate(win, "state.settingsDirty"), false, "automatic settings save leaves no pending preference changes");
    return;
  }
  await settleVisuals(win);
  await evaluate(win, `(() => { const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.disabled || !node.getClientRects().length) throw new Error('Unavailable control: ' + ${JSON.stringify(selector)});
    node.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || !node.contains(hit)) throw new Error('Covered control: ' + ${JSON.stringify(selector)});
    node.click(); })()`);
}
async function change(win, selector, value, event = "change") {
  if (selector !== "#turnInput") {
    await waitFor(win, "settings input ready", "!state.settingsSaving && !state.settingsSaveTask && !state.settingsAutosaveTimer");
  }
  await settleVisuals(win);
  await evaluate(win, `(() => { const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.disabled || !node.getClientRects().length) throw new Error('Unavailable field: ' + ${JSON.stringify(selector)});
    node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true})); })()`);
}
async function submit(win, text) {
  await change(win, "#turnInput", text, "input");
  await click(win, "#sendTurnButton");
}
async function waitUntil(label, predicate, timeoutMs = UI_TIMEOUT_MS) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try { if (await predicate()) return; } catch (error) { last = error; }
    await delay(80);
  }
  throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ""}`);
}
async function waitFor(win, label, expression, timeoutMs = UI_TIMEOUT_MS) {
  try { await waitUntil(label, () => evaluate(win, expression), timeoutMs); }
  catch (error) { throw new Error(`${error.message}\n${JSON.stringify(await snapshot(win))}`); }
}
async function resize(win) {
  win.setAspectRatio(0); win.setContentSize(1260, 820, false); win.center();
  await waitFor(win, "1260 by 820 rendered viewport", "window.innerWidth === 1260 && window.innerHeight === 820");
}
async function viewport(win) { return evaluate(win, "({width:innerWidth,height:innerHeight})"); }
async function screenshot(win, tempRoot, label, evidence) {
  if (!label.endsWith("-failure")) await settleVisuals(win);
  const filename = path.join(tempRoot, "results", `${label}.png`);
  fs.writeFileSync(filename, (await win.webContents.capturePage()).toPNG());
  evidence.screenshots.push(filename);
}
async function settleVisuals(win) {
  await waitFor(win, "finite UI animations settled", `(() => {
    const game = document.querySelector('#gameView');
    if (game?.dataset.notebookPageTransition === 'true' || game?.classList.contains('is-ui-layout-switching')) return false;
    return document.getAnimations().every(animation => {
      const timing = animation.effect?.getComputedTiming();
      return !Number.isFinite(timing?.endTime) || (!animation.pending && animation.playState !== 'running');
    });
  })()`);
  await evaluate(win, "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
async function snapshot(win) {
  return evaluate(win, `({
    viewport:{width:innerWidth,height:innerHeight},
    dialogs:Array.from(document.querySelectorAll('dialog[open]'),node=>node.id),
    audio:typeof state === 'object' ? {enabled:state.ttsEnabled,autoPlay:state.ttsAuto,provider:state.ttsProvider,
      providerField:document.querySelector('#ttsProviderSelect')?.value} : null,
    messages:Object.fromEntries(['runtimeStatus','settingsStatus','newGameSetupStatus','gameStatus','menuMessage','storyNotebookDrawerStatus'].map(id=>[id,document.getElementById(id)?.textContent||''])),
    narration:document.querySelector('#narrationPanel')?.textContent||'',
    drawer:document.querySelector('#storyNotebookDrawerBody')?.textContent||''
  })`);
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function silentWav() {
  const sampleRate = 8000;
  const samples = 800;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

async function runSavePolicyCoordinator() {
  const results = [];
  for (const [locale, kind] of [["zh-CN", "success"], ["zh-CN", "timeout"], ["en-US", "controls"], ["ja-JP", "controls"]]) {
    const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
    for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
    const env = {};
    for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
      XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [ROOT_ENV]: tempRoot, GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"),
      GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"), GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
    const fixture = await createSettingsFixture(tempRoot, locale);
    const gameRoot = path.resolve(__dirname, "../../../..");
    const { readContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-reader"));
    const { createTurnStore } = require(path.join(gameRoot, "engine/session/turn-store"));
    const snapshot = await readContentSnapshot({ adventuresRoot: path.join(tempRoot, "data", "saves"), adventureId: fixture.adventureId });
    const store = createTurnStore({ ...fixture, contentVersion: snapshot.lock.overallHash });
    try {
      for (let revision = 1; revision <= 19; revision++) {
        const action = store.beginAction({ actionId: `policy-seed-${revision}`, baseRevision: revision - 1,
          input: SETTINGS_TEXT[locale].short, locale, contentVersion: snapshot.lock.overallHash });
        store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
          bundle: bundle("observed", SETTINGS_TEXT[locale].replies[0].repeat(25)) });
      }
    } finally { store.close(); }
    Object.assign(fixture, { kind });
    fs.writeFileSync(path.join(tempRoot, "results", "save-policy-fixture.json"), JSON.stringify(fixture, null, 2));
    process.stdout.write(`Save policy ${locale}/${kind} artifacts: ${tempRoot}\n`);
    const phases = kind === "controls" ? ["save_policy_controls"] : [kind === "success" ? "save_policy_play" : "save_policy_timeout", "save_policy_restart"];
    const runs = [];
    for (const phase of phases) runs.push(await runPhase(require("electron"), phase, env));
    if (kind !== "controls") {
      const restart = runs.at(-1);
      assert.equal(restart.modelCalls, 0); assert.equal(restart.chapterModelCalls, 0); assert.equal(restart.ttsRequests, 0);
      assert.equal(restart.revision, kind === "success" ? 21 : 20);
    }
    const result = { ok: true, locale, kind, tempRoot, runs,
      evidence: "Actual Main/preload/renderer, durable session child, settings controls, chapters and compaction. Providers and silent speech are local synthetic fixtures.",
      limitations: ["No real Provider, voice quality, native-language or player acceptance. Finalization preference independence and cancellation are covered by focused real-store bridge tests."] };
    fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2));
    results.push(result);
  }
  process.stdout.write(JSON.stringify({ ok: true, suite: "save-policy", results }, null, 2) + "\n");
}

async function generateSavePolicyFixture(request, evidence) {
  assert.ok(!["save_policy_restart", "save_policy_controls"].includes(evidence.phase), "read-only policy restore and control checks never call a model");
  const data = request.messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } });
  const task = data.find((value) => value?.task);
  const response = (value) => ({ text: JSON.stringify(value), toolCalls: [], usage: { input_tokens: 220, output_tokens: 120 }, model: "synthetic-local", finishReason: "stop" });
  if (["summarize_chapter", "merge_chapter"].includes(task?.task)) {
    evidence.chapterModelCalls++;
    evidence.chapterInputs.push(task);
    if (evidence.phase === "save_policy_timeout") return new Promise((resolve, reject) => request.signal.addEventListener("abort", () => {
      evidence.chapterAborted = true; reject(new Error("SYNTHETIC_POLICY_CHAPTER_TIMEOUT"));
    }, { once: true }));
    const source = task.sources?.[0] || task.parts?.[0]?.keyEvents?.[0]?.sources?.[0];
    return response({ title: `楼道回顾 ${task.range.toRevision}`, summary: "林安留意着楼道和门口的动静。",
      keyEvents: [{ text: "林安观察了楼道。", sources: [{ revision: source.revision, segmentId: source.segmentId }] }], openThreads: [] });
  }
  if (["summarize_context", "merge_context"].includes(task?.task)) {
    evidence.compactionModelCalls = (evidence.compactionModelCalls || 0) + 1;
    const quote = (task.quoteCandidates || task.parts.flatMap((part) => part.items))[0];
    return response({ selectedQuoteIds: [quote.quoteId] });
  }
  const fixed = data.find((value) => value?.canonicalState);
  assert.ok([19, 20].includes(fixed?.baseRevision));
  evidence.modelCalls++;
  return response(bundle("policy-observed", `林安第${fixed.baseRevision + 1}次观察楼道，陈姨仍在门边。`));
}

async function runSavePolicyPhase(win, evidence, tempRoot) {
  const fixture = JSON.parse(fs.readFileSync(path.join(tempRoot, "results", "save-policy-fixture.json"), "utf8"));
  const restarting = evidence.phase === "save_policy_restart";
  if (!restarting) {
    await click(win, "#menuLanguageToggle");
    await click(win, { "zh-CN": "#mainMenuLocaleZh", "en-US": "#mainMenuLocaleEn", "ja-JP": "#mainMenuLocaleJa" }[fixture.locale]);
    await waitFor(win, "policy interface language settled", `document.documentElement.lang===${JSON.stringify(fixture.locale)} && document.querySelector('#localeTransitionCurtain').dataset.phase==='idle'`);
    await connectSyntheticModel(win);
    await click(win, "#settingsTabDisplay");
    assert.equal(await evaluate(win, "state.gameUiLayout"), "story-notebook-v1");
    await click(win, "#settingsTabAudio"); await change(win, "#ttsProviderSelect", "kokoro-original-local"); await change(win, "#ttsReadingModeSelect", "auto");
    await click(win, "#settingsTabDeveloper"); await change(win, "#contextWindowPresetSelect", "512000");
    await click(win, "#settingsTabSave");
    await change(win, "#autoSaveEnabledSelect", "true"); await change(win, "#autoSaveIntervalSelect", "custom");
    await change(win, "#autoSaveIntervalCustomInput", "20", "input");
    await change(win, "#manualChapterSelect", "false"); await change(win, "#compactionChapterSelect", "false");
    await click(win, "#saveSettingsButton");
    await waitFor(win, "chapter preferences persisted", "!state.settingsSaving && !state.settingsDirty && state.autoSaveIntervalTurns===20 && !state.manualChapterEnabled && !state.compactionChapterEnabled");
    await assertSavePolicyControls(win, fixture.locale, { onAutoSave: true, onManualSave: false, onCompaction: false, intervalTurns: 20 });
    await screenshot(win, tempRoot, `save-policy-${fixture.locale}-${fixture.kind}-controls`, evidence);
    await click(win, "#closeSettingsButton");
  } else if (!(await readStatus(win)).keyVerified) { await connectSyntheticModel(win); await click(win, "#closeSettingsButton"); }
  await waitFor(win, "policy fixture available", "!document.querySelector('#continueGameButton').disabled");
  await click(win, "#continueGameButton");
  const revision = restarting ? fixture.kind === "success" ? 21 : 20 : 19;
  await waitSettingsRevision(win, fixture.adventureId, revision);
  assert.equal(evidence.modelCalls, 0); assert.equal(evidence.chapterModelCalls, 0); assert.equal(evidence.ttsRequests, 0);
  if (restarting || fixture.kind === "controls") {
    const before = await readStatus(win);
    await click(win, "#gameSettingsButton"); await click(win, "#settingsTabSave");
    await assertSavePolicyControls(win, fixture.locale, before.settings.save.chapterLog);
    await screenshot(win, tempRoot, `save-policy-${fixture.locale}-${fixture.kind}-restored-controls`, evidence);
    await click(win, "#closeSettingsButton");
    if (restarting) {
      await click(win, "#storyNotebookChaptersButton");
      await waitFor(win, "read-only chapter panel completed", "!state.chapterReadBusy && !document.querySelector('#storyNotebookDrawerBody [aria-busy=true]')");
      const chapters = await policyChapters(win);
      assert.equal(chapters.length, fixture.kind === "success" ? 2 : 0);
      await screenshot(win, tempRoot, `save-policy-${fixture.kind}-restarted-chapters`, evidence);
    }
    assert.equal(evidence.modelCalls, 0); assert.equal(evidence.chapterModelCalls, 0); assert.equal(evidence.ttsRequests, 0);
    return { ...evidence, revision };
  }
  await policyManualSave(win, evidence);
  assert.equal(evidence.manualSaves.at(-1).result.result.chapterStatus, "disabled");
  assert.equal(evidence.chapterModelCalls, 0); assert.equal(evidence.ttsRequests, 0);
  await submit(win, "我第20次观察楼道。");
  await waitSettingsRevision(win, fixture.adventureId, 20, "林安第20次观察楼道");
  await waitUntil("one automatic story speech request", () => evidence.ttsRequests === 1);
  const turn = evidence.policyReceipts.find((item) => item.channel === "grey-crow:run-turn");
  assert.equal(turn.result.actionResult.status, "committed");
  assert.equal(turn.result.envelope.chapterSummary, undefined);
  assert.equal(turn.result.derivedWork.kind, "chapter");
  await waitUntil("automatic derived chapter receipt", () => evidence.derivedReceipts?.some((item) => item.request.actionId === turn.request.actionId));
  const derived = evidence.derivedReceipts.find((item) => item.request.actionId === turn.request.actionId).result;
  assert.equal(derived.chapterSummary.trigger, "interval");
  assert.equal(evidence.chapterModelCalls, 1);
  const repeated = await evaluate(win, `window.greyCrow.runTurn(${JSON.stringify(turn.request.text)}, ${JSON.stringify(turn.request)})`);
  assert.equal(repeated.actionResult.modelCalls, 0); assert.equal(repeated.envelope.chapterSummary, undefined);
  assert.equal(evidence.modelCalls, 1); assert.equal(evidence.chapterModelCalls, 1); assert.equal(evidence.ttsRequests, 1);
  if (fixture.kind === "timeout") {
    assert.equal(derived.chapterSummary.chapterStatus, "failed"); assert.equal(evidence.chapterAborted, true);
    assert.ok(await evaluate(win, "document.querySelector('#narrationPanel').textContent.includes(t('game.save.autoChapterIncomplete'))"));
    await screenshot(win, tempRoot, "save-policy-timeout-story-preserved", evidence);
    return { ...evidence, revision: 20 };
  }
  assert.equal(derived.chapterSummary.chapterStatus, "created");
  assert.equal((await policyChapters(win)).length, 1);
  await policyCompact(win, evidence, 20);
  assert.equal(evidence.chapterModelCalls, 1, "disabled compaction reviews generate no chapter");
  await savePolicySelection(win, evidence, { onManualSave: true, onAutoSave: false, onCompaction: true, intervalTurns: 20 });
  await policyManualSave(win, evidence); assert.equal(evidence.manualSaves.at(-1).result.result.chapterStatus, "unchanged");
  await submit(win, "我第21次观察楼道。");
  await waitSettingsRevision(win, fixture.adventureId, 21, "林安第21次观察楼道");
  await waitUntil("second story speech request", () => evidence.ttsRequests === 2);
  assert.equal(evidence.chapterModelCalls, 1);
  await policyCompact(win, evidence, 21);
  assert.equal(evidence.chapterModelCalls, 2); assert.equal((await policyChapters(win)).length, 2);
  await policyManualSave(win, evidence); assert.equal(evidence.manualSaves.at(-1).result.result.chapterStatus, "unchanged");
  await savePolicySelection(win, evidence, { onManualSave: false, onAutoSave: false, onCompaction: true, intervalTurns: 20 });
  assert.equal(evidence.ttsRequests, 2); assert.equal(evidence.modelCalls, 2); assert.equal(evidence.chapterModelCalls, 2);
  await screenshot(win, tempRoot, "save-policy-success-final", evidence);
  return { ...evidence, revision: 21 };
}

async function assertSavePolicyControls(win, locale, policy) {
  assert.deepEqual(await evaluate(win, `({onAutoSave:document.querySelector('#autoSaveEnabledSelect').value==='true',
    onManualSave:document.querySelector('#manualChapterSelect').value==='true',onCompaction:document.querySelector('#compactionChapterSelect').value==='true',
    intervalTurns:Number(document.querySelector('#autoSaveIntervalCustomInput').value)})`), policy);
  assert.equal(await evaluate(win, "document.querySelector('#autoSaveIntervalSelect').value"), "custom");
  assert.ok(await evaluate(win, "document.querySelector('#settingsPanelSave').textContent.includes(t('settings.save.durable'))"));
  assert.ok(await evaluate(win, "document.querySelector('#autoSaveStatus').textContent===t(state.autoSaveEnabled?'settings.autoSave.statusOn':'settings.autoSave.statusOff',{turns:20})"));
  assert.equal(await evaluate(win, "document.documentElement.lang"), locale);
}
async function savePolicySelection(win, evidence, policy) {
  const before = await readStatus(win); const counts = [evidence.modelCalls, evidence.chapterModelCalls, evidence.ttsRequests, evidence.compactionModelCalls || 0];
  await click(win, "#gameSettingsButton"); await click(win, "#settingsTabSave");
  for (const [id, key] of [["autoSaveEnabledSelect", "onAutoSave"], ["manualChapterSelect", "onManualSave"], ["compactionChapterSelect", "onCompaction"]]) await change(win, `#${id}`, String(policy[key]));
  await click(win, "#saveSettingsButton"); await waitFor(win, "save policy hot applied", "!state.settingsSaving && !state.settingsDirty");
  const after = await readStatus(win);
  assert.deepEqual(after.settings.save.chapterLog, policy); assert.equal(after.runtimeSessionId, before.runtimeSessionId);
  assert.equal(after.activeSave.revision, before.activeSave.revision); assert.equal(after.sessionRecoveryRequired, false);
  assert.deepEqual([evidence.modelCalls, evidence.chapterModelCalls, evidence.ttsRequests, evidence.compactionModelCalls || 0], counts);
  (evidence.hotUpdates ||= []).push({ beforeSessionId: before.runtimeSessionId, afterSessionId: after.runtimeSessionId, revision: after.activeSave.revision, policy });
  await assertSavePolicyControls(win, "zh-CN", policy); await click(win, "#closeSettingsButton");
}
async function policyManualSave(win, evidence) {
  const count = evidence.manualSaves.length; const speech = evidence.ttsRequests;
  await click(win, "#storyNotebookChaptersButton");
  await waitFor(win, "actual chapter save button available", "Boolean(document.querySelector('#storyNotebookDrawerBody [data-session-chapter-save]:not(:disabled)'))");
  await click(win, "#storyNotebookDrawerBody [data-session-chapter-save]");
  await waitUntil("manual save receipt delivered", () => evidence.manualSaves.length > count);
  await waitFor(win, "manual save finished", "!state.busy");
  assert.equal(evidence.ttsRequests, speech); await closeNotebookDrawer(win);
}
async function policyChapters(win) {
  const status = await readStatus(win);
  const result = await evaluate(win, `window.greyCrow.getChapterLogs(${JSON.stringify({ adventureId: status.activeSaveId, sessionId: status.runtimeSessionId, revision: status.activeSave.revision })})`);
  assert.equal(result.ok, true); return result.result.chapters;
}
async function policyCompact(win, evidence, revision) {
  const speech = evidence.ttsRequests; const story = evidence.modelCalls;
  await openCompactionControl(win); await click(win, "#confirmCompactButton");
  await waitFor(win, "actual context compaction completed", "!state.busy && state.pendingSessionCompaction?.status==='reduced'");
  const receipt = evidence.policyReceipts.filter((item) => item.channel === "grey-crow:request-context-compaction").at(-1);
  assert.equal(receipt.result.compaction.revision, revision); assert.equal(receipt.result.compaction.status, "reduced");
  const chapters = evidence.chapterModelCalls; const compactCalls = evidence.compactionModelCalls;
  const status = await readStatus(win);
  const lookup = await evaluate(win, `window.greyCrow.readContextCompaction(${JSON.stringify({ adventureId: status.activeSaveId, sessionId: status.runtimeSessionId, revision, requestId: receipt.request.requestId })})`);
  assert.equal(lookup.compaction.modelCalls, 0); assert.equal(lookup.chapterSummary, undefined);
  assert.equal(evidence.chapterModelCalls, chapters); assert.equal(evidence.compactionModelCalls, compactCalls);
  assert.equal(evidence.ttsRequests, speech); assert.equal(evidence.modelCalls, story);
}
