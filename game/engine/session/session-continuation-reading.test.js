"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { createTurnStore } = require("./turn-store");
const { appendContinuationBoundary } = require("./session-lineage");
const { createSessionChapters } = require("./session-chapters");
const { createSessionArchiveReader } = require("./session-archive");
const { createSessionStoryExporter } = require("./session-story-export");
const { inspectSessionAdventure } = require("./session-catalog");
const { loadBuiltInContentPack } = require("../content-v2/built-in-pack");
const { compileContentSnapshot } = require("../content-v2/snapshot-compiler");
const { readContentSnapshot } = require("../content-v2/snapshot-reader");
const { makeTreeWritable } = require("../content-v2/snapshot-utils");
const samples = require("./test-fixtures/turn-samples");

const contentRoot = path.resolve(__dirname, "../../content");
const packPromise = loadBuiltInContentPack({ contentRoot });

async function fingerprint(file) {
  const stat = await fs.stat(file);
  return { hash: createHash("sha256").update(await fs.readFile(file)).digest("hex"),
    size: stat.size, mode: stat.mode, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
}

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-continuation-reading-")));
  const adventuresRoot = path.join(root, "adventures");
  await fs.mkdir(adventuresRoot);
  const pack = await packPromise;
  await compileContentSnapshot({ adventuresRoot, adventureId: "ancestor", language: "zh-CN", plan: pack.defaultPlan,
    requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"],
    resolvePackRoot: (packId) => path.join(contentRoot, "packs", packId) });
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId: "ancestor" });
  const env = { root, adventuresRoot, adventureId: "ancestor", revision: 0, history: [], chapters: [], boundaries: [], parents: [] };
  const stores = [];
  env.identity = () => ({ databasePath: path.join(adventuresRoot, env.adventureId, "session.sqlite"),
    adventureId: env.adventureId, locale: "zh-CN", contentVersion: snapshot.lock.overallHash });
  env.open = (options = {}) => { env.store = createTurnStore({ ...env.identity(), ...options }); stores.push(env.store); return env.store; };
  env.open({ initialState: samples.initialState() });
  t.after(async () => {
    for (const store of stores) store.close();
    await makeTreeWritable(root); await fs.rm(root, { recursive: true, force: true });
  });
  env.commit = (events = [], text, experiences = []) => {
    const revision = env.revision + 1;
    const input = `PLAYER_${env.adventureId}_${revision}_END`;
    const narration = [{ id: `segment-${revision}`, text: text ?? `PROSE_${env.adventureId}_${revision}_END` }];
    const action = env.store.beginAction({ actionId: `action-${revision}`, baseRevision: env.revision,
      input, locale: "zh-CN", contentVersion: snapshot.lock.overallHash });
    env.store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
      bundle: { narration, events, experiences } });
    env.revision = revision;
    env.history.push({ revision, input, narration, source: { adventureId: env.adventureId, revision } });
    return revision;
  };
  env.chapter = () => {
    const job = env.store.beginChapter({ targetRevision: env.revision });
    assert.equal(job.started, true);
    const chapter = { title: `CHAPTER_${env.revision}_END`, summary: `SUMMARY_${env.revision}_END`,
      keyEvents: [{ text: `EVENT_${env.revision}_END`, sources: [{ revision: env.revision, segmentId: `segment-${env.revision}` }] }],
      openThreads: [], mode: "model" };
    env.store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter });
    env.chapters.push({ chapterId: job.chapterId, fromRevision: job.fromRevision, toRevision: job.toRevision });
  };
  env.finish = () => {
    const proposed = env.revision + 1;
    const candidateId = `ending-${proposed}`;
    env.commit([{ id: "offer", type: "finale.propose", sourceSegmentIds: [`segment-${proposed}`], data: {
      candidateId, closureReason: "PRIVATE_CLOSURE_REASON", closedThreads: ["这段同行完成了。"], intentionalOpenThreads: [], finaleTone: "平静" } }]);
    const closed = env.revision + 1;
    env.commit([{ id: "confirm", type: "finale.confirm", sourceSegmentIds: [`segment-${closed}`], data: { candidateId } }]);
    env.chapter();
    return env.store.sealFinale({ finaleId: `finale-${closed}`, chapterId: `chapter-${closed}` });
  };
  env.fork = async (childAdventureId) => {
    const parentAdventureId = env.adventureId;
    const parentRevision = env.revision;
    const parent = { adventureId: parentAdventureId, revision: parentRevision,
      archive: env.store.readFinale().archive, databasePath: env.identity().databasePath };
    env.store.close();
    parent.evidence = await fingerprint(parent.databasePath);
    const childRoot = path.join(adventuresRoot, childAdventureId);
    await fs.cp(path.join(adventuresRoot, parentAdventureId), childRoot, { recursive: true });
    const profilePath = path.join(childRoot, "content-profile.json");
    const profile = JSON.parse(await fs.readFile(profilePath, "utf8"));
    profile.adventureId = childAdventureId;
    await fs.chmod(profilePath, 0o600); await fs.writeFile(profilePath, JSON.stringify(profile)); await fs.chmod(profilePath, 0o400);
    const createdAt = `2026-09-${String(11 + env.boundaries.length).padStart(2, "0")}T12:00:00.000Z`;
    const db = new DatabaseSync(path.join(childRoot, "session.sqlite"));
    let timeline;
    try { timeline = appendContinuationBoundary(db, { parentAdventureId, childAdventureId, parentRevision,
      sourceFinaleId: parent.archive.finaleId, requestId: `continue-${childAdventureId}`, createdAt, title: `续篇 ${childAdventureId}` }); }
    finally { db.close(); }
    env.parents.push(parent); env.boundaries.push(parentRevision + 1);
    env.adventureId = childAdventureId; env.revision += 1; env.open();
    assert.equal(timeline.storyTurnCount, env.history.length);
    return { parent, createdAt };
  };
  env.reader = createSessionArchiveReader({ adventuresRoot });
  return env;
}

