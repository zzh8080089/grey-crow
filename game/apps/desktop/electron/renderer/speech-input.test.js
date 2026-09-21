"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createController, createHoldGesture, encodeWav, mount, HOLD_DELAY_MS } = require("./speech-input.js");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

function holdFixture(overrides = {}) {
  const listeners = new Map(), hostListeners = new Map(), documentListeners = new Map();
  const timers = new Map(); let nextTimer = 0, started = 0, stopped = 0, cancelled = 0;
  const start = overrides.start || (async () => { started++; });
  const remove = (map, type, fn) => { if (map.get(type) === fn) map.delete(type); };
  const target = { addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type, fn) { remove(listeners, type, fn); },
    setPointerCapture() {}, releasePointerCapture() {} };
  const host = { addEventListener(type, fn) { hostListeners.set(type, fn); }, removeEventListener(type, fn) { remove(hostListeners, type, fn); },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  const document = { hidden: false, addEventListener(type, fn) { documentListeners.set(type, fn); }, removeEventListener(type, fn) { remove(documentListeners, type, fn); } };
  const gesture = createHoldGesture({ target, host, document, delayMs: HOLD_DELAY_MS, start,
    stop: () => { stopped++; }, cancel: () => { cancelled++; }, ...overrides.options });
  return { gesture, down: event => listeners.get("pointerdown")(event), up: event => listeners.get("pointerup")(event),
    move: event => listeners.get("pointermove")(event), cancelPointer: event => listeners.get("pointercancel")(event), blur: () => hostListeners.get("blur")(),
    hide: () => { document.hidden = true; documentListeners.get("visibilitychange")(); },
    runDelay: () => { for (const fn of [...timers.values()]) { timers.clear(); fn(); } },
    started: () => started, stopped: () => stopped, cancelled: () => cancelled,
    listenerCount: () => listeners.size + hostListeners.size + documentListeners.size };
}

function fixture(overrides = {}) {
  let context = { adventureId: "a", sessionId: "s", ready: true };
  let draft = { text: "原草稿", version: 0 }, clock = 0, timer, nextId = 0, releases = 0, cancelled = 0;
  const requests = [], remoteCancels = [];
  const reply = deferred();
  const controller = createController({
    api: {
      getSpeechInputStatus: async () => ({ ok: true, status: { enabled: true, runtimeAvailable: true, modelInstalled: true } }),
      transcribeSpeechInput: request => { requests.push(request); return reply.promise; },
      cancelSpeechInput: async request => { remoteCancels.push(request); },
      ...overrides.api,
    },
    getContext: () => context, getDraft: () => ({ ...draft }), getSettings: () => ({ enabled: true, deviceId: "default" }),
    setDraft: text => { draft = { text, version: draft.version + 1 }; },
    now: () => clock, uuid: () => `r${++nextId}`,
    setInterval: fn => { timer = fn; return 1; }, clearInterval: () => { timer = null; },
    acquireAudioFocus: () => () => { releases++; },
    createRecorder: async () => ({ stop: async () => new ArrayBuffer(44), cancel: () => { cancelled++; } }),
    ...overrides.hooks,
  });
  return { controller, requests, remoteCancels, reply,
    draft: () => draft, edit: text => { draft = { text, version: draft.version + 1 }; },
    changeContext: next => { context = next; controller.contextChanged(); },
    advance: value => { clock = value; timer?.(); }, releases: () => releases, cancelled: () => cancelled };
}

test("unchanged draft receives one result; controller never submits an action", async () => {
  const f = fixture(); await f.controller.start();
  const stopped = f.controller.stop(); await flush();
  assert.equal(f.requests.length, 1);
  f.reply.resolve({ ok: true, result: { text: "识别文字" } }); await stopped;
  assert.equal(f.draft().text, "原草稿\n识别文字"); assert.equal(f.controller.snapshot().busy, false);
  assert.equal(f.releases(), 1);
});

