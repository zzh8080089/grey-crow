#!/usr/bin/env node
"use strict";

// Real Renderer + preload + speech desktop adapter/service + native recognizer.
// All game/provider IPC is an explicitly synthetic, isolated fixture. Chromium
// reads the official prerecorded zh.wav; this is not a human microphone test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const desktopRoot = path.resolve(__dirname, "..");
const TRIAL_ONLY = process.argv.includes("--suite=trial");
const BUNDLED_TRIAL = process.argv.includes("--bundled");
const MODEL_ROOT = process.env.GREY_CROW_SPEECH_TEST_MODEL;
const AUDIO_FILE = process.env.GREY_CROW_SPEECH_TEST_AUDIO;
if (BUNDLED_TRIAL && !TRIAL_ONLY) {
  process.stderr.write("--bundled 仅支持与 --suite=trial 一起使用，避免改变既有个人下载模型的完整检查。\n");
  process.exit(2);
}
if (!MODEL_ROOT || !AUDIO_FILE || !path.isAbsolute(MODEL_ROOT) || !path.isAbsolute(AUDIO_FILE)) {
  process.stderr.write("请显式设置 GREY_CROW_SPEECH_TEST_MODEL（已校验模型目录绝对路径）和 GREY_CROW_SPEECH_TEST_AUDIO（预录 PCM WAV 绝对路径）。测试不会自动下载模型或读取玩家数据。\n");
  process.exit(2);
}
const OUTPUT_ROOT = process.env.GREY_CROW_SPEECH_DESKTOP_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-speech-desktop-"));

if (!process.versions.electron) {
  const env = { ...process.env, GREY_CROW_SPEECH_DESKTOP_OUTPUT: OUTPUT_ROOT };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [__filename, ...process.argv.slice(2)], { env, stdio: "inherit" });
  child.once("exit", code => { process.exitCode = code ?? 1; });
} else {
  run().catch(error => { process.stderr.write(`${error.stack || error}\n`); require("electron").app.exit(1); });
}

