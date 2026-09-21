"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { createTurnStore } = require("./turn-store");
const { createSessionArchiveReader } = require("./session-archive");
const { loadBuiltInContentPack } = require("../content-v2/built-in-pack");
const { compileContentSnapshot } = require("../content-v2/snapshot-compiler");
const { makeTreeWritable } = require("../content-v2/snapshot-utils");
const { readContentSnapshot } = require("../content-v2/snapshot-reader");
const samples = require("./test-fixtures/turn-samples");

const contentRoot = path.resolve(__dirname, "../../content");
const packPromise = loadBuiltInContentPack({ contentRoot });

async function fixture(t, { locale = "zh-CN", turnCount = 1, eachChapter = false, closed = true, longRevision = null, hugeTurn = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-readonly-archive-")));
  const adventuresRoot = path.join(root, "saves");
  const adventureId = "archive-test";
  await fs.mkdir(adventuresRoot);
  const pack = await packPromise;
  await compileContentSnapshot({ adventuresRoot, adventureId, language: locale, plan: pack.defaultPlan,
    requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"],
    resolvePackRoot: (packId) => path.join(contentRoot, "packs", packId) });
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId });
  const databasePath = path.join(adventuresRoot, adventureId, "session.sqlite");
  const identity = { databasePath, adventureId, locale, contentVersion: snapshot.lock.overallHash };
  const store = createTurnStore({ ...identity, initialState: samples.initialState() });
  t.after(async () => { store.close(); await makeTreeWritable(root); await fs.rm(root, { recursive: true, force: true }); });
  const history = [];
  function commit(revision, bundle, input) {
    const action = store.beginAction({ actionId: `action-${revision}`, baseRevision: revision - 1, input,
      locale, contentVersion: identity.contentVersion });
    try { store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle }); }
    catch (error) { if (error.code !== "HISTORY_PAGE_TOO_LARGE" || store.readAction(action.actionId).status !== "committed") throw error; }
    history.push({ revision, actionId: action.actionId, input, narration: structuredClone(bundle.narration) });
  }
  function chapter(revision) {
    const job = store.beginChapter({ targetRevision: revision });
    const segmentId = history[revision - 1].narration[0].id;
    store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: { title: `Chapter ${revision}`,
      summary: `Saved story through ${revision}.`, keyEvents: [{ text: `Source at ${revision}.`, sources: [{ revision, segmentId }] }],
      openThreads: [], mode: "model" } });
  }
  for (let revision = 1; revision <= turnCount; revision += 1) {
    commit(revision, revision === 1 && hugeTurn
      ? { narration: [...Array.from({ length: 24 }, (_, index) => ({ id: `large-${index}`, text: "长".repeat(100000) }))], events: [], experiences: [] }
      : revision === 1 && longRevision !== 1 ? samples.borrowBundle()
      : { narration: [{ id: `segment-${revision}`, text: revision === longRevision ? "完整原文不应截断。".repeat(6000) : `Story passage ${revision}.` }], events: [], experiences: [] }, `Player input ${revision}.`);
    if (eachChapter) chapter(revision);
  }
  const proposeRevision = turnCount + 1;
  const revision = turnCount + 2;
  const prose = { "zh-CN": ["这段故事可以结束了，你愿意吗？", "你最后回望楼道。这一段故事结束了。"],
    "en-US": ["This story can end here. Would you like that?", "You look back at the corridor. This story comes to an end."],
    "ja-JP": ["この物語をここで終えてもよいでしょうか。", "あなたは廊下を振り返ります。この物語はここで幕を閉じます。"] }[locale];
  commit(proposeRevision, { narration: [{ id: "offer", text: prose[0] }], events: [{ id: "propose", type: "finale.propose",
    sourceSegmentIds: ["offer"], data: { candidateId: "ordinary-end", closureReason: "主要选择已完成。", closedThreads: ["离开的决定已完成。"],
      intentionalOpenThreads: [], finaleTone: "安静" } }], experiences: [] }, "Consider the ending.");
  if (eachChapter) chapter(proposeRevision);
  commit(revision, { narration: [{ id: "final", text: prose[1] }], events: [{ id: "confirm", type: "finale.confirm",
    sourceSegmentIds: ["final"], data: { candidateId: "ordinary-end" } }], experiences: [] }, "End this story here.");
  if (closed) { chapter(revision); store.sealFinale({ finaleId: `finale-${revision}`, chapterId: `chapter-${revision}` }); }
  store.close();
  return { root, adventuresRoot, adventureId, databasePath, identity, history, revision, snapshot,
    reader: createSessionArchiveReader({ adventuresRoot }) };
}

