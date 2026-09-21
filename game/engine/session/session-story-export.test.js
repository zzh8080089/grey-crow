"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createSessionStoryExporter } = require("./session-story-export");
const { createSessionArchiveReader } = require("./session-archive");
const { createTurnStore } = require("./turn-store");
const { loadBuiltInContentPack } = require("../content-v2/built-in-pack");
const { compileContentSnapshot } = require("../content-v2/snapshot-compiler");
const { readContentSnapshot } = require("../content-v2/snapshot-reader");
const { makeTreeWritable } = require("../content-v2/snapshot-utils");
const { initialState } = require("./test-fixtures/turn-samples");

const contentRoot = path.resolve(__dirname, "../../content");
const packPromise = loadBuiltInContentPack({ contentRoot });
const ATTACK = '<script>alert("story")</script><img src="https://evil.invalid/pixel" onerror="alert(1)"> [click](javascript:alert(1)) ![photo](https://evil.invalid/pixel) <https://evil.invalid> https://evil.invalid www.evil.invalid user@evil.invalid\n# forged heading\n```html\n<iframe src="https://evil.invalid"></iframe>\n```';

async function fixture(t, { language = "zh-CN", normalTurns = 43, inject = false, close = true, chapterMode = "model" } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-story-export-")));
  const adventuresRoot = path.join(root, "adventures");
  const outputRoot = path.join(root, "exports");
  await fs.mkdir(adventuresRoot); await fs.mkdir(outputRoot);
  const adventureId = "export-story";
  const pack = await packPromise;
  await compileContentSnapshot({ adventuresRoot, adventureId, language, plan: pack.defaultPlan,
    requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"],
    resolvePackRoot: (packId) => path.join(contentRoot, "packs", packId) });
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId });
  const databasePath = path.join(adventuresRoot, adventureId, "session.sqlite");
  const store = createTurnStore({ databasePath, adventureId, locale: language,
    contentVersion: snapshot.lock.overallHash, initialState: initialState() });
  t.after(async () => { store.close(); await makeTreeWritable(root); await fs.rm(root, { recursive: true, force: true }); });
  let chapterCount = 0;
  const history = [];
  function commit(revision, events = [], host = `HOSTTOKEN${revision} END`, player = `PLAYERTOKEN${revision} END`) {
    const narration = [{ id: `segment-${revision}`, text: host },
      ...(revision === 3 ? [{ id: `detail-${revision}`, text: `DETAILTOKEN${revision} END` }] : [])];
    const action = store.beginAction({ actionId: `turn-${revision}`, baseRevision: revision - 1,
      input: player, locale: language, contentVersion: snapshot.lock.overallHash });
    store.commitAction({ actionId: action.actionId, attemptId: action.attemptId,
      bundle: { narration, events, experiences: [] } });
    history.push({ revision, host: narration.map((segment) => segment.text).join("\n\n"), player });
  }
  function chapter(revision) {
    const job = store.beginChapter({ targetRevision: revision });
    store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: {
      title: `CHAPTERTOKEN${revision} END`, summary: inject ? ATTACK : `SUMMARYTOKEN${revision} END`,
      keyEvents: [{ text: `EVENTTOKEN${revision} END`, sources: [{ revision, segmentId: `segment-${revision}` },
        ...(revision === 3 ? [{ revision, segmentId: `detail-${revision}` }] : [])] }],
      openThreads: [], mode: chapterMode,
    } });
    chapterCount++;
  }
  for (let revision = 1; revision <= normalTurns; revision++) {
    commit(revision, [], inject && revision === 1 ? ATTACK : undefined, inject && revision === 1 ? ATTACK : undefined);
    if (revision % 3 === 0) chapter(revision);
  }
  const proposal = normalTurns + 1;
  const revision = normalTurns + 2;
  commit(proposal, [{ id: "offer", type: "finale.propose", sourceSegmentIds: [`segment-${proposal}`],
    data: { candidateId: "ordinary-end", closureReason: "秘密判断不应导出", closedThreads: ["同行结束。"], intentionalOpenThreads: [], finaleTone: "平静" } }]);
  commit(revision, [{ id: "confirm", type: "finale.confirm", sourceSegmentIds: [`segment-${revision}`], data: { candidateId: "ordinary-end" } }],
    { "zh-CN": "你们在晨光中道别。", "en-US": "You part in the morning light.", "ja-JP": "朝の光の中で別れを告げた。" }[language]);
  if (close) { chapter(revision); store.sealFinale({ finaleId: `finale-${revision}`, chapterId: `chapter-${revision}` }); }
  store.close();
  return { root, adventuresRoot, outputRoot, adventureId, databasePath, revision, chapterCount, history,
    reader: createSessionArchiveReader({ adventuresRoot }) };
}

