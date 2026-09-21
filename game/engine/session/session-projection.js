"use strict";

const { createHash } = require("node:crypto");
const { resolveSkillLocaleView, applySkillModulePresentation } = require("../content-v2/skill-locale-resolver");
const { MEMORY_FRAGMENT_PANEL, projectMemoryFragmentDescriptor, projectMemoryFragmentPanel,
  projectMemoryFragmentModule } = require("./session-memory-fragment-projection");

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const CHARACTER_PANEL = "session_characters";
const INVENTORY_PANEL = "session_inventory";
// Bound a complete detail reply independently of the larger session IPC cap.
// Long records reduce the page size; they are never silently dropped.
const DETAIL_MAX_CHARACTERS = 128_000;
const DETAIL_MAX_BYTES = 384_000;
const DETAIL_RECORD_MAX_CHARACTERS = 6000;
// A valid state has at most 200k JSON nodes and 4M text characters. Even one
// record per array entry, extra roughly 3000-character chunks and 10k commitments
// remain below this native-detail bound. Other panel counts stay at 10k.
const DETAIL_MAX_RECORDS = 250_000;
const DETAIL_LAYOUT = "open-first-interleaved-1";
const DISCOVERY_PANEL = "session_grey_crow_echo";
const EXTREME_OUTCOMES = ["grey_crow_view", "standard_extreme_ending"];
const DISCOVERY_COPY = {
  "zh-CN": "你已在这段故事中听见灰鸦的余响。",
  "en-US": "You have heard the Grey Crow's echo in this story.",
  "ja-JP": "この物語で、灰鴉の残響を聞きました。",
};
const TERMINAL_NOTICE = {
  "zh-CN": "结局正文尚未完成。可以继续完成，故事结果不会重新选择。",
  "en-US": "The ending's narration is unfinished. Resume it without choosing the story outcome again.",
  "ja-JP": "結末の本文はまだ完成していません。物語の結果を選び直さずに、続きを完成できます。",
};
const COPY = {
  "zh-CN": { characters: "人物", inventory: "物品", characterGuide: "查看你已知的人物与当前约定。", inventoryGuide: "查看你当前持有的物品。", currentAdventure: "当前冒险", known: "已知人物", kinds: "物品种类", identity: "人物信息", item: "物品信息", aliases: "别名", quantity: "数量", commitments: "约定", due: "期限", open: "尚待履行", fulfilled: "已履行", cancelled: "已取消", creating: "正在创建角色", awaiting_confirmation: "等待开局确认", ready: "冒险进行中", status: "状态", description: "描述", relationship: "关系", occupation: "身份", age: "年龄", condition: "状况", health: "健康", injuries: "伤势", hunger: "饥饿", thirst: "口渴", fatigue: "疲劳", mood: "心情" },
  "en-US": { characters: "Characters", inventory: "Items", characterGuide: "View characters you know and current commitments.", inventoryGuide: "View the items you currently carry.", currentAdventure: "Current adventure", known: "Known characters", kinds: "Item types", identity: "Character details", item: "Item details", aliases: "Aliases", quantity: "Quantity", commitments: "Commitments", due: "Due", open: "Open", fulfilled: "Fulfilled", cancelled: "Cancelled", creating: "Creating your character", awaiting_confirmation: "Waiting for opening confirmation", ready: "Adventure in progress", status: "Status", description: "Description", relationship: "Relationship", occupation: "Occupation", age: "Age", condition: "Condition", health: "Health", injuries: "Injuries", hunger: "Hunger", thirst: "Thirst", fatigue: "Fatigue", mood: "Mood" },
  "ja-JP": { characters: "人物", inventory: "所持品", characterGuide: "知っている人物と現在の約束を確認します。", inventoryGuide: "現在持っている品物を確認します。", currentAdventure: "現在の冒険", known: "既知の人物", kinds: "所持品の種類", identity: "人物の情報", item: "品物の情報", aliases: "別名", quantity: "数量", commitments: "約束", due: "期限", open: "未履行", fulfilled: "履行済み", cancelled: "取り消し済み", creating: "キャラクター作成中", awaiting_confirmation: "開始内容の確認待ち", ready: "冒険進行中", status: "状態", description: "説明", relationship: "関係", occupation: "職業", age: "年齢", condition: "状態", health: "健康", injuries: "負傷", hunger: "空腹", thirst: "喉の渇き", fatigue: "疲労", mood: "気分" },
};
const CONDITION_COPY = {
  "zh-CN": { selfReport: "自述：", unknown: "尚未确认", count: (count) => `${count} 项身体状况，查看详情` },
  "en-US": { selfReport: "Self-reported: ", unknown: "Not yet confirmed", count: (count) => `${count} bodily conditions; see details` },
  "ja-JP": { selfReport: "本人申告：", unknown: "未確認", count: (count) => `${count}件の身体状態。詳細を確認` },
};
const DETAIL_TEXT_COPY = {
  "zh-CN": { title: "完整文字（分段阅读）", recordCount: "文字分段", characterCount: "原文字符", viewDetails: "查看完整详情", empty: "空白项",
    part: (label, index, total, item) => `${label}${item === null ? "" : ` · 第${item}项`} · 第${index}/${total}段` },
  "en-US": { title: "Full text (in parts)", recordCount: "Text parts", characterCount: "Original characters", viewDetails: "View full details", empty: "Blank entry",
    part: (label, index, total, item) => `${label}${item === null ? "" : ` · Entry ${item}`} · Part ${index}/${total}` },
  "ja-JP": { title: "全文（分割表示）", recordCount: "テキストの分割数", characterCount: "原文の文字数", viewDetails: "詳細をすべて見る", empty: "空白の項目",
    part: (label, index, total, item) => `${label}${item === null ? "" : ` · ${item}番目の項目`} · ${index}/${total}分割` },
};
const COMMITMENT_COPY = {
  "zh-CN": { open: "当前约定", history: "历史约定", count: "约定数量" },
  "en-US": { open: "Current commitments", history: "Past commitments", count: "Commitment count" },
  "ja-JP": { open: "現在の約束", history: "過去の約束", count: "約束の件数" },
};
const LEGACY_CONDITION_ATTRIBUTES = new Set(["status", "condition", "health", "injuries", "hunger", "thirst", "fatigue"]);
const FINALE_NOTICE = {
  "zh-CN": {
    finalizing: "结局已确认，正在封存章节。",
    recovery_required: "结局已确认，章节封存尚未完成。可以继续封存，已保存的故事不会重新执行。",
    closed: "故事已封存，可以阅读正文与章节记录。",
  },
  "en-US": {
    finalizing: "The ending is confirmed. The final chapter is being archived.",
    recovery_required: "The ending is confirmed, but chapter archiving is unfinished. Resume archiving without replaying the saved story.",
    closed: "The story is archived. Its narrative and chapters remain available to read.",
  },
  "ja-JP": {
    finalizing: "結末が確認されました。最終章を保存しています。",
    recovery_required: "結末は確認済みですが、章の保存が完了していません。保存済みの物語を再実行せずに、保存を再開できます。",
    closed: "物語の保存が完了しました。本文と章の記録を読むことができます。",
  },
};