async function evidence(file) {
  const stat = await fs.stat(file);
  return { hash: createHash("sha256").update(await fs.readFile(file)).digest("hex"), size: stat.size, mode: stat.mode,
    inode: stat.ino, links: stat.nlink, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
}

test("离线归档直接从只读数据库恢复正文、章节和人物物品面板，文件与目录保持不变", async (t) => {
  const env = await fixture(t);
  await fs.chmod(env.databasePath, 0o400);
  const before = await evidence(env.databasePath);
  const names = (await fs.readdir(path.dirname(env.databasePath))).sort();
  const opened = await env.reader.open({ adventureId: env.adventureId });
  assert.deepEqual(opened.archive, { mode: "archive", read_only: true });
  assert.equal(opened.readOnlyRoot, env.adventuresRoot);
  assert.equal(opened.storyFinale.projection.phase, "closed");
  assert.equal(opened.storyFinale.projection.inputAllowed, false);
  assert.equal(opened.projection.save.catalogRole, "archive");
  assert.equal(opened.projection.history.length, 3);
  assert.equal(opened.projection.historyComplete, true);
  assert.equal(opened.projection.envelope.meta.autoSpeak, false);
  assert.equal(opened.projection.history.every((entry) => entry.autoSpeak === false), true);
  assert.equal(opened.chapterPage.chapters.length, 1);
  assert.equal(opened.lockedContent.integrityStatus, "locked");
  assert.equal(opened.lockedContent.language, "zh-CN");
  assert.equal(opened.lockedContent.host.title, env.snapshot.profile.host.title);
  assert.equal(opened.lockedContent.world.title, env.snapshot.profile.world.title);
  assert.equal(opened.lockedContent.host.body, undefined);
  assert.doesNotMatch(JSON.stringify(opened), /尚未露面的访客|未发现的钥匙|hidden_key|closureReason/);
  const list = await env.reader.readPanel({ adventureId: env.adventureId, revision: env.revision,
    panelRef: "session_inventory", view: "list", fieldId: "inventory" });
  assert.equal(list.panel.items.length, 1);
  assert.equal(list.panel.items[0].title, "袋装米");
  const item = await env.reader.readPanel({ adventureId: env.adventureId, revision: env.revision,
    panelRef: "session_inventory", view: "detail", fieldId: "inventory", itemRef: list.panel.items[0].ref });
  const identity = item.panel.detail.sections.find((section) => section.id === "identity");
  assert.equal(identity.fields.find((field) => field.id === "quantity").value, 2);
  const characters = await env.reader.readPanel({ adventureId: env.adventureId, revision: env.revision,
    panelRef: "session_characters", view: "list", fieldId: "characters", limit: 1 });
  assert.equal(characters.panel.items.length, 1);
  const rest = await env.reader.readPanel({ adventureId: env.adventureId, revision: env.revision,
    panelRef: "session_characters", view: "list", fieldId: "characters", cursor: characters.panel.pagination.nextCursor });
  assert.equal(rest.panel.items.length, 1);
  assert.doesNotMatch(JSON.stringify([list, item, characters, rest]), /hidden_key|尚未露面的访客|未发现的钥匙/);
  assert.deepEqual(await evidence(env.databasePath), before);
  assert.deepEqual((await fs.readdir(path.dirname(env.databasePath))).sort(), names);
});

for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
  test(`归档 ${locale} 保留存档语言与正文，界面语言可以独立展示`, async (t) => {
    const env = await fixture(t, { locale, turnCount: 0 });
    const before = await evidence(env.databasePath);
    const original = await env.reader.open({ adventureId: env.adventureId, displayLocale: locale });
    const changed = await env.reader.open({ adventureId: env.adventureId, displayLocale: locale === "en-US" ? "ja-JP" : "en-US" });
    assert.equal(original.lockedContent.language, locale);
    assert.equal(changed.lockedContent.language, locale);
    assert.deepEqual(changed.projection.history, original.projection.history);
    assert.notEqual(changed.storyFinale.projection.engineNotice, original.storyFinale.projection.engineNotice);
    assert.deepEqual(await evidence(env.databasePath), before);
  });
}