test("a player edit, even an edit back to the same text, prevents automatic insertion", async () => {
  const f = fixture(); await f.controller.start(); f.edit("原草稿");
  const stopped = f.controller.stop(); await flush(); f.reply.resolve({ ok: true, result: { text: "新文字" } }); await stopped;
  assert.equal(f.draft().text, "原草稿"); assert.equal(f.controller.snapshot().pending.reason, "changed");
  f.edit("玩家新草稿"); assert.equal(f.controller.insertPending(), true);
  assert.equal(f.draft().text, "玩家新草稿\n新文字");
});

test("120 second monotonic deadline stops recording without a second click", async () => {
  const f = fixture(); await f.controller.start(); f.advance(120000); await flush();
  assert.equal(f.controller.snapshot().phase, "transcribing"); assert.equal(f.requests.length, 1);
  f.controller.cancel(); f.reply.resolve({ ok: true, result: { text: "迟到文字" } }); await flush();
  assert.equal(f.draft().text, "原草稿"); assert.equal(f.controller.snapshot().phase, "idle");
});

test("cancellation and a changed adventure invalidate late recognition", async () => {
  for (const change of [f => f.controller.cancel(), f => f.changeContext({ adventureId: "b", sessionId: "t", ready: true })]) {
    const f = fixture(); await f.controller.start(); const stopped = f.controller.stop(); await flush();
    change(f); f.reply.resolve({ ok: true, result: { text: "旧冒险的文字" } }); await stopped;
    assert.equal(f.draft().text, "原草稿"); assert.equal(f.controller.snapshot().pending, null);
    assert.equal(f.remoteCancels.length, 1);
  }
});

test("permission resolving after cancellation closes the recorder and never transcribes", async () => {
  const capture = deferred(); let cancelled = 0;
  const f = fixture({ hooks: { createRecorder: () => capture.promise } });
  const start = f.controller.start(); await flush(); f.controller.cancel();
  capture.resolve({ cancel: () => { cancelled++; } }); await start;
  assert.equal(cancelled, 1); assert.equal(f.requests.length, 0); assert.equal(f.releases(), 1);
});

test("a short press never asks for microphone permission", () => {
  const f = holdFixture(); f.down({ button: 0, pointerId: 3, isPrimary: true }); f.up({ pointerId: 3 }); f.runDelay();
  assert.equal(f.started(), 0); assert.equal(f.stopped(), 0); assert.equal(f.cancelled(), 0);
});

test("selection, double clicks, and text-selection drags never become a recording", () => {
  const f = holdFixture({ options: { cancelDistancePx: 6, canPress: event => event.detail <= 1 && !event.selected } });
  f.down({ button: 0, pointerId: 31, isPrimary: true, detail: 1, selected: true });
  f.down({ button: 0, pointerId: 32, isPrimary: true, detail: 2 });
  f.down({ button: 0, pointerId: 33, isPrimary: true, detail: 1, clientX: 10, clientY: 10 });
  f.move({ pointerId: 33, clientX: 17, clientY: 10 }); f.runDelay();
  assert.equal(f.started(), 0); assert.equal(f.cancelled(), 0);
});

test("releasing while microphone permission is pending cancels instead of recording late", async () => {
  const permission = deferred(); let started = 0;
  const f = holdFixture({ start: () => { started++; return permission.promise; } });
  f.down({ button: 0, pointerId: 4, isPrimary: true }); f.runDelay(); await flush();
  assert.equal(started, 1); assert.equal(f.gesture.snapshot().phase, "permission-pending");
  f.up({ pointerId: 4 }); permission.resolve(); await flush();
  assert.equal(f.cancelled(), 1); assert.equal(f.stopped(), 0); assert.equal(f.gesture.snapshot().phase, "idle");
});

