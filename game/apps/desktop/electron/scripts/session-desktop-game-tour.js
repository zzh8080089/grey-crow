"use strict";

// Real Electron Main -> preload -> renderer checks for the in-game interface
// tour.  The prepared save is a ready state, so entering it never needs a
// story response; only the normal local connection probe may be synthetic.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PHASES = ["game_tour_zh_first", "game_tour_zh_restart", "game_tour_en_layout", "game_tour_ja_layout"];
const TARGETS = [
  ["#narrationPanel"], ["#storyNotebookWorldCard", "#stateGrid"], ["#storyNotebookHostStatus"], ["#contextMeter", "#storyNotebookLive"],
  ["#storyNotebookStateButton"], ["#storyNotebookCharactersButton"], ["#storyNotebookModulesButton"], ["#storyNotebookChaptersButton"],
  ["#storyNotebookDirectoryButton"], ["#commandMenu"], ["#turnInput", "#sendTurnButton"], ["#speechInputButton", "#ttsPlaybackToggleButton"], ["#gameSettingsButton"],
];
const STEP_NAMES = ["narration", "world", "host", "connection", "state", "characters", "records", "chapters", "directory", "shortcuts", "input", "speech", "settings"];
const LOCALE_FOR_PHASE = { game_tour_zh_first: "zh-CN", game_tour_zh_restart: "zh-CN", game_tour_en_layout: "en-US", game_tour_ja_layout: "ja-JP" };
const handlesPhase = phase => PHASES.includes(phase);

function makeTempRoot() {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
  for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(tempRoot, name));
  return tempRoot;
}

function environment(tempRoot, rootEnv) {
  const env = {};
  // Preserve the real home only as a read-only inherited value. All data, XDG,
  // temporary and Electron user-data paths below are redirected to tempRoot.
  for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TMPDIR: path.join(tempRoot, "tmp"), XDG_CONFIG_HOME: path.join(tempRoot, "home", "config"),
    XDG_CACHE_HOME: path.join(tempRoot, "home", "cache"), [rootEnv]: tempRoot, GREY_CROW_DATA_ROOT: path.join(tempRoot, "data"),
    GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tempRoot, "provider-check"), GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(tempRoot, "kokoro-fixture") });
  return env;
}

async function runCoordinator({ runPhase, createSettingsFixture, rootEnv }) {
  const runs = [];
  for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
    const tempRoot = makeTempRoot();
    await createSettingsFixture(tempRoot, locale);
    const env = environment(tempRoot, rootEnv);
    const phases = locale === "zh-CN" ? ["game_tour_zh_first", "game_tour_zh_restart"] : [locale === "en-US" ? "game_tour_en_layout" : "game_tour_ja_layout"];
    process.stdout.write(`Game tour ${locale} artifacts: ${tempRoot}\n`);
    for (const phase of phases) runs.push(await runPhase(require("electron"), phase, env));
  }
  assert(runs.every(run => run.modelCalls === 0 && run.chapterModelCalls === 0 && run.ttsRequests === 0), "tour review must not produce story, chapter, or speech work");
  const result = { ok: true, suite: "game-tour", runs,
    evidence: "Actual isolated Electron Main/preload/renderer with seeded ready-state saves; only the normal synthetic connection probe is permitted.",
    limitations: ["No real provider, microphone, spoken-audio quality, native-language acceptance, Windows, or release validation."] };
  for (const run of runs) fs.writeFileSync(path.join(run.tempRoot, "results", "game-tour-result.json"), `${JSON.stringify({ ...result, runs: runs.filter(item => item.tempRoot === run.tempRoot) }, null, 2)}\n`);
  process.stdout.write(JSON.stringify({ ok: true, suite: result.suite, phases: runs.map(run => ({ phase: run.phase, screenshots: run.screenshots.length, locale: run.locale })) }, null, 2) + "\n");
}

function digestTree(root, omit = new Set()) {
  const output = {};
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name), relative = path.relative(root, absolute);
      if (omit.has(relative)) continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) output[relative] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    }
  };
  if (fs.existsSync(root)) walk(root);
  return output;
}

