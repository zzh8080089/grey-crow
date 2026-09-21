"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const METADATA_FILE = "build-identity.json";
const SOURCE_SCOPE = "allowlisted desktop/engine source and story content; excludes audio/binary resources";

function matchesFilter(file, filters) {
  const pattern = value => new RegExp("^" + value.split(/(\*\*\/|\*\*|\*)/).map(part => part === "**/" ? "(?:.*/)?"
    : part === "**" ? ".*" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("") + "$");
  return filters.some(rule => !rule.startsWith("!") && pattern(rule).test(file))
    && !filters.some(rule => rule.startsWith("!") && pattern(rule.slice(1)).test(file));
}

function sourceFingerprint(appRoot, runtimeRoot) {
  const hash = crypto.createHash("sha256");
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  // Allowlisted runtime source/content, excluding player data, audio resources,
  // generated build identity, tests and large binary assets. This is a source
  // identifier, explicitly not a ZIP/binary integrity checksum.
  function walk(root, label, filters, relativeRoot = "") {
    if (!fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, "en"))) {
      if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "scripts", "tests", "test", "evidence", "native"].includes(entry.name)) continue;
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name, absolute = path.join(root, entry.name);
      if (entry.isDirectory()) walk(absolute, label, filters, relative);
      else if (entry.isFile() && entry.name !== METADATA_FILE && !/\.test\./.test(entry.name)
        && /\.(c?js|json|css|html|md|txt|py)$/.test(entry.name) && matchesFilter(relative, filters)) {
        hash.update(label + "/" + relative + "\0"); hash.update(fs.readFileSync(absolute)); hash.update("\0");
      }
    }
  }
  walk(appRoot, "desktop", pkg.build?.files || ["*.js", "package.json", "renderer/**", "speech-input/*.js"]);
  for (const name of ["engine", "content"]) {
    const resource = pkg.build?.extraResources?.find(item => item.to === name);
    walk(path.join(runtimeRoot, name), name, resource?.filter || (pkg.build ? [] : ["**"]));
  }
  return hash.digest("hex");
}

function createBuildIdentity({ appRoot, runtimeRoot, packaged, platform = process.platform, arch = process.arch, versions = process.versions }) {
  const value = { appVersion: "unknown", buildId: "unknown", sourceFingerprint: "unknown",
    sourceScope: SOURCE_SCOPE, packaged: Boolean(packaged),
    platform: ["darwin", "win32", "linux"].includes(platform) ? platform : "unknown",
    arch: ["x64", "arm64", "ia32", "arm"].includes(arch) ? arch : "unknown",
    electron: /^[\d.]+$/.test(versions.electron || "") ? versions.electron : "unknown",
    node: /^[\d.]+$/.test(versions.node || "") ? versions.node : "unknown" };
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
    if (/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(pkg.version)) value.appVersion = pkg.version;
    if (packaged) {
      const raw = JSON.parse(fs.readFileSync(path.join(appRoot, METADATA_FILE), "utf8"));
      if (raw.schema !== 1 || !/^[a-f0-9]{64}$/.test(raw.sourceFingerprint || "") || !/^build-\d{13}-[a-f0-9]{16}$/.test(raw.buildId || "")) return value;
      value.buildId = raw.buildId; value.sourceFingerprint = raw.sourceFingerprint;
    } else {
      value.sourceFingerprint = sourceFingerprint(appRoot, runtimeRoot);
      value.buildId = `dev-${value.sourceFingerprint.slice(0, 16)}`;
    }
  } catch { /* Missing identity is explicit; never infer a release build. */ }
  return Object.freeze(value);
}

function writeBuildIdentity(appRoot, runtimeRoot) {
  const identity = { schema: 1, buildId: `build-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`,
    sourceFingerprint: sourceFingerprint(appRoot, runtimeRoot) };
  fs.writeFileSync(path.join(appRoot, METADATA_FILE), JSON.stringify(identity, null, 2) + "\n");
  return identity;
}
module.exports = { createBuildIdentity, writeBuildIdentity, sourceFingerprint, METADATA_FILE, SOURCE_SCOPE };
