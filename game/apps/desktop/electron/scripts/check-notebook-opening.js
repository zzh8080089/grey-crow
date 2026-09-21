"use strict";

// Invoked by check-notebook-layout.js after continueGame.  This drives the
// real Electron renderer only; its controlled mutations stay inside the
// committed synthetic session and are restored before returning.
const assert = require("node:assert/strict");

const openingState = `(() => {
  const book=notebookBookController, video=document.querySelector('#themeOpeningVideo'), input=ui.turnInput;
  return {phase:book?.getState()?.phase||null,handoff:Boolean(book?.getState()?.handoff),
    inert:Boolean(ui.gameView.inert), narration:document.querySelector('#narrationPanel')?.innerText?.trim()||'',
    projection:document.body.dataset.bookProjection==='true', videoTime:video?.currentTime||0,
    videoSrc:video?.getAttribute('src')||'', inputIsOriginal:window.__openingInputNode===input,
    inputValue:input?.value||'', inputPlaceholder:input?.placeholder||'',
    readingReady:document.body.classList.contains('book-reading-ready')};
})()`;

async function runOpeningChecks(win, evidence, root, ui) {
  const { evaluate, waitFor, screenshot } = ui;
  evidence.openingChecks = [];
  await evaluate(win, "window.__openingInputNode=ui.turnInput;window.__openingInputValue=ui.turnInput.value;");
  await waitFor(win, "notebook opening begins", "notebookBookController?.getState()?.phase==='opening'");

  // The real six-second film must expose live narration only through the
  // projected/masked game DOM, and must keep every input inert.
  await waitFor(win, "opening projected live narration", `(() => {const s=${openingState};return s.phase==='opening'&&s.inert&&s.narration.length>0&&s.projection;})()`);
  await waitFor(win, "opening frame about 72", "document.querySelector('#themeOpeningVideo')?.currentTime >= 2.8");
  const frame72 = await evaluate(win, openingState);
  assert.ok(frame72.inert && frame72.narration && frame72.projection, "frame 72 must show masked live narration while input remains inert");
  assert.equal(frame72.inputPlaceholder, await evaluate(win, 't("game.input.placeholder")'),
    "temporary opening lock must not tell the player their active story is read-only");
  await screenshot(win, root, `${evidence.phase}-notebook-opening-frame72`, evidence);
  await waitFor(win, "opening frame about 94", "document.querySelector('#themeOpeningVideo')?.currentTime >= 3.7");
  const frame94 = await evaluate(win, openingState);
  assert.ok(frame94.inert && frame94.narration && frame94.projection, "frame 94 must retain live masked narration and inert input");
  await screenshot(win, root, `${evidence.phase}-notebook-opening-frame94`, evidence);

  await waitFor(win, "opening natural reading completion", "notebookBookController?.getState()?.phase==='reading'");
  const settled = await evaluate(win, openingState);
  assert.equal(settled.inputIsOriginal, true, "natural opening must retain the original input DOM node");
  assert.equal(settled.inputValue, await evaluate(win, "window.__openingInputValue"), "natural opening must retain the input draft");
  assert.equal(settled.videoSrc, "", "natural film completion must unload video src");
  assert.equal(settled.inert, false, "reading must release game input");
  await screenshot(win, root, `${evidence.phase}-notebook-opening-reading`, evidence);
  evidence.openingChecks.push({ scenario: "natural-film", frame72, frame94, settled });

  if (evidence.phase === "notebook_layout_display") {
    await evaluate(win, "state.storyNotebookTheme='dark';renderGameUiLayout();notebookBookController.prepare(captureRuntimeViewBinding());void notebookBookController.open();");
    await waitFor(win, "dark movie projects live page", "document.body.dataset.bookProjection==='true' && document.querySelector('#themeOpeningVideo').currentTime>=3.7");
    const dark = await evaluate(win, openingState);
    assert.ok(dark.inert && dark.projection && dark.videoSrc.endsWith('opening-dark.mp4'));
    await screenshot(win,root,`${evidence.phase}-notebook-dark-opening`,evidence);
    await waitFor(win,"dark movie ends naturally","notebookBookController.getState().phase==='reading'");
    await evaluate(win,"document.querySelector('#themeStudyImage').decode()");
    await screenshot(win,root,`${evidence.phase}-notebook-dark-reading`,evidence);
    evidence.openingChecks.push({scenario:'dark-natural-film',dark});
    await evaluate(win,"state.storyNotebookTheme='light';renderGameUiLayout();");
  }

  const synthetic = await evaluate(win, `(async () => {
    const book=notebookBookController,binding=captureRuntimeViewBinding(),input=ui.turnInput,original=input.value;
    book.prepare(binding); const waiting=book.whenReadable(binding); const opening=book.open(binding); book.skip();
    return {openResult:await opening, readable:await waiting, phase:book.getState().phase,
      sameInput:input===window.__openingInputNode,draft:input.value===original,videoSrc:document.querySelector('#themeOpeningVideo')?.getAttribute('src')||''};
  })()`);
  assert.equal(synthetic.phase, "reading", "skip must land on reading");
  assert.equal(synthetic.readable, true, "skip must make the current binding readable");
  assert.ok(synthetic.sameInput && synthetic.draft, "skip must preserve the original input and draft");

  const sync = await evaluate(win, `(() => {
    const book=notebookBookController, before=state.storyNotebookTheme;
    state.storyNotebookTheme=before==='dark'?'light':'dark'; book.sync(); const changed=book.getState();
    state.storyNotebookTheme=before; book.sync();
    return {before,changedTheme:changed.theme,phase:changed.phase};
  })()`);
  assert.equal(sync.phase, "reading", "theme sync in reading must stay readable");
  assert.notEqual(sync.changedTheme, sync.before, "theme sync must update the loaded still theme");

  const cancelled = await evaluate(win, `(async () => {
    const book=notebookBookController,binding=captureRuntimeViewBinding(); book.prepare(binding);
    const waiting=book.whenReadable(binding); book.cancel(); return {readable:await waiting,phase:book.getState().phase};
  })()`);
  assert.equal(cancelled.readable, false, "cancelled binding must never become readable");
  assert.equal(cancelled.phase, "idle", "cancel must clear opening state");

  const missingMedia = await evaluate(win, `(async () => {
    const book=notebookBookController,binding=captureRuntimeViewBinding(),video=document.querySelector('#themeOpeningVideo'),originalLoad=video.load;
    try { video.load=function(){ queueMicrotask(()=>this.dispatchEvent(new Event('error'))); };
      book.prepare(binding); const opening=book.open(binding), readable=book.whenReadable(binding);
      return {openResult:await opening,readable:await readable,phase:book.getState().phase,videoSrc:video.getAttribute('src')||''};
    } finally { video.load=originalLoad; }
  })()`);
  assert.equal(missingMedia.phase, "reading", "injected media error must take the static reading fallback");
  assert.equal(missingMedia.readable, true, "static media fallback must be readable");
  assert.equal(missingMedia.videoSrc, "", "static fallback must unload the failed source");
  evidence.openingChecks.push({ scenario: "skip-theme-cancel-media-fallback", synthetic, sync, cancelled, missingMedia,
    boundary: "The media error is a renderer-only load override to exercise fallback; it is restored and does not call a Provider." });

  // Chromium's media emulation is isolated and restored. It only proves the
  // reduced-motion branch; it does not stand in for a player preference test.
  const debuggerWasAttached = win.webContents.debugger.isAttached();
  try {
    if (!debuggerWasAttached) win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const reduced = await evaluate(win, `(async () => {
      const book=notebookBookController,binding=captureRuntimeViewBinding(); book.prepare(binding);
      const opened=await book.open(binding); return {opened,phase:book.getState().phase,readable:await book.whenReadable(binding),matches:matchMedia('(prefers-reduced-motion: reduce)').matches};
    })()`);
    assert.ok(reduced.matches && reduced.opened && reduced.readable, "reduced motion must take a usable static reading path");
    assert.equal(reduced.phase, "reading", "reduced motion must not leave a film opening active");
    evidence.openingChecks.push({ scenario: "reduced-motion", reduced, boundary: "Chromium media emulation only; restored before returning." });
  } finally {
    if (!debuggerWasAttached) {
      await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
      win.webContents.debugger.detach();
    }
  }
  await evaluate(win, "delete window.__openingInputNode;delete window.__openingInputValue;");
  return evidence.openingChecks;
}

module.exports = { runOpeningChecks };
