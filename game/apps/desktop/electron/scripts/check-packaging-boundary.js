#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { MODEL_FILES, MODEL_REVISION } = require("../speech-input/resources");
const { verifyWindowsSpeechBinaries } = require("./speech-input-windows-pe");

const root = path.resolve(__dirname, "..");
const desktopRoot = path.resolve(root, "..");
const projectLicenseFrom = "../../../../LICENSE";
const projectLicenseTo = "licenses/Grey-Crow-LICENSE.txt";
// Retained locally for art history, but unused by the production renderer.
const developmentOnlyRendererAssets = [
  "renderer/assets/start_page_bg.jpg",
  "renderer/assets/the_grey_crow_logo.png",
  "renderer/assets/branding/grey-crow-ai-logo.png",
  "renderer/assets/ui/input-bar-bg-aged-paper-square-02.png",
  "renderer/assets/ui/icons/icon-backpack-01.png",
  "renderer/assets/ui/icons/icon-location-index-01.png",
  "renderer/assets/ui/icons/icon-observe-eye-01.png",
  "renderer/assets/ui/icons/icon-settings-gear-01.png",
];
const verifyWindowsPackage = process.argv.includes("--platform=win");
const requireWindowsTts = process.argv.includes("--require-tts");
const sourceOnly = process.argv.includes("--source-only");
const files = {
  packageJson: JSON.parse(read("package.json")),
  main: read("main.js"),
  appData: read("app-data.js"),
  credentialStore: read("credential-store.js"),
  modelConnections: read("model-connections.js"),
  desktopStatus: read("desktop-status.js"),
  runtimeSession: read("runtime-session.js"),
  settingsStore: read("settings-store.js"),
  saveSlots: read("save-slots.js"),
  ttsKokoroOriginalProvider: read("tts-kokoro-original-provider.js"),
  ttsKokoroOriginalWorker: read("tts-kokoro-original-worker.py"),
  preload: read("preload.js"),
  rendererHtml: read("renderer/index.html"),
  rendererApp: read("renderer/app.js"),
  rendererCss: read("renderer/styles.css"),
  fixMacosPlist: read("scripts/fix-macos-plist.js"),
  desktopReadme: fs.readFileSync(path.join(desktopRoot, "README.md"), "utf8"),
  packagingChecklist: fs.readFileSync(path.join(desktopRoot, "PACKAGING_CHECKLIST.md"), "utf8"),
};
const storyNotebookAssetManifest = JSON.parse(read("renderer/assets/story-notebook-v1/asset-manifest.json"));
files.packagedRuntimeSources = readPackagedDesktopRuntimeSources(files.packageJson);
assertPackagedLocalRequires(files.packageJson, files.packagedRuntimeSources);

assert(files.packageJson.main === "main.js", "Electron package main must stay on main.js.");
assert(files.packageJson.productName === "Grey Crow", "Electron productName must be player-facing.");
assert(files.packageJson.build?.appId === "app.greycrow.desktop", "Electron appId must avoid the default com.electron namespace.");
assert(files.packageJson.build?.directories?.buildResources === "build", "Electron build resources must live under build/.");
assertAppAsarFiles(files.packageJson);
assert(
  Array.isArray(files.packageJson.build?.asarUnpack) && files.packageJson.build.asarUnpack.includes("tts-kokoro-original-worker.py"),
  "Kokoro Python worker must be unpacked for the private runtime executable."
);
assert(files.packageJson.build?.mac?.category === "public.app-category.games", "macOS app category must not stay on developer tools.");
assert(files.packageJson.build?.mac?.icon === "build/icon.icns", "macOS app icon must use the Grey Crow build icon.");
assert(files.packageJson.build?.mac?.extendInfo?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false, "macOS ATS must not allow arbitrary loads.");
assert(files.packageJson.build?.mac?.extendInfo?.NSAppTransportSecurity?.NSAllowsLocalNetworking === true, "macOS ATS should allow local networking only for future loopback extensions.");
for (const permissionKey of [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
]) {
  assert(
    files.packageJson.build?.mac?.extendInfo?.[permissionKey] === null,
    `macOS ${permissionKey} should be removed until the app actually needs that permission.`
  );
}
assert(files.packageJson.build?.win?.icon === "build/icon.ico", "Windows app icon must use the Grey Crow build icon.");
assert(typeof files.packageJson.build?.mac?.extendInfo?.NSMicrophoneUsageDescription === "string"
  && files.packageJson.build.mac.extendInfo.NSMicrophoneUsageDescription.length > 10,
  "Local speech input must declare its microphone purpose.");
