"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { createSpeechInputService, cleanupSpeechRecordings, decodeWav, runNative, failure } = require("./service");
const { createSpeechResources } = require("./resources");
const { registerSpeechInput, installSpeechInputPermissions, CHANNELS } = require("./desktop");
const { mergeDesktopSettings, normalizeDesktopSettings, settingsAffectProvider } = require("../settings-store");
const { createCustomConnection } = require("../model-connections");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function riff(chunks) {
  const body = Buffer.concat(chunks.map(([name, value]) => {
    const header = Buffer.alloc(8);
    header.write(name);
    header.writeUInt32LE(value.length, 4);
    return Buffer.concat([header, value, Buffer.alloc(value.length % 2)]);
  }));
  const header = Buffer.alloc(12);
  header.write("RIFF"); header.writeUInt32LE(body.length + 4, 4); header.write("WAVE", 8);
  return Buffer.concat([header, body]);
}

function pcmFormat() {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(16000, 4); fmt.writeUInt32LE(32000, 8);
  fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);
  return fmt;
}

function wav(seconds = 1) {
  return riff([["fmt ", pcmFormat()], ["data", Buffer.alloc(Math.round(seconds * 16000) * 2)]]);
}

async function temporary(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function serviceFixture(t, options = {}) {
  const root = await temporary(t, options.tempPrefix || "gc-speech-backend-");
  const runtimeRoot = path.join(root, "runtime");
  const executable = path.join(runtimeRoot, "bin", process.platform === "win32" ? "speech-input-cli.exe" : "speech-input-cli");
  if (options.runtime !== false) {
    await fs.mkdir(path.dirname(executable), { recursive: true });
    // This is only a stat-able fixture: the real process runner is never used.
    await fs.writeFile(executable, "not an executable; injected runner required");
  }
  let settings = { audio: { input: { enabled: options.enabled !== false, language: "zh", deviceId: "default" } } };
  let runnerCalls = 0;
  const resources = options.resources || {
    modelRoot: path.join(root, "model"), totalBytes: 12,
    verify: async () => options.installed !== false,
    install: async () => {}, remove: async () => {},
  };
  const service = createSpeechInputService({ root, runtimeRoot, resources,
    getSettings: () => settings, timeoutMs: options.timeoutMs,
    runner: async (request) => {
      runnerCalls += 1;
      if (options.runner) return options.runner(request);
      await fs.writeFile(request.output, JSON.stringify({ text: "识别结果" }));
    },
  });
  return { root, runtimeRoot, service, runnerCalls: () => runnerCalls,
    setEnabled: (enabled) => { settings = { audio: { input: { ...settings.audio.input, enabled } } }; } };
}

async function assertNoRecordings(root) {
  const entries = await fs.readdir(path.join(root, "recordings")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(entries, [], "no task directory or raw recording may remain after completion");
}

test("WAV accepts exact duration boundaries, extra RIFF chunks and sliced typed arrays", () => {
  for (const seconds of [0.2, 1, 120]) {
    const original = wav(seconds);
    const decoded = decodeWav(original);
    assert.equal(decoded.seconds, seconds);
    assert.deepEqual(decoded.wav, original);
  }
  const samples = Buffer.alloc(32000, 7);
  const withMetadata = riff([["JUNK", Buffer.from("odd")], ["fmt ", pcmFormat()], ["data", samples]]);
  const canonical = riff([["fmt ", pcmFormat()], ["data", samples]]);
  assert.deepEqual(decodeWav(withMetadata).wav, canonical);
  const padded = Buffer.concat([Buffer.alloc(13, 9), canonical, Buffer.alloc(5, 9)]);
  const view = new Uint8Array(padded.buffer, padded.byteOffset + 13, canonical.length);
  assert.deepEqual(decodeWav(view).wav, canonical, "bytes outside the transferred view are ignored");
  assert.deepEqual(decodeWav(Uint8Array.from(canonical).buffer).wav, canonical);
});

test("WAV rejects unsupported formats, malformed chunks, short input and recordings over 120 seconds", () => {
  const malformed = [];
  for (const [offset, value, width] of [[20, 3, 2], [22, 2, 2], [24, 48000, 4], [28, 1234, 4], [32, 4, 2], [34, 32, 2]]) {
    const audio = wav();
    if (width === 2) audio.writeUInt16LE(value, offset); else audio.writeUInt32LE(value, offset);
    malformed.push(audio);
  }
  const wrongLength = wav(); wrongLength.writeUInt32LE(44, 4); malformed.push(wrongLength);
  const overrun = wav(); overrun.writeUInt32LE(overrun.length, 40); malformed.push(overrun);
  malformed.push(riff([["fmt ", pcmFormat()], ["fmt ", pcmFormat()], ["data", Buffer.alloc(32000)]]));
  malformed.push(riff([["fmt ", pcmFormat()], ["data", Buffer.alloc(16000)], ["data", Buffer.alloc(16000)]]));
  malformed.push(riff([["fmt ", pcmFormat()], ["data", Buffer.alloc(6401)]]));
  malformed.push(riff([["data", Buffer.alloc(32000)]]));
  malformed.push(wav(0.199), Buffer.alloc(43), "not bytes", {}, null);
  for (const audio of malformed) assert.throws(() => decodeWav(audio), { code: "SPEECH_AUDIO_INVALID" });
  // 120.01 remains below the outer byte limit and must fail the decoded duration check.
  for (const seconds of [120.01, 121]) assert.throws(() => decodeWav(wav(seconds)), { code: "SPEECH_TOO_LONG" });
});

test("transcription accepts 120 seconds and rejects 121 before invoking any runner", async (t) => {
  const fixture = await serviceFixture(t, { runner: async (request) => {
    assert.equal(decodeWav(await fs.readFile(request.input)).seconds, 120);
    assert.equal(request.language, "zh");
    await fs.writeFile(request.output, JSON.stringify({ text: "<|zh|><|NEUTRAL|> 可编辑的识别文本 " }));
  } });
  const result = await fixture.service.transcribe({ requestId: "boundary120", audio: wav(120) });
  assert.equal(result.result.durationSeconds, 120);
  assert.equal(result.result.text, "可编辑的识别文本");
  await assert.rejects(fixture.service.transcribe({ requestId: "boundary121", audio: wav(121) }), { code: "SPEECH_TOO_LONG" });
  assert.equal(fixture.runnerCalls(), 1);
  await assertNoRecordings(fixture.root);
});

test("disabled input, missing runtime and missing model do not start recognition", async (t) => {
  for (const [options, code] of [
    [{ enabled: false }, "SPEECH_DISABLED"],
    [{ runtime: false }, "SPEECH_RUNTIME_MISSING"],
    [{ installed: false }, "SPEECH_MODEL_MISSING"],
  ]) {
    const fixture = await serviceFixture(t, options);
    await assert.rejects(fixture.service.transcribe({ requestId: "unavailable", audio: wav() }), { code });
    assert.equal(fixture.runnerCalls(), 0);
    assert.equal(fixture.service.busy(), false);
    await assertNoRecordings(fixture.root);
    if (options.enabled === false) {
      assert.deepEqual(await fixture.service.install(), { ok: true }, "model preparation is allowed before enabling the microphone");
      assert.deepEqual(await fixture.service.remove(), { ok: true }, "disabled input still permits resource removal");
      assert.equal(fixture.runnerCalls(), 0);
    }
  }
});

test("empty or tag-only runner output produces no-speech and still removes raw audio", async (t) => {
  for (const text of ["", " \n ", "<|zh|><|NEUTRAL|><|Speech|> "]) {
    const fixture = await serviceFixture(t, { runner: ({ output }) => fs.writeFile(output, JSON.stringify({ text })) });
    await assert.rejects(fixture.service.transcribe({ requestId: "silence", audio: wav() }), { code: "SPEECH_NO_SPEECH" });
    assert.equal(fixture.service.busy(), false);
    await assertNoRecordings(fixture.root);
  }
});

test("busy operations reject competing work; cancelled late runner output is suppressed and cleaned", async (t) => {
  const entered = deferred(), finish = deferred();
  let signal;
  const fixture = await serviceFixture(t, { runner: async (request) => {
    signal = request.signal;
    entered.resolve();
    await finish.promise; // Deliberately ignore abort until the fake process finally exits.
    await fs.writeFile(request.output, JSON.stringify({ text: "迟到结果不得返回" }));
  } });
  const pending = fixture.service.transcribe({ requestId: "active", audio: wav() });
  await entered.promise;
  const rejected = assert.rejects(pending, { code: "SPEECH_CANCELLED" });
  try {
    assert.equal(fixture.service.busy(), true);
    await assert.rejects(fixture.service.transcribe({ requestId: "second", audio: wav() }), { code: "SPEECH_BUSY" });
    await assert.rejects(fixture.service.install(), { code: "SPEECH_BUSY" });
    await assert.rejects(fixture.service.remove(), { code: "SPEECH_BUSY" });
    await fixture.service.cancel({ requestId: "unrelated" });
    assert.equal(signal.aborted, false, "cancellation is scoped to the active request ID");
    const cancellation = fixture.service.cancel({ requestId: "active" });
    assert.equal(signal.aborted, true);
    assert.equal(fixture.service.busy(), true, "work remains busy until its process has retired");
    finish.resolve();
    await Promise.all([rejected, cancellation]);
  } finally { finish.resolve(); await pending.catch(() => {}); }
  assert.equal(fixture.service.busy(), false);
  await assertNoRecordings(fixture.root);
});

test("cancellation during result reads or temporary cleanup cannot return a successful late result", async (t) => {
  for (const phase of ["result-read", "temporary-cleanup"]) {
    await t.test(phase, async (child) => {
      const entered = deferred(), release = deferred();
      const method = phase === "result-read" ? "readFile" : "rm";
      const original = fs[method];
      child.mock.method(fs, method, async (...args) => {
        const result = await original(...args);
        const name = path.basename(String(args[0]));
        if (phase === "result-read" ? name === "result.json" : name.startsWith("task-")) {
          entered.resolve();
          await release.promise;
        }
        return result;
      });
      const fixture = await serviceFixture(child);
      const requestId = `cancel-during-${phase}`;
      const pending = fixture.service.transcribe({ requestId, audio: wav() });
      await entered.promise;
      const rejected = assert.rejects(pending, { code: "SPEECH_CANCELLED" });
      const cancellation = fixture.service.cancel({ requestId });
      try { release.resolve(); await Promise.all([rejected, cancellation]); }
      finally { release.resolve(); await pending.catch(() => {}); }
      await assertNoRecordings(fixture.root);
    });
  }
});

async function nativeProcessFixture(t, mode, timeoutMs = 5000) {
  const fixture = await serviceFixture(t, { runner: runNative, timeoutMs, tempPrefix: "gc-speech native-'quoted-" });
  const program = path.join(fixture.root, "fake-native-process.js");
  const marker = path.join(fixture.root, "native-started.json");
  const terminated = path.join(fixture.root, "native-terminated.txt");
  const executable = path.join(fixture.runtimeRoot, "bin", "speech-input-cli");
  // This program never opens a model or any external resource. The wrapper only
  // adapts runNative's executable contract to the current Node binary on POSIX.
  await fs.writeFile(program, `"use strict";
const fs = require("node:fs");
const values = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (index % 2 === 0) pairs.push([value, args[index + 1]]);
  return pairs;
}, []));
const mode = ${JSON.stringify(mode)};
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(terminated)}, "SIGTERM");
  if (mode !== "ignore-termination") setTimeout(() => process.exit(0), 30);
});
fs.writeFileSync(${JSON.stringify(`${marker}.tmp`)}, JSON.stringify({ pid: process.pid, values,
  inputExists: fs.existsSync(values["--input"]) }));
fs.renameSync(${JSON.stringify(`${marker}.tmp`)}, ${JSON.stringify(marker)});
if (mode === "success") {
  fs.writeFileSync(values["--output"], JSON.stringify({ text: "local process fixture" }));
} else if (mode === "exit-error") {
  fs.writeFileSync(values["--output"], JSON.stringify({ text: "must never return after failed exit" }));
  process.stderr.write("private native diagnostic");
  process.exitCode = 7;
} else if (mode === "output-overflow") {
  process.stdout.write("x".repeat(70000));
  setInterval(() => {}, 1000);
} else {
  setInterval(() => {}, 1000);
}
`);
  const quote = (value) => `'${value.replace(/'/g, `'"'"'`)}'`;
  await fs.writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(program)} "$@"\n`, { mode: 0o700 });
  await fs.chmod(executable, 0o700);
  return { ...fixture, executable, marker, terminated,
    async started() {
      const expires = Date.now() + 4000;
      while (Date.now() < expires) {
        try { return JSON.parse(await fs.readFile(marker, "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await delay(10);
      }
      assert.fail("the temporary native process never reported readiness");
    },
  };
}

function assertProcessExited(pid) {
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "runNative must settle only after its child is gone");
}

test("native process execution forwards literal arguments and cleans recordings on success or process errors", {
  skip: process.platform === "win32" ? "POSIX executable fixture; Windows needs a native executable equivalent" : false,
}, async (t) => {
  for (const [mode, code] of [["success", null], ["exit-error", "SPEECH_FAILED"], ["output-overflow", "SPEECH_FAILED"]]) {
    await t.test(mode, async (child) => {
      const fixture = await nativeProcessFixture(child, mode);
      const pending = fixture.service.transcribe({ requestId: mode, audio: wav() });
      if (code) await assert.rejects(pending, { code });
      else assert.equal((await pending).result.text, "local process fixture");
      const started = await fixture.started();
      assert.equal(started.inputExists, true);
      assert.equal(started.values["--language"], "zh");
      assert.equal(started.values["--model"], path.join(fixture.root, "model", "model.int8.onnx"));
      assert.equal(started.values["--tokens"], path.join(fixture.root, "model", "tokens.txt"));
      assert.equal(path.dirname(started.values["--input"]), path.dirname(started.values["--output"]));
      assertProcessExited(started.pid);
      assert.equal(fixture.service.busy(), false);
      await assertNoRecordings(fixture.root);
    });
  }
});

test("native timeout and cancellation wait for termination, including SIGKILL escalation, before cleaning audio", {
  skip: process.platform === "win32" ? "POSIX signal lifecycle; not evidence for Windows process cancellation" : false,
}, async (t) => {
  for (const mode of ["timeout", "cancel", "ignore-termination"]) {
    await t.test(mode, async (child) => {
      const fixture = await nativeProcessFixture(child, mode, mode === "timeout" ? 3000 : 8000);
      const pending = fixture.service.transcribe({ requestId: mode, audio: wav() });
      const rejected = assert.rejects(pending, { code: mode === "timeout" ? "SPEECH_TIMEOUT" : "SPEECH_CANCELLED" });
      try {
        const started = await fixture.started();
        if (mode !== "timeout") {
          const cancellation = fixture.service.cancel({ requestId: mode });
          assert.equal(fixture.service.busy(), true);
          await Promise.all([rejected, cancellation]);
        } else await rejected;
        assert.equal(await fs.readFile(fixture.terminated, "utf8"), "SIGTERM");
        assertProcessExited(started.pid);
        assert.equal(fixture.service.busy(), false);
        await assertNoRecordings(fixture.root);
      } finally { await fixture.service.cancel(); await pending.catch(() => {}); }
    });
  }
});

test("native spawn errors and cancellation before spawn never start a process", async (t) => {
  const root = await temporary(t, "gc-speech-native-missing-");
  const request = { executable: path.join(root, "not-an-installed-runtime"), modelRoot: root,
    input: path.join(root, "unused.wav"), output: path.join(root, "unused.json"), language: "zh", timeoutMs: 1000 };
  await assert.rejects(runNative({ ...request, signal: new AbortController().signal }), { code: "SPEECH_RUNTIME_MISSING" });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runNative({ ...request, signal: controller.signal }), { code: "SPEECH_CANCELLED" });
  assert.deepEqual(await fs.readdir(root), []);
});

function resourceFiles() {
  return [
    ["model.int8.onnx", Buffer.from("fake model bytes")],
    ["tokens.txt", Buffer.from("token-a\ntoken-b\n")],
    ["LICENSE", Buffer.from("fixture license")],
  ].map(([name, content]) => ({ name, content, bytes: content.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"), url: `https://offline.test/${name}` }));
}

function response(bytes, body) {
  return { ok: true, headers: new Headers({ "content-length": String(bytes) }),
    body: body || (async function* () { yield Buffer.alloc(bytes); })() };
}

async function assertNoStaging(root) {
  const entries = await fs.readdir(root);
  assert.deepEqual(entries.filter((name) => /^\.(download|previous)-/.test(name)), []);
}

test("resources publish only verified complete files, expose progress, and remove the installed model", async (t) => {
  const root = await temporary(t, "gc-speech-resources-");
  const fixtures = resourceFiles(), progress = [], calls = [];
  const resources = createSpeechResources({ root, files: fixtures, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    const file = fixtures.find((candidate) => candidate.url === url);
    assert.ok(file, "all fetches must be handled by an injected fixture");
    assert.equal(await fs.stat(resources.modelRoot).then(() => true, () => false), false);
    return response(file.bytes, (async function* () { yield file.content.subarray(0, 2); yield file.content.subarray(2); })());
  } });
  assert.equal(await resources.verify(), false);
  await resources.install({ signal: new AbortController().signal, onProgress: (value) => progress.push(value) });
  assert.equal(await resources.verify({ force: true }), true);
  assert.equal(calls.length, fixtures.length);
  assert.deepEqual(progress.at(-1), { received: resources.totalBytes, total: resources.totalBytes });
  for (const file of fixtures) assert.deepEqual(await fs.readFile(path.join(resources.modelRoot, file.name)), file.content);
  await assertNoStaging(root);
  await resources.remove();
  assert.equal(await resources.verify(), false);
});

