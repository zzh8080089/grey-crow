"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { createSessionContinuationService } = require("./session-continuation");
const { createTurnStore } = require("./turn-store");
const { createTurnMemory } = require("./turn-memory");
const { createOpeningState } = require("./session-opening");
const { readSessionTimeline, readLineageFinale } = require("./session-lineage");
const { loadBuiltInContentPack } = require("../content-v2/built-in-pack");
const { compileContentSnapshot } = require("../content-v2/snapshot-compiler");
const { readContentSnapshot } = require("../content-v2/snapshot-reader");
const { makeTreeWritable, makeTreeReadOnly, hashCanonical } = require("../content-v2/snapshot-utils");
const samples = require("./test-fixtures/turn-samples");

const contentRoot = path.resolve(__dirname, "../../content");
const packPromise = loadBuiltInContentPack({ contentRoot });
const DATE = "2026-09-10T09:00:00.000Z";

async function fixture(t, { locale = "zh-CN", closed = true, includeLicense = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "grey-crow-session-continuation-")));
  const adventuresRoot = path.join(root, "saves");
  await fs.mkdir(adventuresRoot);
  t.after(async () => { await makeTreeWritable(root); await fs.rm(root, { recursive: true, force: true }); });
  const adventureId = "parent";
  const pack = await packPromise;
  await compileContentSnapshot({ adventuresRoot, adventureId, language: locale, plan: pack.defaultPlan,
    requiredSkillRefs: pack.defaultPreset.skills, builtInDomainSkillIds: ["characters"],
    resolvePackRoot: (packId) => path.join(contentRoot, "packs", packId) });
  if (includeLicense) {
    // Default built-in snapshots have no standalone license file. This extra
    // synthetic locked resource proves copying preserves one when it exists.
    const snapshotRoot = path.join(adventuresRoot, adventureId, "content-snapshot");
    await makeTreeWritable(snapshotRoot);
    const license = Buffer.from("Synthetic local fixture license. Preserve this attribution.\n");
    await fs.mkdir(path.join(snapshotRoot, "licenses"));
    await fs.writeFile(path.join(snapshotRoot, "licenses", "fixture-license.txt"), license);
    const lockPath = path.join(snapshotRoot, "manifest.lock.json");
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
    lock.files.push({ relativePath: "licenses/fixture-license.txt", sizeBytes: license.length, sha256: createHash("sha256").update(license).digest("hex") });
    const { schemaVersion, lockId, profileId, createdAt, overallHash, ...basis } = lock;
    lock.overallHash = hashCanonical(basis);
    await fs.writeFile(lockPath, JSON.stringify(lock));
    await makeTreeReadOnly(snapshotRoot);
  }
  const snapshot = await readContentSnapshot({ adventuresRoot, adventureId });
  const identity = { adventureId, databasePath: path.join(adventuresRoot, adventureId, "session.sqlite"), locale, contentVersion: snapshot.lock.overallHash };
  const store = createTurnStore({ ...identity, initialState: createOpeningState({ day: 10 }) });
  const state = samples.initialState();
  state.entities.home.attributes.localizedNames = { "zh-CN": "楼道", "en-US": "Corridor", "ja-JP": "廊下" };
  try {
    commit(store, identity, { narration: [{ id: "summary", text: "你是带着旧照片来到楼道的旅人。" }], events: [
      { id: "opening-proposal", type: "opening.propose", sourceSegmentIds: ["summary"], data: { proposalId: "opening", initialState: state } },
    ], experiences: [] });
    commit(store, identity, { narration: [{ id: "opening", text: "你收好照片，推开楼道的门。" }], events: [
      { id: "opening-confirmation", type: "opening.confirm", sourceSegmentIds: ["opening"], data: { proposalId: "opening" } },
    ], experiences: [] });
    commit(store, identity, samples.borrowBundle());
    commit(store, identity, { narration: [{ id: "rumor", text: "陈姨说，旧仓库的箱子是红色。" }], events: [], experiences: [
      { id: "box", text: "陈姨说箱子是红色。", kind: "claim", knownBy: ["p"], entityIds: ["npc"], eventIds: [], sourceSegmentIds: ["rumor"] },
    ] });
    commit(store, identity, { narration: [{ id: "correction", text: "陈姨确认看错了，箱子其实是黑色。" }], events: [], experiences: [
      { id: "corrected-box", text: "陈姨纠正：箱子是黑色。", kind: "event", knownBy: ["p"], entityIds: ["npc"], eventIds: [], sourceSegmentIds: ["correction"], supersedes: [{ revision: 4, experienceId: "box" }] },
    ] });
    if (closed) closeStory(store, identity);
  } finally { store.close(); }
  const revision = closed ? 7 : 5;
  const request = { requestId: "continue-request", parentAdventureId: adventureId, parentRevision: revision, sourceFinaleId: `finale-${revision}` };
  return { root, adventuresRoot, adventureId, identity, revision, request, snapshot,
    service: createSessionContinuationService({ adventuresRoot, clock: () => DATE }) };
}