function fail(code = "SESSION_PROJECTION_INVALID") {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function text(value) { return typeof value === "string" && value.trim() ? value : null; }
function clip(value, maximum) {
  const source = text(value);
  if (!source || source.length <= maximum) return source;
  return `${source.slice(0, maximum - 1)}…`;
}
function locale(value) {
  if (/^zh(?:-|$)/i.test(value)) return "zh-CN";
  if (/^en(?:-|$)/i.test(value)) return "en-US";
  if (/^ja(?:-|$)/i.test(value)) return "ja-JP";
  fail("SESSION_LOCALE_UNSUPPORTED");
}
function localized(value, language) {
  if (typeof value === "string") return text(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return text(value[language]) || text(value[language.split("-")[0]]);
}
function hash(values) { return createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 32); }
function identity(view) { return { adventureId: view.adventureId, revision: view.revision, actionId: view.actionId }; }

// Store/model validation proves provenance. Player projections share only the
// display text; source coordinates, record identities and predecessor data stay private.
function characterCondition(entity, language) {
  const attributes = entity?.attributes || {};
  if (!entity || !Object.hasOwn(entity, "conditionRecords")) {
    const status = text(attributes.status);
    return { authoritative: false, status: status || "unknown",
      label: status || localized(attributes.localizedStatus || attributes.localized_status, language), entries: [] };
  }
  const records = entity.conditionRecords;
  if (!records || records.format !== "body-conditions-1" || !Array.isArray(records.items) || records.items.length > 32) fail();
  const copy = CONDITION_COPY[language];
  const entries = records.items.map((record) => {
    if (!record || record.characterId !== entity.id || !["observed", "self_report"].includes(record.basis)
      || !text(record.text) || record.text.length > 120) fail();
    return `${record.basis === "self_report" ? copy.selfReport : ""}${record.text}`;
  });
  const label = entries.length ? entries.join("；") : copy.unknown;
  return { authoritative: true, status: entries.length ? label : "unknown", label, entries,
    listLabel: label.length <= 240 ? label : copy.count(entries.length) };
}

// Resolve labels from the adventure's immutable content, separately from the
// language of its story. This is shared by writable play and offline archives.
function resolveSessionMemoryFragmentSkill(snapshot, displayLocale = snapshot.profile.language) {
  if (!snapshot.profile.skills.some((skill) => skill.packId === "grey-crow-default" && skill.itemId === "memory-fragment")) return null;
  const language = locale(displayLocale);
  const resolved = resolveSkillLocaleView(snapshot, { gameLocale: language, localeRevision: `session_panel_${language}` });
  const skill = resolved.skills.find((entry) => entry.packId === "grey-crow-default" && entry.itemId === "memory-fragment");
  const moduleRef = skill?.panel?.moduleRef;
  const module = snapshot.content.skills.find((entry) => entry.module?.moduleRef === moduleRef)?.module;
  if (!skill || !moduleRef || !module?.definition) fail("SESSION_PROJECTION_INVALID");
  return { packId: skill.packId, itemId: skill.itemId, moduleRef, title: skill.title,
    packTitle: skill.panel.packTitle || skill.packId, description: skill.description,
    playerGuide: skill.playerGuide, triggers: [...skill.triggers], ownership: skill.ownership,
    language, definition: applySkillModulePresentation(module.definition, skill.modulePresentation) };
}

function publicTimeline(view) {
  const value = view.timeline ?? { storyTurnCount: view.revision, systemRevisions: [] };
  if (!Number.isSafeInteger(value.storyTurnCount) || value.storyTurnCount < 0 || !Array.isArray(value.systemRevisions)) fail();
  let previous = 0;
  for (const revision of value.systemRevisions) {
    if (!Number.isSafeInteger(revision) || revision <= previous || revision > view.revision) fail();
    previous = revision;
  }
  if (Object.keys(value).some((key) => !["storyTurnCount", "systemRevisions"].includes(key))
    || value.storyTurnCount !== view.revision - value.systemRevisions.length) fail();
  return { storyTurnCount: value.storyTurnCount, systemRevisions: [...value.systemRevisions] };
}

function publicContinuation(view, timeline) {
  const value = view.continuation;
  if (value == null) return null;
  for (const key of ["requestId", "lineageId", "parentAdventureId", "childAdventureId", "sourceFinaleId"]) {
    if (!ID.test(value[key] || "")) fail();
  }
  // An inherited historical revision can describe an earlier generation. The
  // outer view still belongs to this local adventure; the store verifies ancestry.
  if (value.parentAdventureId === value.childAdventureId
    || !Number.isSafeInteger(value.parentRevision) || value.parentRevision < 1
    || value.boundaryRevision !== value.parentRevision + 1 || !timeline.systemRevisions.includes(value.boundaryRevision)
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || (value.title !== undefined && (!text(value.title) || value.title.length > 512))) fail();
  return Object.fromEntries(["requestId", "lineageId", "parentAdventureId", "childAdventureId", "parentRevision",
    "boundaryRevision", "sourceFinaleId", "createdAt", ...(value.title === undefined ? [] : ["title"])].map((key) => [key, value[key]]));
}

function publicSource(value, adventureId, revision) {
  const source = value ?? { adventureId, revision };
  if (!ID.test(source.adventureId || "") || source.revision !== revision) fail();
  return { adventureId: source.adventureId, revision: source.revision };
}

function readView(view, displayLocale) {
  if (!view || !ID.test(view.adventureId || "") || !Number.isSafeInteger(view.revision) || view.revision < 0
    || (view.actionId !== null && !ID.test(view.actionId || "")) || !Array.isArray(view.narration)
    || !view.state || typeof view.state !== "object" || !view.state.entities || !view.state.situation
    || !Array.isArray(view.state.inventory) || !view.state.commitments) fail();
  const language = locale(displayLocale || view.locale);
  const state = view.state;
  const phase = state.opening?.phase || "ready";
  if (!["creating", "awaiting_confirmation", "ready"].includes(phase)) fail();
  const entities = Object.fromEntries(Object.entries(state.entities).filter(([, entity]) => entity?.visibility === "player"));
  for (const [entityId, entity] of Object.entries(entities)) {
    if (!ID.test(entityId) || entity.id !== entityId || !["character", "location", "item"].includes(entity.kind)
      || !text(entity.name) || !Array.isArray(entity.aliases) || !entity.attributes) fail();
  }
  const player = phase === "ready" ? entities[state.situation.playerId] : null;
  const location = phase === "ready" ? entities[state.situation.locationId] : null;
  if ((player && player.kind !== "character") || (location && location.kind !== "location")) fail();
  const inventory = phase === "ready" ? state.inventory.filter((entry) =>
    player && entry.ownerId === player.id && entities[entry.itemId]?.kind === "item") : [];
  if (inventory.some((entry) => !Number.isSafeInteger(entry.quantity) || entry.quantity <= 0)) fail();
  const commitments = phase === "ready" ? Object.values(state.commitments).filter((entry) =>
    player && (entry.debtorId === player.id || entry.creditorId === player.id)
    && entities[entry.debtorId]?.kind === "character" && entities[entry.creditorId]?.kind === "character"
    && entities[entry.itemId]?.kind === "item") : [];
  const names = Object.fromEntries(Object.values(entities).map((entity) => [entity.id,
    localized(entity.attributes.localizedNames || entity.attributes.localized_names, language) || entity.name]));
  const narration = view.narration.map((segment) => {
    if (!segment || !ID.test(segment.id || "") || !text(segment.text)) fail();
    return { id: segment.id, text: segment.text };
  });
  if (new Set(narration.map((segment) => segment.id)).size !== narration.length) fail();
  const timeline = publicTimeline(view);
  return { view, language, copy: COPY[language], phase, entities, player, location, inventory, commitments, names, narration,
    timeline, continuation: publicContinuation(view, timeline) };
}

function stateHint(context) {
  const { view, language, copy, player, location, inventory, commitments, names, phase } = context;
  const condition = characterCondition(player, language);
  const opening = view.state.opening;
  return {
    ...identity(view), schema_version: "p2-state-hint-v1", version: view.revision, updatedAt: null,
    scene: { location: location ? names[location.id] : null, location_name: location ? names[location.id] : null },
    player: { status: condition.status, status_label: condition.label },
    time: { turn: context.timeline.storyTurnCount, day: phase === "ready" && Number.isSafeInteger(view.state.situation.day) ? view.state.situation.day : null },
    inventory: { count: inventory.length }, active_events: { count: commitments.filter((entry) => entry.status === "open").length },
    lifecycle: { phase: phase === "ready" ? "ready" : "new_game_creation" },
    ...(opening ? { opening: {
      phase, status_label: copy[phase], draft: structuredClone(opening.draft || {}),
      proposal: opening.proposal ? { proposalId: opening.proposal.proposalId,
        summary: { revision: opening.proposal.summary.revision, segmentIds: [...opening.proposal.summary.segmentIds] } } : null,
      ...(opening.confirmation ? { confirmation: {
        proposalId: opening.confirmation.proposalId, summaryRevision: opening.confirmation.summaryRevision,
        summarySegmentIds: [...opening.confirmation.summarySegmentIds], revision: opening.confirmation.revision,
        sourceSegmentIds: [...opening.confirmation.sourceSegmentIds],
      } } : {}),
    } } : {}),
  };
}

function descriptor(context, panelRef) {
  const character = panelRef === CHARACTER_PANEL;
  const title = character ? context.copy.characters : context.copy.inventory;
  const guide = character ? context.copy.characterGuide : context.copy.inventoryGuide;
  return { panelRef, sourceKind: "built_in_domain", ownership: "built_in", group: "story_records",
    sortOrder: character ? 0 : 1, title, language: context.language, description: guide, triggers: [], playerGuide: guide,
    surface: "list_detail", ordinarySource: null,
    domainSource: { skillId: character ? "characters" : "inventory", capability: character ? "character_records" : "inventory_records", defaultView: "overview" } };
}

function discoveryDescriptor(context, metadata, storyFinale) {
  if (storyFinale.projection.easterDiscovered !== true || metadata == null) return null;
  if (!metadata || !/^[a-z][a-z0-9-]{1,63}$/.test(metadata.packId || "") || !ID.test(metadata.moduleRef || "") || metadata.moduleRef.length < 3
    || !text(metadata.title) || metadata.title.length > 240) fail();
  const guide = DISCOVERY_COPY[context.language];
  return { panelRef: DISCOVERY_PANEL, sourceKind: "ordinary_skill", ownership: "built_in", group: "adventure_gameplay",
    sortOrder: 2, title: metadata.title, language: context.language, description: guide, triggers: [], playerGuide: guide,
    surface: "guide", ordinarySource: { packId: metadata.packId, itemId: "extreme-ending-easter", hasModule: true,
      moduleRef: metadata.moduleRef, visibility: "hidden_until_active" }, domainSource: null };
}

function finaleForView(view, language) {
  const meta = view.finale ?? { adventureId: view.adventureId, revision: view.revision,
    decision: view.state.finale ?? null, archive: null, chapterJob: null };
  if (meta.adventureId !== view.adventureId || meta.revision !== view.revision
    || (view.state.finale?.phase === "confirmed" && meta.decision?.phase !== "confirmed")) fail();
  return projectSessionFinale(meta, { displayLocale: language, allowDiscovery: view.finale != null });
}

function projectSessionHistory(page) {
  if (!page || !ID.test(page.adventureId || "") || !Number.isSafeInteger(page.revision) || page.revision < 0
    || !Array.isArray(page.history) || typeof page.complete !== "boolean") fail();
  const cursor = page.nextBeforeRevision ?? null;
  const timeline = publicTimeline(page);
  if (cursor) {
    if (cursor.adventureId !== page.adventureId || cursor.revision !== page.revision) fail();
    if (Object.keys(cursor).some((key) => !["adventureId", "revision", "beforeRevision"].includes(key))
      || !Number.isSafeInteger(cursor.beforeRevision) || cursor.beforeRevision < 1 || cursor.beforeRevision > page.revision + 1) fail();
  }
  if (page.complete !== (cursor === null)) fail();
  let lastRevision = 0;
  const history = page.history.map((turn) => {
    if (!Number.isSafeInteger(turn.revision) || turn.revision < 1 || turn.revision > page.revision || turn.revision <= lastRevision
      || !ID.test(turn.actionId || "") || typeof turn.input !== "string" || !Array.isArray(turn.narration)
      || turn.narration.some((segment) => !text(segment?.text))) fail();
    const storyTurn = turn.revision - timeline.systemRevisions.filter((revision) => revision <= turn.revision).length;
    const source = turn.source ?? { adventureId: page.adventureId, revision: turn.revision };
    if (timeline.systemRevisions.includes(turn.revision) || (turn.storyTurn !== undefined && turn.storyTurn !== storyTurn)
      || !ID.test(source.adventureId || "") || source.revision !== turn.revision) fail();
    lastRevision = turn.revision;
    return { adventureId: page.adventureId, revision: turn.revision, actionId: turn.actionId,
      source: { adventureId: source.adventureId, revision: source.revision }, storyTurn,
      ...(timeline.systemRevisions.includes(turn.revision - 1) ? { continuationBefore: true } : {}),
      kind: "turn", seq: storyTurn, player: turn.input, host: turn.narration.map((segment) => segment.text).join("\n\n"),
      autoSpeak: false, utteranceId: `speech_${hash([page.adventureId, turn.revision, turn.actionId])}` };
  });
  return { adventureId: page.adventureId, revision: page.revision, actionId: page.actionId ?? null,
    history, timeline, nextBeforeRevision: cursor ? { ...cursor } : null, complete: page.complete, autoSpeak: false };
}

// Chapters are derived reading material. The existing chapter surfaces consume
// text arrays; keep their exact source references beside those display fields.
function projectSessionChapters(page) {
  if (!page || !ID.test(page.adventureId || "") || !Number.isSafeInteger(page.revision) || page.revision < 0
    || !Array.isArray(page.chapters) || typeof page.complete !== "boolean") fail();
  const timeline = publicTimeline(page);
  const storyTurn = (revision) => revision - timeline.systemRevisions.filter((value) => value <= revision).length;
  const cursor = page.nextCursor ?? null;
  if (cursor) {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(cursor))) fail();
    for (const key of Reflect.ownKeys(cursor)) {
      const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
      if (typeof key !== "string" || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    }
    if (cursor.adventureId !== page.adventureId || cursor.revision !== page.revision) fail();
    if (Object.keys(cursor).some((key) => !["adventureId", "revision", "afterToRevision", "throughToRevision"].includes(key))
      || !Number.isSafeInteger(cursor.afterToRevision) || cursor.afterToRevision < 1
      || !Number.isSafeInteger(cursor.throughToRevision) || cursor.afterToRevision >= cursor.throughToRevision
      || cursor.throughToRevision > page.revision) fail();
  }
  if (page.complete !== (cursor === null)) fail();
  let previousEnd = 0;
  const chapterIds = new Set();
  const chapters = page.chapters.map((chapter) => {
    if (!chapter || !ID.test(chapter.chapterId || "") || chapterIds.has(chapter.chapterId)
      || !Number.isSafeInteger(chapter.fromRevision) || chapter.fromRevision < 1 || chapter.fromRevision <= previousEnd
      || !Number.isSafeInteger(chapter.toRevision) || chapter.toRevision < chapter.fromRevision || chapter.toRevision > page.revision
      || timeline.systemRevisions.includes(chapter.fromRevision) || timeline.systemRevisions.includes(chapter.toRevision)
      || !text(chapter.title) || !text(chapter.summary) || !["model", "excerpt"].includes(chapter.mode)) fail();
    if (chapter.createdAt != null && (typeof chapter.createdAt !== "string" || !Number.isFinite(Date.parse(chapter.createdAt)))) fail();
    if (chapter.fallbackReason != null && (chapter.mode !== "excerpt" || !/^[A-Z][A-Z0-9_]{0,95}$/.test(chapter.fallbackReason))) fail();
    const projectEntries = (entries) => {
      if (!Array.isArray(entries)) fail();
      return entries.map((entry) => {
        if (!entry || !text(entry.text) || !Array.isArray(entry.sources) || !entry.sources.length) fail();
        const seen = new Set();
        const sources = entry.sources.map((source) => {
          if (!source || !Number.isSafeInteger(source.revision) || source.revision < chapter.fromRevision
            || source.revision > chapter.toRevision || !ID.test(source.segmentId || "")) fail();
          const key = `${source.revision}:${source.segmentId}`;
          if (seen.has(key)) fail();
          seen.add(key);
          if (timeline.systemRevisions.includes(source.revision)) fail();
          return { revision: source.revision, segmentId: source.segmentId,
            ...(source.source === undefined ? {} : { source: publicSource(source.source, page.adventureId, source.revision) }) };
        });
        return { text: entry.text, sources };
      });
    };
    const keyEvents = projectEntries(chapter.keyEvents);
    const openThreads = projectEntries(chapter.openThreads);
    previousEnd = chapter.toRevision;
    chapterIds.add(chapter.chapterId);
    return { adventureId: page.adventureId, revision: page.revision, chapter_id: chapter.chapterId,
      title: chapter.title, summary: chapter.summary, key_events: keyEvents.map((entry) => entry.text),
      open_threads: openThreads.map((entry) => entry.text),
      turn_range: { start: chapter.fromRevision, end: chapter.toRevision },
      story_turn_range: { start: storyTurn(chapter.fromRevision), end: storyTurn(chapter.toRevision) },
      ...(chapter.source === undefined ? {} : { source: publicSource(chapter.source, page.adventureId, chapter.toRevision) }),
      createdAt: chapter.createdAt ?? null,
      sources: { key_events: keyEvents, open_threads: openThreads },
      generation: { mode: chapter.mode, ...(chapter.fallbackReason == null ? {} : { fallbackReason: chapter.fallbackReason }) },
      not_hard_state: true, autoSpeak: false };
  });
  if (cursor && (!chapters.length || previousEnd !== cursor.afterToRevision)) fail();
  return { adventureId: page.adventureId, revision: page.revision, timeline, source: "session_chapters",
    status: chapters.length ? "ok" : "not_found", chapter_count: chapters.length, chapters,
    nextCursor: cursor ? { ...cursor } : null,
    complete: page.complete, not_hard_state: true, autoSpeak: false };
}

