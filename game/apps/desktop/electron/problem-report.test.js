"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createProblemRecorder,
  createReportingIpc,
  createPlayerProblemReport,
  savePlayerProblemReport,
  MAX_EVENTS,
} = require("./problem-report");

function temporaryRoot(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `grey-crow-${name}-`)); }
function read(file) { return fs.readFileSync(file, "utf8"); }
function recentFile(root) { return path.join(root, "diagnostics", "recent-problems.json"); }
function event(at, code = "SPEECH_FAILED") {
  return { at, area: "speech-input", code, buildId: "unknown", retryable: false, count: 1, durationMs: null };
}

test("IPC reporting never changes successful, failed, or thrown primary results when recording fails", async () => {
  const handlers = new Map();
  const ipc = { handle(channel, handler) { handlers.set(channel, handler); } };
  const recorder = { record() { throw new Error("diagnostic recorder unavailable"); } };
  const reporting = createReportingIpc({ ipcMain: ipc, recorder });
  reporting.handle("grey-crow:provider-turn", async () => ({ ok: true, value: "normal-result" }));
  reporting.handle("grey-crow:speech-input-status", async () => ({ ok: false, error: { code: "SPEECH_FAILED" } }));
  reporting.handle("grey-crow:save", async () => { const error = new Error("primary failure"); error.code = "STORY_WRITE_FAILED"; throw error; });

  assert.deepEqual(await handlers.get("grey-crow:provider-turn")(), { ok: true, value: "normal-result" });
  assert.deepEqual(await handlers.get("grey-crow:speech-input-status")(), { ok: false, error: { code: "SPEECH_FAILED" } });
  await assert.rejects(handlers.get("grey-crow:save")(), error => error?.code === "STORY_WRITE_FAILED");
});

