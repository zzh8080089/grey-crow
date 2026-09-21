"use strict";

// Real Main/preload/renderer regression. No save fixture is created: the action
// phase follows the first-player path rather than deleting a seeded adventure.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PHASES = ["player_guide_first", "player_guide_restart", "player_guide_action"];
const LOCALES = ["zh-CN", "en-US", "ja-JP"];
const THEMES = ["light", "dark"];
const PLAYER_DESCRIPTION = "我叫林安，是社区志愿者，唯一留下母亲的一段记忆。起点在陈姨家门外的楼道。请整理开局摘要，先不要开始。";
const PLAYER_CONFIRMATION = "我明确确认这份开局摘要，开始吧。";
const PLAYER_BORROW = "我向陈姨借两袋米，答应明天把两袋米还给她。";
const handlesPhase = (phase) => PHASES.includes(phase);

async function runCoordinator({ runPhase, rootEnv }) {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
  const env = {};
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, {
    TMPDIR: path.join(tempRoot, "tmp"),
    XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"), XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"),
    [rootEnv]: tempRoot, GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"),
    GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"),
    GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture"),
  });
  process.stdout.write(`Player guide artifacts: ${tempRoot}\n`);
  const runs = [];
  for (const phase of PHASES) runs.push(await runPhase(require("electron"), phase, env));
  const [first, restart, action] = runs;
  assert.deepEqual([first.modelCalls, first.chapterModelCalls, first.ttsRequests], [0, 0, 0], "tutorial first prompt must be local only");
  assert.deepEqual([restart.modelCalls, restart.chapterModelCalls, restart.ttsRequests], [0, 0, 0], "review, reset and layout checks must be local only");
  assert.equal(action.modelCalls, 4, "the four actual opening/action turns are the only story calls");
  assert.equal(action.chapterModelCalls, 0);
  const result = { ok: true, suite: "player-guide", tempRoot, runs,
    evidence: "Actual Electron Main/preload/renderer, isolated tutorial persistence and synthetic provider only for the real first opening/action.",
    limitations: ["No real provider, browser launch, speech quality, native-language review, Windows or release validation."] };
  fs.writeFileSync(path.join(tempRoot, "results", "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, suite: result.suite, tempRoot,
    phases: runs.map((run) => ({ phase: run.phase, models: run.modelCalls, screenshots: run.screenshots.length })),
    evidenceFile: path.join(tempRoot, "results", "result.json") }, null, 2) + "\n");
}

function digestTree(root, omit = new Set()) {
  const output = {};
  if (!fs.existsSync(root)) return output;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name), relative = path.relative(root, absolute);
      if (omit.has(relative)) continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) output[relative] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
      else output[relative] = `<non-file:${entry.name}>`;
    }
  };
  walk(root); return output;
}