function projectSessionFinale(meta, { displayLocale = "zh-CN", allowDiscovery = true } = {}) {
  if (!meta || !ID.test(meta.adventureId || "") || !Number.isSafeInteger(meta.revision) || meta.revision < 0) fail();
  const language = locale(displayLocale);
  const decision = meta.decision ?? null;
  const archive = meta.archive ?? null;
  const job = meta.chapterJob ?? null;
  const terminal = meta.terminal ?? null;
  if ([decision, archive, job, terminal].some((value) => value !== null && (typeof value !== "object" || Array.isArray(value)))) fail();
  let phase = decision === null ? "idle" : decision.phase;
  const extreme = decision?.candidate?.kind === "extreme";
  if (decision?.candidate?.kind !== undefined && !["normal", "extreme"].includes(decision.candidate.kind)) fail();
  if (!["idle", "candidate_pending", "confirmed"].includes(phase)) fail();
  if (phase !== "confirmed" && (archive || job || decision?.confirmation)) fail();
  if (phase === "candidate_pending") {
    const candidate = decision.candidate;
    if (!candidate || !ID.test(candidate.candidateId || "") || !candidate.proposal) fail();
    if (!Number.isSafeInteger(candidate.proposal.revision) || candidate.proposal.revision < 1
      || candidate.proposal.revision > meta.revision || !Array.isArray(candidate.proposal.segmentIds)
      || !candidate.proposal.segmentIds.length || candidate.proposal.segmentIds.some((id) => !ID.test(id || ""))) fail();
  }
  if (terminal) {
    if (!extreme || !ID.test(terminal.terminalId || "") || !ID.test(terminal.actionId || "")
      || terminal.candidateId !== decision.candidate.candidateId || !Number.isSafeInteger(terminal.baseRevision)
      || terminal.baseRevision < 1 || !["reserved", "committed"].includes(terminal.status)) fail();
    if (terminal.status === "reserved" && (phase !== "candidate_pending" || archive || job
      || terminal.baseRevision !== meta.revision || terminal.committedRevision !== null)) fail();
    if (terminal.status === "committed" && (phase !== "confirmed" || terminal.committedRevision !== meta.revision
      || terminal.committedRevision !== terminal.baseRevision + 1
      || decision.confirmation?.revision !== terminal.committedRevision)) fail();
  }
  if (phase === "confirmed") {
    const confirmation = decision.confirmation;
    const candidate = decision.candidate;
    if (!confirmation || !ID.test(confirmation.candidateId || "") || !candidate || candidate.candidateId !== confirmation.candidateId) fail();
    if (!Number.isSafeInteger(confirmation.proposalRevision) || confirmation.proposalRevision < 1
      || !Array.isArray(confirmation.proposalSegmentIds) || !confirmation.proposalSegmentIds.length
      || confirmation.proposalSegmentIds.some((id) => !ID.test(id || ""))
      || candidate.proposal?.revision !== confirmation.proposalRevision
      || JSON.stringify(candidate.proposal.segmentIds) !== JSON.stringify(confirmation.proposalSegmentIds)) fail();
    if (!Number.isSafeInteger(confirmation.revision) || confirmation.revision < 1
      || confirmation.revision <= (confirmation.proposalRevision ?? 0) || confirmation.revision > meta.revision
      || !Array.isArray(confirmation.sourceSegmentIds) || !confirmation.sourceSegmentIds.length
      || confirmation.sourceSegmentIds.some((id) => !ID.test(id || ""))) fail();
    if (archive) {
      if (!ID.test(archive.finaleId || "") || archive.candidateId !== confirmation.candidateId
        || !["pending", "closed"].includes(archive.status)
        || (archive.chapterId != null && !ID.test(archive.chapterId))) fail();
      if (archive.kind !== undefined || archive.confirmationRevision !== confirmation.revision
        || !ID.test(archive.confirmationActionId || "")) fail();
      if (archive.status === "closed" && (!ID.test(archive.chapterId || "") || typeof archive.closedAt !== "string"
        || !Number.isFinite(Date.parse(archive.closedAt)))) fail();
      if (archive.status === "pending" && archive.closedAt != null) fail();
      if (extreme ? archive.source !== "extreme" || archive.continuationPolicy !== "forbidden"
        || !EXTREME_OUTCOMES.includes(confirmation.outcome) || archive.outcome !== confirmation.outcome
        : archive.source !== undefined && archive.source !== "normal") fail();
      if (terminal && archive.confirmationActionId !== terminal.actionId) fail();
    }
    if (job && (!archive || job.adventureId !== meta.adventureId || !ID.test(job.chapterId || "")
      || (archive.chapterId !== null && archive.chapterId !== undefined && job.chapterId !== archive.chapterId)
      || job.toRevision !== confirmation.revision || !Number.isSafeInteger(job.fromRevision)
      || job.fromRevision < 1 || job.fromRevision > job.toRevision
      || !["running", "committed", "failed", "interrupted"].includes(job.status)
      || (archive.status === "closed" && job.status !== "committed"))) fail();
    phase = archive?.status === "closed" ? "closed" : job?.status === "running" ? "finalizing" : "recovery_required";
  }
  const reserved = terminal?.status === "reserved";
  if (reserved) phase = "recovery_required";
  const discovered = allowDiscovery && extreme && decision.phase === "confirmed"
    && decision.confirmation.outcome === "grey_crow_view";
  return { adventureId: meta.adventureId, revision: meta.revision,
    actionId: terminal?.actionId ?? archive?.confirmationActionId ?? null,
    projection: { phase, inputAllowed: phase === "idle" || phase === "candidate_pending",
      actions: { resumeFinalization: phase === "recovery_required" || phase === "finalizing", exportStory: phase === "closed", continueAsChild: phase === "closed" && !extreme },
      closedFinale: phase === "closed" ? { finaleId: archive.finaleId, finaleSource: extreme ? "easter" : "normal", continuationPolicy: extreme ? "forbidden" : "allowed" } : null,
      ...(discovered ? { easterDiscovered: true } : {}),
      ...(reserved ? { engineNotice: TERMINAL_NOTICE[language] }
        : FINALE_NOTICE[language][phase] ? { engineNotice: FINALE_NOTICE[language][phase] } : {}),
    }, autoSpeak: false };
}

