"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const PAGE_SIZE = 20;
const PAGE_CHARACTERS = 8_000_000;
const SAFE_ERRORS = new Set(["EXPORT_INPUT_INVALID", "EXPORT_PATH_INVALID", "EXPORT_SOURCE_PROTECTED",
  "EXPORT_TARGET_CHANGED", "EXPORT_SOURCE_INVALID", "EXPORT_WRITE_FAILED", "ARCHIVE_NOT_CLOSED",
  "ARCHIVE_REVISION_MISMATCH", "ARCHIVE_RECOVERY_REQUIRED", "ARCHIVE_STATE_UNAVAILABLE",
  "ARCHIVE_PAGE_TOO_LARGE", "HISTORY_PAGE_TOO_LARGE", "CHAPTER_PAGE_TOO_LARGE", "SAVE_PATH_INVALID",
  "SAVE_IDENTITY_MISMATCH", "SAVE_FORMAT_UNSUPPORTED", "SAVE_ACCESS_DENIED", "STORE_BUSY"]);
const COPY = {
  "zh-CN": { title: "故事档案", story: "完整故事", chapters: "章节回顾", player: "玩家", host: "灰鸦",
    continuation: "续篇开始",
    world: "世界", created: "创建时间", closed: "最后更新时间", events: "重要事件", open: "保留的线索",
    source: "来源", excerpt: "原文摘录回顾", excerptTitle: "原文摘录",
    turn: (n) => `第 ${n} 回合`, range: (a, b) => `第 ${a}–${b} 回合` },
  "en-US": { title: "Story archive", story: "Complete story", chapters: "Chapter reviews", player: "Player", host: "Grey Crow",
    continuation: "Continuation Begins",
    world: "World", created: "Created", closed: "Last updated", events: "Key events", open: "Open threads",
    source: "Sources", excerpt: "Original passage excerpts", excerptTitle: "Story excerpts",
    turn: (n) => `Turn ${n}`, range: (a, b) => `Turns ${a}–${b}` },
  "ja-JP": { title: "物語の記録", story: "物語の全文", chapters: "章の振り返り", player: "プレイヤー", host: "灰鴉",
    continuation: "続編の始まり",
    world: "世界", created: "作成日時", closed: "更新日時", events: "主な出来事", open: "残された手がかり",
    source: "出典", excerpt: "原文からの抜粋", excerptTitle: "物語の抜粋",
    turn: (n) => `第 ${n} ターン`, range: (a, b) => `第 ${a}–${b} ターン` },
};

function failure(code) { return Object.assign(new Error(code), { code }); }
function requireValue(condition, code = "EXPORT_SOURCE_INVALID") { if (!condition) throw failure(code); }
function fields(value, required, optional = []) {
  requireValue(value && [Object.prototype, null].includes(Object.getPrototypeOf(value)), "EXPORT_INPUT_INVALID");
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(allowed.has(key) && descriptor?.enumerable && Object.hasOwn(descriptor, "value"), "EXPORT_INPUT_INVALID");
  }
  requireValue(required.every((key) => Object.hasOwn(value, key)), "EXPORT_INPUT_INVALID");
}
function within(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function validText(value) { return typeof value === "string" && value.trim().length > 0; }
function integer(value, minimum = 0) { return Number.isSafeInteger(value) && value >= minimum; }
function html(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function markdown(value) {
  // Entities cannot become Markdown syntax or raw HTML tags. Escaping colons
  // and @ also prevents GFM's bare URL/email autolinks from user-authored text.
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~\-]/g, "\\$&").replace(/:/g, "&#58;").replace(/@/g, "&#64;")
    .replace(/\r\n|\r/g, "\n").replace(/\n/g, "  \n");
}