assert(files.packageJson.scripts?.start === "electron .", "desktop start script must launch Electron directly.");
assert(files.packageJson.devDependencies?.electron === "42.6.1", "Electron must stay pinned to the reviewed desktop runtime version.");
assert(files.packageJson.devDependencies?.["electron-builder"] === "26.15.6", "electron-builder must stay pinned to the reviewed build version.");
assert(files.packageJson.scripts?.["pack:dir"] === "npm run pack:dir:mac", "pack:dir must delegate to the current platform directory package script.");
assert(
  files.packageJson.scripts?.["pack:dir:mac"]?.startsWith("CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --dir --mac --arm64"),
  "pack:dir:mac must start the unsigned directory-package rehearsal without the removed sherpa preparation step."
);
assert(
  files.packageJson.scripts?.["pack:dir:mac"]?.endsWith("node scripts/fix-macos-plist.js --adhoc-sign"),
  "pack:dir:mac must re-sign the local test bundle after plist post-processing."
);
assert(files.packageJson.scripts?.["smoke:dev-startup"] === "node scripts/check-dev-startup.js", "desktop startup smoke must stay cross-platform Node.");
assert(
  files.packageJson.scripts?.["check:packaged:win:tts"] === "node scripts/check-packaging-boundary.js --platform=win --require-tts",
  "Windows TTS package gate must require the platform-private runtime."
);
assert(files.packageJson.scripts?.check?.includes("node --check scripts/check-dev-startup.js"), "desktop check must syntax-check startup smoke.");
assert(files.packageJson.scripts?.check?.includes("npm run smoke:dev-startup"), "desktop check must run startup smoke before UI smoke.");
assert(files.packageJson.scripts?.check?.includes("node scripts/check-packaging-boundary.js --source-only"), "development check must not treat stale packaged artifacts as current source evidence.");
assert(files.packageJson.dependencies?.undici === "8.7.0", "desktop package must pin the reviewed Undici HTTPS transport.");
assert(files.packageJson.dependencies?.yauzl === "3.4.0", "desktop package must pin the reviewed ZIP reader.");
assert(Object.keys(files.packageJson.dependencies || {}).sort().join(",") === "undici,yauzl", "desktop runtime dependencies must contain only the reviewed HTTPS transport and ZIP reader.");
assert(!files.packageJson.dependencies?.["sherpa-onnx-node"], "desktop package must not retain the removed sherpa runtime.");
assert(!files.packageJson.scripts?.["prepare:tts"], "desktop package must not retain the removed sherpa model preparation command.");
assert(files.fixMacosPlist.includes("NSAllowsArbitraryLoads: false"), "macOS plist fixer must disable arbitrary loads after packaging.");
assert(files.fixMacosPlist.includes("NSAllowsLocalNetworking: true"), "macOS plist fixer must preserve local networking for future loopback extensions.");
assert(!files.fixMacosPlist.includes("NSExceptionDomains"), "macOS plist fixer must not preserve broad localhost HTTP exceptions by default.");
assert(files.fixMacosPlist.includes('"--force", "--deep", "--sign", "-"'), "macOS plist fixer must ad-hoc sign local test bundles when requested.");
assert(files.fixMacosPlist.includes('"--verify", "--deep", "--strict"'), "macOS plist fixer must verify the repaired local test signature.");
for (const permissionKey of [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
]) {
  assert(files.fixMacosPlist.includes(permissionKey), `macOS plist fixer must remove ${permissionKey}.`);
}
assert(!JSON.stringify(files.packageJson.scripts || {}).includes("legacy/openclaw-web-ui"), "desktop scripts must not start legacy OpenClaw.");
assert(files.fixMacosPlist.includes("info.NSMicrophoneUsageDescription ="), "plist processing must preserve speech input permission.");
assert(hasExtraResource(files.packageJson, "../../../engine", "engine"), "Electron package must declare engine/ as packaged extraResources.");
assert(hasExtraResource(files.packageJson, "../../../content", "content"), "Electron package must declare content/ as packaged extraResources.");
assert(hasExtraResource(files.packageJson, projectLicenseFrom, projectLicenseTo), "Electron package must include the project license.");
assert(fs.readFileSync(path.resolve(root, projectLicenseFrom), "utf8").startsWith("# PolyForm Noncommercial License 1.0.0\n"), "Project license must retain the selected noncommercial terms.");
assert(!hasExtraResource(files.packageJson, "../../../vendor/tts/kokoro-v1.1-zh-int8", "tts/kokoro-v1.1-zh-int8"), "Electron package must not declare removed sherpa model resources.");
assert(hasExtraResource(files.packageJson, "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"), "Electron package must expose third-party notices beside packaged resources.");
assertExtraResourceFilters(files.packageJson);
assertSpeechInputDeclarations(files.packageJson);
assert(fs.existsSync(path.resolve(root, "../../../engine/bridge")), "declared engine resource source must include engine/bridge.");
assert(fs.existsSync(path.resolve(root, "../../../engine/runtime")), "declared engine resource source must include engine/runtime.");
assert(fs.existsSync(path.resolve(root, "../../../engine/providers")), "declared engine resource source must include engine/providers.");
assert(fs.existsSync(path.resolve(root, "../../../content/host")), "declared content resource source must include content/host.");
assert(fs.existsSync(path.join(root, "build", "icon.png")), "build/icon.png must exist as the app icon source.");
assert(fs.existsSync(path.join(root, "build", "icon.icns")), "build/icon.icns must exist for macOS packaging.");
assert(fs.existsSync(path.join(root, "build", "icon.ico")), "build/icon.ico must exist for Windows packaging.");
assertSimulatedPackagedResourcesLayout(files.packageJson);
if (!sourceOnly) {
  if (verifyWindowsPackage) {
    const windowsResourcesRoot = path.join(root, "dist", "win-unpacked", "resources");
    assertExistingPackagedResourcesLayout(files.packageJson, windowsResourcesRoot, "existing Windows packaged resources");
    assertExistingAppAsarLayout(path.join(windowsResourcesRoot, "app.asar"), "existing Windows app.asar");
    assertExistingWindowsPackageLayout();
    if (requireWindowsTts) {
      assertExistingWindowsTtsBundle(windowsResourcesRoot);
    }
  } else {
    assertExistingPackagedResourcesLayout(files.packageJson);
    assertExistingAppAsarLayout();
  }
}