test("长档案历史和章节分别分页，固定版本下无重复、无遗漏原文", async (t) => {
  const env = await fixture(t, { turnCount: 55, eachChapter: true });
  const before = await evidence(env.databasePath);
  const opened = await env.reader.open({ adventureId: env.adventureId });
  assert.equal(opened.projection.history.length, 20);
  assert.equal(opened.projection.historyComplete, false);
  assert.equal(opened.chapterPage.chapters.length, 12);
  assert.equal(opened.chapterPage.complete, false);
  const history = [...opened.projection.history];
  let cursor = opened.projection.historyNextBeforeRevision;
  while (cursor) {
    const page = await env.reader.readHistory({ adventureId: env.adventureId, revision: env.revision, beforeRevision: cursor, limit: 7 });
    history.unshift(...page.history); cursor = page.nextBeforeRevision;
  }
  assert.deepEqual(history.map((entry) => entry.revision), env.history.map((entry) => entry.revision));
  assert.deepEqual(history.map((entry) => entry.host), env.history.map((entry) => entry.narration.map((segment) => segment.text).join("\n\n")));
  assert.deepEqual(history.map((entry) => entry.player), env.history.map((entry) => entry.input));
  const chapters = [...opened.chapterPage.chapters]; cursor = opened.chapterPage.nextCursor;
  while (cursor) {
    const page = await env.reader.readChapters({ adventureId: env.adventureId, revision: env.revision, cursor, limit: 9 });
    chapters.push(...page.chapters); cursor = page.nextCursor;
  }
  assert.deepEqual(chapters.map((entry) => entry.turn_range.end), Array.from({ length: env.revision }, (_, index) => index + 1));
  assert.equal(new Set(chapters.map((entry) => entry.chapter_id)).size, env.revision);
  await assert.rejects(env.reader.readHistory({ adventureId: env.adventureId, revision: env.revision + 1 }), { code: "ARCHIVE_REVISION_MISMATCH" });
  await assert.rejects(env.reader.readHistory({ adventureId: env.adventureId, revision: env.revision,
    beforeRevision: { ...opened.projection.historyNextBeforeRevision, adventureId: "different-story" } }), { code: "HISTORY_CURSOR_MISMATCH" });
  await assert.rejects(env.reader.readChapters({ adventureId: env.adventureId, revision: env.revision,
    cursor: { ...opened.chapterPage.nextCursor, throughToRevision: env.revision + 1 } }), { code: "CHAPTER_CURSOR_MISMATCH" });
  await assert.rejects(env.reader.readPanel({ adventureId: env.adventureId, revision: env.revision - 1, panelRef: "session_characters" }), { code: "ARCHIVE_REVISION_MISMATCH" });
  assert.deepEqual(await evidence(env.databasePath), before);
});

test("较小历史预算明确报错；提高预算后完整取回，原文不截断", async (t) => {
  const env = await fixture(t, { turnCount: 2, longRevision: 2 });
  await assert.rejects(env.reader.readHistory({ adventureId: env.adventureId, revision: env.revision,
    beforeRevision: { adventureId: env.adventureId, revision: env.revision, beforeRevision: 3 }, maxCharacters: 2000 }), { code: "HISTORY_PAGE_TOO_LARGE" });
  const page = await env.reader.readHistory({ adventureId: env.adventureId, revision: env.revision,
    beforeRevision: { adventureId: env.adventureId, revision: env.revision, beforeRevision: 3 }, maxCharacters: 200000 });
  assert.equal(page.history.at(-1).host, env.history[1].narration.map((segment) => segment.text).join("\n\n"));
});