test("续篇只有系统边界时保存 unchanged 且零模型；新正文按真实来源分页与归章", async (t) => {
  const env = await fixture(t);
  const parentFinale = env.finish();
  const { createdAt } = await env.fork("child");
  let calls = 0;
  const service = createSessionChapters({ store: env.store, provider: { async generate(request) {
    calls++;
    const data = JSON.parse(request.messages[1].content);
    assert.deepEqual(data.sources.map((source) => source.revision), [4, 5]);
    assert.deepEqual(data.sources.map((source) => source.source), [{ adventureId: "child", revision: 4 }, { adventureId: "child", revision: 5 }]);
    return { text: JSON.stringify({ title: "续篇回顾", summary: "你继续观察楼道。", keyEvents: [
      { text: "新的观察。", sources: [{ revision: 5, segmentId: "segment-5" }] }], openThreads: [] }) };
  } } });
  t.after(() => service.shutdown());
  const unchanged = await service.saveChapter({ targetRevision: 3 });
  assert.equal(unchanged.saved, true); assert.equal(unchanged.chapterStatus, "unchanged");
  assert.equal(unchanged.modelCalls, 0); assert.equal(calls, 0);
  assert.equal(env.store.readChapterJob("chapter-3"), null);
  assert.equal(env.store.readFinale().decision.phase, "idle");
  assert.equal(env.store.readFinale().archive, null);
  assert.deepEqual(env.store.readFinale({ revision: 2 }).archive, parentFinale.archive);
  const inspection = await inspectSessionAdventure({ adventuresRoot: env.adventuresRoot, adventureId: "child" });
  assert.equal(inspection.status, "ready"); assert.equal(inspection.summary.turn, 2);
  assert.equal(inspection.summary.updatedAt, createdAt);
  assert.equal(inspection.summary.state_hint.time.turn, 2);
  env.commit(); env.commit();
  const job = env.store.beginChapter({ targetRevision: 5 });
  assert.deepEqual([job.fromRevision, job.toRevision], [4, 5]);
  const first = env.store.readChapterSource({ chapterId: job.chapterId, attemptId: job.attemptId, limit: 1 });
  assert.deepEqual(first.turns.map((turn) => turn.revision), [4]);
  env.commit();
  const rest = env.store.readChapterSource({ chapterId: job.chapterId, attemptId: job.attemptId, cursor: first.nextCursor });
  assert.deepEqual(rest.turns.map((turn) => turn.revision), [5]); assert.equal(rest.complete, true);
  env.store.failChapter({ chapterId: job.chapterId, attemptId: job.attemptId, code: "CHAPTER_INTERRUPTED" });
  const saved = await service.saveChapter({ targetRevision: 5 }, { retry: true });
  assert.equal(saved.chapterStatus, "created"); assert.equal(calls, 1);
  assert.equal(saved.chapter.fromRevision, 4); assert.equal(saved.chapter.toRevision, 5);
  assert.equal(env.store.readView().revision, 6);
  assert.equal(env.store.readChapters({ revision: 3 }).chapters.length, 1);
  assert.deepEqual(await fingerprint(env.parents[0].databasePath), env.parents[0].evidence);
});