async function run() {
  const { app, BrowserWindow, ipcMain } = require("electron");
  const { pathToFileURL } = require("node:url");
  const { createSettingsStore, getSettingsCatalog, mergeDesktopSettings } = require("../settings-store");
  const { registerSpeechInput, installSpeechInputPermissions } = require("../speech-input/desktop");
  const { createSpeechInputService } = require("../speech-input/service");
  const { MODEL_FILES } = require("../speech-input/resources");
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const userData = fs.mkdtempSync(path.join(OUTPUT_ROOT, "isolated-user-data-"));
  app.setPath("userData", userData);
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  // Chromium's sandboxed audio service cannot read a prerecorded file on this
  // Mac. Disable only that service sandbox for this isolated fixture; Renderer
  // sandbox/contextIsolation and production permission handlers stay enabled.
  app.commandLine.appendSwitch("disable-features", "AudioServiceSandbox");
  app.commandLine.appendSwitch("use-file-for-fake-audio-capture", AUDIO_FILE);
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  const personalModelRoot = path.join(userData, "speech-input", "model");
  for (const file of MODEL_FILES) {
    const source = path.join(MODEL_ROOT, file.name);
    assert.equal(fs.statSync(source).size, file.bytes, file.name);
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(source)) hash.update(chunk);
    assert.equal(hash.digest("hex"), file.sha256, `${file.name} source SHA256`);
  }
  if (BUNDLED_TRIAL) {
    assert.throws(() => fs.statSync(personalModelRoot), { code: "ENOENT" }, "bundled trial must not create a personal model");
  } else {
    fs.mkdirSync(personalModelRoot, { recursive: true });
    for (const file of MODEL_FILES) fs.copyFileSync(path.join(MODEL_ROOT, file.name), path.join(personalModelRoot, file.name), fs.constants.COPYFILE_FICLONE);
  }
  const runtimeRoot = path.join(desktopRoot, "speech-input", ".runtime", `${process.platform}-${process.arch}`);
  const nativeExecutable = path.join(runtimeRoot, "bin", process.platform === "win32" ? "speech-input-cli.exe" : "speech-input-cli");
  const fileHash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const store = createSettingsStore({ dataRoot: userData });
  let settings = store.load(), game = false, win, speech, service, permissionFault = false;
  let gameSubmissions = 0;
  const transcriptCalls = [], rendererErrors = [], checks = [], memorySamples = [];
  function memorySample(phase) {
    const electron = app.getAppMetrics().map(value => ({ pid: value.pid, type: value.type, workingSetSizeKiB: value.memory.workingSetSize }));
    let native = [];
    try {
      if (process.platform !== 'darwin') throw new Error('Native RSS sampling is macOS-only');
      native = execFileSync('/bin/ps', ['-axo','pid=,ppid=,rss=,comm='], { encoding:'utf8' }).trim().split('\n')
        .map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean)
        .filter(row => Number(row[2]) === process.pid && row[4].endsWith('speech-input-cli'))
        .map(row => ({ pid:Number(row[1]),rssKiB:Number(row[3]) }));
    } catch {}
    memorySamples.push({ phase, timestamp:Date.now(), electron, native,
      electronWorkingSetSumKiB:electron.reduce((sum,value)=>sum+value.workingSetSizeKiB,0),
      nativeRssSumKiB:native.reduce((sum,value)=>sum+value.rssKiB,0) });
  }
  const report = { kind: "real-electron-prerecorded-speech", outputRoot: OUTPUT_ROOT, suite: TRIAL_ONLY ? "trial" : "full",
    modelMode: BUNDLED_TRIAL ? "bundled" : "personal-copy",
    nativeHashBefore: fileHash(nativeExecutable), nativeManifestHashBefore: fileHash(path.join(runtimeRoot, "runtime-manifest.json")),
    platform: process.platform, arch: process.arch, electron: process.versions.electron,
    audioSource: AUDIO_FILE, audioSha256: crypto.createHash("sha256").update(fs.readFileSync(AUDIO_FILE)).digest("hex"),
    modelFixtureRoot: MODEL_ROOT, microphone: "Chromium prerecorded file; no human microphone acceptance",
    testOnlyAudioServiceSandboxDisabled: true, rendererSandbox: true,
    nativeRssSamplingAvailable: process.platform === "darwin",
    game: "synthetic fixture; no story provider or player data", checks, transcriptCalls, rendererErrors, memorySamples,
    memoryScope: "Electron app.getAppMetrics working-set sum plus macOS-only ps child RSS; shared pages can be counted more than once, not unique physical memory. 100 ms sampling can miss true peaks.",
    ttsCombinedMemory: "unavailable: no installed macOS TTS runtime; no synthetic TTS substituted" };
  const fixtureSave = { id: "speech-fixture", title: "语音输入测试", adventureLocale: "zh-CN", revision: 0, turn: 1,
    compatibility: { status: "ready", playerContinuable: true }, state_hint: { time: { day: 10, turn: 1 }, scene: { location: "楼道" } } };
  const status = () => ({ keyVerified: true, gameStarted: game, activeSaveId: game ? fixtureSave.id : null,
    activeSave: game ? fixtureSave : null, runtimeProtocol: "session-1", runtimeSessionId: "speech-fixture-session",
    locale: { preferredLocale: settings.localization.preferredLocale, effectiveLocale: settings.localization.preferredLocale,
      adventureLocale: game ? "zh-CN" : null, localeRevision: "locale_000001", selectionRequired: false },
    settings, dataRootReady: true, credential: { hasVerifiedCredential: true, secureStorageAvailable: false, platform: "isolated-fixture" } });
  const mock = (name, fn) => ipcMain.handle(`grey-crow:${name}`, fn);
  mock("get-status", status);
  mock("get-settings", () => ({ ok: true, settings, catalog: getSettingsCatalog(), status: status() }));
  mock("update-settings", async (_event, payload) => {
    const previous = settings; settings = store.save(mergeDesktopSettings(settings, payload.settings));
    await speech.settingsChanged(previous, settings);
    return { ok: true, settings, catalog: getSettingsCatalog(), status: status() };
  });
  mock("list-save-slots", () => ({ ok: true, saves: [], status: status() }));
  mock("get-tts-cache-status", () => ({ ok: true, result: { utteranceCount: 0, bytes: 0, utteranceLimit: 20, byteLimit: 524288000 } }));
  mock("cancel-tts-utterance", () => ({ ok: true }));
  mock("list-skill-panels", () => ({ ok: true, panels: [], supported: true }));
  mock("list-skill-modules", () => ({ ok: true, modules: [] }));
  mock("get-character-panel-entry", () => ({ ok: true, supported: false, entry: null }));
  mock("get-chapter-logs", () => ({ ok: true, chapters: [] }));
  mock("run-turn", () => { gameSubmissions++; return { ok: false, status: status(), error: { code: "FIXTURE_NO_PROVIDER" } }; });
  mock("quit-app", () => ({ ok: true }));
  mock("leave-adventure", async () => { game = false; await speech.cancel(); return { ok: true, status: status() }; });
  speech = registerSpeechInput({ ipcMain,
    assertTrustedSender(event) { assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, win.webContents.mainFrame); },
    getSettings: () => settings,
    getContext: () => ({ adventureId: game ? fixtureSave.id : null, sessionId: "speech-fixture-session", ready: game }),
    getDataRoot: () => userData, runtimeRoot, bundledModelRoot: BUNDLED_TRIAL ? MODEL_ROOT : null,
    fetchImpl: () => { throw new Error("Network is disabled in this test"); },
    createService(options) {
      service = createSpeechInputService(options);
      const transcribe = service.transcribe;
      service.transcribe = async payload => {
        const record = { requestId: payload.requestId, test: payload.test, bytes: payload.audio.byteLength,
          adventureId: payload.adventureId, sessionId: payload.sessionId };
        const audioView = new DataView(payload.audio);
        let peak = 0; for (let i = 44; i + 1 < payload.audio.byteLength; i += 2) peak = Math.max(peak,Math.abs(audioView.getInt16(i,true)));
        record.pcmPeak = peak;
        transcriptCalls.push(record);
        memorySample('transcribe-before');
        const sampling = setInterval(() => memorySample('transcribe-active'),100);
        try { const result = await transcribe(payload); record.result = result; return result; }
        catch (error) { record.error = error.code || error.message; throw error; }
        finally { clearInterval(sampling); memorySample('transcribe-after'); }
      };
      return service;
    },
  });
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const evaluate = expression => win.webContents.executeJavaScript(expression, true);
  async function wait(label, expression, timeout = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await delay(60); }
    const state = await evaluate("({speech:speechInputController?.snapshot(),settingsStatus:document.querySelector('#settingsStatus').textContent})");
    throw new Error(`${label}: timeout ${JSON.stringify(state)}`);
  }
  async function click(id) {
    const point = await evaluate(`(()=>{const node=document.getElementById(${JSON.stringify(id)});node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),disabled:node.disabled};})()`);
    assert.equal(point.disabled, false, `${id} enabled`);
    win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
    win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: point.x, y: point.y });
    win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: point.x, y: point.y });
    await delay(90);
  }
  async function check(name, operation) { await operation(); checks.push({ name, ok: true }); process.stdout.write(`PASS ${name}\n`); }
  async function screenshot(name) {
    await evaluate("document.fonts.ready"); await delay(150);
    const destination = path.join(OUTPUT_ROOT, `${name}.png`); fs.writeFileSync(destination, (await win.webContents.capturePage()).toPNG());
    return destination;
  }
  try {
    await app.whenReady();
    win = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: true,
      webPreferences: { preload: path.join(desktopRoot, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    const trustedUrl = pathToFileURL(path.join(desktopRoot, "renderer", "index.html")).href;
    installSpeechInputPermissions({ webContents: win.webContents, trustedUrl, getSettings: () => permissionFault ? { audio: { input: { enabled: false } } } : settings });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 2) rendererErrors.push(message); });
    win.webContents.on("preload-error", (_event, _file, error) => rendererErrors.push(error.message));
    await win.loadURL(trustedUrl); win.focus();
    await wait("boot", "Boolean(speechInputController && state.persistedSettingsSnapshot)");
    await evaluate("finishMenuIntro()"); await delay(500);
    await evaluate(`(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__speechStreams=[];navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__speechStreams.push(stream);return stream;};})()`);
    await check(BUNDLED_TRIAL ? "default off and verified bundled resource" : "default off and verified installed resource", async () => {
      assert.equal(settings.audio.input.enabled, false);
      const resource = await evaluate("window.greyCrow.getSpeechInputStatus()");
      assert.equal(resource.status.modelInstalled, true); assert.equal(resource.status.runtimeAvailable, true);
      await click("settingsButton"); await wait("settings dialog", "document.querySelector('#settingsDialog').open"); await evaluate("switchSettingsTab('audio')");
      if (BUNDLED_TRIAL) {
        assert.equal(resource.status.modelSource, "bundled"); assert.equal(resource.status.downloadBytes, 0);
        assert.throws(() => fs.statSync(personalModelRoot), { code: "ENOENT" }, "bundled resource must not create a personal model");
        await wait("bundled resource label", "document.querySelector('#speechInputResourceStatus').textContent.includes('随包')");
        assert.deepEqual(await evaluate("({install:document.querySelector('#speechInputInstallButton').hidden,remove:document.querySelector('#speechInputRemoveButton').hidden})"), { install: true, remove: true });
      } else {
        await wait("resource label", "document.querySelector('#speechInputResourceStatus').textContent.includes('已下载')");
      }
    });
    await check("enable and persist through real settings controls", async () => {
      await evaluate("document.querySelector('#speechInputEnabledSelect').value='true';document.querySelector('#speechInputEnabledSelect').dispatchEvent(new Event('change',{bubbles:true}))");
      await wait("settings auto-saved", "state.settingsDirty===false && state.speechInput.enabled===true");
      assert.equal(settings.audio.input.enabled, true);
    });
    await check("actual capture worklet PCM IPC native setting test", async () => {
      await click("speechInputTestButton"); await wait("recording", "speechInputController.snapshot().phase==='recording'");
      await delay(5900); await click("speechInputTestButton");
      await wait("native text", "Boolean(speechInputController.snapshot().pending?.test)", 40000);
      const text = await evaluate("document.querySelector('#speechInputTestText').value");
      assert.match(text, /开放|開放|时间|時間/); report.firstTranscript = text;
      assert.equal(await evaluate("document.querySelector('#turnInput').value"), "");
      assert.equal(await evaluate("window.__speechStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))"), true);
      report.settingsScreenshot = await screenshot("settings-recorded-1280x800");
    });
    if (!TRIAL_ONLY) {
    await check("test again and Esc cancellation releases microphone", async () => {
      await click("speechInputTestButton"); await wait("record again", "speechInputController.snapshot().phase==='recording'");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" }); win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await wait("cancelled", "!speechInputController.snapshot().busy");
      assert.equal(await evaluate("window.__speechStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))"), true);
    });
    await check("permission denial is localized and retryable", async () => {
      permissionFault = true; await click("speechInputTestButton"); await wait("permission failure", "speechInputController.snapshot().phase==='error'");
      assert.equal(await evaluate("speechInputController.snapshot().errorCode"), "NotAllowedError");
      assert.match(await evaluate("document.querySelector('#speechInputTestStatus').textContent"), /权限/);
      permissionFault = false;
    });
    await check("settings close does not leave test state blocking game input", async () => {
      await click("closeSettingsButton");
      game = true;
      settings = store.save(mergeDesktopSettings(settings, { ui: { gameUiLayout: "story-notebook-v1" } }));
      await evaluate(`applyStatus(${JSON.stringify(status())});showGame(${JSON.stringify(fixtureSave)},[{kind:'host',text:'这是隔离的语音输入测试，不属于正式故事。'}]);setGameUiLayout('story-notebook-v1');renderShellState();ui.turnInput.value='保留的草稿';ui.turnInput.dispatchEvent(new Event('input',{bubbles:true}));`);
      await wait("game input ready", "!document.querySelector('#speechInputButton').disabled");
    });
    await check("real shortcut starts; recording blocks sends; changed draft waits for insertion", async () => {
      win.focus(); await click("turnInput");
      const modifiers = process.platform === "darwin" ? ["meta", "shift"] : ["control", "shift"];
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space", modifiers });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space", modifiers });
      await wait("shortcut capture", "speechInputController.snapshot().phase==='recording'");
      assert.equal(await evaluate("document.querySelector('#sendTurnButton').disabled"), true);
      await evaluate("ui.turnInput.value='玩家修改后的草稿';ui.turnInput.dispatchEvent(new Event('input',{bubbles:true}));ui.turnForm.requestSubmit()");
      assert.equal(gameSubmissions, 0); await delay(5900); await click("speechInputButton");
      await wait("pending changed draft", "speechInputController.snapshot().pending?.reason==='changed'", 40000);
      assert.equal(await evaluate("ui.turnInput.value"), "玩家修改后的草稿");
      await click("speechInputResultButton"); await click("speechInputInsertButton");
      assert.match(await evaluate("ui.turnInput.value"), /^玩家修改后的草稿\n.+/); assert.equal(gameSubmissions, 0);
    });
    await check("button cancellation and desktop IPC reject malformed audio", async () => {
      await click("speechInputButton"); await wait("button capture", "speechInputController.snapshot().phase==='recording'");
      await click("speechInputCancel"); assert.equal(await evaluate("speechInputController.snapshot().busy"), false);
      const rejected = await evaluate("window.greyCrow.transcribeSpeechInput({requestId:'invalid-audio',audio:new ArrayBuffer(3),test:true,adventureId:null,sessionId:null})");
      assert.equal(rejected.error.code, "SPEECH_AUDIO_INVALID");
    });
    await check("Chinese English Japanese game input at standard and narrow sizes", async () => {
      report.layouts = [];
      for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
        settings = store.save(mergeDesktopSettings(settings, { localization: { preferredLocale: locale } }));
        await evaluate(`applySettings(${JSON.stringify(settings)});applyStatus(${JSON.stringify(status())});syncUiLocale();renderShellState()`);
        for (const [width, height] of [[1280, 800], [900, 700]]) {
          win.setContentSize(width, height); await delay(250);
          const geometry = await evaluate(`(()=>{const ids=['speechInputButton','turnInput','sendTurnButton'];return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,nodes:ids.map(id=>{const n=document.getElementById(id),r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id,text:n.textContent,width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,hit:n===hit||n.contains(hit)}})}})()`);
          assert.equal(geometry.overflow, false);
          for (const node of geometry.nodes) { assert.ok(node.width>0&&node.height>0); assert.ok(node.x>=-1&&node.y>=-1&&node.right<=geometry.width+1&&node.bottom<=geometry.height+1, JSON.stringify(node)); assert.equal(node.hit,true,JSON.stringify(node)); }
          geometry.locale = locale; geometry.layout = "story-notebook-v1"; geometry.screenshot = await screenshot(`game-${locale}-${width}x${height}`); report.layouts.push(geometry);
        }
      }
    });
    await check("disable leaves text usable and launches no recognizer", async () => {
      const count = transcriptCalls.length;
      settings = store.save(mergeDesktopSettings(settings, { audio: { input: { enabled: false } } }));
      await speech.settingsChanged({ audio: { input: { enabled: true } } }, settings);
      await evaluate(`applySettings(${JSON.stringify(settings)});renderShellState()`); await click("speechInputButton");
      assert.equal(await evaluate("document.querySelector('#settingsDialog').open"), true); assert.equal(transcriptCalls.length, count);
      assert.equal(await evaluate("window.__speechStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))"), true);
    });
    }
    memorySample("finished-idle");
    report.ok = true;
  } catch (error) {
    report.ok = false; report.failure = error.stack || String(error);
    if (win && !win.isDestroyed()) { report.failureScreenshot = await screenshot("failure"); report.uiFailure = await evaluate("({speech:speechInputController?.snapshot(),settings:state.speechInput,dirty:state.settingsDirty,keyVerified:state.keyVerified,gameStarted:state.gameStarted,busy:state.busy,activeSaveId:state.activeSaveId})").catch(() => null); }
  } finally {
    await speech.dispose();
    report.nativeHashAfter = fileHash(nativeExecutable);
    report.nativeManifestHashAfter = fileHash(path.join(runtimeRoot, "runtime-manifest.json"));
    report.nativeUnchanged = report.nativeHashBefore === report.nativeHashAfter && report.nativeManifestHashBefore === report.nativeManifestHashAfter;
    if (!report.nativeUnchanged) { report.ok = false; report.failure = "Native runtime changed during the test"; }
    report.gameSubmissions = gameSubmissions;
    report.orphanRecordingFiles = fs.existsSync(path.join(userData,"speech-input","recordings")) ? fs.readdirSync(path.join(userData,"speech-input","recordings")) : [];
    report.sourceSha256 = Object.fromEntries(["renderer/app.js","renderer/index.html","renderer/speech-input.js","renderer/speech-input-worklet.js","renderer/speech-input.css","preload.js","speech-input/desktop.js","speech-input/service.js"].map(file=>[file,crypto.createHash("sha256").update(fs.readFileSync(path.join(desktopRoot,file))).digest("hex")]));
    fs.writeFileSync(path.join(OUTPUT_ROOT, "result.json"), JSON.stringify(report,null,2));
    process.stdout.write(`RESULT ${path.join(OUTPUT_ROOT,"result.json")} ${report.ok?"PASS":"FAIL"}\n`);
    if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(userData, { recursive: true, force: true });
    app.exit(report.ok ? 0 : 1);
  }
}
