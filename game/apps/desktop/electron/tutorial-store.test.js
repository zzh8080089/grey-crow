"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTutorialStore } = require("./tutorial-store");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-tutorial-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, store: createTutorialStore({ dataRoot: root }), file: path.join(root, "tutorial-progress.json") };
}

test("first visit, skip, restart and reset preserve all other player files", t => {
  const { root, store } = fixture(t);
  for (const name of ["settings.json", "credentials.bin", "story.sqlite"]) fs.writeFileSync(path.join(root, name), `fixture:${name}`);
  assert.deepEqual(store.read(), { version: 1, dismissed: false });
  store.setDismissed(true);
  assert.equal(createTutorialStore({ dataRoot: root }).read().dismissed, true);
  store.setDismissed(false);
  assert.equal(createTutorialStore({ dataRoot: root }).read().dismissed, false);
  for (const name of ["settings.json", "credentials.bin", "story.sqlite"]) assert.equal(fs.readFileSync(path.join(root, name), "utf8"), `fixture:${name}`);
  assert.deepEqual(fs.readdirSync(root).sort(), ["credentials.bin", "settings.json", "story.sqlite", "tutorial-progress.json"]);
});

test("invalid values cannot reset acknowledged progress", t => {
  const { store, file } = fixture(t);
  store.setDismissed(true);
  const before = fs.readFileSync(file);
  for (const value of [null, undefined, 0, 1, "false", {}, []]) assert.throws(() => store.setDismissed(value), /INVALID_TUTORIAL_PROGRESS/);
  assert.deepEqual(fs.readFileSync(file), before);
});

test("in-game tour has independent acknowledgement across restart and reset", t => {
  const { root, store } = fixture(t);
  const gameTour = createTutorialStore({ dataRoot: root, topic: "game-ui" });
  store.setDismissed(true);
  assert.equal(gameTour.read().dismissed, false, "skipping the entry guide must not skip the UI tour");
  gameTour.setDismissed(true);
  assert.equal(createTutorialStore({ dataRoot: root, topic: "game-ui" }).read().dismissed, true);
  gameTour.setDismissed(false);
  assert.equal(store.read().dismissed, true, "resetting one topic cannot change the other record");
  for (const topic of ["../settings", "settings.json", "__proto__", null]) {
    assert.throws(() => createTutorialStore({ dataRoot: root, topic }), /INVALID_TUTORIAL_TOPIC/);
  }
  assert.deepEqual(fs.readdirSync(root).sort(), ["game-tour-progress.json", "tutorial-progress.json"]);
});

test("unreadable progress is reported; an explicit reset can recover malformed JSON", t => {
  const { store, file } = fixture(t);
  for (const value of ["{", '{"version":2,"dismissed":true}', '{"version":1,"dismissed":"true"}', "x".repeat(1025)]) {
    fs.writeFileSync(file, value);
    assert.throws(() => store.read());
  }
  store.setDismissed(false);
  assert.deepEqual(store.read(), { version: 1, dismissed: false });
});

test("failed persistence is not reported as success or left with a temporary file", t => {
  const { store, root, file } = fixture(t);
  fs.mkdirSync(file);
  assert.throws(() => store.setDismissed(true));
  assert.deepEqual(fs.readdirSync(root), ["tutorial-progress.json"]);
});

test("progress does not read linked files and atomic reset leaves their targets unchanged", t => {
  const { store, root, file } = fixture(t);
  const other = path.join(root, "other.json");
  const original = '{"version":1,"dismissed":true,"secret":"synthetic"}';
  fs.writeFileSync(other, original);
  fs.linkSync(other, file);
  assert.throws(() => store.read());
  store.setDismissed(false);
  assert.equal(fs.readFileSync(other, "utf8"), original);
  assert.deepEqual(store.read(), { version: 1, dismissed: false });
});

test("tutorial external links stay on fixed official destinations", () => {
  const { getModelHelpUrl, getModelHelpCatalog } = require("./model-connections");
  assert.equal(getModelHelpUrl("deepseek-platform"), "https://platform.deepseek.com/");
  assert.equal(getModelHelpUrl("deepseek-keys"), "https://platform.deepseek.com/api_keys");
  assert.equal(getModelHelpUrl("deepseek-billing"), "https://platform.deepseek.com/top_up");
  assert.equal(getModelHelpUrl("deepseek-pricing"), "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/");
  for (const id of ["https://evil.invalid/", "javascript:alert(1)", "__proto__", "constructor", {}, null]) assert.equal(getModelHelpUrl(id), "");
  assert.equal(getModelHelpCatalog().entries.some(entry => entry.id === "deepseek-platform"), false);
});
