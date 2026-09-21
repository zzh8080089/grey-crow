"use strict";

const path = require("node:path");

function createDesktopContentLibrary({ dataRoot, contentRoot, engineRoot } = {}) {
  const resolvedEngineRoot = engineRoot || path.join(resolveRuntimeRoot(), "engine");
  const { createContentLibrary } = require(path.join(resolvedEngineRoot, "content-v2"));
  const { extractContentPackZip } = require("./content-library-zip");
  return createContentLibrary({
    libraryRoot: path.join(requireAbsolute(dataRoot, "dataRoot"), "user-content"),
    contentRoot: requireAbsolute(contentRoot, "contentRoot"),
    extractZip: extractContentPackZip,
  });
}

function resolveRuntimeRoot() {
  if (typeof process.resourcesPath === "string") {
    const packaged = path.resolve(process.resourcesPath);
    try {
      if (require("node:fs").statSync(path.join(packaged, "engine")).isDirectory()) return packaged;
    } catch {}
  }
  return path.resolve(__dirname, "../../..");
}

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${label} must be absolute`);
  return path.resolve(value);
}

module.exports = { createDesktopContentLibrary };