test("verified bundled models are used only after personal downloads and are never removed", async (t) => {
  const root = await temporary(t, "gc-speech-bundled-");
  const bundledModelRoot = path.join(root, "bundled"), fixtures = resourceFiles();
  await fs.mkdir(bundledModelRoot, { recursive: true });
  for (const file of fixtures) await fs.writeFile(path.join(bundledModelRoot, file.name), file.content);
  const resources = createSpeechResources({ root: path.join(root, "personal"), bundledModelRoot, files: fixtures,
    fetchImpl: () => { throw new Error("Verified bundled model must not need network"); } });
  assert.deepEqual(await resources.resolve({ force: true }), { modelRoot: bundledModelRoot, source: "bundled" });
  await resources.install();
  await assert.rejects(fs.stat(resources.modelRoot), { code: "ENOENT" });
  await resources.remove();
  assert.equal(await fs.readFile(path.join(bundledModelRoot, "model.int8.onnx"), "utf8"), "fake model bytes");
  // A verified personal model takes precedence when it is present.
  await fs.mkdir(resources.modelRoot, { recursive: true });
  for (const file of fixtures) await fs.writeFile(path.join(resources.modelRoot, file.name), file.content);
  assert.deepEqual(await resources.resolve({ force: true }), { modelRoot: resources.modelRoot, source: "download" });
});