test("recorder rejects sensitive disk injections and preserves only its event whitelist", () => {
  const root = temporaryRoot("problem-redaction");
  try {
    const file = recentFile(root); fs.mkdirSync(path.dirname(file), { recursive: true });
    const secret = "sk-live-secret-must-never-appear";
    const now = Date.parse("2026-09-20T00:00:00.000Z");
    fs.writeFileSync(file, JSON.stringify({ schema: 1, open: false, dropped: 0, events: [
      { ...event(new Date(now).toISOString()), message: secret, error: { stack: "/private/player/story.db" }, localPath: "/Users/player" },
      { ...event(new Date(now).toISOString(), "NOT_ALLOWED"), message: secret },
      { ...event("1999-01-01T00:00:00.000Z"), message: secret },
    ], injectedPath: "/Users/player", apiKey: secret }));
    const recorder = createProblemRecorder({ root, now: () => now }); recorder.start();
    const snapshot = recorder.snapshot();
    assert.deepEqual(snapshot.events, [event(new Date(now).toISOString())]);
    const persisted = read(file);
    for (const forbidden of [secret, "/private/player/story.db", "/Users/player", "injectedPath", "apiKey", "message", "stack"]) {
      assert.equal(persisted.includes(forbidden), false, `persisted diagnostics must omit ${forbidden}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("restart persistence reports only a generic unclean marker and clean close clears it", () => {
  const root = temporaryRoot("problem-restart");
  try {
    let now = Date.parse("2026-09-20T00:00:00.000Z");
    const first = createProblemRecorder({ root, now: () => now }); first.start();
    first.record("story", "DESKTOP_OPERATION_FAILED", { retryable: true, durationMs: 12 });
    // Deliberately do not close first: it models a process that did not finish cleanly.
    now += 1000;
    const restarted = createProblemRecorder({ root, now: () => now }); restarted.start();
    const markers = restarted.snapshot().events.filter(item => item.code === "PREVIOUS_RUN_UNCLEAN");
    assert.deepEqual(markers.map(item => ({ area: item.area, code: item.code, retryable: item.retryable, durationMs: item.durationMs })),
      [{ area: "application", code: "PREVIOUS_RUN_UNCLEAN", retryable: false, durationMs: null }]);
    restarted.close();
    now += 1000;
    const cleanRestart = createProblemRecorder({ root, now: () => now }); cleanRestart.start();
    assert.equal(cleanRestart.snapshot().events.filter(item => item.code === "PREVIOUS_RUN_UNCLEAN").length, 1,
      "a cleanly closed restart must not append another unclean marker");
    cleanRestart.close();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("retained errors and an unclean exit keep the build that produced them after an update", () => {
  const root = temporaryRoot("problem-builds");
  try {
    const oldBuild = "build-1234567890123-0123456789abcdef", newBuild = "build-1234567890124-fedcba9876543210";
    const first = createProblemRecorder({ root, buildId: oldBuild }); first.start();
    first.record("speech-input", "SPEECH_FAILED");
    const second = createProblemRecorder({ root, buildId: newBuild }); second.start();
    second.record("speech-input", "SPEECH_FAILED");
    assert.deepEqual(second.snapshot().events.map(({code,buildId}) => ({code,buildId})), [
      { code: "SPEECH_FAILED", buildId: oldBuild }, { code: "PREVIOUS_RUN_UNCLEAN", buildId: oldBuild },
      { code: "SPEECH_FAILED", buildId: newBuild },
    ]);
    second.close();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("duplicate, cancelled, expired, and burst-limited diagnostics do not persist extra unsafe records", () => {
  const root = temporaryRoot("problem-limits");
  try {
    let now = Date.parse("2026-09-20T00:00:00.000Z");
    const recorder = createProblemRecorder({ root, now: () => now }); recorder.start();
    recorder.record("speech-input", "SPEECH_FAILED");
    const file = recentFile(root); const afterFirst = read(file);
    now += 1000; recorder.record("speech-input", "SPEECH_FAILED");
    recorder.record("speech-input", "SPEECH_CANCELLED");
    assert.equal(read(file), afterFirst, "coalesced and cancelled diagnostics must not write a new disk record");
    assert.equal(recorder.snapshot().events[0].count, 2, "a duplicate remains an in-memory count only until another flush");

    now += 10_000;
    for (let index = 0; index < 31; index++) {
      now += 1; recorder.record(index % 2 ? "desktop" : "settings", "DESKTOP_OPERATION_FAILED");
    }
    const snapshot = recorder.snapshot();
    assert.ok(snapshot.dropped >= 1, "the per-minute burst cap must drop excess records");
    assert.ok(snapshot.events.length <= MAX_EVENTS, "the retained event list must stay bounded");

    const staleRoot = temporaryRoot("problem-stale");
    try {
      const staleFile = recentFile(staleRoot); fs.mkdirSync(path.dirname(staleFile), { recursive: true });
      fs.writeFileSync(staleFile, JSON.stringify({ schema: 1, open: false, dropped: 0, events: [event("2000-01-01T00:00:00.000Z")] }));
      const stale = createProblemRecorder({ root: staleRoot, now: () => now }); stale.start();
      assert.equal(stale.snapshot().events.length, 0, "expired disk diagnostics must not be retained");
    } finally { fs.rmSync(staleRoot, { recursive: true, force: true }); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("player export contains only projected fields and native save returns success, cancellation, and failure safely", async () => {
  const root = temporaryRoot("problem-export");
  try {
    const recorder = createProblemRecorder({ root, now: () => Date.parse("2026-09-20T00:00:00.000Z") }); recorder.start();
    recorder.record("desktop", "DESKTOP_OPERATION_FAILED");
    const secret = "sk-export-secret";
    const report = createPlayerProblemReport({
      build: { appVersion: "1.2.3", buildId: "dev-123", sourceFingerprint: "f".repeat(64), privatePath: "/Users/player" },
      recorder,
      settings: { localization: { preferredLocale: "en-US", rawLocale: secret }, ui: { storyNotebookTheme: "dark", path: "/Users/player" },
        narration: { lengthPreset: "adaptive" }, audio: { input: { enabled: true, deviceId: secret } } },
      state: { keyVerified: true, gameStarted: true, savePath: "/private/story.db", error: secret },
    });
    const serialized = JSON.stringify(report);
    for (const forbidden of [secret, "/Users/player", "/private/story.db", "savePath", "deviceId", "rawLocale"]) {
      assert.equal(serialized.includes(forbidden), false, `export must omit ${forbidden}`);
    }
    assert.deepEqual(report.context, { locale: "en-US", theme: "dark", narration: "adaptive", speechInputEnabled: true,
      modelConnected: true, adventureOpen: true });

    const nativeDirectory = path.join(root, "native"); fs.mkdirSync(nativeDirectory);
    const destination = path.join(nativeDirectory, "report.json");
    const success = await savePlayerProblemReport({ dialog: { async showSaveDialog() { return { canceled: false, filePath: destination }; } },
      window: {}, documentsPath: path.join(root, "documents"), locale: "en-US", report });
    assert.deepEqual(success, { ok: true, cancelled: false, filename: "report.json" });
    assert.equal(fs.existsSync(destination), true);
    assert.equal(read(destination).includes(secret), false, "saved report must preserve the redacted projection");
    const cancelled = await savePlayerProblemReport({ dialog: { async showSaveDialog() { return { canceled: true }; } },
      window: {}, documentsPath: root, locale: "zh-CN", report });
    assert.deepEqual(cancelled, { ok: true, cancelled: true });
    const failed = await savePlayerProblemReport({ dialog: { async showSaveDialog() { return { canceled: false, filePath: path.join(root, "missing", "report.json") }; } },
      window: {}, documentsPath: root, locale: "ja-JP", report });
    assert.deepEqual(failed, { ok: false, error: { code: "REPORT_WRITE_FAILED", retryable: true } });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