async function lstatMaybe(file) {
  try { return await fs.lstat(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function directoryChain(directory) {
  let current = directory;
  while (true) {
    const stat = await fs.lstat(current);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), "EXPORT_PATH_INVALID");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fs.lstat(directory);
}
function targetStamp(stat) {
  return stat ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : null;
}
async function inspectTarget(outputPath, sourceRoot) {
  requireValue(typeof sourceRoot === "string" && path.isAbsolute(sourceRoot), "EXPORT_SOURCE_INVALID");
  const target = path.resolve(outputPath);
  const protectedRoot = path.resolve(sourceRoot);
  requireValue(!within(protectedRoot, target), "EXPORT_SOURCE_PROTECTED");
  const parent = path.dirname(target);
  const parentStat = await directoryChain(parent);
  const actualParent = await fs.realpath(parent);
  const actualRoot = await fs.realpath(protectedRoot);
  requireValue(!within(actualRoot, path.join(actualParent, path.basename(target))), "EXPORT_SOURCE_PROTECTED");
  const existing = await lstatMaybe(target);
  requireValue(!existing || (existing.isFile() && !existing.isSymbolicLink()), "EXPORT_PATH_INVALID");
  return { target, parent, parentDevice: parentStat.dev, parentInode: parentStat.ino, original: targetStamp(existing) };
}
async function checkDestination(destination) {
  const parent = await directoryChain(destination.parent);
  requireValue(parent.dev === destination.parentDevice && parent.ino === destination.parentInode, "EXPORT_TARGET_CHANGED");
  const current = await lstatMaybe(destination.target);
  requireValue(!current || (current.isFile() && !current.isSymbolicLink()), "EXPORT_TARGET_CHANGED");
  requireValue(targetStamp(current) === destination.original, "EXPORT_TARGET_CHANGED");
}

function metadata(opened, adventureId) {
  const view = opened?.projection;
  requireValue(view?.adventureId === adventureId && integer(view.revision, 1));
  requireValue(opened.archive?.read_only === true && opened.archive.mode === "archive"
    && opened.storyFinale?.adventureId === adventureId && opened.storyFinale.revision === view.revision
    && opened.storyFinale.projection?.phase === "closed", "ARCHIVE_NOT_CLOSED");
  requireValue(view.save?.adventureId === adventureId && view.save.revision === view.revision);
  const language = view.save.adventureLocale;
  requireValue(Object.hasOwn(COPY, language) && opened.lockedContent?.language === language);
  const timeline = opened.timeline ?? view.timeline ?? { storyTurnCount: view.revision, systemRevisions: [] };
  requireValue(timeline && integer(timeline.storyTurnCount, 1) && Array.isArray(timeline.systemRevisions));
  let previous = 0;
  for (const revision of timeline.systemRevisions) {
    requireValue(integer(revision, 1) && revision > previous && revision < view.revision);
    previous = revision;
  }
  requireValue(Object.keys(timeline).every((key) => ["storyTurnCount", "systemRevisions"].includes(key))
    && timeline.storyTurnCount + timeline.systemRevisions.length === view.revision);
  return { adventureId, revision: view.revision, language, copy: COPY[language], save: view.save,
    world: opened.lockedContent?.world?.title, sourceRoot: opened.readOnlyRoot,
    timeline: structuredClone(timeline), system: new Set(timeline.systemRevisions) };
}
function pageIdentity(page, meta) {
  requireValue(page?.adventureId === meta.adventureId && page.revision === meta.revision);
  if (page.timeline !== undefined) requireValue(JSON.stringify(page.timeline) === JSON.stringify(meta.timeline));
}
function nextStoryRevision(meta, revision) {
  while (meta.system.has(revision)) revision++;
  return revision;
}
function storyTurn(meta, revision) {
  return revision - meta.timeline.systemRevisions.filter((boundary) => boundary <= revision).length;
}
function checkHistory(page, meta, before) {
  pageIdentity(page, meta);
  requireValue(Array.isArray(page.history) && page.history.length > 0 && page.history.length <= PAGE_SIZE);
  let expected = page.history[0]?.revision;
  requireValue(integer(expected, 1) && !meta.system.has(expected));
  const first = expected;
  for (const turn of page.history) {
    requireValue(turn.adventureId === meta.adventureId && turn.revision === expected && turn.seq === storyTurn(meta, expected)
      && typeof turn.actionId === "string" && ID.test(turn.actionId) && turn.kind === "turn"
      && typeof turn.player === "string" && validText(turn.host));
    if (turn.storyTurn !== undefined) requireValue(turn.storyTurn === storyTurn(meta, turn.revision));
    if (turn.source !== undefined) requireValue(ID.test(turn.source?.adventureId || "") && turn.source.revision === turn.revision);
    expected = nextStoryRevision(meta, expected + 1);
  }
  requireValue(expected === before && first < before);
  const cursor = page.nextBeforeRevision ?? null;
  requireValue(page.complete === (first === nextStoryRevision(meta, 1)));
  if (page.complete) requireValue(cursor === null);
  else requireValue(cursor?.adventureId === meta.adventureId && cursor.revision === meta.revision && cursor.beforeRevision === first);
  return { before, first, complete: page.complete, count: page.history.length, digest: hash(page.history) };
}

function createSessionStoryExporter({ reader } = {}) {
  if (["open", "readHistory", "readChapters"].some((key) => typeof reader?.[key] !== "function")) {
    throw new TypeError("An archive reader is required");
  }

  async function exportStory(input) {
    let temporary;
    let handle;
    try {
      fields(input, ["adventureId", "format", "outputPath"], ["storyTitle"]);
      requireValue(typeof input.adventureId === "string" && ID.test(input.adventureId)
        && ["html", "markdown"].includes(input.format) && typeof input.outputPath === "string"
        && path.isAbsolute(input.outputPath) && !input.outputPath.includes("\0")
        && (input.storyTitle === undefined || (validText(input.storyTitle) && input.storyTitle.length <= 1024)), "EXPORT_INPUT_INVALID");
      const { adventureId, format, outputPath, storyTitle } = input;
      const opened = await reader.open({ adventureId, limit: PAGE_SIZE, maxCharacters: PAGE_CHARACTERS });
      const meta = metadata(opened, adventureId);
      const destination = await inspectTarget(outputPath, meta.sourceRoot);
      const options = { adventureId, revision: meta.revision, limit: PAGE_SIZE, maxCharacters: PAGE_CHARACTERS };
      const readPage = (before) => reader.readHistory({ ...options,
        beforeRevision: { adventureId, revision: meta.revision, beforeRevision: before } });
      let page = { adventureId, revision: meta.revision, history: opened.projection.history,
        nextBeforeRevision: opened.projection.historyNextBeforeRevision, complete: opened.projection.historyComplete };
      const pages = [];
      let before = meta.revision + 1;
      while (true) {
        const descriptor = checkHistory(page, meta, before);
        pages.push(descriptor);
        if (descriptor.complete) break;
        before = descriptor.first;
        page = await readPage(before);
      }
      // Retain only small descriptors and hashes; the original prose is read a
      // second time in ascending order, one bounded page at a time.
      page = null;
      const chapterPages = [];
      let chapterPage = opened.chapterPage;
      let chapterCursor;
      let chapterState = { end: 0 };
      const chapterIds = new Set();
      while (true) {
        const prior = { ...chapterState };
        chapterState = checkChapterPage(chapterPage, meta, chapterState, chapterIds);
        chapterPages.push({ cursor: chapterCursor, before: prior, after: { ...chapterState },
          count: chapterPage.chapters.length, digest: hash(chapterPage) });
        if (chapterPage.complete) break;
        chapterCursor = chapterPage.nextCursor;
        chapterPage = await reader.readChapters({ adventureId, revision: meta.revision, cursor: chapterCursor, limit: PAGE_SIZE });
      }
      chapterPage = null;
      const candidateTemporary = path.join(destination.parent, `.grey-crow-export-${randomUUID()}.tmp`);
      handle = await fs.open(candidateTemporary, "wx", 0o600);
      // An EEXIST failure does not give us ownership of the colliding path.
      // Only a successfully created temporary file may be cleaned up below.
      temporary = candidateTemporary;
      const write = async (text) => {
        const buffer = Buffer.from(text, "utf8");
        let offset = 0;
        while (offset < buffer.length) {
          const result = await handle.write(buffer, offset, buffer.length - offset);
          requireValue(result.bytesWritten > 0, "EXPORT_WRITE_FAILED");
          offset += result.bytesWritten;
        }
      };
      const render = formatter(format, meta, storyTitle);
      await write(render.header());
      let turnCount = 0;
      for (const descriptor of pages.reverse()) {
        const history = await readPage(descriptor.before);
        const repeated = checkHistory(history, meta, descriptor.before);
        requireValue(isDeepStrictEqual(repeated.first, descriptor.first) && repeated.count === descriptor.count && repeated.digest === descriptor.digest);
        for (const turn of history.history) { await write(render.turn(turn)); turnCount++; }
      }
      requireValue(turnCount === meta.timeline.storyTurnCount);
      await write(render.chapterHeader());
      let chapterCount = 0;
      const repeatedChapterIds = new Set();
      for (const descriptor of chapterPages) {
        const repeated = await reader.readChapters({ adventureId, revision: meta.revision, limit: descriptor.count,
          ...(descriptor.cursor === undefined ? {} : { cursor: descriptor.cursor }) });
        const repeatedState = checkChapterPage(repeated, meta, descriptor.before, repeatedChapterIds);
        requireValue(isDeepStrictEqual(repeatedState, descriptor.after) && repeated.chapters.length === descriptor.count
          && hash(repeated) === descriptor.digest);
        for (const chapter of repeated.chapters) { await write(render.chapter(chapter)); chapterCount++; }
      }
      await write(render.footer());
      await handle.sync();
      await handle.close(); handle = null;
      await checkDestination(destination);
      await fs.rename(temporary, destination.target);
      temporary = null;
      return { ok: true, filename: path.basename(destination.target), turn_count: turnCount, chapter_count: chapterCount, format };
    } catch (error) {
      throw failure(SAFE_ERRORS.has(error?.code) ? error.code : "EXPORT_WRITE_FAILED");
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (temporary) await fs.unlink(temporary).catch(() => {});
    }
  }
  return Object.freeze({ exportStory });
}

function checkChapter(chapter, meta, previousEnd) {
  requireValue(chapter?.adventureId === meta.adventureId && chapter.revision === meta.revision
    && typeof chapter.chapter_id === "string" && ID.test(chapter.chapter_id)
    && validText(chapter.title) && validText(chapter.summary)
    && integer(chapter.turn_range?.start, 1) && integer(chapter.turn_range?.end, chapter.turn_range.start)
    && chapter.turn_range.end <= meta.revision && !meta.system.has(chapter.turn_range.start) && !meta.system.has(chapter.turn_range.end)
    && (previousEnd === 0 || chapter.turn_range.start === nextStoryRevision(meta, previousEnd + 1))
    && ["model", "excerpt"].includes(chapter.generation?.mode));
  for (const kind of ["key_events", "open_threads"]) {
    const entries = chapter.sources?.[kind];
    requireValue(Array.isArray(entries) && Array.isArray(chapter[kind]) && entries.length === chapter[kind].length);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      requireValue(validText(entry.text) && entry.text === chapter[kind][i] && Array.isArray(entry.sources) && entry.sources.length > 0);
      for (const source of entry.sources) requireValue(integer(source.revision, chapter.turn_range.start)
        && source.revision <= chapter.turn_range.end && !meta.system.has(source.revision)
        && typeof source.segmentId === "string" && ID.test(source.segmentId)
        && (source.source === undefined || (ID.test(source.source?.adventureId || "") && source.source.revision === source.revision)));
    }
  }
}

function checkChapterPage(page, meta, previous, seen) {
  pageIdentity(page, meta);
  requireValue(Array.isArray(page.chapters) && page.chapters.length > 0 && page.chapters.length <= PAGE_SIZE);
  const next = { ...previous };
  for (const chapter of page.chapters) {
    requireValue(!seen.has(chapter.chapter_id));
    checkChapter(chapter, meta, next.end);
    next.end = chapter.turn_range.end;
    seen.add(chapter.chapter_id);
  }
  const cursor = page.nextCursor ?? null;
  requireValue(typeof page.complete === "boolean" && page.complete === (cursor === null));
  if (page.complete) requireValue(next.end === meta.revision);
  else requireValue(isDeepStrictEqual(cursor, { adventureId: meta.adventureId, revision: meta.revision,
    afterToRevision: next.end, throughToRevision: meta.revision }) && next.end < meta.revision);
  return next;
}

function formatter(format, meta, title) {
  const { copy, language, save } = meta;
  const escape = format === "html" ? html : markdown;
  const turnTitle = (turn) => copy.turn(storyTurn(meta, turn.revision));
  const heading = title ?? (validText(save.title) ? save.title : copy.title);
  const date = (value) => {
    if (value == null) return null;
    requireValue(typeof value === "string" && Number.isFinite(Date.parse(value)));
    return `${new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
  };
  const details = [[copy.world, validText(meta.world) ? meta.world : null], [copy.created, date(save.createdAt)], [copy.closed, date(save.updatedAt)]]
    .filter(([, value]) => value !== null);
  const references = (entry) => [...new Set(entry.sources.map((source) => storyTurn(meta, source.revision)))].map(copy.turn).join("; ");
  const chapterRange = (chapter) => copy.range(storyTurn(meta, chapter.turn_range.start), storyTurn(meta, chapter.turn_range.end));
  const chapterTitle = (chapter) => chapter.generation.mode === "excerpt" ? copy.excerptTitle : chapter.title;
  if (format === "markdown") return {
    header: () => `# ${escape(heading)}\n\n${details.map(([label, value]) => `${escape(label)}: ${escape(value)}\n\n`).join("")}## ${copy.story}\n\n`,
    turn: (turn) => (meta.system.has(turn.revision - 1) ? `---\n\n**${copy.continuation}**\n\n` : "")
      + `### ${turnTitle(turn)}\n\n**${copy.player}**\n\n${escape(turn.player)}\n\n**${copy.host}**\n\n${escape(turn.host)}\n\n`,
    chapterHeader: () => `## ${copy.chapters}\n\n`,
    chapter: (chapter) => `### ${escape(chapterTitle(chapter))}\n\n${chapterRange(chapter)}\n\n`
      + (chapter.createdAt ? `${copy.created}: ${escape(date(chapter.createdAt))}\n\n` : "")
      + (chapter.generation.mode === "excerpt" ? `${copy.excerpt}\n\n` : "") + `${escape(chapter.summary)}\n\n`
      + [["key_events", copy.events], ["open_threads", copy.open]].map(([kind, label]) => chapter.sources[kind].length
        ? `#### ${label}\n\n${chapter.sources[kind].map((entry) => `- ${escape(entry.text)} (${copy.source}: ${escape(references(entry, chapter))})\n`).join("")}\n` : "").join(""),
    footer: () => "",
  };
  return {
    header: () => `<!doctype html>\n<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; media-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(heading)}</title><style>body{max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.75;color:#242424;background:#faf8f3;font-family:system-ui,sans-serif}p,li{white-space:pre-wrap;overflow-wrap:anywhere}article{padding:1rem 0;border-bottom:1px solid #ddd}small{color:#555}h1,h2,h3{overflow-wrap:anywhere}</style></head><body><main><h1>${escape(heading)}</h1>${details.map(([label, value]) => `<p>${escape(label)}: ${escape(value)}</p>`).join("")}<section><h2>${copy.story}</h2>\n`,
    turn: (turn) => (meta.system.has(turn.revision - 1) ? `<p class="continuation-divider">${copy.continuation}</p>\n` : "")
      + `<article id="turn-${turn.revision}"><h3>${turnTitle(turn)}</h3><h4>${copy.player}</h4><p>${escape(turn.player)}</p><h4>${copy.host}</h4><p>${escape(turn.host)}</p></article>\n`,
    chapterHeader: () => `</section><section><h2>${copy.chapters}</h2>\n`,
    chapter: (chapter) => `<article><h3>${escape(chapterTitle(chapter))}</h3><p>${chapterRange(chapter)}</p>`
      + (chapter.createdAt ? `<p>${copy.created}: ${escape(date(chapter.createdAt))}</p>` : "")
      + (chapter.generation.mode === "excerpt" ? `<p>${copy.excerpt}</p>` : "") + `<p>${escape(chapter.summary)}</p>`
      + [["key_events", copy.events], ["open_threads", copy.open]].map(([kind, label]) => chapter.sources[kind].length
        ? `<h4>${label}</h4><ul>${chapter.sources[kind].map((entry) => `<li>${escape(entry.text)}<br><small>${copy.source}: ${escape(references(entry, chapter))}</small></li>`).join("")}</ul>` : "").join("") + "</article>\n",
    footer: () => "</section></main></body></html>\n",
  };
}

module.exports = { createSessionStoryExporter };