test("bundled model status is offline-ready, recognition receives its verified root, and a missing runtime blocks downloads", async (t) => {
  const root = await temporary(t, "gc-speech-bundled-service-");
  const runtimeRoot = path.join(root, "runtime"), bundledModelRoot = path.join(root, "bundle");
  const executable = path.join(runtimeRoot, "bin", process.platform === "win32" ? "speech-input-cli.exe" : "speech-input-cli");
  await fs.mkdir(path.dirname(executable), { recursive: true }); await fs.writeFile(executable, "fixture");
  const resources = { modelRoot: path.join(root, "personal-model"), totalBytes: 12,
    resolve: async () => ({ modelRoot: bundledModelRoot, source: "bundled" }), verify: async () => false,
    install: async () => { throw Error("bundled model must not download"); }, remove: async () => {} };
  let usedRoot = null;
  const service = createSpeechInputService({ root, runtimeRoot, resources, getSettings: () => ({ audio: { input: { enabled: true, language: "zh" } } }),
    runner: async ({ modelRoot, output }) => { usedRoot = modelRoot; await fs.writeFile(output, JSON.stringify({ text: "离线结果" })); } });
  const status = await service.status();
  assert.equal(status.status.modelSource, "bundled"); assert.equal(status.status.bundledModel, true); assert.equal(status.status.downloadBytes, 0);
  await service.transcribe({ requestId: "bundled", audio: wav() }); assert.equal(usedRoot, bundledModelRoot);
  const missingRuntime = createSpeechInputService({ root: path.join(root, "missing-runtime"), runtimeRoot: path.join(root, "absent"), resources,
    getSettings: () => ({ audio: { input: { enabled: false } } }) });
  await assert.rejects(missingRuntime.install(), { code: "SPEECH_RUNTIME_MISSING" });
});