test("2.4M 字符单轮可提高预算完整导出，最终投影仍受8MiB字节边界限制", async (t) => {
  const env = await fixture(t, { hugeTurn: true });
  const initial = await env.reader.open({ adventureId: env.adventureId });
  assert.equal(initial.projection.history.length, 2);
  assert.equal(initial.projection.historyComplete, false);
  const request = { adventureId: env.adventureId, revision: env.revision, beforeRevision: initial.projection.historyNextBeforeRevision };
  await assert.rejects(env.reader.readHistory({ ...request, maxCharacters: 2000000 }), { code: "HISTORY_PAGE_TOO_LARGE" });
  const page = await env.reader.readHistory({ ...request, maxCharacters: 8000000 });
  assert.equal(page.complete, true);
  assert.equal(page.history.length, 1);
  assert.equal(page.history[0].host, env.history[0].narration.map((segment) => segment.text).join("\n\n"));
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 8 * 1024 * 1024 - 4096);
  const full = await env.reader.open({ adventureId: env.adventureId, maxCharacters: 8000000 });
  assert.equal(full.projection.historyComplete, true);
  assert.ok(Buffer.byteLength(JSON.stringify(full)) <= 8 * 1024 * 1024 - 4096);
});

test("100 条原始记录刚好可容纳但投影身份字段超限时，缩小整页并保留正确续读游标", async (t) => {
  const env = await fixture(t, { turnCount: 98 });
  const maximum = 8 * 1024 * 1024 - 4096;
  const raw = { adventureId: env.adventureId, revision: env.revision, history: env.history,
    nextBeforeRevision: null, complete: true };
  const paddingBytes = maximum - 1500 - Buffer.byteLength(JSON.stringify(raw));
  let characters = Math.floor(paddingBytes / 3);
  for (const record of env.history.slice(0, 98)) {
    const count = Math.min(95000, characters);
    record.narration[0].text += "长".repeat(count);
    characters -= count;
  }
  assert.equal(characters, 0);
  env.history[0].narration[0].text += "x".repeat(paddingBytes % 3);
  assert.equal(Buffer.byteLength(JSON.stringify(raw)), maximum - 1500);
  // Fill only this synthetic archive's immutable source text to exercise the
  // byte boundary; IDs, confirmation, state and chapter references stay fixed.
  const db = new DatabaseSync(env.databasePath);
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const record of env.history.slice(0, 98)) db.prepare("UPDATE turns SET narration_json=? WHERE revision=?")
      .run(JSON.stringify(record.narration), record.revision);
    db.exec("COMMIT");
  } finally { db.close(); }
  const before = await evidence(env.databasePath);
  const page = await env.reader.readHistory({ adventureId: env.adventureId, revision: env.revision,
    maxCharacters: 8000000, limit: 100 });
  assert.ok(page.history.length < 100);
  assert.equal(page.complete, false);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= maximum);
  const rest = await env.reader.readHistory({ adventureId: env.adventureId, revision: env.revision,
    maxCharacters: 8000000, limit: 100, beforeRevision: page.nextBeforeRevision });
  const combined = [...rest.history, ...page.history];
  assert.deepEqual(combined.map((record) => record.revision), env.history.map((record) => record.revision));
  assert.deepEqual(combined.map((record) => record.host), env.history.map((record) => record.narration.map((segment) => segment.text).join("\n\n")));
  assert.deepEqual(await evidence(env.databasePath), before);
});

test("未封存以及旧缺失 archive 表的确认故事不能被只读入口擅自封存", async (t) => {
  const env = await fixture(t, { closed: false });
  let before = await evidence(env.databasePath);
  await assert.rejects(env.reader.open({ adventureId: env.adventureId }), { code: "ARCHIVE_NOT_CLOSED" });
  assert.deepEqual(await evidence(env.databasePath), before);
  const db = new DatabaseSync(env.databasePath); db.exec("DROP TABLE finale_archives"); db.close();
  before = await evidence(env.databasePath);
  const names = (await fs.readdir(path.dirname(env.databasePath))).sort();
  await assert.rejects(env.reader.open({ adventureId: env.adventureId }), { code: "ARCHIVE_NOT_CLOSED" });
  assert.deepEqual(await evidence(env.databasePath), before);
  assert.deepEqual((await fs.readdir(path.dirname(env.databasePath))).sort(), names);
});