async function evidence(file) {
  const stat = await fs.stat(file);
  return { hash: createHash("sha256").update(await fs.readFile(file)).digest("hex"), mode: stat.mode, size: stat.size, inode: stat.ino, mtime: stat.mtimeMs };
}

test("完整 HTML 与 Markdown 跨正文和章节分页正序导出，不重复、不修改源库", async (t) => {
  const env = await fixture(t);
  const before = await evidence(env.databasePath);
  const calls = [];
  const reader = { ...env.reader,
    async readHistory(input) { calls.push(input); return env.reader.readHistory(input); } };
  const exporter = createSessionStoryExporter({ reader });
  for (const format of ["html", "markdown"]) {
    const outputPath = path.join(env.outputRoot, `complete.${format === "html" ? "html" : "md"}`);
    await fs.writeFile(outputPath, "OLD TARGET");
    const result = await exporter.exportStory({ adventureId: env.adventureId, format, outputPath, storyTitle: "完整旅程" });
    assert.deepEqual(result, { ok: true, filename: path.basename(outputPath), turn_count: env.revision, chapter_count: env.chapterCount, format });
    const body = await fs.readFile(outputPath, "utf8");
    let at = -1;
    for (const turn of env.history) {
      const expectedHost = format === "markdown" ? turn.host.replace(/\n/g, "  \n") : turn.host;
      const position = body.indexOf(expectedHost, at + 1);
      assert.ok(position > at, `turn ${turn.revision} remains in chronological order`);
      assert.equal(body.indexOf(expectedHost, position + expectedHost.length), -1, "each original passage appears once");
      at = position;
      assert.ok(body.includes(turn.player));
    }
    assert.equal((body.match(/CHAPTERTOKEN\d+ END/g) || []).length, env.chapterCount);
    assert.ok(body.includes("来源: 第 3 回合"));
    assert.doesNotMatch(body, /segment-\d|detail-\d|第 3 回合; 第 3 回合/);
    assert.doesNotMatch(body, /OLD TARGET|秘密判断不应导出|尚未露面的访客|hidden_key/);
  }
  assert.ok(calls.length > 4);
  for (const input of calls) {
    assert.equal(input.revision, env.revision);
    assert.equal(input.beforeRevision.revision, env.revision);
    assert.equal(input.beforeRevision.adventureId, env.adventureId);
    assert.ok(input.limit <= 20);
  }
  assert.deepEqual(await evidence(env.databasePath), before);
  assert.deepEqual((await fs.readdir(env.outputRoot)).sort(), ["complete.html", "complete.md"]);
});

for (const [language, title, heading, playerLabel] of [
  ["zh-CN", "中文故事", "完整故事", "玩家"],
  ["en-US", "An English Story", "Complete story", "Player"],
  ["ja-JP", "日本語の物語", "物語の全文", "プレイヤー"],
]) {
  test(`${language} 导出保留标题、日期、回合和原始语言`, async (t) => {
    const env = await fixture(t, { language, normalTurns: 0, chapterMode: "excerpt" });
    const before = await evidence(env.databasePath);
    const exporter = createSessionStoryExporter({ reader: env.reader });
    for (const format of ["html", "markdown"]) {
      const outputPath = path.join(env.outputRoot, `locale.${format}`);
      await exporter.exportStory({ adventureId: env.adventureId, format, outputPath, storyTitle: title });
      const body = await fs.readFile(outputPath, "utf8");
      assert.ok(body.includes(title)); assert.ok(body.includes(heading)); assert.ok(body.includes(playerLabel));
      const expected = format === "markdown" ? env.history.at(-1).host.replace(/\./g, "\\.") : env.history.at(-1).host;
      assert.ok(body.includes(expected)); assert.match(body, /UTC/);
      assert.ok(body.includes({ "zh-CN": "来源: 第 2 回合", "en-US": "Sources: Turn 2", "ja-JP": "出典: 第 2 ターン" }[language]));
      assert.doesNotMatch(body, /segment-\d|detail-\d/);
      const excerptTitle = { "zh-CN": "原文摘录", "en-US": "Story excerpts", "ja-JP": "物語の抜粋" }[language];
      assert.ok(body.includes(format === "html" ? `<h3>${excerptTitle}</h3>` : `### ${excerptTitle}\n`));
      assert.doesNotMatch(body, /CHAPTERTOKEN2 END/, "excerpt mode uses a display title without interpreting the stored title");
      if (format === "html") assert.ok(body.includes(`<html lang="${language}">`));
      if (language === "en-US") assert.match(body, /Turn 2/);
      if (language === "ja-JP") assert.match(body, /第 2 ターン/);
    }
    assert.deepEqual(await evidence(env.databasePath), before);
    const page = await env.reader.readChapters({ adventureId: env.adventureId, revision: env.revision });
    assert.equal(page.chapters[0].title, "CHAPTERTOKEN2 END", "display changes do not rewrite stored chapters");
  });
}