test("hash failure cannot publish a partial download or replace existing model files", async (t) => {
  const root = await temporary(t, "gc-speech-resources-hash-");
  const fixtures = resourceFiles();
  await fs.mkdir(path.join(root, "model"));
  const prior = Buffer.from("prior installation must survive failed replacement");
  await fs.writeFile(path.join(root, "model", "model.int8.onnx"), prior);
  const resources = createSpeechResources({ root, files: fixtures, fetchImpl: async (url) => {
    const file = fixtures.find((candidate) => candidate.url === url);
    return response(file.bytes); // Correct advertised/actual size, deliberately incorrect SHA256.
  } });
  await assert.rejects(resources.install({ signal: new AbortController().signal }), { code: "SPEECH_MODEL_INVALID" });
  assert.deepEqual(await fs.readFile(path.join(resources.modelRoot, "model.int8.onnx")), prior);
  assert.deepEqual(await fs.readdir(resources.modelRoot), ["model.int8.onnx"]);
  await assertNoStaging(root);
});

test("an interrupted model stream leaves neither an installation nor partial staging files", async (t) => {
  const root = await temporary(t, "gc-speech-resources-abort-");
  const fixtures = resourceFiles(), controller = new AbortController();
  const resources = createSpeechResources({ root, files: fixtures, fetchImpl: async (url) => {
    const file = fixtures.find((candidate) => candidate.url === url);
    return response(file.bytes, (async function* () {
      yield file.content.subarray(0, 2);
      controller.abort();
      yield file.content.subarray(2);
    })());
  } });
  await assert.rejects(resources.install({ signal: controller.signal }), { code: "SPEECH_CANCELLED" });
  assert.equal(await resources.verify(), false);
  assert.equal(await fs.stat(resources.modelRoot).then(() => true, () => false), false);
  await assertNoStaging(root);
});