function commit(store, identity, bundle) {
  const baseRevision = store.readView().revision;
  const actionId = `story-${baseRevision + 1}`;
  const action = store.beginAction({ actionId, baseRevision, input: `玩家行动 ${baseRevision + 1}`, locale: identity.locale, contentVersion: identity.contentVersion });
  store.commitAction({ actionId, attemptId: action.attemptId, bundle });
}

function closeStory(store, identity) {
  const candidateId = `ending-${store.readView().revision}`;
  commit(store, identity, { narration: [{ id: "offer", text: "借米的约定仍然有效。这一段旅程可以暂告一段落，你愿意吗？" }], events: [
    { id: "propose", type: "finale.propose", sourceSegmentIds: ["offer"], data: { candidateId, closureReason: "PRIVATE_REASON_保留旧结局",
      closedThreads: ["这一阶段的选择已完成"], intentionalOpenThreads: ["借米尚未归还"], finaleTone: "平静" } },
  ], experiences: [] });
  commit(store, identity, { narration: [{ id: "end", text: "你回望楼道，将这一段经历留在身后。" }], events: [
    { id: "confirm", type: "finale.confirm", sourceSegmentIds: ["end"], data: { candidateId } },
  ], experiences: [] });
  const revision = store.readView().revision;
  const job = store.beginChapter({ targetRevision: revision });
  store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: { title: "楼道故事", summary: "借米后，旅程告一段落。",
    keyEvents: [{ text: "旅程暂歇", sources: [{ revision, segmentId: "end" }] }], openThreads: [], mode: "model" } });
  store.sealFinale({ finaleId: `finale-${revision}`, chapterId: `chapter-${revision}` });
}

async function treeEvidence(root, relative = "") {
  const result = [];
  for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
    const target = path.join(root, relative, name);
    const stat = await fs.lstat(target);
    if (stat.isDirectory()) result.push(...await treeEvidence(root, path.join(relative, name)));
    else result.push({ path: path.join(relative, name), hash: createHash("sha256").update(await fs.readFile(target)).digest("hex"),
      size: stat.size, inode: stat.ino, mode: stat.mode, links: stat.nlink, mtime: stat.mtimeMs, ctime: stat.ctimeMs });
  }
  return result;
}

function readDatabase(file, fn) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}
function childIdentity(env, childAdventureId) { return { ...env.identity, adventureId: childAdventureId, databasePath: path.join(env.adventuresRoot, childAdventureId, "session.sqlite") }; }
async function saves(env) { return (await fs.readdir(env.adventuresRoot)).filter((name) => !name.startsWith(".")).sort(); }

