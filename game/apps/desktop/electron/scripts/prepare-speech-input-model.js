#!/usr/bin/env node
"use strict";

// Developer-only preparation. The player reads this verified model directly
// from extraResources; no network or first-run 240 MB copy is necessary.
const fs = require("node:fs");
const path = require("node:path");
const { MODEL_FILES, MODEL_REVISION, MODEL_SOURCE: source } = require("../speech-input/resources");
const { download, publishRuntime } = require("./prepare-speech-input-runtime");
const desktop = path.resolve(__dirname, "..");
function main() {
  if (process.argv.length > 2 && (process.argv.length !== 4 || process.argv[2] !== "--work-dir")) throw new Error("Usage: prepare-speech-input-model.js [--work-dir DIR]");
  const cache = path.resolve(process.argv[3] || path.join(desktop, "speech-input/.runtime-build/model"));
  for (const file of MODEL_FILES) download(`${source}/${file.name}`, path.join(cache, file.name), file.sha256);
  publishRuntime(path.join(desktop, "speech-input/.model"), output => {
    for (const file of MODEL_FILES) {
      const input = path.join(cache, file.name);
      if (fs.statSync(input).size !== file.bytes) throw new Error(`Model size mismatch: ${file.name}`);
      fs.copyFileSync(input, path.join(output, file.name));
    }
    fs.copyFileSync(path.join(desktop, "speech-input/native/licenses/FunASR-MODEL_LICENSE-58830eca.txt"), path.join(output, "FunASR-MODEL_LICENSE-58830eca.txt"));
    fs.writeFileSync(path.join(output, "SOURCE.json"), JSON.stringify({ name: "SenseVoice Small INT8", author: "Tongyi Speech Lab, Alibaba Group",
      conversion: "k2-fsa/sherpa-onnx (Fangjun Kuang)", revision: MODEL_REVISION, source,
      license: "FunASR Model Open Source License Agreement v1.1", files: MODEL_FILES }, null, 2) + "\n");
  });
  console.log("Verified offline speech model prepared (no game package was built).");
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