assert(files.main.includes('app.getPath("userData")'), "main process must pass Electron userData into app data layout.");
assert(files.main.includes('app.getPath("temp")'), "main process must pass Electron temp path into app data layout.");
assert(files.main.includes("process.resourcesPath"), "packaged main process must resolve runtime files from process.resourcesPath.");
assert(files.main.includes("RUNTIME_ROOT") && files.main.includes("profileRoot: layout.playerProfileRoot"), "main process must pass the external player profile root into native new-game content selection.");
assert(files.saveSlots.includes("process.resourcesPath"), "save slot store must resolve packaged engine resources through process.resourcesPath.");
assertDesktopRuntimeDoesNotUseDevOnlyEnginePaths(files.packagedRuntimeSources);
assert(files.appData.includes("GREY_CROW_DATA_ROOT"), "app data layout must support external dataRoot.");
assert(files.appData.includes("GREY_CROW_PROVIDER_CHECK_ROOT"), "app data layout must support provider-check override for tests.");
assert(files.appData.includes("localPathsExposed: false"), "app data status must not expose local paths.");
assert(files.credentialStore.includes("secure-storage"), "credential store must support secure API credential persistence.");
assert(files.credentialStore.includes("safeStorage.encryptString") && files.credentialStore.includes("safeStorage.decryptString"), "credential store must persist credentials only through Electron safeStorage.");
assert(files.credentialStore.includes("session-only"), "credential store must retain a no-plaintext session-only fallback.");
assert(files.main.includes("CLEAR_PROVIDER_CREDENTIAL") && files.preload.includes("clearProviderCredential"), "desktop shell must expose explicit credential clearing.");
assert(files.main.includes("TEST_PROVIDER_CONNECTION") && files.preload.includes("testProviderConnection"), "desktop shell must expose isolated provider compatibility testing.");
assert(files.main.includes("createSessionDesktopBridge"), "main process must own native session bridge creation.");
assert(files.main.includes("createNewGameLifecycle") && files.main.includes("CONFIRM_NEW_GAME_CREATION"), "main process must own validated v2 new-game initialization.");
assert(files.main.includes("REQUEST_SAVE_MAINTENANCE") && files.main.includes("CONFIRM_SAVE_MAINTENANCE"), "main process must own save maintenance confirmation.");
assert(files.main.includes("projectSaveMaintenanceResult") && files.main.includes("projectSaveMaintenanceInspection"), "main process must project maintenance results before renderer exposure.");
assert(files.preload.includes("requestSaveMaintenance") && files.preload.includes("confirmSaveMaintenance"), "preload must expose narrow save maintenance methods.");
assert(files.main.includes("GET_DEBUG_TRACE") && files.main.includes("binding.bridge.loadDebugTrace"), "main process must own debug trace reads.");
assert(files.main.includes("createDebugTraceExport") && files.main.includes("projectDebugTraceResult"), "debug trace export must be projected in main process.");
assert(files.preload.includes("getDebugTrace"), "preload must expose narrow debug trace read only.");
assert(files.main.includes("getSaveSlotStore().deleteConfirmed") && files.saveSlots.includes("requestDelete"), "main process must own confirmed native save deletion.");
assert(files.preload.includes("contextBridge.exposeInMainWorld"), "preload must expose a contextBridge API.");
assert(!files.preload.includes("sendSync"), "preload must not expose synchronous IPC.");
assert(!files.preload.includes("deleteSaveSlot"), "preload must not expose save deletion before a dedicated confirmation UI exists.");
assert(files.preload.includes("synthesizeTts"), "preload must expose narrow TTS synthesis only.");
assert(files.rendererHtml.includes("connect-src 'none'"), "renderer CSP must block direct network access.");
assert(files.rendererHtml.includes("media-src 'self' data:"), "renderer CSP must allow only bundled/data audio playback.");
assert(!/fetch\(|XMLHttpRequest|localStorage|indexedDB/i.test(files.rendererApp), "renderer must not use network or browser persistence.");
assertStoryNotebookRuntimeAssets(storyNotebookAssetManifest, files);
assert(files.rendererHtml.includes("debugPanelEnabledSelect") && files.rendererApp.includes("window.greyCrow.getDebugTrace"), "renderer must gate debug trace behind a developer setting and preload API.");
assert(files.main.includes("createTtsService") && files.main.includes("SYNTHESIZE_TTS"), "main process must own TTS synthesis.");
assert(files.main.includes("projectTtsResult"), "main process must project TTS results before renderer exposure.");
assert(files.main.includes("createKokoroOriginalProvider") && files.ttsKokoroOriginalProvider.includes("spawn"), "original Kokoro candidate must run behind the main-process stdio provider.");
assert(files.main.includes("inspectOriginalBundle") && files.main.includes("availability.available"), "desktop startup must inspect Kokoro resources before provider registration.");
assert(files.main.includes("KOKORO_MODEL_MISSING") && files.main.includes("unavailableProviders"), "missing Kokoro resources must produce a stable unavailable state without a worker spawn.");
assert(!files.main.includes("createKokoroLocalProvider"), "main process must not register the removed sherpa provider.");
assert(files.ttsKokoroOriginalWorker.includes("HF_HUB_OFFLINE"), "original Kokoro worker must force offline model access.");
assert(files.ttsKokoroOriginalProvider.includes('PYTHONUTF8: "1"'), "original Kokoro provider must force UTF-8 stdio on Windows.");
assert(!requireWindowsTts || verifyWindowsPackage, "--require-tts is only valid with --platform=win.");

// The README is navigation; distribution requirements live in the checklist.
assert(files.desktopReadme.includes("(PACKAGING_CHECKLIST.md)"), "desktop README must link to the packaging checklist.");

for (const required of [
  "玩家安装包",
  "游戏目录说明",
  "macOS",
  "Windows",
  "Keychain / Credential Store",
  "未签名",
  "出站 HTTPS",
  "不要求安装开发工具",
  "默认不开放 Gateway",
  "127.0.0.1",
]) {
  assert(files.packagingChecklist.includes(required), `packaging checklist missing: ${required}`);
}

process.stdout.write("desktop packaging boundary checks passed\n");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertStoryNotebookRuntimeAssets(manifest, sourceFiles) {
  const assetsRoot = path.join(root, "renderer", "assets", "story-notebook-v1");
  const expectedFiles = [
    "archive-paper-night-v1.png",
    "hud-current-story-paper-night-v1.png",
    "hud-host-paper-slip-night-v2.png",
    "hud-player-sticky-note-night-v1.png",
    "icon-backpack-night-v1.png",
    "icon-chapter-night-v1.png",
    "icon-character-records-night-v1.png",
    "icon-current-state-night-v1.png",
    "icon-host-feather-night-v1.png",
    "icon-location-action-night-v1.png",
    "icon-module-library-night-v1.png",
    "icon-observe-night-v1.png",
    "icon-settings-gear-night-v1.png",
    "notebook-page-night-v1.png",
    "pushpin-blue-steel-night-v1.png",
    "scene-rain-night-v1.png",
    "sticky-tab-system-night-v1.png",
  ];
  assert(manifest?.schemaVersion === "grey-crow-renderer-art-manifest-v1", "story-notebook runtime asset manifest schema mismatch.");
  assert(manifest.layoutId === "story-notebook-v1", "story-notebook runtime asset manifest must target the reviewed layout ID.");
  assert(manifest.defaultLayout === "story-notebook-v1" && manifest.persistence === "session-only", "story-notebook runtime assets must preserve the notebook-only, session-only runtime boundary.");
  assert(manifest.releaseStatus === "candidate-not-final-4k", "story-notebook runtime assets must not be mislabeled as final 4K art.");
  assert(Array.isArray(manifest.assets) && manifest.assets.length === expectedFiles.length, "story-notebook runtime manifest must contain exactly the reviewed D2-E1 asset slice.");
  const manifestFiles = manifest.assets.map((asset) => asset.file).sort();
  assert(JSON.stringify(manifestFiles) === JSON.stringify(expectedFiles), "story-notebook runtime manifest file set changed outside the reviewed allowlist.");
  const actualFiles = fs.readdirSync(assetsRoot)
    .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
    .sort();
  assert(JSON.stringify(actualFiles) === JSON.stringify(expectedFiles), "story-notebook runtime directory contains unreviewed PNG assets.");
  let totalBytes = 0;
  for (const asset of manifest.assets) {
    assert(["scene", "material", "icon"].includes(asset.role), `story-notebook asset has an unsupported role: ${asset.role}`);
    assert(!/(prompt|source|reference|test|chroma|preview)/i.test(asset.file), `story-notebook development-only asset leaked into runtime: ${asset.file}`);
    const filePath = path.join(assetsRoot, asset.file);
    const buffer = fs.readFileSync(filePath);
    assert(buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a", `story-notebook asset is not a PNG: ${asset.file}`);
    assert(buffer.length === asset.bytes, `story-notebook asset byte count differs from manifest: ${asset.file}`);
    assert(buffer.readUInt32BE(16) === asset.width && buffer.readUInt32BE(20) === asset.height, `story-notebook asset dimensions differ from manifest: ${asset.file}`);
    assert(crypto.createHash("sha256").update(buffer).digest("hex") === asset.sha256, `story-notebook asset digest differs from manifest: ${asset.file}`);
    totalBytes += buffer.length;
  }
  assert(totalBytes <= 19 * 1024 * 1024, "story-notebook runtime asset slice exceeds the reviewed 19 MiB budget.");
  const rendererSources = `${sourceFiles.rendererHtml}\n${sourceFiles.rendererApp}\n${sourceFiles.rendererCss}\n${JSON.stringify(manifest)}`;
  assert(!rendererSources.includes("art-lab/"), "production renderer must not depend on the isolated UI lab.");
}

function readPackagedDesktopRuntimeSources(packageJson) {
  const sources = {};
  for (const filePath of packageJson.build?.files || []) {
    if (typeof filePath !== "string" || filePath.includes("*") || !filePath.endsWith(".js")) {
      continue;
    }
    sources[filePath] = read(filePath);
  }
  return sources;
}

function assertPackagedLocalRequires(packageJson, sourceMap) {
  const packagedFiles = new Set(
    (packageJson.build?.files || [])
      .filter((filePath) => typeof filePath === "string" && !filePath.includes("*"))
      .map(toPortablePath)
  );
  for (const [sourcePath, source] of Object.entries(sourceMap)) {
    for (const match of source.matchAll(/require\(\s*["'](\.\/[^"']+)["']\s*\)/g)) {
      const request = match[1];
      const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(toPortablePath(sourcePath)), request));
      const candidates = path.posix.extname(basePath)
        ? [basePath]
        : [`${basePath}.js`, `${basePath}.json`, `${basePath}/index.js`];
      const dependencyPath = candidates.find((candidate) => fs.existsSync(path.join(root, candidate)));
      assert(dependencyPath, `${sourcePath} requires missing local runtime dependency ${request}.`);
      assert(
        packagedFiles.has(dependencyPath),
        `${sourcePath} local runtime dependency ${dependencyPath} must be listed in build.files.`
      );
    }
  }
}