test("完整复制锁定内容、许可证、历史与隐密状态，只追加无正文续篇边界，父档案字节不变", async (t) => {
  const env = await fixture(t, { includeLicense: true });
  const parentRoot = path.dirname(env.identity.databasePath);
  const before = await treeEvidence(parentRoot);
  const inherited = readDatabase(env.identity.databasePath, (db) => ({
    turns: db.prepare("SELECT * FROM turns ORDER BY revision").all(),
    experiences: db.prepare("SELECT * FROM experiences ORDER BY revision,experience_id").all(),
    corrections: db.prepare("SELECT * FROM experience_replacements").all(),
    chapters: db.prepare("SELECT * FROM chapters").all(),
  }));
  const result = await env.service.fork(env.request);
  assert.equal(result.status, "created");
  assert.equal(result.revision, 8);
  assert.equal(result.title, "楼道 · 续篇");
  assert.equal(result.createdAt, DATE);
  assert.deepEqual(result.timeline, { storyTurnCount: 7, systemRevisions: [8] });
  assert.equal(result.lineage.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REASON|parent_archive_json|箱子|hidden_key/);
  assert.deepEqual(await treeEvidence(parentRoot), before);
  const child = childIdentity(env, result.childAdventureId);
  readDatabase(child.databasePath, (db) => {
    assert.deepEqual(db.prepare("SELECT * FROM turns WHERE revision<=7 ORDER BY revision").all(), inherited.turns);
    assert.deepEqual(db.prepare("SELECT * FROM experiences ORDER BY revision,experience_id").all(), inherited.experiences);
    assert.deepEqual(db.prepare("SELECT * FROM experience_replacements").all(), inherited.corrections);
    assert.deepEqual(db.prepare("SELECT * FROM chapters").all(), inherited.chapters);
    const boundary = db.prepare("SELECT * FROM turns WHERE revision=8").get();
    assert.equal(boundary.action_id, null);
    assert.deepEqual(JSON.parse(boundary.narration_json), []);
    const state = JSON.parse(boundary.state_json);
    assert.equal(state.opening.phase, "ready");
    assert.deepEqual(state.opening, JSON.parse(inherited.turns.at(-1).state_json).opening);
    assert.equal(state.entities.hidden_key.visibility, "hidden");
    assert.equal(state.commitments["rice-promise"].status, "open");
    assert.equal(state.finale.phase, "idle");
    assert.equal(db.prepare("SELECT count(*) AS n FROM finale_archives").get().n, 0);
    assert.equal(readLineageFinale(db, { adventureId: result.childAdventureId, revision: 7 }).archive.status, "closed");
  });
  const childSnapshot = await readContentSnapshot({ adventuresRoot: env.adventuresRoot, adventureId: result.childAdventureId });
  assert.deepEqual(childSnapshot.profile, { ...env.snapshot.profile, adventureId: result.childAdventureId });
  assert.deepEqual(childSnapshot.lock, env.snapshot.lock);
  assert.ok(env.snapshot.lock.files.some((file) => /licen[cs]e/i.test(file.relativePath)));
  const childFiles = await treeEvidence(path.dirname(child.databasePath));
  assert.ok(childFiles.every((file) => file.links === 1));
  for (const original of before.filter((file) => file.path.startsWith("content-snapshot"))) {
    const copied = childFiles.find((file) => file.path === original.path);
    assert.equal(copied.hash, original.hash);
    assert.notEqual(copied.inode, original.inode);
  }
});