test("确认身份冲突、混合旧格式、链接及 WAL 均拒绝，未产生数据库副本或日志", async (t) => {
  const env = await fixture(t);
  const root = path.dirname(env.databasePath);
  const readerRequest = { adventureId: env.adventureId };
  let db = new DatabaseSync(env.databasePath); db.prepare("UPDATE finale_archives SET candidate_id=?").run("different-end"); db.close();
  let before = await evidence(env.databasePath);
  await assert.rejects(env.reader.open(readerRequest), { code: "ARCHIVE_STATE_UNAVAILABLE" });
  assert.deepEqual(await evidence(env.databasePath), before);
  db = new DatabaseSync(env.databasePath); db.prepare("UPDATE finale_archives SET candidate_id=?").run("ordinary-end"); db.close();
  await fs.writeFile(path.join(root, "state.json"), "synthetic old marker");
  await assert.rejects(env.reader.open(readerRequest), { code: "SAVE_FORMAT_UNSUPPORTED" });
  await fs.unlink(path.join(root, "state.json"));
  const moved = path.join(root, "original.sqlite");
  await fs.rename(env.databasePath, moved); await fs.symlink(moved, env.databasePath);
  before = await evidence(moved);
  await assert.rejects(env.reader.open(readerRequest), { code: "SAVE_PATH_INVALID" });
  assert.deepEqual(await evidence(moved), before);
  await fs.unlink(env.databasePath); await fs.rename(moved, env.databasePath);
  db = new DatabaseSync(env.databasePath); db.exec("PRAGMA journal_mode=WAL"); db.close();
  before = await evidence(env.databasePath);
  const names = (await fs.readdir(root)).sort();
  await assert.rejects(env.reader.open(readerRequest), { code: "SAVE_FORMAT_UNSUPPORTED" });
  assert.deepEqual(await evidence(env.databasePath), before);
  assert.deepEqual((await fs.readdir(root)).sort(), names);
});

test("实际崩溃留下热日志时只读档案拒绝恢复并保留全部恢复材料", async (t) => {
  const env = await fixture(t, { turnCount: 25 });
  const script = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(env.databasePath)});
    db.exec('PRAGMA cache_size=5; BEGIN IMMEDIATE');db.prepare('UPDATE turns SET narration_json=? WHERE revision=1').run(JSON.stringify([{id:'borrow-text',text:'changed'.repeat(400000)}]));process.exit(72);`;
  const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 72, child.stderr);
  const journal = `${env.databasePath}-journal`;
  const journalBody = await fs.readFile(journal);
  assert.equal(journalBody.subarray(0, 8).toString("hex"), "d9d505f920a163d7");
  const before = await evidence(env.databasePath);
  const journalBefore = await evidence(journal);
  const names = (await fs.readdir(path.dirname(env.databasePath))).sort();
  await assert.rejects(env.reader.open({ adventureId: env.adventureId }), { code: "ARCHIVE_RECOVERY_REQUIRED" });
  assert.deepEqual(await evidence(env.databasePath), before);
  assert.deepEqual(await evidence(journal), journalBefore);
  assert.deepEqual((await fs.readdir(path.dirname(env.databasePath))).sort(), names);
});

test("只读入口拒绝路径穿越、非法参数与访问器，不执行调用者函数", async (t) => {
  const env = await fixture(t);
  await assert.rejects(env.reader.open({ adventureId: "../escape" }), { code: "SAVE_PATH_INVALID" });
  await assert.rejects(env.reader.open({ adventureId: env.adventureId, provider: {} }), { code: "ARCHIVE_INPUT_INVALID" });
  await assert.rejects(env.reader.open({ adventureId: env.adventureId, limit: 0 }), { code: "ARCHIVE_INPUT_INVALID" });
  const input = { adventureId: env.adventureId };
  Object.defineProperty(input, "displayLocale", { enumerable: true, get() { throw new Error("must not execute"); } });
  await assert.rejects(env.reader.open(input), { code: "ARCHIVE_INPUT_INVALID" });
});