function desktopFixture(createServiceOverride, options = {}) {
  const handlers = new Map(), calls = [];
  let settings = { audio: { input: { enabled: options.enabled !== false, language: "zh", deviceId: "default" } } };
  let context = { ready: true, adventureId: "adventure-a", sessionId: "session-a" };
  const trustedEvent = {};
  const service = {
    status: async () => ({ ok: true, status: {} }), install: async () => ({ ok: true }), remove: async () => ({ ok: true }),
    cancel: async (payload) => { calls.push(["cancel", payload]); return { ok: true }; },
    dispose: async () => { calls.push(["dispose"]); },
    transcribe: async (payload) => { calls.push(["transcribe", payload]); return { ok: true, result: { text: "fixture text" } }; },
  };
  const bridge = registerSpeechInput({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    assertTrustedSender: (event) => { assert.equal(event, trustedEvent, "untrusted IPC sender"); },
    getSettings: () => settings, getContext: () => context,
    getDataRoot: () => options.dataRoot || os.tmpdir(), runtimeRoot: os.tmpdir(),
    // Filesystem cleanup tests explicitly inject a private temporary root.
    cleanupRecordings: options.cleanupRecordings || (async () => {}),
    createService: (options) => { calls.push(["create"]); return createServiceOverride ? createServiceOverride(options, service) : service; },
  });
  return { bridge, service, calls, trustedEvent, handlers,
    invoke: (name, payload) => handlers.get(CHANNELS[name])(trustedEvent, payload),
    setContext: (next) => { context = next; }, getSettings: () => settings,
    setSettings: (next) => { settings = next; } };
}

test("disabled startup removes orphan recordings without loading a service and preserves unrelated files", async (t) => {
  const dataRoot = await temporary(t, "gc-speech-startup-");
  const root = path.join(dataRoot, "speech-input"), recordings = path.join(root, "recordings");
  const cleaned = deferred();
  await fs.mkdir(path.join(recordings, "task-orphan-123"), { recursive: true });
  await fs.writeFile(path.join(recordings, "task-orphan-123", "input.wav"), "synthetic old recording");
  await fs.mkdir(path.join(recordings, "unrelated"));
  await fs.writeFile(path.join(recordings, "unrelated", "keep.txt"), "keep");
  await fs.writeFile(path.join(recordings, "keep.wav"), "unrelated fixture");
  const fixture = desktopFixture(undefined, { enabled: false, dataRoot, cleanupRecordings: async (directory) => {
    await cleanupSpeechRecordings(directory); cleaned.resolve();
  } });
  await cleaned.promise;
  assert.deepEqual((await fs.readdir(recordings)).sort(), ["keep.wav", "unrelated"]);
  assert.equal(await fs.readFile(path.join(recordings, "unrelated", "keep.txt"), "utf8"), "keep");
  assert.equal(await fs.readFile(path.join(recordings, "keep.wav"), "utf8"), "unrelated fixture");
  assert.equal(fixture.getSettings().audio.input.enabled, false);
  assert.equal(fixture.calls.length, 0, "startup cleanup never creates a service or reads a model");
});