test("多代续篇保留祖代无text与旧text经历、原文来源及完整分页导出", async (t) => {
  const env = await fixture(t);
  const withoutText = { id: "ancestor-original", entityIds: ["p"], eventIds: [], sourceSegmentIds: ["segment-1"],
    kind: "event", knownBy: ["p"] };
  const oldExperience = { id: "ancestor-legacy", text: "  灯光短暂变化，原因尚不清楚。\n", entityIds: ["p"],
    eventIds: [], sourceSegmentIds: ["segment-2"], kind: "event", knownBy: ["p"] };
  env.commit([], "你听见门外两声轻响，但没有看见来人，无法确认是谁。", [withoutText]);
  env.commit([], "灯光暗了一瞬，随后恢复；你没有去碰开关。", [oldExperience]);
  const sourceHash = env.store.readContextHistory({ revision: 2 }).sourceHash;
  const rawExperiences = (databasePath) => {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try { return db.prepare("SELECT revision,experience_id,body_json FROM experiences ORDER BY revision,experience_id").all(); }
    finally { db.close(); }
  };
  const originalRows = rawExperiences(env.identity().databasePath);
  assert.equal(Object.hasOwn(JSON.parse(originalRows[0].body_json), "text"), false);
  assert.deepEqual(JSON.parse(originalRows[1].body_json), oldExperience);
  for (let index = 2; index < 23; index++) { env.commit(); if (index % 3 === 2) env.chapter(); }
  env.finish(); await env.fork("child");
  for (let index = 0; index < 20; index++) { env.commit(); if (index % 3 === 2) env.chapter(); }
  env.finish(); await env.fork("grandchild");
  for (let index = 0; index < 12; index++) { env.commit(); if (index % 3 === 2) env.chapter(); }
  env.finish();
  for (const parent of env.parents) assert.deepEqual(env.store.readFinale({ revision: parent.revision }).archive, parent.archive);
  assert.equal(env.store.readFinale().archive.confirmationRevision, env.revision);
  env.store.close(); env.open();
  assert.equal(env.store.readContextHistory({ revision: 2 }).sourceHash, sourceHash,
    "the same ancestral source retains its hash after two continuation copies and reopening");
  assert.deepEqual(rawExperiences(env.identity().databasePath), originalRows);
  const records = env.store.listExperienceRecords({ revision: env.revision, viewerId: "p" }).records;
  assert.equal(records.length, 2);
  for (const [index, expected] of [withoutText, oldExperience].entries()) {
    const record = records[index], original = env.history[index];
    assert.deepEqual(record.experience, expected);
    assert.equal(Object.hasOwn(record.experience, "text"), index === 1);
    assert.equal(record.adventureId, "grandchild");
    assert.deepEqual(record.source, { adventureId: "ancestor", revision: index + 1 });
    assert.equal(record.actionId, `action-${index + 1}`);
    assert.equal(record.playerInput, original.input);
    assert.deepEqual(record.passages, original.narration);
  }
  env.store.close();
  const databasePath = env.identity().databasePath;
  const before = await fingerprint(databasePath);
  const names = (await fs.readdir(path.dirname(databasePath))).sort();
  const opened = await env.reader.open({ adventureId: env.adventureId });
  assert.deepEqual(opened.timeline, { storyTurnCount: env.history.length, systemRevisions: env.boundaries });
  assert.equal(opened.projection.save.turn, env.history.length);
  assert.equal(opened.projection.save.state_hint.time.turn, env.history.length);
  assert.equal(opened.projection.storyFinale.projection.actions.continueAsChild, true);
  const history = [...opened.projection.history];
  let cursor = opened.projection.historyNextBeforeRevision;
  while (cursor) {
    const page = await env.reader.readHistory({ adventureId: env.adventureId, revision: env.revision, beforeRevision: cursor, limit: 7 });
    history.unshift(...page.history); cursor = page.nextBeforeRevision;
  }
  assert.deepEqual(history.map((turn) => turn.revision), env.history.map((turn) => turn.revision));
  assert.deepEqual(history.map((turn) => turn.source), env.history.map((turn) => turn.source));
  assert.deepEqual(history.map((turn) => turn.storyTurn), env.history.map((_, index) => index + 1));
  assert.deepEqual(history.map((turn) => turn.host), env.history.map((turn) => turn.narration[0].text));
  const chapters = [...opened.chapterPage.chapters]; cursor = opened.chapterPage.nextCursor;
  while (cursor) {
    const page = await env.reader.readChapters({ adventureId: env.adventureId, revision: env.revision, cursor, limit: 3 });
    chapters.push(...page.chapters); cursor = page.nextCursor;
  }
  assert.deepEqual(chapters.map((chapter) => chapter.turn_range), env.chapters.map((chapter) => ({ start: chapter.fromRevision, end: chapter.toRevision })));
  for (const chapter of chapters) {
    const revision = chapter.turn_range.end;
    assert.deepEqual(chapter.sources.key_events[0].sources[0].source, env.history.find((turn) => turn.revision === revision).source);
    assert.equal(env.boundaries.includes(chapter.turn_range.start), false);
  }
  const exporter = createSessionStoryExporter({ reader: env.reader });
  for (const format of ["html", "markdown"]) {
    const outputPath = path.join(env.root, `complete.${format === "html" ? "html" : "md"}`);
    const result = await exporter.exportStory({ adventureId: env.adventureId, format, outputPath });
    assert.equal(result.turn_count, env.history.length); assert.equal(result.chapter_count, env.chapters.length);
    const output = await fs.readFile(outputPath, "utf8");
    let after = -1;
    for (const turn of env.history) {
      const text = turn.narration[0].text.replaceAll("_", format === "markdown" ? "\\_" : "_");
      const at = output.indexOf(text);
      assert.ok(at > after); assert.equal(output.indexOf(text, at + text.length), -1); after = at;
    }
    assert.ok(output.includes(`第 ${env.history.length} 回合`));
    assert.equal(output.includes(`第 ${env.revision} 回合`), false);
    assert.equal(output.split("续篇开始").length - 1, 2, "each inherited system boundary has one reading divider, not an invented story turn");
    assert.doesNotMatch(output, /continuation\.start|PRIVATE_CLOSURE_REASON|尚未露面的访客|hidden_key/);
  }
  assert.deepEqual(await fingerprint(databasePath), before);
  assert.deepEqual((await fs.readdir(path.dirname(databasePath))).sort(), names);
  for (const parent of env.parents) assert.deepEqual(await fingerprint(parent.databasePath), parent.evidence);
});