test("a held pointer stops only after capture has started, while interruption cancels it", async () => {
  const f = holdFixture(); f.down({ button: 0, pointerId: 5, isPrimary: true }); f.runDelay(); await flush();
  assert.equal(f.gesture.snapshot().phase, "recording"); f.up({ pointerId: 5 }); f.cancelPointer({ pointerId: 5 }); await flush();
  assert.equal(f.stopped(), 1); assert.equal(f.cancelled(), 0);
  f.down({ button: 0, pointerId: 6, isPrimary: true }); f.runDelay(); await flush(); f.hide();
  assert.equal(f.cancelled(), 1); assert.equal(f.stopped(), 1); assert.equal(f.gesture.snapshot().phase, "idle");
  f.down({ button: 0, pointerId: 7, isPrimary: true }); f.runDelay(); await flush(); f.cancelPointer({ pointerId: 7 });
  f.down({ button: 0, pointerId: 8, isPrimary: true }); f.runDelay(); await flush(); f.blur();
  assert.equal(f.cancelled(), 3); assert.equal(f.stopped(), 1);
});

test("a late start from an old gesture cannot cancel a newer hold", async () => {
  const first = deferred(), second = deferred(); let starts = 0;
  const f = holdFixture({ start: () => ++starts === 1 ? first.promise : second.promise });
  f.down({ button: 0, pointerId: 41, isPrimary: true }); f.runDelay(); await flush(); f.up({ pointerId: 41 });
  f.down({ button: 0, pointerId: 42, isPrimary: true }); f.runDelay(); await flush();
  first.resolve(); await flush();
  assert.equal(f.cancelled(), 1); assert.equal(f.gesture.snapshot().phase, "permission-pending");
  second.resolve(); await flush();
  assert.equal(f.gesture.snapshot().phase, "recording");
});

test("disposing a hold gesture removes its input, focus, and visibility listeners", () => {
  const f = holdFixture(); assert.equal(f.listenerCount(), 8); f.gesture.dispose(); assert.equal(f.listenerCount(), 0);
});

test("test recordings use explicit null bindings and keep text out of the game", async () => {
  const f = fixture(); await f.controller.start({ test: true }); const stopped = f.controller.stop(); await flush();
  assert.equal(f.requests[0].test, true); assert.equal(f.requests[0].adventureId, null); assert.equal(f.requests[0].sessionId, null);
  f.reply.resolve({ ok: true, result: { text: "试录文字" } }); await stopped;
  assert.equal(f.draft().text, "原草稿"); assert.equal(f.controller.snapshot().pending.test, true);
  assert.equal(f.controller.insertPending(), false);
});

test("permission preparation times out and a late microphone is still released", async () => {
  const capture = deferred(); let cancelled = 0;
  const f = fixture({ hooks: { createRecorder: () => capture.promise } });
  const start = f.controller.start(); await flush(); f.advance(30000);
  assert.equal(f.controller.snapshot().errorCode, "SPEECH_PERMISSION_TIMEOUT");
  assert.equal(f.controller.snapshot().busy, false);
  capture.resolve({ cancel: () => { cancelled++; } }); await start;
  assert.equal(cancelled, 1); assert.equal(f.requests.length, 0); assert.equal(f.draft().text, "原草稿");
});

test("oversize results remain complete and cannot bypass the 4000 character draft limit", async () => {
  const f = fixture(); await f.controller.start(); const stopped = f.controller.stop(); await flush();
  const text = "长".repeat(4100); f.reply.resolve({ ok: true, result: { text } }); await stopped;
  assert.equal(f.controller.snapshot().pending.text.length, 4100); assert.equal(f.controller.insertPending(), false);
  assert.equal(f.draft().text, "原草稿"); assert.equal(f.controller.insertPending("编辑后的文字"), true);
});

test("backend failures preserve the draft and release audio focus", async () => {
  const f = fixture(); await f.controller.start(); const stopped = f.controller.stop(); await flush();
  f.reply.resolve({ ok: false, error: { code: "SPEECH_TIMEOUT" } }); await stopped;
  assert.equal(f.controller.snapshot().errorCode, "SPEECH_TIMEOUT"); assert.equal(f.draft().text, "原草稿");
  assert.equal(f.releases(), 1); assert.equal(f.controller.snapshot().busy, false);
});

