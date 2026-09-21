"use strict";

const assert = require("node:assert/strict");
const {
  DEFAULT_WINDOW_MODE,
  getWindowModeSpec,
  listWindowModeSpecs,
  normalizeWindowMode,
  resolveAvailableWindowMode,
} = require("../window-modes");

assert.equal(DEFAULT_WINDOW_MODE, "standard");
assert.deepEqual(
  listWindowModeSpecs().map((mode) => mode.id),
  ["compact", "standard", "large", "qhd", "fullscreen"]
);
assert.deepEqual(
  listWindowModeSpecs().filter((mode) => mode.kind === "windowed").map((mode) => [
    mode.contentWidth,
    mode.contentHeight,
  ]),
  [[1280, 720], [1600, 900], [1920, 1080], [2560, 1440]]
);
assert.equal(normalizeWindowMode("large"), "large");
assert.equal(normalizeWindowMode("qhd"), "qhd");
assert.equal(normalizeWindowMode("arbitrary"), "standard");
assert.equal(getWindowModeSpec("standard").contentWidth, 1600);
assert.equal(resolveAvailableWindowMode("fullscreen", () => false), "fullscreen");
assert.equal(resolveAvailableWindowMode("qhd"), "qhd");
for (const [contentWidth, contentHeight, expected] of [
  [2560, 1440, "qhd"],
  [2560, 1400, "large"],
  [1920, 1080, "large"],
  [1600, 900, "standard"],
  [1280, 720, "compact"],
  [1280, 700, "fullscreen"],
]) {
  assert.equal(
    resolveAvailableWindowMode("qhd", (mode) =>
      mode.contentWidth <= contentWidth && mode.contentHeight <= contentHeight),
    expected,
    `2560x1440 window must keep the largest available fallback within ${contentWidth}x${contentHeight}`
  );
}
assert.equal(
  resolveAvailableWindowMode("large", (mode) => mode.contentWidth <= 1600),
  "standard"
);
assert.equal(
  resolveAvailableWindowMode("standard", (mode) => mode.contentWidth <= 1280),
  "compact"
);
assert.equal(resolveAvailableWindowMode("compact", () => false), "fullscreen");

console.log("Window mode checks passed.");
