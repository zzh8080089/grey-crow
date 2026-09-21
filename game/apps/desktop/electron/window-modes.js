"use strict";

const DEFAULT_WINDOW_MODE = "standard";
const WINDOW_MODE_SPECS = Object.freeze([
  Object.freeze({
    id: "compact",
    kind: "windowed",
    contentWidth: 1280,
    contentHeight: 720,
  }),
  Object.freeze({
    id: "standard",
    kind: "windowed",
    contentWidth: 1600,
    contentHeight: 900,
  }),
  Object.freeze({
    id: "large",
    kind: "windowed",
    contentWidth: 1920,
    contentHeight: 1080,
  }),
  Object.freeze({
    id: "qhd",
    kind: "windowed",
    contentWidth: 2560,
    contentHeight: 1440,
  }),
  Object.freeze({
    id: "fullscreen",
    kind: "fullscreen",
    contentWidth: null,
    contentHeight: null,
  }),
]);
const WINDOW_MODE_BY_ID = new Map(WINDOW_MODE_SPECS.map((mode) => [mode.id, mode]));
const SUPPORTED_WINDOW_MODES = new Set(WINDOW_MODE_BY_ID.keys());

function normalizeWindowMode(value, fallback = DEFAULT_WINDOW_MODE) {
  return typeof value === "string" && SUPPORTED_WINDOW_MODES.has(value)
    ? value
    : fallback;
}

function getWindowModeSpec(value) {
  return WINDOW_MODE_BY_ID.get(normalizeWindowMode(value)) || WINDOW_MODE_BY_ID.get(DEFAULT_WINDOW_MODE);
}

function listWindowModeSpecs() {
  return WINDOW_MODE_SPECS.map((mode) => ({ ...mode }));
}

function resolveAvailableWindowMode(requested, canFitWindowedMode = () => true) {
  const normalized = normalizeWindowMode(requested);
  if (normalized === "fullscreen") {
    return "fullscreen";
  }
  const requestedSpec = getWindowModeSpec(normalized);
  if (canFitWindowedMode(requestedSpec)) {
    return requestedSpec.id;
  }
  const requestedIndex = WINDOW_MODE_SPECS.findIndex((mode) => mode.id === requestedSpec.id);
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = WINDOW_MODE_SPECS[index];
    if (candidate.kind === "windowed" && canFitWindowedMode(candidate)) {
      return candidate.id;
    }
  }
  return "fullscreen";
}

module.exports = {
  DEFAULT_WINDOW_MODE,
  WINDOW_MODE_SPECS,
  getWindowModeSpec,
  listWindowModeSpecs,
  normalizeWindowMode,
  resolveAvailableWindowMode,
};