test("父目录删除后子库仍可恢复、归还旧承诺、检索纠正经历，同请求仍查回已推进的子故事", async (t) => {
  const env = await fixture(t);
  const result = await env.service.fork(env.request);
  const parentRoot = path.dirname(env.identity.databasePath);
  await makeTreeWritable(parentRoot); await fs.rm(parentRoot, { recursive: true });
  const child = childIdentity(env, result.childAdventureId);
  const store = createTurnStore(child);
  try {
    const restored = store.readView();
    assert.equal(restored.revision, 8);
    assert.equal(restored.history.length, 7);
    assert.equal(restored.actionId, null);
    commit(store, child, samples.returnBundle());
    assert.equal(store.readView().state.commitments["rice-promise"].status, "fulfilled");
    assert.equal(store.readView().history.length, 8);
    const recalled = createTurnMemory({ store }).recall({ query: "陈姨记得仓库箱子的颜色吗？", entityIds: ["npc"], viewerId: "p", revision: 9 });
    const experiences = recalled.results.filter(item => item.recordType !== "story_source");
    const originals = recalled.results.filter(item => item.recordType === "story_source");
    const corrected = experiences.find(item => item.experience.id === "corrected-box");
    assert.ok(corrected);
    assert.deepEqual(corrected.source, { adventureId: "parent", revision: 5, actionId: "story-5",
      experienceId: "corrected-box", segmentIds: ["correction"] });
    assert.deepEqual(corrected.experience.supersedes, [{ revision: 4, experienceId: "box" }]);
    assert.equal(corrected.passages[0].text, "陈姨确认看错了，箱子其实是黑色。");
    assert.equal(experiences.some(item => item.experience.id === "box"), false);
    assert.ok(originals.length > 0, "independent copied history also supplies original passages without an experience");
    for (const item of originals) {
      assert.equal(Object.hasOwn(item, "experience"), false);
      assert.equal(item.source.adventureId, "parent", "copied raw prose retains the deleted parent's provenance");
      assert.ok([2, 6, 7].includes(item.source.revision), "only ready, unindexed ancestor turns are eligible; not the superseded turn or continuation boundary");
      const original = store.readTurn(item.source.revision);
      assert.equal(item.source.actionId, original.actionId);
      assert.ok(item.passages.length > 0);
      for (const passage of item.passages) {
        assert.equal(passage.truncated, false);
        assert.equal(passage.text, original.narration.find(segment => segment.id === passage.id).text);
      }
    }
    assert.equal(recalled.results.some(item => [4, 8].includes(item.source.revision)), false);
    assert.doesNotMatch(JSON.stringify(recalled), /箱子是红色|hidden_key|尚未露面的访客/);
  } finally { store.close(); }
  const existing = await env.service.fork(env.request);
  assert.equal(existing.status, "existing");
  assert.equal(existing.childAdventureId, result.childAdventureId);
  assert.equal(existing.revision, 9);
  assert.equal(existing.createdAt, result.createdAt);
  readDatabase(child.databasePath, (db) => assert.equal(db.prepare("SELECT count(*) AS n FROM experience_replacements").get().n, 1));
});

for (const [locale, title] of [["en-US", "Corridor · Continuation"], ["ja-JP", "廊下・続編"]]) {
  test(`${locale} 续篇标题与故事语言持久一致，不重写锁定语言`, async (t) => {
    const env = await fixture(t, { locale });
    const created = await env.service.fork(env.request);
    assert.equal(created.title, title); assert.equal(created.locale, locale);
    const otherClock = createSessionContinuationService({ adventuresRoot: env.adventuresRoot, clock: () => "2040-01-01T00:00:00Z" });
    const existing = await otherClock.fork(env.request);
    assert.equal(existing.title, title); assert.equal(existing.createdAt, DATE);
  });
}

test("同请求并发与回执丢失都只发布一个子存档；同请求换来源明确拒绝", async (t) => {
  const env = await fixture(t);
  const second = createSessionContinuationService({ adventuresRoot: env.adventuresRoot });
  const [a, b] = await Promise.all([env.service.fork(env.request), second.fork(env.request)]);
  assert.deepEqual([a.status, b.status], ["created", "existing"]);
  assert.equal(a.childAdventureId, b.childAdventureId);
  await assert.rejects(second.fork({ ...env.request, parentAdventureId: "other-parent" }), { code: "ADVENTURE_CONTINUATION_REQUEST_MISMATCH" });
  assert.equal((await saves(env)).length, 2);
});

test("另有活动冒险时拒绝新请求，已有同请求子存档不被误当冲突", async (t) => {
  const env = await fixture(t);
  const created = await env.service.fork(env.request);
  await assert.rejects(env.service.fork({ ...env.request, requestId: "another-request" }), { code: "ADVENTURE_CONTINUATION_ACTIVE_EXISTS" });
  assert.equal((await env.service.fork(env.request)).childAdventureId, created.childAdventureId);
  assert.equal((await saves(env)).length, 2);
});