test("没有lineage证明的空版本或缺失真实正文仍拒绝章节与离线归档", async (t) => {
  const env = await fixture(t);
  env.finish(); await env.fork("child"); env.commit(); env.finish(); env.store.close();
  const databasePath = env.identity().databasePath;
  const db = new DatabaseSync(databasePath);
  const source = db.prepare("SELECT * FROM turns WHERE revision=4").get();
  try {
    db.prepare("UPDATE turns SET action_id=NULL,narration_json='[]',events_json='[]' WHERE revision=4").run();
  } finally { db.close(); }
  await assert.rejects(env.reader.open({ adventureId: env.adventureId }), { code: "ARCHIVE_STATE_UNAVAILABLE" });
  const repair = new DatabaseSync(databasePath);
  try { repair.prepare("UPDATE turns SET action_id=?,narration_json=?,events_json=? WHERE revision=4").run(source.action_id, source.narration_json, source.events_json); }
  finally { repair.close(); }
  env.open();
  const writer = new DatabaseSync(databasePath);
  try { writer.exec("PRAGMA foreign_keys=OFF"); writer.prepare("DELETE FROM turns WHERE revision=4").run(); }
  finally { writer.close(); }
  assert.throws(() => env.store.beginChapter({ targetRevision: env.revision }), { code: "CHAPTER_SOURCE_UNAVAILABLE" });
  env.store.close();
  await assert.rejects(env.reader.open({ adventureId: env.adventureId }), { code: "ARCHIVE_STATE_UNAVAILABLE" });
});