async function runPhase(win, evidence, tempRoot, ui) {
  const { click, change, evaluate, readStatus, waitFor, screenshot, connectSyntheticModel } = ui;
  const locale = LOCALE_FOR_PHASE[evidence.phase];
  assert.ok(locale);
  const progress = () => evaluate(win, "window.greyCrow.getTutorialProgress('game-ui')");
  const tourOpen = "document.querySelector('#gameTourDialog')?.open===true";
  const ready = `(async () => { const status=await window.greyCrow.getStatus(); return status.activeSave && !state.busy && !document.querySelector('#gameView').classList.contains('hidden') && !document.querySelector('#sendTurnButton').disabled; })()`;
  await waitFor(win, "game tour bridge and mounted lifecycle", "Boolean(window.greyCrow?.getTutorialProgress) && Boolean(gameTourLifecycle) && Boolean(state.settingsCatalog)");
  if (!(await readStatus(win)).keyVerified) { await connectSyntheticModel(win); await click(win, "#closeSettingsButton"); }
  await click(win, "#continueGameButton"); await waitFor(win, "seeded ready adventure opened", ready);
  await waitFor(win, "book and typewriter settled before tour", "!state.narrationDelivery && state.typewriterTimers.size===0", 20_000);
  if (evidence.phase === "game_tour_zh_restart") {
    assert.deepEqual(await progress(), { ok: true, progress: { version: 1, dismissed: true } });
    await waitFor(win, "dismissed tour remains absent after restart", "!document.querySelector('#gameTourDialog')?.open", 5_000);
    assert.equal((await progress()).progress.dismissed, true);
    await click(win, "#gameSettingsButton"); await click(win, "#openGameTourButton");
    await waitFor(win, "settings manually reopens game tour", tourOpen);
    await verifyStep(win, 0, evaluate, waitFor);
    const revision = (await readStatus(win)).activeSave.revision;
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" }); win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await waitFor(win, "escape closes game tour", "!document.querySelector('#gameTourDialog')?.open");
    assert.equal((await readStatus(win)).activeSave.revision, revision, "Escape must not submit a turn");
    return { ...evidence, tempRoot, locale, revision, status: await readStatus(win) };
  }

  assert.deepEqual(await progress(), { ok: true, progress: { version: 1, dismissed: false } });
  await waitFor(win, "first eligible game tour opens automatically", tourOpen, 20_000);
  assert.equal(await evaluate(win, "!isNotebookPresentationBlocked() && !state.narrationDelivery && state.typewriterTimers.size===0"), true);
  await assertTourDialog(win, locale, evaluate);
  const before = await readStatus(win);
  const draft = `tour-draft-${locale}`;
  const untouchedDraft = await evaluate(win, "document.querySelector('#turnInput').value");
  // Use native input events while the modal is open.  The dialog must consume
  // both the Enter key and a pointer event through the input/send spotlight.
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" }); win.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
  const sendPoint = await evaluate(win, "(() => {const r=document.querySelector('#sendTurnButton').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
  win.webContents.sendInputEvent({ type: "mouseDown", x: sendPoint.x, y: sendPoint.y, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", x: sendPoint.x, y: sendPoint.y, button: "left", clickCount: 1 });
  await waitFor(win, "tour blocks Enter and spotlight click", `(async () => (await window.greyCrow.getStatus()).activeSave?.revision===${before.activeSave.revision} && document.querySelector('#turnInput').value===${JSON.stringify(untouchedDraft)})()`);
  await click(win, "#gameTourSkip");
  await waitFor(win, "initial tour closes without a turn", "!document.querySelector('#gameTourDialog')?.open");
  await change(win, "#turnInput", draft, "input");
  await click(win, "#gameSettingsButton"); await click(win, "#openGameTourButton");
  await waitFor(win, "manual tour opens for full step check", tourOpen);
  const visitedSteps = [];
  for (let turn = 0; turn < TARGETS.length; turn++) {
    const index = await evaluate(win, "['narration','world','host','connection','state','characters','records','chapters','directory','shortcuts','input','speech','settings'].indexOf(document.querySelector('#gameTourDialog')?.dataset.step)");
    assert(index >= 0 && !visitedSteps.includes(index), `unexpected tour step ${index}: ${JSON.stringify(visitedSteps)}`);
    visitedSteps.push(index);
    const step = await verifyStep(win, index, evaluate, waitFor);
    if (index === 10) {
      const point = await evaluate(win, "(() => {const r=document.querySelector('#sendTurnButton').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
      win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
      await evaluate(win, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert.equal(await evaluate(win, "document.querySelector('#turnInput').value"), draft);
      assert.deepEqual(evidence.tourActionRequests || [], [], "clicking the live send target through its spotlight must not issue an action");
    }
    if (index === 11) {
      const phaseBefore = await evaluate(win, "speechInputController.snapshot().phase");
      const point = await evaluate(win, "(() => {const node=document.querySelector('#speechInputButton'),r=node.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),enabled:!node.disabled};})()");
      assert.equal(point.enabled, true, "microphone control must be available for a meaningful isolation check");
      const coordinates = { x: point.x, y: point.y };
      win.webContents.sendInputEvent({ type: "mouseDown", ...coordinates, button: "left", clickCount: 1 });
      win.webContents.sendInputEvent({ type: "mouseUp", ...coordinates, button: "left", clickCount: 1 });
      await evaluate(win, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert.equal(await evaluate(win, "speechInputController.snapshot().phase"), phaseBefore);
      assert.equal(await evaluate(win, "document.querySelector('#settingsDialog').open"), false, "covered microphone must not open voice setup");
      assert.equal(await evaluate(win, "document.querySelector('#gameTourDialog')?.dataset.step"), "speech");
    }
    if ([0, 1, 6, 10, 11, 12].includes(index)) await screenshot(win, tempRoot, `game-tour-${locale}-step-${index + 1}`, evidence);
    await click(win, "#gameTourNext");
    if (index === 10) assert.equal(step.hasTargetClone, false, "tour must highlight the real input rather than copy a playable input into its card");
    if (index === TARGETS.length - 1) break;
  }
  assert.equal(visitedSteps.at(-1), TARGETS.length - 1, JSON.stringify(visitedSteps));
  assert.deepEqual(evidence.tourActionRequests || [], []);
  await waitFor(win, "game tour acknowledgement persisted", "(async () => (await window.greyCrow.getTutorialProgress('game-ui')).progress.dismissed===true && !document.querySelector('#gameTourDialog')?.open)()");
  assert.equal(fs.existsSync(path.join(tempRoot, "data", "game-tour-progress.json")), true, "game-ui progress has its own durable record");
  assert.equal((await readStatus(win)).activeSave.revision, before.activeSave.revision, "tour buttons and Enter must not send a story turn");
  assert.equal(await evaluate(win, "document.querySelector('#turnInput').value"), draft, "tour must not lose a player draft");

  const layouts = [];
  for (const theme of ["light", "dark"]) for (const [width, height] of [[1280, 720], [1600, 900]]) {
    await click(win, "#gameSettingsButton"); await click(win, "#settingsTabDisplay"); await change(win, "#storyNotebookThemeSelect", theme);
    await waitFor(win, `${locale} ${theme} saved`, `state.storyNotebookTheme===${JSON.stringify(theme)} && !state.settingsSaving && !state.settingsDirty`);
    await click(win, "#openGameTourButton"); await waitFor(win, `${locale} ${theme} tour`, tourOpen);
    win.setAspectRatio(0); win.setContentSize(width, height, false); win.center();
    await waitFor(win, `${width} by ${height} viewport`, `innerWidth===${width} && innerHeight===${height}`);
    for (let index=0; index<TARGETS.length; index++) {
      const layout = await verifyStep(win, index, evaluate, waitFor);
      assert(layout.dialogFits && layout.cardFits && !layout.cardOverlapsTarget && layout.highlightVisible, JSON.stringify(layout));
      layouts.push({ ...layout, locale, theme, width, height });
      if (index===0) await screenshot(win, tempRoot, `game-tour-${locale}-${theme}-${width}x${height}`, evidence);
      if (index<TARGETS.length-1) await click(win, "#gameTourNext");
    }
    await click(win, "#gameTourSkip"); await waitFor(win, "manual layout tour closes", "!document.querySelector('#gameTourDialog')?.open");
  }
  const protectedBeforeReset = digestTree(path.join(tempRoot, "data"), new Set(["game-tour-progress.json", "tutorial-progress.json"]));
  await click(win, "#gameSettingsButton"); await click(win, "#resetPlayerGuideButton");
  await waitFor(win, "both tutorial records reset", "(async () => (await window.greyCrow.getTutorialProgress()).progress.dismissed===false && (await window.greyCrow.getTutorialProgress('game-ui')).progress.dismissed===false)()");
  assert.deepEqual(digestTree(path.join(tempRoot, "data"), new Set(["game-tour-progress.json", "tutorial-progress.json"])), protectedBeforeReset,
    "tutorial reset must preserve the actual save, preferences and credential hashes");
  await click(win, "#closeSettingsButton");
  await waitFor(win, "reset makes the tour eligible again", tourOpen);
  await click(win, "#gameTourSkip");
  await waitFor(win, "reset tour dismissed for restart check", "(async () => (await window.greyCrow.getTutorialProgress('game-ui')).progress.dismissed===true && !document.querySelector('#gameTourDialog')?.open)()");
  assert.equal((await readStatus(win)).activeSave.revision, before.activeSave.revision);
  assert.equal(await evaluate(win, "document.querySelector('#turnInput').value"), draft);
  return { ...evidence, tempRoot, locale, revision: before.activeSave.revision, layouts, status: await readStatus(win) };
}

async function assertTourDialog(win, locale, evaluate) {
  const dialog = await evaluate(win, `(() => { const node=document.querySelector('#gameTourDialog'); return { id:node?.id, open:node?.open, native:node instanceof HTMLDialogElement, locale:document.documentElement.lang, full:node?.getBoundingClientRect().width===innerWidth && node?.getBoundingClientRect().height===innerHeight }; })()`);
  assert.deepEqual(dialog, { id: "gameTourDialog", open: true, native: true, locale, full: true });
}

async function verifyStep(win, index, evaluate, waitFor) {
  // Allow native resize and the renderer's geometry-following frame to run.
  await evaluate(win, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await waitFor(win, `game tour spotlight settles for ${STEP_NAMES[index]}`, "(() => { const node=document.querySelector('#gameTourSpotlight'); return !!node && node.getAnimations().every(animation => animation.playState !== 'running'); })()");
  const selectors = TARGETS[index];
  const layout = await evaluate(win, `(() => {
    const selectors=${JSON.stringify(selectors)}, expectedStep=${JSON.stringify(STEP_NAMES[index])}, dialog=document.querySelector('#gameTourDialog'), highlight=document.querySelector('#gameTourSpotlight'), card=document.querySelector('#gameTourCard');
    const visible=node=>!!node?.getClientRects().length && !node.hidden && getComputedStyle(node).visibility!=='hidden';
    const nodes=selectors.map(selector=>document.querySelector(selector)).filter(visible);
    if (!nodes.length) return {missing:selectors};
    const rs=nodes.map(node=>node.getBoundingClientRect()), left=Math.min(...rs.map(r=>r.left)), top=Math.min(...rs.map(r=>r.top)), right=Math.max(...rs.map(r=>r.right)), bottom=Math.max(...rs.map(r=>r.bottom));
    const focusBottom=${index}===0 ? Math.min(bottom, top+300) : bottom;
    const h=highlight.getBoundingClientRect(), c=card.getBoundingClientRect(), overlap=!(c.right<=left || c.left>=right || c.bottom<=top || c.top>=focusBottom);
    const narrationFocus=${index}===0 ? Math.abs(h.left-Math.max(0,left-7))<1&&Math.abs(h.right-Math.min(innerWidth,right+7))<1&&Math.abs(h.top-Math.max(0,top-7))<1&&Math.abs(h.bottom-Math.min(innerHeight,focusBottom+7))<1 : h.left<=left&&h.top<=top&&h.right>=right&&h.bottom>=bottom;
    const clone=Boolean(card.querySelector('#turnInput, #sendTurnButton, #speechInputButton'));
    return { index:${index}, target:{left,top,right,bottom}, highlight:{left:h.left,top:h.top,right:h.right,bottom:h.bottom},
      step:dialog.dataset.step, expectedStep,
      dialogFits:dialog.getBoundingClientRect().left===0 && dialog.getBoundingClientRect().top===0 && dialog.getBoundingClientRect().right===innerWidth && dialog.getBoundingClientRect().bottom===innerHeight,
      cardFits:c.left>=0&&c.top>=0&&c.right<=innerWidth&&c.bottom<=innerHeight, cardOverlapsTarget:overlap, highlightVisible:visible(highlight),
      highlightMatchesTarget:narrationFocus, hasTargetClone:clone,
      buttons:Array.from(dialog.querySelectorAll('button')).every(node=>visible(node)) };
  })()`);
  assert.ok(!layout.missing, JSON.stringify(layout)); assert.equal(layout.step, STEP_NAMES[index], JSON.stringify(layout)); assert(layout.highlightMatchesTarget, JSON.stringify(layout));
  assert.equal(layout.hasTargetClone, false, JSON.stringify(layout)); assert.equal(layout.buttons, true, JSON.stringify(layout));
  assert(layout.dialogFits && layout.cardFits && !layout.cardOverlapsTarget, JSON.stringify(layout));
  return layout;
}

module.exports = { handlesPhase, runCoordinator, runPhase };