test("纯不兼容旧目录不阻止原生续篇，也不解析或改写旧正文", async (t) => {
  const env = await fixture(t);
  const directory = path.join(env.adventuresRoot, "unsupported-old");
  await fs.mkdir(directory);
  const original = "Not JSON: private unsupported story bytes";
  await fs.writeFile(path.join(directory, "state.json"), original);
  const created = await env.service.fork(env.request);
  assert.equal(created.status, "created");
  assert.equal(created.parentAdventureId, env.adventureId);
  assert.equal(await fs.readFile(path.join(directory, "state.json"), "utf8"), original);
  assert.deepEqual(await fs.readdir(directory), ["state.json"]);
});

test("多代续篇保留祖代档案和来源，系统边界不作为新故事回合", async (t) => {
  const env = await fixture(t);
  const original = readDatabase(env.identity.databasePath, db => {
    const row = db.prepare("SELECT t.narration_json,a.request_json FROM turns t JOIN actions a ON a.action_id=t.action_id WHERE t.revision=2").get();
    assert.equal(db.prepare("SELECT count(*) AS count FROM experiences WHERE revision=2").get().count, 0);
    return { narration: JSON.parse(row.narration_json), input: JSON.parse(row.request_json).input };
  });
  const child = await env.service.fork(env.request);
  const identity = childIdentity(env, child.childAdventureId);
  const store = createTurnStore(identity);
  try { commit(store, identity, samples.returnBundle()); closeStory(store, identity); } finally { store.close(); }
  const childBefore = await treeEvidence(path.dirname(identity.databasePath));
  const grand = await env.service.fork({ requestId: "grandchild-request", parentAdventureId: child.childAdventureId, parentRevision: 11, sourceFinaleId: "finale-11" });
  assert.equal(grand.revision, 12);
  assert.deepEqual(grand.timeline, { storyTurnCount: 10, systemRevisions: [8, 12] });
  assert.equal(grand.lineage.length, 2);
  assert.deepEqual(await treeEvidence(path.dirname(identity.databasePath)), childBefore);
  const parentRoot = path.dirname(env.identity.databasePath);
  await makeTreeWritable(parentRoot); await fs.rm(parentRoot, { recursive: true });
  await makeTreeWritable(path.dirname(identity.databasePath)); await fs.rm(path.dirname(identity.databasePath), { recursive: true });
  const grandIdentity = childIdentity(env, grand.childAdventureId);
  readDatabase(grandIdentity.databasePath, (db) => {
    const timeline = readSessionTimeline(db, { adventureId: grand.childAdventureId, revision: 12 });
    assert.equal(timeline.lineage[0].parentAdventureId, "parent");
    assert.equal(readLineageFinale(db, { adventureId: grand.childAdventureId, revision: 7 }).archive.status, "closed");
    assert.equal(readLineageFinale(db, { adventureId: grand.childAdventureId, revision: 11 }).archive.status, "closed");
  });
  assert.equal((await env.service.fork({ requestId: "grandchild-request", parentAdventureId: child.childAdventureId, parentRevision: 11, sourceFinaleId: "finale-11" })).status, "existing");
  const grandStore = createTurnStore(grandIdentity);
  try {
    const raw = grandStore.listUnindexedStoryRecords({ revision: 12, viewerId: "p" });
    assert.deepEqual(raw.records.map(record => [record.revision, record.source.adventureId]), [
      [2, "parent"], [6, "parent"], [7, "parent"], [10, child.childAdventureId], [11, child.childAdventureId],
    ], "local raw sources retain both ancestor identities and omit opening proposals and system boundaries");
    const oldSource = raw.records.find(record => record.revision === 2);
    assert.equal(oldSource.adventureId, grand.childAdventureId);
    assert.deepEqual(oldSource.passages, original.narration);
    assert.equal(oldSource.playerInput, original.input);
    assert.equal(oldSource.recordType, "story_source"); assert.equal(Object.hasOwn(oldSource, "experience"), false);
    for (const [target, origin, startRevision] of [[7, "parent", 1], [11, child.childAdventureId, 8]]) {
      const job = grandStore.readChapterJob(`chapter-${target}`);
      const page = grandStore.readChapterSource({ chapterId: job.chapterId, attemptId: job.attemptId });
      assert.deepEqual(page.turns[0].turnStart.source, { adventureId: origin, revision: startRevision });
      assert.ok(page.turns.every((turn) => turn.turnStart.source.adventureId === origin));
      assert.ok(page.turns.every((turn) => turn.turnStart.source.revision === turn.revision - 1));
    }
    commit(grandStore, grandIdentity, { narration: [{ id: "grand-opening", text: "你仍在楼道里，停下来听了一会儿。" }], events: [], experiences: [] });
    const job = grandStore.beginChapter({ targetRevision: 13 });
    const page = grandStore.readChapterSource({ chapterId: job.chapterId, attemptId: job.attemptId });
    assert.deepEqual(page.turns.map((turn) => turn.revision), [13]);
    assert.deepEqual(page.turns[0].turnStart, { source: { adventureId: grand.childAdventureId, revision: 12 },
      location: { id: "home", name: "楼道" } });
    assert.equal(page.turns[0].storyTurn, 11);
  } finally { grandStore.close(); }
  const beforeColdRead = createHash("sha256").update(await fs.readFile(grandIdentity.databasePath)).digest("hex");
  const restored = createTurnStore(grandIdentity);
  try {
    const memory = createTurnMemory({ store: restored });
    for (const outputMode of ["full", "model"]) {
      const packet = memory.recall({ revision: 12, viewerId: "p", query: "照片", outputMode });
      assert.equal(packet.results.length, 1); assert.equal(packet.truncated, false);
      const recalled = packet.results[0];
      assert.deepEqual(recalled.source, { adventureId: "parent", revision: 2, actionId: "story-2", segmentIds: ["opening"] });
      assert.equal(recalled.recordType, "story_source"); assert.equal(Object.hasOwn(recalled, "experience"), false);
      assert.equal(recalled.passages[0].text, original.narration[0].text);
      assert.equal(recalled.passages[0].truncated, false); assert.equal(recalled.playerInput.text, original.input);
    }
    const current = restored.listUnindexedStoryRecords({ revision: 13, viewerId: "p", afterRevision: 11 });
    assert.deepEqual(current.records.map(record => record.source), [{ adventureId: grand.childAdventureId, revision: 13 }]);
    assert.ok(current.records.every(record => ![0, 8, 12].includes(record.revision)));
  } finally { restored.close(); }
  assert.equal(createHash("sha256").update(await fs.readFile(grandIdentity.databasePath)).digest("hex"), beforeColdRead);
  await assert.rejects(fs.stat(parentRoot), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.dirname(identity.databasePath)), { code: "ENOENT" });
});

