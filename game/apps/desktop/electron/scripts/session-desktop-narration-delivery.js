"use strict";

// This suite owns its disposable saves and providers.  It deliberately leaves
// Main, preload, the renderer, the Session child and SQLite unmocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PHASES = ["narration_delivery_zh", "narration_delivery_zh_restore", "narration_delivery_cancel", "narration_delivery_en_snapshot", "narration_delivery_ja_snapshot", "narration_delivery_missing_resources"];
const handlesPhase = (phase) => PHASES.includes(phase);
const isMissingResourcesPhase = (phase) => phase === "narration_delivery_missing_resources";
const fixturePath = (root) => path.join(root, "results", "narration-delivery-fixture.json");
const INPUT = "我先看清门缝里的光，再问陈姨是否需要帮忙。";
const FOLLOW_UP = "我把刚才看到的光告诉陈姨，再等她回答。";
const COPY = {
  "zh-CN": ["门缝里的光先在地上拉成一条细线。", "陈姨没有立刻开门，只让你先听楼道的声音。", "你把手停在门边，等她给出下一句答复。"],
  "en-US": ["A narrow line of light reaches the floor beneath the door.", "Chen asks you to listen to the hallway before either of you moves."],
  "ja-JP": ["扉の隙間からの光が、床に細い線を引いている。", "陳さんはすぐに扉を開けず、まず廊下の音を聞くよう促した。"],
};
const FOLLOW_UP_REPLY = "陈姨点点头，让你继续留意楼道的动静。";

async function makeRoot(rootEnv) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(root, name));
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TMPDIR: path.join(root, "tmp"), XDG_CONFIG_HOME: path.join(root, "home", "config"),
    XDG_CACHE_HOME: path.join(root, "home", "cache"), [rootEnv]: root,
    GREY_CROW_DATA_ROOT: path.join(root, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(root, "provider-check"),
    GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(root, "kokoro-fixture") });
  return { root, env };
}

async function createFixture(root, locale, createSettingsFixture) {
  const settings = await createSettingsFixture(root, locale);
  const fixture = { ...settings, locale, copy: COPY[locale] };
  fs.writeFileSync(fixturePath(root), JSON.stringify(fixture, null, 2));
  return fixture;
}

