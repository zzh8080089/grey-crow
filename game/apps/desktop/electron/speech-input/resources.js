"use strict";

const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MODEL_REVISION = "2365baeacb507f821a0c8120fcee3d484dba7a07";
const MODEL_SOURCE = `https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/${MODEL_REVISION}`;
const MODEL_FILES = Object.freeze([
  { name: "model.int8.onnx", bytes: 239233841, sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51" },
  { name: "tokens.txt", bytes: 315894, sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc" },
  { name: "LICENSE", bytes: 71, sha256: "221c6df10b0931a5629adad671ea48fb7747e034c414b6d2bfa275bc3dd4ea17" },
]);
const MODEL_BYTES = MODEL_FILES.reduce((sum, file) => sum + file.bytes, 0);

function speechError(code) { return Object.assign(new Error(code), { code }); }
function cancelled(signal) { if (signal?.aborted) throw speechError("SPEECH_CANCELLED"); }

async function digest(file, signal) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) { cancelled(signal); hash.update(chunk); }
  return hash.digest("hex");
}

function createSpeechResources({ root, bundledModelRoot = null, fetchImpl = globalThis.fetch, files = MODEL_FILES }) {
  if (!path.isAbsolute(root)) throw new TypeError("Speech resource root must be absolute");
  if (bundledModelRoot !== null && !path.isAbsolute(bundledModelRoot)) throw new TypeError("Bundled speech model root must be absolute");
  const modelRoot = path.join(root, "model");
  const verifiedStamps = new Map();
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

  async function verifyRoot(candidateRoot, { force = false, signal } = {}) {
    try {
      const stamps = [];
      for (const file of files) {
        const stat = await fs.lstat(path.join(candidateRoot, file.name));
        if (!stat.isFile() || stat.size !== file.bytes) return false;
        stamps.push(`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
      }
      const stamp = stamps.join(";");
      if (!force && stamp === verifiedStamps.get(candidateRoot)) return true;
      for (const file of files) {
        if (await digest(path.join(candidateRoot, file.name), signal) !== file.sha256) return false;
      }
      cancelled(signal);
      verifiedStamps.set(candidateRoot, stamp);
      return true;
    } catch (error) {
      if (signal?.aborted) throw speechError("SPEECH_CANCELLED");
      return false;
    }
  }
  const verify = options => verifyRoot(modelRoot, options);
  const verifyBundled = options => bundledModelRoot ? verifyRoot(bundledModelRoot, options) : Promise.resolve(false);
  async function resolve(options) {
    if (await verify(options)) return { modelRoot, source: "download" };
    if (bundledModelRoot && await verifyBundled(options)) return { modelRoot: bundledModelRoot, source: "bundled" };
    return null;
  }

  async function install({ signal, onProgress = () => {} } = {}) {
    cancelled(signal);
    if (await resolve({ signal })) return;
    await fs.mkdir(root, { recursive: true });
    const disk = await fs.statfs(root);
    if (disk.bavail * disk.bsize < totalBytes + 32 * 1024 * 1024) throw speechError("SPEECH_DISK_FULL");
    const staging = await fs.mkdtemp(path.join(root, ".download-"));
    const backup = path.join(root, `.previous-${crypto.randomUUID()}`);
    let backedUp = false;
    let received = 0;
    try {
      for (const file of files) {
        cancelled(signal);
        const response = await fetchImpl(file.url || `${MODEL_SOURCE}/${file.name}`, {
          signal, redirect: "follow", credentials: "omit", cache: "no-store",
        });
        if (!response.ok || !response.body) throw speechError("SPEECH_DOWNLOAD_FAILED");
        const declared = response.headers.get("content-length");
        if (declared && Number(declared) !== file.bytes) throw speechError("SPEECH_MODEL_INVALID");
        const handle = await fs.open(path.join(staging, file.name), "wx", 0o600);
        const hash = crypto.createHash("sha256");
        let bytes = 0;
        try {
          for await (const chunk of response.body) {
            cancelled(signal);
            bytes += chunk.byteLength;
            if (bytes > file.bytes) throw speechError("SPEECH_MODEL_INVALID");
            hash.update(chunk);
            // FileHandle.write may write fewer bytes than requested.
            let offset = 0;
            while (offset < chunk.byteLength) {
              const written = await handle.write(chunk, offset, chunk.byteLength - offset);
              if (!written.bytesWritten) throw speechError("SPEECH_DOWNLOAD_FAILED");
              offset += written.bytesWritten;
            }
            received += chunk.byteLength;
            onProgress({ received, total: totalBytes });
          }
          if (bytes !== file.bytes || hash.digest("hex") !== file.sha256) throw speechError("SPEECH_MODEL_INVALID");
          await handle.sync();
        } finally { await handle.close(); }
      }
      cancelled(signal);
      await fs.writeFile(path.join(staging, "SOURCE.json"), JSON.stringify({
        name: "SenseVoice Small INT8", author: "Tongyi Speech Lab, Alibaba Group",
        conversion: "k2-fsa/sherpa-onnx (Fangjun Kuang)", revision: MODEL_REVISION,
        source: MODEL_SOURCE, license: "FunASR Model Open Source License Agreement v1.1",
        agreement: "https://github.com/modelscope/FunASR/blob/58830eca4012644aac0c3218c3ccc7d98f003fda/MODEL_LICENSE",
        files,
      }, null, 2), { mode: 0o600 });
      try { await fs.rename(modelRoot, backup); backedUp = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
      try { await fs.rename(staging, modelRoot); }
      catch (error) { if (backedUp) { await fs.rename(backup, modelRoot); backedUp = false; } throw error; }
      verifiedStamps.delete(modelRoot);
    } catch (error) {
      if (signal?.aborted) throw speechError("SPEECH_CANCELLED");
      if (error.code === "ENOSPC") throw speechError("SPEECH_DISK_FULL");
      throw error;
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
      if (backedUp) await fs.rm(backup, { recursive: true, force: true });
    }
  }

  async function remove() {
    verifiedStamps.delete(modelRoot);
    await fs.rm(modelRoot, { recursive: true, force: true });
  }
  return { modelRoot, bundledModelRoot, totalBytes, verify, verifyBundled, resolve, install, remove };
}

module.exports = { createSpeechResources, MODEL_BYTES, MODEL_FILES, MODEL_REVISION, MODEL_SOURCE, speechError };