test("发布前失败不留下可玩半副本，发布后回执丢失查回同一完整子库且错误不泄漏", async (t) => {
  const env = await fixture(t);
  const failureService = (phase) => createSessionContinuationService({ adventuresRoot: env.adventuresRoot, faultInjector(step) {
    if (step === phase) throw new Error("PRIVATE_TOKEN_Bearer_only_for_test");
  } });
  await assert.rejects(failureService("before_publish").fork(env.request), (error) => error.code === "ADVENTURE_CONTINUATION_FAILED" && !/PRIVATE_TOKEN/.test(error.message));
  assert.deepEqual(await saves(env), ["parent"]);
  await assert.rejects(failureService("after_publish").fork(env.request), { code: "ADVENTURE_CONTINUATION_FAILED" });
  const recovered = await env.service.fork(env.request);
  assert.equal(recovered.status, "existing");
  assert.equal(recovered.revision, 8);
  assert.equal((await saves(env)).length, 2);
});

function childProcess(env, { crashAt, request = env.request } = {}) {
  const source = `const {createSessionContinuationService}=require(process.argv[1]); const config=JSON.parse(process.argv[2]);
    const service=createSessionContinuationService({adventuresRoot:config.root,faultInjector:(step)=>{if(step===config.crashAt)process.exit(81);}});
    service.fork(config.request).then(result=>{process.stdout.write(JSON.stringify(result));},error=>{process.stderr.write(error.code||'FAILED');process.exitCode=1;});`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", source, require.resolve("./session-continuation"), JSON.stringify({ root: env.adventuresRoot, crashAt, request })],
      { env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk; }); child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject); child.on("close", (code) => resolve({ code, out, err }));
  });
}

