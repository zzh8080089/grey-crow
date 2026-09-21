"use strict";

// Synthetic committed sources; real Main/preload/renderer/session-child reads.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const handlesPhase = (phase) => ["chapter_readability", "chapter_readability_restore"].includes(phase);
const fixturePath = (root) => path.join(root, "results", "chapter-readability-fixture.json");
const digest = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const COPY = {
  "zh-CN": { title: "门边的交谈", short: "你在门边与陈姨交谈，仍不知道远处声音的来源。", clause: "你听完陈姨的话，记下她能确认的细节；没有把猜测当作事实。", tail: "她没有确认来人的身份，也没有答应开门。", event: "你与陈姨核对第", eventEnd: "件事；这仍是她的自述。", thread: "远处的声音来自哪里，尚待确认。" },
  "en-US": { title: "A conversation at the door", short: "You talk with Chen at the door. The source of the distant sound remains unknown.", clause: "You listen to Chen and note what she can confirm, keeping her guesses separate from established facts. ", tail: "She did not confirm the visitor's identity and did not agree to open the door.", event: "You check account ", eventEnd: " with Chen; it remains her account.", thread: "The source of the distant sound remains an open question." },
  "ja-JP": { title: "戸口での会話", short: "あなたは戸口で陳さんと話した。遠くの音の出所はまだ分からない。", clause: "陳さんの話を聞き、確認できたことを覚えておく。推測を確かな事実とは扱わない。", tail: "陳さんは来訪者の身元を確認しておらず、戸を開けるとも約束していない。", event: "陳さんと第", eventEnd: "の話を確かめたが、まだ本人の説明にとどまる。", thread: "遠くの音がどこから聞こえるのかは、まだ確認できていない。" },
};

async function createFixture(root, locale, createSettingsFixture) {
  const fixture = await createSettingsFixture(root, locale);
  const gameRoot = path.resolve(__dirname, "../../../..");
  const { readContentSnapshot } = require(path.join(gameRoot, "engine/content-v2/snapshot-reader"));
  const { createTurnStore } = require(path.join(gameRoot, "engine/session/turn-store"));
  const snapshot = await readContentSnapshot({ adventuresRoot: path.join(root, "data", "saves"), adventureId: fixture.adventureId });
  const strings = COPY[locale], summary = strings.clause.repeat(18) + strings.tail;
  const events = Array.from({ length: 16 }, (_, index) => strings.event + (index + 1) + strings.eventEnd);
  const store = createTurnStore({ ...fixture, contentVersion: snapshot.lock.overallHash });
  try {
    for (let revision = 1; revision <= 13; revision += 1) {
      const segmentId = `chapter-source-${revision}`;
      const long = revision === 12;
      const action = store.beginAction({ actionId: `chapter-read-${revision}`, baseRevision: revision - 1,
        input: strings.title, locale, contentVersion: snapshot.lock.overallHash });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: {
        narration: [{ id: segmentId, text: long ? [summary, ...events, strings.thread].join("\n") : strings.short }], events: [], experiences: [] } });
      const job = store.beginChapter({ targetRevision: revision });
      const sources = [{ revision, segmentId }];
      store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: {
        title: `${strings.title} ${revision}`, summary: long ? summary : strings.short,
        keyEvents: (long ? events : [strings.short]).map((text) => ({ text, sources })),
        openThreads: long ? [{ text: strings.thread, sources }] : [], mode: "model" } });
    }
    assert.equal(store.readView().revision, 13);
    assert.equal(store.readChapters({ limit: 24 }).chapters.length, 13);
  } finally { store.close(); }
  Object.assign(fixture, { strings, summary, events, revision: 13, databaseHash: digest(fixture.databasePath) });
  fs.writeFileSync(fixturePath(root), JSON.stringify(fixture, null, 2));
  return fixture;
}

