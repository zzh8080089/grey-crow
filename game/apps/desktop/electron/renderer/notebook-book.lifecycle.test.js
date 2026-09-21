/* Node-only fake-DOM lifecycle check. It proves cancellation and readable
 * gating contracts, not Electron video decoding, SVG masking or rendering. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { (this.listeners.get(type) || this.listeners.set(type, []).get(type)).push(fn); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== fn)); }
  emit(type, detail) { for (const fn of [...(this.listeners.get(type) || [])]) fn(detail); }
}
class FakeElement extends FakeEventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag; this.children = []; this.parentNode = null; this.dataset = {}; this.style = { setProperty() {}, removeProperty() {} }; this.className = ''; this.id = ''; this.hidden = false; this.inert = false; this.attributes = new Map(); this.classList = { values: new Set(), add: (x) => this.classList.values.add(x), remove: (x) => this.classList.values.delete(x), toggle: (x, on) => on ? this.classList.values.add(x) : this.classList.values.delete(x), contains: (x) => this.classList.values.has(x) }; }
  append(...nodes) { for (const node of nodes) { node.remove?.(); node.parentNode = this; this.children.push(node); } }
  prepend(node) { node.remove?.(); node.parentNode = this; this.children.unshift(node); }
  insertBefore(node, reference) { const at = this.children.indexOf(reference); node.remove?.(); node.parentNode = this; this.children.splice(at < 0 ? this.children.length : at, 0, node); }
  before(node) { const at = this.parentNode.children.indexOf(this); node.remove?.(); node.parentNode = this.parentNode; this.parentNode.children.splice(at, 0, node); }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  removeAttribute(k) { this.attributes.delete(k); if (k.startsWith('data-')) delete this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; }
  querySelector(selector) { if (this._selector?.[selector]) return this._selector[selector]; return this.children.find((node) => selector[0] === '#' ? node.id === selector.slice(1) : selector[0] === '.' ? node.className.split(' ').includes(selector.slice(1)) : node.tagName === selector) || null; }
  set innerHTML(_html) {
    if (this.tagName === 'svg') { this._selector = { 'mask path': new FakeElement('path'), feImage: new FakeElement('feImage') }; return; }
    this.children = [];
    for (const [tag, id, classes] of [['img', 'themeStudyImage', 'gc-notebook-book-still'], ['video', 'themeOpeningVideo', 'gc-notebook-book-video'], ['div', 'bookReadingSurface', ''], ['button', '', 'gc-notebook-book-skip'], ['span', '', 'gc-notebook-book-label']]) { const node = new FakeElement(tag); node.id = id; node.className = classes; if (tag === 'video') { let nextFrame = 0; Object.assign(node, { playCalls: 0, pause() {}, load() {}, play: async () => { node.playCalls += 1; }, requestVideoFrameCallback(fn) { node.frame = fn; return ++nextFrame; }, cancelVideoFrameCallback() { node.frame = null; }, fireFrame(mediaTime) { const fn = node.frame; node.frame = null; fn?.(0, { mediaTime }); }, defaultMuted: false, volume: 1 }); } this.append(node); }
  }
}
const document = new FakeEventTarget();
document.hidden = false;
document.body = new FakeElement('body');
document.createElement = (tag) => new FakeElement(tag);
document.createElementNS = (_ns, tag) => new FakeElement(tag);
const window = { matchMedia: () => ({ matches: false }), NotebookPageProjectionData: { fps: 24, frameCount: 144, visibleFromFrame: 1, frames: [{ frame: 1, corners: [[24,18],[1440,18],[1440,882],[24,882]] }, { frame: 132, corners: [[24,18],[1440,18],[1440,882],[24,882]] }] }, NotebookPageRevealData: { firstVisibleFrame: 1, frames: [{ frame: 1, fullClear: true }, { frame: 132, fullClear: true }] } };
const context = { window, document, Element: FakeElement, console, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(require.resolve('./notebook-book.js'), 'utf8'), context);

const host = new FakeElement('div'); const game = new FakeElement('div'); game.id = 'gameView'; host.append(game);
let active = null, currentTheme = 'dark'; const reading = [];
const book = window.GreyCrowNotebookBook.create({ game, host, getTheme: () => currentTheme, getLocale: () => 'zh-CN', isCurrent: (binding) => binding === active, onReading: (event) => reading.push(event) });
const first = {}; active = first;
assert.equal(book.prepare(first), true); assert.equal(game.inert, true); assert.equal(document.body.dataset.materialStudy, 'true'); assert.equal(document.body.dataset.bookPresentation, 'active');
const video = host.children[0].querySelector('#themeOpeningVideo'); const opening = book.open(first); video.emit('loadedmetadata'); assert.equal(await opening, true);
const readable = book.whenReadable(first); video.fireFrame((132 - 1) / 24); assert.equal(book.getState().handoff, true); assert.equal(await Promise.race([readable, Promise.resolve('still-opening')]), 'still-opening');
video.emit('ended'); assert.equal(await readable, true); assert.equal(book.getState().phase, 'reading'); assert.equal(reading[0].focus, true);
const stage = host.children[0]; stage.querySelector('#themeStudyImage').emit('error'); assert.equal(stage.dataset.stillError, 'true');
currentTheme = 'light'; assert.equal(book.sync(), true); assert.equal(book.getState().theme, 'light'); assert.equal(stage.dataset.stillError, undefined);
const still = stage.querySelector('#themeStudyImage');
const stillSource = still.src;
let sourceWrites = 0;
Object.defineProperty(still, 'src', { configurable: true, get: () => stillSource, set: () => { sourceWrites += 1; } });
const replacement = { ...first, sessionId: 'settings-replacement' }; active = replacement;
assert.equal(book.rebindReading(replacement), true);
assert.equal(book.getState().binding.sessionId, replacement.sessionId);
assert.equal(book.getState().phase, 'reading'); assert.equal(stage.hidden, false); assert.equal(game.inert, false);
assert.equal(sourceWrites, 0, 'same-page settings replacement must not reload the decoded paper');
assert.equal(await book.whenReadable(first), false, 'old-session delivery cannot become readable');
assert.equal(await book.whenReadable(replacement), true);
const otherAdventure = { ...replacement, adventureId: 'another' }; active = otherAdventure;
assert.equal(book.rebindReading(otherAdventure), false, 'another story cannot inherit the visible page');
delete still.src; still.src = stillSource;
const second = { adventureId: 'a', sessionId: 's', sessionMode: 'play', revision: 1 }; active = second; assert.equal(book.prepare(second), true);
assert.equal(book.rebindReading(second), false, 'an opening page cannot bypass its readiness gate');
const pendingOpen = book.open(second); book.skip(); assert.equal(await pendingOpen, false, 'skip invalidates metadata wait and prevents old play continuation');
const third = { adventureId: 'a', sessionId: 't', sessionMode: 'play', revision: 1 }; active = third; book.prepare(third);
const samePageWait = book.whenReadable({ ...third, revision: 2 }); const blocked = book.whenReadable(third); book.cancel(); assert.equal(await samePageWait, false); assert.equal(await blocked, false); assert.equal(document.body.dataset.bookPhase, undefined);
const fourth = { adventureId: 'a', sessionId: 'u', sessionMode: 'play', revision: 1 }; active = fourth; book.prepare(fourth); document.hidden = true;
const hiddenOpen = book.open(fourth); video.emit('loadedmetadata'); assert.equal(await hiddenOpen, true); assert.equal(video.playCalls, 1, 'metadata while hidden must not start background playback');
document.hidden = false; document.emit('visibilitychange'); await Promise.resolve(); assert.equal(video.playCalls, 2, 'foreground resumes the deferred opening exactly once'); book.cancel();
const fifth = { adventureId: 'a', sessionId: 'v', sessionMode: 'play', revision: 1 }; active = fifth; book.prepare(fifth); document.hidden = true;
const cancelledHiddenOpen = book.open(fifth); book.cancel(); assert.equal(await cancelledHiddenOpen, false); document.hidden = false; document.emit('visibilitychange'); await Promise.resolve(); assert.equal(video.playCalls, 2, 'cancelled binding never resumes after foregrounding');
book.dispose(); assert.equal(host.children.includes(game), true);
console.log('notebook-book fake DOM lifecycle: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