test("实际进程在边界写入后退出：未发布隐藏副本可安全重建，系统锁随退出释放", async (t) => {
  const env = await fixture(t);
  const before = await treeEvidence(path.dirname(env.identity.databasePath));
  const crashed = await childProcess(env, { crashAt: "boundary_committed" });
  assert.equal(crashed.code, 81, crashed.err);
  assert.deepEqual(await saves(env), ["parent"]);
  const recovered = await env.service.fork(env.request);
  assert.equal(recovered.status, "created"); assert.equal(recovered.revision, 8);
  assert.deepEqual(await treeEvidence(path.dirname(env.identity.databasePath)), before);
});

test("实际进程在原子发布后退出：重试不追加边界或改变已经发布的创建时间", async (t) => {
  const env = await fixture(t);
  assert.equal((await childProcess(env, { crashAt: "after_publish" })).code, 81);
  const recovered = await env.service.fork(env.request);
  assert.equal(recovered.status, "existing"); assert.equal(recovered.revision, 8);
  assert.equal(recovered.lineage.length, 1);
});

test("两个独立进程同时复制，同请求收敛为一个 created 和一个 existing", async (t) => {
  const env = await fixture(t);
  const results = await Promise.all([childProcess(env), childProcess(env)]);
  for (const item of results) assert.equal(item.code, 0, item.err);
  const values = results.map((item) => JSON.parse(item.out));
  assert.deepEqual(values.map((item) => item.status).sort(), ["created", "existing"]);
  assert.equal(values[0].childAdventureId, values[1].childAdventureId);
  assert.equal((await saves(env)).length, 2);
});

test("源版本、封存身份或未结束状态不匹配均拒绝", async (t) => {
  const env = await fixture(t);
  await assert.rejects(env.service.fork({ ...env.request, parentRevision: 6, sourceFinaleId: "finale-6" }), { code: "ADVENTURE_CONTINUATION_PARENT_INVALID" });
  const other = await fixture(t, { closed: false });
  await assert.rejects(other.service.fork(other.request), { code: "ADVENTURE_CONTINUATION_PARENT_NOT_CLOSED" });
  assert.deepEqual(await saves(env), ["parent"]);
});

for (const draw of [0, 9999]) {
  test(`特殊结局分支 ${draw === 0 ? "grey_crow_view" : "standard_extreme_ending"} 永久拒绝复制`, async (t) => {
    const env = await fixture(t, { closed: false });
    const store = createTurnStore({ ...env.identity, terminalRandomInt: () => draw });
    const eventBundle = (type) => ({ narration: [{ id: "decision", text: "这是虚构故事里角色作出的明确决定。" }], events: [
      { id: "choice", type, sourceSegmentIds: ["decision"], data: type === "extreme.propose"
        ? { candidateId: "special", characterId: "p", intentReason: "角色想结束自身旅程。", fictionalContext: "仅合成虚构角色的选择。" }
        : { candidateId: "special" } },
    ], experiences: [] });
    try {
      commit(store, env.identity, eventBundle("extreme.propose"));
      commit(store, env.identity, eventBundle("extreme.confirm"));
      commit(store, env.identity, eventBundle("extreme.confirm"));
      const action = store.beginAction({ actionId: "final-special", baseRevision: 8, input: "明确确认虚构角色的最终选择。", locale: env.identity.locale, contentVersion: env.identity.contentVersion });
      store.reserveTerminal({ actionId: action.actionId, attemptId: action.attemptId, candidateId: "special" });
      store.commitAction({ actionId: action.actionId, attemptId: action.attemptId, bundle: eventBundle("extreme.confirm") });
      const job = store.beginChapter({ targetRevision: 9 });
      store.commitChapter({ chapterId: job.chapterId, attemptId: job.attemptId, chapter: { title: "特殊尾声", summary: "虚构故事结束。", keyEvents: [
        { text: "最后的决定", sources: [{ revision: 9, segmentId: "decision" }] },
      ], openThreads: [], mode: "model" } });
      store.sealFinale({ finaleId: "finale-9", chapterId: job.chapterId });
    } finally { store.close(); }
    const before = await treeEvidence(path.dirname(env.identity.databasePath));
    await assert.rejects(env.service.fork({ ...env.request, parentRevision: 9, sourceFinaleId: "finale-9" }), { code: "ADVENTURE_CONTINUATION_FORBIDDEN" });
    assert.deepEqual(await treeEvidence(path.dirname(env.identity.databasePath)), before);
    assert.deepEqual(await saves(env), ["parent"]);
  });
}