test("startup refuses a recordings-directory symlink and blocks recognition without touching its target", async (t) => {
  const dataRoot = await temporary(t, "gc-speech-startup-link-");
  const root = path.join(dataRoot, "speech-input"), target = path.join(dataRoot, "unrelated-target");
  await fs.mkdir(root);
  await fs.mkdir(path.join(target, "task-keep"), { recursive: true });
  await fs.writeFile(path.join(target, "task-keep", "keep.txt"), "must survive");
  await fs.symlink(target, path.join(root, "recordings"), "junction");
  const fixture = desktopFixture(undefined, { dataRoot, cleanupRecordings: cleanupSpeechRecordings });
  const result = await fixture.invoke("transcribe", { requestId: "blocked-startup", test: true, audio: wav() });
  assert.equal(result.error.code, "SPEECH_STORAGE_FAILED");
  assert.equal(fixture.calls.length, 0);
  assert.equal(await fs.readFile(path.join(target, "task-keep", "keep.txt"), "utf8"), "must survive");
});

test("requests wait for initial cleanup and cancellation prevents their service or resource operation from starting", async (t) => {
  for (const mode of ["wait", "cancel-request", "cancel-resources"]) {
    await t.test(mode, async () => {
      const entered = deferred(), release = deferred();
      const fixture = desktopFixture(undefined, { cleanupRecordings: async () => { entered.resolve(); await release.promise; } });
      const pending = mode === "cancel-resources"
        ? ["status", "install", "remove"].map(kind => fixture.invoke(kind))
        : [fixture.invoke("transcribe", { requestId: "initial", test: true, audio: wav() })];
      try {
        await entered.promise;
        await new Promise(setImmediate);
        assert.equal(fixture.calls.length, 0);
        if (mode !== "wait") await fixture.invoke("cancel", mode === "cancel-request" ? { requestId: "initial" } : {});
        release.resolve();
        const results = await Promise.all(pending);
        if (mode === "wait") {
          assert.equal(results[0].ok, true);
          assert.equal(fixture.calls.filter(([name]) => name === "transcribe").length, 1);
        } else {
          for (const result of results) assert.equal(result.error.code, "SPEECH_CANCELLED");
          assert.equal(fixture.calls.length, 0);
        }
      } finally { release.resolve(); await Promise.all(pending); }
    });
  }
});

test("concurrent startup retries share one cleanup and cannot remove a new recording after recognition begins", async (t) => {
  const dataRoot = await temporary(t, "gc-speech-startup-retry-");
  const recordings = path.join(dataRoot, "speech-input", "recordings");
  const newInput = path.join(recordings, "task-new", "input.wav");
  const entered = deferred(), release = deferred();
  let attempts = 0, activeCleanup = 0, maxCleanup = 0;
  const fixture = desktopFixture((_options, fake) => {
    assert.equal(activeCleanup, 0, "service creation must wait for every shared cleanup operation");
    return { ...fake, transcribe: async () => {
      await fs.mkdir(path.dirname(newInput), { recursive: true });
      await fs.writeFile(newInput, "synthetic current recording");
      return { ok: true, result: { text: "fixture result" } };
    } };
  }, { dataRoot, cleanupRecordings: async (root) => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("fixture startup read failure"), { code: "EACCES" });
    activeCleanup += 1; maxCleanup = Math.max(maxCleanup, activeCleanup); entered.resolve();
    try { await release.promise; await cleanupSpeechRecordings(root); }
    finally { activeCleanup -= 1; }
  } });
  await new Promise(setImmediate);
  const pending = [fixture.invoke("status"), fixture.invoke("transcribe", { requestId: "retry", test: true, audio: wav() })];
  try {
    await entered.promise;
    await new Promise(setImmediate);
    assert.equal(attempts, 2, "concurrent ready calls must not start separate retries");
    assert.equal(maxCleanup, 1);
    assert.equal(fixture.calls.length, 0);
    release.resolve();
    for (const result of await Promise.all(pending)) assert.equal(result.ok, true);
    assert.equal(activeCleanup, 0);
    assert.equal(await fs.readFile(newInput, "utf8"), "synthetic current recording");
  } finally { release.resolve(); await Promise.all(pending); }
});