function hasExtraResource(packageJson, from, to) {
  return Array.isArray(packageJson.build?.extraResources) &&
    packageJson.build.extraResources.some((entry) => entry?.from === from && entry?.to === to);
}

function assertSimulatedPackagedResourcesLayout(packageJson) {
  const resourcesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-packaged-resources-"));
  for (const entry of packageJson.build.extraResources || []) {
    if (entry?.to === projectLicenseTo) {
      const target = path.join(resourcesRoot, entry.to);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.resolve(root, entry.from), target);
      continue;
    }
    if (!["engine", "content"].includes(entry?.to)) {
      continue;
    }
    const source = path.resolve(root, entry.from);
    const target = path.join(resourcesRoot, entry.to);
    copyFilteredResource(source, target, entry.filter || []);
  }

  const bridge = require(path.join(resourcesRoot, "engine", "bridge"));
  assert(typeof bridge.createSessionDesktopBridge === "function", "simulated packaged resources must load the native session bridge.");
  assert(!bridge.createAdventureDesktopBridge && !bridge.createDesktopBridge, "packaged bridge must not export the retired execution chains.");
  assertRequiredPackagedResources(resourcesRoot, "simulated packaged resources");
  assertPackagedProjectLicense(resourcesRoot, "simulated packaged resources");
  assertEngineDependencyClosure(packageJson, resourcesRoot);
  for (const forbiddenPath of [
    "engine/agent",
    "engine/adventure-v2",
    "engine/bridge/desktop-bridge.js",
    "engine/bridge/adventure-desktop-bridge.js",
    "engine/session/session-legacy-migration.js",
    "engine/README.md",
    "engine/bridge/README.md",
    "engine/providers/README.md",
    "engine/runtime/README.md",
    "content/README.md",
    "content/host/README.md",
    "content/runtime/grey-crow-runtime-policy.md",
    "content/skills/tool-specs.v1.json",
    "content/skills/runtime-skill-rewrites.v1.json",
  ]) {
    assert(!fs.existsSync(path.join(resourcesRoot, forbiddenPath)), `simulated packaged resources must not include ${forbiddenPath}.`);
  }
}

function assertExistingPackagedResourcesLayout(
  packageJson,
  resourcesRoot = path.join(root, "dist", "mac-arm64", "Grey Crow.app", "Contents", "Resources"),
  label = "existing packaged resources"
) {
  if (!fs.existsSync(resourcesRoot)) {
    return;
  }

  const bridge = require(path.join(resourcesRoot, "engine", "bridge"));
  assert(typeof bridge.createSessionDesktopBridge === "function", `${label} must load the native session bridge.`);
  assertRequiredPackagedResources(resourcesRoot, label);
  assertPackagedProjectLicense(resourcesRoot, label);
  assert(fs.existsSync(path.join(resourcesRoot, "THIRD_PARTY_NOTICES.md")), `${label} must expose third-party notices beside app resources.`);
  assertPackagedExtraResourcesFresh(packageJson, resourcesRoot);
  const platform = verifyWindowsPackage ? "win32-x64" : "darwin-arm64";
  assertSpeechInputBundle(path.join(resourcesRoot, "speech-input"), platform, label);
  assertSpeechModelBundle(path.join(resourcesRoot, "speech-input-model"), label);
  const speechEntry = packageJson.build[verifyWindowsPackage ? "win" : "mac"].extraResources.find((entry) => entry.to === "speech-input");
  const speechSource = path.resolve(root, speechEntry.from);
  if (fs.existsSync(speechSource)) {
    for (const file of listFiles(speechSource)) {
      const relative = toPortablePath(path.relative(speechSource, file));
      if (isIncludedByFilters(relative, speechEntry.filter)) {
        assert(fs.readFileSync(file).equals(fs.readFileSync(path.join(resourcesRoot, "speech-input", relative))),
          `${label} speech input is stale: ${relative}.`);
      }
    }
  }
  for (const forbiddenPath of [
    "engine/agent",
    "engine/adventure-v2",
    "engine/bridge/desktop-bridge.js",
    "engine/bridge/adventure-desktop-bridge.js",
    "engine/session/session-legacy-migration.js",
    "engine/README.md",
    "engine/bridge/README.md",
    "engine/providers/README.md",
    "engine/runtime/README.md",
    "content/README.md",
    "content/host/README.md",
    "content/runtime/grey-crow-runtime-policy.md",
    "content/skills/tool-specs.v1.json",
    "content/skills/runtime-skill-rewrites.v1.json",
  ]) {
    assert(!fs.existsSync(path.join(resourcesRoot, forbiddenPath)), `existing packaged resources must not include ${forbiddenPath}.`);
  }
}