function projectSessionView(view, { delivery = "recovery", title, createdAt = null, updatedAt = null, displayLocale, discoverySkill, memoryFragmentSkill } = {}) {
  if (!["commit", "recovery"].includes(delivery)) fail();
  const context = readView(view, displayLocale);
  const hint = stateHint(context);
  const metadata = identity(view);
  const storyFinale = finaleForView(view, context.language);
  const discovery = discoveryDescriptor(context, discoverySkill, storyFinale);
  const memoryFragments = projectMemoryFragmentDescriptor(view, { memoryFragmentSkill, displayLocale: context.language });
  const finalePhase = storyFinale.projection.phase;
  const closed = finalePhase === "closed";
  const finalizing = finalePhase === "finalizing" || finalePhase === "recovery_required";
  const autoSpeak = delivery === "commit" && view.actionId !== null && context.narration.length > 0;
  const speech = { ...metadata, autoSpeak, delivery,
    utteranceId: view.actionId === null ? null : `speech_${hash([view.adventureId, view.revision, view.actionId])}` };
  const historyPage = projectSessionHistory({ ...metadata, timeline: context.timeline, history: view.history || [],
    complete: view.historyComplete ?? true, nextBeforeRevision: view.historyNextBeforeRevision ?? null });
  for (const turn of view.history || []) {
    if (turn.revision === view.revision && (turn.actionId !== view.actionId
      || JSON.stringify(turn.narration) !== JSON.stringify(view.narration))) fail();
  }
  const dates = [context.continuation?.createdAt || createdAt, updatedAt].map((value) => {
    if (value === null) return null;
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail();
    return value;
  });
  hint.updatedAt = dates[1];
  return {
    ...metadata, storyFinale, timeline: context.timeline, continuation: context.continuation,
    envelope: { ...metadata, request_id: view.actionId || `view_${hash([view.adventureId, view.revision])}`,
      // Existing recovery renders resetGameView(save, history), never this empty
      // envelope. Commit delivery renders only this turn's envelope. Do not send
      // recovered history through renderEnvelope's missing-content warning path.
      segments: delivery === "commit" ? context.narration.map((segment) => ({ type: "text", content: segment.text, meta: { ...speech, segmentId: segment.id } })) : [],
      meta: { ...speech, ok: true }, state_hint: structuredClone(hint), error: null },
    state_hint: hint,
    save: { ...metadata, id: view.adventureId,
      title: clip(title || context.continuation?.title, 40) || clip(context.location ? context.names[context.location.id] : context.copy.currentAdventure, 40),
      createdAt: dates[0], updatedAt: dates[1], turn: context.timeline.storyTurnCount, state_hint: structuredClone(hint),
      continuation: context.continuation,
      adventureLocale: view.locale, adventureLocaleSource: "session", catalogRole: closed ? "archive" : "active", schemaKind: "session",
      // Pending finales remain openable from the menu solely for recovery;
      // projection.inputAllowed controls whether a story action may execute.
      compatibility: { status: closed ? "closed" : finalizing ? "recovery_required" : "active",
        playerContinuable: !closed, deleteAllowed: true, errorCode: null,
        adventureLocale: view.locale, adventureLocaleSource: "session" } },
    history: delivery === "recovery" ? historyPage.history : [],
    historyComplete: historyPage.complete, historyNextBeforeRevision: historyPage.nextBeforeRevision,
    panels: { ...metadata, supported: true, schemaVersion: "grey-crow-skill-panel-presentation-v2", panels: [descriptor(context, INVENTORY_PANEL),
      ...(memoryFragments ? [memoryFragments] : []), ...(discovery ? [discovery] : [])] },
    characterPanel: { ...metadata, supported: true, panel: descriptor(context, CHARACTER_PANEL) },
  };
}