test("normal requests require the current adventure/session; isolated test recordings cannot carry a story binding", async () => {
  const fixture = desktopFixture();
  const valid = { requestId: "normal", adventureId: "adventure-a", sessionId: "session-a", audio: wav() };
  for (const payload of [{ ...valid, adventureId: "other" }, { ...valid, sessionId: "other" }, { requestId: "unbound", audio: wav() }]) {
    assert.equal((await fixture.invoke("transcribe", payload)).error.code, "SPEECH_STALE");
  }
  assert.equal(fixture.calls.length, 0, "rejected bindings must not create a service");
  assert.equal((await fixture.invoke("transcribe", valid)).ok, true);
  fixture.setContext({ ready: false, adventureId: null, sessionId: null });
  assert.equal((await fixture.invoke("transcribe", valid)).error.code, "SPEECH_STALE");
  for (const binding of [{ adventureId: "adventure-a" }, { sessionId: "session-a" }]) {
    assert.equal((await fixture.invoke("transcribe", { requestId: "test", test: true, ...binding })).error.code, "SPEECH_AUDIO_INVALID");
  }
  assert.equal((await fixture.invoke("transcribe", { requestId: "test", test: true, audio: wav() })).ok, true);
  assert.deepEqual(fixture.calls.filter(([name]) => name === "transcribe").map(([, payload]) => Boolean(payload.test)), [false, true]);
});

test("untrusted IPC never reaches any speech service handler", async () => {
  const fixture = desktopFixture();
  for (const handler of fixture.handlers.values()) await assert.rejects(handler({}, {}), /untrusted IPC sender/);
  assert.equal(fixture.calls.length, 0);
});

test("a delayed cancellation for an old request cannot cancel a newer request; duplicate active IDs stay busy", async (t) => {
  const entered = deferred(), finish = deferred();
  let calls = 0, activeSignal;
  const real = await serviceFixture(t, { runner: async ({ output, signal }) => {
    calls += 1;
    if (calls === 2) { activeSignal = signal; entered.resolve(); await finish.promise; }
    await fs.writeFile(output, JSON.stringify({ text: `result ${calls}` }));
  } });
  const fixture = desktopFixture(() => real.service);
  const payload = { adventureId: "adventure-a", sessionId: "session-a", audio: wav() };
  assert.equal((await fixture.invoke("transcribe", { ...payload, requestId: "old" })).ok, true);
  const pending = fixture.invoke("transcribe", { ...payload, requestId: "new" });
  await entered.promise;
  try {
    assert.equal((await fixture.invoke("transcribe", { ...payload, requestId: "new" })).error.code, "SPEECH_BUSY");
    assert.equal((await fixture.invoke("cancel", { requestId: "old" })).ok, true);
    assert.equal(activeSignal.aborted, false);
    assert.equal(real.runnerCalls(), 2);
    finish.resolve();
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.result.text, "result 2");
  } finally { finish.resolve(); await pending; }
  await assertNoRecordings(real.root);
});

test("a request cancelled while the previous service retires never creates or calls the next service", async () => {
  const retiring = deferred();
  const fixture = desktopFixture((_options, fake) => ({ ...fake, dispose: () => retiring.promise }));
  await fixture.invoke("status");
  const disposal = fixture.bridge.dispose();
  const pending = fixture.invoke("transcribe", {
    requestId: "queued", adventureId: "adventure-a", sessionId: "session-a", audio: wav(),
  });
  await fixture.invoke("cancel", { requestId: "queued" });
  retiring.resolve();
  await disposal;
  assert.equal((await pending).error.code, "SPEECH_CANCELLED");
  assert.equal(fixture.calls.filter(([name]) => name === "create").length, 1);
  assert.equal(fixture.calls.filter(([name]) => name === "transcribe").length, 0);
});

test("scene changes, cancellation and disabling input suppress late desktop results", async (t) => {
  for (const change of ["scene", "cancel", "disable", "test-disable"]) {
    await t.test(change, async () => {
      const entered = deferred(), finish = deferred();
      const fixture = desktopFixture((_options, fake) => ({ ...fake, transcribe: async () => {
        entered.resolve(); await finish.promise; return { ok: true, result: { text: "late" } };
      } }));
      const payload = change === "test-disable" ? { requestId: change, test: true, audio: wav() }
        : { requestId: change, adventureId: "adventure-a", sessionId: "session-a", audio: wav() };
      const pending = fixture.invoke("transcribe", payload);
      await entered.promise;
      try {
        if (change === "scene") fixture.setContext({ ready: true, adventureId: "adventure-b", sessionId: "session-b" });
        else if (change === "cancel") await fixture.bridge.cancel({ requestId: change });
        else {
          const before = fixture.getSettings(), after = { audio: { input: { ...before.audio.input, enabled: false } } };
          fixture.setSettings(after);
          await fixture.bridge.settingsChanged(before, after);
          assert.equal(fixture.calls.filter(([name]) => name === "cancel").length, 1);
        }
        finish.resolve();
        const result = await pending;
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "SPEECH_STALE");
        assert.equal(result.result, undefined);
      } finally { finish.resolve(); await pending; }
    });
  }
});