function assertPackagedProjectLicense(resourcesRoot, label) {
  const target = path.join(resourcesRoot, projectLicenseTo);
  assert(fs.existsSync(target), `${label} must include the project license.`);
  assert(fs.readFileSync(target).equals(fs.readFileSync(path.resolve(root, projectLicenseFrom))),
    `${label} project license must match the source license without changes.`);
}

function assertPackagedExtraResourcesFresh(packageJson, resourcesRoot) {
  for (const entry of packageJson.build?.extraResources || []) {
    if (!["engine", "content"].includes(entry?.to)) {
      continue;
    }
    const sourceRoot = path.resolve(root, entry.from);
    const targetRoot = path.join(resourcesRoot, entry.to);
    for (const sourcePath of listFiles(sourceRoot)) {
      if (sourcePath.includes(`${path.sep}node_modules${path.sep}`)) {
        continue;
      }
      const relativePath = toPortablePath(path.relative(sourceRoot, sourcePath));
      if (!isIncludedByFilters(relativePath, entry.filter || [])) {
        continue;
      }
      const targetPath = path.join(targetRoot, relativePath);
      assert(fs.existsSync(targetPath), `existing packaged resources are stale or missing ${entry.to}/${relativePath}.`);
      assert(
        fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath)),
        `existing packaged resources are stale for ${entry.to}/${relativePath}; rerun npm run pack:dir.`
      );
    }
  }
}

function assertRequiredPackagedResources(resourcesRoot, label) {
  for (const requiredPath of [
    "engine/bridge/index.js",
    "engine/bridge/session-desktop-bridge.js",
    "engine/session/session-process-child.js",
    "engine/session/session-new-game-lifecycle.js",
    "engine/session/session-catalog.js",
    "engine/session/session-archive.js",
    "engine/session/session-story-export.js",
    "engine/session/session-continuation.js",
    "engine/session/session-compaction.js",
    "engine/session/session-compaction-quotes.js",
    "engine/session/turn-store.js",
    "engine/session/turn-generator.js",
    "engine/providers/index.js",
    "engine/providers/provider-contracts.js",
    "engine/tts/tts-service.js",
    "engine/tts/utterance-planner.js",
    "engine/content-v2/index.js",
    "engine/content-v2/skill-module-preview.js",
    "engine/content-v2/skill-panel-preview.js",
    "engine/localization/index.js",
    "content/packs/grey-crow-default/manifest.json",
    "content/host/grey-crow-host.md",
    "content/skills/index.v1.json"
]) {
    assert(fs.existsSync(path.join(resourcesRoot, requiredPath)), `${label} must include ${requiredPath}.`);
  }
}

function assertExistingAppAsarLayout(
  appAsarPath = path.join(root, "dist", "mac-arm64", "Grey Crow.app", "Contents", "Resources", "app.asar"),
  label = "existing app.asar"
) {
  if (!fs.existsSync(appAsarPath)) {
    return;
  }

  const asar = require("@electron/asar");
  const entries = new Set(asar.listPackage(appAsarPath).map(toPortableAsarPath));
  for (const required of [
    "package.json",
    "main.js",
    "preload.js",
    "app-data.js",
    "credential-store.js",
    "content-library.js",
    "content-library-zip.js",
    "content-management.js",
    "model-connections.js",
    "desktop-status.js",
    "runtime-session.js",
    "context-settings-policy.js",
    "settings-store.js",
    "save-slots.js",
    "provider-https-transport.js",
    "tts-kokoro-original-provider.js",
    "tts-kokoro-original-worker.py",
    "node_modules/undici/index.js",
    "node_modules/yauzl/index.js",
    "node_modules/pend/index.js",
    "renderer/app.js",
    "renderer/index.html",
    "renderer/styles.css",
    "speech-input/desktop.js",
    "speech-input/service.js",
    "speech-input/resources.js",
    "speech-input/settings.js",
    "renderer/speech-input.js",
    "renderer/speech-input-worklet.js",
    "renderer/speech-input.css",
  ]) {
    assert(entries.has(required), `${label} missing ${required}.`);
  }
  for (const forbidden of [
    "tts-kokoro-local-provider.js",
    "tts-kokoro-worker.js",
    "node_modules/sherpa-onnx-node/sherpa-onnx.js",
    "scripts/check-ui-smoke.js",
    "scripts/check-packaging-boundary.js",
    "scripts/fix-macos-plist.js",
    "package-lock.json",
    "README.md",
    "renderer/speech-input.test.js",
    "speech-input/backend.test.js",
    ...developmentOnlyRendererAssets,
  ]) {
    assert(!entries.has(forbidden), `${label} must not include ${forbidden}.`);
  }
  assert(![...entries].some((entry) => entry.startsWith("scripts/")), `${label} must not include dev scripts/.`);
  assert(![...entries].some((entry) => entry.startsWith("legacy/")), `${label} must not include legacy files.`);
}