function field(id, label, value) {
  const kind = Array.isArray(value) ? "chips" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text";
  return { id, label, kind, value, minimum: kind === "number" ? Math.min(0, value) : null, maximum: kind === "number" ? Math.max(1, value) : null };
}
function attributeFields(entity, copy, condition) {
  const fields = condition?.authoritative
    ? [field("status", copy.status, condition.entries.length ? condition.entries : condition.label)] : [];
  const longValues = [];
  for (const key of ["status", "description", "relationship", "occupation", "age", "condition", "health", "injuries", "hunger", "thirst", "fatigue", "mood"]) {
    if (condition?.authoritative && LEGACY_CONDITION_ATTRIBUTES.has(key)) continue;
    let value = entity.attributes[key];
    if (typeof value === "string") {
      if (value.length > 2000) { longValues.push({ key, label: copy[key], values: [value], array: false }); continue; }
      value = text(value);
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      if (value.length > 64 || value.some((entry) => entry.length > 240)
        || value.reduce((count, entry) => count + entry.length, 0) > 2000) {
        longValues.push({ key, label: copy[key], values: value, array: true }); continue;
      }
      value = value.map(text).filter(Boolean);
    }
    else if (typeof value !== "boolean" && !(Number.isFinite(value) && Math.abs(value) <= 1_000_000_000)) continue;
    if (value !== null) fields.push(field(key, copy[key], value));
  }
  return { fields, longValues };
}