test("unrelated settings do not cancel recognition and disabled real service requests remain blocked through IPC", async (t) => {
  const fixture = desktopFixture();
  await fixture.invoke("status");
  const before = fixture.getSettings();
  await fixture.bridge.settingsChanged(before, { ...before, audio: { ...before.audio, gameVolume: 17, tts: { enabled: false } } });
  assert.equal(fixture.calls.filter(([name]) => name === "cancel").length, 0);
  const real = await serviceFixture(t, { enabled: false });
  const desktop = desktopFixture(() => real.service);
  const result = await desktop.invoke("transcribe", { requestId: "disabled-test", test: true, audio: wav() });
  assert.equal(result.error.code, "SPEECH_DISABLED");
  assert.equal(real.runnerCalls(), 0);
});

test("speech settings preserve even an unverified active API identity, while actual provider changes still require validation", () => {
  const connection = createCustomConnection({ name: "Offline fixture", baseUrl: "https://api.example.invalid/v1",
    modelId: "fixture-model" }, { id: "custom_0123456789abcdef" });
  const baseline = normalizeDesktopSettings({ api: { provider: "openai-compatible", connectionId: connection.id,
    customConnections: [connection] } });
  assert.equal(baseline.api.provider, "openai-compatible");
  assert.equal(baseline.api.customConnections[0].verifiedAt, null);
  for (const input of [{ enabled: true }, { language: "ja" }, { deviceId: "opaque-device-id" }]) {
    const next = normalizeDesktopSettings(mergeDesktopSettings(baseline, { audio: { input } }));
    assert.deepEqual(next.api, baseline.api);
    assert.equal(settingsAffectProvider(baseline, next), false);
  }
  const other = createCustomConnection({ name: "Other fixture", baseUrl: connection.baseUrl, modelId: connection.modelId },
    { id: "custom_fedcba9876543210" });
  for (const api of [
    { provider: "deepseek", model: "deepseek-v4-flash" },
    { customConnections: [{ ...connection, baseUrl: "https://other.example.invalid/v1" }] },
    { customConnections: [{ ...connection, modelId: "different-model" }] },
    { connectionId: other.id, customConnections: [connection, other] },
  ]) {
    const next = normalizeDesktopSettings(mergeDesktopSettings(baseline, { api }));
    assert.equal(settingsAffectProvider(baseline, next), true);
  }
});

test("only enabled, trusted top-level audio permission is granted; camera and other origins remain denied", () => {
  let check, request, enabled = true, destroyed = false;
  const trustedUrl = "file:///fixture/renderer/index.html";
  let currentUrl = trustedUrl;
  const contents = { isDestroyed: () => destroyed, getURL: () => currentUrl, session: {
    setPermissionCheckHandler: (handler) => { check = handler; },
    setPermissionRequestHandler: (handler) => { request = handler; },
  } };
  installSpeechInputPermissions({ webContents: contents, trustedUrl,
    getSettings: () => ({ audio: { input: { enabled } } }) });
  // Match Electron's distinct check/request detail schemas, rather than depending
  // on request-only mediaTypes in a check or check-only mediaType in a request.
  const checkDetails = { isMainFrame: true, requestingUrl: trustedUrl, mediaType: "audio" };
  const requestDetails = { isMainFrame: true, requestingUrl: trustedUrl, mediaTypes: ["audio"] };
  const details = { ...checkDetails, ...requestDetails };
  const requested = (sender = contents, permission = "media", detail = requestDetails) => {
    let allowed;
    request(sender, permission, (value) => { allowed = value; }, detail);
    return allowed;
  };
  assert.equal(check(contents, "media", "file://", checkDetails), true);
  assert.equal(requested(), true);
  assert.equal(check(null, "media", "file://", checkDetails), false);
  for (const [sender, permission, detail] of [
    [{}, "media", details], [contents, "geolocation", details],
    [contents, "media", { ...details, isMainFrame: false }],
    [contents, "media", { ...details, requestingUrl: "https://other.invalid/" }],
    [contents, "media", { ...details, mediaType: "video", mediaTypes: ["video"] }],
    [contents, "media", { ...details, mediaType: "unknown", mediaTypes: ["audio", "video"] }],
    [contents, "media", {}],
  ]) {
    assert.equal(check(sender, permission, "file://", detail), false);
    assert.equal(requested(sender, permission, detail), false);
  }
  for (const mediaTypes of [[], ["audio", "audio"], undefined]) assert.equal(requested(contents, "media", { ...details, mediaTypes }), false);
  enabled = false; assert.equal(check(contents, "media", "file://", details), false); assert.equal(requested(), false);
  enabled = true; destroyed = true; assert.equal(requested(), false);
  destroyed = false; currentUrl = "https://other.invalid/";
  assert.equal(check(contents, "media", "file://", details), false); assert.equal(requested(), false);
});

test("backend errors do not leak runner paths or low-level diagnostics", () => {
  assert.equal(failure({ code: "ENOSPC", message: "/private/path secret" }).error.code, "SPEECH_DISK_FULL");
  assert.equal(failure({ code: "EACCES", message: "/private/path secret" }).error.code, "SPEECH_STORAGE_FAILED");
  assert.equal(failure(new Error("/private/path secret")).error.code, "SPEECH_FAILED");
  assert.equal(JSON.stringify(failure(new Error("/private/path secret"))).includes("secret"), false);
});
