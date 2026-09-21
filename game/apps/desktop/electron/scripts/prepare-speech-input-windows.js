#!/usr/bin/env node
"use strict";

// Optional macOS/Linux -> Windows preparation. Cross-compiling the small C API
// client does not claim a Windows microphone or native execution acceptance.
const fs = require("node:fs");
const path = require("node:path");
const { run, hash, download, files, publishRuntime } = require("./prepare-speech-input-runtime");
const { verifyWindowsSpeechBinaries } = require("./speech-input-windows-pe");
const desktop = path.resolve(__dirname, "..");
const native = path.join(desktop, "speech-input/native");
const releaseName = "sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts";
const release = { url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/${releaseName}.tar.bz2`,
  sha256: "4b0a94f7b5c606b1b64a19a831c2127559e4b3d34e195465ebc7be73d9ed4783" };
function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!["--work-dir", "--zig", "--notice-bundle"].includes(process.argv[i]) || !process.argv[i + 1] || options[process.argv[i]])
      throw new Error("Usage: prepare-speech-input-windows.js --zig FILE --notice-bundle VERIFIED_RUNTIME [--work-dir DIR]");
    options[process.argv[i]] = process.argv[i + 1];
  }
  if (!options["--zig"] || !options["--notice-bundle"]) throw new Error("A Zig 0.15.2 toolchain and previously verified 1.13.8 notices/source bundle are required");
  const zig = path.resolve(options["--zig"]), noticeBundle = path.resolve(options["--notice-bundle"]);
  const work = path.resolve(options["--work-dir"] || path.join(desktop, "speech-input/.runtime-build/win32-x64"));
  const version = run(zig, ["version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).stdout.trim();
  if (version !== "0.15.2") throw new Error("Audit the toolchain notices before changing Zig version");
  const prior = JSON.parse(fs.readFileSync(path.join(noticeBundle, "runtime-manifest.json"), "utf8"));
  if (prior.engine?.sourceArchiveSha256 !== "b0374cc56dbc186d442ae73d5de743bb092470b640c4c50ce7b029044c0c4fa8") throw new Error("Notices must originate from the fixed sherpa-onnx 1.13.8 source build");
  const pinned = JSON.parse(fs.readFileSync(path.join(native, "dependency-sources.json"), "utf8"));
  for (const dependency of pinned.filter(value => value.name !== "onnxruntime")) {
    if (!prior.dependencies.some(value => value.name === dependency.name && value.archiveSha256 === dependency.archiveSha256))
      throw new Error(`Unverified dependency notices: ${dependency.name}`);
  }
  const reusable = prior.files.filter(file => /^(licenses|sources)\//.test(file.path));
  for (const file of reusable) {
    if (path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes("..")) throw new Error("Unsafe notice path");
    const source = path.join(noticeBundle, file.path);
    if (!fs.lstatSync(source).isFile() || fs.statSync(source).size !== file.bytes || hash(source) !== file.sha256)
      throw new Error(`Notice/source checksum mismatch: ${file.path}`);
  }
  fs.mkdirSync(work, { recursive: true });
  const archive = path.join(work, `${releaseName}.tar.bz2`);
  download(release.url, archive, release.sha256);
  // Extract afresh from the pinned archive: a leftover DLL/header must not pass
  // merely because its download archive is still valid.
  const extracted = fs.mkdtempSync(path.join(work, "release-"));
  try {
    run("tar", ["-xjf", archive, "-C", extracted]);
    const source = path.join(extracted, releaseName);
    publishRuntime(path.join(desktop, "speech-input/.runtime/win32-x64"), output => {
      const bin = path.join(output, "bin"); fs.mkdirSync(bin);
      run(zig, ["c++", "-target", "x86_64-windows-gnu", "-std=c++17", "-O2", "-DNDEBUG", "-municode", "-s",
        `-ffile-prefix-map=${path.resolve(desktop, "../../../..")}=/grey-crow-source`, `-ffile-prefix-map=${work}=/build`,
        `-ffile-prefix-map=${path.dirname(zig)}=/zig`, `-I${path.join(source, "include")}`,
        path.join(native, "speech-input-cli.cc"), path.join(source, "lib/sherpa-onnx-c-api.lib"), "-o", path.join(bin, "speech-input-cli.exe")],
      { env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(work, "zig-cache") } });
      for (const name of ["sherpa-onnx-c-api.dll", "onnxruntime.dll", "onnxruntime_providers_shared.dll"]) fs.copyFileSync(path.join(source, "lib", name), path.join(bin, name));
      const binaryDependencies = verifyWindowsSpeechBinaries(bin);
      const metadata = JSON.parse(fs.readFileSync(path.join(native, "onnxruntime-eigen/SOURCE.json"), "utf8"));
      const buildInfo = fs.readFileSync(path.join(bin, "onnxruntime.dll")).toString("latin1").match(/ORT Build Info: [^\0\r\n]+/)?.[0];
      if (buildInfo !== "ORT Build Info: git-branch=HEAD, git-commit-id=33ca962, fp8-kv-cache=1, build type=Release"
        || !metadata.onnxruntime.sourceCommit.startsWith("33ca962")) throw new Error("Re-audit corresponding ORT/Eigen source after a runtime change");
      for (const file of reusable) {
        const dest = path.join(output, file.path); fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(noticeBundle, file.path), dest);
      }
      // Current attribution distinguishes shared Windows from static host builds.
      fs.copyFileSync(path.join(native, "licenses/ATTRIBUTION.md"), path.join(output, "licenses/ATTRIBUTION.md"));
      const toolchain = path.dirname(zig);
      for (const [from, name] of [["LICENSE", "zig-0.15.2.txt"], ["lib/libc/mingw/COPYING", "mingw-w64-COPYING.txt"],
        ["lib/libcxx/LICENSE.TXT", "llvm-libcxx.txt"], ["lib/libcxxabi/LICENSE.TXT", "llvm-libcxxabi.txt"], ["lib/libunwind/LICENSE.TXT", "llvm-libunwind.txt"]]) {
        fs.copyFileSync(path.join(toolchain, from), path.join(output, "licenses", name));
      }
      fs.writeFileSync(path.join(output, "runtime-manifest.json"), JSON.stringify({ schemaVersion: 1, target: "win32-x64", protocolVersion: 1,
        builtAt: new Date().toISOString(), engine: { name: "sherpa-onnx", version: "1.13.8", release },
        dependencies: prior.dependencies.filter(value => value.name !== "onnxruntime"),
        toolchain: { name: "Zig", version, executableSha256: hash(zig), target: "x86_64-windows-gnu", source: "https://ziglang.org/download/0.15.2/",
          compile: "zig c++ -target x86_64-windows-gnu -std=c++17 -O2 -DNDEBUG -municode -s -ffile-prefix-map=<repository>=/grey-crow-source -ffile-prefix-map=<work>=/build -ffile-prefix-map=<toolchain>=/zig -I<release>/include <native>/speech-input-cli.cc <release>/lib/sherpa-onnx-c-api.lib -o <runtime>/bin/speech-input-cli.exe" },
        onnxruntimeCorrespondingSource: { ...prior.onnxruntimeCorrespondingSource, actualEmbeddedBuildInfo: buildInfo },
        nativeSources: ["audio-input.h", "speech-input-cli.cc"].map(name => ({ path: name, sha256: hash(path.join(native, name)) })),
        options: { static: false, tts: false, python: false, provider: "cpu", threads: 4 }, modelBundled: false,
        minimumWindows: "Windows 10 x64 (system Universal CRT); Windows 7/8 not supported",
        validation: { binaryDependencies, crossCompiled: true, nativeVersion: null, windowsRealDeviceTested: false },
        files: files(output) }, null, 2) + "\n");
    });
  } finally { fs.rmSync(extracted, { recursive: true, force: true }); }
  console.log("Windows x64 speech runtime prepared; actual Windows execution remains to be tested.");
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