async function runCoordinator({ runPhase, createSettingsFixture, rootEnv }) {
  const chinese = await makeRoot(rootEnv);
  const fixture = await createFixture(chinese.root, "zh-CN", createSettingsFixture);
  process.stdout.write(`Narration delivery artifacts: ${chinese.root}\n`);
  const delivery = await runPhase(require("electron"), "narration_delivery_zh", chinese.env);
  const restore = await runPhase(require("electron"), "narration_delivery_zh_restore", chinese.env);
  assert.equal(delivery.revision, 2); assert.equal(restore.revision, 2);
  assert.equal(delivery.modelCalls, 2); assert.equal(restore.modelCalls, 0);
  assert.equal(restore.ttsRequests, 0, "history recovery cannot request speech");
  const cancellation = await makeRoot(rootEnv);
  const cancellationFixture = await createFixture(cancellation.root, "zh-CN", createSettingsFixture);
  cancellationFixture.otherAdventure = await createSettingsFixture(cancellation.root, "en-US");
  fs.writeFileSync(fixturePath(cancellation.root), JSON.stringify(cancellationFixture, null, 2));
  const cancelled = await runPhase(require("electron"), "narration_delivery_cancel", cancellation.env);
  assert.equal(cancelled.modelCalls, 1); assert.equal(cancelled.ttsRequests, 0);
  const locales = [];
  for (const [locale, phase] of [["en-US", "narration_delivery_en_snapshot"], ["ja-JP", "narration_delivery_ja_snapshot"]]) {
    const item = await makeRoot(rootEnv);
    await createFixture(item.root, locale, createSettingsFixture);
    locales.push(await runPhase(require("electron"), phase, item.env));
  }
  assert.deepEqual(locales.map((result) => result.locale), ["en-US", "ja-JP"]);
  assert.ok(locales.every((result) => result.screenshots.length === 1 && result.modelCalls === 1));
  const result = { ok: true, suite: "narration-delivery", tempRoot: chinese.root, fixture, delivery, restore, cancelled, locales,
    evidence: "Actual Electron Main/preload/renderer -> Session child -> SQLite with synthetic committed story responses and valid local WAV media.",
    limitations: ["The model response and WAV are fixtures. HTMLMediaElement events prove browser playback lifecycle, not speaker output, voice quality, narrative quality, native-language review or release readiness."] };
  fs.writeFileSync(path.join(chinese.root, "results", "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function runMissingResourcesCoordinator({ runPhase, createSettingsFixture, rootEnv }) {
  const item = await makeRoot(rootEnv);
  const fixture = await createFixture(item.root, "zh-CN", createSettingsFixture);
  process.stdout.write(`Narration missing-resource artifacts: ${item.root}\n`);
  const missing = await runPhase(require("electron"), "narration_delivery_missing_resources", item.env);
  assert.equal(missing.modelCalls, 1); assert.equal(missing.audioGenerations, 0);
  const result = { ok: true, suite: "narration-delivery-missing", tempRoot: item.root, fixture, missing,
    evidence: "Actual empty temporary Kokoro runtime inspected by Main; story remains a synthetic local Provider fixture.",
    limitations: ["No installed TTS runtime, actual voice, speaker output, model, narrative-quality or release validation."] };
  fs.writeFileSync(path.join(item.root, "results", "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function runLocalesCoordinator({ runPhase, createSettingsFixture, rootEnv }) {
  const locales = [];
  let resultRoot;
  for (const [locale, phase] of [["en-US", "narration_delivery_en_snapshot"], ["ja-JP", "narration_delivery_ja_snapshot"]]) {
    const item = await makeRoot(rootEnv);
    resultRoot ||= item.root;
    process.stdout.write(`Narration locale artifacts: ${item.root}\n`);
    await createFixture(item.root, locale, createSettingsFixture);
    locales.push(await runPhase(require("electron"), phase, item.env));
  }
  assert.ok(locales.every(result => result.screenshots.length === 1 && result.modelCalls === 1));
  const result = { ok: true, suite: "narration-delivery-locales", locales,
    evidence: "Actual Electron reading layouts with synthetic English and Japanese story responses; no voice or real model." };
  fs.writeFileSync(path.join(resultRoot, "results", "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function generatedBundle(locale, turn) {
  const narration = turn === 2 ? [FOLLOW_UP_REPLY] : COPY[locale];
  return { narration: narration.map((text, index) => ({ id: `delivery-${turn}-${index + 1}`, text })), events: [], experiences: [] };
}

async function generate(request, evidence, root) {
  assert.notEqual(evidence.phase, "narration_delivery_zh_restore", "restoring history cannot invoke the model");
  const fixture = JSON.parse(fs.readFileSync(fixturePath(root), "utf8"));
  const input = request.messages.find((message) => message.content?.startsWith("Current player action:\n"))?.content.slice("Current player action:\n".length);
  const structured = request.messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } });
  const source = structured.find((value) => value?.canonicalState);
  assert.equal(source?.locale, fixture.locale);
  evidence.modelCalls += 1;
  const turn = input === FOLLOW_UP ? 2 : 1;
  assert.equal(input, turn === 2 ? FOLLOW_UP : INPUT);
  return { text: JSON.stringify(generatedBundle(fixture.locale, turn)), toolCalls: [], usage: { input_tokens: 120, output_tokens: 90 }, model: "synthetic-local", finishReason: "stop" };
}

function installMediaObserverExpression() {
  return `(() => {
    const events = []; const watched = new WeakSet(); const original = HTMLMediaElement.prototype.addEventListener; let nextId = 0;
    HTMLMediaElement.prototype.addEventListener = function(type, listener, options) {
      if (['play','playing','pause','ended','error'].includes(type) && !watched.has(this)) {
        watched.add(this); const mediaId = ++nextId; this.__narrationDeliveryMediaId = mediaId;
        for (const observed of ['play','playing','pause','ended','error']) original.call(this, observed, () => events.push({mediaId,type:observed,at:performance.now(),requestId:state.ttsRequestId,utteranceId:state.ttsUtteranceId,paused:this.paused,currentTime:this.currentTime,duration:this.duration}));
      }
      return original.call(this, type, listener, options);
    };
    window.__narrationDeliveryMediaEvents = events;
    return true;
  })()`;
}

function playbackSnapshotExpression() {
  return `(() => { const audio = state.currentAudio; const toggle = document.querySelector('#ttsPlaybackToggleButton'); return {
    at: performance.now(), ttsPhase: state.ttsPlaybackPhase, requestId: state.ttsRequestId, utteranceId: state.ttsUtteranceId,
    speechAudioFocus: Boolean(speechAudioFocus), toggle: toggle ? { phase: toggle.dataset.phase, disabled: toggle.disabled, label: toggle.getAttribute('aria-label') } : null,
    audio: audio ? { mediaId: audio.__narrationDeliveryMediaId ?? null, paused: audio.paused, currentTime: audio.currentTime,
      duration: audio.duration, ended: audio.ended, readyState: audio.readyState, networkState: audio.networkState } : null
  }; })()`;
}

async function selectLocale(win, locale, ui) {
  const { click, waitFor } = ui;
  await click(win, "#menuLanguageToggle");
  await click(win, { "zh-CN": "#mainMenuLocaleZh", "en-US": "#mainMenuLocaleEn", "ja-JP": "#mainMenuLocaleJa" }[locale]);
  await waitFor(win, "delivery locale", `document.documentElement.lang === ${JSON.stringify(locale)} && document.querySelector('#localeTransitionCurtain').dataset.phase === 'idle'`);
}

async function setReadingMode(win, mode, ui) {
  const { click, change, waitFor } = ui;
  await click(win, "#settingsTabAudio");
  await change(win, "#ttsReadingModeSelect", mode);
  const expected = mode === "auto" ? "state.ttsEnabled && state.ttsAuto && state.ttsProvider !== 'disabled'"
    : mode === "manual" ? "state.ttsEnabled && !state.ttsAuto && state.ttsProvider !== 'disabled'" : "!state.ttsEnabled";
  await waitFor(win, "reading mode persisted", `!state.settingsSaving && !state.settingsDirty && ${expected}`);
}

async function openFixtureGame(win, fixture, ui) {
  const { click, evaluate, waitFor } = ui;
  // The switch test deliberately has two saves; the menu's default may be
  // the more recently created one. Select this test's source through the
  // same production continuation controller used by a save-list click.
  if (fixture.otherAdventure) await evaluate(win, `continueGame(${JSON.stringify(fixture.adventureId)})`);
  else await click(win, "#continueGameButton");
  await waitFor(win, "fixture game opened", `(async () => { const status = await window.greyCrow.getStatus(); return status.activeSaveId === ${JSON.stringify(fixture.adventureId)} && status.gameStarted && !state.busy; })()`);
  await waitFor(win, "fixture reading page accepts player input", "!isNotebookPresentationBlocked()");
  assert.equal(await evaluate(win, "Boolean(document.querySelector('#narrationPanel'))"), true);
}

async function runPhase(win, evidence, root, ui) {
  const { click, evaluate, waitFor, waitUntil, delay, screenshot, connectSyntheticModel, submit } = ui;
  const fixture = JSON.parse(fs.readFileSync(fixturePath(root), "utf8"));
  await selectLocale(win, fixture.locale, ui);
  await connectSyntheticModel(win);
  if (evidence.phase === "narration_delivery_zh_restore") {
    await click(win, "#closeSettingsButton");
    await openFixtureGame(win, fixture, ui);
    await waitFor(win, "restored committed paragraphs are static", `(() => { const text = document.querySelector('#narrationPanel').innerText; const required = ${JSON.stringify([...COPY["zh-CN"], FOLLOW_UP_REPLY])}; let cursor = -1; for (const value of required) { cursor = text.indexOf(value, cursor + 1); if (cursor < 0) return false; } return state.typewriterTimers.size === 0 && !state.narrationDelivery; })()`);
    await delay(300);
    assert.deepEqual(await evaluate(win, "window.__narrationDeliveryMediaEvents || []"), []);
    await screenshot(win, root, "narration-delivery-zh-history", evidence);
    return { ...evidence, locale: fixture.locale, adventureId: fixture.adventureId, revision: (await ui.readStatus(win)).activeSave.revision };
  }
  if (evidence.phase === "narration_delivery_zh") {
    await setReadingMode(win, "auto", ui);
    await click(win, "#closeSettingsButton");
    await openFixtureGame(win, fixture, ui);
    await evaluate(win, installMediaObserverExpression());
    await submit(win, INPUT);
    await waitFor(win, "only the first committed host paragraph starts revealing", `(() => { const hosts = Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'), node => node.textContent); return hosts.length === 1 && hosts[0].length > 0 && hosts[0].length < ${COPY["zh-CN"][0].length}; })()`);
    const early = await evaluate(win, "Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'), node => node.textContent)");
    assert.equal(early.length, 1, "later committed paragraphs cannot appear as empty rows");
    await screenshot(win, root, "narration-delivery-zh-first-paragraph", evidence);
    await waitFor(win, "renderer accepts the next player action", "!state.busy");
    await submit(win, FOLLOW_UP);
    await waitFor(win, "previous tail flushes before the new player action", `(() => { const text = document.querySelector('#narrationPanel').innerText; const old = ${JSON.stringify(COPY["zh-CN"])}; let cursor = text.indexOf(${JSON.stringify(INPUT)}); for (const value of old) { cursor = text.indexOf(value, cursor + 1); if (cursor < 0) return false; } const next = text.indexOf(${JSON.stringify(FOLLOW_UP)}, cursor + 1); const reply = text.indexOf(${JSON.stringify(FOLLOW_UP_REPLY)}, next + 1); return next >= 0 && reply >= 0 && !state.narrationDelivery && state.typewriterTimers.size === 0; })()`, 15000);
    assert.equal(evidence.ttsRequests, 2, "each completed committed turn starts one automatic utterance");
    await screenshot(win, root, "narration-delivery-zh-flush", evidence);
    const manualBaseline = await evaluate(win, "state.ttsRequestId");
    evidence.narrationDeliveryDiagnostics = { manualBaseline, beforeManualClick: await evaluate(win, playbackSnapshotExpression()) };
    await click(win, "#narrationPanel .narration-line.host:last-child .tts-line-button");
    evidence.narrationDeliveryDiagnostics.afterManualClick = await evaluate(win, playbackSnapshotExpression());
    await waitFor(win, "the new manual request owns native audio", `state.ttsRequestId > ${manualBaseline} && state.currentAudio && !state.currentAudio.paused && document.querySelector('#ttsPlaybackToggleButton').dataset.phase === 'playing'`);
    const manualPlayback = await evaluate(win, "({requestId:state.ttsRequestId,utteranceId:state.ttsUtteranceId,mediaId:state.currentAudio.__narrationDeliveryMediaId,paused:state.currentAudio.paused,currentTime:state.currentAudio.currentTime})");
    assert.ok(Number.isInteger(manualPlayback.mediaId)); assert.equal(manualPlayback.paused, false);
    evidence.narrationDeliveryDiagnostics.beforePauseClick = await evaluate(win, playbackSnapshotExpression());
    await click(win, "#ttsPlaybackToggleButton");
    evidence.narrationDeliveryDiagnostics.afterPauseClick = await evaluate(win, playbackSnapshotExpression());
    await waitFor(win, "the manual native audio paused", `state.ttsRequestId === ${manualPlayback.requestId} && state.currentAudio && state.currentAudio.__narrationDeliveryMediaId === ${manualPlayback.mediaId} && state.currentAudio.paused && document.querySelector('#ttsPlaybackToggleButton').dataset.phase === 'paused'`);
    await click(win, "#ttsPlaybackToggleButton");
    await waitFor(win, "the same manual native audio resumed", `state.ttsRequestId === ${manualPlayback.requestId} && state.currentAudio && state.currentAudio.__narrationDeliveryMediaId === ${manualPlayback.mediaId} && !state.currentAudio.paused && document.querySelector('#ttsPlaybackToggleButton').dataset.phase === 'playing'`);
    await waitUntil("manual real media ended", async () => (await evaluate(win, `window.__narrationDeliveryMediaEvents.some(event => event.mediaId === ${manualPlayback.mediaId} && event.type === 'ended')`)));
    const mediaEvents = await evaluate(win, "window.__narrationDeliveryMediaEvents");
    evidence.narrationDeliveryDiagnostics.mediaEvents = mediaEvents;
    const manualEvents = mediaEvents.filter((item) => item.mediaId === manualPlayback.mediaId);
    for (const event of ["play", "playing", "ended"]) assert.ok(manualEvents.some((item) => item.type === event), `native media must emit ${event}`);
    // Releasing an ended element clears its source and can emit a later error
    // for that detached empty source. Playback itself must end without error.
    const endedIndex = manualEvents.findIndex((item) => item.type === "ended");
    assert.equal(manualEvents.slice(0, endedIndex + 1).some((item) => item.type === "error"), false);
    assert.equal(await evaluate(win, "['completed','idle'].includes(state.ttsPlaybackPhase) && state.currentAudio === null"), true);
    assert.equal(evidence.ttsRequests, 3, "manual paragraph replay adds exactly one utterance");
    const revision = (await ui.readStatus(win)).activeSave.revision;
    await click(win, "#gameSettingsButton"); await click(win, "#backToMenuButton");
    await waitFor(win, "returning to menu cancels delivery timers", "!state.gameStarted && state.typewriterTimers.size === 0 && !state.narrationDelivery");
    return { ...evidence, locale: fixture.locale, adventureId: fixture.adventureId, revision, early, manualPlayback, mediaEvents };
  }
  if (evidence.phase === "narration_delivery_cancel") {
    await setReadingMode(win, "manual", ui);
    await click(win, "#closeSettingsButton");
    await openFixtureGame(win, fixture, ui);
    await submit(win, INPUT);
    await waitFor(win, "a committed first paragraph is still revealing", `(() => { const nodes = document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'); const node = nodes[nodes.length - 1]; return node && node.textContent.length > 0 && node.textContent.length < ${COPY["zh-CN"][0].length}; })()`);
    // Adventures own their locale until the player leaves. Switch through the
    // actual menu flow so the test respects that production ownership rule.
    await click(win, "#gameSettingsButton");
    await click(win, "#backToMenuButton");
    await waitFor(win, "leaving cancels the old delivery", "!state.gameStarted && !state.narrationDelivery && state.typewriterTimers.size === 0");
    assert.equal(await evaluate(win, `continueGame(${JSON.stringify(fixture.otherAdventure.adventureId)})`), true);
    await waitFor(win, "switching adventure cleared the old delivery", `(async () => { const status = await window.greyCrow.getStatus(); return status.activeSaveId === ${JSON.stringify(fixture.otherAdventure.adventureId)} && !state.narrationDelivery && state.typewriterTimers.size === 0; })()`);
    await delay(1500);
    const staleTail = await evaluate(win, `document.querySelector('#narrationPanel').innerText.includes(${JSON.stringify(COPY["zh-CN"][1])}) || document.querySelector('#narrationPanel').innerText.includes(${JSON.stringify(COPY["zh-CN"][2])})`);
    assert.equal(staleTail, false, "a switched adventure cannot receive an old committed delivery timer");
    await click(win, "#gameSettingsButton"); await click(win, "#backToMenuButton");
    await waitFor(win, "menu return keeps the old queue cancelled", "!state.gameStarted && !state.narrationDelivery && state.typewriterTimers.size === 0");
    return { ...evidence, locale: fixture.locale, adventureId: fixture.adventureId, revision: 1, switchedAdventureId: fixture.otherAdventure.adventureId };
  }
  if (isMissingResourcesPhase(evidence.phase)) {
    await setReadingMode(win, "auto", ui);
    const unavailable = await evaluate(win, "({mode:document.querySelector('#ttsReadingModeSelect').value,status:document.querySelector('#ttsStatus').textContent,testDisabled:document.querySelector('#ttsTestButton').disabled,provider:state.ttsProvider,enabled:state.ttsEnabled,auto:state.ttsAuto})");
    assert.equal(unavailable.mode, "auto"); assert.equal(unavailable.enabled, true); assert.equal(unavailable.auto, true);
    assert.equal(unavailable.testDisabled, true); assert.equal(unavailable.status, await evaluate(win, "t('settings.audio.status.resourceMissing')"));
    await click(win, "#closeSettingsButton");
    await openFixtureGame(win, fixture, ui);
    await submit(win, INPUT);
    await waitFor(win, "missing resource is projected to the game audio control", "document.querySelector('#ttsPlaybackToggleButton').dataset.phase === 'error' && document.querySelector('#operationTtsStatus').textContent === t('tts.error.resourceMissing')");
    assert.equal(evidence.ttsRequests, 1);
    await click(win, "#ttsPlaybackToggleButton");
    await waitFor(win, "missing resource error opens audio settings", "document.querySelector('#settingsDialog').open && !document.querySelector('#settingsPanelAudio').hidden");
    const reopened = await evaluate(win, "({mode:document.querySelector('#ttsReadingModeSelect').value,status:document.querySelector('#ttsStatus').textContent,testDisabled:document.querySelector('#ttsTestButton').disabled})");
    assert.equal(reopened.mode, "auto"); assert.equal(reopened.testDisabled, true);
    assert.equal(reopened.status, await evaluate(win, "t('settings.audio.status.resourceMissing')"));
    await screenshot(win, root, "narration-missing-resources-settings", evidence);
    await setReadingMode(win, "off", ui);
    await click(win, "#closeSettingsButton");
    await waitFor(win, "disabling missing-resource narration returns audio control to idle", "document.querySelector('#ttsPlaybackToggleButton').dataset.phase === 'idle'");
    return { ...evidence, locale: fixture.locale, adventureId: fixture.adventureId, revision: (await ui.readStatus(win)).activeSave.revision, unavailable, reopened };
  }
  // These are deliberately small genuine-session locale/layout snapshots. The
  // full cancellation and timing matrix stays in the Chinese phase above.
  await setReadingMode(win, "off", ui);
  await click(win, "#settingsTabDisplay");
  assert.equal(await evaluate(win, "state.gameUiLayout"), "story-notebook-v1");
  await waitFor(win, "snapshot settings persisted", "!state.settingsSaving && !state.settingsDirty");
  await click(win, "#closeSettingsButton");
  await openFixtureGame(win, fixture, ui);
  await submit(win, INPUT);
  await waitFor(win, "localized committed narration delivered", `(() => { const text = Array.from(document.querySelectorAll('#narrationPanel .narration-line.host .narration-text'), node => node.textContent); return ${JSON.stringify(COPY[fixture.locale])}.every((value, index) => text[index] === value); })()`, 15000);
  const layout = await evaluate(win, "document.querySelector('#gameView').dataset.uiLayout");
  assert.equal(evidence.ttsRequests, 0);
  await screenshot(win, root, `narration-delivery-${fixture.locale}-${layout}`, evidence);
  return { ...evidence, locale: fixture.locale, adventureId: fixture.adventureId, revision: (await ui.readStatus(win)).activeSave.revision, layout };
}

function validWav() {
  const sampleRate = 8000, samples = 12000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

module.exports = { handlesPhase, isMissingResourcesPhase, runCoordinator, runMissingResourcesCoordinator, runLocalesCoordinator, runPhase, generate, validWav };