test("WAV output has PCM16 mono 16 kHz metadata and exact untruncated samples", () => {
  const wav = encodeWav([new Int16Array([-32768, 0, 32767])], 3), view = new DataView(wav);
  assert.equal(wav.byteLength, 50); assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(48, true), 32767);
});

test("worklet itself hard-stops at 120 seconds without any renderer timer", () => {
  const source = fs.readFileSync(require.resolve("./speech-input-worklet.js"), "utf8");
  let Capture, total = 0, stopped = 0;
  const sandbox = { sampleRate: 16000, Int16Array,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => {
      if (value.type === "samples") total += value.samples.length;
      else if (value.type === "stopped") { stopped++; assert.equal(value.limit, true); }
    } }; } }, registerProcessor: (_name, Class) => { Capture = Class; } };
  vm.runInNewContext(source, sandbox);
  const capture = new Capture(), block = new Float32Array(128).fill(.2);
  for (let i = 0; i < 15010; i++) capture.process([[block]]);
  assert.equal(total, 16000 * 120); assert.equal(stopped, 1); assert.equal(capture.done, true);
});

test("late TTS segment during the gap between audio elements cannot play into capture", async () => {
  const app = fs.readFileSync(require.resolve("./app.js"), "utf8");
  const functions = app.slice(app.indexOf("function acquireSpeechAudioFocus()"), app.indexOf("async function boot()"))
    + app.slice(app.indexOf("function playTtsAudio(dataUrl)"), app.indexOf("function stopCurrentTtsAudio()"));
  let audioCreated = 0, cancels = 0;
  const state = { currentAudio: null, ttsPlaybackPhase: "playing", ttsRequestId: 8, ttsEnabled: true, gameVolume: 80 };
  const sandbox = { state, speechAudioFocus: false, speechAudioFocusRevision: 0, speechAudioUserRevision: 0, Promise,
    Audio: class { constructor() { audioCreated++; } }, renderTtsPlaybackStatus() {},
    setTtsPlaybackPhase(phase) { state.ttsPlaybackPhase = phase; },
    cancelTtsPlayback() { cancels++; state.ttsRequestId++; state.ttsPlaybackPhase = "idle"; },
    stopCurrentTtsAudio() {}, t: key => key };
  vm.createContext(sandbox); vm.runInContext(functions, sandbox);
  const release = sandbox.acquireSpeechAudioFocus();
  assert.equal(cancels, 1); assert.equal(state.ttsRequestId, 9);
  // The previous segment has ended, but its next-segment promise resolves now.
  await Promise.resolve().then(() => sandbox.playTtsAudio("data:audio/wav;base64,late"));
  assert.equal(audioCreated, 0); assert.equal(cancels, 2); release();
  assert.equal(sandbox.speechAudioFocus, false);
});

test("mounting disabled speech input does not touch the browser media device service", () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const listenerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "addEventListener");
  let deviceAccess = 0;
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
      platform: "MacIntel", get mediaDevices() { deviceAccess++; throw Error("Device service must stay idle"); },
    } });
    globalThis.addEventListener = () => {};
    const nodes = new Map();
    const document = { addEventListener() {}, getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { addEventListener() {} });
      return nodes.get(id);
    } };
    mount({ document, api: {}, t: key => key, getContext: () => ({ ready: false }),
      getSettings: () => ({ enabled: false }), getDraft: () => ({ text: "", version: 0 }) });
    assert.equal(deviceAccess, 0);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor); else delete globalThis.navigator;
    if (listenerDescriptor) Object.defineProperty(globalThis, "addEventListener", listenerDescriptor); else delete globalThis.addEventListener;
  }
});
