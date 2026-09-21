/* Node-only regression for the production quill controller. It extracts the
 * real function from app.js and drives its observers and RAF clock directly. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeEvents {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
  emit(name) { for (const callback of this.listeners.get(name) || []) callback(); }
}

class FakeStyle {
  constructor() { this.values = new Map(); this.backgroundPosition = ""; }
  setProperty(name, value) { this.values.set(name, value); }
  removeProperty(name) { this.values.delete(name); }
  getPropertyValue(name) { return this.values.get(name) || ""; }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  contains(name) { return this.values.has(name); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
}

class FakeMutationObserver {
  static instances = [];
  constructor(callback) { this.callback = callback; FakeMutationObserver.instances.push(this); }
  observe(target) { this.target = target; }
  static trigger(target) {
    for (const observer of FakeMutationObserver.instances) if (observer.target === target) observer.callback();
  }
}

const source = fs.readFileSync(require.resolve("./app.js"), "utf8");
const match = source.match(/function initializeWritingQuill\(\) \{[\s\S]*?\n\}\n\nfunction installNotebookObjectIcons/);
assert.ok(match, "extract the production initializeWritingQuill function");
const productionFunction = match[0].replace(/\nfunction installNotebookObjectIcons$/, "");

const document = new FakeEvents();
document.hidden = false;
document.body = {};
const reducedMotion = new FakeEvents();
reducedMotion.matches = false;
const host = { dataset: { hostPhase: "busy" }, querySelector: (selector) => selector === ".writing-quill" ? sprite : null };
const sprite = { style: new FakeStyle() };
const gameView = { classList: new FakeClassList() };
const state = { gameUiLayout: "story-notebook-v1" };
const ui = { storyNotebookHostStatus: host, gameView };
let nextRaf = 0;
const pendingRafs = new Map();
const cancelledRafs = [];
const requestAnimationFrame = (callback) => { const id = ++nextRaf; pendingRafs.set(id, callback); return id; };
const cancelAnimationFrame = (id) => { cancelledRafs.push(id); pendingRafs.delete(id); };
const step = (at) => {
  assert.equal(pendingRafs.size, 1, "exactly one animation frame is pending");
  const [id, callback] = pendingRafs.entries().next().value;
  pendingRafs.delete(id);
  callback(at);
};
const context = {
  window: { NotebookWritingQuillData: { frames: 48, columns: 8, fps: 20 }, matchMedia: () => reducedMotion },
  document, state, ui, MutationObserver: FakeMutationObserver,
  requestAnimationFrame, cancelAnimationFrame, Math,
};
vm.runInNewContext(`${productionFunction}\ninitializeWritingQuill();`, context);

step(0);
assert.equal(sprite.style.backgroundPosition, "0px 0px", "wait begins at its resting frame");
step(100);
const afterFirstAdvance = sprite.style.backgroundPosition;
assert.notEqual(afterFirstAdvance, "0px 0px", "100 ms advances the real atlas");

// renderTurnStatus writes busy again every second. The observer must retain
// both the pending RAF and its progress instead of restarting from frame zero.
host.dataset.hostPhase = "busy";
FakeMutationObserver.trigger(host);
assert.equal(pendingRafs.size, 1, "same busy write does not schedule a second RAF");
step(200);
const afterRepeatedBusy = sprite.style.backgroundPosition;
assert.notEqual(afterRepeatedBusy, "0px 0px", "same busy write does not reset the atlas");
assert.notEqual(afterRepeatedBusy, afterFirstAdvance, "the atlas continues after repeated busy writes");

host.dataset.hostPhase = "finale";
FakeMutationObserver.trigger(host);
step(300);
assert.notEqual(sprite.style.backgroundPosition, "0px 0px", "busy to finale keeps the active sequence continuous");
assert.notEqual(sprite.style.getPropertyValue("--quill-motion-angle"), "", "active sequence supplies continuous pose motion");

const beforePause = sprite.style.backgroundPosition;
document.hidden = true;
document.emit("visibilitychange");
assert.equal(pendingRafs.size, 0, "hidden document cancels RAF");
document.hidden = false;
document.emit("visibilitychange");
step(10_000);
assert.equal(sprite.style.backgroundPosition, beforePause, "foreground resume has no elapsed-time frame jump");
step(10_100);
assert.notEqual(sprite.style.backgroundPosition, beforePause, "foreground resume advances normally on the next 100 ms frame");

gameView.classList.add("hidden");
FakeMutationObserver.trigger(gameView);
assert.equal(pendingRafs.size, 0, "hidden game view cancels RAF");
gameView.classList.remove("hidden");
FakeMutationObserver.trigger(gameView);
step(30_000);
assert.notEqual(sprite.style.backgroundPosition, "0px 0px", "shown game view resumes without restarting the atlas");

reducedMotion.matches = true;
reducedMotion.emit("change");
assert.equal(pendingRafs.size, 0, "reduced motion cancels RAF");
assert.equal(sprite.style.backgroundPosition, "0px 0px", "reduced motion uses the resting frame");
assert.equal(sprite.style.getPropertyValue("--quill-motion-angle"), "", "reduced motion clears pose offsets");
assert.ok(cancelledRafs.length >= 3, "each inactive transition cancels its queued RAF");

console.log("notebook quill RAF/observer regression: ok");