async function runCoordinator({ runPhase, createSettingsFixture, rootEnv }) {
  const results = [];
  for (const locale of Object.keys(COPY)) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
    for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(root, name));
    const env = {};
    for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    Object.assign(env, { TMPDIR: path.join(root, "tmp"), XDG_CONFIG_HOME: path.join(root, "home", "config"),
      XDG_CACHE_HOME: path.join(root, "home", "cache"), [rootEnv]: root,
      GREY_CROW_DATA_ROOT: path.join(root, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(root, "provider-check"),
      GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(root, "kokoro-fixture") });
    const fixture = await createFixture(root, locale, createSettingsFixture);
    process.stdout.write(`Chapter readability ${locale} artifacts: ${root}\n`);
    const phases = [];
    for (const phase of locale === "zh-CN" ? ["chapter_readability", "chapter_readability_restore"] : ["chapter_readability"]) {
      phases.push(await runPhase(require("electron"), phase, env));
      assert.equal(digest(fixture.databasePath), fixture.databaseHash, "chapter reading must leave the whole SQLite file unchanged");
    }
    const result = { locale, root, revision: 13, databaseHash: fixture.databaseHash, phases };
    fs.writeFileSync(path.join(root, "results", "result.json"), JSON.stringify(result, null, 2));
    results.push(result);
  }
  process.stdout.write(JSON.stringify({ ok: true, suite: "chapter-readability", results,
    boundary: "Synthetic chapter content; real desktop reads and rendering. No model, voice quality, native-language or release acceptance." }, null, 2) + "\n");
}

