'use strict';
const assert=require('node:assert/strict');

// The actual mounted renderer and Chromium pointer events, with explicit
// synthetic capture/transcription adapters. No microphone or native worker.
exports.run=async function(win,evidence,root,ui) {
  const {evaluate,waitFor,screenshot}=ui;
  await evaluate(win,`(() => {
    speechInputController.dispose();
    window.__holdProbe={captures:0,stops:0,cancels:0,requests:0,version:0,original:ui.turnInput.value};
    const probe=window.__holdProbe;
    speechInputController=GreyCrowSpeechInput.mount({t,
      getContext:()=>({...captureRuntimeViewBinding(),ready:!state.busy&&!isStoryInputLocked()&&!isNotebookPresentationBlocked()}),
      getSettings:()=>({enabled:true,deviceId:'default',language:'zh'}),
      getDraft:()=>({text:ui.turnInput.value,version:speechDraftVersion}),
      setDraft:text=>{ui.turnInput.value=text;speechDraftVersion++;},
      onSettingsInput:()=>{},canShortcut:()=>false,
      api:{getSpeechInputStatus:async()=>({ok:true,status:{runtimeAvailable:true,modelInstalled:true,enabled:true}}),
        cancelSpeechInput:async()=>{probe.cancels++;return {ok:true}},
        transcribeSpeechInput:async()=>{probe.requests++;return new Promise(resolve=>{probe.reply=resolve})}},
      createRecorder:async()=>{probe.captures++;return {cancel(){},stop:async()=>{probe.stops++;return new ArrayBuffer(44)}}},
      onChange:()=>{renderTurnInputState()}
    });
    ui.turnInput.value='';ui.turnInput.dispatchEvent(new Event('input',{bubbles:true}));
    ui.turnInput.focus();ui.turnInput.setSelectionRange(0,0);renderTurnInputState();
  })()`);
  win.focus();
  const point=await evaluate(win,`(() => {const r=ui.turnInput.getBoundingClientRect();return {x:Math.round(r.x+r.width*.5),y:Math.round(r.y+r.height*.5)}})()`);
  const mouse=type=>win.webContents.sendInputEvent({type,button:'left',clickCount:1,...point});
  mouse('mouseMove'); mouse('mouseDown'); mouse('mouseUp');
  await evaluate(win,'new Promise(resolve=>setTimeout(resolve,450))');
  assert.equal(await evaluate(win,'__holdProbe.captures'),0,'short text click never acquires a microphone');
  mouse('mouseDown');
  await waitFor(win,'held text field starts capture','speechInputController.snapshot().phase === "recording"');
  await screenshot(win,root,'notebook-hold-recording',evidence);
  mouse('mouseUp');
  await waitFor(win,'release begins one final recognition','speechInputController.snapshot().phase === "transcribing" && __holdProbe.requests===1');
  await evaluate(win,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate(win,'__holdProbe.cancels'),0,'normal lostpointercapture cannot cancel final recognition');
  assert.equal(await evaluate(win,'ui.turnInput.disabled'),false,'release leaves the text field editable');
  await win.webContents.insertText('typed after release');
  await evaluate(win,'__holdProbe.reply({ok:true,result:{text:"synthetic recognized text"}})');
  await waitFor(win,'late recognition preserves newly typed text','speechInputController.snapshot().pending?.reason === "changed"');
  assert.equal(await evaluate(win,'ui.turnInput.value'),'typed after release');
  assert.equal(await evaluate(win,'__holdProbe.stops'),1);
  await screenshot(win,root,'notebook-hold-release-edit',evidence);
  evidence.speechHoldPointer=await evaluate(win,`({captures:__holdProbe.captures,stops:__holdProbe.stops,recognitionRequests:__holdProbe.requests,cancels:__holdProbe.cancels,draft:ui.turnInput.value,pending:speechInputController.snapshot().pending.reason})`);
  evidence.speechHoldPointer.boundary='Native Chromium mouse events and production mounted renderer; synthetic recorder and recognizer only, no microphone, audio capture or recognition accuracy claim.';
  await evaluate(win,`speechInputController.discardPending();ui.turnInput.value=__holdProbe.original;delete window.__holdProbe;`);
};