async function runPhase(win, evidence, tempRoot, ui) {
  const { click, change, evaluate, readStatus, waitFor, waitUntil, screenshot, syntheticKey, submit } = ui;
  const progress = () => evaluate(win, "window.greyCrow.getTutorialProgress()");
  const dataRoot = path.join(tempRoot, "data");
  const visible = (selector) => evaluate(win, `(() => { const node=document.querySelector(${JSON.stringify(selector)}); return !!node?.getClientRects().length && getComputedStyle(node).visibility!=='hidden'; })()`);
  const assertPrompt = async () => {
    await waitFor(win, "non-modal first-player prompt", "(() => { const prompt=document.querySelector('#playerGuidePrompt.player-guide-prompt'), dialog=document.querySelector('#playerGuideDialog'); return !!prompt?.getClientRects().length && !dialog.open && !document.body.inert; })()");
    assert.equal(await evaluate(win, "document.querySelector('#playerGuidePrompt').getAttribute('role')"), null);
  };
  await waitFor(win, "tutorial bridge and mounted UI", "Boolean(window.greyCrow?.getTutorialProgress) && Boolean(document.querySelector('#playerGuidePrompt'))");

  if (evidence.phase === "player_guide_first") {
    await assertPrompt();
    assert.deepEqual(await progress(), { ok: true, progress: { version: 1, dismissed: false } });
    await screenshot(win, tempRoot, "player-guide-first-nonmodal", evidence);
    await click(win, "#playerGuideStart");
    await waitFor(win, "guide opens from prompt", "document.querySelector('#playerGuideDialog').open && document.querySelectorAll('#playerGuideSteps button[data-step-index]').length===6");
    assert.equal(await evaluate(win, "document.activeElement?.id"), "playerGuideClose");
    assert.equal(await visible("#playerGuideDeepSeekHelp"), true, "connection step exposes the local DeepSeek registration walkthrough");
    assert.ok((await evaluate(win, "document.querySelector('#playerGuideDetails').textContent")).includes("API Key"), "connection step explains the API Key before the separate DeepSeek walkthrough");
    await click(win, "#playerGuideDeepSeekHelp");
    await waitFor(win, "local DeepSeek first step", "document.querySelector('#playerGuideDialog').dataset.guide==='deepseek' && document.querySelectorAll('#playerGuideSteps button[data-step-index]').length===6 && document.querySelector('#playerGuideDialog').dataset.step==='what'");
    await click(win, "#playerGuideNext");
    await waitFor(win, "local DeepSeek registration step", "document.querySelector('#playerGuideDialog').dataset.step==='register' && document.querySelector('#playerGuideDialog').textContent.includes('platform.deepseek.com')");
    await click(win, "#playerGuideDetails summary");
    await screenshot(win, tempRoot, "player-guide-deepseek-registration", evidence);
    await click(win, "#playerGuideHelpLinks button[data-help-id='deepseek-platform']");
    await waitUntil("Main captured fixed official link", () => evidence.guideExternalUrls?.length === 1);
    assert.deepEqual(evidence.guideExternalUrls, ["https://platform.deepseek.com/"]);
    await click(win, "#playerGuideBackToTutorial");
    await waitFor(win, "back to tutorial connection step", "document.querySelector('#playerGuideDeepSeekHelp').getClientRects().length>0");
    await click(win, "#playerGuideSkip");
    await waitFor(win, "tutorial skip persisted", "(async () => (await window.greyCrow.getTutorialProgress()).progress.dismissed===true && !document.querySelector('#playerGuideDialog').open)()");
    assert.equal(fs.existsSync(path.join(dataRoot, "tutorial-progress.json")), true);
    assert.deepEqual([evidence.modelCalls, evidence.chapterModelCalls, evidence.ttsRequests], [0, 0, 0]);
    return { ...evidence, revision: 0 };
  }

  if (evidence.phase === "player_guide_restart") {
    await waitFor(win, "skipped tutorial stays absent after restart", "document.querySelector('#playerGuidePrompt').hidden===true && !document.querySelector('#playerGuideDialog').open");
    assert.equal((await progress()).progress.dismissed, true);
    await click(win, "#settingsButton"); await click(win, "#openPlayerGuideButton");
    await waitFor(win, "settings review opens tutorial", "document.querySelector('#playerGuideDialog').open");
    assert.equal(await evaluate(win, "document.activeElement?.id"), "playerGuideClose");
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await waitFor(win, "real Escape closes tutorial", "!document.querySelector('#playerGuideDialog').open && document.activeElement?.id==='openPlayerGuideButton'");
    const protectedBeforeReset = digestTree(dataRoot, new Set(["tutorial-progress.json", "game-tour-progress.json"]));
    const tutorialBeforeReset = fs.readFileSync(path.join(dataRoot, "tutorial-progress.json"), "utf8");
    await click(win, "#resetPlayerGuideButton");
    await waitFor(win, "reset status shown in settings", "document.querySelector('#playerGuideSettingsStatus').textContent.trim().length>0");
    assert.equal((await progress()).progress.dismissed, false);
    assert.deepEqual(digestTree(dataRoot, new Set(["tutorial-progress.json", "game-tour-progress.json"])), protectedBeforeReset, "reset may only change tutorial progress");
    assert.notEqual(fs.readFileSync(path.join(dataRoot, "tutorial-progress.json"), "utf8"), tutorialBeforeReset);
    await click(win, "#closeSettingsButton"); await assertPrompt();
    await click(win, "#settingsButton");

    const layouts = [];
    for (const locale of LOCALES) for (const theme of THEMES) {
      await click(win, "#settingsTabDisplay");
      await change(win, "#gameLanguageSelect", locale); await change(win, "#storyNotebookThemeSelect", theme);
      await waitFor(win, `${locale} auto-saved`, `document.documentElement.lang===${JSON.stringify(locale)} && !state.settingsSaving && !state.settingsDirty && !state.settingsSaveTask && !state.settingsAutosaveTimer`);
      win.setAspectRatio(0); win.setContentSize(1280, 720, false); win.center();
      await waitFor(win, "1280 by 720 viewport", "innerWidth===1280 && innerHeight===720");
      await click(win, "#openPlayerGuideButton");
      await waitFor(win, `${locale} ${theme} guide visible`, "document.querySelector('#playerGuideDialog').open");
      const layout = await evaluate(win, `(() => { const dialog=document.querySelector('#playerGuideDialog'), body=document.querySelector('#playerGuideBody'), steps=document.querySelector('#playerGuideSteps'), rect=dialog.getBoundingClientRect(); const controls=['playerGuideClose','playerGuideSkip','playerGuidePrevious','playerGuideNext'].map(id=>{const node=document.getElementById(id),r=node.getBoundingClientRect();return {id,visible:!!node.getClientRects().length,fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};}); const before=body.scrollTop; body.scrollTop=body.scrollHeight; const stepsBefore=steps.scrollLeft; steps.scrollLeft=steps.scrollWidth; return {locale:document.documentElement.lang,theme:state.storyNotebookTheme,dialogFits:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight,horizontalOverflow:Math.max(0,dialog.scrollWidth-dialog.clientWidth),controls,scrollable:body.scrollHeight>body.clientHeight,scrolled:body.scrollTop>=before,navScrollable:steps.scrollWidth>steps.clientWidth,navScrolled:steps.scrollLeft>=stepsBefore}; })()`);
      assert.equal(layout.locale, locale); assert.equal(layout.theme, theme); assert(layout.dialogFits, JSON.stringify(layout));
      assert.equal(layout.horizontalOverflow, 0, JSON.stringify(layout)); assert(layout.controls.every((control) => control.visible && control.fits), JSON.stringify(layout));
      const colors = await evaluate(win, `(() => {const dialog=document.querySelector('#playerGuideDialog');return {text:getComputedStyle(document.querySelector('#playerGuideLead')).color,paper:getComputedStyle(dialog).backgroundColor,buttonText:getComputedStyle(document.querySelector('#playerGuideDeepSeekHelp')).color,buttonPaper:getComputedStyle(document.querySelector('#playerGuideDeepSeekHelp')).backgroundColor};})()`);
      assert.deepEqual(colors, theme === 'dark' ? {text:'rgb(232, 227, 216)',paper:'rgb(38, 39, 42)',buttonText:'rgb(232, 227, 216)',buttonPaper:'rgb(38, 39, 42)'} : {text:'rgb(48, 46, 41)',paper:'rgb(244, 240, 231)',buttonText:'rgb(48, 46, 41)',buttonPaper:'rgb(244, 240, 231)'}, 'readable ink and paper must follow the saved theme even on the main menu');
      if (layout.scrollable) assert.equal(layout.scrolled, true, "small guide must have an operable scroll container");
      if (layout.navScrollable) assert.equal(layout.navScrolled, true, "step navigation must remain operably scrollable");
      layouts.push(layout); await screenshot(win, tempRoot, `player-guide-${locale}-${theme}-1280x720`, evidence);
      await click(win, '#playerGuideSteps button[data-step-index="4"]');
      await click(win, "#playerGuideDetails summary");
      await screenshot(win, tempRoot, `player-guide-voice-${locale}-${theme}-1280x720`, evidence);
      await click(win, "#playerGuideClose"); await waitFor(win, "guide closes after layout capture", "!document.querySelector('#playerGuideDialog').open");
    }
    await click(win, "#settingsTabDisplay"); await change(win, "#gameLanguageSelect", "zh-CN");
    await waitFor(win, "Chinese restored for synthetic opening", "document.documentElement.lang==='zh-CN' && !state.settingsSaving && !state.settingsDirty && !state.settingsSaveTask && !state.settingsAutosaveTimer");
    assert.deepEqual([evidence.modelCalls, evidence.chapterModelCalls, evidence.ttsRequests], [0, 0, 0]);
    return { ...evidence, revision: 0, layouts };
  }

  await assertPrompt();
  await click(win, "#playerGuideStart"); await click(win, "#playerGuideSettingsLink");
  await waitFor(win, "tutorial leads directly to connection settings", "!document.querySelector('#playerGuideDialog').open && document.querySelector('#settingsDialog').open && !document.querySelector('#settingsPanelAi').hidden");
  await change(win, "#apiKeyInput", syntheticKey, "input"); await click(win, "#testKeyButton");
  await waitFor(win, "connection verified and key concealed", "(async () => (await window.greyCrow.getStatus()).keyVerified && document.querySelector('#apiKeyInput').value==='')()");
  assert.ok(!(await evaluate(win, "document.body.innerText")).includes(syntheticKey));
  await click(win, "#closeSettingsButton");
  assert.deepEqual([evidence.modelCalls, evidence.chapterModelCalls, evidence.ttsRequests], [0, 0, 0], "connection probe is not a tutorial/story call");
  await click(win, "#newGameButton"); await waitFor(win, "first-player new-game setup", "document.querySelector('#newGameSetupDialog').open && Boolean(document.querySelector('#newGamePresetSelect').value)");
  assert.ok((await evaluate(win, "document.querySelector('#newGamePresetDescription').textContent")).includes('上海'), 'the player sees the story setting before creating an adventure');
  await evaluate(win, "document.querySelector('#newGameSetupForm').scrollTop=0");
  await screenshot(win, tempRoot, "player-guide-scenario-introduction", evidence);
  await click(win, "#prepareNewGameButton"); await waitFor(win, "new-game review", "!document.querySelector('#newGameReviewPanel').classList.contains('hidden')");
  await click(win, "#prepareNewGameButton");
  await waitFor(win, "real first opening question", "(async () => {const status=await window.greyCrow.getStatus(); return status.activeSave?.revision===1 && !state.busy && !document.querySelector('#sendTurnButton').disabled && document.querySelectorAll('#narrationPanel .narration-line.host').length>=1;})()");
  // The game-ui tour is independent from the first-player guide.  A new
  // adventure may open it only after the actual opening text is fully shown;
  // skip it here so the original four-turn story regression remains unchanged.
  await waitFor(win, "opening text settled before game tour", "!state.narrationDelivery && state.typewriterTimers.size===0", 20_000);
  await waitFor(win, "new-adventure game tour opens", "document.querySelector('#gameTourDialog')?.open===true", 20_000);
  await click(win, "#gameTourSkip");
  await waitFor(win, "new-adventure game tour skipped", "(async () => (await window.greyCrow.getTutorialProgress('game-ui')).progress.dismissed===true && !document.querySelector('#gameTourDialog')?.open)()");
  await change(win, "#turnInput", PLAYER_DESCRIPTION, "input");
  assert.equal(await evaluate(win, "document.querySelector('#turnInput').value"), PLAYER_DESCRIPTION, "non-modal prompt may not lose a player draft");
  await click(win, "#sendTurnButton"); await waitFor(win, "opening description committed", "(async () => {const status=await window.greyCrow.getStatus();return status.activeSave?.revision===2 && !state.busy && !document.querySelector('#sendTurnButton').disabled && document.querySelectorAll('#narrationPanel .narration-line.host').length>=2;})()");
  await submit(win, PLAYER_CONFIRMATION); await waitFor(win, "opening confirmed", "(async () => {const status=await window.greyCrow.getStatus();return status.activeSave?.revision===3 && !state.busy && !document.querySelector('#sendTurnButton').disabled && document.querySelectorAll('#narrationPanel .narration-line.host').length>=3;})()");
  await submit(win, PLAYER_BORROW); await waitFor(win, "first actual player action committed", "(async () => {const status=await window.greyCrow.getStatus(); return status.activeSave?.revision===4 && status.gameStarted && !state.busy && !document.querySelector('#sendTurnButton').disabled && document.querySelectorAll('#narrationPanel .narration-line.host').length>=4;})()");
  assert.equal(evidence.modelCalls, 4); assert.equal(evidence.chapterModelCalls, 0);
  await waitFor(win, "first action text fully revealed", "!state.narrationDelivery && state.typewriterTimers.size===0");
  const draft = "我先保留这句话，稍后再决定。";
  await change(win, "#turnInput", draft, "input");
  const reading = await evaluate(win, "(() => {const panel=document.querySelector('#narrationPanel');panel.scrollTop=Math.min(24,Math.max(0,panel.scrollHeight-panel.clientHeight));return {top:panel.scrollTop,text:panel.textContent};})()");
  await click(win, "#gameSettingsButton"); await click(win, "#openGameTourButton");
  await waitFor(win, "active story interface tour", "document.querySelector('#gameTourDialog')?.open===true");
  await click(win, "#gameTourNext");
  assert.equal(await evaluate(win, "document.querySelector('#gameTourDialog').dataset.step"), "world");
  await click(win, "#gameTourPrevious");
  assert.equal(await evaluate(win, "document.querySelector('#gameTourDialog').dataset.step"), "narration");
  const readingPoint = await evaluate(win, "(() => {const r=document.querySelector('#narrationPanel').getBoundingClientRect();return {x:Math.round(r.left+80),y:Math.round(r.top+40)};})()");
  win.webContents.sendInputEvent({ type: "mouseWheel", ...readingPoint, deltaX: 0, deltaY: 200, canScroll: true });
  await evaluate(win, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  assert.deepEqual(await evaluate(win, "(() => {const panel=document.querySelector('#narrationPanel');return {top:panel.scrollTop,text:panel.textContent};})()"), reading, "tour blocks wheel scrolling through the spotlight");
  for (let i=0; i<6; i++) await click(win, "#gameTourNext");
  await waitFor(win, "records spotlight in the actual new adventure", "document.querySelector('#gameTourDialog')?.dataset.step==='records'");
  await screenshot(win, tempRoot, "game-tour-new-adventure-records", evidence);
  await click(win, "#gameTourSkip");
  await waitFor(win, "active-story tour dismissed", "!document.querySelector('#gameTourDialog')?.open");
  assert.equal(await evaluate(win, "document.querySelector('#turnInput').value"), draft);
  assert.deepEqual(await evaluate(win, "(() => {const panel=document.querySelector('#narrationPanel');return {top:panel.scrollTop,text:panel.textContent};})()"), reading);
  assert.equal((await readStatus(win)).activeSave.revision, 4);
  await click(win, "#gameSettingsButton"); await click(win, "#openPlayerGuideButton");
  await waitFor(win, "guide rewatch inside an active game", "document.querySelector('#playerGuideDialog').open");
  await click(win, '#playerGuideSteps button[data-step-index="5"]'); await click(win, "#playerGuideNext");
  await waitFor(win, "tutorial completion persisted", "(async () => (await window.greyCrow.getTutorialProgress()).progress.dismissed && !document.querySelector('#playerGuideDialog').open)()");
  const activeDataBeforeReset = digestTree(dataRoot, new Set(["tutorial-progress.json", "game-tour-progress.json"]));
  await click(win, "#resetPlayerGuideButton");
  await waitFor(win, "reset with an active story", "(async () => (await window.greyCrow.getTutorialProgress()).progress.dismissed===false && (await window.greyCrow.getTutorialProgress('game-ui')).progress.dismissed===false)()");
  assert.deepEqual(digestTree(dataRoot, new Set(["tutorial-progress.json", "game-tour-progress.json"])), activeDataBeforeReset, 'reset preserves actual story, settings and credential files');
  await click(win, "#closeSettingsButton");
  await waitFor(win, "active game restored after rewatch", "(async () => (await window.greyCrow.getStatus()).activeSave?.revision===4 && !document.querySelector('#settingsDialog').open)()");
  await waitFor(win, "reset interface tour opens on actual story", "document.querySelector('#gameTourDialog')?.open===true");
  await click(win, "#gameTourSkip");
  await waitFor(win, "reset interface tour releases actual story", "!document.querySelector('#gameTourDialog')?.open");
  assert.equal(await evaluate(win, "document.querySelector('#turnInput').value"), draft, "rewatching tutorial may not lose an active-game draft");
  assert.deepEqual(await evaluate(win, "(() => {const panel=document.querySelector('#narrationPanel');return {top:panel.scrollTop,text:panel.textContent};})()"), reading, "rewatching tutorial may not reset reading position");
  await screenshot(win, tempRoot, "player-guide-first-action-with-prompt", evidence);
  return { ...evidence, revision: 4, status: await readStatus(win) };
}

module.exports = { handlesPhase, runCoordinator, runPhase };