function assertExistingWindowsPackageLayout() {
  const resourcesRoot = path.join(root, "dist", "win-unpacked", "resources");
  const appAsarPath = path.join(resourcesRoot, "app.asar");
  assert(fs.existsSync(appAsarPath), "Windows packaged gate requires dist/win-unpacked/resources/app.asar.");
  assert(
    fs.existsSync(path.join(resourcesRoot, "app.asar.unpacked", "tts-kokoro-original-worker.py")),
    "Windows package must expose the Kokoro worker outside app.asar for python.exe."
  );
  assert(!fs.existsSync(path.join(resourcesRoot, "tts", "kokoro-v1.1-zh-int8")), "Windows package must not retain removed sherpa model resources.");
  assert(
    fs.existsSync(path.join(resourcesRoot, "THIRD_PARTY_NOTICES.md")),
    "Windows package must expose third-party notices beside app resources."
  );

  const asar = require("@electron/asar");
  const entries = new Set(asar.listPackage(appAsarPath).map(toPortableAsarPath));
  for (const required of [
    "model-connections.js",
    "context-settings-policy.js",
    "tts-kokoro-original-provider.js",
    "tts-kokoro-original-worker.py",
  ]) {
    assert(entries.has(required), `Windows app.asar missing ${required}.`);
  }
  for (const forbidden of [
    "tts-kokoro-local-provider.js",
    "tts-kokoro-worker.js",
    "node_modules/sherpa-onnx-node/sherpa-onnx.js",
  ]) {
    assert(!entries.has(forbidden), `Windows app.asar must not retain ${forbidden}.`);
  }
}

function assertExistingWindowsTtsBundle(resourcesRoot) {
  const ttsRoot = path.join(resourcesRoot, "tts", "kokoro-original-zh");
  for (const required of [
    "python/python.exe",
    "python/runtime-inventory.json",
    "models/kokoro-original/config.json",
    "models/kokoro-original/kokoro-v1_1-zh.pth",
    "models/kokoro-original/zf_001.pt",
    "models/kokoro-original/zf_006.pt",
    "models/kokoro-original/zm_009.pt",
    "models/kokoro-original/zm_010.pt",
    "models/kokoro-original/model-downloads.json",
    "compliance/THIRD_PARTY_NOTICES.md",
    "compliance/MODIFICATIONS.md",
    "compliance/sbom.spdx.json",
    "compliance/third-party-components.json",
  ]) {
    assert(fs.existsSync(path.join(ttsRoot, required)), `Windows TTS package missing ${required}.`);
  }
  const inventory = JSON.parse(fs.readFileSync(path.join(ttsRoot, "python", "runtime-inventory.json"), "utf8"));
  assert(inventory.platform === "windows-x64", "Windows TTS runtime inventory must identify windows-x64.");
  assert(inventory.pythonLayout === "windows", "Windows TTS runtime inventory must use the Windows Python layout.");
  assert(inventory.pruningProfile === "player-extract-v1", "Windows TTS runtime must use the player extraction pruning profile.");
  assert(
    Number.isInteger(inventory.runtimeFileCount) && inventory.runtimeFileCount <= 8000,
    `Windows TTS Python runtime must stay at or below 8000 files (found ${inventory.runtimeFileCount}).`
  );
  assert(
    Number.isInteger(inventory.bundledPurePythonEntries) && inventory.bundledPurePythonEntries >= 1000,
    "Windows TTS runtime must bundle the proven pure-Python dependency set."
  );
  const relativeFiles = listFiles(ttsRoot).map((filePath) => toPortablePath(path.relative(ttsRoot, filePath)));
  assert(relativeFiles.length <= 8500, `Windows TTS package must stay at or below 8500 files (found ${relativeFiles.length}).`);
  for (const required of [
    "python/Lib/site-packages/grey-crow-pure-python.zip",
    "python/Lib/site-packages/grey-crow-pure-python.pth",
  ]) {
    assert(relativeFiles.includes(required), `Windows TTS package missing optimized runtime file ${required}.`);
  }
  for (const forbiddenPrefix of [
    "python/Doc/",
    "python/Tools/",
    "python/include/",
    "python/libs/",
    "python/tcl/",
    "python/Lib/test/",
    "python/Lib/site-packages/torch/include/",
    "python/Lib/site-packages/torch/share/",
  ]) {
    assert(
      !relativeFiles.some((filePath) => filePath.startsWith(forbiddenPrefix)),
      `Windows TTS package must not retain development-only path ${forbiddenPrefix}.`
    );
  }
  assert(
    !relativeFiles.some((filePath) => /^python\/python-.*-amd64\.exe$/i.test(filePath)),
    "Windows TTS package must not embed the Python installer."
  );
  assert(!relativeFiles.some((filePath) => filePath.endsWith(".dylib")), "Windows TTS package must not contain macOS dylibs.");
  assert(!relativeFiles.includes("python/bin/python3.12"), "Windows TTS package must not contain the macOS Python executable.");
}