function detailTextRanges(value) {
  if (!value.length) return [{ start: 0, end: 0 }];
  const ranges = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(value.length, start + DETAIL_RECORD_MAX_CHARACTERS);
    if (end < value.length) {
      const floor = start + Math.floor(DETAIL_RECORD_MAX_CHARACTERS / 2);
      const tail = value.slice(floor, end);
      const newline = tail.lastIndexOf("\n");
      if (newline >= 0) end = floor + newline + 1;
      else {
        const endings = [...tail.matchAll(/[。！？.!?]["'”’」』）)]*[ \t]*/g)];
        if (endings.length) { const last = endings.at(-1); end = floor + last.index + last[0].length; }
      }
      if ((value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff
        && value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff)
        || (value[end - 1] === "\r" && value[end] === "\n")) end--;
    }
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

function detailTextParts(longValues) {
  const parts = [];
  let characters = 0;
  for (const entry of longValues) for (const [itemIndex, value] of entry.values.entries()) {
    characters += value.length;
    const ranges = detailTextRanges(value);
    for (const [partIndex, range] of ranges.entries()) {
      parts.push({ key: entry.key, label: entry.label, value, ...range,
        itemIndex: entry.array ? itemIndex + 1 : null, partIndex: partIndex + 1, partCount: ranges.length });
    }
  }
  return { parts, characters };
}

function detailPageFits(view, panel) {
  const serialized = JSON.stringify({ ...identity(view), supported: true, panel });
  return serialized.length <= DETAIL_MAX_CHARACTERS
    && Buffer.byteLength(serialized, "utf8") <= DETAIL_MAX_BYTES;
}

function projectSessionPanel(view, input = {}) {
  const { panelRef, view: requestedView = "overview", fieldId, itemRef, cursor, limit = 12, displayLocale } = input;
  const context = readView(view, displayLocale);
  if (panelRef === MEMORY_FRAGMENT_PANEL) return projectMemoryFragmentPanel(view, { ...input, displayLocale: context.language });
  if (panelRef === DISCOVERY_PANEL) {
    const info = discoveryDescriptor(context, input.discoverySkill, finaleForView(view, context.language));
    if (!info) fail("SKILL_PANEL_NOT_SELECTED");
    if (requestedView !== "overview" || fieldId != null || itemRef != null || cursor != null || input.limit !== undefined) fail("SKILL_PANEL_VIEW_INVALID");
    return { ...identity(view), supported: true, panel: { schemaVersion: "grey-crow-skill-panel-view-projection-v1",
      panelRef, sourceKind: info.sourceKind, ownership: info.ownership, group: info.group, surface: "guide", view: "overview",
      title: info.title, status: "ready", summary: [], fields: [], items: [], detail: null, pagination: null } };
  }
  if (![CHARACTER_PANEL, INVENTORY_PANEL].includes(panelRef)) fail("SKILL_PANEL_NOT_SELECTED");
  if (!["overview", "list", "detail"].includes(requestedView)) fail("SKILL_PANEL_VIEW_INVALID");
  const character = panelRef === CHARACTER_PANEL;
  const expectedField = character ? "characters" : "inventory";
  const panelDescriptor = descriptor(context, panelRef);
  const entities = context.phase !== "ready" ? [] : character
    ? Object.values(context.entities).filter((entity) => entity.kind === "character")
    : context.inventory.map((entry) => context.entities[entry.itemId]);
  entities.sort((left, right) => left.id.localeCompare(right.id));
  const ref = (entity) => `entity_${hash([view.adventureId, entity.id])}`;
  const panel = { schemaVersion: "grey-crow-skill-panel-view-projection-v1", panelRef,
    sourceKind: panelDescriptor.sourceKind, ownership: panelDescriptor.ownership, group: panelDescriptor.group,
    surface: panelDescriptor.surface, view: requestedView, title: panelDescriptor.title,
    status: entities.length ? "ready" : "empty", summary: [{ id: "count", label: character ? context.copy.known : context.copy.kinds, text: String(entities.length) }],
    fields: [], items: [], detail: null, pagination: null };
  if (requestedView === "overview") {
    if (fieldId != null || itemRef != null || cursor != null || input.limit !== undefined) fail("SKILL_PANEL_VIEW_INVALID");
    panel.fields = [{ id: expectedField, label: panelDescriptor.title, kind: "progress", value: entities.length, minimum: 0, maximum: Math.max(1, entities.length) }];
  } else {
    if (fieldId !== expectedField) fail("SKILL_PANEL_FIELD_UNKNOWN");
    if (requestedView === "list") {
      if (itemRef != null || !Number.isSafeInteger(limit) || limit < 1 || limit > 24) fail("SKILL_PANEL_VIEW_INVALID");
      const makeCursor = (offset) => `page_${offset}_${hash([view.adventureId, view.revision, panelRef, fieldId, context.language, offset])}`;
      let offset = 0;
      if (cursor != null) {
        const match = /^page_([0-9]{1,5})_[a-f0-9]{32}$/.exec(cursor);
        if (!match) fail("SKILL_PANEL_CURSOR_INVALID");
        offset = Number(match[1]);
        if (cursor !== makeCursor(offset) || offset >= entities.length) fail("SKILL_PANEL_CURSOR_INVALID");
      }
      panel.items = entities.slice(offset, offset + limit).map((entity) => {
        const condition = character ? characterCondition(entity, context.language) : null;
        const legacyMetadata = character && !condition.authoritative ? text(entity.attributes.relationship || condition.label) : null;
        const description = text(entity.attributes.description);
        const aliasText = entity.aliases.join(" · ");
        const subtitle = description || text(aliasText);
        return { ref: ref(entity), title: clip(context.names[entity.id], 240),
        subtitle: subtitle && subtitle.length > 240 ? DETAIL_TEXT_COPY[context.language].viewDetails : subtitle,
        statusLabel: character ? condition.authoritative ? condition.listLabel : legacyMetadata && legacyMetadata.length <= 240 ? legacyMetadata : null
          : `${context.copy.quantity}: ${context.inventory.find((entry) => entry.itemId === entity.id).quantity}`,
        updatedTurn: null };
      });
      const next = offset + panel.items.length;
      panel.pagination = { hasMore: next < entities.length, nextCursor: next < entities.length ? makeCursor(next) : null,
        returnedItems: panel.items.length, totalItems: entities.length };
    } else {
      const detailLimit = input.limit === undefined ? 24 : input.limit;
      if (!Number.isSafeInteger(detailLimit) || detailLimit < 1 || detailLimit > 24) fail("SKILL_PANEL_VIEW_INVALID");
      const entity = entities.find((entry) => ref(entry) === itemRef);
      if (!entity) fail("SKILL_PANEL_ITEM_NOT_FOUND");
      const { fields, longValues } = attributeFields(entity, context.copy, character ? characterCondition(entity, context.language) : null);
      if (entity.aliases.some((alias) => alias.length > 240) || entity.aliases.length > 64
        || entity.aliases.reduce((count, alias) => count + alias.length, 0) > 2000) {
        longValues.unshift({ key: "aliases", label: context.copy.aliases, values: entity.aliases, array: true });
      } else if (entity.aliases.length) fields.unshift(field("aliases", context.copy.aliases, entity.aliases.map(text).filter(Boolean)));
      if (!character) fields.unshift(field("quantity", context.copy.quantity, context.inventory.find((entry) => entry.itemId === entity.id).quantity));
      const related = context.commitments.filter((entry) => character ? entry.debtorId === entity.id || entry.creditorId === entity.id : entry.itemId === entity.id);
      // Group by committed status without inventing a priority from freeform
      // due text. Keep each group's original order and existing record IDs.
      const open = related.filter((entry) => entry.status === "open");
      const past = related.filter((entry) => ["fulfilled", "cancelled"].includes(entry.status));
      if (open.length + past.length !== related.length) fail();
      const openRecords = [], pastRecords = [];
      const commitmentCopy = COMMITMENT_COPY[context.language];
      const sections = [];
      if (open.length) sections.push({ id: "commitments_open", title: commitmentCopy.open,
        fields: [field("record_count", commitmentCopy.count, open.length)], records: openRecords });
      sections.push({ id: "identity", title: character ? context.copy.identity : context.copy.item, fields: fields.slice(0, 16), records: [] });
      const textCopy = DETAIL_TEXT_COPY[context.language];
      const { parts, characters } = detailTextParts(longValues);
      const textRecords = [];
      if (parts.length) sections.push({ id: "attribute_text", title: textCopy.title,
        fields: [field("record_count", textCopy.recordCount, parts.length), field("character_count", textCopy.characterCount, characters)], records: textRecords });
      if (past.length) sections.push({ id: "commitments_history", title: commitmentCopy.history,
        fields: [field("record_count", commitmentCopy.count, past.length)], records: pastRecords });
      const total = parts.length + related.length;
      if (total > DETAIL_MAX_RECORDS) fail("SESSION_PAYLOAD_TOO_LARGE");
      const makeCursor = (offset) => `detail_${offset}_${hash([DETAIL_LAYOUT, view.adventureId, view.revision, panelRef, fieldId, entity.id, context.language, offset])}`;
      let offset = 0;
      if (cursor != null) {
        const match = /^detail_([0-9]{1,6})_[a-f0-9]{32}$/.exec(cursor);
        if (!match) fail("SKILL_PANEL_CURSOR_INVALID");
        offset = Number(match[1]);
        if (offset >= total || cursor !== makeCursor(offset)) fail("SKILL_PANEL_CURSOR_INVALID");
      }
      panel.detail = { ref: ref(entity), title: clip(context.names[entity.id], 240), subtitle: null, sections };
      const setPagination = () => {
        const returned = openRecords.length + textRecords.length + pastRecords.length;
        const next = offset + returned;
        panel.pagination = total ? { hasMore: next < total,
          nextCursor: next < total ? makeCursor(next) : null,
          returnedItems: returned, totalItems: total } : null;
      };
      setPagination();
      if (!detailPageFits(view, panel)) fail("SESSION_PAYLOAD_TOO_LARGE");
      const headingName = (id) => context.names[id].length <= 512 ? context.names[id] : context.entities[id].name;
      for (let index = offset; index < Math.min(total, offset + detailLimit); index++) {
        let kind = "open", position = index;
        if (index >= open.length) {
          const remaining = index - open.length;
          const paired = 2 * Math.min(parts.length, past.length);
          if (remaining < paired) { kind = remaining % 2 ? "history" : "text"; position = Math.floor(remaining / 2); }
          else if (parts.length > past.length) { kind = "text"; position = past.length + remaining - paired; }
          else { kind = "history"; position = parts.length + remaining - paired; }
        }
        const target = kind === "open" ? openRecords : kind === "text" ? textRecords : pastRecords;
        if (kind === "text") {
          const part = parts[position];
          target.push({ id: `attribute_${hash([view.adventureId, entity.id, part.key, part.itemIndex, part.start, part.end])}`,
            label: textCopy.part(part.label, part.partIndex, part.partCount, part.itemIndex), turn: null,
            text: part.value.length ? part.value.slice(part.start, part.end) : textCopy.empty });
        } else {
          const entry = (kind === "open" ? open : past)[position];
          if (typeof entry.due !== "string" || !entry.due.trim() || entry.due.length > 4000) fail();
          target.push({ id: `commitment_${hash([view.adventureId, entry.id])}`, label: context.copy[entry.status] || null, turn: null,
            heading: `${headingName(entry.debtorId)} → ${headingName(entry.creditorId)} · ${headingName(entry.itemId)} × ${entry.quantity}`,
            text: `${context.copy.due}: ${entry.due}` });
        }
        setPagination();
        if (!detailPageFits(view, panel)) {
          target.pop();
          setPagination();
          break;
        }
      }
      if (total && !openRecords.length && !textRecords.length && !pastRecords.length) fail("SESSION_PAYLOAD_TOO_LARGE");
    }
  }
  return { ...identity(view), supported: true, panel };
}

module.exports = { projectSessionView, projectSessionPanel, projectSessionHistory, projectSessionChapters, projectSessionFinale,
  resolveSessionMemoryFragmentSkill, projectMemoryFragmentModule };