test("HTML 注入、Markdown链接和裸网址只作为原文文本输出", async (t) => {
  const env = await fixture(t, { inject: true, normalTurns: 1 });
  const exporter = createSessionStoryExporter({ reader: env.reader });
  const outputPath = path.join(env.outputRoot, "safe.html");
  await exporter.exportStory({ adventureId: env.adventureId, format: "html", outputPath, storyTitle: '<img src=x onerror="alert(1)">' });
  const html = await fs.readFile(outputPath, "utf8");
  assert.match(html, /Content-Security-Policy/); assert.match(html, /default-src 'none'/); assert.match(html, /script-src 'none'/);
  assert.doesNotMatch(html, /<script|<img|<iframe|<a\s|onerror="alert/);
  assert.match(html, /&lt;script&gt;/); assert.match(html, /&quot;story&quot;/);
  const markdownPath = path.join(env.outputRoot, "safe.md");
  await exporter.exportStory({ adventureId: env.adventureId, format: "markdown", outputPath: markdownPath, storyTitle: "[title](javascript:alert(1))" });
  const markdown = await fs.readFile(markdownPath, "utf8");
  assert.doesNotMatch(markdown, /<script|<img|<iframe|javascript:|https:\/\/|www\.evil\.invalid|user@evil\.invalid|\n# forged|\n```/);
  assert.ok(markdown.includes("\\[click\\]\\(javascript&#58;alert\\(1\\)\\)"));
  assert.ok(markdown.includes("&lt;script&gt;")); assert.ok(markdown.includes("user&#64;evil\\.invalid"));
});

test("读取中途失败保留已有目标，清理仅本次临时文件", async (t) => {
  const env = await fixture(t);
  const outputPath = path.join(env.outputRoot, "existing.html");
  await fs.writeFile(outputPath, "EXISTING EXPORT");
  const before = await evidence(outputPath);
  const exporter = createSessionStoryExporter({ reader: { ...env.reader,
    async readChapters() { throw Object.assign(new Error("synthetic private database path"), { code: "ARCHIVE_STATE_UNAVAILABLE" }); } } });
  await assert.rejects(exporter.exportStory({ adventureId: env.adventureId, format: "html", outputPath }), { code: "ARCHIVE_STATE_UNAVAILABLE" });
  assert.deepEqual(await evidence(outputPath), before);
  assert.deepEqual(await fs.readdir(env.outputRoot), ["existing.html"]);
});

test("原子替换失败保留原文件并清理已写完的临时文件", async (t) => {
  const env = await fixture(t, { normalTurns: 0 });
  const outputPath = path.join(env.outputRoot, "existing.md");
  await fs.writeFile(outputPath, "ORIGINAL EXPORT");
  const before = await evidence(outputPath);
  t.mock.method(fs, "rename", async () => { throw Object.assign(new Error("synthetic rename failure"), { code: "EIO" }); });
  try {
    await assert.rejects(createSessionStoryExporter({ reader: env.reader }).exportStory({ adventureId: env.adventureId,
      format: "markdown", outputPath }), { code: "EXPORT_WRITE_FAILED" });
  } finally { t.mock.restoreAll(); }
  assert.deepEqual(await evidence(outputPath), before);
  assert.deepEqual(await fs.readdir(env.outputRoot), ["existing.md"]);
});

test("临时文件独占创建失败不会删除碰巧占用该路径的其它文件", async (t) => {
  const env = await fixture(t, { normalTurns: 0 });
  const outputPath = path.join(env.outputRoot, "existing.md");
  await fs.writeFile(outputPath, "ORIGINAL EXPORT");
  const realOpen = fs.open;
  let collision;
  t.mock.method(fs, "open", async (file, flags, ...args) => {
    if (flags === "wx") {
      collision = file;
      await fs.writeFile(file, "NOT OWNED BY THIS EXPORT");
      throw Object.assign(new Error("synthetic exclusive-open collision"), { code: "EEXIST" });
    }
    return realOpen(file, flags, ...args);
  });
  try {
    await assert.rejects(createSessionStoryExporter({ reader: env.reader }).exportStory({ adventureId: env.adventureId,
      format: "markdown", outputPath }), { code: "EXPORT_WRITE_FAILED" });
  } finally { t.mock.restoreAll(); }
  assert.equal(await fs.readFile(collision, "utf8"), "NOT OWNED BY THIS EXPORT");
  assert.equal(await fs.readFile(outputPath, "utf8"), "ORIGINAL EXPORT");
});

test("缺页、跨版本与两遍读取内容变化都不能产生不完整的新目标", async (t) => {
  const env = await fixture(t, { normalTurns: 22 });
  for (const mode of ["gap", "revision", "changed", "invalid-source"]) {
    let calls = 0;
    const reader = { ...env.reader, async open(input) {
      const opened = await env.reader.open(input);
      if (mode === "invalid-source") opened.chapterPage.chapters[0].sources.key_events[0].sources[0].segmentId = "invalid segment ID";
      return opened;
    }, async readHistory(input) {
      const page = await env.reader.readHistory(input); calls++;
      if (mode === "gap") page.history.shift();
      if (mode === "revision") page.revision++;
      if (mode === "changed" && calls === 2) page.history[0].host += "changed";
      return page;
    } };
    const outputPath = path.join(env.outputRoot, `${mode}.md`);
    await assert.rejects(createSessionStoryExporter({ reader }).exportStory({ adventureId: env.adventureId, format: "markdown", outputPath }), { code: "EXPORT_SOURCE_INVALID" });
    await assert.rejects(fs.stat(outputPath), { code: "ENOENT" });
    assert.deepEqual(await fs.readdir(env.outputRoot), []);
  }
});

test("源目录、链接和非普通目标拒绝写入，不跟随目标链接", async (t) => {
  const env = await fixture(t, { normalTurns: 0 });
  const exporter = createSessionStoryExporter({ reader: env.reader });
  const before = await evidence(env.databasePath);
  for (const outputPath of [env.databasePath, path.join(env.adventuresRoot, env.adventureId, "content-snapshot", "new.html")]) {
    await assert.rejects(exporter.exportStory({ adventureId: env.adventureId, format: "html", outputPath }), { code: "EXPORT_SOURCE_PROTECTED" });
  }
  const target = path.join(env.outputRoot, "existing.txt"); await fs.writeFile(target, "DO NOT CHANGE");
  const link = path.join(env.outputRoot, "link.html"); await fs.symlink(target, link);
  await assert.rejects(exporter.exportStory({ adventureId: env.adventureId, format: "html", outputPath: link }), { code: "EXPORT_PATH_INVALID" });
  const parentLink = path.join(env.root, "output-link"); await fs.symlink(env.outputRoot, parentLink);
  await assert.rejects(exporter.exportStory({ adventureId: env.adventureId, format: "html", outputPath: path.join(parentLink, "new.html") }), { code: "EXPORT_PATH_INVALID" });
  await assert.rejects(exporter.exportStory({ adventureId: env.adventureId, format: "html", outputPath: env.outputRoot }), { code: "EXPORT_PATH_INVALID" });
  assert.equal(await fs.readFile(target, "utf8"), "DO NOT CHANGE");
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
  assert.deepEqual(await evidence(env.databasePath), before);
});

test("写入期间目标被另一个操作修改时，不覆盖它的新内容", async (t) => {
  const env = await fixture(t, { normalTurns: 0 });
  const outputPath = path.join(env.outputRoot, "changed.md"); await fs.writeFile(outputPath, "OLD");
  const reader = { ...env.reader, async readHistory(input) {
    await fs.writeFile(outputPath, "EXTERNAL CHANGE"); return env.reader.readHistory(input);
  } };
  await assert.rejects(createSessionStoryExporter({ reader }).exportStory({ adventureId: env.adventureId, format: "markdown", outputPath }), { code: "EXPORT_TARGET_CHANGED" });
  assert.equal(await fs.readFile(outputPath, "utf8"), "EXTERNAL CHANGE");
  assert.deepEqual(await fs.readdir(env.outputRoot), ["changed.md"]);
});

test("未封存档案、缺失保护根和请求accessor不能触发导出", async (t) => {
  const env = await fixture(t, { normalTurns: 0, close: false });
  const outputPath = path.join(env.outputRoot, "no.html");
  await assert.rejects(createSessionStoryExporter({ reader: env.reader }).exportStory({ adventureId: env.adventureId, format: "html", outputPath }), { code: "ARCHIVE_NOT_CLOSED" });
  let read = 0; let getter = 0;
  const reader = { open() { read++; }, readHistory() {}, readChapters() {} };
  const request = { adventureId: env.adventureId, format: "html" };
  Object.defineProperty(request, "outputPath", { enumerable: true, get() { getter++; return outputPath; } });
  await assert.rejects(createSessionStoryExporter({ reader }).exportStory(request), { code: "EXPORT_INPUT_INVALID" });
  assert.equal(read, 0); assert.equal(getter, 0);
  const closed = await fixture(t, { normalTurns: 0 });
  const missingRoot = { ...closed.reader, async open(input) { const opened = await closed.reader.open(input); delete opened.readOnlyRoot; return opened; } };
  await assert.rejects(createSessionStoryExporter({ reader: missingRoot }).exportStory({ adventureId: closed.adventureId, format: "html", outputPath }), { code: "EXPORT_SOURCE_INVALID" });
  assert.deepEqual(await fs.readdir(env.outputRoot), []);
});