function assertDesktopRuntimeDoesNotUseDevOnlyEnginePaths(fileMap) {
  const devOnlyEnginePathPatterns = [
    /require\s*\(\s*["']\.\.\/\.\.\/\.\.\/engine(?:\/|["'])/,
    /path\.(?:join|resolve)\s*\(\s*__dirname\s*,\s*["']\.\.\/\.\.\/\.\.\/engine(?:\/|["'])/,
    /path\.(?:join|resolve)\s*\(\s*__dirname\s*,\s*["']\.\.\/\.\.\/\.\.["']\s*,\s*["']engine(?:\/|["'])/,
    /path\.(?:join|resolve)\s*\(\s*__dirname\s*,\s*["']\.\.["']\s*,\s*["']\.\.["']\s*,\s*["']\.\.["']\s*,\s*["']engine(?:\/|["'])/,
  ];
  for (const [name, source] of Object.entries(fileMap)) {
    if (typeof source !== "string") {
      continue;
    }
    assert(
      !devOnlyEnginePathPatterns.some((pattern) => pattern.test(source)),
      `${name} must not import engine modules through a dev-only __dirname path.`
    );
  }
}

function assertEngineDependencyClosure(packageJson, resourcesRoot) {
  const engineRoot = path.join(resourcesRoot, "engine");
  const filter = findExtraResource(packageJson, "engine").filter;
  const resolveModule = (base, owner) => {
    const found = [base, `${base}.js`, `${base}.cjs`, `${base}.json`, path.join(base, "index.js")]
      .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    assert(found, `${owner} requires a missing packaged engine module: ${path.relative(engineRoot, base)}.`);
    assert(found.startsWith(`${engineRoot}${path.sep}`), `${owner} resolves outside the packaged engine.`);
    return found;
  };
  for (const entry of filter.filter((item) => !item.startsWith("!") && !item.includes("*"))) {
    assert(!/^(agent|adventure-v2)\/|session-legacy|bridge\/(desktop-bridge|adventure-desktop-bridge)\.js/.test(entry), `retired execution module still packaged: ${entry}.`);
    const absolute = resolveModule(path.join(engineRoot, entry), entry);
    if (!/\.[cm]?js$/.test(entry)) continue;
    const source = fs.readFileSync(absolute, "utf8");
    for (const match of source.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      resolveModule(path.resolve(path.dirname(absolute), match[1]), entry);
    }
  }
  for (const [name, source] of Object.entries(files.packagedRuntimeSources)) {
    for (const match of source.matchAll(/require\(path\.join\((RUNTIME_ROOT|engineRoot|resolvedEngineRoot),\s*((?:"[^"\n]+"(?:,\s*)?)+)\)\)/g)) {
      const segments = [...match[2].matchAll(/"([^"\n]+)"/g)].map((item) => item[1]);
      const base = match[1] === "RUNTIME_ROOT" ? resourcesRoot : engineRoot;
      resolveModule(path.join(base, ...segments), name);
    }
  }
  assert(!/GREY_CROW_REBUILD_SESSION|SESSION_REBUILD|engine\/adventure-v2|engine\/agent/.test(files.main), "default startup must use only the native session runtime, without an opt-in or fallback.");
}

function assertSpeechInputDeclarations(packageJson) {
  assert(packageJson.build.files.includes("!renderer/**/*.test.js"), "renderer speech tests must stay outside the player package.");
  const modelEntry = packageJson.build.extraResources.find(entry => entry.to === "speech-input-model");
  assert(modelEntry?.from === "speech-input/.model", "Speech model must have an independent offline resource directory.");
  const allowedModelFiles = [...MODEL_FILES.map(file => file.name), "SOURCE.json", "FunASR-MODEL_LICENSE-58830eca.txt"];
  assert(Array.isArray(modelEntry.filter) && modelEntry.filter.length === allowedModelFiles.length
    && allowedModelFiles.every(file => modelEntry.filter.includes(file)), "Speech model filter must contain only verified weights, metadata and notices.");
  if (fs.existsSync(path.resolve(root, modelEntry.from))) assertSpeechModelBundle(path.resolve(root, modelEntry.from), "prepared speech model");
  for (const [key, platform] of [["mac", "darwin-arm64"], ["win", "win32-x64"]]) {
    const entries = packageJson.build[key]?.extraResources || [];
    const entry = entries.find((value) => value.to === "speech-input");
    assert(entry?.from === `speech-input/.runtime/${platform}`, `${key} must declare its own speech runtime.`);
    for (const required of ["bin/speech-input-cli", "licenses/ATTRIBUTION.md", "sources/eigen.tar.gz", "runtime-manifest.json"]) {
      assert(isIncludedByFilters(required, entry.filter), `${key} speech resource filter excludes ${required}.`);
    }
    for (const forbidden of ["model.int8.onnx", "test_wavs/zh.wav", "recordings/input.wav", "native/speech-input-cli.cc", "build/CMakeCache.txt"]) {
      assert(!isIncludedByFilters(forbidden, entry.filter), `${key} speech resource filter includes development/user data: ${forbidden}.`);
    }
    const source = path.resolve(root, entry.from);
    if (!fs.existsSync(source)) continue; // Declarations are checked; no claim of a built or tested platform.
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-speech-resource-filter-"));
    try {
      copyFilteredResource(source, staging, entry.filter);
      assertSpeechInputBundle(staging, platform, "filtered speech runtime (not a game package)");
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
}

function assertSpeechInputBundle(directory, platform, label) {
  const manifestPath = path.join(directory, "runtime-manifest.json");
  assert(fs.existsSync(manifestPath), `${label} needs speech runtime-manifest.json.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(manifest.target === platform && manifest.protocolVersion === 1, `${label} speech target/protocol mismatch.`);
  assert(manifest.options?.tts === false && manifest.options?.python === false && manifest.modelBundled === false,
    `${label} must keep native runtime and model resources separate.`);
  if (platform === "win32-x64" && manifest.options.static === false) {
    const binaries = verifyWindowsSpeechBinaries(path.join(directory, "bin"));
    assert(JSON.stringify(binaries) === JSON.stringify(manifest.validation?.binaryDependencies), `${label} Windows binary dependency manifest is stale.`);
  }
  const required = [platform.startsWith("win32") ? "bin/speech-input-cli.exe" : "bin/speech-input-cli",
    "licenses/ATTRIBUTION.md", "licenses/FunASR-MODEL_LICENSE-58830eca.txt", "licenses/onnxruntime-1.28.2-ThirdPartyNotices.txt"];
  const paths = new Set(manifest.files?.map((file) => file.path));
  for (const file of required) assert(paths.has(file), `${label} speech manifest missing ${file}.`);
  assert([...paths].some((file) => file.startsWith("sources/eigen-")), `${label} must include corresponding Eigen source.`);
  for (const file of manifest.files) {
    assert(typeof file.path === "string" && !path.isAbsolute(file.path) && !file.path.split(/[\\/]/).includes(".."), `${label} has unsafe manifest path.`);
    const absolute = path.join(directory, file.path);
    assert(fs.existsSync(absolute) && fs.lstatSync(absolute).isFile(), `${label} speech file missing: ${file.path}.`);
    const bytes = fs.readFileSync(absolute);
    assert(bytes.length === file.bytes && crypto.createHash("sha256").update(bytes).digest("hex") === file.sha256,
      `${label} speech file differs from manifest: ${file.path}.`);
  }
  for (const absolute of listFiles(directory)) {
    const relative = toPortablePath(path.relative(directory, absolute));
    assert(relative === "runtime-manifest.json" || paths.has(relative), `${label} speech runtime contains an undeclared file: ${relative}.`);
    assert(!/\.(onnx|wav|pcm|py|pyc)$/i.test(relative), `${label} contains a model, recording, or Python in the native speech bundle.`);
  }
}

function assertSpeechModelBundle(directory, label) {
  for (const file of MODEL_FILES) {
    const absolute = path.join(directory, file.name);
    assert(fs.existsSync(absolute) && fs.lstatSync(absolute).isFile(), `${label} is missing offline speech model ${file.name}.`);
    const bytes = fs.readFileSync(absolute);
    assert(bytes.length === file.bytes && crypto.createHash("sha256").update(bytes).digest("hex") === file.sha256,
      `${label} offline speech model checksum differs: ${file.name}.`);
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, "SOURCE.json"), "utf8"));
  assert(metadata.revision === MODEL_REVISION && metadata.author === "Tongyi Speech Lab, Alibaba Group", `${label} speech model provenance is missing/stale.`);
  const license = "FunASR-MODEL_LICENSE-58830eca.txt";
  assert(fs.readFileSync(path.join(directory, license)).equals(fs.readFileSync(path.join(root, "speech-input/native/licenses", license))), `${label} needs the complete speech model license.`);
  const allowed = new Set([...MODEL_FILES.map(file => file.name), "SOURCE.json", license]);
  for (const file of listFiles(directory)) assert(allowed.has(toPortablePath(path.relative(directory, file))), `${label} has an unexpected speech model file.`);
}

function assertExtraResourceFilters(packageJson) {
  const engine = findExtraResource(packageJson, "engine");
  const content = findExtraResource(packageJson, "content");
  assert(engine?.from === "../../../engine", "engine extraResource must still source from the repo engine/ directory.");
  assert(content?.from === "../../../content", "content extraResource must still source from the repo content/ directory.");
  assert(Array.isArray(engine.filter), "engine extraResource must use a runtime allowlist filter.");
  assert(Array.isArray(content.filter), "content extraResource must use a runtime allowlist filter.");
  for (const required of [
    "bridge/index.js",
    "bridge/session-desktop-bridge.js",
    "session/session-process-child.js",
    "session/session-new-game-lifecycle.js",
    "session/session-catalog.js",
    "session/session-archive.js",
    "session/session-story-export.js",
    "session/session-continuation.js",
    "session/session-compaction.js",
    "session/session-compaction-quotes.js",
    "session/turn-store.js",
    "session/turn-generator.js",
    "providers/index.js",
    "providers/provider-contracts.js",
    "tts/tts-service.js",
    "tts/utterance-planner.js",
    "content-v2/index.js",
    "content-v2/skill-module-preview.js",
    "content-v2/skill-panel-preview.js",
    "localization/index.js",
    "!**/smoke.js",
    "!**/*.test.js",
    "!**/*.spec.js",
    "!**/__tests__/**",
    "!**/test/**",
    "!**/tests/**",
    "!**/test-fixtures/**",
    "!**/*.md"
]) {
    assert(engine.filter.includes(required), `engine extraResource filter missing ${required}.`);
  }
  assert(!engine.filter.some((pattern) => typeof pattern === "string" && pattern.endsWith("/*.js")), "engine extraResource must use explicit runtime JS file entries.");
  assert(!engine.filter.includes("**/*"), "engine extraResource must not package every dev/test file.");
	  for (const required of [
	    "host/grey-crow-host.md",
	    "skills/index.v1.json",
	    "skills/*/SKILL.md",
	    "skills/*/templates/*.md",
	    "!skills/_template/**",
	    "!skills/tool-specs.v1.json",
	    "!skills/runtime-skill-rewrites.v1.json",
	  ]) {
	    assert(content.filter.includes(required), `content extraResource filter missing ${required}.`);
	  }
	  assert(!content.filter.includes("**/*"), "content extraResource must not package every content file.");
}

function findExtraResource(packageJson, to) {
  return (packageJson.build?.extraResources || []).find((entry) => entry?.to === to);
}

function assertAppAsarFiles(packageJson) {
  const appFiles = packageJson.build?.files || [];
  assert(Array.isArray(appFiles), "Electron build.files must explicitly allowlist app runtime files.");
  for (const asset of developmentOnlyRendererAssets) {
    assert(!isIncludedByFilters(asset, appFiles), `Electron build.files must exclude unused local artwork ${asset}.`);
  }
  for (const required of [
    "package.json",
    "main.js",
    "preload.js",
    "app-data.js",
    "credential-store.js",
    "content-library.js",
    "content-library-zip.js",
    "content-management.js",
    "model-connections.js",
    "desktop-status.js",
    "runtime-session.js",
    "context-settings-policy.js",
    "settings-store.js",
    "save-slots.js",
    "provider-https-transport.js",
    "tts-kokoro-original-provider.js",
    "tts-kokoro-original-worker.py",
    "THIRD_PARTY_NOTICES.md",
    "renderer/**",
  ]) {
    assert(appFiles.includes(required), `Electron build.files missing ${required}.`);
  }
  for (const forbidden of ["**/*", "*.js", "scripts/**", "scripts/check-*.js", "scripts/check-ui-smoke.js", "*.md", "package-lock.json"]) {
    assert(!appFiles.includes(forbidden), `Electron build.files must not package dev-only ${forbidden}.`);
  }
  for (const pattern of appFiles) {
    if (typeof pattern === "string" && pattern.includes("*")) {
      assert(["renderer/**", "!renderer/**/*.test.js"].includes(pattern), `Electron build.files wildcard must stay renderer-only, not ${pattern}.`);
    }
  }
}

function copyFilteredResource(sourceRoot, targetRoot, filters) {
  for (const filePath of listFiles(sourceRoot)) {
    if (filePath.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }
    const relativePath = toPortablePath(path.relative(sourceRoot, filePath));
    if (!isIncludedByFilters(relativePath, filters)) {
      continue;
    }
    const targetPath = path.join(targetRoot, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(filePath, targetPath);
  }
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(child));
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
  return out;
}

function isIncludedByFilters(relativePath, filters) {
  if (!filters.length) {
    return true;
  }
  let included = false;
  for (const filter of filters) {
    if (typeof filter !== "string" || !filter) {
      continue;
    }
    const negated = filter.startsWith("!");
    const pattern = negated ? filter.slice(1) : filter;
    if (!matchesFilterPattern(relativePath, pattern)) {
      continue;
    }
    included = !negated;
  }
  return included;
}

function matchesFilterPattern(relativePath, pattern) {
  const normalizedPattern = toPortablePath(pattern);
  if (normalizedPattern === "**/*") {
    return true;
  }
  if (normalizedPattern.endsWith("/**")) {
    return relativePath.startsWith(normalizedPattern.slice(0, -2));
  }
  if (!normalizedPattern.includes("*")) {
    return relativePath === normalizedPattern;
  }
  const escaped = normalizedPattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${escaped}$`).test(relativePath);
}

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

function toPortableAsarPath(value) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