for (const kind of ["symlink", "hardlink", "mixed", "hot", "wal"]) {
  test(`拒绝 ${kind} 存档，不写父库、不发布子存档`, async (t) => {
    const env = await fixture(t);
    const root = path.dirname(env.identity.databasePath);
    if (kind === "symlink") {
      const source = path.join(root, "content-profile.json"); const other = path.join(env.root, "profile-copy");
      await fs.copyFile(source, other); await fs.chmod(root, 0o700); await fs.unlink(source); await fs.symlink(other, source);
    } else if (kind === "hardlink") await fs.link(env.identity.databasePath, path.join(env.root, "shared-db"));
    else if (kind === "mixed") await fs.writeFile(path.join(root, "meta.json"), "{}");
    else if (kind === "hot") await fs.writeFile(`${env.identity.databasePath}-journal`, Buffer.from("d9d505f920a163d7000000000000000000000000000000000000000000", "hex"));
    else await fs.writeFile(`${env.identity.databasePath}-wal`, "synthetic");
    const original = createHash("sha256").update(await fs.readFile(env.identity.databasePath)).digest("hex");
    await assert.rejects(env.service.fork(env.request), { code: ["symlink", "hardlink"].includes(kind) ? "SAVE_PATH_INVALID" : kind === "hot" ? "ADVENTURE_CONTINUATION_RECOVERY_REQUIRED" : "SAVE_FORMAT_UNSUPPORTED" });
    assert.equal(createHash("sha256").update(await fs.readFile(env.identity.databasePath)).digest("hex"), original);
    assert.deepEqual(await saves(env), ["parent"]);
  });
}

test("复制期间锁定内容变动明确拒绝，不把新旧文件混合发布", async (t) => {
  const env = await fixture(t);
  const service = createSessionContinuationService({ adventuresRoot: env.adventuresRoot, async faultInjector(phase) {
    if (phase !== "before_publish") return;
    const profile = path.join(env.adventuresRoot, "parent", "content-profile.json");
    await fs.chmod(profile, 0o600); await fs.appendFile(profile, " ");
  } });
  await assert.rejects(service.fork(env.request), { code: "ADVENTURE_CONTINUATION_SOURCE_CHANGED" });
  assert.deepEqual(await saves(env), ["parent"]);
});

test("路径穿越、错误请求与非整版本在任何数据访问前拒绝", async (t) => {
  const env = await fixture(t);
  for (const request of [{ ...env.request, parentAdventureId: "../parent" }, { ...env.request, requestId: "../request" },
    { ...env.request, parentRevision: 0 }, { ...env.request, parentRevision: 1.5 }, { ...env.request, parentRevision: -1 }, { ...env.request, extra: true }]) {
    await assert.rejects(env.service.fork(request), { code: "ADVENTURE_CONTINUATION_INPUT_INVALID" });
  }
  // A well-formed but incorrect finale ID must not match another archive.
  await assert.rejects(env.service.fork({ ...env.request, sourceFinaleId: "not-this-finale" }), { code: "ADVENTURE_CONTINUATION_PARENT_INVALID" });
});