async function runPhase(win, evidence, root, ui) {
  const { click, change, evaluate, readStatus, waitFor, screenshot, connectSyntheticModel, waitSettingsRevision } = ui;
  const fixture = JSON.parse(fs.readFileSync(fixturePath(root), "utf8"));
  const { locale, strings } = fixture;
  if (evidence.phase === "chapter_readability") {
    await click(win, "#menuLanguageToggle");
    await click(win, { "zh-CN": "#mainMenuLocaleZh", "en-US": "#mainMenuLocaleEn", "ja-JP": "#mainMenuLocaleJa" }[locale]);
    await waitFor(win, "chapter UI locale", `document.documentElement.lang === ${JSON.stringify(locale)} && document.querySelector('#localeTransitionCurtain').dataset.phase === 'idle'`);
    await connectSyntheticModel(win);
    await click(win, "#settingsTabDisplay");
    assert.equal(await evaluate(win, "state.gameUiLayout"), "story-notebook-v1");
    await click(win, "#settingsTabAudio"); await change(win, "#ttsReadingModeSelect", "manual");
    await click(win, "#saveSettingsButton");
    await waitFor(win, "readability settings persisted", "!state.settingsSaving && !state.settingsDirty");
    await click(win, "#closeSettingsButton");
  } else if (!(await readStatus(win)).keyVerified) {
    await connectSyntheticModel(win); await click(win, "#closeSettingsButton");
  }
  await click(win, "#continueGameButton");
  await waitSettingsRevision(win, fixture.adventureId, 13, strings.short);
  assert.equal(await evaluate(win, "document.documentElement.lang"), locale);
  await click(win, "#storyNotebookChaptersButton");
  const body = "#storyNotebookDrawerBody", card = `${body} article.chapter-card[data-chapter-id=\"chapter-12\"]`;
  const details = `${card} details.chapter-details`;
  const count = `document.querySelectorAll('${body} article.chapter-card').length`;
  await waitFor(win, "first twelve stored chapters", `${count} === 12 && !state.chapterReadBusy`);
  evidence.readingChecks = [];
  for (const [width, height] of [[1280, 720], [1260, 820]]) {
    win.setAspectRatio(0); win.setContentSize(width, height, false); win.center();
    await waitFor(win, "chapter reading viewport", `innerWidth === ${width} && innerHeight === ${height}`);
    await evaluate(win, `(() => { document.querySelector('${details}').open = false; document.querySelector('${body}').scrollTop = 0; })()`);
    assert.equal(await evaluate(win, `document.querySelector('${card} p.chapter-summary') === null`), true);
    assert.equal(await evaluate(win, `document.querySelector('${card} p.chapter-full-summary').checkVisibility()`), false);
    assert.equal(await evaluate(win, `document.querySelector('${body} [data-chapter-id="chapter-11"] p.chapter-summary').textContent`), strings.short);
    assert.ok(await evaluate(win, `document.querySelector('${card} .chapter-overview-counts').textContent.includes('16')`));
    await screenshot(win, root, `${evidence.phase}-${width}-collapsed`, evidence);
    const reads = evidence.chapterReads.length;
    const keyboard = evidence.phase === "chapter_readability_restore" && width === 1280;
    if (keyboard) {
      win.show(); win.focus(); win.webContents.focus();
      await evaluate(win, `document.querySelector('${details} > summary').focus()`);
      await waitFor(win, "chapter summary receives native keyboard focus", `document.hasFocus() && document.activeElement === document.querySelector('${details} > summary')`);
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      await waitFor(win, "keyboard expands complete chapter", `document.querySelector('${details}').open`);
    } else await click(win, `${details} > summary`);
    assert.equal(evidence.chapterReads.length, reads, "native details expansion must not make an IPC read");
    assert.equal(await evaluate(win, `document.querySelector('${card} p.chapter-full-summary').textContent`), fixture.summary);
    const displayed = await evaluate(win, `Array.from(document.querySelectorAll('${card} .chapter-events li'), n=>n.textContent)`);
    assert.equal(displayed.length, 17);
    fixture.events.forEach((text, index) => assert.ok(displayed[index].includes(text)));
    assert.ok(displayed[16].includes(strings.thread));
    const widths = await evaluate(win, `['${body}','${card} p.chapter-full-summary','${card} .chapter-events li:last-child'].map(selector=>{
      const node=document.querySelector(selector);return {selector,scroll:node.scrollWidth,client:node.clientWidth};})`);
    assert.ok(widths.every(({ scroll, client }) => scroll <= client + 1), `horizontal overflow: ${JSON.stringify(widths)}`);
    await screenshot(win, root, `${evidence.phase}-${width}-expanded`, evidence);
    await evaluate(win, `document.querySelectorAll('${card} .chapter-events li')[15].scrollIntoView({block:'center',behavior:'instant'})`);
    await screenshot(win, root, `${evidence.phase}-${width}-event16`, evidence);
    const before = await evaluate(win, `document.querySelector('${card}').getBoundingClientRect().top`);
    await click(win, "#storyNotebookDrawerRefreshButton");
    await waitFor(win, "refreshed chapter details retained", `${count} === 12 && !state.chapterReadBusy && document.querySelector('${details}').open`);
    const after = await evaluate(win, `document.querySelector('${card}').getBoundingClientRect().top`);
    assert.ok(Math.abs(before - after) < 4, `refresh must preserve the reading position: ${before} -> ${after}`);
    evidence.readingChecks.push({ width, height, keyboard, widths, summaryCharacters: fixture.summary.length, events: displayed.length, refreshOffset: after - before });
  }
  const more = `${body} [data-session-chapter-more]`;
  await evaluate(win, `document.querySelector('${more}').scrollIntoView({block:'end',behavior:'instant'})`);
  const anchor = `${body} [data-chapter-id="chapter-1"]`;
  const before = await evaluate(win, `document.querySelector('${anchor}').getBoundingClientRect().top`);
  await click(win, more);
  await waitFor(win, "thirteenth chapter appended", `${count} === 13 && !state.chapterReadBusy`);
  assert.equal(await evaluate(win, `document.querySelector('${details}').open`), true);
  await screenshot(win, root, `${evidence.phase}-page13`, evidence);
  const position = await evaluate(win, `(() => { const body=document.querySelector('${body}'); return {
    top:document.querySelector('${anchor}').getBoundingClientRect().top, scrollTop:body.scrollTop,
    maxScrollTop:body.scrollHeight-body.clientHeight, scaleY:body.getBoundingClientRect().height/body.offsetHeight }; })()`);
  const after = position.top;
  // At the bottom, removing the now-unneeded More button can make the old
  // pixel position unreachable. Require exact retention or that exact clamp.
  const desiredScrollTop = position.scrollTop + (after - before) / position.scaleY;
  assert.ok(Math.abs(before - after) < 4 || (desiredScrollTop > position.maxScrollTop
    && Math.abs(position.scrollTop - position.maxScrollTop) < 2),
  `paging must retain the anchor or reach the exact scroll boundary: ${JSON.stringify({ before, ...position })}`);
  assert.equal(await evaluate(win, `document.querySelector('${body} [data-chapter-id="chapter-13"] p.chapter-summary').textContent`), strings.short);
  assert.ok(evidence.chapterReads.some((read) => read.request?.cursor && read.page?.chapters?.length === 1));
  assert.ok(evidence.chapterReads.every((read) => read.ok && read.adventureId === fixture.adventureId && read.revision === 13 && read.page?.revision === 13));
  assert.equal((await readStatus(win)).activeSave.revision, 13);
  for (const key of ["modelCalls", "chapterModelCalls", "ttsRequests", "audioGenerations"]) assert.equal(evidence[key], 0, key);
  return { ...evidence, adventureId: fixture.adventureId, revision: 13, pagination: { before, ...position, desiredScrollTop } };
}

module.exports = { handlesPhase, runCoordinator, runPhase, createFixture };
